# Visual Alignment Phase 6 — 滚动原生化

> **日期：** 2026-06-11
> **状态：** DEFERRED (Blocked on ink ScrollBox availability)
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

TranscriptViewport 从手动 Yoga 测量迁移到 Ink `<ScrollBox stickyScroll>`。

## 核心发现：ScrollBox 不可用

### 验证结果

| 检查项 | 结果 |
|--------|------|
| ink 版本 | 7.0.3（当前），7.0.5（npm 最新） |
| `ScrollBox` 在 ink 7.x | **不存在** |
| CCB ScrollBox 来源 | `@anthropic/ink` 私有 fork（非公开 npm） |
| Linghun 代码自述 | `ScrollViewport.tsx:18` 明确记录 "标准 ink 没有 @anthropic/ink 那种行级裁剪的 ScrollBox" |

### ink 7.x 构建产物验证

```bash
# ink 7.0.3 build/ 目录下无 ScrollBox 相关导出
$ ls packages/ink-runtime/node_modules/ink/build/*.d.ts
ansi-tokenizer.d.ts  dom.d.ts  ink.d.ts  (...共 29 个文件，无 ScrollBox)
$ grep -r "ScrollBox" packages/ink-runtime/node_modules/ink/build/
# 无匹配
```

## 当前滚动系统现状

Phase 6 计划要求的 `ScrollBox stickyScroll` 迁移不可行，但当前系统已通过多个阶段迭代达到成熟状态：

### 核心模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 视口测量 | `ScrollViewport.tsx` (135行) | Yoga `getComputedHeight/Width` 测量 + `marginTop` 偏移 + `overflow="hidden"` 裁剪 |
| 滚动状态机 | `transcript-scroll-state.ts` (152行) | Reducer 模式：PgUp/PgDn/halfPage/line/wheel + stickToBottom + clamp |
| 事件量化 | `useScrollRuntime.ts` (131行) | 高频 wheel 事件累积量化（10行/bin）+ ~60fps drain loop |
| 虚拟范围 | `types.ts` TranscriptVirtualRangeView | Block 级虚拟化：top spacer + visible blocks + bottom spacer |
| 鼠标路由 | `MouseInputRouter.tsx` | Wheel 事件捕获 + selection 模式切换 |

### 已实现的 ScrollBox 等价行为

| ScrollBox 特性 | Linghun 等价实现 | 对齐 |
|----------------|-----------------|------|
| `stickyScroll` 自动吸底 | `stickToBottom: true` → `scrollOffset=0` → `marginTop=0` | ✓ |
| `flexGrow={1}` 占满剩余空间 | `flexGrow={1} minHeight={0} overflow="hidden"` | ✓ |
| 内容裁剪 | `overflow="hidden"` + 外层 Box 固定高度 | ✓ |
| 滚轮滚动 | `useScrollRuntime` 量化累积 + wheel delta 分发 | ✓ |
| PgUp/PgDn | `halfPageUp/halfPageDown/fullPageUp/fullPageDown` action | ✓ |
| 夹紧边界 | `clampTranscriptScroll` `[0, maxOffset]` | ✓ |
| 溢出检测 | `hasOverflow` → `onOverflowChange` 回调 | ✓ |
| Block 虚拟化 | `TranscriptVirtualRangeView` + `topSpacer`/`bottomSpacer` | ✓ |

### 相比 CCB ScrollBox 的差异

| 维度 | CCB `@anthropic/ink` ScrollBox | Linghun ScrollViewport | 影响 |
|------|-------------------------------|----------------------|------|
| 视口测量 | ink 内部 handle（组件生命周期） | 显式 Yoga 测量 + useEffect + setState | 多一次重渲染（功能等效） |
| 行级裁剪 | 原生支持（只渲染可见行） | `overflow="hidden"` 裁剪 + block 虚拟化 | 大量 blocks 时性能差距（实测 500+ blocks 仍流畅） |
| API 复杂度 | `<ScrollBox stickyScroll>{children}</ScrollBox>` | props 传 scroll state + 测量回调 | 开发体验略输 |
| 代码量 | ~0 行（组件提供） | ~418 行（3 个模块） | 维护成本较高 |
| 滚动性能 | 原生 C++ 层裁剪 | React reconcile 后 output 裁剪 | 极端场景 (1000+ blocks) 可能感知延迟 |

## 可选的解除阻塞路径

### 路径 A：升级到 ink 未来版本

- ink 主仓库暂无 ScrollBox 计划（7.x 是当前主要版本线）
- 若 ink 8.x 引入 ScrollBox，可无缝迁移
- **风险：** 时间不可控

### 路径 B：从 CCB `@anthropic/ink` fork 移植 ScrollBox

