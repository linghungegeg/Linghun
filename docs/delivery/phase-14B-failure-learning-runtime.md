# Phase D.14B — Failure Learning / Fact-Based Reflection Runtime 产品闭环

> 阶段：D.14B
> 日期：2026-05-30
> 工作目录：`F:\Linghun`
> 类型：成品级第一版。让 Linghun 从真实失败中提取可复用教训，并在后续相似任务中提醒模型避免重复错误。
> 入口分层：失败事件由 runtime 在已判定失败的真实站点搭车记录 → 脱敏 + 去重持久化 → 紧凑摘要进 system prompt 当风险提示 → `/failures` 只读/写状态入口 → 反幻觉 gate 仍要求 evidence，失败摘要不构成 completion 证据。

## 0. 命名澄清（重要）

仓库里 **"D.14B" 编号此前已被另一套功能占用**：`tui-memory-runtime.ts` / `memory-command-runtime.ts` 中标注 `D.14B Controlled Learning` 的**受控记忆学习**（从用户输入提取偏好候选，`index.test.ts` 有 15 个 `D.14B:` 测试）。

本阶段的 **Failure Learning（从真实失败提取教训）** 与那套是**两套独立系统**：

- 受控记忆学习：来源是**用户输入**，提取偏好/协作规则，候选需 `/memory accept`，进 `ControlledMemorySummary`。
- 失败学习（本阶段）：来源是**真实失败事件**（provider/tool/verification/git/final gate/report guard/resource cap），自动记录，进 `FailureLearningSummary`，只当风险提示。

**本阶段完全没有改动那套记忆学习系统。** 新系统用独立 `failure-learning` 命名、独立 `D.14B Failure Learning` 测试前缀、独立存储目录 `.linghun/failures`。

## 1. 源码 Reality Check（existing / 复用点 / gaps / 新增点）

开工前用 3 个并行调查智能体 + 精读确认现状：

**已有可复用（不重建）：**
- 失败信号大多已结构化记录：
  - `recordProviderFailureEvidence`（`index.ts`）：写 evidence + `context.lastProviderFailure` + system_event。
  - `recordToolFailureEvidence`（`index.ts`）：工具异常路径，写 evidence + `tool_result.isError`。
  - `isToolOutputFailure`（`index.ts`）：Bash 退出码非 0 判定。
  - `recordVerificationEvidence`（`index.ts`）：`verification_end` 事件含 exitCode/status，最完整。
  - `recordReportIncompleteEvidence`（`index.ts`）：report guard 拦截。
  - git 失败：`git-tool-dispatch-runtime.ts` 的 `git_operation_failed` 事件 + `executeGitToolUse` 返回 `ok=false`。
  - final gate 降级：`index.ts` 两条路径的 `final_answer_claim_gate downgrade`。
- 存储/脱敏/slash/去重全有范本：
  - 存储：`tui-memory-runtime.ts` 的"一记录一 `<id>.json`"；config 已导出 `getProjectConfigDir`。
  - 脱敏：`sanitizeProviderFailureText`（sk-/Bearer/api_key/盘符/绝对路径）、`containsSecret`、`SENSITIVE_UNTRACKED_PATTERNS`、`redactedPath`。
  - 去重 hash：`cache-freshness.ts` 的 `stableHash`（sha256 前 12）。
  - slash：`memory-command-runtime.ts` 的 `handleMemoryCommand` + `configureXxxRuntime(deps)` 注入 + `showCommandPanel` summary-first。
  - prompt 投影：`model-prompt-runtime.ts` 的 `worktreeContextLine` 条件注入范式。

**gaps：** 没有任何失败学习聚合层（`failureLearning`/`learnFromFailure` 全仓零命中）。我是这些散落失败信号的**第一个聚合消费者**，不是造第二套系统。

**必须避坑（reality check 关键发现）：** 用户取消/权限拒绝当前也走 `recordToolFailureEvidence` 打 `tool_failure` 标签（`executePermissionDeny`）。所以 D.14B **只在真实失败站点搭车记录**，**绝不**在 `executePermissionDeny` / interrupt 路径埋点。

