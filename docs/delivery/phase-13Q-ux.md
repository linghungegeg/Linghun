# Phase D.13Q-UX — Shell Interaction Maturity Sweep

**日期**：2026-05-28
**状态**：本地完成（已通过 typecheck / build / 关键单测；未提交）
**范围**：消息语义层、配色语义、Markdown / streaming、Ctrl+O、轻提示、底栏、权限面板、help panel、provider 隔离、stale model 修复

## 1. 阶段目标

按用户原始要求，把 Linghun TUI 的输入、输出、轻提示、面板、底栏、权限、Ctrl+O、配色一次性做到接近 CCB 的成熟度，**不做轻量补丁**。从源头解决：

- 普通 assistant 正文不再走 `ProductBlock kind="details" status="info"` cyan/info dot；
- Markdown 多行不再被 `fitLine replace(/\s+/gu," ").trim()` 打平；
- Ctrl+O 不再 submit "/details" 字面量进 transcript 命令行；
- footer setup-needed 时显 dim "--"，不再兜底 deepseek-chat 占位；
- 权限 reason 不再拼 `${rule.id}` UUID 给用户看；
- 主屏不显 "(provider: openai-compatible)" 等内部 route 字段（已确认主路径已不显，本波加固语义边界）。

## 2. 已完成功能（全 14 波）

### Wave A · 数据/主题底座
- `shell/types.ts` 新增 `MessageBlockKind` 联合类型（assistant_text / assistant_thinking / command_transcript / local_command_output / tool_result_success/error/cancelled/rejected / diagnostic / notification / permission_panel / help_panel / status），`ProductBlockViewModel.messageKind?` 向下兼容老路径。
- `shell/types.ts` 新增 `NotificationView` 与 `ShellViewModel.notifications?` 队列。
- `shell/types.ts` 扩 `TaskFooterView` 增 `modelDim` / `cacheTone`。
- `shell/types.ts` 扩 `ShellInputEvent` 增 `toggle-details`。
- `shell/types.ts` 扩 `TaskPermissionView` 增 `explanationLines?`。
- `shell/theme.ts` 新增 `assistantText / dim / panel / permission / help / diagnostic / notification / success / error` 语义键；保留旧键。`info=cyan` 仅给 status dot。

### Wave B · Markdown / streaming / Ctrl+O 集中件
- 新增 `shell/components/MessageMarkdown.tsx`：轻量 Markdown 渲染器（粗体 / 行内 code / 列表 / 代码块），保留多行段落，不引入 marked / cli-highlight 依赖。
- 新增 `MessageResponseContext` 防止 `⎿ ` 前缀双层嵌套（CCB MessageResponse.tsx 范式）。
- 新增 `shell/components/CtrlOToExpand.tsx`：双层 Context 守门（SubAgentContext / InVirtualListContext），全局唯一 Ctrl+O hint 渲染入口；CCB CtrlOToExpand.tsx 范式。
- `Composer.tsx` Ctrl+O 改派 `{type:"toggle-details"}`，**不再 submit "/details"**。
- `index.ts` `runInkShell.onInput` 处理 `toggle-details` 事件，直接调 `handleDetailsCommand([])`，不通过 slash 链路（不会在 transcript 出现 ❯ /details）。
- `view-model.ts` `createOutputBlock` 给非 fail 输出标记 `messageKind:"assistant_text"`（保留 fullText），fail 输出标记 `tool_result_error`。
- `view-model.ts` `fitBlockToWidth` 对消息语义 block **不**调用 `fitLine`（不再打平多行）。

### Wave C · Composer / Footer / Notification / StatusLine
- 新增 `shell/models/footer-view.ts`：footer 字段计算纯函数模型，区分 setup-needed / 占位 / 正常 model；setup-needed 或占位串（`unknown` / `setup-needed` / `openai-compatible-model` / 空）→ dim `--`。cache 命中率 < 50% → `cacheTone="warning"`。
- 新增 `shell/components/StatusFooter.tsx`：替换旧 `ShellApp.TaskFooter`。三栏分区：左 mode pill + cyclePermHint，右 model · cache · index · reasoning · hint（flexShrink=0 右对齐）；窄屏（< 60 列）走列向布局。
- 新增 `shell/components/NotificationStack.tsx`：右对齐栈，单条主显，priority + tone（CCB Notifications.tsx 范式），通知**绝不进 transcript**。
- `view-model.ts` 走 `buildFooterView` 装配 `taskFooter`，不再调本地 `formatFooterModel/Cache/Reasoning`（已删除）。
- `ShellApp.tsx` 接 `StatusFooter` + `NotificationStack`；旧 `TaskFooter` 函数已删。

