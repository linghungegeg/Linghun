# Phase 17 Agent/Workflow Ecosystem Closure

## 目标

补齐 Linghun agent/workflow 高级生态闭环：命名 agent/team、SendMessage、真后台 fork、agent cwd/worktree isolation、自定义 agent registry、自定义 workflow registry。行为参考 CCB 成熟体验，但本阶段为 Linghun 自研实现，未复制 CCB 源码。

## 本阶段范围

- 只推进 agent/workflow/job/worktree 相关闭环。
- 不修改 provider/model/key/env route。
- 不 touch `.claude`。
- 不纳入根目录 `.md` 或 `report.md`。
- 不新增重复 agent/workflow/job/worktree 系统。

## 已完成功能

- `StartAgent` 支持 `name`、`teamName`/`team_name`、`runInBackground`/`run_in_background`、`cwd`、`isolation: "worktree"`、`subagent_type`。
- agent 运行态保存 addressable name/team、mailbox、cwd/isolation、heartbeat、cancel token、transcriptSessionId。
- 新增 model-facing `SendMessage` 工具；slash 入口为 `/agents send <id|name|team> <message>`。
- mailbox 消息进入 agent transcript/session 和 `.linghun/agent-runs` 状态，agent loop 会在模型回合前消费 pending mailbox。
- `/fork --background` 和 `StartAgent({ runInBackground: true })` 立即返回，后台通过既有 background task + agent runtime 异步推进。
- TUI 重启 hydrate `.linghun/agent-runs/*.json`，旧 running agent 标记为 `stale`，不假装 completed。
- agent cwd 做 workspace/worktree 安全校验；`isolation: worktree` 复用既有 managed worktree 创建和 evidence。
- `.linghun/agents/*.json|*.md` 提供最小自定义 agent registry。
- `.linghun/workflows/*.json|*.md` 提供最小 workflow registry，并复用现有 workflow/background/event 主链执行。
- `/agents registry`、`/workflows registry`、`/workflows run <workflowId|agent:id|goal>` 提供用户可见入口。

## 使用方式

```text
/fork worker fix-login --background --name alice --team backend
/agents send alice 请先检查失败日志
/agents
/agents show agent-xxxx
/agents cancel agent-xxxx
/agents registry
/fork reviewer inspect-diff
/workflows registry
/workflows run check
/workflows run agent:reviewer inspect docs
```

自定义 agent JSON 示例：

```json
{
  "id": "reviewer",
  "name": "Reviewer",
  "description": "Review with a custom prompt.",
  "prompt": "Review the requested change.",
  "allowedTools": ["Read"],
  "maxTurns": 2
}
```

自定义 workflow JSON 示例：

```json
{
  "id": "check",
  "name": "Check",
  "description": "Run registry details step.",
  "steps": [{ "id": "details", "action": "details" }]
}
```

## 涉及模块

- `packages/tui/src/model-loop-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/tui-data-types.ts`
- `packages/tui/src/tui-details-runtime.ts`
- `packages/tui/src/agent-workflow-registry.ts`

## 关键设计

- `CommandProposal` 仍只作为 fallback；agent/workflow 执行入口走 model-facing tool 或 slash 主链。
- `SendMessage` fail-closed：找不到 running agent/team 时失败，不广播、不写无目标日志。
- `.linghun/agent-runs` 只保存既有 `AgentRun` 状态快照，用于重启识别 stale/resumable；不承担第二套 agent scheduler/provider/tool/permission。
- workflow registry step 进入 `runRegistryWorkflow` / `executeRegistryWorkflowStep`，并复用 background task、workflow events、verification/index/details/bash/agent slash/tool 主链。
- worktree isolation 复用 `createManagedWorktree` 和 `summarizeWorktreeCreateOutcome`，不新增 worktree 创建/删除系统。

## 配置项

- 新增用户文件位置：`.linghun/agents/*.json|*.md`、`.linghun/workflows/*.json|*.md`。
- 未新增 provider/model/key/env route 配置。
- 未修改构建、发布或依赖配置。

## 命令

- `linghun` TUI 内：`/fork`、`/agents`、`/agents registry`、`/agents send`、`/agents show`、`/agents cancel`、`/workflows registry`、`/workflows run`。
- Windows 下 `Linghun` 入口兼容性本阶段未改动。

## 测试与验证

