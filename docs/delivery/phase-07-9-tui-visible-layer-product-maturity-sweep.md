# Phase 7.9 TUI Visible Layer Product Maturity Sweep

## 阶段目标

本阶段收口 TUI 可见层产品成熟度，重点处理主 transcript 拖选复制、streaming 可见抖动、runtime status 主屏污染、footer 可读性和 policy 轻提示噪音。

用户本阶段明确追加硬约束：拖选复制必须 Linghun 自研做到真实拖动选择，拖到视口边缘时自动滚动并纳入滚出视口内容；`/copy`、`/details copy` 或 transcript export 不能作为完成替代。本阶段按该要求实现真实 TTY mouse selection substrate，没有新增 copy 面板。

本阶段只做 Phase 7.9，不进入下一阶段，不 stage/commit，不触碰既有无关 dirty 文件。

## Source-Level Reality Check

### existing implementation

- `packages/tui/src/shell/ink-renderer.tsx` 已在支持终端进入 alternate screen，但没有 mouse tracking。
- `ink@7.0.3` 的 `useInput` 只提供键盘字段；SGR mouse 序列会作为未知 input 字符串透传，不提供结构化 mouse/down/drag/up。
- `packages/tui/src/shell/components/ScrollViewport.tsx` 已用 Yoga 测量 viewport/content，并用 `computeScrollViewportOffset()` 做有界 `marginTop` 裁剪。
- `packages/tui/src/shell/models/transcript-scroll-state.ts` 已有 `scrollOffset`、`stickToBottom`、PgUp/PgDn/Home/End/wheel 语义，但 wheel 默认 1 行，无拖选/自动滚动。
- `packages/tui/src/tui-output-surface.ts` 的 `ShellBlockOutput.appendAssistantDelta()` 每个 delta 都更新 `fullText` / `lastFullOutput` 并触发 rerender。
- `packages/tui/src/model-stream-runtime.ts` 的 policy hint 已进 `context.notifications`，此前低风险 `source-first`、`windows-safe` 等也会进入主屏轻提示。
- `packages/tui/src/shell/components/StatusFooter.tsx` 右栏默认 muted，cycle hint / detail line dim；窄屏已有列向布局。

### gaps

- 无 app-owned selection/copy；Phase 6.6 依赖终端原生选区，无法跨 hidden viewport 内容复制。
- 无 TTY mouse tracking 生命周期；标准 Ink 不提供 selection API。
- runtime status 新格式 `[Linghun] 模型 ... · 后台 ...` / `Status: Model ... · background ...` 未被 Ink 输出过滤完全覆盖。
- streaming delta 逐片 rerender，长输出可见层有抖动风险。
- policy 低风险提示过多，主屏容易刷出“策略：源码优先 / Windows 环境”等非决策提示。
- footer 主要状态字段偏弱，Windows Terminal / 窄屏扫读时可读性不足。

### minimal touch points

- Mouse/selection: `ink-renderer.tsx`、`ShellApp.tsx`、`Composer.tsx`、`ScrollViewport.tsx`、`types.ts`、`tui-context-runtime.ts`、`index.ts`、`transcript-selection-state.ts`、`clipboard.ts`。
- Rendering selection: `view-model.ts`、`MessageMarkdown.tsx`、`ProductBlock.tsx`。
- Streaming/status/policy/footer: `tui-output-surface.ts`、`model-stream-runtime.ts`、`StatusFooter.tsx`。
- Tests: `tui-interaction-contract.test.ts`、`view-model.test.ts`、`index.test.ts`。

### forbidden duplicate systems

- 不新增第二套 transcript 面板。
- 不新增 `/copy` 或 details copy 作为完成替代。
- 不新增第二套 Markdown renderer。
- 不新增第二套 Notification queue、PolicyPanel、KernelPanel 或 output presenter。
- 不复制 CCB / CCB Dev Boost 源码实现。

## 已完成功能

- 自研 TTY SGR mouse substrate：
  - Ink alternate screen 下启用 `?1002` button-event tracking 和 `?1006` SGR 坐标。
  - unmount / 启动异常路径恢复 mouse tracking。
  - `ShellApp` 解析 SGR mouse down/drag/up/wheel 并派发 `transcript-mouse`。
  - `Composer` 明确忽略 SGR mouse input，避免鼠标序列污染输入框。
