# Phase Pre-Smoke 01 - TUI Real Interaction Repair

## Stage Goal

Repair only the four real TUI interaction issues found after Pre-Smoke 01:

- input runtime truthfulness for Enter / Shift+Enter / Ctrl+J / `\`+Enter.
- numeric input and overlay owner boundaries.
- Esc / Enter / arrows / Tab ownership for panel and dropdown overlays.
- mouse drag selection and copy based on screen-buffer cells instead of transcript logical rows.

This is a repair on the existing Pre-Smoke 01 scope. It does not advance any other Pre-Smoke task, Beta gate, Phase 17/18 work, provider route, dependency, or release flow.

## Completed Functions

- `normalizeTerminalInput()` no longer guesses plain `\r` as Shift/Meta Enter. If Windows Terminal + PowerShell/cmd only delivers `\r`, Linghun treats it as ordinary Enter and shows an honest fallback hint.
- CSI-u / modifyOtherKeys parsing remains supported for distinguishable newline sequences. Ctrl+J and `\`+Enter remain reliable multiline fallbacks.
- Empty composer digits `1/2/3/4` now enter the input buffer. Task suggestions are selected by explicit suggestion owner actions such as arrows + Enter.
- Owner reducer now keeps `permission > panel > paste > slash > composer`, with explicit numeric/space panel flags and slash dropdown limited to Enter/Esc/Tab/up/down. Ordinary characters still go to composer while slash suggestions are visible.
- Help numeric shortcuts and Btw Enter/Space close actions now have owner reachability instead of being swallowed by composer/panel fallthrough.
- Transcript selection now builds a screen buffer from rendered blocks: screen rows contain cells, display columns, `noSelect`, and soft-wrap metadata. Visible highlight uses screen-cell ranges, and copied text uses the same screen-buffer rows/ranges.
- Command/status-like rows are marked no-select; soft-wrapped rows copy without inserted fake newlines.
- Clipboard runtime attempts OSC52 first when stdout is available, then uses native commands as the confirmable fallback. Windows `clip.exe` receives UTF-16LE with CRLF, and failures report the attempted command errors instead of treating `stdout.write()` as clipboard acknowledgement.

## Usage

Run the TUI:

```powershell
node F:\Linghun\apps\cli\dist\main.js
```

Manual checks:

- Empty composer: press `1`, `2`, `3`; the digits should appear in the input box.
- Active suggestion/select owner: use arrows + Enter to select a task suggestion.
- Panels/dropdowns: Esc closes the current overlay; arrows/Enter/Tab are handled by the current owner.
- Multiline: Ctrl+J and `\` followed by Enter insert newlines.
- WT/cmd raw `\r`: Shift+Enter is not claimed as detectable when the terminal only sends ordinary Enter; use Ctrl+J, `\`+Enter, or terminal CSI-u / modifyOtherKeys config.
- Mouse selection: drag transcript text and release; visible highlight and copied text are based on the same screen cells, and no-select rows do not enter the clipboard.

## Modules

- `packages/tui/src/shell/models/terminal-input-runtime.ts`
- `packages/tui/src/shell/models/input-owner-controller.ts`
- `packages/tui/src/shell/models/transcript-selection-state.ts`
- `packages/tui/src/shell/clipboard.ts`
- `packages/tui/src/shell/components/Composer.tsx`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/index.ts`
- focused tests under `packages/tui/src/shell/**`

## Key Design

- Input runtime owns terminal bytes and protocol parsing; it does not infer Shift/Meta Enter from plain `\r`.
- Owner runtime owns overlay key routing and keeps non-modal slash suggestions from blocking ordinary typing.
- Selection runtime owns screen cells, no-select metadata, soft-wrap metadata, selected text, and highlight cell ranges from the same buffer.
- Clipboard runtime owns OSC52/native fallback and platform encoding; OSC52 write is best-effort unless no native candidate exists.

## Tests And Validation

Passed:

```powershell
corepack pnpm --filter @linghun/tui typecheck
corepack pnpm --filter @linghun/tui exec vitest run src/shell/models/terminal-input-runtime.test.ts src/shell/models/input-owner-controller.test.ts src/shell/models/transcript-selection-state.test.ts src/shell/clipboard.test.ts --no-color
corepack pnpm --filter @linghun/tui exec vitest run src/shell/ink-interaction-smoke.test.ts src/shell/view-model.test.ts src/shell/models/tui-interaction-contract.test.ts src/shell/terminal-interaction-runtime.test.ts --no-color
corepack pnpm --filter @linghun/tui build
git diff --check
```

Not run automatically:

- Real manual TUI smoke with `node F:\Linghun\apps\cli\dist\main.js`; this requires a human terminal session.

## Known Issues

- Terminals vary in CSI-u / modifyOtherKeys support. Linghun no longer claims Shift+Enter works when the only byte delivered is `\r`.
- Mouse support still depends on terminal SGR mouse reporting. Native terminal selection remains outside this repair.
- Clipboard OSC52 may be blocked by some terminals; native fallback reports errors instead of silently passing or treating an OSC52 write as acknowledged copy.

## Out Of Scope

- No provider/model/env changes.
- No dependency or build-script changes.
- No Pre-Smoke task beyond the four TUI real interaction issues.
- No CCB source copy; CCB was behavior-boundary reference only.

## Reference Check

Read Linghun blueprint/spec/roadmap, `docs/delivery/README.md`, Pre-Smoke 01 delivery doc, Phase 7.9/7.10/7.18 TUI delivery docs, and the touched Linghun source files/tests. Two read-only sub-agents checked input/owner and selection/clipboard current implementation facts. CCB behavior boundaries were referenced conceptually; no CCB source, internal API, telemetry, or proprietary implementation was copied.

## Handoff Packet

- verdict: `PASS` for local/focused validation.
- canProceed: `no`; stop for user review and real manual TUI smoke.
- scope: four TUI interaction repairs only.
- validation: commands listed above passed.
- index status: codebase-memory tool unavailable; used `rg` and source reading fallback, no rebuild/refresh.
- permission mode: unchanged.
- model/provider: unchanged.
- next manual command: `node F:\Linghun\apps\cli\dist\main.js`.
