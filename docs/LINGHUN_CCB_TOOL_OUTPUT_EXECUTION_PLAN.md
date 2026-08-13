# Linghun 工具调用与主页输出统一执行基线

## 文档定位

本文档是 Linghun 后续处理工具调用、SSE 解析、主页输出、Todo、缓存、上下文和压缩显示问题的唯一执行基线。

后续开发必须严格按照本文档的阶段顺序执行：

```text
阶段 0 -> 阶段 1 -> 阶段 2 -> 阶段 3 -> 阶段 4 -> 阶段 5 -> 阶段 6 -> 阶段 7
```

每个阶段必须完成：

1. 只修改本阶段范围内的内容。
2. 运行本阶段规定的最小验证。
3. 独立复检代码、调用链和工作区差异。
4. 明确记录已完成项、未完成项和阻塞项。
5. 通过本阶段验收后，才能进入下一阶段。

不得跳过阶段直接修改主页样式，也不得用隐藏文字的方式代替底层事件和生命周期修复。

## 总体目标

将 Linghun 当前多套工具调用和输出路径收敛为一条清晰链路：

```text
SSE / Provider
    -> 统一内部事件
    -> 统一工具生命周期
    -> 一个主页工具节点
    -> 一个结果摘要
    -> 完整内容进入详情层
```

目标行为参考 CCB，但必须复用 Linghun 现有的 Provider、权限、工具执行、会话、详情和持久化机制，不新增第二套平行机制。

## 参考源地址

以下路径是本执行基线的固定对照源。后续开发、复检和接力分析优先从这些入口沿调用链确认，不根据截图或历史结论猜测。

### CCB 参考源

- 主屏和底部布局：
  - `E:\ccb-source\src\screens\REPL.tsx`
  - `E:\ccb-source\src\components\FullscreenLayout.tsx`
- 工具调用和 Agent 进度：
  - `E:\ccb-source\packages\builtin-tools\src\tools\AgentTool\UI.tsx`
  - `E:\ccb-source\src\components\AgentProgressLine.tsx`
- 后台 Agent 状态、名称和选择：
  - `E:\ccb-source\src\components\CoordinatorAgentStatus.tsx`
  - `E:\ccb-source\src\components\tasks\BackgroundAgentSelector.tsx`
  - `E:\ccb-source\src\components\tasks\BackgroundTaskStatus.tsx`
- 智能体查看和返回主链：
  - `E:\ccb-source\src\state\teammateViewHelpers.ts`
  - `E:\ccb-source\src\hooks\useTeammateViewAutoExit.ts`
  - `E:\ccb-source\src\components\tasks\BackgroundTasksDialog.tsx`
  - `E:\ccb-source\src\screens\REPL.tsx`
- 子智能体结果回主链：
  - `E:\ccb-source\packages\builtin-tools\src\tools\AgentTool\agentToolUtils.ts`
  - `E:\ccb-source\packages\builtin-tools\src\tools\AgentTool\AgentTool.tsx`
  - `E:\ccb-source\src\utils\messages.ts`
  - `E:\ccb-source\src\tasks\LocalAgentTask\LocalAgentTask.tsx`
  - `E:\ccb-source\src\utils\swarm\inProcessRunner.ts`

### Linghun 对照源

- TUI 主布局、底部区域和输出视图：
  - `E:\Linghun\packages\tui\src\shell\components\ShellApp.tsx`
  - `E:\Linghun\packages\tui\src\shell\components\TaskBottomPane.tsx`
  - `E:\Linghun\packages\tui\src\shell\components\ScrollViewport.tsx`
  - `E:\Linghun\packages\tui\src\shell\components\AgentProgressTree.tsx`
- 工具生命周期和主页工具输出：
  - `E:\Linghun\packages\tui\src\model-tool-runtime.ts`
  - `E:\Linghun\packages\tui\src\model-stream-runtime.ts`
  - `E:\Linghun\packages\tui\src\tui-output-surface.ts`
  - `E:\Linghun\packages\tui\src\view-model.ts`
- Agent 创建、执行、完成和父会话关联：
  - `E:\Linghun\packages\tui\src\job-agent-command-runtime.ts`
  - `E:\Linghun\packages\tui\src\agent-completion-finalizer.ts`
  - `E:\Linghun\packages\tui\src\tui-data-types.ts`
- Agent 名称和主页进度树：
  - `E:\Linghun\packages\tui\src\job-runtime.ts`
  - `E:\Linghun\packages\tui\src\shell\progress-views.ts`
  - `E:\Linghun\packages\tui\src\shell\components\AgentProgressTree.tsx`
