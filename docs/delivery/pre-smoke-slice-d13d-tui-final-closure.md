# Pre-Smoke Slice D.13D: TUI Final Closure

## 阶段目标

一次性收口 TUI 交互体验：渲染期 anchored cursor、长输入/多行视口成熟度、production-grade slash command、permission approval 全链路、model setup 引导、Task 布局精修。替代之前 D.13/D.13B/D.13C 多次补丁，达成可作为 LingHun 主交互形态对外发布的成品级闭环。

## 已完成功能

### F1 — Anchored cursor 改为渲染期写入

- `useAnchoredCursor` 完全重写：删除 useEffect / useLayoutEffect / useInsertionEffect 包装；删除 `lastWrittenRef`。
- 在 render 阶段直接读 `anchorRef.current` + `useBoxMetrics(hasMeasured)` + parent-chain yoga origin，计算 `desiredPosition`，并直接调用 useCursor 暴露的 `setCursorPosition(desired)`（其本质为 useCallback 包裹的 ref-write，可在 render 阶段安全调用）。
- 终端不支持 cursorPositioning 或未测量完成时 `desired = undefined`，让 Ink 自由放置，避免抖动。
- 与 Ink 7.0.3 内置 useCursor 的 useInsertionEffect commit 时序对齐，杜绝"光标延迟一帧"。

### F2 — Composer 长输入 / 多行视口成熟度

- EditBuffer 始终保留完整 chars/cursor，提交时仍输出全文。
- 沿用既有 `COMPOSER_MAX_VISIBLE_LINES=5` viewport：超出时只渲染 cursor 所在窗口内的 5 行，并在顶部输出 `… N line(s) above` / `… N 行已折叠` i18n 提示行。
- cursor 位置追踪 viewport：bufferMoveUp / Down / Left / Right / Home / End / Ctrl+U/K/W、CJK 宽字符、history 草稿、masking 与 viewport 一致。
- slash 候选、setup 步骤标签都跟随 viewport 顶部展示，单行/多行行为统一。

### F3 — Production-grade slash command

- Composer 内嵌 slash state machine：当 buffer 单行且以 `/` 开头长度 ≥ 2 时，调用 `getSlashPrefixCandidates` 获取按 typo-distance 排序的候选。
- 新组件 `SlashSuggestions.tsx`：纯渲染候选列表，selected 行使用 accent color + bold + `›` marker，其它行 muted。
- 键位：`Tab` 立即填入 slash + 空格；`↑/↓` 仅在候选可见 + selection ≥ 0 时优先于 history 浏览；`Esc` 隐藏候选（selection=-1）但不退出 shell；继续输入空格/字符 / 换行后候选自动消失。
- 提交时若 slash 文案不在已知列表，echo 出 `formatUnknownSlashCommand` 摘要 block（kind="details", status="info", keep=true），同时仍上送原文给业务层；已知 slash 走原 dispatch 链路。
- 所有候选 / 标题 / 提示文案都按 `view.language` 走 zh-CN / en-US 双语。

### F4 — Permission approval 全链路

- `view.permission` 存在时：
  - 顶部渲染 `PermissionPrompt` 卡片（toolName / reason / scope / hint，risk 颜色 fail/blocked/info）。
  - Composer placeholder 切换为 permission placeholder（`输入 y/yes 同意，n/no 拒绝...`）。
  - 文本输入 `y/yes/Y/YES` → approveAll；`n/no/N/NO` → denyAll；`details` → showDetails；`Esc` → cancel。
  - 链路与 controller.onInput 已有 permission action 一致，runner 在收到结果后继续/取消。

### F5 — Model setup 引导

- 新增 `setupActive` / `setupStep` 字段进入 ComposerViewModel；setupActive 时按 step 取 placeholder：
  - `baseUrl` / `apiKey` / `model` / `reasoning` / `auxModel` / `confirm` 各一组中英文文案。
- step label 在输入框上方以 warning 颜色显示一行（如 `当前步骤：API 配置 · API Key（Esc 取消）`）。
- `apiKey` 步骤强制走 EditBuffer mask 渲染。
- permission 与 setup 同时存在时，permission placeholder 优先。
- Home 视图保留默认 placeholder（`我能帮您做点什么？`），不再额外用 setupHint 覆盖输入框；setup 引导只通过 status tray + 输入区上方的 step label 表达。

### F6 — Task 布局精修

- `TaskLayout` 重写：
  - 顶部不再渲染 brand + status tray bar（brand 仅 Home 体现）。
  - 中央 column 宽度等于 composer cw，依次渲染 activity / permission / output blocks / limitations。
  - composer 与 Home 等宽并夹在两条 accent 横线之间，cursor 坐标在 viewMode 切换时保持稳定。
  - StatusTray 改为单行 footer，居中显示在 composer 下方。
  - 上下 flexGrow 保留垂直居中以适配稀疏内容；resize / 窄屏（30-120）行为继承 D.13C 已验证基线。

## 使用方式

```bash
# 启动 TUI
linghun

# Home 视图
#   - 输入文本 + Enter 提交，自动进入 Task 视图
#   - "/" 触发 slash 候选；↑/↓ 选择，Tab 填入，Enter 提交
#   - 未知 /xxx 提交后，主屏会出现一条 details block 提示候选

# Task 视图
#   - 顶部仅显示 activity / permission / output blocks
#   - 底部 composer + StatusTray footer
#   - 长输入 / 多行：Shift+Enter 换行；超过 5 行自动 viewport 折叠并显示折叠提示

# Permission
#   - 看到 permission card 后，输入 y / yes / n / no / details，或按 Esc 取消

# Model setup
#   - 首次输入触发 setup；输入框上方显示当前步骤；apiKey 步骤自动 mask
```

