# Phase 17 Pre-Smoke `packages/tui/src/index.ts` Split Plan

## 状态

- 本文件用于关闭 Pre-Smoke Closure A / P1-1：`packages/tui/src/index.ts` 维护风险。
- 本轮只提交最小可执行拆分计划；不做 `index.ts` 大拆，不进入真实项目 smoke，不宣布 Beta PASS / smoke-ready / open-source-ready。
- 当前策略：smoke 前只要求“计划 + 避免大改”；若真实 smoke 暴露必须改 `index.ts` 的问题，先做局部补丁，再按本计划选择最小拆分点。

## 当前风险

`packages/tui/src/index.ts` 仍是高集中度主链路文件，集中承载 slash command、model loop、permission pipeline、durable jobs、remote channels、native runner、MCP/index runtime、evidence/report/status 等职责。

主要风险：

- 真实 smoke 中如需定位或修复 TUI 主链路问题，单文件上下文过大，审查和回归成本高。
- 权限、工具、job、remote、runner 等高风险边界集中在同一文件，局部修改容易误碰无关链路。
- 若 smoke 前一次性做大重构，会引入比维护债更高的行为回归风险。

## 当前已拆模块清单

当前已存在并继续复用的拆分模块：

- `packages/tui/src/runtime-status-presenter.ts`：runtime 状态行 presenter；本轮仅补 cache/index 短摘要。
- `packages/tui/src/permission-presenter.ts`：权限提示展示层 helper；未移动 `decidePermission()` 主决策。
- `packages/tui/src/tool-output-presenter.ts`：工具输出 summary/details 分层展示。
- `packages/tui/src/terminal-readiness-presenter.ts`：doctor/status/problems 成品化展示。
- `packages/tui/src/natural-command-bridge.ts`：自然语言命令能力目录、intent routing 与 Start Gate 文案。
- `packages/tui/src/index-safety-repair.ts`：index safety blocker / repair continuation 辅助逻辑。
- `packages/tui/src/architecture-runtime.ts`：Architecture Runtime 轻量判断与卡片。
- `packages/tui/src/workspace-reference-cache.ts`：Workspace Reference Cache。
- `packages/tui/src/compact-context.ts`：Compact Lite boundary 与 compact helper。
- `packages/tui/src/index-runtime.ts`：index/codebase-memory 纯类型、`createIndexState()`、当前项目选择 helper。
- `packages/tui/src/remote-mcp-presenter.ts`：Remote / MCP 纯 presenter helper；未移动 Remote/MCP runtime、validation 或 tool execution。
- `packages/tui/src/job-runner-presenter.ts`：Native Runner / Durable Job / background task 纯 presenter / mapper helper；未移动 runner resolver/adapter/scheduler/process supervision、job state machine、resource guard 或 artifact slicing runtime。
- `packages/tui/src/request-lifecycle-presenter.ts`：模型请求生命周期、空响应、失败与报告 evidence requirement 展示。

## 仍内联模块清单

smoke 前不主动大拆的高耦合内联职责：

- slash router：`handleSlashCommand()` 及大量 slash subcommand dispatch / 参数解析 / 本地控制面分支。
- model loop：`sendMessage()` 附近 provider stream、tool_use/tool_result continuation、abort、empty response invariant、usage/cache/evidence 写入。
- permission pipeline：`decidePermission()`、permission rule matching、hard deny、四权限模式、legacy alias 边界与 pending approval 续接。
- durable jobs：job state machine、artifact registry、heartbeat/stale/blocked/cancel/timeout 生命周期。
- native runner：runner resolver、adapter、protocol check、process supervision、fallback 与 evidence/report 集成。
- remote channels：remote channel validation、message id/nonce/expiry、approval/report/handoff 集成。
- MCP/index runtime：MCP server validation/enabled state、index status/search/architecture/init/refresh runtime、codebase-memory CLI/MCP boundary。

## 建议拆分顺序（低风险优先）

