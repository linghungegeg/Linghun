# Phase 7.17.1 Main Transcript Surface / CCB Scrollback Closure

## 阶段目标

关闭 Phase 7.17 后仍遗留的普通 task 主屏 transcript surface 问题：长 assistant 正文、老对话回看、streaming sibling 位置、AgentControl/StartAgent/workflow/verification 控制工具主屏噪音。

本阶段只做 Phase 7.17.1：复用 Linghun 现有 ScrollViewport / TranscriptViewport / transcript scroll state 做最小源码级修补；不进入 Phase 7.18，不 stage、不 commit，不触碰 forbidden dirty paths。

## Source-Level Reality Check

本阶段实际核对的 Linghun 文档：

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-07-17-visible-streaming-runtime-closure.md`
- 用户粘贴的 Phase 7.17.1 scope：`C:\Users\Admin\.codex\attachments\e5323202-d97e-4027-b0de-bcbc986dd054\pasted-text.txt`

本阶段实际核对的 Linghun 源码：

- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/components/ScrollViewport.tsx`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/shell/view-model.test.ts`
- `packages/tui/src/shell/models/tui-interaction-contract.test.ts`
- `packages/tui/src/tui-output-surface.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/model-tool-runtime.ts`
- `packages/tui/src/deferred-tools-catalog.ts`
- `packages/tui/src/command-panel-runtime.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/workflow-command-runtime.ts`
- `packages/tui/src/background-control-runtime.ts`
- `packages/tui/src/index.test.ts`

本阶段实际核对的 CCB 行为参考：

- `F:\ccb-source\src\components\Messages.tsx`
- `F:\ccb-source\src\components\VirtualMessageList.tsx`
- `F:\ccb-source\src\hooks\useVirtualScroll.ts`
- `F:\ccb-source\packages\@ant\ink\src\components\ScrollBox.tsx`
- `F:\ccb-source\src\screens\REPL.tsx`
- `F:\ccb-source\src\components\MessageRow.tsx`
- `F:\ccb-source\src\components\messages\AssistantToolUseMessage.tsx`
- `F:\ccb-source\packages\builtin-tools\src\tools\MCPTool\UI.tsx`
- `F:\ccb-source\src\utils\groupToolUses.ts`
- `F:\ccb-source\src\utils\collapseReadSearch.ts`
- `F:\ccb-source\src\utils\collapseHookSummaries.ts`
- `F:\ccb-source\src\utils\collapseTeammateShutdowns.ts`

CCB 源码事实只作为行为边界参考：fullscreen transcript 用 `ScrollBox` sticky scroll；历史消息走 `VirtualMessageList` + `useVirtualScroll`；`streamingText` 是历史列表后的独立 sibling，并与最后正式 assistant message 去重；tool/read/search/hook/grouped tool use 有折叠和降噪层。Linghun 未复制 CCB 源码、内部 API、专有 telemetry 或可疑实现。

## 源码事实结论

Existing implementation:

- Linghun 已有 `TranscriptViewport`，基于标准 Ink 的测量、clamp、stick-to-bottom 和 `overflow="hidden"` 实现滚动视口。
- `TranscriptViewport` 已支持 `onMeasure` 和 `onGeometry`，controller 已有 `transcript-scroll-measure` / `transcript-viewport-geometry` 输入。
- Phase 7.17 已把 streaming assistant preview 做成 `view.streamingAssistantText`，可作为历史 blocks 后的独立 sibling。
- Deferred `SearchExtraTools` / `ExecuteExtraTool` 已通过 `sanitizeDeferredToolPrimaryText()` 降噪，并把 raw data 留在 transcript/evidence。
- Model-facing `AgentControl` / `StartAgent` / `RunWorkflow` / `RunVerification` 仍会复用 slash runtime 时把内部控制输出写进普通主屏。

Gaps:

- `ShellApp` task 主屏仍是固定高度容器内直接 `view.blocks.map()`，普通 transcript 没有走现有测量滚动视口。
- 旧源码 invariant 仍要求普通 task 主屏不挂 `TranscriptViewport`，与 Phase 7.17.1 scope 冲突。
- `AgentControl` list/cancel/cancel_all/stop_all 的普通主屏会出现 raw 英文控制文本或 agent id 列表。
- `StartAgent` / `RunWorkflow` / `RunVerification` 的 model-facing 内部执行仍可能把 slash/status/panel 输出作为普通对话噪音刷出。

Minimal touch points:

- `ShellApp.tsx`：把普通 transcript 内容接入既有 `TranscriptViewport`。
- `model-tool-runtime.ts`：model-facing 控制工具内部执行改用 silent output；主屏写一句人话摘要，raw text/data 保留在 tool_result。
- `view-model.test.ts` / `index.test.ts`：更新旧 invariant 并补 AgentControl 降噪/长输出回归。
- `docs/delivery/README.md` 与本文档：阶段闭环记录。

Forbidden duplicate systems / NOT-DO:

- 不新增第二套 terminal renderer。
- 不移植或复制 CCB `ScrollBox` / `VirtualMessageList` 源码。
- 不新增第二套 transcript persistence、scheduler、agent system、workflow runtime 或 copy UI。
- 不改 provider 路由、权限语义、DH1-DH4 或 Phase 17B/18 能力。

## 已完成功能

- 普通 task 主屏 transcript 内容接入 `TranscriptViewport`，包括历史 blocks、streaming assistant sibling、activity、suggestions、limitations。
- `TranscriptViewport` 的测量和几何信息通过 controller 继续走 `transcript-scroll-measure` / `transcript-viewport-geometry`，复用既有 sticky scroll / wheel / PgUp / PgDn / Home / End 语义。
- `PanelLayer` 保持在 `TranscriptViewport` 外，明确 slash/details/用户动作触发的高级面板不会被当作 transcript 内容滚走。
- `view.streamingAssistantText` 仍作为历史列表后的独立 sibling 渲染，并继续依赖 Phase 7.17 的 final block dedupe。
- 200+ 行 assistant 正文测试确认正式 assistant block 保留完整 `fullText`，不以 Ctrl+O/details 替代主 transcript 内容。
- Model-facing `AgentControl` list/cancel/cancel_all/stop_all 主屏改为人话摘要，raw diagnostic 仍写入 transcript `tool_result`。
- Model-facing `StartAgent`、`RunWorkflow`、`RunVerification` 内部 slash/workflow/verification 执行改用 silent output，避免默认把内部 panel/status 输出刷到普通主屏。
- 控制工具错误主屏会隐藏 `AgentControl`、`StartAgent`、`RunWorkflow`、`RunVerification` 等内部工具名；诊断仍保留在 transcript/evidence。

## 使用方式

用户无需新增命令或配置；普通 task TUI 自动生效。

- 长 transcript 回看继续使用现有滚动交互：wheel / PgUp / PgDn / Home / End / sticky bottom。
- `/details`、explicit slash panel、evidence 和 transcript 仍保留诊断入口。
- AgentControl 等模型控制工具的普通主屏只显示短状态；需要排查时通过 transcript/evidence/details 查看 raw 结果。

## 涉及模块

- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/model-tool-runtime.ts`
- `packages/tui/src/shell/view-model.test.ts`
- `packages/tui/src/index.test.ts`
- `docs/delivery/README.md`
- `docs/delivery/phase-07-17-1-main-transcript-surface-ccb-scrollback-closure.md`

