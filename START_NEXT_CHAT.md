# 新对话启动提示

复制下面这段给新的 AI 会话：

```text
请先读取并遵守以下文件：

1. F:\Linghun\CLAUDE.md
2. F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md
3. F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md
4. F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md
5. F:\Linghun\docs\delivery\README.md
6. F:\Linghun\docs\delivery\phase-00-design-freeze.md
7. F:\Linghun\docs\delivery\phase-01-project-skeleton.md
8. F:\Linghun\docs\delivery\phase-02-session-transcript.md
9. F:\Linghun\docs\delivery\phase-03-model-gateway.md
10. F:\Linghun\docs\delivery\phase-04-tui-mvp.md
11. F:\Linghun\docs\delivery\phase-05-core-tools.md
12. F:\Linghun\docs\delivery\phase-06-permissions-plan.md
13. F:\Linghun\docs\delivery\phase-07-behavior-guardrail.md
14. F:\Linghun\docs\delivery\phase-08-verification.md
15. F:\Linghun\docs\delivery\phase-09-cache-cost.md
16. F:\Linghun\docs\delivery\phase-10-mcp-index.md
17. F:\Linghun\docs\delivery\phase-11-sessions-memory.md
18. F:\Linghun\docs\delivery\phase-12-agents.md
19. F:\Linghun\docs\delivery\phase-13-multi-model.md
20. F:\Linghun\docs\delivery\phase-14-skills-workflow.md
21. F:\Linghun\docs\delivery\phase-15-natural-command-bridge.md
22. F:\Linghun\docs\audit\PHASE_15_PREFLIGHT_INTERACTION_REVIEW_REPORT.md
23. F:\Linghun\docs\audit\phase-15-pre-beta-cross-review-report.md
24. F:\Linghun\docs\audit\phase-15-pre-beta-ccb-coding-experience-parity-audit.md
25. F:\Linghun\docs\audit\phase-15-pre-beta-ccb-interaction-parity-audit-v2.md
26. F:\Linghun\docs\audit\phase-15-pre-beta-ccb-full-parity-audit.md
27. F:\Linghun\docs\audit\reference-map.md
28. F:\Linghun\docs\audit\phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md

这是 Linghun 项目的阶段开发仓库。请严格按阶段蓝图推进，不要跳阶段，不要提前实现后续功能。

说明：这份启动提示只适用于继续开发 Linghun 仓库本身。Linghun 产品面向任意项目运行时，项目规则主入口是项目根目录 `LINGHUN.md`；`AGENTS.md` / `CLAUDE.md` 仅作为兼容导入或迁移来源。本仓库开发 Linghun 自身时，才必须额外读取 `CLAUDE.md`、蓝图、规格书和阶段交付文档。

当前状态：
- Phase 00 设计冻结与基线确认已完成。
- Phase 01 工程骨架闭环已完成。
- Phase 02 Session 与 JSONL transcript 闭环已完成。
- Phase 03 模型网关最小闭环已完成。
- Phase 04 TUI / REPL 最小闭环已完成。
- Phase 05 核心工具闭环已完成。
- Phase 06 权限与 Plan 闭环已完成。
- Phase 07 工程行为控制闭环已完成。
- Phase 08 代码自检与验证增强闭环已完成。
- Phase 09 缓存与成本闭环已完成。
- Phase 10 MCP 与 codebase-memory 外部 CLI 最小闭环已完成；这不代表 codebase-memory 已随 Linghun 内置、固定版本、免安装或达到开源发布成熟度。Bundled codebase-memory Lite 必须作为 Phase 15 Beta 前尾项或 Phase 15.5 开源前 hardening 独立验收。
- Phase 11 会话交接与记忆闭环已完成。
- Phase 12 Agent 闭环已完成。
- Phase 13 多模型协作闭环已完成。
- Phase 14 Skills 与工作流主闭环已完成。
- Phase 14 hardening 已完成：Skills / Workflows / Hooks / Plugins 稳定性与安全边界已加固。
- Phase 15 preflight hardening 已完成：Natural Command Bridge / 自然语言控制桥已接入 Command Capability Catalog、本地 intent router、RuntimeStatusForModel、高风险自然语言阻断、Catalog/dispatch 漂移检测、关键参数提取、pending Start Gate 过期/精确确认，以及 `full-access` / `auto-review` / `plan` canonical 边界；历史 `acceptEdits` / `auto` / `bypass` / `dontAsk` 仅作为 legacy alias 或历史证据，不再是用户可见主模式。
- Phase 15 preflight hardening follow-up 已完成：`/memory init` 的默认 `LINGHUN.md` 已从简单占位升级为中文“项目规则”模板；已有 `LINGHUN.md` 继续不静默覆盖；本 follow-up 只做模板 cleanup，不进入 Phase 15 Beta / Phase 15.5 / Phase 16+。
- Phase 15 pre-Beta cleanup 已完成：根据 `docs/audit/phase-15-pre-beta-cross-review-report.md` 做最小修复，RuntimeStatus provider 不再 fallback 为 deepseek，缺失时为 unknown；TUI 标题去掉 Phase 14；pluginListHash / extension freshness 增加顺序稳定性补测；DeepSeek V4 Pro 报告中的 catalog/dispatch registry-map 重构不在本轮执行，只保留 drift detection + coverage test。
- Phase 15 Natural Intent Contract 成品级手感硬化已完成：自然语言桥已区分 status_query、doctor_query、usage_help、safe_action_request、config_change_request、dangerous_action_request 和 ambiguous_request，避免“现在是什么模型”等状态查询退化成命令用法提示；这属于 Phase 15 preflight 收口，不是新阶段。
- Phase 15 pre-Beta CCB Interaction Parity Audit v2 已完成并登记，且 Phase 15 pre-Beta Interaction P1 cleanup 已完成：`recordModelUsage`、`/stats`、`/usage` fallback、handoff packet 不再伪造 `deepseek`，改用真实 provider 或 `unknown`；Start Gate 默认主输出已改为 human-first decision prompt，不暴露 gateId、expiresAt、raw risk flags、writesConfig、permissionPipeline、logPath 等内部字段，同时保留 exact command 唯一确认路径和权限管道。
- Phase 15 pre-Beta CCB Full Parity Audit 已完成：`docs/audit/phase-15-pre-beta-ccb-full-parity-audit.md`。覆盖 20 个审计面、CCB 主链路证据、Linghun 主链路证据、完整差距矩阵、P0/P1/P2 清单。该报告当时认为不阻塞 Beta，但已被后续 Full Interaction Maturity Audit 的审计后裁决 supersede：Phase 15 Beta 继续暂停，P0-1 到 P0-6 必须先全量闭环；原报告中的 3 项 P1 仍登记到 Phase 15.5。
- Phase 15 pre-Beta Interaction Maturity Fix 已完成：状态/完成度查询优先只读 RuntimeStatus 或等价 slash handler；`索引已经建立了是吧` / `is the index ready` 不再触发 `/index init fast`；只读能力不进入 Start Gate；项目规则自然语言入口读取当前项目 `LINGHUN.md`，缺失时只提示 `/memory init`；zh-CN 默认输出不混入英文 Gate 模板；低置信度澄清改为自然语言方向和风险摘要。
- Phase 15 pre-Beta Solution Completeness Gate 已登记为当前新增质量门：当真实 TUI smoke 暴露同类交互/能力问题反复出现、用户要求成品级或要求对照 CCB/OpenCode 等成熟参考时，必须先判断单点 bug / 系统性缺口，列影响面、参考源、P0/P1/P2、阶段边界和验证方式，再给修复命令；不得发现一个现象补一个关键词。该闸门应在当前完整交互审计与修复后收口，收口前不得进入 Phase 15 Beta。
- Phase 15 pre-Beta Full Interaction Maturity Audit 已完成：`F:\Linghun\PHASE_15_PRE_BETA_FULL_INTERACTION_MATURITY_AUDIT.md`。审计后裁决已写入蓝图/规格/交付文档：Phase 15 Beta 继续暂停，必须一次性修复 P0-1~P0-6；P0-1 必须做完整 tool_use/tool_result 工具协议 + 统一权限中枢，不得只做 Read/Grep/Glob 弱化版，也不得用模型文本 hint 冒充工具调用；P0-3 同时包含新手轻引导和默认 `LINGHUN.md` 模板成熟度，模板必须提炼最小必要改动、禁止顺手修、减少屎山、重构边界、高风险先说明和最小验证。
- Phase 15 pre-Beta Full Interaction P0 hardening 已完成本地闭环并通过独立 verification gate：Provider / TUI 支持真实 `tool_use` / `tool_result`，核心工具 schema 覆盖 Read/Grep/Glob/Diff/Write/Edit/MultiEdit/Bash/Todo；模型工具调用复用 `decidePermission()`、plan / auto-review / full-access / legacy alias normalization、硬拒绝安全检查和 `runTool()`；自然语言读文件支持明确路径、最近文件、模糊候选；`EvidenceSummary` 与 `tool_result` / `evidence_record` 同源；模型流、`/interrupt`、SIGINT 和 Bash 工具调用接入 abort；en-US 覆盖 unknown command、error、light hint、缺失 `LINGHUN.md` 提示等关键路径；2026-05-17 独立复检 verdict: PASS，必跑 test/typecheck/build/lowercase+uppercase help 均通过，额外 lint、focused P0 tests 和 TUI smoke 通过，无需最小修复。
- Phase 15 pre-Beta Deep Parity Closure blocking P1 fix 已完成本地最小实现：SC-1 通过轻量 Solution Completeness Gate workflow/prompt/handoff check 关闭（显式“成品级/不要缝补/先看 CCB/有没有漏”或同类 denied 反复出现时注入 `SYSTEMIC_GAP_WARNING`，要求先判断 `single_issue / systemic_gap`、影响面、P0/P1/P2、阶段边界和验证方式）；BASH-1 通过兼容 `ToolContext.onProgress` chunk 回调关闭，Bash stdout/stderr/system chunk 会写入 `tool_call_delta`、刷新 background task 并即时输出，最终 `ToolOutput`/exitCode/error/timeout/abortSignal 兼容。未做完整 runtime guard、AsyncGenerator 工具大改、registry/dispatch 重构、完整 TUI 美化、FreshnessGate/web_source runtime、新手向导或 Phase 15.5/16+ 内容。
- Phase 15 pre-Beta Final Real TUI / Provider Smoke P0+blocking P1 fix 已完成本地最小实现：NCB-INDEX-1 覆盖“更新/刷新/同步/重建/重新索引/重做索引”和状态查询；OUT-1 在 `formatToolOutput()` 做 Todo 8 条和 Read/Grep/Glob 长输出主输出截断，完整结果保留在 transcript/evidence/fullOutputPath；PROV-1 在 TUI 与 ModelGateway 两层检查 `supportsTools=false` 时不发送 tools/toolChoice，并在 doctor 中暴露 tools/tool calling 能力不足；NCB-INDEX-2 更新 `/index` help/risk 文案，声明 status/search/architecture 只读、init/refresh 需确认；DOC-1 实现 `/model doctor` → `Model route doctor`。未进入 Phase 15 Beta / Phase 15.5 / Phase 16+，未修非阻塞 P1/P2，未做 registry/dispatch 大重构、完整 TUI 美化、完整 output grouping/details/debug、完整 provider adapter 重构或 FreshnessGate/web_source runtime。
- Phase 15 Beta 前 CCB handfeel gate 最小源码级修复已完成本地闭环：TUI 初始模型、gateway provider、状态栏和 `/model doctor` 不再 hardcode deepseek，按 `defaultModel` / role route / provider config 解析真实 provider/model；default 模式不再静默执行 Bash/write/edit/delete/config/install/network/permission 类工具；无 pending gate 的 `yes/确认/继续/ok` 本地提示且不进模型；`帮我打开 mcp 的索引功能` 走本地控制面说明；provider HTTP 400/429/5xx 分类给出 base_url/model/tools/tool_choice/tool_result 下一步；doctor 展示 provider source + present/missing + masked preview 且不泄露 key。已补 focused 行为测试并通过 full validation；未进入 Phase 15 Beta / Phase 15.5 / Phase 16+，未做 registry/dispatch 大重构或第二套命令解释系统。
- Phase 15 Beta 前 Whole-System Interaction Boundary Reconciliation Audit 已完成：报告路径 `F:\Linghun\docs\audit\phase-15-pre-beta-whole-system-interaction-boundary-reconciliation.md`。本轮只读对照 Phase 00-15 已交付交互边界与 CCB / CCB Dev Boost 成熟行为，verdict 为 CONDITIONAL / BLOCKED FOR PHASE 15 BETA RESUME；P0=0，阻塞 P1=4，过度设计=4，设计不足=7，阶段错位=3。
- Phase 15 Beta 前 Whole-System Interaction Boundary 最小完整修复已完成本地最小实现：BP1-1 composite local status 覆盖 model/provider、index、permission、cache、memory、mcp、background、gate；BP1-2 模型 tool permission ask/deny 输出本地 primary prompt（tool/decision/risk/mode/reason/scope/next）；BP1-3 失败 tool_result 和 permission denial 记录轻量 failure evidence 并回填 evidenceId；BP1-4 index safety pause 输出阻塞原因、`.linghunignore` / `.cbmignore`、建议条目、手动或明确 `/write` 路径、`/index refresh` retry，并写入 index evidence。已补 focused tests；当时口径曾认为可建议恢复 Phase 15 真人 smoke，但该判断已被 2026-05-19 全量审计后的 CCB Maturity Remediation baseline supersede；未进入 Phase 15.5 / Phase 16+。
- Phase 15 pre-Beta CCB Maturity Baseline Closure 已完成本地最小源码级收敛：新增轻量 presenter/classifier 模块，避免继续把 tool output、permission prompt、runtime status 和 index safety continuation 逻辑堆进 `packages/tui/src/index.ts`；`ToolOutput` 增加 summary/preview/details/evidenceId 分层字段；模型工具权限提示保留 tool/decision/risk/mode/reason/scope/next 并明确 refusal 已回灌 tool_result evidence；runtime status 由独立 presenter 输出；index safety repair continuation 改为基于 active safety blocker state 的结构化 classifier，不再靠单个固定 regex 函数；补 focused tests 覆盖 classifier 与 layered output。随后补齐 Solution Completeness Gate follow-up：运行时状态升级为轻量 decision（trigger/classification/impact/severity/evidence/source/nextRequiredOutput），明确触发时注入 SYSTEMIC_GAP_WARNING、写入 transcript system_event、handoff packet 和交付报告；普通请求默认无感，重复同类 permission denial 判为 systemic_gap/blocking_P1。未进入 Phase 15 Beta / Phase 15.5 / Phase 16+，未复制 CCB/Claude Code/OpenCode 源码。
- Phase 15 pre-Beta Source-level Runtime/Output/Permission Parity Closure 已完成本地最小源码级收口：以 `F:\ccb-source` 为 oracle 提取 Runtime Workflow、Output Rendering、Permission & Continuation inventory，并映射 Linghun Phase 00-14 已声明能力；报告路径 `F:\Linghun\docs\audit\phase-15-pre-beta-source-level-runtime-output-permission-parity.md`。本轮修复 permission prompt 主屏 raw `decision:` / `risk:` / `mode:` 泄漏，改为人话化 primary prompt；index safety blocker 改为 primary/details/evidence 分层，主屏只显示风险数量/阻塞原因/修复路径，完整风险文件列表写入 transcript/evidence；index repair continuation 成功后只输出短成功摘要并提示 `/index status` 查看详情；Bash output presenter 增加主屏截断边界，确保 Bash 与 Read/Grep/Glob/Todo/Write/Edit 一样 summary-first。Focused tests 已覆盖 raw 字段不进主屏、风险清单只进 evidence、yes 后短摘要、no 不写不刷新、Bash 长输出截断、zh/en 关键路径。未进入 Phase 15 Beta / Phase 15.5 / Phase 16+，未复制 CCB/Claude Code/OpenCode 源码。
- Phase 15 pre-Beta End-to-End CCB User Journey Parity Closure 已完成本地最小源码级收口：报告路径 `F:\Linghun\docs\audit\phase-15-pre-beta-end-to-end-ccb-user-journey-parity-closure.md`，覆盖 J01-J24 共 24 个 CCB user journey / Linghun gap mapping。已关闭 pre-repair FAIL/PARTIAL：J01、J02、J05、J07、J08、J13、J19、J20、J23、J24；`/index init fast` 与 `/index refresh` 成功路径改为短摘要且完整状态只在 `/index status`，permission prompt / Start Gate confirmation 不再在主屏暴露 raw-like mode/risk/mode/gate id，重复 permission denial 不再让普通任务强制输出 `systemic_gap` / `blocking_P1`，Bash live progress 主屏限流并保留 fullOutputPath/log/transcript，slash tool result 显示 concise evidence reference。新增 continuous journey smoke 覆盖 startup/help/index/no-pending confirmation/model loop/Write permission/Bash long output/model-MCP-cache-permissions-index controls/exit。未进入 Phase 15 Beta / Phase 15.5 / Phase 16+，未复制 CCB/Claude Code/OpenCode 源码。
- Phase 15 pre-Beta CCB-grade Runtime Acceptance Closure 已完成本地最小源码级收口：报告路径 `F:\Linghun\docs\audit\phase-15-pre-beta-ccb-grade-runtime-acceptance-closure.md`。本轮关闭真实 Windows TUI 中“状态：正在请求模型...”后静默回到 prompt 的 P0/P1 silent failure：OpenAI-compatible parser 覆盖 `delta.content`、reasoning-only、fragmented/indexed tool calls、`message.content` / `message.tool_calls` fallback、finish reason、usage-only、empty choices、provider error object、malformed JSON/SSE，并新增 `message_stop` outcome metadata；TUI model loop 增加 empty-response invariant，空响应输出 `模型返回空响应；请运行 /model doctor，或切换 provider/model 后重试。` + evidence id，并写入 safe evidence/system_event；focused provider/TUI tests、full test/check/typecheck/build/help/diff-check 均通过；`corepack pnpm smoke:live-provider` initial closure run 因当前 shell 缺 env key 为 SKIPPED（不得记为 PASS），随后 temporary shell env only live provider 補验对 `openai-compatible / gpt-5.5` basic text smoke 为 PASS；`F:\linghun-ceshi` real stdin smoke 用 built CLI 通过 silent-failure ban。Real TUI report-generation 補验仍为 PARTIAL：报告文件未写入，未观察到 `tool_use` / permission continuation / `tool_result`；后续 `yes` 因无 pending confirmation 被本地处理，没有发送给模型；tools + exact deployment-report provider probe 返回 HTTP 400 request-format diagnostics，指向当前 `tools/tool_choice` schema 与 openai-compatible gateway 兼容性，或当前 model/gateway 对该请求未产生 text/tool delta。Phase 15 Beta readiness 仍为 PARTIAL；不得从 live text PASS 推断 Beta readiness PASS，也不得从 runtime silent-failure PASS 推断真实报告生成路径 PASS；若 Phase 15 Beta gate 要求真实 provider 完成该报告生成路径，必须先按 P1 修复。未进入 Phase 15 Beta / Phase 15.5 / Phase 16+，未复制 CCB/Claude Code/OpenCode 源码。
- Phase 15 pre-Beta Verdict Evidence Gate / Anti-Hallucination Readiness Closure 已完成本地最小源码级收口：报告路径 `F:\Linghun\docs\audit\phase-15-pre-beta-verdict-evidence-gate.md`。本轮把反幻觉从代码事实 evidence-first 扩展到完成度结论 evidence-first：新增 verdict scope/status/evidence/validation/uncovered/risk/nextAction 轻量结构，handoff packet 记录 `verdictEvidence`，`/claim-check Phase 15 Beta readiness is PASS` 在缺 real TUI report-generation PASS evidence 时只读返回 PARTIAL；普通开发请求不显示 Verdict Evidence Gate、coverage matrix、systemic_gap 或 verdict 内部术语。降级规则已登记：live provider smoke SKIPPED => Beta readiness 只能 PARTIAL；mock PASS != live PASS；focused PASS != overall readiness PASS；journey PASS + live provider missing => PARTIAL；未测 critical path => PARTIAL；silent failure => FAIL/PARTIAL；no evidence refs => invalid/PARTIAL；P0 open => FAIL；blocking P1 open => PARTIAL/FAIL。live provider smoke 若未 PASS 或未覆盖 real TUI report-generation path，Phase 15 Beta readiness 仍为 PARTIAL。未进入 Phase 15 Beta / Phase 15.5 / Phase 16+。
- Phase 00-18 Design + Runtime Overdesign Full Audit 曾在 2026-05-19 合并为历史执行基线：`F:\Linghun\PHASE_15_BETA_CCB_MATURITY_REMEDIATION_BASELINE.md`。该历史基线只作为 evidence / traceability，不再作为当前执行入口；当前 pre-smoke 执行基线已由 `F:\Linghun\docs\audit\phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md` 覆盖。2026-05-21 `docs/audit/phase-15-pre-beta-verification-guard-and-index-runtime-smoke.md` 只记录 Phase 15 Batch 1/2/3 focused/mock/local verification guard 与 MCP/index runtime smoke 的历史验证；Batch 3.5 以最新 Batch 3.5 报告和开发窗口验证结果作为历史 evidence；2026-05-20 `docs/audit/phase-15-ccb-grade-default-runtime-reconciliation.md` 只作为历史 reconciliation 输入和 pull-forward / keep-deferred 依据。Phase 15 Beta readiness 仍为 PARTIAL/BLOCKED；不得从 focused PASS、mock PASS、local PASS、scoped PASS、Batch 3.5 PASS、单个 live text PASS、SKIPPED/PENDING smoke 或 silent-failure ban PASS 推断 Beta readiness PASS；完成当前 pre-smoke Batch A-C 并重新验收前，不得进入真实项目 smoke、Phase 15 Beta、Phase 15.5 或 Phase 16+。
- Baseline 第 12 节 `Deferred Issue Register` 和第 13 节 `Audit Traceability Matrix` 是两份全量审计后置项与小类别成熟度细节的唯一集中追踪表。Phase 15.5 / 16 / 17 / 18 开工时必须复制相关 rows 到该阶段交付文档并逐项裁决 DONE / DEFERRED / NOT-DO，避免后置项和小细节散落或遗忘。

当前任务状态：Phase 15 Pre-Smoke Full Reference Parity Audit + Permission / Architecture Runtime Feasibility + Source-of-Truth Reset 已完成，当前 pre-smoke 执行基线为 `F:\Linghun\docs\audit\phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md`。Phase 15 Beta readiness 仍为 PARTIAL/BLOCKED；下一步不是自动进入 Phase 15 Beta，也不是进入 Phase 15.5 / 16+。当前唯一下一步只能是：先完成本报告要求的 active docs 同步，然后执行 Batch A-C：四权限模式收口、Architecture Runtime source-of-truth 设计、Architecture Runtime 最小成熟实现；完成前不得进入真实项目 smoke。旧的 focused/mock/local/scoped PASS、Batch 3.5 PASS、单个 live text PASS、SKIPPED/PENDING smoke、silent-failure ban PASS 或本报告 `READY_TO_IMPLEMENT` 都不得推断 Beta readiness PASS。

文档补强状态：
- Phase 13 已补成品级角色路由验收：路由决策可审计、fallback/预算可诊断、角色贡献和成本可见、角色间只传结构化摘要和证据。
- Phase 14 已补 Skills / Hooks / Plugins 加载边界：summary-first、load-on-demand、第三方来源/权限/信任级别可见、失败隔离、稳定排序、Start Gate 和权限管道不可绕过。
- Phase 14 已补主闭环 / hardening 分段边界：主闭环只做本地 loader、doctor、启停、信任和权限接入；hardening 再补稳定排序、缓存 hash、失败隔离、hook 超时、大输出截断和 workflow 验收；GitHub 安装/插件市场不混入主闭环。
- Phase 15 前新增 Natural Command Bridge preflight：普通自然语言必须能查看/控制高频 Linghun 状态，底层 intent router 负责裁决，模型只负责解释；这不是关键词补丁，也不能做成弱化版。必须参考 CCB 的公开行为边界，以 Command Capability Catalog 暴露中英文 description/whenToUse、modelInvocable、bridgeSafe、risk 和 Start Gate 信息。Catalog 必须覆盖所有用户可见 slash 命令，隐藏/内部命令显式标记；只读状态直接回答，索引/模型/模式/workflow 等动作走 Start Gate，写文件/Bash/权限规则/第三方启用/force/remote 等不得自然语言直通。
- Phase 15 pre-Beta P0 hardening 口径：参考 CCB 的公开成熟边界，但不复制源码。必须实现真实 tool_use/tool_result，核心工具 schema 覆盖 Read/Grep/Glob/Diff/Write/Edit/MultiEdit/Bash/Todo；执行层复用现有工具实现、Start Gate、decidePermission、plan / auto-review / full-access / legacy alias normalization 和安全检查；`acceptEdits` / `auto` / `bypass` / `dontAsk` 只作为 legacy alias 或历史证据，不再是用户可见主模式；危险工具不得因来自模型 tool_use 而绕过审批。
- Phase 15 pre-Beta CCB / CCB Dev Boost Deep Parity Closure 已登记为 P0 hardening 后的候选质量门，不是当前自动执行阶段。P0 报告出来后再决定是否启动；目标是确认 Phase 00-14 的实际使用体验、交互细节、建议/提权、错误/doctor/help、自然语言入口、cache/index/memory、多模型协作和 TUI 基础手感达到 CCB / CCB Dev Boost 公开成熟行为的核心体验等价。P0 / 阻塞 P1 必须在 Beta 前修复，非阻塞 P2 才登记到 Phase 15.5。
- 默认 `LINGHUN.md` 模板成熟度已纳入 P0-3：升级 `/memory init` 未来生成的模板和 focused tests，不静默覆盖已有 `LINGHUN.md`，不把 `F:\linghun-ceshi\linghun-副本.md` 原样塞入默认模板，只提炼核心工程纪律。
- Natural Intent Contract 已写入规格和 Phase 15 交付文档：同一 capability 下必须继续区分状态查询、doctor 查询、用法/风险询问、安全动作、配置变更、高风险动作和模糊请求。例如“现在是什么模型”必须返回真实 provider/model 状态和角色路由短摘要，不得只返回 `/model route` 用法；“模型 key 配好了吗”必须进入 doctor 诊断；“/model 怎么用”才返回用法说明。
- Phase 15 pre-smoke 新基线已写入 `F:\Linghun\docs\audit\phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md`：进入真实项目 smoke 前必须先完成 Batch A-C；这属于 Phase 15 pre-smoke 收口，不是 Phase 15.5 / 16+。
- 权限/提权交互必须显示 exact action、risk、scope、reason、rollback 和 choices；Start Gate 不替代权限审批。用户可见权限模式必须收口为 `default` / `auto-review` / `plan` / `full-access`；`acceptEdits` / `auto` / `bypass` / `dontAsk` 只作为 legacy alias 或历史证据，`full-access` 必须本地显式 opt-in，`auto-review` 不得绕过 Bash、联网、依赖、权限、第三方扩展、越界路径、hook/job/remote 等高风险审批。
- Architecture Runtime 是 Phase 15 smoke 前必须拉入的底层工程判断能力，负责工程方向、技术选择、拆解、风险、验证路线和长期可维护性；它不是第五个权限模式、不是 Plan Mode、不是 skill、不是 prompt-only 文案，必须与 Anti-Hallucination Runtime 的 facts/evidence/source/boundaries 协作。v1 必须保持轻量：普通对话链路前的工程判断 guard，不新增 agent、ADR 数据库、完整 spec 平台或强制计划模式；最小实现围绕 `shouldTriggerArchitectureRuntime`、`collectArchitectureFacts`、`formatArchitectureCard`、`detectArchitectureDrift`。涉及最新版本、provider/API 当前行为、社区项目现状、模型价格、安全公告、部署平台规则或第三方方案对比时，必须按需走 Freshness/Web Evidence，未授权联网或联网失败只能写 unknown/stale，不得把模型记忆写成当前事实。
- Phase 15 后新增 Phase 15.5：双模型交叉审查、MCP / Skills / Plugins Connect Lite、Bundled codebase-memory Lite、Compact Lite、Write/Edit/MultiEdit CCB-grade editing UX、provider maturity、Freshness/web evidence、release/open-source readiness、终端 TUI polish 清零与开源前 hardening。GPT-5.5/Claude 做产品架构审查，DeepSeek V4 Pro 做代码安全审查；Beta 实测期间可以按 P0/P1/P2 分类，非 terminal-scope P2 可登记后续，但终端开源发布前 terminal-scope P0/P1/P2 必须清零、降级为 NOT-DO，或证明 out-of-scope；不得把 Phase 15 Beta 已需的基础 TUI 手感留到本阶段。
- Phase 15.5 Compact Lite 必须参考 CCB 的三层成熟边界，但不复制实现：默认自动 MicroCompact 只本地清理旧大工具结果且不调用 summarizer；手动 `/compact` 生成结构化摘要和 CompactBoundary；可选 autoCompact 只在用户 opt-in 或明确自动任务模式下由阈值触发，且必须先写 HandoffCheckpoint、支持 timeout/cancel/retry/cooldown，失败时保留原会话并输出恢复命令。compact 过程中不得执行工具、改文件、写长期记忆或启动新开发任务。
- Phase 15.5 必须安排 TUI runtime maintainability hardening：`packages/tui/src/index.ts` 接近或超过万行时，分批抽出 provider/model resolver、index/MCP runtime、doctor/status/help presenter、tool output/background/permission/compact-context 等稳定职责。拆分必须行为保持、测试先行、小 diff；不得混入新功能、UI 重写、权限语义变化或 Phase 16+ 能力，也不得阻塞 Phase 15 真实项目 smoke。
- Phase 15.5 已补 release readiness / open-source readiness：安装、CLI 入口、Windows 大小写 shim、doctor、keychain/密钥脱敏、debug bundle、配置 schema、升级回滚、文档同步和 discovery-before-execute 工具 guard 都要检查；MCP / Skills / Plugins Connect Lite 必须覆盖显式 add/install、validate、enable/disable/remove/update、trust notice、doctor、来源/commit/权限记录和失败隔离，但不得扩展成插件市场、技能市场、评分推荐、自动更新或云同步；CCB / Claude Code Best v2.4.3 只作为公开行为参考，吸收“未发现/未加载 schema 的延迟工具不得执行”的 runtime guard，不复制实现。
- Phase 15.5 已补模型接入成熟度收口：provider adapter 不能只验证返回文本，必须覆盖 native/gateway/custom profile、capability doctor、role route doctor、usage/cache 来源、quota/balance 来源、provider error classifier、fallback/retry 审计、配置优先级和 key 脱敏；OpenAI-compatible / Claude-compatible 中转站只能降低接入门槛，不能假装能力、usage、cache、quota 和 tool calling 与官方 native provider 完全等价。
- Phase 15.5 已补联网取证成熟度收口：反幻觉不是禁止联网，而是本地证据优先、实时信息触发 Freshness Gate、未授权联网先询问、已授权联网优先官方来源、结果写入 `web_source` evidence、失败降级；未联网或无新鲜 web evidence 不得声称最新版本、当前价格、当前 API 行为或社区现状。
- Phase 15 Beta 前已新增 TUI output/report gate：基础 CCB 手感必须在 Beta 前闭合，包括真实 provider/model 状态、默认权限不静默跑 Bash、控制面请求本地处理、primary/details/debug 输出分层、权限提示人话、tool_result 摘要、doctor/key 脱敏、状态栏准确、hint 去重、长输出落 fullOutputPath/log、阶段汇报 verdict/evidence/validation/risk/next action。Phase 15.5 只承接非阻塞 polish、模型接入成熟度、联网取证成熟度和开源前 hardening；Phase 18 只做桌面端壳、IPC/API 和 core 复用验证，不负责补基础终端交互。
- Phase 15.5 已补 Solution Completeness Gate 复检：双模型审查和真实项目测试报告中的缺陷必须先分类为单点修复、系统性缺口、后续登记或不做；系统性缺口要给最小完整修复边界，避免 Phase 15.5 继续补丁化。
- Phase 15 CCB workflow parity 是总基线对齐：先从 CCB 源码提取 workflow inventory，再映射 Linghun Phase 00-14 已声明能力和 Phase 15 Beta handfeel gate，P0 / blocking P1 必须在 Phase 15 pre-Beta 源码级闭口。Phase 16-18 后续只做 delta parity audit，审新增能力、成熟参考边界、权限/成本/幻觉/长期状态风险和是否破坏 Phase 15 默认 CCB 手感；若发现基础手感回归，按回归或遗漏处理，不得登记为普通 polish。
- Phase 15 已补 provider quota / balance 查询设计：参考 CC Switch usage query 的公开行为和边界，区分 local_limit、provider_usage、provider_quota、billing_reconciled；官方订阅可自动查的才标记 official/oauth，第三方中转站和私有服务走 template/custom_script，查不到标记 unknown。
- Phase 15 命中率口径已改成目标观察区间：92%-96% 是稳定样本目标，不是任意模型/项目/provider 的硬承诺；硬验收是 usage 来源、公式、endpoint 拆分、break-cache 诊断和账单/usage 抽样对账。
- Phase 16 已补可控学习成本边界：默认不每轮学习、不自动接受长期记忆；候选优先来自 evidence/Todo/验证/handoff，必要总结走低成本 summarizer role；prompt 只注入少量相关记忆摘要，并通过 `/memory stats` 展示注入条数和估算 token。
- Phase 17 已补 Team/job 状态表设计：任务图、agent 分工、预算、暂停原因和结构化报告可见；原始长输出只进日志，不混入主消息流。
- Phase 17 已补 Remote Channels 安全硬化：默认关闭，必须校验绑定用户/设备、过期时间、nonce/消息 id、签名或等价来源证明，审批幂等，支持设备解绑和审计日志；远程端只发摘要/审批/报告，不发送完整上下文。
- Phase 17 已补官方 CLI adapter 方向：飞书/Lark CLI、钉钉 CLI、企业微信 wecom-cli 等只作为公开 adapter 边界参考；优先用 official_cli 发送脱敏摘要/审批/报告，CLI 缺失、未登录、权限不足或输出不可解析时保持 disabled，并通过 `/remote channels doctor` 诊断。
- oh-my-openagent 只作为公开行为、交互和验收边界参考，不复制实现，不提前堆功能。
- 参考源总表已补到 F:\Linghun\docs\audit\reference-map.md；后续阶段开工前必须先看该表，确认公开地址/本地路径、可参考内容和禁止事项。需要联网核验公开项目时按需联网，不得虚造，不得复制第三方源码或内部实现。

新对话恢复上下文时，优先使用结构化 HandoffPacket、agent transcript 摘要、codebase-memory 索引、阶段交付文档和 transcript evidence，避免一上来全量读取文件；索引缺失或过期时先提示用户运行 /index init fast 或 /index refresh。

要求：
- 只做当前阶段范围内的事情。
- Phase 15 preflight 已完成，交付文档为 F:\Linghun\docs\delivery\phase-15-natural-command-bridge.md。自然语言桥已覆盖中文和英文语义变体，例如“自动记忆是否打开 / is memory enabled”“帮我建立索引 / build the index”“缓存命中怎么样 / cache hit rate”“现在什么模型 / current model”“打开 bug-fix 工作流 / start bug-fix workflow”。所有 slash 命令都能被自然语言询问用途和风险，高风险命令只能解释、Start Gate 或进入权限审批。
- Phase 15 pre-Beta P0 hardening、Deep Parity、Runtime Acceptance、Verdict Evidence 和 CCB Maturity Remediation baseline 均作为证据输入；当前最新状态以“当前任务状态”段和最新 delivery/audit 报告为准。不得从历史 closure、focused/mock/local/scoped PASS 或单个 live text PASS 推断 Phase 15 Beta readiness PASS；未通过真实 provider + 真实项目 smoke readiness gate 前不得进入 Phase 15 Beta、Phase 15.5 或 Phase 16+。
- 每个后续阶段完成后仍必须在 F:\Linghun\docs\delivery\ 下输出阶段交付文档；没有阶段交付文档，不视为阶段完成。
- 每次改动后说明验证结果和剩余风险。
- 自动工作默认只推进一个阶段；完成当前用户确认的阶段后必须停止，输出验证结果和 handoff packet。
- Phase 15 完成后不得直接进入 Phase 16，必须先执行 Phase 15.5 双模型交叉审查、MCP / Skills / Plugins Connect Lite、Bundled codebase-memory Lite、Compact Lite、Write/Edit/MultiEdit CCB-grade editing UX、模型接入成熟度、联网取证成熟度、release/open-source readiness、终端 TUI polish 清零与开源前 hardening，除非用户明确决定跳过并记录风险；但 Phase 15 Beta 已需的基础 TUI 手感不能留到 Phase 15.5，终端开源发布前 terminal-scope P0/P1/P2 必须清零、降级为 NOT-DO，或证明 out-of-scope。
- 如果用户只是讨论、评估或问方案，必须先通过 Start Gate 询问是否开始执行。
- CLI 主命令统一为 linghun；Windows 下必须兼容 Linghun 大小写入口。

## 给 CCB / 实现会话的历史开工命令模板

下面模板是 2026-05-19 CCB Maturity Remediation 时期的历史模板，仅在用户明确要求回到该 baseline 或修同类 Phase 15 Beta 前主链路问题时使用。当前默认状态不得直接复制此模板开工；当前应以“当前任务状态”段、最新 delivery/audit 报告、Batch 3.5 接管命令或真实项目 smoke 目标为准。不要临时发挥扩大范围。

```text
你是 Linghun 项目的工程型中文助手。默认用中文回答。

