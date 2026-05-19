# Linghun Phase 00-18 Design + Runtime Overdesign Full Audit

> 审计日期：2026-05-19  
> 审计性质：只读审计 + 一次性修复方案，不修改实现代码，不更新阶段状态，不进入 Phase 15 Beta / Phase 15.5 / Phase 16+。  
> 审计口径：以源码和真实主链路为准；文档中的“已闭环 / PASS / 完成”只作为被审计对象，不作为成熟度证据。  
> CCB 参考边界：只参考 `F:\ccb-source` 的成熟行为边界、主链路、验收口径和文件路径，不复制 CCB 源码。

## 0. Scope And Method

本轮读取了 Linghun 总设计文档、Phase 00-15 交付文档、Phase 15 pre-Beta 审计闭环文档、TUI/provider/config/tools/core/CLI 源码、关键测试，以及 CCB 的 query、processUserInput、commands、Tool、tool execution、message rendering、permission、status line、provider adapter/registry/usage 相关源码。

重点判断不是“有没有功能名”，而是：

- 普通开发请求是否稳定进入模型 query/tool loop。
- `tool_use -> permission -> tool_result -> continuation -> final answer` 是否是唯一主链路。
- NCB、gates、evidence、hints、cache/index/memory、provider route、agents/workflows/multi-model 是否抢主链路。
- Phase 15.5/16/17/18 是否继续制造复杂度。
- 当前测试和文档是否足以证明 CCB 成熟度。

## 1. Executive Verdict

| Question | Verdict |
| --- | --- |
| 是否存在系统性过度设计 | 是。Linghun 已具备真实工具循环雏形，但控制面、gate/evidence、NCB、provider route、agents/workflow/multi-model、阶段报告一起挤进 Phase 15 前主链路，形成系统性过度设计。 |
| 是否阻塞 Phase 15 Beta 实测 | 是。不是因为完全不可运行，而是因为已知的非实测类设计技术债还会污染真实实测：NCB/控制面抢路由、provider profile 边界不清、权限交互不成熟、文档 PASS 膨胀、真实 report-generation path 仍 PARTIAL。 |
| 是否必须先修再实测 | 是。应先做一次性去过度设计和主链路成熟化，再开始 Phase 15 Beta；否则 Beta 会变成继续补关键词、补文案、补局部 provider 兼容的循环。 |
| Phase 15 Beta readiness | FAIL for CCB mature baseline；PARTIAL only for limited pre-Beta smoke。按用户目标口径“Phase 00-14 代码层面达到 CCB 成熟主链路”评估，当前不能进入 Beta。 |

结论：Linghun 不是“缺几个 bug fix”，而是“主链路和控制面边界没有收紧”。下一轮实现不应继续补关键词或补 closure 文案，必须一次性把普通任务回归模型工具循环，把 NCB/gates/evidence 降级为后台/控制面，把 provider profile 和权限/工具结果续轮收成可实测主链路。

## 2. CCB Mature Baseline Inventory

| 成熟行为 | 参考文件 | 关键边界 | Linghun 应吸收什么 | Linghun 不应复制什么 |
| --- | --- | --- | --- | --- |
| 普通文本默认进入模型查询 | `F:\ccb-source\src\utils\processUserInput\processTextPrompt.ts`, `processUserInput.ts` | 普通 prompt 生成 user message，`shouldQuery: true`；slash/bash/附件/本地命令单独分流。 | 普通开发请求不得被 NCB、本地关键词、gate、status/hint 抢走。 | 不需要复制 CCB 的完整 React/Ink 输入栈。 |
| 单一 query/tool loop | `F:\ccb-source\src\query.ts` | 模型流、工具调用、工具结果、上下文压缩、错误恢复在一个主 loop 中闭环。 | Linghun 主链路必须只有一条：model -> tool_use -> permission -> tool_result -> continuation -> final。 | 不复制 CCB 的内部消息结构和专有 telemetry。 |
| 流式工具执行 | `F:\ccb-source\src\services\tools\StreamingToolExecutor.ts`, `toolExecution.ts`, `toolOrchestration.ts` | tool_use 流入即可排队/执行；并发安全工具可并发；非并发工具串行；progress、abort、sibling cancellation 有语义。 | 至少保证工具结果不是最终答案，必须续轮；工具失败/拒绝也作为 tool_result 回灌。后续可逐步补并发/progress。 | 不必一次性实现完整并发调度器。 |
| 工具契约和渲染分层 | `F:\ccb-source\src\Tool.ts`, `components/messages/*Tool*` | 工具有 schema、permission、render、progress、error/reject/cancel 渲染；主屏 summary，details/debug 后置。 | 工具结果主屏只给摘要，完整输出入 transcript/evidence/log；Read/Grep/Glob/Bash/Write/Edit 分层一致。 | 不复制 CCB 每个工具组件 UI。 |
| 权限是产品交互，不是文案 | `F:\ccb-source\src\components\permissions\*`, `utils\permissions\permissions.ts` | Bash/Edit/Write 有专用 prompt、diff/命令/风险/allow-reject；拒绝继续回灌给模型。 | Linghun 必须让 Write/Edit/Bash 有明确审批 continuation；ask 不应只是“当前最小 REPL 没有交互式审批”。 | 不需要完整 IDE diff/modal，但不能停留在文字堆叠。 |
| 命令 registry 是控制面 source of truth | `F:\ccb-source\src\commands.ts` | help/typeahead/slash/skills/plugins/MCP 命令从 registry 汇合，失败降级。 | Linghun 需要收敛 slash/help/NCB catalog 的漂移，至少一处定义命令边界和风险。 | 不复制完整动态命令生态。 |
| Provider adapter 明确按 profile 转换 | `F:\ccb-source\packages\@ant\model-provider\src\shared\openaiConvertMessages.ts`, `openaiConvertTools.ts`, `openaiStreamAdapter.ts`, `src\services\api\openai\responsesAdapter.ts`, `requestBody.ts` | chat 和 responses schema 不混；provider compat 有白名单/降级/诊断。 | Linghun 应明确 `chat_completions`、`responses`、DeepSeek chat、openai-compatible chat 的工具 schema 和失败边界。 | 不应为每个 provider 堆重度特例。 |
| Status/doctor 是状态层，不是主链路 | `F:\ccb-source\src\components\StatusLine.tsx`, `commands\status`, provider usage/registry | 状态行展示真实 runtime/cache/context/rate/index；doctor 是显式命令。 | Linghun 保留轻量 status/doctor，但不得把 doctor/hints/evidence 注入普通答案。 | 不需要复制 CCB 复杂面板。 |
| Evidence/telemetry 后台化 | `query.ts`, session/transcript 相关路径 | 证据、trace、usage、debug 是后台/verbose，不替代回答。 | Linghun 的后台证据化是优势，但主屏不能变审计报告。 | 不应把反幻觉做成普通输出噪音。 |

## 3. Linghun Design + Runtime Mapping

| 设计文档声明 | 源码实现 | 真实运行行为 | 是否对齐 CCB | 偏离原因 |
| --- | --- | --- | --- | --- |
| Phase 00-14 已具备 CCB 成熟主链路 | `packages\tui\src\index.ts` `sendMessage()`、`executeModelToolUse()`；`packages\providers\src\index.ts` parser | 有 model stream、tool_use、tool_result、continuation 雏形，但工具在一轮 stream 结束后顺序执行；权限 ask 多数不能交互续批；真实 report-generation path 文档仍 PARTIAL。 | 部分对齐 | 功能名齐全，但 runtime 深度不足。 |
| Phase 15 NCB 让自然语言命令成熟 | `natural-command-bridge.ts` 1709 行，catalog/scoring/keyword classification；`handleNaturalInput()` 调 route | 已有测试保护普通开发请求进 model，但 NCB 仍是本地自然语言路由器，持续依赖关键词和风险分类。 | 偏离 | CCB 不用本地关键词解释普通任务；NCB 应降级为控制面/安全闸门。 |
| Provider 支持 DeepSeek / GPT responses / openai-compatible | `providers\src\index.ts` `EndpointProfile = chat_completions | responses`，chat/responses request/stream parser | 已区分 endpointProfile，但 DeepSeek/openai-compatible 的 tool schema、tool_choice、tool_result 兼容仍是实测风险；最新报告承认 report-generation probe 400。 | 部分对齐 | profile 边界还不够硬，doctor 与真实请求 source of truth 未完全统一。 |
| Evidence Gate / Solution Completeness Gate 反幻觉 | `createModelSystemPrompt()` 注入 `EvidenceSummary`、`SolutionCompleteness`、`CommandCapabilitySummary`；`checkEvidenceGate()`、`/claim-check` | 对阶段审计有价值，但普通开发主链路存在被 gate 思维污染的风险；测试里仍大量断言 gate 文案。 | 偏离 | CCB 的证据/diagnostic 在后台或显式命令，不压普通任务。 |
| Tool output summary-first | `tool-output-presenter.ts`，`formatToolOutput()` | 已做截断/证据 id，但工具结果仍直接主屏输出，且模型续轮前可能让用户误以为工具结果就是答案。 | 部分对齐 | 缺 CCB 式 message state：工具 use/result/final answer 清晰分层。 |
| Permission 成熟 | `decidePermission()`、`permission-presenter.ts` | default 下 Write/Edit/Bash ask；只有 model Write 有 pending approval；其他 ask 常变成拒绝/提示 slash 或切模式。 | 不足 | 成熟权限应是交互产品，不是“最小 REPL 没有审批 UI”。 |
| Agents/workflows/multi-model 进入阶段交付 | `/agents`、`/fork`、role route、skills/workflows/plugins/hooks 命令 | 多为状态、manifest、handoff、summary，本身不应进入 Phase 15 Beta 主链路。 | 偏离 | 过早把后续能力暴露成 Phase 00-14 成熟度证据。 |
| Status/doctor/route 反映 runtime | `formatModelRouteDoctor()`、`resolveRoleRoute()`、status/cache/index 输出 | 有真实诊断，但 config/env/defaultModel/role/provider/status/actual request 多源，仍需统一 source of truth。 | 部分对齐 | runtime 选择、doctor 展示、settings/env 合并仍可漂移。 |
| 阶段 closure 证明 ready | 多份 `docs\audit\phase-15-pre-beta-*` | 文档里同时出现 PASS/validated/closure 和“real TUI report-generation path PARTIAL”。 | 不对齐 | 文档债：完成报告多于运行能力，局部 PASS 被扩写成成熟叙事。 |

