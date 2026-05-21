# Phase 15 pre-smoke Batch B：Architecture Runtime source-of-truth 设计补齐

日期：2026-05-21

## 1. 范围与结论

本轮只补齐 Architecture Runtime v1 的 source-of-truth / implementation design，不做 runtime 代码实现，不做 Batch C，不进入真实项目 smoke，不进入 Phase 15.5 / 16+，不提交 commit。

Batch B 结论：可以在用户确认后进入 Batch C，但 Batch C 只允许做 Architecture Runtime 最小成熟实现和 focused tests。Batch B 文档完成不代表 Phase 15 Beta PASS，也不代表 smoke-ready。

## 2. 已读取 source-of-truth

- `README.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/README.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/audit/reference-map.md`
- `docs/audit/phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md`

## 3. 已抽样 runtime 事实

只读检查了 Batch C 需要的最小接入点：

- 普通输入进入模型主链路的位置在 `packages/tui/src/index.ts`：`sendMessage()` 构造 `RuntimeStatusForModel`，再调用 `createModelSystemPrompt()`、`buildModelMessagesWithRecentContext()` 和 provider gateway。
- Anti-Hallucination / evidence 已有轻量基础：`EvidenceRecord`、`createEvidenceSummaryForModel()`、`recordToolEvidence()`、`evidence_record` transcript event。
- NCB/control-plane 边界在 `packages/tui/src/natural-command-bridge.ts`：`RuntimeStatusForModel` 和 Command Capability Catalog 只处理状态/控制意图，不应承载 Architecture Runtime。
- 权限和工具闭环已存在：模型 `tool_use` 进入 `executeModelToolUse()`，再经 `decidePermission()`、`runTool()`、`tool_result` 和 continuation；Architecture Runtime 不得绕过该链路。
- 轻量持久化已有位置：`appendSystemEvent()`、`evidence_record`、`writeHandoffPacket()` / `handoff-latest.json`。
- 目前没有 Architecture Card 类型、`currentArchitectureCard` handoff 字段或 drift 检测实现；这些属于 Batch C。

## 4. Active docs 修改清单

- `README.md`：同步 Batch B 报告入口和“不等于 Beta PASS / smoke-ready”的口径。
- `START_NEXT_CHAT.md`：同步新会话必读入口、当前任务状态、Batch C 下一步和 Architecture Runtime card / persistence / drift 边界。
- `docs/delivery/README.md`：在 Phase 15 preflight 行登记 Batch B 报告，明确 Batch B 仅设计、不实现 runtime。
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`：补齐轻量持久化、drift 和 Batch C focused-test 验收边界。
- `LINGHUN_IMPLEMENTATION_SPEC.md`：补齐 Batch C 可直接实现的 Architecture Runtime v1 规格。
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`：在一轮对话流程中放入 Architecture Runtime guard，并补轻量 card 口径。
- `docs/audit/reference-map.md`：增加 Batch B 报告作为 Phase 15 pre-smoke Batch B/C 的实现设计入口。

## 5. Architecture Runtime v1 边界

Architecture Runtime v1 是普通对话链路前的轻量工程判断 guard，只在系统性工程任务上触发；不是第五个权限模式、不是 Plan Mode、不是 skill、不是 prompt-only 文案、不是 agent、不是 ADR DB、不是完整 spec 平台。

它与 Anti-Hallucination Runtime 分工：

- Anti-Hallucination Runtime 负责 facts / evidence / source / boundaries / unknown。
- Architecture Runtime 负责工程方向、技术选择、阶段拆解、风险、验证路线和长期可维护性。

触发：

- 跨文件 / 跨模块。
- 公共接口变更。
- 依赖或配置变更。
- 部署、性能、安全相关任务。
- 新系统 / 新功能。
- 系统性缺口。
- 用户要求 mature / complete / reference-aligned / no omissions。

不触发：

- typo。
- 单文件小 bug。
- 只读状态查询。
- 简单解释。
- 用户明确要求只改一处。
- 用户要求直接修一个本地小问题。

Architecture Card 字段固定为：

