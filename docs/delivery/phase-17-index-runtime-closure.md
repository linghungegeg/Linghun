# Phase 17 Index Runtime Closure

## 阶段目标

修复 Linghun 运行时索引状态没有闭环的问题，让会话启动、恢复、handoff、agent context、workflow planner 和模型 RuntimeStatus 共享同一份真实 index state。索引不可用时明确降级为 disabled / missing / stale / error / unknown-project，避免 `index=undefined:unknown` 和 `index:unknown-project: status=unknown` 这类不成熟状态。

## Source-Level Reality Check

- 读取文档：`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`、`docs/delivery/README.md`、`phase-10-mcp-index.md`、`phase-11-sessions-memory.md`、`phase-12-agents.md`、`phase-14-skills-workflow.md`、`phase-15-5a-performance-context.md`、`phase-15-5c-editing-tool-ux.md`、`phase-17-agent-workflow-ecosystem-closure.md`。
- 源码事实：`createIndexState()` 只给启用索引设置 `status="unknown"`；`/index status` 才调用 `refreshIndexStatus()`；handoff / agent / workflow 直接消费当时的 `context.index` 或旧 `packet.indexStatus`。
- 直接泄漏点：`createAgentContextSummary()` 曾拼 `index=${packet.indexStatus.projectName}:${packet.indexStatus.status}`，旧 packet 或未刷新状态会输出 `index=undefined:unknown`。
- 相关泄漏点：Architecture Runtime 曾用 `unknown-project` 作为缺省项目名，导致 `index:unknown-project: status=unknown` 像真实项目事实。
- 本地 artifact 事实：`.codebase-memory/graph.db.zst` 和 `.codebase-memory/artifact.json` 存在时，旧 runtime 没有直接读取；`artifactStatus` 主要依赖 codebase-memory CLI 的 `list_projects` / `index_status` 间接推导。

## 已完成功能

- `IndexState` 增加明确状态：`disabled`、`unknown-project`，并补齐 artifact `disabled` 状态。
- 新增统一入口：
  - `readLocalIndexArtifactState()` 读取 `.codebase-memory/graph.db.zst` 和 `artifact.json`。
  - `createIndexStatusSnapshot()` 生成 handoff/agent/job 共享的短状态。
  - `formatIndexRuntimeRef()` 统一输出 `project:status nodes=... edges=...`。
- `refreshIndexStatus()` 先读取本地 artifact，再读取 codebase-memory CLI fast status；CLI 不可用但 artifact 存在时降级为 `unknown-project`，artifact 损坏时为 `error`。
- TUI 启动后先执行一次只读 fast index status refresh，再 hydrate durable job / agent / handoff 相关上下文。
- RuntimeStatusForModel 和 prompt projection 增加 `index.projectName`，让模型知道真实索引项目和状态。
- handoff、resume 摘要、agent context、job preflight、deep compact、workflow planner 和 Architecture Runtime 改为消费统一 index state。

## 使用方式

- 查看状态：`/index status`
- 新鲜度检查：`/index status --fresh` 或 `/index check`
- 建立索引：`/index init fast`
- 刷新索引：`/index refresh`
- agent / workflow / handoff 不需要额外命令，会话启动后会读取同一份 fast index state。

## 涉及模块

- `packages/tui/src/index-runtime.ts`
- `packages/tui/src/mcp-index-runtime.ts`
- `packages/tui/src/handoff-session-runtime.ts`
- `packages/tui/src/tui-agent-job-runtime.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/deep-compact-runtime.ts`
- `packages/tui/src/architecture-runtime.ts`
- `packages/tui/src/workflow-planner-entry.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/model-loop-runtime.ts`
- `packages/tui/src/index.ts`

## 关键设计

- 不新增第二套索引引擎，只读取已有 codebase-memory 本地 artifact 和已有 CLI fast status。
- `/index status` 默认仍不运行 `detect_changes`，只在 `--fresh` / `/index check` 才做慢检查。
- `unknown-project` 表示本地 artifact 存在但 CLI 项目匹配失败；它不是 ready，也不是 missing。
- `disabled` 表示 settings 关闭索引；不会显示成 missing。
- handoff 和 agent context 只包含短摘要，不包含完整 index、完整源码或大日志。

## 配置项

- `.linghun/settings.json`：
  - `index.enabled`
  - `index.mode`
  - `mcp.enabledServers`
  - `mcp.servers.codebase-memory.command`

