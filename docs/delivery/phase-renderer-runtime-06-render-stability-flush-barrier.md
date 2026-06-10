# Renderer Runtime Phase 06 — Render Stability / Flush Barrier

## 阶段目标

改善 scroll、resize、exit 和高频输入下的渲染稳定性，确保 terminal state 正确恢复和清理。

## 已完成功能

- **Stdout flush barrier**：
  - 新增 `flushStdout()` 确保 stdout 缓冲区 flush
  - 新增 `writeSGRResetAndFlush()` 在 exit 时写入 SGR reset + flush
  - 新增 `drainStdin()` 在 exit 前 drain pending stdin 数据
  - Exit cleanup 集成到 `ink-renderer.tsx` 的 `doUnmount()`
  
- **Terminal state recovery on render error**：
  - 新增 `recoverTerminalState()` 在 render error 时恢复 terminal state
  - 恢复序列包括：show cursor、disable mouse modes、reset SGR、clear line
  - 支持可选的 exit alternate screen
  - 集成到 `renderInkShell()` 的启动 error 和 `rerender()` error handling
  
- **Render throttle infrastructure**：
  - 新增 `useRenderThrottle()` hook（未在本阶段启用，为后续优化预留）
  - Leading + trailing edge throttle，~60fps (16ms) window
  
- **Viewport clamp after resize**：
  - 验证现有 `ScrollViewport` 的 clamp 逻辑正确工作
  - `onResize` handler 中添加注释说明 viewport clamp 自动发生
  - Resize debounce 保持 60ms（已有）

## 使用方式

本阶段没有新增用户可见命令或配置。

开发者入口：

```ts
import { flushStdout, writeSGRResetAndFlush, drainStdin } from "./shell/stdout-flush-barrier.js";
import { recoverTerminalState, createTerminalStateRecoveryHandler } from "./shell/terminal-state-recovery.js";
import { useRenderThrottle } from "./shell/hooks/useRenderThrottle.js";
```

## 涉及模块

代码：

- `packages/tui/src/shell/stdout-flush-barrier.ts`（新增）
- `packages/tui/src/shell/terminal-state-recovery.ts`（新增）
- `packages/tui/src/shell/hooks/useRenderThrottle.ts`（新增，未启用）
- `packages/tui/src/shell/ink-renderer.tsx`（修改，集成 exit cleanup 和 error recovery）

测试：

- `packages/tui/src/shell/stdout-flush-barrier.test.ts`（新增，14 tests）
- `packages/tui/src/shell/terminal-state-recovery.test.ts`（新增，8 tests）

文档：

- `RENDERER_RUNTIME_MIGRATION_PLAN.md`（Phase 6 范围）
- `docs/delivery/phase-renderer-runtime-06-render-stability-flush-barrier.md`（本文档）
- `docs/delivery/README.md`（待更新）

## 关键设计

### Stdout Flush Barrier

**目标**：确保关键操作前 stdout 缓冲区已 flush，避免 terminal state 不一致。

**实现**：

1. **flushStdout()**：
   - 检查 stdout 是否是 TTY、是否 writable、是否有 buffered data
   - 如果有 buffered data，写入空字符串并等待 `drain` 事件
   - 100ms timeout 防止永久阻塞（best-effort）
   - Non-TTY streams（pipes）直接返回

2. **writeSGRResetAndFlush()**：
   - 写入 SGR reset 序列：`\x1b[0m`（reset all attributes）
   - Show cursor：`\x1b[?25h`
   - Disable SGR mouse modes：`\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l`
   - 调用 `flushStdout()` 确保序列到达 terminal

3. **drainStdin()**：
   - Non-blocking read：读取所有 available data，不等待更多输入
   - 防止 stdin 中的 pending 数据泄漏到 shell prompt
   - Best-effort：如果 read 失败，继续 cleanup

**集成点**：

- `ink-renderer.tsx` 的 `doUnmount()` 在 unmount 时调用
- Exit cleanup 顺序：
  1. Unmount Ink instance
  2. Disable terminal interaction session
  3. **Drain stdin**（Phase 6 新增）
  4. **Write SGR reset + flush**（Phase 6 新增）
  5. Show cursor（已有）
  6. Unref stdin

