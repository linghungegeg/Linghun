# Phase D.14C — Multi-Agent & Baseline Closure 交付文档

> 阶段：D.14C
> 日期：2026-05-30
> 工作目录：`F:\Linghun`
> 类型：收尾闭环。修掉影响实测可信度的全量测试尾巴（44 baseline failed），并对多开智能体能力做源码级审查 + 主链接入闭环。
> 边界：未 commit；未进入下一阶段；未改 provider/env/key/model route 真实选择逻辑；未改权限四档语义；未恢复 FreshnessLite；未做 Git/worktree 新功能；未做 UI 大改版；未做失败学习新功能（只把真实 agent failure 接进现有 D.14B 入口）；未删历史 untracked。

## 0. 摘要（summary-first）

- 全量 `@linghun/tui` vitest 从 **44 failed / 1808 passed** 收口到 **0 failed / 1855 passed**（44 文件全绿）。无删测试、无放宽核心断言、无吞异常。
- 44 个失败的真实根因是**两层测试夹具/环境问题 + 产品有意演进后的陈旧断言**，不是产品功能坏了；唯一一个真实功能缺口（综合状态本地应答 `formatCompositeStatusQuery` 成死代码）按用户决定**重新接回主链**。
- 多开智能体源码矩阵：核心能力（slash `/agents` `/fork` `/job`、NL CommandCapability 入口、四档权限复用、resource guard、transcript、独立 session、并发 cap、结果摘要）**已接主链**；本轮修复 3 个缺口：① agent 真实失败未接 D.14B failure learning；② `completeAgent` 无 try/catch（worker 异常冒泡，既不归档也不记录）；③ 并发常量三处重复声明。
- index.ts：8179 → **8190**（+11，全是 glue：composite-status 重接 6 行 + `captureFailureLearning` 注入 1 行 + 注释）。预算 +100，达标。agent 业务逻辑仍全在 `job-agent-command-runtime.ts`，由 `D.14C source invariant` 测试锁定。

## 1. 44 baseline failed 的真实根因与处理结果

### 根因 A（主因）：mock fetch 助手缺 SSE content-type
`index.test.ts` 顶部 5 个 helper（`mockOpenAiTextFetch`/`mockOpenAiEmptyFetch`/`mockOpenAiErrorFetch`/`mockOpenAiToolFetch`/`mockOpenAiToolSequence`）+ 12 个内联 `new Response(body, { status: 200 })` 都**没设 content-type**。`packages/providers/src/index.ts:1177-1190` 的 Fix-C 硬化（`PROVIDER_NON_SSE_STREAM`）现在要求 200 响应必须是 `text/event-stream`，否则立即抛错。于是 model loop 在第 1 个请求就死，所有下游断言失败。
**处理**：给全部 helper + 内联 mock 加 `headers: { "content-type": "text/event-stream" }`。纯夹具保真，不放宽断言。对照：通过的 D.13G 测试 + D.14B `mockSseFinalText` 本就带该头。

### 根因 B：真实 `~/.linghun/provider.env` + `~/.linghun/data/jobs` 环境污染
`getUserConfigDir` 在 `LINGHUN_CONFIG_DIR` 未设时回退 `homedir()/.linghun`；开发机有 `~/.linghun/provider.env`（含 OPENAI key + model=claude-opus-4-7 + INFERENCE_LEVEL），优先级最高，把测试的 project settings.json 覆盖成 claude-opus → anthropic_messages → OpenAI 格式 mock 被拒。Phase 06 块的 `runTui` 测试**完全没有 env 隔离**。
此外 jobs/sessions 默认存到 `getUserDataDir`（= `LINGHUN_DATA_DIR || homedir()/.linghun/data`），**不受 `LINGHUN_CONFIG_DIR` 控制**——开发机残留的真实 durable jobs 经 `/background` 的 hydration 灌进 `context.backgroundTasks`，被 `MAX_BACKGROUND_TASKS=8` 切片挤掉测试自建任务（污染 `tracks background task status` / `marks stale background tasks` / `keeps stale verification conservative`）。
**处理**：Phase 06 `describe` 块加 `beforeEach`，复用 D.14B 已验证的 `isolateModelEnv` 模式：fresh 临时 home，stub `LINGHUN_CONFIG_DIR` + `LINGHUN_DATA_DIR`，清 14 个 `LINGHUN_*`/`OPENAI`/`ANTHROPIC` key。自身 stub 的测试（setup-needed / trust）后置 stub 覆盖之；文件级 `afterEach` 已有 `vi.unstubAllEnvs()`。