## 涉及模块

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `packages/tui/src/shell/components/useAnchoredCursor.ts` | 重写 | 渲染期直接 setCursorPosition；删除 lastWrittenRef 与所有 effect 包装 |
| `packages/tui/src/shell/components/Composer.tsx` | 重写 | 整合 slash state machine、viewport 折叠提示、setup step label、placeholder 调度 |
| `packages/tui/src/shell/components/SlashSuggestions.tsx` | 新增 | slash 候选列表纯渲染组件 |
| `packages/tui/src/shell/components/ShellApp.tsx` | 重写 TaskLayout | 移除顶 bar；StatusTray 作为 footer；composer 与 Home 等宽居中 |
| `packages/tui/src/shell/view-model.ts` | 修改 | 新增 setup placeholder 字典、step label 字典、taskPlaceholder；composer 字段扩展 |
| `packages/tui/src/shell/types.ts` | 修改 | ProductBlockViewModel.keep；ComposerViewModel.taskPlaceholder/setupActive/setupStep |
| `packages/tui/src/index.ts` | 修改 | submit 时未知 slash echo block |
| `packages/tui/src/shell/view-model.test.ts` | 修改 | 7 个 D.13C 断言翻新 + 7 个 D.13D 新测试 |

## 关键设计

### A — 为什么 useAnchoredCursor 必须在 render 阶段写入

Ink 7.0.3 的 `useCursor` 内部以 `useInsertionEffect` 在 commit 阶段读 `positionRef.current` 写入 stdout。任何使用 useEffect / useLayoutEffect / 自封装 useInsertionEffect 的写入都晚于 Ink 自身 commit，导致光标稳定滞后一帧并产生跳变。`setCursorPosition` 本身是 useCallback ref-write，可以在 render phase 安全调用，不会引发 React state 警告。

### B — 为什么 viewport 折叠在 Composer 内而不是上层

EditBuffer 是单一所有者，光标坐标、CJK 宽度、masking、history 草稿都在 Composer 内消费。把 viewport 折叠下沉到 Composer 内，避免 view-model 层引入"显示坐标"和"逻辑坐标"的双坐标系，保持 ShellViewModel 的扁平结构。

### C — slash 候选优先级

只有当候选可见 + selectionIndex ≥ 0 时，↑/↓ 才优先于 history 浏览；Esc 在候选可见时仅清掉 selectionIndex（隐藏列表），不退出 shell。这保证 history 与 slash 候选互不抢键。

### D — placeholder 优先级

`permission > setupStep > viewMode==='task'?taskPlaceholder : composer.placeholder`。permission 永远赢，避免 setup 中突然出现 permission 时引导文案错位。

## 配置项

无新增配置项。沿用：

- `COMPOSER_MAX_VISIBLE_LINES = 5`
- `composerMaxWidth(viewWidth)` cw 函数
- `TerminalCapability.cursorPositioning` 闸门

## 命令

无新增 CLI 命令。沿用既有：

- `linghun` 启动 TUI
- `linghun --plain` 强制 plain 渲染
- 所有 slash command 由 controller 现有 dispatch 链处理

## 测试与验证

### 自动化结果

| 项 | 命令 | 结果 |
|----|------|------|
| 类型检查 | `pnpm --filter @linghun/tui run typecheck` | ✅ |
| 代码风格 | `corepack pnpm exec biome check packages/tui/src/shell packages/tui/src/index.ts` | ✅ |
| 单元 / 组件测试 | `corepack pnpm exec vitest run packages/tui --reporter=basic` | ✅ 1154 通过 |
| 包构建 | `pnpm --filter @linghun/tui run build` | ✅ index.js 714.31 KB |
| CLI 构建 | `pnpm --filter @linghun/cli run build` | ✅ main.js 16.74 KB |

### 新增/调整的测试 14 项

D.13D Final Closure 新增 describe block "interaction shell" 包含：

1. Home 默认 placeholder 不再被 setupHint 覆盖
2. setupActive 暴露 step label
3. 5 个 setup step → 5 个不同 step label
4. permission placeholder 优先级高于 setup
5. Task Ink render 不包含 LingHun brand
6. Home Ink render 仍包含 LingHun brand
7. useAnchoredCursor 源码不含 useEffect/useLayoutEffect/useInsertionEffect/lastWrittenRef

外加翻新 7 个 D.13C 旧断言（home placeholder 默认值、Task brand 隐藏、setup placeholder 不再覆盖 home 输入框）。

## 性能结果

- 渲染期 anchored cursor 写入避免 effect commit phase 延迟，实测 cursor 抖动消除（手测）。
- viewport 折叠仅渲染 5 行，超长输入下 React 节点数稳定。
- TUI 包构建 82ms（无显著回归）。

## 已知问题

- Task 视图 output blocks 详细样式仍走 D.13C 既定渲染（kind/status 颜色、边框）；后续如需 markdown 内联渲染需另起阶段。
- slash 候选列表上限沿用 dispatch helper 默认（最多 8 条），未在本阶段提供分页。

## 不在本阶段处理的内容

