# Pre-Open-Source Mature UX Cutback

日期：2026-06-01  
范围：TUI 用户可见交互层、模型工具入口、权限前台、上下文压缩、工具协议输出  
状态：已完成本轮源码级收口；未 commit

## 结论

本轮把 Linghun 的前台路径收回到“模型驱动强底座”：普通自然语言默认进入模型主链；显式 slash command 才走本地命令；Workflow / Agent / Job / Index / Memory 作为 slash 或模型工具能力存在，不再靠本地关键词 router 抢用户输入。安全边界保留在执行层：危险 Bash、敏感路径、越界、删除、联网/安装、权限变更仍 ask/deny；final gate/evidence/反幻觉语义保留，但不把内部 gate/debug/schema/context 数字刷主屏。

本轮未改 provider/model route，未改 remote/Feishu，未改 packaging，未新增第五权限模式，未新增第二套 approval store，未新增大 runtime/dashboard，未 commit。

## CCB 源码事实对照

实际读取并核对的 CCB 源码事实：

- `F:\ccb-source\src\query.ts:545`、`:572`、`:588`、`:614`、`:639`：CCB 在 provider 请求前按 tool result budget、snip、microcompact、context-collapse、autocompact 递进治理上下文，不用单个固定字符硬停作为常态产品路径。
- `F:\ccb-source\src\query.ts:778`、`:836`、`:1029`、`:1340`、`:1460`：blocking limit 和 prompt-too-long 是自动压缩/恢复之后的兜底，可恢复错误先尝试 reactive compact / token recovery。
- `F:\ccb-source\src\services\compact\autoCompact.ts:28`、`:77`、`:101`、`:286`：autocompact 基于 effective context window 与 buffer，并有连续失败熔断。
- `F:\ccb-source\src\services\compact\microCompact.ts:40`、`:300`、`:373`：microcompact 只处理 compactable tool results，cached compact 在 API 层删旧工具结果。
- `F:\ccb-source\src\query.ts:1688`、`:1750`：工具批次结束后生成 `tool_use_summary`，不是把 raw tool XML/JSON 当 assistant 正文上屏。
- `F:\ccb-source\src\services\toolUseSummary\toolUseSummaryGenerator.ts:15`、`:55`、`:92`：tool summary 目标是一行短标签，工具 input/output 被截断，失败不阻塞主链。
- `F:\ccb-source\src\utils\permissions\filesystem.ts:1365`：acceptEdits 在 cwd 内允许普通写入，危险边界留在权限/路径检查层。
- `F:\ccb-source\src\components\TextInput.tsx:88`、`F:\ccb-source\src\hooks\useTextInput.ts:67`、`:104`、`F:\ccb-source\src\components\PromptInput\PromptInput.tsx:281`、`:298`：TextInput/cursorOffset 是受控状态，输入和光标不靠不稳定 overlay workaround。
- `F:\ccb-source\src\components\permissions\PermissionRequest.tsx:77`、`:198`、`F:\ccb-source\src\hooks\toolPermission\handlers\interactiveHandler.ts:201`：权限 UI 按工具分发，自动判断有让位机制，普通路径少打扰但执行边界仍守住。

这些只作为产品行为参考；本轮未复制 CCB 可疑源码实现。

## 删除/停用的本地关键词抢入口

- 删除 `packages/tui/src/index.ts` 中 `handleNaturalInput()` 的 workflow plan 自然语言 dispatch。
- 删除同文件 `extractWorkflowPlanNaturalGoal()` 正则入口。
- `natural-command-bridge.ts` 保留为 slash help / 命令面板 / 建议目录，不接回 `handleNaturalInput()` 主链自动执行。
- 普通自然语言 invariant 已翻转：`工作流计划 修复 TUI 噪音`、`拆成工作流继续做`、`多开智能体审计代码`、`刷新索引并继续修复`、`帮我修 bug/写报告/继续开发` 都返回 `message`。
- 显式 `/workflows plan 修复 TUI 噪音` 仍本地处理。
- 本地处理例外保留：pending approval 的 yes/no/details、pending Start Gate、无模型配置 setup 引导、以 `/` 开头的 slash command。

