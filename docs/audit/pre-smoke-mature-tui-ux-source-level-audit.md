# Pre-Smoke Mature TUI UX Source-Level Audit

## 状态声明

- 本轮性质：Pre-Smoke Mature TUI UX Source-Level Audit（只读审计 + 成熟度方案报告）。
- 本轮不做 runtime 代码实现。
- 本轮不做 TUI 美化代码。
- 本轮不提交 commit。
- 本轮不宣布 Beta PASS / smoke-ready / open-source-ready。
- 本轮不进入真实 smoke。
- 本轮不进入 Phase 18 / 桌面端 / 开源发布。
- 本轮按硬边界执行：不复制 CCB/OpenCode/Warp/第三方源码，不新增 agent，不新增第二套系统。

---

## 1. Executive Verdict

**Verdict: CONDITIONAL — 不可直接进入真实 smoke；TUI Polish 实现可在修复 P0/P1 后按批次启动。**

### 是否可进入 TUI Polish 实现

**条件可进入**，但必须先关闭以下 P0 blocking items：

| P0 | 区域 | 说明 |
| --- | --- | --- |
| P0-1 | Runtime Status Line | 状态栏不显示模型名。用户主状态看不到当前模型（如 `gpt-5.5`），只能通过 `/model` 查看。CCB 行为基线是状态栏显示模型名。 |
| P0-2 | /help 分组与可扫读 | `/help` 输出两份平铺列表（formatCatalogHelp + formatHelp），无分组、无折叠、无可扫读层级。41 条命令全部展开，窄终端下不可用。 |
| P0-3 | Unknown Command Similar Suggestions | 未知命令只返回 "未知命令：xxx。输入 /help"，没有 "did you mean /xxx?" 相似建议。CCB 已基于 Fuse.js 实现模糊匹配 + 相似命令建议。 |
| P0-4 | Slash Command Typeahead | 无命令发现/自动完成机制。用户必须精确记忆或读取 /help。CCB 在输入 `/` 后有分类建议（recently used / builtin / user / project）。 |
| P0-5 | Workspace Trust | 无新仓库 trust/untrusted 边界。CCB 在首次进入项目时弹出 TrustDialog，检查 MCP/hooks/Bash/API key helper/危险环境变量等，用户必须显式 trust 或退出。 |

### 是否存在 smoke 前 blocking P1

| P1 | 区域 | 说明 |
| --- | --- | --- |
| P1-1 | First-run Language Picker | 无首次启动语言选择。当前默认 zh-CN，切换后仅存内存，不持久化。 |
| P1-2 | Home/Start Screen | 启动屏仅标题 + 状态行 + intro + 可选 LINGHUN.md hint。无项目名、无会话列表、无模型名、无快速入口。 |
| P1-3 | Keyboard Shortcuts / Footer Hints | 无快捷键系统、无 footer 提示。CCB 有 Ctrl+O expand、Esc cancel、Tab feedback、Ctrl+G edit plan 等。 |
| P1-4 | Plan Approval UX 交互 | `/plan` 有 Start Gate，但无 CCB 式的 "Ready to code?" 交互对话框（plan 预览、context 百分比、clear-context/keep-context 选项、Ctrl+G 编辑 plan、sticky footer）。 |
| P1-5 | Error Truncation / Details Expansion | 有 summary-first 截断和 `/details`，但无 "… +N lines (ctrl+o to expand)" 类交互提示。 |

### 明确不是

- 不是 Beta PASS。
- 不是 smoke-ready。
- 不是 open-source-ready。

---

## 2. Source-Level Reality Check

### 2.1 Linghun 当前 existing implementation

| 模块 | 文件 | 实际能力 |
| --- | --- | --- |
| TUI 主循环 | `packages/tui/src/index.ts` (~15226 行) | REPL 主循环、slash command dispatch、model loop、permission pipeline、Start Gate、所有 runtime 逻辑。未经 Batch 4 拆分的高风险内容（model loop、slash router、permission pipeline、runner adapter）仍在此文件。 |
| 自然语言桥 | `packages/tui/src/natural-command-bridge.ts` | Command Capability Catalog 覆盖 40+ 命令；NaturalIntent router 区分 status/doctor/read/usage/risk/howto/execute 七种意图；bridgeSafe 标记控制自然语言直通边界。 |
| 运行时状态 | `packages/tui/src/runtime-status-presenter.ts` | `formatRuntimeStatusLine()` 输出 ~100 字符截断行。当前行模板：`[Linghun] 会话=X · 模式=X · 确认=X · 后台=X`。**不含模型名、provider、cache 命中率、index 状态。** |
| 权限展示 | `packages/tui/src/permission-presenter.ts` | `formatLocalToolPermissionPrompt()` 输出 tool/risk/reason/scope/next 结构化提示；`formatModelToolPermissionPrompt()` 输出简化 prompt。有中英文双语。 |
| 终端就绪 | `packages/tui/src/terminal-readiness-presenter.ts` | `formatTerminalReadinessDoctor()` 输出 13 项 checklist + 5 项 Lite section；`formatTerminalReadinessStatus()` 紧凑摘要；`formatTerminalProblemsPanel()` problems 面板。 |
| 工具输出 | `packages/tui/src/tool-output-presenter.ts` | `formatToolOutput()` 对 Read/Grep/Glob/Bash/Write/Edit/MultiEdit 做 summary-first 截断；Todo 超过 8 条截断。 |
| index runtime | `packages/tui/src/index-runtime.ts` | 索引状态类型、`findCurrentIndexProject`、`createIndexState`。Lightweight。 |
| Remote/MCP | `packages/tui/src/remote-mcp-presenter.ts` | `formatRemoteStatus`、`formatMcpTools` 纯 presenter。 |
| Job/Bg | `packages/tui/src/job-runner-presenter.ts` | Runner doctor、job inline report、background task status、background details。 |
| Compact | `packages/tui/src/compact-context.ts` | MicroCompact（本地清理旧工具结果）+ ManualCompact（创建边界记录）。无 API 调用。 |
| Light Hints | `packages/tui/src/index.ts` `collectLightHints()` | 4 条 hint：cache 命中低、context 长、cache 零写入、changedKeys。有 dedup (hintLastShownAt)。无优先级分层、无 fold/combine。 |

### 2.2 Gaps（对照审计 20 区域）

详见第 3 节对照表。

### 2.3 Minimal Touch Points

Polish 实现的最小触达范围：

- `packages/tui/src/index.ts`：状态栏输出、help 重构、unknown command 建议、home screen 增强、language 持久化、快捷键注册、Plan approval 交互、workspace trust prompt、light hints 优先级。
- `packages/tui/src/runtime-status-presenter.ts`：状态行格式扩展（加模型名/cache/index）。
- `packages/tui/src/natural-command-bridge.ts`：命令发现 typeahead 数据源、slash command registry 分组标记。
- `packages/tui/src/tool-output-presenter.ts`：错误截断 expansion hint。
- `packages/config/src/index.ts`：language 持久化 config schema。
- 新增（如确有必要）：`packages/tui/src/help-presenter.ts`、`packages/tui/src/typeahead.ts`、`packages/tui/src/workspace-trust.ts`。

### 2.4 Forbidden Duplicate Systems

以下不得在 TUI Polish 中新建第二套：
- 权限管道（复用现有 `decidePermission` / `PermissionPromptView`）。
- Provider/model runtime（不得新增 model call 用于 polish）。
- Evidence 系统（不得为 TUI 创建新 evidence store）。
- Index/MCP/Memory/Job 系统（只消费现有状态，不创建新 runtime）。
- 自然语言桥（不在 Polish 中新增 intent routing path）。
- AI Sessions MCP（不得升级为内置强能力）。

---

## 3. 对照表

