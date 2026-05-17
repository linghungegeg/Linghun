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

## 可用于开源介绍的文案草稿

中文：

> Linghun 采用 evidence-first coding 设计：通过代码索引、工具结果、结构化记忆、验证记录和新鲜来源约束模型，让 AI 基于事实工作，而不是凭感觉猜。这样既减少幻觉，也减少 token 浪费和重复返工。

English:

> Linghun is built around evidence-first coding. It grounds model decisions in code indexes, tool results, structured memory, verification records, and freshness-checked sources, reducing hallucinations, token waste, and rework.

## 边界

- 不能宣传为“完全无幻觉”。
- 不能宣传固定成本节省倍数，除非有对应 provider、模型、项目和账单证据。
- 不能把本地估算说成 provider reported usage。
- 不能把未实现的阶段能力写成已完成。
