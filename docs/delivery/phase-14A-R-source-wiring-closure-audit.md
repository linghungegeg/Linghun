# Phase D.14A-R — Source Wiring Closure Audit

> 阶段：D.14A-R
> 日期：2026-05-30
> 工作目录：`F:\Linghun`
> 类型：源码级系统接入 / 闭环审查，不是开发阶段。
> 边界：本轮未改源码、未进入 D.14B、未新增功能；唯一写入为本审计报告。发现问题只登记，不修复。

## 1. Executive Summary

当前底座从主链接线角度 **没有发现 P0 级必须立即停工修复的问题**。D.13U Final Answer Claim Gate、D.13V Architecture / Completeness final gate、streaming block 清理、RuntimeStatusForModel prompt 投影降噪、deferred tools 默认主屏降噪仍真实接入 `sendMessage` / `continueModelAfterToolResults` 等主路径。

但本轮发现多个 **P1 级闭环缺口**，建议在进入真实 smoke / Beta / readiness 结论前修复或至少登记到下一阶段入口：

- Solution Completeness final closure block 只在 `sendMessage` 路径追加，`continueModelAfterToolResults` 路径缺镜像收口。
- AntiCodeBlob / 代码大文件 guard 目前是 prompt-only + standalone helper，不是 hard gate。
- `/verify smoke` 的合成 Node smoke 可被 readiness 投影为 `real-smoke`，容易被误读成真实 TUI/provider/report 主链 smoke。
- headless CLI `linghun model` 会输出 raw `base_url`。
- tool start banner 默认显示 Bash 命令前 120 字符，命令中若含 token / 私有 URL 有主屏泄漏风险。

进入 D.14B 的判断：**可以进入 D.14B 的源码开发前讨论/规划；不建议把当前状态称为 source-wiring fully closed、smoke-ready 或 release-ready。** 若 D.14B 会依赖 completeness continuation、AntiCodeBlob hard guard 或 readiness real-smoke 口径，应先处理相应 P1。

## 2. Audit Method

本轮不是按报告名单打勾，而是从源码主链和系统发现面反查：

- 主入口链：`runTui`、`processTuiLine`、`handleSlashCommand`、`sendMessage`、`continueModelAfterToolResults`、`executeModelToolUse`、`executeApprovedModelToolUse`、`executeDeferredDispatchToolUse`、`context.store.appendEvent`、`createModelSystemPrompt`。
- 文件扫描：`packages/tui/src` 下 `*runtime.ts`、`*guard.ts`、`*gate.ts`、`*boundary.ts`、`*presenter.ts`、`*cache.ts`、`*policy.ts`、`*doctor.ts`、`*command*.ts`。
- 语义扫描：`should*`、`validate*`、`detect*`、`classify*`、`evaluate*`、`guard*`、`gate*`、`check*`、`sanitize*`、`project*`、`summarize*`、`create*Prompt*`。
- Prompt/rule/directive/system 文案扫描：Rule、Guard、Boundary、Runtime、Anti、Freshness、Evidence、Architecture、Completeness、Verification、Readiness。
- 测试反推：从 `describe` / `it` / source invariant 找“宣称存在”的系统，再回源码确认是否主链触发。
- 并行只读子审查：主链 gate 接入、硬编码/泄漏流、系统发现与 AntiCodeBlob 状态。

读取的交付报告：

- `docs/delivery/phase-13U-anti-hallucination-final-answer-gate.md`
- `docs/delivery/phase-13V-BC-architecture-completeness-diagnostics-closure.md`
- `docs/delivery/phase-14A-index-modularization.md`
- `docs/delivery/phase-14A-2-index-structural-modularization.md`
- `docs/delivery/phase-14A-3-index-deep-structural-modularization.md`
- `docs/delivery/README.md`

## 3. Source-Discovered Systems Inventory

