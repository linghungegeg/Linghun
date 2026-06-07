# Phase Pre-Smoke 07 - Final Validation And Stable Point

## Stage Goal

Run the final validation sweep, close delivery documentation, and create a stable point commit for the full Pre-Smoke 0-7 closure.

## Completed Functions

- Pre-Smoke 00-06 delivery docs were created or updated.
- The full closure registry has no remaining open source-level item.
- Final validation commands are recorded below.
- Stable point commit is created after docs and validation are staged.

## Usage

Developers can review the pre-smoke stable point from:

```text
docs/audit/pre-smoke-full-closure-registry-2026-06-07.md
docs/delivery/phase-pre-smoke-07-full-closure.md
```

Real project smoke should start only after reviewing this stable point and remaining risk notes.

## Modules

This phase ties together all Pre-Smoke 0-7 touched modules. The most important runtime areas are:

- TUI input/mouse/panel runtime.
- Memory extraction runtime.
- User-state signal runtime.
- Deferred/MCP executor truthfulness.
- State/error/concurrency runtime.
- Functional command ecosystem.
- Shared helper / shell debt cleanup.

## Key Design

- Verification is command-based and honest about local vs real smoke coverage.
- The stable commit is a repository checkpoint, not a Beta/open-source readiness claim.
- Skill/Plugin contributed tools remain fail-closed without a safe executor adapter.

## Config Items

No new final-stage config.

## Commands

Final validation commands:

```powershell
corepack pnpm exec vitest run packages/tui/src/index.test.ts --testTimeout 60000 --no-color
corepack pnpm exec vitest run packages/tui/src/phase-e-mainchain-coverage.test.ts --testTimeout 60000 --no-color
corepack pnpm test -- --no-color
corepack pnpm typecheck
corepack pnpm build
git diff --check
```

## Tests And Validation

Known PASS results before the final rerun:

- `packages/tui/src/index.test.ts`: PASS, 666/666.
- `packages/tui/src/phase-e-mainchain-coverage.test.ts`: PASS.
- Focused Pre-Smoke suites for input, memory, MCP/security, state/concurrency, functional/user-state: PASS.
- `corepack pnpm typecheck`: PASS.
- `corepack pnpm build`: PASS.
- Biome touched-file check: PASS.
- `git diff --check`: PASS before final doc updates.

Final full-suite result:

- `corepack pnpm test -- --no-color`: PASS, 94 test files passed, 3160 tests passed, 2 benchmark tests skipped.
- `corepack pnpm typecheck`: PASS.
- `corepack pnpm build`: PASS.
- `git diff --check`: PASS.

## Performance

The closure does not add new provider calls, background daemons, watchers, or full-repo index refreshes. New runtimes are local, bounded, and testable.

## Known Issues

- No external provider smoke or real project smoke was run in this phase.
- Manual terminal mouse/clipboard behavior can vary across Windows Terminal, legacy consoles, tmux, SSH, and installed clipboard utilities.
- Skill/Plugin executor lines are closed by truthful fail-closed behavior, not by enabling arbitrary third-party command execution.

## Out Of Scope

- Beta PASS.
- Open-source readiness PASS.
- Real old-project smoke.
- Real external provider quota/cache/billing verification.
- Third-party Skill/Plugin command execution adapters.

## Next Stage Handoff

Next user decision: start real project smoke from this stable point or request a targeted review. Do not automatically enter new roadmap phases.

## Developer Troubleshooting

- Full item status: pre-smoke registry.
- Validation failures: rerun the smallest focused suite named in the matching phase doc first, then full suite.
- Executor questions: start from `deferred-tools-catalog.ts`, `mcp-index-runtime.ts`, and `mcp-sse-runtime.ts`.
- Memory questions: start from `memory-extraction-runtime.ts` and `memory-command-runtime.ts`.

## Reference Check

Read all required Linghun docs listed by the user and the related completed phase docs. CCB/CCB Dev Boost were used only as behavior, boundary, permission, state-machine, and test-thinking references. No CCB suspicious source, private API, telemetry, or internal implementation was copied.

## Product Handoff Packet

- Next phase: user-chosen real project smoke or targeted review.
- Must not do: declare Beta/open-source ready, skip real smoke, run remote/deploy actions, or enable third-party executor paths without adapters.
- Evidence refs: registry, Pre-Smoke 00-07 docs, tests/validation ledger, stable commit.
- Validation: final commands listed above.
- Index status: no forced index rebuild/refresh during closure.
- Permission mode: local repository edits and validation only.
- Model/provider: Linghun runtime provider not smoke-tested; current coding session used local development tools.
- Budget: no explicit runtime budget; no real provider smoke cost.