## 模型工具驱动能力

- Index 已有真实模型工具：`IndexStatusInspect`、`IndexRefresh`、`IndexRepair`，刷新/修复仍进权限管道。
- 新增最小 `CommandProposal` 模型工具：模型可结构化提出 workflow/agent/job/memory/index/status 的显式 slash command，但该工具不执行命令，只返回短提案，避免本地自然语言 router 复活。
- `SearchExtraTools` / `ExecuteExtraTool` 继续作为 deferred 工具发现/执行入口；mutating MCP/codebase-memory 写入拒绝文案改成人话，不再把 `ExecuteExtraTool / mutating / IndexRefresh` 堆到主屏。

## 安全边界保留

- auto-review 自动放行低风险工作区 Write/Edit/MultiEdit 和只读/会话内工具。
- 危险 Bash、敏感文件、路径越界、删除、权限变更、联网/安装等仍由 `decidePermission()`、policy engine、hard deny 执行层拦截。
- IndexRefresh 在 auto-review 下普通刷新丝滑执行；危险行为不因此绕过。
- final answer gate、evidence gate、failure learning、architecture runtime 核心语义保留；用户主屏只看人话结果，内部系统事件保留在 transcript/details。

## Context 收口

- 删除产品路径里的固定 `MAX_CONTEXT_CHARS = 48_000` 硬停。
- provider 前上下文阈值改为按当前 executor route/model 推导：优先 `route.maxInputTokens`，否则用 known model `contextWindow` 减输出 headroom，最后才用内部 fallback。
- 过大历史上下文先 `compactMessagesToFit()` 自动瘦身后继续请求。
- 自动压缩后仍过大时，主屏只提示缩短最新输入或摘要旧上下文；system event 也不再写 `550955/48000 chars` 这类数字。

## Tool Protocol 源头治理

- assistant 主屏继续净化 raw `<tool_use>`、JSON tool_use、fenced tool schema，并支持流式分片。
- 新增源头治理：模型把 tool protocol 当正文输出时，Linghun 丢弃该 streaming block，回灌一次“请使用结构化工具调用，不要把工具协议写成正文”。
- 如果重试后仍输出 raw protocol，主屏只给短提示；不创建工具成功假象，不写 `tool_result` evidence，不执行任何非结构化工具请求。

## 用户主屏前后对比

| 场景 | 之前 | 现在 |
| --- | --- | --- |
| “工作流计划 修复 TUI 噪音” | 本地正则转 `/workflows plan` | 普通消息进模型；模型可用 `CommandProposal` 提显式命令 |
| “刷新索引并继续修复” | 可能被本地索引/control router 猜测 | 普通消息进模型；IndexRefresh 由结构化工具触发 |
| raw `<tool_use ...>` | 可能作为 assistant 正文上屏 | 丢弃 raw 正文，提醒模型用结构化 tool call；失败不假执行 |
| 长上下文 | 暴露 `550955/48000 字符` | 自动 compact；仍失败只提示缩短/摘要 |
| auto-review 写 `report.md` | 普通写入还可能前台确认/刷 preflight | 低风险工作区写入丝滑执行 |
| IndexRefresh | auto-review 仍可弹确认或显示内部名 | 普通刷新丝滑；权限面板显示“刷新代码索引” |
| `/btw 当前在做什么` | 噪音大，可能刷内部状态 | 短状态：当前任务、current step、elapsed |
| 后台任务行 | log/next 堆主屏 | 主屏只保留动作、状态、当前步骤、elapsed |

## 用户 6 个实测问题闭环

