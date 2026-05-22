# Phase 17A Local Durable Jobs + Virtual Agent Concurrency

## 阶段目标

Phase 17A 本轮只完成终端运行侧的 Local Durable Jobs + Virtual Agent Concurrency Lite 最小闭环与 maturity closure：让用户可以在 TUI 中创建、查看、暂停、恢复、取消本地长期 job，并看到预算、agent 分配、handoff、日志和报告路径；同时补齐启动恢复、Lite read-only worker step、预算/运行时 stop condition 和跨会话 resource guard。

本阶段不进入 Phase 17B remote channels，不进入 Phase 18 desktop，不运行真实全量 smoke，不宣布 Beta PASS、smoke-ready 或 open-source-ready。

## Source-Level Reality Check 摘要

### Existing implementation

- `packages/tui/src/index.ts` 已有统一 `BackgroundTaskState`，kind 已包含 `job`，并有 `/background`、`/details background`、`/details output`、`/interrupt`、Resource Guard Lite、heavy-task mutex、长输出日志路径和 transcript 事件。
- `packages/config/src/index.ts` 已有 `storage.jobs` 与 `resolveStoragePaths(config, projectPath).jobs`，可复用配置解析路径，不需要硬编码用户目录或 C 盘。
- `SessionStore` / transcript 已支持 `background_task_update`；为避免扩大 core public status union，本轮将 durable job 的 `created/sleeping/blocked` 映射到 background `paused`，job 自身状态仍完整保存在 durable state 中。
- `HandoffPacket`、`validateHandoffPacket()`、evidence refs、Workspace Reference Cache / Snapshot Lite、codebase-memory status、Verification conservative verdict 已存在，可作为 job 输入边界和报告引用。
- Phase 12 `/fork` / `/agents` 已有裁剪 handoff 的 agent 体验，但不是 durable job runtime；本阶段不复制第二套 agent runtime。

### Gaps closed in this phase

- 新增 `/job` 命令最小闭环：`list/run/create/status/logs/report/pause/resume/cancel`。
- job state 持久化到 `resolveStoragePaths(context.config, context.projectPath).jobs/<jobId>/state.json`。
- job start 生成/验证 `HandoffPacket`；缺 verification/evidence/index 等关键字段时进入 `blocked`，`pauseReason=needs_handoff_repair:*`，不启动运行态 agent，也不生成 PASS evidence。
- created count 与真实 running count 分离：用户可创建多个 job agents，但默认真实运行 cap 固定为 3，额外 agent 为 sleeping。
- job 复用 `BackgroundTaskState` 和 `background_task_update` transcript，不创建孤立任务表。
- `/job report` 输出 task graph、agent assignment、budget、status、verification、adopted/rejected conclusions、pause reason、log paths。
- `/job logs` 只显示 bounded tail，并给出 full output path；raw long output 不进入主屏。
- maturity closure 补齐启动/新上下文 recovery：持久化 `running/sleeping/blocked/stale` job 会重新 hydrate 到 `/background`；缺 owner/session/heartbeat 或 heartbeat 过期时保守转为 `stale`，不生成 PASS evidence。
- maturity closure 新增 Lite read-only worker step：`running` job 至少执行一次本地结构化只读步骤，输入只包含 trimmed handoff/project facts/evidence refs/index/cache 摘要，输出写入 state/log/report，不注入完整 transcript/source/index/log。
- maturity closure 新增预算/运行时 stop condition：记录 `usedTokens/remainingTokens/maxRuntimeMs`，超 token 或 timeout 时保守转 `blocked/timeout`，不生成 PASS evidence。
- maturity closure 新增跨会话 resource guard：recovered active job 参与 `job` cap 与 heavy-task mutex，后续 job 进入 `sleeping/resource_guard:*`，保持 created agent count 与真实 running count 分离。

### Minimal touch points

- `packages/tui/src/index.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/index.test.ts`
- `docs/delivery/phase-17a-local-durable-jobs-virtual-agent-concurrency.md`

### Forbidden duplicate systems

- 不新增第二套 provider / tool / permission / evidence / MCP / index / agent / job runtime。
- 不替换 `BackgroundTaskState`、`SessionStore`、`HandoffPacket` 或 `resolveStoragePaths()`。
- 不接入 Native Local Job Runner；Node/TUI runtime 仍是默认路径。
- 不实现 Fast Workspace Scanner。
- 不进入 remote channel adapters、desktop、real full smoke 或 release publishing。

## 已完成功能

### `/job` 命令

