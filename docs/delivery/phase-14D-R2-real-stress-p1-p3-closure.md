# Phase 14D-R2 — Real Stress P1–P3 Closure

## 阶段目标

只收口 Run 1 已压出的 P1–P3 交互/归因问题。Run 1.5 因 provider/harness 不稳定已 early-stopped，不作为 acceptance 数据；本阶段不进入 Run 2，不改 provider/env/key/model route 真实逻辑，不放松权限四档语义，不恢复本地自然语言关键词截获，不改 anti-hallucination/final gate 判定语义（只修触发范围或展示归因）。

**压测边界声明**：Run 1.5 已 early-stopped，不纳入本阶段 acceptance。本阶段只依据 Run 1 已确认的 1 个 P1、1 个 P2、2 个 P3 收口；未改 Run 1 / Run 1.5 压测报告正文，未进入 Run 2。

## 已完成问题

| 编号 | 问题 | 状态 |
|------|------|------|
| P1-1 | GitStablePointCreate default 模式缺确认面板 | 已修复 |
| P2-1 | provider eventstream CRC mismatch 归因/展示 | 已修复 |
| P3-1 | 代码事实检查前置过度 | 已修复 |
| P3-2 | Ctrl+O 折叠提示重复 | CLOSED_BY_D14D_R（已加回归锁定） |

## 每个问题：源码根因 + 修复位置 + 行为矩阵

### P1-1 GitStablePointCreate default 模式缺确认面板

**源码根因**：
`packages/tui/src/git-tool-dispatch-runtime.ts` `runStablePointTool` 直接调 `performStablePoint` 真实创建 commit/snapshot，没有像 Write/Bash/IndexRefresh/ManagedWorktreeRemove 一样先进 `pendingLocalApproval` / PermissionPanel。自然语言触发的稳定点在 default/auto-review 下被直接执行。

**修复位置**：
- `git-tool-dispatch-runtime.ts`：
  - `runStablePointTool` 接收 `continuation`；default/auto-review 时进 `pendingLocalApproval{ kind:"git_stable_point" }`，返回 `pendingApproval:true`，写 `stable_point_requested` 系统事件；plan 模式直接拒绝（不创建 commit/snapshot、不出现可执行 yes 确认，tool_result 明确 `stable point was NOT created because Plan mode is read-only.`）；full-access 直接执行（仍写 evidence）。
  - 新增 `resolveStablePointApprove`（确认后 `performStablePoint` + 回灌工具结果续轮）、`resolveStablePointDeny`（不创建，写 `stable_point_denied`，回灌"稳定点未创建/NOT created"给模型）。
  - 新增 `GitStablePointApproval` 类型。
- `index.ts`（薄 glue）：`PendingLocalApproval` 加 `git_stable_point` kind；`executePermissionApprove`/`executePermissionDeny` 各加一分支调 `resolveStablePoint*`；import `resolveStablePoint*`。
- `shell/view-model.ts` `mapPendingApprovalToPermission`：加 `git_stable_point` → PermissionPanel（mutating/medium）。
- `pending-details-presenter.ts`：加 `git_stable_point` details。
- **未改** `performStablePoint`（核心）、slash `/git stable create`/`/checkpoint create` 路径（显式用户动作，不经模型工具确认）、dirty/path/secret/untracked 边界、final answer gate。

**行为矩阵**：

| 模式 / 触发 | 行为 |
|------------|------|
| 模型工具 + default/auto-review | 进 PermissionPanel；yes→真实创建+evidence；no→不创建，tool_result 明确未创建 |
| 模型工具 + plan | 直接拒绝；不创建 commit/snapshot；不展示可执行 yes 确认；tool_result 明确 `stable point was NOT created because Plan mode is read-only.` |
| 模型工具 + full-access | 按既有策略直接执行，仍写 git_operation evidence |
| slash `/git stable create`、`/checkpoint create` | 不变（显式动作，直接执行） |
| 模型空口声称已建稳定点（不调工具） | final gate 仍降级（无 stable_point_created evidence） |

