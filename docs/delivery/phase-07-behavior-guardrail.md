# Phase 07：工程行为控制闭环

## 阶段目标

完成 Linghun Phase 07 工程行为控制闭环，在 Phase 06 权限与 Plan 基础上补齐基础 i18n、结构化渲染摘要、后台任务状态、Evidence Gate、Claim Checker、最小改动 checkpoint/rewind、输入中断与 `/btw` 临时插问。

本阶段只实现 Phase 07 工程行为控制，不进入 Phase 08 Verification Runner / verifier agent，不实现 Agent、MCP、真实 cache/cost/usage/stats、长期任务、Plugins、Hooks、Remote Channels 或桌面端。

## 已完成功能

- 基础 i18n：
  - REPL context 保存 `language`。
  - `/language zh-CN|en-US` 可切换用户可见输出语言。
  - Phase 07 新增用户可见文案通过本地 i18n 字典和 `t()` helper 输出。
  - Slash 命令、配置键和 transcript event 字段保持英文。
- TUI 渲染稳定性底座：
  - 状态栏输出统一走 `writeStatus()`，只展示短字段：session、model、mode、background count、cache/index 占位。
  - 状态栏字段使用 `truncateDisplay()` 截断，避免长模型名、长 session id 或中文全角文本撑爆。
  - 后台任务输出折叠为一行摘要，详情通过 `/background` 查看。
  - system event、background task、checkpoint、interrupt、btw、claim check 均写入结构化 transcript 事件。
- 后台/长任务状态反馈底座：
  - Bash 作为 Phase 07 长任务代表进入 `BackgroundTaskState`。
  - 长任务启动后立即输出摘要，包含当前步骤、进度、日志/输出状态和下一步建议。
  - `/background` 显示后台任务状态表。
  - 输出文件尚未产生有效内容时显示“尚未产生有效输出 / no valid output yet”。
  - Bash 完成后更新 `pass`、日志路径、最近输出时间和下一步建议。
- Evidence Gate / Tool-before-answer：
  - 普通消息涉及代码事实、函数、调用链、修复、验证等关键词时，如当前会话没有工具证据，会阻止直接回答并提示先 `/read`、`/grep`、索引查询或命令输出。
  - Read/Grep/Glob/Bash 结果会生成 `evidence_record` transcript 事件，供后续结论引用。
- Claim Checker：
  - `/claim-check <claim>` 检查“已修复 / 已验证 / 测试通过 / 代码里 / 调用链是 / fixed / verified”等高风险断言。
  - 缺少证据时输出“未验证 / 待确认”降级建议，并写入 `claim_check` transcript 事件。
- 最小改动协议：
  - 写入类工具执行前仍保留 Phase 06 权限/风险摘要。
  - Phase 07 在写入类工具执行前创建 checkpoint，避免未授权扩大改动。
- Checkpoint / rewind：
  - 写入类工具执行前创建 snapshot checkpoint。
  - `/rewind` 列出当前会话 checkpoint。
  - `/rewind restore <id>` 恢复 checkpoint，并写入 `checkpoint_restored` transcript 事件。
  - 新文件 checkpoint 会记录 `existed=false`，restore 时删除该文件，避免误判为已恢复但遗留文件。
- 输入队列、中断、临时插问：
  - 非 TTY 管道输入继续按完整输入缓冲读取，避免 chunk 级误拆。
  - `/interrupt` 明确记录当前长任务为 idle 或 cancelled，并写入 `interrupt` transcript 事件。
  - `/btw <question>` 只回答临时问题，不修改 Todo、Plan 或 checkpoint，并写入 `btw_question` transcript 事件。

## 使用方式

构建后进入 REPL：

```bash
corepack pnpm build
corepack pnpm exec linghun
```

Phase 07 新增/增强命令：

```text
/language zh-CN
/language en-US
/background
/rewind
/rewind restore <checkpointId>
/btw <临时小问题>
/interrupt
/claim-check <claim>
```

典型闭环：

```text
/language zh-CN
/read src/example.ts
/claim-check 已修复并已验证
/write .linghun/phase07-demo.txt hello
/rewind
/rewind restore <checkpointId>
/bash node --version
/background
/btw 现在是什么阶段？
/interrupt
```

## 涉及模块

- `packages/core/src/session.ts`：扩展 Phase 07 transcript event 类型。
- `packages/tui/src/index.ts`：i18n、状态栏截断、Evidence Gate、Claim Checker、checkpoint/rewind、background task、interrupt、btw。
- `packages/tui/src/index.test.ts`：Phase 07 focused tests。
- `apps/cli/src/cli.ts`：帮助文案更新到 Phase 07。
- `docs/delivery/README.md`：Phase 07 标记为 done。
- `docs/delivery/phase-07-behavior-guardrail.md`：本交付文档。

## 关键设计

