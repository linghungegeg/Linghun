# D.14H-A Workflow Matrix Source Audit

Date: 2026-06-01
Scope: source-fact audit and design freeze only. No implementation, no main-chain behavior change, no new planner/schema/runtime, no staging, no commit.

## 1. Executive Conclusion

Linghun 当前更准确地说是：**自然语言可路由、Start Gate / 权限管道守住边界的模板化多 agent durable job 系统**，而不是“缺少自然语言入口”的系统。

剩下的 20% 不是自然语言入口缺失。源码已经有 `/job`、`/fork`、`/agents`、`/workflows` 的自然语言 capability catalog、风险分层和等价 slash 命令生成。真正缺口是 Workflow Matrix 产品层：动态 feature-sliced agent matrix、phase progression、agent task specialization、Workflow Task Surface + Evidence Merge，以及 token / tools / duration / status 的聚合视图。

Design freeze decision: **Workflow Matrix 只能作为编排层接入现有主链**。后续不得新增第二套 agent、job、evidence、permission、runner/runtime；planner 只能生成计划、切片和受控请求，执行必须复用现有 `/job`、`/fork`、agent runtime、permission pipeline、evidence/final gate、workspace cache、runner fallback 和 remote inbound bridge。

## 2. Current Capability Matrix

| 能力 | 源码位置 | 当前已做到什么 | 可复用到 Workflow Matrix 的方式 | 风险/缺口 |
| --- | --- | --- | --- | --- |
| Natural Command Catalog | `packages/tui/src/natural-command-bridge.ts:20-39`, `:42-60`, `:123-157` | 每个命令有 slash、aliases、risk、readonly、requiresStartGate、writesConfig、entersPermissionPipeline、bridgeSafe；`/workflows`、`/job`、`/agents`、`/fork` 已注册。 | Workflow Matrix 的自然语言入口必须新增/复用 catalog 描述和风险分层，不做关键词截获。 | 缺 matrix-specific capability；不能恢复本地自然语言关键词截获。 |
| `/workflows` | `packages/tui/src/natural-command-bridge.ts:282-291`, `packages/tui/src/index.ts:2501-2528` | 列模板；启动模板只展示 Start Gate，明确不会自动改文件，后续写文件/Bash/联网/依赖仍走权限管道。 | Workflow Matrix 的 planner 入口可先表现为 Start Gate + plan preview。 | 现有 workflow 是模板启动门，不是 phase/agent matrix runtime。 |
| `/job` natural route | `packages/tui/src/natural-command-bridge.ts:559-568`, `:1314-1320` | `/job` 是 start_gate capability；非显式 job/background/status-like 文本可走 readonly control-plane。 | Matrix 可把执行请求转换成 `/job run/create/status/report/logs` 受控命令。 | 不应让 NL 直接启动无限 job；动态 matrix 仍缺 schema/Task Surface。 |
| `/agents` natural route | `packages/tui/src/natural-command-bridge.ts:595-604` | `/agents` 是 readonly：查看 agent 状态、transcript、usage、取消入口。 | Matrix 可读取/展示现有 agent 状态，作为只读状态源。 | 只有列表/状态，不是矩阵视图。 |
| `/fork` natural route | `packages/tui/src/natural-command-bridge.ts:607-616`, `:2054-2056` | `/fork` 是 start_gate；等价命令生成单个 role：`/fork <explorer|planner|verifier|worker> <task>`。 | Matrix bridge 可把每个 approved slice 转成一个或多个 `/fork` 请求。 | 现在不是自然语言直接多开；也不是 feature-sliced specialization。 |
| Safe local action boundary | `packages/tui/src/natural-command-bridge.ts:1240-1301` | `safe_local_action` 当前主要用于 safe index init/refresh；危险目标进入 `permission_pipeline`。 | Matrix 只能把只读 status/Task Surface 查询做 safe/read-only；启动/执行仍 Start Gate。 | 不得把 workflow execution 伪装成 safe local action。 |
| Natural permission block | `packages/tui/src/natural-command-bridge.ts:1463-1476`, `:1576-1585` | 明确自然语言桥、workflow、agent、plugin、hook、remote 只能生成确认门或权限请求；Start Gate 不替代 permission pipeline；workflow/fork/job/remote 等需要 exact confirmation。 | Matrix Start Gate 文案复用这个边界。 | 任何“普通 yes”跨阶段/多 agent 执行都应拒绝。 |
| Durable job state | `packages/tui/src/tui-data-types.ts:422-503` | `DurableJobState` 已含 goal/project/phase/target/plan、budget、permission flags、status/pauseReason、agents、handoffPacket、logs/report/fullOutput、evidenceRefs、verification、runner、owner heartbeat、worker、result、adopted/rejected conclusions。 | Matrix 不需要新 job store；用这些字段承载 phase、agent assignment、budget、logs/report。 | 当前 `plan` 是简单步骤数组，不是 Workflow Plan Schema。 |
| Job agents | `packages/tui/src/tui-data-types.ts:371-381`, `packages/tui/src/job-runtime.ts:318-350` | `DurableJobAgent` 有 id/type/displayName/goal/status/budgetTokens/owner/heartbeat/summary；创建时按 index 固定 1 planner、2 worker、3 verifier、4+ explorer。 | Matrix 可复用 agent metadata 和 status，但要在后续 bridge 中把 slice/specialization 映射进 goal/displayName/summary。 | 当前只是模板化 role 分配，不是按 feature 动态切片。 |
| Running cap | `packages/tui/src/job-runtime.ts:36-44`, `packages/tui/src/index.ts:1227-1234`, `:4070-4117` | 默认 running agent cap = 3；8 只是 high-config candidate；MAX_AGENTS=20；后台全局 cap=4，agent kind cap=3，job cap=1，heavy mutex。 | Matrix 必须默认真实 running cap 仍为 3，超过的 slice 保持 sleeping/queued/blocked。 | 不能为了 Task Surface 看起来强而默认 token 乘法。 |
| `/job` lifecycle commands | `packages/tui/src/job-agent-command-runtime.ts:218-367` | 支持 list/run/create/new/status/report/logs/pause/resume/cancel；status/report/logs 走 CommandPanel details；pause -> sleeping，resume 做 handoff/resource guard，cancel 停 runner 后 cancelled。 | Matrix 的 phase/job control 复用这些命令和状态迁移。 | 没有 phase progression 自动机；不能自动进下一阶段。 |
| Handoff and recovery | `packages/tui/src/job-agent-command-runtime.ts:375-449`, `:452-505`, `:556-605` | job 创建/恢复校验 handoff；缺字段 blocked；resume 先校验 handoff 和 resource guard；stale recovery 不生成 PASS evidence。 | Matrix 每个 phase/slice 启动前必须复用 handoff validation。 | 缺 matrix-level handoff merge/repair UI。 |
| Bounded worker loop | `packages/tui/src/job-agent-command-runtime.ts:610-786` | worker loop 使用 bounded steps、explicit token/step/runtime stop；只读本地结构化输出；不执行写入/Bash/network；完成仍 verification partial。 | Matrix runtime bridge 可以把 approved plan slices 编排成现有 worker loop 或 `/fork`，保持只读/权限边界。 | 现有 worker loop 是 Phase 17A durable metadata loop，不是完整 agent execution matrix。 |
| Trimmed refs | `packages/tui/src/job-agent-command-runtime.ts:666-672`, `:801-826`, `packages/tui/src/tui-agent-job-runtime.ts:96-112`, `packages/tui/src/index.ts:8262-8290` | agent/job context 明确只传 handoff、project facts、evidence refs、workspace cache/index status、key files；不注入 full transcript/full memory/full index/large logs。 | Matrix 必须共享 refs/cache/evidence，不给每个 agent 塞完整上下文。 | 需要 matrix-level ref budget 和 duplicate-read control。 |
| `/fork` agent runtime | `packages/tui/src/job-agent-command-runtime.ts:930-990`, `:1012-1070`, `:1123-1192` | `/fork` 检查 background/agent cap，创建 child transcript session，resolve role route，记录 `agent_start`/`agent_end`，worker 写入必须 `decidePermission("Write")`，verifier 复用 verification runtime。 | Matrix bridge 的 agent execution 应复用 `/fork` 和现有 completeAgent/runAgentWork。 | `/fork` 单 agent；worker 只支持 very narrow write pattern；不是 feature-sliced worker pool。 |
| Agent data/cost | `packages/tui/src/tui-data-types.ts:321-345`, `packages/tui/src/tui-agent-job-runtime.ts:91-94`, `packages/tui/src/job-agent-command-runtime.ts:1030-1044` | `AgentRun` 有 provider/model/permissionMode/transcript/cost；成本当前多为估算 input/output tokens，cache tokens 初始为 0；completion 记录 role usage 和 role handoff。 | Task Surface 可显示 agent status/model/token/cost 基础字段。 | 缺 per-agent tools/duration 聚合；cacheRead/cacheWrite 对 agent 不完整。 |
| Role model routing | `packages/tui/src/tui-data-types.ts:262-280`, `packages/tui/src/tui-model-runtime.ts:247-306` | `RoleRouteDecision` 记录 selected provider/model、fallbacks、requiredCapabilities、maxCostCny、stopConditions、repairSuggestions、fallbackUsed/budgetStop。 | Matrix 可按 role/slice 使用现有 role route decision，不新建 router。 | 缺 feature-specific route policy 和 Task Surface 行。 |
| Background task table | `packages/tui/src/tui-data-types.ts:39-58`, `packages/tui/src/tui-agent-job-runtime.ts:115-141`, `:260-305`, `packages/tui/src/index.ts:8162-8171` | 统一 `BackgroundTaskState` 覆盖 bash/verification/compact/agent/job/mcp/index；有 timing/progress/log/output/result/summary/nextAction；agent/job upsert 并写 transcript event。 | Matrix 的状态源应来自 background tasks + job/agent state，不另建 task table。 | 背景 blocks 当前聚合运行/失败，不是 matrix table。 |
| Permission pipeline | `packages/tui/src/tui-permission-runtime.ts:134-255` | `decidePermission` 先 hard deny，再 policy readonly auto allow，再 plan/auto-review/full-access/default 四档；plan 禁止写入/Bash；auto-review 只自动低风险工作区编辑/只读；default mutating ask；full-access 仍受 hard deny。 | Matrix 执行任何写入/Bash/联网/配置必须继续调用现有 permission pipeline。 | Matrix planner 不能成为权限模式或绕过 ask。 |
| Pending local approval | `packages/tui/src/index.ts:5396-5422`, `:6977-7057`, `packages/tui/src/remote-command-runtime.ts:1365-1377` | mutating model tool/index/remote approvals 复用 `pendingLocalApproval`；remote approval 只有本地已有 pending approval 才可 approved，且不生成 evidence。 | Matrix approval 可以复用 pendingLocalApproval/PermissionPanel。 | 不要创造 workflow-specific approval store。 |
| Evidence/final gate | `packages/tui/src/final-answer-gate.ts:84-100`, `:160-231`, `:310-352`, `packages/tui/src/index.ts:5341-5362` | 当前 repo 事实 claim 需要 local code evidence；Beta readiness PASS 有专门 evidence scope；high-risk final claim 要 `evaluateFinalAnswerClaims`；verification 只有 pass 才支持 “verified/tests passed”。 | Matrix final/report 必须走 evidence/final gate，不能把 Task Surface summary 当 proof。 | generic evidence regex 仍需谨慎；Evidence Merge 要只生成 refs，不制造 PASS。 |
| Job/agent non-PASS semantics | `packages/tui/src/job-runtime.ts:477-502`, `:604-614`, `packages/tui/src/job-agent-command-runtime.ts:715-782`, `:1107-1108` | job completed 只表示 bounded worker loop ended；verification remains partial；blocked/cancelled/timeout/stale 不 PASS；agent failure 不进 `context.evidence`。 | Matrix Task Surface 可以显示 completed/status，但 final claim 必须另看 verification/test evidence。 | 必须防止 “phase completed” 被 UI/模型误读为 verification PASS。 |
| Failure learning | `packages/tui/src/failure-learning-runtime.ts:1-18`, `:281-318`, `packages/tui/src/index.ts:8442-8461` | 只从真实失败事件提取，脱敏去重；summary 只进 system prompt 当风险提示，绝不进 `context.evidence`；自身失败不影响主链。 | Matrix 可把失败模式作为风险提示，不作为 evidence。 | 不得把 learning summary 纳入 Evidence Merge。 |
| Workspace Reference Cache | `packages/tui/src/workspace-reference-cache.ts:35-56`, `:111-130`, `:161-244`, `:245-270`, `:274-305` | hash/probe freshness；无时间 TTL；snapshot bounded；source hit/miss/stale/fallback-stale/fallback-empty；fallback 显式降级；保存 runtime/tool/evidence/log refs。 | Matrix 多 agent 共享 workspace refs，减少重复扫描和 token。 | 需要 matrix-level cache hit display；不能缓存完整源码/transcript/log。 |
| Workspace snapshot limits | `packages/tui/src/workspace-reference-cache.ts:5-33`, `:84-109` | 文件 hash 前 256KiB，top-level entries cap=80，跳过 `.git/node_modules/dist/coverage` 等。 | Matrix Task Surface 可以展示 snapshot/source/changedKeys。 | 无 TTL；freshness 是 hash/probe，不应宣称 time-based fresh。 |
| Deferred tools | `packages/tui/src/deferred-tools-catalog.ts:8-23`, `:30-66`, `:100-155`, `:157-213`, `:334-354` | codebase-memory readonly/mutating 分层；required args guard；SearchExtraTools -> ExecuteExtraTool；MCP 仅 discovered/schemaLoaded/trusted/local stdio 才 executable；skills/plugins metadata-only；hash 不含 raw schema/secret。 | Matrix planner/tool step 只能调用已 discovered/executable tools。 | 不得让 workflow 直接执行未发现 MCP/skill/plugin tool。 |
| Runner | `packages/tui/src/runner-runtime.ts:146-250`, `:357-399`, `:402-455`, `:724-749` | Native runner 默认可 fallback 到 Node/TUI；disabled/missing/protocol mismatch/start failure 走 node_fallback；runner 只执行 approved durable_job_supervisor spec；terminal/fallback non-PASS。 | Matrix long-running execution 可复用 runner adapter through job runtime。 | Runner 不是第二 scheduler/executor；不可执行 raw workflow commands。 |
| Remote/mobile | `packages/tui/src/remote-command-runtime.ts:280-304`, `:1220-1238`, `:1258-1313`, `:1325-1377`, `:1407-1506` | remote event 只含 redacted summary/refs/TTL/nonce/messageId；真实发送脱敏；approval 校验 channel/source/binding/signature/pendingLocalApproval；inbound 不执行 tools/Bash/write/Git，natural text 只 routedText 回本地主链；status query 返回 redacted status。 | 手机端只做入口/审批/状态摘要；Workflow Matrix mobile 视图应降噪成 phase/blocked/next-action summary。 | 不得形成第二套 remote executor；默认不推完整 matrix/log/transcript。 |
| CommandPanel/details UI | `packages/tui/src/command-panel-runtime.ts:6-22`, `:34-149`, `packages/tui/src/shell/types.ts:251-276`, `packages/tui/src/shell/view-model.ts:237-255`, `:395-399`, `:1013-1022` | 高级命令输出走 CommandPanel，不写 assistant transcript；summary/sections/actions/detailsText；Ctrl+O 展开 detailsText；background blocks 主屏聚合 running/failed，细节在 `/details background`。 | Workflow Task Surface 应复用现有 Task 区、background、agents 和 detailsText 链路，主屏展示短 matrix 摘要，完整表格进 details。 | 现有 Task 区还没有 workflow phase/agent matrix 的轻量摘要投影。 |
| CCB/Claude Code behavior reference | `F:\ccb-source\docs\extensibility\custom-agents.mdx:17-38`, `F:\ccb-source\docs\design\tool-search-design-guide.md:225-236`, `F:\ccb-source\docs\ccb-optimizations.md:437-470` | 本轮只核对行为形态：自定义 agents、有 maxTurns/模型等 metadata；延迟工具降低 token；cache/token 面板可展示 R/W tokens。 | 只借鉴 Task Surface/status/token/cache/tool discoverability 形态。 | 未复制 CCB 源码；不把 CCB team/swarm 实现搬入 Linghun。 |

