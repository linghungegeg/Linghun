# Phase 15 pre-Beta：Output / provider / Windows clarity fix

日期：2026-05-20

## 范围

本轮只执行 `docs/audit/phase-15-ccb-grade-default-runtime-reconciliation.md` 中的 Batch 2 — Output / provider / Windows clarity，并同步收口已确认的阶段文档口径。

未进入 Batch 3、Phase 15.5 或 Phase 16+；未做 codebase-memory 内置化；未宣布 Phase 15 Beta PASS。

## 根因

Batch 2 聚焦真实 Beta 主屏与 provider profile 判断的可读性：

1. Read / Glob / Grep / Bash 的 primary output 仍可能显示 bounded preview 内容。即使已有截断，也会在主屏输出文件内容、匹配内容、路径列表或 Bash stdout 片段，容易造成刷屏和报告正文污染误判。
2. OpenAI-compatible provider 的 `endpointProfile` 与 reasoning 生效状态已有底层约束，但 TUI 表述不够明确：strict `chat_completions` 下 reasoning 只是 “not sent”，没有直接标注 ignored / unsupported / 未生效；`responses` 下也没有在请求前状态中明确显示 effective/sent。
3. 显式报告生成 guard 虽要求最终 Write，但首轮仍暴露 Bash 工具；模型可能先选择 Bash redirection 写报告，造成 Windows 中文编码 / shell stdout 污染风险。
4. Windows Bash stdout/stderr 如出现 mojibake，主屏缺少明确编码诊断摘要。

## 改动文件

- `packages/tui/src/tool-output-presenter.ts`
  - Read / Glob / Grep / Bash primary output 改为 summary-first。
  - primary 只显示工具名、摘要、行数/数量、截断状态、Bash exitCode、fullOutputPath/evidence/details 提示。
  - 不再在 primary dump Read 文件行、Glob 完整列表、Grep 匹配内容或 Bash stdout/stderr。
  - Bash 输出检测疑似 mojibake 时，primary 显示 `encoding=possible-mojibake` / `编码=疑似乱码`，不展示乱码正文。
  - model-visible `tool_result.text` 保持来自工具原始 bounded output，不因 UI 摘要化被削弱。
- `packages/tui/src/index.ts`
  - `/model doctor` 中 reasoning 状态改为更明确：
    - strict `chat_completions` + reasoning：`ignored/unsupported/未生效 ...`
    - `responses` / permissive chat：`effective/sent level=...`
    - 未配置 reasoning：`not configured/未生效`
  - 请求前状态中的 reasoning 改为 effective state：
    - `effective/sent Medium`
    - `ignored/unsupported/未生效`
  - 显式 report-generation guard 激活时，首轮 tools 去掉 Bash，避免 Bash redirection 写报告。
  - continuation 中如仍收到 Bash tool_call，会返回 failed model-visible tool_result，要求使用 Write/Edit，避免 shell 输出污染报告正文。
- `packages/tui/src/index.test.ts`
  - 新增 strict `chat_completions` reasoning ignored / unsupported / 未生效 TUI smoke。
  - 更新 `responses` reasoning effective/sent 请求前状态断言。
  - 新增/强化 Read / Glob / Grep summary-first primary output 回归。
  - 新增 Bash summary-first + fullOutputPath 回归。
  - 新增 Bash mojibake diagnostic 回归。
  - 强化中文报告生成 smoke：首轮 report-generation tools 包含 Write 且不包含 Bash。
  - 更新 Phase 15 end-to-end journey 对 Bash primary summary-first 的断言。
