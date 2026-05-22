# Phase 15.5B：Resource & Task Lifecycle

## 阶段目标

本轮只完成 Pre-Open-Source Terminal Product Completion Gate 的 Phase 15.5B：Resource & Task Lifecycle。范围限定为 Local Resource Guard Lite、既有 TUI `BackgroundTaskState` 生命周期、Bash/Verification 取消与超时边界、Verification / Review Runtime Lite 的保守证据语义，以及 focused tests。

本轮不进入 Phase 15.5C/D/E/F，不进入 Phase 16/17/18，不执行真实全量 smoke，不声明 Beta PASS 或 smoke-ready，不提交 commit，不新增第二套 task/job 系统，不实现 Phase 17A durable jobs 或 Phase 17B remote channels，不修改四种 permission mode，不绕过 Start Gate 或权限管道。

## 已完成功能

- 新增 Local Resource Guard Lite：前台模型请求并发限制为 1；后台任务全局 cap；`bash` / `verification` / `index` / `agent` 分类型 cap；重任务互斥。
- 扩展既有 `BackgroundTaskState` 生命周期：支持 `timeout`、`stale` 状态和 `index` kind，保持单一 TUI session-scoped background task 表。
- `/background` 在展示前刷新 stale 状态；运行中任务超过 `staleAfterMs` 无输出会标记为 `stale`，并给出 `/details background` / `/interrupt` 下一步。
- `/details background` / `/details output` 继续提供 log/output 路径、状态、结果和摘要追踪。
- Bash runtime 记录 `outcome=completed|timeout|cancelled`，长输出继续落盘到 `fullOutputPath`，主屏保持摘要优先。
- Bash timeout/cancel 路径先尝试正常终止，再安排 grace force kill；Windows 下优先使用 `taskkill /pid <pid> /t`，force path 使用 `/f`。
- `/verify` 运行时支持 `AbortSignal`；`/interrupt` 可以取消活动 verification，并把 background task 标为 `cancelled`。
- Verification report 支持 `cancelled`、`timeout`、`stale`，并确保这些结果不生成 PASS evidence。
- `/verify plan` 只展示计划，不启动任务；`/verify last` 展示最近验证结果。
- `/review` 对无验证、fail、partial、cancelled、timeout、stale 均输出 `CONSERVATIVE_NO_PASS`，只有最近 verification 为 `pass` 时才输出 scoped evidence verdict。
- Core transcript 类型同步扩展，允许记录新的 background/verification 状态和 `index` kind。

## 使用方式

```text
/background
/details background <id>
/details output <id>
/interrupt
/verify plan
/verify
/verify smoke
/verify last
/review
/bash <command>
/index init fast
/index refresh
/fork <类型> <任务>
```

说明：

- `/verify plan` 不执行命令，只展示计划。
- `/verify` 会创建 session-scoped background task、写 transcript event、写 verification log，并记录 test_result evidence。
- `/interrupt` 优先取消活动 verification 或前台模型请求；没有活动 controller 时才取消最近 running background task。
- cancelled/timeout/stale 只能作为 attempted/needs-review evidence，不能支撑“已验证 / tests passed / Beta PASS / smoke-ready”。
- 本阶段 background task 仍是 TUI session 内生命周期，不是持久 job，不跨进程恢复。

## 涉及模块

- `packages/tui/src/index.ts`：Local Resource Guard Lite、background lifecycle refresh、`/background`、`/details`、`/interrupt`、`/verify`、`/review`、Bash tool-use background wiring、index/agent guard wiring。
- `packages/tui/src/index.test.ts`：resource guard、stale background、interrupt verification、review/evidence boundary focused tests。
- `packages/tools/src/index.ts`：Bash `outcome`、timeout/cancel、Windows process tree cleanup、long output metadata。
- `packages/tools/src/index.test.ts`：Bash timeout/cancel outcome focused tests。
- `packages/core/src/session.ts`：Transcript event type sync for new background/verification statuses and `index` kind。
- `docs/delivery/phase-15-5b-resource-task-lifecycle.md`：本交付报告。

## Source-Level Reality Check 摘要