## 3. Main Chain Boundaries

These boundaries are frozen for D.14H-B/C/D:

- 不能新增第二套 agent/job/evidence/permission/runtime。
- Workflow planner 只能生成计划、phase、feature slices、agent assignment proposals、受控 slash/tool 请求和 evidence merge views。
- 执行必须复用现有 `/job`、`/fork`、`/agents`、`/workflows`、agent runtime、durable job state、BackgroundTaskState、runner adapter 和 remote inbound bridge。
- 危险动作必须继续走 Start Gate + existing permission pipeline；Start Gate 不替代 `decidePermission`。
- `permissionMode` 仍只有 `default` / `auto-review` / `plan` / `full-access` 四档；workflow/matrix 不是第五权限模式。
- `full-access` 仍必须本地显式 opt-in；remote/workflow/agent/plugin/hook 不得静默开启。
- Plan mode 仍是只读边界；remote approve 或 workflow approve 不能在 plan 下执行 mutating operations。
- 结论必须继续过 evidence/final gate；agent summary、workflow Task Surface summary、job completed、runner completed 都不能冒充 verification PASS。
- failure learning 只能作为 prompt 风险提示，不进入 evidence merge。
- Workspace Reference Cache 只能提供 bounded refs/summaries，不能缓存或注入完整 transcript/source/index/log。
- Deferred tools 必须 discovery-before-execute；未发现、未 trusted、schema 未 loaded、required args 缺失时拒绝。
- Remote mobile 只能作为入口、审批、状态查询和摘要通知；不能成为第二套 executor。
- 默认 running cap 仍为 3；更多 agents/slices 必须 queued/sleeping/blocked，不默认并发烧 token。
- Workflow Matrix 不新增独立面板；默认展示必须复用现有 Task 区、background、agents、details 链路。
- 主屏只显示普惠摘要：当前 phase、agents done/running/blocked、evidence 数、token/cost 简要、next action。
- 完整 matrix 只在用户主动 Ctrl+O / `/details` / `/job report` / `/agents show` 时展开。
- 主屏保持降噪；完整 matrix、logs、Evidence Merge 明细放 Ctrl+O / detailsText / `/details` / `/job report` / `/agents show`。

