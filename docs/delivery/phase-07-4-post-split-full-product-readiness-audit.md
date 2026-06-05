# Phase 7.4 — Post-Split Full Source Product Readiness Audit

## 阶段基线

- **执行日期**: 2026-06-05
- **分支**: `codex/meta-scheduler-closure`
- **阶段类型**: 审计阶段，零源码改动；仅新增/更新审计文档
- **前置条件**: Phase 7.3 (index.ts Source Split) 已完成，README 已更新，index.test.ts 已明确 exit 0

## 审计规模

| 维度 | 数据 |
|---|---|
| 并行审计 agent 数 | 8 |
| 覆盖审计域 | 8 (index拆分结构 / 主链闭环 / Agent-Workflow-Job / 权限-打断 / TUI交互 / Windows / 测试真实性 / 文档-开源卫生) |
| 实际读取文件数 | 130+ 个独立源文件（含源码、测试、文档、配置） |
| 总发现项 | 48 |

## 验证基线

| 命令 | 结果 |
|---|---|
| `git status --short` | 仅 3 个未跟踪项 (`docs/delivery/phase-6.7-full-source-maturity-audit.md`, `docs/stress/`, `test-model-set.sh`)，与 Phase 7.3 基线一致 |
| `corepack pnpm --filter @linghun/tui typecheck` | PASS |
| `corepack pnpm exec biome check packages/tui/src` | 29 errors，全树既有格式/import/maxSize 债，无新引入 |
| `corepack pnpm exec vitest run packages/tui/src/index.test.ts` | Phase 7.4 审计阶段未重新取得独立 exit 0；以 Phase 7.3.1 稳定点 608/608 PASS 作为基线 |
| `corepack pnpm exec vitest run packages/tui/src/job-runtime.test.ts packages/tui/src/shell/models/footer-view.test.ts packages/tui/src/shell/view-model.test.ts packages/tui/src/provider-transit-failure.test.ts packages/tui/src/runtime-status-presenter.test.ts packages/tui/src/model-doctor-runtime.test.ts` | 6 passed, 474/474 PASS |

## 全仓发现清单

### Must Fix Before Real Test (9 项；S1/S2/S3 已由 Phase 7.5-A DONE)

#### 结构 (3 项)

| ID | 发现 | 代码路径 | 行号 | 风险 | 建议最小修复 |
|---|---|---|---|---|---|
| **S1** | DONE in Phase 7.5-A：`slash-command-runtime.ts` 已从 9,956 行降至 2,997 行（总行数 10,254 → 3,075），模型流/工具执行/权限审批/evidence/details/cache/background 拆入真实 owner 模块 | `packages/tui/src/slash-command-runtime.ts`, `model-stream-runtime.ts`, `model-tool-runtime.ts`, `permission-approval-runtime.ts`, `evidence-runtime.ts`, `details-status-runtime.ts`, `compact-cache-command-runtime.ts`, `background-control-runtime.ts` | 全文件 | 已收敛 | 见 `phase-07-5a-structure-duplicate-runtime-closure.md` |
| **S2** | DONE in Phase 7.5-A：`isRecord()` 统一为 `tui-state-runtime.ts` 单一导出实现，`index-runtime.ts`/`job-runtime.ts`/`runner-runtime.ts` 改为 import，`slash-command-runtime.ts` 副本删除 | `packages/tui/src/tui-state-runtime.ts:930` | — | 已收敛 | 见 `phase-07-5a-structure-duplicate-runtime-closure.md` |
| **S3** | DONE in Phase 7.5-A：`createEvidenceRecord` 真源移动到 `evidence-runtime.ts`，compact/workflow/slash 统一 import；workflow 不再保留语义性 DI wrapper，compact 不再保留副本 | `packages/tui/src/evidence-runtime.ts:39` | — | 已收敛 | 见 `phase-07-5a-structure-duplicate-runtime-closure.md` |

#### 主链 (1 项)

