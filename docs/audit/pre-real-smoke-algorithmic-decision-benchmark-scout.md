# Pre-Real-Smoke Algorithmic Decision Benchmark Scout

## 0. Scope / Reality Boundary

本轮是 **Pre-Real-Smoke Algorithmic Decision Benchmark Scout**：较高强度 scout / baseline / report，不是真实全量 smoke。

明确边界：

- 未修改 `packages/*` runtime 源码。
- 未修改当前 Provider/Auth Config Center 收尾文件。
- 未提交 commit。
- 未进入真实全量 smoke。
- 未宣布 Beta PASS / smoke-ready / open-source-ready。
- 未进入 Phase 18 / desktop / release packaging。
- 未新增第二套 provider / tool / permission / evidence / job / agent / index / runtime。
- 未执行会修改真实项目源码的任务。
- Live provider 未执行；原因见 Key / Provider Safety。

Literal verification markers:

- not real smoke
- no keys stored
- no commit
- no second runtime

## 1. Documents / Existing Evidence Read

本轮按要求读取或由只读 scout agent 汇总核对：

- `START_NEXT_CHAT.md`
- `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- `docs/audit/reference-map.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `docs/audit/performance-windows-stability-readonly-scout.md`
- `docs/audit/performance-windows-stability-hardening-gate.md`
- `docs/audit/pre-smoke-terminal-product-ultimate-audit.md`
- `docs/delivery/phase-15-5e-provider-freshness.md`
- `docs/audit/phase-15-gate-f-dual-provider-live-report.md`

codebase-memory 索引状态：`F-Linghun` ready，nodes=1940，edges=4137。

## 2. Current Working Tree Diff Summary

开工前 `git status --short`：

```text
 M README.md
 M START_NEXT_CHAT.md
 M packages/config/src/index.ts
 M packages/tui/src/index.ts
```

开工前 diff summary：

```text
README.md                    |   8 +-
START_NEXT_CHAT.md           |   4 +-
packages/config/src/index.ts | 294 ++++++++++++++++++++++++++++++++++++++++++-
packages/tui/src/index.ts    |  32 ++++-
4 files changed, 328 insertions(+), 10 deletions(-)
```

这些文件属于当前收尾阶段已有 diff，本轮不得触碰。Benchmark Scout 只新增本报告与 `G:\linghun-perf-gate` 下 raw/summary/manifest artifact。

## 3. Existing Benchmark Harness Reused

复用现有 synthetic/offline 性能 gate：

- Harness：`benchmarks/performance-windows-stability-gate.test.ts`
- Run command：

```bash
LINGHUN_PERF_GATE=1 \
LINGHUN_PERF_GATE_RAW_OUTPUT="G:/linghun-perf-gate/pre-real-smoke-algorithmic-decision-benchmark-scout-raw.json" \
LINGHUN_PERF_GATE_SUMMARY_OUTPUT="G:/linghun-perf-gate/pre-real-smoke-algorithmic-decision-benchmark-scout-summary.md" \
corepack pnpm exec vitest run benchmarks/performance-windows-stability-gate.test.ts
```

Run result：PASS，1 test passed，duration 6.17s。

Artifact paths：

| artifact | path | status |
| --- | --- | --- |
| raw benchmark JSON | `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-benchmark-scout-raw.json` | retained |
| harness summary markdown | `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-benchmark-scout-summary.md` | retained |
| manifest | `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-benchmark-scout-manifest.json` | retained |
| final report | `docs/audit/pre-real-smoke-algorithmic-decision-benchmark-scout.md` | this file |

Synthetic dataset manifest：

| scale | path | files | bytes | generated input |
| --- | --- | ---: | ---: | --- |
| small | `G:\linghun-perf-gate\baseline-20260524-1779605526352\small` | 248 | 842276 | 800 transcript messages, 6000 log lines, 16 dirs, 120 files, 40 jobs, 500 SSE chunks |
| medium | `G:\linghun-perf-gate\baseline-20260524-1779605526352\medium` | 1508 | 8189578 | 8000 transcript messages, 60000 log lines, 48 dirs, 720 files, 260 jobs, 5000 SSE chunks |

