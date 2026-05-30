# Phase D.14A-2 — index.ts Structural Modularization / Behavior-Preserving Split

> 阶段：D.14A-2
> 日期：2026-05-30
> 工作目录：`F:\Linghun`
> 范围：在行为不变前提下，把 `packages/tui/src/index.ts` 按职责边界继续拆出 4 个稳定模块，降低 god file 风险，为后续失败学习/反思系统、AntiCodeBlob 主链闭环提供明确落点。
> 明确未做：新增功能、改 CLI/TUI 用户可见文案、改 provider/env/key/model route、改权限四档、改 D.13U/D.13V gate 语义、恢复 FreshnessLite、失败学习/反思系统、Git/worktree 新功能、UI 大改版、批量格式化无关文件、删历史 untracked。

## 1. 拆分前后 index.ts 行数

| 阶段 | 行数 |
| --- | --- |
| D.14A-1 交付（本阶段起点） | 15525 |
| D.14A-2 交付 | **14517** |
| 本阶段净减 | **-1008** |

4 个新模块合计 1061 行（含搬迁的注释与文档）。

## 2. 新增模块与职责

| 模块 | 行数 | 职责 | 迁出符号 | 依赖（全部单向 index→模块 或 模块→sibling） |
| --- | --- | --- | --- | --- |
| `tui-output-surface.ts` | 347 | 输出/transcript 写入面（基础设施） | `ShellBlockOutput` 类、`isRuntimeStatusDump`、7 个 duck-typed wrapper（`beginAssistantStream`/`writeAssistantDelta`/`endAssistantStream`/`discardAssistantBlock`/`replaceAssistantBlockContent`/`writeDiagnosticLine`/`writeErrorLine`）、`createShellBlockOutputForTest` | `createOutputBlock`(shell/view-model)、type `ProductBlockViewModel`(shell/types)、`writeLine`(startup-runtime)、`Writable`(node:stream)、type `TuiContext` |
| `final-answer-gate.ts` | 346 | D.13U/D.13V 纯判定层 | `checkClaimSupport`、`checkEvidenceGate`、`formatClaimCheck`、`createPhase15BetaVerdictScope`、`runArchitectureAndCompletenessFinalGate`、`needsSolutionCompletenessReportClosure`、`formatSolutionCompletenessReportBlock`、`createHandoffPendingItems`、`createHandoffRiskItems`、`ClaimCheck` 类型 + 私有 `hasEvidenceClaim`/`hasReportWriteEvidence`/`hasFinalAnswerReportReference`/`hasBlockingGateEvidence`/`isBetaVerdictEvidence`/`isBetaReadinessClaim` | `evaluateFinalAnswerClaims`/`evaluateArchitectureAndCompletenessClaims`/`hasArchitectureEvidenceForClaims`/`finalAnswerHasCompletenessClassification`(model-loop-runtime)、`detectArchitectureDrift`(architecture-runtime)、`messages`(tui-messages)、type `EvidenceRecord`/`VerdictEvidenceScope`(tui-data-types)、type `TranscriptEvent`(core)、type `Language`(shared)、type `TuiContext` |
| `break-cache-runtime.ts` | 258 | break-cache marker/事件/nonce/prompt-cache 字段 | break-cache 全部 paths/marker/events/nonce、`appendBreakCacheEvent`、`writeBreakCacheMarker`、`clearBreakCacheMarker`、`buildPromptCacheRequestFields`、`formatBreakCacheStatus`、`breakCacheTestHooks`、`BreakCacheTestHooks` 类型、4 consts、3 types | `diffFreshness`(cache-freshness)、type `CacheFreshness`(core)、node builtins、type `TuiContext` |
| `usage-stats-presenter.ts` | 110 | usage/stats 纯格式化 | `formatUsage`、`formatStats`、`formatRoleUsageLines`、`formatEndpointStats`、`sumCacheHistory`、`formatPercent`、`CHAT_COMPLETIONS_ENDPOINT` | `computePromptCacheHitRate`/type `CacheTurnStats`(core)、type `TuiContext` |

### 行为保留的两处签名微调（非行为变更）

