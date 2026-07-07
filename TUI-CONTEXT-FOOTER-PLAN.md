# TUI 输出精装层与状态栏优化方案

## 1. 总方向

不要做大重构，做一个“输出精装层”的薄切。

这次优化不推翻现有 TUI，不改 provider 核心，不牺牲反幻觉、安全、evidence/details、权限、runner、agent/workflow 等现有能力。核心目标是把现在偏裸文本堆叠的输出，升级成“有层次的克制”：普通回答保持轻量，工具结果、diff、诊断、状态、错误等信息有清晰边界、摘要和详情入口。

一句话：保留 Linghun 现有底座，把输出展示层整理成熟。

## 2. 当前问题

### 2.1 输出层次不够清晰

assistant 正文、工具调用、工具结果、diff、diagnostic、workspace status、notification 等信息容易以相似的裸文本形态进入主屏。用户需要额外判断每一段内容的类型、状态和下一步。

### 2.2 工具结果过于抢主屏

工具运行时和结束后，如果 raw stdout、patch details、长日志或错误堆栈直接进入主屏，会挤压真正重要的摘要和下一步。完整输出应该进入 details/evidence，主屏只保留关键信息。

### 2.3 diff/code 渲染入口不统一

diff 可能来自 fenced `diff/patch`、编辑工具 patch details、`git diff`、verification 输出里的 patch。代码块也可能来自 assistant markdown、工具输出、诊断或报告。如果渲染入口不统一，后续很容易出现宽度爆炸、格式不一致、复制/详情提示缺失等问题。

### 2.4 workspace 状态缺少稳定面板

当前工作区状态、权限、索引、缓存、后台任务、上下文额度等信息容易散落在不同提示里。需要一条稳定、短句化、可扫视的状态面板，不解释内部机制，只给状态和下一步。

### 2.5 底部/预览区信息过载

预览区承担了太多辅助状态。上下文额度、缓存、索引、后台任务等长期状态更适合进入固定状态面板，不应该反复占用预览区和主输出。

## 3. 目标

1. 新增或扩展 `DisplayBlock` 规范，让输出先结构化，再渲染。
2. 升级 `tool-output-presenter`，让它返回结构化 block，同时保留旧字符串兼容。
3. 调整 `ProductBlock + MessageResponse` 视觉策略，让不同信息类型有不同边界。
4. 统一 diff/code 渲染入口，避免长行撑爆和格式漂移。
5. 工具调用做成“调用卡 + 结果卡”，主屏只放摘要和关键行。
6. 工作区可见层收敛成稳定状态面板，例如：`main · clean/ahead · full-access · index ready · cache ? · bg 0 · ctx 12%`。
7. 加 snapshot/golden tests 和真实 TUI smoke，防止后续视觉层退化。

## 4. 非目标

本阶段不做以下事情：

- 不重做 TUI 架构。
- 不改 provider 核心。
- 不改 prompt cache、上下文预算、权限、runner、agent/workflow 的底层逻辑。
- 不搬第二套 ccb 或 codex 的展示系统。
- 不把 raw stdout、raw patch、raw diagnostics 直接当主屏体验。
- 不为了视觉统一牺牲 evidence/details、反幻觉、安全边界。
- 不做大规模主题或品牌视觉重设计。

## 5. 第一阶段：补视觉规范，不碰 provider 核心

目标：先定义输出类型和视觉规则，让后续改动有边界。

### 5.1 DisplayBlock 规范

新增或扩展 `DisplayBlock`，至少包含这些 block 类型：

- `assistant_text`
- `assistant_thinking`
- `tool_call`
- `tool_result_success`
- `tool_result_error`
- `diff`
- `code`
- `workspace_status`
- `diagnostic`
- `notification`

每个 block 至少应该能表达：

- 标题
- 状态
- 摘要
- 正文
- 详情路径
- evidence id
- 是否可折叠
- 是否应该有边框

### 5.2 tool-output-presenter 升级

`tool-output-presenter` 不再只返回字符串，而是返回结构化 block。

要求：

- 保留旧字符串兼容，避免一次性改爆调用方。
- 主屏输出只放摘要和关键行。
- 完整输出进入 details/evidence。
- 失败输出必须包含 error type、exit code 或可定位的失败摘要。
- 成功输出优先给结果摘要，而不是完整日志。

### 5.3 ProductBlock 视觉策略

`ProductBlock` 不应该把所有内容都做成同一种卡片。

建议策略：

- 工具结果、diff、diagnostic、workspace status：轻边框或左侧 rail。
- 普通 assistant 正文：不加卡片，保持无边框，但 markdown 段落间距更清楚。
- 错误、权限等待、阻塞：保留强边框和明确状态。
- notification：短、轻、低干扰。
- assistant thinking：如果展示，只能弱化，不能抢正文。

验收：

- 普通回答不被卡片化。
- 工具结果和 diagnostic 有轻边界。
- 错误/权限/阻塞仍然醒目。
- provider 核心没有被改动。

## 6. 第二阶段：统一 diff/code 渲染入口

目标：所有 diff 和 code 都进入统一渲染路径。

### 6.1 StructuredDiff

所有 diff 来源统一进入 `StructuredDiff`：

- fenced `diff/patch`
- 编辑工具 patch details
- `git diff`
- verification 输出里的 patch
- 工具结果里识别出的 diff 片段

要求：

- 统一新增/删除/上下文行样式。
- 支持文件路径、hunk 信息、截断提示。
- 超长 diff 默认折叠，主屏保留摘要。
- 完整 diff 通过 details/evidence 查看。

