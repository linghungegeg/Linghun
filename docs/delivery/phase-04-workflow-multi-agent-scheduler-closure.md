# Phase 4 Workflow Multi-Agent Scheduler Closure

> 阶段：Phase 4（Workflow 真多智能体调度闭环，本轮闭环条目；不覆盖早期 `phase-04-tui-mvp.md`）
> 日期：2026-06-04
> 工作目录：`F:\Linghun`
> 状态：done; focused/local validation only
> 边界：未进入 mailbox/team 协议、teammate foreground、Windows Terminal backend、Phase 5/6；未新增第二套 workflow/agent/job 框架；未改 provider/model/env/permission mode。

## 目标

让现有 `RunWorkflow` 从串行 proposal/runner 收口为可审计、受依赖和 cap 控制的 workflow 多智能体调度闭环：

- `RunWorkflow` 明确接收 `agents`、`multiAgent`、`runningCap`、`teamName`。
- planner 对复杂、审计、多切片任务产出明确 independent slices 或 durable `/job` target。
- bridge 的 `runningCap` / `runnableSlots` 不只停留在 proposal，执行层也按 cap 调度。
- `runWorkflowPlanSteps` 从串行 for-await 升级为依赖 + cap batch executor，只并发明确 `independent && canRunInParallel` 的 slice。
- 多 worker mutating 执行复用现有 `/job --multi-agent` durable job batch，不复制 job scheduler。
- resource guard 区分 workflow 内合法 agent 并发与全局重任务互斥。

## 本阶段范围

本轮只改现有 TUI workflow/agent/job 路径：

- `RunWorkflow` tool schema 与 parse。
- workflow planner / schema / bridge。
- `runWorkflowPlanSteps` batch executor。
- `/fork` workflow-owned agent 标记和 resource guard 例外。
- `/job` 现有 durable batch 的 `agents` 与 `runningCap` 拆分传递。
- focused regression tests。

不新增 mailbox、team protocol、teammate foreground、Windows Terminal backend、第二套 scheduler 或新权限模式。

## Source-Level Reality Check

### Existing implementation

- `packages/tui/src/model-loop-runtime.ts` 已有 `RunWorkflow` tool definition。
- `packages/tui/src/index.ts` 已有 `runWorkflowSteps` / `runWorkflowPlanSteps` / workflow transcript events / background task state / `executeWorkflowStep`。
- `packages/tui/src/workflow-plan-schema.ts` 已有 `WorkflowSlice.dependsOnSliceIds`、budget、targetRuntime、projection 和 validation。
- `packages/tui/src/workflow-planner-entry.ts` 已有 conservative workflow planner 和 bridge preview。
- `packages/tui/src/workflow-agent-runtime-bridge.ts` 已把 workflow slice 转为主链 `/fork`、`/job`、`/agents`、verification、details proposal。
- `packages/tui/src/job-agent-command-runtime.ts` 与 `packages/tui/src/job-runtime.ts` 已有 `/job --multi-agent` durable job batch、`Promise.all` agent pool、requested/explicit running cap + resource guard 动态裁剪、`/fork`、`/agents`、background lifecycle；后续按 CCB 行为参考移除了 hidden fixed 20 agent cap。
- `packages/tui/src/index.ts` 已有 `checkResourceGuard` / `checkBackgroundStartGuard`、全局后台 cap、kind cap 和 heavy mutex。

### Gaps closed

- RunWorkflow 输入未显式记录多智能体意图。
- planner 对复杂/审计/多切片 goal 没有显式 independent parallel slices。
- bridge 暴露 cap 但 runner 原本仍串行。
- `runWorkflowPlanSteps` 未按依赖/cap batch。
- workflow 内合法 agent 并发会被同 workflow 的 running agent heavy guard 误挡。
- `agents=4,runningCap=2` 曾有被混成一个数字的风险；本轮拆成 requested worker count 与 running cap。

### Minimal touch points

