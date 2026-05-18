---
title: Phase 15 pre-Beta CCB-grade Runtime Acceptance Closure
status: pre-beta-runtime-closure-validated
phase: 15-pre-beta
created: 2026-05-18
scope: Phase 00-14 + Phase 15 pre-Beta runtime acceptance only; not Phase 15 Beta / 15.5 / 16+
---

# Phase 15 pre-Beta CCB-grade Runtime Acceptance Closure

> 本报告先于源码修改创建，作为本轮 Runtime Acceptance Matrix、gap table、修复和验证证据的唯一审计入口。本轮目标是关闭真实 Windows TUI 中“状态：正在请求模型...”后静默回到 prompt 的 P0/P1 silent failure。本文只参考 `F:\ccb-source` 的成熟运行行为、错误恢复、provider/tool loop、TUI handfeel 和验收口径；不复制 CCB / Claude Code / OpenCode 源码、内部 API、变量结构、反编译实现或专有逻辑。

## 1. 读取与索引状态

- `F-Linghun` codebase-memory index：ready，1032 nodes / 1933 edges。
- 本轮必读 Linghun 文档/源码已读取：
  - `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
  - `LINGHUN_IMPLEMENTATION_SPEC.md`
  - `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
  - `docs/delivery/README.md`
  - `docs/audit/phase-15-pre-beta-end-to-end-ccb-user-journey-parity-closure.md`
  - `docs/audit/phase-15-pre-beta-source-level-runtime-output-permission-parity.md`
  - `docs/delivery/phase-15-natural-command-bridge.md`
  - `LINGHUN_CCB_MATURITY_COMPARISON_REPORT.md`
  - `START_NEXT_CHAT.md`
  - `packages/providers/src/index.ts`
  - `packages/providers/src/index.test.ts`
  - `packages/tui/src/index.ts`
  - `packages/tui/src/index.test.ts`
  - `packages/tui/src/natural-command-bridge.ts`
  - `packages/tui/src/tool-output-presenter.ts`
  - `packages/tui/src/permission-presenter.ts`

## 2. CCB-grade Runtime Acceptance Matrix