| ID | 发现 | 代码路径 | 行号 | 风险 | 建议最小修复 |
|---|---|---|---|---|---|
| **MC1** | `estimateToolCallsChars` 深度截断（depth>6 return 16）在大嵌套 tool input 上严重低估实际 JSON 大小 | `compact-context.ts` | 174 | 超大 tool_use input 可能绕过 context 截断发送到 provider | 为大 input 添加保守上限或使用 `JSON.stringify` 实际检查 |

#### Agent / Workflow / Job (2 项)

| ID | 发现 | 代码路径 | 行号 | 风险 | 建议最小修复 |
|---|---|---|---|---|---|
| **AW1** | Registry workflow 的 `write` 操作总是返回 `blocked`，无实际执行 | `workflow-command-runtime.ts` | 1290-1302 | 自定义 workflow 中的 Write 步骤从未执行 | 添加实际 Write 工具执行或移除该操作类型 |
| **AW3** | `stopSingleBackgroundTask` 处理作业取消但不调用 `stopRunnerForDurableJob` | `slash-command-runtime.ts` | 3192-3204 | 作业有关联运行器进程时不会被终止 | 为作业任务添加 `await stopRunnerForDurableJob(context, job)` |

#### 权限 (1 项)

| ID | 发现 | 代码路径 | 行号 | 风险 | 建议最小修复 |
|---|---|---|---|---|---|
| **PM1** | Workflow 路径确认疲劳：同一用户操作经历 3-4 层确认链（自然语言 Start Gate → workflow Start Gate → PermissionPanel → boundary preflight） | `slash-dispatch.ts`, `natural-command-bridge.ts` | 多处 | 用户需要逐条放行多层确认，交互体验差 | 在用户已显式批准 workflow Start Gate 且处于 `auto-review` 模式下，将首轮工具调用降权或合并确认 |

#### 测试 (1 项)

| ID | 发现 | 代码路径 | 行号 | 风险 | 建议最小修复 |
|---|---|---|---|---|---|
| **T1** | `index.test.ts` 行 25522 包含导入锚点断言（检查 `verifyFailureLearningContract` 被导入和调用而非行为正确性） | `packages/tui/src/index.test.ts` | 25522-25528 | 误报/漏报率对行为覆盖无意义 | 删除或替换为行为测试；实际的合同验证由 `meta-scheduler-runtime.test.ts` 覆盖 |

#### 文档与开源卫生 (4 项)

