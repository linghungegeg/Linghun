# Linghun Phase 00-18 Design + Runtime Overdesign Full Audit V2

> 审计类型：只读全量审计（未修改任何代码）
> 审计日期：2026-05-19
> 审计范围：Phase 00-18 设计文档、全部源码、CCB 对照源码
> 审计方法论：codebase-memory 索引 (1170 nodes, 2108 edges) + 14 维度并行 Agent 深挖
> 总发现数：48 高严重度以上 + 35 通过确认 + 10 中等
> 硬约束：本轮只输出报告，不改代码

---

## 1. Executive Verdict

### 1.1 是否存在系统性过度设计：**是**

Linghun 当前不是"功能不足"，而是**设计面过度展开、实现集中在单点、文档自证循环、大量 TYPE-SHELL 伪实现**。具体表现为：

1. **NCB 过度设计**：Natural Command Bridge 从"让用户能用自然语言查状态"膨胀为 44 个 Capability 的关键词意图路由器（1709 行），其中含 per-capability 手工 boost 逻辑。

2. **TUI 单文件危机**：`packages/tui/src/index.ts` 达 8393 行，承载全部子系统。

3. **文档自证循环**：`START_NEXT_CHAT.md` 224 行记录了 30+ 轮 closure/audit/hardening。

4. **Gates 污染主链路**：6+ 层闸门拦截普通用户输入。

5. **Phase 15.5/16/17/18 蓝图预设过度**。

6. **TYPE-SHELL 危机**：MCP、Skills、Workflows、Plugins、Hooks 五大系统类型定义齐全、诊断面板完备，但**运行时执行全部为零**。

7. **零压缩/零历史**：每次 `sendMessage` 从空白 `[system, user_input]` 开始。无会话历史注入、无令牌计数、无上下文窗口管理。

8. **零重试/零降级**：Provider 层零重试逻辑、零流超时、零非流式回退。

### 1.2 是否阻塞 Phase 15 Beta 实测：**是（阻塞项显著增加）**

新增阻塞：
- 零压缩/零会话历史 → 模型无对话记忆
- 零重试逻辑 → 瞬时错误致命
- TYPE-SHELL 五大系统 → 用户可见功能实际不可用
- Agent `failed` 状态死代码 / `--background` 假标志
- 零输入验证 (`input as never`) → 安全风险

### 1.3 是否必须先修再实测：**是**

### 1.4 Phase 15 Beta Readiness：**FAIL**

---

## 2. CCB Mature Baseline Inventory

| # | CCB 成熟行为 | CCB 参考文件 | Linghun 当前状态 | 差距 |
|---|------------|------------|---------------|------|
| 1 | Tool 合约 ~60 字段 | `src/Tool.ts` | 9 字段，无 Zod/inputSchema | **严重** |
| 2 | Tool 执行含 Hook + 权限 + 遥测 | `src/services/tools/toolExecution.ts` | 顺序执行，零 Hook 集成 | **严重** |
| 3 | 会话历史注入 + Compact 压缩 | compact 机制 | **零实现** — 每轮从空白开始 | **严重** |
| 4 | 令牌计数 + 上下文窗口管理 | tokenizer | **零实现** | **严重** |
| 5 | MCP 协议 stdio/SSE 传输 | MCP SDK | 仅 `--version` 检查 | **严重** |
| 6 | Skills/Hooks 实际执行 | skills/hooks runtime | 清单加载器，零执行 | **严重** |
| 7 | 权限成熟交互 (Tab/Esc/反馈) | `components/permissions/` | 全有或全无 yes/no | **高** |
| 8 | Provider 重试/退避/Retry-After | retry logic | **零重试** | **严重** |
| 9 | 状态栏含 context%/rate limit/cost | `StatusLine.tsx` | 缺 4 项关键指标 | **高** |
| 10 | 流超时 + 心跳 | stream timeout | **零超时** | **严重** |

---

## 3. Linghun Design + Runtime Mapping

| # | 设计文档声明 | 源码实现 | 真实行为 | 对齐 CCB？ |
|---|------------|---------|--------|-----------|
| 1 | "tool_use/tool_result 闭环" | 闭环存在 | HTTP 400 on tools schema → PARTIAL | 部分 |
| 2 | "NCB 只做状态查询" | 44-caps 意图路由器 | 普通开发请求可能被误拦截 | **偏离** |
| 3 | "primary/details/debug 分层" | TuiOutputLayer 定义 | **从未生效**—始终 primary | **偏离** |
| 4 | "core 不依赖 TUI" | core 67 行 | 极薄，几无核心逻辑 | **偏离** |
| 5 | "上下文三层分层" | 架构文档 §20 | **未实现**—扁平单行提示 | **偏离** |
| 6 | "MCP 工具稳定化" | stabilizeMcpToolList | 仅占位符，无真实 MCP 工具 | **偏离** |
| 7 | "Skills/Workflows 可用" | 类型+诊断面板 | **零运行时执行** | **偏离** |
| 8 | "Agent 闭环" | AgentRun 类型 | Explorer/Planner 是存根 | **偏离** |
| 9 | "模型多角色路由" | 7 角色路由 | Vision/Image 非功能 | 部分 |
| 10 | "Windows 兼容" | 双 bin 入口 | 路径/CRLF 良好；Shell/SIGTERM 有 Gap | 部分 |