| 顺序 | 拆分项 | 最小范围 | 主要风险 | 验证命令 | 停止点 |
| --- | --- | --- | --- | --- | --- |
| 1 | Pure presenter / formatter | 只抽无副作用 formatter：status/help/details/report 的纯字符串或 view mapper；不移动状态写入、不改命令语义 | 低；主要风险是文案、截断、脱敏回归 | `corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/runtime-status-presenter.test.ts packages/tui/src/job-runner-presenter.test.ts`；`corepack pnpm typecheck` | 任一主屏 raw evidence/debug 泄露、中文/英文断言失败、截断边界变化即停 |
| 2 | Command parser / dispatcher helpers | 从 slash router 中抽纯 parser、参数 normalizer、只读 command view helper；保留 `handleSlashCommand()` 入口和执行分支 | 中；命令覆盖面广，易误改 help/doctor/status/index 本地控制面 | `corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts`；`corepack pnpm check` | 任一 Start Gate、只读查询、本地控制面或 alias 行为变化即停 |
| 3 | Job / runner presenters or guards | 继续只抽 job/runner 展示、redaction、guard message；不抽 scheduler、adapter、process lifecycle | 中；Phase 17B/17C 边界敏感，不能让 cancelled/timeout/stale 变成 PASS evidence | `corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/job-runner-presenter.test.ts packages/tui/src/log-artifact.test.ts`；`corepack pnpm typecheck` | runner protocol/fallback、resource guard、artifact path guard、PASS evidence 语义变化即停 |
| 4 | Runtime state helpers | 抽小型 state selector / snapshot builder，例如 status view、handoff packet readonly mapper；不移动 mutation 和 side effect | 中高；可能误碰 session/cache/index/background/evidence 同步 | `corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/config/src/index.test.ts`；`corepack pnpm typecheck`；`corepack pnpm build` | 出现状态不同步、handoff 缺字段、cache/index/status 口径变化即停 |
| 5 | Model loop / permission pipeline 最后 | 仅在 smoke 稳定且有明确必要时再拆；先抽纯 formatter，再考虑边界函数；不得改变 tool_use/tool_result、permission、Plan approval、PASS evidence 语义 | 高；provider/tool loop/permission/abort/evidence/cache 耦合深 | `corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/providers/src/index.test.ts packages/tools/src/index.test.ts`；`corepack pnpm typecheck`；`corepack pnpm check`；`corepack pnpm build` | 任一 provider stream、tool_result second request、四权限模式、Start Gate、Plan approval、PASS evidence 语义变化即停 |

## Smoke 前裁决

- P1-1 当前裁决：**DONE for plan / DEFERRED for large refactor**。
- smoke 前只要求本计划与避免大改；不强行全拆 `index.ts`。
- 本轮没有在 `packages/tui/src/index.ts` 做大规模代码移动；只允许与 P1-3 状态行相关的 presenter 小改。
- 若真实 smoke 期间必须修改 `index.ts`，优先做局部补丁；只有“不拆分就无法安全修复”时，才按上表从低风险项开始单独确认。

## 禁止事项

- 不新增第二套路由、provider、tool、permission、evidence、job、runner、MCP、index、memory、agent 系统。
- 不改变四权限模式、Start Gate、permission pipeline、Plan approval、PASS evidence 语义。
- 不复制 CCB / OpenCode / Warp / 第三方源码。
- 不把 focused/local/mock PASS 推断为 Beta PASS、smoke-ready 或 open-source-ready。

## Batch 1-3 Combined Closure（历史）

- Batch 1：`packages/tui/src/index-runtime.ts` 承载 index/codebase-memory 纯类型、`createIndexState()`、当前项目选择 helper；未硬编码 `F-Linghun`，`/index status` 默认 fast path 仍不运行 `detect_changes`。
- Batch 2：`packages/tui/src/remote-mcp-presenter.ts` 承载 Remote / MCP 纯 presenter helper；未移动 Remote/MCP runtime、validation 或 tool execution。
- Batch 3：`packages/tui/src/job-runner-presenter.ts` 承载 Native Runner / Durable Job / background task 纯 presenter / mapper helper；未移动 runner resolver/adapter/scheduler/process supervision、job state machine、resource guard 或 artifact slicing runtime。
- Batch 4 暂停，默认不继续。
