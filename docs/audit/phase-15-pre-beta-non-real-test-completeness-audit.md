# Phase 15 Pre-Beta Non-Real-Test Completeness Audit + Phase 16-18 Forward Reference Register

> **重要声明（2026-05-20）**：当前另一个开发窗口仍在修改代码，尤其可能涉及 Beta verdict guard、MCP deferred tool guard、runtime artifacts 清理等。本报告只记录**当前可见基线 + gap + 待最终复核项**，不是最终 Beta readiness PASS，不建议进入 Phase 15 Beta，也不替代开发窗口完成后的 reconciliation。
>
> 本报告为只读审计；除写入本审计文件外，不修改代码或其他文档。报告已按脱敏口径书写：不记录 API key/token、Authorization header、cookie、完整 prompt、完整 transcript、私有 baseUrl 参数、用户名或本机绝对敏感路径中的凭据。

## 0. Scope / Method

- Audit date: 2026-05-20
- Repo baseline: current visible working tree；`git status --short` 显示另有 8 个开发中修改：`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`apps/cli/src/cli.ts`、`apps/cli/src/main.test.ts`、`docs/audit/reference-map.md`、`packages/tui/src/index.test.ts`、`packages/tui/src/index.ts`。
- codebase-memory index: `mcp__codebase-memory-mcp__index_status(project=F-Linghun)` => `ready`, nodes=1280, edges=2318。
- detect changes: `mcp__codebase-memory-mcp__detect_changes(project=F-Linghun)` reported changed files matching the 8-file working tree above.
- Existing requested report path did not exist before this write: `docs/audit/phase-15-pre-beta-non-real-test-completeness-audit.md`.
- 本轮未运行产品测试、未执行 live provider smoke、未调用真实 provider；只读审计以本地文档/源码/既有报告和公开资料核验为依据。

## 1. Required Linghun Evidence Read

- `docs/audit/reference-map.md:1-49`：参考源总表、Phase 15/16/17/18 必查来源和禁止事项。
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:81-104`：阶段报告 evidence refs、runtime facts、next action、不得自动推进下一阶段。
- `LINGHUN_IMPLEMENTATION_SPEC.md:99-134`：统一事件协议、TUI 只消费事件、桌面端未来复用事件。
- `LINGHUN_IMPLEMENTATION_SPEC.md:136-212`：primary/details/debug 输出层、长输出路径、敏感信息不进入主屏/文档/默认日志、usage/cache/quota 来源标注。
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md:47-75`：CCB 必须继承的工具、权限、Plan、Agent、MCP、缓存、状态栏、任务/取消等能力结构。
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md:226-247`：Natural Command Bridge、Start Gate、权限/提权边界、bypass/auto/Plan 安全限制。
- `docs/delivery/README.md:22-28`：Phase 15 readiness 仍为 PARTIAL；Phase 16-18 pending 且只做 delta parity。
- `docs/audit/phase-15-pre-beta-verdict-evidence-gate.md:93-99`：Phase 15 Beta readiness = PARTIAL；不得把局部 PASS 升级为 Beta PASS。
- `docs/audit/phase-15-gate-f-dual-provider-live-report.md:7-55,99-104`：Gate F dual provider live report-generation smoke PASS，但报告自身声明不是充分条件，仍不得自动进入 Beta。
- `docs/delivery/phase-15-natural-command-bridge.md:24-65`：Gate I OpenAI-compatible provider portability baseline PASS，仍需用户确认是否进入 Beta。
- `packages/providers/src/index.ts:332-349`：OpenAI-compatible/DeepSeek request headers currently show `content-type` and `authorization` only.
- `packages/tui/src/index.ts:2863-3089,3158-3176`：`/fork`、`/agents`、agent start/end transcript、同步降级、cancel path。
- `packages/tui/src/index.ts:3560-3640,3871-3894,3896-3939`：manual memory candidate/review/accept/delete；candidate-first long-term memory write.
- `packages/tui/src/index.ts:1645-1718,1745-1813,1846-1872`：skills/plugins metadata-first、trust notice、enable/disable、plugins doctor、第三方未信任边界。
- `packages/tui/src/index.ts:4712-4778` and `packages/tui/src/index.test.ts:517-534`：codebase-memory deferred tool guard rejects unknown tool and missing required args.
- `packages/tui/src/index.ts:5018-5140`：cache/usage/stats 输出 source/estimated/missing/zero_reported 边界。
- `packages/tui/src/index.ts:7874-8063`：help/Catalog command discovery surface.

