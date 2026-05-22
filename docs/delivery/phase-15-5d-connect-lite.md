# Phase 15.5D：Connect Lite

## 阶段目标

本轮只完成 Pre-Open-Source Terminal Product Completion Gate 的 Phase 15.5D：MCP / Skills / Plugins Connect Lite。范围限定为显式 add/install、validate、enable/disable、remove/update、trust notice、doctor/status、来源/commit/权限记录、失败隔离和 discovery-before-execute runtime guard。

本轮不进入 Phase 15.5E/F，不进入 Phase 16/17/18，不执行真实全量 smoke，不声明 Beta PASS、smoke-ready 或 open-source-ready，不提交 commit，不实现插件市场、skill 市场、评分推荐、云同步、自动更新、商业化账号、完整远程工作台、provider/freshness、durable jobs、Virtual Agent Concurrency 或 remote channels。

## Resume Reality Check 摘要

- existing diff：恢复时 `git status --short` 只有 4 个 modified 文件：`packages/config/src/index.ts`、`packages/config/src/index.test.ts`、`packages/tui/src/index.ts`、`packages/tui/src/index.test.ts`；本报告文件当时不存在。
- completed items：中断前已开始 15.5D Connect Lite：config 已有 MCP source/trust/commit/permissionSummary 持久化；TUI 已有 skills/plugins install/status/validate/enable/disable/remove/update 和 MCP add/validate/enable/disable/update/remove 草稿。
- remaining items：需要确认 runtime guard、Git/GitHub 安装边界、测试覆盖、阶段报告和口径收口。
- risky/incomplete areas：代码 diff 已存在但交付报告缺失；Git/GitHub 安装必须确认不执行仓库脚本、postinstall、hook 或任意第三方命令；不得把未执行的联网 clone/fetch 写成真实 smoke 证据。
- minimal next actions：只精读并补齐当前 15.5D 相关实现和 focused tests；新增本阶段报告；运行最小相关验证；不进入后续阶段。

## 已完成功能

- MCP Connect Lite：新增 `/mcp add local <server-id> <command> [args...]`、`/mcp validate [id]`、`/mcp enable|disable <id>`、`/mcp update <id> local <command> [args...]`、`/mcp remove <id>`。
- MCP source/trust 持久化：`McpServerConfig` 记录 `sourceUrl`、`localPath`、`ref`、`commit`、`scope`、`installedAt`、`trustLevel`、`permissionSummary`，并提供保存/删除 helper。
- MCP add/update 本阶段只写 metadata，不执行 server；`/mcp doctor` 才沿用既有受控诊断路径，失败隔离，不影响普通聊天、本地工具和 cache/status。
- Skills Connect Lite：支持 `/skills install|add local <path>`、Git URL、`github <owner/repo>`、`github:owner/repo`；支持 `validate`、`enable/disable`、`remove`、`update`；安装时只读取 manifest / metadata / `SKILL.md`，不执行第三方代码。
- Plugins Connect Lite：支持 `/plugins install|add local <path>`、Git URL、GitHub repo 形式；支持 `validate`、`enable/disable`、`remove`、`update`；安装时只读取 manifest / metadata，不执行仓库脚本、postinstall、hook、依赖安装或任意第三方代码。
- Git/GitHub 安装边界：未带 `--confirm-network` 时只输出 Connect Lite Start Gate 和 exact command；带确认后只做受控 `git clone --depth 1` + `git rev-parse HEAD`，并通过 `core.hooksPath=/dev/null` 与 `--` 参数边界降低 hook / option 注入风险；安装后复制 manifest metadata 到 Linghun 目录，并记录 exact-command Start Gate audit event。
- Trust notice：local / Git / GitHub 安装后的 skill/plugin 默认保持 untrusted + disabled；`source=local` 不自动 trusted/enabled，也不自动放行 write/execute/network；首次启用前展示来源、路径、版本、sourceUrl、ref/commit、installedAt、permissions、trust、mayWrite/mayExecute/mayNetwork，并说明实际工具调用仍走权限管道。
- Discovery-before-execute：新增 `validateExtensionContributionExecution()` runtime guard；skill action / plugin command 在未发现、未启用、未信任、未 register、schema 未加载、runtime 不兼容或贡献项未声明时拒绝执行，不只依赖 prompt 文案。
- 失败隔离：manifest 读取失败会形成 disabled/untrusted summary，`validate` / doctor 可见；Git/GitHub 安装失败返回摘要，不覆盖已有启用项；plugin/skill guard 拒绝不会拖垮主会话。
- 状态/doctor 输出：skills/plugins status 显示 lifecycle、disabled/trusted ids、source/localPath、ref/commit、permissions、discovered/registered/schemaLoaded/runtime 和 loadError；MCP validate 显示 source/ref/commit/permissions 和下一步。

