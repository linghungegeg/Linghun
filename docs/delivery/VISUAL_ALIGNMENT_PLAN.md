# Linghun → CCB 用户可见层 100% 对齐任务拆解

> **原则：** 每个阶段必须先对比两端代码事实，确认差异后再改。不允许自由发挥。
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`
> **日期：** 2026-06-11

---

## 全局执行铁律

### 一、每阶段必做
1. **代码事实对比先行：** 改动前必须同时读取 CCB 和 Linghun 两端源码，确认差异行号和代码片段，记录到阶段交付。
2. **行为边界明确：** 每阶段注明：哪些行为直接参考 CCB、哪些自研、哪些新增模块。
3. **好坏裁决：** CCB 做得好的 → 直接对齐，不自创；Linghun 当前做得反人类的 → 直接替掉，不在烂基础上修修补补。
4. **闭环验证：** 每阶段必须有可执行验证命令或 TUI 操作路径，不能只靠肉眼。

### 二、行为边界定义（每阶段必填）
- **参考行为：** 直接照 CCB 的交互方式、视觉样式、展示逻辑做。
- **自研行为：** Linghun 独有的功能（如 WorkflowProgressView、BtwPanel），保持但视觉对齐 CCB 风格。
- **新增模块：** 缺的组件直接新建文件，不硬塞进现有组件。

### 三、好坏裁决原则
- CCB 源码里好的设计 → 直接搬，不犹豫。
- Linghun 当前实现反人类（如折叠过度、边框满天飞、Agent Tree 滚走）→ 直接替换，不在原代码上改参数。
- 两边都没有的 → 不发明，不扩展范围。

### 四、闭环标准（每阶段必达标）
- 有用户可执行命令或 TUI 操作路径。
- 有失败降级（窄屏/重定向/no-color 不崩）。
- 阶段完成输出 `docs/delivery/visual-alignment-phase-N.md`。

---

## 差距总览（基于代码事实）

| # | 差距项 | CCB 事实 | Linghun 事实 | 严重度 |
|---|--------|---------|-------------|--------|
| 1 | 折叠策略 | 默认全量显示 | 主动折叠 >3行，统计摘要 | 🔴 |
| 2 | 边框使用 | 仅权限/审批用 `round` | 大量 `single` 边框（error/permission/fail/blocked/panel） | 🔴 |
| 3 | 进度反馈 | 闪烁 spinner + 计时器 + 行数 + 字节数 | 纯文本 "正在思考…" | 🔴 |
| 4 | Agent Tree 位置 | ScrollBox 外部 bottom 固定 | TranscriptViewport 内部随消息滚走 | 🔴 |
| 5 | Agent Tree 交互 | 键盘选择 + Enter 进入视线 | 纯只读，前 4 个截断 | 🔴 |
| 6 | 输出前缀 | `⎿ ` + dimColor，`MessageResponse` 组件 | `⎿ ` + dimColor，ProductBlock 内联 | 🟡 |
| 7 | Modal 定位 | `position="absolute"` + `opaque` 覆盖 | Panel 是流式卡片，不覆盖 | 🟡 |
| 8 | Composer 视觉 | 无边框，命令行式 | `borderStyle="round"` + `› ` 提示符 | 🟡 |
| 9 | Footer 分层 | 两行：StatusLine + 右侧通知 | 单行压缩 | 🟡 |
| 10 | 任务完成 | eviction 延迟消失（1秒定时器） | 立即消失 | 🟡 |
| 11 | 滚动实现 | Ink 原生 `<ScrollBox stickyScroll>` | 手动 Yoga 测量 + marginTop 偏移 | 🟡 |
| 12 | Task 展示 | 双行布局（subject+活动摘要），completed strikethrough+dimColor，Ctrl+T 切换，5s 自动隐藏 | 单行拼接，无 strikethrough，无折叠交互 | 🔴 |
| 13 | Session 面板 | 搜索框 + 分支过滤 + Ctrl+V 预览 + 时间分组 | 纯列表，无搜索/过滤/预览 | 🟡 |
| 14 | Compact 边界 | `CompactBoundaryMessage` 标记对话压缩点 | 无 | 🟡 |
| 15 | Context 可视化 | `/context` token 分布图 + 优化建议 | 无 | 🟡 |
| 16 | 配色体系 | 82 token + RGB 精确色值 + 6 主题变体，语义分层（success/error/warning/claude/suggestion/permission/subtle/inactive） | 17 token + chalk 颜色名 + 3 模式，无 suggestion/subtle/inactive 语义层 | 🔴 |
| 17 | 工具输出摘要 | `SearchResultSummary` 组件：`"Found N lines"` bold 数字 + 单复数处理 + verbose 双行布局 | `formatPrimaryToolLead`：`"搜索摘要：N 处。"` 统计先行 + `formatBashEndSummary` 独立行 `"命令已退出 0"` | 🟡 |
| 18 | 代码块渲染 | `HighlightedCode`：行号 gutter + `NoSelect` 保护 + `color-diff-napi` 着色 | `MessageMarkdown`：`┌│└` box-drawing 边框 + `cli-highlight` + 无行号 | 🟡 |
| 19 | 消息时间戳 | `formatBriefTimestamp`：按时间梯度格式化（当天仅时间/6天内星期/更早日期），在 UserPromptMessage/UserTextMessage 中渲染 | ProductBlock 明确不渲染时间戳（代码注释："不引入全局序号或时间戳"） | 🔴 |
| 20 | 错误恢复/重试 | `SystemAPIErrorMessage`：实时倒计时 `"Retrying in N seconds… (attempt n/m)"` + 前 3 次降噪 + API_TIMEOUT_MS 提示 | `tool_result_error` block 仅展示错误文本，无重试/倒计时/降噪 | 🔴 |
| 21 | 快捷键行内提示 | `KeyboardShortcutHint` 组件范式：`"shortcut to action"` 格式，78+ 处行内嵌入（Footer 的 `? for shortcuts` / `esc to interrupt` / `ctrl+t to show tasks`） | 快捷键全部集中在 `ShortcutPanel` 面板内，无行内 inline 提示 | 🟡 |
| 22 | WebSearch/WebFetch | 专用 UI：搜索次数+耗时汇总、fetch 大小+状态码、进度 `"Searching: {query}"` / `"Fetching…"` | 走通用 ProductBlock 渲染，无专用紧凑格式 | 🟡 |
| 23 | MCP 工具输出 | `MCPTool/UI.tsx`：结构化解包（tryUnwrapTextPayload）、大 token 警告、Slack 压缩、进度百分比 | 走通用 ProductBlock 渲染，无 MCP 感知的解析/警告 | 🔴 |
| 24 | 远程连接状态 | Footer 中 `● remote` 链接指示器 + 远程模式权限指示器隐藏 | StatusFooter 无远程状态指示 | 🟡 |

---

## 阶段 1：视觉去卡片化 + 全量显示

### 目标
消除 Linghun 的"边框卡片感"，输出默认全量显示，接近 CCB 的扁平流式视觉。

### 1A. 对比事实：边框策略

**CCB：** `borderStyle="round"` 仅用于 PermissionDialog / PlanApproval / PromptInput / 各 Dialog 层
- `PermissionDialog.tsx:31` — `borderStyle="round" borderColor={color}`
- `PlanApprovalMessage.tsx:27/62/78` — `borderStyle="round" borderColor="planMode"/"success"/"error"`
- **输出块不加任何边框**，通过 `MessageResponse.tsx:14-31` 的 `⎿ ` 前缀 + dimColor 区分

**Linghun：** ProductBlock.tsx 有 4 处 `borderStyle="single"`：
- `ProductBlock.tsx:245` — `tool_result_error` 红色边框卡片
- `ProductBlock.tsx:289` — `emphasized` 条件：permission/fail/error/blocked 全部加边框
- 各 Panel 组件全部 `borderStyle="single"`（CommandPanel:87, HelpPanel:72, ConfigPanel:62/94 等）
- Composer.tsx:1469 `borderStyle="round"`

### 1A. 动作

1. **ProductBlock.tsx:289** — 将 `borderStyle={emphasized ? "single" : undefined}` 改为仅在 `block.kind === "permission"` 时启用边框，其他 emphasized 场景只变颜色
2. **ProductBlock.tsx:245** — tool_result_error 移除 `borderStyle="single"`，改为 `⎿ ` prefix + `color={theme.error}`
3. **Composer.tsx:1469** — 移除 `borderStyle="round"`
4. **各 Panel** — CommandPanel/HelpPanel/ConfigPanel/SessionsPanel 移除 `borderStyle="single"`，改为 dim 分隔线
5. 保留 CCB 对齐：**permission 类**保留边框（因为 CCB PermissionDialog 也用 `round`）

### 1B. 对比事实：折叠策略

**CCB：**
- `BashToolResultMessage.tsx:92-119` — stdout 全部渲染 `<OutputLine content={stdout} />`，不截断
- `OutputLine.tsx:75-84` — 截断仅由 `renderTruncatedContent` 根据终端宽度做软截断

**Linghun：**
- `tool-output-presenter.ts:554-573` — `hasHiddenContent` 判定：行数 > 3 || 文本 > 200 || explicit truncated → 折叠
- `tool-output-presenter.ts:603-611` — `formatBashTail` 只取最后 3 行
- `tool-output-presenter.ts:336-343` — 折叠提示 "输出已折叠，按 Ctrl+O 展开"

### 1B. 动作

1. `tool-output-presenter.ts:554-558` — 提高折叠阈值：`lines.length > 100`（原来 3），`text.length > 10000`（原来 200）
2. `tool-output-presenter.ts:18` — `BASH_TAIL_LINE_LIMIT` 从 3 改为 0（不截断）
3. 保留 Ctrl+O 机制但只在真正大输出（>100行）时触发

### 1C. 对比事实：输出前缀样式

**CCB：** `MessageResponse.tsx:14-31`
```tsx
<Box flexDirection="row">
  <NoSelect flexShrink={0}><Text dimColor>{'  '}⎿ &nbsp;</Text></NoSelect>
  <Box flexShrink={1} flexGrow={1}>{children}</Box>
