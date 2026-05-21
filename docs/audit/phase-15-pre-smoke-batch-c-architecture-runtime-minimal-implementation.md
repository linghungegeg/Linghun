# Phase 15 pre-smoke Batch C：Architecture Runtime 最小成熟 runtime 实现

日期：2026-05-21

## 1. 范围与结论

本轮只完成 Architecture Runtime v1 的最小 runtime 实现、focused tests 与 Batch C 报告。

本轮未进入真实项目 smoke，未宣布 Phase 15 Beta PASS，未宣布 smoke-ready，未进入 Phase 15.5 / Phase 16+，未提交 commit，未新增 agent，未新增 ADR DB，未新增长期 memory / DB，未改变四权限模式，未复制 CCB 或第三方源码。

Batch C 结论：Architecture Runtime v1 的最小成熟实现已完成并通过 focused tests、typecheck、全量 test、Biome check、build 与 diff whitespace 检查。可以进入 A-C 后 pre-smoke 验收门，但这不等于 Phase 15 Beta PASS，也不等于真实项目 smoke-ready；是否进入真实项目 smoke / Phase 15 Beta 仍必须由用户明确确认。

## 2. 修改文件清单

- `packages/tui/src/architecture-runtime.ts`
  - 新增 Architecture Runtime v1 纯函数和类型。
  - 实现：
    - `shouldTriggerArchitectureRuntime(input, context)`
    - `collectArchitectureFacts(context)`
    - `formatArchitectureCard(card)`
    - `detectArchitectureDrift(card, nextAction)`
  - 额外提供最小 runtime glue：
    - `createArchitectureCard()`
    - `createArchitectureRuntimeDirective()`
    - `summarizeArchitectureCard()`
- `packages/tui/src/architecture-runtime.test.ts`
  - 新增 Batch C focused tests。
- `packages/tui/src/index.ts`
  - 在普通模型请求链路接入 Architecture Runtime。
  - 复用 transcript `system_event`、`evidence_record` 和 handoff latest 摘要。
  - 在模型 tool_use 进入权限管道前做轻量 drift check，drift 时只 warning + 等待用户确认，不替代权限审批。
- `docs/audit/phase-15-pre-smoke-batch-c-architecture-runtime-minimal-implementation.md`
  - 本报告。

## 3. 接入点说明

接入点位于 `packages/tui/src/index.ts` 的普通模型请求链路中：

1. `sendMessage()` 已完成 `buildRuntimeStatusForModel({ ...context, provider })`。
2. 在 `createModelSystemPrompt()` / `buildModelMessagesWithRecentContext()` 之前判断是否触发 Architecture Runtime。
3. 触发时生成短 Architecture Card，并通过当前 model request 的 system prompt directive 注入。
4. 不新增额外模型调用，不新增 planner call，不接管 Natural Command Bridge / control-plane。
5. `executeModelToolUse()` 中在 permission pipeline 前执行最小 drift check；drift 只产生 warning 和本地确认，不直接允许工具执行。

## 4. 实现边界

Architecture Runtime v1 是普通对话链路前的轻量工程判断 guard，只在系统性工程任务上触发；不是第五权限模式、不是 Plan Mode、不是 skill、不是 agent、不是 ADR DB、不是完整 spec 平台。

本轮实现保持以下边界：

- 不改变 `default` / `auto-review` / `plan` / `full-access` 四权限模式。
- 不绕过 Start Gate。
- 不绕过 permission pipeline。
- 不替代 Plan approval。
- 不替代 Verification Runner / verifier。
- 不替代 Freshness/Web Evidence。
- 不新增额外模型调用。
- 不新增 DB / 长期 memory。
- NCB/control-plane 请求不走 Architecture Runtime。
- 小修、状态查询、简单解释仍走原默认路径。
- 触发后只注入短 directive / card 摘要，不重复塞完整长期上下文，不污染 cache prefix / stable context。

## 5. Architecture Card 字段

Architecture Card 固定字段为：

- `target`
- `projectFacts`
- `recommendedApproach`
- `rejectedApproaches`
- `stagedBreakdown`
- `risks`
- `verification`
- `nonGoals`

`projectFacts` 只使用 runtime context 中已有 evidence / index / permission mode 等可见事实；无证据时写 `unknown`。涉及 latest/current/provider/API/价格/安全公告/第三方方案等当前外部事实时，只标记需要 Freshness/Web Evidence 或 `stale`，不把模型记忆当当前事实。

## 6. Drift check v1

`detectArchitectureDrift(card, nextAction)` 覆盖：

