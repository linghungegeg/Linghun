# Slice D.10E: Model Setup / Provider Doctor Extraction

## 目标

从 `packages/tui/src/index.ts` 中提取 model setup wizard 纯函数和 provider doctor 诊断函数到独立模块，降低 index.ts 行数，保持行为完全不变。

## git status (收口后)

```
 M packages/tui/src/index.ts
?? docs/delivery/pre-smoke-slice-d10d-index-extraction-final-audit.md
?? docs/delivery/pre-smoke-slice-d10e-model-setup-provider-doctor-extraction.md
?? packages/tui/src/model-doctor-runtime.test.ts
?? packages/tui/src/model-doctor-runtime.ts
?? packages/tui/src/model-setup-runtime.test.ts
?? packages/tui/src/model-setup-runtime.ts
```

## 已完成

- `packages/tui/src/model-setup-runtime.ts` (236 行) — model setup wizard 纯函数：解析、验证、步骤序列、格式化
- `packages/tui/src/model-doctor-runtime.ts` (434 行) — provider doctor 诊断、路由格式化、key 安全 helper
- `packages/tui/src/model-setup-runtime.test.ts` (269 行) — 37 tests
- `packages/tui/src/model-doctor-runtime.test.ts` (491 行) — 45 tests
- `packages/tui/src/index.ts` 净减 521 行 (596 删除, 75 插入)：15615 → 15094 行

## Moved Functions 表

### model-setup-runtime.ts

| 函数/类型 | 状态 |
|-----------|------|
| ModelSetupStep (type) | MOVED |
| PendingModelSetup (type) | MOVED |
| ModelSetupPrefill (type) | MOVED |
| ModelSetupMessageKey (type) | MOVED |
| getNextModelSetupStep | MOVED |
| parseModelSetupPrefill | MOVED |
| normalizeModelSetupReasoningLevel | MOVED |
| looksLikeModelSetupInput | MOVED |
| applyModelSetupValues | MOVED |
| validateModelSetupPartial | MOVED |
| getModelSetupPromptMessage | MOVED |
| formatModelSetupMessage | MOVED |
| formatModelSetupFallbackError | MOVED |
| formatModelSetupSummary | MOVED |
| formatModelSetupSaved | MOVED |

### model-doctor-runtime.ts

| 函数/类型 | 状态 |
|-----------|------|
| ModelDoctorContext (type) | MOVED |
| maskSecret | MOVED |
| getProviderKeySource | MOVED |
| readProjectSettingsApiKeyProviders | MOVED |
| readProviderEnvApiKeyProviders | MOVED |
| isModelRole | MOVED |
| getRoleRoute | MOVED |
| isDefaultExecutorRoute | MOVED |
| formatModelRouteSummary | MOVED |
| formatModelRoutes | MOVED |
| formatModelRouteDoctor | MOVED |
| diagnoseRoute | MOVED |
| diagnoseConcreteRoute | MOVED |
| getRouteDoctorLevel | MOVED |
| getRouteBlockingProblems | MOVED |
| routeSupportsCapability | MOVED |
| inferProviderForRouteModel | MOVED |
| hasOpenAiCompatibleProviderSetupProblem | MOVED |
| hasOpenAiCompatibleDoctorProblem | MOVED |
| hasOpenAiCompatiblePlaceholderProblem | MOVED |

### 保留在 index.ts 的函数

| 函数 | 原因 |
|------|------|
| startModelSetup | 依赖 TuiContext 全量字段 + IO (saveProviderEnvSetup) |
| handleModelSetupInput | 依赖 TuiContext 全量字段 + IO (saveProviderEnvSetup, loadConfig) |
| handleModelRouteCommand | 依赖 TuiContext + IO (saveModelRoute) |
| shouldOfferUserScopedModelSetup | 依赖 TuiContext + getSelectedModelRuntime |
| getStartupProjectRouteProblem | 依赖 TuiContext + IO (readFile) |
| getProjectModelRouteProblem | 依赖 TuiContext |
| getProjectModelRouteProblemForRoute | 依赖 TuiContext |
| hasSelectedProviderConfigProblem | 依赖 TuiContext + getSelectedModelRuntime |
| resolveRoleRoute | 依赖 TuiContext + 状态机逻辑 |
| getSelectedModelRuntime | 依赖 TuiContext |
| resolveInitialModel | 依赖 config 但与 TuiContext 初始化耦合 |

## 适配策略

