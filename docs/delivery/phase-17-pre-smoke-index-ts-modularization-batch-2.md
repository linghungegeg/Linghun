# Phase 17 Pre-Smoke `index.ts` Modularization Batch 2

## 状态声明

- 本轮性质：Pre-Smoke `packages/tui/src/index.ts` modularization Batch 2。
- 本轮只做低风险 Remote / MCP presenter helpers 拆分。
- 未运行真实 provider。
- 未使用真实 provider key。
- 未进入真实项目 smoke。
- 未进入 Phase 18 / open-source release。
- 未提交 commit。
- 当前仍不是 Beta PASS / smoke-ready / open-source-ready。

## Source-Level Reality Check 摘要

### 现有实现

`packages/tui/src/index.ts` 中 Remote / MCP 相关职责包括：

- Remote 类型与状态：`RemoteState`、`RemoteChannelState`、`RemoteEvent`、approval message / decision 类型。
- Remote runtime：`createRemoteState()`、`refreshRemoteState()`、transport / binding / next-action 逻辑、event sending、approval processing。
- Remote presenter：`formatRemoteStatus()`、`formatRemoteDoctor()`、`formatRemoteSetup()`、`formatRemoteTestResult()`。
- MCP 类型与状态：`McpState`、`McpServerState`、`McpToolState`。
- MCP runtime / validation：server add/remove/enable/doctor、placeholder 生成、tool execution validation。
- MCP presenter：`formatMcpStatus()`、`formatMcpTools()`、`validateMcpServers()`。

### 本轮可安全搬出

- `formatRemoteStatus()`：只依赖 `RemoteState` 的 enabled/channels 字段和固定输出文案。
- `formatRemoteTestResult()`：只依赖单个 `RemoteChannelState` 与 `RemoteEvent`。
- `formatMcpTools()`：只依赖 `McpState.tools` 和固定 placeholder/schemaLoaded 边界文案。

这些内容不执行 remote/MCP runtime，不修改状态机，不调用 provider/model/tool/permission/evidence/index/job 逻辑。

### 本轮暂不搬出

- `formatMcpStatus()`：同时依赖 `context.mcp`、`context.index`、`redactedPath()`、`truncateDisplay()` 和 codebase-memory runtime summary，暂留 `index.ts`。
- Remote runtime/state helpers：`createRemoteState()`、`createRemoteChannelState()`、`refreshRemoteState()`、transport/binding/next-action helpers、event sending/approval processing，暂留 `index.ts`。
- MCP runtime/state helpers：`createMcpState()`、placeholder 生成、server add/remove/doctor、tool execution validation，暂留 `index.ts`。
- slash command router、model loop、permission pipeline、evidence、index runtime：不属于本轮。

### 最小 touch points

- `packages/tui/src/remote-mcp-presenter.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/remote-mcp-presenter.test.ts`
- `docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-2.md`

### 禁止重复实现的系统

本轮未新增第二套 Remote / MCP runtime、router、permission、evidence、index 或 job 系统；只移动低耦合 presenter helpers，继续复用原有 `/remote` 与 `/mcp` runtime 链路。

## 修改文件清单

- `packages/tui/src/remote-mcp-presenter.ts`：新增小模块，承载 Remote / MCP 纯 presenter helpers。
- `packages/tui/src/index.ts`：改为从 `remote-mcp-presenter.ts` 导入 presenter helpers，并删除本地重复 formatter。
- `packages/tui/src/remote-mcp-presenter.test.ts`：新增 focused unit tests 覆盖 Remote status、Remote test result、MCP tools placeholder/empty 输出。
- `docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-2.md`：新增本交付记录。

## 实际拆出的内容

`remote-mcp-presenter.ts` 当前包含：

- `formatRemoteStatus(remote)`
- `formatRemoteTestResult(channel, event)`
- `formatMcpTools(mcp)`

## 行为不变说明

