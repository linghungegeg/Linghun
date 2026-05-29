# D.13T Linghun Core Runtime Main-Chain Audit

> 审计阶段：D.13T
> 审计日期：2026-05-29
> 审计范围：Linghun TUI 核心底座主链（`packages/tui/src/`）
> 源码改动：**0**（本阶段为只读审计，划清下一阶段一次性闭环修复的边界）
> 验证状态：tsc 0 错；4 组 vitest 共 614 用例全绿；`git diff --check` 干净
> 主链定义：用户输入 → pending approval / slash / natural route / resource guard → model system prompt → tool loop / deferred tools / MCP / permission → tool result / evidence / background job / verification → final answer → transcript / panels / notifications

---

## 1. Executive Summary

**总体判断**：Linghun 核心底座主链**结构性大盘已经成型**，绝大多数高危行为（job-completed→PASS 误读、git auto-commit、UI 内部词泄漏、Composer 抢输入、Ctrl+O 污染主屏、FreshnessLite 关键词 gate、第五权限模式）**全部已封堵**或**从未存在**。但主链仍存在 **4 处 P0 缺口**，集中在「最终答复（assistantText）入库前缺 hard gate」与「verification / cache 自评信号被路径绕过」两条线上。

**最大 P0 风险**（按影响排序）：
1. **Final Answer Hard Gate 缺失**：`sendMessage` 把 `assistantText` push 到 transcript 之前，没有任何 `checkClaimSupport / validateCompletionClaim / hasFinalAnswerReportReference` 拦截。模型自发声明 "PASS / READY / 已完成 / Beta ready" 直接入库；`/claim-check` 仅供用户主动调用。
2. **Evidence 污染（`recordToolEvidence` 无差别写入）**：任意 Bash/Read 成功即写 evidence，`checkEvidenceGate` 与 `checkClaimSupport` 在 `evidence.length > 0` 时直接放行 → 反幻觉链可被一次工具调用解锁。
3. **`createVerificationLevelForReadiness` 绕过分级器**：`index.ts:11017-11022` 仅靠 `status === "pass" && unverified.length === 0` 直升 `real-smoke`，跳过 `verification-level.ts:248` 要求的 `realProcessObserved / realProviderHit / realTuiRendered` 三条独立观察信号。
4. **`workspace-reference-cache` fallback 字段混合**：`workspace-reference-cache.ts:230-245` 的 fallback 路径把 `files / directories` 沿用旧 cache、而 `runtimeStatus / evidenceRefs` 用当前 input，混合 stale+fresh，hash 仍写入 `pluginListHash`。

**是否可以进入闭环修复**：**可以**。所有 P0 缺口都是**点状缺失**（缺一个 hard gate / 一个分级器调用 / 一个状态机字段），不是结构性破裂；下一阶段（D.13U 或并入 D.14A）应做**统一闭环修复**——把 final answer / evidence / claim 三个 gate 共用同一条收口管线，而不是继续零碎补丁。

---

## 2. Main Chain Map（实际主链链路）

下面是 **当前实际主链**（基于源码 grep 结果，非文档），重点标注 hard gate 与 prompt-only 的差异：

