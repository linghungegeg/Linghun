# Phase D.14A-R-Fix — Source Wiring P1 Closure

> 阶段：D.14A-R-Fix
> 日期：2026-05-30
> 工作目录：`F:\Linghun`
> 类型：源码级 P1 闭环修复（不是新阶段开发、不是 D.14B）。
> 范围：仅修复 `docs/delivery/phase-14A-R-source-wiring-closure-audit.md` 登记的 7 个 P1。
> 明确未做：D.14B、失败学习/反思系统、新功能扩展、provider/env/key/model route 真实选择逻辑变更、新权限模式、D.13U/D.13V gate 判定语义变更、恢复 FreshnessLite、Git/worktree 新功能、UI 大改版、删除历史 untracked。

## 1. P1 修复状态表

| # | P1 | 状态 | 类型 | 主源码位置 |
| --- | --- | --- | --- | --- |
| P1-1 | continuation 缺 Solution Completeness closure 镜像 | fixed | runtime 行为 | `packages/tui/src/index.ts`（`continueModelAfterToolResults` final append 后） |
| P1-2 | 合成 `/verify smoke` 被投影成 real-smoke | fixed | runtime 行为（分级口径） | `verification-command-runtime.ts`、`terminal-readiness-runtime.ts`、`tui-data-types.ts` |
| P1-3 | headless CLI `linghun model` 输出 raw base_url | fixed | 展示口径 | `apps/cli/src/cli.ts`（`formatModelInfo`） |
| P1-4 | Bash tool start banner 可能泄漏 secret/private URL | fixed | 展示口径（脱敏） | `packages/tui/src/tool-output-presenter.ts`（`formatToolStart`） |
| P1-5 | provider readiness “配置存在即 pass” 误导 | fixed | 展示口径 | `terminal-readiness-presenter.ts`、`terminal-readiness-runtime.ts` |
| P1-6 | live provider smoke 默认 placeholder model | fixed | 脚本行为（fail-fast） | 根 `package.json`（`smoke:live-provider`） |
| P1-7 | AntiCodeBlob 状态收口 | fixed（选 A：prompt-only 明确化） | 文档/口径 + 测试锁定 | `architecture-runtime.ts`（澄清注释）+ `index.test.ts`（锁定测试） |

## 2. 每个修复的源码位置与调用路径

### P1-1 — continuation Solution Completeness closure 镜像（runtime 行为）

- 位置：`packages/tui/src/index.ts` 内 `continueModelAfterToolResults`，在 `assistant_text_delta` append 之后追加。
- 调用路径：`executeModelToolUse` pending approval → `continueModelAfterToolResults` → final assistant append → 新增 closure。
- 逻辑：与 `sendMessage` 路径完全一致，复用既有 `needsSolutionCompletenessReportClosure(context, assistantText)` 与 `formatSolutionCompletenessReportBlock(context)`，并 `appendSystemEvent(..., "warning")`。
- gate 顺序保证：closure 位于安全 final answer 入 transcript **之后**、D.13U/D.13V retry/downgrade（`buildDowngradedFinalAnswer` / `buildExtendedDowngradedFinalAnswer`）**之后**。未改动 D.13U/D.13V 的 retry/downgrade 顺序或判定语义。closure 只在 `classificationRequired && 文本缺 single_issue/systemic_gap` 时触发，且只对已放行/已降级后的 `assistantText` 运行，不会让违规原文进入 transcript。

### P1-2 — 合成 smoke 不再升级 real-smoke（runtime 行为：分级口径）

- 数据结构：`packages/tui/src/tui-data-types.ts` 的 `VerificationStep` 新增可选 `synthetic?: boolean`。`synthetic` 经 `VerificationCommandResult`（`...step` 展开）保留到结果。
- 标记点：`verification-command-runtime.ts` 的 `createVerificationPlan`：
  - smoke 模式合成 `node -e "console.log('linghun verify smoke')"` → `synthetic: true`；
  - 无脚本降级 `node --version` → `synthetic: true`。
  - reason 文案明确“合成 smoke … 不是真实 provider/TUI/render/report 主链 smoke”。