</Box>
```

**Linghun：** `ProductBlock.tsx:153` — 仅在 `local_command_output` 使用 `"  ⎿  "` prefix

### 1C. 动作

1. 创建 `MessageResponse.tsx` 组件（对齐 CCB 的 `⎿ ` + dimColor + flexRow 布局）
2. 在 `ProductBlock.tsx` 的 tool_result_success/diagnostic/local_command_output 分支中使用

### 验证方式

- 运行 `linghun`，执行 Bash 命令，确认输出不折叠、无边框
- 确认 permission 请求仍保留边框
- 确认 Composer 无边框

---

## 阶段 2：进度反馈专业化

### 目标
对齐 CCB 的实时进度展示：闪烁 spinner + 计时器 + 统计

### 2A. 对比事实：ToolUseLoader 闪烁

**CCB：** `ToolUseLoader.tsx:13-33`
```tsx
const [ref, isBlinking] = useBlink(shouldAnimate);
// 600ms 间隔，偶数帧可见 ●，奇数帧隐藏
```

**Linghun：** `ShellApp.tsx:508-513`
```tsx
// 静态 spinner 轮换：["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]，100ms 帧率
// 无闪烁/显示切换，而是旋转字符
```
- **CCB 用 `●` 闪烁（可见/不可见交替），Linghun 用 braile 旋转**
- CCB 失焦时暂停闪烁（`useTerminalFocus`），Linghun 不暂停

### 2A. 动作

1. 将 spinner 从 braile 轮换改为 `●` 闪烁（600ms 间隔，偶数帧可见）
2. 添加 `useTerminalFocus` 失焦暂停逻辑（如果 Ink 支持）

### 2B. 对比事实：进度统计

**CCB：** `ShellProgressMessage.tsx:59-74`
```tsx
<Box flexDirection="column">
  <Box height={Math.min(5, lines.length)} overflow="hidden">
    <Text dimColor>{displayLines}</Text>          // 最后5行实时更新
  </Box>
  <Box flexDirection="row" gap={1}>
    <Text dimColor>~2000 lines</Text>             // 行数
    <ShellTimeDisplay elapsedTimeSeconds={3.2} /> // 计时器
    <Text dimColor>5.2MB</Text>                  // 字节数
  </Box>
