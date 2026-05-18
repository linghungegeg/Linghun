---
title: Phase 15 pre-Beta Source-level CCB Runtime / Output / Permission Parity Closure
status: pre-beta-closure
phase: 15-pre-beta
created: 2026-05-18
scope: CCB source oracle inventory, Linghun mapping, minimal source fixes; not Phase 15 Beta / 15.5 / 16+
---

# Phase 15 pre-Beta Source-level CCB Runtime / Output / Permission Parity Closure

本报告记录本轮 `Source-level CCB Runtime + Output + Permission Parity Closure`。本轮只参考 `F:\ccb-source` 的行为链路、输出层级、权限语义、错误恢复和验收标准；未复制 CCB / Claude Code / OpenCode 源码、内部 API、专有实现或补丁代码。

## 1. CCB Runtime Workflow Inventory

| id | CCB 源码路径 | CCB 行为摘要 | 用户可感知手感 / 主屏 | details/debug/log | 权限/安全边界 | 错误/拒绝后继续 | Phase 00-14 / pre-Beta 必需 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RT-01 | `src/utils/processUserInput/processTextPrompt.ts` | prompt id、用户消息、附件/图片元数据、keep-going/negative 分类 | 普通输入立即成 turn；附件像普通上下文 | prompt 长度、trace、telemetry | 携带 permission mode 元数据，不做工具审批 | 返回 query，错误由上层处理 | 必需 |
| RT-02 | `src/utils/processUserInput/processUserInput.ts` | prompt/bash/slash/bridge-safe/hook/attachment 路由 | slash、bash、附件、普通聊天分流清楚 | profiler、hook 结果、附件处理日志 | bridge-safe、workspace trust、hook 可阻断 | hook block/prevent-continuation 停止或注入上下文 | 必需 |
| RT-03 | `src/utils/handlePromptSubmit.ts` | busy queue、interrupt、local JSX command、query guard、批处理 | 忙时可排队；部分本地命令即时打开 | interrupt/queue/command debug | QueryGuard 防并发主查询 | finally 释放 guard，失败不污染下一轮 | 必需 |
| RT-04 | `src/screens/REPL.tsx` | Ink REPL 状态、流式消息、permission queues、MCP elicitation、sandbox queue | 像成熟终端产品：状态、spinner、prompt、permission 聚合 | query profile、API metrics、diagnostics | central UI permission/sandbox/hook boundary | reset loading / abort / restore prompt | 必需 |
| RT-05 | `src/query.ts` + `REPL.tsx` | model query loop、stream、tool use/result、compaction | assistant 流式输出，工具状态渐进 | API metrics、tool/classifier/hook timings | `canUseTool` + ToolUseContext | 异常后 finally reset，tool failure 回灌 | 必需 |
| RT-06 | `src/Tool.ts` | Tool 契约：schema、validate、permission、render、progress、interrupt、group/truncate | 工具行为统一，不像 raw JSON | tool metadata、progress、classifier summaries | per-tool checkPermissions + mode/rules | reject/error/cancel 都成 tool result | 必需 |
| RT-07 | `src/tools.ts`, `src/constants/tools.ts`, builtin tools | built-in/MCP/deferred tools 合并，deny 预过滤，稳定排序 | 工具集随模式/feature/MCP 变化但稳定 | cache-stable tool list / MCP metadata | deny rules 隐藏工具；subagent allowlist | disabled/missing 不暴露给模型 | Phase 00-14 核心必需；deferred 完整性后续 |
| RT-08 | `src/commands.ts` | command registry 合并内建、skills、plugins、workflows、MCP skills | `/help` 和 typeahead 反映当前环境 | skill/plugin load failure debug | feature/auth/provider/remote-safe gating | 加载失败降级为空 | 必需 |
| RT-09 | `src/utils/hooks.ts` | lifecycle hooks，timeout，并行，JSON decision/block/context | hook 进度/阻断可见但不混主输出 | stdout/stderr/exit/duration/OTEL | workspace trust、disableAllHooks、exit code/JSON block | non-blocking error 继续，blocking 停止 | Phase 14/15 必需 |
| RT-10 | `src/utils/sessionStorage.ts` | JSONL transcript、resume、parent chain、file history、metadata | resume/branch/compact 有连续性 | sidecars、context collapse、attribution | 50MB cap、路径 sanitization、progress exclusion | corrupt optional metadata skipped | Phase 02/11 必需 |
| RT-11 | `src/cli/print.ts`, `structuredIO.ts` | print/SDK/headless structured IO | 非交互输出机器可读 | control request lifecycle | pending request / closed input handling | closed input rejects pending permission | Phase 00-14 部分；headless 完整 UI 后续 |
| RT-12 | `docs/ccb-optimizations.md` | cache/index/MCP 稳定化、cache-log、break-cache、large-file scan | cache/index 健康可见且不刷屏 | cache history、break-cache diff、index health | large-file safe gate、MCP schema stability | warning 不阻断普通聊天，unsafe index safe-fail | Phase 09/10/15 必需 |
| RT-13 | `Tool.ts`, `searchExtraTools.ts`, `tools.ts` | deferred tool discovery-before-execute | 大工具集保持轻，先发现再执行 | deferred metadata | 未发现工具不可直接执行 | ExecuteExtraTool 失败转 tool error | Phase 14/15 部分；完整 marketplace 后续 |
| RT-14 | `handlePromptSubmit.ts`, `REPL.tsx` | prompt queues、background/fork/autonomy | 可继续输入，后台结果稍后回报 | hidden result prompt、task logs | QueryGuard + background abort isolation | background failure 生成 failure result | Phase 12/14 必需，完整 team 后续 |