- 自研 transcript selection state：
  - 根据 measured viewport geometry、topOffset、mouse 坐标映射 transcript row/column。
  - down/drag/up 维护 anchor/focus/selectedText。
  - drag 到 viewport 上/下边缘时启动 80ms bounded autoscroll。
  - autoscroll 期间重算 selection focus，滚出视口的 transcript 行进入 `selectedText`。
  - mouseup 后通过系统剪贴板命令 best-effort 复制选区。
- 剪贴板闭环：
  - Windows 使用 `clip`。
  - macOS 使用 `pbcopy`。
  - Linux 依次尝试 `wl-copy`、`xclip`、`xsel`。
  - 成功/失败只进 `NotificationStack`，不写 transcript，不覆盖 `lastFullOutput`。
- 选区可见反馈：
  - view-model 将 selection row 映射到 block 的 `selectionLineIndexes`。
  - `MessageMarkdown` 对选中行加蓝底白字反馈。
  - 保留现有 Markdown 轻量解析，不新增 renderer。
- Streaming 可见层：
  - `appendAssistantDelta()` 仍逐 delta 更新 `fullText` 和 `lastFullOutput`。
  - 可见 rerender 以 16ms 合批。
  - `endAssistantStream()`、`discardAssistantBlock()`、`replaceAssistantBlockContent()` 先 flush，避免 final gate / details 读旧画面。
- Runtime status 降噪：
  - Ink `ShellBlockOutput` 过滤当前中文 `[Linghun] 模型 ... · 后台 ...` 和英文 `Status: Model ... · background ...` 状态行。
  - plain `/status` 行为不在本阶段改动。
- Policy 轻提示降噪：
  - 主屏只显示决策影响较强的 policy hints：permission risk、blocked runtime、provider cooldown、compact-before-provider、verification-required、provider fallback、background occupancy。
  - 低风险 `source-first`、`windows-safe`、`architecture-guard`、`failure-learning` 不再抢主屏 notification。
  - 所有 policy hint id 仍写入 `system_event` 的 `hints=...`，底层事实不丢。
- Footer 可读性：
  - 主要 permission/model/cache/index 字段不再默认 dim/muted。
  - 占位、辅助 hint、workspace/runtime detail 继续 dim。

## 使用方式

- 在支持 mouse tracking 的 Ink TUI/alternate screen 终端内，用鼠标左键拖选主 transcript 文本。
- 拖到输出视口顶部或底部外侧时，Linghun 自动滚动 transcript 并扩展选区。
- 松开鼠标后自动复制选区；成功或失败会在底部 NotificationStack 显示短提示。
- 滚轮仍滚动 transcript；PgUp/PgDn/Home/End/方向键空输入滚动语义保持不变。

## 涉及模块

- `packages/tui/src/shell/models/transcript-selection-state.ts`
- `packages/tui/src/shell/clipboard.ts`
- `packages/tui/src/shell/ink-renderer.tsx`
- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/components/Composer.tsx`
- `packages/tui/src/shell/components/ScrollViewport.tsx`
- `packages/tui/src/shell/components/MessageMarkdown.tsx`
- `packages/tui/src/shell/components/ProductBlock.tsx`
- `packages/tui/src/shell/components/StatusFooter.tsx`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/shell/types.ts`
- `packages/tui/src/tui-context-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/tui-output-surface.ts`
- `packages/tui/src/model-stream-runtime.ts`

## 关键设计

- Mouse tracking 生命周期放在 Ink renderer；业务解析放在 ShellApp/controller；selection 计算放在纯函数模型。
- 复制投影基于当前 view-model 的可见 transcript blocks，避免复制已经被 view-model cap/filter 的旧行。
- Selection 是 app-owned，不依赖终端原生 scrollback，因此可以跨 `overflow="hidden"` 裁剪区域复制。
- Clipboard 是系统能力 best-effort；无可用命令时仍保留已捕获 selectedText 和失败提示，但不把 `/copy` 当完成替代。
- Streaming 合批只影响 rerender cadence，不影响内存事实、final gate、artifact compaction 和 `/details` 真源。
- Policy 降噪不丢事实：低风险信号回到底层 `system_event`，只有会影响用户当下决策的提示上主屏。

