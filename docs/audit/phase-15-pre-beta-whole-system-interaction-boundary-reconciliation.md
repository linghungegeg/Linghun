# Phase 15 Beta 前 Whole-System Interaction Boundary Reconciliation Audit

> 审计类型：只读交互边界审计（仅新增/更新审计与 handoff 文档；未修改源码）  
> 审计日期：2026-05-18  
> 审计范围：Phase 00-15 pre-Beta 已交付能力、Natural Command Bridge、TUI 主循环、provider/tool loop、权限管道、tool_result/evidence、MCP/index、cache/usage、memory/session、agents/multi-model/skills/workflows/hooks/plugins 与输出层交汇边界  
> 成熟参考：本地 CCB / CCB Dev Boost 行为边界，只参考交互、风险边界和验收标准；未复制源码、内部 API、专有实现或遥测逻辑

---

## 1. Executive verdict

**Verdict: PASS FOR PHASE 15 BETA SMOKE RESUME RECOMMENDATION**

> 2026-05-19 supersession note：本报告是 2026-05-18 的阶段性审计结论，已被后续 `phase-15-pre-beta-ccb-grade-runtime-acceptance-closure.md` 和 live provider / real TUI report-generation 補验更新。最新口径是：silent-failure gate PASS，live provider basic text smoke PASS，但 real TUI report-generation path 仍为 PARTIAL / blocking P1 candidate；Phase 15 Beta readiness 仍为 PARTIAL。不要单独引用本报告的 “PASS FOR PHASE 15 BETA SMOKE RESUME RECOMMENDATION” 作为最新 Beta readiness 结论。

当前源码相较前几轮已关闭若干 P0：真实 provider/model 路由、default 模式不静默执行 Bash/写入、无 pending confirmation 不进模型、provider tools/toolChoice 降级、tool_use/tool_result 主循环、key 脱敏和长输出截断均已有源码证据。

2026-05-18 最小完整修复后，Whole-System Interaction Boundary 原 4 项阻塞 P1 已关闭：组合状态查询、本地模型工具权限 primary prompt、失败 tool_result / permission denial evidence 延续、index safety repair loop 均已有源码和 focused tests 覆盖。因此可建议恢复 Phase 15 真人 smoke；仍不得自动进入 Phase 15 Beta，必须等待用户明确确认。

| 项 | 结论 |
| --- | --- |
| P0 | 0 |
| 阻塞 P1 | 0（原 4 项已关闭） |
| 非阻塞 P1 | 3 |
| P2 | 5 |
| 过度设计项 | 4 |
| 设计不足项 | 7（其中 4 项阻塞 P1 已最小修复） |
| 阶段错位项 | 3 |
| 是否建议暂停真人实测 | 历史结论：否；最新 2026-05-19 口径：先做 Verdict Evidence Gate，再决定是否修 real report-generation P1 或恢复真人 smoke |
| 是否允许恢复 Phase 15 Beta | 历史结论：可建议恢复真人 smoke；最新口径：Phase 15 Beta readiness 仍为 PARTIAL，不能自动进入 |
| 下一步 | 先做 Verdict Evidence Gate / Anti-Hallucination Runtime Closure；不进入 Phase 15 Beta / Phase 15.5 / Phase 16+ |

---

## 2. 参考核对

### 2.1 Linghun 文档与源码证据

本轮审计读取/使用的 Linghun 证据包括：

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-00-design-freeze.md` 至 `phase-15-natural-command-bridge.md`
- `docs/delivery/phase-15-pre-beta-ccb-deep-parity-closure.md`
- `docs/audit/reference-map.md`
- `docs/audit/phase-15-pre-beta-real-tui-provider-smoke-gap-review.md`
- `PHASE_15_PRE_BETA_FULL_INTERACTION_MATURITY_AUDIT.md`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/index.ts`
- `packages/providers/src/index.ts`
- `packages/tools/src/index.ts`

### 2.2 CCB / CCB Dev Boost 参考证据

本轮只读参考了以下 CCB 行为边界：

- `F:\ccb-source\src\utils\processUserInput\processUserInput.ts`
  - 普通自然语言进入模型主循环。
  - slash / local-jsx command 走本地命令路径。
  - hooks 可阻断并保留可解释下一步。
- `F:\ccb-source\src\utils\handlePromptSubmit.ts`
  - 输入提交、排队、处理中状态、abort controller、远程 bridge slash 降级边界。
