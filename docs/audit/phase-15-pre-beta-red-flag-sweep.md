# Phase 15 Pre-Beta Red Flag Sweep

> Scope: read-only audit of the eight requested red-flag domains. This report does not start Phase 15 real-project Beta, does not enter Phase 15.5/16+, and does not declare Beta PASS.

## Executive verdict: NOT_READY

Phase 15 real-project Beta is **NOT_READY** until the blocking items below are reconciled and re-verified. The blocking findings are limited to issues with evidence that can pollute or invalidate real-project Beta measurement data: incorrect provider/config attribution, secret persistence risk, provider request hang or non-durable failure evidence, prompt-only report closure, and status/doctor surfaces that can mislead endpoint/profile measurement.

- Blocking count: **8**
- Beta-watch count: **7**
- Post-Beta count: **2**
- Not-do count: **5**
- Codebase index used: `F-Linghun`, status `ready` (`nodes=1290`, `edges=2380`)
- Working-tree reconciliation context observed during audit: API-key/project-settings safety work is present in uncommitted files (`packages/config/src/index.ts`, `packages/config/src/index.test.ts`, `packages/tui/src/index.ts`, `packages/tui/src/index.test.ts`). Findings touching that work are marked **pending reconciliation** instead of duplicating an implementation plan.

## Findings table

| ID | Domain | Category | Finding | Blocks Beta? |
| --- | --- | --- | --- | --- |
| RF-B01 | 1, 2 | BLOCKING | Doctor/config source can claim `user-settings` even though the loader does not load user settings; key source transparency is not trustworthy. | Yes |
| RF-B02 | 2 | BLOCKING | API-key/project-settings safety fix is still pending reconciliation in uncommitted changes. | Yes, pending reconciliation |
| RF-B03 | 2 | BLOCKING | Transcript/report/handoff persistence has no centralized secret redaction boundary. | Yes |
| RF-B04 | 7 | BLOCKING | Provider request can hang before response headers; stream-idle timeout starts only after a body exists. | Yes |
| RF-B05 | 7 | BLOCKING | Provider/model failures are printed but not consistently persisted as transcript/evidence/doctor state. | Yes |
| RF-B06 | 6 | BLOCKING | Report-generation closure is prompt-enforced, not locally enforced when the model ignores Write/reminders. | Yes, for report-generation Beta path |
| RF-B07 | 8, 1, 3 | BLOCKING | Ordinary status/request output can hide `endpointProfile=responses`, allowing OpenAI-compatible measurement confusion. | Yes |
| RF-B08 | 8, 1, 2, 3 | BLOCKING | Headless CLI `model doctor` is stale and prints raw `base_url`; it lacks endpoint/profile/key-source diagnostics. | Yes, unless excluded from Beta acceptance |
| RF-W01 | 4 | BETA-WATCH | Multi-tool pending approval prunes sibling tool calls to avoid orphan results; this can lose sibling evidence in mixed tool batches. | No |
| RF-W02 | 5, 6 | BETA-WATCH | Report generation correctly triggers Write approval, but unattended Beta scripts must handle the approval prompt. | No |
| RF-W03 | 6 | BETA-WATCH | Successful report Write can still lack deterministic final-answer path reference after one prompt reminder. | No |
| RF-W04 | 6 | BETA-WATCH | No explicit report filename falls back to fixed `report.md`; permission mitigates, but overwrite risk should be watched. | No |
| RF-W05 | 2 | BETA-WATCH | Project-settings API-key warning can be suppressed when env key overrides the active key source. | No, unless real keys remain in project settings |
| RF-W06 | 1, 3 | BETA-WATCH | `endpointProfile` / `reasoningLevel` remain advanced knobs on the default config surface. | No |
| RF-W07 | 3 | BETA-WATCH | `baseUrl` with query/fragment is not explicitly rejected or diagnosed. | No |
| RF-P01 | 8 | POST-BETA | Rich TUI polish remains deferred; do not confuse polish with Beta-required measurement correctness. | No |
| RF-P02 | 8 | POST-BETA | Claude/Anthropic native provider remains future work; do not claim native support in Phase 15. | No |
| RF-N01 | 3 | NOT-DO | No silent `endpointProfile` switch was found for full endpoint `baseUrl`; diagnostics exist. | No |
| RF-N02 | 4 | NOT-DO | Permission-denied model tool calls are closed and continued as `tool_result` evidence. | No |
| RF-N03 | 5 | NOT-DO | Default/acceptEdits/auto/bypass permission boundaries are conservative and tested; report Write does not bypass permission. | No |
| RF-N04 | 6 | NOT-DO | No runtime hardcoding found for `DEPLOY_REPORT.md`, `Gate F`, or fixed Phase 15 report path in ordinary report-generation code. | No |
| RF-N05 | 8 | NOT-DO | MCP marketplace, desktop, and long-term autonomy are outside Phase 15 Beta scope unless current runtime evidence shows pollution. | No |