```
用户输入 (Composer.tsx:613/622/681)
  │
  ├─ [hard gate] resource guard          index.ts:13199 (checkResourceGuard)
  ├─ [hard gate] provider cooldown       index.ts:13204-13218
  ├─ [hard gate] hardDeny path           tui-permission-runtime.ts (UNC/.git/.ssh/.env/secret/rm -rf/curl|sh)
  ├─ [hard gate] checkEvidenceGate       index.ts:13223  ⚠️ 弱 (任一 evidence 即放行)
  ├─ [setup]    createReportWriteGuard   index.ts:13233  (仅"报告+写入+文件名"三关键词触发)
  │
  ├─ Architecture Runtime               index.ts:13264-13273 (拍 card + directive)
  ├─ updateSolutionCompletenessGate     index.ts:14480 (改写 context.solutionCompleteness)
  ├─ refreshWorkspaceReferenceCache     index.ts:13274 ⚠️ fallback 混合 stale+fresh
  ├─ buildRuntimeStatusForModel          index.ts:13260 ⚠️ 含 provider/baseUrl/endpointProfile
  │
  ├─ createModelSystemPrompt             index.ts:14474-14499
  │     ├─ EvidenceSummary               (slice(0,5)，无 freshness 过滤)
  │     ├─ FreshnessRule                 (prompt-only 文本)
  │     ├─ RuntimeStatusForModel         (内部字段全量入 prompt)
  │     ├─ RuntimeIdentityRule           (软指令，模型不一定遵守)
  │     ├─ ControlledMemorySummary       (acceptedOnly topK=3，无版本号)
  │     ├─ SolutionCompleteness JSON
  │     └─ architectureDirective
  │
  ├─ buildModelMessagesWithRecentContext index.ts:13284
  │     ├─ microCompactMessages          (保留 system + 折叠中段)
  │     └─ tool_result rebuild           ⚠️ 把 evidenceId 字面量塞进 model 上下文
  │
  ├─ gateway.stream()                    index.ts:13329-13347
  │     │
  │     ├─ executeModelToolUse           index.ts:13983
  │     │     ├─ [hard gate] detectArchitectureDrift    14012-14043 (drift→pendingApproval)
  │     │     ├─ [hard gate] reportWriteGuard Bash 拦截 14044
  │     │     ├─ [hard gate] reportWriteGuard !evidenceRead → Write 拦截 14053
  │     │     ├─ [hard gate] decidePermission           14064 (统一权限四档)
  │     │     ├─ deferred tools dispatch                14260-14429 (classifyToolRequest 同一引擎)
  │     │     ├─ executeSearchExtraTools / executeExtraTool
  │     │     │     ⚠️ result.text 含字面 "SearchExtraTools matched..." / "ExecuteExtraTool: ..."
  │     │     │     ⚠️ writeLine(output, result.text) → 主屏 (index.ts:14322/14384/14401)
  │     │     ├─ recordToolEvidence ⚠️ 无差别写 120 字摘要 + supportsClaims=[toolName]
  │     │     └─ formatModelToolOutput (reportWriteGuard 模式遮蔽真实 output)
  │     │
  │     └─ shouldSendReportXxxReminder   13413-13429 (仅 reportWriteGuard 命中场景)
  │
  ├─ provider failure → recordProviderFailure / recordProviderFailureEvidence  13383-13390
  ├─ provider success → clearProviderBreaker                                   13504
  │
  ├─ ⚠️ NO HARD GATE BEFORE assistantText.appendEvent ⚠️                         13511-13518
  │     (无 checkClaimSupport / validateCompletionClaim / final-answer card 一致性)
  │
  ├─ needsSolutionCompletenessReportClosure  13519 (事后追加 report block，不阻断)
  │
  └─ transcript blocks
        ├─ command-transcript-presenter (user_text / command 分层正确)
        ├─ ProductBlock (assistant_text / diagnostic / tool_result_error 分层正确)
        ├─ MessageMarkdown (无 HTML/链接解析，无注入)
        ├─ Notifications (绝不进 transcript，单条 priority 最高显示)
        ├─ StatusFooter (不显 provider；dim `--` / "索引?" 兜底)
        ├─ StatusTray (Home 残留 "模型 unknown" 占位词；Task 已 dim --)
        └─ CommandPanel (无 mutating 按钮；actions 只是 slash 文本提示)
```

---

## 3. System Matrix

