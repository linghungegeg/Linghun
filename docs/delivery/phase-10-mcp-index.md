# Phase 10：MCP 与 codebase-memory 闭环

## 阶段目标

完成 Linghun Phase 10 MCP 与 codebase-memory 最小闭环，在 Phase 09 cache/cost/freshness 基础上接入 MCP server 配置读取、MCP 状态查看、稳定 MCP tool list 摘要、codebase-memory 索引状态/查询/架构摘要，以及 transcript evidence 记录。

本阶段只实现 Phase 10 MCP/index 最小闭环，不进入 Phase 11 完整会话交接、长期记忆或 handoff 自动生成；不实现 Agent、多模型协作、Plugins、Hooks、长期任务、Remote Channels 或桌面端。

## 已完成功能

- MCP manager 最小闭环：
  - `@linghun/config` 新增 `mcp` 配置默认值。
  - 默认注册 `codebase-memory` server，命令来自 `LINGHUN_CODEBASE_MEMORY_MCP` 或 `codebase-memory-mcp`。
  - `/mcp status` 展示 server 状态、稳定工具摘要数量和最近 doctor 时间。
  - `/mcp doctor` 检测 server 可执行性；失败隔离为 `missing` / `error`，不拖垮 REPL。
  - `/mcp tools` 输出稳定排序的短摘要，不输出完整 tool schema。
- MCP 与 Phase 09 cache freshness 衔接：
  - MCP tool list 经稳定排序和 description 截断后进入 `mcpToolListHash`。
  - MCP tool list 变化会进入 `changedKeys`，可通过 `/break-cache status` 看到。
  - 状态栏继续只显示短状态，不显示完整 schema 或金额。
- codebase-memory 闭环：
  - `@linghun/config` 新增 `index` 默认配置：`enabled=true`、`mode=fast`、`ignoreFile=.linghunignore`。
  - `/index status` 通过本机 `codebase-memory-mcp cli list_projects` 和 `index_status` 识别当前项目索引。
  - `/index init fast` 仅在用户显式执行时触发 fast 索引。
  - `/index refresh` 仅在用户显式执行时按配置 mode 刷新索引。
  - `/index search <query>` 进行短查询摘要并写入 transcript evidence，`kind=index_query`。
  - `/index architecture` 输出短架构摘要并写入 transcript evidence，`kind=index_query`。
  - 索引查询结果只做摘要和截断，不把大段源码或完整 graph dump 写入主输出。
- 上下文恢复基础能力：
  - index 查询 evidence 写入 JSONL transcript，后续 resume 可看到“曾经基于索引查过什么”。
  - `START_NEXT_CHAT.md` 明确 Phase 10 后新对话优先基于索引、交付文档和 transcript evidence 恢复上下文。
  - 不实现 Phase 11 的完整 handoff 自动生成、长期记忆或完整会话交接。
- 新手友好与失败降级：
  - 未安装或不可执行 `codebase-memory-mcp` 时，`/index status` / `/mcp doctor` 给出可操作提示。
  - 索引缺失提示 `/index init fast`。
  - 索引可能过期或非 ready 提示 `/index refresh`。
  - 错误文案提醒可用 `.linghunignore` 排除大 JSON、SQL、XML、min.js 和生成物。
- 保留 Phase 09：
  - `/cache status`、`/break-cache status`、`/usage`、`/stats`、`/cache-log` 保持可用。
  - 状态栏继续不显示金额。
  - usage/cache transcript event 和 Phase 08 verification/test_result evidence 保持可用。

## 使用方式

构建后进入 REPL：

```bash
corepack pnpm build
corepack pnpm exec linghun
```

Phase 10 新增命令：

```text
/mcp
/mcp status
/mcp tools
/mcp doctor
/index status
/index init fast
/index refresh
/index search <query>
/index architecture
```

典型路径：

```text
/mcp doctor
/mcp tools
/index status
/index search cache freshness
/index architecture
/cache status
/break-cache status
```

如果本机没有安装 `codebase-memory-mcp`：

```text
请安装或配置 codebase-memory-mcp，然后重新运行 /mcp doctor 或 /index status。
可以通过 LINGHUN_CODEBASE_MEMORY_MCP 指向本机可执行文件。
```

如果索引不存在：

```text
/index init fast
```

如果索引可能过期：

```text
/index refresh
```