</Box>
```

**Linghun：** `ShellApp.tsx:489-543` ActivityIndicator
```tsx
// 只有 phase + 文案轮换 + token count
// 无 elapsed time、无行数、无字节数
```

### 2B. 动作

1. 在 `ActivityIndicator` 或 Bash 工具运行中，追加一行统计：
   - `elapsedTimeSeconds`（从工具执行开始计时）
   - `totalLines` / `totalBytes`（从流式输出中累积）
   - dimColor 显示
2. 添加"最后 5 行实时预览"（如果输出流式可用）

### 验证方式

- 执行 `npm install`，确认进度区显示计时器 + 行数
- 确认 spinner 闪烁而非旋转

---

## 阶段 3：Agent Tree / Workflow Tree 布局对齐

### 目标
Agent Tree 移到固定底部，不随消息滚动

### 3A. 对比事实：渲染位置

**CCB：** `FullscreenLayout.tsx + Spinner.tsx`
- `Spinner.tsx:260-355` — `TeammateSpinnerTree` 在 `bottom` 区域内渲染（ScrollBox 外部）
- `FullscreenLayout.tsx` — `bottom` 区域 `flexShrink={0}` 固定

**Linghun：** `ShellApp.tsx:233-258`
```tsx
// AgentProgressTree 和 WorkflowProgressView 都在 TranscriptViewport 内部
<TranscriptViewport>
  ...
  {view.agentProgressTree ? <AgentProgressTree /> : null}
  {view.workflowProgressView ? <WorkflowProgressView /> : null}
</TranscriptViewport>
```

### 3A. 动作

1. 将 `AgentProgressTree` 从 TranscriptViewport 内移到 Composer Band 上方（`flexShrink={0}`）
2. 将 `WorkflowProgressView` 同样移到固定区域
3. 参考 CCB 的 bottom 三层结构：Spinner → PromptInput → Footer

### 3B. 对比事实：交互能力

**CCB：** `TeammateSpinnerTree.tsx + TeammateSpinnerLine.tsx`
- `TeammateSpinnerLine.tsx:48-50` — `handleClick` 回调，支持点击
- `viewSelectionMode === 'selecting-agent'` 选择模式
- `expandedView === 'teammates'` 展开/隐藏切换
- Enter 进入 teammate 视图

**Linghun：** `AgentProgressTree.tsx:25-43`
- 纯只读 `<Text>`，无可交互元素
- 前 4 个截断，`+N 待显示 · Shift+↓` 提示

### 3B. 动作

1. Agent Tree 支持上下键选择（选中高亮，参考 CCB `╞═` / `╘═`）
2. Enter 键进入 agent 详情视图
3. 移除 "前 4 个截断" 限制，显示所有 running agent
4. 添加 `x` 键关闭单个 agent（参考 CCB eviction）

### 验证方式

- 多开 agent 时确认 Tree 固定在底部
- 上下键可切换选中
- 完成后保留 5 秒再消失

---

## 阶段 4：Modal/Panel 全屏覆盖

### 目标
HelpPanel / CommandPanel 等从流式卡片改为绝对定位覆盖层

### 4A. 对比事实：定位方式

**CCB：** `FullscreenLayout.tsx:429-447`
```tsx
<Box position="absolute" bottom={0} left={0} right={0}
     maxHeight={terminalRows - MODAL_TRANSCRIPT_PEEK}  // 留2行看上下文
     overflow="hidden" opaque>
  <Text color="permission">{'▔'.repeat(columns)}</Text>  // 分隔线
  <Box paddingX={2}>{modal}</Box>
