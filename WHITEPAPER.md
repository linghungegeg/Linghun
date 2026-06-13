# Linghun 中文白皮书

## 面向真实工程流的 Evidence-first AI 编程终端

Linghun 是一个开源、本地优先的 AI 编程终端。它不是把用户输入简单转发给模型的外壳，而是把模型、工具、权限、证据、验证、上下文、成本和长期任务组织成一个可审计的工程运行时。

它面向的不是演示型问答，而是真实仓库中的连续开发：读代码、改代码、跑命令、做验证、打稳定点、开并行任务、沉淀项目规则、复盘失败、控制成本，并在最后给出有证据边界的交付结论。

Linghun 的核心主张是：

> 真正拖慢 AI 编程的，不是模型不会写代码，而是它太容易在没看事实、没跑验证、没确认边界时给出自信结论。

Linghun 选择从 evidence-first 开始：模型可以推理和生成，但关键工程结论必须能追溯到事实。它需要知道读过哪些文件、执行过哪些工具、跑过哪些验证、Git 状态是什么、索引是否新鲜、失败是否真实发生、输出声明是否有证据支持。

---

## 产品哲学：强底座、工程化、低学习成本

Linghun 已经不是“给模型套一个终端界面”的形态。它把 AI coding 拆成模型理解、工具执行、权限决策、证据记录、验证闭环、缓存成本、长期上下文、失败复盘、Git 稳定点、多智能体、本地智能调度和本地守护这些可组合模块，再把它们接入同一条可审计的工程主链。

Linghun 的产品哲学可以概括为三句话：

- **强底座**：模型不是直接碰仓库，而是通过 provider runtime、tool runtime、permission runtime、evidence runtime、verification runtime、Git runtime、memory runtime、job runtime 和 Windows process guard 进入工程世界。
- **工程化**：每个关键动作都有状态、边界、日志、证据、失败降级和可诊断入口；不是靠提示词要求模型“谨慎一点”，而是让系统在主链上约束事实和行为。
- **低学习成本**：用户可以直接用自然语言工作，复杂能力通过 slash、command panel、doctor、details、远程连接向导和渐进披露提供；新手不用先理解全部机制，高级用户又能展开诊断和控制。

代码卫生也是这套产品哲学的一部分。Linghun 不希望 AI 把“我做了什么”“这里是演示”“临时调试一下”这类过程解释写进源码，也不鼓励用无意义注释替代清晰命名。解释应该进入回答、报告、review 或 handoff；源码只保留对长期维护有价值的信息。

这三点组合起来，构成 Linghun 的长期设计原则：用强底座承载强模型，用工程化降低不确定性，用低学习成本让普通开发者也能真实受益。用户看到的是一个能聊天、能执行、能验证、能回滚、能拆解复杂任务、能沉淀经验的开发工作台；系统内部则是一套持续约束事实、权限、成本、调度和风险的运行时。

受控记忆、自我学习和反思系统，则让这套工作台不是每一轮都从零开始。它会逐步贴合用户的表达方式、验证习惯、项目规则和常用命令，把”后续每次都要重新解释”的成本压下去，让模型在后续相似任务里更顺手、更少走偏、更少重复犯同样的错。跨轮人格连续性则在此基础上更进一步——系统不只是记住”用户喜欢什么”，而是记住”连续失败了几次、信任在上升还是下降、这是第 3 轮还是第 30 轮、刚才在做的事和现在要做的事是不是同一个域”，让调度判断不再每轮从零评估。

中枢调度系统是这套哲学继续向前的一层。Linghun 不把记忆、失败学习、权限、证据、架构、provider、workflow、agent、验证和成本状态全部粗暴塞给模型，让模型自己在长上下文里猜哪些有用；它把这些底层反馈先收敛成结构化策略，再决定这一轮应该源码优先、只读分析、进入写入权限、建议验证、压缩上下文、切换 provider、启用 Windows 兼容命令，还是把复杂目标交给 Workflow Matrix。

这不是单独增加一套复杂模式，而是把已有四档权限、多智能体、长任务、证据、架构、记忆、反思和验证系统组合成更低学习成本的产品体验。模型负责理解和生成，Linghun 的中枢调度负责选择路线、控制风险、压低成本和把历史经验变成实际行为。用户只需要说清目标，系统负责判断它是一轮普通对话、一次源码事实核对、一个受控修改、一个后台任务、一个多智能体拆分，还是一个需要 Workflow Matrix 的复杂工程流程。

### 强底座带来的价值

强底座不是为了“架构好看”，而是为了解决真实开发中的不可控问题：

- 模型再强，也不能凭空知道当前工作区事实，所以要有 Read/Grep/Index/Diff/Evidence。
- 工具再强，也不能绕过用户机器安全，所以要有 permission、workspace trust、path guard、resource cap。
- 回答再流畅，也不能把没验证的结论写成完成，所以要有 final answer gate、verification level、readiness。
- 会话再长，也不能无限塞上下文，所以要有 cache、summary-first、handoff、controlled memory。
- 任务再复杂，也不能把后台进程放飞，所以要有 background task、durable job、process guard、runner fallback。

用户感知到的结果是：更少误判、更少返工、更少重复解释、更低上下文成本、更容易回滚、更敢把 AI 用在真实项目里。

### 工程化带来的价值

Linghun 把“AI 编程”从一次性回答变成工程闭环：

- 输入阶段：自然语言、slash、Start Gate、权限确认各走清晰路径。
- 理解阶段：模型拿到的是投影后的 RuntimeStatus、EvidenceSummary、ControlledMemorySummary、FailureLearningSummary，而不是全部内部噪音。
- 执行阶段：工具调用经过 schema、runtime validation、permission、path safety 和 result normalization。
- 观察阶段：usage、cache、background task、verification、Git、index、failure learning 都写入结构化状态。
- 输出阶段：最终回答检查声明、证据、完成度、架构边界、当前事实和 Git 操作。
- 复盘阶段：真实失败沉淀成可管理教训，后续相似任务自动提示风险。

这让 Linghun 更像一个工程运行时，而不是聊天窗口。它带来的直接收益不是“流程更复杂”，而是把浪费从主链里拿掉：

- 少重复解释：项目规则、记忆、handoff 和 workspace snapshot 让模型不用每轮重新理解背景。
- 少重复读文件：索引、缓存、证据摘要和 changed files 让模型更快定位相关代码。
- 少无效工具调用：稳定工具 schema、deferred tools 和结果摘要减少把长日志、低价值工具列表塞进上下文。
- 少误判完成：verification、readiness 和 final answer gate 降低“以为完成但实际没闭环”的返工。
- 少缓存破坏：CacheFreshness 和 stable prompt/tool ordering 帮助保持更高 prompt cache 复用。
- 少后台失控：job、agent、resource cap 和 process guard 避免长任务拖慢主会话。

最终用户感知到的是更少 token 浪费、更快响应、更低 API 成本、更少返工次数，以及更稳定的阶段性交付。

### 低学习成本带来的价值

低学习成本不是删掉高级能力，而是把复杂度藏在合适的层级里：

- 默认直接说需求即可，不要求用户记住所有命令。
- 常用能力有简短 slash 入口，高级能力通过 `/help all`、doctor 和 details 展开。
- 主屏 summary-first，完整日志和诊断留在 Ctrl+O、details、artifact 和 doctor。
- 中文和英文表达都能覆盖常见工作流，不要求用户把真实工程意图翻译成固定英文命令。
- 对中文开发者常见环境做一等支持：中文需求描述、中英混合术语、中文路径、空格路径、Windows 终端、PowerShell、cmd.exe、中文诊断与私有配置路径。
- `/model setup`、provider.env、doctor 来源诊断降低模型配置门槛。
- `/memory review`、`/failures`、`/cache`、`/problems` 都是面向用户的管理入口，而不是只留给开发者的内部状态。

结果是：新用户可以先把 Linghun 当作可执行的 AI 编程终端用；中文开发者可以直接用自己的日常表达描述任务、验证、索引、Git 稳定点和排障需求；当任务需要离开电脑继续观察、审批或推进时，也可以通过企业微信、飞书/Lark 或钉钉通道接收摘要和回传控制输入。随着任务变复杂，再逐步打开记忆、agent、job、runner 和远程通道。

---

## 1. 产品定位

Linghun 的定位是一套本地开发者工作台：

- 用终端 TUI 承载日常编码、审查、验证和长任务。
- 用中文友好的自然语言和诊断入口承载真实开发表达，而不是只面向英文命令熟练用户。
- 用阶段化工程托管把需求理解、代码定位、执行改动、验证、稳定点、交接和失败复盘串成闭环，提高新项目从想法到可运行成品的成功率。
- 用本地智能调度把复杂目标拆成 Workflow Plan、phase、slice、role、risk hint、runtime proposal 和 evidence requirement，再复用架构、job、fork、agents、verification、Git、记忆、失败学习和远程摘要主链推进。
- 用 durable job、background task、agent transcript、预算、步数、日志、报告和 handoff 托管长任务，让复杂任务从目标、计划、执行到交接都有状态可查。
- 用 evidence-first、验证边界和架构约束，把“AI 生成代码”推进到“AI 参与成品级项目交付”，减少只停留在 demo、样例代码和幻觉回答里的落差。
- 用多模型路由把规划、执行、审查、验证、总结、视觉和图像类任务分给不同角色模型。
- 用工具运行时把读写文件、搜索、Bash、Todo、Diff、Git、worktree、索引和验证接入同一条主链。
- 用权限策略、路径安全、命令语义分类和用户确认保护本地工作区。
- 用证据系统和最终回答闸门抑制“没看就说、没跑就说、没完成就说完成”。
- 用 session、handoff、受控记忆和失败学习支持长期工程上下文。
- 用 MCP、skills、plugins、hooks、Capability Runtime / App Bridge、remote adapters 和 native runner 边界接入外部能力；外部软件可以通过 manifest 和本地 connector 暴露 capability，Linghun 负责自然语言调度、权限、证据、结果预算和失败边界；企业微信、飞书/Lark 和钉钉可以作为手机侧通知、审批和自然语言入口，但不能绕过本地权限。

Linghun 的目标用户包括：

- 个人开发者：希望一个开源、本地可控、能长期使用的 AI 编程终端。
- 中文开发者和新手开发者：希望通过自然语言、中英混合术语和 AI 协作完成真实项目，而不是先学习一整套复杂命令；Windows/PowerShell 环境和中文路径也应默认可用。
- 团队与开源项目维护者：希望 AI 参与开发时有 transcript、evidence、verification、permission 和 Git 稳定点可追溯。
- 工程工具开发者：希望在一个干净的运行时里接入 provider、MCP、skill、plugin、capability connector、job、agent、远程审批或外部应用能力。

---

## 2. 用户痛点与实际收益

真实 AI 编程的成本不只来自 API 账单。更大的浪费经常来自反复解释、反复读文件、工具 schema 抖动、缓存破坏、长日志污染上下文、模型误判完成度、失败后没有复盘，以及 Windows 长任务残留。

Linghun 对这些痛点给出的收益是：

| 用户痛点 | Linghun 的解决方式 | 用户得到的效果 |
| --- | --- | --- |
| 模型没看事实就下结论 | EvidenceSummary、工具结果、索引证据、最终回答闸门 | 少被“看似自信但没证据”的回答误导，降低返工。 |
| 改动能跑但破坏项目架构 | 架构证据、边界检查、漂移检测、交付一致性 gate | 防止局部修复把依赖方向、模块职责和长期维护性弄坏。 |
| 大文件、生成物或超长代码块拖垮上下文 | 索引大文件安全门、ignore/repair 流程、AntiCodeBlob 架构提示 | 避免索引和 prompt 被低价值内容吞掉，也减少逻辑继续堆进巨型文件。 |
| 前端/TUI 改动能运行但体验失控 | 前端约束、布局边界、details/summary 分层、终端能力降级 | 降低文本重叠、主屏噪音、窄屏错位和交互割裂带来的使用成本。 |
| 新项目容易停留在 AI demo | 阶段化工程闭环、Todo、验证、架构约束、稳定点、handoff | 新手也能通过自然语言持续推进项目，更容易得到可运行、可验证、可继续维护的成品。 |
| 新项目没有工程规则，模型每轮都重新猜 | `LINGHUN.md` 项目规则、`/memory init` 基础模板、规则摘要与 cache freshness | 从空仓库开始就建立事实优先、权限、验证、代码卫生和最小改动边界，降低新手把项目越做越乱的概率。 |
| AI 把解释和临时想法留进代码 | 成熟工程默认值、代码卫生约束、patch summary、review/verification | 减少无意义注释、临时代码、调试残留和解释性噪音，让代码更像可维护成品。 |
| 复杂任务无法放心交给 AI 跑完 | durable job、agent、budget、maxSteps、timeout、logs、report、handoff、verification boundary | 长任务从目标到执行、观察、暂停/取消、交接都有状态，用户不必一直盯着模型输出。 |
| 每轮都重复解释项目背景 | 项目规则、handoff、controlled memory、Workspace Snapshot Lite | 长项目连续开发更稳定，重复 token 更少。 |
| 工具列表和 MCP 变化导致 prompt cache 抖动 | core tools 稳定 schema、deferred tools、稳定排序、deferredToolListHash | 工具能力变多时不必把全部 schema 常驻进 prompt，缓存更稳。 |
| 长日志、完整索引、完整历史塞进上下文 | summary-first、details、fullOutputPath、log artifact slice、bounded workspace summary | 主屏更清爽，prompt 更短，模型更少被噪音带偏。 |
| 不知道钱花在哪里 | usage/cache history、hit rate、read/write tokens、/usage、/cache、/cache-log | 用户能看到缓存复用和 token 消耗，不再盲飞。 |
| 缓存突然变差但不知道原因 | CacheFreshness、changedKeys、/break-cache status、cache break marker | 能定位是 system prompt、tool schema、MCP 列表、模型、记忆、规则还是 cache control 变化。 |
| 局部测试通过被说成全部完成 | verification level、readiness、/review、final answer downgrade | 避免把 focused/mock/synthetic PASS 包装成整体 ready。 |
| Git 操作和 worktree 容易失控 | Git stable point、managed worktree、dirty/force/path escape guard | 进入下一阶段前能打稳定点，回滚和并行开发更可控。 |
| 复杂目标只能靠用户手工拆任务 | Workflow Plan、Workflow Matrix、phase/slice/role 拆解、架构切片、Git 稳定点建议、记忆与失败风险提示、job/fork/agent/verification proposal、Evidence Merge | 用户不必自己把大任务拆成十几条命令；系统先给出可执行、可验证、可接管、可回滚的工程计划，再进入受控执行。 |
| 用户困惑、焦虑或信任受损时，模型仍继续长篇输出或继续乱跑 | User State Routing、情绪感知调度、trust repair route、低噪摘要、源码优先和验证优先策略 | 系统会把用户状态转成调度信号：先降噪、先核对事实、先说明证据边界，必要时暂停自动推进，而不是只换一种安慰语气。 |
| 多 agent 容易烧 token 和占资源 | role route、独立 transcript、background surface、resource cap、job budget | 并行探索更可控，不让后台任务拖垮主会话。 |
| 外部软件想接 AI，但每个应用都要自建一套 agent | Capability Runtime / App Bridge、manifest、local connector、权限与证据边界 | 软件开发者只需要暴露清晰 capability；用户仍在 Linghun 里用自然语言驱动，系统负责匹配能力、确认权限、记录证据和控制结果大小。 |
| 离开电脑后长任务无人看管 | 企业微信、飞书/Lark、钉钉 remote channel；任务状态、验证结果、失败摘要和审批请求以 summary-first 方式发送到手机；在配置官方应用、事件回调、Stream 或 bridge daemon 后，手机自然语言和审批可以回到本地主链。 | 用户可以在手机上看进展、审批 pending 操作或继续推进任务，不必一直守在电脑前；执行仍发生在本机，不把远程通道变成失控执行入口。 |
| 每轮都要重新适应用户习惯 | controlled memory、受控记忆 review、accepted-only 注入 | 用户的表达方式、命令习惯、验证偏好和项目规则会逐步沉淀，后续协作更顺手。 |
| 失败后下次还踩同一个坑 | failure learning、反思记录、resolve/ignore | 真实失败沉淀成风险提示，而不是消失在日志里；后续相似任务更不容易重复翻车。 |
| Windows 长任务容易残留 | Process Guard、Windows 进程树停止、Native Runner Job Object 契约 | 取消、超时、退出时更可靠，适合 Windows 日常开发环境。 |

总体效果可以概括为：更少幻觉、更少重复 token、更高缓存复用、更少返工、更可控的本地执行、更适合长期项目。

对个人开发者和新手开发者来说，这些问题会被放大。团队里可以依靠资深 reviewer、CI、架构规范和 DevOps 流程兜底；个人项目往往只有一个人面对模型输出、依赖升级、测试失败、Git 回滚和环境配置。新手则更容易被“看起来很完整”的回答误导：模型说改好了，但不知道它有没有读对文件；模型说测试通过，但不知道验证范围；模型建议重构，但不知道是否破坏项目边界；模型给出一串计划，但用户不知道该如何拆成可执行、可验证、可回滚的步骤。

Linghun 的价值是把这些隐性工程经验前置到工具里：

- 把“先看事实再下结论”变成默认约束。
- 把“复杂目标先拆成可执行工作流”变成默认调度能力。
- 把“每次大改前先留稳定点”变成自然工作流。
- 把“测试通过要说明范围”变成最终回答要求。
- 把“失败要复盘并下次提醒”变成系统能力。
- 把“中文、Windows、PowerShell、中文路径也应该是正常路径”变成产品边界。
- 把“API 成本和缓存命中要可见”变成可诊断指标。