## 4. Overdesign Findings

### Critical

#### C1. NCB 仍有“自然语言执行器”倾向，必须降级为控制面/安全闸门

- 现象：`natural-command-bridge.ts` 已扩展到 catalog、scoring、中文/英文关键词、风险分类、Start Gate、permission pipeline、safe local action、clarification；测试持续添加中文变体，如“更新/刷新/同步/重建索引”。
- 文档证据：`docs\delivery\phase-15-natural-command-bridge.md` 和多份 Phase 15 pre-Beta closure 把 NCB 当核心成熟交互；`phase-15-pre-beta-real-tui-provider-smoke-gap-review.md` 曾把“帮我更新项目索引”误路由列为 P0，并通过补关键词修复。
- 源码证据：`packages\tui\src\natural-command-bridge.ts:815` `routeNaturalIntent()`；`:1495` `scoreCapability()`；`:1604` `createNaturalEquivalentCommand()`；`packages\tui\src\index.ts:5851` 调用 `routeNaturalIntent()`。
- CCB 对照：`F:\ccb-source\src\utils\processUserInput\processTextPrompt.ts` 普通文本默认 `shouldQuery: true`；控制面通过 slash/command registry 分流。
- 为什么是过度设计：中文兼容被实现成关键词路由器，会持续产生“补关键词 -> 补测试 -> 补 closure”的维护循环；它不增加模型主链路成熟度，反而可能抢普通任务。
- 影响：Phase 15 Beta 会把真实用户输入不断打到 NCB 边界，暴露更多中文变体而不是验证模型工具链。
- 建议处理：重写边界。NCB 只保留 slash 等价、明确本地状态/doctor/help/cache/index 查询、危险自然语言拦截；普通开发请求无条件进模型 loop。删除把自然语言开发任务解释成本地动作的野心。

#### C2. 唯一主链路尚未达到 CCB 成熟，工具结果仍可能被体验上误当最终答案

- 现象：`sendMessage()` 可以收集 tool_use 并执行工具，但它在完整 stream round 后顺序执行工具；工具结果立即写主屏，然后再进入下一 round。权限 ask 时直接 return，只有特定 Write 走 pending approval。
- 文档证据：`docs\audit\phase-15-pre-beta-ccb-grade-runtime-acceptance-closure.md` 承认真实 report-generation path PARTIAL：报告文件未写入，无 `tool_use`、permission continuation、`tool_result`；tools + exact deployment-report provider probe 返回 HTTP 400。
- 源码证据：`packages\tui\src\index.ts:6123` `sendMessage()`；`:6259` push assistant toolCalls；`:6268` for 循环顺序执行 toolCalls；`:6273` push role tool；`:6496` `executeModelToolUse()`；`:6545` `executeApprovedModelToolUse()`。
- CCB 对照：`F:\ccb-source\src\services\tools\StreamingToolExecutor.ts` 在工具流入时排队执行，区分并发安全/独占，progress/abort/result 有序产出；`query.ts` 把工具失败/拒绝也回灌模型。
- 为什么是技术债：Phase 00-14 的成熟口径不是“能发 tool_use 事件”，而是工具调用、权限、结果、续轮、最终回答在真实任务中稳定闭环。
- 影响：真实项目报告生成、读文件后总结、写文件审批后继续解释等路径仍可能停在工具结果或 provider 兼容错误。
- 建议处理：重写主链路边界。工具结果永远不是最终答案；所有 allow/deny/error/cancel 都必须形成 tool_result 并续轮，除非用户中断或达到工具轮次上限。

#### C3. Provider profile 边界不够硬，真实工具报告路径仍是 Beta 阻塞项

- 现象：`providers\src\index.ts` 同时承担 DeepSeek、openai-compatible、chat_completions、responses request/stream/parser；已有 supportsTools guard，但真实 tools + report prompt 曾 400。
- 文档证据：`phase-15-pre-beta-ccb-grade-runtime-acceptance-closure.md` 的补验结论：live basic text PASS 不能升级为 report-generation PASS；real TUI report-generation path PARTIAL。
- 源码证据：`packages\providers\src\index.ts:55` `EndpointProfile`；`:365` `createChatProfileRequest()`；`:380` `createResponsesProfileRequest()`；`:599` `parseOpenAiStreamLine()`；`:713` `parseResponsesEvent()`；`:818` `parseOpenAiToolCalls()`；`:953` HTTP 400 suggestion 提到 tools/tool_choice/tool_result。
- CCB 对照：`F:\ccb-source\packages\@ant\model-provider\src\shared\openaiConvertMessages.ts`、`openaiConvertTools.ts`、`openaiStreamAdapter.ts`、`src\services\api\openai\responsesAdapter.ts` 明确按 API profile 转换；`providerRegistry\providerCompatMatrix.ts` 做兼容白名单。
- 为什么是过度设计/技术债：不是 provider 太少，而是 profile 语义混在一个 openai-compatible provider 内，doctor、config、request body、parser、tool schema 没有形成可验收的 profile contract。
- 影响：DeepSeek chat 通、GPT responses 通、中转站通三件事会互相污染；一次修 chat schema 可能破 responses。
- 建议处理：弱化 provider 泛化，保留自有轻量 adapter，但重写为 3 个明确 profile：`deepseek_chat_completions`、`openai_compatible_chat_completions`、`openai_responses`。禁止隐式 fallback 掩盖失败。

#### C4. 文档债已经影响决策，closure/PASS 多于运行证据

- 现象：多个审计/closure 文档给出 PASS、validated、closure，但最新 evidence gate 又承认 Phase 15 Beta readiness PARTIAL、real TUI report-generation path PARTIAL。
- 文档证据：`docs\audit\phase-15-pre-beta-source-level-runtime-output-permission-parity.md` 写 Phase 00-14 parity PASS for declared surface；`docs\audit\phase-15-pre-beta-end-to-end-ccb-user-journey-parity-closure.md` 写 journey closure；`docs\audit\phase-15-pre-beta-verdict-evidence-gate.md` 又明确 focused/mock/live text PASS 不能推导整体 ready。
- 源码证据：`packages\tui\src\index.test.ts` 大量 `toContain`、mock fetch、journey smoke；`:2700` model Write path 是 mock；`:2771` journey smoke 是脚本化场景，不是真实 provider report path。
- CCB 对照：成熟度以真实 query/tool loop、真实 provider adapter 和交互行为为准，不以阶段报告闭环为准。
- 为什么是文字补丁：closure 把“声明面 PASS / pre-Beta surface PASS / mock journey PASS”包装得过满，容易让后续会话误进 Beta。
- 影响：后续实现会沿文档继续推进 Phase 15.5/16，而非收敛 Phase 00-14 主链路。
- 建议处理：降权。Phase 15 前所有 closure/report 只作为历史材料；readiness source of truth 改为源码验收矩阵和真实 report-generation smoke。

### High

#### H1. Gates 过多，容易污染普通任务

- 现象：Start Gate、Verdict Evidence Gate、Solution Completeness Gate、Index Safety、Permission 同时存在；部分进入 system prompt 或主屏。
- 文档证据：`PHASE_15_PRE_BETA_FULL_INTERACTION_MATURITY_AUDIT.md`、`phase-15-pre-beta-verdict-evidence-gate.md` 反复强调 gate；后者虽规定普通输出不得显示，但实现中仍有触发路径。
- 源码证据：`packages\tui\src\index.ts:6647` `createModelSystemPrompt()` 注入 `EvidenceSummary`、`SolutionCompleteness`、`CommandCapabilitySummary`；`:6687` `updateSolutionCompletenessGate()`；`:6301` 可能输出 Solution Completeness report。
- CCB 对照：CCB 有权限/安全/doctor/debug，但普通 query 不显示审计矩阵。
- 为什么是过度设计：反幻觉能力应服务阶段审计，不应改变普通开发请求的输出形态。
- 影响：用户会觉得“被系统规则支配”，而不是完成任务。
- 建议处理：弱化。保留 Permission 和必要 Index Safety；Verdict/Solution gates 只在 `/claim-check`、审计报告、handoff、phase readiness 明确请求中启用；不得注入普通任务主 prompt。

#### H2. 权限交互仍是文案堆叠，未达到成熟交互