**小返修 addendum（D.14D-R2 follow-up）**：
- 发现点：首轮 R2 使用 `context.permissionMode !== "full-access"` 统一进入 pending approval，导致 plan 模式用户输入 yes 后也可能创建 commit/snapshot；这违背"plan 模式只读"的权限语义。
- 修正：`GitStablePointCreate` 模型工具路径现在先判定 `context.permissionMode === "plan"` 并直接拒绝，记录 failure evidence + `stable_point_denied result=plan_read_only`，回灌 `tool_result` 为 `ok:false/outcome:"plan_read_only"`。
- 保留：default/auto-review 仍先进 PermissionPanel，yes 后才执行；full-access 仍按既有策略直接执行；slash `/git stable create` / `/checkpoint create` 仍为显式用户动作路径，不额外双确认。
- 输出复核：pending summary 的普通 `writeLine(summaryText)` 已加 `!context.isInkSession` 守卫，避免 Ink PermissionPanel 场景主屏重复。

### P2-1 provider eventstream CRC mismatch 归因/展示

**源码根因**：
`packages/tui/src/request-lifecycle-presenter.ts` `classifyProviderFailure` 没有传输层分类。CRC mismatch / stream decode / retry exhausted 落到 `generic` → 文案"模型请求未完成，可运行 /model doctor"，未明确归因为 provider/transit failure，用户难以区分是 provider 问题还是 Linghun 缺陷。

**修复位置**：
- `request-lifecycle-presenter.ts`：
  - `classifyProviderFailure` 新增 `transit` 分类：`PROVIDER_STREAM_ERROR` / `PROVIDER_STREAM_DECODE_ERROR` / `PROVIDER_RETRY_EXHAUSTED` 码，或消息含 crc/checksum/eventstream/stream decode/decode mismatch/malformed sse/retry exhausted（中英）。排在 gateway/timeout/schema 之前。
  - `formatProviderFailurePrimary` 加 transit 文案（中英）：明确"provider/网络传输问题，不是 Linghun 本地缺陷"。
- `packages/providers/src/index.ts`：`normalizeProviderError` 对普通 Error message 命中 CRC/checksum/eventstream/stream decode/retry exhausted 时归一为 `PROVIDER_STREAM_DECODE_ERROR` 或 `PROVIDER_RETRY_EXHAUSTED`，保留 cause，不吞异常。
- `index.ts` `recordProviderFailureEvidence`：provider/transit failure 的 evidence / failure learning 摘要标注 `provider/transit failure`，rootCause/avoidNextTime 指向 provider/network transit，不建议乱改 route/env/key/model；仍用 `sanitizeProviderFailureText` 脱敏 baseUrl/key/raw。
- `model-doctor-runtime.ts`：`last provider failure` 增加 `kind=provider/transit`，details 仍指向 `/details evidence`，不输出 baseUrl/key/raw response。
- **未改** provider route、retry 机制、env/key/model 选择；只改善分类、摘要、diagnostics 与 failure learning 文案。

**行为矩阵**：

| 错误特征 | 分类 | 主屏归因 |
|---------|------|---------|
| CRC mismatch / eventstream decode | transit | "provider/网络传输问题，不是 Linghun 本地缺陷" |
| PROVIDER_STREAM_DECODE_ERROR / RETRY_EXHAUSTED 码 | transit | 同上 |
| PROVIDER_STREAM_ERROR | transit | 同上，符合 Run 1 provider stream error 归因 |
| 502/503/504 | gateway | 上游网关异常 |
| timeout | timeout | 等待过久 |

### P3-1 代码事实检查前置过度

**源码根因**：
`packages/tui/src/final-answer-gate.ts` `checkEvidenceGate` 的 `asksCodeFact = /代码|函数|实现|修复|验证|code|function|.../` 太宽，在 `sendMessage` 早期前置 return（`index.ts:5726`）。导致"写一个 add 函数 / write an add function"等从零写新代码/教学请求被当成"涉及当前仓库代码事实的结论"前置拦截，根本到不了模型，无法测试 code hygiene。

**修复位置**：
- `final-answer-gate.ts`：
  - `checkEvidenceGate` 改为先调新 `isCurrentRepoFactClaimRequest(text)` 判定；evidence 充分性判定逻辑不变。
  - 新增 `isCurrentRepoFactClaimRequest`：只有"对当前仓库已有事实下结论/确认状态"（已实现吗/有没有/是否通过/已完成/已修复/已刷新/架构一致/无漂移/in the code/tests pass 等）才前置取证；"从零写新代码/示例/教学/新增组件"和"修复/修改当前仓库文件"这类行动请求放行到模型/工具路径（写入仍走 read-before-edit 与权限管道）。裸位置词（当前项目/这个仓库/repo）不算事实声明。
