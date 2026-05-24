# Pre-Smoke Closure A - P1 Engineering Risk Closure

## 状态声明

- 本轮目标：进入真实项目 smoke 前收口终极审计 P1 = 3。
- 本轮未执行真实项目 smoke。
- 本轮不是 Beta PASS / smoke-ready / open-source-ready。
- 本轮未进入 Phase 18 / 桌面端 / 开源发布。
- 本轮未提交 commit。
- 独立 verifier 复检已按用户最新要求停止；本报告只记录本地自检结果，不声明 independent verifier PASS。
- 本轮未新增第二套路由、provider、tool、permission、evidence、job、runner、MCP、index、memory 或 agent 系统。
- 本轮未改变四权限模式、Start Gate、permission pipeline、Plan approval 或 PASS evidence 语义。
- 本轮未复制 CCB / OpenCode / Warp / 第三方源码。

## Source-Level Reality Check 摘要

### 索引状态

- codebase-memory 项目：`F-Linghun`
- 状态：`ready`
- 规模：`nodes=1936`，`edges=4111`

索引只用于缩小定位范围；最终结论以源码、测试和验证命令为准。

### Existing implementation

- `packages/tui/src/index.ts` 已拆出多项 presenter / helper：`runtime-status-presenter.ts`、`permission-presenter.ts`、`tool-output-presenter.ts`、`terminal-readiness-presenter.ts`、`natural-command-bridge.ts`、`index-safety-repair.ts`、`architecture-runtime.ts`、`workspace-reference-cache.ts`、`compact-context.ts`、`index-runtime.ts`、`remote-mcp-presenter.ts`、`job-runner-presenter.ts`、`request-lifecycle-presenter.ts`。
- `packages/tui/src/index.ts` 仍内联 slash router、model loop、permission pipeline、durable jobs、native runner、remote channels、MCP/index runtime 等高耦合职责。
- `packages/tui/src/runtime-status-presenter.ts` 的 `RuntimeStatusView` 已有 `cacheHitRate` 和 `indexStatus` 字段，但旧状态行未展示这两个字段。
- `packages/tui/src/log-artifact.ts` 已有 realpath-based artifact guard 与 display redaction；旧实现内联了 `isInside()` / path separator normalization。
- `packages/config/src/index.ts` 已支持项目 `.linghun`、用户数据目录、`LINGHUN_DATA_DIR`、用户级 settings、项目级 settings，并已有中文/空格/非 C 盘路径测试。
- `packages/tools/src/index.ts` 的 Read/Edit/Write/Bash 路径处理已有 workspace root resolve / relative path display / read-before-edit guard；现有语义保持不变。
- `packages/core/src/project.ts` 已有项目 identity path canonicalization，但旧实现独立做 `resolve().replaceAll("\\", "/").toLowerCase()`。

### Gaps

- P1-1：已有拆分计划不够明确列出当前已拆模块、仍内联模块、低风险优先顺序、每步风险/验证/停止点。
- P1-2：path display / compare / canonicalization 的明确交集分散在 `log-artifact.ts` 与 `core/project.ts` 等处；需要最小共享 helper 与 focused tests 统一口径，但不能改成新 FS abstraction。
- P1-3：runtime status line 缺 cache/index 短摘要，用户主状态无法直接看到 cache/index 信息。

### Minimal touch points

- `docs/delivery/phase-17-pre-smoke-index-ts-split-plan.md`
- `docs/delivery/pre-smoke-closure-a-p1-engineering-risk.md`
- `packages/shared/src/index.ts`
- `packages/shared/src/index.test.ts`
- `packages/core/src/project.ts`
- `packages/tui/src/log-artifact.ts`
- `packages/tui/src/log-artifact.test.ts`
- `packages/tui/src/runtime-status-presenter.ts`
- `packages/tui/src/runtime-status-presenter.test.ts`
- `packages/tools/src/index.test.ts`

### Forbidden duplicate systems

本轮明确没有新增第二套：

