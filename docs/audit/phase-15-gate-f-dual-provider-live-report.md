# Phase 15 Gate F — Dual Provider Live Report-Generation Smoke

> 日期：2026-05-20
> 性质：真实 TUI + 真实 provider + 真实 report-generation path live smoke
> 范围：DeepSeek 主链路 + OpenAI-compatible 兼容链路

## VERDICT: **PASS**

---

## DeepSeek Gate F

| 项 | 值 |
|----|---|
| 状态 | **PASS** |
| Provider | deepseek |
| Model | `deepseek-chat` |
| Base URL | `https://api.deepseek.com/v1` |
| Endpoint profile | `chat_completions` |
| Temp project path | `/tmp/linghun-gate-test` |
| Requested report path | `gate-report.md`（工作区相对路径） |
| Actual tool chain | Glob ×2 → Read ×3 → Write（permission ask → yes → 写入） → model continuation → final answer |
| Write evidence ID | `46b2e850-c15e-48a5-9672-4b72a53709e4` |
| reportExists | ✅ |
| reportHasMarker | ✅（包含项目分析标题、结构表、建议、总结） |
| File size | 1658 bytes, 39 lines |
| Final answer 引用文件 | ✅（"报告已保存至 **gate-report.md**"） |
| HTTP 400 | 无（修复 `createSingleToolCallContinuation` 孤儿 tool_result 后） |
| Empty response | 无 |
| No tool_use | 无（模型正常产生 Glob/Read/Write tool_use） |
| No pending approval | 无（Write 正常进入 pending → yes → 执行） |

## OpenAI-compatible Gate F

| 项 | 值 |
|----|---|
| 状态 | **PASS** |
| Provider | openai-compatible |
| Model | `gpt-5.5` |
| Base URL | `https://sub2api.toioto.org/v1` |
| Endpoint profile | `chat_completions` |
| Temp project path | `/tmp/linghun-gate-test` |
| Requested report path | `gate-report.md`（工作区相对路径） |
| Actual tool chain | Glob ×5 → Write（permission ask → yes → 写入） → model continuation → final answer |
| Write evidence ID | `1e555f9a-ec2a-419a-898d-e9e8e1bc10af` |
| reportExists | ✅ |
| reportHasMarker | ✅（包含项目分析标题、结构分析、风险建议、结论） |
| File size | 1652 bytes |
| Final answer 引用文件 | ✅（"已将报告保存到 `gate-report.md`"） |
| HTTP 400 | 无 |
| Empty response | 无 |
| No tool_use | 无（模型正常产生 Glob/Write tool_use） |
| No pending approval | 无（Write 正常进入 pending → yes → 执行） |

备注：初次尝试使用 `gpt-4o-mini` 模型时网关返回 400（该网关不支持该模型 ID）。改用网关 `/v1/models` 返回的 `gpt-5.5` 后一次通过。这属于网关模型列表差异，不是 Linghun 代码问题。

## check / typecheck / test / build 结果

| 项 | 结果 |
|----|------|
| `corepack pnpm check` | ✅ 47 files, 0 errors |
| `corepack pnpm typecheck` | ✅ clean |
| `corepack pnpm test` | ✅ 267 passed / 0 failed |
| `corepack pnpm build` | ✅ 7/8 workspace projects |

## Key Leakage Check

- API key 未写入任何仓库文件、配置文件、文档、日志或提交历史。
- Key 仅通过 shell 环境变量传入 TUI 进程，进程退出后失效。
- Provider 代码中 `sk-` redaction regex 对日志/doctor 输出进行脱敏。

## 本轮修复内容

**Bug**: `createSingleToolCallContinuation` 在模型返回多个 `tool_calls` 且其中一个进入 pending approval 时，只过滤 assistant message 的 `toolCalls` 字段保留 pending 的那一个，但没有移除同一轮中已被移除的 sibling tool_calls 对应的 tool result 消息。DeepSeek 收到孤儿 `tool_result`（其 `tool_call_id` 在 assistant message 的 `tool_calls` 中不存在），返回 HTTP 400。

**Fix**（`packages/tui/src/index.ts`）: 追踪被移除的 sibling tool_call IDs（`removedIds`），过滤掉引用这些 ID 的 tool result 消息，保留之前轮次的完整历史。修复后 check/typecheck/test/build 全部通过，无回归。

## git status --short

```
 M LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md
 M LINGHUN_PHASED_DELIVERY_BLUEPRINT.md
 M PHASE_15_BETA_CCB_MATURITY_REMEDIATION_BASELINE.md
 M docs/audit/reference-map.md
 M docs/delivery/README.md
 M docs/delivery/phase-15-natural-command-bridge.md
 M packages/config/src/index.test.ts
 M packages/config/src/index.ts
 M packages/providers/src/index.test.ts
 M packages/providers/src/index.ts
 M packages/tui/package.json
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
?? docs/audit/phase-15-gate-f-dual-provider-live-report.md
```

> 本报告文件 `docs/audit/phase-15-gate-f-dual-provider-live-report.md` 是新增的 untracked 文件。

## 边界声明

1. **本报告证明**：DeepSeek（`deepseek-chat`）与本次 OpenAI-compatible endpoint（`sub2api.toioto.org/v1` / `gpt-5.5`）的真实 TUI report-generation path 通过，包括 tool_use → permission ask → approval → Write → model continuation → final answer 引用文件的完整链路。
2. **不等于承诺所有 OpenAI-compatible 网关都天然兼容**：不同网关的 models 列表、tools/tool_choice 支持、tool_result schema 容忍度、streaming 行为可能不同。每个新网关需要单独验证。
3. **不自动进入 Phase 15 Beta**：Gate F live smoke PASS 是 Beta 前置条件之一，不是充分条件。是否进入 Phase 15 Beta 必须由用户明确确认。
4. **下一步建议**：进入 final independent Beta decision verification，由用户决定是否开始 Phase 15 Beta。
