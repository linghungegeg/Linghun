# Runtime Regression Closure - 2026-06-08

## 阶段目标

按桌面 `1.txt` 的最新实测反馈，最小修复 workflow/job/agent/tool/shell 仍未闭合的回归问题。不开新阶段功能，不重构，不新增复杂 intent router，不降级 agent/workflow 能力。

## 已完成功能

- `RunWorkflow` model-facing 结果优先显示真实 blocked/failed/stale/cancelled/running step，不再由 queued `Verify result` 抢占当前阶段。
- 审计、调查、定位、检查、复核类目标默认 readonly；只有明确修复、修改、实现、提交、写入、编辑等实现意图时才生成 implement/durable job slice。
- `Todo add` 忽略模型自带 `id`，由 runtime 生成数字 id，并在 tool_result 中明确返回 `Todo created: id=<runtime id>`。
- Agent 子循环对普通工具错误回灌 `tool_result isError=true` 后继续下一轮，让模型自恢复；只有权限等待、provider/cooldown、预算/回合耗尽等终止条件才 blocked。
- Read glob-like path / missing file 仍按 Read 单文件语义失败，但失败作为 agent tool error 返回模型，不直接升级 durable job/workflow blocked。
- Workflow/background/runtime status 进度不再裸显示 `3/5`，改为带语境的 `workflow 3/5` / `<label> n/m`。
- SGR wheel 默认启用，Composer 只消费 wheel 事件；不启用 drag tracking，不恢复 app 左键复制，左键拖选仍交给原生终端。
- `key.shift && key.return` 明确插入 newline，不提交。

## 使用方式

- 实测入口保持：`set "LINGHUN_CLI=F:\Linghun\apps\cli\dist\main.js"`
- 普通使用仍为 `linghun` / `Linghun` 入口。
- Read 仍只读单文件；批量匹配继续使用 Glob/Grep。
- Todo 后续 `start/done/block` 必须使用 runtime 返回的真实 id。

## 涉及模块

- `packages/tools/src/index.ts`
- `packages/tui/src/workflow-planner-entry.ts`
- `packages/tui/src/model-tool-runtime.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/job-runner-presenter.ts`
- `packages/tui/src/runtime-status-snapshot.ts`
- `packages/tui/src/shell/terminal-interaction-runtime.ts`
- `packages/tui/src/shell/models/terminal-input-runtime.ts`

## 关键设计

- 工具边界保持简单：Read 不展开 glob，Glob/Grep 独立负责匹配。
- Runtime 返回真实结果：Todo id 由 runtime 生成并显式回传。
- 可恢复工具误用只进入模型自恢复循环，不直接判 job/workflow blocked。
- Planner 只补现有 readonly 判定漏项；没有新增复杂 intent router。
- Mouse 只启用 button/wheel SGR，不启用 drag tracking，避免抢左键原生选择。

## 配置项

- 无新增配置项。
- 无依赖、provider、模型、权限模式或构建脚本变更。

## 命令

- `linghun`
- Windows 兼容入口：`Linghun`
- 实测入口：`set "LINGHUN_CLI=F:\Linghun\apps\cli\dist\main.js"`

## 测试与验证

