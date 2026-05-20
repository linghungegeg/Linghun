# Phase 15 Real-Project Beta Decision Review

> 日期：2026-05-20  
> 范围：基于最新 Phase 15 reconciliation、runtime cleanup、Gate F dual-provider live report-generation smoke、Phase 15 readiness / closure / live smoke 报告，输出是否可进入用户决策。  
> 约束：不修改代码；不自动宣布 Beta readiness PASS；不自动开始 Phase 15 Beta / 15.5 / 16+。

## Decision recommendation: READY_FOR_USER_DECISION

本 review 只建议进入 **Phase 15 real-project Beta decision review**，即由用户决定是否开始真实项目 Beta。它不等同于 Phase 15 Beta readiness PASS，也不自动启动 Beta。

## 1. Evidence sources reviewed

- `docs/audit/phase-15-pre-beta-non-real-test-completeness-reconciliation.md`
- `docs/audit/phase-15-pre-beta-runtime-artifact-decision-guard-cleanup-report.md`
- `docs/audit/phase-15-gate-f-dual-provider-live-report.md`
- `docs/audit/phase-15-pre-beta-verdict-evidence-gate.md`
- `docs/audit/phase-15-pre-beta-ccb-grade-runtime-acceptance-closure.md`
- `docs/audit/phase-15-pre-beta-end-to-end-ccb-user-journey-parity-closure.md`
- `docs/audit/phase-15-pre-beta-ccb-deep-parity-closure-report.md`

Index / workspace evidence:

- codebase-memory project：`F-Linghun`
- latest index status：ready，nodes=`1282`，edges=`2318`
- `detect_changes(project=F-Linghun)`：`changed_count=0`

## 2. Decision gate summary

| Gate | Status | Evidence | Decision impact |
| --- | --- | --- | --- |
| Remaining BLOCKING from P15-A1..P15-A8 | **0 / holds** | latest reconciliation report counts: DONE=2, PARTIAL=5, BLOCKING=0, DEFERRED=1 | Allows user decision review to begin. |
| P15-A4 provider/gateway request identity | **DONE** | provider request identity uses `@linghun/shared` constants; no fabricated `HTTP-Referer`; targeted provider tests/check/typecheck PASS | No longer blocks decision review. |
| P15-A8 hardcoded artifact sweep | **DONE** | runtime cleanup report: no phase/smoke/Gate/private gateway artifacts in runtime user-visible paths; key leakage check clean | No longer blocks decision review. |
| Gate F dual-provider live report-generation | **PASS, scoped** | DeepSeek and OpenAI-compatible real TUI report-generation smoke both PASS; Write evidence and final answer references recorded | Satisfies scoped live report-generation evidence, but not sufficient for automatic Beta readiness PASS. |
| Beta verdict evidence guard | **PASS for guard behavior** | cleanup report: arbitrary Write evidence no longer upgrades readiness to PASS | Prevents false readiness PASS. |
| Full Beta readiness | **NOT CLAIMED** | remaining PARTIAL/DEFERRED risks and explicit no-auto-advance boundary | Requires explicit user decision and Beta gate scope. |

## 3. Remaining BLOCKING = 0

**Conclusion: remaining BLOCKING = 0 holds for P15-A1 through P15-A8.**

Latest reconciliation status table:

| ID | Reconciled status |
| --- | --- |
| P15-A1 | PARTIAL |
| P15-A2 | PARTIAL |
| P15-A3 | PARTIAL |
| P15-A4 | DONE |
| P15-A5 | PARTIAL |
| P15-A6 | PARTIAL |
| P15-A7 | DEFERRED |
| P15-A8 | DONE |

Counts:

| Status | Count |
| --- | ---: |
| DONE | 2 |
| PARTIAL | 5 |
| BLOCKING | 0 |
| DEFERRED | 1 |

This is enough to enter a user decision review, but not enough to declare Beta readiness PASS.

## 4. Remaining PARTIAL items: Beta decision risk review

### P15-A1 — Agent / multi-agent lifecycle

- Status：PARTIAL
- Why it does not block Phase 15 real-project Beta decision:
  - Current Phase 15 Beta decision does not require mature concurrent multi-agent lifecycle as a hard gate.
  - Existing baseline provides visible `/agents` / `/fork` style status and synchronous/downgraded behavior, so it should not pretend background autonomy exists.
  - The risk is capability maturity, not a current blocking safety defect, as long as Beta scope does not market mature autonomous team mode.
- What to observe during real-project Beta:
  - Whether `/fork explorer|planner|verifier` and `/agents` status remain honest about sync/background limits.
  - Whether agent outputs are clearly scoped and do not silently modify or override main-session decisions.
  - Whether verifier-like outputs are treated as scoped evidence, not global readiness proof.
