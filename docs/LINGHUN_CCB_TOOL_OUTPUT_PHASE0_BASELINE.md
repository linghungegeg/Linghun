# Linghun CCB Tool Output Phase 0 Baseline

## 阶段

- 当前阶段：阶段 0，只读基线与问题复现。
- 本阶段边界：不修改业务代码，不修主页样式，不改 Provider、权限、工具执行或持久化机制。
- 本文用途：记录 Linghun 与 CCB 当前源码事实、直接代码位置、待运行验证项和最小复现样例，作为阶段 1 前置输入。

## 验证状态

- 已执行：源码只读搜索与关键文件定点读取。
- 已执行：Linghun 与 CCB 参考源静态对照。
- 未执行：真实 TUI 交互运行验证、截图验证、窄终端视觉验证。
- 当前结论类型：除明确标注为“推断”或“尚未运行验证”的条目外，均来自源码静态事实。

## Linghun 调用链对照表

| 能力 | Linghun 当前入口 | 当前事件/状态 | 直接代码位置 | 阶段 0 结论 |
|---|---|---|---|---|
| Provider 统一事件类型 | `packages/providers/src/index.ts` | `LinghunEvent` 包含 `assistant_text_delta`、`assistant_thinking_delta`、`tool_use`、`tool_result`、`usage`、`message_stop`、`error` | `packages/providers/src/index.ts:44` | Provider 包已有一层统一事件类型，但缺少 request/turn 作用域字段。 |
| Anthropic SSE 解析 | `parseAnthropicMessagesStream` / `parseAnthropicMessagesEventBlock` | SSE block -> `LinghunEvent` | `packages/providers/src/index.ts:2780`, `packages/providers/src/index.ts:2920` | Anthropic tool input 按 `content_block_start/delta/stop` 累积，`content_block_stop` 时只 emit 一个 `tool_use`。 |
| OpenAI chat SSE 解析 | shared OpenAI parser 分支 | `choice.delta.content` -> `assistant_text_delta`，`delta.tool_calls` -> `tool_use` | `packages/providers/src/index.ts:3342`, `packages/providers/src/index.ts:3561` | OpenAI tool call 在参数 JSON 完整时 emit `tool_use`，依赖 index 追踪 pending 调用。 |
| Responses SSE 解析 | `parseResponsesEvent` | `response.output_text.delta`、`response.output_item.done(function_call)` | `packages/providers/src/index.ts:3378` | Responses endpoint 单独转换为同一种 `LinghunEvent`。 |
| TUI 模型流消费 | `model-stream-runtime.ts` | `event.type` 分支处理 assistant/tool/usage/error | `packages/tui/src/model-stream-runtime.ts:7657` | TUI 侧再次按 `LinghunEvent.type` 解释事件，并在 `tool_use` 时启动工具执行。 |
| 无工具最终回答 | `streamFinalModelAnswerWithoutTools` 分支 | 忽略 `tool_use` 并记录 warning | `packages/tui/src/model-stream-runtime.ts:6920` | final no-tools 路径收到 `tool_use` 会写 system warning，不执行工具。 |
| 工具执行入口 | `executeModelToolUse` | 按工具名分派 deferred/pre-engine/git/index/control/built-in | `packages/tui/src/model-tool-runtime.ts:397` | 多条工具路径已存在，阶段 1 需要确认它们是否都映射到同一内部事件模型。 |
| 普通工具 start | `executeModelToolUse` | `tool_call_start` transcript event | `packages/tui/src/model-tool-runtime.ts:878` | 普通工具会写 transcript start。 |
| 普通工具 end/result | `createToolEndEvent`、`appendToolResultEvent` | `tool_call_end`、`tool_result` | `packages/tui/src/model-tool-runtime.ts:985`, `packages/tui/src/model-tool-runtime.ts:1070`, `packages/tui/src/evidence-runtime.ts:1164`, `packages/tui/src/evidence-runtime.ts:1415` | 工具结束事实和回灌给模型的 result 是两条相关但不同事件。 |
| 工具 progress | `installToolProgressHandler` | 更新 `requestActivity*`，并可能写 `writeToolRunningBlock` | `packages/tui/src/model-tool-runtime.ts:4440`, `packages/tui/src/model-tool-runtime.ts:4523` | progress 同时影响底部活动和主页 running block，是重复可见状态的直接入口之一。 |
| Git 工具 | `executeGitToolUse` | 独立分派 | `packages/tui/src/model-tool-runtime.ts:413` | Git 绕过 built-in `runTool`，但仍需检查是否完整产生 start/result。 |
| Index 工具 | `executeIndexToolUse` | 独立分派 | `packages/tui/src/model-tool-runtime.ts:448` | Index 同样是绕过路径。 |
| Agent/Workflow 控制工具 | `executeLinghunControlToolUse` | Agent/workflow/start/control/send 等 | `packages/tui/src/model-tool-runtime.ts:451` | Agent 调用不是普通工具名称显示问题，需要单独身份层级。 |
| Agent start | `/fork` / job agent | `agent_start` 写父 session，子 transcript 单独 session | `packages/tui/src/job-agent-command-runtime.ts:2700`, `packages/tui/src/job-agent-command-runtime.ts:2666` | Linghun 已有 parent session 和 child transcript session。 |
| Agent end | `completeAgent` / failure path | `agent_end` 写父 session | `packages/tui/src/job-agent-command-runtime.ts:2877`, `packages/tui/src/job-agent-command-runtime.ts:2943`, `packages/tui/src/job-agent-command-runtime.ts:4728` | Agent 结束事实存在多个写入点。 |
| Agent completion notice | `agent-completion-finalizer.ts` | notice、system event、main-chain context label | `packages/tui/src/agent-completion-finalizer.ts:21`, `packages/tui/src/agent-completion-finalizer.ts:182`, `packages/tui/src/agent-completion-finalizer.ts:367` | 子智能体结果回流存在独立 notice/system 写入，需要阶段 2/3 合并可见摘要。 |
| Todo | `context.tools.todos` -> `buildTaskListView` | 底部 TaskListView | `packages/tui/src/shell/progress-views.ts:113`, `packages/tui/src/shell/components/TaskBottomPane.tsx:220` | Todo 来源是工具状态，不是 Provider SSE 事件。 |
| Cache/context usage | Provider `usage` -> cache state -> footer | `usage` event、`context.cache.contextUsage`、TaskFooter | `packages/tui/src/model-stream-runtime.ts:1128`, `packages/tui/src/model-stream-runtime.ts:1215`, `packages/tui/src/shell/view-model.ts:2615` | usage/cache/context 是 footer 数据，不应被当工具 progress。 |
| Compression | request activity phase / compact boundary block | `compacting_context`、`compact_boundary` | `packages/tui/src/model-stream-runtime.ts:4098`, `packages/tui/src/shell/view-model.ts:1418`, `packages/tui/src/shell/view-model.ts:1524` | compression 既可能进入底部 activity，也可能作为 compact boundary block 出现。 |

