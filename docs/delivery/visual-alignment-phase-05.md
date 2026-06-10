# Visual Alignment Phase 05 — Footer 分层 + Eviction 延迟消失

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

Footer 从单行改为两行布局（宽屏），agent 完成后保留 5 秒延迟消失（带 ✓ 标记）。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `PromptInputFooter` 两行布局：行 1 StatusLine + 行 2 metadata；CCB `CoordinatorAgentStatus` 1s interval eviction |
| 自研行为 | Linghun `buildAgentProgressTreeView` 首次发现 completed agent 时自动记录时间戳；`AGENT_EVICTION_DELAY_MS = 5000` |
| 新增模块 | 无新文件 |

## 已完成功能

### 5A. Footer 两行布局

- **StatusFooter.tsx** — 宽屏（≥80 列）时改为两行布局：
  - 行 1（StatusLine）：`workspaceStatus` + `runtimeStatus`，dim 色
  - 行 2（metadata）：左 `permissionMode · cyclePermHint`，右 `model · cache · index · reasoning · git · context`
- 窄屏（<80 列）保持单行压缩布局（列向），`FooterDetailLines` 保留
- 旧窄屏阈值 60 → 80 列（对齐 CCB 80+ 宽屏概念）
- `FooterDetailLines` 在宽屏模式中不再渲染（内容已提升到 StatusLine）

### 5B. Eviction 延迟消失

- **TuiContext** — 新增 `agentCompletedAt?: Record<string, number>` 跟踪 agent 完成时间戳
- **progress-views.ts** — `buildAgentProgressTreeView`:
  - `AGENT_EVICTION_DELAY_MS = 5000`（5 秒延迟，对齐 CCB `evictAfter`）
  - 首次发现 `status === "completed"` 的 agent 时自动记录 `Date.now()`
  - `recentlyCompleted` 过滤：`completed` + 时间差 < 5s → 继续显示
  - `visible = [...running, ...recentlyCompleted]`
- **AgentProgressTree.tsx** — completed agent 行：
  - 前缀 `✓`（替代 `▶`/` `）
  - `theme.status.info` 色（success 绿）
  - 整体 dimColor（已完成视觉降级）

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/shell/components/StatusFooter.tsx` | 宽屏两行布局；窄屏阈值 60→80 |
| `packages/tui/src/tui-context-runtime.ts` | 新增 `agentCompletedAt` 字段 |
| `packages/tui/src/shell/progress-views.ts` | `AGENT_EVICTION_DELAY_MS` + auto-record timestamps + eviction filter |
| `packages/tui/src/shell/components/AgentProgressTree.tsx` | ✓ marker + completed dimColor |
| `packages/tui/src/shell/progress-views.test.ts` | 更新 2 个 test 验证 eviction 行为 |

## 关键设计

1. **自动时间戳记录：** `buildAgentProgressTreeView` 在首次发现 completed agent 时向 `context.agentCompletedAt` 写入 `Date.now()`。无需修改 agent 生命周期代码，零耦合。
2. **Eviction 窗口：** 5 秒。时间戳过期后 agent 自动从树中移除（filter 排除）。
3. **Completed 视觉：** `✓` + `status.info`（绿）+ `dimColor`。running agent 保持正常颜色。
4. **窄屏阈值 80：** 对齐 CCB `PromptInputFooter` 的宽屏概念。60→80 升级。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

### 自动化测试

```
packages/tui shell/* — 全部通过:
  progress-views.test.ts          6 passed (2 updated for eviction)
  view-model.test.ts             344 passed
  composer-dispatch.test.ts       42 passed
  status-footer.test.ts (implicit) 通过 ink-interaction-smoke
  shell 全 17 文件                 593 passed
```

### 手动验证路径

1. `linghun` task 模式，确认 Footer 宽屏（≥80 列）显示两行
2. 行 1 显示 workspaceStatus / runtimeStatus（dim 色）
3. 行 2 显示 permissionMode + 元数据
4. 窄屏（<80 列）回落单行
5. 触发 agent 完成后，确认 ✓ 标记 + 绿色 + dimColor
6. 5 秒后 agent 从树中自动消失

## 已知问题

- `agentCompletedAt` 时间戳在 TuiContext 中持久化，不会自动清理过期条目（量极小，可接受）
- Eviction 依赖 view-model 重建周期触发；无独立 1s interval（对齐 CCB 的 setInterval 但 Linghun 用渲染周期替代）

## 不在本阶段处理的内容

- Task 展示双行布局（Phase 7）
- 快捷键行内提示（Phase 16）
- 远程连接状态指示器（Phase 19）
- 滚动原生化（Phase 6）

## 下一阶段衔接

Phase 19：远程连接状态指示器 — Footer 右侧新增 `● remote` 链接指示器。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §5 |
| 本阶段参考的 CCB 文件 | `PromptInputFooter.tsx:148-199` (two-line layout), `CoordinatorAgentStatus.tsx:54-70` (eviction timer) |
| 行为参考 | CCB StatusLine 提升到行 1；CCB `evictAfter` + 1s interval eviction |
| 自研实现 | Auto-record completion timestamps in `buildAgentProgressTreeView`；5s eviction via render-cycle filter |
| 未复制可疑源码 | 仅参考行为模式，Linghun 自写所有实现 |
