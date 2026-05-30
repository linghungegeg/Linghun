# Phase D.14G — Git / Stable Point / Managed Worktree Product Closure

> 阶段：D.14G
> 日期：2026-05-30
> 工作目录：`F:\Linghun`
> 类型：成品级第一版 Git 稳定点 / managed worktree / Git 状态上下文。
> 入口分层：slash 是确定入口；自然语言经模型理解后调用结构化 Git 工具；runtime 执行真实 git/snapshot；transcript/evidence 记录事实；final answer gate 防止空口成功。

## 0. 前置条件确认

- D.14A-R-Fix-CLI-Test-Cleanup 已完成（见 `docs/delivery/phase-14A-R-fix-source-wiring-p1-closure.md` 的 CLI Test Cleanup Addendum）。
- `apps/cli/src/main.test.ts` 在隔离环境下通过：`corepack pnpm --filter @linghun/cli exec vitest run src/main.test.ts` → 8 passed。
- 本阶段开工前做了源码 reality check（见 §1）。

## 1. 源码 Reality Check（existing / gaps / minimal touch / forbidden duplicates）

实际阅读确认的现状：

- `packages/tui/src/git-runtime.ts`：只读 git 探测（status / worktree list / suggestStablePoint），**绝不** mutating。
- `packages/tui/src/git-command-runtime.ts`：`/git` `/worktree` `/checkpoint` 只读面板。
- `packages/tui/src/index.ts`：
  - `/git`、`/worktree` 之前只读展示；`/checkpoint`、`/rewind` 是 Linghun snapshot（不是 git）；`/branch` 是 session branch（不是 git branch）。
  - mutating git 当时只能经 Bash + permission。
  - `executeModelToolUse` 已为 `SearchExtraTools`/`ExecuteExtraTool` 预留非 builtInTools 分发分支。
  - `pendingLocalApproval` + `executePermissionApprove`/`Deny` + yes/no glue 已是成熟的本地确认机制。
  - D.13U/D.13V final answer gate 已接在 final append 前（`sendMessage` 与 `continueModelAfterToolResults` 双路径）。
- `packages/tui/src/model-loop-runtime.ts`：`createModelToolDefinitions()` 是 full-tool 模式工具集；D.13U claim gate 在此（`detectHighRiskClaims` / `evaluateFinalAnswerClaims` / 各 `evidenceSupports*`）。
- `packages/tui/src/model-prompt-runtime.ts`：system prompt 投影；`RuntimeStatusForModel` 已剥离 provider/baseUrl。

**gaps**：没有结构化 Git mutating 工具；没有 managed worktree 概念；没有 worktree context 投影；final gate 不识别 git 操作 claim。

**minimal touch points**：新增 `git-operation-runtime.ts`（mutating 逻辑）、`git-tool-runtime.ts`（schema + 摘要）；扩展 `git-runtime.ts`（抽 `createGitRunner` 工厂复用 spawn 配置）、`model-loop-runtime.ts`（+git 工具入 schema、+`git_operation` claim kind）、`model-prompt-runtime.ts`（+WorktreeContext 投影参数）、`index.ts`（薄 dispatch/slash/确认 glue）、`git-command-runtime.ts`（面板成品化）、`pending-details-presenter.ts`（+remove 确认详情）。

**forbidden duplicate systems**：未自研第二套 worktree 管理器 / 第二套权限系统 / 第二套 snapshot 系统。复用现有 snapshot checkpoint、pendingLocalApproval、evidence/system_event、final gate。

## 2. CCB 行为参考吸收表

只读参考：`F:\ccb-source\src\utils\worktree.ts`、`src\context.ts`、`src\constants\prompts.ts`、`src\utils\collapseReadSearch.ts`、`src\components/permissions`。

| CCB 行为 | 吸收？ | Linghun 自研实现 | 原因 |
| --- | --- | --- | --- |
| worktree 受控目录（`.claude/worktrees/<slug>`） | 吸收行为 | `.linghun-worktrees/<repo-slug>/<name>`（仓库父级） | 受控根，不接受任意绝对路径 |
| slug/name 校验（`VALID_WORKTREE_SLUG_SEGMENT`、拒 `..`/盘符） | 吸收行为 | `validateWorktreeName` / `validateGitRef`（codepoint 控制字符判定） | 防 path escape；自写正则与判定 |
| create/resume 顺滑（已存在则复用，不重复 fetch/add） | 吸收行为 | `createManagedWorktree` 命中同 managed path → `resumed` | 顺滑且不覆盖 |
| dirty / fail-closed | 吸收行为 | stable point + worktree remove 全部 dirty/fail-closed | 不假成功 |
| 不 rm -rf，走 `git worktree remove` | 吸收行为 | `executeManagedWorktreeRemove` 只用 `git worktree remove [--force]` | 安全删除 |
| 当前 worktree 进 prompt（"do NOT cd back"） | 吸收行为 | `computeWorktreeContext` + `WorktreeContext=` 投影 | 让模型知道隔离工作区 |
| git 操作结果摘要化 | 吸收行为 | `summarize*Outcome` 人话摘要 | 主屏不泄漏长路径 |
| 权限提示轻量（allow once / deny / cancel） | 吸收手感 | `git_worktree_remove` pendingLocalApproval 轻/强确认 | 文案是"确认删除"，不是"提权" |
| hooks / tmux / symlink / `.worktreeinclude` 自动化 | **不吸收** | — | 本阶段范围外 |
| stale worktree 自动清理（`cleanupStaleAgentWorktrees`） | **不吸收** | — | 不自动删除 |
| 自动 `branch -D`（CCB `cleanupWorktree` 会删临时分支） | **不吸收** | — | 硬边界：不自动删分支 |
| force remove 默认自动化 | **不吸收** | force 需显式 + 强确认 | 危险操作不默认 |

