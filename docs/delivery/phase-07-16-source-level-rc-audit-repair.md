# Phase 7.16 Source-Level RC Audit & Repair

## 阶段目标

对 Phase 7.10 到 7.15.1 新增或改动的可见层、transcript、final answer / evidence、Policy Kernel / User State、task/job/agent/workflow、Capability/App Bridge 做源码级 RC 审计，只修复源码事实确认的 blocker / high-risk 问题。

本阶段不进入真实 provider full-chain stress，不声明 Beta PASS，不处理 DH1-DH4 / 开源卫生项，不 stage、不 commit。

## 精读文件清单

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-07-10-visible-layer-tool-observation-closure.md`
- `docs/delivery/phase-07-11-task-job-verification-routing-closure.md`
- `docs/delivery/phase-07-12-task-background-job-ux-maturity.md`
- `docs/delivery/phase-07-13-user-state-routing-policy-kernel.md`
- `docs/delivery/phase-07-14-capability-runtime-app-bridge-mvp.md`
- `docs/delivery/phase-07-15-connector-runtime-public-app-bridge.md`
- `packages/tui/src/tui-output-surface.ts`
- `packages/tui/src/shell/components/ScrollViewport.tsx`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/tool-result-budget.ts`
- `packages/tui/src/evidence-runtime.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/final-answer-gate.ts`
- `packages/tui/src/model-tool-runtime.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/model-prompt-runtime.test.ts`
- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/meta-scheduler-runtime.test.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/job-runtime.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/tui-agent-job-runtime.ts`
- `packages/tui/src/workflow-command-runtime.ts`
- `packages/tui/src/verification-command-runtime.test.ts`
- `packages/tui/src/capability-runtime.ts`
- `packages/tui/src/connector-runtime.ts`
- `packages/tui/src/capability-runtime.test.ts`
- `packages/tui/src/connector-runtime.test.ts`
- `docs/developers/capability-runtime-app-bridge.md`

codebase-memory MCP 本轮未暴露；已按项目规则降级为 `rg`、源码精读和 focused tests。用户要求多开智能体，本轮使用多个只读 explorer / 一个 evidence-focused explorer 辅助核查，最终结论均以源码和测试为准。

## 源码事实结论

### 可见层与 transcript

- `tool_result` / connector large output 已通过 `tool-result-budget.ts` 和 `evidence-runtime.ts` 进入 artifact/ref 边界。
- `model-stream-runtime.ts` 已有 streaming preview / final gate discard-replace 边界；本阶段未发现必须立即改动的可见层 blocker。
- Carson 只读核查指出 no-tool final preview 和 retry invalid draft 仍可作为后续观察项；本轮没有源码事实显示它们阻断 Phase 7.16 RC 修复目标，未改。

### final answer / evidence / anti-hallucination

- `StartAgent` 的 running 结果和 `RunWorkflow` 的 background running 结果原先都写入 `agent_execution/workflow_execution + action_executed` evidence。
- `model-loop-runtime.ts` 原先用 `agent_execution/workflow_execution + action_executed` 支撑 agent/workflow status claim，导致 running/background-started 可能支撑“已完成”类最终声明。
- 已修复为 terminal-specific evidence tag：`agent_terminal_status` / `workflow_terminal_status` 才能支撑 status claim。

### Policy Kernel / User State / routing

- `/agents` catalog 是 readonly，但 `createNaturalEquivalentCommand()` 会把“停止所有智能体 / stop all agents”映射成 `/agents cancel all`。
- `routeNaturalIntent()` 原先可能因 readonly capability 把 agent cancellation 当 readonly execute。
- 已修复为 agent cancel/stop 自然意图必须进入 Start Gate，不改变普通 `/agents` 状态查询。

### task/job/agent/workflow

- `workflowStepStatusFromNestedJob()` 原先未识别 child job `result.status === "partial"`，会把 `completed + partial result` 映射为 workflow step `completed`。
- 已修复为 `partial`，workflow lifecycle 仍可 completed，但 result 保持 PARTIAL，且不产生 PASS 证据。

### Capability/App Bridge

- `connector-runtime.ts` 原先可读取项目外 manifest；本阶段收紧为 manifest path 必须 resolve 到当前 `context.projectPath` 内。
- Local HTTP `baseUrl` 原先未拒绝 URL userinfo；已拒绝 `username/password`。
- `/apps doctor` Ink summary 原先可能把 Details/appId 行带入 summary；已过滤到 detailsText。
- app/capability 可见 metadata 原先未统一脱敏；已在 app name、capability title/description/result/details 上应用 secret sanitizer。

## 修复列表

- `packages/tui/src/natural-command-bridge.ts`
  - agent stop/cancel natural intent 进入 `start_gate`。
- `packages/tui/src/model-tool-runtime.ts`
  - `StartAgent` / `RunWorkflow` evidence 仅在终态结果加 terminal tag。
- `packages/tui/src/model-loop-runtime.ts`
  - final agent/workflow status claim 需要 terminal tag。
- `packages/tui/src/workflow-command-runtime.ts`
  - nested durable job `result.partial` 映射为 workflow step `partial`。
- `packages/tui/src/connector-runtime.ts`
  - connector manifest 限定项目内。
  - Local HTTP `baseUrl` 拒绝 userinfo。
  - app connector list/doctor/success message 脱敏。
  - Ink `/apps doctor` summary 不包含 Details/appId 行。
- `packages/tui/src/capability-runtime.ts`
  - capability list/doctor/result/details 展示文本脱敏。

## 测试与验证

已运行：

```powershell
corepack pnpm exec biome check packages/tui/src/natural-command-bridge.ts packages/tui/src/natural-command-bridge.test.ts packages/tui/src/model-tool-runtime.ts packages/tui/src/model-loop-runtime.ts packages/tui/src/model-loop-runtime.test.ts packages/tui/src/workflow-command-runtime.ts packages/tui/src/index.test.ts packages/tui/src/connector-runtime.ts packages/tui/src/connector-runtime.test.ts packages/tui/src/capability-runtime.ts packages/tui/src/capability-runtime.test.ts
corepack pnpm exec vitest run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/model-loop-runtime.test.ts packages/tui/src/connector-runtime.test.ts packages/tui/src/capability-runtime.test.ts --no-color
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "agent|workflow|nested job|apps|connector|capability|PASS|completed|failed" --no-color
corepack pnpm --filter @linghun/tui typecheck
corepack pnpm --filter @linghun/tui build
corepack pnpm --filter @linghun/cli build
node F:\Linghun\apps\cli\dist\main.js --version
node F:\Linghun\apps\cli\dist\main.js --help
git diff --check
```

结果：

- Biome scoped check PASS。
- Focused unit tests PASS：4 files / 333 tests。
- Focused `index.test.ts` regression PASS：113 selected / 542 skipped。
- `@linghun/tui` typecheck PASS。
- `@linghun/tui` build PASS。
- `@linghun/cli` build PASS。
- CLI `--version` PASS：`0.1.0`。
- CLI `--help` PASS。
- `git diff --check` PASS。

## 验证矩阵

| 风险 | 证据 | 结果 |
| --- | --- | --- |
| agent cancel 被 readonly 直通 | `natural-command-bridge.test.ts` 新增中英 stop all agents case | PASS |
| running agent/workflow 支撑最终完成声明 | `model-loop-runtime.test.ts` 新增 terminal tag claim gate cases | PASS |
| nested job partial 被 workflow 升级 completed | `index.test.ts` 新增 `result-partial` 参数化 case | PASS |
| 项目外 connector manifest | `connector-runtime.test.ts` 新增 outside manifest case | PASS |
| connector URL userinfo 泄漏/绕过 | `connector-runtime.test.ts` 新增 userinfo baseUrl case | PASS |
| app/capability metadata secret 上屏 | `connector-runtime.test.ts` / `capability-runtime.test.ts` 新增 sanitizer cases | PASS |

## 未修问题

- No-tool final live preview、retry invalid draft 的进一步体验收口：本阶段没有源码事实显示其为 full-chain stress 前 blocker；保留为后续可观察项。
- Connector state 仍是运行期内存状态，不做持久化和自动重连；这是 Phase 7.15 阶段边界，不是本阶段 hotfix。
- MCP/plugin/desktop_bridge/websocket transport 仍是 reserved，不在本阶段实现真实连接。

## 是否允许进入真实 full-chain stress

Verdict：PASS for Phase 7.16 RC hotfix scope。

可以进入真实 full-chain stress 的下一步审核点，但本阶段没有执行真实 provider 重压，也不声明 Beta PASS / smoke-ready / open-source-ready。进入真实 full-chain stress 仍需用户明确确认。

## Forbidden dirty files

本轮未修改以下 forbidden dirty files / paths：

- `WHITEPAPER.md`
- `WHITEPAPER.en.md`
- `docs/stress/`
- `img/`
- `report.md`
- `test-model-set.sh`
- `docs/delivery/phase-6.7-full-source-maturity-audit.md`

这些文件在本轮开始前已处于 dirty/untracked 状态，仍保持为用户/既有改动。

## 性能结果

- 未新增后台扫描、自动重连、第二套 scheduler、第二套 connector persistence。
- 新增路径/URL/脱敏判断均为用户显式 `/apps connect` 或格式化输出时的局部同步逻辑。
- evidence tag 判断只在已有 control tool result 写 evidence 时执行，无额外模型调用。

## 缓存、成本、权限和会话影响

- 缓存：无新增 cache key / cache 破坏面。
- 成本：无新增模型调用；测试为本地 focused validation。
- 权限：agent natural cancel 进入 Start Gate；connector/capability 仍复用现有 permission pipeline。
- 会话：evidence supportsClaims 更精确；running/background-started 不再支持最终 agent/workflow status claim。

## 参考核对

- 实际读取 Linghun 文档：见“精读文件清单”。
- 实际参考本地 CCB / CCB Dev Boost / 社区项目文件：本阶段没有复制外部源码；Phase 7.16 主要基于 Linghun 现有源码、阶段文档和多智能体只读源码核查。
- 行为参考进入 Linghun 自研实现的内容：仅保留 summary-first、evidence-backed、permission-gated、local connector boundary 的产品边界。
- 未复制可疑源码实现、反编译痕迹、内部 API、专有遥测或内部服务逻辑。

## 成品级 handoff packet

- 下一阶段：真实 full-chain stress 审核点，需用户确认后开始。
- 禁止事项：不得把 Phase 7.16 PASS 说成 Beta PASS；不得自动进入 real provider stress；不得触碰 forbidden dirty files；不得新增第二套 scheduler / terminal renderer / connector persistence / 后台扫描 / 自动重连。
- 证据引用：
  - `packages/tui/src/natural-command-bridge.ts`
  - `packages/tui/src/model-tool-runtime.ts`
  - `packages/tui/src/model-loop-runtime.ts`
  - `packages/tui/src/workflow-command-runtime.ts`
  - `packages/tui/src/connector-runtime.ts`
  - `packages/tui/src/capability-runtime.ts`
  - 对应 focused tests。
- 验证结果：
  - Biome PASS。
  - Focused tests PASS。
  - Focused index regression PASS。
  - TUI typecheck PASS。
  - TUI build PASS。
  - CLI build PASS。
  - CLI `--version` / `--help` PASS。
  - `git diff --check` PASS。
- 索引状态：codebase-memory MCP 未暴露；未执行慢重建或 force refresh。
- 权限模式：本地 Codex desktop，filesystem unrestricted；未 stage、未 commit。
- 模型/provider：Codex GPT-5；多智能体只读辅助；未调用真实 Linghun provider stress。
- 预算使用：无外部 provider token 预算消耗；仅本地 shell/test/build 预算。