- `/job list`
- `/job run <goal> [--phase <phase>] [--target <target>] [--agents <n>] [--tokens <n>] [--timeout <ms>] [--allow-edit] [--allow-bash] [--multi-agent]`
- `/job create <goal> ...` 或 `/job new <goal> ...`
- `/job status <id>`
- `/job logs <id>`
- `/job report <id>`
- `/job pause <id>`
- `/job resume <id>`
- `/job cancel <id>`

### Durable job state

Job state 包含：

- `goal`
- `projectPath`
- `phase`
- `target`
- `plan`
- `budget.maxTokens`
- `budget.maxRunningAgents`
- `timeoutMs`
- `permissionPolicy`
- `allowEdit`
- `allowBash`
- `allowMultiAgent`
- lifecycle state: `created/running/sleeping/blocked/stale/cancelled/timeout/completed/failed`
- `pauseReason`
- `agents[]`
- `handoffPacket`
- `logPath`
- `reportPath`
- `fullOutputPath`
- `evidenceRefs`
- `verification`
- `ownerSessionId` / `ownerPid` / `heartbeatAt`
- `worker.status` / `worker.sessionId` / `worker.summary`
- `budget.usedTokens` / `budget.remainingTokens` / `budget.maxRuntimeMs`
- `result.status` / `result.summary` / bounded facts and evidence refs
- `adoptedConclusions`
- `rejectedConclusions`

### Virtual Agent Concurrency Lite

- 默认真实 running agent cap = 3。
- `--agents 5 --multi-agent` 会创建 5 个 agent metadata，但只有 3 个 `running`，其余 `sleeping`。
- 8 agent 明确只写为 benchmark/high-config candidate，不作为默认能力承诺。
- agent summary 明确只传 trimmed handoff/evidence/cache/index refs，不注入完整 transcript/source/index/log output。
- `blocked/sleeping/cancelled/stale` 不产生 PASS evidence。

### Background / evidence / transcript 复用

- job 会 upsert 到 `context.backgroundTasks`，kind=`job`。
- job 状态更新写入 `background_task_update` transcript event。
- job 的 background result 不写 `pass`；即使未来 completed，本阶段仍按 `partial` 处理，避免把 job lifecycle 误当验证 PASS。
- `/details background <jobId>` 可查看 job background 摘要与路径。

## 使用方式

```text
/job run implement durable loop --multi-agent --agents 5 --allow-bash --allow-edit --tokens 50000 --timeout 60000
/job list
/job status <jobId>
/job report <jobId>
/job logs <jobId>
/job pause <jobId>
/job resume <jobId>
/job cancel <jobId>
/background
/details background <jobId>
```

## 涉及模块

- TUI command dispatcher：新增 `/job` 分支。
- Durable job helpers：state parse/write、log/report 写入、status transition、agent scheduling。
- Natural Command Bridge：新增 `/job` registry/capability，风险级别为 `start_gate`。
- TUI tests：新增 Phase 17A focused tests，覆盖持久化、handoff blocked、background 复用、agent cap 和 no-PASS semantics。

## 关键设计

### 状态映射

Durable job 自身保存完整 Phase 17A lifecycle。为减少 public interface 扩散，`BackgroundTaskState.status` 仍沿用现有状态：

- `created/sleeping/blocked` -> `paused`
- `running` -> `running`
- `stale` -> `stale`
- `cancelled` -> `cancelled`
- `timeout` -> `timeout`
- `completed` -> `completed`
- `failed` -> `failed`

### Startup / cross-session recovery

`runTui()`、`/job` 与 `/background` 会 bounded hydrate project-scoped persisted jobs：

- `running/sleeping/blocked/stale/created` job 重新进入 `context.backgroundTasks`，继续复用 `/background` 与 `/details background <jobId>`。
- persisted `running` job 若缺 `ownerSessionId/ownerPid/heartbeatAt`，或 heartbeat 超过本地 freshness window，保守转为 `stale`，`pauseReason=recovered_without_owner_or_heartbeat` 或 `recovered_stale_heartbeat`。
- persisted `running` job 若 handoff 缺关键字段，保守转为 `blocked`，`pauseReason=needs_handoff_repair:*`。
- recovered `blocked/stale` 只写 durable state/log/report 和 background partial/stale 状态，不产生 PASS evidence。

### Lite read-only worker step

`/job run` 或 `/job resume` 进入 `running` 后执行一次本地 Lite worker step：

- 创建独立 worker session，用于记录 job worker system event。
- 输入边界仅包含 job goal/phase/target、handoff id、bounded evidence refs、index/cache/project facts、agent assignment summary 和 log/report paths。
- 不注入完整 transcript、完整 source、完整 index 或完整 log output。
- 输出 structured partial result 到 `state.json`、`job.log`、`full-output.log` 与 `report.md`。
- worker partial result 不等于 verification PASS，也不表示 smoke-ready。

