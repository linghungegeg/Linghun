# Closure Phase 2 - Task Surface Closure

## 阶段目标

按 `LINGHUN_CLOSURE_PHASED_TASKS.md` Phase 2 收口 Task 主面状态可见性。范围只覆盖 `taskRuntimeSummary` 渲染、verification 主面摘要、permission 拒绝/取消可见性复核、Plain/Ink footer 与 Task surface 语义对齐；不进入 Closure Phase 3 agent/job/workflow runtime 调度闭环，也不声明全局成熟。

## 已完成功能

- Task runtime summary 渲染：
  - `taskRuntimeSummary` 不再是死投影，Ink Task 主面会在 transcript 区顶部渲染轻量 runtime summary。
  - Plain task renderer 同步渲染同一份 `taskRuntimeSummary`，避免 Plain/Ink 语义漂移。
  - 后台 `blocked`、`stale`、`failed`、`timeout`、`cancelled`、`completed` 继续走现有低噪聚合，不泄漏 task id、worker 名、raw evidence、logPath、endpoint 或 runner debug 字段。
  - `completed` 仍是 `info`，不会被显示成 PASS。
- `/verify` 结果 Task 化：
  - `/verify` 当次完成后的主屏输出改为结论 + 耗时 + 下一步 + `/verify last` 详情入口。
  - PASS / FAIL / PARTIAL / CANCELLED / TIMEOUT / STALE 仍由 `VerificationReport.status` 统一决定。
  - 完整命令、每条命令状态、log path、unverified 明细仍保留在 `formatVerificationReport()`，通过 `/verify last` 查看。
  - verification evidence 仍由既有 `recordVerificationEvidence()` 写入，不把 evidence/log 全量塞进主屏。
- 权限拒绝/取消反馈：
  - 复核现有 `denialFeedback` view-model：deny/cancel 会生成 `partial` block，不标 PASS。
  - 复核 `executePermissionDeny()`：拒绝/取消会记录 evidence/tool_result，写入主屏人话结果；有 continuation 时继续回灌模型，无 gateway 时写 system warning。
  - 细节仍通过 permission details、`/details`、system event/evidence 审计路径展开。
- Plain/Ink Task footer 对齐：
  - footer 仍只承载 permission/model/cache/index/reasoning/context/cost 等短信号。
  - runtime/background 状态进入 `taskRuntimeSummary`，不塞进 footer 的 workspaceStatus/runtimeStatus。
  - Plain renderer 和 Ink renderer 都消费同一份 view-model 字段，避免同一状态在不同模式下含义漂移。

## 使用方式

- 默认 Task 主面：提交任务、出现后台状态或 verification 后自动进入 Task 面。
- 查看后台详情：`/background`
- 查看验证摘要：`/verify`
- 查看验证完整详情：`/verify last`
- 查看完整运行时/证据入口：`/details`
- 权限卡详情：权限 pending 时选择 `details` 或按对应详情操作。

## 涉及模块

- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/plain-renderer.ts`
- `packages/tui/src/verification-command-runtime.ts`
- `packages/tui/src/slash-command-runtime.ts`
- `packages/tui/src/shell/view-model.test.ts`
- `packages/tui/src/verify-command.test.ts`

## 关键设计

- `taskRuntimeSummary` 作为主面独立轻量块渲染，不混入 `view.blocks` transcript 历史，避免污染 transcript pruning、scroll selection 和 CommandPanel 详情入口。
- `/verify` 主屏使用 `formatVerificationTaskSummary()`；完整报告仍由 `formatVerificationReport()` 保留，`formatVerificationLast()` 继续走完整报告。
- Plain renderer 复用同一 `formatBlockLines()` 渲染 runtime summary，避免新增第二套 block presenter。
- 本阶段只改变状态展示和默认输出粒度，不改变 verification runner、permission pipeline、background task state 或 agent/job/workflow 调度。

## 配置项

本阶段没有新增配置项、环境变量、依赖或构建脚本。

## 命令

- `corepack pnpm --filter @linghun/tui exec tsc --noEmit`
- `corepack pnpm --filter @linghun/tui exec vitest run src/shell/view-model.test.ts src/verify-command.test.ts`

## 测试与验证

- TUI typecheck：PASS。
- TUI focused tests：2 files PASS，352 tests PASS。
- 新增/更新覆盖：
  - Ink + Plain Task 主面真实渲染 `taskRuntimeSummary`。
  - stale/cancelled/blocked/completed 等后台状态主面低噪可见，不泄漏内部名称。
  - no-color plain mode 也显示 stale summary，但不显示可恢复假信号。
  - `/verify` 主面摘要不含命令/log evidence；完整 report 仍保留命令/log/unverified 明细。

## 性能结果

- 未新增模型调用。
- 未新增后台任务。
- Task runtime summary 只渲染一条聚合块；没有新增全量日志或 evidence 主屏渲染。

## 已知问题

- `/verify` 仍是现有 Verification Runner 语义；本阶段只调整默认主屏呈现，不改变 runner timeout、命令计划或 process guard。
- permission 拒绝/取消的主屏反馈复用现有输出链路；本阶段没有新增独立 PermissionResultPanel。
- 子智能体调查线程在电脑重启后返回 `not_found`，已采用本地源码和 focused tests 完成验证；Herschel 的 `taskRuntimeSummary` 死投影发现已纳入修复。

## 不在本阶段处理的内容

- 不进入 Closure Phase 3 agent/job/workflow runtime cap、状态映射和 evidence 粒度收口。
- 不新增第二套 Task surface、verification runner、permission runtime 或 background scheduler。
- 不拆 `index.ts`、`slash-command-runtime.ts`、`job-agent-command-runtime.ts` 等大文件。
- 不关闭 details/debug/evidence/log 能力。
- 不声明 Beta PASS、真实 full smoke、open-source-ready 或全局成熟。

## 下一阶段衔接

下一阶段是 Closure Phase 3 - Agent / Job / Workflow Runtime Closure。进入前应从源码事实开始确认 agent/job/workflow 的 cap、状态映射、evidence 和核心执行闭环；Phase 2 PASS 只证明 Task 主面状态呈现闭环，不证明 runtime 调度已全局成熟。

## 开发者排查入口

- Ink Task 渲染：`packages/tui/src/shell/components/ShellApp.tsx`
- Plain Task 渲染：`packages/tui/src/shell/plain-renderer.ts`
- Task runtime summary 生成：`packages/tui/src/shell/view-model.ts`
- Verification runner/report：`packages/tui/src/verification-command-runtime.ts`
- `/verify` slash route：`packages/tui/src/slash-command-runtime.ts`
- Permission deny/cancel：`packages/tui/src/permission-approval-runtime.ts`

## 参考核对

- 实际读取 Linghun 文档：
  - `LINGHUN_CLOSURE_PHASED_TASKS.md`
  - `docs/delivery/README.md`
  - `docs/delivery/phase-closure-01-trust-boundary.md`
- 实际参考源码：
  - `packages/tui/src/shell/view-model.ts`
  - `packages/tui/src/shell/components/ShellApp.tsx`
  - `packages/tui/src/shell/plain-renderer.ts`
  - `packages/tui/src/verification-command-runtime.ts`
  - `packages/tui/src/slash-command-runtime.ts`
  - `packages/tui/src/permission-approval-runtime.ts`
  - `packages/tui/src/details-status-runtime.ts`
  - `packages/tui/src/runtime-status-presenter.ts`
  - `packages/tui/src/shell/models/footer-view.ts`
- CCB / CCB Dev Boost / 社区参考：
  - 本阶段只按既有 Linghun 文档中的 CCB handfeel 目标做行为参考：主面低噪、状态明确、详情可展开。
  - 未复制 CCB 或任何可疑源码实现。

## Handoff Packet

- verdict: PASS
- nextPhase: Closure Phase 3 - Agent / Job / Workflow Runtime Closure
- mustNotDo:
  - 不把 Phase 2 PASS 当作全局成熟。
  - 不跳过 Phase 3 的 Source-Level Reality Check。
  - 不新增第二套 runner/workflow/permission/task surface。
  - 不用 CommandPanel 替代主面状态。
  - 不关闭 `/details`、`/verify last`、日志或 evidence。
- evidenceRefs:
  - `packages/tui/src/shell/view-model.test.ts`
  - `packages/tui/src/verify-command.test.ts`
  - `packages/tui/src/shell/components/ShellApp.tsx`
  - `packages/tui/src/shell/plain-renderer.ts`
  - `packages/tui/src/verification-command-runtime.ts`
  - `packages/tui/src/slash-command-runtime.ts`
- validation:
  - `@linghun/tui tsc --noEmit`: PASS
  - `@linghun/tui focused vitest src/shell/view-model.test.ts src/verify-command.test.ts`: PASS, 352 tests
- indexStatus: codebase-memory MCP tool unavailable in this Codex thread; used `rg`, source reads, and focused tests instead.
- permissionMode: local development, direct file edits in workspace.
- provider/model: Codex coding agent in local workspace; no product provider route changed.
- budgetUsed: no explicit token budget; no runtime cost changes.
