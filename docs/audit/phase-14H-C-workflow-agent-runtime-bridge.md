# D.14H-C Workflow Agent Runtime Bridge

Date: 2026-06-01
Scope: pure bridge from normalized Workflow Plan slices to existing main-chain request proposals. No execution, no UI entry, no second scheduler/runtime/job store/agent executor/evidence gate/permission mode, no provider/env/key/model route changes, no commit.

## 1. Stage Result

D.14H-C adds a minimal pure bridge module that consumes `NormalizedWorkflowPlan` and returns structured request proposals for existing Linghun main-chain targets:

- `/job create`
- `/job run`
- `/job status`
- `/job report`
- `/fork <role> <task>`
- `/agents list`
- `/agents show`
- verification read-only requests
- details read-only requests

The bridge does not call slash handlers, does not dispatch tools, does not run jobs or agents, does not write files, and does not start background tasks. Every returned item is marked `proposalOnly: true`.

## 2. Changed Files

- Code: `packages/tui/src/workflow-agent-runtime-bridge.ts`
- Tests: `packages/tui/src/workflow-agent-runtime-bridge.test.ts`
- Docs: `docs/audit/phase-14H-C-workflow-agent-runtime-bridge.md`

No existing runtime command path or `index.ts` dispatcher was modified.

Pre-existing local state:

- `.claude/` is untracked and was not touched.

## 3. Bridge Request Structure

`bridgeWorkflowPlanToMainChainRequests(plan, options)` returns:

- `workflowId`
- `currentPhaseId`
- `runningCap`
- `phaseStopPointConfirmed`
- `phaseStatuses`
- `summary`
- `requests[]`

Each request proposal contains:

- `proposalOnly: true`
- `workflowId`, `phaseId`, `sliceId`
- `status`: `runnable`, `readonly`, `start_gate_needed`, `blocked`, `queued`, or `status_only`
- `executable`: only means safe to hand to the existing main-chain dispatcher later; it is not an execution result
- `request`: structured union for `job`, `fork`, `agents`, `verification`, or `details`
- `safety`: `readonly`, `mutating`, `requiresStartGate`, `requiresPermissionPipeline`, `requiredPermissionAction`, `evidencePolicy`
- `startGateProposal`
- `permissionProposal`
- `handoffProposal`
- `backgroundProjection`
- `taskSurfaceInput`

There is no raw command string field. Forced `command` / `rawCommand` values are rejected by bridge tests and produce `blocked`.

## 4. Main Chain Reuse

The bridge maps only to existing semantics:

- `/job`: lifecycle actions stay on existing durable job runtime. The bridge only prepares structured `mainChain: "job"` proposals.
- `/fork`: role/task proposals stay on existing fork runtime, which already owns handoff, role routing, background guard, running cap, and worker permission pipeline.
- `/agents`: list/show proposals are readonly status/detail requests.
- verification/details: readonly projections for existing verification/details surfaces.
- background task projection: uses existing `BackgroundTaskState` kind/status vocabulary and job/agent status vocabulary; it does not add a task store.
- runner adapter: only reachable later through existing approved durable job paths. The bridge never creates runner specs.

This is not a second runtime because it has no loop, no persistence, no executor, no scheduling clock, no child sessions, no permission decisions, and no evidence writer.

## 5. Safety Boundaries

- Dependency satisfied: phase dependencies require completed phases; slice dependencies require completed slices.
- Eligible statuses: only `queued`, `created`, and `sleeping` slices are converted toward action proposals.
- Phase stop point: mutating requests become `runnable` only when `options.confirmedPhaseStopPoints` includes the current phase id. The schema requirement that a stop point exists is not treated as confirmation.
- Running cap: default is 3 via existing job cap semantics. Extra mutating slices become `queued`.
- Plan mode: mutating targets are blocked and non-executable.
- Permission: mutating proposals set `requiresPermissionPipeline=true` and emit a `permissionProposal` that points to `decidePermission` / `pendingLocalApproval`; bridge never decides allow/deny.
- Required action: worker `/fork` proposals mark `requiredPermissionAction: "Write"`; readonly requests mark `none`.
- Evidence: all proposals set `evidencePolicy: "neverTreatCompletionAsPass"`.
- Completion evidence: `agent_summary` / `job_completed` are context/status only and are never allowed as PASS evidence.
- Handoff/context refs: only bounded refs, workspace cache refs, evidence refs, and key file summaries are projected. Full transcript/source/index/log refs are dropped and recorded by kind.
- Provider/model route: no provider env, key, base URL, model route, or route mutation field exists in the bridge output.
- UI: no independent dashboard/page/panel was added.

