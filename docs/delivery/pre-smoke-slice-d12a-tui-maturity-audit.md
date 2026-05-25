# Slice D.12A — TUI Maturity Audit

> 日期：2026-05-25
> 范围：只审计，不改代码。评估 Linghun TUI 是否达到下一代编程工具的成熟使用体验。
> 状态：未真实 smoke；未 Beta PASS / smoke-ready / open-source-ready。

---

## git status --short 真实输出

```text
(clean)
```

当前分支 `master`，工作区干净。

---

## 实际读取文件列表

- `packages/tui/src/shell/types.ts`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/shell/view-model.test.ts`
- `packages/tui/src/shell/plain-renderer.ts`
- `packages/tui/src/shell/ink-renderer.tsx`
- `packages/tui/src/shell/theme.ts`
- `packages/tui/src/shell/text-utils.ts`
- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/components/Composer.tsx`
- `packages/tui/src/shell/components/StatusTray.tsx`
- `packages/tui/src/shell/components/ProductBlock.tsx`
- `packages/tui/src/index.ts`（前 200 行，含 import/export 结构）
- `packages/tui/src/index.test.ts`（前 150 行，含测试基础设施）
- `packages/tui/src/runtime-status-presenter.ts`
- `packages/tui/src/request-lifecycle-presenter.ts`
- `packages/tui/src/permission-presenter.ts`
- `packages/tui/src/tool-output-presenter.ts`
- `packages/tui/src/job-runner-presenter.ts`
- `packages/tui/src/terminal-readiness-presenter.ts`
- `docs/delivery/pre-smoke-slice-d11b-process-guard-implementation.md`（前 100 行）

未找到 `docs/delivery/pre-smoke-slice-d-task-shell-view-mode.md`。

---

## P0/P1/P2/P3 Findings Table

### P0 — Must fix before real smoke

| # | 文件路径 + 函数/组件 | 触发场景 | 证据 | 风险 | 修复方向 | 适合 D.12B |
|---|---|---|---|---|---|---|
| P0-1 | `shell/view-model.ts` → `mapRequestActivityToView()` | 用户提交请求后模型返回空响应或 provider 报错 | `phaseMap` 没有 `error` / `completed` / `request_failed` 映射；`request-lifecycle-presenter.ts` 定义了 `formatProviderFailurePrimary` 但 shell view-model 无法将 provider 失败映射为 activity error phase | activity indicator 停留在 "正在思考…" 不更新，用户不知道请求已失败 | 新增 `request_failed` → `error` phase 映射；或在 TuiContext 上暴露 `requestError` 字段让 view-model 生成 error activity | 是 |
| P0-2 | `shell/components/Composer.tsx` → `handleComposerInput()` | 用户在权限提示态输入 y/n/details | Composer 组件始终接收键盘输入并追加到 text state；`ShellApp.tsx` 的 `PermissionPrompt` 只是视觉展示，没有拦截输入路由 | 权限确认态下用户输入 "y" 会被当作普通文本追加到 composer，而非触发权限响应；用户必须依赖外部 controller 路由（未在 shell 层可见） | 在 permission pending 时，Composer 应切换为权限响应模式或禁用普通输入；或在 ShellApp 层根据 `view.permission` 切换 `useInput` 目标 | 是 |
| P0-3 | `shell/plain-renderer.ts` → `renderPlainTask()` | plain fallback 模式下权限提示 | plain renderer 显示 `[Bash] 需要执行命令` + `yes / no`，但没有显示 risk level | 用户在 plain 模式下无法区分 high/medium/low 风险操作，可能误批准高风险命令 | 在 permission 行增加 risk 标记，如 `[Bash] [HIGH] 需要执行命令` | 是 |

### P1 — Mature patch candidate

