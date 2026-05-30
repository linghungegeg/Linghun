# Phase 14D-R — Interaction Real Smoke Repair Closure

## 阶段目标

修复 D.14D 后真实实测暴露的交互阻塞问题，把权限提权、索引刷新、Ctrl+O、footer、高级面板、上下文长度/预算语义、自动模式输出做成成品交互。不做新功能开发，不做大 UI 改版，只修阻塞用户实测的小交互问题。完成后停在阶段边界，不 commit。

## 已完成功能（P0–P2）

| 编号 | 问题 | 状态 |
|------|------|------|
| P0-1 | 权限提权 UI 退化成普通文本 | 已修复 |
| P0-2 | "更新索引"权限/工具主链矛盾 | 已修复 |
| P1-1 | Ctrl+O 重复提示 | 已修复 |
| P1-2 | 索引 footer 状态不更新（`索引?`） | 已修复 |
| P1-3 | auto-review 输出不成熟 + 工具轮次耗尽红框 | 已修复 |
| P1-4 | 高级面板空框观感 | 已修复 |
| P1-5 | "预算"语义误导（默认不设预算） | 已修复 |

## 每个问题：源码根因 + 修复位置

### P0-1 权限提权 UI 退化成普通文本

**源码根因**：
- `packages/tui/src/index.ts` `executeModelToolUse`：`permission.decision !== "allow"` 分支无条件 `writeLine(formatModelToolPermissionPrompt(...))`，即使 ink shell 已能通过 `mapPendingApprovalToPermission → view.permission → PermissionPanel` 渲染，导致主屏出现"Linghun 想执行 …？yes / no"普通文本。
- `runIndexIgnoreWritePlan`：同样无条件 `writeLine(formatLocalToolPermissionPrompt(...))`。
- `packages/tui/src/shell/view-model.ts` `mapPendingApprovalToPermission`：只映射 `model_tool_use` / `architecture_drift`，`index_ignore_write` 返回 `undefined`，PermissionPanel 不渲染。

**修复位置**：
- `index.ts` `executeModelToolUse`：ask-with-panel 路径下，仅当 `!(context.isInkSession && isAskWithPanel)` 才 writeLine 文本；ink 只设 `pendingLocalApproval`，由 PermissionPanel 渲染。
- `index.ts` `runIndexIgnoreWritePlan`：`ask` 分支 writeLine 改为 `!context.isInkSession` 才执行。
- `view-model.ts` `mapPendingApprovalToPermission`：新增 `index_ignore_write`（Write 语义）、`index_tool`（IndexRefresh/IndexRepair）映射，渲染 PermissionPanel。
- plain TUI / 非交互 / 测试仍走文本 yes/no fallback（保留既有断言）。

**权限面板路径说明**：
`decidePermission` → `permission.decision === "ask"` → `context.pendingLocalApproval = {...}` → `mapPendingApprovalToPermission(context)` → `view.permission` → `ShellApp` 互斥渲染 PermissionPanel（Composer 内 PermissionControl card）。yes/no/details 仍由 `handleNaturalInput` pending approval 分支兼容确认，但视觉来源是 pending permission panel。

**Source invariant**：`packages/tui/src/permission-panel-invariant.test.ts` 锁定：模型工具提示 writeLine 必须在 `!isInkSession` 守卫后、index ignore-write writeLine 同样守卫、ask 路径必须设 `pendingLocalApproval`。

### P0-2 "更新索引"权限/工具主链矛盾

**源码根因**：
- `packages/tui/src/mcp-index-runtime.ts` `executeExtraTool`：mutating codebase-memory 工具（`index_repository`）经 `ExecuteExtraTool` 被**硬拒绝**，回文案"请用 /index refresh"。模型只能用文本解释"不能更新"，又继续探索，最终工具轮次耗尽——这是"说不能更新但又继续探索"前后矛盾的根因。
- 默认模式下没有结构化工具表达索引意图，模型只能文本冒充或被本地 NL 拦截（已在 D.14D 移除）。

