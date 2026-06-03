# Phase 17 Meta Scheduler Closure

## 阶段目标

补齐 Linghun 反思加强 / Meta 调度加强的源码级闭环：不新增第二套 reflection runtime，而是把 failure learning、verification、final answer gate、architecture runtime、deep compact、tool_result budget、index runtime state、agent/workflow blocked state 纳入统一判断口径，稳定“何时触发、何时升级、何时收口、何时停止消耗”。

## Source-Level Reality Check

- 现有 reflection 源码事实：没有独立 reflection runtime；失败反思由 `failure-learning-runtime.ts` 承担，真实失败经 `captureFailureLearning()` 写入，作为 prompt 风险提示，不进入 PASS evidence。
- 现有 verification 源码事实：`verification-command-runtime.ts` 提供 `/verify` 和 `RunVerification` 计划/执行/日志/evidence，PASS 只来自真实验证报告。
- 现有 final answer gate 源码事实：`model-loop-runtime.ts` 的 `evaluateFinalAnswerClaims()` 与 `final-answer-gate.ts` 的 architecture/completeness gate 已在 `index.ts` 主链和 continuation 链路收口。
- 现有 compact 源码事实：`compact-preflight-runtime.ts` 在 provider preflight 中执行 tool_result budget、deep compact / micro compact；失败冷却时阻断 provider 请求，不继续硬塞。
- 现有 index 源码事实：`index-runtime.ts` 已区分 `ready/stale/unknown-project/disabled/missing/error`，handoff/agent/workflow/RuntimeStatus 共享索引状态。
- 现有 agent/workflow 源码事实：blocked/stale/cancelled/timeout 不生成 PASS evidence；workflow bridge 和 job/agent runtime 已有 blocked 状态，但主模型 prompt 中缺统一调度提示。

## Existing Implementation / Gaps / Minimal Touch Points / Forbidden Duplicate Systems

- existing implementation：Failure Learning、Verification Runner、Final Answer Gate、Deep Compact、Architecture Runtime、Index Runtime、Workflow/Agent blocked state 都已存在。
- gaps：触发策略分散；工具失败后虽有部分 failure learning，但模型主链缺统一失败调度口径；RuntimeStatus/内部 gate 泄漏清理未覆盖 MetaScheduler/gateId/raw evidence/raw tool_result；index 状态进入 prompt 后缺明确 ready/stale/unknown-project 策略。
- minimal touch points：新增 `meta-scheduler-runtime.ts` 纯判断入口；`index.ts` 主链注入短 directive 和工具失败 failure learning 接线；`model-prompt-runtime.ts` 复用现有 prompt hygiene sanitizer；新增 focused test。
- forbidden duplicate systems：未新增第二套 reflection store、verification runner、final answer gate、compact agent、index engine、workflow scheduler、agent scheduler、permission pipeline 或 provider route。

## 已完成功能

- 新增统一 Meta Scheduler 纯函数入口，输出底层 directive、final gate/verifier preference、failure learning/retry guard、compact pressure、index strategy、blocked runtime stop flags。
- 主模型请求在 system prompt 注入 `MetaSchedulerForModel`，只作为底层约束，不在主屏展示。
- 工具失败统一写入 failure learning；pending approval 不算失败。
- 主屏脱敏器新增 `MetaSchedulerForModel`、`gateId`、`raw evidence`、`raw tool_result`、`meta_scheduler` 等内部字段过滤。
- Index ready/stale/unknown-project/disabled/missing/error 转为不同模型策略：ready 仅作定位线索，stale/unknown-project/missing/error 不允许当 ready 事实。
- Agent/job stale 和 workflow blocked 触发 stop-for-PASS 口径，要求真实恢复、取消或降级。
- 独立复检修复：模型工具权限 deny/cancel/ask 属于用户决策，不再被统一工具失败接线误记为 failure learning；真实 runtime/tool failure 仍记录。

## 使用方式

- 普通用户无新增命令；主屏只看到验证后的自然输出。
- 开发者可看 transcript/system event：`meta_scheduler:*`、`meta_scheduler_tool_failure`。
- 现有入口继续使用：`/verify`、`/compact status|deep|manual`、`/index status`、`/agents`、`/workflows`、`/details`。

## 涉及模块

- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/meta-scheduler-runtime.test.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `docs/delivery/phase-17-meta-scheduler-closure.md`
- `docs/delivery/README.md`

## 关键设计

- Meta Scheduler 是纯判断入口，不执行 provider/tool/permission，不写第二套 runtime 状态。
- Failure Learning 仍是历史风险提示，不变成 evidence。
- Final Answer Gate 仍是最终 PASS/声明收口事实源；Meta Scheduler 只让高风险声明更稳定地触发 gate/verifier 约束。
- Compact 仍由 provider preflight 真正执行；Meta Scheduler 不新增 compact job。
- Architecture Runtime 保持 directive + drift 检查边界，不包装成不存在的 hard gate。
- 内部状态只进 system prompt / transcript，不进普通主屏。

## 配置项

无新增配置项。

## 命令

