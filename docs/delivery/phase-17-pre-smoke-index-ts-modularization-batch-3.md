# Phase 17 Pre-Smoke `index.ts` Modularization Batch 3

## 状态声明

- 本轮性质：Pre-Smoke `packages/tui/src/index.ts` modularization Batch 3。
- 本轮只做低风险 Native Runner / Durable Job / background task 用户可见 presenter、summary、formatter helper 拆分。
- 未运行真实 provider。
- 未使用真实 provider key。
- 未进入真实项目 smoke。
- 未进入 Phase 18 / open-source release。
- 未提交 commit。
- 当前仍不是 Beta PASS / smoke-ready / open-source-ready。

## Source-Level Reality Check 摘要

### 现有实现

`packages/tui/src/index.ts` 中 Native Runner / Durable Job / background task presenter 相关职责包括：

- Native Runner doctor/status presenter：`formatRunnerDoctor()` 输出 `/doctor runner` summary-first 状态、fallback、protocol、DEFERRED 边界。
- Native Runner job summary：`formatJobRunnerInline()`、`formatJobRunnerReportLine()` 输出 job primary/status/report/background/report file 中的 runner inline 和 report 行。
- Durable Job user-visible presenter：`formatJobList()`、`formatJobPrimary()`、`formatJobStatus()`、`formatJobReport()`、`formatJobLogs()`、`formatJobNextAction()`。
- Background task presenter：`formatBackgroundTask()`、`formatBackgroundDetails()`、`formatBackgroundOutputDetails()`。
- Durable job 到 background 映射：`mapDurableJobToBackgroundStatus()`、`mapDurableJobToBackgroundResult()`。
- Lifecycle / runtime helpers：`createJobBackgroundTask()`、`checkResourceGuard()`、`checkBackgroundStartGuard()`、`rememberBackgroundTask()`、`refreshBackgroundLifecycle()`。
- Details / long output：`/details output` 通过 `readLogArtifactSlice()` / `formatLogArtifactSlice()` 读取 artifact registry，不直接读取普通源码文件。

### 本轮可安全搬出

- `formatRunnerDoctor()`：改为接收 resolver 输出、expected protocol 和 sanitize callback，不接收完整 `TuiContext`。
- `formatJobRunnerInline()`。
- `formatJobRunnerReportLine()`。
- `formatJobNextAction()`。
- `mapDurableJobToBackgroundStatus()`。
- `mapDurableJobToBackgroundResult()`。
- `formatBackgroundTask()`。
- `formatBackgroundDetails()`。
- `formatBackgroundOutputDetails()`。

这些 helper 只做字符串格式化或状态映射，不启动 runner、不读写文件、不调 provider、不改 permission/evidence/job state。

### 本轮暂不搬出

- `resolveNativeRunner()`、`startRunnerForDurableJob()`、`startApprovedRunnerSpec()`、`refreshRunnerStatusForJob()`、`stopRunnerForDurableJob()`：属于 resolver / adapter / process supervision / status machine，明确不拆。
- `createApprovedRunnerJobSpec()`、`markJobRunnerTerminal()`、`markJobRunnerFallback()`：虽然局部，但仍与 runner lifecycle mutation 强耦合，保留。
- `createJobBackgroundTask()`：依赖 `TuiContext`、`truncateDisplay()`、job cap、background insertion 链路；硬拆会引入 wrapper 或扩大边界，保留。
- `formatJobList()`、`formatJobPrimary()`、`formatJobStatus()`、`formatJobReport()`：依赖 counts、runtime 常量、路径和多处 job fields；本轮只迁移其低耦合子 helper。
- `formatJobLogs()`：读取 job log 文件，非纯 presenter，保留。
- `/details output` artifact slicing：涉及 artifact registry 和文件读取边界，保留。
- resource guard / background lifecycle mutation：不属于纯 presenter，保留。

### 最小 touch points

- `packages/tui/src/job-runner-presenter.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/job-runner-presenter.test.ts`
- `docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-3.md`

### 禁止重复实现的系统

本轮未新增第二套 runner / job / scheduler / process supervisor / permission / evidence / runtime 系统；未拆 model loop、slash command router、permission pipeline、Native Runner adapter、Native Runner scheduler、process supervision、background job 状态机、MCP/index runtime。

