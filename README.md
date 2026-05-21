# Linghun

Linghun 是一个面向中文开发者的 AI 编程终端规划仓库。

核心方向：

- 以 CCB / Claude Code 级编码体验为核心。
- 保留 CCB Dev Boost 的缓存、索引、成本、中文增强能力。
- 融合 OpenCode 的多模型开放思路。
- 融合 Hermes 的记忆、Skills、工作流沉淀思路。
- 优先打通终端 TUI，后续预留桌面端。
- 按阶段闭环开发，每个阶段必须有交付文档。

## 当前进度

- Phase 00-14 主闭环、Phase 14 hardening 与 Phase 15 preflight hardening：Natural Command Bridge 已完成；Natural Intent Contract 成品级手感硬化已收口。
- Phase 15 pre-Beta Full Interaction Maturity Audit 后，Phase 15 Beta 暂停；必须先完成 P0-1~P0-6 全量阻塞修复：完整 tool_use/tool_result 工具闭环、文件智能指代、新手轻引导和默认 `LINGHUN.md` 模板成熟度、EvidenceSummary 入模型、模型流可取消、en-US 关键提示。
- Phase 15 Pre-Smoke Full Reference Parity Audit + Permission / Architecture Runtime Feasibility + Source-of-Truth Reset 已完成，当前唯一 pre-smoke 执行基线仍为 [docs/audit/phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md](./docs/audit/phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md)；Batch A/B/C 已完成并通过 A-C 综合验收门，综合验收报告为 [docs/audit/phase-15-pre-smoke-a-c-combined-acceptance.md](./docs/audit/phase-15-pre-smoke-a-c-combined-acceptance.md)，当前 verdict 为 `READY_FOR_USER_DECISION_TO_START_REAL_PROJECT_SMOKE`。这不是 Beta PASS，也不是 smoke-ready PASS；未进入真实项目 smoke，未进入 Phase 15.5 / Phase 16+。下一步只能在用户明确确认后进入 Phase 15 real-project smoke。
- Phase 14 已补齐本地 Skills、Workflows、Hooks doctor、Plugin manifest loader、启停、信任和权限边界，并完成稳定性与安全边界加固；不得写成已经实现插件市场、GitHub 安装、自动更新、长期任务或 Phase 15+ 功能。
- Phase 15 preflight hardening 已让中文/英文自然语言可查询 memory、index、cache、model、mode、workflow、skills、plugins、hooks、sessions 等状态，并基于 Command Capability Catalog 做本地裁决；已补 Catalog/dispatch 漂移检测、关键参数提取、pending Start Gate 过期/精确确认和旧权限边界。Pre-smoke 新基线要求用户可见权限模式统一为 `default` / `auto-review` / `plan` / `full-access`，旧 `acceptEdits` / `auto` / `bypass` / `dontAsk` 只作为 legacy alias 或历史证据；高风险命令不得自然语言直通。Architecture Runtime 是 smoke 前底层工程判断能力，不是第五个权限模式、不是 Plan Mode、不是 skill、不是 prompt-only 文案；v1 只做轻量工程判断 guard 和短 Architecture Card，涉及最新外部事实时必须按需走 Freshness/Web Evidence，未联网不得伪造当前结论。
- Linghun 的低学习成本原则是渐进披露：默认首屏、状态栏和 `/help` 简洁；完整能力必须通过 `/help all`、`/features`、`/config advanced`、doctor 详情和自然语言用途询问可发现；隐藏高级入口不能降低功能完整性。
- 自动工作默认只推进一个阶段，完成后必须输出交付文档、验证结果和 handoff packet。
- 连续阶段模式是高级危险开关，默认关闭；只能由本地用户显式 opt-in，且每个阶段之间仍必须停在用户审核点，不能由模型、agent、workflow、job、hook、plugin 或远程通道自动开启。
- 用户未明确开始执行时，必须先通过 Start Gate 确认，不得擅自进入写文件、agent、job、workflow 或依赖安装。

## 开发入口

说明：本节是继续开发 Linghun 仓库本身的入口。Linghun 产品面向任意项目运行时，项目规则主入口是项目根目录 `LINGHUN.md`；`AGENTS.md` / `CLAUDE.md` 只作为兼容导入或迁移来源。本仓库开发 Linghun 自身时，才需要额外读取 `CLAUDE.md`、蓝图、规格书和阶段交付文档。

新会话开始前，请先读取：

1. [CLAUDE.md](./CLAUDE.md)
2. [LINGHUN_PHASED_DELIVERY_BLUEPRINT.md](./LINGHUN_PHASED_DELIVERY_BLUEPRINT.md)
3. [LINGHUN_IMPLEMENTATION_SPEC.md](./LINGHUN_IMPLEMENTATION_SPEC.md)
4. [LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md](./LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md)
5. [docs/delivery/README.md](./docs/delivery/README.md)
6. [docs/delivery/phase-10-mcp-index.md](./docs/delivery/phase-10-mcp-index.md)
7. [docs/delivery/phase-11-sessions-memory.md](./docs/delivery/phase-11-sessions-memory.md)
8. [docs/delivery/phase-12-agents.md](./docs/delivery/phase-12-agents.md)
9. [docs/delivery/phase-13-multi-model.md](./docs/delivery/phase-13-multi-model.md)
10. [docs/delivery/phase-14-skills-workflow.md](./docs/delivery/phase-14-skills-workflow.md)
11. [docs/delivery/phase-15-natural-command-bridge.md](./docs/delivery/phase-15-natural-command-bridge.md)
12. [docs/audit/phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md](./docs/audit/phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md)
13. [docs/audit/phase-15-pre-smoke-a-c-combined-acceptance.md](./docs/audit/phase-15-pre-smoke-a-c-combined-acceptance.md)

后续撰写开源项目介绍、README 卖点或发布说明时，参考 [docs/open-source-positioning-notes.md](./docs/open-source-positioning-notes.md)，不要忘记 evidence-first coding 这一定位。

Phase 15 preflight 之后的新对话应优先基于结构化 handoff、agent transcript 摘要、codebase-memory 索引、阶段交付文档和 transcript evidence 恢复上下文，避免一上来全量读取文件。

## 命令约定

- 项目名：`Linghun`
- CLI 主命令：`linghun`
- Windows 兼容入口：`Linghun`
- 文档和脚本默认写 `linghun`，只在兼容说明中写 `Linghun`。

## 文档结构

```text
.
├── CLAUDE.md
├── LINGHUN_PHASED_DELIVERY_BLUEPRINT.md
├── LINGHUN_IMPLEMENTATION_SPEC.md
├── LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md
└── docs
    ├── audit
    ├── archive
    ├── delivery
    └── open-source-positioning-notes.md
```

## 开发规则

- 严格按阶段推进。
- 不跳阶段堆功能。
- 每个阶段完成后，必须在 `docs/delivery/` 下输出阶段交付文档。
- 没有阶段交付文档，不视为阶段完成。
- 已知问题只能描述阶段边界，不能把本阶段承诺的能力推迟到后续补丁。
