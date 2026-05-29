# Phase D.14A — index.ts Modularization / Behavior-Preserving Split

> 阶段：D.14A
> 日期：2026-05-30
> 工作目录：`F:\Linghun`
> 范围：在行为不变前提下，把 `packages/tui/src/index.ts`（god file）中已成熟、边界清楚、纯逻辑的三块外移到独立模块，降低维护风险。
> 明确未做：新增功能、改 CLI/TUI 用户可见文案、改 provider/env/key/model route、改权限四档、改 D.13U/D.13V gate 语义、恢复 FreshnessLite、失败学习/反思系统、Git/worktree 新功能、UI 大改版、批量格式化无关文件、删除历史 untracked。

## 1. 改动文件列表

| 文件 | 改动 |
| --- | --- |
| `packages/tui/src/index.ts` | 删除三块已外移定义；新增对应 import + 必要 re-export。行数 16266 → 15525（-741）。 |
| `packages/tui/src/tui-messages.ts` | 新增。i18n 文案纯数据表。 |
| `packages/tui/src/deferred-tools-catalog.ts` | 新增。deferred 工具发现/描述/快照/搜索/校验（纯部分）。 |
| `packages/tui/src/index-result-presenter.ts` | 新增。索引结果摘要 + 大文件安全扫描（纯部分）。 |

`index.test.ts` **未改动**（旧测试通过 index.ts re-export 继续可用，不迁就新模块）。

## 2. 新增模块与职责

| 模块 | 行数 | 职责 | 迁出符号 | 依赖 |
| --- | --- | --- | --- | --- |
| `tui-messages.ts` | 148 | i18n 纯数据 | `MessageKey` 类型、`messages` 常量 | `Language`(@linghun/shared)。`t()` 留在 index 引用。 |
| `deferred-tools-catalog.ts` | 385 | deferred 工具目录（纯） | 类型 `DeferredToolKind/Descriptor/DiscoverySnapshot/DiscoveredDeferredToolsSummary`；`codebaseMemoryRiskClass`、`getCodebaseMemoryToolRisk`、`validateCodebaseMemoryToolExecution`、`CODEBASE_MEMORY_DESCRIPTIONS`、`list*DeferredTools`、`isLocalStdioMcpServer`、`skill/pluginManifestHasContribution`、`listDeferredTools`、`snapshotDeferredTools(+Summary)`、`sanitizeDiscoveredDeferredToolName`、`snapshotDiscoveredDeferredToolsSummary`、`searchDeferredTools`、`findDeferredTool`、`deferredToolListHashInput`、`formatDeferredToolsSystemReminder`、`isCodebaseMemoryToolName`、`summarizeDeferredToolMatch`、`parseMcpDeferredToolName` | `import type TuiContext`(index)；`truncateDisplay`(startup-runtime)；`codebaseMemoryRequiredArgs`(tui-state-runtime，复用既有 canonical，消除 index 内重复副本)；type `SkillSummary/PluginSummary/McpToolState`(tui-data-types)；`McpServerConfig`(@linghun/config)；`Language`(@linghun/shared)。 |
| `index-result-presenter.ts` | 263 | 索引结果/安全扫描（纯） | 常量 `LARGE_INDEX_*`、`INDEX_SCAN_SKIP_DIRS`；类型 `IndexSafetyResult`；`summarizeIndexResult`、`summarizeIndexSearchItem`、`summarizeNamedCounts`、`scanIndexSafety`、`readIndexIgnorePatterns`、`isIgnoredIndexPath`、`getIndexFileRisk`、`formatIndexSafetyWarning`、`formatBytes` | `truncateDisplay`(startup-runtime)；`stableStringify`(cache-freshness)；`isRecord`(tui-state-runtime canonical)；type `IndexSafetyFile`(index-runtime)；私有 `normalizePath`（沿用 index-runtime/git-runtime 既有"每模块本地副本"约定）。 |