| System | Classification | Primary Source | Trigger / Main Path | Behavior | Impact Surface | Tests | Gap | Real Key Smoke |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TUI main dispatcher | active-main-chain | `packages/tui/src/index.ts:1117`, `1932`, `1979` | `runTui` -> `processTuiLine` -> slash or model message | Creates context, routes local commands, sends natural messages to model loop | transcript, main screen, status | broad `index.test.ts` | OK | No |
| D.13U Final Answer Claim Gate | active-main-chain | `index.ts:5809`, `5923`, `6294`, `6383`; `model-loop-runtime.ts:694` | `sendMessage` and continuation final-answer path | Detects high-risk claims; one retry; local downgrade on second failure | transcript, streaming block, system_event, evidence | `model-loop-runtime.test.ts`, `index.test.ts` D.13U | OK | Recommended before Beta |
| One-retry budget | active-main-chain | `index.ts:5616`, `5810`, `5832`, `6191`, `6295`, `6316` | shared `finalAnswerClaimRetried` in both model loops | D.13U and D.13V-B share one retry, then downgrade | transcript, streaming block | D.13V source invariants | OK | No |
| Streaming / Ctrl+O residue cleanup | active-main-chain | `tui-output-surface.ts:143`, `160`; `index.ts:5827`, `5937`, `6311`, `6396` | retry calls `discardAssistantBlock`; downgrade calls `replaceAssistantBlockContent` | Clears or replaces unsafe original text in block and `lastFullOutput` | main screen, Ctrl+O, `/details`, transcript | D.13V-A tests | OK | No |
| D.13V Architecture / Completeness final gate | active-main-chain | `final-answer-gate.ts:26`; `index.ts:5833`, `6317` | final answer before appendEvent | Checks architecture drift / evidence / completeness classification; retry or downgrade | transcript, system_event, prompt/evidence | `model-loop-runtime.test.ts`, `index.test.ts` | OK | Recommended |
| Solution Completeness prompt gate | active-main-chain + prompt-only | `model-prompt-runtime.ts:10`, `54`; `index.ts:5644` | `createModelSystemPrompt` mutates `context.solutionCompleteness` and injects warning | Prompts model to classify `single_issue` / `systemic_gap` | prompt, system_event, evidence refs | index prompt tests | P1 continuation closure gap | Yes |
| Solution Completeness report closure block | active-main-chain, partial | `final-answer-gate.ts:14`; `index.ts:5963` | after `sendMessage` assistant append | Appends human-readable closure report if classification missing | main screen, system_event | source/behavior tests incomplete | P1 | Yes, continuation |
| Evidence Gate for code-fact user input | active-main-chain | `index.ts:5591`; `final-answer-gate.ts:84` | before model provider call | Blocks code/fix/verified/call-chain requests with no local code evidence | main screen, system_event | D.13U tests | OK/P2 possible UX false positive | Optional |
| Manual `/claim-check` | active-main-chain command | `index.ts:4104`; `final-answer-gate.ts:270` | slash command | Reuses evaluator and Beta verdict scope | main screen, transcript event | D.13U tests | OK | No |
| Architecture Runtime Card + Directive | active-main-chain | `architecture-runtime.ts:78`, `143`, `206`; `index.ts:5633` | systemic task input -> architecture card -> system prompt | Creates card, stores evidence, injects directive | prompt, evidence, system_event, handoff | `architecture-runtime.test.ts`, `index.test.ts` | OK/P2 regex heuristic | Yes |
| Architecture Drift Tool Gate | active-main-chain | `index.ts:6514`; `architecture-runtime.ts:220` | before model tool execution | Blocks tool use that expands scope/config/non-goal/stale facts until local approval | pending approval, main screen, system_event | architecture drift tests | OK | Yes |
| AntiCodeBlob / EngineeringStructure | prompt-only | `model-prompt-runtime.ts:27`; `architecture-runtime.ts:213` | always in base prompt; stronger in architecture directive | Tells model not to pile logic into large files | prompt only | prompt/directive tests | P1 if expected as hard gate | Yes |
| LegacyLargeFileDebt | prompt-only | `architecture-runtime.ts:214` | architecture directive only | Says `index.ts` is risk signal, not violation/permission denial | prompt only | `architecture-runtime.test.ts` | P1/P2 | Yes |
| Architecture Boundary Guard | standalone-helper / test-only scanning | `architecture-boundary.ts:128`, `281`, `372` | no main-chain auto scan found | Pure detection for large file/function/nesting/cross-layer/circular risk | test/report helper only | `architecture-boundary.test.ts` | P1 if required as runtime guard | No provider key |
| RuntimeStatusForModel prompt projection | active prompt hygiene | `model-prompt-runtime.ts:35`; `model-loop-runtime.ts:1021` | `sendMessage` -> build runtime status -> project for prompt | Keeps `model.name`, permission/cache/index/memory; strips provider/baseUrl/endpointProfile | prompt | D.13V-C tests | OK/P2 type residual | Optional |
| Deferred tools primary-text sanitizer | active-main-chain | `index.ts:6768`, `6834`, `6904`, `6927`; `model-loop-runtime.ts:1087` | model tool_use `SearchExtraTools` / `ExecuteExtraTool` | raw text stored in tool_result/evidence; main screen gets product copy | main screen, details, transcript | sanitizer tests, source invariant | OK | Optional with MCP |
| Workspace Reference Cache fallback guard | active support system | `workspace-reference-cache.ts:247`, `282`, `297`; `terminal-readiness-runtime.ts:41`, `361` | cache refresh and readiness projection | Marks fallback-stale/fallback-empty, encodes source in hash, readiness does not treat fallback as ready | cache, readiness, prompt freshness | `workspace-reference-cache.test.ts` | OK | No |
| Verification Runner `/verify` | active-main-chain command | `index.ts:4809`; `verification-command-runtime.ts:16`, `68` | slash `/verify` | Runs plan, writes `verification_start/end`, `lastVerification`, `test_result` evidence | transcript, evidence, background, main screen | index verification tests | OK/P1 smoke label issue | No key for local |
| Verification Level / Readiness | active command projection + standalone helper | `terminal-readiness-runtime.ts:130`; `verification-level.ts:85` | `/doctor`, `/status`, readiness view | Classifies source/local/build/real-smoke; prevents partial/mock/stale upgrade | doctor/status, readiness items | `verification-level.test.ts`, `guard-wiring.test.ts`, `index.test.ts` | P1 synthetic smoke issue | Yes for readiness claims |
| Provider readiness item | standalone presenter in active doctor/status | `terminal-readiness-presenter.ts:259` | `/status` / `/doctor` | Displays `provider/model` as pass if provider not unknown and no last failure | main screen doctor/status | readiness tests | P1 | Yes |
| Index large-file safety gate | active-main-chain command | `mcp-index-runtime.ts:721`; `index-result-presenter.ts:99` | `/index init/refresh` | Blocks risky large index inputs unless force/ignore repair path | main screen, evidence, index status | index safety repair tests | OK | No |
| Report Write Guard | active-main-chain | `permission-continuation-runtime.ts:234`; `index.ts:5601`, `5782`, `5918` | model report-writing task | Requires evidence read, Write/Edit path, final reference; records incomplete | prompt, tool loop, evidence, main screen | report guard tests | OK | Yes |
| Tool start presenter | active-main-chain display helper | `tool-output-presenter.ts:91`; `index.ts:6691` | before approved `runTool` | Shows `Bash(<command>)`, `Read(<path>)`, etc. | main screen, lastFullOutput | presenter tests | P1 secret-in-command display | No |
| Model doctor / route doctor | active explicit diagnostics | `model-doctor-runtime.ts`; `index.ts` model commands | explicit `/model doctor` / route doctor | Shows provider/model/endpoint diagnostics, masks API key | main screen/details | doctor tests | OK, allowed explicit diagnostics | No |
| Headless CLI model status | active CLI command | `apps/cli/src/cli.ts:193` | `linghun model` | Shows raw `base_url` | CLI main screen | minimal CLI tests | P1 | No |