- Agent 详情和命令入口：
  - `E:\Linghun\packages\tui\src\model-loop-runtime.ts`
  - `E:\Linghun\packages\tui\src\job-agent-command-runtime.ts`

### 两条能力的固定对照结论

#### 智能体切换查看

CCB 使用 `viewingAgentTaskId` 进入具体智能体 transcript，支持从 `main` 切换到 Agent，再返回 `main`。Linghun 当前 `agent-tree-enter` 只设置 `expandedId` 展开详情，不等于切换到子智能体 transcript。

#### 子智能体结果回主链

CCB 同步 Agent 将最终文本作为 Agent tool result 返回主链；后台 Agent 通过 task notification 让主链继续处理。Linghun 已有父 session、`agent_end`、completion notice、system event 和 continuation 注入，但需要统一主页显示，避免多路重复输出。

## 当前问题边界

本执行基线覆盖以下问题：

- 同一工具调用出现多个“正在处理”或重复预览。
- 工具调用、进度、结果、证据和工程内部话术同时暴露在主页。
- 工具输出被过早截断，主页层级和代码背景不连续。
- 多个 Read/Grep 等调用无法按真实调用结构稳定分组。
- Edit、代码 diff 和结果区域无法保持连续的全宽背景。
- Todo 在任务完成后才显示，或被工具预览挤压。
- SSE 事件和工具结果在不同入口中解析不一致。
- 缓存、上下文、压缩状态更新不及时或作用域错误。
- 上下文用量没有严格按单终端、单对话显示。
- 智能体名称使用任务 slug、内部 ID 或工程标签，和 CCB 的 `Agent`、`@name`、自定义类型显示不一致。
- 智能体名称、任务描述、工具活动、耗时、上下文模式和内部元数据被拼成同一行，主页身份层级不清晰。
- 工具调用状态行被当成固定区域渲染，而 CCB 是根据运行、完成、失败、后台等状态条件显示。
- 新对话首条内容上方出现大块空白，短内容没有保持 CCB 式的自然顶部布局。
- 工具调用、智能体调用、后台任务和 Todo 的主页层级没有统一，导致状态互相挤压或重复。
- 主页只能展开智能体详情，不能像 CCB 一样进入对应智能体 transcript，再返回 `main`。
- 子智能体完成结果虽然已经回流父 session 和主链上下文，但完成摘要存在多路写入，未统一成一个主页结果节点。
- 取消、超时、重试和缺失结果可能产生重复或孤立的可见状态。

## 非目标

本阶段计划不包含：

- 更换 Provider。
- 增加新的工具协议。
- 增加新的持久化系统。
- 大范围重写 TUI。
- 无证据地调整内存或上下文窗口配置。
- 与本问题无关的业务逻辑、发布流程或依赖升级。

## 阶段 0：只读基线与问题复现

### 目标

建立 Linghun 与 CCB 的当前事实基线，不修改业务代码。

### 检查范围

- 所有 SSE 事件来源和解析入口。
- `start/progress/result/error` 工具调用链。
- 普通工具、Git、索引、延迟工具、后台 Bash、Agent 和 Pre-engine 路径。
- 主页、底部状态栏、详情页和 Ctrl+O 的输出来源。
- Todo、缓存、上下文、压缩状态的数据来源和更新入口。
- CCB 的工具编排、工具 ID 匹配、进度嵌套、分组和结果渲染。
- CCB 的智能体名称来源、显式名称、默认名称、类型名称和后台智能体名称显示。
- CCB 的工具调用行、Agent 调用行、后台状态行和详情展开之间的层级关系。
- CCB 的 `main -> agent transcript -> main` 查看切换和 retained transcript 生命周期。
- CCB 同步 Agent result、后台 task notification 和主链继续生成的结果回流路径。
- 新对话首屏、短输出、长输出、窄终端下的空白、缩进、连接符和背景覆盖。

### 必须产出

- Linghun 与 CCB 的调用链对照表。
- 主页输出来源清单。
- 每个已观察问题对应的直接代码位置。
- 现象、代码事实、运行验证和推断的区分记录。
- 可重复的最小复现样例。

### 验收门槛

