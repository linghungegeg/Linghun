# Performance & Windows Stability Hardening Gate

## Scope Lock

- synthetic/offline benchmark only: yes
- live provider/API call: no
- real project smoke: no
- large/G drive stress: not run
- runtime code modified during baseline stage: no
- runtime code modified after baseline: yes, exactly 1 data-backed minimal runtime fix
- runtime fix scope: log artifact path guard + bounded line-number prefix scan only
- no context/compact/JSONL/provider/job/workspace cache optimization: yes
- no DB/sqlite/indexer/binary/provider/tool permission/evidence/job architecture replacement: yes
- no Beta PASS / smoke-ready / open-source-ready claim: yes
- no Phase 18 / desktop / release work: yes
- no commit: yes

## Sequence Summary

This gate ran in two distinct steps:

1. Baseline first: generated synthetic/offline small + medium benchmark data without changing runtime behavior.
2. Fix second: applied 1 data-backed minimal runtime fix for C01 log artifact cases, then re-measured with the same synthetic/offline harness.

The only runtime fix was in log artifact handling:

- path guard hardening for symlink/junction escape via canonical path checks
- bounded line-number prefix scan for large log slices

No runtime optimization was made for context/compact, JSONL transcript reading, provider streaming, background/job views, or workspace reference cache. Those paths were measured where represented by the synthetic cases, but did not meet this gate's current standard for changing runtime code: a clear caseId-backed benefit or a focused correctness failure requiring a minimal fix.

## Truthfulness Boundary

- Synthetic/offline benchmark data is not real project smoke.
- Live provider streaming was not tested.
- Real long transcript resume, real multi-job/background status, and real build logs still need observation during a later real smoke pass.
- Large/G drive stress was not run. Small/medium data was sufficient to prove and validate the C01 log artifact fix, but this must not be interpreted as large-scale coverage.

## Artifacts

| artifact | path | status |
| --- | --- | --- |
| baseline raw data | `docs/audit/artifacts/performance-gate-baseline-raw.json` | generated, cleanupStatus `completed`, measurementStage `baseline` |
| baseline summary | `docs/audit/performance-windows-stability-hardening-gate-baseline.md` | generated, cleanupStatus `completed` |
| after-fix raw data | `docs/audit/artifacts/performance-gate-after-raw.json` | generated, cleanupStatus `completed`, measurementStage `after-fix-remeasure` |
| after-fix summary | `docs/audit/performance-windows-stability-hardening-gate-after.md` | generated, clearly marked After-Fix / Re-measure |
| final gate report | `docs/audit/performance-windows-stability-hardening-gate.md` | this file |

## Environment

| run | node | pnpm | os | cpu logical cores | synthetic root |
| --- | --- | --- | --- | ---: | --- |
| baseline | v24.14.0 | unknown | win32 10.0.19045 | 16 | `G:\linghun-perf-gate` |
| after-fix re-measure | v24.14.0 | 10.10.0 | win32 10.0.19045 | 16 | `G:\linghun-perf-gate` |

Note: baseline initially recorded `pnpm=unknown` because `corepack pnpm --version` was unavailable inside that Vitest process. The benchmark harness now falls back to `pnpm --version` and `npm_config_user_agent`; after-fix raw data records `pnpm=10.10.0`.

## Synthetic Data Manifest

| run | root | files | bytes | cleanup |
| --- | --- | ---: | ---: | --- |
| baseline | `G:\linghun-perf-gate\baseline-20260524-1779571962207` | 1756 | 9031854 | completed |
| after-fix re-measure | `G:\linghun-perf-gate\baseline-20260524-1779573509348` | 1756 | 9031854 | completed |

Cleanup deleted only manifest-recorded paths:

- `G:\linghun-perf-gate\baseline-20260524-1779571962207\small`
- `G:\linghun-perf-gate\baseline-20260524-1779571962207\medium`
- `G:\linghun-perf-gate\baseline-20260524-1779573509348\small`
- `G:\linghun-perf-gate\baseline-20260524-1779573509348\medium`

