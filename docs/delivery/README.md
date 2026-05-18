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
| Phase 10 | done | [phase-10-mcp-index.md](./phase-10-mcp-index.md) | MCP 与 codebase-memory 闭环 |
| Phase 11 | done | [phase-11-sessions-memory.md](./phase-11-sessions-memory.md) | 会话交接与记忆闭环 |
| Phase 12 | done | [phase-12-agents.md](./phase-12-agents.md) | Agent 闭环 |
| Phase 13 | done | [phase-13-multi-model.md](./phase-13-multi-model.md) | 多模型协作闭环 |
| Phase 14 | done | [phase-14-skills-workflow.md](./phase-14-skills-workflow.md) | Skills 与工作流主闭环 + hardening |
| Phase 15 preflight | done pending Beta decision | [phase-15-natural-command-bridge.md](./phase-15-natural-command-bridge.md) | 自然语言控制桥 + preflight hardening + pre-Beta cleanup + Interaction Maturity Fix + Full Interaction P0 hardening 已完成；P0-1~P0-6 已完成并通过 independent verification gate。Phase 15 Beta 前 CCB handfeel gate 与 CCB Maturity Baseline Closure 已完成本地闭环：真实 provider/model 路由、default 不静默跑 Bash/写入类工具、控制面本地处理、无 pending confirmation 不进模型、doctor/key 脱敏、provider HTTP 诊断、tool output 分层、permission primary prompt、runtime status presenter、index safety continuation classifier、TUI 单文件减压，以及 Solution Completeness Gate 的轻量 runtime decision / prompt / transcript / handoff / report follow-up 均已补测；是否进入 Phase 15 Beta 仍必须用户明确确认，不得自动进入 Phase 15.5 / Phase 16+ |
| Phase 15 pre-Beta deep parity | done | [phase-15-pre-beta-ccb-deep-parity-closure.md](./phase-15-pre-beta-ccb-deep-parity-closure.md) | Deep Parity Closure blocking P1 已完成；后续真实 TUI smoke 发现的 P0/阻塞 P1 已作为 Phase 15 Beta 前 CCB handfeel gate 继续收口。Phase 15 Beta 仍 pending user decision，不得自动进入 Phase 15.5 / Phase 16+ |
| Phase 15 | pending | phase-15-real-project-beta.md | 真实项目测试版；进入前必须通过 Natural Command Bridge、tool_use/tool_result、权限管道、provider/model、TUI output/report gate 和真实 TUI smoke |
| Phase 15.5 | pending | phase-15-5-cross-model-hardening.md | 双模型交叉审查、Solution Completeness Gate 复检、模型接入成熟度、联网取证成熟度、终端 TUI 非阻塞 polish 与开源前 hardening；不得把 Phase 15 Beta 已需的基础 TUI 手感留到本阶段 |
| Phase 16 | pending | phase-16-learning-loop.md | 可控学习闭环 |
| Phase 17 | pending | phase-17-jobs-autonomous-sessions.md | 长期托管任务与自动会话 |
| Phase 18 | pending | phase-18-desktop-ready.md | 桌面端预留验证；基础终端 TUI 手感不后置到本阶段 |
