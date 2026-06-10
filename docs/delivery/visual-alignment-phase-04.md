# Visual Alignment Phase 04 — Modal/Panel 全屏覆盖

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

HelpPanel / CommandPanel / ConfigPanel / SessionsPanel / BtwPanel 从流式卡片改为绝对定位覆盖层，上方留 2 行 transcript peek。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `FullscreenLayout` modal: `position="absolute" bottom={0} left={0} right={0}` + `▔` divider + `opaque` + `maxHeight={terminalRows - 2}` |
| 自研行为 | Linghun `BackgroundTaskOverlay` 保留独立 `borderStyle="round"`（对齐 CCB PermissionDialog）；`resolvePanel` 提取面板分发逻辑 |
| 新增模块 | 无新文件；`PanelLayer` 重构 + 新增 `resolvePanel` 辅助函数 |

## 已完成功能

### 4A. Modal 绝对定位覆盖

- **ShellApp.tsx:172** — transcript 外层容器新增 `position="relative"`，为子节点绝对定位提供定位参考
- **PanelLayer** — 面板渲染改为绝对定位覆盖层：
  - `position="absolute" bottom={0} left={0} right={0}` — 底部锚定，向左/右撑满
  - `maxHeight={view.height - 3}` — 保留上方 2 行 transcript peek + 1 行 divider
  - `opaque` — 不透明覆盖，遮盖下层 scroll 内容
  - `overflow="hidden"` — 超长内容裁剪
- **▔ 分隔线** — `{'▔'.repeat(columns)}` permission 色，对齐 CCB modal divider
- **内容区** — `paddingX={2}` `flexShrink={0}`，对齐 CCB `ModalContext` 内边距
- **`resolvePanel`** — 提取面板类型分发逻辑，保持 PanelLayer 扁平

### BackgroundTaskOverlay 例外

- 保留独立 `borderStyle="round"` 渲染（对齐 CCB `PermissionDialog`）
- 不算入 Modal 覆盖体系

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/shell/components/ShellApp.tsx` | PanelLayer 重构为 absolute overlay + resolvePanel |

## 关键设计

1. **定位参考：** 外层 `position="relative"` 在 transcript 区域容器上，PanelLayer 的 absolute 子元素相对此容器定位。
2. **Transcript peek：** `maxHeight={view.height - 3}` 预留上方 2 行可见消息上下文 + 1 行 `▔` divider。
3. **叠层顺序：** `opaque` + 后渲染 → Panel 绘制在 TranscriptViewport 之上（Ink 渲染顺序保证）。
4. **BackgroundTaskOverlay 独立：** 此组件自带 `borderStyle="round"` 和权限交互语义，不在本阶段改。

## 配置项

无新增配置项。

## 命令

受影响的命令：
- `/help` — HelpPanel
- `/config` — ConfigPanel
- `/sessions` — SessionsPanel
- `/btw` — BtwPanel
- 通用命令结果 — CommandPanel

面板通过 Esc 关闭（键盘路由已在 Phase 3 处理）。

## 测试与验证

### 自动化测试

```
packages/tui shell/* — 全部通过:
  view-model.test.ts             344 passed
  tui-interaction-contract.test.ts  33 passed
  ink-interaction-smoke.test.ts    14 passed
  composer-dispatch.test.ts       42 passed
  shell 全 17 文件                 593 passed
```

### 手动验证路径

1. `linghun` task 模式，`/help` → 确认面板覆盖在 transcript 上方，有 `▔` 分隔线
2. 上方可见 2 行消息上下文（peek）
3. Esc 关闭面板，transcript 恢复完整可见
4. `/config`、`/sessions`、`/btw` 同样覆盖显示

## 已知问题

- 窄屏（<40 列）时 `▔` 分隔线可能截断 — 不影响功能
- BackgroundTaskOverlay 仍使用 `borderStyle="round"` 独立渲染（非本阶段范围）

## 不在本阶段处理的内容

- Footer 分层（Phase 5）
- Eviction 延迟消失（Phase 5B）
- 快捷键行内提示（Phase 16）
- 滚动原生化（Phase 6）

## 下一阶段衔接

Phase 5：Footer 分层 + 任务完成 Eviction — StatusFooter 从单行改为多行布局，agent 完成后延迟消失。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §4 |
| 本阶段参考的 CCB 文件 | `FullscreenLayout.tsx:429-447` (modal overlay + ▔ divider + opaque + maxHeight) |
| 行为参考 | CCB absolute modal 定位、transcript peek 行数、▔ divider |
| 自研实现 | `resolvePanel` 面板分发函数；PanelLayer 重构 |
| 未复制可疑源码 | 仅参考行为模式，Linghun 自写所有实现 |
