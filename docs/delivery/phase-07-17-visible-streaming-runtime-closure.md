# Phase 7.17 Visible Streaming Runtime / CCB-Maturity Closure

## 阶段目标

修复真实 TUI 实测中可见 streaming 文本一卡一卡、长文本反复重排、普通聊天策略轻提示过重，以及工具结果大 payload 可能通过 `tool_call_end.output` 和 `tool_result.content` 双路径进入 transcript 的旁路风险。

本阶段只做 Phase 7.17，不 stage、不 commit、不进入 Phase 7.18；不处理 WHITEPAPER、`docs/stress/`、`img/`、`test-model-set.sh`、DH1-DH4。

## Source-Level Reality Check

本阶段开工前按用户要求读取并基于源码事实确认：

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-07-16-source-level-rc-audit-repair.md`
- `packages/tui/src/tui-output-surface.ts`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/components/ProductBlock.tsx`
- `packages/tui/src/shell/components/MessageMarkdown.tsx`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/evidence-runtime.ts`
- `packages/tui/src/tool-result-budget.ts`

CCB 行为参考文件：

- `F:\ccb-source\src\components\Messages.tsx`
- `F:\ccb-source\src\components\Markdown.tsx`
- `F:\ccb-source\src\components\VirtualMessageList.tsx`
- `F:\ccb-source\src\bootstrap\state.ts`

源码事实：

- Linghun 原 streaming preview 仍通过 `ShellBlockOutput.appendAssistantDelta()` 写入历史 `ProductBlock.fullText`，再经 `createShellViewModel()` 的 `view.blocks.map`、`ProductBlock` 和 `MessageMarkdown` 重渲染，长文本每次增长都会触发历史 block 路径重算。
- CCB 行为上把 streaming text 放在独立路径，完成后再进入正式 message/block 列表；StreamingMarkdown 使用 stable prefix / unstable suffix 的方向减少增长文本重复解析。
- 当前实测 transcript 约 24KB，卡顿主因不是 session 文件大小，而是主屏可见层渲染热路径。
- `tool_result` 已有预算路径，但 `createToolEndEvent()` 的 fallback `output.text` 仍需要补防线，避免同一大输出通过 `tool_call_end.output` 和 `tool_result.content` 双份保存。
- ordinary chat / edit risk 场景中，permission-risk、Windows-safe、verification/background 等策略 hint 在主屏过重；底层 `system_event` 可保留脱敏摘要。

## 已完成功能

- `ShellBlockOutput.appendAssistantDelta()` 改为只更新 `context.streamingAssistant` visible-only state，不再创建或修改历史 `ProductBlock`。
- `endAssistantStream()` 只在流结束时 commit 一条正式 `assistant_text` block，并清空 streaming preview。
- `discardAssistantBlock()` / `replaceAssistantBlockContent()` 同步清理 streaming state，final answer gate retry、discard、replace 不泄漏被丢弃文本。
- `sendMessage()` 与 `continueModelAfterToolResults()` 按 round 使用独立 streaming id，避免多轮 tool use、continuation、StartAgent continuation 把不同轮 preview 粘在一起。
- plain / memory output 不再接收 raw streaming delta；final gate 后才通过 `writeFinalAssistantText()` 输出最终文本，避免 gated discard 无法移除已写原文。
- `ShellViewModel.streamingAssistantText` 独立于 `blocks` 输出；`ShellApp` 在历史 blocks 后、activity 前渲染 `StreamingMarkdown` sibling。
- `createShellViewModel()` 只在 streaming id 对应的正式 assistant block 内容一致时隐藏 preview，避免正式 block 出现后重复显示。
- 新增自研 `StreamingMarkdown`，在现有 `MessageMarkdown` 基础上按 stable prefix / unstable suffix 分段渲染，稳定前缀用 memoized `MessageMarkdown`，增长尾部继续使用现有 Markdown 能力。
- 主屏 policy hint 只保留 provider cooldown、compact-before-provider、high-stakes release、trust repair、provider fallback 和真实 blocked runtime；ordinary permission/windows/verification/background/frustrated hint 仅保留底层 `system_event` 摘要。
- `createToolEndEvent()` 的 fallback 文本经 `compactToolEndTextForTranscript()` 截断并保留 `fullOutputPath` 引用，避免大输出在 `tool_call_end.output` 中重复保存。

## 使用方式

用户无需新增配置或操作路径：

- TUI streaming assistant preview 自动走独立 visible runtime。
- 正式 assistant answer 在完成或 final gate 替换后正常进入 transcript。
- 主屏不新增可见配置面板，不恢复蓝色选择层、mouse capture、auto copy。
- 工具大输出继续通过现有 artifact/ref/evidence 路径保留，主屏和 transcript 只保留摘要。

## 涉及模块

- `packages/tui/src/tui-context-runtime.ts`
- `packages/tui/src/tui-output-surface.ts`
- `packages/tui/src/shell/types.ts`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/components/MessageMarkdown.tsx`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/evidence-runtime.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/shell/view-model.test.ts`
- `packages/tui/src/tool-result-budget.test.ts`
- `packages/tui/src/capability-runtime.test.ts`
- `packages/tui/src/job-runtime.test.ts`
- `docs/delivery/README.md`

## 关键设计

- streaming preview 是 TUI visible-only state，不写 transcript、不进入模型 token、不参与历史 `ProductBlock` 渲染热路径。
- 正式 assistant block 只在 end / replace 时进入 `blocks`，并继续复用现有 `ProductBlock`、`MessageMarkdown`、Ctrl+O/details 边界。
- `StreamingMarkdown` 只做渲染分段优化，不替代现有 Markdown 解析能力；中文段落、列表、代码块、粗体、行内 code 仍由 `MessageMarkdown` 负责。
- stable prefix 只在安全边界推进：空行、关闭的代码围栏，或完整 newline suffix；不对未闭合 Markdown 尾部做稳定化。
- policy system_event 和主屏 notification 分层：可见层只展示用户需要立即感知的 runtime 提示，普通策略判断留在 transcript/system_event。
- `tool_call_end.output` 与 `tool_result.content` 双路径同时受预算保护：tool end 保留截断摘要，tool result 保留 artifact/ref 与 hash/evidence。

## 配置项

无新增配置项。

## 命令

本阶段没有新增用户命令。

## 测试与验证

已新增/更新 focused tests 覆盖：

- `appendAssistantDelta` 不创建 `ProductBlock`，只更新 independent streaming state。
- `endAssistantStream` 只 commit 一条正式 assistant block，并清空 preview。
- final gate discard / replace 不泄漏旧 streaming 文本。
- continuation / 多轮 tool use 新 round 不粘 preview。
- `StreamingMarkdown` stable prefix 不重复解析已稳定前缀。
- `ShellApp` 中 streaming preview 位于历史 blocks 后、activity 前，并与正式 block dedupe。
- ordinary chat / edit policy hint 不刷重策略提示；provider cooldown、compact-before-provider、真实 blocked runtime 仍显示。
- Read / Grep / Glob / Bash / Capability / Agent / Job 的 100KB 输出不在 transcript 通过 `tool_call_end.output` 与 `tool_result.content` 重复保存。

验证命令：

```powershell
corepack pnpm --filter @linghun/tui typecheck
corepack pnpm exec vitest run packages/tui/src/shell/view-model.test.ts packages/tui/src/model-prompt-runtime.test.ts packages/tui/src/meta-scheduler-runtime.test.ts --no-color
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "streaming|StreamingMarkdown|Policy|策略|tool result|transcript|budget|final answer|StartAgent|continuation" --no-color
corepack pnpm exec vitest run packages/tui/src/tool-result-budget.test.ts packages/tui/src/provider-transit-failure.test.ts packages/tui/src/model-loop-runtime.test.ts --no-color
corepack pnpm exec biome check packages/tui/src/tui-context-runtime.ts packages/tui/src/tui-output-surface.ts packages/tui/src/shell/types.ts packages/tui/src/shell/view-model.ts packages/tui/src/shell/components/ShellApp.tsx packages/tui/src/shell/components/MessageMarkdown.tsx packages/tui/src/model-stream-runtime.ts packages/tui/src/evidence-runtime.ts packages/tui/src/index.test.ts packages/tui/src/shell/view-model.test.ts packages/tui/src/tool-result-budget.test.ts packages/tui/src/capability-runtime.test.ts packages/tui/src/job-runtime.test.ts
corepack pnpm --filter @linghun/tui build
corepack pnpm --filter @linghun/cli build
git diff --check
```

结果：

- `@linghun/tui` typecheck PASS。
- `view-model.test.ts` + `model-prompt-runtime.test.ts` + `meta-scheduler-runtime.test.ts` PASS。
- `index.test.ts` selected streaming / policy / transcript / final answer / StartAgent / continuation regression PASS。
- `tool-result-budget.test.ts` + `provider-transit-failure.test.ts` + `model-loop-runtime.test.ts` PASS。
- scoped Biome check PASS。
- `@linghun/tui` build PASS。
- `@linghun/cli` build PASS。
- `git diff --check` PASS。

## 性能结果

- streaming delta 不再反复写入 `ProductBlock.fullText`，历史 `view.blocks.map -> ProductBlock -> MessageMarkdown` 路径保持稳定。
- 可见 preview 使用独立 sibling 渲染，稳定 prefix 通过 memoized `MessageMarkdown` 保持，增长尾部才继续解析。
- 不新增模型调用、后台扫描、终端 renderer、mouse capture 或复制 UI。

## 已知问题

- `StreamingMarkdown` 的 stable boundary 保守推进，未闭合的复杂 Markdown 尾部仍作为 unstable suffix 重算；这是为避免半成品 Markdown 被错误稳定化。
- 正式 assistant block commit 后仍复用现有历史 Markdown 渲染路径；本阶段目标是移除 streaming 热路径重排，不改历史 transcript 渲染架构。
- 大输出 artifact/ref 仍依赖现有 evidence / budget 目录和 session 生命周期；本阶段不新增清理策略。

## 不在本阶段处理的内容

- 不进入 Phase 7.18。
- 不处理 WHITEPAPER、`docs/stress/`、`img/`、`test-model-set.sh`、DH1-DH4。
- 不新增可见配置面板。
- 不恢复蓝色复制/选择 UI、mouse capture、alternate screen 或 auto copy。
- 不把详细日志、raw tool_result、raw policy decision 放主屏。
- 不新增第二套 Markdown parser、终端渲染器或 session persistence 架构。

## 下一阶段衔接

下一阶段只能由用户明确确认后开始。Phase 7.17 交付后建议先做真实 TUI streaming 体感 smoke，重点观察：

- 长文本 streaming 是否平滑。
- final gate downgrade / replace 是否不闪旧文。
- 多轮 tool use / continuation preview 是否不粘连。
- 大工具输出 transcript 是否只保留摘要与 artifact/ref。

这些观察不等于自动进入 Phase 7.18。

## 开发者排查入口

- Streaming visible state：`packages/tui/src/tui-output-surface.ts`
- View model dedupe：`packages/tui/src/shell/view-model.ts`
- Shell render order：`packages/tui/src/shell/components/ShellApp.tsx`
- Streaming Markdown split：`packages/tui/src/shell/components/MessageMarkdown.tsx`
- Model streaming / final gate：`packages/tui/src/model-stream-runtime.ts`
- Tool end transcript compact：`packages/tui/src/evidence-runtime.ts`
- Tool result budget：`packages/tui/src/tool-result-budget.ts`
- Focused tests：`packages/tui/src/shell/view-model.test.ts`、`packages/tui/src/tool-result-budget.test.ts`、`packages/tui/src/index.test.ts`

## 参考核对

- 实际读取 Linghun 文档：见 Source-Level Reality Check。
- 实际读取 CCB 参考：`Messages.tsx`、`Markdown.tsx`、`VirtualMessageList.tsx`、`bootstrap/state.ts`。
- 行为参考：独立 streaming text 路径、完成后进入正式历史列表、stable prefix / unstable suffix 的成熟方向、虚拟列表对历史消息稳定性的关注。
- 进入 Linghun 自研实现的内容：`context.streamingAssistant` visible-only state、`ShellViewModel.streamingAssistantText`、`ShellApp` sibling preview、自研 `StreamingMarkdown` split helper、tool end compact fallback、policy visible hint filter。
- 未复制 CCB 可疑源码实现、反编译痕迹、内部 API、专有 telemetry 或内部服务逻辑。

## 成品级 handoff packet

- 下一阶段：等待用户确认；不得自动进入 Phase 7.18。
- 禁止事项：不得 stage/commit；不得触碰 forbidden dirty files；不得恢复 mouse capture / alternate screen / 蓝色选择层；不得把 raw policy/tool payload 放主屏；不得用文档补丁替代主链源码事实。
- 证据引用：
  - `packages/tui/src/tui-output-surface.ts`
  - `packages/tui/src/shell/view-model.ts`
  - `packages/tui/src/shell/components/ShellApp.tsx`
  - `packages/tui/src/shell/components/MessageMarkdown.tsx`
  - `packages/tui/src/model-stream-runtime.ts`
  - `packages/tui/src/evidence-runtime.ts`
  - `packages/tui/src/tool-result-budget.test.ts`
  - `packages/tui/src/index.test.ts`
- 验证结果：typecheck、focused vitest、scoped Biome、TUI build、CLI build、`git diff --check` 均 PASS。
- 索引状态：codebase-memory MCP 本轮未暴露；未执行慢 rebuild、force refresh 或联网安装。
- 权限模式：本地 Codex desktop，filesystem unrestricted；未 stage、未 commit。
- 模型/provider：Codex GPT-5；本阶段验证为本地测试/build，未执行真实 provider full-chain stress。
- 预算使用：streaming preview 不增加模型 token、不写 transcript；测试/build 无外部 provider token 消耗。
