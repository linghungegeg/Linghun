# Phase 15 preflight：Natural Command Bridge / 自然语言控制桥

## 阶段目标

完成 Phase 15 真实项目 Beta 之前的 preflight：让普通中文/英文自然语言先进入本地 Natural Command Bridge，由本地 Command Capability Catalog 与 intent router 裁决是否可回答、是否可执行只读状态查询、是否进入 Start Gate、是否进入权限管道，模型只负责解释，不靠猜测执行命令。

本阶段只完成自然语言控制桥 preflight，不进入 Phase 15 真实项目 Beta，不进入 Phase 15.5 双模型交叉审查，也不实现 Phase 16+ 的长期学习、长期任务、Remote Channels 或桌面端。

## 已完成功能

- Command Capability Catalog：
  - 覆盖当前 TUI 用户可见 slash commands：`/help`、`/language`、`/model`、`/vision`、`/image`、`/skills`、`/workflows`、`/plugins`、`/doctor`、`/sessions`、`/resume`、`/branch`、`/memory`、`/mode`、`/tab`、`/plan`、`/permissions`、`/background`、`/agents`、`/fork`、`/rewind`、`/btw`、`/interrupt`、`/claim-check`、`/verify`、`/review`、`/cache-log`、`/cache`、`/break-cache`、`/mcp`、`/index`、`/usage`、`/stats`、`/read`、`/write`、`/edit`、`/multiedit`、`/grep`、`/glob`、`/bash`、`/todo`、`/diff`、`/exit`。
  - 显式标记内部隐藏入口 `/status`，并保留 `hiddenReason`。
  - 每项能力包含 `id`、`slash`、`aliases`、中英文标题、描述、whenToUse、risk、只读性、modelInvocable、userInvocable、Start Gate、配置写入、权限管道和 bridgeSafe 元数据。
- `/help` 使用同一份 catalog 展示能力、风险与自然语言桥说明，同时保留原有详细 help 内容，避免破坏既有用户路径和测试。
- Model prompt 只注入短摘要：
  - `RuntimeStatusForModel`：memory/index/cache/model/permissionMode/extensions 的短结构化字段。
  - `CommandCapabilitySummary`：稳定排序、可截断、短文本，不包含完整 transcript、完整 memory、完整索引、完整 skill/plugin/hook 正文或动态大输出。
- Natural Intent Router：
  - 普通非 slash 输入先经本地 router。
  - 支持中英文语义变体、疑问句、命令式、slash command 用途/风险询问。
  - 低置信度、拼写不准、多候选时进入澄清，不猜测执行。
  - 中文/英文同一能力进入同一风险处理路径。
- 风险裁决与 preflight hardening：
  - 只读状态查询可走等价 slash command。
  - 需要动作的索引、workflow、resume、branch、fork、verify、review 等进入 Start Gate。
  - Catalog 增加 `SLASH_COMMAND_REGISTRY`，并用 TUI 真实用户可见 dispatch 列表做漂移检测。
  - mode/workflow/fork/index/model/branch 支持关键自然语言参数提取；低置信度或多候选时澄清，不猜测。
  - pending natural Start Gate 记录 `gateId`、`createdAt`、`expiresAt`、`source`、`exactCommand`、`risk`、`scope`，状态栏显示 pending gate。
  - refresh/init、workflow、fork、高风险、写配置、权限管道等 gate 不接受普通“确认/yes”，必须输入 exact command；过期 gate 拒绝执行。
  - `bypass` 必须 `LINGHUN_ENABLE_BYPASS=1` 本地显式 opt-in；`auto` 必须 `LINGHUN_ENABLE_AUTO_PERMISSION=1` 表示本地 gate/classifier 可用；Plan approval 只确认方案边界，不授权所有工具。
  - 写文件、编辑、多处编辑、Bash、权限规则、bypass、force refresh、第三方启用、记忆接受/删除、rewind restore、hook/job/remote/dependency install 等自然语言不直通，只解释风险或进入权限管道。
- LINGHUN.md template cleanup follow-up：`/memory init` 默认生成中文“项目规则”模板，覆盖长期规则用途、写入/不写入边界、事实优先、Start Gate/权限审批、候选记忆确认、最小验证、上下文裁剪、clean rewrite 和中英文可读性；已有 `LINGHUN.md` 继续只提示已存在，不静默覆盖。

## 使用方式

进入 REPL 后可直接输入自然语言或 slash command：

```bash
corepack pnpm build
corepack pnpm exec linghun
```

示例：

```text
自动记忆功能是否打开
is memory enabled?
帮我建立索引
build the index
缓存命中怎么样
cache hit rate
你是什么模型
what model are you using?
当前权限模式
current permission mode
有哪些工作流
list workflows
打开 bug-fix 工作流
start bug-fix workflow
hook 开了吗
are hooks enabled?
恢复上次会话
resume last session
/cache status 是干什么的
what does /branch do?
怎么搜索代码里的 TODO
show me the diff
帮我做一次 review
start a verifier agent
帮我直接运行 npm install
直接开启 bypass
直接接受所有记忆
force refresh index
```

## 涉及模块

- `packages/tui/src/natural-command-bridge.ts`：新增 Command Capability Catalog、Natural Intent Router、RuntimeStatusForModel、自然语言回答/澄清/Start Gate/权限阻断格式化。
- `packages/tui/src/natural-command-bridge.test.ts`：新增 catalog 覆盖、第一批/第二批/第三批路由、安全阻断、风险一致性、低置信度、RuntimeStatus 测试。
- `packages/tui/src/index.ts`：接入普通输入的本地自然语言路由、pending natural Start Gate 确认、catalog help、model prompt 短 RuntimeStatus 和能力摘要。
- `docs/delivery/README.md`：Phase 15 preflight 状态更新。
- `README.md`：当前进度更新为 Phase 15 preflight 完成。
- `START_NEXT_CHAT.md`：下一会话 handoff 更新为 Phase 15 preflight 已完成，下一步必须先确认是否进入 Phase 15 真实项目 Beta 或 Phase 15.5。

## 关键设计