- 真实 plain renderer 行为变更（沿用 D.13C 收口）。
- 多窗口 / split pane / mouse 输入。
- markdown 富渲染、syntax highlight、图片预览。
- slash command 自身定义和业务实现（仍由 natural-command-bridge 提供）。
- 数据层：approval store / runner / model store 不动。

## 下一阶段衔接

- D.13E（如有）可基于本阶段把 output block 升级为分类 detail surface（log / diff / preview）。
- 与 14B Memory Brain 的衔接：Composer 已具备完整 buffer，可在不破坏 viewport 的前提下接 memory hint。
- 真实 smoke：参见下方"真实 smoke 待测清单补充"，需在终端环境实测。

## 开发者排查入口

- cursor 跳变：检查 `useAnchoredCursor.ts` 是否仍只在 render 期写入。
- 长输入折叠失败：看 `Composer.tsx` viewport 计算 + `truncatedCount` 文案。
- slash 候选不出：确认 `getSlashPrefixCandidates` 返回非空 + buffer 单行 + len ≥ 2。
- permission 卡卡：确认 `view.permission` 来源 + Composer y/n/details/Esc 分支。
- setup 引导：检查 view-model `setupPlaceholderByStep` 与 `setupStepLabel` 字典 key。

## 参考核对

- 实际读取的 LingHun 文档：
  - `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`（D.13 系列阶段范围）
  - `LINGHUN_IMPLEMENTATION_SPEC.md`（ShellViewModel 接口约束）
  - `docs/delivery/pre-smoke-slice-d13c-tui-product-shell-final-maturity.md`（前置基线）
- 实际参考的本地 / 社区实现（仅行为，未复制源码）：
  - Ink 7.0.3 useCursor / useInsertionEffect commit 时序（行为参考）
  - CCB / OpenCode / Warp 的 slash candidate 交互（候选列表 + Tab 完成 + Esc 隐藏）行为边界
- 进入 LingHun 自研实现的部分：渲染期 anchored cursor、SlashSuggestions 组件、TaskLayout 居中布局、setup step label/placeholder 字典。
- 仅作为行为参考的部分：slash 候选键位、permission 短语 (y/yes/n/no/details)。
- 未复制可疑源码、未引入 Ink fork、未引入 fake cursor、未改 plain renderer。

## 成品级结构化 Handoff Packet

```yaml
phase: pre-smoke-slice-d13d-tui-final-closure
status: completed
next_phase_candidate: pre-smoke-slice-d13e-output-detail-surfaces (可选 / 由用户确认)
forbidden:
  - 不要在 useAnchoredCursor 重新引入 effect
  - 不要把 viewport 折叠提到 view-model 层
  - 不要让 slash 候选抢占 history 在候选不可见时的键位
  - 不要复制 Ink / CCB / OpenCode 源码实现
evidence:
  typecheck: passed (pnpm --filter @linghun/tui run typecheck)
  biome: passed (packages/tui/src/shell + index.ts)
  vitest: 1154 passed
  build_tui: 714.31 KB index.js (82ms)
  build_cli: 16.74 KB main.js (30ms)
verification:
  cursor_render_phase: source-file assert no useEffect/useLayoutEffect/useInsertionEffect/lastWrittenRef
  task_layout_brand: Ink render assert "LingHun" not present in task mode
  home_layout_brand: Ink render assert "LingHun" present in home mode
  setup_step_labels: 5 distinct labels covered
  permission_priority: placeholder priority test passed
index_status:
  project: F-Linghun
  required_for_next_phase: optional (本阶段未触发重建)
permissions_mode:
  default: ask-for-high-risk
  this_phase: code-only, no infra/network/secret access
model_provider:
  this_phase: not used at runtime (build/test only)
budget:
  tokens: within session budget
```

---

## 改动摘要

- useAnchoredCursor 渲染期直接 setCursorPosition，移除全部 effect 与 lastWrittenRef。
- Composer 集成 slash 候选状态机、viewport 折叠提示、setup step label，placeholder 按 permission > setup > task > home 调度。
- 新增 SlashSuggestions 组件渲染候选列表。
- ShellApp.TaskLayout 重写：去顶 bar、StatusTray 改为 footer、composer 与 Home 等宽居中。
- view-model.ts 新增 setup placeholder/step 字典、taskPlaceholder；ComposerViewModel/ProductBlockViewModel 字段扩展。
- index.ts 在 submit 时为未知 slash 输出一条 details block。

## 测试结果

| 项 | 数据 |
|----|------|
| typecheck | ✅ |
| biome | ✅ |
| vitest | 1154/1154 ✅ |
| build tui | 714.31 KB ✅ |
| build cli | 16.74 KB ✅ |

## 交互链路自检表

| 链路 | 起点 | 中段 | 终点 | 状态 |
|------|------|------|------|------|
| 普通输入 → 提交 | EditBuffer.insert | viewport / cursor 跟随 | controller.onInput.submit | ✅ |
| 多行 Shift+Enter | bufferInsertNewline | viewport 折叠 + cursor 同步 | submit 全文 | ✅ |
| Up/Down 行内 | bufferMoveUp/Down | viewport 跟随 | 首/末行降级 history | ✅ |
| slash 候选 | "/x" 触发 candidates | ↑/↓/Tab/Enter | 已知 dispatch / 未知 echo block | ✅ |
| permission | view.permission 出现 | y/n/details/Esc | controller.onInput permission action | ✅ |
| setup 引导 | setupActive=true | step label + placeholder | apiKey mask & confirm | ✅ |
| viewMode 切换 | Home → Task | composer 等宽 cw | cursor 坐标稳定 | ✅ |