## 2. CCB Output Rendering Inventory

| id | CCB 源码路径 | 行为摘要 | 主屏显示 | details/debug/log | 权限/安全边界 | 错误/拒绝继续 | 必需性 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OUT-01 | `components/messages/AssistantTextMessage.tsx` | assistant Markdown 与 API error 特化 | 正常 prose；错误短且可操作 | verbose 展开长 API error | 不渲染内部空标记 | abort/rate/error 变清晰消息 | 必需 |
| OUT-02 | `AssistantThinking*`, `System*`, `RateLimitMessage.tsx` | thinking/system/rate 独立组件 | 非普通 assistant 的视觉区分 | verbose/transcript 更多诊断 | display-only | 错误不崩 UI | 部分必需 |
| OUT-03 | `AssistantToolUseMessage.tsx`, `Tool.ts` | tool use chrome、queued/progress/permission waiting | 工具名 + 短摘要 + loader | renderer error logging | schema parse/unknown tool guard | queued/waiting/error 状态独立 | 必需 |
| OUT-04 | `UserToolResultMessage/*` | success/error/reject/cancel dispatch | tool-specific result，不刷 raw JSON | hook progress、schema validation | corrupt output 不崩 | reject/error/cancel 可继续 | 必需 |
| OUT-05 | `GroupedToolUseContent.tsx` | parallel tool grouping | 多个同类工具合并摘要 | per-call status | display-only | 单项失败独立呈现 | 推荐/后续 |
| OUT-06 | `HookProgressMessage.tsx` | hook progress 在 tool 前后显示 | hook 不混入工具 stdout | verbose/transcript | hook 安全在 runtime | hook error 独立显示 | Phase 14 必需 |
| OUT-07 | `Tool.ts` | render use/result/progress/error/reject/truncate contract | 每个工具自己决定摘要 | search text extraction / verbose | read-only/destructive/permission | fallback error/reject | 必需 |
| OUT-08 | `PermissionPrompt.tsx` | select prompt、Esc cancel、Tab feedback | question + choices + hint | analytics/feedback mode | UI 不决定 policy | cancel/reject/allow 回调 | 必需 |
| OUT-09 | `PermissionRequest.tsx` | 按工具路由 permission UI | Bash/Edit/Write/Plan 等专用弹窗 | OS notification/debug | Ctrl-C reject、updated input | reject/onDone | 必需 |
| OUT-10 | `BashPermissionRequest/*` | Bash command、sandbox/destructive/classifier/rule | 命令、说明、风险、allow/reject | permission debug toggle | sandbox/destructive/rules | allow once/rule/reject feedback | 必需 |
| OUT-11 | `FileEditPermissionRequest`, `FileWritePermissionRequest`, `FilePermissionDialog` | diff/content preview 审批 | 像 review patch | IDE diff/symlink info | symlink/write rules | reject 展示被拒 diff | 必需 |
| OUT-12 | `FallbackPermissionRequest` | unknown/simple tool fallback prompt | coherent prompt | decision explanation | 所有工具仍过 policy | reject/cancel stop | 必需 |
| OUT-13 | `BashTool/UI.tsx` | Bash use line truncates 2 lines/160 chars | 长命令不刷屏 | verbose full command | display-only | incomplete input null | 必需 |
| OUT-14 | `ShellProgressMessage.tsx` | Bash live tail 5 lines + timer/timeout | 有进度但有界 | verbose full progress | timeout/background aware | no output shows running | 必需 |
| OUT-15 | `BashToolResultMessage.tsx` | stdout/stderr terminal-aware truncation | stdout/stderr bounded；空输出有语义 | verbose/full output | sandbox tags hidden from UI | nonzero/error 不崩 | 必需 |
| OUT-16 | `LocalShellTask` | background shell hint/result | 长命令可后台 | task logs | env 可禁用 | background 继续 | 部分必需 |
| OUT-17 | `FileReadTool/UI.tsx` | Read 主屏只摘要 N lines/media | 不把文件内容刷主屏 | model/transcript 有内容 | read-only/path/size/PDF guard | error concise | 必需 |
| OUT-18 | `readFileInRange.ts`, `CollapsedReadSearchContent.tsx` | Read offset/limit/size/media truncation | summary only | full model content | huge/binary/device guard | 建议 targeted read/search | 必需 |
| OUT-19 | `GrepTool/UI.tsx` | Grep count summary，verbose 展开 | Found N，不默认列全 | content/list in verbose | read-only/path ignore | no match/error concise | 必需 |
| OUT-20 | `GrepTool.ts` | head_limit/offset pagination | truncation 不是错误 | model content has notices | default limit guard | refine/page | 必需 |
| OUT-21 | `GlobTool/UI.tsx` | Glob reuse search summary | Found N files | filenames verbose/model | dir/path validation | no files concise | 必需 |
| OUT-22 | `FileEditTool/UI.tsx`, `StructuredDiffList.tsx` | Edit diff stats/structured diff | Added/removed + diff | verbose path/diff | stale/secret/path guard | errors concise | 必需 |
| OUT-23 | `FileEditToolUseRejectedMessage.tsx` | rejected edit diff/content | 用户知道被拒内容 | verbose more content | denial boundary | model can adjust | 必需 |
| OUT-24 | `FileWriteTool/UI.tsx` | create preview 10 lines/update diff | new file 不刷完整内容 | verbose full create | write/stale/secret guard | rejected preview | 必需 |
| OUT-25 | `FallbackToolUseErrorMessage.tsx` | generic error 10-line cap + expand hint | red compact error | verbose full | hides sandbox internals | unknown error 不崩 | 必需 |
| OUT-26 | `CtrlOToExpand.tsx` | central expand affordance | `ctrl+o` hint | transcript expansion | display-only | n/a | pre-Beta 推荐 |
| OUT-27 | `StatusLine.tsx`, `BuiltinStatusLine.tsx` | model/context/cost/rate/status line | footer operational awareness | command JSON input | display-only | command fail ignored | 必需（简化可接受） |
| OUT-28 | `StatusLine.tsx`, `hooks.ts` | custom status command non-blocking | stdout as status row | command stderr/debug | trust/disable hooks | error ignored | 后续 |
| OUT-29 | `cacheStats*.ts`, `docs/ccb-optimizations.md` | cache pill/read/write/TTL/warnings | cache 健康可见 | history state | advisory | missing placeholder | Phase 09/15 必需 |
| OUT-30 | `indexHealth.ts` | index stale/.cbmignore warning | gentle warning | docs thresholds | advisory only | swallow errors | Phase 10/15 必需 |
| OUT-31 | `commands/doctor/*` | doctor panel | health-check UI | diagnostics | local only | close returns | 必需（文本化可接受） |
| OUT-32 | `commands/help/*` | help panel/list | command discovery | registry source | local only | close returns | 必需 |
| OUT-33 | `commands/mcp/*`, `components/mcp/*` | MCP settings/toggle/reconnect | control-plane not model text | MCP logs/schema stability | enable/disable policy | not found/already state text | Phase 10/15 必需 |
| OUT-34 | `commands/break-cache/*` | break-cache once/always/off/status | explicit cache control | JSONL event log | can disable cache, warns | bad args usage | Phase 09/15 必需 |
| OUT-35 | `commands/cache-log/*` | recent cache history table/panel | avg/trend/rows | ring buffer | read-only | empty state | Phase 09/15 必需 |
| OUT-36 | `debug.ts`, `log.ts`, `PermissionDecisionDebugInfo.tsx` | debug off-main-screen | clean default UI | toggled/log files | display-only | logging failure ignored | 必需 |
| OUT-37 | `cli/print.ts`, `structuredIO.ts` | headless/SDK safe output | text/json/events | NDJSON safe stringify | structured permission | reject closed input | 部分/后续 |
| OUT-38 | `messages/User*`, `AttachmentMessage.tsx` | user/slash/bash/attachment distinct rendering | transcript intent 清楚 | shell expansion | local shell user-driven | output not tool failure | 必需 |
| OUT-39 | `CompactBoundaryMessage`, `PlanApprovalMessage` | compact/snip/plan/task markers | session milestones | boundary details | display-only | supports continuation | 部分必需 |

