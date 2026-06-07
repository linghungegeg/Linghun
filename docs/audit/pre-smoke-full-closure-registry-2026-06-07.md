# Pre-Smoke Full Closure Registry - 2026-06-07

Status vocabulary: `FIXED`, `NOT-ISSUE`, `MERGED-INTO`, `BLOCKED-BY-USER`.

This registry is the source-level closure ledger for the 2026-06-07 pre-smoke run. It imports the full-line audit, user smoke blockers, document false positives, and historical roadmap leftovers. There are no remaining unclosed entries in this ledger; remaining non-code risk is listed in the final validation ledger.

## Source Documents

| Source | Status | Evidence |
| --- | --- | --- |
| `AGENTS.md` | FIXED | Read before this closure; user explicitly authorized the full Pre-Smoke 0-7 run and stable commit. |
| `LINGHUN_DEVELOPMENT_ROADMAP.md` | FIXED | Read as current execution entry; updated to point at this closed registry. |
| `docs/audit/FULL_LINE_AUDIT_2026-06-07.md` | FIXED | Read and updated with closure status. |
| `docs/delivery/phase-pre-smoke-03-executor-closure.md` | FIXED | Converted from planned entry to delivered executor closure doc. |
| `docs/delivery/README.md` | FIXED | Updated with Pre-Smoke 00-07 delivery rows. |
| Completed related delivery docs | FIXED | Rechecked Phase 15.5D, Phase 16, Phase 7.9, Phase 7.13, Phase F, Phase B and related phase docs. |

## Phase Closure Summary

| Phase | Status | Delivery Doc | Main Evidence |
| --- | --- | --- | --- |
| Pre-Smoke 0 | FIXED | `docs/delivery/phase-pre-smoke-00-audit-registry.md` | This registry, audit doc correction, roadmap status sync. |
| Pre-Smoke 1 | FIXED | `docs/delivery/phase-pre-smoke-01-tui-input-panel.md` | terminal input runtime, transcript selection state, panel owner fixes, Ink smoke tests. |
| Pre-Smoke 2 | FIXED | `docs/delivery/phase-pre-smoke-02-memory-runtime.md` | memory extraction runtime, taxonomy, manifest/topic markdown, no-save list, lifecycle commands. |
| Pre-Smoke 3 | FIXED | `docs/delivery/phase-pre-smoke-03-executor-closure.md` | Skill/Plugin fail-closed truthfulness, MCP stdio/SSE execution, discovery-before-execute. |
| Pre-Smoke 4 | FIXED | `docs/delivery/phase-pre-smoke-04-state-error-concurrency.md` | session-store queue, circuit breaker half-open, status sorting, explicit error handling. |
| Pre-Smoke 5 | FIXED | `docs/delivery/phase-pre-smoke-05-functional-ecosystem.md` | help registry alignment, git/workspace/verification/clipboard fixes, user-state signal runtime. |
| Pre-Smoke 6 | FIXED | `docs/delivery/phase-pre-smoke-06-low-risk-debt.md` | shared helpers, runtime constants, renderer/clipboard/shell debt tests, package-boundary NOT-ISSUE items. |
| Pre-Smoke 7 | FIXED | `docs/delivery/phase-pre-smoke-07-full-closure.md` | final validation ledger and stable-point commit step. |

## P0 User Smoke Items

| ID | Item | Status | Source File | Source-Level Evidence | Fix Phase | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| T0.1 | Delete / Backspace raw sequence normalization | FIXED | `packages/tui/src/shell/models/terminal-input-runtime.ts`, `packages/tui/src/shell/components/Composer.tsx` | `normalizeTerminalInput()` handles Ink delete/backspace, `\x1B[3~`, DEL, BS, ctrl/meta delete-word-left; Composer dispatches normalized actions. | Pre-Smoke 1 | `terminal-input-runtime.test.ts`, `index.test.ts` Composer assertions. |
| T0.2 | Shift+Enter / Alt+Enter / Ctrl+J newline stability | FIXED | `terminal-input-runtime.ts`, `Composer.tsx`, `ink-renderer.tsx` | Runtime recognizes Ink shift/meta return, CSI-u and modifyOtherKeys newline paths; Composer keeps newline action separate from submit. | Pre-Smoke 1 | `terminal-input-runtime.test.ts`, `shell/view-model.test.ts`. |
| T0.3 | Mouse left drag select/copy/down-drag | FIXED | `transcript-selection-state.ts`, `Composer.tsx`, `ink-renderer.tsx`, `clipboard.ts` | SGR down/drag/up/wheel parsing, transcript-mouse event dispatch, selection reducer, edge autoscroll and best-effort clipboard copy. | Pre-Smoke 1 | `transcript-selection-state.test.ts`, `ink-interaction-smoke.test.ts`, `clipboard.test.ts`. |
| T0.4 | Advanced panel rendering/input owner | FIXED | `BtwPanel.tsx`, `ConfigPanel.tsx`, `HelpPanel.tsx`, `SessionsPanel.tsx`, `input-owner-controller.ts` | Panels now respect single owner / inactive `useInput` boundaries and do not compete with Composer input. | Pre-Smoke 1 | `input-owner-controller.test.ts`, `advanced-slash-panel-invariant.test.ts`, `shell/view-model.test.ts`. |
| T0.5 | Composer monolithic input risk | FIXED | `Composer.tsx`, `terminal-input-runtime.ts`, `transcript-selection-state.ts` | High-risk raw key and mouse parsing moved to pure runtimes; Composer still owns rendering and dispatch glue only where existing architecture requires it. | Pre-Smoke 1 | input and selection pure-function tests plus Composer static invariants. |

