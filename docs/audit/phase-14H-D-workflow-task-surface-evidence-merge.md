# D.14H-D Workflow Task Surface + Evidence Merge

Date: 2026-06-01
Scope: read-only Task Surface projection + Evidence Merge from normalized Workflow Plan + Bridge Result. No execution, no dashboard/panel, no second runtime/scheduler/job store/agent executor/evidence gate/permission mode, no provider/env/key/model route changes, no commit.

## 1. Stage Result

D.14H-D adds a pure projection module that consumes `NormalizedWorkflowPlan` + `WorkflowAgentRuntimeBridgeResult` and produces:

- Main-screen short summary (summaryText)
- Full details matrix (detailsText) for Ctrl+O / `/details`
- Evidence Merge rows with conservative PASS/PARTIAL/BLOCKED verdicts
- Mobile-safe summary with secret/path/log sanitization
- Structured meta for downstream consumers

This is a read-only product layer. It does not execute bridge proposals, does not call slash handlers, does not start jobs/agents/runners, and does not write files or modify state.

## 2. Changed Files

- `packages/tui/src/workflow-task-surface.ts` — new pure projection module
- `packages/tui/src/workflow-task-surface.test.ts` — 14 focused tests
- `docs/audit/phase-14H-D-workflow-task-surface-evidence-merge.md` — this report

No existing runtime, `index.ts`, or command path was modified.

## 3. Task Surface Summary Fields

`summaryText` contains:

- Workflow title
- Current phase name
- Slices: done / running / blocked / queued counts
- Evidence refs count + merge verdict (PASS/PARTIAL/BLOCKED)
- Budget: token estimate, cost estimate, duration estimate (or "unset")
- Request summary: runnable / readonly / start_gate / blocked / queued counts
- Next action

## 4. detailsText Matrix Fields

Per-request row:

- phaseId
- sliceId
- role (inferred from request or background projection)
- status (runnable/readonly/start_gate_needed/blocked/queued/status_only)
- required permission action
- evidence refs
- next action

Evidence Merge section:

- ref
- kind
- verdict (PASS/PARTIAL/BLOCKED)
- reason

## 5. Evidence Merge Conservative Rules

PASS eligible kinds (only when `passEvidenceAllowed=true`):
- `file_read`, `grep_result`, `index_query`, `command_output`, `test_result`, `verification`, `provider`, `architecture`

PASS banned kinds (always PARTIAL, never PASS):
- `agent_summary`, `job_completed`, `remote_event`, `failure_learning`

Additional rules:
- `passEvidenceAllowed=false` → PARTIAL regardless of kind
- No evidence refs at all → overall verdict is BLOCKED
- Mixed PASS + PARTIAL → overall PARTIAL
- Request status (runnable/readonly/queued/blocked) is never treated as PASS evidence
- Job/agent/runner completion is status, not proof

## 6. Mobile-Safe Summary Boundary

Mobile summary includes only:
- Workflow title
- Current phase
- Blocked count
- Approval needed (yes/no)
- Evidence count + merge verdict
- Next action

Sanitized out:
- Windows absolute paths (`C:\...`)
- Unix home/var/tmp paths
- API keys (`sk-...`, `api_key=...`, `Bearer ...`)
- "full transcript", "raw transcript", "full source", "raw source", "full log", "raw log"
- Truncated to 800 chars max

## 7. Non-Execution Boundary

D.14H-D did not add:
- Bridge proposal execution
- A second scheduler/runtime/job store/agent executor/evidence gate
- A new permission mode
- An independent Workflow Dashboard/page/panel
- Provider/env/key/model route changes
- Natural-language keyword interception
- Remote/mobile executor behavior changes
- Auto phase progression
- CommandPanel feature island

## 8. Validation Results

- `corepack pnpm vitest run packages/tui/src/workflow-task-surface.test.ts` — 14/14 PASS
- `corepack pnpm vitest run packages/tui/src/workflow-plan-schema.test.ts packages/tui/src/workflow-agent-runtime-bridge.test.ts` — 30/30 PASS
- `corepack pnpm exec tsc --noEmit` — PASS
- `corepack pnpm typecheck` — PASS
- `corepack pnpm --filter @linghun/tui build` — PASS
- `git diff --check` — PASS

