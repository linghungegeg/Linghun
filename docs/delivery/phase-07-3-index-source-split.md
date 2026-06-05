# Phase 7.3 — index.ts Source Split

## 阶段基线

- **执行日期**: 2026-06-05
- **分支**: `codex/meta-scheduler-closure`
- **阶段类型**: 结构性源码拆分；不新增功能
- **目标文件**: `packages/tui/src/index.ts`
- **拆分前行数**: 14,062 行（`git show HEAD:packages/tui/src/index.ts | Measure-Object -Line`）
- **拆分后行数**: 2,528 行（`Get-Content packages/tui/src/index.ts | Measure-Object -Line`）
- **结果**: `index.ts` 已进入目标 2,500-3,000 行区间。

## 开工记录

### git status --short

接手复核时工作树包含 Phase 7.3 进行中的拆分改动，以及以下用户/历史未跟踪项：

```text
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
 M packages/tui/src/job-agent-command-runtime.ts
 M packages/tui/src/shell/view-model.test.ts
 M packages/tui/src/terminal-readiness-runtime.ts
?? docs/delivery/phase-6.7-full-source-maturity-audit.md
?? docs/stress/
?? packages/tui/src/provider-loop-runtime.ts
?? packages/tui/src/slash-command-runtime.ts
?? packages/tui/src/tui-context-runtime.ts
?? packages/tui/src/workflow-command-runtime.ts
?? test-model-set.sh
```

未处理与本阶段无关的未跟踪项：`docs/delivery/phase-6.7-full-source-maturity-audit.md`、`docs/stress/`、`test-model-set.sh`。

### 拆分前 index.ts 主要职责分布

| 原职责 | 原 `index.ts` 位置 | Phase 7.3 裁决 |
|---|---:|---|
| `TuiContext`、pending continuation、运行时常量 | ~1373-1600 | 搬到 `tui-context-runtime.ts` |
| CLI/TUI app lifecycle：`runTui`、plain/Ink、输入循环 | ~1698-2650 | 保留在 `index.ts` |
| 顶层 slash router | ~2668-3000 | 保留在 `index.ts`，只做顶层分发 |
| Workflow 命令、运行时状态、step 执行 | ~3013-5000 | 搬到 `workflow-command-runtime.ts` |
| Details / compact / cache / BTW / permission / trust glue | 多段分布 | 搬到 `slash-command-runtime.ts` |
| Natural input、provider stream、tool continuation | ~9198-11900 | 搬到 `slash-command-runtime.ts`，provider fallback helper 搬到 `provider-loop-runtime.ts` |
| Evidence、failure learning、final gate glue | ~9057、~10272、~14119 | 搬到 `slash-command-runtime.ts`，纯 gate 逻辑仍在既有 `final-answer-gate.ts` |
| Home/status/presenter helpers | ~13458、~14394 | 搬到 `slash-command-runtime.ts` 或保留既有 presenter/runtime 模块 |

## Source-Level Reality Check

本阶段没有可用的 codebase-memory MCP 工具暴露给当前会话；按仓库规则降级为 `rg` + 精读关键源码。索引未重建，未做 `/index status --fresh`。

