# Closure Phase 5 - Local Hardcoded Policy Cleanup

## 阶段目标

按 `LINGHUN_CLOSURE_PHASED_TASKS.md` Phase 5 收口会影响行为稳定的局部硬编码和用户可见标签：verification timeout 只保留一个真源，index artifact 路径和 Linghun storage 配置关系明确，status/footer/index 标签一致性复核。只做最小必要改动，不做大拆、不新增配置项、不改 provider route、不关闭 memory/index/cache/compact/verification/agent/workflow 能力。

## 已完成功能

- Verification timeout 单一来源：
  - `runVerificationCommand()` 默认 timeout 改为引用 `LINGHUN_VERIFICATION_COMMAND_TIMEOUT_MS`。
  - 环境变量 `LINGHUN_VERIFICATION_COMMAND_TIMEOUT_MS` 仍由 `runtime-budget.ts` 统一读取。
  - 移除 verification runtime 内部重复的 `10 * 60 * 1000` 局部常量。
- Index artifact 路径边界：
  - 新增 `getCodebaseMemoryArtifactDir()` / `getCodebaseMemoryGraphPath()`。
  - `readLocalIndexArtifactState()` 复用 helper，明确 graph artifact 是 `<project>/.codebase-memory/graph.db.zst`。
  - 源码注释明确：`.codebase-memory` 是 codebase-memory artifact；Linghun `storage.index` 是 Linghun metadata/config storage，不是 graph path。
- Footer/status 标签一致性：
  - 英文 footer 的 `model` / `cache` 改为 `Model` / `Cache`，与 runtime status 的 `Model` / `Cache` / `Index` 对齐。
  - Index 标签已复核：英文 `Index` / `Index?`，中文 `索引` / `索引?` 已一致。

## 审查裁决

- background cap：
  - 真源已在 `tui-context-runtime.ts`：`MAX_BACKGROUND_TASKS = 50`、`BACKGROUND_RUNNING_GLOBAL_CAP` 由 `LINGHUN_BACKGROUND_RUNNING_GLOBAL_CAP` 覆盖、`BACKGROUND_KIND_CAPS` 分类型约束。
  - 本阶段不新增配置项，不改 cap 行为。
- workspace-reference limits：
  - 真源在 `workspace-reference-cache.ts`：`DEFAULT_FILE_HASH_BYTES`、`DEFAULT_IGNORE_FILE_BYTES`、`DEFAULT_TOP_LEVEL_ENTRY_LIMIT`。
  - 这些是 cache/snapshot 内部 bounded 安全阈值，当前无需暴露为用户配置。
- CommandPanel rows/width：
  - `MAX_SELECTABLE_ROWS = 8` 是 `CommandPanel.tsx` 局部 UI 滚动窗口常量。
  - 当前没有跨模块复用需求，不集中化，避免为配置化而配置化。
- model/provider 默认路由：
  - 打包默认 executor/planner/reviewer/verifier/summarizer 走 `deepseek` + `LINGHUN_DEFAULT_MODEL ?? LINGHUN_DEEPSEEK_MODEL ?? deepseek-chat`。
  - `vision` / `image` 默认未配置，不伪装能力可用。
  - TUI selected runtime 找不到 provider 时返回 `unknown`；route doctor 对未知 route model 的 `openai-compatible` 是诊断/修复推断，不是当前 runtime 已切换 provider。
- unknown model tools support：
  - 当前策略保持不变：provider 显式 `supportsTools: false` 或模型元数据明确 `supportsTools: false` 时不发送 tools；unknown model metadata 默认乐观发送 tools，让 provider/API 返回真实兼容性错误。
  - 本阶段不把 unknown model 改成默认禁用 tools，避免降级真实兼容 provider 或中转站。

## 使用方式

- 验证命令 timeout：
  - 默认 10 分钟。
  - 可通过 `LINGHUN_VERIFICATION_COMMAND_TIMEOUT_MS` 覆盖。
- 查看索引状态：
  - `/index status`
  - `/index doctor`
- 查看模型路由和工具能力诊断：
  - `/model route`
  - `/model route doctor`
  - `/model doctor`

## 涉及模块

- `packages/tui/src/verification-command-runtime.ts`
- `packages/tui/src/index-runtime.ts`
- `packages/tui/src/shell/models/footer-view.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/index-runtime.test.ts`
- `packages/tui/src/shell/models/footer-view.test.ts`

