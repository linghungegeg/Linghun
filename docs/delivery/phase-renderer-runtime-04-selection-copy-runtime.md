# Renderer Runtime Phase 04 — Mouse Selection / Copy Runtime

## 阶段目标

把 transcript mouse selection / copy-on-select 的核心状态机和复制决策下沉到 `@linghun/ink-runtime`，让 TUI app 层只负责屏幕行构建、事件接线和 OS clipboard I/O，闭合单击误复制、拖拽 settle、lost-release recovery 与 copy-on-select 配置边界。

## 已完成功能

- 新增 `packages/ink-runtime/src/terminal-selection.ts`。
- `@linghun/ink-runtime` 导出 selection runtime API：
  - SGR mouse selection 解析。
  - selection state / point / row / range 类型。
  - `reduceTerminalSelection()` 状态机。
  - selected text 抽取。
  - block line/range highlight helper。
- `packages/tui/src/shell/models/transcript-selection-state.ts` 改为薄适配层：
  - 保留 `ProductBlockViewModel -> screen rows` 构建。
  - selection/copy reducer、copy rules、range helper 均委托 runtime。
- `MouseInputRouter` 复用 runtime `parseTerminalInput()` 处理结构化 wheel / mouse 事件。
- 保留 orphan mouse tail fallback 作为 safety guard，不再把它作为主 selection parser。
- 补齐 lost-release recovery：
  - focus-out settle。
  - no-button hover settle。
  - fresh press while dragging settle previous selection。
- 补齐 copy rules：
  - 单击不复制。
  - 空选区不复制。
  - whitespace-only 不复制。
  - drag release 复制一次。
  - double-click word / triple-click line 可复制。
  - `copyOnSelect: false` 时保留选区但不写 clipboard。
- 新增 `LINGHUN_TUI_MOUSE_SELECTION=0`：只禁用鼠标点击/选区路由，保留既有 wheel routing。

## 使用方式

本阶段没有新增 CLI / slash command。

用户侧可选环境变量：

```text
LINGHUN_TUI_MOUSE_SELECTION=0
```

效果：禁用 transcript 鼠标点击/拖选 selection 路由，但不关闭 `MouseInputRouter` 的 wheel scroll 处理。

开发者入口：

```ts
import {
  reduceTerminalSelection,
  parseTerminalSelectionMouseEvent,
  terminalSelectedTextFromRows,
} from "@linghun/ink-runtime";
```

## 涉及模块

代码：

