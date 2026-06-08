# Closure Phase 6 - Daily Path / Terminal State Closure

## Stage Goal

Close the user-selected runtime gaps only: ordinary Q&A light path, permission continuation terminal states, verifiable cancellation states, explicit verification modes, precise index refresh terminal state, Git rollback boundary wording, and low-noise readonly evidence.

## Completed

- Ordinary answer light path now omits full tools, synchronous git status/worktree prompt context, workspace-reference refresh, meta-scheduler prompt payload, and compact preflight unless the request needs tools/actions or exceeds context limits.
- Permission approve/deny/cancel now records `permission_user_decision`; missing continuation/gateway paths record an explicit terminal system event. Esc cancellation reuses the deny/cancel continuation path.
- Background cancellation records `cancelState`: `abort_signal_sent`, `marked_stale`, or `confirmed_exited`; confirmed exit is only set after cancelled tool output is observed.
- Verification has explicit `plan-only`, `focused`, and `real-smoke` entries. `real-smoke` requires a project smoke script and does not fall back to synthetic smoke.
- Index refresh read-back delay now uses `refresh_completed_but_unverified` instead of overloading `stale`.
- Snapshot restore wording clarifies it is not git revert/reset and does not move HEAD.
- Read/Grep/Glob evidence summaries keep audit refs but avoid copying output snippets into evidence summaries.

## Validation

- `corepack pnpm --filter @linghun/tui exec tsc --noEmit`
- `corepack pnpm --filter @linghun/tui exec vitest run src/verify-command.test.ts src/model-loop-runtime.test.ts src/evidence-runtime.test.ts src/mcp-index-runtime.test.ts`
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "ordinary answer light path|continues after denied model tool permission|continues after cancelled model tool permission|index refresh success with delayed status read-back"`

## Scope Notes

- No large-file split.
- No policy-table centralization.
- No removal of Agent/Workflow/verification/final safety gates.
- No git revert/reset implementation; only snapshot-vs-git boundary is clarified.

## Handoff Packet

- Next: user real testing of the seven closure points.
- Forbidden: do not expand into large-file refactors, policy-table redesign, or broader Agent/Workflow scheduler changes without user confirmation.
- Evidence: source changes and focused tests listed above.
- Index state: runtime can now represent `refresh_completed_but_unverified`.
- Permission mode: unchanged.
- Provider/model: unchanged.
