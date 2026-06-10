# Visual Alignment Phase 03 — Agent Tree / Workflow Tree 布局对齐

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

Agent Tree / Workflow Tree 从 TranscriptViewport 内移到固定底部（flexShrink={0}），增加键盘交互（↑↓ 选择、Enter 查看详情、x 关闭、Esc 取消）。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `FullscreenLayout` bottom 区域 `flexShrink={0}` 固定；CCB `TeammateSpinnerLine` 的 pointer + ╞═/╘═ tree chars + selection mode |
| 自研行为 | Linghun 自有的 `WorkflowProgressView` 同样移到固定区；Enter 展开 detail row（非 CCB 的 teammate view） |
| 新增模块 | 无新文件；`TuiContext.agentTreeState` + `ShellInputEvent` 4 个新事件类型 |

## 已完成功能

### 3A. 布局：Tree 移到固定底部

- **ShellApp.tsx** — AgentProgressTree 和 WorkflowProgressView 从 TranscriptViewport 内移除
- 两棵树插入 Composer band（`flexShrink={0}`）区域，NotificationStack 下方、Composer 上方
- 对标 CCB FullscreenLayout bottom 三层：Spinner → PromptInput → Footer
- Linghun 层级：Notification → Agent Tree → Workflow Tree → Composer → Footer

### 3B. 交互：键盘选择 + Enter 进入

**AgentProgressTree.tsx — 选择视觉效果：**
- 选中行 `▶` pointer 前缀（CCB `figures.pointer`），未选中行空格占位
- 选中 branch 用 `╞═` / `╘═`（CCB 高亮 tree chars），未选中用 `├─` / `└─`
- 选中行 accent 色 + bold，未选中 dimColor
- Enter 展开/折叠 detail row（显示 status + toolUses）
- 选择激活时显示键盘提示行：`↑↓ 选择 · Enter 查看 · x 关闭 · Esc 取消`

**进度视图变更（progress-views.ts）：**
- 移除 `MAX_MAINSCREEN_AGENTS = 4` 限制，显示所有 running agent
- `hiddenPending` 始终为 0（不再截断）

**键盘路由（Composer.tsx）：**
- ↑↓ 空输入 + agent tree 可见 → `agent-tree-move`（优先级高于 transcript-scroll）
- Enter + cursor ≥ 0 → `agent-tree-enter`
- x（无修饰键）+ cursor ≥ 0 → `agent-tree-close`
- Esc + cursor ≥ 0 → `agent-tree-escape`

**状态管理（index.ts）：**
- `agent-tree-move` — cursor < 0 时首次按箭头自动进入选择（cursor=0）；后续上下导航，夹紧 [0, rows.length)
- `agent-tree-enter` — toggle expandedId
- `agent-tree-close` — 设置 agent.status = "cancelled"，重置 cursor
- `agent-tree-escape` — 重置 cursor = -1（退出选择模式，保留 tree 可见）
- 通用 Esc handler 同步清除 agentTreeState

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/shell/types.ts` | AgentProgressTreeView 新增 cursor/expandedId；新增 4 个 ShellInputEvent 类型 |
| `packages/tui/src/tui-context-runtime.ts` | 新增 `agentTreeState?: { cursor; expandedId? }` |
| `packages/tui/src/tui-messages.ts` | 新增 `r3AgentDetailStatus` / `r3AgentDetailTools` i18n |
| `packages/tui/src/shell/progress-views.ts` | 移除 MAX_MAINSCREEN_AGENTS，显示所有 running agent，透传 cursor/expandedId |
| `packages/tui/src/shell/components/AgentProgressTree.tsx` | 完整重写：选择视觉 + 展开 detail + 移除截断 |
| `packages/tui/src/shell/components/ShellApp.tsx` | AgentProgressTree 和 WorkflowProgressView 从 TranscriptViewport 移入 Composer band |
| `packages/tui/src/shell/components/Composer.tsx` | ↑↓/Enter/x/Esc 拦截，agent tree 优先级高于 transcript-scroll |
| `packages/tui/src/index.ts` | onInput 新增 4 个 agent tree 事件处理；Esc 同步清除 agentTreeState |
| `packages/tui/src/shell/progress-views.test.ts` | 更新 hiddenPending 断言（0 而非 1） |

## 关键设计

1. **选择模式进入：** 树可见时首次按 ↑↓ 自动进入选择（cursor=-1→0），无需额外快捷键。Esc 退出选择（cursor=-1），恢复箭头键为 transcript-scroll。
2. **Enter 详情：** 展开 inline detail row（状态 + 工具数），非 CCB 的 teammate view。未来可扩展为完整 agent 对话视图。
3. **x 关闭：** 直接 `agent.status = "cancelled"`，与 `background-control-runtime.ts` 和 `job-agent-command-runtime.ts` 一致。
4. **无截断：** 所有 running agent 均显示，`hiddenPending` 恒为 0；blocked/stale/completed agents 不在树中（仅 running）。

## 配置项

无新增配置项。

## 命令

无新增命令。树交互全通过键盘操作：
- `↑↓` — 选择 agent（空输入时）
- `Enter` — 展开/折叠详情
- `x` — 关闭选中 agent
- `Esc` — 取消选择

## 测试与验证

### 自动化测试

```
packages/tui — 全部通过:
  shell/progress-views.test.ts     6 passed
  shell/components/composer-dispatch.test.ts  42 passed
  shell/view-model.test.ts         344 passed
  shell/*.test.ts                  全套 593 passed
  packages/tui 全部 (excl index.test.ts)  2281 passed
```

### 手动验证路径

1. `linghun` 进入 task 模式，触发多 agent 运行
2. 确认 Agent Tree 固定在 Composer 上方，不随消息滚动
3. 空输入时按 ↑↓ — 树高亮移动，▶ 指示选中项
4. Enter — 展开/折叠 detail 行
5. x — 关闭选中 running agent（标记 cancelled、消失）
6. Esc — 取消选择，箭头恢复 transcript-scroll

## 已知问题

- `agent-tree-close` 不触发 agent 的后端清理（如 abort 请求），仅 UI 层标记 cancelled
- 无 `useTerminalFocus` 失焦暂停 — ink-runtime 不支持

## 不在本阶段处理的内容

- Task 展示双行布局（Phase 7）
- Eviction 延迟消失（Phase 5B）
- Agent 完成后的 ✓ 标记（Phase 5B）
- Compact 边界标记（Phase 9）

## 下一阶段衔接

Phase 4：Modal/Panel 全屏覆盖 — PanelLayer 从流式卡片改为 `position="absolute"` 覆盖层。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §3 |
| 本阶段参考的 CCB 文件 | `FullscreenLayout.tsx` (bottom fixed), `TeammateSpinnerLine.tsx` (selection pointer/treeChar), `TeammateSpinnerTree.tsx` (selection mode) |
| 行为参考 | CCB bottom fixed layout; CCB ╞═/╘═ + ▶ pointer; CCB selection mode cursor |
| 自研实现 | `agentTreeState` 模式（类比 `backgroundOverlayState`）；inline detail expand（非 teammate view） |
| 未复制可疑源码 | 仅参考行为模式，Linghun 自写所有实现 |
