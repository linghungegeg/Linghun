# Phase 15 Pre-Beta Red Flag Current Fix Report

> Date: 2026-05-20
> Scope: current-round minimal red-line fixes for Phase 15 real-project Beta pre-decision. This report does not start Phase 15 real-project Beta, does not enter Phase 15.5 / Phase 16+, and does not declare Beta PASS.

## Reclassified items by phase

| Bucket | Items | Current status |
| --- | --- | --- |
| A. Current Phase 15 real-project Beta blockers | RF-B01, RF-B04, RF-B05, RF-B06, RF-B07, RF-B08 | Fixed in this current minimal red-line round and covered by focused tests. |
| B. Safety reconciliation / current tail | RF-B02, RF-W05 | RF-B02 remains covered by the prior committed project-settings API-key safety fix; RF-W05 tail fixed in this round. |
| C. Phase 15 Beta-watch | RF-W01, RF-W02, RF-W03, RF-W04, RF-W06, RF-W07 | Deferred to real-project Beta observation unless live evidence shows current runtime pollution. |
| D. Phase 15.5 / release hardening | RF-B03, RF-P01, RF-P02 | Deferred; no centralized durable-artifact redaction, rich TUI polish, or native Claude/Anthropic provider work was started. |
| E. NOT-DO | RF-N01, RF-N02, RF-N03, RF-N04, RF-N05 | Kept no-action / regression guard. |

## Fixed this round

### RF-B01 — source attribution

- TUI and headless CLI doctor no longer use the false `source=user-settings` fallback.
- Non-env, non-project merged runtime config is now reported as `source=merged-config`.
- Tests assert ordinary doctor output does not contain `source=user-settings`.

### RF-W05 — residual project apiKey warning under env override

- TUI and CLI doctor now warn whenever the current project `.linghun/settings.json` contains provider `apiKey`, even when the active runtime key source is `env`.
- Warning output remains masked/generic and does not print raw project keys or project paths.

### RF-B08 — headless CLI doctor minimum alignment

- CLI `model doctor` now reports provider/model/endpointProfile/endpointPath/baseUrl present-or-missing/apiKey source/masked status.
- CLI doctor no longer prints raw `base_url` in the doctor path.
- CLI doctor labels itself as limited to the headless DeepSeek path and points full route diagnostics to TUI `/model doctor`.

### RF-B07 — ordinary status/request output profile visibility

- TUI status/pre-request output now shows provider, model, endpointProfile, and reasoning status.
- Compact status output still omits baseUrl and API keys.

### RF-B04 — request/header timeout

- Provider fetch now has a request/header timeout distinct from stream idle timeout.
- Timeout surfaces `PROVIDER_REQUEST_TIMEOUT` with `/model doctor` guidance instead of allowing an indefinite pre-header hang.
- Abort-aware fetch implementations that reject on timeout abort are mapped back to `PROVIDER_REQUEST_TIMEOUT` rather than leaking a raw `AbortError`.
- Existing retry behavior for retryable HTTP statuses and TypeError network failures is preserved.

### RF-B05 — provider failure evidence and doctor last failure

- Provider error events now create sanitized `evidence_record` and `system_event` transcript entries.
- TUI stores the last provider failure in memory and shows it in `/model doctor`.
- Provider-failure user output and evidence sanitize token-like strings, Bearer tokens, API-key query fragments, and local paths in this narrow provider-failure path.
- This is intentionally not the broader RF-B03 centralized durable-artifact redaction boundary.

### RF-B06 — report incomplete/BLOCKED guard

- Explicit report-file requests now record incomplete/BLOCKED evidence if the model ends the turn without matching successful Write evidence.
- TUI outputs a local incomplete/BLOCKED line and persists `report_incomplete` evidence/system event.
- Successful report Write behavior remains unchanged and still goes through the existing permission/evidence path.

## Deferred items and target phase

- RF-B03: Phase 15.5 / release hardening. Centralized transcript/tool_result/report/handoff/debug-bundle redaction remains deferred unless real Beta discovers current runtime leakage.
- RF-P01: Phase 15.5. Rich TUI polish remains non-blocking.
- RF-P02: Phase 15.5 provider maturity decision. No native Claude/Anthropic provider was added or claimed.
- RF-W01, RF-W02, RF-W03, RF-W04, RF-W06, RF-W07: Phase 15 Beta-watch, to be observed during real-project Beta rather than expanded into this fix round.
- RF-N01 through RF-N05: NOT-DO / no-action unless future evidence shows current runtime pollution.

## Tests and validation run

- `corepack pnpm exec vitest run packages/providers/src/index.test.ts` — PASS, 36 tests, including abort-aware timeout regression for `PROVIDER_REQUEST_TIMEOUT`.
- `corepack pnpm exec vitest run packages/providers/src/index.test.ts packages/config/src/index.test.ts packages/tui/src/index.test.ts apps/cli/src/main.test.ts` — PASS, 4 files / 154 tests.
- `corepack pnpm check` — initially failed on one formatter issue and one noUnusedTemplateLiteral lint; fixed and rerun PASS.
- `corepack pnpm typecheck` — PASS.
- `corepack pnpm test` — PASS, 11 files / 288 tests.
- `corepack pnpm build` — PASS.
- `git diff --check` — PASS after this report file was updated.
- Independent verifier rerun — PASS, including adversarial abort-aware fetch probe, CLI/TUI doctor masking probes, provider-failure evidence probe, and report incomplete/BLOCKED probe.

## Remaining BLOCKING count

- Current Phase 15 pre-Beta red-line blockers from this reconciliation: **0 remaining in this current minimal fix scope** after the above tests.
- This does not mean all future release-hardening risks are gone; RF-B03/RF-P01/RF-P02 remain explicitly deferred to Phase 15.5 / release hardening.

## Can Phase 15 real-project Beta proceed to user decision?

Yes — based on this current red-line scope and validation results, Phase 15 real-project Beta can proceed to a **user decision** step.

This is not an automatic Beta PASS. The next step must still be explicitly chosen by the user, and any real-project Beta findings must be classified separately as P0/P1/P2.

## Explicit boundary

- No automatic Phase 15 Beta PASS was declared.
- No Phase 15.5 / Phase 16+ work was started.
- No credential manager, keychain, native Claude/Anthropic provider, rich TUI redesign, MCP marketplace, desktop, durable jobs, remote approval system, or centralized durable-artifact redaction platform was implemented in this round.
