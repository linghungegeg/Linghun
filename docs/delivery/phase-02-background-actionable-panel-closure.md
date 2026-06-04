# Phase 2: /background Actionable Panel Closure

## 目标

完成本轮 `/background` 低噪可操作面板闭环：默认仍只展示 summary + 分组短行，在现有 `CommandPanel` 上支持选择、展开详情、停止选中任务和关闭。

## 本阶段范围

- 只改现有 `CommandPanel`、`CommandPanelView`、Composer input-owner、`/background` 行数据和既有 stop dispatch。
- 不新增 `BackgroundTasksDialog`、第二套面板框架、第二套 runner 或 stop 系统。
- 不做 workflow 并发调度、mailbox/team、teammate foreground，也不改 Windows process 底座。

## 已完成功能

- `/background` Ink 面板继续保持低噪 summary + Agent / Verification / Bash-job / Index / MCP / Other 分组短行。
- `/background` sections 的 row 从纯字符串升级为可选择任务项：包含短行 `text`、`taskRef` 和 per-row `detailsText`。
- `CommandPanel` 复用 `cursor` / `scrollOffset` / `expanded` 渲染选中态和当前任务详情。
- Composer 复用 input-owner 的 panel 优先级：只有含可选择任务行的 CommandPanel 才接管 `↑/↓`、`Enter`、`x`、`Esc`。
- `x` 停止当前选中任务，并复用既有路径：
  - agent：`cancelAgentByRef`
  - job：`/job cancel` / `handleJobCommand(["cancel", id])`
  - 普通 background：`abortBackgroundTask` 与 `/interrupt` 同源的状态/event 语义
- 面板 hint 只显示必要快捷键：`↑/↓`、`Enter`、`x`、`Esc`。

## 使用方式

```text
/background
↑/↓ 选择任务
Enter 展开/收起当前任务详情
x 停止当前选中任务
Esc 关闭面板
```

## 涉及模块

