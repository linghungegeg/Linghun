# Phase Pre-Smoke 02 - Automatic Memory Runtime Closure

## Stage Goal

Replace fixed phrase/regex learning with a controlled memory extraction runtime that can create, update, no-op, persist, forget, disable, and rollback long-term memory inside Linghun memory directories only.

## Completed Functions

- Added `memory-extraction-runtime.ts` with taxonomy `user / feedback / project / reference`.
- Added no-save filtering for secrets, code structure, git history, temporary tasks, debug recipes, existing rules, full logs, full indexes, and full transcripts.
- Implemented extraction decisions: `create`, `update`, `no-op`.
- Wrote project/user accepted memories to dedicated topic markdown files and `MEMORY.md` manifest.
- Updated `/memory` lifecycle to support accept/reject/disable/rollback/delete/forget and cache freshness refresh.
- Kept uncertain content candidate-only and prompt injection accepted-only/topK.

## Usage

```text
/memory
/memory review
/memory stats
/memory learn on|off|status
/memory candidate <summary> [--scope project|user|session]
/memory accept <id>
/memory reject <id>
/memory disable <id>
/memory rollback <id>
/memory delete <id>
/memory forget <id>
```

Stable taxonomy facts can be auto-accepted by the extraction runtime. Uncertain content remains candidate-only. Deleting or disabling a memory removes it from prompt injection.

## Modules

- `packages/tui/src/memory-extraction-runtime.ts`
- `packages/tui/src/memory-command-runtime.ts`
- `packages/tui/src/tui-memory-runtime.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/tui-data-types.ts`
- `packages/tui/src/runtime-utils.ts`

## Key Design

- Extraction is runtime-driven and evidence-bound; fixed phrases are not the maturity path.
- Persistent writes are limited to Linghun memory directories.
- `MEMORY.md` is a short manifest, not a transcript dump.
- Existing ordinary Write/Edit permissions are not loosened by memory auto-write.

## Config Items

No new required config. Existing storage/memory paths remain the source of project/user/session memory locations.

## Commands

See Usage. No external command or provider call is required.

## Tests And Validation

Focused coverage:

```powershell
corepack pnpm exec vitest run packages/tui/src/memory-extraction-runtime.test.ts packages/tui/src/memory-command-runtime.test.ts --no-color
```

Regression coverage also exists in `packages/tui/src/index.test.ts` for prompt injection and memory command boundaries.

## Performance

Extraction is deterministic and local in this closure. Manifest/topic writes are small markdown files. Prompt injection remains accepted-only and topK-bounded.

## Known Issues

This is a local controlled extraction runtime, not a semantic LLM summarizer. It intentionally prefers no-op/candidate when confidence or long-term value is insufficient.

## Out Of Scope

- Full semantic LLM memory scorer.
- Automatic skill generation or marketplace.
- Writing `LINGHUN.md` silently.
- Storing raw transcript/log/index dumps.

## Next Stage Handoff

Pre-Smoke 03 executor closure can proceed with memory writes constrained to the dedicated runtime and no hidden permission relaxation.

## Developer Troubleshooting

- Extraction decisions: `decideMemoryExtraction()`.
- Manifest/topic writes: `writeAutoMemoryFiles()` and `refreshAutoMemoryFiles()`.
- Command lifecycle: `executeMemoryMutation()`.
- Prompt injection: `createControlledMemoryInjection()`.

## Reference Check

Read Linghun blueprint/spec/roadmap, full audit, Phase 16 controlled learning report, and memory runtime source/tests. CCB was only referenced for product behavior: automatic but narrow memory, manifest/topic organization, and reversible lifecycle. No CCB source was copied.

## Product Handoff Packet

- Next phase: Pre-Smoke 03.
- Must not do: save secrets/logs/transcripts, silently edit project rules, or bypass ordinary Write/Edit permissions.
- Evidence refs: memory extraction and command tests.
- Validation: focused memory tests plus final suite/build/typecheck.
- Index status: not required.
- Permission mode: unchanged; memory runtime only writes its own memory dirs.
- Model/provider: no provider call required.
- Budget: no extra runtime model cost.