## Blocking findings

### RF-B01 — Doctor/config key source can claim `user-settings` without user settings loader

- **Evidence:** `packages/config/src/index.ts:416-433` reads only project `.linghun/settings.json` through `loadConfig()` and falls back to `defaultConfig`; no user-level settings file is loaded. The uncommitted helper in `packages/tui/src/index.ts:2131-2135` returns `user-settings` when no env key and no project-settings key are detected. `packages/config/src/index.ts:255-276` also seeds defaults from env at module/default-config level.
- **Risk:** `/model doctor` can materially misattribute the active key/config source. A Beta tester may believe a private user-settings path is being used when the runtime only loaded env/default/project config, corrupting provider/profile/config-source measurement.
- **Blocks Beta?** Yes.
- **Minimal required fix:** Pending reconciliation with the API-key/project-settings safety window. Source attribution must reflect actual loader sources only: either real user settings with source tracking, or a non-claiming value such as `merged-config`/`unknown` until user settings are implemented.
- **Verification required:** Doctor tests for no env/no project key must not print `source=user-settings`; legacy project key must print a project warning; env key must print env source and must not be persisted to project settings.

### RF-B02 — API-key/project-settings safety fix is pending reconciliation

- **Evidence:** Current working tree contains uncommitted API-key safety changes. `packages/config/src/index.ts:510-532` strips provider `apiKey` via `removeSensitiveProjectSettings()` before project settings writes. `packages/config/src/index.test.ts:184-224` asserts legacy project key migration and env key non-persistence. `packages/tui/src/index.ts:2041-2070` adds doctor warning for project-settings `apiKey`.
- **Risk:** Direction is correct, but Beta status is uncertain until these changes are reconciled, tested, and committed. If dropped or only partially merged, real keys can remain in or be reintroduced into project settings.
- **Blocks Beta?** Yes — **pending reconciliation**.
- **Minimal required fix:** Do not duplicate an implementation here. Reconcile the parallel safety fix, ensure all project-settings write paths go through the stripping path, and verify the matching tests.
- **Verification required:** Config tests for legacy project `apiKey` load/migration, env key non-persistence, and no serialized `apiKey` in written `.linghun/settings.json`; TUI doctor test for project-level key WARN and masked output.

### RF-B03 — Transcript/report/handoff persistence has no centralized secret redaction boundary

