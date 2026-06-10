# Linghun Renderer/Input Runtime Migration Plan

> 目标：把 Linghun TUI 的 renderer / terminal input runtime 收归 Linghun 自有实现，逐步对齐 CCB 成熟度，解决鼠标滚动乱码、拖选复制、selection、flush、退出残留等终端交互问题。

## Scope

本计划只覆盖：

```text
TUI 显示层
stdin parser/tokenizer
stdout renderer/flush
terminal modes
mouse / wheel / paste / terminal response
selection / copy-on-select
scroll runtime
```

不覆盖：

```text
agent / provider / model 调用
tool 执行 / 权限系统
scheduler / workflow / MCP
会话存储 / CLI 主命令语义
```

## Visual Stability Rule

Phases 1-9 are terminal runtime maturity work, **not visual redesign**. Keep existing Linghun product styling, layout, theme, block rendering, composer appearance, footer structure, notification stack, permission panel, progress tree, and help/status/doctor panel style unchanged unless a specific visual implementation detail is required for selection, scroll, cursor, or render correctness.

Allowed changes are behavior/stability changes only:

```text
no mouse escape garbage
mature drag selection
less accidental copy
more stable fast scrolling
clean terminal exit
more reliable selection highlight
```

If renderer-owned selection overlay or cursor parking introduces unavoidable minor visual differences, document them as runtime-correctness effects, not a new visual direction.

## High-Level Direction

当前问题不再继续作为 app-layer patch 处理，而是迁移到 Linghun-owned renderer/input runtime：

```text
terminal bytes
  -> tokenizer/parser
  -> structured input events
  -> renderer/runtime handles scroll, selection, copy, modes, flush
  -> app layer consumes stable events only
```

推荐新增内部包：

```text
packages/ink-runtime
```

或：

```text
packages/linghun-ink
```

第一阶段保持 Ink-compatible API，降低迁移面：

```ts
Box
Text
render
useInput
useStdin
useStdout
```

后续逐步新增结构化输入 API：

```ts
useTerminalInput()
useWheelInput()
useMouseInput()
usePasteInput()
useTerminalResponse()
```

---

# Phase 0 — Reality Check / Baseline Audit

## Goal

先建立事实清单，不直接大改代码。明确 Linghun 当前补丁、CCB 参考行为、必须替换的入口、不能复制的私有实现边界。

## Files to inspect

Linghun 侧：

```text
packages/tui/src/shell/terminal-interaction-runtime.ts
packages/tui/src/shell/models/terminal-input-runtime.ts
packages/tui/src/shell/components/MouseInputRouter.tsx
packages/tui/src/shell/components/Composer.tsx
packages/tui/src/shell/models/transcript-selection-state.ts
packages/tui/src/shell/models/wheel-acceleration.ts
packages/tui/src/shell/hooks/useScrollBatcher.ts
packages/tui/src/shell/ink-renderer.tsx
packages/tui/src/index.ts
```

CCB reference：

```text
F:\ccb-source\node_modules\@anthropic\ink\src\core\termio\*
F:\ccb-source\node_modules\@anthropic\ink\src\core\parse-keypress.ts
F:\ccb-source\node_modules\@anthropic\ink\src\core\events\input-event.ts
F:\ccb-source\node_modules\@anthropic\ink\src\components\App.tsx
F:\ccb-source\node_modules\@anthropic\ink\src\core\selection.ts
F:\ccb-source\node_modules\@anthropic\ink\src\core\ink.tsx
F:\ccb-source\src\components\ScrollKeybindingHandler.tsx
F:\ccb-source\src\hooks\useCopyOnSelect.ts
F:\ccb-source\src\utils\fullscreen.ts
```

## Tasks

- [ ] Map current Linghun input path from stdin bytes to Composer/useInput.
- [ ] Map current Linghun mouse/wheel/selection/copy path.
- [ ] Identify duplicate or conflicting systems already present.
- [ ] Identify exact places stock Ink currently controls parser/render/modes.
- [ ] Produce clean-room behavior notes from CCB reference without copying source.
- [ ] Define minimum compatibility API required by existing TUI code.

