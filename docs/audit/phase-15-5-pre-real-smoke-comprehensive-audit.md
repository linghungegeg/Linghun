# Phase 15.5A-F Pre-Real-Smoke Comprehensive Audit Maturity Closure

## 0. Scope and hard boundaries

本报告更新 `Phase 15.5A-F Pre-Real-Smoke Comprehensive Audit / 综合验收审计` 的 maturity closure 状态，只关闭该审计中已列出的 P1/P2 技术债。

本轮不是真实全量 smoke，不进入 Phase 16 / 17 / 18，不声明 Beta PASS、smoke-ready 或 open-source-ready，不创建 commit，不新增第二套 provider / tool / permission / evidence / MCP / index / freshness / readiness / agent / job runtime，也未复制 CCB / Claude Code / OpenCode / 第三方源码。

本报告中的 `DONE` 只表示对应 audit issue 已通过源码最小修复或文案边界对齐关闭；`PASS` 只表示 focused/local/static validation 通过，不代表真实产品验收通过。

## 1. Closure verdict

**Verdict：CLOSED-FOR-PRE-REAL-SMOKE-AUDIT-CLOSURE / still not Beta PASS**

Phase 15.5A-F comprehensive audit 中列出的 P1 blockers 已做最小闭环：

- Connect Lite MCP local add 默认改为 `untrusted/disabled`，且 add/update/enable 不执行 server。
- MCP enable 增加 trust notice，并明确后续 tools/call 仍经过 discovery / schema / required-args / permission 边界。
- Write/Edit/MultiEdit model-facing schema 补齐 optional `expectedHash`。
- Generic background/Bash `/interrupt` 对可接线 Bash background task 发送 `AbortSignal`；没有 live controller 时使用明确 best-effort/state-only 文案。
- MCP status/doctor 文案收窄到当前真实 codebase-memory 静态 registry + required args guard，并把 extension-contributed MCP/skill/plugin guard 与实际 discovery/trust/schema/runtime 边界分开。
- `/fork verifier` 用户可见摘要明确为 session-scoped conservative verification，不是 durable job、不是第二套 job system、不是 Phase 17。
- Agent background result 不再产出 `pass` maturity evidence。
- Freshness/MCP/Task Cost readiness PASS inflation 已收窄：任意 `web_source` presence 不再是 freshness PASS，MCP enabled-without-tools 不再是 PASS，Task Cost Preview Lite 改为 advisory partial。

因此：

- **可以把本轮 P1/P2 maturity closure 视为 focused/local closure 完成。**
- **仍不能声明 Beta PASS。**
- **仍不能声明 smoke-ready。**
- **仍不能声明 open-source-ready。**
- **仍未执行真实全量 smoke。**
- **是否进入真实全量 smoke 必须由用户另行明确确认。**

## 2. Source-Level Reality Check summary

Index/source reality used for this closure:

- codebase-memory project：`F-Linghun`
- observed status：`ready`
- observed graph：`nodes=1603, edges=3137`
- source confirmation：对关键 implementation files 和 focused tests 做了源码读取与本地验证。

### Existing implementation

- `packages/tools/src/index.ts` 已存在 Write/Edit/MultiEdit `expectedHash` runtime guard 与 Bash `AbortSignal` support。
- `packages/tui/src/index.ts` 已存在 MCP lifecycle、background task state、verification/fork path、model tool schema creation、doctor/status/problem surfaces。
- `packages/tui/src/terminal-readiness-presenter.ts` 已存在 local/static readiness doctor presenter 与 PASS disclaimer。
- `packages/tui/src/log-artifact.ts` 已存在 bounded tail/grep/errors、artifact path boundary 与 redaction。

### Gaps found and closed

- Runtime 支持 `expectedHash`，但 model-facing schema 未暴露。
- Bash runtime 支持 abort signal，但 TUI background task 未给 Bash background task 绑定 per-task controller。
- MCP local add/enable 的 trust boundary 与 Connect Lite 文档边界不一致。
- MCP status wording 过度概括 deferred execution guard。
- `/fork verifier` 容易被误读为 Phase 17-like durable job / second job system。
- Readiness PASS count 对 MCP/freshness/task-cost 的 local presence 过于乐观。
- Log Artifact tail line numbers 与 grep/errors scan window 的诊断精度不足。
- Rollback Coach Lite 没有单独呈现 untracked classification。

### Minimal touch points

只修改了完成 maturity closure 必需的 TUI runtime、presenter、log artifact runtime、focused tests 与本 audit report：

- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/log-artifact.ts`
- `packages/tui/src/log-artifact.test.ts`
- `packages/tui/src/terminal-readiness-presenter.ts`
- `docs/audit/phase-15-5-pre-real-smoke-comprehensive-audit.md`

### Forbidden duplicate systems

本轮没有新增以下系统：

- 第二套 provider runtime。
- 第二套 tool permission runtime。
- 第二套 evidence runtime。
- 第二套 MCP execution runtime。
- 第二套 codebase index。
- Freshness WebSearch/WebFetch acquisition runtime。
- Durable jobs / remote channel / Phase 17 job system。
- Desktop / release / Phase 18 flow。

## 3. P1 disposition matrix

| Audit item | Disposition | Closure detail | Boundary |
| --- | --- | --- | --- |
| MCP local add 默认 trusted/enabled | DONE | `addMcpServer()` now creates local MCP config as `disabled: true`, `trustLevel: "untrusted"`, `permissionSummary: "tool-discovery"`; output says server was not executed. | Connect Lite only; no MCP transport smoke. |
| MCP enable 缺 trust notice | DONE | `setMcpServerEnabled()` now emits trust notice before enabling and says later tools/call still pass discovery/schema/required-args/permission pipeline. | Notice does not replace permission approval. |
| `/fork verifier` second job/agent-like boundary | DONE | Verifier summary now says session-scoped conservative verification, not durable job, not second job system, not Phase 17. Agent background result no longer becomes `pass` maturity evidence. | Does not implement durable jobs. |
| Write/Edit/MultiEdit model-facing schema lacks `expectedHash` | DONE | `createToolInputSchema()` exposes optional `expectedHash` for Write/Edit/MultiEdit while preserving required fields. | Runtime stale guard already existed; no public tool API expansion beyond model schema visibility. |
| Network install `--confirm-network` wording | DONE / DOC-ALIGNED | Kept as exact-command opt-in wording; this report explicitly states it is not a full approval system. | No real network install smoke. |
| Generic background/Bash `/interrupt` state-only cancel | DONE | TUI now registers per-background-task `AbortController` for Bash background execution and `/interrupt` sends AbortSignal when available. Missing-controller path explicitly says state-only/best-effort. | Not a robust process supervisor or Phase 17 durable job. |
| MCP status/doctor overclaims deferred guard | DONE | MCP status now separates codebase-memory static registry + required args guard from extension-contributed discovery/trust/schema/runtime guard. | No new MCP execution engine. |
| Freshness/readiness local PASS inflation | DONE / LITE-PARTIAL | Freshness evidence presence becomes `partial`, MCP enabled-without-tools becomes `partial`, Task Cost Preview Lite becomes advisory `partial`. | Still local/static readiness, not real freshness/provider/product proof. |

## 4. P2 disposition matrix

| Audit item | Disposition | Closure detail | Boundary |
| --- | --- | --- | --- |
| Workspace Reference Cache `runtimeStatus` type is `unknown` | DEFERRED | Not changed; current closure did not touch cache API shape to avoid widening scope. Existing callers still pass summarized runtime status. | Keep for future narrow hardening if needed. |
| Bash cleanup guarantee/process tree wording | PARTIAL / NOT-EXPANDED | Bash interrupt now sends AbortSignal where possible and uses honest no-controller wording. Did not add process-tree wait/supervisor semantics. | Avoid Phase 17-like process manager. |
| Log Artifact grep/errors scans prefix window | DONE | `readGrep()` now scans bounded tail window so late failures are visible under byte cap. | Still bounded scan only; not full-log insertion. |
| Log Artifact tail lineRange uses slice-local lines | DONE | `readTail()` now counts preceding newlines and reports true file line range for selected tail lines. | Bounded read only. |
| Rollback Coach lacks untracked classification | DONE | Rollback Coach Lite now counts `??` lines from `git status --short` as `untrackedFiles` and presents it in summaries. | Advisory-only, no automatic rollback. |
| Freshness Lite prompt/warning only | DEFERRED / BY DESIGN | Preserved Lite boundary; no real web source acquisition added. Readiness no longer treats evidence presence as PASS. | Real freshness runtime remains out of scope. |
| Problems Lite presenter redaction/truncation dependency | DONE / TEST-COVERED INDIRECTLY | Existing presenter path preserved; readiness/problem tests updated around conservative surfaces. | Future callers must continue using presenter. |
| `/image generate` and existing agent-like paths as maturity evidence | DONE / DOC-ALIGNED | Agent background results no longer become PASS maturity evidence; report keeps image/agent-like paths out of maturity proof. | No new agent/job system. |

## 5. User-visible behavior changes

- `/mcp add local ...` now tells the user the MCP server is added as `untrusted/disabled` and was not executed.
- `/mcp enable <id>` now includes a trust notice before the enabled message.
- `/mcp status` now uses narrower, implementation-aligned guard wording.
- Model tool schemas now include `expectedHash` for Write/Edit/MultiEdit so the model can use the existing stale-file guard intentionally.
- `/interrupt` against a running Bash background task can send an AbortSignal when the task has a registered controller.
- `/interrupt` against background state without a live controller says it only marked state cancelled.
- `/fork verifier` output now explicitly says it is session-scoped and not durable jobs / second job system / Phase 17.
- `/doctor` readiness remains local/static and more conservative for MCP/freshness/task-cost.
- Log artifact grep/errors are more likely to show late failures in long logs because the bounded scan window is now at the tail.
- Log artifact tail ranges now report true file line numbers.
- Rollback Coach Lite now shows untracked count.

## 6. Modified files

- `packages/tui/src/index.ts`
  - MCP trust defaults and enable notice.
  - MCP status guard wording.
  - model-facing `expectedHash` schema for Write/Edit/MultiEdit.
  - background Bash AbortController registration/cleanup and `/interrupt` AbortSignal path.
  - no-controller interrupt wording.
  - `/fork verifier` non-durable boundary wording.
  - conservative agent background result mapping.
  - Rollback Coach untracked count.
  - Task Cost Preview Lite advisory partial status.
- `packages/tui/src/terminal-readiness-presenter.ts`
  - conservative MCP/freshness readiness statuses.
  - rollback untracked presentation.
- `packages/tui/src/log-artifact.ts`
  - true tail line ranges.
  - tail-window grep/errors scan.
- `packages/tui/src/index.test.ts`
  - focused regressions for conservative readiness, model schema `expectedHash`, MCP trust boundary, `/interrupt` AbortSignal/best-effort wording, verifier non-durable boundary, agent background result conservatism.
- `packages/tui/src/log-artifact.test.ts`
  - focused regressions for true tail line ranges and tail-window grep visibility.
- `docs/audit/phase-15-5-pre-real-smoke-comprehensive-audit.md`
  - this closure report.

## 7. Validation commands and results

All validation below is local/focused/static. It is not real full smoke and not Beta/open-source readiness proof.

```text
git status --short
```

Result before continuation: modified TUI files plus this audit report; no unrelated files observed.

```text
corepack pnpm exec vitest run packages/tui/src/log-artifact.test.ts packages/tui/src/index.test.ts
```

Result：PASS（2 test files, 151 tests）。

```text
corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts packages/tools/src/index.test.ts packages/providers/src/index.test.ts packages/config/src/index.test.ts
```

Result：PASS（5 test files, 337 tests）。

```text
corepack pnpm typecheck
```

Result：PASS。

```text
corepack pnpm check
```

Result：PASS（Biome checked 57 files, no fixes applied）。

```text
corepack pnpm build
```

Result：PASS。

```text
git diff --check
```

Result：PASS（only CRLF conversion warnings from Git were printed; no whitespace errors）。

## 8. Remaining risks and non-goals

Remaining risks are deliberately not closed in this phase because they would expand beyond Phase 15.5A-F maturity closure:

- Real full smoke / real project Beta smoke remains not run.
- No Beta PASS, smoke-ready, or open-source-ready declaration.
- No Phase 16 learning/memory evolution.
- No Phase 17 durable jobs, job persistence, process supervisor, or remote channels.
- No Phase 18 desktop/release flow.
- No real WebSearch/WebFetch freshness source acquisition or claim validation runtime.
- No full MCP remote transport/security/marketplace/cloud sync implementation.
- No workspace cache API reshaping beyond this closure’s touch points.
- Bash process-tree cleanup is still best-effort runtime behavior, not a confirmed durable process supervisor guarantee.

## 9. Closure handoff packet

- Current work：Phase 15.5A-F Pre-Real-Smoke Comprehensive Audit Maturity Closure。
- Closure status：P1 closure complete by focused/local source changes and boundary wording alignment; selected low-risk P2 items closed。
- Real full smoke：not run。
- Beta PASS：not declared。
- Smoke-ready：not declared。
- Open-source-ready：not declared。
- Phase 16 / 17 / 18：not entered。
- Commit：not created。
- Index：codebase-memory `F-Linghun` observed ready, 1603 nodes / 3137 edges。
- Permission/runtime scope：local source edits and local validation only; no remote operation; no dependency changes; no release action。
- Model/provider note：work performed in Claude Code environment with Claude Sonnet 4.6; Linghun real provider behavior was not smoke-tested.
- Budget/cost note：no real provider/network smoke; validation used local pnpm/vitest/typecheck/check/build only.

## 10. Stop point

Stop here at comprehensive audit maturity closure. Do not proceed to real full smoke, Phase 16, Phase 17, Phase 18, commit, release, network install, or open-source readiness declaration without a new explicit user instruction.