- `packages/tui/src/model-loop-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/tui-data-types.ts`
- `packages/tui/src/workflow-plan-schema.ts`
- `packages/tui/src/workflow-planner-entry.ts`
- `packages/tui/src/workflow-agent-runtime-bridge.ts`
- `packages/tui/src/job-runtime.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- focused tests in the same TUI source area

### Forbidden duplicate systems

- 不新建 workflow scheduler。
- 不新建 agent runtime。
- 不新建 job scheduler。
- 不绕过 Start Gate、permission pipeline、resource guard、background status、transcript、failure learning。
- 不复制外部源码或 CCB 内部实现。

## 已完成功能

- `RunWorkflow` schema 新增 `agents`、`multiAgent` / `multi_agent`、`runningCap` / `running_cap`、`teamName` / `team_name`。
- `parseRunWorkflowToolInput` 解析上述字段，正整数向下取整，并由 `agents > 1` 推导 `multiAgent=true`。
- `workflow_start` transcript 记录 `agents`、`multiAgent`、`runningCap`、`teamName`，tool result data 也回写这些字段。
- `WorkflowSlice` 新增并规范化 `independent`、`canRunInParallel`；projection details 显示 `dependsOn` 和 `parallel`。
- schema validation 要求 `canRunInParallel=true` 必须显式 `independent=true`。
- planner 对复杂、审计、多智能体、多切片 goal 生成两个无依赖、可并发的探索 slice。
- mutating 多 worker slice 优先生成 existing durable `/job run` target，而不是复制 `/fork` scheduler。
- workflow budget / slice budget 拆分 `requestedAgents` 与 `maxRunningAgents`，确保 `agents=4,runningCap=2` 表示计划 4 个 worker、最多并发 2 个。
- bridge 暴露 `runnableSlots`，并在 `/job` request 中携带 `requestedAgents` 和 `runningCap`。
- nested workflow `/job` 派发传入 `--multi-agent --agents <n> --running-cap <cap>`，复用 existing durable job batch。
- `runWorkflowPlanSteps` 改为依赖 + cap batch executor；batch 内使用 `Promise.all`，只有 `independent && canRunInParallel` 的 readonly slice 能同 batch 并发。
- blocked / failed / cancelled / stale 仍走 existing `finishWorkflowRun`、failure learning、background task 状态收口。
- `BackgroundTaskState.workflowRunId` 标记 workflow-owned agent；`WorkflowStepState` 记录 `dependsOnSliceIds`、`independent`、`canRunInParallel`、`batchId`。
- resource guard 对同 workflow 的 active agent 不再误触发 agent kind cap / heavy mutex；全局后台 cap 仍生效。
- workflow executor 在 `/fork` 前额外检查同 workflow active agent 是否达到 `runningCap`，避免自定义 `/fork` slice 绕过 workflow cap。

## 使用方式

模型工具 / natural workflow 可传：

```json
{
  "goal": "复杂审计 workflow 多智能体分片实现",
  "agents": 4,
  "multiAgent": true,
  "runningCap": 2,
  "teamName": "workflow-team"
}
```

可见路径仍复用现有命令：

```text
/workflows plan <goal>
/workflows run <goal>
/job run <goal> --multi-agent --agents 4 --running-cap 2
/background
/details background <id>
/job status <id>
/job report <id>
```

## 涉及模块

- Model tool schema：`packages/tui/src/model-loop-runtime.ts`
- TUI workflow runner / tool parse / transcript / resource guard：`packages/tui/src/index.ts`
- TUI state types：`packages/tui/src/tui-data-types.ts`
- Workflow schema/projection/validation：`packages/tui/src/workflow-plan-schema.ts`
- Planner：`packages/tui/src/workflow-planner-entry.ts`
- Bridge：`packages/tui/src/workflow-agent-runtime-bridge.ts`
- Durable job parse/runtime：`packages/tui/src/job-runtime.ts`
- Agent/job command runtime：`packages/tui/src/job-agent-command-runtime.ts`

## 关键设计

- `agents` 是计划 worker 总数；`runningCap` 是同一 workflow/job 内最多同时运行的 agent 数。
- workflow 只做规划、依赖、派发和聚合状态；真正 multi-worker mutating 执行交给 existing `/job --multi-agent` durable job batch。
- 并发必须显式：只有 `independent=true` 且 `canRunInParallel=true` 的 slice 可进入同一 batch。
- dependency 完成条件只接受 `completed` 或 `partial`；blocked/failed/cancelled/stale 立即保守收口。
- 同 workflow active agent 不再触发 heavy mutex，但仍受 workflow running cap 和全局后台 cap 控制。
- 完成 workflow/job lifecycle 不等于 PASS evidence；验证 PASS 仍由 existing verification/evidence gate 决定。

## 配置项

- 无新增配置项。
- 无 provider/model/env/key 变更。
- 无 permission mode 变更。
- `/job --running-cap <n>` 为现有 `/job` 命令参数；未传时按 requested agents 派生，并受 resource guard 动态限制；不再有固定 3/4/20 agent cap。

## 命令

本阶段未新增 CLI 启动入口；`linghun` / Windows `Linghun` 入口兼容性不在本轮改动范围。

本轮新增/强化的操作命令：

```text
/workflows run <goal>
/job run <goal> --multi-agent --agents <n> --running-cap <n>
/background
/details background <id>
```

## 测试与验证

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | PASS |
| `corepack pnpm exec vitest run packages/tui/src/model-loop-runtime.test.ts packages/tui/src/workflow-plan-schema.test.ts packages/tui/src/workflow-agent-runtime-bridge.test.ts packages/tui/src/workflow-planner-entry.test.ts` | PASS：4 files / 227 tests |
| `corepack pnpm exec vitest run packages/tui/src/job-runtime.test.ts -t "explicit running cap separately"` | PASS：1 test / 49 skipped |
| `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "RunWorkflow multi-agent\|independent workflow slices\|dependent workflow slices\|workflow /fork slices\|one slice\|nested /job workflow steps\|workflow-owned running agent\|resource caps"` | PASS：10 tests / 576 skipped |
| `git diff --check` | PASS，只有 `packages/tui/src/index.test.ts` CRLF 将被 Git 触碰时转 LF 的 warning |

中间验证说明：

- 曾运行包含完整 `job-runtime.test.ts` 的组合命令；其中 `workflow-planner-entry.test.ts` 的新增断言已修复并复跑通过。
- 完整 `job-runtime.test.ts` 当前仍有 2 条预算显示格式断言与实际输出字符串不一致（期望 `tokens=...`，实际为 `tokens ...`），这是既有 budget display 测试/文案不一致，和本轮 `--running-cap` 逻辑无关；本轮未扩大范围修复。

## 性能结果

- workflow runner batch executor 对明确 independent readonly slices 使用 `Promise.all`，cap 控制 batch 大小。
- durable `/job --multi-agent` 继续复用 existing cap pool，不引入第二套调度器或额外常驻后台进程。
- 未做真实大规模性能压测；本阶段为 focused/local regression closure。

## 已知问题

- `runnableSlots` 是 bridge 审计字段；执行层按同一 `runningCap` 重新计算 batch runnable set，不直接消费 bridge result 对象。
- schema 当前禁止 `independent=true` 同时声明依赖，因此暂不表达“依赖完成后 fan-out 的 independent slice”。本轮只承诺无依赖 independent slices 的并发闭环。
- `selectRunnableWorkflowBatch` 遇到第一个 non-executable runnable candidate 会保守 blocked workflow，不跳过它继续跑后续 slice。
- 完整 `job-runtime.test.ts` 有 2 条既有 budget display 格式断言失败，未纳入本轮修复范围。

## 不在本阶段处理

- mailbox / team protocol。
- teammate foreground。
- Windows Terminal backend。
- Remote channels。
- Native runner。
- 第二套 workflow/agent/job scheduler。
- provider/env/model/permission mode 改造。
- Beta PASS、smoke-ready、open-source-ready 宣告。

## 下一阶段衔接

- 是否进入 Phase 5/6 由用户确认。
- 若后续进入 mailbox/team protocol，应继续复用现有 `AgentRun.mailbox`、`/agents send`、transcript、background task，不复制 agent runtime。
- 若后续进入 teammate foreground 或 Windows Terminal backend，应先做 Source-Level Reality Check，再裁决 DONE / DEFERRED / NOT-DO。

## 开发者排查入口

- `RunWorkflow` schema：`packages/tui/src/model-loop-runtime.ts`
- `RunWorkflow` parse：`packages/tui/src/index.ts` `parseRunWorkflowToolInput`
- workflow runner：`packages/tui/src/index.ts` `runWorkflowPlanSteps` / `selectRunnableWorkflowBatch` / `executeWorkflowStep`
- resource guard：`packages/tui/src/index.ts` `checkResourceGuard` / `checkBackgroundStartGuard`
- `/fork` workflow owner：`packages/tui/src/job-agent-command-runtime.ts` `handleForkCommand`
- durable job cap parse：`packages/tui/src/job-runtime.ts` `parseJobRunOptions`
- planner：`packages/tui/src/workflow-planner-entry.ts`
- bridge：`packages/tui/src/workflow-agent-runtime-bridge.ts`
- schema：`packages/tui/src/workflow-plan-schema.ts`
- tests：对应 `*.test.ts` 同名文件

## 状态栏与统计口径

- `/background` 和 footer 仍只展示 workflow/job/agent 摘要。
- slice/agent 细节进入 workflow transcript、background/details、job report/logs。
- workflow completed 只代表 lifecycle completed；结果仍按 existing partial / blocked / failed / cancelled / stale 语义收口，不等于 PASS。

## 学习成本与渐进披露

- 默认用户仍通过 `RunWorkflow`、`/workflows run`、`/job run --multi-agent` 使用能力。
- 新的 `runningCap` 字段主要作为模型工具输入和 `/job` 高级参数出现，不改变首屏输出。
- 失败时使用现有 `/background`、`/details background <id>`、`/job report <id>` 排查。

## TUI 渲染稳定性

- 主屏只输出 workflow start/completion 摘要。
- batch 内多个 slice 不逐条刷主屏；step details 进入 transcript/background。
- 本轮未改 input/status/hints 渲染层。
- 未新增长 stdout；nested job 详情仍走 existing log/report paths。

## 主输出与日志分层

- 主屏：workflow 摘要、blocked/failure 简短原因。
- details/transcript：slice `dependsOn`、parallel、batchId、evidence refs、tool/job/agent result。
- durable job：state/log/report/full-output 继续走现有路径。
- raw tool result、完整 transcript、完整 evidence 不进入普通主屏。

## 阶段 Verdict

- verdict：PASS for focused/local Phase 4 workflow multi-agent scheduler closure。
- 是否允许进入下一阶段：no，必须等待用户确认。
- P0/P1/P2 风险分类：无本轮阻塞 P0/P1；P2 为 `runnableSlots` 审计字段未直接被 runner 对象消费、fan-out DAG 表达暂不支持。
- 阻塞项：无。
- 用户下一步审核点：查看 diff、运行 focused tests 或决定是否进入 Phase 5/6。

## 真实改动文件

代码：

- `packages/tui/src/index.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/job-runtime.ts`
- `packages/tui/src/model-loop-runtime.ts`
- `packages/tui/src/tui-data-types.ts`
- `packages/tui/src/workflow-agent-runtime-bridge.ts`
- `packages/tui/src/workflow-plan-schema.ts`
- `packages/tui/src/workflow-planner-entry.ts`

测试：

- `packages/tui/src/index.test.ts`
- `packages/tui/src/job-runtime.test.ts`
- `packages/tui/src/model-loop-runtime.test.ts`
- `packages/tui/src/workflow-agent-runtime-bridge.test.ts`
- `packages/tui/src/workflow-plan-schema.test.ts`
- `packages/tui/src/workflow-planner-entry.test.ts`

文档：

- `docs/delivery/phase-04-workflow-multi-agent-scheduler-closure.md`
- `docs/delivery/README.md`

生成物：

- 无。

用户已有 diff / 非本轮证据：

- `.md`
- `docs/stress/`
- `report.md`
- `test-model-set.sh`

以上 untracked 在本轮未修改、未删除、未回滚。

## 运行时事实

- provider/model：本轮未运行 live provider；测试 context 使用 `deepseek-v4-flash` fixtures。
- permission mode：主要覆盖 `default` / `full-access` workflow 测试；未新增 permission mode。
- index status：未使用 codebase-memory MCP；本线程工具发现未返回 codebase-memory tools。源码事实通过 `rg` 和精读关键源码确认。
- cache/usage 来源：未新增 cache/usage 统计。
- 配置来源：未改配置文件。
- 脱敏/密钥风险：无新密钥、无 env 输出、无 provider secret 读取。

## 后台/复查任务状态反馈

- workflow run 仍创建 `BackgroundTaskState(kind="job")` 摘要任务。
- workflow-owned agent background task 新增 `workflowRunId`，用于 guard 区分和 transcript 审计。
- durable job 仍写 state/log/report/full-output。
- blocked / failed / cancelled / stale 不生成 PASS evidence。

## 语言与 i18n 口径

- 新增/改动的主要结构化字段保持英文。
- 用户可见中文文案沿用现有 workflow/background 文案。
- 新增的 workflow cap blocked detail 目前为英文细节字符串，进入 workflow step summary；未新增完整 i18n 字典。

## 参考核对

本阶段实际读取的 Linghun 文档：

- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-14-skills-workflow.md`
- `F:\Linghun\docs\delivery\phase-14C-multi-agent-baseline-closure.md`
- `F:\Linghun\docs\delivery\phase-17-agent-workflow-ecosystem-closure.md`
- `F:\Linghun\docs\delivery\phase-17a-local-durable-jobs-virtual-agent-concurrency.md`
- `F:\Linghun\docs\delivery\phase-15-5b-resource-task-lifecycle.md`
- `F:\Linghun\docs\delivery\phase-agent-stop-display-closure.md`