大仓库建议在项目根目录维护 `.linghunignore`，排除大 JSON、SQL、XML、min.js、生成物和不需要进入索引的目录。

## 涉及模块

- `packages/config/src/index.ts`：新增 MCP 与 index 默认配置类型和 merge。
- `packages/config/src/index.test.ts`：覆盖 Phase 10 默认配置。
- `packages/tui/src/index.ts`：新增 MCP/Index 状态、slash command、codebase-memory CLI 调用、index evidence、MCP tool list 稳定化、状态栏 index 短状态。
- `packages/tui/src/index.test.ts`：更新测试上下文和 help discoverability。
- `apps/cli/src/cli.ts`：帮助文案更新到 Phase 10。
- `apps/cli/src/main.test.ts`：CLI help 回归更新到 Phase 10。
- `docs/delivery/README.md`：Phase 10 标记为 done。
- `README.md`：当前阶段与新对话入口更新到 Phase 00-10 完成。
- `START_NEXT_CHAT.md`：新对话 handoff 提示更新到 Phase 10 完成、Phase 11 下一阶段。
- `docs/delivery/phase-10-mcp-index.md`：本交付文档。

## 关键设计

- 最小闭环优先：本阶段不引入 MCP SDK 依赖，不自动联网安装，不自动启动长期后台 MCP 进程；先通过本机 `codebase-memory-mcp cli` 打通状态、查询和索引命令路径。
- MCP 失败隔离：`/mcp doctor` 和 `/index ...` 失败只更新状态与短错误，不让普通聊天、本地工具、cache/status 崩溃。
- MCP tool list 稳定化：只记录 server/name/短 description，按 `server:name` 排序并截断 description，避免完整 schema 破坏 prompt cache。
- cache freshness 衔接：`getCurrentFreshness()` 使用稳定 MCP tool list 计算 `mcpToolListHash`；变化进入 `changedKeys`。
- transcript evidence：`/index search` 和 `/index architecture` 写入 `evidence_record`，`kind=index_query`，`source=codebase-memory:<project>:<query>`。
- 短摘要和截断：索引 search 最多输出 5 条短摘要；architecture 只输出节点/边统计和前几类 label/type，不 dump 源码。
- 状态栏短状态：状态栏只显示 `index unknown/ready/stale/missing/error/indexing`，不显示金额、完整索引结果、完整 MCP tool schema 或日志。
- 不自动索引：除非用户显式执行 `/index init fast` 或 `/index refresh`，Linghun 不会自动全量索引仓库。

## 配置项

默认配置位于 `@linghun/config`：

```ts
mcp: {
  enabledServers: ["codebase-memory"],
  servers: {
    "codebase-memory": {
      command: process.env.LINGHUN_CODEBASE_MEMORY_MCP ?? "codebase-memory-mcp",
      args: [],
    },
  },
},
index: {
  enabled: true,
  mode: "fast",
  ignoreFile: ".linghunignore",
},
```

约束：

- 不自动安装依赖。
- 不自动重建索引。
- 不把 API key、完整私有路径、完整记忆或大段源码写入公开文档。
- `LINGHUN_CODEBASE_MEMORY_MCP` 只用于指向本机可执行文件。

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
/mcp
/mcp status
/mcp tools
/mcp doctor
/index status
/index init fast
/index refresh
/index search <query>
/index architecture
/cache status
/break-cache status
/usage
/stats
/verify
/review
/exit
```

## 测试与验证

本阶段要求执行：

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm check
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
printf '/mcp status\n/mcp doctor\n/mcp tools\n/index status\n/index search cache\n/index architecture\n/cache status\n/exit\n' | corepack pnpm exec linghun
```

已执行：

- `corepack pnpm test`：通过；10 个测试文件、55 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过。
- `corepack pnpm check`：首次因 Biome 格式/import 顺序失败，格式化 `packages/tui/src/index.ts` 并调整 import 后复跑通过。
- `corepack pnpm exec linghun --version`：输出 `0.1.0`。
- `corepack pnpm exec Linghun --version`：输出 `0.1.0`。
- `corepack pnpm exec linghun --help`：显示 Phase 10 帮助，说明 MCP 与 codebase-memory 闭环。
- TUI smoke：`/mcp status`、`/mcp doctor`、`/mcp tools`、`/index status`、`/index search cache`、`/index architecture`、`/cache status`、`/exit` 均可执行。