- `F:\ccb-source\src\components\permissions\PermissionPrompt.tsx`
  - 权限提示以用户选择为中心，支持 accept/reject feedback、Tab 修改、Esc 取消。
- `F:\ccb-source\src\components\BuiltinStatusLine.tsx`
  - 状态栏显示模型、上下文用量、rate limit、cost；窄终端降级。
- `F:\ccb-source\src\commands.ts`
  - 命令系统集中注册 + lazy / feature gated command loading；普通自然语言不由本地 regex 直接替代模型。
- `F:\ccb-source\src\utils\permissions\permissions.ts`
  - 权限规则、ask/deny/allow、sandbox、classifier unavailable、deny tracking、hook 阻断等集中权限边界。
- `F:\ccb-source\src\query.ts`
  - tool_use/tool_result 是模型主循环的一等消息；缺失 tool_result 时生成错误 tool_result；tool result budget / summary 是主链路能力。

### 2.3 禁止事项确认

- 未复制 CCB / CCB Dev Boost / Claude Code / OpenCode 源码。
- 未复制内部 API、专有协议、遥测字段或反编译痕迹。
- 本报告只吸收成熟行为边界：输入分流、权限提示、tool_result 延续、状态/输出层和错误恢复。

---

## 3. CCB 成熟边界总表

| 边界 | CCB 成熟行为 | Linghun 当前对齐度 | 审计结论 |
| --- | --- | --- | --- |
| 普通自然语言 | 默认进入模型主循环，由模型决定是否 tool_use | Linghun 通过 NCB 先本地裁决；普通开发请求回落 `model` | 方向可接受，但需避免过拦截和单 capability 截断 |
| slash / 控制面 | 本地 command / local-jsx 执行，不污染模型 | Linghun slash 本地处理，NCB 可本地处理 status/doctor/help | 基本对齐 |
| 权限 | 工具 ask 时给用户明确选择，并可附带反馈 | default 模式对写/Bash 返回 ask/deny；模型 tool ask 不直接展示交互式 prompt | 阻塞 P1 |
| tool loop | tool_use → tool_result → next assistant turn 是主路径 | 已实现 OpenAI-compatible tool_calls/tool role 与 transcript tool_result | 基本对齐，但失败跨 turn 延续不足 |
| evidence | 工具结果可被后续回答引用，长输出预算化 | 成功 tool evidence 进入 EvidenceSummary；失败 tool_result 不进入 evidence summary | 阻塞 P1 |
| 输出 | primary 简洁，details/debug 可展开或路径化 | 有主输出截断与 fullOutputPath；缺少一致 details/debug 分层 | 非阻塞 P1 |
| 状态栏 | model/context/rate/cost 等紧凑显示 | 显示 session/provider/model/mode/bg/cache/index/gate；不显示 context/rate | 非阻塞 P1/P2 |
| index/cache/memory | 降成本、降上下文，不成为用户负担 | index/cache/memory 状态可见，但 index safety 的修复动作不可连续 | 阻塞 P1 |
| 失败恢复 | 中断、hook 阻断、max token/tool result 缺失都有恢复路径 | SIGINT/Abort/tool error 有基础路径；跨模块恢复提示仍碎片化 | 阻塞 P1 |

---

## 4. 全局矩阵 1：输入分流矩阵

| 输入类型 | 成熟边界 | Linghun 当前路径 | 状态 | 缺口 |
| --- | --- | --- | --- | --- |
| `/help`、`/model`、`/index status` 等显式 slash | 本地处理 | `handleSlashCommand()` 本地分发 | PASS | 35+ 路 if 链可维护性差，但不阻塞 |
| 普通开发请求：“修这个 bug / 解释这段代码” | 进入模型 + tool_use | `routeNaturalIntent()` 返回 `model` 后 `sendMessage()` | PASS | 需继续用行为测试防止 NCB 过拦截 |
| 状态查询：“现在什么模型 / index ready 吗” | 本地状态，不进模型 | `execute_readonly` 或等价 slash | PASS | 单一 capability 可以，组合查询不足 |
| 组合状态：“模型、索引、权限都准备好了吗” | 本地组合 RuntimeStatus summary | 当前 router 只选 top capability | BLOCKING P1 | 需要 composite status，不应只答一个模块 |
| doctor 查询：“key 配好了吗 / provider 为什么 400” | 本地 doctor + next step | `/model doctor`、provider error classifier | PASS | provider 不支持 tools 的 TUI 层判断偏弱 |
| safe local action：“刷新索引 / init fast” | 明确 start/safety，失败可继续 | NCB safe_local_action → `/index init fast|refresh` | CONDITIONAL | safety 失败后缺少 plan→permission→retry |
| dangerous action：“跑 Bash / 写文件 / 改权限” | 权限管道，不自然直通 | `permission_pipeline` 或 tool permission | PASS | 模型 tool ask 的用户提示不足 |
| 无 pending 的 “yes/继续/确认” | 本地拒绝，不进模型 | `handleNaturalInput()` 拦截 | PASS | 已对齐 |
| 模糊请求 | 澄清，不执行 | `ask_clarify` | PASS | 需覆盖 combo/multi-intent |