- 未修改业务代码。
- 每个问题都有对应的代码入口或明确标记为“尚未运行验证”。
- 明确哪些输出来自主页、底部状态栏和详情层。
- 明确智能体名称是用户可见身份、任务描述还是内部追踪标签，禁止将三者混为一个字段。
- 明确主页固定区域和条件区域，记录哪些状态只在运行时出现、完成后消失或折叠。
- 明确 Linghun 当前是“详情展开”还是“真正 transcript 切换”，不得把 `expandedId` 当作 CCB 的查看能力。
- 明确子智能体完成结果的内部回流、主链上下文注入和主页可见输出是否各自独立，列出每个写入点。

## 阶段 1：统一 SSE 和内部事件模型

### 目标

确保同一个流式事件只被统一解析一次，并且每个工具调用具有稳定的作用域和 ID。

### 工作内容

- 统一 SSE 事件名称、字段和解析入口。
- 为模型请求、工具调用和工具结果确认稳定的 `requestId`、turn 标识和 `toolUseId`。
- 明确区分以下事件：
  - assistant 文本；
  - tool start；
  - tool progress；
  - tool result；
  - todo 更新；
  - cache/context usage；
  - compression；
  - error/timeout；
  - cancel/retry。
- 所有 Provider 最终转换为同一种 Linghun 内部事件。
- 保证一个 `toolUseId` 只有一个开始事件和一个最终结果。
- 取消、超时、重试和缺失结果时补齐内部结果，但不得重复生成主页显示事件。
- 确保工具调用、Agent 调用、后台任务和 Todo 更新都能关联到同一个 turn/request 作用域。
- 确保 cache/context usage 和 compression 事件不会被当作普通工具进度渲染到主页。

### 暂不处理

- 不调整主页颜色、边框和符号。
- 不改变工具实际执行权限。
- 不改变 Provider 对外协议。

### 验收门槛

- Provider 适配层测试通过。
- 正常、异常、取消、超时、重试和缺失结果都有明确事件序列。
- 同一 `toolUseId` 不产生重复 start/result。
- SSE 事件解析不再由多个主页输出入口分别解释。

## 阶段 2：统一工具调用生命周期和执行入口

### 目标

将不同工具路径映射到同一套可观察生命周期：

```text
tool start -> progress -> result/error
```

### 工作内容

- 普通工具、Git、索引、延迟工具、后台 Bash、Agent 和 Pre-engine 都使用统一生命周期语义。
- `requestActivity` 只作为底部运行状态，不再额外创建主页工具块。
- 工具进度更新已有工具节点，不重复创建“正在处理”。
- 工具完成后只保留一个最终结果节点。
- Agent 调用使用与普通工具不同但可关联的生命周期，不把 Agent 名称误当成工具名称。
- 后台 Agent 的启动、运行、完成和失败状态必须有唯一的状态转换。
- Agent 完成结果必须形成单一的内部 completion 事实，后续分别供主链上下文、主页摘要和详情使用。
- 父 session、`agent_end`、completion notice、system event 和 continuation 注入必须使用同一个 Agent/turn 关联关系。
- 保留现有权限、取消、超时和 stale request 保护。
- 对照 CCB 检查只读工具并发、修改工具串行和并发上限行为。
- 检查所有绕过普通 `runTool` 的路径是否仍然完整产生统一事件。

### 验收门槛

- 一次普通工具调用只对应一个可见生命周期。
- 运行中、完成、失败、取消、超时都能得到唯一最终状态。
- 不再出现同一次调用产生多个独立“正在处理”块。
- 工具执行行为没有因为显示层修复而被改变。

## 阶段 3：重做主页输出层级

### 目标

让主页采用 CCB 类似的结构：一个工具调用节点，内部更新进度并承载结果摘要。

### 目标布局

```text
● Read(path)
  ⎿ 结果摘要
```

```text
● Bash(command)
  ⎿ 最后几行结果
```

### 工作内容

- 工具运行、进度和结果挂在同一个调用节点。
- 去掉通用的独立带边框“正在处理”块。
- `requestActivity` 仅保留在底部状态区域。
- 主页不显示内部工程推理、执行计划、证据整理和调试话术。
- 智能体名称按 CCB 方式分层显示：
  - 有显式名称时显示短名称或 `@name`；
  - 无显式名称时显示 `Agent` 或用户可见的短类型名；
  - `displayName` 生成的任务 slug 只作为备用标签，不覆盖用户指定名称；
  - 不回退显示原始 agent ID、parent/fork/session ID 或其他内部标识。