---

## 4. 原报告过度设计发现

### 4.1 Critical (4 项保留)

- **C-1**: NCB 作为通用意图路由器的过度设计（1709 行）
- **C-2**: TUI 单文件 8393 行 — 结构性危机
- **C-3**: Gates 污染主输入路径（6+ 层闸门）
- **C-4**: Provider 双 Profile (chat_completions + responses)

### 4.2 High (6 项保留)

- **H-1**: 文档债 — 阶段文档多于运行能力
- **H-2**: 测试债 — Mock Provider 推导 PASS
- **H-3**: Evidence/Transcript/Handoff 系统过度暴露
- **H-4**: 配置优先级 Source of Truth 不统一

### 4.3 Medium (6 项保留) / 4.4 Low (3 项保留)

（略，详见原报告）

---

## 5. 14 维度 Agent 深挖发现（本轮新增）

### 5.1 Tool 系统成熟度

**严重度: Critical × 8**

| # | 发现 | 严重度 | 证据 |
|---|------|--------|------|
| T-1 | ToolDefinition 仅 9 字段 vs CCB ~60 | **Critical** | `tools/index.ts:27-36` |
| T-2 | 零 Zod/inputSchema 验证，`input as never` 绕过类型 | **Critical** | `tools/index.ts:126` |
| T-3 | 无 `isEnabled()`/`isDestructive()`/`interruptBehavior()` | **Critical** | 仅静态 `isReadOnly: boolean` |
| T-4 | 无 PreToolUse/PostToolUse Hook 集成 | **Critical** | TUI `decidePermission` 不调用 Hook |
| T-5 | 无错误分类 — 通用 `formatError()` | **High** | `tui/index.ts:6602` vs CCB 20 行 `classifyToolError()` |
| T-6 | 仅 Bash 有进度显示，其余 8 工具零进度 | **Critical** | `tui/index.ts:7812-7866` |
| T-7 | 无并行工具执行 — 严格顺序 `for...of` | **High** | `tui/index.ts:6267` |
| T-8 | 无 `maxResultSizeChars` — Read/Grep/Glob 可返回巨大字符串 | **High** | 仅 Bash 在 4000 字符处截断 |

### 5.2 Permission 系统成熟度

**严重度: High × 2**

| # | 发现 | 严重度 | 证据 |
|---|------|--------|------|
| P-1 | 批准前无法检查/修改 toolCall.input — 全有或全无 | **High** | `tui/index.ts:5694-5748` |
| P-2 | Hook 无法影响权限决策 — `decidePermission` 不查询 Hook | **High** | `tui/index.ts:7443-7543` |
| P-3 | Auto 模式是存根 — 总是因"classifier unavailable"拒绝 | **High** | `tui/index.ts:7528-7535` |
| P-4 | 无 Tab 编辑/无反馈模式/无键盘绑定 | **Medium** | 仅 raw yes/no 文本匹配 |
| P-5 | 危险检测仅覆盖基础 Bash 模式 | **Medium** | 缺少 CCB 的解释器/包运行器检查 |

### 5.3 Session/Context/Compact 系统

**严重度: Critical × 6**

| # | 发现 | 严重度 | 证据 |
|---|------|--------|------|
| S-1 | **零压缩实现** — `compacted` 从未变为 true | **Critical** | `tui/index.ts:759` |
| S-2 | **零会话历史注入** — 每轮 `[system, user_input]` 从零开始 | **Critical** | `tui/index.ts:6172-6175` |
| S-3 | **零令牌计数** — 无 tokenizer、无 `countTokens` | **Critical** | 全代码库零结果 |
| S-4 | 系统提示是扁平单行，架构文档三层设计未实现 | **Critical** | `tui/index.ts:6647-6658` |
| S-5 | 无上下文窗口管理 — 仅 `MAX_MODEL_TOOL_ROUNDS=4` | **Critical** | `tui/index.ts:709` |
| S-6 | 项目规则/MCP 工具目录/Skills 摘要从不注入提示 | **Critical** | RuntimeStatus 仅送元数据标志 |
| S-7 | 回退仅文件快照，无 Git 还原，无上下文协调 | **High** | `tui/index.ts:7719` |
| S-8 | 会话元数据写入非原子，损坏不可恢复 | **High** | `jsonl.ts:16` / `session-store.ts:158` |