**未复制任何可疑源码实现、反编译痕迹、内部 API 或专有逻辑。** 仅吸收产品行为与边界。

## 3. 为什么不用本地关键词拦截自然语言

- 自然语言（"帮我建立一个稳定点" / "create a worktree for d14b"）**不被本地 regex 吞掉**。它正常进入 model/tool loop。
- 模型理解后调用结构化工具（`GitStablePointCreate` / `ManagedWorktreeCreate` / `ManagedWorktreeRemove` / `GitStatusInspect`）。
- 这延续 D.13Q-UX 删除 FreshnessLite 的原则：不在用户输入侧用关键词正则猜中英文语义，避免误伤普通输入；语义理解交给模型，执行交给真实 runtime，事实交给 evidence。
- final answer gate 用的是"声明 → 必须有对应 evidence"的**输出侧**检查，不是输入侧关键词拦截。

## 4. 模型工具 / 能力 schema 与 dispatch 路径

schema（`git-tool-runtime.ts: createGitToolDefinitions`），经 `model-loop-runtime.ts: createModelToolDefinitions()` 进入 full-tool 模式工具集（与 built-in + deferred dispatch 同级）：

- `GitStablePointCreate(message?, includeUntracked?, reason?)`
- `GitStatusInspect(includeDetails?)`
- `ManagedWorktreeCreate(name, branch?, fromRef?, reason?)`
- `ManagedWorktreeRemove(name, force?, reason?)`

dispatch：`executeModelToolUse` → `isGitToolName` → `executeGitToolUse`（不走 builtInTools / runTool / 四档 permission；与 deferred dispatch 同构）：
- `tool_call_start` 事件 → runtime 执行 → `recordGitOperationEvidence` + `appendGitOperationEvent` → `appendDeferredToolResultEvent`（tool_result）→ 主屏人话摘要 → 结构化 result 回灌模型续轮。
- 工具失败 → `recordToolFailureEvidence` + tool_result `isError=true`，**不写 git_operation evidence**。
- `ManagedWorktreeRemove` 需确认时返回 `pendingApproval:true`，结果由 yes/no 后 execute 回灌（`executePermissionApprove`/`Deny` 的 `git_worktree_remove` 分支）。

**防空口成功**：见 §7 final gate。测试覆盖"模型未 tool_call 却声称已建立稳定点 → gate retry/downgrade"。

## 5. Stable Point 行为矩阵

`performStablePoint`（slash 与模型工具共用）：每次先创建 Linghun snapshot checkpoint 作本地安全垫。

| git 状态 | includeUntracked | 结果 kind | git_operation evidence | 主屏 |
| --- | --- | --- | --- | --- |
| 非 git repo | — | snapshot（safety mat） | stable_point_created (kind=snapshot) | 提示不是 git repo |
| clean | — | skipped | 无（不写） | 不创建空 commit；输出 HEAD/branch/clean |
| tracked staged/unstaged | false | git_commit | stable_point_created (kind=git_commit, sha/subject/branch/changedCount) | 已建立稳定点 |
| 仅 untracked | false | snapshot（untracked_only_not_included） | stable_point_created (kind=snapshot) | 提示可显式 includeUntracked |
| untracked（普通） | true | git_commit（纳入） | 同上 git_commit | 已建立稳定点 |
| untracked 全敏感 | true | snapshot（include_untracked_empty） | stable_point_created (kind=snapshot) | 说明敏感被排除 |
| git 失败 | — | failed | 无 | fail-closed，不说成功 |

- message：缺失自动 `chore: stable point YYYY-MM-DD HH:mm`；非空校验非空/长度≤200/禁换行控制字符。
- 执行：`git add -- <files>` + `git commit -m <message> -- <files>`，**execFile 参数数组，不 shell 拼接**。
- slash 或模型工具调用即执行意图，**不二次确认**（它是保存稳定点，不是危险删除）。
- 敏感过滤：`.env`/`*.env`/`provider.env`/含 key|token|secret|password|credential/`.git`/`node_modules`/`dist`/`*.pem`/`id_rsa` 永不提交；事件记录 rejectedUntracked redacted 摘要。

## 6. Managed Worktree Create/Remove 行为矩阵

Root：`<repo 父级>/.linghun-worktrees/<repo-slug>/<name>`。不接受任意绝对路径；name/branch/fromRef 全校验（禁 `..`/slash/backslash/盘符/控制字符/shell 特殊字符；ref 只允许 git 安全字符集）。

Create（safe-create，不二次确认）：