**新增点（最小）：**
- 新模块：`failure-learning-runtime.ts`（业务逻辑：脱敏/去重/记录/加载/prompt 摘要/状态写入）、`failure-learning-presenter.ts`（`/failures` 视图）、`failure-learning-command-runtime.ts`（slash handler）+ 对应 3 个 test。
- 类型：`tui-data-types.ts` 加 `FailureLearningRecord` / `FailureLearningState` / 相关枚举。
- `index.ts` 薄接线：`captureFailureLearning` glue 函数 + 6 类失败站点各加一行调用 + `TuiContext.failureLearning` 字段 + init/hydrate + `/failures` dispatch + deps 注入 + prompt 投影传参。
- `model-prompt-runtime.ts`：加可选 `failureLearningSummary` 参数 + 注入 + 约束文案。
- `slash-dispatch.ts` / `natural-command-bridge.ts`：`/failures` help 与能力登记。

## 2. 主链接入图

```
真实失败事件（已存在的判定站点，未新增失败检测）
  │
  ├─ executeModelToolUse catch（工具异常）         ─┐
  ├─ executeModelToolUse isError（Bash 退出码非0）  │
  ├─ recordProviderFailureEvidence（provider 失败） │
  ├─ recordVerificationEvidence（fail/partial/timeout）
  ├─ recordReportIncompleteEvidence（report guard） │  搭车一行
  ├─ executeGitToolUse 返回 ok=false 且非 pending   │  captureFailureLearning(context, sessionId, {...})
  ├─ final gate downgrade（sendMessage + continuation 两路）
  └─ sendMessage 并发上限拒绝（resource cap）      ─┘
                                                     │
                                  failure-learning-runtime.ts
                                  ├─ sanitizeFailureText（集中脱敏）
                                  ├─ failureDedupeHash（脱敏后 category+target+归一化 message）
                                  ├─ mergeFailureRecord（去重合并 count/lastSeen）
                                  └─ writeFailureRecord（.linghun/failures/<id>.json）
                                                     │
   ┌─────────────────────────────────────────────────┼─────────────────────────────┐
   │ prompt 投影                                        │ 用户入口                       │
   │ buildFailureLearningSummaryForPrompt(state)        │ /failures（command-runtime）    │
   │  → createModelSystemPrompt 末尾                    │  → buildFailureLearningPanel    │
   │     FailureLearningSummary=... + FailureLearningRule│     summary-first / details     │
   │  （只当风险提示，不构成 completion evidence）         │  /failures resolve|ignore <id>  │
   └────────────────────────────────────────────────────┴─────────────────────────────┘
```

- 启动时 `loadFailureRecords` 从 `.linghun/failures` 读回（hydrate 在 `hydrateDurableJobBackgroundTasks` 之后）。
- `captureFailureLearning` 自身 try/catch 包裹：失败学习是加性能力，记录自身失败不得影响主链。

## 3. 记录哪些失败 / 不记录哪些事件

| 记录（真实失败） | 站点 | category | severity |
| --- | --- | --- | --- |
| 工具异常（throw） | `executeModelToolUse` catch | `tool_failure` | medium |
| Bash/命令退出码非 0 | `executeModelToolUse` isError 分支 | `tool_failure` | medium |
| provider/model 请求失败 | `recordProviderFailureEvidence` | `provider_failure` | high（rate-limited 提示退避） |
| 验证 fail/partial/timeout | `recordVerificationEvidence` | `verification_failure` | high/medium |
| report guard 未满足 | `recordReportIncompleteEvidence` | `report_guard` | medium |
| git 操作失败/拒绝 | `executeGitToolUse` 返回 ok=false 且非 pending | `git_operation_failure` | medium |
| final answer gate 降级 | sendMessage + continuation 两路 downgrade | `final_gate_downgrade` | high |
| 并发上限拒绝 | `sendMessage` model resource cap | `resource_cap` | low |

