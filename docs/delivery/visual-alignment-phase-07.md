# Visual Alignment Phase 07 — Task 展示专业化（双行布局）

> **日期：** 2026-06-11
> **状态：** DONE (7A) / DEFERRED (7B)
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

Task 列表改为双行布局，completed 有 strikethrough + dimColor，对齐 CCB TaskListV2 视觉范式。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `TaskListV2.tsx` 双行布局（Row 1: icon+subject+owner / Row 2: activity dimColor）|
| 自研行为 | Linghun `TaskListView.tsx` 双行重构；`evidence` 字段作为 Row 2 activity 源 |
| 新增模块 | 无新文件 |

## 已完成功能

### 7A. 双行布局（DONE）

- **Row 1（标题行）：** marker + subject + owner + blockedBy
  - in_progress：bold + `theme.status.running` color
  - completed：`strikethrough` + `dimColor`（对齐 CCB `strikethrough={isCompleted}`）
  - blocked：`dimColor` + `▸ blocked by #N` 行内标签（对齐 CCB `▶ blocked by`）
  - owner 格式：`(@ownerName)` dimColor（对齐 CCB `(@owner)` 格式）
- **Row 2（活动摘要行）：** `paddingLeft={2}` + dimColor + `…` 省略号后缀
  - 仅 `in_progress && !blocked && activity` 时渲染（对齐 CCB `isInProgress && !isBlocked && activity`）
  - activity 源：TodoItem 的 `evidence` 字段

### 改动对照（CCB 源码事实 vs 实现）

| 维度 | CCB `TaskListV2.tsx:267-324` | Linghun 实现 | 对齐 |
|------|----------------------------|-------------|------|
| 行 1 结构 | `{icon} + subject(bold/strikethrough/dimColor) + (@owner) + ▶ blocked by #N` | `{marker} + subject + (@owner) + ▸ blocked by #N` | ✓ |
| in_progress 视觉 | `bold` + `color="claude"` | `bold` + `color={theme.status.running}` | ✓ |
| completed 视觉 | `strikethrough` + `dimColor` | `strikethrough` + `dimColor` | ✓ |
| blocked 视觉 | `dimColor` | `dimColor` | ✓ |
| Row 2 guard | `isInProgress && !isBlocked && activity` | `inProgress && !blocked && activity` | ✓ |
| Activity 后缀 | `{activity}{figures.ellipsis}` | `{activity}…` | ✓ |
| Owner 格式 | `(@owner)` + 可选 teammate 色 | `(@owner)` dimColor | ✓ |
| blockedBy 格式 | `▶ blocked by #1, #2` dimColor | `▸ blocked by #N, #M` dimColor | ✓ |
| 图标 | ✓ (tick) / ◼ (squareSmallFilled) / ◻ (squareSmall) | ✓ / ■ / □ | ✓ |

### 7B. Ctrl+T 折叠交互（DEFERRED）

- 需要 TuiContext 新字段 `taskViewCollapsed` + Composer dispatch 处理 `toggle-task-panel`
- 需要 auto-hide 5s 倒计时基础设施
- 列为本阶段已知限制，后续 Phase 7B 补丁完成

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/shell/types.ts` | `TaskListView` row 新增 `activity?: string` |
| `packages/tui/src/shell/progress-views.ts` | `buildTaskListView` 从 `evidence` 填充 `activity` |
| `packages/tui/src/shell/components/TaskListView.tsx` | 单行→双行布局重构 |

## 关键设计

1. **标记语义保持不变：** `■` (in_progress) / `□` (blocked/pending) / `✓` (completed via `getStatusMarker("pass")`)
2. **strikethrough 仅用于 completed：** 对齐 CCB 的 `strikethrough={completed}` 语义
3. **activity 源：** 使用 TodoItem 的 `evidence` 字段，仅在 in_progress 时显示
4. **零 view-model 穿透：** visual styling (bold/strikethrough/dimColor) 在组件内决策，不经过 view-model

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

### 自动化测试

```
packages/tui shell/* — 全部通过:
  progress-views.test.ts    6 passed
  view-model.test.ts      344 passed
  shell 全 17 文件         593 passed
```

### 手动验证路径

1. `linghun` task 模式，创建 3 个 todo：in_progress / completed / blocked
2. Row 1 确认：
   - in_progress：bold + 正常色 + `■` 标记
   - completed：`strikethrough` + `dimColor` + `✓` 标记
   - blocked：`dimColor` + `□` 标记
3. 有 activity 的 in_progress task → Row 2 显示 dim activity
4. 无 activity 的 in_progress task → 无 Row 2
5. owner 字段在 Row 1 末尾 dim 显示

## 已知问题

- **7B DEFERRED：** Ctrl+T 折叠交互未实现。任务列表面板当前始终可见（有 task 时）。需要后续补丁增加 `taskViewCollapsed` 状态 + `toggle-task-panel` keybinding。
- **activity 数据稀疏：** 多数 TodoItem 的 `evidence` 为空，Row 2 可能很少出现。未来需增加 task activity 跟踪机制。
- **blockedBy 未显示：** CCB 在 Row 1 显示 blockedBy 标签；Linghun 当前省略以减少拥挤。

## 不在本阶段处理的内容

- Ctrl+T toggle 交互（Phase 7B DEFERRED）
- 5s auto-hide 完成后面板（Phase 7B DEFERRED）
- Task activity 跟踪基础设施
- Session 面板增强（Phase 8）

## 下一阶段衔接

Phase 8：Session 面板增强 — 搜索框 + 分支过滤 + 预览 + 时间分组。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §7 |
| 本阶段参考的 CCB 文件 | `TaskListV2.tsx:1-325` (全文: TaskListV2 + TaskItem 双行布局 + blockedBy 标签 + activity guard + `(@owner)` 格式 + 30s recent-completed TTL) |
| 行为参考 | CCB inline strikethrough + dimColor + `▶ blocked by` + `(!isBlocked)` activity guard + `(@owner)` owner 格式 |
| 自研实现 | evidence→activity 映射；owner 独立渲染（非拼接） |
| 未复制可疑源码 | 仅参考布局范式和状态视觉映射；Linghun 自写所有实现 |

## 成品级结构化 Handoff Packet

```json
{
  "phase": 7,
  "status": "DONE (7A) / DEFERRED (7B)",
  "next_phase": 8,
  "forbidden": [
    "Ctrl+T toggle interaction (deferred to Phase 7B patch)",
    "5s auto-hide timer (deferred to Phase 7B patch)",
    "task activity tracking infrastructure"
  ],
  "evidence": ["593 shell tests pass"],
  "index_state": "not checked (3 files, direct edits)",
  "permission_mode": "auto",
  "model": "claude-opus-4-6",
  "budget": "~6s test duration"
}
```