**修复位置**：
- 新增 `packages/tui/src/index-tool-runtime.ts`（仿 `git-tool-runtime.ts` 范式）：定义 `IndexStatusInspect`（只读）/ `IndexRefresh` / `IndexRepair`（mutating）三个结构化 model tool schema + input 解析 + 人话结果摘要。
- `packages/tui/src/model-loop-runtime.ts` `createModelToolDefinitions`：附加 `createIndexToolDefinitions()`（与 built-in / Git 工具同级）。
- `index.ts` `executeModelToolUse`：在 builtInTools 分支前加 `isIndexToolName` 分派到 `executeIndexToolUse`。
- `index.ts` `executeIndexToolUse` / `executeApprovedIndexToolUse`：Inspect 只读直接执行（不重建，记 `index_status_inspect` evidence）；Refresh/Repair 走 `decidePermission("Write")` → default/auto-review `ask` → `pendingLocalApproval{ kind:"index_tool" }` → PermissionPanel → 用户确认后复用 `runIndexRepository` / `runIndexSafetyRepair` 真实执行，记 `index_refresh`/`index_repair` evidence，回灌工具结果续轮。
- `index.ts` `executePermissionApprove` / `executePermissionDeny`：新增 `index_tool` 分支；拒绝回灌 `"...; the index was NOT refreshed."`，让 final answer 不能声称已刷新。
- `mcp-index-runtime.ts`：`ExecuteExtraTool` mutating 拒绝文案改人话，指向结构化工具 IndexRefresh/IndexRepair（不再只甩 slash）。

**索引结构化 tool 主链说明**：
普通自然语言（"更新一下索引"）→ 仍进模型（未恢复 NL 关键词截获）→ 模型调用结构化 `IndexRefresh` 工具 → 默认模式进 PermissionPanel → 用户确认 → 复用受控 `/index refresh` 能力（`runIndexRepository`）→ 真实刷新 → evidence + 续轮。`IndexStatusInspect` 明确标注"仅检查，未刷新"，区分"已真实刷新 / 只检查了状态 / 没执行索引动作"。不写第二套索引系统。

### P1-1 Ctrl+O 重复提示

**源码根因**：
- `packages/tui/src/tool-output-presenter.ts`：`createSummaryFirstPreview` 正文内嵌一行折叠提示，`formatToolOutput` 又通过 `formatDetailsHint` 追加一行——同一块两次。
- `view-model.ts` `createOutputBlock`：ink block 再通过 `nextAction`（detailsHint）加第三处。

**修复位置**：
- `tool-output-presenter.ts`：`formatToolOutput` 仅当 preview 未含折叠提示时才补一行；`createSummaryFirstPreview` 复用 `formatDetailsHint` 单一字符串来源。
- `view-model.ts` `createOutputBlock`：新增 `stripEmbeddedFoldHint`，剥离正文内嵌折叠提示行，命中即视为显式折叠强制挂单一 `nextAction`。ink 主屏 Ctrl+O 提示统一由 `nextAction` 渲染。
- plain 模式（非 TTY）读 raw `output.text`，内嵌提示保留，既有断言不破。

### P1-2 索引 footer 状态不更新

**源码根因**：
- `packages/tui/src/shell/models/footer-view.ts` `formatFooterIndexLabel`：status 为 `unknown`/空时显示 `索引?`（首屏 unknown 是预期的）。
- `mcp-index-runtime.ts` `runIndexRepository`：`index_repository` 成功后调 `refreshIndexStatus`，若 `list_projects`/`index_status` 读回延迟（`findCurrentIndexProject` 未命中）会回落 `missing`，footer 又显示 `索引?`——"刷新后仍 `索引?`"的根因。

