# D.14H-E Natural Workflow Planner Entry

Date: 2026-06-01
Scope: connect D.14H-B/C/D Workflow Plan Schema + Runtime Bridge + Task Surface to existing slash/natural language entry. No execution, no fifth permission mode, no workflow-specific approval system, no second runtime/scheduler/job store/agent executor/evidence gate, no dashboard/panel, no commit.

## 1. Stage Result

D.14H-E adds a minimal planner entry module and wires it into the existing `/workflows` slash command as a `plan` subcommand. Users can now:

- `/workflows plan <goal>` — generates a conservative Workflow Plan preview + Task Surface summary
- Natural language intent routing maps "workflow plan" / "工作流计划" to `/workflows plan <goal>`

The entry generates a deterministic conservative plan (explore → implement → verify), normalizes it, runs the bridge, projects the task surface, and outputs a preview. No execution occurs.

## 2. Changed Files

- `packages/tui/src/workflow-planner-entry.ts` — new pure planner entry module
- `packages/tui/src/workflow-planner-entry.test.ts` — 15 focused tests
- `packages/tui/src/index.ts` — added `plan` subcommand branch in `handleWorkflowsCommand` (dynamic import, ~15 lines)
- `packages/tui/src/natural-command-bridge.ts` — updated workflows capability aliases/descriptions + `createNaturalEquivalentCommand` plan routing
- `docs/audit/phase-14H-E-natural-workflow-planner-entry.md` — this report

## 3. Slash / Natural Language Entry

### Slash entry

`/workflows plan <goal>` — generates plan preview and outputs:
- Main-screen: formatted summary with phase/slices/evidence/budget/next action
- `lastFullOutput`: full detailsText (accessible via Ctrl+O)
- No execution, no Start Gate triggered

### Natural language mapping

- Capability aliases updated: added "plan workflow", "workflow plan", "工作流计划"
- `createNaturalEquivalentCommand` routes "plan"/"计划"/"规划" keywords to `/workflows plan <extracted goal>`
- No keyword interception — routing goes through existing `routeNaturalIntent` → `scoreCapability` → `createNaturalEquivalentCommand` pipeline

## 4. How B/C/D Are Reused

1. `generateWorkflowPlanPreview` calls `normalizeWorkflowPlan` (D.14H-B)
2. Normalized plan feeds into `bridgeWorkflowPlanToMainChainRequests` (D.14H-C)
3. Bridge result + plan feed into `projectWorkflowTaskSurface` (D.14H-D)
4. Output is the task surface summaryText/detailsText/mobileSummary

## 5. Four Permission Modes — No Fifth Mode

| Mode | Behavior |
|------|----------|
| plan | Only generates preview. No worker/implement slice. No mutating proposals. |
| default | Generates full plan with worker slice. Mutating proposals marked `start_gate_needed` or `blocked` (dependency). Never executable without confirmation. |
| auto-review | Same as default — plan generation is readonly. Execution would still require existing permission pipeline. |
| full-access | Same as default — plan generation is readonly. Execution would still require existing permission pipeline. |

No fifth permission mode was added. No workflow-specific approval store exists.

## 6. Conservative Planner Design

The deterministic planner generates:
- Phase 1 with stopPoint (required, confirmationRequired)
- Slice: explore (readonly details view)
- Slice: implement (mutating /fork worker) — only in non-plan modes
- Slice: verify (readonly verification typecheck)
- Dependencies: implement depends on explore; verify depends on implement (or explore in plan mode)
- Budget: 10k tokens phase, 5k tokens worker slice
- Acceptance criteria: locate relevant code, apply changes after approval, run typecheck/tests after execution. Preview does not fabricate PASS evidence.
- Goal text sanitized (paths, keys, secrets removed)

## 7. Non-Execution Boundary

D.14H-E did not add:
- Bridge proposal execution
- A fifth permission mode
- A workflow-specific Start Gate / approval system
- A second scheduler/runtime/job store/agent executor/evidence gate
- An independent Workflow Dashboard/page/panel
- Provider/env/key/model route changes
- Natural-language keyword interception
- Remote/mobile executor behavior changes
- Auto phase progression
- CommandPanel feature island

## 8. Validation Results