## CCB 对照表

| 能力 | CCB 入口 | 直接代码位置 | 对照结论 |
|---|---|---|---|
| 工具调用 UI 分组 | `AgentTool/UI.tsx` | `E:\ccb-source\packages\builtin-tools\src\tools\AgentTool\UI.tsx:53`, `E:\ccb-source\packages\builtin-tools\src\tools\AgentTool\UI.tsx:745` | CCB 使用 `tool_use` / `tool_result` 映射和 grouped render，不依赖渲染后的自然语言做主分组。 |
| in-progress tool IDs | REPL / AgentTool UI | `E:\ccb-source\src\screens\REPL.tsx:1685`, `E:\ccb-source\packages\builtin-tools\src\tools\AgentTool\UI.tsx:242` | CCB 显式维护 in-progress toolUseId 集合。 |
| Agent result 回主链 | AgentTool / agentToolUtils | `E:\ccb-source\packages\builtin-tools\src\tools\AgentTool\AgentTool.tsx:1501`, `E:\ccb-source\packages\builtin-tools\src\tools\AgentTool\AgentTool.tsx:1570`, `E:\ccb-source\packages\builtin-tools\src\tools\AgentTool\agentToolUtils.ts:636` | 同步 Agent 最终结果回到 parent tool_result；后台路径发 notification。 |
| Agent notification | LocalAgentTask | `E:\ccb-source\src\tasks\LocalAgentTask\LocalAgentTask.tsx:242`, `E:\ccb-source\src\tasks\LocalAgentTask\LocalAgentTask.tsx:465` | 后台 Agent 完成通过 task notification 回主链。 |
| main -> agent transcript -> main | teammate view helpers / REPL | `E:\ccb-source\src\state\teammateViewHelpers.ts:46`, `E:\ccb-source\src\state\teammateViewHelpers.ts:88`, `E:\ccb-source\src\screens\REPL.tsx:898`, `E:\ccb-source\src\screens\REPL.tsx:5392` | CCB 使用 `viewingAgentTaskId` 切换被查看 transcript。 |
| 后台 Agent 选择区 | `BackgroundAgentSelector` | `E:\ccb-source\src\components\tasks\BackgroundAgentSelector.tsx:35` | CCB 有单独的后台 Agent 选择入口。 |

