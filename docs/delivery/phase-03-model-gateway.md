# Phase 03：模型网关最小闭环

## 目标

建立 Linghun 的模型网关最小闭环，先打通单模型 Provider 抽象、OpenAI compatible / DeepSeek 配置、统一事件流、usage 记录、DeepSeek V4 / V4 Pro 1M 能力表，以及可执行的 headless `/model` 验收命令。

本阶段只处理模型网关基础能力，不实现 TUI、工具调用系统、MCP、Agent、多模型角色路由、缓存成本真实统计、Skills、Plugins 或长期任务。

## 已完成功能

- `@linghun/providers` 新增：
  - `Provider` 接口。
  - `ModelGateway`。
  - Phase 03 范围内的 `LinghunEvent`：`assistant_text_delta`、`usage`、`error`。
  - `ModelUsage`。
  - `ModelInfo` 与 `ProviderCapabilities`。
  - `OpenAiCompatibleProvider`。
  - `DeepSeekProvider`。
  - OpenAI compatible streaming chat completions 请求构造。
  - OpenAI SSE 流式文本与 usage 解析。
  - Provider 错误归一化为 `LinghunError`。
- DeepSeek 能力表新增：
  - `deepseek-v4-flash`：128000 上下文，8192 最大输出。
  - `deepseek-v4-pro`：1048576 上下文，16384 最大输出。
- `@linghun/config` 新增：
  - `providers` 配置结构。
  - 默认 DeepSeek provider 配置。
  - 默认 OpenAI compatible provider 配置。
  - `loadConfig()`。
  - `saveDefaultModel()`。
  - 项目级 `.linghun/settings.json` 读写。
- `@linghun/cli` 新增 headless 模型命令：
  - `model`
  - `model set deepseek-v4-pro`
  - `model doctor`
  - `/model`
  - `/model set deepseek-v4-pro`
  - `/model doctor`

## 使用方式

查看当前模型：

```bash
corepack pnpm exec linghun /model
```

切换到 DeepSeek V4 Pro 1M：

```bash
corepack pnpm exec linghun /model set deepseek-v4-pro
```

诊断模型配置：

```bash
corepack pnpm exec linghun /model doctor
```

CLI 兼容入口仍可用：

```bash
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
```

## 涉及模块

- `packages/providers/src/index.ts`：Provider、ModelGateway、OpenAI compatible、DeepSeek、能力表、流式事件解析、错误归一化。
- `packages/providers/src/index.test.ts`：Provider / gateway / stream / usage / 错误归一化测试。
- `packages/config/src/index.ts`：Phase 03 provider 配置和项目级模型设置读写。
- `packages/config/src/index.test.ts`：项目级模型配置保存与加载测试。
- `apps/cli/src/cli.ts`：headless `/model` 命令。
- `apps/cli/src/main.test.ts`：CLI `/model` 验收测试。
- `apps/cli/package.json`、`apps/cli/tsconfig.json`：CLI 依赖 providers 包。
- `packages/providers/package.json`、`packages/providers/tsconfig.json`：providers 依赖 core 的 `LinghunError`。

## 关键设计

- `ModelGateway` 只负责 Provider 查找、事件转发和错误归一化，不做多模型角色路由。
- `OpenAiCompatibleProvider` 使用 OpenAI compatible `/chat/completions` streaming 请求形态，支持 `base_url`、`api_key`、`model`、`max_tokens`。
- `createChatRequest()` 会按模型能力表限制最大输出 token，避免超过当前模型上限。
- `parseOpenAiStream()` 将 SSE 中的文本 delta 转成 `assistant_text_delta`，将 usage 转成统一 `usage` 事件。
- DeepSeek provider 复用 OpenAI compatible provider，并默认使用 `https://api.deepseek.com/v1`。
- `/model set deepseek-v4-pro` 只写当前项目 `.linghun/settings.json`，不写固定 C 盘或固定用户名路径。
- `/model doctor` 不联网；只检查当前配置是否缺少 `api_key` / `base_url`，并给中文建议。
- 本阶段只保留 usage 记录能力，不做真实费用、cache 命中率或成本统计，这些属于后续 Phase 09。

## 配置项

默认配置来自 `@linghun/config`：