Post-cleanup existence check reported all four paths as `exists=false`. Raw and summary artifacts are retained for final audit and later README/reference work.

## Decision Table

| item / caseId | area | baseline signal | after-fix signal | decision |
| --- | --- | --- | --- | --- |
| C01-small-log-tail-40 | Log Artifact / details output tail-40 | p50 3.76 / p95 3.83 | p50 0.78 / p95 0.86 | DONE: same root cause as medium log tail |
| C01-medium-log-tail-40 | Log Artifact / details output tail-40 | p50 22.72 / p95 22.87 | p50 0.59 / p95 0.72 | DONE: data-backed log artifact fix |
| C01-medium-log-grep-error-context-2 | Log Artifact / details output grep-error-context-2 | p50 25.50 / p95 27.38 | p50 8.71 / p95 9.11 | DONE: data-backed log artifact fix |
| C01-medium-log-errors | Log Artifact / details output errors | p50 21.70 / p95 23.18 | p50 4.17 / p95 4.60 | DONE: data-backed log artifact fix |
| E02-medium-background-job-views | Background / Job status / Job report default views | p50 33.85 / p95 34.82 | p50 34.63 / p95 36.05 | DEFERRED: no clear benefit; no minimal proven fix |
| A01/A03/A04/A05/A06 context/compact family | Context / Compact / provider-message construction / handoff | measured synthetic small/medium cases | no runtime change | DEFERRED: measured but did not meet current change threshold |
| A02 JSONL full transcript read | Transcript JSONL | measured synthetic small/medium cases | no runtime change | DEFERRED: no targeted runtime change proved necessary in this gate |
| F01 provider SSE parser | Provider parser offline | parser-only synthetic SSE measured; no live provider call | no runtime change | DEFERRED: live provider streaming not tested; no offline fix justified |
| B01/B02 workspace reference cache | Workspace Reference Cache | measured synthetic small/medium cases | no runtime change | DEFERRED: no focused correctness failure or data-backed minimal fix |
| New DB/sqlite/indexer/binary/runner/job replacement | Architecture | outside gate | not attempted | NOT-DO |
| Large/G drive stress | Scale coverage | not run | not run | NOT-DO in this run; small/medium already proved C01 fix, not large coverage |
| Real project smoke / live provider/API | Realism coverage | not run | not run | NOT-DO in this run |
| Beta PASS / smoke-ready / open-source-ready claim | Release readiness | outside gate | not claimed | NOT-DO |

Optimization rule applied: if data showed no obvious benefit, or if no focused correctness failure existed, runtime code was not changed.

## Windows Correctness Tests Added or Strengthened

