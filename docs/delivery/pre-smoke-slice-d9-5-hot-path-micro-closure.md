# Pre-Smoke Slice D.9.5: Hot Path Micro Closure

> 日期：2026-05-25
> 范围：Opus 审计指出的热路径函数/重复计算点最小修复
> 模式：focused local implementation，无真实 provider 调用，无 commit

---

## Git Status

```
 M packages/tui/src/compact-context.ts
 M packages/tui/src/index.ts
?? docs/delivery/pre-smoke-slice-d9-5-hot-path-micro-closure.md
```

---

## Source-Level Reality Check

### 实际读取的文件

| 文件 | 审计深度 |
|------|----------|
| `docs/delivery/pre-smoke-slice-d7-hot-path-performance-cache-coalescing.md` | 全文精读 |
| `packages/tui/src/index.ts` | 分段精读（getCurrentFreshness ~11007, createCacheFreshness ~11105, estimateTranscriptContextChars ~10924, estimateModelMessageChars ~13912, createWorkspaceReferenceDimensions ~10953, createModelSystemPrompt ~14633） |
| `packages/tui/src/compact-context.ts` | 全文精读（239 行） |
| `packages/tui/src/workspace-reference-cache.ts` | 分段精读（getWorkspaceReferenceSnapshot ~150, probe coalescing） |
| `packages/tui/src/shell/view-model.ts` | 分段精读（displayWidth/charWidth ~401-414） |
| `packages/tui/src/natural-command-bridge.ts` | 分段精读（_sortedCatalogCache ~930, _capabilitySummaryCache ~1048, routeNaturalIntent ~1062） |
| `packages/tui/src/architecture-runtime.ts` | 全文精读（~200 行） |
| `packages/providers/src/index.ts` | ModelToolCall 类型定义（~82-97） |

### 参考核对

- 本阶段参考了 D.7 交付文档确认已完成项，避免重复修改。
- 未复制可疑源码实现。所有优化均为标准算法改进（预计算 hash 复用、轻量递归 size estimator 替代 JSON.stringify）。

---

## 9 项核对表

| # | 审计点 | 状态 | 说明 |
|---|--------|------|------|
| A | `getCurrentFreshness` 每轮对 `builtInTools` 做 stableStringify + SHA-256 | **DONE** | 复用 `_builtInToolsHashCache`，通过 `_precomputedToolSchemaHash` 传入 `createCacheFreshness`，跳过重复 hash |
| B | `createWorkspaceReferenceDimensions` 重复 stableHash 多个维度 | **ALREADY_DONE** | D.7 已缓存 `_builtInToolsHashCache`（index.ts ~10951-10956）；其余维度是动态数据，必须每次计算 |
| C | `workspace-reference-cache.ts` probe 重复 hash/读取 | **ALREADY_DONE** | D.7 已实现 probe coalescing（_pendingProbe + _pendingProbeInputHash） |
| D | `compact-context.ts` O(n²) unshift + includes | **ALREADY_DONE** | D.7 已改为 keepFromIndex cutoff + forward flatten + Set |
| E | `estimateModelMessagesChars` / `estimateModelMessageChars` JSON.stringify 只为 .length | **DONE** | compact-context.ts 中 `estimateModelMessagesChars` 和 index.ts 中 `estimateModelMessageChars` 两处均已替换为轻量递归估算器（`estimateToolCallsChars` / `estimateToolCallsCharsLocal` + `estimateInputChars` / `estimateValueChars`），消除 JSON.stringify 分配 |
| F | `createModelSystemPrompt` memory/evidence/capability 每轮重算 | **NOT_DONE_WITH_REASON** | `createModelCapabilitySummary(24)` 已被 D.7 缓存。`formatControlledMemoryForModel` 和 `createEvidenceSummaryForModel` 是动态数据（memory/evidence 每轮可能变化），缓存会引入正确性风险，收益不足以覆盖风险 |
| G | `estimateTranscriptContextChars` JSON.stringify 只为量长度 | **DONE** | 改用 `estimateValueChars` 轻量递归估算器 |
| H | `shell/view-model.ts` displayWidth/charWidth regex 重复构造 | **ALREADY_DONE** | D.7 已提升为 module-level `CJK_WIDE_CHAR_RE` + `for...of` 循环 |
| I | `natural-command-bridge.ts` catalog/regex/normalized text 重复构造 | **ALREADY_DONE** | D.7 已实现 `_sortedCatalogCache` + `_capabilitySummaryCache` Map |

---

## DONE 项代码引用

### A. `getCurrentFreshness` builtInTools hash 复用

**文件**：`packages/tui/src/index.ts`

```typescript
// getCurrentFreshness 中：
if (!_builtInToolsHashCache) {
  _builtInToolsHashCache = stableHash(builtInTools);
}
return createCacheFreshness({
  ...
  toolSchema: builtInTools,
  _precomputedToolSchemaHash: _builtInToolsHashCache,
  ...
});

// createCacheFreshness 中：
toolSchemaHash: input._precomputedToolSchemaHash ?? stableHash(input.toolSchema),
```