- Catalog 是单一事实来源：router、`/help` 和 model-visible summary 共用同一份能力目录。
- 本地裁决优先：自然语言是否执行不交给模型猜，先由本地 router 决定 action。
- 意图契约优先：同一 capability 下必须继续区分状态查询、诊断查询、用法/风险询问、安全动作、配置变更、高风险动作和模糊请求，避免“现在是什么模型”这类状态查询退化成 `/model route` 用法提示。
- 双语等价：中英文 title/description/whenToUse/aliases 都进入匹配与解释；同一能力的中英文意图保持同一 risk handler。
- Summary-first：给模型的 catalog/runtime 状态是短摘要，不注入完整日志、完整 transcript、完整 memory、完整索引、完整 skill/plugin/hook 正文。
- 保守安全：高风险自然语言不直通，即使用户写“直接”“force”“bypass”“npm install”“接受所有记忆”等，也只进入权限阻断/审批说明。
- Start Gate 不替代权限审批：自然语言确认只能触发等价 slash command；slash command 内部写文件、Bash、配置写入、第三方启用等仍必须走后续权限管道。

## Natural Intent Contract hardening

本轮性质：Phase 15 preflight 的成品级手感硬化，不是新阶段，不进入 Phase 15 Beta，也不做关键词补丁。

要补齐的底层契约：

- `status_query`：读取本地真实状态或等价只读 slash handler，例如“现在是什么模型”“自动记忆是否打开”“缓存命中怎么样”“索引好了没”。
- `doctor_query`：进入对应诊断能力，例如“模型 key 配好了吗”“模型配置正常吗”“索引为什么不能用”。
- `usage_help`：只用于用户明确询问“怎么用/能做什么/风险是什么/这个命令是什么意思”。
- `safe_action_request`：进入 Start Gate，例如建立索引、启动 workflow、resume/branch/fork/verifier。
- `config_change_request`：展示将变更的配置键、风险、scope 和回滚方式，例如模型切换、mode 切换、role route 设置。
- `dangerous_action_request`：阻断或进入权限管道，例如 Bash、依赖安装、write/edit、permission 规则、bypass、force refresh、memory accept/delete、第三方 enable、hook/job/remote。
- `ambiguous_request`：列候选或追问，不猜测执行。

成品级验收样例：

| 用户说法 | 期望识别 | 期望行为 |
| --- | --- | --- |
| 现在是什么模型、你现在用的哪个模型 | `model.status` + `status_query` | 返回当前 provider/model、角色路由短摘要和可选 doctor 提示；不得只返回 `/model route` 用法。 |
| 模型 key 配好了吗、模型配置正常吗 | `model.doctor` + `doctor_query` | 返回 provider/baseUrl/apiKey/model 的诊断摘要和环境变量修复建议；不得泄露 API key。 |
| `/model` 怎么用、模型命令有什么风险 | `model.*` + `usage_help` | 解释 `/model`、`/model route`、`/model route doctor`、`/model route set` 的用途和风险边界。 |
| 自动记忆是否打开、现在记住了什么 | `memory.status` + `status_query` | 返回 `autoAccept`、candidate 数、accepted 数和 `LINGHUN.md` 状态；不得让模型泛泛自称没有记忆。 |
| 索引好了没、当前索引状态 | `index.status` + `status_query` | 返回本地 index 状态、changedFiles/staleHint 和下一步建议；不得自动 refresh。 |
| 帮我建立索引、初始化索引 | `index.init` + `safe_action_request` | 进入 Start Gate，并保留大文件安全门；不得直接执行。 |
| 直接开启 bypass、直接 npm install、接受所有记忆 | 对应能力 + `dangerous_action_request` | 阻断或进入权限管道，显示风险、scope、reason 和恢复方式。 |

本轮完成后，仍需通过真实 TUI smoke 复检；若自然语言状态查询、只读查看、项目规则读取、Start Gate 和 i18n 仍出现失真，不得进入 Phase 15 真实项目 Beta。否则真实项目测试会被“能识别命令但手感仍像命令壳”的问题污染。

## Phase 15 pre-Beta Solution Completeness Gate hardening（pending）

本轮性质：Phase 15 Beta 前置质量门，不是 Phase 15 Beta、不是 Phase 15.5 实现、也不是 Phase 16+ 长期学习。目标是防止交互实测暴露系统性问题后，模型继续发现一个现象就补一个局部关键词或文案。

触发背景：

- 真实 TUI smoke 已多次暴露自然语言入口、只读查询、项目规则读取、Start Gate 文案和模型口头计划之间的连续失真。
- 用户已经明确要求“成品级”“不要缝缝补补”“参考 CCB / OpenCode 的成熟交互边界”，说明这不是单个句子的 bug。
- 如果带着这些失真进入 Phase 15 真实项目 Beta，测试数据会混入交互入口缺陷，无法准确评估编码、索引、记忆、多模型和权限底座。

必须补齐的质量门：

- 当同类问题反复出现、用户要求成品级、问题影响 Beta/release 或跨 natural command / TUI / 权限 / provider / memory / docs / tests 多个能力面时，必须先判定 `single_issue` 还是 `systemic_gap`。
- 判定为 `systemic_gap` 时，先列影响面、参考源、P0/P1/P2、当前阶段处理边界、后续登记项和验证命令，再给修复命令。
- 小的独立 bug 仍按最小修复处理；该闸门不能变成大重构借口。
- 实现时复用现有 Command Capability Catalog、RuntimeStatusForModel、Natural Intent Contract、Evidence/Freshness Gate 和 slash handlers；不得新增第二套命令解释系统。
- 不复制 CCB、OpenCode 或其他第三方源码；只参考公开行为、边界和验收标准。

进入 Phase 15 Beta 前的最低验收：

- 当前完整交互审计和修复完成后，补一轮 Solution Completeness Gate focused docs/tests 或 TUI smoke 记录。
- 报告必须说明哪些问题是单点修复，哪些是系统性缺口，哪些 P0/P1 已修，哪些 P2 放 Phase 15.5。
- 若仍出现“只给单条补丁命令、没有影响面和阶段边界”的输出，不得进入 Phase 15 真实项目 Beta。

## Phase 15 pre-Beta Full Interaction P0 hardening（done）

本轮性质：Phase 15 Beta 前置阻塞修复，不是 Phase 15 Beta，不进入 Phase 15.5，也不做 Phase 16+。`F:\Linghun\PHASE_15_PRE_BETA_FULL_INTERACTION_MATURITY_AUDIT.md` 已确认 Phase 15 Beta 必须暂停，直到 P0-1 到 P0-6 全部修复并验证。本轮已完成 P0-1 到 P0-6 的最小闭环与验证记录；是否恢复 Phase 15 真实项目 Beta 仍必须由用户明确确认。

审计后裁决：