## 4. Gap Analysis

### 已有

- 自然语言驱动多开智能体的入口层：catalog 已能把 `/job`、`/fork`、`/agents`、`/workflows` 映射到 readonly、Start Gate 或 permission pipeline；这不是入口缺失。
- job/agent 数据结构：`DurableJobState`、`DurableJobAgent`、`AgentRun`、`BackgroundTaskState`、`RoleRouteDecision`、`RoleHandoff` 已有 phase/target/plan、agent status、model/provider、budget、evidence refs、transcript refs、handoff、runner、logs/report。
- handoff：job 创建、resume、recovery 都校验 handoff；agent context summary 使用 trimmed handoff/evidence/key files。
- 缓存：Workspace Reference Cache 和 workspace snapshot lite 已支持 bounded summary、hash/probe freshness、fallback-stale/fallback-empty、evidence/log refs。
- 权限：四档 permission mode、pendingLocalApproval、`decidePermission`、Plan read-only、full-access opt-in、remote approval safety 已有。
- 证据：tool/verification/provider/architecture evidence 和 final gate 已有；verification pass 才支持 verified/tests passed。
- runner：Native runner resolver/adapter/fallback 已接 durable job，但只执行 approved durable job supervisor spec，non-PASS。
- remote：remote/mobile 已能做脱敏通知、审批、安全入站和状态查询，且明确不执行工具/Bash/写文件/Git。