TUI smoke 结果摘要：

- `/mcp status`：显示 `codebase-memory` server configured。
- `/mcp doctor`：检测本机 `codebase-memory-mcp` 可执行。
- `/mcp tools`：输出稳定排序短摘要，不输出完整 schema。
- `/index status`：当前项目 `F-Linghun` ready，512 nodes / 804 edges。
- `/index search cache`：输出短摘要；当前结果为 0 条匹配。
- `/index architecture`：输出短架构统计摘要。
- `/cache status`：Phase 09 cache status 仍可用，状态栏不显示金额。

## 性能结果

- `--version` / `--help` 仍为 CLI 快速路径，不启动 TUI、模型、MCP、索引或验证器。
- `/mcp status`、`/mcp tools` 是本地内存状态格式化，不调用模型。
- `/mcp doctor` 只做短命令可用性检测。
- `/index status` 只调用 `list_projects` 与当前项目 `index_status`，不读取完整 graph。
- `/index search` 最多展示 5 条短结果并截断。
- `/index architecture` 只展示短统计摘要。
- 状态栏限制为短行，继续不显示金额。

## 已知问题

- 本阶段通过 `codebase-memory-mcp cli` 做最小闭环，未引入完整 MCP SDK 客户端生命周期管理；完整 MCP session 管理可在后续独立增强，但不得阻塞 Phase 10 用户命令闭环。
- MCP tools 当前是稳定摘要，不是完整 tool schema；这是为了保护 prompt cache，不代表所有 MCP tool 都已作为 Linghun 内置工具可调用。
- `/index init fast` 和 `/index refresh` 可能因仓库大、ignore 不充分或本机索引器错误失败；失败时给出提示，不自动重试或自动扩大范围。
- `codebase-memory-mcp` CLI 会输出自身 info 日志；Linghun 只解析最后一行 JSON，主输出只保留短错误/摘要。
- Phase 10 不实现完整 resume/handoff 自动总结；只通过 transcript evidence 为 Phase 11 打基础。

## 不在本阶段处理的内容

- 不实现 Phase 11 会话交接与长期记忆闭环。
- 不实现完整 handoff 自动生成。
- 不实现 Agent、多模型协作、Plugins、Hooks、长期任务、Remote Channels 或桌面端。
- 不自动联网安装 `codebase-memory-mcp` 或其他依赖。
- 不自动全量索引大仓库。
- 不把完整 MCP tool schema、大索引结果、大日志、大段源码、API key、私有记忆写入状态栏、公开文档或主输出。
- 不复制 CCB / OpenCode / Hermes 的可疑源码实现。

## 下一阶段衔接

Phase 11 可以在本阶段基础上实现会话交接与记忆闭环，但必须继续遵守：

- 优先基于 codebase-memory 索引、交付文档和 transcript evidence 恢复上下文。
- 不全量读取仓库作为默认恢复路径。
- 不把完整记忆或完整索引 dump 到 transcript。
- 继续保持 cache freshness 稳定，避免 schema/list 无意义变化破坏 prompt cache。
- 继续保留 Phase 08 Verification Runner、Phase 09 cache/cost 和 Phase 10 index evidence。

## 开发者排查入口

- Slash router：`packages/tui/src/index.ts` 中 `handleSlashCommand()`。
- MCP 状态：`createMcpState()`、`handleMcpCommand()`、`runMcpDoctor()`、`formatMcpStatus()`、`formatMcpTools()`。
- MCP tool list 稳定化：`stabilizeMcpToolList()`。
- Cache freshness：`getCurrentFreshness()`、`createCacheFreshness()`、`diffFreshness()`。
- Index 状态：`createIndexState()`、`handleIndexCommand()`、`refreshIndexStatus()`、`formatIndexStatus()`。
- Index 查询：`runIndexQuery()`、`summarizeIndexResult()`。
- Index evidence：`recordIndexEvidence()`。
- codebase-memory CLI 调用：`runCodebaseMemoryCli()`、`runCommandCapture()`。
- 状态栏：`writeStatus()` 与 `messages.status`。
- Tests：`packages/tui/src/index.test.ts`、`packages/config/src/index.test.ts`、`apps/cli/src/main.test.ts`。

## 参考核对