## Automatic Memory Runtime

| ID | Item | Status | Source File | Source-Level Evidence | Fix Phase | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| M0.1 | Replace fixed phrase/regex auto-learning with memory extraction runtime | FIXED | `memory-extraction-runtime.ts`, `memory-command-runtime.ts` | Turn-end learning now calls extraction runtime for `create` / `update` / `no-op`; fixed phrase trigger path removed from the mature path. | Pre-Smoke 2 | `memory-extraction-runtime.test.ts`, `memory-command-runtime.test.ts`. |
| M0.2 | Markdown memory layer / manifest / topic updates | FIXED | `memory-extraction-runtime.ts`, `tui-memory-runtime.ts` | Dedicated `MEMORY.md` manifest and taxonomy/topic markdown files are written for accepted project/user memories. | Pre-Smoke 2 | manifest/topic tests in `memory-extraction-runtime.test.ts`. |
| M0.3 | Taxonomy and do-not-save list | FIXED | `memory-extraction-runtime.ts`, `tui-memory-runtime.ts` | Taxonomy is `user / feedback / project / reference`; no-save filter blocks secrets, code structure, git/history, temporary work, logs, transcript/index dumps and debug recipes. | Pre-Smoke 2 | negative extraction tests. |
| M0.4 | Dedicated memory write path only for Linghun memory dir | FIXED | `memory-command-runtime.ts`, `memory-extraction-runtime.ts` | Auto extraction writes only through `getMemoryDirectory(scope, context)` and markdown helpers; ordinary Write/Edit permissions are not relaxed. | Pre-Smoke 2 | memory runtime tests and storage/status docs. |
| M0.5 | forget / disable / rollback refresh cache and injection | FIXED | `memory-command-runtime.ts`, `tui-memory-runtime.ts` | accept/reject/disable/rollback/delete/forget update memory state and call `refreshCacheFreshness()`; prompt injection is accepted-only topK. | Pre-Smoke 2 | `memory-command-runtime.test.ts`, `index.test.ts` memory boundaries. |

## User-State / Feedback Signal Runtime

| ID | Item | Status | Source File | Source-Level Evidence | Fix Phase | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| U0.1 | Replace `matchesFrustrated` as sole maturity signal | FIXED | `user-state-signal-runtime.ts`, `meta-scheduler-runtime.ts` | Structured runtime evaluates evidence first: repeated failures, provider/tool/verification events, explicit feedback and text hints as one weighted input. | Pre-Smoke 5 | `user-state-signal-runtime.test.ts`, `meta-scheduler-runtime.test.ts`. |
| U0.2 | Event facts / repeated failures / feedback / loading / panel state | FIXED | `user-state-signal-runtime.ts`, `meta-scheduler-runtime.ts` | Runtime consumes `repeatedFailureCount`, recent events, explicit feedback, `loading`, `activePrompt`, `otherPanelOpen`. | Pre-Smoke 5 | event-driven and busy-surface tests. |
| U0.3 | dismiss/cooldown/policy gate/typed verification plan | FIXED | `user-state-signal-runtime.ts`, `meta-scheduler-runtime.ts` | Supports policy disabled, dismissed, cooldown and busy-surface suppression; outputs typed verification and notification plans. | Pre-Smoke 5 | cooldown/dismiss/policy tests. |

## Executor / MCP / Security High-Risk Items