## 4. Main-Chain Wiring Table

| Classification | Systems |
| --- | --- |
| active-main-chain | TUI dispatcher, D.13U final answer gate, D.13V architecture/completeness final gate, retry/downgrade, streaming block cleanup, evidence gate, `/claim-check`, Architecture Runtime card, Architecture Drift tool gate, deferred dispatch sanitizer, workspace cache fallback projection, `/verify`, readiness view, index safety gate, report write guard |
| prompt-only | AntiCodeBlob / EngineeringStructure, LegacyLargeFileDebt, FreshnessRule external-current guidance, RuntimeIdentityRule user-facing provider hiding |
| test-only | Several source invariant anchors in `index.test.ts`; Architecture Boundary scanning is tested but not automatically wired to main chain |
| dead-unused | No clear dead-unused P0 found in the audited D.13U/D.13V/D.14A main-chain systems. `architecture-boundary.ts` is not dead because tests and helpers use it, but it is not runtime-wired as a hard gate |
| standalone-helper | `architecture-boundary.ts`, `verification-level.ts`, `guard-wiring.ts`, `tool-output-presenter.ts`, `runtime-status-presenter.ts`, command/readiness presenters |
| intentionally-deferred | FreshnessLite input regex gate remains intentionally removed; LegacyLargeFileDebt explicitly says large file is not a violation/permission denial; Ctrl+O fallback ids remain details-layer deferred per D.13V-B/C |

