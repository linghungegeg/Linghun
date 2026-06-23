# 预推理引擎（Pre-Reasoning Engine）实现路线图

## 架构定位

```
模型主链 → deferred-tools-catalog 发现 → MCP stdio JSON-RPC 2.0 → pre-engine daemon
                                                                        ↓
                                                              Tree-sitter AST (通用层)
                                                              + 可选 Deep Layer (语言专精)
```

引擎以 Rust 二进制形式交付，遵循现有 `@linghun/<name>-<platform>-<arch>` 分发模式。
通过 MCP stdio 协议与主链通信，注册为 deferred tool，模型按需调用。

**受益路径**：主链、旁路、智能体、工作流——任何能调用工具的执行路径自动获益。

---

## 硬性设计原则（不可违反）

1. **pre_plan ≠ scheduler** — 只输出静态编辑顺序事实，不做任务分发、不决定执行者、不管并发调度。它是地图，不是调度员。
2. **输出 ≠ 完成证据** — pre_verify 能说"签名一致"，不能说"功能正确"。永远不替代 test/build/evidence-runtime 的判定，在 evidence 链中角色是 pre-check，不是 verdict。
3. **按需调用，不强制** — 注册为普通 deferred tool，模型自主判断是否调用。不在 tool loop 里硬编码强制调用逻辑。Shadow/推荐模式属于独立优化阶段，不在 Phase 0-5 范围。
4. **先不动 runtime 生命周期** — Phase 0-4 按现有 one-shot spawn 模式跑。daemon keepAlive 推到 Phase 5 作为可选优化，不作为前置依赖。
5. **实时 AST only，不碰历史/语义** — 数据源是当前磁盘文件的 AST。谁改了什么、为什么改、架构演进是 codebase-memory 的职责，两者交集为零。

| 路径 | 加速来源 | 预估收益 |
|------|----------|----------|
| 主链单轮任务 | 跳过 3-5 轮工具探索 | 50-60% |
| 旁路子任务 | 探索占比更高，压缩效果更显著 | 60-70% |
| 多 agent 并发 | 共享缓存，消除重复解析 + 降低 I/O 压力 | 额外 15-20% 叠加 |

---

## Phase 0: 脚手架与协议对接（~2天）

**目标**：空壳 daemon 跑通 MCP 协议，能被 `mcp-stdio-runtime.ts` 正常 spawn/initialize/tools-list/kill。

**交付物**：
- `prototypes/pre-engine/Cargo.toml` — Rust 项目骨架
- JSON-RPC 2.0 stdio 通信（协议版本 `"2025-06-18"`）
- `initialize` 响应 capabilities
- `tools/list` 返回 4 个工具定义：`pre_impact`, `pre_plan`, `pre_context`, `pre_verify`
- `tools/call` 返回 placeholder 结构化结果

**验证节点**：
1. `bundle-cli-binaries.mjs` 新增 pre-engine 构建路径，`cargo build --release` 成功
2. 手动 spawn 二进制，发送 `initialize` + `tools/list` JSON-RPC，收到合法响应
3. `deferred-tools-catalog.ts` 注册 4 个工具，risk 分类为 `"readonly"`

**集成约束**（对应现有代码模式）：
- `postinstall.cjs` 新增 pre-engine 可执行文件 chmod 路径
- 平台包：`@linghun/pre-engine-{win32-x64,linux-x64,darwin-arm64,darwin-x64}`

---

## Phase 1: Tree-sitter 通用层 — `pre_context` 单工具闭环（~5天）

**目标**：`pre_context` 对任意语言项目返回确定性的符号上下文（定义、引用、调用关系），模型调用后直接获得结构化事实而非自行探索。

