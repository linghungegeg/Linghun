# Phase D.14D — TUI / Input CCB-Parity Product Closure

状态：完成（local/focused validation；未进入真实全量 smoke、未 commit）。
日期：2026-05-31。
范围口径：一次性收尾实测发现的 TUI/input 体验问题；不进入企业微信/钉钉/飞书；不做 provider/env/key/model route 真实逻辑改动；不放松权限语义；不改 D.13U/D.13V anti-hallucination gate 语义；不批量格式化；不删历史 untracked；不 commit。

---

## 1. 阶段目标

收口六类实测体验问题，全部以 CCB 行为为对照，但坚持 clean rewrite（不复制源码）：

- A. 本地自然语言过度截获：普通自然语言必须默认进模型主链。
- B. /btw 成品化：model-backed side question，不污染主任务状态。
- C. 滚动与主屏手感：去噪音 scroll hint、稳定 viewport、activity 位置、统一间距。
- D. Ctrl+O / details 成品化：summary-first 分区详情，不泄漏内部 id/path，不套娃。
- E. Advanced slash command panel 收口：高级命令结构化进 CommandPanel。
- F. Prompt/internal token 泄漏：内部 system-prompt 字段不复述到主屏。

---

## 2. CCB 源码对照证据（behavior-only，未复制实现）

读取的 CCB 源（F:\ccb-source）：

- 输入主链：`src/utils/handlePromptSubmit.ts`、`src/utils/processUserInput/processUserInput.ts`、`src/utils/processUserInput/processTextPrompt.ts`、`src/utils/userPromptKeywords.ts`。
  - `processUserInput.ts:546-550`：唯一分支点是 `inputString.startsWith('/')` → slash dispatch；否则落到 `processTextPrompt`（`:591-602`，`shouldQuery:true`）进模型。
  - `handlePromptSubmit.ts:218-235`：只有硬编码 exit 词（exit/quit/:q）被特判，且只是改派 `/exit`。
  - `userPromptKeywords.ts:4/16` 的关键词表只用于 analytics（`processTextPrompt.ts:59-64` 给 logEvent 打 is_negative/is_keep_going 标记），**不参与路由**。
  - 结论：CCB 没有"自然语言 → 本地命令"关键词截获；plain text 永远进模型。
- /btw：`src/commands/btw/btw.tsx`、`src/utils/sideQuestion.ts`。
  - `sideQuestion.ts:53-102` `runSideQuestion`：调 `runForkedAgent`（真实模型调用），`maxTurns:1`（`:93`），所有工具 deny（`canUseTool` → `behavior:'deny'`，`:86-90`），`skipCacheWrite:true`（`:95`），`querySource:'side_question'`。
  - `btw.tsx:148-149`：fork context 用消息副本（stripInProgressAssistantMessage + getMessagesAfterCompactBoundary），唯一持久状态变更是 usage 计数（`:186-189`）；不进 messages/todo/plan/checkpoint。
  - `btw.tsx:35-123`：底部固定面板；状态 loading（spinner "Answering...", `:107-110`）/ error（`:102-103`）/ answer（Markdown in ScrollBox, `:101-105`）。
- 滚动：`src/hooks/useVirtualScroll.ts`、`src/components/ScrollKeybindingHandler.tsx`、`src/screens/REPL.tsx`。
  - 测量式 viewport：`useVirtualScroll.ts:141` React 级虚拟化 + 真实 Yoga `getComputedHeight()`（`:618-644`）+ spacer Box，无 negative-marginTop trick。
  - scroll-hint 只在 transcript 模式 footer（`REPL.tsx:574` TranscriptModeFooter），不常驻主屏。
  - spinner 在最新消息**之后**（`REPL.tsx:5793-5828`：VirtualMessageList → processing placeholder → spacer → SpinnerWithVerb），不在旧消息上方。
- Ctrl+O：`src/keybindings/defaultBindings.ts:44` `'ctrl+o':'app:toggleTranscript'`；`REPL.tsx:5475-5647` 是独立 transcript 屏（分区/可搜索/可折叠），非 inline 一坨 dump；主屏折叠项带 `(ctrl+o to expand)`（`CtrlOToExpand.tsx:18-30`）。

