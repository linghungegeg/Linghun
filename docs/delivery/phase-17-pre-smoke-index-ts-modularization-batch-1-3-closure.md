# Phase 17 Pre-Smoke `index.ts` Modularization Batch 1-3 Combined Closure

## 状态声明

- 本轮性质：Pre-Smoke `packages/tui/src/index.ts` modularization Batch 1-3 combined closure / regression gate。
- 本轮只做 Batch 1-3 累计拆分的源码复核、focused regression、本地验证和文档收口。
- 本轮不继续 Batch 4。
- 本轮不新增 runtime capability，不做 TUI polish / 美化。
- 未运行真实 provider。
- 未使用真实 provider key。
- 未进入真实项目 smoke。
- 未进入 Phase 18 / open-source release。
- 未提交 commit。
- 当前仍不是 Beta PASS / smoke-ready / open-source-ready。

## Source-Level Reality Check 摘要

### Batch 1 actual split

`packages/tui/src/index-runtime.ts` 当前承载 index/codebase-memory 低耦合内容：

- `CodebaseMemoryBinarySource`
- `CodebaseMemoryBinaryStatus`
- `CodebaseMemoryArtifactStatus`
- `CodebaseMemoryProjectSelectionSource`
- `IndexSafetyFile`
- `IndexState`
- `CurrentIndexProject`
- `createIndexState()`
- `findCurrentIndexProject()`
- `createCurrentIndexProjectNameCandidates()`

复核结论：

- 未硬编码 `F-Linghun`；测试中出现的 `F-Linghun` 仅用于候选名匹配 fixture。
- `/index status` 默认 fast path 仍只走 `list_projects` + `index_status`，并写明 `fast status：未运行 detect_changes`。
- `/index status --fresh` / `/index check` 仍通过 `refreshIndexStaleHint()` 触发 `detect_changes`。
- `runIndexQuery()`、`runIndexRepository()`、`runCodebaseMemoryCli()`、evidence/background task 相关 heavy runtime 仍保留在 `index.ts`。

### Batch 2 actual split

`packages/tui/src/remote-mcp-presenter.ts` 当前承载 Remote / MCP 纯 presenter helper：

- `formatRemoteStatus(remote)`
- `formatRemoteTestResult(channel, event)`
- `formatMcpTools(mcp)`

复核结论：

- 该模块只 `import type` 来自 `./index.js` 的类型。
- 未执行 Remote transport、approval processing、MCP validation、MCP tool execution 或 provider/model/tool runtime。
- `webhook_mock` 仍明确为 diagnostic/test-only dry run，不代表真实 remote delivery PASS。
- MCP placeholder 仍明确为安全占位摘要，不输出完整 schema。

### Batch 3 actual split

`packages/tui/src/job-runner-presenter.ts` 当前承载 Native Runner / Durable Job / background task 纯 presenter / mapper helper：

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

复核结论：

- 该模块只 `import type` 来自 `./index.js` 的状态类型。
- 未启动 runner，未读写文件，未执行 artifact slicing，未 mutate job/background state。
- `/doctor runner` 仍由 `index.ts` 调用 `resolveNativeRunner(context.config)`，再把 resolver 输出、expected protocol 和 sanitize callback 传给 presenter。
- `resolveNativeRunner()`、Native Runner adapter/scheduler/process supervision、Durable Job state machine、resource guard、`readLogArtifactSlice()` / `formatLogArtifactSlice()` 仍保留在 `index.ts` 或原 runtime 模块。

### 仍保留在 `index.ts` 的高风险内容

以下内容未在 Batch 1-3 拆出，避免真实 smoke 前引入结构性风险：

- model loop / provider streaming / tool_use / tool_result continuation。
- slash command router 和主要 command dispatch。
- permission pipeline、四权限模式语义、hard deny / Start Gate 边界。
- Native Runner resolver / adapter / scheduler / process supervision / status machine。
- Durable Job state machine、job persistence、cancel/timeout/stale/blocked mutation。
- background task lifecycle mutation、resource guard、background insertion / refresh。
- `/details output` artifact registry slicing runtime。
- index query/runtime heavy path：`runIndexQuery()`、`runIndexRepository()`、`runCodebaseMemoryCli()`、safety scan、evidence/background task linkage。