- `formatBreakCacheStatus(context)` → `formatBreakCacheStatus(context, current: CacheFreshness)`：把 impure 的 `getCurrentFreshness`（强依赖 builtInTools hash / mcp / extension / workspace 子树）留在 index.ts，由调用方传入当轮 freshness，使格式化器保持纯。两处调用点（`handleBreakCacheCommand` status / --clear 分支）改为 `formatBreakCacheStatus(context, getCurrentFreshness(context))`，输出完全一致。
- `CHAT_COMPLETIONS_ENDPOINT` / `formatPercent` 移入 `usage-stats-presenter.ts` 并 export，index 通过 import 回用（usage-record builder 与 cache-command 格式化器仍用同一常量/函数，单一来源）。

## 3. 每个模块的后续归属规则

| 新增能力类型 | 应落到 |
| --- | --- |
| 模型输出 / transcript 写法 / streaming block 操作 | `tui-output-surface.ts` |
| 反幻觉 / 架构 / 完整性 / claim 判定纯逻辑（失败学习/反思系统的判定层应落这里，而非回填 index） | `final-answer-gate.ts` |
| prompt-cache / break-cache 行为 | `break-cache-runtime.ts` |
| usage / stats / token 展示 | `usage-stats-presenter.ts` |
| deferred 工具目录（D.14A-1） | `deferred-tools-catalog.ts` |
| 索引结果摘要 / 大文件安全扫描（D.14A-1） | `index-result-presenter.ts` |
| i18n 文案（D.14A-1） | `tui-messages.ts` |

## 4. 留在 index.ts 的关键主链及原因

- `sendMessage` / `continueModelAfterToolResults` / `streamFinalModelAnswerWithoutTools`：provider/model loop coordinator，直接协调 `activeAbortController` / `requestActivityPhase` / gateway.stream。
- `updateSolutionCompletenessGate`：**突变 `context.solutionCompleteness`**，被 `createModelSystemPrompt` 调用——留 index。
- `createModelSystemPrompt` / `createEvidenceSummaryForModel`：虽大体纯，但 `createModelSystemPrompt` 委托给突变型 `updateSolutionCompletenessGate`，拆出会把突变契约一起带走。本轮**保留**，列入 DEFERRED（见第 11 节）。
- `getCurrentFreshness` 及其子树（`_builtInToolsHashCache`、`stabilizeMcpToolList`、`createExtensionFreshnessSummary` 等）：强耦合 + module-level 可变缓存，留 index。
- `showCommandPanel`（写 `commandPanelState`）、`handleDetailsCommand`（写 `suppressLastFullOutputCapture`）：突变 context，留 index。`buildToggleDetailsCommandPanel`（纯）与 details 协调耦合，本轮不单拆以免半成品。
- permission approval continuation 主状态机、session/store `appendEvent` 深耦合 glue、`recordToolEvidence`、`runInkShell`/`runTui` 顶层生命周期、`TuiContext` 定义：全留。
- `evaluateFinalAnswerClaims(assistantText, context.evidence)` 的 D.13U 主链接入点仍在 `sendMessage`/`continueModelAfterToolResults` 内（未移动）。

## 5. D.13U / D.13V gate 行为不变

- gate 判定核心函数体逐字搬迁，未改任何逻辑、正则、retry 预算、降级文本。
- D.13U 主链接入（`evaluateFinalAnswerClaims` + `createFinalAnswerClaimReminder` + push 前降级）仍在 index.ts 的 `sendMessage` / `continueModelAfterToolResults` 内，未移动。
- D.13V-A streaming 清理（`discardAssistantBlock` / `replaceAssistantBlockContent`）逻辑随 `ShellBlockOutput` 整体搬到 `tui-output-surface.ts`，duck-typed wrapper 行为不变；`suppressLastFullOutputCapture` 写穿保护、Ctrl+O/details 不残留违规原文语义保持。
- D.13V-B architecture/completeness final gate（`runArchitectureAndCompletenessFinalGate`）搬到 `final-answer-gate.ts`，其在 `sendMessage`/continuation 的接入点与一次共享 retry 预算（`finalAnswerClaimRetried`）不变。
- 验证：`-t D.13U` 5 passed、`-t D.13V-A` 16 passed、`-t D.13V-B` 6 passed、`model-loop-runtime` 119 passed、`architecture-runtime/boundary` 58 passed、`tool-output-presenter` 15 passed、`runtime-status-presenter` 4 passed（见第 7 节）。

