# Phase 15 Pre-Beta Red Flag Reconciliation

> Scope: reconciliation of `docs/audit/phase-15-pre-beta-red-flag-sweep.md` plus the current minimal red-line fix window. This document only assigns phase ownership and current-round boundaries. It does not start Phase 15 real-project Beta, does not enter Phase 15.5 / Phase 16+, and does not declare Beta PASS.

## Reclassification summary

| Bucket | Items | Decision |
| --- | --- | --- |
| Phase 15 real-project Beta 前必须修复 | RF-B01, RF-B04, RF-B05, RF-B06, RF-B07, RF-B08 | Current-round blocking red-line scope. Must be fixed and verified before the user can make the next Beta decision. |
| Safety reconciliation / current tail | RF-B02, RF-W05 | RF-B02 is covered by the committed project-settings API-key safety fix; RF-W05 remains a small current-round tail if env source suppresses residual project-key warning. |
| Phase 15 Beta-watch / 实测观察 | RF-W01, RF-W02, RF-W03, RF-W04, RF-W06, RF-W07 | Watch during Beta or runbook/smoke follow-up. Not blocking the current red-line fix unless live evidence shows runtime pollution. |
| Phase 15.5 / release hardening | RF-B03, RF-P01, RF-P02 | Deferred to Phase 15.5 / release hardening. RF-B03 is important but out of this current minimal red-line scope because it requires centralized transcript/report/handoff redaction boundary. |
| NOT-DO / no-action | RF-N01, RF-N02, RF-N03, RF-N04, RF-N05 | Keep no-action unless future evidence shows current runtime pollution. |

## A. Current Phase 15 pre-Beta blockers to fix now

### RF-B01 — doctor/config source attribution

- **Current bucket:** Phase 15 real-project Beta 前必须修复.
- **Required current fix:** Doctor output must not claim `source=user-settings` unless a real user-settings loader/source tracker exists. Use a non-claiming source such as `merged-config` or `unknown/private-config` for non-env, non-current-project merged runtime config.
- **Verification:** No-env/no-project-key doctor tests must not contain `source=user-settings`.

### RF-B04 — provider fetch/header request timeout

- **Current bucket:** Phase 15 real-project Beta 前必须修复.
- **Required current fix:** Add a request/header timeout around provider `fetch`, distinct from stream idle timeout. Surface actionable `PROVIDER_REQUEST_TIMEOUT` rather than hanging before response headers.
- **Verification:** Mock fetch that never resolves must fail through the timeout path without infinite retry.

### RF-B05 — provider failure evidence and doctor last-error

- **Current bucket:** Phase 15 real-project Beta 前必须修复.
- **Required current fix:** HTTP 400/502, SSE error, stream idle timeout, and request timeout must be persisted as sanitized transcript/evidence and be visible as last provider failure summary in model doctor.
- **Verification:** Failure tests must assert no API key, prompt, full local path, or private baseUrl leak.

### RF-B06 — report incomplete guard

- **Current bucket:** Phase 15 real-project Beta 前必须修复 for report-generation Beta paths.
- **Required current fix:** If a user explicitly requests a report file and the turn ends without matching Write evidence, locally mark the turn incomplete/BLOCKED and record evidence. Plain text must not be treated as successful report generation.
- **Verification:** Provider returns plain text repeatedly and never calls Write; TUI must output incomplete/BLOCKED and persist evidence.

### RF-B07 — user-visible endpointProfile before/during request

- **Current bucket:** Phase 15 real-project Beta 前必须修复.
- **Required current fix:** Ordinary user-visible status or pre-request output must show provider/model/endpointProfile/reasoning without baseUrl/key.
- **Verification:** TUI stdout must contain endpointProfile in ordinary output, not only transcript.

### RF-B08 — headless CLI doctor minimum alignment