- 现象：`decidePermission()` 在 default 下对需审批操作返回 ask，但默认说明“当前最小 REPL 没有交互式审批 UI”；只有 model Write 有 pendingLocalApproval。
- 文档证据：多份 closure 称 permission parity PASS，但也把完整 modal 标为 OUT_OF_SCOPE。
- 源码证据：`packages\tui\src\index.ts:7443` `decidePermission()`；`:6519` 非 allow 时写 prompt；`:6529` 只有 `permission.decision === "ask" && toolName === "Write"` 进入 pending approval。
- CCB 对照：`F:\ccb-source\src\components\permissions\PermissionRequest.tsx`、Bash/Edit/Write permission components 都有专用审批和拒绝续轮。
- 为什么是技术债：成熟权限不是“默认拒绝很安全”，而是用户能看懂风险、批准一次、拒绝并让模型继续。
- 影响：普通写报告、改文件、跑命令都会被迫改 slash 或切模式；模型 agentic loop 被人为中断。
- 建议处理：重写最小交互。Write/Edit/MultiEdit/Bash 都需要 pending approval；deny/cancel/timeout 必须作为 tool_result 回灌。

#### H3. `index.ts` 超大文件已经成为结构性风险

- 现象：`packages\tui\src\index.ts` 8393 行，覆盖 CLI/TUI commands、models、providers runtime、permissions、tools、cache/index/memory/agents/workflow/handoff/gates/status。
- 文档证据：多份 closure 为避免大改只做局部 presenter 抽取，但功能继续回写 index.ts。
- 源码证据：文件行数 8393；`handleNaturalInput()` 在 `:5689`，`sendMessage()` 在 `:6123`，`decidePermission()` 在 `:7443`，help/status/provider/agent/cache/index 均在同文件。
- CCB 对照：CCB 将 process input、query、tool execution、commands、permissions、messages/status 分层在独立模块。
- 为什么是结构性债：后续只能继续“补丁化”，任何主链路修复都要穿越无关控制面。
- 影响：Phase 15.5/16/17/18 若继续叠功能，会把主链路稳定性拖垮。
- 建议处理：最小拆分，不做大重构。下一轮只抽主链路相关模块：model loop、permission continuation、command dispatch/NCB boundary。其余不动。

#### H4. 配置 source of truth 不统一

- 现象：`defaultModel`、env、settings.json、role route、provider.model、status bar、doctor、actual request selection 都参与模型选择。
- 文档证据：Phase 13/15 文档强调 role route 和 doctor；测试断言 `defaultModel=gpt-5.5` 但普通请求按 executor route 执行。
- 源码证据：`packages\config\src\index.ts:143` env 默认模型；`:151` default routes；`:243` defaultConfig；`:552` env/settings merge；`packages\tui\src\index.ts:2213` `getSelectedModelRuntime()`；`:2271` `resolveRoleRoute()`；`:1860` `/model` 显示。
- CCB 对照：provider registry/switcher/compat/usage 各有明确边界；实际请求、doctor、status 应共享解析结果。
- 为什么是技术债：用户看到的 `/model`、doctor、status 和实际 request 可能讲不同故事。
- 影响：provider smoke 失败时难以判断是 env、settings、route、profile、model support 哪一层。
- 建议处理：弱化 role route 复杂度，Phase 15 主链路只认 executor resolved runtime；所有 status/doctor/request 使用同一个 `ResolvedRuntime`。

#### H5. Agents/workflow/multi-model/skills 过早进入 Phase 15 主叙事

- 现象：Phase 12-14 暴露 agents、fork、workflows、skills、plugins、hooks、role usage、vision/image roles。
- 文档证据：delivery docs Phase 12/13/14 都以 PASS/closure 方式进入成熟叙事。
- 源码证据：`packages\tui\src\index.ts` 中 `/agents`、`/fork`、role handoff、skills/workflows/plugins/hooks 均在 TUI 主文件；测试大量断言这些命令输出。
- CCB 对照：CCB 有 agents/workflows/plugins，但它们建立在稳定 query/tool/permission 基础上。
- 为什么是过度设计：在主链路未成熟前加入多角色、多模型、多工作流只会放大配置和权限复杂度。
- 影响：Phase 15 实测可能被无关高级功能干扰。
- 建议处理：后置。Phase 15 smoke 禁止这些能力参与主链路，只保留 discover/status/doctor。

### Medium

#### M1. Evidence/transcript/handoff 是优势，但主屏仍偏重

- 现象：Linghun 记录 evidence、system_event、handoff packet，并向模型注入 EvidenceSummary。
- 文档证据：多个审计文档把 evidence 作为反幻觉核心能力。
- 源码证据：`createEvidenceSummaryForModel()`、`recordToolEvidence()`、handoff/status 相关输出。
- CCB 对照：后台 transcript/debug 是成熟能力，但普通主屏只给用户需要的答案。
- 为什么需弱化：证据系统有价值，但不该成为回答格式。
- 影响：输出像审计器而不是编码助手。
- 建议处理：后台化。主屏只显示短 evidence id；详细证据通过 `/evidence`、handoff、审计报告查看。

#### M2. cache/index/memory/hints 可能抢主链路

- 现象：cache/index/memory/hints 已在 status、system prompt、light hints、doctor 中出现。
- 文档证据：Phase 09/10/11 强调 cache/index/memory；Phase 15 要把它们接入自然命令。
- 源码证据：`writeLightHints()`、`buildRuntimeStatusForModel()`、`createModelSystemPrompt()`、`formatCompositeStatusQuery()`。
- CCB 对照：cache/index/memory 是状态/优化层，不是任务执行者。
- 为什么是风险：hint 和 index 状态若频繁出现，会让普通开发请求偏离“读代码/改代码/总结”。
- 影响：用户体验变成不断被提醒系统状态。
- 建议处理：弱化。默认主屏不显示 hints，除非有明确错误、stale index 影响当前工具或用户查询 status。

#### M3. 测试以 mock/focused/string 断言为主，不能证明 CCB 成熟主链路

- 现象：`index.test.ts` 2941 行，大量 `toContain`、mock fetch、脚本化 journey；provider parser 测试有价值但仍是 fixture。
- 文档证据：Verdict Evidence Gate 已承认 mock/focused/live text PASS 不能推导 Beta readiness PASS。
- 源码证据：`packages\tui\src\index.test.ts:2700` mock Write tool path；`:2771` journey smoke；`packages\providers\src\index.test.ts` 多处 `vi.stubGlobal("fetch")`。
- CCB 对照：成熟主链路需要真实 stdin、真实 provider optional smoke、真实 tool report path gate。
- 为什么是测试债：句子断言容易证明“文案没变”，不证明行为闭环。
- 影响：下一轮继续写 closure 仍可能掩盖真实失败。
- 建议处理：补行为链路测试和 live optional smoke；不要从 mock/focused PASS 推导 readiness。

#### M4. Status/doctor/route 仍可能误导

- 现象：doctor 会显示 provider、apiKey source、endpointProfile、route decisions，但如果和 actual request 不共享解析对象，仍会漂移。
- 文档证据：`/model doctor` 曾被列为 alias 缺口，说明控制面与 dispatch 已经发生漂移。
- 源码证据：`formatModelRouteDoctor()`、`getSelectedModelRuntime()`、`currentModelSupportsTools()`、`ModelGateway.withSupportedTools()` 分散。
- CCB 对照：status/doctor 是 runtime 当前事实的可视化。
- 为什么是债：diagnostic 不能只是“看起来完整”，必须和实际 request 一致。
- 影响：provider 失败时用户按 doctor 修不一定修到真实路径。
- 建议处理：统一 `ResolvedRuntime` 后，doctor/status/request/log 都引用它。

### Low

#### L1. 中文输出和 Windows/DeepSeek 本地化是优势，但不能变成中文关键词路由

- 现象：Linghun 中文体验、Windows 路径、DeepSeek/openai-compatible 支持是差异化。
- 风险：继续把中文兼容落实为本地关键词分类，会吞掉模型语言理解能力。
- 建议处理：保留中文输出、Windows/DeepSeek/openai-compatible、后台证据；移除中文关键词执行器倾向。

#### L2. Phase 15.5 双模型审计有无限审计风险

- 现象：后续蓝图强调双模型交叉审查、开源前 hardening。
- 风险：如果 Phase 00-14 主链路没先收敛，15.5 会变成继续生成报告和 P0/P1/P2，而不是产品成熟。
- 建议处理：改为 delta audit：只审真实 Beta 新暴露问题，不重新发明 gate。

#### L3. Phase 16/17/18 会放大未稳 CLI 的复杂度

- 现象：学习闭环、长期任务/remote channels、桌面端都依赖稳定 CLI。
- 风险：自动记忆污染上下文、远程通道放大权限/状态复杂度、桌面端只是包装不稳 CLI。
- 建议处理：重写边界。16 只做显式可审查记忆；17 只做本地可恢复任务，不做 remote；18 等 CLI Beta 真实通过后再评估。

## 5. Keep / Weaken / Remove / Defer Matrix

