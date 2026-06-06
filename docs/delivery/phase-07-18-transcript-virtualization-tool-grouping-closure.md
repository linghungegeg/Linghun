# Phase 7.18 Transcript Virtualization / Tool Grouping Closure

## 阶段目标

补齐 Phase 7.17.1 之后最后一层终端 transcript 成熟度差距：普通 task transcript 不再先整棵渲染所有历史 `ProductBlock` 后再裁剪，而是只投影可视范围附近的 transcript blocks；相邻 read/search/control tool 输出默认合并为低噪摘要，raw diagnostic 保留在 details / transcript / evidence 路径。

本阶段只做 Phase 7.18，不 stage、不 commit，不进入 DH1-DH4，不改 provider 路由，不改权限语义，不新增第二套 terminal renderer，不触碰 forbidden dirty paths。

## Source-Level Reality Check

开工前实际读取的 Linghun 文档：

- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-07-17-visible-streaming-runtime-closure.md`
- `F:\Linghun\docs\delivery\phase-07-17-1-main-transcript-surface-ccb-scrollback-closure.md`

开工前实际核对的 CCB 行为参考：

- `F:\ccb-source\src\components\Messages.tsx`
- `F:\ccb-source\src\components\VirtualMessageList.tsx`
- `F:\ccb-source\src\hooks\useVirtualScroll.ts`
- `F:\ccb-source\packages\@ant\ink\src\components\ScrollBox.tsx`
- `F:\ccb-source\src\screens\REPL.tsx`
- `F:\ccb-source\src\components\MessageRow.tsx`
- `F:\ccb-source\src\components\messages\AssistantToolUseMessage.tsx`
- `F:\ccb-source\src\utils\groupToolUses.ts`
- `F:\ccb-source\src\utils\collapseReadSearch.ts`
- `F:\ccb-source\src\utils\collapseHookSummaries.ts`
- `F:\ccb-source\src\utils\collapseTeammateShutdowns.ts`

CCB 只作为行为参考：虚拟列表、height cache、top/bottom spacer、sticky bottom、streaming sibling、tool/read/search/hook/teammate 输出折叠和 raw details 保留。Linghun 未复制 CCB 源码、内部 API、专有 telemetry、反编译痕迹或可疑实现。

Existing implementation:

- Linghun 已有 `TranscriptViewport` / `transcriptScrollState` / `reduceTranscriptScroll()`，支持 PgUp/PgDn/Home/End/wheel、stick-to-bottom、viewport/content measure 和 scroll clamp。
- Phase 7.17 已把 `streamingAssistantText` 做成历史 blocks 后的独立 sibling，并与正式 assistant block dedupe。
- Phase 7.17.1 已把普通 task transcript 接入 `TranscriptViewport`，但仍会把全部 `view.blocks.map(ProductBlock)` mount 后交给 Ink clip。
- `SearchExtraTools` / `ExecuteExtraTool` / `AgentControl` / `StartAgent` / `RunWorkflow` / `RunVerification` 已有 model-facing 降噪和 raw `tool_result` 保留，但 transcript projection 层没有把相邻 tool 输出合并成低噪分组。

Gaps:

- 长会话仍存在 React/ProductBlock mount 成本：历史 blocks 全量进入 ShellApp，再由 Ink `overflow="hidden"` 裁剪。
- transcript content height 只来自已 mount 内容，没有完整 block-height cache / estimated total height / top spacer / bottom spacer 组合。
- tool 输出的低噪边界分散在 runtime presenter，普通主屏缺少统一相邻分组：多次 Read/Grep/Glob/SearchExtraTools/AgentControl/workflow/verification 会堆成多条摘要。
- 7.17.1 文档明确不是完整 `VirtualMessageList` parity，本阶段需要关闭 Linghun 自研版可验证差距。

Minimal touch points:

- `packages/tui/src/shell/view-model.ts`：在 view-model projection 层完成 tool grouping、height estimate/cache、virtual window selection。
- `packages/tui/src/shell/components/ShellApp.tsx`：只 mount `view.blocks` 的 virtual window，并测量可见 block 高度回写 controller。
- `packages/tui/src/shell/components/ScrollViewport.tsx`：复用现有 viewport，增加 `virtualRange` 的 estimated content height 与 top spacer。
- `packages/tui/src/shell/types.ts` / `packages/tui/src/tui-context-runtime.ts` / `packages/tui/src/index.ts`：补充 virtual range 和 measured block height cache 事件。
- `packages/tui/src/shell/view-model.test.ts` / `packages/tui/src/index.test.ts`：补 focused regressions，复用已有 AgentControl / background / footer 清理测试。
- `docs/delivery/README.md` 与本文档：阶段闭环记录。

Forbidden duplicate systems / NOT-DO:

- 不新增第二套 terminal renderer、ScrollBox、VirtualMessageList、transcript persistence、agent runtime、workflow runtime 或 scheduler。
- 不复制 CCB `ScrollBox`、`useVirtualScroll`、`VirtualMessageList`、group/collapse 工具源码。
- 不改 provider 路由、权限语义、模型 schema、DH1-DH4、remote channels 或 desktop 方向。
- 不触碰 `WHITEPAPER.md`、`WHITEPAPER.en.md`、`docs/stress/`、`img/`、`test-model-set.sh`、`docs/delivery/phase-6.7-full-source-maturity-audit.md`。

## 已完成功能

- `createShellViewModel()` 在 task/pending 模式启用 Linghun 自研 block-level transcript virtualization。
- `ShellViewModel.blocks` 现在只包含可视范围附近的 transcript blocks；1000+ blocks 测试确认不会全量投影给 `ShellApp`。
- 新增 `TranscriptVirtualRangeView`，包含 `startIndex`、`endIndex`、`topSpacer`、`bottomSpacer`、`estimatedContentHeight`、`renderedBlockCount`、`totalBlockCount`。
- `TranscriptViewport` 使用 `virtualRange.estimatedContentHeight` 参与 scroll clamp 和 geometry，使用 `marginTop + virtualRange.topSpacer` 把 window 放回完整 transcript 坐标。
- `ShellApp` 只 mount virtual window 内的 `MeasuredTranscriptBlock`，并把可见 block 的 Yoga measured height 回写 `transcriptBlockHeightCache`。
- Height cache visible-only 存在 `TuiContext.transcriptBlockHeightCache`，按 block id / width / textHash 复用；内容或宽度变化时回退估算再由测量修正。
- streaming assistant preview 继续作为历史列表后的独立 sibling；dedupe 使用完整 fitted history，而不是 virtual window，避免 final assistant block 不在窗口内时重复显示。
- 200+ 行 assistant 正文仍保留在 transcript body，不用 Ctrl+O/details 替代主正文。
- 相邻 Read/Grep/Glob/SearchExtraTools/ExecuteExtraTool/AgentControl/StartAgent/RunWorkflow/RunVerification 类输出在 view-model projection 层合并为一条 `tool-group-*` 摘要。
- 分组块主屏只显示 summary 和 Ctrl+O/details hint；raw diagnostic 进入 `fullText`，普通主屏 primary text 不泄漏 raw tool names/list/internal data。
- 失败或 blocked tool 不参与分组；assistant 正文会打断分组，避免跨用户可读段落吞内容。
- 复用既有 `/details`、Ctrl+O、transcript `tool_result` 和 evidence 路径保留 raw diagnostic。
- AgentControl `cancel_all` / `stop_all` 停止后继续复用既有 background/footer/status 清理路径，不留下 running agent。

## 使用方式

用户无需新增配置或命令：

- 普通 task TUI 自动使用 virtualized transcript window。
- 滚动仍使用既有交互：wheel、PgUp、PgDn、Home、End；底部吸附和用户主动滚上去后的脱底语义保持不变。
- streaming assistant 文本仍显示在历史 blocks 后、activity 前；最终正式 assistant block 到达后自动去重。
- 工具输出默认低噪显示；需要查看 raw diagnostic 时使用 Ctrl+O、`/details`、transcript 或 evidence 入口。
- agent/workflow/job 仍不会因为 model-facing control tool 默认拉起高级面板；高级面板只由用户明确 slash/details/面板动作打开。

## 涉及模块

- `packages/tui/src/shell/types.ts`
- `packages/tui/src/shell/components/ScrollViewport.tsx`
- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/tui-context-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/shell/view-model.test.ts`
- `docs/delivery/README.md`
- `docs/delivery/phase-07-18-transcript-virtualization-tool-grouping-closure.md`

