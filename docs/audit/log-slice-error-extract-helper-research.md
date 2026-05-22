# Log Slice / Error Extract Helper Research

Date: 2026-05-22

Scope: read-only research plus this audit report. No runtime code was changed, no commit was made, and this does not enter Phase 15.5C/D/E/F.

## Verdict

Linghun is good enough for Phase 15.5B's current acceptance boundary: Bash and verification outputs are saved, summarized, linked through `/background` and `/details`, and cancelled/timeout/stale results are kept out of PASS evidence.

A future Log Slice / Error Extract Helper is still worth doing, but not as a current blocker. The real gap is not "logs are lost"; the gap is "large saved logs are only addressable by path, not by bounded slice/search/error-focused retrieval." That matters more once real smoke, long verification runs, MCP logs, and Phase 17A jobs start producing multi-MB to multi-GB artifacts.

Recommendation: stage as **post-smoke performance hardening**, with a small **Phase 17A optional reuse** path for durable jobs. If Phase 15.5F revisits terminal polish, it may expose the command/help surface, but the helper should not block 15.5C.

## Current Linghun Facts

### Long tool output

- `packages/tools/src/index.ts` defines `ToolOutput` with `text`, `preview`, `details`, `truncated`, `fullOutputPath`, `evidenceId`, and `changedFiles`.
- Generic tool output is capped by `normalizeToolOutput()` at `maxResultSizeChars`; when capped, `text` becomes a preview, `details` keeps the full in-memory text, and `truncated=true`.
- `tool-output-presenter.ts` renders Read/Grep/Glob/Bash/Write/Edit/MultiEdit summary-first. For Bash it reports line count, exit code, possible mojibake, and points users to `/details` rather than dumping the full output.
- Todo output is separately capped to 8 visible lines in the main view.

### Bash stdout/stderr

- Bash writes complete command output to `.linghun/logs/tools/bash-<timestamp>-<uuid>.log`.
- stdout and stderr are combined into one accumulated string in `runShell()`, with progress events tagged as `stdout`, `stderr`, or `system`.
- The returned Bash `ToolOutput` contains a preview capped at `BASH_PREVIEW_LIMIT` and a `fullOutputPath`.
- Bash timeout/cancel records `outcome=timeout|cancelled|completed`.
- Windows process cleanup attempts process-tree termination with `taskkill /pid <pid> /t`, and force cleanup uses `/f`.

### Background output

- TUI has a session-scoped `BackgroundTaskState` with `id`, `kind`, `status`, `currentStep`, `progress`, `logPath`, `outputPath`, `hasOutput`, `result`, summary, and next action.
- `/background` lists current/recent tasks after refreshing stale state.
- `/details background <id>` shows task metadata including `logPath` and `outputPath`.
- `/details output <id>` currently returns the output path, status, and summary. It does not read slices from the file.
- Bash tool-use and slash `/bash` create background task entries and update them from `ToolContext.onProgress`.
- Streaming Bash progress is capped in the main view after 12 visible lines; complete output is kept in log/transcript.

### Verification logs

- `/verify` creates a verification background task and writes per-command logs under `.linghun/logs/verification/`.
- Each log includes command, exit code, outcome, duration, optional runner error, and command output.
- Verification statuses include `pass`, `fail`, `partial`, `cancelled`, `timeout`, and `stale`.
- `recordVerificationEvidence()` only grants PASS-supporting claims when the report status is `pass`; cancelled/timeout/stale/fail/partial become attempted or needs-review evidence.
- `/review` returns `CONSERVATIVE_NO_PASS` unless the latest verification is a scoped pass.

### Model回灌

- Tool calls are written to transcript as `tool_call_start`, `tool_call_delta`, and `tool_call_end`.
- Bash progress deltas are truncated to 500 display chars per transcript delta.
- Tool result continuation receives the `ToolOutput.text` preview and structured metadata, not the full saved log.
- Evidence records use short summaries and `source` paths, commonly `fullOutputPath`.
- There is no dedicated model tool or slash command to request `tail`, byte ranges, line ranges, grep matches, or extracted failure blocks from saved logs.

## CCB / Reference Behavior Facts

### diskOutput / TaskOutput

- CCB separates task output into a project temp task-output directory scoped by session id, avoiding cross-session clobbering.
- Disk writes are queued and drained asynchronously so chunks can be released after write completion.
- It has an explicit disk cap for task output and writes a truncation marker when the cap is exceeded.
- File reads support delta reads from byte offsets and tail reads with byte limits; task output retrieval does not need to load the whole file.
- For file-mode shell output, stdout/stderr can bypass JS accumulation and go directly to file descriptors; progress is derived by polling file tails.
- For pipe-mode hooks, output starts in memory and spills to disk after an in-memory cap.
- Task output retrieval returns status plus bounded content. Large output is formatted as a path plus tail/truncation notice.

