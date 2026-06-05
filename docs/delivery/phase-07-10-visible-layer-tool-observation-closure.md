# Phase 7.10 Visible Layer Tool Observation Closure

## 阶段目标

本阶段基于 Phase 7.9 的真实代码事实、两份真实 session 现象和 CCB 行为参考，收口普通主屏可见层、工具观察持久化、final answer 自相矛盾、policy 高风险误触发和高级面板残留问题。

本阶段只做 Phase 7.10，不进入下一阶段，不处理无关 dirty 文件，不新增第二套 transcript / tool observation / policy runtime。

## Source-Level Reality Check

### existing implementation

- Phase 7.9 已在 `ShellApp` / `ink-renderer` / `index.ts` 接入 app-owned SGR mouse selection、`TranscriptViewport`、蓝底行级 selection 和 mouseup autocopy。
- `ScrollViewport`、`transcript-scroll-state.ts`、`transcript-selection-state.ts` 仍是可测试的底层纯模型。
- `evidence-runtime.ts` 已有 `tool_result` 预算、evidence、`tool_call_end` 事件和 `/details` 底座，但 `tool_call_end.output` 仍会保存较完整的 ToolOutput 投影。
- `model-stream-runtime.ts` 已有 final answer gate、extended gate、structured claim stripping 和主屏 leakage sanitizer。
- `meta-scheduler-runtime.ts` 会把 `assistantText ?? userText` 送入 high-risk completion claim 检测，导致用户询问“是否已完成 / 不要说 PASS”时也可能触发高风险策略。
- `index.ts` 的 Ink submit path 可能在普通聊天时保留旧 `commandPanelState` / help/config/background/session 面板状态。

### gaps

- 普通 Windows Terminal 主屏应优先交还终端原生 scrollback/selection；Phase 7.9 默认 app-owned mouse capture 会破坏此体验。
- 真实 session 中 `Write report.md` 已成功，但最终 assistant 文本同时出现“未完成保存/无法写入”和“已保存”，需要 evidence-backed final coherence guard。
- `tool_result.content` 与 `tool_call_end.output` 存在重复大 payload 风险，增加 transcript/session 膨胀。
- 普通用户问题不应被当作 assistant high-risk completion claim。
- 普通聊天不应残留高级 CommandPanel。

### minimal touch points

- 主屏 mouse/scroll/selection 断开：`ink-renderer.tsx`、`ShellApp.tsx`、`index.ts`、`view-model.ts`。
- 工具观察去重：`evidence-runtime.ts`。
- final coherence：`model-stream-runtime.ts`。
- policy 降噪：`meta-scheduler-runtime.ts`。
- 普通 submit 面板清理：`index.ts`。
- 回归测试：`view-model.test.ts`、`index.test.ts`、`meta-scheduler-runtime.test.ts`。

### forbidden duplicate systems

- 不新增第二套 tool observation owner 模块；现有 evidence/tool_result/session store 底座足够，按最小投影收口。
- 不新增 copy 面板、第二套 transcript viewport、第二套 policy panel 或第二套 final answer runtime。
- 不删除仍被测试覆盖的底层 scroll/selection 纯模型，避免扩大到 transcript/detail/fullscreen 后续能力。
- 不复制 CCB 源码、内部 API、私有遥测或专有实现。

## 已完成功能

- 普通 Ink 主屏默认不再进入 alternate screen，也不再开启 SGR mouse tracking。
- 普通 `TaskLayout` 不再挂载 `TranscriptViewport`；主输出直接渲染 `ProductBlock`，交还终端原生 scrollback/selection。
- 普通主屏不再解析 SGR mouse、不再 mouseup autocopy、不再推送“已复制选区”通知。
- view-model 不再把 `transcriptSelectionState` 投影成普通主屏 block 的 `selectionLineIndexes`。
- `tool_call_end.output` 改为摘要/metadata 投影，只保留 text/summary/preview/truncated/fullOutputPath/evidenceId/changedFiles；`tool_result.content` 仍是模型续轮和 details 的 canonical content。
- final answer coherence guard 覆盖 `sendMessage` 和 `continueModelAfterToolResults`：7.10 原始收口覆盖 Write/file_written；7.10.1 已扩展为 Write/Edit/MultiEdit/Bash 成功证据通用处理，用 evidence-backed 结论替换最终 assistant transcript。plain TUI 会追加一段可信最终回复，Ink 会替换 assistant block。
- meta-scheduler high-risk completion claim 只扫描 assistantText，不再把用户提问当成 assistant 完成声明。
- 普通非 slash submit 在 Ink 和 shared `processTuiLine` 路径都会清理 stale command/help/config/btw/sessions panel。
- 同步更新过时注释和 focused tests。