| 不记录（非模型失败） | 原因 |
| --- | --- |
| 用户取消（Ctrl-C / interrupt） | 不是模型失败；`executePermissionDeny`/interrupt 路径不挂 capture |
| 权限拒绝（用户选 no / 未授权） | 同上；正常拒绝不是失败 |
| verification cancelled / stale / skipped | cancelled 是用户取消；stale 是过期非失败；skipped 非失败 |
| git worktree remove 等待确认（pendingApproval） | 等待确认不是失败，明确排除 |
| provider circuit breaker cooldown | 本阶段未纳入（只读内存 state，无结构化事件）；见已知限制 |

## 4. 脱敏策略（集中、写入前统一执行）

`sanitizeFailureText`（`failure-learning-runtime.ts`）按顺序剥离后再归一化空白：
- `sk-***`、provider token（`ghx-***`/`AKIA-***`/`xox-***`）、PRIVATE KEY 块 → `[private-key]`
- `Authorization=***`、`Bearer ***`、`api_key/token/secret/password/credential/access_key = ***`
- http(s) URL（baseUrl）→ `[url]`
- Windows 盘符路径 `C:\...` 与 Unix 多段绝对路径 → `[local-path]`

衍生约束：
- `sanitizeRelatedTarget`：关联目标也脱敏 + 截断 80。
- `resolveFailureProjectScope`：项目作用域键 = 脱敏后的目录 basename，**绝不含绝对路径**。
- `failureDedupeHash`：基于**脱敏后**的 category + target + 归一化 message（小写、数字串 → `#`，消除行号/时间戳瞬时差异），sha256 前 12；hash 输入已脱敏，不含 secret/baseUrl/绝对路径。
- 所有字段经 `clamp`（脱敏 + 截断）后才进记录；持久化 JSON 不含 key/baseUrl/token/长绝对路径。
- 单测专门覆盖：sk-/Bearer/api_key/Authorization/baseUrl/Windows+Unix 路径/private key/provider token 脱敏，且持久化文件与 prompt 摘要均不含上述敏感内容。

## 5. Prompt 接入边界（反幻觉）

- `createModelSystemPrompt` 新增可选参 `failureLearningSummary`；仿 `worktreeContextLine` 条件注入。
- 注入内容 `FailureLearningSummary=`：紧凑 JSON，只含 `{category, avoid, severity, count}`，仅当前项目 active、按 severity→最近排序、最多 5 条、总长 ≤900 字。**不含** sourceRef 内部细节、secret、baseUrl、长路径。
- 约束文案 `FailureLearningRule=`：明确"这是本项目**过去**真实失败的教训，仅作风险提示；**不代表**当前任务已失败/已修复/已验证；只用于复查风险步骤，**绝不**当作已完成/已修复/已验证的证据；要说'历史记录显示/可能相关'，不要当本轮事实。"
- **不新增 `FinalAnswerClaimKind`**：D.14G 加 claim kind 是为了让真实 git 操作*放行*；本阶段需求相反——是*防止*基于历史失败的空声明。现有 `completion_pass` 已拦截空口"已修复"。
- **失败摘要只进 prompt，绝不进 `context.evidence`**：因此天然不会被任何 D.13U/D.13V supporter 当作 completion evidence。这是不破坏既有 gate 语义的关键。
- 无 active 教训时不注入（`buildFailureLearningSummaryForPrompt` 返回 null）。

## 6. Slash / User-facing 行为

`/failures`（command-runtime，summary-first）：
- `/failures` | `/failures list`：`showCommandPanel` 面板。summary 显示 active/resolved/ignored 计数 + 最近 3 条高价值 active 教训的"下次避免"人话 + "这些是历史风险提示，不代表问题已修复"。details（Ctrl+O）含 root cause（标注"推断"）、severity、lastSeen、source（内部 evidence id，等同 memory 的 `source=`，非 secret）。
- `/failures resolve <id>`：标记已解决，写回 `<id>.json`，不再投影给模型；写状态走现有 `appendSystemEvent` 生命周期记录，**不新增权限模式**。
- `/failures ignore <id>`：忽略但保留记录，不再进 prompt/主屏。
- 主屏摘要与 details 都经脱敏（记录写入时已脱敏），不泄漏 secret/baseUrl/token/长绝对路径。
- 中英双语；`/help all`、natural-command-bridge 能力目录已登记 `/failures`。

## 7. 与反幻觉系统结合