## Acceptance Criteria

- [ ] We know every app-layer mouse/wheel/parser patch that should eventually be deleted or downgraded to safety guard.
- [ ] We know the smallest runtime API needed to boot the existing Linghun TUI.
- [ ] We have a checklist of behavior gaps before implementation starts.

## Handoff Notes

If a new conversation starts here, ask it to inspect the files above and produce a short implementation map before coding.

## Phase 0 Closure — 2026-06-10

### Verdict

`PASS / audit-only`：Phase 0 已完成源码级 reality check。未改运行时代码；只更新本计划文档。结论是：当前问题不应继续用 app-layer patch 根治，后续应进入 Phase 1 建立 Linghun-owned runtime ownership boundary。

### Existing Linghun Implementation

Current input path:

```text
stdin bytes
  -> stock Ink 7.0.3 input-parser / parse-keypress / useInput
  -> Composer.useInput / MouseInputRouter.useInput
  -> Linghun app-layer classifier / reducer / controller
  -> Ink render(stdout)
```

Key facts:

- `packages/tui/src/shell/ink-renderer.tsx` imports `render` directly from stock `ink` and enables terminal modes before rendering.
- `packages/tui/src/shell/terminal-interaction-runtime.ts` only enables `?1000h + ?1006h`; it does not enable `?1002h` drag tracking or `?1003h` any-motion.
- `packages/tui/src/shell/models/terminal-input-runtime.ts` classifies complete SGR mouse sequences and full orphan tails, but not all partial fragments.
- `packages/tui/src/shell/components/Composer.tsx` blocks non-keyboard input after stock Ink has already parsed/flushed it.
- `packages/tui/src/shell/components/MouseInputRouter.tsx` parses raw/stripped SGR strings in app space and dispatches `transcript-scroll` / `transcript-mouse`.
- `packages/tui/src/shell/hooks/useScrollBatcher.ts` only microtask-batches deltas; it is not a renderer-level drain/throttle.
- `packages/tui/src/shell/models/wheel-acceleration.ts` is a simplified timestamp-window accelerator, not CCB-level wheel runtime.
- `packages/tui/src/shell/models/transcript-selection-state.ts` owns transcript selection in app state, including screen-buffer reconstruction, double/triple click, autoscroll delta, and copy-on-release.
- `packages/tui/src/index.ts` handles `transcript-scroll`, `transcript-mouse`, `copy-selection`, clipboard writes, and rerenders in the main controller.

### CCB Reference Behavior Notes

Behavior-level reference only; do not copy private/source implementation.

CCB maturity in this chain includes:

- Renderer-owned tokenizer/parser under its Ink fork, not stock `useInput` string guessing.
- Structured parsed input kinds: key, mouse click/drag/release, wheel key, terminal response, paste.
- SGR mouse parsing before text input; wheel bit `0x40` becomes `wheelup` / `wheeldown` and does not enter text input.
- Mouse modes include `1000 + 1002 + 1003 + 1006`, giving press/release, button-motion drag, any-motion hover/lost-release signal, and SGR encoding.
- Incomplete escape flush uses a longer timeout and checks `stdin.readableLength` before flushing buffered ESC as Escape.
- Orphan SGR/X10 tails are re-synthesized or suppressed at input-event layer.
- Selection is renderer/screen-buffer-owned: click does not set focus until real drag, so bare click cannot copy one cell.
- Copy-on-select is settled-selection based, configurable, skips empty/whitespace-only selection, and avoids repeated copies.
- Lost release recovery uses focus-out, no-button motion, and fresh press while dragging.
- Drag-to-scroll is timer-based with max tick guard and captured scrolled-off rows.
- Wheel scroll uses keybinding path, pending delta drain, trackpad/mouse heuristics, physical wheel bounce handling, xterm.js-specific curve, and optional speed env.
- Render path has selection overlay, full-damage backstops, cursor anchoring, synchronized update/flush behavior, pending scroll drain frames, and stdin drain on exit.

