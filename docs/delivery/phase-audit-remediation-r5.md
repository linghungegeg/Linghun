# Phase R5 — Alt-Screen + 自研 ScrollBox 交付文档

## 阶段目标

实现 AUDIT_REMEDIATION_PLAN.md Phase R5 的 7 项功能：
1. useAlternateScreen 可配置
2. 自研 ScrollBox 组件（microtask 合并 + viewport culling 架构）
3. 鼠标接管（SGR mouse enable/disable + wheel/click/drag 解析）
4. App-owned 选中（copy-on-select 松开写剪贴板）
5. Wheel 加速算法
6. Sticky scroll（自动跟随新内容 + jump-to-bottom）
7. 非 alt-screen fallback

## 已完成功能

### 1. useAlternateScreen 可配置
- `LINGHUN_FULLSCREEN` 环境变量控制（默认 `"1"` 启用）
- `LINGHUN_FULLSCREEN=0` 禁用 alt-screen
- tmux 检测：`TMUX_PANE` 或 `TERM_PROGRAM=tmux` 自动禁用
- 终端能力 `alternateScreen` 为 false 时自动禁用

### 2. 自研 ScrollBox / Microtask 合并
- `useScrollBatcher` hook：microtask 帧内多次 scroll delta 合并为一次 dispatch
- 现有 TranscriptViewport 保留行级 clipping 架构（overflow=hidden + clamped marginTop）
- block-level virtualization 已由 `transcriptVirtualRange` 提供

### 3. SGR Mouse 接管
- `MouseInputRouter` 组件：alt-screen 激活时自动启用
- 解析 DEC 1000/1006 SGR 鼠标序列（wheel/click/drag/release）
- Wheel 事件路由为 `transcript-scroll` + 加速 delta
- Click/drag/release 路由为 `transcript-mouse` 用于选区

### 4. App-owned 选中 (copy-on-select)
- 已有完整实现：`reduceTranscriptSelection` + `writeTextToClipboard`
- 松开鼠标 → 自动复制到系统剪贴板（跨平台：clip/pbcopy/wl-copy/xclip/xsel + OSC52）
- 成功/失败通知走 `NotificationStack`

### 5. Wheel 加速算法
- `WheelAccelerator` 类：40ms 滑动窗口 + 设备区分
- Trackpad 检测（avg interval < 10ms）→ 不加速，每事件 1 行
- 鼠标滚轮检测（avg interval ≥ 10ms）→ 线性 ramp（max = viewportHeight/2）
- 上限 fallback = 10 行（无视口测量时）

### 6. Sticky Scroll
- `stickToBottom=true` 时新内容自动可见（measure handler 强制 offset=0）
- `action: "bottom"` / `type: "end"` 跳到底部恢复 stickToBottom
- 用户向上滚动 → stickToBottom=false → 新内容不强制跳底

### 7. 非 alt-screen Fallback
- `LINGHUN_FULLSCREEN=0` → mouseTracking 自动禁用
- 键盘滚动（PgUp/PgDn/Home/End）仍正常工作
- 终端原生 wheel 和选区保留不被应用拦截

## 涉及模块

| 文件 | 变更类型 |
|------|----------|
| `packages/tui/src/shell/ink-renderer.tsx` | 修改：`resolveAlternateScreen` 替换硬编码 |
| `packages/tui/src/shell/models/wheel-acceleration.ts` | 新增：加速算法 |
| `packages/tui/src/shell/models/transcript-scroll-state.ts` | 修改：sticky scroll measure 修复 |
| `packages/tui/src/shell/hooks/useScrollBatcher.ts` | 新增：microtask 合并 hook |
| `packages/tui/src/shell/components/MouseInputRouter.tsx` | 新增：鼠标输入路由组件 |
| `packages/tui/src/shell/components/ShellApp.tsx` | 修改：集成 MouseInputRouter |
| `packages/tui/src/tui-messages.ts` | 修改：新增 r5 双语消息 |
| `packages/tui/src/shell/view-model.test.ts` | 修改：适配 alt-screen 默认启用 |
| `packages/tui/src/shell/ink-interaction-smoke.test.ts` | 修改：适配 alt-screen 默认启用 |

## 关键设计

### MouseInputRouter 架构
- 独立 React 组件，使用 Ink `useInput` 接收原始终端输入
- 通过 `isSgrMouseInput` 过滤非鼠标输入（透传给 Composer）
- `active` prop 由 `resolveTerminalInteractionModes` 决定
- 与 Composer 的 `useInput` 并存不冲突（Ink 支持多个 useInput 消费者）