- 分级点：`terminal-readiness-runtime.ts` 的 `createVerificationLevelForReadiness`，`smokePassed` 增加 `&& c.synthetic !== true`，使合成 smoke pass 不再进入 `realProcessObserved`，从而不被 `verification-level.ts` 分级为 `real-smoke`。
- 真实 smoke（非合成、`synthetic !== true`）仍可升级 real-smoke，`/verify` 全流程可用性不变。partial/stale/mock/runnerError 仍不升级（沿用既有 `simulatedOrPartial` / `fallbackUsed` 逻辑）。
- 未改 `verification-level.ts` 分级器本身的语义。

### P1-3 — CLI `linghun model` 不再输出 raw base_url（展示口径）

- 位置：`apps/cli/src/cli.ts` 的 `formatModelInfo`，`base_url：${baseUrl ?? "未配置"}` → `base_url：${baseUrl ? "present" : "missing"}`。
- 调用路径：`linghun model`（无子命令）与 `linghun model set <model>` 输出共用此函数。
- `model doctor` 分支未改动：它已是安全显式诊断（`baseUrl=present/missing` + query/fragment / endpoint suffix 警告 + masked apiKey），允许保留。未触碰 provider/env/key/model route 真实选择逻辑。

### P1-4 — Bash tool start banner 脱敏（展示口径）

- 位置：`packages/tui/src/tool-output-presenter.ts` 的 `formatToolStart`，新增本地 `redactBannerArg(value)`，在 clamp 前对所有工具 arg 统一脱敏。
- 调用路径：approved model/slash tool → `formatToolStart` → `writeLine`（主屏 + `lastFullOutput`），两处调用点（`index.ts:6691`、`index.ts:7261`）只消费返回字符串，未改。
- 覆盖：`Bearer <token>`、`Authorization: <value>`、`<NAME>_API_KEY/TOKEN/SECRET/KEY/PASSWORD=...` 环境变量赋值、`api_key=/apikey=/api-key=`、`token=`、URL 中 `key=`、`sk-` 长 token。脱敏先于 120 字 clamp。普通命令（如 `git status`）不被破坏。diagnostics/details/tool_result 仍保留必要原始信息（未改其它路径）。

### P1-5 — provider readiness 无真实 live evidence 不 pass（展示口径）

- 类型：`terminal-readiness-presenter.ts` 的 `TerminalReadinessView` 新增 `providerLiveVerified: boolean`。
- 取值：`terminal-readiness-runtime.ts` 的 `createTerminalReadinessView`：`providerLiveVerified = context.cache.history.length > 0 && !context.lastProviderFailure`。cache history 仅由真实 provider `usage` 事件写入，因此它代表“本会话观察到真实 provider 响应”。
- 展示：`createReadinessItems` 的 `provider/model` 行：
  - `providerFailure` → `fail`；
  - `provider === "unknown"` → `unknown`；
  - 已配置但未 live-verified → `partial`，文案 `configured <p>/<m>; not live-verified`；
  - live-verified → `pass`，文案 `live-verified <p>/<m>`。
- 未改变 provider route 真实逻辑，只改 readiness/status/doctor 展示口径。

### P1-6 — live provider smoke 不再默认 placeholder model（脚本行为）

- 位置：根 `package.json` 的 `smoke:live-provider`。
- 变更：去掉 `LINGHUN_OPENAI_MODEL || 'openai-compatible-model'` 与 `LINGHUN_DEEPSEEK_MODEL || 'deepseek-chat'` 默认；改为：
  - 无 key → SKIPPED（exit 0，行为不变）；
  - 有 `LINGHUN_OPENAI_API_KEY` 但缺 `LINGHUN_OPENAI_MODEL` → fail-fast（exit 1，明确错误，不发请求、不用 placeholder）；
  - 有 `LINGHUN_DEEPSEEK_API_KEY`（且非 openai 分支）但缺 `LINGHUN_DEEPSEEK_MODEL` → fail-fast（exit 1）；
  - 显式模型存在才用该模型真实请求 provider。
- 未硬编码任何商业模型作为默认。

### P1-7 — AntiCodeBlob 收口（选 A：prompt-only 明确化）