| # | 文件路径 + 函数/组件 | 触发场景 | 证据 | 风险 | 修复方向 | 适合 D.12B |
|---|---|---|---|---|---|---|
| P1-1 | `shell/view-model.ts` → `createShellViewModel()` | 多个 output blocks 产生时 | `outputBlocks` 只取 `.slice(-1)` 最后一条 | 用户看不到之前的工具输出历史，只能看到最新一条；对于多步任务，用户无法回顾中间步骤 | 保留最近 2-3 条 output block（受 height 约束），或在 task mode 提供 scroll hint | 是 |
| P1-2 | `shell/components/StatusTray.tsx` | width < 60 时 | `items.slice(0, 4)` 硬编码截断，丢弃 `background` 字段 | 窄终端下用户看不到后台任务数量，可能不知道有任务在跑 | 窄终端优先显示 background（如果 > 0），或用缩写 `BG:1` 替代完整 label | 是 |
| P1-3 | `shell/view-model.ts` → `mapPendingApprovalToPermission()` | 用户 deny 权限后 | 函数只在 `pendingLocalApproval` 存在时生成 permission view；deny 后 approval 被清除，但没有生成 "denied" 反馈 activity | 用户按 n 后，permission prompt 消失但没有明确的 "已拒绝" 反馈，可能误以为操作已执行 | deny 后生成一条短暂的 activity `{ phase: "completed", text: "已拒绝 Bash" }` 或 output block | 是 |
| P1-4 | `job-runner-presenter.ts` → `mapDurableJobToBackgroundStatus()` | job completed 时 | `completed` 映射为 `BackgroundTaskStatus = "completed"`，但 `mapBackgroundSummariesToBlocks()` 将 completed 映射为 `status: "info"` + `nextAction: "已结束，非验证通过"` | 设计意图正确（completed ≠ PASS），但 `info` 状态的视觉标记（cyan ●）与普通信息相同，用户可能忽略 "非验证通过" 注释 | 考虑 completed job 使用 `partial` 状态（yellow）以引起注意，或在 title 中直接标注 `[非PASS]` | 是 |
| P1-5 | `shell/ink-renderer.tsx` → `renderInkShell()` | Windows cmd 窗口关闭 | `stdinStream?.on("close", doUnmount)` 处理了 stdin close，但 `alternateScreen: true` 退出时如果 stdout 已断开，`\x1b[?1049l` 写入可能抛异常 | Windows cmd 强制关闭时可能产生未捕获异常 | `doUnmount` 中 wrap `instance.unmount()` 在 try-catch 中，或检查 stdout.writable | 是 |
| P1-6 | `shell/view-model.ts` → `createShellViewModel()` | task mode 下无 activity 且无 output | `viewMode` 自动切换逻辑：有 outputBlocks/activity/permission 才进 task mode；但如果用户提交了请求、controller 还没来得及设置 activity phase，会短暂停留在 home mode | 用户提交后可能看到 home 页面闪烁一帧再切到 task mode | 在 controller 层提交时立即设置 `requestActivityPhase = "request_started"`，或在 view-model 增加 `submitted` 信号 | 是 |
| P1-7 | `terminal-readiness-presenter.ts` → `sanitizePrimary()` | Windows 路径出现在 doctor 输出中 | `[A-Z]:[\\/][^\s)]+` 替换为 `[local-path]`，但这会把用户自己的项目路径也隐藏 | 用户运行 `/doctor all` 时看不到自己的项目路径，影响排查 | 只在非当前项目路径时替换，或改为只替换 home 目录下的敏感路径 | 否（readiness 层） |

### P2 — Real smoke observation item

| # | 文件路径 + 函数/组件 | 触发场景 | 证据 | 风险 | 修复方向 | 适合 D.12B |
|---|---|---|---|---|---|---|
| P2-1 | `shell/components/ShellApp.tsx` → `HomeLayout` | 终端高度 < 16 行 | `flexGrow={1}` + `flexGrow={2}` 垂直居中，但 Ink 在极矮终端下可能裁剪底部 composer | composer 可能被裁剪不可见 | 需要真实 smoke 验证；如果确认，改为 `minHeight` 保护 composer 区域 | 观察 |
| P2-2 | `shell/ink-renderer.tsx` → `onResize` | 快速连续 resize | 60ms debounce + `instance.clear()` + `rerender()`；Ink alternateScreen 模式下 clear 是否安全需要真实验证 | 快速 resize 可能产生短暂闪烁或残影 | 真实 smoke 观察；如果有问题，增加 debounce 到 100ms 或用 requestAnimationFrame 节奏 | 观察 |
| P2-3 | `shell/text-utils.ts` → `charWidth()` | Emoji 和 Surrogate Pair 字符 | CJK 宽字符正则只覆盖 BMP 范围，不包含 Emoji（U+1F000+）和 CJK Extension B（U+20000+） | Emoji 在 status tray 或 output block 中可能导致对齐偏移 | 真实 smoke 观察；如果确认，引入 `string-width` 或扩展正则到 astral plane | 观察 |
| P2-4 | `shell/components/Composer.tsx` | 长文本输入（> 3 行） | `displayLines` 按 `\n` 分割后逐行渲染，但没有 maxHeight 限制 | 超长输入可能把 task mode 的 activity/blocks 区域挤出可视范围 | 真实 smoke 观察；如果确认，限制 composer 显示行数为 5 行 + "..." | 观察 |
| P2-5 | `shell/theme.ts` → `createShellTheme()` | no-color 模式下所有 status 都是 white | `getStatusMarker()` 在 no-color 时用 `[INFO]`/`[FAIL]` 等文本标记区分 | 功能正确，但 no-color 下所有 Ink `<Text color="white">` 在深色/浅色终端主题下可能不可见 | 真实 smoke 观察；如果确认，no-color 模式不设 color 属性（使用终端默认前景色） | 观察 |
| P2-6 | `permission-presenter.ts` → `formatLocalToolPermissionPrompt()` | 用户输入 "details" 查看安全摘要 | 提示文本说 "输入 details/详情 查看安全摘要"，但 shell Composer 层没有对 "details" 输入做特殊路由 | 用户输入 "details" 可能被当作普通文本提交而非触发详情展示 | 需要真实 smoke 确认 controller 层是否拦截；如果未拦截，需要在 shell 层增加 details 命令识别 | 观察 |