</Box>
```

**Linghun：** `ShellApp.tsx:370-447 PanelLayer`
```tsx
// Panel 是流式卡片，在 TranscriptViewport 下方、Composer 上方
// 宽度 Math.min(width, 84~110)，有 borderStyle="single"
// 非 position="absolute"，不覆盖
```

### 4A. 动作

1. PanelLayer 外层容器加 `position="relative"`
2. 渲染 Panel 时改为绝对定位覆盖：
   - `position="absolute" bottom={0} left={0} right={0}`
   - `maxHeight={rows - 2}` 保留上方 2 行
   - `opaque` 不透明
3. 顶部分隔线：`▔` 重复 `columns` 次
4. 内容区 `paddingX={2}`
5. 移除各 Panel 组件的 `borderStyle="single"`

### 验证方式

- `/help` 打开帮助面板，确认覆盖在 transcript 上方
- 上方仍可见 2 行消息上下文
- 顶部分隔线可见

---

## 阶段 5：Footer 分层 + 任务完成 Eviction

### 目标
Footer 从单行改为多行分层，任务完成延迟消失

### 5A. 对比事实：Footer 布局

**CCB：** `PromptInputFooter.tsx:148-199`
```tsx
<Box justifyContent="space-between" paddingX={2}>
  <Box flexShrink={1}>               // 左侧
    <StatusLine />                    // 独立行：运行时状态详情
    <PromptInputFooterLeftSide />     // 模式指示器 + 任务状态
  </Box>
  <Box flexShrink={1}>               // 右侧
    <Notifications />                 // 通知 (API key, updater)
    <BridgeStatusIndicator />
  </Box>
</Box>
```

**Linghun：** `StatusFooter.tsx:34-115`
```tsx
// 单行：左 permissionMode + 右 model·cache·index
// 窄屏换行
```

### 5A. 动作

1. StatusFooter 改为两行布局（宽屏 ≥80 列时）：
   - 行 1：StatusLine（模型状态、context 使用量、reasoning 预算）
   - 行 2：permissionMode · model · cache · index · git · context
2. 窄屏（<80 列）时合并为单行

### 5B. 对比事实：Eviction 延迟消失

**CCB：** `CoordinatorAgentStatus.tsx:54-70`
```tsx
const interval = setInterval(() => {
  const now = Date.now();
  for (const t of Object.values(tasksRef.current)) {
    if (isPanelAgentTask(t) && (t.evictAfter ?? Infinity) <= now) {
      evictTerminalTask(t.id, setAppState);
    }
  }
}, 1000);
```

**Linghun：** 任务完成立即从 `context.agents` 移除 → `buildAgentProgressTreeView` 返回 undefined → 组件消失

### 5B. 动作

1. 在 TUI 状态管理中为 agent 添加 `completedAt` 时间戳
2. `buildAgentProgressTreeView` 保留已完成 agent 5-10 秒
3. 完成后显示 `✓` 标记 + elapsed time，而非立刻消失

### 验证方式

- Footer 宽屏显示两行，有 StatusLine
- Agent 完成后保留几秒，显示 ✓

---

## 阶段 6：滚动原生化

### 目标
TranscriptViewport 从手动 Yoga 测量迁移到 Ink `<ScrollBox>`

### 6A. 对比事实

**CCB：** `FullscreenLayout.tsx:386-395`
```tsx
<ScrollBox ref={scrollRef} flexGrow={1} flexDirection="column"
           paddingTop={padCollapsed ? 0 : 1} stickyScroll>
  {scrollable}
</ScrollBox>
```

**Linghun：** `TranscriptViewport.tsx:40-123`（84 行核心逻辑）
```tsx
// 手动测量：yogaNode.getComputedHeight()
// 手动偏移：marginTop={-clampedOffset}
// 手动边界：maxOffset = contentHeight - viewportHeight
```

### 6A. 动作

1. 验证 Ink 7.0.3 的 `<ScrollBox>` 在当前项目中可用
2. 用 `<ScrollBox stickyScroll>` 替换 TranscriptViewport 核心逻辑
3. 保留 `AutoScroll` 自动吸底行为
4. 删除 640 行手动测量代码

**⚠️ 高风险改造，必须先在独立分支验证 Ink 7.0.3 ScrollBox 行为**

### 验证方式

- 消息超过 1 屏可向上滚动
- 新消息自动吸底
- Ctrl+O 展开后可回滚

---

## 阶段 7：Task 展示专业化（双行 + 交互动画）

### 目标
对齐 CCB TaskListV2 的双行布局、状态视觉层次、折叠交互

### 7A. 对比事实：布局

**CCB：** `TaskListV2.tsx`（每个 TaskItem 双行）
```tsx
// 行 1：图标 + subject（bold/strikethrough/dimColor）+ owner + blockedBy
<Box flexDirection="row">
  <Text color={color}>{icon} </Text>
  <Text bold={inProgress} strikethrough={completed} dimColor={completed||blocked}>
    {subject}
  </Text>
  {owner && <Text color={ownerColor}>{owner}</Text>}
