---
title: Linghun 与 CCB 成熟度/过度设计/无效文字补丁对比报告
status: baseline-for-remediation
date: 2026-05-18
scope: read-only audit; no source-code changes
---

# Linghun 与 `F:\ccb-source` 成熟度/过度设计/无效文字补丁对比报告

> 本报告作为后续 Linghun 底层优化、修复、验收的基准文档。后续修复完成后的目标不是“文档上接近 CCB”，而是实际用户手感、运行稳定性、权限安全、工具链闭环、诊断能力和可维护性至少达到 CCB 当前成熟水平；在中文开发体验、DeepSeek/OpenAI-compatible 适配、轻量本地化场景中应做到强于 CCB。

## 0. 结论摘要

### 0.1 总体判断

Linghun 当前不是一个“空壳项目”，也不是早期审计中描述的“完全没有真实 tool_use/tool_result 闭环”的状态。当前代码中已经存在真实的：

- provider/model 路由；
- OpenAI-compatible / DeepSeek streaming；
- 模型 `tool_use` 解析；
- 工具执行；
- `tool_result` 回灌；
- default 权限模式下对 Bash/写入类工具的静默阻断；
- Natural Command Bridge；
- 状态行、缓存、索引、会话、memory、agent、verification 等多阶段能力的最小实现。

但是，从与 `F:\ccb-source` 的源码级对比看，Linghun 的成熟度仍明显落后于 CCB。差距主要不是“有没有功能名”，而是以下五类问题：

1. **产品能力被压缩在一个巨大 TUI 文件中**：`packages/tui/src/index.ts` 约 7817 行，承载 slash command、model loop、tool execution、permission、status、cache、MCP、agent、workflow、verification、NCB 等大量职责。这说明 Linghun 的功能多，但工程结构尚未成熟。
2. **工具系统有真实闭环，但抽象深度远低于 CCB**：Linghun 工具接口是简单 `call()` + metadata；CCB 的 `Tool` 契约包含 schema、permission、progress、render、grouping、truncation、interrupt、open-world、安全分类、上下文状态等完整产品级生命周期。
3. **权限系统有安全边界，但交互成熟度不足**：Linghun 已能阻止 default 模式静默执行高风险工具，但缺少 CCB 那种可选项、反馈、Tab 修改、Esc 取消、规则落盘、headless fallback、hook 决策、自动分类、拒绝原因治理等成熟机制。
4. **文档/阶段交付报告相对运行时代码过重**：Linghun 有大量阶段文档、审计文档、closure 文档，且多次出现“已闭环/已修复/已 hardening”的文字结论；但源码结构仍集中，TUI/权限/输出/诊断等用户手感仍未达到 CCB。这是“文字补丁风险”的核心。
5. **CCB 的成熟度来自长期产品化细节，不只是功能列表**：状态行、缓存命中、上下文窗口、成本、rate limit、index health、工具结果展示、权限交互、命令注册、session storage、hooks、MCP、插件/技能/工作流等均有更细的运行路径和 UI/UX 支撑。

### 0.2 最重要的基准结论

后续优化不能再以“阶段文档写了闭环”“测试证明某条路径 PASS”“命令名存在”为完成标准。必须改用以下验收标准：

- 用户在真实 TUI 中连续完成一个中等复杂代码任务，Linghun 的**默认手感**接近 CCB；
- 模型能稳定完成多轮 `tool_use → permission → tool_result → continuation`，而不是只在单个 smoke case 中通过；
- 工具输出不刷屏、不丢证据、可展开、可追溯；
- 权限提示可交互、可拒绝、可修改、可解释、可复用；
- 状态行能帮助用户判断模型、上下文、成本、缓存、索引、后台任务和 gate，而不是只显示简短字段；
- 命令系统有可维护 registry，不再靠超长 if/else 和散落文案维持；
- 每个“已完成”必须有源码支撑、交互路径、回归测试和真实 TUI smoke 证据。

---

## 1. 对比范围与依据

### 1.1 本次对比对象

- Linghun 当前仓库：`F:\Linghun`
- CCB 参考仓库：`F:\ccb-source`

### 1.2 本次读取/确认过的 Linghun 关键依据

- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `docs/delivery/README.md`
- `packages/tui/src/index.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tools/src/index.ts`
- `packages/providers/src/index.ts`
- 已有 Phase 15 / pre-Beta / deep parity / real TUI smoke audit 文档摘要

### 1.3 本次读取/确认过的 CCB 关键依据

- `F:\ccb-source\docs\ccb-optimizations.md`
- `F:\ccb-source\src\Tool.ts`
- `F:\ccb-source\src\components\permissions\PermissionPrompt.tsx`
- `F:\ccb-source\src\components\StatusLine.tsx`
- `F:\ccb-source\src\commands.ts`
- `F:\ccb-source\src\utils\permissions\permissions.ts`

### 1.4 索引状态

- `F-Linghun`：ready，约 901 nodes / 1769 edges。
- `F-ccb-source`：ready，约 32905 nodes / 94694 edges。

### 1.5 规模对比

已采集的规模证据：

| 项目 | 文件数 | 总行数 | TypeScript/TSX 规模 | Markdown 规模 | 结构特征 |
| --- | ---: | ---: | ---: | ---: | --- |
| Linghun | 约 87 个相关文件 | 约 36,487 行 | `.ts` 约 25 个文件 / 15,959 行 | `.md` 约 40 个文件 / 19,884 行 | 文档多；实现集中；TUI 单文件约 7817 行 |
| CCB | 约 3290 个相关文件 | 约 721,513 行 | `.ts` 约 2408 个文件 / 550,650 行；`.tsx` 约 689 个文件 / 141,684 行 | 文档占比相对较低 | 实现分布广；TUI/工具/权限/命令/状态组件化 |

