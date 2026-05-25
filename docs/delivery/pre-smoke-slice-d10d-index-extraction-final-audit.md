# Slice D.10D: Index Extraction Final Audit / Boundary Check

## git status --short

```
(clean — no uncommitted changes)
```

## 实际读取文件列表

- `docs/delivery/pre-smoke-slice-d10a-index-pure-helpers-extraction.md`
- `docs/delivery/pre-smoke-slice-d10b-control-plane-dispatch-extraction.md`
- `docs/delivery/pre-smoke-slice-d10c-job-runner-background-extraction.md`
- `packages/tui/src/index.ts`（import 区域 L1-280、sendMessage L12272、handleSlashCommand L2607、job state machine L6006-6530）
- `packages/tui/src/context-estimator.ts`（全文 63 行）
- `packages/tui/src/cache-freshness.ts`（全文 95 行）
- `packages/tui/src/slash-dispatch.ts`（全文 582 行）
- `packages/tui/src/job-runtime.ts`（全文 595 行）
- `packages/tui/src/runner-runtime.ts`（全文 726 行）
- `packages/tui/src/index.test.ts`（头部 import 确认）

## D.10A/B/C 结果总表

| Slice | 目标 | 新模块 | index.ts 净减 | 状态 |
|-------|------|--------|--------------|------|
| D.10A | 纯 helper 提取 | context-estimator.ts, cache-freshness.ts | -139 | DONE |
| D.10B | Control plane dispatch 提取 | slash-dispatch.ts | -530 | DONE |
| D.10C | Job/Runner background 提取 | job-runtime.ts, runner-runtime.ts | -1011 | DONE |
| **合计** | | **5 个新模块** | **-1680** | |

## 模块边界表

| 模块 | 职责 | import index.ts? | 持有 TuiContext? | IO/副作用? |
|------|------|-----------------|-----------------|-----------|
| context-estimator.ts | 字符数估算 | 否 | 否 | 否 |
| cache-freshness.ts | hash/freshness summary | 否 | 否 | 否（仅 crypto） |
| slash-dispatch.ts | slash/help/suggestion/control-plane predicate | 否 | 否 | 否 |
| job-runtime.ts | job helper/fs/format/parse | type-only（DurableJobState 等类型） | 否（通过 JobContext 子集） | 是（fs 读写） |
| runner-runtime.ts | runner resolution/lifecycle helper | type-only（ApprovedRunnerJobSpec 等类型） | 否（通过 RunnerContext 子集） | 是（spawn/fs） |

## 行数统计表

统计命令：`wc -l`

| 文件 | 行数 | D.10 报告声称 | 差异 |
|------|------|-------------|------|
| packages/tui/src/index.ts | 15615 | 15615 (D.10C) | 0 |
| packages/tui/src/context-estimator.ts | 63 | — (D.10A 未声称具体行数) | — |
| packages/tui/src/cache-freshness.ts | 95 | — (D.10A 未声称具体行数) | — |
| packages/tui/src/slash-dispatch.ts | 582 | 582 (D.10B) | 0 |
| packages/tui/src/job-runtime.ts | 595 | 595 (D.10C) | 0 |
| packages/tui/src/runner-runtime.ts | 726 | 726 (D.10C) | 0 |
| **源码合计** | **17676** | | |

测试文件行数：

| 文件 | 行数 |
|------|------|
| packages/tui/src/index.test.ts | 9021 |
| packages/tui/src/context-estimator.test.ts | 149 |
| packages/tui/src/cache-freshness.test.ts | 236 |
| packages/tui/src/natural-command-bridge.test.ts | 624 |
| packages/tui/src/job-runtime.test.ts | 461 |
| packages/tui/src/runner-runtime.test.ts | 220 |
| packages/tui/src/shell/view-model.test.ts | 989 |
| **测试合计** | **11700** |

### 行数口径小误差说明

D.10A 报告声称 "Before 17298 → After 17159"，D.10B 报告声称 "Before 17156"（差 3 行）。这是 D.10A commit 后到 D.10B 开始前可能有微小 import 调整导致的口径偏差，不影响最终结论。当前 index.ts 15615 行与 D.10C 报告完全一致。

## 循环依赖/导入方向结论

```
index.ts ──imports──> context-estimator.ts     (单向)
index.ts ──imports──> cache-freshness.ts       (单向)
index.ts ──imports──> slash-dispatch.ts        (单向)
index.ts ──imports──> job-runtime.ts           (单向)
index.ts ──imports──> runner-runtime.ts        (单向)
job-runtime.ts ──imports──> runner-runtime.ts  (单向，仅 formatApprovedRunnerSpecLine)
runner-runtime.ts ──imports──> job-runner-presenter.ts (单向，仅 formatJobRunnerInline)
```