---

## 5. 全局矩阵 2：运行状态矩阵

| 状态 | 成熟边界 | 当前能力 | 状态 | 缺口 |
| --- | --- | --- | --- | --- |
| idle | 状态栏准确显示模型/权限/缓存/index/gate | `writeStatus()` 显示 provider/model/mode/bg/cache/index/gate | PASS | 不显示 context/rate limit，非阻塞 |
| model pending | 显示请求中，可 interrupt | `Status: requesting model...` + AbortController | PASS | pending 细分少 |
| tool running | tool progress 进入 transcript + output | `installToolProgressHandler()` + background task | PASS | Bash 以外工具进度较粗 |
| permission ask/deny | ask 必须有用户可操作 next step | slash tool deny 会显示；模型 tool deny 只回传模型 | BLOCKING P1 | 模型 tool permission request 需要 primary prompt 或统一提示 |
| index safety paused | 保留 structured state，可继续修复 | `safetyWarning/error` 写入 `context.index` | CONDITIONAL | 缺“一键/明确命令写 ignore→重试”的连续流程 |
| tool failure | tool_result 错误进入同轮模型 | `appendToolResultEvent(... isError=true)` | CONDITIONAL | 下一轮 evidence summary 不含失败 tool_result |
| interrupted | abort + 状态恢复 | SIGINT / `/interrupt` 基础存在 | PASS | 复杂 tool chain 恢复提示不足 |
| session resume | HandoffPacket 而非完整 transcript | Phase 11/12 已实现 | PASS | 需确保失败 evidence 带入 handoff |

---

## 6. 全局矩阵 3：风险边界矩阵

| 风险类型 | 当前守卫 | 成熟边界判定 | 状态 |
| --- | --- | --- | --- |
| 工作区越界 | `getHardDenyReason()` 阻断 root/outside workspace | 必须阻断 | PASS |
| `.git` 修改 | hard deny | 必须阻断 | PASS |
| `.ssh` / `.env` / secret path | hard deny | 必须阻断 | PASS |
| Bash 空命令 / rm -rf / curl pipe sh | hard deny | 必须阻断 | PASS |
| default 写/Bash | ask + 不执行 | 必须不静默执行 | PASS |
| plan mode 写/Bash | deny | 必须只读 | PASS |
| acceptEdits | 低风险 workspace edit 自动允许 | 可接受，但需 diff/preflight | CONDITIONAL，当前 `isLowRiskWorkspaceEdit()` 对 Write medium 不放行，偏保守 |
| bypass | env opt-in 后 allow，hard deny 仍生效 | 必须显式 opt-in | PASS |
| auto | classifier unavailable 时拒绝 | fail closed | PASS |
| third-party skill/plugin/hook | 信任/权限可见，不自动执行 | 必须隔离 | PASS |
| model tool permission ask | 不应只靠模型复述 | 应有本地 primary prompt | BLOCKING P1 |

---

## 7. 全局矩阵 4：tool_result / evidence 延续矩阵

