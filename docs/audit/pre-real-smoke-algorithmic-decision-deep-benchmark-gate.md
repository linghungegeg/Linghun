# Pre-Real-Smoke Algorithmic Decision Deep Benchmark Gate

## 0. Boundary markers

- not real smoke: this gate is a pre-real-smoke benchmark/profiling/stress gate, not a real project smoke.
- deep synthetic/proxy benchmark only: this run uses synthetic datasets, mock/proxy decision rows, and local harness measurements; it is not a live provider benchmark and not real runtime function-call profiling of Linghun production call paths.
- no keys stored: no provider credential, auth header, bearer-style credential, cookie credential, access credential, or full secret query is intentionally written to this report or generated artifacts.
- no commit: this gate does not create a git commit.
- no second runtime: this gate adds a non-runtime benchmark harness only; it does not introduce a second provider/tool/permission/evidence/job/agent/index/runtime system.
- no implementation-source reuse: `benchmarks/algorithmic-decision-gate.test.ts` is benchmark/proxy harness evidence only and must not be used as the source for a second routing, scheduling, context-selection, or evidence implementation.
- no Beta PASS / smoke-ready / open-source-ready claim: focused benchmark results below are baseline evidence only.
- no Phase 18 / desktop / release packaging work is included.

## 1. Scope

This report records the **Pre-Real-Smoke Algorithmic Decision Deep Benchmark Gate** for Linghun.

Allowed work in this gate:

- Add/update benchmark or test harness files under non-runtime paths.
- Generate raw benchmark artifact, summary, manifest, and this audit report.
- Run focused validation and sensitive-information scans.

What this gate is:

- A deep synthetic/proxy benchmark over generated datasets and local/mock decision probes.
- A baseline for pre-real-smoke pressure points and WATCH/SKIPPED rows.

What this gate is not:

- Not a live provider benchmark; live provider rows are skipped when no safe process env key is present.
- Not真实 runtime function-call profiling of Linghun's production routing, scheduling, context-selection, evidence, or provider call paths.
- Not proof that the current runtime implementation is smoke-ready.

Forbidden work in this gate:

- No `packages/*` runtime source fix or Provider/Auth Config Center closeout fix.
- No current development-line runtime behavior change.
- No destructive cleanup of user files.
- No full real project smoke.
- No release/readiness claim derived from this gate.

## 2. Harness added

| file | purpose | runtime impact |
| --- | --- | --- |
| `benchmarks/algorithmic-decision-gate.test.ts` | Opt-in Vitest benchmark harness for A-F algorithmic decision-chain profiling/stress. Writes artifacts to `G:\linghun-perf-gate` by default. | Non-runtime benchmark file only. It is gated by `LINGHUN_ALGORITHMIC_DECISION_GATE=1`. |

Harness boundary:

- This file is not a runtime module and is not imported by `apps/*` or `packages/*`.
- It must not be treated as the implementation source for Linghun routing, model selection, scheduler behavior, context selection, evidence policy, provider behavior, permission handling, job runtime, agent runtime, or index/runtime systems.
- Any future runtime work must read and modify the actual runtime sources, not copy proxy decisions from this benchmark harness.

The harness default outputs are:

- Raw JSON: `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-deep-benchmark-gate-raw.json`
- Summary markdown: `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-deep-benchmark-gate-summary.md`
- Manifest JSON: `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-deep-benchmark-gate-manifest.json`

## 3. Artifact manifest

Generated synthetic dataset root:

- `G:\linghun-perf-gate\algorithmic-decision-deep-1779608023919`

Synthetic dataset totals:

| scale | path | files | bytes | notes |
| --- | --- | ---: | ---: | --- |
| small | `G:\linghun-perf-gate\algorithmic-decision-deep-1779608023919\small-project` | 96 | 908648 | Small synthetic decision dataset. |
| medium | `G:\linghun-perf-gate\algorithmic-decision-deep-1779608023919\中型 Project With Spaces` | 488 | 4937021 | Medium synthetic decision dataset with spaces / Chinese path coverage. |
| large | `G:\linghun-perf-gate\algorithmic-decision-deep-1779608023919\大型 项目` | 1292 | 18391435 | Large synthetic decision dataset with Chinese path coverage. |
| total | `G:\linghun-perf-gate\algorithmic-decision-deep-1779608023919` | 1876 | 24237104 | Retained for audit. |

Cleanup policy: retained for audit. Any later cleanup should target only paths listed above and the generated artifact files named in this report.

## 4. Execution summary

Focused benchmark command used the opt-in harness environment and generated artifacts under `G:\linghun-perf-gate`.

Result:

- Focused benchmark: PASS.
- Test file: `benchmarks/algorithmic-decision-gate.test.ts`
- Records: 79.
- Warmup: 1 per case.
- Iterations: 3 default; key cases use 5.
- Live provider calls: no.
- Real project smoke: no.
- Runtime source modified by benchmark: no.

Live probe status:

- `attempted`: false
- `requestsCeiling`: 6
- `requestsUsed`: 0
- `status`: skipped
- Reason: no live provider API key was present in the benchmark process environment, and no usable key assignment was recovered for safe one-process injection during this continuation. The gate therefore records live-provider coverage as `SKIPPED`, not PASS.