### 5.4 Error Handling & Resilience

**严重度: Critical × 2, High × 2**

| # | 发现 | 严重度 | 证据 |
|---|------|--------|------|
| E-1 | **零重试/退避逻辑** — 429/5xx/网络错误无自动重试 | **Critical** | 全代码库 `retry`/`backoff` 零匹配 |
| E-2 | 零流超时 — 挂起流无限期阻塞 | **Critical** | `providers/index.ts:515` |
| E-3 | 429 无 `Retry-After` 解析 | **High** | `providers/index.ts:957-963` |
| E-4 | 损坏 session.json = 会话不可恢复 | **High** | `session-store.ts:154-161` |
| E-5 | Provider 响应体从未被读取用于诊断 | **Medium** | `providers/index.ts:319-324` |

### 5.5 MCP/Skills/Workflows/Plugins/Hooks

**严重度: Critical × 5**

| # | 系统 | 类型 | 配置 | 诊断 | 实际执行 | 裁决 |
|---|------|------|------|------|---------|------|
| W-1 | **MCP** | 完整 | 完整 | 完整 | **仅 `--version` 检查** | SHELL (30%) |
| W-2 | **Skills** | 完整 | 完整 | 完整 | **仅清单加载，正文从未读取** | SHELL (25%) |
| W-3 | **Workflows** | 完整 | 完整 | Start Gate | **仅模板文本** | SHELL (20%) |
| W-4 | **Plugins** | 完整 | 完整 | 完整 | **仅清单加载，贡献从不注册** | SHELL (25%) |
| W-5 | **Hooks** | 完整 | 完整 | Doctor | **零事件循环，零拦截** | SHELL (15%) |

统一结论：全部是 **REAL 类型定义 + SHELL 执行层**。类型/配置/诊断可工作；运行时行为为零。

### 5.6 Agent / Background Task 生命周期

**严重度: Critical × 3, High × 2**

| # | 发现 | 严重度 | 证据 |
|---|------|--------|------|
| A-1 | `"failed"` Agent 状态是死代码 — 零次赋值 | **Critical** | `tui/index.ts:432` |
| A-2 | `--background` 标志是假解析 — `task.includes("--background")` | **Critical** | `tui/index.ts:2745` |
| A-3 | Explorer/Planner Agent 是存根 — 仅返回摘要字符串 | **Critical** | `tui/index.ts:2885-2889` |
| A-4 | Agent 取消非抢占式 — 纯标记，无 AbortController | **High** | `tui/index.ts:2946-2971` |
| A-5 | Worker Agent 仅解析 `write <path> <content>` 单模式 | **High** | `tui/index.ts:2900-2943` |
| A-6 | 心跳/过期是纯类型字段 — 零代码读取/检查 | **High** | `heartbeatIntervalMs`/`staleAfterMs` 仅写入 |
| A-7 | `"paused"`/`"compact"`/`"job"`/`"mcp"` 状态 — 类型专用 | **Medium** | 后台任务从未使用这些值 |
| A-8 | Verification Runner — 最完整实现 | ✅ Pass | 超时/日志/证据/进度均正确 |

### 5.7 Output / UX / Status Line 成熟度

**严重度: High × 6**

| # | 发现 | 严重度 | 证据 |
|---|------|--------|------|
| U-1 | **零 ANSI 色彩** — 全部纯文本 | **High** | 无任何 ANSI escape code 产出 |
| U-2 | **输出分层从未生效** — `layer` 始终 `"primary"` | **High** | `tool-output-presenter.ts:32` |
| U-3 | 状态栏缺 context%/5h limit/7d limit/cost | **High** | `runtime-status-presenter.ts:15-25` |
| U-4 | `provider` 字段在 RuntimeStatusView 中声明但从未格式化 | **High** | 死字段 |
| U-5 | 无流式进度/思考指示器/旋转器 | **High** | 模型流式期间用户看空白屏幕 |
| U-6 | 工具输出截断后有 "Full log: `<path>`" 但无 `/details` 命令 | **Medium** | 用户无交互方式查看完整输出 |
| U-7 | i18n 仅 26 key vs ~67 内联三元表达式 | **Low** | 中文输出自然流畅，但维护分散 |

### 5.8 Testing & Verification 成熟度

**严重度: High × 2**

