# Linghun Open Source Positioning Notes

本文件记录后续撰写 README、开源项目介绍、官网文案或发布说明时不能忘记的产品定位。它不是阶段交付文档，也不代表已经完成对应实现。

## Evidence-first AI coding

Linghun 的反幻觉设计不只是安全约束，也是一套降本增效设计。

核心表述：

> Linghun 不是让模型凭感觉编程，而是让模型基于证据工作：更少幻觉、更少 token、更少返工。

英文短句：

> Evidence-first coding, not guess-first coding.

## 为什么这是卖点

大模型来自通用训练，模型层面很难天然知道用户当前仓库、文件改动、索引状态、权限模式、缓存状态、工具结果和最新外部信息。把这些都交给模型凭上下文猜，会带来幻觉、返工和 token 浪费。

Linghun 的路线是把事实层放在产品底座里：

- 先读代码、索引、工具结果和验证证据，再让模型判断。
- 用 `tool_use` / `tool_result` 和 `EvidenceSummary` 让模型基于真实工具结果继续推理。
- 用 codebase-memory / index 查项目事实，而不是猜仓库结构。
- 用结构化 handoff、项目规则和可控记忆减少跨会话重复解释。
- 用 summary-first / cache-first 减少完整日志、完整历史、完整索引进入 prompt。
- 用 Freshness Gate / web evidence 处理最新版本、API、价格、社区状态和安全公告。
- 用 Solution Completeness Gate 防止模型发现一个现象补一个关键词，先判断单点 bug 还是系统性缺口。

## 用户价值

- 更少幻觉：结论来自文件、命令、索引、验证或 web evidence。
- 更低成本：少塞全文、少重复解释、少破坏 prompt cache。
- 更少返工：模型先确认事实和影响面，再给修复方案。
- 更强编码能力：模型把推理能力用在真实项目问题上，而不是补不存在的上下文。
- 更适合长期项目：记忆、handoff、索引和验证闭环让跨会话开发更稳定。

## 可引用的实测口径

这些数据只作为后续 README、发布说明和评测设计的保守依据。引用时必须标注样本来源、provider、模型、时间范围和计算口径，不得写成所有模型或所有项目的固定承诺。

- Codex 会话 `019e2f46-9da6-75b3-b162-7d6e9d7ac44d` 中抽取到 1732 条 `token_count` 记录；累计 `input_tokens` 约 123,440,277，累计 `cached_input_tokens` 约 114,913,920，累计 cached/input 约 93.09%。
- 同一会话平均单轮 cache hit rate 约 93.35%；后段大量单轮在 95%-99%，也存在 cache break 样本掉到约 7.90%。这说明高命中可达，但必须记录 cache break 原因。
- 结合 CCB Dev Boost + GPT-5.5 中转站 + DeepSeek V4 / V4 Pro + 稳定项目上下文的使用经验，Linghun 可以把 92%-96% 作为稳定工作流下的目标观察区间，把接近 98% 作为特定样本峰值，而不是普遍承诺。
- CCB Dev Boost 文档中的局部效率口径可作为 Linghun 评测参考：并行 2-4 个独立工具时延迟降低 40%-75%；同时读 3 个文件约 9s -> 3s；同时搜索 2 个模式约 6s -> 3s。
- codebase-memory 类索引能力的局部效率参考：查函数调用链约 30-60s -> 1-3s，评估影响面约 60-120s -> 3-5s，理解项目架构约 5-10 分钟 -> 2-5s。它们是局部操作提速，不代表整体开发固定提升多少倍。

## 可用于开源介绍的文案草稿

中文：

> Linghun 采用 evidence-first coding 设计：通过代码索引、工具结果、结构化记忆、验证记录和新鲜来源约束模型，让 AI 基于事实工作，而不是凭感觉猜。这样既减少幻觉，也减少 token 浪费和重复返工。

English:

> Linghun is built around evidence-first coding. It grounds model decisions in code indexes, tool results, structured memory, verification records, and freshness-checked sources, reducing hallucinations, token waste, and rework.

## 边界

- 不能宣传为“完全无幻觉”。
- 不能宣传固定成本节省倍数，除非有对应 provider、模型、项目和账单证据。
- 不能把局部工具/索引提速写成整体开发固定提升多少倍。
- 不能把特定稳定工作流下的 90%+ cache 命中写成任意模型、任意项目的保证。
- 不能把本地估算说成 provider reported usage。
- 不能把未实现的阶段能力写成已完成。
