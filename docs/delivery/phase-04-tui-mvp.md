# Phase 04：TUI / REPL 最小闭环

## 阶段目标

实现 Linghun 的最小可用交互式终端闭环：用户运行 `linghun` 后进入 REPL，能查看当前模型和会话，能通过 Phase 03 `ModelGateway` 调用当前 DeepSeek provider/model，并把对话写入 Phase 02 JSONL transcript。

本阶段只做 Phase 04，不实现 MCP、工具系统、Agent、多模型协作、长期任务、真实 cache/cost 统计或桌面端。

## 已完成功能

- `linghun` 无参数进入 Phase 04 交互式 REPL。
- 启动后显示当前状态；Session 采用懒创建：
  - 普通消息发送前自动创建 session；
  - `/sessions resume <id>` 会直接恢复目标 session，不额外创建 orphan session；
  - 状态栏显示当前 session id 或 `未创建`。
- 状态栏显示：
  - 当前模型
  - 权限模式
  - cache / cost / index 占位状态
- 普通输入会：
  - 写入当前 session 的 JSONL transcript；
  - 通过 Phase 03 `ModelGateway` 调用 DeepSeek provider；
  - 流式显示 assistant 文本；
  - 将 assistant 文本写入 JSONL transcript。
- 支持基础 slash 命令：
  - `/help`
  - `/model`
  - `/sessions`
  - `/sessions resume <id>`
  - `/exit`
- `/sessions resume <id>` 可恢复当前项目已有会话，后续消息继续写入恢复后的 session transcript。
- 错误以中文提示展示，并保留 Phase 03 provider 的可操作建议。
- Windows 兼容入口 `Linghun --version` 保持可用。

## 使用方式

构建后运行：

```bash
corepack pnpm build
corepack pnpm exec linghun
```

进入 REPL 后：

```text
/help
/model
/sessions
/sessions resume <id>
/exit
```

发送普通消息：

```text
你好，请用一句话介绍 Linghun 当前阶段。
```

如果没有配置 API Key，普通消息会显示中文错误提示；slash 命令和 session 写入仍可用。

## 涉及模块

- `packages/tui/src/index.ts`：Phase 04 REPL、状态栏、slash 命令、ModelGateway 接入、transcript 写入。
- `packages/tui/src/index.test.ts`：slash 命令与 session resume 最小测试。
- `packages/tui/package.json`：声明 TUI 对 config/core/providers/shared 的 workspace 依赖。
- `packages/tui/tsconfig.json`：声明 workspace project references。
- `apps/cli/src/cli.ts`：无参数启动 TUI；帮助文案更新为 Phase 04。
- `apps/cli/src/main.test.ts`：CLI help 回归更新到 Phase 04。
- `apps/cli/package.json`：CLI 依赖 `@linghun/tui`。
- `apps/cli/tsconfig.json`：CLI project reference 增加 `packages/tui`。
- `docs/delivery/README.md`：Phase 04 状态更新。

## 关键设计

- REPL 使用 Node.js `readline/promises`，不自研终端渲染器；这是 Phase 04 的最小可用 TUI/REPL 闭环。
- TUI 包只组合现有 Phase 02 / Phase 03 能力：
  - `SessionStore` 管理会话和 JSONL transcript；
  - `loadConfig()` 读取当前模型配置；
  - `ModelGateway` + `DeepSeekProvider` 调用模型。
- 状态栏先显示占位：`cache -- · ¥-- · index --`，不提前实现 Phase 09/10。
- 当前只接入 DeepSeek provider，不扩展 OpenAI-compatible TUI 配置面板或多模型路由。
- 错误不吞掉：provider 错误会以中文提示和建议显示给用户。
- `/exit` 会写入 `session_end` 事件。

## 配置项

本阶段没有新增配置项。

沿用 Phase 03 配置：

```bash
LINGHUN_DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
LINGHUN_DEEPSEEK_API_KEY=...
```

当前默认模型仍为：

```text
deepseek-v4-flash
```

如果项目已通过 `/model set deepseek-v4-pro` 写入 `.linghun/settings.json`，REPL 会读取项目配置并使用 `deepseek-v4-pro`。

## 命令

新增交互入口：

- `linghun`：进入 Phase 04 REPL。

REPL 内命令：

- `/help`：显示基础命令。
- `/model`：显示当前模型与状态栏。
- `/sessions`：列出当前项目 session。
- `/sessions resume <id>`：恢复历史 session。
- `/exit`：退出并写入 `session_end`。

保留 headless 命令：

- `linghun --version`
- `linghun --help`
- `linghun sessions ...`
- `linghun /sessions ...`
- `linghun model ...`
- `linghun /model ...`

## 测试与验证

已运行：

```bash
corepack pnpm install
corepack pnpm --filter @linghun/tui build
corepack pnpm --filter @linghun/tui typecheck
corepack pnpm --filter @linghun/cli typecheck
corepack pnpm test -- packages/tui/src/index.test.ts apps/cli/src/main.test.ts
```

结果：

- `corepack pnpm install`：通过。
- `@linghun/tui build`：通过。
- `@linghun/tui typecheck`：通过。
- `@linghun/cli typecheck`：通过。
- focused tests：9 个测试文件、31 个测试通过。

