# Renderer Runtime Phase 03 — Terminal Mode Runtime

## 阶段目标

把 terminal mode enable/disable/reassert/cleanup 收敛到 `@linghun/ink-runtime`，启用 CCB 成熟度所需的 `1000 + 1002 + 1003 + 1006` SGR mouse 模式，并补上 focus events 与 bracketed paste 的统一生命周期管理。

## 已完成功能

- 新增 `packages/ink-runtime/src/terminal-modes.ts`。
- `@linghun/ink-runtime` 导出 terminal mode runtime API。
- SGR mouse enable 序列升级为：

```text
?1000h + ?1002h + ?1003h + ?1006h
```

- disable 按安全反向顺序执行：

```text
?2004l -> ?1004l -> ?1006l -> ?1003l -> ?1002l -> ?1000l
```

- 新增并统一管理：
  - kitty keyboard mode。
  - modifyOtherKeys。
  - SGR mouse tracking。
  - focus events。
  - bracketed paste。
- 新增 `createTerminalInteractionSession()`，让 enable / disable / reassert 在 runtime 边界具备幂等生命周期。
- 新增 `bindTerminalInteractionSignals()`：
  - suspend 前 disable terminal modes。
  - resume 后 enable terminal modes。
  - dispose 时移除 signal listener。
- `packages/tui/src/shell/terminal-interaction-runtime.ts` 只保留 capability/env policy resolution，并 re-export runtime-owned mode API。
- `packages/tui/src/shell/ink-renderer.tsx` 使用 runtime session 管理：
  - render start enable。
  - render error cleanup。
  - unmount cleanup。
  - resize 后 reassert。
  - signal binding dispose。

## 使用方式

本阶段无新增用户命令；它是 TUI terminal runtime 内部能力。

开发者入口：

```ts
import {
  bindTerminalInteractionSignals,
  createTerminalInteractionSession,
  enableTerminalInteractionModes,
  disableTerminalInteractionModes,
  reassertTerminalInteractionModes,
} from "@linghun/ink-runtime";
```

## 涉及模块

- `packages/ink-runtime/src/terminal-modes.ts`
- `packages/ink-runtime/src/index.ts`
- `packages/tui/src/shell/terminal-interaction-runtime.ts`
- `packages/tui/src/shell/terminal-interaction-runtime.test.ts`
- `packages/tui/src/shell/ink-renderer.tsx`
- `RENDERER_RUNTIME_MIGRATION_PLAN.md`

## 关键设计

- Mode sequence ownership 移到 `@linghun/ink-runtime`，TUI 不再直接拼接 mouse/paste/focus escape 序列。
- TUI 仍负责根据 terminal capability / env / alt-screen 判断是否启用 mode；这是策略层，不是 mode implementation。
- Runtime session 负责确保重复 disable 不重复写 restore 序列，reassert 只在 enabled 状态下生效。
- Resize 后做最小 reassert，用于覆盖部分终端 reset 或状态丢失后的恢复路径。
- POSIX suspend/resume 通过 signal binding 做 mode cleanup/restore；Windows 不注册 `SIGTSTP` suspend listener。

## 配置项

沿用既有配置：

```text
LINGHUN_TUI_MOUSE=0
```

用于禁用 app-owned mouse tracking；不新增配置项。

## 命令

无新增 CLI / slash command。

## 测试与验证

已运行：

```text
corepack pnpm exec vitest run packages/tui/src/shell/terminal-interaction-runtime.test.ts
corepack pnpm --filter @linghun/ink-runtime typecheck
corepack pnpm --filter @linghun/tui typecheck
corepack pnpm --filter @linghun/ink-runtime build
corepack pnpm --filter @linghun/tui build
corepack pnpm typecheck
```

结果：全部 PASS；focused test 为 1 个文件、10 个测试通过。

## 性能结果

未新增性能基准。Mode enable/disable/reassert 仅写入固定长度 escape 序列；本阶段无持续循环或高频状态更新。

## 已知问题

- 未运行真实终端手工 suspend/resume / heavy mouse smoke。
- Selection/copy 仍未 renderer-owned，属于 Phase 4。
- Scroll drain / wheel acceleration / render lifecycle 仍属于后续阶段。

## 不在本阶段处理的内容

- 不改视觉样式、布局、主题、footer、panel、composer 外观。
- 不改 provider / model / tool / scheduler / agent / MCP / permission 主链。
- 不接管 selection/copy/scroll 行为。
- 不复制或 vend CCB 源码。

## 下一阶段衔接

Phase 4 应基于当前已启用的 `1002/1003/1006` 与 Phase 2 parser boundary，推进 renderer-owned mouse selection / copy runtime，重点闭合 click-without-copy、drag settle、lost-release recovery 和 copy-on-select 成熟度。

## 开发者排查入口

- Mode runtime：`packages/ink-runtime/src/terminal-modes.ts`
- TUI policy wrapper：`packages/tui/src/shell/terminal-interaction-runtime.ts`
- Renderer lifecycle 接线：`packages/tui/src/shell/ink-renderer.tsx`
- Focused tests：`packages/tui/src/shell/terminal-interaction-runtime.test.ts`
- 阶段根计划：`RENDERER_RUNTIME_MIGRATION_PLAN.md`

## 参考核对

实际读取的 Linghun 文档：

- `RENDERER_RUNTIME_MIGRATION_PLAN.md`
- Phase 2 交付上下文
- `docs/delivery/README.md`

实际参考的行为事实：

- Phase 0/1/2 已记录的 CCB 行为级事实：mouse modes `1000/1002/1003/1006`、focus events、bracketed paste、safe cleanup、suspend/resume restore。

进入 Linghun 自研实现的内容：

- 自研 terminal mode sequence constants。
- 自研 runtime session / signal binding。
- 自研 focused tests。

未复制内容：

- 未复制 CCB 私有源码。
- 未 vend CCB forked Ink。
- 未导入 CCB internal API。

## 成品级结构化 handoff packet

```text
phase: Renderer Runtime Phase 03 — Terminal Mode Runtime
status: PASS / focused-local-validation
next_phase: Renderer Runtime Phase 04 — Renderer-Owned Mouse Selection / Copy Runtime
must_not_do_next:
  - 不改视觉风格作为 Phase 4 的目标
  - 不改 provider/model/tool/scheduler/agent/MCP 主链
  - 不复制 CCB 私有源码
  - 不新增第二套 selection/copy/transcript 数据源
evidence:
  - packages/ink-runtime/src/terminal-modes.ts
  - packages/tui/src/shell/terminal-interaction-runtime.ts
  - packages/tui/src/shell/ink-renderer.tsx
  - packages/tui/src/shell/terminal-interaction-runtime.test.ts
  - RENDERER_RUNTIME_MIGRATION_PLAN.md
validation:
  - terminal interaction runtime tests: PASS, 10 tests
  - @linghun/ink-runtime typecheck: PASS
  - @linghun/tui typecheck: PASS
  - @linghun/ink-runtime build: PASS
  - @linghun/tui build: PASS
  - root typecheck: PASS
index_status: not refreshed in this phase; source files verified directly
permission_mode: local source edits and local validation only
model_provider: Claude Code session model; no product model/provider logic changed
budget_usage: no explicit token budget set
```
