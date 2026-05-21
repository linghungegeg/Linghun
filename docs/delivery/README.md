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
| Phase 15 preflight | done; Beta readiness PARTIAL/BLOCKED | [phase-15-natural-command-bridge.md](./phase-15-natural-command-bridge.md)；pre-smoke 基线：[phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md](../audit/phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md)；A-C 综合验收：[phase-15-pre-smoke-a-c-combined-acceptance.md](../audit/phase-15-pre-smoke-a-c-combined-acceptance.md)；当前完整度门禁：[pre-open-source-terminal-product-completion-gate.md](./pre-open-source-terminal-product-completion-gate.md) | 自然语言控制桥 + preflight hardening + pre-Beta cleanup + Interaction Maturity Fix + Full Interaction P0 hardening 已完成；历史 P0-1~P0-6、CCB handfeel gate、runtime acceptance、Verdict Evidence Gate、Batch 1/2/3、Batch 3.5 与 A-C 综合验收只作为 evidence。用户已选择停止“边实测边补底座债”的节奏，当前唯一下一步是按阶段完成开源前终端产品完整度门禁：Phase 15.5 terminal hardening / Connect Lite / provider / Freshness / release runtime readiness，Phase 16 可控学习，Phase 17A local durable jobs，Phase 17B 企业微信/飞书/钉钉 remote channels 第一版。完整度门禁综合验收前不得进入真实全量实测、Phase 18 桌面端或开源发布。 |
| Phase 15 pre-Beta deep parity | done | [phase-15-pre-beta-ccb-deep-parity-closure.md](./phase-15-pre-beta-ccb-deep-parity-closure.md) | Deep Parity Closure blocking P1 已完成；后续真实 TUI smoke 发现的 P0/阻塞 P1 已作为 Phase 15 Beta 前 CCB handfeel gate 继续收口。Phase 15 Beta 仍 pending user decision，不得自动进入 Phase 15.5 / Phase 16+ |
| Phase 15 | paused / superseded as direct entry | phase-15-real-project-beta.md | 真实项目测试版入口已后移；不得从 A-C、Batch 3.5、focused/mock/local/scoped PASS 或单个 live text PASS 直接进入。当前必须先完成开源前终端产品完整度门禁并通过综合验收，再由用户决定是否进入真实全量实测 |
| Phase 15.5A | done; Phase 15.5 pre-real-test gate partial step | [phase-15-5a-performance-context.md](./phase-15-5a-performance-context.md) | Performance & Context 已完成：Workspace Reference Cache / Virtual Workspace Cache、Compact Lite boundary、cache/status/index fast path。该完成不代表 Beta PASS、不代表 smoke-ready、未进入真实全量 smoke，未进入 Phase 15.5B-F / Phase 16 / 17 / 18；下一步可由用户决定是否进入 Phase 15.5B Resource & Task Lifecycle。 |
| Phase 16 | pending | phase-16-learning-loop.md | 可控学习闭环；基于 Phase 15 CCB workflow parity 总基线做 delta parity audit，只审新增学习/记忆能力及其权限、成本、幻觉和长期状态风险；自动学习必须服从降本，默认不增加主链路前台模型调用、不注入完整 memory、不破坏 cache-first / summary-first |
| Phase 17 | pending | phase-17-jobs-autonomous-sessions.md | 长期托管任务与自动会话；基于 Phase 15 总基线做 delta parity audit，只审新增 job/team/remote 审批能力，不回补基础 TUI 手感。必须拆成 17A local durable jobs 与 17B remote channels/adapters：17A 先闭合本地 job、handoff、预算、暂停、报告和状态可见；remote/IM adapter 默认关闭，不阻塞 17A，成熟后再按脱敏、去重、过期、来源校验和失败降级验收 |
| Phase 18 | pending | phase-18-desktop-ready.md | 桌面端预留验证；基于 Phase 15 总基线做 delta parity audit，验证 core/API/IPC 复用，基础终端 TUI 手感不后置到本阶段 |