- **Current bucket:** Phase 15 real-project Beta 前必须修复.
- **Required current fix:** `linghun model doctor` and `linghun /model doctor` must at least show provider/model/endpointProfile/endpointPath/apiKey source/masked. Do not print raw `base_url`; show `baseUrl=present|missing`. If the CLI path remains DeepSeek-only, it must state that it is limited and not contradict TUI doctor.
- **Verification:** CLI tests must cover no raw baseUrl/key and visible endpoint/profile/source diagnostics.

## B. Covered safety item and current tail

### RF-B02 — API-key/project-settings safety

- **Current bucket:** Covered by the parallel Phase 15 project settings API-key safety fix.
- **Reconciliation:** Commit `ba67e96 Stabilize Phase 15 project settings key safety` keeps legacy project `apiKey` readable, strips `providers.*.apiKey` on project settings writes, and adds masked source diagnostics/WARN in TUI and CLI doctor paths.
- **Remaining action:** Keep this as reconciled, not a duplicate implementation track.

### RF-W05 — residual project apiKey warning under env override

- **Current bucket:** Current-round small tail if not already covered.
- **Required current fix:** Even when active key source is `env`, doctor must still warn if current project `.linghun/settings.json` contains `apiKey`. The warning must not reveal the project key.
- **Verification:** Env key plus residual project key must show active `source=env` and a separate project-settings residual WARN.

## C. Phase 15 Beta-watch / real-run observation, not blocking this round

| ID | Target | Current decision |
| --- | --- | --- |
| RF-W01 | Phase 15 Beta-watch | Multi-tool sibling evidence completeness should be watched in mixed approval batches; not fixed now without live evidence of pollution. |
| RF-W02 | Phase 15 Beta-watch / runbook | Unattended Beta scripts must handle Write approval; product permission behavior remains correct. |
| RF-W03 | Phase 15 Beta-watch | Successful Write but final answer missing path can be hardened later if Write evidence exists. |
| RF-W04 | Phase 15 Beta-watch | Missing report filename fallback `report.md` remains watch item; permission mitigates current risk. |
| RF-W06 | Phase 15 Beta-watch | `endpointProfile` / `reasoningLevel` remain advanced knobs; document and observe, do not redesign now. |
| RF-W07 | Phase 15 Beta-watch | Query/fragment baseUrl diagnostics are useful but not current blocker unless required by RF-B08 minimum doctor alignment. |

## D. Phase 15.5 / release hardening

| ID | Target | Current decision |
| --- | --- | --- |
| RF-B03 | Phase 15.5 / release hardening | Centralized transcript/report/handoff redaction boundary is deferred. Current round only sanitizes the new provider-failure evidence path. |
| RF-P01 | Phase 15.5 | Rich TUI polish remains post-Beta polish, not a current red-line fix. |
| RF-P02 | Phase 15.5 / provider maturity decision | Claude/Anthropic native provider maturity is not a Phase 15 real-project Beta blocker and must not be claimed now. |

## E. NOT-DO / no-action

| ID | Current decision |
| --- | --- |
| RF-N01 | No silent endpointProfile switch was found; keep existing diagnostics. |
| RF-N02 | Permission-denied tool calls already close as tool_result evidence. |
| RF-N03 | Permission boundaries are conservative; report Write does not bypass permission. |
| RF-N04 | No ordinary runtime hardcoding found for DEPLOY_REPORT/Gate F/Phase 15 report path. |
| RF-N05 | MCP marketplace, desktop, and long-term autonomy remain outside Phase 15 Beta scope. |

## Boundary statement

The current implementation window is limited to RF-B01, RF-B04, RF-B05, RF-B06, RF-B07, RF-B08, and the RF-W05 tail. It must not implement Phase 15.5 / Phase 16+ capabilities, must not introduce a broad credential manager, and must not declare Phase 15 Beta PASS. After these fixes and validation, the strongest allowed status is whether Phase 15 real-project Beta can proceed to a user decision.
