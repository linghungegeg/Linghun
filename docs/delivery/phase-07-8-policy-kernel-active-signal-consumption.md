# Phase 7.8 Policy Kernel Active Signal Consumption Closure

## 阶段目标

本阶段关闭 Policy Kernel 对主链信号消费不足的缺口，并把 memory 自动学习默认从 `off` 调整为 `active`。这里的 `active` 只表示 candidate-only learning：自动生成候选记忆，不自动接受、不写入长期记忆、不注入 prompt。长期记忆仍必须由用户显式执行 `/memory accept <id>` 并通过既有权限确认。

本阶段只做 Phase 7.8，不进入下一阶段，不处理 DH1-DH4，不触碰 `WHITEPAPER*.md` 和既有未跟踪项。

## Source-Level Reality Check

### existing implementation

- `packages/tui/src/tui-state-runtime.ts` 的 `createMemoryState()` 已从磁盘加载 candidate / accepted / rejected / disabled / retired，并通过 `loadMemoryLearningMode()` 读取 user memory 下的 `learning-state.json`。
- `packages/tui/src/tui-memory-runtime.ts` 的 `createControlledMemoryInjection()` 只读取 `context.memory.accepted`，candidate / rejected / disabled / retired 不进入 prompt。
- `packages/tui/src/memory-command-runtime.ts` 的 `/memory accept <id>` 已走 `requestMemoryMutationApproval()`，候选接受后才写入 accepted；`/memory learn off` 已持久化用户选择。
- `packages/tui/src/model-stream-runtime.ts` 已在普通自然语言进入模型主链前调用 `runAutoLearningOnTurnEnd()`，但此前默认 learning mode 为 `off`。
- `packages/tui/src/meta-scheduler-runtime.ts` 已有 typed `PolicyDecision`，覆盖 permission/modelRoute/verification/memory/failure/architecture/platform/budget signals，并通过 `context.notifications` 和 `system_event` 被主链消费。
- `packages/tui/src/model-stream-runtime.ts` 的 `createMetaSchedulerInput()` 是现有 Policy input 拼装入口；没有另一个 `buildMetaSchedulerState` 或第二套 Policy store。
- `NotificationStack` 已存在，Policy hint 通过 `context.notifications` 复用现有轻提示链路。

### gaps

- memory 默认值仍是 `off`，与本阶段要求的默认 candidate-only learning 不一致。
- system prompt 的 `MemoryBoundary` 仍写 `noAutoLearning`，默认 active 后会自相矛盾。
- Policy 已有 verification intent 推导，但未显式消费最近 `context.lastVerification.status`。
- Policy 已有 permission mode / recent denied，但未显式标出 pending approval。
- Policy 已有 `backgroundTasks` / `workflow.activeRun`，但缺少一等 runtime occupancy signal 来提示已有 agent/job 占用。
- 自动学习候选生成后没有主屏一次性轻提示；用户需要主动进 `/memory review` 才能发现。

### minimal touch points

- `packages/tui/src/tui-state-runtime.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/meta-scheduler-runtime.test.ts`
- `packages/tui/src/model-prompt-runtime.test.ts`
- `packages/tui/src/index.test.ts`
- `docs/delivery/README.md`

### forbidden duplicate systems

- 不新增 PolicyPanel / KernelPanel / AGI 面板。
- 不新增第二套 scheduler、permission engine、provider router、workflow runner、agent/job scheduler 或 verification runner。
- 不自动执行 workflow/agent/job。
- 不自动 accept memory。
- 不自动跑重验证。
- 不绕过 permission engine、workflow gate、final answer gate、architecture guard、provider breaker。
- memory / failure learning / workflow / job / agent 仍不能作为 PASS evidence。

## 已完成功能

- `memory.learningMode` 默认从 `off` 改为 `active`，缺省来源仍标记为 `default`。
- 保留 `/memory learn off`：用户显式关闭后写入 `learning-state.json`，后续 reload 使用 `persisted` 的 `off`。
- 自动学习仍只生成 candidate：
  - `runAutoLearningOnTurnEnd()` 不调用模型。
  - candidate 写入 review queue。
  - candidate 不进入 `createControlledMemoryInjection()`。
  - accepted memory 仍需 `/memory accept <id>`。
