---
title: Phase 15 pre-Beta Verdict Evidence Gate / Anti-Hallucination Readiness Closure
status: pre-beta-verdict-evidence-gate-partial
phase: 15-pre-beta
created: 2026-05-19
scope: Phase 15 pre-Beta readiness/verdict evidence only; not Phase 15 Beta / 15.5 / 16+
---

# Phase 15 pre-Beta Verdict Evidence Gate / Anti-Hallucination Readiness Closure

> 本报告先于最终源码验证输出，作为本轮“完成度结论 evidence-first”的审计入口。本轮只关闭 verdict/readiness 结论层反幻觉：防止把 focused PASS、mock PASS、live text PASS、SKIPPED smoke、未覆盖 real TUI path 包装成整体 ready / 等于 CCB / 可以进入 Beta。本轮不进入 Phase 15 Beta、Phase 15.5 或 Phase 16+；不复制 CCB / Claude Code / OpenCode 源码。

## 1. 读取与索引状态

- `F-Linghun` codebase-memory index：ready，1038 nodes / 1939 edges。
- 本轮已读取 Linghun 文档/源码：
  - `docs/open-source-positioning-notes.md`
  - `docs/audit/phase-15-pre-beta-ccb-grade-runtime-acceptance-closure.md`
  - `docs/audit/phase-15-pre-beta-end-to-end-ccb-user-journey-parity-closure.md`
  - `docs/delivery/phase-15-natural-command-bridge.md`
  - `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
  - `LINGHUN_IMPLEMENTATION_SPEC.md`
  - `START_NEXT_CHAT.md`
  - `packages/tui/src/index.ts`
  - `packages/tui/src/index.test.ts`

## 2. Verdict Evidence Gate Matrix

| ID | Claim / output surface | Allowed max verdict without required evidence | Must bind evidence | Downgrade rule |
| --- | --- | --- | --- | --- |
| V01 | local/focused test PASS | focused PASS only | exact focused command, test file list, output summary | focused PASS != overall readiness PASS |
| V02 | full test PASS | full-test PASS only | `corepack pnpm test` result and scope | full tests do not prove live provider or real TUI path |
| V03 | mock provider PASS | mock PASS only | mocked fetch/tool_call test evidence | mock provider PASS != live provider PASS |
| V04 | live provider PASS | live-provider PASS for covered path only | provider/model, temporary env boundary, smoke output | live text PASS cannot prove tool/report generation |
| V05 | live provider SKIPPED | SKIPPED / PARTIAL readiness | skip reason and missing env/evidence | SKIPPED live smoke blocks Phase 15 Beta PASS |
| V06 | journey smoke PASS | journey PASS only | scripted journey inputs/outputs and assertions | journey PASS + missing live provider => PARTIAL readiness |
| V07 | real Beta PASS | cannot claim before Beta | real Beta execution packet, live provider, real TUI, critical paths | absent real Beta evidence => invalid/PARTIAL |
| V08 | CCB parity claim | PARTIAL unless acceptance matrix complete | CCB behavior references, Linghun mapping, uncovered items | no matrix/uncovered/risk => cannot say equals CCB |
| V09 | Phase readiness claim | PARTIAL if any critical path untested | scope, evidence refs, validation commands, uncovered, risks | untested critical path => PARTIAL |
| V10 | release readiness claim | FAIL/PARTIAL before release gate | install/build/doctor/docs/security/provider evidence | Phase 15 pre-Beta cannot imply release ready |
| V11 | “已完成 / 无风险 / 等于成熟工具” wording | needs disclaimer | evidence refs and residual risk list | no evidence refs => invalid/PARTIAL |
| V12 | verifier report | scoped verifier verdict only | command blocks, output, changed files, uncovered items | verifier must not upgrade local PASS to global ready |
| V13 | handoff packet | PARTIAL readiness if live/report missing | `verdictEvidence` scope/status/evidence/validation/uncovered/risk | handoff cannot write skipped/partial as completed |
| V14 | docs/delivery status | PARTIAL readiness until blocking P1 closed | audit report refs and exact readiness caveat | docs cannot say Beta ready while real TUI report path PARTIAL |

## 3. Gap table

| Item | 当前风险 | 是否可能把局部结论说满 | 必须绑定的 evidence | 缺失时应降级成什么 verdict | 当前阶段是否必须修 |
| --- | --- | --- | --- | --- | --- |
| focused tests PASS | 被包装成整体 ready | 是 | focused command + file list + result | focused PASS / Phase readiness PARTIAL | 是 |
| full tests PASS | 被包装成 live/provider ready | 是 | full test command + result + excluded live scope | full-test PASS / readiness PARTIAL | 是 |
| mock provider PASS | 被包装成真实 provider/tool path | 是 | mock boundary + request/response fixture | mock PASS / live-provider unverified | 是 |
| live provider SKIPPED | 被写成 smoke PASS 或 Beta ready | 是 | skip reason + missing env/key/path | SKIPPED；Beta readiness PARTIAL | 是 |
| live basic text PASS | 被包装成 report-generation PASS | 是 | provider/model + covered prompt/path | live-provider PASS for text only；Beta PARTIAL | 是 |
| journey smoke PASS | 被包装成 CCB parity / Beta ready | 是 | journey inputs/outputs + uncovered live paths | journey PASS；readiness PARTIAL | 是 |
| real TUI report-generation PARTIAL | 被淡化为非阻塞 | 是 | file write, tool_use, permission continuation, tool_result evidence | blocking P1 candidate; readiness PARTIAL | 是 |
| CCB parity claim | 被写成“等于 CCB” | 是 | behavior reference + Linghun mapping + matrix + gaps | PARTIAL / scoped parity only | 是 |
| verifier report | 把 mock/focused PASS 升级 | 是 | command outputs + scope + uncovered + risks | verifier scoped verdict only | 是 |
| handoff packet | 新会话继承错误 ready 结论 | 是 | structured verdict evidence fields | PARTIAL / blocked handoff | 是 |
| docs/delivery status | 后续会话误以为可进 Beta | 是 | audit refs + current blocking P1 | PARTIAL | 是 |
| no evidence refs | 口头 PASS 无锚点 | 是 | at least one evidence ref or explicit missing evidence | invalid / PARTIAL | 是 |
| P0 open | 错写 ready | 是 | P0 closure evidence | FAIL | 是 |
| blocking P1 open | 错写 PASS | 是 | P1 closure evidence | PARTIAL/FAIL, not PASS | 是 |

## 4. Implemented verdict scope model

`packages/tui/src/index.ts` 增加轻量 `VerdictEvidenceScope`：

- `scope`: `focused` / `full-test` / `mock` / `journey` / `live-provider` / `real-tui` / `beta` / `release`
- `status`: `PASS` / `PARTIAL` / `FAIL` / `SKIPPED`
- `evidenceRefs`
- `validationCommands`
- `uncoveredItems`
- `residualRisks`
- `nextAction`

该结构接入 handoff packet 的 `verdictEvidence` 字段，并用于 `/claim-check Phase 15 Beta readiness is PASS` 的只读裁决输出。

## 5. Readiness downgrade rules

- live provider smoke SKIPPED => Phase 15 Beta readiness 不能 PASS，只能 PARTIAL。
- mock provider PASS != live provider PASS。
- focused tests PASS != overall readiness PASS。
- journey smoke PASS but live provider missing => PARTIAL。
- untested critical path exists => PARTIAL。
- silent failure found => FAIL/PARTIAL，不能 ready。
- no evidence refs => verdict invalid or PARTIAL。
- P0 open => readiness FAIL。
- blocking P1 open => readiness PARTIAL/FAIL，不能 PASS。
- live provider basic text PASS 只证明 text path，不证明 real TUI report-generation path。
- real TUI report-generation path PARTIAL 时，Phase 15 Beta readiness 必须保持 PARTIAL。

## 6. Current verdict

- Runtime silent-failure gate：PASS for the tested pre-Beta runtime path。
- Live provider basic text smoke：PASS for the temporary-env smoke only。
- Real TUI report-generation path：PARTIAL / blocking P1 candidate。
- Phase 15 Beta readiness：PARTIAL。
- Phase transition：未进入 Phase 15 Beta；未进入 Phase 15.5；未进入 Phase 16+。

## 7. Ordinary-output boundary

Verdict Evidence Gate 只在阶段报告、审计输出、readiness verdict、handoff、verifier report、`/claim-check` 或明确审计请求中启用。普通开发请求不得显示 Verdict Evidence Gate、coverage matrix、systemic_gap、verdict 内部术语。

## 8. Reference boundary

本轮没有复制 CCB / Claude Code / OpenCode 源码、内部 API、变量结构、专有遥测或反编译实现。成熟工具只作为行为边界和验收口径参考。