## 6. D.14H-D Handoff

D.14H-D Task Surface + Evidence Merge should consume only these readonly outputs:

- `phaseStatuses`
- per-slice `status`, `reason`, and `nextAction`
- `taskSurfaceInput`
- `backgroundProjection`
- `handoffProposal.evidenceRefs`
- `handoffProposal.workspaceCacheRefs`
- structured `request` target labels

Evidence Merge must keep the same conservative rule: job/agent lifecycle completion is status, not proof. PASS can only come from existing verification/tool evidence accepted by the final answer/evidence gates.

D.14H-D should render these through existing Task/background/agents/details surfaces. It should not create an independent Workflow Dashboard/page/panel, should not auto-advance phases, and should not execute bridge proposals.

## 7. Validation Results

Final validation:

- `corepack pnpm vitest run packages/tui/src/workflow-plan-schema.test.ts` PASS
- `corepack pnpm vitest run packages/tui/src/workflow-agent-runtime-bridge.test.ts` PASS
- `corepack pnpm exec tsc --noEmit` PASS
- `corepack pnpm typecheck` PASS
- `corepack pnpm --filter @linghun/tui build` PASS
- `git diff --check` PASS

## 8. Reference Check

Actually read for this stage:

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/audit/phase-14H-A-workflow-matrix-source-audit.md`
- `docs/audit/phase-14H-B-workflow-plan-schema.md`
- `packages/tui/src/workflow-plan-schema.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/job-runtime.ts`
- `packages/tui/src/tui-agent-job-runtime.ts`
- `packages/tui/src/tui-data-types.ts`
- `packages/tui/src/tui-permission-runtime.ts`
- `packages/tui/src/final-answer-gate.ts`
- `packages/tui/src/workspace-reference-cache.ts`
- `packages/tui/src/deferred-tools-catalog.ts`
- `packages/tui/src/runner-runtime.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/index.ts`

Source-Level Reality Check:

- codebase-memory tools were not available in this Codex environment.
- Local `rg` plus targeted source reads confirmed existing `/job`, `/fork`, `/agents`, permission, final gate, workspace cache, deferred tool, runner, and natural command boundaries.

Reference use:

- Existing Linghun runtime semantics entered the bridge proposal shape.
- No CCB, Claude Code, OpenCode, or other third-party source implementation was copied.

## 9. Handoff Packet

- Next stage: D.14H-D Workflow Task Surface + Evidence Merge.
- Must not do next: execute bridge proposals automatically, create a second scheduler/runtime/job store/agent executor/evidence gate, create a dashboard/page/panel, auto-advance phases, treat job/agent completion as PASS evidence, change provider/env/key/model route, touch remote/mobile executor behavior, touch `.claude/`.
- Evidence refs: focused bridge tests, workflow schema tests, TypeScript checks, TUI build.
- Verification: see section 7.
- Index status: external codebase-memory unavailable; local source facts confirmed with `rg` and direct reads.
- Permission mode: local coding session, no runtime permission mode changed.
- Provider/model: no provider/model route changed or used by the bridge.
- Budget usage: no workflow/job/agent token budget consumed by runtime execution; only local tests/typecheck/build were run.

D.14H-C stops at the phase boundary for user review.

## 10. Small Fix Addendum

Applied after D.14H-C initial delivery:

- Proposal background projection no longer marks `runnable` or `readonly` proposals as `backgroundStatus: "running"`. D.14H-C is proposal-only; Task Surface consumers must not show these as already executing. The proposal still keeps `proposalOnly=true`, structured request data, request status, `jobAgentStatus: "queued"` where appropriate, and `nextAction`.
- PASS evidence banned kinds are aligned with D.14H-A/B: `agent_summary`, `job_completed`, `remote_event`, and `failure_learning` always produce `passEvidenceAllowed:false` in bridge handoff refs, even if a mutated normalized plan carries `passEvidence:true`.

Small-fix validation:

- `corepack pnpm vitest run packages/tui/src/workflow-agent-runtime-bridge.test.ts` PASS
- `corepack pnpm vitest run packages/tui/src/workflow-plan-schema.test.ts packages/tui/src/workflow-agent-runtime-bridge.test.ts` PASS
- `corepack pnpm exec tsc --noEmit` PASS
- `corepack pnpm --filter @linghun/tui build` PASS
- `git diff --check` PASS

D.14H-C small fix stops at the phase boundary for user review. No execution chain was connected, no `index.ts` change was made, no provider/env/key/model route was changed, no dashboard/panel was added, and `.claude/` was not touched.
