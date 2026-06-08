# Closure Phase 1 - Trust Boundary Closure

## 阶段目标

按 `LINGHUN_CLOSURE_PHASED_TASKS.md` Phase 1 收口信任与安全边界 P0。范围只覆盖 checkpoint/rewind、取消语义、auto-review 写入边界、index runtime 内部守卫、恢复/损坏诊断可见性；不进入 Phase 2 Task surface，也不声明全局成熟。

## 已完成功能

- `/rewind` checkpoint：
  - 工具写入前创建的 snapshot checkpoint 现在把可恢复 payload 写入 `checkpoint_created` transcript 事件。
  - `hydrateResumeContext()` 会从 transcript 恢复可还原 checkpoint；旧 metadata-only checkpoint 会显示不可还原原因。
  - `/rewind` 列表显示 `可还原 / 恢复后不可还原`。
  - `/rewind restore` 拒绝恢复其他 session 的 checkpoint。
  - 多文件 restore 权限检查改为覆盖全部 `changedFiles`，不再只检查第一个文件。
  - `/checkpoint create` / git stable 的广义 dirty tree safety pad 不把大范围文件内容持久化进 transcript，resume 后明确标为不可还原，避免扩大敏感内容持久化面。
- 取消/中断语义：
  - `/interrupt` 主屏汇总区分 `已发送取消信号`、`已标记 stale`、`已确认退出 0`。
  - transcript interrupt 事件写入 `abort_signal_sent` / `marked_stale` / `confirmed_exited=0`，不把 abort 或 stale 误写成已真实退出。
- `auto-review` 写入边界：
  - `isLowRiskWorkspaceEdit()` 只允许 `risk === "low"` 的工作区编辑轻路径。
  - `Write` / `MultiEdit` 的 `medium` 风险不再被误归类为普通低风险自动放行。
  - auto-review 仍保留 `Edit` low-risk 轻路径、只读工具和 session 工具轻路径。
- `/index init/refresh` 权限/资源门：
  - `runIndexRepository()` 内部增加 resource/concurrency guard。
  - slash route 和结构化 IndexRefresh 已检查过 guard 的路径显式传入 `guardAlreadyChecked`，避免重复提示。
  - 直接调用 runtime 时仍会被 resource cap 拦住，并明确这是 resource/concurrency cap，不是权限拒绝。
- 恢复/损坏状态可见性：
  - 复核现有 `SessionStore.readMetadata()` 损坏诊断：metadata parse/read 失败会写入 `session_metadata_read_failed` system event。
  - 复核现有 JSONL diagnostics：坏行会进入 diagnostics，不静默等同于不存在。

## 使用方式

- 查看 checkpoint：`/rewind`
- 恢复 checkpoint：`/rewind restore <checkpointId>`
- 中断当前活动任务：`/interrupt`
- 查看索引状态：`/index status`
- 建立或刷新索引：`/index init fast` / `/index refresh`
- auto-review 下低风险编辑仍可轻路径；`Write` / `MultiEdit` medium 风险会要求确认。

## 涉及模块

- `packages/core/src/session.ts`
- `packages/tui/src/background-control-runtime.ts`
- `packages/tui/src/git-tool-dispatch-runtime.ts`
- `packages/tui/src/handoff-session-runtime.ts`
- `packages/tui/src/mcp-index-runtime.ts`
- `packages/tui/src/model-tool-runtime.ts`
- `packages/tui/src/permission-continuation-runtime.ts`
- `packages/tui/src/slash-command-runtime.ts`
- `packages/tui/src/tui-data-types.ts`

## 关键设计

- checkpoint 可恢复性分为两类：
  - 已授权工具写入前的精确文件 snapshot：可持久化并可 resume restore。
  - git stable / `/checkpoint create` 的广义 dirty tree snapshot：只作为当前进程 safety pad，不把广义 dirty content 写入 transcript，resume 后明确不可还原。
- `/interrupt` 不生成虚假的进程退出确认。当前 runtime 只能确定 abort signal sent 或 marked stale，因此 `confirmed_exited=0` 是保守、真实的用户状态。
- index guard 下沉到 runtime 内部，不依赖 slash route 单点拦截。
- auto-review 的轻路径以工具风险等级为边界，medium 风险必须回到确认。

## 配置项

本阶段没有新增配置项、环境变量、依赖或构建脚本。

## 命令