Area | Reference behavior (CCB/OpenCode/Warp) | Linghun current evidence | Gap | Must do before smoke | Defer/Not-do | Touch points | Tests
--- | --- | --- | --- | --- | --- | --- | ---
1. Home/Start Screen | CCB: 显示 project name、model、session list、resume entry、recent 文件。Warp: 项目名 + 最近 session blocks。 | `index.ts:2113-2118`：仅 `{name} TUI / REPL` 标题 + status 行 + intro + 可选 LINGHUN.md hint。无项目名、无模型名、无会话列表、无快速入口。 | P1-2 | 显示项目名、当前模型名、最近会话入口、/help 短引导。 | NOT-DO: 不实现 CCB 式 session picker UI、不实现 Warp 式 block 面板。 | `index.ts` `runTui()` 启动段 | 快照测试：启动输出包含项目名和模型名。
2. Runtime Status Line | CCB: 状态栏显示 model、mode、bg tasks、cache、index。用户主状态可见模型名。Warp: block header 有 exit code/duration。 | `runtime-status-presenter.ts:16-35`：`formatRuntimeStatusLine()` 只显示 session/mode/gate/bg。**模型名、provider、cache、index 都在 View 数据中但未进入输出行。** | **P0-1** | 状态行必须显示模型名（如 `gpt-5.5`）。provider/baseURL 不进状态行，进 `/model doctor`。 | NOT-DO: 不把完整 endpoint/baseURL/key status 放进状态行。 | `runtime-status-presenter.ts` `formatRuntimeStatusLine()`；`index.ts` `writeStatus()` | 快照回归：状态行包含模型名、不含 provider URL。
3. Model Display | CCB: 状态行显示 "Claude Sonnet 4.6"；`/model` 显示完整路由。规格书要求：主状态只显示模型名，provider/baseURL 进 doctor。 | `index.ts:4336-4338`：`getRuntimeStatusProvider()` 解析 provider；`getSelectedModelRuntime()` 返回 model/provider/endpointProfile。但没有将这些信息放入状态行。`/model` 有路由展示。 | **P0-1 同区域 2** | 模型名进状态行。`/model` 命令保持现有路由详情输出。 | NOT-DO: 不在状态行展示 provider、endpointProfile、reasoningStatus。 | `runtime-status-presenter.ts` | 测试：状态行输出格式含 `model=<name>`。
4. Slash Command Discovery/Typeahead | CCB: `commandSuggestions.ts` 基于 Fuse.js 模糊匹配；输入 `/` 显示分类建议（recently used / builtin / user / project / policy）；prefix 匹配 + alias 匹配；`commandName` weight=3 最优先。 | `natural-command-bridge.ts:113-169`：`SLASH_COMMAND_REGISTRY` 有 43 条命令。**无 typeahead/autocomplete 系统。** 无 Fuse.js 依赖。无 partial command 补全。无输入 `/` 时分类建议。 | **P0-4** | 输入 `/` 后显示分组建议（至少：核心/编辑/索引/MCP/记忆/Agent/诊断/退出）。部分输入时给出 prefix 匹配。 | NOT-DO: 不实现 CCB 的 skill usage tracking、Fuse.js score tuning、MidInputSlashCommand。第一版只做 prefix 匹配 + 分组。 | `index.ts` handleSlashCommand 前置 typeahead hook；或新增 `typeahead.ts` | focused tests: `/`→分组列表；`/mo`→`/model` 候选；`/xyz`→空列表 + unknown command hint。
5. Unknown Command Similar Suggestions | CCB: `generateCommandSuggestions` 返回 Fuse.js 搜索排序结果；exact name > exact alias > prefix name > prefix alias > fuzzy。 | `index.ts:2370-2377`：`Unknown command: ${command}. Type /help to see available commands.` **无 similar suggestion。** | **P0-3** | 未知命令时给出 "did you mean /xxx?" 建议（基于 Levenshtein 或 prefix 匹配）。 | NOT-DO: 不引入 Fuse.js 重依赖；用简单 edit distance 或 SLASH_COMMAND_REGISTRY prefix 搜索。 | `index.ts` `handleSlashCommand()` 的 fallthrough 分支 | focused tests: `/modex`→建议 `/model` 或 `/mode`；`/hel`→建议 `/help`。
6. /help Grouping and Scanability | CCB: `/help` 不直接暴露所有命令；命令通过 typeahead 发现。OpenCode: 帮助按模块分节。Warp: Command Palette 分类搜索。 | `index.ts:13626-13644`：`formatCatalogHelp()` 平铺 43 条命令（filter hidden）。`index.ts:13647-13741`：`formatHelp()` 平铺 43 条命令文本。**/help 输出两个完整列表，无分组，无折叠，窄终端不可用。** | **P0-2** | `/help` 输出分组化命令清单：核心对话 / 编辑 / 索引与 MCP / 记忆与规则 / Agent 与 Job / 诊断与状态 / 退出。每组 ≤12 条。`/help all` 输出完整列表。 | NOT-DO: 不实现 CCB 的 interactive help picker；不实现 Warp Command Palette。 | `index.ts` `formatCatalogHelp()` / `formatHelp()` | snapshot tests：`/help` 分组输出；`/help all` 完整列表。
7. Keyboard Shortcuts / Footer Hints | CCB: `CtrlOToExpand.tsx` 显示 "(ctrl+o to expand)"；`PermissionPrompt.tsx` 显示 "Esc 取消 · Tab 修改"；Ctrl+G 编辑 plan。OpenCode: 快捷键注册系统。 | Linghun: **无快捷键系统、无 footer 提示。** `index.ts` 只有 SIGINT handler (Ctrl+C abort)。 | P1-3 | 至少输出层提示：Ctrl+C 中断、Enter 确认、Esc 取消（在 permission/plan 上下文中）。 | NOT-DO: 不实现 CCB 的 keybinding customization 系统；Ctrl+G/Ctrl+O 桌面端后才考虑。 | `permission-presenter.ts` 增加 footer line；`index.ts` plan 处理段 | focused tests: permission prompt 包含 Esc 提示。
8. Permission / Elevation UX | CCB: `PermissionPrompt.tsx` 显示 options with feedback、Tab to expand feedback input、keybinding 注册、analytics；`PermissionDialog` 有 colored border (planMode/warning)。 | `permission-presenter.ts`：`formatLocalToolPermissionPrompt()` 给出 tool/risk/reason/scope/next；`formatModelToolPermissionPrompt()` 简化 prompt。有中英文双语。**无 visual hierarchy、无 colored border、无 feedback input、无 Tab expand。** | P2 (可 Polish C 处理) | 权限提示的人话化已完成（Phase 15 pre-Beta）。Polish 可增加分层输出：primary prompt + details 中显示完整 permission rules。 | NOT-DO: 不新增 CCB 式 Select 交互组件；Ink 限制下不做 animated 选择器。 | `permission-presenter.ts` | focused tests: prompt 输出不包含 raw decision/risk/mode/gateId。
9. Plan Approval UX | CCB: `ExitPlanModePermissionRequest.tsx` 显示 plan Markdown preview、"Ready to code?" title、clear-context/keep-context 选项、context 使用百分比、Ctrl+G 编辑、sticky footer (fullscreen)、auto-name session。 | `index.ts` `/plan` handler：有 Start Gate、有 plan 选项。**无 plan Markdown preview、无 context 百分比、无 clear-context/keep-context 分层、无 Ctrl+G 编辑、无 sticky footer。** | P1-4 | 至少：plan 短摘要 + "是否继续？" + yes/no 选项 + 执行边界说明。 | NOT-DO: 不实现 CCB 的 sticky footer、Ctrl+G、fullscreen layout、context percentage bar、auto-name session。第一版做 summary-first plan approval prompt。 | `index.ts` `handlePlanCommand()` 和 plan approval 段 | focused tests: plan approve/reject 不绕过 Start Gate。
10. Workspace Trust | CCB: `TrustDialog.tsx` 检查 MCP servers、hooks、Bash permissions、API key helpers、AWS/GCP commands、危险环境变量；显式 "Yes, I trust this folder" / "No, exit"。home dir 只 session trust。 | Linghun: **无 workspace trust dialog。** 仅有 extension trust（skills/plugins/hooks/remote) 的 trustedIds 概念。新项目启动无安全检查。 | **P0-5** | 新项目首次启动时检测：是否有 project-level MCP/hooks/plugins/skills 会自动启用、是否有 Bash 权限、是否有危险的 project config；给出简洁 trust summary 和 `yes`/`exit` 选择。 | NOT-DO: 不复制 CCB TrustDialog 的完整实现、不检查 API key helpers、AWS/GCP commands、otel headers。第一版只检查 project-level extensions 和 Bash 权限。 | `index.ts` 启动段或新增 `workspace-trust.ts` | focused tests: 新项目 trust prompt；已 trust 项目不重复提示。
11. First-Run Language Picker | CCB: 无独立 language picker（默认英文）。Linghun 规格：默认中文友好，支持 `/language zh-CN|en-US` 切换。 | `index.ts:4704-4721`：`handleLanguageCommand()` 支持 `/language zh-CN|en-US`。但 **无首次启动语言选择，切换后仅存内存 context.language，不持久化到 config。** | P1-1 | `/language` 切换持久化写入 config；首次启动若无 config.language，显示短 language hint（中文/English 可选）。 | NOT-DO: 不做 CCB 式 feature flag 控制语言；不做完整 onboarding wizard。 | `index.ts` `handleLanguageCommand()` + `packages/config` schema | focused tests: `/language en-US` 持久化；重启后语言保持；首次启动 language hint。
12. Light Hints Priority/Dedupe/Noise Control | CCB: `notifications.tsx` 有 4 级 priority (immediate/high/medium/low)、timeout、`invalidates` (清除 stale hint)、`fold` (合并同类 hint)、queue 管理。 | `index.ts:10244-10327`：`collectLightHints()` 有 4 条 hint、有 dedup (hintLastShownAt)。**无 priority 层级、无 fold/combine、无 invalidates 机制、无 timeout 控制。** | P2 (可 Polish C 处理) | 当前 dedup 对 smoke 已足够。Polish 可增加 priority 字段和 30s cooldown。 | NOT-DO: 不实现 CCB 的 notification queue/fold/invalidates 完整系统。 | `index.ts` `collectLightHints()` | focused tests: hint 不重复显示；同 dedupeKey 30s 内只出现一次。
13. Error Truncation / Details Expansion | CCB: `FallbackToolUseErrorMessage.tsx` 截断 10 行，显示 "… +N lines (ctrl+o to see all)"。Ctrl+O toggle transcript。 | `tool-output-presenter.ts`：Read/Grep/Glob/Bash/Write/Edit/MultiEdit 做 summary-first 截断。Todo >8 条截断。**无 "… +N lines" 式 expansion hint。** 有 `/details` 但缺少交互式展开提示。 | P1-5 | 截断输出时显示 "… +N 行（通过 /details output <id> 查看完整结果）"。 | NOT-DO: 不实现 CCB 的 Ctrl+O transcript toggle、不实现 Ink interactive expand。 | `tool-output-presenter.ts` `formatToolOutput()` | snapshot tests: 截断输出含 /details 提示。
14. Doctor/Problems Output Hierarchy | CCB: `/doctor` 按子系统分组；problems 面板按 severity 排序。Warp: doctor 输出 block 可折叠。 | `terminal-readiness-presenter.ts`：`formatTerminalReadinessDoctor()` 输出 13 项 checklist + 5 Lite section；`formatTerminalProblemsPanel()` 有 severity 排序。**输出过于冗长：默认 doctor 展开所有 13 项。** | P2 (可 Polish C 处理) | `/doctor` 默认只显示 non-pass 项（≤8 行）+ summary line；`/doctor all` 显示完整 13 项。 | NOT-DO: 不在 doctor 中新增模型调用。 | `terminal-readiness-presenter.ts` | focused tests: `/doctor` 默认只 non-pass；`/doctor all` 显示完成列表。
15. Memory UX / Auto Memory Boundary | CCB: `project-memory.mdx` 描述四类型记忆系统、`findRelevantMemories()` Sonnet 侧查询召回 ≤5 条、`MEMORY.md` 索引。 | Phase 11 + Phase 16 实现：candidate-first、accepted-only injection (topK=3)、no autoAccept、`/memory learn` modelCalled=false、`/memory stats` 展示注入统计。**Memory UX 已成熟。** | 无 P0/P1。 | 无需 smoke 前修改。 | NOT-DO: 不做 CCB Sonnet 侧查询召回；不做 KAIROS 日志模式；不做 TEAMMEM。 | `index.ts` memory handler | 已有 focused tests。
16. Compact / Context UX | CCB: `compaction.mdx` 描述 MicroCompact (本地) + Session Memory Compact (无 API) + 传统 API 摘要三层。CompactBoundary 记录边界。 | `compact-context.ts`：MicroCompact（本地清理旧工具结果、maxChars 阈值）+ ManualCompact（创建边界记录）。**无 auto compact、无 Session Memory Compact、无 API 摘要 compact。** | P2 (可 Polish C 处理) | 当前 MicroCompact + Manual 对 smoke 已足够。 | NOT-DO: 不做 CCB Session Memory Compact；不做 API 摘要 compact。 | `compact-context.ts` + `index.ts` `/compact` handler | focused tests: compact 不执行工具、不写文件。
17. Narrow Terminal + Bilingual Layout | CCB: 不特殊处理窄终端。Warp: block 自适应宽度。Linghun 规格：中文友好、Windows 优先。 | `index.ts:15172-15183`：`truncateDisplay()` 有 CJK 字符 2-width 检测。GB18030 fallback in `decodeInput`。**无窄终端 (<80 列) 自适应测试、无中文/英文混合换行测试。** | P2 (可 Polish D 处理) | 至少 80 列终端 `/help` 不截断到不可读。 | NOT-DO: 不做 Warp 式 block 自适应。 | `index.ts` `truncateDisplay()` + help 输出 | snapshot tests: 80 列 `/help` 输出可读；中文不 mojibake。
18. Windows 中文路径/编码/换行 | CCB: 不特殊处理 Windows 中文路径（主要面向 macOS/Linux）。Linghun 规格：Windows 优先。 | `index.ts:13618-13624`：`decodeInput()` GB18030 fallback。`tool-output-presenter.ts:191-193`：`looksLikeMojibake()` 检测乱码。`index.ts:101`：Windows 路径 normalize。**路径/编码处理已较成熟。** | 无 P0/P1。 | 无需 smoke 前修改。 | NOT-DO: 不做完整 Windows 编码矩阵（Big5/Shift-JIS/EUC-KR）。 | 现有实现 | 现有 mojibake detection test。
19. Standard Output Tone | 规格书要求：summary-first、human-first、action-first；不说 AI 话；不暴露内部术语。 | `index.ts:15067-15169`：messages 中英文短模板。`permission-presenter.ts`：人话权限提示。`terminal-readiness-presenter.ts`：`sanitizePrimary()` 脱敏。**但 index.ts 多处仍有 verbose 输出（如 formatCatalogHelp + formatHelp 双列表、formatFeaturePolicy 长输出）。** | P2 (可 Polish C 处理) | `/help` 和 `/features` 输出收束为 summary-first。内部字段不进主屏。 | NOT-DO: 不修改已收敛的 permission/model/doctor 输出。 | `index.ts` help/features 输出段 | focused tests: 主屏不含 gateId/expiresAt/raw flags/raw evidence。
20. No Prompt Pollution / No Extra Model Call | 规格书：TUI polish 不得污染 prompt/cache/stable context；不新增额外模型调用作为默认路径。 | `/memory learn` 明确 `modelCalled=false`。MicroCompact 不调用 API。`collectLightHints()` 纯本地。**当前合规。** | 无 P0/P1。 | 无需 smoke 前修改。各 Polish batch 必须继续遵守。 | NOT-DO: 不在任何 Polish batch 中新增模型调用。 | 各 Polish batch 实现时必须 gate。 | focused tests: 每次 Polish 后确认无新增 provider call。