## 5. Hardcoded / Default / Fake / Internal-Leak Audit

| Area | Finding | Evidence | Classification | Severity |
| --- | --- | --- | --- | --- |
| Prompt provider route | `RuntimeStatusForModel` prompt projection strips provider/baseUrl/endpointProfile | `model-prompt-runtime.ts:35`, `model-loop-runtime.ts:1021` | active prompt hygiene | OK |
| Runtime route transcript | `model_request` system_event stores provider/model/endpointProfile, but recent context filters out `system_event` | `index.ts:5602`, `buildModelMessagesWithRecentContext` filter at `index.ts:5983` | diagnostic transcript only | P2 |
| Headless CLI base URL | `linghun model` prints `base_url：${baseUrl}` raw | `apps/cli/src/cli.ts:193` | main-screen CLI leak | P1 |
| Synthetic smoke | `/verify smoke` uses `node -e "console.log('linghun verify smoke')"` and readiness treats smoke-kind pass as `real-smoke` | `verification-command-runtime.ts:20`, `terminal-readiness-runtime.ts:167` | fake/default smoke inflation | P1 |
| Provider readiness | provider/model item is `pass` when provider is not `unknown` and no last failure | `terminal-readiness-presenter.ts:263` | configured/default as pass | P1 |
| Tool command display | `formatToolStart` displays raw Bash command up to 120 chars | `tool-output-presenter.ts:91` | possible secret-in-command leak | P1 |
| Deferred internals | `SearchExtraTools` / `ExecuteExtraTool` raw names remain in tool_result/evidence/system_event, but main screen is sanitized | `index.ts:6834`, `6904`, `6927`; `model-loop-runtime.ts:1087` | diagnostic allowed; main-screen OK | OK/P2 |
| Tool evidence id to model | recent context includes `evidenceId` in tool messages | `index.ts:6027`, `6039` | internal evidence id in prompt | P2 |
| Workspace cache fallback | fallback source encoded and readiness treats fallback as stale/missing | `workspace-reference-cache.ts:282`, `terminal-readiness-runtime.ts:41` | active guard | OK |
| Placeholder live smoke script | root `smoke:live-provider` can use `openai-compatible-model` default | `package.json` script | placeholder model in real smoke path | P1 |
| Source-of-truth readiness docs | readiness linter hardcodes Phase 15.5 docs and phrases | `terminal-readiness-runtime.ts:294` | project-specific hardcode | P2 |

## 6. P0 / P1 / P2 Findings

### P0

No P0 found in this read-only audit.

### P1

1. **Continuation path misses Solution Completeness closure block**
   Files/functions: `packages/tui/src/index.ts:5963` has `needsSolutionCompletenessReportClosure` after normal `sendMessage`; `packages/tui/src/index.ts:6416` continuation appends assistant text without mirrored closure.
   Call path: `executeModelToolUse` pending approval -> `continueModelAfterToolResults` -> final assistant append.
   Why problem: D.13V final gate still runs, but the post-answer human closure report is absent on continuation. Approval/tool-result workflows can therefore miss the same closure surface that normal model answers get.
   Impact: main screen/reporting consistency; no unsafe transcript original found.
   Level: P1.
   Real key smoke: yes, for “tool approval continuation + completeness trigger”.

2. **AntiCodeBlob is not a hard gate**
   Files/functions: `model-prompt-runtime.ts:27`, `architecture-runtime.ts:213`; standalone scanner in `architecture-boundary.ts:128`.
   Call path: prompt assembly only; no automatic scan before Write/Edit/MultiEdit/Bash or final answer.
   Why problem: if documentation or later phases rely on AntiCodeBlob as runtime enforcement, source reality does not match.
   Impact: prompt/model behavior only; no blocking/transcript enforcement.
   Level: P1 for wiring closure expectations; OK if intentionally prompt-only.
   Real key smoke: yes for model compliance, not for hard enforcement.

