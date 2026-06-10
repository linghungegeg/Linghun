# Renderer Runtime Phase 05 — Wheel / Scroll Runtime

## 阶段目标

实现成熟的 wheel / scroll runtime，把 wheel 作为一流结构化输入事件处理，融合 encoder bounce detection、wheel mode、trackpad burst detection、终端特定曲线和 pending delta accumulator + quantized drain，防止高频 wheel 事件造成 state-update explosion。

## 已完成功能

- **升级 WheelAccelerator 算法**：
  - Encoder bounce detection（物理滚轮光学编码器弹跳检测）
  - Wheel mode 状态机（bounce 确认后进入，粘性直到空闲或 trackpad 特征）
  - Direction flip debounce（第一次方向翻转延迟处理，等待下一个事件判断）
  - Trackpad burst detection（连续 <5ms 事件计数，≥5 个识别为 trackpad）
  - xterm.js 专用指数衰减曲线（momentum = 0.5^(gap/halflife)，gap-dependent cap）
  - Native terminal 线性 ramp + wheel mode 指数衰减
  - 支持自定义 base rows/event
- **终端类型检测**：
  - 新增 `isXtermJsTerminal()` 检测 VS Code / Cursor / Windsurf integrated terminals
  - 自动选择对应的滚动曲线（xterm.js 或 native）
- **LINGHUN_SCROLL_SPEED 配置**：
  - 支持环境变量 `LINGHUN_SCROLL_SPEED`，设置 baseline rows/event
  - 默认值 1（适用于预放大终端如 Ghostty）
  - 用户可配置为 3（匹配 vim/nvim 默认）
- **Pending delta accumulator + quantized drain**：
  - 新增 `useScrollRuntime` hook 替代 `useScrollBatcher`
  - 高频 wheel 事件累积在 `pendingDelta` ref 中，不立即触发 state update
  - setTimeout 循环以 ~60fps (16ms) 速率逐步 drain pending delta
  - Quantization：delta 量化为 10 行 bins，只在跨越 bin 边界时 dispatch
  - 减少 state update 次数 ~5-10x，防止 React re-render explosion
- **MouseInputRouter 升级**：
  - 使用新的 `useScrollRuntime` 替代 `useScrollBatcher`
  - 使用升级后的 `WheelAccelerator`（支持 base 和 terminalType）
  - 处理 encoder bounce 返回的 step=0（no-op）
  - 保留现有 selection/copy 路由不变

## 使用方式

本阶段没有新增 CLI / slash command。

用户侧可选环境变量：

```text
LINGHUN_SCROLL_SPEED=3
```

效果：设置 baseline rows/event 为 3（适用于未预放大终端）。

开发者入口：

```ts
import { WheelAccelerator } from "./shell/models/wheel-acceleration.js";
import { useScrollRuntime } from "./shell/hooks/useScrollRuntime.js";
import { isXtermJsTerminal } from "./shell/terminal-capability.js";
```

## 涉及模块

代码：

- `packages/tui/src/shell/models/wheel-acceleration.ts`（升级）
- `packages/tui/src/shell/hooks/useScrollRuntime.ts`（新增）
- `packages/tui/src/shell/components/MouseInputRouter.tsx`（升级）
- `packages/tui/src/shell/terminal-capability.ts`（新增 `isXtermJsTerminal()`）

测试：

- `packages/tui/src/shell/models/wheel-acceleration.test.ts`（新增，18 tests）

文档：

- `RENDERER_RUNTIME_MIGRATION_PLAN.md`
- `docs/delivery/phase-renderer-runtime-05-wheel-scroll-runtime.md`
- `docs/delivery/README.md`

## 关键设计

### WheelAccelerator 算法

**Native terminal path（线性 ramp + wheel mode）**：

1. **Trackpad detection**：
   - Legacy：avg interval <10ms over 40ms window → step=base
   - Burst count：连续 <5ms 事件，≥5 个 → trackpad signature → step=base
2. **Encoder bounce detection**：
   - 第一次方向翻转：defer 处理（pendingFlip）
   - 下一个事件 flip-back 且 gap ≤200ms → bounce confirmed，engage wheel mode
   - 下一个事件 flip-back 但 gap >200ms → 真实反转 + 再反转，处理当前事件
   - 下一个事件持续新方向 → 真实反转，处理当前事件