- 选择：**A（prompt-only 明确化）**，符合用户“倾向 A 或非常保守的 B；不做大范围架构扫描器”。
- 源码事实：`architecture-boundary.ts` 的检测器（`checkBoundaries` / `checkFileBoundaries` / `validateChangeDeclaration` 等）在 `index.ts` 仅被 re-export，未在任何 Write/Edit/MultiEdit/Bash/final-answer 主链调用（已 grep 确认 0 调用）。AntiCodeBlob/EngineeringStructure 仅作为 prompt/directive 文案存在。
- 变更：`architecture-runtime.ts` 的 `createArchitectureRuntimeDirective` 顶部新增澄清注释，明确 AntiCodeBlob/LegacyLargeFileDebt 是 prompt-only guidance，不是 hard gate / pre-write 拦截 / linter / 权限拒绝，主链不会自动调用 boundary 检测器阻断写入。
- 未改 user-visible directive 文案语义；既有口径（`不是违规`、`not a violation`、`does not grant write permission`）保持。

## 3. 展示口径修复 vs runtime 行为修复

- 纯展示口径修复（不改运行时决策，只改输出/分类标签）：P1-3（CLI base_url）、P1-4（banner 脱敏）、P1-5（provider readiness 状态/文案）。
- runtime 行为修复（改变运行时产出或分级）：
  - P1-1：continuation 路径现在会真实追加 closure block（行为新增，限定在安全 final answer 后）。
  - P1-2：合成 smoke 现在被 readiness 分级器拒绝升级 real-smoke（分级结果改变）。
  - P1-6：脚本行为改变（缺模型 fail-fast，不再发 placeholder 请求）。
- 文档/口径 + 测试锁定：P1-7（无运行时阻断逻辑变化，仅澄清注释 + 锁定测试确认它仍是 prompt-only）。

## 4. AntiCodeBlob 最终选择

**prompt-only 明确化（选 A）**。当前没有 AntiCodeBlob hard gate；本轮不新增。已在 `architecture-runtime.ts` 加源码注释明确其 prompt-only 性质，并新增锁定测试（见 §5）确认：

- AntiCodeBlob/EngineeringStructure 只出现在 prompt/directive；
- directive 含 `prompt-only` 与“不是 hard gate / 不会自动阻断”表述；
- `index.ts` 主链不调用 `checkBoundaries` / `checkFileBoundaries` / `validateChangeDeclaration`；
- `architecture-boundary.ts` 自声明 `Does NOT modify any files`。

任何“AntiCodeBlob 会阻断写入/在运行时强制架构边界”的说法都不准确。

## 5. 测试

新增/扩展测试（均为针对性，锁定真实状态）：

| 文件 | 新增/扩展 | 覆盖 P1 |
| --- | --- | --- |
| `packages/tui/src/index.test.ts` | continuation 镜像 closure 源码不变量 + closure helper 行为（缺分类才追加/已分类不追加/closure 在 append 与 downgrade 之后） | P1-1 |
| `packages/tui/src/index.test.ts` | 合成 smoke pass 不升级 real-smoke / 真实 smoke 才升级 / 合成+partial 不升级 / `/verify` 合成标记源码不变量 | P1-2 |
| `packages/tui/src/index.test.ts` | provider readiness：无 live evidence 不 pass、live-verified 才 pass、last failure → fail、unknown provider → unknown | P1-5 |
| `packages/tui/src/index.test.ts` | AntiCodeBlob prompt-only 锁定（不是 hard write gate、主链不调 boundary 检测器） | P1-7 |
| `packages/tui/src/tool-output-presenter.test.ts` | banner 脱敏 6 例（Bearer / api_key / URL key= / Authorization / 环境变量赋值 / 普通 `git status` 不被破坏） | P1-4 |
| `apps/cli/src/main.test.ts` | `linghun model` 不含 raw `https://...`、含 `base_url：present` | P1-3 |