3. **Synthetic `/verify smoke` can project as `real-smoke`**
   Files/functions: `verification-command-runtime.ts:20`, `terminal-readiness-runtime.ts:167`, `verification-level.ts:85`.
   Call path: `/verify smoke` -> synthetic Node command PASS -> lastVerification status pass -> readiness `smokePassed=true` -> `realProcessObserved=true`.
   Why problem: it can be mistaken for real TUI/provider/report smoke, although it only proves a local Node process can run.
   Impact: readiness/status/doctor wording and handoff interpretation.
   Level: P1.
   Real key smoke: yes before any provider/TUI/report readiness claim.

4. **Headless CLI model status leaks raw `base_url`**
   Files/functions: `apps/cli/src/cli.ts:193`.
   Call path: `linghun model` -> `formatModelInfo`.
   Why problem: private relay URLs, query-bearing URLs, or internal endpoints can be printed on the main CLI screen.
   Impact: main screen / logs.
   Level: P1.
   Real key smoke: no.

5. **Tool start banner displays raw Bash command**
   Files/functions: `tool-output-presenter.ts:91`, caller `index.ts:6691`.
   Call path: approved model/slash tool -> `formatToolStart` -> `writeLine`.
   Why problem: command text may include env tokens, Authorization headers, or private URLs.
   Impact: main screen / `lastFullOutput`.
   Level: P1.
   Real key smoke: no.

6. **Provider readiness item can show `pass` without live endpoint evidence**
   Files/functions: `terminal-readiness-presenter.ts:263`.
   Call path: `/status` or `/doctor` -> readiness view -> `createReadinessItems`.
   Why problem: configured provider/model with no last failure is not proof of provider availability. Current surrounding copy says local evidence only, but the row-level `pass` can still be misread.
   Impact: readiness main screen.
   Level: P1.
   Real key smoke: yes for provider-ready claims.

7. **Root live provider smoke can default to placeholder model**
   Files/functions: root `package.json` `smoke:live-provider` script.
   Call path: env key present -> OpenAI-compatible provider uses `LINGHUN_OPENAI_MODEL || 'openai-compatible-model'`.
   Why problem: placeholder model may enter a real provider path and fail/mislead; script only proves basic provider text/tool response, not TUI/report readiness.
   Impact: smoke interpretation.
   Level: P1.
   Real key smoke: yes, with explicit real model.

### P2

- `RuntimeStatusForModel` source type still includes `model.provider`; prompt projection is safe now, but future direct `JSON.stringify(runtimeStatus)` would reintroduce provider leakage.
- `model_request` system_event records provider/model/endpointProfile in transcript; it is not default prompt/main-screen, but export/details can show it.
- Recent-context tool summaries include `evidenceId`; useful for follow-up, but it is internal id exposure to the model.
- Source invariant tests are partly string-anchor based after D.14A modularization; behavior tests should be preferred for future regressions.
- Source-of-truth readiness linter hardcodes Phase 15.5 docs and phrases; useful for Linghun, but project-specific.

## 7. AntiCodeBlob / Large-File Guard Real Wiring

Current source truth:

- `AntiCodeBlob` is **prompt-only**. It appears in base `EngineeringStructure` prompt and in Architecture Runtime directive when triggered.
- `LegacyLargeFileDebt` is **prompt-only / intentionally non-blocking**. It explicitly says `index.ts` is a maintenance-risk signal, not a violation, not permission denial, and not a hard prohibition.
- `architecture-boundary.ts` is a **standalone-helper / test-covered detector**. It can detect large file, god file, large function, deep nesting, cross-layer import, and circular risk, but this audit found no automatic main-chain scan before writes or final answers.
- Index large-file safety is a separate **active-main-chain** system for `/index init/refresh`; it protects indexing cost/noise, not code structure.

Conclusion: **there is no AntiCodeBlob hard gate today.** Any statement that AntiCodeBlob blocks writes or enforces architecture boundaries at runtime would be inaccurate.

## 8. D.13U / D.13V Gate Regression Status

