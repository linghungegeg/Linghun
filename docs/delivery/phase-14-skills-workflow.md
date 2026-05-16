# Phase 14：Skills 与工作流主闭环

## 阶段目标

完成 Linghun Phase 14 主闭环：本地 Skills、Workflow templates、Hooks runtime 诊断面、本地 Plugin manifest loader、启停、信任和权限边界接入。

本轮只交付 Phase 14 主闭环，不进入 Phase 14 hardening 或 Phase 15+。不实现插件市场、GitHub 插件安装、远程安装、自动更新、评分推荐、账号体系、完整沙箱、长期后台 job、Remote Channels、真实联网安装依赖、真实项目 Beta、可控学习或桌面端。

## 已完成功能

- Skill loader：
  - 支持项目级 `.linghun/skills/*.json`。
  - 支持用户级 `~/.linghun/skills/*.json`。
  - summary-first / load-on-demand：默认只读取 metadata、description、triggers、summary、权限和来源；不把 skill 正文塞进 prompt。
  - skill 列表按 id 稳定排序。
  - `/skills` 展示来源、路径、版本、触发词、启用状态、信任状态、权限、是否可能写文件 / 执行命令 / 联网。
  - `/skills add` 显示本地注册路径，不做联网安装。
  - `/skills enable <id>` / `/skills disable <id>` 持久化到 `.linghun/settings.json`，重启后保留。
  - 第三方 skill 未信任时不会启用；启用时显示 trust notice。
- Workflow templates：
  - 内置 `bug-fix`、`review`、`doc-to-code`、`design-to-code`、`release-note`、`refactor-plan`。
  - `/workflows` 展示用途、风险、是否写文件、建议验证命令。
  - `/workflows <name>` 只进入 Start Gate 说明，不自动改文件。
  - workflow 内部写文件、Bash、联网、安装依赖仍必须走现有权限管道。
  - workflow 启动提示包含结束时验证/交付检查。
- Hooks runtime 最小闭环：
  - 支持 hook 事件类型：`PreToolUse`、`PostToolUse`、`Stop`、`Notification`、`Workflow`、`Plugin`。
  - hooks 默认关闭。
  - 项目 hook 必须在 `projectTrusted` 后才显示为可执行。
  - hook 来源来自本地 plugin manifest 的 hook 贡献项；不会绕过权限管道。
  - `/doctor hooks` 展示来源、路径、事件、启用状态、信任状态、timeout、输出截断阈值、最近错误、权限和 cache 影响 hash。
  - hook 输出边界以 `outputLimitBytes` 与 `logPath` 表达；主闭环不执行 hook 正文。
- Plugin manifest loader：
  - 支持项目级 `.linghun/plugins/*.json`。
  - 支持用户级 `~/.linghun/plugins/*.json`。
  - 只做本地 manifest loader、启停、doctor、失败隔离和权限接入。
  - plugin source 分级：`local` / `official` / `third-party`。
  - plugin 可贡献摘要：commands、mcpServers、providers、hooks、workflows、skills。
  - plugin 贡献项稳定排序。
  - plugin 加载失败被隔离为 disabled 项并显示 lastError，不影响主会话。
  - `/plugins`、`/plugins doctor`、`/plugins enable <id>`、`/plugins disable <id>` 已接入。
- Trust / permission / cache 边界：
  - 第三方 skill/plugin 首次启用前输出来源、路径、版本、权限、信任状态、是否会联网/执行命令/写文件。
  - 未信任第三方 skill/plugin 不会启用。
  - plugin/skill/hook metadata、贡献点、summary 稳定排序。
  - `pluginListHash` 现在基于 skills/workflows/hooks/plugins 的稳定摘要计算，接入 `/cache status` 与 `/break-cache status` changedKeys。
  - 不把完整 skill、完整 plugin manifest、完整 hook 日志或大输出塞入 prompt / 状态栏。
- TUI / help 可见：
  - `/skills`
  - `/skills add`
  - `/skills enable <id>`
  - `/skills disable <id>`
  - `/workflows`
  - `/workflows <name>`
  - `/plugins`
  - `/plugins doctor`
  - `/plugins enable <id>`
  - `/plugins disable <id>`
  - `/doctor hooks`
  - `/help` 与 CLI `--help` 展示 Phase 14 入口。