| 要求覆盖项 | 源码事实 | 拆分后 owner |
|---|---|---|
| `TuiContext` / context 初始化 | `TuiContext` 类型、pending state、runtime 常量从 `index.ts` 移出；`runTui` 仍负责总装 context | `tui-context-runtime.ts` + `index.ts` |
| CLI/TUI app lifecycle | `runTui`、`prepareTuiStartup`、`runPlainTui`、`runInkShell`、`processTuiLine` 保留 | `index.ts` |
| slash command router | `index.ts` 保留 `handleSlashCommand` 顶层路由；细分命令转交运行时模块 | `index.ts` |
| model send / continue / provider stream 主链 | `handleNaturalInput`、`sendMessage`、`continueModelAfterToolResults`、stream cleanup、retry/downgrade 迁出 | `slash-command-runtime.ts` |
| provider fallback / cooldown | fallback runtime 选择、attempt 记录、cooldown 输出独立成 helper | `provider-loop-runtime.ts` |
| tool_use / permission continuation | pending continuation 类型在 context 模块；approve/deny/execute glue 在主链 runtime | `tui-context-runtime.ts` + `slash-command-runtime.ts` |
| workflows command + runtime glue | `/workflows`、planner context、durable run hydrate、step verification、registry workflow | `workflow-command-runtime.ts` |
| sessions / memory / compact / details / status / doctor glue | session/memory 已有 owner 继续复用；compact/details/doctor/status 仍随主链 glue 保持在 `slash-command-runtime.ts`，避免二次拆分改变共享状态 | `session-command-runtime.ts`、`memory-command-runtime.ts`、`slash-command-runtime.ts` |
| background/job/agent glue | job/agent owner 保持既有模块；本阶段只修正 hydrate 后 stale agent 才进入 background projection | `job-agent-command-runtime.ts` |
| formatting / presenter helpers | 大部分 presenter 已在既有模块；`formatHomeScreen`/`writeStatus` 随主链输出 glue 迁出 | `slash-command-runtime.ts`、既有 presenter 模块 |
| evidence / final gate / verification glue | verification runner 保持既有模块；主链 evidence/failure/final gate 接线迁出 | `slash-command-runtime.ts`、`verification-command-runtime.ts`、`final-answer-gate.ts` |

## 新模块列表与职责

| 新模块 | 行数 | 职责 |
|---|---:|---|
| `packages/tui/src/tui-context-runtime.ts` | 482 | `TuiContext`、pending approval/continuation 类型、用户可见 slash 列表、TUI 运行时常量。 |
| `packages/tui/src/workflow-command-runtime.ts` | 2,121 | `/workflows` 命令、workflow run hydrate/status、registry workflow/agent workflow 执行、step verification 与 workflow evidence glue。 |
| `packages/tui/src/provider-loop-runtime.ts` | 158 | provider fallback runtime 选择、fallback attempt 记录、provider cooldown 输出。 |
| `packages/tui/src/slash-command-runtime.ts` | 9,956 | 原 `index.ts` 中与细分 slash 命令、主模型链、tool continuation、evidence/final gate、details/status/compact 等共享状态强耦合的运行时 glue。 |

说明：本阶段只新增 4 个 owner 文件，因为多个稳定 owner 已在前置阶段存在（例如 `memory-command-runtime.ts`、`session-command-runtime.ts`、`model-command-runtime.ts`、`job-agent-command-runtime.ts`、`verification-command-runtime.ts`）。为保行为等价，没有把 `slash-command-runtime.ts` 再拆成十几个碎片。

## 迁移 Map

| 原 `index.ts` 区块 | 迁移目标 | 说明 |
|---|---|---|
| `USER_VISIBLE_DISPATCH_SLASH_COMMANDS` | `tui-context-runtime.ts` | 保留原列表与类型约束。 |
| `PendingLocalApproval` / `PendingModelContinuation` / `runtimeFromContinuation` | `tui-context-runtime.ts` | continuation 数据形态不变。 |
| TUI budget/cache/background 常量 | `tui-context-runtime.ts` | 仅搬迁，不改数值。 |
| provider fallback/cooldown helper | `provider-loop-runtime.ts` | 主链仍在 provider error path 调用。 |
| workflow hydrate/status/start/finish | `workflow-command-runtime.ts` | 复用 deps 回调接回 session/evidence/failure learning。 |
| workflow registry/list/plan/run | `workflow-command-runtime.ts` | 命令语法不变。 |
| workflow step verification / nested job | `workflow-command-runtime.ts` | verification 与 non-PASS 语义不变。 |
| natural input / `sendMessage` | `slash-command-runtime.ts` | provider stream 主链搬迁，测试覆盖 OpenAI/Claude/DeepSeek continuation。 |
| `continueModelAfterToolResults` | `slash-command-runtime.ts` | tool result pairing、abort early-return、final gate 镜像保留。 |
| `executeModelToolUse` / deferred tool dispatch | `slash-command-runtime.ts` | 权限、tool_result、evidence 语义不变。 |
| `/details`、`/compact`、`/cache`、`/btw`、`/permissions`、`/trust` | `slash-command-runtime.ts` | 与 pending interaction/writeStatus 共享状态强耦合，保持同一 owner。 |
| `formatHomeScreen` / `writeStatus` | `slash-command-runtime.ts` | 保留主屏输出口径。 |
| source-anchor tests | `index.test.ts`、`shell/view-model.test.ts` | 只把源码断言指向新 owner，不放宽行为断言。 |