## 主页输出来源清单

| 层级 | Linghun 来源 | 直接代码位置 | 说明 |
|---|---|---|---|
| 主页 transcript block | `ShellBlockOutput._write` | `packages/tui/src/tui-output-surface.ts:148` | 普通 `writeLine` 进入主页 block。 |
| 主页 assistant streaming | `beginAssistantStream` / `writeAssistantDelta` / `endAssistantStream` | `packages/tui/src/tui-output-surface.ts:1483`, `packages/tui/src/tui-output-surface.ts:1494` | assistant delta 聚合为 streaming block。 |
| 主页工具结果 | `writeStructuredToolOutput` | `packages/tui/src/tui-output-surface.ts:194`, `packages/tui/src/tui-output-surface.ts:1607` | structured result upsert 到 tool block id。 |
| 主页工具运行块 | `writeToolRunningBlock` | `packages/tui/src/tui-output-surface.ts:239`, `packages/tui/src/tui-output-surface.ts:1628` | 生成 `正在处理` / running block，id 为 `tool:<name>:<toolUseId>`。 |
| 底部状态栏 | `mapRequestActivityToView` / TaskBottomPane | `packages/tui/src/shell/view-model.ts:1513`, `packages/tui/src/shell/components/TaskBottomPane.tsx:377` | `requestActivityPhase` 映射底部当前请求/工具状态。 |
| 底部 Todo | `buildTaskListView` / `TaskListView` | `packages/tui/src/shell/progress-views.ts:113`, `packages/tui/src/shell/components/TaskBottomPane.tsx:220` | Todo 独立于工具 block，但会竞争底部空间。 |
| Agent 进度树 | `buildAgentProgressTreeView` / `AgentProgressTree` | `packages/tui/src/shell/progress-views.ts:45`, `packages/tui/src/shell/components/AgentProgressTree.tsx:48` | 当前 `expandedId` 是详情展开，不是 transcript 切换。 |
| 详情层 / Ctrl+O | `fullText` / `ctrlOCollapsed` / transcript source | `packages/tui/src/tui-output-surface.ts:215`, `packages/tui/src/shell/view-model.ts:236` | 完整工具输出通过 block fullText/details 保留。 |
| cache/context footer | `buildTaskFooterView` | `packages/tui/src/shell/view-model.ts:547`, `packages/tui/src/shell/components/TaskBottomPane.tsx:452` | cache/context 属于 footer，不应进入主页工具进度。 |

## 已观察问题到代码位置