- slash router / command dispatcher
- provider / model loop
- tool registry / tool runner
- permission pipeline / Start Gate / Plan approval
- evidence / PASS evidence semantic layer
- durable job / native runner / remote channel runtime
- MCP / index runtime
- memory / agent runtime
- filesystem watcher / path abstraction / storage layer

### P1-1 / P1-2 / P1-3 裁决

| item | 裁决 | 说明 |
| --- | --- | --- |
| P1-1 `index.ts` maintenance risk | DONE for plan / DEFERRED for large refactor | 已更新最小拆分计划；smoke 前只要求计划 + 避免大改，不强行全拆。 |
| P1-2 Windows path canonicalization consistency | DONE for minimal helper + focused tests | 新增极小 shared path helper，复用到 log artifact guard/display 与 core project identity；tools/config 通过 focused tests 覆盖，不改权限语义。 |
| P1-3 runtime status cache/index summary | DONE | 状态行追加 cache/index 短摘要，null/unknown 显示 placeholder，保留 100 字符截断。 |

## P1-1：`index.ts` maintenance risk

### 处理结果

已更新：`docs/delivery/phase-17-pre-smoke-index-ts-split-plan.md`

计划现在包含：

- 当前已拆模块清单。
- 仍内联模块清单：slash router、model loop、permission pipeline、durable jobs、native runner、remote channels、MCP/index runtime。
- 低风险优先拆分顺序：
  1. pure presenter / formatter
  2. command parser / dispatcher helpers
  3. job / runner presenters or guards
  4. runtime state helpers
  5. model loop / permission pipeline 最后
- 每一步的风险、验证命令、停止点。
- smoke 前只要求“计划 + 避免大改”，不强行全拆。

### 是否做了代码拆分

没有做 `packages/tui/src/index.ts` 大拆。

原因：

- 当前 P1-1 是维护风险，不是已证明的 smoke blocker。
- 真正高耦合部分包括 model loop、permission pipeline、job/runner/runtime 状态机，临近真实 smoke 前大搬迁会带来更高回归风险。
- 本轮只允许最小可执行计划；P1-3 的 status presenter 小改不需要移动 `index.ts` 主逻辑。

## P1-2：Windows path canonicalization consistency

### 处理结果

采用 **minimal helper + focused tests**，不是 tests-only / partial。

新增/复用的明确交集：

- `normalizePathSeparators(path)`：统一 display/canonicalization 中的 `\\` -> `/`。
- `canonicalPathForCompare(path, caseInsensitive)`：统一 path compare 的 separator normalization + Windows case-insensitive 口径。
- `isPathInside(candidatePath, rootPath, caseInsensitive)`：统一 allowed-root compare 的边界判断，避免 sibling prefix 误判。

接入范围：

- `packages/tui/src/log-artifact.ts`
  - log artifact allowed path guard 继续保留 lexical + `realpath()` 双层校验。
  - display path 使用 shared separator normalization。
  - 没有降低 symlink/junction escape guard。
- `packages/core/src/project.ts`
  - 项目 identity canonicalization 复用 shared helper。
- `packages/config/src/index.test.ts`
  - 保留已有中文/空格、drive casing、非 C storage path 覆盖。
- `packages/tools/src/index.test.ts`
  - 增强 Read 工具 Windows drive-letter casing inside-workspace 行为覆盖。

未做事项：

- 未新增全局路径系统。
- 未新增 watcher。
- 未新增 FS abstraction。
- 未改变 permission semantics。
- 未改变 Windows 中文/空格/非 C 盘支持。

### Focused tests 覆盖

- Windows drive-letter casing compare/display consistency：`packages/shared/src/index.test.ts`、`packages/tools/src/index.test.ts`
- Chinese + space path display/redaction consistency：`packages/config/src/index.test.ts`、`packages/tui/src/log-artifact.test.ts`
- symlink/junction escape guard still rejects log artifact escape：`packages/tui/src/log-artifact.test.ts`
- non-C storage path still works：`packages/config/src/index.test.ts`

## P1-3：runtime status line cache/index short summary

### 处理结果

已更新：`packages/tui/src/runtime-status-presenter.ts`

状态行现在追加短摘要：