```ts
providers: {
  deepseek: {
    type: 'deepseek',
    baseUrl: process.env.LINGHUN_DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
    apiKey: process.env.LINGHUN_DEEPSEEK_API_KEY,
    model: 'deepseek-v4-flash',
    maxOutputTokens: 8192,
  },
  'openai-compatible': {
    type: 'openai-compatible',
    baseUrl: process.env.LINGHUN_OPENAI_BASE_URL,
    apiKey: process.env.LINGHUN_OPENAI_API_KEY,
    model: process.env.LINGHUN_OPENAI_MODEL ?? 'openai-compatible-model',
    maxOutputTokens: 4096,
  },
}
```

项目级设置路径：

```text
<project>/.linghun/settings.json
```

## 命令

- `linghun model`：查看当前模型、provider、base_url、上下文窗口、最大输出。
- `linghun model set deepseek-v4-pro`：在当前项目设置默认 DeepSeek V4 Pro 1M。
- `linghun model doctor`：诊断缺失的 `api_key` / `base_url`，输出中文建议。
- `linghun /model`：slash 兼容入口。
- `linghun /model set deepseek-v4-pro`：slash 兼容入口。
- `linghun /model doctor`：slash 兼容入口。

## 测试与验证

已运行：

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm build
corepack pnpm check
corepack pnpm typecheck
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
corepack pnpm exec linghun /model
corepack pnpm exec linghun /model doctor
```

补充验证：

```bash
tmpdir=$(mktemp -d) && (cd "$tmpdir" && "F:/Linghun/node_modules/.bin/linghun" /model set deepseek-v4-pro && "F:/Linghun/node_modules/.bin/linghun" /model)
```

结果：

- `corepack pnpm test`：8 个测试文件、28 个测试通过。
- `corepack pnpm build`：通过。
- `corepack pnpm check`：通过。
- `corepack pnpm typecheck`：通过。
- `linghun --version`：输出 `0.1.0`。
- `Linghun --version`：输出 `0.1.0`。
- `linghun --help`：显示 Phase 03 headless model 命令。
- `/model`：显示 `DeepSeek V4 Flash`，上下文 `128000`，最大输出 `8192`。
- `/model doctor`：在无真实 API Key 时识别缺少 `api_key`，给出中文建议。
- `/model set deepseek-v4-pro`：显示 `DeepSeek V4 Pro 1M`，上下文 `1048576`，最大输出 `16384`。
- OpenAI compatible provider 请求构造通过单元测试验证。
- 流式文本、usage 事件、错误归一化通过 mock provider / parser 单元测试验证。

## 性能结果

本阶段未引入 TUI、MCP、Agent 或真实联网启动逻辑。

- `--version` / `--help` 仍保持快速路径，不加载 provider。
- `/model` 命令才动态加载 config/providers。
- `/model doctor` 不联网，只做本地配置检查。

## 已知问题

- 本阶段不强行联网验证真实 DeepSeek API；无真实 API Key 时只通过 mock provider 和 parser 单元测试验证流式事件、usage 和错误归一化。
- `OpenAiCompatibleProvider` 当前只覆盖文本 delta 和 usage；tool call、thinking、vision 不在 Phase 03 范围内。
- `/model set` 是当前项目级 headless 配置写入，不提供完整配置面板；TUI 配置面板属于后续阶段。
- 当前会话的 deferred tools 中没有 `mcp__codebase-memory-mcp__index_repository` / `index_status`，已尝试 `SearchExtraTools` 发现但返回未找到，因此本阶段无法在当前工具环境内刷新 codebase-memory 索引。

## 不在本阶段处理

- 不实现 Phase 04 TUI。
- 不实现工具调用系统。
- 不实现 MCP 或 codebase-memory 接入。
- 不实现 Agent。
- 不实现多模型角色路由。
- 不实现真实缓存命中率、费用统计或省钱估算。
- 不实现 Skills、Plugins、长期任务。
- 不实现 Claude、Gemini、Ollama 等其它 provider。

## 下一阶段衔接

Phase 04 应在当前 headless model 命令和 provider/gateway 基础上实现 TUI 成品骨架闭环：

- 消息列表。
- 输入框。
- 底部状态栏。
- 命令面板。
- 中文 UI。
- 状态栏显示当前模型。

## 开发者排查入口

- Provider / ModelGateway：`packages/providers/src/index.ts`
- Provider 测试：`packages/providers/src/index.test.ts`
- 配置加载与项目级模型设置：`packages/config/src/index.ts`
- 配置测试：`packages/config/src/index.test.ts`
- CLI 模型命令：`apps/cli/src/cli.ts`
- CLI 测试：`apps/cli/src/main.test.ts`
