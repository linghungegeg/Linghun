# Phase D.14A-3 — index.ts Deep Structural Modularization / Behavior-Preserving Split

> 阶段：D.14A-3
> 日期：2026-05-30
> 工作目录：`F:\Linghun`
> 范围：在行为不变前提下继续深拆 `packages/tui/src/index.ts`，把纯 presenter/builder/runtime 与可注入依赖的领域 command runtime 移出 god file。
> 明确未做：新增功能、改 provider/env/key/model route、改权限四档、改 D.13U/D.13V gate 语义、恢复 FreshnessLite、失败学习/反思系统、Git/worktree 新功能、UI 大改版、批量格式化无关文件、删除历史 untracked、进入 D.14B。

## 1. 拆分前后 index.ts 行数

| 阶段 | 行数 |
| --- | ---: |
| D.14A-2 交付（本阶段起点） | 14517 |
| D.14A-3 交付 | **7948** |
| 本阶段净减 | **-6569** |

验收结果：`index.ts <= 8000` 已达成，不需要不可拆例外证明。

## 2. 拆分方案与执行结果

本阶段按源码依赖图拆分，而不是按行数机械切割：

| 模块 | 行数 | 职责 | 后续归属规则 |
| --- | ---: | --- | --- |
| `model-prompt-runtime.ts` | 132 | `createModelSystemPrompt`、evidence summary、RuntimeIdentityRule/FreshnessRule/ArchitectureRuntime prompt assembly | 后续模型 system prompt、RuntimeStatusForModel 投影、evidence prompt 摘要都放这里；provider/env/key/model route 真实选择仍不放这里。 |
| `command-panel-runtime.ts` | 148 | CommandPanel 展示 state 与 details toggle panel builder | 后续只放纯面板构造与 `showCommandPanel` 展示写入；深度业务 handler 不放这里。 |
| `git-command-runtime.ts` | 258 | git/worktree/checkpoint/stable-point panel builder | 后续 git/checkpoint 纯展示放这里；store/session 写入留 coordinator。 |
| `mcp-index-command-runtime.ts` | 211 | MCP/index status、doctor、refresh summary 纯格式化 | 后续 MCP/index 状态展示放这里；CLI 调用和状态突变不放这里。 |
| `mcp-stdio-runtime.ts` | 424 | MCP stdio tool list/call 与 mutating tool 判定 | 后续 MCP stdio 协议执行放这里；权限 continuation 留 index。 |
| `mcp-index-runtime.ts` | 1041 | deferred tool search/execute、index command/query/repository runtime | 后续 MCP/index command runtime 放这里；通过 deps 注入 `ensureSession`/event 写入。 |
| `cache-command-runtime.ts` | 275 | cache status/log/compact/light hint presenter | 后续 cache 用户可见展示放这里；freshness coordinator 留 index。 |
| `terminal-readiness-runtime.ts` | 647 | readiness / verification-level 本地诊断视图 | 后续 terminal readiness 与本地诊断 view 放这里。 |
| `handoff-session-runtime.ts` | 219 | handoff packet、resume packet、hydrate/validate/write helpers | 后续 handoff/checkpoint/session packet builder 放这里；appendEvent glue 留 index。 |
| `extension-command-runtime.ts` | 761 | skill/plugin extension install/update/list/config/hooks/workflow 纯运行时与校验 | 后续 extension domain runtime 放这里；网络确认事件通过 deps/callback 注入。 |
| `extension-slash-runtime.ts` | 368 | `/skills` / `/plugins` slash handler coordinator | 后续 skill/plugin slash 分发放这里；不引入 provider route 逻辑。 |
| `remote-command-runtime.ts` | 335 | remote channel command/test approval runtime | 后续 remote command 与 test event builder 放这里。 |
| `memory-command-runtime.ts` | 470 | memory command、handoff resume、auto-learning turn-end runtime | 后续 memory command/presenter 放这里；不新增失败学习/反思系统。 |
| `model-command-runtime.ts` | 238 | `/model`、`/model route`、model setup slash runtime | 后续 model control-plane command 放这里；provider/env/key/model route 决策仍由既有 doctor/runtime helper 提供。 |
| `job-agent-command-runtime.ts` | 1038 | job/background/agent/fork command runtime | 后续 job/agent/background command 放这里；resource guard 与 route handoff 通过 deps 注入。 |
| `pending-details-presenter.ts` | 133 | pending approval/natural command/workspace trust details formatter | 后续 `/details` 纯文案 formatter 放这里。 |
| `process-command-runtime.ts` | 81 | process command capture 与 redacted path helper | 后续 process command helper 放这里。 |
| `verification-command-runtime.ts` | 498 | verification plan/report/runner command runtime | 后续 verification command/presenter 放这里；model loop 不放这里。 |

本轮只移动已有职责边界和最小 deps 注入；未新增功能。为保持 D.13 源码级 invariant，`index.ts` 保留少量 source anchor 注释。

## 3. 留在 index.ts 的关键主链和原因

