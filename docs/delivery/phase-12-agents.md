# Phase 12：Agent 闭环

## 阶段目标

完成 Linghun Phase 12 Agent 闭环：在 Phase 11 结构化 `HandoffPacket` 基础上，新增 `AgentRun` 成品级结构、explorer / worker / verifier / planner 四类 agent、`/fork` 派生入口、`/agents` 状态/详情/中断入口、独立 agent transcript、摘要化回主线程、最小 usage 可见，以及上下文裁剪和权限边界。

本阶段只实现 Phase 12 Agent 闭环，不进入 Phase 13+；不实现多模型角色路由、vision/image provider、Skills、Workflows、Hooks、Plugins、长期任务、Remote Channels、桌面端或自动后台自治。

## 已完成功能

- `AgentRun` 成品级结构：
  - 新增 `AgentRun` 与 `AgentType`，包含 `id`、`type`、`parentSessionId`、`forkedFrom`、`task`、`model`、`permissionMode`、`status`、`transcriptPath`、`transcriptSessionId`、`summary`、`contextSummary`、`cost`、`startedAt`、`updatedAt`。
  - `cost` 最小展示 input/output/cache read/cache write tokens 与 estimatedCny；当前为本地估算/占位，不显示金额到账单级结论。
- 四类 agent：
  - `explorer`：只读分析摘要，不写入。
  - `planner`：只规划摘要，不写入、不执行 Bash。
  - `verifier`：默认只读，并可在独立 transcript 中运行最小 smoke 验证。
  - `worker`：可编辑，但只在明确 `write <path> <content>` 小任务下执行，并复用现有权限管道；plan 模式会拒绝写入。
- `/fork` 闭环：
  - `/fork explorer|planner|verifier|worker <task>` 从当前主会话派生 agent。
  - 派生前读取/生成结构化 handoff，记录父会话、派生来源和裁剪上下文。
  - 默认最多 3 个 running agent；超过时拒绝并提示先取消或等待。
- Agent 独立 transcript：
  - 每个 agent 通过 `SessionStore.create()` 创建独立 session/transcript。
  - agent transcript 写入裁剪上下文 `system_event`、agent 输出或验证/工具事件。
  - 主会话 transcript 写入 `agent_start` / `agent_end` 和后台任务状态。
- Agent 状态可见、可查看、可中断：
  - `/agents` 列出 agent id/type/status/model/mode/token usage/task。
  - `/agents show <id>` 查看 transcript 路径、权限模式、裁剪上下文、summary、cost。
  - `/agents cancel <id>` 中断单个 agent，标记 `cancelled`，不影响主会话。
  - `/background` 可看到 agent 后台任务一行摘要。
- 输出摘要化回主线程：
  - agent 原始独立 transcript 不复制回主线程。
  - 主线程只显示 agent 摘要、状态、transcript 路径和最小 usage。
- 权限边界：
  - explorer / planner 使用 `plan` 权限语义，只读/规划。
  - verifier 使用 `dontAsk` 语义，只读并运行内置 smoke 验证。
  - worker 复用 `decidePermission()` 与现有 permission request/result transcript 事件；不会绕过 Plan 模式、Start Gate 或权限管道。
- 上下文裁剪：
  - agent context package 只包含 handoff id、任务摘要、Todo 数量、证据摘要、关键文件列表、权限范围。
  - 明确记录 `notIncluded=full transcript/full memory/full index/large logs`。
- 状态栏：
  - 状态栏只把 running agent 汇总进短 `bg` 数字，不显示长日志、长摘要或金额。
- `/help` 可发现：
  - TUI `/help` 新增 `/agents`、`/agents show`、`/agents cancel`、`/fork`。
  - CLI `--help` 更新到 Phase 12。

## 使用方式

构建后进入 REPL：

```bash
corepack pnpm build
corepack pnpm exec linghun
```

Phase 12 新增命令：

```text
/agents
/agents show <id>
/agents cancel <id>
/fork explorer <task>
/fork planner <task>
/fork verifier <task>
/fork worker <task>
/background
```

典型路径：

```text
/agents
/fork explorer inspect cache freshness
/fork planner plan minimal agent loop
/fork verifier verify agent loop
/fork worker write tmp-agent-smoke.txt hello
/agents
/agents show <agent-id>
/fork explorer cancellable --background
/agents cancel <agent-id>
/background
```

worker 写入边界示例：