- 智能体名称、任务描述、当前活动和耗时分开渲染，不拼成一个工程状态串。
- `team:*`、`完整上下文`、`交接摘要`、mailbox、token 等字段默认进入详情层，不作为主页主身份。
- 工具调用名称使用工具自己的用户可见名称；Agent 名称使用 Agent 身份名称，二者不得合并成一个标签。
- 工具状态、Agent 状态和后台任务状态区域按状态条件出现，不渲染永久空的固定块。
- 新对话和短输出从自然顶部开始，不能因为底部粘滞布局在首屏制造大块空白。
- 智能体节点支持进入对应 transcript 查看，查看时主页显示该智能体内容，并能通过 `main` 或返回操作回到主链。
- 智能体切换时只切换查看对象，不改变父子会话关系、执行权限和正在运行的生命周期。
- 子智能体完成后主页只显示一个简短完成摘要节点；完整报告、证据和内部 completion 字段进入详情或主链内部上下文。
- `完整内容已收起`、证据路径、原始日志和详细诊断进入详情层或 Ctrl+O。
- 工具失败在主页只显示简短、可操作的错误摘要，完整错误保留到详情。
- 执行和清洗期间保持底层静默，完成后再显示最终摘要。

### 验收门槛

- 一次工具调用在主页最多有一个主节点。
- 进度不会与 Todo、底部状态和工具结果互相重复。
- 主页不再暴露内部工程话术。
- 智能体名称短、稳定、可读，和任务描述、状态、工具调用清晰分层。
- 无运行状态时不保留空的工具/Agent 状态块。
- 新对话首屏没有由布局粘滞策略造成的异常顶部空白。
- 详情层仍能查看完整工具结果和错误信息。
- 点击或键盘选择 Agent 后能进入对应 transcript；切换到另一个 Agent 和返回 `main` 都不会丢失消息。
- 子智能体完成后，主链能够继续使用其摘要和证据上下文，主页不会重复出现多份 completion 文本。

## 阶段 4：工具分组和代码输出连续性

### 目标

解决多个工具调用、代码块和 diff 输出的分组、符号和背景不连续问题。

### 工作内容

- 分组依据改为结构化调用信息：
  - `requestId`；
  - API turn；
  - `toolUseId`；
  - tool name；
  - 工具结果 ID。
- 不再以已经渲染后的自然语言作为主要分组依据。
- 同一轮连续的 Read/Grep 调用可以合并显示。
- Read、Grep、Edit、Bash 混合调用不能误合并。
- 工具结果和代码内容使用连续的全宽背景区域。
- diff 行号、增删背景和代码内容保持在同一个输出区域。
- 普通文本、工具调用和工具结果使用固定缩进和连接符。
- 工具调用和 Agent 调用使用各自稳定的符号层级，但共享同一套连续树形布局。
- 连接符、缩进、状态符号和折叠提示在连续输出中保持一致，不出现孤立的 `正在处理` 行。
- 多个 Agent 的名称、工具活动和完成结果按 Agent ID/turn 结构分组，不把不同子链的结果合并。
- 主页只保留摘要，详情层保留完整代码和完整 diff。

### 验收门槛

- 多个 Read/Grep 调用能够稳定分组。
- 不同工具、不同请求和不同 turn 不会错误合并。
- 代码、diff、行号和背景区域连续。
- 终端窄宽度下没有文字覆盖或层级错位。
- 代码内容、diff 行号、增删背景和结果摘要使用连续的全宽背景，不被局部容器截断。
- 新对话首条输出、短结果和长结果的顶部起始位置稳定，没有异常空白带。

## 阶段 5：Todo 与底部状态栏

### 目标

让 Todo 在任务执行过程中立即显示，并且不与工具预览竞争同一显示位置。

### 工作内容

- Todo 创建或更新时立即刷新当前任务区。
- `in_progress` 在任务运行中实时显示。
- `completed`、`blocked` 和失败状态原地更新。
- 工具进度不重复追加 Todo 文本。
- Todo 与工具调用使用独立的显示层级。
- 底部状态栏只显示当前请求的简短状态。
- 底部工具/Agent 运行状态只在存在对应活动时显示；完成、失败、取消后按状态折叠或替换，不保留无效固定行。
- Todo 是独立任务状态，不被工具预览、Agent 预览或通用 `requestActivity` 覆盖。
- Agent 选择区支持 `main`、各个 Agent 和返回主链；选择区不是只读详情列表。
- 完整 Todo 列表进入详情层，主页显示当前任务和简要进度。

### 状态优先级

```text
当前工具运行状态
    >
当前 Todo 状态
    >
提交请求状态
```

### 验收门槛

