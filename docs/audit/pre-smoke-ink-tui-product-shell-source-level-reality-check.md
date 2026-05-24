# Pre-Smoke Ink TUI Product Shell Source-Level Reality Check

> Scope: Pre-Smoke Ink TUI Product Shell Gate report. Slice A was Source-Level Reality Check + Design System Draft only; Slice B adds Ink Shell Foundation implementation notes and scoped validation. This report still does not claim real smoke readiness, Beta PASS, or open-source readiness.

## 1. Executive Summary

Pre-Smoke Ink TUI Product Shell Gate 的 Slice A baseline 结论：Linghun 当时的终端主链路已经具备 provider/model、permission、Start Gate、tool output、doctor、background/job、readiness、NCB、config 等大量底层能力，但 Slice B 实现前的可见 TUI shell 仍是 `readline` + `writeLine` + 字符串 presenter 的 REPL 形态，不是成熟 Ink/React 产品壳。

Slice B current delta：当前已新增 Ink Shell Foundation scoped implementation：TTY 主路径可进入 `ShellApp`，fallback prompt 已改为使用 `messages.inputPrompt`，composer placeholder 已覆盖 zh-CN / en-US，apiKey step 已通过 `ShellViewModel.composer.masking` + Ink Composer `*` 显示完成可见脱敏。但这只代表 Ink Shell Foundation scoped pass，不代表完整 TUI 成品完成，不代表 real provider smoke ready、Beta PASS、smoke-ready 或 open-source-ready。

Slice A 只完成事实核对和设计草案：

- `git status --short`：无输出，开工时工作区干净。
- codebase-memory 索引：`F-Linghun` status=`ready`，nodes=`1977`，edges=`4216`。
- 已按用户指定清单读取 Linghun 文档、TUI/runtime/CLI/config 源码和测试；大文件按相关章节、入口、函数和 grep 定位读取。
- 已按用户指定清单读取 opencode、CCB / Claude Code、Warp 本地参考源；仅提取行为、交互和设计系统原则，不复制源码。
- 本报告创建于 `docs/audit/pre-smoke-ink-tui-product-shell-source-level-reality-check.md`。

总体判断：

- 当前不能进入真实 provider + 真实项目 smoke；必须先完成本 gate 后续实现切片，并通过对应 snapshot / fallback / performance / i18n 验证。
- Ink/React 方向符合蓝图“标准 Ink，不自研渲染器”的既定选择；但后续实现必须复用现有 provider/tool/permission/evidence/cache/runner/runtime，不允许新造第二套系统。
- `readline/writeLine` 不应被一次性删除；应降级为 non-TTY/headless/fallback 路径，TTY 产品壳再由 Ink renderer 承接。
- 当前 focused/local/mock PASS、历史 A-C acceptance、Closure A/B/C local closure 等只能作为 scoped evidence，不能写成整体 ready、Beta PASS、smoke-ready 或 open-source-ready。

## 2. Source-Level Reality Check

### Slice A baseline / implementation before Slice B

本节保留 Slice A 当时的 Source-Level Reality Check 事实：它描述的是 Slice B 实现前的 baseline，不等同于 Slice B 之后的当前代码状态。已被 Slice B 修掉的点在对应条目中用 “Slice B current delta” 单独标注。

已读取 Linghun 文件：

- `START_NEXT_CHAT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `docs/delivery/TEMPLATE.md`
- `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- `packages/tui/package.json`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/runtime-status-presenter.ts`
- `packages/tui/src/permission-presenter.ts`
- `packages/tui/src/tool-output-presenter.ts`
- `packages/tui/src/request-lifecycle-presenter.ts`
- `packages/tui/src/job-runner-presenter.ts`
- `packages/tui/src/terminal-readiness-presenter.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `apps/cli/src/cli.ts`
- `packages/config/src/index.ts`

源码事实：