- **Evidence:** `packages/core/src/jsonl.ts:14-17` writes `JSON.stringify(record)` directly. `packages/core/src/session-store.ts:112-120` appends arbitrary transcript events through `appendJsonl()`. `packages/core/src/session.ts:200-221` includes raw `tool_call_start.input`, `tool_call_end.output`, and `tool_result.content`; other transcript variants include user text, evidence, and handoff packets.
- **Risk:** Even if project settings no longer intentionally persist keys, secrets can still land in transcripts/reports/handoff through user prompts, tool inputs, command output, file reads of legacy settings, environment dumps, or report packets. Doctor masking alone does not protect durable artifacts.
- **Blocks Beta?** Yes.
- **Minimal required fix:** Add a centralized redaction boundary at transcript/report/handoff persistence, covering known secret keys/headers/env names and common bearer/sk-style token shapes before JSONL/file persistence.
- **Verification required:** Tests that secret-bearing `tool_result`, `tool_call_start`, `handoff_packet`, verification/report events, and env-like strings are redacted in generated session files; manual grep over simulated session artifacts.

### RF-B04 — Provider request can hang before stream starts

- **Evidence:** `packages/providers/src/index.ts:399-411` calls `fetchWithProviderRetry()` with the caller signal. `packages/providers/src/index.ts:507-524` retries responses and `TypeError`, but has no request/header timeout. `packages/providers/src/index.ts:433-435` applies `withStreamIdleTimeout()` only after `response.ok` and `response.body` exist. `packages/providers/src/index.ts:555-595` protects stream-idle after body reading begins.
- **Risk:** After TUI prints `状态：正在请求模型...`, a provider/network stall before response headers can hang indefinitely unless the user interrupts. This directly pollutes real-project Beta timing/failure data.
- **Blocks Beta?** Yes.
- **Minimal required fix:** Add a provider request/header timeout around `fetch` itself, distinct from stream idle timeout, surfacing an actionable `LinghunError` such as `PROVIDER_REQUEST_TIMEOUT`.
- **Verification required:** Mock `fetch` that never resolves; assert TUI exits the request path within the timeout, prints actionable guidance, restores idle/prompt status, and records transcript/evidence.

### RF-B05 — Provider/model failures are printed but not consistently persisted as evidence/doctor state

- **Evidence:** `packages/tui/src/index.ts:6470-6474` records a `model_request` system event before provider call. But provider error events at `packages/tui/src/index.ts:6586-6588`, `6861-6863`, and `6924-6926` only print `formatError(...)` then return. `packages/tui/src/index.ts:7016-7055` persists empty provider responses as evidence/system event, showing the intended pattern exists but is not applied to provider errors. `/model doctor` at `packages/tui/src/index.ts:2041-2114` reports static diagnostics, not last provider failure.
- **Risk:** HTTP 400/502/SSE error/timeout failures can disappear from durable evidence. A Beta tester may see an error once, but later `/details`, transcript review, or doctor cannot explain what failed.
- **Blocks Beta?** Yes.
- **Minimal required fix:** Introduce a common provider-failure record path that appends sanitized system event/evidence with code, provider, model, endpointProfile, and a doctor-visible last-error summary.
- **Verification required:** Tests for HTTP 400, HTTP 502, SSE error event, stream idle timeout, and request timeout must assert user output, transcript `system_event`, `evidence_record`, and `/model doctor` last-error visibility.

### RF-B06 — Report-generation closure is prompt-enforced, not locally enforced

- **Evidence:** `packages/tui/src/index.ts:6517-6520` creates `ReportWriteGuard` and injects a task-specific instruction. `packages/tui/src/index.ts:6608-6628` sends at most one write reminder, then can break if the model again returns no tool calls. `packages/tui/src/index.ts:7626-7638` initializes `completed=false`; `7700-7707` marks completion only when successful `Write` satisfies the guard. There is no local failure when report was requested but no Write evidence was produced.
- **Risk:** If the model ignores guard/reminder and answers in plain text, the TUI can finish the turn without a report file while showing model output. That is not a real closure guarantee for report-generation Beta paths.
- **Blocks Beta?** Yes, for any Phase 15 Beta acceptance path that includes report generation.
- **Minimal required fix:** If `ReportWriteGuard` exists and `completed=false` at turn end, emit an explicit incomplete/BLOCKED result, record missing Write evidence, and avoid presenting the turn as successful report generation.
- **Verification required:** Mock provider returns only text twice for “生成报告在根目录下”; assert no silent success, no false final report claim, and transcript/evidence records “report write missing”.