| 问题 | 代码事实 | 直接位置 | 运行验证 |
|---|---|---|---|
| 同一工具可能有多个可见“正在处理”入口 | 工具 start 写 `tool_call_start`；progress 可写 `writeToolRunningBlock`；底部也由 `requestActivityPhase=tool_running` 显示当前工具 | `packages/tui/src/model-tool-runtime.ts:878`, `packages/tui/src/model-tool-runtime.ts:4523`, `packages/tui/src/shell/view-model.ts:1513` | 尚未运行验证。 |
| 工具结果和 running block 是两个显示写入口 | running 由 `writeToolRunningBlock`，结果由 `writeStructuredToolOutput` upsert | `packages/tui/src/tui-output-surface.ts:239`, `packages/tui/src/tui-output-surface.ts:194` | 尚未运行验证。 |
| `requestActivity` 可能被误认为主页工具节点 | view-model 将 `requestActivityPhase` 映射为 TaskActivityView，ShellApp 对 `tool_running` 渲染工具头 | `packages/tui/src/shell/view-model.ts:1513`, `packages/tui/src/shell/components/ShellApp.tsx:497` | 尚未运行验证。 |
| Agent 名称可能回退内部 ID | Agent progress row name 使用 `displayName ?? addressableName ?? id` | `packages/tui/src/shell/progress-views.ts:91` | 尚未运行验证。 |
| Agent 主页详情混入 parent/session/context 字段 | detail text 包含 `parentSessionId`、context mode、mailbox、tokens 等 | `packages/tui/src/shell/components/AgentProgressTree.tsx:146`, `packages/tui/src/shell/components/AgentProgressTree.tsx:153` | 尚未运行验证。 |
| Linghun 当前不是 CCB 式 transcript 切换 | `agent-tree-enter` 只切换 `expandedId` | `packages/tui/src/index.ts:3982`, `packages/tui/src/index.ts:3990` | 源码事实；真实键盘行为尚未运行验证。 |
| 子智能体 completion 多写入点 | `agent_end`、completion notice、system event、main-chain injected notice 均存在 | `packages/tui/src/job-agent-command-runtime.ts:2877`, `packages/tui/src/agent-completion-finalizer.ts:182`, `packages/tui/src/agent-completion-finalizer.ts:367` | 尚未运行验证。 |
| Todo 与工具活动分属不同层但竞争底部空间 | TaskBottomPane 对 agent/task/status/footer 做行数分配 | `packages/tui/src/shell/components/TaskBottomPane.tsx:116`, `packages/tui/src/shell/components/TaskBottomPane.tsx:220` | 尚未运行验证。 |
| cache/context/compression 不属于普通工具 progress | usage 写 cache/context；compression 走 `compacting_context` 和 compact boundary | `packages/tui/src/model-stream-runtime.ts:1215`, `packages/tui/src/shell/view-model.ts:1418`, `packages/tui/src/shell/view-model.ts:2615` | 尚未运行验证。 |

## 事件序列事实

### 正常普通工具

源码事实：

```text
Provider SSE
  -> LinghunEvent.tool_use(id, name, input)
  -> model-stream-runtime pending toolCalls
  -> executeToolCallsWithReadonlyParallelism
  -> executeModelToolUse
  -> transcript tool_call_start
  -> runTool / specific dispatch path
  -> tool_call_end
  -> tool_result
  -> structured output / model continuation
```

待核验：

- 同一 `toolUseId` 在主页是否只出现一个主节点。
- progress 更新是否只更新已有节点，而不是新建多个 running block。

### 工具拒绝

源码事实：

```text
tool_use
  -> decidePermission
  -> permission_request / permission_result
  -> pending approval or denial result
  -> appendToolResultEvent(isError=true) when denied
```

待核验：

- ask 路径是否只显示 PermissionPanel。
- deny 路径是否只形成一个失败摘要。

### 取消 / stale

源码事实：