### 测试改动说明（1 处，源码位置 invariant 更新，非迁就新模块）

`index.test.ts > D.13V-B/C source invariants > "source: sendMessage 接入 architecture/completeness final gate"` 原来同时断言 index.ts 文本包含 `runArchitectureAndCompletenessFinalGate` 与 `evaluateArchitectureAndCompletenessClaims`。后者随 gate 实现移到 `final-answer-gate.ts`，故该 invariant 更新为：index.ts 仍断言 `runArchitectureAndCompletenessFinalGate`（主链接入未变），新增断言 `final-answer-gate.ts` 内含 `runArchitectureAndCompletenessFinalGate` + `evaluateArchitectureAndCompletenessClaims`（gate 实现确实在新家用到 evaluator）。这是**位置 invariant 跟随行为保留的合法迁移而更新，且对 gate 实现做了更强校验**，不是放宽断言。其余所有 `readFile("src/index.ts")` 源码 invariant（D.13U evaluateFinalAnswerClaims 接入、reuseAssistantStreamBlockId、abort/continuation 等）保持原样并全绿。

## 6. 循环依赖检查结果

- 4 个新模块对 `./index.js` **全部仅 `import type { TuiContext }`，零 value 导入**（已逐文件核验）：
  - `tui-output-surface.ts:2` `import type { TuiContext }`
  - `final-answer-gate.ts:4` `import type { TuiContext }`
  - `break-cache-runtime.ts:7` `import type { TuiContext }`
  - `usage-stats-presenter.ts:2` `import type { TuiContext }`
- 依赖方向严格单向：`index.ts → 新模块`、`新模块 → sibling(model-loop-runtime / architecture-runtime / cache-freshness / tui-messages / tui-data-types / shell / startup-runtime)`。被依赖 sibling 均不 import index。
- tsc EXIT=0、tui build EXIT=0、cli build EXIT=0 均通过 → 无运行时环。

## 7. 验证结果（全部必跑命令）

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | EXIT=0 |
| `corepack pnpm --filter @linghun/tui build` | EXIT=0（dist/index.js 925.09 KB） |
| `corepack pnpm --filter @linghun/cli build` | EXIT=0 |
| `git diff --check` | EXIT=0 |
| `vitest src/model-loop-runtime.test.ts --run` | 119 passed |
| `vitest src/index.test.ts -t D.13U --run` | 5 passed |
| `vitest src/index.test.ts -t D.13V-A --run` | 16 passed |
| `vitest src/index.test.ts -t D.13V-B --run` | 6 passed |
| `vitest src/tool-output-presenter.test.ts --run` | 15 passed |
| `vitest src/runtime-status-presenter.test.ts --run` | 4 passed |
| `vitest src/architecture-runtime.test.ts --run` | 27 passed |
| `vitest src/architecture-boundary.test.ts --run` | 31 passed |
| `vitest src/workspace-reference-cache.test.ts --run` | 14 passed |
| `vitest src/shell/view-model.test.ts -t CommandPanel --run` | 2 passed |
| `vitest --run`（完整 @linghun/tui） | **44 failed / 1696 passed**（见第 8 节） |

补充 biome：4 个新模块 0 error；`index.ts` 8 个既有提示（与 HEAD 一致，未新增）；`index.test.ts` 5 个既有提示（与 HEAD 一致，本阶段一行 invariant 改动未新增 lint）。

## 8. 完整 vitest 与 baseline 44 failed 对比

- **当前 D.14A-2**：44 failed / 1696 passed（唯一失败文件 `src/index.test.ts > Phase 06 TUI slash commands`，`output.text` undefined 类断言——既有 runTui mock 路径问题）。
- **baseline 验证方法**：`git stash`（含 index.ts / index.test.ts / 4 个 untracked 新模块）回退到 D.14A-1 HEAD 状态，重跑完整 vitest = **44 failed / 1696 passed**。
- **失败测试名集合对比**：提取两侧 44 个唯一失败用例名 `diff`，**完全一致（byte-identical）**——0 新增失败、0 意外修复。
- **新增失败**：0。
- 已 `git stash pop` 恢复；恢复后 tsc EXIT=0、git diff --check EXIT=0、index.ts 14517 行。