Linghun 只参考以上**行为**；未复制任何 CCB 源码实现、内部 API 或遥测。

---

## 3. Linghun 修复点与文件列表

### A. 自然语言过度截获（packages/tui/src/index.ts handleNaturalInput）
- 移除三处本地 NL 关键词截获调用点：
  - workspace-trust NL Start Gate（`looksLikeWorkspaceTrustNaturalRequest` + `routeNaturalIntent` + `createPendingNaturalCommand` + `formatNaturalStartGate`）。
  - composite local status 应答（`formatCompositeStatusQuery`）。
  - index safety repair NL 续跑（`handleIndexSafetyRepairContinuation` + `classifyIndexSafetyRepairContinuation`）。
- 删除随之死掉的本地实现：`formatCompositeStatusQuery` / `matchesCompositeStatusKey`（index.ts）；删除孤立模块 `packages/tui/src/index-safety-repair.ts`（其 NL 分类器不再被任何路径调用）。
- 清理 index.ts 死 import：`routeNaturalIntent`、`createPendingNaturalCommand`、`formatNaturalStartGate`、`isWorkspaceTrustNaturalStartGate`、`looksLikeWorkspaceTrustNaturalRequest`、`classifyIndexSafetyRepairContinuation`。
- 保留并未恢复 broad routeNaturalIntent；普通自然语言默认 `return "message"` 进模型。
- 保留的本地处理（明确非"普通自然语言"）：pending approval 的 yes/no/details、pending Start Gate 的精确确认、裸 yes/确认（无 pending 时提示而非发模型）、模型未配置时的 onboarding（state-gated：仅 `shouldOfferUserScopedModelSetup` 为真时）。

### A 配套：index 修复转显式 slash（保留能力，去 NL 截获）
- `/index repair` 新增为显式 slash 子命令（index.ts `handleSlashCommand` 内拦截，调 `runIndexSafetyRepair`，复用 `createIndexSafetyRepairPlan` / `runIndexIgnoreWritePlan` / `executeIndexIgnoreWritePlan` + 权限管道；权限语义不变）。
- 安全门提示文案改为指向 `/index repair`（packages/tui/src/index-result-presenter.ts `formatIndexSafetyWarning` primary + details 两处）。
- `handleIndexSafetyRepairContinuation(text,…)`（NL 分类）改写为 `runIndexSafetyRepair(context,output)`（slash 触发，无 NL 分类；无 active blocker 时给人话提示而非静默 pass）。

### B. /btw model-backed（新增 packages/tui/src/btw-runtime.ts）
- 新模块承载逻辑（index.ts 只做 glue）：`buildBtwMessages`（隔离 system+user，不注入 RuntimeStatus/Evidence/Memory/Capability）、`extractBtwResult`（纯函数，answer/error/空响应降级）、`runBtwSideQuestion`（隔离单轮、`toolChoice:"none"`、无工具、无 continuation）。
- index.ts：`TuiContext` 新增 `modelGateway?` 字段；`runTui` 创建 gateway 后挂上；`handleBtwCommand` 改为：ink 先开 loading 面板 → 调 `runBtwSideQuestion` → answered/error 面板；plain 路径 writeLine 答案/错误。只 append `btw_question` 事件供审计，不写 evidence、不进 completion gate、不改 todo/plan/checkpoint。
- index.ts：`TuiContext` 新增 `shellRerender?` 钩子（runInkShell 启动后挂上）；`handleBtwCommand` 在 await 模型前调用它刷一帧 loading，否则单次 handler 内 loading 态不可见。
- packages/tui/src/shell/components/BtwPanel.tsx：副标改为"临时插问 · 不影响主任务"，新增 loading 帧渲染（"正在询问模型…"），文档注释更新为 model-backed。

