# Phase 15 pre-Beta：Verification guard + current MCP/index runtime smoke

日期：2026-05-21

## 范围

本轮只继续 Phase 15 Batch 3：Verification guard + current MCP/index runtime smoke。

明确不进入：

- Phase 15.5 / Phase 16+
- Bundled codebase-memory Lite
- MCP marketplace
- 自研索引引擎
- 新架构或大重构
- Beta readiness PASS 宣告

## 改动文件

本轮在已有未提交改动基础上做最小补丁，并未覆盖已有改动。

- `packages/tui/src/index.ts`
  - `/mcp status` / `/mcp doctor` 文案保留并强调 MCP/codebase-memory 是外部 CLI/runtime，不是 bundled/internal。
  - `/index status` 在 missing 且存在 external CLI error 时，提示确认 `codebase-memory-mcp` 可执行或安装/配置外部 CLI；同时说明普通聊天不受影响。
  - `summarizeIndexResult(...)` 不再对 `search_code` 结果直接 `stableStringify(...)` 每条 match，避免 primary output 泄露 `raw_source`、完整 graph 或大源码片段。
  - 新增 `summarizeIndexSearchItem(...)`，只显示 path / symbol / kind 等短字段。
  - `extractRequestedReportPath(...)` 支持带引号的 `.md` 路径，覆盖中文路径、空格路径和中文报告 smoke。
- `packages/tui/src/index.test.ts`
  - 新增当前 MCP/index runtime summary-only smoke。
  - 新增缺失 `codebase-memory-mcp` 时清晰降级且普通聊天继续的 smoke。
  - 新增 Windows 中文路径 / 空格路径 / 中文报告通过 `Write` + permission + continuation 生成的 smoke。
  - 保留并通过既有 ordinary project/report/index prompt、summary-first、report Write closure、pending approval、reasoning profile 等回归。
- `packages/tui/src/natural-command-bridge.ts`
  - 保留已有修正：普通带 index 的项目分析请求不被 `/index` control-plane 抢答；只有安全 index action 才作为 index control intent。
- `packages/tui/src/natural-command-bridge.test.ts`
  - 保留 ordinary development request 样例，覆盖中文项目分析、报告、索引辅助分析进入 model loop。
- `docs/audit/phase-15-pre-beta-verification-guard-and-index-runtime-smoke.md`
  - 本报告。

工作区中还存在本轮开始前已有的文档改动：

- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/README.md`
- `docs/delivery/ccb-dev-boost-coverage-checklist.md`
- `docs/delivery/phase-10-mcp-index.md`

## Smoke 覆盖矩阵

| # | Smoke 项 | 覆盖方式 | 结果 |
| --- | --- | --- | --- |
| 1 | 普通中文项目分析 / report / index prompt 进入 provider/model request，不被 NCB、`/index` 或 catalog 抢答 | `natural-command-bridge.test.ts` ordinary development request 样例；`index.test.ts` provider stdin smoke 与 `handleNaturalInput(...)` 回归 | PASS |
| 2 | Read / Glob / Grep / Bash primary summary-first，不 dump raw 文件内容、grep matches、glob 列表或 Bash stdout/stderr | 既有 `keeps Read, Grep, and Glob primary output summary-first without raw result floods`；`keeps Bash output summary-first while preserving a full log path` | PASS |
| 3 | report-generation 走 Write + permission + tool_result + continuation + final answer path，不走 Bash redirection | 既有 project report Write 回归、多工具 continuation 回归；新增中文/空格路径 report Write smoke | PASS |
| 4 | pending approval 下 yes / no / cancel / status / 普通追问稳定，不丢 pending tool_use，不误执行 | 既有 allow/deny/cancel/status/follow-up/sibling tool calls 回归 | PASS |
| 5 | OpenAI-compatible `chat_completions` reasoning 显示 ignored/unsupported/未生效；`responses` 显示 effective/sent | 既有 strict chat reasoning ignored 与 selected runtime profile 回归 | PASS |
| 6 | Windows 中文路径 / 空格路径 / 中文报告 smoke | 新增 `generates Chinese report paths with spaces through Write after permission approval` | PASS |
| 7a | `/mcp doctor` 可诊断 codebase-memory 外部 CLI 状态 | 新增 MCP/index runtime smoke 使用 mock external CLI `--version` 与 tools 调用 | PASS |
| 7b | `/index status` 默认不误导为 bundled/internal | 新增断言输出包含 `runtime: external codebase-memory-mcp CLI`，且不包含 bundled 内置误导 | PASS |
| 7c | 缺失 `codebase-memory-mcp` 时清晰降级，不影响普通聊天 | 新增 missing external CLI smoke：输出 missing/error/suggestion，普通聊天仍请求 mock provider 并返回 | PASS |
| 7d | 有索引时只输出 summary，不刷完整 graph / 大源码 | 新增 mock `search_code` / `get_architecture` 包含 `raw_source` 和 `FULL_GRAPH_SHOULD_NOT_DUMP`，断言 primary output 不包含 | PASS |
| 7e | 普通“项目有索引，可以先看看索引”仍进入模型 tool loop，而不是 `/index` answer | `natural-command-bridge.test.ts` ordinary development request 样例覆盖 | PASS |

## 关键行为说明

### Ordinary project/report/index prompts

普通项目分析、部署建议、报告输出、以及“有索引可以先看看索引”的请求都保持为模型任务语义：

- 不被 Natural Command Bridge 误判为 `/index status` / `/index search` 控制面命令。
- 不由 catalog 抢答。
- 不自动触发危险或重建索引动作。
- 进入 provider/model path 后，由模型按 tool loop 决定是否调用 Read / Grep / Glob / Write 等工具。

### Summary-first 输出

Read / Grep / Glob / Bash 的主屏输出保持 summary-first：

- Read 不在主屏 dump 原始行内容。
- Grep 不在主屏 dump 全量 matches。
- Glob 不在主屏 dump 长文件列表。
- Bash 不在主屏 dump stdout/stderr；完整内容保留在 evidence/log path。
- index search / architecture 也只输出短摘要，不输出 raw source 或 full graph。

### Report generation guard

显式报告生成仍要求走 `Write` 工具路径：

```text
user request -> model tool_use(Write) -> permission approval -> tool_result -> continuation -> final answer path
```

本轮新增中文路径 / 空格路径覆盖：

```text
中文 目录/部署 报告.md
```

该路径通过 `Write` 创建，未使用 Bash redirection。

### MCP/index runtime

当前 Phase 15 只把 codebase-memory 作为外部 MCP server/CLI runtime：

- `/mcp doctor` 用于诊断外部 CLI 是否 configured/missing。
- `/index status` 明确显示 external codebase-memory-mcp CLI，不称为 bundled/internal indexer。
- external CLI 缺失时，index 能清晰降级，普通聊天仍可继续。
- 有索引时，search/architecture 输出为短摘要，不把完整 graph/source 刷入主屏。

## 验证命令与结果

```bash
corepack pnpm vitest run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts
```

结果：PASS，2 files / 227 tests。

```bash
corepack pnpm check
```

结果：PASS，Biome checked 47 files，no fixes applied。

说明：首次运行发现 `packages/tui/src/index.test.ts` 有 Biome 格式化差异；已做纯格式修正后重跑通过。

```bash
corepack pnpm typecheck
```

结果：PASS，`tsc -b tsconfig.json` 完成。

```bash
corepack pnpm test
```

结果：PASS，11 files / 300 tests。

```bash
corepack pnpm build
```

结果：PASS，workspace packages build 完成。

```bash
git diff --check
```

结果：PASS。Git 输出 LF/CRLF 工作区提示，但未报告 whitespace error。

## Index status

- `mcp__codebase-memory-mcp__index_status(project=F-Linghun)`：ready，nodes=1304，edges=2437。
- `mcp__codebase-memory-mcp__detect_changes(project=F-Linghun)`：changed_count=11。
- 变更检测包含当前工作区已修改的 TUI 与文档文件；未刷新/重建索引，未做自研索引实现。

## SKIPPED / PARTIAL / BLOCKED

- SKIPPED：未运行真实 provider live smoke；本轮使用测试内 mock OpenAI-compatible provider 验证链路，不读取或暴露真实 API key。
- SKIPPED：未对真实外部 codebase-memory CLI 做破坏式安装/卸载测试；缺失场景通过 missing command mock 覆盖，当前仓库索引状态通过现有 MCP index_status 验证为 ready。
- PARTIAL：Phase 15 real-project Beta decision 仍未自动通过。本轮是 focused/mock/local verification guard + MCP/index runtime smoke，不等于真实项目 Beta readiness。
- BLOCKED：Phase 15 real-project Beta decision 仍需真实项目/真实 provider/真实运行环境的最终决策验证；不能由本轮 focused/mock/local PASS 自动升级为 Beta PASS。

## 阶段边界

- 只执行 Phase 15 Batch 3。
- 未进入 Phase 15.5。
- 未进入 Phase 16+。
- 未实现 Bundled codebase-memory Lite。
- 未实现 MCP marketplace。
- 未实现自研索引引擎。
- 未做新架构或大重构。
- 未提交 commit。
- 未宣布 Beta readiness PASS。

## 结论

Batch 3 要求的 focused smoke 与本地验证命令均已通过。

但是：这只能说明 Phase 15 Batch 3 的 focused/mock/local verification guard 与当前 MCP/index runtime smoke 通过；不能自动代表 Phase 15 Beta readiness PASS。Phase 15 real-project Beta decision 仍保持阻塞/待真实项目决策验证。
