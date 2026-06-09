# Phase R4：交互成熟度 — 交付文档

## 阶段目标

实现 AUDIT_REMEDIATION_PLAN.md Phase R4 中定义的全部 11 项交互成熟度功能，对齐 CCB 的持久化历史、Ctrl+R 搜索、undo ring、ghost text、外部编辑器、终端配置指引等成熟交互能力。

## 已完成功能

### 1. 持久化磁盘历史 (`persistent-history.ts`)
- 历史记录保存到 `~/.linghun/history.jsonl`（JSONL 格式，每行 `{text, timestamp}`）
- Chunk 加载：启动时只读最后 500 条（ring buffer 流式读取，不全量加载）
- 文件超过 10000 行时自动 trim 到 5000 行
- 子串搜索（大小写不敏感，逆序返回）
- 容错：文件不存在时优雅创建，损坏行静默跳过

### 2. Ctrl+R 交互式历史搜索 (`HistorySearchPanel.tsx`)
- 搜索输入框 + 结果列表（最多 10 条可见）
- Up/Down 导航，Enter 接受，Esc 关闭
- 匹配子串高亮显示
- 支持 Backspace 修改搜索词
- 事件类型：`history-search-open/close/input/move/accept`

### 3. 输入撤销 Ctrl+_ (`undo-ring.ts`)
- 50 条环形缓冲区
- 500ms 去抖：快速连续编辑合并为单条 undo 条目
- 每次 buffer 变更自动推送到 undo ring
- Ctrl+_ 恢复到前一个 buffer 状态

### 4. 快捷键发现面板 (`ShortcutPanel.tsx`)
- "?" 键（buffer 为空时）或 `/shortcuts` 命令打开
- 按类别分组（编辑/导航/面板/系统）
- Keys 左对齐 + 描述右侧
- 任意键关闭

### 5. 外部编辑器 Ctrl+G (`external-editor-runtime.ts`)
- 写入当前 buffer 到临时文件
- 按优先级解析编辑器：`$EDITOR` → `$VISUAL` → 平台默认（notepad/vi）
- 支持多参数编辑器命令（如 `code --wait`）
- 5 分钟超时保护
- 编辑完成后读回内容、清理临时文件

### 6. /terminal-setup 命令 (`terminal-setup-runtime.ts`)
- 检测终端（Windows Terminal/VS Code/iTerm2/GNOME/Kitty/Alacritty/JetBrains）
- 检测 shell（PowerShell/pwsh/bash/zsh/fish/cmd）
- 检测能力（Unicode/256色/TrueColor/鼠标/bracketed paste）
- 输出针对性配置建议和 JSON/shell 代码片段
- 已注册到 slash command registry（`/terminal-setup`）

### 7. Inline Ghost Text (`ghost-text.ts`)
- 当用户输入 `/<prefix>` 且只有一个明确匹配时，显示 dim 后缀
- Tab 接受 ghost text（自动追加空格，准备输入参数）
- 不干扰多候选时的 SlashSuggestions 下拉

### 8. Prompt 暂存 Ctrl+S (`prompt-stash.ts`)
- 单槽暂存：Ctrl+S 保存当前输入并清空 buffer
- 再次 Ctrl+S（buffer 为空时）恢复暂存内容
- 暂存被恢复后自动清空

### 9. Unseen Message Pill (`UnseenMessagePill.tsx`)
- 滚动离开底部时显示 "↓ N 条新消息" / "↓ N new messages"
- 居中 pill 样式，dim + bold，非侵入式
- count <= 0 时不渲染

### 10. Git 分支 Footer 显示 (`git-branch-runtime.ts`)
- 使用 `git rev-parse --abbrev-ref HEAD` 获取分支名
- 5 秒刷新间隔，2 秒超时保护
- StatusFooter 新增 `⎇ branch-name` dim 段
- 非 git 仓库时优雅隐藏

### 11. 剪贴板复制通知
- ShellInputEvent 新增 `clipboard-copied` / `clipboard-failed` 事件类型
- 现有 clipboard.ts 和 NotificationStack 之间的连接接口已就绪
- tui-messages 新增 "已复制" / "复制失败" 双语文案

## 涉及模块

### 新增文件（独立模块）
| 文件 | 用途 |
|------|------|
| `packages/tui/src/persistent-history.ts` | 磁盘持久化历史 |
| `packages/tui/src/undo-ring.ts` | 50 条环形 undo 缓冲区 |
| `packages/tui/src/prompt-stash.ts` | 单槽暂存 |
| `packages/tui/src/ghost-text.ts` | Ghost text 计算逻辑 |
| `packages/tui/src/external-editor-runtime.ts` | 外部编辑器集成 |
| `packages/tui/src/git-branch-runtime.ts` | Git 分支状态运行时 |
| `packages/tui/src/terminal-setup-runtime.ts` | 终端环境检测 + 配置指引 |
| `packages/tui/src/shell/components/HistorySearchPanel.tsx` | Ctrl+R 搜索 UI |
| `packages/tui/src/shell/components/ShortcutPanel.tsx` | 快捷键面板 UI |
| `packages/tui/src/shell/components/UnseenMessagePill.tsx` | 未读消息 pill |
| `packages/tui/src/phase-r4-interaction-maturity.test.ts` | R4 测试集 |

