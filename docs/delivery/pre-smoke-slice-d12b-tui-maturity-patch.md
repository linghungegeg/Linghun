# Slice D.12B — TUI Mature Patch Before Real Smoke

> 日期：2026-05-25
> 范围：基于 D.12A 审计，修复 P0 全部、P1 全部、低风险 P3、防御性 P2。不改 provider loop、job 状态机、permission approval 语义、ProcessGuard。
> 状态：未真实 smoke；未 Beta PASS / smoke-ready / open-source-ready。

---

## git status --short 真实输出

### 开工前

```text
?? docs/delivery/pre-smoke-slice-d12a-tui-maturity-audit.md
```

### 交付报告写入前

```text
 M packages/tui/src/shell/components/Composer.tsx
 M packages/tui/src/shell/components/ShellApp.tsx
 M packages/tui/src/shell/components/StatusTray.tsx
 M packages/tui/src/shell/ink-renderer.tsx
 M packages/tui/src/shell/plain-renderer.ts
 M packages/tui/src/shell/theme.ts
 M packages/tui/src/shell/types.ts
 M packages/tui/src/shell/view-model.test.ts
 M packages/tui/src/shell/view-model.ts
 M packages/tui/src/terminal-readiness-presenter.ts
?? docs/delivery/pre-smoke-slice-d12a-tui-maturity-audit.md
```

---

## 实际读取文件列表

- `docs/delivery/pre-smoke-slice-d12a-tui-maturity-audit.md`
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
- `packages/tui/src/runtime-status-presenter.ts`
- `packages/tui/src/terminal-readiness-presenter.ts`
- `packages/tui/src/job-runner-presenter.ts`
- `packages/tui/src/index.ts`（前 200 行）
- `packages/tui/src/index.test.ts`（前 150 行 + 1040-1090 行）
- `packages/tui/src/request-lifecycle-presenter.ts`
- `packages/tui/src/permission-presenter.ts`
- `packages/tui/src/tool-output-presenter.ts`

---

## P0/P1/P3/P2 修复对照表

### P0 — Must fix before real smoke（全部已修）

| # | 审计编号 | 修复内容 | 源码位置 | 测试覆盖 |
|---|---|---|---|---|
| 1 | P0-1 | Activity error/failed/completed phase mapping | `view-model.ts` → `mapRequestActivityToView()` 新增 `request_failed`/`error`/`failed` → `"error"` 和 `completed`/`request_completed` → `"completed"` 映射；`shellText` 新增 `activityError`/`activityCompleted` 用户可懂文案 | 6 个新测试：maps request_failed/error/failed/completed/request_completed + error renders with fail marker |
| 2 | P0-2 | Permission pending Composer mature input mode | `view-model.ts` → `createShellViewModel()` 当 `options.permission` 存在时，`composer.placeholder` 切换为 `permissionPlaceholder`（"y/yes 允许 · n/no 拒绝 · details 详情 · Esc 取消"）；不改 controller 权限语义，仍需 Enter 提交 | 3 个新测试：permission placeholder zh-CN/en-US + normal placeholder without permission |
| 3 | P0-3 | Plain renderer permission risk level | `plain-renderer.ts` → `renderPlainTask()` permission 行格式改为 `[toolName] [RISK] reason` | 3 个新测试：[HIGH]/[MEDIUM]/[LOW] 在 plain 输出中可见 |

**关于 P0-2 的说明**：这是 Shell UX maturity 问题，不是 controller 完全缺失。controller 层（`index.ts`）已有 `pendingLocalApproval` 拦截和 y/n 处理逻辑。问题是 Shell/Composer 视觉层在权限态下仍显示普通 placeholder "我能帮您做点什么？"，用户不知道当前应该输入 y/n。修复后 Composer placeholder 在权限态明确提示可用操作，但输入仍然通过 Enter 提交给 controller 处理。

### P1 — Mature patch candidate（全部已修）

