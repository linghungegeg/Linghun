# Linghun 阶段交付记录

每个阶段完成后，必须新增或更新对应交付文档。

| 阶段 | 状态 | 文档 | 备注 |
| --- | --- | --- | --- |
| Phase 00 | done | [phase-00-design-freeze.md](./phase-00-design-freeze.md) | 设计冻结与基线确认 |
| Phase 01 | done | [phase-01-project-skeleton.md](./phase-01-project-skeleton.md) | 工程骨架闭环 |
| Phase 02 | done | [phase-02-session-transcript.md](./phase-02-session-transcript.md) | Session 与会话持久化闭环 |
| Phase 03 | done | [phase-03-model-gateway.md](./phase-03-model-gateway.md) | 模型网关最小闭环 |
| Phase 04 | done | [phase-04-tui-mvp.md](./phase-04-tui-mvp.md) | TUI / REPL 最小闭环 |
| Phase 05 | done | [phase-05-core-tools.md](./phase-05-core-tools.md) | 核心工具闭环 |
| Phase 06 | done | [phase-06-permissions-plan.md](./phase-06-permissions-plan.md) | 权限与 Plan 闭环 |
| Phase 07 | done | [phase-07-behavior-guardrail.md](./phase-07-behavior-guardrail.md) | 工程行为控制闭环 |
| Phase 08 | done | [phase-08-verification.md](./phase-08-verification.md) | 代码自检与验证增强闭环 |
| Phase 09 | done | [phase-09-cache-cost.md](./phase-09-cache-cost.md) | 缓存与成本闭环 |
| Phase 10 | done | [phase-10-mcp-index.md](./phase-10-mcp-index.md) | MCP 与 codebase-memory 外部 CLI 最小闭环；不代表 codebase-memory 已随 Linghun 内置、固定版本、免安装或达到开源发布成熟度 |
| Phase 11 | done | [phase-11-sessions-memory.md](./phase-11-sessions-memory.md) | 会话交接与记忆闭环 |
| Phase 12 | done | [phase-12-agents.md](./phase-12-agents.md) | Agent 闭环 |
| Phase 13 | done | [phase-13-multi-model.md](./phase-13-multi-model.md) | 多模型协作闭环 |
| Phase 14 | done | [phase-14-skills-workflow.md](./phase-14-skills-workflow.md) | Skills 与工作流主闭环 + hardening |
| Phase 15 preflight | done; Beta readiness PARTIAL | [phase-15-natural-command-bridge.md](./phase-15-natural-command-bridge.md) | 自然语言控制桥 + preflight hardening + pre-Beta cleanup + Interaction Maturity Fix + Full Interaction P0 hardening 已完成；P0-1~P0-6 已完成并通过 independent verification gate。Phase 15 Beta 前 CCB handfeel gate、CCB Maturity Baseline Closure、source-level runtime/output/permission parity closure、end-to-end CCB user journey parity closure、CCB-grade runtime acceptance closure 与 Verdict Evidence Gate 已完成本地闭环；本轮又按 Phase 15 Beta CCB Maturity Remediation baseline 补齐 session/context、provider profile contracts、tool lifecycle validation、permission continuation、/details、bounded runtime collections、config recovery/atomic write 和 focused tests；2026-05-19 Gate I 又补 OpenAI-compatible provider portability baseline（profile/capability request shaping 与 diagnostics，本地 check/typecheck/test/build PASS，OpenAI-compatible basic/tools live smoke 与 DeepSeek quick live smoke PASS）。Phase 15 Beta readiness 仍为 PARTIAL，不得从 focused PASS、mock PASS、local PASS、单个 live text PASS、SKIPPED/PENDING smoke 或 silent-failure ban PASS 推断 Beta readiness PASS；是否进入 Phase 15 Beta 仍必须用户明确确认，不得自动进入 Phase 15.5 / Phase 16+。2026-05-20 `docs/audit/phase-15-ccb-grade-default-runtime-reconciliation.md` 是最新执行裁决：下一步为 READY_TO_FIX，按 3 个小批次收口默认编码链路；其 pull-forward / keep-deferred list 必须与 baseline 第 12/13 节一起作为后续阶段接手依据，避免旧 `READY_FOR_USER_DECISION` 口径或聊天记忆遗漏细节 |
| Phase 15 pre-Beta deep parity | done | [phase-15-pre-beta-ccb-deep-parity-closure.md](./phase-15-pre-beta-ccb-deep-parity-closure.md) | Deep Parity Closure blocking P1 已完成；后续真实 TUI smoke 发现的 P0/阻塞 P1 已作为 Phase 15 Beta 前 CCB handfeel gate 继续收口。Phase 15 Beta 仍 pending user decision，不得自动进入 Phase 15.5 / Phase 16+ |
| Phase 15 | pending | phase-15-real-project-beta.md | 真实项目测试版；进入前必须通过 Natural Command Bridge、tool_use/tool_result、权限管道、provider/model、TUI output/report gate 和真实 TUI smoke |
| Phase 15.5 | pending | phase-15-5-cross-model-hardening.md | 双模型交叉审查、Solution Completeness Gate 复检、OpenSpec-lite / Spec Delta Gate（仅复杂任务/系统性缺口触发）、模型接入成熟度、联网取证成熟度、Bundled codebase-memory Lite、Compact Lite、Write/Edit/MultiEdit CCB-grade editing UX、终端 TUI polish 清零与开源前 hardening；不得把 Phase 15 Beta 已需的基础 TUI 手感留到本阶段，终端开源前不得遗留 terminal-scope P2 |
| Phase 16 | pending | phase-16-learning-loop.md | 可控学习闭环；基于 Phase 15 CCB workflow parity 总基线做 delta parity audit，只审新增学习/记忆能力及其权限、成本、幻觉和长期状态风险；自动学习必须服从降本，默认不增加主链路前台模型调用、不注入完整 memory、不破坏 cache-first / summary-first |
| Phase 17 | pending | phase-17-jobs-autonomous-sessions.md | 长期托管任务与自动会话；基于 Phase 15 总基线做 delta parity audit，只审新增 job/team/remote 审批能力，不回补基础 TUI 手感。必须拆成 17A local durable jobs 与 17B remote channels/adapters：17A 先闭合本地 job、handoff、预算、暂停、报告和状态可见；remote/IM adapter 默认关闭，不阻塞 17A，成熟后再按脱敏、去重、过期、来源校验和失败降级验收 |
| Phase 18 | pending | phase-18-desktop-ready.md | 桌面端预留验证；基于 Phase 15 总基线做 delta parity audit，验证 core/API/IPC 复用，基础终端 TUI 手感不后置到本阶段 |