## 配置项

无新增配置项。

## 命令

无新增 slash 命令。`/copy` 未作为本阶段验收路径引入。

## 测试与验证

已运行：

- `corepack pnpm --filter @linghun/tui typecheck` -> PASS
- `corepack pnpm exec biome check <17 touched TS/TSX/test files>` -> PASS
- `corepack pnpm exec vitest run packages/tui/src/shell/models/tui-interaction-contract.test.ts --no-color` -> PASS, 32/32
- `corepack pnpm exec vitest run packages/tui/src/shell/view-model.test.ts --no-color` -> PASS, 321/321
- `corepack pnpm exec vitest run packages/tui/src/tool-output-presenter.test.ts --no-color` -> PASS, 33/33
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Policy|appendAssistantDelta|streaming|runtime status|StatusFooter|NotificationStack|transcript|scroll|copy|details|Ctrl\\+O" --testTimeout 30000 --no-color` -> PASS, 58 selected / 581 skipped

验证说明：

- 同一 index 筛选第一次用默认 10s timeout 时，既有 `/index refresh auto-skips large files...` 选中用例超时；使用 `--testTimeout 30000` 重跑通过，未发现本阶段失败断言。
- 未运行真实交互人工 smoke；本阶段用 SGR parser、renderer escape、selection reducer、view-model selection 标记和 controller 相关回归测试覆盖主要行为。

## 性能结果

- Streaming rerender 从逐 delta 变为 16ms 合批，`fullText`/`lastFullOutput` 仍同步更新。
- Selection row projection 只在 view-model 建模和 mouse event 时基于当前 blocks 计算；不引入 provider 请求、索引刷新或后台任务。
- Autoscroll interval 只在 active drag 且边缘 delta 非零时存在，mouseup/退出路径清理。

## 已知问题

- 剪贴板依赖本机系统命令；Linux 未安装 `wl-copy/xclip/xsel` 时会提示剪贴板不可用。
- 选区高亮是行级反馈，不做字符级富文本高亮；复制文本仍按 row/column 裁剪。
- 真实终端 mouse 支持受终端、tmux 和远程 shell 配置影响；本阶段未自动修改 tmux 配置。
- 未实现 OSC52 fallback，避免本阶段扩散到远程/终端兼容策略。

## 不在本阶段处理的内容

- 不处理 DH1-DH4。
- 不进入真实 full smoke / Beta / Phase 17 / Phase 18。
- 不修改 `WHITEPAPER.md` / `WHITEPAPER.en.md`。
- 不处理既有未跟踪项：`docs/delivery/phase-6.7-full-source-maturity-audit.md`、`docs/stress/`、`img/`、`test-model-set.sh`。
- 不修改 provider/model/env、依赖、构建脚本或发布流程。
- 不新增 `/copy`、`/transcript copy` 或 copy 面板。

## 下一阶段衔接

阶段完成后停止在用户审核点。下一阶段是否继续由用户确认；不得自动进入 DH1-DH4、Phase 17、真实 smoke、桌面端或发布相关任务。

## 开发者排查入口

- Mouse tracking lifecycle: `renderInkShell()`
- SGR parser / selection reducer: `parseSgrMouseEvent()`、`reduceTranscriptSelection()`
- Viewport geometry: `TranscriptViewport()`
- Controller glue: `runInkShell().controller.onInput`
- Clipboard helper: `writeTextToClipboard()`
- Selection rendering: `applyTranscriptSelection()`、`MessageMarkdown()`
- Streaming coalesce: `ShellBlockOutput.scheduleAssistantRender()` / `flushAssistantRender()`
- Policy hint filtering: `enqueuePolicyHints()` / `appendPolicyDecisionEvent()`

## 参考核对