### 6.2 Code block header

代码块补 header：

- language
- 文件路径
- 是否截断
- 复制提示
- 详情提示

### 6.3 width-aware wrap

长行必须 width-aware wrap。

要求：

- 不允许撑爆终端宽度。
- 不允许挤成一屏不可读。
- 中文、英文、表格、路径、长 URL、长 JSON 都要考虑。

验收：

- diff/code 在 80 列和 120 列都可读。
- 长行不会破坏布局。
- 所有 diff/code 来源走统一入口。

### 6.4 Phase 2 闭环记录

已完成：

- `MessageMarkdown` 普通代码块 header 统一为短格式：`language · copy · details`，并用 width-aware 裁剪，避免 header 撑宽。
- fenced `diff/patch` 继续走 `StructuredDiff`，普通 code 与 diff fence 在同一个 markdown 渲染入口分流。
- `ink-interaction-smoke.test.ts` 扩展 80 列真实 TUI smoke，覆盖中文、表格、普通 code 长 URL/长 JSON、diff fence 和最终屏幕行宽不溢出。
- `diff-renderer.test.ts` 与 `plain-renderer.test.ts` 继续覆盖纯 diff/plain 渲染路径。

验证：

- `corepack pnpm vitest run packages/tui/src/shell/ink-interaction-smoke.test.ts -t "renders assistant markdown code blocks"`
- `corepack pnpm vitest run packages/tui/src/shell/diff-renderer.test.ts packages/tui/src/shell/plain-renderer.test.ts`
- `corepack pnpm --filter @linghun/tui typecheck`

剩余边界：

- 编辑工具 patch details、`git diff`、verification patch 目前仍依赖 markdown/diff fence 或 tool presenter 输出进入统一入口；第三阶段工具调用卡/结果卡推进时继续收敛结构化来源元数据。

## 7. 第三阶段：工具调用做成“调用卡 + 结果卡”

目标：工具运行过程清楚，但不让 raw 输出抢主屏。

### 7.1 调用卡

工具开始时显示一行清楚的 call header，例如：

```text
● Bash(git status)
● Read(file.ts:1-80)
● Edit(file.ts) +3 -1
```

要求：

- 能看出工具名、核心参数和范围。
- 不展示过长参数。
- 敏感路径或冗长参数按现有安全策略处理。

### 7.2 运行中状态

运行中显示轻量进度。

要求：

- 不把 raw stdout 持续刷到主屏。
- 长任务只显示当前阶段、耗时或简短状态。
- 后台任务和 agent/workflow 状态进入统一状态面板或 details。

### 7.3 结果卡

工具结束时显示结果：

- 成功：摘要 + 关键 3-8 行。
- 失败：exit code / error type / 下一步。
- 超长输出：默认折叠，明确提示 `/details` 或快捷键看完整内容。

这块可以对齐 ccb 的拆法，但实现上使用 Linghun 现有 presenter、evidence 和 details 体系，不搬第二套系统。

验收：

- 工具成功不会刷屏。
- 工具失败能直接看到原因和下一步。
- 完整输出仍可通过 details/evidence 找到。
- 旧工具调用路径保持兼容。

### 7.4 Phase 3 闭环记录

已完成：

- `tool-output-presenter` 增加 `createStructuredToolCall` 和 `ToolCallDisplayBlock`，调用卡可表达 `tool_call`、工具名、running 状态、短摘要和轻边界，同时 `formatToolStart` 旧字符串兼容保留。
- `createStructuredToolOutput` 继续返回 `tool_result_success` / `tool_result_error` DisplayBlock，主屏只组合 lead、preview、diagnostic 摘要和 Bash end summary；完整内容仍通过 details/evidence 字段追溯。
- `createOutputBlock` 能把旧路径里的单行 `Bash(...)`、`Read(...)` 等调用 header 映射为 running `tool_call`，多行工具输出仍映射为结果卡，避免把旧结果误判为运行中调用。
- 消息块宽度处理把 `tool_call` 纳入 message block 白名单，避免调用卡摘要被普通单行截断路径打平。
- 补测试覆盖结构化调用卡、legacy 单行调用卡识别、多行结果卡不误判、结构化结果卡成功/失败状态。

验证：

- `corepack pnpm vitest run packages/tui/src/tool-output-presenter.test.ts packages/tui/src/shell/view-model.test.ts -t "tool_call|running tool_call|result card|结构化调用卡|结构化 DisplayBlock"`
- `corepack pnpm vitest run packages/tui/src/tool-output-presenter.test.ts packages/tui/src/shell/view-model.test.ts`
- `corepack pnpm --filter @linghun/tui typecheck`
- `corepack pnpm vitest run packages/tui/src/shell/ink-interaction-smoke.test.ts -t "drives CommandPanel, Ctrl\+O, task scroll, footer, and permission focus through TTY keys"`

剩余边界：

- 真实 runtime 调用方仍可继续逐步从 `formatToolStart` / `formatToolOutput` 字符串路径切到结构化 block 直传；本阶段先保证旧路径兼容和 view-model 语义识别。
- 后台任务、agent/workflow 的运行中状态仍按文档后续第四阶段/工作请求状态轨道接入统一状态面板，本阶段不混做。

## 8. 第四阶段：工作区可见层改成稳定状态面板

目标：把工作区状态、权限、索引、缓存、后台任务、上下文额度收敛成一条稳定状态面板。

建议默认展示：