## 使用方式

```text
/mcp status
/mcp doctor
/mcp validate [server-id]
/mcp add local <server-id> <command> [args...]
/mcp update <server-id> local <command> [args...]
/mcp enable <server-id>
/mcp disable <server-id>
/mcp remove <server-id>

/skills status
/skills doctor
/skills validate [skill-id]
/skills install local <path> [--scope project|user]
/skills install git <url> [--ref <ref>] --confirm-network
/skills install github <owner/repo> [--ref <ref>] --confirm-network
/skills install github:<owner/repo> [--ref <ref>] --confirm-network
/skills enable <skill-id>
/skills disable <skill-id>
/skills update <skill-id> [--ref <ref>] [--confirm-network]
/skills remove <skill-id>

/plugins status
/plugins doctor
/plugins validate [plugin-id]
/plugins install local <path> [--scope project|user]
/plugins install git <url> [--ref <ref>] --confirm-network
/plugins install github <owner/repo> [--ref <ref>] --confirm-network
/plugins install github:<owner/repo> [--ref <ref>] --confirm-network
/plugins enable <plugin-id>
/plugins disable <plugin-id>
/plugins update <plugin-id> [--ref <ref>] [--confirm-network]
/plugins remove <plugin-id>
```

说明：

- Git/GitHub install 如果没有 `--confirm-network`，只显示 Start Gate，不联网、不 clone。
- 本轮 tests 只覆盖 local install 和 Git/GitHub Start Gate；未执行真实联网 clone/fetch，也不把联网安装写成 smoke 证据。
- MCP 本阶段只支持 local command 注册；Git/GitHub 安装只用于 skills/plugins。
- local / Git / GitHub 安装后的 skill/plugin 默认 untrusted + disabled；启用前有 trust notice；`source=local` 不会自动绕过 write / execute / network 边界，真正执行贡献工具仍必须经过 runtime guard 和既有权限管道。

## 涉及模块

- `packages/config/src/index.ts`：扩展 MCP server config metadata，新增 `saveMcpServerConfig()` / `removeMcpServerConfig()` / `resetExtensionTrustForInstall()`，校验 source/trust/commit/permissionSummary 字段。
- `packages/config/src/index.test.ts`：覆盖 MCP source/trust 记录的保存、禁用、删除，以及 local reinstall 后 trust reset。
- `packages/tui/src/index.ts`：Connect Lite lifecycle、Git/GitHub Start Gate audit event、受控 clone/fetch、manifest 读取、trust notice、status/validate/doctor、MCP local lifecycle、discovery-before-execute guard。
- `packages/tui/src/index.test.ts`：覆盖 skills/plugins local install 默认未信任/禁用、enable 后才通过 guard、Git/GitHub Start Gate、enable/disable/update、trust notice、plugin/skill guard、MCP local lifecycle 不执行 server。
- `docs/delivery/phase-15-5d-connect-lite.md`：本交付报告。

## Source-Level Reality Check 摘要

### Existing implementation

- Phase 14 已有 skills/plugins 本地 manifest loader、启停、trust ids、doctor、hooks/plugins 状态和失败隔离基础。
- Phase 15.5C 已有 MCP required-args/static registry guard、MCP status/doctor metadata、codebase-memory fast status 和 failure isolation。
- Config 已有 project/user settings 读写、敏感 provider key 写入剥离、extension enablement 持久化。
- TUI 已有 slash command dispatch、summary-first status/doctor、permission pipeline、cache freshness 和 test context。

### Gaps

- MCP server lifecycle 缺少显式 add/update/remove/enable/disable 和 source/trust/permission metadata 持久化。
- Skills/plugins 只有本地 loader/启停底座，缺少显式 install/update/remove lifecycle、Git/GitHub Start Gate、来源/commit/权限记录、trust notice 和安装失败隔离口径。
- 延迟贡献工具缺少统一 discovery-before-execute runtime guard，不能只靠 prompt 说明模型不要盲执行。
- 阶段报告缺失，恢复时存在代码/文档口径不闭合风险。

### Minimal touch points