## 关键设计

- 行为阈值只集中真正会影响运行稳定的 timeout。UI 局部行数和 workspace snapshot 内部 limit 只记录真源，不扩散成配置中心。
- `.codebase-memory` 与 `.linghun/index` 保持职责分离：前者由 codebase-memory runtime 管理 graph artifact，后者属于 Linghun storage 配置/metadata 边界。
- provider/model route 不做重写：Phase 5 只明确现状，避免把 `unknown` selected runtime、route doctor 推断和真实 provider fallback 混成同一个语义。
- unknown model tools strategy 不降级：明确禁用时保守关闭，未知时继续尝试并依赖 provider/runtime error path 诊断。

## 配置项

- 已有配置/环境变量：
  - `LINGHUN_VERIFICATION_COMMAND_TIMEOUT_MS`
  - `LINGHUN_BACKGROUND_RUNNING_GLOBAL_CAP`
  - `LINGHUN_DEFAULT_MODEL`
  - `LINGHUN_DEEPSEEK_MODEL`
- 本阶段没有新增配置项、依赖、构建脚本或 provider env 字段。

## 命令

- `corepack pnpm --filter @linghun/tui exec vitest run src/index-runtime.test.ts src/shell/models/footer-view.test.ts`
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "Closure Phase 5"`
- `corepack pnpm --filter @linghun/tui exec tsc --noEmit`
- `git diff --check`

## 测试与验证

- Index/footer focused tests：PASS，2 files，22 tests。
- Closure Phase 5 timeout source invariant：PASS，1 test selected，676 skipped by filter。
- TUI typecheck：PASS。
- Diff whitespace check：PASS。

## 性能结果

- 未新增模型请求。
- 未新增后台任务。
- 未新增索引扫描或 detect_changes。
- Verification timeout 来源变化不改变默认值，只让 env override 通过统一真源生效。

## 已知问题

- `currentModelSupportsTools()` 仍是模块内私有函数；本阶段不为测试便利导出 test hook，避免扩大接口面。
- unknown model tools 默认乐观发送会让真实不兼容 provider 在请求时返回错误；这是当前策略，不在 Phase 5 改为 fail-closed。
- 本阶段 focused/local validation 不代表真实 full smoke、Beta PASS、smoke-ready、open-source-ready 或全局成熟。

## 不在本阶段处理的内容

- 不拆大文件。
- 不重写 provider、runner、workflow、agent 系统。
- 不改 memory learning 当轮生效语义。
- 不关闭索引、缓存、compact、verification、agent/workflow 高级能力。
- 不为了配置化而配置化。
- 不进入 Phase 6 或后续阶段。

## 下一阶段衔接

Phase 5 完成后停止。后续是否进入下一阶段必须由用户确认。Phase 5 PASS 只证明本阶段局部硬编码/策略口径收口，不代表 Linghun 整体成熟。

## 开发者排查入口

- Verification timeout：`packages/tui/src/runtime-budget.ts`、`packages/tui/src/verification-command-runtime.ts`
- Index artifact path：`packages/tui/src/index-runtime.ts`、`packages/tui/src/mcp-index-runtime.ts`
- Footer labels：`packages/tui/src/shell/models/footer-view.ts`
- Runtime status labels：`packages/tui/src/runtime-status-presenter.ts`
- Model route：`packages/config/src/index.ts`、`packages/tui/src/tui-model-runtime.ts`、`packages/tui/src/model-doctor-runtime.ts`
- Tool support strategy：`packages/tui/src/model-stream-runtime.ts`、`packages/providers/src/index.ts`

## 参考核对

- 实际读取 Linghun 文档：
  - `LINGHUN_CLOSURE_PHASED_TASKS.md`
  - `LINGHUN_IMPLEMENTATION_SPEC.md`
  - `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
  - `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
  - `docs/delivery/README.md`
  - `docs/delivery/phase-closure-04-daily-path-lightening.md`
- 实际参考源码：
  - `packages/tui/src/runtime-budget.ts`
  - `packages/tui/src/verification-command-runtime.ts`
  - `packages/tui/src/index-runtime.ts`
  - `packages/tui/src/mcp-index-runtime.ts`
  - `packages/tui/src/mcp-index-command-runtime.ts`
  - `packages/tui/src/tui-context-runtime.ts`
  - `packages/tui/src/workspace-reference-cache.ts`
  - `packages/tui/src/shell/components/CommandPanel.tsx`
  - `packages/tui/src/shell/models/footer-view.ts`
  - `packages/tui/src/runtime-status-presenter.ts`
  - `packages/config/src/index.ts`
  - `packages/tui/src/tui-model-runtime.ts`
  - `packages/tui/src/model-doctor-runtime.ts`
  - `packages/tui/src/model-stream-runtime.ts`
  - `packages/providers/src/index.ts`
- CCB / CCB Dev Boost / 社区参考：
  - 本阶段只按既有 Linghun 文档中的 CCB handfeel 目标做行为参考：状态清楚、策略不误导、阈值有真源、不把局部成熟宣传成全局成熟。
  - 未复制 CCB 或任何可疑源码实现。

## 阶段 Verdict

- verdict：PASS
- 是否允许进入下一阶段：no，必须等待用户确认。
- P0/P1/P2 风险分类：
  - P2：unknown model tools 默认乐观发送仍依赖 provider/API 错误路径暴露不兼容；本阶段只明确策略，不改行为。
- 阻塞项：无。
- 用户下一步审核点或命令：审阅 Phase 5 diff 与验证结果；确认是否需要后续阶段。

## 真实改动文件

- 代码：
  - `packages/tui/src/verification-command-runtime.ts`
  - `packages/tui/src/index-runtime.ts`
  - `packages/tui/src/shell/models/footer-view.ts`
- 测试：
  - `packages/tui/src/index.test.ts`
  - `packages/tui/src/index-runtime.test.ts`
  - `packages/tui/src/shell/models/footer-view.test.ts`
- 文档：
  - `docs/delivery/phase-closure-05-local-hardcoded-policy-cleanup.md`
  - `docs/delivery/README.md`
- 生成物：无。

## 运行时事实

- provider/model：Codex coding agent in local workspace；未改 Linghun product provider route。
- permission mode：local workspace direct edit；未改产品权限配置。
- index status：codebase-memory MCP tool unavailable in this Codex thread；使用 `rg`、源码精读和 2 个只读 explorer subagents 做事实核对；未 refresh/rebuild。
- cache/usage 来源：未新增 usage 统计；未改 cache schema。
- 配置来源：未新增配置项。
- 是否有脱敏/密钥风险：未新增 secret 输出。

## 后台/复查任务状态反馈

- 本阶段未新增后台任务类型。
- 未启动真实 index refresh、provider smoke、full smoke 或长后台 job。

## 语言与 i18n 口径

- 英文 footer `Model` / `Cache` 与 runtime status 对齐。
- 中文 footer/status/index 标签保持既有 `模型` / `缓存` / `索引`。

## Handoff Packet

- verdict: pending-validation
- nextPhase: none until user confirmation
- mustNotDo:
  - 不把 Closure Phase 5 PASS 当作全局成熟。
  - 不自动进入下一阶段。
  - 不改 memory learning 当轮生效语义。
  - 不关闭 index / memory / cache / compact / verification / agent / workflow。
  - 不重写 provider route 或 unknown model tools 策略。
  - 不为了配置化而配置化。
- evidenceRefs:
  - `packages/tui/src/runtime-budget.ts`
  - `packages/tui/src/verification-command-runtime.ts`
  - `packages/tui/src/index-runtime.ts`
  - `packages/tui/src/shell/models/footer-view.ts`
  - `packages/tui/src/index.test.ts`
  - `packages/tui/src/index-runtime.test.ts`
  - `packages/tui/src/shell/models/footer-view.test.ts`
- validation:
  - `@linghun/tui index-runtime.test.ts + footer-view.test.ts`: PASS, 22 tests
  - `@linghun/tui index.test.ts -t "Closure Phase 5"`: PASS, 1 selected
  - `@linghun/tui tsc --noEmit`: PASS
  - `git diff --check`: PASS
- indexStatus: codebase-memory MCP unavailable; local rg/source reads used; no refresh/rebuild.
- permissionMode: direct local workspace edits.
- provider/model: Codex coding agent; no product provider route changed.
- budgetUsed: no explicit token budget; no runtime usage/cost changes.
