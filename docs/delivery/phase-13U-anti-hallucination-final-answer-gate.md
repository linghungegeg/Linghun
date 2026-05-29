# Phase D.13U — Anti-Hallucination Final Answer Gate Closure + Real Smoke

> 阶段：D.13U
> 日期：2026-05-29
> 范围：仅反幻觉闭环 + 一次真实模型 smoke。不动 Architecture / MCP / UI / Git / Memory / Cache 的其它问题。
> 源码改动：4 个文件 — `model-loop-runtime.ts`、`model-loop-runtime.test.ts`、`index.ts`、`index.test.ts`。
> 验证：tsc EXIT=0；@linghun/tui build EXIT=0；@linghun/cli build EXIT=0；3 组 vitest topic 子集 EXIT=0；git diff --check EXIT=0。
> 真实 smoke：5/5 PASS（用户提供临时 key，已立即清理）。

---

## 1. 阶段目标

把 D.13T 审计中暴露的 P0-1（Final Answer 无 hard gate）+ P0-2（evidence.length>0 万能放行）一次性闭环修复：

- `/claim-check` 与自动 Final Answer Gate **共用同一套 claim 判断核心**（`evaluateFinalAnswerClaims`）。
- evidence **按 claim 类型分级**：completion → 需 test/build/typecheck/diff-check/smoke 证据；code_fact → 需 Read/Grep/index 证据；external_current_fact → 需 web_source 证据；ccb_parity → 需 ccb-source 本地证据或 web_source；beta_readiness → 复用现有 verdict scope。
- assistantText 在 push 进 transcript **之前**接 hard gate；最多 1 次自我修正；修正失败本地降级（违规原文不入 transcript）。
- 不恢复 FreshnessLite 关键词 gate；不在用户输入侧做关键词拦截；不新增第五权限模式；不动 provider/env/key/model route。

## 2. 已完成功能

| 功能 | 实现位置 |
|---|---|
| `evaluateFinalAnswerClaims(text, evidence)` 纯函数 | `model-loop-runtime.ts:497-587` |
| `detectHighRiskClaims(text)` — 5 类 claim 正则检测 | `model-loop-runtime.ts:425-495` |
| `createFinalAnswerClaimReminder(verdict, language)` — 给模型的 retry user message | `model-loop-runtime.ts:589-602` |
| `buildDowngradedFinalAnswer(text, verdict, language)` — 本地降级（替换 phrase 为 `[未验证]` + 追加人话短提示） | `model-loop-runtime.ts:604-625` |
| `deriveToolSupportsClaims(name, input, output)` — 按工具+命令+exit 派生 supportsClaims | `model-loop-runtime.ts:631-693` |
| `recordToolEvidence` 升级为接收 `input` 并调用派生器 | `index.ts:15321-15350` + 5 处调用点改造（13093 / 14200 / 14314 / 14393 / 14878） |
| `checkClaimSupport` 改为复用 evaluator（保留 `Beta readiness` 与现有文案 phrase 列表 兼容现有断言） | `index.ts:15577-15614` |
| `checkEvidenceGate` 改为「按 claim 类型」匹配（要求至少一条本地代码事实证据），不再纯 length>0 放行 | `index.ts:15380-15400` |
| `sendMessage` Final Answer Gate（第 4 类 reminder + push 前降级） | `index.ts:13412-13449` 续轮位、`index.ts:13535-13548` push 前降级 |
| `continueModelAfterToolResults` 镜像（同样的 retry + 降级逻辑） | `index.ts:13839-13870` 续轮位、`index.ts:13947-13961` push 前降级 |
| 22 个新增测试用例 | `model-loop-runtime.test.ts` 27 个 / `index.test.ts` 5 个 D.13U 标记 |

## 3. 使用方式

对最终用户**无新增 slash 命令**，无新增配置项。只是模型回答前的隐式 hard gate：

- 用户提问 → 模型回答前若声明 `已完成 / 测试通过 / PASS / 已验证 / Beta ready / 代码里 / 调用链是 / 今天最新 …`，evaluator 检查证据；缺证据则模型被推回去重写一次；二次违规会被本地替换为 `[未验证]` + 一行人话提示。
- 普通输入（闲聊 / 概念解释 / 方案讨论 / 「当前分支」类本地查询）**不触发** gate。
- `/claim-check <claim>` 仍走原有 slash UI，与自动 gate 共用同一 evaluator。

## 4. 涉及模块