## 关键设计

- 本阶段选择复用 Linghun 已存在的 standard Ink `TranscriptViewport`，完成“普通 task 主屏必须进入可测量、可夹紧、可回看的 transcript surface”的最小闭环。
- CCB 的 `ScrollBox` / `VirtualMessageList` 是行为参考，不是源码移植目标。Linghun 当前没有 React-level row virtualization；这点作为剩余差距保留，不宣称完全 CCB parity。
- Streaming preview 继续作为历史 blocks 后的独立 sibling；最终 assistant block dedupe 复用 Phase 7.17 已有路径。
- Model-facing 控制工具分层：内部 slash/runtime 输出走 silent output；主屏只写 `formatControlToolPrimaryText()` 的人话摘要；raw text/data 作为 tool_result 返回给模型和 transcript。
- 高级面板只由明确 slash/details/用户动作保留，不作为 model-facing control tool 的默认主屏出口。

## 配置项

无新增配置项。

## 命令

本阶段没有新增用户命令。

## 测试与验证

已新增/更新 focused tests 覆盖：

- `ShellApp TaskLayout uses scrollable transcript surface with top-left layout`
- `Phase 7.17.1: 200+ line assistant output stays in transcript body, not Ctrl+O substitute`
- `AgentControl` cancel/list/cancel_all/stop_all 主屏降噪，raw diagnostic 仍保留在 transcript `tool_result`