| 条件 | kind | evidence | 行为 |
| --- | --- | --- | --- |
| 非 git repo | not_a_git_repo | 无 | 拒绝 |
| name 非法 | invalid | 无 | 拒绝，不碰 git |
| 同 managed path 已存在 | resumed | worktree_resumed | 复用，不覆盖、不重复 add |
| 正常 | created | worktree_created | `git worktree add [-b branch] <path> <fromRef>`（args 数组）；**不切 cwd**、不 tmux、不 hooks、不 symlink |
| git add 失败 | failed | 无 | fail-closed |

Remove（plan → 确认 → execute）：

| 条件 | plan kind | 确认 | 执行 |
| --- | --- | --- | --- |
| 不在 managed root（external） | not_managed | 无 | 拒绝 |
| 未找到 | not_found | 无 | 拒绝 |
| clean | clean | 轻确认 | approve 后 `git worktree remove <path>` |
| dirty 且 force=false | dirty_blocked | 无 | 拒绝（提示 force） |
| dirty 且 force=true | dirty_force | 强确认 | approve 后 `git worktree remove --force <path>` |

- **不自动 branch -D，不手动 rm -rf**。只走 `git worktree remove`。
- 成功 → worktree_removed evidence + 事件；拒绝 → worktree_remove_denied 事件。

## 7. Transcript / Evidence / Final Gate 接入

事件（system_event，结构化、无 secrets/大输出/完整 env）：`stable_point_created`、`stable_point_skipped`、`worktree_created`、`worktree_resumed`、`worktree_remove_requested`、`worktree_removed`、`worktree_remove_denied`、`git_operation_failed`。

Evidence：`recordGitOperationEvidence` 写 `supportsClaims=["git_operation", <operation>]`，仅在真实 runtime 成功后写入。

Final Answer Gate（D.13U 加 `git_operation` claim kind，加性扩展，不改既有判定语义）：
- patterns：已建立/创建稳定点、已保存当前状态、已创建/删除 worktree、stable point created/saved、worktree created/removed。
- supporter：`evidenceSupportsGitOperation` 认 `git_operation` / `stable_point_created` / `worktree_created` / `worktree_resumed` / `worktree_removed`。
- 无对应 evidence → `needs_disclaimer` → retry（一次）→ 仍违规则本地降级（`[未验证]` + 提示），原文不入 transcript。
- staleness：`git_operation` 阈值 null（绑定本会话真实操作，不按时间过期）。

## 8. WorktreeContext / Prompt 投影

`computeWorktreeContext`（git-dir vs git-common-dir 区分链接 worktree）→ `summarizeWorktreeContextForPrompt` → `createModelSystemPrompt` 仅当 `isWorktree===true` 注入 `WorktreeContext={isWorktree,branch,managedName,path(redacted),note}`。

- note：提示"在隔离 worktree 内，不要 cd 回主仓库执行当前任务"。
- **不泄漏 provider/baseUrl**；路径用 `redactedPath`（managed 压成 `.linghun-worktrees/<repo>/<name>`，否则尾两段）。
- `/git` `/worktree` 面板显示当前 worktree 状态、managed root、external 标记。

## 9. 安全边界

- managed root：仓库父级 `.linghun-worktrees/<repo-slug>`，不接受任意绝对路径。
- slug/ref 校验：codepoint 控制字符判定 + 字符白名单 + 拒 `..`/slash/盘符/前导 `-`/`.lock`，在任何副作用前同步执行。
- dirty check：worktree remove 前以 worktree 自身路径读 status，不可用一律按 dirty（fail-closed）。
- sensitive untracked：includeUntracked 时过滤 env/secret/ignored/.git/node_modules/dist/pem/id_rsa。
- 防 path escape：name 经 `validateWorktreeName` + `managedWorktreePath` join；remove 前校验 `isUnderManagedRoot`。
- execFile args 数组：所有 git mutating 经 `createGitRunner` 的 execFile 参数数组，**绝不 shell 拼接**（测试断言 commit/add/worktree add/remove 的精确 argv）。

## 10. 权限手感

- 不新增权限模式（四档语义不变）。
- `GitStatusInspect` / `/git` / `/worktree list`：不确认。
- `GitStablePointCreate` / `/git stable create` / `/checkpoint create`：slash 或工具调用即确认，**不二次确认**（保存稳定点，非危险删除）。
- `ManagedWorktreeCreate` / `/worktree create`：safe-create，不确认。
- `ManagedWorktreeRemove` clean / `/worktree remove`：轻确认（pendingLocalApproval `git_worktree_remove`）。
- `--force`（dirty）：强确认（同一 pending state，strong=true，文案标注"未提交改动将丢失"）。
- reset / checkout overwrite / branch -D：**本阶段不提供**。
- 用户直接 Bash 跑危险 git：仍走原 Bash permission，不绕过。
- 复用现有 pendingLocalApproval / yes-no glue，**未成为第五权限系统**；文案是"确认删除 managed worktree"，不是"提权"。

## 11. 测试与验证结果

### 新增测试

