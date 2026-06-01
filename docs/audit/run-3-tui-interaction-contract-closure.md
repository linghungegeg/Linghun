# Run 3 — TUI Interaction Contract Closure

## Small Repair Addendum — TUI Interaction Contract Closure

本轮只修 TUI 交互合同阻塞项；未进入 Release Packaging / Bundled Runtime，未修改 provider/env/key/model route，未改权限语义，未 commit。

### A. ScrollViewport bottom-anchor

- 原问题：`task-scroll-state.ts` 明确定义 `scrollOffset` 为“从底部向上偏移”，但 `ScrollViewport` 的旧 margin 计算等价于 `stickToBottom=true -> marginTop=0`，内容溢出时显示顶部而不是底部。
- 修复：新增 `computeScrollViewportOffset(maxOffset, scroll)` 纯函数，并让 `ScrollViewport` 复用它：
  - `maxOffset = max(0, contentHeight - viewportHeight)`
  - `bottomOffset = stickToBottom ? 0 : clamped.scrollOffset`
  - `topOffset = maxOffset - bottomOffset`
  - `marginTop = topOffset > 0 ? -topOffset : 0`
- 回归：`maxOffset=20` 下 `stickToBottom=true/scrollOffset=0 -> marginTop=-20`，`scrollOffset=5 -> -15`，`scrollOffset=20 -> 0`，`maxOffset=0 -> 0` 均已由 focused tests 覆盖。

### B. Todo budget / hard cap

- 保留真实 evidence/execution 上限：`MAX_MODEL_TOOL_ROUNDS=4`。
- 新增独立总轮次 hard cap：`MAX_MODEL_TOTAL_TOOL_ROUNDS=8`，防止模型持续 Todo-only 导致长时间卡住。
- 计数语义修正：
  - Todo-only round 不增加 `evidenceRounds`。
  - 非 Todo-only tool round 增加 `evidenceRounds`。
  - `evidenceRounds >= 4` 才触发真实工具上限。
  - total loop 达 8 时安全退出；若只有 Todo，则输出“仅完成计划整理，尚未执行仓库验证 / only planning, no repository verification”口径。
  - 连续 Todo-only 超过 1 次后只注入一次有限提示，不无限追加 user hint。
- 4 Read regression：新增 final-call aware mock，避免 final answer 的 `tool_choice=none` 请求误消费工具序列；4 个 Read 均执行后才触发真实工具上限。
- 额外覆盖：1 个 Todo-only + 4 个 Read 不减少真实工具机会；多个 Todo-only 进入未验证文案；Todo-only 后接 `GitStatusInspect` / `Read` 能继续执行。

### C. Ctrl+O / ProductBlock defense

- 保留 `tool-output-presenter.ts` 当前方向：短 Read/Bash/Grep 无 hidden content 时不显示 Ctrl+O；`details` / `fullOutputPath` / `output.truncated=true` / 长输出才显示。
- 新增 `ProductBlock` 渲染层防御：若 `nextAction` 是 Ctrl+O 类提示，但 `fullText` 与 `summary` 没有实际可展开内容，则隐藏该 hint。
- 多行错误 / 长错误仍保留 “Ctrl+O 查看完整错误” 提示。

### D. 面板可见性

- 保留当前方向：CommandPanel / ConfigPanel / HelpPanel / SessionsPanel / BtwPanel 作为最新 surface 渲染在 blocks/activity 之后。
- 面板打开时 view-model 继续强制 `taskScroll={ scrollOffset:0, stickToBottom:true }`。
- 本轮通过 ScrollViewport helper 证明 `stickToBottom=true` 真正锚到底部，因此面板在内容溢出时仍可见。

### 验证结果

```
corepack pnpm exec tsc --noEmit
PASS

corepack pnpm typecheck
PASS

corepack pnpm --filter @linghun/tui exec vitest run src/shell/models/task-scroll-state.test.ts src/shell/models/tui-interaction-contract.test.ts src/tool-output-presenter.test.ts
PASS — 62 passed

corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "Todo|tool-call limit|task-scroll|CommandPanel|Ctrl\\+O|折叠"
PASS — 3 passed, 415 skipped

corepack pnpm --filter @linghun/tui exec vitest run
PASS — 2185 passed

corepack pnpm --filter @linghun/tui build
PASS

git diff --check
PASS
```

### 边界说明

- 未修改 `apps/cli/package.json`、`apps/cli/bundled/**`、`packages/tui/src/mcp-index-runtime.ts`、`packages/tui/src/index-runtime.ts`、`packages/tui/src/runner-runtime.ts`、`packages/tui/src/bundled-runtime.test.ts`、`docs/audit/release-packaging-bundled-runtime-closure.md`。
- 工作区中上述部分文件在本轮开始前已有 dirty/untracked 状态；本轮按用户边界未触碰这些 packaging / bundled runtime 改动。
- 阶段边界：停在 Run 3 TUI Interaction Contract Closure 小返修完成点，未 commit。

## 源码根因

### A. Todo 抢模型工具预算
- `MAX_MODEL_TOOL_ROUNDS=4` 对所有工具一视同仁。
- Todo 属于 planning/status，但消耗与 Read/Grep/Bash 相同的轮次预算。
- 模型连续调用 Todo 整理计划后，真实取证工具没有机会执行。
- 用户看到"本轮工具调用已达上限"但实际只做了计划整理。

### B. TUI 滚动和高级面板失焦
- 面板（CommandPanel/ConfigPanel/HelpPanel/BtwPanel/SessionsPanel）渲染在 ScrollViewport 内 blocks 之前。
- stickToBottom=true 时显示底部内容，面板在顶部被裁掉不可见。
- 用户打开 /model、/config 后面板不可见，输入像失效。