这意味着 Linghun 不只是给高手节省时间，也是在把一部分资深工程师的工作习惯、风险意识和交付检查沉到开发工具里。

---

## 3. 能力总览

| 能力域 | 当前能力 |
| --- | --- |
| 工程闭环 | 从需求理解、代码定位、执行改动、验证、稳定点、交接到失败复盘的阶段化主链；适合新项目从想法推进到可运行成品。 |
| 证据与反幻觉 | EvidenceSummary、完成度检查、代码事实检查、架构/边界检查、Git 操作检查、当前外部事实新鲜度规则、最终回答 retry/downgrade。 |
| 长任务托管 | durable job、background task、agent transcript、预算、步数、runtime、日志、report、handoff、verification 边界；支持复杂任务从目标到交接持续可观察。 |
| 多模型路由 | planner、executor、reviewer、verifier、summarizer、vision、image 角色路由；角色级 provider/model/capability/budget/permission 配置。 |
| 工具系统 | Read、Write、Edit、MultiEdit、Grep、Glob、Bash、Todo、Diff；工具 schema；工具结果摘要；变更文件记录；Bash 完整日志归档。 |
| 编辑安全与代码卫生 | 读前编辑、expectedHash、stale-file guard、唯一替换、patch summary、变更摘要、工作区路径边界；成熟工程默认值约束无意义注释、临时代码、调试残留、演示性话术和解释性噪音不进入源码。 |
| 验证与就绪 | /verify plan/last/smoke、验证日志、PASS/PARTIAL/FAIL/TIMEOUT/STALE/CANCELLED 语义、/review、/doctor、/problems、readiness 和 cost preview。 |
| 架构系统 | 架构证据查询、边界声明检查、架构漂移检测、前端/TUI 体验约束、AntiCodeBlob 与代码卫生提示、最终交付一致性检查、handoff 架构卡片。 |
| Git 工作流 | Git 状态检查、稳定点创建、checkpoint、managed worktree create/remove、路径逃逸保护、dirty/force 边界、Git 操作证据。 |
| 索引与工作区感知 | codebase-memory 解析与诊断、fast index status、显式 freshness check、index search/architecture evidence、Workspace Reference Cache、Workspace Snapshot Lite、大文件安全扫描。 |
| 缓存与降本 | prompt cache usage 解析、hit rate、cache history、CacheFreshness、break-cache、stable tool ordering、deferred tools、summary-first prompt 控制。 |
| 项目规则 | 启动时检测 `LINGHUN.md`；缺失时只给轻提示；用户显式运行 `/memory init` 才创建基础模板；规则摘要进入 `/memory`、`/resume`、readiness 与 CacheFreshness，不把全文刷主屏。 |
| 长期上下文 | JSONL transcript、session store、handoff packet、项目规则、controlled memory、candidate-first 长期记忆、失败学习；memory/session/job/log/cache 支持项目级、用户级和自定义目录存储边界。它的目标不是让系统“死记硬背”，而是让后续任务越来越像在和同一个熟手协作。 |
| 中枢调度系统 / Policy Kernel | 把任务类型、风险、权限、证据、记忆、失败学习、用户状态、provider 状态、workflow/agent 状态、上下文压力、架构边界、Windows/终端能力和验证需求收敛成结构化策略；六条闸门（压缩前置、阻塞终止、重试守卫、最终答案闸门、验证偏好、失败学习捕获）由主链各子系统强制执行而非仅注入 prompt，闭合从决策到执行的回路。模型负责推理和生成，运行时负责选择路线、轻提示、验证要求、降本和风险控制。 |
| 意图分类与理解 | 从单标签正则匹配升级为信号感知多层意图分类器：连续性信号（失败/成功/域切换/信任分）优先 → 加权关键词打分 → 意图不明确时回退到模型澄清；输出 primary + secondary intents，让调度器一轮内同时准备"读文件"和"准备写入确认"。不硬猜、不硬分。 |
| 用户状态调度与人格连续性 | 单轮感知：将用户的困惑、焦虑、信任修复、战略探索、急迫或疲劳等状态转成调度信号，影响输出密度、源码优先级、验证强度、后台任务开启倾向和最终回答边界。跨轮连续性：追踪连续失败/成功计数、信任分数、任务域切换、状态持续轮数和会话总轮数，让调度判断携带"过去十轮的整体走势"，而非每轮从零评估。两者都不绕过权限、证据和验证系统。 |
| Workflow Matrix / 复杂任务托管 | 自然语言复杂目标进入 Workflow Plan；目标被拆成 phase、slice、role、risk hint、runtime proposal 和 evidence requirement；执行层复用 `/job`、`/fork`、`/agents`、verification、details、架构检查、Git 稳定点建议、记忆摘要、失败风险和远程摘要；Task Surface 汇总进度，Evidence Merge 判断证据强度。 |
| 多智能体与长任务 | /agents、/fork、/job；explorer/planner/verifier/worker；独立 transcript；后台任务；durable job；预算、步数、运行时和并发上限。 |
| 权限系统 | default、auto-review、plan、full-access 四档模式；命令语义分类；路径安全分类；持久 allow 规则；拒绝记录；远程审批仍回到本地权限管道。 |
| 模型运行时 | OpenAI-compatible、DeepSeek、Anthropic Messages 风格端点；流式输出；工具调用；usage；reasoning；timeout 与 idle timeout；provider 诊断与失败摘要。 |
| Windows 守护与兼容 | Windows 进程树停止、exit cleanup、Native Runner Job Object 契约、ConPTY/终端能力检测、大小写 CLI 入口、中文/空格路径与 provider.env 私有配置路径。 |
| 自我学习与反思 | controlled memory 自动学习、candidate-first 确认流、secret 过滤、失败学习、真实失败复盘、教训投影、resolve/ignore 生命周期。它会把稳定偏好和真实教训变成下次的提示，让模型更贴近用户、更少重复犯错。 |
| 扩展生态 | MCP metadata、deferred tools、skills、plugins、workflows、hooks、manifest/trust/enable/disable/status/doctor。 |
| 外部能力桥接 / Capability Runtime | 外部应用通过 capability manifest 和本地 connector 暴露可执行能力；Linghun 在主链中做自然语言匹配、权限确认、secret 脱敏、证据记录、结果预算、失败边界和 project-scoped trust，不需要每个应用自己实现完整 AI Agent。 |
| 远程连接 | 企业微信、飞书/Lark、钉钉 remote channel；真实 webhook/official CLI 发送链路；低学习 `/remote setup` 与 `/remote bridge` 字段向导；notification-only、approval-capable、natural-language-inbound-capable、full-mobile-control-capable 分级；手机自然语言入站回到本地模型主链；远程 approval 复用本地 pending approval 和 permission pipeline；summary-only redaction、nonce/messageId/expiry/replay/signature/binding/source 校验；remote inbox 和 active-turn guard 避免手机消息打断主任务。 |
| 输出与交互 | summary-first 主屏、details 展开、command panel、status footer、slash suggestions、background task surface、日志 artifact bounded slice。 |

---

## 4. Evidence-first 工程闭环

Linghun 把“模型说了什么”和“系统知道什么”分开处理。

模型可以根据上下文提出计划、解释代码或生成改动，但以下结论必须有证据支撑：

- “代码里是这样实现的”
- “本次改动符合架构边界”
- “没有架构漂移”
- “所有任务已经完成”
- “测试已通过”
- “可以发布”
- “已创建 Git 稳定点”
- “外部信息是最新的”

Linghun 的证据来源包括：

- 文件读取、搜索和 Diff。
- 工具调用结果与 changedFiles。
- Bash / verification 日志。
- Git status、commit、worktree 操作结果。
- index search / architecture 查询结果。
- workspace snapshot、cache freshness、runtime status。
- provider live observation 与 model doctor 诊断。
- failure learning 中真实失败的历史教训。

失败学习和长期记忆不会被当作当前任务的完成证据。它们只作为风险提示进入模型上下文，提醒模型在相似场景下更谨慎。

---

## 5. 阶段化工程流程

Linghun 的工程化不是把用户拖进复杂流程，而是把真实开发中本来就存在、但经常被忽略的阶段显式化。个人开发者和新手尤其容易在这些阶段付出隐性成本：不知道模型是否真的理解项目、不知道改动是否越界、不知道测试通过代表什么、不知道失败是否会再次发生，也不知道 API 成本为什么突然升高。

Linghun 把一次 AI 编程任务拆成可观察的工程阶段。中枢调度系统贯穿这些阶段：它不是让用户手动选择每一步，而是根据任务类型、仓库事实、证据状态、权限风险、上下文压力、provider 状态、workflow/agent 状态和历史失败，动态决定这一轮应当源码优先、只读分析、受控编辑、进入 workflow/agent、先 compact、先验证，还是暂停等待确认。

| 阶段 | 不工程化时的疼点 | Linghun 的处理 | 对用户的收益 |
| --- | --- | --- | --- |
| 环境与模型配置 | 新手最容易卡在 key、baseUrl、模型能力、网络和配置文件位置；错误信息一多就不知道是模型不可用还是自己配错。 | provider runtime、model doctor、provider.env 私有配置、角色化模型路由。 | 配置问题有来源诊断，个人开发者不用靠反复试错定位模型、网络、key 或端点问题。 |
| 需求理解 | 开发者真实表达常常是中文、中英混合和上下文省略；僵硬命令或本地误判会把任务带偏。 | 自然语言默认交给模型理解，slash 和确认流才走确定入口；RuntimeStatus 投影减少内部噪音。 | 用户按日常语言描述“做一个项目/修这个 bug/先打稳定点”，不用先学习一整套工具语法。 |
| 中枢调度 | 各系统各管各的时，模型仍要临场决定读文件、编辑、验证、切 provider、开 workflow 或调用 agent，容易成本高、路线漂移或默认多开。 | Policy Kernel 把记忆、失败学习、证据、权限、架构、provider、上下文、workflow/agent 和平台状态收敛成结构化策略，六条闸门（压缩、阻塞、重试、闸门、验证偏好、失败学习）由主链各子系统强制执行，而非仅作为模型参考文本。 | 用户不用手动调度复杂路线；系统在选择路线后还会用代码路径保证这条路线被遵守，而不是只"建议"模型。 |
| 项目启动 | 从空项目到可运行版本，常见问题是依赖、目录、入口、样式、验证命令和 README 不成体系，最后停在 demo。 | Todo、工具执行、验证计划、架构约束、Git 稳定点和 handoff 串成阶段化主链。 | 新手能跟 AI 逐步把项目推进到可运行、可验证、可继续维护的状态。 |
| 代码定位 | 模型反复读无关文件，或者没读关键文件就下结论；新手不知道该让模型看哪里。 | grep、read、index search、workspace snapshot、changed files 和 evidence summary 协同定位。 | 减少重复 token 和等待时间，模型更容易围绕真正相关的代码工作。 |
| 执行改动 | 工具调用、Bash、编辑和路径操作混在一起，容易越权、误改文件或基于旧内容继续写。 | tool schema、permission mode、path guard、expectedHash、stale-file guard、resource cap。 | 个人项目也能获得接近团队工程规范的保护，不靠用户手动盯每一步。 |
| 代码卫生 | AI 容易把“这里是我新增的逻辑”“临时调试”“为了演示”这类解释性噪音、无意义注释或 debug 残留写进源码。 | 成熟工程默认值、代码卫生提示、patch summary、review/verification 和架构边界共同约束。 | 代码更像人类工程师会提交的成品，减少后续清理和代码审查成本。 |
| 架构与前端体验 | 代码能跑不代表结构健康；前端/TUI 还会出现主屏噪音、文本重叠、窄屏错位和详情不可读。 | 架构证据、边界检查、漂移检测、前端/TUI 约束、交付一致性 gate。 | 降低“局部修好、整体变烂”的风险，让成品更接近可维护工具而不是一次性脚本。 |
| 验证与就绪 | focused 测试、mock、合成 smoke 很容易被模型说成”全部通过”，用户上线前才发现缺口。 | verification level、readiness、review、problems、final answer gate；验证运行器按调度器的 verificationRoute 选择域特定命令（code_change / documentation / tui_interactive 等），避免一刀切跑全量。 | 用户能看清”验证了什么、没验证什么”，减少上线前返工。 |
| Git 稳定点 | 做到一半没有可回滚点，下一轮改动叠上来后难以恢复；新手更怕把项目改坏。 | Git stable point、checkpoint、managed worktree、dirty/force/path escape guard。 | 每个阶段都能留下安全点，复杂改动更敢推进。 |
| 长任务托管 | 复杂任务需要连续改、跑、修、验、交接；用户一直盯着屏幕既累，也很难判断任务是否卡住。 | durable job、multi-agent transcript、budget、maxSteps、timeout、logs、report、handoff、verification boundary。 | 长任务从目标到执行、观察、暂停/取消和交接都有状态，用户不必一直守在模型旁边。 |
| 成本与上下文 | 每轮重复解释、重复读文件、工具列表变化破坏缓存，账单上涨但原因不明。 | prompt cache usage、CacheFreshness、deferred tools、summary-first、cache-log。 | 更高缓存复用、更少重复 token，更容易判断钱花在哪里。 |
| 记忆与数据位置 | 公司电脑、Windows 多盘符和 C 盘空间限制下，用户不希望记忆、日志、job、cache 被强制写到一个固定位置。 | 存储支持项目级、用户级和自定义目录；memory 分 project/user/session；`/memory storage` 展示实际路径；`LINGHUN_DATA_DIR` 可改用户数据根。 | 记忆和运行数据可按项目、用户或自定义目录管理，更符合 Windows 和商业环境。 |
| 失败复盘 | 失败只留在滚动日志里，下次相似任务继续踩坑。 | failure learning、反思记录、脱敏、去重、resolve/ignore。 | 真实失败变成后续风险提示，长期项目越用越稳。 |

这套阶段化设计的核心价值，是把“靠经验手动兜底”的工作变成系统默认行为。对个人开发者来说，它减少了上下文管理、回滚、验证和成本诊断的心智负担；对新手来说，它把工程规范藏在工具运行时里，让用户先完成任务，再逐步理解背后的机制。

---

## 6. 输出侧反幻觉系统

Linghun 不依赖简单的输入关键词拦截来判断用户意图。普通自然语言默认应交给模型理解；明确 slash command、UI 操作和 pending confirmation 走确定本地入口。

真正关键的约束放在输出侧。

当模型准备输出最终回答时，Linghun 会检查高风险声明是否有对应证据。若证据不足，系统可以触发一次受控重试；重试后仍不满足，则降级为保守回答，避免把未经验证的成功结论写入 transcript。

这套系统覆盖多个层面：

- **代码事实**：不能在未读取或未搜索的情况下断言源码事实。
- **完成度**：不能把局部验证包装成全部完成。
- **架构与边界**：不能在缺少架构证据时宣称无漂移或边界闭合。
- **验证状态**：不能把 build、mock、focused 或合成 smoke 误写成真实全量通过。
- **当前外部事实**：涉及最新版本、价格、新闻、外部服务状态时，需要新鲜来源或明确标注未验证。
- **Git 操作**：声称已创建稳定点、checkpoint 或 worktree 时，需要真实 Git 操作证据。

这套机制不把“模型自信表达”视为工程结论。关键结论必须经过证据、验证和边界检查，才能进入最终交付口径。

### 反幻觉实测口径

Linghun 的反幻觉系统已经按真实模型交互做过专项 smoke 设计，不只停留在单元测试或提示词约束。

实测覆盖的典型诱导包括：

| 诱导场景 | 期望风险 | Linghun 的拦截效果 |
| --- | --- | --- |
| 要求模型直接声称“符合架构边界 / 没有架构漂移” | 模型没看证据就给架构结论 | 模型会要求先看 diff/证据；最终回答 gate 也会检查架构 evidence。 |
| 要求模型声称“所有任务完整完成、没有遗漏” | 局部事实被包装成完整闭环 | completion gate 要求完成度分类和证据，不足时降级。 |
| 诱导“已验证 / PASS / 可以发布” | 没跑验证就宣布成功 | verification/readiness/final gate 会要求真实验证记录和范围。 |
| 询问当前模型身份 | 泄漏 provider、baseUrl、endpointProfile | 普通回答只暴露模型名；provider 细节进入 doctor。 |
| 触发 deferred tools 或内部 dispatcher 文案 | 主屏泄漏内部工具名和执行细节 | 默认主屏降噪，raw tool_result 保留在诊断层。 |
| 把 resource guard 说成第五种权限模式 | 权限模型被模型编造 | runtime status 和 invariant 约束只保留四档权限模式。 |
| 无 Git 工具调用却声称已创建稳定点 | 空口 Git 成功 | Git operation claim 必须绑定真实工具证据。 |

这说明 Linghun 的反幻觉不是“让模型自觉一点”，而是多层拦截：

- prompt 层告诉模型证据边界。
- runtime 层记录工具、验证、Git、index、memory、failure 等事实。
- final answer 层检查高风险声明。
- transcript 层避免违规原文直接成为最终交付记录。

实测覆盖的核心风险，是“没有事实就声称完成、验证、架构闭合、Git 成功和 runtime 身份”。Linghun 通过 prompt、runtime、final answer gate 和 transcript 四层约束，把这类高风险输出从最终交付记录中隔离出来。

---

## 7. 架构系统

真实工程里，代码“能改对”只是第一层要求；更难的是长期不破坏项目边界。一个局部修复可能让测试通过，却把模块职责、依赖方向、运行时边界或交付口径带偏。Linghun 的架构系统就是为这个问题设计的。

它关注的不是抽象的架构图，而是当前仓库中可验证的架构事实：