去重收益：`codebaseMemoryRequiredArgs` 原在 index.ts 内有一份与 `tui-state-runtime.ts:873` 字节相同的私有副本；本次外移后 catalog 直接复用 canonical 版本，删除了该重复副本，未新增第三份。

## 3. 留在 index.ts 的关键主链及原因

以下强依赖 TuiContext 状态突变 / store / provider loop / permission / report guard / 循环引用风险，**只做必要 import 回填，不外移**：

- `sendMessage` / `continueModelAfterToolResults` / `streamFinalModelAnswerWithoutTools`：provider/model loop 主链。
- `runArchitectureAndCompletenessFinalGate` / `needsSolutionCompletenessReportClosure` / `updateSolutionCompletenessGate`：D.13U/D.13V gate 接入点。
- `executeSearchExtraTools` / `executeExtraTool` / `executeDeferredDispatchToolUse`：写 `context.discoveredDeferredToolNames`、spawn CLI（`runCodebaseMemoryCli` / `runMcpStdioToolCall`），有副作用——只把它们调用的纯 catalog 部分外移，本体留下并 import。
- `runCodebaseMemoryCli`：spawn + 解析，留在 index，import `validateCodebaseMemoryToolExecution`。
- `createIndexSafetyRepairPlan` / `handleIndexCommand` / `runIndexQuery`：突变 context.index，留在 index，import `scanIndexSafety` / `formatIndexSafetyWarning` / `summarizeIndexResult` / `isIgnoredIndexPath`。
- `checkResourceGuard` / `checkEvidenceGate` / `recordToolEvidence` / permission approval continuation / report guard 状态机 / `refreshWorkspaceReferenceCache` / cache freshness coordinator：直接突变 context，本轮不动。
- `t()` 与 `messages` 的消费点：留 index，import `messages` + `MessageKey`。

## 4. D.13U / D.13V gate 行为不变

- 未改 `evaluateFinalAnswerClaims` / `createFinalAnswerClaimReminder` / `runArchitectureAndCompletenessFinalGate` / `evaluateArchitectureAndCompletenessClaims` 任何调用点或函数体。
- 外移的三块均与 anti-hallucination / architecture / completeness gate 无逻辑耦合（i18n 数据、deferred 目录、索引摘要）。
- 验证：`src/index.test.ts -t "D.13U|D.13V-A|D.13V-B/C"` 27 passed；`model-loop-runtime.test.ts` 119 passed；`architecture-runtime/boundary`、`tool-output-presenter`、`runtime-status-presenter`、`workspace-reference-cache` 全绿（见第 6 节）。

## 5. 循环依赖风险与规避

- 仓库既有零循环模式：`import type { TuiContext } from "./index.js"`（9 个 sibling 已用）。**仅类型导入不产生运行时环。**
- 三个新模块对 `./index.js` 的依赖：
  - `tui-messages.ts`：无任何 `./index` 依赖。
  - `index-result-presenter.ts`：无任何 `./index` 依赖。
  - `deferred-tools-catalog.ts`：仅 `import type { TuiContext } from "./index.js"`，**零 value 导入**。
- 依赖方向严格单向：`index.ts → 新模块`、`新模块 → sibling(startup-runtime / cache-freshness / tui-state-runtime / tui-data-types / index-runtime)`。被依赖的 sibling 均不 import index（已核 `tui-state-runtime.ts` 不含 `from "./index"`）。
- `normalizePath` 不经 index 共享：index-result-presenter 自带私有副本（与 index-runtime/git-runtime/architecture-runtime 既有约定一致），避免反向依赖。
- 结论：无新增循环依赖；tsc 与 build 均通过。

