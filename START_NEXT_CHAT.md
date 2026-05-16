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
24. F:\Linghun\docs\audit\reference-map.md

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

当前任务：Phase 15 preflight / pre-Beta cleanup 已完成。下一步只能在用户明确确认后进入 Phase 15 真实项目 Beta 或 Phase 15.5 双模型交叉审查与开源前 hardening；不得自动进入 Phase 16+。

文档补强状态：
- Phase 13 已补成品级角色路由验收：路由决策可审计、fallback/预算可诊断、角色贡献和成本可见、角色间只传结构化摘要和证据。
- Phase 14 已补 Skills / Hooks / Plugins 加载边界：summary-first、load-on-demand、第三方来源/权限/信任级别可见、失败隔离、稳定排序、Start Gate 和权限管道不可绕过。
- Phase 14 已补主闭环 / hardening 分段边界：主闭环只做本地 loader、doctor、启停、信任和权限接入；hardening 再补稳定排序、缓存 hash、失败隔离、hook 超时、大输出截断和 workflow 验收；GitHub 安装/插件市场不混入主闭环。
- Phase 15 前新增 Natural Command Bridge preflight：普通自然语言必须能查看/控制高频 Linghun 状态，底层 intent router 负责裁决，模型只负责解释；这不是关键词补丁，也不能做成弱化版。必须参考 CCB 的公开行为边界，以 Command Capability Catalog 暴露中英文 description/whenToUse、modelInvocable、bridgeSafe、risk 和 Start Gate 信息。Catalog 必须覆盖所有用户可见 slash 命令，隐藏/内部命令显式标记；只读状态直接回答，索引/模型/模式/workflow 等动作走 Start Gate，写文件/Bash/权限规则/第三方启用/force/remote 等不得自然语言直通。
- Phase 15 preflight 交互审查后的成品级补强要求已写入蓝图/规格/路线图：进入 Phase 15 真实项目 Beta 前，必须先闭环 Catalog/dispatch 漂移检测、关键参数提取、pending Start Gate 过期和风险重放、bypass/auto gating、权限提权说明和测试矩阵；这属于 Phase 15 preflight hardening，不是 Phase 16+。
- 权限/提权交互必须显示 exact action、risk、scope、reason、rollback 和 choices；Start Gate 不替代权限审批。`bypass` 必须本地显式 opt-in，`auto` 必须有可用 gate/classifier，Plan approval 必须区分手动确认编辑、acceptEdits 边界和拒绝反馈。
- Phase 15 后新增 Phase 15.5：双模型交叉审查与开源前 hardening。GPT-5.5/Claude 做产品架构审查，DeepSeek V4 Pro 做代码安全审查，交叉复核后只修 P0/P1，P2 记录后续。
- Phase 15.5 已补 release readiness / open-source readiness：安装、CLI 入口、Windows 大小写 shim、doctor、keychain/密钥脱敏、debug bundle、配置 schema、升级回滚和文档同步都要检查。
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
- 开始 Phase 15 真实项目 Beta 或 Phase 15.5 前，必须由用户明确确认。
- 每个后续阶段完成后仍必须在 F:\Linghun\docs\delivery\ 下输出阶段交付文档；没有阶段交付文档，不视为阶段完成。
- 每次改动后说明验证结果和剩余风险。
- 自动工作默认只推进一个阶段；完成当前用户确认的阶段后必须停止，输出验证结果和 handoff packet。
- Phase 15 完成后不得直接进入 Phase 16，必须先执行 Phase 15.5 双模型交叉审查与开源前 hardening，除非用户明确决定跳过并记录风险。
- 如果用户只是讨论、评估或问方案，必须先通过 Start Gate 询问是否开始执行。
- CLI 主命令统一为 linghun；Windows 下必须兼容 Linghun 大小写入口。
```