### 根因 C：产品有意演进后的陈旧断言/夹具（保留意图，对齐现状）
| 测试 | 陈旧点 | 处理 |
| --- | --- | --- |
| title / 多处 | 默认模型占位 `deepseek-v4-flash` | D.13P-hotfix 已改现役 `deepseek-chat`，断言对齐 |
| uses executor route / keeps slash control-plane | doctor 不再打印 `defaultModel=gpt-5.5` 字面量；改 `WARN placeholder model` + 角色路由摘要 + provider 行 | 断言对齐到现行 doctor 输出 |
| records selected runtime profile | responses tools 现按 name 字典序排序，`Read` 不再是 head（首位是 `Bash`） | 改为位置无关断言 `{"type":"function","name":"Read"` |
| Read/Grep/Glob、CCB journey | `输出已摘要` → D.13L 改名 `输出已折叠，按 Ctrl+O 展开。`；`详情：用 /details output <id>` 已移除 | 断言对齐新文案 |
| shows/continues model tool permission（×3） | `echo` 被 D.13N 列入 READONLY_HEADS 自动放行，不再弹权限；`ls -la`/`Glob` 同理 | 命令换成真正需确认的 `mkdir`（MUTATING_HEADS → require_permission，且非 `rm -rf` 类 hard-deny），保留"弹确认 + 等待 + 拒绝"意图 |
| keeps ordinary report deploy | `requests>=4`，实际 3：D.13V 架构/完整性 gate 把 systemic 输入（"修复 bug"/"实现导出功能"）本地拦截给 evidence-first card，不发模型 | 改 `>=2`（普通分析/报告输入仍到 provider），并注释说明 |
| clears Architecture Card | `requests` 3→4：D.13V gate 对 systemic 首输入有一次确定性重试 | 改 4 + 注释 |
| Polish B permission boundaries | `普通 yes/确认 未放行` → D.13D 移除 NL→full-access Start Gate，裸 yes 落 no-pending 分支 | 改断言 `当前没有等待确认的 Start Gate`；硬边界（mode 始终 default）仍验证 |
| Polish B Workspace Trust | trust UI 重设计：`当前目录：` 前缀→路径独占行 `│  ${project}`；`Enter/yes：信任此项目`→`信任此项目 (yes)`；`权限管道约束`→`信任后可读写和运行命令；安全审批仍生效` | 断言对齐重设计后的 UI |
| keeps light hints out of prompt | `writeLightHints` 改推 `context.notifications`（不写主屏），文案经 `formatPlainLightHint` 改写 | 改为断言 `context.notifications` 含新文案 + 主屏不含 `[hint:warning]`——这恰是"hints 不进 prompt 区"的实现 |
| does not generate LINGHUN.md | 依赖污染才能让模型 Read；且工具错误 `ENOENT` 按产品策略不刷主屏原文 | 补自给自足 provider + Read 工具 mock；断言改为 `Read(LINGHUN.md)` 工具调用 + 不自动生成（文件不存在），保留核心不变式 |
| keeps slash control-plane | 依赖污染才能跑 NL Read | 补 openai-compatible apiKey + Read mock，模型行对齐实际 `provider=openai-compatible model=control-plane-model` |

### 根因 D（唯一真实功能缺口）：综合状态本地应答成死代码 —— 按用户决定重接
`formatCompositeStatusQuery`（自然语言问"状态/ready"时本地直接回 `Composite local status` 综合状态、不发模型）在 commit `f77affd`（D.13D dispatcher 重构）里**调用点被删、变成死代码**，测试 `answers composite Chinese and English readiness locally` 仍在断言它。
**用户决定：重接功能（恢复本地应答）。** 在 `handleNaturalInput` 架构卡清理之后、`checkResourceGuard("model")` 之前重新调用 `formatCompositeStatusQuery`。窄触发不破坏 D.13D 修复的"普通自然语言必须到模型"原则：该函数自带 `status/ready` 关键词 + ≥2 状态域命中的双重 guard，"模型这里是不是有问题"这类普通对话不命中。已验证 13 个 `ordinary prompts must reach gateway.stream` 路由守卫测试 + `does not intercept ordinary development requests` + `lets read-and-summarize requests reach the model loop` 全过——重接未重新吞普通 NL。`formatCompositeStatusQuery` 不再是死代码。

