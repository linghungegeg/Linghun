# Phase 6.5 — 长上下文 / 长输出 Streaming Memory Guard

## 阶段目标

补齐模型 assistant 流式长文、长上下文和 TUI 渲染防爆边界：避免"模型还在发文就内存/渲染/上下文爆掉"。不新增智能体能力、不改工作流调度、不扩展面板功能、不做杂七杂八 UI，只把已有 streaming / details / fullOutputPath / token boundary 底座接成熟。

## Source-Level Reality Check

- **provider streaming 输出链路**：`packages/providers/src/index.ts` — `OpenAiCompatibleProvider.stream()` / `parseOpenAiStream()` / `parseAnthropicMessagesStream()` 产 `assistant_text_delta` 事件，经 `ModelGateway.stream()` 透出；无字数上限。
- **TUI assistant delta 累积链路**：`packages/tui/src/index.ts` `sendMessage()` / `continueModelAfterToolResults()` / `streamFinalModelAnswerWithoutTools()` — `assistantText += visibleText` 无限拼接；`roundAssistantText` 完整 push 进 `messagesForProvider`。
- **TUI output surface**：`packages/tui/src/tui-output-surface.ts` — `ShellBlockOutput.appendAssistantDelta()` 累积 `block.fullText`，流结束才在 `compactOutputMemory()` 中触发 artifact 落盘。已有 `MAX_BLOCK_FULL_TEXT_CHARS=12_000` / `MAX_LAST_FULL_OUTPUT_CHARS=12_000` 阈值，但仅在流结束后运行。
- **max output token**：`createOptionalMaxTokens()` 只在用户显式配置 `maxOutputTokens` 时才输出 `max_tokens`/`max_output_tokens` 字段；OpenAI-compatible / chat-compatible 路径无默认上限。Anthropic 路径走 `resolveMaxOutputTokens()` 已有 `findKnownModel.maxOutputTokens` 兜底。
- **compact / transcript / handoff**：`MAX_ROUND_ASSISTANT_CHARS_FOR_PROVIDER` 不存在；`roundAssistantText` 完整进 provider 上下文、handoff memory、final answer gate。
- **stop/cancel/error**：`controller.signal.aborted` 路径清理了 `activeAbortController` / `interrupt` / `requestActivity`，但 **没有** 调 `endAssistantStream(output)` 关闭 streaming block。

### CCB 行为参考

- CCB 的 `StreamingMarkdown` 对长输出有 bounded preview + artifact 落盘，主屏只渲染 tail。
- `max_tokens` 在请求中总是存在（默认 16384 或模型上限）。
- assistant message 入 context 时有 `MAX_OUTPUT_CHARS_FOR_CONTEXT` 截断。
- 中断后清理 streaming 状态，不残留 pending block。

## 已完成功能

### 1. Provider 默认 max output tokens 边界（`packages/providers/src/index.ts`）

`createOptionalMaxTokens()` 修改：已知模型取自身 `maxOutputTokens`（如 deepseek-chat→8192），未知模型补默认 16384。

- `max_tokens`/`max_output_tokens` 字段现在**总是**出现在请求体中
- 用户显式 `request.maxOutputTokens` / `config.maxOutputTokens` 仍然优先

### 2. Assistant streaming 有界内存（`packages/tui/src/tui-output-surface.ts`）

`ShellBlockOutput.appendAssistantDelta()` 修改：
- `summary` 首行超过 500 字符时截断加"…"
- `fullText` 累积超过 32,000 字符时**立即**触发 `compactOutputMemory()`（异步 artifact 落盘），不等流结束
- 落盘后将 `block.fullText` 替换为 `<persisted-tui-block-output>` bounded preview

### 3. Transcript bounded projection（`packages/tui/src/index.ts`）

新增 `truncateRoundAssistantForProvider()`：
- `roundAssistantText` 超过 16,000 字符时截断为 head(4000) + "... 中间省略 N 个字符 ..." + tail(4000)
- 完整正文保留在 `block.fullText` / `lastFullOutput` 中
- 仅用于 `messagesForProvider.push({ role: "assistant" })` 和 `continuation.messages.push({ role: "assistant" })` 两条路径

### 4. Stop/cancel/error 清理（`packages/tui/src/index.ts`）

所有 `controller.signal.aborted` / `signal.aborted` 早期返回路径补 `endAssistantStream(output)`：
- `sendMessage()` — 2 处 abort 检查
- `streamFinalModelAnswerWithoutTools()` — 1 处 abort 检查
- 不再残留 active streaming block / pending 渲染状态

### 5. 测试覆盖（`packages/tui/src/index.test.ts` + `packages/providers/src/index.test.ts`）

| 测试 | 验证 |
|------|------|
| appendAssistantDelta 流式 compaction | 35K 字符累积后触发 artifact，fullText 被替换为 bounded preview |
| summary 超长截断 | 600 字符单行 → summary ≤504 字符 + "…" |
| 默认 max_tokens 写入 chat 请求 | custom-model → 16384；deepseek-reasoner legacy → 8192 |
| 用户显式配置优先 | maxOutputTokens=2000 覆盖默认 |
| truncateRoundAssistantForProvider 源码存在性 | 函数定义 + "中间省略" 中文文案 |
| abort 路径调 endAssistantStream | controller.signal.aborted 后紧跟 endAssistantStream |