---

## 4. AI Sessions MCP 裁决

| 项目 | 裁决 |
| --- | --- |
| 角色 | **optional external bridge only**。不作为 Linghun 内置强能力。 |
| 导入路径 | **explicit `/memory import sessions [source] [query]` only**。不提供自动导入、后台导入或静默导入。 |
| 导入内容 | **summary/evidence refs only**。只导入摘要和证据引用，不复制完整聊天原文。 |
| 完整 transcript | **no full transcript import**。不把外部工具完整聊天历史注入 Linghun prompt。 |
| 默认扫描 | **no default scan**。启动时不自动扫描 AI Sessions MCP。 |
| 自动 prompt 注入 | **no automatic prompt injection**。导入的摘要只写入 `/memory candidate`，必须 `/memory accept` 后才可能进入 prompt（且受 topK=3 限制）。 |
| smoke 阻塞 | **not a smoke blocker**。AI Sessions MCP 可用性不是 smoke 前置条件。 |

---

## 5. Memory UX 裁决

| 项目 | 裁决 |
| --- | --- |
| `/memory learn` | **candidate-only**。只从 evidence/Todo/verification/handoff 的 bounded refs 生成候选，最多 3 条，`modelCalled=false`。 |
| `/memory accept` | **required for long-term injection**。只有显式 accept 的 memory 进入 prompt。 |
| Prompt injection | **accepted-only topK=3 bounded injection**。只注入 accepted、non-inferred、稳定排序、截断摘要。 |
| autoAccept | **no autoAccept**。任何学习结果默认只是候选。 |
| Per-turn learning | **no default per-turn learning model call**。不做自动逐轮学习。 |
| 可审计/可撤销 | `/memory reject/disable/rollback/delete` 生命周期完整。 |
| 当前成熟度 | **smoke-ready 水平已达到**。候选优先、显式接受、有界注入、可撤销闭环均已实现。 |

---

## 6. 建议后续实现批次

### Polish A：Home / Status / Help / Slash Suggestions

**修改范围：**
- `packages/tui/src/runtime-status-presenter.ts`：状态行增加模型名、cache 命中率、index 状态。
- `packages/tui/src/index.ts`：`writeStatus()` 格式化；`formatCatalogHelp()` + `formatHelp()` 重构为分组输出；`handleSlashCommand()` fallthrough 增加 unknown command similar suggestions；启动段增加 home screen 信息。
- 可选新增 `packages/tui/src/help-presenter.ts`（如 help 重构超过 100 行）。
- `packages/tui/src/natural-command-bridge.ts`：`CommandCapability` 增加 `group` 字段用于 /help 分组。