| ID | Runtime acceptance item | CCB mature behavior | Linghun current behavior before this closure | Status before fix | Root cause | Must fix now / later / not-do | Validation command or smoke case |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R01 | Live provider text stream | A completed model turn must render assistant text or a visible error; prompt is restored only after a clear outcome. | TUI can stream `assistant_text_delta`, but if stream ends with no text/tool/error it silently returns to prompt. | FAIL | `sendMessage()` only appends/responds when `assistantText` exists; no empty-response guard. | Must fix now | TUI unit: empty stream; real TUI stdin smoke ordinary request |
| R02 | Live provider tool_call stream | Tool call deltas must become `tool_use`, pause/execute via permission pipeline, then continue with `tool_result`. | Minimal streamed `delta.tool_calls` parser exists; only first choice/delta path is robustly covered. | PARTIAL | Parser assumes `choices[0].delta.tool_calls`; limited variants and malformed handling. | Must fix now | Provider parser tests + TUI Write permission yes smoke |
| R03 | Non-stream / message fallback variants | Gateway-compatible providers may return `choices[].message.content` / `message.tool_calls`; runtime should parse or fail actionably. | Parser ignores `choices[].message.*` chunks. | FAIL | SSE parser handles delta only. | Must fix now | Provider parser: message.content and message.tool_calls fallback |
| R04 | Stream chunk variants: `delta.content` | Text deltas render incrementally and become transcript assistant event. | Covered by current parser and tests. | PASS | n/a | Not-do | Existing provider parser test |
| R05 | Stream chunk variants: reasoning-only | Reasoning-only events must not be treated as successful user-visible answer; either low-noise thinking or final empty-response. | `reasoning_content` / `reasoning` ignored, so usage-only/reasoning-only can become silent success. | FAIL | No reasoning event accounting; no empty-response guard. | Must fix now | Provider parser reasoning-only + TUI empty response test |
| R06 | Stream chunk variants: fragmented tool args | Fragmented `delta.tool_calls[].function.arguments` must aggregate until valid JSON. | Basic index-based aggregation exists. | PARTIAL | Index fallback okay; no message fallback / malformed coverage. | Must fix now | Provider parser fragmented args test |
| R07 | Finish reason | Finish reason should be recorded in safe diagnostic evidence and used for empty response triage. | Parser reads no `finish_reason`; TUI has no request outcome metadata. | FAIL | Event protocol lacks stop event; parser discards finish reason. | Must fix now | TUI empty evidence contains finishReason if available |
| R08 | Usage-only chunk | Usage should record cache/cost but not count as assistant answer. | Usage records; without text/tool it can lead to silent prompt return. | FAIL | No model_empty_response after usage-only turn. | Must fix now | Provider parser usage-only + TUI empty response test |
| R09 | Empty choices | Empty choices should not crash; final outcome must be empty-response error if no content/tool/error. | Empty choices ignored, causing possible silent prompt return. | FAIL | No chunk count/outcome accounting. | Must fix now | Provider parser empty choices + TUI empty response test |
| R10 | Provider error chunk | Provider SSE error object must become actionable `LinghunError`, not swallowed. | HTTP errors normalize; SSE error object not parsed. | FAIL | Parser only expects JSON choices/usage. | Must fix now | Provider parser error chunk test |
| R11 | Malformed SSE / JSON | Malformed provider chunk must produce visible actionable error and safe transcript/evidence. | `JSON.parse` throws, gateway normalizes generic provider error; parser test missing and line-level context weak. | PARTIAL | No parser-specific malformed chunk error code. | Must fix now | Provider parser malformed chunk -> error event |
| R12 | Provider HTTP error | HTTP 400/401/403/429/5xx must be categorized with next actions and no secrets. | Existing HTTP classifiers are present. | PASS | n/a | Not-do, regression only | Existing provider tests + live smoke if key valid |
| R13 | JSON error body / HTML body | Error output must not dump raw provider response; should summarize likely cause. | Current HTTP classifier ignores body and stays summary-first. | PARTIAL | Safe but less diagnostic. | Later unless needed for P0 | Provider HTTP tests; no raw body assertion |
| R14 | Unsupported tools fallback | If model/provider does not support tools, do not send tools/toolChoice and clearly degrade. | TUI and ModelGateway have guards based on known/config supportsTools. | PASS/PARTIAL | Known-model only in TUI; custom provider config path must stay covered. | Must regression-test now | Unsupported tools request capture + live smoke no HTTP 400 |
| R15 | Tool_use -> permission ask -> yes continue -> tool_result | Model Write should pause, user yes should execute Write, record tool_result/evidence, continue or stop visibly. | Pending approval path exists for model tool use. | PARTIAL | Journey exists but not covered for current P0 report-generation request and empty response. | Must fix/test now | TUI integration: model tool_call Write -> yes -> report exists |
| R16 | Normal natural dev request enters model/tool loop | Ordinary request should not be stolen by control-plane or SCG; must either model answer/tool/use or provider error. | Ordinary request reaches model loop; observed live bug returns silent prompt. | FAIL | Empty provider response is treated as success. | Must fix now | Windows TUI stdin smoke: project deploy report request |
| R17 | Report generation through real model Write | Real model can choose Write; permission boundary and actual file write must work. | Mock journey covers slash Write; model Write path needs focused real journey coverage. | PARTIAL | Insufficient model-tool report smoke. | Must fix now | TUI mock + real provider smoke if model emits tool_use, otherwise visible text/error |
| R18 | Windows path / encoding / shell boundary | Real project path, Chinese prompt, Windows paths, Bash/PowerShell boundary must not mojibake or use `/workspace`. | Prior Windows path work exists; current real TUI path still needs runtime smoke. | PARTIAL | Real stdin smoke not part of every validation. | Must validate now | F:\linghun-ceshi or temp project TUI stdin smoke |
| R19 | Index/cache/MCP/model/status control-plane local answer | Control-plane questions must use local state and not pollute model output. | Existing NCB/slash coverage present. | PASS | n/a | Regression now | TUI stdin `/model route doctor`, `/index status` |
| R20 | Long output truncation | Read/Grep/Glob/Todo/Bash outputs summary-first, full logs/evidence off-main-screen. | Presenter truncation exists. | PASS | n/a | Regression now | Existing journey smoke / tests |
| R21 | No-pending yes/no local guard | `yes/确认` with no pending gate must not call model. | Existing guard and smoke present. | PASS | n/a | Regression now | TUI unit/no pending yes |
| R22 | Transcript/evidence/handoff correctness | Empty/provider failure must enter transcript/evidence with safe metadata; no raw secrets. | Tool/evidence exists, but empty provider outcome not recorded. | FAIL | No provider_empty_response event/evidence. | Must fix now | Unit transcript/evidence assertions |
| R23 | No silent failure anywhere in model request path | Any model request must end in text, tool, actionable error, interrupt/cancel, or explicit empty-response error. | Violated by current real TUI. | FAIL | No post-request invariant. | Must fix now | TUI empty stream + real TUI stdin smoke |
| R24 | Summary-first primary output | Errors and tool results must start with what happened and next action; no raw JSON/tool_result. | Mostly present; empty response needs new summary-first message. | PARTIAL | Missing empty response output. | Must fix now | Output assertions |
| R25 | Live provider smoke without secrets | Smoke must use env vars, never write keys/raw headers/full raw responses. | No dedicated live smoke entry found yet. | FAIL | Missing repeatable live provider harness. | Must fix now | `corepack pnpm ...` smoke script; SKIPPED if env missing |
| R26 | Real TUI stdin smoke | Scripted stdin should prove no silent prompt return in Windows project. | Existing test journey uses mocked fetch and slash actions; real TUI smoke needs CLI/runtime entry. | FAIL | Missing repeatable real stdin smoke command. | Must fix now | `corepack pnpm exec linghun` with stdin script in temp/F:\linghun-ceshi |