## 5. A-F coverage matrix

| category | records | required stress coverage | result summary |
| --- | ---: | --- | --- |
| A. Context Selection / Prompt Size | 18 | small / medium / large | Covered local context selection, prompt-size proxy, selected refs, missing refs, duplicate reads, cache hash. |
| B. Model Routing / Provider Capability | 20 | mock + skipped live | Covered control-plane no-model path, provider tool loop, cheap/strong/verifier/summarizer routes, unsupported tools, tool continuation, mock 400/401/403/429/502/503/504/timeout/abort, and live skipped rows. |
| C. Scheduler / Multi Agent / Job | 10 | large/high | Covered synthetic running cap, heavy mutex, duplicate scan watch, blocked/stale/timeout/cancel state guard, bounded job report/log view. |
| D. Long Transcript / Log / Evidence | 12 | small / medium / large | Covered resume hydration, evidence lookup, micro/manual compact, large log tail/grep/errors at 1K / 10K / 50K transcript-event scales. |
| E. Windows / Runner Supervisor | 9 | large/high | Covered path case, spaces, non-C drive, drive-letter casing, symlink/junction escape proxy, native missing/corrupt/protocol mismatch fallback, timeout/cancel sentinel cleanup. |
| F. Anti-Hallucination / Evidence Boundary | 10 | mock boundary cases | Covered missing evidence, cancelled/timeout/stale/blocked not-PASS semantics, mock/focused/live pass not-ready claim guard, raw provider body not primary, failure next action. |

## 6. Aggregate metrics

| field | value |
| --- | ---: |
| records | 79 |
| PASS_BASELINE | 69 |
| WATCH | 6 |
| SKIPPED | 4 |
| live requests used | 0 |
| total B mock/mock-failure requests | 16 |
| synthetic files generated | 1876 |
| synthetic bytes generated | 24237104 |

Category rollup:

| category | records | max p95 ms | missing refs | duplicate reads | requests |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 18 | 0.17 | 4 | 0 | 0 |
| B | 20 | 0.01 | 0 | 0 | 16 |
| C | 10 | 0.16 | 0 | 14 | 0 |
| D | 12 | 37.99 | 0 | 0 | 0 |
| E | 9 | 607.44 | 0 | 0 | 0 |
| F | 10 | 0.01 | 1 | 0 | 0 |

Scale rollup:

| scale | records |
| --- | ---: |
| small | 10 |
| medium | 10 |
| large | 29 |
| mock | 26 |
| live | 4 |

## 7. Top latency p95 rows

| caseId | category | scale | p95 ms | decision | notes |
| --- | --- | --- | ---: | --- | --- |
| `E-runner-timeout-cancel-sentinel` | E.Windows.RunnerSupervisor | large | 607.44 | PASS_BASELINE | Controlled temp process / no project write; cleanup completed. |
| `D-large-large-log-tail-grep-errors` | D.LongTranscript.Log.Evidence | large | 37.99 | PASS_BASELINE | Local log details, bounded bytes read. |
| `D-large-resume-hydration` | D.LongTranscript.Log.Evidence | large | 28.57 | WATCH | Large transcript hydration watch row. |
| `D-medium-large-log-tail-grep-errors` | D.LongTranscript.Log.Evidence | medium | 21.19 | PASS_BASELINE | Local log details. |
| `D-large-micro-manual-compact` | D.LongTranscript.Log.Evidence | large | 21.13 | PASS_BASELINE | Local compact without summarizer request. |
| `D-large-evidence-lookup` | D.LongTranscript.Log.Evidence | large | 20.81 | PASS_BASELINE | Local evidence lookup. |

## 8. WATCH and SKIPPED decisions

WATCH rows:

| caseId | reason |
| --- | --- |
| `B-mock-provider-400` | Mock provider 400 remains a watch/fix-recommended classifier boundary; evidence status is `needs_confirmation`. |
| `C-scheduler-8-agents-cap` | Duplicate scan proxy reached watch threshold at high synthetic agent count. |
| `C-scheduler-8-heavy-mutex` | Duplicate scan proxy reached watch threshold under heavy mutex scenario. |
| `C-scheduler-blocked-stale-timeout-cancel` | Non-PASS state guard is intentionally watched and recorded as `not_pass`. |
| `D-large-resume-hydration` | Large transcript hydration p95/event-loop delay is above small/medium baseline and should remain visible before real smoke. |
| `E-windows-symlink-junction-escape` | Lexical escape risk proxy is intentionally watch-only; no product runtime fix in this gate. |

Retained WATCH / SKIPPED signals required for handoff:

- 8-agent duplicate scan remains WATCH: `C-scheduler-8-agents-cap` and `C-scheduler-8-heavy-mutex` are not normalized away.
- Large transcript hydration remains WATCH: `D-large-resume-hydration` stays visible as pre-real-smoke risk evidence.
- Live provider remains SKIPPED: no live provider readiness is inferred from skipped rows.

SKIPPED rows:

- `B-live-skipped-basic-text`
- `B-live-skipped-tool-capable`
- `B-live-skipped-report-generation-style`
- `B-live-skipped-short-abort`

Skipped live rows do not count as provider readiness evidence.

## 9. Safety and evidence notes

- The harness generated synthetic local projects only; it did not run a real repository smoke.
- Provider mock rows are local decision/proxy rows; they do not prove live-provider readiness.
- The runner timeout/cancel row uses a controlled temporary process and sentinel cleanup; it does not modify project runtime files.
- `primarySafe` rows verify that raw provider body / UUID / raw tool result style evidence remains out of the primary-facing decision surface in the synthetic boundary cases.
- Cancelled, timeout, stale, and blocked conditions are represented as non-PASS evidence semantics in the boundary cases.

## 10. Validation performed

| check | command / method | result |
| --- | --- | --- |
| codebase index status | `mcp__codebase-memory-mcp__index_status` for `F-Linghun` | ready: 1940 nodes, 4137 edges |
| focused benchmark | `LINGHUN_ALGORITHMIC_DECISION_GATE=1 ... corepack pnpm exec vitest run benchmarks/algorithmic-decision-gate.test.ts` | PASS: 1 test passed, artifacts regenerated |
| benchmark harness check | `corepack pnpm exec biome check benchmarks/algorithmic-decision-gate.test.ts` | PASS |
| raw artifact parse | JSON parse and aggregate summary over `pre-real-smoke-algorithmic-decision-deep-benchmark-gate-raw.json` | PASS: 79 records, A-F coverage present |
| diff whitespace check | `git diff --check` | PASS; Git emitted only the existing LF-to-CRLF working-copy warning for `.gitignore` |
| sensitive artifact scan | scanned report/raw/summary/manifest for credential/header/secret markers | PASS |
| live key boundary | one-process env extraction attempt without printing secret values | no usable key found; live rows recorded as SKIPPED |

## 11. Existing out-of-scope repository health notes

Earlier focused repository checks observed unrelated current development-line failures in runtime/config closeout work. This gate does not fix them because the user explicitly prohibited runtime source changes in this benchmark gate.

Current `git status --short` includes files from Provider/Auth Config Center or other closeout diffs that are not benchmark-gate ownership:

- `.gitignore`
- `.env.example`
- `README.md`
- `START_NEXT_CHAT.md`
- `apps/cli/src/cli.ts`
- `apps/cli/src/main.test.ts`
- `docs/delivery/README.md`
- `docs/delivery/pre-smoke-closure-c-provider-auth-config-center.md`
- `packages/config/src/index.ts`
- `packages/config/src/index.test.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`

Benchmark gate touched / owns only:

- `benchmarks/algorithmic-decision-gate.test.ts`
- `docs/audit/pre-real-smoke-algorithmic-decision-deep-benchmark-gate.md`
- `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-deep-benchmark-gate-raw.json`
- `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-deep-benchmark-gate-summary.md`
- `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-deep-benchmark-gate-manifest.json`
- `G:\linghun-perf-gate\algorithmic-decision-deep-1779608023919\*`

Related prior scout artifact also present but separate from this deep gate:

- `docs/audit/pre-real-smoke-algorithmic-decision-benchmark-scout.md`

Known out-of-scope examples from the pre-existing working tree:

- `packages/tui/src/index.ts`: unresolved `hasSelectedProviderConfigProblem` reference in prior runtime diff.
- Provider/Auth Config Center closeout test/load issue involving an invalid regular expression.

These are not introduced by the benchmark harness and should be handled in the relevant runtime closeout task.

## 12. Reference check

Linghun documents and prior artifacts used for this gate:

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- Completed phase delivery documents as previously read in this working session.
- Prior scout artifacts under `G:\linghun-perf-gate` and `docs/audit/pre-real-smoke-algorithmic-decision-benchmark-scout.md`.
- Existing benchmark pattern from `benchmarks/performance-windows-stability-gate.test.ts`.

Reference use was behavioral/structural only. No suspicious source implementation, proprietary internal API, or second runtime was copied into Linghun.

## 13. Handoff packet

- Next stage: complete the required verification scans, then decide separately whether to run a real smoke when runtime closeout issues are resolved and a live provider key is safely present in process env.
- Do not infer: Beta PASS, smoke-ready, open-source-ready, release-ready, Phase 18 readiness, or provider readiness from this benchmark alone.
- Evidence paths:
  - `benchmarks/algorithmic-decision-gate.test.ts`
  - `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-deep-benchmark-gate-raw.json`
  - `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-deep-benchmark-gate-summary.md`
  - `G:\linghun-perf-gate\pre-real-smoke-algorithmic-decision-deep-benchmark-gate-manifest.json`
  - `docs/audit/pre-real-smoke-algorithmic-decision-deep-benchmark-gate.md`
- Index status: `F-Linghun` ready at the time of this gate.
- Permission/model/provider budget: benchmark used local synthetic execution; live provider request budget ceiling was 6, actual requests used 0.
- Forbidden next actions without explicit user approval: runtime fixes under `packages/*`, dependency/config changes, cleanup/deletion of retained artifacts, commit creation, real full smoke, release packaging.