| Area | Decision | 处理边界 |
| --- | --- | --- |
| NCB | Weaken + rewrite boundary | 保留 slash 等价、明确本地状态/doctor/help/cache/index 查询、危险自然语言拦截；删除/禁用普通开发请求本地关键词执行。 |
| provider/interface | Keep but narrow | 保留自有轻量 adapter；重写为明确 profile contract；不新增重 provider 抽象；不隐式 fallback。 |
| gates | Weaken / remove from ordinary path | Permission 和必要 Index Safety 保留；Verdict/Solution gates 只在审计/claim-check/handoff/readiness 中启用；普通任务禁用。 |
| evidence/transcript/handoff | Keep but background | 后台证据化保留；主屏只短 evidence id；不把 evidence summary 当普通回答格式。 |
| hints/cache/index/memory | Weaken | status/doctor/detail 命令保留；不主动抢主链路；memory 不自动污染上下文。 |
| agents/workflow | Defer from Phase 15 smoke | 只保留 discover/status/doctor；不参与真实项目 Beta 主链路。 |
| multi-model | Defer / narrow | Phase 15 只保留 executor runtime；planner/reviewer/verifier 不进入普通工具 loop。 |
| permission | Rewrite minimal interaction | Write/Edit/MultiEdit/Bash 都要 pending approval；deny/cancel 作为 tool_result 续轮。 |
| TUI output/status | Weaken noise, keep summary | summary/details/debug 分层；status/doctor 显式调用；普通屏不刷 gates/hints/evidence。 |
| Phase 15.5 | Rewrite | 变成 Beta 后 delta hardening，不做无限双模型审计。 |
| Phase 16 | Defer / rewrite | 只允许显式、用户确认、可撤销的记忆；禁止自动学习闭环。 |
| Phase 17 | Defer | 长期任务/remote channels 暂停；先等 CLI 主链路稳定。 |
| Phase 18 | Defer | 桌面端不得包装不稳 CLI；只在 Phase 15 Beta 真实通过后重评估。 |

## 6. One-Shot Remediation Plan

本方案不是拆很多轮 P0/P1，而是定义“下一轮一次性收掉”的边界。完成后，Phase 00-14 可视为代码层面达到 CCB 主链路成熟口径；Phase 15 只剩真实项目实测才会暴露的未知问题。

### 6.1 Must Fix Before Real Smoke

1. 收紧唯一主链路：
   - 普通开发请求直接进入 `sendMessage()` / model loop。
   - 禁止 NCB、Solution Gate、Verdict Gate、hints/cache/index/memory 抢普通任务。
   - 工具结果永远不是最终答案；`tool_result` 后必须 continuation，直到 final answer、用户中断、错误或轮次上限。

2. 降级 NCB：
   - `routeNaturalIntent()` 只处理明确控制面：slash usage、status/doctor/help/cache/index/model/memory 查询。
   - 危险自然语言只 block/ask，不执行。
   - 删除把中文普通任务路由到本地动作的设计目标；不得继续补关键词作为成熟方案。

3. Provider profile contract：
   - 明确三个 profile：`deepseek_chat_completions`、`openai_compatible_chat_completions`、`openai_responses`。
   - 每个 profile 固定 request body、tool schema、tool_result message shape、stream parser、doctor smoke。
   - DeepSeek chat 和 GPT responses 不共享模糊 schema；openai-compatible 中转站失败必须显式报 profile mismatch。
   - 禁止 provider 隐式 fallback；fallback 只能由用户可见 route decision 触发。

4. Permission continuation：
   - Write/Edit/MultiEdit/Bash 都实现 pending approval。
   - `yes/no` 只消费 pending permission，不触发模型。
   - allow 执行工具，deny/cancel/error 都 append tool_result 并续轮给模型。
   - 权限 prompt 显示命令/文件/diff 摘要/风险/选项，不显示 raw policy 字段。

5. TUI 主屏分层：
   - Assistant final answer、tool use、tool result、permission、status/hint 分层。
   - Read/Grep/Glob/Bash/Todo/Write/Edit 只在主屏输出摘要。
   - evidence/transcript/full output 后台化，主屏只给短 id 或 detail 命令。

6. Runtime source of truth：
   - 建一个最小 `ResolvedRuntime`，由 actual request 生成。
   - `/model`、`/model doctor`、status line、request log、provider smoke 都引用同一对象。
   - Phase 15 主链路只使用 executor route；其他 role 不参与。

7. 真实 report-generation smoke gate：
   - 用真实 TUI stdin + 真实 provider optional env 跑“分析项目并在根目录写报告”。
   - 必须观察：model tool_use Read/Grep/Glob/Write -> permission -> yes -> tool_result -> continuation -> final answer -> file exists。
   - 无 key 时只能标 SKIPPED/PARTIAL，不能 PASS。

### 6.2 Should Fix In Same Closure

- 将 `packages\tui\src\index.ts` 做最小主链路拆分：只抽 `model-loop`、`permission-continuation`、`runtime-resolution` 或等价模块；不做全 TUI 重构。
- 让 command catalog/help/NCB 使用同一控制面命令定义，减少 slash/help/doctor 漂移。
- 清理普通 system prompt：默认不注入 SolutionCompleteness；EvidenceSummary 只保留极短事实，不加入审计指令。
- 更新 Phase 15 readiness 文档口径：历史 closure 降权，真实主链路 smoke 为唯一 Beta gate。

### 6.3 Can Defer To Phase 15.5

- 完整并发工具调度、grouped tool UI、expand/collapse details 面板。
- 完整 provider registry/compat matrix UI。
- 更丰富 permission modal、IDE diff、allow always/rules editor。
- 深度 cache/index health panel。
- 双模型审计只做 Beta 新问题 delta review，不重审所有阶段。

### 6.4 Should Remove

- NCB 内普通开发请求的关键词执行扩张。
- 把“补中文变体”作为 P0 修复策略。
- 普通输出中的 Verdict Evidence Gate / Solution Completeness Gate 报告。
- Phase 00-14 “declared surface PASS == CCB mature” 的文档结论。
- agents/workflow/multi-model/skills 作为 Phase 15 主链路 readiness 证据。

### 6.5 Do Not Build

- 不做完整自然语言命令解释器。
- 不做自动记忆学习闭环。
- 不做 remote channels / daemon / 长期自治任务。
- 不做桌面端包装。
- 不做新的 provider 大框架或 SDK 替换，除非 profile contract 修完后真实 smoke 仍证明自有 adapter 无法稳定。

## 7. Anti-Pattern Ban List

- 禁止新增关键词补丁来证明 NCB 成熟。
- 禁止通过文案替代主链路行为。
- 禁止从 mock/focused/string PASS 推导 readiness PASS。
- 禁止 provider 隐式 fallback 掩盖失败。
- 禁止普通任务被控制面抢走。
- 禁止把未来阶段过度设计写成“已知限制”后继续推进。
- 禁止为了中文兼容维护一套自然语言执行器。
- 禁止为了反幻觉把普通输出变成审计报告。
- 禁止把工具结果当最终答案。
- 禁止把 agent/workflow/multi-model/skills 状态页当 Phase 00-14 成熟证据。
- 禁止在 Phase 15 Beta 前推进 Phase 15.5/16/17/18。

## 8. Acceptance Matrix After Remediation

| Acceptance Item | Expected Result | Gate |
| --- | --- | --- |
| 普通开发请求进入模型 loop | “分析项目并生成报告”等请求不经 NCB 本地执行，直接发送给模型。 | 必须 PASS |
| 模型主动 Read -> tool_result -> final answer | 模型使用真实 tool_use，工具结果回灌，最后由模型总结。 | 必须 PASS |
| 模型 Write 审批续轮 | Write 触发 permission，用户 yes 后写文件，tool_result 回灌，模型继续 final。 | 必须 PASS |
| Slash command / 纯读文件本地执行 | `/help`、`/model doctor`、`/index status`、明确 `/read` 仍本地。 | 必须 PASS |
| 状态/doctor/help/cache/index 查询本地处理 | 控制面查询不打模型，不污染主屏。 | 必须 PASS |
| 高风险动作不直通 | Bash/Edit/Write/MultiEdit/权限/配置变更必须审批或拒绝。 | 必须 PASS |
| GPT responses profile 不混 chat schema | responses request/input/tools/tool_result/stream 独立验收。 | 必须 PASS |
| DeepSeek chat profile 通 | DeepSeek chat tool_use/tool_result 第二轮无 400。 | 必须 PASS |
| openai-compatible 中转边界清晰 | 不支持 tools 时明确降级或报 profile mismatch，不 silent fallback。 | 必须 PASS |
| 主屏不被 gates/hints/evidence 污染 | 普通任务无 Verdict/Solution/Gate matrix，无控制面噪音。 | 必须 PASS |
| 权限拒绝可继续 | deny/cancel 形成 tool_result，模型能调整方案。 | 必须 PASS |
| Phase 15.5+ 蓝图不扩散过度设计 | 15.5/16/17/18 改为后置/delta/显式确认。 | 必须 PASS |
| 真实项目 report-generation path | 作为 Phase 15 Beta 入口 gate：真实 TUI + provider + file output。 | 必须 PASS 才能 Beta |

## 9. Final Recommendation

1. 暂停 Phase 15 Beta 实测：建议暂停。当前不是“需要实测发现未知问题”的状态，而是仍有明确非实测类设计技术债。
2. NCB：建议删除其“自然语言任务解释器”定位，弱化为控制面/安全闸门。保留中文输出和本地 slash/status 查询，但禁止普通开发请求被关键词路由。
3. Provider：建议保留自有轻量 adapter，但必须按 profile contract 重写边界；暂不引入成熟 SDK/Proxy。若完成 profile contract 后真实 DeepSeek/GPT responses report path 仍失败，再评估引入 SDK/Proxy。
4. Phase 15.5/16/17/18：建议重写边界。15.5 只做 Beta delta hardening；16 只做显式记忆；17/18 暂停，等 CLI 主链路真实稳定。
5. 下一步实现会话应一次性修复，不再拆很多轮 P0/P1，也不再补关键词。

## 10. Next Implementation Session Command