### 缺口

- 动态 feature-sliced agent matrix：现有 durable job agents 是固定 index 分配（planner/worker/verifier/explorer），`goal#N`/displayName 派生，不是按用户任务自动拆 feature slice。
- Workflow Plan Schema：现有 `plan: string[]` 不足以表达 phase、slice、dependency、agent specialization、acceptance criteria、budget、tool allowance、evidence merge rule。
- Phase progression：没有 phase 列表的状态机、gap check、phase-to-phase transition guard 和“完成后停止等待用户确认”的 matrix 视图。
- Agent task specialization：`/fork` 只接收单 role + task；job agent metadata 缺 slice-specific allowed tools/model/budget/duration/tool stats。
- Evidence Merge：已有 evidence refs 和 final gate，但没有按 phase/agent/slice 聚合 PASS/PARTIAL/BLOCKED、claim support、conflict、adopt/reject 的 details 视图。
- Token/tools/duration 聚合视图：AgentRun 有 token 估算和 role usage，BackgroundTask 有 timing，Deferred tools 有 executable catalog，但没有 matrix row 级的 model/token/tools/duration 汇总。
- Task Surface：CommandPanel/background/detailsText 能承载，但现有 Task 区还没有 workflow phase/agent matrix 的轻量摘要投影。
- Mobile summary：remote 能发 redacted status，但没有把 matrix 降噪成手机摘要的格式。