| 场景 | 当前实现 | 成熟边界 | 状态 |
| --- | --- | --- | --- |
| 成功 Read/Grep/Glob | `tool_result` + `recordToolEvidence()` + `EvidenceSummary` | 可被后续模型引用 | PASS |
| 成功 Write/Edit/Bash/Todo | `tool_result` + changedFiles/background/log | 可追踪 | PASS |
| 失败工具调用 | 写 transcript `tool_result isError=true` | 同轮模型可恢复，下一轮也应可问 | CONDITIONAL |
| 权限拒绝 | 写 permission_request/result + tool_result error | 用户应立刻看到可操作权限提示 | BLOCKING P1 |
| 长输出 | 主输出截断，fullOutputPath 或 transcript/evidence | 不污染主屏 | PASS |
| index query | `evidence_record kind=index_query` | 可引用 | PASS |
| index safety failure | `context.index.safetyWarning/error` | 应成为可问、可继续、可修复状态 | BLOCKING P1 |
| handoff | HandoffPacket 有 evidenceRefs/indexStatus | 不注入完整 transcript | PASS |
| failure evidence in handoff | 未见失败 tool_result 纳入 evidence summary | 后续应知道失败原因 | BLOCKING P1 |

---

## 8. 全局矩阵 5：输出层矩阵

| 输出层 | 成熟边界 | 当前表现 | 状态 |
| --- | --- | --- | --- |
| primary | 简短说明、下一步、用户语言 | 多数命令 summary-first；工具输出有截断 | PASS |
| permission primary | action/risk/scope/reason/choices | slash deny 有 reason；模型 tool ask 缺本地选择 | BLOCKING P1 |
| details | 可展开或路径化细节 | fullOutputPath/log/transcript/evidence 存在 | CONDITIONAL |
| debug | 不污染普通输出 | doctor/status 暴露技术细节但可接受 | CONDITIONAL |
| long output | 主屏截断 | Read/Grep/Glob/Todo 已处理 | PASS |
| status line | 简洁稳定 | 显示 provider/model/mode/bg/cache/index/gate | PASS |
| CCB parity | context/rate/cost 等成熟信息 | Linghun 不显示 cost 是设计选择；context/rate 不足 | NON-BLOCKING P1/P2 |

---

## 9. 全局矩阵 6：模块交汇矩阵

| 模块交汇 | 当前状态 | 风险 | 判定 |
| --- | --- | --- | --- |
| NCB ↔ slash dispatch | Catalog/registry drift test 存在 | 双表维护，长期漂移 | P2 / 过度设计 |
| NCB ↔ model loop | ordinary request 回 model，system prompt 带 capability summary | combo intent 被 top capability 截断 | BLOCKING P1 |
| model loop ↔ tools | `tool_use` → `executeModelToolUse()` → `tool` role message | permission ask 不直接用户可见 | BLOCKING P1 |
| tools ↔ permissions | 同用 `decidePermission()` | 基本统一 | PASS |
| tools ↔ evidence | 成功工具 evidence 化 | 失败/拒绝证据化不足 | BLOCKING P1 |
| index ↔ safety ↔ permissions | safety scan 暂停 | 缺修复/写 ignore/retry 的连续闭环 | BLOCKING P1 |
| provider ↔ tools | supportsTools 可降级 | TUI 层只看 known model；gateway 可兜底 | NON-BLOCKING P1 |
| provider ↔ doctor | key/source/masked/route doctor | 基本对齐 | PASS |
| cache ↔ usage ↔ status | `/usage` `/stats` 与状态栏 cache | context/rate 不足 | P2 |
| session ↔ handoff ↔ evidence | structured handoff | failure evidence 不足 | BLOCKING P1 |
| skills/workflows/plugins/hooks ↔ permissions | 默认不自动执行，trust visible | 功能面多，学习成本上升 | 过度设计 / 阶段错位风险 |

---

## 10. Linghun 当前全系统交汇矩阵

| 用户意图 | NCB | TUI | Permission | Tool loop | Evidence | Output | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 查看模型状态 | execute_readonly `/model` | 本地 handler | 无 | 无 | 无 | status + route | PASS |
| 询问模型 key | doctor `/model doctor` | 本地 handler | 无 | 无 | 无 | masked source | PASS |
| 普通代码问题 | model | `sendMessage()` | 按 tool_use 决策 | 有 | 成功有 | 模型流式 | PASS |
| 模型请求 Read | model | execute tool | default allow | tool_result | evidence | 工具摘要 | PASS |
| 模型请求 Bash | model | executeModelToolUse | default ask/deny | error tool_result | 失败 evidence 不足 | 依赖模型复述 | BLOCKING P1 |
| 刷新索引 | safe local | `/index refresh` | safety scan | MCP CLI | index state | status | CONDITIONAL |
| 索引 safety 失败后继续 | 无专用 workflow | 只提示 ignore/force | 写 ignore 需另起工具权限 | 无连续 retry | state 有 warning | next step 粗 | BLOCKING P1 |
| combo status | 单 capability | 单 handler | 无 | 无 | 无 | 只答一部分 | BLOCKING P1 |
| 长输出工具 | 无 | formatter | 视工具 | tool_result | evidence/fullOutputPath | 截断 | PASS |
| resume/handoff | slash | structured packet | 无 | 无 | evidenceRefs | summary | PASS |

