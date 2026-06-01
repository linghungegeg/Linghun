# Pre-Open-Source Product Restraint & CCB Layout Parity Closure

> Date: 2026-06-01
> Scope: terminal TUI product restraint, CCB layout parity, final-answer gate maturity, and proposal-only workflow truthfulness.
> Status: PARTIAL PASS. Focused code/test closure completed; broader validation is recorded below.

## Summary

This pass intentionally did not add a new execution bridge, scheduler, provider route, env/key path, or permission bypass. It tightened existing surfaces so Linghun behaves more like a mature coding terminal: normal running state stays near the composer, global footer stays compact, details stay explicit, and final-answer gate internals do not leak into ordinary answers.

Changed areas:

- `packages/tui/src/model-loop-runtime.ts`
- `packages/tui/src/model-loop-runtime.test.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/shell/components/Composer.tsx`
- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/components/StatusFooter.tsx`
- `packages/tui/src/shell/models/footer-view.ts`
- `packages/tui/src/shell/models/tui-interaction-contract.test.ts`
- `packages/tui/src/shell/types.ts`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/shell/view-model.test.ts`

## CCB Layout Source Facts

| CCB source fact | Linghun current fact | Gap | This pass |
|---|---|---|---|
| `F:\ccb-source\src\screens\REPL.tsx` places tool JSX, spinner, and task list at the transcript bottom above prompt input; prompt input stays in the bottom band. | `ShellApp.tsx` renders blocks, then `ActivityIndicator`, then explicit panels, with Composer pinned below. | Main layout direction was already close. | Kept structure; no new task-list abstraction. |
| CCB spinner/tool running state is close to the prompt and carries elapsed/work-time style signals. | `ActivityIndicator` lives above Composer and now renders `elapsed`. | Needed visible elapsed for foreground thinking/tool runs. | Added `requestActivityStartedAt`, `TaskActivityView.elapsed`, and rendering. |
| CCB `StatusLine` / `BuiltinStatusLine` are global status: model/context/cost/cache/index style information. | Linghun footer previously also accepted task step/elapsed from activity/background task. | Footer could show workflow/agent/task running progress. | Removed task/elapsed from footer data and rendering. |
| CCB `SystemTextMessage` hides ordinary info unless needed; details go to explicit expansion. | Linghun already had diagnostic/error block separation and runtime status dump filtering. | Needed more invariants around raw internals. | Reused existing presenter tests; no new debug surface. |
| CCB permission dialog suppresses prompt cursor while permission owns focus. | `Composer` passes `null` to `useAnchoredCursor` when permission is active. | Basic behavior matched. | Kept anchored cursor strategy; tests assert permission cursor hiding. |
| CCB ordinary transcript/status does not steal scrolling; only real pickers own navigation. | Linghun had stopped forcing `stickToBottom`, but Composer was disabled when CommandPanel opened. | PageUp/PageDown/wheel could stop working while a normal CommandPanel was visible. | CommandPanel no longer disables Composer; picker panels still do. |
| CCB agent/background details stay separated from statusline. | Linghun background/job/agent summaries exist, and workflow planning is proposal-only. | Footer could still receive progress via `currentStep`; natural workflow text had to remain honest. | Footer progress removed; proposal-only tests remain route A. |

No CCB source was copied; the files were used only to compare behavior and layout boundaries.

## Linghun Source Facts

| Area | Original source fact | Fix / decision |
|---|---|---|
| Footer | `view-model.ts` passed `currentTaskStep` and `elapsed` into `buildFooterView`; `StatusFooter.tsx` rendered `footer.task` and `footer.elapsed`. | Removed these fields from `TaskFooterView`, `footer-view.ts`, `view-model.ts`, and `StatusFooter.tsx`. Running state remains in ActivityIndicator/background blocks/details. |
| CommandPanel scroll | `Composer.tsx` included `view.commandPanel` in `configPanelActive`, making Composer inactive while ordinary CommandPanel was open. | Removed `view.commandPanel` from that gate. CommandPanel still handles Esc; Composer still handles PageUp/PageDown/wheel task scroll. |
| IndexRefresh success | `executeApprovedIndexToolUse` opened CommandPanel for successful Ink index refresh/repair. | Success now writes a normal product block/short output; failure still uses error CommandPanel. Added test. |
| Activity elapsed | Foreground request activity had no started-at field in view model. | `startRequestActivity` records start time, `clearRequestActivity` clears it, `mapRequestActivityToView` formats elapsed, `ActivityIndicator` renders it. |
| Final gate meta discussion | `detectHighRiskClaims` could treat explanation of anti-hallucination examples as `completion_pass`, or over-suppress real claims when meta text was nearby. | Added meta-example filtering for quoted/detected examples while preserving real `completion_pass` and `action_executed` claims. |
| Retry residue | Existing ShellBlockOutput already discards retry text and replaces downgraded text in streaming block/`lastFullOutput`. | Kept; focused tests already cover residue and failure learning. |
| Workflow/agent natural proposal | `CommandProposal` and `/workflows plan` are proposal-only; tests assert natural route shows a suggested command, not a running/done workflow. | Chose route A. No real execution bridge implemented in this pass. |