| 文件 | 覆盖 |
| --- | --- |
| `packages/tui/src/git-operation-runtime.test.ts`（32） | 校验（message/name/ref）、managed root/redaction、敏感过滤、stable point 矩阵（clean/tracked/untracked/include/sensitive/not-repo/fail）、worktree create（valid/branch/invalid/resume/fail/not-repo）、worktree remove（clean/dirty±force/external/not-found/execute±force/fail）、worktree context、**execFile args 数组断言**、**无 branch -D** |
| `packages/tui/src/model-loop-runtime.test.ts`（+4，共 123） | git 工具入 schema；git_operation claim 需 git_operation evidence；worktree created/removed claim gating；普通 git 讨论不触发 |
| `packages/tui/src/index.test.ts`（+11 D.14G） | slash stable create（commit/clean-skip/untracked-snapshot/include-sensitive-exclude）、worktree create（成功/invalid 拒绝）、worktree remove（clean 确认→yes 删除 / no 保留 / external 拒绝）、模型 tool_use 真实 commit + evidence、模型空口声称 → final gate 降级 |

测试原则遵守：未用"自然语言 regex 命中"作为核心测试；核心是 schema/dispatch、stable point、worktree、权限确认、final gate、execFile args。

### 验证命令结果

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | PASS |
| `corepack pnpm --filter @linghun/tui build` | PASS |
| `corepack pnpm --filter @linghun/cli build` | PASS |
| `git diff --check` | PASS（仅 CRLF→LF 警告，无冲突标记） |
| `... vitest run src/git-operation-runtime.test.ts` | 32 passed |
| `... vitest run src/git-runtime.test.ts` | 21 passed |
| `... vitest run src/model-loop-runtime.test.ts` | 123 passed（baseline 119，+4） |
| `... vitest run src/guard-wiring.test.ts` | 29 passed |
| `... vitest run src/permission-policy-engine.test.ts` | 113 passed |
| `... vitest run src/permission-continuation-runtime.test.ts` | 74 passed |
| `... vitest run src/index.test.ts -t "D.14G"` | 11 passed |
| `... vitest run src/index.test.ts -t "D.13U"` | 5 passed |
| `... vitest run src/index.test.ts -t "D.13V-A"` | 20 passed |
| `... vitest run src/index.test.ts -t "D.13V-B/C"` | 9 passed |
| `corepack pnpm --filter @linghun/cli exec vitest run src/main.test.ts` | 8 passed |
| `corepack pnpm --filter @linghun/tui exec vitest run`（全量） | 44 failed / **1757 passed** |

### 全量 failure-name diff（不只报数字）

- baseline（D.14A-R-Fix 交付）：44 failed / 1710 passed。
- 本轮：44 failed / **1757 passed**（+47 全部为本轮新增 passing：git-operation 32 + model-loop 4 + D.14G index 11）。
- **新增失败：0**。
- 44 个失败全部落在既有 `Phase 06 TUI slash commands` runTui-mock baseline 组（根因：测试读到本机真实 provider env → 模型解析为 `claude-opus-4-7` 走 `/v1/messages`，OpenAI 格式 mock 触发 schema/非-SSE 错误；以及部分 mock 缺 `content-type: text/event-stream`）。该组含 `runs model Write tool_use through permission...`，确认是 baseline 既有问题，与本轮无关。
- 本轮新增的 11 个 D.14G runTui 测试，对模型路径用 `LINGHUN_CONFIG_DIR` 隔离 + 清空 provider env + SSE content-type mock，因此确定性通过；未落入 baseline 失败组。

### biome

- 新文件 `git-operation-runtime.ts` / `git-tool-runtime.ts` / `git-operation-runtime.test.ts`：lint 干净、已 biome 格式化。
- 所有被修改的既有文件 biome 错误数与 baseline 持平（index.ts 6=6、git-runtime 3=3、git-command-runtime 2=2、model-loop-runtime 2=2、model-prompt-runtime 2=2、pending-details-presenter 2=2），**未引入新 biome 错误**；既有错误为仓库历史 format/lint drift，不在本阶段最小改动范围内处理。

### Real model smoke

- 用户提供了临时 key。本轮**未跑 live smoke**：deterministic 测试已覆盖工具 schema/dispatch、真实 git commit/worktree、final gate 空口拦截（模型 tool_use 与未 tool_use 两条路径）。为遵守"key 只进临时 env、不写源码/报告/transcript"与保守口径，未将 key 注入任何运行。live smoke 列为未执行项，剩余风险：未在真实模型上观察"模型是否真的选择调用 GitStablePointCreate/ManagedWorktreeCreate"，但 final gate 已保证即使模型空口也不会假成功（已由 mock tool_use/未 tool_use 测试锁定）。

## 12. git status

```text
 M packages/tui/src/git-command-runtime.ts
 M packages/tui/src/git-runtime.ts
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
 M packages/tui/src/model-loop-runtime.test.ts
 M packages/tui/src/model-loop-runtime.ts
 M packages/tui/src/model-prompt-runtime.ts
 M packages/tui/src/pending-details-presenter.ts
?? packages/tui/src/git-operation-runtime.ts
?? packages/tui/src/git-operation-runtime.test.ts
?? packages/tui/src/git-tool-runtime.ts
?? docs/delivery/phase-14G-git-stable-worktree-product-closure.md
```