## 6. 验证命令和结果

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | PASS, exit 0 |
| `corepack pnpm --filter @linghun/tui build` | PASS, exit 0 |
| `corepack pnpm --filter @linghun/cli build` | PASS, exit 0 |
| `git diff --check` | PASS, exit 0 |
| `corepack pnpm --filter @linghun/tui exec vitest src/model-loop-runtime.test.ts --run` | PASS, 119 passed |
| `... vitest src/tool-output-presenter.test.ts --run` | PASS, 21 passed（含 P1-4 新增 6） |
| `... vitest src/verification-level.test.ts --run` | PASS, 34 passed |
| `... vitest src/guard-wiring.test.ts --run` | PASS, 29 passed |
| `... vitest src/architecture-runtime.test.ts --run` | PASS, 27 passed |
| `... vitest src/architecture-boundary.test.ts --run` | PASS, 31 passed |
| `... vitest src/workspace-reference-cache.test.ts --run` | PASS, 14 passed |
| `... vitest src/index.test.ts -t D.13U --run` | PASS, 5 passed |
| `... vitest src/index.test.ts -t D.13V-A --run` | PASS, 20 passed（baseline 16，+4 P1-2） |
| `... vitest src/index.test.ts -t "D.13V-B/C" --run` | PASS, 9 passed（baseline 6，+3：P1-1×2 / P1-7×1） |
| `... vitest src/index.test.ts -t "provider readiness" --run` | PASS, 1 passed |
| `... vitest src/index.test.ts -t closure --run` | PASS, 2 passed |
| `corepack pnpm --filter @linghun/tui exec vitest --run`（全量） | 44 failed / 1710 passed |
| `corepack pnpm --filter @linghun/cli exec vitest src/main.test.ts --run`（隔离 config dir） | 我扩展的 `shows and diagnoses the current model` PASS |

### 6.1 全量 @linghun/tui 失败 diff（不是只报数字）

- baseline（D.14A-3 交付）：44 failed / 1696 passed。
- 本轮：44 failed / **1710 passed**（+14 全部为本轮新增/扩展 passing 测试：P1-1×2、P1-2×4、P1-5×1、P1-4×6，与全量 passing 增量一致）。
- 新增失败：**0**。
- failure-name diff：当前 44 个失败全部落在 `src/index.test.ts > Phase 06 TUI slash commands` 既有 runTui-mock baseline 组；无任何本轮新增测试出现在失败集合。
- 重点核对：两个名字含 “readiness” 的失败（`does not intercept ordinary development requests with the readiness doctor`、`answers composite Chinese and English readiness locally`）已通过 `git stash`（移除本轮全部改动）复跑确认在 baseline 同样失败，失败原因为 runTui-mock 的工作区信任/非交互输入路径（`工作区信任尚未记录。非交互输入不会…`），与本轮 provider readiness 展示口径改动无关。

### 6.2 CLI 失败说明

- `apps/cli/src/main.test.ts` 在普通环境下有 3 个 `model doctor` 相关失败，根因是这些 doctor 测试未隔离 `LINGHUN_CONFIG_DIR`，读到了本机真实 `~/.linghun/provider.env`（openai-compatible / claude-opus-4-7），是既有 env 污染问题，非本轮引入。
- 用隔离 `LINGHUN_CONFIG_DIR` 复跑后，本轮扩展的 `shows and diagnoses the current model`（含 `base_url：present` 断言）PASS；仅剩 2 个其它 doctor 测试因独立的既有 `deepseek-chat` vs `deepseek-v4-flash` env mismatch 失败，同样非本轮引入。
- P1-6 脚本手动验证：无 key → `SKIPPED` exit 0；`LINGHUN_OPENAI_API_KEY` set 无 model → fail-fast exit 1（不发请求、不用 placeholder）；`LINGHUN_DEEPSEEK_API_KEY` set 无 model → fail-fast exit 1。`grep openai-compatible-model package.json` = 0。

## 7. git status

```text
 M apps/cli/src/cli.ts
 M apps/cli/src/main.test.ts
 M package.json
 M packages/tui/src/architecture-runtime.ts
 M packages/tui/src/guard-wiring.test.ts
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
 M packages/tui/src/terminal-readiness-presenter.ts
 M packages/tui/src/terminal-readiness-runtime.ts
 M packages/tui/src/tool-output-presenter.test.ts
 M packages/tui/src/tool-output-presenter.ts
 M packages/tui/src/tui-data-types.ts
 M packages/tui/src/verification-command-runtime.ts
?? .claude/
?? AGENTS.md
?? D13D_TUI_FOUNDATION_PLAN.md
?? LINGHUN_CODE_FACT_AUDIT_REPORT_2026-05-27.md
?? LINGHUN_VS_CCB_SOURCE_COMPARISON.md
?? docs/delivery/phase-13V-BC-architecture-completeness-diagnostics-closure.md
?? docs/delivery/phase-14A-R-source-wiring-closure-audit.md
```

本报告保存后还会新增：

