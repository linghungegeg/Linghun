# Pre-Real-Smoke Capped Live Provider + Real Runtime Path + Real Algorithm Probe

## Summary

This probe exercised a capped subset of Linghun's real runtime paths with a live OpenAI-compatible provider and isolated G-drive test projects.

- Scope: pre-real-smoke probe only; this is not a real full smoke test.
- Verdict: probe cases completed without observed probe failures under the configured cap.
- Boundary: this does not declare Beta PASS, smoke-ready, open-source-ready, or release readiness.
- Runtime source mutation: none intended; `packages/*` runtime source was not modified by this probe.
- Live provider usage: 14 / 40 live provider requests.
- Time cap: 60 minutes hard ceiling; observed elapsed time was about 87.6 seconds.
- Estimated cost: USD 0.002124, recorded only and not used as the default stop condition.
- Provider: openai-compatible.
- Model: GPT-5.5.
- Base URL host: sub2api.toioto.org.
- API key handling: present only as runtime environment input during the live run; artifacts and this report use redacted/sanitized values.

## Probe boundaries

The probe intentionally stayed inside these limits:

- No Phase 18, desktop work, release packaging, commit, or readiness announcement.
- No second provider/tool/permission/evidence/job/agent/index/runtime implementation.
- No changes to real project runtime source under `packages/*`.
- Test writes were constrained to `G:\linghun-perf-gate\real-runtime-probe` and `G:\linghun-perf-gate\real-runtime-probe-artifacts`, except this final report under `docs/audit`.
- A single case PASS, or even all probe case PASS statuses, must not be used to infer product readiness.

## Artifact locations

- Fixture root: `G:\linghun-perf-gate\real-runtime-probe`
- Artifact root: `G:\linghun-perf-gate\real-runtime-probe-artifacts`
- Harness: `G:\linghun-perf-gate\real-runtime-probe-artifacts\live-runtime-probe.mjs`
- Raw probe artifact: `G:\linghun-perf-gate\real-runtime-probe-artifacts\pre-real-smoke-capped-live-provider-real-runtime-algorithm-probe-raw.json`
- Summary artifact: `G:\linghun-perf-gate\real-runtime-probe-artifacts\pre-real-smoke-capped-live-provider-real-runtime-algorithm-probe-summary.md`
- Logs: `G:\linghun-perf-gate\real-runtime-probe-artifacts\logs\*.txt`

## Budget and usage

| Item | Observed value |
| --- | ---: |
| Live request ceiling | 40 |
| Live requests used | 14 |
| Time ceiling | 60 minutes |
| Observed elapsed time | 87597 ms |
| Consecutive provider failures | 0 |
| Input tokens | 347 |
| Output tokens | 169 |
| Total tokens | 516 |
| Cache read tokens | 0 |
| Cache write tokens | 0 |
| Estimated cost | USD 0.002124 |

The cost value is an estimate recorded for visibility. Per the run boundary, request count and elapsed time were the hard stop conditions unless an abnormal cost spike or repeated-request loop appeared.

## Runtime path map

The probe exercised or confirmed these existing runtime paths without adding replacement systems:

- Config and provider selection:
  - project config loading via the existing config package
  - role route decision / concrete model route diagnosis
  - provider runtime contract for OpenAI-compatible chat completions
- Provider gateway:
  - `OpenAiCompatibleProvider` streaming path
  - chat completions request construction
  - usage event handling
  - provider error normalization path with controlled fake endpoints for failure classes
- Tool path:
  - existing built-in `Read`, `Grep`, `Glob`, and write/report tool paths through the tools/TUI runtime
  - model tool schema emission and direct provider tool-use continuation
- Permission path:
  - approval path for report writing in the isolated G-drive fixture
  - denial/cancel path where the requested target was not created
- Evidence/output boundary:
  - transcript/log/evidence paths were probed through bounded artifacts rather than raw full-log primary output

## Algorithm path map

The probe covered these decision areas as runtime or synthetic-state checks:

- local control-plane decisions for model status and unsupported tool profiles
- role-based routing decisions for planner, executor, reviewer, verifier, summarizer, vision, and image routes
- context selection behavior across small, medium, and large isolated projects
- large log / large output file reference behavior rather than eager full-content injection
- scheduler/job state behavior for synthetic 1/3/5/8 agent-cap scenarios
- long transcript and evidence lookup boundaries using generated 50K-event stress data
- Windows path and Chinese stdout/stderr preservation in isolated fixtures
- anti-hallucination boundary that prevents a single probe PASS from implying readiness

## Case results