### TaskOutput / TaskStop tools

- TaskOutput is read-only and supports blocking or non-blocking retrieval of background task output.
- It returns `success`, `timeout`, or `not_ready`, plus task status and bounded output.
- For completed local Bash tasks it can return exit code with output; for agents it prefers clean final result over raw transcript.
- CCB marks TaskOutput as deprecated in favor of reading the task output file path directly, which is still a useful boundary: paths are first-class, and full output is not blindly injected.
- TaskStop validates that a task exists and is running before stopping it; its UI truncates long command display.

### MCP large output

- MCP stdio stderr is captured for diagnostics and capped to avoid unbounded memory growth.
- MCP server instructions/descriptions are truncated to a configured max length.
- MCP result handling estimates token size, truncates when large-output file persistence is disabled, and otherwise persists oversized non-image content to a file.
- Persisted MCP output returns instructions to read specific portions, search within the file, or use structured queries.
- Binary MCP content is saved as a file with mime-derived extension rather than pushed into model context.

## Gap Table

| Area | Linghun Current | CCB / Mature Boundary | Gap | Severity |
| --- | --- | --- | --- | --- |
| Bash full output | Saved to `fullOutputPath`; preview returned | File-first output, bounded read/tail/delta | Linghun accumulates full stdout/stderr in JS before write; no slice reader | P2 now, P1 under huge real logs |
| `/details output` | Shows path/status/summary | Can retrieve bounded output or read path with offset/limit | Does not show tail, line range, byte range, or error snippets | P2 |
| Verification logs | Per-command logs saved; report links log path | Bounded retrieval and focused diagnostics | No helper to extract failed test block, stack trace, or last N lines | P2 |
| Model回灌 | Preview + evidence path | Bounded output with path and read instructions | Model cannot ask Linghun for a safe slice except by generic file read if it knows the path | P2 |
| Memory safety | Bash builds one full string then writes file | Direct file fd or streaming spill-to-disk | Very large stdout can still pressure Node memory | P2 now; future P1 for long jobs |
| MCP output | Current research did not find equivalent large-output persistence in Linghun required files | Token-aware truncation or file persistence | Potential future gap for Connect Lite/MCP maturity, but outside this research's runtime scope | Deferred |
| User UX | Summary-first, path visible | Summary + expandable/tail output | User has path but not a convenient in-app tail/search view | P2 |
| Error extraction | Manual log inspection | Error-focused summaries/tails can be exposed | No deterministic "give me first failure / stack / stderr tail" helper | P2 |

## Native/Binary Necessity Verdict

Native/binary is **not necessary** for the first implementation.

TS/Node streaming is enough for the minimal helper:

- Use `fs.open`, `FileHandle.read`, `fs.stat`, and byte offsets for tail/range reads.
- Use `readline` or chunk scanning for line windows and simple pattern search.
- Keep caps explicit: max bytes per read, max matches, max lines, max runtime.
- Treat UTF-8 boundary handling conservatively; if a chunk starts/ends mid-codepoint, decode with replacement or expand the read window slightly.

Native/binary would only become worth revisiting if real usage shows one of these:

- multi-GB logs need sub-second indexed search repeatedly;
- Windows file locking/encoding edge cases cannot be handled safely in Node;
- Phase 17A durable jobs need persistent searchable log indexes across many sessions;
- profiling shows Node chunk scanning is the bottleneck rather than model/tool latency.

Current evidence does not justify native code, a bundled binary, sqlite FTS, ripgrep wrapper, or a persistent log index.

## Recommended Minimal Design

Add a small `Log Slice Helper` later, not now.

### User-facing surface

- `/details output <id> --tail [lines]`
- `/details output <id> --range <startLine>:<endLine>`
- `/details output <id> --grep <pattern> [--context N]`
- `/details output <id> --errors`

If command flags are too much for first pass, keep slash syntax simpler:

- `/log tail <backgroundId|evidenceId|path>`
- `/log grep <backgroundId|evidenceId|path> <pattern>`
- `/log errors <backgroundId|evidenceId|path>`

### Model/tool surface

Prefer a local read-only tool only if the model genuinely needs it:

```ts
LogSlice({
  source: { backgroundId?: string; evidenceId?: string; path?: string },
  mode: "tail" | "range" | "grep" | "errors",
  offsetBytes?: number,
  startLine?: number,
  endLine?: number,
  pattern?: string,
  contextLines?: number,
  maxBytes?: number
})
```