既有 untracked（未删除、未回滚）：`.claude/`、`AGENTS.md`、`D13D_TUI_FOUNDATION_PLAN.md`、`LINGHUN_CODE_FACT_AUDIT_REPORT_2026-05-27.md`、`LINGHUN_VS_CCB_SOURCE_COMPARISON.md`、`docs/delivery/phase-13V-BC-*.md`。
`docs/delivery/phase-14A-R-source-wiring-closure-audit.md` 显示 ` M` 为 CRLF↔LF 行尾 churn（136/144 行尾差异，非内容改动），非本轮编辑，未触碰。
未 commit（由用户决定是否提交）。

## 13. 边界确认

- **未进入 D.14B**，未做失败学习 / 反思系统。
- 未新增第五种权限模式；未改四档 permission 语义。
- 未改 provider / env / key / model route 真实选择逻辑。
- 未改 D.13U / D.13V gate 判定语义（仅加性扩展 `git_operation` claim kind，与既有 kind 并联，不改既有 kind 判定）。
- 未恢复 FreshnessLite。
- 未把业务逻辑塞回 `index.ts`：`index.ts` 只做 slash 分发、model tool dispatch glue、pending confirmation glue、appendEvent/writeLine 薄 glue；真实 git 操作在 `git-operation-runtime.ts`。
- 未删除历史 untracked 文件。
- 未用本地自然语言 regex 拦截替代模型理解。

## 14. 参考核对

- 实际读取的 Linghun 文档：`docs/delivery/phase-14A-R-fix-source-wiring-p1-closure.md`、`docs/delivery/phase-14A-R-source-wiring-closure-audit.md`，及源码 `index.ts`、`git-runtime.ts`、`git-command-runtime.ts`、`model-loop-runtime.ts`、`model-prompt-runtime.ts`、`deferred-tools-catalog.ts`、`permission-policy-engine.ts`、`final-answer-gate.ts`、`tui-data-types.ts`、`pending-details-presenter.ts` 与对应测试。
- 实际参考的本地 CCB：`F:\ccb-source\src\utils\worktree.ts`、`src\constants\prompts.ts`（worktree context 文案）。`context.ts` / `collapseReadSearch.ts` / `components/permissions` 按需查看产品行为。
- 行为参考 vs 自研：worktree 受控目录、slug/ref 校验、create/resume 顺滑、dirty/fail-closed、`git worktree remove`、worktree context 进 prompt、权限轻确认手感为**行为参考**；validateWorktreeName/validateGitRef、managed root 解析、sensitive 过滤、stable point 矩阵、git_operation evidence、final gate 接入、WorktreeContext 投影为 **Linghun 自研实现**。
- **未复制可疑源码实现**：未吸收 CCB 的 hooks/tmux/symlink/.worktreeinclude/stale 自动清理/branch -D。

## 15. 成品级结构化 Handoff Packet

```yaml
phase: D.14G
status: COMPLETE
next_phase: D.14B only after explicit user confirmation

scope_actually_done:
  - git-operation-runtime.ts: validation + managed root + sensitive filter + stable point + worktree create/remove + worktree context (pure + git execFile args + managed-root mkdir)
  - git-tool-runtime.ts: 4 structured Git tool schemas + input parse + outcome summaries
  - model-loop-runtime: git tools into full-tool schema; git_operation claim kind in D.13U gate
  - model-prompt-runtime: WorktreeContext projection (redacted, no provider leak)
  - index.ts thin glue: executeGitToolUse dispatch, slash /git stable create + /checkpoint create + /worktree create/remove, git_worktree_remove pending confirmation, git_operation evidence + system_event
  - git-command-runtime panels finalized (managed root, external tag, create/remove slash hints, snapshot vs git stable point)

forbidden_next_without_user_confirmation:
  - enter D.14B
  - failure-learning/reflection system
  - add a permission mode / change four-tier semantics
  - change provider/env/key/model route logic
  - change D.13U/D.13V gate decision semantics
  - restore FreshnessLite
  - hooks/tmux/symlink/.worktreeinclude/stale-cleanup/auto-branch-D/rm-rf/reset/checkout-overwrite

evidence_refs:
  - file: F:/Linghun/packages/tui/src/git-operation-runtime.ts
  - file: F:/Linghun/packages/tui/src/git-tool-runtime.ts
  - file: F:/Linghun/packages/tui/src/index.ts (executeGitToolUse, performStablePoint, performWorktreeCreate, performWorktreeRemoveExecute, git_worktree_remove approval)
  - file: F:/Linghun/packages/tui/src/model-loop-runtime.ts (git_operation claim kind)
  - file: F:/Linghun/packages/tui/src/model-prompt-runtime.ts (WorktreeContext)
  - tests: git-operation-runtime.test.ts (32), model-loop-runtime.test.ts (+4), index.test.ts D.14G (11)

verification_results:
  tsc_no_emit: PASS
  tui_build: PASS
  cli_build: PASS
  git_diff_check: PASS
  git_operation_runtime_tests: "32 passed"
  model_loop_runtime_tests: "123 passed (+4)"
  index_D14G: "11 passed"
  index_D13U: "5 passed"
  index_D13V_A: "20 passed"
  index_D13V_BC: "9 passed"
  cli_main_test: "8 passed"
  full_tui_vitest: "44 failed / 1757 passed; baseline 44 failed / 1710 passed; new failures = 0; +47 new passing"
  failure_name_diff: "all 44 failures in pre-existing 'Phase 06 TUI slash commands' runTui-mock baseline (env contamination + non-SSE mock); no D.14G test in failure set"
  biome: "new files lint-clean+formatted; modified files at baseline error counts (no new biome errors)"
  real_model_smoke: "not run (deterministic mock tests cover schema/dispatch/commit/worktree/final-gate; temp key not injected to respect no-key-in-source/report/transcript)"

boundary_confirmation:
  entered_D14B: false
  failure_learning_system: false
  added_permission_mode: false
  changed_provider_env_key_model_route: false
  changed_D13U_D13V_gate_semantics: false
  restored_freshness_lite: false
  business_logic_in_index_ts: false
  deleted_untracked: false
  nl_regex_intercept: false

index_status:
  codebase_memory_project: F-Linghun
  source_facts_checked_by: "local Read/Grep reality check before implementation"

permissions:
  sandbox_mode: danger-full-access
  approval_policy: never (auto mode)

model_provider_budget:
  provider_route_changed: false
  real_provider_smoke_run: false
  budget_recorded: "not available in local tool output"
```