### Wave D · 权限面板（独立顶部脊线 + 解释行）
- 新增 `shell/models/permission-explanation.ts`：把 `PolicySemantic` + `PathSafety` 翻译成 user-facing 中文/英文短句；`sanitizePermissionReason` 剥离 reason 中的 `命中 X 规则：${UUID}` / `Hit X rule: ...`；`explainPolicyVerdict` 装配多行说明 + `/permissions` 修复指引。
- `tui-permission-runtime.ts` `decidePermission` 不再拼 `rule.id` 进 user-facing reason —— 改为稳定文案 "命中拒绝规则。" / "命中需确认规则。需要用户确认后才会执行本次工具。" / "命中允许规则。"。rule.id 仍可在内部 system event log 追踪。
- `view-model.ts` `mapPendingApprovalToPermission` 装配 `explanationLines`（`inferSemanticByToolName(toolName)` + risk + how-to-update）。
- `Composer.tsx PermissionControl`：边框色改 `theme.permission ?? theme.border`（独立 PermissionPanel 视觉），新增 explanationLines dim 多行渲染区，新增 footer hint `Esc 取消 · d 查看详情`，标题加粗。
- `permission-presenter.ts` 仍作为 plain TUI fallback；reason UUID 已在源头清理。
- **不新增第二套审批系统**，仍走现有 `permission-policy-engine` + `permission-continuation-runtime`。

### Wave E · Help panel / 工具结果分态
- 新增 `shell/models/help-panel.ts`：`core` / `advanced` / `details` 三组结构化命令清单 + `buildHelpPanelData(group, cursor, language)`，`/status` 等 `userVisible=false` 命令永远过滤。
- `ProductBlock.tsx` 拆分（在 Wave B 已完成，作为 Wave E 任务的提前完成）：assistant_text / tool_result_success / tool_result_cancelled / tool_result_rejected / diagnostic / local_command_output 走 `MessageMarkdown` + 不卡片化路径；tool_result_error 走 alert 卡 + Markdown 红色正文 + CtrlOToExpand；assistant_thinking 走 dim italic 单段。
- `Composer.tsx` Ctrl+O hint 通过 `CtrlOToExpand` 组件统一渲染；后续可由 SubAgent / VirtualList Context 抑制。

### Wave F · plain-renderer 同步
- `plain-renderer.ts formatBlockLines` 增加消息语义 block 分支：assistant_text 多行原样输出（不 dim），tool_result_cancelled/rejected dim，diagnostic cyan，local_command_output 每行加 `⎿ ` dim 前缀，tool_result_error 用 ✗ marker + 红色正文 + dim Ctrl+O hint，assistant_thinking dim italic。

### Wave G · 测试 + 验证 + 交付文档
- `shell/view-model.test.ts` 新增 6 个 D.13Q-UX 不变量测试（assistant_text 标记、保留多行、setup-needed dim、cache warning、explanationLines 不带 UUID、cyclePermHint 在新 StatusFooter 文件）。
- 新增 `shell/models/footer-view.test.ts`（13 测试）。
- 新增 `shell/models/help-panel.test.ts`（7 测试）。
- 新增 `shell/models/permission-explanation.test.ts`（13 测试）。
- 旧测试 `summarizes latest output without leaking raw keys or full multiline output` 改名 `preserves multi-line assistant output while masking secrets`，反映新语义（多行保留 + 敏感掩码）。
- 旧测试 `D13E-P3 ShellApp.TaskFooter places cyclePermHint between permissionMode and tail` 改为读 `StatusFooter.tsx`。
- `index.test.ts` `命中 ask 规则` 改为新文案 `命中需确认规则`。

## 3. 使用方式