---

## 11. NCB 应保留本地处理清单

这些请求继续不应进入模型主 loop：

- `/help`、命令用途、功能策略、版本/状态类说明。
- `/status`、当前 provider/model、permission mode、cache/index/memory/agent/background 状态。
- `/model doctor`、provider key/source/masked preview、route doctor。
- `/index status`、`/index architecture`、短结果 `/index search`。
- `/mcp status/tools/doctor`。
- 无 pending gate 的 `yes/确认/继续/ok`。
- 明确危险动作的风险说明和拒绝/审批入口。
- third-party skill/plugin/hook trust 边界说明。

---

## 12. NCB 应收回到模型 tool loop 清单

这些请求不应继续扩大本地关键词处理，应进入模型主 loop，由模型按需发起 tool_use：

- “帮我理解这个报错并修复”。
- “看一下这个文件哪里有问题”。
- “给我一个最小修复方案”。
- “根据刚才 grep 结果继续分析”。
- “把失败的原因解释一下并给下一步”。
- “这个项目现在还能不能进入 Beta，证据是什么”。
- 所有普通 coding / audit / reasoning 请求，除非明确是本地控制面状态查询。

---

## 13. 应进入权限管道清单

- Write / Edit / MultiEdit。
- Bash / install / network / dependency / delete / rename / restore。
- permission rule add/remove/change。
- config write：language/model route/settings/skills/plugins enable 等。
- index force rebuild / full indexing / high-cost indexing。
- third-party skill/plugin/hook activation。
- remote bridge/channel/control。
- checkpoint restore / rewind。

---

## 14. 应拒绝并给下一步清单

- 修改 `.git`、`.ssh`、`.env`、secret path。
- workspace 外写入或写 workspace root。
- `rm -rf`、`curl | sh`、`wget | bash`、`mkfs`、`shutdown`、`reboot`。
- 未开启 env opt-in 的 bypass。
- classifier unavailable 的 auto 高风险执行。
- 无 pending gate 的普通确认。
- provider key 缺失时继续真实 API 调用；应给 `/model doctor` next step。
- index safety scan 命中大文件时继续全量索引；应先给 ignore/force 的明确路径。

---

## 15. 过度设计清单（4）

| ID | 项 | 影响 | 建议 |
| --- | --- | --- | --- |
| OD-1 | NCB Catalog + slash registry + handleSlashCommand 三套映射 | 长期漂移和维护成本 | 不在本轮大重构；仅补 composite/status 测试，Phase 15.5 再考虑 registry map |
| OD-2 | Phase 14 skills/workflows/hooks/plugins 暴露面早于真实 Beta | 新手学习成本上升 | 默认继续 summary-first，不自动执行；文档中降噪 |
| OD-3 | 多模型 role routing 信息过早进入状态/doctor | 对 Beta 手感有噪音 | 保留 doctor，不扩大状态栏 |
| OD-4 | index/mcp/cache/memory 状态项过多但组合查询不足 | 功能多但用户问法不自然 | 做最小 composite status，不新增第二套系统 |

---

## 16. 设计不足清单（7）

| ID | 项 | 严重度 | 说明 |
| --- | --- | --- | --- |
| UD-1 | 组合状态查询缺 composite local answer | 阻塞 P1 | “模型、索引、权限都准备好吗”不应只答一个 capability |
| UD-2 | 模型 tool permission ask 缺直接用户可见 prompt | 阻塞 P1 | ask/deny 只作为 tool_result 回模型，用户体验不等价 CCB |
| UD-3 | 失败 tool_result 跨 turn evidence 延续不足 | 阻塞 P1 | 成功 evidence 有，失败/拒绝没有同等 summary |
| UD-4 | index safety scan 缺 plan→permission→write ignore→retry 连续闭环 | 阻塞 P1 | safety state 有，但下一步仍需要用户拼流程 |
| UD-5 | details/debug 输出层不统一 | 非阻塞 P1 | 主输出已有截断，但无统一 details/debug 命令或开关 |
| UD-6 | provider supportsTools 的 TUI 层判断只看 known model | 非阻塞 P1 | gateway 会兜底，但提示和状态可能不精确 |
| UD-7 | 状态栏缺 context/rate limit 提示 | P2 | 不阻塞 Beta，但低于 CCB 成熟信息密度 |