最终补充验证：

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm exec biome check apps/cli/src/cli.ts apps/cli/src/main.test.ts apps/cli/package.json apps/cli/tsconfig.json packages/tui/src/index.ts packages/tui/src/index.test.ts packages/tui/package.json packages/tui/tsconfig.json docs/delivery/README.md docs/delivery/phase-04-tui-mvp.md
corepack pnpm exec linghun --version
corepack pnpm exec linghun --help
corepack pnpm exec Linghun --version
```

结果：

- `corepack pnpm test`：9 个测试文件、31 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过。
- Biome check：通过。
- `linghun --version`：输出 `0.1.0`。
- `linghun --help`：显示 Phase 04 帮助。
- `Linghun --version`：输出 `0.1.0`。

## TUI smoke 验证

已运行：

```bash
printf '/help\n/model\n/sessions\n/exit\n' | corepack pnpm exec linghun
```

结果：通过。输出包含 Phase 04 REPL 标题、状态栏、`/help` 命令说明、当前模型 `deepseek-v4-flash`、会话列表和正常退出提示。

补充 smoke：

- 纯 slash 命令输入不会创建空 transcript；避免 `/sessions resume <id>` 前产生 orphan session。
- `/sessions resume <id>` 会恢复已有 session，并在 `/exit` 时把 `session_end` 写入恢复后的 transcript。
- 重复恢复已结束 session 后再 `/exit` 不会重复追加 `session_end`。
- Windows/Git Bash 管道中文输入经 codepoint 验证已写入 `你好`（`0x4f60 0x597d`）；当前终端/Python 输出可能显示为 `���`，但 JSONL UTF-8 内容正确。

在线 happy path 补测：通过，验证结论为 PASS。

- DeepSeek REPL 在线链路：通过 `LINGHUN_DEEPSEEK_BASE_URL=https://api.deepseek.com` 运行 `linghun` 进入 Phase 04 REPL，发送 `你好，回复 ok`，assistant 返回 `ok`；JSONL transcript 事件序列为 `session_start,user_message,assistant_text_delta,session_end`；`/exit` 正常追加 `session_end`。
- DeepSeek 常见 endpoint 探测：`/chat/completions` 返回 HTTP 200，`/v1/chat/completions` 返回 HTTP 200，`/anthropic/messages` 返回 HTTP 200。
- 当前 Phase 04 代码实际走 Phase 03 `DeepSeekProvider` 的 OpenAI-compatible `/chat/completions` 风格路径；本阶段未新增 Anthropic 协议分支。
- OpenAI-compatible endpoint：通过现有 Phase 03 OpenAI-compatible provider/HTTP 路径补测，确认 `/models` 和 `/chat/completions` 返回 HTTP 200，返回文本包含 `ok`，usage 返回正常；同一 provider/gateway 事件流与 Phase 02 `SessionStore` transcript 写入链路验证通过。
- 本次补测未写入、展示或保存 API key，未修改源码，未进入 Phase 05；cache/cost/index 仍为 Phase 04 占位。

## 性能结果

- `--version` / `--help` 仍保持快速路径，不启动 TUI。
- 只有无参数 `linghun` 才动态导入 `@linghun/tui`。
- `/model`、`/sessions` 等 headless 命令仍按需动态导入对应包。
- REPL 会话列表只读取当前项目 session，不扫描全部项目。

## 已知问题

- 当前 REPL 是最小 `readline` 闭环，不是完整 Ink UI；消息列表、输入框美化、resize 处理、命令面板视觉样式会在后续阶段继续完善。
- Ctrl+C / Esc 的流式中断控制尚未作为独立交互状态实现；当前可通过终端中断进程或 `/exit` 正常退出。完整中断队列属于后续 TUI 增强。
- 多行粘贴在 `readline` 下按终端输入行为处理；本阶段未实现专门的粘贴队列。
- 未实现真实 cache/cost/index 统计，只显示占位。
- 未实现工具调用、权限审批、MCP 或 Agent。

## 不在本阶段处理的内容

- 不实现 MCP 工具调用。
- 不实现 Agent 多开。
- 不实现插件系统。
- 不实现长期任务。
- 不实现真实 cache/cost 统计。
- 不做桌面端。
- 不做大规模 UI 美化。
- 不改变 Phase 03 已验证 provider 行为。
- 不实现 Phase 05+ 的 Read/Write/Edit/Bash/Todo/Diff、权限、Plan、验证器、MCP 索引、记忆、Skills 或 Jobs。

## 下一阶段衔接

Phase 05 可在当前 REPL 基础上接入核心工具闭环：

- Read / Write / Edit / Bash / Grep / Glob 等工具注册。
- 工具事件写入 transcript。
- 工具输出在 TUI 中显示。
- 与后续权限阶段保持接口边界。

## 开发者排查入口

- TUI / REPL：`packages/tui/src/index.ts`
- TUI 测试：`packages/tui/src/index.test.ts`
- CLI 启动分发：`apps/cli/src/cli.ts`
- CLI 入口：`apps/cli/src/main.ts`
- SessionStore：`packages/core/src/session-store.ts`
- Transcript 类型：`packages/core/src/session.ts`
- ModelGateway / provider：`packages/providers/src/index.ts`
- 配置加载：`packages/config/src/index.ts`
