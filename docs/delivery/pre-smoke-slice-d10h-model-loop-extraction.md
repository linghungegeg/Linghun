# Slice D.10H — Model Loop Extraction Feasibility + Low-Risk Helper Extraction

## git status --short 真实输出

```
M packages/tui/src/index.ts
?? packages/tui/src/model-loop-runtime.test.ts
?? packages/tui/src/model-loop-runtime.ts
```

## 实际读取文件列表

- `packages/tui/src/index.ts`（多段读取，覆盖 sendMessage、provider stream loop、tool-call round loop、tool definition helpers、freshness helpers、natural file read helpers、solution completeness helpers、drift summary 等关键区域）
- `packages/tui/src/index.test.ts`（通过运行验证）
- `packages/tui/src/permission-continuation-runtime.ts`（确认 ReportWriteGuard 类型导出可用）
- `packages/tui/src/startup-runtime.ts`（确认无循环依赖）
- `docs/delivery/pre-smoke-slice-d10g-permission-tool-continuation-extraction.md`（确认前序切片状态）
- `docs/delivery/pre-smoke-slice-d10f-startup-runtime-shell-extraction.md`（确认前序切片状态）

## sendMessage / provider loop 可行性评估

### sendMessage 主函数（行 11673-12012）

**结论：NOT_MOVED**

sendMessage 是 340 行的 async 函数，深度依赖：
- `context: TuiContext`（全局状态读写）
- `gateway.stream()`（provider 流式调用）
- `context.store.appendEvent()`（session 持久化）
- `executeModelToolUse()`（工具执行链）
- `AbortController` 生命周期管理
- `context.interrupt` 状态机
- `reportWriteGuard` 状态突变
- `architectureCard` 运行时

拆分需要注入 8+ 个回调/依赖，违反硬边界"如果拆分会导致大量 callback/deps 注入，停止"。

### provider stream for-await 主循环

**结论：NOT_MOVED**

嵌套在 sendMessage 内部，直接操作 `assistantText`、`toolCalls`、`output.write()`、`context.store`。无法独立提取。

### streamFinalModelAnswerWithoutTools（行 12110-12201）

**结论：NOT_MOVED**

依赖 `gateway.stream()`、`context.store.appendEvent()`、`recordModelUsage()`、`recordProviderFailureEvidence()`。

### continueModelAfterToolResults（行 12203-12362）

**结论：NOT_MOVED**

与 sendMessage 结构相同，依赖 gateway + context + store。

### executeModelToolUse / executeApprovedModelToolUse

**结论：NOT_MOVED**

依赖 `decidePermission()`、`context.store`、`runTool()`、`context.pendingLocalApproval` 状态机。

## 搬迁评估表

### Moved（已搬迁）

| 函数/代码段 | 原行号范围 | 依赖 | 搬迁理由 |
|---|---|---|---|
| `createToolInputSchema` | 12478-12572 | `ToolName` | 纯 schema 工厂，无状态 |
| `createModelToolDefinitions` | 12439-12440 | `builtInTools` | 纯工具列表映射 |
| `createModelToolDefinitionsForTools` | 12468-12473 | `builtInTools` | 纯映射 |
| `createModelToolDefinitionsForReportGuard` | 12445-12463 | `ReportWriteGuard`, `builtInTools` | 纯判断+映射 |
| `createToolUseDriftSummary` | 13151-13157 | `ToolName` | 纯字符串格式化 |
| `readToolInputString` | 13159-13165 | 无 | 纯输入解析 |
| `needsFreshnessLiteBoundary` | 12924-12928 | 无 | 纯正则判断 |
| `formatFreshnessLitePrimaryWarning` | 12912-12914 | `Language` | 纯 i18n 格式化 |
| `isNaturalReadFileRequest` | 13147-13149 | 无 | 纯正则判断 |
| `hasModelSynthesisIntent` | 13192-13194 | 无 | 纯正则判断 |
| `looksLikeFilePath` | 13209-13211 | 无 | 纯正则判断 |
| `extractNaturalReadPath` | 13196-13207 | `looksLikeFilePath`, `normalizeRelativePath` | 纯提取 |
| `normalizeRelativePath` | 13311-13313 | 无 | 纯路径规范化 |
| `extractFileSearchKeywords` | 13231-13261 | 无 | 纯文本解析 |
| `matchesFileKeywords` | 13263-13270 | 无 | 纯匹配 |
| `extractFileMentions` | 13102-13108 | 无 | 纯文本解析 |
| `formatFileCandidates` | 13315-13324 | `Language` | 纯 i18n 格式化 |
| `createSolutionCompletenessStatus` | 12942-12956 | 无 | 纯工厂 |
| `inferSolutionCompletenessImpactAreas` | 13026-13049 | 无 | 纯推断 |
| `formatSolutionCompletenessTrigger` | 13051-13067 | 无 | 纯格式化 |
| Types: `FreshnessLiteState`, `SolutionCompletenessClassification`, `SolutionCompletenessSeverity`, `SolutionCompletenessStatus` | — | — | 纯类型定义 |

