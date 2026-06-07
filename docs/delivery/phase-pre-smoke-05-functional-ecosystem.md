# Phase Pre-Smoke 05 - Functional Ecosystem And User-State Closure

## Stage Goal

Close functional correctness gaps and replace text-only frustration handling with a structured user-state signal runtime.

## Completed Functions

- `/help all` and command descriptions are registry-backed and covered by drift tests.
- Git branch validation supports legal dotted branch names while preserving unsafe-name rejection.
- Workspace ignore matching handles glob patterns.
- Verification runner detects pnpm/npm/yarn/bun instead of hard-coding one package manager for all projects.
- Clipboard helper treats exit code as the success/failure source and does not fail only because stderr is non-empty.
- User-state signal runtime combines event facts, repeated failures, explicit feedback, text hints, loading/panel state, dismissal, cooldown, and policy gate.
- Meta scheduler consumes typed user-state verification and notification plans.

## Usage

Existing user paths:

```text
/help
/help all
/verify
/git or branch-related commands
mouse selection copy in TUI
normal user feedback such as repeated failure reports
```

No new public user-state command was added; it is a runtime signal behind policy scheduling.

## Modules

- `packages/tui/src/slash-dispatch.ts`
- `packages/tui/src/deferred-tools-catalog.ts`
- `packages/tui/src/git-runtime.ts`
- `packages/tui/src/workspace-reference-cache.ts`
- `packages/tui/src/verification-command-runtime.ts`
- `packages/tui/src/shell/clipboard.ts`
- `packages/tui/src/user-state-signal-runtime.ts`
- `packages/tui/src/meta-scheduler-runtime.ts`

## Key Design

- User-state is a typed runtime signal, not a chatbot mood template.
- Regex/text hints are allowed only as low-weight evidence alongside runtime failures and feedback.
- Busy panels/loading states suppress notification pressure.
- Verification plans become stronger for repeated failure, trust repair, and release/stability work.

## Config Items

No new required config. Existing verification/package manager files are detected from the workspace.

## Commands

No new command. Existing `/help`, `/verify`, git and workspace commands keep their surfaces.

## Tests And Validation

Focused coverage:

```powershell
corepack pnpm exec vitest run packages/tui/src/user-state-signal-runtime.test.ts packages/tui/src/meta-scheduler-runtime.test.ts --no-color
corepack pnpm exec vitest run packages/tui/src/git-runtime.test.ts packages/tui/src/workspace-reference-cache.test.ts packages/tui/src/verification-command-runtime.test.ts packages/tui/src/shell/clipboard.test.ts --no-color
```

`packages/tui/src/index.test.ts` also covers help/registry and user-visible behavior.

## Performance

User-state evaluation is synchronous local scoring. Verification command detection reads small project/package manager metadata only when verification is requested.

## Known Issues

No Pre-Smoke 05 blocker remains. Natural language classification stays conservative; uncertain cases remain neutral.

## Out Of Scope

- New UI panel for user state.
- Psychological profiling or long-term user emotion storage.
- Changing permission or verification runner architecture.

## Next Stage Handoff

Pre-Smoke 06 can focus on low-risk debt and duplicate cleanup after functional and signal-runtime gaps are closed.

## Developer Troubleshooting

- User-state source: `evaluateUserStateSignal()`.
- Scheduler consumption: `evaluateMetaScheduler()`.
- Help registry assertions: `index.test.ts` and `advanced-slash-panel-invariant.test.ts`.
- Workspace ignore matching: `ignorePatternMatches()`.

## Reference Check

Read Linghun blueprint/spec/roadmap, full audit, Phase 7.13 report, Phase 7.11/7.12 verification/job UX reports, and current source/tests. CCB behavior was referenced only for low-noise feedback and stronger verification after repeated failures. No CCB source was copied.

## Product Handoff Packet

- Next phase: Pre-Smoke 06.
- Must not do: implement user-state as a fixed phrase patch, open new panels, or bypass final-answer/verification gates.
- Evidence refs: user-state/meta tests plus functional command tests.
- Validation: focused tests plus final full validation.
- Index status: not required.
- Permission mode: unchanged.
- Model/provider: no provider call.
- Budget: no runtime model cost.