**不该碰的模块：**
- 不修改 model loop、permission pipeline、Start Gate 语义。
- 不修改 provider/gateway/streaming。
- 不修改 evidence/MCP/index/memory/job runtime。
- 不新增依赖（不做 Fuse.js）。

**Focused tests 建议：**
- 快照测试：状态行输出格式含模型名。
- 快照测试：`/help` 分组输出含 "核心对话" "编辑" "索引与 MCP" "记忆与规则" "Agent 与 Job" "诊断与状态" 六个 group。
- 快照测试：`/help all` 完整列表。
- focused test: unknown command `/modex` → 建议 `/model` 或 `/mode`。
- focused test: home screen 输出含项目名和模型名。

**是否需要快照/字符串回归测试：是。** 状态行和 help 输出是用户可见契约，需要快照回归。

---

### Polish B：Permission / Plan / Elevation / Workspace Trust / Shortcuts

**修改范围：**
- `packages/tui/src/permission-presenter.ts`：permission prompt footer 增加 Esc/Enter 提示。
- `packages/tui/src/index.ts`：`handlePlanCommand()` 增加 plan summary preview + 结构化选项；新增 workspace trust check（启动段或单独函数）。
- 可选新增 `packages/tui/src/workspace-trust.ts`：project-level extensions/Bash 权限检查、trust prompt。

**不该碰的模块：**
- 不修改四权限模式语义（default/auto-review/plan/full-access）。
- 不修改 `decidePermission()` / permission pipeline。
- 不新增模型调用。
- 不新增 persistent trust store（trust 存 project config 已有机制）。

**Focused tests 建议：**
- focused test: permission prompt 输出包含 "Esc 取消" footer。
- focused test: plan approve/reject 不绕过 Start Gate。
- focused test: 新项目 trust prompt 触发（有 project-level MCP/skills/plugins 时）。
- focused test: 已 trust 项目不重复提示。
- focused test: trust 拒绝后退出。

**是否需要快照/字符串回归测试：是。** Permission prompt 和 plan approval prompt 需要快照回归。

---

### Polish C：Light Hints / Error / Doctor / Details Blocks / Output Tone

**修改范围：**
- `packages/tui/src/index.ts` `collectLightHints()`：增加 priority 字段和 30s cooldown。
- `packages/tui/src/tool-output-presenter.ts`：截断提示增加 "/details output <id>" 指引。
- `packages/tui/src/terminal-readiness-presenter.ts`：`/doctor` 默认只显示 non-pass 项；`/doctor all` 显示完整列表。
- `packages/tui/src/index.ts` help/features 相关段：收束输出到 summary-first。

**不该碰的模块：**
- 不修改 doctor 数据源（TerminalReadinessView 结构）。
- 不新增 provider/model call。
- 不新建 notification queue 系统。

**Focused tests 建议：**
- focused test: light hint dedup 30s 内不重复。
- focused test: `/doctor` 默认只 non-pass 项。
- focused test: `/doctor all` 完整列表。
- focused test: 截断输出含 `/details output` 提示。
- focused test: 主屏不含 gateId/expiresAt/raw flags/raw evidence/systemic_gap。

**是否需要快照/字符串回归测试：是。** Doctor 和 error truncation 输出是用户可见契约。

---

### Polish D：First-Run Language Persistence / Memory UX / Narrow Terminal Regression / Snapshot Tests

**修改范围：**
- `packages/tui/src/index.ts` `handleLanguageCommand()`：语言切换持久化写入 config。
- `packages/config/src/index.ts`：schema 中 language 字段已存在，确认读写路径。
- `packages/tui/src/index.ts`：`runTui()` 启动段增加首次启动 language hint（若无持久化 language）。
- 窄终端回归测试：80 列 `/help`、120 列状态行、中文混合换行。

**不该碰的模块：**
- 不修改 memory lifecycle（已成熟）。
- 不修改 AI Sessions MCP 边界。
- 不新增 onboarding wizard。

**Focused tests 建议：**
- focused test: `/language en-US` 持久化写入 config。
- focused test: 重启后语言保持。
- focused test: 首次启动 language hint（中文/English 可选）。
- snapshot test: 80 列 `/help` 输出可读、不截断中文。
- snapshot test: 中文/英文同风险处理器行为一致。

**是否需要快照/字符串回归测试：是。** 语言持久化和窄终端是用户可见契约。

---

## 7. 验证命令

审计阶段只读，无代码改动。验证命令仅确认报告格式：

```bash
cd "F:\Linghun"
git diff --check
```

---

## 8. 参考核对

### 本审计实际读取的 Linghun 文档

- `F:\Linghun\START_NEXT_CHAT.md`
- `F:\Linghun\docs\delivery\pre-open-source-terminal-product-completion-gate.md`
- `F:\Linghun\docs\audit\reference-map.md`
- `F:\Linghun\docs\delivery\phase-17-pre-smoke-index-ts-modularization-batch-1-3-closure.md`
- `F:\Linghun\docs\delivery\phase-11-sessions-memory.md`
- `F:\Linghun\docs\delivery\phase-16-controlled-learning-memory-skill-evolution.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`（前 200 行）
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`（前 200 行）
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`（前 200 行）

### 本审计实际读取的 Linghun 源码

- `packages/tui/src/index.ts`（抽样 2000+ 行）
- `packages/tui/src/natural-command-bridge.ts`（前 350 行 + Command Capability Catalog）
- `packages/tui/src/runtime-status-presenter.ts`（完整）
- `packages/tui/src/permission-presenter.ts`（完整）
- `packages/tui/src/terminal-readiness-presenter.ts`（完整）
- `packages/tui/src/index-runtime.ts`（完整）
- `packages/tui/src/remote-mcp-presenter.ts`（完整）
- `packages/tui/src/job-runner-presenter.ts`（完整）
- `packages/tui/src/tool-output-presenter.ts`（完整）
- `packages/tui/src/compact-context.ts`（前 80 行）

### 本审计实际读取的 CCB 参考文件

- `F:\ccb-source\src\utils\suggestions\commandSuggestions.ts`（完整）
- `F:\ccb-source\src\context\notifications.tsx`（完整）
- `F:\ccb-source\src\components\permissions\PermissionPrompt.tsx`（完整）
- `F:\ccb-source\src\components\permissions\ExitPlanModePermissionRequest\ExitPlanModePermissionRequest.tsx`（完整）
- `F:\ccb-source\src\components\TrustDialog\TrustDialog.tsx`（完整）
- `F:\ccb-source\src\components\FallbackToolUseErrorMessage.tsx`（完整）
- `F:\ccb-source\src\components\CtrlOToExpand.tsx`（完整）
- `F:\ccb-source\docs\context\project-memory.mdx`（完整）
- `F:\ccb-source\docs\context\compaction.mdx`（前 100 行）

### OpenCode（经 Catch-up 精读更新）

- `F:\freecodex\opencode-source` commit `c0a8b509c718f2bda07ded7b6c1a52e81a819301` (2026-05-16)
- 本次精读 12 个关键源码文件（详见 Section 11），覆盖 slash popover、command system、keybinding、notification、permission、terminal、titlebar、session-header、app shell。
- **License: MIT**。只参考行为模式，不复制源码。
- 参考行为：命令发现 typeahead（统一 CommandOption + fuzzysort）、快捷键组注册系统、通知系统（session+project scoping, 500 max, 30-day TTL）、权限 dock UI (once/always/reject)。

### Warp（经 Catch-up 精读更新）

- `F:\freecodex\warp-source` commit `9c5c4253f279541a5f1b4e3329f90403d99afea9` (2026-05-22)
- 本次精读 13 个关键源码文件（详见 Section 11），覆盖 terminal model (BlockId/BlockIndex)、fuzzy_match、input classifier、AI agent action types (30+)、onboarding wizard (7-step, 2 intentions)、settings schema、completer engine、keymap。
- **License: AGPL**。只参考行为模式，不复制源码。Warp 的 Rust + GPU 渲染架构与 Linghun 的 Ink/Node.js TUI 不兼容。
- 参考行为：block 化输出模型（不可直接采用）、模糊匹配（SkimMatcherV2 + glob wildcard）、首次引导 wizard（Intention→Agent→Project 流程参考）、input 分类器（Shell vs AI，但 Linghun 用 `/command` 前缀区分，不需要 ML）。

### 未复制内容

- 未复制 CCB / OpenCode / Warp / 第三方源码、内部 API、反编译产物、专有遥测或私有配置。
- 审计中引用的 CCB/OpenCode/Warp 源码仅用于行为边界和成熟度对比，不进入 Linghun 实现。

---

## 9. Handoff Packet

