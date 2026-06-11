# TUI 成熟度整改计划

## Phase R1：噪音削减 + Bug修复

### 任务
1. 删除 `config-control-plane.ts`，ConfigPanel 直接 emit slash 命令
2. 删除 `footer-view.ts`，格式化内联到 StatusFooter
3. 删除 `task-suggestion.ts`，20行内联函数替代
4. 内联 `input-owner-controller.ts` 到 Composer（30行 if-chain）
5. 删除 Composer SGR wheel 死代码（646-656行）
6. 删除 "(内部运行时上下文已从主屏省略...)" 元噪音
7. 删除 NO_COLOR 限制行
8. Footer 精简：默认保留 权限模式 + 模型名称 + 费用；上下文/缓存/推理/索引 → /status
9. 权限说明行默认隐藏，仅 toolName+actionSummary，"d" 展开
10. 工具开始横幅非 verbose 默认抑制
11. Home vision 文本删除，保留单行 "LingHun"
14. **后台任务状态栏从默认 transcript 移除**：`■ 后台 9 · 需要确认 8 · 阻塞 1` + job 失败通知不应默认显示在主屏，移入 /background 或 Shift+Down overlay；仅 blocked/failed 时推送一条 transient notification
12. **Shift+Enter 修复**：`terminal-input-runtime.ts:47` 改 `key.shift || key.meta`
13. 底层适配 Enter+Shift：补 isMultilineEnterSequence 对 `\x1b\r` 的识别、Composer fallback 提示

### 自研要求
- Footer 格式化逻辑自研（内联到 StatusFooter）
- input 优先级 if-chain 自研（参考 CCB 的简洁分发模式，不复制实现）

### 对齐目标
CCB 默认零噪音 footer、零 vision 文本、权限一行摘要

### 验收标准
- 启动后 footer 仅三项信息（权限+模型+费用）
- /status 能看到完整指标
- Shift+Enter 在 Windows Terminal / VS Code 中插入换行
- Ctrl+J 在所有终端插入换行
- 删除文件后 build 通过、测试全绿
- `node apps/cli/dist/main.js` 启动正常

---

## Phase R2：视觉质量 + 输出渲染

### 任务
1. `cli-highlight` 作为 packages/tui 的 dependency 内置打包，MessageMarkdown CodeLine 按 lang 应用语法高亮
2. 替换手写 markdown 解析为 `marked.lexer()` + formatToken（标题/引用/链接/斜体/有序列表）
3. **表格渲染**：自适应列宽 + 行分隔符（┌─┬─┐）+ 多行 cell 垂直居中 + 超宽自动切换 vertical key-value 格式
4. LRU token 缓存（50-100条）
5. **动画 spinner + 状态变化**：
   - 100ms 动画帧 shimmer sweep（文字颜色脉冲）
   - 随机 verb 词库（"思考中…" / "分析中…" / "生成中…" 等 30+ 中文动词）
   - 停滞检测：3s 无新 token → 渐变变色（intensity 0→1 over 2s）
   - 工具运行中重置 timer（有 tool 活动不算停滞）
   - **30s 后才显示 token 计数**（避免短请求噪音）
   - thinking 模式：独立 glow 动画（呼吸灯效果）
6. Diff 着色：检测 lang="diff"，+/- 行 green/red
7. dark/light 主题对：`createShellTheme(mode)`，RGB 值，`LINGHUN_THEME` 环境变量检测
8. Composer 圆角边框：Ink Box `borderStyle="round"`
9. 权限焦点 inverse 属性
10. 用户消息 backgroundColor
11. **连续同类工具折叠**：连续 N 次 Read/Grep 折叠为一行 "Read 5 files"，展开可看详情
12. **流式输出光标**：文本生成末尾显示闪烁光标（▌）指示"还在写"
13. **对话轮次分隔**：用户/助手消息之间加 dim 分隔线或留白间隔，视觉层次分明
14. **上下文用量可视化条**：/status 面板中用进度条（██░░）代替纯数字显示 context 用量

### 自研要求
- markdown 渲染器自研（基于 marked lexer，需适配 streaming 边界检测）
- **表格渲染自研**（参考 CCB MarkdownTable 的列宽算法+vertical fallback 行为，不复制实现）
- shimmer spinner 自研（参考 CCB SpinnerAnimationRow 的三层状态+停滞阈值+verb 轮换，不复制实现）
- diff 着色自研（纯 TS + ANSI，不用 Rust NAPI）
- 主题系统自研（Linghun 品牌色 + 中文优先）
- **工具折叠自研**（参考 CCB GroupedToolUseContent/CollapsedReadSearchContent 的折叠触发条件和展开交互）
- **流式光标自研**
- **轮次分隔自研**（参考 CCB 用户消息 backgroundColor + 间距设计）

### 对齐目标
CCB 的 cli-highlight + marked + MarkdownTable + SpinnerAnimationRow + GroupedToolUse + 流式光标 + 轮次分隔 + 6 主题