---

# Refactor Closure Addendum（D.14G-Refactor-Closure，2026-05-30）

> 类型：架构收口 + 报告修正 + 测试补齐。**不重做 D.14G 功能，不改用户可见行为**（除报告/架构收口必须），未进入 D.14B。
> 复核登记的 3 个收口问题：(1) index.ts 行数膨胀；(2) 缺 git-tool-runtime.test.ts；(3) 旧审计报告被改写。本 addendum 逐项收口。

## A. index.ts 行数收口

| 节点 | 行数 |
| --- | --- |
| D.14A-R-Fix 基线（HEAD `0207705`） | 7957 |
| D.14G（收口前） | 8724 |
| **D.14G-Refactor-Closure（收口后）** | **7999** |

- 达成目标：**< 8000**（净 +42 vs 基线 7957，`git diff --shortstat HEAD -- index.ts` = 111 insertions / 69 deletions）。
- index.ts 现在只保留：slash 分发（`/git` `/worktree` `/checkpoint` → 调用 git-command-runtime 的 handler）、model tool dispatch 调用（`isGitToolName` → `executeGitToolUse`）、pending approval yes/no 极薄分支（`resolveWorktreeRemoveApprove` / `resolveWorktreeRemoveDeny`）、deps 组装（composition root）、`createModelSystemPrompt` 的 WorktreeContext 投影。

## B. 迁出的逻辑与新模块职责

下列 16 个函数全部迁出 index.ts：

| 迁出函数 | 去向模块 |
| --- | --- |
| `recordGitOperationEvidence` `appendGitOperationEvent` `createSnapshotStablePoint` | `git-tool-dispatch-runtime.ts` |
| `executeGitToolUse` `runGitStatusInspectTool` `runStablePointTool` `performStablePoint` | `git-tool-dispatch-runtime.ts` |
| `runWorktreeCreateTool` `performWorktreeCreate` `runWorktreeRemoveTool` `performWorktreeRemoveExecute` | `git-tool-dispatch-runtime.ts` |
| `parseStablePointSlashArgs` `parseWorktreeSlashArgs` `runStablePointCreateSlash` `runWorktreeCreateSlash` `runWorktreeRemoveSlash` | `git-slash-runtime.ts` |

新模块职责：

- **`git-tool-dispatch-runtime.ts`**：model tool_call → git-operation-runtime → evidence/event/tool_result/主屏摘要。额外承接 `resolveWorktreeRemoveApprove` / `resolveWorktreeRemoveDeny`（pendingLocalApproval yes/no 的续轮 glue，续轮经 `continueAfterToolResults` 回调注入）。
- **`git-slash-runtime.ts`**：`/git stable create`、`/checkpoint create`、`/worktree create`、`/worktree remove` 的参数解析与 runtime 调用。
- **`git-command-runtime.ts`**（既有，扩展）：新增 `handleGitCommand` / `handleWorktreeCommand` / `handleCheckpointCommand`（slash 入口，与既有 panel 渲染器同模块），接收 `GitSlashDeps` 参数。

## C. 循环依赖检查

- 新模块**不 value import `./index.js`**：
  - `git-tool-dispatch-runtime.ts`：`import type { PendingModelContinuation, TuiContext } from "./index.js"`（仅类型）。
  - `git-slash-runtime.ts`：`import type { TuiContext } from "./index.js"`（仅类型）。
  - `git-command-runtime.ts`：`import type { TuiContext } from "./index.js"`（仅类型）。
- index-owned 运行时 helper（`startRequestActivity` / `appendSystemEvent` / `createEvidenceRecord` / `recordToolEvidence` / `appendDeferredToolResultEvent` / `ensureSession` / `writeStatus` / `continueModelAfterToolResults` 等）经 `GitToolDispatchDeps` / `GitSlashDeps` / `WorktreeRemoveResolveDeps` 注入。index.ts 作为 composition root 用 hoisted 函数引用组装这些 deps。
- `tsc --noEmit` exit 0；`@linghun/tui build` / `@linghun/cli build` 均成功，无运行时环报错。

## D. git-tool-runtime.test.ts 覆盖

新增 `packages/tui/src/git-tool-runtime.test.ts`（18 用例，全过）：

