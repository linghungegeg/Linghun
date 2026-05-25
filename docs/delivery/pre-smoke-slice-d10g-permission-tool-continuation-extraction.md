# Slice D.10G — Permission / Tool Continuation Extraction

## git status --short 真实输出

```
M packages/tui/src/index.ts
?? packages/tui/src/permission-continuation-runtime.test.ts
?? packages/tui/src/permission-continuation-runtime.ts
```

## 实际读取文件列表

- `packages/tui/src/index.ts`（多段读取，覆盖 imports、类型定义、permission helpers、report write guard、remote redaction、tool name normalization 等关键区域）
- `packages/tui/src/index.test.ts`（通过运行验证）
- `packages/tui/src/startup-runtime.ts`（确认 truncateDisplay 导出可用）
- `packages/tui/src/tool-output-presenter.ts`（确认 formatToolOutput 导出可用）

## 搬迁评估表

### Moved（已搬迁）

| 函数/代码段 | 依赖 | 搬迁理由 |
|---|---|---|
| `formatPermissionDenialPrimary` | `Language` | 纯 i18n 格式化 |
| `formatPermissionDenied` | 无 | 纯字符串格式化 |
| `formatPermissionSummary` | `ToolName` | 纯摘要格式化 |
| `formatDiffBeforeWrite` | `ToolName` | 纯 diff 摘要格式化 |
| `isLowRiskWorkspaceEdit` | `ToolName` | 纯判断 helper |
| `collectInputFiles` | 无 | 纯输入解析 |
| `getHardDenyReason` | `resolve`, `relative`, `builtInTools` | 纯安全判断，无状态 |
| `findPermissionRule` | `PermissionRule` type | 纯规则匹配 |
| `isPlanAllowedTool` | `ToolName` | 纯判断 helper |
| `parsePermissionModeInput` | `isRawPermissionMode`, `normalizePermissionMode` | 纯解析 |
| `formatPermissionRules` | `PermissionState` type | 纯格式化 |
| `formatRecentDenied` | `PermissionState` type | 纯格式化 |
| `hasRepeatedPermissionDenial` | `RecentPermissionRejection` type | 纯统计判断 |
| `createReportWriteGuard` | 无 | 纯状态工厂 |
| `isReportFileWriteRequest` | 无 | 纯正则判断 |
| `extractRequestedReportPath` | 无 | 纯正则提取 |
| `normalizeReportPath` | 无 | 纯路径规范化 |
| `shouldSendReportEvidenceReminder` | `ReportWriteGuard` type | 纯状态判断 |
| `shouldSendReportWriteReminder` | `ReportWriteGuard` type | 纯状态判断 |
| `shouldSendReportFinalReferenceReminder` | `ReportWriteGuard` type | 纯状态判断 |
| `hasReportFinalAnswerShape` | 无 | 纯正则判断 |
| `createReportFinalReferenceReminder` | `Language`, `ReportWriteGuard` | 纯 i18n 格式化 |
| `createReportTaskGuard` | `Language`, `ReportWriteGuard` | 纯 i18n 格式化 |
| `createReportWriteReminder` | `Language`, `ReportWriteGuard` | 纯 i18n 格式化 |
| `doesWriteSatisfyReportGuard` | `ReportWriteGuard`, `ModelToolCallLike` | 纯判断 |
| `hasReportWriteToolCall` | `ReportWriteGuard`, `ModelToolCallLike` | 纯判断 |
| `formatModelToolOutput` | `formatToolOutput`, `ReportWriteGuard` | 纯格式化代理 |
| `normalizeToolName` | `builtInTools` | 纯查找 |
| `redactRemoteSummary` | `truncateDisplay` | 纯文本脱敏 |
| `remoteTranscriptSummary` | `redactRemoteSummary` | 纯截断+脱敏 |
| Types: `ReportWriteGuard`, `PermissionRule`, `RecentPermissionRejection`, `PermissionState`, `ModelToolCallLike` | — | 纯类型定义 |

### Not Moved（未搬迁）

| 函数/代码段 | 原因 |
|---|---|
| `handlePermissionDecision` | 依赖 `TuiContext`, `store`, `sendMessage` |
| `runPermissionFlow` | 依赖 `TuiContext`, `gateway`, `store` |
| `handleToolExecution` | 依赖 `TuiContext`, `gateway`, provider stream |
| `sendMessage` | 核心 orchestration |
| `processTuiLine` | 依赖 `handleSlashCommand`, `sendMessage` |
| Permission state machine entries | 依赖 `TuiContext` 状态读写 |
| Tool execution chains | 依赖 `gateway`, `store`, `sendMessage` |

## index.ts 行数变化

| 指标 | 值 |
|---|---|
| 搬迁前（D.10F 后） | 14858 行 |
| 搬迁后 | 14552 行 |
| 净减少 | 306 行 |

## 新模块行数

| 文件 | 行数 |
|---|---|
| `packages/tui/src/permission-continuation-runtime.ts` | 416 行 |
| `packages/tui/src/permission-continuation-runtime.test.ts` | 612 行 |

## 循环依赖检查结论

无循环依赖。`permission-continuation-runtime.ts` 只依赖：
- `node:path`
- `@linghun/shared`（`Language`, `PermissionMode`, `isRawPermissionMode`, `normalizePermissionMode`）
- `@linghun/tools`（`ToolName`, `ToolOutput`, `builtInTools`）
- `./tool-output-presenter.js`（`formatToolOutput`）
- `./startup-runtime.js`（`truncateDisplay`）

不 import `index.ts` 或任何其他 TUI 内部模块。

## 签名适配说明

所有搬迁函数保持原始签名不变。与 D.10F 不同，本次搬迁的函数已经接受 `Language` 参数而非 `TuiContext`，无需签名调整。

调用点通过 import 路径变更适配，行为完全不变。

## 类型重导出

以下类型从 `permission-continuation-runtime.ts` 重导出到 `index.ts`，保持外部消费者兼容：
- `PermissionRule`
- `RecentPermissionRejection`
- `PermissionState`

## 验证命令和真实结果

```
$ corepack pnpm typecheck
> tsc -b tsconfig.json
（无错误输出，退出码 0）

$ corepack pnpm exec vitest run packages/tui/src/permission-continuation-runtime.test.ts packages/tui/src/index.test.ts
Test Files  2 passed (2)
     Tests  268 passed (268)
  Duration  34.72s

$ corepack pnpm check
Checked 99 files in 340ms. No fixes applied.
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
