# Phase 7.18.1 Terminal / Multi-Agent Source Repair

## 阶段目标

本轮按用户明确要求做不降级源码级修复，只收口终端可见层、多智能体 running cap、background 行清理、footer 金额、Ctrl+O details、final answer 可见性相关问题。不开 vision/image、权限模式 parity、桌面端、真实 full smoke 或新调度器。

## 已完成功能

- Job / workflow running cap 不再使用用户可见默认 3/4，并按 CCB 行为参考移除 hidden fixed 20 agent cap；创建时按 explicit running cap / requested agents 派生，并受 resource guard 动态裁剪。
- Resource guard 不再把 agent/job 计入普通后台全局 cap 或 heavy mutex；保留 bash / verification / index 的 kind cap。
- `/fork` 不再因为已有 3 个 running agent 直接拒绝。
- `/background clear|dismiss <id>` 新增非 running 行清理；running 行必须 stop/cancel；command panel 的 `x` 对 running agent/job/ordinary task 仍走 cancel/abort，对 terminal 行走 dismiss。
- Footer view 不再把金额放进主 footer；`formatFooterCostLabel()` 保留给 `/usage` / `/stats` 等详情口径。
- Ctrl+O 优先展开当前 command panel details；没有可展开内容时不再制造假反馈。
- Final answer 增加 `verifying_final_answer` 活动状态；有工具路径和 supportsTools=false 纯文本 provider 路径都先缓冲最终回答，经过 final gate / coherence / sanitizer 后一次性提交，避免 gate 前草稿进入 Ink preview。

## 使用方式

- `/job run <goal> --multi-agent --agents <n> [--running-cap <n>]`
- `/workflows run <goal>` 或模型 RunWorkflow 输入 `agents` / `runningCap`
- `/background`
- `/background dismiss <id>` 或 `/background clear <id>`
- Command panel 中选择后台行后按 `x`
- Ctrl+O 展开当前 command panel details 或最新可展开 block

## 涉及模块

- `packages/tui/src/job-runtime.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/background-control-runtime.ts`
- `packages/tui/src/tui-context-runtime.ts`
- `packages/tui/src/workflow-plan-schema.ts`
- `packages/tui/src/workflow-planner-entry.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/request-lifecycle-presenter.ts`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/shell/components/CommandPanel.tsx`
- `packages/tui/src/shell/models/footer-view.ts`

## 关键设计

- `agents` 是 requested worker count，不再暗含用户可见固定 3 个 running。
- `runningCap` 是 requested/explicit runtime cap；真实可运行数量还要扣除同类 running agent 并受 resource guard 约束。
- Background clear/dismiss 是 visible-only 行清理，不删除 transcript/log/job state；running task 必须 cancel/stop。
- Final answer 的主屏可见文本只承认 gate 后文本；tool-use 前的说明仍可在出现 tool call 时显示。

## 配置项

- 无新增配置项。
- 无 provider/env/key 变更。
- 无 permission mode 变更。
- 无依赖或构建脚本变更。

## 命令

本轮未新增 CLI 启动入口；`linghun` / Windows `Linghun` 入口兼容性不在本轮范围。

## 测试与验证

已运行：

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui exec tsc --noEmit --pretty false` | PASS |
| `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "no-tool provider final answer|background dismiss|resource caps|CommandPanel x|final answer is corrected" --no-color` | PASS，11 tests |
| `corepack pnpm --filter @linghun/tui exec vitest run src/shell/models/footer-view.test.ts src/workflow-agent-runtime-bridge.test.ts src/workflow-plan-schema.test.ts --no-color` | PASS，58 tests |
| `corepack pnpm --filter @linghun/tui exec vitest run src/shell/view-model.test.ts -t "final answer verification|CommandPanel 只有存在 detailsText|Ctrl\+O 展开态" --no-color` | PASS，3 selected |
| `corepack pnpm --filter @linghun/tui typecheck` | PASS |
| `corepack pnpm --filter @linghun/tui exec vitest run src/job-runtime.test.ts src/workflow-plan-schema.test.ts src/workflow-agent-runtime-bridge.test.ts --no-color` | PASS，99 tests |
| `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "does not fake-complete Phase 17A durable jobs\|runs /job --multi-agent --agents 6\|stale agent/job background history does not reduce durable job running cap\|does not let a workflow-owned running agent heavy guard block another agent\|D.14C: agent command runtime owns lifecycle" --no-color` | PASS，4 selected |
| `corepack pnpm --filter @linghun/tui exec vitest run src/shell/view-model.test.ts src/shell/ink-interaction-smoke.test.ts src/shell/terminal-interaction-runtime.test.ts src/shell/models/tui-interaction-contract.test.ts src/index.test.ts --no-color` | PASS，1062 tests |
| `corepack pnpm --filter @linghun/tui build` | PASS |
| `git diff --check` | PASS |

## 性能结果

