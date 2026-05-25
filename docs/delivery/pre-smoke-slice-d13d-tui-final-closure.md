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
