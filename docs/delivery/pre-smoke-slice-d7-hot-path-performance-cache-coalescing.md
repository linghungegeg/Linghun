# Pre-Smoke Slice D.7: Hot Path Performance + Cache Coalescing

> 日期：2026-05-25
> 范围：TUI 热路径微优化 + workspace reference cache probe coalescing
> 模式：focused local implementation，无真实 provider 调用，无 commit

---

## Git Status（开始时）

```
On branch master
Changes not staged for commit:
  modified:   packages/tui/src/compact-context.ts
  modified:   packages/tui/src/index.ts
  modified:   packages/tui/src/natural-command-bridge.ts
  modified:   packages/tui/src/shell/view-model.ts
  modified:   packages/tui/src/workspace-reference-cache.ts
  modified:   packages/tui/src/workspace-reference-cache.test.ts

Untracked files:
  docs/audit/pre-real-smoke-independent-source-audit.md
  docs/delivery/pre-smoke-slice-d6-architecture-anti-code-blob-guard.md
  docs/delivery/pre-smoke-slice-d7-hot-path-performance-cache-coalescing.md
  docs/delivery/pre-smoke-slice-e-strong-foundation-integration-check.md
```

注：D.6/D.7 源码改动和未跟踪报告文件均存在。本报告不宣布 Beta PASS / smoke-ready / open-source-ready。

---

## Source-Level Reality Check

### 实际读取的文件

| 文件 | 审计深度 |
|------|----------|
| `packages/tui/src/shell/view-model.ts` | 全文精读（415 行） |
| `packages/tui/src/natural-command-bridge.ts` | 分段精读（getCommandCapabilityCatalog ~930, createModelCapabilitySummary ~1043） |
| `packages/tui/src/compact-context.ts` | 全文精读（235 行） |
| `packages/tui/src/workspace-reference-cache.ts` | 全文精读（~550 行） |
| `packages/tui/src/index.ts` | 分段精读（createWorkspaceReferenceDimensions ~10939, builtInTools 引用） |
| `packages/tui/src/shell/view-model.test.ts` | 全文精读（990 行） |
| `packages/tui/src/natural-command-bridge.test.ts` | 全文精读（578 行） |
| `packages/tui/src/compact-context.test.ts` | 全文精读（105 行） |
| `packages/tui/src/workspace-reference-cache.test.ts` | 全文精读（268 行） |
| `packages/tui/src/index.test.ts` | 通过 vitest 运行验证（185 tests） |
| `docs/delivery/pre-smoke-slice-d6-architecture-anti-code-blob-guard.md` | 前 60 行 |
| `docs/audit/pre-real-smoke-independent-source-audit.md` | 全文精读（100 行） |

### 参考核对

- 本阶段参考了 P2-3（cache debounce/recalculate）审计发现，实现了 probe coalescing 和 static hash caching。
- 未复制可疑源码实现。所有优化均为标准算法改进（Set 替代 includes、index cutoff 替代 unshift、module-level const 替代重复编译、promise coalescing）。

---

## Actual Code Changes

### 1. `packages/tui/src/shell/view-model.ts`

**优化：CJK regex 提升 + displayWidth 去中间数组**

- 将 CJK 宽字符正则从函数内部提升为 module-level `const CJK_WIDE_CHAR_RE`
- `displayWidth()` 从 `Array.from(value).reduce(...)` 改为 `for...of` 循环，消除中间数组分配
- `charWidth()` 复用同一 module-level regex

**影响**：每次 truncateMiddle / sliceDisplay 调用减少 1 次 regex 编译 + 1 次 Array.from 分配。

### 2. `packages/tui/src/natural-command-bridge.ts`

**优化：静态 catalog 排序缓存 + capability summary 缓存**

- `getCommandCapabilityCatalog()`：首次调用排序后缓存到 `_sortedCatalogCache`，后续调用直接返回浅拷贝
- `createModelCapabilitySummary(limit)`：按 limit 缓存结果到 `_capabilitySummaryCache` Map，避免重复 filter/map/join

**影响**：workspace reference 每次 probe 调用 `createModelCapabilitySummary(24)` 时直接命中缓存，省去 sort + filter + map + join。

### 3. `packages/tui/src/compact-context.ts`

**优化：消除 O(n²) unshift + O(n×m) includes**

- 原实现：reverse loop 中 `unshift` 到数组头部 → O(n²) 移位
- 新实现：reverse loop 计算 `keepFromIndex` cutoff，然后 forward flatten → O(n)
- 原实现：`messages.filter(m => !finalMessages.includes(m))` → O(n×m)
- 新实现：`new Set(finalMessages)` + `finalSet.has(message)` → O(n)