## 3. CCB Permission & Continuation Inventory

| id | CCB 源码路径 | 行为摘要 | 主屏 | details/debug/log | 权限/安全边界 | 拒绝/错误后继续 | 必需性 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PERM-01 | `components/permissions/PermissionPrompt.tsx` | allow/reject/cancel/feedback primitive | choices + Esc/Tab hint | feedback analytics | UI-only policy boundary | onCancel/onSelect | 必需 |
| PERM-02 | `PermissionRequest.tsx` | per-tool request router | 专用 prompt | notification/debug | Ctrl-C reject | reject/onDone | 必需 |
| PERM-03 | `utils/permissions/permissions.ts` | permission mode/rules/policy utilities | 不直接显示 raw policy | permission decision data | default/plan/auto/bypass/rules | deny feeds model/tool result | 必需 |
| PERM-04 | `Tool.ts` | tool-level validate/checkPermissions | operation-specific ask | validation/permission metadata | read-only/destructive/schema | reject render + tool failure | 必需 |
| PERM-05 | `BashPermissionRequest/*` | Bash allow once/rule/reject feedback | command + risk + options | classifier/debug | sandbox/destructive/prefix rules | reject feedback to model | 必需 |
| PERM-06 | `FilePermissionDialog/*` | Edit/Write diff permission | diff/content + choices | symlink/IDE diff | write rules/symlink/stale | reject diff visible | 必需 |
| PERM-07 | `StructuredIO.ts` | headless/SDK permission control_request | machine prompt | pending request lifecycle | closed input rejects | late/duplicate ignored | 部分/后续 |
| PERM-08 | `hooks.ts` | hooks can allow/deny/ask/block/update input | hook prompt/progress | stdout/stderr/JSON decision | trust + timeout | blocking stops, non-blocking continues | Phase 14/15 必需 |
| PERM-09 | `REPL.tsx` | permission/sandbox/elicitation queues | focused dialogs | queues/state | central UI boundary | deny/cancel returns tool failure | 必需 |
| PERM-10 | `commands.ts`, bridge-safe sets | Start Gate/bridge-safe command boundary | safe commands local; unsafe blocked | debug logs | remote/bridge allowlist | unsafe not executed | Phase 15 必需 |
| PERM-11 | `Tool.ts`, `tools.ts` | deny rules remove tools before model sees them | absent tools not offered | tool list metadata | deny before execution | missing tool error if attempted | Phase 06/15 必需 |
| PERM-12 | `docs/ccb-optimizations.md`, index utils | index large-file safe gate | summary warning | full risk list/log | `.cbmignore` / large file gate | repair/force explicit | Phase 10/15 必需 |