- `packages/tui/src/shell/types.ts`
- `packages/tui/src/command-panel-runtime.ts`
- `packages/tui/src/shell/models/input-owner-controller.ts`
- `packages/tui/src/shell/components/Composer.tsx`
- `packages/tui/src/shell/components/CommandPanel.tsx`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/index.ts`

## 关键设计

- `CommandPanelRow` 保持向后兼容：旧命令仍可传字符串 row；`/background` 使用对象 row 携带 `taskRef`。
- 非 Ink / plain 输出继续通过 `showCommandPanel` 输出 row text 或已有 `detailsText`，不暴露对象结构。
- `CommandPanel` 不直接注册键盘事件；所有按键仍走 Composer input-owner 与 `ShellInputEvent`。
- `stopCommandPanelSelection()` 只根据当前选中 `taskRef` 派发现有 cancel/abort 路径，不创建新的任务 runner。
- `/background` 主屏不展示长日志、完整 transcript、raw evidence 或 tool_result raw；完整内容仍走 `detailsText`、`/details background <id>`、`/details output <id>`。

## 配置项

未新增配置项、依赖、环境变量或构建脚本。

## 命令

```text
linghun
/background
```

本阶段不改 CLI 启动入口；Windows 下 `Linghun` 兼容入口沿用既有包配置，未重新验证。

## 测试与验证

- `corepack pnpm --filter @linghun/tui exec tsc --noEmit`：PASS。
- `corepack pnpm --filter @linghun/tui exec vitest run src/shell/models/input-owner-controller.test.ts src/shell/ink-interaction-smoke.test.ts src/shell/view-model.test.ts -t "CommandPanel|interactive panel|background CommandPanel|普通 CommandPanel|selected background row details"`：PASS，3 files，13 tests passed。
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "shows grouped background task panel|Ink /background rows|CommandPanel selection|CommandPanel x|/interrupt sends|/interrupt uses|/interrupt persists|/interrupt cancels running agents|/interrupt <agent-id>"`：PASS，1 file，12 tests passed。
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "AgentControl cancel|cancel all|stop_all|exposes real agent|allows AgentControl|stale agent background"`：PASS，1 file，4 tests passed。
- 额外复查：`corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "supports named background agent mailbox"`：FAIL，`agent.status` expected `cancelled` but received `failed` at `packages/tui/src/index.test.ts:4511`。该测试在手动 `completeAgent()` 后再 `/agents cancel`，触发的是既有 agent lifecycle 口径冲突，不在本阶段 `/background` panel x stop 路径内；本轮未修改 `completeAgent()` / `runAgentWork()` / `isAgentCancellable()` 语义。
- `git diff --check`：PASS。
- `corepack pnpm exec biome format --write`：仅对本轮较小 touched 文件运行；未对超大 `packages/tui/src/index.test.ts` 全文件格式化，避免触发既有 Biome 文件大小限制和无关格式 churn。

## 性能结果

- `/background` 只在现有内存任务数组上做分组、短行 map 和最多 8 行可见窗口计算。
- 键盘移动只更新 `cursor` / `scrollOffset`，没有后台轮询、模型调用或额外 I/O。

## 已知问题

- 本阶段不改变已有 `/details` 长日志读取能力；Enter 展开的是当前任务的 bounded details 文本，不是完整 log tail viewer。
- `packages/tui/src/index.test.ts` 仍是仓库既有超大测试文件；本轮只追加 focused 回归，未拆分文件。
- 额外 named background agent mailbox 回归仍失败：手动完成 agent 后再 cancel 的期望与当前 running-only cancellable 口径冲突。该问题不阻塞本阶段 `/background` selected x stop，因为新 agent x 测试覆盖的是 running agent 并通过。

## 不在本阶段处理

- 不新增 `BackgroundTasksDialog` 或全屏 background 管理器。
- 不新增 runner、stop controller、job scheduler 或 workflow 并发调度。
- 不实现 mailbox/team/teammate foreground。
- 不修改 provider/model/key/env route、权限模式、Windows process guard 或发布流程。

## 下一阶段衔接

下一步如继续任务面板成熟化，可在用户确认后单独处理更完整的 log artifact 快捷查看或测试文件拆分；本轮完成后停止，不自动进入下一阶段。

## 开发者排查入口

- `/background` 面板数据：`packages/tui/src/job-agent-command-runtime.ts`
- CommandPanel row 类型与 plain fallback：`packages/tui/src/shell/types.ts`、`packages/tui/src/command-panel-runtime.ts`
- 面板渲染与详情展开：`packages/tui/src/shell/components/CommandPanel.tsx`
- input-owner panel 优先级：`packages/tui/src/shell/models/input-owner-controller.ts`、`packages/tui/src/shell/components/Composer.tsx`
- 选择与停止派发：`packages/tui/src/index.ts`

## 状态栏与统计口径

- 未改状态栏字段、cache/index/usage 显示或成本统计。
- `/background` summary 仍只显示任务数量口径：running、need attention、failed/blocked、done。
- agent stale/terminal 过滤沿用上一阶段 Agent Stop & Display Closure 的口径。

## 学习成本与渐进披露

- 默认入口仍是 `/background`。
- 新增快捷键只出现在可交互 `/background` CommandPanel hint 中。
- 普通 CommandPanel 仍只提示 `Esc`，不会让所有命令面板误接管行操作。

## TUI 渲染稳定性

- 只影响现有 CommandPanel 内部行渲染和 Composer input-owner；不新增 messages、status、background summary 分区。
- 每行继续走 `fitText()` 截断，长 details 只在 Enter 展开后显示。
- 可选择行超过 8 条时使用 `scrollOffset` 裁剪，避免面板撑爆主屏。

## 主输出与日志分层

- 主屏：summary + 分组短行 + 必要快捷键。
- details：当前选中任务的 `detailsText`，包含已有 `/details background <id>` / log/output 路径提示。
- raw evidence、完整 transcript、完整 stdout/stderr、内部 schema/debug 词仍不得进入默认主屏。

## 阶段 Verdict

- verdict：PASS
- 是否允许进入下一阶段：no，需用户确认
- P0/P1/P2 风险分类：无阻断 P0/P1；P2 为 `index.test.ts` 既有超大文件未在本轮拆分，以及 named mailbox 额外回归仍失败但不属于本阶段触达路径
- 阻塞项：无
- 用户下一步审核点或命令：在 TUI 中运行 `/background`，用 `↑/↓`、`Enter`、`x`、`Esc` 试选中、详情和停止路径

## 真实改动文件

- 代码：`packages/tui/src/shell/types.ts`、`packages/tui/src/command-panel-runtime.ts`、`packages/tui/src/shell/models/input-owner-controller.ts`、`packages/tui/src/shell/components/Composer.tsx`、`packages/tui/src/shell/components/CommandPanel.tsx`、`packages/tui/src/job-agent-command-runtime.ts`、`packages/tui/src/index.ts`
- 测试：`packages/tui/src/shell/models/input-owner-controller.test.ts`、`packages/tui/src/shell/ink-interaction-smoke.test.ts`、`packages/tui/src/shell/view-model.test.ts`、`packages/tui/src/index.test.ts`
- 文档：`docs/delivery/phase-02-background-actionable-panel-closure.md`、`docs/delivery/README.md`
- 生成物：无
- 用户已有 diff / 非本轮证据：根目录 `.md`、`report.md`、`test-model-set.sh`、`docs/stress/` 为开工前未跟踪项，本轮未修改

## 运行时事实

- provider/model：未改 provider/model；测试使用现有 mock / fixture
- permission mode：未改权限模式或 Start Gate
- index status：codebase-memory MCP 工具本轮不可用，按仓库规则使用 `rg` 与源码精读
- cache/usage 来源：未调用真实 provider，未产生真实 usage 或账单
- 配置来源：沿用当前测试上下文与项目 storage 配置
- 是否有脱敏/密钥风险：无 API key、token、Authorization header、cookie 改动或输出

## 后台/复查任务状态反馈

- 本阶段没有启动新的 Linghun runtime 后台任务。
- 用户要求“多开智能体继续工作”，本轮使用两个只读复查子智能体并行检查实现边界和测试覆盖；无子智能体改文件。

## 语言与 i18n 口径

- 新增 hint 提供 zh-CN / en-US 文案。
- Slash 命令、配置键和结构化事件字段保持英文。

## 参考核对

- 已读取 Linghun 文档：`AGENTS.md`、`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`、`docs/delivery/README.md`、`docs/delivery/pre-smoke-tui-task-panel-maturity.md`、`docs/delivery/phase-agent-stop-display-closure.md`。
- 已精读 Linghun 源码：`CommandPanel`、`Composer`、input-owner controller、`CommandPanelView` 类型、`/background` runtime、AgentControl/job/background cancel 入口和相关 tests。
- 本轮未读取本地 CCB 源码；用户明确要求只基于现有源码事实推进，并禁止新开 CCB 风格第二套 panel。
- 行为参考进入 Linghun 自研实现：低噪分组面板、必要键位 hint、选中行详情、复用既有 cancel/abort 路径。
- 未复制 CCB 源码、内部 API、专有遥测或可疑实现。

## Source-Level Reality Check

- existing implementation：已有 `CommandPanel`、`CommandPanelView.cursor/scrollOffset/expanded`、Composer input-owner panel 优先级、`/background` 分组面板、AgentControl cancel/list、`cancelAgentByRef`、`handleJobCommand(["cancel"])`、`abortBackgroundTask` / `/interrupt`。
- gaps：`/background` row 还是纯字符串，无法选择；CommandPanel 无当前任务选中态；Enter/x 没有面板级派发；停止选中任务没有统一从 panel 派发现有 cancel/abort 路径。
- minimal touch points：只补 `CommandPanelRow` 数据、input-owner interactive panel 判定、CommandPanel 渲染、`/background` row 构造、`index.ts` 选择/停止事件和 focused tests。
- forbidden duplicate systems：未新增 background dialog、第二套面板框架、第二套 stop 系统、runner、workflow scheduler、mailbox/team 或 Windows process 底座。

## 交接摘要

- 下一阶段：用户确认后再继续；本轮不自动推进。
- 禁止事项：不要新建 `BackgroundTasksDialog`；不要新增 runner/stop 系统；不要把 `/background` 默认改成长日志或 raw evidence；不要做 workflow/team/mailbox/Windows process 改动。
- 证据引用：本报告“测试与验证”；`packages/tui/src/index.test.ts` 的 `/background` selectable rows 与 `CommandPanel x` 三路径测试；`packages/tui/src/shell/ink-interaction-smoke.test.ts` 的键盘事件测试；`packages/tui/src/shell/models/input-owner-controller.test.ts` 的 panel 优先级测试。
- 验证结果：typecheck PASS，focused UI tests PASS，focused runtime tests PASS，AgentControl focused tests PASS，`git diff --check` PASS；额外 named background agent mailbox regression FAIL，见“测试与验证”。
- 索引状态：codebase-memory MCP 未暴露可调用工具，使用 `rg` / 源码精读。
- 权限模式：未修改。
- 模型/provider：未修改。
- 预算使用情况：本地测试和子智能体复查，无真实 provider runtime usage。