| # | 发现 | 严重度 | 证据 |
|---|------|--------|------|
| Q-1 | **零 CI/CD 配置** — 无 GitHub Actions/CircleCI/Jenkins | **High** | 无 `.github/workflows/` |
| Q-2 | 真实 provider 冒烟仅手动 — 不在 `pnpm test` | **High** | `smoke:live-provider`=`node -e "..."` |
| Q-3 | 2941 行单体测试文件，全部 90 个测试在一个 `describe()` | **Medium** | `tui/index.test.ts` |
| Q-4 | 373+ 处 `toContain` 文本断言 — 对输出格式重构脆弱 | **Medium** | 但对功能有良好覆盖 |
| Q-5 | 无并发/压力/边界/Unicode 破坏测试 | **Low** | |
| Q-6 | Core 包测试极薄 (4 文件, ~155 行) | **Low** | |
| Q-7 | `/verify` 命令实现完整、Verification Runner 成熟 | ✅ Pass | 超时/日志/证据/进度均正确 |

### 5.9 Cache / Index / Memory 系统

**严重度: High × 1, Medium × 2**

| # | 发现 | 严重度 | 证据 |
|---|------|--------|------|
| M-1 | **内存内容从不注入系统提示** — 仅元数据计数 | **High** | `natural-command-bridge.ts:775-805` |
| M-2 | 无内存衰减/优先级系统 — 所有记忆永久等值 | **Medium** | `MemoryCandidate` 无分数字段 |
| M-3 | `reasoningEffortHash` 始终硬编码为 `"default"` | **Medium** | 变化不会触发缓存失效 |
| M-4 | 无缓存 TTL 药丸/倒计时 — 仅 `cache X%` 文本 | **Medium** | 与 CCB 彩色药丸差距大 |
| M-5 | Index Safety Repair 是纯关键词分类器 (39 词项) | **Low** | 无语义理解 |
| M-6 | Cache 9 维度哈希全部计算并比较 | ✅ Pass | SHA-256, 12 位十六进制 |
| M-7 | LINGHUN.md 存在性注入 RuntimeStatus | ✅ Pass | 但内容不注入 |
| M-8 | 索引懒加载 — 不在启动时连接 MCP | ✅ Pass | |

### 5.10 Streaming & Provider 弹性

**严重度: Critical × 4, High × 2**

| # | 发现 | 严重度 | 证据 |
|---|------|--------|------|
| R-1 | **零流超时** — 挂起流无限期阻塞 | **Critical** | `providers/index.ts:515` |
| R-2 | **部分 tool_use 在流断开时静默丢弃** | **Critical** | `providers/index.ts:836-845` |
| R-3 | **零重试逻辑** — 瞬时错误致命 | **Critical** | 全代码库 `retry`/`backoff` 零匹配 |
| R-4 | **零 `Retry-After` 解析** — 429 后无等待 | **Critical** | `providers/index.ts:957-963` |
| R-5 | 429/400/5xx 响应体从未读取用于诊断 | **High** | `providers/index.ts:319-324` |
| R-6 | 非流式端点无降级 — `supportsStreaming` 未检查 | **High** | `providers/index.ts:300-338` |
| R-7 | 无语义工具循环检测 — 仅 `MAX_MODEL_TOOL_ROUNDS=4` | **Medium** | 模型可在限制内永久循环 |
| R-8 | SSE 增量组装 + `isCompleteJsonObject` 最终验证 | ✅ Pass | `providers/index.ts:818-848` |
| R-9 | Chat Completions / Responses 双 SSE 解析器 | ✅ Pass | 覆盖主要事件类型 |

### 5.11 Config Validation & Model 路由

**严重度: High × 4**

| # | 发现 | 严重度 | 证据 |
|---|------|--------|------|
| F-1 | **零 Schema 验证** — `JSON.parse(raw) as Partial<LinghunConfig>` | **High** | `config/index.ts:404` |
| F-2 | **损坏 settings.json 直接崩溃** — 无恢复路径 | **High** | `config/index.ts:406-410` |
| F-3 | Vision/Image 路由非功能 — 空 provider/model | **High** | `config/index.ts:216-237` |
| F-4 | Vision 能力检查是模型名正则而非 provider 能力 | **High** | `tui/index.ts:2155-2156` |
| F-5 | Config 写入非原子 — `writeFile` 直接覆盖 | **Medium** | `config/index.ts:488-494` |
| F-6 | 数组 merge 不一致 (mcp.servers deep vs enabledServers replace) | **Medium** | `config/index.ts:608-614` |
| F-7 | Vision/Image 命令不调用模型 API — 仅占位符 | **Medium** | `tui/index.ts:5121-5163` |
| F-8 | Route doctor 诊断实现完整 | ✅ Pass | `tui/index.ts:1975-2022` |
| F-9 | Env var 优先级链清晰一致 | ✅ Pass | `config/index.ts:560-597` |
| F-10 | Trailing slash 处理正确 | ✅ Pass | `providers/index.ts:360-362` |

### 5.12 Build / Packaging / Dependencies

**严重度: 大部分通过**

