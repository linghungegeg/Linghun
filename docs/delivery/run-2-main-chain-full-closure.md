# Run 2 Main Chain Full Closure

Date: 2026-05-31

Status: Run 2 closure repaired and verified. Run 3 was not started. No commit was created. Provider route/env/key/model routing was not changed. Dangerous-action permissions were not loosened.

## Scope

Source audit: `F:\Linghun-run2-stress-a7171c8\docs\audit\real-provider-main-chain-stress-2026-05-31-run-2.md`.

This closure only addresses Run 2 FAIL/BLOCKED/Linghun runtime findings needed to make the main chain trustworthy. Historical dirty/untracked files were preserved.

## Finding Table

| Finding | Class | Status | Fix / disposition | Source |
|---|---|---:|---|---|
| Stable point default approval bypass | Product bug | DONE | Model `GitStablePointCreate`: default asks once; auto-review/full-access execute; plan rejects. Slash stable/checkpoint plan mode rejects before commit/snapshot. | `packages/tui/src/git-tool-dispatch-runtime.ts`, `packages/tui/src/git-slash-runtime.ts` |
| Plan slash stable/checkpoint snapshot creation | Product bug | DONE | `/git stable create` and `/checkpoint create` in plan mode now produce no commit and no snapshot. | `packages/tui/src/git-slash-runtime.ts` |
| Final gate denied-action success hallucination | Product bug | DONE | Added `action_executed` claim gate: denied/cancelled/tool-failure evidence cannot support “installed/executed/refreshed successfully” claims. | `packages/tui/src/model-loop-runtime.ts` |
| CLI typecheck `LinghunConfig -> DoctorConfig endpointProfile` | Product bug | DONE | `DoctorProviderConfig.endpointProfile` now reuses config `EndpointProfile`, including `anthropic_messages`. | `apps/cli/src/cli.ts` |
| Slash Bash/tool failure missing from `/failures` | Product bug | DONE | Slash tool failures now write failure-learning records; permission denial/cancel remain excluded. | `packages/tui/src/index.ts` |
| `/index refresh` `repo_path is required` | Product bug / Windows transport | DONE | `/index refresh` sends current `repo_path`; Windows `.cmd/.ps1` codebase-memory shims are resolved to the real Node script where possible so JSON stays one argv. No shell string concatenation added. | `packages/tui/src/mcp-index-runtime.ts` |
| Large-file guard missed `.log` class | Product bug | DONE | Index safety scan now includes `.log`, `.ndjson`, `.csv`, `.tsv`, `.dump` large text/data files while small logs still pass. | `packages/tui/src/index-result-presenter.ts` |
| Global job/memory absolute path noise | Product/privacy bug | DONE | Memory storage, job status/report/logs, background details, evidence/details, Ctrl+O details redact home/local absolute paths and filter durable job list to current project. | `packages/tui/src/startup-runtime.ts`, `packages/tui/src/job-runtime.ts`, `packages/tui/src/tui-memory-runtime.ts`, `packages/tui/src/tui-details-runtime.ts`, `packages/tui/src/command-panel-runtime.ts`, `packages/tui/src/job-runner-presenter.ts` |
| Broken pipe startup/harness robustness | Harness/runtime robustness | DONE | `writeLine` ignores benign `EPIPE` / destroyed-stream write errors and rethrows non-benign errors. | `packages/tui/src/startup-runtime.ts` |
| provider-env temp-file rename conflicts | Harness/runtime robustness | DONE | `provider.env` writes use UUID temp paths and a Windows-safe replace retry path; template creation cleans its temp on collision. | `packages/config/src/index.ts` |
| PermissionPanel / Ctrl+O duplicate wording | Interaction maturity | VERIFIED | Existing focused coverage already locks stable-point PermissionPanel routing and one Ctrl+O hint per block; no extra runtime change made. | `packages/tui/src/permission-panel-invariant.test.ts`, `packages/tui/src/shell/view-model.test.ts` |
| DeepSeek reasoner empty response | Provider/transit | NOT PRODUCT BUG | Recorded as provider/transit, not counted as Linghun runtime closure. | Run 2 audit |
| OpenAI-compatible Claude auth/transit | Provider/transit | NOT PRODUCT BUG | Recorded as provider/transit, no provider route changes made. | Run 2 audit |
| Root vitest cwd / first soak harness issue | Harness | NOT PRODUCT BUG | TUI/CLI package-level validation passes; no unrelated harness rewrite. | Run 2 audit |

## Stable Point Matrix

| Trigger | default | auto-review | plan | full-access |
|---|---|---|---|---|
| Natural/model `GitStablePointCreate` | Ask once; no `yes` means no creation | Auto create | Reject; no commit/snapshot | Auto create |
| Slash `/git stable create` / `/checkpoint create` | Auto create | Auto create | Reject; no commit/snapshot | Auto create |
| denied/cancelled/pending | No `stable_point_created` evidence | No fake success | No fake success | No fake success |

## Focused Coverage

