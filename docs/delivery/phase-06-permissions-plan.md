# Phase 06：权限与 Plan 闭环

## 阶段目标

完成 Linghun Phase 06 权限与 Plan 闭环，在 Phase 05 核心工具基础上接入权限模式、工具权限决策、Plan 只读约束、权限规则持久化、REPL slash 命令、写入前风险摘要，以及权限/Plan 事件写入 JSONL transcript。

本阶段只处理权限与 Plan，不进入 Phase 07 行为控制，不实现 Agent、MCP、缓存成本统计、长期任务、Plugins、Hooks、Remote Channels 或桌面端。

## 已完成功能

- 权限模式：
  - `default`
  - `plan`
  - `acceptEdits`
  - `dontAsk`
  - `auto`
  - `bypass`
- 工具权限决策管道：
  - 消费 Phase 05 工具 `permission.risk`。
  - 消费工具 `isReadOnly`。
  - 检查工作区路径越界。
  - 检查 `.git`、`.ssh`、`.env`、疑似 secret 路径等硬拒绝路径。
  - 检查 Bash 高风险命令，例如 `rm -rf`、远程脚本管道执行、系统级命令。
- Plan 模式：
  - `/mode plan` 切换只读规划模式。
  - `/plan` 输出结构化 `PlanProposal`，包含多个可选方案、步骤和风险。
  - `/plan accept <id>` 记录 `PlanDecision` 并回到 `default` 执行模式。
  - Plan 模式允许 `Read` / `Grep` / `Glob` / `Diff` / `Todo`。
  - Plan 模式拒绝 `Write` / `Edit` / `MultiEdit` / `Bash`。
  - Plan 模式不能直接切到 `bypass` 绕过计划确认。
- `acceptEdits`：
  - 自动允许工作区内低风险编辑类工具。
  - 不自动允许中风险 `Write`。
  - 不自动允许 `Bash`。
  - 不自动允许越界路径或硬拒绝路径。
- `bypass`：
  - 只能通过 `/mode bypass` 显式开启。
  - 仍不能绕过硬拒绝、安全路径和高风险命令保护。
- `dontAsk`：
  - 允许只读或会话内工具。
  - 对需要审批的写入/Bash 操作自动拒绝，不会自动允许。
- `auto`：
  - 对只读或会话内工具自动允许。
  - 分类器未实现时，对需审批操作回退为拒绝，避免默认放行。
- 权限规则持久化：
  - 支持 `allow` / `ask` / `deny` 规则。
  - 支持查看规则。
  - 支持删除规则。
  - 支持查看最近拒绝。
  - 支持按 id 删除最近拒绝。
  - 支持清空最近拒绝。
- REPL 交互命令：
  - `/permissions`
  - `/permissions add allow|ask|deny <tool|*> [risk]`
  - `/permissions remove <id>`
  - `/permissions recent`
  - `/permissions recent delete <id>`
  - `/permissions recent clear`
  - `/mode`
  - `/mode plan`
  - `/mode acceptEdits`
  - `/mode dontAsk`
  - `/mode auto`
  - `/mode bypass`
  - `/mode default`
  - `/plan`
  - `/plan accept [id]`
  - `/tab` 作为 Shift+Tab 的等价命令，循环切换 `default` / `plan` / `acceptEdits` / `auto`。
- diff-before-write：
  - 写入类工具执行前输出轻量摘要。
  - 摘要包含将执行的工具、影响文件、风险等级和原因。
  - 本阶段不生成完整 git hunk。
- transcript：
  - 写入 `permission_request`。
  - 写入 `permission_result`。
  - 写入 `plan_proposal`。
  - 写入 `plan_decision`。
  - 继续保留 `tool_call_start` / `tool_call_end` / `todo_update` / `diff_update`。
- 中文 UX：
  - 权限拒绝说明包含为什么拒绝、本次请求摘要和下一步建议。
  - Plan 模式提示说明只读边界。
  - 错误提示保留可操作建议。

## 使用方式

构建后进入 REPL：

```bash
corepack pnpm build
corepack pnpm exec linghun
```

常用权限命令：

```text
/mode
/mode plan
/mode acceptEdits
/mode dontAsk
/mode auto
/mode bypass
/mode default
/tab
```