- P0-1 必须做完整 tool_use / tool_result 架构与权限中枢，不得做只读工具弱化版，不得用模型文本 hint 代替工具事件。
- P0-2 到 P0-6 必须同轮闭环；只修部分 P0 会继续污染真实项目 Beta 数据。
- CCB 只作为公开行为和边界参考：完整工具协议、工具级权限检查、Plan/bypass/auto 边界、可取消链路、tool_result 回灌和可审计记录；不得复制源码或 UI 实现。

P0 范围：

| P0 | 必须完成 | 验收 |
| --- | --- | --- |
| P0-1 | Provider / TUI 支持真实 `tool_use` / `tool_result`；核心工具 schema 覆盖 `Read`、`Grep`、`Glob`、`Diff`、`Write`、`Edit`、`MultiEdit`、`Bash`、`Todo`；执行层复用现有工具和权限管道 | 已完成：OpenAI-compatible request 传入工具 schema / `tool_choice`，stream parser 解析分片 `tool_calls` 为 `tool_use`；TUI 多轮回灌 `tool_result`，执行层复用 `runTool()`、`decidePermission()`、Plan/acceptEdits/auto/bypass/硬拒绝安全检查 |
| P0-2 | 文件智能指代与通用自然语言读文件：最近文件、明确文件名、模糊候选、多匹配消歧义 | 已完成最小闭环：明确路径、最近提到文件、模糊候选和多匹配提示走现有 `Read` 工具；自然语言 smoke 覆盖 `读一下 LINGHUN.md` 后的“看看这个文件” |
| P0-3 | 新手轻引导 + 默认 `LINGHUN.md` 模板成熟度：首次项目或缺 `.linghun/` 时 3-5 行提示；`/memory init` 默认模板提炼最小必要改动、禁止顺手修、减少屎山、重构边界、高风险先说明和最小验证 | 已完成：启动缺失提示本地化；模板继续只在显式 `/memory init` 生成，已有 `LINGHUN.md` 不覆盖；focused test 验证模板包含最小验证、Start Gate/权限和事实优先边界 |
| P0-4 | EvidenceSummary 注入模型上下文，并和 tool_result / evidence_record 同源 | 已完成：system prompt 注入截断 `EvidenceSummary`；模型工具调用和 slash 工具调用都写入 `tool_result`，并复用同一 `recordToolEvidence()` evidence id |
| P0-5 | 模型流、权限等待和可取消工具调用接入 abort | 已完成：foreground 模型流持有 `activeAbortController`，SIGINT 与 `/interrupt` 可 abort；`ToolContext.abortSignal` 传入 Bash `runShell()`，finally 恢复 TUI idle 输入状态 |
| P0-6 | en-US 关键路径：未知命令、错误、Start Gate/permission、light hints、`LINGHUN.md` 缺失提示 | 已完成：未知命令、错误、light hints、缺失 `LINGHUN.md`、Start Gate/permission 关键路径保留 en-US 输出；TUI i18n focused test 覆盖 unknown command/error/light hint |

不做范围：

- 不做完整 registry/dispatch 大重构。
- 不做完整 TUI 美化和 output grouping。
- 不做 Bash 流式输出大改。
- 不做完整 onboarding wizard。
- 不做复杂规则市场、自动学习或自动覆盖已有 `LINGHUN.md`；只升级默认模板和 focused tests。
- 不做 rate limit/context 状态栏。
- 不做 Web Evidence runtime 完整实现。
- 不做 Agent/Skill/Plugin/Remote 全量 tool_use 接入。

## Phase 15 pre-Beta Interaction Maturity Fix（done）

本轮性质：Phase 15 Beta 前置阻塞修复，不是新阶段，不进入 Phase 15 Beta，也不进入 Phase 15.5。目标是修复真实 TUI smoke 已暴露的自然语言交互失真，确保 Phase 15 真实项目测试是在成品级自然语言入口下进行，而不是在 demo 级命令桥上测出失真数据。

### 触发原因

真实 `F:\linghun-ceshi` TUI smoke 已暴露以下问题：

- `索引已经建立了是吧` 在 index 已经 `ready` 后仍误触发 `/index init fast` Start Gate；状态查询被动作词“建立”污染。
- `/model`、模型状态等只读查询曾被要求 Start Gate；只读能力和动作能力边界不稳。
- `读一下 LINGHUN.md` 被错误映射到 `/memory`，而不是读取当前项目规则文件。
- `项目规则是什么` 让模型泛泛解释规则，而不是优先读取本地 `LINGHUN.md` 或项目规则摘要。
- zh-CN 环境下出现英文 Gate 文案，例如 `I can prepare this action`；中英文交互口径不一致。
- 低置信度澄清仍偏 slash command 列表，而不是面向用户的自然语言选项。

这些问题会直接影响 Phase 15 Beta 的实测真实性：用户会被迫学习和输入更多 slash command，测试结果会混入交互入口失真，而不是客观验证编码能力、缓存、索引、记忆、多模型和权限底座。

### 必须修复的底层契约

- Intent Frame 优先级必须固定为：`status_query > doctor_query > read_query > safe_action_request > dangerous_action_request > ambiguous_request > chat_task`。
- 状态/完成度查询必须优先读取本地 `RuntimeStatus`、storage 状态或等价只读 command result；不得因为句子里出现动作词就触发动作 Start Gate。
- 只读能力不得 Start Gate：`/model`、`/model route doctor`、`/index status`、`/cache status`、`/break-cache status`、`/memory`、`/memory storage`、`/memory review`、`/help` 和读取项目规则文件必须直接只读执行或回答。
- 项目规则自然语言入口必须成品化：`项目规则是什么`、`本仓库规则是什么`、`读一下 LINGHUN.md`、`read project rules` 必须读取或摘要当前项目 `LINGHUN.md`；文件不存在时只提示可运行 `/memory init`，不得自动生成。
- Start Gate 只用于真实动作：建立/刷新索引、生成规则模板、写入记忆、启用插件、运行 workflow、改配置、写文件、Bash、联网、force、bypass 等。
- 默认输出必须是 human-first primary 信息；`gateId`、`expiresAt`、raw risk flags、`logPath`、hash、schema 等内部字段不得进入默认主输出。
- 当前语言为 zh-CN 时，Gate、clarify、doctor、错误和确认文案必须中文；不得出现英文默认模板。
- 模糊请求必须给 2-3 个自然语言选项和风险摘要，不得只甩 slash command 候选。

### 必须覆盖的 focused tests / TUI smoke 句子