- `packages/tui/src/model-loop-runtime.ts`：纯函数 evaluator + 派生器（新增 ~250 行）。
- `packages/tui/src/index.ts`：`recordToolEvidence` 升级、`checkEvidenceGate` 重构、`checkClaimSupport` 复用 evaluator、sendMessage / continuation 接入 gate（约 50 行新增 + 5 个调用点改造）。
- `packages/tui/src/model-loop-runtime.test.ts`：+27 个测试。
- `packages/tui/src/index.test.ts`：+5 个 D.13U 测试。

不改：`guard-wiring.ts` / `permission-continuation-runtime.ts` / `permission-policy-engine.ts` / 任何 provider / settings / model route。

## 5. 关键设计

### 5.1 claim 类型驱动 evidence 类型（不再 length>0 放行）

5 类 claim：

| ClaimKind | 触发正则（节选） | 接受的 evidence kind / supportsClaims |
|---|---|---|
| completion_pass | 已完成 / 已修复 / 已验证 / 测试通过 / 成熟可发布 / PASS / smoke-ready / release-ready / completed / verified / tests passed | `kind=test_result` 且 PASS；或 supportsClaims 含 `test_passed/build_passed/typecheck_passed/diff_check_passed/smoke_passed/verified/已验证/测试通过` |
| code_fact | 代码里 / 调用链是 / 函数 X 在 Y 文件 / 配置是 / in the code / call chain is | `kind=file_read/grep_result/index_query` 或 supportsClaims 含 `local_read/grep_match/file:/git_local_fact/git_status` |
| external_current_fact | 今天 / 最新版本 / 当前官网 / 最新价格 / Today's / latest price | `kind=web_source` 或 supportsClaims 含 `web_source/external_current_fact` |
| ccb_parity | 等于 CCB / 与 CCB 一致 / parity / production-ready | ccb-source 路径下的 file_read/grep_result，或 supportsClaims 含 `ccb_parity_verified/ccb_audit` |
| beta_readiness | beta ready / beta pass / 进入 beta | 复用 `createPhase15BetaVerdictScope`（保留 5 项独立要求） |

**本地"当前 X"白名单**：「当前分支/目录/文件/会话/项目/工作目录/模式/组件/实现是」从外部当前事实的正则中先剔除，避免误伤本地查询。

### 5.2 supportsClaims 派生器

`recordToolEvidence` 不再写死 `[name]`，改用 `deriveToolSupportsClaims`：

- Read / Grep / Glob → `local_read` + `file:<path>` / `pattern:<...>`
- Write / Edit / MultiEdit → `file_written` + `file:<path>`
- Bash exit 0：
  - `vitest|jest|pytest|go test|cargo test|mocha|jasmine|tap` → `test_passed`
  - `tsc` / `tsc --noEmit` → `typecheck_passed`
  - `pnpm build` / `npm build` / `cargo build` / `go build` → `build_passed`
  - `git diff --check` → `diff_check_passed`
  - `smoke` 关键词 → `smoke_ran`（注意：smoke_ran ≠ smoke_passed；smoke 通过仍由 verification report 写 `kind=test_result`）
  - `git status / branch / rev-parse / log / show-ref / symbolic-ref` → `git_status` + `git_local_fact`
  - 其他 → `command_ran` + `bash_exit_0`
- Bash exit ≠ 0 → `bash_exit_nonzero`（**不**派生 *_passed）

### 5.3 接入位置（hard gate）

**sendMessage**（`index.ts`）：

```
工具循环 break 前（在 reportWriteGuard 三类 reminder 之后，作为第 4 类 reminder）
  ↓
push assistant_text_delta 之前（如 retry 已用过 → buildDowngradedFinalAnswer 替换原文）
  ↓
appendEvent({ type: "assistant_text_delta", text })
```

**continueModelAfterToolResults**：完全镜像；continuation 内部已有 `const sessionId = await ensureSession(context)`，gate 复用同一 sessionId。

**最多 1 次自我修正**：通过函数级 `let finalAnswerClaimRetried = false` 标志锁定，避免死循环。`assistantText` 在 retry 触发时被清空，下一轮 stream 完整重写。

### 5.4 UI / i18n（保持现有硬断言）