</Box>
// 行 2：活动摘要行（仅 in_progress + 有活动时）
{isActive && (
  <Box paddingLeft={2}>
    <Text dimColor>{activity}...</Text>
  </Box>
)}
```

**Linghun：** `TaskListView.tsx:25-43` 单行拼接
```tsx
// `标记 + subject + owner + blockedBy` 全部拼接为一个 Text
<Text>{fitText(`${marker} ${row.subject}${owner}${blockedBy}`, innerWidth)}</Text>
```

### 7A. 动作

1. TaskListView 改为双行布局：
   - 行 1：标记 + subject（bold/dimColor/strikethrough 按状态）+ owner
   - 行 2：活动摘要（dimColor，`paddingLeft={2}`，仅 in_progress 显示）
2. completed 状态：`strikethrough` + `dimColor`（对齐 CCB `completed: strikethrough + dimColor`）
3. blocked 状态：`dimColor`

### 7B. 对比事实：折叠交互

**CCB：** Ctrl+T 切换 `expandedView === 'tasks'`，5s 自动隐藏
```typescript
// useTasksV2.ts
const HIDE_DELAY_MS = 5000;
// 所有 task 完成 → 开始 5s 倒计时 → 清除并隐藏面板
```

**Linghun：** 无折叠，无自动隐藏

### 7B. 动作

1. 添加 Ctrl+T 切换 task 面板可见性
2. 所有 task 完成后 5s 自动隐藏
3. 有未完成任务时取消倒计时并显示

### 验证方式

- Task 显示双行，completed 有删除线
- Ctrl+T 可切换面板
- 全部完成后 5s 自动消失

---

## 阶段 8：Session 面板增强（搜索 + 过滤 + 预览）

### 目标
Session 面板从纯列表升级为可搜索、可过滤的 picker

### 8A. 对比事实

**CCB：** `LogSelector.tsx`（1237 行）
- SearchBox 组件实时搜索
- 分支过滤（Ctrl+B）、worktree 过滤（Ctrl+W）
- Ctrl+V 预览模式（`SessionPreview.tsx` 渲染历史消息）
- 时间分组（Today / Yesterday / This Week）

**Linghun：** `SessionsPanel.tsx`（约 100 行）
```tsx
// 纯列表：↑↓ 移动 + Enter 恢复 + Esc 关闭
// 无搜索、无过滤、无预览
```

### 8A. 动作

1. SessionsPanel 添加搜索输入行（简化版 SearchBox）
2. 添加 `/` 键进入搜索模式
3. 添加 Ctrl+V 预览选中 session（渲染前 10 条消息摘要）
4. 时间分组标题（Today / Yesterday / Older）

### 验证方式

- `/sessions` 打开后面板有搜索框
- 输入文本可过滤 session 列表
- Ctrl+V 预览选中 session

---

## 阶段 9：Compact 边界标记

### 目标
对话压缩后插入可视化边界标记

### 9A. 对比事实

**CCB：** `CompactBoundaryMessage.tsx`
```tsx
// 渲染一条 dim 消息："Conversation summarized to free up context"
// 显示压缩方向、消息数、上下文窗口使用率
```

**Linghun：** 无

### 9A. 动作

1. 在对话压缩发生时，插入一条 dim compact 边界消息到 transcript
2. 显示：压缩了多少条消息、释放了多少 context

### 验证方式

- 长对话触发自动压缩后，transcript 中出现边界标记

---

## 阶段 10：Context 可视化（/context 命令输出增强）

### 目标
`/context` 命令输出从文本摘要升级为可视化分布图

### 10A. 对比事实

**CCB：** `ContextVisualization.tsx` + `ContextSuggestions.tsx`
- Token 分布条形图（system / messages / tools / cache 各占比例）
- 上下文优化建议（可节省 token 数、严重度图标）

**Linghun：** 无独立可视化——`/context` 输出由 CommandPanel 渲染为文本

### 10A. 动作

1. `/context` 输出增加 token 分布条形图（使用 `─` 和 `█` 字符绘制）
2. 添加上下文优化建议列表（如果 context 使用率高）

### 验证方式

- `/context` 显示各分区 token 占比条形图
- context 使用率 >80% 时显示优化建议

---

## 阶段 11：配色体系对齐

### 目标
从 17 token + chalk 颜色名升级到语义化分层配色

### 11A. 对比事实

**CCB：** `src/utils/theme.ts` — 82 个颜色 token，RGB 精确色值
```ts
// 关键分层：
success: 'rgb(78,186,101)'   // 成功 — 绿色
error: 'rgb(255,107,128)'     // 错误 — 红色
warning: 'rgb(255,193,7)'    // 警告 — 黄色
claude: 'rgb(215,119,87)'    // 品牌 — 橙色
suggestion: 'rgb(177,185,249)' // 建议 — 淡蓝紫
permission: '...'             // 权限 — 品红
subtle: 'rgb(80,80,80)'      // 次级文本 — 深灰
inactive: 'rgb(153,153,153)' // 非活跃 — 中灰
// 6 主题：dark / light / dark-daltonized / light-daltonized / dark-ansi / light-ansi
```

**Linghun：** `packages/tui/src/shell/theme.ts` — 17 个 token，chalk 颜色名
```ts
// 当前分层：
accent: "cyan"        // 强调
muted: "gray"         // 弱化（替代 inactive）
border: "gray"
warning: "redBright"
dim: "gray"
permission: "magenta"
error: "red"
success: "green"
// 缺少 suggestion, subtle, inactive 语义层
// 3 模式：dark / light / no-color
```

### 11A. 行为边界
- **参考行为：** CCB 的 suggestion/subtle/inactive 语义分层，RGB 精确色值方案
- **自研行为：** 保留 Linghun 现有 token 名称不变，新增 `subtle`、`inactive`、`suggestion` 分层
- **新增：** 无新文件，在 `theme.ts` 中扩展

### 11A. 动作

1. `theme.ts` ShellTheme 类型新增字段：`subtle`、`inactive`、`suggestion`
2. dark 模式：suggestion=`"blueBright"`, subtle=`"gray"`, inactive=`"gray"` dim
3. light 模式：suggestion=`"blue"`, subtle=`"gray"`, inactive=`"gray"` dim
4. 替换 ProductBlock/StatusFooter 中 `theme.muted` → `theme.inactive`（次级信息）
5. 替换 status line 中 `theme.muted` → `theme.subtle`（背景信息）

### 验证方式
- dark/light/no-color 三种模式均不崩
- 新增 token 在渲染中实际生效

---

## 阶段 12：工具输出摘要格式对齐

### 目标
`formatPrimaryToolLead` 摘要行从"统计先行"改为 CCB `SearchResultSummary` 的"动词+数字"格式

### 12A. 对比事实

**CCB：** `SearchResultSummary` + `FileReadTool/UI.tsx`
```tsx
// Grep: "Found 5 lines" (bold 数字, 单复数 line/lines)
// Read: "Read 42 lines" (bold 数字)
// Glob: "Found 3 files" (bold 数字)
// FileRead: "Read 128 lines" / "Read image (2.3MB)" / "Read PDF (1.5MB)"
```

**Linghun：** `tool-output-presenter.ts:101-125` formatPrimaryToolLead
```ts
// Grep: "搜索摘要：5 处。"  /  "Search summary: 5 match(es)."
// Read: "读取摘要：42 行。"  /  "Read summary: 42 line(s)."
// Glob: "文件搜索摘要：3 个文件。" / "File search summary: 3 file(s)."
// Bash: "Bash 已结束：退出码 0。" / "Bash finished: exit code 0."
```

### 12A. 行为边界
- **参考行为：** CCB 的 `"Found {N} {lines/files/matches}"` 格式 + bold 数字 + 单复数
- **自研行为：** 保留中英双语切换能力
- **新增：** 无新文件，修改 `formatPrimaryToolLead` 输出格式

### 12A. 动作

1. `tool-output-presenter.ts:101-125` formatPrimaryToolLead 改为动词+数字格式：
   - Grep：→ `"找到 5 处匹配"` / `"Found 5 matches"`
   - Read：→ `"读取 42 行"` / `"Read 42 lines"`
   - Glob：→ `"找到 3 个文件"` / `"Found 3 files"`
   - Bash：→ 移除摘要行，exitCode 移到 tail 区
2. 数字部分用 markdown `**N**` 标记给下游 bold 渲染
3. Bash 的 `formatBashEndSummary` 独立行 `"命令已退出 0"` 合并到输出流末行（对齐 CCB）

### 验证方式
- 执行 Read/Grep/Glob/Bash，确认摘要行格式变更
- 中英双语均正确

---

## 阶段 13：代码块渲染对齐

### 目标
代码块从 box-drawing 边框改为行号 gutter 风格

### 13A. 对比事实

**CCB：** `HighlightedCode.tsx`
```tsx
// 左侧 lineNumber gutter（NoSelect 保护，不可选中）
// 代码行 color-diff-napi 语法高亮 + Ansi 组件渲染
// dimmed 模式：dimColor 整体淡化
// LRU 缓存 ColorFile 实例
```

**Linghun：** `MessageMarkdown.tsx:371-411` renderCodeBlock
```tsx
// ┌ {lang}
// | {line1}
// | {line2}
// └
// 顶部/底部/每行前缀用 box-drawing 字符（dim 色）
// cli-highlight 着色
// diff +/- 行用 success/error 色
```

### 13A. 行为边界
- **参考行为：** CCB 的行号 gutter + 无边框风格
- **自研行为：** 不引入 `color-diff-napi`（原生依赖），保留 `cli-highlight` 着色
- **新增：** 无新文件，修改 `MessageMarkdown.tsx` 的 `renderCodeBlock`

### 13A. 动作

1. `MessageMarkdown.tsx:371-411` renderCodeBlock 移除 `┌ │ └` box-drawing 边框
2. 改为行号 gutter：`  1 │ ` 前缀（dim 色），paddingLeft=0
3. 代码行无额外前缀，直接着色

### 验证方式
- Markdown 代码块显示行号无边框
- diff +/- 颜色保留

---

## 阶段 14：消息时间戳

### 目标
用户消息旁显示时间戳（按时间梯度格式化）

### 14A. 对比事实

**CCB：** `formatBriefTimestamp` + `UserPromptMessage`
```tsx
// 当天：仅时间 "14:32"
// 6天内：星期 "Mon 14:32"
// 更早：完整日期 "2026-01-15 14:32"
// 渲染位置："You" 标签旁 dim 色
```

**Linghun：** ProductBlock 明确不渲染时间戳
```tsx
// ProductBlock.tsx:84 — "不引入全局序号或时间戳（避免依赖外部状态 / 假数据）"
// ProductBlockViewModel 无 timestamp 字段
```

### 14A. 行为边界
- **参考行为：** CCB 的 `formatBriefTimestamp` 时间梯度 + dim 色 + "You" 标签旁
- **自研行为：** 在 ProductBlockViewModel 中新增 `timestamp` 字段，view-model 注入
- **新增：** `formatBriefTimestamp` 工具函数（新建或追加到现有 text-utils）

### 14A. 动作

1. `types.ts` ProductBlockViewModel 新增 `timestamp?: number`
2. 新建 `formatBriefTimestamp` 函数（或追加到 `text-utils.ts`）
3. ProductBlock.tsx user_text 分支：在 `│ ` 行首追加 `HH:MM ` dim 时间戳
4. view-model.ts 创建 block 时传入消息时间戳

### 验证方式
- 用户消息旁显示 dim 时间戳
- 时间梯度格式化正确

---

## 阶段 15：错误恢复/重试 UI

### 目标
API 错误/工具失败时显示倒计时重试提示

### 15A. 对比事实

**CCB：** `SystemAPIErrorMessage.tsx`
```tsx
// "Retrying in 12 seconds… (attempt 3/5)"
// useInterval 每秒更新倒计时
// 前 3 次 retryAttempt < 4 时隐藏（降噪）
// truncate 时 CtrlOToExpand
// API_TIMEOUT_MS 环境变量提示
```

**Linghun：** ProductBlock.tsx tool_result_error
```tsx
// 仅展示错误文本 + fail marker ✗
// 无倒计时、无重试尝试、无降噪策略
```

### 15A. 行为边界
- **参考行为：** CCB 的倒计时 + 尝试 N/M + 前 N 次降噪
- **自研行为：** 在 `tool_result_error` block 中扩展渲染逻辑
- **新增：** 无新文件，修改 ProductBlock.tsx 中 tool_result_error 分支 + view-model 传参

### 15A. 动作

1. ProductBlockViewModel 新增 `retrySeconds?: number`、`retryAttempt?: number`、`retryMax?: number`
2. ProductBlock.tsx tool_result_error 分支：若有 retrySeconds > 0，追加 `"Retrying in {N}s… (attempt {n}/{m})"` dim 行
3. 前 3 次重试隐藏（对齐 CCB 降噪策略）

### 验证方式
- API 错误时显示倒计时
- 前 3 次重试不显示

---

## 阶段 16：快捷键行内提示

### 目标
在 Footer/Composer 区域增加行内快捷键提示

### 16A. 对比事实

**CCB：** `KeyboardShortcutHint` 组件范式，78+ 处行内嵌入
```tsx
// Footer: "? for shortcuts"
// StatusLine: "esc to interrupt"
// Task pill: "ctrl+t to show/hide tasks"
// Agent: "ctrl+x ctrl+k to stop"
```

**Linghun：** 所有快捷键集中在 `ShortcutPanel` 面板，无行内提示

### 16A. 行为边界
- **参考行为：** CCB 的行内 dim 快捷键提示位置和密度
- **自研行为：** 在 StatusFooter/Composer 中嵌入关键快捷键提示
- **新增：** 无新文件，扩展现有组件

### 16A. 动作

1. StatusFooter 追加 dim 行内提示：`"Esc 中断 · Ctrl+T 任务 · ? 快捷键"`
2. Composer 空输入态追加 dim 提示行
3. Agent Tree 运行中追加 `"Ctrl+X Ctrl+K 停止"`

### 验证方式
- StatusFooter 有空状态快捷键提示
- 多 agent 运行时显示停止快捷键

---

## 阶段 17：WebSearch/WebFetch 专用 UI

### 目标
WebSearch/WebFetch 从通用 ProductBlock 渲染改为专用紧凑格式

### 17A. 对比事实

**CCB：** `WebSearchTool/UI.tsx` + `WebFetchTool/UI.tsx`
```tsx
// WebSearch: "Did 3 searches in 2.3s"
// WebFetch: "Received 15KB (200 OK)"
// 进度: "Searching: {query}" / "Fetching…"
```

**Linghun：** 走通用 `ProductBlock` -> `MessageMarkdown`，无专用格式

### 17A. 行为边界
- **参考行为：** CCB 的搜索次数+耗时、fetch 大小+状态码格式
- **自研行为：** 在 `formatPrimaryToolLead` 中为 WebSearch/WebFetch 增加专用分支
- **新增：** 无新文件，修改 `tool-output-presenter.ts`

### 17A. 动作

1. `tool-output-presenter.ts` formatPrimaryToolLead 新增 WebSearch/WebFetch 分支
2. WebSearch：`"执行 3 次搜索 · 2.3s"` / `"Did 3 searches in 2.3s"`
3. WebFetch：`"收到 15KB · 200 OK"` / `"Received 15KB · 200 OK"`

### 验证方式
- WebSearch/WebFetch 工具输出使用专用格式

---

## 阶段 18：MCP 工具输出结构化展示

### 目标
MCP 工具输出从通用 ProductBlock 升级为结构化解析展示

### 18A. 对比事实

**CCB：** `MCPTool/UI.tsx` (357 行)
```tsx
// renderToolResultMessage:
//   trySlackSendCompact → Slack 消息合并压缩
//   tryUnwrapTextPayload → 主导文本载荷展开
//   tryFlattenJson → JSON 键值对齐
//   MCPTextOutput → 三种输出策略
// 大响应 token 警告 (>10K tokens)
// 进度百分比展示
```

**Linghun：** `tool-output-presenter.ts` formatPrimaryToolLead
```tsx
// MCP 工具走 default 分支：`"{name} 摘要：{summary}"`
// 无结构化解包、无大响应警告、无进度百分比
```

### 18A. 行为边界
- **参考行为：** CCB 的 tryUnwrapTextPayload / tryFlattenJson 策略
- **自研行为：** Linghun 自有 MCP 协议层（connector-runtime / mcp-sse-runtime），UI 层新增解析
- **新增：** `tool-output-presenter.ts` 中为 MCP 工具新增专用格式化分支

### 18A. 动作

1. `tool-output-presenter.ts` formatPrimaryToolLead 新增 MCP 分支
2. 尝试 JSON 结构化解包：有 text/content 字段则展开为正文
3. 大响应（>10K 字符）追加 `"⚠ 大响应 · N tokens"` 警告
4. 保留 `{name} 摘要` fallback

### 验证方式
- MCP 工具 `tool_output` 有 text/content 时展开显示
- 大响应显示 token 警告

---

## 阶段 19：远程连接状态指示器

### 目标
Footer 中显示远程连接状态

### 19A. 对比事实

**CCB：** `PromptInputFooterLeftSide.tsx:328-356`
```tsx
// remoteSessionUrl 存在时渲染 "● remote" 链接 (蓝色)
// 远程模式下权限指示器隐藏 (!getIsRemoteMode())
```

**Linghun：** `StatusFooter.tsx:34-115`
```tsx
// 左：permissionMode + cyclePermHint
// 右：model · cache · index · git · context
// 无 remote 状态指示
```

### 19A. 行为边界
- **参考行为：** CCB 的 `● remote` 链接指示器
- **自研行为：** 在 StatusFooter 右侧追加 remote 状态段
- **新增：** 无新文件，修改 `StatusFooter.tsx`

### 19A. 动作

1. StatusFooter 右侧新增 remote 状态段：`"● remote"` dim 色
2. 从 view-model 传入 `remoteSessionUrl` 或 `isRemoteMode` 状态
3. 远程模式下权限模式指示器 dim 切换

### 验证方式
- 远程连接时 Footer 显示 `● remote`
- 无远程连接时不显示

---

## 实施顺序（最终）

```
阶段 1  (视觉去卡片化 + 全量显示)  ← 低风险
  ↓