| # | 发现 | 严重度 | 证据 |
|---|------|--------|------|
| B-1 | **零外部运行时依赖** — 全部 Node.js 内置 | ✅ Pass | 极其精简 |
| B-2 | 纯 ESM — 全部 `"type": "module"` | ✅ Pass | 现代、一致 |
| B-3 | Monorepo DAG 无循环依赖 | ✅ Pass | 严格分层 |
| B-4 | 包缺少 `"files": ["dist"]` — 发布风险 | **Medium** | 6 个包均无 |
| B-5 | 无 watch/dev/ci 脚本 | **Low** | |
| B-6 | Vitest 别名缺 `@linghun/tools` + `@linghun/tui` | **Medium** | `vitest.config.ts` |
| B-7 | 存在两种构建方法 (tsup vs tsup+tsc) | **Low** | `core`/`tui` 需两步 |
| B-8 | `skipLibCheck: true` — 可接受，仅影响 `@types/node` | **Low** | |
| B-9 | 零 `@ts-ignore`/`@ts-expect-error` | ✅ Pass | 完全干净 |
| B-10 | pnpm-lock.yaml 已提交 (44KB) | ✅ Pass | |

### 5.13 Windows 兼容性

**严重度: High × 2 (P1)**

| # | 发现 | 严重度 | 证据 |
|---|------|--------|------|
| N-1 | **Shell spawning 不一致** — 无 Shell 检测；`windowsHide` 在 Line 5431 缺失 | **High (P1)** | `tui/index.ts:5431` |
| N-2 | **`child.kill("SIGTERM")` 在 Windows 无效** | **High (P1)** | `tui/index.ts:5436` |
| N-3 | 无 `SIGBREAK` 处理器 | **High (P1)** | `tui/index.ts:1324` |
| N-4 | 零 `process.platform` 条件路径 | **Medium (P2)** | 全代码库 |
| N-5 | 无 `\\?\` 长路径前缀 | **Medium (P2)** | |
| N-6 | 路径规范化 `replaceAll("\\","/")` 全面 | ✅ Pass | 所有输出路径均规范化 |
| N-7 | CRLF 容忍完整 — `split(/\r?\n/)` | ✅ Pass | |
| N-8 | UTF-8 + GB18030 回退 | ✅ Pass | `decodeInput()` |
| N-9 | 无硬编码 Unix-ism (`/workspace`/`chmod`) | ✅ Pass | |
| N-10 | 双 `Linghun`/`linghun` bin 入口 | ✅ Pass | |

### 5.14 性能 & 资源

**严重度: High × 3**

| # | 发现 | 严重度 | 证据 |
|---|------|--------|------|
| O-1 | **Evidence 数组泄漏** — `unshift` 从不修剪 | **High** | `tui/index.ts:5514,6335,7982,8013` |
| O-2 | **每事件重写 session.json** — 冗余 I/O | **High** | `session-store.ts:120` |
| O-3 | **Exit 无清理** — 无子进程终止/临时文件清理 | **High** | `tui/index.ts:1336-1342` |
| O-4 | 顺序启动 I/O — 6 个独立 `await` 可并行化 | **Medium** | `tui/index.ts:1274-1297` |
| O-5 | JSONL 无缓冲追加 — 每事件 1 次 syscall | **Medium** | `jsonl.ts:16` |
| O-6 | 启动时每次 Memory 一个 readFile — 100 memory=100 次 | **Medium** | `tui/index.ts:843-864` |
| O-7 | Transcript 全量内存加载 — `text.split(/\r?\n/)` | **Medium** | `jsonl.ts:19-45` |
| O-8 | 9 个无界数组 (backgroundTasks/checkpoints/agents 等) | **Medium** | `tui/index.ts:675-699` |
| O-9 | 无日志轮转 — Bash/验证日志无限累积 | **Medium** | |
| O-10 | Session 列表无分页 — 100 sessions=100 readFile | **High** | `session-store.ts:78-80` |
| O-11 | Cache 历史有界 (200)，修剪正确 | ✅ Pass | `tui/index.ts:705,4625-4628` |
| O-12 | MCP/索引懒加载 — 启动时不连接 | ✅ Pass | |

---

## 6. Keep / Weaken / Remove / Defer Matrix (V2 扩展)

### 6.1 新增模块级裁决

| 模块/能力 | 裁决 | 理由 |
|----------|------|------|
| **Tool Zod 验证** | **ADD** | 替换 `input as never` 强转 |
| **Compact 压缩** | **ADD** | Phase 15 必须：会话历史 + 压缩 |
| **令牌计数** | **ADD** | Phase 15 必须 |
| **MCP SDK 集成** | **ADD** | 引入 `@modelcontextprotocol/sdk` |
| **Skills 执行引擎** | **ADD** | 正文加载 + 触发词匹配 |
| **Hooks 事件循环** | **ADD** | PreToolUse/PostToolUse/Stop 触发 |
| **Agent 修复** | **FIX** | 死代码清理 + 真后台执行 |
| **Provider 重试** | **ADD** | 指数退避 + Retry-After |
| **流超时** | **ADD** | 30s 心跳超时 |
| **ANSI 色彩** | **ADD** | 错误/警告/成功/信息 |
| **上下文窗口管理** | **ADD** | 令牌计数 + 安全边际 |
| **Session 列表分页** | **FIX** | 100+ sessions 性能 |
| **Evidence 修剪** | **FIX** | `unshift` 后 `.slice(0,20)` |
| **Config Schema 验证** | **ADD** | Zod schema + 损坏恢复 |
| **Windows SIGBREAK** | **ADD** | 信号处理 |
| **`windowsHide` 修复** | **FIX** | Line 5431 |
| **Exit 清理** | **FIX** | 子进程终止 + 临时文件 |
| **Session 元数据写入去重** | **FIX** | 仅 `updatedAt` 变化时写入 |

---

## 7. One-Shot Remediation Plan V2

### 7.1 总原则

一次性收口。Phase 15 Beta 前必须完成 Must Fix 清单。

### 7.2 Must Fix Before Phase 15 Beta (22 项)

**A 组：会话连续性（最优先）**

1. **FIX-A1**: 实现会话历史注入 — 将 transcript 中的最近 N 条消息注入 `sendMessage` 的 messages 数组
2. **FIX-A2**: 实现令牌计数 — 添加 tokenizer，计算提示大小
3. **FIX-A3**: 实现上下文窗口管理 — 安全边际检查 + 溢出时触发压缩

**B 组：Tool 系统加固**

4. **FIX-B1**: 添加 Zod inputSchema 到所有 9 个工具 — 替换 `input as never`
5. **FIX-B2**: 添加 `isEnabled()`/`isDestructive()`/`interruptBehavior()` 到 ToolDefinition
6. **FIX-B3**: 为所有工具添加进度处理程序（至少最小化旋转器/状态指示器）
7. **FIX-B4**: 实现 `maxResultSizeChars` + 工具结果存储管道

**C 组：Provider 弹性**

8. **FIX-C1**: 实现指数退避重试（429/502/503/504 + TypeError）
9. **FIX-C2**: 解析 `Retry-After` 头
10. **FIX-C3**: 实现流超时（30s 心跳）
11. **FIX-C4**: 修复部分 tool_use 静默丢弃 — 流结束时检查 pendingToolCalls

**D 组：TUI 结构 + Gates**

12. **FIX-D1**: 拆分 `packages/tui/src/index.ts` (8393 行 → 7 模块)
13. **FIX-D2**: 弱化 NCB — 从意图路由器降级为安全闸门（删除 scoring/boost/capability routing）
14. **FIX-D3**: 移除主输入路径中的 Gates（Evidence/Claim/Completeness/Verdict hardcode）

**E 组：TYPE-SHELL → REAL**

15. **FIX-E1**: MCP SDK 集成 — 实现 stdio 传输 + tools/list/call
16. **FIX-E2**: Skills 执行引擎 — 正文加载 + 触发词匹配 + 注入系统提示
17. **FIX-E3**: Hooks 事件循环 — PreToolUse/PostToolUse 触发 + stdin/stdout 通信

**F 组：Agent 修复**

18. **FIX-F1**: 修复 `--background` — 真后台异步执行
19. **FIX-F2**: 清理 Agent 死代码 — 实现 `failed` 状态转换

**G 组：UX 最小增强**

20. **FIX-G1**: 添加 ANSI 色彩 — 错误(红)/警告(黄)/成功(绿)/信息(蓝)
21. **FIX-G2**: 修复输出分层 — `/details` 命令访问完整工具输出
22. **FIX-G3**: 状态栏补充 context%/rate limit/cost

**H 组：资源/可靠性修复**

23. **FIX-H1**: Evidence 数组修剪 — 所有 `unshift` 后 `.slice(0, 20)`
24. **FIX-H2**: Session 元数据去重写入 — 仅 `updatedAt` 变化时
25. **FIX-H3**: Exit 清理 — 终止子进程 + 清理临时文件
26. **FIX-H4**: Session 列表分页 — 限制 metadata 读取
27. **FIX-H5**: Config Schema 验证 + 损坏恢复

### 7.3 Should Fix in Same Closure (12 项)

28. 并行化启动 I/O (`Promise.all`)
29. JSONL 追加缓冲
30. 日志轮转机制
31. 无界数组修剪
32. Shell 检测 (Windows)
33. `windowsHide` 修复 + `SIGBREAK` 处理器
34. Vision/Image 路由最小实现
35. 文档降权 (phase-15-pre-beta-*.md → archive/)
36. START_NEXT_CHAT.md 重写 (≤40 行)
37. Config 原子写入 (temp-then-rename)
38. 包 `"files": ["dist"]` 字段
39. Vitest 别名补全

### 7.4 Defer to Phase 15.5

- Compact 压缩完整实现
- 完整 Hook 执行管道
- Workflows 状态机
- Plugins 贡献注册
- Agent 间通信/团队协调
- 双模型审计
- 学习闭环

---

## 8. Anti-Pattern Ban List (V2 扩展)

| # | 禁止行为 | 已有实例 |
|---|---------|---------|
| 1 | 禁止新增关键词补丁 | NCB scoring `if (cap.id === "xxx") score += N` |
| 2 | 禁止 TYPE-SHELL — 类型定义不等于功能交付 | MCP/Skills/Workflows/Plugins/Hooks 五大系统 |
| 3 | 禁止 `input as never` 强转跳过验证 | `tools/index.ts:126` |
| 4 | 禁止 mock/focused PASS 推导 readiness PASS | 测试体系 |
| 5 | 禁止无界数组 — 所有集合必须有上限 | Evidence/backgroundTasks/checkpoints 等 9 数组 |
| 6 | 禁止冗余 session 元数据写入 | 每事件重写 session.json |
| 7 | 禁止静默丢弃 — 部分 tool_use/未识别 SSE | 流解析器 |
| 8 | 禁止零超时 — 所有 I/O 操作必须有超时 | Stream/Provider |
| 9 | 禁止死状态/死字段 — 类型定义必须有赋值路径 | `failed` agent status / `provider` 字段 |
| 10 | 禁止普通任务被控制面抢走 | NCB scoring 可能误分类 |
| 11 | 禁止把未来阶段过度设计写成已知限制后继续推进 | Phase 15.5/16/17/18 蓝图预设 |
| 12 | 禁止在代码中 hardcode 项目阶段状态 | `createPhase15BetaVerdictScope()` hardcode PARTIAL |
| 13 | 禁止继续往 `packages/tui/src/index.ts` 添加功能 | 8393 行且仍在增长 |

---

## 9. Acceptance Matrix After Remediation (V2)

| # | 场景 | 当前 | 修复后目标 |
|---|------|------|----------|
| 1 | 普通开发请求 | NCB 可能拦截 | 直达模型 |
| 2 | 多轮对话连续性 | **零历史**—每轮从空白开始 | 会话历史注入 |
| 3 | 上下文接近限制 | **无检测**—静默 HTTP 400 | 令牌计数 + 溢出警告 |
| 4 | Provider 瞬时错误 (429/5xx) | **致命**—无重试 | 指数退避重试 |
| 5 | Model 流挂起 | **无限期阻塞** | 30s 超时中断 |
| 6 | Tool 执行有错误输入 | **`input as never`** 静默通过 | Zod 验证拒绝 |
| 7 | 用户 `/skills` → 使用技能 | **零执行**—仅清单 | 正文加载 + 触发词匹配 |
| 8 | 用户配置 Hook | **零拦截**—仅 doctor 显示 | PreToolUse 触发 |
| 9 | 用户 `/mcp doctor` | **仅 `--version`** | 真实 tools/list + tools/call |
| 10 | Agent fork 后台 | **假标志**—永远 running | 真异步执行 |
| 11 | 终端色彩 | **零 ANSI**—全部灰色 | 错误红/警告黄/成功绿 |
| 12 | 工具输出截断 | 提示 `Full log: path` 但无命令 | `/details` 可展开 |
| 13 | `linghun --version` (Windows) | 正常 | 不变 |
| 14 | 状态栏信息密度 | 缺 4 项关键指标 | 补 context%/rate limit |
| 15 | 损坏 settings.json | **崩溃** | 回退到默认配置 |

---

## 10. Final Recommendation

### 10.1 是否建议暂停实测：**是**

Phase 15 Beta 不应在 FIX-A1 到 FIX-H5 完成前进入实测。

### 10.2 总修复量估算

| 类别 | 项目数 | 预估范围 |
|------|--------|---------|
| Must Fix (阻塞 Beta) | 27 | 大范围—涉及会话/工具/provider/TUI/Agent/5 系统 |
| Should Fix (同轮) | 12 | 中范围—性能/配置/Windows/测试 |
| Defer (Phase 15.5) | 10 | 压缩/Hook 完整/Workflow/Agent 通信 |

### 10.3 修复后预期

- Phase 00-14 代码层面达到 CCB 成熟主链路质量
- Phase 15 Beta 可进入真实项目实测
- TYPE-SHELL 系统全部转为 REAL 最小实现
- 会话连续性 + 令牌管理到位

### 10.4 下一步命令模板

```text
你是 Linghun 项目的工程型助手。执行 Phase 00-18 Design + Runtime Overdesign Full Audit V2 的 One-shot Remediation Plan。