- `当前是什么模型`
- `你现在用的哪个模型`
- `模型 key 配好了吗`
- `帮我给这个项目建立索引`
- `索引已经建立了是吧`
- `索引状态怎么样`
- `项目规则是什么`
- `本仓库规则是什么`
- `读一下 LINGHUN.md`
- `缓存状态怎么样`
- `自动记忆是否打开`
- `/model`
- `/index status`
- `/memory`
- `直接 npm install`
- `开启 bypass`

### 修复完成标准

- 上述真实输入全部有 focused tests 或 TUI smoke 证据。
- 状态查询不会误开动作 Start Gate。
- 只读查询不会进入 Start Gate。
- 项目规则读取不会误入 `/memory` 泛化解释。
- zh-CN 环境默认输出不混入英文 Gate 模板。
- `git diff` 中代码改动只限自然语言交互编排、只读路由、i18n 文案和 focused tests；不得借机进入 Phase 15.5 大美化、registry dispatch 大重构、桌面端或 Phase 16+。
- 本节原本的“验证通过后允许恢复 Beta”只适用于 Interaction Maturity Fix 当轮小修，已被后续 Full Interaction Maturity Audit 覆盖；当前必须先完成 P0-1 到 P0-6 全量阻塞修复并验证，才允许恢复 Phase 15 真实项目 Beta。

### Interaction Maturity Fix 完成记录

本轮已完成 Phase 15 Beta 前置阻塞修复；未进入 Phase 15 Beta、Phase 15.5 或 Phase 16+。

已修复/确认：

- Intent Frame 优先级收口为状态查询、诊断查询和项目规则读取优先于动作请求；`索引已经建立了是吧`、`索引状态怎么样`、`is the index ready` 均走 `/index status` 只读路径，不触发 `/index init fast`。
- 只读能力保持直读：`/model`、自然语言模型状态、`/model route doctor`、`/index status`、`/cache status`、`/memory` 均不进入 Start Gate。
- 项目规则自然语言入口复用 `read` capability 与现有 `LINGHUN.md` memory 状态：`项目规则是什么`、`本仓库规则是什么`、`读一下 LINGHUN.md`、`read project rules` 读取当前项目 `LINGHUN.md`；文件缺失时只提示 `/memory init`，不自动生成。
- `LINGHUN.md` 不再提升 `memory` capability 得分，避免项目规则读取误映射到 `/memory`。
- 低置信度澄清改为 2-3 个自然语言方向和风险摘要，不再只甩 slash command 候选。
- zh-CN TUI smoke 覆盖 Start Gate、只读状态、项目规则读取和危险请求阻断，默认输出不包含 `I can prepare this action`、`gateId`、`expiresAt`、raw `risk=` 等内部字段。

Focused tests / TUI smoke 覆盖：

- `当前是什么模型`
- `你现在用的哪个模型`
- `模型 key 配好了吗`
- `帮我给这个项目建立索引`
- `索引已经建立了是吧`
- `索引状态怎么样`
- `is the index ready`
- `项目规则是什么`
- `本仓库规则是什么`
- `读一下 LINGHUN.md`
- `read project rules`
- `缓存状态怎么样`
- `自动记忆是否打开`
- `/model`
- `/index status`
- `/memory`
- `直接 npm install`
- `开启 bypass`

### Natural Intent Contract hardening 完成记录

本轮已完成 Phase 15 preflight 的 Natural Intent Contract 成品级手感硬化；未进入 Phase 15 Beta、Phase 15.5 或 Phase 16+。

已修复/确认：

- `doctor_query`：`模型 key 配好了吗`、`模型配置正常吗`、`is the model configured correctly` 路由到 `/model route doctor`，通过只读诊断口径输出 provider/baseUrl/apiKey/model 修复建议，不输出真实 API key。
- `status_query`：`现在是什么模型`、`你用的哪个模型`、`what model are you using`、`current model` 作为 `execute_readonly` 执行 `/model`，返回真实 `provider=<id> model=<model>` 与角色路由短摘要；不进入 Start Gate，也不退化成 `/model route` 用法页。
- `usage_help`：`/model 怎么用` 与 `what does /model do` 保持 `usage` + `answer`，只解释命令用途和风险边界。
- Plan mode 权限顺序：`decidePermission()` 已按 `hardDeny -> plan -> userRules -> acceptEdits -> bypass -> auto -> default` 收口；Plan 模式下即使存在 allow Write/Edit/Bash 规则，也拒绝写入、编辑和 Bash。
- cache freshness provider：`getCurrentFreshness()` 使用当前实际 provider；当前模型无法匹配 provider 时显示/参与 hash 的 provider 为 `unknown`，不伪造 `deepseek`。
- extension freshness stability：focused test 覆盖 skill/plugin manifest 顺序、贡献项顺序、运行时 top-level skills/workflows/hooks/plugins 顺序稳定；同时验证 freshness 使用 summary-first 字段，完整正文变化不影响 `pluginListHash`。
- CCB parity audit：`docs/audit/phase-15-pre-beta-ccb-coding-experience-parity-audit.md` 是本轮应纳入提交的审计报告文件，已加入下一轮启动必读清单；未删除、未移动。
- Phase 15.5 discovery-before-execute：仅保留为 Phase 15.5 设计记录，未实现 runtime guard，未做 registry dispatch 大重构。

本轮验证结果见“Natural Intent Contract hardening 验证结果”。

## 覆盖矩阵

| 批次 | 能力 | 自然语言处理 |
| --- | --- | --- |
| 第一批状态/动作 | `memory`、`index`、`cache`、`model`、`mode`、`workflows`、`skills`、`plugins`、`hooks`、`sessions`、`resume`、`branch` | 状态/用途可回答或只读执行；动作进入 Start Gate；危险变体进入权限管道。 |
| 第二批发现/解释/确认 | `read`、`grep`、`glob`、`todo`、`verify`、`review`、`diff`、`fork`、`agents`、`background` | 可解释用途/风险；只读状态可执行；需要实际动作或工具权限时进入 Start Gate/权限管道。 |
| 第三批高风险 | `write`、`edit`、`multiedit`、`bash`、`permissions`、`mode bypass`、`cache refresh`、`index force`、`skills/plugins enable`、`memory accept/delete`、`rewind restore`、`hook` | 不自然语言直通；只输出风险说明、Start Gate 或权限管道提示。 |
| 内部/隐藏 | `/status` | Catalog 中显式标记 hiddenReason，不在普通 `/help` 用户入口中作为可见命令主推。 |