- `packages/ink-runtime/src/terminal-selection.ts`
- `packages/ink-runtime/src/index.ts`
- `packages/tui/src/shell/models/transcript-selection-state.ts`
- `packages/tui/src/shell/components/MouseInputRouter.tsx`
- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/types.ts`

测试：

- `packages/ink-runtime/src/terminal-selection.test.ts`
- `packages/tui/src/shell/models/transcript-selection-state.test.ts`

文档：

- `RENDERER_RUNTIME_MIGRATION_PLAN.md`
- `docs/delivery/phase-renderer-runtime-04-selection-copy-runtime.md`
- `docs/delivery/README.md`

生成物：

- `packages/ink-runtime/dist/*`（由 `@linghun/ink-runtime build` 更新 declarations / bundle）

## 关键设计

- Runtime owns selection behavior：press / drag / release / double-click / triple-click / lost-release / copy decision 都在 `@linghun/ink-runtime`。
- TUI owns ProductBlock projection：screen rows 仍由 TUI adapter 构建，因为它依赖 Linghun 的 `ProductBlockViewModel`。
- Clipboard I/O 不下沉：OS clipboard 写入继续复用 `packages/tui/src/shell/clipboard.ts`，避免新增第二套 clipboard backend。
- Wheel runtime 不混入本阶段：`MouseInputRouter` 仍保留既有 wheel acceleration 和 microtask batching，Phase 5 再处理 scroll runtime maturity。
- `LINGHUN_TUI_MOUSE_SELECTION=0` 是 selection/click 开关，不改变 terminal mode ownership，也不关闭 wheel routing。

## 配置项

新增：

```text
LINGHUN_TUI_MOUSE_SELECTION=0
```

沿用：

```text
LINGHUN_TUI_MOUSE=0
```

区别：

- `LINGHUN_TUI_MOUSE=0`：禁用 app-owned mouse tracking 路由。
- `LINGHUN_TUI_MOUSE_SELECTION=0`：只禁用 selection/click 事件，wheel routing 仍保留。

## 命令

无新增 CLI / slash command。

## 测试与验证

已运行：

```text
corepack pnpm exec vitest run packages/ink-runtime/src/terminal-input.test.ts packages/ink-runtime/src/terminal-selection.test.ts packages/tui/src/shell/models/terminal-input-runtime.test.ts packages/tui/src/shell/models/transcript-selection-state.test.ts packages/tui/src/shell/terminal-interaction-runtime.test.ts
corepack pnpm --filter @linghun/ink-runtime typecheck
corepack pnpm --filter @linghun/ink-runtime build
corepack pnpm --filter @linghun/tui typecheck
```

结果：全部 PASS，60 tests。

Focused coverage：

- Terminal input parser：12 tests。
- Selection runtime：8 tests。
- TUI input runtime：15 tests。
- Terminal mode runtime：10 tests。
- TUI selection adapter：15 tests。

定向复检修复（2026-06-10）：

- 发现并修复 `MouseInputRouter` 中缺失的 `continue` 语句：处理完结构化鼠标事件后现在正确跳过 fallback 路径，避免同一事件被处理两次。
- 验证坐标转换一致性：`parseTerminalInput()` 返回 1-based 终端坐标，`MouseInputRouter` 应用 `-1` 转换为 0-based；fallback 路径使用的 `parseSgrMouseEvent()` 已返回 0-based 坐标。两条路径均正确且有测试覆盖。
- 修复后全部 60 个测试仍然通过。

## 性能结果

未新增 benchmark。Selection reducer 对当前 screen rows 做线性切片/范围计算；本阶段 focused tests、runtime build 和 TUI typecheck 均本地快速完成，未引入持续循环或高频 redraw 机制。

## 已知问题

- 未运行真实终端 drag/copy/manual lost-release smoke。
- OS clipboard 写入仍在 TUI controller，runtime 只负责 copy decision 和 selected text。
- Transcript screen row 构建仍在 TUI adapter，因为它依赖 `ProductBlockViewModel`。
- Wheel acceleration / scroll drain / render throttle 仍是 Phase 5+ 范围。

## 不在本阶段处理的内容

- 不改视觉样式、布局、主题、footer、panel、composer 外观。
- 不重写 wheel/scroll runtime。
- 不改 render/flush lifecycle。
- 不改 provider / model / tool / scheduler / agent / MCP / permission 主链。
- 不新增第二套 transcript 数据源或 clipboard backend。
- 不复制或 vend CCB 源码。

## 下一阶段衔接

Phase 5 应处理 wheel / scroll runtime：pending delta accumulator、frame/timer drain、trackpad/physical wheel heuristics、direction flip debounce 和高频 wheel 不造成 state-update explosion。除非真实终端 smoke 发现 Phase 4 回归，否则不要再次重写 selection/copy。

## 开发者排查入口

- Runtime selection reducer：`packages/ink-runtime/src/terminal-selection.ts`
- Runtime tests：`packages/ink-runtime/src/terminal-selection.test.ts`
- TUI adapter：`packages/tui/src/shell/models/transcript-selection-state.ts`
- Mouse route：`packages/tui/src/shell/components/MouseInputRouter.tsx`
- Controller clipboard I/O：`packages/tui/src/index.ts`
- 阶段根计划：`RENDERER_RUNTIME_MIGRATION_PLAN.md`

## 参考核对

实际读取的 Linghun 文档：

- `RENDERER_RUNTIME_MIGRATION_PLAN.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-renderer-runtime-02-terminal-tokenizer-parser.md`
- `docs/delivery/phase-renderer-runtime-03-terminal-mode-runtime.md`

实际参考的行为事实：

- Phase 0-3 已记录的 CCB 行为级事实：renderer-owned selection/copy、click-without-copy、settled selection copy、lost-release recovery、focus events、no-button motion。

进入 Linghun 自研实现的内容：

- 自研 `reduceTerminalSelection()` selection/copy reducer。
- 自研 selected-text / range helper。
- 自研 focused tests。
- TUI thin adapter 与 existing clipboard backend 复用。

未复制内容：

- 未复制 CCB 私有源码。
- 未 vend CCB forked Ink。
- 未导入 CCB internal API。

## 成品级结构化 handoff packet

```text
phase: Renderer Runtime Phase 04 — Mouse Selection / Copy Runtime
status: PASS / focused-local-validation + targeted-review-fix
next_phase: Renderer Runtime Phase 05 — Wheel / Scroll Runtime
must_not_do_next:
  - 不改视觉风格作为 Phase 5 的目标
  - 不重写 selection/copy，除非真实终端 smoke 发现回归
  - 不改 provider/model/tool/scheduler/agent/MCP 主链
  - 不复制 CCB 私有源码
  - 不新增第二套 transcript 数据源或 clipboard backend
evidence:
  - packages/ink-runtime/src/terminal-selection.ts
  - packages/ink-runtime/src/terminal-selection.test.ts
  - packages/tui/src/shell/models/transcript-selection-state.ts
  - packages/tui/src/shell/components/MouseInputRouter.tsx (fixed: added continue after mouse event handling)
  - packages/tui/src/shell/components/ShellApp.tsx
  - RENDERER_RUNTIME_MIGRATION_PLAN.md
  - docs/delivery/phase-renderer-runtime-04-selection-copy-runtime.md
validation:
  - all Phase 1-4 tests: PASS, 60 tests
  - @linghun/ink-runtime typecheck: PASS
  - @linghun/ink-runtime build: PASS
  - @linghun/tui typecheck: PASS
targeted_review_fixes:
  - MouseInputRouter missing continue after structured mouse event handling
  - Verified coordinate transformation consistency between main and fallback paths
manual_validation:
  - real terminal drag/copy/lost-release smoke: NOT RUN
index_status: not refreshed in this phase; source files verified directly
permission_mode: Auto Mode; local source edits and local validation only
model_provider: Claude Code session model; no product model/provider logic changed
budget_usage: no explicit token budget set
```