```text
main · clean/ahead · full-access · index ready · cache ?  · ctx 12%
```

其中 `ctx 12%` 就是上下文额度，放在缓存后面或同一状态面板靠后位置。

### 8.1 上下文额度展示

上下文额度用进度条表达已使用比例。

宽屏：

```text
cache 84% · ctx [██░░░░░░░░] 12%
做成真实的进度条 上下文到多少了 压缩完还有多少 都要真实
```

窄屏：

```text
cache 84% · ctx 12%
```

极窄屏：

```text
ctx 12%
```

或按优先级隐藏。

### 8.2 异常时才展开

只有出现异常时才展开额外提示：

- 权限等待
- 验证失败
- 索引 stale
- 后台任务 running
- 上下文过高
- git dirty/ahead/behind 异常需要用户注意

### 8.3 状态面板文案原则

- 不输出长句。
- 不解释内部机制。
- 只给状态和下一步。
- 不挤压输入框。
- 不抢主输出。

验收：

- 状态面板稳定、短、可扫视。
- 上下文额度在缓存后或同一状态面板中出现。
- 异常状态能展开，正常状态不刷屏。
- 预览区不再常驻展示上下文额度。

## 9. 第五阶段：验证方式

目标：用 snapshot/golden tests 和真实 TUI smoke 锁住视觉层，避免后面又退回裸文本堆叠。

### 9.1 Snapshot / golden tests

覆盖：

- 长中文段落
- 英文 markdown
- 表格
- diff
- code block
- 工具成功
- 工具失败
- 超长 Bash 输出
- workspace status
- notification
- diagnostic
- 权限等待/阻塞
- 窄终端宽度

### 9.2 真实 TUI smoke

覆盖：

- 80 列
- 120 列
- 中文 Windows 终端
- no-color 模式
- 长输出折叠
- details/evidence 可追溯

### 9.3 验收要求

- 每次改视觉层都跑 snapshot。
- 聚焦测试通过后再扩展到相关 TUI 测试。
- 如果某些 smoke 不能自动化，记录手动验证步骤和结果。
- 不能只看单一宽度或单一英文输出。

## 10. 推荐落地顺序

建议按这个顺序推进：

1. 先改 `ProductBlock + MessageResponse` 的视觉策略，让工具结果和 diagnostic 有轻边界。
2. 再把 `tool-output-presenter` 产物升级成结构化 block，保留旧字符串兼容。
3. 接着统一 diff/code fence 到 `StructuredDiff`。
4. 最后做 workspace status panel 和 snapshot 测试。

这样不会牺牲现有反幻觉、安全、evidence/details 能力，也不需要推翻现有 TUI。

## 11. 当前确认结论

当前方案包含这些问题和改动方向：

- 输出裸文本堆叠问题。
- 工具结果、diagnostic、workspace status 缺少轻边界问题。
- diff/code 渲染入口不统一问题。
- 工具调用和工具结果缺少分层问题。
- raw stdout 抢主屏问题。
- 超长输出默认不折叠问题。
- 工作区状态散落问题。
- 缓存后缺少上下文额度进度展示问题。
- 预览区承担太多常驻状态问题。
- 视觉层缺少 snapshot/golden tests 导致容易退化问题。

最终目标不是变花，而是把克制做得有结构：普通正文干净，工具和状态有边界，失败有下一步，完整证据可追溯。

## 12. 独立任务轨道：上下文压缩、读准度与缓存命中修复

这部分是从 ccb、codex 和 Linghun 当前实现对比后拆出来的独立工程任务。它不属于前面 TUI 视觉层薄切，也不应该混进 ProductBlock、MessageResponse 或 tool-output-presenter 的展示改造里一起做。

当前定位结论：

- 压缩请求本身已经会发出，但 deep compact 更像独立摘要请求，没有像 ccb 那样复用主链 cache-safe prefix。
- 压缩完成后，我们更像每轮注入一段 summary packet，而不是像 codex/ccb 那样安装一条稳定的 replacement history / post-compact context chain。
- ccb 有 compact boundary / compact summary 的可见 UI 记录；codex 会发出 `ContextCompactionItem`，并用 replacement history 保留少量最近 user messages 和 summary。
- Linghun 代码里已经有 `deep_compact_packet`、`compactOutputMemory({ projectMainScreen: true })` 和 `/cache compact` 诊断痕迹，但文档缺少“压缩后终端主屏保留少量可见记录”的明确阶段和验收。
- 压缩后的缓存指纹缺少明确的 post-compact baseline 和 warmup 边界，容易把正常重建期看成持续 cache break。
- 恢复材料偏摘要文本，缺少稳定结构化字段，导致压缩后容易失忆、读不准、证据链不稳。
- 现有测试覆盖了 compact context 和 deep compact runtime，但缺少 provider preflight 级别的连续轮次缓存、上下文结构、终端可见记录回归测试。

本地源码对照证据：

- `F:\ccb-source\docs\context\compaction.mdx`：记录了 `compact_boundary`、只处理最后一条 boundary 之后消息、`preservedSegment` 和 `microcompact_boundary` 等压缩边界设计。
- `F:\ccb-source\src\QueryEngine.ts`：压缩结果会进入后续 transcript / SDK 消息处理路径，并通过 compact boundary 裁剪旧 mutable messages。
- `F:\openai-codex-source\codex-rs\protocol\src\compacted_item.rs`：`CompactedItem` 包含 `message` 和 `replacement_history`，说明压缩结果不是单纯摘要文本。
- `F:\openai-codex-source\codex-rs\core\src\compact_remote_v2.rs`：v2 compact 流程会构造/替换 compacted history，作为后续上下文恢复材料。
- `F:\openai-codex-source\codex-rs\app-server-protocol\src\protocol\v2\item.rs` 和 `thread_history.rs`：压缩会进入线程历史的 `ContextCompaction` item，历史层会保留 compact marker。