### Gaps

Blocking gaps before claiming CCB-level maturity:

1. **Runtime ownership gap** — Linghun still consumes already-processed stock Ink `useInput` strings. Terminal bytes are not first classified by Linghun-owned runtime.
2. **Mouse mode gap** — Linghun lacks `1002` and `1003`; drag/no-button motion/lost-release signals are incomplete.
3. **Fragment gap** — Partial SGR/X10 fragments can still be outside the complete-sequence classifier boundary if stock Ink flushes mid-sequence.
4. **Wheel runtime gap** — simplified accelerator + microtask batch is not equivalent to CCB scroll keybinding/drain/bounce/xterm path.
5. **Selection ownership gap** — selection/copy live in app/controller state, not renderer/screen-buffer state; app reconstructs rows from blocks.
6. **Copy threshold gap** — Linghun copy-on-release is improved but not CCB-equivalent; renderer-level click-without-focus invariant is missing.
7. **Render stability gap** — Linghun has `waitUntilRenderFlush` but lacks CCB-level scroll drain/render throttle/cursor anchoring/damage backstops.
8. **Terminal lifecycle gap** — cleanup exists on normal unmount/error path, but not full CCB-level suspend/resume/stdin long-gap/reassert/drain behavior.
9. **Compatibility boundary gap** — no internal runtime package currently isolates stock Ink imports for incremental replacement.

### Minimal Touch Points For Phase 1

Phase 1 should create ownership boundary first, not yet rewrite all behavior.

Minimum files likely involved:

```text
package.json
pnpm-workspace.yaml or equivalent workspace config
packages/ink-runtime/package.json
packages/ink-runtime/src/index.ts
packages/tui/src/shell/ink-renderer.tsx
packages/tui/src/shell/components/*.tsx import boundary as needed
```

Minimum compatibility API to boot existing TUI:

```ts
Box
Text
render
useInput
useStdin
useStdout
```

Likely additional APIs needed soon after boot compatibility:

```ts
usePaste
useSelection or equivalent selection bridge
Key shape compatibility with current Composer
render instance shape: rerender / clear / unmount / waitUntilExit / waitUntilRenderFlush
```

### Forbidden Duplicate Systems

Do not create these as parallel long-term systems:

- A second scheduler, provider loop, agent/job runtime, permission pipeline, or model gateway.
- A second transcript data source separate from current ShellViewModel / ProductBlock pipeline.
- A second clipboard backend while existing `packages/tui/src/shell/clipboard.ts` can be reused.
- A second uncoordinated terminal-mode toggler outside renderer/runtime ownership.
- A second app-layer raw SGR mouse parser as the primary path after structured input is available.
- A second scroll state model if existing transcript scroll state can be adapted behind the runtime API.

### Clean-Room Implementation Boundary

Allowed:

- Use CCB behavior and terminal protocol facts as reference.
- Reimplement tokenizer/parser/modes/selection/scroll behavior in Linghun-owned code.
- Write tests that assert protocol behavior and user-visible outcomes.

Not allowed:

- Copy CCB private/source implementation verbatim.
- Vendor CCB `node_modules/@anthropic/ink` into Linghun.
- Import undocumented CCB internal APIs.
- Declare full CCB maturity from app-layer guards alone.

### Phase 1 Readiness Checklist

- [x] Current Linghun input path mapped.
- [x] Current Linghun mouse/wheel/selection/copy path mapped.
- [x] Duplicate/conflicting systems identified.
- [x] Stock Ink control points identified.
- [x] CCB behavior notes captured at behavior level.
- [x] Minimum compatibility API defined.

Next phase should start with: create the runtime package boundary and make the existing TUI compile/boot through that boundary without changing product behavior yet.

---

# Phase 1 — Create Linghun-Owned Runtime Package

## Goal

Create a runtime package that can gradually replace direct stock Ink runtime usage while preserving the React/Ink component model.

## Candidate package names

Preferred:

```text
packages/ink-runtime
```

Alternative:

```text
packages/linghun-ink
```

