# Phase 7.13 User State Routing / Policy Kernel

## 阶段目标

把瞬时用户状态作为 Policy Kernel 输入信号，驱动调度、验证强度、回复形态和轻提示降噪。本阶段只做底层调度能力，不新增聊天安慰模板，不新增人格系统，不把情绪塞进 prompt 后就算完成。

本阶段不新增 PolicyPanel / EmotionPanel / KernelPanel，不新增第二套 scheduler、permission engine、verification runner、final-answer gate、memory runtime、provider breaker、workflow/job/agent gate。

## Source-Level Reality Check

### 实际读取的文件

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-07-6-policy-kernel-mvp.md`
- `docs/delivery/phase-07-7-policy-kernel-coverage-closure.md`
- `docs/delivery/phase-07-8-policy-kernel-active-signal-consumption.md`
- `docs/delivery/phase-07-10-visible-layer-tool-observation-closure.md`
- `docs/delivery/phase-07-11-task-job-verification-routing-closure.md`
- `docs/delivery/phase-07-12-task-background-job-ux-maturity.md`
- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/final-answer-gate.ts`
- `packages/tui/src/memory-command-runtime.ts`
- `packages/tui/src/failure-learning-runtime.ts`
- `packages/tui/src/verification-command-runtime.ts`
- `packages/tui/src/tui-context-runtime.ts`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/index.test.ts`

codebase-memory 项目 `F-Linghun` 的 MCP 工具本轮未暴露；已按项目规则降级为 `rg`、`Get-Content` 和源码精读。两个只读子智能体分别完成源码现实核对与测试插点扫描，均未改文件。

### Existing implementation

- `meta-scheduler-runtime.ts` 已有 `MetaSchedulerInput`、typed `PolicyDecision`、`evaluateMetaScheduler()`、`formatMetaSchedulerDirective()`、domain-aware `verificationSignal.route`。
- `model-stream-runtime.ts` 已在模型请求前调用 `evaluateMetaScheduler()`，通过 `context.notifications` 和 `system_event` 消费策略，不替代 provider breaker。
- `model-prompt-runtime.ts` 已有 `sanitizeMainScreenLeakage()`，负责清理 `RuntimeStatusForModel`、`PolicyDecision`、`Verification route` 等内部标签。
- `memory-command-runtime.ts` 已有 candidate-only learning：candidate 不自动 accept，不进入 accepted memory prompt 注入。
- `final-answer-gate.ts` / `model-loop-runtime.ts` 已有 final answer claim gate，PASS 类声明必须有 evidence。
- `verification-command-runtime.ts` 已有 `/verify` 报告和 `lastVerification`，cancelled/timeout/stale/partial 不构成 PASS。
- `shell/view-model.ts` 只投影已有 `context.notifications`，没有情绪/用户状态面板。

### Gaps

- 没有 `UserStateDecision` / `userState` / 情绪感知调度信号。
- `PolicyDecision` 缺少用户状态导致的 interaction / verification / detail / notification / memory candidate 计划。
- `frustrated`、`trust_repair`、`confused`、`decisive_command`、`strategic_exploration`、`high_stakes_release` 未影响底层调度。
- sanitizer 未显式过滤 `UserStateDecision`、`interactionPlan`、`verificationPlan`、`notificationPlan`、`confidence` 等字段。

### Minimal touch points

- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/meta-scheduler-runtime.test.ts`
- `packages/tui/src/model-prompt-runtime.test.ts`
- `packages/tui/src/index.test.ts`
- `docs/delivery/README.md`

### Forbidden duplicate systems

- 不新增第二套 scheduler / policy runtime / intent router / provider router / permission engine。
- 不新增第二套 memory / failure learning / final answer gate / verification runner / evidence runtime。
- 不新增 EmotionPanel / UserStatePanel / PolicyPanel。
- 不把 user state、memory、failure learning、job/workflow/agent completed 当 PASS evidence。
- 不触碰 `WHITEPAPER*.md`、`docs/stress`、`img`、`report.md`、`test-model-set.sh`、DH1-DH4。

## 已完成功能