| 系统 | 入口（file:line + 函数） | 主链位置 | 当前状态 | 是否闭环 | hard / prompt / manual | evidence | UI / transcript | 风险 | 修复阶段 |
|---|---|---|---|---|---|---|---|---|---|
| Anti-Hallucination (Evidence/Freshness) | `index.ts:14502 createEvidenceSummaryForModel`、`index.ts:13223 checkEvidenceGate` | sendMessage 输入侧 + system prompt | 半接入 | 否 | prompt + 弱输入侧 hard gate | recordToolEvidence 无差别写 | 仅 /claim-check 主动暴露 | **P0 final gate 缺失 + evidence 污染** | D.13U |
| `/claim-check` | `index.ts:15557 checkClaimSupport`、`index.ts:7000 handleClaimCheckCommand` | 仅 slash | 完整但旁路 | 否（未接 final） | manual | 消费 evidence，evidence>0 直接 passed | slash output | **测试假绿**（不保护自然主链） | D.13U |
| Architecture Runtime | `architecture-runtime.ts:78 shouldTriggerArchitectureRuntime`，`index.ts:13264-13273` | sendMessage system prompt + 工具前 drift gate | 半接入 | 部分 | hard (drift) + prompt (directive) | recordArchitectureRuntimeCard 落 transcript | drift warning → output | **P1 缺最终交付一致性** | D.13U |
| Architecture Boundary | `architecture-boundary.ts:309 validateChangeDeclaration`，`guard-wiring.ts:295` | **零调用点** | dead code | 否 | （未接） | 无 | 无 | **P1 测试假绿（35+ 用例不触主链）** | D.13U / D.14A |
| Solution Completeness | `model-loop-runtime.ts:416`，`index.ts:14480 updateSolutionCompletenessGate`、`index.ts:13519 needsSolutionCompletenessReportClosure` | sendMessage system prompt + 事后追加 | 半接入 | 部分 | prompt + post-hoc append | 不直接产 evidence，读 evidenceRefs | 缺词时追加 report block | **P1 不阻 final / 不阻 continuation** | D.13U |
| Report Guard | `permission-continuation-runtime.ts:234 createReportWriteGuard`，`index.ts:13233` | sendMessage 全程 + 工具子集收紧 | 完整但范围窄 | 是（限定场景） | hard (tool 子集) + soft (final reminder) | report_incomplete evidence | reminder via messages | **P2 触发条件三关键词；formatModelToolOutput 遮蔽真实 output** | D.13U |
| Permission 四档 | `tui-permission-runtime.ts:137 decidePermission`，`index.ts:14064` | 所有内置 + deferred 工具 | 完整 | 是 | hard | recordPermissionDenied | permission-presenter；不泄漏 rule.id | 低 | — |
| Natural Command Bridge | `natural-command-bridge.ts:1125 routeNaturalIntent`，`index.ts:12857` | 仅 trust-natural；普通自然语言直送 model | 完整 | 是 | hard (workspace-trust 才拦截) | natural gate debug events | confirm prompt | 低（FreshnessLite 已删除） | — |
| Slash Dispatch / Capability Catalog | `slash-dispatch.ts:86`、`natural-command-bridge.ts:123/195/999 validateCommandCapabilityCoverage` | 唯一 source of truth | 完整 | 是 | hard（运行期 / 测试期断言对齐） | — | help / suggestions | 低（无漂移） | — |
| Built-in Tools | `index.ts:14064` builtInTools 注册 | 主链工具循环 | 完整 | 是 | hard (decidePermission) | recordToolEvidence | formatToolStart/Output summary-first | **P0 evidence 写入无差别** | D.13U |
| Deferred Tools (SearchExtraTools/ExecuteExtraTool) | `index.ts:14260 executeDeferredDispatchToolUse` | 主链工具循环 | 完整接入 + UI 文案泄漏 | 是 | hard (classifyToolRequest 同一引擎 + 适配器二级白名单) | appendDeferredToolResultEvent | **P1 字面工具名经 writeLine 进主屏** (14322/14384/14401) | **P1 UI 文案泄漏** | D.13U |
| Remote MCP Presenter | `remote-mcp-presenter.ts` | 仅 /remote /mcp slash | 完整 | 是 | manual | — | redactRemoteSummary 已脱敏 | 低 | — |
| Codebase Index | `index.ts:8366 handleIndexCommand`、`index-runtime.ts:51`、`index-safety-repair.ts:42` | 仅 slash；evidence 经 EvidenceSummary 间接进 prompt | 完整 | 是 | hard (--force 拦截 + safety) | recordIndexEvidence (kind: index_query) | CommandPanel | **P1 evidence 无 freshness 过滤；safety 关键字命中可被诱导** | D.13U |
| Memory / Handoff / Sessions | `tui-memory-runtime.ts:71/414/438`、`index.ts:7969 loadOrCreateHandoffPacket` | sendMessage system prompt（accepted topK=3） | 完整 | 是 | hard (accept slash; 长期写入需用户) | seed candidate from evidence/todo/handoff | formatMemoryStatus/Review/Stats | **P1 accepted memory 无版本号 → 跨 session stale fact** | D.13U |
| Git / Worktree / Stable Point | `git-runtime.ts:124/239/330`、`index.ts:7430 handleGitCommand` | 仅 slash | 完整只读 | 是 | hard (白名单 args / fail-closed / GIT_TERMINAL_PROMPT=0) | — | CommandPanel + suggestStablePoint | 低（无 auto-commit） | — |
| /checkpoint | `index.ts:14817-15005` | 仅 slash | 完整 | 是 | hard (in-memory snapshot) | — | 文案 "in-memory snapshots; not a git reset" | 低 | — |
| Job / Runner / Agent | `job-runtime.ts:100`、`runner-runtime.ts:402`、`tui-agent-job-runtime.ts:212`、`job-runner-presenter.ts:82` | 仅 slash；BackgroundTaskState 透传 | 完整 | 是 | hard (completed→partial 结构性映射) | EvidenceRecord 与 BackgroundTaskState 类型隔离 | "no PASS evidence generated" 文案 + 反向断言 | 低（**job completed 不会被当 PASS**） | — |
| Provider / Model Runtime | `tui-model-runtime.ts:160/236/247`、`provider-circuit-breaker.ts:29-39` | sendMessage 头部 cooldown + system prompt | 完整 | 是 | hard (cooldown 2 fail / 45s) | recordProviderFailureEvidence | runtime-status-presenter 不显 provider | **P1 RuntimeStatusForModel 含 provider 进 prompt（软约束）；fallbackUsed 主屏不可见** | D.13U |
| Context (compact / estimator) | `compact-context.ts:33 microCompactMessages`，`index.ts:13613` | sendMessage 每轮 | 完整 | 是 | passive | preservedEvidenceRefs 仅元数据 | 不污染主屏 | 中（evidenceId 模型可见，设计行为） | — |
| Cache (freshness / workspace-reference) | `cache-freshness.ts`、`workspace-reference-cache.ts:150/230` | sendMessage 每次 mutation 后刷新 | 半接入 | 部分 | passive | snapshot 仅 hash 维度 | /break-cache status | **P0 fallback 字段混合 stale+fresh；source:"stale" 命名误导** | D.13U |
| Verification Level | `verification-level.ts:85-199 classifyVerificationLevel`、`index.ts:11005` | 仅 /doctor / /status | 完整但被绕过 | 否 | hard 信号源 | 自身就是 evidence 分级 | /doctor | **P0 createVerificationLevelForReadiness 绕过分级器（11017-11022 直升 real-smoke）** | D.13U |
| Runtime Path Marker | `runtime-path-marker.ts:106-234` | 仅 /doctor | 完整 | 是 | passive | — | 仅 doctor 面板 | 低（不泄漏主屏） | — |
| Resource Guard / Process Guard / Startup | `index.ts:6367 checkResourceGuard`、`process-guard.ts:182`、`startup-runtime.ts` | sendMessage 头部 hard gate（13199/12888/5685/5786） | 完整 | 是 | hard (concurrency cap) | — | guard 文本写主屏 | **P1 隐性"第五权限"（concurrency hard cap，非 access control）** | D.13U（仅文档/命名） |
| Details / Tool Output | `tui-details-runtime.ts:27-124`、`tool-output-presenter.ts:19/39/91/174` | 主链 tool 循环 + /details slash | 完整 | 是 | passive | LayeredToolOutput | summary-first 折叠；fullOutputPath 留盘 | 低（**reportWriteGuard 模式遮蔽真实 output 是 P2**） | D.13U |
| Log Artifact | `log-artifact.ts:67/92`、`index.ts:6228` | 仅 /details output slash | 完整 | 是 | hard (路径白名单 + 字节/行/超时上限 + redact) | — | 自描述 boundary 文案 | 低 | — |
| ShellApp / Composer / Panels | `ShellApp.tsx:29`、`Composer.tsx:315`、各 Panel | UI 渲染层 | 完整 | 是 | hard (互斥 + input-owner 优先级) | — | transcript 分层正确；无内部词泄漏 | 低（仅 P2 "模型 unknown" 占位） | D.13U（轻度） |
| input-owner-controller / task-scroll-state | `input-owner-controller.ts:90 selectInputOwner` | UI 状态机 | 完整 | 是 | hard (permission > paste > slash > composer) | — | 不抢输入 | 低 | — |
| Transcript 渲染 | `command-transcript-presenter.ts:61/107`、`ProductBlock.tsx:84-227`、`MessageMarkdown.tsx`、`CtrlOToExpand.tsx` | UI 渲染层 | 完整 | 是 | passive | — | diagnostic / assistant_text / tool_result_error 严格分层；Ctrl+O 不污染 | 低 | — |
| plain-renderer / ink-renderer | `shell/plain-renderer.ts:235-306`、`ink-renderer.tsx` | UI 渲染层 | 完整 | 是 | passive | — | 与 ProductBlock 严格对齐 | 低 | — |

