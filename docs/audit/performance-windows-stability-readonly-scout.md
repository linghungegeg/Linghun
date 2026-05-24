# Performance & Windows Stability Hardening Gate Read-Only Scout

## Scout Boundary

本报告是 **Performance & Windows Stability Hardening Gate Read-Only Scout**，只做只读侦察和正式 gate 方案设计。

本轮明确边界：

- 本轮只读侦察；除新增本报告外，未改任何 runtime 代码。
- 未创建新源码文件。
- 未运行 formatter。
- 未运行全量 test / build / check。
- 未运行 benchmark。
- 未做 G 盘压测。
- 未启动 native runner。
- 未启动真实 provider / live API。
- 未进入正式 Performance Gate。
- 未进入 Polish D、Phase 18 或 real smoke。
- 未宣布 Beta PASS / smoke-ready / open-source-ready。
- 下一步必须等待 Polish D 完成后，由用户确认是否进入正式 Performance & Windows Stability Hardening Gate。

开工只读状态：

```text
git status --short
 M docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md
```

`docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md` 是开工前已有 diff，本 scout 未触碰。

codebase-memory 索引状态：

```json
{"project":"F-Linghun","nodes":1913,"edges":4015,"status":"ready"}
```

索引可用；本轮先查索引状态与架构摘要，再用只读源码/报告检查确认。部分 `search_code` 模式搜索无结果时，按仓库规则降级为本地精读和只读搜索。

## Documents Read

本轮按要求读取 / 定向读取了：