该规模对比不能简单理解为“代码越多越成熟”。但它能说明：Linghun 当前有大量文档和阶段结论，而实际产品级细节尚未像 CCB 一样沉淀到分层实现中。

---

## 2. 当前 Linghun 真实能力：不能低估，也不能高估

### 2.1 已经真实存在的能力

当前 Linghun 已经具备以下真实源码能力：

1. **模型事件协议**
   - `LinghunEvent` 包含：
     - `assistant_text_delta`
     - `tool_use`
     - `tool_result`
     - `usage`
     - `error`

2. **OpenAI-compatible provider**
   - `OpenAiCompatibleProvider` 可构造 `/chat/completions` streaming 请求。
   - 支持工具 schema 转换为 OpenAI function tools。
   - 支持 HTTP 错误分类，例如 400、401/403、429、5xx。
   - 支持 usage 和 cache token 字段读取。

3. **DeepSeek provider**
   - `DeepSeekProvider` 默认 base URL 为 `https://api.deepseek.com/v1`。
   - 已有 `deepseek-v4-flash`、`deepseek-v4-pro` 模型信息。

4. **模型工具调用解析**
   - streaming delta 中的 `tool_calls` 会按 index 累积。
   - 函数名和 JSON arguments 完整后产出 `tool_use` 事件。

5. **TUI 模型-工具闭环**
   - TUI model loop 中会收集 `tool_use`。
   - 每个 tool call 会进入 `executeModelToolUse()`。
   - 通过 `decidePermission()` 决策。
   - 允许后执行 `runTool()`。
   - 工具结果以 `role: "tool"` 回灌给模型。

6. **default 权限安全边界**
   - default 模式允许只读或会话内工具。
   - Bash、Write、Edit、MultiEdit 等高风险工具不会静默执行。
   - 没有 pending confirmation 时，不应直接把自然语言控制面动作交给模型。

7. **Natural Command Bridge**
   - 存在 command capability catalog。
   - 能区分 readonly / start_gate / config_write / tool_permission / dangerous 等风险。
   - 具备 runtime status 给模型的能力。

8. **基础状态行**
   - 显示 session、provider/model、permission mode、background task count、cache hit rate、index status、pending gate。

9. **内建工具**
   - `Read`
   - `Write`
   - `Edit`
   - `MultiEdit`
   - `Grep`
   - `Glob`
   - `Bash`
   - `Todo`
   - `Diff`

### 2.2 必须纠正的历史误判

早期 audit 中出现过“Linghun 没有真实 provider tool_use”“没有 tool_result 闭环”等 P0 结论。按当前源码看，这些结论已不再是当前事实。

后续报告和修复不能继续引用过期 P0 作为当前缺陷，否则会误导方向。正确说法应是：

- **当前已经有 tool_use/tool_result 最小闭环。**
- **但该闭环的成熟度、交互质量、异常恢复、复杂任务稳定性、工具结果展示和权限体验仍显著弱于 CCB。**

---

## 3. 核心差距一：TUI 结构过重，产品能力集中在单文件

### 3.1 现状

Linghun 的 `packages/tui/src/index.ts` 约 7817 行，集中包含：

- TUI/REPL 主循环；
- slash command dispatch；
- `/help`、`/doctor`、`/model`、`/cache`、`/memory`、`/agent`、`/workflow` 等大量命令处理；
- model streaming loop；
- tool schema 构造；
- tool execution；
- permission decision；
- permission denied recording；
- status line；
- output formatting；
- cache/history/index/memory/agent/verification 相关逻辑；
- Natural Command Bridge 接入。

### 3.2 与 CCB 对比

CCB 中类似能力分布在多个成熟模块：

- `src/screens/REPL.tsx`
- `src/Tool.ts`
- `src/commands.ts`
- `src/components/StatusLine.tsx`
- `src/components/permissions/PermissionPrompt.tsx`
- `src/utils/permissions/permissions.ts`
- `src/utils/sessionStorage.ts`
- `src/utils/hooks.ts`
- `src/cli/print.ts`
- 以及大量 tool、command、component、utils 子模块。

CCB 的成熟点不是“文件更多”，而是职责边界更清晰：

- 命令注册和命令执行分离；
- 工具生命周期独立；
- 权限 UI 独立；
- 状态行组件独立；
- session/message/hook/MCP 等基础设施独立；
- TUI 渲染与业务逻辑不完全搅在一个函数链中。

### 3.3 风险判断

Linghun 当前单文件集中不是普通代码风格问题，而是后续成熟化的直接障碍：

- 加功能时容易继续往 `index.ts` 堆分支；
- 修权限可能影响 TUI 输出；
- 修 model loop 可能影响 slash command；
- 修状态行可能牵连 runtime context；
- 测试粒度难以稳定；
- 后续 agent/workflow/hook/plugin/skill 扩展会进一步扩大文件。

### 3.4 是否属于过度设计

这不是传统意义上的“抽象过度”，而是**路线图过度 + 实现集中不足**：

- 文档层面规划了很多成熟能力；
- 实现层面没有相应模块边界；
- 最终表现为“功能名多、文件大、局部补丁多、难以产品化”。

### 3.5 后续修复基准

不能一上来大重构。建议按用户体验链路切小块：