### P3 — Later polish

| # | 文件路径 + 函数/组件 | 触发场景 | 证据 | 风险 | 修复方向 | 适合 D.12B |
|---|---|---|---|---|---|---|
| P3-1 | `shell/view-model.ts` → `shellText` | 品牌 vision 文案 | "技术普惠会越来越成熟 而你就是最伟大的梦想家" 在 width=40 时被 `fitText` 截断 | 窄终端下 vision 文案不完整，但不影响功能 | 窄终端可用更短的 vision 文案或省略 | 否 |
| P3-2 | `shell/plain-renderer.ts` → `formatStatusTray()` | status tray 内容过长 | 各 status item 用双空格连接，总长度可能超过 width | 窄终端下 status tray 可能换行或被截断 | 增加总长度检查，超出时省略低优先级项 | 否 |
| P3-3 | `runtime-status-presenter.ts` → `formatRuntimeStatusLine()` | 内部 status line | 使用 `·` 分隔符，但 shell view-model 已经不使用此函数渲染主屏 | 仅影响 `/status` 命令输出，不影响主 TUI | 保持现状 | 否 |
| P3-4 | `shell/components/Composer.tsx` → cursor | 光标显示 | 使用 `\u258C`（左半块）作为光标指示 | 某些 Windows 终端字体可能不渲染此字符 | 可选用 `|` 或 `_` 作为 fallback | 否 |
| P3-5 | `tool-output-presenter.ts` → `looksLikeMojibake()` | Bash 输出含编码问题 | 检测 mojibake 并在 summary 中标注 "疑似编码问题" | 仅信息提示，不影响功能 | 保持现状 | 否 |

---

## 审计重点分析

### 1. 真实任务执行态

**结论：基本成熟，有 P0 级缺口。**

- home → task 切换逻辑清晰：有 output/activity/permission 时自动进入 task mode（view-model.ts L110-112）。
- activity indicator 覆盖 thinking/tool_running/continuing/permission_waiting 四个阶段（view-model.ts L179-210）。
- **缺口 P0-1**：没有 error/failed phase 映射，provider 失败时 activity 不更新。
- **缺口 P1-6**：提交到 activity 设置之间可能有 home 闪烁。
- output blocks 只保留最近 1 条（P1-1），对多步任务信息不足。
- task mode 下 brand hero 正确隐藏，不干扰工作流。

### 2. 权限态成熟度

**结论：结构完整，交互路由有 P0 级问题。**

- permission prompt 显示 toolName、reason、risk（Ink 有颜色区分）、scope、hint（view-model.ts L232-262）。
- **缺口 P0-2**：Composer 在 permission 态下没有切换输入模式，y/n 输入可能被当作普通文本。
- **缺口 P0-3**：plain renderer 不显示 risk level。
- **缺口 P1-3**：deny 后没有明确反馈。
- permission pending 时正确抑制 output blocks 避免双重显示（view-model.ts L103-106）。

### 3. 长任务/后台任务

**结论：presenter 层完善，TUI 展示层基本可用。**

- `job-runner-presenter.ts` 完整覆盖 running/paused/stale/timeout/cancelled/failed/completed 状态。
- `formatJobNextAction()` 为每种状态提供明确的下一步命令（/job pause、/job cancel、/job report、/job logs）。
- `mapBackgroundSummariesToBlocks()` 正确将 job 状态映射为 ProductBlock，completed 标注 "已结束，非验证通过"。
- D.11B process guard 限制在 `formatRunnerDoctor()` 中明确标注 "DEFERRED: managed/bundled binary distribution..."，不会被误读为已实现。
- **缺口 P1-4**：completed 用 `info` 状态（cyan）视觉上不够醒目。

### 4. 错误/部分成功/验证态

**结论：presenter 层设计严谨，shell 层传递有缺口。**

- `request-lifecycle-presenter.ts` 对 gateway/timeout/abort/schema/generic 五类错误有清晰的用户文案和下一步指引。
- `terminal-readiness-presenter.ts` 明确声明 "not Beta PASS, smoke-ready, or open-source-ready"。
- `job-runner-presenter.ts` 中 `formatJobReportConclusion` 和 `formatBackgroundReason` 明确 "completed/cancelled/timeout/stale/blocked never count as verification PASS"。
- **缺口 P0-1**：shell activity indicator 无法表达 error 状态。
- ProductBlock 的 `fail` 状态有 bordered card 强调（ProductBlock.tsx L17），视觉区分充分。