## 2. 多开智能体源码矩阵：已接主链 / 未接主链 / 不存在 / 已修复

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 自然语言入口 | **已接主链** | `natural-command-bridge.ts:595-617` 注册 `agents`/`fork`/`job` CommandCapability（关键词 + `scoreCapability` 打分路由），走能力目录而非脆弱关键词拦截；NL 只生成 Start Gate / 精确 slash 建议，不直接 spawn（设计如此） |
| slash 入口 | **已接主链** | `index.ts:2151-2157` dispatch `/agents`→`handleAgentsCommand`、`/fork`→`handleForkCommand`、`/job`→`handleJobCommand`（实现在 `job-agent-command-runtime.ts`） |
| model tool schema 直接 spawn | **不存在（不在本阶段范围）** | `packages/tools` `ToolName` 无 Agent/Task/Fork；`model-loop-runtime.ts` 仅 SearchExtraTools/ExecuteExtraTool。模型不能自主多开，只能用户 `/fork`。本阶段未新增 model-facing spawn tool（属新功能，需单独阶段评估） |
| 任务创建 | **已接主链** | `handleForkCommand`（agent）、`createDurableJob`（job） |
| 任务状态/查看 | **已接主链** | `/agents`/`/agents show`、`/job status`/`report`/`logs`、`/background` |
| 取消 | **已接主链** | `cancelAgent`、`/job cancel`→`transitionDurableJob("cancelled")` |
| 并发上限 | **已修复（去重）** | `checkBackgroundStartGuard(context,"agent",true)` 复用统一 resource guard + `BACKGROUND_KIND_CAPS.agent=3`；`handleForkCommand` 裸字面量 `>= 3` 改用导入的 `DEFAULT_JOB_RUNNING_AGENT_CAP`；删除 `job-agent-command-runtime.ts` 本地重复声明的 `DEFAULT_JOB_RUNNING_AGENT_CAP`/`MAX_AGENTS`/`JOB_AGENT_HIGH_CONFIG_CANDIDATE`/`JOB_RECOVERY_HEARTBEAT_STALE_MS` 及死代码 `BACKGROUND_RUNNING_GLOBAL_CAP`/`BACKGROUND_KIND_CAPS`，统一从 `job-runtime.ts` import |
| 结果归档/evidence | **已接主链 + 边界正确** | `completeAgent` 写 `agent_end` + `createRoleHandoff` 入 `context.roleHandoffs`；job 用独立 `job.evidenceRefs`。agent 结果**不进 `context.evidence`**，天然不污染 D.13U/D.13V final gate（已验证） |
| transcript | **已接主链** | agent 独立 `child` session + `agent_start`/`agent_end` 父会话事件 |
| 权限确认 | **已接主链** | `runWorkerAgent` 复用 `decidePermission("Write",...)`，非 allow 即拒，无旁路 |
| 资源占用控制 | **已接主链 + 去重** | 同并发上限；复用 `checkResourceGuard` |
| 失败处理 | **已修复（接入 D.14B）** | 本轮新增（见下） |

## 3. 本轮改动文件清单