- **未恢复** 本地 NL 关键词截获——普通请求仍照常进模型，这里只决定是否在请求前要求取证。
- **未改** D.13U `evaluateFinalAnswerClaims` / D.13V `runArchitectureAndCompletenessFinalGate` 判定语义（"确认所有测试通过/已完成/无架构漂移"在 final answer 侧仍受约束）。

**行为矩阵**：

| 输入 | 前置取证 | 说明 |
|------|---------|------|
| 写一个 add 函数 / write an add function | 否 | 从零 authoring，进模型 |
| 在当前项目里新增一个组件 | 否 | authoring，写入走权限 |
| 这个仓库里 add 函数已经实现了吗 | 是 | 当前仓库事实声明 |
| 确认所有测试通过 / 已经完成 | 是（前置）+ D.13U/D.13V（final） | 事实断言 |
| 修复当前仓库里的这个 bug | 否 | 行动请求进入模型/工具路径；写入仍必须先读相关文件并走权限 |

### P3-2 Ctrl+O 折叠提示重复

**源码根因**：D.14D-R 已修（`tool-output-presenter` 去重 + `view-model.createOutputBlock` 的 `stripEmbeddedFoldHint`）。

**修复位置**：
- `packages/tui/src/tool-output-presenter.ts`：D.14D-R 已做 presenter 侧提示去重。
- `packages/tui/src/shell/view-model.ts`：D.14D-R 已做 `createOutputBlock` 的 `stripEmbeddedFoldHint`，避免主屏 fullText + nextAction 双提示。
- `packages/tui/src/shell/view-model.test.ts`：本阶段新增/保留 `D.14D-R2 P3-2` focused 回归，锁定同一 output block 主屏最多一次 Ctrl+O。

**复核结论**：CLOSED_BY_D14D_R。本阶段 source+focused 复核确认：真实 `formatToolOutput` 产出经 `createOutputBlock` 后，presenter 自身只一次 Ctrl+O、ink 渲染层（fullText+nextAction）只一次 Ctrl+O。plain fallback 不受影响（非 TTY 读 raw output.text，内嵌提示保留）；details 层仍可展开。

**行为矩阵**：

| 场景 | 行为 |
|------|------|
| TTY 主屏同一 output block | 最多一次 "Ctrl+O 查看完整内容" 或同义提示 |
| details 展开 | 仍能看到完整内容 |
| plain / 非 TTY fallback | 保留必要 raw/fallback 提示，不破坏脚本化输出 |
| 重复渲染同一块 | 不叠加第二个 Ctrl+O 提示 |

## 验证命令

- `corepack pnpm exec tsc --noEmit`（repo root）：PASS（exit 0）
- focused：
  - `cd packages/tui; corepack pnpm exec vitest run src/index.test.ts -t "GitStablePointCreate|stable point"`：PASS（13 tests；覆盖 plan 直接拒绝、default pending+yes、deny 不创建、final gate 防空口 stable point claim）
  - `cd packages/tui; corepack pnpm exec vitest run src/permission-panel-invariant.test.ts`：PASS（6 tests；覆盖 plan 分支在 pending 前、Ink pending writeLine 守卫）
  - `cd packages/tui; corepack pnpm exec vitest run src/model-loop-runtime.test.ts -t "D.13U|D.13V|git_operation|stable point"`：PASS（60 tests；覆盖 D.13U/D.13V git_operation claim 语义）
  - `cd packages/providers; corepack pnpm exec vitest run src/index.test.ts -t "normalizes eventstream CRC mismatch"`：PASS（1 test）
  - `cd packages/tui; corepack pnpm exec vitest run src/git-tool-runtime.test.ts src/git-operation-runtime.test.ts src/provider-transit-failure.test.ts src/code-fact-gate.test.ts src/permission-panel-invariant.test.ts src/tool-output-presenter.test.ts src/model-loop-runtime.test.ts src/failure-learning-runtime.test.ts src/failure-learning-presenter.test.ts`：PASS（9 files / 250 tests）
  - `cd packages/tui; corepack pnpm exec vitest run src/index.test.ts -t "GitStablePointCreate|stable point|provider failure|last provider failure|D.13U|D.13V"`：PASS（48 tests）
  - `cd packages/tui; corepack pnpm exec vitest run src/index.test.ts -t "provider stream errors|provider failure|last provider failure"`：PASS（3 tests）