## Tasks

- [x] Add internal package scaffold.
- [x] Export Ink-compatible primitives used by Linghun TUI.
- [x] Wire package build/test configuration.
- [x] Add alias/import strategy so migration can be incremental.
- [x] Keep existing TUI boot path working with minimal behavior change.

## Initial API Surface

```ts
export { Box, Text };
export { render };
export { useInput, useStdin, useStdout };
```

## Acceptance Criteria

- [x] Existing TUI compiles against the new runtime alias or package.
- [x] No business logic changes are required in agent/tool/scheduler/provider code.
- [x] Stock Ink direct imports are isolated and visible for later removal.

## Handoff Notes

Do not attempt parser/selection/wheel behavior in this phase unless required for bootstrapping. The goal is ownership boundary first.

## Phase 1 Closure — 2026-06-10

Status: PASS / boundary-only.

Implemented:

- Added `packages/ink-runtime` as Linghun-owned runtime package boundary.
- `@linghun/ink-runtime` currently re-exports public stock Ink API only; no private Ink build paths are imported.
- Updated TUI shell/component imports to consume `@linghun/ink-runtime` instead of direct `ink` imports.
- Added workspace dependency and TypeScript project references for the new runtime package.
- Refreshed `pnpm-lock.yaml` after adding the workspace package.

Scope kept unchanged:

- No visual redesign.
- No parser, mouse-mode, selection, copy, scroll, scheduler, provider, tool, agent, or model-call behavior changes.
- No CCB source copied or vendored; CCB remains behavior/protocol reference only.

Validation:

```text
corepack pnpm install --lockfile-only        PASS
corepack pnpm install                        PASS
corepack pnpm --filter @linghun/ink-runtime typecheck  PASS
corepack pnpm --filter @linghun/ink-runtime build      PASS
corepack pnpm --filter @linghun/tui typecheck          PASS
corepack pnpm --filter @linghun/tui build              PASS
corepack pnpm typecheck                     PASS
```

Notes:

- The first `pnpm install --lockfile-only` attempt failed because `pnpm` was not on PATH; the project-supported `corepack pnpm` entry was used successfully.
- `@linghun/tui typecheck` requires the new runtime package declarations to exist; building `@linghun/ink-runtime` first generated `dist/index.d.ts` and resolved the workspace type boundary.
- Phase 2 may now replace the internal implementation behind `@linghun/ink-runtime` without touching product UI styling.

---

# Phase 2 — Terminal Tokenizer / Parser

## Goal

Implement a Linghun-owned terminal input tokenizer/parser that converts raw stdin bytes into structured events before they reach Composer or app code.

## Event Model

```ts
type ParsedTerminalInput =
  | { kind: 'key'; key: TerminalKey; input: string }
  | { kind: 'wheel'; direction: 'up' | 'down'; raw: string }
  | { kind: 'mouse'; action: 'press' | 'drag' | 'release' | 'hover'; button: number; x: number; y: number; raw: string }
  | { kind: 'paste'; text: string }
  | { kind: 'terminal-response'; response: TerminalResponse; raw: string };
```

## Must Support

- [x] CSI sequences.
- [x] OSC sequences.
- [x] DCS sequences.
- [x] SS3 sequences.
- [x] Bracketed paste.
- [x] SGR mouse.
- [x] X10 mouse fallback.
- [x] Terminal responses.
- [x] Incomplete escape buffering.
- [x] Orphan mouse tails.
- [x] Partial mouse fragments.

## Critical Rules

SGR wheel:

```text
\x1b[<64;x;yM -> wheel up
\x1b[<65;x;yM -> wheel down
```

SGR mouse:

```text
\x1b[<0;x;yM  -> press
\x1b[<32;x;yM -> drag
\x1b[<0;x;ym  -> release
```

Mouse fragments must never enter Composer:

```text
[<
[<64
[<64;
[<64;47
[<64;47;
[<64;47;20
[<64;47;20M
;47;20M
64;47;20M
```

## Tests

Add parser/tokenizer tests covering:

- [x] Complete SGR wheel.
- [x] Complete SGR press/drag/release.
- [x] Split SGR sequence across chunks.
- [x] Orphan mouse tail.
- [x] X10 mouse/wheel fallback.
- [x] Paste containing escape-looking bytes.
- [x] Terminal responses not reaching Composer.
- [x] Unknown escape handling.

## Acceptance Criteria

- [x] Fast wheel never inserts `<64`, `[<64;...M`, or `;x;yM` into the prompt.
- [x] Mouse/wheel/paste/terminal-response are separate event kinds.
- [x] Ordinary keyboard input behavior is preserved.

## Handoff Notes

This is the core乱码 fix. Do not route raw SGR strings through React app components as the primary path.

## Phase 2 Closure — 2026-06-10

Status: PASS / parser boundary closed.

Implemented:

- Added Linghun-owned terminal tokenizer/parser in `packages/ink-runtime/src/terminal-input.ts`.
- Exported parser API from `@linghun/ink-runtime`.
- Parsed event kinds now include keyboard, SGR/X10 mouse, wheel, bracketed paste, terminal response, mouse fragment, and unknown escape.
- Added chunk buffering through `TerminalInputTokenizer.feed()` / `flush()` so split SGR sequences do not leak partial text.
- Added orphan SGR tail handling for `[<btn;x;yM` and fragment classification for known mouse tails such as `;x;yM` / `btn;x;yM`.
- Connected `packages/tui/src/shell/models/terminal-input-runtime.ts` to the runtime parser so Composer’s existing input guard blocks mouse/paste/terminal-response/unknown escape before text insertion.
- Added Vitest alias for `@linghun/ink-runtime` source tests.

Scope kept unchanged:

- No visual redesign.
- No terminal mode change yet; `1002` / `1003` belongs to Phase 3.
- No renderer-owned selection/copy/scroll behavior yet; those remain later phases.
- No scheduler, provider, tool, agent, model-call, MCP, or permission behavior changes.
- No CCB source copied or vendored.

Validation:

```text
corepack pnpm exec vitest run packages/ink-runtime/src/terminal-input.test.ts packages/tui/src/shell/models/terminal-input-runtime.test.ts  PASS, 27 tests
corepack pnpm --filter @linghun/ink-runtime typecheck  PASS
corepack pnpm --filter @linghun/tui typecheck          PASS
corepack pnpm --filter @linghun/ink-runtime build      PASS
corepack pnpm --filter @linghun/tui build              PASS
corepack pnpm typecheck                                PASS
```

Known limits:

- This phase prevents known terminal protocol bytes/fragments from being classified as Composer text; it does not yet replace stock Ink’s low-level stdin parser.
- Full CCB parity still requires Phase 3+ terminal modes, renderer event routing, selection ownership, scroll drain, and render lifecycle work.

Next phase should start with terminal mode ownership: enable/disable `1000 + 1002 + 1003 + 1006` behind runtime capability checks and cleanup guarantees.

---

# Phase 3 — Terminal Mode Runtime

## Goal

Centralize terminal mode enable/disable/reassert/cleanup in the renderer runtime.

## Modes

Enable when entering interactive TUI / alt-screen:

```text
?1000h  normal mouse
?1002h  button-motion
?1003h  any-motion
?1006h  SGR mouse
?1004h  focus events
?2004h  bracketed paste
```

Disable on exit in safe reverse order:

```text
?2004l
?1004l
?1006l
?1003l
?1002l
?1000l
```

## Tasks

- [x] Move terminal mode ownership into runtime package.
- [x] Ensure cleanup on normal exit.
- [x] Ensure cleanup on render error.
- [x] Ensure cleanup on suspend.
- [x] Ensure restore on resume.
- [x] Reassert modes after stdin long gap or terminal reset signal if needed.
- [x] Restore cursor/raw-mode state.

## Acceptance Criteria

- [x] Exiting Linghun never leaves shell in mouse reporting mode.
- [x] Ctrl+C/error path restores terminal modes.
- [x] Suspend/resume does not break mouse/paste handling.
- [x] App code no longer independently toggles conflicting mouse modes.