### Terminal State Recovery

**目标**：当 render 出错时恢复 terminal state，避免用户看到损坏的 terminal。

**实现**：

1. **recoverTerminalState()**：
   - 写入一系列 recovery sequences：
     - Show cursor：`\x1b[?25h`
     - Disable mouse modes：`\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l`
     - Disable focus events：`\x1b[?1004l`
     - Disable bracketed paste：`\x1b[?2004l`
     - Reset SGR：`\x1b[0m`
     - Exit alternate screen（可选）：`\x1b[?1049l`
     - Clear line：`\r\x1b[K`
   - 调用 `writeSGRResetAndFlush()` 确保 flush
   - Best-effort：如果任何步骤失败，继续执行剩余步骤
   - 可选 `logError` callback 用于记录恢复失败

2. **createTerminalStateRecoveryHandler()**：
   - Factory function，返回一个可重用的 recovery handler
   - 用于 error boundaries 或 cleanup hooks

**集成点**：

- `renderInkShell()` 启动 error catch 块：
  - 调用 `recoverTerminalState()`（async, non-blocking）
  - Exit alternate screen（如果启用）
  - Re-throw original error
  
- `rerender()` error catch 块：
  - 调用 `recoverTerminalState()`（async, non-blocking）
  - 不 exit alternate screen（mid-session error）
  - Log error 到 stderr
  - 不 throw，让 app 继续运行

### Render Throttle（未启用）

**设计**（为后续优化预留）：

- `useRenderThrottle()` hook：
  - Leading edge：第一次调用立即 render
  - Throttle window：16ms（~60fps）
  - Trailing edge：burst 结束后再 render 一次
  - 适用于高频 scroll/mouse burst 场景

**为何未启用**：

- Phase 5 的 scroll quantization 已减少 ~5-10x state updates
- 大部分 rerender 调用在合理的地方（用户交互后）
- 过度 throttle 可能导致 UI 响应延迟
- 当前架构下，只有 `activityTicker`（1秒/次）可能需要 throttle，但频率已经很低

**后续优化方向**：

- 如果发现高频 rerender 问题，可在特定场景启用（如 scroll ticker）
- 需要 profiling 数据支持决策

### Viewport Clamp After Resize

**现状验证**：

- `ScrollViewport.tsx` 已有完整的 clamp 逻辑：
  - `useEffect` 在 layout 后测量 viewport 和 content 高度
  - 计算 `maxOffset = max(0, contentHeight - viewportHeight)`
  - 调用 `computeScrollViewportOffset()` clamp `scrollOffset` 到 `[0, maxOffset]`
  - 通过 `onMeasure` callback 通知 controller
  
- `ink-renderer.tsx` 的 `onResize` handler：
  - 60ms debounce（已有）
  - Clear screen + reassert terminal modes
  - Rerender → triggers ScrollViewport remeasure → auto clamp
  
- **Phase 6 改动**：只添加注释说明 clamp 自动发生，无需额外代码

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

已运行：

```text
corepack pnpm exec vitest run packages/tui/src/shell/stdout-flush-barrier.test.ts
corepack pnpm exec vitest run packages/tui/src/shell/terminal-state-recovery.test.ts
corepack pnpm --filter @linghun/tui typecheck
```

结果：

- `stdout-flush-barrier.test.ts`: 14 tests PASS
- `terminal-state-recovery.test.ts`: 8 tests PASS
- `@linghun/tui typecheck`: PASS
- Existing tests (wheel-acceleration.test.ts): 18 tests PASS

Focused coverage：

- **flushStdout**：
  - ✅ Returns immediately if stdout is undefined
  - ✅ Returns immediately if stdout is not TTY
  - ✅ Returns immediately if stdout is destroyed
  - ✅ Returns immediately if no buffered data
  - ✅ Waits for drain event when buffer is full
  - ✅ Times out after 100ms if drain never fires
  
- **writeSGRResetAndFlush**：
  - ✅ Returns immediately if stdout is undefined/not TTY
  - ✅ Writes SGR reset sequence and flushes
  - ✅ Does not throw on write error
  
- **drainStdin**：
  - ✅ Returns immediately if stdin is undefined/destroyed
  - ✅ Reads all available data from stdin
  - ✅ Does not throw if read fails
  
