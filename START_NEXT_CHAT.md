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

这是 Linghun 项目的阶段开发仓库。请严格按阶段蓝图推进，不要跳阶段，不要提前实现后续功能。

当前状态：
- Phase 00 设计冻结与基线确认已完成。
- Phase 01 工程骨架闭环已完成。
- Phase 02 Session 与 JSONL transcript 闭环已完成。
- Phase 03 模型网关最小闭环已完成。
- Phase 04 TUI / REPL 最小闭环已完成。
- Phase 05 核心工具闭环已完成。
- Phase 06 权限与 Plan 闭环已完成。

当前任务：从 Phase 07 开始，完成工程行为控制闭环。不要进入 Phase 08 代码自检与验证增强，除非用户明确确认。

要求：
- 只做当前阶段范围内的事情。
- 完成后在 F:\Linghun\docs\delivery\ 下输出阶段交付文档。
- 没有阶段交付文档，不视为阶段完成。
- 每次改动后说明验证结果和剩余风险。
- 自动工作默认只推进一个阶段；完成 Phase 07 后必须停止，输出验证结果和 handoff packet。
- 如果用户只是讨论、评估或问方案，必须先通过 Start Gate 询问是否开始执行。
- CLI 主命令统一为 linghun；Windows 下必须兼容 Linghun 大小写入口。
```