## 使用方式

用户无新增命令。效果：
- 模型输出超长时，主屏显示有界 preview，完整输出落盘到 `.linghun/session/tui-output/<sessionId>/` 目录
- `Ctrl+O` / `/details` 可查看完整 artifact 引用路径
- 中断（Esc/Ctrl+C）后主屏立即稳定，无挂起的 streaming block

## 涉及模块

- `packages/providers/src/index.ts` — `createOptionalMaxTokens` 默认上限
- `packages/tui/src/tui-output-surface.ts` — 流式 compaction 阈值、summary 截断
- `packages/tui/src/index.ts` — `truncateRoundAssistantForProvider`、abort 清理
- `packages/tui/src/index.test.ts` — 6 个新增测试
- `packages/providers/src/index.test.ts` — 默认 max_tokens 断言更新

## 关键设计

- 复用现有 `compactOutputMemory` / `writeOutputArtifact` 基础设施，不新增第二套输出落盘
- `truncateRoundAssistantForProvider` 只裁剪入 provider context 的副本，完整正文始终在 `block.fullText` 可追溯
- Anthropic 路径不受影响（`resolveMaxOutputTokens` 已有内置上限）
- streaming compaction 阈值（32K）高于 `MAX_BLOCK_FULL_TEXT_CHARS`（12K），保证只在真正需要时才触发异步写盘

## 配置项

无新增配置项。

## 测试与验证

```
npx vitest run packages/providers/src/index.test.ts  → 134 passed
npx vitest run packages/tui/src/index.test.ts -t "Phase 6.5" → 6 passed
npx tsc --noEmit  → clean
```

## 已知限制

- 真实 TUI smoke 未能运行（`makeFakeContext()` 无真实文件系统）；compaction 内存回退路径已被测试覆盖
- `truncateRoundAssistantForProvider` 的 head/tail 比例（4K/4K）基于经验，后续可根据真实场景调整
- handoff/memory snapshot 写入路径未被本阶段专门围栏（复用已有 `compactBlockFullText` / `compactLastFullOutput` 的 12K 阈值）

## 不在本阶段处理的内容

- Agent/Workflow 长输出 — 复用同一套 `ShellBlockOutput + compactOutputMemory`
- 面板扩展、ASCII art 降噪、Composer 高级功能
- 第二套输出系统、智能体长上下文策略

## 下一阶段衔接

- Phase 15.5 剩余子阶段 / Phase 17A local durable jobs / Phase 17B remote channels
- 真实 TUI smoke 前可用 `MAX_STREAMING_FULL_TEXT_CHARS` / `MAX_ROUND_ASSISTANT_CHARS_FOR_PROVIDER` 阈值作为调节点

## 参考核对

- 本阶段读取：`packages/providers/src/index.ts`、`packages/tui/src/tui-output-surface.ts`、`packages/tui/src/index.ts`、`packages/tui/src/tui-data-types.ts`、`packages/tui/src/log-artifact.ts`、`packages/tui/src/context-estimator.ts`、`packages/config/src/index.ts`
- 行为参考 CCB：`StreamingMarkdown` bounded preview / artifact 落盘、`max_tokens` 总是存在、`MAX_OUTPUT_CHARS_FOR_CONTEXT` 截断、中断清理 streaming 状态
- 未复制 CCB 可疑源码：所有实现基于 Linghun 已有基础设施（`compactOutputMemory`、`writeOutputArtifact`、`ShellBlockOutput`），仅补齐阈值和触发时机

## Handoff Packet

```json
{
  "verdict": "PASS",
  "scope": "Phase 6.5: 长上下文/长输出 Streaming Memory Guard — provider max_tokens 默认边界、streaming 有界内存、transcript bounded projection、stop/cancel 清理",
  "changedFiles": [
    "packages/providers/src/index.ts",
    "packages/providers/src/index.test.ts",
    "packages/tui/src/tui-output-surface.ts",
    "packages/tui/src/index.ts",
    "packages/tui/src/index.test.ts"
  ],
  "validation": {
    "typecheck": "clean",
    "providerTests": "134 passed",
    "phase65Tests": "6 passed",
    "preExistingFailures": "8 (unrelated Phase 06 Agent/Workflow tests, confirmed by git stash)"
  },
  "risk": {
    "P0": [],
    "P1": ["真实 TUI smoke 未跑；compaction 已在内存回退路径验证"],
    "P2": ["head/tail 比例后续可按需调整"]
  },
  "runtimeFacts": {
    "model": "claude-sonnet-4-6",
    "provider": "claude",
    "permissionMode": "default",
    "indexStatus": "not checked (fast path)"
  },
  "nextAction": "用户确认是否进入下一阶段（Phase 15.5剩余/Phase 17A/17B）"
}
```
