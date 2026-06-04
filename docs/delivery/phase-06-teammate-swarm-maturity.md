# Phase 06：Teammate / Swarm 成熟体验接线闭环

## 阶段目标

把 Phase 05 的轻量 Team / Agent 协作从一次性子任务推进到可继续的 teammate 生命周期：agent 能 idle、接收 bounded mailbox、继续处理、汇报 busy/idle/blocked/completed；同时补 shared task assignment、优雅 shutdown、低噪 `/agents` / `/background` 查看、主链权限桥接继续/拒绝闭环。

本阶段只基于 Linghun 现有源码事实推进；未新建第二套 agent、mailbox、workflow、permission、Windows stop 或 terminal pane backend。

## Source-Level Reality Check

### existing implementation

- `packages/tui/src/tui-data-types.ts` 已有 `AgentRun`、`AgentMailboxMessage`、`teamName`、`addressableName`、`activityStatus`、`mailbox`。
- `packages/tui/src/job-agent-command-runtime.ts` 已有 `/fork`、`/agents`、`sendAgentMessage()`、`consumeAgentMailbox()`、`completeAgent()`、`cancelAgent()`、`cancelAllAgents()`、持久化 AgentRun、background 映射。
- `packages/tui/src/index.ts` 已有 `StartAgent`、`AgentControl`、`SendMessage`、`RunWorkflow` 模型工具 dispatch，以及 `pendingLocalApproval` 权限桥。
- `packages/tui/src/tui-agent-job-runtime.ts` 已有 Agent background projection、cancellable/running 判定和 footer/cap 过滤。
- `packages/tui/src/process-guard.ts`、`runner-runtime.ts`、`packages/tools/src/index.ts` 已覆盖 Windows process guard、native runner contract、PowerShell adapter 基础边界。

### gaps

- `SendMessage` 只能投递给 running agent，完成后的 agent 无 idle 可继续生命周期。
- `completeAgent()` 把 completed agent 直接终结，无法作为 teammate 等待下一条 mailbox。
- 子 agent 权限 approve 后只执行一次工具并保持 blocked，未继续 child loop；deny 已能明确 blocked。
- shared task assignment 缺最小占用语义，team task 容易被多个 agent 同时接收。
- `/agents show` 和 `/background` 对 teammate idle/queued/recent result 信息不够明确。
- Windows Terminal pane backend 当前没有源码底座；只有 terminal capability 检测和 process/native runner 边界。

### minimal touch points

- `packages/tui/src/tui-data-types.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/tui-agent-job-runtime.ts`
- `packages/tui/src/tui-details-runtime.ts`
- `packages/tui/src/model-loop-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`

### forbidden duplicate systems

- 不新建第二套 AgentRun store、mailbox store、agent scheduler、workflow executor、permission pipeline、background table、Windows stop/process supervisor。
- 不绕过 `decidePermission()`、`pendingLocalApproval`、AgentControl、process-guard、PowerShell adapter、native runner contract。
- 不引入 tmux/iTerm/Windows Terminal pane 多后端；本阶段只做 source-level spike 和 DEFERRED 裁决。

## 已完成功能

- `AgentRun` 新增 teammate idle 语义：`status: "idle"`、`activityStatus: "idle"`、`lastResultSummary`。
- `completeAgent()` 在一轮 completed 后把 AgentRun 转为 idle，而 `agent_end` 仍记录本轮 `completed` 证据。
- `SendMessage` 支持投递给 running / idle / completed teammate；idle teammate 收到 mailbox 后自动 fresh provider turn 继续处理。
- `SendMessage` 新增最小 shared task assignment：`kind: "task"` 或 `taskId` 时只分配给一个可用 agent；同一 active `taskId` 已 assigned/running 时 fail closed。
- mailbox transcript 增加 `kind/taskId`，task assignment 写 child transcript 和 parent system event。
- 子 agent `Bash/Edit/Write/MultiEdit` 权限 approve 后：先执行批准工具，再把工具结果摘要放入 system mailbox，然后继续一次 child loop；deny 后仍明确 blocked 且不执行工具。
- `cancelAgent()` / `cancelAllAgents()` 保持既有 abort controller 路径，并同步 `activityStatus=cancelled`、`activeTask.status=cancelled`、background 和 persisted AgentRun。
- `/agents` 摘要显示 busy / idle / cancellable；details 显示 role、team、activity、queued messages、active task、recent result。
- `/background` 显示 idle teammate 摘要，但 footer/resource cap 仍只把 running agent 视为 active，idle 不污染 footer/cap。
- `AgentControl list` 结构化结果增加 teammates 摘要，供主链低噪决策。