3. **Wheel mode**（粘性状态）：
   - 进入条件：bounce confirmed
   - 曲线：指数衰减 momentum = 0.5^(gap/halflife)，mult = base + step×m/(1-m)，cap=15
   - 退出条件：空闲 >1500ms 或 trackpad burst signature（≥5 连续 <5ms）
4. **线性 ramp fallback**（wheel mode 未激活时）：
   - mult = base + min(events_in_window, maxStep/base) × 0.3
   - cap = min(mult, 6)

**xterm.js terminal path（指数衰减）**：

1. **指数衰减曲线**：
   - momentum = 0.5^(gap/halflife)，halflife=150ms
   - mult = 1 + step×m/(1-m)，step=5
2. **Gap-dependent cap**：
   - gap ≥80ms：cap=3（精确滚动）
   - gap <80ms：cap=6（吞吐量）
3. **Idle reset**：gap >500ms → mult=kick=2（响应第一次点击）
4. **小数携带**：frac 累积，避免 floor 损失

### useScrollRuntime (Pending Delta Accumulator)

**设计目标**：

- 高频 wheel 事件累积在 ref 中，不立即触发 state update
- Drain loop 逐步消耗 pending delta，量化后 dispatch
- 减少 React re-render，防止 state-update explosion

**实现细节**：

1. **Accumulate**：每个 wheel 事件累加到 `pendingDeltaRef.current`
2. **Drain loop**：setTimeout 16ms（~60fps）循环
   - 每次 drain DRAIN_PER_FRAME=5 rows
   - 计算 currentBin = floor(pendingDelta / SCROLL_QUANTUM)
   - 仅当 bin 变化时 dispatch (bin_delta × SCROLL_QUANTUM)
3. **Quantization**：SCROLL_QUANTUM=10 rows
   - CCB 使用 20 rows（用于 virtual scroll range recalculation）
   - Linghun 使用 10 rows（offset-based scroll 需要更细粒度）
4. **Idle stop**：pending=0 且空闲 >100ms → 停止 drain loop（省 CPU）

**效果**：

- Trackpad flick 100 行 → ~10 次 state update（而非 100 次）
- 物理滚轮快速滚动 50 行 → ~5 次 state update（而非 50 次）
- Drain 时间 <200ms（5 rows/frame × ~60fps = 300 rows/sec）

### 终端检测

`isXtermJsTerminal()` 检测：

- `TERM_PROGRAM === "vscode"` → xterm.js
- `TERM_PROGRAM` 包含 "cursor" / "windsurf" → xterm.js
- 其他 → native

WheelAccelerator 根据终端类型选择曲线。

## 配置项

新增：

```text
LINGHUN_SCROLL_SPEED=<number>
```

默认值：1

说明：设置 baseline rows/event。Ghostty 等预放大终端使用 1；未预放大终端（如某些 xterm）可设为 3 匹配 vim/nvim 默认。

## 命令

无新增 CLI / slash command。

## 测试与验证

已运行：

```text
corepack pnpm exec vitest run packages/tui/src/shell/models/wheel-acceleration.test.ts
corepack pnpm exec vitest run packages/tui/src/shell/terminal-interaction-runtime.test.ts
corepack pnpm --filter @linghun/tui typecheck
```

结果：

- wheel-acceleration.test.ts: 18 tests PASS
- terminal-interaction-runtime.test.ts: 10 tests PASS
- typecheck: PASS

Focused coverage：

- Native terminal linear ramp fallback: 4 tests
- Native terminal encoder bounce detection: 4 tests
- Native terminal wheel mode: 3 tests
- xterm.js exponential decay: 7 tests

测试场景：

- ✅ 单次事件返回 base step
- ✅ Trackpad burst (avg interval <10ms) 不加速
- ✅ 物理滚轮事件加速
- ✅ 自定义 base
- ✅ Direction flip 延迟处理
- ✅ Bounce 确认并进入 wheel mode
- ✅ Flip-back 超时视为真实反转
- ✅ 方向持续视为真实反转
- ✅ Wheel mode 指数衰减
- ✅ Wheel mode 空闲退出
- ✅ Wheel mode trackpad burst 退出
- ✅ xterm.js idle 后 kick value
- ✅ xterm.js fast/slow gap-dependent cap
- ✅ xterm.js 小数携带