## 使用方式

构建后进入 REPL：

```bash
corepack pnpm build
corepack pnpm exec linghun
```

本地 skill manifest 示例：

```json
{
  "id": "bug-helper",
  "name": "Bug Helper",
  "source": "third-party",
  "version": "1.0.0",
  "description": "Help debug local failures.",
  "triggers": ["bug", "failure"],
  "summary": "Stable summary only.",
  "permissions": ["write", "bash"]
}
```

放置位置：

```text
<project>/.linghun/skills/bug-helper.json
~/.linghun/skills/bug-helper.json
```

本地 plugin manifest 示例：

```json
{
  "id": "local-tools",
  "name": "Local Tools",
  "source": "third-party",
  "version": "0.1.0",
  "description": "Local manifest contributions.",
  "permissions": ["network", "bash"],
  "contributions": {
    "commands": ["/local-test"],
    "hooks": ["PreToolUse"],
    "workflows": ["bug-fix"],
    "skills": ["bug-helper"],
    "providers": ["local-provider"],
    "mcpServers": ["local-mcp"]
  }
}
```

放置位置：

```text
<project>/.linghun/plugins/local-tools.json
~/.linghun/plugins/local-tools.json
```

常用命令：

```text
/skills
/skills add
/skills enable bug-helper
/skills disable bug-helper
/workflows
/workflows bug-fix
/plugins
/plugins doctor
/plugins enable local-tools
/plugins disable local-tools
/doctor hooks
/cache status
/break-cache status
```

## 涉及模块

- `packages/config/src/index.ts`：新增 Phase 14 config schema、默认配置、启停持久化 `saveExtensionEnablement()`。
- `packages/config/src/index.test.ts`：覆盖 skills/workflows/hooks/plugins 默认配置与启停持久化。
- `packages/tui/src/index.ts`：新增 skill/plugin manifest loader、workflow templates、hooks doctor、trust notice、Phase 14 slash commands、extension freshness summary。
- `packages/tui/src/index.test.ts`：覆盖 `/skills`、`/skills add`、`/skills enable/disable`、`/workflows`、`/workflows bug-fix`、`/plugins`、`/plugins doctor`、`/plugins enable/disable`、`/doctor hooks`、`/break-cache status`。
- `apps/cli/src/cli.ts`：CLI help 更新到 Phase 14。
- `apps/cli/src/main.test.ts`：CLI help 测试更新到 Phase 14。
- `docs/delivery/README.md`：Phase 14 标记 done。
- `README.md`：当前进度同步到 Phase 00-14 完成。
- `START_NEXT_CHAT.md`：下一会话 handoff 更新到 Phase 14 主闭环完成。

## 关键设计

- 本地优先：Phase 14 主闭环只读取本地 manifest，不做联网安装、GitHub 安装或插件市场。
- summary-first：skills 只进入稳定摘要层，正文必须在任务触发且用户需要时才读取。
- 信任先行：第三方来源默认未信任；enable 时写入 trustedIds，未信任不执行高风险能力。
- 权限不可绕过：workflow/hook/plugin 贡献工具仍走 Linghun 现有权限管道。
- 失败隔离：manifest 解析失败不会拖垮 TUI；插件失败项显示到 doctor。
- cache 稳定：只用排序后的 metadata、summary、贡献项和权限计算 extension freshness，不引入动态日志、时间戳或大输出。

## 配置项

`.linghun/settings.json` 新增：

```json
{
  "skills": {
    "enabled": true,
    "projectDir": ".linghun/skills",
    "userDir": "~/.linghun/skills",
    "disabledIds": [],
    "trustedIds": []
  },
  "workflows": {
    "enabled": true,
    "disabledIds": []
  },
  "hooks": {
    "enabled": false,
    "timeoutMs": 5000,
    "outputLimitBytes": 4096,
    "projectTrusted": false,
    "disabledIds": [],
    "trustedIds": []
  },
  "plugins": {
    "enabled": true,
    "projectDir": ".linghun/plugins",
    "userDir": "~/.linghun/plugins",
    "disabledIds": [],
    "trustedIds": []
  }
}
```