- D.13U final-answer claim gate is still in both `sendMessage` and `continueModelAfterToolResults` before `assistant_text_delta` append.
- Retry budget is still function-local and once-only in both paths.
- Retry calls `discardAssistantBlock`; downgrade calls `replaceAssistantBlockContent`, so Ink streaming block and `lastFullOutput` are cleaned/replaced.
- D.13V Architecture / Completeness final gate is still in both final-answer paths before append.
- RuntimeStatusForModel prompt path still uses `projectRuntimeStatusForPrompt`, stripping provider/baseUrl/endpointProfile.
- Deferred tools default main-screen output still uses `sanitizeDeferredToolPrimaryText`; raw internal text remains in tool_result/evidence for diagnostics.
- Workspace reference fallback/stale states remain distinguished and are not counted as ready workspace snapshots in readiness.
- Verification/readiness no longer upgrades partial/mock/stale reports, but synthetic `/verify smoke` still overstates as `real-smoke`.

## 9. Validation Commands And Results

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | PASS, exit 0 |
| `corepack pnpm --filter @linghun/tui build` | PASS, exit 0 |
| `corepack pnpm --filter @linghun/cli build` | PASS, exit 0 |
| `corepack pnpm --filter @linghun/tui exec vitest src/model-loop-runtime.test.ts --run` | PASS, 119 passed |
| `corepack pnpm --filter @linghun/tui exec vitest src/index.test.ts -t D.13U --run` | PASS, 5 passed / 312 skipped |
| `corepack pnpm --filter @linghun/tui exec vitest src/index.test.ts -t D.13V-A --run` | PASS, 16 passed / 301 skipped |
| `corepack pnpm --filter @linghun/tui exec vitest src/index.test.ts -t D.13V-B --run` | PASS, 6 passed / 311 skipped |
| `corepack pnpm --filter @linghun/tui exec vitest src/index.test.ts -t D.13V-B/C --run` | PASS, 6 passed / 311 skipped |
| `corepack pnpm --filter @linghun/tui exec vitest src/tool-output-presenter.test.ts src/runtime-status-presenter.test.ts src/workspace-reference-cache.test.ts src/architecture-runtime.test.ts src/architecture-boundary.test.ts src/verification-level.test.ts --run` | PASS, 125 passed |
| `git diff --check` | PASS, exit 0 |

Note: one combined Windows command using `-t "D.13U|D.13V-A|D.13V-B|D.13V-B/C"` was split by the shell as a pipeline before Vitest ran. It was rerun as four separate focused commands above. Full Vitest was not part of the minimal validation plan for this audit. If later run, compare against the known D.14A baseline of 44 failing `@linghun/tui` tests and report whether the failing-test-name set changes.

## 10. Boundary Confirmation

- This was an audit only, not a development phase.
- No source code was changed.
- No P0 was fixed or attempted.
- No D.14B work was started.
- No new feature, dependency, config, migration, provider route, permission mode, or release process change was made.
- No real provider key smoke was run in this audit.

## 11. Handoff Packet

```yaml
phase: D.14A-R
status: AUDIT_COMPLETE
source_changes: none
report_file: docs/delivery/phase-14A-R-source-wiring-closure-audit.md
can_enter_D14B:
  discussion_or_planning: true
  source_wiring_fully_closed_claim: false
  smoke_ready_claim: false
blocking_findings:
  P0: []
  P1:
    - continuation_missing_solution_completeness_closure
    - anti_code_blob_prompt_only_not_hard_gate
    - verify_smoke_synthetic_real_smoke_projection
    - cli_model_raw_base_url_output
    - bash_tool_start_raw_command_display
    - provider_readiness_pass_without_live_evidence
    - live_provider_smoke_placeholder_model_default
real_key_smoke_needed_before:
  - provider_ready_claims
  - beta_or_release_readiness_claims
  - final_answer_gate_real_model_behavior_claims
  - architecture_drift_tool_use_real_model_behavior_claims
validation:
  tsc_no_emit: PASS
  tui_build: PASS
  cli_build: PASS
  model_loop_runtime_tests: "119 passed"
  index_D13U: "5 passed"
  index_D13V_A: "16 passed"
  index_D13V_B: "6 passed"
  index_D13V_BC: "6 passed"
  focused_runtime_presenter_cache_architecture_verification_tests: "125 passed"
  git_diff_check: PASS
  full_vitest: "not run; known D.14A baseline is 44 failing @linghun/tui tests"
forbidden_next_without_user_confirmation:
  - fix P1 findings
  - enter D.14B implementation
  - add AntiCodeBlob hard gate
  - change verification/readiness semantics
  - run real provider smoke
```
