# Renderer / Input Runtime Migration — 交付文档

## 目标

将 Linghun TUI 的 renderer/terminal input runtime 从 stock Ink app-layer patching 迁移到 Linghun 自有实现，解决鼠标滚动乱码、拖选复制、selection、flush、退出残留等终端交互问题。

## 为什么 Stock Ink App-Layer Patching 不够

Stock Ink (`useInput`) 的根本问题：

1. **全广播模型**：useInput 把所有 stdin 字节广播给每个活跃 handler，没有事件分类。鼠标序列 `\x1B[<64;10;20M` 也会进入 Composer 的 useInput 回调，导致乱码显示。
2. **无 tokenizer**：Ink 不解析 SGR mouse protocol，split 到多个 chunk 的 escape sequence 会产生碎片（orphan tails `[<64;...M`、`;47;20M`），被误认为键盘输入。
3. **无模式管理**：Ink 不管理 terminal interaction modes（mouse tracking、bracketed paste、focus events、kitty keyboard）。App 必须自行写入 enable/disable 序列，且退出/崩溃时无法保证清理。
4. **无结构化事件**：Ink 回调只提供 raw string + Key object，没有 wheel/mouse/paste/terminal-response 的结构化区分，App 必须在每个 handler 里重复做判断。

Phase 0-8 逐步解决这些问题，建立 Linghun-owned runtime。

## 新的 Runtime 所有权边界

```
packages/ink-runtime/              ← Linghun 自有 runtime boundary
├── terminal-input.ts              ← Tokenizer + parser (SGR/X10/paste/response/key)
├── terminal-modes.ts              ← Enable/disable/reassert terminal modes, session lifecycle
├── terminal-selection.ts          ← Selection state machine (click/drag/copy/multi-click/recovery)
├── useTerminalInput.ts            ← Unified structured input hook (wraps stock Ink useInput)
├── useWheelInput.ts               ← Wheel-only filtered hook
├── useMouseInput.ts               ← Mouse-only filtered hook (excludes wheel)
├── usePasteInput.ts               ← Bracketed paste filtered hook
└── useTerminalResponse.ts         ← Terminal response filtered hook

packages/tui/src/shell/            ← App layer (消费 runtime API)
├── terminal-interaction-runtime.ts ← Re-export + resolveTerminalInteractionModes
├── components/MouseInputRouter.tsx ← 消费 useWheelInput/useMouseInput/useTerminalInput
├── components/Composer.tsx         ← 消费 stock useInput (safety guard for Key object)
├── hooks/useScrollRuntime.ts       ← Pending delta accumulator + quantized dispatch
├── models/wheel-acceleration.ts    ← WheelAccelerator (native/xterm.js adaptive)
├── models/transcript-selection-state.ts ← TUI-level selection adapter (screen buffer)
├── ink-renderer.tsx                ← Session lifecycle + error/exit paths
├── stdout-flush-barrier.ts         ← Flush/drain for exit cleanup
└── terminal-state-recovery.ts      ← Unconditional mode reset on error path
```

**所有权规则**：
- `ink-runtime` 拥有：stdin byte classification、terminal mode lifecycle、structured event dispatch、selection state machine core
- `tui/shell` 拥有：scroll acceleration、screen buffer projection、viewport routing、UI rendering
- Stock Ink 只提供：React rendering engine + raw useInput callback (不再用于 mouse/wheel/paste/response)

## CCB 行为对齐说明

本次迁移参考了 CCB 的以下行为特征（行为级参考，clean-room 实现）：

| CCB 行为 | Linghun 实现 |
|----------|-------------|
| SGR 1006 mouse protocol | terminal-input.ts tokenizer 解析完整 SGR 序列 |
| Orphan tail recovery | tokenizer 将 `[<...M` 补全为完整 SGR event |
| Bracketed paste 内容隔离 | tokenizer 在 paste mode 内不解释 escape |
| Terminal mode session (enable/disable/reassert) | terminal-modes.ts TerminalInteractionSession |
| Suspend/resume cleanup (SIGTSTP/SIGCONT) | bindTerminalInteractionSignals |
| Selection: click-no-copy, drag-copy, double-click-word, triple-click-line | terminal-selection.ts reduceTerminalSelection |
| Lost-release recovery (focus-out, no-button hover, stale timeout) | terminal-selection.ts |
| Wheel acceleration (native bounce detection, xterm.js exponential decay) | wheel-acceleration.ts WheelAccelerator |
| Quantized scroll dispatch (frame drain, pending delta) | useScrollRuntime.ts |
| Exit cleanup: drain stdin, SGR reset, show cursor | stdout-flush-barrier.ts + ink-renderer.tsx doUnmount |