**影响**：长会话（数百条消息）的 micro compact 从 O(n²) 降为 O(n)。

### 4. `packages/tui/src/workspace-reference-cache.ts`

**优化：Probe Coalescing**

- 新增 `_pendingProbe` 和 `_pendingProbeInputHash` 字段到 `WorkspaceReferenceCache` 类型
- `getWorkspaceReferenceSnapshot` 拆分为 coalescing wrapper + `_getWorkspaceReferenceSnapshotInner`
- 并发调用相同 input hash 时复用同一 pending promise，避免重复 fs scan
- Promise resolve/reject 后自动清理 pending 状态

**影响**：快速连续的 workspace reference 请求（如 UI 重绘、多 tool 并发）只触发一次实际 probe。

### 5. `packages/tui/src/index.ts`

**优化：builtInTools static hash 缓存**

- `stableHash(builtInTools)` 在 `createWorkspaceReferenceDimensions` 中每次调用都重新计算
- 新增 `_builtInToolsHashCache` module-level 变量，首次计算后缓存
- `builtInTools` 是 import 的静态常量，运行时不变

**影响**：每次 workspace reference dimension 构建省去一次 JSON.stringify + SHA-256 计算。

---

## 新增测试

### `packages/tui/src/workspace-reference-cache.test.ts`

新增测试：`"coalesces concurrent probes with identical input into a single scan"`

- 验证 3 个并发 `getWorkspaceReferenceSnapshot` 调用只触发 1 次 scan
- 验证所有结果 key 和 hash 一致
- 验证 resolve 后 `_pendingProbe` 和 `_pendingProbeInputHash` 被清理

---

## Verification Results

| Check | Result |
|-------|--------|
| `vitest run` (4 focused test files: view-model, natural-command-bridge, compact-context, workspace-reference-cache) | PASS — 200 tests |
| `vitest run packages/tui/src/index.test.ts` | PASS — 185 tests |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm check` (biome) | PASS — 0 errors |
| `git diff --check` | PASS |

---

## 边界遵守

| 禁止项 | 状态 |
|--------|------|
| 不 commit | ✓ 未 commit |
| 不做真实 provider 调用 | ✓ 无网络调用 |
| 不拆分 index.ts | ✓ 仅加 3 行缓存逻辑 |
| 不做 provider circuit breaker | ✓ 未触碰 |
| 不做 runner hardening | ✓ 未触碰 |
| 不缓存动态 evidence/memory fragments | ✓ 仅缓存纯静态数据 |
| 不降级 freshness/hash 语义 | ✓ hash 计算结果不变，仅缓存 |

---

## 性能影响估算

| 热路径 | 改进 |
|--------|------|
| displayWidth (CJK truncation) | -1 regex compile/call, -1 Array.from alloc/call |
| createModelCapabilitySummary | 首次后 O(1) Map lookup 替代 sort+filter+map+join |
| microCompactMessages (长会话) | O(n²) → O(n) |
| workspace reference probe (并发) | N 次并发 → 1 次实际 fs scan |
| builtInTools hash | 首次后 O(1) 替代 JSON.stringify + SHA-256 |

---

## 已知限制

- 未做 benchmark 量化（需要真实长会话 + 真实项目目录）
- `_sortedCatalogCache` 和 `_capabilitySummaryCache` 无 invalidation 机制；当前 `COMMAND_CAPABILITY_DATA` 是编译时常量，运行时不变，无需 invalidation
- Probe coalescing 仅对完全相同的 input hash 生效；dimensions 变化仍触发新 probe（正确行为）

---

## Handoff Packet

```yaml
completed_slice: D.7
next_slice: D.8 或用户指定
files_changed:
  - packages/tui/src/shell/view-model.ts
  - packages/tui/src/natural-command-bridge.ts
  - packages/tui/src/compact-context.ts
  - packages/tui/src/workspace-reference-cache.ts
  - packages/tui/src/workspace-reference-cache.test.ts
  - packages/tui/src/index.ts
forbidden:
  - 不 commit（用户未要求）
  - 不拆分 index.ts（P2-1 scope）
  - 不做 provider circuit breaker（P2-5 scope）
  - 不做 runner hardening（P2-2/P2-7 scope）
verification:
  tests: 385 passed (200 focused + 185 index)
  typecheck: PASS
  biome_check: PASS
  git_diff_check: PASS
index_status: not refreshed (no code graph changes)
permission_mode: default
model: N/A (no provider calls)
budget: minimal — 5 files edited, 1 test added, 0 new dependencies
```