Cleanup policy：保留本轮 raw、summary、manifest 和 synthetic dataset 作为审计证据。后续若清理，只允许删除 manifest 明确列出的路径，不得删除用户文件。

## 4. Key / Provider Safety

本轮 live provider **DEFERRED**。

原因：用户在聊天正文提供了临时 key。若本轮由助手把 key 传入 shell env，明文 key 会进入 tool 参数、会话 transcript 或 debug bundle 风险区，不满足“临时 API key 只允许当前 shell env 注入，不得写入 settings/config/report/transcript/debug bundle”的硬边界。

本轮安全处理：

- 未把 key 写入 shell 命令。
- 未把 key 写入 settings/config/report/transcript/debug bundle。
- 未把 key 传给子智能体。
- 未执行 live provider request。
- Raw artifact 只来自 synthetic/offline harness，`requests count = 0`，estimated cost = 0。
- 报告、raw artifact、summary、manifest 后续用敏感词/模式检查。

若后续需要 live provider benchmark，建议由用户在交互 shell 中自行输入临时 env，例如 `! export LINGHUN_DEEPSEEK_API_KEY=...` 或等价 PowerShell 当前进程 env，再只运行不含明文 key 的 benchmark/smoke 命令。

## 5. Benchmarkable Decision Paths

| path family | benchmarkable path | current scout coverage | decision |
| --- | --- | --- | --- |
| A task scheduling / multi agent / multi job | job status/report default view, bounded job state parsing, no full log eager read | E02 small/medium synthetic job views | WATCH for medium p95 |
| A running cap / queued / sleeping / blocked / stale / timeout / cancel | runtime scheduler state semantics | not executed by this harness; covered only by existing reports/tests | DEFERRED to focused scheduler/job stress or real smoke |
| A heavy task mutex | resource guard / heavy task serialized behavior | not executed by this harness | DEFERRED |
| A multi-agent duplicate scan/read avoidance | handoff trimmed context, workspace refs | A06 + B01/B02 synthetic only | PASS_BASELINE / WATCH in real smoke |
| B model routing / provider capability | provider-message construction, offline SSE parser | A05 + F01 synthetic/offline; no live request | WATCH for medium provider-message size; live DEFERRED |
| B unsupported tools / tool continuation / retry / errors | provider contract exists; no live error injection | not executed in this run | DEFERRED to live/failure probe |
| C context selection / cache / memory | resume hydration, full JSONL read, compact, workspace reference cache, handoff refs | A01-A06 + B01/B02 small/medium | WATCH for medium long transcript/provider-message size |
| C accepted memory topK / candidate memory | memory selection behavior | not directly executed by harness | DEFERRED |
| D transcript / log / evidence | JSONL read, log tail/grep/errors, evidence suffix lookup | A02 + C01 + D01 small/medium | PASS_BASELINE; long 50K event real transcript remains watch |
| D `/details` does not pollute primary | log/evidence details output bounded by harness notes | synthetic only | PASS_BASELINE |
| E Windows / runner supervisor | G drive temp root, CRLF/LF, Chinese log text, native fallback presenter | C01 + E03 synthetic; no native process exec | PASS_BASELINE for presenter, DEFERRED for child/grandchild cleanup stress |
| E symlink / junction escape | covered by prior performance hardening report/tests, not rerun here | existing evidence only | DEFERRED in this scout |
| F failure / anti-hallucination | doctor/status/problems presenter, no PASS from runner fallback | E01/E03 synthetic presenter | PASS_BASELINE; real cancelled/timeout/stale evidence remains smoke watch |

## 6. Scenario Matrix Coverage