## 命令

- `corepack pnpm exec vitest run packages/tui/src/mcp-index-runtime.test.ts packages/tui/src/workflow-agent-runtime-bridge.test.ts packages/tui/src/index.test.ts -t "refreshIndexStatus|index project|workflow plan preview|agent context summary"`
- `corepack pnpm exec vitest run packages/tui/src/mcp-index-runtime.test.ts packages/tui/src/workflow-agent-runtime-bridge.test.ts packages/tui/src/index.test.ts -t "codebase-memory|index status|handoff|workflow|agent context|refreshIndexStatus"`
- `corepack pnpm typecheck`
- `git diff --check`

## 测试与验证

- focused index closure vitest：PASS，7 passed。
- related index/handoff/workflow/agent vitest：PASS，78 passed。
- `corepack pnpm typecheck`：PASS。
- `git diff --check`：PASS。

## 性能结果

- 会话启动新增的是 fast/local index status 读取：本地 artifact stat/read + codebase-memory `list_projects` / `index_status`。
- 没有自动 `detect_changes`，没有自动 rebuild，避免启动时慢扫或重索引。

## 已知问题

- `unknown-project` 需要用户通过 `/index status --fresh` 或 `/index refresh` 重新绑定项目；本阶段不自动修复项目名映射。
- 若 codebase-memory CLI 行为变化导致 `list_projects` 输出结构改变，Linghun 会降级为 `error` 或 `unknown-project`，不会声称 ready。

## 不在本阶段处理

- 不自研代码图索引。
- 不自动全量重建索引。
- 不引入后台常驻 watcher。
- 不改 remote channel、provider、权限模式或 job scheduler 架构。

## 下一阶段衔接

- 后续可在 Project Doctor / Context Picker 中复用同一 `IndexState` 展示更细的修复建议。
- Phase 17A/17C 若继续强化 durable job / native runner，可直接消费 `createIndexStatusSnapshot()`。

## 开发者排查入口

- 状态解析：`packages/tui/src/mcp-index-runtime.ts` 的 `refreshIndexStatus()`。
- 本地 artifact 解析：`packages/tui/src/index-runtime.ts` 的 `readLocalIndexArtifactState()`。
- agent context：`packages/tui/src/tui-agent-job-runtime.ts` 的 `createAgentContextSummary()`。
- handoff packet：`packages/tui/src/handoff-session-runtime.ts` 的 `createHandoffPacket()`。
- workflow context：`packages/tui/src/workflow-planner-entry.ts`。

## 参考核对

- Linghun 文档：读取了阶段蓝图、规格书、最终架构路线图、delivery README 和 Phase 10/11/12/14/15.5A/15.5C/17 agent-workflow 交付文档。
- CCB / CCB Dev Boost 参考：查看了 `F:\ccb-source\README.md`、`README_EN.md`、`docs/ccb-optimizations.md` 中 codebase-memory resolution、索引状态、过期索引和大文件保护的行为边界。
- 进入 Linghun 自研实现的内容：只采用“索引状态清晰、失败可降级、模型先用索引再读源码确认”的产品边界。
- 未复制 CCB、codebase-memory-mcp 或其他第三方可疑源码实现、内部 API、专有遥测或内部服务逻辑。

## Handoff Packet

- 当前阶段：Index Runtime Closure。
- 下一阶段：等待用户确认是否提交稳定点，或继续后续 Phase 17A/17C 相关成熟化。
- 禁止事项：不得把 `unknown-project` 当 ready；不得自动 rebuild；不得把完整 index 注入 prompt；不得触碰无关未跟踪文件。
- 证据引用：`mcp-index-runtime.test.ts`、`workflow-agent-runtime-bridge.test.ts`、`index.test.ts` 新增回归。
- 验证结果：focused vitest PASS；相关 vitest PASS；typecheck PASS；diff check PASS。
- 索引状态：本仓库 `.codebase-memory/graph.db.zst` 与 `artifact.json` 存在，artifact project 为 `F-Linghun`，nodes=295，edges=292；runtime 通过新逻辑读取本地 artifact，CLI fast status 可进一步确认 ready/stale。
- 权限模式：本地开发默认权限；无远程执行、无依赖变更、无数据迁移。
- 模型/provider：本次由 Codex 执行；未调用外部 provider 运行 Linghun 产品模型链路。
- 预算使用情况：本地验证为主，无额外 provider 预算记录。