- existing implementation：Phase 15.5B 开工前确认 TUI 已有 session-scoped `BackgroundTaskState`、`/background` / `/details` / `/interrupt` 基础路径、Verification Runner Lite、Review Runtime Lite、Bash tool runtime、Session transcript event 记录，以及 index/agent/Bash 入口；可在现有 runtime 上做局部扩展。
- gaps：缺少本地资源 cap、缺少 `timeout` / `stale` 生命周期状态、Bash 与 verification cancel/timeout outcome 不完整、Windows process tree cleanup 不明确、verification/review 对 cancelled/timeout/stale 的 evidence 边界不够保守、focused tests 未覆盖这些生命周期边界。
- minimal touch points：只触碰 `packages/tui/src/index.ts`、`packages/tui/src/index.test.ts`、`packages/tools/src/index.ts`、`packages/tools/src/index.test.ts`、`packages/core/src/session.ts` 和交付文档；沿用既有命令、状态表、transcript、tool runtime 和 test harness。
- forbidden duplicate systems：未新增第二套 task/job 系统、未新增持久队列或 scheduler、未实现 Phase 17A durable jobs、未实现 Phase 17B remote channels/adapters、未修改四种 permission mode、未绕过 Start Gate 或 permission pipeline。

## 关键设计

### Local Resource Guard Lite

资源守门只做本阶段必需的本地轻量实现：

- 前台模型请求：若 `activeAbortController` 已存在，新自然输入不会进入 provider，会提示等待或 `/interrupt`。
- 后台全局 cap：最多 4 个 active background task。
- kind cap：`bash=1`、`verification=1`、`index=1`、`agent=3`。
- 重任务互斥：`verification`、`index`、`agent`、`bash` 视为本阶段 heavy task；已有 heavy task 时不静默排队，直接给人类可读 next action。

本阶段没有引入队列、调度器或 durable job runtime；over-cap 不自动排队，避免造成假并发或不可见资源占用。

### Background Task Lifecycle

沿用既有 `BackgroundTaskState`，没有创建第二套 task/job 系统。本阶段只扩展必要字段值：

- `kind` 增加 `index`。
- `status` 增加 `timeout`、`stale`。
- `result` 增加 `timeout`、`stale`。
- `running` 任务通过 `lastOutputAt ?? updatedAt ?? startedAt` 与 `staleAfterMs` 判断 stale。

`stale` 是保守状态：表示疑似卡住或长期无输出，不等于失败修复，也不等于 PASS。

### Cancel / Timeout / Windows cleanup

- TUI `/interrupt` 对 verification 使用 `activeVerificationAbortController.abort()`。
- Verification subprocess 和 Bash subprocess 都支持取消或超时后正常 terminate，再安排 force kill。
- Windows cleanup 使用 `taskkill /pid <pid> /t` 尝试清理进程树；force cleanup 使用 `/f`。
- cancelled/timeout/stale 路径都不产生 PASS-supporting claims。

### Verification / Review Runtime Lite

- Verification command result 使用 `pass|fail|partial|cancelled|timeout|stale` 运行时状态。
- Runner/toolchain 异常继续归类为 `partial`，保留诊断和日志。
- `/review` 使用最近 verification、changedFiles 和 evidence refs 输出 scoped verdict；没有 PASS evidence 时保守，不做通过声明。

### Output / Evidence Boundary

- 主屏只展示摘要和 log path。
- Bash full output 继续写入 `fullOutputPath`。
- Verification 每个命令写入 `.linghun/logs/verification/...`。
- Evidence `supportsClaims` 只有 `report.status === "pass"` 才包含“已验证 / tests passed”等 PASS claim。

## 配置项

本阶段未新增配置项，未修改依赖，未修改构建脚本。

## 命令

本阶段未新增全新 slash command；扩展/强化既有命令行为：

- `/background`：展示 running/stale/timeout/cancelled/log path。
- `/details background <id>` 与 `/details output <id>`：展示 background/output trace。
- `/interrupt`：支持取消 verification/background。
- `/verify plan|last|smoke` 与 `/verify`：运行时状态和 evidence 边界增强。
- `/review`：无 PASS evidence 时保守 verdict。
- `/bash`、model tool-use Bash、`/index init fast`、`/index refresh`、`/fork`：接入本地资源守门。