- Slice A baseline：`packages/tui/package.json` 当时只依赖 `@linghun/config`、`@linghun/core`、`@linghun/providers`、`@linghun/shared`、`@linghun/tools`；没有 `ink`、`react` 或 `@anthropic/ink` 依赖。Slice B current delta：当前已仅在 `@linghun/tui` 增加 `ink`、`react`、`@types/react`，用于 Ink Shell Foundation。
- `apps/cli/src/cli.ts` 在无参数时动态 import `@linghun/tui` 并调用 `runTui()`；`--help` / `--version` 快速路径不会加载 TUI、模型、MCP、索引、验证器、插件或 cache 统计系统。
- Slice A baseline：`packages/tui/src/index.ts` 中 `runTui()` 是交互入口，加载 config/storage/session/tool/context/cache/mcp/index/memory/skills/workflows/hooks/plugins/remote/background 等运行时状态，随后通过 `writeLine()`、`writeStatus()`、`readInputLines()` 驱动 REPL。Slice B current delta：`runTui()` 仍是唯一 runtime/controller 入口，但 TTY 主路径已新增 Ink Shell Foundation，符合条件时进入 `ShellApp`；non-TTY/headless/plain/dumb/Ink failure 仍保留 fallback 路径。
- Slice A baseline：TUI 输入由 `node:readline/promises` 的 `createInterface` 和 `readInputLines()` 管理。TTY 路径设置 raw mode，并固定输出 `你> `；non-TTY 路径读取 stdin chunks 后按行 yield。Slice B current delta：fallback readline 仍保留，但 prompt 已改为使用 `messages.inputPrompt`，不再在 `readInputLines()` 中硬编码 `你> `。
- Slice A baseline：输出由 `writeLine(output, text)` 直接 `output.write(`${text}\n`)`；状态栏由 `writeStatus()` 拼接 `formatRuntimeStatusLine()`；首页由 `formatHomeScreen()` 拼接字符串。Slice B current delta：TTY Ink path 已新增 ShellViewModel、plain renderer、Ink renderer、ShellApp、Composer、StatusTray、ProductBlock；这仍只是 foundation，不是完整 TUI 成品。
- Slice A baseline：首页文案是中文 `项目 <project> · 模型 <model> · 模式 <mode>`，随后提示“可以直接说……需要精确命令时，用 /help 查看”；英文是 `Project <project> · Model <model> · Mode <mode>` 和 “You can describe a goal directly…”；不是成熟 composer / shell layout。Slice B current delta：Ink composer 已有 zh-CN / en-US placeholder，但 Home / First Run / Repo State 的成熟产品化仍留在 Slice C。
- Slice A baseline：字典在 `messages` 中维护 `zh-CN` / `en-US`，但 `inputPrompt` 仍是 `你> ` / `you> `，且 `readInputLines()` 直接硬编码 `你> `，没有使用 `t(context, "inputPrompt")`。Slice B current delta：fallback prompt 已改为使用 `messages.inputPrompt`；Ink composer placeholder 已支持 zh-CN `我能帮您做点什么？` 与 en-US `What can I help you with?`。
- Slice A baseline：missing model / provider config 路径会输出“检测到还没有完成模型配置。输入 /model setup 填写 API 地址、API key、模型名称和推理等级。”并显示 provider.env 模板位置。该路径仍以 slash 命令为主路径。Slice B current delta：apiKey step 已通过 `ShellViewModel.composer.masking` + Ink Composer `*` 显示完成可见脱敏；未修改 provider 存储策略，未改变 `/model setup` 流程语义，未保存 key。
- `runtime-status-presenter.ts` 已有轻量 status line：session/model/mode/cache/index/gate/background，并做长度截断。
- `permission-presenter.ts` 已有 local/model tool permission 文案分层：local prompt 包含 tool/reason/risk/scope/next，model prompt 更短，但仍是纯文本。
- `tool-output-presenter.ts` 已有 `primary/details/debug` 概念和 summary-first tool output；Read/Grep/Glob/Bash/Write/Edit/MultiEdit 默认摘要化，Todo 限制 8 条。
- `request-lifecycle-presenter.ts` 已覆盖 request started、slow waiting、tool running、continuation、permission waiting、provider failure、empty response、report guard 等文案。
- `job-runner-presenter.ts` 已覆盖 background/job/runner doctor、runner fallback、heartbeat/log/status、cancelled/timeout/stale 不等于 PASS 的文案。
- `terminal-readiness-presenter.ts` 已覆盖 readiness doctor/status/problems lite，且明确 local/static only，不是真实 smoke、Beta PASS 或 open-source-ready。
- `natural-command-bridge.ts` 已有 command capability catalog、natural intent routing、Start Gate、risk handler、runtime status for model、capability answer 等能力，是用户层“自然语言优先、slash 高级精确入口”的现有底座。
- `packages/config/src/index.ts` 已有 provider/model/permission/language/workspaceTrust/mcp/cache/nativeRunner/remote 等配置结构；provider config 支持 `deepseek` 与 `openai-compatible`，含 `supportsTools`、`endpointProfile`、`compatibilityProfile`、`reasoningLevel`、`includeUsage`。
- `packages/tui/src/index.test.ts` 已覆盖 runTui、TTY input helper、help/default command discoverability、model setup、model doctor key 脱敏、readiness、long model name、provider failure、workspace trust、terminal readiness view、tool output presenter 等大量 focused/local 行为，但未见 Ink snapshot、narrow terminal shell layout、no-color shell fallback、composer visual regression 这类产品壳测试。

文档事实：