## Handoff Notes

Mode changes have high blast radius. Keep tests and manual validation close to this phase.

## Phase 3 Closure — 2026-06-10

Status: PASS / terminal mode runtime closed.

Implemented:

- Moved terminal mode enable/disable/reassert/write helpers into `packages/ink-runtime/src/terminal-modes.ts`.
- `@linghun/ink-runtime` now owns mode sequences for kitty keyboard, modifyOtherKeys, SGR mouse, focus events, and bracketed paste.
- SGR mouse enable now uses `1000 + 1002 + 1003 + 1006`.
- Disable order is safe reverse order: `2004`, `1004`, `1006`, `1003`, `1002`, `1000`, then keyboard protocols.
- Added `createTerminalInteractionSession()` to make enable/disable/reassert idempotent at runtime boundary.
- Added `bindTerminalInteractionSignals()` for suspend/resume lifecycle: suspend disables modes before `SIGTSTP`, resume restores modes, dispose removes signal listeners.
- `packages/tui/src/shell/terminal-interaction-runtime.ts` now only resolves capability/env policy and re-exports runtime-owned terminal mode operations.
- `packages/tui/src/shell/ink-renderer.tsx` uses the runtime session for render start, render-error cleanup, unmount cleanup, resize reassert, and signal binding disposal.

Scope kept unchanged:

- No visual redesign.
- No renderer-owned selection/copy/scroll behavior yet.
- No provider/model/tool/scheduler/agent/MCP/permission behavior changes.
- No CCB source copied or vendored.

Validation:

```text
corepack pnpm exec vitest run packages/tui/src/shell/terminal-interaction-runtime.test.ts  PASS, 10 tests
corepack pnpm --filter @linghun/ink-runtime typecheck  PASS
corepack pnpm --filter @linghun/tui typecheck          PASS
corepack pnpm --filter @linghun/ink-runtime build      PASS
corepack pnpm --filter @linghun/tui build              PASS
corepack pnpm typecheck                                PASS
```

Known limits:

- Manual real-terminal suspend/resume and heavy-mouse smoke have not been run in this phase.
- Selection/copy maturity remains app-owned and belongs to Phase 4.
- Scroll drain/wheel acceleration/render lifecycle maturity remains Phase 5+.

Next phase should start with renderer-owned mouse selection/copy runtime, using the now-available `1002/1003/1006` mode coverage and parser boundary.

---

# Phase 4 — Renderer-Owned Mouse Selection / Copy Runtime

## Goal

Move selection and copy-on-select behavior into the renderer/input runtime instead of reconstructing mouse sequences at app layer.

## Required Behavior

- [ ] Press starts possible selection.
- [ ] Drag extends selection.
- [ ] Release settles selection.
- [ ] Double-click selects word.
- [ ] Triple-click selects line.
- [ ] Drag-to-scroll when dragging outside viewport.
- [ ] Focus-out lost-release recovery.
- [ ] No-button-motion lost-release recovery.
- [ ] Fresh-press lost-release recovery.
- [ ] Hover does not pollute selection.
- [ ] Disable mouse clicks while preserving wheel support.

## Copy Rules

- [ ] Copy-on-select is configurable.
- [ ] Click without drag does not copy.
- [ ] Empty selection does not copy.
- [ ] Whitespace-only selection does not copy.
- [ ] Settled selection copies once.
- [ ] Drag release copies.
- [ ] Double/triple click selection may copy.

## App-Layer Cleanup Candidates

Eventually delete or demote to safety guard:

```text
MouseInputRouter raw SGR parsing
Composer mouse fragment interception
transcript selection fallback paths that duplicate renderer ownership
```

## Acceptance Criteria

- [ ] Real drag selection copies expected text.
- [ ] Single click does not copy.
- [ ] Mis-click does not copy prompt/transcript text.
- [ ] Lost release does not leave selection stuck.

## Handoff Notes

