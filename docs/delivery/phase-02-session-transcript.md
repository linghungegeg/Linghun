# Phase 02：Session 与 JSONL transcript 闭环

## 目标

建立 Linghun 的会话持久化底座，确保每个项目拥有独立会话历史，每个会话拥有独立 id、metadata 和 JSONL transcript，并提供可执行的 CLI 路径完成创建、列出、恢复和摘要查看/更新。

本阶段只处理 Session 与 transcript 闭环，不实现模型网关、TUI、MCP、Agent、缓存成本真实统计或长期记忆。

## 本阶段范围

- 实现项目识别，基于项目路径生成稳定 `projectId`。
- 实现 JSONL transcript 追加与读取。
- 实现 `Session` 数据结构和 `SessionStore`。
- 支持按项目隔离会话历史。
- 支持会话创建、列出、恢复、摘要更新。
- 提供 headless CLI 验收命令，并兼容 `/sessions` slash 风格。
- 补充 Session、JSONL、项目识别、CLI 会话命令相关测试。

## 已完成功能

- `@linghun/core` 新增：
  - `identifyProject()` / `normalizeProjectPath()`：项目识别与路径归一化。
  - `appendJsonl()` / `readJsonl()`：JSONL 写入与读取。
  - `Session`、`TranscriptEvent`、`SessionListItem` 等类型。
  - `SessionStore`：创建、列出、恢复、追加事件、更新摘要。
- `@linghun/config` 新增：
  - `getUserDataDir()`。
  - `getSessionRootDir()`。
- `@linghun/cli` 新增 headless 会话命令：
  - `sessions list`
  - `sessions create`
  - `sessions append`
  - `sessions resume`
  - `sessions summary`
  - `/sessions`、`/sessions resume`、`/sessions summary` 兼容入口。
- `--version` / `--help` 仍先走快速路径，不触发 SessionStore 初始化。

## 使用方式

构建后可以使用：

```bash
corepack pnpm build
corepack pnpm exec linghun sessions create --message "第一条消息" --json
corepack pnpm exec linghun sessions list
corepack pnpm exec linghun sessions append <sessionId> --message "第二条消息"
corepack pnpm exec linghun sessions summary <sessionId> --text "阶段 02 验收会话"
corepack pnpm exec linghun sessions resume <sessionId> --json
corepack pnpm exec linghun /sessions
corepack pnpm exec linghun /sessions resume <sessionId>
corepack pnpm exec linghun /sessions summary <sessionId>
```

Windows 兼容入口仍可用：

```bash
corepack pnpm exec Linghun --version
```

## 涉及模块

- `packages/core/src/project.ts`：项目识别。
- `packages/core/src/jsonl.ts`：JSONL transcript 读写。
- `packages/core/src/session.ts`：Session 与 transcript 类型。
- `packages/core/src/session-store.ts`：会话持久化存储。
- `packages/core/src/index.ts`：Phase 02 API 导出。
- `packages/config/src/index.ts`：会话数据根目录 helper。
- `apps/cli/src/cli.ts`：headless sessions 命令。
- `apps/cli/src/main.ts`：支持异步 CLI 结果。

## 关键设计

- Session 数据默认存放在用户数据目录：

```text
~/.linghun/data/sessions/<projectId>/<sessionId>/session.json
~/.linghun/data/sessions/<projectId>/<sessionId>/transcript.jsonl
```

- `projectId` 使用归一化绝对路径的 SHA-256 前 16 位，避免 Windows 盘符、冒号、反斜杠直接进入目录名。
- `projectName` 保留目录名，供列表和后续 UI 显示。
- JSONL 读取遇到坏行时跳过该行并返回 diagnostics，避免单行损坏导致整个会话无法恢复。
- `SessionStore` 只负责本地文件系统持久化，不引入数据库或索引服务。
- `model` 默认写入 `not-configured`，不提前实现 Phase 03 模型网关。
- `cost` / `cache` 字段按规格保留零值结构，不提前实现 Phase 09 统计逻辑。

## 配置项

本阶段没有新增用户可配置项。

新增内部路径约定：

