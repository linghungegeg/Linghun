# Phase 05：轻量 Team / Agent 协作能力成品化

## 阶段目标

基于现有 `AgentRun`、`teamName/addressableName/mailbox`、`SendMessage`、`/agents show/send/cancel`、`/background`、permission pipeline、transcript/evidence/persistAgentRun，把轻量 Team / Agent 协作能力从“能用”收口到有边界、可审计、低噪的成品化状态。

本阶段不新建第二套 agent 框架，不引入 Windows Terminal/tmux/pane 后端，不实现长期 teammate foreground/return main，不改 workflow batch 调度。

## 已完成功能

- `AgentMailboxMessage` 升级为有边界协议：`id`、`createdAt`、`from`、`to`、`status(pending/consumed/failed)`、`summary`，兼容旧持久化 mailbox normalize。
- mailbox 发送侧限制 pending 数量与 pending 字节；超限返回低噪、可操作错误。
- agent 每轮只消费最多 3 条 mailbox 消息，消费后写 `consumedAt/status=consumed`、transcript `mailbox_consumed`、parent evidence `agent_mailbox`。
- mailbox 消费 evidence/transcript 写入失败时，本批消息标记 `failed`，agent 进入失败链路，不吞消息。
- `SendMessage` 改为严格路由：
  - 默认只按 running agent `id` / `addressableName` 单目标投递。
  - id/name 多候选时 fail closed 并提示候选。
  - team 广播必须显式使用 `team/teamName/team_name` 或 `/agents send --team <team>`。
  - team 广播限制最多 5 个 running agents。
- agent busy/idle 状态写入 `AgentRun.activityStatus/activitySummary`，同步到 background summary/currentStep。
- `completeAgent` 对非 running agent 不派发新任务，避免乱派 blocked/cancelled/completed agent。
- 子 agent `Bash/Edit/Write/MultiEdit` ask 权限桥接到父会话 pending approval：
  - pending approval 展示 agent id/tool。
  - approve 后复用 agent runtime 的 cwd/scoped tool context 执行一次工具，写 child transcript、parent evidence、background 状态。
  - deny 后工具不执行，写 child transcript/tool_result 和 parent failure evidence。
  - 已有 pending approval 时 fail closed，不覆盖父会话待审批项。
- `/agents show` details 展示低噪 mailbox/busy 摘要和最近 5 条 mailbox tail，不展示完整 transcript/raw evidence。
- `SendMessage` tool schema/description 增加 `targetType/broadcastTeam`，明确 team broadcast 需要显式声明。

## 使用方式

```text
/fork worker <task> --background --name alice --team core
/agents send alice 请继续检查
/agents send --team core 团队消息
/agents show alice
/agents cancel alice
```

模型工具路径：

```json
{ "to": "alice", "message": "请继续检查" }
{ "targetType": "team", "team": "core", "message": "团队消息" }
```

## 涉及模块