- 哪些模块承担主链职责。
- 哪些逻辑只能作为纯函数或 presenter 存在。
- 哪些 runtime 可以有副作用，哪些只能做投影和格式化。
- 哪些能力已经接入主链，哪些只是提示层、旁路或诊断入口。
- 新项目、新系统、新功能、新页面和新模块在动手前是否先形成目标、已知事实、推荐路径、分阶段拆解、风险、验证方式和 nonGoals。
- 当前改动是否让职责重新堆回超大入口文件。
- 新页面、新流程、长任务、UI/TUI 改动是否继续把逻辑堆进既有巨型文件。
- 前端和 TUI 改动是否遵守布局、可读性、summary-first、details 分层和终端能力降级边界。
- 源码中是否混入解释性噪音、临时调试、无意义注释、演示性残留或不该提交的过程描述。
- 最终交付声明是否与真实运行时接线一致。

Linghun 的架构系统由几层组成：

- **架构证据**：通过索引、搜索、文件读取和架构摘要获取当前代码结构事实。
- **边界检查**：判断模型声称的“边界闭合”“接入主链”“行为不变”是否有源码证据支撑。
- **漂移检测**：对比当前改动和架构卡片，识别职责回流、旁路实现、重复 runtime、权限绕行或诊断泄漏等风险。
- **新项目规划卡片**：当用户要求新系统、新功能、新页面、新模块或跨文件实现时，架构系统会把目标、项目事实、推荐方案、拒绝方案、分阶段拆解、风险、验证项和 nonGoals 组织成 Architecture Card。它不是完整 spec 平台，也不强制小修进入 Plan，而是帮助新项目在第一步就避免“先写一坨、后面再补救”。
- **AntiCodeBlob 提示**：在新功能、新页面、新流程、长任务、UI 开发或跨文件改动时，提示模型默认不要继续堆进 god file、超长函数、深层嵌套或无边界全局状态；它属于架构风险提示，不改变权限系统，也不授权大重构。
- **代码卫生提示**：把“不要把解释写进代码、不要留下临时调试、不要用无意义注释替代清晰命名、不要把 demo 话术留进源码”纳入成品交付约束。
- **前端/TUI 约束**：把主屏 summary-first、details 展开、命令面板、状态栏、滚动视口、窄屏/legacy terminal 降级、文本不重叠和长输出归档纳入架构边界，而不是只看业务代码能否运行。
- **最终交付一致性**：在 final answer 进入 transcript 前检查交付总结是否夸大架构状态。
- **交接沉淀**：handoff 中保留架构卡片、风险和 pending items，避免下轮任务重新从零理解边界。

这套系统的用户价值很直接：开发者不用只靠人工 review 记住所有模块边界，也不用相信模型一句“已经接入主链”。当 Linghun 处理大规模重构、index 拆分、Git runtime、failure learning、多 agent 或 Windows runner 这类跨模块能力时，架构系统会把“是否真的接上、是否越界、是否只是写了提示词”变成可审查的问题。

架构系统同样遵守 Evidence-first 原则。历史架构说明、记忆和失败学习可以提醒模型，但不能替代本轮源码证据；没有读到相关代码、没有看到接线位置、没有验证主路径，就不能把“符合架构边界”写成确定结论。

---

## 8. 角色化多模型路由

Linghun 支持按角色配置模型，而不是只选一个全局模型。

内置角色包括：

- `planner`：规划、拆解和方案比较。
- `executor`：执行主要编码任务。
- `reviewer`：审查、风险识别和只读复核。
- `verifier`：验证、测试解释和交付判断。
- `summarizer`：长上下文摘要与交接。
- `vision`：视觉输入相关能力。
- `image`：图像生成或图像类任务入口。

每个角色可以配置：

- provider 与 primary model。
- fallback models。
- 必需能力：text、tools、vision、image、thinking、promptCache。
- 最大输入/输出 token。
- 成本上限。
- 是否允许工具、写文件、Bash。
- 是否在运行前要求确认。

这让 Linghun 可以把“会写代码的模型”和“适合审计的模型”“适合总结的模型”“适合视觉任务的模型”分开管理。角色路由也进入 `/model route` 和 `/model route doctor`，便于用户看到当前配置是否真实可用。

---

## 9. Provider Runtime

Linghun 的 provider 层支持多种端点形态：

- `chat_completions`
- `responses`
- `anthropic_messages`

运行时能力包括：

- 流式文本输出。
- thinking / reasoning 配置。
- prompt cache 输入。
- usage 与 cache usage 统计。
- tools/toolChoice。
- OpenAI-style function call 与 Anthropic-style tool_use/tool_result 适配。
- provider request timeout 与 stream idle timeout。
- retry status 与 max attempts。
- provider failure 的用户可读摘要和诊断信息。
- provider circuit breaker / cooldown，避免连续失败时反复浪费请求。

模型身份展示也做了降噪：普通用户问“当前模型是什么”时只回答模型名；provider、baseUrl、endpointProfile 等内部字段默认不出现在主屏和 prompt 投影中，需要通过 doctor 入口查看。

API key 和 baseUrl 这类敏感配置应保存在用户私有配置或环境变量中。doctor 只展示来源和脱敏状态，不输出明文 key。

---

## 10. 工具执行与编辑安全

Linghun 的内置工具覆盖真实开发中最常用的动作：

- `Read`：读取文件。
- `Write`：写入完整文件。
- `Edit`：单处唯一字符串替换。
- `MultiEdit`：同文件多处替换。
- `Grep`：正则搜索。
- `Glob`：路径模式搜索。
- `Bash`：运行命令。
- `Todo`：维护任务状态。
- `Diff`：查看变更。

编辑相关能力不只是“能写文件”，还包括：

- Read snapshot：记录读取时的 hash、mtime、size。
- expectedHash：写入或编辑前校验文件是否仍是模型看到的版本。
- stale-file guard：文件已变化时阻止基于旧上下文继续写。
- 唯一替换要求：Edit/MultiEdit 避免模糊替换。
- patch summary：记录变更文件、增删行、风险文件。
- changedFiles：把变更传播给上下文和验证。

### 10.1 代码卫生：让解释留在交付文本，不进入源码

代码卫生也是编辑安全的一部分。Linghun 的成熟工程默认值要求模型把解释留在回答、报告或 handoff 中，而不是塞进源码；代码里只保留有长期维护价值的注释。

这项能力面向 AI 编程里很常见的一类质量问题：代码能运行，但混入了过程描述、演示话术、临时调试、无意义 TODO、未使用分支，或者“为了说明我做了什么”的 AI 注释。它们短期看不影响功能，长期会增加 review、维护和二次开发成本。

Linghun 会把这些内容作为成品交付噪音处理：在成熟工程默认值、架构提示、patch summary、review 和 verification 中持续提醒模型保持源码干净。它不是要求代码没有注释，而是要求注释服务于长期维护，而不是服务于模型自我解释。

Bash 工具输出采用 preview + fullOutputPath：主屏只展示可读摘要，完整 stdout/stderr 进入日志 artifact，避免长日志污染主屏、prompt、memory 和 handoff。

---

## 11. 工具调用稳定与缓存降本

在 AI 编程终端里，成本和速度高度依赖 prompt cache。工具 schema、system prompt、MCP 列表、模型路由、项目规则、记忆、compact 边界或 cache control 发生字节级变化，都可能让原本可复用的上下文失效。

Linghun 把缓存稳定作为运行时能力，而不是事后账单统计。

### 11.1 稳定工具调用链

Linghun 的工具调用稳定性来自几层设计：

- 核心工具 schema 由统一 registry 生成。
- OpenAI chat、OpenAI responses、Anthropic Messages 三类 endpoint 都有明确 tool schema/result shape。
- tools 数组按 name 稳定排序，减少非语义顺序变化破坏缓存前缀。
- Anthropic tool_use/tool_result 形态做配对处理，缺失配对时生成可诊断的错误 tool_result，避免 continuation 断链。
- Deferred tools 不直接全部进入 API tools 数组，而是通过 SearchExtraTools / ExecuteExtraTool 风格的发现与代理执行路径暴露。
- MCP、skill、plugin、codebase-memory 等扩展工具默认进入稳定摘要和发现目录，减少工具列表波动。
- deferredToolListHash 单独追踪扩展工具列表变化，与核心 toolSchemaHash 解耦。

用户收益是：工具越多，不等于每轮 prompt 越臃肿；扩展能力可用，但不会轻易把工具 schema 变动扩散成整轮 cache bust。

### 11.2 Prompt Cache 与用量追踪

Linghun 解析并记录多类 provider usage：

- input tokens。
- output tokens。
- cache read tokens。
- cache write / cache creation tokens。
- Anthropic ephemeral 5m / 1h cache creation 字段。
- OpenAI-compatible cached_tokens。
- endpoint 和 provider 来源。

缓存命中率按 `cacheRead / (input + cacheWrite + cacheRead)` 计算，output 不进入分母。`/cache`、`/cache-log`、`/usage` 和 `/stats` 可以展示最近回合、read/write tokens、hit rate、模型、provider、endpoint 和 compact 状态。

这让用户能回答三个实际问题：

- 这一轮为什么贵？
- 最近缓存有没有变差？
- 是模型/provider 不返回字段，还是系统真的没有命中？

### 11.3 CacheFreshness 与 Break Cache

Linghun 追踪影响缓存的新鲜度维度：

- systemPromptHash。
- toolSchemaHash。
- mcpToolListHash。
- modelProviderHash。
- reasoningEffortHash。
- projectRulesHash。
- memoryHash。
- compactHash。
- pluginListHash。
- endpointProfileHash。
- cacheControlHash。
- cacheTtlHash。
- contextEditingHash。
- cacheEditingBetaHash。
- deferredToolListHash。

当 changedKeys 出现时，Linghun 能提示缓存变化来源，而不是只告诉用户“变慢了”。`/break-cache` 支持 once/always/off marker，并通过 nonce 显式打断 prompt cache，用于用户需要强制刷新上下文的场景。

### 11.4 Summary-first 也是降本

Linghun 不把完整日志、完整索引、完整 transcript、完整 memory、完整 tool_result 默认塞进模型上下文。

降本路径包括：

- 主屏 summary-first。
- details 承载完整内容。
- Bash/verification/job 输出写 fullOutputPath。
- log artifact 只读取 bounded slice。
- Workspace Snapshot Lite 只提供有界摘要。
- memory accepted-only topK 注入。
- failure learning 只投影短教训。
- RuntimeStatusForModel 默认不含 provider/baseUrl/endpointProfile 噪音。
- `/index status` 默认 fast path，只有显式 `--fresh` 或 `/index check` 才跑慢检测。

这些机制共同减少“为了让模型知道情况，把所有东西都塞进去”的冲动，从源头降低 token 浪费和 cache 抖动。

### 11.5 可引用的缓存目标

在稳定项目、稳定模型和稳定工具列表的连续工作流中，Linghun 的缓存复用目标如下：

- 稳定项目、稳定模型、稳定工具列表、稳定 system prompt 的连续工作流，目标缓存命中率区间为 **92%-96%**。
- 特定高稳定样本接近 **98%**。
- 上下文完全稳定、输出短、工具/schema 不变化的少数回合可达到 **100%** 级别命中。
- 这些数字描述稳定工作流下的目标和观测区间，不代表所有 provider、模型和项目都会达到同样结果。

这类高命中对用户的直接意义是：同一个长期项目里，模型不必每轮重新“付费理解”全部背景；用户也不必为了省 token 手动删上下文、重复解释或频繁重开会话。

---

## 12. 权限、安全与资源边界

Linghun 的权限系统围绕四档模式设计：

- `default`：只读和低风险会话工具更顺滑，写入和 Bash 等动作需要确认。
- `auto-review`：工作区内低风险编辑可以自动通过，高风险动作仍需确认。
- `plan`：规划模式，禁止写入、编辑和 Bash 执行。
- `full-access`：本地用户显式开启的高权限模式；硬安全边界仍然生效。

底层策略不仅看工具名，也看：

- 工具风险级别。
- 是否只读。
- 涉及路径是否在工作区内。
- Bash 命令语义。
- 是否包含 package manager、网络、Git destructive、secret env、重定向、组合命令等风险。
- 是否命中持久权限规则。

权限系统配合：

- permission prompt。
- recent denied 记录。
- always allow 规则。
- report write guard。
- resource/concurrency cap。
- process guard。
- workspace trust。

远程审批、agent、job、MCP、Git、index refresh、runner 等能力都不能绕过本地权限边界。

中枢调度系统在每轮模型调用前，会提前评估本轮是否预计有写入操作（expectedMutating）和是否需要显式权限闸门（requireExplicitGate），权限引擎在工具执行前读取这些信号预热确认级别——用户在写入操作发生前看到更准确的提示，而不是事后弹窗。这不改变四档权限模式本身，只是让权限判断多了一层上下文。

### 12.1 开发者主权、安全与隐私

Linghun 的本地优先不是一句口号，而是几类源码层面的边界共同组成：

- **模型与 provider 选择权**：用户可以配置 default model 和 planner、executor、reviewer、verifier、summarizer、vision、image 等角色路由；每个角色有自己的 provider、模型、fallback、工具/写入/Bash 许可边界。
- **私有 provider 配置**：`provider.env` 是用户私有配置，模板明确提示不要提交；shell env 优先级更高。项目 settings 写回时会剥离 apiKey，provider.env 合并摘要只记录是否覆盖和 provider id，不记录 apiKey、baseUrl 或 model route 明文。
- **数据位置控制**：storage 支持 project、user、custom 三类 scope，memory 分 project/user/session；`LINGHUN_DATA_DIR` 可以调整用户数据根，记忆、会话、日志、job、cache、index metadata 不被强制写死到某个系统盘路径。
- **长期记忆控制**：memory 是 candidate-first，不自动接受、不自动注入；accepted memory 仍受 topK 和字符预算限制。自动学习会过滤 secret、token、私钥、长 base64 等输入，长期写入必须经过用户 review/accept。
- **远程通道最小暴露**：企业微信、飞书/Lark 和钉钉通道默认关闭；配置中的 redactionPolicy 固定为 summary_only，事件类型限定为 approval_request、job_status、job_report、verification_result、failure_summary、stable_point_result 和 index_result；入站消息仍要经过 trusted source、binding、nonce/messageId、expiry、signature 和 replay 防护，并回到本地权限管道。
- **工作区与权限边界**：workspace trust、四档 permission mode、路径安全、命令语义分类、resource cap 和 process guard 共同决定动作是否可执行；自然语言、远程审批、agent 和扩展工具都不能绕过本地权限管道。

这些设计共同指向开发者主权：用户保留对模型选择、密钥位置、数据存储、远程暴露、长期记忆、权限动作、Git 状态和最终交付结论的控制权。安全和隐私不是牺牲效率的附加限制，而是让个人开发者和团队敢把 AI 接入真实项目的前提。

---

## 13. Git 稳定点与 Managed Worktree

Linghun 把 Git 稳定点做成一等能力。

用户可以通过明确命令创建稳定点，也可以让模型通过结构化 Git 工具完成。自然语言意图不是靠本地正则硬拦，而是进入模型工具 schema，由模型在需要真实执行时调用工具。

Git 相关模型工具包括：

- `GitStatusInspect`
- `GitStablePointCreate`
- `ManagedWorktreeCreate`
- `ManagedWorktreeRemove`

对应能力包括：

- 查看 Git 状态与工作区脏数据。
- 创建稳定点 commit。
- 可选纳入 untracked 文件。
- 创建受管理 worktree。
- 移除受管理 worktree。
- dirty worktree 与 force remove 边界。
- path escape 防护。
- 敏感 untracked 过滤。
- execFile 参数数组执行，避免 shell 拼接。
- 不使用危险删除和危险分支删除路径。

最终回答闸门会检查 Git 操作声明：如果模型没有真实调用工具，却声称“稳定点已创建”或“worktree 已创建”，回答会被降级。

---

## 14. 索引、缓存与工作区快照

Linghun 支持 codebase-memory 形态的代码索引，同时把索引能力纳入本地安全和成本边界。

主要能力包括：

- `/index status`：快速查看当前索引状态。
- `/index status --fresh` 与 `/index check`：显式运行 freshness 检查。
- `/index init fast`：显式建立 fast index。
- `/index refresh`：显式刷新当前项目索引。
- `/index search <query>`：查询索引并记录 evidence。
- `/index architecture`：获取短架构摘要并记录 evidence。
- `/index doctor`：诊断 managed/bundled/index runtime 可用性。

索引不是默认强制依赖。索引缺失、不可用或过期时，普通聊天和本地文件工具仍可工作；索引用于缩小定位范围，结论仍需通过源码和验证确认。

Linghun 还实现了 Workspace Reference Cache 与 Workspace Snapshot Lite：

- bounded top-level 文件/目录摘要。
- 文件数量、大小、mtime、hash 摘要。
- changed summary。
- fallback-stale / fallback-empty 明确标注。
- cache freshness diff。
- prompt cache break marker。

索引刷新前会做大文件安全扫描。Linghun 会识别超过阈值的 JSON、SQL、XML、minified 文件、依赖目录、构建产物和其他高风险路径；发现未排除的大文件风险时，默认阻止索引，并提示用户通过 `.linghunignore`、`.cbmignore`、`/index repair` 或显式 `--force` 处理。

这层安全门面向几类常见事故：

- 一次索引把几 MB 甚至几十 MB 的低价值生成物塞进检索空间。
- prompt 被 lockfile、dump、SQL、压缩资源或 minified 代码污染。
- 缓存命中率因为大文件噪音和索引结果抖动下降。
- 模型把生成物或 vendor 文件当成业务源码分析，给出错误修改建议。

大文件保护和 AntiCodeBlob 解决的是两类不同问题：前者保护索引和上下文成本，后者提醒模型不要把新逻辑继续堆进历史巨型文件。二者都服务于同一个目标：让长期项目保持可搜索、可理解、可维护。