设计约束：Linghun 只吸收这两个仓库已经验证过的边界思想，即“provider 看到稳定 replacement projection，终端/历史看到稳定 compact boundary”。实现上仍复用 Linghun 自己的 `deep_compact_packet`、transcript、ProductBlock、details/evidence 和 cache diagnostic，不搬 ccb/codex 的 UI 或 runtime。

### 12.1 第一阶段：止住压缩后的缓存持续下降

目标：压缩后不要持续破坏主链缓存，先让缓存边界可解释、可观测、可回归。

任务：

- 让 deep compact 请求复用主请求的 cache-safe 参数或等价 prefix，避免压缩请求完全脱离主链缓存。
- 保持 deep compact 请求不污染主链缓存写入；压缩请求可以读缓存，但不应该写出会干扰主对话的新缓存块。
- 压缩成功后建立 `postCompactBaseline` 或等价状态，用新的 compact summary hash / projection hash 作为后续比较基线。
- 增加 compact 后 warmup 窗口：前 N 轮缓存下降不直接判定为持续 break，而是标记为 post-compact rebuild。
- `/cache`、状态面板或 diagnostic 只显示短状态，例如 `cache warming after compact`，完整 changedKeys 进入 details。

验收：

- deep compact 后连续两轮，同一 compact summary 下主请求 prefix hash 不再无意义漂移。
- 压缩后一两轮 cache hit rate 下降时，diagnostic 能区分 warmup 和真实 break。
- deep compact 请求不会写入破坏主会话缓存的额外缓存块。
- 有 focused test 覆盖 baseline reset 和 warmup 逻辑。

### 12.2 第二阶段：把压缩结果安装成稳定的后续上下文

目标：压缩后模型看到的是一条稳定的新上下文链，而不是每轮临时拼出来的一段 summary。

建议后续 provider-visible messages 顺序：

```text
system / developer stable prefix
Deep compact context
Context compact projection
recent live tail
latest user message
```

任务：

- 明确 deep compact 成功后的 replacement projection 结构，作为后续主请求的默认输入形态。
- 固定 compact context、compact projection、recent tail、latest user 的顺序，避免每轮插入位置变化。
- recent tail 只保留必要的最近真实交互，不把已压缩的大块旧历史重新带回来。
- 压缩后保留最新用户目标、当前任务状态、关键文件、关键 evidence refs、待验证项和阻塞项。
- 对 agent/workflow/background/permission 等运行态，只放短结构化状态，详细内容走 details/evidence。

验收：

- 压缩后 provider messages 中可以明确看到 compact context、projection、recent tail、latest user 四段边界。
- 同一个 compact packet 在连续主请求中位置稳定、hash 稳定。
- 压缩后不会重复注入已经被 summary 覆盖的大段旧历史。
- focused test 覆盖 replacement projection 的顺序和去重。

### 12.3 第三阶段：增强恢复包，解决失忆和读不准

目标：让 compact summary 从“自由文本摘要”升级成“可恢复任务状态包”。

恢复包至少包含：

- `latest_user_goal`：最新用户真实目标。
- `current_task_state`：当前做到了哪一步、下一步是什么。
- `files_read`：已经读过且仍相关的文件和行段。
- `files_changed`：已改文件、改动目的、未验证风险。
- `evidence_refs`：支持关键结论的 evidence id 或 details 路径。
- `pending_work`：未完成任务、阻塞项、待确认项。
- `verification_state`：已跑/未跑的测试、命令、结果。
- `agent_workflow_state`：仍在运行或需要恢复的 agent/workflow。
- `cache_state`：压缩后的缓存基线、warmup 状态、最近 break 原因。
- `do_not_claim`：缺少证据时不能声称完成、通过或一致。

任务：

- 在 deep compact reducer 中生成结构化字段，不完全依赖模型自由总结。
- summary 文本可以保留给模型读，但结构化字段必须参与 provider-visible context。
- 恢复包字段顺序固定，空字段显式省略或使用稳定空态，避免 hash 抖动。
- 对敏感路径、权限、raw tool output 仍沿用现有 safety/evidence 规则，不把完整日志塞回主屏或主 prompt。

验收：

- 压缩后继续同一任务时，模型能看到最新目标、关键文件、证据和下一步。
- 缺少验证时，恢复包明确记录 `verification_state`，避免压缩后误报通过。
- 恢复包变化只来自真实任务状态变化，不来自字段顺序或空态漂移。
- 有测试覆盖关键字段生成、字段稳定性和敏感内容不泄露。

### 12.4 第四阶段：压缩后终端可见记录和历史尾巴

目标：压缩完成后，终端主屏和历史里也要留下少量可见记录，让用户知道旧内容被压缩、还能看到压缩摘要和少量最近真实交互，而不是终端像被清空或只剩隐形 provider context。

对齐参考：

- ccb 有 compact boundary / compact summary 记录，并通过 preserved segment / boundary 后消息链避免把已压缩旧历史重新带回主链。
- codex 的 compaction 会发出 `ContextCompactionItem`，并把 replacement history 变成“少量最近用户消息 + summary”的稳定结构。
- Linghun 应该复用自己的 transcript、ProductBlock、details/evidence 和 `compactOutputMemory` 投影，不搬对方 UI。

