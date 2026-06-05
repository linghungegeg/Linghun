# Phase 7.5-A — Structure & Duplicate Runtime Closure

## 结论

- **阶段状态**: DONE
- **范围**: 只处理 S1/S2/S3，不处理 MC/AW/PM/T/DH 项。
- **结果**: `slash-command-runtime.ts` 从 9,956 行降到 2,997 行；`isRecord` 和 `createEvidenceRecord` 均统一为单一真源。
- **是否可真实实测**: 否。剩余 Must Fix 仍有 9 项，需要 Phase 7.5-B+ 继续清零。
- **行数口径**: 9,956 → 2,997 为 `Measure-Object -Line` 口径；包含空行的 `(Get-Content ...).Count` 总行数为 10,254 → 3,075。当前文件低于 3,200 强制说明阈值，但仍是 dispatch/glue 与少量强耦合命令 owner 的混合模块，不能表述为“极薄 dispatcher”。

## 阶段目标

- 关闭 S1：按真实职责 owner 拆分 `packages/tui/src/slash-command-runtime.ts`。
- 关闭 S2：移除 4 文件 `isRecord()` 重复定义，统一到单一真源。
- 关闭 S3：移除 3 处 `createEvidenceRecord` 语义漂移，统一到单一真源。
- 保持行为不变：不新增用户功能，不改 slash 命令语法，不改 provider/model/env、权限策略或 agent/workflow/job 调度语义。

## 已完成功能

- `slash-command-runtime.ts` 主体职责拆入 7 个真实 owner runtime。
- `isRecord` 统一为 `tui-state-runtime.ts` 导出实现。
- `createEvidenceRecord` 统一为 `evidence-runtime.ts` 导出实现。
- Phase 7.4 审计文档中 S1/S2/S3 标为 DONE，剩余 Must Fix 收敛为 9 项。

## 使用方式

本阶段不新增用户命令或交互语义。用户继续按原路径使用 slash 命令、自然语言主链、审批、workflow/job/agent、compact/cache/details/status 等能力。

开发者验证入口：

- `linghun --help`
- `corepack pnpm --filter @linghun/tui typecheck`
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts`

## 涉及模块

- `packages/tui/src/slash-command-runtime.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/model-tool-runtime.ts`
- `packages/tui/src/permission-approval-runtime.ts`
- `packages/tui/src/evidence-runtime.ts`
- `packages/tui/src/details-status-runtime.ts`
- `packages/tui/src/compact-cache-command-runtime.ts`
- `packages/tui/src/background-control-runtime.ts`
- `packages/tui/src/tui-state-runtime.ts`
- `packages/tui/src/index-runtime.ts`
- `packages/tui/src/job-runtime.ts`
- `packages/tui/src/runner-runtime.ts`
- `packages/tui/src/workflow-command-runtime.ts`
- `packages/tui/src/compact-preflight-runtime.ts`
- `packages/tui/src/index.test.ts`

## 关键设计

- 保留 `slash-command-runtime.ts` 作为 slash dispatch/configuration glue，避免一次性迁移所有命令 owner 引入行为漂移。
- provider stream loop、tool dispatch、permission continuation、evidence、details/status、compact/cache、background control 各自拥有真实 owner 模块。
- `createEvidenceRecord` 只在 evidence owner 中实现，其他模块只 import，不保留语义性 DI wrapper。
- `isRecord` 只在 state owner 中实现，运行时模块按需 import。

## 配置项

- `biome.json` 增加 `files.maxSize: 2097152`，仅用于让本阶段指定的 Biome 命令实际检查超过 1 MiB 的 `packages/tui/src/index.test.ts`。未改变 formatter/linter 规则，未改 provider/model/env 配置。

## 性能结果

- 本阶段为源码结构迁移，无新增 runtime 轮询、后台任务、网络调用或 provider 调用。
- `slash-command-runtime.ts` 行数由 9,956 降至 2,997，降低后续审计和定位成本。

## 已知问题

- `slash-command-runtime.ts` 仍保留 dispatch glue、doctor、trust/language、verify/review/vision/image、index safety repair 等强耦合命令路径；后续若继续拆分，必须按行为测试逐段迁移。
- Phase 7.4 Must Fix 仍剩 9 项，本阶段不允许进入真实实测。

## 不在本阶段处理的内容

- 不处理 MC1/AW1/AW3/PM1/T1/DH1/DH2/DH3/DH4。
- 不改 provider/model/env 配置、权限策略、agent/workflow/job 调度语义、slash 命令语法。
- 不新增用户功能，不做跨阶段清理。

## 下一阶段衔接

Phase 7.5-B 应在用户确认后继续处理剩余 Must Fix，优先按 Phase 7.4 文档中的 9 项清单推进；不得回头把 S1/S2/S3 已完成项重复实现成第二套系统。

## 开发者排查入口

- 拆分 glue：`packages/tui/src/slash-command-runtime.ts`
- 模型主链：`packages/tui/src/model-stream-runtime.ts`
- 工具执行：`packages/tui/src/model-tool-runtime.ts`
- 审批续跑：`packages/tui/src/permission-approval-runtime.ts`
- evidence 真源：`packages/tui/src/evidence-runtime.ts`
- cache/compact：`packages/tui/src/compact-cache-command-runtime.ts`
- details/status/session：`packages/tui/src/details-status-runtime.ts`
- background/interrupt：`packages/tui/src/background-control-runtime.ts`
- `isRecord` 真源：`packages/tui/src/tui-state-runtime.ts`

## Source-Level Reality Check

### 实际读取

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-07-4-post-split-full-product-readiness-audit.md`
- `packages/tui/src/slash-command-runtime.ts`
- `packages/tui/src/tui-context-runtime.ts`
- `packages/tui/src/workflow-command-runtime.ts`
- `packages/tui/src/compact-preflight-runtime.ts`
- `packages/tui/src/index-runtime.ts`
- `packages/tui/src/job-runtime.ts`
- `packages/tui/src/runner-runtime.ts`
- `packages/tui/src/index.test.ts`