## 2. Public / Local Reference Sources Checked

联网核验日期均为 2026-05-20；仅参考公开行为、交互边界、架构取舍、验收标准和失败降级思路，不复制第三方源码或大段文本。

- MCP official spec: `https://modelcontextprotocol.io/specification/latest` — JSON-RPC/stateful connection、capability negotiation、tools/resources/prompts、progress/cancellation/error/logging；工具安全要求 user consent/control。
- OpenRouter app attribution: `https://openrouter.ai/docs/app-attribution` — app identity uses `HTTP-Referer`; `X-OpenRouter-Title` / legacy `X-Title` for display; identity header must not leak private local path or prompt.
- LiteLLM router/fallback docs: `https://docs.litellm.ai/docs/routing`, `https://docs.litellm.ai/docs/tutorials/model_fallbacks` — provider/deployment abstraction, routing strategies, retry/fallback, context-window fallback, usage/cost callbacks.
- Vercel AI SDK provider/model docs: `https://ai-sdk.dev/docs/foundations/providers-and-models` — standardized provider/model abstraction, model capability differences, custom/self-hosted/OpenAI-compatible providers.
- OpenCode agents/providers/MCP/plugins docs: `https://opencode.ai/docs/agents/`, `https://opencode.ai/docs/providers/`, `https://opencode.ai/docs/mcp-servers/`, `https://opencode.ai/docs/plugins/` — build/plan/general/explore/scout agents, provider openness, MCP tools per server, plugin trust/supply-chain boundary.
- Warp docs: `https://docs.warp.dev/terminal/blocks/`, `https://docs.warp.dev/terminal/command-palette/` — command/output blocks, searchable command palette, namespace prefixes.
- Tauri security docs: `https://v2.tauri.app/security/` — WebView/core IPC boundary, command capabilities, least privilege.
- Local CCB / Claude Code Best: `F:\ccb-source` — custom agents, project memory, auto-dream, skills, MCP config, usage/cost/status behavior as behavior reference only.
- Local OpenCode: `F:\freecodex\opencode-source` — agents/providers/MCP/plugin docs and config behavior as behavior reference only.
- Lark / DingTalk / WeCom check: Lark/Feishu Open Platform and Lark CLI were identified by reference collection; DingTalk broad docs page did not expose enough bot/approval CLI detail in this run; WeCom docs host fetch failed. Treat IM adapter evidence as forward reference only, not Phase 15 blocking.

---

## 3. Phase 15 Pre-Beta Non-Real-Test Completeness Audit Items

### P15-A1

- ID: P15-A1
- Area: Agent / multi-agent lifecycle
- Reference: CCB custom agents (`F:\ccb-source` behavior reference), OpenCode agents docs (`https://opencode.ai/docs/agents/`, accessed 2026-05-20), oh-my-openagent public team lifecycle reference.
- Reference behavior: Mature agents have explicit type/mode, model, permissions, tool access, state table, transcript/log path, budget/cost, cancellation, result adoption/rejection, verifier evidence, and failure downgrade without fake running state.
- Linghun current evidence: `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md:47-75`; `packages/tui/src/index.ts:2863-3089` implements `/agents` and `/fork`; `packages/tui/src/index.ts:3158-3176` implements cancel; `packages/tui/src/index.test.ts:725-775` covers fork/show/details/cancel-ish state; `docs/delivery/README.md:22-24` keeps Phase 15 Beta pending.
- Gap: Current agent path is a minimal synchronous runtime with visible downgrade (`--background` falls back to sync) and transcript events, not mature concurrent multi-agent lifecycle. No explicit result adoption/rejection workflow, conflict handling, durable budget stop, or independent verifier evidence as a general agent contract. Team coordination is still forward work.
- Status: PARTIAL
- Decision: Keep as current visible baseline only. Do not claim CCB/OpenCode/oh-my-openagent-level multi-agent maturity for Phase 15 Beta. Before final reconciliation, confirm no fake background/running state remains in runtime artifacts.
- Required evidence: Fresh `/agents`, `/fork explorer|planner|verifier`, `/agents cancel`, `/details background`, transcript `agent_start/agent_end`, role route/budget fields, and verifier evidence for any claimed agent result.
- Needs final reconciliation after development completes: yes

