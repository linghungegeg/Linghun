# D.14H-B Workflow Plan Schema

Date: 2026-06-01
Scope: workflow plan schema, normalization, validation, and read-only projection only. No agent/job execution, no runtime bridge, no second agent/job/evidence/permission/runtime.

## 1. Stage Result

D.14H-B adds a pure Workflow Plan Schema layer for Workflow Matrix planning. It describes phases, feature slices, agent role proposals, budgets, allowed tool classes, evidence requirements, stop points, and structured target-runtime proposals, then normalizes and validates the plan without executing anything.

This stage deliberately does not connect to `/job`, `/fork`, native runner, remote, permission execution, provider routing, or final-answer runtime. It only produces normalized data plus Task Surface / details / mobile-safe projections for future reuse.

## 2. Changed Files

- `packages/tui/src/workflow-plan-schema.ts`
  - New pure schema/normalization/validation/projection module.
- `packages/tui/src/workflow-plan-schema.test.ts`
  - Focused Vitest coverage for D.14H-B invariants.
- `docs/audit/phase-14H-B-workflow-plan-schema.md`
  - This handoff report.

No existing runtime command path was modified.

## 3. Schema Fields

Top-level `WorkflowPlan`:

- `id`, `title`, `source`, `createdAt`
- `permissionMode`
- `currentPhaseId`
- `phases`
- `budget`
- `references`
- `evidence`
- `stopConditions`

Phase:

- `id`, `title`, `status`
- `dependsOnPhaseIds`
- `slices`
- `stopPoint`
- `autoAdvance`
- `budget`
- `acceptanceCriteria`

Slice:

- `id`, `title`, `role`, `status`
- `dependsOnSliceIds`
- `allowedToolClasses`
- `toolProposals`
- `targetRuntime`
- `budget`
- `evidence`
- `acceptanceCriteria`
- `references`
- `nextAction`

Target runtime proposals are structured references only. They may point at existing main-chain targets such as `/job`, `/fork`, `/agents`, `/workflows`, verification, or details views, but they are not raw command strings and are not executed in this stage.

## 4. Validation Boundaries

The validator rejects:

- Missing workflow/phase/slice identifiers and titles.
- Invalid phase/slice dependencies.
- Invalid roles and negative budget values.
- Missing phase stop points or `autoAdvance=true`.
- Raw full transcript/source/log fields.
- Oversized inline reference summaries; use bounded refs instead.
- Unknown tool classes.
- Tool execution proposals that are not discovered, trusted, and executable.
- MCP execution proposals that are not `mcp:<server>:<tool>` local-stdio references.
- Raw command strings in runtime mapping proposals.
- Mutating execution proposals while `permissionMode=plan`.
- Using `failure_learning`, `remote_event`, `agent_summary`, or `job_completed` as PASS evidence.

Normalization preserves the default running cap of 3. If more slices claim `running`, excess slices are downgraded to `queued`; no execution is started.

## 5. Projection Shape

`projectWorkflowPlan` returns:

- `surface: "task-summary"`
- Short main-screen summary:
  - current phase
  - agents done/running/blocked
  - evidence count
  - token/cost summary
  - next action
- `detailsText` matrix:
  - phase
  - slice
  - role
  - status
  - evidence refs
  - budget
  - next action
- mobile-safe summary:
  - redacts secrets
  - redacts absolute local paths
  - removes raw transcript/source/log markers
  - does not include full source, full transcript, or full logs

This is a Task Surface projection. It is not an independent Workflow Dashboard, page, panel, or CommandPanel feature island.

## 6. Non-Execution Boundary

D.14H-B did not add:

- a second agent executor
- a second job store
- a second evidence/final gate
- a new permission mode
- a native runner execution path
- remote/mobile execution behavior
- provider/env/key/model route changes
- natural-language keyword interception
- an independent Workflow Dashboard/page/panel

Workflow plans can describe controlled target-runtime proposals only. D.14H-B never invokes those targets.

## 7. Validation Results

Completed:

- `corepack pnpm exec tsc --noEmit` PASS
- `corepack pnpm typecheck` PASS
- `corepack pnpm --filter @linghun/tui typecheck` PASS
- `corepack pnpm vitest run packages/tui/src/workflow-plan-schema.test.ts` PASS
- `corepack pnpm --filter @linghun/tui build` PASS
- `git diff --check` PASS

Note: an initial parallel run of `corepack pnpm typecheck` and `corepack pnpm --filter @linghun/tui build` raced while the build cleaned `packages/tui/dist`, briefly making `@linghun/tui` declarations unavailable to the CLI project. Re-running `corepack pnpm typecheck` after the TUI build completed passed.

## 8. D.14H-C Handoff

D.14H-C should build a Workflow Agent Runtime Bridge that consumes a normalized plan and converts approved slices into existing main-chain requests.

Required reuse:

- `/job` for durable job lifecycle and reports.
- `/fork` for agent execution.
- `/agents` for status/details.
- Existing permission pipeline for all mutating actions.
- Existing evidence/final gate for all claims.
- Existing runner adapter only through approved durable job paths.
- Existing background task table for status.
- Existing workspace reference cache and deferred-tool discovery snapshots for refs/tool metadata.

Forbidden in D.14H-C:

- Do not execute raw command strings from the plan.
- Do not create a second scheduler/runtime.
- Do not treat agent/job completion as verification PASS.
- Do not bypass running cap 3 by default.
- Do not auto-advance phases without explicit user confirmation.
- Do not push full matrix/log/source/transcript to mobile.

## 9. Small Fix Addendum

Applied after D.14H-B initial delivery:

- Malformed input guard: `normalizeWorkflowPlan` now returns `{ ok: false, errors }` for non-array `phases` and missing/non-array `phase.slices` instead of throwing.
- Budget validation: top-level `budget` and each `phase.budget` now use the same finite, non-negative validation as slice budgets.
- Duplicate id validation: repeated `phase.id` and repeated `slice.id` are rejected with `duplicate phase id` / `duplicate slice id` errors to keep future D.14H-C bridge references stable.
- Formatting cleanup: only `packages/tui/src/workflow-plan-schema.ts` and `packages/tui/src/workflow-plan-schema.test.ts` were formatted.

Small-fix validation:

- `corepack pnpm vitest run packages/tui/src/workflow-plan-schema.test.ts` PASS
- `corepack pnpm exec tsc --noEmit` PASS
- `corepack pnpm typecheck` PASS
- `corepack pnpm --filter @linghun/tui build` PASS
- `git diff --check` PASS