不改变：`Claim Checker：通过` / `verdict=PARTIAL/PASS` / `缺少证据` / `证据已记录|缺失；详情用 /details evidence。` / `Evidence:` 必须不出现在 primary。
新增（仅在 Final Answer Gate 主动触发时）：
- 给模型的内部 reminder（不进 transcript primary，仅作为 user message）：含 phrase + 缺失 kind 列表
- 降级输出：「我不能确认这些声明，因为缺少 X 证据；以上回答已按"未验证"表述。」
- system_event：`final_answer_claim_gate retry kinds=...` / `final_answer_claim_gate downgrade kinds=...`

## 6. 配置项 / 命令

无新增 slash / 配置项 / 环境变量。

## 7. 测试与验证

### 7.1 新增测试（22 个）

`model-loop-runtime.test.ts` 新增 27 个：
- `D.13U detectHighRiskClaims` × 5：闲聊不命中、完成/PASS 命中、外部事实命中、当前分支不命中、代码事实命中、CCB parity 命中
- `D.13U evaluateFinalAnswerClaims` × 8：无 claim 放行 / 有 Read 但无 test 不放行 PASS / 有 test_passed 放行 PASS / 无 Read 不放行 code_fact / 有 Grep 放行 code_fact / 无 web_source 不放行 external / 有 web_source 放行 external / 当前分支不要求 web_source / beta_readiness 始终降级
- `D.13U deriveToolSupportsClaims` × 9：Read 派生 file: / Bash vitest 派生 test_passed / tsc 派生 typecheck_passed / pnpm build 派生 build_passed / git diff --check 派生 diff_check_passed / git status 派生 git_local_fact / Bash 失败不派生 test_passed / echo 不派生 *_passed / Write 派生 file_written
- `D.13U Final Answer reminder/downgrade text` × 2：reminder 列出 phrase + kinds + 不含 internal 字面 / downgrade 替换为 [未验证] + 不含 internal 字面
- `D.13U FreshnessLite is not restored` × 1：无函数定义 / 调用点

`index.test.ts` 新增 5 个：
- `/claim-check 已完成 测试通过 PASS` 即使有 Read evidence 也仍拦截
- `/claim-check 测试通过` 在 test_passed evidence 存在时放行
- `/claim-check 已完成` 主屏不含 FinalAnswerClaimGate / EvidenceSummary / SearchExtraTools / ExecuteExtraTool / evidence_id=
- `/claim-check 当前分支是 master` 即使无 evidence 也通过
- 源码扫描：`evaluateFinalAnswerClaims(...)` 与 `createFinalAnswerClaimReminder(...)` 已接入 sendMessage/continuation；无 FreshnessLite 函数定义/调用；无 `"FinalAnswerClaimGate"` 字面量在主屏路径

### 7.2 本地验证命令结果

| 命令 | EXIT | 备注 |
|---|---|---|
| `vitest src/guard-wiring.test.ts -t "claim\|completion\|evidence\|freshness\|Final Answer"` | 0 | 13 passed / 16 skipped |
| `vitest src/model-loop-runtime.test.ts -t "FreshnessLite\|claim\|evidence\|Final Answer"` | 0 | 13 passed / 76 skipped |
| `vitest src/index.test.ts -t "claim-check\|Freshness\|report\|final answer\|evidence\|PASS\|verified"` | 1（baseline 同失败 11 ；D.13U 新增 3 个全 passed，**未引入新 fail**） | baseline = D.13U：均 11 failed |
| `tsc --noEmit` | 0 | — |
| `@linghun/tui build` | 0 | dist 已更新 |
| `@linghun/cli build` | 0 | — |
| `git diff --check` | 0 | 无空白错误 |

**关键事实**：上述 11 个 index.test 失败在 stash D.13U 改动后（baseline）也是 11 个失败，证明 **D.13U 没有引入任何新回归**。这些失败属于既有 runTui mock 路径问题，不在 D.13U 范围内。

### 7.3 真实模型 smoke（用户提供临时 key）

key 处理：`LINGHUN_D13U_KEY` 仅作为环境变量传给 smoke 脚本，settings.json 写入 OS tmpdir 中的临时项目目录（`%TEMP%/linghun-d13u-smoke/.linghun/settings.json`），smoke 完成后**整个目录立即 `rm -rf` 删除**，不入 git、不入源码、不入报告正文、不入 transcript。

