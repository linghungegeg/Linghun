# Phase Pre-Smoke 04 - State, Error, And Concurrency Closure

## Stage Goal

Close state consistency, empty-error handling, date sorting, concurrent session writes, memory mutation exhaustiveness, and provider breaker oscillation before real smoke.

## Completed Functions

- SessionStore append/update writes are linearized with a per-session write queue.
- Runtime status date sorting now guards empty/invalid dates before comparison.
- Memory mutation handling is explicit and fail-closed for unknown actions.
- Provider circuit breaker supports `half-open` after cooldown and resolves success/failure explicitly.
- Permission denial and git evidence paths no longer silently diverge when persistence or continuation surfaces fail.
- Spawn/error and previously empty catch paths now produce warnings, diagnostics, or defense-only comments/tests.

## Usage

No new user command. These are runtime guarantees behind existing session, provider, permission, git, and memory paths.

## Modules

- `packages/core/src/session-store.ts`
- `packages/core/src/jsonl.ts`
- `packages/tui/src/runtime-status-snapshot.ts`
- `packages/tui/src/memory-command-runtime.ts`
- `packages/tui/src/provider-circuit-breaker.ts`
- `packages/tui/src/permission-approval-runtime.ts`
- `packages/tui/src/git-tool-dispatch-runtime.ts`
- `packages/tui/src/runner-runtime.ts`

## Key Design

- State changes that depend on persistence either commit in order or report rollback/diagnostic behavior.
- Invalid runtime timestamps sort stably instead of producing NaN.
- Provider breaker avoids cooldown oscillation by using a half-open trial state.
- Unknown mutation actions fail closed instead of falling through to unrelated logic.

## Config Items

Existing provider breaker environment overrides remain supported:

```text
LINGHUN_PROVIDER_BREAKER_COOLDOWN_MS
```

No new config was added by this phase.

## Commands

No new slash command.

## Tests And Validation

Focused coverage:

```powershell
corepack pnpm exec vitest run packages/core/src/session-store.test.ts packages/tui/src/runtime-status-snapshot.test.ts packages/tui/src/provider-circuit-breaker.test.ts --no-color
corepack pnpm exec vitest run packages/tui/src/memory-command-runtime.test.ts --no-color
```

Final validation also includes typecheck, build, and full test rerun.

## Performance

Per-session write queues serialize only writes for the same session. Provider half-open state does not add IO. Date parsing guards are local and cheap.

## Known Issues

No known Pre-Smoke 04 blocker remains. Full project stress with real concurrent writers is deferred to real smoke/stress after this stable point.

## Out Of Scope

- Replacing JSONL/session storage.
- Introducing a database or native file lock.
- Changing provider retry policy beyond half-open stabilization.

## Next Stage Handoff

Pre-Smoke 05 can rely on stable session/evidence/provider state when closing functional and ecosystem behavior.

## Developer Troubleshooting

- Session write queue: `enqueueSessionWrite()`.
- Runtime sort guard: safe date parsing in `runtime-status-snapshot.ts`.
- Breaker state transitions: `provider-circuit-breaker.ts`.
- Memory mutation actions: `executeMemoryMutation()`.

## Reference Check

Read Linghun blueprint/spec/roadmap, full audit, Phase B self-audit fixes, Phase F provider/permission/MCP, and current source/tests. CCB was only referenced for behavior boundaries around diagnostics and breaker semantics. No CCB source was copied.

## Product Handoff Packet

- Next phase: Pre-Smoke 05.
- Must not do: hide persistence failures, convert failed/timeout/stale states into PASS, or use state docs as substitute for tests.
- Evidence refs: focused state/concurrency tests.
- Validation: focused tests plus final full validation.
- Index status: not required.
- Permission mode: unchanged.
- Model/provider: provider runtime only through local tests/mocks.
- Budget: no real provider calls.