- Todo 在任务开始和任务更新时即可看到。
- Todo 不会等到任务完成后才首次出现。
- 工具预览不会覆盖或挤走当前 Todo。
- 多个终端和多个对话的 Todo 不互相串线。
- 任务执行中显示 `in_progress` Todo 时，不会被重复的“正在处理”预览遮挡。
- 没有活动工具或活动 Agent 时，底部不显示空的运行占位块。

## 阶段 6：缓存、上下文和压缩显示

### 目标

确认缓存、上下文和压缩数据的真实来源、作用域和更新时间，避免把统计错误误判为内存不足。

### 工作内容

- 分别统计：
  - 当前对话上下文用量；
  - 当前终端/会话上下文用量；
  - prompt cache 命中；
  - completion/cache usage；
  - 压缩前用量；
  - 压缩后用量；
  - 压缩触发原因。
- 上下文用量严格按“单终端、单对话”显示。
- 缓存显示绑定当前请求或当前会话，不能混入其他终端。
- 中途收到有效 usage 时及时刷新，不只在请求结束时更新。
- 压缩开始、压缩完成和压缩后的新基线明确区分。
- 检查压缩后是否仍使用旧 token 基线。
- 检查 cache 命中下降是统计错误、压缩行为还是实际缓存失效。
- 检查底部状态栏是否被旧请求覆盖。
- 检查 cache 命中、上下文用量和压缩状态是否按单终端、单对话隔离，而不是使用全局或历史聚合值。
- 检查压缩后的上下文窗口显示层级，明确区分“压缩中”“压缩完成”“新基线”和普通缓存刷新。
- 检查缓存命中下降是否由压缩重建、usage 延迟、作用域错误或真实 cache miss 导致。

### 暂不处理

- 在没有运行证据前，不调整内存配置。
- 不扩大上下文窗口。
- 不增加新的缓存系统。

### 验收门槛

- 当前上下文用量与当前终端、当前对话一致。
- 请求进行中和请求结束后显示均能更新。
- 压缩前后数值和状态可解释。
- 缓存命中下降能区分真实变化和显示错误。

## 阶段 7：异常和回归验证

### 目标

对完整工具调用和主页输出链路进行最终回归，确保修复没有只覆盖正常路径。

### 必须验证

- 工具正常完成。
- 工具失败。
- 权限拒绝。
- 用户取消。
- Bash 超时。
- SSE 中断。
- Provider 重试。
- 缺失 `tool_result`。
- 多个 Read/Grep 并发。
- Read + Edit + Bash 混合调用。
- Todo 在执行中更新。
- 上下文压缩前后。
- 多终端、多对话同时运行。
- 多个 Agent 之间切换查看、从 Agent 返回 `main`、查看已完成 Agent transcript。
- Agent 完成后主页只生成一个摘要节点，并确认主链下一轮能收到该结果。
- 同时存在 `agent_end`、completion notice、system event 和 continuation 注入时，不出现重复主页输出。
- 智能体无显式名称、显式名称、自定义类型、`worker` 类型和多个 Agent 并发。
- Agent 运行中、后台运行、完成、失败、取消和详情展开。
- 工具调用与 Agent 调用混合，确认名称、工具状态和 Todo 不串层。
- 新建对话后的第一条短消息，确认首屏没有异常空白。
- 执行/清洗期间、工具完成后和详情展开后的静默边界。
- 详情页是否保留完整日志。
- 主页是否不再暴露内部工程话术。
- Agent transcript 是否可进入、可切换、可返回主链。
- 子智能体完成结果是否能回到主链并驱动主链继续输出。
- 工具结果、代码背景和符号布局是否连续。

### 验收门槛

- 相关测试、typecheck、build 或项目已有验证命令通过。
- 关键场景完成真实运行验证，而不是只依赖静态检查。
- 主页、底部状态栏和详情层的职责边界清晰。
- 没有重复工具节点、孤立结果或错误作用域的上下文统计。
- 工作区差异只包含本阶段允许的文件。

## 后续开发纪律

- 每次开发开始前，先声明当前阶段和对应目标。
- 当前阶段未通过前，不进入下一阶段。
- 发现邻近问题时单独记录，不混入当前阶段。
- 不以 CSS、截断或隐藏文本掩盖事件链路问题。
- 不新增第二套工具协议、事件模型或状态系统。
- 不根据截图猜测根因，必须回到源码、事件记录和运行结果验证。
- 所有修改必须能回溯到本文档中的阶段、工作内容和验收门槛。