- Pause and return to fix if:
  - Runtime shows fake background/running state after work actually completed or failed.
  - Agent output is adopted as final without user-visible evidence or approval boundary.
  - Agent/fork path bypasses permissions, budget boundaries, or creates confusing untracked state.

### P15-A2 — Learning / Memory / Skill evolution

- Status：PARTIAL
- Why it does not block Phase 15 real-project Beta decision:
  - Full controllable learning loop is explicitly Phase 16 work.
  - Current Phase 15 baseline is manual/candidate-first memory, which is acceptable if Beta scope does not claim automatic “越用越聪明”.
  - Existing boundary avoids automatic long-term write and prompt pollution as a required Beta safety constraint.
- What to observe during real-project Beta:
  - Memory candidate/review/accept/delete paths remain explicit and user-controlled.
  - Accepted memory does not inject full private transcript or large prompt payloads.
  - Skills remain summary-first and load-on-demand.
- Pause and return to fix if:
  - Linghun writes long-term memory automatically without user approval.
  - Prompt starts including full memory/transcript rather than relevant summaries.
  - Memory accept/delete causes stale cache, hidden state, or irreversible user data persistence.

### P15-A3 — MCP / Skills / Plugins Connect Lite

- Status：PARTIAL
- Why it does not block Phase 15 real-project Beta decision:
  - codebase-memory deferred tool guard is now implemented and tested for discovery/schema/required-args safety.
  - Connect Lite remains local/manifest-focused; full MCP/skills/plugins ecosystem lifecycle can remain outside Phase 15 Beta hard gate if not advertised as complete.
  - Unknown or under-specified deferred tools are rejected rather than blindly executed.
- What to observe during real-project Beta:
  - `/mcp doctor`, `/mcp status`, plugin/skill enable-disable, and codebase-memory deferred guard behavior.
  - Missing required args and unknown tool calls should produce explicit refusal, not token-wasting blind execution.
  - Trust notices and permission boundaries should remain visible for skill/plugin surfaces.
- Pause and return to fix if:
  - Unknown MCP/deferred tools execute without prior discovery/schema registration.
  - Missing required args cause blind tool execution or large token waste.
  - Plugin/skill/hook path bypasses permission pipeline or hides source/trust boundaries.

### P15-A5 — TUI / help / doctor / hints / output polish

- Status：PARTIAL
- Why it does not block Phase 15 real-project Beta decision:
  - Runtime cleanup removed stale phase/smoke artifacts from ordinary help/prompt surfaces.
  - Core summary-first, primary/details/debug boundaries have evidence, but some polish surfaces were not fully revalidated.
  - Rich/narrow-terminal polish can remain Beta observation / Phase 15.5 hardening if ordinary safety and actionability hold.
- What to observe during real-project Beta:
  - `/help`, `/model doctor`, `/mcp doctor`, `/details`, long tool output, narrow terminal display, and cache hint repetition.
  - Whether ordinary output remains product-facing and does not expose internal gate/verdict terminology unless explicitly requested.
  - Whether errors provide clear next action without raw JSON, keys, headers, or full transcript.
- Pause and return to fix if:
  - Help/doctor output reintroduces stale Beta PASS, Gate F, phase artifact, smoke marker, or private provider wording.
  - Long output floods primary screen without full-output/evidence path.
  - Narrow terminal or bilingual key path becomes unusable for core Beta actions.

### P15-A6 — Provider / model / usage / cache / quota

- Status：PARTIAL
- Why it does not block Phase 15 real-project Beta decision:
  - Provider/profile/cache/usage source labels have baseline evidence.
  - P15-A4 request identity is DONE, and Gate F proves scoped dual-provider report-generation path.
  - True quota/balance/billing source reconciliation is not required to start user decision review if not claimed as complete.
- What to observe during real-project Beta:
  - `/usage`, `/stats`, `/stats endpoints`, `/model route doctor`, fallback/error classes, usage/cache source labels.
  - Whether gateway-specific usage fields are labelled reported/estimated/missing rather than asserted as billing truth.
  - Whether unsupported tools / 400 / 401 / 403 / 429 / 5xx remain actionable and secret-safe.
- Pause and return to fix if:
  - Linghun reports estimated cost/quota as real provider billing.
  - Provider errors leak raw key, Authorization header, private baseUrl, prompt, or response body secrets.
  - OpenAI-compatible or DeepSeek path loses identity headers, tool support diagnostics, or permission continuation.

## 5. DEFERRED item to keep out of Beta readiness claims

### P15-A7 — Freshness / Web evidence

