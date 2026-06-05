# Phase 7.0 Duplicate Runtime Systems Consolidation

> 阶段：Phase 7.0
> 状态：done
> 日期：2026-06-05
> 范围：重复运行时系统收敛 / 用户可见一致性收敛

## 阶段目标

修复 Phase 6.7 审计中的"重复系统"成熟度问题，优先处理会影响实测手感和主链一致性的重复逻辑。不做大文件结构重构，不拆 index.ts，不进入 Phase 7.x core split。

## Source-Level Reality Check

全仓 `rg` 扫描确认以下重复系统：

### A. CJK/display width — 6套实现

| 位置 | 函数 | 算法 | 问题 |
|------|------|------|------|
| `text-utils.ts` | `charWidth()` | CJK正则可覆盖全范围 | 最完整，已导出供 Composer/plain-renderer 使用 |
| `view-model.ts` | `charWidth()`, `displayWidth()` | 与 text-utils 正则相同 | 本地副本，未导入 |
| `footer-view.ts` | `displayWidth()` | **不同正则**，缺少 Vertical Forms/Halfwidth 范围 | 可能造成 footer 与主屏宽度不一致 |
| `startup-runtime.ts` | `truncateDisplay()` | `charCodeAt(0) > 0xff` | 粗糙，对 emoji 和部分全角字符不准确 |
| `job-runtime.ts` | `truncateDisplay()` | `charCodeAt(0) > 0xff` | 同上，本地私有 |
| `runtime-status-presenter.ts` | `truncateDisplay()` | `value.slice()` | **完全不支持CJK** |

**真实风险：** footer 与主屏宽度算法不同会导致对齐偏差；job/startup 的粗糙算法会错误判断 emoji 宽度；runtime-status 对中文完全无截断。

### B. Scroll model — 两套近乎相同的模型

- `transcript-scroll-state.ts`：完整功能（PgUp/PgDn/Home/End/wheel/measure/stickToBottom）
- `task-scroll-state.ts`：简化版（scroll/end/top），仅被自身测试引用，**生产代码零引用**
- `TaskScrollView = TranscriptScrollView`（类型别名）

### C. Message kind / event kind 枚举

- `MessageBlockKind`（14值）与 `ProductBlockKind`（9值）在 types.ts 中已文档化正交设计
- `EvidenceRecord.kind` 与 `WorkflowEvidenceKind` 服务不同域
- **判决：NOT-DO，无真实漂移风险**

### D. PASS_BANNED 常量 — 3份重复

| 位置 | 变量名 | 值 |
|------|------|-----|
| `workflow-plan-schema.ts:226` | `PASS_BANNED_EVIDENCE_KINDS` | `agent_summary, job_completed, remote_event, failure_learning` |
| `workflow-agent-runtime-bridge.ts:212` | `PASS_BANNED_EVIDENCE_KINDS` | 同上 |
| `workflow-task-surface.ts:62` | `PASS_BANNED_KINDS` | 同上 |

### E. redactedPath — 3份重复

| 位置 | 导出状态 |
|------|---------|
| `process-command-runtime.ts:7` | `export` — 唯一公开导出 |
| `mcp-index-command-runtime.ts:6` | 本地私有 |
| `runner-runtime.ts:131` | 本地私有，注释说明：avoid circular import |

### F. MCP/skills/plugins/compact — 审计结果

- `loadSkillSummaries` / `loadPluginSummaries` 仅在 `tui-state-runtime.ts` 中存在
- MCP call/list 路径无重复 owner
- compact 路径（preflight/deep/context/surface）各司其职
- **判决：NOT-DO，已合理收敛**

## DONE / DEFERRED / NOT-DO 裁决

### DONE

| 编号 | 修复 | 唯一 owner | 旧路径 |
|------|------|----------|--------|
| A1 | 新增 `displayWidth()`, `truncateDisplay()` 到 `text-utils.ts` | `shell/text-utils.ts` | 无→新建 |
| A2 | `startup-runtime.ts` `truncateDisplay` 改用 `charWidth` 从 text-utils | `shell/text-utils.ts:charWidth` | `charCodeAt(0) > 0xff` |
| A3 | `view-model.ts` 移除本地 `CJK_WIDE_CHAR_RE`/`displayWidth`/`charWidth`，改为导入 | `shell/text-utils.ts` | 本地3函数 |
| A4 | `footer-view.ts` 移除本地 `CJK_WIDE_CHAR_RE`/`displayWidth`，改为导入 | `shell/text-utils.ts` | 本地不同正则 |
| A5 | `job-runtime.ts` 移除本地 `stripAnsi`/`truncateDisplay`，改为导入 | `startup-runtime.ts:truncateDisplay` | 本地2函数 |
| A6 | `runtime-status-presenter.ts` 移除本地 `truncateDisplay`，改为导入 + 调用端预留 ellipsis | `startup-runtime.ts:truncateDisplay` | 本地 `value.slice()` |
| B1 | `task-scroll-state.ts` 改为 delegating wrapper | `transcript-scroll-state.ts` | 本地独立实现 |
| D1 | `workflow-plan-schema.ts` 导出 `PASS_BANNED_EVIDENCE_KINDS` | `workflow-plan-schema.ts` | 本地→导出 |
| D2 | `workflow-agent-runtime-bridge.ts` 移除本地，导入 canon | `workflow-plan-schema.ts` | 本地副本 |
| D3 | `workflow-task-surface.ts` 移除 `PASS_BANNED_KINDS`，导入 canon | `workflow-plan-schema.ts` | 本地不同名副本 |
| E1 | `mcp-index-command-runtime.ts` 移除本地 `redactedPath`，导入 canon | `process-command-runtime.ts` | 本地副本 |