## 关键设计

- Virtualization 放在 view-model projection 层：先按完整 transcript 计算 block height 与 window，再只把窗口内 blocks 交给 ShellApp mount，避免新增 renderer。
- Scroll runtime 继续复用现有 `TranscriptViewport` 和 `transcript-scroll-state.ts`，本阶段只补 virtual range 的总高度和 spacer。
- Height cache 是 visible-only UI cache，不写 transcript、不进模型上下文、不影响 provider 或 session persistence。
- `topSpacer` 通过 viewport content margin 放回完整坐标，`bottomSpacer` 作为实际 Box 放在 rendered blocks 后，保证后续 streaming/activity/suggestions 仍处在 transcript 尾部。
- `tailHeight` 把 streaming sibling、activity、suggestions、limitations 计入 estimated content height，让 scroll clamp 不只看历史 blocks。
- `streamingAssistantText` dedupe 在 virtual slicing 前用完整 fitted blocks 判断，避免“final block 被虚拟窗口裁掉后 preview 重复出现”。
- Tool grouping 是保守分组：只合并相邻、成功/partial 的 read/search/extension/agent/workflow/verification 类输出；失败、blocked、assistant 文本、用户消息、权限卡都会打断分组。
- 分组块使用 `ctrlOCollapsed` + `fullText` 保留 raw details，主屏渲染只走 summary。

