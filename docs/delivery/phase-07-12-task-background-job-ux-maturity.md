# Phase 7.12 Task / Background / Job UX Maturity Closure

## 阶段目标

Phase 7.12 只补 Task / Background / Job 的用户可见体验和状态呈现成熟度。Phase 7.11 已完成调度现实核对与验证路由语义，本阶段不新增第二套 task/job/agent/workflow scheduler，不重写 `/job`、`/agents`、`/workflows`、`/verify`，不修改 provider/model/key/env route。

本阶段完成后仍不声明真实 full smoke、Beta PASS、smoke-ready 或 open-source-ready。

## Source-Level Reality Check

### Existing implementation

- `packages/tui/src/job-agent-command-runtime.ts` 已有 `/background`、`/job list|status|report|logs|pause|resume|cancel`、durable job hydrate/recovery、bounded worker loop、job background task 写回和 `/agents` 入口。
- `packages/tui/src/job-runtime.ts` 已有 `DurableJobState`、`DurableJobStatus`、job list/status/report/logs 格式化、state/log/report/fullOutputPath artifact 边界。
- `packages/tui/src/job-runner-presenter.ts` 已将 durable job 投影到统一 `BackgroundTaskState`，并提供 `/background` row/details、`/details background`、`/details output` presenter。
- `packages/tui/src/shell/view-model.ts` 已有 StatusFooter / task runtime summary / background summary 的主屏投影。
- `packages/tui/src/command-panel-runtime.ts` / `packages/tui/src/details-status-runtime.ts` 已有 CommandPanel 与 explicit `/details` panel 装配器。
- `packages/tui/src/workflow-command-runtime.ts` 已有 `/workflows status` 与 workflow background task 投影。

### Gaps closed

- `/job list/status/report/logs` 的状态文案统一为 lifecycle/result 分层；`completed` 只表示 lifecycle ended，不显示为 verification PASS。
- `/job status` 保持状态和下一步动作；`/job report` 才展示完整报告摘要、证据边界和 artifact refs；`/job logs` 展示 bounded tail，不把长日志刷主屏。
- `/job pause/resume/cancel` 对 sleeping、running、blocked、stale、completed、cancelled、timeout 等状态返回明确文案；terminal 重复操作不写假 transition。
- `/background` Ink 面板继续复用 CommandPanel，按 kind 分组，主行只展示 title/status/progress/current step/next action；details 才显示 `/details`、`/job report`、log/output refs。
- 主屏 `taskRuntimeSummary` 收敛为单条低噪摘要，只显示计数与通用下一步，不展示 raw evidence、tool_result、gateId、schema、endpoint、runner internals、完整私有绝对路径或长日志。
- explicit `/details` 默认分支复用现有 CommandPanel 装配器；主屏摘要和展开详情分层，detailsText 做路径脱敏与旧 PASS wording normalize。
- workflow completed / job completed / agent completed 均保持 lifecycle 语义，不提升为 verification evidence。

### Minimal touch points