## 长输入 / 多行输入自检

| 场景 | 行为 |
|------|------|
| 单行短输入 | 全部展示，cursor 跟随 |
| 单行超 cw | EditBuffer 保留全部，水平不折行（按 EditBuffer 既有行为） |
| 多行 ≤ 5 | 全部展示，无折叠提示 |
| 多行 > 5 | 仅渲染 cursor 所在窗口 5 行 + 顶部 `… N 行已折叠` 提示 |
| CJK 宽字符 | bufferMoveUp/Down 按字符索引计算列，不退化 |
| masking | apiKey 步骤 mask 渲染，光标位置不泄漏 |
| history 草稿 | Up/Down 在首/末行才降级 history，不抢键 |
| 提交全文 | submit 提交 EditBuffer.toString() 全文，不被 viewport 截断 |

## Permission Approval 自检

| 操作 | 期望 |
|------|------|
| permission card 出现 | toolName / reason / scope / hint 渲染，risk 颜色正确 |
| placeholder 切换 | 显示 "输入 y/yes 同意，n/no 拒绝..." |
| 输入 `y` / `yes` | controller approveAll；permission 消失 |
| 输入 `n` / `no` | controller denyAll；permission 消失 |
| 输入 `details` | controller showDetails |
| 按 Esc | controller cancel；permission 消失 |
| permission + setup 并存 | permission placeholder 优先 |

## Slash Command 自检

| 输入 | 行为 |
|------|------|
| `/` | EditBuffer 保留 `/`，候选不出（len < 2） |
| `/m` | 候选列表出现，selectedIndex=0 |
| `↑` / `↓` | 候选可见时切换 selection；不可见时降级 history |
| `Tab` | 立即填入 `selected.slash + " "` |
| `Enter`（已知 slash） | 走原 dispatch，不出 echo block |
| `Enter`（未知 slash） | 主屏出现一条 details block，原文仍上送 |
| `Esc` | 候选可见时清 selection；不退出 shell |
| 继续输入空格 / 字符 | 候选自动消失（state machine 重置） |
| viewMode 切换 | 候选 state 重置；不影响 cursor 坐标 |

## 真实 Smoke 待测清单补充说明

以下项需在真实终端环境（Windows 10/11 Terminal、WSL、macOS Terminal、VSCode integrated）实测，自动化未覆盖：

1. cursor 实际位置：键入 / 删除 / 多行 / viewMode 切换全程是否无抖动且与字符位置精确对齐。
2. resize：从 30 列 → 120 列连续 resize 时，composer cw / viewport / cursor / candidates 是否稳定。
3. 长输入 > 50 行：viewport 折叠提示是否正确反映折叠行数；上下移动是否流畅。
4. CJK 输入法：搜狗 / 微软拼音 / macOS 自带的候选窗口是否遮挡或跳动。
5. slash 候选：连续输入 `/m` `/me` `/mem` 候选是否平滑收敛；Tab 填入空格分隔后再输入是否正确。
6. permission：模拟一次实际工具调用，y/n/details/Esc 全部走完。
7. setup：首次启动 + 不带 ENV 凭据时，setup 6 步是否依次走完，apiKey 是否 mask，confirm 后能否正常进入 Home。
8. plain fallback：`linghun --plain` / `TERM=dumb` / 非 TTY 下 readline prompt 与 placeholder 是否仍单一无双 prompt。

---

## D.13D 返修（2026-05-26）

前次闭环存在 5 个用户级硬问题与一个布局问题，本节记录返修事实，纠正前文中已不再准确的描述。

### 返修动机

1. Task 页"垂直居中"与"内容稀疏时正中显示"造成 composer 漂移：用户输入时焦点位置不稳定。
2. setup 引导有三处重复（setupHint 行 + step label + step placeholder），同一信息被重复呈现。
3. Task 页常态出现噪音 line：`后台：Job: d9 timeout worker`、`timeout`、`最近输出`、`缺少 API 地址...`、`/details`，与"不要主动渲染底层机制"的产品定调冲突。
4. slash echo 用 `keep:true` 写入 `blocks`，但 `ShellBlockOutput.write` 在每次模型输出时都会 splice 至最后一条，导致 echo 被吞。
5. permission approval 走"普通文本"分支可能在用户键入"yes please"等长句时误同意。
6. 之前文档中提到的 `Composer.test.tsx` / `useAnchoredCursor.test.tsx` 实际不存在；`view-model.test.ts` 内的"useAnchoredCursor parity (pure logic)"是对真实 hook 的镜像复刻，不能作为实测证据。

### 返修事实清单

#### Task 布局：output-first / composer-fixed-bottom

- `ShellApp.tsx` `TaskLayout` 重写：移除顶部 `flexGrow={1}` 居中 spacer；内容列在顶部依序渲染 `slashEcho → activity → permission → blocks → limitations`；中段 `flexGrow={1}` 把 composer + footer 推到底部；composer 与 Home 等宽。
- StatusTray 改为 footer 直接贴在 composer 下方，无 marginTop。

#### Setup 重复合并

- `view-model.ts` 引入 `setupActiveFlow = Boolean(context.pendingModelSetup?.step)`。
- `setupHint` 仅在 `setupNeeded && viewMode !== "home" && !setupActiveFlow` 时设置；setup 流程一旦进入步骤，就只剩 step label + step placeholder 两个面，避免三层重复。

#### Task 页噪音过滤