1. 先抽出 command registry / command handlers 的最小结构，替代 35+ 路 if/else；
2. 再抽出 permission prompt/decision 的 UI 与 policy 边界；
3. 再抽出 tool rendering / result preview / evidence link；
4. 再抽出 status line 数据模型与 renderer；
5. 每一步必须保持现有命令行为不变，并有真实 TUI smoke。

---

## 4. 核心差距二：工具系统有闭环，但远未达到 CCB 工具生命周期成熟度

### 4.1 Linghun 当前工具接口

Linghun `ToolDefinition` 主要包含：

- `name`
- `title`
- `description`
- `permission`
- `isReadOnly`
- `isConcurrencySafe`
- `isLongRunning?`
- `call(input, context): Promise<ToolOutput>`

内建工具数量为 9 个。

### 4.2 CCB 工具接口成熟度

CCB 的 `Tool` 契约包含大量产品级字段和方法，例如：

- `inputSchema`
- `inputJSONSchema`
- `outputSchema`
- `isConcurrencySafe(input)`
- `isEnabled()`
- `isReadOnly(input)`
- `isDestructive?(input)`
- `interruptBehavior?()`
- `isSearchOrReadCommand?()`
- `isOpenWorld?(input)`
- `requiresUserInteraction?()`
- `maxResultSizeChars`
- `strict`
- `validateInput?()`
- `checkPermissions()`
- `renderToolResultMessage?()`
- `renderToolUseMessage()`
- `renderToolUseProgressMessage?()`
- `renderGroupedToolUse?()`
- `isResultTruncated?()`

这说明 CCB 工具不是简单“函数调用”，而是完整的交互对象：

- 可被模型调用；
- 可被 UI 渲染；
- 可被权限系统判定；
- 可被并发调度；
- 可中断；
- 可截断；
- 可分组展示；
- 可提供进度；
- 可声明是否 open-world；
- 可对输入输出 schema 做严格治理。

### 4.3 Linghun 当前不足

Linghun 当前工具系统主要不足：

1. **schema 能力薄**
   - 有 model tool definitions，但每个工具的输入 schema 不是工具对象自身强约束的成熟 schema 契约。

2. **渲染能力薄**
   - 工具结果主要通过 `formatToolOutput()` 做文本预览。
   - 没有 CCB 那种每个工具自定义 tool use/result/progress/grouped rendering 的成熟机制。

3. **进度能力薄**
   - Bash 有一定 progress/log 支持。
   - Grep/Glob/Read/Edit 等工具缺少统一 progress lifecycle。

4. **权限能力薄**
   - 工具有 metadata 风险，但没有 CCB 那种 tool-level `checkPermissions()` 与全局 permission system 深度联动。

5. **截断/证据体验薄**
   - 有 `fullOutputPath` 和 evidence，但用户交互层还没有成熟的“摘要/详情/调试/完整日志”分层体验。

6. **并发与中断语义薄**
   - `isConcurrencySafe` 存在，但没有达到 CCB 的调度、分组、interrupt behavior 产品成熟度。

### 4.4 “无效文字补丁”风险

如果后续只在交付文档中写“工具系统已支持 progress / truncation / permission / evidence”，但工具接口仍不承载这些生命周期，仍只是外层 TUI 文本格式化，那就是典型文字补丁。

真正的修复应落在工具契约与调用链上，而不是只改报告措辞。

### 4.5 后续修复基准

后续工具系统成熟化至少应达到：

- 每个工具有稳定输入 schema；
- 每个工具能声明 read-only/destructive/open-world/long-running/concurrency/interrupt；
- 每个工具有统一结果结构：summary、preview、full text/path、structured data、truncated、evidence id；
- 长任务有 progress event；
- 输出层支持默认摘要、可展开详情、debug 完整内容；
- permission policy 能基于工具属性 + 输入路径 + 命令风险做判断；
- 模型收到的 `tool_result` 和用户看到的输出可以分层，不互相污染。

---

## 5. 核心差距三：权限系统安全意识存在，但交互成熟度远弱于 CCB

### 5.1 Linghun 当前权限能力

Linghun 的 `decidePermission()` 已经包含重要安全边界：

- hard deny；
- plan 模式只允许只读或会话内规划工具；
- bypass 仍保留硬拒绝和安全路径；
- default 模式允许只读/Todo/Diff；
- default 模式不会静默执行 Bash、写入、编辑、删除、配置、安装、联网或权限变更；
- 对 deny/ask 做记录。

这部分是 Linghun 当前最值得肯定的底线能力之一。

### 5.2 CCB 权限成熟度

CCB 的权限体验明显更完整：

- 交互式 `PermissionPrompt`；
- 多选项 approve/reject；
- feedback config；
- Tab 修改；
- Esc 取消；
- inline descriptions；
- hook 决策；
- rules；
- auto approval classifier；
- denial tracking；
- headless fallback；
- sandbox/permission mode 联动；
- 权限提示与 TUI 状态/消息流一体化。

### 5.3 Linghun 的主要差距

1. **没有真正成熟的交互式审批 UI**
   - 当前更像文本提示 + 模式决策。
   - default 模式没有可在 TUI 中细粒度批准/拒绝/修改参数的成熟体验。

2. **没有足够的拒绝反馈循环**
   - CCB 可以收集拒绝原因和反馈。
   - Linghun 有记录 denied，但没有形成成熟 UX 和 policy 改进闭环。

3. **没有成熟规则体系**
   - CCB 可以通过规则/配置管理常用允许项。
   - Linghun 当前主要依赖 permission mode 和局部 hard deny。

4. **缺少 headless / non-interactive 的成熟 fallback 分层**
   - 后续真实自动任务、agent/job/workflow 会需要更强的非交互权限语义。