历史任务：Phase 15 Beta CCB Maturity Remediation（归档模板，不能直接作为当前任务）。

依据：
- F:\Linghun\PHASE_15_BETA_CCB_MATURITY_REMEDIATION_BASELINE.md 历史执行基线；当前 pre-smoke 执行基线已由 F:\Linghun\docs\audit\phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md 覆盖。
- F:\Linghun\LINGHUN_PHASE_00_18_DESIGN_RUNTIME_OVERDESIGN_FULL_AUDIT.md。
- F:\Linghun\PHASE_00_18_DESIGN_RUNTIME_OVERDESIGN_FULL_AUDIT.md。
- F:\Linghun\START_NEXT_CHAT.md 当前上下文。
- F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md 和 F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md 中 Phase 15 Beta 前 CCB 成熟主链路 gate。

本轮目标：
- 在进入真实项目 Beta 前，把默认终端编码主链路做到 CCB 成熟度：普通输入 -> 会话上下文 -> 模型 -> tool_use -> permission -> tool_result -> continuation -> final answer。
- 关闭 baseline 第 4 节 Must Complete Before Phase 15 Beta，并按第 9 节 Acceptance Matrix 验证。
- 允许必要的底层成熟度修复、模块拆分和文档口径同步；不接受关键词补丁、文案补丁、mock PASS 或历史 closure PASS 证明成熟。