- `runTui` / startup / plain TUI / Ink lifecycle：顶层生命周期与 stdio/shell 状态强耦合，留 index。
- `TuiContext` 类型与初始化 glue：大量 sibling 仅 type import，现阶段拆出会放大接口变更面。
- `processTuiLine` / `handleSlashCommand` 主 dispatch：协调 pending approval、slash、natural input、session/store，留 index。
- `sendMessage` / `continueModelAfterToolResults` / `streamFinalModelAnswerWithoutTools`：provider/model loop coordinator，直接协调 gateway.stream、active abort、request activity、final gate、store transcript。
- `executeModelToolUse` / `executeApprovedModelToolUse` / `executeDeferredDispatchToolUse`：permission continuation、report guard、evidence、background task、tool_result store 强耦合，留 index。
- permission approval continuation、session/store `appendEvent` glue、resource guard coordinator、report guard coordinator：涉及主状态机与审计事件，留 index。

## 4. D.13U / D.13V gate 行为

- D.13U：`evaluateFinalAnswerClaims`、final answer 写 transcript 前 gate、最多一次 retry、本地降级语义保持不变。
- D.13V-A：streaming block retry 清理、Ctrl+O/details 不残留违规原文语义保持不变。
- D.13V-B/C：architecture/completeness final gate 接入仍在 `sendMessage` / continuation 双路；与 D.13U 共用一次 retry 预算。
- 本轮只移动 prompt builder 与周边 presenter/runtime，不改变 gate 判定、retry、降级文本或 transcript 写入顺序。

## 5. Prompt / Provider 降噪语义

- `createModelSystemPrompt` 已移入 `model-prompt-runtime.ts`，文案保持原语义：`RuntimeStatusForModel` 默认不含 provider/baseUrl/endpointProfile。
- 自然语言询问当前模型仍只暴露 model name；provider/route/endpointProfile 只允许在显式 provider/route/endpoint 问题或 `/model doctor` / `/model route doctor` 暴露。
- 未触碰 provider/env/key/model route 真实逻辑；没有把 openai-compatible/baseUrl/provider 信息重新泄漏到默认主屏。

## 6. AntiCodeBlob / 大文件 Guard 接入状态

当前状态：**prompt-level / Architecture Runtime directive guidance**。

- AntiCodeBlob 当前不是 linter、AST gate、静态阻断器、权限拒绝、pre-write hard guard 或 standalone hard guard。
- EngineeringStructure 默认进入 system prompt；AntiCodeBlob 只在 Architecture Runtime directive 触发时进入模型指令。
- legacy large file debt 仍不是 violation / permission denial / 硬禁止，也不授予写权限。

## 7. 循环依赖检查

- 新增 18 个模块未发现 value-import `./index.js`。
- 除 `mcp-stdio-runtime.ts`、`process-command-runtime.ts` 无 `index.js` 引用外，其余新增模块只使用 `import type { TuiContext } from "./index.js"`。
- 依赖方向保持 `index.ts -> 新模块 -> sibling`，需要 index-owned glue 的模块通过 deps/callback 注入。
- `tsc --noEmit`、`@linghun/tui build`、`@linghun/cli build` 均通过，未发现运行时循环依赖症状。

## 8. 验证结果

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | PASS |
| `corepack pnpm --filter @linghun/tui build` | PASS |
| `corepack pnpm --filter @linghun/cli build` | PASS |
| `git diff --check` | PASS |
| `corepack pnpm --filter @linghun/tui exec vitest src/model-loop-runtime.test.ts --run` | PASS, 119 passed |
| `corepack pnpm --filter @linghun/tui exec vitest src/index.test.ts -t D.13U --run` | PASS |
| `corepack pnpm --filter @linghun/tui exec vitest src/index.test.ts -t D.13V-A --run` | PASS |
| `corepack pnpm --filter @linghun/tui exec vitest src/index.test.ts -t D.13V-B --run` | PASS |
| `corepack pnpm --filter @linghun/tui exec vitest src/tool-output-presenter.test.ts --run` | PASS, 15 passed |
| `corepack pnpm --filter @linghun/tui exec vitest src/runtime-status-presenter.test.ts --run` | PASS, 4 passed |
| `corepack pnpm --filter @linghun/tui exec vitest src/architecture-runtime.test.ts --run` | PASS, 27 passed |
| `corepack pnpm --filter @linghun/tui exec vitest src/architecture-boundary.test.ts --run` | PASS, 31 passed |
| `corepack pnpm --filter @linghun/tui exec vitest src/workspace-reference-cache.test.ts --run` | PASS, 14 passed |
| `corepack pnpm --filter @linghun/tui exec vitest src/shell/view-model.test.ts -t CommandPanel --run` | PASS |
| `corepack pnpm --filter @linghun/tui exec vitest --run` | baseline FAIL, **44 failed / 1696 passed** |

完整 vitest 与 D.14A-2 baseline 对比：

- D.14A-2 baseline：44 failed / 1696 passed。
- D.14A-3 当前：44 failed / 1696 passed。
- 当前失败仍集中在既有 `src/index.test.ts > Phase 06 TUI slash commands` baseline 组；本轮中途出现的 6 个源码迁移新增失败已修复并复测。
- 新增失败：0。

## 9. git status --short