## 9. Reference Check

Actually read for this stage:

- `CLAUDE.md` (project instructions)
- `docs/audit/phase-14H-B-workflow-plan-schema.md`
- `docs/audit/phase-14H-C-workflow-agent-runtime-bridge.md`
- `packages/tui/src/workflow-plan-schema.ts`
- `packages/tui/src/workflow-plan-schema.test.ts`
- `packages/tui/src/workflow-agent-runtime-bridge.ts`
- `packages/tui/src/workflow-agent-runtime-bridge.test.ts`
- `packages/tui/src/tui-data-types.ts`
- `packages/tui/src/tui-output-surface.ts`
- `packages/tui/src/pending-details-presenter.ts`
- `packages/tui/src/job-runtime.ts` (DEFAULT_JOB_RUNNING_AGENT_CAP)

Source-Level Reality Check:
- Confirmed existing type shapes and bridge output structure by reading source directly.
- No CCB, Claude Code, OpenCode, or other third-party source implementation was copied.

## 10. Handoff Packet

- Next stage: D.14H-E — consider smoother NL planner entry into B/C/D, still reusing existing main chain and permission boundary.
- Must not do next: execute bridge proposals automatically, create a second scheduler/runtime/job store/agent executor/evidence gate, create a dashboard/page/panel, auto-advance phases, treat job/agent completion as PASS evidence, change provider/env/key/model route, touch remote/mobile executor behavior, touch `.claude/`.
- Evidence refs: 14 focused task surface tests, 30 schema+bridge tests, TypeScript checks, TUI build.
- Verification: see section 8.
- Index status: external codebase-memory unavailable; local source facts confirmed with direct reads.
- Permission mode: local coding session, no runtime permission mode changed.
- Provider/model: no provider/model route changed or used.
- Budget usage: no workflow/job/agent token budget consumed by runtime execution; only local tests/typecheck/build were run.

D.14H-D stops at the phase boundary for user review. Not committed.

## 11. Small Fix Addendum

Applied after D.14H-D initial delivery:

### Fix 1: evidenceMergeSummary considers bridge request status

Previously `evidenceMergeSummary` only looked at evidence row verdicts. If all evidence rows were PASS but bridge requests still had `start_gate_needed` / `queued` / `runnable` / `status_only` / `blocked`, the overall could misleadingly show `PASS`.

Fixed: `computeOverallVerdict` now takes the bridge request summary into account:
- `blocked` requests → overall `BLOCKED`
- `start_gate_needed` / `queued` / `runnable` / `status_only` requests present → overall `PARTIAL`
- Only when all evidence rows are PASS **and** no pending/blocked requests exist → overall `PASS`
- No evidence refs → `BLOCKED` (unchanged)

### Fix 2: Evidence refs deduplicated

Previously plan-level evidence appeared in every request's `handoffProposal.evidenceRefs`, causing duplicate counting in `evidenceCount`, `evidenceMergeRows`, and detailsText.

Fixed: `deduplicateEvidenceRefs` removes duplicates by `ref + kind + claim` composite key before computing counts and merge rows. Bridge output (`workflow-agent-runtime-bridge.ts`) is unchanged.

### Small-fix validation

- `corepack pnpm vitest run packages/tui/src/workflow-task-surface.test.ts` — 17/17 PASS
- `corepack pnpm vitest run packages/tui/src/workflow-plan-schema.test.ts packages/tui/src/workflow-agent-runtime-bridge.test.ts packages/tui/src/workflow-task-surface.test.ts` — 47/47 PASS
- `corepack pnpm exec tsc --noEmit` — PASS
- `corepack pnpm --filter @linghun/tui build` — PASS
- `git diff --check` — PASS

D.14H-D small fix stops at the phase boundary for user review. Not committed.
