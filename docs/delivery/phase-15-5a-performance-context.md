# Phase 15.5A：Performance & Context

## 阶段目标

本轮只完成 Pre-Open-Source Terminal Product Completion Gate 的 Phase 15.5A：Performance & Context。范围限定为 Workspace Reference Cache / Virtual Workspace Cache、Compact Lite boundary、`cache/status/index` fast path、focused tests 与本交付报告。

本轮不进入 Phase 15.5B-F，不进入 Phase 16/17/18，不执行真实全量 smoke，不声明 Beta PASS 或 smoke-ready，不提交 commit。

## 已完成功能

- 新增 Workspace Reference Cache / Virtual Workspace Cache：缓存可重建的工作区摘要、runtime 状态、能力摘要、evidence/log 引用和小哈希。
- 新增 Compact Lite 纯本地边界：支持 MicroCompact、手动 `/compact manual` 边界记录和 `/compact auto` 受控说明。
- `/cache status` 显示 workspace reference 命中、miss、failure 与 latest source。
- `/cache warmup|refresh` 刷新 workspace reference snapshot，并把结果纳入 cache freshness。
- 模型请求前刷新 workspace reference，并在本地 context 构造后执行 MicroCompact；该路径不额外发起模型调用。
- `/index status` 默认 fast path 保持不触发 `detect_changes`；显式 fresh/check 路径仍由既有测试覆盖。
- Command Capability Catalog / help / natural command bridge 增加 `/compact` 能力说明。

## 使用方式

```text
/cache status
/cache warmup
/cache refresh
/compact status
/compact manual
/compact auto
/index status
/index status --fresh
/index check
```

说明：

- `/cache warmup|refresh` 只刷新 bounded workspace reference snapshot，不缓存完整源码、完整日志或 provider raw request。
- `/compact manual` 只记录边界，不执行工具、不写项目文件、不写长期记忆、不启动后台任务。
- `/compact auto` 当前是受控最小实现说明；实际 MicroCompact 只在 provider 请求前的本地消息构造阶段按上下文预算执行。
- `/index status` 默认仍是 fast status；不会重复运行 `detect_changes`，除非用户显式使用 fresh/check/refresh 类路径。

## 涉及模块

- `packages/tui/src/workspace-reference-cache.ts`：Workspace Reference Cache 类型、snapshot、bounded file/directory summaries、fallback 与 invalidation diff。
- `packages/tui/src/workspace-reference-cache.test.ts`：cache hit、file/runtime invalidation、fallback、directory summary focused tests。
- `packages/tui/src/compact-context.ts`：Compact Lite 类型、MicroCompact、本地消息裁剪、tool pair group 边界、manual boundary hash。
- `packages/tui/src/compact-context.test.ts`：MicroCompact 不切断 tool_use/tool_result pair、不保留不完整 tool group、preserved evidence/file refs focused tests。
- `packages/tui/src/index.ts`：接入 CacheState、`/compact`、workspace reference refresh、cache freshness、cache status、provider 前 MicroCompact。
- `packages/tui/src/index.test.ts`：help/catalog 与 `/compact` 本地边界测试；既有 `/index status` fast path 测试继续覆盖。
- `packages/tui/src/natural-command-bridge.ts`：Catalog 增加 `/compact` 能力。
- `docs/delivery/phase-15-5a-performance-context.md`：本交付报告。

## 关键设计

### Workspace Reference Cache / Virtual Workspace Cache

缓存内容只允许是 bounded、invalidatable、rebuildable 的摘要：

- file stat：path、exists/readable、size、mtimeMs、bounded content hash。
- directory summary：path、readable、files count、directories count、entryHash。
- RuntimeStatus：permission/model/index/cache/extensions 等短结构化状态。
- tool/capability summary：短文本摘要并截断。
- evidence/log refs：只保存引用 id/path，截断并限制数量。
- 小哈希：config/tool schema/provider-model/MCP tool list/index freshness/compact boundary/extensions。

明确禁止缓存：