```text
 M packages/tui/src/index.ts
?? .claude/
?? AGENTS.md
?? D13D_TUI_FOUNDATION_PLAN.md
?? LINGHUN_CODE_FACT_AUDIT_REPORT_2026-05-27.md
?? LINGHUN_VS_CCB_SOURCE_COMPARISON.md
?? docs/delivery/phase-13V-BC-architecture-completeness-diagnostics-closure.md
?? packages/tui/src/cache-command-runtime.ts
?? packages/tui/src/command-panel-runtime.ts
?? packages/tui/src/extension-command-runtime.ts
?? packages/tui/src/extension-slash-runtime.ts
?? packages/tui/src/git-command-runtime.ts
?? packages/tui/src/handoff-session-runtime.ts
?? packages/tui/src/job-agent-command-runtime.ts
?? packages/tui/src/mcp-index-command-runtime.ts
?? packages/tui/src/mcp-index-runtime.ts
?? packages/tui/src/mcp-stdio-runtime.ts
?? packages/tui/src/memory-command-runtime.ts
?? packages/tui/src/model-command-runtime.ts
?? packages/tui/src/model-prompt-runtime.ts
?? packages/tui/src/pending-details-presenter.ts
?? packages/tui/src/process-command-runtime.ts
?? packages/tui/src/remote-command-runtime.ts
?? packages/tui/src/terminal-readiness-runtime.ts
?? packages/tui/src/verification-command-runtime.ts
```

本报告保存后还会新增：

```text
?? docs/delivery/phase-14A-3-index-deep-structural-modularization.md
```

`.claude/`、`AGENTS.md`、`D13D_*`、`LINGHUN_*`、`phase-13V-BC-*.md` 为本阶段之前既有 untracked，未删除、未回滚。

## 10. 边界确认

- 未触碰 provider/env/key/model route 真实逻辑。
- 未新增权限模式，权限四档语义不变。
- 未改变 D.13U/D.13V gate 语义。
- 未恢复 FreshnessLite。
- 未做失败学习/反思系统。
- 未做 Git/worktree 新功能。
- 未做 UI 大改版。
- 未删除历史 untracked 文件，未回滚用户已有改动。
- 本阶段完成后停止，不进入 D.14B。

## 11. 参考核对

- 实际读取的 Linghun 文档：`docs/delivery/phase-14A-index-modularization.md`、`docs/delivery/phase-14A-2-index-structural-modularization.md`、`docs/delivery/phase-13U-anti-hallucination-final-answer-gate.md`、`docs/delivery/phase-13V-BC-architecture-completeness-diagnostics-closure.md`、当前 `packages/tui/src/index.ts` 及 D.14A-1/D.14A-2 已拆模块。
- 实际参考的本地 CCB / 社区项目：本阶段为 Linghun 内部 behavior-preserving split，未读取/复制 CCB 源码或社区源码实现。
- 进入 Linghun 自研实现的内容：仅移动既有 Linghun 函数/类型，使用 deps/callback 保持 index-owned glue，未复制可疑源码实现。

## 12. 成品级结构化 Handoff Packet

```yaml
phase: D.14A-3
status: COMPLETE
next_phase: D.14B only after explicit user confirmation

line_count:
  before: 14517
  after: 7948
  net_reduction: 6569
  target_met: true

new_modules:
  - packages/tui/src/model-prompt-runtime.ts
  - packages/tui/src/command-panel-runtime.ts
  - packages/tui/src/git-command-runtime.ts
  - packages/tui/src/mcp-index-command-runtime.ts
  - packages/tui/src/mcp-stdio-runtime.ts
  - packages/tui/src/mcp-index-runtime.ts
  - packages/tui/src/cache-command-runtime.ts
  - packages/tui/src/terminal-readiness-runtime.ts
  - packages/tui/src/handoff-session-runtime.ts
  - packages/tui/src/extension-command-runtime.ts
  - packages/tui/src/extension-slash-runtime.ts
  - packages/tui/src/remote-command-runtime.ts
  - packages/tui/src/memory-command-runtime.ts
  - packages/tui/src/model-command-runtime.ts
  - packages/tui/src/job-agent-command-runtime.ts
  - packages/tui/src/pending-details-presenter.ts
  - packages/tui/src/process-command-runtime.ts
  - packages/tui/src/verification-command-runtime.ts

must_not_do_next_without_user_confirmation:
  - enter D.14B
  - change provider/env/key/model route logic
  - change permission four-mode semantics
  - change D.13U/D.13V gate semantics
  - add failure-learning/reflection system
  - add AntiCodeBlob hard guard

validation:
  tsc_no_emit: PASS
  tui_build: PASS
  cli_build: PASS
  diff_check: PASS
  required_vitest_subsets: PASS
  full_tui_vitest: "44 failed / 1696 passed, matches D.14A-2 baseline count; no new failures"

index_status:
  codebase_memory_project: F-Linghun
  source_facts_checked_by: "local rg/Get-Content plus two read-only subagents"

permissions:
  sandbox_mode: danger-full-access
  approval_policy: never

model_provider_budget:
  provider_route_changed: false
  budget_recorded: "not available in local tool output"
```