5. **权限提示没有和 diff/preview 深度结合**
   - 写入/编辑前应有清晰 diff、文件路径、风险说明、可撤销提示。

### 5.4 后续修复基准

权限成熟度不得以“不会静默执行高风险工具”作为最终标准；这只是底线。真正目标应是：

- default 模式下，模型提出高风险工具时，用户能在 TUI 中看到：工具、路径、风险、摘要、diff/预览、原因；
- 用户可选择允许一次、允许本会话、拒绝、修改输入、切 plan；
- 拒绝原因能进入模型上下文，让模型改方案；
- 非交互/headless 场景有明确 deny/ask fallback；
- permission decision 可被记录、回放、审计；
- bypass 也必须保留 hard deny；
- 所有权限路径都要有测试和真实 TUI smoke。

---

## 6. 核心差距四：命令系统仍是补丁式分发，未达到 CCB registry 成熟度

### 6.1 Linghun 当前现状

Linghun 的 `handleSlashCommand()` 采用大量 if/else 分支：

- `/help`
- `/doctor`
- `/model`
- `/cache`
- `/memory`
- `/agent`
- `/workflow`
- `/verify`
- `/exit`
- tool slash command mapping
- unknown command handling

Natural Command Bridge 另有 capability catalog，用于自然语言路由、风险声明和帮助展示。

### 6.2 CCB 当前现状

CCB 使用 `commands.ts` 作为命令注册中心：

- command modules 独立；
- `COMMANDS` memoize；
- 支持动态 skills/plugins/workflows；
- 支持 feature-gated commands；
- 支持 bridge-safe / remote-safe / non-interactive 等命令属性；
- 命令定义与帮助、执行、可用性、上下文联动。

### 6.3 Linghun 风险

Linghun 当前同时存在：

- slash command if/else；
- natural command capability catalog；
- slash-to-tool mapping；
- help 文案；
- risk metadata；
- command aliases；
- model-invocable/user-invocable 标记。

如果这些信息不是同一个 source of truth，就会持续出现：

- help 说能用，实际命令不支持；
- NCB 能识别，slash command 不能执行；
- risk catalog 写 readonly，实际命令会写配置；
- alias 在自然语言里生效，但 slash 不生效；
- 文档修了，运行时没修。

这正是“无效文字补丁”的高发区。

### 6.4 后续修复基准

命令系统必须逐步变成：

- 一个 command registry 是 single source of truth；
- 每个 command 声明：name、aliases、description、risk、readonly、requiresStartGate、writesConfig、toolPermission、modelInvocable、userInvocable、bridgeSafe、handler；
- `/help`、NCB、slash dispatch、风险提示、测试全部从 registry 派生；
- 新命令不能只加 if/else；
- 删除或改名命令必须有测试覆盖。

---

## 7. 核心差距五：状态行和运行时可观测性仍不够产品级

### 7.1 Linghun 当前状态行

Linghun 状态行当前包含：

- session；
- provider/model；
- permission mode；
- background task count；
- latest cache hit rate；
- index status；
- pending natural command gate。

这是一个有价值的最小状态行。

### 7.2 CCB 状态行成熟度

CCB 状态行包含更完整的运行时信息：

- model name；
- context used percentage；
- used tokens；
- context window size；
- total cost USD；
- rate limits；
- cache pill；
- cache hit-rate warning；
- index health pill；
- builtin/shell-command status line；
- 与消息流和 app state 联动。

### 7.3 Linghun 差距

Linghun 当前状态行的问题：

1. **缺少上下文窗口压力**
   - 用户不知道当前是否接近 context limit。

2. **缺少 token/cost 直观反馈**
   - 有 usage 数据，但状态行没有像 CCB 那样产品化展示。

3. **cache 信息过于单薄**
   - 只有 latest hit rate，不足以提示 cache 波动、破坏原因、低命中警告。

4. **index health 不够具体**
   - 只显示 status，不显示 changed files、staleness、是否建议重建。

5. **后台任务状态不够可操作**
   - 只显示数量，不显示关键任务、阻塞、失败、最近完成。

6. **窄终端/中英文显示质量需要真实验证**
   - 当前 `truncateDisplay(status, 120)` 是简单截断，不等于成熟布局。

### 7.4 后续修复基准

状态行应至少分阶段达到：

- 基础层：model/provider、mode、session、gate；
- 运行层：context used、tokens、cost、rate limit；
- 效率层：cache hit-rate、cache warning、index health；
- 工作层：background jobs、current tool、pending permission；
- 布局层：窄终端安全降级、中英文宽度正确、可配置简洁/详细模式。

---

## 8. 核心差距六：输出层仍是文本预览，不是成熟的 CCB 式交互层

### 8.1 Linghun 当前输出

Linghun 的工具输出通过 `formatToolOutput()` 生成：

- “工具 X 结果：”
- preview text；
- 如果 truncated 或 fullOutputPath 存在，提示完整日志路径或 transcript/evidence。

这比无限刷屏好，但仍是基础文本层。

### 8.2 CCB 输出成熟度

CCB 工具有更细的输出渲染能力：

- tool use message；
- tool result message；
- progress message；
- grouped tool use；
- truncation detection；
- per-tool rendering；
- UI component rendering；
- CLI print rendering；
- debug/verbose 分层。

### 8.3 Linghun 差距

Linghun 当前还缺少：

- primary/details/debug 三层输出；
- 大输出可折叠/可展开；
- 工具进度实时展示；
- 多工具并行分组展示；
- 错误输出与普通输出分层；
- evidence 与 transcript 的用户可导航入口；
- 模型收到的完整结构和用户看到的摘要之间的清晰分离。

