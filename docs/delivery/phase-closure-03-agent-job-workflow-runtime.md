# Closure Phase 3 - Agent / Job / Workflow Runtime Closure

## 阶段目标

按 `LINGHUN_CLOSURE_PHASED_TASKS.md` Phase 3 收口 agent / job / workflow runtime 的 cap、状态映射、evidence 与核心执行闭环测试。范围只覆盖既有 runtime 语义修正和 focused regression，不新增第二套 runner、workflow 或 agent 系统，不进入 Closure Phase 4，也不声明全局成熟。

## 已完成功能

- background cap 语义复核：
  - 已确认 stale / terminal agent-job 历史不会降低 durable job running cap。
  - 已补直接回归：agent/job lifecycle background task 不占用 verification / index 全局 background cap。
  - cap 拒绝继续保持 resource/concurrency cap 语义，不混成 permission denial。
- workflow 状态映射：
  - `finishWorkflowRun("blocked")` 写入 background task 时不再映射为 `failed`。
  - workflow blocked 现在保持 background `status: "blocked"`、`result: "partial"`。
  - blocked 的下一步文案改为提示排查受阻 workflow step，而不是按失败步骤处理。
- agent evidence 粒度复核：
  - 复核既有 agent 子工具成功/失败、permission bridge、mailbox consumption、verifier agent evidence、final answer guard 相关路径。
  - 本阶段没有新增 evidence schema；沿用现有 evidence refs 与 parent final gate 可追踪边界。
- 核心执行闭环测试：
  - 补 `runDurableJobLiteTick()` 非 running/sleeping 保守 early-return 覆盖。
  - 补 `resumeDurableJob()` terminal job 拒绝恢复、保持 blocked result、不可升级为 verification PASS 覆盖。
  - 补 `recoverDurableJobForContext()` stale heartbeat 恢复、stale result、不可升级为 PASS 覆盖。
  - 补 `interruptAllActiveWork()` 混合 active model / BTW / background stale 的 direct counters 覆盖。
  - 同步旧 interrupt 文案断言到 Phase 1 后的真实人话口径：abort signal、marked stale、confirmed exited 分开显示。

## 使用方式

- 查看后台任务状态：`/background`
- 中断当前活动任务：`/interrupt`
- 查看 durable job：`/job list`、`/job status <id>`、`/job report <id>`、`/job logs <id>`
- 恢复 durable job：`/job resume <id>`
- 查看 workflow 状态：`/workflows status`
- 查看失败学习入口：`/failures`

## 涉及模块

- `packages/tui/src/workflow-command-runtime.ts`
- `packages/tui/src/index.test.ts`
- 复核源码：
  - `packages/tui/src/background-control-runtime.ts`
  - `packages/tui/src/job-agent-command-runtime.ts`

## 关键设计

- workflow lifecycle completion 仍不等于 verification PASS。`completed` / `partial` / `blocked` 的 background result 保持 non-PASS，需要 `/verify` 或 explicit evidence 才能支撑测试通过类结论。
- blocked 与 failed 分离：blocked 是 prerequisite / main-chain request 未形成或受阻，不再在 background 主面被显示成 failed。
- durable job resume / recovery 保守：terminal resume、stale heartbeat recovery、handoff repair 等路径都会写 non-PASS result 和 rejected conclusion，避免把局部 lifecycle 状态升级成全局成熟。
- `interruptAllActiveWork()` 返回直接计数：`cancelled`、`abortSignalsSent`、`markedOnly`，用户文案仍区分已发取消信号、已标记 stale、已确认退出。

## 配置项

本阶段没有新增配置项、环境变量、依赖或构建脚本。

## 命令

- `corepack pnpm --filter @linghun/tui exec tsc --noEmit`
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "Closure Phase 3|blocked slice|stale agent/job background history"`
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "Closure Phase 3|workflow blocked|nested workflow job|interrupt|agent evidence|durable job"`

## 测试与验证

- TUI typecheck：PASS。
- Phase 3 focused tests：1 file PASS，4 tests PASS。
- Phase 3 wider regression：1 file PASS，27 tests PASS。
- 新增/更新覆盖：
  - background cap 不被 agent/job lifecycle task 误占用。
  - durable job lite tick / resume / recovery 直接保守路径。
  - interrupt all active work direct counters。
  - workflow blocked background mapping。
  - interrupt 相关旧断言同步到真实 abort/stale/confirmed-exited 口径。

