# Visual Alignment Phase 16 — 快捷键行内提示

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

在 Footer/Composer/Agent Tree 区域增加行内快捷键提示（CCB `KeyboardShortcutHint` 范式）。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `PromptInputFooterLeftSide.tsx:459-460` 的 `"? for shortcuts"` 行内 hint + status line 条件快捷键 |
| 自研行为 | Linghun `StatusFooter` 常驻 dim 行 + `Composer` 空态 dim 行 + `AgentProgressTree` 被动提示 |
| 新增模块 | 无新文件 |

## 已完成功能

### 16A. StatusFooter 快捷键行

- 宽/窄屏 Footer 底部统一追加 dim 行：`"Esc 中断 · ? 快捷键"` / `"Esc interrupt · ? shortcuts"`
- 仅在 task/pending 模式渲染（Footer 在 home 模式不渲染）
- 使用 `theme.dim` 色 + `dimColor`，不抢主信息焦点

### 16B. Composer 空输入态提示

- buffer 为空且无 Panel 打开时追加 `"· ? 快捷键"` dim 行
- 与 `hintNotice` 不重叠（hintNotice 是错误/交互提示）
- 面板打开时自动隐藏（避免多余视觉噪音）

### 16C. Agent Tree 被动快捷键提示

- 有 running agent 但未激活键盘选择（cursor < 0）时，追加被动 hint：
  `"↑↓ 导航 · x 停止 · Esc 取消"` / `"↑↓ navigate · x stop · esc cancel"`
- 键盘选择激活（cursor >= 0）时，沿用 Phase 3 的 `"↑↓ 选择 · Enter 查看 · x 关闭 · Esc 取消"` 完整提示

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/shell/components/StatusFooter.tsx` | 宽/窄屏底部追加 dim 快捷键行 |
| `packages/tui/src/shell/components/Composer.tsx` | 空 buffer + 无 panel 时追加 `? 快捷键` 提示 |
| `packages/tui/src/shell/components/AgentProgressTree.tsx` | cursor < 0 且 running agent 存在时追加被动导航提示 |

## 关键设计

1. **零 view-model 穿透：** 所有提示文本在组件内直接根据 `language` prop 计算，不通过 view-model plumb。这是纯视觉层工作。
2. **Subtle dim：** 所有快捷键提示使用 `theme.dim ?? theme.muted` + `dimColor`，保持在最弱视觉层级。
3. **面板感知隐藏：** Composer 空态提示在面板打开时自动隐藏，与 `permissionActive`/`showSuggestions`/`view.permission`/`view.configPanel`/`view.helpPanel`/`view.shortcutPanel` 互斥。
4. **Agent Tree 两档提示：** 被动（无选择）→ `导航`；主动（cursor >= 0）→ `选择/查看/关闭/取消`。渐进式披露。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

### 自动化测试

```
packages/tui shell/* — 全部通过:
  view-model.test.ts      344 passed
  progress-views.test.ts    6 passed
  composer-dispatch.test.ts 42 passed
  shell 全 17 文件         593 passed
```

### 手动验证路径

1. `linghun` task 模式 → Footer 底部出现 dim `"Esc 中断 · ? 快捷键"`
2. 空输入框 → `"? 快捷键"` dim 提示
3. 输入文字后 → 提示消失
4. 触发 agent → Agent Tree 下方显示 `"↑↓ 导航 · x 停止 · Esc 取消"`
5. 按 `↑↓` 进入选择模式 → 提示切换为完整版 `"↑↓ 选择 · Enter 查看 · x 关闭 · Esc 取消"`
6. 按 `?` → ShortcutPanel 打开，Composer 提示隐藏

## 已知问题

- Agent Tree 被动提示的 `x 停止` 仅在用户按 `↑↓` 进入选择模式后生效；被动提示是预告性质，不承诺一次性按键（需先导航才能选中特定 agent 并停止）
- 快捷键文本硬编码（非 keybinding-runtime 动态查询），与 CCB `useShortcutDisplay` 不同（Linghun 键位固定，无需动态适配 Mac/Linux）

## 不在本阶段处理的内容

- 快捷键文本动态查询（Phase future）
- Mac/non-Mac 快捷键适配
- Task 展示双行布局（Phase 7）
- 滚动原生化（Phase 6）

## 下一阶段衔接

Phase 7：Task 展示专业化 — Todo 列表改为两行布局（title + owner 行 / status + blockedBy 行）。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §16 |
| 本阶段参考的 CCB 文件 | `PromptInputFooterLeftSide.tsx:459-460` (`"? for shortcuts"`), `PromptInputFooterLeftSide.tsx:569-618` (StatusLineEscInterrupt) |
| 行为参考 | CCB 行内 dim 快捷键 hint 位置、密度、`dimColor` 渲染 |
| 自研实现 | 硬编码文本（非动态 shortcut display）；Composer 面板感知隐藏；Agent Tree 两档渐进提示 |
| 未复制可疑源码 | 仅参考行为模式，Linghun 自写所有实现 |

## 成品级结构化 Handoff Packet

```json
{
  "phase": 16,
  "status": "DONE",
  "next_phase": 7,
  "forbidden": [
    "dynamic shortcut display (useShortcutDisplay) — Linghun uses fixed hints",
    "Mac/non-Mac keyboard adaptation",
    "changing keybinding-runtime to drive hint text"
  ],
  "evidence": ["593 shell tests pass"],
  "index_state": "not checked (3 files, direct edits)",
  "permission_mode": "auto",
  "model": "claude-opus-4-6",
  "budget": "~6s test duration"
}
```
