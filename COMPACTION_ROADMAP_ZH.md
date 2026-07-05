# Linghun 上下文压缩改造阶段规划

## 当前结论

阶段一“diff 开发窗口”已经完成，后续不建议继续只围绕 UI 提示或摘要字数修补。结合本地对 CCB 与 Codex 源码的检查，成熟方向应该是：压缩触发后真正生成一个更小、可续跑的 compacted context/window，而不是只把上下文压到阈值线以下。

CCB 的参考点是多层压缩与恢复预算：先轻量处理旧工具结果和大 payload，再进入 session memory compact 或传统 summary compact，compact 后按固定预算恢复必要上下文。Codex 的参考点是 replacement history / compacted window：达到自动压缩阈值后，用新的 compacted history 替换 provider-visible history，并推进窗口计数。

因此，后续建议按 6 个总阶段推进，其中阶段一已完成，实际剩余阶段二到阶段六。这里还要明确补上两件事：第一，compact 完成后终端主屏/当前会话可见记录应该明显变少，旧记录进入 compacted transcript 或 details 归档，不继续撑满当前上下文；第二，进度条和提示美化要作为最终体验验收的一部分，而不是只做文案降噪。

## 阶段一：Diff 开发窗口

状态：已完成。

目标是把当前问题窗口、变更边界、可回退位置和验证入口先固定住。这个阶段完成后，后续压缩策略、provider context、UI 提示和测试都不再混在一起做。

验收边界：

- 当前 diff/开发窗口已经明确。
- 后续改动可以基于该窗口继续推进。
- 不把 unrelated 变更回滚或混入压缩改造。

## 阶段二：压缩后目标预算

目标：引入明确的 post-compact retained budget，不再只压到触发阈值以下。

当前问题是压缩后释放空间太少，下一轮很容易再次接近阈值并继续提示。成熟实现里，CCB 有 post-compact token budget，Codex remote v2 也有 retained message token budget。我们应该把 compact 后的目标从“低于阈值”改成“落到一个稳定预算”。

建议改动：

- 新增或统一 `postCompactTargetTokens` / `retainedBudgetTokens` 概念。
- 普通窗口采用固定预算或比例预算，例如 40k 到 80k 区间。
- 200k 级别上下文首次 compact 的默认目标建议压到约 60k，也就是原窗口 30% 左右；可用公式 `postCompactTargetTokens = clamp(contextWindow * 0.30, 40k, 80k)`。
- 这个 30% 是 Linghun 结合自身窗口、恢复上下文、终端记录和 cache 边界给出的默认建议，不是照搬 CCB/Codex 的硬编码比例；那两个成熟实现主要参考的是 retained/post-compact budget、replacement window 和恢复预算机制。
- 保守模式可放到 70k-80k，适合复杂开发、证据链很多的任务；激进模式可压到 40k-50k，适合主要由日志、工具输出、重复聊天撑大的窗口。
- 大窗口可以按比例放大，但需要上限，避免 compact 后仍然太胖；不建议 200k 压完还停在 120k+，这会很快再次触发 compact。
- 摘要长度只作为局部约束，真正约束应该是“压缩后整体 provider-visible context”。
- 在 token 统计里区分 pre-compact tokens、post-compact projected tokens、actual provider-visible tokens。

验收边界：

- compact 后上下文稳定低于目标预算，而不是只低于触发线。
- 200k fixture 首次 compact 后应落在 40k-80k 区间，默认目标约 60k，并记录压缩前 tokens、压缩后 projected tokens、节省比例。
- token fixture 能覆盖普通窗口、大窗口、超大工具结果三类场景，并包含 1M provider window 的保留预算压测。
- compact 后不会立刻再次触发同类提示。

## 阶段三：Compacted Window / Replacement Projection

状态：已完成。实现已写入 compact projection / replacement 元数据，compact 成功后等待终端主屏 projection 收敛，记录 replacement message count 与 visible transcript count；旧主屏块同步到 transcript source，resume 解析保留最新 projection 元数据。

目标：compact 成功后，后续 provider-visible context 从新的 compacted window 开始计算，同时终端主屏/当前会话视图也切到 compact 后的新记录边界。

这是解决“一直提示”的关键阶段。如果旧 history 仍然被完整计入下一轮，只插入一条摘要并不能真正释放窗口。Codex 的 `replacement_history` 和 `advance_auto_compact_window()` 说明成熟做法是把 compact 结果作为新的历史基准。用户可见的终端记录也应该跟着收敛：压缩完成后主屏只保留 compact boundary、摘要、必要恢复项和最近交互，旧的长工具输出和历史聊天进入可追溯归档，不继续在当前终端里大量占位。

建议改动：

- 引入 compact projection 或 replacement history 数据结构。
- compact 成功后写入新的 provider-visible history 基准。
- token accounting 使用 compacted window 的起点，而不是旧窗口累计值。
- 同步生成 terminal-visible projection：当前主屏只展示 compact boundary、摘要、恢复项和最近消息。
- 旧记录进入 compacted transcript / details / log，不再作为当前终端主屏的大量历史记录继续渲染。
- rollout/replay/resume 时优先使用最新 compacted replacement projection。
- 保留必要的调试信息：compact id、window id、source window token count、replacement token count、visible transcript count。

验收边界：

