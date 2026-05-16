# Phase 11：会话交接与记忆闭环

## 阶段目标

完成 Linghun Phase 11 会话交接与记忆闭环：用结构化 `HandoffPacket` 替代自由文本续接，打通 `/resume`、`/branch`、`LINGHUN.md` 项目规则提示与显式初始化、项目级/用户级记忆候选确认、存储路径诊断、memoryHash 与 cache freshness 联动，以及 AI sessions / 跨工具导入的最小入口。

本阶段只实现普通会话恢复与普通分支会话，不进入 Phase 12+；不实现 Agent、多模型协作、完整 MCP SDK 生命周期、Plugins、Hooks、长期任务、Remote Channels 或桌面端。

## 已完成功能

- `HandoffPacket` 成品级结构：
  - 在 TUI 层定义结构化 `HandoffPacket`，包含 `id`、`sessionId`、`projectPath`、`parentSessionId`、`currentPhase`、`nextPhase`、`phaseStatus`、`goal`、`completed`、`pending`、`mustNotDo`、`todos`、`keyFiles`、`changedFiles`、`evidenceRefs`、`verification`、`risks`、`indexStatus`、`permissionMode`、`modelProvider`、`recentCommit`、`budgetUsage`、`createdAt`、`generatedBy`。
  - 支持序列化为 JSON，写入 `.linghun/memory/session/handoff-latest.json`。
  - `/resume` / `/branch` 消费结构化 handoff，不复制完整 transcript。
  - handoff 缺少 `verification`、`evidenceRefs`、`mustNotDo` 或 `indexStatus` 时，恢复输出只读提示和补齐建议。
- `/resume` 闭环：
  - `/resume` 恢复最近会话；`/resume <id>` 恢复指定会话。
  - 保留并增强 `/sessions resume <id>` 行为，不破坏 Phase 02 会话恢复。
  - 恢复时只注入/展示必要摘要、Todo、验证结果、索引状态、证据引用、关键文件列表和 handoff，不把完整历史聊天塞回上下文。
- `/branch` 闭环：
  - `/branch [目的]` 基于当前结构化 handoff 创建普通分支会话。
  - 分支事件记录 `parentSessionId` / 来源 session、目的、权限模式、禁止事项和 handoff 只读状态。
  - 分支 handoff 使用新的 `id` 与 branch `sessionId`，保留 `parentSessionId`，不复制完整 transcript。
  - 本阶段没有实现 Phase 12 `/fork` agent。
- `LINGHUN.md` 项目规则：
  - 启动时检测项目根目录 `LINGHUN.md`。
  - 缺失时给 CCB 风格轻提示，不打断输入。
  - `/memory init` 显式生成基础模板。
  - 模板明确：`LINGHUN.md` 只保存长期稳定工程规则，不保存临时想法、阶段进度或短期计划。
- 记忆闭环：
  - 项目级记忆默认 `.linghun/memory/`。
  - 用户级记忆默认 `~/.linghun/data/memory/`。
  - `/memory` 查看状态；`/memory storage` 诊断存储路径；`/memory review` 审查候选；`/memory candidate <摘要>` 创建候选；`/memory accept <id>` 显式确认写入；`/memory delete <id>` 删除本会话记录。
  - Hardening：已接受的项目级/用户级 memory 会在下一次启动时从落盘 JSON 加载，`/memory` 与 `/memory review` 可见，`memoryHash` 基于短摘要参与 freshness。
  - 不自动写长期记忆；候选摘要短小稳定，避免破坏 prompt cache。
- 存储路径配置：
  - `@linghun/config` 新增 `StorageConfig` 与 `resolveStoragePaths()`。
  - 支持 `LINGHUN_DATA_DIR` 作为用户级数据根目录，影响 sessions、user memory、logs、jobs、cache 等默认用户路径。
  - 支持 `storage.userData`、`storage.sessions`、`storage.memory.user`、`storage.logs`、`storage.jobs`、`storage.cache` 等配置结构；未单独配置时继承用户数据根目录或项目 `.linghun/`。
  - CLI `sessions` 命令改为通过 `resolveStoragePaths(config).sessions` 获取路径。