## 4. Inventory completeness check

- `processUserInput / handlePromptSubmit / REPL`：覆盖 RT-01~RT-05、PERM-09，包含普通输入、slash/bash、队列、interrupt、permission queue、model query loop。
- commands registry：覆盖 RT-08、OUT-31~OUT-35、PERM-10，包含内建命令、skills/plugins/workflows、bridge-safe/remote-safe。
- Tool contract and tools directory：覆盖 RT-06~RT-07、OUT-03~OUT-25、PERM-04~PERM-06、PERM-11。注：本地 CCB checkout 无 `src/tools/` 目录，等价实现位于 `packages/builtin-tools/src/tools/` 与 `src/tools.ts`。
- permission components and policy：覆盖 OUT-08~OUT-12、PERM-01~PERM-09。
- message rendering components：覆盖 OUT-01~OUT-07、OUT-13~OUT-26、OUT-38~OUT-39。
- StatusLine：覆盖 OUT-27~OUT-30。
- hooks/session/context：覆盖 RT-09~RT-10、OUT-06、PERM-08。
- `docs/ccb-optimizations.md` cache/index/MCP：覆盖 RT-12、OUT-29~OUT-36、PERM-12。

## 5. OUT_OF_SCOPE / not-do

| CCB 能力 | 为什么 Linghun 当前不做 | 阶段 |
| --- | --- | --- |
| 完整 Ink/React TUI 组件化重写、虚拟列表、focus 管理 | 当前只允许 Phase 15 pre-Beta 最小源码级修复；大 UI 重写超范围 | Phase 15.5 / later |
| 完整 permission modal（allow always、modify params、IDE diff、feedback-rich） | 本轮只修主屏 raw 字段、summary-first、fail-closed continuation；完整 modal 是结构性 UI 工作 | Phase 15.5 |
| 完整 deferred tools / plugin marketplace / GitHub install | Phase 14 只声明本地 loader/hardening；市场属于后续开放生态 | Phase 15.5 / 16+ |
| Remote bridge / desktop / long-running daemon / mobile control | 当前不得进入 Phase 16+ / 17 / 18 | Phase 16+ / 17 / 18 |
| Native broad provider ecosystem / quota/billing reconciled doctor | 当前只闭合 Phase 00-14 声明和 pre-Beta handfeel；完整接入成熟度已有 Phase 15.5 | Phase 15.5 |
| Full team/autonomy/job scheduler | Phase 12/14 只需 agent/workflow 主闭环；长期自治后置 | Phase 17 |
| Full interactive expand/collapse details panel | 当前用 summary + evidence/log/status command，完整 UI polish 后置 | Phase 15.5 |