硬约束：
- 不进入 Phase 15 Beta。
- 不进入 Phase 15.5。
- 不进入 Phase 16+。
- 不新增产品愿景。
- 不新增第二套自然语言执行器。
- 不把 TYPE-SHELL 能力当 readiness 证据；可见能力必须真实最小实现、隐藏/禁用或明确后置。
- 不复制 CCB / CCB Dev Boost / Claude Code / OpenCode 源码、内部 API、反编译痕迹或专有实现。
- 只参考成熟工具的公开行为、交互边界和验收标准。

开始前必须先读取：
- F:\Linghun\CLAUDE.md
- F:\Linghun\README.md
- F:\Linghun\START_NEXT_CHAT.md
- F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md
- F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md
- F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md
- F:\Linghun\docs\delivery\README.md
- F:\Linghun\docs\delivery\phase-15-natural-command-bridge.md
- F:\Linghun\docs\delivery\phase-15-pre-beta-ccb-deep-parity-closure.md
- F:\Linghun\docs\audit\reference-map.md
- F:\Linghun\docs\audit\phase-15-pre-beta-real-tui-provider-smoke-gap-review.md
- F:\Linghun\PHASE_15_PRE_BETA_FULL_INTERACTION_MATURITY_AUDIT.md

开发前置要求：
- 先检查 git status，区分用户已有 diff、上一轮 CCB diff 和本轮目标 diff；不要覆盖或回滚已有改动。
- 先定位 TUI provider/model resolver、ModelGateway stream 调用、decidePermission、Natural Command Bridge、tool output formatter、doctor/status/help 相关源码和测试。
- 必要时只读参考 F:\ccb-source 中 provider/auth/permission/tool output/doctor/status 相关文件；只描述行为边界，不复制实现。
- 如果发现需要超过 3 个文件、公共接口、配置 schema 或明显重构，先说明影响面和最小方案，再继续。