- 用户数据目录：`~/.linghun/data`
- 会话根目录：`~/.linghun/data/sessions`

## 命令

- `linghun sessions list [--json]`：列出当前项目会话。
- `linghun sessions create [--message 文本] [--json]`：创建会话，可写入一条用户消息。
- `linghun sessions append <id> --message 文本`：向会话追加一条用户消息。
- `linghun sessions resume <id> [--json]`：恢复会话并读取 transcript。
- `linghun sessions summary <id> [--text 文本]`：查看或更新摘要。
- `linghun /sessions`：等价于 `sessions list`。
- `linghun /sessions resume <id>`：等价于 `sessions resume <id>`。
- `linghun /sessions summary <id>`：等价于 `sessions summary <id>`。

## 测试与验证

已运行：

```bash
corepack pnpm test
corepack pnpm build
corepack pnpm typecheck
corepack pnpm exec biome check apps/cli/src/cli.ts apps/cli/src/main.ts apps/cli/src/main.test.ts packages/config/src/index.ts packages/config/src/index.test.ts packages/core/src/index.ts packages/core/src/jsonl.ts packages/core/src/jsonl.test.ts packages/core/src/project.ts packages/core/src/project.test.ts packages/core/src/session.ts packages/core/src/session-store.ts packages/core/src/session-store.test.ts packages/core/package.json
```

结果：

- `corepack pnpm test`：7 个测试文件、19 个测试通过。
- `corepack pnpm build`：通过，7 个 workspace 构建成功。
- `corepack pnpm typecheck`：通过。
- 针对本阶段改动文件的 Biome check：通过。

补充说明：

- 全仓 `corepack pnpm check` 会检查 `.codebase-memory/artifact.json`，该索引产物存在格式化差异；该文件不是 Phase 02 改动范围，本阶段未修改它。
- `@linghun/core` 构建脚本调整为 `tsup` 生成 ESM，`tsc` 生成声明文件，用于支持新增多源文件的声明输出。

## 性能结果

本阶段未引入模型、MCP 或 TUI 启动逻辑。

- `--version` / `--help` 仍在 `runCli()` 前置分支直接返回。
- Session 命令才动态加载 `@linghun/config` 与 `@linghun/core`。
- 读取会话列表只扫描当前项目的 session 目录，不扫描全部项目历史。

## 已知问题

- 当前 SessionStore 使用本地文件系统和单进程追加写入，未实现跨进程写锁；多进程同时写同一 transcript 时仍可能出现乱序或半行损坏。本阶段通过 JSONL diagnostics 降级恢复，不扩大到锁服务。
- `sessions summary` 只支持手动写入或基于 transcript 条数给出占位摘要，不调用模型生成摘要。
- 会话命令是 headless CLI 验收路径，TUI 内 `/sessions` 面板将在后续 TUI 阶段实现。

## 不在本阶段处理

- 不实现模型网关、真实 AI 对话或流式输出。
- 不实现 TUI 消息列表或状态栏。
- 不实现 MCP、codebase-memory 接入或 AI sessions 导入。
- 不实现 Agent、权限审批、Plan、工具系统。
- 不实现缓存命中率、费用统计和 verifier agent。
- 不实现长期记忆或跨工具会话交接。

## 下一阶段衔接

Phase 03 应在当前会话底座上实现模型网关最小闭环：

- Provider 接口。
- OpenAI compatible / DeepSeek 配置。
- 统一事件流。
- usage 记录。
- 断网或 key 错误的中文可读错误。

后续 TUI 阶段可以直接消费 `SessionStore` 的 list/resume 能力，把当前 headless CLI 路径接入交互界面。

## 开发者排查入口

- 项目识别：`packages/core/src/project.ts`
- JSONL transcript：`packages/core/src/jsonl.ts`
- Session 类型：`packages/core/src/session.ts`
- SessionStore：`packages/core/src/session-store.ts`
- 会话路径 helper：`packages/config/src/index.ts`
- CLI 命令：`apps/cli/src/cli.ts`
- CLI 入口：`apps/cli/src/main.ts`
- Core 测试：`packages/core/src/*.test.ts`
- CLI 测试：`apps/cli/src/main.test.ts`
