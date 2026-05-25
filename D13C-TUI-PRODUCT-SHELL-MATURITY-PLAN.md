# D.13C TUI Product Shell Final Maturity Alignment — 方案（修正版）

---

## 一、源码事实清单

### 1. CCB 输入和 cursor 所有权

- 完全自定义实现：`REPL` → `PromptInput`（状态层，持有 input + cursorOffset）→ `TextInput`（逻辑层，useTextInput hook）→ `BaseTextInput`（渲染层）。
- 光标由 `useState<number>` 管理，通过 `useDeclaredCursor` 将终端物理光标停放在插入点（支持 IME）。
- 多行始终启用，上下箭头先尝试行内移动，仅首/末行时触发历史导航。
- 全屏模式用 `FullscreenLayout`：可滚动消息区 + 底部固定输入区 + Footer。
- Footer 左右两栏：左=模式/退出提示/vim/权限，右=通知/连接状态。
- 支持 vim mode、外部编辑器、粘贴检测、viewport windowing（超出可见行数时滚动）。

### 2. OpenCode / Warp 参考原则

- **OpenCode**：Web GUI（SolidJS + contenteditable），非终端 TUI。参考价值：结构化 Prompt（ContentPart[]）、IME composing 检测、历史导航仅在光标首/末位时触发。
- **Warp**：Rust GUI 终端。参考价值：
  - 输入区是独立 editor 实例，与输出区完全分离
  - 三种输入布局模式（PinnedToBottom/PinnedToTop/Waterfall）
  - 双击确认退出防误操作
  - InputBufferModel 订阅模式（解耦输入视图和消费者）

### 3. LingHun 当前输入所有权

| 模式 | 输入 owner | 机制 | 文件 |
|------|-----------|------|------|
| Ink | `Composer` 组件 | `useInput` hook + 自定义 `EditBuffer`（chars[] + cursor） | `shell/components/Composer.tsx` |
| Plain | 外部 readline | plain-renderer 只输出，不处理输入 | `shell/plain-renderer.ts` |

- Composer 是唯一的 Ink 模式 cursor owner（ShellApp.tsx 注释："single cursor owner for entire shell"）。
- `ShellController.onInput` 是 Composer → 业务逻辑的唯一通道。
- Permission pending 时 Composer 仍然是输入捕获者，用户 y/n 通过 Composer submit → controller 路由。

### 4. handleComposerInput 事实（修正）

- **位置**：`Composer.tsx` 第 453-482 行，不在 index.ts。
- **注释**：`"Legacy compatibility: handleComposerInput for tests that use the old API"`。
- **性质**：export 导出的兼容性 shim，供旧测试代码使用。真实 Composer 使用 buffer model 直接操作。
- **差异**：不支持光标位置、Home/End/Ctrl+U/K/W/方向键/历史导航。backspace 只删末尾字符。
- **结论**：不是死代码（被测试引用），但不参与运行时渲染逻辑。不能随意删除。

### 5. terminal-capability.ts 事实（修正）

| 环境 | 检测结果 | 模式 |
|------|----------|------|
| Windows Terminal (WT_SESSION) | modern | Ink |
| VS Code / WezTerm / Alacritty (Windows) | modern | Ink |
| ConEmu / mintty / MSYSTEM | basic | Ink |
| **Win10 build 17763+ (1809+) 无 WT_SESSION** | **basic** | **Ink** |
| Win10 build < 17763 | legacy | Plain |
| TERM=dumb / 非 TTY | legacy | Plain |
| LINGHUN_TUI_PLAIN=1 | — | Plain (强制) |

- basic tier 能力：unicodeBox=true, cjkWide=true, richColor=true, cursorPositioning=true, alternateScreen=true。
- 只有 `cursorPositioning === false`（legacy）才回退 plain。
- 缓存在模块级变量，`resetTerminalCapabilityCache()` 供测试重置。

### 6. StatusTray 窄屏事实（修正）

- 窄屏 <60 丢弃 index 项但保留 background 是 **D.12B 已有设计决策**。
- 理由：background task 状态对用户操作有即时影响（任务在跑），index 状态相对静态。
- **不得默认改为 index 优先**。

---

## 二、成熟度矩阵

### Home