```text
进入 F:\Linghun，按 LINGHUN_PHASE_00_18_DESIGN_RUNTIME_OVERDESIGN_FULL_AUDIT.md 执行一次性去过度设计和 CCB 主链路成熟化修复。

硬约束：
- 只修 Phase 00-14 + Phase 15 pre-Beta 主链路，不进入 Phase 15 Beta / 15.5 / 16+。
- 不补关键词作为最终方案，不补文案替代行为，不更新阶段状态为 PASS。
- 普通开发请求必须默认进入 model/tool loop。
- NCB 降级为控制面/安全闸门。
- Provider 收敛为 deepseek_chat_completions / openai_compatible_chat_completions / openai_responses profile contract。
- Permission 必须支持 Write/Edit/MultiEdit/Bash pending approval 与 deny/cancel tool_result continuation。
- 主屏 summary-first，gates/evidence/hints 后台化。
- 完成后用真实 TUI stdin + optional real provider report-generation path 作为 Phase 15 Beta 前 gate；无 key 只能 SKIPPED/PARTIAL，不能 PASS。

验收以源码和真实行为为准，历史 closure/report 不作为成熟度证据。
```

## Appendix A. Codex Independent Full-Spectrum CCB Maturity Re-Audit

> 本附录是 Codex 本轮独立复审结果，和前文基于总体审计形成的结论分开记录。  
> 方法：多智能体只读审计，每个分支分别对照 `F:\Linghun` 与 `F:\ccb-source` 的对应源码/文档；不改代码，不补技术债，不把历史 closure/PASS 当成熟证据。  
> 结论口径：本附录不替代前文的一次性去过度设计方案，而是补齐“全维度 CCB 成熟度”审计面，供后续和其他模型审计结果合并判断。

### A.1 Independent Verdict

| Dimension | Verdict |
| --- | --- |
| Tool lifecycle & execution | PARTIAL。已有最小可用工具执行管道，但不是 CCB 级工具状态机。 |
| Permission & security | PARTIAL。默认 fail-closed 做得较好，但 ask/approval、Bash 分类、规则表达、diff 审批未成熟。 |
| Provider/runtime/config | PARTIAL。能跑基础 provider，但缺 registry、compat matrix、usage/rate/balance、request builder 纯函数边界。 |
| TUI/UX/output/status | PARTIAL。文本 presenter 有雏形，但不是 CCB 的 message/status/permission 组件成熟层。 |
| NCB/gates/control-plane | PARTIAL。pre-Beta 控制面最小闭环已有，但 registry/input pipeline 还不是 single source of truth。 |
| Context/session/memory | FAIL/PARTIAL。transcript 更像审计日志，不是 query 上下文事实源；resume/memory/handoff 没稳定进入模型上下文。 |
| Docs/tests/readiness evidence | PARTIAL。evidence-first 口径已建立，但真实 report-generation tool path 仍缺 PASS。 |
| MCP/hooks/plugins/skills/workflow | PARTIAL。控制面和诊断面可见，执行面未成熟；插件生态表面积大于运行能力。 |
| Filesystem/Bash/Windows security | PARTIAL。基础 path guard 与硬拒绝存在，但 symlink/realpath/Windows/process tree/Bash classifier 不成熟。 |
| Future phases 15.5/16/17/18 | PARTIAL。方向不完全偏，但设计密度过高，Phase 17 是最大复杂度放大器。 |

Codex 独立复审总裁决：**Linghun 目前是 pre-Beta 最小闭环 + 多个成熟化雏形，不是 CCB 成熟主链路。Phase 15 Beta readiness 仍应保持 FAIL/PARTIAL，直到真实 TUI + 真实 provider + report-generation tool path 端到端 PASS。**

### A.2 Tool Lifecycle & Execution Maturity

**CCB mature baseline**

CCB 的工具成熟度不是工具数量，而是完整生命周期：

- `F:\ccb-source\src\Tool.ts` 定义工具契约，覆盖 schema、权限、只读/破坏性/并发安全、interrupt、输入验证、结果映射、UI 渲染、progress、错误/拒绝/分组渲染。
- `F:\ccb-source\src\tools.ts` 汇合内置工具、MCP、feature flag、deny rule、deferred tools，并保持 tool list 稳定。
- `F:\ccb-source\src\services\tools\toolExecution.ts` 负责单工具执行：schema 校验、权限、hook、progress、telemetry、结果持久化、PostToolUse、tool_result 回写。
- `F:\ccb-source\src\services\tools\StreamingToolExecutor.ts` 与 `toolOrchestration.ts` 处理串并行、顺序回放、兄弟错误取消、用户 interrupt、stream fallback discard。

**Linghun current**

- `F:\Linghun\packages\tools\src\index.ts` 有基础 `runTool()`、读写编辑搜索 Bash Todo Diff、workspace path guard、Bash 进度、输出截断。
- `F:\Linghun\packages\tui\src\index.ts` 将 permission_request/result、tool_call_start/end、tool_result、evidence、Bash progress 串起来。
- `F:\Linghun\packages\tui\src\tool-output-presenter.ts` 已有 summary/preview/truncation/evidence/fullOutputPath 的文本分层。

**Maturity gap**

- `ToolDefinition` 仍主要是 metadata + `call()`，缺 schema 级输入校验、工具级权限、渲染、interrupt、destructive 判断、MCP/open-world 判断。
- 执行层散落在 TUI 大文件，没有独立 tool execution boundary。
- `isConcurrencySafe` 存在但未形成调度器；模型工具调用仍是线性执行。
- `ask` 在多数路径不是交互审批；模型路径只对 `Write` 有 pending approval。
- progress 基本只覆盖 Bash，且通过替换全局 `context.tools.onProgress`，并发时容易串线。
- 错误/取消/超时语义不完整，模型收到的失败结构较薄。

**One-shot boundary**

不要照搬 CCB 全套 executor。只收敛一个窄边界：

- 定义单工具执行入口：permission -> tool_call_start -> progress -> tool_call_end -> tool_result -> evidence。
- 明确短期串行执行；若不支持并发，就不要保留未消费的并发承诺。
- 固定三类输出：模型回传、用户主屏、完整日志/evidence。
- 明确 `ask` 是真正 pending approval，还是当前版本拒绝并记录；不要混用。

### A.3 Permission & Security Maturity

**CCB mature baseline**

CCB 权限不是单点 allow/deny，而是工具内权限 + UI 审批 + 规则系统：

- 统一 PermissionResult：allow/ask/deny/passthrough，携带 reason、规则建议、updated input。
- Bash/Edit/Write 各自有 safety gate；Bash 有命令解析、read-only 判断、危险命令识别、sandbox/classifier。
- Edit/Write 有路径安全、diff/preview、文件状态、敏感路径保护。
- 权限规则有来源、持久化、通配/前缀、shadow rule、模式语义。
- UI 是真实 permission request，不是提示文字。

**Linghun current**

- `decidePermission()` 默认允许只读和会话工具，阻止 Bash/Write/Edit/MultiEdit 静默执行。
- `plan` 优先阻止写入/Bash；`acceptEdits`、`dontAsk`、`auto`、`bypass` 有分支。
- hard deny 覆盖 `.git`、`.env`、`.ssh`、secret、越界路径、部分危险 Bash。
- model `Write` 在 default ask 下能进入 pending approval。
- recentDenied 会写入权限状态；presenter 避免 raw decision/risk/mode 泄漏。

**Maturity gap**

- 只有 model `Write` 有 pending approval；`Edit`、`MultiEdit`、`Bash` 多数 ask 等价拒绝。
- Bash 仍是 `spawn(command, { shell: true })` + 少量正则 hard deny，不具备 CCB 级分类能力。
- `Write` medium、`Edit` low、`MultiEdit` medium 导致 `acceptEdits` 语义偏窄且不直观。
- 规则只有 `toolName + risk + effect`，不能表达路径、命令前缀、来源、session/project policy。
- 工具层 safety 和 TUI 权限层重复，缺统一权限合约。

**One-shot boundary**

- 明确目标是最小可验证权限闭环，不做 auto classifier/sandbox/完整 Bash parser。
- `Write/Edit/MultiEdit/Bash` 的 ask 语义必须统一：要么可 pending approval，要么明确不支持本次审批。
- Bash 默认拒绝；只允许显式 allow rule 后执行，并说明不做命令安全分类。
- `acceptEdits` 先只覆盖有最小 diff/preview 和路径校验的编辑行为。

### A.4 Provider / Runtime / Config Maturity

**CCB mature baseline**

- `providerRegistry` 有 schema 校验、默认 provider、用户覆盖、诊断错误、缓存失效、原子写入、纯 switcher。
- `providerCompatMatrix` 显式建模 OpenAI-compatible 差异，如 `stream_options.include_usage`、thinking/reasoning、tool schema。
- `providerUsage` 有 header adapter、usage store、rate bucket、balance poller。
- OpenAI adapter request/response/stream 转换拆成可测试纯函数；chat/responses path 分离。

**Linghun current**

- `F:\Linghun\packages\providers\src\index.ts` 已有 `ModelGateway`、`OpenAiCompatibleProvider`、`DeepSeekProvider`、chat/responses request builder、SSE parser、usage/error 标准化。
- `F:\Linghun\packages\config\src\index.ts` 有默认 provider、DeepSeek/openai-compatible env 合并、role route、storage/MCP/skills/hooks/plugins config。
- TUI 有 `/model`、`/model route doctor`、route decision、fallback、usage/status。

**Maturity gap**

- 没有独立 provider registry/schema/load diagnostic；`loadConfig()` 对 settings 是 cast + merge。
- 只有 `endpointProfile` 和 `supportsTools`，没有 per-provider compat profile。
- usage 主要依赖流内 usage；缺 header usage/rate-limit bucket/balance。
- request builder 和 stream parser 都挤在 `providers/src/index.ts`，profile contract 不够硬。
- `/model doctor` 偏配置展示，不显示 request body 裁剪、endpoint compat、最近 HTTP/header/stream 错误。