- `corepack pnpm vitest run packages/tui/src/workflow-planner-entry.test.ts` — 15/15 PASS
- `corepack pnpm vitest run packages/tui/src/workflow-plan-schema.test.ts packages/tui/src/workflow-agent-runtime-bridge.test.ts packages/tui/src/workflow-task-surface.test.ts packages/tui/src/workflow-planner-entry.test.ts` — 62/62 PASS
- `corepack pnpm vitest run packages/tui/src/natural-command-bridge.test.ts` — 912/912 PASS (includes worktree copies)
- `corepack pnpm exec tsc --noEmit` — PASS
- `corepack pnpm typecheck` — PASS
- `corepack pnpm --filter @linghun/tui build` — PASS
- `git diff --check` — PASS

## 9. Reference Check

Actually read for this stage:

- `docs/audit/phase-14H-B-workflow-plan-schema.md`
- `docs/audit/phase-14H-C-workflow-agent-runtime-bridge.md`
- `docs/audit/phase-14H-D-workflow-task-surface-evidence-merge.md`
- `packages/tui/src/workflow-plan-schema.ts`
- `packages/tui/src/workflow-agent-runtime-bridge.ts`
- `packages/tui/src/workflow-task-surface.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/slash-dispatch.ts`
- `packages/tui/src/command-panel-runtime.ts`
- `packages/tui/src/tui-permission-runtime.ts`
- `packages/tui/src/permission-presenter.ts`
- `packages/tui/src/index.ts` (handleWorkflowsCommand section)
- `packages/tui/src/extension-command-runtime.ts` (formatWorkflows)

Source-Level Reality Check:
- Confirmed existing `/workflows` dispatch, capability catalog, and natural command routing by reading source directly.
- No CCB, Claude Code, OpenCode, or other third-party source implementation was copied.

## 10. Handoff Packet

- Next stage: D.14H-F or later — real workflow execution wiring. Phase advance must continue to reuse existing `/job`, `/fork`, permission pipeline, evidence/final gate. The planner entry only produces previews; connecting execution requires Start Gate confirmation + permission pipeline for each mutating proposal.
- Must not do next: execute bridge proposals automatically, create a second scheduler/runtime/job store/agent executor/evidence gate, create a dashboard/page/panel, auto-advance phases, treat job/agent completion as PASS evidence, change provider/env/key/model route, touch remote/mobile executor behavior, touch `.claude/`, add a fifth permission mode.
- Evidence refs: 15 planner entry tests, 62 total workflow tests, 912 natural command bridge tests, TypeScript checks, TUI build.
- Verification: see section 8.
- Index status: external codebase-memory unavailable; local source facts confirmed with direct reads.
- Permission mode: local coding session, no runtime permission mode changed.
- Provider/model: no provider/model route changed or used.
- Budget usage: no workflow/job/agent token budget consumed by runtime execution; only local tests/typecheck/build were run.

D.14H-E stops at the phase boundary for user review. Not committed.

## 11. Small Fix Addendum

Applied after D.14H-E initial delivery:

### Fix: Preview stage no longer fabricates PASS evidence

Previously `buildSlicesForGoal` generated slice-level evidence with `passEvidence:true` and completed-tense claims ("relevant code located", "changes applied", "verification passes"). This caused Evidence Merge to show PASS verdicts during a preview that had not actually executed anything — violating evidence-first / anti-hallucination principles.

Fixed:
- Removed all `evidence` arrays from generated slices. Requirements are now expressed via `acceptanceCriteria` and `nextAction` (which do not enter Evidence Merge).
- Preview stage `evidenceMergeSummary` is now `BLOCKED` (no evidence refs exist) — correctly reflecting that no evidence has been gathered yet.
- Output text no longer contains completed-tense claims ("changes applied", "verification passes", "relevant code located").

### Small-fix validation

- `corepack pnpm vitest run packages/tui/src/workflow-planner-entry.test.ts` — 18/18 PASS
- `corepack pnpm vitest run packages/tui/src/workflow-plan-schema.test.ts packages/tui/src/workflow-agent-runtime-bridge.test.ts packages/tui/src/workflow-task-surface.test.ts packages/tui/src/workflow-planner-entry.test.ts` — 65/65 PASS
- `corepack pnpm vitest run packages/tui/src/natural-command-bridge.test.ts` — 912/912 PASS
- `corepack pnpm exec tsc --noEmit` — PASS
- `corepack pnpm --filter @linghun/tui build` — PASS
- `git diff --check` — PASS

D.14H-E small fix stops at the phase boundary for user review. Not committed.