**未复制可疑源码实现。** 所有实现基于公开 terminal protocol 规范 (ECMA-48, xterm control sequences) 和公开行为观察。

## 配置项 / 环境变量

| 环境变量 | 默认值 | 作用 |
|---------|--------|------|
| `LINGHUN_TUI_PLAIN` | unset | `=1` 强制使用 plain mode，不启动 Ink shell |
| `LINGHUN_FULLSCREEN` | unset | `=0` 禁用 alternate screen（保持 main screen） |
| `LINGHUN_TERMINAL_TIER` | auto-detect | `legacy` / `basic` / `modern` 强制 terminal capability |
| `LINGHUN_TUI_MOUSE` | unset | `=0` 禁用 mouse tracking（即使 alt-screen 可用） |
| `LINGHUN_TUI_MOUSE_SELECTION` | unset | `=0` 禁用 app-owned selection（wheel 仍可用） |
| `LINGHUN_SCROLL_SPEED` | `1` | 滚轮基础 step（整数，影响 WheelAccelerator base） |
| `NO_COLOR` / `FORCE_COLOR` | unset | 标准 color disable/force |

## 自动化测试结果

```
632 tests pass (20 test files)
packages/ink-runtime/src/ + packages/tui/src/shell/
Duration: ~6s
```

### 测试文件清单

| 文件 | 测试数 | 覆盖范围 |
|------|--------|---------|
| terminal-input.test.ts | 12 | Tokenizer: SGR/X10/paste/response/orphan/fragment/split |
| useTerminalInput.test.ts | 21 | Hook filtering: wheel/mouse/paste/response/unified/Composer guard |
| terminal-selection.test.ts | 8 | Selection core: click/drag/copy/whitespace/focus-out/hover recovery |
| terminal-interaction-runtime.test.ts | 10 | Mode lifecycle: enable/disable/reassert/suspend/resume/env knobs |
| transcript-selection-state.test.ts | 15 | Screen buffer, CJK, soft-wrap, noSelect, double/triple-click, stale |
| wheel-acceleration.test.ts | 14 | Native ramp/bounce/wheel-mode, xterm.js decay, reset |
| ink-interaction-smoke.test.ts | 14 | Full TTY render: key routing, scroll, permission, selection gating |
| stdout-flush-barrier.test.ts | 14 | Flush, drain, SGR reset, error resilience |
| view-model.test.ts | 344 | View model: all render paths, terminal capability, selection state |
| Others (help-panel, permission, composer-dispatch, etc.) | 180 | Shell model layer |

### 19 Required Coverage 全覆盖

详见 `RENDERER_RUNTIME_MIGRATION_PLAN.md` Phase 8 Closure 的逐条审计表。

## 手动测试 (待用户执行)

Phase 8 closure 中列出了 4 terminal profile × 10 scenario 的完整清单。需用户在以下环境手动验证：

- Windows Terminal + PowerShell
- Windows Terminal + cmd
- Git Bash (mintty)
- VS Code integrated terminal

关键验证点：滚轮不乱码、拖选正确复制、退出干净无残留。

## 已知限制