### DEFERRED

| 编号 | 项 | 原因 |
|------|-----|------|
| E2 | `runner-runtime.ts:131` `redactedPath` | 注释标注为 intentional duplicate（avoid circular import），当前无用户可见不一致 |
| - | `fitText` 使用 `"..."`（3字符）未预留截断宽度 | 预存问题，不在本轮范围 |

### NOT-DO

| 编号 | 项 | 原因 |
|------|-----|------|
| C | Message kind / event kind 枚举 | `MessageBlockKind` ↔ `ProductBlockKind` 正交设计已文档化；`EvidenceRecord.kind` ↔ `WorkflowEvidenceKind` 服务不同域 |
| F | MCP/skills/plugins/compact 重复路径 | 审计发现无重复 owner |
| - | 拆 `index.ts` | 用户明确要求本阶段不拆 |
| - | Phase 7.x core file split | 不在本阶段范围 |

## 改动文件列表

```
packages/tui/src/shell/text-utils.ts           — 新增 displayWidth, truncateDisplay
packages/tui/src/startup-runtime.ts            — truncateDisplay 改用 charWidth
packages/tui/src/shell/view-model.ts           — 移除本地CJK，导入text-utils
packages/tui/src/shell/models/footer-view.ts   — 移除本地CJK，导入text-utils
packages/tui/src/job-runtime.ts                — 移除本地truncateDisplay/stripAnsi，导入startup-runtime
packages/tui/src/runtime-status-presenter.ts   — 移除本地truncateDisplay，导入startup-runtime，预留ellipsis
packages/tui/src/shell/models/task-scroll-state.ts — 改为delegating wrapper
packages/tui/src/workflow-plan-schema.ts       — 导出 PASS_BANNED_EVIDENCE_KINDS
packages/tui/src/workflow-agent-runtime-bridge.ts — 导入canon PASS_BANNED
packages/tui/src/workflow-task-surface.ts      — 导入canon PASS_BANNED，移除PASS_BANNED_KINDS
packages/tui/src/mcp-index-command-runtime.ts  — 导入canon redactedPath
```

共11个文件，全部在 `packages/tui/src/` 内。

## 测试与验证

### typecheck
```
corepack pnpm --filter @linghun/tui typecheck  → PASS
```

### focused tests（全部通过）
```
startup-runtime.test.ts:          49/49 PASS
runtime-status-presenter.test.ts:  4/4 PASS
task-scroll-state.test.ts:        18/18 PASS
footer-view.test.ts:              13/13 PASS
workflow-task-surface.test.ts:    19/19 PASS
view-model.test.ts:              318/318 PASS
workflow-agent-runtime-bridge.test.ts: 25/25 PASS (full suite)
workflow-plan-schema.test.ts:     18/18 PASS (full suite)
```

### 已知的已有失败（与本阶段无关）
```
job-runtime.test.ts:              2 failures — D.14D-R P1-5 budget display semantics（已有）
runner-runtime.test.ts:           1 failure — formatApprovedRunnerSpecLine（已有）
ink-interaction-smoke.test.ts:    1 failure — fallback newline keys（已有）
```

## 剩余风险

- `truncateDisplay` 语义变更：启动阶段 runtime 的 `truncateDisplay` 从 `charCodeAt(0) > 0xff` 改为正则 `charWidth`，对 ASCII 结果不变，对 CJK/emoji 结果更准确。所有 60+ 调用点的行为可能对含有 emoji/全角字符的文本发生截断位置变化，但变化方向是更正确。
- `text-utils.ts` 的 `truncateDisplay` 和 `fitText` 截断标记不同（`…` vs `...`），均不预留截断标记宽度，为已有行为。
- `runner-runtime.ts` 的 `redactedPath` 仍为 intentional duplicate。

## 不在本阶段处理的内容

- 拆 `index.ts`
- Phase 7.x core file split
- UI polish 新功能
- provider/model/env 配置修改
- agent/workflow 主链语义修改
- `runner-runtime.ts` redactedPath intentional duplicate

## Handoff Packet

- **下一阶段：** 用户决定
- **禁止事项：** 不得拆 index.ts（用户明确要求）；不得新开框架；不得做 Phase 7.x core split
- **证据引用：** 本阶段测试结果、typecheck 结果均在本文件内
- **验证结果：** typecheck PASS，focused tests 全部通过，无新增失败
- **索引状态：** 未修改索引
- **权限模式：** default（未修改）
- **模型/provider：** 未修改
- **预算使用：** N/A（本地验证，无 API 消耗）
- **明确声明：** 未拆 index.ts

## 参考核对

- 本阶段读取：`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`phase-6.7-full-source-maturity-audit.md`
- CCB 参考：未参考 CCB 源码实现（此为 Linghun 内部重复清理）
- 开源参考：无
- 未复制任何源码实现