## 使用方式

```text
/fork worker <task> --background --name alice --team core
/agents send alice 请继续检查
/agents send --team core 团队广播
/agents show alice
/agents cancel all
```

模型工具路径：

```json
{ "to": "alice", "message": "请继续检查" }
{ "team": "core", "kind": "task", "taskId": "fix-123", "message": "请处理这个任务" }
{ "action": "cancel_all" }
```

## 涉及模块

- 代码：`packages/tui/src/tui-data-types.ts`、`packages/tui/src/job-agent-command-runtime.ts`、`packages/tui/src/tui-agent-job-runtime.ts`、`packages/tui/src/tui-details-runtime.ts`、`packages/tui/src/model-loop-runtime.ts`、`packages/tui/src/index.ts`
- 测试：`packages/tui/src/index.test.ts`
- 文档：`docs/delivery/phase-06-teammate-swarm-maturity.md`、`docs/delivery/README.md`

## 关键设计

- `running` 表示 busy/cancellable；`idle` 表示 teammate 可收信但不占用 footer/cap。
- `completed` 兼容旧持久化，hydrate 时按 idle activity 展示；新完成的 AgentRun 进入 `idle`。
- shared task 只在 `kind: "task"` 或 `taskId` 明确出现时启用；普通 team broadcast 保持 Phase 05 语义。
- 权限 approve 后继续 child loop 仍走原 agent runtime 和 mailbox，不新增 continuation runtime。
- shutdown/cancel 仍复用 AgentControl、abort controller、process-guard/native runner/PowerShell adapter 底座；没有 Windows stop 新系统。

## 配置项

未新增配置项、依赖、构建脚本或环境变量。

沿用 Phase 05 内置限制：

- mailbox pending messages：20
- mailbox pending bytes：16384
- mailbox consume batch：3
- team broadcast max active/idle agents：5

## 命令

```text
/agents
/agents show <id|name>
/agents send <id|name> <message>
/agents send --team <team> <message>
/agents cancel <id|name>|all
/background
```

## 测试与验证

已执行：

```bash
corepack pnpm --filter @linghun/tui exec tsc --noEmit
corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "Phase 5 mailbox|idle teammate|shared task|child agent Write permission|approved child agent tool|SendMessage assigns|AgentControl cancel|cancel all|stop_all|background includes idle|resource caps|process guard"
corepack pnpm --filter @linghun/tui exec vitest run src/model-loop-runtime.test.ts src/shell/view-model.test.ts src/process-guard.test.ts -t "SendMessage|AgentControl|startup hydrate-style|backgroundSummaries|footer|ProcessGuard|taskkill|process guard"
```

结果：

- `tsc --noEmit`：PASS。
- focused `index.test.ts`：PASS，15 tests passed。
- focused model-loop / shell view / process-guard：PASS，61 tests passed。

覆盖点：

- idle mailbox 消费与继续处理。
- shared task assignment / busy 冲突。
- child agent Write 权限 approve 继续、deny blocked。
- `AgentControl cancel_all` / `stop_all`。
- `/agents show` teammate 低噪摘要。
- `/background` idle teammate 摘要。
- idle teammate 不污染 footer/resource cap。
- Windows process guard 复用边界：`taskkill` / graceful+force process guard tests。

## 性能结果

- mailbox、task assignment 和 teammate summary 只扫描当前 session 的 agent 数组。
- idle teammate 不占用 running cap，避免空闲队友阻塞新 agent。
- mailbox batch 仍固定 3 条；team broadcast 仍限制 5 个 active/idle agents。

## 已知问题

- idle teammate 使用 fresh provider turn 继续，不回放旧 stream。
- shared task 是最小 assignment 语义，不是全局黑板、leader election 或 autonomous swarm。
- `index.test.ts` 仍是超大测试文件；本阶段未拆测试文件。