必须覆盖的 CCB handfeel gate：
1. provider/model 不得 hardcode deepseek；TUI、gateway、状态栏、/model doctor、usage/stats/handoff 使用真实 provider/model。
2. default 模式不得静默执行 Bash/write/edit/delete/config/install/network/permission；无交互审批 UI 时 ask/deny 并给下一步。
3. index/mcp/model/memory/cache/permissions/features/help/doctor/status 控制面请求优先本地处理；普通开发请求才进入模型 tool_use/tool_result。
4. 无 pending gate 的 yes/确认/继续/ok 不进模型；有 pending gate 时只接受当前确认格式。
5. provider 不支持 tools 时不发送 tools/toolChoice；支持 tools 时 tool_call -> tool_result -> second request 格式正确，HTTP 400 可诊断。
6. 主输出 summary-first，长输出截断并写 fullOutputPath/log/transcript/evidence；权限提示不暴露 raw flags；tool_result/EvidenceSummary/raw index/cache 不污染普通对话；hint 去重。
7. Windows projectPath、路径建议和中文 stdout/stderr 正常；不得出现 /workspace。
8. API key/token 全路径脱敏；doctor 显示 source + present/missing/masked preview；settings.json 存真实 key 时温和 warning，不阻断测试。
9. 400/401/403/429/5xx、tool schema、tool_result、baseUrl、model、gateway 格式错误必须分类并给下一步。
10. 测试必须是行为矩阵，不是固定句子表；中文/英文同一 risk handler。

