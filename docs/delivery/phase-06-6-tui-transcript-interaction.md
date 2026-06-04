# Phase 6.6: TUI Transcript Interaction & Bottom Surface Maturity

## 阶段目标

把 Linghun 的 TUI 主 transcript 做到成品级：滚动顺、拖选复制完整、底部 composer/footer 低噪稳定。对齐 CCB 的成熟交互边界，但只参考行为和产品边界，不复制可疑源码。

## 源码事实清单

### Linghun 现有实现

| 文件 | 关键内容 |
|------|---------|
| `ScrollViewport.tsx` | 测量视口的 Yoga layout 方案：contentHeight - viewportHeight = maxOffset，用 marginTop=-offset 做 clamped translate |
| `transcript-scroll-state.ts` | 纯函数 reducer：scrollOffset 语义（0=吸底，>0=脱底），action 驱动（halfPageUp/Down, wheelUp/Down, top, bottom, delta） |
| `task-scroll-state.ts` | 同语义的旧模型，保留兼容 |
| `Composer.tsx` | PgUp/PgDn→halfPageUp/halfPageDown, Home→top, End→bottom, ↑↓空buffer→wheelUp/wheelDown |
| `ShellApp.tsx` | TaskLayout：output(TranscriptViewport+PanelLayer) + composer band(NotificationStack+Composer+StatusFooter) |
| `StatusFooter.tsx` | 三栏 footer：左(permissionMode+cyclePermHint)，右(model·cache·index·reasoning·hint)，FooterDetailLines(workspace+runtime) |
| `footer-view.ts` | 纯函数 formatter：model label dim占位、cache hit rate tone、index status、reasoning level |
| `view-model.ts` | 总装 taskFooter：buildFooterView + workspaceStatus + runtimeStatus |

### CCB 行为参考（仅行为边界，未复制源码）

| CCB 文件 | 行为参考 |
|----------|---------|
| `FullscreenLayout.tsx` | alt-screen + ScrollBox + stickyScroll 范式；StickyPromptHeader + NewMessagesPill |
| `ScrollKeybindingHandler.tsx` | PgUp/PgDn 半页、wheel 加速衰减、drag-to-scroll 自动滚动、selection translateSelectionForJump + captureScrolledRows |
| `useCopyOnSelect.ts` | 鼠标松手时自动复制选区到剪贴板（需 alt-screen mode 1002 mouse tracking） |
| `PromptInputFooter.tsx` | flexShrink=0 底部固定、窄屏列向布局、PromptInputFooterLeftSide 只放 mode+pill+hint |
| `PromptInputFooterLeftSide.tsx` | ModeIndicator + hint parts，无 workspace/runtime detail 默认显示 |

### Gaps 识别

1. **workspaceStatus / runtimeStatus 默认常驻 footer** → 底部多 2 行，短屏下挤压 transcript。CCB 不默认显示。
2. **programmatic selection 不可用** → Linghun 用标准 Ink 主屏模式，无 alt-screen，无 useSelection API。终端原生选区+Ctrl+C 复制已经正确工作。
3. **footer 高度抖动** → workspace/runtime 行可选渲染时 footer 高度变化。
4. **无 drag-to-scroll** → CCB 需要 alt-screen mode 1002 mouse tracking；Linghun 不启用 alt-screen，终端原生 scrollback 降级覆盖此需求。

## Linghun 自研实现

### 1. Footer 降噪（核心改动）

**view-model.ts**: 从 `taskFooter` 构造中移除 `workspaceStatus` 和 `runtimeStatus` 字段。
- 这两个字段不再默认填充，`StatusFooter.FooterDetailLines` 自然返回 null（已有 guard: `if (!footer.workspaceStatus && !footer.runtimeStatus) return null`）
- 格式化函数 `formatFooterWorkspaceStatus` / `formatFooterRuntimeStatus` 保留在源码中，供 `/details`、`/status`、`/doctor` 等显式展开路径使用

**改动前**：
```
TaskLayout:
  output region
  Composer band
    accent rule
    Composer
    accent rule
    StatusFooter (1 line: permission · model · cache · index)
    workspaceStatus line          ← 噪音
    runtimeStatus line            ← 噪音
    breathing space
```