```json
{
  "phase": "pre-smoke-mature-tui-ux-source-level-audit",
  "date": "2026-05-23",
  "scope": "只读审计 + 成熟度方案报告；不做 runtime 代码实现",
  "indexProject": "F-Linghun",
  "indexStatus": "ready (nodes=1858, edges=3905)",
  "verdict": "CONDITIONAL",
  "p0Blocking": [
    "P0-1: 状态行不显示模型名",
    "P0-2: /help 平铺无分组",
    "P0-3: unknown command 无 similar suggestion",
    "P0-4: 无 slash command typeahead",
    "P0-5: 无 workspace trust"
  ],
  "p1Blocking": [
    "P1-1: 无 first-run language picker",
    "P1-2: home screen 信息不足",
    "P1-3: 无 keyboard shortcuts / footer hints",
    "P1-4: plan approval UX 交互薄弱",
    "P1-5: error truncation 缺 expansion hint"
  ],
  "recommendedFirstBatch": "Polish A (Home/Status/Help/Slash Suggestions)",
  "changedFiles": [
    "docs/audit/pre-smoke-mature-tui-ux-source-level-audit.md"
  ],
  "notDone": [
    "runtime 代码实现",
    "TUI 美化代码",
    "Beta PASS",
    "smoke-ready",
    "open-source-ready",
    "真实 smoke",
    "Phase 18 / 桌面端 / 开源发布",
    "commit"
  ],
  "nextDecision": "用户确认是否关闭 P0 并启动 Polish A batch"
}
```

---

## 10. 最终声明

- 报告路径：`F:\Linghun\docs\audit\pre-smoke-mature-tui-ux-source-level-audit.md`
- 发现 P0: 5 项（P0-1 ~ P0-5）
- 发现 P1: 5 项（P1-1 ~ P1-5）
- 建议进入 `Polish A` 批次（Home / Status / Help / Slash Suggestions）。
- 未改 runtime、未提交 commit、未进入真实 smoke。
- 所有 P0 必须先于 smoke 关闭；P1 可按批次逐步处理。

---

## 11. OpenCode / Warp Reference Catch-up

### 11.1 状态声明

- 本轮性质：Pre-Smoke Mature TUI UX Source-Level Audit 的 OpenCode / Warp Reference Catch-up（补充精读）。
- 本轮只补全上一份报告中 OpenCode / Warp 参考偏浅的问题。
- 本轮不做 runtime 代码实现，不做 TUI 美化代码。
- 本轮不提交 commit。
- 本轮不宣布 Beta PASS / smoke-ready / open-source-ready。
- 本轮不修改 P0/P1/P2 评级（不替代原始报告的 P0/P1/P2 清单），只在 11.5-11.8 给出修订建议。
- 本轮按硬边界执行：不复制源码，只用行为参考。

### 11.2 仓库信息

| 项目 | 仓库 | License | Commit | 日期 |
| --- | --- | --- | --- | --- |
| OpenCode | `F:\freecodex\opencode-source` | MIT | `c0a8b509c718f2bda07ded7b6c1a52e81a819301` | 2026-05-16 |
| Warp | `F:\freecodex\warp-source` | AGPL | `9c5c4253f279541a5f1b4e3329f90403d99afea9` | 2026-05-22 |

### 11.3 实际精读文件清单

#### OpenCode（12 文件）

