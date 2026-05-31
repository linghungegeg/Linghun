# Phase 15 Beta CCB Maturity Remediation Baseline

> Date: 2026-05-19
> Scope: execution baseline distilled from the two Phase 00-18 full audits.
> Source audits:
> - `F:\Linghun\LINGHUN_PHASE_00_18_DESIGN_RUNTIME_OVERDESIGN_FULL_AUDIT.md`
> - `F:\Linghun\PHASE_00_18_DESIGN_RUNTIME_OVERDESIGN_FULL_AUDIT.md`

This document is not a third audit and not a closure report. It is the single execution baseline for the next implementation round before Phase 15 Beta.

## 1. Executive Decision

Phase 15 Beta remains paused.

The two full audits agree on the core diagnosis: Linghun is not an empty shell and not a failed direction. It has a broad pre-Beta engineering base: provider adapters, tool schemas, permission guards, transcript/evidence, cache/index/memory, verification, Chinese/Windows ergonomics, and TUI output presenters all exist in meaningful form.

The blocker is that the base has not yet been compressed into a CCB-grade runtime chain. Phase 15 Beta must not start until the default terminal coding workflow is mature:

```text
ordinary user request
-> session/context assembly
-> model query
-> tool_use
-> permission
-> tool_result
-> continuation
-> final answer
```

The target is not to copy CCB source code or UI internals. The target is CCB-level maturity of the bottom runtime: one stable main loop, clear control-plane boundaries, real tool lifecycle, usable permissions, resilient provider profiles, reliable session context, and acceptance tests based on real behavior.

## 2. Current Maturity Summary

| Area | Current state | Beta decision |
| --- | --- | --- |
| Provider foundation | Basic chat/responses parsing, DeepSeek/openai-compatible support, error classification and tool event parsing exist. | Keep, but harden profile contracts and retry/timeout behavior before Beta. |
| Tool foundation | Core tools and summary/truncation paths exist. | Must add runtime validation/lifecycle metadata and ensure tool_result continuation. |
| Permission foundation | Default fail-closed behavior exists for risky tools. | Must become real interactive continuation for Write/Edit/MultiEdit/Bash, not only prompt text. |
| Session/transcript | Transcript/evidence store exists. | Must become a runtime context source; current zero/weak history injection blocks CCB maturity. |
| TUI/output | Summary-first presenters and status/doctor paths exist. | Must finish main-screen layering and details access before Beta. |
| NCB/control plane | Rich command catalog and natural language bridge exist. | Must weaken. It should be a control-plane/safety bridge, not a second natural language executor. |
| MCP/Skills/Workflows/Plugins/Hooks | Types, docs, diagnostics, and control surfaces exist. | Must either become real minimal runtime or be hidden/marked unavailable before Beta. |
| Agent/background | Types and status paths exist. | Must fix fake background/dead states or defer visible promises. |
| Windows/build/config | Many basics are good: ESM, low dependency surface, path/encoding work, Windows entry points. | Must add config schema recovery and reproducible Windows smoke boundaries. |
| Documentation/readiness | Evidence-first language exists, but historical PASS/closure reports overstate maturity. | Old closure/PASS is downgraded. This baseline is the current source of truth. |

## 3. Beta Entry Principle

Entering real project Beta means Linghun should already feel mature for the default coding loop. Beta may still discover project-specific bugs, model quirks, and provider edge cases. Beta must not be used to discover already-known structural issues such as missing session history, fake feature surfaces, non-continuing tool results, provider schema mixing, or NCB keyword routing.

Before Beta, Linghun must reach:

- CCB-equivalent default coding runtime.
- Linghun-better local advantages where already designed: Chinese UX, Windows path/encoding care, DeepSeek/openai-compatible ecosystem support, local evidence for anti-hallucination, no telemetry.
- Explicit deferral for capabilities that are not needed for the default coding loop.

## 4. Must Complete Before Phase 15 Beta

### A. Main Runtime Chain

1. Ordinary development requests must enter the model loop by default.
2. NCB, gates, hints, cache/index/memory, agents, workflows, and multi-model routes must not intercept ordinary coding requests.
3. Tool output must never be treated as the final assistant answer.
4. Every tool outcome must be represented as continuation input: allow, deny, cancel, error, timeout, and abort.
5. The final answer must come after tool_result continuation or an explicit stopping condition.

### B. Session And Context

1. `sendMessage` or its replacement must assemble recent conversation history, not only `[system, current user input]`.
2. Transcript must stop being only an audit log; it must also provide the minimal recent context needed by the model.
3. Add token counting or an equivalent conservative context budget.
4. Add context overflow handling. A minimal warning/stop is acceptable for Beta; full semantic compact can be deferred if the model never silently hits provider limits.
5. Memory/evidence injection must be small, relevant, and bounded.

### C. Provider Profile Contracts

1. Split runtime contracts clearly:
   - `deepseek_chat_completions`
   - `openai_compatible_chat_completions`
   - `openai_responses`