| # | 审计编号 | 修复内容 | 源码位置 | 测试覆盖 |
|---|---|---|---|---|
| 4 | P1-1 | Output blocks 保留最近 3 条 | `view-model.ts` → `createShellViewModel()` 中 `.slice(-3)` 替代 `.slice(-1)` | 2 个新测试：keeps 3 blocks + still suppresses when permission pending |
| 5 | P1-2 | 窄终端 StatusTray 保留 background | `view-model.ts` → `formatBackground()` 接受 width 参数，width < 60 且 count > 0 时使用短标签 `后台:N`/`BG:N`；`StatusTray.tsx` 窄终端保留 background（丢弃 index 而非 background）；`plain-renderer.ts` → `formatStatusTray()` 窄终端保留 background | 3 个新测试：width=40 zh-CN/en-US short label + width=80 full label |
| 6 | P1-3 | Deny/cancel 权限后明确反馈 | `view-model.ts` → `createShellViewModel()` 新增 `denialFeedback` option，生成 `partial` 状态的 denial block；文案明确"已拒绝/已取消，工具未执行" | 4 个新测试：denied/cancelled feedback visible + triggers task mode + not marked as pass |
| 7 | P1-4 | Completed job 非 PASS 视觉区分 | `view-model.ts` → `mapBackgroundSummariesToBlocks()` completed 状态从 `"info"` 改为 `"partial"`（yellow 视觉）；nextAction 增加 `[非PASS]`/`[not PASS]` 前缀 | 3 个新测试：partial status + [非PASS] zh-CN + [not PASS] en-US |
| 8 | P1-5 | Ink unmount 异常保护 | `ink-renderer.tsx` → `doUnmount()`/`rerender()`/`onResize()` 中 `instance.unmount()`/`instance.clear()`/`instance.rerender()` 包裹 try-catch | 现有 resize 测试继续通过（验证不崩溃） |
| 9 | P1-6 | Home 闪烁缓解 | `types.ts` → `ShellViewMode` 新增 `"pending"`；`view-model.ts` → `createShellViewModel()` 当 `submitted=true` 时 viewMode 为 `"pending"`；`ShellApp.tsx` 和 `plain-renderer.ts` 将 `"pending"` 视为 task layout | 3 个新测试：submitted produces pending + renders as task + explicit override takes precedence |
| 10 | P1-7 | Doctor path redaction 不过度隐藏 | `terminal-readiness-presenter.ts` → `sanitizePrimary()` 改为保留路径 basename（`[…/filename]`），只隐藏完整路径前缀；覆盖 Windows 绝对路径和 Unix home/tmp/var/private 路径 | 现有 readiness doctor 测试通过（验证 `C:\secret` 被隐藏但 basename 保留） |

### P3 — Low-risk polish（已修）

| # | 审计编号 | 修复内容 | 源码位置 | 测试覆盖 |
|---|---|---|---|---|
| 11 | P3-1 | 窄终端 vision 短版 | `view-model.ts` → `shellText` 新增 `visionShort`；`createShellViewModel()` 当 width <= 40 时使用短版 | 3 个新测试：zh-CN/en-US width=40 short + width=80 full |
| 12 | P3-2 | Plain status tray 总长度控制 | `plain-renderer.ts` → `formatStatusTray()` 增加总长度检查和 `fitStatusTrayLine()` 截断逻辑 | 1 个新测试：status tray does not exceed reasonable width |
| 13 | P3-4 | Composer cursor fallback | `Composer.tsx` → no-color 模式使用 `|` 替代 `▌`；现代终端继续用 `▌` | 通过现有 Ink render 测试验证（no-color 不含 `▌`） |

### P2 — 防御性修复（不依赖真实 smoke）

| # | 审计编号 | 修复内容 | 源码位置 | 测试覆盖 |
|---|---|---|---|---|
| 14 | P2-4 | Composer max visible lines | `Composer.tsx` → `COMPOSER_MAX_VISIBLE_LINES = 5`；超出时只显示最后 5 行 + 省略提示；不改变提交内容 | 通过现有 Composer 测试验证（不影响 submit 行为） |
| 15 | P2-5 | No-color 不强制 white | `theme.ts` → `createShellTheme()` no-color 模式所有颜色字段为 `undefined`（使用终端默认前景色）；类型改为 `string | undefined` | 1 个新测试：no-color still has text markers |

---

## 验证结果

```
corepack pnpm exec vitest run packages/tui/src/shell/view-model.test.ts packages/tui/src/index.test.ts
→ 285 passed (85 view-model + 200 index)

corepack pnpm typecheck
→ 通过（无错误）

corepack pnpm check
→ 通过（仅 1 个无关 warning：model-doctor-runtime.test.ts 中已有的 biome-ignore 注释）

git diff --check
→ 通过（无空白问题）
```

---

## 未修项和原因

| 审计编号 | 原因 |
|---|---|
| P2-1 | 极矮终端 composer 裁剪 — 需要真实 smoke 验证 Ink flexGrow 行为 |
| P2-2 | 快速连续 resize 闪烁 — 需要真实终端验证 |
| P2-3 | Emoji/astral plane 宽度计算 — 需要引入 `string-width` 外部依赖，留后续 polish |
| P2-6 | "details" 输入路由 — 需要真实 smoke 确认 controller 层行为 |