## 7.10.1 Closure Hotfix

- agent/job 工具观察旁路已闭环：`job-agent-command-runtime.ts` 不再保留本地 `createToolEndEvent` 副本，成功工具事件统一复用 `evidence-runtime.ts#createToolEndEvent` 的摘要版 `tool_call_end`。
- agent/job `appendAgentToolResultEvent` 已委托 `appendToolResultEvent`，复用现有 `tool_result` budget / artifact / summary 边界；StartAgent child Read 大输出不会在 `tool_call_end` 和 `tool_result` 双份膨胀。
- final answer coherence guard 已从 Write 专项扩展为 Write/Edit/MultiEdit/Bash 成功证据通用处理，覆盖“没有工具/不能执行/无法修改/未运行/没有 Bash 能力”等 stale pre-tool failure 文本；main loop 和 continuation 入 transcript 前都写入修正后的最终 assistant event。
- streaming assistant 文本改为轻量独立 preview：流式中只显示完整换行文本，不反复重排正式 assistant block；正常完成后由修正后的正式 assistant block 接管并 dedupe；中断时只保留已经可见的完整行。
- 本 hotfix 不新增模型 token、不改 provider/model/env、不新增 slash 命令，不影响 final gate discard/replace、`/details` 和长输出 artifact 边界。

## 使用方式

- 普通主屏：在 Windows Terminal 等终端中直接使用终端原生拖选、复制和滚动历史。
- 工具结果：普通用户只看工具摘要和最终回复；需要完整内容时继续走现有 `/details` / transcript / evidence 路径。
- 继续聊天：普通输入会关闭旧高级面板，不需要先按 Esc。

## 涉及模块

- `packages/tui/src/shell/ink-renderer.tsx`
- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/evidence-runtime.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/tui-output-surface.ts`
- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/shell/view-model.test.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/meta-scheduler-runtime.test.ts`

## 关键设计

- 普通主屏回到 terminal-native first；app-owned scroll/selection 只保留底层 substrate，不作为默认主屏承载。
- `tool_result` 是工具结果内容真源；`tool_call_end` 是生命周期摘要事件，不再保存同一份大 payload。
- final coherence guard 只在“stale failure 声明 + 成功声明 + 对应 Write/Edit/MultiEdit/Bash evidence”同时满足时触发，避免干扰普通结论。
- streaming preview 只承载可见完整行；最终 assistant block 和 transcript event 仍由 final gate / sanitizer / coherence 后的最终文本接管。
- policy high-risk 判断从“用户或助手文本”收窄为“助手最终/草稿文本”，用户要求核对不会自己制造高风险。
- stale panel 清理放到 shared message path，plain 和 Ink 行为一致。

## 配置项

无新增配置项。

## 命令

无新增 slash 命令。启动入口兼容性已验证：

- `node F:\Linghun\apps\cli\dist\main.js --version`
- `node F:\Linghun\apps\cli\dist\main.js --help`
- `node F:\Linghun\apps\cli\dist\main.js`

文档示例仍默认使用 `linghun`；Windows 下 `Linghun --version` 兼容说明保留在 CLI help。

## 测试与验证

- `corepack pnpm --filter @linghun/tui typecheck` -> PASS
- `corepack pnpm exec biome check packages/tui/src/tui-output-surface.ts packages/tui/src/model-stream-runtime.ts packages/tui/src/job-agent-command-runtime.ts packages/tui/src/index.test.ts packages/tui/src/shell/view-model.test.ts` -> PASS
- `corepack pnpm exec biome check packages/tui/src/evidence-runtime.ts packages/tui/src/index.ts packages/tui/src/index.test.ts packages/tui/src/meta-scheduler-runtime.ts packages/tui/src/meta-scheduler-runtime.test.ts packages/tui/src/model-stream-runtime.ts packages/tui/src/shell/components/ShellApp.tsx packages/tui/src/shell/ink-renderer.tsx packages/tui/src/shell/view-model.ts packages/tui/src/shell/view-model.test.ts` -> PASS
- `corepack pnpm --filter @linghun/tui exec vitest run src/meta-scheduler-runtime.test.ts src/shell/view-model.test.ts` -> PASS, 346 tests
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "auto-review report Write|tool_call_end as summary|plain natural input clears|keeps Read tool_result paired"` -> PASS, 6 selected / 636 skipped
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "auto-review report Write final answer|auto-review Edit final answer|Bash final answer|continuation final answer|StartAgent child Read large output"` -> PASS, 5 selected / 641 skipped
- `corepack pnpm --filter @linghun/tui exec vitest run src/shell/view-model.test.ts -t "assistant streaming block"` -> PASS, 12 selected / 310 skipped
- `corepack pnpm --filter @linghun/tui exec vitest run src/shell/models/tui-interaction-contract.test.ts src/tool-result-budget.test.ts` -> PASS, 39 tests
- `corepack pnpm --filter @linghun/tui exec vitest run src/model-loop-runtime.test.ts -t "Write derives file_written"` -> PASS, 1 selected / 145 skipped
- `corepack pnpm --filter @linghun/tui build` -> PASS
- `corepack pnpm --filter @linghun/cli build` -> PASS
- `node F:\Linghun\apps\cli\dist\main.js --version` -> PASS, `0.1.0`
- `node F:\Linghun\apps\cli\dist\main.js --help` -> PASS
- `node F:\Linghun\apps\cli\dist\main.js` -> PASS, BAT-equivalent dist startup printed TUI/REPL home