- 索引和记忆联动：
  - `memoryHash` 接入 `CacheFreshness`，由 `LINGHUN.md` 是否存在、候选/已接收记忆短摘要和最近 handoff 时间组成。
  - memory/handoff/LINGHUN.md 变化会进入 freshness，`/break-cache status` 可看到 `memoryHash` changedKeys。
  - 恢复时如果索引 stale/missing，会提示 `/index status` 或 `/index refresh`，但不自动刷新。
  - 不把完整索引、完整 handoff、完整 memory 或完整 transcript dump 到主输出。
- AI sessions / 跨工具导入基础：
  - `/memory import sessions [source] [query]` 提供最小入口。
  - 当前实现只记录导入请求摘要和候选记忆，不读取或保存敏感聊天原文。
  - 本机 ai-sessions MCP 可用性在开发阶段通过 MCP source list 只读确认；完整自动接管不属于本阶段。
- 新手友好：
  - `/help` 增加 Phase 11 新命令。
  - 缺少 `LINGHUN.md`、缺少 handoff、handoff 不完整、index stale/missing 都给短提示和下一步命令。
  - 状态栏仍只显示短 session/model/mode/bg/cache/index，不显示长记忆、长 handoff 或金额。

## 使用方式

构建后进入 REPL：

```bash
corepack pnpm build
corepack pnpm exec linghun
```

Phase 11 新增/增强命令：

```text
/resume [id]
/branch [purpose]
/memory
/memory storage
/memory review
/memory candidate <short stable summary>
/memory accept <candidate-id>
/memory delete <candidate-id>
/memory init
/memory import sessions [source] [query]
/sessions resume <id>
/break-cache status
```

典型路径：

```text
/memory
/memory storage
/memory candidate 项目长期规则只保存稳定工程事实
/memory review
/memory accept <candidate-id>
/break-cache status
/resume
/branch 试验另一种实现
/index status
/cache status
```

缺少 `LINGHUN.md` 时：

```text
[memory hint] 可运行 /memory init 生成基础模板；不会自动生成。
```

## 涉及模块

- `packages/config/src/index.ts`：新增 `StorageConfig`、`resolveStoragePaths()`、`LINGHUN_DATA_DIR` 用户数据根目录解析。
- `packages/config/src/index.test.ts`：覆盖 Phase 11 存储默认路径。
- `packages/core/src/session.ts`：扩展 transcript event，记录 handoff、memory candidate/accepted、branch、session import。
- `packages/tui/src/index.ts`：新增 `HandoffPacket`、`MemoryState`、`/resume`、`/branch`、`/memory*`、`LINGHUN.md` 检测、memoryHash freshness、恢复上下文裁剪。
- `packages/tui/src/index.test.ts`：覆盖 help 可发现性、结构化恢复、memory accept、LINGHUN.md init、memoryHash changedKeys。
- `apps/cli/src/cli.ts`：更新 Phase 11 help，并让 sessions 路径走 `resolveStoragePaths()`。
- `apps/cli/src/main.test.ts`：更新 CLI help 回归。
- `docs/delivery/README.md`：Phase 11 标记为 done。
- `README.md`：当前进度更新到 Phase 00-11 完成。
- `START_NEXT_CHAT.md`：下一会话 handoff 更新到 Phase 11 完成、Phase 12 待确认。

## 关键设计

- 结构化交接优先：`HandoffPacket` 是跨会话契约，恢复和分支只读取摘要、Todo、验证、证据、索引状态和关键文件列表，不复制完整 transcript。
- 只读降级：关键字段缺失时，不自动进入执行态；输出缺失字段和补齐命令，保护新会话不越界。
- 记忆候选机制：长期记忆必须先进入 candidate，再由 `/memory accept <id>` 显式写入。默认不自动写用户级或项目级长期记忆。
- 长短分层：长期稳定工程规则进 `LINGHUN.md` 或 memory；临时想法、阶段进度、短期计划进入 handoff packet。
- 存储可迁移：用户级路径统一通过 `LINGHUN_DATA_DIR` / `storage.*` 解析，项目级路径在 `.linghun/` 下，避免硬编码 C 盘或固定用户名。
- cache 保护：`memoryHash` 使用短摘要和 handoff 时间，不把完整 memory / handoff 放进 freshness 或状态栏。
- AI sessions 最小入口：本阶段只预留/记录摘要与候选，不抓取敏感原文，不承诺全自动接管所有工具对话。