### 8.4 后续修复基准

后续不应再用“加一行完整日志路径”作为输出成熟化终点。目标应是：

- 默认显示短摘要；
- 用户能展开详细结果；
- debug 模式可看完整原始输出；
- 长输出自动保存 evidence；
- 截断策略统一；
- 每个工具可自定义渲染，但遵守统一 UI contract；
- 模型 tool_result 不因 UI 截断而丢关键信息。

---

## 9. 核心差距七：Natural Command Bridge 有价值，但存在关键词补丁化风险

### 9.1 Linghun 当前 NCB 优点

Natural Command Bridge 是 Linghun 区别于普通 CLI 的重要方向：

- 中文自然语言控制；
- command capability catalog；
- 风险分类；
- start gate；
- runtime status；
- provider/model/cache/index/memory/extension 状态可注入。

这符合 Linghun 面向中文用户和新手友好的产品目标。

### 9.2 当前风险

NCB 最容易变成“关键词补丁堆积”：

- 用户说法一变，就加一个 alias；
- 命令识别错了，就加一条 regex；
- 风险判断错了，就在 catalog 改一行；
- help 不一致，就补文档；
- 但底层 command registry、permission、Start Gate、handler 没有统一。

这会导致：

- 中文命令越补越多；
- edge case 越来越难测；
- 误触发/漏触发不断出现；
- 自然语言体验看似增强，实际不可控。

### 9.3 与 CCB 对比

CCB 的自然语言/命令成熟度不是靠一个中文意图 router，而是靠：

- 命令 registry；
- tool schemas；
- permission prompt；
- model/tool loop；
- UI feedback；
- session/context；
- hooks/MCP/skills/plugins/workflows；
- 成熟的 product loop。

Linghun 的 NCB 必须建立在这些稳定底座上，否则会成为“漂亮入口 + 薄底座”。

### 9.4 后续修复基准

NCB 后续应：

- 只从 command registry 派生命令能力；
- 所有自然语言 action 都映射到明确 command/tool；
- 高风险 action 必须经过 Start Gate 或 permission；
- 无 pending confirmation 不进模型；
- 控制面 action 必须本地处理；
- fuzzy/keyword 命中要有置信度和 fallback；
- 每个新增 alias 都必须有测试；
- 对“无法确定”的请求，应解释可选命令，而不是猜测执行。

---

## 10. 核心差距八：Provider 已可用，但生态成熟度和错误恢复仍弱于 CCB

### 10.1 Linghun 当前 provider 能力

Linghun 当前 provider 层具备：

- OpenAI-compatible request 构造；
- DeepSeek 默认 provider；
- known model metadata；
- streaming SSE 解析；
- tool calls 增量聚合；
- usage/cache token 读取；
- 400/401/403/429/5xx 错误分类；
- `supportsTools === false` 时移除 tools/toolChoice。

### 10.2 主要不足

1. **provider 类型少**
   - 当前主要是 OpenAI-compatible / DeepSeek。
   - CCB 的原生 Anthropic stack 更成熟，围绕 Claude tool use、usage、cache、rate limits、context 等有更深处理。

2. **stream parser 假设偏简单**
   - 当前按 OpenAI-compatible delta 聚合 tool calls。
   - 复杂 provider 差异、异常 chunk、partial JSON、并发 tool call、多 choice、finish_reason 等成熟处理不足。

3. **错误分类还不够诊断级**
   - 有 HTTP 分类，但对 provider-specific body、tool schema 不兼容、model 不支持工具、base_url 错误、代理错误、quota 细节等诊断还不够。

4. **能力降级仍偏粗**
   - `supportsTools === false` 时移除 tools/toolChoice 是必要底线，但用户体验应更具体：为什么降级、怎么修、当前还能做什么。

5. **doctor 能力需要更贴近真实 provider**
   - 不能只检查配置存在，应能做脱敏、HTTP probe、model/tool support、base URL endpoint、常见 400 解释等。

### 10.3 后续修复基准

Provider 成熟化目标：

- 每个 provider 有能力声明：tools、vision、thinking、prompt cache、max output、context、usage、rate limit；
- doctor 能验证 key/base_url/model/tool support；
- 错误提示包含下一步命令；
- streaming parser 有 robust test cases；
- tool call partial JSON、parallel calls、invalid args、provider 400 都有回归；
- 降级为 plain text 时 UI 明确提示，不让用户误以为工具正在工作。

---

## 11. 核心差距九：缓存、索引、MCP、AI sessions 已有方向，但产品化深度不足

### 11.1 CCB Dev Boost 参考能力

`docs/ccb-optimizations.md` 中的 CCB Dev Boost 能力包括：

- 缓存破坏 12 维度自动诊断；
- 索引健康监控，超过 20% 文件变更提醒重建；
- 大文件索引保护；
- 缓存命中率 20 轮环形缓冲区 + 可视化面板；
- `/cache-log`；
- `/break-cache`；
- MCP schema 稳定；
- cloud MCP 启动延迟优化；
- duplicate render fix；
- codebase-memory-mcp；
- AI sessions MCP。

### 11.2 Linghun 当前状态

Linghun 已经把 cache/index/MCP/memory/sessions/agents 等能力写入路线图和部分实现，也在状态行显示 cache/index。

但按目前代码规模和 TUI 集中度看，这些能力仍更接近“最小闭环/命令存在”，尚未达到 CCB Dev Boost 那种可诊断、可视化、可治理的成熟度。

