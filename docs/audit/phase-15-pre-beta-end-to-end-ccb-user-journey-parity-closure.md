# Phase 15 pre-Beta End-to-End CCB User Journey Parity Closure

> Scope: Phase 00-14 + Phase 15 pre-Beta handfeel gate only. This is not Phase 15 Beta, not Phase 15.5, and not Phase 16+.
>
> Reference boundary: CCB behavior, user journeys, output boundaries, permission boundaries, and acceptance patterns were reviewed from local `F:\ccb-source` source/docs. No CCB / Claude Code / OpenCode source, private APIs, variable structures, or proprietary implementation were copied.

## 1. Pre-repair CCB user journey matrix and Linghun gap table

Index status before exploration:

- `F-Linghun`: ready, 1032 nodes / 1922 edges.
- `F-ccb-source`: ready, 32905 nodes / 94694 edges.

CCB evidence references used for behavior extraction include:

- `F:\ccb-source\src\commands.ts`
- `F:\ccb-source\src\main.tsx`
- `F:\ccb-source\src\components\StatusLine.tsx`
- `F:\ccb-source\src\components\BuiltinStatusLine.tsx`
- `F:\ccb-source\src\components\Messages.tsx`
- `F:\ccb-source\src\components\permissions\PermissionPrompt.tsx`
- `F:\ccb-source\src\components\permissions\FileWritePermissionRequest\FileWritePermissionRequest.tsx`
- `F:\ccb-source\src\components\permissions\FileEditPermissionRequest\FileEditPermissionRequest.tsx`
- `F:\ccb-source\src\components\permissions\BashPermissionRequest\BashPermissionRequest.tsx`
- `F:\ccb-source\src\commands\permissions\permissions.tsx`
- `F:\ccb-source\src\commands\mcp\index.ts`
- `F:\ccb-source\src\commands\status\status.tsx`
- `F:\ccb-source\src\commands\statusline.tsx`
- `F:\ccb-source\src\commands\cache-log\index.ts`
- `F:\ccb-source\src\commands\break-cache\index.ts`
- `F:\ccb-source\src\utils\handlePromptSubmit.ts`
- `F:\ccb-source\src\utils\processUserInput\processUserInput.ts`
- `F:\ccb-source\src\utils\permissions\permissions.ts`
- `F:\ccb-source\src\utils\permissions\PermissionMode.ts`
- `F:\ccb-source\packages\builtin-tools\src\tools\BashTool\bashPermissions.ts`
- `F:\ccb-source\packages\builtin-tools\src\tools\AgentTool\built-in\verificationAgent.ts`
- `F:\ccb-source\docs\ccb-optimizations.md`
- `F:\ccb-source\CODE_AUDIT_REPORT.md`

