# Workspace Snapshot Helper / Workspace File Snapshot Runtime Research

## Scope

This is a read-only research report for whether Linghun should later add a Workspace Snapshot Helper or Workspace File Snapshot Runtime.

Boundary:

- No runtime code changes were made.
- This report does not enter Phase 15.5C/D/E/F.
- This report does not declare any phase complete.
- This report does not make Workspace Snapshot Helper a current blocker.
- This report does not copy CCB / Claude Code / OpenCode / third-party source.

## Executive verdict

Current Linghun does not need to insert a Workspace Snapshot Helper into the current mainline. The existing Workspace Reference Cache is already enough for the Phase 15.5A performance/context boundary: it caches small, invalidatable, rebuildable workspace references and keeps `/index status` on a fast path by default.

If a future real large-repo smoke shows startup latency, repeated file stat/hash work, repeated Grep/Glob full scans, or duplicated agent scans as a measurable bottleneck, the right next step is a TypeScript/Node bounded scanner plus lightweight cache. Native/binary is not justified now.

Recommended ownership: defer to post-smoke performance hardening. Treat Phase 17A as an optional consumer if multi-agent/job scheduling needs shared file metadata. Do not pull this into Phase 15.5C unless existing read-before-edit/index freshness becomes directly blocking in real smoke.

## Files read

Linghun required inputs:

- `F:\Linghun\START_NEXT_CHAT.md`
- `F:\Linghun\docs\delivery\pre-open-source-terminal-product-completion-gate.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\docs\delivery\phase-15-5a-performance-context.md`
- `F:\Linghun\docs\audit\phase-15-bundled-codebase-memory-lite.md`
- `F:\Linghun\packages\tui\src\workspace-reference-cache.ts`
- `F:\Linghun\packages\tui\src\workspace-reference-cache.test.ts`
- `F:\Linghun\packages\tui\src\index.ts`
- `F:\Linghun\packages\tools\src\index.ts`

CCB reference inputs:

- `F:\ccb-source\src\context.ts`
- `F:\ccb-source\src\utils\worktree.ts`
- `F:\ccb-source\src\utils\settings\changeDetector.ts`
- `F:\ccb-source\src\utils\plugins\zipCache.ts`
- `F:\ccb-source\src\services\mcp\client.ts`

## Current Linghun facts

### What Workspace Reference Cache stores today

`packages\tui\src\workspace-reference-cache.ts` stores a process-local `WorkspaceReferenceSnapshot` containing:

- `dimensions`: `configHash`, `toolSchemaHash`, `providerModelHash`, `mcpToolListHash`, `indexFreshnessHash`, `compactBoundaryHash`, `extensionListHash`.
- Watched file summaries: relative path, exists/readable, size, mtimeMs, bounded content hash.
- Watched directory summaries: relative path, readable flag, immediate file count, immediate directory count, entry hash.
- `runtimeStatus`: short local RuntimeStatus object passed by TUI.
- `toolCapabilitySummary`: truncated to 2,000 chars.
- `evidenceRefs` and `logRefs`: sanitized, truncated refs only.

Default watched files are intentionally narrow:

- `README.md`
- `package.json`
- `LINGHUN.md`
- `CLAUDE.md`
- `.linghun/settings.json`
- `.linghunignore`
- `.cbmignore`

Default watched directories are:

- `.`
- `.linghun`

The cache explicitly does not store full source, full transcript, full logs, full index results, secrets, or provider raw requests. The Phase 15.5A report confirms this boundary.

### Current invalidation behavior

Workspace Reference Cache invalidates on:

- File existence/readability/size/mtime changes.
- Bounded file content hash changes after a scan.
- Directory immediate entry count/hash changes.
- Runtime dimension hash changes:
  - config
  - built-in tool schema
  - provider/model
  - MCP tool list
  - index freshness
  - compact boundary
  - skills/workflows/hooks/plugins extension summary

The fast hit path first probes watched file stats and directory summaries. If stats and runtime dimensions match, it returns the previous snapshot as `source: "hit"` without running the injected full scan. If scan fails, it returns `source: "fallback"` and increments `cache.failures`.

Cache freshness in `packages\tui\src\index.ts` also tracks system prompt, tool schema, MCP tool list, provider/model, project rules, memory, compact boundary, plugin/extension list, and `workspaceReferenceHash`.