**type-only 依赖（不造成运行时循环）：**
- `job-runtime.ts` → `import type { ... } from "./index.js"` — AgentType, DurableJobAgent, DurableJobAgentStatus, DurableJobState, DurableJobStatus
- `runner-runtime.ts` → `import type { ... } from "./index.js"` — ApprovedRunnerJobSpec, DurableJobState, NativeRunnerLifecycleStatus, NativeRunnerResolutionStatus

**结论：无运行时循环依赖。** type-only import 在 TypeScript 编译后被擦除，不产生 JS 运行时 require/import。长期来看，如果这些类型被提取到独立 types 文件中会更清晰，但当前不构成正确性风险。

## 残留文件检查结论

```
find packages/tui/src -maxdepth 1 -name "*.bak" -o -name "*.tmp" -o -name "*old*" -o -name "*backup*" -o -name "*copy*"
→ 无结果
```

**结论：无残留临时文件。**

## 行为不变覆盖表

| 路径/能力 | index.ts 保留? | 测试覆盖? |
|-----------|---------------|-----------|
| sendMessage / provider loop | ✓ L12272 | ✓ index.test.ts |
| handleSlashCommand | ✓ L2607 (export) | ✓ index.test.ts |
| handleLocalControlPlaneInput | ✓ L11944 | ✓ index.test.ts |
| handleToolCommand | ✓ L14225 | ✓ index.test.ts |
| handleJobCommand | ✓ L6006 | ✓ index.test.ts |
| createDurableJob | ✓ L6095 | ✓ index.test.ts |
| resumeDurableJob | ✓ L6171 | ✓ index.test.ts |
| transitionDurableJob | ✓ L6222 | ✓ index.test.ts |
| hydrateDurableJobBackgroundTasks | ✓ L6264 | ✓ index.test.ts |
| recoverDurableJobForContext | ✓ L6272 | ✓ index.test.ts |
| runDurableJobLiteTick | ✓ L6325 | ✓ index.test.ts |
| applyDurableJobBudgetStop | ✓ L6530 | ✓ index.test.ts |
| persistDurableJobProgress | ✓ L6497 | ✓ index.test.ts |
| slash/help/suggestion routing | slash-dispatch.ts (纯函数) | ✓ natural-command-bridge.test.ts + index.test.ts |
| /model doctor / provider key 安全 | index.ts | ✓ index.test.ts |
| Start Gate 确认 | index.ts | ✓ index.test.ts |
| natural command bridge | natural-command-bridge.ts | ✓ natural-command-bridge.test.ts |
| job cancel/timeout/stale/non-PASS | index.ts + job-runtime.ts | ✓ job-runtime.test.ts + index.test.ts |
| runner cancel/timeout/fallback | index.ts + runner-runtime.ts | ✓ runner-runtime.test.ts + index.test.ts |
| context estimator (budget hot path) | context-estimator.ts | ✓ context-estimator.test.ts |
| cache freshness | cache-freshness.ts | ✓ cache-freshness.test.ts |
| shell view-model | shell/view-model.ts | ✓ shell/view-model.test.ts |

## 测试命令和结果

```
corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/context-estimator.test.ts packages/tui/src/cache-freshness.test.ts packages/tui/src/natural-command-bridge.test.ts packages/tui/src/job-runtime.test.ts packages/tui/src/runner-runtime.test.ts packages/tui/src/shell/view-model.test.ts
→ 7 test files, 492 tests passed (34.15s)

corepack pnpm typecheck
→ tsc -b tsconfig.json — 无错误

corepack pnpm check
→ biome check . — Checked 91 files, no fixes applied

git diff --check
→ exit=0 (no whitespace issues)
```

## NOT-DO / out-of-scope

- provider loop extraction — 不在 D.10 scope
- Job Object / process guard — 不在 D.10 scope
- TUI visual audit — 不在 D.10 scope
- real smoke — 不在 D.10 scope
- type-only import 提取到独立 types 文件 — 可选优化，不影响正确性
- D.10A 与 D.10B 之间 3 行口径偏差修正 — 不影响结论，不修改历史报告

## 声明

- 未真实 smoke
- 未 Beta PASS
- 未 smoke-ready
- 未 open-source-ready
- 未修改任何源码（审计结果：无 bug 需修复）
- 未删除任何文件
- 未发现残留临时文件
- 未发现运行时循环依赖
- 未发现行为漂移
- 所有 492 个测试通过
- typecheck / biome check / git diff --check 全部通过