- `/remote status` 输出文案保持不变，只把输入从 `TuiContext` 收窄为 `RemoteState`。
- `/remote test <channel>` 输出文案保持不变。
- `/mcp tools` 输出文案保持不变，只把输入从 `TuiContext` 收窄为 `McpState`。
- `webhook_mock` 仍明确标注为 diagnostic/test-only dry run，不代表真实 remote delivery PASS。
- MCP placeholder 仍明确标注为安全占位摘要；`schemaLoaded=yes` 仍只表示 discovery/doctor 成功后出现。
- 未改变 remote/MCP enable、doctor、setup、test、approval、validation、tool execution 逻辑。
- 未改变 provider/model/tool/permission/evidence/index/job/runtime 行为。
- 未改变四权限模式语义。
- 未做 TUI 美化、slash command router 拆分、model loop 拆分或 permission pipeline 拆分。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm exec vitest run packages/tui/src/remote-mcp-presenter.test.ts packages/tui/src/index.test.ts -t "remote channels\|Remote Channels\|MCP tools\|remote MCP presenters"` | PASS：2 files；6 passed，154 skipped |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm check` | PASS |
| `corepack pnpm build` | PASS |
| `git diff --check` | PASS |

## Focused tests 覆盖

`packages/tui/src/remote-mcp-presenter.test.ts` 覆盖：

- `/remote status` presenter 的 enabled/channel 行与 `webhook_mock` diagnostic/test-only 边界。
- `/remote test` presenter 的 sent 输出与“不代表真实外网回调服务器已接入”边界。
- `/mcp tools` presenter 的 placeholder/schemaLoaded/trusted/runtime 稳定摘要。
- MCP tools empty 状态输出。

## 未拆内容 / 后续候选

建议后续如继续拆分，仍需用户单独确认，并保持小步：

1. `formatRemoteDoctor()` / `formatRemoteSetup()` 可作为 Remote presenter 后续候选，但要确认是否继续只收窄输入、不移动 runtime。
2. `formatMcpStatus()` 暂不建议立即搬出，除非同时设计最小 redaction/truncate 输入边界，避免把 index runtime summary 搬成大 wrapper。
3. 继续不建议硬拆 remote/MCP runtime、slash router、model loop 或 permission pipeline。

## 参考核对

- 本轮实际读取/沿用的 Linghun 文档：`START_NEXT_CHAT.md`、`README.md`、`docs/delivery/phase-17-pre-smoke-index-ts-split-plan.md`、`docs/delivery/pre-smoke-p2-closure-hardening.md`、`docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-1.md`。
- 本轮实际读取的源码/测试：`packages/tui/src/index.ts`、`packages/tui/src/index.test.ts`、`packages/tui/src/index-runtime.ts`、`packages/tui/src/index-runtime.test.ts`。
- 本轮优先检查 codebase-memory 索引项目 `F-Linghun`：`index_status` 可用；目标符号定位最终以 `Grep`/精读源码确认。
- 未参考或复制 CCB / Claude Code / OpenCode / 第三方源码；本轮仅移动 Linghun 自研代码。

## 明确 NOT

- 不是 Beta PASS。
- 不是 smoke-ready。
- 不是 open-source-ready。
- 未进入真实 provider / 真实项目 smoke。
- 未进入 Phase 18 / open-source release。
- 未提交 commit。
- 未新增第二套 Remote / MCP runtime、router、permission、evidence、index 或 job 系统。

## Handoff Packet

```json
{
  "phase": "phase-17-pre-smoke-index-ts-modularization-batch-2",
  "date": "2026-05-23",
  "scope": "low-risk Remote / MCP presenter helpers split only",
  "indexProject": "F-Linghun",
  "changedFiles": [
    "packages/tui/src/remote-mcp-presenter.ts",
    "packages/tui/src/index.ts",
    "packages/tui/src/remote-mcp-presenter.test.ts",
    "docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-2.md"
  ],
  "movedOut": [
    "formatRemoteStatus",
    "formatRemoteTestResult",
    "formatMcpTools"
  ],
  "deferred": [
    "formatMcpStatus",
    "formatRemoteDoctor",
    "formatRemoteSetup",
    "remote runtime/state helpers",
    "MCP runtime/state helpers",
    "slash router",
    "model loop",
    "permission pipeline"
  ],
  "validation": [
    "focused vitest PASS",
    "typecheck PASS",
    "check PASS",
    "build PASS",
    "git diff --check PASS"
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
  "nextDecision": "User may choose whether to continue with another small modularization batch; default stop after Batch 2."
}
```