Return:

- `sourcePath`
- `mode`
- `byteRange`
- `lineRange`
- `truncated`
- `nextOffsetBytes`
- `matches`
- `content`
- short warning if output is partial

### Error extraction heuristic

Keep it deterministic and humble:

- Prefer explicit failed verification command log when available.
- Extract stderr-labelled chunks when present.
- Match common markers: `error`, `failed`, `exception`, `traceback`, `panic`, `fatal`, `AssertionError`, `TypeError`, `SyntaxError`, `FAIL`, `FAILED`, non-zero `exitCode`.
- Return nearby context, not a generated explanation.
- Always label as "extracted candidates", not root cause.

### Storage and security

- Only allow paths from known Linghun log/output roots by default.
- Allow direct path only if it is inside workspace or Linghun storage roots.
- Redact obvious secrets using existing redaction utilities if available.
- Never add full logs to prompt, memory, handoff, status bar, or ordinary final replies.

## Not-Do List

- Do not make this a 15.5B/15.5C blocker based on current evidence.
- Do not build a persistent log database or search index in the first pass.
- Do not add native binaries, sqlite FTS, ripgrep dependency, or background indexing.
- Do not summarize logs with a model by default.
- Do not read entire logs into memory for grep/tail/range.
- Do not expose arbitrary filesystem reads through a log helper.
- Do not merge this with MCP Connect Lite or Phase 17A durable job runtime.
- Do not auto-classify verification as PASS based on extracted snippets.
- Do not copy CCB implementation details; only preserve behavior boundaries.

## Stage Ownership Recommendation

Primary recommendation: **post-smoke performance hardening**.

Reason:

- Current Phase 15.5B acceptance is already satisfied without it.
- Phase 15.5C is editing/tool UX; log slicing is adjacent but not required for read-before-edit, diff preview, stale file, or changedFiles summary.
- Phase 15.5F terminal polish could expose a nicer details/log command, but implementing the engine there may enlarge scope.
- Phase 17A durable jobs would benefit from reusable log slicing, but waiting until 17A risks rediscovering the same output retrieval problem under longer-running jobs.

Practical staging:

1. Keep current report as deferred research, not a blocker.
2. After real smoke or during post-smoke hardening, implement the minimal TS/Node helper.
3. In Phase 17A, reuse it for job logs rather than creating another job-log reader.

## Risks

- Very large Bash output can still pressure memory because Linghun currently accumulates command output before writing it to disk.
- `/details output` giving only a path can be insufficient for users who stay inside TUI.
- Model continuation may miss important failure details when the preview does not include the failing block.
- Error extraction heuristics can overfit common English/Node patterns and miss localized or tool-specific failures.
- A too-powerful path-based helper could accidentally become arbitrary file read unless path roots are constrained.
- Adding a model-facing helper increases tool schema surface and may affect prompt/cache stability if introduced too early.

## Validation Suggestions

Focused tests for a future implementation:

- Tail reads last N lines from a large log without loading the whole file.
- Byte range reads return `nextOffsetBytes` and `truncated=true` when capped.
- Line range reads handle CRLF and UTF-8 Chinese output.
- Grep mode returns bounded matches with context and match count cap.
- Error mode extracts candidate failure blocks from:
  - Bash non-zero exit with stderr;
  - Vitest/Jest-style failed assertion;
  - TypeScript compile error;
  - Python traceback;
  - timeout/cancel system messages.
- Unknown or missing background/evidence id returns a clear error.
- Path outside workspace/log roots is rejected.
- Huge file test proves memory stays bounded.
- Output returned to model is capped and includes source path plus partial-read warning.
- Cancelled/timeout/stale verification logs remain non-PASS evidence even if error extraction finds a recognizable failure.

Manual smoke suggestions:

- Run a command that produces more than 1 MB stdout and verify `/background`, `/details output --tail`, and model continuation stay responsive.
- Run a failing test command and verify `/details output --errors` surfaces the failure block without claiming root cause.
- Run on Windows Terminal with Chinese stdout/stderr and verify no mojibake regression beyond existing shell encoding behavior.

## Final Classification

- Current Linghun sufficiency: **enough for 15.5B; not enough for future long-log ergonomics**.
- Native/binary: **not needed**.
- Minimal design: **bounded TS/Node slice/search/error extraction over known log paths**.
- Current blocker status: **NOT A BLOCKER for 15.5B/15.5C**.
- Recommended stage: **post-smoke performance hardening**, reusable by **Phase 17A optional**.