### 验收标准
- 代码块有语法着色（至少 ts/js/python/json）
- markdown 标题/表格/引用正确渲染
- **表格有边框、自适应列宽、窄终端切换竖排**
- spinner 有动画闪烁，停滞时变色，verb 随机轮换
- **30s 后才显示 token 计数**
- diff 内容 +/- 行有颜色区分
- dark/light 可切换
- **连续 3+ 次同类工具调用折叠为一行**
- **生成中文本末尾有闪烁光标**
- **用户消息和助手消息之间有明确视觉分隔**
- **/status 中 context 用量有进度条**
- build 通过、测试全绿

---

## Phase R3：Task/Agent/Workflow 可视化

### 任务
1. **AgentProgressTree 组件**：树形结构 `├─`/`└─` 显示 agent 名称+状态+tool uses+tokens
2. **TaskListView 组件**：清单 UI（✓/■/□ 图标 + subject + owner + blocked-by）
3. **WorkflowProgressView 组件**：workflow 各步骤进度、当前阶段高亮
4. **BackgroundTaskOverlay**：快捷键（Shift+Down）弹出后台任务列表，支持导航/杀任务
5. **输出摘要折叠**：长工具输出超过阈值自动折叠，显示 "展开 N 行"
6. **智能截断**：超过 maxDisplay 时优先显示 in_progress + recent completed，尾部 `…+N pending`
7. **工具输出差异化渲染**：Bash 显示命令行，Read/Write 显示路径，Edit 显示 diff 摘要
8. **任务完成摘要**：agent/workflow 完成后自动生成结构化摘要（耗时、tool uses、tokens、结论），显示在 transcript 中

### 自研要求
- AgentProgressTree 自研（参考 CCB AgentProgressLine 的树形字符+颜色布局，不复制组件）
- TaskListView 自研（参考 CCB TaskListV2 的图标/颜色/截断逻辑，不复制排序算法）
- WorkflowProgressView 自研（参考 CCB WorkflowDetailDialog 的结构化字段布局）
- BackgroundTaskOverlay 自研（参考 CCB BackgroundTasksDialog 的列表→详情导航模式）
- 输出折叠/截断逻辑自研

### 对齐目标
CCB 的 AgentProgressLine 树形 + TaskListV2 清单 + BackgroundTasksDialog overlay + 工具结果差异化渲染

### 验收标准
- agent 运行时显示树形进度（名称 + tool count + token count）
- task 清单有状态图标、owner 颜色、阻塞关系
- workflow 显示当前步骤 + 已完成/待执行
- Shift+Down 弹出后台任务 overlay，可导航、可杀任务
- 长输出自动折叠，手动展开
- build 通过、测试全绿

---

## Phase R4：交互成熟度

### 任务
1. 持久化磁盘历史 `~/.linghun/history.jsonl`，chunk 加载
2. Ctrl+R 交互式历史搜索（子串匹配 + 高亮）
3. 输入撤销 Ctrl+_（50条 undo ring，500ms 去抖）
4. 快捷键发现面板 "?" 或 /shortcuts
5. 外部编辑器 Ctrl+G（spawn $EDITOR + temp file）
6. `/terminal-setup` 命令：检测环境，输出 keybinding 配置指引
7. inline ghost text（slash 命令 dim 提示，Tab 接受）
8. prompt 暂存 Ctrl+S
9. unseen-message pill（滚动上移时 "N 条新消息"）
10. git 分支 footer 显示
11. 剪贴板复制通知

### 自研要求
- 持久化历史自研（需适配 .linghun/ 目录结构和会话模型）
- Ctrl+R 搜索面板自研（参考 CCB 的 chunk 加载 + 全文搜索交互，不复制 useArrowKeyHistory）
- undo ring 自研（参考 CCB useInputBuffer 的去抖 ring 行为边界）
- /terminal-setup 自研（参考 CCB 的环境检测逻辑和配置输出格式）
- ghost text 自研（参考 CCB useTypeahead 的 dim+Tab 接受交互）

### 对齐目标
CCB 的持久化历史 + Ctrl+R + undo ring + /terminal-setup + ghost text + @-mention

### 验收标准
- 退出重进后 Up 键能翻到上次输入
- Ctrl+R 弹出搜索框，命中高亮
- Ctrl+_ 撤销最近编辑
- "?" 显示当前可用快捷键
- /terminal-setup 输出当前环境的配置指引
- build 通过、测试全绿

---

## Phase R5：Alt-Screen + 自研 ScrollBox

### 任务
1. `useAlternateScreen` 改为可配置，`LINGHUN_FULLSCREEN=1` 默认启用
2. 自研 ScrollBox 组件：行级裁剪、scrollTop 直写、microtask 合并渲染、viewport culling
3. 鼠标接管：发送 SGR mouse enable（DEC 1000/1006），解析 wheel/click/drag 事件
4. App-owned 选中：鼠标拖选 → selection 状态 → copy-on-select 写剪贴板
5. Wheel 加速算法：区分 trackpad/mouse，40ms 窗口线性 ramp
6. Sticky scroll（自动跟随新内容）+ jump-to-bottom
7. 非 alt-screen fallback：保留键盘滚动 + 终端原生 wheel 路径