## 命令

CLI：

```bash
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
corepack pnpm exec linghun
```

REPL：

```text
/help
/skills
/skills add
/skills enable <id>
/skills disable <id>
/workflows
/workflows bug-fix
/plugins
/plugins doctor
/plugins enable <id>
/plugins disable <id>
/doctor hooks
/model route doctor
/usage
/stats
/cache status
/break-cache status
/index status
/exit
```

## 测试与验证

阶段要求执行：

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm check
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
printf '/skills\n/skills add\n/skills disable bug-helper\n/workflows\n/workflows bug-fix\n/plugins\n/plugins doctor\n/plugins disable local-tools\n/doctor hooks\n/model route doctor\n/usage\n/stats\n/cache status\n/break-cache status\n/index status\n/exit\n' | corepack pnpm exec linghun
```

已执行：

- `corepack pnpm exec tsc --noEmit --pretty false`：通过，无输出。
- `corepack pnpm test -- --run packages/config/src/index.test.ts packages/tui/src/index.test.ts apps/cli/src/main.test.ts`：通过，10 个测试文件、73 个测试通过。
- `corepack pnpm test`：通过，10 个测试文件、73 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过，workspace 7 个包构建通过。
- `corepack pnpm check`：通过，41 个文件检查通过。
- `corepack pnpm exec linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec Linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec linghun --help`：通过，输出 Phase 14 CLI help，并列出 `/skills`、`/workflows <name>`、`/plugins doctor`、`/doctor hooks`。
- TUI stdin smoke：通过，覆盖 `/skills`、`/skills add`、`/skills disable`、`/workflows`、`/workflows bug-fix` Start Gate、`/plugins`、`/plugins doctor`、`/plugins disable`、`/doctor hooks`、`/model route doctor`、`/usage`、`/stats`、`/cache status`、`/break-cache status`、`/index status`、`/exit`。

## 性能结果

- `--version` / `--help` 仍为快速路径，不加载 TUI、模型、MCP、索引、验证器、插件或 cache 统计系统。
- `/skills` 和 `/plugins` 只扫描本地 JSON manifest 文件并输出短摘要。
- `/workflows` 是内置模板格式化，不调用模型。
- `/doctor hooks` 只读取本地贡献摘要，不执行 hook 正文。
- 状态栏不显示完整 plugin/skill/hook 列表，不显示金额。

## 已知问题

- Phase 14 主闭环只读取 JSON manifest，不读取/执行完整 skill 正文或 hook 脚本。
- hook runtime 当前是诊断和边界闭环：不实际执行 PreToolUse/PostToolUse/Stop/Notification hook 脚本。
- plugin 贡献项只作为摘要展示，尚未把 plugin command/provider/mcpServer 注册进真实执行层。
- workflow 只提供 Start Gate 路径和建议验证，不自动串联完整任务执行器。
- 不做完整 sandbox；第三方能力以未信任禁用、trust notice 和权限管道约束。

## 不在本阶段处理的内容

- 不进入 Phase 14 hardening。
- 不进入 Phase 15 真实项目 Beta。
- 不实现 GitHub 插件安装、插件市场、远程安装、自动更新、评分推荐、商业化或账号体系。
- 不实现完整沙箱运行时。
- 不实现长期任务 / Remote Channels。
- 不实现 Phase 16 自动学习 / skill 固化。
- 不做真实联网安装依赖。
- 不复制 CCB / OpenCode / Hermes / oh-my-openagent 可疑源码。

## 下一阶段衔接

建议下一步进入 Phase 14 hardening，但必须由用户明确确认后再开始。Phase 14 hardening 可聚焦：

- hook 实际执行前后的更细权限闸门与 timeout 实测。
- hook 输出截断和 logPath 写入实测。
- manifest schema 兼容性和错误报告增强。
- plugin/skill list hash 在真实 enable/disable 后的 cache changedKeys 回归。
- workflow 结束时验证/交付检查更强约束。

不得在 hardening 中顺手做插件市场、GitHub 安装、远程安装、自动更新、长期任务或 Phase 15+ 能力。

## 开发者排查入口

- `/skills`：检查 skill loader、启用状态、信任状态、权限摘要。
- `/plugins doctor`：检查 plugin manifest、来源、权限、lastError。
- `/doctor hooks`：检查 hook 事件、项目是否 trusted、timeout/outputLimit/logPath/cacheImpactHash。
- `/break-cache status`：检查 `pluginListHash` 与 changedKeys。
- `.linghun/settings.json`：检查 `skills.disabledIds/trustedIds` 和 `plugins.disabledIds/trustedIds`。

## 参考核对

本阶段实际读取并遵守：

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-13-multi-model.md`
- `F:\Linghun\docs\delivery\ccb-dev-boost-coverage-checklist.md`
- `F:\Linghun\START_NEXT_CHAT.md`