- 只扩展既有 config 和 TUI runtime；没有新增第二套 MCP manager、插件市场、skill 市场、权限系统、provider/freshness、job/agent/remote runtime。
- Git/GitHub install 只走受控 clone/fetch 和 manifest/SKILL.md 读取；不安装依赖，不执行第三方命令。
- Focused tests 只覆盖本阶段 lifecycle/guard，不扩大到 provider、freshness、durable jobs 或真实 smoke。

### Forbidden duplicate systems

本轮未新增插件市场、skill 市场、评分推荐、云同步、自动更新、商业化账号、完整远程工作台、完整沙箱、第二套 MCP manager、第二套权限管道、第二套 provider/freshness、第二套 durable job / agent / remote channel runtime；未复制 CCB、OpenCode、MCP 官方或其他第三方源码实现、内部 API、专有遥测或反编译痕迹。

## 关键设计

### Connect Lite Start Gate

Git/GitHub 安装属于联网和第三方来源风险。未显式追加 `--confirm-network` 时，Linghun 只输出：source、scope、ref、风险、边界、失败恢复和 exact command。`--confirm-network` 只是 exact-command Start Gate confirmation，不是完整 permission approval；确认后会先写入 `connect_lite_network_start_gate_confirmed` audit event，再执行受控 clone/rev-parse。后续若实际执行工具、写文件、Bash 或联网仍走既有权限边界。

### Manifest-only install

安装路径只读取以下输入：

- Skill：`skill.json`、`linghun-skill.json`、`manifest.json`、`metadata.json`，或 `SKILL.md` 的标题和首段摘要。
- Plugin：`plugin.json`、`linghun-plugin.json`、`manifest.json`、`metadata.json`。

安装结果写入 Linghun 管理目录中的 JSON manifest，附加 lifecycle metadata。不会执行 `postinstall`、hook、仓库脚本、依赖安装或任意第三方代码。

### Discovery-before-execute runtime guard

`validateExtensionContributionExecution(kind, id, contribution, context)` 是本阶段的轻量执行层兜底：

- 未发现 id：拒绝。
- 未启用或未信任：拒绝。
- 未完成 discovered / registered / schemaLoaded：拒绝。
- runtimeVersion 不兼容：拒绝。
- skill trigger 未声明或 plugin contribution 未注册：拒绝。

拒绝消息只给可操作下一步，不输出完整 schema、密钥、token 或敏感配置。

### MCP local lifecycle

MCP 本阶段只支持 local command 注册和 metadata lifecycle：

- `add/update` 只写 settings metadata，不执行 server。
- `validate` 基于当前 config/MCP state 输出 source/ref/commit/permissions 和问题摘要。
- `doctor` 沿用既有受控诊断与 failure isolation。
- `remove/disable` 不影响普通聊天和本地工具。

## 配置项

本阶段没有新增用户必须手写的新顶层配置项；扩展了既有 `.linghun/settings.json` 的 MCP server metadata 字段：

- `sourceUrl`
- `localPath`
- `ref`
- `commit`
- `scope`
- `installedAt`
- `trustLevel`
- `permissionSummary`

敏感 provider apiKey 仍按既有 `removeSensitiveProjectSettings()` 边界不写入项目 settings。

## 命令

新增或扩展的用户可见命令：

- `/mcp validate [id]`
- `/mcp add local <server-id> <command> [args...]`
- `/mcp update <server-id> local <command> [args...]`
- `/mcp enable|disable <server-id>`
- `/mcp remove <server-id>`
- `/skills status|doctor|validate [id]`
- `/skills install|add local|git|github ...`
- `/skills enable|disable|remove|update <id>`
- `/plugins status|doctor|validate [id]`
- `/plugins install|add local|git|github ...`
- `/plugins enable|disable|remove|update <id>`

## 测试与验证

Focused tests（本轮已执行）：

- `corepack pnpm exec vitest run packages/config/src/index.test.ts packages/tui/src/index.test.ts -t "Phase 15.5D|Connect Lite"`：PASS（2 files，4 passed，148 skipped）。

Package / repository validation（本轮已执行）：

- `corepack pnpm exec vitest run packages/tui/src/index.test.ts`：PASS（1 file，131 tests）。
- `corepack pnpm exec vitest run packages/config/src/index.test.ts`：PASS（1 file，21 tests）。
- `corepack pnpm typecheck`：PASS。
- `corepack pnpm check`：PASS。
- `corepack pnpm build`：PASS。
- `git diff --check`：PASS（仅 Windows LF/CRLF warning，无 whitespace error）。