**One-shot boundary**

- 建最小 provider registry：schema、默认、用户覆盖、诊断错误。
- 建最小 compat profile：include_usage、reasoning/thinking、tool support。
- 将 chat/responses request builder 拆成可测试纯函数。
- 给 usage 增加 header bucket 捕获；不做复杂账单系统。
- `/model doctor` 只展示 registry/compat/usage/recent error，不扩 UI。

### A.5 TUI / UX / Output / Status Maturity

**CCB mature baseline**

CCB 的成熟输出是“状态可扫描、操作可选择、输出可折叠/分层、权限可解释”：

- `components/messages` 对工具调用、排队、进行中、权限等待、分组工具输出有独立渲染。
- `StatusLine.tsx` 是持续派生视图，包含 model/context/cache/rate/cost/index health。
- permission UI 有选择、反馈、Esc/Tab/keybinding、规则解释、worker badge。
- status/help/cache-log/break-cache 既有交互 panel，也有非交互 fallback。

**Linghun current**

- `runtime-status-presenter.ts`、`tool-output-presenter.ts`、`permission-presenter.ts` 已从 `index.ts` 抽出文本 formatter。
- `index.test.ts` 覆盖 help/status/cache/break-cache、权限、Write 审批、长输出截断、evidence id。
- 但整体仍是线性 REPL + 文本 presenter。

**Maturity gap**

- `index.ts` 仍承担命令、状态、权限、工具执行、cache、session、NCB、输出格式。
- status 是 120 字符单行快照，不是持续状态层。
- tool output 是一次性文本块，没有 queued/running/waiting/resolved/error 组件状态。
- permission prompt 是文本说明，缺真实交互选择。
- `/help` 长文本目录，`/cache-log`、`/break-cache` 是低成熟度状态页。
- 测试偏字符串行为覆盖，缺 UX contract。

**One-shot boundary**

不追完整 Ink/React UI。先固定文本 TUI 契约：

- `RuntimeStatusView`、`LayeredToolOutput`、`PermissionPromptView` 成为稳定用户可见契约。
- `/status`、工具结果、权限暂停、cache-log/break-cache status 字段一致、摘要优先、完整日志/evidence 后置。
- 不新增完整 UI 框架、presenter registry、command framework。

### A.6 NCB / Gates / Control-Plane Maturity

**CCB mature baseline**

- 输入管线区分 slash、本地命令、hook、queued input、普通 query、bridge/remote。
- commands registry 是 help、dispatch、bridge safety、enablement 的真实来源。
- 状态/doctor/usage/read-only 本地处理；危险动作进 gate/permission；普通开发请求顺畅进 model/tool loop。

**Linghun current**

- `handleNaturalInput()` 顺序较合理：本地审批、Start Gate、裸 yes 拦截、Index safety、组合状态、NCB route、file read、slash dispatch，最后 model。
- 高风险自然语言不会直通。
- `/index` 是较接近产品化的局部。
- SolutionCompleteness/VerdictEvidence 能阻止无证据 readiness claim。

**Maturity gap**

- `natural-command-bridge.ts` 有 registry/catalog，但 `index.ts` 的 if/else dispatch 才是真实入口；仍是旁路 registry + drift test。
- `routeNaturalIntent()` 仍是 catalog scoring + regex/classifier，适合 pre-Beta 控制面，不适合宣称 CCB 级输入管线。
- 普通 query 边界靠词面规则维持，继续补关键词会挤压普通开发请求。
- Index Safety 不等于完整 index job/progress/abort/diagnostic 生命周期。
- Solution/Verdict gates 有价值，但若扩大，会变成审计话术中枢。

**One-shot boundary**

- 保留现有 NCB 规则，不继续补关键词。
- 不新增第二套命令解释系统。
- 最小推进 command/help/NCB/bridge safety 共享真实 registry，但不做大重写。
- Solution/Verdict gates 只防误报，不做全局审计框架。

### A.7 Context / Session / Memory Maturity

**CCB mature baseline**

- sessionStorage 是会话事实源：JSONL transcript、parent chain、compact boundary、metadata、content replacement、resume selector。
- query 从 compact boundary 后取消息，处理 tool result budget、microcompact、context collapse、session memory。
- memory 分层清楚：project rules、session memory、local recall、attachments/context 注入、预算控制。
- resume 从 transcript 重建消息链和 UI/agent/session 状态。

**Linghun current**

- `SessionStore` 有 session 目录、`session.json`、`transcript.jsonl`、create/list/resume/append/updateSummary。
- TUI 有 `/resume`、`/branch`、`/memory`、handoff、evidence、tool_result、verification event。
- `/resume` 避免完整 transcript 注入，只 hydrate todo、lastVerification、recent evidence、last handoff。
- `sendMessage()` 每轮只构造 `system + current user`，工具轮内追加 assistant/tool；历史 transcript 不进模型窗口。

**Maturity gap**

- transcript 是审计日志，不是模型上下文事实源。
- resume 是 UI 摘要恢复，不是能力恢复；下一轮模型不知道历史 user/assistant/tool 链。
- accepted memory、LINGHUN.md、handoff 主要用于 status/review/read，未稳定进入 prompt 主路径。
- 基本没有 compaction 行为。
- evidence 主要靠提示词和 gate 约束，不是完整引用/预算/恢复机制。
- handoff packet 有阶段硬编码，偏文档化。

**One-shot boundary**

- 不复制 CCB session graph。保留 SessionStore，只增加小型 `ContextPackage`。
- 在 `sendMessage()` prompt 注入 projectRules 摘要、accepted memory 前 N 条、last handoff 摘要、最近 todo/verification/evidence。
- `/resume` 和 `/branch` 保证 hydrate 内容进入下一轮 prompt。
- compaction 先只做手动 summary event 或复用 handoff summary。
- 静默 catch 在 session metadata/jsonl 路径补最小 diagnostics。

### A.8 Docs / Tests / Readiness Evidence Maturity

**CCB mature baseline**

成熟证据至少要证明真实模型能发 `tool_use`，真实工具执行回灌 `tool_result`，真实 TUI 完成写文件/权限/续轮/最终回答；mock/focused/string PASS 不能替代。

**Linghun current**

- 文档已建立 evidence-first 口径，`phase-15-pre-beta-verdict-evidence-gate.md` 明确 `mock PASS != live PASS`、`focused PASS != readiness PASS`、live text PASS 不证明 report-generation。
- parser、empty response、HTTP error、mock Write tool path 有 focused 覆盖。
- real TUI report-generation 仍是 PARTIAL / blocking P1 candidate。

**Maturity gap**

- 真实 report-generation 工具链缺 PASS：未稳定证明 `tool_use -> permission -> file write -> tool_result -> continuation -> final`。
- 测试大量 mocked fetch / scripted stdin / `toContain`。
- closure/PASS 文档多，历史结论可能误导。
- CCB parity 仍偏能力点对齐，不是产品成熟等价。

**One-shot boundary**

只补一个硬证据链：

- 真实 provider、真实 TUI/CLI stdin、真实工作区。
- “分析项目并在根目录生成报告”请求。
- 必须观察 `tool_use`、permission continuation、真实文件、transcript/evidence `tool_result`、final answer。
- provider 400/tools/tool_choice 兼容必须明确 PASS/FAIL/PARTIAL。
- 不把 basic text smoke 升级为 readiness。

### A.9 MCP / Hooks / Plugins / Skills / Workflow Maturity

**CCB mature baseline**

- command registry 与 slash router 不漂移。
- MCP 有真实 client lifecycle、tool discovery、schema 稳定、discover-before-execute。
- hooks 能在 PreToolUse/PostToolUse 真实执行/阻断。
- skills summary-first，触发后按需加载正文。
- plugins 的 commands/MCP/providers/hooks/workflows/skills contributions 进入真实 registry。
- workflow 是 Start Gate 后串联权限、执行、验证、交付检查。

**Linghun current**

- `/mcp`、`/index`、`/skills`、`/workflows`、`/plugins`、`/doctor hooks` 路由存在。
- `/index` 是最接近可用闭环的局部。
- MCP 是 codebase-memory CLI 最小闭环；skills/plugins 是 JSON manifest loader；hooks 是 doctor；workflows 是模板 Start Gate。

**Maturity gap**

- MCP tools 是稳定摘要，不是外部 MCP 工具执行层。
- plugin contributions 只是展示，未注册到命令/provider/MCP/hook/workflow/skill 执行系统。
- hooks 不执行、不阻断、不参与 PreToolUse/PostToolUse。
- skills 不加载正文、不触发执行。
- workflow 不自动推进任务。
- command catalog 与 slash router 双表维护。
- 额外风险：`saveExtensionEnablement()` 若写完整 merged config，可能把 env 合并来的 API key 固化进 `.linghun/settings.json`。

**One-shot boundary**

- 不做插件市场/远程安装/自动更新/完整 hook runner。
- 统一 command/capability registry 的单一来源。
- 明确 plugin contributions 当前不可执行，或只接入一个最小只读 contribution。
- 修掉 env secret 写回 settings 的风险。
- 文案统一成“诊断/摘要/Start Gate，不是执行运行时”。

### A.10 Filesystem / Bash / Windows Security Maturity

**CCB mature baseline**

- 文件工具先 canonicalize/realpath，处理相对/绝对/Windows drive/UNC/symlink escape。
- 写入权限、路径边界、敏感路径 hard deny、checkpoint/diff 与执行使用同一 path safety。
- Bash 有结构化 risk classifier、cwd sandbox、timeout 进程树终止、progress、完整日志、取消语义。
- 模型 tool、slash、本地工具不能绕过同一权限管道。