建议终端可见结构：

```text
context compacted · summarized 128 events · kept recent 6 events · d details

[compact summary]
- latest goal: ...
- current state: ...
- next: ...

[recent tail]
user: ...
assistant/tool summary: ...
```

任务：

- deep compact 成功后写入一条稳定的 `compact_boundary` 或等价 transcript event，和 `deep_compact_packet` 区分：前者给终端/历史显示，后者给恢复和 provider context。
- 主屏只显示 compact marker、短摘要、最近少量真实交互，不回灌整段旧 transcript。
- recent visible tail 使用真实事件数或 token/字符预算，例如最近 4-8 条关键 user/assistant/tool summary；不能伪造完整历史。
- compact summary 支持 details 展开，完整 packet、证据 refs、raw tool output 仍走 details/evidence，不直接刷主屏。
- 压缩后终端可见记录必须和 provider-visible `recent live tail` 来自同一 compact projection，避免用户看到一套、模型读到另一套。
- `compactOutputMemory({ projectMainScreen: true })` 如果继续使用，必须有明确测试证明它会生成可见 marker/tail；失败时要写 diagnostic，不要静默吞掉。

验收：

- 手动或自动 compact 成功后，终端历史里能看到一条 compact boundary 和短摘要。
- 压缩后仍保留少量最近真实交互的可见记录；用户能判断“压缩前后发生了什么”。
- 主屏不显示完整旧历史、raw stdout、敏感路径、完整 tool input/output。
- `/cache compact` 或 details 能看到 compact id、events count、retained visible tail count、summary hash。
- 有 snapshot/golden test 覆盖 compact marker、summary、recent tail、details 入口和窄屏显示。

### 12.5 第五阶段：收敛动态上下文注入，减少 hash 抖动

目标：压缩后每轮主请求的动态内容变化要可控，不让缓存命中被无关状态拖垮。

任务：

- 梳理 system/developer/context footer、workspace status、cache diagnostic、index status、memory summary 的注入位置和更新频率。
- 把高频变化状态从稳定 prefix 移到尾部或 details，避免污染可缓存前缀。
- 对 changedKeys 做分类：真实用户上下文变化、工具结果变化、运行态变化、展示态变化分别处理。
- 状态面板展示的 cache/ctx 信息只读状态，不反向影响 provider prompt 的稳定 prefix。
- 对 compact 后的 `conversationPrefixHash`、`messagePrefixHash`、`systemHash`、`toolHash` 建立对照日志。

验收：

- 连续空转或相同任务续跑时，稳定 prefix hash 不因展示状态变化而漂移。
- cache changedKeys 能定位到具体变更来源，而不是只有大类 break。
- 状态面板 cache/ctx 更新不会改变主请求稳定前缀。
- 有测试或 diagnostic fixture 覆盖动态状态不污染 prefix。

### 12.6 第六阶段：补 provider preflight、终端可见记录和缓存回归测试

目标：把“压缩后读准”“压缩后用户可见历史”和“压缩后缓存恢复”锁进测试，避免后续改 TUI 或 provider 时回退。

测试建议：

- deep compact 后连续两轮 provider messages 结构稳定。
- compact summary 不变时，compact context hash / projection hash 不变。
- compact summary 改变时，只允许 compact 相关 hash 改变，system/tool/reasoning hash 不漂移。
- Anthropic cache_control 落在稳定 compact context 或等价稳定 user message 上。
- deep compact 请求可读主链 cache-safe prefix，但不写污染主链的缓存块。
- post-compact baseline reset 后，cache diagnostic 显示 warmup 而不是持续 break。
- 压缩恢复包包含 latest goal、files/evidence、verification state、pending work。
- 压缩后终端可见 compact marker、summary 和 recent tail 稳定渲染。
- 敏感内容、raw stdout、完整 tool logs 不进入 provider-visible 恢复包或终端可见 compact summary。

验收：

- focused compact/cache/TUI snapshot test 通过。
- provider preflight fixture 能展示压缩前、压缩请求、压缩后第一轮、压缩后第二轮的 messages 和 hash 对比。
- TUI fixture 能展示 compact boundary、summary、recent tail、details 入口和窄屏降级。
- 测试失败时能指出是 prefix 漂移、projection 顺序变化、cache_control 落点变化、恢复包字段缺失，还是终端可见记录缺失。

### 12.7 推荐执行顺序

建议按这个顺序做，不和 TUI 视觉层混在一个 PR 里：

1. 先做 deep compact 读主链 cache-safe prefix、post-compact baseline、warmup diagnostic。
2. 补 provider preflight 测试，锁住压缩后连续两轮 hash 稳定。
3. 再把 replacement projection 变成压缩后默认 provider-visible 结构。
4. 增强恢复包字段，解决压缩后失忆和读不准。
5. 补压缩后终端可见 compact boundary、summary 和 recent tail，和 provider projection 共用同一来源。
6. 最后收敛动态上下文注入和 changedKeys 分类，继续抬缓存命中。

这条轨道的最终目标：压缩后模型读到的是稳定、可恢复、可缓存的新上下文；用户终端也能看到 compact boundary、短摘要和少量最近真实记录。缓存下降能被解释和恢复，不能长期无意义下滑，也不能让用户感觉历史凭空消失。

## 13. 独立任务轨道：Windows 命令适配器成熟化