本阶段参考内容：

- Linghun 蓝图和规格书中的 Phase 14 范围、验收、性能和禁止事项。
- CCB / CCB Dev Boost 只参考行为边界：summary-first、稳定排序、cache hash、权限不可绕过、doctor 面板、失败隔离和大输出不进 prompt。
- OpenCode / Hermes / oh-my-openagent 只参考公开产品方向：skills、hooks、workflow、插件化、诊断面板和失败隔离。

进入 Linghun 自研实现的内容：本地 JSON manifest loader、稳定摘要、启停持久化、trust notice、workflow 模板、hooks doctor、extension freshness hash。

未复制 CCB / OpenCode / Hermes / oh-my-openagent 可疑源码、内部 API、反编译痕迹、专有遥测或内部服务逻辑。

## 成品级结构化 handoff packet

```json
{
  "phase": "Phase 14",
  "phaseStatus": "main-loop-completed",
  "nextPhase": "Phase 14 hardening",
  "mustNotDo": [
    "不要进入 Phase 15+，除非用户明确确认",
    "不要实现插件市场/GitHub 安装/远程安装/自动更新",
    "不要实现长期任务/Remote Channels/桌面端",
    "不要把完整 skill/plugin/hook 日志塞进 prompt 或状态栏",
    "不要让 workflow/hook/plugin 绕过 Start Gate、Plan、权限审批和验证闭环"
  ],
  "completed": [
    "本地 skill manifest loader 与 /skills 系列命令",
    "6 个 workflow templates 与 /workflows Start Gate 路径",
    "本地 plugin manifest loader 与 /plugins 系列命令",
    "hooks 默认关闭与 /doctor hooks 诊断",
    "trust notice 与启停持久化",
    "pluginListHash 接入 extension freshness"
  ],
  "pending": [
    "Phase 14 hardening：hook timeout/logPath 实测、输出截断实测、schema 兼容性增强、workflow 结束检查强化",
    "Phase 15：真实项目 Beta 与 provider usage / 账单抽样对账"
  ],
  "evidenceRefs": [
    "packages/tui/src/index.ts",
    "packages/config/src/index.ts",
    "packages/tui/src/index.test.ts",
    "packages/config/src/index.test.ts",
    "apps/cli/src/cli.ts",
    "apps/cli/src/main.test.ts",
    "docs/delivery/phase-14-skills-workflow.md"
  ],
  "verification": {
    "required": [
      "corepack pnpm test",
      "corepack pnpm typecheck",
      "corepack pnpm build",
      "corepack pnpm check",
      "corepack pnpm exec linghun --version",
      "corepack pnpm exec Linghun --version",
      "corepack pnpm exec linghun --help",
      "TUI smoke"
    ],
    "status": "passed"
  },
  "indexStatus": {
    "project": "F-Linghun",
    "status": "ready",
    "nodes": 657,
    "edges": 1214
  },
  "permissionMode": "default Claude Code session permissions plus repository permission pipeline",
  "modelProvider": {
    "assistant": "claude-sonnet-4-6",
    "linghunDefaultProvider": "deepseek",
    "linghunDefaultModel": "deepseek-v4-flash"
  },
  "budgetUsage": "本阶段未使用用户提供的临时 provider key；本地验证不调用外部模型。"
}
```