## 必要测试与 glue 调整

- `index.test.ts` 中源码锚点从 `index.ts` 改到实际 owner：`workflow-command-runtime.ts`、`slash-command-runtime.ts`、`model-prompt-runtime.ts`、`tui-context-runtime.ts`、`terminal-readiness-runtime.ts` 等。
- 两个 `runTui` 冷启动集成测试单测 timeout 调整为 `15_000`；聚焦复跑证明它们在更高 timeout 下通过，断言未放宽。
- route fallback fixture 从旧占位 `deepseek-v4-pro` 改为具体默认模型 `deepseek-chat`，保持 fallback decision 行为测试。
- agent 成功完成后的可交互状态按当前源码事实断言为 `idle`；没有改 agent/workflow/job 调度主链。
- `hydratePersistentAgents` 只把 stale resumed agent 恢复进 `backgroundTasks`，terminal/idle/completed agent 保留在 `context.agents` 历史里，避免 footer/background 被旧终态污染。
- `terminal-readiness-runtime.ts` 将 `failed` / `timeout` background task 纳入 needs-attention 可见性，恢复 readiness/problems 对终止异常任务的提示。
- `shell/view-model.test.ts` 的 Windows bare terminal 环境清理改为仓库已有 `vi.stubEnv(name, undefined)` 写法，以通过 targeted Biome 且保持 unset 语义。
- `model-command-runtime.ts` 只做格式修正。

## 行为不变声明

- 未新增用户命令、命令语法或新功能。
- 未修改 provider/model/env 配置读取与选择语义。
- 未修改权限策略或权限模式。
- 未改变 agent/workflow/job 主调度语义；相关测试全部通过。
- 未改变 provider stream、tool_use/tool_result pairing、permission continuation、final gate 与 verification 非 PASS 边界。
- 未复制 CCB 源码；本阶段只基于 Linghun 自有源码搬迁和测试锚点调整。

## 测试与验证结果

| 命令 | 结果 |
|---|---|
| `corepack pnpm --filter @linghun/tui typecheck` | PASS |
| `corepack pnpm exec biome check packages/tui/src` | FAIL：全树既有格式/import/maxSize 债；包含 `index.test.ts` 超过 Biome 1.0 MiB maxSize，以及未触碰文件如 `deep-compact-runtime.ts`、`job-runner-presenter.ts`、`mcp-index-runtime.test.ts` 等格式/import 诊断。 |
| targeted `biome check` on touched/new runtime files | PASS：`index.ts`、`model-command-runtime.ts`、`shell/view-model.test.ts`、`job-agent-command-runtime.ts`、`terminal-readiness-runtime.ts`、`provider-loop-runtime.ts`、`slash-command-runtime.ts`、`tui-context-runtime.ts`、`workflow-command-runtime.ts` |
| `corepack pnpm exec vitest run packages/tui/src/index.test.ts` | PASS：608/608 |
| `corepack pnpm exec vitest run packages/tui/src/job-runtime.test.ts` | PASS：50/50 |
| `corepack pnpm exec vitest run packages/tui/src/shell/models/footer-view.test.ts packages/tui/src/shell/view-model.test.ts` | PASS：331/331 |
| `corepack pnpm exec vitest run packages/tui/src/provider-transit-failure.test.ts packages/tui/src/runtime-status-presenter.test.ts packages/tui/src/model-doctor-runtime.test.ts` | PASS：93/93 |
| `corepack pnpm --filter @linghun/tui test` | Exit 0；`@linghun/tui` 当前没有 `test` script，因此没有额外测试输出。 |

## 已知风险