依据：F:\Linghun\PHASE_00_18_DESIGN_RUNTIME_OVERDESIGN_FULL_AUDIT.md §7

硬约束：本轮一次性完成 FIX-A1 到 FIX-H5。不进入 Phase 15 Beta / 15.5 / 16+。不新增抽象/helper/wrapper。不改变现有行为。不复制 CCB 源码。

执行顺序：
A组(会话连续性): A1→A2→A3
B组(Tool加固): B1→B2→B3→B4
C组(Provider弹性): C1→C2→C3→C4
D组(TUI结构+Gates): D1→D2→D3
E组(TYPE-SHELL→REAL): E1→E2→E3
F组(Agent修复): F1→F2
G组(UX增强): G1→G2→G3
H组(资源/可靠性): H1→H2→H3→H4→H5

每步完成后运行: pnpm test && pnpm typecheck && pnpm build
```

---

## Appendix A: 审计方法论

### 已执行审计维度 (14 Agent)

1. Tool Lifecycle & Execution — `packages/tools/src/index.ts` + `packages/tui/src/index.ts` 工具执行段
2. Permission & Security — `decidePermission()` + `permission-presenter.ts`
3. Session/Context/Compact — `session-store.ts` + `jsonl.ts` + 系统提示构建
4. Error Handling & Resilience — try/catch 全覆盖 + normalizeProviderError
5. MCP/Skills/Workflows/Plugins/Hooks — 5 个系统的完整执行路径追踪
6. Agent/Background-task — AgentRun 生命周期 + 后台任务状态机
7. Output/UX/Status-line — writeStatus + formatError + 工具输出 + i18n
8. Testing & Verification — 10 个 .test.ts 文件 + CI + 冒烟脚本
9. Cache/Index/Memory — 9 维哈希 + MCP CLI 集成 + 内存持久化
10. Streaming & Provider — SSE 解析 + 错误分类 + 工具调用解析
11. Config & Model Routing — Schema 验证 + 7 角色路由 + Provider 解析链
12. Build/Packaging/Deps — Monorepo 结构 + 包导出 + 依赖审计
13. Windows Compatibility — 路径/Shell/信号/CRLF/编码
14. Performance & Resource — 启动路径 + 内存 + I/O 模式 + 大规模行为

### CCB 只读参考文件

- `F:\ccb-source\src\Tool.ts` (814 行)
- `F:\ccb-source\src\commands.ts` (841 行)
- `F:\ccb-source\src\services\tools\toolExecution.ts` (1832 行)
- `F:\ccb-source\src\components\StatusLine.tsx`
- `F:\ccb-source\src\components\permissions/`

### 索引使用

- codebase-memory-mcp 索引：1170 nodes, 2108 edges
- 用于跨文件调用链追踪和架构理解
- 未覆盖区域 fallback 到 Grep/Read

---

## Appendix B: 通过项汇总 (35 项确认达 CCB 成熟度)

| 类别 | 项目 |
|------|------|
| **Provider** | SSE 增量组装 + 最终验证、Chat/Responses 双解析器、trailing slash 正确、DeepSeek 自有 adapter 合理 |
| **Config** | 默认值覆盖全面、env var 优先级链清晰、route doctor 诊断完整 |
| **Build** | 零外部运行时依赖、纯 ESM、Monorepo 无循环依赖、零 @ts-ignore |
| **Tools** | 工具错误不会崩溃会话、工具输出有 summary/preview/truncation 分级 |
| **Windows** | 路径规范化全面、CRLF 容忍完整、UTF-8+GB18030 回退、无 hardcode Unix-ism、双 bin 入口 |
| **Performance** | Cache 历史有界 (200)、MCP/索引懒加载、进程清理(除 Exit 外)基本正确 |
| **Testing** | `/verify` 命令完整、Verification Runner 成熟（10min 超时/日志/证据/进度）|
| **Memory** | 持久化正确、JSON 文件存储、启动加载 + 排序 |
| **Cache** | 9 维 SHA-256 哈希完整、命中率追踪准确、写入令牌 3 字段变体兼容 |
| **Security** | 默认模式正确阻止 Bash/Write/Edit 静默执行、路径遍历拒绝、基础 Bash 黑名单 |
| **i18n** | 中文输出自然流畅、GB18030 stdin 回退 |

## Appendix C: 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| V1 | 2026-05-19 | 初始报告: 4 Critical + 6 High + 6 Medium + 3 Low |
| V2 | 2026-05-19 | 14 维度 Agent 深挖: 新增 22 Critical + 26 High + 10 Medium + 35 Pass |