**修复位置**：
- `mcp-index-runtime.ts` `runIndexRepository`：`index_repository` 成功后，若 `refreshIndexStatus` 回落 `missing`/`unknown`/`error`，升级为成熟态 `stale` + `staleHint`（"索引已刷新，状态待确认"）+ `indexedAt`；确认到 `ready`/`stale` 时保留真实状态。
- 首屏未检测的 `索引?` 是预期信号，不改（既有测试锁定）。

### P1-3 auto-review 输出不成熟 + 工具轮次耗尽

**源码根因**：
- `tui-permission-runtime.ts` `decidePermission`：auto-review 拒绝文案"auto-review 不自动允许 Bash、高风险或越界操作"是工程话。
- `index.ts` 工具轮次耗尽（`round === MAX_MODEL_TOOL_ROUNDS - 1`）：文案"将不再调用工具，并请求模型给出最终回答"机械。

**修复位置**：
- `tui-permission-runtime.ts`：auto-review 拒绝改人话——"自动模式会自动通过低风险动作；Bash、联网、未知命令和高风险操作仍按权限策略确认或拒绝。"
- `index.ts`（两处轮次耗尽）：改成熟摘要——"本轮工具调用已达上限，将基于目前已收集的信息给出回答……如果还有动作需要完成（例如刷新索引），请运行对应命令（如 /index refresh）或重新发起请求。"权限结论由 runtime 输出，不让模型猜策略。
- provider 失败原因区分（gateway/timeout/schema/reasoning）由既有 `formatProviderFailurePrimary` 承担，轮次耗尽不甩 `/model doctor`。

### P1-4 高级面板观感

**源码根因**：
- `packages/tui/src/shell/components/CommandPanel.tsx`：title Text 恒渲染 `❯ ${panel.title}`，空 title 也画框——顶部"空框"。
- `view-model.ts`：commandPanel 不是 viewMode task 触发条件，命令面板可能停留 Home 不渲染。

**修复位置**：
- `CommandPanel.tsx`：`panel.title` 为空/空白时不渲染标题行。
- `view-model.ts`：`hasCommandPanel` 加入 effectiveViewMode task 触发条件，让高级面板进 TaskLayout 渲染。
- details 仅在 `panel.expanded` 才展开，与主屏 summary/sections 分层（既有结构），不套娃。

### P1-5 "预算"语义：默认不设预算

**源码根因**：
- `index.ts`：上下文长度安全保护误称"上下文预算超限"（`Context budget exceeded`），把 Linghun 人工保护阈值 `MAX_CONTEXT_CHARS=48000` 当作用户预算。
- `job-runtime.ts` `parseJobRunOptions`：默认写入 `maxTokens`/`maxSteps`/`timeoutMs`，UI 始终显示默认 max，给没设预算的用户假预算。

**修复位置**：
- `index.ts`：上下文长度文案改名（不叫"预算"）——"当前上下文长度超过此模型/provider 可承载范围，已在请求 provider 前停止：N/M 字符。请运行 /sessions summary 或减少最近上下文后重试。"（这是 context safety limit，非 budget）。
- `job-runtime.ts`：`ParsedJobRunOptions` 加 `budgetExplicit{ tokens/steps/runtime }`，仅当用户显式传 `--tokens`/`--max-steps`/`--timeout` 才为 true。
- `tui-data-types.ts`：`DurableJob.budget` 加 `explicit?` 标志。
- `job-agent-command-runtime.ts`：token/maxSteps/runtime enforcement 全部 gate 在 `budget.explicit?.x === true`；默认（maxSteps=4=plan 步数）while 自然终止，行为保持。
- `job-runtime.ts` `formatJobBudgetLine`：未显式设置时显示 `budget(预算：未设置)` + `tokens=N/未设置`，不展示默认 max。

**预算/上下文长度语义边界**：
- "预算"只指用户主动设置（`/job --tokens`/`--max-steps`/`--timeout`）。默认 `/job` 无用户可见预算，enforcement 不触发，UI 显示"预算：未设置"。
- 上下文长度保护是 context safety limit，不叫 budget，独立于用户预算。