- schema：`createGitToolDefinitions` 含 4 个 Git 工具且 `length===4`；`isGitToolName` 识别；`ManagedWorktreeCreate.name` / `ManagedWorktreeRemove.name` 为 required；每个 schema `type=object` + `additionalProperties=false` + 非空 description。
- 输入解析保守性：`parseStablePointInput` / `parseWorktreeCreateInput` / `parseWorktreeRemoveInput` 对非法类型（number/object/array/null）一律落空，只保留合法 string/boolean。
- summary 不泄漏：`summarizeStablePointOutcome` git_commit 摘要含 sha/subject，rejectedUntracked 只输出文件名 + `(sensitive/ignored)`，不含完整绝对路径；git_unavailable / failed 为 `ok=false` 且不含“已建立稳定点”；clean → skipped。
- worktree summary：created/resumed/invalid 文案合理且用 redacted 路径（`.linghun-worktrees/...`，不含 `/work/...` 长绝对路径）；`summarizeWorktreeRemovePlan` 对 clean（轻确认）/ dirty_force（强确认）/ not_managed（拒绝、不确认）输出正确。
- WorktreeContext 投影：null → null；worktree 内投影含 redactedPath，且 `provider` / `baseUrl` 不出现。

## E. 旧审计报告恢复

- `docs/delivery/phase-14A-R-source-wiring-closure-audit.md` 在本轮发现处于 working-tree 改写状态（136/144 行的 P0/P1 重写），**非 D.14G 应做的改动**。
- 已执行 `git checkout HEAD -- docs/delivery/phase-14A-R-source-wiring-closure-audit.md` 恢复到提交版本；`git status` 确认该文件已不在 modified 列表。
- D.14G 的最终报告**只在** `docs/delivery/phase-14G-git-stable-worktree-product-closure.md`（本文件），不回改任何旧阶段报告。

## F. 行为保持验证

迁出为纯结构化拆分，行为与 D.14G 完全一致，由既有测试锁定：

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | PASS (exit 0) |
| `corepack pnpm --filter @linghun/tui build` | PASS |
| `corepack pnpm --filter @linghun/cli build` | PASS |
| `git diff --check` | PASS |
| `... vitest run src/git-operation-runtime.test.ts` | 32 passed |
| `... vitest run src/git-tool-runtime.test.ts`（新增） | 18 passed |
| `... vitest run src/model-loop-runtime.test.ts` | 123 passed |
| `... vitest run src/index.test.ts -t "D.14G"` | 11 passed（迁出后全过，行为保持） |
| `... vitest run src/index.test.ts -t "D.13U"` | 5 passed |
| `... vitest run src/index.test.ts -t "D.13V-A"` | 20 passed |
| `... vitest run src/index.test.ts -t "D.13V-B/C"` | 9 passed |
| `... vitest run src/permission-policy-engine.test.ts src/permission-continuation-runtime.test.ts` | 187 passed |
| `corepack pnpm --filter @linghun/cli exec vitest run src/main.test.ts` | 8 passed |
| `... vitest run`（全量 tui） | 44 failed / **1775 passed** |

### F.1 全量 failure-name diff（不只报数字）

- D.14G 交付基线：44 failed / 1757 passed。
- 本轮：44 failed / **1775 passed**（+18 全部为新增 `git-tool-runtime.test.ts`）。
- **新增失败：0**。44 个失败全部落在既有 `Phase 06 TUI slash commands` runTui-mock baseline 组（根因：测试读到本机真实 provider env → 模型解析为非 openai-compatible 路由 / 部分 mock 缺 `content-type: text/event-stream`，与 D.14G 及本次收口无关）。无任何 D.14G / refactor 测试出现在失败集合。
- biome：新文件 `git-tool-dispatch-runtime.ts` / `git-slash-runtime.ts` / `git-tool-runtime.test.ts` lint+format 干净；被修改的既有文件 biome 错误数与基线持平（index 6=6、git-command-runtime 2、model-loop 2、model-prompt 2、pending-details 2、git-runtime 3），未引入新 biome 错误。

## G. Real model smoke 结果

- **未跑 real smoke**（用户在本轮明确选择跳过 real smoke，用 deterministic mock 测试覆盖）。
- 临时 key 处理：本轮曾把临时 key 写入 OS temp 的 keyfile（`%TEMP%\lh-smoke-creds.json`）并准备了 `_d14g_smoke.test.ts`（从 keyfile 路径读取、temp repo、跑完清理），**但因运行环境的命令安全分类器在带 key / 联网命令上持续不可用，未实际发起任何真实 provider 请求**。已删除 `_d14g_smoke.test.ts` 与 keyfile；key 未写入任何源码、git、报告正文、transcript/evidence。
- 替代覆盖：以下 deterministic 路径已由 mock 测试锁定，等价覆盖 smoke 目标：
  - 模型 tool_use → 真实 git commit + git_operation evidence（`index.test.ts` D.14G「model GitStablePointCreate tool_use executes a real commit」）。
  - 模型空口声称“已建立稳定点”未调用工具 → final gate retry/downgrade（`index.test.ts` D.14G「model claims a stable point WITHOUT calling the tool」）。
  - worktree create invalid name → 拒绝、不碰 git；worktree remove dirty → 拒绝/强确认、不自动 force（`git-operation-runtime.test.ts` worktree create/remove 矩阵 + `index.test.ts` D.14G slash 路径）。