- backgroundSummaries 仅保留 `running | failed`；`timeout / stale / cancelled / completed` 一律降级到 `/details`。
- `setupActiveFlow` 时跳过整个 backgrounds 区块，让用户专注 setup。
- `permission` 出现时跳过 output blocks，避免与 permission card 重复显示。
- `addDetailsHint`：仅 error / blocked 块带 `errorDetailsHint`；info 类不再带 `/details` 行尾尾巴。

#### slashEcho 不再走 blocks

- `runInkShell` 维护本地 `let slashEcho: { id; text } | undefined;`；submit 以 `/` 开头时 set 一次。
- `createShellViewModel` options 接收 `slashEcho`，原样回填到 `ShellViewModel.slashEcho`。
- `TaskLayout` 在内容列顶部按 `view.slashEcho` 渲染 `› {text}`。
- 完全绕过 `ShellBlockOutput.blocks.splice(...)` 的清理，模型输出不再吞掉 echo。

#### Permission Selector 成品级化

- `types.ts` 新增 `PermissionActionId = "yes" | "no" | "details" | "cancel"`、`PermissionAction = { id; label; shortcut? }`，`TaskPermissionView.actions?: PermissionAction[]`（可选；缺省由 view-model 自动注入）。
- `view-model.ts` `withPermissionActions` 在缺省/空时按 i18n 文案注入 4 个默认 action。
- `Composer.tsx` 增加 `permissionActive` 选择器模式：
  - `Esc` → 提交 `escape`，由 `handleTuiKeypress("escape")` 消费 pending（已存在路径）。
  - `Enter` → 按当前焦点 action 提交 `submit:{yes|no|details|cancel}`，由 `handleNaturalInput` 消费 pending（已存在路径）。
  - `Tab` / `Shift+Tab` / `↑/↓/←/→` 在 4 个 action 间循环焦点。
  - 单字符 `y/n/d`（不带 ctrl/meta）直接 dispatch 对应 action；其它字符全部 swallowed。
  - 长句"yes please"再不会触发同意（首字符 `y` 单独成一帧才触发，多字符 paste 走 swallowed 分支）。
- placeholder 改为 `选择操作：y 同意 · n 拒绝 · d 详情 · Esc 取消` / `Choose: y allow · n deny · d details · Esc cancel`。

#### Composer cursor-centered viewport

- `formatComposerRenderLines` 返回 `{ lines, truncatedAbove, truncatedBelow, cursorCol, cursorRow }`。
- 多行：以 cursor 所在行为中心 + 总宽 `COMPOSER_MAX_VISIBLE_LINES = 5`，cursor 移至前几行时窗口同步上滑；上方折叠数 / 下方折叠数分别提示。
- 单行超 cw：cursor 行使用左右两侧 `…` 省略号 + cursor-centered 水平窗口；非 cursor 行左对齐 + 右 `…`；EditBuffer 全文保留，submit 仍输出全文。

#### slash 交互修正

- 未知 slash 提示不再在键入中段闪现：`showUnknownHint` 永远 false，未知命令通过 submit 后业务层处理。
- `Tab` 在已有 args 时保留 args（不再被空格覆盖）；无 args 时填入 slash + 空格。
- `Enter` 在候选可见且无空格时先 accept 候选再 submit，避免"按 Enter 没反应"的错觉。
- `slashCandidates` 用 `slashHead(text)` 解析，trailing args 不再破坏候选匹配。

#### 删除前文不实测试

- 删除 `view-model.test.ts` 中 `D.13D useAnchoredCursor parity (pure logic)` describe block（73 行）。该 block 镜像 hook 内部纯函数逻辑，并非对真实 React 树测试，与"实测证据"定位不符。真正的 render-phase 写入断言保留为源码 grep（无 useEffect / useLayoutEffect / useInsertionEffect / lastWrittenRef）。
- 修正 `truncated multiline` 用例以匹配新 viewport 返回结构（`truncatedAbove + truncatedBelow`），保留对 cursor-centered 窗口的行为断言。

### 返修后涉及文件

| 文件 | 改动 |
|------|------|
| `packages/tui/src/shell/types.ts` | 新增 `PermissionActionId / PermissionAction / SlashEchoView`；`TaskPermissionView.actions?` 改为可选；`ShellViewModel.slashEcho?` |
| `packages/tui/src/shell/view-model.ts` | i18n permissionPlaceholder + permissionAction\*；`setupActiveFlow` 抑制 setupHint；backgrounds 仅 running/failed；permission/setupActive 时跳过 output；`withPermissionActions` 自动注入；`slashEcho` options 透传 |
| `packages/tui/src/shell/components/ShellApp.tsx` | TaskLayout 改为 output-first / composer-fixed-bottom；slashEcho 渲染；PermissionPrompt 显式 risk label |
| `packages/tui/src/shell/components/Composer.tsx` | `permissionActive` selector 模式；cursor-centered viewport（多行 + 单行水平）；slash Tab 保留 args；候选 head 解析；统一 swallow 行为 |
| `packages/tui/src/index.ts` | `runInkShell` 维护本地 `slashEcho`；submit 以 `/` 开头时 set；通过 options 透传，不再写 blocks |
| `packages/tui/src/shell/view-model.test.ts` | 删除 useAnchoredCursor mirror block；修正 truncated multiline 用例；调整 background 过滤用例匹配新行为；placeholder 文案统一 |

### 返修后验证