| 文件 | 改动 |
| --- | --- |
| `packages/tui/src/index.ts` | +11：(a) `handleNaturalInput` 重接 `formatCompositeStatusQuery` 本地综合状态应答（窄触发，含注释）；(b) `configureJobAgentCommandRuntime` 注入 `captureFailureLearning` dep |
| `packages/tui/src/job-agent-command-runtime.ts` | (a) 从 `job-runtime.ts` import 并发常量，删除本地重复 + 死代码；(b) `JobAgentCommandRuntimeDeps` 加 `captureFailureLearning`；(c) `handleForkCommand` 裸 `>=3` 改用 `DEFAULT_JOB_RUNNING_AGENT_CAP`；(d) `completeAgent` 用 try/catch 包裹 `runAgentWork`，异常走新增 `failAgent`：标记 agent/task failed、记 `agent_end(failed)`、搭车 `captureFailureLearning(category=tool_failure)`、写用户可见失败说明 |
| `packages/tui/src/index.test.ts` | Phase 06 块 `beforeEach` env 隔离；mock SSE content-type；~12 个陈旧断言/夹具对齐现状（保留意图）；新增 `D.14C` describe 块（3 测试：agent 真实失败→D.14B、用户取消不误记、源码不变式） |

## 4. index.ts 行数前后对比

- D.14B 收口基线：**8179**
- D.14C 收口后：**8190**（+11）
- 增量全是 composition/root glue：composite-status 重接（约 6 行 + 注释）+ `captureFailureLearning,` 注入（1 行）。预算 8179+100=8279，达标。
- `grep -cE 'async function (completeAgent|runAgentWork|failAgent|cancelAgent|runWorkerAgent)' index.ts` = **0**：agent 生命周期业务逻辑全在 `job-agent-command-runtime.ts`。源码不变式测试 `D.14C source invariant` 锁定 index.ts 不重新实现这些函数、并发常量不在本地重复声明。

## 5. 接入边界（权限 / resource guard / evidence / transcript / failure learning / final answer gate）

- **权限**：worker 写文件仍只走 `decidePermission` 四档；本轮**未新增第五权限、未绕过确认**。`failAgent` 只在真实异常路径触发；用户取消（`cancelAgent`，status=cancelled）和 worker 权限拒绝（`runWorkerAgent` 返回普通 summary 字符串，不抛异常）**都不进** `failAgent`，不记失败（单测锁定）。
- **resource guard / 并发 cap**：复用现有 `checkBackgroundStartGuard`/`checkResourceGuard`/`BACKGROUND_KIND_CAPS`，并发常量单一来源（`job-runtime.ts`）。未新增第二套。
- **evidence**：agent 失败摘要交给 `captureFailureLearning` 内部 `sanitizeFailureText` 集中脱敏后落 `.linghun/failures/<id>.json`，**绝不进 `context.evidence`**。
- **transcript**：agent 失败写父会话 `agent_end(status=failed)` + background `failed/result=fail`，可追溯。
- **failure learning（D.14B）**：agent 真实执行异常记为 `tool_failure`（severity=medium，relatedTarget=`agent_<type>`，sourceRef=`agent:<id>`），只当历史风险提示。
- **final answer gate（D.13U/D.13V）**：判定语义**零改动**。agent 结果不进 evidence 通道，`completion_pass` gate 不认它。D.13U(5)/D.13V(29) 测试全过。

## 6. 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | PASS（exit 0） |
| `corepack pnpm --filter @linghun/tui build` | PASS |
| `corepack pnpm --filter @linghun/cli build` | PASS |
| `corepack pnpm --filter @linghun/tui exec vitest run`（全量） | **44 文件 / 1855 passed / 0 failed**（基线 44 failed） |
| `... vitest run src/index.test.ts -t "Phase 06 TUI slash commands"` | 215 passed / 0 failed（基线 44 failed） |
| `... vitest run src/index.test.ts -t "D.14C"` | 3 passed |
| `... vitest run src/index.test.ts -t "D.13U"` | 5 passed |
| `... vitest run src/index.test.ts -t "D.13V"` | 29 passed |
| `... vitest run src/index.test.ts -t "D.14B"` | 23 passed |
| `... vitest run src/index.test.ts -t "Phase 12 agents"` | 1 passed |
| `... vitest run src/job-runtime.test.ts src/job-runner-presenter.test.ts src/runner-runtime.test.ts` | 62 passed |
| `git diff --check` | PASS（exit 0） |

### 全量 failure-name diff（不只报数字）
- 基线（D.14B 交付）：44 failed / 1808 passed，全部落在 `Phase 06 TUI slash commands` runTui-mock 组。
- 本轮：**0 failed / 1855 passed**。新增失败 0。
- 收口路径：44 → (mock SSE + env 隔离) → 13 → (data-dir 隔离) 实测 → (陈旧断言/夹具对齐 + composite 重接) → 0。