### Not Moved（未搬迁）

| 函数/代码段 | 原因 |
|---|---|
| `sendMessage` | 核心 orchestration，依赖 gateway + context + store + AbortController |
| provider stream for-await 主循环 | 嵌套在 sendMessage 内，直接操作 output/toolCalls/assistantText |
| `streamFinalModelAnswerWithoutTools` | 依赖 gateway.stream + context.store |
| `continueModelAfterToolResults` | 与 sendMessage 结构相同 |
| `executeModelToolUse` | 依赖 decidePermission + context.store + runTool |
| `executeApprovedModelToolUse` | 依赖 runTool + context.store + backgroundTask |
| `buildModelMessagesWithRecentContext` | 依赖 context.store.resume |
| `createModelSystemPrompt` | 依赖 TuiContext 多字段读取 |
| `recordProviderEmptyResponse` | 依赖 context.store + evidence |
| `updateSolutionCompletenessGate` | 依赖 context.solutionCompleteness 突变 |
| `createFreshnessLiteState` | 依赖 context.evidence |
| `createFreshnessLiteBoundary` | 依赖 context.language |
| `recordFreshnessLiteBoundary` | 依赖 context.store |
| `resolveNaturalFileRead` | 依赖 context.recentlyMentionedFiles |
| `findNaturalFileCandidates` | 依赖 listProjectFiles (filesystem) |
| `collectSolutionCompletenessEvidenceRefs` | 依赖 context.evidence + context.permissions |
| `currentModelSupportsTools` | 依赖 context.config + getSelectedModelRuntime |
| `rememberToolFiles` | 依赖 context.recentlyMentionedFiles 突变 |

## 明确说明

**没有硬拆主循环。** sendMessage、provider stream loop、tool-call round loop、executeToolCall 执行链路全部保留在 index.ts。本切片只搬迁了 model loop 内部使用的纯 helper 函数。

## index.ts 行数变化

| 指标 | 值 |
|---|---|
| 搬迁前（D.10G 后） | 14552 行 |
| 搬迁后 | 14228 行 |
| 净减少 | 324 行 |

## 新模块行数

| 文件 | 行数 |
|---|---|
| `packages/tui/src/model-loop-runtime.ts` | 442 行 |
| `packages/tui/src/model-loop-runtime.test.ts` | 515 行 |

## 循环依赖检查结论

无循环依赖。`model-loop-runtime.ts` 只依赖：
- `@linghun/providers`（`ModelToolDefinition` 类型）
- `@linghun/shared`（`Language` 类型）
- `@linghun/tools`（`ToolName`, `builtInTools`）
- `./permission-continuation-runtime.js`（`ReportWriteGuard` 类型）

不 import `index.ts` 或任何其他 TUI 内部模块。

## 验证命令和真实结果

```
$ corepack pnpm typecheck
> tsc -b tsconfig.json
（无错误输出，退出码 0）

$ corepack pnpm exec vitest run packages/tui/src/model-loop-runtime.test.ts packages/tui/src/index.test.ts
Test Files  2 passed (2)
     Tests  266 passed (266)
  Duration  34.01s

$ corepack pnpm check
Checked 101 files in 335ms. No fixes applied.
Found 1 warning.
（warning 来自 model-doctor-runtime.test.ts 中已有的 biome-ignore 注释，非本次引入）

$ git diff --check
（无输出，无 whitespace 问题）
```

## 未真实 smoke

本切片为纯代码搬迁（move + call-site adaptation），未改变任何运行时行为。未执行真实 TUI 启动 smoke。

## 未 Beta PASS / smoke-ready / open-source-ready

## 参考核对

- 本阶段实际读取了 `packages/tui/src/index.ts` 多个关键区域。
- 未参考外部 CCB / CCB Dev Boost / 社区项目文件。
- 本阶段为纯内部代码搬迁，无外部行为参考。
- 明确说明未复制可疑源码实现。