2. Each profile must define request body, tool schema, tool_result shape, stream parsing, error classification, and doctor/smoke expectations.
3. Chat and responses schemas must not mix.
4. No implicit fallback may hide a provider/profile mismatch.
5. Add retry for transient provider failures: at least 429, 502, 503, 504, and network `TypeError`.
6. Respect `Retry-After` where available.
7. Add stream heartbeat/timeout handling so a hung stream does not block forever.
8. Ensure partial or fragmented tool calls are not silently dropped at stream end.

### D. Tool Lifecycle

1. Replace unsafe tool input casts with runtime validation, preferably Zod schemas matching the existing tool contract.
2. Add minimal lifecycle metadata to tool definitions:
   - enabled/disabled
   - read-only/destructive
   - interrupt behavior
   - max result size
3. Store full large outputs outside the main screen and expose a details path.
4. Tool errors must not crash the session; they must produce actionable tool_result/error context.
5. Read/Grep/Glob/Diff/Write/Edit/MultiEdit/Bash/Todo must all follow the same lifecycle boundary.

### E. Permission Continuation

1. Write/Edit/MultiEdit/Bash must support pending approval.
2. `yes/no/confirm/cancel` must only consume an active pending permission or gate.
3. Without pending state, confirmation words must not be sent to the model as ordinary user intent.
4. Approval executes the tool; denial/cancel/error returns tool_result context and continues the model loop.
5. Permission UI must show action, scope, risk, reason, rollback/next step, and choices without leaking raw policy fields.

### F. NCB And Gates

1. NCB is downgraded from natural language executor to control-plane/safety bridge.
2. It may handle slash equivalents, status/doctor/help/cache/index/model/memory queries, and risky-action blocking.
3. It must not solve ordinary coding intent through keyword scoring or per-capability boost logic.
4. Verdict/Solution/Evidence gates are removed from ordinary task output and default system prompt.
5. Those gates remain available only for explicit audit, claim-check, handoff, readiness, or user-requested review contexts.

### G. TYPE-SHELL Surfaces

For every visible MCP/Skills/Workflows/Plugins/Hooks/Agent capability, choose one:

- Real minimal runtime before Beta.
- Hide/disable from user-visible readiness.
- Mark clearly as diagnostic/planned and not part of Phase 00-14 maturity.

Minimum Beta requirement:

1. MCP visible claims must be backed by real `tools/list` and at least safe `tools/call` behavior, or be disabled from the main story.
2. Skills must load useful content and inject/trigger it in a bounded way, or be marked non-runtime.
3. Hooks must not claim enforcement unless PreToolUse/PostToolUse actually runs.
4. Agent/background must not expose fake background execution or dead states.
5. Workflows/plugins may be deferred if they are not used as Beta readiness evidence.

### H. TUI / UX / Status

1. Main screen must separate assistant final answer, tool use, tool result, permission, status, hint, and error.
2. Add a user-accessible details path for full tool output, for example `/details` or an equivalent existing command.
3. Status/doctor must show actual runtime source of truth, not stale defaults.
4. Basic terminal color is allowed if it improves readability, but it is not a substitute for behavior.
5. Error messages must include what happened, likely cause, and next action.

### I. Config / Windows / Operational Reliability

1. Add runtime config schema validation and damaged settings recovery.
2. Config writes must be safe enough for Beta, preferably temp-then-rename.
3. Windows smoke must be reproducible for help/version, basic TUI stdin, paths with non-ASCII/space, and tool output encoding.
4. Exit must clean child processes and temporary state.
5. Obvious unbounded arrays must be capped or trimmed, especially evidence/background/session-facing collections.

### J. Verification Gates

Before Phase 15 Beta can be recommended, verification must include:

1. `test`, `typecheck`, and `build`.
2. Real TUI stdin smoke on Windows.
3. Real provider basic text smoke, or explicit SKIPPED when credentials are absent.
4. Real provider `tool_use -> tool_result -> continuation -> final answer` smoke.
5. Real report-generation path:
   - model reads project files,
   - model requests Write or equivalent report output,
   - permission is shown,
   - user approval is consumed,
   - tool_result is returned,
   - model gives final answer,
   - file exists.
6. Provider/profile failure smoke where tools are unsupported or schema mismatched.
7. Config corruption/recovery smoke.
8. No historical mock/focused/string assertion may be used as the sole readiness proof.

## 5. Should Complete In The Same Closure

These items are not new product scope; they reduce regression risk while touching the same runtime:

1. Split `packages\tui\src\index.ts` enough to prevent the next fixes from making the single-file risk worse. Preferred modules:
   - model/runtime loop
   - permission continuation
   - runtime resolution
   - details/output store
   - NCB/control-plane boundary
   - session/context assembly
2. Unify command catalog/help/NCB source of truth where feasible.
3. Remove ordinary-task gate text from default prompts.
4. Downgrade historical closure docs in handoff wording.
5. Add session list pagination or read caps if current metadata scans are unbounded.
6. Add output/log rotation or caps where growth is obvious.
7. Add package publishing boundaries such as `files` for built artifacts if packaging is already touched.

## 6. Explicitly Deferred

These are not allowed to block Phase 15 Beta if the default CCB-grade coding loop passes:

| Item | Deferred to | Reason |
| --- | --- | --- |
| Full semantic compact/summarization | Phase 15.5 or 16 | Beta needs bounded context and no silent overflow; polished compact can wait. |
| Full hook execution ecosystem | Phase 15.5 | Minimal enforcement may be needed if visible; full hook pipeline is release hardening. |
| Workflow state machine | Phase 15.5 | Not required for default coding loop; do not use as maturity proof before runtime exists. |
| Plugin contribution registry | Phase 15.5 | Same as workflows; visible claims must be disabled or diagnostic-only. |
| Agent team coordination / inter-agent communication | Phase 15.5+ | Phase 15 Beta should first prove one-session coding maturity. |
| Full concurrent tool scheduler | Phase 15.5 | Sequential tool loop can be Beta-acceptable if continuation is correct. |
| Rich expand/collapse UI | Phase 15.5 | Details command/path is enough before richer UI. |
| Deep provider registry UI / compat matrix UI | Phase 15.5 | Profile contracts and doctor are required; polished UI can wait. |
| Automatic learning loop | Phase 16 | Must remain explicit, bounded, and reversible. |
| Long-running remote channels | Phase 17 | Too much permission/state/security complexity before CLI maturity. |
| Desktop app shell | Phase 18 | Must not wrap an unstable CLI. |
| Vision/image routing | Phase 15.5+ | Not part of the default text coding loop unless user explicitly prioritizes it. |

## 7. Remove Or Disable

1. NCB keyword-scoring expansion for ordinary coding tasks.
2. Per-capability boost patches as a maturity strategy.
3. Ordinary-output Verdict/Solution/Evidence gate reports.
4. `declared surface PASS == CCB mature` wording.
5. TYPE-SHELL capabilities as readiness proof.
6. Hidden provider fallback that changes schema silently.
7. Any hardcoded project phase verdict in runtime code.
8. Any hardcoded phase/smoke artifact in user-facing runtime prompt/help/UI, such as `Phase 13/14/15/preflight`, `DEPLOY_REPORT.md`, `PHASE15_RC`, `Gate F`, or fixed smoke-only model/endpoint names. These may appear in docs/tests/fixtures only.
9. Any MCP/deferred tool blind execution before discovery and required-argument validation, such as calling `get_code_snippet` without a discovered `qualified_name`.
10. Any new feature work in Phase 15.5/16/17/18 before this baseline is closed.

## 8. Anti-Patterns Banned For This Closure

- Adding more Chinese/English trigger words to prove maturity.
- Replacing runtime behavior with prompt text.
- Counting mock/focused/string assertions as Beta readiness.
- Letting control-plane requests steal ordinary coding tasks.
- Treating tool output as final answer.
- Letting provider streams hang indefinitely.
- Silently dropping partial tool calls.
- Using `input as never` or equivalent unchecked tool input.
- Letting user-visible features remain type-only shells.
- Growing `packages\tui\src\index.ts` with new behavior instead of extracting the touched path.
- Writing new closure documents that make local PASS sound like Beta PASS.

## 9. Acceptance Matrix

| Gate | Required result |
| --- | --- |
| Ordinary coding request | Reaches model loop, not NCB keyword execution. |
| Multi-turn context | Model sees relevant recent history. |
| Context budget | Token/context size is checked or fails visibly before provider failure. |
| Tool validation | Invalid tool inputs are rejected with clear error. |
| Tool continuation | tool_result always returns to model before final answer unless stopped. |
| Permission approval | Write/Edit/MultiEdit/Bash pending approvals work. |
| Permission denial | Denial/cancel becomes model-visible tool_result context. |
| Provider profile | DeepSeek chat, openai-compatible chat, and OpenAI responses have separate contracts. |
| Provider resilience | Transient errors retry; hung stream times out. |
| Report generation | Real provider + real TUI + file output path passes or is explicitly PARTIAL/SKIPPED with reason. |
| Control-plane | `/help`, `/model doctor`, `/index status`, cache/memory/status queries are local and quiet. |
| NCB | Safety/control only; no ordinary task executor. |
| TYPE-SHELL | Visible claims are real minimal runtime or disabled/deferred. |
| TUI output | Main screen is summary-first; details are accessible. |
| Config | Damaged settings do not crash the app. |
| Windows | Help/version/TUI stdin/path/encoding smoke passes on Windows. |

## 10. Documentation Updates Required

The following existing documents must treat this baseline as the current source of truth:

- `F:\Linghun\START_NEXT_CHAT.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`

Required wording changes:

1. Phase 15 Beta is paused until this baseline is closed.
2. Historical Phase 15 pre-Beta closure/PASS reports are evidence inputs only, not readiness proof.
3. The next implementation round is CCB maturity remediation, not another audit and not Phase 15.5.
4. Phase 15.5/16/17/18 are frozen except for explicit deferred items listed here.
5. Beta entry requires real runtime verification, especially report-generation path.

## 11. Implementation Session Command

Use this as the next implementation command:

```text
进入 F:\Linghun，执行 Phase 15 Beta CCB Maturity Remediation。

本轮依据唯一执行基线：
F:\Linghun\PHASE_15_BETA_CCB_MATURITY_REMEDIATION_BASELINE.md

同时只读参考两份全量审计：
F:\Linghun\LINGHUN_PHASE_00_18_DESIGN_RUNTIME_OVERDESIGN_FULL_AUDIT.md
F:\Linghun\PHASE_00_18_DESIGN_RUNTIME_OVERDESIGN_FULL_AUDIT.md

目标：
在进入 Phase 15 Beta 前，把 Linghun 的默认终端编码主链路做到 CCB 成熟度：普通输入 -> 会话上下文 -> 模型 -> tool_use -> permission -> tool_result -> continuation -> final answer。

本轮允许进行必要的底层成熟度修复、模块拆分和文档口径同步。不要复制 CCB 源码；只吸收成熟行为边界和验收标准。不要进入 Phase 15 Beta / Phase 15.5 / Phase 16+。不要新增产品愿景。不要用关键词补丁、文案补丁、mock PASS 或历史 closure PASS 证明成熟。

必须优先关闭 baseline 第 4 节 Must Complete Before Phase 15 Beta，并按第 9 节 Acceptance Matrix 验证。

完成后输出：
- 修改文件清单
- baseline 每项完成/未完成状态
- 验证命令和结果
- Phase 15 Beta verdict: PASS / PARTIAL / FAIL
- 明确说明未进入 Phase 15 Beta / Phase 15.5 / Phase 16+
```

## 12. Deferred Issue Register

This register prevents audit findings from being lost after the Phase 15 Beta remediation. Anything deferred here must be revisited by the named phase or explicitly closed as not-do.

| Audit finding / capability | Phase 15 Beta handling | Later owner | Required follow-up |
| --- | --- | --- | --- |
| Full semantic compact / summarization | Add context budget and visible overflow handling only. | Phase 15.5 or 16 | Implement mature compact only after the default coding loop is stable. |
| Automatic learning / long-term memory loop | Do not build. Keep memory injection explicit, bounded, and relevant. | Phase 16 | Design opt-in, reversible learning with stats, user control, and a Cost Guard: default no foreground learning call, no full memory injection, no cache-breaking unstable hashes, and disable/skip learning when it cannot reduce repeated reads, repeated explanations, errors, or later token use. |
| Long-session automatic summarize | Do not build before Beta beyond visible overflow handling. | Phase 15.5 or 16 | Add automatic summarization only after context budget and default loop are stable. |
| Hierarchical history compaction | Do not build before Beta. | Phase 16 | Design layered history summaries with clear source/evidence boundaries. |
| Multi-stage summary merge | Do not build before Beta. | Phase 16 | Define merge rules, conflict handling, and stale-summary invalidation. |
| Memory candidate extraction | Do not build as automatic learning before Beta. | Phase 16 | Extract only from verified evidence/Todo/handoff with user control; ordinary chat, temporary side notes, failed intermediate attempts, and unverified guesses must not become long-term memory candidates by default. |
| Compact quality evaluation | Do not build before Beta. | Phase 16 | Add validation that summaries preserve task state, decisions, open risks, and evidence refs. |
| Memory evidence validation | Do not build as automatic learning before Beta. | Phase 16 | A memory candidate must cite verified evidence/Todo/handoff/user confirmation before acceptance. |
| Summary faithfulness check | Do not build before Beta. | Phase 16 | Validate compact/handoff/job summaries against source events and flag dropped decisions, risks, or evidence refs. |
| Long-term memory drift detection | Do not build before Beta. | Phase 16 | Detect stale or contradicted memories and require user-visible review before reuse. |
| Full hook ecosystem | Hide/disable enforcement claims unless minimal PreToolUse/PostToolUse works. | Phase 15.5 | Build complete hook execution, timeout, trust, and failure isolation. |
| Workflow state machine | Do not use as Beta readiness proof. | Phase 15.5 | Implement real workflow lifecycle only after CLI main loop passes Beta gate. |
| Plugin contribution registry | Do not expose immature contributions as runtime-ready. | Phase 15.5 | Add contribution registration, trust boundary, and discovery-before-execute guard. |
| Skills full runtime | Beta requires either real bounded content loading or clear non-runtime marking. | Phase 15.5 | Complete load-on-demand, prompt injection, trust labels, and failure isolation. |
| MCP full integration | Beta requires real minimal tools/list and safe tools/call or visible disablement. | Phase 15.5 | Expand to broader MCP tool matrix, diagnostics, and runtime guard. |
| Agent team coordination / inter-agent communication | Fix fake background/dead states or hide; no team coordination before Beta. | Phase 15.5+ | Implement real agent lifecycle, cancellation, logs, and structured handoff. |
| Long-running background jobs | Only minimal honest background behavior may remain visible. | Phase 17 | Add durable job graph, progress, budget, pause/resume, and reports. |
| Remote channels | Do not build or enable. | Phase 17 | Revisit only after local CLI maturity; require identity, nonce, expiry, idempotent approvals, and audit log. |
| Desktop shell | Do not build or use to hide terminal gaps. | Phase 18 | Validate reuse of mature core/API/IPC after CLI Beta passes. |
| Vision/image routing | Not part of default text coding loop. | Phase 15.5+ | Add only if product priority is explicit and provider/tool boundaries are mature. |
| Full expand/collapse TUI UI | Details command/path is enough for Beta. | Phase 15.5 | Add richer grouping and visual hierarchy after real smoke passes. |
| Deep provider compat matrix UI | Profile contract and doctor are required before Beta; UI can wait. | Phase 15.5 | Add provider registry/compat matrix UI after profile contracts are stable. |
| Provider quota/balance reconciliation | Do not block default coding loop unless status lies. | Phase 15.5 | Add official/custom usage source boundaries and reconciliation diagnostics. |
| Freshness Gate / web_source runtime | Do not build in Phase 15 Beta remediation unless needed for a verified task. | Phase 15.5 | Implement official-source-first web evidence, failure downgrade, and source records. |
| Web claim freshness validation | Do not build in Phase 15 Beta remediation unless needed for a verified task. | Phase 15.5 | Claims about latest/current external facts require fresh `web_source` evidence or an explicit disclaimer/block. |
| Cost/cache/usage claim validation | Do not block default coding loop unless status lies. | Phase 15.5 | Usage, cache hit, quota, and cost claims must state source, formula, scope, and unknowns. |
| Multi-agent claim consistency | Do not build before single-session Beta readiness. | Phase 15.5+ | Agent conclusions must carry evidence refs and conflict markers; adopted conclusions need verification status. |
| Job/report evidence integrity | Do not build before local CLI maturity. | Phase 17 | Long-running job reports must include task graph, adopted outputs, rejected outputs, evidence refs, and validation status. |
| Remote approval evidence integrity | Do not build or enable. | Phase 17 | Remote approvals must be idempotent and auditable with redacted command/risk/decision records, not full context. |
| Phase delta drift detection | Do not run future phases before this baseline closes. | Phase 15.5+ | Each future phase must check whether it regresses Phase 15 CCB main-loop maturity or reintroduces TYPE-SHELL claims. |
| Open-source release hardening | Do not block main loop fixes except config/Windows/build basics named in this baseline. | Phase 15.5 | Complete packaging, audit, debug bundle, install, upgrade/rollback, and docs sync. |
| Full concurrent tool scheduler | Sequential loop is acceptable if continuation is correct. | Phase 15.5 | Add safe concurrency, progress, cancellation, and sibling cancellation later. |
| IDE diff / rich permission modal / allow-always rules editor | Beta needs usable pending approval, not the full UI. | Phase 15.5 | Add richer diff approval and persistent permission rules after default approval loop works. |