**核心实现**：
- 集成 tree-sitter + 语言 grammar（初期覆盖：TypeScript, Rust, Python, Go, Java）
- 增量解析：文件变更时仅重解析变更文件，维护内存中的符号表
- `pre_context` 输入：`{ symbol: string, path?: string, depth?: number }`
- `pre_context` 输出：
  ```json
  {
    "definition": { "file": "...", "line": 42 },
    "references": [{ "file": "...", "line": 10 }],
    "callees": ["fnA", "fnB"],
    "callers": ["fnX"],
    "signature": "fn foo(bar: string): number"
  }
  ```

**daemon 模式**：
- 从现有 one-shot spawn 升级为长连接 daemon（Tree-sitter 缓存在内存中，重启代价高）
- 首次 spawn 后保持进程，增加 heartbeat；idle 超时自动退出
- 对 `createProcessGuard()` 改动最小：增加 `keepAlive` 选项

**验证节点**：
1. 对 Linghun 仓库执行 `pre_context({ symbol: "executeModelToolUse" })`，返回结果与 `rg` 一致
2. 对一个 Python 项目执行同样查询，验证通用性
3. 响应延迟 < 200ms（热缓存）/ < 2s（冷启动首次全量解析）
4. 内存占用 < 300MB（10万行级项目）

---

## Phase 2: `pre_impact` — 变更影响分析（~4天）

**目标**：给定一组文件/符号变更，确定性返回受影响的文件、函数、测试，模型据此精准定位修改范围。

**核心实现**：
- 基于 Phase 1 符号表构建反向依赖图（谁调用了我、谁 import 了我）
- `pre_impact` 输入：`{ changes: [{ path: string, symbols?: string[] }] }`
- `pre_impact` 输出：
  ```json
  {
    "affected_files": [{ "path": "...", "reason": "imports changed symbol" }],
    "affected_symbols": [{ "name": "...", "file": "...", "relation": "caller" }],
    "affected_tests": ["test/foo.test.ts"],
    "confidence": "exact"
  }
  ```
- `confidence: "exact"` 仅当依赖链完全通过静态分析可达；否则 `"heuristic"`

**通用性保证**：
- 依赖图基于 Tree-sitter 的 `import/require/use/include` 模式匹配
- 每种语言一个 `import-pattern.scm` 查询文件（Tree-sitter query DSL）
- 新语言支持 = 新增一个 `.scm` 文件，零代码改动

**验证节点**：
1. 修改 `model-stream-runtime.ts` 中一个导出函数 → 返回的 affected_files 覆盖所有实际 import 点
2. 对比 `codebase-memory-mcp` 的 `trace_path`，影响面 ≥ 其结果
3. 对 Rust 项目执行同样测试，验证跨语言一致性
4. 无 false negative 容忍度 = 0；允许少量 false positive

---

## Phase 3: `pre_plan` — 任务行动规划（~5天）

**目标**：给定变更目标，返回确定性的文件编辑顺序和依赖约束，模型跳过"先看哪些文件需要改"的探索轮次。

**核心实现**：
- 输入：`{ task: string, target_symbols?: string[], target_files?: string[] }`
- 输出：
  ```json
  {
    "steps": [
      { "file": "...", "action": "modify", "symbols": ["fn"], "depends_on": [], "reason": "接口定义" },
      { "file": "...", "action": "modify", "symbols": ["impl"], "depends_on": [0], "reason": "实现同步" }
    ],
    "dependency_order": [0, 1]
  }
  ```
- 规划逻辑（纯确定性，无 LLM 参与）：
  1. 从 target 出发，沿依赖图收集所有需同步修改的位置
  2. 拓扑排序：接口先于实现，被依赖者先于依赖者
  3. 标注每步的前置依赖

**与 codebase-memory 分工**：
- codebase-memory：已索引的架构概览和历史模式
- pre-engine：基于实时 AST 的当前时刻精确依赖事实
- 互补，不冲突，不重复

**验证节点**：
1. 任务"给 ToolDefinition 接口新增字段" → 返回 steps 覆盖所有 `createTool()` 调用点
2. `dependency_order` 是合法拓扑序（无环、无遗漏）
3. 对比人工规划，步骤完整度 ≥ 90%
4. 规划延迟 < 500ms