### Current cache/status/index integration

`/cache status` shows:

- cache history size
- latest cache hit rate and token fields
- compact status
- workspace reference hits/misses/failures/latest source
- freshness changed keys

`/cache warmup` and `/cache refresh` call `refreshWorkspaceReferenceCache(...)`, then update cache freshness. They do not call a provider and do not guarantee provider prompt-cache writes.

Before a model request, TUI:

- builds RuntimeStatus for the model
- optionally creates Architecture Runtime card
- refreshes Workspace Reference Cache
- builds model messages from recent transcript
- applies MicroCompact if needed

`/index status` defaults to a fast path:

- resolves/probes codebase-memory runtime
- calls `list_projects`
- calls `index_status`
- does not call `detect_changes`

`/index status --fresh`, `/index check`, and `/index doctor` run freshness/check paths. If `detect_changes` finds changed files, Linghun marks the index stale and suggests `/index refresh`; it does not automatically refresh.

### Current editing snapshot behavior

`packages\tools\src\index.ts` already has a separate per-tool read snapshot mechanism:

- `Read` records `ReadSnapshot` with path, hash, mtimeMs, and size.
- `Write`, `Edit`, and `MultiEdit` require either a prior read snapshot or `expectedHash`.
- If the file hash, mtimeMs, or size differs from the prior read snapshot, edit tools fail with a stale-file error.
- If `expectedHash` is provided and differs from current content hash, edit tools fail.
- Successful edits record `changedFiles`, patch summaries, read guard source, before/after hashes, newline style, and short diff details.

This means Linghun already has file-level safety for edit correctness. Workspace Snapshot Helper would mostly be a performance/shared-metadata feature, not a missing correctness gate for current read-before-edit.

### Current full-scan / repeated-work risk

Current Workspace Reference Cache itself does not repeatedly scan the whole repository. It watches a small fixed file list and two shallow directories by default. Its bounded file hash reads up to 256 KiB per watched file, but the implementation currently calls `readFile(...)` before slicing, so very large watched files could still be fully read if a watched file is unusually large.

Potential repeated-work areas outside Workspace Reference Cache:

- `Grep` and `Glob` in `packages\tools\src\index.ts` are simple recursive implementations and can walk/read many files when used directly.
- `safeReadText` reads matching files during Grep.
- `/index status --fresh` and `/index check` call external `detect_changes`, but default `/index status` avoids this.
- `buildModelMessagesWithRecentContext(...)` reads recent transcript from the session store and MicroCompacts locally; this is bounded by recent message count, not a full repo scan.

Therefore the immediate risk is not Workspace Reference Cache causing full-repo scans. The future risk is duplicated ad hoc scanning by search/context/agent workflows on large repos.

### Relation to codebase-memory fast status

Linghun uses codebase-memory as the code graph/index layer. Current codebase-memory runtime behavior:

- resolves env/config/managed/PATH binary candidates
- diagnoses binary source/status/version/artifact
- keeps `/index status` fast by default
- only runs `detect_changes` on explicit fresh/check/doctor paths
- degrades to missing/error without blocking normal chat

Workspace Reference Cache does not replace codebase-memory. It records a short `indexFreshnessHash` based on index project/status/nodes/edges/changedFiles/artifactStatus so model context and cache freshness can notice index-state changes without embedding full index results.

### Relation to `/index status`, Context Picker, Project Doctor, Architecture Runtime

Current implemented relation:

- `/index status` is the user-visible status and freshness control for codebase-memory.
- Workspace Reference Cache provides short workspace refs and index freshness hash for prompt/cache stability.
- Architecture Runtime facts are expected to come from project facts, README/package/config, index/evidence/tool results, and unknown/stale markers. It should not require a full workspace snapshot.

Planned or spec-level relation:

- Project Doctor Lite should produce short Project Facts from README/package/config/CI/project rules/Workspace Reference Cache/codebase-memory/tool evidence, not a full scan.
- Context Picker Lite should map natural language like "look at this module" or "look at the last error" to existing sources: changedFiles, diff, last verification, background logs, evidence refs, Workspace Reference Cache, codebase-memory refs, and Project Facts.
- Phase 17A multi-agent/job runtime should share Workspace Reference Cache, codebase-memory status, evidence refs, tool summaries, and project facts so agents do not independently rescan whole repos.