- 完整源码。
- 完整聊天 transcript。
- 完整日志。
- 完整 index result / graph dump。
- API keys、tokens、secret 原文。
- provider raw request。

失败降级：

- scan/probe 失败时返回 `source: "fallback"`、`changedKeys: ["workspaceReferenceUnavailable"]`。
- fallback 使用输入 runtime/status refs 和上一份 bounded summary（若存在），不阻塞主对话路径。
- `cache.failures` 递增，便于 `/cache status` 暴露问题。

### Invalidation rules

`WorkspaceReferenceDimensions` 覆盖本阶段要求的运行时维度：

- `configHash`
- `toolSchemaHash`
- `providerModelHash`
- `mcpToolListHash`
- `indexFreshnessHash`
- `compactBoundaryHash`
- `extensionListHash`

文件和目录层面：

- 文件 summary 纳入 size、mtimeMs、bounded content hash。
- 目录 summary 纳入文件/目录计数与 entryHash。
- diff 输出至少包含 `fileStatHash`、`directorySummaryHash` 或具体 runtime dimension key。

### Compact Lite boundary

本阶段只实现 Compact Lite 边界，不实现长期记忆总结器或后台压缩任务：

- MicroCompact：纯本地消息裁剪；不执行工具、不写文件、不写长期 memory、不发额外模型调用。
- Manual compact：`/compact manual` 只记录 `CompactBoundary`，包含 pre/post token estimate、preserved evidence refs、preserved files、handoff packet id（若有）。
- Auto compact：当前只允许 provider 请求前、本地上下文超过预算时执行 MicroCompact；输出 `/compact auto` 说明阈值/边界，不启动后台任务。
- Tool pair safety：MicroCompact 按 assistant toolCalls + 后续 matching tool result 分组；完整组一起保留/移除，不完整组不保留，避免 provider 消息不合法。
- Stable prefix：不修改 system prompt / tool schema / MCP tool list 的稳定性契约，只把 compact boundary hash 纳入 cache freshness。

### cache/status/index fast path

- `/index status` 默认继续走 list/status fast path，不运行 `detect_changes`。
- `detect_changes` 只在显式 fresh/check/refresh 类路径触发。
- 该行为由既有 `index.test.ts` focused tests 保持覆盖。

## 配置项

本阶段未新增配置项，未修改依赖，未修改构建脚本。

## 命令

新增/扩展用户可见命令：

- `/compact status`
- `/compact manual`
- `/compact auto`
- `/cache status` 增加 workspace reference 行。
- `/cache warmup|refresh` 增加 workspace reference refresh 输出。

既有命令保持：

- `/index status` fast path。
- `/index status --fresh`、`/index check` 显式 freshness/check 行为。

## 测试与验证

Focused tests：

- `corepack pnpm exec vitest run packages/tui/src/workspace-reference-cache.test.ts packages/tui/src/compact-context.test.ts packages/tui/src/index.test.ts --testNamePattern "workspace reference cache|Compact Lite|index status fast|explicitly checks index freshness"`：PASS（3 files，8 passed，120 skipped）。

Repository validation：

- `corepack pnpm typecheck`：PASS。
- `corepack pnpm check`：首次因新文件格式失败，格式化后 PASS（54 files）。
- `git diff --check`：PASS；输出仅包含 Git 工作区 LF/CRLF 提示，无 whitespace error。
- `corepack pnpm test`：PASS（14 files，357 tests）。
- `corepack pnpm build`：PASS。

本轮没有执行真实全量 smoke；以上测试是本地 unit/focused/full repo validation，不构成 Beta PASS 或 smoke-ready 声明。

## 性能结果

- Workspace Reference Cache 命中测试验证：第二次请求 `source: "hit"`，自定义 slow scan 只调用 1 次。
- `/index status` fast path 测试验证：默认只调用 `list_projects` + `index_status`，不调用 `detect_changes`。
- MicroCompact 只在本地消息构造阶段按字符预算运行，无额外模型调用。
- Cache 内容为 bounded summary；默认单文件 hash 只读取 bounded bytes（默认 256 KiB）。

