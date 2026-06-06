# Phase G CCB P3 Remote / Feature Flag / Memory / Keybinding

## 阶段目标

按 `LINGHUN_DEVELOPMENT_ROADMAP.md` Phase G 完成远程本地 REPL 协议、Feature Flag、memory include/frontmatter/bounds 和集中式键绑定。目标是源码级闭环，不把已有 Feishu bridge、memory summary 或 Composer 快捷键局部成熟当作 Phase G 全局成熟。

## 文档事实核对

本阶段实际读取并遵守：

- `F:\Linghun\LINGHUN_DEVELOPMENT_ROADMAP.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-f-ccb-p2-provider-permission-mcp.md`

codebase-memory MCP 工具本轮不可用；使用 `rg`、源码精读和可执行测试完成 Phase G source-level reality check。未复制 CCB 或其他可疑源码。

## 已完成功能

| 项 | 状态 | 结果 |
| --- | --- | --- |
| G1.1 | DONE | 新增本地 REPL bridge 状态机、真实本地 socket JSONL server 和 slash 入口：listen / close / register / inbound / poll / route / ack / heartbeat / stop / deregister。`local-route` 将消息送入既有 `handleRemoteInboundMessage`，不新增第二套执行器。 |
| G1.2 | DONE | 新增 `BoundedUUIDSet`、`FlushGate`、initial/recent inbound/recent posted 去重；重复 messageId、已处理 messageId 和 flush 中状态均有确定性结果。 |
| G1.3 | DONE | 新增 `maybeRefreshJwtToken()`，默认过期前 5 分钟刷新；用户可用 `/remote bridge jwt-refresh-check <token> <expiresAt>` 做脱敏检查。 |
| G2.1 | DONE | 新增本地 Feature Flag runtime，默认关闭高风险实验性 skill/plugin deferred execution，保留 local REPL、memory include、自定义 keybinding 默认可用。 |
| G2.2 | DONE | `deferred-tools-catalog` 的 skill/plugin executable 状态改由 feature flag 驱动；开启后仍需 discovery/trust/schema/permission gates。 |
| G3.1 | DONE | `LINGHUN.md` 支持 `@include` 递归加载，深度上限 5，循环和越界 include 明确 warning。 |
| G3.2 | DONE | 支持 frontmatter `paths:` 解析和 glob-like 匹配，memory state 记录 frontmatter paths 与 include 来源。 |
| G3.3 | DONE | memory 规则加载限制为 `MAX_MEMORY_CHARACTER_COUNT = 40000`，超限截断并记录 warning。 |
| G4.1 | DONE | 新增集中式 keybinding runtime，支持 `global` / `chat` / `autocomplete` 三层 context。 |
| G4.2 | DONE | 支持项目 `.linghun/keybindings.json` 覆盖默认快捷键。 |
| G4.3 | DONE | 支持多键和弦，如 `ctrl+x ctrl+k`。 |

## 源码级修复

- `packages/tui/src/remote-repl-bridge-runtime.ts`
  - 新增本地 REPL bridge 状态机、4 层去重、Node `net` 本地 socket JSONL server 和 JWT refresh helper。
  - 修复 stop 后无法 deregister 的协议收尾问题。
- `packages/tui/src/remote-command-runtime.ts`
  - 新增本地 bridge slash 命令。
  - `refreshRemoteState()` 保留 `localReplBridge`，避免跨命令 register/inbound/poll 丢状态。
  - `validateRemoteInboundEnvelope()` 接受受限的 `local-repl` adapter 消息，要求来源、origin、注册 client 和队列 messageId 匹配。
- `packages/tui/src/feature-flag-runtime.ts`
  - 新增本地 feature flag runtime 和 `/features` 展示来源。
- `packages/tui/src/memory-rules-runtime.ts`
  - 新增 include、frontmatter paths、40k 边界。
- `packages/tui/src/keybinding-runtime.ts`
  - 新增默认键位、自定义覆盖和 chord 解析。
- `packages/tui/src/tui-state-runtime.ts`
  - memory state 接入 `loadMemoryRulesFile()`，remote state 初始化本地 bridge。