- model-setup-runtime.ts：所有函数接收 `Language` 参数代替 `TuiContext`
- model-doctor-runtime.ts：所有函数接收 `LinghunConfig` 参数代替 `TuiContext`
- `formatModelRouteDoctor` 接收 `ModelDoctorContext` 子集接口（`config`、`projectPath`、`language`、`routeDecisions`、`lastProviderFailure`）
- index.ts 中的调用点从 `context` 改为 `context.config` 或 `context.language`
- `TuiContext` 是 `ModelDoctorContext` 的结构超集，`formatModelRouteDoctor(context)` 直接兼容

## Key 安全不变量

- `maskSecret` 只输出 `前3字符…后4字符` 或 `****`
- `formatModelSetupSummary` 只输出 `apiKey=present` 或 `apiKey=missing`，不输出原值
- `formatModelRouteDoctor` 只输出 `masked=xxx…yyyy`，不输出原值
- provider.env 路径规则和优先级未改动

## 模块边界表

| 模块 | 职责 | import index.ts? | 持有 TuiContext? | IO/副作用? |
|------|------|-----------------|-----------------|-----------|
| model-setup-runtime.ts | setup wizard 纯函数 | 否 | 否 | 否 |
| model-doctor-runtime.ts | doctor 诊断/格式化 | 否 | 否 | 是（readFile for project settings） |

## 循环依赖结论

```
index.ts ──imports──> model-setup-runtime.ts  (单向)
index.ts ──imports──> model-doctor-runtime.ts (单向)
model-doctor-runtime.ts ──imports──> @linghun/config (外部包)
model-doctor-runtime.ts ──imports──> @linghun/providers (外部包)
model-doctor-runtime.ts ──imports──> @linghun/shared (外部包)
model-setup-runtime.ts ──imports──> @linghun/config (外部包)
model-setup-runtime.ts ──imports──> @linghun/shared (外部包)
```

**结论：无运行时循环依赖。**

## 验证结果

```
corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/model-setup-runtime.test.ts packages/tui/src/model-doctor-runtime.test.ts
→ 3 test files, 279 tests passed (34.02s)

corepack pnpm typecheck
→ tsc -b tsconfig.json — 无错误

corepack pnpm check
→ Checked 95 files, no fixes applied. Found 1 warning (biome-ignore suppress comment, non-blocking).

git diff --check
→ exit=0 (no whitespace issues)
```

## 行数统计

统计命令: `wc -l`

| 文件 | 行数 |
|------|------|
| packages/tui/src/index.ts | 15094 |
| packages/tui/src/model-setup-runtime.ts | 236 |
| packages/tui/src/model-doctor-runtime.ts | 434 |
| **源码合计** | **15764** |

测试文件:

| 文件 | 行数 |
|------|------|
| packages/tui/src/model-setup-runtime.test.ts | 269 |
| packages/tui/src/model-doctor-runtime.test.ts | 491 |
| **新增测试合计** | **760** |

index.ts 净减: 15615 → 15094 = **-521 行**

## D.10 系列累计

| Slice | 新模块 | index.ts 净减 |
|-------|--------|--------------|
| D.10A | context-estimator.ts, cache-freshness.ts | -139 |
| D.10B | slash-dispatch.ts | -530 |
| D.10C | job-runtime.ts, runner-runtime.ts | -1011 |
| D.10E | model-setup-runtime.ts, model-doctor-runtime.ts | -521 |
| **合计** | **7 个新模块** | **-2201** |

index.ts 从 D.10 系列开始前的 17298 行降至 15094 行。

## 参考核对

本阶段实际读取的 Linghun 文档:
- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\packages\tui\src\index.ts`（import 区域、model setup 函数、doctor 函数、call sites）
- `F:\Linghun\packages\config\src\index.ts`（确认 ProviderEnvSetup、validateProviderEnvSetup 导出）
- `F:\Linghun\packages\providers\src\index.ts`（确认 resolveProviderBaseUrlDiagnostic、resolveProviderRuntimeContract 导出）
- `F:\Linghun\docs\delivery\pre-smoke-slice-d10d-index-extraction-final-audit.md`（前序审计结果）
- `F:\Linghun\docs\delivery\pre-smoke-slice-d10c-job-runner-background-extraction.md`（前序 extraction 模式参考）

本阶段参考:
- D.10B/C 的 wrapper 适配模式（context 子集接口）
- 现有 index.ts 中的函数实现（行为保持，签名保持）

明确声明:
- 未复制可疑源码实现
- 所有迁移函数行为与原始实现完全一致
- 仅做 move + call-site adaptation，无逻辑变更

## 关键声明

- 状态机入口和 IO 操作仍在 index.ts
- 本阶段没有行为改动
- 本阶段没有改动 provider.env 路径规则或优先级
- 本阶段没有泄露 API key
- 未真实 smoke
- 未 Beta PASS
- 未 smoke-ready
- 未 open-source-ready