### P15-A2

- ID: P15-A2
- Area: Learning / Memory / Skill evolution
- Reference: Hermes MEMORY/USER/Skills direction, CCB project-memory/auto-dream/skillLearning behavior reference, CCB Dev Boost summary-first/cache freshness boundary.
- Reference behavior: Learning is opt-in/candidate-first; repeated evidence and confidence threshold before candidate; accept/reject/disable/retire/stale/conflict; rollback; cost guard; summary-first; no every-turn learning; no automatic prompt pollution.
- Linghun current evidence: `packages/tui/src/index.ts:3560-3640` supports manual `/memory candidate|review|accept|delete`; `packages/tui/src/index.ts:3871-3894` writes accepted candidate; `packages/tui/src/index.ts:1645-1667` skills metadata summary only; `packages/tui/src/natural-command-bridge.ts:53-69` RuntimeStatus only includes memory counts/autoAccept, not full memory; `docs/delivery/README.md:26` puts Phase 16 learning loop pending.
- Gap: Candidate generation thresholds, repeated evidence, confidence scoring, reject/disable/retire/stale/conflict lifecycle, rollback, cost guard and automatic learning controls are mostly doc/forward boundaries, not Phase 15 runtime. Current manual memory candidate is useful but not equivalent to controlled learning loop.
- Status: PARTIAL
- Decision: Treat existing memory as manual/candidate-first baseline. Register full controlled learning for Phase 16; do not market or report “越用越聪明” as implemented.
- Required evidence: Runtime command/test showing no automatic long-term write, no full memory prompt injection, cache freshness after memory accept/delete, and Phase 16-specific tests for lifecycle states before any DONE claim.
- Needs final reconciliation after development completes: yes

### P15-A3

- ID: P15-A3
- Area: MCP / Skills / Plugins Connect Lite
- Reference: MCP official spec (`https://modelcontextprotocol.io/specification/latest`, accessed 2026-05-20), OpenCode MCP/plugins docs (`https://opencode.ai/docs/mcp-servers/`, `https://opencode.ai/docs/plugins/`), CCB MCP/skills/plugins behavior reference.
- Reference behavior: Discover/list tools before call, schema/required args validation, explicit consent for tools, enable/disable/remove/update, trust notice, source/commit/permissions record, OAuth/auth failure downgrade, timeout/cancellation, doctor, and source isolation.
- Linghun current evidence: `docs/audit/reference-map.md:27,44`; `packages/tui/src/index.ts:4712-4778` validates codebase-memory tool names and required args; `packages/tui/src/index.test.ts:517-534` tests guard rejection; `packages/tui/src/index.ts:1645-1718` shows skill/plugin metadata/trust/doctor boundaries; `packages/tui/src/index.ts:1745-1755` trust notice; `packages/tui/src/index.ts:1758-1813,1846-1872` enable/disable flows.
- Gap: Connect Lite remains local/manifest-focused. No complete Git/community install/update/remove lifecycle, no source commit pin evidence, no full MCP server OAuth/token lifecycle in this audit, no generic discovery-before-execute proof for every deferred server beyond codebase-memory guard. OpenCode plugin auto-load behavior is intentionally not copied, but Linghun needs final runtime surface reconciliation.
- Status: PARTIAL
- Decision: Keep codebase-memory deferred guard as a current safety baseline. Do not claim full MCP/Skills/Plugins ecosystem maturity until doctor/install/update/source/permission evidence exists.
- Required evidence: `/mcp status|tools|doctor`, failed unknown deferred tool, missing required arg rejection, trusted/untrusted skill/plugin enable/disable, plugin doctor with permission/source, and no remote install/update without explicit trust.
- Needs final reconciliation after development completes: yes