Do not remove existing app-layer guards until renderer-owned path is tested in real terminals.

---

# Phase 5 — Wheel / Scroll Runtime

## Goal

Treat wheel as a first-class structured input event and route it through a stable scroll runtime with batching/throttling.

## Target Path

```text
SGR wheel
  -> ParsedTerminalInput.kind = 'wheel'
  -> scroll runtime / ScrollBox
  -> batched delta accumulator
  -> render throttle / drain
```

## Tasks

- [ ] Add wheel event subscription API.
- [ ] Implement pending scroll delta accumulator.
- [ ] Implement frame/timer drain.
- [ ] Preserve existing wheel acceleration behavior where useful.
- [ ] Detect physical wheel encoder bounce.
- [ ] Detect trackpad bursts.
- [ ] Handle direction flip debounce.
- [ ] Support terminal-specific curves for Windows Terminal / VS Code / xterm.js if needed.
- [ ] Add `LINGHUN_SCROLL_SPEED` or keep existing equivalent config.
- [ ] Ensure high-frequency wheel does not produce state-update explosion.

## Acceptance Criteria

- [ ] 60-second fast wheel test produces no prompt garbage.
- [ ] Scrolling remains responsive without visible severe flicker.
- [ ] Trackpad and physical wheel both feel usable.
- [ ] Direction flips do not produce runaway scroll.

## Handoff Notes

This phase should be tested with real hardware/terminal combinations, not only unit tests.

---

# Phase 6 — Render Stability / Flush Barrier

## Goal

Improve rendering stability under scroll, resize, exit, and high-frequency input.

## Tasks

- [ ] Add render throttling where scroll/mouse bursts cause excessive redraw.
- [ ] Add stdout flush barrier around critical mode changes and exit.
- [ ] Clamp viewport after resize/measure.
- [ ] Avoid full transcript redraw per wheel tick where possible.
- [ ] Recover terminal state on render error.
- [ ] Drain or discard pending stdin fragments before exit.
- [ ] Ensure exit does not leave SGR mouse bytes in shell.

## Acceptance Criteria

- [ ] No obvious full-screen flicker during sustained scrolling.
- [ ] Resize does not corrupt viewport or selection state.
- [ ] Exit returns to a clean shell prompt.
- [ ] Render errors do not leave terminal state broken.

## Handoff Notes

This phase may expose deeper transcript virtualization issues. Do not mix broad UI refactors into this phase unless required.

---

# Phase 7 — TUI Migration To New Runtime APIs

## Goal

Replace app-layer raw input handling with structured runtime APIs while keeping business behavior unchanged.

## Migration Steps

1. Keep compatibility imports working.
2. Add structured runtime hooks:

```ts
useTerminalInput()
useWheelInput()
useMouseInput()
usePasteInput()
useTerminalResponse()
```

3. Move Composer to key/paste-only input.
4. Move MouseInputRouter behavior into runtime or delete it.
5. Move scroll handling to wheel runtime.
6. Keep final safety guards only where justified.

## Cleanup Candidates

- [ ] Raw SGR parsing in app components.
- [ ] Composer mouse fragment cleanup as primary defense.
- [ ] Duplicate terminal mode toggles.
- [ ] Duplicate wheel acceleration paths.
- [ ] Duplicate selection/copy state machines.

## Acceptance Criteria

- [ ] TUI behavior matches or improves current behavior.
- [ ] Composer never receives mouse/wheel/terminal-response events as text.
- [ ] Runtime, not app components, owns terminal input classification.
- [ ] No core agent/tool/provider code touched for UI runtime migration.

## Handoff Notes

Keep commits/changes reviewable by subsystem. If a migration step becomes too large, stop after compatibility layer + one event class.

---

# Phase 8 — Automated and Manual Test Matrix

## Automated Tests

Add or update:

```text
terminal-tokenizer.test.ts
terminal-input-parser.test.ts
terminal-mode-runtime.test.ts
selection-runtime.test.ts
wheel-runtime.test.ts
render-stability-smoke.test.ts
ink-interaction-smoke.test.ts
```