- `packages/tui/src/job-runtime.ts`
- `packages/tui/src/job-runner-presenter.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/tui-agent-job-runtime.ts`
- `packages/tui/src/workflow-command-runtime.ts`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/command-panel-runtime.ts`
- `packages/tui/src/details-status-runtime.ts`
- `packages/tui/src/job-runtime.test.ts`
- `packages/tui/src/job-runner-presenter.test.ts`
- `packages/tui/src/shell/view-model.test.ts`
- `packages/tui/src/index.test.ts`
- `docs/delivery/README.md`
- `docs/delivery/phase-07-12-task-background-job-ux-maturity.md`

### Forbidden duplicate systems

- 未新增第二套 task/job/background/agent/workflow scheduler。
- 未重写 `/job`、`/agents`、`/workflows`、`/verify`。
- 未修改 provider/model/key/env route。
- 未处理 DH1-DH4、WHITEPAPER、docs/stress、img、report.md、test-model-set.sh。
- 未进入 Phase 7.13 情绪模块或 Phase 7.14 重压。
- 未复制 CCB 源码、内部 API、组件结构、遥测或专有实现。

## 已完成功能

- 状态一致性：
  - `running` = active now。
  - `queued` = waiting for execution slot。
  - `sleeping` = paused by user/resource guard。
  - `blocked` = needs a concrete fix before resume。
  - `stale` = lost owner/heartbeat freshness。
  - `cancelled` = stopped by user。
  - `timeout` = hit runtime limit。
  - `completed` = lifecycle ended only。
  - `partial` = incomplete or unverified evidence。
- 主屏低噪：
  - 普通 task/background 主屏只保留一个聚合摘要。
  - 不在主屏暴露 raw/internal/debug/path 字段、完整日志或完整私有绝对路径。
- 详情分层：
  - `/background` 显示分组、状态、当前步骤、下一步动作。
  - `/job status` 显示状态、result、下一步和详情入口。
  - `/job report` 显示报告摘要、证据边界、artifact refs。
  - `/job logs` 只显示 bounded tail 和路径入口。
  - `/details` 默认分支 summary-first，完整正文和 ids 在 detailsText。
- 操作可预期：
  - running pause 会转 sleeping。
  - running resume、sleeping pause 是 no-op，不制造假动作。
  - blocked/stale pause 不改状态，提示 report/logs/resume/cancel 下一步。
  - terminal completed/cancelled/timeout/failed 的 pause/resume/cancel 不改状态，不启动新动作。

## 使用方式

现有命令继续使用：

```text
/background
/job list
/job status <jobId>
/job report <jobId>
/job logs <jobId>
/job pause <jobId>
/job resume <jobId>
/job cancel <jobId>
/agents
/workflows status
/details
/details background <id>
/details output <id>
```

## 涉及模块

- Job runtime/presenter：`packages/tui/src/job-runtime.ts`、`packages/tui/src/job-runner-presenter.ts`
- Job/agent command runtime：`packages/tui/src/job-agent-command-runtime.ts`、`packages/tui/src/tui-agent-job-runtime.ts`
- Workflow status：`packages/tui/src/workflow-command-runtime.ts`
- Shell main-screen summary：`packages/tui/src/shell/view-model.ts`
- CommandPanel/details：`packages/tui/src/command-panel-runtime.ts`、`packages/tui/src/details-status-runtime.ts`
- Focused tests：`packages/tui/src/job-runtime.test.ts`、`packages/tui/src/job-runner-presenter.test.ts`、`packages/tui/src/shell/view-model.test.ts`、`packages/tui/src/index.test.ts`

## 关键设计

- 用户可见状态以 lifecycle/result/evidence 三层解释：lifecycle 说明任务是否结束，result 说明保守结果，verification evidence 才能支撑 PASS 类声明。
- 主屏只承担态势感知，不承担排查全文；完整路径、artifact、log tail、报告和 id 只在 details/report/logs 路径出现。
- `/background` 和 StatusFooter/task summary 共用相同的低噪过滤方向，避免 idle/completed 历史在主屏反复冒泡。
- blocked/stale 不自动恢复，也不伪装为 pause；文案明确让用户先看 report/logs，修复 handoff/owner/heartbeat/resource guard 后再 resume，或 cancel。
- CCB 仅作为行为成熟度参考：状态清楚、低噪摘要、详情展开、取消/恢复可解释。Linghun 实现复用现有 CommandPanel、BackgroundTaskState、DurableJobState、job-runner-presenter 和 view-model。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

本阶段最终验证矩阵：

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui typecheck` | PASS |
| `corepack pnpm exec vitest run packages/tui/src/shell/view-model.test.ts packages/tui/src/job-runtime.test.ts packages/tui/src/runner-runtime.test.ts --no-color` | PASS: 3 files, 392 tests |
| `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "background\|job\|agent\|workflow\|task summary\|status\|report\|logs\|pause\|resume\|cancel\|stale\|blocked\|timeout\|completed\|PASS" --no-color` | PASS: 1 file, 193 passed, 454 skipped |
| `corepack pnpm exec biome check <touched TS/TSX/test files>` | PASS: 12 files |
| `corepack pnpm --filter @linghun/tui build` | PASS |
| `corepack pnpm --filter @linghun/cli build` | PASS |
| `node F:\Linghun\apps\cli\dist\main.js --version` | PASS: `0.1.0` |
| `node F:\Linghun\apps\cli\dist\main.js --help` | PASS: displayed Linghun 0.1.0 help and slash compatibility |

## 性能结果

本阶段只调整渲染、格式化和状态解释逻辑。未新增 provider 请求、模型 summarizer、后台轮询、长日志持久化副本或新的 scheduler。长日志仍走已有 `logPath` / `reportPath` / `fullOutputPath` / artifact 路径。

## 已知问题