### P15-A4

- ID: P15-A4
- Area: Provider / gateway request identity
- Reference: OpenRouter app attribution (`https://openrouter.ai/docs/app-attribution`, accessed 2026-05-20), LiteLLM routing/fallback docs, Vercel AI SDK provider abstraction docs, OpenCode provider docs.
- Reference behavior: Provider requests should carry safe app identity when a gateway supports it, e.g. `HTTP-Referer` + `X-OpenRouter-Title` / `X-Title` for OpenRouter-like gateways, or SDK/app name/user-agent equivalents; request metadata must not leak API key, local private paths, usernames, private baseUrl query params, or full prompt.
- Linghun current evidence: `packages/providers/src/index.ts:332-349` sends request with `content-type` and `authorization`; no `User-Agent`, `HTTP-Referer`, `X-Title`, `X-OpenRouter-Title`, SDK app/name, or safe identity metadata found in current provider request path. Gate F evidence exists in `docs/audit/phase-15-gate-f-dual-provider-live-report.md:33-55`, but it does not prove request identity attribution.
- Gap: The audit cannot confirm whether gateway dashboard “note”/app display comes from Linghun code, SDK default, or gateway default. Current code evidence suggests Linghun itself is not setting a product identity header. There is also no focused test asserting request headers are safe and redacted.
- Status: BLOCKING
- Decision: Before any final Beta readiness reconciliation, either add/verify safe identity headers where applicable or explicitly document “not set by Linghun; gateway note is external/default”. Do not include private path/project/user/baseUrl query/prompt in identity fields.
- Required evidence: Captured sanitized request headers/body/metadata for DeepSeek, OpenAI-compatible strict/permissive, native/mock adapters; unit test proving safe identity or explicit absence; doctor/report statement explaining dashboard note source without secrets.
- Needs final reconciliation after development completes: yes

### P15-A5

- ID: P15-A5
- Area: TUI / help / doctor / hints / output polish 非实测项
- Reference: CCB TUI/help/doctor/status behavior reference, OpenCode TUI/output organization, Warp Blocks and Command Palette (`https://docs.warp.dev/terminal/blocks/`, `https://docs.warp.dev/terminal/command-palette/`, accessed 2026-05-20).
- Reference behavior: Primary output is summary-first; details/debug are explicit; command discovery is searchable and risk-aware; doctor gives actionable next steps; long output has fullOutput/log path; narrow terminal/status degrades cleanly; cache hints do not repeat noisily.
- Linghun current evidence: `LINGHUN_IMPLEMENTATION_SPEC.md:136-212`; `packages/tui/src/index.ts:7874-8063` command help/Catalog; `packages/tui/src/index.ts:5018-5140` cache/usage/stats summary; `docs/delivery/phase-15-natural-command-bridge.md:67-89` catalog/start-gate/risk metadata; `docs/audit/phase-15-pre-beta-ccb-grade-runtime-acceptance-closure.md:120-132` warns real TUI report-generation remained PARTIAL in that report.
- Gap: Help/Catalog and summary-first surfaces exist, but this non-real-test audit did not re-run narrow terminal snapshots, cache non-repetition, doctor actionability, or long-output path assertions. Gate F report-generation PASS is scoped; it does not prove full output polish maturity.
- Status: PARTIAL
- Decision: Keep baseline as “core output boundaries present, polish not fully revalidated.” Non-blocking rich block/panel polish can remain Phase 15.5, but Beta-required primary/details/debug and doctor safety must be reconciled after current development ends.
- Required evidence: `/help`, `/model doctor`, `/mcp doctor`, `/details`, long Read/Grep/Bash path evidence, narrow terminal snapshot, cache warning de-duplication, zh-CN/en-US equivalence for key paths.
- Needs final reconciliation after development completes: yes