Rules for future phases:

1. Phase 15.5/16/17/18 may only consume items from this register after Phase 15 Beta entry criteria pass.
2. If a future phase discovers an item here is actually required for the default coding loop, it must be treated as a Phase 15 remediation miss, not normal polish.
3. No item in this register may be described as completed merely because a type, document, status page, or diagnostic command exists.
4. Each later phase delivery document must copy the relevant rows from this register into its own scope section and mark them DONE / DEFERRED / NOT-DO.

## 13. Audit Traceability Matrix

This matrix maps smaller audit findings into this baseline so they do not disappear behind broad categories.

Legend:

- `PRE-BETA`: must be fixed or honestly hidden/disabled before Phase 15 Beta.
- `SAME-CLOSURE`: should be fixed in the same remediation if the touched code path is already open.
- `DEFER`: tracked by the Deferred Issue Register.
- `NOT-DO`: do not build in the current roadmap unless explicitly re-approved.
- `KEEP/PASS`: confirmed strength; preserve and regression-test where relevant.

| Audit item | Disposition | Baseline owner |
| --- | --- | --- |
| Ordinary prompt must reach model loop | PRE-BETA | Sections 4A, 4F, 9 |
| `tool_use -> permission -> tool_result -> continuation -> final answer` | PRE-BETA | Sections 4A, 4D, 4E, 9 |
| Tool result mistaken for final answer | PRE-BETA | Sections 4A, 4H, 9 |
| Real report-generation path still PARTIAL | PRE-BETA | Sections 4J, 9 |
| Runtime phase/smoke artifact leakage into prompt/help/UI | PRE-BETA | Sections 7, 8, 9 |
| NCB keyword scoring / capability boost | PRE-BETA | Sections 4F, 7, 8 |
| NCB ordinary task execution | PRE-BETA | Sections 4F, 9 |
| Control-plane status/help/doctor local handling | PRE-BETA | Sections 4F, 4H, 9 |
| Verdict/Solution/Evidence gates in ordinary path | PRE-BETA | Sections 4F, 7, 8 |
| Evidence/transcript/handoff main-screen noise | PRE-BETA | Sections 4B, 4H |
| Evidence as background anti-hallucination strength | KEEP/PASS | Sections 2, 4B |
| Session history injection missing or weak | PRE-BETA | Sections 4B, 9 |
| Zero/weak context window management | PRE-BETA | Sections 4B, 9 |
| Token counting missing | PRE-BETA | Sections 4B, 9 |
| Full semantic compact | DEFER | Section 12 |
| Long-session automatic summarize | DEFER | Section 12 |
| Hierarchical history compaction | DEFER | Section 12 |
| Multi-stage summary merge | DEFER | Section 12 |
| Memory candidate extraction | DEFER / NOT-DO before Phase 16 | Section 12 |
| Compact quality evaluation | DEFER | Section 12 |
| Memory evidence validation | DEFER / NOT-DO before Phase 16 | Section 12 |
| Summary faithfulness check | DEFER | Section 12 |
| Long-term memory drift detection | DEFER / NOT-DO before Phase 16 | Section 12 |
| MCP/deferred tool discovery-before-execute and required-args guard (`get_code_snippet` / `qualified_name`) | PRE-BETA for visible runtime blind calls; Phase 15.5 for broader tool matrix | Sections 7, 8, 12 |
| Memory injection unbounded or irrelevant | PRE-BETA | Sections 4B, 9 |
| Automatic learning loop | DEFER / NOT-DO before Phase 16 | Section 12 |
| Provider profile mixing: chat vs responses | PRE-BETA | Sections 4C, 9 |
| DeepSeek chat profile contract | PRE-BETA | Sections 4C, 9 |
| OpenAI-compatible chat profile contract | PRE-BETA | Sections 4C, 9 |
| OpenAI responses profile contract | PRE-BETA | Sections 4C, 9 |
| Provider hidden fallback | PRE-BETA | Sections 4C, 7, 8 |
| Provider 429/5xx retry | PRE-BETA | Sections 4C, 9 |
| `Retry-After` support | PRE-BETA | Sections 4C, 9 |
| Stream heartbeat/timeout | PRE-BETA | Sections 4C, 9 |
| Pending/partial tool calls dropped at stream end | PRE-BETA | Sections 4C, 9 |
| Provider basic text smoke | PRE-BETA | Sections 4J, 9 |
| Provider unsupported-tools/profile mismatch smoke | PRE-BETA | Sections 4J, 9 |
| Provider quota/balance reconciliation | DEFER | Section 12 |
| Deep provider compat matrix UI | DEFER | Section 12 |
| Tool `input as never` / unchecked input | PRE-BETA | Sections 4D, 8, 9 |
| Zod or equivalent runtime validation | PRE-BETA | Sections 4D, 9 |
| Tool `isEnabled` / disabled states | PRE-BETA | Section 4D |
| Tool read-only/destructive metadata | PRE-BETA | Section 4D |
| Tool interrupt behavior | PRE-BETA | Section 4D |
| Tool `maxResultSizeChars` / large output storage | PRE-BETA | Sections 4D, 4H |
| Tool progress handlers / minimal status | PRE-BETA or SAME-CLOSURE | Sections 4D, 5 |
| Tool error classification beyond generic `formatError()` | PRE-BETA or SAME-CLOSURE | Sections 4D, 4H, 9 |
| Tool hook integration in execution path | PRE-BETA minimal or disable hook claims; full DEFER | Sections 4G, 12 |
| Tool parallel execution absence | DEFER unless sequential loop blocks correctness | Section 12 |
| Full concurrent tool scheduler | DEFER | Section 12 |
| Bash stdout/stderr progress | KEEP/PASS with regression risk | Sections 4D, 9 |
| Bash classifier deeper hardening | SAME-CLOSURE if touched; otherwise DEFER to release hardening | Sections 4I, 12 |
| Bash/package-runner/interpreter dangerous detection depth | SAME-CLOSURE if touching Bash; otherwise Phase 15.5 security hardening | Sections 4I, 12 |
| Write/Edit/MultiEdit/Bash pending approval | PRE-BETA | Sections 4E, 9 |
| Permission input inspection/edit before approval | DEFER rich UI; PRE-BETA must show enough action/scope/diff summary | Sections 4E, 12 |
| Permission hook influence on decisions | PRE-BETA minimal only if hooks visible; otherwise DEFER | Sections 4G, 12 |
| Auto mode classifier unavailable/stub | PRE-BETA must not claim auto maturity; DEFER full classifier | Sections 4E, 12 |
| Permission Tab edit / feedback / keyboard bindings | DEFER | Section 12 |
| Confirmation words without pending state | PRE-BETA | Sections 4E, 9 |
| Permission denial/cancel as model-visible tool_result | PRE-BETA | Sections 4E, 9 |
| Permission prompt action/scope/risk/reason/rollback/choices | PRE-BETA | Section 4E |
| IDE diff / rich modal / allow-always rules editor | DEFER | Section 12 |
| `packages/tui/src/index.ts` structural risk | SAME-CLOSURE | Section 5 |
| Model/runtime loop extraction | SAME-CLOSURE | Section 5 |
| Permission continuation extraction | SAME-CLOSURE | Section 5 |
| Runtime resolution extraction | SAME-CLOSURE | Section 5 |
| Details/output store extraction | SAME-CLOSURE | Section 5 |
| NCB/control-plane boundary extraction | SAME-CLOSURE | Section 5 |
| Session/context assembly extraction | SAME-CLOSURE | Section 5 |
| System prompt three-layer design not implemented | PRE-BETA minimal context package; full layering can defer | Sections 4B, 5, 12 |
| Project rules / MCP tool directory / skills summary not injected | PRE-BETA only bounded relevant summaries; full dynamic loading DEFER | Sections 4B, 4G, 12 |
| Rollback only file snapshot, no Git/context coordination | DEFER unless touched by permission/write flow | Section 12 |
| Main-screen assistant/tool/permission/status separation | PRE-BETA | Sections 4H, 9 |
| `/details` or equivalent full-output access | PRE-BETA | Sections 4H, 9 |
| ANSI color | SAME-CLOSURE, not readiness substitute | Section 4H |
| Status context% / rate limit / cost density | SAME-CLOSURE if easy; otherwise Phase 15.5 | Sections 4H, 12 |
| RuntimeStatus provider field declared but not formatted | SAME-CLOSURE | Section 4H |
| Streaming progress / thinking indicator blank screen | SAME-CLOSURE if touching model loop; otherwise Phase 15.5 polish | Sections 4H, 12 |
| i18n key coverage vs inline bilingual conditionals | DEFER to Phase 15.5 polish unless output regression occurs | Section 12 |
| Runtime source of truth for status/doctor/model route | PRE-BETA | Sections 4H, 9 |
| Error message: what happened / likely cause / next action | PRE-BETA | Sections 4H, 9 |
| Provider response body not read for diagnostics | PRE-BETA | Sections 4C, 4H, 9 |
| Non-streaming endpoint fallback / `supportsStreaming` handling | PRE-BETA if provider profile can expose non-streaming; otherwise DEFER with explicit profile limitation | Sections 4C, 12 |
| Semantic tool-loop detection beyond round count | DEFER unless current loop can silently cycle within limit | Section 12 |
| Config schema validation | PRE-BETA | Sections 4I, 9 |
| Damaged settings recovery | PRE-BETA | Sections 4I, 9 |
| Config temp-then-rename atomic write | SAME-CLOSURE | Section 5 |
| Config array merge consistency | SAME-CLOSURE if touching config schema; otherwise Phase 15.5 config hardening | Sections 4I, 12 |
| Vision route empty provider/model placeholders | DEFER / mark non-runtime | Section 12 |
| Vision capability regex instead of provider capability | DEFER | Section 12 |
| Vision/image commands placeholder behavior | DEFER / hide from readiness | Section 12 |
| Session metadata redundant writes | SAME-CLOSURE | Section 5 |
| Session list pagination/read caps | SAME-CLOSURE | Section 5 |
| JSONL append buffering | SAME-CLOSURE if touching transcript I/O; otherwise Phase 15.5 | Sections 5, 12 |
| Log rotation / output caps | SAME-CLOSURE if obvious; otherwise Phase 15.5 | Sections 5, 12 |
| Evidence array trimming / bounded collections | PRE-BETA or SAME-CLOSURE | Sections 4I, 5 |
| Background task collection caps | PRE-BETA or SAME-CLOSURE | Sections 4I, 5 |
| Checkpoints/agents/other unbounded arrays | SAME-CLOSURE or Phase 15.5 resource hardening | Sections 5, 12 |
| Exit child-process cleanup | PRE-BETA | Sections 4I, 9 |
| Temp file cleanup | PRE-BETA | Sections 4I, 9 |
| Windows help/version smoke | PRE-BETA | Sections 4I, 9 |
| Windows TUI stdin smoke | PRE-BETA | Sections 4I, 9 |
| Windows paths with spaces/non-ASCII | PRE-BETA | Sections 4I, 9 |
| Windows UNC / cross-drive / drive-relative / reserved-device path matrix | SAME-CLOSURE if path guard touched; otherwise Phase 15.5 Windows hardening | Sections 4I, 12 |
| Windows long path prefix handling | DEFER unless current smoke fails | Section 12 |
| Windows process tree termination | PRE-BETA for spawned commands used in Beta | Sections 4I, 9 |
| UTF-8 / GB18030 / mojibake handling | PRE-BETA | Sections 4I, 9 |
| Shell detection on Windows | SAME-CLOSURE | Section 5 |
| `windowsHide` fix | SAME-CLOSURE | Section 5 |
| SIGBREAK handling | SAME-CLOSURE | Section 5 |
| Build/package `files: ["dist"]` boundary | SAME-CLOSURE or Phase 15.5 release hardening | Sections 5, 12 |
| Windows dual bin casing strategy (`linghun` / `Linghun`) | SAME-CLOSURE or Phase 15.5 release hardening | Sections 5, 12 |
| `prepack` / `pack:check` / `npm pack --dry-run` | DEFER to Phase 15.5 release hardening | Section 12 |
| CLI exports / bundle strategy | DEFER to Phase 15.5 release hardening | Section 12 |
| Vitest aliases | SAME-CLOSURE if tests need it; otherwise Phase 15.5 | Section 5 |
| Watch/dev/ci scripts missing | DEFER unless needed for remediation verification | Section 12 |
| Two build methods (`tsup` vs `tsup+tsc`) | DEFER unless build fails | Section 12 |
| `skipLibCheck` risk | KEEP/ACCEPT for now; revisit in release hardening | Section 12 |
| Dependency audit/version policy | DEFER to Phase 15.5 release hardening | Section 12 |
| Subpackage devDependency/tooling declarations | DEFER to Phase 15.5 release hardening | Section 12 |
| Startup I/O parallelization | SAME-CLOSURE if startup path touched; otherwise Phase 15.5 | Section 5 |
| Startup memory/performance caps | SAME-CLOSURE or Phase 15.5 | Sections 5, 12 |
| Memory JSON startup reads unbounded | SAME-CLOSURE or Phase 15.5 | Sections 5, 12 |
| Transcript full-load resume (`readFile` + split all events) | SAME-CLOSURE or Phase 15.5 | Sections 5, 12 |
| External command output buffers collected fully | PRE-BETA if used in smoke; otherwise Phase 15.5 resource hardening | Sections 4I, 12 |
| Cold-start / large-data measurement baseline | DEFER to Phase 15.5 unless current Beta smoke is slow/flaky | Section 12 |
| `/verify` / verification runner strength | KEEP/PASS | Section 4J |
| CI/CD configuration missing | DEFER to Phase 15.5 release hardening | Section 12 |
| Real provider smoke not integrated into normal test command | PRE-BETA as explicit smoke; CI integration DEFER | Sections 4J, 12 |
| Huge monolithic TUI test file | DEFER unless blocking remediation | Section 12 |
| Fragile `toContain` output assertions | SAME-CLOSURE for touched output; broader cleanup DEFER | Sections 4J, 12 |
| Missing concurrency/stress/boundary/Unicode destructive tests | SAME-CLOSURE for changed paths; full matrix DEFER | Sections 4J, 12 |
| Thin core package tests | DEFER unless core is changed | Section 12 |
| Mock/focused/string PASS overclaim | PRE-BETA documentation/verification rule | Sections 4J, 8, 10 |
| Historical closure/PASS overclaim | PRE-BETA documentation rule | Sections 10, 8 |
| MCP SDK / real tools/list/call | PRE-BETA minimal or disable; full DEFER | Sections 4G, 12 |
| Skills content loading / bounded injection | PRE-BETA minimal or mark non-runtime; full DEFER | Sections 4G, 12 |
| Hooks PreToolUse/PostToolUse enforcement | PRE-BETA minimal or disable claims; full DEFER | Sections 4G, 12 |
| Workflows state machine | DEFER | Section 12 |
| Plugins contribution registry | DEFER | Section 12 |
| Agent fake background | PRE-BETA fix or hide | Sections 4G, 9 |
| Agent failed/dead states | PRE-BETA fix or hide | Sections 4G, 9 |
| Agent explorer/planner stubs | PRE-BETA hide/mark non-runtime or DEFER | Sections 4G, 12 |
| Agent cancel non-preemptive | DEFER unless visible Beta path uses it | Section 12 |
| Worker agent single `write <path> <content>` mode | DEFER / not readiness proof | Section 12 |
| Agent heartbeat/stale fields unused | DEFER / not readiness proof | Section 12 |
| Background task paused/compact/job/mcp typed states unused | DEFER / not readiness proof | Section 12 |
| Agent team coordination | DEFER | Section 12 |
| Long-running background jobs | DEFER | Section 12 |
| Remote channels | DEFER / NOT-DO before Phase 17 | Section 12 |
| Desktop app shell | DEFER / NOT-DO before Phase 18 | Section 12 |
| Vision/image routing | DEFER | Section 12 |
| Freshness Gate / `web_source` runtime | DEFER | Section 12 |
| Web claim freshness validation | DEFER | Section 12 |
| Cost/cache/usage claim validation | DEFER | Section 12 |
| Multi-agent claim consistency | DEFER | Section 12 |
| Job/report evidence integrity | DEFER | Section 12 |
| Remote approval evidence integrity | DEFER / NOT-DO before Phase 17 | Section 12 |
| Phase delta drift detection | DEFER until future phase starts; then mandatory | Section 12 |
| Cache reasoning effort hash hardcoded/default | SAME-CLOSURE if cache touched; otherwise Phase 15.5 cache hardening | Sections 5, 12 |
| Cache TTL pill/countdown UI | DEFER to Phase 15.5 polish | Section 12 |
| Index Safety Repair keyword classifier | KEEP for safety but do not expand as maturity strategy; semantic repair DEFER | Sections 4F, 12 |
| Memory decay/priority scoring | DEFER to Phase 16 | Section 12 |
| Memory content not injected except metadata | PRE-BETA bounded relevant injection | Sections 4B, 9 |
| Open-source release readiness | DEFER except Beta-critical config/Windows/build basics | Section 12 |
| Chinese UX / natural output | KEEP/PASS with regression risk | Sections 2, 9 |
| Windows/localization advantage | KEEP/PASS with Beta smoke | Sections 2, 4I |
| DeepSeek/openai-compatible ecosystem advantage | KEEP/PASS only after profile contract smoke | Sections 4C, 9 |
| No telemetry / local-first posture | KEEP/PASS | Section 2 |

Rule: if an implementation session finds an audit item not present in this matrix or Section 12, it must add the missing row before closing remediation. No audit finding may be left only in the original reports or chat history.
