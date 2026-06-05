# Phase 7.5-B.2.1 — PM1 Workflow Bridge/Request Gate 口径闭环修复

## 结论

- **阶段状态**: PM1 DONE (B.2.1 源码复查闭环). Phase 7.5-B 全部 MC1/AW1/AW3/PM1/T1 DONE
- **关键修复**: `getCurrentWorkflowStepRequest` 移除硬编码 `confirmedPhaseStopPoints: [phaseId]`，改为从 `options.phaseGateConfirmed` 继承
- **新测试**: 4 个 bridge-layer 行为测试 + 保留原 6 个执行层测试 = 10 个 PM1 测试，全部通过
- **index.test.ts 全量**: **621/621 PASS, exit 0**, 343.62s
- **权限安全**: workflow gate 控制 bridge + execution 双层；per-tool `decidePermission` 不降级

## B.2.1 源码复查

### rg 硬编码扫描

```
rg -n 'phaseStopPointConfirmed:\s*true|confirmedPhaseStopPoints:\s*\[(phase\.id|phaseId)\]' packages/tui/src

packages/tui/src/index.test.ts:25792:      phaseStopPointConfirmed: true,
packages/tui/src/index.test.ts:25830:      phaseStopPointConfirmed: true,
packages/tui/src/workflow-command-runtime.ts:699:    confirmedPhaseStopPoints: [phase.id],
```

逐条解释：
- **index.test.ts:25792, 25830**: 测试代码——故意设置 `phaseStopPointConfirmed: true` 测试 confirmed 行为。不是绕过。
- **workflow-command-runtime.ts:699**: `runWorkflowSteps` 中的 planner 层调用——这是显式 `/workflows run <goal>` 入口，plan 层确认独立于执行 gate。下游 `runWorkflowPlanSteps` 在 line 802 设置 `phaseGateConfirmed: true`。

### rg phaseGateConfirmed 引用审计

14 处引用，语义全部正确：type definition(1), write-on-confirm(2), read-in-gate(2), bridge-pass-through(1), recover(1), test(7)

## B.2.1 修复点

| 修复 | 位置 | 前 | 后 |
|------|------|-----|-----|
| `RunWorkflowExecutionOptions` 加 `phaseGateConfirmed` | line 715-718 | 无此字段 | `phaseGateConfirmed?: boolean` |
| `runWorkflowPlanSteps` 传播 gate 到 bridge 层 | line 833-838 | 直接传 `options` | 合成 `gateOptions` 含 `phaseGateConfirmed` |
| `getCurrentWorkflowStepRequest` 移除硬编码 | line 1961 | `confirmedPhaseStopPoints: [phaseId]` | `options.phaseGateConfirmed === true ? [phaseId] : []` |
| 新增 `__testGetCurrentWorkflowStepRequest` 导出 | workflow-command-runtime.ts + index.ts | 无 | 测试可访问 bridge 层 |

### 修复后的完整 gate 链

```
/workflows run <goal>
  → runWorkflowSteps (planner confirms phase)
  → runWorkflowPlanSteps (设置 activeRun.phaseGateConfirmed=true)
    → gateOptions = { ...options, phaseGateConfirmed: true }
    → selectRunnableWorkflowBatch(plan, phaseId, steps, gateOptions)
      → getCurrentWorkflowStepRequest(plan, phaseId, steps, stepId, { phaseGateConfirmed: true })
        → bridgeWorkflowPlanToMainChainRequests(runningPlan, {
            confirmedPhaseStopPoints: [phaseId]  // ✅ 来自真实 gate
          })
        → decideWorkflowStepCapability({ phaseStopPointConfirmed: true })
        → mutating → executable: true, status: "runnable"
      → executeWorkflowStep → decideWorkflowStepCapability → per-tool decidePermission ✅
```