### 5. 终端适配

**结论：基础框架完善，边界情况需真实 smoke 验证。**

- width=40 窄终端：`normalizeWidth()` 下限 30；`composerMaxWidth()` 下限 40；`fitBlockToWidth()` 内容宽度下限 18；StatusTray 在 < 60 时截断为 4 项。布局不会崩溃。
- no-color：`lineChar()` 回退 ASCII dash；`brandWordmark()` 回退纯文本；`getStatusMarker()` 回退 `[INFO]`/`[FAIL]` 等文本标记。可读性基本保证。
- Windows PowerShell/cmd：`brandWordmark()` 注释明确 "ASCII-safe for Windows console resize stability"；无 figlet/heavy Unicode；`ink-renderer.tsx` 处理 stdin close/end/error。
- resize：60ms debounce + `instance.clear()` + rerender；alternateScreen 模式避免残影。测试覆盖 resize 场景。
- plain renderer fallback：`LINGHUN_TUI_PLAIN=1` 或 `TERM=dumb` 或非 TTY 自动降级；plain 输出完整可读。
- **缺口 P2-5**：no-color 下 `color="white"` 在浅色终端可能不可见。
- **缺口 P2-3**：Emoji/astral plane 字符宽度计算不准。

### 6. 信息架构

**结论：主屏不薄，任务态信息密度适中。**

- home mode：brand + vision + composer + status tray + blocks（如有）。信息层次清晰。
- task mode：compact top bar（brand + status）+ separator + activity + permission + blocks + composer。用户能看到当前在做什么。
- "用户不知道现在该等、该确认、还是该输入" 的状态：
  - activity indicator 明确区分 thinking/tool_running/permission_waiting。
  - permission prompt 有明确的 hint 文案。
  - **缺口 P0-2**：但 Composer 没有在 permission 态切换行为，可能造成混淆。
- 内部术语：shell 层已清理（测试验证不含 "Start Gate"、"endpointProfile"、"tool_result"）。`terminal-readiness-presenter.ts` 的 doctor 输出仍有内部术语（如 `endpointProfile`、`workspaceSnapshot`），但这是 `/doctor` 命令的诊断输出，面向开发者，可接受。

---

## D.12B 推荐修复范围

1. **P0-1**：shell view-model 增加 error/failed activity phase 映射
2. **P0-2**：permission 态下 Composer 输入路由切换
3. **P0-3**：plain renderer permission 显示 risk level
4. **P1-1**：task mode 保留最近 2-3 条 output block
5. **P1-2**：窄终端 StatusTray 优先显示 background（如果 > 0）
6. **P1-3**：deny 后生成短暂反馈 activity/output
7. **P1-4**：completed job 视觉区分（改用 partial 状态或标注）
8. **P1-5**：Windows cmd 关闭时 unmount 异常保护
9. **P1-6**：提交后立即设置 activity phase 避免 home 闪烁

---

## D.12B 不应触碰范围

- `terminal-readiness-presenter.ts` 的 sanitizePrimary 路径替换逻辑（P1-7，属于 readiness 层，不是 shell 层）
- `runtime-status-presenter.ts` 的 `·` 分隔符（P3-3，已不在主屏使用）
- Emoji/astral plane 宽度计算（P2-3，需要引入外部依赖，应在后续 polish 阶段处理）
- Composer 光标字符（P3-4，纯视觉 polish）
- Vision 文案窄终端截断（P3-1，不影响功能）
- 大型 UI 框架引入
- 品牌 landing page / marketing UI 改版

---

## 真实 smoke 观察清单

以下项目需要在真实终端环境中验证，本次审计无法确认：

1. 极矮终端（height < 16）下 composer 是否被裁剪（P2-1）
2. 快速连续 resize 是否产生闪烁/残影（P2-2）
3. Emoji 在 status tray / output block 中的对齐（P2-3）
4. 超长 composer 输入是否挤压 task 区域（P2-4）
5. no-color + 浅色终端主题下文本可见性（P2-5）
6. "details" 输入在权限态的实际路由行为（P2-6）
7. Windows PowerShell 7 / cmd / Windows Terminal 下的实际渲染效果
8. alternateScreen 进入/退出在各终端模拟器下的兼容性
9. kittyKeyboard mode="auto" 在非 Kitty 终端下的降级行为

---

## 声明

- 未真实 smoke
- 未 Beta PASS / smoke-ready / open-source-ready
- 本报告基于源码静态分析和测试用例推断，所有 P2 级发现需要真实终端验证