- package/full local verification：
  - `cd packages/tui; corepack pnpm exec vitest run`：PASS（50 files / 1969 tests）
  - `corepack pnpm --filter @linghun/tui build`：PASS
  - `corepack pnpm --filter @linghun/cli build`：PASS
  - `corepack pnpm --filter @linghun/providers build`：PASS
  - `git diff --check`：PASS
- 根目录 `vitest run` 初次尝试被 `.claude/worktrees/...` 测试副本误扫并失败（缺 `react/jsx-dev-runtime`）；随后改按 `packages/tui` / `packages/providers` cwd 运行 focused 验证，避免把历史 worktree 当本仓库测试目标。
- `cd packages/providers; corepack pnpm exec vitest run`：FAIL（6 个既有 provider fixture 用例缺 `content-type: text/event-stream`，触发 `PROVIDER_NON_SSE_STREAM`；与本阶段 CRC/transit 分类改动无关，未按本阶段边界顺手修）。

## 使用方式

- 模型工具路径：用户自然语言请求创建 stable point 时，default/auto-review 下先看到 PermissionPanel；选择 yes 才创建，选择 no 不创建且模型收到明确 NOT created 的 tool_result。plan 模式直接拒绝并回灌 `stable point was NOT created because Plan mode is read-only.`。
- slash 路径：`/git stable create` / `/checkpoint create` 仍按既有显式用户动作语义执行，不额外叠加第二层确认。
- provider/transit 归因：真实 provider stream decode / CRC / retry exhausted 类失败在主屏、doctor/details、failure learning 中显示 provider/网络传输归因。
- code fact gate：普通"写一个函数/示例/组件"进入模型/工具路径；当前仓库事实确认类请求仍要求取证。

## 配置项

- 未新增配置项。
- 未修改 provider/env/key/model route。
- 未修改权限四档：`default` / `auto-review` / `plan` / `full-access`。

## 命令

- 用户确认 stable point：PermissionPanel yes/no。
- 显式 stable point slash：`/git stable create`、`/checkpoint create`。
- provider 诊断入口：`/model doctor`、`/details evidence`。
- 输出详情入口：`Ctrl+O`（TTY）或 plain mode fallback 输出。

## 关键设计

- P1-1 复用既有 `pendingLocalApproval` / PermissionPanel 管道，只新增 `git_stable_point` pending kind；不新增第五种权限模式。
- P2-1 只做错误归一、展示分类和 failure learning 文案，不改变 provider route、retry、env/key/model 选择。
- P3-1 只收窄输入侧 fact gate 触发范围，不改变 D.13U/D.13V final gate 语义。
- P3-2 保持 D.14D-R 的去重实现，本阶段只复核并用 focused test 锁住行为。

## 性能结果

- 本阶段无性能路径改动。
- 验证范围为 typecheck、focused vitest、`@linghun/tui` full vitest、TUI/CLI/providers build 和 diff check；未运行真实 provider 压测。

## 已知问题

- `packages/providers` full vitest 仍有 6 个非本阶段 fixture 失败：mock response 缺 `content-type: text/event-stream`，导致 `PROVIDER_NON_SSE_STREAM`。本阶段只修 Run 1 已确认 P1-P3，未扩大范围修 provider fixture。
- 根目录 `vitest run` 会扫到 `.claude/worktrees/...` 历史测试副本并产生依赖噪音；本阶段采用 package cwd 的 focused/full 验证作为 acceptance。
- 当前工作区存在大量本阶段前已有/并行产生的文档搬迁、未跟踪目录和根 README 改动信号；本阶段未把这些纳入 D.14D-R2 完成范围，也未删除或回滚。

## 不在本阶段处理的内容

- 不进入 Run 2；Run 2 等本阶段由用户确认后另开窗口重新压测。
- 不跑真实 provider 压测；Run 1.5 已 early-stopped，不作为 acceptance 数据。
- 不修改 Run 1 / Run 1.5 压测报告正文。
- 不修改 provider/env/key/model route、权限四档语义、anti-hallucination/final gate 判定语义。
- 不恢复本地自然语言关键词截获。
- 不进入企业微信/钉钉/飞书远程通道。
- 不 commit，不删除历史 untracked，不批量格式化。

