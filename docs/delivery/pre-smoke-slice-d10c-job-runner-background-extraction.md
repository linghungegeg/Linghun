# Slice D.10C: Job/Runner Background Extraction

## 目标

从 `packages/tui/src/index.ts` 中提取 runner 和 job helper 函数到独立模块，降低 index.ts 行数，保持行为完全不变。

## git status (收口后)

```
 M packages/tui/src/index.ts
?? docs/delivery/pre-smoke-slice-d10c-job-runner-background-extraction.md
?? packages/tui/src/job-runtime.test.ts
?? packages/tui/src/job-runtime.ts
?? packages/tui/src/runner-runtime.test.ts
?? packages/tui/src/runner-runtime.ts
```

`.bak` 文件已删除，未纳入交付。

## 已完成

- `packages/tui/src/runner-runtime.ts` (726 行) — native runner resolution、lifecycle、spec 创建、状态刷新、stop/fallback/terminal 标记
- `packages/tui/src/job-runtime.ts` (595 行) — 解析、常量、纯计算、fs 持久化、格式化、路径解析
- `packages/tui/src/runner-runtime.test.ts` (220 行) — runner path resolution、missing fallback、terminal state no PASS
- `packages/tui/src/job-runtime.test.ts` (461 行) — parseJobRunOptions、path helper、isDurableJobState、formatJobReport/List/Status、read/write roundtrip
- `packages/tui/src/index.ts` 净减 1011 行 (1084 删除, 73 插入)：16626 → 15615 行

## Moved Functions 表

| 函数 | 目标文件 | 状态 |
|------|----------|------|
| resolveNativeRunner | runner-runtime.ts | MOVED |
| resolveNativeRunnerPath | runner-runtime.ts | MOVED |
| getBundledNativeRunnerCandidate | runner-runtime.ts | MOVED |
| getNativeRunnerPlatformArch | runner-runtime.ts | MOVED |
| getBundledNativeRunnerRoots | runner-runtime.ts | MOVED |
| isExecutableNativeRunnerCandidate | runner-runtime.ts | MOVED |
| parseRunnerJson | runner-runtime.ts | MOVED |
| createNativeRunnerCommand | runner-runtime.ts | MOVED |
| formatApprovedRunnerSpecLine | runner-runtime.ts | MOVED |
| createApprovedRunnerJobSpec | runner-runtime.ts | MOVED |
| startRunnerForDurableJob | runner-runtime.ts | MOVED |
| startApprovedRunnerSpec | runner-runtime.ts | MOVED |
| waitForRunnerState | runner-runtime.ts | MOVED |
| readRunnerState | runner-runtime.ts | MOVED |
| runnerHeartbeatValue | runner-runtime.ts | MOVED |
| runnerLogRefs | runner-runtime.ts | MOVED |
| safeRunnerLogRef | runner-runtime.ts | MOVED |
| isSafeRunnerRelativeLogRef | runner-runtime.ts | MOVED |
| mapNativeRunnerStatus | runner-runtime.ts | MOVED |
| refreshRunnerStatusForJob | runner-runtime.ts | MOVED |
| stopRunnerForDurableJob | runner-runtime.ts | MOVED |
| markJobRunnerTerminal | runner-runtime.ts | MOVED |
| markJobRunnerFallback | runner-runtime.ts | MOVED |
| parseJobRunOptions | job-runtime.ts | MOVED |
| clampPositiveInt | job-runtime.ts | MOVED |
| estimateJobTokens | job-runtime.ts | MOVED |
| getDurableJobMaxSteps | job-runtime.ts | MOVED |
| countDurableJobAgents | job-runtime.ts | MOVED |
| rescheduleDurableJobAgents | job-runtime.ts | MOVED |
| deriveAgentDisplayName | job-runtime.ts | MOVED |
| truncateAsciiLabel | job-runtime.ts | MOVED |
| createDurableJobAgents | job-runtime.ts | MOVED |
| persistDurableJob | job-runtime.ts | MOVED |
| appendJobLog | job-runtime.ts | MOVED |
| writeDurableJobReport | job-runtime.ts | MOVED |
| listDurableJobs | job-runtime.ts | MOVED |
| findDurableJob | job-runtime.ts | MOVED |
| readDurableJobState | job-runtime.ts | MOVED |
| isDurableJobState | job-runtime.ts | MOVED |
| getDurableJobsRoot | job-runtime.ts | MOVED |
| getDurableJobPaths | job-runtime.ts | MOVED |
| getDurableJobStatePath | job-runtime.ts | MOVED |
| formatJobList | job-runtime.ts | MOVED |
| formatJobPrimary | job-runtime.ts | MOVED |
| formatJobStatus | job-runtime.ts | MOVED |
| formatJobReport | job-runtime.ts | MOVED |
| formatJobAgentLabels | job-runtime.ts | MOVED |
| formatJobReportConclusion | job-runtime.ts | MOVED |
| formatJobLogs | job-runtime.ts | MOVED |
| handleJobCommand | index.ts | NOT_MOVED — 状态机入口，依赖 TuiContext 全量字段 |
| createDurableJob | index.ts | NOT_MOVED — 状态机入口，依赖 handoff/session/background |
| resumeDurableJob | index.ts | NOT_MOVED — 状态机入口 |
| transitionDurableJob | index.ts | NOT_MOVED — 状态机入口 |
| hydrateDurableJobBackgroundTasks | index.ts | NOT_MOVED — 依赖 TuiContext.backgroundTasks |
| recoverDurableJobForContext | index.ts | NOT_MOVED — 依赖 TuiContext 全量字段 |
| runDurableJobLiteTick | index.ts | NOT_MOVED — 状态机入口 |
| applyDurableJobBudgetStop | index.ts | NOT_MOVED — 状态机入口 |
| persistDurableJobProgress | index.ts | NOT_MOVED — 依赖 upsertJobBackgroundTask/appendBackgroundTaskEvent |
| upsertJobBackgroundTask | index.ts | NOT_MOVED — 依赖 TuiContext.backgroundTasks |
| createJobBackgroundTask | index.ts | NOT_MOVED — 依赖 TuiContext.language + background task 结构 |

