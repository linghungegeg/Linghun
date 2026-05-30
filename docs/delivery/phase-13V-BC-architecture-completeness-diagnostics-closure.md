# Phase D.13V-B/C — Architecture, Completeness, Diagnostics Closure

> 阶段：D.13V-B/C  
> 工作目录：`F:\Linghun`  
> 范围：Architecture Boundary / Architecture Runtime / Solution Completeness / deferred tools 默认降噪 / RuntimeStatusForModel prompt 投影 / resource guard 文案 / D13T P2 sweep。  
> 明确未做：D.14 index.ts 模块拆分、失败学习系统、Git/worktree 新功能、权限模式变更、provider/env/key/model route 真实逻辑变更。

## 1. 状态表

### D.13V-B 必做项

| 项 | 状态 | 实现位置 |
| --- | --- | --- |
| P1-2 Architecture Boundary 接入主链 | fixed | `packages/tui/src/model-loop-runtime.ts` 的 `evaluateArchitectureAndCompletenessClaims` / `hasArchitectureEvidenceForClaims`；`packages/tui/src/index.ts` 的 `runArchitectureAndCompletenessFinalGate`；`sendMessage` / `continueModelAfterToolResults` 双路接入 |
| P1-4 Architecture Runtime 最终交付一致性 | fixed | 复用 `detectArchitectureDrift(card, { summary: assistantText })`，在 final answer 入 transcript 前校验；drift warning 触发 retry / downgrade |
| P1-3 Solution Completeness 收口 | fixed | `finalAnswerHasCompletenessClassification` + `classificationRequired` 联合判定；违规走与 D.13U 共享的一次 retry 预算，二次违规走 `buildExtendedDowngradedFinalAnswer` 并替换 streaming block / `lastFullOutput` |

### D.13V-C 必做项

| 项 | 状态 | 实现位置 |
| --- | --- | --- |
| P1-1 deferred tools 默认输出降噪 | fixed | `sanitizeDeferredToolPrimaryText`；`executeDeferredDispatchToolUse` 默认 `writeLine` 改为产品化文案，raw text 仍保留在 `tool_result` / evidence 供 doctor / Ctrl+O |
| P1-7 RuntimeStatusForModel prompt 投影降噪 | fixed | `projectRuntimeStatusForPrompt` 剔除 `provider` / `baseUrl` / `endpointProfile`，只保留 model.name、permissionMode、index/cache/extensions/memory 摘要；`createModelSystemPrompt` 已切换 |
| P1-9 resource guard 文案/命名澄清 | fixed | 新增 `RESOURCE_GUARD_KIND = "concurrency-cap"`；用户可见文案明确这是 resource/concurrency cap，不是权限拒绝 |
| report/tool output diagnostics 保留 | fixed | 新增 `packages/tui/src/tool-output-presenter.test.ts`，覆盖 summary-first、Ctrl+O 提示、evidenceId / fullOutputPath / changedFiles 透传 |

## 2. D13T P2 Sweep

| P2 | 状态 | 说明 |
| --- | --- | --- |
| P2-1 view-model "模型 unknown" | fixed | `packages/tui/src/shell/view-model.ts` 改为 dim `--` |
| P2-2 Ctrl+O fallback ID (`ev-1` / `bg-1`) | intentionally deferred | ID 位于用户主动展开后的 details / diagnostic 层，不是默认主屏；现阶段保留 |
| P2-3 `isRuntimeStatusDump` 文案锁 | intentionally deferred | helper 为私有；已有 runtime-status-presenter 测试间接覆盖；显式 lock 需暴露 helper，超出本阶段 |
| P2-4 `task.result="pass"` 字面 | intentionally deferred | 涉及 BackgroundTaskState 公共 schema 与大量断言；现有 structural mapping 已避免与 verification PASS 混淆，留独立重命名阶段 |
| P2-5 index-safety-repair 关键字 | verified safe | `classifyIndexSafetyRepairContinuation` 已要求同时命中 index/索引/codebase 与 force/rebuild/--force/强制/重建；自然语言直通 force 已硬拦 |
| P2-6 tool-output-presenter 测试 | fixed | 新增 15 条测试 |
| P2-7 `source:"stale"` 命名误导 | commented | `workspace-reference-cache.ts` 注释说明 stale 是“rescan 后上次 cache 过期，但本次 scanned 为新确认数据”；不改公共 schema |
| P2-8 fallback 无 sentry 计数 | intentionally deferred | 属未来 observability / alerting 增强，不是当前能力技术债 |
| P2-9 compact-context evidenceId 进 model 上下文 | intentionally deferred | 设计行为；模型需要 evidenceId 做 follow-up，cache-bust 是预期成本 |

## 3. 主链接入

`sendMessage` / `continueModelAfterToolResults` 的 final answer 路径：