```text
/mode plan
/fork worker write agent.txt hello
# 会被权限管道拒绝，原因是 Plan 模式禁止写入。

/mode default
/fork worker write agent.txt hello
# 走现有权限管道与写入工具；低风险工作区写入才执行。
```

## 涉及模块

- `packages/tui/src/index.ts`：新增 `AgentRun`、`AgentType`、`/agents`、`/fork`、agent 状态/中断/摘要/上下文裁剪、状态栏短 agent 数。
- `packages/tui/src/index.test.ts`：新增 Phase 12 agent help、四类 agent、独立 transcript、状态查看、中断、worker 权限边界测试。
- `packages/core/src/session.ts`：新增 transcript event：`agent_start`、`agent_end`。
- `apps/cli/src/cli.ts`：CLI help 更新到 Phase 12。
- `apps/cli/src/main.test.ts`：CLI help 测试更新到 Phase 12。
- `docs/delivery/phase-12-agents.md`：本交付文档。
- `biome.json`：validation cleanup；忽略 `.linghun/` 运行时数据，避免 TUI smoke 生成的 handoff JSON 污染 `corepack pnpm check`。
- `docs/delivery/README.md`：Phase 12 标记为 done。
- `README.md`：当前进度更新到 Phase 00-12 完成。
- `START_NEXT_CHAT.md`：下一会话 handoff 更新到 Phase 12 完成、Phase 13 待确认。

## 关键设计

- 最小闭环优先：Phase 12 先打通 agent 生命周期、状态、transcript、权限边界和上下文裁剪，不引入多模型路由或长期任务。
- 结构化 handoff 优先：`/fork` 消费 Phase 11 `HandoffPacket`，不复制完整历史。
- 权限复用：worker 不实现旁路写入，直接复用现有 `decidePermission()` 与 `runTool()`，确保 plan/acceptEdits/default 等模式一致。
- 独立 transcript：agent 输出和验证事件写入子 session；主 session 只记录 `agent_start` / `agent_end` 与背景任务摘要。
- 状态短字段：状态栏只显示 running agent 数量合并到 `bg`，详情进入 `/agents` 或 `/background`。
- 明确不进入 Phase 13：所有 agent 使用当前模型，不实现 per-agent model、role-to-model route、fallback 或预算路由。

## 配置项

本阶段未新增配置文件或依赖。默认并发限制固定为 3 个 running agent，符合 Phase 12 验收要求；后续如需配置化，应在相应阶段单独设计。

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
/agents
/agents show <id>
/agents cancel <id>
/fork explorer <task>
/fork planner <task>
/fork verifier <task>
/fork worker <task>
/background
/resume
/memory
/index status
/cache status
/break-cache status
/exit
```

## 测试与验证

本阶段要求执行：

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm check
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
printf '/agents\n/fork explorer inspect cache\n/fork planner plan agent loop\n/fork verifier verify agent loop\n/fork worker write agent-smoke.txt hello\n/agents\n/agents show\n/fork explorer cancellable --background\n/agents cancel\n/background\n/resume\n/memory\n/index status\n/cache status\n/break-cache status\n/exit\n' | corepack pnpm exec linghun
```

已执行：