这部分不属于前面 TUI 视觉层五阶段，也不属于上下文压缩和缓存轨道。它属于 Bash/tool runner 的跨平台执行成熟度，目标是把 Windows 兼容从“字符串正则补丁”升级成“有执行域边界的命令适配器”。

当前定位结论：

- 现有 Windows 适配器已经会在 Bash tool 内生效，不是只做提示。
- 当前适配更接近整条字符串扫描，容易把 `adb shell`、`docker exec`、`ssh` 等子环境里的 Unix shell 语法误判成 Windows 宿主机命令。
- `adb shell "cat /proc/meminfo | head -n 5"` 这类命令中，`cat/head/|` 属于 Android 设备端 shell，不应该被 Windows PowerShell adapter 改写。
- 继续给 `adb`、`docker`、`ssh` 无限补关键词不成熟，应该统一识别“宿主 Windows 层、远端/设备/容器 shell 层、显式 shell wrapper 层”。
- 适配器只应该自动改写低风险、可证明等价的宿主层命令；混合或不确定场景应该返回清晰 diagnostic，而不是生成一条可能失败的 PowerShell 命令。

### 13.1 执行阶段定位

建议不要塞进 TUI 第一到第五阶段里做。它和 TUI 的关系是：TUI 负责把工具调用、失败、diagnostic 展示清楚；Windows 适配器负责底层命令执行边界正确。

推荐执行位置：

1. TUI 第三阶段“工具调用卡 + 结果卡”完成后，先做这条 Windows runner 轨道。
2. 再推进 TUI 第四阶段“稳定状态面板”，把 Windows/runner 异常状态接入短状态或 diagnostic。
3. 如果 Windows 命令适配已经阻塞当前开发，可以提前只做 `13.2` 和 `13.5` 的最小闭环，但不要和 ProductBlock、MessageResponse、context footer 改造混在同一个 PR。

### 13.2 第一阶段：建立命令边界分类和回归样本

目标：先把问题从“某个关键词冲突”提升到“执行域边界冲突”，用测试锁住行为。

任务：

- 为当前 `adaptShellCommand` 补边界分类测试，不先大改实现。
- 覆盖宿主 Windows 命令、显式 PowerShell/cmd 命令、native 命令、远端 shell payload、混合管线。
- 建立 ADB 代表样本，但测试目标不是“只修 ADB”，而是验证 remote/sub-shell payload 不被宿主 Windows adapter 误改。

测试样本至少包含：

- `adb devices`：native pass-through。
- `adb shell "cat /proc/meminfo | head -n 5"`：remote payload pass-through。
- `adb shell pm list packages | grep foo`：识别为宿主层管线或 ambiguous，返回 diagnostic。
- `docker exec app sh -c "cat /etc/os-release | head -n 5"`：remote/container payload pass-through。
- `ssh host "cat /etc/os-release | head -n 5"`：remote payload pass-through。
- `cat package.json`、`pwd`、`which node`：宿主层只读命令可做 PowerShell 等价适配。
- heredoc、多行 shell 写文件、危险重定向：仍然阻断或要求结构化工具。

验收：

- 能明确区分 host shell 语法和 remote/sub-shell payload。
- ADB 只是边界模型的一个用例，不是特判终点。
- 失败用 diagnostic 表达，不能伪装成一条会执行失败的 PowerShell 命令。

### 13.3 第二阶段：把适配器拆成 parse -> classify -> adapt/diagnose

目标：停止在整条字符串上直接做正则替换，改成先识别命令结构，再决定是否适配。

建议结构：

```ts
type CommandDomain = "host" | "explicit_shell" | "remote_shell" | "ambiguous";

type CommandClassification = {
  domain: CommandDomain;
  program: string;
  hostArgs: string[];
  remotePayload?: string;
  hasHostPipeline: boolean;
  confidence: "high" | "medium" | "low";
};
```

任务：

- 最小解析 program、args、quoted segments、pipe 是否在引号内。
- 识别显式 shell wrapper：`powershell -Command`、`cmd /c`、`bash -lc`、`sh -c`。
- 识别 remote/sub-shell wrapper：`adb shell`、`docker exec ... sh -c`、`ssh host "..."`。
- 分类结果低信心时只给 diagnostic，不自动改写。

验收：

- 适配前能输出稳定 classification，便于测试和 debug。
- 已有简单 Windows 只读命令适配不回退。
- mixed/ambiguous 命令不会被盲改。

### 13.4 第三阶段：Adapter registry 替代全局规则堆叠

目标：让不同执行域有自己的 adapter，不再把所有逻辑塞进一个巨大的字符串适配函数。

建议 adapter：

- `NativeCommandAdapter`：`node`、`pnpm`、`git`、`rg`、`adb devices` 等原生命令直接通过。
- `WindowsReadOnlyAdapter`：只处理宿主层低风险只读命令，例如 `cat`、`pwd`、`which`、简单 `ls`。
- `RemoteShellAdapter`：保护 `adb shell`、`docker exec`、`ssh` 等 payload，内部不被宿主 Windows adapter 扫描。
- `ExplicitShellAdapter`：用户已经明确指定 PowerShell/cmd/bash 时，避免二次改写。
- `BlockedWriteAdapter`：继续阻断 heredoc、shell 写文件、危险重定向，提示使用结构化 Edit/Write。
- `DiagnosticAdapter`：对混合管线、不确定 quote、跨 shell 高风险命令给下一步。

验收：

- 新增场景时优先新增 adapter 或 classification case，不继续堆全局关键词正则。
- adapter 决策可测试、可解释、可在 details 中追踪。
- 远端 payload 保护适用于多仓库、多任务，不绑定某个项目。