Plan 闭环：

```text
/plan
/plan accept a
```

权限规则：

```text
/permissions
/permissions add deny Bash high
/permissions remove <id>
/permissions recent
/permissions recent delete <id>
/permissions recent clear
```

权限 smoke 示例：

```text
/mode plan
/read sample.txt
/write sample.txt new-content
/permissions recent
/plan
/plan accept a
/write sample.txt new-content
/mode acceptEdits
/edit sample.txt new-content => next-content
/bash node --version
/mode dontAsk
/write sample.txt denied
/mode bypass
/write ../escape.txt denied
```

Windows 兼容入口仍可验证：

```bash
corepack pnpm exec Linghun --version
```

## 涉及模块

- `packages/core/src/session.ts`：扩展 transcript 事件类型，增加权限和 Plan 事件。
- `packages/tools/src/index.ts`：调整 `Edit` 风险元数据为低风险工作区编辑，供 `acceptEdits` 自动允许。
- `packages/tui/src/index.ts`：权限状态、权限决策、Plan 命令、模式切换、权限规则持久化、写入前摘要、权限/Plan transcript 事件。
- `packages/tui/src/index.test.ts`：Phase 06 权限与 Plan 回归测试。
- `apps/cli/src/cli.ts`：帮助文案更新到 Phase 06。
- `apps/cli/src/main.test.ts`：CLI 帮助回归更新到 Phase 06。
- `docs/delivery/README.md`：Phase 06 标记为 done。
- `docs/delivery/phase-06-permissions-plan.md`：本阶段交付文档。

## 关键设计

- 权限管道放在 TUI 工具执行前：先解析工具输入，再生成权限请求，再写入权限请求/结果 transcript，只有 `allow` 才执行 `runTool()`。
- 硬拒绝优先于模式和规则：路径越界、敏感路径、危险 Bash 命令即使在 `bypass` 下也拒绝。
- `plan` 模式在权限层强制只读，不依赖模型自觉遵守。
- `acceptEdits` 只自动允许低风险工作区编辑；`Bash` 始终不自动放行。
- `dontAsk` 表示不能询问时自动拒绝需审批操作，不是自动允许。
- `auto` 当前没有分类器，因此需审批操作回退拒绝，避免把未知风险当安全。
- 权限规则和最近拒绝写入项目内 `.linghun/permissions.json`，便于当前项目诊断；该文件可能包含本地操作路径，建议不提交到 git。
- `/tab` 是本阶段的 Shift+Tab 等价命令，避免在最小 readline REPL 中提前实现真实终端快捷键。
- diff-before-write 当前只展示轻量文件/风险摘要，完整 git hunk 留给后续 diff/checkpoint 阶段增强。

## 配置项

本阶段新增项目内权限状态文件：

```text
<project>/.linghun/permissions.json
```

结构：

```json
{
  "rules": [
    { "id": "...", "effect": "deny", "toolName": "Bash", "risk": "high" }
  ],
  "recentDenied": [
    { "id": "...", "toolName": "Write", "mode": "plan", "reason": "...", "createdAt": "..." }
  ]
}
```

沿用已有配置：