## 禁止直通命令

自然语言请求以下能力时不得直接执行：写文件、编辑、多处编辑、Bash、依赖安装、权限规则增删、bypass 权限模式、force refresh index/cache、第三方 skill/plugin 启用、记忆批量接受或删除、rewind restore、hook 执行或启用、job/remote 类能力。

## 低置信度处理

- 无匹配或低分：返回澄清提示，不转给等价命令。
- 多候选分数接近：列出候选能力，不猜测用户意图。
- 明确 slash command 用途/风险询问：直接回答该 command 的用途、风险与安全边界。

## 中英文 smoke 覆盖

单元测试覆盖以下代表性中文/英文短语：

- `自动记忆功能是否打开` / `is memory enabled?`
- `帮我建立索引` / `build the index`
- `缓存命中怎么样` / `cache hit rate`
- `你是什么模型` / `what model are you using?`
- `当前权限模式` / `current permission mode`
- `有哪些工作流` / `list workflows`
- `打开 bug-fix 工作流` / `start bug-fix workflow`
- `hook 开了吗` / `are hooks enabled?`
- `恢复上次会话` / `resume last session`
- `开个分支试试` / `create a branch session`
- `怎么搜索代码里的 TODO`
- `how do I read a file`
- `怎么按模式找文件`
- `todo 怎么用`
- `怎么跑验证`
- `帮我做一次 review`
- `show me the diff`
- `start a verifier agent`
- `有哪些 agents`
- `后台任务怎么看`
- `帮我直接运行 npm install`
- `直接开启 bypass`
- `直接接受所有记忆`
- `force refresh index`
- `直接帮我写文件`
- `install dependency now`

## 配置项

本阶段不新增持久化配置 schema；为避免自然语言、workflow、agent、plugin 或 hook 静默提权，preflight hardening 仅使用本地显式环境开关：

- `LINGHUN_ENABLE_BYPASS=1`：允许用户本地显式切换 `/mode bypass`。未设置时拒绝切换。
- `LINGHUN_ENABLE_AUTO_PERMISSION=1`：表示本地 auto gate/classifier 已可用，允许 `/mode auto`。未设置时拒绝切换。

上述开关不替代 Start Gate 或工具权限审批；Plan approval 也不授权 Bash、联网、依赖、权限规则或第三方启用。

## 命令

CLI：

```bash
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
corepack pnpm exec linghun
```

REPL：

```text
/help
/cache status
/model
/mode
/memory
/index status
/workflows
/skills
/plugins
/doctor hooks
/sessions
/resume
/branch
/agents
/background
/diff
/exit
```

自然语言入口见“使用方式”和“中英文 smoke 覆盖”。

## 测试与验证

阶段要求执行：

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm check
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
```

已执行：

- `corepack pnpm test -- --run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts`：通过，11 个测试文件、154 个测试通过。
- `corepack pnpm test`：通过，11 个测试文件、154 个测试通过。首次完整重跑曾命中一个既有长耗时验证 runner 用例 5s 超时；未改测试超时配置，直接重跑通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过，workspace 7 个包构建通过。
- `corepack pnpm check`：通过，43 个文件检查通过。
- `corepack pnpm exec linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec Linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec linghun --help`：通过，输出 Phase 15 preflight CLI help，并说明 TUI Natural Command Bridge。

本次 LINGHUN.md template cleanup follow-up 已执行：

- `corepack pnpm test -- --run packages/tui/src/index.test.ts`：通过，11 个测试文件、154 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm check`：通过，43 个文件检查通过。
- `corepack pnpm build`：通过，workspace 7 个包构建通过。
- 临时空项目 TUI smoke：通过；`/memory init` 生成中文“项目规则”模板，再次运行 `/memory init` 只提示 `LINGHUN.md 已存在`，`/memory` 显示截断摘要而非全文 dump。

本次 Phase 15 pre-Beta cleanup 已执行：

- `corepack pnpm test -- --run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts`：通过，11 个测试文件、157 个测试通过。
- 其余验证命令见本节下方“Phase 15 pre-Beta cleanup 验证结果”。

### Phase 15 pre-Beta cleanup 验证结果

已执行：

- `corepack pnpm test -- --run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts`：通过，11 个测试文件、157 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm check`：通过，43 个文件检查通过。首次运行发现 `packages/tui/src/index.test.ts` 格式问题，按 formatter 建议做最小格式修正后通过。
- `corepack pnpm build`：通过，workspace 7 个包构建通过。
- `corepack pnpm exec linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec Linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec linghun --help`：通过，输出 Phase 15 preflight CLI help。
- TUI stdin smoke：通过，覆盖 `/cache status`、`/break-cache status`、`/index status`、`/memory`、`/memory storage`、`/mode`、`/plugins doctor`、`/doctor hooks`、`/model route doctor`、`/exit`；输出标题为 `Linghun TUI / REPL`，未显示 Phase 14 标题。

### Natural Intent Contract hardening 验证结果

已执行：

- `corepack pnpm test -- --run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts packages/config/src/index.test.ts`：通过，11 个测试文件、179 个测试通过。说明：该 pnpm/vitest 参数路径实际运行仓库测试集；另用等价定向命令确认目标 3 个测试文件通过，152 个测试通过。
- `corepack pnpm test`：通过，11 个测试文件、179 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm check`：通过，43 个文件检查通过。首次运行只发现本轮新增断言的 formatter 差异，按 formatter 建议做最小格式修正后通过。
- `corepack pnpm build`：通过，workspace 7 个包构建通过。
- `corepack pnpm exec linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec Linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec linghun --help`：通过，输出 Phase 15 preflight CLI help，并说明 TUI Natural Command Bridge。

### Phase 15 pre-Beta Interaction P1 cleanup 验证结果

已执行：