- `target`
- `projectFacts`
- `recommendedApproach`
- `rejectedApproaches`
- `stagedBreakdown`
- `risks`
- `verification`
- `nonGoals`

Freshness / evidence 边界：项目事实只能来自 README、package/config、当前源码风格、索引、evidence 或 tool result。涉及最新版本、provider/API 当前行为、社区项目现状、模型价格、安全公告、部署平台规则或第三方方案对比时，必须按需走 Freshness/Web Evidence 并写 `web_source` evidence。未授权联网、联网失败或来源冲突时只能写 `unknown` / `stale`，不能把模型记忆当当前事实。

持久化边界：允许 transcript `system_event`、短 `evidence_record`、handoff latest 的 `currentArchitectureCard` 摘要；不新增 DB，不写长期 memory，除非用户明确接受；普通模型 prompt 只注入短摘要或 evidence id，不重复注入完整 card，不污染 cache prefix / stable context。

Drift 边界：后续动作如果修改 `nonGoals` 覆盖内容、增加 card 未提及的依赖/配置、扩散到未提及模块、跳过 verification、改变 `recommendedApproach`，或把 unknown/stale 外部事实当确定事实，必须 warning 并要求用户确认或更新 card。

## 6. Batch C 最小实现建议

建议只改 Batch C 必需位置：

1. 在 `packages/tui/src/index.ts` 的普通模型请求前接入 guard：`buildRuntimeStatusForModel()` 之后、`createModelSystemPrompt()` / `buildModelMessagesWithRecentContext()` 之前。
2. 在 TUI runtime 附近新增最小 Architecture Card 类型与状态，不新增 agent / DB / spec 平台。
3. 复用现有 evidence / system_event / handoff 机制，不新增持久化系统。
4. 在写入、Bash、依赖/配置或跨模块动作进入权限/工具执行前做最小 drift 检测；只 warning + 要求确认/更新，不替代权限审批。
5. 保持 NCB 只处理控制面；Architecture Runtime 只处理普通工程任务 guard。

Batch C 函数边界：

```ts
shouldTriggerArchitectureRuntime(input, context)
collectArchitectureFacts(context)
formatArchitectureCard(card)
detectArchitectureDrift(card, nextAction)
```

实现约束：

- 小任务不得被强制 plan 化。
- Architecture Runtime 不改变 `default` / `auto-review` / `plan` / `full-access` 权限模式。
- 不绕过 Start Gate、permission pipeline、Plan approval、Verifier 或 Freshness/Web Evidence。
- 输出默认一屏内，默认一个成熟推荐方案；只有预算、部署偏好、业务约束、合规或用户偏好无法从项目事实判断时才提问。

## 7. Batch C focused tests

必须覆盖：

- 小任务不触发。
- 跨模块任务触发。
- 公共 API 变更触发。
- 依赖/配置变更触发。
- 部署/性能/安全触发。
- mature / complete / reference-aligned / no omissions 触发。
- 无证据的 `projectFacts` 写 `unknown`。
- 最新外部事实需要 Freshness/Web Evidence。
- Architecture Card 字段完整且短。
- Drift 检出新增依赖、扩散模块、跳过 verification、违反 nonGoals、unknown/stale 被当事实。
- Architecture Runtime 不改变权限模式。
- 不绕过 Start Gate / permission pipeline。
- 不替代 Plan approval。
- 小修仍走原 default path。

## 8. 禁止推断

- Batch B 没有 runtime 实现。
- Batch B 不是 Batch C。
- Batch B 不是 Beta PASS。
- Batch B 不是 smoke-ready。
- Batch B 不进入真实项目 smoke。
- Batch B 不进入 Phase 15.5 / 16+。
- Batch B 没有复制 CCB 或第三方源码。

## 9. 验证

- `git diff --check`：PASS（仅有 Windows 工作区 LF/CRLF 提示，无 whitespace error）。

## 10. 下一步

可以在用户明确确认后进入 Batch C：Architecture Runtime 最小成熟实现。进入 Batch C 前仍必须保持上述边界，不得扩大成 agent、ADR DB、完整 spec 平台或第五权限模式。