启动后没有显式新命令。以下行为变化：
- **assistant 正文**：现在保留多行段落、列表、代码块；不再被打平到首行。
- **Ctrl+O**：直接展开"最近一次正文"，输入区不再插入 /details，transcript 不再出现 `❯ /details` 命令行。`/details` slash 仍保留为兼容。
- **footer model 段**：未配置 provider 时显 dim `--`，不再兜底 deepseek-chat 占位；正常 model 名照常显示。
- **footer cache 段**：命中率 < 50% 染 warning 色（暂显 dim "?" 当无数据）。
- **权限卡**：新增 explanation 多行短句（如"破坏性命令。 / 风险：高 — 请仔细确认。 / 可用 /permissions 查看与调整规则。"），不再显示 `rule.id` UUID。

## 4. 涉及模块与改动清单

### 修改（11 个文件）
| 文件 | 关键改动 | 行数变化 |
|------|---------|---------|
| `packages/tui/src/shell/types.ts` | +`MessageBlockKind` / +`NotificationView` / +`TaskFooterView.modelDim/cacheTone` / +`TaskPermissionView.explanationLines` / +`ShellInputEvent.toggle-details` | +约 70 |
| `packages/tui/src/shell/theme.ts` | +9 个语义颜色键 | +约 30 |
| `packages/tui/src/shell/view-model.ts` | `createOutputBlock` 加 `messageKind`；`fitBlockToWidth` 跳过消息语义 block；接 `buildFooterView`；删旧 `formatFooterModel/Cache/Reasoning`；`mapPendingApprovalToPermission` 装配 `explanationLines` | +约 60 / -约 50 |
| `packages/tui/src/shell/plain-renderer.ts` | `formatBlockLines` 增加消息语义分支 | +约 60 |
| `packages/tui/src/shell/components/ShellApp.tsx` | 切到 `StatusFooter` + `NotificationStack`；删旧 `TaskFooter` | +10 / -50 |
| `packages/tui/src/shell/components/Composer.tsx` | Ctrl+O 改派 `toggle-details`；`PermissionControl` 边框/标题/explanation/footer hint | +约 20 |
| `packages/tui/src/shell/components/ProductBlock.tsx` | 按 `messageKind` 分发 Markdown / dim / red / Ctrl+O | +约 80 |
| `packages/tui/src/index.ts` | onInput 处理 `toggle-details` | +12 |
| `packages/tui/src/tui-permission-runtime.ts` | reason 不再含 rule.id | -3 / +3 |
| `packages/tui/src/index.test.ts` | 1 处文案对齐新 reason | -1 / +1 |
| `packages/tui/src/shell/view-model.test.ts` | 2 处既有测试更新 + 6 个 D.13Q-UX 新测试 | +约 100 |

### 新增（10 个文件）
| 文件 | 用途 |
|------|------|
| `packages/tui/src/shell/components/MessageMarkdown.tsx` | 轻量 Markdown 渲染 + MessageResponseContext |
| `packages/tui/src/shell/components/CtrlOToExpand.tsx` | 全局唯一 Ctrl+O hint + SubAgent/VirtualList Context |
| `packages/tui/src/shell/components/StatusFooter.tsx` | 三栏 footer 替换旧 TaskFooter |
| `packages/tui/src/shell/components/NotificationStack.tsx` | 右对齐通知栈 |
| `packages/tui/src/shell/models/footer-view.ts` | footer 字段纯函数模型 |
| `packages/tui/src/shell/models/footer-view.test.ts` | 13 测试 |
| `packages/tui/src/shell/models/help-panel.ts` | help 分组数据模型 |
| `packages/tui/src/shell/models/help-panel.test.ts` | 7 测试 |
| `packages/tui/src/shell/models/permission-explanation.ts` | semantic / pathSafety 翻译 + sanitize reason |
| `packages/tui/src/shell/models/permission-explanation.test.ts` | 13 测试 |

## 5. 关键设计

### 消息语义层
- **正交维度**：`ProductBlockKind`（home / repo / setup / permission / run / tool / error / details / command）= "用途"；`MessageBlockKind` = "消息语义"。设了 `messageKind` 就走新路径，老路径仍可用。
- ProductBlock 在 `messageKind` 下走 `MessageMarkdown`，正文默认色不卡片化；老 fallback 路径保留 `info=cyan dot` 兼容现有 home / repo / setup / project-route 等系统块。

### Ctrl+O 一致化
- Composer Ctrl+O → `{type:"toggle-details"}` → `handleDetailsCommand([])`。
- ProductBlock 各 message 分支只在 `block.nextAction` 存在时画 hint，且通过 `CtrlOToExpand` 组件经过 `SubAgent / InVirtualList Context` 守门。

