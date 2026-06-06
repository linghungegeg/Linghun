# Phase E Self-Audit Test Coverage

## 阶段目标

按 `LINGHUN_DEVELOPMENT_ROADMAP.md` Phase E 为 20 个关键运行时补可执行测试覆盖。目标是源码级闭环，不把历史 `index.test.ts` 的局部覆盖当作全局成熟，也不通过字符串扫描替代可运行路径。

## 文档事实核对

本阶段实际读取并遵守：

- `F:\Linghun\LINGHUN_DEVELOPMENT_ROADMAP.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-d-ccb-p1-tools-commands-token.md`

codebase-memory MCP 工具本轮不可用；使用 `rg`、源码精读和可执行测试完成 source-level reality check。未复制 CCB 或其他可疑源码。

## 已完成功能

新增三组 Phase E focused tests：

- `packages/tui/src/phase-e-runtime-coverage.test.ts`
- `packages/tui/src/phase-e-stateful-runtime-coverage.test.ts`
- `packages/tui/src/phase-e-mainchain-coverage.test.ts`

覆盖范围：

- `model-stream-runtime.ts`：stream delta、thinking、usage、message_stop、tool_use、error、abort。
- `model-tool-runtime.ts`：deferred dispatch、builtin、index tool、7 个 Linghun control tool 分支。
- `job-agent-command-runtime.ts`：`runModelBackedAgent` 完成、tool loop 阻断、mailbox 消费。
- `slash-command-runtime.ts`：10 个常用 slash command 路由入口。
- `workflow-command-runtime.ts`：main-chain details/agents/workflows/verification/job/fork blocked/unsupported，registry unknown action。
- `permission-approval-runtime.ts`：11 种 `executePermissionApprove` pending kind。
- `permission-policy-engine.ts` + `tui-permission-runtime.ts`：auto_allow_readonly、require_permission、hard deny。
- `request-lifecycle-presenter.ts`：15 种 provider failure 分类。
- `mcp-stdio-runtime.ts`：正常、tool-not-found、timeout、spawn error。
- `compact-preflight-runtime.ts`、`deep-compact-runtime.ts`、`compact-cache-command-runtime.ts`、`break-cache-runtime.ts`、`handoff-session-runtime.ts`。
- `remote-inbound-bridge-runtime.ts`、`evidence-runtime.ts`、`cache-command-runtime.ts`、`natural-command-bridge.ts`、`connector-runtime.ts`（保留既有 robust tests 并纳入验证口径）、`index-result-presenter.ts`。

## 源码级修复

测试暴露并修复了一个真实分类缺口：

- `packages/tui/src/request-lifecycle-presenter.ts`
  - `classifyProviderFailure()` 现在能从普通对象错误 `{ message: "..." }` 读取 `message`，避免落成 `[object Object]` 后误判 generic。

为测试可达性新增两个 test-only export，无运行时行为变化：

- `packages/tui/src/workflow-command-runtime.ts`
  - `__testExecuteRegistryWorkflowStep()`
  - `__testExecuteWorkflowStep()`

## 使用方式

开发者可运行 Phase E 聚焦测试：

```powershell
corepack pnpm exec vitest run packages/tui/src/phase-e-runtime-coverage.test.ts packages/tui/src/phase-e-stateful-runtime-coverage.test.ts packages/tui/src/phase-e-mainchain-coverage.test.ts
```

## 涉及模块

- `packages/tui/src/phase-e-runtime-coverage.test.ts`
- `packages/tui/src/phase-e-stateful-runtime-coverage.test.ts`
- `packages/tui/src/phase-e-mainchain-coverage.test.ts`
- `packages/tui/src/request-lifecycle-presenter.ts`
- `packages/tui/src/workflow-command-runtime.ts`

## 关键设计

- 不继续扩大 `index.test.ts`，避免单文件测试继续膨胀。
- 状态型 runtime 用独立 focused tests；模型/工具/权限/workflow/job 主链用轻量 fake gateway 和临时 `SessionStore` 驱动真实导出入口。
- 对会触发真实长任务、索引刷新或外部环境的分支，优先覆盖解析失败/只读/轻量失败路径，避免测试变成环境依赖。

## 配置项

本阶段不新增配置项、不改依赖、不改构建脚本。

## 命令

本阶段不新增用户命令。

## 测试与验证

已通过：

```powershell
corepack pnpm exec vitest run packages/tui/src/phase-e-mainchain-coverage.test.ts
```

结果：7 tests PASS。

```powershell
corepack pnpm exec vitest run packages/tui/src/phase-e-runtime-coverage.test.ts packages/tui/src/phase-e-stateful-runtime-coverage.test.ts packages/tui/src/phase-e-mainchain-coverage.test.ts
```

结果：33 tests PASS。

```powershell
corepack pnpm exec tsc -b tsconfig.json --pretty false
```

结果：PASS。

## 性能结果

测试使用临时目录、mock gateway、mock MCP stdio server 和轻量 fake deps；不会启动真实 provider、不会重建索引、不会联网安装依赖。

## 已知问题

- Phase E 是 focused coverage，不等于全量 `vitest run` 已执行。
- `connector-runtime.ts` 主要由既有 `connector-runtime.test.ts` 覆盖，本阶段没有重复新增同类测试文件。
- 工作区存在本阶段外预先 dirty/untracked 文件，未触碰、未回滚。

## 不在本阶段处理的内容

- 不实现 Phase F Provider/权限/MCP 能力。
- 不实现 Phase G remote/feature flag/memory/keybinding 能力。
- 不做大文件拆分或测试架构重写。

## 下一阶段衔接

下一阶段：Phase F。重点是 Provider 合约化、权限系统补齐和 MCP 升级。不得用 Phase E 的测试覆盖替代 Phase F 的功能闭环。

## 开发者排查入口

- Stream 主链：`packages/tui/src/model-stream-runtime.ts`
- Tool 分派：`packages/tui/src/model-tool-runtime.ts`
- Agent loop：`packages/tui/src/job-agent-command-runtime.ts`
- Workflow step：`packages/tui/src/workflow-command-runtime.ts`
- 权限 approve：`packages/tui/src/permission-approval-runtime.ts`
- Provider failure：`packages/tui/src/request-lifecycle-presenter.ts`

## 参考核对

本阶段实际读取 Linghun 文档见“文档事实核对”。未读取或复制 `F:\ccb-source` 源码；未复制内部 API、专有遥测、反编译痕迹或可疑实现。

## Handoff Packet

- 当前阶段：Phase E Self-Audit Test Coverage
- 状态：DONE，继续进入用户已明确要求的 Phase F
- 下一阶段：Phase F CCB P2 Provider / Permissions / MCP
- 禁止事项：不得把 focused coverage 当作全量成熟；不得跳过 Phase F 功能闭环；不得复制 CCB 可疑源码
- 证据引用：本文件“测试与验证”；`LINGHUN_DEVELOPMENT_ROADMAP.md` Phase E
- 验证结果：Phase E focused tests PASS；typecheck PASS
- 索引状态：codebase-memory MCP 不可用；使用 `rg`/源码事实核对
- 权限模式：本地 unrestricted filesystem；未执行依赖变更、发布或远程部署
- 模型/provider：Codex 本地开发会话；未调用 Linghun runtime provider
- 预算使用情况：未设置显式 token 预算