- zh-CN：`缓存 92% · 索引 ready`
- en-US：`Cache 92% · Index ready`
- `cacheHitRate === null`：`缓存?` / `Cache?`
- `indexStatus` 空或 `unknown`：`索引?` / `Index?`
- 长 `model` 与长 `indexStatus` 继续截断；整行仍保留 100 字符上限。
- 不展示 provider URL、api key、endpointProfile、reasoningStatus 等内部 debug 字段。

### Focused tests 覆盖

- zh-CN 状态行包含模型、模式、cache、index。
- en-US 状态行包含 model、mode、cache、index。
- null/unknown 显示短 placeholder。
- 长模型名 / 长 indexStatus 不破坏 100 字符截断。

## 修改文件清单

### Code

- `packages/shared/src/index.ts`
  - 新增极小 path helper：separator normalization、canonical compare、inside-root compare。
- `packages/core/src/project.ts`
  - 项目 identity path canonicalization 复用 shared helper。
- `packages/tui/src/log-artifact.ts`
  - log artifact path guard/display 复用 shared helper；保留 realpath symlink/junction escape guard。
- `packages/tui/src/runtime-status-presenter.ts`
  - runtime status line 追加 cache/index 短摘要与 placeholder。

### Tests

- `packages/shared/src/index.test.ts`
- `packages/tools/src/index.test.ts`
- `packages/tui/src/log-artifact.test.ts`
- `packages/tui/src/runtime-status-presenter.test.ts`

### Docs

- `docs/delivery/phase-17-pre-smoke-index-ts-split-plan.md`
- `docs/delivery/pre-smoke-closure-a-p1-engineering-risk.md`

### Pre-existing untracked files

以下未跟踪文件在本轮开始前已存在；本轮未把它们作为新产物提交，也未据此宣布 readiness：

- `docs/audit/performance-windows-stability-readonly-scout.md`
- `docs/audit/pre-smoke-terminal-product-ultimate-audit.md`

## 验证命令结果

| command | result |
| --- | --- |
| `git status --short` | 开工前仅看到 2 个既有未跟踪审计文档；未发现需要先停止的未稳定 Performance Gate / Polish D 小修。 |
| `corepack pnpm exec vitest run packages/tui/src/runtime-status-presenter.test.ts packages/tui/src/log-artifact.test.ts packages/config/src/index.test.ts packages/tools/src/index.test.ts packages/shared/src/index.test.ts` | PASS：5 files passed，56 tests passed。首次运行有 1 个 status presenter 断言过严，已最小修正后复跑 PASS。 |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm check` | PASS。首次运行只报 `packages/shared/src/index.ts` / test formatting，已最小修正后复跑 PASS。 |
| `corepack pnpm build` | PASS |
| `git diff --check` | PASS |

## 剩余风险与 smoke watchlist 更新

- `packages/tui/src/index.ts` 维护风险只完成计划闭环；大拆仍 DEFERRED 到 smoke 后或真实 smoke 暴露必须修复时定向执行。
- Windows path helper 只收口 display / compare / allowed-root 交集；未引入全局 FS abstraction。真实 Windows smoke 仍需观察：中文/空格项目、非 C 盘 storage、log artifact details、tools absolute path input、runner path display。
- Status line cache/index 短摘要已本地 presenter 覆盖；真实 TUI smoke 仍需观察窄终端下 100 字符截断是否符合主屏节奏。
- 未执行 live provider/API、真实项目 smoke、large stress、release artifact 或 bundled binary 验证。

## Handoff Packet

- Next step：停止在 Closure A 审核点；不要自动进入 Closure B 或真实 smoke。
- 禁止事项：未获用户明确确认前，不进入真实项目 smoke、Phase 18、桌面端、开源发布、release artifact、bundled binary、large stress、真实 provider live test。
- Evidence：本报告、`phase-17-pre-smoke-index-ts-split-plan.md`、focused tests、typecheck、check、build、diff-check。
- Index status：`F-Linghun` ready，`nodes=1936`，`edges=4111`。
- Permission / provider context：本轮为本地源码和测试收口；未调用真实 provider；未改变权限模式。
- Commit status：未提交 commit。