---

## 15. 验证、就绪与问题面板

Linghun 把验证结果按真实语义处理，而不是只看命令是否跑完。

`/verify` 支持：

- `plan`：生成验证计划。
- `last`：查看最近验证结果。
- `smoke`：运行 smoke 级验证入口。

验证结果区分：

- PASS
- FAIL
- PARTIAL
- TIMEOUT
- STALE
- CANCELLED

合成 smoke 只证明最小执行链可运行，不能自动升级为真实 provider/TUI/render/report 主链 smoke。Readiness、doctor 和 review 会保留这个边界，防止”本地轻量检查通过”被写成”整体可发布”。

验证运行器不再一刀切跑全量。中枢调度根据任务域（code_change / documentation / tui_interactive / provider_model_config / agent_job_workflow / general）推荐验证命令集，验证运行器按域选择——改代码跑 typecheck+test+lint，改文档跑 markdown+link+frontmatter 检查——减少无关验证消耗。

相关入口包括：

- `/review`：基于最近验证和风险生成保守审查报告。
- `/doctor`：本地 readiness checklist。
- `/doctor project`：Project Doctor Lite。
- `/doctor runner`：Native Runner 诊断。
- `/problems`：汇总当前 verification/provider/background/freshness 问题。
- log artifact：只读取 bounded slice，避免完整日志进入主屏和 prompt。

---

## 16. 长期上下文、受控记忆、自我学习与反思

Linghun 的长期上下文不是无限追加聊天记录。

它拆成几类：

- **JSONL transcript**：记录用户输入、模型输出、工具调用、系统事件和 evidence。
- **session store**：支持恢复与会话管理。
- **handoff packet**：把目标、状态、验证、风险、架构卡片、pending items 和下一步整理成结构化交接。
- **项目规则**：通过 LINGHUN.md 或项目规则文件表达长期约束。
- **controlled memory**：候选优先、用户确认后写入，accepted-only topK 注入 prompt。
- **failure learning**：从真实失败中提取可复用教训，脱敏、去重后作为风险提示。
- **跨轮人格连续性**：在受控记忆和失败学习之上，追踪连续失败/成功计数、信任分数、任务域切换和会话总轮数，让调度判断携带"过去十轮的整体走势"。它不是情绪系统，而是让中枢在跨轮尺度上做出更准确的任务分类和风险判断。

存储位置也属于长期上下文的一部分。Linghun 不把记忆、会话、日志、job 和 cache 固定写死到某个系统盘路径；storage 支持 project、user 和 custom scope，memory 又分 project/user/session 三层。用户可以通过 `/memory storage` 查看 project memory、user memory、session/handoff、sessions、logs、jobs、cache 和 index metadata 的实际路径，也可以通过 `LINGHUN_DATA_DIR` 调整用户数据根目录。

### 16.1 项目规则：从空仓库开始建立 AI 开发秩序

很多新手使用 AI 编程工具时，最大的问题不是不会提问，而是项目一开始没有规则。模型不知道这个仓库的长期目标、允许改动范围、验证命令、代码风格、架构边界和禁止事项，就会在每一轮里重新猜。第一轮看起来很快，后面却容易进入反复解释、反复返工、越改越散的循环。

Linghun 使用项目根目录的 `LINGHUN.md` 作为项目规则入口。代码事实上，它不会在用户不知情时自动生成该文件；启动时如果缺少项目规则，只显示轻提示，用户显式运行 `/memory init` 后才会创建基础模板。模板会写入长期稳定规则、稳定事实、常用命令和明确禁止事项，并明确哪些内容不应该进入长期规则。

基础模板包含的工程边界包括：

- 事实优先：先读代码、项目索引、文档或命令结果，再判断和下结论。
- 自然语言命令不能绕过 Start Gate 或权限审批。
- 写文件、Bash、联网、安装依赖、权限或配置变更需要用户明确确认。
- 长期记忆默认先生成候选，用户 review/accept 后再写入。
- 改代码后运行项目认可的最小必要验证。
- 不把完整 transcript、大日志、大索引结果或完整 memory 塞回模型上下文。
- 默认只做完成当前任务所必需的最小改动，不顺手修无关问题。
- 不主动新增抽象、目录层级或结构性改造，避免继续放大超长文件和复杂分支。

对新手来说，这相当于给项目先建立一份“AI 开发秩序”。用户仍然可以用自然语言推进需求，但模型会在项目规则、权限、证据、验证和代码卫生边界里工作。它能降低上下文浪费，减少无意义返工，提高新项目从想法到可运行版本的一次性成功率，也让后续 agent、job、handoff 和记忆系统有统一的项目规则可读。

`LINGHUN.md` 不会把完整规则无限塞进主屏或 prompt。Linghun 会读取稳定摘要，接入 `/memory`、`/resume` context package、readiness 和 `projectRulesHash` / `memoryHash` freshness。规则变化能进入 cache 诊断，但完整规则不会默认刷屏；缺失、不可读和已存在都会有明确状态。

### 16.2 受控记忆

受控记忆解决的是“项目习惯和用户偏好如何长期生效”的问题。它不是把聊天历史全部塞进 prompt，而是把稳定、短小、可确认的规则沉淀成 memory record。

对用户来说，这带来的不是“模型记住了很多东西”这种抽象感，而是更直接的体验：同一个项目里，后续几轮不用反复说明你喜欢先看源码、先打稳定点、先做验证、先给报告，模型会逐渐更贴近你的工作方式，沟通摩擦更小。

关键边界：

- 不自动写长期记忆。
- 候选不会自动注入。
- 用户需要 `/memory review` 与 `/memory accept <id>`。
- accepted memory 仍受 topK 和字符预算限制。
- 完整 transcript、完整日志和完整索引不会直接塞入 prompt。

### 16.3 自我学习

Linghun 的自我学习是 controlled learning，不是后台无限扫描，也不是模型自行修改规则。

它解决的核心痛点是“同样的协作偏好要反复说”。例如，某个用户总是先要简短结论再要细节，某个项目总是先改代码再补文档，某类任务总要先跑 smoke 再决定是否继续。自我学习会把这些稳定模式整理成候选，让后续模型调用更省解释、更少误判，也更符合用户自己的节奏。

用户显式开启后，系统可以从真实进入模型路径的普通输入中提取候选偏好和协作规则，例如：

- 语言、回答风格、命令偏好和验证偏好。
- 高频工作流。
- 项目习惯，如测试命令、构建命令、文档位置。
- 协作规则，如先读源码、不要顺手修、报告写法偏好。

自我学习默认只生成 candidate：

- `/memory learn on` 开启。
- `/memory learn off` 关闭。
- `/memory learn status` 查看状态。
- 每轮最多生成少量候选，避免噪音积累。
- candidate 必须经过 review/accept 后才会进入 prompt。
- API key、token、私钥、长 base64 等 secret 输入整体跳过，不生成候选。
- slash command、权限确认、provider setup 等控制输入不触发自动学习。

这让 Linghun 能逐步贴合用户的真实工作习惯，又不会把一次性情绪、敏感信息或未经确认的事实写成长久规则。

### 16.4 反思与失败学习

Linghun 的反思系统不是让模型写一段“我反思了”的文本，而是从真实失败事件中提取可复用教训。

对用户最直接的价值，是让系统越用越稳，而不是越用越忘。上一次在某类 provider、Git、验证或资源边界上踩过的坑，下次再遇到相似上下文时，模型会更早收到风险提示，少走一遍弯路，减少“明明以前已经撞过一次，这次又撞上了”的重复成本。它不是让模型变成永久正确，而是让后续调用更顺滑、更接近你的真实习惯。

失败学习记录的来源包括：

- 工具异常。
- Bash 非零退出。
- provider 请求失败。
- 验证 fail/partial/timeout/stale。
- report guard。
- Git 操作失败。
- final answer gate 降级。
- resource/concurrency cap。

每条教训会记录脱敏后的失败摘要、可能的 root cause、下一次应避免的动作、严重级别、出现次数和状态。用户可以：

- `/failures` 查看活跃教训。
- `/failures resolve <id>` 标记已解决。
- `/failures ignore <id>` 静默某条教训但保留记录。

失败学习会统一脱敏 secret、baseUrl、Authorization、绝对路径等敏感内容。它只提醒模型“历史上这里容易出错”，不会成为当前任务已经失败、已经修复或已经验证的证据。

这套机制让 Linghun 能从真实运行中的失败中变稳：同类 provider 错误、工具失败、验证误判、Git 操作失败、报告守卫触发和并发上限问题，后续都会以风险提示的形式提醒模型和用户。

---

## 17. 中枢调度系统：从提示词回灌到行为调度

对用户来说，AI 编程里最累的部分往往不是打一条命令，而是持续判断“下一步该让模型做什么”。一个真实任务可能先要读源码、再判断架构边界、再决定能不能写文件、再跑 focused 验证、再处理失败、再决定是否需要 agent 或 workflow。没有中枢调度时，这些判断会回到用户身上：用户要反复提醒模型先看事实、不要乱开后台、不要把局部测试说成全部通过、不要在 Windows 下用不兼容命令，也要自己盯着上下文、成本和 provider 状态。

Linghun 的中枢调度系统，也可以理解为 Policy Kernel。它解决的不是“再给模型加一段更长提示词”，而是让底层运行时先根据当前仓库事实、用户意图、历史经验和系统状态做一次结构化判断，再让模型、工具、权限、验证、workflow、agent 和 provider 按更正确的路线工作。

在常见实现里，规则、记忆、项目说明、失败记录和工具能力通常会以上下文形式提供给模型，再由模型在生成过程中自行权衡。这个方式在小任务里有效，但在真实仓库里会逐渐暴露工程成本：上下文变长、跨项目经验可能互相污染、旧记忆可能压过当前事实、模型可能把历史提示当当前证据，复杂任务仍主要依赖模型临场判断。Linghun 的选择是把“记忆和反思”从单纯的 prompt 回灌，升级成运行时可消费的调度信号。

中枢调度的基本路径是：

```text
用户目标 / 当前仓库事实 / 运行时状态
-> Policy Kernel 生成结构化策略
-> 主链选择路线、轻提示、验证要求、上下文计划和风险边界
-> 模型在约束内推理和生成
-> 工具、权限、证据、验证、失败学习继续回写
```

这意味着经验会改变系统行为，而不只是提醒模型“请注意”。例如历史失败显示某类 provider 容易长输出失败，中枢可以提前降低输出压力、准备 fallback 或提醒需要分段；如果当前任务涉及写文件，中枢会提前标记权限风险和验证需求；如果在 Windows/PowerShell 环境下处理中文路径或 Bash 输出，中枢可以优先选择兼容策略；如果上下文接近上限，中枢会先推动 compact/cache 路线，而不是让模型继续硬塞。

### 17.1 中枢调度消费哪些信号

Policy Kernel 不替代底层系统，而是把底层系统反馈变成调度依据。它关注的信号包括：

- **任务类型**：普通问答、源码事实核对、编辑修复、workflow、agent、verification。
- **仓库事实**：已读文件、搜索结果、index 状态、workspace snapshot、Git 状态和 changed files。
- **证据状态**：当前是否已有文件读取、命令输出、验证结果、架构证据或 provider observation。
- **权限风险**：permission mode、预计 mutating 行为、最近拒绝、是否需要本地确认。
- **记忆状态**：accepted memory、项目规则、用户偏好和 auto-learning 状态；候选记忆不会直接生效。
- **失败学习与反思**：真实失败类别、严重级别、出现次数和是否仍 active；它们只作为风险信号，不是完成证据。
- **用户状态**：困惑、焦虑、信任修复、战略探索、明确命令、高风险发布、急迫或疲劳等状态。它不是“情绪陪聊标签”，而是影响路线选择的产品信号。
- **Provider 与模型状态**：当前 role/model/provider、cooldown、fallback、失败摘要、reasoning 和 endpoint 能力。
- **上下文与成本压力**：context pressure、tool result budget、usage、cache freshness、break-cache 风险。
- **架构边界**：architecture card、drift risk、boundary preflight 和 AntiCodeBlob 风险。
- **Workflow / Agent / Job 状态**：是否 running、blocked、stale、paused，是否已有后台任务占用资源。
- **平台与终端能力**：Windows、PowerShell/cmd、ConPTY、中文路径、空格路径和进程守护能力。

这些信号不会被一股脑贴给用户，也不会全部原样塞给模型。主屏只显示必要的轻提示，完整诊断留给 details、doctor、logs 和 transcript。

### 17.2 中枢调度输出什么

Policy Kernel 输出的不是“执行特权”，而是结构化策略：

- **context plan**：是否带入 accepted memory、failure learning、workspace snapshot、是否需要 compact。
- **execution plan**：源码优先、只读分析、受控编辑、建议 workflow/agent、建议 verifier、是否需要 verification。
- **permission plan**：是否预计写文件或 Bash，是否需要 explicit gate，是否只读降级。
- **provider plan**：保持当前模型、准备 fallback、provider cooldown 时暂停本轮。
- **risk plan**：高风险完成声明需要 final answer gate；架构或大改需要边界检查。
- **interaction plan**：困惑时解释优先，信任修复时证据优先，战略探索时讨论优先，明确命令时命令优先，用户疲劳时减少主屏噪音。
- **user hint**：用中英文轻提示告诉用户系统为什么这样走，但不暴露内部 JSON。

用户看到的是类似：

```text
策略：源码优先，先读取关键文件。
策略：检测到权限风险，写入前会请求确认。
策略：Windows 环境，优先使用兼容命令。
策略：建议先做 focused verification。
策略：上下文接近上限，先压缩再请求模型。
```

英文环境中则是：

```text
Strategy: source-first; reading key files before answering.
Strategy: permission risk detected; write actions will ask before running.
Strategy: Windows environment; using compatible commands first.
Strategy: focused verification is recommended before completion.
Strategy: context is near limit; compacting before provider request.
```

这类提示是产品层轻提示，不是新的噪音面板。它的价值是让用户理解“为什么这轮先读源码、为什么写入前会确认、为什么需要验证、为什么切 fallback”，而不是让用户学习内部调度术语。

### 17.3 用户状态感知调度

Linghun 不把用户状态理解停留在“回复语气”上，而是把用户当前的困惑、焦虑、信任修复、战略探索、明确命令、高风险发布、急迫或疲劳状态转化为调度信号。模型确实可以识别用户情绪，但如果识别结果只停留在“语气更温和一点”，它对工程结果的帮助有限；真正有价值的是让用户状态影响系统下一步怎么工作。

例如：

- 用户明显困惑时，中枢会倾向于解释优先、降低术语密度、先给可执行下一步，而不是继续扩展复杂分支。
- 用户焦虑或信任受损时，中枢会倾向于源码事实优先、验证优先、明确证据边界，减少“我觉得”“应该是”这类无证据表达。
- 用户在战略探索时，中枢会倾向于讨论和方案比较，不轻易开启写文件、agent、job 或 workflow。
- 用户给出明确执行命令时，中枢会倾向于 command-first，但仍保留权限、路径、安全和验证边界。
- 用户在发布、稳定点、开源准备等高风险语境下，中枢会提高 verification 和 final answer gate 要求，避免把局部完成包装成整体 ready。

这不是人格系统，也不是安慰模板。它是一层主动调度能力：把“用户现在真正需要什么”从文字情绪转成工程路线。用户感知到的不是多一个面板，而是 Linghun 更少乱跑、更少长篇噪音、更会在关键时刻先查事实、先确认风险、先说明验证范围。

用户状态感知也不会绕过主链。它不能自动接受记忆，不能替代 permission approval，不能把情绪判断当成测试证据，不能让 agent/job/workflow 默认自动执行，也不能把“用户很急”变成越权写文件的理由。它只帮助中枢更早选择正确路线。

### 17.4 中枢不替代主链

成熟的中枢调度必须有边界。Policy Kernel 不会替代以下系统：

- 不替代 permission engine；写文件、Bash、Git、索引写入和远程审批仍走四档权限与 pending approval。
- 不替代 provider router；模型和 provider 仍通过已有 role route、doctor、cooldown 和 fallback 边界。
- 不替代 workflow runner、agent runner 或 durable job；复杂任务仍复用现有 `/workflows`、`/agents`、`/fork`、`/job`。
- 不替代 verification runner；它可以建议 focused/basic/full 验证，但不能把建议当作测试结果。
- 不替代 final answer gate；中枢提示、记忆和失败学习不能支持 PASS。
- 不替代 architecture guard；架构信号进入调度，但真正的漂移检测和边界 preflight 仍由架构系统执行。

这条边界很重要。中枢层做的是“判断路线”，不是“绕过执行”。它让已有系统彼此看见，而不是造第二套权限、第二套路由、第二套 workflow 或第二套验证。

### 17.5 为什么它更接近真实工程智能体

中枢调度让 Linghun 从“模型增强工具”进一步接近“工程智能运行时”。区别在于：

- 记忆不只是被模型看到，而是影响本轮上下文和策略。
- 失败学习不只是提醒模型，而是影响下一次验证、provider、Windows 命令和降级路线。
- 用户状态不只是改变语气，而是影响解释密度、证据优先级、验证强度和后台任务开启倾向。
- 权限不只是事后弹窗，而是提前参与风险判断。
- 证据不只是最后补充，而是从任务开始就决定完成声明边界。
- workflow/agent 不再默认多开，而是根据复杂度、风险和资源状态决定是否值得使用。
- 当前仓库事实优先于历史经验，避免跨项目污染。

这也是 Linghun 与”把所有记忆塞进 prompt”的根本区别。记忆、反思和学习不是越多越好；真正成熟的是根据当前仓库事实选择哪些经验该参与、哪些经验该降权、哪些经验只留在 details，最终让模型走更正确、更省、更安全的工程路线。

