# Slice D.10A: index.ts Pure Helpers Extraction

## git status --short

```
 M packages/tui/src/index.ts
?? packages/tui/src/cache-freshness.test.ts
?? packages/tui/src/cache-freshness.ts
?? packages/tui/src/context-estimator.test.ts
?? packages/tui/src/context-estimator.ts
```

## 实际读取文件列表

- `packages/tui/src/index.ts`（17298 行 → 17161 行）
- `packages/tui/src/index.test.ts`（确认 197 测试通过）
- `docs/delivery/pre-smoke-slice-d9-5-hot-path-micro-closure.md`（未需要读取，本次无热路径改动）

## Moved Functions 表

| 函数名 | 目标模块 | 状态 |
|--------|----------|------|
| `estimateValueChars` | `context-estimator.ts` | MOVED |
| `estimateToolCallsCharsLocal` | `context-estimator.ts` | MOVED |
| `estimateModelMessageChars` | `context-estimator.ts` | MOVED |
| `estimateTranscriptContextChars` | `context-estimator.ts` | MOVED |
| `stableHash` | `cache-freshness.ts` | MOVED |
| `stableStringify` | `cache-freshness.ts` | MOVED |
| `createCacheFreshness` | `cache-freshness.ts` | MOVED |
| `diffFreshness` | `cache-freshness.ts` | MOVED |
| `createConfigFreshnessSummary` | `cache-freshness.ts` | MOVED |
| `stabilizeMcpToolList` | — | NOT_MOVED_WITH_REASON |
| `getCurrentFreshness` | — | NOT_MOVED_WITH_REASON |
| `refreshCacheFreshness` | — | NOT_MOVED_WITH_REASON |
| `createExtensionFreshnessSummary` | — | NOT_MOVED_WITH_REASON |
| `createWorkspaceReferenceDimensions` | — | NOT_MOVED_WITH_REASON |
| `createProjectRulesFreshnessSummary` | — | NOT_MOVED_WITH_REASON |
| `createMemoryFreshnessSummary` | — | NOT_MOVED_WITH_REASON |

### NOT_MOVED_WITH_REASON 说明

| 函数名 | 原因 |
|--------|------|
| `stabilizeMcpToolList` | 依赖 `truncateDisplay`，该函数在 index.ts 中被 20+ 处调用，搬出会造成循环依赖或需要额外拆分 text-utils 模块，超出本次 scope |
| `getCurrentFreshness` | 深度依赖 TuiContext（context.language, context.model, context.mcp, context.cache 等） |
| `refreshCacheFreshness` | 直接修改 context.cache.lastFreshness |
| `createExtensionFreshnessSummary` | 依赖 context.skills, context.workflows, context.hooks, context.plugins |
| `createWorkspaceReferenceDimensions` | 依赖 context + getSelectedModelRuntime + stabilizeMcpToolList |
| `createProjectRulesFreshnessSummary` | 依赖 context.memory |
| `createMemoryFreshnessSummary` | 依赖 context.memory + normalizeMemoryStatus |

## 新模块职责说明

### `packages/tui/src/context-estimator.ts`

纯函数模块，提供轻量级字符数估算能力，用于 context budget 检查热路径。无 IO、无 store、无副作用。

导出：
- `estimateValueChars(value, depth?)` — 递归估算任意值的 JSON 序列化字符数
- `estimateToolCallsCharsLocal(toolCalls?)` — 估算 toolCalls 数组的字符数
- `estimateModelMessageChars(messages)` — 估算 ModelMessage[] 的总字符数
- `estimateTranscriptContextChars(transcript)` — 估算 TranscriptEvent[] 的总字符数

依赖：`@linghun/core`（TranscriptEvent 类型）、`@linghun/providers`（ModelMessage 类型）

### `packages/tui/src/cache-freshness.ts`

纯函数模块，提供 cache freshness 计算和稳定哈希能力。无 IO、无 store、无副作用。

导出：
- `stableHash(value)` — 对任意值生成确定性 12 字符 hex 哈希
- `stableStringify(value)` — 确定性 JSON-like 序列化（key 排序）
- `createCacheFreshness(input)` — 从输入生成 CacheFreshness 对象
- `diffFreshness(previous, current)` — 比较两个 CacheFreshness，返回变化的 key 列表
- `createConfigFreshnessSummary(config)` — 从 LinghunConfig 生成用于 freshness 比较的摘要

依赖：`node:crypto`（createHash）、`@linghun/core`（CacheFreshness 类型）、`@linghun/config`（LinghunConfig 类型）

## index.ts 行数变化

| 指标 | 值 |
|------|-----|
| Before | 17298 行 |
| After | 17161 行 |
| 净减少 | 137 行 |

## 测试命令和结果

```
corepack pnpm exec vitest run packages/tui/src/index.test.ts
→ 197 passed ✓

corepack pnpm exec vitest run packages/tui/src/context-estimator.test.ts packages/tui/src/cache-freshness.test.ts
→ 37 passed ✓ (20 context-estimator + 17 cache-freshness)

corepack pnpm typecheck
→ 通过，无错误

corepack pnpm check
→ Checked 86 files. No fixes applied. 无错误

git diff --check
→ 无 whitespace 问题
```

## 循环依赖检查结论

无循环依赖。新模块 `cache-freshness.ts` 和 `context-estimator.ts` 只依赖外部包（`node:crypto`、`@linghun/core`、`@linghun/config`、`@linghun/providers`），不 import index.ts 或其他 tui 内部模块。index.ts 单向 import 这两个新模块。

## 声明

- 未真实 smoke
- 未 Beta PASS
- 未 smoke-ready
- 未 open-source-ready
- 本次仅为纯函数搬迁，行为不变，为后续 D.10B/C 拆分 control plane 和 job/runner 做准备