| 维度 | 当前源码事实 | 参考源事实 | 是否达标 | 不达标风险 | 需要改动 | 需真实 smoke |
|------|-------------|-----------|---------|-----------|---------|-------------|
| 布局 | 垂直居中（flexGrow 1:2），响应式 wordmark（>=80/>=60/<60） | CCB: FullscreenLayout 可滚动区+底部固定 | ✅ 达标 | — | 否 | 是 |
| Composer 位置 | 居中区域内，上下 cyan 边线 | CCB: 底部固定 borderStyle="round" | ✅ 达标（不同设计，合理） | — | 否 | 是 |
| StatusTray | project/model/permission/index/background，窄屏丢 index 保 background | CCB: Footer 左右两栏 | ✅ 达标 | — | 否 | 是 |
| setupHint | Home 首屏不显示（有意设计，延迟到 Enter 后） | CCB: 无对应（CCB 不做 first-run 引导） | ⚠️ 可改进 | 新用户首屏可能困惑 | P2 可选 | 是 |
| placeholder | 灰色显示 view.composer.placeholder | CCB: 同样灰色 placeholder | ✅ 达标 | — | 否 | 是 |

### Task

| 维度 | 当前源码事实 | 参考源事实 | 是否达标 | 不达标风险 | 需要改动 | 需真实 smoke |
|------|-------------|-----------|---------|-----------|---------|-------------|
| 布局 | 顶栏(brand+status) + separator + activity + permission + output + 底部 Composer | CCB: 可滚动消息区 + 底部固定输入 | ✅ 达标 | — | 否 | 是 |
| ActivityIndicator | phase 映射颜色：thinking/tool_running=yellow, error=red, completed=cyan | CCB: Spinner 组件 | ✅ 达标 | — | 否 | 是 |
| PermissionPrompt | borderStyle="single" 卡片，显示 toolName/risk/reason/scope/hint | CCB: permissionStickyFooter | ✅ 达标 | — | 否 | 是 |
| ProductBlocks | 保留最近 3 条（D.12B P1-1） | CCB: MessageList 全量 | ✅ 达标（TUI 限制合理） | — | 否 | 是 |

### Composer（输入组件）

| 维度 | 当前源码事实 | 参考源事实 | 是否达标 | 不达标风险 | 需要改动 | 需真实 smoke |
|------|-------------|-----------|---------|-----------|---------|-------------|
| 光标位置 | EditBuffer chars[] + cursor int，getCursorLinePosition 计算行列，useCursor 定位终端光标 | CCB: useState<number> + useDeclaredCursor | ✅ 达标 | — | 否 | 是（CJK） |
| CJK/宽字符 | charWidth 函数逐字符计算显示宽度，cursorCol 累加 charWidth | CCB: Cursor.fromText() 工具类 | ✅ 达标 | — | 否 | 是（中文输入） |
| 多行输入 | Shift+Enter 插入 \n，最多显示 5 行，超出截断显示 "... N line(s) above" | CCB: 多行始终启用，viewport windowing | ✅ 达标 | — | 否 | 是 |
| 历史上下 | InputHistory（entries/position/draft），Up/Down 导航，去重连续相同，MAX=100 | CCB: 首/末行时触发历史，否则行内移动 | ⚠️ 差异 | LingHun Up/Down 直接触发历史，不区分多行内光标位置 | P2 可选 | 是 |
| Home/End | Ctrl+A → cursor=0，Ctrl+E → cursor=chars.length | CCB: 同 | ✅ 达标 | — | 否 | — |
| Backspace/Delete | backspace 删光标前字符，delete 删光标处字符 | CCB: 同 | ✅ 达标 | — | 否 | — |
| Ctrl+U | 清除整行（chars=[], cursor=0） | CCB: 同 | ✅ 达标 | — | 否 | — |
| Ctrl+K | 删除光标到行尾 | CCB: 同 | ✅ 达标 | — | 否 | — |
| Ctrl+W | 删除光标前一个单词（同 Ctrl+Backspace） | CCB: 同 | ✅ 达标 | — | 否 | — |
| Word jump | Ctrl/Meta+Left/Right，isWordBoundary 正则 `/[\s\p{P}]/u` | CCB: 同 | ✅ 达标 | — | 否 | — |
| Escape | 清空 buffer，发送 escape 事件 | CCB: 无（CCB 用 Esc 做其他事） | ✅ 达标 | — | 否 | — |
| Resize | stdout resize 事件 + 60ms 防抖 + clear + rerender | CCB: Ink 内置 resize | ✅ 达标 | — | 否 | 是 |
| placeholder | 空输入时灰色显示，cursor 定位在 "> " 后 | CCB: 同 | ✅ 达标 | — | 否 | 是 |

