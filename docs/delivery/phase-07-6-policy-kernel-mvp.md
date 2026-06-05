# Phase 7.6 Policy Kernel MVP / 中枢调度能力源码级接入

## 阶段目标

把现有 `meta-scheduler` 从仅注入 `MetaSchedulerForModel` prompt directive，最小升级为主链可消费的 typed `PolicyDecision`。本阶段只接入中枢调度 MVP：根据源码事实中的记忆、失败学习、证据、权限、provider 状态、workflow/agent 状态、上下文压力、架构/验证边界，给模型主链生成策略路线和轻提示。

本阶段不新增 PolicyPanel / KernelPanel / AGI 面板，不新增第二套 scheduler，不绕过现有权限、provider breaker、workflow gate、architecture boundary、final-answer gate 或 evidence 系统。

## 源码事实

- `packages/tui/src/meta-scheduler-runtime.ts` 已有 `evaluateMetaScheduler`、`MetaSchedulerDecision`、`formatMetaSchedulerDirective`、`verifyFailureLearningContract`。旧实现以 directive + boolean flags 为主。
- `packages/tui/src/model-stream-runtime.ts` 已在 `createModelSystemPrompt` 前调用 `evaluateMetaScheduler`，并把 directive 传入 system prompt；provider cooldown/fallback、compact preflight、final gate、failure learning、permission approval 都已有主链。
- `packages/tui/src/model-prompt-runtime.ts` 已有 `sanitizeMainScreenLeakage`，负责清理 `RuntimeStatusForModel`、`MetaSchedulerForModel`、`gateId`、raw evidence/tool_result 等内部标签。
- `packages/tui/src/provider-loop-runtime.ts` 已有 `checkAndWriteProviderCooldown`、`resolveRuntimeFallback`、`recordProviderFallbackAttempt`。
- `packages/tui/src/failure-learning-runtime.ts` 明确 FailureLearningSummary 只是历史风险提示，不是 completion evidence。
- `packages/tui/src/tui-memory-runtime.ts` 已有 accepted-only topK memory injection，候选不自动注入。
- `packages/tui/src/workflow-command-runtime.ts` / `tui-data-types.ts` 已有 workflow/agent blocked/stale 状态，可被 scheduler 消费。

## 已完成功能

- 在 `meta-scheduler-runtime.ts` 增加 typed `PolicyDecision` / `PolicyHint`，保留原 `MetaSchedulerDecision` 兼容字段。
- 新增字段：
  - `taskKind`: `chat | code_fact | edit | workflow | agent | verification`
  - `riskLevel`: `low | medium | high`
  - `contextPlan`: `includeMemory / includeFailureLearning / compactBeforeProvider`
  - `executionPlan`: `preferSourceFirst / preferWorkflow / preferAgent / requireVerification / requireFinalGate`
  - `permissionPlan`: `expectedMutating / requireExplicitGate`
  - `providerPlan`: `keepCurrent | fallbackCandidate | cooldownBlocked`
  - `hints`: 中英文轻提示文案
- `model-stream-runtime.ts` 在 system prompt 构造前生成 policy decision，并消费 typed decision：
  - 写入 `context.notifications` 轻提示队列。
  - 写入脱敏 `system_event` 策略摘要。
  - provider cooldown 阻塞路径也生成 typed policy decision，且不调用 gateway。
  - provider fallback attempt 生成 typed fallback policy hint/event。
  - context pressure 消费现有 `context.cache.compactPressure`，真正压缩仍交给 `prepareMessagesForProviderPreflight`。
- `model-prompt-runtime.ts` 扩展 sanitizer，清理 `PolicyDecision`、`PolicyHint`、`Typed policy route`、`policy_decision` 等内部标签。

## 使用方式

用户无需新命令。普通自然语言仍进入原模型主链；当 policy 发现路线变化，会通过现有 NotificationStack 轻提示展示。

示例：

- 中文：`策略：源码优先，先读取关键文件。`
- English: `Strategy: source-first; reading key files before answering.`
- 中文：`策略：上下文接近上限，先压缩再请求模型。`
- 中文：`策略：Provider 冷却中，暂停本轮请求。`

## 涉及模块

- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/meta-scheduler-runtime.test.ts`
- `packages/tui/src/index.test.ts`
- `docs/delivery/README.md`

## 关键设计

- Policy Kernel MVP 是现有 meta-scheduler 的 typed projection，不是新系统。
- 主链继续把必要 directive 注入模型，但 runtime 同时消费 `policyDecision`。
- 用户可见层只用现有轻提示，不新增面板。
- `FailureLearningSummary` 和 accepted memory 只影响上下文/风险提示，不进入 evidence，不支持 PASS。
- `compactBeforeProvider` 只表达策略；真实 compact/block 仍由现有 preflight 执行。
- provider fallback/cooldown 仍由 provider breaker 和 route fallback 决定；policy 只投影策略与提示。

## 配置项

无新增配置项。

## 命令

无新增用户命令。

## 测试与验证

已运行：

- `corepack pnpm --filter @linghun/tui typecheck`
- `corepack pnpm exec vitest run packages/tui/src/meta-scheduler-runtime.test.ts --no-color`
- `corepack pnpm exec vitest run packages/tui/src/model-prompt-runtime.test.ts packages/tui/src/model-doctor-runtime.test.ts --no-color`
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Policy" --no-color`

后续完整验收仍需运行用户指定的 index grep、biome check。

## 性能结果

Policy decision 为同步纯函数判断；主链不为了 policy 额外读取 transcript。上下文压力优先消费已有 `context.cache.compactPressure` 快照，没有快照时只估算当前轻量消息。

## 已知问题

- `lastToolFailure` / `lastProviderFailure` 的生命周期仍沿用既有实现，可能跨轮保留；本阶段不重构失败状态清理。
- continuation 路径发生 provider fallback 时会生成 runtime policy hint，但不会重建完整 system prompt。
- `/details` 未新增专门 policy 摘要；本阶段用主屏轻提示 + `system_event` 闭环。

## 不在本阶段处理的内容

- 不做二进制协议。
- 不新增 PolicyPanel / KernelPanel / AGI 面板。
- 不新增第二套 scheduler、provider breaker、workflow gate、permission gate、final-answer gate。
- 不默认启动 agent/workflow。
- 不做本地模型训练/LoRA。
- 不扩大到开源 LICENSE / README / DH1-DH4。

## 下一阶段衔接

后续若继续增强，可在不新增面板的前提下把 `/details` 或 `/status` 中的简短 policy 摘要做成可展开诊断，并审计 failure lifecycle 是否需要清除 stale `lastToolFailure/lastProviderFailure`。

## 开发者排查入口

- typed decision：`evaluateMetaScheduler`
- 主链消费：`sendMessage`、`appendRuntimePolicyHint`
- 主屏轻提示：`context.notifications`
- prompt 注入：`createModelSystemPrompt`
- 主屏脱敏：`sanitizeMainScreenLeakage`
- provider cooldown/fallback：`checkAndWriteProviderCooldown`、`resolveRuntimeFallback`
- final gate：`evaluateFinalAnswerClaims`、`runArchitectureAndCompletenessFinalGate`

## 参考核对

- 实际读取 Linghun 源码：`meta-scheduler-runtime.ts`、`model-stream-runtime.ts`、`model-prompt-runtime.ts`、`tui-context-runtime.ts`、`tui-model-runtime.ts`、`provider-loop-runtime.ts`、`model-tool-runtime.ts`、`workflow-command-runtime.ts`、`failure-learning-runtime.ts`、`tui-memory-runtime.ts`。
- 实际读取 Linghun 测试/交付索引：`meta-scheduler-runtime.test.ts`、`index.test.ts`、`model-prompt-runtime.test.ts`、`docs/delivery/README.md`。
- 本阶段以代码事实为主；未以阶段文档替代源码判断。
- 未读取或复制 CCB 可疑源码实现；仅遵守 Linghun clean rewrite 和现有本仓运行时边界。

## 成品级结构化 handoff packet

- nextPhase: 由用户决定；建议先完成本阶段完整验收命令，再决定是否建立稳定点。
- forbidden: 不新增第二套 scheduler；不把 memory/failure learning 当 evidence；不绕过 pendingLocalApproval；不新增 PolicyPanel/KernelPanel/AGI 面板。
- evidenceRefs: `meta-scheduler-runtime.test.ts`、`index.test.ts -t "Policy"`、TUI typecheck。
- validation: 已完成 focused typecheck 与 policy tests；完整指定验收待最终运行结果补齐。
- indexStatus: 未触发 index rebuild / refresh。
- permissionMode: 本地代码修改；未绕过权限管道。
- modelProvider: 当前 Codex 会话模型/provider 未写入 Linghun runtime。
- budget: 未设置显式 token/成本预算。