- `LINGHUN_IMPLEMENTATION_SPEC.md`
  - 新增 Compact Lite 规格口径：归属 Phase 15.5 开源前 hardening，不回写 Phase 11；保留 handoff / transcript / evidence 追溯边界。
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
  - 在 Phase 15.5 终端 polish / hardening 范围中加入 Compact Lite 边界与禁止事项。
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`、`START_NEXT_CHAT.md`、`docs/delivery/README.md`
  - 将 Phase 15.5 口径从“非阻塞 polish”收口为 terminal-scope polish 清零 / 开源前不得遗留 terminal-scope P2，同时保持 Phase 15 Beta readiness PARTIAL。
- `docs/audit/phase-15-pre-beta-output-provider-windows-clarity-fix.md`
  - 本报告。

## Batch 2 覆盖项

### 1. Read / Glob / Grep / Bash primary summary-first

覆盖结果：PASS。

当前 primary output 形态：

```text
工具 Read 结果：
- 摘要: Read 已完成...
- 行数=...
- 主屏为 summary-first；bounded 内容仍保留在 tool_result/evidence。
完整结果仍保留在 tool_result transcript/evidence 记录中。
证据记录：...
```

Bash 额外显示：

```text
- lines=...; exitCode=...; truncated=...
完整日志：.linghun/logs/tools/...
```

疑似 Windows mojibake 时只显示诊断摘要：

```text
- 行数=...; exitCode=0; 编码=疑似乱码; 截断=否
```

不会在 primary 展示乱码 stdout/stderr 正文。

### 2. model-visible tool_result 不受 UI 摘要化影响

覆盖结果：PASS。

本轮只改 `formatToolOutput(...)` 的 primary presentation；`executeApprovedModelToolUse(...)` 返回给模型的：

```ts
text: result.output.text,
data: result.output.data,
evidenceId: evidence?.id,
```

保持原路径不变。Read / Glob / Grep / Bash 的 bounded useful content 仍进入 model-visible tool_result 和 transcript/evidence。

### 3. Provider endpointProfile / reasoning visibility

覆盖结果：PASS。

- `/model doctor` 显示 provider/model/endpointProfile/compatibilityProfile/reasoning effective state。
- OpenAI-compatible strict `chat_completions` 下配置 reasoning 时：
  - request body 不包含 `reasoning`。
  - `/model doctor` 显示 `reasoning=ignored/unsupported/未生效 compatibilityProfile=strict_openai_compatible`。
  - 请求前状态显示 `endpointProfile=chat_completions reasoning=ignored/unsupported/未生效`。
- `responses` profile 下：
  - request body 包含 `reasoning: { effort: "Medium" }`。
  - 请求前状态显示 `endpointProfile=responses reasoning=effective/sent Medium`。
- 未做 silent profile fallback；既有 provider tests 仍覆盖 responses server error 不 fallback。

### 4. Windows 中文 / Bash 编码防线

覆盖结果：PASS。

- Bash primary output 不再显示 stdout/stderr 正文，只显示 summary、exitCode、fullOutputPath/evidence。
- 疑似 mojibake 在 primary 中标记为 `encoding=possible-mojibake` / `编码=疑似乱码`。
- 显式报告生成时首轮 tools 不暴露 Bash，避免模型使用 Bash redirection 写报告。
- continuation 中若仍收到 Bash tool_call，会作为 failed model-visible tool_result 回灌，提示使用 Write/Edit，避免 shell 输出污染报告正文。
- 中文报告写入路径继续通过 Write/Edit 工具完成。

## 测试结果

已运行并通过：

```bash
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "summary-first|strict chat reasoning|selected runtime profile|project analysis report|journey"
```

结果：PASS，1 file / 6 tests passed / 98 skipped。

```bash
corepack pnpm exec vitest run packages/providers/src/index.test.ts -t "reasoning|responses"
```

结果：PASS，1 file / 11 tests passed / 25 skipped。

```bash
corepack pnpm check
```

结果：PASS，Biome checked 47 files，no fixes applied。

```bash
corepack pnpm typecheck
```

结果：PASS，`tsc -b tsconfig.json` 完成。

```bash
corepack pnpm test
```

结果：PASS，11 files / 295 tests。

```bash
corepack pnpm build
```

结果：PASS，workspace packages build 完成。

## Index status

- `mcp__codebase-memory-mcp__index_status(project=F-Linghun)`：ready，nodes=1304，edges=2437。
- `mcp__codebase-memory-mcp__detect_changes(project=F-Linghun)`：changed files 包含：
  - `packages/tui/src/index.ts`
  - `packages/tui/src/index.test.ts`
  - `packages/tui/src/tool-output-presenter.ts`

## SKIPPED / PARTIAL / BLOCKED

- SKIPPED：未运行真实外部 provider live smoke；本轮使用 mock OpenAI-compatible provider 验证 profile/reasoning request body 与 TUI visibility，不暴露真实 API key。
- SKIPPED：未新增真实 Windows shell codepage 长链路测试；本轮在 presenter 层覆盖疑似 mojibake 诊断，并通过不 dump Bash stdout/stderr 降低报告污染风险。
- PARTIAL：Phase 15 Beta readiness 仍为 PARTIAL。本报告只关闭 Batch 2 Output / provider / Windows clarity，不代表 Beta PASS。
- BLOCKED：无。focused tests、check、typecheck、test、build 均已通过。

## 阶段边界

- 只执行 Batch 2 — Output / provider / Windows clarity。
- 未进入 Batch 3。
- 未进入 Phase 15.5。
- 未进入 Phase 16+。
- 未做 codebase-memory 内置化。
- 未宣布 Phase 15 Beta PASS。
- 未提交 commit。
- 未做完整 rich expand/collapse UI。
- 未做真实 billing/quota 深度对账。
- 未做 prompt-only fix。
- 未做大范围 command registry refactor。
- 未复制 CCB 可疑源码实现。