阶段 11 (配色体系对齐)              ← 低风险
  ↓
阶段 12 (工具输出摘要格式)          ← 低风险
  ↓
阶段 2  (进度反馈专业化)            ← 低风险
  ↓
阶段 3  (Agent Tree 布局对齐)       ← 中风险
  ↓
阶段 4  (Modal 全屏覆盖)            ← 中风险
  ↓
阶段 5  (Footer 分层 + Eviction)    ← 低风险
  ↓
阶段 19 (远程连接状态指示器)        ← 低风险
  ↓
阶段 16 (快捷键行内提示)            ← 低风险
  ↓
阶段 14 (消息时间戳)                ← 低风险
  ↓
阶段 7  (Task 展示专业化)           ← 中风险
  ↓
阶段 8  (Session 面板增强)          ← 中风险
  ↓
阶段 13 (代码块渲染对齐)            ← 低风险
  ↓
阶段 18 (MCP 工具输出结构化)        ← 中风险
  ↓
阶段 17 (WebSearch/WebFetch UI)     ← 低风险
  ↓
阶段 9  (Compact 边界标记)          ← 低风险
  ↓
阶段 10 (Context 可视化)            ← 低风险
  ↓
阶段 15 (错误恢复/重试 UI)          ← 低风险
  ↓
阶段 6  (滚动原生化)                ← 高风险，最后做
```

每个阶段独立验证，完成后输出验证结果文档到 `docs/delivery/visual-alignment-phase-N.md`。

每个阶段独立验证，完成后输出验证结果文档到 `docs/delivery/visual-alignment-phase-N.md`。