Workspace Snapshot Helper could become an implementation detail for Project Doctor/Context Picker/Phase 17A sharing, but it is not required to unblock current `/index status` or editing safety.

## CCB / reference behavior facts

CCB reference behavior suggests mature boundaries, not a requirement for a native snapshot binary.

Observed patterns:

- `context.ts` memoizes system/user context for the session. Git status is a startup snapshot, truncated, and explicitly described as not updating during the conversation.
- `context.ts` clears memoized context only when a cache-breaker/system prompt injection changes.
- `worktree.ts` avoids expensive git work when possible: it reads worktree head directly for fast resume, skips fetch when local refs are available, and avoids unnecessary subprocesses.
- `worktree.ts` uses `git ls-files --others --ignored --exclude-standard --directory` to collapse fully ignored directories, avoiding full expansion of large ignored trees. It only expands collapsed directories when patterns require it.
- `worktree.ts` cleanup paths are fail-closed: skip deletion if git status fails, tracked changes exist, or unpushed commits are present.
- `changeDetector.ts` uses chokidar for a narrow settings watch with `depth: 0`, await-write-finish, internal-write suppression, delete grace, and centralized cache invalidation.
- `zipCache.ts` uses session-local extracted plugin cache, atomic writes, zip archives, symlink-cycle protection, and careful Windows inode handling. This is plugin/package caching, not workspace source snapshotting.
- `mcp/client.ts` memoizes MCP connections and fetched tools/resources with bounded caches, clears caches on reconnect/session expiry, stabilizes descriptions/input schemas, truncates long descriptions, and persists large MCP outputs to files instead of pushing them into model context.

Reference conclusion:

- Mature tools favor bounded snapshots, memoization, stable summaries, explicit invalidation, and large-output persistence.
- They avoid repeated expensive work by reducing scope, using git/index primitives, and caching connection/schema metadata.
- The inspected reference files do not establish a need for a native workspace snapshot binary in Linghun now.

## Gap table

| Area | Current Linghun fact | Gap | Severity | Recommendation |
| --- | --- | --- | --- | --- |
| Workspace Reference Cache scope | Bounded, process-local, small watched file list and shallow dirs | Not a full file stat cache; not persistent across process restarts | P2 / future | Accept for now. Future helper can persist bounded metadata only if real smoke shows repeated startup/scanning cost. |
| Watched file hashing | Bounded hash size is intended, but implementation reads full file before slicing | A very large watched file could be fully read | P2 | If fixing later, use `open/read` bounded bytes in TS/Node. This does not require native. |
| Directory summary | Immediate child count/hash only | Cannot answer "what files changed under src" | P2 / future | Future helper may add bounded recursive scan with ignore rules, depth/file limits, and git-aware changed file list. |
| Grep/Glob | Simple recursive implementation can walk/read many files | Large repos may pay repeated scans | P2 / performance | Prefer `rg` or bounded scanner/cache later. Do not change current runtime unless smoke proves a bottleneck. |
| Index freshness | `/index status` fast; explicit fresh/check runs `detect_changes` | Freshness may be unknown until explicit check | Accepted design | Keep fast default. Do not auto-refresh or make status slow. |
| Editing correctness | Read snapshot + expectedHash + stale detection already exist | Snapshot metadata is local to tool context, not shared globally | Low | Enough for current editing safety. Global helper is not needed for correctness. |
| Project Doctor Lite | Spec expects facts from README/package/config/CI/cache/index/evidence | Not fully implemented as a separate doctor fact store in current evidence reviewed | Phase 15.5F scope | If implemented later, reuse WRC + codebase-memory; do not create full repo scanner as first step. |
| Context Picker Lite | Spec expects selecting existing refs/summaries | No evidence of dedicated picker runtime in current files | Phase 15.5F scope | Future picker should use refs and targeted reads, not full source snapshots. |
| Architecture Runtime facts | Current chain can use local facts/index/evidence; no need for full source | Fact collection may remain shallow without Project Doctor | P2 / later | Add targeted fact collector first, backed by cache refs; no native. |
| Multi-agent sharing | Spec requires shared cache/index/evidence in Phase 17A | Current WRC is process-local and minimal | Future 17A optional | Add shared TS metadata cache only if agents duplicate scan work. |
| Native/binary | No measured Node scanner bottleneck found | Native would add packaging, Windows, license, and release risk | High cost, no current benefit | Do not build native now. Gate it on real benchmark failure. |