| ID | Item | Status | Source File | Source-Level Evidence | Fix Phase | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | Skill executor closure | FIXED | `deferred-tools-catalog.ts`, `mcp-index-runtime.ts`, `extension-command-runtime.ts` | Trusted skill contributions are discoverable but `executable:false` until a safe adapter exists; ExecuteExtraTool returns structured fail-closed result and doctor reason. | Pre-Smoke 3 | `phase-f-permission-mcp.test.ts`, catalog invariants. |
| H2 | Plugin executor closure | FIXED | `deferred-tools-catalog.ts`, `extension-command-runtime.ts` | Plugin command/tool contributions are blocked unless enabled/trusted/schema-valid and still non-executable without adapter; no prompt implies direct execution. | Pre-Smoke 3 | `phase-f-permission-mcp.test.ts`, `/plugins doctor` invariants. |
| H3 | MCP executor closure | FIXED | `mcp-index-runtime.ts`, `mcp-stdio-runtime.ts`, `mcp-sse-runtime.ts` | Stdio and SSE MCP tools require discovery, schema load, trust and enabled server; ExecuteExtraTool calls tools/call only after SearchExtraTools discovery. | Pre-Smoke 3 | `phase-f-permission-mcp.test.ts`. |
| H4 | MCP SSE JSON-RPC array guard | FIXED | `mcp-sse-runtime.ts` | JSON-RPC unwrap rejects arrays and invalid objects. | Pre-Smoke 3 | SSE array/object validation tests. |
| H5 | MCP SSE id/cache/concurrency | FIXED | `mcp-sse-runtime.ts` | Request ids increment; tools/list is cached per endpoint while preserving tools/call ids. | Pre-Smoke 3 | SSE cache/id tests. |
| H6 | Model setup partial validation fake values | FIXED | `model-setup-runtime.ts` | Partial validation now validates provided fields and leaves required-field enforcement to full submit. | Pre-Smoke 3 | `model-setup-runtime.test.ts`. |
| H7 | Remote mock signature production gate | FIXED | `remote-command-runtime.ts`, `remote-transport.ts` | Mock/fixture inbound paths are gated for test mode; empty signing secret and production mock path return blocked diagnostics. | Pre-Smoke 3 | remote transport / command tests. |
| H8 | Permission denial missing gateway/continuation warning | FIXED | `permission-approval-runtime.ts` | Denial paths record warning/tool-result/state when continuation or gateway is unavailable. | Pre-Smoke 3/4 | permission focused tests. |
| H9 | Runner spawn error swallowed | FIXED | `runner-runtime.ts` | Spawn error paths record fallback reason instead of empty handler. | Pre-Smoke 3/4 | runner/error-path tests and build. |
| H10 | Command details / URL / Feishu close / HMAC empty secret | FIXED | `command-panel-runtime.ts`, `connector-runtime.ts`, `remote-transport.ts`, `feishu-long-connection-runtime.ts` | Sensitive details sanitized, URL parse failures preserve original error, close is idempotent, empty HMAC secret is blocked. | Pre-Smoke 3 | focused remote/connector tests. |

## State / Concurrency / Error Handling Items

| ID | Item | Status | Source File | Source-Level Evidence | Fix Phase | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | Permission mode memory update before async commit | FIXED | `permission-approval-runtime.ts` | Permission state mutation has rollback/diagnostic handling on failed async commit. | Pre-Smoke 4 | permission tests. |
| S2 | Git evidence memory/store consistency | FIXED | `git-tool-dispatch-runtime.ts` | Evidence write path reports failure and avoids silent in-memory/store divergence. | Pre-Smoke 4 | git evidence focused tests. |
| S3 | `Date.parse("")` unstable sort | FIXED | `runtime-status-snapshot.ts` | `safeDateMs()` guards empty/invalid dates before sorting. | Pre-Smoke 4 | `runtime-status-snapshot.test.ts`. |
| S4 | `executeMemoryMutation` exhaustive fail-closed | FIXED | `memory-command-runtime.ts` | Mutation action union is handled explicitly; unknown action throws/fails closed. | Pre-Smoke 4 | `memory-command-runtime.test.ts`. |
| S5 | SessionStore concurrent append linearization | FIXED | `packages/core/src/session-store.ts` | Per-session write queue linearizes append/update writes instead of `setTimeout(0)` retry. | Pre-Smoke 4 | `session-store.test.ts`. |
| S6 | Provider circuit breaker half-open | FIXED | `provider-circuit-breaker.ts` | Breaker enters `half-open` after cooldown and resolves success/failure explicitly. | Pre-Smoke 4 | `provider-circuit-breaker.test.ts`. |
| S7 | Empty catch / void Promise audit | FIXED | Multiple | Empty catch and dropped Promise paths are either handled, logged or source-proven defense-only. | Pre-Smoke 4/6 | `rg "catch \\{\\s*\\}"` plus focused tests. |