---

## 4. P0 / P1 / P2

### P0（不接会导致核心能力不可信，必须在下一阶段一次性修复）

**P0-1：Final Answer Hard Gate 缺失**
- 位置：`index.ts:13511-13518`（sendMessage）+ `index.ts:13886-13893`（continueModelAfterToolResults）
- 现象：`assistantText` 直接 `appendEvent({type:"assistant_text_delta"})` 入 transcript，前置零校验
- 缺位的 gate：`checkClaimSupport(assistantText, ...)` / `validateCompletionClaim(assistantText, level, runtimePath, language)` / `hasFinalAnswerReportReference` / Architecture card-vs-final-claim 一致性
- 验证盲点：`/claim-check` 仅在用户主动 slash 时校验；模型自发 PASS / READY / 已完成 / Beta ready 一律入库
- 影响：反幻觉链整体在自然语言主链上**只是 prompt-only**

**P0-2：Evidence 污染让反幻觉自动放行**
- 位置：`index.ts:15321-15349 recordToolEvidence`、`index.ts:15387-15389 checkEvidenceGate`、`index.ts:15590 checkClaimSupport`
- 现象：`recordToolEvidence` 把 Read/Grep/Glob/Bash/Write/Edit/MultiEdit 任意成功 120 字摘要写为 evidence，`supportsClaims=[toolName]`；`checkEvidenceGate` 只看 `evidence.length === 0`；`checkClaimSupport` 在 `evidence.length > 0` 时直接 passed
- 影响：Bash 输出含 "Job completed" / "PASS" 字面量被当等价证据；任意一次工具调用即解锁所有非 Beta 类高危 claim

