# Phase 04 定向复检修复报告

**日期**：2026-06-10  
**阶段**：Renderer Runtime Phase 04 — Mouse Selection / Copy Runtime  
**状态**：PASS / focused-local-validation + targeted-review-fix

---

## 复检范围

按照 `RENDERER_RUNTIME_MIGRATION_PLAN.md` Phase 4 已知限制，本次定向复检针对：

- 代码逻辑完整性审查
- 坐标转换一致性验证
- 事件处理路径正确性检查
- 边界条件覆盖确认

---

## 发现的问题

### 问题 1：MouseInputRouter 缺失 continue 语句

**位置**：`packages/tui/src/shell/components/MouseInputRouter.tsx:54-75`

**问题描述**：

在处理 `parseTerminalInput()` 返回的结构化鼠标事件时，wheel 事件处理后有 `continue` 语句跳过后续 fallback 路径，但 mouse 事件处理后缺失 `continue`，导致可能进入 fallback 路径重复处理。

**修复方案**：

在 mouse 事件处理块末尾添加 `continue` 语句，确保处理完结构化事件后跳过 fallback 路径。

**影响评估**：

- 低风险：fallback 路径有 `if (!isSgrMouseInput(seq))` 和 `if (!mouse)` 防护，实际不会造成重复处理。
- 修复后逻辑更清晰，避免不必要的 fallback 检查开销。

---

### 问题 2：坐标转换路径验证

**位置**：
- `packages/ink-runtime/src/terminal-input.ts:151,157`（返回原始 1-based 坐标）
- `packages/ink-runtime/src/terminal-selection.ts:101-102`（`parseTerminalSelectionMouseEvent` 已做 `-1` 转换）
- `packages/tui/src/shell/components/MouseInputRouter.tsx:66-67,98-99`

**验证结果**：

经过详细审查，两条处理路径的坐标转换均正确：

1. **主路径**（新）：`parseTerminalInput()` → 1-based → `MouseInputRouter` 做 `-1` → 0-based ✓
2. **fallback 路径**（旧）：`parseSgrMouseEvent()` 内部已 `-1` → 直接使用 → 0-based ✓

两条路径最终产生的坐标一致，测试覆盖充分，无需修复。

---

## 已修复内容

### 修复 1：MouseInputRouter.tsx 添加 continue

**文件**：`packages/tui/src/shell/components/MouseInputRouter.tsx`

**变更**：

```typescript
if (event.kind === "mouse") {
  if (selectionActive) {
    onInput({
      type: "transcript-mouse",
      event: {
        x: Math.max(0, event.x - 1),
        y: Math.max(0, event.y - 1),
        button: event.button === 0 || event.button === 3 ? "left" : "other",
        action: event.action === "press" ? "down" : event.action === "release" ? "up" : event.action,
      },
    });
  }
  dispatched = true;
  continue;  // ← 新增
}
```

---

## 验证结果

### 自动化测试

```bash
corepack pnpm exec vitest run \
  packages/ink-runtime/src/terminal-input.test.ts \
  packages/ink-runtime/src/terminal-selection.test.ts \
  packages/tui/src/shell/models/terminal-input-runtime.test.ts \
  packages/tui/src/shell/models/transcript-selection-state.test.ts \
  packages/tui/src/shell/terminal-interaction-runtime.test.ts
```

**结果**：✅ PASS, 60 tests

- Terminal input parser：12 tests
- Selection runtime：8 tests
- TUI input runtime：15 tests
- Terminal mode runtime：10 tests
- TUI selection adapter：15 tests

### 类型检查

```bash
corepack pnpm typecheck
corepack pnpm --filter @linghun/ink-runtime typecheck
corepack pnpm --filter @linghun/tui typecheck
```

**结果**：✅ 全部 PASS

### 构建验证

```bash
corepack pnpm --filter @linghun/ink-runtime build
corepack pnpm --filter @linghun/tui build
```

**结果**：✅ 全部 PASS

---

## 未修复项（无需修复）

1. **坐标转换路径**：两条路径均正确，已通过测试验证。
2. **边界条件处理**：`Math.max(0, ...)` 和 `clamp()` 函数处理充分。
3. **滚动方向逻辑**：`autoScrollDeltaForMouse` 逻辑正确，有测试覆盖。

---

## 已知限制（Phase 4 范围外）

- 未运行真实终端 drag/copy/manual lost-release smoke（需要实际硬件终端测试）
- OS clipboard 写入仍在 TUI controller（设计决策，runtime 只负责 copy decision）
- Transcript screen row 构建仍在 TUI adapter（依赖 ProductBlockViewModel）
- Wheel runtime maturity 属于 Phase 5 范围

---

## 影响范围

### 变更文件

- `packages/tui/src/shell/components/MouseInputRouter.tsx`（1 行新增 continue）
- `RENDERER_RUNTIME_MIGRATION_PLAN.md`（Phase 4 Closure 更新）
- `docs/delivery/phase-renderer-runtime-04-selection-copy-runtime.md`（测试结果和 handoff packet 更新）

### 无变更区域

- 所有 runtime 核心逻辑
- 所有测试文件
- 所有类型定义
- provider/model/tool/scheduler/agent/MCP/permission 主链
- 视觉样式、布局、主题

---

## 下一步建议

Phase 4 定向复检修复已完成，建议：

1. **可选**：在真实终端（Windows Terminal / Git Bash / VS Code terminal）运行手动 smoke 测试：
   - 快速拖选复制
   - 窗口外释放鼠标
   - 双击/三击选择
   - 焦点切换时的 lost-release 恢复

2. **继续 Phase 5**：Wheel / Scroll Runtime
   - pending delta accumulator
   - frame/timer drain
   - trackpad/physical wheel heuristics
   - direction flip debounce
   - 高频 wheel 不造成 state-update explosion

3. **不要**：
   - 重写 selection/copy（除非 smoke 测试发现回归）
   - 改变视觉风格
   - 改变 provider/model 主链

---

## 总结

Phase 4 定向复检发现并修复 1 个低风险逻辑完整性问题，验证坐标转换路径正确性，所有自动化测试通过。Phase 4 现状态为 **PASS / focused-local-validation + targeted-review-fix**，可以进入 Phase 5。