## Over-Designed Surface Audit

| Surface | Verdict | Handling |
|---|---|---|
| architecture runtime | DEMOTE_TO_DETAILS | Do not expose raw architecture facts on normal main screen; transcript showed it was too frontstage. |
| failure learning | DEMOTE_TO_DETAILS | Keep learning records; presenter tests ensure `sourceRef`, gate retry, and debug internals do not appear in main summary. |
| final answer gate / anti-hallucination | MODEL_NATURAL_ONLY | Keep hard gate. Meta explanation no longer triggers retry; real unsupported completion/action claims still do. |
| index refresh / repair / status | DEMOTE_TO_STATUS | Successful refresh/repair uses short output; failures can use error block/details. |
| workflow / agents / job | DEMOTE_TO_DETAILS | Proposal-only remains honest; no footer progress. Background task blocks/details remain available. |
| remote | DEMOTE_TO_DETAILS | No remote/provider changes in this pass. |
| permission | KEEP_FRONTSTAGE | Permission remains frontstage only when user decision is required. |
| details / Ctrl+O | KEEP_FRONTSTAGE | Explicit detail expansion remains available and non-transcript by default. |
| doctor / status / help | DEMOTE_TO_DETAILS | CommandPanel remains for explicit commands. |
| background task | DEMOTE_TO_STATUS | Running/failed background summaries stay in task region, not footer. |
| cache / index / footer | DEMOTE_TO_STATUS | Footer keeps permission, model, cache, index, reasoning/context metadata only. |
| raw tool protocol / evidence / sourceRef / schema / debug | REMOVE_SURFACE | Existing presenter tests enforce primary-surface redaction. |

## Real Session Replay

Source searched: `C:\Users\Admin\.linghun\data\sessions`.

Relevant transcript found:

`C:\Users\Admin\.linghun\data\sessions\cafc7491a85550ba\57933b0f-90f8-43be-bec8-f6b72bc29815\transcript.jsonl`

| Input | Source fact | Classification | This pass |
|---|---|---|---|
| `更新一下索引` | User message at 2026-06-01T11:34:33.692Z. | Index success was too panel-heavy. | IndexRefresh success no longer opens CommandPanel; evidence still recorded. |
| `帮我审计一下这个项目...多开智能体...工作流...` | User message at 2026-06-01T11:37:50.396Z; following evidence/system event recorded `architecture_runtime_triggered`. | UI over-frontstage architecture/runtime exposure. | Main-screen internals remain demoted; report records this as product-surface issue. |
| `可以利用索引这些 进行全量审计 多开智能体 拆成工作流` | User message at 2026-06-01T11:41:01.443Z. | Proposal-only boundary risk. | Route A retained: workflow proposal preview/suggested command, not running/done. |
| `反幻觉系统前面触发了吗` | User message at 2026-06-01T11:50:24.771Z. | Final gate meta false positive risk. | Meta discussion examples no longer trigger `completion_pass`. |
| `是反幻觉系统在约束你 不让你乱说是吧` | User message at 2026-06-01T11:51:19.219Z. | Final gate meta false positive risk. | Meta explanation passes; real unsupported claims still trigger. |

## Tests And Validation

Focused validation run:

| Command | Result |
|---|---|
| `corepack pnpm --filter @linghun/tui exec vitest run src/model-loop-runtime.test.ts` | PASS, 131 tests |
| `corepack pnpm --filter @linghun/tui exec vitest run src/shell/view-model.test.ts src/shell/models/tui-interaction-contract.test.ts` | PASS, 309 tests |
| `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts` | PASS, 437 tests |