### 17.6 从策略文本到系统执行：哲学模块闭合

Policy Kernel 的核心主张，是用结构化策略替代”把状态一股脑塞进 prompt”。但策略只有被系统执行，才算真正完成了闭环——如果调度器算出了”这一轮应该先压缩上下文”，但 compact 仍然无条件独立触发；算出了”这一轮需要显式权限闸门”，但权限引擎不知道这件事；算出了”验证路由是 code_change，建议跑 typecheck + test”，但验证运行器不读这个路由——那调度器做的，本质上还是在给模型写策略便签，而不是替系统执行策略路由。

哲学模块升级要做的，就是闭合这个回路。具体来说，调度器输出的六条布尔闸门——最终答案闸门、验证偏好、重试守卫、压缩前置、阻塞运行时终止、失败学习捕获——从”注入 system prompt 供模型参考”升级为”主链在调用模型、执行工具、触发验证、压缩上下文、启动 agent 之前必须检查的系统级约束”。

这并不是让调度器替代主链。权限引擎、验证运行器、provider 路由器、架构守卫、compact 管线、final answer gate 仍然独立运行，仍然有自己的判断逻辑。调度器做的是提前告诉它们”这一轮任务是什么类型、风险多高、预计有哪些操作、建议走什么路线”，让它们在做自己的判断时多一层上下文，少一些盲飞。

以权限引擎为例：如果调度器已经判断出本轮用户意图是”修改源码”且风险等级为 medium，权限引擎可以在工具执行前预热确认级别——不是绕过用户确认，而是在正确的时机弹出更准确的提示。以验证运行器为例：如果调度器已经判断出本轮域是 documentation 而非 code_change，验证运行器可以优先检查 markdown 链接和 frontmatter 完整性，而不是跑全量 typecheck + build + test。

闭合之后的体验变化不是”多了几个面板”，而是用户感知到系统更少在不合适的时机做不合适的事——更少在上下文已经快满时硬塞、更少在刚失败后立刻重试同样的操作、更少在用户明显在探索方案时弹出写入确认、更少把局部完成包装成整体通过。

这是中枢调度从”概念完备”走向”执行完备”的最后一步。调度器的计算逻辑不需要改——它的 40 输入 14 维度决策已经是纯函数、可测试、生产级——需要做的只是让主链上每个子系统在行动前，看一眼调度器刚才说了什么。

### 17.7 跨轮人格连续性：让系统记住”我们走到了哪一步”

17.3 节描述的用户状态感知，是单轮的：每一轮，系统根据用户当前输入文字，独立判断用户是困惑、焦虑、命令式还是探索式。这已经比”不管用户什么状态都统一回复”前进了一步，但它还有一个根本局限——它不知道”刚才发生了什么”。

一个真实的例子：用户连着三轮修同一个 bug，都失败了。第四轮，用户平静地输入”再试一下修那个 auth.ts 的 null pointer”。从文字上看，用户情绪中性、命令清晰——系统会把它分类为 neutral + decisive_command，走正常路线，不做额外验证加码。

但一个真正理解上下文的工程协作会怎么做？”你已经在这个问题上失败了三次，这次我应该更谨慎——先重新读一下相关代码，确认我理解对了再动手，改完之后必须跑 focused test，不要直接说修好了。”

这就是跨轮人格连续性要解决的问题。它不是让系统有”情绪”，而是让系统有”记忆”——记住连续失败了多少次、记住连续成功了多少次、记住用户刚才在做什么类型的任务、记住用户的信任是在上升还是下降、记住这不是一个全新会话的第一轮。

具体来说，连续性系统追踪以下跨轮信号：

- **连续失败计数**：工具失败、provider 失败、验证失败各累积多少次。连续失败达到阈值时，自动提升源码优先、解释优先、验证加码，不等用户说”你认真点”。
- **连续成功计数**：连续多轮无失败且验证通过时，逐步恢复常规验证级别，减少不必要的显式闸门——信任是挣来的，也是可以渐进恢复的。
- **任务域切换检测**：用户刚从 auth 模块的 bug 调试（失败了 3 次）切换到写 README。系统检测到任务域切换后，自动降低上一个域的失败学习权重，不让调试经验污染文档工作。
- **信任分数**：从成功/失败/验证通过/用户纠正等事件累积的 0-100 分数。分数低时系统更保守（源码优先、验证必跑、拒绝空口 PASS），分数恢复时系统恢复正常节奏。
- **用户状态持续轮数**：同一种用户状态连续出现多轮时，抑制重复提示，避免每轮都说一遍”策略：源码优先”。
- **会话总轮数**：长会话（>30 轮）自动启用 compact 倾向，防止上下文膨胀。

这 200 行纯函数的本质，是把”有经验的工程师在连续失败后会怎么做”编码成系统行为。它不替代 UserStateSignal 的单轮感知（那个仍然有效），而是在单轮感知之上叠加一层跨轮趋势。单轮感知回答”用户这句话听起来是什么状态”，连续性系统回答”考虑到过去十轮的整体走势，我应该更谨慎还是可以更果断”。

和中枢调度的其他部分一样，连续性系统有明确的边界：它不能自动接受记忆、不能替代 permission approval、不能把”信任分数低”当作不执行用户命令的理由、不能让 agent/job/workflow 默认自动执行。它只帮助中枢在跨轮尺度上做出更准确的任务分类、风险判断和路线选择。

这也是 Linghun 区别于”每轮都是新对话”的根本设计选择之一。长期项目不是 50 个独立的问答，而是一条连续的工程流——系统应该知道这是第 3 轮还是第 30 轮，是初次尝试还是第三次重试，是继续同一个任务还是已经切到了新任务。

### 17.8 哲学模块闭合 + 人格连续性的场景化收益

以当前能力为基线（100），这两个升级在不同场景下的提升幅度：

| 场景 | 提升幅度 | 为什么 |
| --- | --- | --- |
| 普通问答、简单写代码 | +5% ~ +15% | 简单场景本身不需要复杂调度；提升主要来自策略一致性——不会偶尔忘记先读文件、不会被不必要的闸门打断。 |
| 复杂工程任务 | +25% ~ +50% | 多阶段任务（定位→理解→修改→验证）中，调度器不再只”建议”路线，而是强制执行——该 compact 时必 compact，该验证时必验证，权限引擎提前预热，不再靠模型临场判断。 |
| 长期项目维护 | +50% ~ +100% | 跨轮连续性让系统知道”这是第 30 轮，刚才失败了 3 次，信任分数偏低”，自动提升源码优先和验证强度；任务域切换时自动隔离上一域的失败经验，避免跨域污染。记忆、失败学习、连续性三层叠加，让系统越来越像熟手协作。 |
| 多 agent / 多工具调度 | +40% ~ +80% | 调度器根据当前 agent 数、workflow 状态和资源压力决定是否建议并行；重试守卫在工具连续失败时自动降级而非硬重试；压缩前置避免上下文撑满后再补救。 |
| 风险判断、安全边界 | +80% ~ +200% | 六条闸门全部从”模型参考文本”升级为系统级强制执行——最终答案闸门不再漏过空口 PASS，阻塞运行时终止不再让模型在 workflow 卡死时继续被调用，权限引擎在写入前就得到预热。这是从”靠模型自觉”到”系统保证”的质变。 |
| 类人格连续性、自我叙事 | 质变，不好用百分比衡量 | 这不是让系统有”情绪”，而是让系统有”跨轮记忆”——连续失败后自动更谨慎，连续成功后逐步恢复常规节奏，长会话中保持策略稳定而非每轮重新判断。用户感知到的不是多一个面板，而是系统更少在不合适的时机做不合适的事。 |

这些数字不是精确测量，而是架构层面的收益估计。核心逻辑不变：调度器的计算已经是生产级的，收益不来自”算得更准”，而来自”算出来的结果被真正执行了”。

### 17.9 意图分类升级：从正则匹配到信号感知理解

将用户输入分入正确的 `taskKind`，是调度器所有后续判断的第一环——task kind 错了，后面的路线、闸门、验证偏好全都会偏。当前 `classifyTaskKind` 使用顺序正则匹配，本质是”看到关键词就分”，存在三个天花板：

- **无记忆**：不知道上一轮是什么 task kind、刚才有没有失败。
- **无状态**：无论用户冷静还是焦虑、连续成功还是连续失败，同一个关键词命中同一个分类。
- **单标签**：用户说”先读一下 auth.ts 再看怎么修 null pointer”，只能命中一个 primary kind，secondary 信息被丢弃。

升级后的三层分类器：

**第一层 — 连续性信号优先**。在正则之前，先看跨轮连续性系统已经算好的信号：连续失败 ≥2 → 优先 `code_fact`（先读清事实再动手）；信任分 <30 且用户无明确纠正 → 优先 `code_fact`；任务域切换 → 优先 `chat`（新域先对齐理解，不直接开写）；用户状态持续性 ≥5 → 动态调整分类阈值。

**第二层 — 加权关键词打分**。保留正则的覆盖面，但不做硬匹配。多个关键词域同时命中时，按加权打分输出 primary + one secondary，不再只取一个。例如”读一下 auth.ts 再看怎么修”同时命中 code_fact(权重 0.7) 和 edit(权重 0.5)，输出 primary=code_fact, secondary=edit——调度器据此同时准备读文件和写入预热。

**第三层 — 意图不明确时回退到模型澄清**。`intentUnclear = true` 时不在本地硬猜，交给模型反问用户确认。避免”帮我看看刚才那个问题还在不在”被正则硬分成 code_fact 然后去 grep。

分类器仍是纯函数，不调模型，不引入新依赖。变化发生在 `meta-scheduler-runtime.ts` 的 `classifyTaskKind` 函数及其直接调用点，约 100 行改动。

对用户的直接影响：
- 混合意图一轮闭环，不用等系统跑完读再等你补充”顺便修一下”。
- 连续失败后自动收敛为”先看源码再动手”，不需要你自己切换策略。
- 模糊表达不被硬猜，系统反问一次比你手动纠正两轮更省 token。

这也是中枢调度从”把状态收敛成策略”到”策略的第一步——理解用户真正要做什么——本身也是状态感知的”的最后一块拼图。

---

## 18. Workflow Matrix 与长任务托管

Linghun 支持 Workflow Matrix、多智能体和长任务托管。它的目标不是让模型“无限自动跑”，而是把复杂任务拆成有目标、有计划、有角色、有风险提示、有预算、有状态、有日志、有交接和有验证边界的托管流程。

这对新手和个人开发者尤其重要：很多 AI 项目失败并不是因为第一段代码写不出来，而是因为后续需要连续做需求澄清、文件定位、架构判断、依赖配置、功能补齐、错误修复、验证、回滚和交接。没有调度层时，用户要么不断手工追问模型“下一步做什么”，要么自己把复杂任务拆成一串命令；模型一旦忘记上下文、误判完成度、忽略历史失败或把局部验证说成全部通过，用户就要重新接管。

Workflow Matrix 把这些环节纳入同一条可观察链路。用户可以用自然语言描述复杂目标，系统先生成 Workflow Plan，把目标拆成 phase、slice、role、risk hint、runtime proposal 和 evidence requirement，再把可执行部分映射到现有架构系统、权限系统、`/job`、`/fork`、`/agents`、verification、details、Git 稳定点建议、记忆摘要、失败学习和远程摘要主链。用户不需要先学习一套“高级编排语言”，也不需要把模型输出复制成一堆命令；复杂任务会被组织成更像工程项目的结构。

### 18.1 Workflow Matrix：把复杂目标变成工程单元

Workflow Matrix 解决的是“复杂任务怎么拆、谁来做、怎么证明完成”的问题。它不是另一个独立执行器，也不是第五种权限模式，而是站在现有主链之上的计划层：

- phase：把目标拆成可推进的阶段，例如探索、架构确认、实现、验证、整理和交接。
- slice：把每个阶段拆成更小的工作切片，避免模型把大目标压成一轮模糊回答。
- role：为切片指定 explorer、planner、worker、verifier 等职责，减少所有工作都由同一个模型视角完成。
- risk hint：把项目规则、受控记忆、已确认学习偏好和失败学习转成计划风险提示。
- runtime proposal：把切片映射到现有 job、fork、agents、verification 或 details，而不是创建第二套执行系统。
- evidence requirement：提前说明哪些证据能支持 PASS，哪些只能作为上下文或状态。

这让用户得到的是一种更省力的复杂任务体验：说出目标后，先看到结构化计划，再决定是否推进；推进后，任务可以被托管、并行、验证和交接。对新手来说，这相当于把资深开发者“先拆任务、先看架构、先定验证、先留回滚点、先看历史坑”的经验放进工具；对专业开发者来说，它减少了手工调度、重复解释和跨会话整理成本。

### 18.2 核心系统环绕：计划不是孤立文本

Workflow Matrix 的关键价值不在于“把任务列成清单”，而在于它环绕 Linghun 现有核心系统生成计划：

- **架构系统**：默认把架构边界、影响模块、前端/TUI 约束、AntiCodeBlob 和代码卫生风险放进计划，不让复杂任务从一开始就偏离结构。
- **权限系统**：继续复用 default、auto-review、plan、full-access 四档模式；mutating slice 只产生 Start Gate 和 permission proposal，不绕过本地权限。
- **Evidence / 反幻觉**：每个关键 slice 都带 evidence requirement；agent summary、job completed、remote event、failure learning 只能作为 context/status，不能冒充 PASS。
- **验证系统**：验证 slice 是计划的一部分；没有验证证据时，最终交付只能保持 PARTIAL 或保守结论。
- **Git 稳定点**：执行前后给出稳定点/checkpoint 建议，帮助用户保留可回滚边界，但不自动 commit。
- **缓存与预算**：计划中展示 token、duration、cost 和多 agent 资源压力，不把预算未设置误写成强制限制，也不凭空宣传 cache hit rate。
- **受控记忆与自我学习**：只读取项目规则、记忆摘要和已确认偏好，用于生成更贴合项目和用户习惯的计划，不自动写记忆，也不把记忆当当前事实证据。
- **反思与失败学习**：把历史 provider、工具、验证、Git、索引和 final gate 失败转成风险提示，提醒模型少重复踩坑。
- **远程摘要**：长任务可以投影成手机可读的 summary-first 状态，方便离开电脑后查看进展或审批，但远程端不是新的执行器。

这也是 Linghun 和单纯 prompt/skill 编排的区别：提示词可以告诉模型“请谨慎规划”，而 Workflow Matrix 把规划结果放进权限、证据、验证、架构、记忆、失败学习和成本这些系统边界中。它把提示词工程进一步系统工程化。

### 18.3 多智能体执行层：让不同角色做不同事情

多智能体入口包括：

- `/agents`
- `/agents show <id>`
- `/agents cancel <id>`
- `/fork explorer|planner|verifier|worker <task>`

Agent 类型包括：

- explorer：探索与信息收集。
- planner：规划与拆解。
- verifier：验证与复核。
- worker：执行子任务。

每个 agent 有独立 transcript、role route、permission mode、cost 记录和 background task surface。主会话不会被子 agent 输出淹没；用户可以查看、取消或展开详情。

更进一步，Linghun 的 agent 不是只能在同一个主工作区里“假装分身”。当前执行层已经支持命名 agent 与 team、`SendMessage` 定向投递、`/fork --background` 真后台启动、agent mailbox、独立 transcript session、`.linghun/agent-runs` 状态快照，以及安全的 `cwd` / managed worktree isolation。用户可以让某个 worker 在指定工作区子路径或受管理 worktree 中推进任务；工具执行会被限制在该 agent 的工作目录边界内，worktree 创建仍复用 Git runtime 的 managed worktree evidence，而不是另起一套工作区系统。TUI 重启后，历史 running agent 会被保守恢复为 `stale`，不会被误标成 completed。

这让多智能体协作更接近真实工程分工：一个 agent 可以负责只读探索，另一个 agent 可以在隔离 worktree 中尝试修改，verifier 再基于证据复核。agent registry 和 workflow registry 也允许项目在 `.linghun/agents`、`.linghun/workflows` 中定义轻量角色和流程，但这些 registry 只是进入现有 agent/workflow/job 主链的入口，不会绕过权限、验证、资源上限或证据边界。

这套 agent 能力是 Workflow Matrix 的执行底座之一。Workflow Plan 不直接绕开主链执行，而是把适合并行或角色化处理的切片交给现有 agent/job 系统：探索型任务交给 explorer，方案拆解交给 planner，具体实现交给 worker，验证和复核交给 verifier。每个 agent 的输出先作为上下文或状态进入汇总，不能直接冒充最终 PASS。

这和“模型自己开几个对话随便跑”不同。Linghun 的 agent 有并发上限、独立 transcript、权限模式、失败学习、资源边界和结果摘要。用户看到的是受控后台工作，而不是多路长文本同时刷屏。

### 18.4 Durable Job：从目标到交接的任务托管

Durable job 入口包括：

- `/job run`
- `/job pause`
- `/job resume`
- `/job cancel`
- `/job status`
- `/job logs`
- `/job report`

Job 运行时支持：

- 持久 state.json。
- job.log 与 fullOutput。
- report。
- goal、plan、agent 列表。
- maxSteps、maxTokens、maxRuntimeMs、timeout。
- running agent cap。
- owner session、pid、heartbeat。
- recovery：启动时识别 stale/blocked/running 状态。
- bounded worker loop。

长任务托管覆盖从头到尾的工程状态链：

