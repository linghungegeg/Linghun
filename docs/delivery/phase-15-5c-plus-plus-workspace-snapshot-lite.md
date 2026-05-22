# Phase 15.5C++：Workspace Snapshot Lite

## 阶段目标

本轮只完成独立小阶段 Phase 15.5C++：Workspace Snapshot Lite。目标是在现有 Workspace Reference Cache 基础上补齐可复用的轻量工作区文件状态 metadata：bounded watched file read、bounded top-level directory summary、ignore/source boundaries、metadata-only snapshot、changed summary 和 `/cache status` 摘要入口。

本轮不进入 Phase 15.5D/E/F，不进入 Phase 16/17/18，不执行真实全量 smoke，不声明 Beta PASS、smoke-ready 或 open-source-ready，不提交 commit，不实现 native/binary、数据库、全仓 watcher、自研索引引擎、LSP，且不新增第二套 provider/tool/permission/evidence/MCP/index/agent/job 系统。

## 已完成功能

- 在 `WorkspaceReferenceSnapshot` 中新增 `workspaceSnapshot` metadata-only 摘要：schema version、bounded 标记、limits、counts、ignoreSources、top-level entries 和 changed summary。
- watched file hash 改为 `fs.open/read` bounded prefix 读取，不再先 `readFile` 整文件后 slice。
- 新增 bounded top-level workspace summary：默认只枚举顶层目录项，限制 stored entries，不递归扫描完整源码。
- 新增 ignore/source boundaries：读取 `.linghunignore`、`.cbmignore`、`.gitignore` 的轻量 prefix hash 和简单目录 pattern；并 hard-skip `.git`、`node_modules`、`dist`、`build`、`cache`、`.linghun/cache` 等常见高成本目录。
- snapshot 只保存 path/kind/size/mtime/hashPrefix/ignoredReason/counts/changedKeys，不保存完整源码、完整日志、完整 transcript、完整 index graph 或 provider raw request。
- Workspace Reference Cache fallback 继续保留：scan/probe 失败时返回 `source: "fallback"`，保留上一份 bounded metadata，不阻断主对话。
- `/cache status` 增加 `workspace snapshot lite` 单行摘要，只展示 counts、partial 和 changed key，不输出完整文件列表或源码。
- `/index status` 默认 fast path 未改变；本轮未接入 `detect_changes` 默认路径。

## 使用方式

```text
/cache status
/cache warmup
/cache refresh
/index status
```

说明：

- `/cache warmup|refresh` 会刷新 Workspace Reference Cache，并同步更新 Workspace Snapshot Lite metadata。
- `/cache status` 只显示 summary-first 摘要，例如 files/dirs/ignored/stored/partial/changed；完整 entries 不进入主屏。
- `/index status` 默认仍是 fast status；不会因为 Workspace Snapshot Lite 自动运行 `detect_changes`、index refresh 或全仓扫描。

## 涉及模块

- `packages/tui/src/workspace-reference-cache.ts`：在既有 Workspace Reference Cache 内新增 Workspace Snapshot Lite 类型、bounded file prefix read、top-level summary、ignore boundary、changed summary 和 fallback metadata 保留。
- `packages/tui/src/workspace-reference-cache.test.ts`：扩展 focused tests，覆盖 metadata-only、ignore boundaries、changed summary 和 bounded read path。
- `packages/tui/src/index.ts`：最小扩展 `/cache status` 摘要输出。
- `docs/delivery/phase-15-5c-plus-plus-workspace-snapshot-lite.md`：本交付报告。