- `START_NEXT_CHAT.md`
- `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- `docs/delivery/pre-smoke-tui-polish-a-natural-intent-command-surface.md`
- `docs/delivery/pre-smoke-tui-polish-b-interactive-controls-permission-workspace-trust.md`
- `docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md`
- `docs/audit/reference-map.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`（定向读取开局、TUI/output、权限、Start Gate、NCB、后台任务相关段落）
- `LINGHUN_IMPLEMENTATION_SPEC.md`（定向读取输出层、BackgroundTask、Natural Command Bridge、provider / tool / Windows 相关规格）
- `docs/delivery/phase-15-5a-performance-context.md`
- `docs/delivery/phase-15-5b-resource-task-lifecycle.md`
- `docs/delivery/phase-15-5c-editing-tool-ux.md`
- `docs/delivery/phase-15-5c-plus-log-artifact-runtime-lite.md`
- `docs/delivery/phase-15-5c-plus-plus-workspace-snapshot-lite.md`
- `docs/delivery/phase-17c-native-runner-job-supervisor-gate.md`

## Current Implementation Map

### 1. Workspace Snapshot / Workspace Reference Cache

Current files / functions:

- `packages/tui/src/workspace-reference-cache.ts`
  - `getWorkspaceReferenceSnapshot()`
  - `createWorkspaceReferenceCache()`
  - `workspaceReferenceHash()`
  - `scanWorkspaceReference()`
  - `probeWorkspaceReference()`
  - `summarizeFile()`
  - `summarizeDirectory()`
  - `summarizeWorkspaceSnapshotLite()`
  - `readIgnoreSources()`
  - `diffWorkspaceReference()`
  - `diffWorkspaceSnapshotLite()`
  - `readFilePrefix()`
- `packages/tui/src/index.ts`
  - `refreshWorkspaceReferenceCache()`
  - `createWorkspaceReferenceDimensions()`
  - `formatCacheStatus()`
  - `/cache warmup|refresh|status` handling

Existing protections:

- In-memory latest snapshot cache with `hits` / `misses` / `failures`.
- Invalidation dimensions already include config hash, tool schema hash, provider/model hash, MCP tool list hash, index freshness hash, compact boundary hash, extension list hash.
- Watched file hash uses bounded prefix read through `open/read`, default 256 KiB.
- Workspace Snapshot Lite is metadata-only and top-level only; default stored entry limit is bounded.
- Ignore sources are bounded prefix reads of `.linghunignore`, `.cbmignore`, `.gitignore`.
- Hard-skip set includes high-cost dirs such as `.git`, `node_modules`, `dist`, `build`, cache dirs.
- Deterministic hashing uses stable object key sorting.
- Directory summaries and snapshot entries are stable ordered.
- Failure fallback returns `source: "fallback"`, `changedKeys: ["workspaceReferenceUnavailable"]`, and can preserve previous bounded metadata.

Focused coverage / reports:

- `packages/tui/src/workspace-reference-cache.test.ts`
- `docs/delivery/phase-15-5a-performance-context.md`
- `docs/delivery/phase-15-5c-plus-plus-workspace-snapshot-lite.md`

Hot-path notes:

- `/cache warmup|refresh` and provider-request preflight refresh are the main hot paths.
- Top-level `opendir` + per-entry `lstat` are bounded but sequential.
- One inaccessible top-level entry can currently push the whole snapshot into fallback if not locally caught.

### 2. Compact Context

Current files / functions:

- `packages/tui/src/compact-context.ts`
  - `microCompactMessages()`
  - `createManualCompactBoundary()`
  - `compactBoundaryHash()`
  - `estimateModelMessagesChars()`
  - `groupMessagesWithoutSplittingToolPairs()`
  - `collectEvidenceRefs()`
  - `collectFileRefs()`
  - `sanitizeRefs()`
- `packages/tui/src/index.ts`
  - `/compact status|manual|auto` handling
  - `estimateTranscriptContextChars()`
  - provider-message construction paths that fold compact boundary into workspace/cache freshness

Existing protections:

- MicroCompact is local-only; it does not execute tools, write project files, write long-term memory, or start background jobs.
- Tool call / tool result pairs are grouped so compacting does not create invalid provider message sequences.
- Incomplete tool groups are dropped rather than partially retained.
- Evidence refs and file refs are truncated and capped.
- Manual compact creates a `CompactBoundary` with bounded estimates and refs.
- Boundary hash uses stable object hashing.

Focused coverage / reports:

- `packages/tui/src/compact-context.test.ts`
- `docs/delivery/phase-15-5a-performance-context.md`

Hot-path notes:

- Provider request message construction is the primary hot path.
- `estimateTranscriptContextChars()` and manual compact can become expensive if transcript hydration grows without bounded indexes.

### 3. Log Artifact Tail / Grep / Errors

Current files / functions:

- `packages/tui/src/log-artifact.ts`
  - `readLogArtifactSlice()`
  - `formatLogArtifactSlice()`
  - `resolveLogArtifactPath()`
  - `ensureAllowedPath()`
  - `ensureEvidenceSourceArtifactPath()`
  - `readTail()`
  - `readGrep()`
  - `readErrors()`
  - `countLineBreaksBeforeOffset()`
  - `preventCompleteLineDump()`
  - `preventCompleteNumberedLineDump()`
  - `redactLogContent()`
- `packages/tui/src/index.ts`
  - `handleDetailsCommand()`
  - `parseLogArtifactRequest()`
  - `createLogArtifactRegistry()`
  - `/details output <id> --tail|--grep|--errors`

Existing protections:

- Reads only known background / evidence artifacts, not arbitrary user paths.
- Tail is bounded by lines and bytes; default 40 lines, max 200 lines, default tail byte window 64 KiB.
- Grep/errors are bounded by scan bytes, max matches, max output lines, context lines, and timeout.
- Grep pattern is literal, not arbitrary regex.
- Small artifacts that would be fully dumped are conservatively withheld/truncated.
- Redaction covers Authorization, Cookie, Bearer, `sk-*`, api key/token/cookie patterns.
- Absolute private paths are redacted unless safe relative log refs can be shown.
- Error extraction is explicitly candidate-only and does not alter verification verdict semantics.

Focused coverage / reports:

- `packages/tui/src/log-artifact.test.ts`
- `docs/delivery/phase-15-5c-plus-log-artifact-runtime-lite.md`

Hot-path notes:

- `readTail()` is bounded and likely acceptable.
- `readGrep()` / `readErrors()` are bounded to a tail scan window.
- `countLineBreaksBeforeOffset()` can still stream from byte 0 to tail offset for line-number calculation; this is the strongest algorithmic watchpoint in the current log artifact runtime.

### 4. Transcript / Evidence JSONL Read / Write / Query

Current files / functions:

- `packages/core/src/jsonl.ts`
  - `appendJsonl()`
  - `readJsonl()`
- `packages/core/src/session-store.ts`
  - `SessionStore.create()`
  - `SessionStore.list()`
  - `SessionStore.resume()`
  - `SessionStore.appendEvent()`
  - `SessionStore.updateSummary()`
  - metadata read/write helpers
- `packages/core/src/session.ts`
  - `TranscriptEvent` union
- `packages/tui/src/index.ts`
  - resume hydration
  - evidence record append paths
  - handoff packet append paths
  - `findEvidence()`
  - `/details evidence` / `/details output` lookup paths

Existing protections:

- JSONL append is simple append-only.
- Missing JSONL file returns empty records.
- Broken JSONL lines are skipped with diagnostics while valid lines are preserved.
- Session list sorts by `updatedAt` descending.
- Resume hydration bounds evidence imported from transcript to recent records and context caps.
- Evidence records are mostly transcript events and queried by id / suffix in TUI context.

Focused coverage / reports:

- `packages/core/src/jsonl.test.ts`
- `packages/core/src/session-store.test.ts`
- `docs/delivery/phase-02-session-transcript.md`

Hot-path notes:

- `readJsonl()` reads the full file into memory and splits all lines. This is acceptable for small sessions but is a likely large-session resume hot path.
- `SessionStore.list()` reads metadata for every session; large session counts can become a startup/list latency path.
- No offset index exists for transcript/evidence queries.

### 5. Doctor / Status / Problems Rendering

Current files / functions:

- `packages/tui/src/index.ts`
  - `handleSlashCommand()` for `/doctor`, `/problems`, `/status`
  - `handleDoctorCommand()`
  - `createTerminalReadinessView()`
- `packages/tui/src/terminal-readiness-presenter.ts`
  - `formatTerminalReadinessDoctor()`
  - `formatTerminalReadinessStatus()`
  - `formatTerminalProblemsPanel()`
  - `createReadinessItems()`
- `packages/tui/src/runtime-status-presenter.ts`
  - `formatRuntimeStatusLine()`
- `packages/tui/src/job-runner-presenter.ts`
  - `formatRunnerDoctor()`

Existing protections:

- `/doctor` default is summary-only; `/doctor all|details|checklist|project|report` expands full view.
- `/problems` caps to 8 visible items.
- Runtime status line truncates long status components and the full line.
- Presenter output redacts secrets and sensitive path-like content for primary display.
- Readiness item order is static and stable.
- Current doctor/status mostly rebuilds from current context; no separate doctor cache was found.

Focused coverage / reports:

- `packages/tui/src/index.test.ts`
- `packages/tui/src/runtime-status-presenter.test.ts`
- `packages/tui/src/job-runner-presenter.test.ts`
- `docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md`

Hot-path notes:

- `createTerminalReadinessView()` aggregates several lite facts. If future collectors perform filesystem scans or large JSON reads, `/status` and `/doctor` can become foreground-latency sensitive.

### 6. Tool Output Formatting / Long Output Summary

Current files / functions:

- `packages/tui/src/tool-output-presenter.ts`
  - `createLayeredToolOutput()`
  - `formatToolOutput()`
  - `createToolOutputPreview()`
  - `createSummaryFirstPreview()`
  - `looksLikeMojibake()`
- `packages/tools/src/index.ts`
  - Bash output capture / `fullOutputPath`
  - `createPatchSummary()`
  - `ensureReadBeforeEdit()`
  - Read / Write / Edit / MultiEdit / Diff output metadata
- `packages/tui/src/index.ts`
  - `/details output`

Existing protections:

- Read, Glob, Grep, Bash, Write, Edit, MultiEdit are summary-first in TUI presenter.
- Todo primary output is capped.
- Long output points to details / fullOutputPath.
- Bash writes full output to `.linghun/logs/tools/bash-*.log` and returns preview.
- Editing output carries changedFiles / patch stats / read guard / before-after hash metadata.

Focused coverage / reports:

- Embedded in `packages/tui/src/index.test.ts`
- `packages/tools/src/index.test.ts`
- `docs/delivery/phase-15-5c-editing-tool-ux.md`
- `docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md`

Hot-path notes:

- `createSummaryFirstPreview()` and mojibake detection operate on already-materialized output text. Summary-first protects the main screen, but upstream memory pressure may already have happened for huge outputs.
- Bash writes full output after the subprocess completes; long-running huge output can still accumulate in process memory before writing unless upstream collection is bounded or streaming to artifact.

### 7. Provider Stream Parser / Model Gateway Parser

Current files / functions:

- `packages/providers/src/index.ts`
  - `ModelGateway.stream()`
  - `OpenAiCompatibleProvider.stream()`
  - `resolveProviderRuntimeContract()`
  - `fetchWithProviderRetry()`
  - `fetchWithRequestTimeout()`
  - `withStreamIdleTimeout()`
  - `parseOpenAiStreamLine()`
  - `parseResponsesEvent()`
  - `parseOpenAiToolCalls()`

Existing protections:

- Request timeout is bounded.
- Stream idle timeout is bounded.
- Retry policy is limited and applies to 429 / selected 5xx statuses.
- Compatibility profiles distinguish strict/permissive chat, DeepSeek, and OpenAI Responses.
- Parser supports chat deltas, reasoning deltas, streaming tool call assembly, usage/cache fields, Responses API events, and pending tool call error paths.
- Provider unsupported tools path avoids sending tools/toolChoice.

Focused coverage / reports:

- `packages/providers/src/index.test.ts`
- `docs/delivery/phase-15-5e-provider-freshness.md` exists as a relevant historical delivery report, though not required in this scout read list.

Hot-path notes:

- SSE parsing performs chunk decode, string-buffer accumulation, newline split, JSON parse per line.
- Streaming tool call argument assembly can grow with large arguments.
- Error bodies are read as full `response.text()` without an explicit byte cap.
- Abort/timeout behavior should be benchmarked and inspected for resource release, especially on Windows.

### 8. Job / Background / Report Refresh

Current files / functions:

- `packages/tui/src/index.ts`
  - `transitionDurableJob()`
  - `hydrateDurableJobBackgroundTasks()`
  - `recoverDurableJobForContext()`
  - `runDurableJobLiteTick()`
  - `persistDurableJobProgress()`
  - `applyDurableJobBudgetStop()`
  - `upsertJobBackgroundTask()`
  - `createJobBackgroundTask()`
  - `persistDurableJob()`
  - `appendJobLog()`
  - `writeDurableJobReport()`
  - `listDurableJobs()`
  - `readDurableJobState()`
  - `refreshBackgroundLifecycle()`
- `packages/tui/src/job-runner-presenter.ts`
  - `formatJobRunnerInline()`
  - `formatJobRunnerReportLine()`
  - `mapDurableJobToBackgroundStatus()`
  - `mapDurableJobToBackgroundResult()`
  - `formatBackgroundDetails()`
  - `formatBackgroundOutputDetails()`
  - `formatBackgroundTask()`

Existing protections:

- Background task list is capped.
- Durable job max steps and agent counts are bounded.
- Stale / timeout / cancelled / blocked / failed states are conservative and do not become PASS evidence.
- Job logs and reports point to artifacts rather than dumping complete logs into the main screen.
- Native runner summary is visible but does not alter verification PASS semantics.

Focused coverage / reports:

- `packages/tui/src/index.test.ts`
- `packages/tui/src/job-runner-presenter.test.ts`
- `docs/delivery/phase-15-5b-resource-task-lifecycle.md`
- `docs/delivery/phase-17c-native-runner-job-supervisor-gate.md`

Hot-path notes:

- `writeDurableJobReport()` rewrites the whole report on transitions/progress.
- `appendJobLog()` appends both job log and full output log for events.
- `listDurableJobs()` scans all job dirs and parses every `state.json`; this can become a large-job-count hot path.
- Some log-tail display paths read whole log files before slicing; this should be benchmarked before changing.

### 9. Resource Guard / Concurrency Cap

Current files / functions:

- `packages/tui/src/index.ts`
  - `checkResourceGuard()`
  - `checkBackgroundStartGuard()`
  - background global / per-kind caps
  - durable job start/resume guard paths

Existing protections:

- Foreground model cap is one active request.
- Background global cap is bounded.
- Kind caps exist for bash, verification, index, agent, job.
- Heavy task mutual exclusion avoids silent over-parallelism.
- Job running agents default cap is conservative; high-config 8-agent target remains a benchmark candidate, not default.

Focused coverage / reports:

- `packages/tui/src/index.test.ts`
- `docs/delivery/phase-15-5b-resource-task-lifecycle.md`
- `docs/delivery/phase-17a-local-durable-jobs-virtual-agent-concurrency.md`

Hot-path notes:

- Current scans are over bounded in-session arrays and likely cheap.
- Risk is indirect: leaked child processes can consume OS resources even if Linghun state thinks capacity is free.

### 10. Native Runner Resolver / Adapter / Fallback

Current files / functions:

- `packages/tui/src/index.ts`
  - `resolveNativeRunner()`
  - `resolveNativeRunnerPath()`
  - `getBundledNativeRunnerCandidate()`
  - `getNativeRunnerPlatformArch()`
  - `getBundledNativeRunnerRoots()`
  - `isExecutableNativeRunnerCandidate()`
  - `parseRunnerJson()`
  - `createNativeRunnerCommand()`
  - `createApprovedRunnerJobSpec()`
  - `startRunnerForDurableJob()`
  - `startApprovedRunnerSpec()`
  - `waitForRunnerState()`
  - `mapNativeRunnerStatus()`
- `packages/tui/src/job-runner-presenter.ts`
  - `formatRunnerDoctor()`
  - `formatJobRunnerReportLine()`
- `prototypes/native-runner/src/main.rs`
  - `version/start/status/stop/heartbeat` prototype
  - Windows `taskkill /pid /t` cleanup prototype

Existing protections:

- Native runner defaults disabled.
- Disabled / missing / unavailable / protocol mismatch / start failure all fall back to Node/TUI.
- Version probe is bounded.
- Startup observable state wait is bounded.
- Bundled path convention supports `win32-x64`, `linux-x64`, `darwin-arm64`, `darwin-x64` candidates.
- Approved runner spec does not forward raw user command.
- Runner completed lifecycle remains non-PASS; runner cannot decide verification verdict.
- Doctor and report output use redacted path refs.

Focused coverage / reports:

- `packages/config/src/index.test.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/job-runner-presenter.test.ts`
- `docs/delivery/phase-17c-native-runner-job-supervisor-gate.md`
- `docs/audit/native-runner-vs-node-benchmark.md`

Hot-path notes:

- `resolveNativeRunner()` uses synchronous filesystem checks and bounded synchronous version probe; acceptable in doctor/start paths, but should not be called repeatedly in render loops.
- Native prototype stdout/stderr logs are not size-capped in the runner itself.

### 11. Help / Discovery / Light Hints Rendering

Current files / functions:

- `packages/tui/src/index.ts`
  - `formatCatalogHelp()`
  - `formatSlashDiscovery()`
  - `formatUnknownSlashCommand()`
  - `collectLightHints()`
  - `createLightHint()`
  - `writeLightHints()`
  - `writeLightHintsForTest()`
- `packages/tui/src/natural-command-bridge.ts`
  - `getCommandCapabilityCatalog()`
  - `getUserVisibleCommandCapabilities()`
  - `createModelCapabilitySummary()`
  - `routeNaturalIntent()`

Existing protections:

- Catalog output is stable sorted.
- Default `/help` and slash discovery are slimmed; complete help is behind `/help all|advanced|details`.
- Advanced recovery entries such as `/trust` and `/permissions` are hidden from default discovery but not removed.
- Light hints use priority, cooldown, and one-per-turn limits according to Polish C delivery.
- Model-visible capability summary is capped.

Focused coverage / reports:

- `packages/tui/src/index.test.ts`
- `packages/tui/src/natural-command-bridge.test.ts`
- `docs/delivery/pre-smoke-tui-polish-a-natural-intent-command-surface.md`
- `docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md`

Hot-path notes:

- Catalog sorting and natural routing score all capabilities per input; currently small enough.
- If catalog grows with plugins/skills, stable memoized summaries may become useful, but only after measurement.

## Candidate Hot Paths

| Hot path | Current bound / fallback | Scout concern | Benchmark before optimizing? |
| --- | --- | --- | --- |
| Workspace Reference Cache refresh | Bounded watched files, top-level snapshot, fallback | Sequential `lstat`; inaccessible entry fallback; large root top-level count | Yes |
| Workspace Snapshot Lite summary | Entry cap, metadata-only | Top-level enumeration latency on large Windows repo / antivirus | Yes |
| Compact/context trimming | Local char estimates, pair-safe grouping | Large transcript scanning and repeated estimates | Yes |
| Log artifact tail | Tail byte window | Good candidate but validate CRLF/UTF-8/large file latency | Yes |
| Log artifact grep/errors | 1 MiB tail scan, match/time caps | `countLineBreaksBeforeOffset()` can scan prefix | Yes |
| JSONL transcript resume | Broken-line tolerant | Full file read/split for large sessions | Yes |
| Evidence lookup/details | In-memory recent evidence | Long sessions may need offset/index only if measured | Yes |
| Doctor/status/problems | Summary-first, capped problems | Aggregator should stay filesystem-light | Yes |
| Tool output formatting | Summary-first | Upstream full output may already be materialized | Yes |
| Provider stream parser | Timeouts/retry/parser coverage | Buffer splitting, large error body, reader release on abort | Yes |
| Job report refresh | State/report/log artifacts | Rewriting full report and scanning all jobs | Yes |
| Resource guard | Low caps | Not currently hot; indirect OS-process leaks matter more | Probably no, unless job counts grow |
| Native runner resolver | Bounded probe + fallback | Avoid repeated sync probe in render/status loops | Yes, only around doctor/job paths |
| Help/discovery/light hints | Stable catalog and capped summary | Catalog small; memoize only if plugin catalog grows | Probably no for now |
| Agent/job display summary | Bounded arrays | Log tail reading and report path privacy | Yes for log-heavy jobs |
| Windows path normalization | Multiple local implementations | Case/symlink/junction/long path risks | Needs focused Windows tests first |

## Windows Stability Risk Map

### 中文路径 / 空格路径

Observed strengths:

- Phase 17C focused tests include Chinese and space-containing mock runner/project paths.
- Native runner adapter uses argument vectors, not shell string concatenation, for approved specs.
- TUI reports avoid forwarding raw user commands to native runner.

Risks:

- Multiple path formatting/redaction helpers exist across log artifact, runner, readiness presenter, job reports, and tools. Inconsistent path casing or path ref rules may produce different behavior.
- `resolve(runner.path)` for custom runner paths resolves relative paths against process cwd, which may surprise users if cwd differs from project root.
- Absolute paths in details/report can expose usernames; acceptable in details only if intentional, but should be audited.

Formal gate tests needed:

- Project path with Chinese + spaces.
- Log path with Chinese + spaces.
- Native runner candidate path with Chinese + spaces.
- `.linghun` under non-C drive.
- Custom data dir under non-C drive.

### CRLF / LF

Observed strengths:

- Editing tools record newline style and patch summary.
- Log artifact tests cover CRLF and Chinese UTF-8.

Risks:

- Provider/tool streamed output may mix CRLF/LF and be split in different layers.
- Report generation and JSONL append always write `\n`; acceptable but should remain explicit.

Formal gate tests needed:

- CRLF file read/edit/write preserves newline style.
- CRLF log tail/grep/errors returns correct line boundaries.
- Mixed line endings do not break patch summary or details slices.

### Encoding / Mojibake

Observed strengths:

- Tool output presenter has `looksLikeMojibake()` for Bash output hints.
- Log artifact reads as UTF-8 and redacts after decode.
- Tools write artifacts as UTF-8.

Risks:

- Non-UTF-8 process output on Windows can still decode lossy.
- Mojibake detection scans full Bash text after capture; this is diagnostic, not prevention.
- Provider error bodies may include unexpected encodings / HTML.

Formal gate tests needed:

- UTF-8 Chinese stdout/stderr from Bash.
- Simulated mojibake output gets actionable warning without corrupting transcript.
- Non-UTF-8 bytes in log artifact do not crash tail/grep/errors.

### PowerShell / cmd / sh differences

Observed strengths:

- Current harness uses bash; Linghun tool runtime spawns commands through shell behavior in `packages/tools/src/index.ts`.
- Native runner approved spec avoids shelling raw user commands.

Risks:

- Windows users may expect PowerShell/cmd behavior; shell quoting and command availability can differ.
- Error messages and exit codes can differ by shell.

Formal gate tests needed:

- Documented shell selection behavior.
- Bash command timeout/cancel behavior on Windows.
- Commands with spaces / Unicode in args.

### Child process tree cleanup

Observed strengths:

- Tools Bash timeout/cancel attempts process-tree cleanup using `taskkill /pid <pid> /t`, and force path uses `/f`.
- Native runner prototype has Windows `taskkill /pid /t` cleanup.
- Verification cancellation is wired through AbortSignal according to Phase 15.5B.

Risks:

- Grandchild process cleanup can fail under antivirus, permissions, or process already exited.
- State may mark capacity released while OS child survives.
- Native prototype owner-death / long-running daemon supervision remains deferred.

Formal gate tests needed:

- Child and grandchild process tree cancellation.
- Timeout cleanup leaves no live child.
- Cancelled / timeout / stale never generate PASS evidence.
- Cleanup failure is visible and actionable.

### Long-running process cancel / timeout

Observed strengths:

- Bash and verification support timeout/cancel outcomes.
- Background lifecycle includes stale.
- Job states include timeout/cancel/stale and non-PASS semantics.

Risks:

- Report/log writes around cancellation may race with process cleanup.
- Native runner state file updates can face Windows rename/delete transient failures.

Formal gate tests needed:

- Cancel during stdout flood.
- Cancel during no-output process.
- Timeout during nested child.
- State/log/report remain consistent after cancellation.

### Native runner fallback

Observed strengths:

- Disabled/unavailable/protocol mismatch/start/status failure all fall back to Node/TUI.
- `/doctor runner` is summary-first and redacted.
- Native runner does not replace Node/TUI default short-task path.

Risks:

- Repeated sync version probes could block UI if called too often.
- Bundled binary release artifacts are not present and cannot be claimed.
- Windows executable check is read-access oriented; executable validity still requires probe.

Formal gate tests needed:

- Missing bundled candidate fallback.
- Protocol mismatch fallback.
- Corrupt/noisy runner output fallback.
- Path with Chinese/spaces fallback and available cases.

### Symlink / junction / path casing

Observed strengths:

- Log artifact path checks restrict to workspace/log roots.
- Native root canonicalization exists in Rust prototype.

Risks:

- JS `isInside()` style containment appears string-prefix based and may not normalize Windows case.
- Symlink/junction escape may allow a path inside workspace that resolves outside unless `realpath()` is used consistently.
- Long paths and 8.3 aliases are not clearly covered.

Formal gate tests needed:

- Different drive-letter casing.
- Junction inside workspace pointing outside.
- Symlink under `.linghun/logs` pointing outside.
- Long path near Windows limits.

### Antivirus / signing / release artifact

Release gate only in this scout:

- Antivirus false positives, signing, notarization, checksum, GitHub release artifacts, optional package matrix, and one-command installation belong to release/open-source packaging gate.
- They should not be implemented in the first Performance & Windows Stability Hardening Gate unless user explicitly scopes release packaging.

## Benchmark Plan — Design Only, Not Run

This section designs benchmark coverage only. No benchmark was run in this scout.

### Synthetic repository tiers

#### Small repo

- Files: 500-1,000 files.
- Directories: 50-100 dirs.
- Logs: 5 artifacts, 1-5 MiB each.
- JSONL transcript: 2,000-5,000 events.
- Jobs: 5 durable job dirs.
- Purpose: ensure overhead does not hurt normal projects.

#### Medium repo

- Files: 20,000-50,000 files.
- Directories: 2,000-5,000 dirs.
- Logs: 20 artifacts, 20-100 MiB each.
- JSONL transcript: 50,000-100,000 events.
- Jobs: 100 durable job dirs.
- Purpose: verify bounded reads and status/doctor latency.

#### Large repo

- Files: 200,000-500,000 files.
- Directories: 20,000-50,000 dirs.
- Logs: 100 artifacts, 100 MiB-1 GiB each.
- JSONL transcript: 500,000-1,000,000 events.
- Jobs: 1,000 durable job dirs.
- Purpose: prove whether TS/Node bounded paths remain acceptable before any native/helper discussion.

### G drive temporary pressure directory plan

Design only:

```text
G:\linghun-perf-scout\small\
G:\linghun-perf-scout\medium\
G:\linghun-perf-scout\large\
```

Rules for formal gate:

- Create synthetic data only under a clearly named temp root.
- Never point benchmark at real user projects unless user explicitly approves.
- After benchmark, delete generated data and verify cleanup.
- Do not place secrets, provider keys, or real transcripts in synthetic data.
- Do not run while another development window is doing heavy build/test/smoke.

### Metrics

Required metrics:

- Wall time per operation.
- Peak RSS / memory high-water mark.
- CPU time / CPU percentage if available.
- Event-loop delay / foreground latency.
- Time to first visible TUI response for status/details commands.
- Bytes read from disk where measurable.
- Number of files opened / stats performed where measurable.
- Tokens/cache impact for context-building paths.
- Log output size and artifact size.
- Timeout/cancel cleanup latency.

Candidate command-level metrics:

- `/cache status`
- `/cache warmup`
- `/details output <id> --tail 40`
- `/details output <id> --grep ERROR --context 2`
- `/details output <id> --errors`
- `/doctor`
- `/doctor all`
- `/status`
- `/background`
- `/job status`
- `/job report`
- session resume / transcript hydration
- provider parser synthetic SSE parse with no live provider

### Safety ceilings

Formal gate should define hard ceilings before running:

- Keep at least 30% system memory headroom.
- Stop if peak RSS exceeds a user-approved limit.
- Stop if CPU remains saturated for a sustained window.
- Stop if G drive free space drops below a safe threshold.
- Stop if foreground latency exceeds an agreed ceiling repeatedly.
- Run large tier only after small and medium tiers complete.
- Never run full repo tests/builds as part of benchmark unless separately approved.

### Cleanup strategy

- Generate a manifest of synthetic dirs/files during benchmark.
- Delete only paths under `G:\linghun-perf-scout\`.
- Verify directory removal.
- If deletion fails, report remaining paths and probable lock/AV causes.

## Algorithmic Optimization Candidates

No optimization below should be implemented without benchmark evidence.

### 1. Incremental hash for workspace snapshot

- Possible benefit: reduce repeated file prefix reads/stat comparisons during `/cache refresh` and provider preflight.
- Risk: extra state can become stale or duplicate codebase-memory duties.
- Benchmark must prove: repeated refresh on medium/large repos spends meaningful wall time in unchanged file hash/stat paths.
- Gate recommendation: candidate for formal gate only if WRC refresh is measured as foreground-latency hot.

### 2. Memoized stable summaries

- Possible benefit: avoid repeated formatting/sorting of command catalog, capability summary, doctor static items, runtime status fragments.
- Risk: stale UI summaries after config/mode/provider changes.
- Benchmark must prove: help/discovery/status formatting is non-trivial under plugin/skill-expanded catalog.
- Gate recommendation: mostly NOT-DO now; revisit only if catalog grows significantly.

### 3. Bounded streaming / offset index for JSONL transcript

- Possible benefit: faster resume/details/evidence lookup for long sessions; lower memory than full `readJsonl()`.
- Risk: offset index maintenance, corruption recovery, Windows concurrent append behavior.
- Benchmark must prove: large-session resume or evidence lookup is a real bottleneck.
- Gate recommendation: strong candidate for formal gate measurement; implement only minimal append-friendly offset/tail reader if justified.

### 4. Bounded line index for log artifacts

- Possible benefit: avoid prefix scan in `countLineBreaksBeforeOffset()` for huge logs while preserving line numbers.
- Risk: persistent index can become a second log DB; not worth it if line numbers are optional.
- Benchmark must prove: grep/errors line-number calculation dominates large log slice latency.
- Gate recommendation: first benchmark; if hot, prefer lazy per-artifact sparse offset cache or omit exact line numbers in bounded mode rather than adding DB.

### 5. De-duplicate parse for provider SSE tool calls

- Possible benefit: reduce repeated JSON parsing/string copying in heavy streamed tool-call responses.
- Risk: parser correctness regressions are high impact.
- Benchmark must prove: synthetic large SSE stream parsing is CPU/memory hot compared with network latency.
- Gate recommendation: measure only; optimize conservatively with parser tests if clearly hot.

### 6. Stable sorted cache for workspace top-level entries

- Possible benefit: avoid repeat sorting/hash work on unchanged top-level entries.
- Risk: locale/case sensitivity differences on Windows; stale cache complexity.
- Benchmark must prove: sorting/hashing, not I/O, is the bottleneck.
- Gate recommendation: likely NOT-DO unless benchmark says sorting dominates.

### 7. Shared query plan for doctor/status/problems

- Possible benefit: `/status`, `/doctor`, `/problems`, `/cache status` can reuse the same precomputed lite facts per turn.
- Risk: new query planner can become over-abstracted and stale.
- Benchmark must prove: repeated collectors perform duplicate filesystem/session/job work in one TUI turn.
- Gate recommendation: candidate only if measurements show duplicate expensive reads.

### 8. Lazy details expansion

- Possible benefit: keep primary status/job/doctor output fast by deferring report/log/evidence hydration until `/details`.
- Risk: missing details can surprise users if not discoverable.
- Benchmark must prove: default views are reading heavy details eagerly.
- Gate recommendation: good formal gate candidate if any default command reads full logs/reports.

### 9. Long output artifact index

- Possible benefit: faster tail/grep/errors and resumable log diagnostics for very large artifacts.
- Risk: prohibited overdesign if it becomes sqlite/database/background indexer.
- Benchmark must prove: current bounded slices are too slow on large logs and line numbers matter.
- Gate recommendation: default NOT-DO; if needed, choose minimal sidecar metadata, not DB/indexer.

### 10. Windows path canonicalization cache

- Possible benefit: consistent `realpath` / case-normalized containment checks across log artifacts, runner, workspace cache, report paths.
- Risk: caching canonical paths can be stale across junction/symlink changes; incorrect cache can weaken path safety.
- Benchmark must prove: repeated canonicalization is measurable, but tests must first prove correctness need.
- Gate recommendation: first add focused correctness tests; cache only if performance cost is proven.

## NOT-DO / Anti-overdesign

Formal Performance & Windows Stability Gate must keep these hard limits:

- No optimization without benchmark evidence.
- Do not rewrite large systems because they might be faster.
- Do not add native/binary helpers for workspace scanning in this gate.
- Do not add DB/sqlite for logs, transcripts, snapshots, or jobs in this gate.
- Do not add filesystem watcher.
- Do not add a second code indexer.
- Do not replace codebase-memory.
- Do not replace runner/job runtime.
- Do not change permission modes, Start Gate, or PASS evidence semantics.
- Do not make native runner the default short-task executor.
- Do not turn log artifact runtime into root-cause classifier.
- Do not turn workspace snapshot into Git status / LSP / code graph.
- Do not turn performance scout into ready/pass claim.
- Do not claim cache/token/performance savings without measured data.
- Do not enter Phase 18, real smoke, Beta readiness, or open-source release readiness from this gate.

## Proposed Next Gate Scope

正式 Performance & Windows Stability Hardening Gate 应等待 Polish D 完成后，再由用户确认启动。建议拆成以下小步，每步可独立停止。

### Gate 0 — Scope Lock / Baseline

- Re-read Polish D final delivery and current working tree state.
- Confirm no runtime file conflicts with ongoing TUI work.
- Define exact benchmark tiers and safety ceilings.
- Confirm G drive temp path and cleanup permission.
- Confirm no live provider / no native runner real execution unless explicitly scoped.

### Gate 1 — Measurement Harness Only

First benchmark, not optimize:

- Workspace Reference Cache `/cache warmup|status` on synthetic small/medium.
- Log artifact tail/grep/errors on synthetic large logs.
- JSONL transcript read/resume on synthetic long transcript.
- Doctor/status/problems default vs details.
- Job list/status/report with synthetic job dirs.
- Provider parser with offline synthetic SSE stream.

Start with small and medium only. Large/G drive pressure only after user confirms.

### Gate 2 — Windows Correctness Focused Tests

Add focused tests before performance changes:

- Chinese + space project path.
- Drive-letter casing.
- CRLF/LF log and source files.
- UTF-8 Chinese stdout/stderr.
- Simulated mojibake warning.
- Symlink/junction escape for log artifact path guard.
- Child/grandchild process cleanup timeout/cancel.
- Native runner missing/protocol mismatch/corrupt output fallback.
- Long path / non-C drive storage path.

These tests should not require real provider or real native runner execution unless user separately approves.

### Gate 3 — Minimal Hotspot Fixes Only If Proven

Likely first candidates if benchmark confirms:

1. Avoid full prefix line counting for log grep/errors, or make exact line numbers optional in bounded mode.
2. Add bounded/tail JSONL reader for resume/evidence query.
3. Catch per-entry workspace snapshot `lstat` errors instead of whole snapshot fallback.
4. Cap provider error body reads and ensure stream reader cancellation/release on timeout/abort.
5. Avoid eager full-log reads in job log display paths.
6. Centralize Windows path canonicalization correctness, not necessarily caching.

If measured benefit is low, do not implement.

### Gate 4 — Re-measure / Report

- Re-run only the same targeted benchmark cases that motivated a fix.
- Compare before/after wall time, memory, event-loop delay, and foreground latency.
- Report improvement as measured data only.
- If no meaningful improvement, revert or keep only correctness hardening with explicit rationale.

## Suggested Formal Gate NOT-DO First

These should start as NOT-DO unless measurement/correctness proves otherwise:

- Native Fast Workspace Scanner.
- Persistent DB / sqlite for transcript/logs/jobs.
- Full workspace watcher.
- Full gitignore engine.
- Full LSP integration.
- Background log indexer.
- Model-based log summarizer.
- Native runner performance marketing.
- Release signing/AV matrix.

## Scout Conclusion

The current implementation already has several mature Lite boundaries:

- Workspace/cache paths are bounded, metadata-only, hash-based, and fallback-safe.
- Log artifact runtime is bounded, redacted, and details-driven.
- Tool output is summary-first and long-output aware.
- Resource guard and job lifecycle already enforce conservative caps and non-PASS boundaries.
- Native runner already falls back to Node/TUI and does not replace core runtime.

The strongest formal-gate candidates are not broad rewrites. They are targeted measurement and correctness checks around:

1. large JSONL transcript reads,
2. log artifact line-number prefix scans,
3. provider error body / stream abort resource cleanup,
4. job log/report refresh on large job sets,
5. Windows path casing / symlink / junction containment,
6. process tree cleanup under timeout/cancel.

Recommendation: start the formal Performance & Windows Stability Hardening Gate **only after Polish D is complete and user explicitly confirms**. The first formal gate step should be benchmark/correctness measurement, not optimization implementation.
