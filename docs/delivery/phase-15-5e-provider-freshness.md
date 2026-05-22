# Phase 15.5E：Provider & Freshness

## 阶段目标

本轮只完成 Pre-Open-Source Terminal Product Completion Gate 的 Phase 15.5E：Provider & Freshness。范围限定为既有 DeepSeek / OpenAI-compatible / OpenAI Responses provider 路径的 runtime contract 收口、doctor 诊断信息清晰化、provider failure 主屏人话化，以及 Freshness Lite / Web-source Evidence Lite 边界。

本轮不进入真实全量 smoke，不声明 Beta PASS、smoke-ready 或 open-source-ready，不进入 Phase 15.5F / Phase 16 / 17 / 18，不提交 commit，不新增第二套 provider、evidence、web_source、freshness、permission、tool、agent 或 job runtime，不复制 CCB / Claude Code / OpenCode / 第三方源码。

## Source-Level Reality Check 摘要

### Existing implementation

- `packages/providers/src/index.ts` 已有 `EndpointProfile`、`ProviderCompatibilityProfile`、`ProviderRuntimeProfile`，并已有 DeepSeek、OpenAI-compatible chat completions、OpenAI Responses 的请求构造路径。
- Provider 已有 chat tools schema、Responses native tools schema、assistant tool result、Responses `function_call_output`、`tool_choice`、reasoning、usage、retry、timeout、abort 和 HTTP error 基础处理。
- `packages/tui/src/index.ts` 已有 `/model doctor` / `/model route doctor`、provider/model/endpointProfile/reasoningSent system event、主屏 primary 与 evidence/transcript 详情分层、provider failure evidence 记录和脱敏。
- `EvidenceRecord.kind` 已包含 `web_source`，core transcript 也已有 `evidence_record`，因此本阶段可复用既有 evidence/runtime，不需要新增第二套 web evidence 系统。
- `createModelSystemPrompt()` 已有 evidence-first / avoid unverified claims 基础约束，是 Freshness Lite 最小落点。

### Gaps

- Runtime contract 的 profile、tool schema shape、tool result shape、retry/timeout/idle timeout 边界没有作为可测试/doctor 可复用的显式 contract 暴露。
- `/model doctor` 只显示 endpointProfile / compatibilityProfile / endpointPath / tools / reasoning，缺少 provider runtime profile 与 tool schema/result/retry/timeout 诊断。
- Provider failure primary 对 schema mismatch、tool schema/tool_choice/tool_result/profile mismatch 的人话化不够明确，容易落入 generic failure。
- Freshness Lite 需要对“最新 / 当前 / 实时 / 外部资料 / web”等请求建立明确 boundary；缺少 `web_source` evidence 时，不能把最新信息写成已验证。

### Minimal touch points

- `packages/providers/src/index.ts`：导出并扩展既有 `ProviderRuntimeContract` / `resolveProviderRuntimeContract()`，不新增 provider runtime。
- `packages/providers/src/index.test.ts`：覆盖 runtime contract 的 profile、tool schema/result、retry/timeout 边界。
- `packages/tui/src/request-lifecycle-presenter.ts`：扩展既有 provider failure classifier 和 primary message，不改变错误对象结构。
- `packages/tui/src/index.ts`：复用 provider contract 扩展 doctor 输出；在既有 system prompt 增加 Freshness Lite boundary；新增 request/session Freshness Lite runtime state、final primary missing-source enforcement 和 transcript/system_event boundary record；EvidenceSummary 带入已有 evidence claim metadata。
- `packages/tui/src/index.test.ts`：覆盖 Freshness Lite boundary、primary runtime warning、web_source present/missing system_event、ordinary request no-warning、schema mismatch primary、doctor 输出兼容。
- `docs/delivery/README.md` 与本报告：阶段交付闭环。

### Forbidden duplicate systems

本轮未新增第二套 provider resolver、provider runtime、freshness runtime、web evidence runtime、permission pipeline、tool runtime、agent/job runtime、remote channel 或 smoke runner；未引入新依赖；未复制 CCB / Claude Code / OpenCode / 第三方源码、内部 API、专有遥测或反编译痕迹。

## 已完成功能