## 5. Proposed D.14H-B/C/D Plan

### D.14H-B: Workflow Plan Schema

Goal: add a schema/design layer only after this audit, still without executing a second runtime.

Allowed:

- Define a Workflow Plan object that describes phases, feature slices, dependencies, agent roles, budgets, allowed tool classes, required evidence, acceptance criteria, and stop conditions.
- Map every executable step to an existing slash/runtime target such as `/job create`, `/job run`, `/fork`, `/verify`, `/review`, `/details evidence`, or existing tool calls.
- Include source refs and cache refs, not full source/log/transcript.

Not allowed:

- No new agent executor.
- No new job store.
- No new evidence type that can bypass final gate.
- No automatic phase progression without user confirmation.

### D.14H-C: Workflow Agent Runtime Bridge

Goal: bridge approved Workflow Plan slices into existing `/job` and `/fork` execution paths.

Allowed:

- Create controlled requests that invoke existing job/agent runtime.
- Use current role routing, background task table, resource guard, permission pipeline, runner fallback, handoff and transcript events.
- Keep default running cap at 3; extra slices become queued/sleeping/blocked.
- Use Workspace Reference Cache and deferred-tool discovery snapshots to avoid repeated context inflation.

Not allowed:

- No second scheduler/runtime.
- No direct Write/Bash/remote execution from planner output.
- No raw user command passed to native runner.
- No agent summary as verification evidence.