说明：第一次尝试 `vitest --runInBand` 失败，因为 Vitest 3.2.4 不支持该选项；随后用包内 `src/...` 路径重跑通过。该失败不是代码失败。

## 性能结果

- 普通主屏不再维护默认 mouse selection/autocopy/autoscroll timer，减少 TTY input 捕获和重绘触发。
- transcript 持久化中 `tool_call_end.output` 不再重复保存完整 `data/details` 或大正文，降低 session 膨胀风险。
- agent/job transcript 的 `tool_result` 大 payload 走既有 budget/artifact，避免 child transcript 因 `tool_call_end` + `tool_result` 双份保存而膨胀。
- final coherence guard 只在最终文本入 transcript 前做正则和 evidence 列表扫描，无 provider/token 成本。
- streaming preview 在 ShellBlockOutput 内本地累积，不增加模型 token；只在完整行可见和最终接管时更新 block，降低流式半行抖动。

## 已知问题

- 底层 `TranscriptViewport`、scroll/selection reducer、`selectionLineIndexes` 渲染能力仍保留，供 transcript/detail/fullscreen 或既有 tests 使用；本阶段只断开普通主屏默认路径。
- plain TUI 的原始流式字节一旦写入 stdout 不能物理删除；guard 触发时会追加 evidence-backed 最终回复，并保证 transcript 最终 assistant event 是修正后的文本。
- 未新增 `/copy` / copyOnSelect 配置；按本轮最小修复裁决为不扩范围。
- 未运行真实 full smoke，不代表 Beta PASS、open-source-ready 或 Phase 17/18 ready。

## 不在本阶段处理的内容

- 不处理 DH1-DH4。
- 不进入真实 full smoke、Beta、Phase 17、Phase 18 或发布流程。
- 不修改 provider/model/env、依赖、构建脚本或发布脚本。
- 不触碰用户已有无关 dirty 文件：`WHITEPAPER.md`、`WHITEPAPER.en.md`、`docs/delivery/phase-6.7-full-source-maturity-audit.md`、`docs/stress/`、`img/`、`report.md`、`test-model-set.sh`。
- 不改 CCB 源码。

## 下一阶段衔接

阶段完成后停止在用户审核点。是否进入下一阶段必须由用户明确确认；普通“继续/确认/yes”不授权跨阶段推进。

## 开发者排查入口

- 默认 mouse/alt-screen lifecycle：`packages/tui/src/shell/ink-renderer.tsx`
- 普通 TaskLayout 主屏渲染：`packages/tui/src/shell/components/ShellApp.tsx`
- shared natural message path：`packages/tui/src/index.ts`
- tool lifecycle projection：`packages/tui/src/evidence-runtime.ts#createToolEndEvent`
- agent/job tool observation bridge：`packages/tui/src/job-agent-command-runtime.ts`
- tool result budget：`packages/tui/src/tool-result-budget.ts`
- final coherence guard：`packages/tui/src/model-stream-runtime.ts`
- streaming preview：`packages/tui/src/tui-output-surface.ts`
- policy decision：`packages/tui/src/meta-scheduler-runtime.ts`

## 状态栏与统计口径

本阶段没有新增状态栏字段、费用统计或 cache 估算。cache 低命中不被本阶段改写为错误；policy 高风险提示只在真实 assistant claim、tool failure、provider failure 或 blocked runtime 等事实存在时进入相应路径。

## 学习成本与渐进披露

本阶段没有新增首屏功能、help 命令或高级配置。用户可见变化是普通主屏更贴近终端原生行为，工具输出和最终回复更少混杂。