### C. Ctrl+O 假提示
- `createSummaryFirstPreview()` 对所有 summary-first 工具无条件返回 `truncated: true` 并添加 Ctrl+O 提示。
- 短输出（1-3 行）、无 details、无 fullOutputPath 时也显示 Ctrl+O。
- 用户按 Ctrl+O 后没有更多内容，属于假 affordance。

## 修复点

### A. Todo 预算分类（packages/tui/src/index.ts）
1. 新增 `MAX_TODO_ONLY_CONSECUTIVE_ROUNDS = 1` 常量。
2. 新增 `isTodoOnlyRound()` 纯函数，判断本轮是否全部为 Todo 调用。
3. 两个 model loop（sendMessage + continueModelAfterToolResults）中：
   - 引入 `evidenceRounds` 和 `consecutiveTodoOnlyRounds` 计数器。
   - Todo-only 轮次不增加 `evidenceRounds`。
   - 连续 Todo-only 超过 1 轮时只注入一次有限提示；Todo 不消耗 evidence 预算，总轮次 hard cap 防止持续 planning-only 卡住。
   - 达上限时区分"仅计划"和"已收集证据"两种文案。

### B. 面板可见性（ShellApp.tsx + view-model.ts）
1. ShellApp.tsx：面板移到 blocks/activity 之后渲染（作为最新 surface），stickToBottom=true 时面板在底部可见。
2. view-model.ts：面板打开时强制 `taskScroll = { scrollOffset: 0, stickToBottom: true }`，保证面板可见。面板关闭后恢复用户滚动位置。

### C. Ctrl+O 假提示（tool-output-presenter.ts）
1. `createSummaryFirstPreview()` 不再无条件返回 `truncated: true`。
2. 只有满足任一条件时才显示 Ctrl+O：
   - `output.truncated === true`
   - `output.details` 非空
   - `output.fullOutputPath` 存在
   - 原始文本 >3 行或 >200 字符
3. 短输出直接返回 stats 行，不带折叠提示。

## TUI Interaction Contract

以下合同由 `tui-interaction-contract.test.ts` 锁住：

1. **输入归属**：permission 存在才独占输入；面板关闭后 Composer 恢复。
2. **可见性**：高级面板打开时 stickToBottom=true，面板作为最新 surface 可见。
3. **滚动语义**：scrollOffset=0 表示吸底；PageUp 增加 offset 看旧内容；PageDown/End 回到底部。
4. **提示真实性**：Ctrl+O 只在确实有隐藏详情时出现（truncated/details/fullOutputPath/多行内容）。
5. **主屏降噪**：Todo 超 8 条时折叠；planning-only 轮次不消耗 evidence 预算。

## 测试覆盖

### AUTOMATED PASS（2174/2174）
- `tui-interaction-contract.test.ts`：21 tests — 滚动语义、输入归属、Ctrl+O 真实性、Todo 预算分类、面板可见性、主屏降噪。
- `task-scroll-state.test.ts`：14 tests — reduceTaskScroll + clampTaskScroll。
- `tool-output-presenter.test.ts`：21 tests — formatToolStart + createLayeredToolOutput + formatToolOutput。
- `view-model.test.ts`：279 tests — createShellViewModel 全覆盖。
- `index.test.ts`：415 tests — tool round exhaustion、summary-first、Todo、config、model、CommandPanel、Ctrl+O。
- `composer-dispatch.test.ts`：输入归属优先级。
- 全套 tui/providers/cli 测试通过。

### MANUAL NOT RUN — Windows TTY 键位兼容
以下需人工 smoke（自动测试无法捕获真实 TTY 行为）：
- [ ] ↑ / ↓ 历史浏览
- [ ] PageUp / PageDown 滚动
- [ ] End 回到底部
- [ ] Esc 关闭面板后 Composer 恢复
- [ ] Ctrl+O 展开/收起 details
- [ ] Ctrl+C 中断后能继续输入
- [ ] Shift+Tab 切换权限模式

### MANUAL NOT RUN — 连续真实使用流
- [ ] 连续 5 轮普通自然语言后滚动仍有效
- [ ] 中途穿插 /model、/config、/help advanced 后输入恢复
- [ ] 短输出不显示 Ctrl+O；长输出才显示
- [ ] 面板打开/关闭后再输入能继续进模型
- [ ] Busy 状态下 Ctrl+C 后 interrupt 状态恢复

### NEEDS USER SMOKE — PermissionPanel
- [ ] default 模式下需审批动作显示真实权限面板
- [ ] details / yes / no / cancel 都可用
- [ ] deny 后不执行动作
- [ ] allow_once 后只执行一次

## 验证结果

```
corepack pnpm exec tsc --noEmit                    ✓ 0 errors
corepack pnpm --filter @linghun/tui exec vitest run   ✓ 2174 passed
corepack pnpm --filter @linghun/providers exec vitest run  ✓ passed
corepack pnpm --filter @linghun/cli exec vitest run   ✓ passed
corepack pnpm --filter @linghun/tui build          ✓ success
corepack pnpm --filter @linghun/cli build          ✓ success
git diff --check                                   ✓ no whitespace issues
```

## 未触碰边界

- 未改 provider/env/key/model route。
- 未改权限语义。
- 未恢复大范围自然语言关键词截获。
- 未改 D.13U/D.13V 反幻觉 gate 语义。
- 未做无关格式化/清理。
- 未 commit。