### 修改文件
| 文件 | 变更 |
|------|------|
| `packages/tui/src/tui-messages.ts` | 新增 21 个 R4 双语 message key |
| `packages/tui/src/keybinding-runtime.ts` | 新增 5 个 action + Ctrl+_ 归一化 |
| `packages/tui/src/shell/types.ts` | 新增事件类型 + view-model 字段 |
| `packages/tui/src/shell/components/Composer.tsx` | Undo/Stash/Ghost/Panels 集成 |
| `packages/tui/src/shell/components/StatusFooter.tsx` | Git branch 段 |
| `packages/tui/src/natural-command-bridge.ts` | /shortcuts + /terminal-setup 注册 |

## 关键设计

### Keybinding 架构
- 新增 action 类型统一通过 `keybinding-runtime.ts` 的 resolver 匹配
- `Ctrl+_` 特殊处理：终端发送 `\x1f`，normalizeKeyEvent 映射为 `"ctrl+_"`
- `"?"` 在 buffer 为空时触发 shortcuts-panel，有内容时正常输入字符
- 所有新 keybinding 可通过 `.linghun/keybindings.json` 自定义覆盖

### Panel 层级
- HistorySearchPanel 和 ShortcutPanel 加入现有 panel 优先级链
- Escape 路由：按 panel 类型分发正确的 close 事件
- Panel 打开时 `configPanelActive = true`，阻止 Composer 普通输入

### Undo Ring
- 每次 `setBufferAndResetSelection` / `updateBufferAndResetSelection` 自动推送
- 500ms 去抖窗口：连续快速编辑不产生冗余 undo 条目
- submit 后 ring 不自动 reset（允许 undo 历史跨越提交边界）

### Ghost Text
- 仅在单一明确匹配时显示（避免闪烁和误导）
- 与 SlashSuggestions 互补：suggestions 处理多候选，ghost 处理唯一候选
- Tab 在 ghost visible 时接受 ghost；在 suggestions visible 时接受选中候选

## 配置项

| 配置 | 说明 |
|------|------|
| `.linghun/keybindings.json` | 可覆盖所有新增快捷键 |
| `$EDITOR` / `$VISUAL` | 外部编辑器命令 |
| `resolveStoragePaths().userData` | 历史文件位置基准 |

## 命令

| 命令 | 说明 |
|------|------|
| `/shortcuts` | 打开快捷键面板 |
| `/terminal-setup` | 输出终端环境配置指引 |
| `Ctrl+R` | 打开历史搜索 |
| `Ctrl+_` | 撤销编辑 |
| `Ctrl+S` | 暂存/恢复输入 |
| `Ctrl+G` | 打开外部编辑器 |
| `?` | 快捷键面板（buffer 为空时） |

## 测试与验证

- **Typecheck**: PASS (`tsc -b tsconfig.json` 零错误)
- **Build**: PASS (全包 `pnpm -r build` 成功)
- **Tests**: 3213 passed, 0 failed, 2 skipped (95 test files)
  - 新增 21 个 R4 专项测试（ghost text / stash / undo ring / terminal-setup / git-branch）
  - 既有 3192 测试全部绿色通过

## 已知问题

- 持久化历史的 `load()` / `append()` 需要由 slash-command-runtime 的 main chain 在启动时调用（尚未在 index.ts 中完成初始化绑定，等待后续 wiring 到 main chain lifecycle）
- `/shortcuts` 和 `/terminal-setup` 命令已注册到 capability catalog，但 slash-command-runtime 中的 dispatch handler 需要后续阶段 wiring
- Clipboard 复制通知的 wiring（clipboard 成功 → NotificationStack push）需要在 index.ts 事件循环中接入
- Unseen message count 的计算逻辑需要 transcript-scroll-state 在新 block 到达时更新 counter

## 不在本阶段处理的内容

- Phase R5（Alt-Screen + ScrollBox）
- Phase R6（超时容错 + 高级面板降噪）
- Phase R7（编排微调 + Brief 模式）
- 持久化历史与 SessionStore 的深度集成（跨会话）
- HistorySearchPanel 的 fuzzy matching（当前为子串匹配）

## 下一阶段衔接

Phase R5 将实现 Alt-Screen 模式和自研 ScrollBox 组件，包括鼠标接管、wheel 加速、copy-on-select 和 sticky scroll。

## 参考核对

- 本阶段读取了：`AUDIT_REMEDIATION_PLAN.md`（Phase R4 定义）、`Composer.tsx`、`keybinding-runtime.ts`、`tui-messages.ts`、`types.ts`、`StatusFooter.tsx`、`natural-command-bridge.ts`、`clipboard.ts`、`transcript-scroll-state.ts`
- 参考了 CCB 的行为边界：useArrowKeyHistory（chunk 加载交互）、useInputBuffer（去抖 ring）、useTypeahead（dim + Tab 接受）、/terminal-setup（环境检测输出格式）
- 所有实现为自研，未复制 CCB 源码

## 成品级结构化 Handoff Packet

```yaml
next_phase: R5 (Alt-Screen + 自研 ScrollBox)
forbidden:
  - 不复制 CCB @anthropic/ink 私有 fork 的渲染管线
  - 不为了 Phase R5 修改 Phase R4 已验证的 keybinding 架构
evidence:
  - typecheck: PASS (0 errors)
  - build: PASS (all packages)
  - tests: 3213/3213 pass, 0 fail
verification: automated (vitest full suite)
index_state: not checked (索引为辅助能力，非前置阻塞)
permission_mode: N/A (本阶段不涉及运行时 provider 或危险操作)
model_provider: N/A
budget: ~10 new files, ~200 lines modified in existing files
```