- Provider runtime contract 收口：`ProviderRuntimeContract` 现在显式包含：
  - `profile`
  - `endpointProfile`
  - `endpoint`
  - `compatibilityProfile`
  - `supportsTools`
  - `sendReasoning`
  - `includeUsage`
  - `toolSchemaShape`
  - `toolResultShape`
  - `retryStatuses`
  - `maxAttempts`
  - `requestTimeoutMs`
  - `streamIdleTimeoutMs`
- DeepSeek 固定为 `deepseek_chat_completions`，chat completions endpoint，不发送 reasoning，使用 OpenAI chat tools / tool message shape。
- OpenAI-compatible chat completions 区分 strict 与 permissive runtime profile；strict 不发送 non-standard reasoning，permissive 可发送 reasoning。
- OpenAI Responses 固定为 `openai_responses`，使用 `/responses` endpoint、Responses tool schema、Responses `function_call_output` tool result shape。
- `/model doctor` provider 行展示 runtime profile、tool schema/result shape、retry statuses / attempts、request timeout 和 stream idle timeout；仍不泄露 apiKey 原值或 raw baseUrl query/fragment。
- Provider failure primary 增加 schema mismatch / tool schema incompatibility 人话化：提示运行 `/model doctor` 检查 endpointProfile、tools/tool_choice、tool_result 和 reasoning compatibility。
- Freshness Lite：对包含“最新 / 当前 / 现在 / 今天 / 今年 / 实时 / 外部资料 / 网页 / 官网 / 官方 / 新闻 / 版本 / 价格 / latest / current / today / now / real-time / external / web / official / news / price / version”等请求，在 model system prompt 中加入 `FreshnessBoundary`，并建立本轮 request/session runtime state。
- Web-source Evidence Lite：复用既有 `EvidenceRecord.kind = "web_source"`；Freshness boundary 会标记 `web_source_evidence=present|missing`。缺少 web_source 时，模型必须标记最新/当前/外部事实为未验证或需要确认；若模型忘记，runtime 会在 final primary 输出自动追加短 missing-source warning。
- Freshness Lite transcript boundary：freshness-sensitive 请求会写入 `system_event`：`freshness_lite_boundary: sensitive=yes web_source_evidence=present|missing`；missing 且追加主屏 warning 时会再写入 `freshness_lite_primary_enforced`。
- EvidenceSummary 继续保持短摘要，并追加已有 `supportsClaims` 的前 5 项，帮助模型区分 evidence 能支撑哪些 claim；不新增 raw evidence dump。

## 使用方式

```text
/model doctor
/model route doctor
```

用户提出需要最新、当前、实时、外部资料或网页事实的问题时，Linghun 会在本轮 provider 请求的 system prompt 里加入 Freshness Lite boundary，并记录本轮 Freshness Lite runtime state。若当前上下文没有 `web_source` evidence，最终回答必须把相关最新/当前事实标为未验证或需要确认；如果模型未主动标记，runtime 会在 final primary 输出追加短提示：本会话没有 `web_source` 证据，相关最新/当前/外部事实未验证、需要进一步确认。

Provider 失败时，主屏只显示短结论和下一步；详细 evidence / transcript 仍保留脱敏诊断，可通过 `/model doctor` 和 `/details evidence` 继续排查。

## 涉及模块

- `packages/providers/src/index.ts`：导出并扩展 provider runtime contract。
- `packages/providers/src/index.test.ts`：新增 contract boundary focused test。
- `packages/tui/src/request-lifecycle-presenter.ts`：provider failure primary 增加 schema/tool/profile mismatch 分类。
- `packages/tui/src/index.ts`：doctor 输出复用 runtime contract；system prompt 增加 Freshness Lite boundary；final primary 输出前执行 missing-source runtime enforcement；system_event 记录 present/missing boundary；EvidenceSummary 携带短 claims。
- `packages/tui/src/index.test.ts`：新增 Freshness Lite primary runtime warning、web_source present/missing boundary、ordinary no-warning、schema mismatch primary 和 doctor 输出期望。
- `docs/delivery/README.md`：新增 Phase 15.5E 交付记录。
- `docs/delivery/phase-15-5e-provider-freshness.md`：本报告。

