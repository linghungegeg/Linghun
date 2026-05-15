# Phase 05：核心工具闭环

## 阶段目标

完成 Linghun Phase 05 核心工具闭环，让 REPL 能通过明确 slash 命令触发 Read / Write / Edit / MultiEdit / Grep / Glob / Bash / Todo / Diff，并把工具事件写入 Phase 02 JSONL transcript。

本阶段只实现核心工具底座和最小交互路径，不进入 Phase 06 权限与 Plan，不实现 Agent、MCP、真实 cache/cost/usage/stats、长期任务、Plugins、Hooks、Remote Channels 或桌面端。

## 本阶段范围

- 建立 `@linghun/tools` 内置工具注册表。
- 为核心工具提供统一输入、统一 `ToolOutput`、风险声明和权限元数据。
- 在 REPL 中提供可执行工具路径。
- 将工具调用开始、结束、Todo 更新、Diff 更新写入 JSONL transcript。
- 保留 Phase 04 已有 `/help`、`/model`、`/sessions`、`/sessions resume <id>`、`/exit`。
- 更新阶段交付记录。

## 已完成功能

- 已实现核心工具：
  - `Read`
  - `Write`
  - `Edit`
  - `MultiEdit`
  - `Grep`
  - `Glob`
  - `Bash`
  - `Todo`
  - `Diff`
- 工具统一返回：
  - `text`
  - `data`
  - `truncated`
  - `fullOutputPath`
  - `changedFiles`
- 工具定义包含：
  - `name`
  - `title`
  - `description`
  - `permission.risk`
  - `permission.scope`
  - `permission.reason`
  - `permission.phase06Mode = metadata-only`
  - `isReadOnly`
  - `isConcurrencySafe`
  - `isLongRunning`
- `Write` / `Edit` / `MultiEdit` 只允许操作工作区内路径，越界路径会被拒绝。
- `Edit` / `MultiEdit` 会检查 `oldText` 唯一性，避免误改。
- `Bash` 会截断 REPL 展示，并把完整输出保存到 `.linghun/logs/tools/bash-*.log`。
- `Todo` 支持展示当前任务、进行中、完成项和阻塞项。
- `Diff` 能基于本轮工具写入记录输出文件列表和摘要。
- REPL 工具命令会写入 transcript：
  - `tool_call_start`
  - `tool_call_end`
  - `todo_update`
  - `diff_update`

## 使用方式

构建后进入 REPL：

```bash
corepack pnpm build
corepack pnpm exec linghun
```

REPL 内工具命令：

```text
/read <path>
/write <path> <text>
/edit <path> <old> => <new>
/multiedit <path> <old> => <new>
/grep <pattern> [path]
/glob <pattern> [path]
/bash <command>
/todo
/todo add <text>
/todo start <id>
/todo done <id>
/todo block <id>
/diff
```

示例：

```text
/write .linghun/tmp-phase05-smoke.txt hello
/read .linghun/tmp-phase05-smoke.txt
/grep hello .linghun
/glob *.txt .linghun
/edit .linghun/tmp-phase05-smoke.txt hello => hello-phase05
/bash node --version
/todo add 验证 Phase 05 工具闭环
/todo start 1
/todo done 1
/diff
/exit
```

Windows 兼容入口仍可验证：

```bash
corepack pnpm exec Linghun --version
```

## 涉及模块

- `packages/tools/src/index.ts`：Phase 05 工具定义、执行、上下文、Todo、Diff、Bash 日志。
- `packages/tools/src/index.test.ts`：核心工具闭环测试。
- `packages/core/src/session.ts`：扩展 transcript 事件类型。
- `packages/tui/src/index.ts`：REPL 工具 slash 命令、工具事件写入 transcript。
- `packages/tui/src/index.test.ts`：TUI 命令回归。
- `packages/tui/package.json`：新增 `@linghun/tools` workspace 依赖。
- `packages/tui/tsconfig.json`：新增 tools project reference。
- `apps/cli/src/cli.ts`：帮助文案更新为 Phase 05。
- `apps/cli/src/main.test.ts`：CLI help 回归更新。
- `docs/delivery/README.md`：Phase 05 标记为 done。

## 关键设计