## 9. git status --short

```text
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
?? .claude/
?? AGENTS.md
?? D13D_TUI_FOUNDATION_PLAN.md
?? LINGHUN_CODE_FACT_AUDIT_REPORT_2026-05-27.md
?? LINGHUN_VS_CCB_SOURCE_COMPARISON.md
?? docs/delivery/phase-13V-BC-architecture-completeness-diagnostics-closure.md
?? packages/tui/src/break-cache-runtime.ts
?? packages/tui/src/final-answer-gate.ts
?? packages/tui/src/tui-output-surface.ts
?? packages/tui/src/usage-stats-presenter.ts
```

（`.claude/`、`AGENTS.md`、`D13D_*`、`LINGHUN_*`、`phase-13V-BC-*.md` 为本阶段之前既有 untracked，未触碰。本报告保存后新增 `?? docs/delivery/phase-14A-2-index-structural-modularization.md`。`index.test.ts` 的改动仅为第 5 节所述 1 处源码 invariant 更新。）

## 10. 边界确认

- 未触碰 provider / env / key / model route 真实逻辑。
- 未新增第五权限模式，权限四档语义不变。
- 未做失败学习 / 反思系统。
- 未改 D.13U / D.13V gate 语义；主链接入点与 retry 预算不变。
- 未恢复 FreshnessLite。
- 未做 Git/worktree 新功能、UI 大改版。
- 未改 CLI/TUI 用户可见文案（gate/usage/break-cache/output 文案逐字保留）。
- 未批量格式化无关文件；index.ts 8 / index.test.ts 5 既有 biome 提示保持。
- 未删历史 untracked，未回滚用户已有改动。
- `index.test.ts` 仅 1 处源码 invariant 跟随合法迁移更新（见第 5 节），未为迁就新模块放宽任何断言。

## 11. 本轮未拆（DEFERRED）及原因

| 候选 | 原因 |
| --- | --- |
| `createModelSystemPrompt` / `createEvidenceSummaryForModel`（model-prompt assembly） | `createModelSystemPrompt` 委托突变型 `updateSolutionCompletenessGate`（写 `context.solutionCompleteness`）；拆出需把突变契约一起搬，风险高于收益。建议 D.14A-3 评估“把 completeness gate 改为返回值而非突变”后再拆。 |
| slash command handlers（model/cache/memory/git/mcp/details/background/job） | 多数强突变 TuiContext 或深度依赖 coordinator（`appendEvent`/`ensureSession`/`runDurableJob*`）；硬拆会制造环或半成品。可在判定层稳定后逐域提取 presenter/builder。 |
| `buildToggleDetailsCommandPanel`（纯） | 与 `handleDetailsCommand`/`showCommandPanel`（突变）协调耦合，单拆纯函数会留下半拆边界，收益有限。 |
| `getCurrentFreshness` 子树 | module-level 可变缓存 + 大依赖子树，属 cache coordinator，留 index。 |

## 12. 参考核对

- 实际读取的 Linghun 文档：`docs/delivery/phase-14A-index-modularization.md`、`docs/delivery/phase-13U-anti-hallucination-final-answer-gate.md`、`docs/delivery/phase-13V-BC-architecture-completeness-diagnostics-closure.md`、当前 `packages/tui/src/index.ts` 及 D.14A-1 三个新模块。
- 实际参考的本地 CCB / 社区方案：本阶段为内部 god-file 结构性拆分，**未读取/参考 CCB 源码**；唯一行为参考是 Linghun 仓库自身既有的零循环 sibling 模式（`import type { TuiContext }`）。
- 哪些进入自研实现：4 个新模块均为“移动既有函数 + 复用既有 canonical helper + 1 处签名注入 freshness 参数（行为不变）”，未新增抽象、未抄录外部实现。
- 依赖图分析：用 4 个只读 Explore 子智能体并行映射候选簇的精确依赖边（纯度 / 突变 / 调用点 / 外部 importer），结论以源码事实为准，未机械照搬模块名。
- 未复制可疑源码实现：确认。