| requirement | coverage |
| --- | --- |
| Chinese + space project path | `packages/config/src/index.test.ts` checks project config/settings/projectData paths retain Chinese and spaces. |
| Drive-letter casing | `packages/config/src/index.test.ts` checks lower-case `g:\` project data is preserved on Windows. |
| Long path / non-C storage path | `packages/config/src/index.test.ts` checks long `LINGHUN_DATA_DIR` rooted on `G:\` is respected. |
| CRLF/LF log files | `packages/tui/src/log-artifact.test.ts` checks mixed CRLF/LF log slicing with Chinese text. |
| CRLF/mixed source files | `packages/tools/src/index.test.ts` checks Read reports `crlf` and `mixed` without rewriting files. |
| UTF-8 Chinese stdout/stderr | `packages/tools/src/index.test.ts` checks Bash progress and full output logs preserve Chinese stdout/stderr without `�`. |
| Simulated mojibake warning | existing `packages/tui/src/index.test.ts` coverage retained for Bash mojibake summary warning. |
| Symlink/junction escape for log artifact path guard | `packages/tui/src/log-artifact.test.ts` creates a symlink/junction to an outside directory and expects rejection. |
| Child/grandchild cleanup timeout/cancel | `packages/tools/src/index.test.ts` checks sentinel files are not written after timeout/cancel on Windows. |
| Native runner missing/protocol mismatch/corrupt output fallback | `packages/tui/src/index.test.ts` adds corrupt `version` output fallback and asserts no PASS evidence. |

## Runtime Fixes

### 1. Log artifact symlink/junction path guard

- File: `packages/tui/src/log-artifact.ts`
- Problem: lexical path prefix checks allowed a workspace-local symlink/junction to resolve outside the workspace/log roots.
- Fix: canonicalize candidate and roots with `realpath()` before the final allowed-root check; keep Windows comparisons case-insensitive.
- Scope: log artifact path resolution only; no permission semantics, evidence model, job model, provider model, workspace cache model, or tool architecture changed.

### 2. Log artifact large-window prefix line scan cap

- File: `packages/tui/src/log-artifact.ts`
- Problem: tail/grep/errors did bounded byte reads, but still scanned all prefix bytes to calculate exact line numbers when the slice started far into a large log. This dominated measured C01 medium cases.
- Fix: keep exact line numbers for prefix offsets up to 256 KiB; above that, skip the expensive prefix scan, report relative line numbers, and add a warning:
  - `Line numbers are relative to the bounded scan window; exact prefix scan was skipped for performance.`
- Scope: bounded log artifact presentation only; verification PASS/PARTIAL/FAIL semantics are unchanged.

### 3. Benchmark harness metadata fallback

- File: `benchmarks/performance-windows-stability-gate.test.ts`
- Problem: baseline environment recorded `pnpm=unknown`.
- Fix: add fallback from `corepack pnpm --version` to `pnpm --version` and then `npm_config_user_agent`.
- Scope: benchmark metadata only; no runtime behavior changed.

## Before / After Performance Data

| caseId | baseline p50Ms | after p50Ms | baseline p95Ms | after p95Ms | decision |
| --- | ---: | ---: | ---: | ---: | --- |
| C01-small-log-tail-40 | 3.76 | 0.78 | 3.83 | 0.86 | DONE |
| C01-small-log-grep-error-context-2 | 4.11 | 4.81 | 5.11 | 5.34 | NOT-DO for small scale; no data-backed benefit |
| C01-small-log-errors | 4.09 | 5.02 | 5.18 | 5.31 | NOT-DO for small scale; no data-backed benefit |
| C01-medium-log-tail-40 | 22.72 | 0.59 | 22.87 | 0.72 | DONE |
| C01-medium-log-grep-error-context-2 | 25.50 | 8.71 | 27.38 | 9.11 | DONE |
| C01-medium-log-errors | 21.70 | 4.17 | 23.18 | 4.60 | DONE |
| E02-medium-background-job-views | 33.85 | 34.63 | 34.82 | 36.05 | DEFERRED; not improved |

Data source: baseline and after-fix raw JSON artifacts listed above. These are synthetic/offline results only and are not real project smoke results.

## Follow-up Real Smoke Observation Points

When a later real smoke is explicitly approved, watch these areas first:

- long transcript resume: whether real session hydration/compact feels slow compared with synthetic A01/A03/A04/A05/A06 signals
- multi job/background status: whether real `/background`, `/job status`, or `/job report` remains responsive with multiple active/completed jobs
- provider streaming: whether live provider streaming stalls, has slow first token, or mishandles SSE/usage/tool-like chunks
- large log details: whether `/details output` tail/grep/errors remains bounded and stable on real build/test logs
- Windows cancel/timeout: whether cancelled or timed-out commands leave child/grandchild processes behind

These are observation priorities, not claims that the real smoke has already covered them.

## DEFERRED / NOT-DO Decisions

| item | decision | reason |
| --- | --- | --- |
| E02 background/job views optimization | DEFERRED | after-fix data was slightly slower/noisy (`p50 33.85 -> 34.63`, `p95 34.82 -> 36.05`); no minimal proven fix. |
| Context/compact path optimization | DEFERRED | synthetic A01/A03/A04/A05/A06 cases were measured, but did not justify runtime changes in this gate. |
| JSONL bounded/tail reader rewrite | DEFERRED | no caseId in this gate proved a targeted runtime change was necessary. |
| Workspace reference cache lstat fallback | DEFERRED | considered, but no focused failing correctness test or data-backed performance case justified a change. |
| Provider error body cap or live streaming changes | DEFERRED | no live provider/API calls were allowed and no offline caseId proved the change. |
| New DB/sqlite/indexer/binary/runner/job replacement | NOT-DO | explicitly outside this gate. |
| Large/G drive stress | NOT-DO in this run | small/medium data already identified and validated the minimal C01 fix; this is not large coverage. |
| Real project smoke / live provider/API | NOT-DO | explicitly outside this gate. |
| Beta PASS / smoke-ready / open-source-ready claim | NOT-DO | explicitly outside this gate. |

## Changed Files

| file | purpose |
| --- | --- |
| `benchmarks/performance-windows-stability-gate.test.ts` | synthetic/offline benchmark harness and metadata fallback |
| `docs/audit/artifacts/performance-gate-baseline-raw.json` | baseline raw data, cleanupStatus/metadata aligned |
| `docs/audit/artifacts/performance-gate-after-raw.json` | after-fix re-measure raw data, cleanupStatus/metadata aligned |
| `docs/audit/performance-windows-stability-hardening-gate-baseline.md` | baseline summary, cleanupStatus/stage wording aligned |
| `docs/audit/performance-windows-stability-hardening-gate-after.md` | after-fix re-measure summary, title/scope wording aligned |
| `docs/audit/performance-windows-stability-hardening-gate.md` | final gate report and scope truthfulness boundary |
| `packages/config/src/index.test.ts` | Windows path/drive/custom storage tests |
| `packages/tools/src/index.test.ts` | UTF-8 Bash, process tree cleanup, newline tests |
| `packages/tui/src/index.test.ts` | native runner corrupt output fallback test |
| `packages/tui/src/log-artifact.test.ts` | log artifact symlink/junction, mixed newline, prefix-scan tests |
| `packages/tui/src/log-artifact.ts` | realpath guard and bounded prefix line-number scan |

Pre-existing unrelated untracked file remains: `docs/audit/performance-windows-stability-readonly-scout.md`.

## Validation

| command | result |
| --- | --- |
| `corepack pnpm check` | PASS |
| `corepack pnpm typecheck` | PASS |
| `git diff --check` | PASS |
| focused Vitest for Windows/perf-gate cases | PASS: 4 files passed, 1 skipped; 30 passed, 192 skipped |
| full `corepack pnpm test` | PASS: 462 passed, 1 skipped |
| `corepack pnpm build` | PASS |
| synthetic baseline benchmark | PASS; generated baseline raw and markdown artifacts |
| synthetic after-fix re-measure benchmark | PASS; generated after raw and markdown artifacts |
| synthetic cleanup existence check | PASS; manifest-recorded paths removed |

This small report closeout changed only documentation/JSON metadata. It did not require rerunning tests/build; `git diff --check` was rerun for the closeout.

## Non-Claims

This gate does not claim:

- real project smoke coverage
- live provider/API coverage
- live provider streaming coverage
- large/G drive stress coverage
- real long transcript coverage
- real multi-job/background coverage
- real build-log coverage
- Beta PASS
- smoke-ready
- open-source-ready
- Phase 18 readiness
- release readiness

## Handoff Packet

- Next phase: none started; stop after this gate unless the user explicitly approves the next step.
- Forbidden next actions without user approval: real smoke, live provider/API calls, Phase 18, desktop work, open-source release work, dependency/config changes, runner/job/provider/evidence architecture changes, commit/push.
- Evidence: raw benchmark JSON, baseline/after markdown summaries, focused tests, build/typecheck/check/diff validation listed above.
- Remaining risks: E02 job view performance remains deferred; context/compact/JSONL/provider/workspace cache optimizations remain deferred; large stress and real smoke remain unrun by design.
- Permission/model context: local synthetic/offline gate only; no external provider calls.