### 11.3 后续修复基准

后续不能只做到“有 `/cache` 命令”或“状态行显示 cache 百分比”。应达到：

- cache hit rate 历史可看；
- cache 低命中有原因诊断；
- index stale 有 changed files 和建议；
- MCP 工具 schema 稳定，有失败隔离；
- AI sessions 可用于跨工具续接，不只是文档声明；
- 大文件/生成物索引风险有保护。

---

## 12. 过度设计清单

这里的“过度设计”不是指某个函数写得复杂，而是指设计/文档承诺超过当前底座成熟度。

### 12.1 阶段路线图过密

Linghun 已完成 Phase 00–14，并完成 Phase 15 preflight / pre-Beta deep parity，但 Phase 15 Beta 仍 pending。阶段文档覆盖：

- project skeleton；
- session transcript；
- model gateway；
- TUI MVP；
- tools；
- permissions plan；
- behavior guardrail；
- verification；
- cache/cost；
- MCP/index；
- sessions/memory；
- agents；
- multi-model；
- skills/workflow；
- natural command bridge；
- pre-Beta parity；
- future Phase 15.5/16/17/18。

问题不是路线图本身，而是：

- 实际核心 runtime 仍集中在一个大 TUI 文件；
- 用户手感仍未进入真实 Phase 15 Beta；
- 许多“已闭环”能力还缺少 CCB 级 UI/UX 和异常恢复。

结论：阶段设计偏重，底座拆分和真实产品体验偏弱。

### 12.2 多模型、agent、workflow、skills 的时机偏早

Linghun 已有多模型协作、agents、skills/workflow 等阶段记录。但从 CCB 对比看，当前最应补强的是：

- tool loop；
- permission UI；
- output rendering；
- status line；
- command registry；
- provider diagnostics；
- TUI smoke。

在这些底座没达到 CCB 手感前，继续推进 agent/job/learning loop/desktop-ready 会扩大不稳定面。

### 12.3 Natural Command Bridge 承担过多体验责任

NCB 是好方向，但当前它有可能被用来掩盖底层命令/权限/输出不成熟：

- 用户说中文更容易触发命令；
- 但触发后的 permission、output、status、error recovery 仍不成熟；
- 这会让“入口体验”强于“执行体验”。

### 12.4 文档 closure 过多

已有大量 audit/closure/hardening 文档，这会带来两类风险：

1. 后续开发者看到“已完成”而不再检查真实源码；
2. 新问题通过“补一段已知限制/已关闭说明”解决，而不是修运行路径。

---

## 13. 不成熟清单

### P0：阻塞进入“等同 CCB 手感”的问题

1. **真实 TUI 手感未完成 Phase 15 Beta 验收**
   - Phase 15 仍 pending。
   - 不能宣称 Linghun 已接近 CCB。

2. **TUI 单文件职责过重**
   - 继续堆功能会降低修复速度和回归稳定性。

3. **权限交互不成熟**
   - 有 deny/ask 逻辑，但没有 CCB 级交互式审批。

4. **工具渲染和输出分层不成熟**
   - 当前仍是文本 preview + full log/evidence 提示。

5. **命令系统 single source of truth 不足**
   - slash dispatch、NCB catalog、help、risk、handler 容易漂移。

### P1：必须尽快修，否则会持续产生“文字补丁”

1. **工具接口缺少完整生命周期契约**
2. **provider doctor 和错误诊断不够深**
3. **状态行缺少 context/cost/rate limit/index health 细节**
4. **NCB alias/scoring 容易补丁化**
5. **cache/index/MCP 诊断能力偏浅**
6. **真实 TUI smoke 覆盖不足**
7. **中英文和窄终端显示未充分验证**
8. **agent/workflow 等高级能力依赖的底座还不够稳**

### P2：成熟化 polish，但不应伪装成 P0 修复

1. first-start wizard；
2. 更丰富的新手提示；
3. status line 可配置；
4. 多 provider fallback；
5. web evidence / freshness gate；
6. 更完整 plugin/skills marketplace；
7. desktop-ready 预留。

---

## 14. “无效文字补丁”判定标准

后续凡出现以下情况，应判定为无效文字补丁或高风险文字补丁：

1. **只改交付文档，不改运行路径**
   - 例如文档写“权限体验已增强”，但 TUI 仍不能交互审批。

2. **只加错误提示，不修错误来源**
   - 例如 provider 400 只是提示更长，tool schema 兼容性仍没测试。

3. **只加 alias/regex，不统一 command registry**
   - 例如自然语言命令错了就补关键词。

4. **只加状态字段，不提供可操作诊断**
   - 例如状态行显示 `index: stale`，但没有 changed files 和重建建议。

5. **只写“已通过 smoke”，没有真实复杂任务路径**
   - 单次 tool_use PASS 不等于 CCB 级工具链稳定。

6. **只写“与 CCB 对齐”，没有源码级对应能力**
   - 必须能指出 Linghun 中对应模块和 CCB 中参考模块。

7. **只把未来阶段写成已知限制，实际是当前阶段必需能力**
   - 例如 Phase 15 Beta 所需的基础 TUI 手感不能推到 Phase 15.5/16/18。

---

## 15. 后台深度审查补充证据：必须并入后续修复基准

本节补充后台源码审查返回的更细证据。它不是替代前文结论，而是把前文“成熟度不足/文字补丁风险”的判断进一步落到更具体的源码级对比上。后续修复时，应优先把这些证据对应的运行路径补实，而不是继续用 closure 文档替代产品行为。

### 15.1 TUI 不是 CCB 级终端产品面，而是 line-based REPL

