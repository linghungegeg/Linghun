# Agent Stop & Display Closure

## 目标

完成本轮“Agent 停止与显示收口”：按 Linghun 源码事实和 CCB 成熟行为参考，让 agent list 返回可取消 ID 和状态，支持一次停止所有 running agent，并让 stale/terminal agent 不再污染 footer、background 主屏摘要和并发 cap。

## 本阶段范围

- 只收口现有 AgentControl、`/agents`、agent background 投影、footer/background 计数和测试。
- 不新增第二套 agent/job/runtime/provider/permission 系统。
- 不实现跨进程恢复旧模型流，不改变 job / workflow / verification 的 stale 语义。

## 已完成功能

- `AgentControl` schema 支持 `cancel_all` / `stop_all`。
- `AgentControl list` 的 tool result 返回可取消 agent ID 和状态。
- `/agents` details 显示每个 agent 的 `cancellable yes/no`，并汇总可取消 ID。
- `/agents cancel all` 可一次取消所有 running agent。
- 用户说“停止所有智能体”时，模型可通过结构化 `AgentControl({ action: "cancel_all" })` 一次停止。
- stale / terminal agent 保留在 `/agents` 和持久化状态中，但不再进入 footer、background 主屏摘要和并发 cap。
- background/footer 对非 agent stale 任务保持原有可见性，避免误伤 job / verification 的卡住提示。

## 使用方式

```text
/agents
/agents cancel all
```

模型工具路径：

```json
{ "action": "cancel_all" }
```

## 涉及模块

- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/tui-agent-job-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/model-loop-runtime.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/shell/view-model.ts`

## 关键设计

- 可取消 agent 只定义为 `running`，对齐 CCB “stop all only stops running local agents” 的行为边界。
- stale agent 是重启/失联后的历史状态，保留在 `/agents` 供查看或 resume，不再占用后台运行计数和 agent cap。
- terminal agent 不被重新 hydrate 为 background task。
- `isRuntimeActiveBackgroundTask()` 只对 agent 特化：agent 只有 running 才算 active；其它 task 仍沿用 running/stale active 语义。

## 配置项

未新增配置项、依赖或构建脚本。

## 命令

```text
/agents
/agents cancel all
```

## 测试与验证

- `corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/model-loop-runtime.test.ts packages/tui/src/shell/view-model.test.ts -t "AgentControl cancel|cancel all|stop_all|stale agent background|startup hydrate-style|exposes real agent|allows AgentControl|hydratePersistentAgents keeps terminal|Esc stays quiet|background task panel|resource caps"`：PASS，3 files，13 tests passed。
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "CommandProposal fallback|AgentControl cancel|cancel all|stop_all|stale agent background|startup hydrate-style|exposes real agent|hydratePersistentAgents keeps terminal|Esc stays quiet|background task panel|resource caps"`：PASS，1 file，15 tests passed。
- `corepack pnpm typecheck`：PASS。
- `corepack pnpm exec vitest run packages/tui/src/model-loop-runtime.test.ts packages/tui/src/shell/view-model.test.ts`：PASS，2 files，462 tests passed。
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "AgentControl|cancel all|stop_all|background task panel|resource caps|Esc stays quiet|stale background tasks"`：PASS，1 file，10 tests passed。
- `corepack pnpm exec vitest run packages/tui/src/natural-command-bridge.test.ts`：PASS，1 file，160 tests passed。
- `git diff --check`：PASS。
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/model-loop-runtime.test.ts packages/tui/src/shell/view-model.test.ts`：未完成，240s 超时；已用 focused index + full model/shell 覆盖本轮改动。
- `corepack pnpm exec biome check ...`：未通过。主要原因是 `packages/tui/src/index.test.ts` 超过项目 Biome 1.0 MiB 文件大小限制，并暴露 `shell/view-model.test.ts` 既有 noDelete/format 问题；本轮未为通过 Biome 扩大修改范围。

## 独立复检修正