- prompt 边界从 `noAutoLearning` 调整为 `candidateOnlyLearning; noAutoAccept`，避免默认 active 后误导模型。
- 自动学习生成候选时只通过现有 NotificationStack 轻提示一次：`记忆：已生成 N 条候选；用 /memory review 查看。`
- Policy Kernel 新增/强化信号消费：
  - verification：消费 `lastVerification.status`，`fail/timeout/stale` 提升到 `full` 建议，`partial/cancelled/skipped` 至少建议 `focused`。
  - permission：显式记录 `pendingApproval`。
  - workflow/agent/job：新增 `runtimeSignal`，记录 running agents/jobs、workflow status、resource cap pressure。
  - memory：继续消费 accepted count、candidate count、autoLearningActive。
  - failure learning：继续只作为风险提示。
  - provider/context：继续消费 cooldown/fallback、role budget stop、tool_result budget pressure。
- model-stream 主链把最近 verification、pending approval、agent/job running count、workflow stale/blocked/running 状态传入 Policy。
- sanitizer 增加 `runtimeSignal`，防止模型把内部 signal 标签刷到普通主屏。

## 使用方式

- 默认自动学习候选生成已开启：普通输入里出现稳定偏好/习惯时，Linghun 会生成 candidate。
- 查看候选：`/memory review`
- 查看统计：`/memory stats`
- 接受长期记忆：`/memory accept <id>`
- 关闭自动候选生成：`/memory learn off`
- 重新开启：`/memory learn on`

## 涉及模块

- 代码：`packages/tui/src/tui-state-runtime.ts`、`packages/tui/src/model-prompt-runtime.ts`、`packages/tui/src/model-stream-runtime.ts`、`packages/tui/src/meta-scheduler-runtime.ts`
- 测试：`packages/tui/src/meta-scheduler-runtime.test.ts`、`packages/tui/src/model-prompt-runtime.test.ts`、`packages/tui/src/index.test.ts`
- 文档：`docs/delivery/phase-07-8-policy-kernel-active-signal-consumption.md`、`docs/delivery/README.md`

## 关键设计

- 默认 active 不是长期记忆写入，只是 candidate-only learning。
- candidate 不注入 prompt；`createControlledMemoryInjection()` 仍只读 accepted。
- Policy 只生成策略建议、轻提示和 system_event，不替代真实 gate。
- verification signal 影响 `recommendedLevel` 和轻提示，不假装验证已经发生。
- workflow/agent/job signal 只提醒已有占用，不自动启动/停止/恢复后台任务。
- failure learning 只作为风险信号，不作为当前任务失败、修复或 PASS 证据。
- provider cooldown/fallback 仍由 provider breaker / provider loop 决定，Policy 只消费状态。

## 配置项

无新增配置项。用户选择通过 `/memory learn off|on` 持久化在现有 user memory `learning-state.json`。

## 命令

- `/memory review`
- `/memory stats`
- `/memory learn off`
- `/memory learn on`
- `/memory accept <id>`

## 测试与验证

已运行：

- `corepack pnpm --filter @linghun/tui typecheck` → PASS
- `corepack pnpm exec vitest run packages/tui/src/meta-scheduler-runtime.test.ts packages/tui/src/model-prompt-runtime.test.ts --no-color` → PASS, 32/32
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Policy|Strategy|策略|memory|Memory|learning|FailureLearning|verification|workflow|agent|permission|provider cooldown" --no-color` → PASS, 182 selected / 457 skipped
- `corepack pnpm exec biome check packages/tui/src/tui-state-runtime.ts packages/tui/src/tui-memory-runtime.ts packages/tui/src/memory-command-runtime.ts packages/tui/src/meta-scheduler-runtime.ts packages/tui/src/model-stream-runtime.ts` → PASS

自查：

- `rg` 检查源码中的默认自动接受 true/yes 痕迹 → 未发现；源码仅保留否定文案或显式 accept 路径。
- `rg` 确认 `createControlledMemoryInjection()` 仍从 `context.memory.accepted` 取值，candidate 只出现在 review/stats/命令状态和测试里。
- 普通聊天/Windows-safe 降噪边界沿用 Phase 7.7 测试：普通聊天不显示 Windows-safe 提示。

## 性能结果

- 默认 active 的候选提取是本地规则匹配，不调用模型。
- Policy signal 投影仍是同步纯函数，不新增 provider 请求、索引刷新、verification run、agent/job/workflow 执行。
- 轻提示走现有 `context.notifications`，单 key 去重，不新增 UI 面板或长日志输出。

## 已知问题

- `lastToolFailure` / `lastProviderFailure` 生命周期仍沿用既有实现，本阶段不重构。
- `lastVerificationStatus` 只影响建议级别和轻提示，不会自动运行验证。
- `/memory learn on` 在默认 active 下仍可执行，用于把 active 状态明确写为 persisted。