### C. 滚动 / activity / 间距（render agent 在 worktree 实现，已集成主树）
- 新增 packages/tui/src/shell/components/ScrollViewport.tsx：测量式、夹紧的 viewport（标准 ink，无第三方 ScrollBox；诚实记录 ink 不做行级 culling，用测量+夹紧的有界 translate + overflow=hidden）。
- packages/tui/src/shell/models/task-scroll-state.ts：新增 `clampTaskScroll(state,maxOffset)`，把 offset 夹到 [0,maxOffset]，回填 hasOverflow。`reduceTaskScroll` 签名/行为保持向后兼容。
- packages/tui/src/shell/components/ShellApp.tsx：
  - C2：transcript 改用 `<ScrollViewport>` 包裹，替换无界 `marginTop={-scrollOffset}`。
  - C3：ActivityIndicator 渲染在 blocks **之后**（对话流底部），不再压在旧消息上方。
  - C1：删除主屏常驻 scroll hint 行与 `scrollHintText`。
  - C4：transcript 块间距统一由 ProductBlock marginBottom 负责，ShellApp 不再双加。

### D. Ctrl+O summary-first 详情（packages/tui/src/command-panel-runtime.ts buildToggleDetailsCommandPanel）
- 主屏（summary + sections）只显示人话计数/kind 分布；内部 id/kind/source/完整正文只进 detailsText（Ctrl+O 展开层）。
- 分区：最近输出 / 证据 / 后台。
- 默认 `expanded:false`（summary-first）：首次 Ctrl+O 看摘要，再按一次（既有 tier-1 toggle）才展开；既有"连续 Ctrl+O 不套娃""不污染 lastFullOutput"逻辑保持（index.ts toggle-details 4-tier、handleDetailsCommand suppressLastFullOutputCapture）。

### E. Advanced slash CommandPanel 收口
- 把高级 slash 命令中"会 dump 大段诊断/报告正文"的子命令从裸 `writeLine(output, formatXxx)` 改为 `showCommandPanel(context, output, { summary:[人话摘要], detailsText: formatXxx })`。
- 关键保证：`showCommandPanel` 在 non-ink（plain TUI / 测试）下写 `detailsText` 原文 → plain-mode 输出 byte-identical，既有字符串断言不破；只有 ink 主屏得到 summary-first 卡片（Ctrl+O 展开完整正文）。
- 迁移文件与子命令：
  - `model-command-runtime.ts`：/model doctor、/model route、/model route doctor。
  - `mcp-index-runtime.ts`：/mcp doctor、/mcp validate、/index doctor、/index check、/index search、/index architecture。**不迁移** `runIndexRepository` 的流式进度行（"索引刷新：正在执行..."）与错误行。
  - `memory-command-runtime.ts`：/memory storage、review、stats、learn run。
  - `job-agent-command-runtime.ts`：/job status、/job report、/job logs、/agents（list）、/agents show。lifecycle 短状态（pause/resume/cancel 的 formatJobPrimary）保持 writeLine。
  - `extension-slash-runtime.ts`：/skills doctor、/skills validate、/plugins doctor、/plugins validate。
  - `remote-command-runtime.ts`：/remote doctor、/remote setup、/remote test、/remote disable。
- 新增 source-invariant 测试 `packages/tui/src/advanced-slash-panel-invariant.test.ts`：静态读源码，锁定上述 formatter 调用必须进 `detailsText:` 而非裸 `writeLine(output, …)`，并显式断言 /index 流式进度行不被面板化（防止未来回退）。
- 集成说明：E 在隔离 worktree（baseline commit）实现；其中 `job-agent-command-runtime.ts` 在 baseline 缺少本仓库未提交的 D.14C agent-failure 接线，故未整体拷贝，而是把 E 的 5 处面板迁移手工套到主树（保留 D.14C failAgent / captureFailureLearning 接线）。其余 5 个文件 + invariant test 直接采用 E 版本（主树 HEAD 干净，无冲突）。