- `corepack pnpm --filter @linghun/core build`
- `corepack pnpm --filter @linghun/tui exec tsc --noEmit`
- `corepack pnpm --filter @linghun/tui exec vitest run src/permission-continuation-runtime.test.ts src/tui-permission-runtime.test.ts src/mcp-index-runtime.test.ts src/index.test.ts -t "isLowRiskWorkspaceEdit|collectInputFiles|auto-review asks for medium risk|checkpoints and restores|hydrates restorable checkpoint|checks all changed files|blocks rewind restore|runIndexRepository enforces resource guard|interrupt sends AbortSignal|explicit best-effort wording"`
- `corepack pnpm --filter @linghun/core exec vitest run src/jsonl.test.ts src/session-store.test.ts -t "broken lines|metadata cannot be parsed|resumes metadata"`

## 测试与验证

- TUI typecheck：PASS。
- TUI focused tests：4 files PASS，18 tests PASS。
- Core JSONL/session diagnostics focused tests：2 files PASS，3 tests PASS。

## 性能结果

- 未新增模型调用。
- 未新增后台常驻任务。
- checkpoint payload 仅对明确工具写入目标持久化；广义 git stable dirty snapshot 不持久化内容，避免 transcript 膨胀和敏感扩散。

## 已知问题

- `/interrupt` 当前不具备跨所有 runner 的真实 process-exit 确认信号，所以保守显示 `confirmed_exited=0`。这不是降级，而是避免把 abort/stale 误导成已退出。
- Durable job state 损坏本轮只复核既有恢复/非 PASS 边界，没有新造第二套 job recovery runtime。

## 不在本阶段处理的内容

- 不做 Phase 2 Task surface 默认面板改造。
- 不做 workflow/job/agent runtime 统一状态大重构。
- 不做大文件拆分。
- 不新增第二套 checkpoint、index、runner 或 workflow 系统。

## 下一阶段衔接

下一阶段是 Closure Phase 2 - Task Surface Closure。进入前应先确认本阶段 diff 和验证结果；Phase 1 PASS 不代表 Task surface、agent/job/workflow、daily path 或 hardcoded policy 已全局成熟。

## 开发者排查入口

- checkpoint 创建：`packages/tui/src/model-tool-runtime.ts`
- checkpoint hydrate：`packages/tui/src/handoff-session-runtime.ts`
- rewind restore：`packages/tui/src/slash-command-runtime.ts`
- auto-review 判定：`packages/tui/src/permission-continuation-runtime.ts`、`packages/tui/src/tui-permission-runtime.ts`
- index runtime：`packages/tui/src/mcp-index-runtime.ts`
- interrupt：`packages/tui/src/background-control-runtime.ts`
- session diagnostics：`packages/core/src/session-store.ts`、`packages/core/src/jsonl.ts`

## 参考核对

- 实际读取 Linghun 文档：
  - `LINGHUN_CLOSURE_PHASED_TASKS.md`
  - `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
  - `LINGHUN_IMPLEMENTATION_SPEC.md`
  - `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
  - `docs/delivery/README.md`
- 实际参考源码：
  - 当前 Linghun checkpoint、permission、index、interrupt、session/jsonl 源码与 focused tests。
- CCB / CCB Dev Boost / 社区参考：
  - 本阶段只按既有 Linghun 文档中的 CCB 行为边界做语义对齐：checkpoint/rewind、abort/stale、auto-review、index guard、diagnostics。
  - 未复制 CCB 或任何可疑源码实现。

## Handoff Packet

- verdict: PASS
- nextPhase: Closure Phase 2 - Task Surface Closure
- mustNotDo:
  - 不把 Phase 1 PASS 当作全局成熟。
  - 不跳到 Phase 3+。
  - 不拆大文件。
  - 不新增第二套 runner/workflow/index/checkpoint 系统。
- evidenceRefs:
  - `packages/tui/src/index.test.ts`
  - `packages/tui/src/permission-continuation-runtime.test.ts`
  - `packages/tui/src/tui-permission-runtime.test.ts`
  - `packages/tui/src/mcp-index-runtime.test.ts`
  - `packages/core/src/jsonl.test.ts`
  - `packages/core/src/session-store.test.ts`
- validation:
  - `@linghun/tui tsc --noEmit`: PASS
  - `@linghun/tui focused vitest`: PASS
  - `@linghun/core focused vitest`: PASS
- indexStatus: codebase-memory MCP tool unavailable in this Codex thread; used `rg` and source-level reads instead.
- permissionMode: local development, direct file edits in workspace.
- provider/model: Codex coding agent in local workspace; no product provider route changed.
- budgetUsed: no explicit token budget; no runtime cost changes.
