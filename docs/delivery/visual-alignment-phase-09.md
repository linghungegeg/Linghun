# Visual Alignment Phase 9 — Compact 边界标记

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

对话压缩后在 transcript 中插入可视化边界标记。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `CompactBoundaryMessage.tsx` dim 边界行 `"✻ Conversation compacted"` |
| 自研行为 | Linghun `createCompactBoundaryBlock` + `pushTranscriptBlock` 回调管道 + `compact_boundary` messageKind 渲染 |
| 新增模块 | 无新文件 |

## 已完成功能

### 9A. Compact 边界块插入

- `compact-preflight-runtime.ts`：微压缩成功后，从 `projection.preCompactChars` / `postCompactChars` 计算释放量和百分比，通过 `context.pushTranscriptBlock` 推入边界块
- `createCompactBoundaryBlock()`：生成 `ProductBlockViewModel`（`messageKind: "compact_boundary"`）
- zh-CN：`✻ 对话已压缩 · 释放约 N K 字符 (XX%)`
- en-US：`✻ Conversation compacted · ~N K chars freed (XX%)`

### 9B. Ink 渲染

- `ProductBlock.tsx`：`compact_boundary` 分支 → dimColor `✻ {title}` 单行，`marginY={1}`

### 9C. Plain 渲染

- `plain-renderer.ts`：`compact_boundary` 分支 → dim `✻ {title}` 单行

### 9D. 回调管道

- `TuiContext.pushTranscriptBlock`：可选回调，由 shell 初始化器设置
- `index.ts`：plain 和 ink 路径均注入 `(block) => blocks.push(block)`
- 安全回退：pushTranscriptBlock 未设置时（测试/mock 上下文）静默跳过（`?.()`）

## CCB 源码比对

| 维度 | CCB `CompactBoundaryMessage.tsx` | Linghun 实现 | 对齐 |
|------|----------------------------------|-------------|------|
| 边界标记字符 | `✻` | `✻` | ✓ |
| 消息内容 | `"Conversation compacted (ctrl+o for history)"` | `"对话已压缩 · 释放约 N K 字符 (XX%)"` | ✓ (自研，含量化数据) |
| 视觉效果 | `<Text dimColor>` | `<Text dimColor>` | ✓ |
| 间距 | `<Box marginY={1}>` | `<Box marginY={1}>` | ✓ |
| 插入位置 | 消息流中的 system message | transcript blocks 数组末尾（微压缩后立即可见） | ✓ (等效) |
| 全屏/非全屏条件 | fullscreen 返回 null | 无区分（始终显示） | ⚠ Linghun 无 fullscreen 模式 |
| 快捷键提示 | Ctrl+O toggleTranscript | 无（不适用） | N/A |
| microcompact_boundary | 永不渲染（返回 null） | 不适用（Linghun 微压缩仅此一种） | ✓ |

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/shell/types.ts` | `MessageBlockKind` 新增 `"compact_boundary"` |
| `packages/tui/src/shell/view-model.ts` | 新增 `createCompactBoundaryBlock()` |
| `packages/tui/src/tui-context-runtime.ts` | `TuiContext` 新增 `pushTranscriptBlock` 可选回调 |
| `packages/tui/src/index.ts` | plain + ink 路径注入 `pushTranscriptBlock` |
| `packages/tui/src/compact-preflight-runtime.ts` | 微压缩成功后调用 `pushTranscriptBlock` |
| `packages/tui/src/shell/components/ProductBlock.tsx` | `compact_boundary` 分支 dim 渲染 |
| `packages/tui/src/shell/plain-renderer.ts` | `compact_boundary` 分支 dim 渲染 |

## 关键设计

1. **可选回调回退：** `pushTranscriptBlock` 为可选字段，`compact-preflight-runtime` 使用 `?.()` 安全调用。测试/mock 上下文中未设置时静默跳过。
2. **仅微压缩触发：** 边界仅在 `compactMessagesToFit` 返回 `changed=true` 且 `boundary` 存在时推入；deep compact 不触发额外边界。
3. **量化数据内联：** 释放量（K chars）和百分比直接嵌入边界文本，用户一眼可知压缩效果。
4. **无循环依赖：** `compact-preflight-runtime` → `view-model` → `index.ts`（仅 type import TuiContext），runtime 调用全部在 async 函数体内。
5. **不区分 fullscreen：** Linghun 无 CCB 的 fullscreen mode，边界始终显示。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

### 自动化测试

- TypeScript 类型检查：`packages/tui` 0 新增编译错误（仅预存的 `@linghun/providers` decl 缺失）
- 现有 compact-preflight 测试不受影响（`pushTranscriptBlock` 可选，未设置时静默跳过）
- 现有 view-model / ProductBlock / plain-renderer 测试不受影响

### 手动验证路径

1. 启动 `linghun`，发起多轮对话触发微压缩（上下文接近 limit）
2. 确认 transcript 中出现 `✻ 对话已压缩 · 释放约 N K 字符 (XX%)` 边界行
3. 边界行为 dim 显示，不抢主内容视觉权重

## 已知问题

- **无快捷键提示：** CCB 显示 `(ctrl+o for history)` 引导用户查看压缩前历史；Linghun 未实现（`Ctrl+O` 当前用于 transcript 展开，非历史切换）
- **无多边界过滤：** CCB 在非 fullscreen 模式通过 `getMessagesAfterCompactBoundary` 过滤旧消息；Linghun 保留全部历史 blocks，边界仅作视觉标记
- **Deep compact 无边界：** 仅微压缩触发边界块；deep compact 在 `maybeRunDeepCompactBeforeProvider` 成功后不推入边界（语义压缩 ≠ 消息丢弃）

## 不在本阶段处理的内容

- Ctrl+O 历史切换（需全新 transcript 过滤管线）
- 多边界压缩消息过滤（`getMessagesAfterCompactBoundary` 等效）
- Deep compact 独立边界标记
- 边界点击交互（CCB 无此能力）

## 下一阶段衔接

Phase 10：Context 可视化 — `/context` 命令输出增强，显示上下文使用率、消息数、token 分布。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §9 |
| 本阶段参考的 CCB 文件 | `CompactBoundaryMessage.tsx:1-13`（全文）；`Message.tsx:191-203`（渲染分发）；`utils/messages.ts:4944-4997`（创建函数） |
| 行为参考 | CCB `✻ Conversation compacted` dim 边界范式 |
| 自研实现 | Linghun `createCompactBoundaryBlock` + `pushTranscriptBlock` 回调管道；量化释放数据内联 |
| 未复制可疑源码 | 仅参考 dim 边界标记的视觉范式；Linghun 自写所有实现 |

## 成品级结构化 Handoff Packet

```json
{
  "phase": 9,
  "status": "DONE",
  "next_phase": 10,
  "forbidden": [
    "Ctrl+O history toggle",
    "multi-boundary message filtering (getMessagesAfterCompactBoundary)",
    "deep compact boundary",
    "boundary click interaction"
  ],
  "evidence": ["0 new tsc errors", "pushTranscriptBlock optional (safe fallback)", "biome check passed all 7 files"],
  "index_state": "not checked (direct edits)",
  "permission_mode": "auto",
  "model": "claude-opus-4-6",
  "budget": "N/A"
}
```