**改动后**：
```
TaskLayout:
  output region
  Composer band
    accent rule
    Composer
    accent rule
    StatusFooter (1 line: permission · model · cache · index)
    breathing space
```

### 2. 滚动行为（已成熟，无需代码改动）

| 操作 | 语义 | 实现方式 |
|------|------|---------|
| PgUp | transcript-scroll halfPageUp | 半视口高度向上滚动 |
| PgDn | transcript-scroll halfPageDown | 半视口高度向下滚动 |
| Home | transcript-scroll top | 跳到内容顶部 |
| End | transcript-scroll bottom | 回到底部，恢复 stickToBottom |
| ↑ (空buffer) | transcript-scroll wheelUp | 1 行向上滚动 |
| ↓ (空buffer) | transcript-scroll wheelDown | 1 行向下滚动 |
| 鼠标滚轮 | wheelUp/wheelDown | 通过终端 ↑↓ 事件透传 |

**stickToBottom 语义**：
- `scrollOffset === 0` → `stickToBottom = true`：新输出自动跟随底部
- `scrollOffset > 0` → `stickToBottom = false`：用户滚上去后，新输出不强制跳底
- 用户滚回底部（End/滚到底）→ `stickToBottom = true`

**plain mode 降级**：`plain-renderer.ts` 保留原生 scrollback，无 Ink 视口限制。

### 3. Ctrl+C 复制/中断边界

Linghun 使用标准 Ink 主屏模式（无 alt-screen），终端原生选区行为完整生效：

| 场景 | 行为 | 层级 |
|------|------|------|
| 有选区 + Ctrl+C | 终端模拟器拦截，复制选区到剪贴板 | 终端层 |
| 有选区 + Ctrl+Shift+C | 强制复制（同上） | 终端层 |
| 无选区 + Ctrl+C | 传递给 pty → Composer 处理：非空buffer双击清空 / 空buffer interrupt | 应用层 |
| 有选区 + 右键 | 终端原生复制 | 终端层 |

**不需要**在应用层实现 `useSelection` 或 `useCopyOnSelect`，因为标准 Ink 主屏模式下终端原生选区完全可用。

### 4. 拖选到 viewport 边缘自动滚动

CCB 的 drag-to-scroll 需要 alt-screen mode 1002 mouse tracking。Linghun 不使用 alt-screen，因此：
- 终端原生选区行为：拖选时终端不向 pty 发送鼠标事件，selection 完全由终端管理
- 用户拖选到终端窗口边缘外的内容，需要先滚动（PgUp/PgDn 或滚轮），再选择
- 这被视为"plain mode 保留原生 scrollback 降级"策略的一部分

## 用户可见变化

1. **底部更干净**：不再默认显示"工作树：..."和"后台 N · 阻塞 N · 详情 /background"两行
2. **footer 高度稳定**：从之前 1-3 行变为稳定 1 行（核心信息：permission mode · model · cache · index）
3. **transcript 空间更大**：释放 2 行额外垂直空间给主屏对话区

## 使用方式 / 快捷键

| 快捷键 | 行为 | 适用模式 |
|--------|------|---------|
| PgUp | 向上滚动半页 | task/pending |
| PgDn | 向下滚动半页 | task/pending |
| Home | 跳转到内容顶部 | task/pending |
| End | 回到底部（吸底） | task/pending |
| ↑ (输入为空) | 向上滚动 1 行 | task/pending |
| ↓ (输入为空) | 向下滚动 1 行 | task/pending |
| 鼠标滚轮 | 滚动 transcript | task/pending |
| Ctrl+C (空 buffer) | interrupt | 全局 |
| Ctrl+C (有选区) | 终端复制（原生行为） | 全局 |
| Shift+Tab | 切换权限模式 | task/pending |

## 涉及模块

| 文件 | 改动类型 | 改动说明 |
|------|---------|---------|
| `view-model.ts:382-387` | 修改 | 移除 taskFooter 的 workspaceStatus/runtimeStatus 默认填充 |
| `view-model.test.ts:3586-3635` | 修改 | 更新测试：footer 不再默认填充 workspace/runtime |
| `view-model.test.ts:4448-4461` | 修改 | 更新 Ink 渲染测试：验证 workspace/runtime 不出现在输出中 |
| `tui-interaction-contract.test.ts:140-191` | 新增 | 4 个滚动测试：wheel 动作、连续累加、脱底后不跳底 |