---

## 改动文件列表

- `packages/tui/src/shell/types.ts` — ShellViewMode 新增 `"pending"`
- `packages/tui/src/shell/view-model.ts` — shellText 扩展、createShellViewModel 逻辑、mapRequestActivityToView 扩展、formatBackground 窄终端、mapBackgroundSummariesToBlocks completed→partial
- `packages/tui/src/shell/view-model.test.ts` — 更新 3 个现有测试 + 新增 32 个测试
- `packages/tui/src/shell/plain-renderer.ts` — permission risk 显示、status tray 长度控制、pending viewMode 支持
- `packages/tui/src/shell/ink-renderer.tsx` — unmount/rerender/clear 异常保护
- `packages/tui/src/shell/theme.ts` — no-color 颜色改为 undefined
- `packages/tui/src/shell/components/ShellApp.tsx` — pending viewMode 路由、ActivityIndicator colorMap 类型
- `packages/tui/src/shell/components/Composer.tsx` — max visible lines、cursor fallback、no-color 前景色
- `packages/tui/src/shell/components/StatusTray.tsx` — 窄终端保留 background（丢弃 index）
- `packages/tui/src/terminal-readiness-presenter.ts` — sanitizePrimary 保留 basename
- `packages/tui/src/index.ts` — P1-6 submittedPending 真实接线（D.12B Closure）

未触碰：provider loop、model gateway、job/runner 状态机、permission approval 语义、ProcessGuard、index-runtime、architecture-runtime。

---

## 真实 smoke 观察清单

1. 极矮终端（height < 16）下 composer 是否被裁剪
2. 快速连续 resize 是否产生闪烁/残影
3. Emoji 在 status tray / output block 中的对齐
4. "details" 输入在权限态的实际路由行为
5. Windows PowerShell 7 / cmd / Windows Terminal 下的实际渲染效果
6. alternateScreen 进入/退出在各终端模拟器下的兼容性
7. kittyKeyboard mode="auto" 在非 Kitty 终端下的降级行为
8. no-color + 浅色终端主题下文本可见性（P2-5 修复后验证）
9. 超长 composer 输入（> 5 行）的省略提示是否清晰
10. permission placeholder 在实际权限流程中的用户体验

---

## D.12B Closure — 真实接线修复（2026-05-25）

### P1-6 Home 闪烁缓解：已接入真实 Ink Controller

view-model 层的 `submitted` flag 已从 `index.ts` Ink shell controller 真实接线：

- `index.ts` 新增 `let submittedPending = false` 闭包状态
- `getViewModel()` 传入 `submitted: submittedPending`
- `onInput` 中：用户 Enter 提交后立即 `submittedPending = true` + `shell.rerender()` + `waitUntilRenderFlush()`，确保 UI 在 `processTuiLine` 异步处理前切换到 `"pending"` viewMode
- `processTuiLine` 调用包裹在 `try/finally` 中，`finally` 保证 `submittedPending = false` + `shell.rerender()`，即使 `processTuiLine` 抛异常也不会卡在 pending viewMode
- Escape 路径同样清除 `submittedPending`
- 不吞异常、不新增 catch、不改 provider loop/permission/job 语义

效果：用户按 Enter 后不再闪回 home 布局，而是立即进入 task/pending 布局等待响应；异常路径下 pending 状态自动恢复。

### denialFeedback 接线确认

`denialFeedback` 是 view-model 层的防御性设计。实际 deny/cancel 反馈已通过以下路径流转：

```
cancelPendingInteraction() → writeLine(output, "已拒绝/已取消...") → ShellBlockOutput → outputBlocks → createShellViewModel
```

因此 `denialFeedback` option 作为备用路径存在，当前主路径无需额外接线。

### no-color Composer placeholder 修复

`Composer.tsx` 中 placeholder 颜色从硬编码 `"gray"` 改为：
- no-color 模式：`undefined`（使用终端默认前景色，确保浅色主题可见性）
- color 模式：保持 `"gray"`

### 新增改动文件

- `packages/tui/src/index.ts` — submittedPending 状态接线

---

## 声明

- 未真实 smoke
- 未 Beta PASS / smoke-ready / open-source-ready
- 本补丁基于 D.12A 审计的源码级修复，所有 P2 级遗留项需要真实终端验证