- `packages/tui/src/shell/components/Composer.tsx`
  - 输入层优先解析集中式 keybindings；permission panel 激活时仍保持权限焦点优先。

## 使用方式

- 本地 bridge：
  - `/remote bridge local-listen [socketPath]`
  - `/remote bridge local-close`
  - `/remote bridge local-register <clientId>`
  - `/remote bridge local-inbound <clientId> <text>`
  - `/remote bridge local-poll <clientId>`
  - `/remote bridge local-route <clientId>`
  - `/remote bridge local-ack <clientId> <messageId>`
  - `/remote bridge local-heartbeat <clientId>`
  - `/remote bridge local-stop <clientId>`
  - `/remote bridge local-deregister <clientId>`
- JWT refresh 检查：
  - `/remote bridge jwt-refresh-check <token> <expiresAt>`
- Feature flags：
  - `/features`
  - `LINGHUN_FEATURE_FLAGS=experimentalDeferredSkillExecution=true,experimentalDeferredPluginExecution=true`
- Memory include：
  - 在 `LINGHUN.md` 中写 `@include child.md`
  - frontmatter 示例：`paths: ["src/**/*.ts"]`
- Keybindings：
  - 在项目 `.linghun/keybindings.json` 写入数组，例如 `[{ "context": "chat", "keys": ["ctrl+x", "ctrl+k"], "action": "clear-line" }]`

## 涉及模块