- `corepack pnpm test -- --run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts packages/config/src/index.test.ts`：通过，11 个测试文件、183 个测试通过。
- `corepack pnpm test`：通过，11 个测试文件、183 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm check`：通过，43 个文件检查通过。首次运行发现 2 处 formatter 差异，按 formatter 建议做最小格式修正后通过；最终重跑通过。
- `corepack pnpm build`：通过，workspace 7 个包构建通过。
- `corepack pnpm exec linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec Linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec linghun --help`：通过，输出 Phase 15 preflight CLI help，并说明 TUI Natural Command Bridge。
- TUI stdin smoke：通过，覆盖“帮我给这个项目建立索引”进入 human-first Start Gate；`确认` / `yes` 不能执行；`/index init fast` 才进入等价命令路径并被索引安全门阻止未排除大文件风险；“直接 npm install”被人话风险阻断且不暴露 raw flags；`/usage`、`/stats`、`/memory`、`/model route doctor`、`/exit` 可用。

### Phase 15 pre-Beta Interaction Maturity Fix 验证结果

已执行：

- `corepack pnpm test -- --run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts`：通过，11 个测试文件、196 个测试通过。
- `corepack pnpm test`：通过，11 个测试文件、196 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm check`：通过，43 个文件检查通过。首次运行发现本轮新增测试/路由格式差异，按 formatter 建议做最小格式修正后通过；最终重跑通过。
- `corepack pnpm build`：通过，workspace packages 构建通过。
- `corepack pnpm exec linghun --help`：通过，输出 Linghun 0.1.0 help。
- TUI stdin smoke：通过，覆盖模型状态、模型 doctor、索引 build Start Gate、索引 ready/status 只读、项目规则读取、缓存状态、自动记忆状态、`/model`、`/index status`、`/memory`、`直接 npm install` 阻断、`开启 bypass` 阻断；默认输出不包含 `I can prepare this action`、`gateId`、`expiresAt` 或 raw `risk=`。

### Phase 15 pre-Beta Full Interaction P0 hardening 验证结果

已执行：