---

## 17. 未参考 CCB 成熟边界清单

当前仍未完全吸收的 CCB 成熟边界：

- PermissionPrompt 的 accept/reject feedback 与 Esc/Tab 修改路径。
- tool_result 缺失/失败时的恢复消息作为一等 user/tool_result continuation。
- tool result budget 与 tool summary message 的一致预算化策略。
- 状态栏 context/rate limit 的紧凑可见性。
- hook 阻断后“保留原始 prompt / 给下一步”的成熟提示形态。
- command registry lazy loading 可维护性；Linghun 当前仍是长 if 链 + Catalog 双维护。

---

## 18. 阶段错位清单（3）

| ID | 项 | 判定 | 处理 |
| --- | --- | --- | --- |
| SA-1 | 把基础 permission prompt 手感推到 Phase 15.5 | 不允许 | Phase 15 Beta 前必须至少有文本 primary prompt |
| SA-2 | 把 tool failure/evidence continuation 留到学习/记忆阶段 | 不允许 | Phase 15 Beta 前 tool_result 后续可问性必须闭环 |
| SA-3 | 把基础 terminal output details/debug 分层留到桌面阶段 | 不允许 | Phase 18 只做桌面壳；终端基础手感在 Beta 前闭合 |

---

## 19. 自研优势是否增加学习成本清单

| 自研能力 | 优势 | 学习成本 | 结论 |
| --- | --- | --- | --- |
| NCB 本地裁决 | 比 CCB 更保守，降低误执行风险 | 用户可能看到 Start Gate/permission_pipeline 术语 | 保留，但 primary 输出应更人话 |
| RuntimeStatusForModel | 减少模型猜状态 | system prompt 增加技术面 | 保留，不暴露给普通用户 |
| CommandCapabilityCatalog | 可审计、可双语、可漂移检测 | 三套映射维护成本 | 保留，Phase 15.5 再整理 |
| index/cache/memory | 降成本、提升续接 | 状态项多 | 需要 composite status 降学习成本 |
| skills/workflows/plugins/hooks | 长期扩展能力 | Beta 前认知负担偏高 | 默认隐藏复杂度，继续不自动执行 |

---

## 20. P0 / P1 / P2 / not-do 分类

### 20.1 P0

无新增 P0。当前源码已覆盖以下前置 P0：

- 真实 `tool_use` / `tool_result` 主 loop。
- default 模式不静默执行 Bash/写入。
- 无 pending confirmation 不进模型。
- provider/model 不再固定 deepseek。
- API key doctor 脱敏。
- 长输出主输出截断。

### 20.2 阻塞 P1（Beta 恢复前必须修）

| ID | 问题 | 最小修复边界 | 2026-05-18 最小修复状态 |
| --- | --- | --- | --- |
| BP1-1 | 组合状态/doctor 查询被单 capability 截断 | 增加 composite status intent：model/index/permission/cache/memory/mcp/background/provider 至少可多项汇总 | 已关闭：`handleNaturalInput()` 增加轻量 composite local status，不新增第二套命令解释系统；中文/英文组合状态 focused test 覆盖 |
| BP1-2 | 模型 tool permission ask/deny 缺本地 primary prompt | `executeModelToolUse()` 在 ask/deny 时直接输出 action/risk/scope/reason/next choices，并写入 transcript | 已关闭：模型工具非 allow 时输出 tool/decision/risk/mode/reason/scope/next，本地提示先于 tool_result 回灌 |
| BP1-3 | 失败 tool_result / permission denial 跨 turn evidence 不足 | 为失败 tool_result 和 permission denial 记录轻量 evidence summary，进入 EvidenceSummary/handoff | 已关闭：模型工具 permission 非 allow、工具失败和 slash 工具 permission denial 记录轻量 `command_output` failure evidence，并在 error tool_result 中附 evidenceId |
| BP1-4 | index safety scan 暂停后缺连续修复闭环 | safety warning 生成可执行 next steps：建议 ignore 条目、明确 `/write` 或手动编辑路径、重试 `/index refresh`，写入 index state/evidence | 已关闭：index safety pause 输出阻塞原因、`.linghunignore` / `.cbmignore`、建议条目、手动或明确 `/write` 路径、`/index refresh` retry，并记录 index evidence |

