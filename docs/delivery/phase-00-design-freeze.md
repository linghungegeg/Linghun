# Phase 00：设计冻结与基线确认

## 目标

确认 Linghun 的产品方向、阶段路线、实现规格和开发准则，作为后续所有阶段开发的基线。

## 本阶段范围

- 整理核心设计文档。
- 归档原始想法和审计资料。
- 建立阶段交付文档目录。
- 建立新对话启动提示。

## 已完成功能

- 根目录保留当前开发入口文档。
- `docs/archive/` 保存早期草案和原始想法。
- `docs/audit/` 保存 CCB 审计报告。
- `docs/delivery/` 保存阶段交付记录和模板。

## 使用方式

新会话开始时读取：

1. `CLAUDE.md`
2. `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
3. `LINGHUN_IMPLEMENTATION_SPEC.md`
4. `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`

也可以直接复制 `START_NEXT_CHAT.md` 中的提示。

## 涉及模块

- 文档结构。
- 开发准则。
- 阶段交付制度。

## 关键设计

- 蓝图负责阶段范围。
- 实现规格负责接口与数据结构。
- 架构路线负责长期方向。
- `CLAUDE.md` 负责约束 AI 开发行为。
- CLI 主命令统一为 `linghun`，Windows 下兼容 `Linghun` 入口。

## 配置项

无。

## 命令

本阶段不实现命令。后续 Phase 01 起必须验证：

```text
linghun --version
linghun --help
Linghun --version
```

## 测试与验证

- 已检查根目录核心文档存在。
- 已创建 `docs/delivery/README.md` 和 `TEMPLATE.md`。
- 已脱敏明显本机路径和账号痕迹。

## 性能结果

不涉及运行时性能。

## 已知问题

- 还没有实际代码工程骨架。
- Phase 01 尚未开始。

## 不在本阶段处理

- 不创建 TypeScript monorepo。
- 不实现 CLI。
- 不实现 TUI。
- 不接入模型。

## 下一阶段衔接

进入 Phase 01：工程骨架闭环。

## 开发者排查入口

- `README.md`
- `START_NEXT_CHAT.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