1. **Composer 仍使用 stock useInput**：Composer 依赖 Ink 的 Key object（ctrl/meta/shift/arrows），无法完全迁移到结构化 hooks。保留为 safety guard，classifyTerminalInput 在前端过滤非 keyboard 事件。
2. **Scroll runtime 无 virtual scroll**：当前使用 offset-based scroll + SCROLL_QUANTUM=10 量化。超大 transcript（>1000 行）可能感觉到滚动粒度。CCB 有 virtual scroll，暂不实现。
3. **WheelAccelerator 和 selection state machine 在 TUI 层**：这两个模块逻辑上可以下沉到 ink-runtime，但当前无紧迫理由。标记为后续 cleanup candidate。
4. **X10 mouse 兼容有限**：仅解析基本 X10 press/wheel，不支持 X10 drag（X10 协议本身不支持 drag reporting）。
5. **main-screen 不启用 mouse tracking**：在非 alternate-screen 模式下，mouse tracking 默认关闭以避免干扰终端原生选择。
6. **Windows cmd conhost**：不支持 cursor positioning 的 legacy conhost 会 fallback 到 plain mode。

## 不在本迁移处理

- Agent / provider / model 调用
- Tool 执行 / 权限系统
- Scheduler / workflow / MCP
- 会话存储 / CLI 主命令语义
- Visual redesign（明确 Visual Stability Rule）
- Virtual scroll（后续优化 candidate）
- Terminal multiplexer integration（tmux/screen 特殊处理）

## 迁移 Commit 历史

```
7e875236 feat: renderer runtime boundary and terminal tokenizer (Phase 1-2)
13047e07 feat: terminal mode runtime ownership (Phase 3)
beffe224 feat: renderer runtime Phase 04 selection/copy + targeted review fix
fa9f20f5 feat: renderer runtime Phase 05 wheel/scroll runtime
6d5fdb13 feat: renderer runtime Phase 06 render stability and flush barrier
f2824945 feat: renderer runtime Phase 7+8 — structured input hooks and test matrix
```

## 开发者排查入口

| 问题 | 排查入口 |
|------|---------|
| 鼠标乱码进入 Composer | 检查 `classifyTerminalInput` 返回值；确认 Composer 的 `useInput` guard |
| 滚轮无响应 | `LINGHUN_TUI_MOUSE`、`LINGHUN_FULLSCREEN` 是否设为 0；capability.mouseTracking |
| 拖选不复制 | `LINGHUN_TUI_MOUSE_SELECTION`；transcript-selection-state reducer |
| 退出后终端状态异常 | `terminal-state-recovery.ts`；检查 stdout-flush-barrier 是否 timeout |
| SGR 序列碎片 | terminal-input tokenizer 的 buffer/flush 逻辑；是否存在 split chunk |
| 滚动卡顿 | `LINGHUN_SCROLL_SPEED`；WheelAccelerator terminalType 检测 |

## 阶段 Verdict

- verdict：**PASS**
- 是否允许进入下一阶段：yes（本迁移已完整闭环）
- P0 风险：无
- P1 风险：手动测试尚未执行（阻塞生产发布，不阻塞开发）
- 阻塞项：无
- 用户下一步：在 4 个 terminal profile 中执行手动测试清单

## 真实改动文件

- 代码（ink-runtime）：`index.ts`, `useTerminalInput.ts`, `useWheelInput.ts`, `useMouseInput.ts`, `usePasteInput.ts`, `useTerminalResponse.ts`
- 代码（tui/shell）：`MouseInputRouter.tsx`, `Composer.tsx`, `ink-renderer.tsx`, `stdout-flush-barrier.ts`
- 测试：`useTerminalInput.test.ts`, `ink-interaction-smoke.test.ts`, `stdout-flush-barrier.test.ts`, `view-model.test.ts`
- 文档：`RENDERER_RUNTIME_MIGRATION_PLAN.md` (Phase 5-8 closure)

## 交接摘要

**Handoff Packet:**

- 下一阶段：本迁移计划已全部完成（Phase 0-9）。后续工作为手动测试 + 可选 cleanup（scroll virtual化、selection/wheel 下沉到 runtime）。
- 禁止事项：不要回退 MouseInputRouter 到 raw useInput 路径；不要在 writeSGRResetAndFlush 中重新写入 mouse disable 序列（已由 session.disable() 负责）。
- 验证结果：632 tests pass，无回归。
- 索引状态：未变更。
- 权限模式：无变更。
- 模型/provider：无变更。
- 预算使用：纯本地开发，无 API 调用。