- `corepack pnpm exec tsc --noEmit`
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts src/model-loop-runtime.test.ts src/tool-result-budget.test.ts`
- `corepack pnpm -r build`
- `git diff --check`

结果以最终交付回复为准。

## 性能结果

- Registry loader 仅读取 `.linghun/agents` 与 `.linghun/workflows` 下的 json/md 文件。
- 后台 agent/workflow 继续通过现有 background task surface 汇报，不向主屏刷完整机制日志。

## 已知问题

- 重启后旧 running agent 目前标记为 `stale`，本阶段不恢复中断中的模型流。
- Registry Markdown frontmatter 仅支持 JSON frontmatter，避免引入额外解析依赖。
- Registry `write` step 默认 blocked，除非未来接入明确的 Write tool input schema；本阶段不自动合成写入。

## 不在本阶段处理

- 不实现远程 agent/team 控制台。
- 不实现跨进程继续执行旧模型流。
- 不新增 workflow DSL、复杂条件分支或并行 DAG。
- 不改 provider/model/key/env route。

## 下一阶段衔接

- 可在后续阶段继续补 agent stale resume、workflow background recovery、registry schema 文档化和更细粒度权限提示。
- 下一阶段仍需用户明确确认后开始。

## 开发者排查入口

- agent runtime：`packages/tui/src/job-agent-command-runtime.ts`
- model-facing tool schema：`packages/tui/src/model-loop-runtime.ts`
- slash/workflow bridge：`packages/tui/src/index.ts`
- registry loader：`packages/tui/src/agent-workflow-registry.ts`
- details panel：`packages/tui/src/tui-details-runtime.ts`
- tests：`packages/tui/src/index.test.ts`

## 状态栏与统计口径

- 主屏只显示简短 background/agent 摘要。
- name/team/pending/cwd 进入 `/agents` details。
- workflow 完成仍为 PARTIAL，不能因为 steps completed 宣称 PASS。

## 学习成本与渐进披露

- 普通入口：`/agents`、`/agents send`、`/workflows registry`、`/workflows run`。
- 高级入口：自定义 registry 文件和 `isolation: worktree`。
- 失败和 schema error 在 `/agents registry` 或 `/workflows registry` 中展示，不阻塞其它合法 registry 项。

## TUI 渲染稳定性

- `/agents` 行已压缩，保留 role/name/team/pending/cwd，避免长行破坏普通面板。
- 长机制细节进入 details/transcript/background task。
- 新增中文和英文主路径文案：background start、registry empty、agent registry summary。

## 主输出与日志分层

- 主屏输出降噪：启动、投递、取消只给短结果。
- mailbox 消费、workflow events、background task updates 写 transcript/background details。
- 原始 registry schema 错误只在 registry details 中展开。

## 阶段 Verdict

- verdict：PARTIAL
- 是否允许进入下一阶段：no，需用户确认
- P0/P1/P2 风险分类：P1 stale resume 仍是识别而非恢复；P2 registry Markdown frontmatter 仅 JSON
- 阻塞项：无本阶段实现阻塞
- 用户下一步审核点或命令：运行最终交付回复列出的验证命令，手动试 `/fork --background`、`/agents send`、`/workflows registry`

## 真实改动文件

- 代码：`packages/tui/src/agent-workflow-registry.ts`、`packages/tui/src/index.ts`、`packages/tui/src/job-agent-command-runtime.ts`、`packages/tui/src/model-loop-runtime.ts`、`packages/tui/src/tui-data-types.ts`、`packages/tui/src/tui-details-runtime.ts`
- 测试：`packages/tui/src/index.test.ts`
- 文档：`docs/delivery/phase-17-agent-workflow-ecosystem-closure.md`、`docs/delivery/README.md`
- 生成物：无
- 用户已有 diff / 非本轮证据：根目录 `.md` 为既有未跟踪项，本阶段未纳入

## 运行时事实

- provider/model：未修改 provider/model/key/env route；测试使用项目现有 mock gateway
- permission mode：遵循现有 TUI context permission mode
- index status：codebase-memory MCP 不可用，本阶段使用 `rg` 和源码精读
- cache/usage 来源：无真实 provider 账单；测试 token/cost 为既有估算口径
- 配置来源：`.linghun/agents`、`.linghun/workflows` registry 文件
- 是否有脱敏/密钥风险：未写 API key、Authorization header、cookie 或 provider.env

## 后台/复查任务状态反馈

- agent：`AgentRun.status`、`heartbeatAt`、`cancelTokenId`、`summary`、`transcriptSessionId`、`.linghun/agent-runs/<id>.json`。
- workflow：既有 `BackgroundTaskState`、`workflow_start`、`background_task_update`、`workflow_end`。
- stale：hydrate 时旧 running agent 标记 `stale`，不假 completed。

## 语言与 i18n 口径

- 中文路径覆盖 `/fork --background`、`/agents`、`/agents registry`、`/agents send`、`/workflows registry`。
- 英文路径覆盖 background start、registry empty、agent registry summary。
- Slash 命令和结构化 transcript 字段保持英文。

## 参考核对

- 已读取 Linghun 文档：`AGENTS.md`、`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`、`docs/delivery/README.md`、Phase 16/17A/17B 交付文档。
- 已精读 Linghun 源码：用户指定的 model loop、TUI index、agent/job/runner/git runtime 与 data types。
- 已只读行为参考 CCB：`AgentTool.tsx`、`runAgent.ts`、`SendMessageTool`、`workflows/index.ts`。
- 行为参考进入 Linghun 自研实现：addressable agent/team、mailbox SendMessage、true background immediate return、registry workflow/user visible list-run path。
- 未复制 CCB 源码、内部 API、专有服务逻辑或可疑实现。

## Source-Level Reality Check

- existing implementation：Linghun 已有 `StartAgent`、`RunWorkflow`、`/fork`、`/agents`、background task、durable job、managed worktree、verification/index/details 主链。
- gaps：StartAgent 输入缺 name/team/cwd/isolation；无 SendMessage；`/fork --background` 曾同步等待；无自定义 registry；workflow registry 不存在；agent cwd 未绑定；重启旧 running agent 未识别 stale。
- minimal touch points：只补 TUI runtime、model tool schema、data types、details、registry loader 和 targeted tests。
- forbidden duplicate systems：未新增第二套 provider、tool runner、permission pipeline、job scheduler 或 worktree manager；`.linghun/agent-runs` 仅为 agent runtime 状态快照。

## 交接摘要

- 下一阶段：用户确认后再继续 stale resume / workflow recovery hardening。
- 禁止事项：不要 stage/commit；不要碰 `.claude`；不要修改 provider/model/key/env route；不要纳入根目录 `.md` 或 `report.md`。
- 证据引用：`packages/tui/src/index.test.ts` 中 named background agent/mailbox/stale、registry workflows、自定义 agent run 相关测试。
- 验证结果：以最终回复中的命令结果为准。
- 索引状态：codebase-memory MCP 不可用，使用 `rg` 源码事实。
- 权限模式：沿用现有 TUI permission mode 和 Start Gate。
- 模型/provider：未改配置；测试 mock provider。
- 预算使用情况：无真实账单；验证命令本地执行。