## TUI 渲染稳定性

- messages：普通主屏直接渲染 blocks，不再由 `TranscriptViewport` 裁剪。
- input：SGR mouse 序列不再由 `ShellApp` 默认解析；Composer 既有键盘路径保留。
- status/footer/hints：本阶段只修复 stale panel 清理和 policy high-risk 误触发，不扩大 footer 配色。
- resize/ANSI/中文宽度：通过 `view-model.test.ts` 和 existing interaction contract 回归覆盖。

## 主输出与日志分层

- 主屏显示短工具摘要和最终 assistant answer。
- `tool_result.content` 保留给模型续轮、details/evidence/session。
- `tool_call_end.output` 只保存摘要/metadata，不再保存完整内部大 payload。
- final coherence guard 触发时写入 `system_event: final_answer_coherence_guard`，用户主屏只看到 evidence-backed 结论。
- streaming preview 只负责临时可见完整行；正式 assistant block 与 transcript event 使用 gate/sanitizer/coherence 后的最终文本，避免重复显示。

## 阶段 Verdict

- verdict：`PASS`
- 是否允许进入下一阶段：`no, stop for user review`
- P0/P1/P2 风险分类：无新增已知 P0/P1；剩余 P2 为 plain stdout 已写出的旧流式字节无法删除、底层 transcript/detail selection substrate 仍保留。
- 阻塞项：无本阶段阻塞项。
- 用户下一步审核点或命令：审阅 diff 与本文档，决定是否创建稳定点或明确下一阶段。

## 真实改动文件

- 代码：
  - `packages/tui/src/evidence-runtime.ts`
  - `packages/tui/src/index.ts`
  - `packages/tui/src/job-agent-command-runtime.ts`
  - `packages/tui/src/meta-scheduler-runtime.ts`
  - `packages/tui/src/model-stream-runtime.ts`
  - `packages/tui/src/tui-output-surface.ts`
  - `packages/tui/src/shell/components/ShellApp.tsx`
  - `packages/tui/src/shell/ink-renderer.tsx`
  - `packages/tui/src/shell/view-model.ts`
- 测试：
  - `packages/tui/src/index.test.ts`
  - `packages/tui/src/meta-scheduler-runtime.test.ts`
  - `packages/tui/src/shell/view-model.test.ts`
- 文档：
  - `docs/delivery/phase-07-10-visible-layer-tool-observation-closure.md`
  - `docs/delivery/README.md`
- 生成物：构建命令更新了包内 `dist` 输出，但 dist 不作为本阶段交付文档的源码改动清单。
- 用户已有 diff / 非本轮证据：`WHITEPAPER.md`、`WHITEPAPER.en.md`、`docs/delivery/phase-6.7-full-source-maturity-audit.md`、`docs/stress/`、`img/`、`report.md`、`test-model-set.sh` 未触碰。

## 运行时事实

- provider/model：未修改 Linghun provider/model 配置；当前 CLI smoke 显示本地配置为 `gpt-5.5`。
- permission mode：未修改默认权限策略；CLI smoke 显示默认模式。
- index status：未触发 codebase-memory refresh/rebuild；CLI smoke 显示当前项目索引 `ready`。
- cache/usage 来源：未新增成本统计或 provider raw usage；验证仅使用本地测试和构建。
- 配置来源：未修改配置文件。
- 是否有脱敏/密钥风险：本阶段未输出 API key/token；tool payload 去重降低 session 大 payload 暴露面。

## 后台/复查任务状态反馈

本阶段没有新增后台任务、verification runner、agent、compact 或长任务。使用两个只读子智能体并行复核：

- `Wegener`：复核普通主屏 SGR mouse / TranscriptViewport / selectionLineIndexes / autoscroll 残留，确认默认 SGR mouse 已关闭，指出 ShellApp 注释过时并已修正。
- `Nash`：复核 Phase 7.10 文档命名和 README 插入位置，确认无命名冲突并给出文档章节清单。
- `Harvey`：7.10.1 只读复核 agent/job 工具观察旁路，确认本地 `createToolEndEvent` 副本已断开，`appendAgentToolResultEvent` 已委托公共 `appendToolResultEvent`。
- `Tesla`：7.10.1 只读复核 streaming preview 触点，确认旧实现逐 delta 改正式 block；本 hotfix 改为完整行 preview + final block 接管。

## 语言与 i18n 口径

新增用户可见中文 final coherence 文案直接位于 `model-stream-runtime.ts`，英文路径也同步提供。结构化事件字段保持英文。未新增独立 i18n 字典，因触发范围极窄且沿用当前文件内双语模式。

