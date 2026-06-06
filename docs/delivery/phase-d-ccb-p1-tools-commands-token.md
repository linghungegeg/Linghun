# Phase D CCB P1 Tools / Commands / Token Counting

## 阶段目标

按 `LINGHUN_DEVELOPMENT_ROADMAP.md` Phase D 完成工具系统、命令系统和 token 计数基础升级。不得把已有局部工具/命令/usage 底座判定为阶段完成；本阶段必须有源码级闭环。

## 文档事实核对

开工前实际读取并遵守：

- `F:\Linghun\LINGHUN_DEVELOPMENT_ROADMAP.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-c-ccb-p0-cost-git-token.md`

codebase-memory MCP 工具本轮不可用；使用 `rg`、源码精读和只读 explorer 完成 Phase D source-level reality check。未读取或复制 `F:\ccb-source` 源码。

## 已完成功能

| 项 | 状态 | 结果 |
| --- | --- | --- |
| D1.1 | DONE | 为 9 个内置工具新增 `packages/tools/src/tools/<Name>/<Name>Tool.ts`、`prompt.ts`、`UI.ts`。核心 call 实现仍复用既有 `index.ts`，避免重复执行系统。 |
| D1.2 | DONE | `ToolDefinition` 补齐 `isReadOnlyTool()`、`isDestructive()`、`checkPermissions()`、`userFacingName()`、`getToolUseSummary()`、`prompt()`、`getActivityDescription()`；保留旧 `isReadOnly` 字段兼容权限链。 |
| D1.3 | DONE | 每工具有 prompt.ts，模型 tool description 会拼接工具 prompt。 |
| D1.4 | DONE | 新增 `createTool(def)` 工厂，默认 fail-closed：`isReadOnly=false`、`isConcurrencySafe=false`、`destructive=false`、无自定义权限时写类工具 `ask`。 |
| D1.5 | DONE | `createToolInputSchema("Diff")` 增加显式 Diff schema，不再依赖 fallback。 |
| D2.1 | DONE | `SLASH_COMMAND_REGISTRY` 继续作为单一用户可见命令注册表，并新增 `promptCommand` 标记和查找函数；未新建第二套 discovery/catalog。 |
| D2.2-D2.6 | DONE | 新增 `prompt-command-runtime.ts`，实现 `/commit`、`/init`、`/security-review`、`/commit-push-pr`、`/init-verifiers` 为 PromptCommand；命中后进入现有 model/tool loop，不本地直接执行写入/Bash/git。 |
| D2.7 | DONE | `/context`/compact status 增加上下文利用率：`上下文 x% (used/max)`。 |
| D2.8 | DONE | `/model` 面板显示 context window，并在 details 暴露 DeepSeek legacy alias 提示；`/model set` 继续复用既有 alias 解析。 |
| D3.1 | DONE | `ModelGateway.countMessagesTokensWithAPI()` 接入可选 provider `countTokens()`；stream usage 事件后调用该 API hook，provider 不支持时记录 unavailable，不阻断主链。 |
| D3.2 | DONE | 新增 `calculateContextPercentages()`，`/context` 和 task footer 可显示上下文百分比。 |
| D3.3 | DONE | 新增 `getContextWindowForModel()`，按 route `maxInputTokens`、known model、默认值解析 context window。 |

## 使用方式

- 模型工具定义自动包含各工具 prompt，无新增用户命令。
- `/security-review --changed` 等 PromptCommand 会作为模型任务执行，仍走工具权限和证据主链。
- `/context` 或 `/compact status` 可查看上下文利用率。
- `/model` 可查看当前模型 context window 和 legacy alias 提示。

## 涉及模块

- `packages/tools/src/index.ts`
- `packages/tools/src/tool-runtime.ts`
- `packages/tools/src/tools/**`
- `packages/tools/src/index.test.ts`
- `packages/providers/src/index.ts`
- `packages/providers/src/token-count.test.ts`
- `packages/tui/src/model-loop-runtime.ts`
- `packages/tui/src/model-loop-runtime.test.ts`
- `packages/tui/src/prompt-command-runtime.ts`
- `packages/tui/src/prompt-command-runtime.test.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/context-window-runtime.ts`
- `packages/tui/src/context-window-runtime.test.ts`
- `packages/tui/src/cache-command-runtime.ts`
- `packages/tui/src/model-command-runtime.ts`
- `packages/tui/src/model-command-runtime.test.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/shell/*`

## 关键设计

