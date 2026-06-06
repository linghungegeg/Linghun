# Phase F CCB P2 Provider / Permissions / MCP

## 阶段目标

按 `LINGHUN_DEVELOPMENT_ROADMAP.md` Phase F 完成 Provider 合约化、权限系统补齐和 MCP 升级。目标是源码级闭环，不把已有局部 provider、permission 或 MCP 底座判定为阶段成熟。

## 文档事实核对

本阶段实际读取并遵守：

- `F:\Linghun\LINGHUN_DEVELOPMENT_ROADMAP.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-e-self-audit-test-coverage.md`

codebase-memory MCP 工具本轮不可用；使用 `rg`、源码精读和可执行测试完成 Phase F source-level reality check。未复制 CCB 或其他可疑源码。

## 已完成功能

| 项 | 状态 | 结果 |
| --- | --- | --- |
| F1.1 | DONE | 新增 `provider-client-runtime.ts`，提供 `registerClientFactories()` / `registerHooks()`；`OpenAiCompatibleProvider` 的 chat/responses/anthropic request builder 通过 DI factory 调用，默认 factory 复用现有自研 builder。 |
| F1.2 | DONE | `withStreamIdleTimeout()` 可联动 request `AbortController`，idle 后取消 reader 并 abort 请求。 |
| F1.3 | DONE | Provider retry 路径保留既有 retry 主链，并通过 Phase F fallback tests 覆盖连续 5xx 后的恢复路径；未静默切模型。 |
| F1.4 | DONE | `classifyProviderFailure()` 补齐 prompt/context too long、pdf/file/payload too large、tool_use mismatch、duplicate tool id、server overload、SSL/cert/TLS 等分类。 |
| F1.5 | DONE | 流式 HTTP 失败在安全条件下尝试非流式 fallback；含工具请求或可能重复 tool execution 的请求不 fallback。 |
| F2.1 | DONE | `ToolPermissionDecision` 调整为 `allow` / `deny` / `passthrough`；只读工具可显式 allow，写入/命令默认 passthrough 到 TUI 权限管道。 |
| F2.2 | DONE | `hasRepeatedPermissionDenial()` 支持最近 3 次同类拒绝和总计 20 次拒绝升级提示。 |
| F2.3 | DONE | 既有 `permissions.rules[]` 持久化路径继续承载 Always Allow；Phase F 保证 tool-level passthrough 不绕过这条持久化规则链。 |
| F2.4 | DONE | 新增 `platform-security.ts`，覆盖 Windows ADS、8.3、DOS device、Windows device namespace 等硬拒绝。 |
| F2.5 | DONE | 新增危险文件/目录集合，`.gitconfig`、`.ssh` 等受保护路径进入权限硬拒绝。 |
| F3.1 | DONE | `mcpServerSignature()` 按 `stdio:<cmd>` / `url:<url>` 去重；`saveMcpServerConfig()` 拒绝重复签名。 |
| F3.2 | DONE | `validateCodebaseMemoryToolExecution()` 同时校验 required args 和简单 schema 类型。 |
| F3.3 | DONE | MCP config 支持 `transport: "sse"` + `url`；新增 SSE JSON-RPC adapter，`executeExtraTool` 可执行已配置 SSE server 的 tools/list + tools/call。 |

## 源码级修复

- `packages/providers/src/provider-client-runtime.ts`
  - 新增 provider client factory/hook 注册点，避免继续把所有 provider 构造逻辑塞进单一类。
- `packages/providers/src/index.ts`
  - Provider request builder 走 factory。
  - Stream idle timeout 现在会 abort request controller。
  - 流式 HTTP 失败可在安全条件下转非流式请求。
- `packages/tui/src/request-lifecycle-presenter.ts`
  - Provider failure 分类补齐 Phase F 命名错误。
- `packages/tools/src/tool-runtime.ts`
  - 权限决策改为 `allow` / `deny` / `passthrough`。
- `packages/tui/src/tui-permission-runtime.ts`
  - tool-level `passthrough` 进入既有 permission mode/rules 管道，`allow` / `deny` 仍可短路。
- `packages/tui/src/permission-continuation-runtime.ts`
  - Windows 硬拒绝和 denial escalation 接入。
- `packages/config/src/index.ts`
  - MCP transport/url schema、签名去重和 SSE 配置校验。
- `packages/tui/src/mcp-sse-runtime.ts`
  - SSE MCP tools/list + tools/call 最小 adapter。

## 使用方式

- Provider 默认行为不需要用户额外配置；第三方 provider builder 可通过 `registerClientFactories()` 接入。
- `/mcp add sse <id> <url>` 可新增 SSE MCP server。
- `/mcp update <id> sse <url>` 可把现有 server 更新为 SSE transport。
- 权限规则仍通过既有 permission mode 和 `permissions.rules[]` 生效；tool-level `passthrough` 不代表自动允许。

## 涉及模块