### RF-B07 — Ordinary status/request output can hide actual `endpointProfile=responses`

- **Evidence:** `packages/tui/src/runtime-status-presenter.ts:3-24` defines/formats status with session/model/reasoning/mode/background/cache/index/gate, but not endpointProfile. `packages/tui/src/index.ts:9223-9241` passes provider/model/reasoning to status rendering but no endpointProfile. `packages/tui/src/index.ts:6466-6473` records `endpointProfile=...` only into a `system_event`, not ordinary stdout/status. `packages/tui/src/index.test.ts:903-962` verifies `endpointProfile=responses` in transcript, not in user-visible ordinary output.
- **Risk:** A user may think they are measuring the ordinary OpenAI-compatible chat-completions path while the actual request uses Responses. That directly pollutes default-path Beta measurement.
- **Blocks Beta?** Yes if ordinary status/output is used as Beta evidence for provider/profile correctness.
- **Minimal required fix:** Add user-visible provider + endpointProfile to status, pre-request output, or `/model` ordinary status while keeping secrets/baseUrl out of the compact status line.
- **Verification required:** Real/stdin TUI smoke with OpenAI-compatible `endpointProfile=responses` must show provider/model/endpointProfile/reasoning in ordinary stdout before or during the request, not only transcript.

### RF-B08 — Headless CLI `model doctor` is stale and prints raw `base_url`

- **Evidence:** `apps/cli/src/cli.ts:128-146` implements `model doctor` with only `base_url`/`api_key` presence checks. `apps/cli/src/cli.ts:138` prints raw `base_url`. `apps/cli/src/cli.ts:152-159` hardcodes `provider：deepseek` in `formatModelInfo`. It does not show endpointProfile, compatibilityProfile, endpointPath, reasoning, key source, masked key, or project-settings API-key warning.
- **Risk:** `linghun model doctor` is user-visible and can give conflicting or less safe diagnostics than TUI `/model doctor`. Raw baseUrl may include private gateway path/query, and endpoint/profile measurement can be missed.
- **Blocks Beta?** Yes, unless headless CLI doctor is explicitly excluded from Phase 15 Beta acceptance and docs point testers to the authoritative TUI doctor.
- **Minimal required fix:** Align CLI doctor with TUI doctor, or mark CLI doctor limited and direct users to TUI `/model doctor`. Do not print raw baseUrl; print present/missing, endpointPath, and full-endpoint/query warnings.
- **Verification required:** CLI doctor test with OpenAI-compatible `endpointProfile=responses`, full endpoint or query-bearing baseUrl, and project-settings key; assert no raw key/query and visible provider/model/endpointProfile/endpointPath/key source/masked status.

## Beta-watch findings

### RF-W01 — Multi-tool pending approval prunes sibling tool calls

- **Evidence:** `packages/tui/src/index.ts:688-716` defines `createSingleToolCallContinuation()` to keep only the pending tool call and remove sibling tool messages. `packages/tui/src/index.ts:7261-7268` uses it when model tool use enters pending local approval. `packages/tui/src/index.test.ts:1181-1264` verifies no-orphan behavior by pruning a sibling `Glob` when `Bash` is denied.
- **Risk:** This avoids orphan `tool_result` schema errors, but can discard sibling tool calls/results from continuation context if a live provider emits mixed sibling calls and one requires approval.
- **Blocks Beta?** No. No evidence yet that real-project Beta data is polluted; make it blocking only if live smoke reproduces missing sibling evidence.
- **Minimal required fix:** Not required before Beta unless reproduced. Preferred hardening is valid closure for every sibling tool_call_id while preserving available sibling evidence.
- **Verification required:** Mock or live smoke where assistant emits `Read`/`Glob` plus `Write`/`Bash` in one message, approval is required, and the post-approval request remains schema-valid and evidence-complete.