## 常量迁移

| 常量 | 目标文件 | 状态 |
|------|----------|------|
| DEFAULT_JOB_RUNNING_AGENT_CAP | job-runtime.ts | MOVED |
| JOB_AGENT_HIGH_CONFIG_CANDIDATE | job-runtime.ts | MOVED |
| DEFAULT_JOB_TIMEOUT_MS | job-runtime.ts | MOVED |
| DEFAULT_JOB_BUDGET_TOKENS | job-runtime.ts | MOVED |
| JOB_LOG_TAIL_LINES | job-runtime.ts | MOVED |
| JOB_RECOVERY_HEARTBEAT_STALE_MS | job-runtime.ts | MOVED |
| DEFAULT_JOB_MAX_STEPS | job-runtime.ts | MOVED |
| MAX_JOB_MAX_STEPS | job-runtime.ts | MOVED |
| MAX_AGENTS | job-runtime.ts | MOVED |
| NATIVE_RUNNER_* (5 constants) | runner-runtime.ts | MOVED |

## 适配策略

- index.ts 中保留薄 wrapper 函数，将 `TuiContext` 映射到 `RunnerContext` / `JobContext` 子集接口
- runner-runtime.ts 通过 `RunnerRuntimeDeps` callback 接收 `appendJobLog` 和 `rescheduleDurableJobAgents`，不传入 TuiContext
- job-runtime.ts 通过 `JobContext` 接口只接收 `config`、`projectPath`、`language`

## 关键声明

- 状态机入口仍在 index.ts
- 本阶段没有新增进程守护
- 本阶段没有 Job Object
- 本阶段没有行为改动
- 未真实 smoke
- 未 Beta PASS
- 未 smoke-ready
- 未 open-source-ready
- `.bak` 文件已删除，未纳入交付

## 验证结果（收口后重跑）

```
corepack pnpm exec vitest run packages/tui/src/index.test.ts
  → 197 passed (33.62s)

corepack pnpm exec vitest run packages/tui/src/job-runtime.test.ts packages/tui/src/runner-runtime.test.ts
  → 55 passed (43 job-runtime + 12 runner-runtime, 729ms)

corepack pnpm typecheck
  → pass

corepack pnpm check
  → pass (91 files, no fixes applied)

git diff --check
  → exit=0 (no whitespace issues)
```

## 行数统计

统计命令: `wc -l packages/tui/src/index.ts packages/tui/src/runner-runtime.ts packages/tui/src/job-runtime.ts`

```
15615 packages/tui/src/index.ts
  726 packages/tui/src/runner-runtime.ts
  595 packages/tui/src/job-runtime.ts
16936 total (源码)
```

测试文件:
```
  220 packages/tui/src/runner-runtime.test.ts
  461 packages/tui/src/job-runtime.test.ts
  681 total (测试)
```

index.ts 净减: 16626 → 15615 = -1011 行

## Source-Level Reality Check / 参考核对

本阶段实际读取的 Linghun 文档:
- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\packages\tui\src\index.ts` (主源码，提取来源)
- `F:\Linghun\packages\tui\src\job-runner-presenter.ts` (确认 import 依赖)
- `F:\Linghun\packages\config\src\index.ts` (确认 resolveStoragePaths、defaultConfig 导出形态)
- `F:\Linghun\packages\shared\src\index.ts` (确认 PermissionMode 类型)
- `F:\Linghun\docs\delivery\pre-smoke-slice-d9-long-task-runner-resilience.md` (前序 runner 切片上下文)
- `F:\Linghun\docs\delivery\pre-smoke-slice-d10b-control-plane-dispatch-extraction.md` (前序 extraction 切片模式参考)

本阶段参考:
- 现有 index.ts 中的函数实现（行为保持，签名保持）
- D.9 runner resilience 切片的 runner lifecycle 设计
- D.10B control-plane extraction 切片的 wrapper 适配模式

明确声明:
- 未复制可疑源码实现
- 所有迁移函数行为与原始实现完全一致
- 仅做 move + thin wrapper，无逻辑变更