## 不在本阶段处理的内容

- 不做 tmux/iTerm/Windows Terminal pane backend。
- 不做完整 swarm coordinator、共享黑板、agent-to-agent 自治协议。
- 不新增 `/teammate`、`/swarm` 等杂项命令。
- 不扩大权限桥接到插件、hook、MCP、remote approval。
- 不改变 provider/model/env/permission mode。

## Windows Terminal backend spike

源码级结论：当前 Linghun 已有 `shell/terminal-capability.ts` 识别 Windows Terminal / VS Code / WezTerm / conpty 能力；进程生命周期已有 `process-guard.ts` 和 native runner contract；但没有 pane/session backend 抽象，也没有 Windows Terminal pane 控制 API、PTY pane lifecycle、pane transcript/evidence 映射或权限边界。

裁决：`DEFERRED`。原因：

- teammate 生命周期、mailbox、permission bridge 本阶段刚闭合，pane backend 会引入第二套可视/进程生命周期风险。
- 现有需求可用 AgentRun/background/transcript/evidence 闭环满足。
- Windows 进程停止必须继续复用 process-guard/native runner contract；不能强行引入 tmux/iTerm 多后端。

## 下一阶段衔接

如继续做 pane/backend，必须先单独做 Source-Level Reality Check，明确是否已有 PTY/pane runtime、权限边界、transcript/evidence 映射和 Windows process cleanup 证据；未完成前不得把 pane backend 作为 teammate 生命周期前置条件。

## 开发者排查入口

- teammate lifecycle / mailbox / shared task：`packages/tui/src/job-agent-command-runtime.ts`
- AgentRun 类型：`packages/tui/src/tui-data-types.ts`
- agent/background helper：`packages/tui/src/tui-agent-job-runtime.ts`
- `/agents show` details：`packages/tui/src/tui-details-runtime.ts`
- model tool schema：`packages/tui/src/model-loop-runtime.ts`
- model tool dispatch / permission approve：`packages/tui/src/index.ts`
- process guard：`packages/tui/src/process-guard.ts`

## 参考核对

实际读取的 Linghun 文档：

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-05-team-agent-collaboration-productization.md`
- `docs/delivery/phase-agent-stop-display-closure.md`
- `docs/delivery/phase-02-background-actionable-panel-closure.md`

实际源码核对：

- `packages/tui/src/tui-data-types.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/tui-agent-job-runtime.ts`
- `packages/tui/src/tui-details-runtime.ts`
- `packages/tui/src/model-loop-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/process-guard.ts`
- `packages/tui/src/shell/terminal-capability.ts`
- `packages/tools/src/index.ts`
- `packages/tui/src/runner-runtime.ts`

参考使用说明：

- CCB / CCB Dev Boost / Warp / OpenCode 只作为成熟行为边界和验收口径参考。
- 本阶段没有复制 CCB 源码、内部 API、专有遥测或可疑实现。
- codebase-memory MCP 工具本轮未暴露；使用 `rg`、源码精读和两个只读 explorer subagent 完成 reality check。

## 成品级结构化 handoff packet

- 当前阶段：Phase 06 Teammate / Swarm Maturity。
- 阶段状态：completed / focused local validation only。
- 下一阶段：需用户确认后再进入；不得自动推进。
- 禁止事项：不要新建第二套 agent/workflow/permission/Windows stop/pane backend；不要把 idle teammate 计入 footer/cap；不要让 shared task 普通广播抢任务。
- 证据引用：本报告“测试与验证”；新增 focused tests 位于 `packages/tui/src/index.test.ts`。
- 验证结果：typecheck PASS；focused index tests PASS；focused model-loop/shell/process tests PASS。
- 索引状态：codebase-memory MCP 未暴露；源码事实来自 `rg` + 精读 + explorer subagents。
- 权限模式：未新增 permission mode；继续复用 `decidePermission()` / `pendingLocalApproval`。
- 模型/provider：未调用真实 provider；测试使用本地 mock OpenAI-compatible stream。
- 预算使用情况：未新增成本配置；无真实模型 token/cost 消耗。