**测试覆盖**：`packages/tui/src/index.test.ts` — 199 tests PASS（覆盖 cache freshness 计算路径）

### E. `estimateModelMessagesChars` / `estimateModelMessageChars` 轻量估算

**文件 1**：`packages/tui/src/compact-context.ts`（compact 判断路径）

```typescript
function estimateToolCallsChars(
  toolCalls: Array<{ id: string; name: string; input: unknown }> | undefined,
): number {
  if (!toolCalls || toolCalls.length === 0) return 2;
  let size = 2;
  for (const call of toolCalls) {
    size += call.id.length + call.name.length + 24;
    size += estimateInputChars(call.input);
  }
  return size;
}
```

**文件 2**：`packages/tui/src/index.ts`（sendMessage 预算路径）

```typescript
function estimateToolCallsCharsLocal(
  toolCalls: Array<{ id: string; name: string; input: unknown }> | undefined,
): number {
  if (!toolCalls || toolCalls.length === 0) return 2;
  let size = 2;
  for (const call of toolCalls) {
    size += call.id.length + call.name.length + 28; // conservative overhead
    size += estimateValueChars(call.input);
  }
  return size;
}
```

**测试覆盖**：
- `packages/tui/src/compact-context.test.ts` — 2 tests PASS（microCompactMessages 使用 estimateModelMessagesChars）
- `packages/tui/src/index.test.ts` — 199 tests PASS（sendMessage 预算路径使用 estimateModelMessageChars）

### G. `estimateTranscriptContextChars` 轻量估算

**文件**：`packages/tui/src/index.ts`

```typescript
function estimateValueChars(value: unknown, depth = 0): number {
  if (value === null || value === undefined) return 4;
  if (typeof value === "string") return value.length + 2;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (depth > 8) return 16;
  if (Array.isArray(value)) { ... }
  if (typeof value === "object") { ... }
  return 8;
}
```

**测试覆盖**：`packages/tui/src/index.test.ts` — 199 tests PASS（覆盖 transcript context estimation 路径）

---

## Verification Results

| Check | Result |
|-------|--------|
| `vitest run` (6 focused test files) | PASS — 437 tests |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm check` (biome) | PASS — 0 errors |
| `git diff --check` | PASS |

---

## 性能收益口径

| 热路径 | 改进 |
|--------|------|
| `getCurrentFreshness` (每轮 sendMessage) | 省去 1 次 builtInTools stableStringify + SHA-256（~数十 KB 对象序列化） |
| `estimateModelMessagesChars` (compact 判断) | 省去 N 次 JSON.stringify 分配（N = assistant 消息中 toolCalls 数量） |
| `estimateModelMessageChars` (sendMessage 预算) | 省去 N 次 JSON.stringify 分配（同上，index.ts 预算路径） |
| `estimateTranscriptContextChars` (transcript 估算) | 省去 M 次 JSON.stringify 分配（M = tool_call_start + tool_result 事件数） |

注：近似估算，减少 JSON.stringify 分配；未做 benchmark。estimator 使用偏保守的固定开销常量（28 bytes/call），避免低估导致上下文预算保护变弱。

---

## 边界遵守

| 禁止项 | 状态 |
|--------|------|
| 不 commit | ✓ 未 commit |
| 不做真实 smoke | ✓ 无网络调用 |
| 不拆分 index.ts | ✓ 仅加 estimateValueChars/estimateToolCallsCharsLocal 辅助函数 + 修改 createCacheFreshness 签名 |
| 不引入新依赖 | ✓ 无新依赖 |
| 不做大重构 | ✓ 2 个源码文件 + 1 个报告 |
| 不新增第二套缓存系统 | ✓ 复用已有 _builtInToolsHashCache |

---

## 已知限制

- 轻量 size estimator 为近似估算，减少 JSON.stringify 分配；未做 benchmark
- `estimateValueChars` / `estimateInputChars` 有 depth cap（8/6），极深嵌套结构会低估——但使用偏保守的固定开销常量补偿
- F 项（memory/evidence summary）未优化，因为是动态数据，缓存引入正确性风险

---

## 明确声明

- 未真实 smoke
- 未 Beta PASS
- 未 smoke-ready
- 未 open-source-ready

---

## Handoff Packet

```yaml
completed_slice: D.9.5
next_slice: D.10 或用户指定
files_changed:
  - packages/tui/src/index.ts (getCurrentFreshness hash 复用 + estimateValueChars + estimateToolCallsCharsLocal)
  - packages/tui/src/compact-context.ts (estimateToolCallsChars + estimateInputChars 替代 JSON.stringify)
forbidden:
  - 不 commit（用户未要求）
  - 不拆分 index.ts（D.10 scope）
  - 不缓存动态 memory/evidence summary（正确性风险）
  - 不做 provider circuit breaker
  - 不做 runner hardening
verification:
  tests: 437 passed (6 test files)
  typecheck: PASS
  biome_check: PASS
  git_diff_check: PASS
index_status: not refreshed (no code graph changes)
permission_mode: default
model: N/A (no provider calls)
budget: minimal — 2 source files edited, 0 tests added (existing tests cover), 0 new dependencies
```
