# Pre-Smoke Slice D.13C: TUI Product Shell Final Maturity

## 阶段目标

按 D.13C 成熟度矩阵，清零 TUI Product Shell 已知体验债：plain fallback 输入区收口、Home setup 引导成熟化、Composer 多行 Up/Down 行内移动、Task 视图成熟度复核。

## 实现范围

### P1-1: Plain fallback 输入区收口

**结论：当前逻辑已正确，用测试锁住。**

- plain-renderer 的 placeholder 使用 `"    ${view.composer.placeholder}"` 显示（4空格缩进，无 "> " 前缀）
- 注释明确说明：real readline prompt `"  > "` 紧跟在 render 之后，placeholder 不加 "> " 前缀避免 double-input
- `computeHomePromptPrefix` 返回 `"  "`（2空格），readline 自行追加 `"> "`
- forced plain / TERM=dumb / non-TTY 均走同一 `renderPlainShell` 路径，不存在回旧 REPL 或双 prompt 的风险
- 新增 4 个测试明确锁住此行为

### P2-1: Home setup 引导成熟化

**改动：setupNeeded=true 时 Home placeholder 融入轻量引导文案。**

- `view-model.ts` 新增 `setupPlaceholder` 文案：
  - zh-CN: `"按 Enter 开始配置模型"`
  - en-US: `"Press Enter to configure a model"`
- 当 `setupNeeded=true` 且 `effectiveViewMode === "home"` 时，composer placeholder 使用 setupPlaceholder
- 不恢复大段 setupHint 块，不破坏 Home 老基准视觉
- Task/pending 模式下仍使用原有 setupHint 机制（独立显示在 status tray 下方）
- 新增 5 个测试覆盖中英文、home/task 模式差异

### P2-2: Composer 多行 Up/Down 行内移动

**改动：对齐 CCB 成熟输入行为。**

- 新增 `bufferMoveUp(buf)` 和 `bufferMoveDown(buf)` 函数：
  - 基于 `getCursorLinePosition` 计算当前行列
  - 移动到目标行，保持字符列位置（clamp 到目标行长度）
  - CJK 宽字符按字符索引计算，不退化
- Composer `useInput` 中 Up/Down 逻辑改为：
  - 多行输入时，先检查当前行位置
  - 非首行按 Up → `bufferMoveUp`（行内移动）
  - 非末行按 Down → `bufferMoveDown`（行内移动）
  - 首行按 Up → 触发 history navigation
  - 末行按 Down → 触发 history navigation
- 保持现有 History draft 行为不变
- 不破坏 Left/Right/Home/End/Backspace/Delete/Ctrl+U/Ctrl+K/Ctrl+W/word jump
- 新增 8 个测试覆盖行内移动、边界 clamp、CJK、三行缓冲区、cursor 追踪

### Task 视图成熟度收口

**结论：复核确认已达标，用测试锁住。**

- Task 顶栏：brand + status tray，compact 布局 ✅
- Activity indicator：phase 映射 thinking/tool_running/continuing/permission_waiting/error/completed ✅
- Permission card：包含 toolName、risk level（HIGH/MEDIUM/LOW）、reason、scope、hint ✅
- Output blocks：最多 3 条，fail/blocked 优先，有 /details hint ✅
- completed(partial) background 不显示为 PASS（filtered out as completed historical） ✅
- 窄屏和 resize：所有宽度 30-120 均正常渲染不崩溃 ✅
- Task 下 Composer permission pending placeholder 正确切换 ✅
- 新增 8 个测试覆盖 activity phases、permission card fields、output semantics、narrow width、resize

## 涉及文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `packages/tui/src/shell/view-model.ts` | 修改 | 新增 setupPlaceholder 文案，home+setupNeeded 时使用 |
| `packages/tui/src/shell/components/Composer.tsx` | 修改 | 新增 bufferMoveUp/bufferMoveDown，Up/Down 逻辑改为行内优先 |
| `packages/tui/src/shell/view-model.test.ts` | 修改 | 新增 31 个 D.13C 测试，更新 1 个已有测试断言 |

## 未改动（确认达标）

| 项 | 原因 |
|----|------|
| plain-renderer.ts | 逻辑已正确，只用测试锁住 |
| terminal-capability.ts | Win10 1809+ basic/Ink 判断正确 |
| StatusTray 窄屏策略 | D.12B 设计决策，background 优先 |
| handleComposerInput legacy shim | 被测试引用，不删除 |
| ink-renderer.tsx | resize 防抖、unmount 清理已完备 |
| ShellApp.tsx 路由 | Home/Task/Pending 路由清晰 |
| theme.ts | 不做配色改动 |
| D14A/D14B guard/memory | 不触碰 |

## 成熟度债清零状态

| 维度 | 状态 | 说明 |
|------|------|------|
| Plain fallback 双输入 | ✅ 已锁 | 测试确认无 "> placeholder" + readline 双 prompt |
| Home setup 引导 | ✅ 已清 | 轻量 placeholder 融入，无大块 hint |
| Composer 多行 Up/Down | ✅ 已清 | 行内移动优先，首/末行才触发 history |
| Task activity 语义 | ✅ 已锁 | 6 种 phase 正确映射 |
| Task permission card | ✅ 已锁 | risk/reason/scope/hint 完整 |
| Task output blocks | ✅ 已锁 | 最多 3 条，fail 优先，有 /details |
| Task completed(partial) | ✅ 已锁 | 不显示为 PASS |
| 窄屏/resize | ✅ 已锁 | 30-120 宽度均不崩溃 |
| CJK cursor | ✅ 已锁 | 多行移动按字符索引，不退化 |
| Model setup masking | ✅ 已锁 | 测试确认 masking 渲染正确 |