后台审查指出，Linghun 当前 TUI 主入口仍是线性 REPL：读取输入行、写输出行、分发 slash command、调用模型。核心代码集中在 `packages/tui/src/index.ts` 的 `runTui` / `writeStatus` / `handleSlashCommand` / `sendMessage` 一带。

这意味着：

- 当前没有 CCB 那种 Ink/React 风格的消息树、状态组件、权限 modal、选择器、滚动区域和焦点管理；
- 状态行只是字符串输出，不是可持续更新的组件；
- 工具执行、权限提示、模型输出、命令反馈都混在 stdout 文本流里；
- 用户体验更接近“增强 REPL”，不是“成熟编码 TUI”。

CCB 对应能力分布在 `src/components/StatusLine.tsx`、权限组件、REPL screen、terminal UI stack 等模块中。后续不能只用“已有 TUI / 已有 status line”判断达标，必须以真实终端产品面为验收。

### 15.2 MCP / index / cache 当前有入口和摘要，但不少路径仍是 placeholder 或 summary 化

后台审查特别指出：Linghun 的 MCP/index/cache 在文档中被描述为一等能力，但运行时代码里仍存在明显“状态摘要化”现象：

- MCP state 主要由配置生成，并存在类似 `${server.name}.status` 的伪工具状态；
- MCP 描述中有“real tool schemas are not dumped”一类占位语义；
- index 初始状态更接近 `unknown` / `missing` 的本地摘要；
- cache freshness 中仍能看到“memory/handoff not loaded yet”这类阶段性说明。

而 CCB 的 MCP 路径包含真实 connection manager、client/tools/commands/resources 生命周期、动态命令/技能/插件加载和 MCP prompt command 接入。

因此，后续不能把“配置里有 MCP server / 状态行显示 index/cache / 文档写了 MCP 闭环”视为成熟。真正验收应看：

- MCP server 是否真实连接、重连、失败隔离；
- MCP tools / commands / resources 是否进入同一 command/tool registry；
- index stale 是否能给出 changed files 和重建建议；
- cache 是否有真实 cache-control 或至少稳定诊断，而不是只记录 usage 数字。

### 15.3 Agent / workflow 当前更像状态和 transcript，不是 CCB 级 autonomous loop

后台审查指出，Linghun 当前 agent 相关路径更多是：

- 创建任务状态；
- 写 transcript / assistant summary；
- explorer/planner 返回 canned summary；
- worker 仅支持很窄的 `write <path> <content>` 类 regex 路径；
- 不匹配时返回“没有匹配低风险 write 路径，因此未改文件”一类说明。

这和 CCB 中通过 query loop、AgentTool、上下文管理、工具调用、memory prefetch、compaction、streaming events 支撑的真实 agentic loop 不在同一成熟度层级。

因此，后续不得把“有 `/agents`、`/fork`、agent transcript、agent 状态”视为 agent 成熟。Phase 15 当前也不应被 agent/workflow 的表层存在干扰；优先级仍应回到核心编码手感。

### 15.4 工具执行是 post-stream sequential，不是 CCB streaming tool executor

后台审查指出，Linghun 当前模型流中先收集 `toolCalls`，等模型本轮 stream 结束后，再依次执行工具并把结果回灌。这条路径是真实可用的最小闭环，但成熟度低于 CCB。

CCB 中存在 streaming tool execution：

- tool_use streaming 出来后可尽早执行；
- concurrency-safe tool 可并行；
- non-concurrent tool 独占；
- 结果按接收顺序 buffer；
- progress 与 pending tool state 可被 UI 感知。

Linghun 后续若要接近 CCB 手感，不能只满足“工具最终能跑”。需要逐步实现：

- tool call streaming 期间的 pending 状态；
- safe tools 的并发策略；
- long-running tool progress；
- interrupt/cancel 语义；
- ordered result buffering；
- 工具执行状态进入 TUI/status line。

### 15.5 权限 ask 当前 fail-closed，但不是交互式审批产品

后台审查进一步确认：Linghun `decidePermission()` 是真实存在的集中策略，且 default 模式能 fail-closed；但 ask 路径由于“当前最小 REPL 没有交互式审批 UI”，本质上还不是 CCB 级权限产品。

CCB 权限路径包含：

- hook decision；
- classifier；
- sandbox；
- subcommand / redirection 分析；
- telemetry；
- interactive prompt；
- headless fallback；
- permission timing 和 refusal 记录。

Linghun 后续要补的是“用户可理解、可操作、可拒绝、可修改、可回灌模型”的审批体验，而不只是继续加强 deny 文案。

### 15.6 Query loop / context loop 明显弱于 CCB

后台审查指出，CCB 的 query loop 有大量成熟机制：

- memory prefetch；
- skill/tool prefetch；
- pending tool summary；
- output-token recovery；
- auto-compact / microcompact / context collapse；
- raw tool result release；
- interrupted tool_use 的 missing tool_result 合成。

Linghun 当前 `sendMessage` 更接近每轮构造 system/user messages，再在本轮内追加 tool result。它已经能完成最小工具回灌，但缺少长上下文、多轮任务、压缩、恢复、预算和中断治理。

后续如果直接推进更复杂 agent/job/workflow，会放大这个底座差距。

### 15.7 Prompt cache 当前更多是 usage accounting，不是 CCB cache-control 成熟度

后台审查指出，Linghun provider 能解析 cache read/write token 字段，也能在状态行显示 cache hit rate；但这更接近 usage accounting。