### slash-command-runtime.ts 当前职责分布

拆分前文件包含 slash glue、provider stream loop、model tool dispatch、pending approval continuation、tool_result/evidence/transcript、details/status、compact/cache/break-cache、background interrupt、index safety repair、trust/language/mode/plan 等职责。

### 拆分候选 owner 与实际落地

| 模块 | 职责 owner | 迁移内容 |
|---|---|---|
| `model-stream-runtime.ts` | provider/model 主循环 | `handleNaturalInput`、`sendMessage`、`continueModelAfterToolResults`、final answer stream、provider fallback、raw tool protocol retry、remote inbound glue |
| `model-tool-runtime.ts` | 模型工具执行 | `executeModelToolUse`、approved tool execution、deferred/MCP tool glue、Linghun control tools、index tool glue、显式 tool slash 执行 |
| `permission-approval-runtime.ts` | 本地审批与确认续跑 | `executePermissionApprove`、`executePermissionDeny`、Enter/Esc/key handling、`/mode`、`/plan`、`/permissions` |
| `evidence-runtime.ts` | evidence/transcript 真源 | `createEvidenceRecord`、`rememberEvidence`、tool/provider/verification evidence、tool_result budget、system/background events |
| `details-status-runtime.ts` | details/status/session helper | `/details`、`formatHomeScreen`、`writeStatus`、`ensureSession`、test-only shell helpers |
| `compact-cache-command-runtime.ts` | cache/compact/break-cache control | `/cache-log`、`/cache`、`/compact`、`/break-cache`、usage/freshness/workspace reference cache、memory/break-cache evidence |
| `background-control-runtime.ts` | background/interrupt control | background lifecycle、resource guard、CommandPanel stop selected、`/interrupt`、runner thin wrappers |

### 强耦合点和禁止搬动点

- 保留 `index.ts` 顶层 slash dispatcher，不改 slash 命令语法。
- `sendMessage` 与 `continueModelAfterToolResults` 同组迁移，避免 final gate/provider fallback/tool loop 语义漂移。
- `executePermissionApprove/Deny` 整组迁移，保持 pendingLocalApproval 所有 kind 的 continuation 回灌。
- `createEvidenceRecord` 成为 `evidence-runtime.ts` 真源，Git/workflow/compact/slash 均复用同一实现。
- 不改 provider/model/env 配置，不改权限策略，不改 agent/workflow/job 调度语义。

## 迁移 Map

| 原位置 | 新位置 |
|---|---|
| `slash-command-runtime.ts` model stream 区 | `model-stream-runtime.ts` |
| `slash-command-runtime.ts` model/deferred/control/index tool 区 | `model-tool-runtime.ts` |
| `slash-command-runtime.ts` pending approval/mode/plan/permissions 区 | `permission-approval-runtime.ts` |
| `slash-command-runtime.ts` evidence/tool_result/system event 区 | `evidence-runtime.ts` |
| `slash-command-runtime.ts` `/details`/status/session helpers | `details-status-runtime.ts` |
| `slash-command-runtime.ts` cache/compact/break-cache/memory evidence glue | `compact-cache-command-runtime.ts` |
| `slash-command-runtime.ts` background lifecycle/interrupt/resource guard | `background-control-runtime.ts` |
| `compact-preflight-runtime.ts` local `createEvidenceRecord` 副本 | 删除，改 import `evidence-runtime.ts` |
| `workflow-command-runtime.ts` `createEvidenceRecord` DI wrapper | 删除，改 import `evidence-runtime.ts` |

## 行数结果

| 文件 | 拆分前 | 拆分后 |
|---|---:|---:|
| `packages/tui/src/slash-command-runtime.ts` | 9,956 | 2,997 |