- `packages/providers/src/provider-client-runtime.ts`
- `packages/providers/src/index.ts`
- `packages/providers/src/phase-f-provider.test.ts`
- `packages/tools/src/tool-runtime.ts`
- `packages/tools/src/index.test.ts`
- `packages/tui/src/request-lifecycle-presenter.ts`
- `packages/tui/src/tui-permission-runtime.ts`
- `packages/tui/src/permission-continuation-runtime.ts`
- `packages/tui/src/platform-security.ts`
- `packages/tui/src/deferred-tools-catalog.ts`
- `packages/tui/src/mcp-index-runtime.ts`
- `packages/tui/src/mcp-sse-runtime.ts`
- `packages/tui/src/phase-f-permission-mcp.test.ts`
- `packages/config/src/index.ts`
- `vitest.config.ts`

## 关键设计

- Provider DI 是薄注册点，不复制第三方实现，不改变现有 public provider request 结构。
- 非流式 fallback 只在无 tools 且不会重复工具执行的 plain text 路径触发；工具请求保持 fail-closed。
- Tool `checkPermissions()` 只表达工具自身的确定性 allow/deny，否则交给 TUI 权限管道，避免工具层和用户规则各判一套。
- MCP SSE adapter 仅补 transport 能力，不做完整 MCP 市场、WebSocket 或云同步。
- Vitest 新增 `@linghun/tools` 源码 alias，避免 TUI 测试误读过期 `dist`。

## 配置项

新增/扩展：

- `McpServerConfig.transport?: "stdio" | "sse"`
- `McpServerConfig.url?: string`
- `registerClientFactories()`
- `registerHooks()`

本阶段不新增依赖、不修改发布流程。

## 命令

新增/增强：

- `/mcp add sse <id> <url>`
- `/mcp update <id> sse <url>`

## 测试与验证

已通过：

```powershell
corepack pnpm exec vitest run packages/providers/src/phase-f-provider.test.ts packages/tui/src/phase-f-permission-mcp.test.ts packages/tools/src/index.test.ts
```

结果：47 tests PASS。

```powershell
corepack pnpm exec tsc -b tsconfig.json --pretty false
```

结果：PASS。

## 性能结果

Provider hooks/factories 为内存注册表，默认路径无额外 IO。非流式 fallback 只在流式 HTTP 失败且安全条件满足时多发一次请求；正常流式路径不增加请求。MCP SSE tools/list + tools/call 只在用户配置 SSE server 且执行对应 tool 时触发。

## 已知问题

- F3.3 本阶段按路线图“至少支持 SSE”闭环；HTTP/WebSocket 未声明完成。
- Provider 仍有部分历史 builder 留在 `providers/src/index.ts`；本阶段已建立 DI 边界，未做大范围 provider 文件拆分。
- 工作区存在本阶段外预先 dirty/untracked 文件，未触碰、未回滚。

## 不在本阶段处理的内容

- 不实现 Phase G 的本地 REPL/WebSocket bridge、4 层 remote dedupe、JWT refresh、feature flags、memory include/frontmatter 和 keybinding。
- 不做真实 provider full-chain 压测或真实远程 MCP 服务压测。
- 不复制 CCB 源码、内部 API 或专有实现。

## 下一阶段衔接

下一阶段：Phase G。重点是远程能力、Feature Flag、内存 include/条件规则和键绑定系统。不得用 Phase F 的 provider/permission/MCP 成熟度替代 Phase G 的源码级闭环。

## 开发者排查入口

- Provider factory/hook：`packages/providers/src/provider-client-runtime.ts`
- Provider stream/fallback：`packages/providers/src/index.ts`
- 权限入口：`packages/tui/src/tui-permission-runtime.ts`
- Windows 安全：`packages/tui/src/platform-security.ts`
- MCP config：`packages/config/src/index.ts`
- MCP SSE：`packages/tui/src/mcp-sse-runtime.ts`
- Deferred tool schema：`packages/tui/src/deferred-tools-catalog.ts`

## 参考核对

本阶段实际读取 Linghun 文档见“文档事实核对”。CCB 仅作为行为参考：provider factory/hook、idle watchdog、permission passthrough、denial tracking、Windows path guard、MCP transport/dedupe。未读取或复制 `F:\ccb-source` 源码；未复制内部 API、专有遥测、反编译痕迹或可疑实现。

## Handoff Packet

- 当前阶段：Phase F CCB P2 Provider / Permissions / MCP
- 状态：DONE，继续进入用户已明确要求的 Phase G
- 下一阶段：Phase G CCB P3 Remote / Feature Flag / Memory / Keybinding
- 禁止事项：不得把 SSE 支持扩展描述成完整 MCP transport matrix；不得把 tool passthrough 当作 auto allow；不得复制 CCB 可疑源码
- 证据引用：本文件“测试与验证”；`LINGHUN_DEVELOPMENT_ROADMAP.md` Phase F
- 验证结果：Phase F focused tests PASS；typecheck PASS
- 索引状态：codebase-memory MCP 不可用；使用 `rg`/源码事实核对
- 权限模式：本地 unrestricted filesystem；未执行依赖变更、发布或远程部署
- 模型/provider：Codex 本地开发会话；未调用 Linghun runtime provider
- 预算使用情况：未设置显式 token 预算