## 修改文件清单

- `packages/tui/src/job-runner-presenter.ts`：新增小模块，承载 Native Runner / Durable Job / background task 纯 presenter helpers。
- `packages/tui/src/index.ts`：改为从 `job-runner-presenter.ts` 导入上述 helper，并删除本地重复 formatter / mapper。
- `packages/tui/src/job-runner-presenter.test.ts`：新增 focused unit tests 覆盖 runner doctor、fallback/placeholder、background summary、secret boundary、details output artifact boundary。
- `docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-3.md`：新增本交付记录。

## 实际拆出的内容

`job-runner-presenter.ts` 当前包含：

- `RunnerDoctorResolutionView`
- `formatRunnerDoctor()`
- `formatJobRunnerInline()`
- `formatJobRunnerReportLine()`
- `mapDurableJobToBackgroundStatus()`
- `mapDurableJobToBackgroundResult()`
- `formatJobNextAction()`
- `formatBackgroundDetails()`
- `formatBackgroundOutputDetails()`
- `formatBackgroundTask()`

## 行为不变说明

- `/doctor runner` 输出字段和文案保持不变；只把 `formatRunnerDoctor(context)` 改为 `formatRunnerDoctor(resolveNativeRunner(context.config), expectedProtocol, sanitizeDiagnosticText)`。
- `/job run`、`/job status`、`/job report`、`/job logs`、`/job cancel` 行为不变。
- `/background` 和 `/details background|output` 用户可见格式保持不变。
- Native Runner disabled / unavailable / available / protocol_mismatch fallback 文案保持原有边界，不宣称 native runner 完整收益。
- completed / cancelled / timeout / stale / blocked 仍不等于 verification PASS。
- details output 仍只暴露 artifact slicing 命令，不在 presenter 中读取普通源码文件或完整日志。
- 未改变 cancel / timeout / stale / owner-death / fallback / permission / evidence / transcript / artifact slicing / resource guard 逻辑。
- 未改变 Node 默认路径与 Native Runner 长任务候选路径边界。
- 未新增 native runner 启动、安装、setup、升级或 release artifact 逻辑。

## Focused tests 覆盖

`packages/tui/src/job-runner-presenter.test.ts` 覆盖：