## 测试与验证

Focused tests（本轮已执行）：

- `corepack pnpm exec vitest run packages/tools/src/index.test.ts`：PASS（1 file，5 tests）。
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "resource caps|stale background|stale verification conservative|interrupt cancels|review and evidence|verification|background|review|Bash|interrupt"`：PASS（1 file，16 passed，111 skipped）。

Repository validation（本轮已执行）：

- `corepack pnpm typecheck`：PASS。
- `corepack pnpm check`：PASS。
- `git diff --check`：PASS（仅有 Windows LF/CRLF 提示，无 whitespace error）。
- `corepack pnpm test`：PASS（14 files，363 tests）。
- `corepack pnpm build`：PASS。

本轮不执行真实全量 smoke；上述验证不构成 Beta PASS 或 smoke-ready 声明。

## 性能结果

- Resource Guard Lite 在命令入口做常数级 active task 扫描，默认只扫描当前 session 内最多 50 条 background task。
- `/background` stale refresh 只在展示/守门路径运行，不启动后台轮询。
- 长 stdout/stderr 不进入主屏；Bash 与 verification 均保留 log/full output 路径，减少 prompt/status 污染。

## 已知问题

- Background task 仍是 TUI session 内状态；重启后不恢复，不是 Phase 17A durable jobs。
- Agent 路径仍沿用现有同步降级实现；本阶段只增加 cap/guard，不实现真实后台 agent scheduler。
- Windows process tree cleanup 做了本地 runtime 支持和 Bash focused coverage；真实复杂进程树仍需在后续真实环境中复核。
- 本轮未执行真实全量 smoke，因此不能宣称真实项目完整链路通过。

## 不在本阶段处理的内容

- Phase 15.5C/D/E/F。
- Phase 16/17/18。
- Phase 17A local durable jobs。
- Phase 17B remote channels / 企业微信 / 飞书 / 钉钉 adapter。
- 第二套 task/job 系统、持久队列、跨进程恢复、远程控制平台。
- 权限模式变更、Start Gate 变更、权限管道绕过。
- 真实全量 smoke、Beta PASS、smoke-ready 决策。

## 下一阶段衔接

Phase 15.5B 完成后必须停止，由用户决定是否进入 Phase 15.5C。不得自动进入 Phase 15.5C/D/E/F、Phase 16/17/18，也不得把本轮 focused/local validation 解释为真实全量 smoke 或 Beta readiness。

## 开发者排查入口

- Resource guard：`packages/tui/src/index.ts` 的 `checkResourceGuard()` / `checkBackgroundStartGuard()`。
- Stale lifecycle：`refreshBackgroundLifecycle()`。
- Background trace：`formatBackgroundTask()` / `formatBackgroundDetails()` / `formatBackgroundOutputDetails()`。
- Verification runner：`handleVerifyCommand()` / `runVerificationPlan()` / `runVerificationCommand()`。
- Evidence boundary：`recordVerificationEvidence()`。
- Review verdict：`createReviewReport()`。
- Bash runtime：`packages/tools/src/index.ts` 的 `bashTool()` / `runShell()`。

## 参考核对

本阶段实际读取的 Linghun 文档：

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\START_NEXT_CHAT.md`
- `F:\Linghun\docs\delivery\pre-open-source-terminal-product-completion-gate.md`
- `F:\Linghun\docs\delivery\phase-15-5a-performance-context.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\audit\reference-map.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`

本阶段参考核对范围：

- 只参考 CCB / CCB Dev Boost / Codex / community 成熟产品的行为边界：任务可见性、取消/超时/stale、长输出落盘、证据边界、review 保守 verdict。
- 进入 Linghun 自研实现的内容：本地 Resource Guard Lite、既有 `BackgroundTaskState` 状态扩展、Bash/verification cancel/timeout outcome、focused tests。
- 未复制 CCB、CCB Dev Boost、Codex 或其他第三方可疑源码实现、内部 API、专有遥测或内部服务逻辑。

### Reference delta catch-up 裁决表