| ID | 发现 | 代码路径 | 行号 | 风险 | 建议最小修复 |
|---|---|---|---|---|---|
| **DH1** | CLAUDE.md、AGENTS.md、交付文档中包含 `F:\Linghun\`、`F:\ccb-source\` 绝对路径，对外部开发者无意义 | `CLAUDE.md:19-23`, `AGENTS.md:19-23`, `LINGHUN_CCB_MATURITY_COMPARISON_REPORT.md:53-79` 等 | 多处 | 泄露作者工作机目录结构 | CLAUDE.md/AGENTS.md 中的绝对路径改为相对路径；历史文档标注为 `[本地参考路径]` |
| **DH2** | 根目录存在 `test-model-set.sh`（untracked），bash 脚本在 Windows 项目中，硬编码 `deepseek-chat` | 根目录 | 全文件(19行) | 非通用测试脚本，硬编码旧模型名 | 删除，将其测试逻辑整合到 vitest 套件 |
| **DH3** | README.md 缺少 Quick Start 安装步骤；无 `pnpm install`/`pnpm build` 说明；无环境变量配置说明；无 CONTRIBUTING.md | `README.md` | 28-55 | 新开发者无法从 README 独立复现验证 | 补充 Quick Start 节（`pnpm install && pnpm build && pnpm test`）、`/model setup` 指引、env 配置最小示例 |
| **DH4** | 根目录无 LICENSE 文件；所有 8 个本仓 package.json 无 `license` 字段（root + apps/cli + packages/config/core/providers/shared/tools/tui） | 根目录及各 packages | — | **法律上未授权任何人使用** | 根目录添加 LICENSE 文件（MIT 或 Apache-2.0）；所有 package.json 添加 `"license"` 字段 |

### Already OK（源码和测试证明已闭环，29 项）

#### 结构 (4 项)
- **S-OK1**: 无 `any`/`@ts-ignore` 逃逸（5 个核心文件搜索零结果）
- **S-OK2**: 测试锚点未失真（仅 1 处 legacy re-export 路径，仍 resolve 正确）
- **S-OK3**: `tui-context-runtime.ts` owner 边界清晰（纯类型+常量，零 runtime 逻辑）
- **S-OK4**: `provider-loop-runtime.ts` owner 边界清晰（165 行，4 个函数，单一 fallback/cooldown 切面）

#### 主链 (8 项)
- **MC-OK1**: Tool pairing safety 有 guardian（`compact-preflight-runtime.ts:282-322`）
- **MC-OK2**: Provider fallback 单次限制（`runtimeFallbackAttempted` flag 防死循环）
- **MC-OK3**: `sendMessage` 与 `continueModelAfterToolResults` 的 gate 逻辑镜像一致
- **MC-OK4**: Circuit breaker 阈值和恢复正确（2 次失败/45s cooldown，成功自动清除）
- **MC-OK5**: 最终 gate 强制降级不 retry，原文不入 transcript
- **MC-OK6**: `interruptAllActiveWork` 覆盖所有 5 类 AbortController + 3 类后台任务
- **MC-OK7**: `sendMessage` cooldown return 在 try 块外、controller 创建前，清理正确
- **MC-OK8**: Meta-scheduler contract 验证 + degraded warning 接线完整

#### Agent / Workflow / Job (9 项)
- **AW-OK1**: Bridge 覆盖 schema→action 全部 7 种 main-chain 请求类型
- **AW-OK2**: Agent registry 用户发现性增强（加载 + 映射 + 类型）
- **AW-OK3**: Durable job 持久化（`state.json`、`job.log`、`full-output.log`、`report.md`）
- **AW-OK4**: 启动时恢复检测心跳陈旧（`JOB_RECOVERY_HEARTBEAT_STALE_MS = 2min`）
- **AW-OK5**: Background 展现正确反映 agent/job 状态
- **AW-OK6**: Agent idle/completed/stale/blocked 语义正确
- **AW-OK7**: AbortController 管道完整（创建/清理/权限桥接）
- **AW-OK8**: 子 agent explorer/planner type 强制 plan 模式（纯只读）
- **AW-OK9**: 并发 agent 数限制 `DEFAULT_JOB_RUNNING_AGENT_CAP = 3`
- **AW-OK10**: `cancelAgent` 取消后完整刷新：`syncBackgroundWithAgentStatus`、persist、`appendBackgroundTaskEvent` 之后，末尾调用 `deps().writeStatus(output, context)`（`job-agent-command-runtime.ts:3142`）。AW2 原报告称"未调用 writeStatus"为误报，源码事实不成立。

#### 权限 (15 项)
- **PM-OK1**: 所有 mutation 工具（Write/Edit/MultiEdit/Bash）经过 `decidePermission`→engine 管道
- **PM-OK2**: Deny 路径通过 record evidence + `ok:false` 正确阻止执行
- **PM-OK3**: 子 agent 独立调用 `decidePermission`，使用父 session ID
- **PM-OK4**: `AGENT_PERMISSION_BRIDGE_TOOLS` 只桥接 4 个工具
- **PM-OK5**: 并发守卫防止多个 approval 并存（`createAgentToolApproval`）
- **PM-OK6**: Workflow worker 不绕过权限——仍通过 agent infrastructure
- **PM-OK7**: MCP 网络 install 需显式 `--confirm-network`
- **PM-OK8**: MCP/deferred 工具默认 `require_permission`
- **PM-OK9**: Start Gate 有 90s 过期，防陈旧确认
- **PM-OK10**: `full-access` 模式减少工具级 prompt
- **PM-OK11**: UNC/SMB/WebDAV 路径双层拦截（policy engine + hard-deny）
- **PM-OK12**: Windows 反斜杠路径在 tokenizer 中正确保留
- **PM-OK13**: `powershell -EncodedCommand`/`cmd /c`/`bash -c` 强制 `require_permission`
- **PM-OK14**: Windows 特有网络/破坏性/变异命令头完整覆盖
- **PM-OK15**: `%VAR%` cmd.exe env 展开检测

#### TUI 交互 (7 项)
- **TUI-OK1**: Summary-first 三层折叠 (createOutputBlock + addDetailsHint + stripEmbeddedFoldHint)
- **TUI-OK2**: Ctrl+O=/details 架构分离，不变性测试防回归
- **TUI-OK3**: 滚动实现完整（PgUp/PgDn/Home/End/wheel + stickToBottom/clamping/overflow）
- **TUI-OK4**: Footer 极简且用户可见（无 session ID/gate status/debug）
- **TUI-OK5**: 所有用户可见状态有中英双语文案
- **TUI-OK6**: 4 层脱敏器（API key/gateId/sourceRef/rule.id/internal tokens/BGT titles）
- **TUI-OK7**: CJK 宽度计算正确（`charWidth` 覆盖全部 BMP CJK；SIP 平面极少见且无终端字体支持）

#### Windows (5 项)
- **WIN-OK1**: `linghun`/`Linghun` 双入口（package.json bin 字段 + npm 自动生成 .cmd）
- **WIN-OK2**: `shell: false` 是 spawn 默认，各 spawn 点一致
- **WIN-OK3**: Windows 路径规范化（`replaceAll("\\", "/")`、`\r?\n`、UTF-8 + gb18030 fallback）
- **WIN-OK4**: Process tree 清理（`taskkill /pid N /t /f` + Unix process group kill）
- **WIN-OK5**: Terminal 检测级联完整（WT_SESSION → vscode → WezTerm → ConEmu → ConPTY → legacy）

### NOT-DO（有代码事实依据，7 项）

- **ND1**: Workflow DI wrapper 10 函数（透传模式，当前规模成立，择机提取 proxy）
- **ND2**: Index.ts import+export 双路径模式（搬家遗留，后续可简化为单行 export type）
- **ND3**: Workflow 中混入文件发现逻辑（可优化，不影响当前功能）
- **ND4**: Agent 在进程内运行（有意的设计，文档未声称独立进程）
- **ND5**: 子 agent `worker` type 继承父 permissionMode（设计意图：worker 即 executor）
- **ND6**: `compactOutputMemory` 仅 Ink shell 模式生效（plain TUI 安全跳过）
- **ND7**: 会话内 agent 陈旧性轮询（设计范围内未调度，仅启动时检测）

## 关键发现摘要

1. **结构层面**：S1/S2/S3 已由 Phase 7.5-A 完成。`slash-command-runtime.ts` 从 9,956 行降至 2,997 行（总行数 10,254 → 3,075）；`isRecord()` 与 `createEvidenceRecord` 已统一真源。

2. **主链层面**：主链闭合度较高，tool pairing safety、provider fallback、circuit breaker、gate 镜像均正确实现。唯一发现是 `estimateToolCallsChars` 的大嵌套截断边界可能低估实际 JSON 大小。

3. **Agent/Workflow/Job 层面**：Bridge schema 覆盖完整，持久化正确，状态语义清晰。2 个小缺陷：workflow write 操作未实现、后台任务停止遗漏 runner 清理。AW2（cancelAgent writeStatus）经 Phase 7.4.1 纠偏确认源码已调用，移入 Already OK。

4. **权限层面**：管道严密，Windows 安全命令头覆盖完整。主要问题是 workflow 路径的多层确认疲劳（natural → workflow → permission → preflight）。

5. **TUI 层面**：交互成熟度较高，summary-first、滚动、footer、脱敏、CJK 宽度均正确。无 Must Fix 项。

6. **Windows 层面**：入口、shell、路径、进程清理、终端检测均正确。无 Must Fix 项。

7. **测试层面**：大部分测试真实（行为测试而非锚点）。1 处导入锚点断言无行为验证意义。

8. **文档与开源卫生层面**：最严重——无 LICENSE 文件（法律上无法使用）、无 Quick Start 安装步骤、私有路径泄露、残留测试脚本。

## 是否存在阻止进入 Phase 7.5 的审计缺口

**否。** 审计覆盖了全部 8 个必须审计域，130+ 源文件。没有审计盲区阻止进入下一阶段。

Must Fix Before Real Test 的剩余 9 项问题在 Phase 7.5 后续批次中修复并验证后，方可进入真实实测。

## 建议 Phase 7.5 修复批次

| 批次 | 内容 | 预估改动文件数 |
|---|---|---|
| Batch 1: 开源卫生 | DH2(删除 test-model-set.sh), DH3(README Quick Start), DH4(LICENSE + package.json license), DH1(私有路径脱敏) | 10+ |
| Batch 2: 结构去重 | DONE in Phase 7.5-A：S2(isRecord 统一), S3(createEvidenceRecord 统一), S1(slash-command-runtime 拆分) | 7 个新增 owner runtime + 相关 import/wiring |
| Batch 3: 功能缺口 | AW1(workflow write 实现), MC1(estimateToolCallsChars 保守上限) | 3-5 |
| Batch 4: 交互收口 | PM1(workflow 确认合并), AW3(stop runner on bg task cancel), T1(删除导入锚点测试) | 4-7 |

## 参考核对

### 已读取的 Linghun 文档
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-07-3-index-source-split.md`
- `docs/delivery/phase-07-2-product-surface-maturity-closure.md`
- `docs/delivery/phase-6.7-full-source-maturity-audit.md`（历史审计参考）
- `CLAUDE.md`
- `AGENTS.md`