## 涉及模块

- `packages/tui/src/index.ts`（权限路径、索引工具分派/执行/审批、上下文长度文案、轮次耗尽文案）
- `packages/tui/src/index-tool-runtime.ts`（**新增** 结构化索引工具 schema/解析/摘要）
- `packages/tui/src/model-loop-runtime.ts`（工具定义附加索引工具）
- `packages/tui/src/tui-permission-runtime.ts`（auto-review 文案）
- `packages/tui/src/mcp-index-runtime.ts`（footer 成熟态、ExecuteExtraTool 拒绝文案）
- `packages/tui/src/tool-output-presenter.ts`（Ctrl+O 去重）
- `packages/tui/src/shell/view-model.ts`（折叠提示剥离、permission 映射、viewMode 触发）
- `packages/tui/src/shell/components/CommandPanel.tsx`（空 title 不渲染框）
- `packages/tui/src/pending-details-presenter.ts`（index_tool details）
- `packages/tui/src/job-runtime.ts` / `job-agent-command-runtime.ts` / `tui-data-types.ts`（预算语义）

## 命令 / 使用方式

- 自然语言"更新一下索引" → 模型调用 `IndexRefresh` 结构化工具 → 默认模式出权限面板 → 确认后真实刷新。
- `IndexStatusInspect`（模型只读查看状态）；`/index status`/`/index refresh`/`/index repair` slash 仍可用。
- `/job run <goal>`（默认无预算）；`/job run <goal> --tokens N --max-steps N --timeout MS`（显式预算才 enforce）。

## 配置项

无新增配置项。复用 `config.index.mode`、`MAX_CONTEXT_CHARS`、`DEFAULT_JOB_*`。

## 测试与验证

新增/更新 focused tests：
- `permission-panel-invariant.test.ts`（P0-1 source invariant，3）
- `index.test.ts`：P0-1 ink repair、P0-2 IndexRefresh approve/deny、P1-2 footer、P1-3 轮次耗尽、auto-review 文案更新
- `shell/view-model.test.ts`：P1-1 Ctrl+O 去重、P0-1 index_ignore_write 映射、P1-4 空 title 渲染
- `model-loop-runtime.test.ts`：P0-2 索引工具 schema
- `job-runtime.test.ts`：P1-5 budgetExplicit + 预算显示语义

验证命令结果：见下方"验证结果"。

## 真实 smoke 结果

（见 handoff packet 下方"真实 smoke"小节。）

## 已知问题 / 不在本阶段处理

- plain 模式 streaming 字节已写出不可撤回（D.14D 既有限制，未变）。
- 首屏未检测索引仍显示 `索引?`（预期信号，非 bug）。
- IndexRefresh/IndexRepair 仅复用现有 `/index` 受控能力，未引入新索引系统。

## 下一阶段衔接

D.14D-R 后若需进一步交互打磨，应基于真实 smoke 反馈继续，仍按阶段闸门推进。

## 参考核对

- **本阶段实际读取的 Linghun 文档**：本仓库 `CLAUDE.md`（项目规则）、auto-memory（feedback/project 记忆）。
- **本阶段实际参考的 CCB 行为**（仅行为参考，未复制实现）：`F:\ccb-source\src\utils\processUserInput\processUserInput.ts`（plain text 永远进模型，唯一分支是 `/` 前缀，确认未恢复 NL 截获）、`F:\ccb-source\src\components\CtrlOToExpand.tsx`（单一 Ctrl+O hint 来源）、permissions / DiagnosticsDisplay（提权面板 vs 文本、details 展开行为）。
- **行为参考 vs 自研实现**：CCB 只作为交互体验/边界参考；Linghun 的 PermissionPanel、index-tool-runtime、budget 语义均为自研，复用既有 `runIndexRepository`/`decidePermission`/`pendingLocalApproval` 管道。
- **未复制可疑源码实现**：确认未复制 CCB 源码、反编译痕迹、内部 API 或专有逻辑。