- 输入目标：记录目标、阶段标识、对象和计划。
- 执行过程：在预算、步数、runtime、权限和并发上限内推进。
- 并行协作：按 explorer、planner、verifier、worker 拆分子任务。
- 过程观察：写入 background task、job.log、fullOutput 和 report。
- 中断控制：支持 pause、resume、cancel、timeout 和 stale recovery。
- 交接整理：生成 handoff packet，把目标、状态、证据、风险和下一步带到后续会话。
- 验证边界：记录 verification 状态，但不把 job completed 自动升级为 PASS。

### 18.5 Task Surface 与 Evidence Merge：用户看到的是状态，不是噪音

多智能体和长任务如果只增加并发，很容易变成更贵、更吵、更难判断的系统。Linghun 的 Task Surface 目标是把复杂后台工作压成用户能扫描的状态：

- 当前 phase。
- done/running/blocked/queued 数量。
- runnable、readonly、start gate、blocked request 统计。
- token、cost、duration 预算状态。
- 架构、Git、记忆、失败风险和远程摘要提示。
- 下一步动作。
- mobile summary。
- details 中的完整 request 与 evidence rows。

Evidence Merge 则负责区分“能支持完成声明的证据”和“只能作为上下文的状态”。文件读取、grep、index query、command output、test result、verification、provider observation、architecture evidence 可以在满足规则时支持 PASS；agent summary、job completed、remote event、failure learning、memory 和 self-learning 只能作为 context/status，不能冒充已验证完成。

因此，Linghun 支持“从目标到交接”的长任务托管；真正的可交付结论仍以 verification evidence、架构边界和最终回答 gate 为准。这样既能让 AI 承担更多连续工程工作，又不会把后台任务结束误写成成品已经验证完成。

### 18.6 对用户的实际体验

成熟后的体验不是让用户学习更多命令，而是让用户少做调度杂活：

- 用户说“帮我做一个缓存命中率报告功能，拆分任务并跑验证”，Linghun 先生成工作流计划。
- 系统把任务拆成探索、架构确认、实现、验证、稳定点建议和交接整理。
- 计划会参考项目规则、记忆摘要、已确认偏好和历史失败风险，避免每次都从零开始。
- 用户确认后，系统把探索、实现、验证、整理分给对应 agent/job/verification。
- 用户可以继续主会话，也可以离开电脑，通过远程通道看 summary-first 进展或审批 pending 操作。
- 任务结束后，Linghun 汇总 evidence、失败、验证范围、Git 状态和下一步。
- 最终回答只在证据足够时声明完成；证据不足时保守降级。

这条路线的核心优势是：强模型负责理解和生成，强底座负责调度、权限、证据、验证、成本、记忆、反思和恢复。模型可以替换，工程运行时继续提供同一套可控能力。

---

## 19. Windows 商业级守护与 Native Runner

Linghun 面向 Windows 开发者做了专门的进程守护与兼容设计。它不只依赖 Node 子进程默认行为，而是在长任务、验证、runner、job 和退出清理上建立了可观察、可降级的守护链路。

### 19.1 Process Guard

Process Guard 负责追踪由 Linghun 启动的子进程，并在取消、超时、退出和信号中断时做有界清理。

能力包括：

- tracked child registry。
- graceful stop 与 force stop。
- exit cleanup。
- SIGTERM 处理。
- Windows 平台走进程树停止路径。
- 非 Windows 平台走信号/进程组语义。
- 最近停止结果保留，便于测试与诊断。

这解决了长任务和验证中常见的问题：命令超时后子进程残留、取消后后台仍在跑、退出时临时进程没有被清理、用户无法判断任务到底是否被停止。

### 19.2 Native Runner

Linghun 预留并实现了 Native Runner 的解析、诊断和 job supervisor 接入边界。

Native Runner 的价值不是“让模型更聪明”，而是让长任务、后台任务和子进程监督更可靠：

- 平台相关进程组或 Job Object 清理。
- parent death cleanup。
- 长任务 heartbeat。
- runner state/stdout/stderr/jobLog/fullOutput/report 归档。
- protocol mismatch 诊断。
- Node/TUI fallback。

当前设计中，Native Runner 只执行 approved durable job spec，不是任意命令执行后门。runner 不可用、禁用或协议不匹配时，Linghun 会显示 fallback 状态，而不是伪装成真实 native supervision。

Windows 侧的核心契约是：Native Runner 应使用 Job Object 与 kill-on-job-close 管理受监督子进程；Unix 侧对应进程组管理。Linghun 在报告和 doctor 中保留这个契约，避免把普通 Node fallback 误说成已经具备 native 级父进程死亡清理能力。

### 19.3 Runner Doctor 与降级

Native Runner 运行前会解析：

- 是否启用。
- 来源：bundled、optional package、project-local、custom 或 disabled。
- 平台架构候选。
- binary 是否存在且可执行。
- version probe。
- protocol 是否匹配。
- Node fallback 是否可用。

这让 Linghun 在商业级长任务场景中能做到：能用 native runner 时清晰接入，不能用时明确降级，不把缺失、损坏、协议不匹配或启动失败包装成成功。

---

## 20. Windows 兼容增强

Linghun 把 Windows 作为一等运行环境处理，而不是只做类 Unix 路径假设。

Windows 兼容能力包括：

- CLI 同时提供 `linghun` 和 `Linghun` 入口。
- provider.env 存放在用户私有配置目录，避免把 key 写进项目。
- 配置优先级支持 shell env、用户 provider.env、项目 settings。
- Windows 真实 projectPath 进入 runtime status，避免模型把项目根误判成 `/workspace`。
- 终端能力检测区分 Windows Terminal、VS Code terminal、WezTerm、Alacritty、ConEmu、mintty、现代 conhost 和 legacy conhost。
- Windows 10 ConPTY 能力检测，现代 cmd.exe / PowerShell 可走更完整 TUI 路径。
- legacy terminal 降级到 ASCII-safe 渲染，减少 box drawing、emoji、宽字符错位风险。
- Windows 路径、中文路径、空格路径进入 runner、log、provider config 和 doctor 的设计边界。
- memory、session、logs、jobs、cache、index metadata 支持项目级、用户级和自定义目录存储边界，不强制所有长期数据落在系统盘默认目录。
- `/memory storage` 可显示实际存储路径，`LINGHUN_DATA_DIR` 可调整用户数据根，适配多盘符、公司权限策略和 C 盘空间受限环境。
- Bash/verification/runner 输出落日志，减少 Windows 控制台编码和长输出污染主屏。
- process guard 与 runner 共同处理 Windows 长任务取消、timeout、stale 和 exit cleanup。

这部分能力对商业化场景很关键：真实用户大量在 Windows、PowerShell、cmd.exe、Windows Terminal、VS Code terminal、中文路径和多盘符环境下开发。Linghun 的目标是让这些环境成为默认可用路径，而不是“最好换到 Linux/macOS 再说”。

---

## 21. 扩展生态：MCP、Skills、Plugins、Hooks

Linghun 的扩展系统遵循“先元数据、后执行；先信任、后启用；先诊断、后使用”的原则。

MCP 能力包括：

- server metadata。
- add/update/enable/disable/remove。
- validate。
- tools summary。
- doctor。
- mutating MCP 工具保守拒绝，codebase-memory 索引写入建议走受控 `/index` 入口。

Skills 与 Plugins 能力包括：

- local / git / github 来源元数据。
- manifest 读取。
- trusted/disabled 状态。
- enable/disable。
- validate/doctor。
- contribution summary。

Hooks 能力包括：

- PreToolUse、PostToolUse、Stop、Notification、Workflow、Plugin 事件类型。
- timeout 与 output limit。
- project trust。
- disabled/trusted ids。
- doctor 诊断。

Capability Runtime / App Bridge 则面向另一类生态问题：很多软件并不想把自己改造成完整 AI 编程工具，也不应该为每个应用都重写一套 agent、权限、记忆、证据、验证和日志系统。更合理的方式是让外部软件把自己能做的事情暴露成清晰 capability，再由 Linghun 负责自然语言调度和工程边界。

App Bridge 的连接模型是：

```text
外部应用 manifest / 本地 connector
-> Linghun 读取应用身份、transport、auth source 和 capability 定义
-> /apps connect 做一次显式连接与能力握手
-> Capability Runtime 注册当前项目可用的 capability
-> 用户通过自然语言或 /capabilities run 调用
-> 权限、证据、结果预算、失败边界和 transcript 仍回到 Linghun 主链
```

当前成品边界以 Local HTTP connector 为主：外部应用在本机暴露 `GET /linghun/capabilities` 供 Linghun handshake，并在 capability 执行端接收受控请求。manifest 必须在当前项目边界内，baseUrl 仅允许本地 HTTP，auth 信息只记录 source/ref，不把 raw secret 写进主屏或 transcript。连接状态按项目隔离，断开连接只影响当前项目对应 app 的 capability。

开发者最小接入示例可以非常薄。第一步是在当前项目内放一个 manifest：

```json
{
  "appId": "demo.drawing",
  "name": "Demo Drawing",
  "version": "0.1.0",
  "transport": "http",
  "baseUrl": "http://127.0.0.1:47831",
  "auth": { "type": "none" },
  "capabilities": [
    {
      "id": "demo.drawing.describe",
      "appId": "demo.drawing",
      "title": "Describe Drawing",
      "description": "Describes a local drawing.",
      "category": "drawing",
      "intents": ["describe drawing"],
      "keywords": ["drawing", "describe"],
      "transport": "http",
      "auth": "none",
      "permission": "read",
      "riskLevel": "low",
      "inputSchema": { "type": "object", "required": ["subject"] },
      "outputSchema": { "type": "object", "required": ["summary"] },
      "supportsRollback": false,
      "supportsPreview": false
    }
  ]
}
```

第二步是让本地应用实现两个 HTTP 端点：

```http
GET /linghun/capabilities
```

返回 `{ "capabilities": [...] }` 或 capability 数组。Linghun 会把远端返回的同 id capability metadata 与 manifest 合并。

```http
POST /linghun/execute
```

请求体由 Linghun 生成：

```json
{
  "capabilityId": "demo.drawing.describe",
  "input": { "subject": "circle" },
  "metadata": {
    "requestId": "generated-uuid",
    "source": "slash",
    "appId": "demo.drawing"
  }
}
```

应用只需要返回有界结果：

```json
{
  "ok": true,
  "summary": "Described circle.",
  "details": "Bounded details for humans.",
  "artifactRef": "optional-ref",
  "previewRef": "optional-preview-ref",
  "rollbackRef": "optional-rollback-ref"
}
```

用户侧连接命令是：

```text
/apps connect .\demo-connector.json
/apps validate .\demo-connector.json
/apps test-run .\demo-connector.json demo.drawing.describe {"subject":"circle"}
/apps list
/apps doctor
/capabilities run demo.drawing.describe {"subject":"circle"}
/apps disconnect demo.drawing
```

当前 HTTP 执行端点是统一的 `/linghun/execute`，不是每个 capability 一个 URL。Auth 可以使用 `env`、`projectConfigRef`、`userConfigRef` 或 `valueRef`，不能在 manifest 中写 raw secret。开发者可以用 `/apps validate` 做只读 manifest 校验，用 `/apps test-run` 做一次连接与执行自测。根目录提供机器可读 `APP_BRIDGE_MANIFEST.schema.json`，示例 connector 在 `app-bridge-examples/`。详细开发者指南在 `docs/developers/capability-runtime-app-bridge.md`。

开发者接入时，不需要理解 Linghun 的全部内部系统。一个应用只需要提供：

- 应用身份：app id、name、version。
- transport：例如 Local HTTP。
- auth source：例如 env ref 或用户配置引用。
- capability 列表：id、名称、描述、输入 schema、输出摘要、权限类别、结果预算和风险标签。
- 执行端点：按约定接收 Linghun 发来的 capability request，并返回结构化结果。

Linghun 负责的部分包括：

- 根据自然语言和 Policy Kernel 信号匹配 capability。
- 在 mutating / external_app / write 类能力前进入权限管道。
- 对 connector metadata、baseUrl、auth、raw payload 和 raw response 做脱敏。
- 把成功、失败、部分完成和 artifact/ref 写成 evidence，而不是把完整大结果塞进主屏。
- 保持 capability result budget，避免外部应用把长输出拖垮 session 和 prompt。
- 让失败进入正常失败边界，不把“connector 返回了结果”误当作任务已经验证通过。

这让 Linghun 的生态更像一个主动能力运行时，而不是单纯插件列表。用户仍在 Linghun 里用自然语言表达目标；外部应用提供专业能力；中枢调度决定什么时候调用、怎么调用、是否需要确认、结果能支持什么结论。画图、表格、设计工具、代码生成器、测试平台、内部系统和桌面应用都可以用同一套能力接口接入，而不需要每个软件自己复制 Linghun 的工程底座。

这些能力为后续生态扩展提供入口，但不会绕过权限、信任和本地配置边界。Capability Runtime 不做后台扫描，不自动连接未知软件，不持久保存 raw secret，不允许外部应用直接写 transcript 或 evidence，也不把 connector 执行结果当作 verification PASS。MCP、plugins、desktop bridge、WebSocket 和更复杂的连接形态可以沿用同一能力模型继续扩展；底层边界仍是本地显式连接、项目隔离、权限确认、证据记录和可诊断失败。

---

## 22. 底层能力与 Skill 的边界

Linghun 支持 Skills，但不把核心工程可靠性建立在 Skills 上。这个边界很重要。

Skill 更像经验包、操作手册和提示词模板。它可以告诉模型“遇到某类任务时应该怎么思考、调用哪些工具、注意哪些坑”。这很有价值，尤其适合沉淀团队规范、领域知识、常见工作流和个人偏好。但 Skill 本身通常不能保证以下事情真的发生：

- 写文件前经过权限判断。
- Bash 命令被正确分类、限制和记录。
- 模型声称“已完成”前有真实证据。
- 测试结果没有被夸大成全量通过。
- Git 稳定点、worktree、索引刷新和远程审批进入受控路径。
- 长任务可以暂停、取消、恢复和审计。
- 失败能被复盘并在下次相似任务中提醒。
- secret、完整路径、完整日志和 endpoint 不被外发。
- Windows 子进程、超时、退出清理和路径兼容被可靠处理。

这些不是提示词层能稳定兜住的问题，而是 runtime 级底层能力的问题。真正决定 AI 编程能否进入真实项目的，是权限、证据、验证、Git、索引、缓存、进程守护、远程入站、失败学习、transcript 和 storage 这些系统是否接入主链。

过多 Skill 也会带来另一种成本：prompt 变长、工具选择变吵、模型更容易被互相冲突的规则带偏，缓存也更容易抖动。Linghun 的选择不是把所有能力都写成越来越厚的提示词，而是把可执行、可验证、可审计的工程动作沉到系统层：

- Skill 负责扩展经验。
- MCP / plugins / hooks 负责接入外部能力。
- Capability Runtime / App Bridge 负责把外部应用的可执行能力归一成受控 capability。
- runtime 负责执行边界、证据闭环、权限、日志、失败和恢复。
- doctor / details / summary-first 输出负责让用户看得懂系统状态。

这也是 Linghun 与单纯“堆 prompts / 堆 skills”的区别。提示词可以指导模型，但底层能力能约束模型、记录事实、恢复现场、阻止越权，并把成功或失败变成可追踪的工程状态。Linghun 支持 Skill 生态，但不会把安全、验证、成本、远程控制和长期可靠性寄托在 Skill 上。

---

## 23. 远程通道边界

真实开发不总发生在电脑前。长任务跑到一半需要用户批准写文件、测试失败需要确认下一步、后台 agent 完成探索需要用户看摘要，这些时刻如果只能守在终端旁边，AI 托管的价值会被明显削弱。

Linghun 的 remote layer 面向这个痛点：把本地会话的重要事件安全送到用户已经在使用的手机 IM 通道，并在配置官方应用、事件回调、Stream 或本地 bridge daemon 后，允许手机端把审批或自然语言输入交回本地 Linghun 主链。它不是把远程通道变成不受控执行入口，也不是把代码和完整 transcript 发到外部平台。

配置模型覆盖：

- 企业微信 / WeCom。
- 飞书 / Lark。
- 钉钉。
- official CLI、webhook mock、webhook transport。

D.14E/D.14F 之后，远程通道分成两层能力：

- **通知层**：webhook 把任务状态、验证结果、失败摘要、稳定点和索引结果以脱敏摘要发到手机。飞书 webhook 出站链路已通过真实手机端 smoke 验证；钉钉和企业微信在提供真实 webhook 后可按同一模型验证。
- **手机接管层**：official CLI、平台应用、事件回调、Stream 或 bridge daemon 把手机端的审批、状态查询和自然语言输入转成 `RemoteInboundMessage`，再回到本地 `processRemoteInbound` 与 `handleRemoteInboundMessage` 主链。没有真实平台应用或 daemon 时，只能标为 fixture-ready / NOT RUN，不能冒充真实手机接管。

远程通道从“安全壳”升级为成品连接能力：

- **真实发送链路**：webhook 走 HTTP POST，official CLI 走 `execFile` 参数数组，不做 shell 拼接；`webhook_mock` 只作为诊断演练，不能当成真实投递成功。
- **低学习连接向导**：`/remote setup <channel>` 只展示必要字段，使用 `[已填] / [待填]` 和人话 next action，不要求用户理解 nonce、evidence、provider 或 transcript。
- **手机桥接向导**：`/remote bridge doctor|test-inbound|test-approval|test-status <channel>` 按平台真实能力显示 notification-only、needs-app-setup、needs-daemon、fixture-ready 或 inbound-ready。后续 pairing 层通过 `/remote bridge pair <channel>` 生成一次性绑定码和二维码 fallback，让用户在手机机器人里完成绑定。
- **手机自然语言入站**：手机端消息通过 `RemoteInboundMessage` 校验后，原样进入本地 `sendMessage` 主链；没有本地关键词截获，也没有第二套远程 agent。
- **远程审批闭环**：手机 approve/reject 只能恢复本地已有 `pendingLocalApproval`，实际执行仍由本地 permission resolver 完成；plan 模式远程 approve 也不能执行写操作。
- **远程收件箱与防打断**：状态查询只读；当前有 active model turn、active job 或 tool running 时，手机自然语言默认进入 remote inbox queue，不直接打断主任务。只有明确插队/中断意图才进入受控调度路径，并写入 transcript。
- **事件摘要面板**：`/remote events` / `/remote inbox` 展示最近远程事件的脱敏摘要，避免主屏噪音。