- `corepack pnpm test -- --run packages/tui/src/index.test.ts`：首次因 CLI help 测试仍期望 Phase 11 失败；更新测试后复跑通过，10 个测试文件、65 个测试通过。
- `corepack pnpm exec biome check --write packages/core/src/session.ts packages/tui/src/index.ts packages/tui/src/index.test.ts`：修复 Phase 12 改动后的 Biome 格式问题。
- Validation cleanup：`biome.json` 已忽略 `.linghun/` 运行时数据，避免 TUI smoke 生成的 `.linghun/memory/session/handoff-latest.json` 被格式检查扫描；不删除用户数据。
- `corepack pnpm check`：通过，41 个源文件检查通过；`.linghun/` 运行时数据已排除。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm test`：通过，10 个测试文件、65 个测试通过。
- `corepack pnpm build`：通过，workspace 7 个包构建通过。
- `corepack pnpm exec linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec Linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec linghun --help`：通过，输出 Phase 12 CLI help。
- TUI stdin smoke：通过，覆盖 `/agents`、`/fork explorer`、`/fork planner`、`/fork verifier`、`/fork worker`、`/agents show`、`/fork ... --background`、`/agents cancel`、`/background`、`/resume`、`/memory`、`/index status`、`/cache status`、`/break-cache status`、`/exit`。

## 性能结果

- `--version` / `--help` 仍为快速路径，不启动 TUI、模型、MCP、索引、验证器或 agent。
- `/agents` 为本地状态格式化，不调用模型。
- `/fork` 创建独立 session/transcript，主线程只接收摘要。
- agent context package 为短摘要，不包含完整 transcript、完整 memory、完整 index 或大日志。
- 状态栏继续限制为短行，不显示金额。

## 已知问题

- 本阶段 agent 是产品闭环骨架：使用当前模型/本地 runner，不实现 Phase 13 的 per-agent model、模型路由或跨模型协作。
- explorer/planner 为摘要化最小能力，不执行真实模型工具循环；后续可在保持权限边界的前提下增强。
- verifier 当前运行最小 smoke 验证；完整验证策略仍可通过 `/verify` 执行。
- worker 仅支持明确低风险 `write <path> <content>` smoke 路径，用于验证权限闭环；复杂编辑仍应走主线程工具或后续增强。
- agent 并发限制当前为固定值 3，未配置化。
- TUI smoke 会产生 `.linghun/` 运行时 handoff / permission / session 数据；这些属于用户运行时数据，已通过 Biome ignore 排除出格式检查，不作为源代码检查对象。

## 不在本阶段处理的内容

- 不实现 Phase 13 多模型角色路由。
- 不实现 vision/image provider。
- 不实现 Skills / Workflows / Hooks / Plugins。
- 不实现长期任务、自动会话、Remote Channels、桌面端。
- 不默认多开 agent；只有用户明确 `/fork` 才创建。
- 不让 agent 绕过 Start Gate、Plan 模式和权限管道。
- 不把完整聊天历史复制给 agent。
- 不自动联网安装依赖。
- 不自动刷新索引。
- 不复制 CCB / OpenCode / Hermes 可疑源码。

## 下一阶段衔接

Phase 13 可以在 Phase 12 agent 生命周期基础上实现多模型协作，但必须继续遵守：

- 不把 Phase 12 的当前模型 agent 误写为多模型路由已完成。
- per-agent model、role-to-model route、fallback policy、per-role budget 属于 Phase 13。
- vision/image provider 也属于 Phase 13，不得在 Phase 12 交付里宣称已实现。
- 角色之间继续只传结构化 handoff、证据、diff、验证报告和关键文件列表。

## 开发者排查入口

- Slash router：`packages/tui/src/index.ts` 中 `handleSlashCommand()`。
- Agent commands：`handleAgentsCommand()`、`handleForkCommand()`。
- Agent lifecycle：`completeAgent()`、`runAgentWork()`、`cancelAgent()`。
- Context trimming：`createAgentContextSummary()`。
- Agent background：`createAgentBackgroundTask()`、`formatBackgroundTask()`。
- Worker permission：`runWorkerAgent()`、`decidePermission()`。
- Transcript events：`packages/core/src/session.ts` 中 `agent_start` / `agent_end`。
- Tests：`packages/tui/src/index.test.ts`、`apps/cli/src/main.test.ts`。

## 参考核对

本阶段实际读取的 Linghun 文档：

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-10-mcp-index.md`
- `F:\Linghun\docs\delivery\phase-11-sessions-memory.md`
- `F:\Linghun\docs\delivery\ccb-dev-boost-coverage-checklist.md`

本阶段实际参考：

- 本机 codebase-memory 索引：`F-Linghun` ready，用于确认代码范围；未自动刷新索引。
- `F:\ccb-source` / CCB Dev Boost 对照清单仅作为行为、边界和验收思路参考：Agent 生命周期、工具限制、输出摘要、权限边界、状态栏短字段。
- 未联网搜索 OpenCode / Hermes / 社区项目；本地文档足够完成 Phase 12 设计判断。

未复制内容：

- 未复制 CCB / OpenCode / Hermes 的可疑源码实现、反编译痕迹、内部 API、专有遥测或内部服务逻辑。
- Phase 12 实现为 Linghun 自研最小闭环。

## 成品级结构化 handoff packet

