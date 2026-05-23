# Phase 17 Pre-Smoke `packages/tui/src/index.ts` Split Plan

## 状态

- 本文件用于关闭 Pre-Smoke P1-1 / P2-6 的拆分计划要求，并记录 Pre-Smoke `index.ts` modularization Batch 1-3 combined closure。
- Batch 1-3 已按小步、低风险、行为保持方式完成并通过 combined regression gate。
- Batch 4 暂停；本轮不继续拆分、不进入 TUI polish、不进入真实 provider / 真实项目 smoke。
- 当前不宣布 Beta PASS / smoke-ready / open-source-ready。

## 当前风险

`packages/tui/src/index.ts` 已超过 15k 行，集中承载 slash command、model loop、permission pipeline、durable jobs、remote channels、native runner、MCP/index runtime、evidence/report/status 等职责。

主要风险：

- 真实 smoke 中如需定位或修复 TUI 主链路问题，单文件上下文过大，审查和回归成本高。
- 权限、工具、job、remote、runner 等高风险边界集中在同一文件，局部修改容易误碰无关链路。
- 后续拆分若一次性做大重构，会在真实 smoke 前引入比维护债更高的行为风险。

## 拆分原则

- 行为保持，不改变公共接口、权限语义、provider/tool/job/evidence 语义。
- 先抽稳定职责，后抽状态耦合深的主循环。
- 每次拆分保持小 diff，优先补 focused test 或复跑现有覆盖。
- 不新增第二套 provider/tool/permission/evidence/MCP/index/agent/job/runtime。
- 不在本轮真实 smoke 前做大重构；若 smoke 暴露必须改 `index.ts` 的问题，先做局部补丁，再评估是否执行对应拆分。

## 首批低风险候选

| 候选 | 建议优先级 | 范围 | 风险 | 验证命令 | 是否建议 smoke 前实现 |
| --- | --- | --- | --- | --- | --- |
| Permission pipeline | P1 | 将 `decidePermission`、权限提示格式化、legacy alias 边界附近的纯函数/类型抽到独立模块；保留调用入口不变 | 高风险语义敏感；必须确保 default/auto-review/plan/full-access、hard deny、Start Gate 不变 | `corepack pnpm test -- --run packages/tui/src/index.test.ts`；`corepack pnpm typecheck`；`corepack pnpm check` | 不建议在本轮 smoke 前主动实现；若真实 smoke 前必须修权限问题，再以最小行为保持拆分执行 |
| Slash command router | P2 | 将 slash command dispatch 表、help/doctor/status 路由辅助函数中稳定分支抽出；`handleSlashCommand` 对外行为不变 | 中等；命令覆盖面广，容易改动 help 文案或本地控制面路径 | `corepack pnpm test -- --run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts`；`corepack pnpm typecheck` | 可作为 smoke 后第一批拆分；smoke 前仅在必须修 slash 路由问题时做局部拆分 |
| Model loop | P3 | 将模型请求循环的纯 formatter、tool result continuation 辅助逻辑逐步抽出；不改变 stream/tool_use/tool_result 协议 | 高；provider、tool loop、abort、evidence、compact/cache 均耦合，不适合临近 smoke 大拆 | `corepack pnpm test -- --run packages/tui/src/index.test.ts packages/providers/src/index.test.ts packages/tools/src/index.test.ts`；`corepack pnpm typecheck`；`corepack pnpm build` | 不建议 smoke 前实现；只记录计划 |
| Runner/remote helpers | P2 | 将 runner doctor/report formatter 或 remote summary redaction 等稳定 helper 抽出；不拆 job/remote 状态机本体 | 中等；Phase 17B/17C 刚完成，需避免破坏 focused/local validation | `corepack pnpm test -- --run packages/tui/src/index.test.ts packages/config/src/index.test.ts`；`corepack pnpm typecheck` | 不建议本轮实现；可在真实 smoke 后按暴露问题选择 |

## 建议顺序

1. Smoke 前：只保留本计划，不做大拆代码。
2. 若真实 smoke 暴露权限相关缺陷：优先局部修复 permission pipeline，必要时按行为保持方式抽出最小模块。
3. Smoke 后第一批维护性拆分：slash command router 或 runner/remote formatter，选择风险最低且测试覆盖最清晰的一项。
4. Model loop 只在真实 smoke 结果稳定、provider/tool loop 无阻塞缺陷后再拆。

## 本轮裁决

- P1-1：已关闭“无计划 DEFERRED”问题；当前有首批候选、风险、验证命令和 smoke 前实现建议。
- P2-6：并入本计划；剩余 `index.ts` 拆分属于 smoke 后维护性任务或 smoke 暴露问题后的定向拆分。
- P2 closure linkage：本轮 Pre-Smoke P2 Closure Hardening 只允许小修和文档澄清；除 Index Project Identity Reconciliation Lite 这一处定向小修外，不做 slash/router/model loop/permission/remote/job/MCP 的大拆代码。
- 本轮不做大重构，避免真实 provider + 真实项目 smoke 前引入新风险。

## Batch 1-3 Combined Closure（2026-05-23）

### 已完成的小步拆分

- Batch 1：`packages/tui/src/index-runtime.ts` 承载 index/codebase-memory 纯类型、`createIndexState()`、当前项目选择 helper；未硬编码 `F-Linghun`，`/index status` 默认 fast path 仍不运行 `detect_changes`。
- Batch 2：`packages/tui/src/remote-mcp-presenter.ts` 承载 Remote / MCP 纯 presenter helper；未移动 Remote/MCP runtime、validation 或 tool execution。
- Batch 3：`packages/tui/src/job-runner-presenter.ts` 承载 Native Runner / Durable Job / background task 纯 presenter / mapper helper；未移动 runner resolver/adapter/scheduler/process supervision、job state machine、resource guard 或 artifact slicing runtime。

### 暂停项 / 不在 smoke 前继续拆分

- Batch 4 暂停，默认不继续。
- smoke 前不拆 model loop、slash command router、permission pipeline、Native Runner adapter/scheduler/process supervision、durable job state machine、resource guard、artifact registry slicing、index query/runtime heavy path。
- 若后续真实 smoke 暴露必须修复的问题，先做局部补丁；只有在不拆分无法安全修复时，才按最小行为保持方式单独确认拆分。

### Combined gate 口径

- Batch 1-3 combined closure 只证明本地 focused regression / typecheck / check / build 通过，不代表真实 provider smoke、真实项目 smoke、Beta PASS、smoke-ready 或 open-source-ready。
- 交付记录见 `docs/delivery/phase-17-pre-smoke-index-ts-modularization-batch-1-3-closure.md`。