已运行：

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm vitest run packages/tools/src/index.test.ts packages/tui/src/workflow-planner-entry.test.ts packages/tui/src/shell/models/terminal-input-runtime.test.ts packages/tui/src/shell/terminal-interaction-runtime.test.ts packages/tui/src/runtime-status-snapshot.test.ts packages/tui/src/job-runner-presenter.test.ts packages/tui/src/phase-e-mainchain-coverage.test.ts` | PASS，120 tests |
| `corepack pnpm vitest run packages/tui/src/workflow-planner-entry.test.ts packages/tui/src/workflow-task-surface.test.ts packages/tui/src/workflow-agent-runtime-bridge.test.ts packages/tui/src/phase-e-mainchain-coverage.test.ts packages/tui/src/job-runtime.test.ts packages/tui/src/job-runner-presenter.test.ts packages/tui/src/shell/view-model.test.ts packages/tui/src/shell/terminal-interaction-runtime.test.ts packages/tui/src/shell/models/terminal-input-runtime.test.ts packages/tui/src/shell/ink-interaction-smoke.test.ts packages/tui/src/runtime-status-snapshot.test.ts` | PASS，538 tests |
| `corepack pnpm exec tsc --noEmit` | PASS |
| `corepack pnpm build` | PASS |

`F:\Linghun\apps\cli\dist\main.js` 已更新：2026-06-08 16:46:29 +08:00，长度 19129 bytes。

## 性能结果

- 本轮未运行 benchmark。
- Agent tool error 自恢复可能多消耗一轮 agent child model turn，但避免可恢复工具误用直接阻断 durable job/workflow。
- Mouse 只启用 SGR button/wheel tracking，不启用 drag tracking；无新增后台任务或 provider 调用。

## 已知问题

- 本轮验证为 local/focused + build，不等于真实 full smoke、Beta PASS、smoke-ready 或 open-source-ready。
- codebase-memory MCP 工具本轮未暴露，源码事实通过 `rg`、精读关键源码和两个只读子智能体调查确认。
- `WHITEPAPER.zip` 是既有未跟踪文件，本轮未触碰且不会提交。

## 不在本阶段处理的内容

- 不重做已由 `605503a1` 和 `f2b0eeff` 闭合的面板顶栏/旧 workflow job 阻塞问题；本轮只做回归验证相关覆盖。
- 不新增复杂 intent router。
- 不新增 alias 映射 Todo id。
- 不实现 Read 自动 glob 展开。
- 不恢复 app 左键复制。
- 不进入桌面端、remote channels、native runner 或真实 full smoke。

## 下一阶段衔接

下一步只能由用户决定是否继续真实项目 full smoke。若继续，优先用 `F:\Linghun\apps\cli\dist\main.js` 对桌面 `1.txt` 中 7 个点做真实 TUI 复测，不要用局部测试 PASS 宣称整体成熟。

## 开发者排查入口

- Workflow display / RunWorkflow：`packages/tui/src/model-tool-runtime.ts`
- Workflow planner readonly 判定：`packages/tui/src/workflow-planner-entry.ts`
- Agent child tool loop：`packages/tui/src/job-agent-command-runtime.ts`
- Todo runtime contract：`packages/tools/src/index.ts`
- Progress display：`packages/tui/src/job-runner-presenter.ts`、`packages/tui/src/runtime-status-snapshot.ts`
- Shell wheel / Shift+Enter：`packages/tui/src/shell/terminal-interaction-runtime.ts`、`packages/tui/src/shell/models/terminal-input-runtime.ts`、`packages/tui/src/shell/components/Composer.tsx`

## 参考核对

实际读取的 Linghun 文档：

- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- 已完成阶段交付记录中与 Phase 7.18.1、Closure Phase 6、agent/job/workflow/shell 相关条目

实际参考的本地 CCB / CCB Dev Boost / 社区项目文件：

- 用户提供的 CCB 参考路径用于行为核对：`F:\ccb-source\packages\builtin-tools\src\tools\TaskCreateTool\TaskCreateTool.ts`
- 用户提供的 CCB Read/Glob/Grep/toolErrors 参考路径用于边界核对：`F:\ccb-source\packages\builtin-tools\src\tools\FileReadTool\prompt.ts`、`F:\ccb-source\packages\builtin-tools\src\tools\FileReadTool\FileReadTool.ts`、`F:\ccb-source\packages\builtin-tools\src\tools\GlobTool\GlobTool.ts`、`F:\ccb-source\packages\builtin-tools\src\tools\GrepTool\GrepTool.ts`、`F:\ccb-source\src\utils\toolErrors.ts`
- 本轮仅参考行为边界：runtime 生成任务 id、tool_result 明确返回真实 id、Read/Glob/Grep 分离、普通工具错误回模型恢复。
- 未复制 CCB 源码、内部 API、专有遥测或内部服务逻辑。

## 成品级结构化 handoff packet

- 下一阶段：等待用户确认真实 TUI/full smoke。
- 禁止事项：不要恢复 queued verify 抢当前阶段；不要让 readonly 审计默认进 durable implement job；不要实现 Todo alias；不要让 Read 自动 glob；不要把普通工具错误直接升级 job/workflow blocked；不要启用 mouse drag tracking 抢左键选择。
- 证据引用：本文件“测试与验证”；源码入口见“开发者排查入口”。
- 验证结果：focused tests 120/120 PASS；相关扩展 tests 538/538 PASS；typecheck PASS；build PASS。
- 索引状态：codebase-memory MCP 未暴露；使用 `rg` / 精读源码 / 子智能体只读调查。
- 权限模式：未变更。
- 模型/provider：未调用 live provider；测试使用本地 fixture/mock gateway。
- 预算使用：无外部 provider 预算；本地 shell/vitest/typecheck/build。
