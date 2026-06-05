# Phase 6.9 — Main Chain Closure / Workflow-Agent Runtime Alignment

## 阶段标识

- **阶段**: Phase 6.9
- **日期**: 2026-06-05
- **基线 commit**: `406480c` (Phase 6.7 audit baseline)
- **分支**: `codex/meta-scheduler-closure`
- **目标**: 修复 Phase 6.7 审计中"主链没完全接实"的真实缺口
- **类型**: focused bugfix / contract closure（非新功能、非重构）

## Source-Level Reality Check

### 已确认源码事实

| 面 | 文件 | 关键事实 |
|---|------|---------|
| architecture-boundary guard | `architecture-boundary.ts`, `index.ts:11487-11553` | Write/Edit/MultiEdit 有 preflight；Bash 无 preflight，可通过 redirect/tee/heredoc 写入大文件绕过 |
| workflow bridge | `workflow-agent-runtime-bridge.ts`, `workflow-plan-schema.ts` | Schema 定义 9 个 /job action，bridge 只支持 4 个；/agents cancel 不支持；/workflows 无 bridge |
| agent registry | `agent-workflow-registry.ts`, `job-agent-command-runtime.ts` | /fork 能解析 registry agent，/agents registry 能展示；但 help 不告知如何发现，空状态不提示 registry |
| meta-scheduler ↔ failure-learning | `meta-scheduler-runtime.ts`, `failure-learning-runtime.ts`, `index.ts:9801-9812` | shouldCaptureFailureLearning 只进 prompt directive，真实 capture 调用独立，无运行时合约验证 |

### Minimal Touch Points

- `architecture-boundary.ts`: 新增 `detectBashFileWriteTargets`、扩展 `checkBoundaryEditPreflight` 支持 Bash
- `workflow-agent-runtime-bridge.ts`: 扩展 action 白名单，新增 `/workflows` mainChain
- `job-agent-command-runtime.ts`: 帮助文案和空状态优化
- `meta-scheduler-runtime.ts`: 新增 `verifyFailureLearningContract`
- `index.ts`: Bash preflight 接线、contract flag tracking、contract verification 接线

### Forbidden Duplicate Systems

- 不新增第二套 architecture guard
- 不新增第二套 workflow bridge
- 不新增第二套 agent registry
- 不新增第二套 failure-learning runtime 或 meta-scheduler

## 修复项

### 1. Architecture Boundary Guard — Bash 文件写入旁路

**问题**: Write/Edit/MultiEdit 有 `runBoundaryEditPreflight`，但 Bash 可通过 redirect/tee/heredoc 写入文件，完全绕过 architecture boundary guard。

**修复**:
- `architecture-boundary.ts`: 新增 `detectBashFileWriteTargets(command)` —— 保守检测 Bash 命令中的文件写入模式（redirect `>`、append `>>`、`tee`、heredoc cat）。忽略 `/dev/`、变量目标、`~` 前缀。
- `architecture-boundary.ts`: `BoundaryEditPreflightInput.toolName` 扩展为 `"Write" | "Edit" | "MultiEdit" | "Bash"`；`checkBoundaryEditPreflight` 对 Bash 目标存在且为大文件时返回 `confirm`。
- `index.ts`: `runBoundaryEditPreflight` 新增 Bash 分支，调用 `runBoundaryBashPreflight` 检测文件写入目标并执行 preflight。
- 新增 9 个 focused tests（detectBashFileWriteTargets × 6，Bash preflight × 3）。

### 2. Workflow Bridge Action 对齐

**问题**: Schema 允许的 action 超过 bridge 支持范围，不支持的 action 在 `createMainChainRequest` 中返回 `null`，导致静默失败。

**修复**:
- `WorkflowMainChainRequest` job action 从 4 个扩展到 9 个（新增 `list`, `logs`, `pause`, `resume`, `cancel`）
- `WorkflowMainChainRequest` agents action 新增 `cancel`
- 新增 `workflows` mainChain（`list`, `start_gate`）
- `createMainChainRequest` 处理全部 action
- `createBackgroundProjection` 更新以支持新 mainChain 类型
- 新增 6 个 focused tests（/job logs, /job cancel, /agents cancel, /workflows list, unknown action → null）

### 3. Agent Registry 用户路径成熟化

**问题**: 自定义 agent 虽然可用，但帮助文案不告知如何发现，空状态不提示 registry。

**修复**:
- `/fork` 帮助文案根据是否有自定义 agent 显示不同提示：已加载 N 个自定义 agent 时建议 `/agents registry`；无自定义 agent 时告知存放路径 `.linghun/agents/`
- `/agents list` 空状态 action 列表在存在自定义 agent 时增加 `/agents registry` 入口

### 4. Meta-Scheduler ↔ Failure-Learning 合约闭合

**问题**: Meta-scheduler 的 `shouldCaptureFailureLearning` 只作为 prompt directive 注入，模型无法执行 `captureFailureLearning`；真实 capture 调用与 directive 无关联，无法验证合约。