## 3. Pre-fix blocker list

| Severity | Items | Root cause | Blocking decision |
| --- | --- | --- | --- |
| P0 | R01, R16, R23 | TUI model loop lacks post-request invariant; empty stream/usage-only/reasoning-only can finish as success. | Blocks Phase 15 real-project Beta. |
| P1 | R02, R03, R05, R07, R08, R09, R10, R11, R15, R17, R22, R24, R25, R26 | Provider parser compatibility gaps, missing empty-response evidence, missing live/TUI acceptance harness. | Blocks Phase 15 real-project Beta until closed or explicitly PARTIAL with evidence. |
| P2 | R13 | HTTP body-specific diagnostics can improve later if summary-first/no-secret behavior remains safe. | Register for Phase 15.5 only if not needed for this P0 closure. |

## 4. Fix plan for this closure

1. Add a strict TUI model-loop invariant: after each provider request, if no assistant text, no tool calls, no provider error, and no interrupt/cancel, surface `provider_empty_response` / `model_empty_response` with summary-first next action.
2. Record safe transcript/evidence metadata for empty responses: provider/model, request id if known, finish reason if known, chunk count, usage presence. Do not record API key, Authorization header, raw request, raw response, or secrets.
3. Harden OpenAI-compatible parser for common chunk variants: `delta.content`, `delta.reasoning_content` / `reasoning`, `delta.tool_calls`, `choices[].message.content`, `choices[].message.tool_calls`, `finish_reason`, usage-only, empty choices, provider error object, malformed JSON/SSE.
4. Add provider parser tests and TUI integration tests for empty stream, provider error, no-pending yes/no, and model Write permission -> yes -> real file write.
5. Add repeatable live provider smoke and real TUI stdin smoke. If live env vars are absent, mark live provider smoke SKIPPED, not PASS.
6. Update delivery/handoff docs after validation; do not enter Phase 15 Beta, Phase 15.5, or Phase 16+.

## 5. Reference boundary

- CCB / Claude Code / OpenCode are behavior references only.
- This closure does not copy CCB / Claude Code / OpenCode source, internal APIs, variable structures, private implementation, proprietary telemetry, or decompiled traces.
- This closure does not start Phase 15 Beta, Phase 15.5, or Phase 16+.

## 6. Post-fix results

### 6.1 Source closure

本轮已完成 Phase 15 pre-Beta runtime acceptance 的最小源码级闭环，范围仅限 Phase 00-14 + Phase 15 pre-Beta runtime acceptance；未进入 Phase 15 Beta、Phase 15.5 或 Phase 16+。