- 新增 `UserStateDecision`，字段包括：
  - `kind`
  - `confidence`
  - `interactionPlan`
  - `verificationPlan`
  - `detailPlan`
  - `notificationPlan`
  - `memoryCandidate`
- 支持状态：
  - `neutral`
  - `frustrated`
  - `trust_repair`
  - `confused`
  - `decisive_command`
  - `strategic_exploration`
  - `high_stakes_release`
- `PolicyDecision` 新增 `userState`，`MetaSchedulerInput` 支持传入或本地分类生成 `UserStateDecision`。
- 用户状态影响底层调度：
  - `frustrated` / `trust_repair`：源码事实优先、加强验证、forbid early PASS、降低轻提示数量。
  - `decisive_command`：`command_first` detail plan，减少背景解释。
  - `confused`：`explain_first`，不把实现类词直接升级为实现推进。
  - `strategic_exploration`：`discussion_only`，不触发 agent/workflow/code execution route。
  - `high_stakes_release`：release gate，追加 `source-facts`、`dirty-tree`、`untracked-files`、`focused-test`、`build`、`stability-boundary`。
- `model-stream-runtime.ts` 的 policy `system_event` 记录 `user_state`、`detail`、`notification`、`memory_candidate`、`route_commands`。
- `context.notifications` 仍复用现有 NotificationStack；只允许 `frustrated`、`trust_repair`、`high_stakes_release` 的低噪策略提示进入主屏。
- `model-prompt-runtime.ts` sanitizer 过滤 `UserStateDecision`、`userState`、`interactionPlan`、`verificationPlan`、`detailPlan`、`notificationPlan`、`memoryCandidate`、`confidence` 赋值行等内部字段。
- `memoryCandidate` 只存在于 `UserStateDecision` 内部计划与 system_event 摘要，不 auto accept，不写 accepted memory，不进入受控 prompt 注入。

## 使用方式

无新增用户命令。普通自然语言进入原模型主链，Policy Kernel 在模型请求前本地生成用户状态调度信号。

示例输入：

- `又错了，少说多做，先读源码事实再给结论。`
- `不要只复述交付摘要，上次你没看代码。`
- `直接给我命令，不用解释。`
- `先讨论架构取舍，不要实现代码。`
- `开源发布前复检 dirty tree、untracked files、build、focused tests。`

## 涉及模块

- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/meta-scheduler-runtime.test.ts`
- `packages/tui/src/model-prompt-runtime.test.ts`
- `packages/tui/src/index.test.ts`
- `docs/delivery/README.md`
- `docs/delivery/phase-07-13-user-state-routing-policy-kernel.md`

## 关键设计

- `UserStateDecision` 是瞬时调度信号，不是长期人格、心理诊断或用户画像。
- 状态识别是中英文规则匹配，保守影响调度，不生成安慰文本。
- `confused` / `strategic_exploration` 会阻止实现推进倾向，避免“用户只想讨论/解释却开始写代码”。
- `frustrated` / `trust_repair` / `high_stakes_release` 会强化源码事实和验证，而不是提高话术密度。
- `memoryCandidate.autoAccept` 固定为 `false`；本阶段不调用 `/memory accept`，不写 accepted memory。
- 权限、final answer gate、verification gate、provider breaker、workflow/job/agent gate 全部仍由原 runtime 执行。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

已运行：

- `corepack pnpm --filter @linghun/tui typecheck` → PASS
- `corepack pnpm exec vitest run packages/tui/src/meta-scheduler-runtime.test.ts packages/tui/src/model-prompt-runtime.test.ts --no-color` → PASS, 45/45
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "UserState|user state|emotion|frustrated|trust repair|decisive command|strategic|high stakes|Policy|Strategy|策略|memory|verification|final answer" --no-color` → PASS, 65 selected / 585 skipped
- `corepack pnpm exec biome check packages/tui/src/meta-scheduler-runtime.ts packages/tui/src/model-stream-runtime.ts packages/tui/src/model-prompt-runtime.ts packages/tui/src/index.test.ts` → PASS
- `corepack pnpm --filter @linghun/tui build` → PASS
- `corepack pnpm --filter @linghun/cli build` → PASS
- `git diff --check` → PASS