- runner disabled / missing / ready 状态展示。
- fallback / placeholder 文案不宣称 native runner 完整收益，不宣称 Beta PASS / smoke-ready。
- background / durable job status 摘要包含 status、next action、artifact refs，不输出完整日志。
- failed / timeout / cancelled 摘要在已 bounded state 下不泄露 token、API key、Bearer raw、完整 secret path。
- details output presenter 保持 artifact boundary，只输出 `/details output ... --tail|--grep|--errors` slicing 提示，不读取文件。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm exec vitest run packages/tui/src/job-runner-presenter.test.ts packages/tui/src/index.test.ts -t "runner|native|background|details output|verification|cancel|timeout"` | PASS：2 files；27 passed，134 skipped |
| `corepack pnpm typecheck` | PASS：`tsc -b tsconfig.json` 完成 |
| `corepack pnpm check` | PASS：Biome check 通过。第一次运行发现新增文件格式化问题；已按 formatter 输出修正后复跑通过 |
| `corepack pnpm build` | PASS：monorepo build 完成 |
| `git diff --check` | PASS：无 whitespace error |

未运行真实 provider、真实 native runner 长任务、真实项目 smoke、真实远程服务或 release artifact 验证。

## 复检说明

- 按用户指令，已停止独立 verification agent；本报告不记录 independent verifier PASS。
- 本轮改为本会话自检：复查 `git diff`、新增 presenter 模块、focused tests、typecheck、check、build、diff-check 输出。
- 自检结论：当前 diff 仅移动纯 presenter / mapper helper，并增加 focused tests 与交付记录；未发现调度、进程监督、权限、evidence、runtime、provider/model/tool/MCP/index/job 状态语义改动。
- 剩余风险：缺少独立 adversarial verifier verdict；如后续需要严格 gate，可单独启动独立复检。

## 未拆内容 / 后续候选

建议后续如继续 Batch 4，仍需用户单独确认，并保持小步：

1. 可考虑继续拆 `formatJobPrimary()` / `formatJobStatus()` / `formatJobReport()` 中更多纯 presenter，但需先确认 counts / path / constant 输入边界，避免引入大 wrapper。
2. 可考虑把 background details/list 进一步整理，但不得移动 `refreshBackgroundLifecycle()`、`checkResourceGuard()`、`rememberBackgroundTask()` 等状态 mutation。
3. 不建议在 Batch 4 硬拆 Native Runner adapter / scheduler / process supervision、durable job state machine、slash router、model loop 或 permission pipeline。
4. `/details output` 的 artifact slicing 逻辑仍应留在现有 log artifact runtime，除非后续单独做 artifact presenter 拆分且不改变读取边界。

## 参考核对

- 本轮实际读取的 Linghun 文档：`START_NEXT_CHAT.md`、`docs/delivery/phase-17-pre-smoke-index-ts-split-plan.md`、`docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-1.md`、`docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-2.md`、`docs/delivery/pre-smoke-p2-closure-hardening.md`、`docs/delivery/phase-17c-native-runner-job-supervisor-gate.md`。
- 用户要求读取的 `docs/delivery/phase-17c-a-native-runner-bundled-runtime-gate.md` 与 `docs/delivery/phase-17c-b-native-runner-managed-package-gate.md` 在当前仓库不存在；已通过 `Glob` 确认当前只有合并报告 `phase-17c-native-runner-job-supervisor-gate.md`，且其中包含 17C.A / 17C.B 内容。
- 本轮实际读取的源码/测试：`packages/tui/src/index.ts`、`packages/tui/src/index.test.ts`、既有 `remote-mcp-presenter.ts` / test 作为同类小 presenter 模块风格参考。
- 本轮优先检查 codebase-memory 索引项目 `F-Linghun`：`index_status` 返回 ready；`search_code` 对目标自然语言 pattern 未返回有效结果，因此降级为 `Grep` / 精读源码确认。
- 未参考或复制 CCB / Claude Code / OpenCode / 第三方源码；本轮仅移动 Linghun 自研代码。

## 明确 NOT

- 不是 Beta PASS。
- 不是 smoke-ready。
- 不是 open-source-ready。
- 未进入真实 provider / 真实项目 smoke。
- 未进入 Phase 18 / open-source release。
- 未提交 commit。
- 未新增第二套 runner / job / scheduler / process supervisor / permission / evidence / runtime 系统。
- 未改变 provider / model / tool / permission / evidence / MCP / index / job / runtime 行为。

## Handoff Packet

```json
{
  "phase": "phase-17-pre-smoke-index-ts-modularization-batch-3",
  "date": "2026-05-23",
  "scope": "low-risk Native Runner / Durable Job / background presenter helper split only",
  "indexProject": "F-Linghun",
  "indexStatusAtStart": "ready",
  "changedFiles": [
    "packages/tui/src/job-runner-presenter.ts",
    "packages/tui/src/index.ts",
    "packages/tui/src/job-runner-presenter.test.ts",
    "docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-3.md"
  ],
  "movedOut": [
    "formatRunnerDoctor",
    "formatJobRunnerInline",
    "formatJobRunnerReportLine",
    "mapDurableJobToBackgroundStatus",
    "mapDurableJobToBackgroundResult",
    "formatJobNextAction",
    "formatBackgroundDetails",
    "formatBackgroundOutputDetails",
    "formatBackgroundTask"
  ],
  "deferred": [
    "Native Runner resolver/adapter/scheduler/process supervision",
    "durable job state machine",
    "createJobBackgroundTask and resource guard mutation",
    "formatJobList/Primary/Status/Report/Logs full extraction",
    "details output artifact registry runtime",
    "slash router",
    "model loop",
    "permission pipeline"
  ],
  "validation": [
    "focused vitest PASS",
    "typecheck PASS",
    "check PASS",
    "build PASS",
    "git diff --check PASS"
  ],
  "notDone": [
    "real provider smoke",
    "real project smoke",
    "real native runner long-task smoke",
    "Beta PASS",
    "smoke-ready",
    "open-source-ready",
    "Phase 18",
    "commit"
  ],
  "nextDecision": "User may choose whether to continue with Batch 4; default stop after Batch 3."
}
```