- **recoverTerminalState**：
  - ✅ Returns immediately if stdout is undefined/not TTY
  - ✅ Writes recovery sequences without exiting alternate screen
  - ✅ Exits alternate screen when requested
  - ✅ Does not throw on write error
  
- **createTerminalStateRecoveryHandler**：
  - ✅ Returns a function that recovers terminal state
  - ✅ Passes options to recoverTerminalState

## 性能结果

无 benchmark 新增。

理论改进：

- **Exit cleanup latency**: <100ms（flush timeout）
- **Render error recovery**: <100ms（best-effort recovery）
- **Stdin drain**: non-blocking，~0ms（只读取 available data）

## 已知问题

- **Exit cleanup 是 best-effort**：
  - 如果 stdout 已 destroyed/closed，cleanup 无法执行
  - Windows cmd 窗口强制关闭时可能无法 cleanup
  - 这是 terminal 环境限制，无法完全避免
  
- **Render error recovery 是 async non-blocking**：
  - Recovery 在后台执行，不阻塞 error handling
  - 如果 recovery 失败，不影响原始 error 的 propagation
  - 但无法保证 recovery 在下一次操作前完成
  
- **Render throttle 未启用**：
  - 预留的 `useRenderThrottle()` hook 未在本阶段使用
  - 需要 profiling 数据支持是否启用的决策
  
- **未实现 CCB-level render throttle**：
  - CCB 有 scroll drain/render throttle/cursor anchoring/damage backstops
  - Linghun Phase 6 只实现了 flush barrier 和 error recovery
  - Full render stability 需要 Phase 7+ 的 runtime ownership

## 不在本阶段处理的内容

- 不改视觉样式、布局、主题、footer、panel、composer 外观
- 不改 provider / model / tool / scheduler / agent / MCP / permission 主链
- 不新增第二套 transcript 数据源
- 不复制或 vend CCB 源码
- 不实现 CCB-level scroll drain/render throttle（需要 Phase 7+ runtime ownership）
- 不实现 virtual scroll（Phase 7+ 范围）
- 不实现 cursor anchoring / damage backstops（Phase 7+ 范围）
- 不全面启用 render throttle（需要 profiling 数据支持）

## 下一阶段衔接

Phase 7 应处理 TUI migration to new runtime APIs：

- Replace app-layer raw input handling with structured runtime APIs
- Keep compatibility imports working
- Add structured runtime hooks:
  - `useTerminalInput()`
  - `useWheelInput()`
  - `useMouseInput()`
  - `usePasteInput()`
  - `useTerminalResponse()`
- Move Composer to key/paste-only input
- Move MouseInputRouter behavior into runtime or delete it

Phase 6 的 flush barrier 和 error recovery 为 Phase 7 的 runtime migration 提供了稳定的基础。

## 开发者排查入口

- Stdout flush barrier: `packages/tui/src/shell/stdout-flush-barrier.ts`
- Terminal state recovery: `packages/tui/src/shell/terminal-state-recovery.ts`
- Render throttle (未启用): `packages/tui/src/shell/hooks/useRenderThrottle.ts`
- Ink renderer integration: `packages/tui/src/shell/ink-renderer.tsx`
- Exit cleanup: `ink-renderer.tsx` line 99-101 (`doUnmount`)
- Render error recovery: `ink-renderer.tsx` line 62-73 (startup), line 113-124 (rerender)
- Resize handling: `ink-renderer.tsx` line 109-121 (`onResize`)
- 阶段根计划: `RENDERER_RUNTIME_MIGRATION_PLAN.md`

## 参考核对

实际读取的 Linghun 文档：