- final answer **不得**仅凭 `FailureLearningSummary` 声称"已修复/已验证/已完成"——失败摘要不进 evidence 通道，`completion_pass` gate 不认它。
- `FailureLearningSummary` 只降低风险、提醒检查，不替代 evidence。
- 模型引用历史失败时，prompt 约束要求说"历史记录显示/可能相关"，不当本轮事实。
- D.13U/D.13V gate 判定语义**零改动**：本阶段只在 downgrade 已发生后搭车记录一条 learning，不改 gate 的 retry/downgrade 判定顺序、不改 `finalAnswerClaimRetried` 单次预算、不改 closure 排序。既有 D.13U(5)/D.13V(29) 测试全过验证未破坏。

## 8. 存储

- 路径：`<project>/.linghun/failures/<id>.json`（项目作用域，用户确认选项），用 config 已导出的 `getProjectConfigDir`，**未改 @linghun/config**。
- 格式：一记录一 JSON（模仿 memory），`JSON.stringify(record, null, 2)+"\n"`。
- Windows 兼容：全程 `node:path` `join`。
- 上限 100 条；加载按 lastSeen 倒序；坏文件 try/catch 跳过不打断。
- 写入前集中脱敏；key/baseUrl/token 不入持久化（单测锁定）。

## 9. 实现边界确认

- 新业务逻辑全在 `failure-learning-*.ts`；`index.ts` 只做薄接线（capture 调用、dispatch、deps 装配、prompt 传参）。源码不变式测试 `D.14B source invariant` 锁定：`index.ts` 不重新实现 `sanitizeFailureText`/`failureDedupeHash`/`buildFailureLearningSummaryForPrompt`，这些只在 runtime 模块。
- 未改 D.14G Git 行为。
- 未改 D.13U/D.13V gate 既有语义（只加性搭车记录 + prompt 注入）。
- 未新增权限模式；未绕过 permission / pending approval / final answer gate。
- 未改 provider/env/key/model route 选择逻辑。
- 未恢复 FreshnessLite。
- 未做 hooks/tmux/stale cleanup/branch -D/reset --hard。
- 未删除历史 untracked 文件。
- 未用本地自然语言关键词拦截做失败学习（自然语言正常进 model loop；失败学习来自**输出侧真实事件**，不是输入侧 regex）。
- 未引入新依赖。

## 10. 测试与验证结果

### 新增测试

| 文件 | 覆盖 |
| --- | --- |
| `failure-learning-runtime.test.ts`（19） | 脱敏（sk-/Bearer/api_key/Authorization/baseUrl/Win+Unix 路径/private key/provider token）、项目作用域非绝对路径、去重 hash（归一化/不同 category/不含敏感）、merge count/lastSeen、resolved 重新 active、记录 inferred 标记、持久化 `.linghun/failures/<id>.json` + 重载 + 不含敏感、坏文件跳过、prompt 摘要 null/脱敏/排除 ignored-resolved/severity 排序 |
| `failure-learning-presenter.test.ts`（5） | 空态 neutral 无 actions、active 露出 avoid + 风险提示且不泄漏 sourceRef、details 标注"推断"+ resolve/ignore note、英文 locale、resolved 不计入 active |
| `index.test.ts` D.14B（7） | 用户取消/权限拒绝**不**记为模型失败、`/failures` summary-first 不泄漏 baseUrl/secret、`/failures resolve` 改状态并持久化、prompt 注入含 FailureLearningRule 且无 secret、无 active 不注入、final gate 降级落盘 `final_gate_downgrade`、源码不变式（index.ts 只 glue） |

测试原则遵守：未用"自然语言 regex 命中"作为核心测试；核心是脱敏/去重/各类失败记录/取消不误记/prompt 边界/slash/源码不变式。