## 7. 已知问题 / 不在本阶段处理的内容

- 模型自主 spawn 多开智能体的 model-facing tool schema **不存在**，本阶段未新增（属新功能，需单独阶段评估）。当前多开仅限用户手动 `/fork` 或 `/job`，自然语言只到 Start Gate / 能力建议。
- 未跑真实全量 smoke / live provider；未宣布 Beta PASS / smoke-ready / open-source-ready。
- 未 commit（由用户决定）。未删历史 untracked（`.claude/`、`AGENTS.md`、`D13D_TUI_FOUNDATION_PLAN.md` 等仍在）。

## 8. 下一阶段衔接

- 停在 D.14C。是否进入下一阶段由用户明确确认。
- 若后续要做"模型自主多开"，需单独阶段：新增 Anthropic input_schema 形态的 Agent/Task tool，接入 `executeModelToolUse` 派发 + 现有四档权限 + resource guard，且不污染 final answer gate。

## 9. 开发者排查入口

- agent 命令：`packages/tui/src/job-agent-command-runtime.ts`（`handleAgentsCommand`/`handleForkCommand`/`completeAgent`/`runAgentWork`/`failAgent`/`cancelAgent`/`runWorkerAgent`）。
- agent 失败是否记 D.14B：transcript `agent_end status=failed` + `.linghun/failures/*.json`（`relatedTarget=agent_<type>`）。
- 综合状态本地应答：`index.ts` `handleNaturalInput` 中 `formatCompositeStatusQuery` 调用点（窄触发注释）。
- Phase 06 测试隔离：`index.test.ts` `Phase 06 TUI slash commands` 的 `beforeEach`（`LINGHUN_CONFIG_DIR` + `LINGHUN_DATA_DIR` + model env 清理）。
- 源码不变式：`index.test.ts` `D.14C source invariant` 测试。

## 10. 参考核对

### 本阶段实际读取的 Linghun 文档
- `F:\Linghun\CLAUDE.md`、项目记忆 `MEMORY.md` / `project_phase_status.md` / `project_d14b_failure_learning.md` / `project_engineering_baseline.md` / `feedback_anti_fake_test_theater.md` / `feedback_one_shot_closure.md`
- `docs/delivery/README.md`、`phase-12-agents.md`、`phase-14B-failure-learning-runtime.md`、`phase-17a-local-durable-jobs-virtual-agent-concurrency.md`

### 本阶段实际精读的源码
- `index.ts`（handleNaturalInput / dispatch / configureJobAgentCommandRuntime / formatCompositeStatusQuery / captureFailureLearning / decidePermission 调用）、`job-agent-command-runtime.ts`、`tui-agent-job-runtime.ts`、`job-runtime.ts`、`tui-permission-runtime.ts`、`permission-policy-engine.ts`、`permission-continuation-runtime.ts`、`failure-learning-runtime.ts`、`cache-command-runtime.ts`、`@linghun/providers`（NON_SSE Fix-C）、`@linghun/config`（getUserConfigDir / getUserDataDir / resolveStoragePaths）、`@linghun/tools`（runTool / readTool / writeTool）
- `index.test.ts`（Phase 06 块、D.14B isolateModelEnv 模式）

### 行为参考 vs 自研
- env 隔离复用 D.14B 已验证的 `isolateModelEnv` 模式；agent 失败接 D.14B 复用既有 `captureFailureLearning` 入口；并发常量去重复用 `job-runtime.ts` 既有导出——均为复用 Linghun 自身既有范式。
- 综合状态重接、`failAgent`、Phase 06 数据目录隔离为本阶段自研最小实现。
- **未读取 `F:\ccb-source`**；未复制任何可疑源码实现、反编译痕迹、内部 API 或专有逻辑。

## 11. git status（本阶段相关）

