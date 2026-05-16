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

这是 Linghun 项目的阶段开发仓库。请严格按阶段蓝图推进，不要跳阶段，不要提前实现后续功能。

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

当前任务：Phase 12 Agent 闭环仅在用户明确确认后开始；没有确认前不要进入 Phase 12+。

新对话恢复上下文时，优先使用结构化 HandoffPacket、codebase-memory 索引、阶段交付文档和 transcript evidence，避免一上来全量读取文件；索引缺失或过期时先提示用户运行 /index init fast 或 /index refresh。

要求：
- 只做当前阶段范围内的事情。
- 完成后在 F:\Linghun\docs\delivery\ 下输出阶段交付文档。
- 没有阶段交付文档，不视为阶段完成。
- 每次改动后说明验证结果和剩余风险。
- 自动工作默认只推进一个阶段；完成 Phase 11 后必须停止，输出验证结果和 handoff packet。
- 如果用户只是讨论、评估或问方案，必须先通过 Start Gate 询问是否开始执行。
- CLI 主命令统一为 linghun；Windows 下必须兼容 Linghun 大小写入口。
```