### 13.5 第四阶段：Runner 集成和前台卡住诊断

目标：解决 Windows 命令“看起来卡住”的体验问题，让 runner 能区分正在运行、等待交互、等待设备、超时和命令适配失败。

任务：

- 前台 Bash 增加更明确的 no-output/stall diagnostic，不只等默认超时。
- 对 `adb shell`、`docker exec`、`ssh` 等可能等待远端响应的命令，失败提示包含常见原因：设备授权、远端命令进入交互、quote 边界错误、宿主层管线误用。
- 保持 raw stdout 不刷主屏，完整日志仍进 details/evidence。
- 和 TUI 第三阶段工具结果卡对齐：主屏只显示状态、失败类型、下一步。

验收：

- 长时间无输出时，主屏能看到短诊断，而不是只有“像卡住了”。
- 超时、取消、prompt 等状态有不同 failure type。
- Windows runner 诊断能进入工具结果卡/details，不污染普通 assistant 正文。

### 13.6 第五阶段：跨仓库 Windows smoke 和回归锁定

目标：证明这不是某个仓库的 ADB 补丁，而是 Linghun runtime 的通用 Windows 能力。

测试建议：

- 单元测试覆盖 classification、adapter decision、diagnostic 文案。
- Windows 平台 smoke 覆盖 PowerShell、cmd shell、中文路径、带空格路径。
- ADB/Docker/SSH 这类外部依赖用 synthetic command fixture，不要求 CI 真连设备或远端。
- 对真实可用环境保留手动 smoke 步骤：`adb devices`、quoted `adb shell`、host pipeline diagnostic。

验收：

- 不同仓库通过 Linghun Bash tool 执行命令时，共享同一套 Windows 适配器行为。
- 宿主层 Unix 只读命令仍能被稳定适配。
- remote/sub-shell payload 不被宿主 Windows adapter 误伤。
- ambiguous 命令给明确下一步，不盲目执行高风险改写。

### 13.7 推荐执行顺序

建议按这个顺序做，单独成一个 runner/adapter PR：

1. 先补 classification fixture 和 ADB/Docker/SSH 代表性回归测试。
2. 拆出 `parse -> classify -> adapt/diagnose`，保留旧行为兼容。
3. 引入 adapter registry，把现有 Windows 只读适配迁进去。
4. 加 `RemoteShellAdapter` 和 `ExplicitShellAdapter`，保护子 shell payload。
5. 改善前台 Bash stall/prompt/timeout diagnostic，并接入工具结果卡/details。
6. 跑 focused test，再补 Windows smoke 记录。

这条轨道的最终目标：Windows 兼容成为 runtime 级通用能力。换任务、换仓库、换 ADB/Docker/SSH 场景时，系统靠执行域边界做正确决策，而不是靠不断追加正则和关键词补丁。

## 14. 独立任务轨道：工作请求状态可见层

这部分解决“用户感知低”的问题：当前工作中，用户容易只感知到“提交请求/等待确认”，但对系统到底是在理解、排队、调用模型、读文件、跑工具、等待权限、验证、恢复、失败还是收尾，感知不连续。

当前定位结论：

- Linghun 现有代码里已经有局部状态：`TaskPermissionView`、`BottomPaneStatusView`、`requestActivityPhase`、background task、compact progress、agent/workflow 状态等。
- 但这些状态没有收敛成统一的“当前工作请求 lifecycle”，所以主屏体验会塌缩成少数强状态，尤其是 permission/pending approval。
- ccb 的做法不是只有权限弹窗：它把权限请求建模成 `control_request`，同时有 session activity/state，把“需要用户动作”和“会话正在工作”分开。
- codex 的做法也不是单一 pending 状态：它有 app-server request、background request、agent status feed、session lifecycle 等投影，把后台请求、子 agent、会话运行态分别映射到 UI 历史或状态层。
- Linghun 不需要搬 ccb/codex 的 UI，但应该补一层自己的 `WorkRequestState`，把现有局部状态汇总成用户能扫到的进度和下一步。

### 14.1 执行阶段定位

这条轨道和 TUI 第三、第四阶段强相关，但不应该只当成 footer 文案改动。

推荐执行位置：

1. TUI 第三阶段“工具调用卡 + 结果卡”完成后，先建立 `WorkRequestState` 最小模型。
2. 再接入 TUI 第四阶段“稳定状态面板”，让状态面板消费这个模型，而不是各处自己拼字符串。
3. 远程通知、background、agent/workflow 后续也复用同一状态投影，避免不同入口显示不同事实。

如果用户感知已经明显阻塞体验，可以提前做 `14.2` 和 `14.3` 的薄切：先把当前请求阶段和下一步露出来，再逐步接 agent/background/verification。

### 14.2 第一阶段：定义 WorkRequestState 生命周期

目标：把“当前正在处理什么”从零散 phase/string 升级成稳定状态模型。

建议状态：

```ts
type WorkRequestPhase =
  | "idle"
  | "queued"
  | "understanding"
  | "planning"
  | "model_streaming"
  | "tool_calling"
  | "tool_running"
  | "permission_waiting"
  | "verification_running"
  | "provider_recovering"
  | "background_running"
  | "agent_running"
  | "blocked"
  | "failed"
  | "completed";
```

每个状态至少包含：

