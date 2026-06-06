# Phase 7.16.1 StartAgent Anthropic Continuation Hotfix

## 阶段目标

修复 Phase 7.16 稳定点后发现的 StartAgent Anthropic continuation 测试预期错位，并完成 `tool-result-budget.ts` 的 Biome 最小格式修复。

本阶段不进入新功能、不处理 DH1-DH4、不运行真实 provider 重压、不 stage、不 commit。

## 已完成功能

- 源码确认 3 次 provider 请求是正确主链：
  1. 父主模型首轮发出 `StartAgent` tool_use。
  2. StartAgent 启动子 agent sidechain provider 请求。
  3. 父主模型收到 StartAgent tool_result 后继续生成最终文本。
- 调整 StartAgent continuation 测试断言，避免把第 2 次 child request 误判为父主模型 continuation。
- 修复 `packages/tui/src/tool-result-budget.ts` 中 `stateKey` 三元表达式的 Biome 格式。

## 使用方式

用户无需新增命令。该 hotfix 只影响本地测试断言和格式输出，不改变产品运行逻辑。

## 涉及模块

- `packages/tui/src/index.test.ts`
- `packages/tui/src/tool-result-budget.ts`

## 关键设计

- 不改产品逻辑：源码确认 3 次请求不是重复、死循环或多余请求。
- 第 2 次请求是 child agent 初始请求；当前 mock 中 child provider 直接返回最终文本，因此 child request 本身没有 child tool_result。
- StartAgent 对应的 tool_result 必须出现在第 3 次父主模型 continuation 中，并与 `toolu_start_budget_1` 配对。
- 大输出预算边界仍要求不把 `<persisted-tool-result>` 或 `AGENT_BUDGET_END_SHOULD_NOT_REACH_PROVIDER` 泄漏给父主模型 continuation。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

已通过：

- `corepack pnpm exec biome check packages/tui/src/tool-result-budget.ts packages/tui/src/index.test.ts`
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "keeps StartAgent tool_result paired without breaking Claude anthropic_messages continuation" --no-color`
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "StartAgent|tool_result|anthropic_messages|provider preflight compact|budget|agent|workflow|completed|failed|PASS" --no-color`
- `corepack pnpm exec vitest run packages/tui/src/tool-result-budget.test.ts packages/tui/src/model-loop-runtime.test.ts packages/tui/src/provider-transit-failure.test.ts --no-color`
- `corepack pnpm --filter @linghun/tui typecheck`
- `corepack pnpm --filter @linghun/tui build`
- `corepack pnpm --filter @linghun/cli build`
- `node F:\Linghun\apps\cli\dist\main.js --version`
- `node F:\Linghun\apps\cli\dist\main.js --help`
- `git diff --check`

## 性能结果

无新增模型调用、后台任务、缓存 key、provider 路由或 runtime 分支。

## 已知问题

- 本阶段未处理 DH1-DH4。
- 本阶段未运行真实 provider full-chain stress。

## 不在本阶段处理的内容

- 不进入新功能。
- 不处理 `WHITEPAPER*.md`、`docs/stress`、`img`、`report.md`、`test-model-set.sh`、`phase-6.7...md`。
- 不 stage、不 commit。

## 下一阶段衔接

本 hotfix 验证通过后，可以重新进入真实 full-chain stress 的审核点；真实重压仍需用户明确确认。

## 开发者排查入口

- `packages/tui/src/index.test.ts` 中 `keeps StartAgent tool_result paired without breaking Claude anthropic_messages continuation`
- `packages/tui/src/model-tool-runtime.ts` 中 `StartAgent` control tool 分支
- `packages/tui/src/model-stream-runtime.ts` 中 continuation tool_result 回灌链路
- `packages/tui/src/job-agent-command-runtime.ts` 中 child agent sidechain provider loop

## 参考核对

- 已读取 Linghun 文档：`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`、`docs/delivery/README.md`、`docs/delivery/phase-07-16-source-level-rc-audit-repair.md`。
- 已精读指定源码：`packages/tui/src/index.test.ts`、`packages/tui/src/model-tool-runtime.ts`、`packages/tui/src/model-stream-runtime.ts`、`packages/tui/src/model-loop-runtime.ts`、`packages/tui/src/tool-result-budget.ts`。
- 本阶段只参考 Linghun 现有源码和测试事实，未复制可疑源码实现、反编译痕迹、内部 API、专有遥测或内部服务逻辑。

## 成品级 handoff packet

- 下一阶段：真实 full-chain stress 审核点。
- 禁止事项：不得把本 hotfix PASS 说成 Beta PASS；不得自动进入真实 provider 重压；不得处理 DH1-DH4；不得触碰用户指定禁区文件；不得 stage/commit。
- 证据引用：`packages/tui/src/index.test.ts`、`packages/tui/src/tool-result-budget.ts`、本阶段验证命令。
- 验证结果：Biome、focused vitest、broad index regression、runtime tests、typecheck、TUI build、CLI build、CLI smoke、`git diff --check` 均 PASS。
- 索引状态：codebase-memory MCP 本轮未暴露；按项目规则降级为 `rg` 和源码精读，未执行慢重建。
- 权限模式：本地 Codex desktop，filesystem unrestricted；未 stage、未 commit。
- 模型/provider：Codex 本地开发会话；未运行真实 Linghun provider stress。
- 预算使用：无外部 provider token 预算消耗；仅本地测试和构建。
