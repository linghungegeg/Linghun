# Run 3 Output Surface / Index UX Closure

## 结论

本轮修复把 `/index refresh` 的大文件策略从“主屏阻塞并要求先 repair”
改为“默认临时跳过风险项并继续刷新”。Ink 主屏只显示短摘要和一个下一步动作；
完整 skipped list、文件大小、原因和持久化建议进入 `detailsText` / Ctrl+O。

本轮未 commit，未触碰 `.claude/`，未放松权限系统，未改 provider/model route，
未改 D.13U/D.13V 反幻觉 gate。

验证状态：Final Addendum 返修后，必跑命令均已通过；TUI 全量 vitest 不再 partial。

## CCB 源码行为矩阵

读取文件：

- `F:\ccb-source\src\Tool.ts`
- `F:\ccb-source\src\components\Message.tsx`
- `F:\ccb-source\src\components\messages\AssistantToolUseMessage.tsx`
- `F:\ccb-source\src\components\messages\UserToolResultMessage\UserToolResultMessage.tsx`
- `F:\ccb-source\src\components\MessageResponse.tsx`
- `F:\ccb-source\packages\builtin-tools\src\tools\BashTool\UI.tsx`

| 层级 | CCB 行为模型 | Linghun 本轮采用的边界 |
| --- | --- | --- |
| tool use | `AssistantToolUseMessage` 只渲染工具名、短输入和状态，不把完整工具协议当普通 assistant 文本。 | `/index refresh` 结果走 `CommandPanel` summary，不把 runtime 字段写成主消息长文。 |
| progress | CCB progress 来自 `ProgressMessage` / tool progress renderer，和 assistant text 分开；Bash running output 由 `ShellProgressMessage` 渲染。 | 移除 `/index` scanning/running 的长期 `writeLine`，progress 不再持久污染 Ink output block。 |
| tool result | `UserToolResultMessage` 按 success / error / reject / cancel 分流，不等同于 model-facing tool result。 | 索引结果主屏只给用户摘要；完整 skip 证据进 details/evidence。 |
| error / rejected | CCB 对 `is_error`、reject、cancel 有单独 UI。 | `/index repair` 仍走既有权限与拒绝路径；拒绝不写 ignore、不刷新。 |
| command display | Bash 非 verbose 下截断长命令，sed 编辑显示文件路径或短路径。 | Ink 主屏不刷命令清单、ignore 文件清单、force/repair/refresh 命令列表。 |
| transcript/search text | CCB 的 visible UI、model-facing tool result、transcript/search text 各有来源，不是同一份文本。 | Linghun 继续保留 plain/headless 兼容输出，但真实 Ink TTY 以 panel/details 分层为准。 |

确认项：

- CCB 把 tool use / progress / tool result / error / rejected / transcript 分层渲染。
- progress 不是普通 assistant 文本。
- 命令在非 verbose 下会截断/隐藏。
- result UI、model-facing tool result、transcript/search text 不是同一个东西。

## Linghun 旧问题根因

读取文件：