### 自研要求
- ScrollBox 完全自研（参考 CCB @anthropic/ink ScrollBox 的行级裁剪 + scrollTop 直写架构，不复制渲染管线）
- Wheel 加速算法自研（参考 CCB ScrollKeybindingHandler 的 40ms 窗口 + 设备区分行为）
- Copy-on-select 自研（参考 CCB useCopyOnSelect 的松开即复制行为边界）
- Alt-screen 管理自研（参考 CCB fullscreen.ts 的 tmux-CC 检测和环境兼容矩阵）

### 对齐目标
CCB 的 @anthropic/ink ScrollBox + useCopyOnSelect + wheel acceleration + fullscreen mode

### 验收标准
- alt-screen 模式下鼠标滚轮滚动 transcript
- 鼠标拖选文本松开自动复制
- 快速滚动有加速感
- 新内容自动跟随到底
- `LINGHUN_FULLSCREEN=0` 回退到终端原生行为
- build 通过、测试全绿

---

## Phase R6：超时容错 + 高级面板降噪

### 任务
1. **长请求容错**：circuit breaker open 时不直接 GG，显示"正在重试 (N/3)…"用户可见状态
2. **脚本/验证场景特殊处理**：Bash 工具运行中模型无需响应时，不触发 stream idle timeout
3. **重试 UI**：provider 429/503 时 spinner 显示 "限速等待中…Ns后重试"，不是静默等到超时
4. **优雅降级通知**：breaker open 后推送 transient notification "Provider 暂时不可用，45s 后重试"
5. **高级面板（/status）整合**：
   - 模型名 + context window 用量（Nk/Mk）
   - 费用累计
   - provider 健康状态（breaker state）
   - 缓存命中率
   - 推理级别
   - 索引状态
   - rate limit 信息（如 provider 返回 retry-after）
6. **高级面板降噪**：/status 默认折叠为摘要行，Enter 展开完整面板；不主动 push 到 transcript

### 自研要求
- 重试 UI 状态自研（参考 CCB withRetry 的重试计数+429/529 区分行为，不复制 retry 逻辑）
- 高级面板自研（参考 CCB BuiltinStatusLine 的分段布局+渐进隐藏，不复制组件）
- 长请求免超时自研（参考 CCB "hasActiveTools 时 timer 不计" 的行为边界）

### 对齐目标
CCB 的无硬超时 + withRetry 优雅重试 + BuiltinStatusLine 按需显示

### 验收标准
- 批量验证跑 60s+ 脚本时不会触发"模型没反应"
- provider 限速时 spinner 显示重试倒计时
- breaker open 后有用户可见通知而不是静默失败
- /status 显示完整面板，默认不污染 transcript
- build 通过、测试全绿

---

## Phase R7：编排微调 + Brief 模式

### 任务
1. Bash 子命令级解析器（管道/重定向/命令链独立分类）
2. 多工具调用合并确认 UX（同风险批量一次确认）
3. Agent handoff 安全审查（policy engine 规则化检查）
4. Brief 模式：`LINGHUN_TUI_BRIEF=1` 或 /brief（折叠 spinner、隐藏 thinking、抑制横幅）
5. Meta Scheduler 复杂度估计信号（防小任务过度工程化）

### 自研要求
- Bash 子命令解析器自研（参考 CCB subcommandResults 的管道/重定向识别行为边界）
- 合并确认 UX 自研
- Brief 模式自研（参考 CCB BriefMode 的折叠效果，不复制 KAIROS flag 系统）

### 对齐目标
CCB auto mode 零打断体验 + BriefMode

### 验收标准
- `ls | grep foo` 识别为两个子命令独立分类
- 连续 3 个同风险工具调用合并为 1 次确认
- brief 模式下 transcript 明显精简
- build 通过、测试全绿

---

## 执行规则

- 每个 Phase 完成后 rebuild（`pnpm build`），用 `node apps/cli/dist/main.js` 验证
- Phase 间不跨越，完成一个确认再进下一个
- 每个 Phase 完成后更新 `docs/delivery/` 交付文档
- 所有改动自研，参考 CCB 行为边界，不复制源码
- 每个 Phase 的自研组件独立成文件，不挤在现有大文件里
- **国际化适配**：所有用户可见文本必须走 `tui-messages.ts` 词典（`zh-CN` / `en-US`），新增的 spinner verb 词库、通知文本、面板标签、fallback 提示、状态文案、错误提示等均需双语条目。不允许硬编码中文或英文字符串到组件中
- **不准降级**：每个阶段必须按对比结论完整实现，不允许以"先简化/先跳过/后续补"为由降低标准
- **不在错误基础上继续**：审计发现的反人类设计（死代码、误导逻辑、无效路径）必须先清除再建新功能，不允许在错误前提上叠加
- **该新增模块就新增**：需要独立模块的能力（ScrollBox、MarkdownTable、ActivitySpinner、PersistentHistory 等）必须创建独立文件，不准挤进现有大文件凑合
- **对比驱动实现**：每个任务的实现标准以本文档对比结论为准，不是"能跑就行"而是"对齐 CCB 成熟度"