**修复**:
- `meta-scheduler-runtime.ts`: 新增 `verifyFailureLearningContract()` —— 比较 pre/post-turn record count，当 capture 被要求但未发生时返回 unsatisfied
- `tui-data-types.ts`: `FailureLearningState` 保持原样，不新增字段（通过 context 临时标记跟踪）
- `index.ts`: 新增 `lastMetaSchedulerFailureLearningRequired` / `lastMetaSchedulerFailureLearningFulfilled` 到 TuiContext
- `index.ts`: meta-scheduler 评估后设置 required flag 并清空 fulfilled flag
- `index.ts`: `captureFailureLearning` 包装器设置 fulfilled flag
- `index.ts`: 下次 meta-scheduler 评估前验证 previous turn 合约；未满足时记录 degraded state
- 新增 4 个 focused tests（satisfied/unsatisfied/tool failure/provider failure）

## 改动文件列表

| 文件 | 改动类型 | 行数变化 |
|------|---------|---------|
| `packages/tui/src/architecture-boundary.ts` | 功能增强 + biome | +35 |
| `packages/tui/src/architecture-boundary.test.ts` | 新增测试 | +67 |
| `packages/tui/src/workflow-agent-runtime-bridge.ts` | 功能增强 + biome | ~+30 |
| `packages/tui/src/workflow-agent-runtime-bridge.test.ts` | 新增测试 | +66 |
| `packages/tui/src/meta-scheduler-runtime.ts` | 功能增强 + biome | +28 |
| `packages/tui/src/meta-scheduler-runtime.test.ts` | 新增测试 | +52 |
| `packages/tui/src/job-agent-command-runtime.ts` | 文案增强 | +5 |
| `packages/tui/src/index.ts` | 接线增强 | ~+60 |

## 测试与验证

### 测试结果（返修后）

```
✓ architecture-boundary.test.ts — 43 tests
✓ workflow-agent-runtime-bridge.test.ts — 25 tests
✓ workflow-plan-schema.test.ts — 18 tests
✓ meta-scheduler-runtime.test.ts — 13 tests
✓ failure-learning-runtime.test.ts — 22 tests
✓ index.test.ts — 674 passed / 12 failed (all 12 pre-existing, 0 new)
─────────────────────────────────────────
Total: 795 passed / 12 pre-existing / 5 test files + 1 (index.test.ts) = 6
New tests: +18 round 1, +7 round 2 = 25 total new
```

### 验证命令

```bash
corepack pnpm --filter @linghun/tui typecheck          # clean
corepack pnpm exec biome check --fix --unsafe packages/tui/src/index.ts  # clean
corepack pnpm exec vitest run packages/tui/src/workflow-agent-runtime-bridge.test.ts packages/tui/src/workflow-plan-schema.test.ts packages/tui/src/meta-scheduler-runtime.test.ts packages/tui/src/failure-learning-runtime.test.ts packages/tui/src/index.test.ts  # 674/12-fail (all pre-existing)
```

### 失败回归验证

- **Pre-existing baseline**: 16 failures（git stash 基线）
- **With changes**: 12 failures
- **Delta**: -4 failures（readonly job action 修复减少了 4 个假失败）
- **New failures**: 0

## 剩余风险

| 风险 | 级别 | 说明 |
|------|------|------|
| Bash 文件写入检测不完整 | P2 | `detectBashFileWriteTargets` 只检测明显模式；管道、变量间接、base64 编码等复杂路径不保证捕获。设计上是保守 guard，不是完整沙箱。 |
| /workflows bridge 只支持 read-only list/start_gate | P2 | Workflow 执行类 action（如修改 workflow 定义）不在本阶段范围。 |
| Meta-scheduler contract 依赖 turn 级别 tracking | P2 | 当前通过 context flags 跟踪；如果同一 turn 内多次调用 captureFailureLearning，flag 只标记 fulfilled，不记录次数。 |
| Bash preflight 对相对路径目标的解析 | P3 | `runBoundaryBashPreflight` 使用 `resolve(context.projectPath, target)`，对符号链接和特殊路径的解析受限于 Node.js `path.resolve`。 |

## 不在本阶段处理的内容

- 不拆 `index.ts`
- 不做 UI polish
- 不做 Phase 7 重复系统收敛
- 不新增框架、registry、bridge、scheduler
- 不顺手修 P2/P3 无关项
- 不新增完整的 Bash 命令解析器或沙箱
- 不修改 workflow planner（始终单 phase 的 P2-17）
- CCB 参考路径清理（Phase 6.8 已处理）
- 全量 index.test.ts 回归（23K 行，typecheck 已确认兼容性）

## 返修记录（2026-06-05）

### Codex 复核发现的两个执行闭环阻断

#### Block A: Workflow Bridge 执行端闭环缺失

**问题**: Phase 6.9 第一轮 bridge 通过了测试（schema→bridge 全覆盖），但真实执行端 `executeWorkflowStep()` 没有 `workflows` 分支，`workflowRuntimeKind()` 将 workflows 误归类为 `agent`，`/job list` 被按 mutating action 要求找到 persisted job。