必须补充或复跑的 focused tests：
- env/defaultModel 或 role route 选择 openai-compatible/gpt-5.5 时，TUI/gateway/status 不走 deepseek。
- default 模式下模型请求 Bash 不自动执行；只读工具仍可执行。
- “帮我打开 mcp 的索引功能”本地处理，不触发模型 Bash。
- 无 pending gate 的 yes/确认不进模型。
- unsupported tools provider 不发送 tools/toolChoice；supported provider tool_result second request 合法。
- 长输出主屏截断，完整内容进入 fullOutputPath/log/transcript/evidence。
- /model doctor 和错误提示不泄露 API key/token。
- Windows projectPath 不出现 /workspace，中文输出不 mojibake。
- 状态查询、doctor、usage_help、safe local action、dangerous action、ordinary development request、ambiguous request 的中英文行为矩阵。

验证至少运行：
- corepack pnpm test -- --run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts packages/providers/src/index.test.ts packages/config/src/index.test.ts
- corepack pnpm check
- corepack pnpm test
- corepack pnpm typecheck
- corepack pnpm build
- corepack pnpm exec linghun --help
- corepack pnpm exec Linghun --help
- git diff --check

文档要求：
- 如本轮修复改变 Phase 15 Beta gate 口径，更新 F:\Linghun\START_NEXT_CHAT.md。
- 如新增或关闭 P0/阻塞 P1，更新对应 docs/delivery 或 docs/audit 记录。
- 不把 Phase 15 Beta 写成已开始。
- 继续明确 Phase 15 Beta / Phase 15.5 / Phase 16+ 都必须用户确认后才可进入。

最终输出：
- 实际读取了哪些 Linghun 文档和 CCB 参考文件。
- 修改文件，区分 code/tests/docs/generated/pre-existing diff。
- 关键 diff 摘要，说明每项 gate 如何关闭。
- P0/P1/P2 风险判断，明确是否仍阻塞 Phase 15 Beta。
- 验证命令和结果；失败或跳过必须说明原因。
- focused tests / TUI smoke 覆盖情况。
- independent verifier 或等价复检结论。
- 剩余风险。
- 明确说明未进入 Phase 15 Beta / Phase 15.5 / Phase 16+。

最终 verdict：
Phase 15 Beta verdict: PASS / FAIL / PARTIAL
只有所有 P0 和阻塞 P1 关闭，且上述验证通过，才允许建议用户恢复真人实测；仍不得自动进入 Beta，必须等用户确认。
```