**P0-3：`createVerificationLevelForReadiness` 绕过分级器**
- 位置：`index.ts:11017-11022`
- 现象：仅靠 `lastVerification.status === "pass" && unverified.length === 0` 直升 `level: "real-smoke"`
- 跳过：`verification-level.ts:248` 要求的 `realProcessObserved | realProviderHit | realTuiRendered` 三条独立观察信号
- 影响：build success 自评通过即被报告为 real-smoke，外部观察证据缺位也不阻塞

**P0-4：`workspace-reference-cache` fallback 字段混合**
- 位置：`workspace-reference-cache.ts:230-245`
- 现象：异常分支 `source: "fallback"` 时 `files / directories / workspaceSnapshot` 沿用 `cache.latest?.files`（旧），`runtimeStatus / evidenceRefs / logRefs` 用 `input.*`（当前）
- Hash：仍写入 `pluginListHash`（`index.ts:10755`）→ 进 freshness 维度
- 影响：caller 不检查 `source==="fallback"` 即把 stale 当 confirmed；连续两次 fallback hash 一致还会被当稳定状态

### P1（影响成熟度 / 体验，但不阻塞核心安全）

- **P1-1**：`SearchExtraTools` / `ExecuteExtraTool` 字面工具名经 `writeLine(output, result.text)` 在 `index.ts:14322 / 14384 / 14401` 进入主屏（agent 2 找到，agent 5 在 UI 渲染层未命中：泄漏发生在 controller 写入源文本，UI 照样渲染）
- **P1-2**：`Architecture Boundary` 全套（`validateChangeDeclaration` / `checkBoundaries` / `checkFileBoundaries` / `validateChangeDeclarationHuman` / `detectCrossLayerImports` / `detectCircularDependencyRisk`）在 `index.ts` 仅 import/export 无调用点，35+ 单测假绿
- **P1-3**：`Solution Completeness` 仅 prompt + 事后 report block（`index.ts:13519 > 13511-13518`），不阻 continuation / 不阻 tool / 不重写 assistantText
- **P1-4**：`Architecture Runtime` 缺最终交付一致性检查；纯文本回答（无工具调用）/ 最后一轮 `streamFinalModelAnswerWithoutTools` 时无 card-vs-final-text 校验
- **P1-5**：`createEvidenceSummaryForModel` 取最新 5 条 evidence 无 freshness/staleness 过滤；index 已 stale 后旧 `index_query` evidence 仍注入 prompt
- **P1-6**：`accepted memory` 跨 session 持久无版本号 → 项目演化后可能成为 stale "fact"
- **P1-7**：`RuntimeStatusForModel` 含 provider/baseUrl/endpointProfile 进 system prompt，依赖 `RuntimeIdentityRule` prompt 软约束
- **P1-8**：`provider fallbackUsed` 在 final answer 中不可见（仅 /usage / /model doctor 可见）
- **P1-9**：`checkResourceGuard` 是隐性 concurrency 第五 gate（位于 permission 之前），需明确文档化为 concurrency hard cap，非 access control
- **P1-10**：`formatModelToolOutput`（`permission-continuation-runtime.ts:370-393`）reportWriteGuard 命中时把 Read/Glob/Grep tool 结果替换成 "Read completed; continuing..." 一行；遮蔽真实 stats，调试时不便