### RF-W02 — Report generation triggers Write approval by design

- **Evidence:** `packages/tui/src/index.ts:7626-7649` detects explicit report-file requests. `packages/tui/src/index.ts:7688-7697` instructs model to call Write. `packages/tui/src/index.ts:6636-6647` and `7235-7270` still route Write through permission. Tests at `packages/tui/src/index.test.ts:1267-1301`, `1415-1453`, and `3146-3206` show Write pauses for approval and writes only after `yes`.
- **Risk:** Unattended Beta scripts can stall or finish without a file if they do not handle approval. This is expected permission behavior, not a bypass.
- **Blocks Beta?** No, if the Beta runbook/script explicitly handles approval.
- **Minimal required fix:** Product code not required for this item; Beta runbook must state saved-report prompts may trigger Write approval and the driver must approve only expected path/content.
- **Verification required:** Real TUI report-generation smoke asserts prompt appears, no file before approval, file after approval, transcript contains Write `tool_result` and evidence.

### RF-W03 — Successful report Write can lack deterministic final path reference

- **Evidence:** `packages/tui/src/index.ts:7671-7679` checks final text for requested path, and `7682-7685` sends a reminder once. There is no deterministic local fallback line if the model still omits the path.
- **Risk:** File may be written correctly, but final answer may not reference it, weakening user-visible closure and auditability.
- **Blocks Beta?** No if Write evidence exists.
- **Minimal required fix:** If completed report Write lacks final path reference after reminder, append deterministic local line such as `报告文件：<path>` and record a system event.
- **Verification required:** Mock successful Write and final text without path; assert local path reference appears and transcript records it.

### RF-W04 — Missing explicit report filename falls back to fixed `report.md`

- **Evidence:** `packages/tui/src/index.ts:7630-7633` sets `requestedPath` to `report.md` when no filename is extracted. `packages/tui/src/index.ts:7641-7649` treats “报告 + 生成/保存 + 根目录/文件/.md” as a report-file request.
- **Risk:** This is not Phase/Gate hardcoding, but can overwrite a common filename if permission/allowlist permits.
- **Blocks Beta?** No, because permission mitigates writes.
- **Minimal required fix:** Prefer clarification or non-overwriting path proposal when no filename is explicit.
- **Verification required:** Test no-filename report request with existing `report.md`; assert clarification or safe path before Write.

### RF-W05 — Project-settings API-key warning can be suppressed by env override

- **Evidence:** `packages/tui/src/index.ts:2117-2128` detects project settings providers with `apiKey`. `packages/tui/src/index.ts:2131-2135` returns source `env` before `project-settings`. `packages/tui/src/index.ts:2060-2069` warns only when `keySource === "project-settings"`.
- **Risk:** If a real key remains in project settings but an env key is also present, doctor reports env and may not warn that project settings still contains a key.
- **Blocks Beta?** No if Beta projects are separately checked for committed/project secrets; can become blocking if real keys are allowed in Beta repos.
- **Minimal required fix:** As part of pending reconciliation, warn based on `projectSettingsApiKeyProviders.has(providerId)` independently from active source.
- **Verification required:** Test both env key and project-settings key present; assert active source env and separate project-settings key warning.

### RF-W06 — `endpointProfile` / `reasoningLevel` remain advanced knobs on default config surface