## 关键设计

### Provider contract is the single source for diagnostics

本轮没有新增 provider registry 或第二套 resolver。`resolveProviderRuntimeContract()` 仍由既有 provider config + request endpointProfile 决定 runtime profile；`/model doctor` 直接复用该 contract 输出诊断字段，避免 doctor 与实际 provider 行为分叉。

### No silent provider/profile downgrade

本轮不做自动 endpointProfile 降级、不做自动 reasoning 降级、不做静默 provider switch。strict chat profile 仍不发送 reasoning；Responses profile 仍走 `/responses` 和 Responses tool shape。baseUrl 与 endpointProfile mismatch 继续只诊断，不自动改 profile。

### Primary/details/debug layering

Primary failure 输出只给短结论和下一步，不展示 apiKey、baseUrl query/fragment、raw body、UUID、evidence id 或本地路径。Provider failure evidence 和 system event 保留脱敏后的 provider/model/endpointProfile/code summary，用于 `/model doctor` 与 `/details evidence` 排查。

### Runtime-enforced Freshness Lite boundary

Freshness Lite 不新增联网能力，也不伪造 web evidence。若已有真实 `web_source` evidence，prompt 和 transcript boundary 标记 present；若没有，prompt 标记 missing 并要求回答把最新/当前/外部事实标成未验证或需要确认。P1/P2 成熟收尾后，缺少 `web_source` 时不再只依赖模型遵守 prompt：runtime 会在 final primary 输出前追加短 missing-source warning，并在 transcript/system_event 记录 `freshness_lite_primary_enforced`。

## 配置项

本阶段没有新增用户必须配置的新顶层配置项。沿用既有 provider 配置字段：

- `type`
- `baseUrl`
- `apiKey`
- `model`
- `maxOutputTokens`
- `supportsTools`
- `endpointProfile`
- `compatibilityProfile`
- `reasoningLevel`
- `includeUsage`

## 命令

本阶段未新增 slash command。相关排查入口沿用：

- `/model doctor`
- `/model route doctor`
- `/details evidence`

## 测试与验证

Focused/local validation（本轮已执行）：

- `corepack pnpm exec vitest run packages/providers/src/index.test.ts packages/tui/src/index.test.ts packages/config/src/index.test.ts`：PASS（3 files，194 tests）。
- `corepack pnpm typecheck`：PASS。
- `corepack pnpm check`：PASS（Biome checked 56 files, no fixes applied）。
- `corepack pnpm build`：PASS。
- `git diff --check`：PASS（仅 Windows LF/CRLF warning，无 whitespace error）。

以上只表示 Phase 15.5E focused/local validation 通过；不代表真实全量 smoke、Beta PASS、smoke-ready 或 open-source-ready。

## 性能结果

- Provider contract 扩展只增加少量静态字段计算，不增加 provider 请求轮次。
- Doctor 输出只使用本地 config/contract，不触发真实 provider 网络请求。
- Freshness Lite 只增加本轮 request/session state、system prompt 短 boundary、一次 transcript/system_event 记录，以及必要时一行 final primary warning；不读取外部网页、不创建后台任务、不触发额外模型调用。
- EvidenceSummary 仍限定最近 5 条 evidence，并截断 summary；新增 `supportsClaims` 只取前 5 项，避免 raw evidence dump。

## 已知问题

- 本轮没有执行真实联网 WebFetch/WebSearch，也没有生成真实 `web_source` evidence；Freshness Lite 只验证已有 `web_source` present fixture 与 missing-source runtime enforcement boundary。
- Provider 兼容矩阵仍只覆盖既有 DeepSeek / OpenAI-compatible chat / OpenAI Responses 路径；没有新增第二 provider 或第三方 provider marketplace。
- 未实现 quota/balance reconciliation、provider 成本对账、模型能力自动发现、完整 provider profile UI 或真实跨 provider smoke。
- Freshness Lite 已有 runtime missing-source 主屏兜底，但没有新增强制联网取证流程，也不把未联网内容写成已验证。

## 不在本阶段处理的内容