- R01 / R16 / R23：TUI model loop 增加 post-request invariant。每轮 provider stream 结束后，如果没有 assistant text、没有 tool call、没有 provider error、没有 interrupt/cancel，则输出 summary-first `provider_empty_response` / `model_empty_response` 指引，不再静默回到 prompt。
- R02 / R03 / R05 / R06 / R07 / R08 / R09 / R10 / R11：OpenAI-compatible stream parser 已覆盖 `delta.content`、`delta.reasoning_content` / `reasoning`、fragmented `delta.tool_calls`、`choices[].message.content`、`choices[].message.tool_calls`、`finish_reason`、usage-only、empty choices、provider error object 和 malformed JSON/SSE。
- R15 / R17：TUI integration test 覆盖 model `Write` tool_use -> permission ask -> `yes` -> actual file write -> `tool_result` / evidence。
- R22 / R24：empty provider outcome 写入 safe evidence + system event，主输出只给中文/英文摘要、下一步和 evidence id；不记录 API key、Authorization header、raw request 或 raw response。
- R25：新增 `corepack pnpm smoke:live-provider`，只读取临时环境变量；无 key 时输出 SKIPPED，不能记为 PASS。
- R26：新增 `corepack pnpm smoke:tui-stdin` 作为可重复 stdin smoke 入口；本轮同时用 built CLI 在 `F:\linghun-ceshi` 执行真实 stdin smoke，证明不再静默失败。

### 6.2 Matrix after fix

| Result | Items | Evidence |
| --- | --- | --- |
| PASS | R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, R11, R12, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R26 | Focused provider/TUI tests, full test suite, typecheck/build/check, real TUI stdin smoke |
| PARTIAL / registered later | R13, R25 | R13 JSON/HTML body-specific diagnostics remains Phase 15.5 unless P0 evidence shows unsafe raw leakage; R25 live provider smoke was SKIPPED because no API key env var was present in this shell |
| FAIL | none for Phase 15 pre-Beta runtime silent-failure gate | n/a |

### 6.3 Validation evidence

- `corepack pnpm test -- --run packages/providers/src/index.test.ts packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts`：PASS，11 files / 244 tests。
- `corepack pnpm test`：PASS，11 files / 244 tests。
- `corepack pnpm check`：PASS after formatting changed files。
- `corepack pnpm typecheck`：PASS。
- `corepack pnpm build`：PASS。
- `git diff --check`：PASS；only CRLF warning lines, no whitespace errors.
- `corepack pnpm exec linghun --help`：PASS。
- `corepack pnpm exec Linghun --help`：PASS。
- `corepack pnpm smoke:live-provider`：SKIPPED，no `LINGHUN_DEEPSEEK_API_KEY` / `LINGHUN_OPENAI_API_KEY` in this shell; no key was written to repo, config, docs, or logs.
- Real Windows TUI stdin smoke with built CLI in `F:\linghun-ceshi`：PASS for silent-failure ban. Output reached visible outcome: `模型返回空响应；请运行 /model doctor，或切换 provider/model 后重试。` plus evidence id, then exited normally; no silent prompt return.
- `corepack pnpm smoke:tui-stdin` exists as repeatable entry, but direct `corepack pnpm --dir` from `F:\linghun-ceshi` hit local pnpm version enforcement; built CLI smoke above is the acceptance evidence for this run.

### 6.4 Verdict

- P0 verdict：PASS. R01 / R16 / R23 silent failure blocker is closed for Phase 15 pre-Beta runtime acceptance.
- Blocking P1 verdict：PASS for provider stream compatibility, TUI permission/write path, empty-response evidence, provider stream errors, and real TUI no-silent-failure smoke. Live provider smoke is SKIPPED due to missing env key and must not be reported as PASS.
- P2 / later：R13 remains registered for Phase 15.5 provider diagnostics maturity unless a Beta smoke proves it blocks safety or actionability.
- Phase 15 real-project Beta readiness：PARTIAL until live provider smoke is run with user-provided temporary env vars in a shell where keys are present; runtime silent-failure gate itself is PASS.
- Reference boundary：CCB / Claude Code / OpenCode were used only as behavior and acceptance references. No CCB / Claude Code / OpenCode source, internal API, private variable structure, proprietary telemetry, or decompiled implementation was copied.