### P15-A6

- ID: P15-A6
- Area: Provider / model / usage / cache / quota
- Reference: CCB Dev Boost usage/cache/stat behavior, CC Switch quota/usage query direction, LiteLLM router/fallback docs, OpenRouter/Vercel AI SDK provider abstraction docs.
- Reference behavior: Usage/cache/quota/cost fields must be source-labelled (`reported`, `zero_reported`, `estimated`, `missing`, `unknown`); fallback/error classes are actionable; role route doctor shows provider/model/capability; quota/balance must cite official/gateway source and never mix tokens/credits/requests/money as facts.
- Linghun current evidence: `packages/tui/src/index.ts:5018-5055` cache source and zero/missing notes; `packages/tui/src/index.ts:5083-5140` usage/stats estimated billing note; `packages/providers/src/index.test.ts:98-135,235-248,487-503` covers strict/permissive profile, DeepSeek reasoning exclusion, message/tool fallback; `docs/delivery/phase-15-natural-command-bridge.md:30-65` Gate I provider profile/doctor evidence.
- Gap: Provider profile and estimated usage boundaries are present, but quota/balance official-source reconciliation is not complete. Current status does not prove usage/cache fields are correct for every gateway, nor that CC Switch-like quota query exists.
- Status: PARTIAL
- Decision: Allow scoped provider/profile/cache baseline only. Do not claim real quota/balance or billing readiness unless sourced from provider/gateway/official account evidence.
- Required evidence: `/usage`, `/stats`, `/stats endpoints`, `/model route doctor`, reported vs estimated cache tests, quota/balance source labels, fallback/error classification for 400/401/403/429/5xx and unsupported tools.
- Needs final reconciliation after development completes: yes

### P15-A7

- ID: P15-A7
- Area: Freshness / Web evidence
- Reference: Freshness Gate requirement in Linghun docs; MCP/OpenCode/Warp/OpenRouter/LiteLLM/Vercel/Tauri official docs fetched 2026-05-20.
- Reference behavior: Current external facts require web verification, source URL/date, official-source-first preference, conservative handling on conflict/fetch failure, and `web_source` evidence or explicit “not verified/latest unknown” downgrade.
- Linghun current evidence: `docs/audit/reference-map.md:10,44`; `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md:330` says no fresh web evidence => do not claim latest/current; `packages/tui/src/index.ts:183-186` includes `web_source` evidence kind; `PHASE_15_BETA_CCB_MATURITY_REMEDIATION_BASELINE.md:329-330` registers Freshness Gate/web_source runtime for Phase 15.5.
- Gap: `web_source` type exists, but this audit did not find a complete runtime Freshness Gate workflow that authorizes web access, stores official-source evidence, downgrades failed freshness, and prevents current/latest claims without evidence. Some public references failed/redirected/404ed and were treated conservatively.
- Status: DEFERRED
- Decision: For Phase 15, record public sources in this audit only. Full Freshness Gate remains Phase 15.5 unless absence causes a false “latest/current” claim in Beta materials.
- Required evidence: Runtime command or workflow that captures URL/date/source type, redacts content, stores `web_source`, handles fetch failure, and blocks/latest-downgrades unsourced external claims.
- Needs final reconciliation after development completes: yes

### P15-A8