- Phase 15.5F Terminal Product Readiness。
- Phase 16 / 17 / 18。
- 真实全量 smoke、Beta PASS、smoke-ready、open-source-ready 决策。
- 自动 endpointProfile downgrade、自动 reasoning downgrade、silent provider switch。
- 第二套 provider / evidence / web_source / freshness / permission / tool / agent / job runtime。
- 新 provider、新依赖、provider marketplace、quota/balance reconciliation、完整 web search runtime。
- Durable jobs、Virtual Agent Concurrency、remote channels、企业微信/飞书/钉钉。
- commit。

## 下一阶段衔接

Phase 15.5E 完成后必须停止，由用户决定是否进入 Phase 15.5F Terminal Product Readiness。不得自动进入 Phase 15.5F、Phase 16/17/18，也不得把本轮 focused/local validation 解释为真实全量 smoke 或产品 ready。

## 开发者排查入口

- Provider runtime contract：`packages/providers/src/index.ts` 的 `resolveProviderRuntimeContract()` 与 `ProviderRuntimeContract`。
- Provider URL/profile diagnostic：`resolveProviderBaseUrlDiagnostic()`。
- Provider failure primary：`packages/tui/src/request-lifecycle-presenter.ts` 的 `formatProviderFailurePrimary()` / `classifyProviderFailure()`。
- Model doctor：`packages/tui/src/index.ts` 的 `formatModelRouteDoctor()`。
- Freshness Lite：`packages/tui/src/index.ts` 的 `createFreshnessLiteState()` / `createFreshnessLiteBoundary()` / `recordFreshnessLiteBoundary()` / `formatFreshnessLitePrimaryWarning()` / `needsFreshnessLiteBoundary()`。
- Evidence summary：`createEvidenceSummaryForModel()`。
- Focused tests：`packages/providers/src/index.test.ts`、`packages/tui/src/index.test.ts`、`packages/config/src/index.test.ts`。

## 参考核对

本阶段实际读取/核对的 Linghun 文档：

- `F:\Linghun\START_NEXT_CHAT.md`
- `F:\Linghun\docs\delivery\pre-open-source-terminal-product-completion-gate.md`
- `F:\Linghun\docs\audit\reference-map.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\docs\delivery\phase-15-5a-performance-context.md`
- `F:\Linghun\docs\delivery\phase-15-5b-resource-task-lifecycle.md`
- `F:\Linghun\docs\delivery\phase-15-5c-editing-tool-ux.md`
- `F:\Linghun\docs\delivery\phase-15-5c-plus-log-artifact-runtime-lite.md`
- `F:\Linghun\docs\delivery\phase-15-5c-plus-plus-workspace-snapshot-lite.md`
- `F:\Linghun\docs\delivery\phase-15-5d-connect-lite.md`
- `F:\Linghun\docs\audit\phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md`
- `F:\Linghun\docs\audit\phase-15-pre-smoke-a-c-combined-acceptance.md`
- `F:\Linghun\docs\audit\phase-15-ccb-grade-default-runtime-reconciliation.md`
- `F:\Linghun\PHASE_15_BETA_CCB_MATURITY_REMEDIATION_BASELINE.md` sections 12 / 13
- `F:\Linghun\docs\delivery\README.md`

本阶段参考核对范围：

- CCB / Claude Code Best：仅参考 provider doctor、primary/details 分层、freshness boundary 的产品行为边界；未复制源码或内部实现。
- LiteLLM / OpenRouter / Vercel AI SDK 等 provider abstraction：仅参考 provider profile/endpoint compatibility 的概念边界；Linghun 保持自研最小 contract。
- WebSearch/WebFetch Freshness Gate：仅参考“最新/当前/外部事实必须有来源，否则标记未知/未验证”的行为边界；本轮未新增联网实现。
- 进入 Linghun 自研实现的内容：provider runtime contract fields、doctor 输出、primary failure schema 分类、Freshness Lite prompt boundary、focused tests 和本交付报告。
- 未复制可疑源码实现、内部 API、专有遥测或第三方实现细节。

### Reference delta catch-up 裁决表

