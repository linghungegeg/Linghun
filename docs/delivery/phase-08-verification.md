# Phase 08：代码自检与验证增强闭环

## 阶段目标

完成 Linghun Phase 08 代码自检与验证增强闭环，在 Phase 07 行为控制、BackgroundTask、Evidence Gate 和 Claim Checker 基础上接入 Verification Runner、`/verify`、`/verify last`、`/review`、验证日志和 transcript evidence。

本阶段只实现 Phase 08 验证闭环，不进入 Phase 09 cache/cost/usage/stats，不实现 Phase 10 MCP/index 完整闭环，不实现 Phase 11 会话记忆/handoff 新能力，不实现 Agent、多模型协作、Plugins、Hooks、长期任务、Remote Channels 或桌面端。

## 已完成功能

- Verification Runner 基础能力：
  - 从项目 `package.json` scripts 探测 `typecheck` / `test` / `lint` / `build` / `smoke`。
  - 无项目验证脚本时降级为 `node --version` smoke。
  - `/verify smoke` 提供最小验证路径。
- 验证计划：
  - `/verify plan` 输出当前项目可执行验证计划。
  - `/verify` 执行探测到的验证步骤。
- 验证结果：
  - 记录每个步骤的 kind、命令、状态、exitCode、耗时、摘要和日志路径。
  - 汇总为 `PASS` / `FAIL` / `PARTIAL`。
  - 区分被验证命令失败和 runner/Node/toolchain 退出清理异常：命令明确失败为 `FAIL`；测试摘要已全过但 runner 退出阶段崩溃时记录为 runner error / `PARTIAL`。
  - 失败或 PARTIAL 时显示失败摘要、日志路径和下一步建议，不假装通过。
- 后台任务状态：
  - Verification Runner 复用 Phase 07 `BackgroundTaskState`。
  - 启动时写入 `background_task_update`，显示当前步骤、进度、日志入口和下一步建议。
  - 每个步骤更新 `currentStep` 和 progress。
  - 完成后写入 `pass` / `fail` / `partial` 结果。
- `/verify last`：
  - 展示当前 REPL 进程内最近一次验证报告。
  - 最近结果为 runner error / `PARTIAL` 时，展示日志路径、关键错误摘要和建议用 Node 22 LTS 复核。
- `/review`：
  - 以代码审查口径输出 Priority、Files、Risk、Suggestion。
  - 基于最近验证结果区分未验证、失败和已验证风险。
- Evidence / transcript：
  - 新增 `verification_start` transcript event。
  - 新增 `verification_end` transcript event。
  - Verification Runner 结果写入 `evidence_record`，kind 为 `test_result`。
  - Claim Checker 在看到验证 evidence 后不再对“已验证”等断言无证据乱判。
- 保留 Phase 05-07 行为：
  - Phase 05 核心工具、Bash 日志、Todo、Diff 保持可用。
  - Phase 06 权限、Plan、acceptEdits、dontAsk、bypass 硬拒绝边界保持可用。
  - Phase 07 i18n、短状态栏、后台任务摘要、Evidence Gate、Claim Checker、checkpoint/rewind、`/btw`、`/interrupt` 保持可用。

## 使用方式

构建后进入 REPL：

```bash
corepack pnpm build
corepack pnpm exec linghun
```

Phase 08 新增命令：

```text
/verify
/verify plan
/verify last
/verify smoke
/review
```

典型闭环：

```text
/verify plan
/verify
/verify last
/review
/claim-check 已验证
/background
```

失败修复闭环：

```text
/verify
# 查看 FAIL 摘要和 log 路径
# 修复问题
/verify
/verify last
```

## 涉及模块

- `packages/core/src/session.ts`：扩展 transcript 事件类型，增加 `verification_start` / `verification_end`。
- `packages/tui/src/index.ts`：Verification Runner、`/verify`、`/verify last`、`/review`、验证后台任务状态、验证 evidence。
- `packages/tui/src/index.test.ts`：Phase 08 验证命令、review、evidence、Claim Checker、后台摘要回归测试。
- `apps/cli/src/cli.ts`：帮助文案更新到 Phase 08。
- `apps/cli/src/main.test.ts`：CLI help 回归更新到 Phase 08。
- `docs/delivery/README.md`：Phase 08 标记为 done。
- `docs/delivery/phase-08-verification.md`：本交付文档。