- Phase 05 只实现工具元数据和本地执行，不接入完整权限审批；所有工具保留风险声明，供 Phase 06 权限管道消费。
- 写入工具通过 `resolveWorkspacePath()` 限制在 `workspaceRoot` 内，避免越界写入。
- 编辑工具使用字符串唯一性检查：未找到或出现多次都会失败，并给中文建议。
- `Bash` 默认在工作区执行，输出预览截断，完整日志写入工作区 `.linghun/logs/tools/`。
- `ToolContext.changedFiles` 记录本轮写入文件，供 `Diff`、后续 checkpoint 和 verification 使用。
- `ToolContext.todos` 只保存当前 REPL 会话内任务状态，不写入长期记忆。
- transcript 继续使用 Phase 02 JSONL，不引入数据库或新存储层。

## 配置项

本阶段没有新增用户配置项。

沿用已有配置：

- 会话数据仍通过 `getSessionRootDir()` 写入用户级 session 目录。
- Bash 完整日志当前默认写入项目工作区 `.linghun/logs/tools/`。

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
/read /write /edit /multiedit /grep /glob /bash /todo /diff
```

## 测试与验证

已执行的 focused 验证：

```bash
corepack pnpm install
corepack pnpm --filter @linghun/tools build
corepack pnpm --filter @linghun/tools typecheck
corepack pnpm --filter @linghun/tui typecheck
corepack pnpm --filter @linghun/cli typecheck
corepack pnpm test -- packages/tools/src/index.test.ts packages/tui/src/index.test.ts apps/cli/src/main.test.ts
```

结果：

- tools build：通过。
- tools typecheck：通过。
- tui typecheck：通过。
- cli typecheck：通过。
- focused tests：10 个测试文件、33 个测试通过。

已执行的全量验证：

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm check
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
```

结果：

- `corepack pnpm test`：10 个测试文件、33 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过。
- `corepack pnpm check`：通过。
- `linghun --version`：输出 `0.1.0`。
- `Linghun --version`：输出 `0.1.0`。
- `linghun --help`：显示 Phase 05 帮助。

已执行 REPL 工具闭环 smoke：

```bash
tmpdir=$(mktemp -d) && cd "$tmpdir" && printf '/write .linghun/phase05-smoke.txt hello\n/read .linghun/phase05-smoke.txt\n/grep hello .linghun\n/glob *.txt .linghun\n/edit .linghun/phase05-smoke.txt hello => hello-phase05\n/bash node --version\n/todo add 验证 Phase 05 工具闭环\n/todo start 1\n/todo done 1\n/diff\n/exit\n' | "F:/Linghun/node_modules/.bin/linghun"
```

结果：通过。REPL 输出显示 Write / Read / Grep / Glob / Edit / Bash / Todo / Diff 均可触发，Bash 输出包含 `exitCode=0`，Diff 显示 `.linghun/phase05-smoke.txt`。

Transcript 抽查：通过。对应 JSONL 事件包含 `session_start`、多组 `tool_call_start` / `tool_call_end`、`todo_update`、`diff_update`、`session_end`。

## 性能结果

- `/read` 默认最多展示 200 行。
- `/grep` / `/glob` 默认最多返回 100 条，避免大仓库输出过量。
- `/bash` 默认超时 120 秒，预览最多约 4000 字符，完整输出落盘。
- `--version` / `--help` 仍保持 CLI 快速路径，不启动 TUI 或模型。
- 工具系统没有引入 MCP、Agent 或长期后台任务。

## 已知问题

- `Grep` / `Glob` 当前是 Phase 05 自研最小实现，满足本阶段闭环；后续如需更高性能，可按蓝图接入成熟 ripgrep/picomatch，但不在本阶段扩大依赖。
- `Todo` 当前是 REPL 内存态并写入 transcript；恢复后自动重建 Todo 状态属于后续会话交接增强范围。
- `Diff` 当前基于本轮工具 `changedFiles` 汇总，不计算真实 git hunk 行数；后续 checkpoint / verification 阶段可增强。
- Phase 05 暂不做完整权限审批，`Bash` 和写入工具已标明风险元数据，Phase 06 接入权限管道。

## 不在本阶段处理

- 不实现 Plan 模式。
- 不实现 acceptEdits / bypass / dontAsk 的完整权限逻辑。
- 不实现多 agent。
- 不实现 MCP。
- 不实现真实 cache/cost/usage/stats。
- 不实现插件系统、Hooks、Skills、Workflow。
- 不实现长期任务、Remote Channels、桌面端。
- 不实现 checkpoint / rewind 或 verifier agent。