- 实际读取 Linghun 文档：`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`、`docs/delivery/README.md`、`docs/delivery/phase-06-6-tui-transcript-interaction.md`、`docs/delivery/phase-06-5-streaming-memory-guard.md`、`docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md`、`docs/delivery/phase-07-2-product-surface-maturity-closure.md`、`docs/delivery/phase-07-8-policy-kernel-active-signal-consumption.md`。
- 实际读取 Linghun 源码：`ink-renderer.tsx`、`ShellApp.tsx`、`Composer.tsx`、`ScrollViewport.tsx`、`transcript-scroll-state.ts`、`types.ts`、`view-model.ts`、`MessageMarkdown.tsx`、`ProductBlock.tsx`、`StatusFooter.tsx`、`tui-output-surface.ts`、`model-stream-runtime.ts`、`details-status-runtime.ts`、`tool-output-presenter.ts`、相关测试。
- 实际参考 CCB 本地文件：`F:\ccb-source\src\screens\REPL.tsx`、`F:\ccb-source\src\components\FullscreenLayout.tsx`、`F:\ccb-source\src\components\VirtualMessageList.tsx`、`F:\ccb-source\src\components\ScrollKeybindingHandler.tsx`、`F:\ccb-source\src\hooks\useCopyOnSelect.ts`、`F:\ccb-source\src\components\PromptInput\PromptInputFooter.tsx`、`F:\ccb-source\src\components\BuiltinStatusLine.tsx`。
- CCB 仅作为行为边界参考：alt-screen selection、drag-to-scroll、copy-on-select、scroll key semantics、footer 降级；未复制 CCB 源码、内部 API、私有遥测或专有实现。
- codebase-memory MCP 工具本会话未暴露；按项目规则降级为 `rg`、源码精读和只读子智能体核对，未触发索引 rebuild/refresh。

## 成品级结构化 handoff packet

- phase: `Phase 7.9 TUI Visible Layer Product Maturity Sweep`
- verdict: `PASS`
- canProceed: `true, but stop for user review before any next phase`
- scopeDone: app-owned mouse drag selection; edge autoscroll; selected hidden rows copied; clipboard best-effort; selection highlight; streaming rerender coalesce; runtime status dump filter; footer contrast; policy notification noise reduction
- scopeExcluded: `/copy` completion fallback, new copy panel, second transcript system, DH1-DH4, real full smoke, Phase 17/18, provider/env/dependency/build changes
- changedFiles:
  - code: `packages/tui/src/shell/models/transcript-selection-state.ts`, `packages/tui/src/shell/clipboard.ts`, `packages/tui/src/shell/types.ts`, `packages/tui/src/tui-context-runtime.ts`, `packages/tui/src/shell/view-model.ts`, `packages/tui/src/shell/components/MessageMarkdown.tsx`, `packages/tui/src/shell/components/ProductBlock.tsx`, `packages/tui/src/shell/components/ScrollViewport.tsx`, `packages/tui/src/shell/components/ShellApp.tsx`, `packages/tui/src/shell/components/Composer.tsx`, `packages/tui/src/shell/components/StatusFooter.tsx`, `packages/tui/src/shell/ink-renderer.tsx`, `packages/tui/src/index.ts`, `packages/tui/src/tui-output-surface.ts`, `packages/tui/src/model-stream-runtime.ts`
  - tests: `packages/tui/src/shell/models/tui-interaction-contract.test.ts`, `packages/tui/src/shell/view-model.test.ts`, `packages/tui/src/index.test.ts`
  - docs: `docs/delivery/phase-07-9-tui-visible-layer-product-maturity-sweep.md`, `docs/delivery/README.md`
  - preExistingDiff: `WHITEPAPER.md`, `WHITEPAPER.en.md`, `docs/delivery/phase-6.7-full-source-maturity-audit.md`, `docs/stress/`, `img/`, `test-model-set.sh` left untouched
- validation: typecheck PASS; biome touched-file PASS; interaction reducer PASS; view-model PASS; tool-output presenter PASS; selected index regression PASS with 30s timeout
- risks: no known P0/P1; residual P2 is terminal/tmux clipboard/mouse capability variance and lack of OSC52 fallback
- runtimeFacts: provider/model not changed; permission mode not changed; index rebuild/refresh not triggered by implementation; cache/usage only read from existing tests
- evidenceRefs: tests and source files listed above
- indexStatus: codebase-memory MCP unavailable in this session; no refresh/rebuild performed
- permissionMode: local code edits only; Linghun runtime permission pipeline untouched
- modelProvider: current Codex thread provider/model not written into Linghun runtime
- budgetUsed: no explicit local token/cost budget set
- nextAction: user reviews diff and decides whether to create a stable point or choose the next phase