| ID | CCB user journey / behavior summary | Linghun current entry | Pre-repair status | Root cause | Must fix this round | Later phase registration | Validation method |
| --- | --- | --- | --- | --- | --- | --- | --- |
| J01 | Startup/help/status line are summary-first; status line carries model/mode/cache/index hints without dumping diagnostics. | `packages/tui/src/index.ts`, `/help`, `writeStatus`, `formatCompositeStatusQuery` | PARTIAL | `/status` and composite status mostly short, but some control surfaces still exposed raw-like fields. | Yes | No | Journey smoke + existing TUI tests |
| J02 | Ordinary chat and ordinary development requests enter model/tool loop, not control-plane or audit gates. | `handleNaturalInput`, `requestModel`, `createModelSystemPrompt` | PARTIAL | repeated permission denial could trigger Solution Completeness Gate for ordinary tasks. | Yes | No | Focused unit + journey smoke asserts model loop |
| J03 | Project rules/read file/search/glob/todo use tools and show concise tool results; full content stays in transcript/evidence/log. | `/read`, `/grep`, `/glob`, `/todo`, `tool-output-presenter.ts` | PASS | Presenter already truncates Read/Grep/Glob/Todo. | No | No | Existing tool output tests + smoke negative assertions |
| J04 | Bash and verification show progress/short result; long stdout/stderr does not flood main screen. | `/bash`, `/verify`, Bash tool presenter | PASS | Bash presenter has stricter limits. | No | No | Existing tests + journey Bash long-output assertion |
| J05 | Write/Edit requests pause behind readable permission prompt; approval boundary is user-facing, not raw permission object. | `decidePermission`, `permission-presenter.ts`, model tool loop | PARTIAL | prompt still displayed `Current mode`, which reads like raw `mode:` output. | Yes | No | Permission prompt tests |
| J06 | yes/no/pending confirmation is local-state aware; no-pending yes/no does not reach model. | `handleNaturalInput` pending branches | PASS | Existing no-pending confirmation guard present. | No | No | Existing no-pending test + journey smoke |
| J07 | Start Gate and local tool approval are separate from permission pipeline; confirmation text does not expose raw risk/mode fields. | `pendingNaturalCommand`, `pendingLocalApproval`, `formatNaturalStartGate` | PARTIAL | confirmed Start Gate block included raw `Risk:` field. | Yes | No | Focused test assertions |
| J08 | Index init/refresh/status: action success is short; full state belongs to `/index status`; safety repair gives concise next action. | `/index status`, `/index init fast`, `/index refresh`, index safety repair | FAIL | slash `/index refresh` and `/index init fast` printed full `Index status` after success; refresh also printed start/project/mode chatter. | Yes | No | Index refresh tests + journey smoke |
| J09 | Natural-language index refresh / ignore repair continuation follows the same short success path. | NCB route + `handleIndexSafetyRepairContinuation` | PASS | Natural continuation already uses `formatIndexRefreshSummary`. | No | No | Existing tests |
| J10 | Cache, break-cache, stats show status/diagnostic summaries without raw cache keys in main output unless details command is explicit. | `/cache`, `/break-cache`, `/stats` | PASS for Phase 15 | Phase 00-14 scope has summary commands; full advanced panels remain textual. | No | Phase 15.5 can polish panels | Journey smoke |
| J11 | MCP status/doctor shows server status, isolates failures, and avoids full tool schema/raw JSON dump. | `/mcp status`, `/mcp doctor`, `/mcp tools` | PASS | Stable tool list omits full schemas. | No | No | Journey smoke |
| J12 | Model doctor/route/provider fallback shows masked key presence and actionable routing problems, not secret headers/raw JSON. | `/model doctor`, `/model route doctor` | PASS | Key masking and route doctor present. | No | No | Existing tests + journey smoke |
| J13 | Permissions recent/mode is user-inspectable and deletable, but raw denials do not force systemic-gap reports in ordinary tasks. | `/permissions recent`, `recentDenied`, SCG trigger | FAIL | repeated denial was treated as `systemic_gap/blocking_P1`. | Yes | No | Focused SCG test update |
| J14 | Workflows/skills/plugins/hooks are discoverable, load-on-demand, and gated before execution. | `/skills`, `/workflows`, `/plugins`, `/doctor hooks`, NCB Start Gate | PASS | Phase 14 load-on-demand and Start Gate behavior present. | No | No | Existing tests + smoke coverage |
| J15 | Sessions/resume/branch/handoff are visible and do not dump full transcripts by default. | `/sessions`, `/resume`, `/branch`, handoff packet | PASS | Handoff summaries are structured. | No | No | Existing tests + smoke |
| J16 | Agents show lightweight status and keep subagent work from polluting main chain. | `/agents`, `/fork`, background task state | PASS for Phase 00-14 | Agent summaries/status exist; full lifecycle UI polish later. | No | Phase 15.5 optional polish | Existing agent tests |
| J17 | Error recovery/interrupt is short, actionable, and lets user continue. | `/interrupt`, `formatError`, active abort controller | PASS | Interrupt and error formatter present. | No | No | Existing tests |
| J18 | Long output truncation applies consistently to Bash/Read/Grep/Glob/Todo. | `tool-output-presenter.ts` | PASS | Presenter limits by tool category. | No | No | Existing tests + smoke |
| J19 | Internal evidence/transcript/handoff/gate fields must not appear in ordinary assistant main text. | `requestModel`, `appendSystemEvent`, presenters | PARTIAL | system prompt is internal, but permission/Start Gate main text still had raw-like mode/risk labels. | Yes | No | Negative smoke assertions |
| J20 | Report generation tasks are ordinary model/tool-loop work: read/search/write/report with permission approvals, not control-plane takeover. | model loop + Write tool permission | PASS after J02/J05/J13 fixes | Main risk was SCG over-trigger and permission wording. | Yes | No | Journey smoke asserts model loop + Write permission |
| J21 | Verification runner / verifier agent is available for non-trivial changes and produces concise verdict with evidence references. | `/verify`, verifier workflow, external verification agent for this round | PASS | Existing `/verify` plus required independent verifier process. | No | No | Final verification |
| J22 | Provider fallback/route failure is actionable and does not expose secret base URLs/headers beyond masked presence. | `/model route doctor`, provider config summary | PASS | Doctor masks API keys. | No | No | Existing model doctor tests |
| J23 | Control-plane commands default summary-first; details require explicit command. | help/status/cache/model/mcp/index/permissions surfaces | FAIL | index refresh/init success path was not summary-first; permission/Start Gate prompts contained raw-like fields. | Yes | No | Journey smoke negative assertions |
| J24 | CCB-like acceptance uses journey smoke, not only unit tests. | No single E2E handfeel smoke before this round | FAIL | Existing tests were focused but not a continuous journey. | Yes | No | New journey smoke test |