本阶段实际参考的本地 CCB / CCB Dev Boost / 社区项目文件：

- 未读取 `F:\ccb-source`。本轮用户明确要求“只基于现有源码事实推进”，且实现目标是复用 Linghun existing workflow/agent/job source facts；无外部行为差异需要裁决。

行为参考 vs 自研实现：

- 行为参考来自 Linghun 已有 Phase 1-3/14/17 closure 文档和源码。
- 进入 Linghun 自研实现的是：RunWorkflow 输入审计、workflow slice 并发语义、batch executor、workflow-owned agent guard、durable job cap 参数传递。
- 未复制可疑源码实现、反编译痕迹、内部 API、专有遥测或内部服务逻辑。

## 交接摘要

```yaml
phase: "Phase 4 Workflow Multi-Agent Scheduler Closure"
status: "complete"
next_phase: "Phase 5/6 only after explicit user confirmation"
forbidden_next_without_confirmation:
  - "mailbox/team protocol"
  - "teammate foreground"
  - "Windows Terminal backend"
  - "remote channels"
  - "native runner"
  - "second workflow/agent/job scheduler"
evidence_refs:
  source:
    - "packages/tui/src/index.ts"
    - "packages/tui/src/workflow-plan-schema.ts"
    - "packages/tui/src/workflow-planner-entry.ts"
    - "packages/tui/src/workflow-agent-runtime-bridge.ts"
    - "packages/tui/src/job-runtime.ts"
    - "packages/tui/src/job-agent-command-runtime.ts"
  tests:
    - "packages/tui/src/index.test.ts"
    - "packages/tui/src/job-runtime.test.ts"
    - "packages/tui/src/model-loop-runtime.test.ts"
    - "packages/tui/src/workflow-plan-schema.test.ts"
    - "packages/tui/src/workflow-agent-runtime-bridge.test.ts"
    - "packages/tui/src/workflow-planner-entry.test.ts"
validation:
  typecheck: "PASS: corepack pnpm --filter @linghun/tui exec tsc --noEmit"
  focused_tests: "PASS: workflow/model/schema/bridge/planner/index/job-running-cap focused tests"
  diff_check: "PASS with CRLF warning only"
index_status:
  codebase_memory_mcp: "unavailable in this thread"
  fallback: "rg + source reading"
permission_mode: "unchanged; existing default/full-access test contexts"
provider_model: "no live provider; test fixtures use deepseek-v4-flash"
budget_usage: "no explicit token budget; no live model usage measured"
known_risks:
  - "runnableSlots is audit output; runner recomputes runnable batch from cap/deps"
  - "fan-out DAG after dependencies is deferred"
  - "full job-runtime.test has unrelated budget display format failures"
```
