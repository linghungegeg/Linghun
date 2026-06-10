# Visual Alignment Phase 02 — 进度反馈专业化

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

对齐 CCB 的实时进度展示：`●` 闪烁 dot + 计时器 + 行数/字节统计。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `ToolUseLoader` 的 `●` 600ms 闪烁；CCB `ShellProgressMessage` 的行数/字节统计 + elapsed 括号格式 |
| 自研行为 | Linghun `ActivityIndicator` 保留多 phase 通用架构；no-color 保留 `-\|/` 旋转 |
| 新增模块 | 无新文件；`formatFileSize` 内部工具函数（ShellApp.tsx） |

## 已完成功能

### 2A. Spinner 闪烁

- **ShellApp.tsx:525-530 (`activityMarker`)** — braille 轮换 `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` 改为 `●` 闪烁：
  - 100ms tick 不变
  - `frame % 6 < 3` → `●` 可见（300ms），否则 ` ` 隐藏（300ms），总周期 600ms
  - 对齐 CCB `useBlink` 的 600ms 闪烁节奏
- **no-color 模式保留** `-\|/` 旋转（`frame % 4`）
- `useTerminalFocus` 失焦暂停：Linghun ink-runtime 不支持 — 标记为 deferred

### 2B. 进度统计行

**数据管道（4 文件直通传递）：**
- **tui-context-runtime.ts** — TuiContext 新增 `requestActivityToolLines` / `requestActivityToolBytes`
- **model-stream-runtime.ts** — `startRequestActivity` 初始化 0；`clearRequestActivity` 清理
- **model-tool-runtime.ts** — Bash `onProgress` 中累积 `lines.length` 和 `Buffer.byteLength`
- **view-model.ts** — `mapRequestActivityToView` 透传到 `TaskActivityView.totalLines` / `totalBytes`

**渲染（ShellApp.tsx:449-518）：**
- `tool_running` phase 且 stats 非空时，在 spinner 行下方追加 dim 统计行
- 格式：`   ~{N} 行 · {X.X}MB` / `   ~{N} lines · {X.X}MB`
- elapsed 时间改为括号格式 `(3s)` 对齐 CCB `ShellTimeDisplay`

**types.ts** — `TaskActivityView` 新增 `totalLines?: number; totalBytes?: number`

**ShellApp.tsx** — 新增 `formatFileSize` 工具函数

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/tui-context-runtime.ts` | 新增 2 个 context 字段 |
| `packages/tui/src/model-stream-runtime.ts` | 初始化/清理新字段 |
| `packages/tui/src/model-tool-runtime.ts` | Bash onProgress 累积行/字节 |
| `packages/tui/src/shell/view-model.ts` | 透传 stats 到 TaskActivityView |
| `packages/tui/src/shell/types.ts` | TaskActivityView 扩展 |
| `packages/tui/src/shell/components/ShellApp.tsx` | spinner 闪烁 + stats 渲染 + formatFileSize |

## 关键设计

1. **Blink 实现：** 保留现有 100ms `setInterval` 定时器，通过 `frame % 6 < 3` 实现 600ms 周期闪烁。CCB 用 `useAnimationFrame`，Linghun ink-runtime 无此 API，用 `setInterval` 等效替代。

2. **数据累积时机：** 仅在 Bash 工具的 `onProgress` 回调中累积。原因是 Bash 是 Linghun 唯一支持流式输出的工具（其他工具一次性返回结果）。`Buffer.byteLength` 用于精确字节计数（避免多字节字符误差）。

3. **统计行只在 tool_running 显示：** thinking / continuing / permission_waiting 不显示行数/字节（此时没有流式工具输出）。

## 配置项

无新增配置。

## 命令

无新增命令。

## 测试与验证

- `vitest run packages/tui/` — 2966/2967 通过
- 1 个预存 model routing 失败（`index.test.ts:9497`），与 Phase 2 无关
- 无测试引用旧 braille 格式需要更新

## 已知问题

无。Phase 2 无已知回归。

## 不在本阶段处理的内容

- `useTerminalFocus` 失焦暂停 — Linghun ink-runtime 未实现，需后续升级
- 最后 5 行实时预览 — 需在 context 中新增流式文本 buffer，投入较大
- ShellProgressMessage 独立组件 — 当前 ActivityIndicator 通用架构可覆盖，无需拆分

## 下一阶段衔接

按 `VISUAL_ALIGNMENT_PLAN.md` 顺序，下一阶段为阶段 3（Agent Tree 布局对齐）：
- Agent Tree 移到固定底部（`flexShrink={0}`），不随消息滚动
- 上下键选择 + Enter 进入 agent 详情
- 移除 "前 4 个截断" 限制

## 参考核对

- 本阶段参考了 CCB `ToolUseLoader.tsx`（`●` blink）、`useBlink.ts`（600ms 闪烁机制）、`ShellProgressMessage.tsx`（行数/字节统计 + elapsed 格式）、`ShellTimeDisplay.tsx`（括号格式）
- Linghun 文档读取：`VISUAL_ALIGNMENT_PLAN.md`
- 未复制 CCB 源码实现；spinner 闪烁和 stats 渲染均为 Linghun 自研

## 开发者排查入口

- Spinner 闪烁：`packages/tui/src/shell/components/ShellApp.tsx` `activityMarker()` (line 525)
- 进度统计：`packages/tui/src/shell/components/ShellApp.tsx` `ActivityIndicator()` (line 449)
- 数据累积：`packages/tui/src/model-tool-runtime.ts` Bash onProgress (line 2698-2700)
- 数据管道：`packages/tui/src/tui-context-runtime.ts` (line 365-366) → `model-stream-runtime.ts` (line 310-313) → `view-model.ts` (line 1255-1256)

---

## Handoff Packet

```yaml
phase: "visual-alignment-02"
status: DONE
next_phase: "visual-alignment-03"
forbidden:
  - "不得恢复 braille spinner 到 ActivityIndicator"
  - "不得移除 tool_running stats 行"
  - "不得修改 no-color 模式 spinner 行为"
evidence:
  - "vitest: 2966/2967 PASS (packages/tui/)"
  - "tsc: 无新增 type error"
  - "1 个预存 model routing 失败 — 与 Phase 2 无关"
index_status: "N/A"
permission_mode: "N/A"
model: "claude-opus-4-6"
budget: "N/A"
```