## 配置项

无新增配置项。

## 命令

无新增用户命令。

## 测试与验证

新增或更新 focused regressions 覆盖：

- `Phase 7.18: 1000+ transcript blocks only project the viewport window`
- `Phase 7.18: user scrolled-up window stays detached from bottom`
- `Phase 7.18: streaming sibling dedupe uses full history, not the virtual window`
- `Phase 7.18: adjacent read/search/deferred tool outputs collapse into one low-noise block`
- `Phase 7.18: tool grouping does not cross assistant text or hide failed tool diagnostics`
- `Phase 7.18 source: controller records measured block heights into the same cache`

复用既有 regressions 覆盖：

- 200+ 行 assistant 正文仍在 transcript body。
- PgUp/PgDn/Home/End/wheel 与 stick-to-bottom / detached scroll 语义。
- AgentControl list/cancel/cancel_all/stop_all 主屏降噪，raw `tool_result` 保留。
- `StartAgent` / `RunWorkflow` / `RunVerification` model-facing 默认不拉起高级面板。
- `/interrupt`、`/background`、AgentControl stop_all 后 background/footer/status 不残留 running agent。

已运行验证：

```powershell
corepack pnpm --filter @linghun/tui typecheck
```

结果：PASS。

```powershell
corepack pnpm exec vitest run packages/tui/src/shell/view-model.test.ts packages/tui/src/shell/models/tui-interaction-contract.test.ts --no-color
```

结果：PASS，368 passed。

```powershell
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "transcript|virtual|scroll|streaming|tool grouping|Read|Grep|Glob|SearchExtraTools|ExecuteExtraTool|AgentControl|StartAgent|workflow|job|background|footer|status" --no-color
```

结果：PASS，182 passed / 476 skipped。

```powershell
corepack pnpm exec biome check packages/tui/src/shell/components/ShellApp.tsx packages/tui/src/shell/components/ScrollViewport.tsx packages/tui/src/shell/types.ts packages/tui/src/shell/view-model.ts packages/tui/src/tui-context-runtime.ts packages/tui/src/index.ts packages/tui/src/shell/view-model.test.ts docs/delivery/README.md docs/delivery/phase-07-18-transcript-virtualization-tool-grouping-closure.md
```

结果：PASS。Biome 当前配置实际检查 7 个匹配源码文件，Markdown 路径随命令传入但未被规则处理。

```powershell
corepack pnpm --filter @linghun/tui build
```

结果：PASS。

```powershell
corepack pnpm --filter @linghun/cli build
```

结果：PASS。

```powershell
node F:\Linghun\apps\cli\dist\main.js --version
```

结果：PASS，输出 `0.1.0`。

```powershell
node F:\Linghun\apps\cli\dist\main.js --help
```

结果：PASS，输出包含 `Linghun 0.1.0`、`linghun --version`、`Linghun --version` Windows 兼容说明。

```powershell
git diff --check
```

结果：PASS。

## 性能结果

- 1200 个 transcript blocks 的 view-model projection 只返回可视窗口附近 blocks，`renderedBlockCount < 80`。
- ShellApp 不再对完整历史 `view.blocks.map(ProductBlock)`；只 mount virtual window 中的 `MeasuredTranscriptBlock`。
- 可见 block 高度在首次 mount 后写入 cache，后续同宽度/同内容复用 measured height。
- 不新增 provider 调用，不增加模型 token，不新增后台扫描，不改变 session 文件结构。

## 已知问题

- 当前是 Linghun 自研 block-level virtualization，不是 CCB row-level / renderer-level `VirtualMessageList` 完全等价。
- 标准 Ink 仍没有 CCB 自定义 `ScrollBox` 的 imperative scroll clamp、fast-scroll coverage span、pending delta subscription 等能力；Linghun 用 existing viewport + estimated height + measured visible cache 保守闭环。
- 首次进入未测量过的长 Markdown 或宽度变化场景时，height estimate 可能与真实 Yoga height 有轻微误差；可见块测量回写后会修正。
- Tool grouping 目前按 Linghun 主屏摘要文本分类，覆盖 Read/Grep/Glob/SearchExtraTools/ExecuteExtraTool/AgentControl/StartAgent/RunWorkflow/RunVerification 的常见主屏输出；未知第三方工具仍保持原样显示，不强行吞并。
- 本阶段未执行真实 full smoke，不声明 Beta PASS / smoke-ready / open-source-ready。

