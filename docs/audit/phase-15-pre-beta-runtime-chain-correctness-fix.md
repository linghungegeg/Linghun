# Phase 15 pre-Beta：Runtime chain correctness fix

日期：2026-05-20

## 根因

Batch 1 只处理 `docs/audit/phase-15-ccb-grade-default-runtime-reconciliation.md` 中定义的 Runtime chain correctness 问题，不进入 Batch 2/3、Phase 15.5 或 Phase 16+。

本轮根因聚焦在普通请求进入 model/tool loop 后的链路闭合：

1. pending model tool approval 已能在 allow/deny 后进入 continuation，但 cancel 与 deny 没有形成可区分的 model-visible outcome，导致取消语义在后续模型上下文里不可见。
2. Bash 工具如果正常返回 `ToolOutput` 但 `exitCode !== 0`，旧链路把 transcript `tool_result.isError` 和 model-visible `ok` 当作成功，导致 tool error / timeout / abort 这类通过非零退出码表达的失败不能稳定回灌模型。
3. status line 只区分 Start Gate confirmation，pending local approval 时仍显示 `gate=none`，pending 期间用户执行 `/status` / `/mode` 时不容易确认“权限审批还在等待”。
4. report-generation Write closure 已有 runtime guard、Write permission prompt、tool_result continuation 和 final reference reminder，本轮补齐 Batch 1 证据，不把它扩大成 prompt-only fix 或新 UI/refactor。

## 改动文件

- `packages/tui/src/index.ts`
  - pending local approval 的 `cancel` / `取消` 现在生成 `permission cancelled by user`，并在 model-visible tool result 中写入 `outcome: "cancelled"`。
  - pending local approval 的 `deny/no` 保持 `permission denied by user`，并在 model-visible tool result 中写入 `outcome: "denied"`。
  - `executeApprovedModelToolUse(...)` 对 Bash `ToolOutput.data.exitCode !== 0` 生成 `ok: false`，transcript `tool_result.isError=true`，再 continuation 回灌模型。
  - slash/local `handleToolCommand(...)` 同步用同一失败判定写 transcript `tool_result.isError`，避免本地 Bash 非零退出被记录成成功。
  - `writeStatus(...)` 在 pending local approval 时传入 `gate: "waiting approval"`。
- `packages/tui/src/runtime-status-presenter.ts`
  - `RuntimeStatusView.gate` 增加 `"waiting approval"`。
  - status line 显示 `gate=approval`，并保留原有 cache/index/model/provider 信息。
- `packages/tui/src/index.test.ts`
  - 新增 cancel approval model-visible continuation 回归。
  - 新增 pending approval 期间普通追问不进模型、`/status` / `/mode` 不消耗 pending approval、后续 `yes` 仍可恢复 continuation 的回归。
  - 新增 Bash 非零退出作为 failed model-visible `tool_result` 的回归。
  - 保留并通过既有普通输入真实 prompt、deny/no、allow/yes、Write report closure、Read failure continuation、multi-tool continuation 回归。
- `docs/audit/phase-15-pre-beta-runtime-chain-correctness-fix.md`
  - 本报告。

## Batch 1 覆盖项

目标链路：

```text
普通请求 -> model -> tool_use -> permission -> tool_result -> continuation -> final answer
```

覆盖结果：

1. 普通输入默认进入 model/provider/tool loop：PASS。
   - 保留真实 prompt 回归：`帮我看看这是什么项目 该怎么部署 把报告更新在根目录下 有索引 优先使用索引`。
   - focused TUI tests 仍断言该 prompt 进入 provider path，输出 `状态：正在请求模型`，且不输出 `/index：代码索引`。
2. pending approval 状态机：PASS（见下方矩阵）。
3. report-generation path：PASS（见 Write closure 证据）。
4. 所有 permission outcome model-visible continuation：Batch 1 范围内 PASS。
   - allow/yes：执行工具，写入 `tool_result`，continuation 继续请求模型。
   - deny/no：写入 failed evidence，`tool_result` 包含 `ok:false` 与拒绝原因，continuation 继续请求模型。
   - cancel：写入 failed evidence，`tool_result` 包含 `ok:false`、`outcome:"cancelled"` 与取消原因，continuation 继续请求模型。
   - hard deny / non-ask deny：既有路径写入 failed evidence 和 transcript `tool_result.isError=true`。
   - tool error / timeout / abort：抛错路径写入 `ok:false`；Bash 非零退出路径现在也写入 `ok:false` 和 transcript `isError=true`。

## 真实 prompt 回归结果

真实 prompt：

```text
帮我看看这是什么项目 该怎么部署 把报告更新在根目录下 有索引 优先使用索引
```

当前 focused TUI 回归保持：

- `handleNaturalInput(...)` 对该普通输入返回 `"message"`。
- stdin smoke 中该输入进入 provider/model 请求路径。
- provider request 数量为 1。
- 输出包含 `状态：正在请求模型`。
- 输出包含 mock provider 文本 `我会先按模型主链路分析项目部署。`。
- 输出不包含 `/index：代码索引`。

结论：Batch 1 未回退到关键词补丁或 catalog 抢答；普通项目/部署/报告/索引语义仍作为模型任务语义进入主链路。

## pending approval 状态机矩阵