## 性能结果

用户状态分类为同步本地正则判断，不读取文件、不调用 provider、不联网、不触发索引刷新、不启动 agent/job/workflow。新增提示复用现有 notifications 队列，并受 `notificationPlan.maxHints` 截断。

## 已知问题

- `UserStateDecision` 是规则识别，不是完整自然语言意图理解器；低置信度状态默认 `neutral`。
- `memoryCandidate` 当前是调度候选，不写入 memory review queue；如后续要持久化，必须走现有 candidate-only memory runtime 和用户显式接受。
- 本阶段验证是 focused/local，不代表真实 full smoke、Beta PASS、smoke-ready 或 open-source-ready。

## 不在本阶段处理的内容

- 不做心理诊断。
- 不新增人格系统。
- 不做情绪陪聊模板。
- 不修改权限默认值。
- 不打开 workflow/agent/hooks/remote 自动执行。
- 不新增 PolicyPanel、EmotionPanel、KernelPanel。
- 不修改 `WHITEPAPER*.md`、`docs/stress`、`img`、`report.md`、`test-model-set.sh`、DH1-DH4。
- 不进入 Phase 7.14。
- 不声明 Beta PASS、smoke-ready、open-source-ready。

## 下一阶段衔接

阶段完成后停止在用户审核点。是否建立 focused/local 稳定点或进入后续阶段，必须由用户明确确认。

## 开发者排查入口

- 用户状态类型与分类：`packages/tui/src/meta-scheduler-runtime.ts`
- Policy 主链消费：`packages/tui/src/model-stream-runtime.ts`
- 主屏脱敏：`packages/tui/src/model-prompt-runtime.ts`
- Memory candidate-only 边界：`packages/tui/src/memory-command-runtime.ts`
- Final answer gate：`packages/tui/src/final-answer-gate.ts`
- Verification runner：`packages/tui/src/verification-command-runtime.ts`

## 参考核对

- 本阶段实际读取了前述 Linghun 文档和源码。
- CCB / CCB Dev Boost 只作为行为边界参考：源码事实优先、低噪提示、验证前不说 PASS、主屏不泄漏内部字段。
- 进入 Linghun 的实现是自研 `UserStateDecision` typed policy signal、verification route 调整、notification 降噪与 sanitizer 过滤。
- 未复制 CCB 源码、内部 API、专有遥测或反编译痕迹。

## 成品级结构化 handoff packet

- phase: `Phase 7.13 User State Routing / Policy Kernel`
- verdict: `focused/local validation complete`
- nextPhase: `等待用户确认；不得自动进入 Phase 7.14`
- completed:
  - `UserStateDecision` 接入 `MetaSchedulerInput` / `PolicyDecision`
  - 七类状态本地识别
  - 状态影响 source-first、verification strength、detail plan、notification quiet、memory candidate-only
  - sanitizer 过滤 user-state 内部字段
  - focused tests 覆盖 user state、sanitizer、memory candidate-only、主链 policy event
- mustNotDo:
  - 不新增第二套 scheduler/runtime/UI panel
  - 不绕过 permission/final/verification/provider/workflow/job/agent gate
  - 不自动接受 memory
  - 不触碰禁止文件
  - 不声明 Beta PASS / smoke-ready / open-source-ready
- evidence:
  - `packages/tui/src/meta-scheduler-runtime.test.ts`
  - `packages/tui/src/model-prompt-runtime.test.ts`
  - `packages/tui/src/index.test.ts`
- validation:
  - typecheck PASS
  - focused meta/prompt PASS
  - selected index regression PASS
  - biome touched files PASS
  - tui build PASS
  - cli build PASS
  - git diff --check PASS
- indexStatus: codebase-memory MCP 不可用；未 refresh/rebuild。
- permissionMode: 本地代码编辑；未修改 Linghun runtime 权限默认值。
- providerModel: 未修改 provider/model/key/env route。
- budgetUsage: 未新增 provider/model token 消耗。
- userReviewPoint: 等待最终验证矩阵完成后审阅 diff 和本交付文档，决定是否建立 focused/local 稳定点。
