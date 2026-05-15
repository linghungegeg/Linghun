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

- Phase 00-08 已完成。
- 下一阶段是 Phase 09：缓存与成本闭环。
- Phase 09 将在 Phase 08 代码自检与验证增强闭环基础上补齐 cache history、cache freshness、cache warmup、cache break detector、endpoint-level stats、usage/stats、账单对账和 CCB 风格轻提示，不提前做 Phase 10+ 功能。
- 自动工作默认只推进一个阶段，完成后必须输出交付文档、验证结果和 handoff packet。
- 用户未明确开始执行时，必须先通过 Start Gate 确认，不得擅自进入写文件、agent、job、workflow 或依赖安装。

## 开发入口

新会话开始前，请先读取：

1. [CLAUDE.md](./CLAUDE.md)
2. [LINGHUN_PHASED_DELIVERY_BLUEPRINT.md](./LINGHUN_PHASED_DELIVERY_BLUEPRINT.md)
3. [LINGHUN_IMPLEMENTATION_SPEC.md](./LINGHUN_IMPLEMENTATION_SPEC.md)
4. [LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md](./LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md)
5. [docs/delivery/README.md](./docs/delivery/README.md)

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
    └── delivery
```

## 开发规则

- 严格按阶段推进。
- 不跳阶段堆功能。
- 每个阶段完成后，必须在 `docs/delivery/` 下输出阶段交付文档。
- 没有阶段交付文档，不视为阶段完成。
- 已知问题只能描述阶段边界，不能把本阶段承诺的能力推迟到后续补丁。