## 下一阶段衔接

下一步停在 D.14D-R2 阶段边界，等待用户确认是否启动 Run 2 真实 provider 复测。Run 2 必须重新覆盖本报告 Handoff 中列出的 case，不复用 Run 1.5 作为 acceptance。

## 开发者排查入口

- Stable point 权限：`packages/tui/src/git-tool-dispatch-runtime.ts`、`packages/tui/src/index.ts`、`packages/tui/src/shell/view-model.ts`、`packages/tui/src/pending-details-presenter.ts`
- Provider/transit 归因：`packages/providers/src/index.ts`、`packages/tui/src/request-lifecycle-presenter.ts`、`packages/tui/src/index.ts`、`packages/tui/src/model-doctor-runtime.ts`
- Code fact gate：`packages/tui/src/final-answer-gate.ts`、`packages/tui/src/code-fact-gate.test.ts`
- Ctrl+O 去重：`packages/tui/src/tool-output-presenter.ts`、`packages/tui/src/shell/view-model.ts`、`packages/tui/src/shell/view-model.test.ts`

## 参考核对

- 本阶段读取并遵守 Linghun 文档：
  - `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
  - `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
  - `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
  - `F:\Linghun\docs\delivery\README.md`
- 本阶段使用 Run 1 已确认问题作为唯一修复输入；Run 1.5 已 early-stopped，不作为 acceptance 数据。
- 本阶段未参考、复制或移植可疑 CCB / CCB Dev Boost 源码实现；只遵守既有 Linghun clean rewrite、权限管道、provider 错误归一、primary/details/debug 输出分层和 evidence gate 边界。
- codebase-memory 未作为硬阻塞前置使用；本轮依据源码、focused tests、typecheck/build 和交付文档事实确认。

## 阶段 Verdict

- `D.14D-R2`: COMPLETE_FOR_USER_REVIEW
- Acceptance scope: Run 1 已确认 P1-P3 only。
- Run 1.5: early-stopped，不作为 acceptance 数据。
- Run 2: 未进入，等待用户确认后另开窗口复测。
- 验证口径：本地/source/focused/full TUI/build/diff-check；未运行真实 provider 压测。

## 真实改动文件

- `packages/providers/src/index.ts`
- `packages/providers/src/index.test.ts`
- `packages/tui/src/final-answer-gate.ts`
- `packages/tui/src/git-tool-dispatch-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/model-doctor-runtime.ts`
- `packages/tui/src/pending-details-presenter.ts`
- `packages/tui/src/permission-panel-invariant.test.ts`
- `packages/tui/src/request-lifecycle-presenter.ts`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/shell/view-model.test.ts`
- `packages/tui/src/code-fact-gate.test.ts`
- `packages/tui/src/provider-transit-failure.test.ts`
- `docs/delivery/phase-14D-R2-real-stress-p1-p3-closure.md`

## 运行时事实

- Provider/model route: 未修改。
- Permission modes: 未修改四档语义；`GitStablePointCreate` default/auto-review 复用既有 pending approval，plan 保持只读直接拒绝，full-access 按既有策略执行。
- Remote channels: 未进入企业微信/钉钉/飞书远程通道。
- Real provider stress: 未运行 Run 2；未把 Run 1.5 当 acceptance。
- Git: 未 commit；未删除历史 untracked；未批量格式化。
- Index: 本阶段未刷新/重建 codebase-memory。

## 成品级结构化 handoff packet