| 文件 | 行数 | 关键内容 |
| --- | --- | --- |
| `packages/app/src/components/prompt-input/slash-popover.tsx` | 142 | `SlashCommand` 类型（id/trigger/title/description/keybind/type/source）；`PromptPopover` @-mention + /-command 双面板；max 10 items；absolute 定位、max-h-80、rounded-12px；source badge (skill/mcp/custom) |
| `packages/app/src/context/command.tsx` | ~350 | `CommandOption` 类型（id/title/description/category/keybind/slash/suggested/disabled/hidden/onSelect/onHighlight）；`CommandCatalogItem` 只读注册；`CommandRegistration` 动态注册；Keybind 签名匹配（normalizeKey + ctrl:1\|meta:2\|shift:4\|alt:8 bitmask）；3 种触发源 (palette/keybind/slash)；可编辑 keybind IDs |
| `packages/app/src/context/notification.tsx` | 373 | 通知类型：turn-complete, error；per-session + per-project scoping with unseenCount；MAX_NOTIFICATIONS=500，30-day TTL；persisted() 全局存储；reconcile-based index rebuild；平台通知集成 deep links；markViewed per session/directory |
| `packages/app/src/components/settings-keybinds.tsx` | 455 | 6 KeybindGroup (General/Session/Navigation/Model and agent/Terminal/Prompt)；groupFor() 按 ID 前缀路由；fuzzysort 搜索 (threshold -10000)；Live key capture：Esc cancel、Backspace/Delete clear、冲突检测 via signatures map；Toast-based conflict notification |
| `packages/app/src/components/prompt-input.tsx` | ~500 | 主 PromptInput：model selector popover、slash popover、@-mention support；25 prompt examples、image attachments、drag overlay、context items；useCommand/usePermission/useLanguage/usePlatform 集成；Editor DOM 操作；Prompt history with navigate |
| `packages/app/src/components/terminal.tsx` | 667 | Ghostty-web 终端嵌入；keybind 匹配 (TOGGLE_TERMINAL = ctrl+\`)；copy/paste/pointerdown/link click 处理；SerializeAddon 终端状态持久化；明暗主题终端颜色 (background/foreground/cursor/selectionBackground)；WebSocket 终端连接 |
| `packages/app/src/components/titlebar.tsx` | 336 | Titlebar：前进/后退导航 history stack + index；平台感知 (macOS/Windows/Web)；Tauri 原生窗口控制 (startDragging/toggleMaximize/setTheme)；zoom 自适应 (minZoom=0.25)；Windows caption buttons 宽度 138px；session 路由创建检测 |
| `packages/app/src/components/session/session-header.tsx` | 503 | Session header："Open in..." 应用选择器 (vscode/cursor/zed/textmate/antigravity/finder/terminal/iterm2/ghostty/warp/xcode/android-studio/powershell/sublime-text)；模型状态 Popover；language/settings/terminal/sync context 集成；Persist 持久化 |
| `packages/app/src/app.tsx` | 330 | App shell：SettingsProvider→PermissionProvider→LayoutProvider→NotificationProvider→ModelsProvider→CommandProvider→HighlightsProvider 嵌套 hierarchy；QueryClient (refetch 全关闭)；SessionProviders 子图 (TerminalProvider/ServerProvider/)；Tauri 深度链接 + WSL 检测 |
| `packages/app/src/context/permission.tsx` | ~150 | Permission context：directory-level autoAccept；config permission "allow" → 自动目录级 auto-accept；permission.v3 持久化；migration (autoAcceptEdits → autoAccept) |
| `packages/app/src/context/permission-auto-respond.ts` | 52 | acceptKey (sessionID + directory base64)；directoryAcceptKey (`<base64>/*`)；sessionLineage 父子链向上查找 autoAccept；autoRespondsPermission 返回 boolean |
| `packages/app/src/pages/session/composer/session-permission-dock.tsx` | 75 | SessionPermissionDock：DockPrompt 容器；tool description via i18n key；patterns display (code 块)；once/always/reject 三按钮；responding 状态禁点 |

#### Warp（13 文件）

| 文件 | 行数 | 关键内容 |
| --- | --- | --- |
| `crates/warp_terminal/src/model/block_id.rs` | 74 | `BlockId(String)`：pty 输出用 `{WARP_SESSION_ID}-{NUM_ID}` (monotonically increasing)；手动创建用 `manual-{UUID}`；全局唯一；session_sharing_protocol 双向转换 |
| `crates/warp_terminal/src/model/block_index.rs` | 70 | `BlockIndex(usize)`：零基，单调递增；Display/Add/Sub/AddAssign/SubAssign trait；range_as_iter() 范围迭代 |
| `crates/warp_terminal/src/model/mod.rs` | 15 | 导出：BlockId、BlockIndex、grid (cell/row/dimensions)、ansi escape sequences、mouse modes、keyboard modes |
| `crates/fuzzy_match/src/lib.rs` | 673 | `match_indices` (SkimMatcherV2 smart case)；`match_indices_case_insensitive`；`match_indices_case_insensitive_ignore_spaces` (符号名匹配)；`match_wildcard_pattern` (glob `*`/`?` 路径匹配)；fast path：`*.rs` O(1) suffix、`src/*` O(1) prefix；substring matching (pattern 出现在 path 任意位置)；progressive typing support (`*.r` → `.rs`/`.rb`)；score 分层 (exact=1000, partial=800, complex=1000, exact no wildcard=2000) |
| `crates/input_classifier/src/lib.rs` | 122 | `InputClassifier` trait：`detect_input_type()` → `InputClassificationResult` (InputType + DecisionSource)；DecisionSource：InputClassifier (ONNX) / FallbackHeuristic / FallbackCurrentInput / NaturalLanguageOneOffAllowlist / ShellCommandAllowList / ShellHeuristic；`ClassificationResult`：p_shell/p_ai probability + confidence()；Context：current_input_type + is_agent_follow_up |
| `crates/ai/src/agent/mod.rs` | 10 | agent 子模块：action、action_result、citation、convert、file_locations、orchestration_config |
| `crates/ai/src/agent/action/mod.rs` | 904 | 30+ AIAgentActionType 变体：RequestCommandOutput (is_read_only/is_risky/wait_until_completion/uses_pager/rationale/citations)、WriteToLongRunningShellCommand (Raw/Line/Block)、ReadFiles、UploadArtifact、SearchCodebase、RequestFileEdits (Edit/Create/Delete)、Grep、FileGlob/FileGlobV2、ReadMCPResource、CallMCPTool、SuggestNewConversation、SuggestPrompt、InitProject、OpenCodeReview、ReadDocuments/EditDocuments/CreateDocuments、ReadShellCommandOutput、UseComputer、InsertCodeReviewComments、RequestComputerUse、ReadSkill、FetchConversation、StartAgent (Local/Remote + harness_type/model_id)、SendMessageToAgent、TransferShellCommandControlToUser、AskUserQuestion (MultipleChoice/is_multiselect/supports_other)、RunAgents (orchestration with base_prompt + per-agent configs)；所有变体有 `cancelled_result()` 工厂 + `user_friendly_name()` 人性化摘要 |
| `crates/onboarding/src/model.rs` | 816 | OnboardingStateModel：7-step sequence (Intro→ThemePicker→Intention→Customize→Agent→ThirdParty→Project，flag 控制是否 ThemePicker 在最后)；2 intentions (Terminal vs AgentDrivenDevelopment)；UICustomizationSettings (vertical tabs/conversation history/project explorer/global search/warp drive/code review button)；AgentDevelopmentSettings (model_id/autonomy/cli toolbar/notifications/disable_oz)；ProjectOnboardingSettings (path/auto initialize)；完成 telemetry；模型选择 + 升级 CTA |
| `crates/onboarding/src/slides/agent_slide.rs` | ~250 | Agent slide：OnboardingModelInfo (id/title/icon/requires_upgrade/is_default)；AgentAutonomy enum；模型选择器渲染；upgrade button (高对比 inverted theme)；TwoLineButton 布局 |
| `crates/onboarding/src/slides/intro_slide.rs` | ~120 | Intro slide：ShimmeringTextElement 标题动画；get started/login 按钮；MouseStateHandle 悬停检测 |
| `crates/settings/src/schema.rs` | 100 | SettingSchemaEntry：storage_key/description/hierarchy/is_private/feature_flag/supported_platforms_fn/default_value_fn/schema_fn/file_default_value_fn/max_table_depth；inventory::collect! 注册表模式；submit_schema_entry! 宏 |
| `crates/settings/src/lib.rs` | ~300 | Settings trait；PublicPreferences newtype 封装；TOML path 工具函数 (toml_path_storage_key/toml_path_hierarchy)；SettingsManager；settings_value re-export |
| `crates/warp_completer/src/completer/engine/mod.rs` | ~200 | Completion engine：LocationType enum (Command{is_recognized}/Flag{command_name,flag_name}/Argument{command_name,argument_name}/Variable)；Flatten 将 ParsedExpression 转为 CompletionLocation[]；CommandRegistry 注册表驱动；argument_name_at_index_for_command 分 v2/legacy |
| `crates/warpui_core/src/keymap.rs` | ~300 | Keymap：fixed_bindings + editable_bindings (Tracked<EditableBinding>)；editable_bindings_by_name HashMap；Trigger：Keystrokes/Standard/Custom(CustomTag)/Empty；BindingDescription (default + custom contexts + dynamic_override resolver)；DescriptionContext (Default/Custom)；Matcher trait (IsBindingValid) |

### 11.4 Delta 对照：OpenCode/Warp vs Linghun 关键差异

#### 11.4.1 命令发现与 Typeahead

| 维度 | CCB (原参考) | OpenCode (新增精读) | Warp (新增精读) | Linghun 现状 | Delta |
| --- | --- | --- | --- | --- | --- |
| 命令注册 | 独立 slash command registry + Fuse.js 搜索 | **统一 CommandOption 目录**：slash、keybind、command palette 共享同一 catalog | CommandRegistry 驱动 completer engine (LocationType 枚举) | SLASH_COMMAND_REGISTRY 43 条，仅用于 slash dispatch + help 文本生成 | Linghun 缺少统一 command catalog 概念。OpenCode 的 "one catalog, three surfaces" 模式是参考价值最高的设计决策 |
| 搜索匹配 | Fuse.js threshold=0.3, 4-key weighted | fuzzysort threshold=-10000 (宽松)、prefix 匹配 | SkimMatcherV2 smart case + wildcard glob (`*.rs`) | 无搜索。未知命令返回 "Type /help" | P0-3 + P0-4 叠加：既无 typeahead 也无 fuzzy suggestion |
| 输入 `/` 行为 | 分类建议 (recently used 5 + builtin/user/project 按字母) | 分类 popover (type filter + keybind display + source badge) | N/A (Warp 以 `#` 或 AI prompt 区分，不用 `/` 命令系统) | 无任何响应 | P0-4 更关键：`/` 是 Linghun 唯一交互入口，无发现机制意味着每用户必须背诵 43 条命令 |

**关键发现**：OpenCode 的统一 CommandOption 目录是本次 Catch-up 最重要的设计参考。Linghun 当前将 SLASH_COMMAND_REGISTRY、help 文本生成、natural command bridge 分别维护，未来 typeahead 若再建一套会导致 4 套数据源。应在 Polish A 中先给 CommandCapability 加 `group` 字段（已建议），再在后续统一 Slash/Help/Typeahead 三个表面。

#### 11.4.2 快捷键系统

| 维度 | OpenCode | Warp | Linghun 现状 | Delta |
| --- | --- | --- | --- | --- |
| 快捷键注册 | CommandOption.keybind + settings-keybinds.tsx 注册系统 | Keymap.fixed_bindings + editable_bindings (Tracked) | **无快捷键系统** | P1-3 短中期风险高于原始评级 |
| 分组 | 6 KeybindGroup (General/Session/Navigation/Model/Terminal/Prompt) | DescriptionContext (Default/Custom) | 无 | OpenCode 的 6-group 分层可直接压缩为 Linghun 3-group (Global/Session/Terminal) |
| 冲突检测 | signatures map (normalizeKey + bitmask) | IsBindingValid trait | 无 | 第一版不需要 |
| 可编辑性 | Live key capture + fuzzysort search + Toast conflict | editable_bindings + DynamicDescriptionResolver | 无 | 第一版只做硬编码 3-5 条 |
| Footer hints | TooltipKeybind 组件显示当前上下文可用快捷键 | N/A (Warp 无 footer 概念) | 无 | Polish B 中至少 permission prompt 加 Esc/Enter hint |

**关键发现**：OpenCode 的快捷键系统比 CCB 更完整，证明可编辑快捷键是成熟编码工具的 table-stakes。但 Linghun 是 Ink TUI，不需要 OpenCode 的 DOM-based key capture、fuzzysort search UI 或 Toast 通知。第一版只需：3-5 硬编码快捷键 (Ctrl+C 中断、Enter 确认、Esc 取消、Ctrl+L 清屏、Tab 补全) + permission/plan prompt footer hint。

#### 11.4.3 通知与 Light Hints

| 维度 | OpenCode | CCB (原参考) | Linghun 现状 | Delta |
| --- | --- | --- | --- | --- |
| 优先级 | turn-complete / error 两种类型 | 4 级 (immediate/high/medium/low) + fold + invalidates | 4 hint types + dedup (hintLastShownAt)，无 priority | CCB 的 4-priority + fold/invalidates 参考价值高于 OpenCode 的简化两类型 |
| 持久化 | persisted() global storage, 500 max, 30-day TTL | 无持久化（session 级） | 无持久化 | OpenCode 的持久化通知对 Linghun 的 bg task 完成通知有参考价值 |
| 作用域 | per-session + per-project, unseenCount | 无作用域（app 全局） | 无作用域 | Linghun light hints 不需要 scoping |

**关键发现**：OpenCode 的 notification 系统持久化设计 (500 max, 30-day TTL) 对 Linghun 未来 bg job 完成通知有参考意义，但 smoke 前不需要。CCB 的 priority/fold/invalidates 更适合 Linghun 的 light hints 升级。

#### 11.4.4 权限 UX

| 维度 | OpenCode | CCB (原参考) | Linghun 现状 | Delta |
| --- | --- | --- | --- | --- |
| 权限请求 UI | DockPrompt：header (icon+title) + body (tool description + patterns) + footer (deny/allow always/allow once 三按钮) | PermissionPrompt：option list + Tab feedback input + keybinding registration + analytics | formatLocalToolPermissionPrompt() 文本输出 tool/risk/reason/scope/next；no visual hierarchy | OpenCode 的 DockPrompt 三按钮模式更适合 Ink TUI 的简化设计 |
| 自动接受 | directory-level autoAccept + sessionLineage 父子链向上查找 | 无目录级 auto-accept | 无 (Phase 15 四权限模式语义仅区分 default/auto-review/plan/full-access) | OpenCode 的 directoryAcceptKey 和 sessionLineage 机制可能对 Linghun 的 project-level trust 有参考意义 |
| 权限范围 | patterns display (文件 glob 列表) | full tool/risk/reason/scope | tool/risk/reason/scope/next | Linghun 的文本输出已基本满足需要 |

**关键发现**：CCB 的 PermissionPrompt 和 OpenCode 的 SessionPermissionDock 代表了两种不同复杂度级别。Linghun 的 Ink TUI 天然偏向更简单的文本输出，当前 formatLocalToolPermissionPrompt() 已足够。Polish B 只需增加 footer hints (Esc/Enter)。

#### 11.4.5 首次启动体验

| 维度 | Warp (唯一参考) | CCB | Linghun 现状 | Delta |
| --- | --- | --- | --- | --- |
| 流程 | 7-step wizard：Intro→ThemePicker→Intention→Customize→Agent→ThirdParty→Project | TrustDialog 单步 | 启动屏仅标题+状态行+intro+可选 hint | Warp wizard 是 OVERKILL for Linghun |
| 意图选择 | Terminal vs AgentDrivenDevelopment 二选一，影响后续 UI 布局 + AI 开关 + 通知设置 | 无 | 无 | 不采纳。Linghun 是 AI-first coding CLI，不需要 Terminal 模式 |
| UI 自定义 | vertical tabs/conversation history/project explorer/global search/warp drive/code review toggle | 无 | 无 | 不采纳。Linghun 是纯文本 TUI，不涉及 panel/explorer/tabs |
| 模型选择 | 在 Agent slide 中选择默认模型，区分 free/pro models (upgrade CTA) | 无 | `/model` 命令在启动后手动切换 | 参考点：在首次启动 language hint 中同时简短说明 `/model` 用途即可 |
| 主题选择 | ThemePicker slide | 无 | 无 | 不采纳 |

**关键发现**：Warp 的 onboarding 是 Rust GPU 渲染 desktop app 的产物，对 Linghun 的 Ink/Node.js CLI TUI 几乎无可直接参考的设计元素。唯一可取的思路是首次启动时的意图分流，但 Linghun 不需要 Terminal mode。P1-1 (first-run language picker) 保持原方案：短 language hint + `/language` 持久化。

#### 11.4.6 输出块模型

| 维度 | Warp | Linghun 现状 | Delta |
| --- | --- | --- | --- |
| 输出组织 | BlockId + BlockIndex 全局唯一标识；每命令输出一个 block；block header 显示 exit code/duration | 纯文本流，无 block 概念。tool output 通过 summary-first 截断 + `/details output <id>` 展开 | Warp 的 block 模型是基于 GPU 渲染 + PTY session 的底层设计。Linghun 作为 Ink/Node.js TUI，不需要 block_id 层。但 block header 的 exit code/duration 显示可参考 — Linghun 的 Bash 工具输出已经在 summary-first 中显示 exit code |
| 命令输出回读 | `ReadShellCommandOutput { block_id, delay }` — Agent 可引用之前的命令 block | 无 | Warp 的 block 概念依赖其底层 PTY session 数据模型。Linghun 用 `/details output` 路径引用，已足够 |

**关键发现**：Warp 的 block 模型是其 Rust 架构的核心，但 Linghun 的纯文本 TUI 不需要也不应该引入 block 概念。现有的 `/details output` 路径引用已满足需要。

### 11.5 P0/P1/P2 修订建议

基于本次 Catch-up 的 delta 分析，建议对原始报告评级做以下调整：

| 原始 | 区域 | 修订建议 | 理由 |
| --- | --- | --- | --- |
| P0-1 | Status Line 无模型名 | **保持 P0** | OpenCode titlebar/session-header 均显示模型信息。模型名在主状态的缺失在三个参考源中无先例 |
| P0-2 | /help 平铺无分组 | **保持 P0** | OpenCode 无独立 `/help` 命令（通过 typeahead 发现）。Linghun 有 43 条命令，分组是 smoke 前硬需求 |
| P0-3 | Unknown command 无建议 | **保持 P0** | 三个参考源均提供命令建议机制。Linghun 的 `Type /help` 是所有参考源中最弱的 fallback |
| P0-4 | 无 Slash Typeahead | **保持 P0，加强证据** | OpenCode 的统一 CommandOption 证明这是编码工具 table-stakes。CCB 的 Fuse.js + 分类建议给出实现路径 |
| P0-5 | 无 Workspace Trust | **保持 P0，收窄范围** | CCB TrustDialog 是正确的参考复杂度。Warp onboarding wizard 过重，不适用于 Linghun |
| P1-1 | First-run Language | **保持 P1** | 无须升级。Warp wizard 不适用。持久化 `/language` + 短 hint 即可 |
| P1-2 | Home Screen 信息不足 | **保持 P1** | OpenCode 有 session-list home、Warp 有 intro slide。Linghun 只需项目名+模型名+最近会话入口 |
| P1-3 | 无快捷键/Footer | **升级为 P0-6**（新） | OpenCode 的 6-group keybinding 系统证明快捷键是编码工具基础能力，不是 polish。但 Linghun Ink TUI 不需要 full keybinding 系统 — 只需 3-5 硬编码快捷键 + footer hints。**建议作为新 P0 加入** |
| P1-4 | Plan Approval UX | **保持 P1** | CCB 的 ExitPlanModePermissionRequest 仍是唯一相关参考。OpenCode/Warp 不适用 |
| P1-5 | Error Truncation | **保持 P1** | CCB FallbackToolUseErrorMessage + CtrlOToExpand 仍是最佳参考 |

**P0 调整后汇总**：
- P0-1: Status Line 模型名（不变）
- P0-2: /help 分组（不变）
- P0-3: Unknown command suggestions（不变）
- P0-4: Slash typeahead（不变，证据加强）
- P0-5: Workspace trust（不变，范围收窄）
- **P0-6: 基础快捷键 + Footer hints（新增）**

### 11.6 Polish A-D 修订建议

| Batch | 修订建议 | 理由 |
| --- | --- | --- |
| **Polish A** (Home/Status/Help/Slash) | 1. Help 分组增加 `CommandCapability.group` 字段，为未来 typeahead 预留统一 catalog 数据基础。2. Unknown command suggestion 优先用 prefix 匹配（OpenCode 模式），不做 Fuse.js 完整 fuzzy。 | OpenCode 的统一 catalog 模式启示：在 Polish A 中打下 data model 基础比立即做完整 typeahead 更重要 |
| **Polish B** (Permission/Plan/Trust/Shortcuts) | 1. **新增基础快捷键系统**：3-5 硬编码快捷键注册 + footer hint 显示。参考 OpenCode 的 CommandOption.keybind 字段但简化百倍。2. Permission prompt 增加 footer hint (Esc 取消 / Enter 确认)。 | P0-6 新增后 Polish B 的快捷键部分从 P1 升级为 P0 |
| **Polish C** (Light Hints/Error/Doctor/Details/Tone) | 保持原方案。新增：light hints 参考 OpenCode notification scoping 模式，为 bg task 完成通知预留持久化点。 | 低风险改进 |
| **Polish D** (Language/窄终端/Snapshot) | 保持原方案。 | 无修订 |

### 11.7 回答 11 个具体问题

**Q1: OpenCode/Warp 在 20-area 对照表中的实际行为与原始报告是否有偏差？**

有。原始报告对 OpenCode 命令发现系统不了解（描述为"多模型开放、TUI/output 组织"），对其统一 CommandOption catalog + 6-group keybinding 系统零覆盖。原始报告对 Warp 完全不了解（"本地无 Warp source/docs"），对其 onboarding wizard、input classifier、fuzzy_match 库、block output model 零覆盖。

**Q2: P0/P1/P2 是否需要调整？**

需要。P1-3 (快捷键) 应从 P1 升级为 P0-6。其他保持。

**Q3: Polish A-D 是否需要重新排序？**

不需要重新排序批次，但 Polish A 应增加 `group` 字段预留（为未来 typeahead 打 data model 基础），Polish B 应新增基础快捷键注册。

**Q4: 原始报告是否有过强陈述？**

"Memory UX 已成熟" 和 "Windows 中文路径/编码/换行 已较成熟" 仍成立。Section 8 中 "未在本次审计中精读具体 TUI 文件" 和 "本地无 Warp source/docs" 现已过时，已更新。

**Q5: 是否有遗漏的关键 UX 问题？**

有一个设计层面的遗漏：Linghun 的 SLASH_COMMAND_REGISTRY (slash dispatch)、formatCatalogHelp/formatHelp (help 输出)、natural-command-bridge (natural intent) 是三个独立的数据源，未来 typeahead 会变成第四个。OpenCode 的统一 CommandOption 模式启示应在 Polish A 中给 CommandCapability 加 `group` 字段，在后续统一这四个表面。这不是 smoke 阻塞问题，但会降低后续维护成本。

**Q6: 是否存在过度设计风险？**

有，且需要明确排除：
- Warp 的 7-step onboarding wizard：不采纳。Linghun 是 CLI，不是 desktop app。
- Warp 的 ML input classifier (ONNX)：不采纳。Linghun 用 `/command` 前缀区分命令 vs 自然语言，不需要概率分类。
- OpenCode 的 keybinding customization UI (settings-keybinds.tsx 455 行)：不采纳。第一版只做 3-5 硬编码快捷键。
- OpenCode 的 notification 持久化系统 (500 max, 30-day TTL)：smoke 前不采纳，只预留设计点。
- Warp 的 block output model：不采纳。依赖 GPU 渲染 + PTY session，与 Ink TUI 不兼容。

**Q7: 是否有性能/缓存/prompt 污染风险？**

- OpenCode notification persisted() 全局存储 + reconcile 机制：无 prompt 污染风险（存本地，不进 prompt）。
- OpenCode fuzzysort (threshold -10000) 比 CCB Fuse.js (threshold 0.3) 更宽松：Linghun typeahead 第一版只用 prefix 匹配，不存在性能风险。
- Warp SkimMatcherV2：纯本地算法，无 LLM 调用，无 prompt 风险。
- Warp input classifier (ONNX)：本地推理，不进 prompt。但 Linghun 不采纳。

**Q8: OpenCode/Warp 的授权边界是否影响 Linghun 的参考方式？**

- OpenCode (MIT)：允许行为参考，但不复制源码到 Apache-2.0 代码库。
- Warp (AGPL)：**严格行为参考**。不复制任何代码、数据结构设计、算法实现或 API 设计。
- 本次 Catch-up 全部作为 behavior reference only，不涉及代码复制。

**Q9: 原始报告 Section 8 参考核对是否需要更新？**

是。已在上述编辑中更新，补充了 12 个 OpenCode 文件和 13 个 Warp 文件的精读记录。

**Q10: summary-first / human-first / action-first 输出标准在 OpenCode/Warp 中如何体现？**

- OpenCode `session-permission-dock.tsx`：用 `language.t("settings.permissions.tool.xxx.description")` i18n key 获取人性化工具描述（而不是 raw tool name），footer 按钮文案清晰（Deny / Allow Always / Allow Once）。
- OpenCode `command.tsx`：CommandOption 有 `description` 字段，slash popover 显示 title + description + keybind + source badge。
- Warp `AI agent action/mod.rs`：`user_friendly_name()` 方法产出 "Run command: git status"、"Edit button.rs"、"Start agent: code-reviewer" 等人性化摘要，而不是 "RequestCommandOutput"、"RequestFileEdits" 等内部枚举名。
- 三个参考源的一致性：都避免将内部类型名/枚举名直接暴露给用户。Linghun 的 permission-presenter、tool-output-presenter 已遵循此模式。

**Q11: 是否有助于 smoke 阻塞风险评估？**

是。进一步确认了 P0-1~P0-5 的阻塞性质。新增 P0-6 (基础快捷键) 基于 OpenCode 的证据。明确了 Warp 的 block model/onboarding/input classifier 与 Linghun 无关（消除误判风险）。

### 11.8 未采纳的 Warp/OpenCode 能力及理由

| 能力 | 来源 | 不采纳理由 |
| --- | --- | --- |
| Block output model (BlockId/BlockIndex) | Warp | Rust GPU 渲染 + PTY session 底层设计。Linghun 的 Ink/Node.js TUI 不需要也不应该引入 block 概念 |
| 7-step onboarding wizard | Warp | Desktop app UI。Linghun 是 CLI，首次启动只需短 language hint |
| ML input classifier (ONNX) | Warp | Linghun 用 `/command` 前缀区分命令 vs 自然语言，不需要概率分类器 |
| 完整 keybinding customization UI | OpenCode | 455 行 SolidJS DOM UI。Linghun Ink TUI 第一版只需 3-5 硬编码快捷键 |
| Notification 持久化 (500 max, 30-day TTL) | OpenCode | Smoke 前不需要。Linghun light hints 无持久化需求 |
| File glob wildcard matching (`*.rs`) | Warp | Linghun 不需要文件搜索 typeahead（不维护文件列表 UI） |
| Tauri native window control | OpenCode | Linghun 是 CLI，非 desktop app |
| Ghostty-web terminal embedding | OpenCode | Linghun 运行在用户已有终端中，不嵌入 web 终端 |
| Session sharing protocol | Warp | Linghun 无 session sharing 需求 |

### 11.9 更新后的 Handoff Packet

```json
{
  "phase": "pre-smoke-mature-tui-ux-source-level-audit-opencode-warp-catch-up",
  "date": "2026-05-23",
  "scope": "OpenCode/Warp Reference Catch-up — 补充精读 + delta 分析 + 修订建议",
  "warpCommit": "9c5c4253f279541a5f1b4e3329f90403d99afea9",
  "warpDate": "2026-05-22",
  "opencodeCommit": "c0a8b509c718f2bda07ded7b6c1a52e81a819301",
  "opencodeDate": "2026-05-16",
  "warpLicense": "AGPL",
  "opencodeLicense": "MIT",
  "filesRead": {
    "opencode": 12,
    "warp": 13
  },
  "keyFindings": [
    "OpenCode 统一 CommandOption catalog (slash + keybind + palette 共享) 是本次最有价值的设计参考",
    "OpenCode 6-group keybinding 系统证明快捷键是 table-stakes → P1-3 升级为 P0-6",
    "Warp block model / onboarding wizard / ML classifier 与 Linghun Ink TUI 无关，明确排除",
    "Warp fuzzy_match (SkimMatcherV2 + glob) 和 AI agent action types (30+) 是好的行为参考但不直接采纳"
  ],
  "p0Revised": [
    "P0-1: Status Line 模型名（不变）",
    "P0-2: /help 分组（不变）",
    "P0-3: Unknown command suggestions（不变）",
    "P0-4: Slash typeahead（证据加强）",
    "P0-5: Workspace trust（范围收窄）",
    "P0-6: 基础快捷键 + Footer hints（新增，从 P1-3 升级）"
  ],
  "polishRevision": [
    "Polish A: 增加 CommandCapability.group 字段预留",
    "Polish B: 新增基础快捷键注册 (3-5 硬编码) + permission footer hints",
    "Polish C: 预留 bg task notification 持久化点",
    "Polish D: 不变"
  ],
  "explicitlyNotAdopted": [
    "Warp block output model (GPU-rendered, incompatible)",
    "Warp 7-step onboarding wizard (desktop app, overkill)",
    "Warp ML input classifier (ONNX, unnecessary)",
    "OpenCode keybinding customization UI (455 lines, overkill)",
    "OpenCode notification persistence (smoke 前不需要)",
    "Warp file glob wildcard matching (unnecessary for CLI)",
    "OpenCode Tauri native window control (CLI, not desktop)",
    "OpenCode Ghostty-web terminal embedding (irrelevant)",
    "Warp session sharing protocol (irrelevant)"
  ],
  "notDone": [
    "runtime 代码实现",
    "TUI 美化代码",
    "Beta PASS",
    "smoke-ready",
    "open-source-ready",
    "真实 smoke",
    "Phase 18",
    "commit",
    "P0/P1 关闭"
  ],
  "nextDecision": "用户确认是否接受 P0-6 新增 和 Polish A/B 修订，进入 Polish A"
}
```

### 11.10 最终声明

- OpenCode/Warp Reference Catch-up 完成。
- 精读 OpenCode 12 文件、Warp 13 文件（详见 11.3）。
- 发现一个关键设计建议（统一 command catalog），一个 P0 升级（P1-3 → P0-6）。
- 明确排除 9 项不适用能力（详见 11.8）。
- 未改 runtime、未提交 commit、未进入真实 smoke。
- 原报告路径：`F:\Linghun\docs\audit\pre-smoke-mature-tui-ux-source-level-audit.md`
- Section 11 已追加至该报告。