### Budget / runtime stop condition

- job state 记录 `budget.usedTokens`、`budget.remainingTokens` 与 `budget.maxRuntimeMs`。
- Lite worker 用本地文本长度估算 token usage；若会超过 `maxTokens`，转 `blocked`，`pauseReason=budget_exceeded:*`。
- 若超过 `timeoutMs/maxRuntimeMs`，转 `timeout`，background result=`timeout`。
- `blocked/timeout/stale/cancelled/sleeping` 均不生成 PASS evidence。

### Handoff gate

`/job run` 会加载或生成 handoff，并用现有 `validateHandoffPacket()` 检查关键字段。缺字段时：

- job status = `blocked`
- pause reason = `needs_handoff_repair:*`
- running agents = 0
- background result = `partial`
- 不写 PASS evidence

### Storage

所有 job 文件写到：

```text
resolveStoragePaths(context.config, context.projectPath).jobs/<jobId>/
```

包括：

- `state.json`
- `job.log`
- `full-output.log`
- `report.md`

### Native runner

Native Local Job Runner 本轮保持 DEFERRED。正式接入前仍需要 native-vs-node benchmark、Windows MSVC/linker/签名/杀软误报/中文和空格路径矩阵、Unix/macOS process group cleanup、managed/bundled runtime 分发、`/doctor runner`、fallback tests，以及 scheduler/evidence/resource guard integration。

## 配置项

本阶段复用既有配置：

- `storage.jobs`
- `permission.defaultMode`
- `modelRoutes`
- `index` / codebase-memory status

没有新增配置项。

## 命令

新增用户可见命令：

- `/job`

自然语言桥新增 capability：

- `job`，slash `/job`，risk=`start_gate`

## 测试与验证

已运行：

```text
corepack pnpm exec vitest run packages/tui/src/index.test.ts --testNamePattern "/interrupt sends AbortSignal|/interrupt cancels active verification|Phase 17A durable job|blocks Phase 17A|catalog drift|shows help"
```

结果：PASS，5 tests passed，141 skipped；覆盖 Phase 17A focused job path 和 verifier 复检发现的 `/interrupt` 取消路径。

```text
corepack pnpm test
```

结果：PASS，15 files passed，401 tests passed。该复跑确认 verifier 先前发现的 full-suite `/interrupt cancels active verification without pass evidence` order-dependent failure 已收敛；最小修复为 `/interrupt` 发送 background AbortSignal 后立即清理 controller map，避免等待子进程 finally 期间出现脏 active controller 状态。

Maturity closure 已运行：

```text
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Phase 17A|durable job|job recovery|worker loop|budget|stale|interrupt"
```

结果：PASS，1 file passed，11 tests passed，137 skipped；覆盖 Phase 17A durable job startup/recovery、Lite worker、budget stop、cross-session resource guard 和 `/interrupt` 相关路径。

```text
corepack pnpm typecheck
```

结果：PASS，`tsc -b tsconfig.json` 完成。

```text
corepack pnpm exec biome check packages/tui/src/index.ts packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.ts
```

结果：PASS，touched TypeScript files 无 formatter/lint error。

```text
corepack pnpm build
```

结果：PASS，monorepo build 完成。

```text
git diff --check
```

结果：PASS，仅有 Windows line-ending warning，无 whitespace error。

```text
corepack pnpm check
```

结果：FAIL（非本阶段新增代码）：Biome 报告 `prototypes/native-runner/bench/native-vs-node-benchmark.mjs` format / organizeImports 问题。该路径为本轮开始前已存在的 Native Runner benchmark untracked work，Phase 17A 本轮按最小改动原则未顺手修改。

待 independent verifier 复检：

- Phase 17A maturity closure focused validation。
- full check failure scope 是否仍确认为既有 Native Runner benchmark formatting，不影响本阶段 `/job` runtime。

## 性能结果

本阶段未运行 native benchmark，也未启用 8-agent high-config。当前性能边界：

- 默认 running agent cap = 3。
- job metadata、logs、report 为轻量文件写入。
- 不做后台全仓扫描，不重复注入完整 transcript/source/index/log。
- 继续复用 Workspace Reference Cache、Workspace Snapshot Lite 与 codebase-memory status。

## 已知问题

- Phase 17A Lite 只做本地 durable metadata + bounded scheduling，不执行真正长期 autonomous worker loop。
- `/job completed` 的 PASS 语义未开放；job lifecycle 不等于 verification PASS。
- runner crash recovery 仅通过 durable state/log/report 提供可恢复信息，未接入 native supervisor。
- full scheduler 的 foreground model cap / tool cap / heavy mutex 与真实多进程 agent runtime 的深度集成仍后置。