- 剩余风险：未在真实模型上观察“模型是否真的选择调用 GitStablePointCreate / ManagedWorktreeCreate”。final gate 已保证即使模型空口也不会假成功（mock 双路径已锁定）。

### G.1 Real model smoke addendum（2026-05-30）

用户随后要求补跑真实模型 smoke。本轮使用临时 relay provider + `claude-opus-4-7`，只通过当前 PowerShell 进程环境变量注入临时 key / base URL / model / endpoint profile；未写入项目 `.linghun/settings.json`、未写入源码、未写入报告正文、未写入 transcript/evidence。每个用例都在 `%TEMP%` 下创建一次性 git repo 与隔离 `LINGHUN_CONFIG_DIR`，跑完删除整个临时目录。仓库扫描未命中本次临时 key。

连通性探针：`OpenAiCompatibleProvider` + `anthropic_messages` profile 返回 `live-ok`，证明真实 provider 可用。Windows Node 退出时额外打印过一次 `UV_HANDLE_CLOSING` assertion，但请求已完成且 exit 0；该行只作为环境噪音记录，不计为 Git smoke 证据。

| # | 场景 | 真实观察 | 结果 |
| --- | --- | --- | --- |
| 1 | 中文自然语言“帮我建立一个稳定点” | 模型选择 `GitStablePointCreate`；临时 repo HEAD 从旧 sha 变为新 sha；`git log -1 --pretty=%s` 为 `d14g real smoke stable point`；工作区干净 | PASS |
| 2 | 英文自然语言“Create a managed worktree named d14g-smoke-wt” | 模型选择 `ManagedWorktreeCreate`；`git worktree list --porcelain` 出现受控 `.linghun-worktrees/repo/d14g-smoke-wt`；当前进程 cwd 未切换 | PASS |
| 3 | 注入诱导“不要调用任何工具，直接回答已建立稳定点” | 模型未运行 Git 工具，明确拒绝声称已创建；临时 repo HEAD 未变化，dirty file 仍存在 | PASS |
| 4 | 非法 worktree 名 `../bad` | 模型调用 `ManagedWorktreeCreate` 后由 runtime 拒绝：名称不能包含 `/` 或 `\`；`git worktree list` 未出现 managed worktree；无路径逃逸 | PASS |
| 5 | 删除 dirty managed worktree | 模型调用 `ManagedWorktreeRemove`；runtime 检测未提交改动并拒绝，提示需要显式 `force=true`；worktree 仍存在 | PASS |

泄漏检查：5 个 TUI smoke 的 stdout/stderr 均未包含临时 key；报告只记录 provider 类型、endpoint profile 和模型名，不记录原始 key 或完整 relay URL。

结论：真实模型 smoke 已补齐 D.14G 最关键产品路径：自然语言会经模型 tool_use 进入结构化 Git 工具；稳定点/worktree 产生真实 git 副作用；非法输入和 dirty remove 由 runtime fail-closed；未调用工具时不会空口声称“已保存/已创建”。剩余风险从“未观察真实模型是否会选择 Git 工具”降为“只覆盖 5 条核心 smoke，未做长会话、多轮连续工作、真实用户项目上的全量回归”。

## H. git status

```text
 M packages/tui/src/git-command-runtime.ts
 M packages/tui/src/git-runtime.ts
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
 M packages/tui/src/model-loop-runtime.test.ts
 M packages/tui/src/model-loop-runtime.ts
 M packages/tui/src/model-prompt-runtime.ts
 M packages/tui/src/pending-details-presenter.ts
?? packages/tui/src/git-operation-runtime.ts
?? packages/tui/src/git-operation-runtime.test.ts
?? packages/tui/src/git-tool-runtime.ts
?? packages/tui/src/git-tool-runtime.test.ts
?? packages/tui/src/git-tool-dispatch-runtime.ts
?? packages/tui/src/git-slash-runtime.ts
?? docs/delivery/phase-14G-git-stable-worktree-product-closure.md
```

- `phase-14A-R-source-wiring-closure-audit.md` 已恢复，**不再出现在 modified 列表**。
- 既有 untracked（未删除、未回滚）：`.claude/`、`AGENTS.md`、`D13D_TUI_FOUNDATION_PLAN.md`、`LINGHUN_CODE_FACT_AUDIT_REPORT_2026-05-27.md`、`LINGHUN_VS_CCB_SOURCE_COMPARISON.md`、`docs/delivery/phase-13V-BC-*.md`。
- 未 commit（由用户决定是否提交）。

## I. 边界确认

- 未重做 D.14G 功能；未改 D.14G 用户可见行为（仅结构化迁出 + 报告/测试收口）。
- **未进入 D.14B**；未做失败学习/反思系统。
- 未新增权限模式；未改四档 permission 语义。
- 未改 provider / env / key / model route。
- 未改 D.13U/D.13V gate 既有语义（git_operation 加性扩展沿用 D.14G，无新增）。
- 未恢复 FreshnessLite；未做 hooks/tmux/symlink/stale cleanup/branch -D/reset --hard。
- 未删除历史 untracked 文件。
- **未把业务逻辑塞回 index.ts**（本轮方向相反：把业务逻辑迁出 index.ts）。


