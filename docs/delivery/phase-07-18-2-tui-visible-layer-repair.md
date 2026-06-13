# Phase 7.18.2 TUI Visible Layer Repair

## 阶段目标

基于稳定点 `cfda105a` 修复 Linghun TUI 用户可见层的回归：普通聊天滚动/光标不再被 recent tail split 拆断；子智能体完成不再默认刷绿色 pass 主屏块；diff/code 宽度按可用终端渲染；Read/Edit/Grep/Todo/Bash 主屏展示走工具语义层；运行中状态持续显示 elapsed；主链 prompt 允许长任务关键节点短自然叙事。

本轮只处理用户点名的 TUI 可见层与 prompt 最小补丁，不改 WHITEPAPER、不改 provider/权限/调度/依赖/构建配置，不新增第二套 renderer、scheduler 或 transcript 系统。

## 已完成功能

- `ShellApp` 移除 `TASK_RECENT_TAIL_BLOCKS`、`staticHistoryBlocks`、`recentStaticBlocks`、`currentBlocks` 分裂逻辑；task 主屏回到单一 `view.blocks` 流，composer/footer 仍贴底。
- `agent-completion-finalizer` 不再把 completed 子智能体默认 push 成 `status: "pass"` 的主屏 ProductBlock；completion notice、batch digest、parent `system_event` 仍保留。
- `StructuredDiff` 去掉 60 列边框硬限制，按 `wrapWidth` 渲染；add/remove 行按 `contentWidth` padding，避免背景只包文字半截。
- `MessageMarkdown` 普通代码行按 `wrapWidth` padding，保持整行视觉一致。
- `createOutputBlock` 将 CCB 风格工具输出行和 summary 行识别为 `tool_result_success`，让 ProductBlock 走 `MessageResponse`，而不是散成普通 assistant 正文。
- `deriveBackgroundActivityFallback` 从 running agent/workflow/background task 的 `startedAt` 推导 elapsed，持续显示工作多久了。
- system prompt 只在长任务/多工具任务中要求 1-2 行自然过渡，并明确简单无工具闲聊保持简洁。

## 使用方式

用户无需新增命令或配置；普通 TUI task/pending 主屏自动生效。长输出仍通过 Ctrl+O、`/details`、transcript/evidence 路径查看完整内容。

## 涉及模块

- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/components/StructuredDiff.tsx`
- `packages/tui/src/shell/components/MessageMarkdown.tsx`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/agent-completion-finalizer.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/shell/view-model.test.ts`
- `packages/tui/src/agent-completion-finalizer.test.ts`
- `packages/tui/src/shell/models/tui-interaction-contract.test.ts`

## 关键设计

- 普通聊天不再混用 Static history 和 current tail；本轮也没有重新启用 TranscriptViewport 作为普通聊天默认路径。
- 子智能体完成是运行时事实和主链上下文，不是最终验收；主屏最终总结仍由主链自然输出。
- 工具输出层只做“做了什么 / 目标 / 状态 / 可展开详情”的语义摘要；raw diagnostic 保留到底层。
- diff/code 继续复用现有 ShellTheme 色彩，不引入新主题。
- prompt 只补边界规则，不用固定模板文案代替模型自然表达。

## 配置项

无新增配置项。

## 命令

无新增用户命令。

## 测试与验证

按用户要求顺序运行并通过：

```powershell
corepack pnpm vitest run packages/tui/src/shell/view-model.test.ts packages/tui/src/agent-completion-finalizer.test.ts packages/tui/src/shell/progress-views.test.ts packages/tui/src/shell/models/tui-interaction-contract.test.ts
corepack pnpm typecheck
corepack pnpm --filter @linghun/providers build
corepack pnpm --filter @linghun/tui build
corepack pnpm --filter @linghun/cli build
node F:\Linghun\apps\cli\dist\main.js --version
git diff --check
```

结果：

- Focused vitest PASS：4 files，412 tests。
- Typecheck PASS。
- Providers build PASS。
- TUI build PASS。
- CLI build PASS。
- CLI version PASS：`0.1.0`。
- `git diff --check` PASS。

## 性能结果

- 移除 recent-tail split 后，不再人为复制/拆分最近静态块与 running 块。
- diff/code padding 只在已渲染行内补齐到当前 wrap width，不新增解析器或后台任务。
- 本轮不新增 provider 调用，不增加模型 token。

## 已知问题

- 未执行真实终端 full smoke；本轮验证为 focused/local test、typecheck、build。
- root 级三份 Linghun 文档在当前仓库实际位于 `docs/delivery/`，本轮按真实路径读取，未顺手修文档路径口径。
- codebase-memory MCP 查询工具本轮未暴露；按规则降级为 `rg` 与精读源码确认。

## 不在本阶段处理的内容

- 不实现虚拟滚动，不重新接入 TranscriptViewport 为普通聊天默认路径。
- 不改 WHITEPAPER 或无关文档。
- 不改 provider、权限、agent/job/workflow runtime、依赖或构建脚本。
- 不声明 Beta PASS、smoke-ready 或 open-source-ready。

## 下一阶段衔接

下一步需用户确认。建议真实 TUI 体感只聚焦：长聊天原生 scroll/copy、composer 光标位置、工具活动摘要、diff/code 宽终端视觉、子智能体完成后的主链自然总结。

## 开发者排查入口

- 滚动/布局：`packages/tui/src/shell/components/ShellApp.tsx`
- 工具语义块：`packages/tui/src/shell/view-model.ts`
- diff/code 渲染：`packages/tui/src/shell/components/StructuredDiff.tsx`、`packages/tui/src/shell/components/MessageMarkdown.tsx`
- agent completion：`packages/tui/src/agent-completion-finalizer.ts`
- prompt：`packages/tui/src/model-prompt-runtime.ts`

## 参考核对

实际读取 Linghun 文档：

- `docs/delivery/LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `docs/delivery/LINGHUN_IMPLEMENTATION_SPEC.md`
- `docs/delivery/LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- Phase 7.17、7.17.1、7.18、7.18.1 相关交付文档。

实际参考 CCB 文件：

- `F:\ccb-source\src\screens\REPL.tsx`
- `F:\ccb-source\src\components\messages\AssistantToolUseMessage.tsx`
- `F:\ccb-source\src\components\ToolUseLoader.tsx`
- `F:\ccb-source\packages\builtin-tools\src\tools\FileEditTool\UI.tsx`
- `F:\ccb-source\src\components\StructuredDiff.tsx`
- `F:\ccb-source\src\components\StructuredDiffList.tsx`

行为参考进入 Linghun 自研实现：工具调用行有工具名/目标/进度，工具结果走专属语义 renderer，diff 宽度由父容器传入并按可用宽度渲染。

未复制 CCB 可疑源码实现、内部 API、专有 telemetry 或反编译痕迹。

## 成品级结构化 handoff packet

- 下一阶段：等待用户确认，不自动进入新阶段。
- 禁止事项：不要恢复 recent tail split；不要默认 push agent completion pass block；不要重新启用普通聊天虚拟滚动；不要把 raw tool protocol 放主屏。
- 证据引用：见涉及模块与测试命令。
- 验证结果：focused tests/typecheck/providers build/tui build/cli build/version/diff check 全部 PASS。
- 索引状态：外部 codebase-memory MCP 工具未暴露；使用 `rg` 与源码精读确认。
- 权限模式：本地 Codex desktop，filesystem unrestricted；未改权限模式。
- 模型/provider：Codex GPT-5；验证为本地命令，无 live provider 调用。
- 预算使用：无外部 provider token；本轮不新增模型调用。
