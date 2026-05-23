# Phase 17 Pre-Smoke `index.ts` Modularization Batch 1

## 状态声明

- 本轮性质：Pre-Smoke `packages/tui/src/index.ts` modularization Batch 1。
- 本轮只做低风险首批拆分：index/codebase-memory runtime 的纯类型、纯 helper 和项目选择逻辑。
- 未运行真实 provider。
- 未使用真实 provider key。
- 未进入真实项目 smoke。
- 未进入 Phase 18 / open-source release。
- 未提交 commit。
- 当前仍不是 Beta PASS / smoke-ready / open-source-ready。

## Source-Level Reality Check 摘要

### 现有实现

`packages/tui/src/index.ts` 中 index/codebase-memory runtime 相关职责包括：

- 类型与状态：`CodebaseMemoryBinarySource`、`CodebaseMemoryBinaryStatus`、`CodebaseMemoryArtifactStatus`、`CodebaseMemoryProjectSelectionSource`、`IndexState`。
- 状态创建：`createIndexState(config)`。
- slash 调用点：`handleIndexCommand()` 处理 `/index status`、`/index doctor`、`/index check`、`/index init fast`、`/index refresh`、`/index search`、`/index architecture`。
- runtime/CLI 链路：`resolveCodebaseMemoryBinary()`、`getCodebaseMemoryResolution()`、`runCodebaseMemoryCli()`、`refreshIndexStatus()`、`refreshIndexStaleHint()`、`runIndexRepository()`、`runIndexQuery()`。
- 输出与摘要：`formatIndexStatus()`、`formatIndexRefreshSummary()`、`summarizeIndexResult()` 等。
- 项目选择：`findCurrentIndexProject()`、`createCurrentIndexProjectNameCandidates()`。

### 本轮可安全搬出

- codebase-memory/index 相关纯类型。
- `IndexState` 与 `IndexSafetyFile` 类型。
- `createIndexState(config)`。
- `findCurrentIndexProject(data, projectPath)`。
- `createCurrentIndexProjectNameCandidates(projectPath)`。

这些内容不依赖 `TuiContext`、output、session、evidence、background task 或 CLI 执行。

### 本轮暂不搬出

- `refreshIndexStatus()`：依赖 `TuiContext`、binary resolution、CLI execution、状态字段和 stale hint 规则，留到 Batch 2。
- `formatIndexStatus()`：依赖 `TuiContext`、redaction helper、用户可见文案和现有状态输出，留到 Batch 2。
- `runIndexQuery()` / `runIndexRepository()`：依赖 evidence、background task、index safety、output 和 CLI 执行，留到 Batch 2。
- slash command router、model loop、permission pipeline、MCP runtime 本体：不属于本轮。

### 最小 touch points

- `packages/tui/src/index-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index-runtime.test.ts`
- `docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-1.md`

### 禁止重复实现的系统

本轮未新增第二套 runtime / router / permission / evidence / MCP / index 系统；只移动低耦合 helper 与类型，继续复用原有 `/index` runtime 链路。

## 修改文件清单

- `packages/tui/src/index-runtime.ts`：新增小模块，承载 index/codebase-memory runtime 的纯类型、`createIndexState()` 和项目选择 helper。
- `packages/tui/src/index.ts`：改为从 `index-runtime.ts` 导入并 re-export `IndexState` / `createIndexState`，删除本地重复定义。
- `packages/tui/src/index-runtime.test.ts`：新增 focused unit tests 覆盖项目选择 helper。
- `docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-1.md`：新增本交付记录。

## 实际拆出的内容

`index-runtime.ts` 当前包含：

- `CodebaseMemoryBinarySource`
- `CodebaseMemoryBinaryStatus`
- `CodebaseMemoryArtifactStatus`
- `CodebaseMemoryProjectSelectionSource`
- `IndexSafetyFile`
- `IndexState`
- `CurrentIndexProject`
- `createIndexState()`
- `findCurrentIndexProject()`
- `createCurrentIndexProjectNameCandidates()`

## 行为不变说明