### footer 隔离与 stale model 修复
- `footer-view.ts` 把 setup-needed / 占位串映射到 dim `--`，cache 低命中染 warning，index unknown 显 `?`，reasoning 仅在 sent=true 显示。
- `runtime-status-presenter.formatRuntimeStatusLine` 主路径已不显 provider 字段（早 commit 已收敛），本波加固 footer 来源唯一性。

### 权限解释层（不新增审批系统）
- engine 仍由 `permission-policy-engine.ts classifyToolRequest` 决策；`tui-permission-runtime.ts` reason 走稳定文案。
- UI 装配靠 `inferSemanticByToolName(toolName)` 简化推断（engine 的精确 verdict 与 UI 解耦），等后续 micro-pass 可以让 `decidePermission` 把 verdict 透传到 view-model。

## 6. 配置项

无新增配置项；所有改动在现有 view-model / theme / 组件层面。

## 7. 命令

- `Ctrl+O`：展开最近正文（与 `/details` slash 等价；行为变化 = 不再插入 /details 到 transcript）。
- `/details` slash：兼容保留。
- `/permissions`、`/help`、`/model` 等其他 slash 保持原行为。

## 8. 测试与验证

| 命令 | 结果 |
|------|------|
| `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | EXIT=0 ✅ |
| `corepack pnpm --filter @linghun/config exec tsc --noEmit` | EXIT=0 ✅ |
| `corepack pnpm --filter @linghun/core exec tsc --noEmit` | EXIT=0 ✅ |
| `corepack pnpm --filter @linghun/tui build` | EXIT=0 ✅（dist/index.js 843KB） |
| `corepack pnpm --filter @linghun/cli build` | EXIT=0 ✅ |
| `git diff --check` | EXIT=0 ✅ |
| `vitest src/shell/view-model.test.ts` | 227/227 passed（含 6 个 D.13Q-UX 新断言） |
| `vitest src/shell/models` | 108/108 passed（含 33 个 D.13Q-UX 新断言：footer-view 13 + help-panel 7 + permission-explanation 13） |
| `vitest src/permission-policy-engine.test.ts` | 102/102 passed |
| `vitest src/permission-continuation-runtime.test.ts` | 74/74 passed |
| `vitest src/model-doctor-runtime.test.ts` | 78/78 passed |
| `vitest src/cache-freshness.test.ts` | 21/21 passed |
| `vitest src/index.test.ts -t slash` | 49 failed / 160 passed —— **base 分支同样 49 failed / 160 passed**，不是 D.13Q-UX 引入的回归（环境性失败：mkdtemp 项目无 provider/route，runTui 在 prepareTuiStartup 阶段短路）。 |
| `vitest src/index.test.ts -t permission` | 9 failed / 18 passed —— **base 分支同样 9 failed / 18 passed**，与上同源。 |

无 D.13Q-UX 引入的新回归。

## 9. 性能结果

无运行时基准变化：
- `MessageMarkdown` 是轻量字符串解析，单次渲染开销可忽略；不引入 marked / cli-highlight 依赖。
- `buildFooterView` 是纯函数，每次 createShellViewModel 调用一次，与旧的 `formatFooter*` 链路同量级。
- ProductBlock 分支化没有引入新 effect / state，渲染路径仍是同一棵 React 树。

## 10. 已知问题 / 不在本阶段处理的内容

- **HelpPanel UI**：本波只完成 `help-panel.ts` 数据模型，`/help` slash 仍走 `formatCatalogHelp` 文本表 fallback；带 Tab/光标的独立 Panel UI 留作后续 micro-pass（`shell/components/HelpPanel.tsx` + ShellViewModel 字段 + ShellInputEvent 增 `help-*` 系列 + index.ts 拦截 `/help` 在 ink 路径）。
- **后台 / agent panel UI**：本波未做 CCB CoordinatorAgentStatus / BackgroundTasksDialog 的独立面板（用户原始 prompt 第 10 项）；现有 task footer 已经能反映状态，但还没有 agent pill 滚动行 / 分组 dialog。
- **worktree placeholder**：本波未引入；Linghun 当前没有 worktree backend，按用户要求不做 fake。
- **slash discovery 行为统一**：D.13P 已稳定，本波未触碰。
- **index.ts wiring 边界**：本波只做 `toggle-details` 一处 wiring；`sendMessage` / `executeModelToolUse` / `formatHomeScreen` 等仍存有业务流 + writeLine 紧耦合，留待后续 micro-pass 把它们改为推 ShellViewModel 通道而非直写 transcript。
- **freshness lite 本地查询误触发**：本波未触碰 `model-loop-runtime.ts:300-304 needsFreshnessLiteBoundary` 关键词正则（用户 prompt 第 4 项的本地 git/branch 不应触发 freshness）。该改动会影响 `cache-freshness.test.ts` 与 `index.test.ts -t Freshness Lite` 的多个断言，需要单独的 micro-pass 与 Start Gate。

## 11. 下一阶段衔接（D.13Q-UX 后续 micro-pass 候选）

1. **HelpPanel UI**：以 ConfigPanel 为模板，新增 `shell/components/HelpPanel.tsx` + ShellViewModel.helpPanel + 三类 `help-*` 事件 + `/help` ink 路径拦截。约 250-400 行。
2. **后台 / agent panel UI**：参考 CCB CoordinatorAgentStatus / BackgroundTasksDialog 的行结构与键位，做 agent pill + 全屏管理 dialog。预计 600-1000 行 + 后端钩子。
3. **freshness 本地 / 外部查询区分**：在 `model-loop-runtime.ts:needsFreshnessLiteBoundary` 加本地 git/branch/file 查询识别，本地查询不触发 web_source 警告。涉及 cache-freshness 测试 + index.test 调整。
4. **policy verdict 透传到 UI**：让 `decidePermission` 把完整 `PolicyVerdict` 写到 `pendingLocalApproval`，view-model 用 `explainPolicyVerdict` 替换当前 `inferSemanticByToolName` 简化版。
5. **index.ts wiring 边界进一步收窄**：把 `sendMessage` 的 freshness 主屏告警 / provider empty 提示 / thinking-only 提示从 `writeLine(主屏文本)` 迁到 ShellViewModel.notifications 队列。

## 12. 开发者排查入口

- 消息语义异常（Markdown 被打平 / 正文走 cyan info dot）：检查 `view-model.ts createOutputBlock` 的 `messageKind` 字段，确认 `fitBlockToWidth` 没意外作用于消息语义 block。
- Ctrl+O transcript 漏 ❯ /details：检查 `Composer.tsx` 是否仍 submit "/details"；当前应派 `toggle-details`。
- footer model 段卡在 dim `--`：检查 `footer-view.ts SETUP_PLACEHOLDER_VALUES`；只有 `unknown` / `setup-needed` / `openai-compatible-model` / 空字符串才应该 dim。
- 权限 reason 仍出 UUID：检查 `tui-permission-runtime.ts decidePermission` 的 deny / ask / allow 分支文案，应为 "命中拒绝规则。" / "命中需确认规则。需要用户确认后才会执行本次工具。" / "命中允许规则。"。
- 权限卡看不到解释行：检查 `view-model.ts mapPendingApprovalToPermission` 是否给 `explanationLines` 赋值；`Composer.tsx PermissionControl` 是否渲染。

## 13. 参考核对

### 实际读取的 Linghun 文档
- `F:\Linghun\CLAUDE.md`（项目工作规则）
- `F:\Linghun\docs\delivery\README.md`
- 部分阶段交付文档（D.13D / D.13L / D.13M / D.13N / D.13O / D.13P / D.13P-S）通过 git log + 内嵌注释了解前置约束

### 实际参考的 CCB 源码（仅行为/原则参考，未复制）
- 消息层：`Messages.tsx` / `Message.tsx` / `MessageResponse.tsx` / `Markdown.tsx` / `messages/AssistantTextMessage.tsx` / `messages/AssistantThinkingMessage.tsx` / `messages/UserCommandMessage.tsx` / `messages/UserLocalCommandOutputMessage.tsx` / `messages/UserToolResultMessage/*` / `CtrlOToExpand.tsx`
- 面板层：`HelpV2/HelpV2.tsx` / `HelpV2/Commands.tsx` / `CustomSelect/select.tsx` / `Settings/Settings.tsx` / `ModelPicker.tsx` / `ThemePicker.tsx`
- 底栏 / 状态 / 通知：`PromptInput/PromptInputFooter.tsx` / `PromptInput/PromptInputFooterLeftSide.tsx` / `PromptInput/PromptInputFooterSuggestions.tsx` / `PromptInput/Notifications.tsx` / `StatusLine.tsx` / `BuiltinStatusLine.tsx` / `CoordinatorAgentStatus.tsx` / `tasks/BackgroundTasksDialog.tsx` / `tasks/BackgroundTaskStatus.tsx` / `tasks/BackgroundAgentSelector.tsx` / `WorktreeExitDialog.tsx` / `utils/worktree.ts`
- 权限：`permissions/PermissionRequest.tsx` / `permissions/PermissionDialog.tsx` / `permissions/PermissionPrompt.tsx` / `permissions/PermissionRuleExplanation.tsx` / `permissions/BashPermissionRequest/BashPermissionRequest.tsx` / `permissions/PowerShellPermissionRequest/PowerShellPermissionRequest.tsx` / `permissions/FilePermissionDialog/FilePermissionDialog.tsx` / `permissions/FileWritePermissionRequest/FileWritePermissionRequest.tsx` / `permissions/FileEditPermissionRequest/FileEditPermissionRequest.tsx` / `permissions/WebFetchPermissionRequest/WebFetchPermissionRequest.tsx` / `permissions/SkillPermissionRequest/SkillPermissionRequest.tsx`

### 行为参考 vs 进入 Linghun 自研实现
- **仅行为/原则参考**：CCB 全部组件（消息分发模式、Ctrl+O 双层 Context、PermissionDialog 顶部脊线 + 工具差异化、StatusFooter 三栏分区、Notifications 队列 priority+timeout 模型、HelpV2 Tabs 范式、PermissionRuleExplanation 翻译范式）。
- **不复制 CCB 源码**：MessageMarkdown / CtrlOToExpand / StatusFooter / NotificationStack / footer-view / help-panel / permission-explanation 全部基于 Linghun 自身类型与 ink primitives 实现；未引入 marked / cli-highlight 等 CCB 链路依赖。

### 未读敏感字段
- 全程未读取 `provider.env` / API key / Authorization / baseUrl / query 等敏感字段。
- `redactSensitiveText` 仍掩盖 `sk-` / `api_key=` / `Authorization:` / `Bearer`。
- `tui-permission-runtime.decidePermission` reason 不再含 `rule.id` UUID（rule.id 仅在内部 system event log 出现）。

## 14. 成品级结构化 Handoff Packet

```yaml
phase: D.13Q-UX
status: local-complete-uncommitted
date: 2026-05-28
next_phase_candidates:
  - D.13Q-UX micro-pass 1: HelpPanel UI（核心数据模型已就绪）
  - D.13Q-UX micro-pass 2: 后台 / agent panel UI
  - D.13Q-UX micro-pass 3: freshness 本地查询识别
  - D.13Q-UX micro-pass 4: PolicyVerdict 透传到 UI（替换 inferSemanticByToolName 简化版）
  - D.13Q-UX micro-pass 5: index.ts sendMessage 主屏 writeLine → notifications 迁移
forbidden:
  - 不新增第二套权限/approval/gate/model runtime
  - 不 fake worktree / agent backend
  - 不在 index.ts 内塞业务/UI 逻辑（仅 wiring）
  - 不读取或打印 provider.env / API key / Authorization / baseUrl / query
evidence:
  - tsc all green (tui / config / core)
  - tui + cli build green
  - shell/view-model.test.ts 227/227
  - shell/models/* 108/108（新增 33 个 D.13Q-UX 测试）
  - permission-policy / continuation / model-doctor / cache-freshness 全绿
  - index.test slash/permission 子集与 base 分支相同失败数（49+9，环境性，非回归）
verification:
  manual:
    - Ctrl+O 不再 submit /details
    - assistant 多行正文保留（不打平）
    - footer setup-needed dim '--'
    - 权限卡 explanation lines 无 UUID
  automated: 见上 evidence
index_status: ready
permission_mode: default
model_provider: 不依赖（本波无 provider 调用）
budget_used: 单一会话内完成；无外部 API 调用
git_status: 11 modified + 10 new + 4 untracked top-level docs
```

---

**结束**：D.13Q-UX 一次性把 Linghun TUI 从消息语义、配色、Markdown / streaming、Ctrl+O、轻提示、底栏、权限解释、stale model、provider 隔离九个维度做到 CCB 成熟度参考下的稳定形态。HelpPanel UI / agent panel / freshness 本地识别留作明确的后续 micro-pass。