Pre-repair FAIL/PARTIAL list: J01, J02, J05, J07, J08, J13, J19, J20, J23, J24.

## 2. Repair plan executed after gap table

Root causes targeted in this closure:

1. Index refresh/init success path reused full `formatIndexStatus()` instead of a short action summary.
2. Index refresh printed extra start/project/mode and final nodes/edges chatter before the final summary.
3. Permission prompts included raw-like `Current mode` fields on the main screen.
4. Start Gate confirmation displayed raw-like `Risk` field on the main screen.
5. Repeated permission denial triggered Solution Completeness Gate as `systemic_gap/blocking_P1`, contaminating ordinary development tasks.
6. No continuous journey smoke existed to assert the default main screen handfeel.

## 3. Post-repair result

Repair status after the Phase 15 pre-Beta end-to-end CCB user journey parity closure:

- Matrix coverage: 24 user-journey rows (J01-J24), covering startup/help/status line, ordinary chat/dev flow, project rules/read/search/glob/todo, Bash/verification, Write/Edit permission prompts, yes/no pending confirmation, index init/refresh/status/safety repair, cache/break-cache/stats, MCP/model/permissions controls, workflows/skills/plugins/hooks, sessions/agents/error recovery, long-output truncation, internal evidence boundaries, and report-generation tasks.
- Pre-repair FAIL/PARTIAL rows closed in this round: J01, J02, J05, J07, J08, J13, J19, J20, J23, J24.
- Fixed root causes:
  - `/index init fast` and `/index refresh` now return short action summaries and point users to `/index status` for the full status surface.
  - Index refresh progress no longer prints project/mode/raw nodes/edges chatter in the success path.
  - Permission prompts no longer print raw-like `Current mode` in the primary user-facing prompt.
  - Start Gate confirmation no longer prints raw-like `Risk` or gate ids in the primary confirmation block.
  - Repeated permission denial records evidence/state but no longer forces ordinary development requests into `systemic_gap` / `blocking_P1` Solution Completeness Gate output.
  - Bash live progress is bounded in the main view; full output remains in transcript/log/fullOutputPath and final summary output remains truncated.
  - Slash tool results now pass the recorded evidence id into the user-facing tool presenter, preserving concise evidence references without dumping raw records.
- New acceptance coverage: `packages/tui/src/index.test.ts` adds a continuous Phase 15 pre-Beta CCB user journey smoke covering help, index status/refresh, no-pending confirmation, ordinary model loop, Write permission denial/allow/success, Bash long output, model/MCP/cache/permissions/index controls, evidence references, and negative assertions for raw fields and gate contamination.
- Later-stage registration: no new Phase 15.5 / Phase 16+ item was created by this closure; existing non-blocking polish and future capability work remain in their already registered later phases.

This closure did not enter Phase 15 Beta, Phase 15.5, Phase 16+, or GUI/desktop work. CCB / Claude Code / OpenCode source, internal APIs, variable structures, private implementations, and decompiled traces were not copied; only behavior boundaries and acceptance patterns from local `F:\ccb-source` references were used.