## 已知问题

- Workspace Reference Cache 当前是进程内 cache；重启后可重建，不做跨进程持久化。
- Auto compact 当前是受控最小实现：只在 provider 请求前本地消息预算超限时 MicroCompact，不提供后台 job、cancel/retry UI 或长期 handoff writer；这些不属于 Phase 15.5A。
- 本轮未做真实全量 smoke，因此不能宣称真实项目完整链路通过。

## 不在本阶段处理的内容

- Phase 15.5B-F。
- Phase 16/17/18。
- Resource & Task Lifecycle、Editing & Tool UX、Connect Lite、Provider & Freshness 后续扩展。
- 真实全量 smoke、Beta PASS、smoke-ready 决策。
- 跨进程持久 cache、完整 index result cache、完整 transcript cache。
- 长期 memory summary writer 或后台 compact job。

## 下一阶段衔接

Phase 15.5A 完成后，下一步可以由用户决定是否进入 Phase 15.5B。不得自动进入 Phase 15.5B-F、Phase 16/17/18，也不得把本轮验证结果解释为真实全量 smoke 或 Beta readiness。

## 开发者排查入口

- Cache snapshot：`packages/tui/src/workspace-reference-cache.ts` 的 `getWorkspaceReferenceSnapshot()`。
- Cache diff：`diffWorkspaceReference()`。
- Compact grouping：`packages/tui/src/compact-context.ts` 的 `groupMessagesWithoutSplittingToolPairs()`。
- Provider 前 context：`packages/tui/src/index.ts` 的 `buildModelMessagesWithRecentContext()`。
- Cache status 输出：`formatCacheStatus()`。
- Index fast path：`handleIndexCommand()` / `refreshIndexStatus()` 相关既有路径。

## 参考核对

本阶段实际读取的 Linghun 文档：

- `README.md`
- `START_NEXT_CHAT.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- `docs/audit/reference-map.md`
- `docs/audit/phase-15-real-smoke-p1-query-lifecycle-primary-output-and-report-generation.md`

本阶段参考核对范围：

- 只参考 CCB / CCB Dev Boost / community 成熟产品的行为边界：stable prompt prefix、cacheable bounded summaries、compact boundary、tool_use/tool_result pair safety、index status fast path。
- 进入 Linghun 自研实现的内容：本地 bounded workspace summary、CompactBoundary 类型、MicroCompact 分组裁剪、`/compact` 用户路径、focused tests。
- 未复制 CCB、CCB Dev Boost 或其他第三方可疑源码实现、内部 API、专有遥测或内部服务逻辑。

## 成品级结构化 handoff packet

- 下一阶段：可由用户决定是否进入 Phase 15.5B；不得自动进入。
- 禁止事项：不得进入 Phase 15.5B-F / Phase 16/17/18；不得执行真实全量 smoke；不得宣称 Beta PASS 或 smoke-ready；不得 commit；不得缓存完整源码/聊天/日志/index/API key/token/provider raw request。
- 证据引用：`packages/tui/src/workspace-reference-cache.test.ts`、`packages/tui/src/compact-context.test.ts`、`packages/tui/src/index.test.ts` 中的 focused tests；本报告“测试与验证”命令输出。
- 验证结果：focused vitest PASS；typecheck PASS；check PASS；git diff --check PASS；full test PASS；build PASS。
- 索引状态：`mcp__codebase-memory-mcp__index_status(project=F-Linghun)` 返回 ready（nodes=1394，edges=2645）。
- 权限模式：未修改四种 permission mode 与 Start Gate / permission pipeline；Compact/cache 路径不绕过权限。
- 模型/provider：本地实现与测试为 provider-agnostic；workspace dimensions 纳入 provider/model hash；未写入或泄露 provider key。
- 预算使用：Workspace Reference Cache 只保存 bounded summaries 与 refs；MicroCompact 不发额外模型调用；未运行真实全量 smoke。