## 配置项

新增配置结构在 `@linghun/config`：

```ts
storage: {
  projectData: { scope: "project" },
  userData: { scope: "user" },
  sessions: { scope: "user" },
  memory: {
    project: { scope: "project" },
    user: { scope: "user" },
    session: { scope: "project" },
  },
  index: { scope: "project" },
  logs: { scope: "user" },
  jobs: { scope: "user" },
  cache: { scope: "user" },
}
```

环境变量：

```text
LINGHUN_DATA_DIR=<absolute path>
```

默认路径：

```text
project memory: <project>/.linghun/memory/
session memory/handoff: <project>/.linghun/memory/session/
user memory: ~/.linghun/data/memory/
sessions: ~/.linghun/data/sessions/
logs: ~/.linghun/data/logs/
jobs: ~/.linghun/data/jobs/
cache: ~/.linghun/data/cache/
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
/resume [id]
/branch [purpose]
/sessions
/sessions resume <id>
/memory
/memory storage
/memory review
/memory candidate <summary>
/memory accept <id>
/memory delete <id>
/memory init
/memory import sessions [source] [query]
/index status
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
printf '/memory\n/memory storage\n/memory candidate stable-rule\n/memory review\n/memory accept <id>\n/resume\n/branch experiment\n/index status\n/cache status\n/break-cache status\n/exit\n' | corepack pnpm exec linghun
```

已执行：

- `corepack pnpm test`：通过；Vitest 10 个测试文件、62 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过；7 个 workspace package 构建通过。
- `corepack pnpm check`：通过；Biome 检查 43 个文件通过。
- `corepack pnpm exec linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec Linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec linghun --help`：通过，显示 Phase 11 帮助与快速路径说明。
- TUI smoke：`/memory`、`/memory storage`、`/memory candidate`、`/memory review`、`/resume`、`/branch`、`/index status`、`/cache status`、`/break-cache status`、`/exit` 通过；输出包含 memory storage、结构化 resume、只读降级提示、branch session、index stale 提示与 `memoryHash` changedKeys。
- Hardening focused tests：`corepack pnpm test -- --run packages/tui/src/index.test.ts` 通过；新增覆盖 accepted memory 落盘后新 context 加载、`memoryHash` 包含已加载 accepted memory、handoff identity 字段与 branch `parentSessionId` / source session。

## 性能结果

- `--version` / `--help` 仍为快速路径，不启动 TUI、模型、MCP、索引、验证器或 cache 统计系统。
- `/memory`、`/memory storage`、`/memory review` 为本地状态/路径格式化，不调用模型。
- `/resume` 只读取目标会话 JSONL 并抽取摘要事件，不把完整 transcript 放回模型上下文。
- `/branch` 只创建普通 Session 和 handoff 事件，不启动 agent 或后台任务。
- `memoryHash` 使用候选/已接受 memory 短摘要和 handoff 时间，不写入完整 memory / handoff / transcript。
- 状态栏继续限制为短字段。

## 已知问题

- AI sessions 导入目前是最小入口和清晰降级，不自动读取完整外部会话原文。
- `HandoffPacket` 的 `recentCommit` 当前由运行环境/交付文档记录，TUI 内部不执行 git 命令获取。
- `/memory delete` 当前删除本会话内存中的候选/已接收记录，不追踪删除已落盘 JSON 文件；已落盘 accepted memory 会在后续启动重新加载。后续可做更完整的 memory 管理，但不阻塞 Phase 11 闭环。
- `LINGHUN.md` 模板是基础版本，不包含项目专属规则；项目专属规则需要用户或后续明确命令补充。
- `storage.*` 已有结构和解析 helper，当前 CLI sessions 与 TUI memory/session 路径接入；更多未来模块会在对应阶段继续使用同一 helper。