Initial invalid validation attempt:

- `vitest ... --runInBand` failed because Vitest 3.2.4 does not support the Jest `--runInBand` option. Re-run without it passed.

Full validation requested by the task:

| Command | Result |
|---|---|
| `corepack pnpm exec tsc --noEmit` | PASS |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm --filter @linghun/tui exec vitest run src/model-loop-runtime.test.ts src/failure-learning-presenter.test.ts src/tool-output-presenter.test.ts src/job-runner-presenter.test.ts src/shell/view-model.test.ts src/shell/models/tui-interaction-contract.test.ts src/shell/components/composer-dispatch.test.ts src/index.test.ts` | PASS, 952 tests |
| `corepack pnpm --filter @linghun/tui build` | PASS |
| `git diff --check` | PASS |

## Small Repair Addendum

Date: 2026-06-01.

Scope stayed inside the requested small repair boundary: no new phase, no commit, no staging, no `.claude/` edits, and no provider/model/permission core semantics changes.

Cursor repair:

- `Composer` no longer forces task/pending back to native cursor.
- `task` and `pending` use an inline reverse-video cursor on the active composer row.
- `home` keeps the native anchored cursor.
- `permissionActive` still hides the native cursor and does not draw the inline cursor.
- Ordinary `CommandPanel` remains outside `configPanelActive`, so PageUp/PageDown/wheel task-scroll paths stay owned by Composer; picker panels still disable Composer input.
- Source invariants now lock the split: task/pending inline cursor, home anchored cursor, permission hidden cursor, and CommandPanel scroll preservation.

Final-answer gate repair:

- `detectHighRiskClaims` now applies meta/example filtering to `action_executed`, matching the existing `completion_pass` and `code_fact` treatment.
- Meta/example text such as `不能说'索引已刷新'` and `反幻觉系统会检测'已写入文件、索引已刷新、命令已执行'` no longer triggers `action_executed`.
- Real action claims such as `索引已刷新。` still trigger `action_executed` and still require supporting evidence.
- The unsupported action-claim gate was not relaxed.

Clean/check status:

- `corepack pnpm check` initially exposed Biome formatting/import-order issues in previously dirty packaging/bundled-adjacent files plus three `result!` non-null assertions in `bundled-runtime.test.ts`.
- Those were cleaned mechanically so full `corepack pnpm check` now passes.
- The touched interaction contract test no longer uses `as any`; it uses an explicit minimal context shape with an `unknown` bridge to the production function parameter type.

Validation after this small repair:

| Command | Result |
|---|---|
| `corepack pnpm check` | PASS |
| `corepack pnpm exec tsc --noEmit` | PASS |
| `corepack pnpm --filter @linghun/tui exec vitest run src/model-loop-runtime.test.ts src/shell/view-model.test.ts src/shell/models/tui-interaction-contract.test.ts src/shell/components/composer-dispatch.test.ts src/index.test.ts` | PASS, 912 tests |
| `corepack pnpm --filter @linghun/tui build` | PASS |
| `git diff --check` | PASS |

Workflow/agent truthfulness remains proposal-only:

- No workflow/agent execution bridge was implemented.
- No report text claims that a workflow or agent route ran.
- Natural workflow/agent text remains a command proposal path unless a future phase implements a real execution bridge with permissions, evidence, and final-gate support.

## Not Implemented

- No true natural-language workflow/agent execution bridge was implemented. This pass intentionally chose route A because route B would require reusing `/fork` / `/job` / `/agents`, Start Gate, permissions, evidence, and final gate end-to-end; that is larger than a restraint/layout closure.
- No provider, model route, env, key, MCP server, dependency, release, or permission-policy relaxation was changed.
- No new task list renderer was introduced.
- `.claude/` was not touched.

## Handoff

Next recommended step: review the diff and decide whether this closure should be staged/committed.

Do not:

- Do not add a second scheduler/runtime/job store/agent executor.
- Do not claim workflow/agent natural proposals are running or done unless a real execution bridge is implemented.
- Do not move task progress back into the footer.
- Do not expose `sourceRef`, gate retry text, debug/schema/raw evidence, or runtime prompt dumps in primary output.
- Do not commit or stage unless explicitly asked.