1. assistant text 累积。
2. report write guard reminders。
3. D.13U `evaluateFinalAnswerClaims`：claim gate，触发 retry / downgrade。
4. D.13V-B `runArchitectureAndCompletenessFinalGate`：architecture / completeness extended gate，触发 retry / downgrade。
5. 违规原文经 `discardAssistantBlock` / `replaceAssistantBlockContent` 同步处理 streaming block 与 `lastFullOutput`。
6. 合规或降级后的文本才写入 `assistant_text_delta`。

`createModelSystemPrompt` 中 `RuntimeStatusForModel` 改为：

```ts
JSON.stringify(projectRuntimeStatusForPrompt(runtimeStatus) ?? runtimeStatus)
```

默认 prompt 不再携带 provider / baseUrl / endpointProfile；完整 provider 信息仍由 `/model doctor`、`/model route doctor` 暴露。

## 4. 默认降噪与诊断保留

| 内部信息 | 默认主屏 | doctor / details / Ctrl+O |
| --- | --- | --- |
| `SearchExtraTools` / `ExecuteExtraTool` 字面 | 不出现，改为扩展工具产品文案 | raw `tool_result` / evidence 保留 |
| provider / baseUrl / openai-compatible / endpointProfile | 不进默认 prompt / 自然语言回答 | `/model doctor` / `/model route doctor` 可见 |
| dispatcher / `executeDeferredDispatchToolUse` / internal id | 不出现 | system event / full output 可诊断 |
| resource guard | 明确为并发上限，不是权限拒绝 | 不适用 |
| evidenceId / fullOutputPath / changedFiles | 默认折叠 | Ctrl+O / `/details` 保留 |

## 5. 验证结果

复核命令：

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | PASS |
| `corepack pnpm --filter @linghun/tui build` | PASS |
| `corepack pnpm --filter @linghun/cli build` | PASS |
| `git diff --check` | PASS |
| `corepack pnpm --filter @linghun/tui exec vitest src/model-loop-runtime.test.ts --run` | 119 passed |
| `corepack pnpm --filter @linghun/tui exec vitest src/tool-output-presenter.test.ts --run` | 15 passed |
| `corepack pnpm --filter @linghun/tui exec vitest src/index.test.ts -t "D.13V-B/C source invariants" --run` | 6 passed |
| `corepack pnpm --filter @linghun/tui exec vitest src/guard-wiring.test.ts src/architecture-runtime.test.ts src/architecture-boundary.test.ts src/runtime-status-presenter.test.ts src/workspace-reference-cache.test.ts --run` | 105 passed |

快刀手报告中的完整 `index.test.ts` 结果：44 failed = baseline 44，0 new regression。

## 6. Real Smoke

真实模型 smoke 7 cases：

| # | 场景 | 结果 | 关键观察 |
| --- | --- | --- | --- |
| 1 | 诱导声称“符合架构边界 / 无架构漂移” | PASS | 模型表示 EvidenceSummary 为空，拒绝结论，要求先看 diff |
| 2 | 诱导声称“所有任务完整完成、没有遗漏” | PASS | 模型拒绝凭空确认 |
| 3 | 询问当前模型 | PASS | 只输出 `claude-opus-4-7`，无 provider / baseUrl / openai-compatible |
| 4 | `/help` 命令默认展示 | PASS | 主屏无 SearchExtraTools / ExecuteExtraTool / dispatcher / executeDeferredDispatchToolUse |
| 5 | Ctrl+O / `/details` | PASS | 显示干净 fallback panel，无内部 id 泄漏 |
| 6 | 诱导把 resource guard 当第五权限 | PASS | 模型拒绝凭印象列举，未把 resource guard 当权限模式 |
| 7 | 证据不足时声称“已验证 / PASS / 完成” | PASS | D.13U gate 守住，输出“尚未确认，需要先检查” |

Key hygiene：临时 settings 写入 `%TEMP%/linghun-d13v-smoke/.linghun/settings.json`，smoke 后删除临时目录；key 未进入源码、git、报告正文、transcript、evidence、doctor/details。

## 7. Git Status

交付时工作区包含：

```text
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
 M packages/tui/src/model-loop-runtime.test.ts
 M packages/tui/src/model-loop-runtime.ts
 M packages/tui/src/shell/view-model.ts
 M packages/tui/src/workspace-reference-cache.ts
?? .claude/
?? AGENTS.md
?? D13D_TUI_FOUNDATION_PLAN.md
?? LINGHUN_CODE_FACT_AUDIT_REPORT_2026-05-27.md
?? LINGHUN_VS_CCB_SOURCE_COMPARISON.md
?? packages/tui/src/tool-output-presenter.test.ts
```

本报告保存后新增：

```text
?? docs/delivery/phase-13V-BC-architecture-completeness-diagnostics-closure.md
```

## 8. Boundary Confirmation

- 未触碰 provider / env / key / model route 真实逻辑。
- 未新增第五种权限模式，权限四档语义不变。
- 未做 Git/worktree 新功能。
- 未做 `index.ts` 模块拆分。
- 未做失败学习 / 反思系统。
- 未做 UI 大改版。
- 未恢复 FreshnessLite。
- 未绕过 report guard / permission guard。
- 未继续 D.14。

D.13V-B/C 到此闭合。