### Startup / first-run / new repo

| 维度 | 当前源码事实 | 参考源事实 | 是否达标 | 不达标风险 | 需要改动 | 需真实 smoke |
|------|-------------|-----------|---------|-----------|---------|-------------|
| 无 provider | setupNeeded=true，Home 不显示 hint，Enter 后引导 | CCB: 无对应 | ✅ 达标（有意设计） | 新用户可能不知道按 Enter | P2 可选（placeholder 文案） | 是 |
| 新 repo | 无特殊处理，正常进入 Home | CCB: 同 | ✅ 达标 | — | 否 | — |
| first-run | 同 no provider 路径 | — | ✅ 达标 | — | 否 | 是 |

### Permission pending

| 维度 | 当前源码事实 | 参考源事实 | 是否达标 | 不达标风险 | 需要改动 | 需真实 smoke |
|------|-------------|-----------|---------|-----------|---------|-------------|
| 输入 ownership | Composer 始终是唯一捕获者，y/n 通过 submit → controller 路由 | CCB: permissionStickyFooter + 输入仍在 PromptInput | ✅ 达标 | — | 否 | 是 |
| 视觉提示 | PermissionPrompt bordered card，显示 toolName/risk/reason | CCB: 同 | ✅ 达标 | — | 否 | 是 |
| 取消/拒绝 | Escape 清空 buffer 发 escape 事件 | CCB: 无 Escape 取消 | ✅ 达标 | — | 否 | — |

### Model setup / apiKey masking

| 维度 | 当前源码事实 | 参考源事实 | 是否达标 | 不达标风险 | 需要改动 | 需真实 smoke |
|------|-------------|-----------|---------|-----------|---------|-------------|
| masking | view.composer.masking=true 时显示 `*` 替代字符，数量与实际输入一致 | CCB: 无对应（CCB 不做 TUI 内 setup） | ✅ 达标 | — | 否 | 是 |
| 光标 in masking | cursorCol 计算使用 masked 字符串（每个 `*` 宽度=1），光标位置正确 | — | ✅ 达标 | — | 否 | 是 |
| setup 流程 | pendingModelSetup.step="apiKey" 触发 masking | — | ✅ 达标 | — | 否 | 是 |

### Plain fallback

| 维度 | 当前源码事实 | 参考源事实 | 是否达标 | 不达标风险 | 需要改动 | 需真实 smoke |
|------|-------------|-----------|---------|-----------|---------|-------------|
| 判定逻辑 | LINGHUN_TUI_PLAIN=1 / TERM=dumb / 非 TTY / cursorPositioning=false | — | ✅ 达标 | — | 否 | 是 |
| Home 渲染 | 字符串拼接 + topPad 居中，placeholder 4空格缩进 dim | — | ✅ 达标 | — | 否 | 是 |
| Task 渲染 | 顶栏 + 分隔线 + activity + permission card (box-drawing) + output | — | ✅ 达标 | — | 否 | 是 |
| Unicode 降级 | capability.unicodeBox=false 时 `─`→`-`，`│`→`|` | — | ✅ 达标 | — | 否 | 是 |
| no-color | themeMode="no-color" 时 ASCII 标签 [OK]/[FAIL] | — | ✅ 达标 | — | 否 | 是 |
| placeholder 对齐 | 不带 "> " 前缀（注释说明避免 double input），真实 readline prompt 由外部追加 | — | ⚠️ 需确认 | 如果外部 readline prompt 格式变化可能错位 | P1 需确认 | 是（必须） |

### Windows Terminal / PowerShell / cmd in WT / forced plain