| required scenario | scout coverage | decision |
| --- | --- | --- |
| small baseline | ran | PASS_BASELINE |
| medium baseline | ran | PASS_BASELINE with WATCH items |
| high synthetic/replay | not run; existing harness exposes small/medium only in this command and no runtime changes allowed | DEFERRED |
| live provider larger sample | not run due key safety boundary | DEFERRED |
| synthetic/replay larger scale isolated on G drive | small/medium generated on `G:\linghun-perf-gate` | PASS_BASELINE for current scale |
| no destructive write | only wrote G-drive artifact and this report | PASS_BASELINE |
| no real project source mutation | `packages/*` untouched | PASS_BASELINE |

## 7. Baseline Data Table

All requests/tokens/cost fields below are model-provider fields. Because this run is synthetic/offline, provider requests and provider token/cost numbers are zero. `tokensEstimate` is harness-estimated prompt/content size for local synthetic data, not billed provider tokens.

| caseId | category | input scale | provider/model/route | requests | input tokens | output tokens | cache read/write/create | estimated cost USD | latency p50/p95 ms | bytesRead | filesTouched | peak RSS MB / event loop delay ms | cache hash | failure type | route decision | cleanup | decision |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |
| A01-small-resume-hydration | C context/cache/memory | small | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 2.07 / 2.9 | 242094 | 1 | 129.3 / 0 | stable | none | Context / Compact / long transcript resume hydration | retained | PASS_BASELINE |
| A02-small-read-jsonl-full | C context/cache/memory | small | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 1.67 / 2.11 | 242094 | 1 | 134.73 / 0 | stable | none | Context / Transcript / readJsonl() full transcript read | retained | PASS_BASELINE |
| A03-small-micro-compact | C context/cache/memory | small | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 2.03 / 2.56 | 0 | 0 | 143.83 / 0 | changed | none | Context / Compact / microCompactMessages() refs collection | retained | PASS_BASELINE |
| A04-small-compact-boundary-hash | C context/cache/memory | small | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 0.07 / 0.1 | 0 | 0 | 134.68 / 0 | stable | none | Context / Compact / boundary hash stability | retained | PASS_BASELINE |
| A05-small-provider-message-construction | C context/cache/memory | small | provider-message construction / no live request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 1.94 / 2.51 | 0 | 0 | 140.51 / 0 | stable | none | Context / Provider message construction before model request | retained | PASS_BASELINE |
| A06-small-handoff-trimmed-context | C context/cache/memory | small | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 0.06 / 0.08 | 0 | 0 | 140.86 / 0 | stable | none | Context / multi-agent handoff trimmed context assembly | retained | PASS_BASELINE |
| B01-small-workspace-reference-refresh | C context/cache/memory | small | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 7.28 / 7.85 | 61440 | 120 | 141.95 / 10.06 | stable | none | Workspace Reference Cache / warmup and repeated refresh | retained | PASS_BASELINE |
| B02-small-workspace-reference-injection | C context/cache/memory | small | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 3.26 / 4.07 | 0 | 120 | 142.64 / 10 | changed | none | Workspace Reference Cache / context injection impact | retained | PASS_BASELINE |
| C01-small-log-tail-40 | D transcript/log/evidence | small | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 0.88 / 1.04 | 471101 | 1 | 143.34 / 0 | stable | none | Log Artifact / details output tail-40 | retained | PASS_BASELINE |
| C01-small-log-grep-error-context-2 | D transcript/log/evidence | small | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 5.85 / 6.18 | 471101 | 1 | 145.33 / 10.03 | stable | none | Log Artifact / details output grep-error-context-2 | retained | PASS_BASELINE |
| C01-small-log-errors | D transcript/log/evidence | small | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 5.25 / 5.71 | 471101 | 1 | 142.09 / 10.17 | stable | none | Log Artifact / details output errors | retained | PASS_BASELINE |
| D01-small-evidence-suffix-lookup | D transcript/log/evidence | small | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 0.08 / 0.19 | 0 | 0 | 141.64 / 0 | stable | none | Transcript / Evidence JSONL / details evidence lookup by id or suffix | retained | PASS_BASELINE |
| E01-small-doctor-status-problems | F failure/anti-hallucination | small | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 0.08 / 0.15 | 0 | 0 | 142.07 / 0 | stable | none | Doctor / Status / Problems default views | retained | PASS_BASELINE |
| E02-small-background-job-views | A task/job scheduling | small | job presenter / no full log eager read | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 6.56 / 6.88 | 10240 | 40 | 142.82 / 10.08 | stable | none | Background / Job status / Job report default views | retained | PASS_BASELINE |
| E03-small-runner-doctor-fallback | E Windows/runner | small | runner fallback presenter / no native exec | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 0.01 / 0.01 | 0 | 0 | 143.18 / 0 | stable | none | Doctor / Native runner missing/protocol fallback presenter | retained | PASS_BASELINE |
| F01-small-provider-sse-parser | B provider/model route | small | synthetic provider parser / no live request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 2.1 / 3.59 | 128000 | 1 | 144.89 / 0 | stable | none | Provider parser offline / synthetic SSE stream parse with tool-call-like chunks | retained | PASS_BASELINE |
| A01-medium-resume-hydration | C context/cache/memory | medium | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 19.44 / 33.21 | 2380709 | 1 | 187.07 / 30.77 | stable | none | Context / Compact / long transcript resume hydration | retained | WATCH |
| A02-medium-read-jsonl-full | C context/cache/memory | medium | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 17.59 / 26.83 | 2380709 | 1 | 254.64 / 18.46 | stable | none | Context / Transcript / readJsonl() full transcript read | retained | WATCH |
| A03-medium-micro-compact | C context/cache/memory | medium | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 22.23 / 24.54 | 0 | 0 | 242.71 / 28.74 | changed | none | Context / Compact / microCompactMessages() refs collection | retained | PASS_BASELINE |
| A04-medium-compact-boundary-hash | C context/cache/memory | medium | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 0.55 / 0.78 | 0 | 0 | 229.59 / 0 | stable | none | Context / Compact / boundary hash stability | retained | PASS_BASELINE |
| A05-medium-provider-message-construction | C context/cache/memory | medium | provider-message construction / no live request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 25.89 / 27.8 | 0 | 0 | 287.83 / 27.9 | stable | none | Context / Provider message construction before model request | retained | WATCH |
| A06-medium-handoff-trimmed-context | C context/cache/memory | medium | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 0.46 / 0.7 | 0 | 0 | 287.98 / 0 | stable | none | Context / multi-agent handoff trimmed context assembly | retained | PASS_BASELINE |
| B01-medium-workspace-reference-refresh | C context/cache/memory | medium | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 14.8 / 22.98 | 368640 | 720 | 288.04 / 14.99 | stable | none | Workspace Reference Cache / warmup and repeated refresh | retained | PASS_BASELINE |
| B02-medium-workspace-reference-injection | C context/cache/memory | medium | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 8.72 / 8.97 | 0 | 720 | 230.4 / 11.24 | changed | none | Workspace Reference Cache / context injection impact | retained | PASS_BASELINE |
| C01-medium-log-tail-40 | D transcript/log/evidence | medium | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 1.09 / 1.44 | 4831193 | 1 | 230.85 / 0 | stable | none | Log Artifact / details output tail-40 | retained | PASS_BASELINE |
| C01-medium-log-grep-error-context-2 | D transcript/log/evidence | medium | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 12.05 / 14.79 | 4831193 | 1 | 236.75 / 10.15 | stable | none | Log Artifact / details output grep-error-context-2 | retained | PASS_BASELINE |
| C01-medium-log-errors | D transcript/log/evidence | medium | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 5.7 / 6.56 | 4831193 | 1 | 234.38 / 10.39 | stable | none | Log Artifact / details output errors | retained | PASS_BASELINE |
| D01-medium-evidence-suffix-lookup | D transcript/log/evidence | medium | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 0.86 / 1.18 | 0 | 0 | 234.82 / 0 | stable | none | Transcript / Evidence JSONL / details evidence lookup by id or suffix | retained | PASS_BASELINE |
| E01-medium-doctor-status-problems | F failure/anti-hallucination | medium | local synthetic/replay / no model request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 0.08 / 0.12 | 0 | 0 | 235.19 / 0 | stable | none | Doctor / Status / Problems default views | retained | PASS_BASELINE |
| E02-medium-background-job-views | A task/job scheduling | medium | job presenter / no full log eager read | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 44.04 / 87.71 | 51200 | 260 | 238.19 / 10.13 | stable | none | Background / Job status / Job report default views | retained | WATCH |
| E03-medium-runner-doctor-fallback | E Windows/runner | medium | runner fallback presenter / no native exec | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 0.01 / 0.05 | 0 | 0 | 238.25 / 0 | stable | none | Doctor / Native runner missing/protocol fallback presenter | retained | PASS_BASELINE |
| F01-medium-provider-sse-parser | B provider/model route | medium | synthetic provider parser / no live request | 0 | 0 | 0 | 0 / 0 / 0 | 0.00 | 15.98 / 19.33 | 1280000 | 1 | 248.7 / 19.4 | stable | none | Provider parser offline / synthetic SSE stream parse with tool-call-like chunks | retained | PASS_BASELINE |