- `corepack pnpm --filter @linghun/providers test`：通过；覆盖 OpenAI-compatible tool schema / assistant tool result request shaping、streamed `tool_calls` 分片聚合为 `tool_use`、ModelGateway 新事件透传。
- `corepack pnpm --filter @linghun/tui test`：通过；覆盖自然语言最近文件读取、默认 `LINGHUN.md` 模板不覆盖、en-US unknown command/error/light hint、权限/Plan/Start Gate 既有边界。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm test`：通过，11 个测试文件、198 个测试通过。
- `corepack pnpm build`：通过，workspace packages 构建通过。
- `corepack pnpm exec linghun --help`：通过，输出 Linghun 0.1.0 help。
- `corepack pnpm exec Linghun --help`：通过，输出 Linghun 0.1.0 help。

独立 verification gate（2026-05-17）已执行并 PASS：

- `corepack pnpm test`：通过，11 个测试文件、198 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过，workspace packages 构建通过。
- `corepack pnpm exec linghun --help`：通过，输出 Linghun 0.1.0 help。
- `corepack pnpm exec Linghun --help`：通过，输出 Linghun 0.1.0 help。
- verifier 额外执行 `corepack pnpm lint`：通过，43 个文件检查通过。
- verifier 额外执行 TUI smoke：`/help` 暴露 Read/Grep/Glob/Diff/Write/Edit/MultiEdit/Bash/Todo 能力和风险边界；缺失 `LINGHUN.md` 只输出轻提示，不自动生成。
- verifier 额外执行 P0 focused tests：provider tool events、TUI tool/evidence/cancel/onboarding/i18n、权限边界相关测试通过。
- verifier 额外执行临时项目 adversarial smoke：明确读取 `LINGHUN.md`、最近文件指代“看看这个文件”、模糊多匹配 `读 alpha` 候选列表、`直接开启 bypass` 阻断并保留 Start Gate/权限边界，均符合预期。

Focused smoke 覆盖：provider 工具 schema、分片 tool call parser、TUI 自然语言 `读一下 LINGHUN.md` 后“看看这个文件”、缺失 `LINGHUN.md` 轻提示、en-US unknown command/error/light hint、Plan 模式工具权限拒绝、dangerous natural request 阻断。

未验证项：尚未运行真实 provider 在线 tool_call 对话，因为本轮按本地 pre-Beta hardening 收口，不执行真实 API 联网；真实项目 Beta 仍需用户明确确认后单独启动。

## 性能结果

- `RuntimeStatusForModel` 单元测试要求 JSON 序列化长度小于 500 字符，并确认不包含完整 memory 文本。
- `createModelCapabilitySummary(8)` 单元测试要求摘要小于 1200 字符，并确认不包含 transcript/full log 等大上下文内容。
- Catalog 稳定排序，model-visible summary 可按 limit 截断。

## Phase 15 pre-Beta cleanup 记录

本轮性质：Phase 15 pre-Beta cleanup，只做进入真实项目 Beta 前的小范围修复和补测；未进入 Phase 15 真实项目 Beta、Phase 15.5 或 Phase 16+。

修复项：

- RuntimeStatus provider：`buildRuntimeStatusForModel()` 不再把缺失 provider fallback 为 `deepseek`；调用方传入当前配置可解析出的真实 provider，无法解析时显示 `unknown`。
- TUI 标题：中英文 `appTitle` 从 `Phase 14 TUI / REPL` 改为 `Linghun TUI / REPL` 口径，避免误导当前阶段；CLI 名称和启动命令未改。
- Extension freshness：补充 focused test，证明 skill/plugin/hook/workflow/contribution 输入顺序变化不会导致 `pluginListHash` 无意义变化；未把完整 skill/plugin manifest/hook log 塞入 prompt、状态栏或 freshness。
- 审计文档：pre-Beta cross-review 报告已纳入 `docs/audit/phase-15-pre-beta-cross-review-report.md`，并加入下一轮启动必读清单。

DeepSeek V4 Pro 报告裁决：

- RuntimeStatus provider fallback：已修。
- TUI appTitle Phase 14 文案：已修。
- pluginListHash / extension freshness 稳定性：已补测；当前实现已有稳定排序，无需重构。
- START_NEXT_CHAT 与交付文档未同步 cross-review 报告：已修。
- Catalog/dispatch registry-map 重构：不在本轮做；当前只保留 drift detection + coverage test。完整同源 registry/dispatch 重构属于 Phase 15.5 或后续架构 cleanup，不能混入 pre-Beta 小修。
- command-level permission framework、permission modal、allow once/always、插件市场、远程安装、完整 hook 执行、长期任务、Remote Channels、桌面端：不在本轮做；是否阻塞 Beta 以之后的 Full Interaction Maturity Audit 审计后裁决为准。当前裁决是 P0-1 到 P0-6 全量修复前不得进入 Phase 15 Beta。

Phase 15 Beta 的前置 Interaction Maturity Fix 已完成并通过复检，但该小修不是 Beta 恢复条件的最终口径；后续仍必须先完成 P0-1 到 P0-6 全量阻塞修复，并由用户明确确认后才能开始 Phase 15 真实项目 Beta。

### Phase 15 pre-Beta Interaction P1 cleanup

本轮性质：Phase 15 pre-Beta Interaction P1 cleanup，只修复 Beta 前阻塞的 provider 统计/交接准确性问题，以及 Start Gate 默认主输出过度工程化问题；未进入 Phase 15 真实项目 Beta、Phase 15.5 或 Phase 16+。

修复点：

- `recordModelUsage()` 使用当前可解析 provider 或 `unknown`，不再把 cache stats provider 硬编码为 `deepseek`。
- `/stats` 的 hitRate provider 输入和展示行使用当前 provider 或 `unknown`。
- `/usage` 无历史记录时 provider fallback 为 `unknown`，不伪造 `deepseek`。
- `createHandoffPacket()` 的 `modelProvider.provider` 使用当前 provider 或 `unknown`。
- Start Gate 默认主输出改为 human-first decision prompt：默认展示精确命令、scope、人话风险、安全边界、继续方式和取消方式；不展示 `gateId`、`expiresAt`、raw risk flags、`writesConfig`、`permissionPipeline`、`logPath` 等内部字段。
- 状态栏的 pending gate 默认展示改为 `waiting confirmation`，不再输出 `ng-...` gate id；exact command 直输后会清理 pending gate 状态。
- exact command 仍是高风险/索引 init 等动作的唯一确认路径；普通“确认”或 `yes` 不会执行。
- dangerous natural request 仍会阻断，并输出人话风险说明，不暴露 raw flags。

补测：

- 中文“帮我给这个项目建立索引”和英文 `build the index` 的 Start Gate 默认输出不包含内部字段，且包含 `/index init fast`、scope、人话风险、继续/取消提示。
- `直接 npm install` 仍走阻断路径，默认输出不包含 raw flags。
- openai-compatible provider 下 `recordModelUsage`、`/stats`、handoff packet 使用真实 provider；`/usage` fallback 为 `unknown`。

### Provider env config minimal fix

本轮性质：provider env config minimal fix，只修复双模型 role route 测试前的配置可靠性问题；未进入 Phase 15 Beta，未做 provider 管理 UI，未做大重构。

修复点：

- 新增 `LINGHUN_DEEPSEEK_MODEL` 覆盖 deepseek provider 默认模型；新增 `LINGHUN_DEFAULT_MODEL` 覆盖 Linghun `defaultModel`。
- 保留 `LINGHUN_DEEPSEEK_API_KEY` / `LINGHUN_DEEPSEEK_BASE_URL` / `LINGHUN_OPENAI_API_KEY` / `LINGHUN_OPENAI_BASE_URL` / `LINGHUN_OPENAI_MODEL`。
- `mergeConfig()` 不再让项目 `.linghun/settings.json` 中缺失或为空的 openai-compatible `baseUrl` / `apiKey` 覆盖环境变量；当环境变量已设置 `LINGHUN_OPENAI_MODEL` 时，项目配置里的 `openai-compatible-model` 占位值不覆盖真实环境模型。
- `/model route doctor` 在 openai-compatible 缺 `baseUrl` / `apiKey` / 已确认 `model` 时提示设置 `LINGHUN_OPENAI_BASE_URL`、`LINGHUN_OPENAI_API_KEY`、`LINGHUN_OPENAI_MODEL` 并重启 Linghun；占位模型场景提示检查 `.linghun/settings.json`。
- 测试覆盖环境变量覆盖、占位模型不覆盖环境变量、doctor 环境变量修复建议，以及不输出真实 API key。

验证命令：

```bash
corepack pnpm test -- --run packages/config/src/index.test.ts packages/tui/src/index.test.ts
corepack pnpm typecheck
corepack pnpm check
corepack pnpm build
```

### Phase 15 Beta 前 Whole-System Interaction Boundary 最小完整修复

本轮性质：Phase 15 Beta 前置交互边界最小完整修复，只关闭 `docs/audit/phase-15-pre-beta-whole-system-interaction-boundary-reconciliation.md` 中 4 个阻塞 P1；未进入 Phase 15 Beta、Phase 15.5 或 Phase 16+，未修非阻塞 P1/P2，未做 registry/dispatch 大重构，未新增第二套命令解释系统。

修复点：

- BP1-1 composite status：`handleNaturalInput()` 增加轻量组合状态查询，覆盖 model/provider、index、permission、cache、memory、mcp、background、gate；命中组合查询时本地输出 summary，不发送给模型。
- BP1-2 model tool permission primary prompt：`executeModelToolUse()` 在 permission 非 allow 时立即输出本地主提示，包含 tool、decision、risk、mode、reason、scope 和 next action，同时继续回灌 error tool_result 给模型。
- BP1-3 failure evidence continuation：模型工具 permission 非 allow、模型工具失败、slash 工具 permission denial 都记录轻量 failure evidence；模型 tool_result error 附带 `evidenceId`，后续 EvidenceSummary/handoff 可引用。
- BP1-4 index safety repair loop：index safety pause 输出阻塞原因、建议 ignore 文件 `.linghunignore` / `.cbmignore`、建议条目、自然语言 continuation 修复路径、`/index refresh` retry，并记录 index evidence。
- BP1-5 index safety repair continuation：当已存在 index safety riskyFiles，且用户明确要求“排除/忽略大文件并更新索引”时，本地 continuation 生成 ignore 写入计划，优先 `.linghunignore`，已有 `.cbmignore` 时沿用 `.cbmignore`；追加缺失条目且避免重复；写入走现有 Write/`decidePermission()` 权限管道；允许后自动继续 `/index refresh`；权限拒绝或写入失败时输出可操作下一步；自然语言 force/rebuild 仍不直通。

Focused tests：

- 中文/英文组合状态：本地 summary，包含多项 runtime 状态，不进入模型。
- 模型 Bash default-mode permission：不执行，输出 primary prompt，error tool_result 含 `evidenceId`。
- 模型 Write default-mode permission：不写文件，输出 scope/reason/next。
- 模型 Read 失败：error tool_result 含 `evidenceId`。
- index safety 大文件：输出 ignore/retry repair loop；中英文自然语言 continuation 可写入 ignore 后继续 refresh；已存在 ignore 条目不重复追加；权限拒绝不写入不 refresh；自然语言 force/rebuild 不直通；主输出不重复整段 safety warning；普通开发请求仍回模型主循环。
- 既有 no-pending confirmation、provider supportsTools=false、长 Read/Grep/Glob 输出、Windows path/中文输出测试继续保留并复跑。

阶段口径：4 个阻塞 P1 已按最小边界关闭；可建议恢复 Phase 15 真人 smoke，但 Phase 15 Beta 仍必须用户明确确认后才能开始。

验证命令（本节最终验证结果以本轮最终输出为准）：

```bash
corepack pnpm test -- --run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts packages/providers/src/index.test.ts packages/config/src/index.test.ts
corepack pnpm typecheck
```

## 已知问题

- 本阶段是 preflight，不承诺真实项目 Beta 的完整自然语言命令成功率。
- Router 采用本地 catalog、aliases、描述、whenToUse 与 intent clues 的保守评分；低置信度会澄清，可能比模型猜测更保守。
- 高风险命令的真实审批、工具执行与权限细节仍由已有 slash/tool 权限管道负责。
- OpenAI-compatible stream parser 已支持常见分片 `tool_calls` 聚合；不同 provider 若返回非标准 tool call delta，需要在真实 Beta 中补 provider-specific adapter 测试。
- 未实现 Phase 15.5 双模型交叉审查与开源前 hardening。

## 不在本阶段处理的内容

- Phase 15 真实项目 Beta。
- Phase 15.5 双模型交叉审查与开源前 hardening。
- Phase 16 可控学习闭环。
- Phase 17 长期托管任务、Remote Channels、job 状态表。
- Phase 18 桌面端。
- 插件市场、GitHub 安装、远程安装、自动更新、依赖联网安装。

## 下一阶段衔接

Phase 15 pre-Beta P0 hardening 已完成本地闭环。下一步只能在用户明确确认后进入：

1. Phase 15 真实项目 Beta；
2. Phase 15 pre-Beta CCB / CCB Dev Boost Deep Parity Closure；
3. Phase 15 完成后，Phase 15.5 双模型交叉审查与开源前 hardening。

不得自动进入 Phase 15 Beta、Phase 15.5 或 Phase 16+；如启动 Deep Parity Closure，仍只作为 Beta 前质量门，不等同于进入 Phase 15.5。

## 开发者排查入口

- Catalog 覆盖：`validateCommandCapabilityCoverage()`。
- Catalog 数据：`getCommandCapabilityCatalog()`。
- Model 摘要：`createModelCapabilitySummary(limit)`。
- Runtime 状态：`buildRuntimeStatusForModel(context)`。
- 自然语言路由：`routeNaturalIntent(text, language)`。
- TUI 接入：`handleNaturalInput()`、`formatCatalogHelp()`、`sendMessage()` system prompt。
- 测试：`packages/tui/src/natural-command-bridge.test.ts`。

## 参考核对

本阶段实际读取并遵守：

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\README.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-14-skills-workflow.md`
- `F:\Linghun\START_NEXT_CHAT.md`