```text
?? docs/delivery/phase-14A-R-fix-source-wiring-p1-closure.md
```

`.claude/`、`AGENTS.md`、`D13D_*`、`LINGHUN_*`、`phase-13V-BC-*.md`、`phase-14A-R-source-wiring-closure-audit.md` 为本轮之前既有 untracked，未删除、未回滚。

## 8. 边界确认

- 仅修复 D.14A-R 报告登记的 7 个 P1，未顺手扩范围。
- **未进入 D.14B**，未做失败学习/反思系统，未做新功能扩展。
- **未改 provider/env/key/model route 真实选择逻辑**（P1-3/P1-5 只改展示口径；P1-6 只改 smoke 脚本默认值并 fail-fast）。
- **未新增权限模式**（权限四档语义不变）。
- **未改变 D.13U/D.13V gate 判定语义**：P1-1 的 closure 严格位于 final answer append 与 retry/downgrade 之后，不改 gate 顺序或判定。
- **未恢复 FreshnessLite**。
- 未做 Git/worktree 新功能，未做 UI 大改版。
- 未删除历史 untracked 文件。
- `index.ts` 仅在 `continueModelAfterToolResults` 增加最薄 glue（调用既有 `needsSolutionCompletenessReportClosure` / `formatSolutionCompletenessReportBlock` / `appendSystemEvent`），未把新业务逻辑塞回 index.ts。
- 未 commit（按既有规则，由用户决定是否提交）。

## 9. 参考核对

- 实际读取的 Linghun 文档：`docs/delivery/phase-14A-R-source-wiring-closure-audit.md`、`docs/delivery/phase-14A-3-index-deep-structural-modularization.md`、`docs/delivery/phase-13U-anti-hallucination-final-answer-gate.md`、`docs/delivery/phase-13V-BC-architecture-completeness-diagnostics-closure.md`，以及相关源码（`index.ts`、`final-answer-gate.ts`、`model-prompt-runtime.ts`、`verification-command-runtime.ts`、`terminal-readiness-runtime.ts`、`terminal-readiness-presenter.ts`、`verification-level.ts`、`architecture-runtime.ts`、`architecture-boundary.ts`、`apps/cli/src/cli.ts`、根 `package.json`）与对应测试文件。
- 实际参考的本地 CCB / 社区项目：本轮为 Linghun 内部 P1 闭环，未读取/复制 CCB 或社区源码实现。
- 行为参考 vs 自研实现：仅复用 Linghun 既有 helper（closure block、verification 分级器、circuit breaker、readiness view、redaction 模式）做最小接入/口径修正，未引入新抽象或新系统。
- 未复制可疑源码实现。

## 10. 成品级结构化 Handoff Packet