## 8. Algorithmic Signals / Optimization Space

No runtime fix was made in this scout. Based on measured data, the next data-backed optimization candidates are:

| area | signal | suggested later fix round |
| --- | --- | --- |
| E02 medium background/job views | highest p95: 87.71ms over 260 job state files | Investigate lazy/summary-first job report indexing, bounded status cache, or stable precomputed job summaries. Do not change until tied to focused correctness/perf case. |
| A01/A02 medium transcript hydration/full JSONL read | p95 33.21ms / 26.83ms over 8000 messages and 2.38MB transcript | During real smoke, watch 10K/50K real transcript resume. Consider bounded tail/indexed JSONL reader only if real transcript proves user-visible lag. |
| A05 medium provider-message construction | p95 27.8ms, charsEstimate ~2.0M, tokensEstimate ~506K synthetic | Watch context selection and prompt-size bounding before live provider. Later fix may be stricter refs/summary routing, not provider runtime rewrite. |
| B01 medium workspace reference refresh | p95 22.98ms over 720 files | Keep as PASS_BASELINE now; if multi-agent real smoke repeats scans, investigate shared cache and no duplicate scan policy. |
| F01 medium provider SSE parser | p95 19.33ms over 5000 chunks, offline only | Keep as PASS_BASELINE; live streaming latency/error behavior still must be observed with real providers. |