Excluded existing diff：开工前工作区已有 `LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`docs/delivery/phase-15-5b-resource-task-lifecycle.md`、`docs/delivery/pre-open-source-terminal-product-completion-gate.md`、`docs/audit/log-slice-error-extract-helper-research.md`、`docs/audit/workspace-snapshot-helper-research.md` 等旁路修改；本轮只读取其中与阶段相关内容，不回滚、不覆盖、不把既有 diff 计入本轮代码实现。

## Source-Level Reality Check 摘要

### Existing implementation

- `packages/tui/src/workspace-reference-cache.ts` 已有 Workspace Reference Cache：缓存 dimensions、watched file summaries、directory summaries、RuntimeStatus、tool capability summary、evidence/log refs，并在失败时 fallback。
- `/cache status|warmup|refresh` 已接入 `refreshWorkspaceReferenceCache()`；模型请求前也会刷新 workspace reference。
- `/index status` 默认 fast path 已存在，不调用 `detect_changes`；fresh/check/doctor 才走更重路径。
- `packages/tools/src/index.ts` 已有 Read snapshot、`expectedHash`、stale file guard、changedFiles/patch summary；编辑正确性不需要第二套全局 snapshot。

### Gaps

- watched file hash 语义是 bounded，但旧实现先 `readFile()` 整文件再 slice，大 watched file 仍可能被完整读入。
- Workspace Reference Cache 缺少可复用的 top-level workspace file status metadata，无法给后续 Project Doctor、Context Picker、Architecture Runtime、Phase 17A agent/job 提供共享轻量事实地基。
- ignore/source boundaries 需要更明确记录 `.linghunignore`、`.cbmignore`、`.gitignore` 和 hard-skip 目录。
- `/cache status` 需要暴露 summary-first snapshot 概况，但不能输出完整文件列表或源码。

### Minimal touch points

- 优先扩展既有 `workspace-reference-cache.ts`，不新增第二套 cache/index runtime。
- 只在 `index.ts` 的 `/cache status` 输出中增加一行摘要。
- 只扩展 `workspace-reference-cache.test.ts` focused tests。
- 不修改 provider、permission、MCP/index execution、agent/job、tools editing runtime 或 verification runtime。

### Forbidden duplicate systems

本轮未新增 native/binary、database/sqlite、全仓 watcher、自研索引引擎、LSP、第二套 provider/tool/permission/evidence/MCP/index/agent/job 系统；未替代 codebase-memory；未缓存完整源码、完整日志、完整 transcript、完整 index result 或 provider raw request。

## 关键设计

### Metadata-only Workspace Snapshot Lite

`workspaceSnapshot` 是现有 Workspace Reference Cache 的一个轻量字段，不是新产品面板或索引系统。保存内容限制为：

- `path`
- `kind`: file / directory / symlink / other
- `size`
- `mtimeMs`
- `hashPrefix`：仅对顶层文件做 bounded prefix hash
- `ignoredReason`
- counts / limits / changed summary

明确不保存：

- 完整源码。
- 完整日志。
- 完整聊天 transcript。
- 完整 index graph/result。
- provider raw request。
- API key、token、secret 原文。

### Bounded reads

- watched file hash 通过 `open(absolutePath, "r")` + `handle.read(buffer, 0, bytesToRead, 0)` 读取 prefix。
- `bytesToRead = min(file size, maxHashBytes)`，默认沿用 Workspace Reference Cache 的 256 KiB。
- ignore file 也只读取 prefix，用于 pattern 摘要和 hashPrefix。

### Bounded top-level summary

- 默认只枚举 project root 顶层项，不递归进入 `src`、`packages` 或其他源码目录。
- `DEFAULT_TOP_LEVEL_ENTRY_LIMIT` 限制最多存储 entries；超出后标记 `partial: true`。
- 顶层目录只记录 directory metadata，不扫描其内部源码。

### Ignore/source boundaries

- ignore sources：`.linghunignore`、`.cbmignore`、`.gitignore`。
- hard skips：`.git`、`.linghun/cache`、`.next`、`.turbo`、`.cache`、`cache`、`build`、`coverage`、`dist`、`node_modules`、`out`、`target`。
- 本阶段只实现简单目录 pattern match，不实现完整 gitignore 语义；这是为了保持 Lite 边界，避免变成第二套 index/ignore engine。

### Changed summary

- 对比上一份 snapshot entries 的稳定 hash，输出 added / modified / deleted 计数和 `workspaceSnapshotAdded|Modified|Deleted` changed keys。
- changed summary 是 cache metadata，用于后续 Project Doctor / Context Picker / Architecture Runtime / Phase 17A 共享事实；不是 Git status，也不是 codebase-memory stale 检测。

## 配置项

本阶段未新增配置项，未修改依赖，未修改构建脚本。

## 命令

本阶段未新增全新 slash command；只扩展既有命令输出：

- `/cache status`：新增 `workspace snapshot lite` 摘要行。
- `/cache warmup|refresh`：沿用现有 refresh path，刷新时包含 Workspace Snapshot Lite。
- `/index status`：行为不变，默认 fast path。

## 测试与验证

Focused tests（本轮已执行）：

- `corepack pnpm exec vitest run packages/tui/src/workspace-reference-cache.test.ts`：PASS（1 file，7 tests）。

Repository validation（本轮已执行）：

- `corepack pnpm typecheck`：PASS。
- `corepack pnpm check`：PASS。
- `git diff --check`：PASS（仅 Windows LF/CRLF warning，无 whitespace error）。
- `corepack pnpm test`：PASS（15 files，379 tests）。
- `corepack pnpm build`：PASS。

本轮不执行真实全量 smoke；上述 focused/local validation 不构成 Beta PASS、smoke-ready 或 open-source-ready 声明。

## 性能结果

- watched file hash 不再整文件读入，只读取 bounded prefix。
- Workspace Snapshot Lite 只枚举 top-level entries，不递归全仓，不扫描完整源码。
- ignore source 只读 prefix，不解析完整大型 ignore 文件。
- `/cache status` 只输出 counts/changed summary，不输出 entries 详情、源码、日志或索引。
- 不新增数据库、native binary、后台 watcher、后台 job 或持久 index 成本。

## 已知问题

- ignore pattern matching 是 Lite 版本：只覆盖简单顶层目录 / 文件名 pattern；不实现完整 gitignore 规则、否定规则、globstar 或 nested pattern。
- Workspace Snapshot Lite 是进程内 metadata，重启后可重建；本阶段不做持久化 cache DB。
- changed summary 不是 Git status，不区分 tracked/untracked，也不替代 codebase-memory `detect_changes`。
- 本阶段只接入 `/cache status` 摘要；Project Doctor Lite / Context Picker Lite 的完整用户入口仍属于 Phase 15.5F。
- 本轮未执行真实全量 smoke，因此不能宣称真实项目完整链路通过。

## 不在本阶段处理的内容

- Phase 15.5D/E/F。
- Phase 16/17/18。
- Project Doctor Lite / Context Picker Lite 完整入口。
- Phase 17A durable jobs / Virtual Agent Concurrency。
- MCP server add/install/remove/update 生命周期。
- Provider/freshness/web evidence。
- Native/binary、sqlite/database、persistent full snapshot DB。
- 全仓 watcher、完整 ignore engine、自研代码图索引、LSP。
- 第二套 provider/tool/permission/evidence/MCP/index/agent/job 系统。
- 真实全量 smoke、Beta PASS、smoke-ready、open-source-ready 决策。
- commit。

## 下一阶段衔接

本小阶段完成后必须停止，由用户决定是否进入 Phase 15.5D Connect Lite。Workspace Snapshot Lite 只提供共享 metadata 地基；后续 Project Doctor / Context Picker / Phase 17A 若需要消费，应复用本 snapshot refs 和 codebase-memory，不得各自重复全仓扫描。

## 开发者排查入口

- Workspace Reference Cache 主入口：`packages/tui/src/workspace-reference-cache.ts` 的 `getWorkspaceReferenceSnapshot()`。
- Bounded watched file read：`readFilePrefix()`、`summarizeFile()`。
- Snapshot Lite summary：`summarizeWorkspaceSnapshotLite()`。
- Ignore/source boundary：`readIgnoreSources()`、`getIgnoredReason()`。
- Changed summary：`diffWorkspaceSnapshotLite()`。
- `/cache status` 摘要：`packages/tui/src/index.ts` 的 `formatWorkspaceSnapshotLiteStatus()` / `formatCacheStatus()`。
- Focused tests：`packages/tui/src/workspace-reference-cache.test.ts`。

## 参考核对

本阶段实际读取 / 使用的 Linghun 文档和源码上下文：

- `F:\Linghun\START_NEXT_CHAT.md`
- `F:\Linghun\docs\delivery\pre-open-source-terminal-product-completion-gate.md`
- `F:\Linghun\docs\audit\reference-map.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\docs\delivery\phase-15-5a-performance-context.md`
- `F:\Linghun\docs\delivery\phase-15-5c-editing-tool-ux.md`
- `F:\Linghun\docs\delivery\phase-15-5c-plus-log-artifact-runtime-lite.md`
- `F:\Linghun\docs\audit\workspace-snapshot-helper-research.md`
- `F:\Linghun\packages\tui\src\workspace-reference-cache.ts`
- `F:\Linghun\packages\tui\src\workspace-reference-cache.test.ts`
- `F:\Linghun\packages\tui\src\index.ts` targeted `/cache status`、`/cache warmup`、`/cache refresh`、`/index status`、RuntimeStatus/context sections
- `F:\Linghun\packages\tools\src\index.ts` targeted Read/Edit/MultiEdit snapshot、`expectedHash`、stale file sections

本阶段参考核对范围：

- 只参考成熟终端产品和既有 Linghun 审计中的行为边界：bounded metadata、ignore/source boundary、large output/source 不进主屏、shared context refs、fast index status。
- 进入 Linghun 自研实现的内容：bounded file prefix read、top-level metadata snapshot、ignore source hash、changed summary、`/cache status` snapshot line、focused tests。
- 未复制 CCB、CCB Dev Boost、Codex、Aider、MCP/codebase-memory 或其他第三方可疑源码实现、内部 API、专有遥测或内部服务逻辑。

### Reference delta catch-up 裁决表

| 来源细节 | 裁决 | Phase 15.5C++ 处理 |
| --- | --- | --- |
| gate / blueprint：Workspace Snapshot Lite 是 TS/Node 轻量实现 | DONE | 只改 TS/Node；未引入 native/binary。 |
| research：watched file bounded hash 不能先整文件 readFile | DONE | `readFilePrefix()` 使用 `open/read` prefix。 |
| gate：只缓存 stat/hash/ignore/top-level directory/changed summary 等轻量 metadata 和 refs | DONE | `workspaceSnapshot` 只存 metadata/counts/changed keys。 |
| gate：ignore/source boundaries | DONE | `.linghunignore`、`.cbmignore`、`.gitignore` prefix metadata + hard-skip dirs。 |
| gate：bounded top-level directory summary | DONE | 只枚举 project root top-level entries，限制 stored entries。 |
| gate：cache failure fallback，不阻断主对话 | DONE | 复用 WRC fallback，并保留上一份 snapshot metadata。 |
| gate：output summary-first，不输出完整文件列表/源码/日志/索引 | DONE | `/cache status` 只新增一行 counts/changed 摘要。 |
| gate：`/index status` 默认仍 fast，不运行 detect_changes | DONE | 未改 index command；snapshot 不调用 detect_changes。 |
| research：Project Doctor / Context Picker / Architecture Runtime 可消费短 facts | DEFERRED | 本轮只提供 shared metadata 地基；完整入口留 Phase 15.5F。 |
| research / Phase 17A：agent/job 共享 snapshot refs，避免重复全仓扫描 | DEFERRED | Phase 17A 消费留后续；本轮不实现 durable jobs。 |
| 完整 gitignore 语义 / rg/git tracked file listing / persistent cache | DEFERRED | Lite 阶段只做简单 ignore boundary 和进程内 metadata。 |
| native/binary/database/full watcher/LSP/second index engine | NOT-DO | 未实现。 |
| 替代 codebase-memory / 默认 detect_changes / 自动 index refresh | NOT-DO | 未实现。 |
| Phase 15.5D/E/F、Phase 16/17/18 | NOT-DO | 未进入。 |
| 真实全量 smoke、Beta PASS、smoke-ready、open-source-ready | NOT-DO | 未执行、未声明。 |

## 成品级结构化 handoff packet

- 下一阶段：可由用户决定是否进入 Phase 15.5D Connect Lite；不得自动进入。
- 禁止事项：不得进入 Phase 15.5D-F / Phase 16 / 17 / 18；不得执行真实全量 smoke；不得宣称 Beta PASS、smoke-ready 或 open-source-ready；不得 commit；不得实现 native/binary、sqlite/database、全仓 watcher、自研索引引擎、LSP 或第二套 provider/tool/permission/evidence/MCP/index/agent/job 系统。
- 证据引用：`packages/tui/src/workspace-reference-cache.test.ts` focused tests；本报告“测试与验证”命令输出。
- 验证结果：focused workspace cache PASS；typecheck PASS；check PASS；git diff --check PASS（仅 Windows LF/CRLF warning）。
- 索引状态：`mcp__codebase-memory-mcp__index_status(project=F-Linghun)` 返回 ready（nodes=1512，edges=2913）。
- 权限模式：未修改四种 permission mode；Start Gate / permission pipeline 保持既有路径。
- 模型/provider：本地实现与测试 provider-agnostic；未写入或泄露 provider key。
- 预算使用：Workspace Snapshot Lite 只做 bounded top-level metadata 和 bounded file prefix read；未新增后台索引、数据库、native binary、watcher 或联网请求；完整源码不会进入主屏、prompt、memory 或 handoff。
- Commit 状态：本轮未 commit。