### 验证命令结果

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | PASS（exit 0） |
| `corepack pnpm --filter @linghun/tui build` | PASS |
| `corepack pnpm --filter @linghun/cli build` | PASS |
| `git diff --check` | PASS（无冲突标记/空行问题） |
| `... vitest run src/failure-learning-runtime.test.ts` | 19 passed |
| `... vitest run src/failure-learning-presenter.test.ts` | 5 passed |
| `... vitest run src/index.test.ts -t "D.14B Failure Learning Runtime"` | 7 passed |
| `... vitest run src/model-loop-runtime.test.ts` | 123 passed |
| `... vitest run src/index.test.ts -t "D.13U"` | 5 passed |
| `... vitest run src/index.test.ts -t "D.13V"` | 29 passed |
| `... vitest run src/index.test.ts -t "D.14G"` | 11 passed |
| `corepack pnpm --filter @linghun/cli exec vitest run src/main.test.ts` | 8 passed |
| `... vitest run`（全量 tui） | 44 failed / **1806 passed** |

### 全量 failure-name diff（不只报数字）

- 基线（D.14G-Refactor-Closure 交付）：44 failed / 1775 passed。
- 本轮：44 failed / **1806 passed**（+31 全部为本轮新增：failure-learning unit 24 + D.14B index 7）。
- **新增失败：0**。
- 44 个失败全部落在既有 `Phase 06 TUI slash commands` runTui-mock baseline 组（根因：测试读到本机真实 provider env → 模型解析为 `claude-opus-4-7` 走 `/v1/messages`，OpenAI 格式 mock 触发 schema/非-SSE 错误）。无任何 failure-learning 测试出现在失败集合。
- D.14B 的 runTui 测试（final gate 降级落盘）用 `isolateModelEnv`（隔离 `LINGHUN_CONFIG_DIR` + 清 provider env）+ SSE content-type mock，确定性通过，未落入 baseline 失败组。

### biome

- 新文件 `failure-learning-runtime.ts` / `failure-learning-presenter.ts` / `failure-learning-command-runtime.ts` + 2 个 test：lint 干净、已 biome 格式化。
- 被修改的既有文件 biome 错误数与基线持平，**未引入新 biome 错误**：index.ts 6=6、model-prompt-runtime 2=2、index.test.ts 5=5、tui-data-types 1=1、slash-dispatch 0、natural-command-bridge 0。既有错误为仓库历史 format/lint drift，不在本阶段最小改动范围内处理。

### Real model smoke

- 本轮**未跑 live smoke**。final gate 降级路径已由 runTui + SSE mock 确定性覆盖（模型空口"已完成,测试通过"无 evidence → 降级 → 落盘 `final_gate_downgrade`）。
- 剩余风险：未在真实 provider 上观察 provider 请求失败 → failure learning 的端到端（provider 失败路径由单测覆盖 `recordProviderFailureEvidence` 的 capture 接线，未做真实 5xx/限流真机触发）。

## 11. git status

```text
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
 M packages/tui/src/model-prompt-runtime.ts
 M packages/tui/src/natural-command-bridge.ts
 M packages/tui/src/slash-dispatch.ts
 M packages/tui/src/tui-data-types.ts
?? packages/tui/src/failure-learning-command-runtime.ts
?? packages/tui/src/failure-learning-presenter.test.ts
?? packages/tui/src/failure-learning-presenter.ts
?? packages/tui/src/failure-learning-runtime.test.ts
?? packages/tui/src/failure-learning-runtime.ts
?? docs/delivery/phase-14B-failure-learning-runtime.md
```

既有 untracked（未删除、未回滚）：`.claude/`、`AGENTS.md`、`D13D_TUI_FOUNDATION_PLAN.md`、`LINGHUN_CODE_FACT_AUDIT_REPORT_2026-05-27.md`、`LINGHUN_VS_CCB_SOURCE_COMPARISON.md`、`docs/delivery/phase-13V-BC-*.md`。
未 commit（由用户决定是否提交）。

## 12. index.ts 当前行数

- D.14G-Refactor-Closure 基线：7999。
- D.14B 收口后：**8179**（`git diff --shortstat HEAD -- index.ts` = 181 insertions / 1 deletion）。
- +180 全部是薄接线：`captureFailureLearning` glue 函数（约 18 行）+ 8 类失败站点各加一段调用 + `TuiContext.failureLearning` 字段 + init/hydrate + `/failures` dispatch + deps 注入 + prompt 传参 + 类型 import/re-export。
- 业务逻辑（脱敏/去重/记录/加载/摘要/视图）全在 `failure-learning-*.ts`（3 个新模块约 600 行），由源码不变式测试锁定不在 index.ts 重新实现。