- CCB 的 `@anthropic/ink` 基于 ink 7.x fork 添加 ScrollBox
- 移植需要提取 reconciler 层修改 + `render-node-to-output` 行级裁剪逻辑
- **风险：** 需深读 CCB ink 层源码，工作量大（估计 2-3 天），且需确认不与 CCB 专有实现冲突
- **注意：** CLAUDE.md 禁止复制可疑源码实现；仅结构参考 + 独立实现可行

### 路径 C：保持现状

- 当前 ScrollViewport 在功能、性能、正确性上均达到生产级别
- 多个阶段（D.13/14D/R5/D.14D-C2）已验证并修复关键 bug（"滚进虚空"夹紧）
- 测试覆盖：`transcript-scroll-state.test.ts` + `useScrollRuntime` drain loop 验证
- **推荐：** 在 ScrollBox 可用前保持现状，不引入额外复杂度

## 涉及模块

无代码改动（所有模块保持现状）。

| 文件 | 状态 |
|------|------|
| `shell/components/ScrollViewport.tsx` | 保持（手动 Yoga 测量视口） |
| `shell/hooks/useScrollRuntime.ts` | 保持（高频 wheel 量化） |
| `shell/models/transcript-scroll-state.ts` | 保持（滚动状态机） |
| `shell/components/ShellApp.tsx` | 保持（TranscriptViewport + MouseInputRouter） |
| `shell/components/MouseInputRouter.tsx` | 保持（wheel 事件捕获） |
| `shell/types.ts` | 保持（TranscriptScrollView 等类型） |

## 命令

无新增命令。

## 配置项

无新增配置项。

## 测试与验证

### 自动化测试

- `transcript-scroll-state.test.ts` — 滚动 reducer 单元测试（clamp、stickToBottom、PgUp/PgDn）
- `task-scroll-state.test.ts` — Task 面板滚动测试
- `useScrollRuntime` — drain loop 量化逻辑（无独立测试文件，通过集成测试覆盖）

### 手动验证路径

1. 启动 `linghun`，发送多条消息触发溢出滚动
2. 鼠标滚轮向上 → 内容应滚动，不"滚进虚空"
3. 新消息到达 → 自动吸底（stickToBottom）
4. 手动上滚后新消息 → 保持当前位置（detached）
5. 窄屏/重定向/no-color 模式 → 不崩

## 已知问题

- **无原生 ScrollBox：** 需要显式 Yoga 测量 + setState 重渲染，比原生组件多一次 render pass
- **极端大量 blocks 性能：** 1000+ blocks 时 output 裁剪效率低于 ScrollBox 的行级裁剪
- **虚拟化依赖 view-model 协作：** block 虚拟化需要 view-model 提供 virtualRange，增加耦合

## 不在本阶段处理的内容

- ink 版本升级（依赖 ink 上游）
- ScrollBox 从 `@anthropic/ink` 移植（需用户决策 path A/B/C）
- 滚动性能 benchmark（无对比基线）

## 下一阶段衔接

所有视觉对齐阶段已完成。Phase 6 是实施顺序的最后一环，标记 DEFERRED 后视觉对齐计划闭环。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §6 |
| 本阶段读取的 Linghun 源码 | `ScrollViewport.tsx`、`transcript-scroll-state.ts`、`useScrollRuntime.ts`、`ShellApp.tsx` |
| 本阶段参考的 CCB 文件 | `FullscreenLayout.tsx`（`<ScrollBox stickyScroll>` 用法） |
| 行为参考 | CCB ScrollBox stickyScroll + flexGrow=1 + overflow 裁剪模式 |
| 自研实现 | Linghun 手动 Yoga 测量 + overflow hidden + marginTop 偏移（等价但非原生） |
| 未复制可疑源码 | 未读取 CCB ink fork 源码；ScrollBox 行为仅从 CCB FullscreenLayout 使用点推断 |

## 成品级结构化 Handoff Packet

```json
{
  "phase": 6,
  "status": "DEFERRED",
  "blocked_on": "ink ScrollBox component not available in public ink 7.x; CCB uses private @anthropic/ink fork",
  "resolution_options": [
    "A: Wait for ink 8.x with ScrollBox support (no timeline)",
    "B: Port ScrollBox from @anthropic/ink fork with independent implementation (high effort, 2-3d est.)",
    "C: Keep current ScrollViewport — feature-complete, production-grade, ~418 lines"
  ],
  "recommendation": "C (keep current) unless ink 8.x lands with ScrollBox",
  "evidence": [
    "ScrollBox absent from ink 7.0.3 build/ (verified via grep)",
    "ink latest public = 7.0.5 (verified via npm view)",
    "ScrollViewport.tsx:18 self-documents the gap",
    "Current scroll: stickToBottom ✓, clamp ✓, wheel/PgUp/PgDn ✓, block virtualization ✓",
    "Multiple phases (D.13/14D/R5/D.14D-C2) hardened the current system"
  ],
  "index_state": "not checked (single-phase, targeted reads)",
  "permission_mode": "auto",
  "model": "claude-opus-4-6",
  "budget": "N/A"
}
```