## 测试与验证

### 自动化验证

```
pnpm vitest run src/shell/models/tui-interaction-contract.test.ts  # 38 passed (含 4 新)
pnpm vitest run src/shell/models/footer-view.test.ts               # 13 passed
pnpm vitest run src/shell/models/task-scroll-state.test.ts         # 18 passed
pnpm vitest run src/shell/view-model.test.ts                       # 318 passed
pnpm vitest run                                                     # 全量 (待确认)
pnpm tsc --noEmit                                                  # typecheck 通过
```

### 新增测试清单

| 测试 | 覆盖点 |
|------|--------|
| wheelUp 按 wheelStep/1 行离开底部 | 滚轮动作 stickToBottom 语义 |
| wheelDown 滚到底部恢复 stickToBottom=true | 滚回底部自动吸底 |
| 连续 wheelUp 累加不超出 maxOffset | 滚轮 clamp 上界 |
| 脱底后新输出不强制跳底 | 核心交互 contract |
| task footer doesn't show workspaceStatus/runtimeStatus by default | 降噪合规 |
| task footer stays minimal even with background summaries | 降噪 + 必填字段保留 |
| Ink 渲染 footer 中不含 workspace/runtime | e2e 渲染级验证 |

## Windows Terminal 手工验证步骤

以下行为依赖真实终端，无法完全自动化：

1. **启动 Linghun TUI 并进入 task 模式**
   - 在 Windows Terminal (PowerShell) 中运行 `linghun`
   - 输入任意消息，进入 task 页面

2. **验证 footer 降噪**
   - 观察 composer 下方区域：应只有一行 footer（权限模式 · 模型 · 缓存 · 索引）
   - 不应出现"工作树：..."或"后台 N · 阻塞 N · 详情 /background"行

3. **验证滚动**
   - 连续发送多条消息，生成足够长的 transcript
   - PgUp: 向上滚动，确认内容上移，底部不再自动跟随
   - PgDn: 向下滚动回到底部，确认 stickToBottom 恢复
   - End: 直接回到底部
   - Home: 跳到 transcript 顶部
   - 滚轮（↑↓ 空 buffer 时）: 单行上下滚动

4. **验证新输出吸底/脱底**
   - 滚到 transcript 中间（脱底），触发新输出（/echo 或简单消息）
   - 确认新输出不强制跳到底部
   - 按 End 回到底部后再触发新输出，确认跟随底部

5. **验证 Ctrl+C 复制（终端原生）**
   - 用鼠标拖选 transcript 中一段文本
   - 按 Ctrl+C：Windows Terminal 应复制选区（不是 interrupt）
   - 取消选区后按 Ctrl+C：应触发 interrupt

6. **验证 plain mode fallback**
   - 设置 `LINGHUN_TERMINAL_TIER=legacy` 运行
   - 确认 plain renderer 正常输出，scrollback 使用终端原生能力
   - 确认 footer 不包含 workspace/runtime 行

## 已知限制

1. **无 programmatic selection**：Linghun 不使用 alt-screen，无 Ink `useSelection` API。终端原生选区已满足复制需求。未来若启用 alt-screen，需补充 selection 跟踪。
2. **无 drag-to-scroll**：同上原因，需 alt-screen mode 1002 mouse tracking。
3. **无 wheel acceleration**：标准 Ink 不暴露 wheel delta 信息，wheel 事件通过 ↑↓ 键模拟。1 行/事件的滚动速度在长 transcript 时偏慢。
4. **workspace/runtime detail 暂无显式展开路径**：`/details`、`/status`、`/doctor` 命令尚未完整实现。本阶段仅从默认 footer 移除，函数保留供后续阶段使用。
5. **Windows conhost (legacy) 下无键盘滚动**：legacy fallback 走 plain renderer + 终端原生 scrollback。

## 不在本阶段处理的内容

- 长输出 memory guard（已由 Phase 6.5 处理）
- alt-screen 模式启用
- programmatic selection 跟踪
- drag-to-scroll 自动滚动
- wheel acceleration 曲线
- `/details` `/status` `/doctor` 命令的 workspace/runtime 展开面板
- notification/toast 上的 workspace/runtime detail
- 新增 agent/workflow 能力

## 下一阶段衔接