## 成品级结构化 handoff packet

- **下一阶段**：由用户确认是否进入；当前停在阶段边界，未 commit。
- **禁止事项（本阶段已遵守）**：未改 provider/env/key/model route 真实选择逻辑；未放松权限安全边界；未恢复本地自然语言关键词截获；未改 D.13U/D.13V anti-hallucination gate 语义；未进入企业微信/钉钉/飞书远程通道；未批量格式化；未删除历史 untracked；未 commit；未做大 UI 改版。
- **证据引用**：源码根因见上方各问题"源码根因"小节（含具体函数名）。
- **验证结果**：见"验证结果"小节。
- **索引状态**：本仓库 codebase-memory 项目名 `F-Linghun`；本阶段以 `rg`/精读源码为主定位，未触发慢重建/force。
- **权限模式**：本阶段开发未改默认权限模式；新增 IndexRefresh/IndexRepair 在 default/auto-review 走 ask（PermissionPanel 确认）。
- **模型/provider**：未改路由；测试用 mock provider。
- **预算使用**：开发期无 token 预算约束；新增 `/job` 默认无用户可见预算语义。

## 验证结果

- `tsc --noEmit`：PASS（exit 0）
- `vitest run src/index.test.ts -t "D.14D"`：34 passed
- `vitest run src/shell/view-model.test.ts src/shell/models/task-scroll-state.test.ts src/advanced-slash-panel-invariant.test.ts src/model-prompt-runtime.test.ts`：324 passed
- `vitest run src/permission-panel-invariant.test.ts`：3 passed
- `vitest run src/job-runtime.test.ts src/job-runner-presenter.test.ts src/runner-runtime.test.ts`：66 passed
- `vitest run src/model-loop-runtime.test.ts`：124 passed
- 全量 `vitest run`：**48 files / 1938 tests passed**（exit 0）
- TUI build：PASS（`dist/index.js` 1.02 MB，Build success）
- CLI build：PASS（`dist/main.js` 16.74 KB，Build success）
- `git diff --check`：clean（exit 0）

## 真实 smoke（基于自动化复现，最多 7 项）

1. default 模式自然语言"更新一下索引" → 模型触发结构化 `IndexRefresh` 工具 → 权限确认 → yes → 真实 `index_repository` → `index_operation` evidence（自动化测试 `P0-2 model IndexRefresh tool routes through permission panel and refreshes after approval` 覆盖）。
2. `IndexRefresh` 拒绝 → 无 `index_repository`，回灌模型 `"...; the index was NOT refreshed."`（`P0-2 ... denied → no index_repository, model told NOT refreshed` 覆盖）。
3. default 模式 Bash/index 提权：ink 不再 writeLine 文本，pendingLocalApproval + PermissionPanel（`P0-1 /index repair in ink mode sets pendingLocalApproval and does not leak prompt text` + source invariant 覆盖）。
4. Ctrl+O：同一输出块 fullText+nextAction 合计仅一次 `Ctrl+O`（`P1-1` zh/en 覆盖）。
5. 索引刷新成功后 footer 不再 `索引?`：读回延迟显示成熟 stale+staleHint，确认时显示 ready（`P1-2` 两例覆盖）。
6. 高级面板：空 title 不渲染 `❯` 空框，有 title 正常渲染（`P1-4` ink 渲染两例覆盖）。
7. 上下文过长文案不含"预算"，改"上下文长度/模型输入上限"；`/job` 默认显示"预算：未设置"，显式才 enforce（`P1-5` parse + 显示语义覆盖）。

注：以上 smoke 通过自动化测试复现真实代码路径；交互式终端 smoke（真实 TTY 手测）建议在 commit 前由用户在本机跑一次确认观感。
