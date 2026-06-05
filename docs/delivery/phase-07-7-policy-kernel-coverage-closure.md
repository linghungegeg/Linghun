# Phase 7.7 Policy Kernel Coverage Closure / 中枢调度覆盖闭环

## 阶段目标

在 Phase 7.6 已接入 typed `PolicyDecision` 的基础上，把主链关键系统的现有状态纳入 Policy Kernel 的 inputs/outputs。重点是覆盖闭环：扩展 signal、轻提示、`system_event` 和测试证据，不新增第二套 scheduler、permission engine、provider router、workflow runner 或 UI 面板。

本阶段只推进 Phase 7.7，不进入 DH1-DH4、真实 smoke、Phase 17/18 或开源发布。

## Source-Level Reality Check

### existing implementation

- `packages/tui/src/meta-scheduler-runtime.ts` 已有 `evaluateMetaScheduler`、typed `PolicyDecision`、`PolicyHint`、`formatMetaSchedulerDirective` 和 `verifyFailureLearningContract`。
- `packages/tui/src/model-stream-runtime.ts` 已在 `createModelSystemPrompt` 前调用 `evaluateMetaScheduler`，通过 `context.notifications` 与 `system_event` 消费 policy；provider cooldown/fallback 仍由 `provider-loop-runtime.ts` 决定。
- `packages/tui/src/model-tool-runtime.ts` 工具执行前仍走 `decidePermission`、`pendingLocalApproval`、architecture drift/preflight、tool evidence 和 failure learning。
- `packages/tui/src/tui-permission-runtime.ts` / `permission-policy-engine.ts` 保持真实权限边界：policy classifier 只做只读分类，`decidePermission` 仍负责 allow/ask/deny。
- `packages/tui/src/workflow-command-runtime.ts` 保持 workflow `phaseGateConfirmed` 和 per-tool permission 双层 gate；workflow/job/agent 完成不等于 PASS evidence。
- `packages/tui/src/verification-command-runtime.ts` 保持真实 verification report；cancelled/timeout/stale/partial 不生成 PASS。
- memory/failure/architecture/platform/budget 已有现成状态来源：`context.memory`、`context.failureLearning`、`context.currentArchitectureCard`、`detectTerminalCapability()`、`context.cache`、`context.roleUsage`、`context.toolResultBudgetState`。

### gaps

- Phase 7.6 的 `PolicyDecision` 只有路线摘要字段，缺少 `permissionSignal`、`modelRouteSignal`、`verificationSignal`、`memorySignal`、`failureSignal`、`architectureSignal`、`platformSignal`、`budgetSignal` 这种一等覆盖信号。
- 三条 Phase 7.7 必需中英文轻提示尚未覆盖：权限风险、Windows-safe、focused verification。
- `model-tool-runtime.ts` 已有真实权限/工具/verification/failure 事实，但没有给下一轮 policy 留下明确的事件级反馈摘要。
- sanitizer 未显式覆盖新增 signal 标签。

### minimal touch points

- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/model-tool-runtime.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/meta-scheduler-runtime.test.ts`
- `packages/tui/src/model-prompt-runtime.test.ts`
- `packages/tui/src/index.test.ts`
- `docs/delivery/README.md`

### forbidden duplicate systems

- 不新增第二套 scheduler / permission engine / provider router / workflow runner。
- 不新增 PolicyPanel / KernelPanel / AGI 面板。
- 不让 policy hint 直接授权 Write/Edit/MultiEdit/Bash、workflow、agent、index mutating 或 verification。
- 不把 memory、failure learning、policy hint、workflow/job/agent completion 当 PASS evidence。
- 不绕过 `pendingLocalApproval`、`decidePermission`、final-answer gate、workflow gate、architecture guard。

## 已完成功能

- 扩展 `PolicyDecision`，新增八类一等 signal：
  - `permissionSignal`: `permissionMode`、`recentDenied`、`recentDeniedCount`、`expectedMutating`、`requireExplicitGate`
  - `modelRouteSignal`: `role`、`provider`、`model`、`fallback`、`providerCooldown`、`providerFailure`、`suggestedRole`
  - `verificationSignal`: `required`、`recommendedLevel`、`reason`
  - `memorySignal`: `accepted`、`acceptedCount`、`candidateCount`、`autoLearningActive`
  - `failureSignal`: active failure 数量、severity 数量、category 列表
  - `architectureSignal`: architecture card 是否存在、是否提醒 guard、是否 pending drift
  - `platformSignal`: platform、shell family、terminal tier、Windows-safe hint
  - `budgetSignal`: context pressure、role budget stop、tool_result artifact pressure
- `model-stream-runtime.ts` 继续在 system prompt 前生成 policy decision，并把现有 context 状态传入 signal。
- 轻提示新增并测试中英文：
  - 中文：`策略：检测到权限风险，写入前会请求确认。`
  - English: `Strategy: permission risk detected; write actions will ask before running.`
  - 中文：`策略：Windows 环境，优先使用兼容命令。`
  - English: `Strategy: Windows environment; using compatible commands first.`
  - 中文：`策略：建议先做 focused verification。`
  - English: `Strategy: focused verification is recommended before completion.`
- `model-stream-runtime.ts` 的 policy `system_event` 增加 role suggestion、verification level、permission gate、Windows-safe 摘要。
- `model-tool-runtime.ts` 增加只读事件级 `policy_tool_feedback`：记录 permission verdict、architecture drift、tool failure、verification result，供后续 policy/诊断读取；不参与 allow/deny 分支。
- `model-prompt-runtime.ts` sanitizer 增加 `permissionSignal`、`modelRouteSignal`、`verificationSignal`、`memorySignal`、`failureSignal`、`architectureSignal`、`platformSignal`、`budgetSignal` 标签清理。
- `index.test.ts` 中一个既有 `/index status/doctor/refresh/check` 用例在本机稳定超过默认 5 秒；只补到 `10_000` timeout，与相邻 `/index refresh` 慢测一致，不改运行逻辑。

## 使用方式

用户无需新命令。普通自然语言请求仍进入原模型主链；Policy Kernel 只在现有 NotificationStack 里显示轻提示，并在 transcript 中写入 `system_event`。

示例：

- 修改/写入类请求：主屏提示写入前会请求确认。
- Windows 环境且本轮涉及写入/验证/workflow/agent/命令/路径/执行风险：主屏提示优先使用兼容命令。
- 修改后验证类请求：主屏提示建议 focused verification。

## 涉及模块

- 代码：`packages/tui/src/meta-scheduler-runtime.ts`、`packages/tui/src/model-stream-runtime.ts`、`packages/tui/src/model-tool-runtime.ts`、`packages/tui/src/model-prompt-runtime.ts`
- 测试：`packages/tui/src/meta-scheduler-runtime.test.ts`、`packages/tui/src/model-prompt-runtime.test.ts`、`packages/tui/src/index.test.ts`
- 文档：`docs/delivery/phase-07-7-policy-kernel-coverage-closure.md`、`docs/delivery/README.md`

## 关键设计

- Policy Kernel 仍是现有 `meta-scheduler-runtime.ts` 的 typed projection，不是新系统。
- `model-stream-runtime.ts` 只消费已有 context 状态；不绕过 `getSelectedModelRuntime`、`resolveRuntimeFallback` 或 role route helper。
- `suggestedRole` 只是建议：`verifier` 用于高风险完成/PASS claim，`planner` 用于 workflow/agent 路线；本阶段不自动切 role 或模型。
- `verificationSignal.recommendedLevel` 是建议，不假跑 verification；真实执行仍走 `RunVerification`、workflow verification 或用户运行命令。
- `model-tool-runtime.ts` 的 `policy_tool_feedback` 只是 system event，不是权限 gate。
- `platformSignal.windowsSafeHint` 保留为底层平台信号；Windows-safe 主屏轻提示只在本轮确实涉及写入、验证、workflow/agent、命令/路径或执行风险时显示。
- Windows-safe 只影响提示和策略摘要，实际 Bash/PowerShell 安全仍由既有工具、权限和命令分类处理。

## 配置项

无新增配置项。

## 命令

无新增用户命令。

## 测试与验证

已运行：

- `corepack pnpm --filter @linghun/tui typecheck` → PASS
- `corepack pnpm exec vitest run packages/tui/src/meta-scheduler-runtime.test.ts --no-color` → PASS, 20/20
- `corepack pnpm exec vitest run packages/tui/src/model-prompt-runtime.test.ts packages/tui/src/model-doctor-runtime.test.ts packages/tui/src/permission-policy-engine.test.ts packages/tui/src/verification-command-runtime.test.ts --no-color` → PASS, 234/234
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Policy|Strategy|策略|permission|权限|Windows|verification|final answer|workflow gate|provider cooldown|FailureLearning" --no-color` → PASS, 81/81 selected
- `corepack pnpm exec biome check packages/tui/src/meta-scheduler-runtime.ts packages/tui/src/model-stream-runtime.ts packages/tui/src/model-tool-runtime.ts packages/tui/src/model-prompt-runtime.ts --no-color` → FAIL: 当前 Biome 版本不接受该位置的 `--no-color`
- `corepack pnpm exec biome check packages/tui/src/meta-scheduler-runtime.ts packages/tui/src/model-stream-runtime.ts packages/tui/src/model-tool-runtime.ts packages/tui/src/model-prompt-runtime.ts` → PASS