- `LINGHUN_IMPLEMENTATION_SPEC.md` 推荐目录中曾设想 `apps/tui/src/App.tsx` 和 `components/`；当前实际实现集中在 `packages/tui/src/index.ts` 与 presenter 文件中。
- `LINGHUN_IMPLEMENTATION_SPEC.md` 明确“终端 TUI 优先”、`core/provider` 不依赖 UI、tool 必须走权限管道，并在 TUI 输出层协议中规定 primary/details/debug，且说明 Phase 15.5 起 TUI polish 可以把 envelope 渲染成 block/panel，但 block/panel 只是显示形态，不是新事实来源。
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` 明确默认选择：TUI 使用标准 Ink，不自研终端渲染器；Warp block/panel、OpenCode、CCB 都只作为成熟行为参考。
- `docs/delivery/pre-open-source-terminal-product-completion-gate.md` 明确当前是 Phase 15 pre-smoke 之后、真实全量实测之前的终端候选产品完整度门禁；A-C 的 historical ready 不再是当前直接 smoke 入口；focused/mock/local PASS 不能推断整体 ready。
- `START_NEXT_CHAT.md` 当前任务状态仍强调：不得从历史 closure、focused/mock/local/synthetic/scoped PASS 或单个 live text PASS 推断 Beta readiness PASS；真实 smoke 前必须由用户确认，并且当前路线已要求终端产品完整度先闭合。

### remaining gaps after Slice B

以下保留 Slice A baseline 的风险判断，但区分 Slice B 已修补内容与仍未完成范围：

- Slice A baseline 的“没有 Ink/React renderer”已由 Slice B current delta 缩小为：当前已有 Ink Shell Foundation、ShellViewModel、plain renderer、Ink renderer 和最小 component tree；但这不是完整 TUI 成品，Home / First Run / Repo State 仍在 Slice C。
- Slice A baseline 的“输入区是 `你> ` readline prompt”已由 Slice B current delta 部分修复：fallback prompt 已改用 `messages.inputPrompt`，Ink composer 已有 zh-CN / en-US placeholder；但 multi-line composer、attachment/context pills、command palette、permission card、running card 仍不是 Slice B 范围。
- Slice B current delta 已补 apiKey step 可见脱敏：`ShellViewModel.composer.masking` 只来自 `context.pendingModelSetup?.step === "apiKey"`，Ink Composer 以同长度 `*` 显示；fallback readline 既有 masking 继续保留。未改 provider 存储策略，未改 `/model setup` 流程语义，未保存 key。
- 当前启动输出 / Home / First Run / Repo State 仍未完成产品化：启动、missing model、repo trust、project rules hint 的成熟 card 化仍在 Slice C。
- Permission / Doctor / Tool Blocks 仍未完成产品化：permission、Start Gate、running task、tool output、doctor/error/details 的统一 ProductBlock/card 渲染仍在 Slice D。
- Polish / performance / real TTY screenshot / final verification 仍未完成：snapshot matrix、真实交互式 TTY 截图、render performance guard、details/debug 分层回归和最终 gate 验证仍在 Slice E。
- 内部术语仍有泄漏风险：源码中用户可见路径仍可能出现 `Start Gate`、`Plan approval`、`provider.env`、`endpointProfile`、`tools/tool_choice`、`tool_result`、`local/static only`、`readiness` 等；报告/doctor 可保留，主 shell 默认视图需继续降噪。
- Windows / PowerShell host 限制尚未完整产品化：当前有 GB18030 decode、TTY 判断、no-color/plain fallback 和 Windows CLI 兼容说明，但没有完整 mature shell 对 PowerShell/Windows Terminal/raw mode/ANSI/no-color/中文宽度限制的可见降级策略。
- 当前 tests 仍主要是 focused/local 回归；Slice B focused tests 覆盖 placeholder、masking、80/60/40、no-color/fallback 等 foundation 行为，但未替代真实 TTY screenshot、真实 provider smoke 或最终产品级验证。

### minimal touch points

后续实现应最小触碰这些现有点：

- `packages/tui/src/index.ts`
  - 保留现有 runtime/controller 事实来源。
  - 将 `runTui()` 逐步拆成 controller / renderer / view model，而不是重写 provider/tool loop。
  - 保留 `readInputLines()` 作为 non-TTY/headless/fallback。
- `packages/tui/src/*presenter.ts`
  - 继续作为 view model 的事实和文案来源，不把 presenter 旁路成新 UI 状态。
  - permission、tool output、runtime status、job runner、terminal readiness 都应渲染为 Ink blocks/cards，而不是重新实现业务判断。
- `packages/tui/src/natural-command-bridge.ts`
  - 保持自然语言主路径与 slash 精确路径的统一能力目录。
  - Command palette / slash popover 只能消费 catalog，不能新增第二套命令 registry。
- `packages/config/src/index.ts`
  - 只在必须时读取已有 language/theme/no-color/terminal capability 配置；本 gate 第一步不改配置。
  - 后续若新增 theme setting，需要单独阶段和用户确认，不在第一步做。
- `apps/cli/src/cli.ts`
  - 只需维持 `runTui()` 调用边界；`--help` / `--version` 快路径不得加载 Ink-heavy runtime。
- `packages/tui/src/index.test.ts` 或后续新增测试文件
  - 后续实现时补 Ink snapshot / width / i18n / fallback focused tests。

### forbidden duplicate systems

后续严禁为 Ink shell 新增这些第二套系统：

- 第二套 provider/model resolver。
- 第二套 tool registry、tool loop、tool result 格式或 permission pipeline。
- 第二套 Start Gate / confirmation / approval 状态机。
- 第二套 evidence、transcript、cache、index、MCP、background task、job/runner runtime。
- 第二套 command catalog、slash registry、natural intent router。
- 第二套 config schema 或独立存储 provider key 的路径。
- 第二套 doctor/readiness 判定。
- 自研终端渲染器、ANSI 布局引擎或全新 GUI 平台。
- 把参考项目源码复制进 Linghun；只能吸收行为、设计原则、验收口径和可公开验证的交互边界。

## 3. Reference Behavior

已读取参考源：

- `F:\freecodex\opencode-source\packages\app\src\components\prompt-input.tsx`
- `F:\freecodex\opencode-source\packages\app\src\components\prompt-input\slash-popover.tsx`
- `F:\freecodex\opencode-source\packages\ui\src\components\dock-surface.tsx`
- `F:\freecodex\opencode-source\packages\ui\src\components\dock-surface.css`
- `F:\freecodex\opencode-source\packages\ui\src\theme\themes\oc-2.json`
- `F:\ccb-source\src\components\PromptInput\PromptInput.tsx`
- `F:\ccb-source\src\components\permissions\PermissionDialog.tsx`
- `F:\ccb-source\src\utils\theme.ts`
- `F:\ccb-source\src\components\LogoV2\WelcomeV2.tsx`
- `F:\freecodex\warp-source\crates\warp_core\src\ui\theme\color.rs`

### opencode

可参考行为：

- Prompt input 是成熟 composer，不是单行 prompt：支持 normal/shell mode、history、IME composition、Shift+Enter 换行、Escape 取消/退出模式、附件、image attachments、file/agent pills、@ mention、slash popover。
- Slash popover 是轻量浮层：展示 trigger、title、description、keybind、来源 badge；支持 keyboard navigation、active item scroll into view、空结果 fallback。
- Composer 的普通输入与 shell mode 有清晰区别：`!` 在开头可进入 shell mode，shell/normal mode 有不同 history 与交互提示。
- Dock surface 抽象把 shell 与 tray 分开：shell 是 raised surface，tray 可 attach top，形成输入区与状态/附件区的视觉层级。
- Theme tokens 不是零散颜色：`text-strong/base/weak/weaker`、`border-weak`、`surface-raised/base`、`success/warning/error/info/interactive/diff` 分层明确。

进入 Linghun 的原则：

- 自研 Ink composer 应吸收“composer + tray + popover + mode pill + context pills”的产品结构。
- Command palette / slash popover 必须消费 Linghun 现有 `CommandCapability`，不要复制 opencode 的 command context。
- 不复制 SolidJS 实现、DOM editor、CSS 或具体 token 值；仅参考交互结构与信息密度。

### CCB / Claude Code

可参考行为：

- CCB PromptInput 是 React/Ink 生态下的成熟输入组件，包含 command queue、overlay、history、paste/image refs、background tasks、terminal setup detection、prompt overlay、modal state、escape/abort、shell/command handling 等复杂交互边界。
- CCB PermissionDialog 使用 Ink `Box` 组成轻量 permission card：上边框、title/subtitle、padding、可附 worker badge/titleRight；权限不是纯文本流，而是明确 decision surface。
- CCB theme 明确区分 semantic colors、diff colors、permission/prompt border/plan/fast mode/selection/user message background，并提供 ANSI theme、dark/light、daltonized 主题。
- CCB WelcomeV2 是定宽欢迎卡，区分 light/dark/Apple Terminal，说明成熟 TUI 会根据 terminal host 做兼容渲染，而不是盲目输出同一套 ANSI。

进入 Linghun 的原则：

- Permission / Start Gate / model setup / trust 应渲染为 Ink card，不再默认刷长文本。
- 首页可以有轻品牌和短引导，但必须比当前启动流更短、更行动导向。
- Theme draft 必须包含 truecolor 与 ANSI/no-color fallback，不把颜色当唯一语义。
- 不复制 CCB 源码、内部 API、遥测、专有 prompt 或具体 ASCII art；只参考成熟边界、布局密度和可访问性策略。

### Warp

可参考行为：

- Warp 主题代码把核心颜色和功能颜色分层：foreground/background/accent、surface_1/2/3、outline、main/sub/hint/disabled text、button hover/click、block selection、terminal ANSI overlay。
- 颜色派生强调 contrast：文本颜色按背景选择，disabled/hint/sub text 用 opacity 分级；ANSI 颜色通过 background/foreground blend，避免直接依赖用户终端主题。
- Block/panel 是现代终端信息组织方式：状态、命令、输出、错误和 selection 用 surface/overlay 区分。

进入 Linghun 的原则：

- Linghun 的 Ink shell 应使用 token 化 surface/text/accent/status/diff/permission，而不是每个 presenter 自己选择颜色。
- Block/card 只是显示形态；事实仍来自现有 runtime/evidence/status。
- 不做 Warp 云同步、notebook、重 GUI、动画或鼠标重交互。

## 4. Current Screenshot Findings

说明：本轮没有读取单独截图文件；以下按用户给出的 current screenshot finding 分类，并结合源码启动输出事实裁决。

### 启动输出过重

当前 `runTui()` 启动会连续输出 app title、language/trust、status、home screen、intro、project rules hint、provider setup hint。即使每条单独合理，组合后仍像诊断报告，不像成熟 coding shell。

最小修正方向：Ink shell 首页默认只展示一张 Home / First Run card、一行 status tray 和 composer；详情通过 `/doctor`、`/model doctor`、`details` 展开。

### 内部术语泄漏

当前主输出仍可能出现 `Start Gate`、`Plan approval`、`provider.env`、`endpointProfile`、`tools/tool_choice`、`tool_result`、`readiness`、`local/static only` 等术语。报告/doctor/debug 可以保留，但首屏和常规交互应翻译成人话。

最小修正方向：建立 `primary` 文案清单，内部术语默认只进 details/debug/report；Ink card 的 title/summary/nextAction 用用户语言。

### 输入区不成熟

当前输入区是 `你> ` 的 readline prompt；没有 composer 高度、placeholder、mode tray、status tray、command palette、file/context pills、multi-line 输入视觉反馈。

最小修正方向：Ink Shell Foundation 中先做最小 composer：固定 3-5 行高度、placeholder、mode/model/index/cache tray、Enter submit、Shift+Enter newline、Esc cancel/close palette、narrow fallback。

### 缺模型主路径仍依赖 slash

当前缺模型时提示“输入 /model setup”。这对高级用户可用，但真实 first install smoke 应有主路径：卡片说明缺什么、为什么需要、默认按钮/确认路径、跳过路径、doctor 详情路径。

最小修正方向：Home / First Run slice 中把 missing model 渲染为 first-run card：`Set up model` / `Use env provider` / `Skip for now`，slash 保留为精确入口。

### PowerShell/Windows host 限制

当前 CLI 文档强调 Windows 大小写入口，TUI 有 TTY/non-TTY 判断和 `gb18030` decode，但没有在 shell 层显式说明 host capability、raw mode fallback、ANSI/no-color fallback、中文宽度和 PowerShell 限制。

最小修正方向：Ink renderer 启动时只读取低成本 terminal capability；不跑 doctor，不扫仓库。若检测到 no-color/non-TTY/host limitation，使用 plain fallback，并在 details 中说明。

## 5. Ink Renderer Decision

### 为什么必须走 Ink/React

- 蓝图已明确默认选择：TUI 使用标准 Ink，不自研终端渲染器。
- 当前 runtime 已经有大量底层能力，问题不在 provider/tool loop 缺失，而在用户可见 shell 的产品化呈现。Ink/React 可以在不新造业务系统的情况下，把现有 presenter/view model 渲染成稳定组件。
- Ink 适合把 permission、Start Gate、tool output、doctor、background task、running state、home/first-run、composer、command palette 统一为 component tree，并可做 snapshot tests。
- readline/writeLine 无法可靠表达布局层级、卡片、status tray、窄终端 fallback、unicode width、no-color style、focus/palette/composer 状态。
- CCB 已证明 React/Ink 路线能承载成熟 coding TUI；opencode 和 Warp 则证明现代输入区、surface、palette、block 状态是成品体验必要部分。

### readline/writeLine 如何降级为 non-TTY/headless/fallback

- 保留 `readInputLines()`：non-TTY stdin、pipe、脚本化输入、测试环境继续走当前按行读取。
- 保留 `writeLine()` 或等价 plain renderer：当 `stdin.isTTY !== true`、`stdout.isTTY !== true`、`NO_COLOR`、CI、Dumb terminal、Ink 初始化失败、raw mode 不可用时输出当前 summary-first 文本。
- fallback 不应加载 Ink-heavy shell，也不应改变 provider/tool/permission 语义。
- fallback 输出必须继续遵守 primary/details/debug 分层，不能因为回退就暴露 raw tool_result 或内部 flags。
- `--help` / `--version` 仍保持 CLI 快路径，不加载 TUI/Ink/runtime。

### runTui 如何拆 controller / renderer / view model

后续最小拆分建议：

- Controller：保留现有 `TuiContext`、session/model/tool/permission/natural/slash/model loop、signal/abort/background/job 状态。
- View model：新增只读映射层，把 `TuiContext` + presenter output 映射成 `ShellViewModel`、`ComposerViewModel`、`StatusTrayViewModel`、`ProductBlock[]`。view model 不调用 provider、不扫仓库、不跑 doctor。
- Renderer：TTY + Ink renderer 负责 component tree；plain renderer 负责 non-TTY/headless/fallback。
- Input adapter：Ink composer 产生 submit/escape/shift-enter/palette/select 等事件，转给 controller；不直接执行 slash/tool/provider。
- Migration：先让 Ink renderer 只消费现有 controller/view model，不改变业务语义；再逐步替换启动输出和 composer。

## 6. Design System Draft

### color tokens

建议 token 名称，不代表本轮实现：

- `color.text.primary`：主要正文，高对比。
- `color.text.secondary`：说明、metadata。
- `color.text.muted`：弱提示、路径尾部、disabled-like 但仍可读。
- `color.text.disabled`：不可操作项。
- `color.surface.base`：默认终端背景适配。
- `color.surface.raised`：composer/card 背景。
- `color.surface.tray`：composer 附属 tray/status 区。
- `color.border.subtle`：普通边框。
- `color.border.strong`：active/focused card。
- `color.accent.primary`：Linghun 主强调。
- `color.status.info`、`success`、`warning`、`error`、`blocked`、`running`。
- `color.permission.ask`、`deny`、`allow`。
- `color.diff.add`、`diff.remove`、`diff.context`。
- `color.code.path`、`code.command`、`code.key`。

Fallback：

- truecolor：使用 RGB token。
- ANSI：映射到 16 色，参考 CCB ANSI theme 与 Warp ANSI blend 思路。
- no-color：去掉色彩，用 `[OK] [WARN] [ERR] [ASK]`、边框字符、缩进和标题层级表达语义。

### typography roles

终端中不做真实字体切换，只定义文本角色：

- `title`：Home / card title，短句，不超过一行优先。
- `subtitle`：当前 project/model/mode/status 摘要。
- `body`：普通说明。
- `meta`：provider/model/cache/index/background 等低优先级信息。
- `hint`：下一步、快捷键、details 入口。
- `code`：命令、路径、配置键。
- `danger`：阻塞、权限风险、不可继续。
- `success`：已完成、已保存、可继续。

### spacing scale

- `space.0 = 0`
- `space.1 = 1 column`
- `space.2 = 2 columns`
- `space.3 = 1 blank line / 3 columns`，仅用于卡片间。
- `space.compactY = 0`：默认少空行。
- `space.cardPaddingX = 1-2`
- `space.cardPaddingY = 0-1`

原则：默认一屏内可扫读；窄终端减少 padding，不增加长说明。

### composer size

- 默认高度：3 行。
- 最大高度：8 行或终端高度的 30%，超出滚动/截断提示。
- 空输入 placeholder：
  - zh-CN：`我能帮您做点什么？`
  - en-US：`What can I help you with?`
- Composer tray：model/mode/repo trust/index/cache/background，最多一行，窄终端折叠为 compact labels。
- Input modes：normal / shell / details-prompt / permission-prompt；mode 必须可见但不喧宾夺主。

### card padding

- Permission / Start Gate：paddingX=1，paddingY=0/1，顶部 border 或左侧 marker，优先显示 action/risk/scope/choices。
- Tool output：paddingX=1，默认 summary + 1-3 行 preview + details command。
- Error：paddingX=1，title + what happened + impact + next。
- First-run：paddingX=2，最多 5 行主体 + 2-3 个 CTA。

### status tray density

默认只显示稳定、低误导、可行动信息：

- model/provider short label。
- permission mode。
- repo trust。
- index status。
- cache hit rate or `cache?`。
- background running count。
- gate/permission waiting indicator。

不显示：估算费用、raw usage、完整 provider endpoint、完整路径、full evidence id、gateId、debug flag。

### command palette layout

- 触发：`/`、`Ctrl+P` 或等价后续键位。
- 数据源：只消费 `CommandCapability` catalog。
- 默认展示：core commands + natural-language hint。
- 每行：slash / title / short description / risk badge / keybind。
- 来源 badge：builtin / skill / mcp / workflow 只能在有意义时显示。
- 空结果：给出 “No command found; describe your goal directly.” / “没有匹配命令；也可以直接描述目标。”。
- 高风险命令：不隐藏能力，但默认不执行；显示 Start Gate / permission requirement。

### narrow terminal fallback

- `< 60 columns`：单列 compact layout；隐藏长 subtitle；status tray 变短标签；card paddingX=0/1。
- `< 40 columns`：禁用复杂边框；composer placeholder 缩短；tool output 只保留 summary + details command。
- 长路径：显示 basename + tail，完整路径进 details。
- 长模型名：中间截断，保留 provider 与模型尾部关键版本。

### ANSI/no-color fallback

- `NO_COLOR` 或不支持 color：所有状态用文本 marker。
- 不依赖颜色表达风险；必须有 `风险：高` / `Risk: high`、`[BLOCKED]`、`[ASK]` 等文本。
- 边框可降级为 plain separators；避免 Unicode box drawing 在 PowerShell/legacy terminal 中错位。
- 中文宽度按 display width 处理；不能用 JS string length 判断布局宽度。

## 7. Product States Inventory

### first install

目标：用户第一次启动时看到短 Home card + composer，不被配置项淹没。

必须显示：欢迎、当前目录、是否需要选择语言/信任/模型、下一步 CTA。

### missing model

目标：不再只说“输入 /model setup”。

必须显示：缺 API key/base URL/model 的具体 missing 项、推荐设置路径、跳过后限制、doctor 详情。

### repo trust

目标：轻量确认，但边界真实。

必须显示：当前目录、trust/restricted 影响、确认/取消、Start Gate 和 permission 仍生效。

### idle composer

目标：用户知道可直接自然语言开始。

必须显示：placeholder、mode、model、status tray、command palette hint。

### running task

目标：请求/工具/verification/background/job 运行时不污染 composer。

必须显示：当前步骤、可中断方式、后台/日志/details 入口、slow hint。

### permission

目标：权限是 decision card，不是 raw flags。

必须显示：action、tool、risk、scope、reason、choices、rollback/details。

### Start Gate

目标：自然语言高风险动作先轻确认，不替代权限审批。

必须显示：将要进入的 exact action、为什么需要确认、确认方式、取消方式、后续仍需权限审批。

### doctor

目标：doctor 默认 summary-first，details 可展开。

必须显示：BLOCK/WARN/OK、影响范围、下一步；不能默认刷完整诊断矩阵。

### tool output

目标：主屏摘要化，完整输出可查。

必须显示：tool completed/failed、summary、affected files/count/exit code、truncated hint、details/log/fullOutputPath。

### error

目标：错误可操作。

必须显示：what happened、impact、next、details command；不得泄露 key/token/raw request。

### details/debug

目标：高级排查可达但不污染主屏。

必须显示：evidence refs、validation commands、fullOutputPath/logPath、debug-safe sanitized fields。

## 8. i18n zh/en Placeholder

- 本节对应 i18n requirements：默认 zh-CN 文案必须成熟，不混入英文内部模板。
- en-US 文案必须语义等价，不是中文路径的残缺翻译。
- 新增用户可见文案必须进入现有 dictionary 或等价 i18n 层，不能散落在 Ink component 中。
- Slash command、配置键、provider/model id、transcript 结构化字段保持英文。
- 必须新增/使用 composer placeholder：
  - zh-CN：`我能帮您做点什么？`
  - en-US：`What can I help you with?`
- 当前 `readInputLines()` 硬编码 `你> ` 与 `messages.inputPrompt` 未统一，是后续 fallback/i18n 最小修正点。
- Permission / Start Gate / first-run / missing model / doctor / error / details hints 必须全部走同一 i18n 口径。

## 9. Performance Safeguards

Ink renderer 是显示层，不得做重任务：

- render 中不得扫仓库。
- render 中不得跑 doctor。
- render 中不得刷新 index。
- render 中不得读大日志。
- render 中不得读取完整 transcript、完整 evidence、完整 tool output、完整 index result。
- provider/model/status 必须使用已有缓存或 view model。
- command palette 数据必须来自已有 catalog 快照，不在 render 中动态发现 MCP/skills/plugins。
- background/job/status 必须来自 `TuiContext` 或已有 background state，不在 component 中轮询文件系统。
- theme/terminal capability detection 必须 bounded，启动一次即可，不阻塞 first paint。
- 长输出 preview 必须由 presenter/view model 预先截断。
- No-color/narrow terminal fallback 不应加载额外依赖或跑额外诊断。
- 后续 snapshot tests 不得依赖真实 provider、真实 index refresh 或真实 doctor。

## 10. Implementation Slices

### A Source-Level Reality Check + Design System

本轮切片。只产出报告，不改源码、不改 runtime、不改依赖、不进入 smoke。

交付：

- `docs/audit/pre-smoke-ink-tui-product-shell-source-level-reality-check.md`
- existing implementation / gaps / minimal touch points / forbidden duplicate systems
- reference behavior
- design system draft
- implementation slices and test plan

### B Ink Shell Foundation

目标：引入 Ink shell 最小骨架，但不改变 provider/tool/permission 语义。

#### Slice B Implementation Contract

- 本切片真实目标：建立 Linghun TTY 产品壳的 Ink/React 基础架构，让 TTY 启动进入 `ShellApp`，同时保留 non-TTY/headless/plain fallback；本切片只做 shell foundation，不进入真实 provider smoke，不保存 key，不宣布 Beta PASS / smoke-ready / open-source-ready。
- 要新增/修改的文件：预计修改 `packages/tui/package.json`、lockfile、`packages/tui/tsconfig.json`、`vitest.config.ts`、`packages/tui/src/index.ts` 与本报告；预计新增 `packages/tui/src/shell/types.ts`、`view-model.ts`、`plain-renderer.ts`、`ink-renderer.tsx`、`theme.ts`、`components/ShellApp.tsx`、`Composer.tsx`、`StatusTray.tsx`、`ProductBlock.tsx` 和 focused shell tests。若实现中合并文件，必须保持 controller / view model / renderer / fallback 边界清楚，不能把 Ink 组件继续塞回 `index.ts`。
- Ink/React 依赖影响：只允许给 `@linghun/tui` 增加 Ink/React 必需依赖及 TSX 类型/测试所需最小项；不新增桌面端、不引入非 UI 框架的大依赖；`linghun --help` / `linghun --version` 快路径仍由 CLI 直接返回，不加载 TUI runtime 或 Ink-heavy runtime。
- controller / view model / renderer / fallback 分层：`packages/tui/src/index.ts` 继续持有唯一 provider/model/tool/permission/natural command loop；本切片抽出内部 per-line controller handler，Ink composer 与 fallback readline 都调用同一处理路径；`ShellViewModel` 只读映射 `TuiContext` + presenter 输出；Ink renderer 只渲染 view model 并把 submit/escape/enter 事件交回 controller；plain renderer 负责 non-TTY/headless/fallback 输出。
- 不允许新增第二套 provider/tool/permission/command/runtime：不得新建 provider resolver、tool loop、permission pipeline、command/slash registry、doctor/readiness 判定、evidence/cache/job/index/runtime；command palette 和 composer hint 必须消费 `natural-command-bridge.ts` 的现有 capability catalog。
- TTY Ink 与 non-TTY fallback 的选择条件：`stdin.isTTY === true`、`stdout.isTTY === true`、非 `TERM=dumb` 且未设置 `LINGHUN_TUI_PLAIN=1` 时可进入 Ink；`NO_COLOR=1` 不强制回退，但必须使用 no-color tokens/文本 marker；non-TTY、stdout 非 TTY、dumb terminal、plain env opt-in 或 Ink 初始化失败时走 plain renderer + readline/writeLine fallback。
- 本切片验收命令：`corepack pnpm exec vitest run packages/tui/src/index.test.ts`、`corepack pnpm exec vitest run packages/tui/src/shell`、`corepack pnpm typecheck`、`corepack pnpm check`、`git diff --check`。
- 本切片不代表真实 smoke ready：Slice B PASS 只代表 Ink Shell Foundation scoped pass；focused/local/snapshot PASS 不等于真实 provider smoke ready，不等于 Beta PASS，不等于 open-source-ready。

范围：

- 加 Ink/React 依赖仅限 `@linghun/tui`。
- 建立 `ShellViewModel`、plain renderer、Ink renderer、minimal composer/status tray。
- 保留 readline/writeLine fallback。
- 首批 snapshot：zh/en、narrow/no-color/non-TTY fallback。

禁止：重写 model loop、tool loop、permission pipeline。

### C Home / First Run / Repo State

目标：把启动输出、missing model、repo trust、first install 收敛为成熟 Home/First-run cards。

范围：

- Home card。
- Missing model card。
- Repo trust card。
- Project rules hint 降噪。
- Status tray。

禁止：保存 key、扩展 provider 配置 schema、进入真实 smoke。

### D Interaction Blocks

目标：把 permission、Start Gate、running task、tool output、doctor/error/details 渲染为统一 ProductBlock。

范围：

- Permission card。
- Start Gate card。
- Tool output block。
- Running task block。
- Doctor summary block。
- Error block。
- Command palette minimum version。

禁止：新增第二套 evidence/cache/task/status runtime。

### E Polish / Performance / Verification

目标：产品级稳定性。

范围：

- Snapshot matrix。
- 中文宽度、长路径、长模型名。
- Windows / PowerShell / no-color / non-TTY fallback。
- Render performance guard。
- Details/debug 分层回归。
- Final gate report：只在全部通过后再由用户决定是否进入真实 smoke。

禁止：把 focused/local/mock PASS 写成整体 ready。

## 11. Test Plan

后续实现阶段至少覆盖：

- Ink snapshot
  - Home shell。
  - Composer idle。
  - Permission card。
  - Start Gate card。
  - Tool output block。
  - Error block。
- zh/en
  - Placeholder。
  - First-run。
  - Missing model。
  - Permission。
  - Doctor/error。
- narrow terminal
  - 80 columns。
  - 60 columns。
  - 40 columns。
  - 30 columns graceful fallback。
- 中文宽度
  - 中文 project name。
  - 中文路径。
  - 中英混排状态栏。
  - CJK punctuation。
- 长路径
  - Windows drive path。
  - path with spaces。
  - deeply nested path。
- 长模型名
  - openai-compatible long model id。
  - provider/model truncation preserves useful tail。
- missing model
  - no api key。
  - no baseUrl。
  - no model。
  - unsupported tools model。
- repo trust
  - trusted。
  - restricted。
  - non-interactive trust prompt skipped。
- permission
  - ask。
  - deny。
  - allow once。
  - details。
  - high-risk Bash/write/config。
- running task
  - model request waiting。
  - tool running。
  - background task running。
  - cancelled/timeout/stale not PASS。
- no-color fallback
  - `NO_COLOR=1`。
  - dumb terminal。
  - ANSI disabled。
- non-TTY fallback
  - piped stdin。
  - stdout not TTY。
  - readline path remains stable。

Validation rules：

- Snapshot PASS 不等于 real smoke ready。
- Focused tests PASS 不等于 Beta PASS。
- Non-real tests must be clearly scoped。
- Any real provider smoke must wait until this gate closes and user explicitly confirms。

## 12. NOT-DO

- 不进入真实 smoke。
- 不保存 key。
- 不新增第二套 provider/tool/permission/evidence/cache/runner/runtime。
- 不复制参考项目源码。
- 不宣布 Beta PASS / smoke-ready / open-source-ready。
- 不提交 commit。
- 不把 focused/local/mock PASS 写成整体 ready。
- 不把 A-C historical acceptance 当作当前 smoke 入口。
- 不做桌面端、远程通道、插件市场、skill 市场或自研终端渲染器。
- Slice B 后不继续顺手推进 Home / First Run / Interaction Blocks / Polish 切片；下一切片必须由用户确认。

## 13. Handoff Packet

### Slice B 中文自检更新（2026-05-24）

- 独立复检已按用户要求停止；本节只记录本会话单独复检结果。
- 当前 `git status --short`：
  - ` M packages/tui/package.json`
  - ` M packages/tui/src/index.ts`
  - ` M packages/tui/tsconfig.json`
  - ` M pnpm-lock.yaml`
  - `?? docs/audit/pre-smoke-ink-tui-product-shell-source-level-reality-check.md`
  - `?? packages/tui/src/shell/`
- 真实改动文件：
  - 文档：`docs/audit/pre-smoke-ink-tui-product-shell-source-level-reality-check.md`
  - 依赖/锁文件：`packages/tui/package.json`、`pnpm-lock.yaml`
  - TSX 配置：`packages/tui/tsconfig.json`
  - TUI controller/fallback：`packages/tui/src/index.ts`
  - Shell foundation：`packages/tui/src/shell/types.ts`、`view-model.ts`、`plain-renderer.ts`、`ink-renderer.tsx`、`theme.ts`
  - Ink 组件：`packages/tui/src/shell/components/ShellApp.tsx`、`Composer.tsx`、`StatusTray.tsx`、`ProductBlock.tsx`
  - focused tests：`packages/tui/src/shell/view-model.test.ts`
- 依赖变化：仅 `@linghun/tui` 增加 `ink`、`react` 和开发依赖 `@types/react`；未新增桌面端依赖，未引入大型非 UI 依赖。
- TTY Ink 入口：`runTui()` 完成现有 context/gateway/bootstrap 后，通过 `shouldEnterInkShell()` 判断 `stdin.isTTY === true`、`stdout.isTTY === true`、`TERM !== dumb`、`LINGHUN_TUI_PLAIN !== 1`，再动态 import `./shell/ink-renderer.js` 进入 `ShellApp`。
- fallback 保留：non-TTY、stdout 非 TTY、`TERM=dumb`、`LINGHUN_TUI_PLAIN=1` 或 Ink 初始化失败时仍走 `runPlainTui()` / `readInputLines()` / `writeLine()` 路径；`readline/writeLine` 未删除，只降级为 fallback/headless/plain 路径。
- controller 复用：新增内部 `processTuiLine()`，Ink composer submit 与 fallback readline 都调用同一条 per-line 处理路径；没有新增第二套 provider/model/tool/permission/command/runtime。
- i18n 覆盖：composer placeholder 覆盖 `zh-CN` 的 `我能帮您做点什么？` 与 `en-US` 的 `What can I help you with?`；fallback prompt 改为使用 `messages.inputPrompt`，不再在 `readInputLines()` 中硬编码 `你> `。
- key masking 补丁：`ShellViewModel.composer.masking` 只来自现有 `context.pendingModelSetup?.step === "apiKey"`；Ink Composer 渲染时按输入字符数显示 `*`，提交给 controller 的真实 text 不改；fallback readline 既有 `shouldMaskInput` 路径继续保留。未修改 provider 存储策略，未改变 `/model setup` 流程语义，未保存 key，未进入真实 smoke。
- 窄终端 / no-color / non-TTY 覆盖：focused shell test 覆盖 80/60/40 columns、中文长路径、长模型名、no-color 文本 marker、dumb/plain/non-TTY fallback 条件，并补充 apiKey 步骤 masking view model 覆盖；现有 `index.test.ts` 继续覆盖 piped stdin/headless runTui 行为。
- 单独复检命令结果：
  - `corepack pnpm exec vitest run packages/tui/src/index.test.ts`：PASS，176 tests passed。
  - `corepack pnpm exec vitest run packages/tui/src/shell`：PASS，7 tests passed。
  - `corepack pnpm typecheck`：PASS。
  - `corepack pnpm check`：PASS，Biome checked 79 files。
  - `git diff --check`：PASS，无输出。
- 未验证项：没有进入真实 provider smoke；没有进入真实项目 smoke；没有保存 key；没有提交 commit；没有记录真实交互式 TTY 截图；Shift+Enter 仍标记为 host-dependent fallback。
- 明确边界：Slice B PASS 只代表 Ink Shell Foundation scoped pass，不代表 real provider smoke ready，不代表 Beta PASS，不代表 smoke-ready，不代表 open-source-ready。

```yaml
gate: Pre-Smoke Ink TUI Product Shell Gate
slice: B Ink Shell Foundation
status: completed-scoped-foundation
verdict: PASS_FOR_SLICE_B_ONLY
can_enter_real_smoke: false
can_claim_beta_pass: false
can_claim_smoke_ready: false
can_claim_open_source_ready: false
explicit_boundary: Slice B PASS is only Ink Shell Foundation scoped pass, not real provider smoke ready.
git_status_short:
  - " M packages/tui/package.json"
  - " M packages/tui/src/index.ts"
  - " M packages/tui/tsconfig.json"
  - " M pnpm-lock.yaml"
  - "?? docs/audit/pre-smoke-ink-tui-product-shell-source-level-reality-check.md"
  - "?? packages/tui/src/shell/"
changed_files:
  docs:
    - docs/audit/pre-smoke-ink-tui-product-shell-source-level-reality-check.md
  package_and_lock:
    - packages/tui/package.json
    - pnpm-lock.yaml
  config:
    - packages/tui/tsconfig.json
  code:
    - packages/tui/src/index.ts
    - packages/tui/src/shell/types.ts
    - packages/tui/src/shell/view-model.ts
    - packages/tui/src/shell/plain-renderer.ts
    - packages/tui/src/shell/ink-renderer.tsx
    - packages/tui/src/shell/theme.ts
    - packages/tui/src/shell/components/ShellApp.tsx
    - packages/tui/src/shell/components/Composer.tsx
    - packages/tui/src/shell/components/StatusTray.tsx
    - packages/tui/src/shell/components/ProductBlock.tsx
  tests:
    - packages/tui/src/shell/view-model.test.ts
dependency_changes:
  packages/tui/package.json:
    dependencies_added:
      - ink
      - react
    dev_dependencies_added:
      - "@types/react"
  scope: only @linghun/tui
  no_desktop_dependency: true
  no_large_non_ui_dependency: true
fast_path_impact:
  linghun_help_version: apps/cli/src/cli.ts keeps --help/--version before importing @linghun/tui
  ink_runtime_loading: TUI only; Ink renderer is dynamically imported after TTY candidate check
architecture:
  single_source_of_truth: packages/tui/src/index.ts keeps provider/model/tool/permission/natural command loop
  shared_controller_handler: processTuiLine is used by Ink composer and fallback readline path
  view_model: ShellViewModel is read-only projection from TuiContext plus bounded output blocks
  renderers:
    ink: packages/tui/src/shell/ink-renderer.tsx -> ShellApp
    plain: packages/tui/src/shell/plain-renderer.ts
  fallback_retention: readInputLines/writeLine path remains for non-TTY/headless/plain/dumb/failure cases
  no_second_systems:
    provider: true
    tool_loop: true
    permission_pipeline: true
    command_registry: true
    doctor_runtime: true
    evidence_cache_job_index_runtime: true
tty_ink_entry_path:
  condition: stdin.isTTY true, stdout.isTTY true, TERM not dumb, LINGHUN_TUI_PLAIN not 1
  no_color: NO_COLOR/FORCE_COLOR changes theme markers but does not force fallback
  startup: runTui -> shouldEnterInkShell -> runInkShell -> renderInkShell -> ShellApp
fallback_path:
  non_tty_or_plain: runTui -> runPlainTui -> writeLegacyStartup -> readInputLines
  ink_init_failure: writePlainShell bounded view, then runPlainTui
  dumb_terminal: plain fallback
i18n_coverage:
  zh_CN_placeholder: 我能帮您做点什么？
  en_US_placeholder: What can I help you with?
  fallback_prompt: readInputLines now consumes messages.inputPrompt instead of hardcoded prompt
  shell_strings: minimal zh-CN/en-US shell view model strings covered by focused tests
key_masking_patch:
  source: context.pendingModelSetup?.step === "apiKey"
  view_model_field: ShellViewModel.composer.masking
  ink_rendering: masks visible composer text with same-length asterisks
  controller_submit_text: unchanged raw text
  fallback_readline_masking: preserved
  provider_storage_changed: false
  model_setup_semantics_changed: false
  real_smoke_run: false
  key_saved: false
narrow_no_color_non_tty_coverage:
  widths_tested: [80, 60, 40]
  long_cjk_path_and_long_model: covered by focused view-model test
  no_color_markers: covered by plain renderer focused test
  non_tty_fallback: covered by existing index.test piped stdin runTui tests and shouldUseInkShell focused test
validation:
  - command: corepack pnpm exec vitest run packages/tui/src/index.test.ts
    result: PASS; 176 tests passed
  - command: corepack pnpm exec vitest run packages/tui/src/shell
    result: PASS; 7 tests passed
  - command: corepack pnpm typecheck
    result: PASS
  - command: corepack pnpm check
    result: PASS
  - command: git diff --check
    result: PASS
  - command: corepack pnpm -F @linghun/tui build
    result: PASS; extra package build guard for TSX/dynamic Ink chunk
untested_items:
  - No real provider smoke was run.
  - No real project smoke was run.
  - No manual interactive TTY screenshot capture was recorded in this slice.
  - Shift+Enter remains host-dependent; visible fallback guidance is present for narrow composer.
index_status:
  project: F-Linghun
  status: ready
  nodes: 1977
  edges: 4216
permission_mode: local source/doc/dependency edit in current Claude Code session
provider_model: not used by Linghun runtime; no provider smoke was run
budget_usage: not measured by Linghun runtime
next_slice: C Home / First Run / Repo State
next_slice_requires_user_confirmation: true
forbidden_next_actions:
  - do not enter real smoke before this full gate closes and user explicitly confirms
  - do not save provider keys
  - do not rewrite provider/tool/permission/runtime
  - do not copy reference source code
  - do not claim Beta PASS, smoke-ready, or open-source-ready
residual_risks:
  - Ink shell foundation is intentionally minimal; Home/First Run cards and full interaction blocks are later slices.
  - Focused tests validate view model/fallback boundaries, not a recorded real terminal screenshot.
  - Existing plain startup remains for fallback/headless compatibility and still contains legacy detailed hints.
```
