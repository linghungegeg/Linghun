# Linghun 优势说明

Linghun 不是一个简单套在模型外面的聊天壳。它是一套编程智能体运行时，把模型、工具、权限、证据、验证、索引、缓存、长任务和扩展边界放进同一个受控系统里。

这份文档用于后续 README / remade 素材整理，重点说明项目优势和产品方向，不写审计问题，不写具体数据指标。

## 核心定位

Linghun 的核心优势是：强底座、低学习成本。

用户可以用自然的中文或英文交互；底层 runtime 负责判断什么时候进入模型、什么时候走本地命令、什么时候需要确认、什么时候必须先取证、什么时候要拦截未验证结论。表面使用简单，底层约束严格。

它的产品方向很明确：模型不是整个系统，模型只是一个被工程 runtime 托管的推理部件。

## 可信编程 Runtime

Linghun 把编程任务当成一个受控生命周期，而不是一段自由聊天。

用户输入进入模型/工具循环后，runtime 可以处理 provider 流式响应、工具调用、多轮工具结果 continuation、usage 记录、权限确认、证据保存和最终回答呈现。工具执行不是孤立动作：权限请求、证据记录、provider 失败、缓存状态、架构检查和验证结果都会回流到主运行时。

这让 Linghun 比普通 tool-calling 聊天客户端更稳。模型负责推理，runtime 负责控制工作流。

## 证据优先的反幻觉系统

Linghun 的反幻觉不是只靠提示词，而是围绕 evidence 建立约束。

当涉及代码事实、就绪状态、验证结论、最新信息或外部事实时，Linghun 会鼓励或要求使用文件读取、grep 结果、命令输出、索引查询、验证运行或其他 artifact 作为证据。缺少证据的结论可以被降级、阻断，或标记为需要免责声明。

这很关键，因为编程智能体最常见的问题就是“还没看就敢说”。Linghun 用 evidence 系统把已观察事实和模型猜测分开。

## 多角色模型路由

Linghun 不把规划、执行、验证、总结、视觉和生图都压给同一个模型角色。

项目内置 planner、executor、reviewer、verifier、summarizer、vision、image 等角色路由。每个角色可以有自己的 provider/model、能力要求、工具边界、写入边界、Bash 边界和预算策略。

这个设计让职责更清楚：

- executor 专注实现。
- verifier 专注验证。
- summarizer 专注降低上下文压力。
- vision 和 image 可以被隔离成 evidence 或资产 metadata，而不是直接获得写权限。
- planner / reviewer 可以和直接修改代码的执行路径分开。

这种角色拆分是压制模型失控的重要基础。

## 权限与策略系统

Linghun 的权限不是一个简单的“允许工具”开关。

runtime 包含 permission mode、hard deny、allow rule、Start Gate、报告写入 guard，以及独立的 permission policy engine。策略引擎会按语义风险、路径安全、只读行为、写入行为、破坏性行为、网络访问、依赖安装、密钥读取、deferred tool 来源等维度分类。

这形成了实际可用的安全边界：

- 只读动作可以更顺滑。
- 写入动作保持受控。
- 危险命令需要明确确认。
- 敏感路径和密钥受到保护。
- deferred / 外部工具默认保守处理。

模型很难把一个模糊请求直接变成本地高风险动作。

## 架构 Runtime

Linghun 有一层面向架构约束的运行时。

runtime 可以生成 architecture card、记录 architecture evidence、在工具执行前检测 scope drift，并在工具调用偏离当前架构目标时要求确认。它也包含大文件、深层嵌套、跨层修改、循环风险和 god file 压力等边界检查。

这让 Linghun 能在模型试图用大范围扩散来解决小问题时进行拦截。对长期项目维护来说，这个系统很重要。

## AntiCodeBlob 大文件治理

Linghun 新增了 AntiCodeBlob 系统，专门应对大文件、架构膨胀和默认 provider 风险。

它的定位不是替用户自动重构，而是在模型准备触碰高风险大文件、放大单文件复杂度、偏离架构边界或使用默认 provider 带来不确定性时，先进行提示和确认。这个治理层只负责暴露风险、要求用户决策和记录事件，不替代真正的工具权限系统。

关键边界很清楚：

- 架构、大文件、默认 provider 风险只负责提示和确认。
- 真正工具执行仍然走原 permission pipeline。
- 用户确认继续后，只解除该治理提示，不解除工具权限。
- 用户选择拆分时，只输出拆分计划，不自动重构。
- 所有确认事件进入 transcript / system event 或等价 audit 路径，后续可追踪。

这让 Linghun 在大文件维护场景里更稳：模型不能把“我觉得可以改”直接变成高风险大文件改动；用户也不会被系统强行推进重构，而是先看到风险、计划和确认路径。

## 索引与代码事实系统

Linghun 有围绕 codebase-memory 的索引工作流。

索引状态、doctor、check、search、architecture 查询、refresh 路径、runtime discovery、artifact 状态和 safety scan 都进入本地控制面。索引能力不会被盲目暴露给模型，而是经过静态注册、必填参数检查、mutating gate 和 trust 边界。