- 保持 Phase 07 最小改动：未新建独立包或大重构，行为控制集中接入现有 REPL/TUI 路径。
- i18n 使用本地字典和 `t()` helper；本阶段不引入外部 i18n 依赖。
- BackgroundTask 先覆盖 Phase 07 可实际触发的长任务代表 Bash；verification/agent/job 仍不实现，只保留 transcript 类型兼容后续阶段。
- checkpoint 使用内存 snapshot，不自动 commit，不写入 Git 历史。
- rewind 只恢复 checkpoint 记录的受影响文件，不删除或覆盖未纳入 checkpoint 的用户改动。
- Evidence Gate 不伪装成完整模型安全系统；本阶段提供可执行的最小闭环，后续 Phase 08/10/11 可接 verifier、索引和会话记忆增强证据来源。

## 配置项

本阶段没有新增持久化用户配置项。

沿用：

- `language`：来自 `@linghun/config`，默认 `zh-CN`。
- `permission.defaultMode`：决定 REPL 启动权限模式。
- Bash 完整日志仍写入 `.linghun/logs/tools/`。

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
/help
/language zh-CN|en-US
/model
/sessions
/mode
/plan
/permissions
/background
/rewind
/btw
/interrupt
/claim-check
/read /write /edit /multiedit /grep /glob /bash /todo /diff
/exit
```

## 测试与验证

Focused 验证已覆盖：

```bash
corepack pnpm typecheck
corepack pnpm test -- packages/tui/src/index.test.ts
```

结果：

- `corepack pnpm typecheck`：通过。
- focused TUI tests：10 个测试文件、44 个测试通过。

Focused tests 覆盖 Phase 07 真实闭环：

- zh-CN / en-US 输出各至少一条。
- 状态栏英文路径与短字段输出。
- checkpoint 创建与 `/rewind restore` 恢复。
- Bash 后台任务状态、日志路径和完成状态。
- Claim Checker 缺证据时降级“未验证 / 待确认”。
- `/btw` 不污染 Todo、Plan、checkpoint。
- `/interrupt` 在无长任务时明确 idle 状态。

最终全量验证命令已执行并记录：

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm check
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
printf '/exit\n' | corepack pnpm exec linghun
```

## 性能结果

- `--version` / `--help` 仍保持 CLI 快速路径，不启动 TUI、模型、MCP 或后台任务。
- 状态栏只做本地字符串截断，不调用模型或外部服务。
- checkpoint 只读取受影响文件内容；不扫描全仓，不自动 commit。
- `/background` 只读取当前内存任务表。
- Evidence Gate / Claim Checker 是本地字符串规则，不增加 token 成本。

## 已知问题

- 当前 REPL 仍是最小 readline 实现，不是完整 Ink UI；Phase 07 只建立结构化渲染和状态模型底座。
- BackgroundTask 当前实际只覆盖 Bash；verification、agent、job、compact、MCP 的真实运行属于后续阶段。
- Evidence Gate 和 Claim Checker 是规则化底座，不替代 Phase 08 verifier 或完整代码审查。
- checkpoint 当前是当前进程内内存 snapshot；跨进程或重启后的 checkpoint 持久化后续可增强。
- `/interrupt` 对已启动的 Bash 当前记录状态，底层 Bash 已按 Phase 05 同步执行模型运行；真正 AbortSignal 流式取消和子进程实时取消后续可增强。

## 不在本阶段处理

- 不实现 Phase 08 Verification Runner / verifier agent。
- 不实现 Agent。
- 不实现 MCP。
- 不实现真实 cache/cost/usage/stats。
- 不实现插件系统。
- 不实现长期任务。
- 不实现 Hooks、Remote Channels 或桌面端。
- 不实现完整 Ink UI 或真实终端快捷键捕获。

## 下一阶段衔接

Phase 08 可以在本阶段基础上接入 Verification Runner：

- 复用 `BackgroundTaskState` 表达验证步骤、进度、heartbeat、日志路径和 PASS/FAIL/PARTIAL。
- 复用 `evidence_record` 和 `claim_check`，将验证结果作为 `test_result` 证据。
- 复用 system event / background task transcript 事件，避免 verifier 输出混入主消息流。

## 开发者排查入口

- REPL 行为控制：`packages/tui/src/index.ts`
- transcript 类型：`packages/core/src/session.ts`
- TUI tests：`packages/tui/src/index.test.ts`
- Bash 日志：`.linghun/logs/tools/`
- checkpoint/rewind：`packages/tui/src/index.ts` 中 `maybeCreateCheckpoint()`、`handleRewindCommand()`
- Evidence Gate：`checkEvidenceGate()`、`recordToolEvidence()`
- Claim Checker：`handleClaimCheckCommand()`、`checkClaimSupport()`
- Background status：`createBackgroundTask()`、`formatBackgroundTask()`、`/background`

## 状态栏与统计口径

- 状态栏显示短字段：session、model、mode、bg、cache/index 占位。
- 状态栏字段会被 `truncateDisplay()` 截断，兼容中文/全角字符宽度。
- 本阶段不在状态栏显示金额。
- 本阶段不实现真实 `/usage`、`/stats`、cache 命中率或费用估算。
- 后续费用、成本、省钱估算仍必须进入 Phase 09，并标记 `estimated`，除非 provider 返回真实账单字段。

## TUI 渲染稳定性