| 环境 | 预期 tier | 预期模式 | 当前源码支持 | 需真实 smoke |
|------|-----------|----------|-------------|-------------|
| Windows Terminal (WT_SESSION) | modern | Ink | ✅ | 是 |
| PowerShell in WT | modern | Ink | ✅ | 是 |
| cmd in WT | modern | Ink | ✅ | 是 |
| PowerShell 独立 (Win10 1809+) | basic | Ink | ✅ | 是 |
| cmd 独立 (Win10 1809+) | basic | Ink | ✅ | 是 |
| pre-1809 conhost | legacy | Plain | ✅ | 需模拟 |
| LINGHUN_TUI_PLAIN=1 | — | Plain (强制) | ✅ | 是 |
| TERM=dumb | legacy | Plain | ✅ | 是 |

---

## 三、实现建议

### 必修 P0/P1

| # | 改动 | 文件 | 原因 |
|---|------|------|------|
| P1-1 | 确认 plain-renderer placeholder 与外部 readline prompt 的对齐在所有 plain 路径下正确 | `plain-renderer.ts` | 注释提到 "double input" 风险，需验证当前是否真实存在问题。如果 smoke 确认无问题则不改代码，只在报告中标注已验证。 |

### 可选 P2

| # | 改动 | 文件 | 原因 |
|---|------|------|------|
| P2-1 | Home placeholder 文案包含 "按 Enter 开始" 提示 | `view-model.ts` | 新用户首屏引导，setupNeeded=true 时 placeholder 可以更明确 |
| P2-2 | 多行输入时 Up/Down 先尝试行内移动，仅首/末行触发历史 | `Composer.tsx` | 对齐 CCB 行为，改善多行编辑体验 |

### 不建议改

| 项 | 原因 |
|----|------|
| handleComposerInput legacy shim | 被测试引用，不是死代码，删除会破坏测试 |
| StatusTray 窄屏优先级 | D.12B 已有设计决策，background 优先合理 |
| terminal-capability.ts 检测逻辑 | 已正确，Win10 1809+ 返回 basic 是正确行为 |
| Composer EditBuffer 内部 | 已成熟，keybindings 完整，CJK 处理正确 |
| ink-renderer.tsx 生命周期 | resize 防抖、unmount 清理、stream 防御已完备 |
| ShellApp.tsx 路由 | Home/Task/Pending 路由清晰 |
| theme.ts | 不做美化 |
| Permission pending 输入 ownership | Composer 始终是唯一 owner，设计正确 |
| apiKey masking | 实现正确，光标计算正确 |

### 必须真实终端 smoke 才能确认

以下项目无法通过单测验证，必须在真实终端中 smoke：

| # | 验证点 | 环境 | 方法 |
|---|--------|------|------|
| S1 | Home 渲染正确（wordmark + Composer + StatusTray） | WT / PowerShell / cmd in WT | 目视 |
| S2 | CJK 中文输入光标位置正确 | WT | 输入中文，观察光标是否对齐 |
| S3 | 多行输入（Shift+Enter）显示和截断正确 | WT | 输入 6+ 行，观察截断提示 |
| S4 | Resize 后重绘正确 | WT | 拖动窗口大小 |
| S5 | Permission card 显示 + y/n 输入正常 | WT | 触发权限请求 |
| S6 | apiKey masking 显示 `***` 且光标正确 | WT | 进入 model setup |
| S7 | Plain fallback Home/Task 渲染 | LINGHUN_TUI_PLAIN=1 | 目视 |
| S8 | Plain placeholder 与 readline prompt 不冲突 | LINGHUN_TUI_PLAIN=1 | 目视输入区是否有 double "> " |
| S9 | TERM=dumb 自动回退 plain | 设置 TERM=dumb | 确认不崩溃 |
| S10 | 窄屏 (<60 cols) StatusTray 正确丢弃 index 保留 background | WT 窄窗口 | 目视 |

---

## 四、结论

成熟度矩阵显示：

- **全部达标或可选改进**：没有 P0 级必修改动。
- **P1-1**：plain placeholder 对齐需要真实 smoke 确认，如果确认无问题则不改代码。
- **P2-1/P2-2**：可选改进，不影响功能正确性。
- **10 项必须真实终端 smoke**：这些无法通过单测覆盖。

---

**等待用户确认后再进入实现（如有）或直接进入 smoke 验证阶段。**