---

## Phase 4: `pre_verify` — 变更一致性校验（~3天）

**目标**：模型完成编辑后快速预检类型/签名/接口一致性，无需等完整 typecheck。

**核心实现**：
- 输入：`{ changed_files: string[] }`
- 输出：
  ```json
  {
    "issues": [
      { "file": "...", "line": 10, "kind": "signature_mismatch", "detail": "参数数量 2→3 但调用点未更新" }
    ]
  }
  ```
- 检查项：签名不匹配、缺失 import、未使用导出、参数数量错误
- 基于 AST diff，不替代 typecheck/build，定位为 < 100ms 快速预检

**验证节点**：
1. 故意制造签名不匹配 → 检出
2. 故意遗漏 import → 检出
3. 正确改动 → issues 为空
4. 延迟 < 100ms

---

## Phase 5: 集成闭环与加速度量（~3天）

**目标**：4 个工具完整集成到模型主链，量化测量加速效果。

**集成改动点**：

| 文件 | 改动 |
|------|------|
| `packages/tui/src/deferred-tools-catalog.ts` | 注册 4 个 pre-engine 工具，risk = readonly |
| `packages/tui/src/mcp-stdio-runtime.ts` | 支持 daemon keepAlive 模式 |
| `scripts/bundle-cli-binaries.mjs` | 新增 pre-engine cargo build 路径 |
| `apps/cli/scripts/postinstall.cjs` | 新增 pre-engine 二进制 chmod |
| `packages/pre-engine-*/package.json` ×4 | 平台分发包 |

**验证节点**：
1. `corepack pnpm -r build` 全量通过
2. `corepack pnpm test` 全量通过
3. 端到端场景：模型执行"重命名函数"任务，对比有/无 pre-engine 的工具调用轮次
4. 目标：工具调用轮次减少 ≥ 50%（10 轮 → ≤ 5 轮）

---

## Phase 6（可选）: Deep Layer — 语言专精增强

**前置条件**：Phase 1-5 完成且通用层加速达标。

**目标**：对高频语言接入真实类型系统，`pre_verify` 从 AST 级提升到类型级。

| 语言 | 类型源 | 接入方式 |
|------|--------|----------|
| TypeScript | `ts.createProgram` | 子进程 IPC |
| Rust | rust-analyzer LSP | stdio LSP 协议 |
| Python | pyright | stdio LSP 协议 |

**验证节点**：
1. `pre_verify` 能检出纯类型错误（`string` 赋给 `number`）
2. 无 Deep Layer 时优雅降级到 AST 级检查
3. Deep Layer 初始化 < 5s，后续查询 < 200ms

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Tree-sitter grammar 覆盖度不足 | 初期聚焦 5 大语言，其余 graceful fallback（返回空结果，不报错） |
| daemon 内存泄漏 | idle timeout 自动退出 + 进程 guard 兜底 |
| 与 codebase-memory 工具名冲突 | 统一前缀 `pre_`，deferred-tools-catalog 按前缀分组 |
| 大仓（>50万行）性能 | 增量解析 + workspace 分片，Phase 1 验证节点含性能基线 |
| 多 agent 并发竞争 | daemon 内部 RwLock，读查询无锁并发，写更新串行 |

---

## 时间线总览

```
Phase 0 (脚手架)     ████  2天
Phase 1 (context)    ██████████  5天
Phase 2 (impact)     ████████  4天
Phase 3 (plan)       ██████████  5天
Phase 4 (verify)     ██████  3天
Phase 5 (集成闭环)   ██████  3天
─────────────────────────────────────
合计：~22 工作日（Phase 6 另计）
```

每个 Phase 结束时的验证节点是硬性门控——不通过不进入下一 Phase。

Phase 0-1 是关键路径：一旦 `pre_context` 闭环，后续 Phase 都是在已有符号表/依赖图上的增量扩展。