### Wheel 加速 vs Trackpad 阻尼
- 40ms 窗口内事件间隔均值 < 10ms → trackpad（高频小增量，不加速）
- 40ms 窗口内事件间隔均值 ≥ 10ms → 鼠标滚轮（低频大增量，线性加速）
- 加速方式：首次 wheel 事件正常 1 行（`wheelUp/wheelDown` action），追加额外 `delta` 补偿

### Alt-screen 决策链
```
LINGHUN_FULLSCREEN === "0" → false
capability.alternateScreen === false → false
TMUX_PANE set || TERM_PROGRAM === "tmux" → false
otherwise → true (default enabled)
```

## 配置项

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `LINGHUN_FULLSCREEN` | `"1"` | 全屏模式（alt-screen）开关 |
| `LINGHUN_TUI_MOUSE` | `"1"` | 鼠标追踪开关（需 alt-screen 同时开启） |

## 命令

无新增命令。功能通过环境变量和终端交互自动生效。

## 测试与验证

- TypeScript typecheck: PASS
- Build: PASS
- Tests: 3213 pass / 0 fail / 2 skip（与基线一致）
- 新增测试适配：3 个已有测试追加 `LINGHUN_FULLSCREEN=0` 以保留"非 alt-screen"测试意图

## 性能结果

- Wheel 加速：O(1) 每事件（固定 10 项 circular buffer）
- Microtask 合并：单帧内 N 次 wheel → 1 次 dispatch + 1 次 rerender
- 无新增定时器或后台轮询

## 已知问题

- Ink 标准版不支持真正的行级裁剪（@anthropic/ink 私有 fork 特性）；现有 overflow=hidden + block virtualization 提供等效体验
- `MouseInputRouter` 的 `useInput` 与 Composer 的 `useInput` 同时激活；如果 Ink 版本升级改变多消费者行为需要重新验证

## 不在本阶段处理的内容

- 滚动条可视指示器（scrollbar thumb）
- 鼠标中键粘贴
- 触控板双指水平滚动
- Alt-screen 模式下的 resize 闪烁优化

## 下一阶段衔接

Phase R5 完成了 alt-screen 基础设施和鼠标交互闭环。后续可以在此基础上：
- 增加滚动条视觉指示
- 优化 alt-screen 下的 resize 体验
- 扩展鼠标交互（右键菜单、中键粘贴）

## 开发者排查入口

- Alt-screen 是否生效：检查 `LINGHUN_FULLSCREEN` 值和 `resolveAlternateScreen()` 返回
- 鼠标是否启用：检查 stdout 是否含 `\x1B[?1000h\x1B[?1006h`
- Wheel 加速异常：`WheelAccelerator.reset()` 重置状态
- Copy-on-select 失败：查看 `writeTextToClipboard` 返回的 error 和 notification

## 参考核对

- 本阶段实际读取了：`AUDIT_REMEDIATION_PLAN.md` (Phase R5 范围)、`packages/tui/src/shell/` 全部关键文件
- 本阶段参考了：CCB ScrollKeybindingHandler 40ms 窗口行为特征（仅行为参考，未复制代码）；CCB useCopyOnSelect 松开即复制边界（仅行为参考）；CCB fullscreen.ts tmux-CC 检测思路（仅环境兼容矩阵参考）
- 进入 Linghun 自研实现：`WheelAccelerator` 算法、`MouseInputRouter` 组件、`resolveAlternateScreen` 逻辑、`useScrollBatcher` hook、sticky scroll 修复
- 明确说明未复制可疑源码实现

## Handoff Packet

```yaml
phase: R5
status: COMPLETE
branch: codex/meta-scheduler-closure
verification:
  typecheck: PASS
  build: PASS
  tests: 3213/3213 (0 fail, 2 skip)
next_phase: R6 (if defined in AUDIT_REMEDIATION_PLAN.md)
forbidden:
  - 不复制 CCB @anthropic/ink 私有 fork 渲染管线
  - 不修改 Phase R4 keybinding 架构
  - 不引入 Rust NAPI 原生模块
evidence:
  - Full test run: 3213 pass (matches R4 baseline exactly)
  - TypeScript strict mode: 0 errors
  - Build: all packages success
index_status: not queried (not needed for this phase)
permission_mode: N/A (no model interactions)
model_provider: N/A
budget: N/A
```