- **Evidence:** `packages/config/src/index.ts:6-22` exposes `endpointProfile` and `reasoningLevel`. `packages/config/src/index.ts:160-164` feeds defaults from `LINGHUN_OPENAI_ENDPOINT_PROFILE` and `LINGHUN_INFERENCE_LEVEL`. `packages/config/src/index.ts:266-276` includes endpoint/profile/reasoning fields in default OpenAI-compatible provider. `packages/providers/src/index.ts:476-504` uses them to select chat vs responses and reasoning behavior.
- **Risk:** Default OpenAI-compatible setup is not as simple as baseUrl + apiKey + model if these fields are surfaced as normal user knobs. Defaults are safe-ish (`chat_completions` unless env says responses), but support/debug can be confused.
- **Blocks Beta?** No, provided defaults remain chat-completions and no silent switch occurs.
- **Minimal required fix:** Document as advanced/diagnostic-only; keep default setup focused on baseUrl, apiKey, and model.
- **Verification required:** `/model doctor` default output shows `endpointProfile=chat_completions`; basic OpenAI-compatible config without endpointProfile sends `/chat/completions`; reasoning is not sent unless responses/permissive profile explicitly enables it.

### RF-W07 — Query/fragment-bearing `baseUrl` is not explicitly diagnosed

- **Evidence:** `packages/providers/src/index.ts:317-327` trims slashes and strips endpoint suffix only. `packages/providers/src/index.ts:399-401` builds final URL by string concatenation. `packages/providers/src/index.test.ts:289-338` uses a query-bearing baseUrl to test header secrecy, but not endpoint URL or doctor diagnostics.
- **Risk:** A baseUrl with query params can produce malformed endpoint URLs and may preserve private query-token material in outbound request URLs. Doctor currently reports `baseUrl=present`, not this misconfiguration.
- **Blocks Beta?** No, but it affects OpenAI-compatible diagnostics.
- **Minimal required fix:** Reject or warn on baseUrl containing query/fragment; require root URL such as `https://host/v1`.
- **Verification required:** Unit tests for query/fragment baseUrl warning, normal root URL endpoint path, and full-endpoint suffix warning without profile switching.

## No-action list

### RF-P01 — Rich TUI polish remains Post-Beta

- **Evidence:** Phase delivery docs keep Phase 15.5 as the place for terminal TUI non-blocking polish, while Phase 15 Beta focuses on real-project runtime correctness.
- **Risk:** Treating visual polish as a blocker would expand scope and hide measurement-critical issues.
- **Blocks Beta?** No, unless the issue is provider/profile/status measurement correctness like RF-B07/RF-B08.
- **Minimal required fix:** None for rich visual polish in Phase 15.
- **Verification required:** Beta docs distinguish visual polish from measurement correctness.

### RF-P02 — Claude/Anthropic native provider is future work

- **Evidence:** Current provider type surface in config/providers supports `deepseek` and `openai-compatible`; native Claude/Anthropic is not implemented. Product docs place broader provider maturity after the current Phase 15 boundary.
- **Risk:** Claiming native Claude support now would be false, but lack of native Claude does not itself pollute OpenAI-compatible/DeepSeek Phase 15 Beta data.
- **Blocks Beta?** No, unless Beta materials claim Claude native provider support.
- **Minimal required fix:** No Phase 15 implementation.
- **Verification required:** Search Beta docs/runtime claims for unsupported native Claude wording.

### RF-N01 — No silent endpointProfile switch on full endpoint baseUrl

- **Evidence:** `packages/providers/src/index.ts:312-340` strips full endpoint suffix for URL formation but records `fullEndpointSuffix`, `profileMismatch`, and recommendation. `packages/providers/src/index.ts:390-401` uses runtime contract endpoint, not detected suffix, for final URL. `packages/tui/src/index.ts:2056-2080` prints doctor warnings. Tests at `packages/providers/src/index.test.ts:276-287` and `packages/tui/src/index.test.ts:2110-2144` cover mismatch diagnostics.
- **Risk:** Low. This satisfies “do not silently switch endpointProfile”.
- **Blocks Beta?** No.
- **Minimal required fix:** None.
- **Verification required:** Keep existing provider/TUI tests in the pre-Beta gate.

### RF-N02 — Permission-denied model tool calls are closed and continued as tool results

