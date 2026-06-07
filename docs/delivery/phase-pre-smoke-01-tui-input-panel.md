# Phase Pre-Smoke 01 - TUI Input, Mouse, And Panel Closure

## Stage Goal

Close the P0 user smoke issues for Delete, Shift+Enter, mouse drag selection/copy/down-drag, and advanced panel input/rendering before real project smoke.

## Completed Functions

- Added terminal input normalization for Delete, Backspace, raw DEL/BS, CSI-u/modifyOtherKeys newline paths, and Ctrl+J.
- 2026-06-07 repair: when Windows Terminal + PowerShell/cmd only delivers plain `\r`, Linghun no longer claims Shift/Meta Enter is distinguishable. Use Ctrl+J, `\`+Enter, or configure the terminal to send CSI-u / modifyOtherKeys.
- Wired Composer to dispatch normalized edit/newline actions instead of relying only on Ink key flags.
- Wired SGR mouse down/drag/up/wheel into transcript selection and scroll events.
- Added transcript selection reducer coverage for left drag, viewport mapping, selected text, and edge autoscroll behavior.
- Closed advanced panel owner issues for Btw/Config/Help/Sessions panels and kept CommandPanel as non-`useInput` owner.

## Usage

In the TUI:

```text
Delete               deletes the character at cursor
CSI-u/modifyOtherKeys Enter  inserts a newline when the terminal sends a distinguishable sequence
Ctrl+J                     inserts a newline fallback
\+Enter                   inserts a newline fallback
Plain \r from WT/cmd       ordinary Enter; Shift/Meta cannot be detected by the app
Left mouse drag      selects transcript text
Drag to edge         scrolls transcript while extending selection
Mouse up             copies selection best-effort
/config /help /btw /sessions panels keep a single input owner
```

## Modules

- `packages/tui/src/shell/models/terminal-input-runtime.ts`
- `packages/tui/src/shell/models/transcript-selection-state.ts`
- `packages/tui/src/shell/components/Composer.tsx`
- `packages/tui/src/shell/components/BtwPanel.tsx`
- `packages/tui/src/shell/components/ConfigPanel.tsx`
- `packages/tui/src/shell/components/HelpPanel.tsx`
- `packages/tui/src/shell/components/SessionsPanel.tsx`
- `packages/tui/src/shell/models/input-owner-controller.ts`
- `packages/tui/src/shell/clipboard.ts`

## Key Design

- Raw terminal sequences are normalized in pure runtime code.
- Mouse selection is app-owned only when SGR mouse input is received; unsupported terminals still rely on native selection fallback.
- Panel input ownership is explicit so hidden or inactive panels do not steal input.

## Config Items

No new config item.

## Commands

No new slash command. User interaction paths are direct TUI keyboard/mouse paths.

## Tests And Validation

Focused coverage:

```powershell
corepack pnpm exec vitest run packages/tui/src/shell/models/terminal-input-runtime.test.ts packages/tui/src/shell/models/transcript-selection-state.test.ts packages/tui/src/shell/clipboard.test.ts --no-color
corepack pnpm exec vitest run packages/tui/src/shell/ink-interaction-smoke.test.ts packages/tui/src/shell/view-model.test.ts packages/tui/src/advanced-slash-panel-invariant.test.ts --no-color
```

Also covered by full `packages/tui/src/index.test.ts` and final build/typecheck.

## Performance

Input normalization is synchronous and allocation-light. Selection autoscroll only runs during active drag and is cleaned up on mouse up or exit.

## Known Issues

Terminal mouse/copy behavior can vary by terminal, tmux, SSH, and clipboard utilities. Parser/reducer/Ink smoke tests are closed; real interactive terminal smoke remains the next validation step.

## Out Of Scope

- OSC52 clipboard fallback.
- Character-level rich selection highlighting.
- Replacing Ink or building a custom terminal renderer.

## Next Stage Handoff

Pre-Smoke 02 memory runtime can proceed because P0 input/panel blockers are closed at source and test level.

## Developer Troubleshooting

- Input key mapping: `normalizeTerminalInput()`.
- Mouse parser/reducer: `parseSgrMouseEvent()` and `reduceTranscriptSelection()`.
- Composer glue: `emitInput()` and terminal action dispatch.
- Panel owner issues: `input-owner-controller.ts` and panel component `useInput` options.

## Reference Check

Read Linghun blueprint/spec/roadmap, full audit, Phase 7.9 TUI visible layer report, Phase 6.6 transcript interaction report, and related shell tests. CCB was only a behavior reference for mature terminal selection/copy and panel boundaries. No CCB source was copied.

## Product Handoff Packet

- Next phase: Pre-Smoke 02.
- Must not do: claim all real terminals are manually smoke-tested, add `/copy` as substitute for drag copy, or replace Ink.
- Evidence refs: source modules and tests listed above.
- Validation: focused tests plus full index regression and final build/typecheck.
- Index status: not needed for this phase.
- Permission mode: no permission model change.
- Model/provider: provider-agnostic TUI runtime.
- Budget: no provider calls.
