# Slice D.10F — Startup / Runtime Shell Extraction

## git status --short 真实输出

```
M packages/tui/src/index.ts
?? packages/tui/src/startup-runtime.test.ts
?? packages/tui/src/startup-runtime.ts
```

## 实际读取文件列表

- `packages/tui/src/index.ts`（多段读取，覆盖 imports、类型定义、runTui、prepareTuiStartup、startup formatters、readInputLines、utility helpers、error formatters、writeLine 等关键区域）
- `packages/tui/src/index.test.ts`（通过运行验证）

## 搬迁评估表

### Moved（已搬迁）

| 函数/代码段 | 原行号范围 | 依赖 | 搬迁理由 |
|---|---|---|---|
| `writeLine` | 15092-15094 | `Writable` | 纯 IO helper，无 TuiContext 依赖 |
| `readOutputColumns` | 2596-2599 | `Writable` | 纯 output 维度读取 |
| `readOutputRows` | 2601-2604 | `Writable` | 纯 output 维度读取 |
| `truncateDisplay` | 15016-15028 | `stripAnsi` | 纯显示截断 utility |
| `stripAnsi` | 15030-15033 | 无 | 纯 ANSI 转义清理 |
| `uniqueStrings` | 15035-15037 | 无 | 纯去重 utility |
| `sanitizeDiagnosticText` | 8493-8499 | 无 | 纯文本清洗，无状态依赖 |
| `sanitizeUserFacingError` | 14898-14904 | `sanitizeDiagnosticText` | 纯错误文本清洗 |
| `formatError` | 14870-14896 | `sanitizeUserFacingError`, `Language` | 纯错误格式化 |
| `shouldEnterProductShellCandidate` | 2571-2577 | `Readable`, `Writable`, env vars | 纯 TTY 检测 |
| `formatProviderEnvWarning` | 2349-2353 | `Language` | 纯 startup 格式化 |
| `formatProjectRouteProblem` | 2355-2369 | `Language` | 纯 startup 格式化 |
| `formatUserScopedSetupNeeded` | 2371-2387 | `Language` | 纯 startup 格式化 |
| `createShellLimitations` | 2579-2594 | `Language`, env vars | 纯 startup limitation 列表 |
| `readInputLines` + `InputKeyHandlers` type | 13569-13661 | `readline`, `Readable`, `Writable` | 纯 stdin/TTY 运行时 |
| `toInputBuffer` | 13614-13622 | 无 | 纯 Buffer 转换 |
| `decodeInput` | 13624-13630 | 无 | 纯编码检测/解码 |

### Not Moved（未搬迁）

| 函数/代码段 | 原因 |
|---|---|
| `writeStatus` | 依赖 `getSelectedModelRuntime`, `getRuntimeStatusProvider`, `formatRuntimeStatusLine` |
| `formatHomeScreen` | 依赖 `getSelectedModelRuntime`, `formatPermissionModeLabel`, `formatModeBehavior` |
| `writeLegacyStartup` | 依赖 `writeStatus`, `formatHomeScreen`, `t()`, `writeWorkspaceTrustStartupNotice` |
| `t()` + `messages` + `MessageKey` | 被全文件 364+ 处使用，与全局 i18n 状态紧密耦合 |
| `prepareTuiStartup` | 依赖 `shouldPromptForInitialLanguage`, `promptInitialWorkspaceTrust`, `getStartupProjectRouteProblem`, `hasSelectedProviderConfigProblem` |
| `runPlainTui` / `runInkShell` | 核心 orchestration，依赖 `processTuiLine`, `handleTuiKeypress`, `gateway`, `store` |
| `processTuiLine` | 依赖 `handleSlashCommand`, `sendMessage`, `handleNaturalInput` |
| `shouldEnterInkShell` | 依赖动态 import `./shell/ink-renderer.js` |
| `ShellBlockOutput` class | 依赖 `TuiContext`, `createOutputBlock` |
| `readInitialLanguageDecision` / `readInitialWorkspaceTrustDecision` | 依赖 `writeLine`（已搬）但也依赖 `createInterface`，且是 startup 交互流程核心 |

## index.ts 行数变化

| 指标 | 值 |
|---|---|
| 搬迁前 | 15094 行 |
| 搬迁后 | 14858 行 |
| 净减少 | 236 行 |

## 新模块行数

| 文件 | 行数 |
|---|---|
| `packages/tui/src/startup-runtime.ts` | 309 行 |
| `packages/tui/src/startup-runtime.test.ts` | 355 行 |

## 循环依赖检查结论

无循环依赖。`startup-runtime.ts` 只依赖：
- `node:readline`
- `node:readline/promises`
- `node:stream`
- `@linghun/shared`（仅 `Language` 类型）

不 import `index.ts` 或任何其他 TUI 内部模块。

## 签名适配说明

以下函数签名在搬迁时做了最小调整（从接受 `TuiContext` 改为接受 `Language`）：
- `formatProviderEnvWarning(reason, context)` → `formatProviderEnvWarning(reason, language)`
- `formatProjectRouteProblem(problem, context)` → `formatProjectRouteProblem(problem, language)`
- `formatUserScopedSetupNeeded(path, context)` → `formatUserScopedSetupNeeded(path, language)`
- `createShellLimitations(context, startup)` → `createShellLimitations({ language, providerEnvWarning })`

调用点已同步适配，行为完全不变。

## 验证命令和真实结果

```
$ corepack pnpm typecheck
> tsc -b tsconfig.json
（无错误输出，退出码 0）

$ corepack pnpm exec vitest run packages/tui/src/startup-runtime.test.ts packages/tui/src/index.test.ts
Test Files  2 passed (2)
     Tests  244 passed (244)
  Duration  33.73s

$ corepack pnpm check
Checked 97 files in 354ms. No fixes applied.
Found 1 warning.
（warning 来自 index.test.ts 中已有的 biome-ignore 注释，非本次引入）

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