- **Evidence:** `packages/tui/src/index.ts:6044-6072` records denied model-tool approval as failure evidence, appends `tool_result`, pushes `ok:false` tool message, and continues model. `packages/tui/src/index.ts:7272-7279` does similar for non-allowed tool permission. `packages/tui/src/index.test.ts:1139-1179` verifies denial is returned to model, does not run the command, and does not leak raw `tool_result` to user output.
- **Risk:** Low; this reduces provider schema risk and preserves denial evidence.
- **Blocks Beta?** No.
- **Minimal required fix:** None.
- **Verification required:** Keep denied-tool continuation tests; add live smoke only if Beta explicitly measures permission-denial recovery.

### RF-N03 — Permission boundaries are conservative; report Write does not bypass permission

- **Evidence:** Default config uses `defaultMode: "default"` (`packages/config/src/index.ts:279-280`). `decidePermission()` checks hard-deny before modes (`packages/tui/src/index.ts:8305-8319`), denies plan writes/Bash (`8322-8329`), denies approval-needed operations in dontAsk (`8347-8353`), accepts only low-risk workspace edits in acceptEdits (`8356-8370`), gates auto and bypass through explicit mode guards, and returns ask for default Write/Bash/edit (`8393-8399`). Tests cover default prompts, acceptEdits denial, and bypass/auto opt-in.
- **Risk:** Low for the audited boundary. Write/Bash effects remain behind permission decisions and hard-deny.
- **Blocks Beta?** No.
- **Minimal required fix:** None.
- **Verification required:** Keep tests for default Write/Bash prompt, acceptEdits denial of Bash/medium Write, auto fallback deny, bypass env gating, and hard-deny under bypass.

### RF-N04 — No ordinary runtime hardcoding found for DEPLOY_REPORT/Gate F/Phase 15 report path

- **Evidence:** Runtime searches under `packages/` did not find ordinary report-generation control flow hardcoding `DEPLOY_REPORT.md` or `Gate F`. Generic report runtime is `packages/tui/src/index.ts:7626-7734`. Tests use varied filenames such as `requested-report.md` (`packages/tui/src/index.test.ts:1344-1388`) and `deploy-report.md` (`3146-3206`).
- **Risk:** No evidence that Phase 15/Gate F smoke artifact names leaked into ordinary runtime report generation.
- **Blocks Beta?** No.
- **Minimal required fix:** None.
- **Verification required:** Keep regression search for fixed audit artifact names in ordinary runtime code.

### RF-N05 — MCP marketplace, desktop, long-term autonomy are not Phase 15 Beta blockers

- **Evidence:** Delivery/roadmap documents place marketplace/desktop/long-term autonomy after Phase 15 and the requested scope explicitly excludes them unless current runtime pollution evidence exists.
- **Risk:** Building them now would expand scope and obscure real Beta blockers.
- **Blocks Beta?** No.
- **Minimal required fix:** Do not implement these in Phase 15.
- **Verification required:** Beta docs must not advertise marketplace, desktop GUI, durable autonomy, remote approvals, or hosted jobs as complete.

## Reconciliation notes for the parallel API key/project settings safety fix

- Treat the uncommitted API-key/project-settings safety work as **pending reconciliation**, not as a new implementation request from this sweep.
- The observed direction is correct: strip `providers.*.apiKey` on project settings writes and warn when legacy project settings contain a key.
- Reconciliation must also fix attribution correctness: do not print `source=user-settings` unless user settings are actually loaded/tracked.
- Reconciliation must not stop at project settings. RF-B03 remains separate: transcripts, tool results, reports, and handoff packets need a centralized redaction boundary.
- Reconciliation should include the env-overrides-project warning case (RF-W05), so stale project secrets are still reported even when the active runtime key is env.

## Final recommendation

Do **not** start Phase 15 real-project Beta yet. First close RF-B01 through RF-B08 with targeted fixes and tests, then re-run a narrow Pre-Beta red-flag sweep against the same eight domains. After blockers are zero, the next decision should still be phrased as a user decision point for real-project Beta, not as automatic Beta PASS.