## 不在本阶段处理的内容

- 不处理 DH1-DH4。
- 不进入真实 full smoke / Beta / Phase 17 / Phase 18。
- 不修改 `WHITEPAPER.md` / `WHITEPAPER.en.md`。
- 不处理既有未跟踪项：`docs/delivery/phase-6.7-full-source-maturity-audit.md`、`docs/stress/`、`test-model-set.sh`。
- 不修改 provider/model/env、依赖、构建脚本或发布流程。

## 下一阶段衔接

阶段完成后停止在用户审核点。下一阶段是否继续由用户确认；不得自动进入 DH1-DH4、Phase 17、真实 smoke 或发布相关任务。

## 开发者排查入口

- 默认 memory state：`createMemoryState()`
- learning mode 持久化：`loadMemoryLearningMode()`、`writeMemoryLearningMode()`
- 自动候选生成：`runAutoLearningOnTurnEnd()`
- prompt 注入边界：`createControlledMemoryInjection()`、`formatControlledMemoryForModel()`、`createModelSystemPrompt()`
- Policy 计算：`evaluateMetaScheduler()`
- Policy input 拼装：`createMetaSchedulerInput()`
- 轻提示：`enqueuePolicyHints()`、`enqueueMemoryCandidateHint()`
- 主屏脱敏：`sanitizeMainScreenLeakage()`

## 参考核对

- 实际读取 Linghun 文档：`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`、`docs/delivery/README.md`、`docs/delivery/phase-07-6-policy-kernel-mvp.md`、`docs/delivery/phase-07-7-policy-kernel-coverage-closure.md`。
- 实际读取 Linghun 源码：`tui-state-runtime.ts`、`tui-memory-runtime.ts`、`memory-command-runtime.ts`、`model-prompt-runtime.ts`、`model-stream-runtime.ts`、`meta-scheduler-runtime.ts`、`tui-data-types.ts`、`tui-context-runtime.ts`、`verification-command-runtime.ts`、`job-agent-command-runtime.ts`。
- 实际参考：两个只读子智能体分别完成 memory/prompt 边界与 Policy/meta-scheduler 主链信号的源码现实核对。
- codebase-memory MCP 工具本会话未暴露；按项目规则降级为 `rg` 和关键源码精读，未触发索引 rebuild/refresh。
- 本阶段只参考 Linghun 自身源码事实和既有阶段文档，未读取或复制 CCB 可疑源码实现。

## 成品级结构化 handoff packet

- phase: `Phase 7.8 Policy Kernel Active Signal Consumption Closure`
- verdict: `PASS`
- canProceed: `true, but stop for user review before any next phase`
- scopeDone: default candidate-only memory learning active; `/memory learn off` persisted; candidate still not prompt-injected; Policy consumes latest verification/pending approval/background occupancy; docs updated
- scopeExcluded: DH1-DH4, WHITEPAPER files, existing untracked items, new panels, second runtimes, automatic workflow/agent/job/verification
- changedFiles:
  - code: `packages/tui/src/tui-state-runtime.ts`, `packages/tui/src/model-prompt-runtime.ts`, `packages/tui/src/model-stream-runtime.ts`, `packages/tui/src/meta-scheduler-runtime.ts`
  - tests: `packages/tui/src/meta-scheduler-runtime.test.ts`, `packages/tui/src/model-prompt-runtime.test.ts`, `packages/tui/src/index.test.ts`
  - docs: `docs/delivery/phase-07-8-policy-kernel-active-signal-consumption.md`, `docs/delivery/README.md`
  - generated: none
  - preExistingDiff: `WHITEPAPER.md`, `WHITEPAPER.en.md`, `docs/delivery/phase-6.7-full-source-maturity-audit.md`, `docs/stress/`, `test-model-set.sh` left untouched
- validation: typecheck PASS; focused meta/prompt tests PASS; selected index regression PASS; biome check PASS; auto-accept true/yes source check no matches
- risks: no P0/P1 introduced; P2 residual risk is that `lastVerificationStatus` is advisory only by design
- runtimeFacts: provider/model not changed; permission mode not changed; index rebuild/refresh not triggered; cache/usage only read from existing state
- evidenceRefs: tests and source files listed above
- indexStatus: codebase-memory MCP unavailable in this session; no refresh/rebuild performed
- permissionMode: local code edits only; Linghun runtime permission pipeline untouched
- modelProvider: current Codex thread provider/model not written into Linghun runtime
- budgetUsed: no explicit local token/cost budget set
- nextAction: user reviews diff and decides whether to create a stable point or choose the next phase