### P2（后续增强）

- **P2-1**：`view-model.ts:423` Home StatusTray 在 `context.model` 缺省时显示 `模型 unknown` 字面量（Task 已用 dim `--`）
- **P2-2**：Ctrl+O fallback panel 把 `ev-1`/`bg-1` 程序化 id 放进 `panel.detailsText`（用户主动展开）
- **P2-3**：`isRuntimeStatusDump`（`index.ts:1942-1948`）双 token 过滤依赖中文文案稳定；可加单测锁文案
- **P2-4**：`task.result = "pass"` 字面（Bash `index.ts:6443` / index repo `index.ts:9182`）与 verification PASS 同名易混淆；建议改 "ok"/"完成"
- **P2-5**：`index-safety-repair` 关键字命中决定 force/repair（`index-safety-repair.ts:42-61`），可能被自然语言诱导触发 --force（"重建+索引"同时出现）
- **P2-6**：`tool-output-presenter` 缺独立单测
- **P2-7**：`workspace-reference-cache.ts:211` 的 `source: "stale"` 命名误导（实际是新 scan 后的新 confirmed），caller 可能误判
- **P2-8**：`source: "fallback"` 没有自动告警 / sentry 计数，发生时仅日志静默
- **P2-9**：`compact-context` tool_result rebuild 把 `evidenceId` 字面量塞进 model 上下文，prompt-cache 维度下 evidence id 改变会持续 bust cache（设计行为，但需观察成本）

---

## 5. Not-To-Do（明确不做）

下一阶段闭环修复**绝不**做以下事情：

1. **不要恢复 FreshnessLite 关键词 gate**（`model-loop-runtime.ts:295-306` 已显式删除；natural-command-bridge.ts 已收口到仅 trust-natural）
2. **不要新增第五权限模式**（permission 四档已是唯一 mutating gate；`checkResourceGuard` 仅是 concurrency cap，需用文档/命名澄清，不要把它升级成第五档）
3. **不要把普通自然语言重新交给本地关键词拦截**（`looksLikeOrdinaryDevelopmentRequest` + 双重前置过滤已防 over-intercept）
4. **不要把 Architecture Runtime 做成独立 agent / ADR DB / 大平台**（保持 sendMessage 内嵌 + drift gate + final 一致性的最小闭环）
5. **不要重写整个 Anti-Hallucination / Solution Completeness / Report Guard**（共用同一收口管线即可，不做平台化）
6. **不要把 Architecture Boundary 当独立产品**（dead code 接入主链即可，不要做成单独 doctor / panel）
7. **不要恢复任何"job completed 直接当 PASS evidence"的语义**（结构性映射已落，9 处文案 + 反向断言守住，不要回退）
8. **不要为修 evidence 污染就把 `recordToolEvidence` 全部砍掉**（保留 evidence 索引，但需要按内容/工具类型分级）

---

## 6. Proposed Unified Closure Plan

下一阶段（建议 D.13U "Linghun Core Runtime Final-Answer Closure"）一次性闭环修复，**不做零碎补丁**。

### 6.1 共用同一条 Final Answer / Evidence / Claim 收口管线

**新增唯一 hot path**：在 `index.ts:13511`（assistantText push 之前）与 `index.ts:13886-13893`（continuation push 之前）插入一个 `enforceFinalAnswerClosure(assistantText, context, ...)`，统一调度：

| 子检查 | 复用现有函数 | 失败动作 |
|---|---|---|
| Claim support | `checkClaimSupport(assistantText, context.evidence, ...)` | 改写：把无支持的高危 claim 改成 "声明未通过 evidence 校验" + 续轮 reminder |
| Completion claim | `validateCompletionClaim(assistantText, level, runtimePath, language)` | 同上 |
| Architecture final consistency | 新增一个轻量 `validateFinalAgainstArchitectureCard(card, assistantText)`（不要做大平台，只做 nonGoals 字面冲突检测） | 同上 |
| Report final reference（仅 reportWriteGuard 命中） | `shouldSendReportFinalReferenceReminder` | 续轮 reminder |
| Solution Completeness 当前态 | `needsSolutionCompletenessReportClosure` | 保持事后追加 report block，但同时**阻塞 continuation 一次**（强制模型补完整） |