- 主消息、system event、background task、checkpoint、btw、interrupt 和状态栏均由 REPL 统一输出，不允许工具直接写 UI 裸 stdout。
- Bash 原始长输出仍由工具截断展示并保存完整日志路径。
- 后台任务默认折叠为一行摘要，详情通过 `/background` 查看。
- 输入区保持单一 readline prompt；system event 不插入 prompt 内部。
- 长状态栏字段和中文全角文本通过 `truncateDisplay()` 截断。

## 后台/复查任务状态反馈

- Bash 启动时立即创建 `background_task_update`，状态为 `running`。
- Bash 完成后更新 `completed`、`pass`、`logPath`、`lastOutputAt`、`nextAction`。
- 无有效输出时显示“尚未产生有效输出”。
- `/background` 读取任务状态表回答，不靠猜。
- Phase 08 verifier 可直接复用该状态模型，但本阶段不实现 verifier。

## 语言与 i18n 口径

- `zh-CN`：新增用户可见文案默认中文。
- `en-US`：新增用户可见文案默认英文。
- `/language zh-CN|en-US` 可在当前 REPL 中切换。
- Slash 命令、配置键和 transcript 事件字段保持英文。
- 模型 system prompt 默认跟随 `language`，用户当前请求明确指定语言时以后续模型行为为准。

## 参考来源与 clean-room 边界

本阶段实际读取的 Linghun 文档：

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\README.md`
- `F:\Linghun\START_NEXT_CHAT.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-00-design-freeze.md`
- `F:\Linghun\docs\delivery\phase-01-project-skeleton.md`
- `F:\Linghun\docs\delivery\phase-02-session-transcript.md`
- `F:\Linghun\docs\delivery\phase-03-model-gateway.md`
- `F:\Linghun\docs\delivery\phase-04-tui-mvp.md`
- `F:\Linghun\docs\delivery\phase-05-core-tools.md`
- `F:\Linghun\docs\delivery\phase-06-permissions-plan.md`

本阶段行为参考：

- CCB / Claude Code 的工程行为、checkpoint/rewind、状态栏、后台任务反馈、输入中断体验。
- 已观察到的 CCB 逆向版问题：重复渲染、输入区错位、后台输出混排、复查任务不主动反馈。
- OpenCode 的权限快捷键和配置化思路。
- Hermes 的记忆/技能沉淀方向仅作为后续边界参考，本阶段不实现 Skills/Workflow。

进入 Linghun 自研实现的内容：

- TypeScript 本地 i18n helper、状态栏截断、background task 状态、Evidence Gate、Claim Checker、checkpoint/rewind、interrupt、btw 命令和 transcript 事件。

未进入实现的参考内容：

- 未复制 CCB、OpenCode、Hermes 的可疑源码、内部 API、反编译痕迹、专有遥测或内部服务逻辑。
- 未引入 MCP、Agent、Verifier、Hooks、Remote Channels、Plugins 或桌面端代码。

## 索引/记忆使用情况

项目记忆：

- 已读取 `project_phase_status.md`，确认 Phase 00-06 已完成、当前任务为 Phase 07。
- 已读取 `project_engineering_baseline.md`，确认 pnpm monorepo 与 `linghun` / `Linghun` 双入口。
- 已读取 `feedback_git_identity.md`，仅作为未来提交时的身份偏好；本阶段未创建 git commit。

codebase-memory：

- 已查询 `mcp__codebase-memory-mcp__index_status`。
- 项目 `F-Linghun` 索引可用，状态 `ready`，查询时为 426 nodes / 580 edges。
- 已使用 `get_architecture` 和 `detect_changes`。
- `search_code` 对当前关键符号未命中，因此按项目规则 fallback 到必要文件读取。

外部/本地项目参考：

- 本阶段主要按 Linghun 蓝图和规格书实现行为级自研；未读取或复制外部源码实现。

## Handoff packet

```text
phase: Phase 07 behavior guardrail
status: done after final validation passes
completed:
  - 基础 i18n helper 与 /language zh-CN|en-US
  - 状态栏短字段与截断
  - BackgroundTaskState 与 /background
  - Bash 长任务启动/完成状态摘要与日志路径
  - Evidence Gate 阻止缺证据代码事实回答
  - Read/Grep/Glob/Bash evidence_record
  - Claim Checker 降级缺证据最终结论
  - 写入前 checkpoint
  - /rewind 列出并恢复 checkpoint
  - /btw 临时插问不污染 Todo/Plan/checkpoint
  - /interrupt 明确 idle/cancelled 状态
entry_points:
  - packages/tui/src/index.ts
  - packages/core/src/session.ts
  - packages/tui/src/index.test.ts
commands:
  - /language
  - /background
  - /rewind
  - /btw
  - /interrupt
  - /claim-check
validation:
  - corepack pnpm test
  - corepack pnpm typecheck
  - corepack pnpm build
  - corepack pnpm check
  - CLI smoke
next_phase:
  - Phase 08：代码自检与验证增强闭环
must_not_do_in_phase_07:
  - verifier runner / verifier agent
  - Agent / MCP / cache-cost stats / plugins / hooks / remote / desktop
```

自动工作到 Phase 07 完成后停止；是否进入 Phase 08 必须等待用户确认。