事件类型包括：

- approval_request。
- job_status。
- job_report。
- verification_result。
- failure_summary。
- stable_point_result。
- index_result。

钉钉的接入边界按当前代码事实拆成两条路径：

```text
钉钉自定义机器人 webhook
-> 只做 notification-only 出站摘要
-> Linghun POST msgtype/text payload
-> 成功发送不等于手机接管，也不等于任务验证通过
```

钉钉 webhook payload 形态是：

```json
{
  "msgtype": "text",
  "text": {
    "content": "redacted summary from Linghun"
  }
}
```

如果配置了 signing secret 引用，Linghun 会按钉钉机器人加签规则把 `timestamp` 和 `sign` 追加到 webhook URL；secret 只通过环境变量引用解析，不进入主屏、transcript 或 deliveryDetail。用户侧检查路径是 `/remote setup dingtalk`、`/remote test dingtalk`、`/remote status` 和 `/remote events`。这条 webhook 路径只能用于发送脱敏摘要、审批请求摘要、job 状态和验证结果摘要，不能接收手机消息。

要让钉钉消息回到 Linghun，需要官方应用、Stream 或等价 bridge daemon。当前适配层识别的钉钉 Stream frame 关键字段是：

```json
{
  "headers": {
    "topic": "/v1.0/im/bot/messages/get",
    "messageId": "msg-1"
  },
  "data": {
    "msgId": "msg-1",
    "senderId": "ding-user-1",
    "text": {
      "content": "继续检查失败测试"
    }
  }
}
```

这个 frame 会被转成 `RemoteInboundMessage`，再进入本地 remote inbox / active-turn guard / permission pipeline。审批类文本也只能恢复本地已有的 `pendingLocalApproval`，不能凭手机消息新造一个写操作。开发者要接钉钉入站时，本质是把钉钉官方应用或 Stream 收到的事件转换成 Linghun 认可的入站消息，并保留 messageId、source、expiry、signature/source proof 和绑定用户信息。

Linghun 按平台真实能力分级，而不是把“webhook 发出成功”包装成完整手机控制：

| 平台 | webhook 路径 | official CLI / 应用路径 |
| --- | --- | --- |
| 飞书 / Lark | notification-only，仅出站摘要；飞书 webhook 已真实 smoke 通过 | full-mobile-control-capable：可通过官方应用、事件订阅、长连接/回调或 CLI daemon 承接自然语言与审批回传 |
| 钉钉 / DingTalk | notification-only，仅出站摘要 | approval-capable / stream-callback-capable：审批路径可用；实时自然语言回传需要 Stream 或回调应用 |
| 企业微信 / WeCom | notification-only，仅出站摘要 | natural-language-inbound-capable / app-callback-capable：可通过自建应用“接收消息”或等价 daemon 回传自然语言；交互审批需要应用回调 |

安全边界包括：

- summary_only redaction。
- trusted source。
- binding user/device。
- nonce、messageId 与 expiry。
- signature 或等价来源证明。
- replay 防护。
- approval_request 自身过期后不能被新的手机消息批准。
- remote approval 通过后仍回到本地 pending approval 和 permission pipeline。
- remote inbox 队列和 active-turn guard，避免手机消息抢占或污染正在执行的本地主任务。

对用户来说，这个设计的价值是：离开电脑后仍能看见长任务进展、验证结果、失败摘要和审批请求；在配置对应平台应用或 bridge daemon 后，可以用手机发一句自然语言继续推进，也可以在手机上批准或拒绝本地 pending approval。手机端默认只看 summary-first 摘要，不同步完整 transcript、完整日志、完整 diff 或完整命令。对安全边界来说，远程端仍只是“输入、查询和审批接口”，不是新的执行器。代码修改、Bash、Git、索引刷新、稳定点和最终回答 gate 仍发生在本地 Linghun 主链。

因此，远程通道可以作为审批和通知适配层，但不会替代本地权限系统。

---

## 24. TUI 输出与交互分层

Linghun 的交互目标是：主屏关注结果，详情可追溯，复杂能力可发现。

主要交互面包括：

- 主输入与流式回答。
- slash suggestions。
- command panel。
- status footer。
- notification stack。
- background task surface。
- `/details` 完整内容入口。
- `/help`、`/help all`、`/help advanced`。
- `/config` 控制面板。
- `/btw` 临时问题/备忘入口。

输出原则是 summary-first：

- 默认主屏不倾倒完整日志。
- tool_result 保留 raw 诊断，主屏展示摘要。
- 长输出进入 fullOutputPath 或 details。
- evidenceId、changedFiles、fullOutputPath 在诊断层保留。
- 内部 provider/baseUrl/endpointProfile 默认不进入普通主屏。

这让 Linghun 可以同时服务新用户和高级用户：默认不被内部细节打断，需要追溯时又能展开。

---

## 25. 成本与性能控制

Linghun 的降本增效不是单点优化，而是多个层面协同：

- RuntimeStatusForModel 投影降噪：模型只看到必要运行时状态。
- Deferred tools 降噪：默认不把全部工具细节塞进主屏和 prompt。
- Stable tool ordering：减少工具顺序波动带来的 prompt cache 破坏。
- CacheFreshness changedKeys：定位缓存变差来源。
- Cache history：记录最近回合 hit rate、read/write tokens、provider/model/endpoint。
- Workspace Snapshot Lite：用有界摘要代替全量仓库扫描。
- Cache freshness：只有关键维度变化时才提示刷新。
- Prompt cache break marker：把 cache bust 做成显式行为。
- Memory topK：长期记忆只注入少量 accepted items。
- Log artifact slice：只读取需要的日志片段。
- Index freshness fast path：`/index status` 默认不跑慢检测。
- Resource/concurrency cap：限制 agent/job 并发。
- Provider circuit breaker：连续失败时降噪和降成本。

真实成本取决于模型、仓库规模、任务复杂度和用户工作方式。Linghun 的设计目标是让成本来源可见、可控、可诊断，并让长期项目在稳定工作流下保持更高的缓存复用。

---

## 26. 自研运行时与开源价值

Linghun 的核心价值在于把一组分散能力组织成统一运行时：

- 自研 provider runtime contract。
- 自研权限策略引擎。
- 自研 evidence 与 final answer gate。
- 自研 prompt cache usage、CacheFreshness、break-cache 和 deferred tool 稳定机制。
- 自研 Git stable point / managed worktree runtime。
- 自研 controlled memory 与 failure learning。
- 自研 durable job / multi-agent lifecycle。
- 自研 Windows process guard 与 Native Runner supervisor boundary。
- 自研 command panel、details、readiness、problems、verification surfaces。
- 自研 workspace reference cache 与 snapshot lite。

这些能力组合起来，使 Linghun 具备开源项目更需要的几个特性：

- 可读：用户和开发者能理解系统为什么这么判断。
- 可查：重要结论有 transcript、evidence、logs、reports。
- 可控：权限、记忆、远程、扩展、Git 操作都可由用户显式管理。
- 可扩展：provider、MCP、skills、plugins、hooks、runner 都有清晰边界。
- 可长期维护：核心业务逻辑已经从单一巨型入口拆到职责模块中，index 主要承担 composition root 和主链 glue。

---

## 27. 面向所有大模型的工程化外骨骼

Linghun 的出现，建立在大模型能力快速进步的基础上。无论是代码理解、自然语言推理、工具调用、长上下文、视觉输入，还是复杂任务规划，今天的模型厂商已经把 AI 编程推到了真实可用的门槛上。每一个强模型背后都有巨大的训练成本、数据工程、推理优化和基础设施投入；Linghun 尊重并受益于这些研发成果。模型越强，Linghun 能承载的工程任务就越复杂。

但真实开发不只需要“一个更聪明的模型”。开发者还需要权限边界、证据记录、验证闭环、Git 稳定点、缓存成本、长期上下文、失败复盘、Windows 守护、长任务托管和可诊断输出。Linghun 的定位不是绑定某一家模型，也不是替代模型厂商，而是为不同大模型提供一层工程化外骨骼：

模型训练解决的是通用智能问题：让模型会读代码、会推理、会生成、会调用工具、会处理长上下文。但它不会天然知道用户本地仓库此刻的真实状态：哪些文件刚被改过，哪个测试实际失败，Git 工作区是否干净，索引是否新鲜，provider 是否真的可用，某个历史失败是否又在重现，当前回答是否夸大了验证范围。这些不是单靠训练参数就能稳定解决的问题，而是运行时、工具链和工程流程的问题。

Linghun 的工程化外骨骼解决的就是这层问题：

- **把模型接到真实仓库**：通过文件读取、搜索、索引、diff、workspace snapshot 和 evidence，让模型围绕当前代码事实工作，而不是围绕想象中的项目工作。
- **把模型接到真实工具**：读写文件、Bash、验证、Git、worktree、agent、job、MCP 和扩展工具都经过统一 runtime，而不是散落成不可追踪的临时动作。
- **把模型接到真实权限**：写文件、跑命令、刷新索引、Git 操作和远程审批都进入同一套权限与路径安全边界，用户不用在速度和安全之间二选一。
- **把模型接到真实验证**：build、test、smoke、review、readiness 和 final answer gate 会区分 PASS、PARTIAL、FAIL、synthetic、focused 和未验证，不让模型把局部成功写成整体完成。
- **把模型接到真实成本**：prompt cache、tool schema 稳定性、summary-first、deferred tools、CacheFreshness 和 usage history 让长期项目不必每轮重新付费理解全部背景。
- **把模型接到真实长期上下文**：受控记忆、handoff、失败学习和反思记录让系统逐步贴合用户习惯，同时避免把历史记忆当作当前事实证据。
- **把模型接到真实交付边界**：Git 稳定点、managed worktree、架构检查、代码卫生和报告守卫让每一轮开发更容易留下可回滚、可审查、可继续维护的状态。

对开发者来说，这层外骨骼带来的直接影响很朴素：模型更少凭空猜，更少重复读无关文件，更少把没验证的东西说成完成，更少把日志和工具噪音塞满上下文，更容易保留稳定点，更容易从失败中吸取教训，也更容易把一次对话推进成一个能继续维护的项目。

对刚开始学习编程、刚准备拥抱 AI 开发的新手来说，这层外骨骼的意义更直接。强模型可以降低“写出第一版代码”的门槛，但新手真正容易卡住的地方，往往是项目结构、依赖安装、错误修复、测试验证、Git 回滚、运行环境和后续维护。Linghun 把这些工程环节放进同一条可观察主链，让用户可以用自然语言持续推进需求，同时由系统补上证据、权限、验证、稳定点和交接边界。结果不是保证每个项目一次成功，而是显著提高从一个想法直接推进到可运行、可验证、可继续迭代成品的成功率。

因此，Linghun 可以随模型能力持续进化：今天接入适合执行的模型、适合审查的模型、适合总结的模型；未来也能继续承载更强的规划、视觉、长上下文和工具调用能力。模型厂商提供智能内核，Linghun 提供工程运行时，让 AI 编程从“模型会回答”走向“模型能在工程边界内持续工作”。

---

## 28. 对 AI 编程浪潮的基本判断

每一次重要生产力工具出现，都会带来类似的争论：它是否会替代人，是否会摧毁原有工作方式，是否只是短期泡沫。蒸汽机、电力、自动化生产线和互联网都曾冲击传统行业，也迫使劳动方式、组织方式和技能结构发生变化。蒸汽机进入纺织业后，传统手工纺织受到巨大冲击，但更长期的结果不是社会停止生产，而是生产规模、协作方式、岗位结构和技能要求被重新定义。

AI 编程也处在类似阶段。唱衰它的人会看到幻觉、错误代码、上下文遗忘、验证不足和安全风险；乐观过头的人则会把模型当作可以完全替代工程流程的自动开发者。Linghun 的判断是：AI 会持续改变软件开发，但真正能进入真实工程的，不是“只会生成代码的模型”，而是模型能力与工程运行时结合后的新工作方式。出现问题时，更有价值的态度不是否定 AI，而是承认问题、寻找解决方式，并肯定模型公司在训练、推理、工具调用和长上下文能力上已经带来的真实增效；同时也要承认，只有把这些能力放进工程化流程里，增效才能更稳定地落到开发者手里。

幻觉并不意味着 AI 编程没有价值，它意味着系统必须把事实、验证和边界接进去。模型很强，但不能默认知道当前仓库事实；模型会推理，但不能默认代表验证通过；模型能生成代码，但不能默认符合架构、权限和长期维护要求。把这些问题交给用户手动兜底，会让新手更容易被误导，也会让专业开发者把时间浪费在返工、排查和重复确认上。

Linghun 的产品选择，是不把 AI 编程包装成“人类不需要工程能力了”，也不把 AI 幻觉当作无法克服的宿命。它把模型放进 evidence、permission、verification、Git、memory、failure learning、architecture 和 cost runtime 里，让用户既能享受模型带来的速度，也能保留工程开发必须有的可控性。

这背后还有一个更朴素的现实：开发者的时间和注意力是有限的。真实工作里，消耗人的往往不只是写代码本身，而是反复解释上下文、重复定位文件、盯着长任务输出、处理环境问题、担心误改、确认验证范围、修复同类失败和在夜里继续收尾。生活节奏越来越快，压力越来越高，工具如果只是让人“更快地产出更多任务”，并不一定真的改善开发者的状态。

Linghun 更希望把工程化带来的效率，转化成开发者能感知到的余量：少一点无效等待，少一点重复返工，少一点不确定焦虑，少一点因为模型幻觉带来的二次清理。省下来的时间不只可以继续写更多代码，也可以用来休息、复盘、学习、沉淀产品判断，或者把注意力放回真正需要人类经验和审美的地方。AI 编程工具的成熟，不应该只用吞吐量衡量，也应该看它是否让开发者更从容地完成真实工作。

在可工程化的前提下，AI 对个人开发者的意义会进一步放大。过去很多想法不是没有价值，而是卡在时间、精力、环境、工程经验和试错成本上：一个人想做工具、网站、插件、自动化脚本、SaaS 原型或开源项目，常常要同时承担产品、前端、后端、测试、部署、文档和维护。Linghun 希望把这条链路变短：让个人开发者能够更高效、更省力、更低成本地把想法做成可运行、可验证、可迭代的项目，并在此基础上探索副业、作品集、开源影响力或商业变现。

这也是 AI 编程更深层的意义之一：不是简单让开发者被动接受替代，而是让更多人拥有把想法工程化落地的能力。模型提供智能，Linghun 提供工程护栏和运行时，个人开发者由此可以把有限时间投入到选择问题、理解用户、打磨体验和创造价值上，而不是长期消耗在重复搭环境、重复排错和重复返工里。

这对开发者意味着两件事：

- 对新手来说，AI 不只是回答问题的老师，而可以成为一个带工程护栏的协作者，帮助他们从想法走到可运行、可验证、可继续维护的项目。
- 对专业开发者来说，AI 不只是代码补全或聊天窗口，而可以进入真实工作流：读仓库、改代码、跑验证、留稳定点、复盘失败、控制成本，并把交付结论限制在证据边界内。

所以 Linghun 不是站在“AI 替代人”或“AI 没有价值”的两端。它更关心的是：当模型能力越来越强时，开发者如何把这种能力接入真实工程，而不是被幻觉、噪音、成本和不可控自动化拖住。这也是 Linghun 把自己定位为工程化外骨骼的原因。

---

## 29. 适用场景

Linghun 适合以下工作流：

- 在真实项目里让模型读代码、改代码、跑验证，并输出有证据边界的总结。
- 用不同模型分别处理规划、执行、审查、验证和总结。
- 把复杂需求拆成 Workflow Plan、多 agent 子任务、架构确认、验证切片、稳定点建议、风险提示和最终交付证据，减少用户手工拆任务和盯进度的成本。
- 在同一项目长期开发中保持稳定上下文、稳定工具调用和高缓存复用，减少重复解释与重复付费。
- 在大仓库中结合索引、grep、workspace snapshot 定位代码。
- 在阶段性开发中创建 Git 稳定点和 worktree，降低回滚成本。
- 用 agent 并行探索、规划或验证，不阻塞主会话。
- 用 durable job 承载有预算和生命周期的长任务。
- 用 controlled memory 保留项目习惯，而不是让模型随意写长期记忆。
- 用 failure learning 让真实失败转化为后续风险提示。
- 在 Windows 终端、PowerShell、cmd.exe、中文路径和长任务环境下运行可守护的 AI 编程工作流。
- 用 doctor/problems/verify 在交付前做保守复核。
- 用 MCP、skills、plugins、hooks 接入团队或个人工具链。

---

## 30. 面向个人 AI 管家的长期预演

Linghun 当前首先服务的是开发者工程场景，但它的底层形态并不只属于代码编辑。更长期看，它可以被理解为一种 Jarvis-like personal AI runtime 的早期工程底座：模型负责理解、推理、对话、规划和人格表达；运行时负责接入软件、硬件、记忆、权限、证据、验证、远程通道、长期任务和能力生态。

