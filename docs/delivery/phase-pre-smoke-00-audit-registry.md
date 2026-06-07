# Phase Pre-Smoke 00 - Audit Registry And Document Correction

## Stage Goal

Pre-Smoke 00 turns the 2026-06-07 full-line audit, roadmap leftovers, document false positives, and user smoke blockers into one executable closure registry before any real project smoke.

## Completed Functions

- Created the closed registry at `docs/audit/pre-smoke-full-closure-registry-2026-06-07.md`.
- Imported high/mid/low audit items, P0 user issues, memory/user-state requirements, executor requirements, document false positives, and historical A-G roadmap leftovers.
- Corrected overbroad audit statements: provider-client exists, CommandPanel does not own `useInput`, deferred tools are split by executable reality, mock/model setup findings are narrowed to real source facts.
- Updated roadmap/audit/README delivery status to point at the Pre-Smoke 00-07 closure docs.

## Usage

Developers should start future pre-smoke review from:

```text
docs/audit/pre-smoke-full-closure-registry-2026-06-07.md
docs/delivery/phase-pre-smoke-00-audit-registry.md
```

Use the registry status vocabulary only as recorded there: `FIXED`, `NOT-ISSUE`, `MERGED-INTO`, `BLOCKED-BY-USER`.

## Modules

- `docs/audit/pre-smoke-full-closure-registry-2026-06-07.md`
- `docs/audit/FULL_LINE_AUDIT_2026-06-07.md`
- `LINGHUN_DEVELOPMENT_ROADMAP.md`
- `docs/delivery/README.md`

## Key Design

- Registry status is source-level, not narrative-only.
- `NOT-ISSUE` requires direct source evidence.
- Skill/Plugin execution is judged separately from MCP execution.
- Historical A-G items are not re-opened unless a concrete source-level regression appears.

## Config Items

No runtime config was added.

## Commands

No user-facing Linghun command was added. Developer verification command:

```powershell
rg -n "unclosed|planned / execution entry|not completed" docs/audit/pre-smoke-full-closure-registry-2026-06-07.md docs/delivery/phase-pre-smoke-*.md docs/delivery/README.md
```

## Tests And Validation

- Registry is validated by document scan after all Pre-Smoke docs are written.
- Source evidence is tied to focused tests listed in each later Pre-Smoke phase doc.

## Performance

No runtime impact; this phase changes documentation and audit routing only.

## Known Issues

No open audit registry item remains. Real project smoke has not run in this phase.

## Out Of Scope

- Real provider smoke.
- Real project smoke.
- New runtime functionality beyond the registry/document correction surface.

## Next Stage Handoff

Next stage is Pre-Smoke 01 TUI input/panel closure. It must use source files and tests referenced by T0.1-T0.5 in the registry.

## Developer Troubleshooting

- If a future audit item appears missing, add it to the registry before implementing.
- If a report claim is source-proven false, mark it `NOT-ISSUE` with exact file evidence instead of deleting history.

## Reference Check

Linghun docs read: `AGENTS.md`, `LINGHUN_DEVELOPMENT_ROADMAP.md`, `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`, `LINGHUN_IMPLEMENTATION_SPEC.md`, `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`, `docs/audit/FULL_LINE_AUDIT_2026-06-07.md`, `docs/delivery/README.md`, and related completed delivery docs.

CCB/CCB Dev Boost were used only as behavior and audit-boundary references through existing reports. No CCB source, internal API, telemetry, or suspicious implementation was copied.

## Product Handoff Packet

- Next phase: Pre-Smoke 01.
- Must not do: start real smoke, skip registry, hide document false positives, or claim open-source readiness.
- Evidence refs: closed registry and updated audit/roadmap/README.
- Validation: final document scan in Pre-Smoke 07.
- Index status: codebase-memory not required; `rg`/source reads were sufficient.
- Permission mode: local repository edits only.
- Model/provider: provider-agnostic documentation closure.
- Budget: no runtime provider calls.