- `phase`：机器可测状态。
- `title`：主屏短标题，例如 `正在读文件`、`等待确认`、`正在验证`。
- `summary`：一行当前动作，例如 `Read packages/tui/src/...`。
- `nextAction`：用户需要知道的下一步；没有动作时不显示长解释。
- `elapsedMs`：运行时间。
- `progress`：可选进度，优先用真实 completed/total；没有真实进度就不要伪造百分比。
- `source`：model/tool/permission/runner/verification/agent/background/provider。
- `detailsRef`：完整日志、证据或详情入口。

验收：

- 当前请求从开始到结束至少能看到 3 个连续阶段：处理中、等待/运行、完成/失败。
- `permission_waiting` 不再是唯一强感知状态。
- 没有真实进度时只显示阶段和耗时，不伪造百分比。

### 14.3 第二阶段：把现有局部状态接入统一投影

目标：先复用现有状态，不新造第二套 runner 或 permission 系统。

接入来源：

- `TaskPermissionView`：映射到 `permission_waiting`。
- `requestActivityPhase`：映射 provider/model/final gate 等活动态。
- Bash/tool runtime：映射 `tool_calling`、`tool_running`、`failed`。
- verification runner：映射 `verification_running`、`failed`、`completed`。
- background task：映射 `background_running`、`blocked`、`failed`。
- agent/workflow：映射 `agent_running`、`blocked`、`completed`。
- compact/cache：映射 `provider_recovering`、`blocked` 或 resource 状态。

验收：

- `mapBottomPaneStatusToView` 不再只处理少数特殊 case，而是优先消费统一 `WorkRequestState`。
- 旧字段保留兼容，避免一次性改爆 TUI。
- 同一个状态在底栏、工具卡、details、远程通知里口径一致。

### 14.4 第三阶段：主屏展示策略

目标：用户一眼知道“现在在干什么”，但主屏不刷屏。

建议展示：

宽屏：

```text
working · tool Read · 1.8s · packages/tui/src/view-model.ts
```

等待用户：

```text
action required · Edit wants to write TUI-CONTEXT-FOOTER-PLAN.md · Enter confirm / d details / Esc cancel
```

验证中：

```text
verifying · focused test · 12s
```

失败：

```text
failed · Bash timeout · d details · next: retry or cancel
```

要求：

- 正常状态短，异常状态才展开下一步。
- 不把内部枚举、rule id、hook id、raw stdout 放主屏。
- 状态文案使用动词和对象，不只显示 `running`、`pending`。
- 一次只突出一个当前主状态，多个后台状态进入 summary 或 details。

验收：

- 用户能区分“模型在想”“工具在跑”“等我确认”“验证中”“卡住了”。
- 80 列和中文终端不换行爆炸。
- 主屏状态变化不会影响 provider prompt 稳定 prefix。

### 14.5 第四阶段：请求列表和历史事件

目标：不只看当前一瞬间，还能回看最近发生了什么。

建议增加轻量 request history：

- 当前 active request：最多 1 条主线。
- recent requests：保留最近 N 条摘要，例如 tool、verification、background、agent。
- 每条记录包含 start/end、status、summary、detailsRef。
- 历史进入 details 或 command panel，不常驻挤压主屏。

对齐点：

- ccb 的 session activity/state 给远端或会话管理消费。
- codex 的 agent status feed / background requests 会把运行态投影到历史或状态层。
- Linghun 应该走自己的 evidence/details 和 remote event 体系，不复制对方 UI。

验收：

- 用户能用 details 或面板看到最近卡在哪个请求。
- 后台任务、agent、verification 不再只靠最终消息被发现。
- 历史状态不包含完整日志或敏感 raw input。

### 14.6 第五阶段：远程通知和工作中感知

目标：用户离开终端时，也能知道任务有没有在推进、是否需要动作。

事件建议：

- `work_request_started`
- `work_request_progress`
- `action_required`
- `work_request_blocked`
- `verification_result`
- `work_request_completed`

要求：

- 远程侧只发 summary-only，不发完整代码、完整日志、完整 prompt。
- 远程 approval 仍然只能恢复已有本地 pending approval，不能新造执行。
- 高频 progress 要节流，只发关键阶段变化。

验收：

- 长任务运行时，用户能看到“还在工作”而不是只等最后结果。
- 需要确认时，action required 明确可见。
- 远程通知和本地底栏来自同一个状态投影，避免口径不一致。

### 14.7 推荐执行顺序

建议按这个顺序做，作为 TUI 状态层薄切，不和 provider 或权限底层混在一起：

1. 定义 `WorkRequestState` / `WorkRequestPhase` 类型和 presenter。
2. 把 `TaskPermissionView`、`requestActivityPhase`、tool runtime 最小接入。
3. 改 `mapBottomPaneStatusToView` 优先消费统一投影，保留旧逻辑 fallback。
4. 接 verification、background、agent/workflow 状态。
5. 增加 recent request history 到 details/command panel。
6. 补 snapshot/golden tests：idle、model streaming、tool running、permission waiting、verification、blocked、failed、completed。
7. 最后接远程 summary-only progress 事件。

这条轨道的最终目标：让用户持续知道 Linghun 当前是在工作、等待、验证、阻塞还是完成；状态要真实、短、可追溯，不靠刷日志制造存在感。


### 重要：
1.每个阶段做完 必须要独立复检和压测一次 经过用户同意以后才能提交稳定点
2.set "LINGHUN_CLI=F:\Linghun\apps\cli\dist\main.js" 用户是用的这个实测 每个阶段做完提交稳定点以后必须要重新build一下 确保用户拿到的是新的实测 要注意时间戳 是否build成功