这给 Linghun 提供了更强的代码事实底座：模型可以利用索引理解项目，但索引能力的发现和执行仍由 runtime 控制。

## 缓存与降本增效

Linghun 把 prompt cache、cache freshness、上下文压缩、workspace reference 和 usage 统计当成一等 runtime 能力。

缓存系统会跟踪影响复用的关键维度：system prompt、工具 schema、模型/provider、MCP 与 deferred tools、memory、compact 边界、plugins、endpoint profile 和 prompt cache 控制。break-cache 是显式行为，而不是偶发副作用。

workspace reference cache 和 micro compact 可以减少不必要的上下文负载。usage / cache 统计帮助用户理解成本和延迟，而不是靠感觉猜。

在多次稳定工作场景实践中，这套底层优化不依赖某一个特定模型。大部分模型在文档和工程上下文复用场景中可以保持较高缓存命中率，常见稳定区间约 92%-96%，极限场景可以接近 98%，部分重复度极高的任务甚至可以到 100%。这说明 Linghun 的降本能力来自 runtime 结构，而不是单纯依赖模型供应商特性。

产品优势很直接：Linghun 是为了让长会话保持高效，而不是每一轮都重新烧完整上下文。

## 长任务低资源设计

Linghun 把长任务当成 durable runtime 问题，而不是让模型对话一直热挂。

durable job 有状态、日志、报告、进度、timeout/cancel/stale 处理和 evidence 引用。长任务可以走 native runner adapter，也可以走 Node fallback。自研 native runner 使用轻量协议，支持 start、status、stop、heartbeat、state file、stdout/stderr log、lock、timeout 和 cancel。

这种设计降低资源占用：

- 主 TUI / 模型循环不需要一直持有完整长任务上下文。
- 大输出保存在日志和 artifact 中，模型只消费摘要和 evidence 引用。

这对真实开发任务很有价值，尤其是耗时长、输出大、需要后台监督的任务。

## 智能多智能体调度与低资源并发

Linghun 的多智能体能力不是简单多开几个模型会话，也不是固定角色加一个并发 cap。

它更接近 Virtual Agent Concurrency：runtime 会把多角色、多任务、长任务和子任务放进统一 BackgroundTask / durable job 体系里，根据任务类型、风险等级、角色能力、预算约束、上下文压力、证据需求和验证状态决定拆分方式、执行顺序、并发度、权限边界和结果合并路径。

这个体系的重点是低资源、可审计、可恢复：

- 多 agent 可以并行工作，但不会复制完整 transcript、source、index 和 log。
- 子任务可以独立 timeout、cancel、stale、blocked、partial 和结果归档。
- 大输出沉淀为日志和 artifact，主屏保持 summary-first。
- handoff packet 记录 agent assignment、worker result、budget、boundary、adopted/rejected conclusions。
- evidenceRefs 和 verification 进入采信链，结论不是模型口头说了就算。
- 超预算、stale、timeout、blocked、partial 等状态不会被静默升级成 PASS。
- 不同 agent 可以绑定不同角色、provider、权限边界和预算策略。
- workspace reference cache 会做并发 coalesce，避免多个 agent 重复扫描同一批上下文。
- 不同 evidence、log 或 runtimeStatus 不会被错误合并，减少并发任务之间的事实污染。

这让 Linghun 的多智能体更接近受 runtime 治理的低资源 agent scheduler，而不是靠堆 token、堆进程和堆上下文硬撑并发。它优先做的是多 agent/job 的资源治理、证据治理、handoff 边界、报告采信、防止上下文爆炸和防止假 PASS。

后续如果继续增强真实 agent run loop，也是在现有 scheduler / evidence / handoff 底座上提升单个 agent 的自主执行深度，而不是推倒重做调度系统。

## Windows 优先的商业适配

Linghun 把 Windows 当成一等开发环境，而不是顺手兼容。

项目里有 Windows 路径大小写处理、terminal capability 检测、ConPTY 终端分层、Ink/plain renderer fallback、no-color 渲染、CJK 路径和输出处理、Windows `taskkill` 进程树终止，以及 native runner / process guard 方向的进程监督能力。

很多编程工具默认更偏 Unix-like 终端。Linghun 对 Windows 的投入，让它更接近真实商业用户的开发环境。

## 中英文友好体验

Linghun 的中英文支持不是只翻译几个表层文案。

language 设置贯穿 config、runtime presenter、shell view model、permission prompt、doctor 输出、状态栏、setup 流程、任务建议和错误消息。shell 还处理 CJK 字符宽度和不同终端渲染差异。

这带来的不是简单本地化，而是中英文用户都能自然交流，同时底层依旧保持结构化 runtime 行为。

## 低学习成本控制面

Linghun 同时支持自然语言输入和结构化 slash 命令。

普通开发请求可以进入模型；本地控制命令、诊断、模型设置、缓存状态、记忆审查、索引状态、权限状态、details、verification、job、workflow、plugin、skill、remote channel 等都通过可发现命令暴露。