## 6. Linghun Phase 00-14 declared capability cross-check

| capability | declared Phase | CCB inventory coverage | Linghun source/tests coverage | status after this round |
| --- | --- | --- | --- | --- |
| TUI / REPL | 04 | RT-01~RT-05, OUT-01/38 | `packages/tui/src/index.ts`, `index.test.ts` | PASS for pre-Beta text REPL, not full CCB UI |
| tools | 05 | RT-06~RT-07, OUT-03~OUT-25 | `packages/tools/src/index.ts`, `tool-output-presenter.ts` | PASS for core tools summary-first; full CCB tool lifecycle OUT_OF_SCOPE |
| permissions / Plan | 06 | PERM-01~PERM-12 | `decidePermission()`, `permission-presenter.ts` | PASS for safety + human primary prompt; full modal OUT_OF_SCOPE |
| behavior guardrail / evidence | 07 | RT-10, OUT-36, PERM-12 | evidence records / transcript | PASS |
| verification | 08 | OUT-36, status/report pattern | `/verify`, verification tests | PASS for declared runner |
| cache/cost | 09 | RT-12, OUT-29/34/35 | cache/status/tests | PASS for summary/status; richer CCB panel OUT_OF_SCOPE |
| MCP/index | 10 | RT-12, OUT-30/33/36, PERM-12 | index safety, status, MCP summary | PASS after this round for summary-first safety blocker and repair continuation |
| sessions/memory | 11 | RT-10, OUT-39 | SessionStore, handoff/memory commands | PASS for declared closure |
| agents | 12 | RT-14 | `/agents`, `/fork`, background state | PASS for declared closure; full autonomy OUT_OF_SCOPE |
| multi-model | 13 | RT-05, OUT-27 | provider/model route doctor/status | PASS for declared route/status |
| skills/workflow | 14 | RT-08/09, OUT-06/33, PERM-08/10 | catalog, workflow, hooks, plugins | PASS for local loader/hardening |

## 7. Linghun mapping / parity table

| inventory group | Linghun path | current behavior before fix | verdict before | root cause | fix/test this round | verdict after |
| --- | --- | --- | --- | --- | --- | --- |
| PERM-01~06 | `packages/tui/src/permission-presenter.ts`, `index.ts` | primary prompt exposed `decision:`, `risk:`, `mode:` | FAIL | engineering fields leaked to main screen | prompt now human-first: tool/reason/safety/scope/current mode; tests assert no raw labels | PASS |
| OUT-13~15 | `tool-output-presenter.ts`, `index.test.ts` | Read/Grep/Glob/Todo layered; Bash final presenter could still preview too much if tool not marked truncated | PARTIAL | Bash preview threshold lived in tool layer and could pass long but non-truncated text | presenter adds Bash primary preview limit + full log/evidence; regression test | PASS |
| RT-12 / OUT-30 / PERM-12 | `index.ts` index safety | safety blocker main screen listed full risk paths and then `/index status` repeated details after continuation | FAIL | safety warning used same text for primary and evidence; success path printed full status | primary/detail split; evidence keeps full risky list; success prints short summary and points to `/index status` | PASS |
| RT-03 / PERM continuation | `handleNaturalInput()` | pending local approval already separated from Start Gate, but yes-after-write printed full status | PARTIAL | continuation success reused `formatIndexStatus()` | replaced with `formatIndexRefreshSummary()`; no-deny path unchanged | PASS |
| OUT-29~35 | cache/MCP/model doctor/status/help/error | local text summaries exist | PARTIAL/PASS | no full CCB panel; Phase 00-14 only requires summary-first textual surface | existing tests cover model doctor/cache/MCP/status/help; no scope expansion | PASS for pre-Beta, OUT_OF_SCOPE for full panel |