### 已精读/核对的 Linghun 源码（审计覆盖）

全仓覆盖，审计范围内读取 130+ 独立源文件。关键文件清单按域分发，完整清单见各 agent 原始报告。

### CCB / 外部参考

本阶段仅使用 Linghun 自有源码进行审计，未读取 CCB 源码或社区实现。未复制可疑源码、内部 API、专有遥测或反编译痕迹。CCB 仅在行为参考的意义上被提及（任务描述中的审计原则），不进入源码事实对比。

## Handoff Packet

```json
{
  "phase": "7.4",
  "phaseName": "Post-Split Full Source Product Readiness Audit",
  "status": "DONE",
  "nextPhase": "Phase 7.5: Must Fix Before Real Test 清零",
  "auditMetrics": {
    "parallelAgents": 8,
    "auditDomains": 8,
    "filesRead": "130+",
    "totalFindings": 48,
    "mustFix": 9,
    "alreadyOk": 29,
    "notDo": 7
  },
  "mustFixBreakdown": {
    "structure": 0,
    "mainChain": 1,
    "agentWorkflowJob": 2,
    "permission": 1,
    "testing": 1,
    "docsAndHygiene": 4
  },
  "blockersToPhase75": "None. Original 12 Must Fix items are Phase 7.5 scope; S1/S2/S3 were resolved in Phase 7.5-A, leaving 9.",
  "criticalBlockersToRealTest": [
    "DH4: No LICENSE file — legally unusable",
    "DH3: No Quick Start — unreproducible by new developers",
    "S1/S2/S3 resolved in Phase 7.5-A; remaining blockers are MC1/AW1/AW3/PM1/T1/DH1/DH2/DH3/DH4"
  ],
  "forbiddenNextActionsWithoutPhase75": [
    "进入真实实测",
    "边测边修",
    "将 Must Fix 标为 P2/P3 以后再说",
    "跳过 LICENSE 和 Quick Start 直接开源",
    "继续拆分而不先修重复定义"
  ],
  "validation": {
    "typecheck": "PASS",
    "biomeFullTree": "29 errors (existing maxSize/format/import debt, no new)",
    "indexTestBaseline": "Phase 7.3 baseline 608/608 PASS",
    "keyTestSuites": "6 files, 474/474 PASS",
    "tuiPackageTest": "exit 0; no package test script"
  },
  "indexStatus": "codebase-memory MCP tools unavailable in this session; source facts confirmed with rg and direct file reads; no index rebuild",
  "permissionsMode": "local development; no production/remote mutation",
  "providerModel": "no live provider call; audit-only, zero code changes",
  "budgetUsage": "no provider token usage recorded"
}
```