## Required Coverage

- [ ] Complete SGR mouse.
- [ ] Orphan SGR tail.
- [ ] Partial SGR fragments.
- [ ] X10 wheel.
- [ ] Paste containing escape sequences.
- [ ] Terminal response not entering Composer.
- [ ] Wheel not entering Composer.
- [ ] Click does not copy.
- [ ] Drag copies.
- [ ] Whitespace-only does not copy.
- [ ] Double-click word.
- [ ] Triple-click line.
- [ ] Lost release recovery.
- [ ] Focus-out recovery.
- [ ] No-button motion recovery.
- [ ] Disable mouse tracking.
- [ ] Disable mouse clicks but keep wheel.
- [ ] Exit cleanup.
- [ ] Suspend/resume cleanup.

## Manual Test Matrix

Run at least:

```text
Windows Terminal + PowerShell
Windows Terminal + cmd
Git Bash
VS Code integrated terminal
```

Manual scenarios:

- [ ] Fast physical wheel for 60 seconds.
- [ ] Slow trackpad scroll.
- [ ] Rapid direction flips.
- [ ] Drag selection inside viewport.
- [ ] Drag selection outside viewport.
- [ ] Release outside terminal window.
- [ ] Double-click word selection.
- [ ] Triple-click line selection.
- [ ] Exit after heavy mouse use.
- [ ] Ctrl+C/error exit path.

## Global Acceptance Criteria

Must not appear in Composer or shell after exit:

```text
<64
[<64;...M
;47;20M
X10 mouse fragments
```

Must hold:

- [ ] Single click does not copy.
- [ ] Mis-click does not copy.
- [ ] Drag selection copies correct text.
- [ ] Fast scrolling does not visibly break UI.
- [ ] Exit leaves shell clean.

## Handoff Notes

A future conversation can start by running the automated tests from this phase and then manually validating one terminal profile at a time.

---

# Phase 9 — Delivery Document / Final Cleanup

## Goal

Document what changed, what was intentionally not changed, test results, and known limitations.

## Tasks

- [ ] Write/update delivery document under the repo's existing delivery-doc convention.
- [ ] Document why stock Ink app-layer patching was not enough.
- [ ] Document new renderer/runtime ownership boundaries.
- [ ] Document CCB behavior alignment at behavior level.
- [ ] Document Linghun clean-room implementation notes.
- [ ] Document config/env knobs.
- [ ] Document automated test results.
- [ ] Document manual terminal test results.
- [ ] Document known limitations.
- [ ] Provide handoff packet for future maintenance.

## Acceptance Criteria

- [ ] A new maintainer can understand the architecture without reading the whole conversation.
- [ ] The repo records what was verified and where risk remains.
- [ ] Old redundant app-layer patches are removed or explicitly marked as final safety guards.

---

# Recommended Execution Order

Do not attempt all phases in one conversation unless explicitly requested. Recommended split:

```text
Conversation 1: Phase 0
Conversation 2: Phase 1
Conversation 3: Phase 2 + parser tests
Conversation 4: Phase 3
Conversation 5: Phase 4
Conversation 6: Phase 5
Conversation 7: Phase 6
Conversation 8: Phase 7
Conversation 9: Phase 8 + Phase 9
```

If time is limited, the highest-value early milestone is:

```text
Phase 0 -> Phase 1 -> Phase 2
```

because this creates the ownership boundary and fixes the raw mouse/wheel bytes entering Composer.

---

# Rules For Future Follow-Up Conversations

When continuing this work:

1. Read this document first.
2. Check current git status before editing.
3. Pick exactly one phase unless the user asks for more.
4. Do not directly copy CCB private/source implementation; use behavior-level reference only.
5. Prefer runtime-owned parsing/modes/selection over app-layer patches.
6. Keep agent/provider/tool/scheduler code out of scope.
7. Add tests in the same phase as behavior changes.
8. Do not remove old guards until the runtime-owned path is tested.
9. Before reporting completion, state which phase was completed and which acceptance criteria remain.