- ID: P15-A8
- Area: Hardcoded artifact sweep
- Reference: Linghun data portability and no-hardcoding rules; Phase 15 remediation baseline hardcoded artifact sweep requirement; CCB clean rewrite boundary.
- Reference behavior: Runtime must not hardcode provider/model/report path/old CLI name/gateway/project path `/workspace`/phase artifact/smoke marker/key. Tests/docs may mention scoped evidence, but ordinary runtime/help/prompt must not be polluted by audit/smoke artifacts or stale Beta verdicts.
- Linghun current evidence: `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:222-230` forbids hardbinding C drive/fixed user; `docs/delivery/README.md:22-24` says Phase 15 readiness PARTIAL; `docs/audit/phase-15-gate-f-dual-provider-live-report.md:99-104` warns Gate F is not Beta readiness; `packages/tui/src/index.ts:3750-3765` handoff text still contains runtime readiness/Beta blocked wording; `packages/tui/src/index.test.ts:510-514` rejects unsupported Beta PASS claim.
- Gap: Working tree is actively changing around runtime artifact cleanup. Current audit cannot certify that ordinary help/prompt/runtime no longer exposes Phase 15/Gate F/smoke/report-generation artifacts. Grep found expected docs/tests references; final sweep must distinguish docs/tests from runtime user-visible text.
- Status: BLOCKING
- Decision: Treat as blocking for final Beta reconciliation, not as request to fix here. Minimal boundary: runtime/help/prompt/status must be generic; docs/audit/tests can retain scoped evidence with caveats.
- Required evidence: Sanitized hardcoded sweep over runtime code and docs; no fixed provider/model/baseUrl/report path/project path/old CLI/smoke marker in ordinary runtime; docs/tests references are scoped and caveated; no API key/token patterns.
- Needs final reconciliation after development completes: yes

---

## 4. Phase 16-18 Forward Reference Register

These items are **forward references only**. They do not block Phase 15 Beta unless they already break Phase 15 baseline behavior, such as learning polluting prompts by default, job/agent bypassing permission, remote/hook silently executing, or core/UI coupling blocking TUI.

### FWD-16

- ID: FWD-16
- Area: Phase 16 controllable learning
- Reference: Hermes MEMORY/USER/Skills direction, CCB project-memory/auto-dream/skillLearning, CCB Dev Boost summary-first/cache freshness.
- Reference behavior: Candidate observation; repeated evidence; confidence threshold; candidate review; accept/reject/disable/retire/stale/conflict; rollback; cost guard; summary-first; cannot learn every turn; cannot auto-pollute prompt.
- Linghun current evidence: `docs/delivery/README.md:26` Phase 16 pending; `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md:847-854` says no every-turn learning / no stealth long-term write / relevant summaries only; `packages/tui/src/index.ts:3560-3640` manual memory candidate/review/accept/delete; `packages/tui/src/natural-command-bridge.ts:53-69` short RuntimeStatus.
- Gap: Mostly DOC-ONLY/DEFERRED beyond manual memory. Missing runtime thresholds, repeated evidence, reject/disable/retire/stale/conflict, rollback, cost guard tests, and learning-specific cache stability evidence.
- Status: DEFERRED
- Decision: Register for Phase 16 delta parity audit. Do not implement or claim in this Phase 15 audit.
- Required evidence: Phase 16 test matrix for all lifecycle states, prompt/cache non-pollution, cost guard, rollback, stale/conflict handling, and user approval gates.
- Needs final reconciliation after development completes: no

### FWD-17

- ID: FWD-17
- Area: Phase 17 long-running hosted jobs / autonomous sessions / remote approvals
- Reference: CCB daemon/background sessions/cron/proactive/Agent lifecycle behavior reference, oh-my-openagent team lifecycle/status table, Feishu/Lark/DingTalk/WeCom official bot/approval adapter boundaries.
- Reference behavior: Durable local job, handoff validation, budget, timeout, pause/resume/cancel, agent assignment, job report, remote approval dedupe/expiry/signature/device binding/redacted audit; remote adapters default disabled and fail closed.
- Linghun current evidence: `docs/delivery/README.md:27` Phase 17 pending and split 17A local durable jobs / 17B remote channels; `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md:244-246` forbids bypass/auto/Plan permission bypass by model/agent/plugin/hook/remote; `packages/tui/src/index.ts:2863-3089` only minimal agent/background visible path; `packages/tui/src/index.ts:1721-1742` hook doctor says hook cannot bypass permissions and failures are isolated.
- Gap: Durable jobs, remote approval signatures, adapter login diagnostics, dedupe/expiry/device binding, timeout/budget enforcement and report integrity are not Phase 15 runtime. IM official docs were only partially verified in this run; treat as future adapter research.
- Status: DEFERRED
- Decision: Register for Phase 17. Do not build full IM SDK, unbounded autonomy, or default multi-stage continuation. Only escalate to Phase 15 if current hooks/jobs/agents silently execute or bypass permissions.
- Required evidence: 17A local durable job storage/recovery/cancel/budget/report tests; 17B disabled-by-default remote adapter doctor, signed approval, dedupe, expiry, redacted audit, failed login fallback.
- Needs final reconciliation after development completes: no

