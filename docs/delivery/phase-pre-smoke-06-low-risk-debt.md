# Phase Pre-Smoke 06 - Low-Risk Debt And Duplicate Cleanup

## Stage Goal

Clear the low-risk audit debt that can affect smoke reliability without broad refactors or new abstractions.

## Completed Functions

- Shared helper ownership was tightened for environment integer parsing, diagnostics, secret redaction, and runtime constants where package boundaries allow it.
- `MEMORY_LEARNING_STATE_FILE` moved to a shared TUI runtime constant.
- Shell and renderer debt items were either fixed through touched focused code or merged into existing tested behavior.
- `formatDiagnosticError` remaining in package-local code is a package-boundary `NOT-ISSUE` where shared import would create unnecessary coupling.
- Dead or unreachable code found by the audit was removed or documented as defense-only with tests.

## Usage

No user-facing behavior changed beyond more consistent diagnostics and lower risk of duplicate helper drift.

## Modules

- `packages/shared/src/index.ts`
- `packages/tui/src/runtime-utils.ts`
- `packages/tui/src/tui-state-runtime.ts`
- `packages/tui/src/tui-memory-runtime.ts`
- `packages/tui/src/shell/plain-renderer.ts`
- `packages/tui/src/shell/view-model.ts`
- `packages/tools/src/index.ts`
- selected provider/config/runtime callers

## Key Design

- Only duplicate helpers with a clear owner were centralized.
- Package-local helpers were kept when centralization would add dependency/build complexity.
- Shell debt was closed through behavior tests instead of broad renderer replacement.

## Config Items

No new config.

## Commands

No new command.

## Tests And Validation

Focused validation includes:

```powershell
corepack pnpm exec biome check packages/config/src/index.ts packages/core/src/jsonl.ts packages/core/src/session-store.ts packages/core/src/session-store.test.ts packages/providers/src/index.ts packages/providers/src/index.test.ts packages/shared/src/index.ts packages/tui/src/advanced-slash-panel-invariant.test.ts packages/tui/src/index.test.ts packages/tui/src/phase-e-mainchain-coverage.test.ts packages/tui/src/shell/view-model.ts packages/tui/src/shell/view-model.test.ts --no-errors-on-unmatched --colors=off
corepack pnpm typecheck
corepack pnpm build
```

Full test validation is recorded in Pre-Smoke 07.

## Performance

No new background work or provider calls. Shared helpers reduce repeated parsing/sanitization code without changing hot-path complexity.

## Known Issues

No low-risk item remains open in the Pre-Smoke registry. Future large-scale renderer/provider refactors are outside this smoke gate.

## Out Of Scope

- Broad file splitting.
- New renderer.
- New dependency.
- Provider architecture rewrite.

## Next Stage Handoff

Pre-Smoke 07 performs final validation, doc scan, and stable commit.

## Developer Troubleshooting

- Shared helpers: `packages/shared/src/index.ts`.
- TUI memory learning constant: `packages/tui/src/runtime-utils.ts`.
- Shell behavior tests: `packages/tui/src/shell/view-model.test.ts`, `advanced-slash-panel-invariant.test.ts`.

## Reference Check

Read Linghun blueprint/spec/roadmap, full audit, Phase B self-audit report, and current source/tests. CCB was not needed beyond general quality boundary references. No CCB source was copied.

## Product Handoff Packet

- Next phase: Pre-Smoke 07.
- Must not do: turn low-risk cleanup into broad refactor, introduce package cycles, or modify unrelated files.
- Evidence refs: Biome/typecheck/build and focused tests.
- Validation: final ledger in Pre-Smoke 07.
- Index status: not required.
- Permission mode: unchanged.
- Model/provider: no provider call.
- Budget: no runtime cost.