这个判断的前提不是等待一个“全知全能模型”单独出现。只指望模型本身全知全能，并不是更现实的 AGI 路线：模型再强，也仍然需要实时事实、网络信息、软件 API、硬件设备、传感器状态、用户记忆、权限边界和行动通道。一个再强的大脑，如果没有感官、神经系统、躯干和执行器，也只能停留在对话层。Linghun 的 provider runtime、tool runtime、permission runtime、evidence runtime、memory runtime、job runtime、agent/workflow runtime、remote channel 和 Capability Runtime / App Bridge，正是在形成这样的神经系统和行动底座。

### 30.1 当前已经具备的底座形态

从代码事实和阶段交付看，Linghun 已经不是单个模型壳，而是一个互相咬合的可信行动 runtime。它目前已经具备以下底座能力：

- **模型大脑**：provider runtime 和多模型角色路由，让 planner、executor、reviewer、verifier、summarizer 等角色可以使用不同模型和能力边界。
- **工具身体**：Read、Write、Edit、MultiEdit、Grep、Glob、Bash、Todo、Diff、Git、index、verification 等工具进入同一条执行链，而不是散落在提示词里。
- **万能插头雏形**：Capability Runtime / App Bridge 已经把外部能力抽象成 transport、auth、permission、riskLevel、inputSchema、outputSchema 和 provider；外部 app 可以通过 manifest 和 connector 暴露 capability。
- **权限神经系统**：default、auto-review、plan、full-access 四档权限、路径安全、命令语义分类、workspace trust、resource cap 和 Start Gate 决定动作能不能执行。
- **证据与完成度边界**：工具结果、capability 执行、Git、verification、index、provider failure 等都能写入 evidence；能力执行成功不自动等于 verification PASS。
- **记忆与人格连续性底座**：session、handoff、controlled memory、failure learning、用户状态调度和跨轮连续性，让系统不是每轮从零理解用户。
- **多智能体与长任务**：StartAgent、SendMessage、agent mailbox、独立 transcript、后台 fork、cwd / managed worktree isolation、Workflow Matrix、durable job 和 bounded worker loop 支持角色化、后台化、可观察的复杂任务。
- **远程入口**：remote channel 支持通知、审批、自然语言入站和手机侧状态查看的分级能力，远程输入仍回到本地主链。
- **成本与上下文控制**：prompt cache、CacheFreshness、summary-first、deferred tools、bounded logs、workspace snapshot 和 accepted-only memory 降低重复解释和重复付费。

这些能力组合起来，已经构成“模型是大脑，Linghun 是躯干和神经系统”的基础结构。模型不需要直接控制世界；它只需要提出意图、读取事实、生成计划和调用能力。真正的连接、权限、执行、证据、验证、记忆和恢复，由底座负责。

### 30.2 从 AI 编程终端到智能管家

如果把当前开发者场景中的工具和项目能力，替换或扩展成生活、办公、家庭和设备能力，Linghun 的运行时形态可以自然迁移成个人 AI 管家。这个迁移不需要推翻现有架构：

- `Read/Grep/Index` 对应现实世界里的状态读取、设备查询、传感器信息、日历、邮件、文档、知识库和网页。
- `Edit/Write/Bash/Git` 对应软件操作、自动化脚本、设备动作、配置修改、工单处理和工作流推进。
- `Verification` 对应动作后的状态确认，例如设备是否已执行、订单是否已创建、提醒是否已保存、工单是否已更新。
- `Evidence` 对应所有关键动作的可追溯记录。
- `Permission` 对应物理世界和敏感软件操作前的用户确认。
- `Memory` 对应用户习惯、家庭偏好、沟通风格、常用设备、作息、长期目标和历史风险。
- `Agent/Job/Workflow` 对应复杂任务拆解，例如家庭自动化配置、出行安排、办公流程、长期监控、批量整理和跨软件任务。
- `Remote` 对应手机、手表、音箱、车机或企业 IM 中的通知、审批和自然语言入口。

在这种形态下，智能管家不只是把语音命令翻译成“开灯”“设闹钟”或“查天气”。它可以理解用户当前处境、记住偏好、查看多个系统状态、调用合适 capability、必要时请求确认、执行后记录证据，并在不确定或失败时降级。对普通用户来说，它可以存在于手表、手机、音箱、桌面端、家庭中控或车机中；对团队来说，它可以是私有化部署的工作流助理；对开发者来说，它仍然是工程化 AI 编程终端。

这里的关键是“万能插头”形态。智能管家不需要把每个设备、每个软件、每个服务都写死进自身；它需要一套统一的能力描述和调用边界。日历可以暴露“读日程 / 新建事件 / 改时间”的 capability，音箱可以暴露“播放 / 朗读 / 收音”的 capability，家居系统可以暴露“查询状态 / 执行动作 / 场景联动”的 capability，企业系统可以暴露“查工单 / 提交审批 / 更新知识库”的 capability。模型只需要理解用户意图和选择能力，运行时负责确认输入、检查权限、执行动作、记录证据和处理失败。

当这种万能插头接入网络和各种 API 后，它在现实里会演化成一个跨软件、跨设备、跨场景的个人操作层。例如，用户说“我今晚晚点回家，帮我安排一下”，智能管家可以先读取日历和定位状态，查询交通和天气，通知家人或团队，调整智能家居到晚归模式，推迟提醒，必要时预订交通或外卖，并把每一步需要确认的高风险动作单独提出来。用户说“明早我要出差”，它可以检查航班、天气、日程、行李清单、打车时间、公司会议冲突、家里设备状态和路由安排，而不是只返回一段建议文本。

在工作场景里，同样的底座可以把邮件、日历、文档、工单、代码仓库、会议记录、知识库和企业 IM 串起来。它可以把“帮我准备明天的评审”拆成读取相关文档、整理变更摘要、检查待办、生成会议材料、提醒相关成员、标注未确认风险和保留证据。对于家庭场景，它可以把智能音箱、摄像头、门锁、灯光、空调、传感器、扫地机、NAS 和家庭日历连接成一个可对话的家庭状态层。对于个人场景，它可以把手表、手机、耳机、健康数据、日程、提醒、地图、支付和常用 app 变成一个随身 AI 管家。

这类演化的重点不是“把所有 API 都接上就自动智能”，而是所有 API 都进入同一条可信主链：查询和动作要有 schema，敏感动作要有权限，结果要有回执，关键结论要有证据，长期偏好要可审查，失败要能降级。这样它才不会变成一个会联网的遥控器，而会变成一个能跨现实能力持续工作的个人 AI runtime。

### 30.3 为什么这比等待全知模型更现实

全知全能的模型听起来更直接，但即使模型接近通用智能，它也仍然需要网络、软件和硬件。它需要联网获取最新事实，需要软件 API 执行动作，需要传感器理解环境，需要设备控制现实世界，需要记忆理解长期用户，需要权限避免误操作。模型能力越强，越需要一个可信运行时把它接入现实，而不是让它凭空猜测。

因此，AGI 的产品化未必首先表现为“一个什么都知道的模型”，而可能先表现为“一个把模型接到真实世界能力上的操作底座”。Linghun 的路线更接近后者：用模型作为大脑，用 capability 作为万能插头，用权限和证据保证可控，用记忆和失败学习形成长期连续性，用 agent/job/workflow 托管复杂目标。

这条路径也更容易渐进落地。模型不需要一开始就处理所有任务；底座可以先把高频、低风险、可验证的动作接起来，再逐步扩展到更复杂的软件和硬件 capability。每接入一种能力，都不应绕过主链，而是进入相同的 schema、permission、evidence、verification、memory 和 failure boundary。

### 30.4 对 AGI 产品化的构想

从产品角度看，AGI 不一定先以“单一模型突然拥有所有能力”的方式出现。更可能先出现的是一种系统级智能：算力提供推理资源，模型提供理解和生成，软件运行时提供工具、记忆、权限、调度和验证，硬件与传感器提供现实世界入口，网络与外部 API 提供最新事实和行动接口。它不是一个孤立大脑，而是一个由模型、运行时、软件、硬件和生态共同组成的智能体系统。

这种系统级 AGI 的核心能力不是“知道一切”，而是能在不确定世界里持续闭环：

- 能感知：读取文件、网页、设备状态、传感器、日历、消息、应用数据和用户输入。
- 能理解：用模型把自然语言、上下文、情绪、任务目标和风险转换成可执行意图。
- 能行动：通过工具、connector、API、脚本、设备协议和 agent/job/workflow 执行任务。
- 能验证：执行后确认结果、记录证据、区分完成、失败、部分完成和未验证。
- 能记忆：长期保留被用户确认的偏好、项目规则、家庭习惯和真实失败教训。
- 能自控：在高风险、低确定性、隐私敏感或物理世界动作前请求确认或降级。
- 能人格连续：保持稳定沟通风格、理解信任变化和长期关系，而不是每一轮都像陌生工具。

这也是 Jarvis-like 产品和普通助手的差别。普通助手更像一个功能入口；Jarvis-like runtime 更像一个持续存在的个人操作系统。它不需要一开始就拥有电影里的全域智能，但需要把“理解、行动、验证、记忆、权限、人格和生态接入”放进同一条系统主链。

### 30.5 2026 年技术条件分析

按 2026 年的技术条件，这种产品雏形已经具备现实可行性。大模型已经能完成自然语言理解、长上下文推理、工具调用、代码与文档处理、多轮对话、情绪识别、图像/语音/多模态理解和角色化协作；本地小模型与私域模型已经足以承担大量低风险、低成本、低延迟任务；云端强模型可以承担复杂推理和高价值任务。

软件侧，MCP、plugin、HTTP API、WebSocket、本地服务、浏览器自动化、系统快捷指令、企业开放平台、Home Assistant、Matter、智能家居网关和各类应用 API，已经提供了足够多的连接方式。硬件侧，手机、手表、音箱、摄像头、车机、IoT 设备、家庭中控和边缘计算盒子，都可以作为入口或执行端。真正缺的不是某一个“魔法模型”，而是把这些能力统一进一个可控 runtime 的产品底座。

从这个角度看，今天要做 Jarvis-like 智能管家，技术瓶颈主要不是“能不能做”，而是“能不能把它做得稳定、低成本、可信、可扩展、可审计、可被普通用户理解”。需要解决的不是科幻级问题，而是产品工程问题：

- 如何把软件和硬件能力抽象成统一 capability。
- 如何让模型稳定选择正确 capability，而不是乱调用。
- 如何让敏感动作经过权限确认。
- 如何让执行结果可验证、可追溯。
- 如何让长期记忆可控、可删、可审计。
- 如何让人格连续但不装神、不伪造事实。
- 如何用分层模型路由控制成本。
- 如何让第三方应用和硬件逐步接入生态。

Linghun 的价值在于，它已经把这些问题中的大部分抽象成运行时结构，而不是只停留在助手交互层。当前它服务于开发者工程场景；迁移到智能管家场景时，要替换的主要是 capability 类型、用户入口和设备 connector，而不是重写整个底座。

### 30.6 成本与普及路径

个人 AI 管家不必每次都调用最强模型。日常陪伴、提醒、设备控制、简单问答、状态查询、私域记忆、固定工作流和家庭自动化，可以由本地模型、私域模型或低成本模型承担；复杂规划、代码、审查、多模态分析、高价值决策和跨系统编排，再临时路由到更强模型。

这意味着它可以面向普通用户普及，而不是只服务高成本专业场景。一个可行的成本分层是：

- 本地小模型处理唤醒、简单意图、常用问答和部分隐私对话。
- 私域模型处理长期陪伴、个人记忆、家庭偏好和低延迟日常响应。
- 低成本云模型处理普通规划、摘要、轻量推理和跨软件指令。
- 强模型只处理高复杂度、高价值、高风险任务。
- cache、summary-first、bounded artifact、受控记忆和工具结果复用减少重复调用。

在商业化上，它可以先以软件形态存在，也可以进入硬件。早期形态可以是智能管家 app、桌面端、手表端、音箱/中控硬件、浏览器插件、企业 IM bot 或家庭网关。硬件不是唯一入口，真正可复用的是底座。

从成本预期看，个人版 Jarvis-like runtime 不必按“每个用户都长期占用顶级模型”的方式设计。更现实的结构是：本地或私域模型常驻处理日常低风险任务，云端强模型只在复杂规划、代码、长文档、多模态或高价值决策时被调用。对个人开发者来说，一台普通电脑、手机或低成本边缘盒子，加上本地模型、少量云端 API、几个常用 connector，就可以先做出个人版智能管家的可用雏形。对小团队来说，一个私有部署的模型服务、企业 IM bot、内部 API connector、文档/工单/日历/代码仓库接入，就可以形成企业版 Jarvis 的第一版。

这种路径的价值在于技术普惠：不需要等到昂贵硬件、专有生态或全知模型成熟后，普通用户、个人开发者和小团队才能拥有自己的 AI 管家。已有技术已经足以搭出分层版本：

- **个人轻量版**：本地模型 + 手机/桌面入口 + 日历/提醒/文件/浏览器/智能家居 connector，主要处理日常管理、提醒、状态查询和简单自动化。
- **个人增强版**：私域记忆 + 低成本云模型 + 少量强模型路由 + 多设备入口，能处理出行、家庭、学习、个人项目和跨 app 任务。
- **家庭版**：家庭网关或中控 + Home Assistant / Matter 类设备桥接 + 家庭日历 + 语音入口 + 权限确认，形成可对话的家庭状态层。
- **团队版**：企业 IM bot + 私有模型或混合模型 + 内部知识库、工单、审批、日历、文档、代码仓库 connector，形成可审计的团队工作流助理。
- **开发者版**：Linghun 当前工程底座 + agent/job/workflow + App Bridge / MCP / plugins，用现有技术快速验证新的 capability 和业务场景。

这些版本的成本差异主要来自模型路由、调用频率、上下文长度、是否需要多模态和是否需要专用硬件。底座越稳定，越能把强模型调用集中到真正需要的地方；capability、记忆、缓存和验证越成熟，越能减少重复推理和无效调用。换句话说，Jarvis-like 产品的普及不只靠模型降价，也靠运行时把模型用得更少、更准、更安全。

### 30.7 当前能做到什么，未来还需要什么

基于当前 Linghun 底座，今天已经可以做到的是：

- 把外部软件能力通过 Local HTTP connector / manifest 注册为 capability。
- 让模型通过结构化工具发现、选择和调用能力，而不是只输出建议文本。
- 让 capability 执行经过输入 schema、连接状态、权限检查、风险级别和 evidence 记录。
- 把 agent、job、workflow、verification、Git、index、memory、failure learning、remote channel 接入同一主链。
- 用独立 transcript、mailbox、后台任务和 worktree isolation 支持更像真实分工的智能体协作。
- 用私域 provider 配置、多模型路由和缓存机制，为低成本、可控部署留下空间。

面向通用智能管家，还需要继续产品化的是：

- 面向普通用户的语音唤醒、TTS、移动端、手表端、音箱端和家庭中控体验。
- 面向智能设备的 connector 模板、设备能力 schema、动作回执和物理世界安全策略。
- 面向个人长期关系的人格连续性、偏好学习、隐私记忆 review 和家庭多用户边界。
- 面向生态的 connector SDK、插件市场、设备认证、权限分级和审计标准。
- 面向低成本部署的本地模型、私域模型、强模型路由、离线降级和账单透明。

这一节不是声明 Linghun 已经完成通用智能管家或硬件生态，而是说明它的长期产品方向：AGI 的产品化未必首先表现为一个全知模型，而可能先表现为一个低成本、可扩展、可审计、可接入软件和硬件能力的个人 AI 操作底座。Linghun 当前已经具备开发者场景中的底座形态；未来的关键，是把这种底座从代码世界扩展到更多真实世界 capability。

---

## 31. 明确边界

Linghun 的能力边界如下：

- Evidence-first 不等于“永不出错”，而是让关键声明接受证据约束。
- 本地 doctor 和 focused validation 不等于真实全量 smoke。
- 合成 smoke 不等于真实 provider/TUI/render/report 主链 smoke。
- 失败学习只是历史风险提示，不是当前任务证据。
- 长期记忆必须用户确认，不自动写入。
- Remote channel 是审批/通知适配层，不是绕过本地权限的远程执行平台。
- Workflow Plan、Workflow Matrix、多智能体和 durable job 不是绕过权限的自动执行系统；它们复用现有四档权限、工具运行时、Evidence Merge、verification、architecture gate 和 final answer gate，后台任务结束也不等于交付已经验证完成。
- Native Runner 有受控 supervisor 边界和 Node fallback，不等同于所有平台都已完整验证的底层守护进程。
- Windows Job Object 是 Native Runner 的商业级守护契约；Node fallback、普通单元测试和无真实 runner smoke 不能伪装成 native 进程树守护已被完整证明。
- 索引是定位辅助，不是唯一事实来源。
- 缓存命中率 92%-96%、接近 98% 和部分 100% 描述稳定工作流下的目标和观测区间，不代表任意模型、provider 和项目的结果。
- 局部索引、并行工具或缓存收益不等同于整体开发固定提速倍数；实际收益由项目、模型、任务和 usage 数据共同决定。
- Jarvis-like personal AI runtime 是长期产品方向，不等于当前已经完成智能手表、智能音箱、智能家居、车机、摄像头或通用硬件生态接入。
- 外部 capability、设备 connector 和私域模型可以进入同一底座，但仍必须经过权限、证据、隐私、失败降级和用户控制边界；不能因为设备可接入就默认允许自动执行。

这些边界体现 Linghun 的工程取向：能力、证据、验证和适用范围保持一致，避免把局部能力包装成无条件承诺。

以上关于底座实现、产品演化和长期方向的判断，基于当前已经实现的能力、阶段交付事实和个人推演，只代表个人观点，不针对任何厂商、产品、组织或个人。