- `packages/tui/src/command-panel-runtime.ts`
- `packages/tui/src/tui-output-surface.ts`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/tool-output-presenter.ts`
- `packages/tui/src/index-result-presenter.ts`
- `packages/tui/src/index-tool-runtime.ts`
- `packages/tui/src/index-runtime.ts`
- `packages/tui/src/mcp-index-runtime.ts`
- `packages/tui/src/mcp-index-command-runtime.ts`
- `packages/tui/src/advanced-slash-panel-invariant.test.ts`
- `packages/tui/src/shell/components/CommandPanel.tsx`
- `packages/tui/src/shell/components/CtrlOToExpand.tsx`

旧问题主要在 `/index refresh` 调用链：

- `runIndexRepository()` 先用 `writeLine` 输出 `Index: scanning safety risks...`。
- 风险文件命中后直接设置 stale/error，写入“索引安全门”长文并 return。
- `formatIndexSafetyWarning()` 的 primary 文案混入 `.linghunignore`、`.cbmignore`、
  `/index repair`、`/index refresh` 和 `--force` 命令清单。
- `writeLine` 进入 `ShellBlockOutput._write()` 后会形成普通 output block；
  因此扫描中、执行中、完整诊断和命令清单会长期留在主消息流。
- 运行时状态、命令回显、details 级别证据和 indexer 细节没有稳定分流到
  panel/details/transcript，导致本应只在 Ctrl+O / details 查看内容被当作主屏
  output block 持久化。

已有正确分层路径：

- `showCommandPanel()` 在 Ink session 只写 `context.commandPanelState`。
- `CommandPanel` 主屏渲染 summary/actions，`detailsText` 仅在展开时显示。
- `shell/view-model.ts` 已有 Ctrl+O hint 去重逻辑，避免同一 output block 重复提示。
- plain/headless 仍会把 `detailsText` 写出来，这是兼容行为，不作为真实 TTY 主屏标准。

## 本轮实现

默认 `/index refresh` / `/index init fast`：

- 复用 `scanIndexSafety()` 和 `IndexSafetyResult`。
- 非 `--force` 且发现风险项时，不再 blocked。
- 构造 transient exclude list，并传给 `index_repository`：
  `transient_exclude_paths` 和 `skip_paths`。
- 普通 refresh 不写 `.linghunignore` / `.cbmignore`。
- 完成后主屏短摘要：
  - ready：`索引已刷新，已自动跳过 N 项大文件/生成物。`
  - stale：`索引刷新已执行，已跳过 N 项大文件/生成物；当前状态仍为 stale。`
- 完整 skipped list、大小、原因、持久化建议只进 `detailsText` / evidence。
- 失败时不写“已刷新/已完成”口径。

`/index repair`：

- 仍是唯一持久写 ignore 条目的入口。
- 写入 `.linghunignore` / `.cbmignore` 仍走既有权限管道。
- 拒绝权限时不写文件，也不新增 repair 后刷新。

`--force`：

- 表示用户明确要求尝试索引风险项。
- 不传 transient excludes。
- 仍沿用现有 `validateCodebaseMemoryToolExecution()` 和路径/权限边界。

索引器现实核对：

- `codebase-memory-mcp 0.6.1` 可接受 `transient_exclude_paths` / `skip_paths` 字段。
- 临时项目探针中传 `skip_paths:["b.ts"]` 后，搜索 `skipProbeSymbol` 返回 0 结果，
  说明 skip 在本地 runtime 实际生效。

## 实际触碰文件

版本 diff 文件：

代码：

- `packages/tui/src/index-result-presenter.ts`
- `packages/tui/src/index-tool-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/mcp-index-command-runtime.ts`
- `packages/tui/src/mcp-index-runtime.ts`

测试：

- `packages/tui/src/index.test.ts`
- `packages/tui/src/advanced-slash-panel-invariant.test.ts`

文档：

- `docs/audit/run-3-output-surface-product-closure.md`

运行时本地状态：

- 索引器 dry-run 形态探针可能刷新了 `.codebase-memory` 本地状态；该路径未进入
  tracked diff。
- `.claude/` 当前为未跟踪目录，本轮未读取其内容、未修改其文件，tracked diff
  不包含 `.claude/`。

## Focused Tests

已通过：

- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "Run 3|D.14D: /index repair|allows forced index commands|D.14D-R P0-1"`
  - PASS：1 file，15 passed，396 skipped。
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "Run 3|D.14D-R P0-2|D.14D: /index repair|allows forced index commands|D.14D-R P0-1"`
  - PASS：1 file，18 passed，394 skipped。
- `corepack pnpm --filter @linghun/tui exec vitest run src/advanced-slash-panel-invariant.test.ts`
  - PASS：1 file，27 passed。

覆盖点：

- 默认 `/index refresh` 扫到大文件风险时继续 refresh，并传 transient excludes。
- 默认 refresh 不写 `.linghunignore` / `.cbmignore`。
- Ink 主屏摘要不含 `.linghunignore`、`.cbmignore`、`/index repair`、
  `/index refresh`、`--force`。
- `detailsText` 包含完整 skipped list、文件大小、原因和持久化建议。
- scanning/progress 不持久进入普通 output block。
- stale 结果不出现“已完成/已更新完成”。
- `/index repair` 写 ignore 仍走权限管道。
- `--force` 不使用 transient excludes。
- 旧 invariant 已改为“progress 不得污染 Ink 主屏”。
- 结构化 `IndexRefresh` 工具路径不再把刷新摘要重复写成普通 output block；
  stale 文案改为“已执行但仍 stale”。

## Full Validation

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm check` | PASS |
| `corepack pnpm exec tsc --noEmit` | PASS |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm --filter @linghun/providers exec vitest run` | PASS：1 file，122 tests |
| `corepack pnpm --filter @linghun/cli exec vitest run` | PASS：1 file，8 tests |
| `corepack pnpm --filter @linghun/tui build` | PASS |
| `corepack pnpm --filter @linghun/cli build` | PASS |
| `git diff --check` | PASS |
| `corepack pnpm --filter @linghun/tui exec vitest run src/dist-integrity.test.ts` | PASS：targeted rerun，4 tests |
| `corepack pnpm --filter @linghun/tui exec vitest run` | Final Addendum 前：PARTIAL：50 files passed，2 failures；返修后：PASS：52 files，2047 tests |

TUI full vitest failures:

- Final Addendum 返修前：
  - `src/dist-integrity.test.ts > dist/index.js can be dynamically imported...`
    在全量并发下 5 秒 timeout；targeted rerun PASS，判断为全量并发/旧 dist import
    timing 问题。
  - `src/index.test.ts > records selected runtime profile before ordinary model requests`
    稳定失败：测试期望 OpenAI responses `reasoning.effort="Medium"`，实际 provider
    请求为 `reasoning.effort="medium"`。`packages/providers/src/index.test.ts`
    已覆盖并要求 lowercase。
- Final Addendum 返修后：
  - dist dynamic import 用例仅把该用例 timeout 放宽到 30 秒，不改 runtime。
  - TUI 断言按 providers 当前真实契约改为 lowercase `reasoning.effort="medium"`，
    未改 provider/model route。
  - 全量 TUI vitest PASS：52 files，2047 tests。

Secret scan:

- 命令：`rg -n --hidden --glob '!.claude/**' --glob '!node_modules/**' --glob '!dist/**' ...`
- 结果：命中均为测试 fixture 或文档示例，包括 `sk-test-*`、`sk-cli-*`、
  `LINGHUN_OPENAI_API_KEY=...` 示例和 redaction 测试；未发现真实 provider key、
  Feishu webhook/signing secret/App Secret 落盘。
- 备注：第一次 secret scan 未排除 `.claude/**`，只读扫到了未跟踪 `.claude/`
  worktree 中的历史 fixture；随后已重跑排除 `.claude/**` 的扫描，未修改 `.claude/`。

## TTY / Ink Smoke

等价 Ink smoke（测试内设置 `context.isInkSession=true`，未单独保存真实 TTY
截图/录屏）：

- `Run 3: Ink auto-skip summary hides commands while detailsText keeps skipped list`
  验证 `context.isInkSession=true` 时主屏 summary 不含 `.linghunignore`、
  `.cbmignore`、`/index repair`、`/index refresh`、`--force`；完整 skipped list
  只在 `detailsText`。
- `Run 3: scanning progress is not persisted as an ordinary output block`
  验证 scanning/running progress 不进入普通 output block。
- `Run 3: Ink model IndexRefresh approval does not write its tool summary as ordinary output`
  验证结构化 `IndexRefresh` 权限确认后不重复刷工具摘要。

Plain/headless smoke：

- 临时项目放置 `debug.log`（1.1 MB），配置 mock `codebase-memory`，输入：
  `你是谁`、`/index refresh`、`/exit`。
- 结果：普通输入未触发索引安全门；`/index refresh` 调用 `index_repository`
  并传入 `transient_exclude_paths:["debug.log"]`、`skip_paths:["debug.log"]`；
  index status 最终 ready。
- plain/headless 输出按兼容策略打印 `detailsText`，因此会出现完整 skipped list
  和 ignore 建议；这不是 Ink 主屏体验。

验收目标状态：

- 输入“你是谁”。
- 输入 `/index refresh` 或等价索引刷新入口。
- 不再出现“索引安全门”长文。
- 不要求用户先修 ignore。
- 大文件默认跳过并继续刷新。
- 不刷命令清单。
- scanning/progress 不永久占屏。
- 主屏短，footer 状态一致。
- stale 不说完成。
- Ctrl+O 不重复。

说明：本轮未恢复自然语言关键词截获；自然语言“更新一下索引”若未进入显式索引命令，
不作为本轮新增能力。

## 边界声明

- 未 commit。
- 未读取或修改 `.claude/` 内容；当前 `.claude/` 是未跟踪目录，最终 tracked diff
  中没有 `.claude/`。如上所述，secret scan 第一次只读误扫包含 `.claude/` 路径，
  随后已用排除规则重跑。
- 未修改 provider/env/key/model route。
- 未改 D.13U/D.13V 反幻觉 gate。
- 未放松权限系统。
- 未新增索引框架，只在 refresh 调用链增加 transient skip 参数。
- 未复制 CCB 源码，只做行为模型对照。
- 本轮曾执行一次 `codebase-memory-mcp cli index_repository` 针对 `F:\Linghun`
  的 dry-run 形态探针；该 CLI 未识别 dry-run 字段并可能刷新了 `.codebase-memory`。
  这不是 `.claude/` 变更，最终 diff 未包含 `.codebase-memory`。

## Final Addendum

本次最小返修只处理 4 个尾巴，不开新阶段、不扩范围、不 commit、不 staged。

代码返修：

- `packages/tui/src/dist-integrity.test.ts`：只把 `dist/index.js` dynamic import
  用例 timeout 调整为 30 秒，稳定全量并发下的 module graph 检查；未改 runtime。
- `packages/tui/src/index.test.ts`：`reasoning.effort` 断言从 `"Medium"` 改为
  providers 当前真实契约 `"medium"`；未改 provider/model route。
- `packages/tui/src/index.ts` / `packages/tui/src/index-tool-runtime.ts`：`/index repair`
  无可持久化项时，不再说“安全门阻塞”，改为：
  “当前没有可持久化的索引跳过建议。先运行索引刷新；如刷新时自动跳过了大文件/生成物，可再运行索引修复把规则写入 ignore。”
- `packages/tui/src/index-result-presenter.ts`：确认 `formatIndexSafetyWarning()` 主链无调用后删除，
  防止“索引安全门”长文回到主屏。

Final Addendum 验证：

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm check` | PASS |
| `corepack pnpm exec tsc --noEmit` | PASS |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm --filter @linghun/tui exec vitest run` | PASS：52 files，2047 tests |
| `corepack pnpm --filter @linghun/providers exec vitest run` | PASS：1 file，122 tests |
| `corepack pnpm --filter @linghun/cli exec vitest run` | PASS：1 file，8 tests |
| `corepack pnpm --filter @linghun/tui build` | PASS |
| `corepack pnpm --filter @linghun/cli build` | PASS |
| `git diff --check` | PASS |
| secret scan（排除 `.claude/**`、`node_modules/**`、`dist/**`、`coverage/**`） | 只命中 fixture/example/doc 中的假 key、env 名或 redaction 测试；未发现真实 provider key、Feishu webhook/signing secret/App Secret |

TTY smoke 说明：

- 当前 Codex 工具会话的 `[Console]::IsOutputRedirected` 与
  `[Console]::IsInputRedirected` 均为 `True`，无法从本工具捕获真实 Ink TTY 帧。
- 已保留等价 Ink smoke（`context.isInkSession=true`）验证主屏短摘要、details 分层、
  progress 不进入普通 output block、Ctrl+O 不重复。
- 真实终端验收命令应在非 redirected TTY 中执行：
  1. 输入“你是谁”。
  2. 输入 `/index refresh`。
  3. 主屏应无“索引安全门”长文、无命令清单、progress 不持久占屏、Ctrl+O 不重复、
     footer 与正文状态一致。

边界：

- 未 commit，未 staged。
- 未读取或修改 `.claude/` 内容；tracked diff 不包含 `.claude/`。
- 未放松权限系统，未改 provider/env/key/model route，未改 D.13U/D.13V 反幻觉 gate。