- `/index status` 默认 fast path 不变：仍只走 `list_projects` + `index_status`，不自动运行 `detect_changes`。
- `/index status --fresh` / `/index check` 的 `detect_changes` 触发规则不变。
- root_path 优先、name candidate fallback、大小写不敏感、歧义不猜、malformed data 返回 missing/null 的行为保持不变。
- 未硬编码 `F-Linghun`；Windows drive + basename candidate 仍由当前 `projectPath` 动态推导。
- 未改变 provider/model/tool/permission/evidence/MCP/index/runtime 行为。
- 未改变四权限模式语义。
- 未做 TUI 美化、slash command router 全拆或 model loop 拆分。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm exec vitest run packages/tui/src/index-runtime.test.ts packages/tui/src/index.test.ts -t "index status\|codebase-memory\|fresh"` | PASS：`index.test.ts` 23 passed；`index-runtime.test.ts` 因 `-t` 不匹配测试名被 skipped |
| `corepack pnpm exec vitest run packages/tui/src/index-runtime.test.ts` | PASS：6 tests passed |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm check` | PASS |
| `corepack pnpm build` | PASS |
| `git diff --check` | PASS |

## Focused tests 覆盖

`packages/tui/src/index-runtime.test.ts` 覆盖：

- root_path 优先。
- basename candidate 唯一匹配。
- Windows drive + basename 动态候选。
- 大小写不敏感。
- 歧义时不猜。
- malformed / missing `list_projects` data 返回 `null`。

## 未拆内容 / Batch 2 候选

建议 Batch 2 只在用户确认后继续，候选为：

1. `formatIndexStatus()` 与直接相关的纯 formatter，但需谨慎处理 redaction helper 和用户可见文案稳定性。
2. `refreshIndexStatus()` 与 `refreshIndexStaleHint()`，但需先确认如何避免把 `TuiContext`/CLI execution/evidence/background task 耦合搬成大 wrapper。
3. `summarizeIndexResult()` 一类纯摘要 helper，可作为低风险后续拆分。

不建议 Batch 2 直接硬拆 `runIndexRepository()`、slash router、model loop 或 permission pipeline。

## 参考核对

- 本轮实际读取的 Linghun 文档：`START_NEXT_CHAT.md`、`README.md`、`docs/delivery/phase-17-pre-smoke-index-ts-split-plan.md`、`docs/delivery/pre-smoke-p2-closure-hardening.md`、`docs/audit/pre-smoke-comprehensive-audit-2026-05-23.md`。
- 本轮实际读取的源码/测试：`packages/tui/src/index.ts`、`packages/tui/src/index.test.ts`。
- 本轮优先检查 codebase-memory 索引项目 `F-Linghun`：`index_status` 返回 ready；`list_projects` 中存在 `F-Linghun`；`search_code` 对目标符号未返回有效结果，因此降级为 `Grep`/精读源码确认。
- 未参考或复制 CCB / Claude Code / OpenCode / 第三方源码；本轮仅移动 Linghun 自研代码。

## 明确 NOT

- 不是 Beta PASS。
- 不是 smoke-ready。
- 不是 open-source-ready。
- 未进入真实 provider / 真实项目 smoke。
- 未进入 Phase 18 / open-source release。
- 未提交 commit。
- 未新增第二套 runtime / router / permission / evidence / MCP / index 系统。

## Handoff Packet

```json
{
  "phase": "phase-17-pre-smoke-index-ts-modularization-batch-1",
  "date": "2026-05-23",
  "scope": "low-risk index.ts modularization Batch 1 only",
  "indexProject": "F-Linghun",
  "indexStatusAtStart": "ready",
  "changedFiles": [
    "packages/tui/src/index-runtime.ts",
    "packages/tui/src/index.ts",
    "packages/tui/src/index-runtime.test.ts",
    "docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-1.md"
  ],
  "movedOut": [
    "IndexState and codebase-memory/index related pure types",
    "createIndexState",
    "findCurrentIndexProject",
    "createCurrentIndexProjectNameCandidates"
  ],
  "deferredToBatch2": [
    "refreshIndexStatus",
    "formatIndexStatus",
    "runIndexQuery",
    "runIndexRepository",
    "summarizeIndexResult helpers if still low-coupling"
  ],
  "notDone": [
    "real provider smoke",
    "real project smoke",
    "Beta PASS",
    "smoke-ready",
    "open-source-ready",
    "Phase 18",
    "commit"
  ],
  "nextDecision": "User may choose whether to continue with Batch 2; default stop after Batch 1."
}
```