## 不在本阶段处理的内容

- Phase 17B remote channels。
- 企业微信 / 飞书 / 钉钉 adapters。
- Phase 18 desktop。
- Native Local Job Runner runtime integration。
- Fast Workspace Scanner。
- plugin/skill market、云同步、自动更新。
- 真实全量 smoke。
- Beta PASS / smoke-ready / open-source-ready 宣告。

## 下一阶段衔接

下一步仍应停在 Phase 17A 收口和验证，直到用户明确确认进入后续阶段。maturity closure 已补齐 startup recovery、Lite read-only worker step、budget decrement/stop condition 和 cross-session guard。若后续继续 Phase 17A 深化，可补：

- Lite worker 从单步结构化结果升级为 bounded 多步 worker loop，但仍不得无限自治。
- runner crash/stale recovery 更细状态与恢复建议。
- scheduler 与 model/tool caps 的更完整运行态集成。
- Native Runner gated integration spike（仅在 prerequisite 全部满足后）。

不得自动进入 Phase 17B。

## 开发者排查入口

- `/job status <id>`：查看 job 状态、pause reason、budget、paths。
- `/job report <id>`：查看结构化报告。
- `/job logs <id>`：查看 bounded log tail。
- `/background`：确认统一 background task。
- `/details background <id>`：查看 background detail。
- `state.json`：完整 durable state。
- `report.md`：结构化交接报告。
- `job.log` / `full-output.log`：长输出路径。

## 参考核对

### 实际读取的 Linghun 文档

- `START_NEXT_CHAT.md`
- `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- `docs/audit/reference-map.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `docs/delivery/phase-16-controlled-learning-memory-skill-evolution.md`
- `docs/delivery/phase-15-5a-performance-context.md`
- `docs/delivery/phase-15-5b-resource-task-lifecycle.md`
- `docs/delivery/phase-15-5c-editing-tool-ux.md`
- `docs/delivery/phase-15-5c-plus-log-artifact-runtime-lite.md`
- `docs/delivery/phase-15-5c-plus-plus-workspace-snapshot-lite.md`
- `docs/delivery/phase-15-5d-connect-lite.md`
- `docs/delivery/phase-15-5e-provider-freshness.md`
- `docs/delivery/phase-15-5f-terminal-product-readiness.md`
- `docs/audit/native-local-job-runner-research.md`
- `docs/audit/native-runner-vs-node-benchmark.md`
- Phase 15 audit / baseline relevant sections by targeted search/read

### 参考源 delta catch-up 裁决

- Local durable jobs：DONE in Lite，state/log/report/status/cancel/pause/resume/list/run path added。
- Job/report evidence integrity：DONE in Lite，blocked/cancelled/stale/timeout not PASS。
- Multi-agent claim consistency：DONE in Lite，created vs running separated，cap=3。
- Full concurrent tool scheduler：DEFERRED，Phase 17A Lite only maps resource guard and job cap。
- Long-running background jobs：PARTIAL/DONE Lite，durable metadata and report done; autonomous worker loop deferred。
- Remote channels：NOT-DO in Phase 17A。
- Native Local Job Runner：DEFERRED。
- Fast Workspace Scanner：NOT-DO。

### 行为参考与实现边界

- CCB / Claude Code Best / oh-my-openagent 仅作为 task lifecycle、summary-first、bounded logs、agent cap 行为参考。
- Linghun 实现为 clean rewrite，未复制 CCB / Claude Code / OpenCode / Hermes / third-party 源码、内部 API 或专有实现。

## 成品级结构化 handoff packet

- nextPhase: Phase 17A verification/documentation completion, then user decision before Phase 17B.
- prohibited:
  - do not enter Phase 17B remote channels
  - do not enter Phase 18 desktop
  - do not run real full smoke
  - do not claim Beta PASS / smoke-ready / open-source-ready
  - do not integrate Native Runner without prerequisite gate
  - do not implement Fast Workspace Scanner
- evidence:
  - focused vitest command above
  - typecheck command above
  - durable state/report/log files generated by focused tests under project-scoped `storage.jobs`
- indexStatus:
  - codebase-memory project `F-Linghun` status was ready during Source-Level Reality Check
- permissionMode:
  - implementation followed existing TUI permission mode and `/job` Start Gate catalog risk
- provider/model:
  - no external provider calls required for focused tests
- budgetUsage:
  - local validation only; no real multi-agent provider token spend