### F. Prompt/internal token 泄漏（packages/tui/src/model-prompt-runtime.ts）
- 新增 `PromptHygieneRule` system-prompt 指令：内部字段标签（RuntimeStatusForModel / ControlledMemorySummary / MemoryBoundary / EvidenceSummary / CommandCapabilitySummary / SolutionCompleteness / FreshnessRule / FailureLearningSummary 等）仅供模型推理，禁止复述到用户；要 raw 细节引导用户走 /model doctor、/status、/details。
- 新增 `sanitizeMainScreenLeakage(text,language)`（纯函数）：若模型把内部字段标签原样复述（`Token=`/`Token:` 行或裸 token），整行降级并附人话提示。
- index.ts：`sendMessage` 与 `continueModelAfterToolResults` 在 assistant 文本提交前调用 sanitizer，并 `replaceAssistantBlockContent` 同步 ink block + lastFullOutput。
  - 说明：plain-mode（MemoryOutput）的流式字节到达即写出，无法事后撤回；mode-independent 的保证落在已提交 transcript 与 ink block fullText（ink 主屏的真实渲染源），与既有 D.13U 降级 gate 行为一致。
- 不删除 doctor/details 诊断能力；内部字段仍可经 /model doctor、/details 显式查看。

---

## 4. 本地 NL 截获：移除 / 保留清单与理由

| 截获点 | 处置 | 理由 |
| --- | --- | --- |
| workspace-trust NL（"信任这个项目"/"trust this folder"） | 移除 | 普通自然语言；要调整信任用 `/trust` slash。 |
| composite local status（"索引和记忆 MCP 打开了吗"） | 移除 | 普通自然语言；综合状态用 `/doctor`、`/status`、`/index status`。 |
| index safety repair NL 续跑（"把这些文件加入 ignore 后刷新索引"） | 移除 NL 触发，能力转 `/index repair` slash | 能力保留（ignore 写入仍走权限管道），但不靠关键词把普通自然语言转 slash。 |
| pending local approval 的 yes/no/details | 保留 | 真正的 pending confirmation/approval，非普通自然语言。 |
| pending Start Gate 的精确确认 | 保留 | 真正的 pending gate；危险动作仍需精确确认。 |
| 裸 yes/确认（无 pending） | 保留（提示不发模型） | 无 pending 时把孤立确认词误发模型无意义；给人话提示。 |
| 模型未配置时 onboarding（looksLikeModelSetupInput） | 保留 | state-gated：仅当 `shouldOfferUserScopedModelSetup` 为真（无可用 provider）才触发；模型配好后此路径永不触发，普通自然语言照常进模型。新手安全配置路径。 |

未恢复 broad `routeNaturalIntent`，未新增任何 narrow keyword adapter。

---

## 5. 各项修复说明

### B. /btw 行为矩阵

| 场景 | 行为 |
| --- | --- |
| `/btw <question>`（ink，provider 正常） | loading 面板 → 隔离单轮模型调用（无工具）→ answered 面板（答案）。 |
| `/btw <question>`（plain） | 调模型 → writeLine 答案。 |
| provider 失败 | error 面板/行可见（含 provider 错误信息）；不写 evidence、不进 gate。 |
| 空响应（仅 thinking / 无文本） | 降级为可见 error 提示，不冒充答案。 |
| gateway 不可用 | 可见降级提示，不假装答案。 |
| 状态污染 | 不改 todo/plan/checkpoint/job/permission；不写 evidence；不进 D.13U/D.13V completion gate；只记 `btw_question` 事件供 /details 审计。 |
| 空问题 | 用法提示。 |

### C/D/F 见 §3 对应小节。

---

## 6. 验证结果

（命令均通过 `corepack pnpm`；plain `pnpm` 不在 PATH。）

- `corepack pnpm --filter @linghun/tui exec tsc --noEmit` → PASS（exit 0，A-F 集成后）。
- `vitest run src/btw-runtime.test.ts` → PASS（btw-runtime 纯函数）。
- `vitest run src/model-prompt-runtime.test.ts` → PASS（sanitizer 纯函数）。
- `vitest run src/index.test.ts -t "D.14D"` → 27/27 PASS。
- `vitest run src/index.test.ts src/advanced-slash-panel-invariant.test.ts`（集成 E 后）→ 387/387 PASS。
- `vitest run src/shell/view-model.test.ts` → 273 PASS（含新增 D.14D Ctrl+O summary-first 用例）。
- `vitest run src/shell/models/task-scroll-state.test.ts` → PASS（含 clamp 用例）。
- `vitest run src/dist-integrity.test.ts` → 4/4 PASS（确认删除 index-safety-repair.ts 未破坏 dist 模块图）。
- 全量 `corepack pnpm --filter @linghun/tui exec vitest run`（A-F 全部集成后）→ **47 files, 1920/1920 PASS, 0 failed**。
- `corepack pnpm --filter @linghun/tui build` → Build success。
- `corepack pnpm --filter @linghun/cli build` → Build success。
- `git diff --check` → 干净（exit 0）。