## 关键设计

- 保持最小改动：Verification Runner 直接接入现有 TUI command router，避免新增包和大拆 TUI。
- 验证计划优先使用项目已有 scripts，不引入新依赖或自定义复杂任务系统。
- 验证命令通过 `spawn(..., { shell: true })` 在项目根执行，完整输出写入 `.linghun/logs/verification/`。
- Verification Runner 复用 Phase 07 `BackgroundTaskState`，避免验证原始输出污染主消息流或输入区。
- 验证结果作为 `test_result` evidence 写入 transcript，使 Phase 07 Claim Checker / Evidence Gate 能消费。
- `/review` 当前是本地结构化审查摘要，不调用模型、不实现 Phase 12 reviewer agent。
- `/verify last` 当前读取当前进程内最近一次验证结果；跨会话恢复最近验证结果属于后续会话交接增强范围，不在 Phase 08 扩大。

## 配置项

本阶段没有新增用户配置项。

新增本地日志目录：

```text
<project>/.linghun/logs/verification/
```

每个验证步骤写入独立日志：

```text
<runId>-<step>-<kind>.log
```

沿用已有配置：

- `language`：来自 `@linghun/config`，默认 `zh-CN`。
- `permission.defaultMode`：决定 REPL 启动默认权限模式。
- Bash 工具日志仍写入 `.linghun/logs/tools/`。

## 命令

CLI：

```bash
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
corepack pnpm exec linghun
```

REPL：

```text
/verify
/verify plan
/verify last
/verify smoke
/review
/background
/claim-check
/read /write /edit /multiedit /grep /glob /bash /todo /diff
/exit
```

项目验证命令探测优先级：

```text
package.json scripts: typecheck, test, lint, build, smoke
fallback: node --version
```

## 测试与验证

已执行：

```bash
corepack pnpm test -- --runInBand
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm check
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
printf '/verify smoke\n/verify last\n/review\n/exit\n' | corepack pnpm exec linghun
```

当前结果：

- `corepack pnpm test -- --runInBand`：10 个测试文件、48 个测试通过（早前阶段收尾验证）。
- `corepack pnpm test`：最终复跑通过；10 个测试文件、50 个测试通过，新增 runner/toolchain cleanup crash 与 masked child signal → `PARTIAL` 覆盖。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过。
- `corepack pnpm check`：首次因格式失败，按 Biome 建议调整后通过；最终复跑通过。
- `linghun --version`：输出 `0.1.0`。
- `Linghun --version`：输出 `0.1.0`。
- `linghun --help`：显示 Phase 08 帮助。
- 最小 REPL `/verify smoke`：PASS，`/verify last` 可读取最近结果，`/review` 输出结构化报告；日志示例：`.linghun/logs/verification/7ce6efc5-bdb9-43ae-9e52-a1ec66e382d9-1-smoke.log`。

新增/更新测试覆盖：

- `/verify plan` 能生成验证计划。
- `/verify` 能执行验证计划并写入 PASS。
- `/verify last` 能读取最近一次验证结果。
- 验证失败时状态为 FAIL，并输出日志路径与复跑建议。
- Vitest 全部测试通过后 runner/toolchain cleanup crash 会归类为 runner error / PARTIAL。
- 被 pnpm/shell 包装后暴露为输出摘要的 child signal 会归类为 runner error / PARTIAL。
- `/verify smoke` 可执行最小 smoke。
- `/review` 输出结构化审查结果，包含优先级、文件、风险和建议。
- 验证结果写入 transcript：`verification_start`、`verification_end`、`evidence_record(test_result)`。
- Claim Checker 在验证 evidence 前会降级“已验证”，验证 evidence 后通过。
- 后台任务摘要不会插入输入区 prompt。

最终验收命令、CLI smoke 和独立 verification agent 复检将在本阶段提交前继续执行并记录最终结果。

## 性能结果

- `--version` / `--help` 仍保持 CLI 快速路径，不启动 TUI、模型、MCP 或验证器。
- `/verify plan` 只读取项目根 `package.json`，不扫描全仓。
- `/verify` 默认只执行探测到的项目 scripts，不额外跑慢测或隐藏全量任务。
- 验证输出不直接灌入主消息流；完整日志落盘，REPL 仅显示摘要和日志路径。
- BackgroundTask summary 为内存表读取，不调用模型或外部服务。