1. raw `<tool_use ...>` 上主屏：`tool-output-presenter.ts` 净化 + `index.ts` retry/drop；测试 `raw tool_use text is retried...`、`repeated raw tool_use...`。
2. `/btw 当前在做什么` 噪音大：显式 slash 返回短状态；测试 `/btw 当前在做什么只返回短状态...`。
3. `550955/48000 字符` 硬停暴露：固定 48k 产品阈值删除；测试 `long context is auto-compacted...`。
4. 输入空格有效但光标不动：删除 task/pending inline cursor workaround；Composer cursor 回归已覆盖。
5. auto-review 下普通 `report.md` / IndexRefresh 还要提权：普通 workspace edit 与 IndexRefresh 丝滑；危险动作仍 deny/ask；相关 auto-review 测试覆盖。
6. 任务中没有 elapsed/current step：footer/background task 增加 current step 和 elapsed；job presenter/view-model 测试覆盖。

## 本轮实际源码改动

- `packages/tui/src/index.ts`：删除 workflow plan NL 截胡；上下文阈值改为模型/route 驱动；raw tool protocol retry/drop；`CommandProposal` 执行分支；IndexRefresh auto-review 执行层降噪；状态/任务摘要沿用短输出。
- `packages/tui/src/model-loop-runtime.ts`：新增 `CommandProposal` 最小模型工具定义。
- `packages/tui/src/index-tool-runtime.ts`：同步 `IndexRefresh` / `IndexRepair` 模型工具描述，明确 default ask、auto-review 普通 workspace 刷新可直行、plan 拒绝、危险/修复/持久 ignore 仍走权限管道；删除“default/auto-review 都需确认”的旧契约。
- `packages/tui/src/tool-output-presenter.ts`：净化器增加 raw protocol metadata，供主链决定 retry/drop。
- `packages/tui/src/tool-output-presenter.ts`：Bash start banner 源头净化长 `--log-path`、checkpoint id、raw JSON/schema/debug 片段；执行输入不变，只收窄主屏展示。
- `packages/tui/src/tui-messages.ts`、`packages/tui/src/tui-permission-runtime.ts`：auto-review 文案改成“低风险工作区编辑自动放行，危险动作仍守边界”。
- `packages/tui/src/mcp-index-runtime.ts`、`packages/tui/src/shell/view-model.ts`：内部工具名降噪，索引权限显示人话。
- 测试返修：`model-loop-runtime.test.ts` 锁定 Index 工具描述不再宣称 auto-review 必须确认；`tool-output-presenter.test.ts` 锁定 Bash banner 不泄漏长命令/log path/checkpoint/raw JSON；`failure-learning-presenter.test.ts` 锁定 failure/final-gate 主屏不露 sourceRef/gate retry/debug；`help-panel.test.ts` 锁定 core help 短输出；`job-runner-presenter.test.ts` 锁定 shell/git/process 主屏行只显示状态/步骤/elapsed。
- 延续上一轮已完成收口：`compact-context.ts` 自动瘦身、Composer cursor、footer elapsed/current step、background task 主屏降噪、auto-review workspace edit 权限收窄。
- 测试同步覆盖 natural routing、模型工具 proposal、raw tool protocol、context compact、auto-review、安全边界、Ctrl+O、/btw/status、Composer cursor。

## 返修审计：Index 权限文案

- 本轮有源码改动：`packages/tui/src/index-tool-runtime.ts`。
- 源码事实：`IndexRefresh` description 现在写明 `default asks for confirmation`、`auto-review may directly run an ordinary workspace refresh`、`plan refuses mutating execution`；`IndexRepair` description 写明 `default asks before writing`、`auto-review can proceed only when ... low risk`、危险/path-boundary 仍 ask/deny。
- 执行事实：`packages/tui/src/index.ts` 的 `executeIndexToolUse()` 仍复用 `decidePermission("Write", { path: ".linghun/index" })`；auto-review 对 ask 的普通索引写入走 `executeApprovedIndexToolUse()`，危险 shell/network/install/delete 不在这里放行。
- 测试证据：`packages/tui/src/model-loop-runtime.test.ts` 新增 `Mature UX Cutback: index tool descriptions match auto-review permission behavior`，断言工具描述不再宣称 default/auto-review 都必须确认，也不再使用旧的 mutating-confirmation 泛化表达。
- 全仓搜索结果：产品源码/文档中的旧 auto-review 确认契约文案已清理；精确旧短语仅保留在测试的反向断言里。