- P1-1 stable point: `Run 2 P1-1: slash stable/checkpoint in plan mode creates no commit or snapshot`, `Run 2 P1-1: model GitStablePointCreate in auto-review creates without confirmation`, existing deny/plan/default tests.
- Final gate: `Run 2 Closure: denied or cancelled actions do not support final success claims`.
- P2-4 failure learning: `Run 2 P2-4: slash Bash non-zero is captured in failure learning`, `Run 2 P2-4: slash Bash permission denial is not failure learning`.
- P2-5 index refresh: `Run 2 P2-5: Windows .cmd codebase-memory shim preserves JSON argv for index refresh`, `Run 2 P2-5: /index refresh sends repo_path for the current project`.
- P2-6 large-file guard: `Run 2 P2-6: index safety blocks large unignored log files`, `Run 2 P2-6: index safety allows small log files`.
- P3-7 privacy/job scope: `/memory storage redacts user-home absolute paths`, job redaction/filtering tests, background presenter redaction test, sanitize relative-path regression test.
- Harness robustness: broken pipe test and concurrent `provider.env` write test.

## Verification

All required validation commands were run. Final passing runs:

- `corepack pnpm exec tsc --noEmit` PASS
- `corepack pnpm typecheck` PASS
- `corepack pnpm --filter @linghun/tui build` PASS
- `corepack pnpm --filter @linghun/cli build` PASS
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts src/permission-panel-invariant.test.ts -t "GitStablePointCreate|stable point|checkpoint|plan mode|denied|failure learning|index refresh|large-file|absolute path|job"` PASS, 44 passed
- `corepack pnpm --filter @linghun/tui exec vitest run` PASS, 2012 passed
- `corepack pnpm --filter @linghun/cli exec vitest run` PASS, 8 passed
- `git diff --check` PASS

Note: `typecheck` briefly failed when run concurrently with TUI build because `tsup --clean` temporarily removed `packages/tui/dist/index.d.ts`. Re-running sequentially after build passed.

## Notes

- The TUI build script now compiles all non-test TUI source entries so `dist/index.js` can import its module graph without `ERR_MODULE_NOT_FOUND`; this was required by existing `dist-integrity.test.ts`.
- No local natural-language keyword interception was restored. Natural language “refresh index” remains model/structured-tool routed.
- No provider/env/key/model route was changed.
- No dangerous action permission was relaxed.
- No historical dirty/untracked files were deleted or reverted.
- No commit was created.

## Addendum: Run 2 Closure Review Small Repair

Scope: small repair only, still Run 2 Closure; not Run 3.

| Review finding | Status | Repair | Source / coverage |
|---|---:|---|---|
| Final gate `action_executed` could false-block real `IndexRefresh` / `IndexRepair` success | DONE | `action_executed` now accepts successful `command_output` / `test_result` evidence with `index_operation`, `index_refresh`, or `index_repair`, while `tool_failure`, `bash_exit_nonzero`, denied, and cancelled evidence still cannot support success claims. | `packages/tui/src/model-loop-runtime.ts`; `packages/tui/src/model-loop-runtime.test.ts` |
| Windows `provider.env` replace fallback could remove the old file before the new temp was installed | DONE | Conflict fallback now writes a backup of the old `provider.env`, copies the new temp into place, restores the backup on failure, and removes temp/backup files. The failed write path keeps old provider.env content. | `packages/config/src/index.ts`; `packages/config/src/index.test.ts` |

Additional focused coverage:

- `evaluateFinalAnswerClaims("索引已刷新。", index_operation/index_refresh command_output evidence)` passes.
- `evaluateFinalAnswerClaims("索引已重建。", index_operation/index_repair command_output evidence)` passes.
- Denied/cancelled index refresh evidence still returns `needs_disclaimer`.
- Simulated Windows replace fallback failure after conflict keeps the old `provider.env` content and leaves no `.tmp` / `.bak` file in the config dir.

Small-repair validation:

- `corepack pnpm exec tsc --noEmit` PASS
- `corepack pnpm typecheck` PASS
- `corepack pnpm --filter @linghun/tui exec vitest run src/model-loop-runtime.test.ts -t "action_executed|denied|cancelled|索引"` PASS, 2 passed
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "IndexRefresh|final_answer_claim_gate|index refresh"` PASS, 6 passed
- `corepack pnpm --filter @linghun/config exec vitest run src/index.test.ts -t "provider.env|concurrent|replace"` PASS, 7 passed
- `corepack pnpm --filter @linghun/tui build` PASS
- `corepack pnpm --filter @linghun/cli build` PASS
- `git diff --check` PASS after this addendum.

Note: on this Windows shell, passing a `-t` regex containing `|` through `corepack pnpm exec` was parsed as a shell pipeline before Vitest received it. The validation used the same pnpm/vitest argv via Node's `spawnSync` with an argument array so the intended regex reached Vitest intact.

Guardrails preserved:

- Did not enter Run 3.
- Did not commit.
- Did not change provider route/env/key/model route.
- Did not restore natural-language keyword interception.
- Did not relax dangerous action permissions.
- Did not revert historical dirty/untracked files.