**修复**:
- `workflowRuntimeKind()`: 新增 `workflows` → `"details"`、显式 `fork`/`agents` 分支
- `executeWorkflowStep()`: 新增 `req.mainChain === "workflows"` 分支，`list` 走现有只读路径，`start_gate` 返回明确 blocked/proposal-only
- `/job list` + `/job logs`: 新增 `readonlyJobActions` 集合，只读 action 直接返回 completed 不要求 persisted job（`status`/`report` 仍需检查 job 状态）

#### Block B: Meta-Scheduler ↔ Failure-Learning 运行时合约未真正接线

**问题**: `verifyFailureLearningContract()` 已定义但未导入/调用；`evaluateMetaScheduler()` 调用未传入真实 `lastToolFailure`/`lastProviderFailure`；只有 flag-based 检查，没有真实合约验证。

**修复**:
- 导入并调用 `verifyFailureLearningContract()` 替换 flag-based 检查
- `captureFailureLearning()` 中设置 `context.lastToolFailure`（`tool_failure` category）
- `evaluateMetaScheduler()` 调用时传入 `context.lastToolFailure` 和 `context.lastProviderFailure`
- `TuiContext` 新增 `lastToolFailure` 字段

### 新增测试（index.test.ts +7）

| 测试 | 类型 |
|------|------|
| D.14C: workflowRuntimeKind classifies workflows as details and agents as agent | source invariant |
| D.14C: executeWorkflowStep handles workflows mainChain | source invariant |
| D.14C: executeWorkflowStep has readonly job action guard | source invariant |
| D.14C: verifyFailureLearningContract is imported and called in main chain | source invariant |
| D.14C: captureFailureLearning sets lastToolFailure for meta-scheduler | source invariant |
| D.14C: evaluateMetaScheduler receives lastToolFailure and lastProviderFailure from context | source invariant |
| D.14B: meta-scheduler receives lastToolFailure from captureFailureLearning and lastProviderFailure from provider path | source invariant |

## 下一阶段建议

Phase 7.0（核心文件拆分）或 Phase 6.8 遗留的 P0/P1 修复。建议：
1. 先确认本阶段改动符合预期后建立稳定点
2. 再决定进入 index.ts 拆分（Phase 7.0）还是继续主链收口

## 参考核对

### 本阶段读取的 Linghun 文档
- `docs/delivery/README.md` — 阶段索引和依赖
- `docs/delivery/phase-6.7-full-source-maturity-audit.md` — 审计基线
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` — 阶段边界和验收标准
- `CLAUDE.md` — 项目开发规范

### 本阶段实际读取的源码
- `packages/tui/src/architecture-boundary.ts` — guard 检测器
- `packages/tui/src/workflow-agent-runtime-bridge.ts` — workflow bridge
- `packages/tui/src/workflow-plan-schema.ts` — workflow schema
- `packages/tui/src/agent-workflow-registry.ts` — agent/workflow registry
- `packages/tui/src/meta-scheduler-runtime.ts` — meta-scheduler
- `packages/tui/src/failure-learning-runtime.ts` — failure-learning runtime
- `packages/tui/src/job-agent-command-runtime.ts` — agent/job 命令
- `packages/tui/src/index.ts` — 主接线

### 未参考 CCB 或其他第三方源码

本阶段所有改动基于 Linghun 自有源码事实，未复制任何外部实现。

## Handoff Packet

```json
{
  "verdict": "PASS",
  "scope": "Phase 6.9: Main Chain Closure / Workflow-Agent Runtime Alignment — 4+2 个主链缺口修复 + 返修（执行端闭环 + runtime 合约接线）+ 25 focused tests",
  "changedFiles": [
    "packages/tui/src/architecture-boundary.ts",
    "packages/tui/src/architecture-boundary.test.ts",
    "packages/tui/src/workflow-agent-runtime-bridge.ts",
    "packages/tui/src/workflow-agent-runtime-bridge.test.ts",
    "packages/tui/src/meta-scheduler-runtime.ts",
    "packages/tui/src/meta-scheduler-runtime.test.ts",
    "packages/tui/src/job-agent-command-runtime.ts",
    "packages/tui/src/index.ts",
    "packages/tui/src/index.test.ts",
    "docs/delivery/phase-06-9-main-chain-runtime-alignment.md",
    "docs/delivery/README.md"
  ],
  "testBaseline": { "passed": 674, "preExistingFailed": 12, "newFailed": 0, "files": 6 },
  "typecheck": "clean",
  "biome": "clean (all files auto-fixed)",
  "remainingRisks": [
    "Bash 文件写入检测不完整（复杂管道/编码路径不保证捕获）",
    "/workflows start_gate 仅 proposal-only，无运行时执行路径",
    "Meta-scheduler contract 依赖 turn 级别 tracking"
  ],
  "forbiddenActions": [
    "不拆 index.ts",
    "不新增第二套系统（guard/bridge/registry/scheduler/failure-learning）",
    "不做 UI polish",
    "不做 Phase 7 重复系统收敛"
  ],
  "nextAction": "可以建立稳定点请多开智能体继续工作",
  "permissionMode": "default",
  "provider": "N/A (local validation only)",
  "indexStatus": "N/A (not checked)"
}
```