### 20.3 非阻塞 P1

| ID | 问题 | 处理 |
| --- | --- | --- |
| NP1-1 | provider supportsTools TUI 层提示不完全依赖 provider config | Beta 中可观察；最好 focused test 覆盖 |
| NP1-2 | output details/debug 缺统一展开机制 | Phase 15.5 polish 可做，但 primary 不得污染 |
| NP1-3 | Permission feedback（accept/reject with feedback）不如 CCB | Beta 可先文本化；完整 UI 可后置 |

### 20.4 P2

- 状态栏 context 使用率。
- rate limit / quota 提示。
- registry map 化减少长 if 链。
- hook/plugin/skill help 降噪。
- 更完整的 tool result budget 和 summary display。

### 20.5 not-do

- 不进入 Phase 15 Beta。
- 不进入 Phase 15.5 / Phase 16+。
- 不复制 CCB 源码或内部实现。
- 不新增第二套命令解释系统。
- 不做大规模 registry/dispatch 重构。
- 不把所有 CCB 状态栏字段照搬进 Linghun；cost 不进状态栏是当前设计选择。

---

## 21. 下一轮最小完整修复方案

### 21.1 目标

只关闭 4 个阻塞 P1，让真人 Phase 15 Beta smoke 可恢复；不新增阶段、不扩散架构、不做美化重构。

### 21.2 最小改动边界

1. **Composite RuntimeStatus answer**
   - 在 NCB 增加组合状态识别或在 `handleNaturalInput()` 增加 lightweight composite 检测。
   - 只覆盖 model/provider、index、permission、cache、memory、mcp、background、gate。
   - 输出 5-8 行 summary，不进入模型。

2. **Model tool permission primary prompt**
   - 在 `executeModelToolUse()` permission 非 allow 时立即 `writeLine()`。
   - 输出内容必须包含：tool、risk、mode、reason、next action。
   - 不做交互式 UI；先文本化，避免 silently hidden。

3. **Failure evidence continuation**
   - `appendToolResultEvent(... isError=true)` 同步记录轻量 `EvidenceRecord` 或 failure summary。
   - EvidenceSummary 保持最多 5 条，失败摘要不可过长。
   - HandoffPacket 可引用 failure evidence。

4. **Index safety repair loop**
   - `formatIndexSafetyWarning()` / `formatIndexStatus()` 增加具体下一步：建议 ignore 文件路径、建议条目、手动编辑或明确 `/write` 路径、重试命令。
   - safety pause 写入 evidence_record，使用户后续问“继续刚才索引失败”时可恢复。

### 21.3 不做内容

- 不做 full interactive PermissionPrompt。
- 不做 registry/dispatch map 化。
- 不做完整 output details/debug UI。
- 不做 provider adapter 大改。
- 不做 Phase 15.5 model maturity / web freshness / open-source readiness。

---

## 22. Focused tests 建议

必须补或复跑以下行为测试：

1. 中文组合状态：`模型和索引都准备好了吗，权限现在是什么模式？`
   - 期望：本地 composite summary，包含 provider/model、index、permission，不进模型。
2. 英文组合状态：`Are model, index and permissions ready?`
   - 期望：同等本地 summary。
3. 模型请求 Bash（default mode）。
   - 期望：不执行；主输出直接显示 permission ask/deny next step；tool_result error 写 transcript。
4. 模型请求 Write/Edit（default mode）。
   - 期望：不执行；主输出直接显示 action/risk/scope/reason。
5. 工具失败后追问：`刚才工具为什么失败，下一步是什么？`
   - 期望：模型/本地回答能引用失败 tool_result/evidence summary。
6. index safety scan 命中大文件。
   - 期望：status 保存 warning；输出给出 ignore 文件和 retry 命令；后续追问可恢复。
7. 无 pending `yes/确认/继续`。
   - 期望：本地拒绝且不进模型。
8. provider supportsTools=false。
   - 期望：不发送 tools/toolChoice，doctor/status 说明能力不足。
9. 长 Read/Grep/Glob 输出。
   - 期望：主输出截断，fullOutputPath/transcript/evidence 保留。
