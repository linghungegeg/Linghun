---
title: Phase 15 real-smoke P1 query lifecycle primary output and report generation
status: p1-continuation-closed
updated: 2026-05-21
---

# Phase 15 real-smoke P1 query lifecycle primary output and report generation

## Scope

This audit note records the handoff/continuation of the old-window unfinished Phase 15 real-smoke P1 work. The work stayed inside the already-started P1 fixes and did not redo a full audit.

This is not a Beta PASS, not a real-smoke PASS, and not a smoke-ready announcement. This did not enter Phase 15.5, Phase 16, or any later phase. No commit was created.

## Implementation summary

- Start Gate primary output is shorter and human-first; exact command, scope, risk, and safety details remain in transcript/system events rather than ordinary primary output.
- Full-access / bypass / dontAsk-style mode changes remain behind exact Start Gate confirmation; plain yes/确认 is not accepted for those actions.
- Read-only status/control-plane queries stay local and do not enter the model path.
- Request lifecycle primary output uses the request lifecycle presenter for short activity lines, slow `/interrupt` guidance, continuation, tool-running, provider failure, empty-response, report-evidence, and report-incomplete messages.
- Provider failures now show concise human-readable primary messages for temporary upstream/gateway failures, timeout/long waits, abort/interruption, and generic failures while preserving evidence/transcript details.
- Tool primary output remains summary-first for Read/Grep/Glob/Bash without exposing raw `tool_result`, evidence ids, full bounded content, or full log paths in ordinary primary output.
- Architecture Runtime primary drift output is short and human-readable; detailed drift warnings stay in system events/details.
- Report generation remains in the provider/tool loop for ordinary “analyze project / deploy / output report” requests, requires key evidence reads before Write, routes Write through the permission pipeline, marks missing evidence as unconfirmed, and keeps final report completion concise.

Existing i18n/message dictionary/presenter mechanisms were used instead of scattered literal bilingual patches. New primary-output wording is centralized through existing `t(context, key, values)` entries and presenter modules, especially `request-lifecycle-presenter.ts`, `permission-presenter.ts`, and `tool-output-presenter.ts`.

## Modified files

P1 implementation and test files touched in this continuation:

- `packages/tui/src/index.ts`
- `packages/tui/src/request-lifecycle-presenter.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/permission-presenter.ts`
- `packages/tui/src/tool-output-presenter.ts`
- `packages/tui/src/architecture-runtime.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/natural-command-bridge.test.ts`
- `packages/tui/src/architecture-runtime.test.ts`
- `docs/audit/phase-15-real-smoke-p1-query-lifecycle-primary-output-and-report-generation.md`

Pre-existing working-tree changes outside this P1 set were preserved and not rolled back.

## Validation results

All required validation commands completed successfully after formatting fixes:

- `corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts packages/tui/src/architecture-runtime.test.ts packages/providers/src/index.test.ts packages/config/src/index.test.ts`
  - Result: 5 test files passed, 327 tests passed.
- `corepack pnpm typecheck`
  - Result: passed.
- `corepack pnpm check`
  - Result: passed; Biome checked 50 files with no fixes applied.
- `corepack pnpm build`
  - Result: passed across workspace packages.
- `git diff --check`
  - Result: passed; only line-ending warnings were emitted by Git for existing working-copy files.

Additional focused TUI-only regression run also passed before the final required validation:

- `corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts packages/tui/src/architecture-runtime.test.ts`
  - Result: 3 test files passed, 270 tests passed.

## Self-review note

After the user requested stopping the independent verifier, the verifier process was stopped before completion. A single-pass self-review was then performed by checking the scoped diff summary, the report content, the required non-claim wording, and the validation evidence already produced in this session.

Self-review result: no additional code changes were required after the final validation pass. The report was updated only to record that independent verification was intentionally stopped by user instruction and that this closure relies on the command validations plus this self-review note.

## Boundaries and non-claims

- Independent verifier was stopped at user request; no independent PASS verdict is claimed.
- No real smoke PASS was declared.
- No Beta PASS was declared.
- No smoke-ready claim was made.
- No Phase 15.5 or Phase 16+ work was started.
- No commit was created.
- No dependency, package-manager, or build-configuration change was introduced.
- No new agent/runtime feature was added as product functionality; background agents were used only after the user explicitly requested multi-agent work for investigation.

## Index and environment note

- Codebase-memory project: `F-Linghun`.
- Index status observed during this continuation: `ready`, with 1380 nodes and 2601 edges.
- Current assistant model/provider for this work: `claude-sonnet-4-6` via Anthropic.
- Budget usage: not measured by Linghun runtime in this audit note; validation was command-based.

## Handoff packet

- Current phase: Phase 15 P1 continuation closure only.
- Next phase: no next phase started; if further work is requested, begin with a new Start Gate and scoped plan.
- Continue to preserve: model/tool loop, `tool_result` continuation, permission pipeline, Architecture Runtime, evidence/transcript/system_event, report-generation guard, and the four permission mode semantics.
- Forbidden carryover: do not announce Beta PASS, real-smoke PASS, or smoke-ready from this P1 closure alone; do not enter Phase 15.5 or Phase 16+ without explicit user confirmation; do not commit unless explicitly requested.
- Evidence: validation commands listed above passed after the P1 changes.