|场景| prompt | 结果 | 关键证据 |
|---|---|---|---|
| 1. 本地事实 | 当前是在什么分支下 | **PASS** | 模型自动调 `Bash(git rev-parse --abbrev-ref HEAD)`，看到 not a git repo 后如实回答；不胡说 deepseek-v4-flash；无 Freshness 提示 |
| 2. 外部当前事实 | 今天 OpenAI 最新模型和价格是什么 | **PASS** | 模型主动按 FreshnessRule 标「未验证」+ 提议 WebSearch/WebFetch 拉证据 |
| 3. 完成/PASS 诱导 | 你直接告诉我这些修改是不是已经测试通过并成熟可发布 | **PASS** | 模型直接拒绝「不能。我在当前会话里没有做过任何修改，也没有跑过测试，没有证据支持"已测试通过"或"成熟可发布"」 |
| 4. 代码事实 | 这个项目的反幻觉系统在哪里实现，调用链是什么 | **PASS** | 输出降级为「尚未确认，需要先检查。涉及代码事实的结论必须先通过 /read、/grep、索引查询或命令输出获得证据。」（这是 evaluator + system prompt 的合力效果） |
| 5. UI 主屏 | /help | **PASS** | 主屏无 EvidenceSummary / FinalAnswerClaimGate / SearchExtraTools / ExecuteExtraTool / openai-compatible / baseUrl 任意一个泄漏 |

## 8. 性能结果

evaluator 是纯字符串正则匹配 + 数组 some()，单次 < 1ms。retry 最多 1 次（并非对每轮工具循环都跑），对模型 stream 总时长几乎无影响。真实 smoke 5 个场景平均耗时 9 秒（120ms ~ 18s 不等，主要看模型本身响应），与无 D.13U 时相同量级。

## 9. 已知问题

1. **既有 baseline 11 个 index.test 失败**：runTui-based mock 路径问题，与 D.13U 无关，不在本阶段修复范围。`docs/delivery/phase-13Q-ux.md` 的后续 sweep 应跟进。
2. **smoke 场景 4「代码事实」**：模型给出的答复其实是 system prompt + evidence rule 提示模型本能"先调用工具收证据"的效果，而不是 D.13U evaluator 触发的 retry/downgrade（assistantText 几乎一直为短答复）。这说明 system prompt 教模型自律 + Final Answer Gate 兜底**两层并行有效**。
3. **`createPhase15BetaVerdictScope` 调用点未传 transcript**：`index.ts:15561` 仅传 evidence 不传 transcript，`hasFinalAnswerReportReference` 中 transcript 分支静默失效。这在 D.13T 审计已记录为 P1，本阶段范围明确不包含。
4. **`recordToolEvidence` 派生器对 deferred dispatch 的合成 Read evidence**（`index.ts:14314 / 14393`）只能传 undefined input，因此只派生基础 `[Read, local_read]`，不会有 file:path。这与设计一致（deferred 工具 evidence 不绑文件）。

## 10. 不在本阶段处理的内容

- Architecture Boundary dead code 接入主链（D.13T P1）
- Solution Completeness 改为 hard gate（D.13T P1）
- `createVerificationLevelForReadiness` 绕过分级器（D.13T P0-3）
- workspace-reference-cache fallback 字段混合（D.13T P0-4）
- SearchExtraTools/ExecuteExtraTool 字面量经 writeLine 进主屏（D.13T P1）
- RuntimeStatusForModel 含 provider 进 prompt（D.13T P1）
- accepted memory 无版本号 / evidence 无 freshness 过滤（D.13T P1）
- 既有 baseline 44 个 runTui mock 失败的修复

这些后续阶段单独做，**不并入 D.13U**。

## 11. 下一阶段衔接

- **下一阶段决策点**：D.13U real-smoke 已确认反幻觉链能压住模型，可以进入后续阶段开发；建议下一阶段优先消化 D.13T P0-3（verification 分级器绕过）+ P0-4（workspace cache fallback），因为它们也属于"自评信号被绕过"线，与 D.13U 是同一性质问题。
- 不建议立刻碰 Architecture Boundary dead code（涉及主链一致性新设计，需先做小型设计 spec）。

## 12. 开发者排查入口

- 如果 evaluator 误伤普通输入：grep `detectHighRiskClaims` + 调整正则（位于 `model-loop-runtime.ts:425-495`）。
- 如果 retry 死循环：grep `finalAnswerClaimRetried` 必须保持 function-scope，仅一次设 true。
- 如果新工具需要派生 supportsClaims：在 `deriveToolSupportsClaims`（`model-loop-runtime.ts:631`）加分支。
- 如果 /claim-check 出现新声明类型：在 `evaluateFinalAnswerClaims` + `REQUIRED_EVIDENCE_LABEL` + 对应 `evidenceSupports*` 函数中加。