### Batch 4 裁决

- Batch 4 暂停；本轮不继续拆分。
- smoke 前不拆 model loop、slash router、permission pipeline、runner adapter/scheduler、job state machine、resource guard、artifact slicing 或 index heavy runtime。
- 如后续真实 smoke 暴露必须修复的问题，默认先做局部补丁；是否继续拆分需用户单独确认。

## 修改文件清单

本轮 combined closure 新增/更新：

- `docs/delivery/phase-17-pre-smoke-index-ts-split-plan.md`：标记 Batch 1-3 combined closure，暂停 Batch 4，补充 smoke 前禁止继续拆分的高风险边界。
- `docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-1-3-closure.md`：新增本综合收口报告。

Batch 3 已存在未提交改动仍在工作区：

- `packages/tui/src/job-runner-presenter.ts`
- `packages/tui/src/job-runner-presenter.test.ts`
- `packages/tui/src/index.ts`
- `docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-3.md`

## Regression Gate 结果

| 命令 | 结果 |
| --- | --- |
| `git status --short` | PASS：确认工作区仅含 Batch 3 + closure 文档相关未提交改动 |
| codebase-memory `index_status` project=`F-Linghun` | ready：`nodes=1855`，`edges=3905` |
| codebase-memory `search_code` pattern=`formatRemoteStatus formatMcpTools formatRunnerDoctor formatBackgroundTask createIndexState detect_changes` | 0 results；按规则降级为 `Grep` / 精读源码确认 |
| `corepack pnpm exec vitest run packages/tui/src/index-runtime.test.ts packages/tui/src/remote-mcp-presenter.test.ts packages/tui/src/job-runner-presenter.test.ts` | PASS：3 files；15 tests passed |
| `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "index status\|codebase-memory\|fresh\|remote channels\|Remote Channels\|MCP tools\|runner\|native\|background\|details output\|verification\|cancel\|timeout"` | PASS：1 file；46 passed，110 skipped |
| `corepack pnpm typecheck` | PASS：`tsc -b tsconfig.json` 完成 |
| `corepack pnpm check` | PASS：Biome check 通过，64 files checked |
| `corepack pnpm build` | PASS：monorepo build 完成 |
| `git diff --check` | PASS：无 whitespace error |

## Sensitive / Claim Boundary Scan

执行了推荐 pattern 的源码/文档扫描：

- `packages/tui/src` 扫描命中主要来自既有 test fixture、负向断言、边界文案和已有 readiness / job 非 PASS 文案，例如 `sk-test`、`sk-live`、`not.toContain(...)`、`不是 Beta PASS / smoke-ready / open-source-ready`。
- `docs/delivery` 扫描命中主要来自历史交付文档中的明确负向边界和“完整日志不进主屏”类说明。
- 新增 `job-runner-presenter.ts` 无上述敏感/claim pattern 命中。
- Batch 3 报告和本 closure 报告中的 `Beta PASS` / `smoke-ready` / `open-source-ready` 均为明确否定性边界，不是 readiness 宣称。

未发现本轮新增真实 provider key、raw provider request、complete provider response 或完整日志正文。

## 行为不变说明

- 未改变 provider / model / tool / permission / evidence / MCP / index / job / runtime 语义。
- 未改变四权限模式语义。
- 未新增第二套 runner / job / scheduler / remote / MCP / permission / evidence / index / runtime 系统。
- 未改变 `/index status` 默认 fast path 与 `detect_changes` 触发边界。
- 未改变 `/remote` / `/mcp` runtime、validation 或 execution 链路。
- 未改变 `/doctor runner`、Native Runner fallback、Durable Job lifecycle、background task lifecycle 或 `/details output` artifact slicing 边界。
- focused/local PASS 不等于真实 provider smoke、真实项目 smoke、Beta PASS、smoke-ready 或 open-source-ready。