- `/agents` 中 `completed/idle` teammate 仍是可复用 teammate 语义，不等同 durable job terminal lifecycle；本阶段未改变 agent runtime lifecycle。
- `/details evidence <id>`、`/details background <id>`、`/details output <id>` 仍是显式排查入口，按用户命令展示必要 id/path/ref；普通主屏不展示这些完整内容。
- 未运行真实 full smoke。

## 不在本阶段处理的内容

- 不新增或替换 scheduler、runner、agent runtime、workflow runtime、verification runner。
- 不修改 provider/model/key/env route。
- 不处理 DH1-DH4、WHITEPAPER、docs/stress、img、report.md、test-model-set.sh。
- 不进入 Phase 7.13 情绪模块、Phase 7.14 重压或 Phase 18。
- 不声明 Beta PASS、smoke-ready、open-source-ready。

## 下一阶段衔接

阶段完成后停止。是否进入后续阶段必须由用户明确确认。

## 开发者排查入口

- `/background`：低噪任务分组面板。
- `/job status <id>`：job 当前 lifecycle/result/next action。
- `/job report <id>`：job 报告摘要、证据边界、artifact refs。
- `/job logs <id>`：bounded log tail。
- `/details background <id>`：background task 详情。
- `/details output <id>`：log/output artifact slice。
- `/agents`、`/agents show <id>`：agent/teammate 状态。
- `/workflows status`：workflow lifecycle/result/steps/evidence boundary。

## 参考核对

- 实际读取 Linghun 文档：
  - `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
  - `LINGHUN_IMPLEMENTATION_SPEC.md`
  - `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
  - `docs/delivery/README.md`
  - `docs/delivery/phase-07-11-task-job-verification-routing-closure.md`
  - `docs/delivery/phase-17a-local-durable-jobs-virtual-agent-concurrency.md`
  - `docs/delivery/pre-smoke-tui-task-panel-maturity.md`
  - `docs/delivery/phase-15-5b-resource-task-lifecycle.md`
  - `docs/delivery/phase-07-10-visible-layer-tool-observation-closure.md`
- 实际读取/复核 Linghun 源码：`job-agent-command-runtime.ts`、`job-runtime.ts`、`job-runner-presenter.ts`、`tui-agent-job-runtime.ts`、`workflow-command-runtime.ts`、`shell/view-model.ts`、`command-panel-runtime.ts`、`details-status-runtime.ts`、相关 focused tests。
- CCB 参考性质：只参考行为成熟度，不复制源码、内部 API、组件结构、遥测或专有实现。
- codebase-memory：本轮 tool discovery 未发现可用 codebase-memory MCP；按仓库规则降级为 `rg` 和源码精读。
- 多智能体复核：只读子智能体 `Averroes` 复核 UX/state/PASS/path 边界，指出 `/details` 默认分支与主屏 summary 过滤缺口；本阶段已用最小补丁收口。

## 成品级结构化 handoff packet

- phase: `Phase 7.12 Task / Background / Job UX Maturity Closure`
- verdict: `focused/local validation complete`
- nextPhase: `等待用户确认；不得自动进入下一阶段`
- completed:
  - `/background` 分组低噪与 details 分层。
  - `/job list/status/report/logs` lifecycle/result/evidence 分层。
  - `/job pause/resume/cancel` no-op/attention/terminal 文案收口。
  - 主屏 task/background summary 低噪聚合。
  - explicit `/details` 默认分支复用 CommandPanel，并保留 details/report/logs 完整排查入口。
  - workflow/job completed 不显示成 verification PASS。
- mustNotDo:
  - 不新增第二套 scheduler/runtime/UI system。
  - 不重写 `/job`、`/agents`、`/workflows`、`/verify`。
  - 不改 provider/model/key/env route。
  - 不处理 DH1-DH4、WHITEPAPER、docs/stress、img、report.md、test-model-set.sh。
  - 不进入 Phase 7.13 / 7.14 / Phase 18。
  - 不声明 full smoke、Beta PASS、smoke-ready、open-source-ready。
- evidence:
  - Final validation matrix 见“测试与验证”。
- indexStatus: codebase-memory MCP 不可用，未 refresh/rebuild。
- permissionMode: 本地开发权限未改变；未 stage、未 commit。
- modelProvider: 未修改 Linghun provider/model route。
- budgetUsage: 未新增 provider/model token 消耗。
- userReviewPoint: 审阅 diff、验证结果和本文件后，由用户决定是否创建稳定点。