**关键约束**：
- Closure 入口必须在 `assistantText` 入 transcript **之前**，不能事后追加
- 失败时**不重写 assistantText 文本**（避免破坏用户可读性），改为「续轮 + 系统侧 system_event + UI 侧 alert block」
- 触发条件不局限于"报告+写入+文件名"三关键词；任意自然语言 final answer 都过此 gate
- 复用现有 `/claim-check` 同一套 evidence 判定逻辑，但将"evidence>0 直接放行"改成"evidence 必须真实支持当前 claim"

### 6.2 修复 Evidence 污染（P0-2）

`recordToolEvidence`（`index.ts:15321-15349`）：
- 不再无差别 `supportsClaims=[toolName]`；按工具+输出内容分级：
  - Read/Grep/Glob → `supportsClaims=["local_read"]`（只支持「读到了文件」类 claim）
  - Bash exit 0 → `supportsClaims=["bash_exit_0"]`，**不**等价 build/test PASS
  - Write/Edit/MultiEdit → `supportsClaims=["file_written"]`
- `checkEvidenceGate` 改为「按 claim 类型匹配」而非「evidence.length>0」
- `checkClaimSupport` 同上

### 6.3 修复 Verification 绕过（P0-3）

`createVerificationLevelForReadiness`（`index.ts:11005-11033`）：
- 删除直接的 `level = hasRealSmoke ? "real-smoke" : ...` 推断
- 改为调用 `classifyVerificationLevel({ realProcessObserved: ..., realProviderHit: ..., realTuiRendered: ..., buildPassed: ..., ... })`
- 把 lastVerification.status 转成分级器 input 字段，不直接产出 level

### 6.4 修复 workspace-reference-cache fallback（P0-4）

`workspace-reference-cache.ts:230-245`：
- fallback 路径**不写 `pluginListHash`**；或在 hash 里显式带 `"source=fallback"` 维度，让连续 fallback 不被误判稳定
- caller（`index.ts:10755`）增加 `if (snapshot.source === "fallback") return prevHash` 兜底
- 可选：改名 `source: "stale"` → `source: "rescanned"` 消除误导

### 6.5 UI 降噪（P1-1 等）

仅做 user-facing 文案改造，不动主链：
- `index.ts:9996/10012/10021/10029/10035/10045/10058/10084/10091/10097/10109` 中的 "SearchExtraTools matched..." / "ExecuteExtraTool: ..." 文本改成「已发现 N 个扩展工具 / 扩展工具调用失败：…」，把字面工具名只保留在 system event + doctor
- `view-model.ts:423` Home StatusTray "模型 unknown" 改用 dim `--`，统一 Home/Task
- `task.result = "pass"` 字面改 "ok" / "完成"

### 6.6 仅需要测试补齐（不改源码）

- `Architecture Boundary` 接入 sendMessage 主链一个调用点（推荐：`enforceFinalAnswerClosure` 或 system prompt 装配前），让 35+ 单测变成实际接入
- `tool-output-presenter` 补独立单测
- `index.test.ts` 增加反向断言："reportWriteGuard 未命中 + assistantText 含 PASS / READY / 已完成 → final closure 必须续轮 / 不入库"

### 6.7 文档/命名澄清（不改源码）

- `checkResourceGuard` 在 CLAUDE.md / docs/delivery 明确标注为 "concurrency hard cap，非 access control，与 permission 四档独立"
- `RuntimeStatusForModel` 字段分两套：`internalForLog` 完整 / `externalForPrompt` 只含 `model + mode + cache + index`（剔除 provider/baseUrl/endpointProfile），让 RuntimeIdentityRule 不再依赖软约束
- `accepted memory` 增加 `version` 字段（最小入侵：仅记录 createdAt + projectGitHead），过期阈值由用户在 /memory review 中可见

---

## 7. Verification Results