## 不在本阶段处理的内容

- 不进入 Phase 12 Agent 闭环。
- 不实现 `/fork` agent。
- 不实现多模型协作、vision/image provider。
- 不实现完整 MCP SDK 生命周期。
- 不实现 Plugins、Hooks、Skills 市场、长期任务、Remote Channels、桌面端。
- 不自动联网安装依赖。
- 不自动刷新索引。
- 不自动写长期记忆。
- 不复制 CCB / OpenCode / Hermes 可疑源码实现、反编译痕迹、内部 API、专有遥测或内部服务逻辑。

## 下一阶段衔接

Phase 12 可以在 Phase 11 结构化 handoff 基础上实现 Agent 闭环，但必须继续遵守：

- `/fork` agent 只能消费 handoff、证据、Todo、关键文件和权限边界，不能复制完整 transcript。
- 默认最多 3 个 agent，用户明确要求才多开。
- explorer 只读、verifier 只验证、worker 受权限管道限制。
- agent 输出必须摘要化回主线程，不得把完整日志污染状态栏或主上下文。
- Phase 12 开始前必须重新确认用户授权，不得自动进入下一阶段。

## 开发者排查入口

- Slash router：`packages/tui/src/index.ts` 中 `handleSlashCommand()`。
- Resume：`handleResumeCommand()`、`resumeSessionWithHandoff()`、`hydrateResumeContext()`、`formatResumePacket()`。
- Handoff：`HandoffPacket`、`createHandoffPacket()`、`validateHandoffPacket()`、`writeHandoffPacket()`。
- Branch：`handleBranchCommand()`。
- Memory：`MemoryState`、`createMemoryState()`、`handleMemoryCommand()`、`acceptMemoryCandidate()`、`formatMemoryStorage()`。
- LINGHUN.md：`initLinghunMd()`、启动轻提示。
- Cache freshness：`createMemoryFreshnessSummary()`、`getCurrentFreshness()`、`formatBreakCacheStatus()`。
- Storage：`packages/config/src/index.ts` 中 `StorageConfig`、`resolveStoragePaths()`。
- Transcript event：`packages/core/src/session.ts`。
- Tests：`packages/tui/src/index.test.ts`、`packages/config/src/index.test.ts`、`apps/cli/src/main.test.ts`。

## 参考核对