## 13. 参考核对

- 实际读取的 Linghun 文档：`docs/delivery/phase-14G-git-stable-worktree-product-closure.md`（含 Refactor Closure Addendum）、项目记忆 `MEMORY.md` / `project_phase_status.md` / `project_engineering_baseline.md`。
- 实际精读的源码：`index.ts`（失败站点 / TuiContext / init / dispatch）、`tui-memory-runtime.ts`（存储范本）、`memory-command-runtime.ts`（slash 范本）、`model-prompt-runtime.ts`（prompt 投影范本）、`final-answer-gate.ts`（gate 边界）、`model-loop-runtime.ts`（claim 机制）、`cache-freshness.ts`（stableHash）、`command-panel-runtime.ts`、`tui-state-runtime.ts`、`git-tool-dispatch-runtime.ts`、`slash-dispatch.ts`、`natural-command-bridge.ts`、`@linghun/config`，及对应测试。
- 本地 CCB / 社区项目：本阶段**未读取** `F:\ccb-source`。失败学习不是 CCB 既有产品行为的吸收，而是 Linghun 反幻觉组合拳的自研扩展；仅复用 Linghun 自身已有的 evidence/event/脱敏/存储/prompt 范式。
- 行为参考 vs 自研：存储"一记录一 JSON"、slash deps 注入、prompt 条件注入为**复用 Linghun 既有范式**；脱敏扩展（baseUrl/Unix 路径）、去重 hash 归一化、失败分类、capture 接线、prompt 风险提示约束为 **Linghun 自研实现**。
- **未复制任何可疑源码实现、反编译痕迹、内部 API 或专有逻辑。**

## 14. 边界确认

- **未进入下一阶段。** 本阶段在阶段边界停止。
- 失败学习不是模型自我反思小作文：所有 learning 可追溯到具体失败事件（evidence id / event 标识）、命令/工具/provider/git 操作、category、脱敏摘要、时间、来源。
- 不允许模型凭空总结"学到了什么"：记录只在真实失败判定站点产生，模型无法直接写入。
- 用户取消/正常拒绝/权限未授予不误记为模型失败（单测锁定）。
- 未新增权限模式；未绕过 permission / pending approval / final answer gate。
- 未改 provider/env/key/model route；未改 D.14G Git 行为；未改 D.13U/D.13V gate 判定语义。
- 未恢复 FreshnessLite；未做 hooks/tmux/stale cleanup/branch -D/reset --hard；未删除历史 untracked 文件；未大范围重构或批量格式化。

## 15. 成品级结构化 Handoff Packet