## 8. Source root causes closed this round

1. `permission-presenter.ts` formatted primary permission prompts with raw field labels `decision/risk/mode`, which violated CCB-style human-first permission handfeel.
2. `formatIndexSafetyWarning()` used one verbose message for both primary output and evidence, so large/risky file lists leaked into the main screen.
3. index safety repair continuation printed full `formatIndexStatus()` immediately after successful refresh, causing repeated control-plane detail output; CCB-style behavior should show short success and make `/index status` the explicit detail view.
4. Bash output layering was not enforced in the presenter, leaving summary-first dependent on the tool’s own preview/truncated flag.

## 9. Actual fix files

- `packages/tui/src/permission-presenter.ts`
- `packages/tui/src/tool-output-presenter.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `docs/audit/phase-15-pre-beta-source-level-runtime-output-permission-parity.md`
- `docs/delivery/phase-15-natural-command-bridge.md`
- `docs/delivery/README.md`
- `START_NEXT_CHAT.md`

## 10. 为什么不是关键词补丁/文案补丁

- 本轮先从 CCB runtime/output/permission 源码路径抽 inventory，再映射 Linghun Phase 00-14 声明能力。
- 修复的是 presenter 层级、primary/details/evidence 分流、permission 主屏字段边界、Bash output primary limit 和 index continuation success policy，不是只改固定 seed 文案。
- 测试断言行为边界：raw 字段不得进入主屏、风险清单只进 evidence、成功后只短摘要、Bash 长输出通过 presenter 截断。

## 11. Seed cases status

| seed case | status |
| --- | --- |
| “请帮我排除大文件并更新索引”主屏不输出完整风险文件清单 | PASS |
| warning + Index status 重复刷屏 | PASS for continuation success; explicit `/index status` still shows details |
| permission prompt 主屏不含 raw `decision:` / `risk:` / `mode:` | PASS |
| yes 后只输出短成功摘要；完整 status 通过 `/index status` | PASS |
| `/index status` 可显示详情 | PASS |
| evidence/transcript 保留完整风险文件列表 | PASS via `recordIndexEvidence(... supportsClaims=risky_file:*)` |
| no 不写、不刷新 | PASS existing + updated prompt test |
| 普通开发请求不被控制面抢走 | PASS existing Natural Command Bridge tests |
| Read/Grep/Glob/Bash/Todo/Write/Edit summary-first | PASS for declared presenter coverage |
| model doctor/cache/MCP/status/help/error 至少一项成熟度回归 | PASS existing focused tests |
| pending Start Gate 与 pending permission continuation 不互相覆盖 | PASS existing tests |
| 中英文关键路径 | PASS existing zh/en index repair + NCB tests |

## 12. Current verdict

- Phase 00-14 CCB runtime parity: PASS for declared Phase 00-14/pre-Beta surface; full CCB Ink/runtime depth remains OUT_OF_SCOPE.
- Phase 00-14 CCB output parity: PASS for declared Phase 00-14/pre-Beta summary-first surface after fixes; full component UI remains OUT_OF_SCOPE.
- Phase 00-14 CCB permission parity: PASS for safety/fail-closed/human primary prompt after fixes; full permission modal remains OUT_OF_SCOPE.
- Phase 15 real-project Beta readiness: PARTIAL until required validation and independent verification finish and user explicitly decides whether to resume real TUI smoke. This report does not enter Phase 15 Beta.

## 13. Reference check

Read Linghun docs/source: comparison report, START_NEXT_CHAT, implementation spec, phased blueprint, Phase 15 delivery doc, reference map, TUI index, NCB, index safety repair, permission/tool/runtime presenters, tools, providers.

Read/inspected CCB source behavior: processUserInput/processTextPrompt, handlePromptSubmit, REPL, commands registry, Tool contract, builtin tools, messages, permission components/policy, StatusLine, hooks, sessionStorage, CLI, `docs/ccb-optimizations.md`.

No CCB/Claude Code/OpenCode source, internal API, proprietary implementation or patch code was copied.