- 复检发现 `cancelled` agent 的 background 曾映射成 `completed/fail`，已修正为 `cancelled/cancelled`，保持 agent-run、background 和 agent_end 一致。
- 复检发现 durable job agent cap 仍使用旧 active 判定，已改为 runtime-active 判定；stale agent 不再压低 agent cap。
- 复检发现 `/background` 和 Esc 空闲判断仍可能受 stale/terminal agent 历史影响，已按 agent-only runtime 口径过滤；非 agent stale 任务继续保持原有可见性。
- 提交前复检发现 CommandProposal fallback 仍把 `/agents ...` 归到 `StartAgent`，已改为 `/fork` 归 `StartAgent`、`/agents` 归 `AgentControl`，避免“停止所有智能体”误纠偏到启动 agent 工具。
- 补充 `AgentControl list`、`stop_all` alias、自然语言“停止所有智能体”、stale agent cap、Esc stale-agent idle 和 `/background` agent history 过滤回归。

## 性能结果

- 新增 active/cancellable 判定均为当前 session 内数组过滤，常数级开销。
- stale agent 不再占用 agent kind cap，避免重启后的历史状态阻塞新 agent。

## 已知问题

- 本轮不恢复 stale agent 的旧模型流；stale agent 仍通过 `/agents resume <id>` 走既有 fresh provider turn。
- `packages/tui/src/index.test.ts` 文件已很大，完整三文件 vitest 在本机 240s 超时；本轮采用 focused index tests 加 full model/shell tests。

## 不在本阶段处理

- 不改 provider/model/key/env route。
- 不改 permission pipeline / Start Gate。
- 不改 durable job / workflow scheduler。
- 不新增 remote agent/team 控制台。

## 下一阶段衔接

下一步如继续 agent lifecycle，可单独做 stale resume/recovery hardening 或拆分超大 `index.test.ts`，但需要用户确认后再开始。

## 开发者排查入口

- `/agents` 与 `/fork`：`packages/tui/src/job-agent-command-runtime.ts`
- Agent active/cancellable 判定：`packages/tui/src/tui-agent-job-runtime.ts`
- AgentControl tool bridge：`packages/tui/src/index.ts`
- Tool schema：`packages/tui/src/model-loop-runtime.ts`
- Footer/background shell summary：`packages/tui/src/shell/view-model.ts`

## 状态栏与统计口径

- footer/background 只计入 runtime-active task。
- agent 只有 `running` 计入 active/cap。
- stale/terminal agent 只在 `/agents` details 中保留，不作为运行中后台任务。

## 学习成本与渐进披露

- 普通入口仍是 `/agents`。
- 批量停止入口为 `/agents cancel all`。
- 自然语言建议已能把“停止所有智能体”映射到 `/agents cancel all`；模型工具可直接调用 `AgentControl cancel_all`。

## TUI 渲染稳定性

- 不新增新的 UI 区块。
- stale agent 不再进入 task runtime summary；stale job 仍保持原有可见提示。
- footer runtime status 不显示 stale agent 的 `stale/resumable`、历史 id 或后台计数。

## 主输出与日志分层

- `/agents` 主屏继续走 CommandPanel summary；完整 agent 列表进入 detailsText。
- `AgentControl list` 的结构化 result 返回可取消 ID/status；不写 raw transcript 或 provider details 到主屏。

## 阶段 Verdict

- verdict：PASS
- 是否允许进入下一阶段：no，需用户确认
- P0/P1/P2 风险分类：独立复检发现的 P1/P2 已当轮修正；剩余 P2 为 `index.test.ts` 超大导致 Biome 单文件检查不可用、完整三文件 vitest 超时，已用 focused/full 组合覆盖本轮行为
- 阻塞项：无本阶段功能阻塞
- 用户下一步审核点或命令：手动试 `/agents`、`/agents cancel all`，或复跑上方 focused tests

## 真实改动文件