```text
requestOwner signal/currentRequestTurnId mismatch
  -> staleResult/dropStaleToolResult
  -> background task may be marked cancelled/stale
  -> stale_tool_result_dropped system event
```

直接位置：`packages/tui/src/model-tool-runtime.ts:920`。

待核验：

- stale result 是否不会留下孤立 running block。

### Provider error / retry

源码事实：

```text
LinghunEvent.error
  -> recordProviderFailureEvidence
  -> fallback or terminal provider error
  -> requestActivity provider_retrying/provider_switching/provider_recovering
```

直接位置：`packages/tui/src/model-stream-runtime.ts:7759`、`packages/tui/src/model-stream-runtime.ts:1313`。

待核验：

- retry attempt reset 是否清理旧 assistant/tool 可见状态。

### 缺失 tool_result

源码事实：

- Provider request builder 对历史消息中未配对 assistant tool_use 会合成 is_error tool_result。
- 这是发往 provider 前的历史修正，不是主页工具结果显示。

直接位置：`packages/providers/src/index.ts:1973`、`packages/providers/src/index.ts:2056`。

待核验：

- 合成 tool_result 是否不会生成主页重复工具节点。

## 最小复现样例

以下样例是阶段 0 可重复复现设计，尚未执行真实 TUI 验证。

1. 普通只读工具进度重复

```text
请读取 README.md，然后 grep package 名称。
```

观察点：

- 主页是否出现多个“正在处理”块。
- 底部工具状态是否和主页工具块重复表达同一事实。
- Ctrl+O 是否保留完整 Read/Grep 输出。

2. Bash progress 与结果

```text
运行一个会持续输出 5 行的只读 Bash 命令，然后总结最后两行。
```

观察点：

- `writeToolRunningBlock` 是否随 progress 多次 upsert。
- 完成后是否只保留一个 Bash 结果摘要。

3. 权限拒绝

```text
尝试修改一个临时文件，但在权限确认时拒绝。
```

观察点：

- PermissionPanel、主页失败摘要、tool_result 是否只出现一组。

4. Agent 查看

```text
启动一个后台 agent，让它读取一个文件并完成，然后用 agent-tree-enter 查看。
```

观察点：

- 当前 Linghun 是否只是展开详情。
- 是否能真正进入子 agent transcript，再返回 main。

5. 子智能体完成回流

```text
启动一个 worker agent 完成一个只读分析任务，并让主链继续基于结果输出。
```

观察点：

- `agent_end`、completion notice、system event、continuation 注入是否导致主页重复摘要。
- 主链下一轮是否能收到摘要和证据上下文。

6. Todo 更新

```text
先创建 3 个 Todo，然后执行第 1 个并标记完成。
```

观察点：

- Todo 是否在执行中可见。
- Todo 是否被工具 running block 或 requestActivity 挤掉。

7. context/cache/compression

```text
在长上下文会话中触发压缩，再继续一次带工具的请求。
```

观察点：

- `compacting_context` 是否只作为底部/压缩状态，不作为普通工具 progress。
- cache/context 数值是否按当前 session 显示。

## 当前阶段未完成项

- 未运行真实 TUI 交互复现。
- 未验证窄终端、长输出、短输出、新对话首屏布局。
- 未验证多终端、多对话隔离。
- 未验证取消、超时、retry、SSE 中断的运行序列。

## 阶段 1 前置结论

- Provider 层已有 `LinghunEvent`，但事件缺少统一 `requestId`、turn 标识和工具可见生命周期归一化边界。
- TUI 层目前对同一事实存在 transcript event、requestActivity、structured output、running block、Agent progress、TaskBottomPane 等多个解释/显示入口。
- 阶段 1 应优先收敛事件作用域和 ID 事实，不应先改主页样式。
- 阶段 1 不应引入第二套 Provider 协议或工具协议；应复用现有 `LinghunEvent`、transcript event、`toolUseId`、`currentRequestTurnId` 和已有 store 机制。