## 参考核对

- 实际读取 Linghun 文档：`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`、`docs/delivery/README.md`、`docs/delivery/TEMPLATE.md`、`docs/delivery/phase-07-9-tui-visible-layer-product-maturity-sweep.md`。
- 实际读取用户阶段范围：`C:\Users\Admin\.codex\attachments\26474a9d-7cb6-4ca1-bdd5-4b30a927423e\pasted-text.txt`。
- 实际读取 / 复核 Linghun 源码：`ShellApp.tsx`、`ScrollViewport.tsx`、`transcript-scroll-state.ts`、`transcript-selection-state.ts`、`MessageMarkdown.tsx`、`StatusFooter.tsx`、`footer-view.ts`、`model-stream-runtime.ts`、`model-tool-runtime.ts`、`meta-scheduler-runtime.ts`、`evidence-runtime.ts`、`tool-result-budget.ts`、`index.ts`、`core` session/store 相关线索。
- 实际读取真实 session：`C:\Users\Admin\.linghun\data\sessions\cafc7491a85550ba\d719bee8-8d6a-42d2-b348-46376b00c7fc\transcript.jsonl`；重点核对 Write 成功但最终回复矛盾的 case。另一份 session 路径作为用户输入范围保留，本轮未发现需要扩展读取后才能完成最小修复。
- 实际参考 CCB 本地文件：`F:\ccb-source\src\hooks\useCopyOnSelect.ts`、`F:\ccb-source\src\components\ScrollKeybindingHandler.tsx`、`F:\ccb-source\src\commands\copy\copy.tsx`、`F:\ccb-source\src\components\Messages.tsx`、`F:\ccb-source\src\components\VirtualMessageList.tsx`、`F:\ccb-source\src\hooks\useVirtualScroll.ts`、`F:\ccb-source\src\screens\REPL.tsx`、`F:\ccb-source\src\utils\sessionStorage.ts`、`F:\ccb-source\src\hooks\useLogMessages.ts`、`F:\ccb-source\src\QueryEngine.ts`。
- 参考性质：CCB 只作为行为边界参考，包括普通主屏低捕获、copy-on-select 可控、虚拟滚动/消息列表分层、工具事件与最终消息分离、session 存储低重复；进入 Linghun 的实现为自研最小补丁。
- 未复制 CCB 源码、内部 API、私有遥测或专有实现。

## 成品级结构化 handoff packet

- phase: `Phase 7.10 Visible Layer Tool Observation Closure`
- verdict: `PASS`
- nextPhase: `等待用户确认；不得自动进入下一阶段`
- completed:
  - 普通主屏断开默认 app-owned SGR mouse selection/autocopy/TranscriptViewport。
  - `tool_call_end.output` 改为摘要 metadata，`tool_result.content` 保持 canonical。
  - agent/job tool observation 复用公共摘要和 budget 边界。
  - final answer coherence guard 覆盖 Write/Edit/MultiEdit/Bash，并覆盖 main loop 和 continuation。
  - streaming preview 完整行可见、final block 接管、dedupe、中断保留可见行。
  - meta-scheduler 不再把用户完成核对问题当 high-risk assistant claim。
  - 普通 submit 清理 stale advanced panels。
- mustNotDo:
  - 不进入真实 full smoke / Phase 17 / Phase 18 / 发布流程。
  - 不复制 CCB 源码。
  - 不删除底层 transcript/detail scroll/selection substrate，除非用户另开阶段明确要求。
  - 不触碰无关 dirty 文件。
- evidence:
  - `corepack pnpm --filter @linghun/tui typecheck` PASS
  - touched-file `biome check` PASS
  - focused vitest suites PASS
  - `@linghun/tui build` PASS
  - `@linghun/cli build` PASS
  - dist CLI version/help/startup smoke PASS
- validationResults: 详见“测试与验证”。
- indexStatus: CLI smoke 显示 `ready`；codebase-memory MCP 本轮不可用，未 refresh/rebuild。
- permissionMode: 未修改；本地 CLI smoke 显示默认模式。
- modelProvider: 未修改 Linghun runtime provider；当前 CLI smoke 显示 `gpt-5.5`。
- budgetUsage: 无显式 token/cost budget；未新增 provider 请求。
- risk: `plain stdout old streamed bytes cannot be physically erased` 为残余 P2；真实 full smoke 未运行。
- userReviewPoint: 审阅本阶段 diff 和文档，决定是否创建稳定点或指定下一阶段。