- 工具拆分只拆 metadata/prompt/UI 边界，核心执行仍复用既有 `runTool` 和权限管道，避免第二套工具系统。
- PromptCommand 不直接执行危险动作，只把结构化任务提示交给现有 model loop；工具调用仍经权限、证据、final gate。
- API token 计数为 provider capability hook；未支持 provider 明确记录 unavailable，不伪装为精确 API 结果。
- 上下文窗口解析统一为 route > known model > packaged default。

## 配置项

本阶段不新增 env。新增导出/API：

- `createTool()`
- `ToolPermissionDecision`
- `ModelGateway.countMessagesTokensWithAPI()`
- `Provider.countTokens?`
- `calculateContextPercentages()`
- `getContextWindowForModel()`

## 命令

新增 PromptCommand：

- `/commit`
- `/init`
- `/security-review`
- `/commit-push-pr`
- `/init-verifiers`

增强：

- `/context`
- `/model`

## 测试与验证

已通过：

```powershell
corepack pnpm exec vitest run packages/tools/src/index.test.ts packages/tui/src/model-loop-runtime.test.ts packages/tui/src/prompt-command-runtime.test.ts packages/tui/src/context-window-runtime.test.ts packages/providers/src/token-count.test.ts packages/tui/src/shell/models/footer-view.test.ts
```

结果：208 tests PASS。

```powershell
corepack pnpm exec vitest run packages/tui/src/model-command-runtime.test.ts packages/tui/src/index.test.ts --testNamePattern "Phase D PromptCommand|context window"
```

结果：2 tests PASS / 674 skipped。

```powershell
corepack pnpm exec tsc -b tsconfig.json --pretty false
```

结果：PASS。

## 性能结果

工具 prompt/metadata 为静态模块加载；不会新增运行时 IO。PromptCommand 只生成本地字符串。API token count hook 仅在 provider usage 事件后调用，provider 不支持时为本地快速 unavailable；不支持时不会额外联网。

## 已知问题

- D2.1 没有把 `index.ts` 的历史 if-chain 全量搬空；本阶段建立了统一 registry 标记和 PromptCommand 执行入口，后续可继续渐进迁移 handler，未新建第二套 catalog。
- D3.1 需要具体 provider 实现 `countTokens()` 才能得到 api source；当前 gateway hook 与 mock provider 已闭环，真实 provider 不支持时明确 unavailable。
- 工作区存在本阶段外预先 dirty/untracked 文件，未触碰、未回滚。

## 不在本阶段处理的内容

- 不做 Phase E 的 20 文件测试债全量补齐。
- 不实现 Phase F 的 provider DI、非流式 fallback、权限持久化和 MCP SSE。
- 不实现 Phase G 的 REPL remote、feature flags、memory include 和键绑定系统。

## 下一阶段衔接

下一阶段：Phase E。重点是按路线图为 20 个关键文件补 focused tests；不能用本阶段新增测试替代 Phase E 的逐项覆盖。

## 开发者排查入口

- 工具工厂：`packages/tools/src/tool-runtime.ts`
- 工具 prompt/UI：`packages/tools/src/tools/**`
- 模型 tool schema：`packages/tui/src/model-loop-runtime.ts`
- PromptCommand：`packages/tui/src/prompt-command-runtime.ts`
- 命令 registry：`packages/tui/src/natural-command-bridge.ts`
- API token hook：`packages/providers/src/index.ts`、`packages/tui/src/model-stream-runtime.ts`
- Context window：`packages/tui/src/context-window-runtime.ts`

## 参考核对

本阶段实际读取 Linghun 文档见“文档事实核对”。CCB 仅作为行为参考：每工具 prompt/UI/定义目录、PromptCommand、context window 与 token count hook。未读取或复制 `F:\ccb-source` 源码；未复制内部 API、专有遥测、反编译痕迹或可疑实现。

## Handoff Packet

- 当前阶段：Phase D CCB P1 Tools / Commands / Token Counting
- 状态：DONE，继续进入用户已明确要求的 Phase E
- 下一阶段：Phase E Self-Audit Test Coverage
- 禁止事项：不得把 Phase D focused tests 当作 Phase E 20 文件全覆盖；不得绕过现有权限主链；不得复制 CCB 可疑源码
- 证据引用：`LINGHUN_DEVELOPMENT_ROADMAP.md` Phase D；本文件“测试与验证”
- 验证结果：typecheck PASS；Phase D focused tests PASS；full vitest deferred to Phase G final regression
- 索引状态：codebase-memory MCP 不可用；使用 `rg`/源码事实核对
- 权限模式：本地 unrestricted filesystem；未执行依赖变更、发布或远程部署
- 模型/provider：Codex 本地开发会话；未调用 Linghun runtime provider
- 预算使用情况：未设置显式 token 预算；新增 PromptCommand 本身不产生 provider 成本