## 不在本阶段处理的内容

- 不实现 CCB 自定义 `ScrollBox` 或复制 `VirtualMessageList` / `useVirtualScroll`。
- 不新增第二套 terminal renderer。
- 不修改 provider 路由、权限语义、模型 schema、tool permission pipeline。
- 不进入 DH1-DH4、Phase 17B、Phase 18 或真实 full smoke。
- 不触碰 forbidden dirty paths。
- 不 stage、不 commit。

## 下一阶段衔接

阶段完成后停止在用户审核点。下一步如果继续，应先由用户明确指定目标；建议只做真实 TUI 体感 smoke / terminal product audit，观察：

- 超长 transcript PageUp/PageDown 是否无明显空白和跳底。
- 首次滚到复杂 Markdown 旧块时 height estimate 是否有可接受的轻微修正。
- tool grouping 是否足够低噪，同时 Ctrl+O/details/evidence 是否能追到 raw diagnostic。
- AgentControl stop_all / background panel / footer status 在真实场景中是否继续保持一致。

这些观察不等于自动进入下一阶段，不等于 Beta PASS。

## 开发者排查入口

- Virtual window / grouping：`packages/tui/src/shell/view-model.ts`
- View model types：`packages/tui/src/shell/types.ts`
- Viewport measure / clamp：`packages/tui/src/shell/components/ScrollViewport.tsx`
- Task render order / block measurement：`packages/tui/src/shell/components/ShellApp.tsx`
- Controller event handling：`packages/tui/src/index.ts`
- TUI context cache：`packages/tui/src/tui-context-runtime.ts`
- Scroll reducer：`packages/tui/src/shell/models/transcript-scroll-state.ts`
- Focused tests：`packages/tui/src/shell/view-model.test.ts`
- Model-facing control tool regressions：`packages/tui/src/index.test.ts`

## 参考核对

- 本阶段实际读取 Linghun 文档：见 Source-Level Reality Check。
- 本阶段实际读取 CCB 参考：见 Source-Level Reality Check。
- 行为参考进入 Linghun 自研实现：virtual range、height estimate/cache、top/bottom spacer、stick-to-bottom、streaming sibling + final dedupe、read/search/tool 输出低噪分组、raw details 保留。
- 仅作为参考未复制：CCB `ScrollBox` imperative API、`useVirtualScroll` fast-scroll/renderer clamp、`VirtualMessageList` 组件结构、`groupToolUses` / `collapseReadSearch` / hook / teammate collapse 源码。
- 未复制可疑源码实现、反编译痕迹、内部 API、专有 telemetry 或内部服务逻辑。

## 成品级 handoff packet

- 下一阶段：等待用户确认；不得自动进入下一阶段、真实 full smoke、Phase 17B 或 Phase 18。
- 禁止事项：不得 stage/commit；不得触碰 forbidden dirty paths；不得宣称 Beta PASS / smoke-ready / open-source-ready；不得新增第二套 renderer/scheduler/provider route/permission semantics。
- 证据引用：
  - `packages/tui/src/shell/view-model.ts`
  - `packages/tui/src/shell/components/ShellApp.tsx`
  - `packages/tui/src/shell/components/ScrollViewport.tsx`
  - `packages/tui/src/shell/types.ts`
  - `packages/tui/src/tui-context-runtime.ts`
  - `packages/tui/src/index.ts`
  - `packages/tui/src/shell/view-model.test.ts`
  - `packages/tui/src/index.test.ts`
- 验证结果：typecheck、view-model + interaction contract tests、filtered index tests、scoped Biome、TUI build、CLI build、CLI version/help、`git diff --check` 均 PASS；未执行真实 full smoke。
- 索引状态：本轮未暴露 codebase-memory MCP tool；已用 `tool_search` 查询无可用 codebase-memory 工具，未执行慢 rebuild、force refresh 或联网安装。
- 权限模式：本地 Codex desktop，filesystem unrestricted；未 stage、未 commit。
- 模型/provider：Codex GPT-5；验证为本地 typecheck/test/build，未执行真实 provider full-chain stress。
- 预算使用：本阶段实现不增加 provider token；height cache 为 visible-only UI state，不进入 prompt / transcript / evidence。