- `config.permission.defaultMode` 决定 REPL 启动默认权限模式。
- 默认仍为 `default`。

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
/mode
/mode default|plan|acceptEdits|dontAsk|auto|bypass
/tab
/plan
/plan accept [id]
/permissions
/permissions add allow|ask|deny <tool|*> [risk]
/permissions remove <id>
/permissions recent
/permissions recent delete <id>
/permissions recent clear
/read /write /edit /multiedit /grep /glob /bash /todo /diff
```

## 测试与验证

已执行 focused 验证：

```bash
corepack pnpm --filter @linghun/core build
corepack pnpm --filter @linghun/tools build
corepack pnpm --filter @linghun/tui typecheck
corepack pnpm test -- packages/tui/src/index.test.ts packages/tools/src/index.test.ts apps/cli/src/main.test.ts
```

结果：通过。

已执行全量验证：

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

结果：

- `corepack pnpm test`：10 个测试文件、38 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过，7 个 workspace package 构建成功。
- `corepack pnpm check`：通过，Biome 检查 42 个文件。
- `linghun --version`：输出 `0.1.0`。
- `Linghun --version`：输出 `0.1.0`。
- `linghun --help`：显示 Phase 06 帮助文案。
- `linghun`：REPL 可启动并通过 `/exit` 正常退出。

## 真实权限与 Plan 闭环验证

单元测试已覆盖：

- `/mode plan` 后 `Read` 可用。
- `/mode plan` 后 `Write` 被拒绝，文件不变。
- `/permissions recent` 可看到最近拒绝原因。
- `/plan` 输出结构化可选方案。
- `/plan accept a` 记录决策并回到 `default`。
- `/mode acceptEdits` 后低风险 `Edit` 可执行。
- `acceptEdits` 下中风险 `Write` 被拒绝。
- `acceptEdits` 下 `Bash` 被拒绝。
- `ask` 规则会按需审批处理；当前最小 REPL 无交互审批时安全拒绝并记录最近拒绝。
- 权限规则可新增、查看、删除。
- 最近拒绝可按 id 删除。

真实 REPL smoke 已执行：

```bash
tmpdir=$(mktemp -d)
printf 'alpha' > "$tmpdir/sample.txt"
cd "$tmpdir"
printf '/mode plan\n/read sample.txt\n/grep alpha .\n/glob *.txt .\n/diff\n/write sample.txt plan-denied\n/plan\n/plan accept a\n/write sample.txt default-write\n/mode acceptEdits\n/edit sample.txt default-write => edited-write\n/bash node --version\n/mode dontAsk\n/write sample.txt dontask-denied\n/mode bypass\n/write ../escape.txt denied\n/permissions recent\n/exit\n' | "F:/Linghun/node_modules/.bin/linghun"
```

结果：通过。

- 最终文件内容为 `edited-write`，说明 default 写入和 acceptEdits 低风险编辑生效。
- REPL 输出包含 `工具 Read 结果`、`工具 Grep 结果`、`工具 Glob 结果`、`工具 Diff 结果`。
- Plan 模式下 `Write` 被拒绝，输出 `Plan 模式禁止写入`。
- `/plan` 输出 `PlanProposal`，`/plan accept a` 输出 `已确认计划`。
- default 写入前输出 `写入前摘要`。
- acceptEdits 下 `Bash` 被拒绝。
- dontAsk 下写入被自动拒绝。
- bypass 下越界写入被硬拒绝。
- `/permissions recent` 能看到最近拒绝记录，包括 `Write bypass`。
- transcript 路径示例：`C:\Users\Admin\.linghun\data\sessions\8ea9cd03d57bda42\b427176f-2c4d-4bf5-bfdf-ed3b5dc39101\transcript.jsonl`。
- transcript 事件包含 `permission_request`、`permission_result`、`plan_proposal`、`plan_decision`。

## 性能结果

- 权限决策为本地同步判断和小型 JSON 文件读写，不引入模型、MCP、Agent 或后台任务。
- `--version` / `--help` 仍走 CLI 快速路径，不启动 TUI 或模型。
- 权限规则只读取当前项目 `.linghun/permissions.json`，不扫描全局目录。
- 最近拒绝最多保留 20 条，避免无限增长。

## 已知问题

- 当前 REPL 仍是 Phase 04 建立的最小 `readline` 交互，不是完整 Ink UI。
- `/tab` 是 Shift+Tab 等价命令；真实快捷键捕获后续 TUI 增强再实现。
- 默认模式当前以轻量摘要代替交互式审批选择；本阶段满足 diff-before-write 和权限事件闭环，完整可视化审批 UI 后续增强。
- diff-before-write 不计算完整 git hunk。
- `auto` 暂无真实分类器，因此需审批操作按安全回退拒绝。
- Bash 只做命令字符串风险拦截，完整命令沙箱、长期任务和更细粒度命令分类不在本阶段。

## 不在本阶段处理

- 不实现 Phase 07 checkpoint / rewind / 行为控制完整闭环。
- 不实现 Phase 08 verifier runner。
- 不实现 Agent。
- 不实现 MCP。
- 不实现真实 cache/cost/usage/stats。
- 不实现插件系统。
- 不实现长期任务。
- 不实现 Hooks、Remote Channels 或桌面端。
- 不实现完整 Ink 权限审批 UI。

## 下一阶段衔接

Phase 07 可在本阶段权限管道基础上继续接入：

- checkpoint / rewind。
- 更完整的行为控制闭环。
- 写入前安全点。
- 输入中断、撤回和更细粒度执行控制。

Phase 07 不需要重做工具风险元数据或 transcript 事件基础。

## 开发者排查入口

- 权限模式与命令：`packages/tui/src/index.ts`
- 权限规则文件：`<project>/.linghun/permissions.json`
- 工具风险元数据：`packages/tools/src/index.ts`
- transcript 事件类型：`packages/core/src/session.ts`
- REPL 测试：`packages/tui/src/index.test.ts`
- CLI 帮助：`apps/cli/src/cli.ts`
- CLI 测试：`apps/cli/src/main.test.ts`

## 状态栏与统计口径

- 状态栏继续显示：`session`、`model`、`mode`、`cache --`、`index --`。
- 本阶段会更新 `mode` 字段，便于用户确认当前权限模式。
- 本阶段不在状态栏展示金额。
- 本阶段不实现真实 `/usage`、`/stats`、cache 命中率或费用估算。
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
- `F:\Linghun\docs\delivery\phase-05-core-tools.md`

本阶段行为参考：

- CCB / Claude Code 风格的权限提示、Plan 模式、accept edits、模式切换体验。
- OpenCode 的权限快捷键和配置化思路。
- 已修复过的 CCB Plan bypass 问题：Plan 模式不能被 bypass 类路径绕过。

进入 Linghun 自研实现的内容：

- TypeScript 权限决策逻辑。
- REPL slash 命令。
- `.linghun/permissions.json` 项目内持久化。
- 权限请求/结果与 Plan 事件 transcript 结构。
- 中文风险摘要和拒绝提示。

未进入实现的参考内容：

- 未复制 CCB、OpenCode、Hermes 的可疑源码、内部 API、反编译痕迹、专有遥测或内部服务逻辑。
- 未引入 MCP、Agent、Hooks、远程任务或插件代码。

## 索引/记忆使用情况

项目记忆：

- 已读取 `project_phase_status.md`，确认 Phase 00-05 已完成、当前任务为 Phase 06。
- 通过 memory 检索确认 `project_engineering_baseline.md` 存在，工程基线为 pnpm monorepo、`linghun` / `Linghun` 双入口。

codebase-memory：

- 已查询 `mcp__codebase-memory-mcp__index_status`。
- 项目 `F-Linghun` 索引可用，状态 `ready`，查询时为 398 nodes / 517 edges。
- 已使用 `get_architecture` 理解结构。
- 已尝试 `search_code` 搜索 Phase 05 新增符号；索引未命中当前未索引改动，因此按项目规则 fallback 到必要文件读取。

## Handoff packet

```text
phase: Phase 06 permissions and plan
status: done
completed:
  - 权限模式 default/plan/acceptEdits/dontAsk/auto/bypass
  - 工具权限决策管道
  - Plan 模式只读强制和结构化方案
  - PlanDecision 后回到执行模式
  - acceptEdits 低风险工作区编辑自动允许，Bash 拒绝
  - bypass 硬拒绝不可绕过
  - dontAsk/auto 安全回退拒绝
  - 权限规则和最近拒绝持久化
  - diff-before-write 轻量摘要
  - permission_request/permission_result/plan_proposal/plan_decision transcript 事件
entry_points:
  - packages/tui/src/index.ts
  - packages/tools/src/index.ts
  - packages/core/src/session.ts
  - docs/delivery/phase-06-permissions-plan.md
commands:
  - /mode
  - /plan
  - /permissions
  - /tab
validation:
  - corepack pnpm test
  - corepack pnpm typecheck
  - corepack pnpm build
  - corepack pnpm check
  - CLI smoke
  - REPL smoke transcript inspection
  - independent verifier spot-check PASS
  - allowed.txt cleanup confirmed
next_phase:
  - Phase 07 behavior guardrail/checkpoint/rewind
must_not_start_without_user_confirmation:
  - Phase 07+
```