## 性能结果

未新增 benchmark。

理论性能提升：

- State update reduction: ~5-10x（量化到 10 行 bins）
- React re-render reduction: ~5-10x（对应 state update）
- Drain latency: <200ms for 100-row burst（5 rows/frame × 16ms）

实际性能需要真实终端测试（见"已知问题"）。

## 已知问题

- **未运行真实终端 smoke**：
  - 60 秒快速滚轮测试（验收标准）未运行
  - Trackpad vs 物理滚轮真实设备测试未运行
  - Direction flip 真实场景未测试
- **Drain loop 使用 setTimeout**：
  - Node.js 无 requestAnimationFrame，使用 setTimeout(16ms) 模拟 ~60fps
  - 精度低于浏览器 rAF，但对 terminal UI 足够
- **Quantization 参数未优化**：
  - SCROLL_QUANTUM=10 rows 是估算值
  - 真实终端测试后可能需要调整（CCB 使用 20 rows）
- **useScrollBatcher.ts 未删除**：
  - 保留作为 fallback 或其他组件可能使用
  - Phase 6+ 可考虑删除

## 不在本阶段处理的内容

- 不改视觉样式、布局、主题、footer、panel、composer 外观
- 不改 render/flush lifecycle（Phase 6 范围）
- 不改 provider / model / tool / scheduler / agent / MCP / permission 主链
- 不新增第二套 transcript 数据源
- 不复制或 vend CCB 源码
- 不实现 virtual scroll（Phase 6+ 范围）
- 不实现真实的 ScrollBox pendingDelta（需要 ink-runtime 改动，Phase 7+ 范围）

## 下一阶段衔接

Phase 6 应处理 render stability / flush barrier：

- Render throttling（scroll/mouse burst 导致的过度 redraw）
- Stdout flush barrier（mode change / exit）
- Viewport clamp after resize
- 避免 full transcript redraw per wheel tick
- Terminal state recovery on render error
- Exit cleanup（SGR mouse bytes）

Phase 5 的 pending delta accumulator 和 quantization 已经减少了大部分 state update，Phase 6 应在 render 层进一步优化。

## 开发者排查入口

- Wheel acceleration 算法：`packages/tui/src/shell/models/wheel-acceleration.ts`
- Wheel acceleration 测试：`packages/tui/src/shell/models/wheel-acceleration.test.ts`
- Scroll runtime（accumulator + drain）：`packages/tui/src/shell/hooks/useScrollRuntime.ts`
- Mouse input routing：`packages/tui/src/shell/components/MouseInputRouter.tsx`
- 终端检测：`packages/tui/src/shell/terminal-capability.ts` (`isXtermJsTerminal`)
- 阶段根计划：`RENDERER_RUNTIME_MIGRATION_PLAN.md`

## 参考核对

实际读取的 Linghun 文档：

- `RENDERER_RUNTIME_MIGRATION_PLAN.md` (Phase 5, line 684-723)
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `docs/delivery/phase-renderer-runtime-04-selection-copy-runtime.md`

实际参考的 CCB 行为事实：

Phase 0 Reality Check 已记录：

1. **CCB Ink fork wheel 事件流**：
   - wheel 作为一流 Key 事件（wheelUp / wheelDown）
   - 可被 keybinding 系统处理，不仅是鼠标事件
2. **CCB pending delta accumulator + frame drain**：
   - `scrollBy()` 累积 `pendingDelta`，不立即改 `scrollTop`
   - renderer 在 render-node-to-output 中逐步 drain
   - mount range 覆盖 [committed, target] 以支持 drain frames
   - SCROLL_QUANTUM=20 rows 量化，减少 React re-render
3. **CCB 设备检测 heuristics**：
   - Trackpad burst: <5ms consecutive events, 100+ for flick, ≤3 for mouse
   - Encoder bounce: flip → flip-back within 200ms, 28% rate on cheap encoder
   - Wheel mode: sticky after bounce confirmed, disengage on idle >1500ms or burst