- 新增或修改依赖 / 配置。
- 扩散到 card 未提及的架构范围模块 / 文件。
- 跳过 verification。
- 改变 `recommendedApproach`。
- 违反 `nonGoals`。
- 把 `unknown` / `stale` 外部事实当确定事实。

runtime 接入中，drift warning 不替代权限审批：用户确认 drift 后，工具调用仍继续进入 `decidePermission()`、permission request/result、`runTool()`、`tool_result` 和 continuation 原链路。

## 7. Focused tests 结果

新增 focused tests：`packages/tui/src/architecture-runtime.test.ts`。

覆盖项：

- 小任务不触发。
- 跨模块任务触发。
- 公共 API 变更触发。
- 依赖/配置变更触发。
- 部署/性能/安全触发。
- mature / complete / reference-aligned / no omissions 触发。
- 无证据 `projectFacts` 写 `unknown`。
- 最新外部事实需要 Freshness/Web Evidence 或 `stale`。
- Architecture Card 字段完整且短。
- Drift 检出新增依赖、扩散模块、跳过 verification、违反 nonGoals、改变 recommendedApproach、unknown/stale 当事实。
- Architecture Runtime directive 明确不改变权限模式、不绕过 Start Gate / Plan approval、不替代 verifier。
- 小修仍走原默认路径。

结果：`17 passed`。

## 8. 验证命令结果

已运行：

- `corepack pnpm exec vitest run packages/tui/src/architecture-runtime.test.ts`
  - PASS：1 test file passed，16 tests passed。
- `corepack pnpm typecheck`
  - PASS。
- `git diff --check`
  - PASS；仅出现 Windows 工作区 LF/CRLF 提示，无 whitespace error。
- `corepack pnpm test`
  - PASS：12 test files passed，341 tests passed。
  - 中途曾因 drift check 过宽导致既有 TUI Write/continuation tests 失败；已收窄为只拦截真实依赖/配置变更和架构范围文件扩散，最终全量测试 PASS。
- `corepack pnpm check`
  - PASS。
  - 中途曾因新文件格式化不符合 Biome 输出失败；已格式化后 PASS。
- `corepack pnpm build`
  - PASS。

## 8.1 复检回打验证（2026-05-21）

Batch C 复检后只做最小 runtime 边界回打，不进入 A-C 综合验收、不进入真实项目 smoke、不宣布 Beta PASS / smoke-ready。

回打内容：

- 清理旧 Architecture Card 跨 turn 污染：新的普通输入如果不触发 Architecture Runtime，会在进入模型请求前清空 `context.currentArchitectureCard`，避免旧 card 影响下一轮小任务 tool_use drift check。
- 收窄补齐“新功能”触发：增加常见“实现/新增/添加/加一个/支持 + 功能/模块/系统/流程/接口”以及对应英文 `implement/add/support + feature/module/system/flow/api` 的最小触发规则；typo、单文件小 bug、只改一处等小任务仍不触发。

新增/更新 focused tests：

- `packages/tui/src/architecture-runtime.test.ts`：新增常见新功能请求触发覆盖；保留 typo / 单文件小 bug / 只改一处不触发覆盖。
- `packages/tui/src/index.test.ts`：新增先触发 Architecture Runtime、再发送不触发小任务并确认旧 card 不产生 drift warning 的 TUI focused test。

本次回打已运行：

- `corepack pnpm exec vitest run packages/tui/src/architecture-runtime.test.ts packages/tui/src/index.test.ts`
  - PASS：2 test files passed，134 tests passed。
- `corepack pnpm typecheck`
  - PASS。
- `git diff --check`
  - PASS；仅出现 Windows 工作区 LF/CRLF 提示，无 whitespace error。

## 9. 未做事项与禁止推断

本轮没有：

- 进入真实项目 smoke。
- 宣布 Phase 15 Beta PASS。
- 宣布 smoke-ready。
- 进入 Phase 15.5 / Phase 16+。
- 提交 commit。
- 新增 agent。
- 新增 ADR DB。
- 新增长期 memory / DB。
- 改变四权限模式。
- 绕过 Start Gate / permission pipeline / Plan approval。
- 替代 verifier。
- 替代 Freshness/Web Evidence。
- 复制 CCB 或第三方源码。

不得从 Batch C focused/local/full-test PASS 推断 Phase 15 Beta readiness PASS；真实项目 smoke 和 Beta 仍需用户明确确认。

## 10. 下一步判断

可以进入 A-C 后 pre-smoke 验收门：核对 Batch A 四权限模式、Batch B source-of-truth、Batch C runtime 实现与 focused/full validation 是否共同满足 pre-smoke acceptance。

但在用户明确确认前，不得进入真实项目 smoke，不得宣布 Beta PASS / smoke-ready，不得进入 Phase 15.5 / Phase 16+。
