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
- Phase 10 MCP 与 codebase-memory 闭环已完成。
- Phase 11 会话交接与记忆闭环已完成。
- Phase 12 Agent 闭环已完成。
- Phase 13 多模型协作闭环已完成。
- Phase 14 Skills 与工作流主闭环已完成。
- Phase 14 hardening 已完成：Skills / Workflows / Hooks / Plugins 稳定性与安全边界已加固。
- Phase 15 preflight hardening 已完成：Natural Command Bridge / 自然语言控制桥已接入 Command Capability Catalog、本地 intent router、RuntimeStatusForModel、高风险自然语言阻断、Catalog/dispatch 漂移检测、关键参数提取、pending Start Gate 过期/精确确认、bypass/auto/Plan 边界。
- Phase 15 preflight hardening follow-up 已完成：`/memory init` 的默认 `LINGHUN.md` 已从简单占位升级为中文“项目规则”模板；已有 `LINGHUN.md` 继续不静默覆盖；本 follow-up 只做模板 cleanup，不进入 Phase 15 Beta / Phase 15.5 / Phase 16+。
- Phase 15 pre-Beta cleanup 已完成：根据 `docs/audit/phase-15-pre-beta-cross-review-report.md` 做最小修复，RuntimeStatus provider 不再 fallback 为 deepseek，缺失时为 unknown；TUI 标题去掉 Phase 14；pluginListHash / extension freshness 增加顺序稳定性补测；DeepSeek V4 Pro 报告中的 catalog/dispatch registry-map 重构不在本轮执行，只保留 drift detection + coverage test。
- Phase 15 Natural Intent Contract 成品级手感硬化已完成：自然语言桥已区分 status_query、doctor_query、usage_help、safe_action_request、config_change_request、dangerous_action_request 和 ambiguous_request，避免“现在是什么模型”等状态查询退化成命令用法提示；这属于 Phase 15 preflight 收口，不是新阶段。
- Phase 15 pre-Beta CCB Interaction Parity Audit v2 已完成并登记，且 Phase 15 pre-Beta Interaction P1 cleanup 已完成：`recordModelUsage`、`/stats`、`/usage` fallback、handoff packet 不再伪造 `deepseek`，改用真实 provider 或 `unknown`；Start Gate 默认主输出已改为 human-first decision prompt，不暴露 gateId、expiresAt、raw risk flags、writesConfig、permissionPipeline、logPath 等内部字段，同时保留 exact command 唯一确认路径和权限管道。
- Phase 15 pre-Beta CCB Full Parity Audit 已完成：`docs/audit/phase-15-pre-beta-ccb-full-parity-audit.md`。覆盖 20 个审计面、CCB 主链路证据、Linghun 主链路证据、完整差距矩阵、P0/P1/P2 清单。该报告当时认为不阻塞 Beta，但已被后续 Full Interaction Maturity Audit 的审计后裁决 supersede：Phase 15 Beta 继续暂停，P0-1 到 P0-6 必须先全量闭环；原报告中的 3 项 P1 仍登记到 Phase 15.5。
- Phase 15 pre-Beta Interaction Maturity Fix 已完成：状态/完成度查询优先只读 RuntimeStatus 或等价 slash handler；`索引已经建立了是吧` / `is the index ready` 不再触发 `/index init fast`；只读能力不进入 Start Gate；项目规则自然语言入口读取当前项目 `LINGHUN.md`，缺失时只提示 `/memory init`；zh-CN 默认输出不混入英文 Gate 模板；低置信度澄清改为自然语言方向和风险摘要。
- Phase 15 pre-Beta Solution Completeness Gate 已登记为当前新增质量门：当真实 TUI smoke 暴露同类交互/能力问题反复出现、用户要求成品级或要求对照 CCB/OpenCode 等成熟参考时，必须先判断单点 bug / 系统性缺口，列影响面、参考源、P0/P1/P2、阶段边界和验证方式，再给修复命令；不得发现一个现象补一个关键词。该闸门应在当前完整交互审计与修复后收口，收口前不得进入 Phase 15 Beta。
- Phase 15 pre-Beta Full Interaction Maturity Audit 已完成：`F:\Linghun\PHASE_15_PRE_BETA_FULL_INTERACTION_MATURITY_AUDIT.md`。审计后裁决已写入蓝图/规格/交付文档：Phase 15 Beta 继续暂停，必须一次性修复 P0-1~P0-6；P0-1 必须做完整 tool_use/tool_result 工具协议 + 统一权限中枢，不得只做 Read/Grep/Glob 弱化版，也不得用模型文本 hint 冒充工具调用；P0-3 同时包含新手轻引导和默认 `LINGHUN.md` 模板成熟度，模板必须提炼最小必要改动、禁止顺手修、减少屎山、重构边界、高风险先说明和最小验证。
- Phase 15 pre-Beta Full Interaction P0 hardening 已完成本地闭环并通过独立 verification gate：Provider / TUI 支持真实 `tool_use` / `tool_result`，核心工具 schema 覆盖 Read/Grep/Glob/Diff/Write/Edit/MultiEdit/Bash/Todo；模型工具调用复用 `decidePermission()`、Plan/acceptEdits/auto/bypass/硬拒绝安全检查和 `runTool()`；自然语言读文件支持明确路径、最近文件、模糊候选；`EvidenceSummary` 与 `tool_result` / `evidence_record` 同源；模型流、`/interrupt`、SIGINT 和 Bash 工具调用接入 abort；en-US 覆盖 unknown command、error、light hint、缺失 `LINGHUN.md` 提示等关键路径；2026-05-17 独立复检 verdict: PASS，必跑 test/typecheck/build/lowercase+uppercase help 均通过，额外 lint、focused P0 tests 和 TUI smoke 通过，无需最小修复。
- Phase 15 pre-Beta Deep Parity Closure blocking P1 fix 已完成本地最小实现：SC-1 通过轻量 Solution Completeness Gate workflow/prompt/handoff check 关闭（显式“成品级/不要缝补/先看 CCB/有没有漏”或同类 denied 反复出现时注入 `SYSTEMIC_GAP_WARNING`，要求先判断 `single_issue / systemic_gap`、影响面、P0/P1/P2、阶段边界和验证方式）；BASH-1 通过兼容 `ToolContext.onProgress` chunk 回调关闭，Bash stdout/stderr/system chunk 会写入 `tool_call_delta`、刷新 background task 并即时输出，最终 `ToolOutput`/exitCode/error/timeout/abortSignal 兼容。未做完整 runtime guard、AsyncGenerator 工具大改、registry/dispatch 重构、完整 TUI 美化、FreshnessGate/web_source runtime、新手向导或 Phase 15.5/16+ 内容。
- Phase 15 pre-Beta Final Real TUI / Provider Smoke P0+blocking P1 fix 已完成本地最小实现：NCB-INDEX-1 覆盖“更新/刷新/同步/重建/重新索引/重做索引”和状态查询；OUT-1 在 `formatToolOutput()` 做 Todo 8 条和 Read/Grep/Glob 长输出主输出截断，完整结果保留在 transcript/evidence/fullOutputPath；PROV-1 在 TUI 与 ModelGateway 两层检查 `supportsTools=false` 时不发送 tools/toolChoice，并在 doctor 中暴露 tools/tool calling 能力不足；NCB-INDEX-2 更新 `/index` help/risk 文案，声明 status/search/architecture 只读、init/refresh 需确认；DOC-1 实现 `/model doctor` → `Model route doctor`。未进入 Phase 15 Beta / Phase 15.5 / Phase 16+，未修非阻塞 P1/P2，未做 registry/dispatch 大重构、完整 TUI 美化、完整 output grouping/details/debug、完整 provider adapter 重构或 FreshnessGate/web_source runtime。