natural command bridge 能把常见意图映射到安全本地动作；高风险动作会进入 Start Gate，而不是直接执行。这样既降低学习成本，又不牺牲高级控制能力。

## Provider 与 Endpoint 适配能力

Linghun 的 provider 层支持多种现代模型 API 形态。

它区分 OpenAI-compatible chat completions、OpenAI Responses、Anthropic Messages 和 DeepSeek 相关行为，处理 streaming、tool_use 组装、tool_result 转换、usage 上报、重试、timeout 分类、endpoint 诊断、prompt cache control、Anthropic tools 和 extended thinking。

这让 Linghun 能适应模型供应商持续变化。不同角色可以路由到不同 provider，而不需要重写 runtime。

## 验证作为 Runtime 边界

Linghun 不允许模型自己说“完成”就等于完成。

verification 是 runtime 状态和 transcript evidence 的一部分。验证命令可以产出报告、风险、未验证项、日志和 evidence record。cancelled、timeout、stale、partial、fallback、mock 等保守状态不会被静默升级成 PASS。

可靠编程智能体必须区分“模型认为完成了”和“runtime 有证据证明已验证”。Linghun 正在把这个边界做进底座。

## Details 与 Artifact 隔离

Linghun 让主屏保持人类可读，同时保留完整排查路径。

大输出、日志、provider 错误、工具结果、后台任务详情、evidence record 和报告通过 details / artifact 路径访问，而不是直接塞进主对话。这样主界面保持清爽，高级用户仍能追踪事实来源。

这在易用性和可审计性之间取得了更好的平衡。

## 受控自动学习与显式接受记忆

Linghun 的 memory 系统不是简单把聊天内容长期塞回 prompt，而是受控学习、候选优先、显式接受。

自动学习可以从 bounded evidence、Todo、verification、handoff 和用户输入中的稳定偏好/协作规则里提取候选。候选会经过 secret filter，避免密钥、token、凭据等敏感内容进入记忆系统。

记忆默认先成为 candidate，再由用户 review、accept、reject、disable、rollback 或 delete。candidate 不会自动注入 prompt；进入 prompt 的只有 accepted memory，并且受 topK、长度和成本守卫限制。

这避免了常见 agent 问题：自动学习噪声或敏感偏好，然后长期隐藏注入上下文。Linghun 让记忆有用，但不让记忆变成失控状态。

这个系统也为后续反思学习闭环打下基础：工具失败、验证失败、handoff 结论、用户纠正和项目习惯都可以先变成可审查候选，而不是直接污染长期上下文。

## 企业远程审批方向

Linghun 有面向企业远程控制的基础。

remote channel 覆盖 Feishu/Lark、WeCom/企业微信、DingTalk 等方向。runtime 包含 channel 状态、binding、trusted source、nonce/signature 校验、replay 防护、event type 和 redacted summary。

关键设计是：远程审批不会变成本地执行后门。它仍然连接到本地 permission 和 execution boundary。

## 有信任边界的扩展生态

Linghun 有本地 extension 模型，覆盖 skills、plugins、hooks、workflows 和 MCP servers。

扩展具备 manifest 加载、trust 状态、enable/disable 生命周期、doctor 视图、贡献摘要和保守执行边界。未知或未信任的外部能力不会被当成内置安全工具。

这给 Linghun 留出了生态空间，同时避免扩展默认获得无限权限。

## Provider Circuit Protection

Linghun 有 provider 冷却保护。

当 provider/model 出现可恢复失败时，runtime 可以进入 cooldown，避免反复请求同一个不稳定 endpoint。成功响应会清除 breaker，doctor / problems 入口也能解释当前冷却状态。

这能提升稳定性，也能减少无意义的失败请求和成本浪费。

## 模型配置与 Doctor 体验

Linghun 有面向真实用户的模型配置和诊断路径。

setup 流程把私密 provider 凭证保存在用户级 provider env 中，而不是项目配置里。doctor 输出可以解释 provider route、endpoint profile、tool support、reasoning 状态、prompt cache、API key 来源和 route 问题。

这降低了新用户上手成本，也给高级用户保留足够排查信息。

## 产品级组合优势

Linghun 最强的地方不是某一个单点，而是这些系统被放在同一个 runtime 里互相约束。

很多工具都有模型调用、文件编辑、终端访问或插件系统。Linghun 的差异在于，这些能力被统一放进 runtime governance：

- 模型负责推理。
- runtime 检查证据。
- 权限层控制动作。
- 索引提供代码事实。
- 缓存系统控制成本。
- runner 处理长任务。
- verifier 判断完成度。
- UI 降低学习成本。
- extension 和 remote 保持边界。

这就是 Linghun 作为下一代编程工具底座的核心优势。

## README 摘要

Linghun 是一个中英文友好、Windows 友好、证据优先的编程智能体 runtime。它把模型路由、受控工具执行、代码索引、prompt cache、架构检查、验证、长任务监督和扩展信任边界组合成一个产品底座。

它的目标不是让模型什么都能做，而是让模型在可靠的工程系统中发挥作用。