## 返修审计：Startup 首屏

- 本轮无源码改动；已有源码事实证明主屏是短摘要，不是多段 intro/debug。
- 源码事实：`packages/tui/src/index.ts` 的 `formatHomeScreen()` 只输出项目、模型、权限模式、直接描述目标、`/help` 提示和模式行为；没有 provider route dump、schema、gate、checkpoint、log path。
- Ink 主屏事实：`packages/tui/src/shell/view-model.ts` 将 `setupNeeded` 仅在 task/pending 模式转成一条 `setupHint`，home 首屏不显示 setup 大段说明；home 模式不显示 background blocks。
- 测试证据：`packages/tui/src/shell/view-model.test.ts` 已覆盖 `renders the mature home without setup or composer border cards`、`Home does not show background blocks`、`setupNeeded=true in home mode keeps the default composer placeholder`、`Home does not show large setupHint block when setupNeeded=true`。
- 结论：startup 首屏当前已是品牌/状态/输入入口的短主屏；完整 provider/setup 路径只在 setup flow 或 doctor/details 出现，本轮无需源码改动。

## 返修审计：Doctor / Status / Help

- 本轮有测试改动，无产品源码改动。
- 源码事实：`packages/tui/src/command-panel-runtime.ts` 要求高级 slash 的 `summary / sections` 只放用户关键状态，`guard / runtime / schemaLoaded / source / endpoint` 进入 `detailsText` 或显式 doctor；Ink 下 `showCommandPanel()` 设置 `context.commandPanelState`，主屏渲染摘要，Ctrl+O 展开详情。
- 迁移事实：`packages/tui/src/model-command-runtime.ts` 把 `formatModelRouteDoctor()` 放入 `detailsText`；`packages/tui/src/mcp-index-runtime.ts` 把 `formatMcpStatus()` / `validateMcpServers()` 放入 `detailsText`；`packages/tui/src/job-agent-command-runtime.ts` 把 `formatJobStatus()`、`formatJobReport()`、`formatJobLogs()` 放入 `detailsText`。
- Help 事实：`packages/tui/src/shell/models/help-panel.ts` 的 core help 只有 8 条核心入口，`/status` 被过滤；advanced/details 明确分组，不在主屏刷完整命令表。
- 测试证据：`packages/tui/src/advanced-slash-panel-invariant.test.ts` 静态断言 migrated doctor/status/log/report formatter 走 `showCommandPanel({ detailsText })`，不回退 bare `writeLine(output, formatXxx)`；本轮新增 `packages/tui/src/shell/models/help-panel.test.ts` 断言 core help 短且不含 `schema/debug/sourceRef/gate retry/checkpoint id/log path`。
- 结论：doctor/status/help 已是短主屏 + details 分层；plain/non-ink 仍保留 legacy 文本输出用于脚本兼容，不是 Ink 主屏污染。

## 返修审计：Failure Learning / Architecture / Final Gate