- compact 后下一轮 token 统计以新窗口为基准。
- compact 后终端主屏/当前会话可见记录明显减少，不继续显示大量旧工具结果和旧聊天记录。
- 被裁掉的旧记录仍可通过 details/log/transcript 查回，不丢审计能力。
- resume/replay 后仍能还原 compacted provider context。
- provider 请求中不会继续携带被 replacement projection 替换掉的旧大块历史。

## 阶段四：分层压缩策略

目标：把压缩拆成轻重不同的路径，尽量保持 cache 命中和基座能力。

成熟实现不是每次都 full compact。CCB 有 microcompact、session memory compact、传统 summary compact、reactive compact 等层级。我们也应该优先处理最容易膨胀、最不值得保留的部分，再决定是否进入更重的摘要压缩。

建议路径：

- 第一层：轻量 payload trim，优先处理旧 tool result、大 stdout、重复日志、低价值渲染输出。
- 第二层：semantic/deep compact，把长期任务目标、关键决策、已读证据、约束提炼成结构化状态。
- 第三层：full summary compact，只在上下文仍超预算时触发。
- 第四层：reactive compact，当 provider 返回 prompt too long / context exceeded 时，进行紧急压缩后重试一次。
- 增加失败断路器，避免连续 compact 失败导致循环重试或持续提示。

验收边界：

- 普通工具输出膨胀能被轻量路径消化。
- 只有必要时才进入 full compact。
- reactive compact 有明确重试上限和错误出口。
- cache hit/break 有可观察指标，不因为压缩策略大幅破坏稳定前缀。

## 阶段五：恢复上下文与边界元数据

目标：压缩后恢复必要上下文，而不是只依赖自然语言摘要。

压得多会带来信息丢失风险，所以需要把“必须恢复的上下文”从普通对话历史里抽出来，形成稳定的 compact boundary。CCB 的 compact boundary、post-compact restore、hook result 思路值得参考。

建议保留/恢复内容：

- 当前任务目标与阶段状态。
- 用户明确约束和偏好。
- 已读关键文件、证据摘要、重要源码位置。
- 当前 git/diff 边界。
- agent/workflow/background 状态。
- 最近失败、阻塞点和下一步计划。
- 项目规则、provider 边界、验证要求。

需要避免恢复：

- secrets、key、完整敏感文件。
- 大块原始 stdout 或 generated payload。
- 已被 summary 覆盖且低价值的重复聊天内容。
- 会破坏 prompt cache 的随机顺序元数据。

验收边界：

- compact 后可以继续开发，不需要重新问用户关键背景。
- evidence/source reference 不丢失，能支撑后续代码事实声明。
- compact boundary 大小受控，可预测，不随会话无限增长。

## 阶段六：验收、进度条美化、UI 降噪与灰度

目标：在行为稳定后再处理用户可见提示、进度条体验、配置开关和灰度发布。

如果前面阶段没有真正降低 provider-visible context 和 terminal-visible records，提前隐藏提示只会掩盖问题。因此 UI 降噪和进度条美化应该放在最后：先保证压缩有效、终端记录确实变少，再把提示改成更少、更准、更可解释。

建议改动：

- focused tests：覆盖 compact budget、replacement projection、resume/replay、reactive retry。
- token fixture tests：构造大工具结果、多轮任务、大窗口模型、模型切换场景。
- real smoke：compact 后继续跑一轮真实任务，确认不会立刻再次提示。
- cache 检查：观察 compact 前后稳定前缀和 cache 命中变化。
- 终端记录检查：compact 后主屏记录数、可见 token、旧工具输出占位都应明显下降。
- 进度条美化：展示阶段化状态，例如扫描上下文、生成摘要、裁剪旧记录、恢复必要上下文、完成；避免刷屏式日志。
- 进度条数值：展示压缩前 tokens、压缩后 projected tokens、节省比例、目标预算命中情况。
- UI 提示：只在用户需要行动或存在风险时显示；普通自动 compact 成功可以降为简短状态。
- feature flag：先灰度启用 replacement projection、terminal-visible projection 和 retained budget。
- rollback：保留回退到旧 compact 行为的开关。

验收边界：

- 自动 compact 成功时用户提示显著减少。
- compact 成功后终端主屏记录明显变短，只留下 compact boundary、摘要、恢复项和最近交互。
- 进度条不刷屏、不遮挡关键信息，能清楚显示当前阶段和压缩收益。
- compact 失败时错误信息能给出下一步，而不是反复噪音提示。
- 新策略可配置、可回滚、可观测。

## 推荐推进顺序

后续实际开发建议按下面顺序推进：

1. 阶段二：先把 post-compact target budget 做出来。
2. 阶段三：再让 compacted window / replacement projection 成为后续 provider context 的基准。
3. 阶段四：补齐轻量压缩、深压缩、full compact、reactive compact 的分层。
4. 阶段五：完善 compact boundary 和恢复上下文。
5. 阶段六：最后做测试闭环、终端记录验收、进度条美化、UI 降噪、灰度和回滚。

其中阶段二和阶段三是核心。如果这两个不完成，后续再优化摘要质量、提示文案或 UI 展示，都只能缓解表象，不能真正解决“压缩后很快再次提示”的问题。

## 下一步建议

下一轮可以直接从阶段二开始：先定位当前 Linghun 的 compact token accounting、summary/deep compact 输出位置、provider-visible message 构造位置，然后加一个最小 retained budget 版本。先用 focused tests 证明 compact 后 token projection 明显下降，再进入 replacement projection 和 terminal-visible projection，确保压缩完成后终端主屏记录也会明显减少。