- `corepack pnpm exec vitest run packages/tui/src/meta-scheduler-runtime.test.ts packages/tui/src/model-prompt-runtime.test.ts`
- `corepack pnpm exec vitest run packages/tui/src/failure-learning-runtime.test.ts packages/tui/src/verification-command-runtime.test.ts packages/tui/src/mcp-index-runtime.test.ts packages/tui/src/workflow-agent-runtime-bridge.test.ts packages/tui/src/workflow-task-surface.test.ts`
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "failure learning|final answer|compact|workflow|agent context|RunVerification|tool_result budget|RuntimeStatusForModel"`
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "denied model tool permission|permission denial is not failure learning|tool failure records failure learning|failure learning"`
- `node scripts/live-provider-smoke.mjs` with temporary shell env for OpenAI-compatible `https://hk.geek2api.com/v1`, model `gpt-5.5`
- Provider direct 3-request concurrent smoke with temporary shell env, model `gpt-5.5`
- TUI stdin live smoke with temporary shell env, model `gpt-5.5`
- `corepack pnpm typecheck`
- `git diff --check`

## 测试与验证

- Focused meta/prompt vitest：PASS，16 tests passed。
- Failure/verification/index/workflow focused vitest：PASS，73 tests passed。
- `index.test.ts` 相关切片：PASS，46 passed，509 skipped。
- Permission deny / failure learning focused slice：PASS，11 passed，544 skipped。
- `corepack pnpm exec tsc --noEmit --pretty false`：PASS。
- `corepack pnpm typecheck`：PASS。
- `git diff --check`：PASS。
- OpenAI-compatible live provider smoke：PASS，text response。
- OpenAI-compatible direct concurrent smoke：PASS，3/3 text responses。
- OpenAI-compatible TUI stdin live smoke：PASS，主屏未泄漏 `RuntimeStatusForModel` / `MetaSchedulerForModel` / `gateId`。

## 性能结果

- 新增 Meta Scheduler 是纯同步判断，输入为已有 runtime 状态，不扫描文件、不调用 provider、不访问网络。
- System prompt 增量为短 directive；不注入 raw evidence、raw index、raw tool_result 或完整失败记录。
- Tool failure 记录复用 Failure Learning 去重和脱敏逻辑，避免无限追加。

## 已知问题

- Meta Scheduler 不自动运行 verifier；它通过底层约束与现有 `RunVerification` / final answer gate 提高触发稳定性。
- Architecture Runtime 仍有 prompt directive 边界；本阶段不把它改成全工具 hard gate。
- Deep compact 仍主要由 `index.test.ts` 覆盖，未拆独立 runtime test 文件。

## 不在本阶段处理

- 不新增 reflection agent。
- 不新增 verifier agent lifecycle。
- 不新增 native runner、job supervisor、remote channel 或桌面端能力。
- 不改 provider/model/key/env route。
- 不自动重建 codebase-memory 索引。

## 下一阶段衔接

等待用户确认是否提交稳定点。后续若继续，可围绕 verifier agent 生命周期、architecture hard gate 或 deep compact 单元化测试单独立阶段。

## 开发者排查入口

- Meta 调度判断：`packages/tui/src/meta-scheduler-runtime.ts`
- 主链注入与工具失败记录：`packages/tui/src/index.ts`
- 主屏脱敏：`packages/tui/src/model-prompt-runtime.ts`
- Focused tests：`packages/tui/src/meta-scheduler-runtime.test.ts`

## 参考核对

- Linghun 文档：读取了 `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`、`docs/delivery/README.md`、`phase-17-agent-workflow-ecosystem-closure.md`、`phase-17-index-runtime-closure.md`、`docs/audit/reference-map.md`。
- CCB / CCB Dev Boost 参考：只读参考了本地 `F:\ccb-source` 中任务收口、verification no-PASS-without-evidence、compact boundary、tool failure retry/stop、agent/task blocked/cancel/resume 的行为边界。
- 进入 Linghun 自研实现的内容：统一判断入口、短底层 directive、工具失败进入 failure learning、主屏内部字段过滤。
- 未复制 CCB、OpenCode、codebase-memory 或其它第三方可疑源码实现、内部 API、专有遥测或内部服务逻辑。

## Handoff Packet

- 当前阶段：Phase 17 Meta Scheduler Closure。
- verdict：PASS（focused/local validation）。
- 是否允许进入下一阶段：否，需用户确认稳定点。
- 禁止事项：不得新增第二套 reflection/verifier/compact/index/agent/workflow runtime；不得把 failure learning 当 PASS evidence；不得在主屏泄漏 `RuntimeStatusForModel`、`gateId`、raw evidence、raw tool_result 或内部调度标签。
- 证据引用：`meta-scheduler-runtime.test.ts`、`model-prompt-runtime.test.ts`、`failure-learning-runtime.test.ts`、`verification-command-runtime.test.ts`、`mcp-index-runtime.test.ts`、`workflow-agent-runtime-bridge.test.ts`、`workflow-task-surface.test.ts`、`index.test.ts` 相关切片。
- 验证结果：focused vitest PASS；typecheck PASS；diff-check PASS。
- 索引状态：本阶段使用源码精读与 `rg`；codebase-memory MCP 工具未暴露给当前会话，未触发重建。
- 权限模式：本地 unrestricted filesystem；无远程执行、无依赖变更、无数据迁移。
- 模型/provider：已用临时 shell env 跑 OpenAI-compatible `https://hk.geek2api.com/v1`，model `gpt-5.5` 的 live provider smoke、direct concurrent smoke 和 TUI stdin live smoke；未写入 provider.env 或项目配置。
- 预算使用情况：本地验证为主，无真实 provider 账单。