```yaml
phase: D.14A-R-Fix
status: COMPLETE
next_phase: D.14B only after explicit user confirmation

scope_actually_done:
  - P1-1 continuation Solution Completeness closure mirror (index.ts continueModelAfterToolResults)
  - P1-2 synthetic /verify smoke marked synthetic; readiness no longer projects it as real-smoke
  - P1-3 headless CLI `linghun model` base_url -> present/missing
  - P1-4 Bash tool start banner secret/URL redaction (formatToolStart)
  - P1-5 provider readiness requires live-verified evidence (not configured-only) to pass
  - P1-6 smoke:live-provider fail-fast without explicit model; no placeholder model
  - P1-7 AntiCodeBlob clarified as prompt-only + lock test (chose option A)

forbidden_next_without_user_confirmation:
  - enter D.14B
  - change provider/env/key/model route logic
  - add a permission mode
  - change D.13U/D.13V gate semantics
  - restore FreshnessLite
  - add failure-learning/reflection system
  - add AntiCodeBlob hard gate

evidence_refs:
  - file: F:/Linghun/packages/tui/src/index.ts (continuation closure)
  - file: F:/Linghun/packages/tui/src/verification-command-runtime.ts (synthetic flag)
  - file: F:/Linghun/packages/tui/src/terminal-readiness-runtime.ts (synthetic exclusion + providerLiveVerified)
  - file: F:/Linghun/packages/tui/src/terminal-readiness-presenter.ts (provider item status + providerLiveVerified type)
  - file: F:/Linghun/packages/tui/src/tui-data-types.ts (VerificationStep.synthetic)
  - file: F:/Linghun/packages/tui/src/tool-output-presenter.ts (redactBannerArg)
  - file: F:/Linghun/apps/cli/src/cli.ts (formatModelInfo)
  - file: F:/Linghun/package.json (smoke:live-provider)
  - file: F:/Linghun/packages/tui/src/architecture-runtime.ts (prompt-only clarification comment)
  - tests: index.test.ts, tool-output-presenter.test.ts, apps/cli/src/main.test.ts, guard-wiring.test.ts

verification_results:
  tsc_no_emit: PASS
  tui_build: PASS
  cli_build: PASS
  git_diff_check: PASS
  focused_unit_tests: "275 passed (model-loop/tool-output/verification-level/guard-wiring/architecture-runtime/architecture-boundary/workspace-reference-cache)"
  index_D13U: "5 passed"
  index_D13V_A: "20 passed (baseline 16, +4 P1-2)"
  index_D13V_BC: "9 passed (baseline 6, +3 P1-1/P1-7)"
  full_tui_vitest: "44 failed / 1710 passed; baseline 44 failed / 1696 passed; new failures = 0; +14 new passing"
  failure_name_diff: "all 44 failures in existing 'Phase 06 TUI slash commands' runTui-mock baseline; two readiness-named failures confirmed failing identically at baseline via git stash"
  cli_main_test: "extended `shows and diagnoses the current model` PASS under isolated LINGHUN_CONFIG_DIR; remaining CLI doctor failures are pre-existing env contamination"

boundary_confirmation:
  entered_D14B: false
  changed_provider_env_key_model_route: false
  added_permission_mode: false
  changed_D13U_D13V_gate_semantics: false
  restored_freshness_lite: false
  failure_learning_system: false
  deleted_untracked: false

index_status:
  codebase_memory_project: F-Linghun
  source_facts_checked_by: "local Read/Grep + 3 parallel subagents (P1-3/P1-4 done as subagents, P1-6 inline)"

permissions:
  sandbox_mode: danger-full-access
  approval_policy: never

model_provider_budget:
  provider_route_changed: false
  real_provider_smoke_run: false
  budget_recorded: "not available in local tool output"
```

---

## CLI Test Cleanup Addendum（D.14A-R-Fix-CLI-Test-Cleanup，2026-05-30）

> 范围：只处理 D.14A-R-Fix 复核时发现的 `apps/cli/src/main.test.ts` 两个 CLI doctor baseline 失败。未进入 D.14B，未改 provider/env/key/model route 真实逻辑，未改 D.13U/D.13V gate，未改 TUI 行为，未新增功能，未碰 index.ts。

### 1. 原失败原因

在隔离 `LINGHUN_CONFIG_DIR` + 清空 provider/model 环境变量后，仍有 2 个失败：

- `warns when headless model doctor reads apiKey from project settings`
- `shows env source when headless model doctor env apiKey overrides project settings`

两者都断言 `provider=deepseek model=deepseek-v4-flash`，实际输出 `provider=deepseek model=deepseek-chat`。根因有二：

1. **期望用了 placeholder 模型名**。真实运行时默认 DeepSeek 模型自 D.13P-hotfix 起为 `deepseek-chat`（`packages/config/src/index.ts` 的 `defaultDeepSeekModel`），`deepseek-v4-flash` 已降级为 placeholder（仅用于 doctor warning 与 fixture）。
2. **doctor 解析的是 route/`defaultModel`，不是 project-settings 的 `providers.deepseek.model`**。测试只在 `.linghun/settings.json` 写了 `providers.deepseek.model: deepseek-v4-flash`，没有写 `defaultModel`/`modelRoutes.defaultModel`；`resolveDoctorTarget` 以 `config.defaultModel`（= 真实默认 `deepseek-chat`）为准，因此 doctor 报告 `deepseek-chat`。这是真实行为，不是生产 bug。
3. 这两个测试此前还**没有自带 HOME/config 隔离**，普通环境下会读到本机 `~/.linghun/provider.env`（openai-compatible / claude-opus-4-7），是额外的非确定性来源。

### 2. 是否只改测试隔离/期望

**是，只改 `apps/cli/src/main.test.ts`，未碰任何生产逻辑。**

