# Linghun

Linghun 是一个面向中文开发者的 AI 编程终端规划仓库。

核心方向：

- 以 CCB / Claude Code 级编码体验为核心。
- 保留 CCB Dev Boost 的缓存、索引、成本、中文增强能力。
- 融合 OpenCode 的多模型开放思路。
- 融合 Hermes 的记忆、Skills、工作流沉淀思路。
- 优先打通终端 TUI，后续预留桌面端。
- 按阶段闭环开发，每个阶段必须有交付文档。

## 开发入口

新会话开始前，请先读取：

1. [CLAUDE.md](./CLAUDE.md)
2. [LINGHUN_PHASED_DELIVERY_BLUEPRINT.md](./LINGHUN_PHASED_DELIVERY_BLUEPRINT.md)
3. [LINGHUN_IMPLEMENTATION_SPEC.md](./LINGHUN_IMPLEMENTATION_SPEC.md)
4. [LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md](./LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md)

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
