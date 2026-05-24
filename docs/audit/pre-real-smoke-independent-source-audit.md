# Pre-Real-Smoke Independent Source Audit

Date: 2026-05-25 | Branch: master | Auditor: automated

## 1. Git Status

```
Clean working tree (no staged/unstaged changes to source)
?? docs/audit/pre-real-smoke-independent-source-audit.md
?? docs/delivery/pre-smoke-slice-e-strong-foundation-integration-check.md
```

## 2. Verification Results

| Check | Result |
|-------|--------|
| `corepack pnpm exec vitest run` (6 focused test files) | PASS — 6 test files passed, 435 tests passed |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm check` | PASS |
| `git diff --check` | PASS |

Focused test files:
- `packages/tui/src/architecture-runtime.test.ts`
- `packages/tui/src/shell/view-model.test.ts`
- `packages/tui/src/natural-command-bridge.test.ts`
- `packages/tui/src/index.test.ts`
- `packages/config/src/index.test.ts`
- `apps/cli/src/main.test.ts`

## 3. Findings

### P0 (Blocks smoke)

None.

### P1 (Fix before real-user smoke)

None.

### P2 (Track, fix before beta)

| ID | Category | Finding |
|----|----------|---------|
| P2-1 | TUI/Size | `index.ts` is 15k+ lines; split plan exists (3-batch) but not executed |
| P2-2 | Runner | No managed binary distribution, no code-signing, no AV-friendly install path |
| P2-3 | Cache | `WorkspaceReferenceCache` 7-dim hash recalculates on every probe; no debounce for rapid file changes |
| P2-4 | Background | `DurableJob` passive owner-death detection relies on polling interval; no OS-level process watch |
| P2-5 | Provider | No long-lived circuit breaker / provider quarantine; release-gate consideration |
| P2-6 | TUI/Input | `Shift+Enter` multi-line: code and unit test exist, real TTY unverified; observe during real smoke |
| P2-7 | Runner | Windows Job Object for process-group: `taskkill /T` + AbortController present; Job Object is runner hardening / release gate |

### NOT-DO (Out of scope / deferred by design)

- Unix/macOS process-group cleanup (Windows-first project)
- MCP server bundling/signing
- Remote channel E2E encryption (Phase 17B scope)
- Skill marketplace (future phase)

## 4. Smoke Readiness Verdict

No P0 found in this source/local/mock audit. Starting real provider + real project smoke still requires explicit user confirmation.

## 5. Pre-Smoke Observations

No mandatory fixes identified. P2 items are tracked for release gate / beta hardening.

## 6. Untested Items

| Area | What is not tested | Why |
|------|-------------------|-----|
| Real provider round-trip | No test hits live API | Requires API key + cost |
| Terminal rendering | Ink components not rendered in test | No TTY in CI |
| Multi-line input (Shift+Enter) | Key event not simulated | Requires real terminal |
| Process crash recovery | DurableJob orphan cleanup | Requires kill -9 scenario |
| Large project indexing | WorkspaceReferenceCache on 10k+ files | No large fixture |
| Remote channels | Phase 17B not smoke-ready | By design |

## 7. index.ts Split Plan (Known Tech Debt P2-1)

Current: `packages/tui/src/index.ts` ~15k lines.

| Batch | Extract Target | Approx Lines |
|-------|---------------|-------------|
| 1 | `slash-command-registry.ts` (command definitions + dispatch) | ~4000 |
| 2 | `request-orchestrator.ts` (model request lifecycle + tool execution) | ~3500 |
| 3 | `session-state.ts` (context, config, background task management) | ~3000 |

Remaining in index.ts after split: ~4500 lines (app shell, init, event loop).

---

## Final Statement

- 本审计未进入真实 smoke（未连接真实 provider、未在真实项目运行）。
- 未宣布 Beta PASS / smoke-ready / open-source-ready。
- 基于源码审查 + focused/local/mock 验证，未发现阻断进入真实 smoke 的 P0。
- 是否开始真实 smoke 由用户明确确认。

No secrets exposed. No source files modified. No dependencies changed.
