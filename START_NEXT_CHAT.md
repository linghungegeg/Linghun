# 新对话启动提示

复制下面这段给新的 AI 会话：

```text
请先读取并遵守以下文件：

1. F:\Linghun\CLAUDE.md
2. F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md
3. F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md
4. F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md

这是 Linghun 项目的阶段开发仓库。请严格按阶段蓝图推进，不要跳阶段，不要提前实现后续功能。

当前任务：从 Phase 01 开始，完成工程骨架闭环。Phase 00 设计冻结与基线确认已完成。

要求：
- 只做当前阶段范围内的事情。
- 完成后在 F:\Linghun\docs\delivery\ 下输出阶段交付文档。
- 没有阶段交付文档，不视为阶段完成。
- 每次改动后说明验证结果和剩余风险。
- CLI 主命令统一为 linghun；Windows 下必须兼容 Linghun 大小写入口。
```
