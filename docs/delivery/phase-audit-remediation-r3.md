# Phase Audit Remediation R3 — Task/Agent/Workflow 可视化

## 阶段目标

实现 `AUDIT_REMEDIATION_PLAN.md` Phase R3 的 8 项验收要求：agent/task/workflow 进度树可视化、Shift+Down 后台任务 overlay、长输出折叠、智能截断、工具输出差异化渲染、任务完成结构化摘要。

## 已完成功能

1. **AgentProgressTree**：树形 `├─`/`└─` 展示 agent 名称 + 状态 + tool uses + tokens。
2. **TaskListView**：`✓/■/□` 图标 + subject + owner + blocked-by 清单。
3. **WorkflowProgressView**：workflow 各步骤进度，当前运行步骤高亮。
4. **BackgroundTaskOverlay**：`Shift+Down` 弹出，支持 ↑/↓ 导航、Enter 详情、x 停止、Esc 关闭。
5. **长输出折叠**：已有 `tool-output-presenter.ts` `createSummaryFirstPreview` 实现（Ctrl+O 展开）。
6. **智能截断**：`smartSlice` 优先展示 in_progress + 最近 completed，超出显示 `…+N pending`。
7. **工具输出差异化渲染**：已有 `formatToolStart`（Bash 命令行、Read/Write 路径、Edit patch 摘要）。
8. **任务完成摘要**：agent 完成后输出结构化耗时/tokens/工具/结论；workflow 完成后 transcript 记录 `workflow_completion` system_event。

## 使用方式

- Agent/Task/Workflow 面板在 task 工作区自动显示（有活跃 agent/todo/workflow 时）。
- `Shift+Down`：任意时刻弹出后台任务 overlay；在 overlay 中 `↑/↓` 导航，`Enter` 查看详情，`x` 停止选中任务，`Esc` 关闭。
- `Ctrl+O`：展开长输出折叠内容。
- 完成摘要自动追加到 transcript，不需要用户操作。

## 涉及模块

| 文件 | 作用 |
|------|------|
| `packages/tui/src/shell/progress-views.ts` | 纯投影层：从 TuiContext 生成 AgentProgressTree/TaskList/Workflow/Overlay ViewModel |
| `packages/tui/src/shell/components/AgentProgressTree.tsx` | 自研 agent 树组件 |
| `packages/tui/src/shell/components/TaskListView.tsx` | 自研 task 清单组件 |
| `packages/tui/src/shell/components/WorkflowProgressView.tsx` | 自研 workflow 进度组件 |
| `packages/tui/src/shell/components/BackgroundTaskOverlay.tsx` | 自研后台 overlay 组件 |
| `packages/tui/src/shell/types.ts` | 新增 AgentProgressTreeView / TaskListView / WorkflowProgressView / BackgroundTaskOverlayView 类型 |
| `packages/tui/src/shell/view-model.ts` | 接线：调用 progress-views 投影，挂载到 ShellViewModel |
| `packages/tui/src/shell/components/ShellApp.tsx` | 渲染 R3 组件 |
| `packages/tui/src/shell/components/Composer.tsx` | Shift+Down 快捷键分发 + overlay 内键盘路由 |
| `packages/tui/src/index.ts` | overlay controller handlers（open/close/move/toggle/stop） |
| `packages/tui/src/tui-context-runtime.ts` | `backgroundOverlayState` 可见状态字段 |
| `packages/tui/src/tui-messages.ts` | R3 所有 i18n key（zh-CN + en-US） |
| `packages/tui/src/tool-output-presenter.ts` | 已有长输出折叠/差异化渲染（未改动） |
| `packages/tui/src/job-agent-command-runtime.ts` | `formatAgentCompletionSummary` + import messages |
| `packages/tui/src/workflow-command-runtime.ts` | `finishWorkflowRun` 追加 workflow_completion system_event |

## 关键设计

- **纯投影 + 展示组件**：`progress-views.ts` 从已有 `TuiContext.agents` / `.tools.todos` / `.workflows` / `.backgroundTasks` 投影，不新建运行时状态。
- **复用 CommandPanel 停止路径**：overlay x 键复用 `stopCommandPanelSelection`，走已有 agent/job/background cancel。
- **smartSlice 智能截断**：优先 active items + 最近 N 条，隐藏的仅显示计数。
- **无侵入安全守卫**：所有投影函数对 undefined/empty context 字段做 `?? []` 防御，不影响已有测试。

## 配置项

无新增环境变量或配置。

## 命令

无新增 slash command；overlay 通过 `Shift+Down` 全局快捷键触发。

## 测试与验证

- `progress-views.test.ts`：4 tests 覆盖 agent/task/workflow/overlay 投影。
- `ink-interaction-smoke.test.ts`：新增 `Shift+Down` overlay open 交互测试。
- 全量 `vitest run`：3192 passed / 0 failed / 2 skipped。
- `corepack pnpm --filter @linghun/tui typecheck`：pass。
- `corepack pnpm build`：pass。
- `node apps/cli/dist/main.js --version`：`0.1.0`。
- `node apps/cli/dist/main.js --help`：正常输出。

## 性能结果

- 投影函数为同步纯函数，O(N) 线性，N = 活跃 agent/task/workflow 数（通常 < 20）。
- 无额外 IO、网络或磁盘。

## 已知问题

- R3 验收标准第 5 项"手动展开"依赖已有 Ctrl+O 路径；当前无 inline click 展开。
- Workflow 完成摘要不包含 tool uses 总计（workflow 运行时不维护全局 tool count）。

## 不在本阶段处理的内容

- Phase R4 交互成熟度（持久化历史、Ctrl+R、undo ring、ghost text 等）。
- Phase R5 Alt-Screen + ScrollBox。
- 新增 agent/workflow 运行时能力。

## 下一阶段衔接

Phase R4：交互成熟度（持久化磁盘历史、Ctrl+R、inline ghost text、prompt 暂存等）。

## 开发者排查入口

- `progress-views.ts` 投影层入口。
- `Composer.tsx` `Shift+Down` 分发。
- `index.ts` overlay 控制器（搜索 `background-overlay-`）。

## 参考核对

- 本阶段参考了 `AUDIT_REMEDIATION_PLAN.md` Phase R3 节。
- CCB AgentProgressLine / TaskListV2 / BackgroundTasksDialog 仅作为行为参考（树形字符/颜色/导航模式）。
- 未复制可疑源码实现。

## Handoff Packet

| 项目 | 内容 |
|------|------|
| 下一阶段 | Phase R4 交互成熟度（用户确认后开始） |
| 禁止事项 | 不得自动进入 R4/R5/R6 |
| 验证结果 | 3192/3192 pass, typecheck pass, build pass, CLI smoke pass |
| 索引状态 | 未刷新（本阶段不涉及索引改动） |
| 权限模式 | 未改动 |
| 模型/provider | 未改动 |
| 预算使用 | 无额外依赖/联网/安装 |