- 本轮有测试改动，无 final gate 核心语义改动。
- Failure Learning 源码事实：`packages/tui/src/failure-learning-presenter.ts` 的 `buildFailureLearningPanel()` 主屏只输出 active/resolved/ignored 计数、最多 3 条 `avoidNextTime`、风险提示；`sourceRef`、root cause、severity、lastSeen 只在 `formatFailureLearningDetails()` 的 `detailsText`。
- Architecture 源码事实：`packages/tui/src/architecture-runtime.ts` 的 directive 明确要求“主屏只输出 1-2 行面向用户的行动摘要”，完整 `Architecture Card` 只用于内部记录/details/debug/验证；它不改权限模式、不替代 Start Gate/permission。
- Final Gate 源码事实：`packages/tui/src/index.ts` 中 `final_answer_claim_gate retry/downgrade kinds=...` 只通过 `appendSystemEvent()` 写系统事件；用户可见 assistant block 会 `discardAssistantBlock()` 或 `replaceAssistantBlockContent()`，再输出降级后的人话文本。`sourceRef: event:final_answer_claim_gate` 只进入 failure record。
- 测试证据：本轮新增 `packages/tui/src/failure-learning-presenter.test.ts` 断言 failure/final-gate 主屏不含 `sourceRef`、`event:final_answer_claim_gate`、`gate retry`、`debug=`。
- 结论：反幻觉/evidence/final gate 语义保留在执行层和 system event；主屏不展示 gate retry kinds、sourceRef 或 debug 字段。

## 返修审计：Shell / Git / Process

- 本轮有源码和测试改动：`packages/tui/src/tool-output-presenter.ts`、`packages/tui/src/tool-output-presenter.test.ts`、`packages/tui/src/job-runner-presenter.test.ts`。
- Shell/process 源码事实：`packages/tui/src/job-runner-presenter.ts` 的 `formatBackgroundTask()` 主屏只显示 `[background] title · status · currentStep · progress · elapsed`，不输出 `logPath/outputPath/nextAction/raw result`；这些留在 `formatBackgroundDetails()` / `formatBackgroundOutputDetails()`。
- Git 源码事实：`packages/tui/src/git-command-runtime.ts` 的 status/stable/worktree/doctor 均用 `showCommandPanel()`，长 `formatGitStatusDetails()` 放入 `detailsText`。
- Job/process 命令事实：`packages/tui/src/job-agent-command-runtime.ts` 的 `/job status`、`/job report`、`/job logs` 主屏 summary 只显示 job id/status 和 Ctrl+O 提示，完整 status/report/logs 进 `detailsText`。
- 本轮修复事实：`formatToolStart()` 对 Bash 主屏 banner 新增展示层净化，长 `--log-path`、checkpoint id、raw JSON/schema/debug 片段不会进主屏；命令实际执行输入不变。
- 测试证据：本轮新增 `packages/tui/src/tool-output-presenter.test.ts` 断言 Bash banner 不泄漏长命令/log path/checkpoint/raw JSON；新增 `packages/tui/src/job-runner-presenter.test.ts` 断言 shell/git/process primary row 不含长命令、log path、checkpoint id、raw JSON，仍保留 elapsed。
- 结论：shell/git/process 主屏现在是动作、状态、当前步骤、耗时；长命令、日志路径、checkpoint id、raw JSON/schema 下沉到 details/log。

## 验证结果

已通过：

- `corepack pnpm exec tsc --noEmit`
- `corepack pnpm typecheck`
- `corepack pnpm --filter @linghun/tui exec vitest run src/model-loop-runtime.test.ts src/failure-learning-presenter.test.ts src/tool-output-presenter.test.ts src/job-runner-presenter.test.ts src/shell/models/help-panel.test.ts`：通过，5 files / 176 tests
- `corepack pnpm --filter @linghun/tui exec vitest run`：通过，58 files / 2232 tests
- `corepack pnpm --filter @linghun/providers exec vitest run`：通过，1 file / 124 tests
- `corepack pnpm --filter @linghun/cli exec vitest run`：通过，1 file / 8 tests
- `corepack pnpm --filter @linghun/tui build`
- `corepack pnpm --filter @linghun/cli build`
- `git diff --check`

## Git 状态

未 commit。  
未 staging。  
未创建新阶段。