## 复检说明

- 本轮按 combined closure 要求执行本地源码复核与 regression gate。
- 曾按默认 gate 启动独立 adversarial verifier agent；按用户最新指令“停止独立复检”，已停止该 agent，本报告不记录 independent verifier PASS。
- 本轮改为本会话自检：复查 diff、Batch 1-3 拆分边界、presenter/type-only import、detect_changes 触发边界、focused regression、typecheck、check、build、diff-check 和敏感/claim scan 输出。
- 自检结论仅限本地 combined regression：Batch 1-3 当前未发现拆分回归，且高风险 runtime 仍留在原边界。
- 剩余风险：缺少独立 adversarial verifier verdict；如后续需要严格 gate，可单独启动独立复检。

## 参考核对

- 本轮读取/复核的 Linghun 文档：
  - `docs/delivery/phase-17-pre-smoke-index-ts-split-plan.md`
  - `docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-1.md`
  - `docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-2.md`
  - `docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-3.md`
- 本轮读取/复核的源码/测试：
  - `packages/tui/src/index-runtime.ts`
  - `packages/tui/src/remote-mcp-presenter.ts`
  - `packages/tui/src/job-runner-presenter.ts`
  - `packages/tui/src/job-runner-presenter.test.ts`
  - `packages/tui/src/index.ts` 关键 import、runner doctor 和 index status / detect_changes 段落
  - `packages/tui/src/index.test.ts` filtered regression 覆盖
- 本轮优先检查 codebase-memory 索引项目 `F-Linghun`：`index_status` 返回 ready；目标宽 pattern 未返回结果，因此降级为 `Grep` / 精读源码确认。
- 未参考或复制 CCB / Claude Code / OpenCode / 第三方源码；本轮仅复核和记录 Linghun 自研代码。

## 明确 NOT

- 不是 Beta PASS。
- 不是 smoke-ready。
- 不是 open-source-ready。
- 未进入真实 provider / 真实项目 smoke。
- 未进入 Phase 18 / open-source release。
- 未提交 commit。
- 未继续 Batch 4。
- 未新增 runtime capability 或 TUI polish。
- 未新增第二套 runner / job / scheduler / remote / MCP / permission / evidence / index / runtime 系统。

## Handoff Packet

```json
{
  "phase": "phase-17-pre-smoke-index-ts-modularization-batch-1-3-closure",
  "date": "2026-05-23",
  "scope": "Batch 1-3 combined closure/regression gate only",
  "indexProject": "F-Linghun",
  "indexStatusAtStart": "ready",
  "indexStatusNodes": 1855,
  "indexStatusEdges": 3905,
  "changedFilesThisClosure": [
    "docs/delivery/phase-17-pre-smoke-index-ts-split-plan.md",
    "docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-1-3-closure.md"
  ],
  "batch1MovedOut": [
    "index/codebase-memory pure types",
    "createIndexState",
    "findCurrentIndexProject",
    "createCurrentIndexProjectNameCandidates"
  ],
  "batch2MovedOut": [
    "formatRemoteStatus",
    "formatRemoteTestResult",
    "formatMcpTools"
  ],
  "batch3MovedOut": [
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
    "Batch 4",
    "model loop",
    "slash command router",
    "permission pipeline",
    "Native Runner adapter/scheduler/process supervision",
    "durable job state machine",
    "resource guard/background lifecycle mutation",
    "details output artifact slicing runtime",
    "index query/runtime heavy path"
  ],
  "validation": [
    "presenter/runtime focused vitest PASS",
    "filtered index regression vitest PASS",
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
    "commit",
    "TUI polish"
  ],
  "nextDecision": "Batch 1-3 closure is locally clean; user may separately decide whether to enter TUI polish/beautification stage, but this closure does not make the project smoke-ready."
}
```