### D.14H-D: Workflow Task Surface + Evidence Merge

Goal: present workflow state inside the existing Task/background/agents surfaces, not as a new independent panel or log spam.

Allowed:

- Show a workflow summary at the bottom of the existing Task area: current phase, agents done/running/blocked, evidence count, token/cost summary, next action.
- Keep background and agent lists on the existing `/background`, `/agents`, and `/job` paths.
- Put full agent matrix/details/Evidence Merge into `detailsText` / Ctrl+O / `/details` / `/job report` / `/agents show`.
- Merge evidence refs conservatively: PASS only from existing verification/tool evidence that final gate already accepts.
- Add mobile-safe summary formatting only: current phase, blocked items, approvals needed, next command, no raw transcript/log/source and no full matrix push.

Not allowed:

- No UI field may imply PASS from job completed/agent completed.
- No Task Surface auto-advances phases.
- No independent Workflow Dashboard page.
- No remote full-matrix push by default.
- CommandPanel only carries details/status; it must not become a new advanced feature island.

## 6. Acceptance Criteria For Future Stages

Future D.14H-B/C/D stages must satisfy all of the following:

- 不复制 Claude Code / CCB / OpenCode / 第三方源码、内部 API、反编译痕迹或专有实现。
- 不放松权限；危险动作继续走 Start Gate + `decidePermission` + pendingLocalApproval/PermissionPanel。
- 不恢复本地自然语言关键词截获；自然语言入口必须走 Command Capability Catalog / slash dispatcher / model main chain。
- 不让 agent summary 冒充 PASS。
- 不让 completed job 或 runner completed 冒充验证通过。
- 不让 workflow 变成 token 乘法；默认真实 running cap 仍为 3。
- 不注入完整 transcript/source/index/log；只传 trimmed refs、bounded summaries、workspace cache refs、evidence refs。
- 不执行未发现、未 trusted、schema 未 loaded 或 required args 缺失的 deferred tools。
- 不让 remote/mobile 成为第二 executor；手机端只做入口、审批、状态查询和脱敏摘要。
- 主屏降噪，details 承载完整内容；Workflow Task Surface 默认不是日志刷屏，也不是独立面板。
- 每个 phase 完成后停止在用户确认点；普通“继续/确认/yes”不能作为跨阶段授权。
- Evidence merge 必须保守：failure learning、remote event、agent/job summary 只能作为 context/risk/status，不能作为 PASS evidence。

## Reference Check

Actually read in this audit:

- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- Selected completed delivery docs: `phase-14C-multi-agent-baseline-closure.md`, `phase-15-5a-performance-context.md`, `phase-15-5b-resource-task-lifecycle.md`, `phase-16-controlled-learning-memory-skill-evolution.md`, `phase-17a-local-durable-jobs-virtual-agent-concurrency.md`, `phase-17b-remote-channels.md`, `phase-17c-native-runner-job-supervisor-gate.md`
- Requested Linghun source files listed in the user request.
- Local CCB references only for behavior shape: `F:\ccb-source\docs\extensibility\custom-agents.mdx`, `F:\ccb-source\docs\design\tool-search-design-guide.md`, `F:\ccb-source\docs\ccb-optimizations.md`, plus targeted `rg` over `F:\ccb-source`.

Reference use:

- CCB/Claude Code style was used only to compare behavior shape: agent metadata, status visibility, deferred tool/cache/token status ideas.
- Entering Linghun future design: Task Surface/status/token/cache/tool-discovery behavior boundaries only.
- Not copied: no CCB / Claude Code / OpenCode source implementation, internal API, private protocol, telemetry, or proprietary logic.

## Validation Plan For This Audit

This D.14H-A deliverable is read-only except this report file. Required validation:

- `git diff --check`
- Secret scan excluding `.claude/**`, `node_modules/**`, `dist/**`, `coverage/**`