本阶段实际读取的 Linghun 文档：

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-09-cache-cost.md`

本阶段实际参考：

- 本机 codebase-memory-mcp deferred tools：确认项目名 `F-Linghun`、索引 `ready`、512 nodes / 804 edges。
- 本机 `codebase-memory-mcp --help`：确认 CLI 支持 `list_projects`、`index_status`、`index_repository`、`search_code`、`get_architecture` 等工具。
- `F:\ccb-source\docs\ccb-optimizations.md` 及 CCB MCP/index 相关资料由只读参考 agent 检查，用于行为边界：MCP 稳定化、索引提醒、大文件保护、cache 命中保护。
- CCB / OpenCode / MCP 生态仅用于行为、边界和验收思路参考。

未复制内容：

- 未复制 CCB / OpenCode / Hermes 的可疑源码实现、反编译痕迹、内部 API、专有遥测或内部服务逻辑。
- 本阶段实现为 Linghun 自研最小闭环，使用本机 `codebase-memory-mcp` CLI 作为成熟工具入口。

## 成品级结构化 handoff packet

```yaml
current_phase: Phase 10 MCP and codebase-memory loop
phase_status: completed
next_phase: Phase 11 session handoff and memory loop
phase_11_status: pending
must_stop_after_phase_10: true
completed:
  - MCP config defaults with codebase-memory server
  - /mcp, /mcp status, /mcp tools, /mcp doctor
  - MCP failure isolation for missing/error server states
  - Stable sorted MCP tool summary list
  - MCP tool list participates in mcpToolListHash and changedKeys
  - Index config defaults with fast mode and .linghunignore guidance
  - /index status, /index init fast, /index refresh
  - /index search <query> with short summary and index_query evidence
  - /index architecture with short architecture summary and index_query evidence
  - Status bar short index state without money/schema/log dump
  - README, START_NEXT_CHAT, delivery README updated to Phase 00-10 completed
forbidden_next_without_user_confirmation:
  - Phase 11 implementation unless user explicitly starts it
  - Full handoff auto-generation before Phase 11
  - Long-term memory loop before Phase 11
  - Agent, multi-model collaboration, Plugins, Hooks, long-running jobs, Remote Channels, desktop
key_files:
  - packages/config/src/index.ts
  - packages/config/src/index.test.ts
  - packages/tui/src/index.ts
  - packages/tui/src/index.test.ts
  - apps/cli/src/cli.ts
  - apps/cli/src/main.test.ts
  - README.md
  - START_NEXT_CHAT.md
  - docs/delivery/README.md
  - docs/delivery/phase-10-mcp-index.md
validation_current:
  - command: corepack pnpm test
    result: pass_10_files_55_tests
  - command: corepack pnpm typecheck
    result: pass
  - command: corepack pnpm build
    result: pass
  - command: corepack pnpm check
    result: pass_after_biome_format_import_fix
  - command: corepack pnpm exec linghun --version
    result: pass_0.1.0
  - command: corepack pnpm exec Linghun --version
    result: pass_0.1.0
  - command: corepack pnpm exec linghun --help
    result: pass_phase10_help
  - command: "printf '/mcp status\n/mcp doctor\n/mcp tools\n/index status\n/index search cache\n/index architecture\n/cache status\n/exit\n' | corepack pnpm exec linghun"
    result: pass_phase10_repl_smoke_index_ready_512_nodes_804_edges
  - command: independent verification agent
    result: pass_after_fixing_index_command_override
index_status:
  project: F-Linghun
  status: ready
  nodes: 512
  edges: 804
  checked_with: codebase-memory-mcp deferred index_status before implementation
permission_mode: default Claude Code session; no repository permission config changed
model_provider: claude-sonnet-4-6 via Claude Code; Linghun runtime provider unchanged (DeepSeek config path)
budget_usage: no real billing fields added; status bar has no money; /usage and /stats remain conservative
risks:
  - Full MCP SDK lifecycle is not implemented in Phase 10 minimal loop
  - MCP tools are summarized for stability, not exposed as full executable external tools
  - Index commands depend on local codebase-memory-mcp CLI availability
  - Large repositories should configure .linghunignore before explicit indexing
resume_guidance:
  - Read phase-10-mcp-index.md, delivery README, and transcript evidence first
  - Prefer /index status, /index search <query>, /index architecture before broad file reads
  - Do not dump full index or memory into transcript/status bar
```