**Linghun current**

- tools 层 `resolveWorkspacePath()` 用 `resolve + relative` 拦截普通 `../`。
- TUI 层 `decidePermission()` 默认阻止写入/Bash 静默执行。
- hard deny 覆盖 `.git`、`.ssh`、`.env`、secret、`rm -rf`、`curl|sh`、`wget|bash`、`mkfs/shutdown/reboot`。
- Bash 有 streaming progress、主屏限量、完整日志、timeout、abort signal。
- storage path 有 project/user/custom 入口。

**Maturity gap**

- tools 层仍是直接执行器；TUI 外调用 `runTool()` 可绕过权限。
- path safety 无 realpath/symlink 防逃逸。
- Windows path 未系统处理 drive-relative、不同盘符、UNC、大小写、保留设备名。
- Bash hard deny 过窄，不能覆盖 PowerShell destructive aliases、`Remove-Item -Recurse -Force`、`del /s/q`、`rd /s/q`、注册表/凭据/重定向泄露。
- timeout 只 `child.kill()`，Windows 上不保证杀进程树。
- checkpoint/rewind 没复用统一 path safety。
- custom storage path 不 resolve、不展开 `~`，边界说明不足。

**One-shot boundary**

- 建最小 path safety 内核，供 Read/Write/Edit/MultiEdit/Grep/Glob、TUI hard deny、checkpoint/rewind 共用。
- 覆盖 workspace 边界、Windows edge、symlink escape、敏感路径 deny。
- Bash 只做最小加固：Windows destructive deny、timeout 终止进程树、保留 progress/log。
- 不扩成全面安全平台。

### A.11 Future Phase 15.5 / 16 / 17 / 18 Maturity

**Baseline**

Phase 15 完成后的 CCB workflow parity 才是后续阶段基线。16-18 只能做 delta，不能重新打开全量 CCB parity。

**Current design**

文档已有边界意识：Phase 15.5 不新增 16+，16-18 做 delta audit，remote 默认关闭，18 不补基础 TUI。但当前 Phase 15 Beta readiness 仍 PARTIAL，因此未来设计越细，越有提前复杂化风险。

**Key risks**

- Phase 15.5 范围过宽：双模型审计、release readiness、provider、Freshness Gate、TUI polish、Solution Gate 合在一起会变成总清算。
- 双模型审计可能变成二次架构评审，引出 registry/provider/TUI/permission 大重构。
- Phase 16 学习闭环可能侵入 prompt/cache 主链路。
- Phase 17 是最大复杂度放大器：长期任务、多 agent、remote channels、CLI adapter、远程审批、nonce/签名/审计一起出现。
- Phase 18 如果承接权限/任务/记忆/remote，就会变成第二产品线。

**Keep / weaken / remove / defer**

- 保留：15.5 只读双模型审计、release readiness、provider capability doctor、Freshness/web_source evidence、16 候选记忆确认、17 预算/超时/风险暂停、remote 默认关闭、18 core/API/IPC 验证。
- 弱化：TUI polish 只修真实 Beta 反馈；双模型审计只给最小修复建议；16 先 memory candidate，Skill candidate 后置；17 先 mock/local job；18 只读状态查看。
- 移除/不做：每轮自动学习、后台静默写记忆、remote 读取完整 transcript/source/API key/billing、连续阶段默认开启、完整 IM SDK、完整桌面产品。
- 后置：permission modal、grouped renderer、插件市场、official CLI adapter、Skill 自动固化、GUI 编辑/审批/任务控制、跨设备审批。

### A.12 Independent Re-Audit One-Shot Boundary

本附录得出的“全维度成熟化边界”比前文更细，但仍必须遵守“不补技术债”的约束。下一轮若以本附录为依据，只应一次性收敛这些阻塞成熟度的主链路缺口：

1. 真实 report-generation tool path 证据链。
2. 单工具执行不变量。
3. Permission ask 语义统一。
4. Provider profile/compat/source-of-truth。
5. 文本 TUI 输出契约。
6. NCB/control-plane 不继续补关键词。
7. 最小 ContextPackage 接入 resume/handoff/memory。
8. command/capability registry 漂移边界。
9. secret 不写回 settings。
10. path safety + Windows/Bash 最小硬边界。

明确不要做：

- 不照搬 CCB 全套架构。
- 不大拆 `packages\tui\src\index.ts`。
- 不实现完整 MCP SDK / hook runner / plugin marketplace / desktop / remote channels。
- 不做 auto classifier、完整 Bash parser、完整 permission modal。
- 不用更多 closure/PASS 文档替代真实 smoke。

### A.13 Independent Final Recommendation

Codex 独立复审建议：

- **暂停 Phase 15 Beta**，直到真实 report-generation tool path PASS。
- **继续使用前文报告作为去过度设计修复基线**，但补充本附录中的 context/session、filesystem/Windows、MCP/plugins、docs/tests 等遗漏维度。
- **不要把全维度审计转成全维度重构**。这次审计暴露的问题很多，但下一轮修复仍应围绕 CCB 主链路一次性收敛，而不是铺开十条技术债。
- **Phase 15.5/16/17/18 必须重新绑定到 Phase 15 真实主链路结果**。如果 Phase 15 主链路没有 PASS，后续阶段不得推进。

## Appendix B. Operational / Packaging / Performance Maturity Re-Audit

> 本附录补充五个此前未完整覆盖的专项：Windows 兼容性、Build/Packaging、Dependency、Config Schema、Startup/Memory。  
> 方法：多智能体只读审计；未安装依赖、未联网审漏洞、未运行写入命令、未改代码。  
> 口径：只记录成熟度缺口和一次性收敛边界，不把这些专项转成“顺手补技术债”的任务清单。

### B.1 Appendix B Verdict

| Specialty | Verdict | Risk |
| --- | --- | --- |
| Windows compatibility | PARTIAL | 中。基础路径/UTF-8 使用尚可，但 smoke 脚本、shell 语义、CRLF 策略和 Windows path matrix 未成熟。 |
| Build / Packaging | PARTIAL | 中高。monorepo 基础好，但发布边界、dist 清洁度、Windows 双 bin、pack 校验不足。 |
| Dependency audit | PARTIAL | 中。运行时依赖面很小是优点，但缺安全治理、版本策略和自动审计机制。 |
| Config schema validation | FAIL/PARTIAL | 中高。settings 直接 cast + merge，缺运行时 schema 和写入前校验。 |
| Startup / memory | PARTIAL | 中高。help/version 轻路径好，但 TUI 首屏初始化和大 transcript/manifest/memory 有退化风险。 |

Operational 总裁决：这些专项不会替代 Phase 15 主链路修复，但它们会影响真实 Beta 的可复现性、安装发布可信度、配置安全和大项目稳定性。进入 Beta 前至少应把 Windows smoke 可复现、config schema、真实 report-generation gate 和明显发布边界风险列为阻塞或强提醒。

### B.2 Windows Compatibility Maturity

**Mature baseline**

- 路径全部通过 `node:path` 解析，并覆盖跨盘符、UNC、大小写、尾斜杠、中文/空格路径。
- 脚本不依赖单一 shell；关键 smoke 可在 cmd/PowerShell/Git Bash 下复现。
- 中文 stdin/stdout 明确 UTF-8 策略。
- spawn 区分“命令字符串走 shell”和“可执行文件 + args 不走 shell”。
- CRLF/LF 有仓库级策略。

**Linghun current**

- 多数路径使用 `join/resolve/relative`；内部显示路径统一 `/`。
- project id 已测试 Windows 分隔符和盘符大小写。
- JSON/log 基本显式 `utf8`。
- MCP CLI 使用 `spawn(command, args, { shell: false })`，方向较稳。
- 仓库追踪文件大体为 LF，仅发现少量 CRLF 工作区文件。

**Gaps**

- `smoke:tui-stdin` 使用 `printf ... | corepack pnpm exec linghun`，在 Windows cmd/PowerShell 下不成立。
- Bash 工具和 verification runner 使用 `spawn(command, { shell: true })`，实际语义受 cmd/PowerShell/Git Bash 差异影响。
- 缺跨盘符绝对路径、UNC、路径尾斜杠、保留名、空格/中文路径专项测试。
- 中文输出依赖 Node 字符串和 `utf8`，缺旧 Windows codepage 降级或探测。
- 缺 `.gitattributes` 或等价行尾策略。
- 部分脚本使用 `&&`，通常可跑，但 npm shell 配置不同时仍有风险。

**Risk**

中风险。阻塞点主要是 Windows smoke/验证命令不可复现、用户 Bash/verification shell 语义不稳定；路径基础尚可，但 UNC/跨盘符未证明。

**One-shot boundary**

- 将 `smoke:tui-stdin` 改为 Node 脚本式 stdin，而不是 shell `printf`。
- 为 Bash/verification 记录或明确当前 shell 策略。
- 补最小 Windows path matrix 测试。
- 增加 `.gitattributes` 固定文本行尾。
- 补中文 stdin/stdout UTF-8 smoke。

不要借机重构 TUI、权限、shell 框架或迁移所有脚本。

### B.3 Build / Packaging Maturity

**Mature baseline**

- workspace 拓扑清晰。
- 每个可发布包有稳定 `main/types/exports/files/bin`。
- 构建产物只包含运行与类型必需文件。
- CLI bin 在 Windows/macOS/Linux 安装后无大小写冲突。
- 发布前有 `prepack` / `npm pack --dry-run` / pack content 校验。
- bundle/tree-shaking 策略明确。
- `workspace:*` 发布转换路径明确。