```yaml
phase: D.14B
status: COMPLETE
next_phase: only after explicit user confirmation

scope_actually_done:
  - failure-learning-runtime.ts: sanitizeFailureText (集中脱敏) + failureDedupeHash + buildFailureRecord/mergeFailureRecord (去重合并 count/lastSeen) + writeFailureRecord/loadFailureRecords (.linghun/failures/<id>.json) + buildFailureLearningSummaryForPrompt + selectActiveLessons + setFailureRecordStatus
  - failure-learning-presenter.ts: buildFailureLearningPanel (summary-first) + formatFailureLearningDetails (Ctrl+O, 标注 inferred)
  - failure-learning-command-runtime.ts: handleFailuresCommand (status/list/resolve/ignore) + configureFailureLearningCommandRuntime deps 注入
  - index.ts thin glue: captureFailureLearning + 8 类失败站点搭车记录 + TuiContext.failureLearning + init/hydrate + /failures dispatch + deps 装配 + prompt 投影传参
  - model-prompt-runtime.ts: failureLearningSummary 参数 + FailureLearningSummary 注入 + FailureLearningRule 约束文案
  - tui-data-types.ts: FailureLearningRecord/FailureLearningState/枚举
  - slash-dispatch.ts + natural-command-bridge.ts: /failures help + 能力登记

forbidden_next_without_user_confirmation:
  - enter next phase
  - add a permission mode / change four-tier semantics
  - change provider/env/key/model route logic
  - change D.13U/D.13V/D.14G gate or git semantics
  - restore FreshnessLite
  - local NL keyword interception for failure learning
  - hooks/tmux/stale-cleanup/branch-D/reset
  - put business logic back into index.ts

evidence_refs:
  - file: F:/Linghun/packages/tui/src/failure-learning-runtime.ts
  - file: F:/Linghun/packages/tui/src/failure-learning-presenter.ts
  - file: F:/Linghun/packages/tui/src/failure-learning-command-runtime.ts
  - file: F:/Linghun/packages/tui/src/index.ts (captureFailureLearning + 8 capture sites + /failures dispatch + prompt projection)
  - file: F:/Linghun/packages/tui/src/model-prompt-runtime.ts (FailureLearningSummary + FailureLearningRule)
  - tests: failure-learning-runtime.test.ts (19), failure-learning-presenter.test.ts (5), index.test.ts D.14B (7)

verification_results:
  tsc_no_emit: PASS
  tui_build: PASS
  cli_build: PASS
  git_diff_check: PASS
  failure_learning_runtime_tests: "19 passed"
  failure_learning_presenter_tests: "5 passed"
  index_D14B: "7 passed"
  model_loop_runtime_tests: "123 passed"
  index_D13U: "5 passed"
  index_D13V: "29 passed"
  index_D14G: "11 passed"
  cli_main_test: "8 passed"
  full_tui_vitest: "44 failed / 1806 passed; baseline 44 failed / 1775 passed; new failures = 0; +31 new passing"
  failure_name_diff: "all 44 failures in pre-existing 'Phase 06 TUI slash commands' runTui-mock baseline (env contamination); no D.14B test in failure set"
  biome: "new files lint-clean+formatted; modified files at baseline error counts (index 6=6, model-prompt 2=2, index.test 5=5, tui-data-types 1=1); no new biome errors"
  real_model_smoke: "not run (final-gate downgrade path covered deterministically via runTui+SSE mock)"

index_ts_lines:
  d14g_baseline: 7999
  d14b_after: 8179
  diff: "+181 insertions / -1 deletion, all thin glue; business logic in failure-learning-*.ts (source invariant test enforced)"

boundary_confirmation:
  entered_next_phase: false
  model_self_reflection_essay: false   # all learning traceable to real failure events
  user_cancel_misrecorded: false       # cancel/deny not captured (test-locked)
  added_permission_mode: false
  changed_provider_env_key_model_route: false
  changed_D13U_D13V_D14G_semantics: false
  restored_freshness_lite: false
  nl_regex_intercept_for_failure: false
  business_logic_in_index_ts: false    # source invariant test enforced
  deleted_untracked: false
  secret_baseurl_token_persisted: false # central sanitize, test-locked

storage:
  location: "<project>/.linghun/failures/<id>.json (project scope)"
  config_changed: false                 # reused getProjectConfigDir, no @linghun/config edit
  windows_path_compatible: true

permissions:
  sandbox_mode: danger-full-access
  approval_policy: auto mode
  new_permission_system: false

model_provider_budget:
  provider_route_changed: false
  real_provider_smoke_run: false
  budget_recorded: "not available in local tool output"
```

## 16. 开发者排查入口

- 失败学习存储：`<project>/.linghun/failures/*.json`。
- 业务逻辑：`packages/tui/src/failure-learning-runtime.ts`（脱敏/去重/记录/加载/摘要）。
- slash 入口：`/failures`（`failure-learning-command-runtime.ts`）；视图 `failure-learning-presenter.ts`。
- 主链接入点（grep `captureFailureLearning`）：`index.ts` 的工具失败/provider 失败/验证失败/git 失败/final gate 降级/report guard/resource cap 站点。
- prompt 投影：`model-prompt-runtime.ts` 的 `FailureLearningSummary=` / `FailureLearningRule=`。
- 不变式守护：`index.test.ts` 的 `D.14B source invariant` 测试。
- 失败信号是否被记录：看 transcript `system_event` 里的 `failure_learning recorded category=...`。