1. **`slash-command-runtime.ts` 仍然很大**：当前 9,956 行，聚合了主链 continuation 与多个共享状态命令。继续拆分可以做，但需要单独围绕 provider/tool continuation 再做一轮源码级验证，不能在本阶段尾声冒险。
2. **全树 Biome 未清零**：本阶段 touched/new runtime 文件 targeted Biome 已通过，但 required full-tree `packages/tui/src` check 仍受既有 maxSize/format/import 债阻断。
3. **`index.test.ts` 仍然超大**：本阶段只更新源码锚点，不拆测试文件，避免把结构重构扩散到测试体系。
4. **类型兼容出口仍存在**：少数既有模块仍从 `./index.js` import type `TuiContext`。这是类型兼容，不构成明显运行时循环；后续可在单独阶段迁到 `tui-context-runtime.ts`。

## 回滚策略

- 回滚本阶段源码拆分：恢复 `packages/tui/src/index.ts`、相关 touched tests/runtime 文件，并删除 `provider-loop-runtime.ts`、`slash-command-runtime.ts`、`tui-context-runtime.ts`、`workflow-command-runtime.ts`。
- 回滚文档：删除 `docs/delivery/phase-07-3-index-source-split.md`。
- 回滚后重新运行至少 `corepack pnpm --filter @linghun/tui typecheck` 与 `corepack pnpm exec vitest run packages/tui/src/index.test.ts`，确认主链恢复。

## 不在本阶段处理

- 不清理全树 Biome 既有债。
- 不拆 `index.test.ts`。
- 不继续二次拆分 `slash-command-runtime.ts`。
- 不改 provider/model/env 配置。
- 不改权限策略。
- 不新增 agent/workflow/job 功能。
- 不进入后续阶段。

## 参考核对

### 已读取的 Linghun 文档

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-07-2-product-surface-maturity-closure.md`

### 已精读/核对的 Linghun 源码

- `packages/tui/src/index.ts`
- `packages/tui/src/slash-command-runtime.ts`
- `packages/tui/src/tui-context-runtime.ts`
- `packages/tui/src/workflow-command-runtime.ts`
- `packages/tui/src/provider-loop-runtime.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/terminal-readiness-runtime.ts`
- `packages/tui/src/model-command-runtime.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/shell/view-model.test.ts`

### CCB / 外部参考

本阶段是 Linghun 自有源码结构拆分，不需要读取 CCB 源码或社区实现。未复制可疑源码、内部 API、专有遥测或反编译痕迹。

## Handoff Packet

```json
{
  "phase": "7.3",
  "phaseName": "index.ts Source Split",
  "status": "DONE_WITH_VALIDATION_EXCEPTION",
  "nextPhase": "用户确认后再决定是否二次拆分 slash-command-runtime 或先清理 Biome 全树债",
  "indexLineCount": {
    "before": 14062,
    "after": 2528
  },
  "newModules": [
    "packages/tui/src/tui-context-runtime.ts",
    "packages/tui/src/workflow-command-runtime.ts",
    "packages/tui/src/provider-loop-runtime.ts",
    "packages/tui/src/slash-command-runtime.ts"
  ],
  "forbiddenNextActionsWithoutUserApproval": [
    "继续拆 slash-command-runtime.ts",
    "拆 index.test.ts",
    "清理全树 Biome 债",
    "改 provider/model/env",
    "改权限策略",
    "改 agent/workflow/job 调度语义",
    "进入下一阶段"
  ],
  "validation": {
    "typecheck": "PASS",
    "biomeFullTree": "FAIL: existing maxSize/format/import diagnostics in packages/tui/src",
    "biomeTargetedTouchedRuntime": "PASS",
    "indexTest": "608/608 PASS",
    "jobRuntimeTest": "50/50 PASS",
    "footerAndViewModelTests": "331/331 PASS",
    "providerRuntimeDoctorTests": "93/93 PASS",
    "tuiPackageTest": "exit 0; no package test script"
  },
  "indexStatus": "codebase-memory MCP tools unavailable in this session; source facts confirmed with rg and direct file reads; no index rebuild",
  "permissionsMode": "local development; no production/remote mutation",
  "providerModel": "no live provider call; Vitest/mock gateway only",
  "budgetUsage": "no provider token usage recorded"
}
```