P2 小修复追加验证：

- `corepack pnpm --filter @linghun/tui typecheck` → PASS
- `corepack pnpm exec vitest run packages/tui/src/meta-scheduler-runtime.test.ts packages/tui/src/model-prompt-runtime.test.ts --no-color` → PASS, 31/31
- `corepack --% pnpm exec vitest run packages/tui/src/index.test.ts -t "Policy|Strategy|策略|Windows|verification|permission" --no-color` → PASS, 71/71 selected
- `corepack pnpm exec biome check packages/tui/src/meta-scheduler-runtime.ts packages/tui/src/model-stream-runtime.ts packages/tui/src/model-prompt-runtime.ts` → PASS

## 性能结果

Policy signal 仍为同步纯函数投影。新增 signal 只读取 `TuiContext` 现有状态、terminal capability 缓存结果和已有 budget/cache 状态；不新增模型调用、不触发索引刷新、不触发 verification、不启动 agent/workflow。

## 已知问题

- `lastToolFailure` / `lastProviderFailure` 生命周期仍沿用既有实现；本阶段不重构失败状态清理。
- `suggestedRole` 仅记录建议，不自动切换 role/model。
- `budgetSignal.usageNearLimit` 目前消费 `roleUsage.budgetStop`，不是新成本系统。
- P2 Windows-safe 轻提示过宽已修复：普通聊天和普通源码事实核对仍保留底层 `platformSignal.windowsSafeHint`，但不再显示 Windows-safe 主屏轻提示；写入/验证/workflow/agent/命令/路径/执行风险仍显示。
- Biome 指定命令中的 `--no-color` 与当前本地 Biome CLI 参数位置不兼容；同文件集不带该参数已通过。

## 不在本阶段处理的内容

- 不新增 `/details` policy 面板。
- 不新增第二套 scheduler、permission engine、provider router、workflow runner、verification runner。
- 不默认多开 agent/workflow。
- 不自动接受 memory。
- 不做本地模型训练、LoRA、二进制协议。
- 不碰 DH1-DH4、开源 LICENSE/README。
- 不纳入既有未跟踪项 `docs/delivery/phase-6.7-full-source-maturity-audit.md`、`docs/stress/`、`test-model-set.sh`。

## 下一阶段衔接

可由用户决定是否建立稳定点。后续如继续增强，只建议在现有 `/details` 或 `/status` 中展示短 policy 摘要；不得新增面板或第二套执行系统。