```text
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
 M packages/tui/src/job-agent-command-runtime.ts
?? docs/delivery/phase-14C-multi-agent-baseline-closure.md
```
既有 untracked（未删除、未回滚）：`.claude/`、`AGENTS.md`、`D13D_TUI_FOUNDATION_PLAN.md`、`LINGHUN_CODE_FACT_AUDIT_REPORT_2026-05-27.md`、`LINGHUN_VS_CCB_SOURCE_COMPARISON.md`、`docs/delivery/phase-13V-BC-*.md` 等。未 commit。

## 12. 成品级结构化 Handoff Packet

```yaml
phase: D.14C
status: COMPLETE
next_phase: only after explicit user confirmation

scope_actually_done:
  - baseline closure: tui vitest 44 failed -> 0 failed / 1855 passed (no test deletion, no relaxed core assertions, no swallowed exceptions)
  - root cause A: mockOpenAi* helpers + 12 inline mocks gain SSE content-type (provider Fix-C NON_SSE rejection)
  - root cause B: Phase 06 beforeEach isolates LINGHUN_CONFIG_DIR + LINGHUN_DATA_DIR + model env keys (provider.env + data/jobs contamination)
  - root cause C: ~12 stale assertions/fixtures aligned to evolved product output (intent preserved)
  - root cause D: re-wired formatCompositeStatusQuery local composite-status answer (user decision), narrow guard, ordinary NL still reaches model (verified)
  - multi-agent: wired agent real-failure into D.14B (failAgent + captureFailureLearning, category tool_failure)
  - multi-agent: completeAgent try/catch (worker exception no longer orphans)
  - multi-agent: dedup concurrency constants to job-runtime.ts single source; handleForkCommand uses DEFAULT_JOB_RUNNING_AGENT_CAP
  - new tests: D.14C (agent failure->D.14B, cancel-not-misrecorded, source invariant)

forbidden_next_without_user_confirmation:
  - enter next phase
  - add model-facing Agent/Task spawn tool schema
  - add a permission mode / change four-tier semantics
  - change provider/env/key/model route logic
  - change D.13U/D.13V/D.14G gate or git semantics
  - restore FreshnessLite / UI big redesign / failure-learning new feature
  - put agent business logic back into index.ts
  - delete historical untracked / commit

evidence_refs:
  - file: F:/Linghun/packages/tui/src/job-agent-command-runtime.ts (failAgent + captureFailureLearning dep + const dedup + handleForkCommand cap)
  - file: F:/Linghun/packages/tui/src/index.ts (formatCompositeStatusQuery re-wire + captureFailureLearning injection)
  - file: F:/Linghun/packages/tui/src/index.test.ts (Phase 06 beforeEach isolation + SSE mock + D.14C block)
  - tests: D.14C (3), D.13U (5), D.13V (29), D.14B (23), Phase 12 agents (1), job modules (62)

verification_results:
  tsc_no_emit: PASS
  tui_build: PASS
  cli_build: PASS
  git_diff_check: PASS
  full_tui_vitest: "44 files / 1855 passed / 0 failed (baseline 44 failed)"
  phase06_block: "215 passed / 0 failed (baseline 44 failed)"
  D14C: "3 passed"
  D13U: "5 passed"
  D13V: "29 passed"
  D14B: "23 passed"
  phase12_agents: "1 passed"
  agent_job_modules: "62 passed"
  real_model_smoke: "not run"

index_ts_lines:
  d14b_baseline: 8179
  d14c_after: 8190
  diff: "+11, all composition/root glue; agent business logic in job-agent-command-runtime.ts (D.14C source invariant enforced)"

boundary_confirmation:
  entered_next_phase: false
  added_model_spawn_tool: false
  added_permission_mode: false
  changed_provider_env_key_model_route: false
  changed_D13U_D13V_D14G_semantics: false
  restored_freshness_lite: false
  agent_business_logic_in_index_ts: false
  user_cancel_misrecorded_as_failure: false
  deleted_untracked: false
  committed: false

permissions:
  sandbox_mode: danger-full-access
  approval_policy: auto mode
  new_permission_system: false

model_provider_budget:
  provider_route_changed: false
  real_provider_smoke_run: false
  budget_recorded: "not available in local tool output"

index_status:
  project: F-Linghun
  note: "codebase-memory index not used this round; located via rg + direct source reads"

created_at: 2026-05-30
generated_by: Claude Code / Linghun D.14C delivery
```