本阶段实际读取的 Linghun 文档：

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-10-mcp-index.md`
- `F:\Linghun\docs\delivery\ccb-dev-boost-coverage-checklist.md`

本阶段实际参考：

- `F:\ccb-source\docs\ccb-optimizations.md`：AI sessions MCP、会话历史检索、缓存保护、codebase-memory 行为边界。
- 本机 ai-sessions MCP source list：确认可用 source 包括 `mistral`、`copilot`、`claude`、`gemini`、`codex`、`opencode`。
- 本机 codebase-memory 索引：`F-Linghun` ready，用于缩小 Phase 11 影响范围。
- CCB / Hermes / AI Sessions 仅作为行为、边界和验收思路参考。

未复制内容：

- 未复制 CCB / OpenCode / Hermes 的可疑源码实现、反编译痕迹、内部 API、专有遥测或内部服务逻辑。
- Phase 11 实现为 Linghun 自研最小闭环。

## 成品级结构化 handoff packet

```json
{
  "id": "phase-11-hardening-handoff",
  "sessionId": "current-session",
  "projectPath": "F:\\Linghun",
  "currentPhase": "Phase 11 hardening",
  "nextPhase": "Phase 12",
  "phaseStatus": "completed",
  "goal": "会话交接与记忆闭环 hardening：accepted memory 跨会话加载、HandoffPacket 身份字段、branch parent/source 记录、真实确认路径测试。",
  "completed": [
    "HandoffPacket structure with id, sessionId, projectPath and optional parentSessionId",
    "/resume latest or selected session without full transcript injection",
    "/sessions resume <id> preserved and enhanced",
    "/branch normal branch session with parentSessionId/source session and branch-scoped handoff",
    "LINGHUN.md detection and explicit /memory init template",
    "Project/user/session memory storage paths",
    "Candidate memory review and explicit accept path",
    "Accepted project/user memory reloads from disk in new context",
    "memoryHash cache freshness includes loaded accepted memory summaries",
    "LINGHUN_DATA_DIR and storage path resolver",
    "AI sessions import minimal summary/candidate entry",
    "Help discoverability for Phase 11 commands"
  ],
  "pending": [
    "Phase 12 Agent loop only after user confirmation"
  ],
  "mustNotDo": [
    "Do not enter Phase 12+ without user confirmation",
    "Do not copy full transcript into resume/branch/fork context",
    "Do not auto-write long-term memory",
    "Do not auto-refresh index",
    "Do not implement Agent, multi-model collaboration, Plugins, Hooks, long-running jobs, Remote Channels, desktop in Phase 11"
  ],
  "todos": [],
  "keyFiles": [
    "packages/config/src/index.ts",
    "packages/core/src/session.ts",
    "packages/tui/src/index.ts",
    "apps/cli/src/cli.ts",
    "docs/delivery/phase-11-sessions-memory.md"
  ],
  "changedFiles": [
    "packages/tui/src/index.ts",
    "packages/tui/src/index.test.ts",
    "docs/delivery/phase-11-sessions-memory.md"
  ],
  "evidenceRefs": [
    {
      "kind": "test_result",
      "source": "corepack pnpm test -- --run packages/tui/src/index.test.ts",
      "summary": "Hardening focused tests passed: accepted memory reload, memoryHash from loaded accepted memory, and branch handoff identity."
    },
    {
      "kind": "command_output",
      "source": "corepack pnpm typecheck",
      "summary": "TypeScript typecheck passed after hardening patch."
    },
    {
      "kind": "command_output",
      "source": "corepack pnpm check",
      "summary": "Biome check passed for 43 files after hardening patch."
    },
    {
      "kind": "test_result",
      "source": "corepack pnpm test",
      "summary": "Full Vitest suite passed after hardening: 10 test files and 62 tests."
    },
    {
      "kind": "command_output",
      "source": "corepack pnpm build",
      "summary": "Workspace build passed after hardening."
    },
    {
      "kind": "command_output",
      "source": "corepack pnpm exec linghun --version && corepack pnpm exec Linghun --version && corepack pnpm exec linghun --help",
      "summary": "CLI quick paths passed and Phase 11 help is visible."
    },
    {
      "kind": "command_output",
      "source": "TUI smoke commands",
      "summary": "/memory, /memory storage, /memory review, /resume, /branch, /index status, /cache status and /break-cache status produced expected Phase 11 output."
    }
  ],
  "verification": {
    "status": "passed",
    "commands": [
      "corepack pnpm test",
      "corepack pnpm typecheck",
      "corepack pnpm build",
      "corepack pnpm check",
      "corepack pnpm exec linghun --version",
      "corepack pnpm exec Linghun --version",
      "corepack pnpm exec linghun --help",
      "TUI smoke for /memory, /memory storage, /memory review, /resume, /branch, /index status, /cache status, /break-cache status"
    ]
  },
  "risks": [
    "AI sessions import is a minimal summary/candidate entry, not full automatic external transcript takeover.",
    "memory delete removes in-session records only in this phase.",
    "recentCommit is recorded in delivery handoff, not read by TUI runtime."
  ],
  "indexStatus": {
    "project": "F-Linghun",
    "status": "ready",
    "nodes": 538,
    "edges": 903
  },
  "permissionMode": "default Claude Code session; repository permission config unchanged",
  "modelProvider": {
    "assistant": "claude-sonnet-4-6 via Claude Code",
    "linghunRuntimeProvider": "deepseek config path unchanged"
  },
  "recentCommit": "465dc0b fix: harden Linghun phase 10 index handling",
  "budgetUsage": "No real billing fields added; status bar has no money; /usage and /stats remain conservative.",
  "createdAt": "2026-05-16",
  "generatedBy": "Claude Code / Linghun Phase 11 delivery"
}
```