10. Windows 路径与中文输出。
    - 期望：不出现 `/workspace`，无 mojibake。

---

## 23. 是否必须暂停真人实测

**否，可建议恢复 Phase 15 真人 smoke；但仍不得自动进入 Phase 15 Beta。**

> Superseded：本节是 2026-05-18 旧口径。2026-05-19 live provider / real TUI report-generation 補验后，最新口径改为先做 Verdict Evidence Gate / Anti-Hallucination Runtime Closure；real report-generation path 仍为 PARTIAL / blocking P1 candidate，是否恢复真人 smoke 需重新按最新证据判断。

2026-05-18 最小完整修复后，原暂停理由已关闭：

- 组合状态查询已能返回多模块本地 summary。
- 模型 tool 被权限拒绝时已输出本地 primary prompt。
- 工具失败和 permission denial 已记录轻量 failure evidence，模型 error tool_result 附带 `evidenceId`。
- index safety pause 已输出 ignore 文件、建议条目、手动或明确 `/write` 路径、`/index refresh` retry，并记录 index evidence。

因此当前可建议恢复真人 smoke；是否正式进入 Phase 15 Beta 仍必须由用户明确确认。

---

## 24. 是否允许恢复 Phase 15 Beta

**可建议恢复真人 Phase 15 Beta smoke，但仍不得自动进入 Phase 15 Beta。**

> Superseded：本节是 2026-05-18 旧口径。2026-05-19 最新口径为 Phase 15 Beta readiness PARTIAL；live provider basic text PASS 不能推导 Beta readiness PASS。

2026-05-18 最小修复后状态：

1. BP1-1 到 BP1-4 已完成最小修复。
2. focused tests 已覆盖中文/英文组合状态、模型工具 permission primary prompt、失败 evidence 延续、index safety repair loop。
3. 已完成 focused tests 与 `corepack pnpm typecheck`；完整 `test/check/build/help/diff-check` 仍需在最终验证段记录。
4. START_NEXT_CHAT 和 delivery/audit 文档同步写明：仍未自动进入 Phase 15 Beta，恢复真人实测需要用户明确确认。

---

## 25. Handoff packet

| 字段 | 内容 |
| --- | --- |
| 当前阶段 | Phase 15 pre-Beta whole-system interaction boundary reconciliation minimal fix |
| verdict | Superseded by 2026-05-19 runtime/live smoke evidence：Phase 15 Beta readiness PARTIAL |
| 下一阶段 | 先做 Verdict Evidence Gate / Anti-Hallucination Runtime Closure；是否修复 real report-generation P1 或进入 Phase 15 Beta 仍需用户明确确认 |
| 禁止事项 | 不自动进入 Phase 15 Beta、Phase 15.5、Phase 16+；不提交；不复制 CCB 源码；不做大重构 |
| P0 | 0 |
| 阻塞 P1 | 0（原 4 项已关闭） |
| 已关闭阻塞 | composite status、model tool permission primary prompt、failure evidence continuation、index safety repair loop |
| 索引状态 | codebase-memory 项目 `F-Linghun` ready；nodes=880；edges=1697 |
| 权限模式 | 本轮为最小源码/测试/文档修复；未进入 Beta |
| provider/model | 审计对象源码支持真实 provider/model；当前会话未进入 Linghun 产品运行态 |
| 预算/成本 | 未做联网成本查询；只做本地源码、测试与文档验证 |
| 验证要求 | focused tests、full test、check、typecheck、build、help smoke、git diff --check |

---

## 26. Final answer fields

- 报告路径：`F:\Linghun\docs\audit\phase-15-pre-beta-whole-system-interaction-boundary-reconciliation.md`
- verdict：Superseded historical verdict; latest Phase 15 Beta readiness is PARTIAL
- P0 数量：0
- 阻塞 P1 数量：0（原 4 项已关闭）
- 过度设计项数量：4
- 设计不足项数量：7（其中 4 项阻塞 P1 已最小修复）
- 阶段错位项数量：3
- 是否建议暂停真人实测：最新口径为先做 Verdict Evidence Gate，再决定是否修 real report-generation P1 或恢复真人 smoke
- 是否允许恢复 Phase 15 Beta：否，当前 readiness 仍为 PARTIAL，必须用户明确确认且补齐 gate 条件
- 下一步是否建议先做最小完整修复：是，先做 Verdict Evidence Gate / Anti-Hallucination Runtime Closure