| 场景 | 当前行为 | 覆盖证据 |
| --- | --- | --- |
| allow / yes | pending `model_tool_use` 执行真实工具，记录 evidence，追加 model-visible `role:"tool"` message，调用 `continueModelAfterToolResults(...)` 输出最终回答 | 既有 `generates project analysis report through model tool_call Write after permission approval`、`continues approved model tool results through another tool_use before final answer`、`runs model Write tool_use through permission ask, yes, real write, and evidence` |
| deny / no | 清空 pending，记录 failed evidence，追加 `ok:false` / `permission denied by user` 的 tool message，continuation 输出最终回答 | 既有 `continues after denied model tool permission as a tool_result`、`continues denied model tool permission without orphaning sibling tool calls` |
| cancel | 清空 pending，记录 failed evidence，追加 `ok:false` / `outcome:"cancelled"` / `permission cancelled by user` 的 tool message，continuation 输出最终回答 | 新增 `continues after cancelled model tool permission as a distinct tool_result` |
| pending 时用户普通追问 | 不发送给模型，不消耗 pending approval，提示用户先 yes/no/cancel，status line 显示 `gate=approval` | 新增 `keeps pending approval across ordinary follow-up and slash status queries` |
| pending 时 slash/status/mode 查询 | `/status` 显示 pending approval；`/mode` 可查询当前模式；二者不消耗 pending approval；后续 `yes` 仍执行原 pending tool 并 continuation | 新增 `keeps pending approval across ordinary follow-up and slash status queries` |
| tool error（throw） | catch 路径记录 failed evidence，追加 transcript `tool_result.isError=true`，返回 `ok:false` 给模型 continuation | 既有 `records failed model tool_result evidence for follow-up prompts` |
| timeout / abort / Bash 非零退出 | Bash 通过 `ToolOutput.data.exitCode` 表达非零退出；现在 `exitCode !== 0` 统一标记 `ok:false` 和 transcript `isError=true`。timeout/abort 在 Bash runner 中同样表现为非零退出/失败输出，因此走同一 model-visible 失败路径 | 新增 `returns Bash non-zero exits as failed model-visible tool_results`；工具层既有 Bash abort/timeout 语义由 `runShell(...)` 保持 |

## report-generation Write closure 证据

Batch 1 没有做 prompt-only fix，也没有新增 rich permission modal 或 command registry refactor；只验证并保留现有 runtime guard + permission + tool_result + continuation 闭环。

现有 report-generation 回归覆盖：

- 用户请求项目部署报告时，模型路径产生 `Write` tool_call。
- `Write` 在 default permission mode 下进入本地权限审批。
- 用户 `yes` 后执行真实 `Write`，产生 `command_output Write` evidence。
- transcript 包含：
  - `"type":"tool_call_start"`
  - `"name":"Write"`
  - `"type":"tool_result"`
  - `"toolName":"Write"`
  - `"isError":false`
  - `"evidenceId"`
- final model answer 引用实际报告路径，例如 `project-report.md` / `report.md` / `requested-report.md`。
- 多轮 continuation 覆盖 `Write -> tool_result -> model -> Read -> tool_result -> model -> final answer`。
- 显式报告缺少 Write evidence 时仍由本地 runtime guard 标记 incomplete/BLOCKED，不把“模型说已整理报告”误判为完成。

关于“不用 Bash redirection 写报告”：Batch 1 保持 tool schema 和 report guard 要求使用 Write；测试路径的 report-generation tool_call 为 `Write`，没有 Bash redirection 写报告。

## 测试结果

已运行并通过：

```bash
corepack pnpm exec vitest run packages/tui/src/index.test.ts
```

结果：PASS，1 file / 102 tests。

第一次 focused run 发现 status line 排版导致既有断言被截断；已最小调整 `runtime-status-presenter.ts`，保留 cache/index/model/provider 可见性并新增 `gate=approval`。

```bash
corepack pnpm check
```

结果：PASS，Biome checked 47 files，no fixes applied。

第一次 check 发现格式化差异；已按 Biome 建议做纯格式修正后重跑通过。

```bash
corepack pnpm typecheck
```

结果：PASS，`tsc -b tsconfig.json` 完成。

```bash
corepack pnpm test
```

结果：PASS，11 files / 293 tests。

```bash
corepack pnpm build
```

结果：PASS，workspace packages build 完成。

## SKIPPED / PARTIAL / BLOCKED

- SKIPPED：未运行真实外部 provider live smoke；本轮验收使用测试内 mock OpenAI-compatible provider 验证 Runtime chain，不写入或暴露真实 API key。
- SKIPPED：未新增真实长时间 timeout 的慢测试；Batch 1 用 Bash 非零退出覆盖 TUI 层 `ToolOutput.data.exitCode !== 0` 的 model-visible failure closure。Bash runner 的 timeout / abort 仍由工具层现有逻辑转为非零退出/失败输出，再进入同一 TUI 判定。
- PARTIAL：Phase 15 Beta readiness 仍为 PARTIAL。本报告只关闭 Batch 1 Runtime chain correctness，不代表 Beta PASS。
- BLOCKED：无。要求的 focused TUI tests、check、typecheck、test、build 均已通过。

## Index status

- `mcp__codebase-memory-mcp__index_status(project=F-Linghun)`：ready，nodes=1304，edges=2437。
- `mcp__codebase-memory-mcp__detect_changes(project=F-Linghun)`：changed files 包含本轮代码文件：
  - `packages/tui/src/index.ts`
  - `packages/tui/src/index.test.ts`
  - `packages/tui/src/runtime-status-presenter.ts`

## 阶段边界

- 只执行 Batch 1 — Runtime chain correctness。
- 未进入 Batch 2。
- 未进入 Batch 3。
- 未进入 Phase 15.5。
- 未进入 Phase 16+。
- 未宣布 Phase 15 Beta PASS。
- 未提交 commit。
- 未做关键词补丁。
- 未做 prompt-only fix。
- 未做 rich permission modal。
- 未做 command registry 大重构。
- 未做 workflow / agent / marketplace 扩展。