- Status：DEFERRED
- Decision impact:
  - Does not block Phase 15 real-project Beta decision if Beta scope avoids unsourced “latest/current” external claims.
  - Full Freshness Gate runtime workflow remains Phase 15.5 boundary.
- Observe during Beta:
  - Any claim involving current external docs, pricing, provider capabilities, or third-party state must cite fresh web/source evidence or be downgraded.
- Pause and return to fix if:
  - Beta reports claim latest/current external facts without source URL/date/evidence.
  - WebFetch/WebSearch failures are ignored while still presenting current claims.

## 6. Gate F dual-provider live report-generation

**Conclusion: Gate F dual-provider live report-generation remains PASS, scoped.**

From `phase-15-gate-f-dual-provider-live-report.md` and cleanup recheck:

- DeepSeek Gate F：PASS
  - provider：`deepseek`
  - model：`deepseek-chat`
  - base URL：`https://api.deepseek.com/v1`
  - tool chain：Glob/Read/Write → permission approval → model continuation → final answer
  - Write evidence ID：`46b2e850-c15e-48a5-9672-4b72a53709e4`
  - final answer references `gate-report.md`
- OpenAI-compatible Gate F：PASS
  - provider：`openai-compatible`
  - model：`gpt-5.5`
  - base URL：private gateway evidence recorded in the Gate F report
  - tool chain：Glob/Write → permission approval → model continuation → final answer
  - Write evidence ID：`1e555f9a-ec2a-419a-898d-e9e8e1bc10af`
  - final answer references `gate-report.md`

Boundary:

- Gate F PASS proves scoped real TUI report-generation live smoke for the tested providers.
- It does not prove all OpenAI-compatible gateways, all models, all real projects, or full Phase 15 Beta readiness.
- It must not auto-start Beta.

## 7. P15-A4 provider/gateway request identity

**Conclusion: P15-A4 is DONE.**

Evidence from latest reconciliation:

- Provider request path now sets safe identity headers:
  - `User-Agent` derived from `LINGHUN_NAME`, `LINGHUN_VERSION`, and `LINGHUN_CLI_NAME`.
  - `X-Title` uses `LINGHUN_NAME`.
  - `X-OpenRouter-Title` uses `LINGHUN_NAME`.
- No hardcoded version remains in the identity value.
- `HTTP-Referer` is not set because there is no existing public project URL config; no source is fabricated.
- `@linghun/shared` dependency is necessary and minimal because providers needs existing shared product/version/CLI constants.
- Targeted tests confirm public/sanitized identity headers do not contain key markers, Authorization value, local/project/user path, prompt content, or private baseUrl query.

## 8. P15-A8 hardcoded artifact sweep

**Conclusion: P15-A8 is DONE.**

Evidence from cleanup report and reconciliation:

- Runtime user-visible source sweep found no `Phase 15 preflight`, `DEPLOY_REPORT.md`, `PHASE15_RC`, `Gate F`, or private gateway artifact in runtime paths.
- Remaining phase/provider/model/base_url references were scoped to tests, provider defaults, or audit evidence.
- Provider missing-base-url suggestion no longer hardcodes DeepSeek URL.
- Key leakage check found no real API key leakage.

## 9. Recent validation results

From final cleanup and P15-A4 closure validation:

| Command | Latest recorded result |
| --- | --- |
| `corepack pnpm exec vitest run packages/providers/src/index.test.ts` | PASS：1 file / 28 tests passed |
| `corepack pnpm check` | PASS：Checked 47 files，No fixes applied |
| `corepack pnpm typecheck` | PASS：`tsc -b tsconfig.json` clean |
| `corepack pnpm test` | PASS：11 files / 271 tests passed in P15-A4 closure verification; cleanup report recorded 11 files / 269 tests before P15-A4 tests were added |
| `corepack pnpm build` | PASS：7/8 workspace projects built |
| `git diff --check` | PASS：no whitespace errors; only Windows CRLF warnings when present |

## 10. Decision recommendation

**READY_FOR_USER_DECISION**

Rationale:

- remaining BLOCKING = 0 holds for P15-A1 through P15-A8.
- P15-A4 provider/gateway request identity is DONE.
- P15-A8 hardcoded artifact sweep is DONE.
- Gate F dual-provider live report-generation remains PASS, scoped.
- check/typecheck/test/build have recent PASS evidence.
- Remaining PARTIAL items are decision-review risks, not current blockers, provided Beta scope does not overclaim them.

This is not Phase 15 Beta readiness PASS. The next valid step is for the user to decide whether to start Phase 15 real-project Beta, with explicit acceptance of the 5 PARTIAL items and 1 DEFERRED Freshness boundary.