---

## 7. 明确未做（not-do）

- 不实现/改动企业微信、钉钉、飞书远程通道。
- 不改 provider / env / key / model route 的真实逻辑。
- 不新增权限模式，不放松 pending approval / resource guard / report guard / final answer gate / 四档权限语义。
- 不改 D.13U / D.13V anti-hallucination gate 语义；/btw、details、UI 状态不进 evidence 冒充验证事实。
- 不做无关 UI 大改版；ScrollViewport 用标准 ink 测量，不自研终端渲染器。
- 不批量格式化；不删除历史 untracked；不 commit。

---

## 8. 开发者排查入口

- 自然语言路由：`packages/tui/src/index.ts` `handleNaturalInput`（普通文本 `return "message"`）。
- /index repair：`handleSlashCommand` 内 `/index` 分支 → `runIndexSafetyRepair`。
- /btw：`packages/tui/src/btw-runtime.ts` + `handleBtwCommand`。
- 滚动：`packages/tui/src/shell/components/ScrollViewport.tsx` + `shell/models/task-scroll-state.ts` `clampTaskScroll`。
- Ctrl+O 详情：`packages/tui/src/command-panel-runtime.ts` `buildToggleDetailsCommandPanel` + index.ts `toggle-details` 4-tier。
- prompt 卫生：`packages/tui/src/model-prompt-runtime.ts` `PromptHygieneRule` + `sanitizeMainScreenLeakage`。

---

## 9. 参考核对

- 实际读取的 Linghun 文档：`docs/delivery/README.md`、本阶段相关源码（index.ts、natural-command-bridge.ts、model-prompt-runtime.ts、shell/* 等）。CLAUDE.md（全局 + 项目）工作规则。
- 实际参考的 CCB 文件（行为参考，见 §2）：handlePromptSubmit.ts、processUserInput.ts、processTextPrompt.ts、userPromptKeywords.ts、sideQuestion.ts、btw.tsx、useVirtualScroll.ts、ScrollKeybindingHandler.tsx、REPL.tsx、CtrlOToExpand.tsx、defaultBindings.ts。
- 只作为行为参考：CCB 的输入分支点、/btw 隔离单轮+无工具+不污染、测量式 viewport、spinner 位于对话流底部、Ctrl+O 分区折叠。
- 进入 Linghun 自研实现：ScrollViewport（标准 ink 测量+夹紧）、btw-runtime（基于现有 ModelGateway）、sanitizeMainScreenLeakage、buildToggleDetailsCommandPanel summary-first 重构。
- 明确未复制任何 CCB 可疑源码实现、反编译痕迹、内部 API 或专有遥测。

---

## 10. 成品级结构化 handoff packet

- 下一阶段：由用户确认；本阶段停在 D.14D 边界，不自动进入下一阶段。
- 禁止事项：见 §7。
- 证据引用：本仓库 packages/tui/src 改动文件（§3）；测试见 §6。
- 验证结果：tsc PASS；D.14D 27/27 PASS；index.test.ts + invariant 387/387 PASS；全量 vitest **1920/1920 PASS（47 files, 0 failed）**；TUI/CLI build PASS；dist-integrity 4/4 PASS；`git diff --check` 干净。
- 索引状态：未触发 index rebuild/force；本阶段未依赖外部 MCP 索引。
- 权限模式：四档语义不变；/index repair 的 ignore 写入与既有路径一致走 decidePermission。
- 模型 / provider：未改真实 provider/route/key/env 逻辑；/btw 复用当前 executor runtime。
- 预算：本阶段为本地源码改动 + focused 测试，无真实 provider 调用预算消耗。