**Linghun current**

- `pnpm-workspace.yaml` 覆盖 `apps/*` 与 `packages/*`。
- 根 `tsconfig.json` 使用 project references。
- 根脚本有 `build/typecheck/test/lint`。
- 子包多用 `tsup src/index.ts --format esm --dts --clean`；CLI 用 `tsup src/main.ts --format esm --clean`。
- CLI 源和产物都保留 shebang。
- 根包和 CLI 包都声明 `linghun` 与 `Linghun` 两个 bin。

**Gaps**

- 只有 `apps/cli/package.json` 设置 `files: ["dist"]`；库包未限制 `files`，发布会带入 src/tests/config。
- `packages/core/dist` 与 `packages/tui/dist` 存在 `*.test.d.ts`、`*.test.d.ts.map`、`tsconfig.tsbuildinfo`，发布干净度不足。
- `@linghun/cli` 缺 `main/types/exports`，若程序化引用边界不清。
- 同一 package 同时声明 `linghun` 和 `Linghun`，Windows 大小写不敏感文件系统上 npm/pnpm shim 可能冲突。
- 未见 `prepack`、`pack:check`、`publishConfig`、`npm pack --dry-run` 类脚本。
- 库包没有 `sideEffects` 标记；CLI 产物仍保留 `@linghun/*` import，bundle 策略未文档化。
- `workspace:*` 发布协议依赖 pnpm，非 pnpm 发布链路风险未说明。

**Risk**

中高。阻断级风险：Windows 双大小写 bin、发布产物污染、库包未限制 `files`。中风险：缺 pack 校验、CLI exports 边界、bundle 策略。

**One-shot boundary**

- 只收敛 package metadata、构建输出清洁、pack dry-run 校验、Windows bin 策略。
- 不拆 TUI 大文件，不重构源码，不调整测试组织。

### B.4 Dependency Audit Maturity

**Mature baseline**

- 单一包管理器与锁文件稳定提交。
- 运行时依赖与开发依赖分层明确。
- 外部运行时依赖少且可解释。
- 版本策略明确，有 audit / update / vulnerability response 机制。
- 每个 package 声明自己真正需要的依赖，避免隐式根依赖。

**Linghun current**

- 使用 pnpm workspace，只有一个 `pnpm-lock.yaml`。
- 根 `package.json` 声明 `packageManager: pnpm@10.10.0`、Node `>=22.0.0`。
- 外部直接依赖集中在根 `devDependencies`：Biome、Node types、tsup、TypeScript、Vitest。
- workspace 包运行时依赖基本为内部 `@linghun/*`。
- 源码运行时主要用 Node 内置模块。
- 静态搜索未发现明显外部未用直接依赖、重复库或直接版本冲突。

**Gaps**

- manifest 使用 caret range；lockfile 固定当前安装，但策略不是精确版本。
- 缺 Renovate/Dependabot、overrides/catalog、audit policy、license/SBOM、漏洞响应说明。
- 未联网/未运行 `pnpm audit`，无法确认 lockfile 是否有已披露 CVE。
- package 测试直接 import `vitest`，但子包未声明本地 devDependency，依赖根工具链。
- 根包 `private` 但依赖 `@linghun/cli` 并声明 bin，聚合包和可执行入口语义混合。
- 缺 `.npmrc` 中 strict peer / registry / scripts 策略。

**Risk**

- 外部运行时供应链：低。
- 开发工具链供应链：中。
- 版本漂移：中。
- workspace 依赖边界：低到中。
- 安全漏洞可见性：中。

**One-shot boundary**

- 明确版本策略：保留 caret 或改精确版本，二选一。
- 建立最小 audit/update/vulnerability response 说明。
- 如果自动化，只加一个 Renovate 或 Dependabot，不叠多套。
- 若收紧 package 边界，只处理测试/dev 依赖归属。
- overrides/catalog 只针对真实冲突或安全 pin。

不要借 dependency audit 升级全家桶、替换构建工具、拆 workspace。

### B.5 Config Schema Validation Maturity

**Mature baseline**

- `settings.json` 以 `unknown` 读入。
- merge 前后都经过运行时 schema 校验。
- 非法类型、未知 role/capability、错误 provider shape、错误 storage scope、错误 MCP/skills/plugins/hooks config 在 `loadConfig` 阶段失败并给出可操作错误。
- `writeConfig`、`saveModelRoute`、`saveExtensionEnablement` 写入前校验最终配置。

**Linghun current**

- `F:\Linghun\packages\config\src\index.ts` 中 `loadConfig` 直接 `JSON.parse(raw) as Partial<LinghunConfig>` 后进入 `mergeConfig`。
- `mergeConfig` 主要靠对象展开和少量 env / endpointProfile 归一化。
- env precedence 较明确，测试覆盖默认模型、OpenAI placeholder、endpoint/reasoning env。
- storage/mcp/skills/plugins/hooks 有默认配置，但 merge 后未验证类型。
- `writeConfig` 只是 JSON stringify。

**Gaps**

- 无统一 runtime config schema，无 merge 后最终态校验。
- TypeScript 类型无法约束用户手写 `.linghun/settings.json`。
- `modelRoutes.routes` 非数组可能在 load/merge 阶段崩溃。
- 非法 route 字段可能流入模型选择/权限判断。
- `skills/plugins.disabledIds/trustedIds` 非数组会影响启停和信任。
- `mcp.servers` 非对象或缺 `command` 会造成状态错误。
- `storage.scope/path` 非法会造成路径解析异常。
- 测试缺 malformed settings、非法 enum、错误数组、未知 provider、MCP shape、写入前校验失败。

**Risk**

中高。配置是用户可编辑输入，且影响 provider/model route、权限、MCP、hooks、skills/plugins 信任边界。

**One-shot boundary**

- 限定在 `packages/config/src/index.ts` 和 `packages/config/src/index.test.ts`。
- 新增最小 runtime schema/validator。
- `loadConfig` 对原始 JSON 与 merge 后最终配置校验。
- `writeConfig` 写入前校验。
- 补负向测试。

不要扩散到 provider 架构、route 策略、MCP/skills/plugins manifest 或 hooks 执行模型。

### B.6 Startup Performance / Memory Maturity

**Mature baseline**

- `--help` / `--version` 零重依赖快速返回。
- 进入 TUI 首屏前只做必要轻量初始化。
- plugins/skills/hooks/index/MCP 只加载 manifest 或状态摘要。
- session resume 不全量注入 transcript。
- 大输出、大索引、大记忆有截断、分页或上限。
- 冷启动、resume、大目录、大 session 有可测量预算。

**Linghun current**

- `apps\cli\src\main.ts` 很薄，`--help/--version` 是轻路径，不加载 TUI/model/MCP/index/plugins/cache。
- 无参数进入 TUI 后，会在首屏前等待 `loadConfig`、SessionStore、permissions、cache、MCP/index state、memory、skills、hooks、plugins 初始化。
- `/help`、`/status` 本身轻量。
- index status 不在启动时自动执行外部 codebase-memory，这点成熟。

**Cold-start / large-data gaps**

- TUI 冷启动读取 `LINGHUN.md` 全文后截断；异常大文件仍先整文件入内存。
- `createMemoryState` 读取 project/user memory 下全部 accepted `.json`，未见数量上限。
- `createSkillState` / `createPluginState` 读取 project/user 全部 JSON manifest，缺数量、大小、超时或并发上限。
- `createHookState` 内部再次调用 `createPluginState`，`runTui` 后续又调用一次，冷启动重复扫描/解析 plugin manifest。
- `/resume` 的 `SessionStore.resume` 一次性 `readFile` 整个 transcript，再 split/parse 全部事件。
- `/sessions` list 对每个 session 并发读 metadata，缺分页/limit。
- `/index init/refresh` safety scan 递归遍历目录，风险项有上限，但总遍历预算不足。
- `runCommandCapture` 对外部命令 stdout/stderr 用 Buffer 数组完整收集，仅 summary 截断；异常大输出仍有内存风险。

**Risk**

冷启动/大数据量退化：中高。内存风险：中。help/status：低。

**One-shot boundary**

- 先建立只读测量基线：`--help`、空 TUI `/exit`、大 `LINGHUN.md`、大量 memory JSON、skills/plugins JSON、历史 session metadata、超大 transcript resume。
- 明确预算：首屏时间、resume 时间、最大 heap、manifest 数量、transcript 行数。
- 只修直接风险：避免重复 plugin 扫描；给 manifest/memory/session list/resume 增加数量或读取上限；resume 改尾部/流式摘要读取；外部命令 stdout/stderr 加输出上限。

不要拆 8k 行 TUI，不做初始化架构重构，不新增插件系统抽象。

### B.7 Operational One-Shot Boundary

若后续要按 Appendix B 修复，边界应是：

1. Windows smoke 可复现：Node stdin smoke、最小 path matrix、LF 策略。
2. Packaging 可发布：清理 dist 污染、限制 files、pack check、处理 Windows bin 策略。
3. Dependency 可治理：确定版本策略和 audit/update policy，不升级全家桶。
4. Config 可校验：settings runtime schema + merge 后校验 + 写入前校验。
5. Startup 可测量：建立冷启动/大数据量预算和直接上限。

明确不要做：

- 不重构 TUI 大文件。
- 不替换构建系统。
- 不重做权限/provider/MCP/插件架构。
- 不把依赖审计变成全面升级。
- 不把性能审计变成架构拆分。