当前任务：Phase 15 preflight / pre-Beta cleanup / Natural Intent Contract hardening / Phase 15 pre-Beta Interaction P1 cleanup / Interaction Maturity Fix / Full Interaction P0 hardening 均已完成本地验证；Phase 15 pre-Beta Deep Parity Closure 的 2 项阻塞 P1（SC-1 / BASH-1）已完成本地最小修复；Phase 15 pre-Beta Final Real TUI / Provider Smoke 的 3 项 P0 + 2 项阻塞 P1 已完成本地最小修复并通过本地 focused tests/test/typecheck/build/help/diff-check；独立 verifier 除真实 DeepSeek API key 缺失外全部 PASS，随后用户提供临时 key 完成 Real DeepSeek API `tool_use → tool_result → second request` smoke PASS（key 未写入仓库文件、文档或配置）。下一步即使 verification/smoke PASS，也只能在用户明确确认后决定是否进入 Phase 15 真实项目 Beta；不得自动进入 Phase 15 Beta、Phase 15.5 或 Phase 16+。

文档补强状态：
- Phase 13 已补成品级角色路由验收：路由决策可审计、fallback/预算可诊断、角色贡献和成本可见、角色间只传结构化摘要和证据。
- Phase 14 已补 Skills / Hooks / Plugins 加载边界：summary-first、load-on-demand、第三方来源/权限/信任级别可见、失败隔离、稳定排序、Start Gate 和权限管道不可绕过。
- Phase 14 已补主闭环 / hardening 分段边界：主闭环只做本地 loader、doctor、启停、信任和权限接入；hardening 再补稳定排序、缓存 hash、失败隔离、hook 超时、大输出截断和 workflow 验收；GitHub 安装/插件市场不混入主闭环。
- Phase 15 前新增 Natural Command Bridge preflight：普通自然语言必须能查看/控制高频 Linghun 状态，底层 intent router 负责裁决，模型只负责解释；这不是关键词补丁，也不能做成弱化版。必须参考 CCB 的公开行为边界，以 Command Capability Catalog 暴露中英文 description/whenToUse、modelInvocable、bridgeSafe、risk 和 Start Gate 信息。Catalog 必须覆盖所有用户可见 slash 命令，隐藏/内部命令显式标记；只读状态直接回答，索引/模型/模式/workflow 等动作走 Start Gate，写文件/Bash/权限规则/第三方启用/force/remote 等不得自然语言直通。
- Phase 15 pre-Beta P0 hardening 口径：参考 CCB 的公开成熟边界，但不复制源码。必须实现真实 tool_use/tool_result，核心工具 schema 覆盖 Read/Grep/Glob/Diff/Write/Edit/MultiEdit/Bash/Todo；执行层复用现有工具实现、Start Gate、decidePermission、Plan、acceptEdits、auto、bypass 和安全检查；危险工具不得因来自模型 tool_use 而绕过审批。
- Phase 15 pre-Beta CCB / CCB Dev Boost Deep Parity Closure 已登记为 P0 hardening 后的候选质量门，不是当前自动执行阶段。P0 报告出来后再决定是否启动；目标是确认 Phase 00-14 的实际使用体验、交互细节、建议/提权、错误/doctor/help、自然语言入口、cache/index/memory、多模型协作和 TUI 基础手感达到 CCB / CCB Dev Boost 公开成熟行为的核心体验等价。P0 / 阻塞 P1 必须在 Beta 前修复，非阻塞 P2 才登记到 Phase 15.5。
- 默认 `LINGHUN.md` 模板成熟度已纳入 P0-3：升级 `/memory init` 未来生成的模板和 focused tests，不静默覆盖已有 `LINGHUN.md`，不把 `F:\linghun-ceshi\linghun-副本.md` 原样塞入默认模板，只提炼核心工程纪律。
- Natural Intent Contract 已写入规格和 Phase 15 交付文档：同一 capability 下必须继续区分状态查询、doctor 查询、用法/风险询问、安全动作、配置变更、高风险动作和模糊请求。例如“现在是什么模型”必须返回真实 provider/model 状态和角色路由短摘要，不得只返回 `/model route` 用法；“模型 key 配好了吗”必须进入 doctor 诊断；“/model 怎么用”才返回用法说明。
- Phase 15 preflight 交互审查后的成品级补强要求已写入蓝图/规格/路线图：进入 Phase 15 真实项目 Beta 前，必须先闭环 Catalog/dispatch 漂移检测、关键参数提取、pending Start Gate 过期和风险重放、bypass/auto gating、权限提权说明和测试矩阵；这属于 Phase 15 preflight hardening，不是 Phase 16+。
- 权限/提权交互必须显示 exact action、risk、scope、reason、rollback 和 choices；Start Gate 不替代权限审批。`bypass` 必须本地显式 opt-in，`auto` 必须有可用 gate/classifier，Plan approval 必须区分手动确认编辑、acceptEdits 边界和拒绝反馈。
- Phase 15 后新增 Phase 15.5：双模型交叉审查、模型接入成熟度、联网取证成熟度、终端 TUI 成品级收口与开源前 hardening。GPT-5.5/Claude 做产品架构审查，DeepSeek V4 Pro 做代码安全审查，交叉复核后只修 P0/P1，P2 记录后续。
- Phase 15.5 已补 release readiness / open-source readiness：安装、CLI 入口、Windows 大小写 shim、doctor、keychain/密钥脱敏、debug bundle、配置 schema、升级回滚、文档同步和 discovery-before-execute 工具 guard 都要检查；CCB / Claude Code Best v2.4.3 只作为公开行为参考，吸收“未发现/未加载 schema 的延迟工具不得执行”的 runtime guard，不复制实现。
- Phase 15.5 已补模型接入成熟度收口：provider adapter 不能只验证返回文本，必须覆盖 native/gateway/custom profile、capability doctor、role route doctor、usage/cache 来源、quota/balance 来源、provider error classifier、fallback/retry 审计、配置优先级和 key 脱敏；OpenAI-compatible / Claude-compatible 中转站只能降低接入门槛，不能假装能力、usage、cache、quota 和 tool calling 与官方 native provider 完全等价。
- Phase 15.5 已补联网取证成熟度收口：反幻觉不是禁止联网，而是本地证据优先、实时信息触发 Freshness Gate、未授权联网先询问、已授权联网优先官方来源、结果写入 `web_source` evidence、失败降级；未联网或无新鲜 web evidence 不得声称最新版本、当前价格、当前 API 行为或社区现状。
- Phase 15.5 已补终端 TUI 成品级收口：基础终端美化、首屏、状态栏、help 分组、Start Gate、权限/提权、Plan/auto/bypass 说明、错误 doctor、长任务轻提示、primary/details/debug 输出层级、自然语言状态查询、中英文一致性和窄终端渲染必须在 Phase 15.5 收口；Phase 18 只做桌面端壳、IPC/API 和 core 复用验证，不负责补基础终端交互。
- Phase 15.5 已补 Solution Completeness Gate 复检：双模型审查和真实项目测试报告中的缺陷必须先分类为单点修复、系统性缺口、后续登记或不做；系统性缺口要给最小完整修复边界，避免 Phase 15.5 继续补丁化。
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
- Phase 15 pre-Beta P0 hardening 已完成并通过 independent verification gate；Interaction Maturity Fix 的“可恢复 Beta”旧结论已被后续 Full Interaction Maturity Audit 与 P0 hardening 收口覆盖。下一步必须由用户明确确认：启动 Deep Parity Closure 或进入 Phase 15 真实项目 Beta；未确认前不得进入 Phase 15 Beta、Phase 15.5 或 Phase 16+。
- 每个后续阶段完成后仍必须在 F:\Linghun\docs\delivery\ 下输出阶段交付文档；没有阶段交付文档，不视为阶段完成。
- 每次改动后说明验证结果和剩余风险。
- 自动工作默认只推进一个阶段；完成当前用户确认的阶段后必须停止，输出验证结果和 handoff packet。
- Phase 15 完成后不得直接进入 Phase 16，必须先执行 Phase 15.5 双模型交叉审查、模型接入成熟度、联网取证成熟度、终端 TUI 成品级收口与开源前 hardening，除非用户明确决定跳过并记录风险。
- 如果用户只是讨论、评估或问方案，必须先通过 Start Gate 询问是否开始执行。
- CLI 主命令统一为 linghun；Windows 下必须兼容 Linghun 大小写入口。
```
