# Phase 01：工程骨架闭环

## 目标

建立 Linghun 的 Phase 01 工程骨架，形成可安装、可构建、可测试、可执行的 pnpm monorepo 空壳。

本阶段只处理工程骨架，不实现模型、TUI、Agent、MCP、缓存、插件、长期任务等后续功能。

## 本阶段范围

- 建立 pnpm monorepo。
- 使用 TypeScript strict 配置。
- 使用 Vitest 做最小单元测试。
- 使用 Biome 做格式与静态检查。
- 使用 tsup 构建 workspace 包和 CLI。
- 创建 Phase 01 要求的基础目录：
  - `apps/cli`
  - `packages/core`
  - `packages/shared`
  - `packages/config`
  - `packages/tui`
  - `packages/providers`
  - `packages/tools`
- 实现 CLI 空壳：
  - `linghun --version`
  - `linghun --help`
  - Windows 兼容入口 `Linghun --version`
- 创建配置目录占位 `.linghun/.gitkeep`。
- 建立最小日志系统和错误类型。
- 建立 CI/验证脚本入口。

## 已完成功能

- 根目录新增 `package.json`、`pnpm-workspace.yaml`、`tsconfig.json`、`tsconfig.base.json`、`biome.json`、`vitest.config.ts`。
- `apps/cli` 提供可构建的 CLI 入口。
- `@linghun/shared` 提供项目名、CLI 名和版本常量。
- `@linghun/core` 提供 Phase 01 最小 `LinghunError` 与 `createLogger`。
- `@linghun/config` 提供默认配置结构和 `.linghun` 配置目录创建函数。
- `@linghun/tui`、`@linghun/providers`、`@linghun/tools` 仅提供占位导出，避免提前实现后续阶段能力。
- 根包通过 `dependencies` 链接 `@linghun/cli`，使 `pnpm exec linghun` / `pnpm exec Linghun` 可用于验收。

## 使用方式

首次安装：

```bash
corepack pnpm install
```

构建：

```bash
corepack pnpm build
```

测试：

```bash
corepack pnpm test
```

CLI 空壳：

```bash
corepack pnpm exec linghun --version
corepack pnpm exec linghun --help
corepack pnpm exec Linghun --version
```

如果本机已经把 pnpm 放入 PATH，也可以直接使用蓝图中的命令：

```bash
pnpm install
pnpm test
pnpm build
pnpm exec linghun --version
pnpm exec Linghun --version
```

## 涉及模块

- `apps/cli`：CLI 空壳入口。
- `packages/shared`：共享常量和基础类型。
- `packages/core`：错误类型与日志系统。
- `packages/config`：默认配置与配置目录路径。
- `packages/tui`：Phase 04 前的 TUI 占位包。
- `packages/providers`：Phase 03 前的 provider 占位包。
- `packages/tools`：Phase 05 前的 tools 占位包。

## 关键设计

- `linghun --version` 的执行路径只导入 `apps/cli/src/cli.ts` 与 `@linghun/shared` 常量，不加载配置、模型、MCP 或 TUI。
- `Linghun` 作为兼容入口映射到同一个 CLI 文件，行为与 `linghun` 一致。
- 后续阶段包只做空壳占位，避免 Phase 01 提前实现业务能力。
- 根脚本使用 `corepack pnpm -r build`，避免当前 shell 中没有全局 `pnpm` 时递归构建失败。

## 配置项

本阶段没有可用的用户配置项。

已建立配置目录约定：

- 用户配置目录：`~/.linghun`
- 项目配置目录：`<project>/.linghun`

`@linghun/config` 仅提供默认配置和目录创建函数，实际配置加载优先级将在后续阶段实现。

## 命令

- `linghun --version`：输出当前版本号。
- `linghun --help`：输出 Phase 01 CLI 空壳帮助。
- `Linghun --version`：Windows 兼容入口，输出与 `linghun --version` 一致。

本阶段 CLI 明确提示：不会加载模型、MCP 或 TUI。

## 测试与验证

已运行：

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm build
corepack pnpm check
corepack pnpm typecheck
node "F:/Linghun/apps/cli/dist/main.js" --version
node "F:/Linghun/apps/cli/dist/main.js" --help
corepack pnpm exec linghun --version
corepack pnpm exec linghun --help
corepack pnpm exec Linghun --version
```

结果：

- `corepack pnpm install`：通过。
- `corepack pnpm test`：4 个测试文件、6 个测试通过。
- `corepack pnpm build`：通过，7 个 workspace 构建成功。
- `corepack pnpm check`：通过。
- `corepack pnpm typecheck`：通过。
- `linghun --version`：输出 `0.1.0`。
- `linghun --help`：输出帮助文本。
- `Linghun --version`：输出 `0.1.0`。

说明：当前环境没有全局 `pnpm` 命令，直接运行 `pnpm install` 会失败；通过 Node.js 自带 Corepack 执行 `corepack pnpm install` 验证通过。

## 性能结果

对构建后的 CLI 执行 5 次 `--version` 启动耗时测量：

```text
113.69ms
107.11ms
99.08ms
94.67ms
158.77ms
max=158.77ms
```

结果满足 Phase 01 要求：`linghun --version` 小于 300ms。

`--version` 路径没有加载模型、MCP 或 TUI。

## 已知问题

- 当前机器未安装全局 `pnpm`，需要使用 `corepack pnpm ...`，或由开发者自行启用/安装 pnpm 后使用蓝图中的 `pnpm ...` 命令。
- `pnpm install` 输出提示 `@biomejs/biome` 与 `esbuild` 的 build scripts 被忽略；本阶段的 `test`、`build`、`check` 均已通过，暂不扩大处理。

## 不在本阶段处理

- 不实现模型网关。
- 不实现 TUI 交互。
- 不实现 Session / transcript。
- 不实现 MCP、codebase-memory、缓存、成本统计。
- 不实现工具系统、权限系统、Plan、Agent、Skills、插件或长期任务。
- 不实现真实配置加载和 provider 配置。

## 下一阶段衔接

Phase 02 应在当前骨架上实现 Session 与会话持久化闭环：

- `Session` 类。
- JSONL transcript。
- 项目识别。
- 会话列表与恢复。
- 避免全局 mutable state。

## 开发者排查入口

- CLI 入口：`apps/cli/src/main.ts`
- CLI 纯逻辑：`apps/cli/src/cli.ts`
- 共享常量：`packages/shared/src/index.ts`
- 错误与日志：`packages/core/src/index.ts`
- 配置目录：`packages/config/src/index.ts`
- Workspace 配置：`pnpm-workspace.yaml`
- 根脚本：`package.json`
- 测试配置：`vitest.config.ts`
- Biome 配置：`biome.json`