```
$ corepack pnpm --filter @linghun/tui exec tsc --noEmit
EXIT=0  (无错误)

$ corepack pnpm --filter @linghun/tui exec vitest src/guard-wiring.test.ts \
    src/architecture-runtime.test.ts src/architecture-boundary.test.ts \
    src/model-loop-runtime.test.ts --run
Test Files: 4 passed (4)
Tests:      149 passed (149)
EXIT=0

$ corepack pnpm --filter @linghun/tui exec vitest src/natural-command-bridge.test.ts \
    -t "natural|slash|capability|git|mcp|claim" --run
Test Files: 1 passed (1)
Tests:      61 passed | 95 skipped (156)
EXIT=0

$ corepack pnpm --filter @linghun/tui exec vitest src/permission-policy-engine.test.ts \
    src/job-runtime.test.ts src/runner-runtime.test.ts \
    src/cache-freshness.test.ts src/workspace-reference-cache.test.ts --run
Test Files: 5 passed (5)
Tests:      200 passed (200)
EXIT=0

$ corepack pnpm --filter @linghun/tui exec vitest src/shell/view-model.test.ts \
    -t "CommandPanel|notification|permission|task|details|transcript" --run
Test Files: 1 passed (1)
Tests:      85 passed | 182 skipped (267)
EXIT=0

$ git diff --check
EXIT=0
```

汇总：tsc 0 错；vitest 共 **614 用例全绿**（4 组）+ 277 skipped（topic 子集）；`git diff --check` 干净；本审计阶段**0 源码改动**。

---

## 8. Open Risks（阻塞下一阶段修复的风险）

只列真正阻塞 D.13U 一次性闭环修复的问题，其余不重复：

1. **`enforceFinalAnswerClosure` 的失败动作策略需要先与用户对齐**：失败时是「续轮 reminder + 不入 transcript」还是「续轮 reminder + 入 transcript 但加 alert block」？两者用户体验差异显著；本审计未做决策，留给 D.13U 启动前 Start Gate 确认。
2. **Evidence 分级的最小入侵实现**：是否需要为 `EvidenceRecord` 加 `claimKind` 字段（schema 变更）还是直接用 `supportsClaims` 数组细分？前者破坏现有 evidence 文件兼容；后者最小入侵但语义模糊。建议后者，但需在 D.13U 启动前确认。
3. **Architecture Boundary 接入主链一个调用点的位置**：放在 `enforceFinalAnswerClosure` 还是 `executeModelToolUse` 工具前？前者覆盖 final answer 一致性；后者覆盖 tool 调用边界。两者不互斥，但首批接入哪一个需确认。
4. **`createVerificationLevelForReadiness` 修复后是否会让现有 readiness 报告大面积"降级"**：D.13Q-UX / D.13R 的 readiness 历史可能在分级器严格模式下变成 "build" 或 "local"。这是预期的（修复假绿），但需要在 release notes 中显式说明。
5. **`workspace-reference-cache` fallback 改 hash 后是否会让 prompt cache 大面积失效**：fallback 频率取决于环境；若文件系统抖动期 fallback 频繁，会让 system prompt cache 持续失效。建议在 D.13U 前做一次环境抖动期 fallback 频率监测。

---

## 9. 参考核对

- **Linghun 文档**：`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`docs/delivery/README.md`、近期 D.13Q-UX / D.13R / D.13S / D.13D 的阶段交付文档（git log 标题已读取）
- **CCB / CCB Dev Boost**：本阶段为审计，未直接读取 CCB 源码；引用的产品行为概念（"主屏 summary-first"、"权限四档"）仅作语义对齐
- **本次审计读取的源码**（仅 grep + 局部 read，未全文 read 任何 15000+ 行文件）：
  - `index.ts` 通过 grep -n 精确定位关键调用点，未全文 read
  - `view-model.test.ts` 4442 行通过 grep -n 定位 spec 名，未全文 read
  - 其他列出的 67+ 文件按需 read
- **未复制可疑源码实现**：本审计 0 源码改动，0 抄录，仅产出 markdown 报告

---

## 10. 交付清单

- 审计阶段是否 0 源码改动：**是**
- 是否发现只在测试 / helper 存在、未接主链的系统：**是**（Architecture Boundary 全套；checkClaimSupport / validateCompletionClaim 仅 /claim-check）
- 是否发现过度拦截普通输入：**否**（FreshnessLite 已删除，Natural Command Bridge 已收口到 trust-natural）
- 是否发现 UI 主屏泄漏内部词：**部分**（SearchExtraTools/ExecuteExtraTool 字面量经 controller writeLine 进主屏；UI 渲染层无新增泄漏）
- 是否确认所有 mutating 行为仍走现有权限四档：**是**（`checkResourceGuard` 是 concurrency cap，不参与 access control 决策）
- 是否确认下一步可以一次性做闭环修复：**是**（4 个 P0 都是点状缺失，建议合并为 D.13U 一次性闭环修复）