## 9. Decisions: PASS_BASELINE / WATCH / DEFERRED / NOT-DO

| item | decision | reason |
| --- | --- | --- |
| small synthetic baseline | PASS_BASELINE | Harness passed and artifacts generated; no failures. |
| medium synthetic baseline | PASS_BASELINE with WATCH | Harness passed; E02/A01/A02/A05 show real-smoke watchpoints, not enough for runtime changes. |
| high synthetic baseline | DEFERRED | Existing harness command generated small/medium only; high stress not necessary for scout completion and no runtime fix allowed. |
| live provider benchmark | DEFERRED | Key safety boundary: key was in chat, not safely current-shell-only env. |
| provider 502/503/504/timeout/abort/429/401/403 failure injection | DEFERRED | Not covered by offline harness; should be a future controlled live/mock failure probe. |
| running cap / queued / sleeping / blocked / stale / timeout / cancel scheduler stress | DEFERRED | Not covered by this benchmark run; existing reports/tests remain evidence, real smoke still required. |
| child/grandchild cleanup stress | DEFERRED | Runner fallback presenter measured; process-tree cleanup stress not run. |
| symlink/junction escape | DEFERRED in this scout | Covered by prior hardening gate/tests, not rerun here. |
| second provider/tool/permission/evidence/job/agent/index/runtime | NOT-DO | Explicitly forbidden. |
| runtime optimization during this scout | NOT-DO | User requested scout/baseline/report only, no runtime fix. |
| real full smoke | NOT-DO | Explicitly outside this run. |
| Beta PASS / smoke-ready / open-source-ready claim | NOT-DO | This report is not readiness proof. |
| Phase 18 / desktop / release packaging | NOT-DO | Explicitly outside this run. |