### FWD-18

- ID: FWD-18
- Area: Phase 18 desktop-ready reserve
- Reference: OpenCode app/desktop/core layering direction, OpenHands core/UI/SDK layering, Tauri security docs (`https://v2.tauri.app/security/`, accessed 2026-05-20), Ink TUI boundary, Warp modern terminal product feel.
- Reference behavior: Core/UI separation, IPC/API boundary, least-privilege capabilities, debug bundle redaction, config/log/key paths, desktop shell reuses terminal core semantics, desktop starts only after terminal TUI and real-project Beta are stable.
- Linghun current evidence: `LINGHUN_IMPLEMENTATION_SPEC.md:20-22` core/provider do not depend on UI; `LINGHUN_IMPLEMENTATION_SPEC.md:99-134` TUI and future desktop consume the same event protocol; `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md:22` says TUI first, desktop later; `docs/delivery/README.md:28` Phase 18 pending.
- Gap: Desktop is architectural reservation only. No IPC contract, debug bundle redaction, desktop shell, or desktop validation exists; this is intentional.
- Status: DOC-ONLY
- Decision: Keep Phase 18 non-blocking. Desktop must wait until terminal TUI maturity and real-project Beta stability; do not use desktop shell to hide terminal/TUI debt.
- Required evidence: Future Phase 18 only: core API/IPC contract, least-privilege capability map, redacted debug bundle, storage/key/log path audit, terminal semantics parity.
- Needs final reconciliation after development completes: no

---

## 5. Blocking / Gap Summary

| Status | Count |
| --- | ---: |
| DONE | 0 |
| DOC-ONLY | 1 |
| PARTIAL | 5 |
| BLOCKING | 2 |
| DEFERRED | 3 |
| NOT-DO | 0 |

### BLOCKING items

| ID | Minimal fix / evidence boundary | Verification boundary |
| --- | --- | --- |
| P15-A4 | Provider/gateway request identity must be proven safe or explicitly absent/source-attributed. | Sanitized captured request headers/body/metadata for DeepSeek/OpenAI-compatible/native/mock; no key/path/prompt leakage. |
| P15-A8 | Runtime hardcoded artifact sweep must prove ordinary runtime/help/prompt is not polluted by Phase/Gate/smoke/provider/path artifacts. | Grep/sweep report that separates runtime vs docs/tests; no fixed provider/model/baseUrl/report path/API key. |

### Items that must wait for development completion reconciliation

- P15-A1 Agent / multi-agent lifecycle
- P15-A2 Learning / Memory / Skill evolution
- P15-A3 MCP / Skills / Plugins Connect Lite
- P15-A4 Provider / gateway request identity
- P15-A5 TUI / help / doctor / hints / output polish
- P15-A6 Provider / model / usage / cache / quota
- P15-A7 Freshness / Web evidence
- P15-A8 Hardcoded artifact sweep

## 6. Verdict

**Verdict: PARTIAL / NOT FINAL BETA READINESS PASS**

- Current visible baseline contains several important Phase 15 safeguards and reports, including Gate F dual-provider live report-generation PASS and Gate I provider portability baseline PASS.
- Because current development is still in progress and two audit items are BLOCKING for final reconciliation, this report **must not** be cited as final Phase 15 Beta readiness PASS.
- Do not recommend entering Phase 15 Beta until the active development window produces its final report and a reconciliation pass verifies P15-A1 through P15-A8 against the final working tree.