- `RENDERER_RUNTIME_MIGRATION_PLAN.md` (Phase 6, line 730-756)
- `docs/delivery/phase-renderer-runtime-05-wheel-scroll-runtime.md`
- `packages/tui/src/shell/ink-renderer.tsx`
- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/components/ScrollViewport.tsx`
- `packages/tui/src/shell/models/transcript-scroll-state.ts`
- `packages/tui/src/shell/hooks/useScrollRuntime.ts`
- `packages/tui/src/index.ts`

实际参考的 CCB 行为事实：

Phase 0 Reality Check 已记录：

1. **CCB exit cleanup**：
   - Stdin drain before exit
   - SGR reset + mouse mode disable
   - Cursor restore
   - Flush stdout before cleanup
   
2. **CCB render error recovery**：
   - Catch render errors
   - Restore terminal state
   - Show cursor
   - Disable mouse modes
   - Exit alternate screen if needed
   
3. **CCB render throttle**：
   - Scroll drain + render throttle
   - Cursor anchoring
   - Damage backstops
   - Full-damage backstops for resize

进入 Linghun 自研实现的内容：

- 自研 `flushStdout()` / `writeSGRResetAndFlush()` / `drainStdin()`
- 自研 `recoverTerminalState()` / `createTerminalStateRecoveryHandler()`
- 自研 `useRenderThrottle()` hook（未启用）
- 自研 focused tests（22 tests）
- 集成到现有 `ink-renderer.tsx` 的 cleanup 和 error handling 路径

未复制内容：

- 未复制 CCB 私有源码实现细节
- 未 vend CCB Ink fork
- 未导入 CCB internal API
- 未实现 CCB-level scroll drain / render throttle / cursor anchoring（需要 Phase 7+ runtime ownership）

## 成品级结构化 handoff packet

```text
phase: Renderer Runtime Phase 06 — Render Stability / Flush Barrier
status: PASS / focused-tests-only (no real-terminal smoke yet)
next_phase: Renderer Runtime Phase 07 — TUI Migration To New Runtime APIs
must_not_do_next:
  - 不改视觉风格作为 Phase 7 的目标
  - 不重写 flush barrier / error recovery（Phase 6 已完成）
  - 不重写 wheel/scroll runtime（Phase 5 已完成）
  - 不重写 selection/copy（Phase 4 已完成）
  - 不改 provider/model/tool/scheduler/agent/MCP 主链
  - 不复制 CCB 私有源码
  - 不新增第二套 transcript 数据源
evidence:
  - packages/tui/src/shell/stdout-flush-barrier.ts
  - packages/tui/src/shell/stdout-flush-barrier.test.ts (14 tests PASS)
  - packages/tui/src/shell/terminal-state-recovery.ts
  - packages/tui/src/shell/terminal-state-recovery.test.ts (8 tests PASS)
  - packages/tui/src/shell/hooks/useRenderThrottle.ts (未启用)
  - packages/tui/src/shell/ink-renderer.tsx (集成 exit cleanup + error recovery)
  - RENDERER_RUNTIME_MIGRATION_PLAN.md
  - docs/delivery/phase-renderer-runtime-06-render-stability-flush-barrier.md
validation:
  - stdout-flush-barrier.test.ts: 14 tests PASS
  - terminal-state-recovery.test.ts: 8 tests PASS
  - @linghun/tui typecheck: PASS
  - wheel-acceleration.test.ts: 18 tests PASS (existing, not broken)
real_terminal_smoke:
  - Exit cleanup (drain stdin + SGR reset): NOT RUN (acceptance criteria pending)
  - Render error recovery: NOT RUN (hard to trigger manually)
  - Resize viewport clamp: NOT RUN (existing logic verified by code review)
  - Sustained scrolling flicker: NOT RUN (Phase 5 quantization assumed sufficient)
gaps:
  - Real hardware/terminal smoke testing required before Phase 6 can be marked BETA READY
  - Render throttle未启用，需要 profiling 数据支持是否需要
  - CCB-level render stability features（scroll drain / cursor anchoring / damage backstops）需要 Phase 7+ runtime ownership
  - Exit cleanup 依赖 stdout/stdin 未 destroyed，Windows cmd 窗口强制关闭可能无法 cleanup
known_risks:
  - Exit cleanup 是 best-effort，无法保证在所有场景下成功
  - Render error recovery 是 async non-blocking，无法保证在下一次操作前完成
  - 未全面测试 real-terminal smoke（exit cleanup / render error / resize）
index_status: not refreshed in this phase; source files verified directly
permission_mode: Auto Mode; local source edits and local validation only
model_provider: Claude Code session model; no product model/provider logic changed
budget_usage: no explicit token budget set
```