## 13. 成品级结构化 Handoff Packet

```yaml
phase: D.14A-2
status: COMPLETE
next_phase: D.14A-3 / D.14B（由用户确认后开始；本阶段不进入）

scope_actually_done:
  - extracted tui-output-surface.ts (ShellBlockOutput + 7 wrappers + isRuntimeStatusDump + test factory)
  - extracted final-answer-gate.ts (D.13U/D.13V pure predicates; mutating updateSolutionCompletenessGate stays in index)
  - extracted break-cache-runtime.ts (marker/events/nonce/prompt-cache fields; formatBreakCacheStatus takes freshness param)
  - extracted usage-stats-presenter.ts (usage/stats formatters + CHAT_COMPLETIONS_ENDPOINT + formatPercent)
  - index.ts 15525 -> 14517 lines (-1008); imports + minimal re-exports added; no behavior change
  - updated 1 source-location invariant in index.test.ts to follow the architecture-gate relocation (strengthened, not relaxed)

forbidden_in_this_phase_confirmed:
  - did not add features
  - did not change CLI/TUI user-visible wording
  - did not touch provider/env/key/model route logic
  - did not add a 5th permission mode; four-mode semantics unchanged
  - did not change D.13U/D.13V gate semantics, main-chain wiring, or retry budget
  - did not restore FreshnessLite
  - did not build failure-learning / reflection system
  - did not add Git/worktree features; no UI redesign
  - did not batch-format unrelated files; index.ts(8)/index.test.ts(5) pre-existing biome hints unchanged
  - did not delete historical untracked files

cycle_safety:
  - all 4 new modules import type { TuiContext } from "./index.js" only (zero value import)
  - dependency direction strictly index.ts -> new modules -> siblings
  - tsc + tui build + cli build all EXIT=0

evidence_refs:
  - file: F:/Linghun/packages/tui/src/index.ts (modified, 14517 lines)
  - file: F:/Linghun/packages/tui/src/tui-output-surface.ts (new, 347)
  - file: F:/Linghun/packages/tui/src/final-answer-gate.ts (new, 346)
  - file: F:/Linghun/packages/tui/src/break-cache-runtime.ts (new, 258)
  - file: F:/Linghun/packages/tui/src/usage-stats-presenter.ts (new, 110)
  - file: F:/Linghun/packages/tui/src/index.test.ts (1 source-invariant updated)

verification_results:
  tsc: EXIT=0
  tui_build: EXIT=0
  cli_build: EXIT=0
  git_diff_check: EXIT=0
  vitest_model_loop: 119 passed
  vitest_D13U: 5 passed
  vitest_D13V_A: 16 passed
  vitest_D13V_B: 6 passed
  vitest_tool_output_presenter: 15 passed
  vitest_runtime_status_presenter: 4 passed
  vitest_architecture_runtime: 27 passed
  vitest_architecture_boundary: 31 passed
  vitest_workspace_reference_cache: 14 passed
  vitest_view_model_commandpanel: 2 passed
  vitest_full: 44 failed / 1696 passed
  baseline_compare: failing-test-name set byte-identical to D.14A-1 HEAD baseline (44=44, 0 new, 0 accidentally fixed)
  biome_new_modules: 0 error
  biome_index_ts: 8 hints (pre-existing baseline, unchanged)
  biome_index_test_ts: 5 hints (pre-existing baseline, unchanged)

index_status: not refreshed in this phase (out of scope)
permission_mode: default (unchanged)
provider_model: not exercised (pure refactor; no real-model smoke)
budget_used: refactor + verification only; no model API calls

deferred_next_candidates:
  - createModelSystemPrompt assembly (blocked by mutating updateSolutionCompletenessGate; consider return-value refactor first)
  - slash command handler domains (model/cache/memory/git/mcp/details/background) as presenter/builder extractions
  - buildToggleDetailsCommandPanel (coupled with details coordinator)
```

D.14A-2 到此闭合。