## 6. 验证结果（全部必跑命令）

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | EXIT=0 |
| `corepack pnpm --filter @linghun/tui build` | EXIT=0（dist/index.js 924.38 KB，build success） |
| `corepack pnpm --filter @linghun/cli build` | EXIT=0 |
| `git diff --check` | EXIT=0 |
| `vitest src/model-loop-runtime.test.ts --run` | 119 passed |
| `vitest src/index.test.ts -t "D.13U\|D.13V-A\|D.13V-B/C" --run` | 27 passed / 290 skipped |
| `vitest src/tool-output-presenter.test.ts --run` | 15 passed |
| `vitest src/runtime-status-presenter.test.ts --run` | 4 passed |
| `vitest src/architecture-runtime.test.ts --run` | 27 passed |
| `vitest src/architecture-boundary.test.ts --run` | 31 passed |
| `vitest src/workspace-reference-cache.test.ts --run` | 14 passed |
| `vitest src/shell/view-model.test.ts -t "CommandPanel\|details\|status\|model\|Ctrl\+O" --run` | 56 passed / 211 skipped |
| `vitest --run`（完整 @linghun/tui） | **44 failed / 1696 passed**（见第 7 节） |

补充：`biome check` 三个新文件 0 error；index.ts 现存 8 个 biome lint 提示（useOptionalChain/useTemplate/noAssignInExpressions 等）经 stash 对比确认为 **D.14A 前既有**（committed HEAD 同为 8 个），本阶段未新增、不在范围内批量修。

## 7. 完整 vitest 与 baseline 44 failed 对比

- **当前 D.14A**：44 failed / 1696 passed（唯一失败文件 `src/index.test.ts > Phase 06 TUI slash commands`，`output.text` undefined 类断言——既有 runTui mock 路径问题）。
- **baseline 验证方法**：`git stash`（含 untracked 新模块）回退到 HEAD，重跑完整 vitest = **44 failed / 1696 passed**。
- **失败测试名集合对比**：提取两侧 44 个唯一失败用例名 `diff`，结果**完全一致（byte-identical）**——既无新增失败，也无被意外修复的用例。
- **新增失败**：0。
- 已 `git stash pop` 恢复 D.14A 改动；恢复后 tsc EXIT=0、git diff --check EXIT=0、index.ts 15525 行。

## 8. git status --short

```text
 M packages/tui/src/index.ts
?? .claude/
?? AGENTS.md
?? D13D_TUI_FOUNDATION_PLAN.md
?? LINGHUN_CODE_FACT_AUDIT_REPORT_2026-05-27.md
?? LINGHUN_VS_CCB_SOURCE_COMPARISON.md
?? docs/delivery/phase-13V-BC-architecture-completeness-diagnostics-closure.md
?? packages/tui/src/deferred-tools-catalog.ts
?? packages/tui/src/index-result-presenter.ts
?? packages/tui/src/tui-messages.ts
```

（`.claude/`、`AGENTS.md`、`D13D_*`、`LINGHUN_*`、`phase-13V-BC-*.md` 为本阶段之前既有 untracked，未触碰。本报告保存后新增 `?? docs/delivery/phase-14A-index-modularization.md`。）

## 9. 边界确认

- 未触碰 provider / env / key / model route 真实逻辑（外移块均为纯目录/摘要/数据）。
- 未新增第五权限模式，权限四档语义不变。
- 未做失败学习 / 反思系统。
- 未改 D.13U / D.13V gate 语义或调用点。
- 未恢复 FreshnessLite。
- 未做 Git/worktree 新功能、UI 大改版。
- 未改 CLI/TUI 用户可见文案（仅移动函数 + import/export 路径调整）。
- 未批量格式化无关文件；index.ts 既有 8 个 biome 提示保持原样。
- 未删除历史 untracked 文件，未回滚用户已有改动。
- `index.test.ts` 未改动；旧测试经 index.ts re-export 继续通过。

## 10. 下一阶段衔接

- 本阶段到此停止，**不进入 D.14B**。
- index.ts 仍约 15525 行，后续可继续按"纯 helper / presenter / formatter 先行"的同一保守路线外移（如 cache/usage 纯格式化、command panel builder 纯函数部分），为失败学习/反思系统接入预留空间，且不再继续堆 index.ts。
- 是否进入下一阶段由用户确认。