CCB 则有 API-side cache-control 构造、消息级 cache 标记、thinking/redacted thinking/provider metadata 处理、cache allowlist、TTL/header/request-id correlation、UI cache pill 等更完整能力。

因此，后续修复时不能把“能显示 cache hit rate”视为 cache 成熟。至少需要区分：

- cache 统计；
- cache 诊断；
- cache-control；
- cache 破坏原因；
- cache UI 提示；
- cache 与 provider 能力的兼容性。

### 15.8 本补充证据对报告结论的影响

后台审查没有推翻本报告前文结论，反而加强了以下判断：

1. Linghun 当前有真实最小闭环，但不是 CCB 级成熟产品；
2. 最大风险是“能力名称已经很多，运行深度不足”；
3. 文档 closure 不能继续领先源码成熟度；
4. Phase 15 Beta 前必须优先修核心手感：TUI、permission、tool execution、output、status、provider diagnostics；
5. agent/workflow/MCP/cache/index 等高级面必须避免继续停留在 status/catalog/summary/placeholder 层。

---

## 16. 后续修复路线：以 CCB 手感为验收，不以阶段文字为验收

### 15.1 第一优先级：Phase 15 Beta handfeel gate

目标：让 Linghun 在真实 TUI 中完成一个中等代码任务，手感不崩。

必须包含：

- 模型可读文件；
- 可 grep/glob；
- 可提出编辑；
- default 模式正确阻止写入并提示；
- 用户切受控模式或明确命令后可执行；
- 工具结果不刷屏；
- permission 信息清楚；
- status line 显示有用状态；
- provider 错误可诊断；
- 任务完成后有 transcript/evidence。

### 15.2 第二优先级：命令 registry 收敛

目标：消灭 slash/NCB/help/risk 漂移。

最小改动策略：

- 不大重写；
- 先引入 registry 数据结构；
- 逐步把现有 if/else handler 挂入 registry；
- `/help` 和 NCB 先从 registry 读取元数据；
- 每迁移一组命令就做 smoke。

### 15.3 第三优先级：permission prompt 产品化

目标：default 模式下高风险工具请求有 CCB 式可理解、可操作体验。

最小闭环：

- 展示工具、路径、风险、原因、preview/diff；
- allow once / deny / modify / plan；
- deny reason 回灌模型；
- transcript 记录 decision；
- headless fallback 明确。

### 15.4 第四优先级：tool output 分层

目标：解决刷屏、截断、证据不可导航问题。

最小闭环：

- `ToolOutput` 扩展 summary/preview/details/fullOutputPath/evidenceId/truncated；
- 用户默认看 summary；
- debug 可看 details；
- 模型收到结构化必要信息；
- 大输出保存在 evidence/full log。

### 15.5 第五优先级：status line 与 diagnostics

目标：让用户随时知道 Linghun 当前是否健康。

最小闭环：

- context/token/cost；
- cache hit-rate + warning；
- index changed files/stale；
- provider/model/tool support；
- pending permission/gate；
- background latest status。

---

## 16. 后续每轮修复的强制验收模板

每个修复 PR/阶段必须回答：

1. 本次修的是哪个 CCB 手感差距？
2. CCB 对应参考文件/行为是什么？
3. Linghun 改了哪些运行路径？
4. 有没有只改文档？如果有，为什么不是文字补丁？
5. 用户如何在 TUI 中触发？
6. default/plan/bypass/auto/dontAsk 下行为分别是什么？
7. 模型是否收到正确 tool_result？
8. 用户是否看到清晰输出？
9. 大输出/错误/拒绝/取消如何处理？
10. 运行了哪些最小验证？
11. 是否有真实 TUI smoke？
12. 是否更新了阶段交付文档？
13. 是否明确没有进入下一阶段？

---

## 17. 最终基准：修复完成后应达到的状态

Linghun 后续底层优化完成后，应达到以下状态：

### 17.1 等同 CCB 的部分

- 多轮模型工具调用稳定；
- 权限体验安全且可操作；
- 工具输出可读、可追溯、可调试；
- 命令系统可维护；
- 状态行能反映真实运行健康；
- provider/model 错误可诊断；
- cache/index/MCP 不只是命令存在，而是可治理；
- session/transcript/evidence 能支撑复盘；
- 真实项目 Beta 可连续使用。

### 17.2 应强于 CCB 的部分

Linghun 不应只复制 CCB，而应在这些方向强于 CCB：

- 中文自然语言控制；
- 中文错误提示和修复建议；
- DeepSeek/OpenAI-compatible 本地化适配；
- 新手默认简单、高级能力可展开；
- 本地 codebase-memory / ai-sessions 跨工具续接；
- 面向中文开发者的 Start Gate 和权限解释；
- 轻量 clean rewrite，不携带 CCB 内部专有复杂度。

---

## 18. 本报告的使用方式

后续所有“底层优化和修复”应以本报告为基准：

- 不再接受只写 closure 文档的完成方式；
- 不再接受只补 alias/文案/提示的成熟化；
- 不再接受把 Phase 15 Beta 必需的 TUI 手感推迟到 Phase 15.5/16/18；
- 每个修复必须落到源码运行路径；
- 每个修复必须能在真实 TUI 或等效 smoke 中复现；
- 每个修复必须能说明与 CCB 的具体差距被缩小了多少。

---

## 19. 附：本次报告未做的事

按用户要求，本轮不进行源码改动。本报告只新增根目录报告文件，不修改 Linghun 运行代码。

本轮也不宣称 Phase 15 Beta 已完成；Phase 15 仍应保持 pending，进入前必须由用户明确确认，并通过真实 TUI handfeel gate。