## Functional Correctness Items

| ID | Item | Status | Source File | Source-Level Evidence | Fix Phase | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | `auxModel` setup dead definition | FIXED | `packages/config/src/index.ts`, `packages/tui/src/shell/view-model.ts` | Model setup/view labels and tests no longer leave unreachable setup step behavior. | Pre-Smoke 5 | `model-setup-runtime.test.ts`, `shell/view-model.test.ts`. |
| F2 | `/help` and command description drift | FIXED | `slash-dispatch.ts`, `deferred-tools-catalog.ts`, `index.test.ts` | `/help all` is registry-backed and tests assert canonical command/help alignment. | Pre-Smoke 5 | `index.test.ts`, `advanced-slash-panel-invariant.test.ts`. |
| F3 | Git branch regex supports legal dots | FIXED | `git-runtime.ts` | Branch validation accepts legal dotted branch names while keeping unsafe names blocked. | Pre-Smoke 5 | `git-runtime.test.ts`. |
| F4 | Workspace ignore glob handling | FIXED | `workspace-reference-cache.ts` | Ignore pattern matching handles glob wildcards instead of returning false. | Pre-Smoke 5 | `workspace-reference-cache.test.ts`. |
| F5 | Verification runner package manager detection | FIXED | `verification-command-runtime.ts` | Package manager detection now handles pnpm/npm/yarn/bun rather than hard-coding `corepack pnpm` for every project. | Pre-Smoke 5 | `verification-command-runtime.test.ts`. |
| F6 | Clipboard stderr handling | FIXED | `shell/clipboard.ts` | Clipboard command succeeds on exit 0 even with non-empty stderr; stderr is used for failed exit diagnostics. | Pre-Smoke 5 | `clipboard.test.ts`. |

## Low-Risk Debt / Duplicates / Shell Items

| ID | Item | Status | Source File | Source-Level Evidence | Fix Phase | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | Duplicate helpers: positive int env / node error / diagnostic error | FIXED | `packages/shared/src/index.ts`, selected package runtimes | Shared helpers now own common env/error helpers; package-local diagnostics remain only where importing shared would create a package-boundary cycle. | Pre-Smoke 6 | Biome touched files, typecheck. |
| L2 | Secret redaction duplicate helpers | FIXED | `packages/shared/src/index.ts`, provider/config/runtime callers | Shared redaction helpers cover common secret masking; callers sanitize user-visible diagnostics. | Pre-Smoke 6 | provider/config tests. |
| L3 | displayWidth duplicate | FIXED | `shell/plain-renderer.ts`, shell text utils | Renderer path uses shared text width utilities where safe. | Pre-Smoke 6 | shell/view-model and renderer tests. |
| L4 | learning-state constants duplicate | FIXED | `runtime-utils.ts`, `tui-state-runtime.ts`, `tui-memory-runtime.ts` | `MEMORY_LEARNING_STATE_FILE` moved to a shared runtime constant. | Pre-Smoke 6 | memory tests, typecheck. |
| L5 | Dead code: task suggestions / unknown hint / legacy types | FIXED | Multiple | Dead branches/imports removed or left only as tested compatibility/defense paths. | Pre-Smoke 6 | typecheck, static invariants. |
| L6 | Shell debt: MessageMarkdown/plain/ProductBlock/ScrollViewport/useAnchoredCursor | MERGED-INTO | `shell/**` | Shell-facing debt closed through Pre-Smoke 1/5/6 regression coverage; non-blocking future UX polish is not a smoke blocker. | Pre-Smoke 6 | `shell/view-model.test.ts`, `ink-interaction-smoke.test.ts`. |

## Document False Positives / Overstatements

| ID | Item | Status | Source File | Source-Level Evidence | Fix Phase | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | `provider-client-runtime.ts` missing | NOT-ISSUE | `packages/providers/src/provider-client-runtime.ts` | File exists and is imported by provider package. | Pre-Smoke 0 | `rg --files`. |
| D2 | Deferred tools all non-executable | MERGED-INTO | `mcp-index-runtime.ts`, `deferred-tools-catalog.ts` | MCP paths are executable when discovered/trusted/schema-loaded; Skill/Plugin are truthfully fail-closed until adapters exist. | Pre-Smoke 0/3 | executor tests. |
| D3 | CommandPanel `useInput` deps | NOT-ISSUE | `packages/tui/src/shell/components/CommandPanel.tsx` | CommandPanel does not own `useInput`; real owner components are fixed under T0.4. | Pre-Smoke 0/1 | source read. |
| D4 | Unknown terminal assumes all capability | MERGED-INTO | `terminal-capability.ts`, `ink-renderer.tsx` | Original wording was overbroad; capability/mouse tracking is now guarded by runtime support and fallback behavior. | Pre-Smoke 0/1 | terminal tests. |
| D5 | Mock inbound any prefix bypass | MERGED-INTO | `remote-command-runtime.ts` | Original wording was overbroad; production/no-secret mock gate fixed under H7. | Pre-Smoke 0/3 | remote tests. |
| D6 | Model setup partial always passes | MERGED-INTO | `model-setup-runtime.ts` | Original wording was overbroad; fake-value partial validation fixed under H6. | Pre-Smoke 0/3 | model setup tests. |