未确认路径（测试/恢复验证）：
```
(phaseGateConfirmed = false/undefined)
  → gateOptions.phaseGateConfirmed = false
  → getCurrentWorkflowStepRequest → confirmedPhaseStopPoints: []
  → bridge → decideWorkflowStepCapability → "phase stopPoint must be confirmed"
  → status: "start_gate_needed", executable: false ✅
```

## PM1 行为测试 (13 tests, all PASS)

| # | 测试 | 层 | 覆盖 |
|---|------|-----|------|
| 1 | bridge gate: readonly + confirmed → OK | bridge unit | readonly 不阻塞 |
| 2 | bridge gate: mutating + unconfirmed → start_gate_needed | bridge unit | 未确认 blocked |
| 3 | bridge gate: mutating + plan mode → blocked | bridge unit | plan mode 阻止 |
| 4 | bridge request: unconfirmed → executable=false | bridge request | request 层 gate |
| 5 | bridge request: confirmed → executable=true | bridge request | 已确认放行 |
| 6 | bridge request: absent → defaults unconfirmed | bridge request | 默认保守 |
| 7 | bridge request: confirmed + per-tool 不绕过 | integration | 权限不降级 |
| 8 | registry: write blocked in plan mode | integration | plan mode + registry |
| 9 | registry: readonly not blocked | integration | readonly 不误拦 |
| 10 | registry: phaseGateConfirmed set on invoke | integration | 确认状态正确 |
| 11 | AW1: parser loads path+content from registry | integration | write step 解析 |
| 12 | AW1: write step reaches handleToolCommand | integration | 权限管道 |
| 13 | AW3: stopSingleBackgroundTask runner terminal | integration | runner 清理 |

## 验证结果

### Typecheck
```
corepack pnpm --filter @linghun/tui typecheck → PASS (exit 0)
```

### Biome
```
corepack pnpm exec biome check packages/tui/src/workflow-command-runtime.ts packages/tui/src/tui-data-types.ts packages/tui/src/index.test.ts → PASS
```

### Phase 7.5-B 测试
```
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Phase 7.5-B"
→ 13 passed, 608 skipped (621 total)
```

### index.test.ts 全量 (exit 0)
```
corepack pnpm exec vitest run packages/tui/src/index.test.ts --no-color
→ Test Files  1 passed (1)
→ Tests  621 passed (621)
→ Duration  343.62s
→ exit code 0 ✓
```

### 其余子套件 (B.2 已验证)
```
compact-context.test.ts: 5/5
job-runtime.test.ts: 50/50
runner-runtime.test.ts: 15/15
footer + view-model + provider + status + doctor: 424/424
```

## 权限安全不降级声明

- Bridge 层 gate 控制 `executable` 标志——仅控制是否可进入主链
- 执行层 `decideWorkflowStepCapability` + `decidePermission` 仍是 final gate
- `phaseGateConfirmed` 不妨过 per-tool Write/Edit/Bash/MCP 权限
- 所有变更不改 provider/model/env 配置，不改 slash 命令语法

## 剩余 Must Fix: DH1-DH4

| 编号 | 描述 |
|------|------|
| **DH1** | 文档中的私有路径/绝对路径泄露（CLAUDE.md 等） |
| **DH2** | 根目录 `test-model-set.sh` 残留 |
| **DH3** | README Quick Start / 配置 / CONTRIBUTING 缺口 |
| **DH4** | LICENSE 文件 + 8 个 `package.json` license 字段缺口 |

## Handoff Packet

```json
{
  "phase": "7.5-B.2.1",
  "status": "PM1 DONE — bridge/request gate closed",
  "rg_hardcode_scan": "test-only (2 assertions) + planner-tier (1 expected)",
  "rg_phaseGateConfirmed_audit": "14 references, all correct",
  "full_suite": "621/621 PASS, exit 0, 343.62s",
  "pm1_tests": 13,
  "next_phase": "7.5-C (DH1-DH4 open-source hygiene)",
  "can_enter_real_smoke": false,
  "real_smoke_blockers": ["DH1", "DH2", "DH3", "DH4"]
}
```