## 下一阶段衔接

Phase 06 应在当前工具定义和风险元数据基础上接入权限与 Plan：

- `default` / `plan` / `acceptEdits` / `dontAsk` / `auto` / `bypass` 权限模式。
- 写入工具和 Bash 进入权限管道。
- Plan 模式强制只读。
- 默认模式下可在写入前展示 diff 摘要。
- 最近拒绝记录和权限规则持久化。

## 开发者排查入口

- 工具注册与执行：`packages/tools/src/index.ts`
- 工具测试：`packages/tools/src/index.test.ts`
- transcript 类型：`packages/core/src/session.ts`
- REPL 工具命令：`packages/tui/src/index.ts`
- REPL 测试：`packages/tui/src/index.test.ts`
- CLI 帮助：`apps/cli/src/cli.ts`
- Session 读写：`packages/core/src/session-store.ts`

## 状态栏与统计口径

- 默认状态栏继续只显示 session、model、mode、cache、index 等稳定信息。
- 本阶段不在状态栏显示金额。
- 本阶段不实现 `/usage`、`/stats`、真实 cache 命中率或费用估算。
- 费用、成本、省钱估算仍后置到 Phase 09，并且必须标记 `estimated`，除非 provider 明确返回真实账单字段。

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

本阶段行为参考：

- 蓝图中 CCB Tool 接口、工具执行、核心工具清单的行为要求。
- CCB / Claude Code 风格的 Read/Edit/Bash/Todo/Diff 使用体验。
- OpenCode 的开放工具模型方向仅作为行为层参考。
- Hermes 的 Todo / Workflow 沉淀方向仅作为后续边界参考，本阶段未实现 Skills/Workflow。

进入 Linghun 自研实现的内容：

- `@linghun/tools` 的 TypeScript 工具定义、执行函数、REPL slash 命令解析、transcript 事件写入。
- 工作区路径检查、唯一性检查、Bash 截断和日志保存、Todo/Diff 当前会话状态。

未进入实现的参考内容：

- 未复制 CCB、OpenCode、Hermes 的可疑源码、内部 API、反编译痕迹、专有遥测或内部服务逻辑。
- 未引入 MCP、Agent、Plan、权限审批或 workflow 代码。

## 索引/记忆使用情况

项目记忆：

- 已读取 `project_phase_status.md`。
- 已读取 `project_engineering_baseline.md`。
- 已读取 `feedback_git_identity.md`。

说明：`project_phase_status.md` 仍停留在 Phase 03；本阶段以当前仓库文档、Phase 04 交付文档和用户最新说明为准，确认 Phase 00-04 已完成、当前任务为 Phase 05。

codebase-memory：

- 已查询 `mcp__codebase-memory-mcp__index_status`。
- 项目 `F-Linghun` 索引可用，状态 `ready`，查询时为 399 nodes / 514 edges。
- 已使用 `get_architecture` 和 `search_code`/`query_graph` 尝试缩小范围；索引对当前未索引新增改动返回有限，因此后续按规则 fallback 到必要文件读取。

## Handoff packet

```text
phase: Phase 05 core tools
status: done
completed:
  - @linghun/tools 核心工具注册与执行
  - REPL 工具 slash 命令
  - tool_call_start/tool_call_end/todo_update/diff_update transcript 事件
  - Write/Edit/MultiEdit 工作区路径保护
  - Edit/MultiEdit 唯一性检查
  - Bash 截断展示与完整日志路径
  - Todo 当前会话任务状态
  - Diff 本轮 changedFiles 摘要
pending:
  - Phase 06 权限与 Plan 接入
  - Plan 只读强制、acceptEdits、bypass、最近拒绝记录
  - checkpoint / rewind
  - Verification Runner / verifier agent
  - usage/stats/cache 成本统计
key_files:
  - packages/tools/src/index.ts
  - packages/tools/src/index.test.ts
  - packages/core/src/session.ts
  - packages/tui/src/index.ts
  - packages/tui/src/index.test.ts
  - docs/delivery/phase-05-core-tools.md
risks:
  - Grep/Glob 是最小实现，性能不等同 ripgrep/picomatch
  - Todo 恢复重建未做
  - Diff 不计算真实 hunk 行数
next_phase:
  - Phase 06：权限与 Plan 闭环
```

自动工作到 Phase 05 完成后停止；是否进入 Phase 06 必须等待用户确认。