- 本轮未运行 benchmark。
- Running agent cap 不再受 hidden fixed 20 保护；高并发由 requested/explicit cap、resource guard、预算和验证边界共同约束。
- Footer 主屏少渲染金额文本；无可量化性能声明。
- Final answer buffering 只在单轮文本内存中缓存草稿，无新增持久化成本。

## 已知问题

- 历史 Phase 11/12/coverage checklist 中仍有“默认最多 3 个 agent”或旧 hidden cap 口径；本轮不大范围重写历史文档，当前交付文档和 README/Phase 17A/Phase 04 已明确 supersede。
- 当前验证为 focused/local，不是真实 provider full-chain smoke。
- codebase-memory MCP 工具本轮未暴露，源码事实通过 `rg` 与精读关键源码确认。

## 不在本阶段处理的内容

- Vision/image。
- Permission-mode parity with CCB。
- 新 scheduler / 新 agent runtime / 新 terminal renderer。
- Native runner、desktop、remote channels。
- 真实 full smoke、Beta PASS、smoke-ready、open-source-ready 宣告。

## 下一阶段衔接

下一步必须先完成本轮最终验证并停下等待用户确认。不得自动进入 Phase 18 或新增功能阶段。若继续同一成熟度方向，优先处理真实 provider full-chain stress，而不是再增加新抽象。

## 开发者排查入口

- Cap：`packages/tui/src/job-runtime.ts`、`packages/tui/src/job-agent-command-runtime.ts`、`packages/tui/src/workflow-plan-schema.ts`
- Background：`packages/tui/src/background-control-runtime.ts`、`packages/tui/src/job-agent-command-runtime.ts`
- Final answer：`packages/tui/src/model-stream-runtime.ts`、`packages/tui/src/request-lifecycle-presenter.ts`、`packages/tui/src/shell/view-model.ts`
- Footer：`packages/tui/src/shell/models/footer-view.ts`
- Tests：`packages/tui/src/index.test.ts`、`packages/tui/src/shell/view-model.test.ts`、`packages/tui/src/shell/models/footer-view.test.ts`

## 参考核对

实际读取的 Linghun 文档：

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-17a-local-durable-jobs-virtual-agent-concurrency.md`
- `docs/delivery/phase-04-workflow-multi-agent-scheduler-closure.md`
- 已完成阶段文档中与 footer cost、final gate、visible streaming、agent stop/display、workflow/job cap 相关条目

实际参考的本地 CCB / CCB Dev Boost / 社区项目文件：

- `F:\ccb-source\packages\builtin-tools\src\tools\AgentTool\AgentTool.tsx`
- `F:\ccb-source\packages\builtin-tools\src\tools\AgentTool\agentToolUtils.ts`
- `F:\ccb-source\packages\builtin-tools\src\tools\AgentTool\prompt.ts`
- `F:\ccb-source\src\utils\task\framework.ts`
- CCB 行为参考结论：未发现类似 Linghun hidden fixed `MAX_AGENTS=20` 的 agent 数量硬顶；边界主要来自 run_in_background/feature gate、fork recursion guard、in-process teammate lifecycle、async/background tool allowlist、task lifecycle、权限和资源状态。
- Linghun 自研实现只吸收行为边界：移除固定 20 agent cap，保留 requested/explicit cap、resource guard、bash/verification/index 并发保护和 no-PASS evidence 边界；未复制 CCB 源码、内部 API、专有遥测或内部服务逻辑。

裁决：

- DONE：用户可见默认 3/4 cap 和 hidden fixed 20 agent cap 移除；job/workflow cap 动态化；background terminal row dismiss；footer 主屏金额隐藏；Ctrl+O 当前 panel details；final answer gate 前不显示草稿。
- DEFERRED：真实 provider full-chain stress、历史文档 search-clean、native runner 深集成。
- NOT-DO：vision/image、权限模式 parity、新 scheduler、桌面端。

## 成品级结构化 handoff packet

- 下一阶段：等待用户确认；建议先做本轮最终验证复核，不自动进入 Phase 18。
- 禁止事项：不要恢复默认 3/4 cap 或 hidden fixed 20 agent cap；不要新增第二套 scheduler/agent runtime；不要把 job/workflow completed 当 PASS evidence；不要复制 CCB 源码。
- 证据引用：`packages/tui/src/job-runtime.ts`、`packages/tui/src/job-agent-command-runtime.ts`、`packages/tui/src/background-control-runtime.ts`、`packages/tui/src/model-stream-runtime.ts`、`packages/tui/src/shell/models/footer-view.ts`、`packages/tui/src/index.test.ts`。
- 验证结果：见“测试与验证”；最终收口验证已通过。
- 索引状态：外部 codebase-memory MCP 未暴露；使用 `rg` / 精读源码确认。
- 权限模式：本轮未变更 permission mode。
- 模型/provider：本地测试 fixture 使用 `deepseek-v4-flash`；未调用 live provider。
- 预算使用：无外部 provider 预算；本地 shell/vitest/typecheck 验证。