本阶段参考内容仅限公开行为边界与验收思路：自然语言命令先由本地能力目录/风险管道裁决，模型不猜测执行；高风险动作不绕过 Start Gate 或权限审批。

未复制 CCB、Claude Code、CCB Dev Boost 或任何可疑/专有源码实现；Linghun 的 catalog、router、runtime summary 与测试均为本仓库自研实现。

## 成品级结构化 Handoff Packet

```yaml
phase: "Phase 15 preflight / pre-Beta Full Interaction P0 hardening"
status: "done locally; independent verification gate PASS; pending user decision for next step"
delivery_doc: "F:\\Linghun\\docs\\delivery\\phase-15-natural-command-bridge.md"
next_phase_options:
  - "Phase 15 real-project Beta（必须用户明确确认）"
  - "Phase 15 pre-Beta CCB / CCB Dev Boost Deep Parity Closure（必须用户明确确认）"
  - "Phase 15.5 cross-model hardening（Phase 15 完成后且必须用户明确确认）"
forbidden_without_user_confirmation:
  - "Phase 15 real-project Beta"
  - "Phase 15 pre-Beta CCB / CCB Dev Boost Deep Parity Closure"
  - "Phase 15.5 双模型交叉审查"
  - "Phase 16+"
  - "长期学习/长期任务/Remote Channels/桌面端"
  - "依赖安装或联网安装"
evidence:
  - "packages/providers/src/index.ts"
  - "packages/providers/src/index.test.ts"
  - "packages/core/src/session.ts"
  - "packages/tools/src/index.ts"
  - "packages/tui/src/index.ts"
  - "packages/tui/src/index.test.ts"
  - "packages/tui/src/natural-command-bridge.ts"
  - "packages/tui/src/natural-command-bridge.test.ts"
  - "docs/delivery/phase-15-natural-command-bridge.md"
  - "docs/delivery/README.md"
  - "START_NEXT_CHAT.md"
validation_completed:
  - command: "corepack pnpm --filter @linghun/providers test"
    result: "pass; provider tool schema and streamed tool_call parser coverage"
  - command: "corepack pnpm --filter @linghun/tui test"
    result: "pass; TUI focused interaction coverage"
  - command: "corepack pnpm typecheck"
    result: "pass"
  - command: "corepack pnpm check"
    result: "pass"
  - command: "corepack pnpm test"
    result: "pass; 11 test files, 198 tests"
  - command: "corepack pnpm build"
    result: "pass; workspace packages built"
  - command: "corepack pnpm exec linghun --help"
    result: "pass; Linghun 0.1.0 help"
  - command: "corepack pnpm exec Linghun --help"
    result: "pass; Linghun 0.1.0 help"
verification_agent:
  verdict: "PASS"
  note: "Independent verification gate completed on 2026-05-17; no minimal fixes required. Required commands passed: test, typecheck, build, lowercase/uppercase CLI help. Additional lint, focused P0 tests and TUI smoke also passed."
index_status:
  project: "F-Linghun"
  status: "ready"
  nodes: 780
  edges: 1527
permission_mode: "default"
model_provider: "claude-sonnet-4-6 in Claude Code session; Linghun runtime model unchanged"
budget_notes: "No dependency install; no remote execution; no full transcript/memory/index injection."
remaining_risk:
  - "OpenAI-compatible stream parser supports common streamed tool_calls, but non-standard provider deltas still require real provider Beta validation."
  - "Natural file read fuzzy matching is intentionally bounded and conservative; ambiguous matches ask for explicit selection."
  - "Phase 15 real-project Beta, Deep Parity Closure, Phase 15.5 and Phase 16+ are not entered by this handoff."
```