本轮不执行真实全量 smoke；focused/local validation 不构成 Beta PASS、smoke-ready 或 open-source-ready 声明。

## 性能结果

- Skills/plugins status 只展示稳定 metadata、短摘要和 lifecycle 字段，不把完整 skill 正文、完整 plugin schema 或完整仓库内容塞进 prompt。
- Git/GitHub install 只在用户显式确认后 clone shallow depth 1 到临时目录，读取 manifest 后删除临时目录；未实现后台自动更新或常驻 watcher。
- MCP add/update 只写 config metadata，不启动 server；doctor 失败隔离，不阻塞普通聊天。
- 动态字段只进入 status/doctor/report，不进入稳定 prompt 层；清单稳定排序延续既有 loader 行为。

## 已知问题

- GitHub/Git URL 安装的真实联网 clone/fetch 未在本轮验证中执行；当前只通过 Start Gate 和本地 manifest install focused tests 覆盖。
- Connect Lite 没有实现 subdir 选择、完整 semver/Linghun API 兼容矩阵、权限差异可视 diff 或完整 sandbox。
- MCP 本阶段只支持 local command 注册；未实现 stdio/http/sse transport 参数矩阵、env/header 脱敏 UI 或远程 MCP 安装。
- `/skills search <query>` 本轮未实现为市场/远程搜索；当前等价 discover 是本地 status/doctor/validate 和 manifest install。市场/推荐不在本阶段。
- 本轮未执行真实全量 smoke，因此不能宣称真实项目完整链路通过。

## 不在本阶段处理的内容

- Phase 15.5E Provider & Freshness。
- Phase 15.5F Terminal Product Readiness。
- Phase 16/17/18。
- provider/freshness/web evidence。
- 插件市场、skill 市场、评分推荐、云同步、自动更新、商业化账号。
- 完整远程工作台、个人微信、企业远程 channels。
- Durable jobs / Virtual Agent Concurrency / remote channels。
- 完整 sandbox、依赖安装器、插件 API SDK、发布平台。
- 真实全量 smoke、Beta PASS、smoke-ready、open-source-ready 决策。
- commit。

## 下一阶段衔接

Phase 15.5D 完成后必须停止，由用户决定是否进入 Phase 15.5E Provider & Freshness。不得自动进入 Phase 15.5E/F、Phase 16/17/18，也不得把本轮 focused/local validation 解释为真实全量 smoke 或产品 ready。

## 开发者排查入口

- Config MCP metadata：`packages/config/src/index.ts` 的 `McpServerConfig`、`saveMcpServerConfig()`、`removeMcpServerConfig()`、`validateMcp()`。
- Skills/plugins lifecycle：`packages/tui/src/index.ts` 的 `parseExtensionInstallRequest()`、`installExtensionFromRequest()`、`installExtensionFromDirectory()`、`readExtensionSourceManifest()`、`removeExtension()`、`updateExtension()`。
- Trust notice/status/validate：`formatTrustNotice()`、`formatExtensionStatus()`、`validateExtensionItems()`。
- Runtime guard：`validateExtensionContributionExecution()`。
- MCP lifecycle：`addMcpServer()`、`setMcpServerEnabled()`、`updateMcpServer()`、`removeMcpServer()`、`validateMcpServers()`。
- Focused tests：`packages/config/src/index.test.ts`、`packages/tui/src/index.test.ts` 的 Phase 15.5D / Connect Lite tests。

## 参考核对

本阶段实际读取的 Linghun 文档：

- `F:\Linghun\START_NEXT_CHAT.md`
- `F:\Linghun\docs\delivery\pre-open-source-terminal-product-completion-gate.md`
- `F:\Linghun\docs\audit\reference-map.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\phase-15-5c-editing-tool-ux.md`
- `F:\Linghun\docs\delivery\phase-15-5c-plus-log-artifact-runtime-lite.md`
- `F:\Linghun\docs\delivery\phase-15-5c-plus-plus-workspace-snapshot-lite.md`
- `F:\Linghun\docs\delivery\README.md`

本阶段参考核对范围：

- 只参考 CCB / Claude Code Best、OpenCode、MCP 官方生态、Hermes Agent、codebase-memory-mcp 等成熟生态的公开行为边界：显式 install/add、validate、enable/disable、remove/update、trust notice、doctor、source/commit/permission 记录、失败隔离和 discovery-before-execute。
- 进入 Linghun 自研实现的内容：Connect Lite local/Git/GitHub install lifecycle、MCP local lifecycle metadata、trust notice、runtime guard、focused tests 和交付报告。
- 未复制 CCB、OpenCode、Hermes、MCP 官方或其他第三方可疑源码实现、内部 API、专有遥测或内部服务逻辑。