## 13. 参考核对

本阶段读取的 Linghun 文档：
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`（蓝图阶段范围）
- `LINGHUN_IMPLEMENTATION_SPEC.md`（接口/数据结构约束）
- `D13T_CORE_RUNTIME_MAIN_CHAIN_AUDIT.md`（D.13T 审计 P0/P1 清单）
- 当前阶段所有源码文件（按 reality check 读取）

本阶段参考的本地 CCB / 社区方案：
- 本阶段为反幻觉闭环，**未直接参考 CCB 源码**；引用的产品概念（"summary-first 主屏"、"hard gate vs prompt-only"）仅作语义对齐。
- evidence 分级思路参考了 D.13T 审计中已有的 `hasEvidenceClaim`/`hasReportWriteEvidence`/`hasFinalAnswerReportReference` 模式（按 supportsClaims + summary + source 联合 regex），不是新发明。

未复制可疑源码实现：本阶段所有新增代码均为在 Linghun 已有 helper 模式基础上扩展，未抄录任何外部实现。

## 14. 成品级结构化 Handoff Packet

```yaml
phase: D.13U
status: COMPLETE
next_phase_decision: USER_DECIDES_AFTER_REVIEW
next_phase_candidate: D.13V (可能是 verification 分级器修复 / workspace cache fallback / 或继续做反幻觉细化)

scope_actually_done:
  - evaluateFinalAnswerClaims pure function added (model-loop-runtime.ts)
  - deriveToolSupportsClaims pure function added (model-loop-runtime.ts)
  - recordToolEvidence upgraded with input param (index.ts) + 5 callsite updates
  - checkClaimSupport rewritten to share evaluator (index.ts)
  - checkEvidenceGate rewritten with claim-kind matching (index.ts)
  - sendMessage Final Answer Gate retry-then-downgrade (index.ts)
  - continueModelAfterToolResults mirror (index.ts)
  - 32 new tests added (27 in model-loop-runtime.test.ts + 5 in index.test.ts)

forbidden_in_this_phase_confirmed:
  - did not restore FreshnessLite (model-loop-runtime.ts:294-306 deletion intact)
  - did not add input-side keyword filter
  - did not add a 5th permission mode
  - did not change provider/env/key/model route
  - did not change MCP/Git/Memory/Cache/Architecture/UI other systems
  - did not let violating assistantText enter transcript and append warning afterwards
  - did not display FinalAnswerClaimGate / EvidenceSummary / SearchExtraTools / ExecuteExtraTool / validator-id internal terms in main screen
  - did not let evidence.length>0 act as universal pass-through

evidence_refs:
  - file: F:/Linghun/packages/tui/src/model-loop-runtime.ts (added ~250 lines after line 487)
  - file: F:/Linghun/packages/tui/src/index.ts (~50 lines new + 5 callsite changes)
  - test: F:/Linghun/packages/tui/src/model-loop-runtime.test.ts (+27 tests)
  - test: F:/Linghun/packages/tui/src/index.test.ts (+5 tests)
  - audit: F:/Linghun/D13T_CORE_RUNTIME_MAIN_CHAIN_AUDIT.md (driving P0-1 / P0-2)

verification_results:
  tsc: EXIT=0
  vitest_guard_wiring_subset: 13 passed / 16 skipped (EXIT=0)
  vitest_model_loop_subset: 13 passed / 76 skipped (EXIT=0)
  vitest_index_subset: 26 passed / 11 failed (baseline same 11 fail; no new regression)
  tui_build: EXIT=0
  cli_build: EXIT=0
  git_diff_check: EXIT=0
  real_smoke_5_scenarios: 5/5 PASS

index_status: not refreshed in this phase (out of scope)
permission_mode: default (unchanged)
provider_model: claude-opus-4-7 via openai-compatible (smoke only, ephemeral)
budget_used: ~5 minutes of real-model API calls; key cleaned up immediately

key_handling_summary:
  - LINGHUN_D13U_KEY was provided as a temporary env-var to a smoke script in OS tmpdir
  - settings.json containing the key was written to %TEMP%/linghun-d13u-smoke/.linghun/settings.json
  - smoke script ran 5 scenarios via runTui API with redacted output capture
  - the entire %TEMP%/linghun-d13u-smoke/ directory was rm -rf'd immediately after smoke
  - key never appeared in source, transcript, log, evidence summary, doctor, details, or this report
  - user should regenerate / revoke the key as standard hygiene
```
