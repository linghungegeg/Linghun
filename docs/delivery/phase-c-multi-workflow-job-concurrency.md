# 阶段 C：多 workflow / 多 job 真并发闭合

## 阶段目标

把“没有固定 3/4/20 上限”继续闭合为“可同时多开，且状态、调度、可见性不互相打架”。本阶段只处理多 active workflow、background durable fallback、durable job effective cap 语义，不进入真实 full smoke、Beta PASS、Phase 18 或新调度系统。

## 已完成功能

- Workflow 状态从单 `activeRun` 扩展为 `activeRuns[]`，`activeRun` 保留为兼容选中别名。
- `/workflows status` 展示所有 active/durable workflow run，不再只呈现最后一次启动的 run。
- Workflow hydrate 会把所有 persisted workflow run 恢复到 `activeRuns[]`，再确定性选择一个兼容 `activeRun`。
- Workflow start / progress / finish / registry workflow gate 按 runId 更新对应 run，不再依赖全局选中 run。
- `/interrupt` 会取消所有 running workflow run，并保持 sibling runs 可见。
- `/details background <id>` 和 `/details output <id>` 增加 durable-first fallback：内存 50 条投影找不到时，先 hydrate workflow，再查 durable job。
- Durable job effective cap 改为只按该 job 自己的 running agents 动态裁剪；无关 `/fork` agent 不再静默消耗 job cap。
- `/job status` / `/job report` budget 行明确 cap scope：durable job agents only；不显示默认 3/4/20 用户上限。

## 使用方式

- 查看多 workflow：`/workflows status`
- 查看后台投影：`/background`
- 查看 durable background：`/details background <workflowId|jobId>`
- 查看 durable job cap：`/job status <jobId>` 或 `/job report <jobId>`
- 中断运行中工作：`/interrupt`

## 涉及模块

- `packages/tui/src/tui-data-types.ts`
- `packages/tui/src/workflow-command-runtime.ts`
- `packages/tui/src/background-control-runtime.ts`
- `packages/tui/src/details-status-runtime.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/job-runtime.ts`
- `packages/tui/src/index.test.ts`

## 关键设计

- 不新增第二套 workflow scheduler、background registry 或 concurrency runtime。
- `activeRuns[]` 是真实多 run 内存状态；`activeRun` 只是旧调用链兼容别名。
- Durable workflow/job state 继续复用现有本地持久化路径。
- `MAX_BACKGROUND_TASKS = 50` 保持为内存投影上限；用户可见查找通过 durable fallback 补齐，不靠把 50 改大。
- Workflow 内部 `runningCap` 仍只约束 phase/slice batch，不代表固定用户数量上限。
- Job effective cap 只反映 durable job 自己的 agent 运行态，不再被无关普通 `/fork` agent 扣减。

## 配置项

本阶段未新增配置项，未修改依赖、provider、模型路由、权限模式或构建配置。

## 命令

- `/workflows status`
- `/background`
- `/details background <id>`
- `/details output <id>`
- `/job status <id>`
- `/job report <id>`
- `/interrupt`

## 测试与验证

已运行并通过：

- `corepack pnpm vitest run packages/tui/src/index.test.ts` — PASS，686/686。
- `corepack pnpm vitest run packages/tui/src/workflow-planner-entry.test.ts` — PASS，45/45。
- `corepack pnpm vitest run packages/tui/src/shell/view-model.test.ts` — PASS，345/345。
- `corepack pnpm vitest run packages/tui/src/phase-e-mainchain-coverage.test.ts` — PASS，7/7。
- `corepack pnpm --filter @linghun/tui typecheck` — PASS。
- `corepack pnpm --filter @linghun/tui build` — PASS。

新增专项覆盖：

- 多 workflow run 在 `/workflows status` 同时可见，不覆盖成单 activeRun。
- `/interrupt` 同时取消多个 running workflow，且不丢 sibling runs。
- background 内存 50 条投影找不到旧 job 时，`/details background <id>` 仍可从 durable job 找到。
- 无关 `/fork` agent 不消耗 durable job effective cap，capReason/status/report 可解释。

## 性能结果

本阶段未引入轮询、常驻进程或新增后台 worker。新增 durable fallback 只在显式 `/details background|output <id>` 查找失败时触发一次 hydrate/query，不改变普通主链渲染路径。

## 已知问题

- 本阶段没有实现跨进程继续执行已中断的旧 workflow；只保证 durable state 可见、可诊断、可重跑前检查。
- `activeRun` 兼容别名仍存在，后续旧调用链可以继续渐进迁移到 `activeRuns[]`，但用户可见状态已不再是假单 run。

## 不在本阶段处理的内容

- 不新增固定人数 cap。
- 不新增第二套 scheduler/background/concurrency 系统。
- 不调整 provider/model/env/权限配置。
- 不进入 Phase 18、remote channel、真实 full smoke、Beta PASS 或 open-source-ready 判定。
- 不读取或声称对齐 CCB 源码；本轮未实际读取 `F:\ccb-source` 文件。

## 下一阶段衔接

可在用户确认后进入下一阶段，建议继续围绕真实交互压力测试或旧调用链 `activeRun` 迁移做小范围闭合。进入下一阶段前应重新做 Source-Level Reality Check。

## 开发者排查入口

- Workflow 状态与持久化：`packages/tui/src/workflow-command-runtime.ts`
- Workflow 类型：`packages/tui/src/tui-data-types.ts`
- Interrupt：`packages/tui/src/background-control-runtime.ts`
- Durable fallback：`packages/tui/src/details-status-runtime.ts`
- Job cap：`packages/tui/src/job-agent-command-runtime.ts`、`packages/tui/src/job-runtime.ts`
- 回归测试：`packages/tui/src/index.test.ts`

## 参考核对

本阶段实际读取：

- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- 相关源码文件与测试文件。

本阶段未读取 `F:\ccb-source`，因此不声称 CCB 源码级对齐；没有复制可疑源码实现。

## 成品级结构化 handoff packet

- verdict：PASS。
- scope：仅阶段 C 多 workflow / background durable fallback / durable job cap 语义闭合。
- changed files：代码 6 个、测试 1 个、文档 1 个。
- validation：上述 6 条命令全部 PASS。
- risk：P1 行为变更为 durable job 不再被无关 `/fork` agent 静默扣减；已有专项测试覆盖。
- index status：未触发外部 codebase-memory 重建；本轮以源码精读和测试验证为准。
- permission mode：Auto Mode Active，本地文件编辑与本地验证命令。
- model/provider：Claude Code，Opus 4.6 (1M context)。
- budget：未使用外部预算统计；无新增成本路径。
- evidence refs：本文件测试与验证命令记录；完整长输出见本会话 tool result artifact。
- next action：用户审核 diff 后，可决定是否提交阶段 C 稳定点。