| 来源细节 | 裁决 | Phase 15.5B 处理 |
| --- | --- | --- |
| `reference-map`：后台任务必须可见，能看到状态、摘要、log/output 路径 | DONE | `/background`、`/details background`、`/details output` 继续基于既有 `BackgroundTaskState` 展示 running/stale/timeout/cancelled/log path。 |
| `reference-map`：长 stdout/stderr 不污染主屏，完整输出落盘 | DONE | Bash 保留 `fullOutputPath`；verification 每个命令写 `.linghun/logs/verification/...`；主屏 summary-first。 |
| `reference-map`：取消、超时、疑似卡住必须有保守状态和下一步 | DONE | 增加 `cancelled`、`timeout`、`stale` 运行时语义；`stale` 提示 `/details background` 与 `/interrupt`。 |
| `reference-map`：Bash/verification 取消后先正常终止，再 force cleanup；Windows 需尽量清理进程树 | DONE | Bash 与 verification subprocess 使用正常 terminate + grace force kill；Windows 使用 `taskkill /pid <pid> /t`，force path 使用 `/f`。 |
| reconciliation：Verification 结果必须区分 pass/fail/partial/cancelled/timeout/stale | DONE | `VerificationRuntimeStatus`、report、transcript 类型和 tests 同步扩展。 |
| reconciliation：cancelled/timeout/stale 不得支撑“已验证 / tests passed” | DONE | `recordVerificationEvidence()` 仅在 `report.status === "pass"` 时写 PASS claims；stale run 后续成功也保持 conservative。 |
| reconciliation：Review 无 PASS evidence 时必须保守 | DONE | `/review` 对无验证、fail、partial、cancelled、timeout、stale 输出 `CONSERVATIVE_NO_PASS`。 |
| baseline：本地资源守门，避免无限并发、静默排队和不可见资源占用 | DONE | 增加 foreground model cap、background global cap、kind cap、heavy mutual exclusion；over-cap 输出 human-readable next action。 |
| baseline：不要新增第二套 task/job 系统 | DONE | 只扩展既有 session-scoped `BackgroundTaskState`；未引入新 job runtime。 |
| baseline：durable jobs、跨进程恢复、remote channels 属后续阶段 | DEFERRED | 明确不做 Phase 17A durable jobs、不做 Phase 17B 企业微信/飞书/钉钉 remote channels。 |
| baseline：真实全量 smoke、Beta PASS、smoke-ready 决策 | DEFERRED | 本阶段只做 focused/local validation；真实全量 smoke 和 Beta readiness 仍待后续用户决策。 |
| baseline：修改四种 permission mode 或绕过 Start Gate / permission pipeline | NOT-DO | 本阶段未修改 permission modes，未改 Start Gate 或 permission pipeline。 |
| baseline：复制 CCB/Codex/第三方源码、内部 API、专有遥测 | NOT-DO | 仅参考成熟产品行为边界；实现为 Linghun 自研局部补丁。 |

## 成品级结构化 handoff packet

- 下一阶段：可由用户决定是否进入 Phase 15.5C；不得自动进入。
- 禁止事项：不得进入 Phase 15.5C-F / Phase 16/17/18；不得执行真实全量 smoke；不得宣称 Beta PASS 或 smoke-ready；不得 commit；不得新增第二套 task/job 系统；不得实现 durable jobs 或 remote channels；不得修改四种 permission mode 或绕过 Start Gate/permission pipeline。
- 证据引用：`packages/tools/src/index.test.ts`、`packages/tui/src/index.test.ts` focused tests；本报告“测试与验证”命令输出。
- 验证结果：focused tools PASS；focused TUI PASS；typecheck PASS；check PASS；full test/build/git diff --check 等最终结果见本报告更新。
- 索引状态：`mcp__codebase-memory-mcp__index_status(project=F-Linghun)` 返回 ready（nodes=1456，edges=2793）。
- 权限模式：未修改四种 permission mode；Start Gate / permission pipeline 保持既有路径。
- 模型/provider：本地实现与测试 provider-agnostic；未写入或泄露 provider key。
- 预算使用：Resource Guard Lite 只做本地 session 状态扫描；未运行真实全量 smoke；未发额外联网请求。