| Case | Status | Live requests | Scope note |
| --- | --- | ---: | --- |
| A01-model-doctor-local-route | PASS | 0 | model doctor completed locally |
| A02-live-text-direct-provider | PASS | 1 | assistant text returned from live provider |
| A03-control-plane-natural-local | PASS | 0 | natural model status query handled locally |
| A04-unsupported-tools-profile-local-guard | PASS | 0 | guard returned `MODEL_TOOLS_UNSUPPORTED` |
| A05-supported-tools-live-schema-direct | PASS | 1 | provider emitted tool_use |
| B01-read-grep-glob-real-tools | PASS | 0 | existing local tool runtime used |
| B02-live-tool-use-continuation-direct | PASS | 2 | live provider continuation with local tool_result |
| B03-live-tui-report-permission-continuation | PASS | 6 | live TUI report written in G-drive fixture |
| B04-deny-cancel-path-tui | PASS | 4 | denied write did not create target |
| C01-context-selection-small-medium-large | PASS | 0 | large logs and large-output files remained references only |
| D01-model-routing-local-decisions | PASS | 0 | role routes recorded; unsupported tools kept off summarizer |
| E01-scheduler-job-synthetic-1-3-5-8 | PASS | 0 | synthetic state view only; no infinite agents started |
| F01-long-transcript-log-evidence | PASS | 0 | 50K transcript generated; bounded slices only |
| H01-failure-classifier-fake-401-429-500-timeout | PASS | 0 | controlled fake endpoint; no live cost |
| I01-windows-path-output | PASS | 0 | Chinese path/stdout/stderr preserved |
| J01-anti-hallucination-boundary | PASS | 0 | no single case infers readiness |

## Live versus local/fake/synthetic coverage

Live provider rows were limited to:

- A02 live text direct provider
- A05 supported tools live schema direct
- B02 live tool-use continuation direct
- B03 live TUI report permission continuation
- B04 deny/cancel path through live TUI flow

The remaining rows were intentionally local, fake-endpoint, or synthetic-state probes:

- Local/control-plane/tool/context/path rows: A01, A03, A04, B01, C01, D01, F01, I01, J01
- Synthetic scheduler/job state row: E01
- Controlled fake provider failure classifier row: H01

This split is intentional for a capped pre-real-smoke probe. It does not replace a full real project smoke.

## Sensitive-data handling

- The live key was not written into this report.
- The harness file reads provider settings from process environment variables and does not embed the key.
- Artifact summaries use provider/model/host-level metadata and redacted key presence only.
- Post-run sensitive scanning passed across this report and the G-drive artifact tree.

The temporary provider key used for the live rows should be rotated or revoked after the probe.

## Validation status

Completed after report generation:

- `git diff --check`
- sensitive scan over this report and `G:\linghun-perf-gate\real-runtime-probe-artifacts`
- `corepack pnpm typecheck`
- final repository state check

## Validation results

| Check | Result | Evidence |
| --- | --- | --- |
| `git diff --check` | PASS | command completed with no output |
| Sensitive scan | PASS | `SENSITIVE_SCAN_PASS files=27` |
| `corepack pnpm typecheck` | PASS | `tsc -b tsconfig.json` completed |
| Repository state | PASS with expected untracked files | final report is untracked; previous benchmark/audit files remain untracked; no tracked runtime source changes were reported by `git status --short` |

## Known limitations

- This was not a real full smoke test against a real user project.
- The scheduler/job/multi-agent row was a synthetic state probe, not a real long-running multi-agent job launch.
- The failure-classifier row used controlled fake endpoints, not live provider-induced 401/429/500/timeout events.
- Passing probe rows do not prove release readiness, model quality, cost stability under real usage, or open-source readiness.
- The current result only supports continuing toward a separately approved real smoke step.

## Handoff packet

- Current stage: pre-real-smoke capped live provider/runtime/algorithm probe.
- Next allowed step: finish validation and then, only with user approval, design a real full smoke run.
- Forbidden next steps without explicit user approval: Beta PASS announcement, smoke-ready declaration, Phase 18, desktop, release packaging, commit, or provider/runtime rewrites.
- Evidence references:
  - raw artifact: `G:\linghun-perf-gate\real-runtime-probe-artifacts\pre-real-smoke-capped-live-provider-real-runtime-algorithm-probe-raw.json`
  - summary artifact: `G:\linghun-perf-gate\real-runtime-probe-artifacts\pre-real-smoke-capped-live-provider-real-runtime-algorithm-probe-summary.md`
  - logs: `G:\linghun-perf-gate\real-runtime-probe-artifacts\logs\*.txt`
- Provider/model: openai-compatible / GPT-5.5.
- Budget: 14 / 40 live provider requests; 87597 ms under 60 minutes; estimated cost USD 0.002124.
- Index status: codebase-memory project `F-Linghun` was previously observed ready during probe preparation; source facts were still confirmed through direct file/source reads where needed.
- Permission mode: probe used isolated G-drive writes and TUI permission paths; no runtime source mutation was intended.