## Native/binary necessity verdict

Native/binary is not necessary now.

TS/Node is sufficient for the foreseeable minimal design because the useful work is mostly:

- bounded `stat` calls
- shallow directory summaries
- hash of small file prefixes
- stable JSON summaries
- ignore-rule filtering
- optional git-aware changed-file discovery
- in-process or small on-disk cache

None of the current required behaviors need native filesystem APIs. Current Phase 15.5A already passes with TypeScript code and focused tests.

Native/binary should only be reconsidered if all of these are true:

- Real large-repo smoke or benchmark proves Node scanning is a top startup or per-turn bottleneck after ignore rules and bounded scanning.
- The bottleneck remains after using `rg`, git status/ls-files, codebase-memory fast status, and persistent TS cache.
- The target workload involves hundreds of thousands of files where Node stat/readdir overhead materially blocks TUI startup or model request preparation.
- The team is ready to absorb cross-platform packaging, Windows code signing/AV friction, crash diagnostics, release rollback, and license/NOTICE work.

Until then, native/binary is NOT-DO.

## Future Workspace Snapshot Helper: real problem to solve

If built later, it should solve measured performance and freshness problems:

- Avoid repeated repo-wide file enumeration by Grep/Glob/Project Doctor/Context Picker/agents.
- Reuse file stat/hash metadata across `/doctor`, `/index status --fresh`, context picking, and agent/job handoff.
- Provide a cheap "what changed since last snapshot" summary for local files, without reading full file contents.
- Keep model context small by passing refs/summaries, not full source.
- Improve large-project startup by loading a small cached summary before doing any optional deeper scan.
- Support Phase 17A sharing so multiple agents/jobs do not independently rescan the same workspace.

It should not solve indexing. codebase-memory remains the graph/code index layer.

## Recommended minimal design

Only consider this after real smoke or performance hardening identifies a bottleneck.

Minimal TS/Node design:

- Add a small `WorkspaceFileSnapshot` data shape:
  - relative path
  - kind: file/directory/symlink/other
  - size
  - mtimeMs
  - optional mode
  - optional bounded hash for selected files only
  - ignored reason/category when skipped
- Add a `WorkspaceSnapshotSummary`:
  - project root hash
  - scan root list
  - ignore sources used
  - file/dir counts
  - changed/added/deleted counts since previous snapshot
  - top-level directory summary
  - risky large files summary
  - generated/vendor directories skipped
  - cache version and createdAt
- Use existing ignore boundaries first:
  - `.linghunignore`
  - `.cbmignore`
  - `.gitignore` or git tracked files when available
  - hard skips for `.git`, `node_modules`, build outputs, caches, large generated files
- Keep default scan bounded:
  - max files
  - max depth
  - max wall time
  - max per-file hash bytes
  - max total hash bytes
  - max stored entries
- Prefer git/rg primitives:
  - `git status --porcelain -uno` or equivalent for changed tracked files
  - `git ls-files` for tracked candidate set
  - `rg --files` when available for ignore-aware file listing
  - fallback to Node `readdir` with limits
- Store only metadata under `.linghun/cache/` or configured cache path.
- Version the cache schema and invalidate on:
  - cache schema version
  - project root
  - ignore file hashes
  - config hash
  - tool schema hash only if tool consumers change
  - provider/model only if prompt freshness consumes it, not for raw file metadata
  - index freshness if summary embeds index state
  - compact boundary only in prompt/cache freshness, not file metadata
- Expose it through existing surfaces:
  - `/cache status`: summary only
  - `/doctor`: project facts only
  - `/index status`: optional freshness relation, no auto-refresh
  - Context Picker: refs and short summaries
  - Architecture Runtime: short project facts, unknown/stale when absent
  - Phase 17A: shared refs for agents/jobs

Implementation should be a helper behind existing cache/status/context paths, not a new user-visible product area.

## Not-do list

Do not:

- Build native/binary now.
- Replace codebase-memory.
- Build a second indexing engine.
- Cache full source files.
- Cache full transcript, full logs, full tool outputs, raw index graphs, provider raw requests, API keys, tokens, or private headers.
- Auto-run full repository scans on every prompt.
- Make `/index status` run `detect_changes` by default.
- Auto-refresh or auto-rebuild index after detecting changes.
- Add file watchers for the whole repo by default.
- Add long-running background snapshot jobs before Local Resource Guard / job lifecycle is ready.
- Make Workspace Snapshot Helper a Phase 15.5C blocker without real evidence.
- Expand Project Doctor or Context Picker into an onboarding wizard or LSP replacement.
- Store dynamic timestamps/access counts in prompt freshness hashes.
- Let multiple agents/jobs build independent private snapshots.

## Stage ownership recommendation

Recommended current status: do not implement now.

Best future stage:

- Primary: post-smoke performance hardening, if real large projects show repeated scanning/stat/hash overhead.
- Secondary: Phase 17A optional support, if local durable jobs or multi-agent scheduling needs shared workspace metadata to prevent duplicated scans.
- Not recommended for Phase 15.5C: current read-before-edit, expectedHash, stale file, changedFiles, and patch summaries already exist and do not need a global snapshot helper.
- Not recommended for Phase 15.5F unless Project Doctor Lite / Context Picker Lite cannot meet latency targets using existing Workspace Reference Cache, codebase-memory refs, and targeted reads.
- Native/binary: NOT-DO unless benchmark conditions in the native verdict are met.

This should not be registered as a current blocker. Existing workspace reference cache / index freshness does not appear to directly block 15.5C or real smoke pre-acceptance based on the files reviewed.

## Risks

- False confidence risk: A shallow Workspace Reference Cache can say cache is fresh while code under `src/` changed. This is acceptable today because it is not a full file snapshot and `/index status --fresh` remains explicit.
- Large watched-file risk: watched files are intended to be bounded-hashed, but the current implementation reads the whole file before slicing.
- Grep/Glob large-repo risk: current recursive search can be expensive on very large repos.
- Persistent cache risk: if added later, stale cache bugs can mislead Project Doctor/Context Picker unless every summary carries source, createdAt, root, schema version, and stale/unknown markers.
- Watcher risk: whole-repo watchers are fragile on Windows, network drives, generated directories, and large monorepos.
- Product-scope risk: a snapshot helper can easily drift into a second code index, LSP, or file database. Keep it as metadata and refs only.
- Security risk: file metadata can still reveal private filenames. Keep output summary-first and respect ignore rules.

## Validation suggestions

If this is considered later, run focused tests before any runtime rollout:

- Cache hit: second snapshot does not repeat full scan when watched stats/dimensions are unchanged.
- Invalidation: file size/mtime/hash changes, ignore file changes, config changes, tool schema changes, provider/model changes, MCP list changes, index freshness changes, compact boundary changes, and extension list changes produce stable changed keys.
- Bounded read: a huge watched file only reads/hash-bounds the configured prefix, not the whole file.
- Directory summary: added/deleted immediate entries change directory hash without storing contents.
- Ignore behavior: `.git`, `node_modules`, build outputs, `.linghunignore`, `.cbmignore`, and `.gitignore` are respected.
- Git/rg fast path: uses tracked/ignore-aware listing when available and falls back cleanly when git/rg are unavailable.
- Time budget: scan stops at file/time/hash limits and returns partial/stale summary, not a blocking failure.
- Persistence: corrupted cache file is ignored and rebuilt; schema-version mismatch invalidates.
- Security: no full source, secrets, raw logs, raw index result, provider request, token, or private header appears in cache/status/doctor output.
- `/index status`: default remains fast and does not run `detect_changes`.
- Context Picker: uses refs/short summaries and performs targeted reads only.
- Project Doctor: facts are marked unknown/stale when cache/index evidence is missing.
- Multi-agent: two agents/jobs share snapshot refs rather than independently scanning the same repo.

Suggested benchmark gates:

- Cold startup with no cache.
- Warm startup with persisted metadata cache.
- First `/doctor`.
- `/cache status`.
- `/index status`.
- Context Picker request for a module.
- Two concurrent agent/job context preparations.
- Large repo with ignored `node_modules`/generated directories.
- Windows path and Chinese path smoke.

Acceptance criteria if implemented later:

- No visible regression in normal TUI startup.
- Warm snapshot lookup is materially faster than repeated ad hoc scans on a real large repo.
- Default behavior remains bounded and summary-first.
- Cache miss/failure degrades to existing read/index paths.
- No new native/binary dependency unless benchmark evidence proves TS/Node is insufficient.