```json
{
  "id": "phase-12-agents-handoff",
  "sessionId": "current-session",
  "projectPath": "F:\\Linghun",
  "currentPhase": "Phase 12 Agent loop",
  "nextPhase": "Phase 13",
  "phaseStatus": "completed",
  "goal": "完成 Agent 闭环：AgentRun、四类 agent、/fork、独立 transcript、状态查看/中断、摘要回主线程、权限边界、上下文裁剪和最小 usage。",
  "completed": [
    "AgentRun structure",
    "explorer / worker / verifier / planner agent types",
    "/fork explorer|planner|verifier|worker <task>",
    "/agents list/show/cancel",
    "independent agent transcript session",
    "agent_start / agent_end transcript events",
    "agent background task summary",
    "trimmed context package without full transcript/memory/index/logs",
    "max 3 running agents",
    "minimal token usage display",
    "status bar short running agent count via bg",
    "worker permission pipeline boundary",
    "/help and CLI help Phase 12 visibility"
  ],
  "pending": [
    "Phase 13 multi-model collaboration only after user confirmation"
  ],
  "mustNotDo": [
    "Do not enter Phase 13+ without user confirmation",
    "Do not implement multi-model role routing in Phase 12",
    "Do not implement vision/image provider in Phase 12",
    "Do not implement Skills, Workflows, Hooks, Plugins, Jobs, Remote Channels, desktop in Phase 12",
    "Do not copy full transcript, full memory, full index or large logs into agent context",
    "Do not let worker bypass Start Gate, Plan mode or permission pipeline",
    "Do not auto-refresh index or auto-install dependencies"
  ],
  "todos": [],
  "keyFiles": [
    "packages/tui/src/index.ts",
    "packages/tui/src/index.test.ts",
    "packages/core/src/session.ts",
    "apps/cli/src/cli.ts",
    "apps/cli/src/main.test.ts",
    "docs/delivery/phase-12-agents.md",
    "biome.json"
  ],
  "changedFiles": [
    "packages/tui/src/index.ts",
    "packages/tui/src/index.test.ts",
    "packages/core/src/session.ts",
    "apps/cli/src/cli.ts",
    "apps/cli/src/main.test.ts",
    "docs/delivery/phase-12-agents.md",
    "docs/delivery/README.md",
    "README.md",
    "START_NEXT_CHAT.md",
    "biome.json"
  ],
  "evidenceRefs": [
    {
      "kind": "test_result",
      "source": "corepack pnpm test",
      "summary": "Workspace test suite passed: 10 test files, 65 tests."
    },
    {
      "kind": "command_output",
      "source": "corepack pnpm typecheck",
      "summary": "TypeScript typecheck passed after Phase 12 implementation."
    },
    {
      "kind": "command_output",
      "source": "corepack pnpm build",
      "summary": "Workspace build passed for 7 packages."
    },
    {
      "kind": "command_output",
      "source": "corepack pnpm check",
      "summary": "Biome check passed for 41 source files after ignoring runtime .linghun data."
    },
    {
      "kind": "test_result",
      "source": "TUI stdin smoke",
      "summary": "Covered /agents, /fork explorer/planner/verifier/worker, /agents show, /agents cancel, /background, /resume, /memory, /index status, /cache status and /break-cache status."
    }
  ],
  "verification": {
    "status": "passed_local_validation_pending_independent_verifier",
    "commands": [
      "corepack pnpm check",
      "corepack pnpm typecheck",
      "corepack pnpm test",
      "corepack pnpm build",
      "corepack pnpm exec linghun --version",
      "corepack pnpm exec Linghun --version",
      "corepack pnpm exec linghun --help",
      "TUI stdin smoke for /agents, /fork explorer/planner/verifier/worker, /resume, /memory, /index status, /cache status, /break-cache status"
    ]
  },
  "risks": [
    "Phase 12 agent loop is minimal product skeleton, not Phase 13 multi-model routing.",
    "Explorer/planner are summarized local paths, not full autonomous model/tool loops.",
    "Worker supports only explicit small write smoke path in this phase."
  ],
  "indexStatus": {
    "project": "F-Linghun",
    "status": "ready",
    "nodes": 593,
    "edges": 1028
  },
  "permissionMode": "default Claude Code session; Linghun worker agent reuses existing permission pipeline",
  "modelProvider": {
    "assistant": "claude-sonnet-4-6 via Claude Code",
    "linghunRuntimeProvider": "deepseek config path unchanged"
  },
  "recentCommit": "24ddd23 feat: complete Linghun phase 11 delivery",
  "budgetUsage": "No real billing fields added; agent usage is minimal token estimate; status bar has no money.",
  "createdAt": "2026-05-16",
  "generatedBy": "Claude Code / Linghun Phase 12 delivery"
}
```