- `packages/tui/src/remote-repl-bridge-runtime.ts`
- `packages/tui/src/remote-command-runtime.ts`
- `packages/tui/src/feature-flag-runtime.ts`
- `packages/tui/src/memory-rules-runtime.ts`
- `packages/tui/src/keybinding-runtime.ts`
- `packages/tui/src/phase-g-remote-feature-memory-keybinding.test.ts`
- `packages/tui/src/tui-data-types.ts`
- `packages/tui/src/tui-state-runtime.ts`
- `packages/tui/src/extension-command-runtime.ts`
- `packages/tui/src/deferred-tools-catalog.ts`
- `packages/tui/src/tui-context-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/shell/types.ts`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/shell/components/Composer.tsx`

## 关键设计

- 本地 REPL bridge 只负责接入、去重、队列和 ack；真正入站处理仍走 `handleRemoteInboundMessage`，不新增第二套模型/工具/权限执行器。
- `local-repl` envelope 是本地 adapter 特例，只接受已注册 client 队列中的消息；不会改变 Feishu/DingTalk/WeCom 的远程校验路径。
- Feature flags 是 local-first 配置，不接入远程 GrowthBook；高风险实验性 skill/plugin execution 默认关闭。
- Memory include 只允许项目规则目录内相对 include，避免把任意外部文件塞入 prompt。
- Keybinding runtime 是薄解析层；不引入 watcher，不改权限审批优先级。

## 配置项

新增/扩展：

- `LINGHUN_FEATURE_FLAGS`
- `config.features.experimentalDeferredSkillExecution`
- `config.features.experimentalDeferredPluginExecution`
- `config.features.localReplBridge`
- `config.features.memoryIncludes`
- `config.features.customKeybindings`
- `.linghun/keybindings.json`

本阶段不新增依赖、不修改发布流程。

## 命令

新增/增强：

- `/features`
- `/remote bridge local-listen [socketPath]`
- `/remote bridge local-close`
- `/remote bridge local-register <clientId>`
- `/remote bridge local-inbound <clientId> <text>`
- `/remote bridge local-poll <clientId>`
- `/remote bridge local-route <clientId>`
- `/remote bridge local-ack <clientId> <messageId>`
- `/remote bridge local-heartbeat <clientId>`
- `/remote bridge local-stop <clientId>`
- `/remote bridge local-deregister <clientId>`
- `/remote bridge jwt-refresh-check <token> <expiresAt>`

## 测试与验证

已通过：

```powershell
corepack pnpm exec vitest run packages/tui/src/phase-g-remote-feature-memory-keybinding.test.ts
```

结果：7 tests PASS。

```powershell
corepack pnpm exec vitest run packages/providers/src/phase-f-provider.test.ts packages/tui/src/phase-f-permission-mcp.test.ts packages/tools/src/index.test.ts packages/tui/src/phase-g-remote-feature-memory-keybinding.test.ts
```

结果：54 tests PASS。

```powershell
corepack pnpm exec tsc -b tsconfig.json --pretty false
```

结果：PASS。

## 性能结果

本地 REPL bridge 只维护 bounded queue/set，默认每类 UUID 上限 50，client queue 上限 20；socket server 只在用户执行 `/remote bridge local-listen` 后启动，关闭时清理 Unix socket 文件。Memory include 深度上限 5，最终注入文本上限 40k 字符。Keybinding 解析在当前 bindings 数组内线性匹配，未引入 watcher 或后台任务。

## 已知问题

- G1.1 本阶段实现本地 socket JSONL server；未额外实现 WebSocket server。
- Keybinding 本阶段支持项目文件加载，不做 chokidar 热重载。
- Feature flags 是运行时本地配置，不做构建期 tree-shaking。
- 工作区存在本阶段外预先 dirty/untracked 文件，未触碰、未回滚。

## 不在本阶段处理的内容

- 不实现完整 IM SDK、远程官方 CLI adapter 扩展或分布式 remote channel。
- 不开启实验性 skill/plugin execution 默认值。
- 不实现 Phase 17 durable jobs / remote channels。
- 不复制 CCB 源码、内部 API 或专有实现。

## 下一阶段衔接

Phase B-G 已按用户要求连续推进完毕。本轮结束后停止，不自动进入后续路线图或 Phase 17。若后续继续，应先按最新交付文档、验证结果和当前 dirty worktree 重新做 source-level reality check。

## 开发者排查入口

- 本地 bridge：`packages/tui/src/remote-repl-bridge-runtime.ts`
- Remote slash 命令：`packages/tui/src/remote-command-runtime.ts`
- Remote inbound glue：`packages/tui/src/model-stream-runtime.ts`
- Feature flags：`packages/tui/src/feature-flag-runtime.ts`
- Deferred tools：`packages/tui/src/deferred-tools-catalog.ts`
- Memory rules：`packages/tui/src/memory-rules-runtime.ts`
- Memory state：`packages/tui/src/tui-state-runtime.ts`
- Keybindings：`packages/tui/src/keybinding-runtime.ts`
- Composer input：`packages/tui/src/shell/components/Composer.tsx`

## 参考核对

本阶段实际读取 Linghun 文档见“文档事实核对”。CCB 仅作为行为参考：REPL register/poll/ack/heartbeat/stop/deregister、bounded UUID dedupe、JWT refresh window、feature flag gating、memory include/frontmatter/40k cap、keybinding scopes/chords。未读取或复制 `F:\ccb-source` 源码；未复制内部 API、专有遥测、反编译痕迹或可疑实现。

## Handoff Packet

- 当前阶段：Phase G CCB P3 Remote / Feature Flag / Memory / Keybinding
- 状态：DONE，Phase B-G 已按用户要求推进完毕
- 下一阶段：无自动下一阶段；等待用户明确新目标
- 禁止事项：不得把本地 socket JSONL server 宣称为 WebSocket server；不得把 feature flag runtime 宣称为远程 GrowthBook；不得默认开启实验性 skill/plugin execution；不得复制 CCB 可疑源码
- 证据引用：本文件“测试与验证”；`LINGHUN_DEVELOPMENT_ROADMAP.md` Phase G
- 验证结果：Phase G focused tests 7 PASS；Phase F+G focused tests 54 PASS；typecheck PASS
- 索引状态：codebase-memory MCP 不可用；使用 `rg`/源码事实核对
- 权限模式：本地 unrestricted filesystem；未执行依赖变更、发布或远程部署
- 模型/provider：Codex 本地开发会话；未调用 Linghun runtime provider
- 预算使用情况：未设置显式 token 预算