- `packages/tui/src/tui-data-types.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/model-loop-runtime.ts`
- `packages/tui/src/tui-details-runtime.ts`
- `packages/tui/src/pending-details-presenter.ts`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/index.test.ts`

## 关键设计

- 只复用现有 agent/background/permission/transcript/evidence 管道；没有新建 agent runtime、mailbox storage 或 scheduler。
- mailbox cap 只限制 pending 消息数量和 pending 字节；consumed/failed 历史可被投递成功路径裁剪，避免历史无限增长。
- SendMessage 默认单目标，team 广播必须显式，避免 name/team/id 混合匹配导致静默广播。
- agent 权限 approve 后只执行已批准的那一次工具，不自动恢复长期 child loop；长期 teammate foreground/return main 留到后续阶段。
- `/background` 只显示必要 activity summary，不展开 mailbox 原文、transcript 或 raw evidence。

## 配置项

未新增用户配置项、依赖、构建脚本或环境变量。

本阶段内置限制：

- mailbox pending messages：20
- mailbox pending bytes：16384
- mailbox consume batch：3
- team broadcast max running agents：5

## 命令

```text
/agents
/agents show <id|name>
/agents send <id|name> <message>
/agents send --team <team> <message>
/agents cancel <id|name>|all
```

## 测试与验证

已执行：

```bash
corepack pnpm --filter @linghun/tui exec tsc --noEmit
corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "Phase 5 mailbox|bounded mailbox|child agent Write permission"
```

验证结果：

- `tsc --noEmit`：PASS。
- focused vitest：PASS，5 tests passed。

覆盖点：

- mailbox cap。
- mailbox pending/consumed/failed 状态流转。
- SendMessage id/name 冲突 fail closed。
- team 显式广播限制。
- agent 每轮 bounded consume。
- 子 agent Write 权限桥接 approved/denied。
- `/agents show` 低噪 mailbox/busy 摘要。

## 性能结果

- mailbox 发送和展示只扫描当前 session 的 agent/mailbox 数组，未新增后台进程。
- mailbox 消费批量固定为 3，避免单轮无限循环或长时间占用 provider turn。
- team broadcast 限制为 5 个 running agents，避免模型误触发大范围投递。

## 已知问题

- approve 后不会自动继续完整 child agent loop；本阶段只闭合一次工具审批的可追责执行。
- 旧持久化 mailbox 会在 hydrate/发送/消费时 normalize，新字段由运行时补齐。
- `packages/tui/src/index.test.ts` 仍是超大测试文件；本阶段未做测试文件拆分。

## 不在本阶段处理的内容

- 不做 workflow batch 调度改动。
- 不做 Windows Terminal/tmux/pane 后端。
- 不做长期 teammate foreground/return main。
- 不扩大权限桥接到插件、hook、MCP、team broadcast。
- 不新增 `/agents` 之外的杂项命令。

## 下一阶段衔接

Phase 6 可在用户确认后继续做长期 teammate foreground/return main、跨 agent 更完整恢复、或工作流调度深化。本阶段已经把 mailbox/SendMessage/agent permission 的最小协作协议收口，后续不得复制第二套 agent/mailbox/permission 系统。

## 开发者排查入口

- mailbox 协议与 SendMessage：`packages/tui/src/job-agent-command-runtime.ts`
- agent 数据结构：`packages/tui/src/tui-data-types.ts`
- 父会话权限桥接：`packages/tui/src/index.ts`
- 权限详情与主屏卡片：`packages/tui/src/pending-details-presenter.ts`、`packages/tui/src/shell/view-model.ts`
- `/agents show` details：`packages/tui/src/tui-details-runtime.ts`
- tool schema：`packages/tui/src/model-loop-runtime.ts`

## 参考核对

本阶段实际读取的 Linghun 文档：

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-12-agents.md`
- `docs/delivery/phase-17-agent-workflow-ecosystem-closure.md`
- `docs/delivery/phase-agent-stop-display-closure.md`
- `docs/delivery/phase-02-background-actionable-panel-closure.md`

本阶段源码事实核对：

- `packages/tui/src/tui-data-types.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/model-loop-runtime.ts`
- `packages/tui/src/tui-details-runtime.ts`
- `packages/tui/src/tui-agent-job-runtime.ts`
- `packages/tui/src/pending-details-presenter.ts`
- `packages/tui/src/shell/view-model.ts`

本阶段没有复制 CCB、CCB Dev Boost 或其他社区项目源码；仅按用户要求参考成熟产品行为边界，所有实现均基于 Linghun 现有源码自研收口。

## 成品级结构化 handoff packet

- 当前阶段：Phase 05 Team / Agent Collaboration Productization。
- 阶段状态：completed。
- 下一阶段：Phase 6，需要用户明确确认后才能开始。
- 禁止事项：不得新建第二套 agent 框架；不得引入 Windows Terminal/tmux/pane 后端；不得改 workflow batch 调度；不得扩大权限桥接到插件/hook/MCP/team broadcast。
- 证据引用：本阶段新增 focused tests 位于 `packages/tui/src/index.test.ts`；主要实现位于 `packages/tui/src/job-agent-command-runtime.ts`、`packages/tui/src/index.ts`。
- 验证结果：`tsc --noEmit` PASS；focused vitest PASS（5 tests）。
- 索引状态：codebase-memory MCP 当前未暴露可用工具；本阶段使用 `rg` 和源码精读确认事实。
- 权限模式：本地开发默认权限管道；子 agent 权限桥接覆盖 `Bash/Edit/Write/MultiEdit`。
- 模型/provider：未调用真实 provider；测试使用本地 mock OpenAI-compatible stream。
- 预算使用情况：未新增成本配置；本阶段无真实模型 token/cost 消耗。
