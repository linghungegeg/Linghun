# Pre-Smoke Slice D.6: Architecture Anti-Code-Blob Guard

> 日期：2026-05-25
> 范围：Architecture Runtime directive + Model System Prompt 工程结构约束升级
> 模式：focused local implementation，无真实 provider 调用，无 commit

---

## Git Status（开始时）

```
?? docs/audit/pre-real-smoke-independent-source-audit.md
?? docs/delivery/pre-smoke-slice-e-strong-foundation-integration-check.md
```

---

## Source-Level Reality Check

### 实际读取的文件

| 文件 | 审计深度 |
|------|----------|
| `packages/tui/src/architecture-runtime.ts` | 全文精读（416 行） |
| `packages/tui/src/architecture-runtime.test.ts` | 全文精读（293 行） |
| `packages/tui/src/index.ts` | 分段精读（imports, createModelSystemPrompt 区域 14570-14590） |
| `packages/tui/src/index.test.ts` | 分段精读（createModelSystemPrompt 相关测试、en-US 测试） |
| `docs/delivery/pre-smoke-slice-e-strong-foundation-integration-check.md` | 前 100 行 |
| `docs/audit/pre-real-smoke-independent-source-audit.md` | 全文精读（100 行）。用途：核对 Opus 独立审计中关于 code blob（P2-1: index.ts 15k+ 行 split plan）、runner hardening（P2-2/P2-7）、cache debounce（P2-3）、provider circuit breaker（P2-5）的边界。D.6 只吸收 anti-code-blob prompt/runtime 约束，不处理 D.7 性能优化、runner/provider/cache hardening。 |

---

## Actual Code Changes

### 1. `packages/tui/src/architecture-runtime.ts`

**函数：`createArchitectureRuntimeDirective()`**

新增 `AntiCodeBlob=` 行，位于 `MaturityDefaults=` 和 `LongTaskHint=` 之间。

语义覆盖：
- 新功能/新页面/新流程/长任务/UI 开发/跨文件改动时，默认不堆进已有巨型文件
- 避免 god file / code blob / 超长函数（>200行）/ 深层嵌套（>3层）/ 无边界全局状态
- UI/状态/I-O/provider/runner/doctor/permission/cache/index/verification 职责边界分清
- 优先复用项目已有模块、helper、presenter、runtime，不新建第二套系统
- 如果必须改大文件，保持局部最小改动并说明原因
- 不为了优雅新增无收益抽象
- 每个改动要有可验证边界：focused tests、typecheck、check
- 明确声明"这不是授权大重构，仍遵守最小改动、权限管道和 evidence/verifier 边界"

### 2. `packages/tui/src/index.ts`

**函数：`createModelSystemPrompt()`**

- 将原来中英混杂的单行 `OutputStyle=` 拆分为按 `context.language` 选择的双语版本
- 新增 `EngineeringStructure=` 行，同样按 `context.language` 分别输出 en-US / zh-CN 版本
- 修复原始字符串中 ASCII 双引号与中文引号冲突（`"成熟"` → `\u201C成熟\u201D`）

**en-US EngineeringStructure 内容：**
> Do not pile logic into existing large files by default. Avoid god files, code blobs, overly long functions (>200 lines), deep nesting (>3 levels), and unbounded global state. Keep responsibility boundaries clear: UI/state/IO/provider/runner/permission/cache/verification. Prefer reusing existing project modules, helpers, presenters, and runtimes over creating a second system. Do not add zero-benefit abstractions for elegance. Each change must have a verifiable boundary (focused tests, typecheck, check). This is not authorization for large refactors.

**zh-CN EngineeringStructure 内容：**
> 默认不把逻辑堆进已有大文件。避免 god file、code blob、超长函数（>200行）、深层嵌套（>3层）、无边界全局状态。职责边界保持清晰：UI/状态/IO/provider/runner/permission/cache/verification。优先复用项目已有模块、helper、presenter、runtime，不新建第二套系统。不为了优雅新增无收益抽象。每个改动要有可验证边界（focused tests、typecheck、check）。这不是授权大重构。

### 3. `packages/tui/src/architecture-runtime.test.ts`

新增测试：`includes anti-code-blob engineering structure constraints in the directive`

验证 directive 包含：
- `AntiCodeBlob=`
- `god file` / `code blob` / `超长函数` / `深层嵌套` / `无边界全局状态`
- `优先复用项目已有模块` / `不新建第二套系统`
- `可验证边界` / `不是授权大重构` / `最小改动`

### 4. `packages/tui/src/index.test.ts`

新增 3 个测试：
1. `includes engineering structure constraints in zh-CN system prompt` — 验证中文 prompt 包含 `EngineeringStructure=`、`god file`、`code blob`、`超长函数`、`不是授权大重构`
2. `includes engineering structure constraints in en-US system prompt` — 验证英文 prompt 包含 `EngineeringStructure=`、`god files`、`code blobs`、`deep nesting`、`not authorization for large refactors`
3. `includes architectureDirective in system prompt when provided` — 验证 architectureDirective 参数被拼入 system prompt

---

## What Is Real

以下约束已真实注入到运行时 system prompt / architecture directive：

| 约束 | 注入位置 | 触发条件 |
|------|----------|----------|
| `EngineeringStructure=` | `createModelSystemPrompt()` | 每次模型请求（无条件） |
| `AntiCodeBlob=` | `createArchitectureRuntimeDirective()` | Architecture Runtime 触发时（跨文件/新功能/UI/bug fix 等） |
| `OutputStyle=`（双语版） | `createModelSystemPrompt()` | 每次模型请求（无条件） |

---

## What Is Still Prompt-Level Guidance

- 这些约束是 **prompt-level guidance**，不是 linter、AST gate 或静态阻断器
- 模型可能在极端情况下仍然写出大文件或深层嵌套
- 不能保证模型永不违反这些约束
- 真正的强制需要后续 D.7+ 阶段的静态分析或 lint 规则（不在本阶段范围）
- 当前实现的价值：将"默认写成熟代码"从用户每次手动提醒降级为底层默认行为

---

## Verification Results

| 命令 | 结果 |
|------|------|
| `corepack pnpm exec vitest run packages/tui/src/architecture-runtime.test.ts packages/tui/src/index.test.ts` | 211 tests ALL PASS（26 + 185） |
| `corepack pnpm typecheck` | PASS（零错误） |
| `corepack pnpm check` | PASS（80 files, no fixes needed） |
| `git diff --check` | clean（无空白问题） |

---

## Boundaries

- 未拆 `packages/tui/src/index.ts`
- 未做 D.7 性能优化
- 未新增 lint 系统、AST gate、配置项、第二套架构系统
- 未改 provider、runner、cache、permission、TUI 业务逻辑
- 未改用户可见主屏文案（OutputStyle 语义不变，只是按语言分行）
- 未进入真实 provider smoke
- 未调用真实 provider
- 未 commit

---

## Final Statement

D.6 Architecture Anti-Code-Blob Guard 已完成 focused/local/mock 验证。211 个测试全部通过，typecheck 和 biome check 均无错误。

约束已注入到 system prompt（EngineeringStructure，无条件）和 architecture directive（AntiCodeBlob，触发时）。这是 prompt-level guidance，不是静态阻断器。
