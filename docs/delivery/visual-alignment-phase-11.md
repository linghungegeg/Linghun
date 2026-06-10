# Visual Alignment Phase 11 — 配色体系对齐

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

新增 `subtle`、`inactive`、`suggestion` 语义颜色分层，对齐 CCB 的多层配色体系。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB 的 `subtle` (背景信息) / `inactive` (非活跃) / `suggestion` (建议) 三层语义 |
| 自研行为 | 在现有 ShellTheme 新增字段，保留 `muted` 不动，新增三层为可选 fallback |
| 新增模块 | 无新文件 |

## 已完成功能

### 11A-1. ShellTheme 扩展

- 新增 `subtle?: string` — 背景信息色（status line）
- 新增 `inactive?: string` — 次级信息色（非活跃/次要元素）
- 新增 `suggestion?: string` — 建议/提示色
- 三种模式赋值：
  - dark: `subtle=gray`, `inactive=gray`, `suggestion=blueBright`
  - light: `subtle=gray`, `inactive=gray`, `suggestion=blue`
  - no-color: 全部 `undefined`

### 11A-2. ProductBlock 次级信息 → inactive

- `user_text` 前缀 `│` → `theme.inactive ?? theme.muted`
- slash command marker `❯` → `theme.inactive ?? theme.muted`
- detail/概要文本 → `theme.inactive ?? theme.muted`

### 11A-3. StatusFooter / StatusTray 背景信息 → subtle

- StatusLine 行 (`workspaceStatus`/`runtimeStatus`) → `theme.subtle ?? theme.dim ?? theme.muted`
- FooterDetailLines → 同
- StatusTray 状态栏 → `theme.subtle ?? theme.muted`

## CCB 源码比对

| 维度 | CCB | Linghun |
|------|-----|---------|
| 语义层级 | `subtle`/`inactive`/`suggestion` 独立 token | 新增三层，保持 `muted` compat |
| 色值 | RGB 精确色值 | chalk 颜色名（保持项目风格） |
| 主题变体 | 6 主题 | 3 模式（dark/light/no-color） |
| `suggestion` 使用场景 | KeyboardShortcutHint、CtrlOToExpand | 预留（未使用，供后续阶段） |

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `shell/theme.ts` | ShellTheme 类型新增 `subtle`/`inactive`/`suggestion`，三模式赋值 |
| `shell/components/ProductBlock.tsx` | 3 处 `theme.muted` → `theme.inactive ?? theme.muted` |
| `shell/components/StatusFooter.tsx` | 4 处 StatusLine 行 → `theme.subtle ?? theme.dim ?? theme.muted` |
| `shell/components/StatusTray.tsx` | 1 处 → `theme.subtle ?? theme.muted` |

## 关键设计

1. **向后兼容：** 新字段全部 `?? theme.muted` fallback，不影响未迁移组件、plain-renderer 或测试 mock。
2. **最小扩散：** 仅 ProductBlock 次级信息 + StatusFooter/StatusTray 背景信息替换，不动其他 20+ 组件中的 `theme.muted`（它们语义正确）。
3. **suggestion 预留：** 定义但未使用，供后续 KeyboardShortcutHint、inline suggestions 使用。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

- `tool-output-presenter.test.ts`: 33/33 pass (Phase 12 格式变更也通过)
- biome check clean (5 files, fixed 2 imports)
- 三种模式不崩（dark/light/no-color 均有 fallback）

## 已知问题

- `suggestion` 字段未在任何组件中使用（后续阶段）。
- subtle/inactive 当前与 muted 色值相同（都是 gray），语义分层价值在后续引入不同色值时体现。

## 不在本阶段处理的内容

- `suggestion` 在 UI 中的实际使用
- 其他 20+ 组件中 `theme.muted` 的迁移（它们当前用法正确）
- RGB 精确色值（保持 chalk 颜色名）

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §11 |
| 本阶段参考的 CCB 文件 | `theme.ts` (82 token + RGB) — 通过计划文档转述 |
| 行为参考 | CCB 三层语义分层（subtle/inactive/suggestion）→ Linghun 新增三层 |
| 自研实现 | 保持 chalk 颜色名 + `?? muted` fallback + 最小范围替换 |
| 未复制可疑源码 | 仅参考语义名称和分层概念 |

## 成品级结构化 Handoff Packet

```json
{
  "phase": 11,
  "status": "DONE",
  "next_phase": "complete (所有 phase 已完成)",
  "forbidden": [
    "mass-migrate theme.muted across all 20+ components",
    "RGB precise color values (keep chalk names)",
    "use suggestion field without explicit user direction"
  ],
  "evidence": ["biome clean", "33/33 tool-output-presenter tests", "backward compat via ?? fallback"],
  "index_state": "not checked (4 files, targeted edits)",
  "permission_mode": "auto",
  "model": "claude-opus-4-6",
  "budget": "N/A"
}
```