## 10. Must Remain for Real Smoke Observation

These paths must still be observed in real provider + real project smoke before any readiness claim:

- Natural language → model → tool_use → permission → tool_result → continuation → final answer.
- Live provider streaming, first-token latency, error recovery, usage/cost reporting.
- Real provider 400/401/403/429/5xx/timeout/abort classification and next action.
- Unsupported tools provider path: no tools/toolChoice sent.
- Supported provider tool_use/tool_result continuation.
- Real long transcript resume over 10K events, ideally 50K watch sample if safe.
- Real build/test logs with `/details output` tail/grep/errors.
- Multiple active/completed jobs and no eager full-log read in status/report.
- Windows Chinese/space/non-C-drive paths and drive-letter casing.
- Cancel/timeout child/grandchild cleanup.
- Native missing/crash/corrupt output/protocol mismatch fallback must not generate PASS evidence.
- Missing evidence reports must stay unknown / needs confirmation.

## 11. Safety / Stop Conditions Applied

Applied during this run:

- API cost ceiling: 0, because no live provider request was sent.
- request count ceiling: 0, because live provider was deferred.
- cleanup manifest created and limited to G-drive synthetic paths.
- G drive free space recorded by harness: 410084.07 MB free / 653865 MB total.
- No destructive writes; only report/artifact writes.
- Existing runtime diff was not touched.

Stop conditions not triggered:

- No key leakage detected at write time; final validation below must confirm.
- No cleanup manifest failure observed.
- No system CPU/memory abnormality observed during 6.17s benchmark command.
- No attempt to write real project source from benchmark.

## 12. Validation

Commands run:

| command | result |
| --- | --- |
| `git status --short` | PASS; showed pre-existing modified files and later this report as new file |
| `LINGHUN_PERF_GATE=1 ... corepack pnpm exec vitest run benchmarks/performance-windows-stability-gate.test.ts` | PASS; 1 test passed |
| `git diff --check` | to be recorded after final write |
| sensitive pattern scan over report/raw/summary/manifest | to be recorded after final write |

Focused tests beyond the benchmark harness were not run because no benchmark harness or runtime source was added/modified in the repository. The manifest is a raw artifact file under `G:\linghun-perf-gate`; this report is documentation-only.

## 13. Non-Claims

This scout does not claim:

- real full smoke coverage
- live provider coverage
- live provider streaming coverage
- high-scale benchmark coverage
- complete provider failure matrix coverage
- complete scheduler/job state-machine coverage
- complete Windows process-tree cleanup coverage
- Beta PASS
- smoke-ready
- open-source-ready
- Phase 18 readiness
- release readiness

## 14. Handoff Packet

- Current run：Pre-Real-Smoke Algorithmic Decision Benchmark Scout。
- Status：small/medium synthetic baseline completed; report generated; live provider deferred for key safety.
- Runtime modified：no。
- Current closing diff protected：`README.md`, `START_NEXT_CHAT.md`, `packages/config/src/index.ts`, `packages/tui/src/index.ts` were pre-existing and untouched by this scout.
- Artifacts：
  - `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-benchmark-scout-raw.json`
  - `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-benchmark-scout-summary.md`
  - `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-benchmark-scout-manifest.json`
  - `docs/audit/pre-real-smoke-algorithmic-decision-benchmark-scout.md`
- Next recommended action：if user wants live provider benchmark, inject temporary key only into current shell env outside report/transcript, then run a capped live probe; otherwise carry WATCH items into real smoke observation.
- Forbidden next actions without user confirmation：runtime fix, real full smoke, Phase 18, release packaging, commit, provider/tool/permission/evidence/job/agent/index/runtime replacement.