## 重复系统清零

### isRecord

- 统一前:
  - `packages/tui/src/index-runtime.ts`
  - `packages/tui/src/job-runtime.ts`
  - `packages/tui/src/runner-runtime.ts`
  - `packages/tui/src/slash-command-runtime.ts`
  - `packages/tui/src/tui-state-runtime.ts`
- 统一后:
  - 真源仅保留 `packages/tui/src/tui-state-runtime.ts:930`
  - `index-runtime.ts`、`job-runtime.ts`、`runner-runtime.ts` 改为 import
  - `slash-command-runtime.ts` 未使用副本删除

### createEvidenceRecord

- 统一前:
  - 真源/主副本: `packages/tui/src/slash-command-runtime.ts`
  - DI wrapper: `packages/tui/src/workflow-command-runtime.ts`
  - 本地副本: `packages/tui/src/compact-preflight-runtime.ts`
- 统一后:
  - 真源仅保留 `packages/tui/src/evidence-runtime.ts:39`
  - workflow/compact/slash 均 import 真源
  - workflow 不再保留语义性 DI wrapper；compact 不再保留独立副本

## 行为不变声明

本阶段为结构迁移和重复系统统一，不新增功能，不改 provider/model/env 配置，不改权限策略，不改 agent/workflow/job 调度语义，不改 slash 命令语法。stale session 重建路径维持原有行为：`SessionStore.resume()` 返回中文“未找到会话”时仍会创建新 session。

## 剩余 Must Fix（9 项）

- MC1: `estimateToolCallsChars` 深度截断低估大嵌套 tool input
- AW1: Registry workflow `write` 操作未实际执行
- AW3: 后台 job 停止遗漏 runner 清理
- PM1: workflow 路径多层确认疲劳
- T1: `index.test.ts` 存在导入锚点断言
- DH1: 文档绝对路径/私有路径卫生
- DH2: 根目录 `test-model-set.sh`
- DH3: README Quick Start/配置/CONTRIBUTING 缺口
- DH4: LICENSE 与 package license 缺口

## 测试与验证

| 命令 | 结果 |
|---|---|
| `corepack pnpm --filter @linghun/tui typecheck` | PASS |
| `corepack pnpm exec biome check ...指定 8 文件` | PASS，8 files checked |
| `corepack pnpm exec vitest run packages/tui/src/index.test.ts` | PASS，608/608 |
| `corepack pnpm exec vitest run packages/tui/src/job-runtime.test.ts packages/tui/src/runner-runtime.test.ts` | PASS，65/65 |
| `corepack pnpm exec vitest run packages/tui/src/shell/models/footer-view.test.ts packages/tui/src/shell/view-model.test.ts packages/tui/src/provider-transit-failure.test.ts packages/tui/src/runtime-status-presenter.test.ts packages/tui/src/model-doctor-runtime.test.ts` | PASS，424/424 |

## 参考核对

- 本阶段读取 Linghun 蓝图、实现规格、路线图、交付 README、Phase 7.4 审计文档和指定源码。
- codebase-memory MCP 工具本轮未暴露；已按规则降级为 `rg` 与源码精读。
- 未读取或复制 CCB 源码、内部 API、专有实现或反编译痕迹。
- CCB/CCB Dev Boost 仅作为阶段规则中的行为参考边界；本阶段实现完全基于 Linghun 自有源码事实。

## Handoff Packet

```json
{
  "phase": "7.5-A",
  "phaseName": "Structure & Duplicate Runtime Closure",
  "status": "DONE",
  "nextPhase": "Phase 7.5-B",
  "canProceed": true,
  "mustFixDone": ["S1", "S2", "S3"],
  "remainingMustFix": ["MC1", "AW1", "AW3", "PM1", "T1", "DH1", "DH2", "DH3", "DH4"],
  "forbiddenNextActions": [
    "进入真实实测",
    "修改 provider/model/env 配置",
    "修改权限策略",
    "修改 agent/workflow/job 调度语义",
    "处理非 S1/S2/S3 的 Must Fix"
  ],
  "evidenceRefs": [
    "packages/tui/src/slash-command-runtime.ts line count 2997 (3075 including blank lines)",
    "packages/tui/src/evidence-runtime.ts createEvidenceRecord",
    "packages/tui/src/tui-state-runtime.ts isRecord"
  ],
  "validation": {
    "typecheck": "PASS",
    "biome": "PASS, 8 files checked",
    "vitest": "PASS, index.test.ts 608/608; job+runner 65/65; shell/provider/status/doctor 424/424"
  },
  "indexStatus": "codebase-memory tools unavailable; rg/source-read fallback used",
  "permissionMode": "local repository edits only",
  "providerModel": "no live provider call",
  "budgetUsage": "no provider token usage recorded"
}
```