## Historical Roadmap A-G

| ID | Status | Evidence |
| --- | --- | --- |
| A1-A16 | MERGED-INTO | Phase A delivered; regressions imported under concrete Pre-Smoke IDs when present. |
| B1-B4 | MERGED-INTO | Phase B delivered; low-risk leftovers closed under L1-L6/S7. |
| C1-C6 | MERGED-INTO | Phase C cost/git/token delivered; no new blocker found in this run. |
| D1-D3 | MERGED-INTO | Phase D tool/command/token delivered; command drift and deferred truthfulness closed under F2/H1-H3. |
| E1-E20 | MERGED-INTO | Phase E coverage delivered; this run adds targeted tests for new gaps. |
| F1-F3 | MERGED-INTO | Phase F provider/permission/MCP delivered; SSE/cache/id gaps fixed under H3-H5. |
| G1-G4 | MERGED-INTO | Phase G delivered; auto memory and remote signature gaps fixed under M0/H7. |

## Final Validation Ledger

| Command | Status | Notes |
| --- | --- | --- |
| `corepack pnpm exec vitest run packages/tui/src/shell/models/terminal-input-runtime.test.ts packages/tui/src/shell/models/transcript-selection-state.test.ts packages/tui/src/shell/clipboard.test.ts --no-color` | PASS | Pre-Smoke 1 focused input/mouse/clipboard coverage. |
| `corepack pnpm exec vitest run packages/tui/src/memory-extraction-runtime.test.ts packages/tui/src/memory-command-runtime.test.ts --no-color` | PASS | Pre-Smoke 2 focused memory runtime coverage. |
| `corepack pnpm exec vitest run packages/tui/src/phase-f-permission-mcp.test.ts packages/tui/src/model-setup-runtime.test.ts packages/tui/src/remote-transport.test.ts --no-color` | PASS | Pre-Smoke 3 focused executor/security coverage. |
| `corepack pnpm exec vitest run packages/core/src/session-store.test.ts packages/tui/src/runtime-status-snapshot.test.ts packages/tui/src/provider-circuit-breaker.test.ts --no-color` | PASS | Pre-Smoke 4 focused state/concurrency coverage. |
| `corepack pnpm exec vitest run packages/tui/src/user-state-signal-runtime.test.ts packages/tui/src/meta-scheduler-runtime.test.ts packages/tui/src/git-runtime.test.ts packages/tui/src/workspace-reference-cache.test.ts packages/tui/src/verification-command-runtime.test.ts --no-color` | PASS | Pre-Smoke 5 focused functional/user-state coverage. |
| `corepack pnpm exec biome check ... --no-errors-on-unmatched --colors=off` | PASS | Touched critical files passed Biome. |
| `corepack pnpm exec vitest run packages/tui/src/index.test.ts --testTimeout 60000 --no-color` | PASS | Full `index.test.ts`: 666/666 passed. |
| `corepack pnpm exec vitest run packages/tui/src/phase-e-mainchain-coverage.test.ts --testTimeout 60000 --no-color` | PASS | Main-chain coverage tests passed. |
| `corepack pnpm typecheck` | PASS | Passed after build/typecheck race avoidance. |
| `corepack pnpm build` | PASS | Passed. |
| `git diff --check` | PASS | Passed after final documentation updates. |
| `corepack pnpm test -- --no-color` | PASS | 94 test files passed, 3160 tests passed, 2 benchmark tests skipped. |

## Residual Risk

- No external provider or real project smoke was executed in this Pre-Smoke closure. This registry establishes the local/focused/full-unit stable point before real project smoke.
- Manual terminal/mouse behavior can still vary by Windows Terminal, legacy console, tmux, SSH and clipboard utility availability. The code paths are covered by parser/reducer/Ink smoke tests; real interactive smoke remains the next user-facing validation step.
- Skill/Plugin contributed tools are intentionally not executable without safe adapters. This is a closed fail-safe state, not a claim that third-party Skill/Plugin command execution is available.