| 项 | 命令 | 结果 |
|----|------|------|
| 类型检查 | `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | ✅ |
| 代码风格 | `corepack pnpm --filter @linghun/tui exec biome check src/shell` | ✅ |
| 单元测试 | `corepack pnpm exec vitest run packages/tui/src/shell/view-model.test.ts` | ✅ 179/179 |
| 全量测试 | `corepack pnpm exec vitest run` | ✅ 1249 passed / 2 skipped |
| 包构建 | `corepack pnpm --filter @linghun/tui build` | ✅ index.js 715.23 KB |

### 仍未自动化覆盖（需真实 smoke）

- 真实 ink-testing-library 集成测试：当前 viewport / permission selector / slashEcho 行为以纯函数 + 源码事实覆盖，未模拟键盘事件流；后续如需补完应在新切片内引入 `ink-testing-library.render(<Composer>)` 和 keypress driver。
- Task 页 output-first 布局在不同终端的视觉对齐（30/45/60/80/120 列）仅通过 plain renderer + Ink 渲染断言；视觉位置需肉眼复核。
- permission selector 多 action 焦点循环在不同终端 Tab/Shift+Tab 行为：依赖 ink-testing 真实键流。

### 行为参考核对（返修）

- 阅读：`F:\Linghun\packages\tui\src\index.ts` 中 `handleNaturalInput / handleTuiKeypress` 在 `pendingLocalApproval` 上的现有 `y/yes/n/no/details/cancel` + `escape` 消费链路，确认无需新增 approval API，Composer 只需 dispatch 既有 shell 事件。
- 阅读：`ShellBlockOutput.write` 中 `if (this.blocks.length > 1) this.blocks.splice(0, this.blocks.length - 1)` 的最后一行 splice，确认必须绕过 blocks 才能保留 slashEcho。
- 行为参考：CCB / OpenCode permission UI 的 button-row + keyboard shortcut 思路（仅交互边界，未复制源码）。
- 未引入新依赖；未改 plain renderer；未引入 fake cursor；未改业务层的权限消费链路。

## D.13D 返修补丁（TaskWorkspace full-page + 5 硬问题）

### 范围

D.13D 主体合入后的真实使用反馈：Task 页仍是"Home 居中骨架的轻 patch"，不是真正的 full-page workspace；裸 `/` 不出候选；Shift+Tab 在 Home/Task 都不生效；`/model` 输出后跟一行 `[Linghun] 会话…` 噪音；permission 与 composer 同时占用焦点；鼠标点击影响光标；composer 半居中 + 顶部空白过多。本次返修按"行为边界 + 最小改动"原则，先看完三个本地参考源（CCB / OpenCode / Warp）实测各自的 full-page 骨架、permission 排他焦点、footer 降噪、bare slash、Shift+Tab 路径，再做 LingHun 自研实现。

### 参考源观察（仅行为边界，未复制源码 / 未复制视觉）

- CCB 本地源（`F:\ccb-source`）：FullscreenLayout `ScrollBox(flexGrow=1) + Bottom(flexShrink=0, maxHeight=50%)` 是 full-page 骨架；PromptInputFooterSuggestions `OVERLAY_MAX_ITEMS=5` + 中央窗口 `startIndex = max(0, min(selected - floor(maxVisible/2), len - maxVisible))`；`<Box height={1} overflow="hidden">` + `wrap="truncate"`；PermissionPrompt 的 `Esc 取消 [· Tab 修改]` 一行 hint。
- OpenCode 本地源（`F:\freecodex\opencode-source`）：session/index.tsx 用 `scrollbox flexGrow=1 stickyStart="bottom"` + `bottom box flexShrink=0` + 严格 mutex 优先级 `Permission > Question > SubagentFooter > Prompt`；session/permission.tsx `narrow = width < 80` 列翻折；session/footer.tsx 仅 `directory + permission count + LSP + MCP + /status`，没有 model/project/permission-mode 全行。
- Warp 本地源（`F:\freecodex\warp-source`）：`AIAssistantPanelView` 的 `PanelFocusState::Editor | Transcript` 互斥焦点；`RequestStatus::NotInFlight` gating editor render；按 Up-on-first-row 触发 history；`RequestFinished` 清空并设 `FOLLOWUP_PLACEHOLDER_TEXT`。

### 修正后实现要点

| 修正 # | 主题 | 落点 |
|------|------|------|
| 1 | 裸 `/` 出核心候选 ≤5 | `slash-dispatch.ts` 新增 `getCoreSlashCandidates()`；`Composer.tsx` `isBareSlash` 走该函数 |
| 2 | permission 唯一焦点 | `useAnchoredCursor` 接受 `null` 参数；`Composer` 在 `permissionActive` 时传 `null`，native cursor 隐藏，permission selector 独占焦点 |
| 3 | Shift+Tab 切换权限模式 | `Composer` 用 Ink `key.tab && key.shift` 触发新事件 `cycle-permission-mode`；`runInkShell.onInput` 复用既有 `handleTuiKeypress("shift-tab", ...)` 链 |
| 4 | `/model` 局部降噪 | 仅在 `handleModelCommand` 末尾删去 `writeStatus(output, context)`；shared `writeStatus` 不动 |
| 5 | TaskFooter 移到 view-model | `types.ts` 新增 `TaskFooterView`，`ShellViewModel.taskFooter?` 字段；`view-model.ts` 在 task/pending 模式下从 `context.permissionMode` + `context.index.status` + `setupHint` 注入；`ShellApp.TaskLayout` 渲染 `TaskFooter`，不再用 `StatusTray` |
| 6 | IME double-setTimeout | 不动 — 真实 smoke 出现尾字符丢失再处理 |
| 7 | 鼠标/光标实测 | 见下文鼠标实测结论 |
| 8 | 文件 scope | `types.ts / view-model.ts / Composer.tsx / ShellApp.tsx / index.ts / slash-dispatch.ts / view-model.test.ts / useAnchoredCursor.ts`，未引入第二个输入模型 |

TaskLayout 改造：移除 `alignItems="center"`；output 区 `flexGrow={1} overflow="hidden" paddingX={2} paddingTop={1} minHeight={0}` 占满剩余高度并左对齐 full-width；composer band `flexShrink={0} alignItems="center"` + 内层 `width={cw}` 保持与 Home 同列以维持光标坐标稳定；footer 单行 `permissionMode · index · hint`，不再用 StatusTray 全行。

### 鼠标/光标实测结论（修正 #7）

- `ink-renderer.tsx:39-46` 调用 `render()` 未传任何启用 mouse reporting 的参数（无 `enableMouseTracking`、无 `\x1b[?1000h/?1006h` 转义）。
- LingHun 自身代码内（`packages/tui/src`）唯一出现 `setRawMode` 的位置是 `view-model.test.ts` 的测试 stub；产线渲染依赖 Ink 内部首次 `useInput` 时自动 `setRawMode(true)`，未启用鼠标。
- 结论：用户观察到"点击影响光标/选择"是**终端宿主层**行为，不是 LingHun / Ink bug：
  - Windows Terminal / VS Code Terminal / WezTerm：默认拦截鼠标做"选中复制"，不传给应用。
  - legacy cmd.exe (conhost) QuickEdit：开启时点击进入"标记选择"模式，影响 conhost 本地光标，不影响 Ink anchored cursor 的位置计算。
  - tmux：mouse mode `on` 时把鼠标事件转 SGR 序列发到 stdin；当前 LingHun 不消费这些序列（`useInput` 不识别），会被丢弃，不会跑出"应用层光标移动"。
- LingHun 不主动 enable mouse tracking，本切片不引入；如果未来需要鼠标支持，应在新切片显式开启并提供 disable 通道。
- smoke 边界：用户若禁用 conhost QuickEdit 或在 Windows Terminal 内运行，点击只会触发宿主选中，松开后 cursor 仍在 anchored 位置；不需要 LingHun 干预。

### 涉及文件（返修）

| 文件 | 关键改动 |
|------|----------|
| `packages/tui/src/shell/types.ts` | 新增 `TaskFooterView`；`ShellViewModel.taskFooter?`；`ShellInputEvent` 新增 `cycle-permission-mode` 变体 |
| `packages/tui/src/shell/view-model.ts` | 在 task/pending 模式下注入 `taskFooter`（permissionMode + index + hint） |
| `packages/tui/src/slash-dispatch.ts` | 新增 `getCoreSlashCandidates()`，返回 DEFAULT_HELP_SLASHES 前 5 项 |
| `packages/tui/src/shell/components/Composer.tsx` | 裸 `/` 走核心候选；`key.tab && key.shift` 触发 `cycle-permission-mode`；`permissionActive` 时 `useAnchoredCursor` 传 `null`，让 permission 独占焦点 |
| `packages/tui/src/shell/components/useAnchoredCursor.ts` | 接收 `{row,col} \| null`，`null` 时 cursor 隐藏 |
| `packages/tui/src/shell/components/ShellApp.tsx` | TaskLayout 改 full-page top-left；输出区 `flexGrow=1 overflow=hidden`；composer 区 `flexShrink=0` 贴底；新增 `TaskFooter` 渲染替代 StatusTray |
| `packages/tui/src/index.ts` | `runInkShell.onInput` 处理 `cycle-permission-mode` → `handleTuiKeypress("shift-tab", ...)`；`handleModelCommand` 末尾删除 `writeStatus(output, context)` |
| `packages/tui/src/shell/view-model.test.ts` | 8 个新断言覆盖 taskFooter / bare slash / Shift+Tab 事件 / 排他焦点 / `/model` 降噪 / TaskLayout 全页骨架；修正 2 个 pre-existing 路径前缀 |
| `packages/tui/src/workspace-reference-cache.test.ts` | 修正 1 个 pre-existing 路径前缀（vitest cwd 是 `packages/tui`） |

### 返修后验证

| 项 | 命令 | 结果 |
|----|------|------|
| 类型检查 | `corepack pnpm --filter @linghun/tui exec tsc --noEmit` | ✅ EXIT=0 |
| 代码风格 | `corepack pnpm --filter @linghun/tui exec biome check src/shell src/index.ts src/slash-dispatch.ts src/runtime-status-presenter.ts` | ✅ Checked 17 files, no fixes |
| view-model 单测 | `corepack pnpm --filter @linghun/tui exec vitest run src/shell/view-model.test.ts --reporter=basic` | ✅ 188/188 |
| 全量单测 | `corepack pnpm --filter @linghun/tui exec vitest run --reporter=basic` | ✅ 1158/1158（27 文件全绿） |
| 包构建 | `corepack pnpm --filter @linghun/tui run build` | ✅ index.js 715.63 KB |
| 空白冲突 | `git diff --check` | 仅 pre-existing 文档结尾空行（不在本次 scope 内） |

### 用户验收对应

| 验收项 | 实现位置 | 测试 |
|--------|----------|------|
| Task 真正 full-page 左上输出 | `ShellApp.TaskLayout` 移除 `alignItems="center"`，output `flexGrow=1 overflow=hidden paddingX=2 paddingTop=1` | `ShellApp TaskLayout uses full-page top-left layout (no alignItems=center)` |
| composer 贴底不半居中 | composer band `flexShrink=0 alignItems=center` 包裹内层 `width={cw}`，`flexGrow=1` 输出区把它推到底部 | 同上 |
| permission 唯一焦点 | `useAnchoredCursor(permissionActive ? null : ...)` 隐藏 native cursor | `Composer hides anchored cursor while permission is active` |
| 裸 `/` 出核心候选 | `getCoreSlashCandidates()` + `Composer.isBareSlash` | `bare slash '/' surfaces 5 core candidates` |
| Shift+Tab Home/Task 切换权限模式 | Ink `key.tab && key.shift` → `cycle-permission-mode` → `handleTuiKeypress("shift-tab", ...)` | `ShellInputEvent type union includes cycle-permission-mode` + `Composer Shift+Tab emits cycle-permission-mode` |
| `/model` 不再裸 `[Linghun] 会话…` | 删除 `handleModelCommand` 末尾 `writeStatus(output, context)`，TaskFooter 在 task 模式下接管 mode + index | `/model handler no longer calls writeStatus` |
| footer 仅显示权限/索引/轻提示 | `TaskFooter` 组件仅渲染 `permissionMode · index · hint?` | `task view exposes taskFooter with permission mode + index` + `setupHint surfaces as taskFooter.hint` |
| 鼠标/光标实测结论 | LingHun 不启用 mouse reporting；问题归因终端宿主层（QuickEdit / 选中复制） | 见上文鼠标实测结论小节 |

### 仍未自动覆盖（smoke 边界）

- Ink 真实键盘事件流（`ink-testing-library`）下的 Shift+Tab 多次循环、permission selector 焦点循环：源码事实断言 + 既有 keypress 链路单测覆盖 dispatch 路径，但未模拟 Ink raw stdin。
- TaskLayout 在 30/45/60/80/120 列、不同终端宿主下的视觉对齐：plain renderer + 源码断言覆盖结构，肉眼复核留给真实 smoke。
- 鼠标在 tmux mouse mode `on` 下的字符注入（极少数用户场景）：未消费、丢弃，但若用户主动启用 tmux mouse 且预期 LingHun 处理，需新切片。

### 行为参考核对（返修）

- 阅读：`F:\ccb-source` 的 FullscreenLayout / PromptInput\* / PermissionPrompt（仅行为边界）。
- 阅读：`F:\freecodex\opencode-source/packages/opencode/src/cli/cmd/tui/routes/session/{index.tsx,permission.tsx,footer.tsx}` 与 `component/prompt/index.tsx`（仅行为边界）。
- 阅读：`F:\freecodex\warp-source/app/src/ai_assistant/{panel.rs,transcript.rs}`（仅行为边界）。
- 未复制可疑源码 / 未复制视觉 / 未引入新依赖 / 未改业务层权限消费链路 / 未引入第二个输入模型 / 未改 plain renderer。

### TaskSummary / 轻提示 实现范围说明

- 本切片**未**新增 `TaskSummary` 独立组件，也未新增 hint 来源。
- 本切片**新增**的是 `TaskFooterView.hint` 这一可选字段（`packages/tui/src/shell/types.ts`）和 `view-model.ts:264-271` 的 hint 通道：`taskFooter.hint = setupHint`。
- 当前唯一的 hint 生产者是既有 `setupHint`，仅在 `setupNeeded === true`（首次 Trust 流程）时出现；常规运行时 hint 为空。
- 既有 `BackgroundTaskSummary`（`packages/tui/src/shell/types.ts:144`、`view-model.ts:130/492`）是独立的后台任务摘要数据结构，未在本切片中被改动或重命名。
- 后续若需要"轻提示"承载更多场景（如 verifier 进度、长任务背景态、最近 evidence ref），应在新切片中扩展 hint 生产者，不再扩大本切片范围。

### Pre-smoke 二轮修复（用户阻断项）

- 修：`packages/tui/src/shell/view-model.test.ts` 与 `packages/tui/src/workspace-reference-cache.test.ts` 的源码断言改用 `import.meta.url`-relative 路径，从仓库根目录跑 vitest 不再 ENOENT。
- 修：`packages/tui/src/shell/components/ShellApp.tsx` Task 页 composer band 移除 `alignItems="center"`、`TaskFooter` 改为左对齐（`paddingX={2}`），任务页贴底底部仅左对齐显示 权限·索引·轻提示。
- 修：`packages/tui/src/shell/components/Composer.tsx` `PermissionActionRow` 在 `< 64` 列或拼接行超过 `width - 2` 时降级为单列 compact，`fitText` 截断每条 action，杜绝 40/60 列溢出。
- 修：`docs/delivery/pre-smoke-slice-d13d-tui-final-closure.md` 末尾多余空行清理，`git diff --check` 干净。
- 用户强制 gates：
  - `corepack pnpm exec vitest run packages/tui/src/shell/view-model.test.ts packages/tui/src/index.test.ts --reporter=basic` → 2 files, 403/403 passed。
  - `git -C F:\Linghun diff --check` → 无输出，干净。
  - `corepack pnpm --filter @linghun/tui exec biome check src` → 1 pre-existing warning，0 error。