## 已知问题

- `/verify last` 当前只保留当前 REPL 进程内最近结果；历史 transcript 中恢复最近报告属于 Phase 11 会话交接增强范围。
- `PARTIAL` 状态结构已保留；当前本地 scripts 全部执行成功时为 PASS，命令失败时为 FAIL。外部条件缺失导致 PARTIAL 的更细粒度判定后续可按具体 provider/MCP 场景增强。
- 本机 Node.js v24.14.0 下观察到一次兼容风险：Vitest 已显示 `10 files / 48 tests passed`，但进程退出阶段随后抛出 `TypeError: emitter.removeListener is not a function`，导致 `pnpm test` 生命周期失败。后续 Verification Runner 必须区分“被验证命令本身失败”和“runner/Node/工具链退出清理异常”；测试已全部通过但 runner 退出异常时应记录为 runner error / PARTIAL，并保留日志路径和建议使用 Node 22 LTS 复核。
- Verification Runner 当前是本地命令 runner，不是 Phase 12 Agent，也不做模型级独立代码复审。
- `/review` 是结构化本地审查摘要，不替代人工 review 或后续 reviewer agent。

## 不在本阶段处理

- 不实现 Phase 09 cache/cost/usage/stats。
- 不实现 Phase 10 MCP/index 完整闭环。
- 不实现 Phase 11 会话记忆/handoff 新能力。
- 不实现 Agent、多模型协作、Plugins、Hooks、长期任务、Remote Channels、桌面端。
- 不实现真实 verifier agent 生命周期或远程任务。
- 不扩大 TUI 重构，不引入新终端渲染器。

## 下一阶段衔接

Phase 09 可在本阶段基础上接入 cache/cost/usage/stats：

- 保持状态栏不显示金额，继续使用短字段。
- 成本与 usage 必须明确 estimated / provider-reported 口径。
- 不应改变 Phase 08 `test_result` evidence 和 Verification Runner 日志路径。
- 如果 Phase 09 增加统计命令，应避免污染 `/verify` 输出和后台任务摘要。

## 开发者排查入口

- Verification Runner：`packages/tui/src/index.ts` 中 `handleVerifyCommand()`、`createVerificationPlan()`、`runVerificationPlan()`。
- 验证命令执行：`runVerificationCommand()`。
- 验证 evidence：`recordVerificationEvidence()`。
- Review：`handleReviewCommand()`、`createReviewReport()`。
- 后台任务摘要：`formatBackgroundTask()`、`appendBackgroundTaskEvent()`。
- Claim Checker：`checkClaimSupport()`。
- transcript 类型：`packages/core/src/session.ts`。
- TUI tests：`packages/tui/src/index.test.ts`。
- 验证日志：`.linghun/logs/verification/`。

## 状态栏与统计口径

- 状态栏仍只显示 session、model、mode、bg、cache/index 占位。
- 状态栏不显示金额。
- 本阶段不实现真实 `/usage`、`/stats`、cache 命中率或费用估算。
- Verification Runner 通过 `/background` 和 `/verify last` 展示状态与结果，不把长输出放进状态栏。

## TUI 渲染稳定性

- 验证启动、步骤、完成均通过结构化事件和短文本摘要输出。
- 验证原始日志写入 `.linghun/logs/verification/`，不直接混入输入区。
- `/background` 显示一行摘要，包含状态、当前步骤、进度、日志和下一步建议。
- 测试覆盖后台任务摘要不会出现 `你> [后台]` 或 `you> [background]` 这类 prompt 污染。

## 后台/复查任务状态反馈

- Verification Runner 启动时创建 `kind: "verification"` 的 `BackgroundTaskState`。
- 每个步骤更新 `currentStep`，例如 `smoke 1/1`、`typecheck 1/4`。
- 完成后设置：
  - `status: completed` + `result: pass`；或
  - `status: completed` + `result: partial`（例如 runner/toolchain 退出清理异常但测试摘要已全过）；或
  - `status: failed` + `result: fail`。