4. **CCB direction flip debounce**：
   - First flip: defer (pendingFlip)
   - Next event same dir as original: flip-back within 200ms → bounce
   - Next event same dir but >200ms: real reversal + counter-reversal
   - Next event persists new dir: real reversal
5. **CCB 终端特定曲线**：
   - xterm.js: exponential decay, momentum = 0.5^(gap/halflife), gap-dependent cap
   - Native: linear ramp + wheel mode (exponential decay after bounce)
   - Detection: `TERM_PROGRAM === "vscode"` / contains "cursor" / "windsurf"
6. **CCB CLAUDE_CODE_SCROLL_SPEED**：
   - base rows/event 配置，默认 1
   - 用户可设为 3 匹配 vim/nvim 默认

实际参考的 CCB 文件（行为级，未复制源码）：

- `F:\ccb-source\node_modules\@anthropic\ink\src\core\events\input-event.ts`
- `F:\ccb-source\src\hooks\useVirtualScroll.ts`
- `F:\ccb-source\src\components\ScrollKeybindingHandler.tsx` (line 1-200)
- `F:\ccb-source\src\components\FullscreenLayout.tsx`

进入 Linghun 自研实现的内容：

- 自研 `WheelAccelerator` 类（融合 CCB 行为级事实，clean rewrite）
- 自研 `useScrollRuntime` hook（pending delta + quantized drain）
- 自研 `isXtermJsTerminal()` 检测函数
- 自研 focused tests（18 tests）
- TUI adapter 与 existing MouseInputRouter / transcript scroll state 集成

未复制内容：

- 未复制 CCB 私有源码实现细节
- 未 vend CCB Ink fork
- 未导入 CCB internal API
- 未复制 CCB ScrollBox pendingDelta 实现（ink-runtime 层，Phase 7+ 范围）

## 成品级结构化 handoff packet

```text
phase: Renderer Runtime Phase 05 — Wheel / Scroll Runtime
status: PASS / focused-tests-only (no real-terminal smoke yet)
next_phase: Renderer Runtime Phase 06 — Render Stability / Flush Barrier
must_not_do_next:
  - 不改视觉风格作为 Phase 6 的目标
  - 不重写 wheel/scroll runtime（Phase 5 已完成）
  - 不重写 selection/copy（Phase 4 已完成）
  - 不改 provider/model/tool/scheduler/agent/MCP 主链
  - 不复制 CCB 私有源码
  - 不新增第二套 transcript 数据源
evidence:
  - packages/tui/src/shell/models/wheel-acceleration.ts
  - packages/tui/src/shell/models/wheel-acceleration.test.ts (18 tests PASS)
  - packages/tui/src/shell/hooks/useScrollRuntime.ts
  - packages/tui/src/shell/components/MouseInputRouter.tsx
  - packages/tui/src/shell/terminal-capability.ts (isXtermJsTerminal)
  - RENDERER_RUNTIME_MIGRATION_PLAN.md
  - docs/delivery/phase-renderer-runtime-05-wheel-scroll-runtime.md
validation:
  - wheel-acceleration.test.ts: 18 tests PASS
  - terminal-interaction-runtime.test.ts: 10 tests PASS (existing, not broken)
  - @linghun/tui typecheck: PASS
real_terminal_smoke:
  - 60-second fast wheel test: NOT RUN (acceptance criteria pending)
  - trackpad vs physical wheel: NOT RUN
  - direction flip scenarios: NOT RUN
  - visual flicker check: NOT RUN
gaps:
  - Real hardware/terminal smoke testing required before Phase 5 can be marked BETA READY
  - SCROLL_QUANTUM parameter may need tuning after real-terminal testing
  - Drain loop precision (setTimeout 16ms vs rAF) acceptable but suboptimal
known_risks:
  - Quantization bin size (10 rows) is estimated, not empirically validated
  - Direction flip debounce logic complex, edge cases may exist
  - Wheel mode state machine needs real encoder bounce validation
index_status: not refreshed in this phase; source files verified directly
permission_mode: Auto Mode; local source edits and local validation only
model_provider: Claude Code session model; no product model/provider logic changed
budget_usage: no explicit token budget set
```