- 代码：`packages/tui/src/index.ts`、`packages/tui/src/job-agent-command-runtime.ts`、`packages/tui/src/model-loop-runtime.ts`、`packages/tui/src/natural-command-bridge.ts`、`packages/tui/src/shell/view-model.ts`、`packages/tui/src/tui-agent-job-runtime.ts`
- 测试：`packages/tui/src/index.test.ts`、`packages/tui/src/model-loop-runtime.test.ts`、`packages/tui/src/natural-command-bridge.test.ts`、`packages/tui/src/shell/view-model.test.ts`
- 文档：`docs/delivery/phase-agent-stop-display-closure.md`、`docs/delivery/README.md`
- 生成物：无
- 用户已有 diff / 非本轮证据：根目录 `.md`、`report.md`、`test-model-set.sh`、`docs/stress/` 为开工前未跟踪项，本轮未修改

## 运行时事实

- provider/model：未改 provider/model 配置；测试使用现有 mock gateway
- permission mode：未改四种 permission mode
- index status：codebase-memory MCP 工具本轮不可用，使用 `rg` 和源码精读
- cache/usage 来源：未调用真实 provider，未产生真实账单
- 配置来源：现有 `.linghun/agent-runs`
- 是否有脱敏/密钥风险：无 API key、token、Authorization header、cookie 改动或输出

## 后台/复查任务状态反馈

- running agent 取消后写入 `agent_end`，同步 background task 为 terminal，并持久化 agent status。
- stale/terminal agent 不再参与 background/footer/cap；仍可在 `/agents` 查看。

## 语言与 i18n 口径

- 新增主路径包含 zh-CN/en-US 文案。
- Slash 命令和结构化 tool 字段保持英文。

## 参考核对

- 已读取 Linghun 文档：`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`、`docs/delivery/README.md`、`phase-12-agents.md`、`phase-15-5b-resource-task-lifecycle.md`、`phase-17-agent-workflow-ecosystem-closure.md`、`phase-17a-local-durable-jobs-virtual-agent-concurrency.md`。
- 已精读 Linghun 源码：AgentControl dispatch、`/agents`、agent hydrate/persist、background projection、footer/view-model、resource guard 和相关 tests。
- 已只读参考 CCB：`LocalAgentTask.tsx`、`useCancelRequest.ts`、`BackgroundTasksDialog.tsx`、`taskStatusUtils.tsx`、`PromptInputFooterLeftSide.tsx`、`AgentTool.tsx` 等行为入口。
- 行为参考进入 Linghun 自研实现：running-only stop all、可取消 ID/status、terminal/stale agent 不污染主屏/cap。
- 未复制 CCB 源码、内部 API、专有遥测或可疑实现。

## Source-Level Reality Check

- existing implementation：Linghun 已有 `AgentRun`、`/agents`、AgentControl、background task、agent-runs hydrate、Resource Guard Lite、shell runtime summary。
- gaps：AgentControl 无 cancel_all/stop_all；list 未返回可取消 IDs/status；stale agent hydrate 后进入 background/footer/cap；`/agents` 无 batch cancel 入口。
- minimal touch points：只补 agent runtime helper、AgentControl schema/dispatch、`/agents` action、shell summary filter、focused tests 和交付文档。
- forbidden duplicate systems：未新增第二套 agent scheduler、job runtime、provider gateway、permission pipeline、background table 或 workflow system。

## 交接摘要

- 下一阶段：用户确认后再处理 stale resume/recovery hardening 或测试拆分。
- 禁止事项：不要自动进入下一阶段；不要改 provider/model/key/env route；不要把 stale agent 重新计入 footer/background/cap。
- 证据引用：本报告“测试与验证”命令；`packages/tui/src/index.test.ts` 新增 AgentControl list/cancel_all/stop_all、`/agents cancel all`、stale cap/background/Esc 回归；`natural-command-bridge.test.ts` 新增“停止所有智能体”映射回归。
- 验证结果：focused agent/model/shell PASS，CommandProposal fallback PASS，natural command PASS，typecheck PASS，model/shell full PASS，`git diff --check` PASS；三文件 full vitest 超时；Biome 因既有文件大小/旧 lint 问题未通过。
- 索引状态：codebase-memory MCP 不可用，使用 `rg`/源码精读。
- 权限模式：未修改。
- 模型/provider：未修改。
- 预算使用情况：本地测试，无真实 provider usage。