- `logPath` 指向 `.linghun/logs/verification/` 或具体步骤日志。
- 用户问“是不是卡住了 / 当前在干什么 / 还要多久”时，应读取 `/background` 对应状态表回答，不靠猜。

## 语言与 i18n 口径

- 默认中文输出；`/language en-US` 仍可切换既有 Phase 07 文案。
- Slash 命令、transcript event 字段和配置键保持英文。
- Phase 08 新增核心状态词 `PASS` / `FAIL` / `PARTIAL` 使用英文大写，便于日志搜索和跨语言一致。
- 状态栏不新增长中文字段，避免撑爆终端宽度。

## 参考核对

本阶段实际读取的 Linghun 文档：

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` Phase 08
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md` Verification Runner / Review / Evidence / BackgroundTask 相关规格
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md` Phase 08 / 验证相关设计
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-05-core-tools.md`
- `F:\Linghun\docs\delivery\phase-06-permissions-plan.md`
- `F:\Linghun\docs\delivery\phase-07-behavior-guardrail.md`

本阶段实际参考：

- 蓝图中 CCB verification agent 思路仅作为行为参考：验证必须有独立状态、日志、PASS/FAIL/PARTIAL、失败复跑建议。
- 当前 Codex/工程开发流程仅作为行为参考：改动后运行最小必要 test/typecheck/build/check。
- 未复制 CCB / OpenCode / Hermes 的可疑源码实现、反编译痕迹、内部 API、专有遥测或内部服务逻辑。

## 成品级结构化 handoff packet

```yaml
current_phase: Phase 08 code self-check and verification loop
phase_status: completed
next_phase: Phase 09 cache/cost/usage/stats
phase_09_status: pending
must_stop_after_phase_08: true
completed:
  - Verification Runner command detection for package.json scripts
  - /verify, /verify plan, /verify last, /verify smoke
  - /review structured review output
  - verification_start and verification_end transcript events
  - test_result evidence from verification report
  - BackgroundTaskState reuse for verification status
  - Phase 08 focused tests
  - Runner/toolchain cleanup crash classification as runner error / PARTIAL with log path and Node 22 LTS recommendation
forbidden_next_without_user_confirmation:
  - Phase 09 cache/cost/usage/stats
  - Phase 10 MCP/index complete loop
  - Phase 11 memory/handoff new capability
  - Agent, multi-model collaboration, Plugins, Hooks, long-running jobs, Remote Channels, desktop
key_files:
  - packages/core/src/session.ts
  - packages/tui/src/index.ts
  - packages/tui/src/index.test.ts
  - apps/cli/src/cli.ts
  - apps/cli/src/main.test.ts
  - docs/delivery/README.md
  - docs/delivery/phase-08-verification.md
validation_current:
  - command: corepack pnpm test -- --runInBand
    result: pass_earlier_phase08_run_10_files_48_tests
  - command: corepack pnpm test
    result: pass_10_files_50_tests
  - command: corepack pnpm typecheck
    result: pass
  - command: corepack pnpm build
    result: pass
  - command: corepack pnpm check
    result: pass_after_format_fix
  - command: corepack pnpm exec linghun --version
    result: pass_0.1.0
  - command: corepack pnpm exec Linghun --version
    result: pass_0.1.0
  - command: corepack pnpm exec linghun --help
    result: pass_phase08_help
  - command: "printf '/verify smoke\\n/verify last\\n/review\\n/exit\\n' | corepack pnpm exec linghun"
    result: pass_verify_smoke_log_.linghun/logs/verification/7ce6efc5-bdb9-43ae-9e52-a1ec66e382d9-1-smoke.log
validation_pending_before_final:
  - independent verification agent PASS/FAIL/PARTIAL
index_status:
  project: F-Linghun
  status: ready
  nodes: 452
  edges: 666
  detect_changes_after_implementation: 5 changed files before delivery doc/readme update
permission_mode: default Claude Code session; no repository permission config changed
model_provider: claude-sonnet-4-6 via Claude Code; Linghun runtime provider unchanged (DeepSeek config path)
budget_usage: no Phase 09 budget/cost feature implemented; no status-bar money display
risks:
  - /verify last is process-local until Phase 11 restores reports from transcript
  - PARTIAL is represented but only used when unverified entries are populated by future external-condition checks
```
