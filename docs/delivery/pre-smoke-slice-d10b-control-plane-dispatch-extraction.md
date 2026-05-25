# Slice D.10B: Control Plane / Slash Dispatch Extraction

## 阶段目标

从 `packages/tui/src/index.ts` 中抽离 slash command dispatch 的纯路由、格式化、discovery、suggestion 和 natural command control-plane predicate 代码，让 index.ts 从"巨型命令中心"变成更薄的 TUI runtime orchestrator。

## git status --short

```
 M packages/tui/src/index.ts
?? docs/delivery/pre-smoke-slice-d10b-control-plane-dispatch-extraction.md
?? packages/tui/src/slash-dispatch.ts
```

## 实际读取文件列表

- `packages/tui/src/index.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `docs/delivery/pre-smoke-slice-d10a-index-pure-helpers-extraction.md`（确认前置完成）

## 新模块职责说明

### `packages/tui/src/slash-dispatch.ts`（575 行）

纯函数模块，无 IO、无 TuiContext mutation、无 provider/permission 逻辑。职责：

1. **Slash-to-tool 映射**：`slashCommandToTool` — 将 `/read`、`/bash` 等映射到 ToolName
2. **Help/Discovery 格式化**：`formatCatalogHelp`、`formatSlashDiscovery`、`formatUnknownSlashCommand`、`formatHelp`
3. **Prefix suggestion**：`getSlashPrefixCandidates`、`suggestSlashCommands`、`scoreSlashSuggestion`、`boundedEditDistance`
4. **Command catalog 常量**：`COMMAND_GROUP_ORDER`、`DEFAULT_HELP_SLASHES`、`COMMAND_GROUP_LABELS`
5. **Mode behavior 格式化**：`formatModeBehavior`、`formatModeBehaviorLines`
6. **Natural command control-plane predicates**：`LOCAL_CONTROL_PLANE_CAPABILITY_IDS`、`LOCAL_READONLY_COMMANDS`、`looksLikeOrdinaryDevelopmentRequest`、`looksLikeWorkspaceTrustNaturalRequest`、`shouldDispatchLocalReadonlyIntent`、`isAllowedLocalReadonlyCommand`、`isReadonlyPermissionsStatus`、`isAllowedModeStartGate`、`isWorkspaceTrustNaturalStartGate`、`isAllowedLocalCapabilityAnswer`

## Moved Functions 表

| 函数/常量 | 状态 | 说明 |
|-----------|------|------|
| `COMMAND_GROUP_ORDER` | MOVED | 纯常量 |
| `DEFAULT_HELP_SLASHES` | MOVED | 纯常量 |
| `COMMAND_GROUP_LABELS` | MOVED | 纯常量 |
| `LOCAL_CONTROL_PLANE_CAPABILITY_IDS` | MOVED | 纯常量 |
| `LOCAL_READONLY_COMMANDS` | MOVED | 纯常量 |
| `formatCatalogHelp` | MOVED | 纯格式化 |
| `formatDefaultCommandLines` | MOVED | 内部 helper |
| `getDefaultCommandDescription` | MOVED | 内部 helper |
| `formatGroupedCommandLines` | MOVED | 内部 helper |
| `getDefaultVisibleCommandCapabilities` | MOVED | 内部 helper |
| `wrapSlashNames` | MOVED | 内部 helper |
| `formatModeBehaviorLines` | MOVED | 纯格式化 |
| `formatModeBehavior` | MOVED | 纯格式化 |
| `formatSlashDiscovery` | MOVED | 纯格式化 |
| `getSlashPrefixCandidates` | MOVED | 纯查询 |
| `formatUnknownSlashCommand` | MOVED | 纯格式化 |
| `suggestSlashCommands` | MOVED | 纯查询 |
| `scoreSlashSuggestion` | MOVED | 纯算法 |
| `boundedEditDistance` | MOVED | 纯算法 |
| `formatHelp` | MOVED | 纯格式化 |
| `slashCommandToTool` | MOVED | 纯映射 |
| `looksLikeOrdinaryDevelopmentRequest` | MOVED | 纯 predicate |
| `looksLikeWorkspaceTrustNaturalRequest` | MOVED | 纯 predicate |
| `shouldDispatchLocalReadonlyIntent` | MOVED | 纯 predicate |
| `isAllowedLocalReadonlyCommand` | MOVED | 纯 predicate |
| `isReadonlyPermissionsStatus` | MOVED | 纯 predicate |
| `isAllowedModeStartGate` | MOVED | 纯 predicate |
| `isWorkspaceTrustNaturalStartGate` | MOVED | 纯 predicate |
| `isAllowedLocalCapabilityAnswer` | MOVED | 纯 predicate |
| `handleSlashCommand` | NOT_MOVED_WITH_REASON | 主 dispatch 入口，调用所有具体 handler（IO/mutation），保留在 index.ts 作为对外入口 |
| `handleLocalControlPlaneInput` | NOT_MOVED_WITH_REASON | 调用 `handleSlashCommand`（循环依赖风险）、`routeNaturalIntent`、`appendNaturalGateDebugEvent`（session IO），保留在 index.ts |
| `handleToolCommand` | NOT_MOVED_WITH_REASON | 深度依赖 permission pipeline、runTool、background task、session store |
| `getWorkspaceTrustCommandGuard` | NOT_MOVED_WITH_REASON | 依赖 workspace trust 状态和 context mutation |
| `formatPendingNaturalCommandDetails` | NOT_MOVED_WITH_REASON | 依赖 TuiContext 和 session 状态 |
| `appendNaturalGateDebugEvent` | NOT_MOVED_WITH_REASON | session store IO |
| `handleIndexSafetyRepairContinuation` | NOT_MOVED_WITH_REASON | 重 IO（文件写入、索引刷新） |
| 所有具体 handler（handleModelCommand 等） | NOT_MOVED_WITH_REASON | 各自有复杂 IO/mutation/permission 逻辑 |
| job/runner/autopilot 状态机 | NOT_MOVED_WITH_REASON | 硬边界：本阶段不拆 |
| sendMessage/provider loop | NOT_MOVED_WITH_REASON | 硬边界：本阶段不拆 |

## index.ts 行数变化

统计命令：`git show HEAD:packages/tui/src/index.ts | wc -l` 和 `wc -l packages/tui/src/index.ts packages/tui/src/slash-dispatch.ts`

| 指标 | 值 |
|------|-----|
| Before | 17156 |
| After | 16626 |
| Net reduction | -530 |
| New module (slash-dispatch.ts) | 582 |

## 行为不变证明：关键命令覆盖表

所有 347 个测试通过，覆盖：

| 命令/路径 | 测试覆盖 |
|-----------|----------|
| `/help`、`/?` | ✓ formatCatalogHelp / formatSlashDiscovery |
| unknown command suggestions | ✓ formatUnknownSlashCommand |
| `/model`、`/model doctor` | ✓ 不泄露 key |
| `/doctor`、`/problems` readonly | ✓ |
| 自然语言"查看模型/配置模型/查看后台" | ✓ control-plane routing |
| Start Gate 确认仍严格 | ✓ exact confirmation required |
| 普通开发请求进入 model path | ✓ looksLikeOrdinaryDevelopmentRequest |
| workspace trust guard | ✓ |
| `/exit` | ✓ |

## 循环依赖检查结论

无循环依赖。`slash-dispatch.ts` 只依赖：
- `@linghun/shared`（类型）
- `@linghun/tools`（ToolName 类型）
- `./natural-command-bridge.js`（CommandCapability 类型 + getUserVisibleCommandCapabilities）
- `./runtime-status-presenter.js`（formatPermissionModeLabel）

`index.ts` 导入 `slash-dispatch.js` 的导出，不存在反向依赖。

## 测试命令和结果

```
corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts
→ 2 test files, 347 tests passed

corepack pnpm typecheck
→ tsc -b tsconfig.json — 无错误

corepack pnpm check
→ biome check . — Checked 87 files, no errors

git diff --check
→ 无 whitespace 问题
```

## 声明

- 未真实 smoke
- 未 Beta PASS
- 未 smoke-ready
- 未 open-source-ready
- 未改 provider key、slash 命令名称、别名、输出文案、风险等级
- 未改 permission / Start Gate / model setup / provider config 行为
- 未引入新依赖
- 未做性能优化
- 未拆 sendMessage 主 provider loop
- 未拆 provider stream/tool call/permission continuation
- 未拆 job/runner/autopilot/background 状态机

## 参考核对

- 本阶段实际读取了：`packages/tui/src/index.ts`、`packages/tui/src/natural-command-bridge.ts`
- 未参考外部 CCB / 社区项目文件
- 纯结构重组，无功能改动
- 明确说明未复制可疑源码实现