## 性能结果

- 未新增模型调用。
- 未新增后台常驻任务。
- 新增测试 fixture 使用项目 scoped durable job storage，不改变 runtime 调度成本。

## 已知问题

- agent evidence 本阶段以源码复核和既有 coverage 为主，没有新增 evidence schema 或更细的可视化面板。
- workflow blocked 仍会进入 failure learning，用于后续排查；这不代表 blocked 被当作 failed，只代表需要记录可学习的受阻事实。
- 本阶段 focused/local validation 只证明 Phase 3 范围闭环，不代表真实 full smoke、Beta PASS、smoke-ready、open-source-ready 或 Closure Phase 4-5 成熟。

## 不在本阶段处理的内容

- 不进入 Closure Phase 4 Daily Path Lightening。
- 不新增第二套 runner、workflow、agent、verification 或 background scheduler。
- 不拆 `job-agent-command-runtime.ts`、`workflow-command-runtime.ts`、`index.ts` 等大文件。
- 不关闭高级 agent / job / workflow / evidence / details 能力。
- 不把 lifecycle completed、blocked 修复或 focused tests 当作全局成熟。

## 下一阶段衔接

下一阶段是 Closure Phase 4 - Daily Path Lightening。进入前应先由用户确认；Phase 3 PASS 只证明 agent/job/workflow runtime 的本阶段 cap、状态映射和核心回归闭环，不证明普通问答、deep compact、只读查询或小改动路径已经变轻。

## 开发者排查入口

- Workflow run finish / background mapping：`packages/tui/src/workflow-command-runtime.ts`
- Durable job resume / recovery / lite tick：`packages/tui/src/job-agent-command-runtime.ts`
- Interrupt all active work / background cap：`packages/tui/src/background-control-runtime.ts`
- Phase 3 regression：`packages/tui/src/index.test.ts`
- Background task projection：`packages/tui/src/tui-agent-job-runtime.ts`

## 参考核对

- 实际读取 Linghun 文档：
  - `LINGHUN_CLOSURE_PHASED_TASKS.md`
  - `docs/delivery/README.md`
  - `docs/delivery/phase-closure-01-trust-boundary.md`
  - `docs/delivery/phase-closure-02-task-surface.md`
- 实际参考源码：
  - `packages/tui/src/workflow-command-runtime.ts`
  - `packages/tui/src/job-agent-command-runtime.ts`
  - `packages/tui/src/background-control-runtime.ts`
  - `packages/tui/src/index.test.ts`
- CCB / CCB Dev Boost / 社区参考：
  - 本阶段只按既有 Linghun 文档中的 CCB handfeel 目标做行为参考：状态清楚、受阻不冒充失败、lifecycle 不冒充 PASS。
  - 未复制 CCB 或任何可疑源码实现。

## Handoff Packet

- verdict: PASS
- nextPhase: Closure Phase 4 - Daily Path Lightening
- mustNotDo:
  - 不把 Phase 3 PASS 当作全局成熟。
  - 不自动进入 Phase 4。
  - 不新增第二套 runner / workflow / agent / background scheduler。
  - 不把 workflow/job lifecycle completed、blocked 或 partial 当成 verification PASS。
  - 不拆大文件。
- evidenceRefs:
  - `packages/tui/src/workflow-command-runtime.ts`
  - `packages/tui/src/index.test.ts`
  - `packages/tui/src/job-agent-command-runtime.ts`
  - `packages/tui/src/background-control-runtime.ts`
- validation:
  - `@linghun/tui tsc --noEmit`: PASS
  - `@linghun/tui focused vitest Phase 3`: PASS, 4 tests
  - `@linghun/tui wider Phase 3 regression`: PASS, 27 tests
- indexStatus: codebase-memory MCP tool unavailable in this Codex thread; used `rg`, source reads, focused tests, and one explorer subagent instead.
- permissionMode: local development, direct file edits in workspace; some read/typecheck commands required escalation because Windows sandbox intermittently failed with `CreateProcessAsUserW failed: 1920`.
- provider/model: Codex coding agent in local workspace; no product provider route changed.
- budgetUsed: no explicit token budget; no runtime cost changes.