## 11. 参考核对

- 实际读取的 Linghun 文档：`docs/delivery/phase-13U-anti-hallucination-final-answer-gate.md`、`docs/delivery/phase-13V-BC-architecture-completeness-diagnostics-closure.md`、`D13T_CORE_RUNTIME_MAIN_CHAIN_AUDIT.md`、当前 `packages/tui/src/index.ts` 结构与 imports/exports。
- 实际参考的本地 CCB / 社区方案：本阶段为内部 god-file 拆分，**未读取/参考 CCB 源码**；唯一行为参考是 Linghun 仓库自身既有的零循环 sibling 模式（`import type { TuiContext }`）。
- 哪些进入自研实现：三个新模块均为"移动既有函数 + 复用既有 canonical helper"，未新增抽象、未抄录任何外部实现。
- 未复制可疑源码实现：确认。

## 12. 成品级结构化 Handoff Packet

```yaml
phase: D.14A
status: COMPLETE
next_phase: D.14B (由用户确认后开始；本阶段不进入)

scope_actually_done:
  - extracted tui-messages.ts (MessageKey + messages i18n table)
  - extracted deferred-tools-catalog.ts (pure deferred tool catalog/descriptor/snapshot/search/validate)
  - extracted index-result-presenter.ts (index result summary + large-file safety scan)
  - index.ts 16266 -> 15525 lines (-741); imports + re-exports added; no behavior change
  - removed duplicate codebaseMemoryRequiredArgs copy in index.ts (reuse tui-state-runtime canonical)

forbidden_in_this_phase_confirmed:
  - did not add features
  - did not change CLI/TUI user-visible wording
  - did not touch provider/env/key/model route logic
  - did not add a 5th permission mode; four-mode semantics unchanged
  - did not change D.13U/D.13V gate semantics or callsites
  - did not restore FreshnessLite
  - did not build failure-learning / reflection system
  - did not add Git/worktree features; no UI redesign
  - did not batch-format unrelated files; index.ts pre-existing 8 biome hints untouched
  - did not delete historical untracked files; did not modify index.test.ts

cycle_safety:
  - tui-messages.ts: no ./index import
  - index-result-presenter.ts: no ./index import
  - deferred-tools-catalog.ts: import type { TuiContext } only (zero value import)
  - dependency direction strictly index.ts -> new modules -> siblings

evidence_refs:
  - file: F:/Linghun/packages/tui/src/index.ts (modified)
  - file: F:/Linghun/packages/tui/src/tui-messages.ts (new, 148 lines)
  - file: F:/Linghun/packages/tui/src/deferred-tools-catalog.ts (new, 385 lines)
  - file: F:/Linghun/packages/tui/src/index-result-presenter.ts (new, 263 lines)

verification_results:
  tsc: EXIT=0
  tui_build: EXIT=0
  cli_build: EXIT=0
  git_diff_check: EXIT=0
  vitest_model_loop: 119 passed
  vitest_index_D13U_D13V_subset: 27 passed
  vitest_tool_output_presenter: 15 passed
  vitest_runtime_status_presenter: 4 passed
  vitest_architecture_runtime: 27 passed
  vitest_architecture_boundary: 31 passed
  vitest_workspace_reference_cache: 14 passed
  vitest_view_model_subset: 56 passed
  vitest_full: 44 failed / 1696 passed
  baseline_compare: failing-test-name set byte-identical to HEAD baseline (44=44, 0 new, 0 accidentally fixed)
  biome_new_files: 0 error
  biome_index_ts: 8 hints (pre-existing baseline, unchanged)

index_status: not refreshed in this phase (out of scope)
permission_mode: default (unchanged)
provider_model: not exercised (no real-model smoke; pure refactor)
budget_used: refactor + verification only; no model API calls
```

D.14A 到此闭合。