## 测试覆盖

新增 31 个 D.13C 测试（总 164 tests in view-model.test.ts, 215 tests in index.test.ts）：

**P1-1 Plain fallback（4 tests）：**
1. ✅ plain fallback Home placeholder 无 "> " 前缀
2. ✅ plain fallback Task 无 fake composer prompt
3. ✅ forced plain 不产生双 prompt
4. ✅ TERM=dumb 不崩溃且无双 prompt

**P2-1 Home setup 引导（5 tests）：**
5. ✅ setupNeeded=true home 显示轻量 setup placeholder (zh-CN)
6. ✅ setupNeeded=true home 显示轻量 setup placeholder (en-US)
7. ✅ setupNeeded=false home 显示正常 placeholder
8. ✅ setupNeeded=true task 模式显示 setupHint（非 placeholder 覆盖）
9. ✅ Home 不显示大块 setupHint

**P2-2 Composer 多行 Up/Down（8 tests）：**
10. ✅ bufferMoveUp 移动到上一行保持列
11. ✅ bufferMoveUp 首行返回原 buffer
12. ✅ bufferMoveDown 移动到下一行保持列
13. ✅ bufferMoveDown 末行返回原 buffer
14. ✅ bufferMoveUp clamp 到短行
15. ✅ bufferMoveDown clamp 到短行
16. ✅ CJK 多行移动保持字符列
17. ✅ 三行 buffer Up/Down 正确

**Task 视图成熟度（8 tests）：**
18. ✅ activity phases 正确映射语义状态
19. ✅ permission card 包含 risk/reason/scope/hint
20. ✅ permission card plain 渲染完整
21. ✅ error/fail/blocked output 有正确语义状态
22. ✅ completed(partial) background 不显示为 PASS
23. ✅ output blocks 保留 3 条上下文
24. ✅ permission pending placeholder 正确切换
25. ✅ 窄屏 (<60) 不崩溃

**结构非退化（6 tests）：**
26. ✅ resize 所有宽度正常渲染
27. ✅ model setup masking 仍正确
28. ✅ Home 结构顺序不退化
29. ✅ Task 结构顺序不退化
30. ✅ Home visual structure with setup placeholder
31. ✅ Composer formatComposerRenderLines cursor 追踪多行

## 验证结果

```
corepack pnpm exec vitest run packages/tui/src/shell/view-model.test.ts → 164 passed
corepack pnpm exec vitest run packages/tui/src/index.test.ts → 215 passed
corepack pnpm typecheck → clean
corepack pnpm check → 1 pre-existing warning (unrelated: model-doctor-runtime.test.ts)
corepack pnpm --filter @linghun/tui build → success
corepack pnpm --filter @linghun/cli build → success
git diff --check → clean
```

## 仍需真实终端 smoke 的项

| # | 验证点 | 环境 | 方法 |
|---|--------|------|------|
| S1 | Home 渲染正确（wordmark + Composer + StatusTray） | WT / PowerShell / cmd in WT | 目视 |
| S2 | CJK 中文输入光标位置正确 | WT | 输入中文，观察光标是否对齐 |
| S3 | 多行输入 Up/Down 行内移动正确 | WT | 输入多行，按 Up/Down 观察光标 |
| S4 | 多行输入首/末行 Up/Down 触发 history | WT | 首行按 Up 观察是否切换历史 |
| S5 | Resize 后重绘正确 | WT | 拖动窗口大小 |
| S6 | Permission card 显示 + y/n 输入正常 | WT | 触发权限请求 |
| S7 | apiKey masking 显示 `***` 且光标正确 | WT | 进入 model setup |
| S8 | Plain fallback Home/Task 渲染 | LINGHUN_TUI_PLAIN=1 | 目视 |
| S9 | Plain placeholder 与 readline prompt 不冲突 | LINGHUN_TUI_PLAIN=1 | 目视输入区是否有 double "> " |
| S10 | TERM=dumb 自动回退 plain | 设置 TERM=dumb | 确认不崩溃 |
| S11 | 窄屏 (<60 cols) StatusTray 正确丢弃 index 保留 background | WT 窄窗口 | 目视 |
| S12 | setupNeeded=true Home 显示轻量 placeholder | WT 无 provider 配置 | 目视 |

## 参考核对

- 本阶段实际读取：`packages/tui/src/shell/plain-renderer.ts`、`packages/tui/src/shell/components/Composer.tsx`、`packages/tui/src/shell/view-model.ts`、`packages/tui/src/shell/types.ts`、`packages/tui/src/shell/view-model.test.ts`
- 本阶段参考：CCB 的 TextInput/useTextInput 多行行内移动行为（首/末行才触发历史）
- 所有内容为 Linghun 自研实现，未复制可疑源码

## Handoff Packet

- **下一阶段**：D.14C 或 D.15（视蓝图）
- **禁止事项**：不得改回 Up/Down 直接触发 history；不得恢复大段 setupHint 到 Home；不得在 plain-renderer 加 "> " 前缀
- **证据引用**：164 + 215 tests pass, typecheck clean, biome check clean (1 pre-existing warning), build success
- **验证结果**：PASS
- **索引状态**：F-Linghun 索引不可用（使用 rg/Grep 完成盘点）
- **权限模式**：default
- **模型/provider**：N/A（本阶段不调用模型）
- **预算使用**：无 API 调用成本