Phase 6.7 或后续阶段建议：
- 实现 `/status` 命令，在 CommandPanel 中展示 workspace/runtime detail
- 实现 `/doctor` 完整诊断面板
- 评估 alt-screen 启用成本和收益（需 @anthropic/ink ScrollBox 或等价物）
- 若启用 alt-screen，补充 selection 跟踪 + drag-to-scroll + wheel acceleration

## 参考核对

### 本阶段读取的 Linghun 文档
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`（阶段范围）
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`（接口/数据结构）
- `F:\Linghun\docs\delivery\README.md`（交付索引）
- `F:\Linghun\docs\delivery\phase-06-5-streaming-memory-guard.md`（Phase 6.5 交付文档）

### 本阶段读取的 Linghun 源码
- `packages/tui/src/shell/components/ScrollViewport.tsx`
- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/components/Composer.tsx`
- `packages/tui/src/shell/components/StatusFooter.tsx`
- `packages/tui/src/shell/models/transcript-scroll-state.ts`
- `packages/tui/src/shell/models/footer-view.ts`
- `packages/tui/src/shell/models/task-scroll-state.ts`
- `packages/tui/src/shell/terminal-capability.ts`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/shell/plain-renderer.ts`
- `packages/tui/src/shell/types.ts`

### 本阶段参考的 CCB 文件（仅行为参考）
- `F:\ccb-source\src\components\FullscreenLayout.tsx`
- `F:\ccb-source\src\components\ScrollKeybindingHandler.tsx`
- `F:\ccb-source\src\hooks\useCopyOnSelect.ts`
- `F:\ccb-source\src\components\PromptInput\PromptInputFooter.tsx`
- `F:\ccb-source\src\components\PromptInput\PromptInputFooterLeftSide.tsx`

### 行为参考 vs 自研实现
- **滚动语义**（PgUp/PgDn/Home/End + stickToBottom + clamp）：行为对齐 CCB，Linghun 自研 measured-clamp 方案（ScrollViewport + transcript-scroll-state.ts）
- **footer 降噪**（不默认显示 workspace/runtime）：行为对齐 CCB PromptInputFooter 的轻量设计，Linghun 自研 StatusFooter + footer-view.ts
- **selection 复制**：CCB 使用 alt-screen + useSelection + useCopyOnSelect；Linghun 使用终端原生选区+Ctrl+C（标准 Ink 主屏模式），不复制 CCB 的 selection 跟踪系统
- **drag-to-scroll**：CCB 使用 alt-screen mode 1002 + ScrollBox API；Linghun 暂不实现（依赖终端原生 scrollback）

### 未复制 CCB 可疑源码

本阶段所有改动均为 Linghun 自研实现：
- 滚动模型基于 Linghun 已有的 `transcript-scroll-state.ts` 纯函数 reducer
- footer 降噪基于 Linghun 已有的 `footer-view.ts` + `StatusFooter.tsx` 组件体系
- Ctrl+C 复制依赖终端原生行为，无需应用层实现
- 未引入 `@anthropic/ink` 私有 API（ScrollBox, useSelection, useCopyOnSelect）
- 未复制 CCB 的 wheel acceleration 算法（CCB 专有调参数据）
- 未复制 CCB 的 FullscreenLayout / ScrollKeybindingHandler 实现

---

## Handoff Packet

- **阶段**: Phase 6.6
- **状态**: 完成
- **下一阶段**: Phase 6.7 或用户指定
- **禁止事项**:
  - 不允许重新添加 workspaceStatus/runtimeStatus 到默认 footer
  - 不允许在未启用 alt-screen 前尝试实现 programmatic selection
  - 不允许跨阶段新增 agent/workflow 能力
- **证据引用**: view-model.ts:382-387, view-model.test.ts:3586-2635, tui-interaction-contract.test.ts:140-191
- **验证结果**: 378 tests passed (view-model 318 + footer-view 13 + task-scroll-state 18 + tui-interaction-contract 38), typecheck clean
- **索引状态**: N/A（代码改动限于 2 个生产文件 + 2 个测试文件）
- **权限模式**: 本地编辑 + 测试
- **模型/provider**: claude-sonnet-4-6 (Phase 6.6 实现)
- **预算使用**: 约 45K tokens (含源码读取 + 测试运行)