已运行验证：

```powershell
corepack pnpm exec vitest run packages/tui/src/shell/view-model.test.ts -t "TaskLayout|TranscriptViewport|200\+ line assistant|AgentControl|streaming" --no-color
```

结果：PASS，20 passed / 310 skipped。

```powershell
corepack pnpm --filter @linghun/tui typecheck
```

结果：PASS。

```powershell
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "AgentControl|可执行自然语言必须拒绝 CommandProposal fallback 并继续真实" --no-color
```

结果：PASS，10 passed / 648 skipped。

说明：曾并行运行两个同文件 `index.test.ts` filtered vitest 进程，出现共享 `fetch` stub / session 状态互相踩踏导致的假失败；已改为同文件串行 focused run 并通过。

```powershell
corepack pnpm exec vitest run packages/tui/src/shell/view-model.test.ts packages/tui/src/shell/models/tui-interaction-contract.test.ts --no-color
```

结果：PASS，362 passed。

```powershell
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "streaming|transcript|scroll|long output|AgentControl|StartAgent|SearchExtraTools|ExecuteExtraTool|agent|workflow|job|background|advanced panel|footer|status" --no-color
```

结果：PASS，190 passed / 468 skipped。

```powershell
corepack pnpm exec biome check packages/tui/src/shell/components/ShellApp.tsx packages/tui/src/shell/components/ScrollViewport.tsx packages/tui/src/shell/view-model.ts packages/tui/src/tui-output-surface.ts packages/tui/src/model-tool-runtime.ts packages/tui/src/model-stream-runtime.ts packages/tui/src/index.test.ts packages/tui/src/shell/view-model.test.ts docs/delivery/README.md docs/delivery/phase-07-17-1-main-transcript-surface-ccb-scrollback-closure.md
```

结果：PASS，checked 8 files。

```powershell
corepack pnpm --filter @linghun/tui build
corepack pnpm --filter @linghun/cli build
node F:\Linghun\apps\cli\dist\main.js --version
node F:\Linghun\apps\cli\dist\main.js --help
git diff --check
```

结果：PASS；CLI version 输出 `0.1.0`，help 输出包含 `Linghun 0.1.0` 和 Windows `Linghun --version` 兼容说明。

## 性能结果

- 普通 transcript 内容现在进入已有测量视口，长内容可通过现有 scroll state 回看，不再完全依赖固定窗口内直接 map 输出。
- 不新增模型调用、不增加 provider token、不新增后台扫描。
- 没有引入 CCB 级 React-level virtualization；超长历史仍会渲染现有 ProductBlock 树后由 standard Ink 输出层裁剪，这是本阶段最小实现的已知边界。

## 已知问题

- 本阶段没有实现 CCB 的 `VirtualMessageList` / `useVirtualScroll` React-level virtualization；只能称为“按 CCB 行为边界做最小可行 scrollback closure”，不能称为完整 CCB parity。
- `SearchExtraTools` / `ExecuteExtraTool` 主要依赖 Phase 7.17 前后的既有 sanitizer；本阶段未新增第二套 deferred tool grouping/collapse system。
- Workflow/job/background 的 slash 主动命令面板仍保留；本阶段只收敛 model-facing control tool 默认主屏输出。
- 真实 TUI 体感 smoke 尚未执行；本阶段验证为 focused/local regression。