```yaml
phase: D.14D-R2 Real Stress P1-P3 Closure
status: complete_for_user_review
acceptance_scope:
  source: Run 1 confirmed P1-P3 only
  run_1_5: early_stopped_not_acceptance
  run_2: not_started
next_phase: Run 2 real provider retest, only after user confirmation
must_not_do_next:
  - do_not_reuse_run_1_5_as_acceptance
  - do_not_change_provider_env_key_model_route_without_new_scope
  - do_not_relax_permission_modes
  - do_not_restore_local_nl_keyword_interception
  - do_not_enter_remote_channels
  - do_not_commit_without_user_request
evidence_refs:
  - docs/delivery/phase-14D-R2-real-stress-p1-p3-closure.md
  - packages/tui/src/git-tool-dispatch-runtime.ts
  - packages/tui/src/request-lifecycle-presenter.ts
  - packages/tui/src/final-answer-gate.ts
  - packages/providers/src/index.ts
verification:
  typecheck: "corepack pnpm exec tsc --noEmit: PASS"
  tui_focused: "9 files / 250 tests: PASS"
  tui_index_focused: "48 tests + 3 provider stream tests: PASS"
  tui_full: "50 files / 1969 tests: PASS"
  provider_crc_focused: "1 test: PASS"
  builds: "@linghun/tui, @linghun/cli, @linghun/providers: PASS"
  diff_check: "PASS"
  known_non_scope_failure: "packages/providers full vitest: 6 existing SSE fixture failures"
index_status: not_refreshed_this_turn
permission_mode: default_session; product permission modes unchanged
provider_model_budget:
  provider_route_changed: false
  model_route_changed: false
  real_provider_stress_run: false
  budget_used: not_measured_in_product_runtime
```

## 边界遵守

- 未改 provider/env/key/model route 真实逻辑；未改权限四档语义（仅复用既有 pendingLocalApproval 管道加 stable point 确认）。
- 未改 anti-hallucination/final gate 判定语义（P3-1 只收窄前置 gate 触发范围，D.13U/D.13V final gate 不动）。
- 未恢复本地 NL 关键词拦截。
- 未 commit；未删除历史 untracked；未批量格式化。
- index.ts 只做最薄 glue 和既有 provider failure evidence 接线（stable point 业务逻辑在 git-tool-dispatch-runtime；gate 逻辑在 final-answer-gate；归因在 request-lifecycle-presenter / provider normalize / doctor presenter）。
- 未读取/篡改 Run 1 / Run 1.5 压测报告正文；Run 1.5 已 early-stopped，不作为 acceptance 数据。

## Handoff：Run 2 应复测的 case

1. default 模式自然语言"帮我建立一个稳定点" → 出 PermissionPanel → yes 后真实 commit；no 后 HEAD 未变、模型不空口声称已建。
2. plan 模式自然语言"帮我建立一个稳定点" → 直接拒绝；不出现可执行 yes 确认；不创建 commit/snapshot；tool_result 含 `stable point was NOT created because Plan mode is read-only.`。
3. full-access 模式同请求 → 直接创建，仍有 git_operation evidence。
4. slash `/git stable create` / `/checkpoint create` → 保持显式用户动作既有语义，不新增重复确认。
5. 真实 provider CRC mismatch / stream decode 失败 → 主屏显示"provider/网络传输问题，不是 Linghun 本地缺陷"，/model doctor 显示 transit 归因；failure learning 标 provider_failure，无 baseUrl/key 泄漏。
6. "写一个 add 函数" / "修复当前仓库里的这个 bug" → 进模型/工具路径（不被输入侧前置 gate 截断）；写文件仍走读文件与权限确认；"这个仓库里 X 实现了吗" → 前置取证或工具取证。
7. 同一工具输出块主屏只一次 Ctrl+O。
8. 复测确认 P3-1 收窄未误放过真正的"已完成/已通过"事实声明（final gate 仍降级）。

## 涉及模块

- `packages/tui/src/git-tool-dispatch-runtime.ts`（stable point 确认 + resolve）
- `packages/tui/src/index.ts`（薄 glue：pending kind + approve/deny 分支 + import）
- `packages/tui/src/shell/view-model.ts`（git_stable_point PermissionPanel 映射）
- `packages/tui/src/pending-details-presenter.ts`（git_stable_point details）
- `packages/tui/src/request-lifecycle-presenter.ts`（transit 分类 + 归因文案）
- `packages/providers/src/index.ts`（CRC/eventstream 普通 Error 归一为 provider stream decode）
- `packages/tui/src/model-doctor-runtime.ts`（last provider failure kind=provider/transit）
- `packages/tui/src/final-answer-gate.ts`（code-fact 前置 gate 收窄）
- 测试：`index.test.ts`、`shell/view-model.test.ts`、`provider-transit-failure.test.ts`（新增）、`code-fact-gate.test.ts`（新增）、`packages/providers/src/index.test.ts`