### Reference delta catch-up 裁决表

| 来源细节 | 裁决 | Phase 15.5D 处理 |
| --- | --- | --- |
| gate / spec：MCP / Skills / Plugins Connect Lite 独立验收 | DONE | 本报告独立收口 15.5D，不混入 15.5E/F。 |
| blueprint：显式 add/install、validate、enable/disable、remove/update | DONE | MCP local lifecycle；skills/plugins install/update/remove/enable/disable/validate。 |
| blueprint/spec：Git/GitHub 安装 skills/plugins | DONE（受控边界） | 支持 Git URL、`github owner/repo`、`github:owner/repo`；真实联网需 `--confirm-network`。 |
| safety：安装前只读取 manifest / SKILL.md / metadata，不执行仓库脚本 | DONE | install helper 只读 JSON manifest 或 SKILL.md；不执行第三方代码。 |
| safety：Git/GitHub 安装不能执行 postinstall/hook | DONE | 不运行包管理器或脚本；git clone 使用 `core.hooksPath=/dev/null`，且只做 clone/rev-parse。 |
| safety：来源、版本、commit hash、权限可见 | DONE | lifecycle sourceUrl/localPath/ref/commit/installedAt/trustLevel/permissionSummary；status/trust notice 展示。 |
| safety：第三方默认不自动启用高风险能力 | DONE | 安装写入 `trustLevel: untrusted`；enable 前 trust notice；runtime guard 检查 trusted/enabled。 |
| safety：GitHub 安装失败不能影响本地插件和主会话 | DONE | install 返回摘要，不覆盖已有启用项；失败隔离。 |
| discovery-before-execute：未发现/未信任/schema 未加载/版本不兼容拒绝执行 | DONE | `validateExtensionContributionExecution()` runtime guard 覆盖 skill/plugin。 |
| MCP：local add/update/remove/enable/disable/validate/doctor | DONE | 本阶段只支持 local command metadata，doctor 复用既有受控诊断。 |
| MCP：stdio/http/sse transport 参数矩阵、env/header 脱敏 UI | DEFERRED | 只做 local command Lite；完整 transport/env/header UX 后置 release readiness 或后续 MCP hardening。 |
| `/skills search <query>` / 远程 discover | NOT-DO | 不做 skill 市场、远程搜索或推荐；本阶段 discover 等价为本地 status/doctor/validate。 |
| 插件市场、skill 市场、评分推荐、自动更新、云同步 | NOT-DO | 明确排除。 |
| provider/freshness/web evidence | DEFERRED | Phase 15.5E。 |
| terminal readiness / polish | DEFERRED | Phase 15.5F。 |
| durable jobs、Virtual Agent Concurrency、remote channels | DEFERRED | Phase 17A/17B。 |
| 真实全量 smoke、Beta PASS、smoke-ready、open-source-ready | NOT-DO | 未执行、未声明。 |

## 成品级结构化 handoff packet

- 下一阶段：可由用户决定是否进入 Phase 15.5E Provider & Freshness；不得自动进入。
- 禁止事项：不得进入 Phase 15.5E/F / Phase 16 / 17 / 18；不得执行真实全量 smoke；不得宣称 Beta PASS、smoke-ready 或 open-source-ready；不得 commit；不得实现插件市场、skill 市场、评分推荐、云同步、自动更新、provider/freshness、durable jobs、Virtual Agent Concurrency 或 remote channels。
- 证据引用：`packages/config/src/index.test.ts`、`packages/tui/src/index.test.ts` focused tests；本报告“测试与验证”命令输出。
- 验证结果：focused 15.5D tests、typecheck、check、build、git diff --check 均为 PASS。
- 索引状态：`mcp__codebase-memory-mcp__index_status(project=F-Linghun)` 返回 ready（nodes=1532，edges=2956）。
- 权限模式：未修改四种 permission mode；Start Gate / permission pipeline 保持既有路径。
- 模型/provider：本地实现与测试 provider-agnostic；未写入或泄露 provider key。
- 预算使用：未发起真实联网 clone/fetch；未运行真实全量 smoke；Git/GitHub install 需要显式 `--confirm-network`。
- Commit 状态：本轮未 commit。