## 开发者排查入口

- typed decision: `evaluateMetaScheduler`
- signal 生成: `createPolicyDecision`
- 主链消费: `sendMessage`、`appendRuntimePolicyHint`
- 轻提示: `enqueuePolicyHints`
- tool 反馈: `appendPolicyToolFeedback`
- 主屏脱敏: `sanitizeMainScreenLeakage`
- 真实权限边界: `decidePermission`、`pendingLocalApproval`
- workflow gate: `phaseGateConfirmed`、`decideWorkflowStepCapability`
- final gate: `evaluateFinalAnswerClaims`、`runArchitectureAndCompletenessFinalGate`

## 参考核对

- 实际读取 Linghun 文档：`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`、`docs/delivery/README.md`、`docs/delivery/phase-07-6-policy-kernel-mvp.md`。
- 实际读取 Linghun 源码：`meta-scheduler-runtime.ts`、`model-stream-runtime.ts`、`model-tool-runtime.ts`、`tui-model-runtime.ts`、`provider-loop-runtime.ts`、`permission-policy-engine.ts`、`tui-permission-runtime.ts`、`permission-continuation-runtime.ts`、`verification-command-runtime.ts`、`workflow-command-runtime.ts`、`job-agent-command-runtime.ts`、`tui-memory-runtime.ts`、`failure-learning-runtime.ts`、`architecture-runtime.ts`、`architecture-boundary.ts`、`terminal-readiness-runtime.ts`、`shell/terminal-capability.ts`、`usage-stats-presenter.ts`、`tool-result-budget.ts`。
- 实际参考：三位只读子智能体完成源码现实核对，分别确认 policy 主结构、权限/工具 gate、memory/failure/architecture/platform/budget 信号来源。
- 行为参考只进入 Linghun 自研实现：signal 字段、轻提示、system_event、测试。
- 未读取或复制 CCB 可疑源码实现；未复制内部专有实现。

## 成品级结构化 handoff packet

- phase: `Phase 7.7 Policy Kernel Coverage Closure`
- verdict: `PASS`
- canProceed: `true, but stop for user review before any next phase`
- scopeDone: typed policy signal coverage, stream context wiring, tool event feedback, sanitizer/test/docs; P2 Windows-safe light hint noise fixed
- scopeExcluded: no new panel, no second scheduler, no permission/provider/workflow/final gate replacement, no DH1-DH4
- changedFiles:
  - code: `packages/tui/src/meta-scheduler-runtime.ts`, `packages/tui/src/model-stream-runtime.ts`, `packages/tui/src/model-tool-runtime.ts`, `packages/tui/src/model-prompt-runtime.ts`
  - tests: `packages/tui/src/meta-scheduler-runtime.test.ts`, `packages/tui/src/model-prompt-runtime.test.ts`, `packages/tui/src/index.test.ts`
  - docs: `docs/delivery/phase-07-7-policy-kernel-coverage-closure.md`, `docs/delivery/README.md`
  - generated: none
  - preExistingDiff: untracked `docs/delivery/phase-6.7-full-source-maturity-audit.md`, `docs/stress/`, `test-model-set.sh` left untouched
- validation: typecheck PASS; meta-scheduler PASS; prompt/model-doctor/permission/verification PASS; broad index selected regression PASS; P2 Windows-safe focused regression PASS; biome same-file-set PASS without unsupported `--no-color`
- risks: no P0/P1 introduced; Biome CLI `--no-color` incompatibility documented
- runtimeFacts: provider/model not changed; permission mode not changed; index rebuild not triggered; cache/usage only read from existing state
- evidenceRefs: tests listed above, source invariant tests for permission/final/workflow gates
- indexStatus: no index refresh/rebuild performed by this stage work
- permissionMode: local code edits only; product permission pipeline untouched
- modelProvider: current Codex thread provider/model not written into Linghun runtime
- budgetUsed: no explicit local token/cost budget set
- nextAction: user may review diff and decide whether to create a stable point