| 来源细节 | 裁决 | Phase 15.5E 处理 |
| --- | --- | --- |
| gate/spec：OpenAI-compatible + DeepSeek provider maturity | DONE | 只收口既有 DeepSeek / OpenAI-compatible chat / Responses 路径，不新增 provider。 |
| baseline section 12：split `deepseek_chat_completions` / OpenAI-compatible chat / OpenAI Responses | DONE | Runtime contract 显式输出 profile。 |
| baseline section 12：Provider profile 不得混用 chat vs responses | DONE | Contract 输出 endpoint/profile/tool shape；doctor 可见；不自动降级。 |
| baseline section 12：hidden fallback / silent provider switch 禁止 | DONE | 未新增 fallback；server error retry 后仍显式失败。 |
| baseline section 12：429/5xx retry、timeout、idle timeout 边界 | DONE | Contract 暴露 retry statuses、attempts、request timeout、idle timeout；既有 runtime 继续执行。 |
| baseline section 12：unsupported tools / profile mismatch smoke | DONE（focused/local） | 既有 unsupported tools 可见失败；doctor 展示 tool schema/result 和 profile mismatch。 |
| spec：HTTP 400 分类 model/baseUrl/tool schema/tool_result/gateway format | DONE（Lite） | Primary 增加 schema/tool/profile mismatch 分类；详细排查走 doctor/evidence。 |
| spec：Provider/model 不支持 tools 时不发送 tools/toolChoice | DONE（既有 + 保持） | `selectedTools` false 时不发送 tools/toolChoice；本轮未改变。 |
| baseline section 13：Freshness Gate / web_source runtime | DONE（runtime-enforced Lite boundary） | 复用 `web_source` evidence kind；prompt boundary 与 transcript/system_event 标记 present/missing；missing 时 final primary 自动追加短 warning。 |
| baseline section 13：web claim freshness validation | DONE（runtime-enforced Lite boundary） | 缺少 web_source 时 runtime 要求标记未验证/需确认，并在模型遗漏时补主屏提示；未伪造验证。 |
| reference-map：WebSearch/WebFetch source evidence | DEFERRED | 本轮不新增真实联网 source fetch runtime。 |
| provider quota/balance reconciliation | DEFERRED | 不在 15.5E Lite 范围。 |
| 完整 provider 兼容矩阵 UI / marketplace | DEFERRED | 不新增 provider marketplace 或第二套 profile 系统。 |
| 真实全量 smoke / Beta PASS / smoke-ready / open-source-ready | NOT-DO | 本轮只做 focused/local validation。 |
| Phase 15.5F / Phase 16 / 17 / 18 | NOT-DO | 本轮停止在 Phase 15.5E。 |

## 成品级结构化 handoff packet

- Current phase：Phase 15.5E Provider & Freshness。
- Status：focused/local validation passed；不是 Beta PASS，不是 smoke-ready/open-source-ready。
- Next phase：Phase 15.5F Terminal Product Readiness（必须由用户确认后才可进入）。
- Must not do next without confirmation：真实全量 smoke、Phase 15.5F、Phase 16/17/18、commit、provider marketplace、第二套 runtime、remote channels、durable jobs。
- Modified files：
  - `docs/delivery/README.md`
  - `docs/delivery/phase-15-5e-provider-freshness.md`
  - `packages/providers/src/index.ts`
  - `packages/providers/src/index.test.ts`
  - `packages/tui/src/index.ts`
  - `packages/tui/src/index.test.ts`
  - `packages/tui/src/request-lifecycle-presenter.ts`
- Evidence references：focused vitest / typecheck / check / build / diff-check command outputs in this session；本报告测试与验证章节。
- Verification results：focused/local commands passed；未执行真实全量 smoke，未执行真实联网 freshness/web evidence verification。
- Index status：codebase-memory project `F-Linghun` was checked before implementation and reported ready（nodes 1564，edges 3039）；index search returned no useful code hits, so implementation used source reads and focused tests for confirmation。
- Permission mode：local repository edits only；no remote operation；no dependency/config build pipeline changes；no commit。
- Model/provider：assistant session used Claude Opus 4.6 through Claude Code environment；Linghun runtime changes are provider-agnostic within existing DeepSeek/OpenAI-compatible paths。
- Budget/cost note：no real provider/network smoke was run; validation used local pnpm/vitest/typecheck/check/build only。