- 新增 `withIsolatedCliConfig(run)` test helper：`mkdtemp` 独立 home/config 与 project，`vi.stubEnv("LINGHUN_CONFIG_DIR", <home>/.linghun)`，并 `vi.stubEnv(..., undefined)` 清空所有会影响 provider/model 选择的环境变量（`LINGHUN_OPENAI_*` / `LINGHUN_DEEPSEEK_*` / `LINGHUN_DEFAULT_MODEL` / `LINGHUN_INFERENCE_LEVEL` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY`），切到独立 cwd 后执行回调。`afterEach(vi.unstubAllEnvs)` 已存在，负责还原。
- 两个失败测试改为：用 helper 包裹（确保隔离），并按**真实行为**修正期望（采用方向 B）：断言 `provider=deepseek model=${DEFAULT_DEEPSEEK_MODEL}`，其中 `DEFAULT_DEEPSEEK_MODEL = defaultConfig.defaultModel`（从 `@linghun/config` 读取，避免硬编码），并加注释说明 project-settings 的 `providers.deepseek.model` 不改变 route defaultModel。
- 同步把 `shows and diagnoses the current model through slash commands` 也包进 helper，消除它依赖环境的隐性非确定性（其断言不变，仍验证 `base_url：present`、不泄漏 raw URL、`model set` 切换、doctor `apiKey=missing` 等）。
- 继续保留并通过的关键断言：apiKey source（`project-settings-legacy` / `env` / `user-provider-env`）、`baseUrl=present`、`masked=sk-…cret`、不出现 raw `base_url：https://...`、不泄漏明文 key、不泄漏 project 路径。

未采用方向 A（在 settings 写 `defaultModel: deepseek-v4-flash`）——那会让测试表达一个 placeholder 模型，与真实默认 `deepseek-chat` 不一致；方向 B 更贴近产品真实行为。

### 3. 没有改 provider/env/key/model route 真实逻辑

- 未修改 `packages/config`、`apps/cli/src/cli.ts`、任何 provider/route/model 选择代码。
- 未改 D.13U/D.13V gate，未改 TUI 行为，未新增功能，未碰 `index.ts`，未删除历史 untracked。
- 本次唯一改动文件：`apps/cli/src/main.test.ts`（测试隔离 + 真实期望）。

### 4. 验证命令结果

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/cli exec vitest run src/main.test.ts` | PASS, 8 passed（含原 2 个失败现已通过；普通环境下也确定性通过，无需手动隔离） |
| `corepack pnpm --filter @linghun/cli build` | PASS, exit 0 |
| `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | PASS, exit 0 |
| `git diff --check` | PASS, exit 0 |
| `corepack pnpm --filter @linghun/tui exec vitest run src/tool-output-presenter.test.ts src/verification-level.test.ts` | PASS, 55 passed（P1-2/P1-4 相关测试未受影响） |

复现确认：清理前在隔离环境下复跑，失败点确实只剩 CLI doctor 模型口径（`deepseek-v4-flash` vs `deepseek-chat`），与本轮 P1 修复（base_url 脱敏等）无关。

### 5. git status

仅本 cleanup 改动文件：

```text
 M apps/cli/src/main.test.ts
```

D.14A-R-Fix 既有改动（本 cleanup 未触碰）：

```text
 M apps/cli/src/cli.ts
 M package.json
 M packages/tui/src/architecture-runtime.ts
 M packages/tui/src/guard-wiring.test.ts
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
 M packages/tui/src/terminal-readiness-presenter.ts
 M packages/tui/src/terminal-readiness-runtime.ts
 M packages/tui/src/tool-output-presenter.test.ts
 M packages/tui/src/tool-output-presenter.ts
 M packages/tui/src/tui-data-types.ts
 M packages/tui/src/verification-command-runtime.ts
```

既有 untracked（未删除、未回滚）：`.claude/`、`AGENTS.md`、`D13D_TUI_FOUNDATION_PLAN.md`、`LINGHUN_CODE_FACT_AUDIT_REPORT_2026-05-27.md`、`LINGHUN_VS_CCB_SOURCE_COMPARISON.md`、`docs/delivery/phase-13V-BC-*.md`、`docs/delivery/phase-14A-R-source-wiring-closure-audit.md`、本报告 `docs/delivery/phase-14A-R-fix-source-wiring-p1-closure.md`。

未进入 D.14B。未 commit（由用户决定是否提交）。