## 不在本阶段处理的内容

- 不进入 Phase 7.18。
- 不处理 DH1-DH4。
- 不修改 provider 路由或权限语义。
- 不新增第二套 scheduler / terminal renderer / agent system。
- 不恢复 mouse capture / 蓝色复制 / auto copy。
- 不触碰 `WHITEPAPER.md`、`WHITEPAPER.en.md`、`docs/stress/`、`img/`、`test-model-set.sh`、`docs/delivery/phase-6.7-full-source-maturity-audit.md`。
- 不声明 Beta PASS / smoke-ready / open-source-ready。

## 下一阶段衔接

阶段完成后必须停止等待用户确认。建议下一步如果继续，只做真实 TUI 体感 smoke：长 transcript 回看、streaming sibling dedupe、AgentControl 停止后的 footer/status 清理、model-facing workflow/agent 默认主屏是否仍有 panel 噪音。

这些观察不等于自动进入 Phase 7.18。

## 开发者排查入口

- Transcript viewport：`packages/tui/src/shell/components/ScrollViewport.tsx`
- Task render order：`packages/tui/src/shell/components/ShellApp.tsx`
- Transcript scroll state tests：`packages/tui/src/shell/models/tui-interaction-contract.test.ts`
- Shell view model tests：`packages/tui/src/shell/view-model.test.ts`
- Model-facing control tools：`packages/tui/src/model-tool-runtime.ts`
- Deferred tool sanitizer：`packages/tui/src/model-loop-runtime.ts` / `packages/tui/src/deferred-tools-catalog.ts`
- Agent slash runtime：`packages/tui/src/job-agent-command-runtime.ts`
- Workflow runtime：`packages/tui/src/workflow-command-runtime.ts`
- Focused regression：`packages/tui/src/index.test.ts`

## 参考核对

- Linghun 文档：见 Source-Level Reality Check。
- Linghun 源码：见 Source-Level Reality Check。
- CCB 参考：见 Source-Level Reality Check。
- 行为参考进入 Linghun 自研实现：sticky bottom / scrollback surface 的行为边界、streaming sibling + final dedupe、tool/control 主屏降噪。
- 仅作为参考未复制：CCB `ScrollBox` imperative API、`VirtualMessageList` row virtualization、tool grouping/collapse 源码、MCP UI 源码。
- 未复制可疑源码实现、反编译痕迹、内部 API、专有 telemetry 或内部服务逻辑。

## 成品级 handoff packet

- 下一阶段：等待用户确认；不得自动进入 Phase 7.18。
- 禁止事项：不得 stage/commit；不得触碰 forbidden dirty paths；不得用完整 CCB parity 话术包装本阶段；不得新增第二套 renderer/scheduler/transcript runtime。
- 证据引用：
  - `packages/tui/src/shell/components/ShellApp.tsx`
  - `packages/tui/src/shell/components/ScrollViewport.tsx`
  - `packages/tui/src/model-tool-runtime.ts`
  - `packages/tui/src/shell/view-model.test.ts`
  - `packages/tui/src/index.test.ts`
  - `docs/delivery/phase-07-17-1-main-transcript-surface-ccb-scrollback-closure.md`
- 验证结果：typecheck、focused vitest、wide filtered `index.test.ts` regression、scoped Biome、TUI build、CLI build、CLI `--version`/`--help`、`git diff --check` 均 PASS。
- 索引状态：未触发 codebase-memory rebuild / force refresh；本轮通过 `rg` 与源码精读确认。
- 权限模式：本地 Codex desktop，filesystem unrestricted；未 stage、未 commit。
- 模型/provider：Codex GPT-5；验证使用本地 vitest/typecheck/build，不消耗真实 provider token。
- 预算使用：未新增模型调用或 provider token；scrollback 改动只影响 TUI visible layer。
