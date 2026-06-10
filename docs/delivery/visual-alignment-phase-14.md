# Visual Alignment Phase 14 — 消息时间戳

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

用户消息旁显示 dim 时间戳，按时间梯度格式化（CCB `formatBriefTimestamp` 范式）。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `formatBriefTimestamp` 三梯度（当天/6天内/更早）+ `UserPromptMessage` `"You"` 标签旁 dim 色 |
| 自研行为 | Linghun 时间戳在 `│ ` 行首显示；格式适配 zh-CN/en-US 双语 |
| 新增模块 | `formatBriefTimestamp` 追加到 `text-utils.ts` |

## 已完成功能

### 14A. 时间戳梯度格式化

- **text-utils.ts** — `formatBriefTimestamp(ms, language)` 三梯度：
  - 当天：`14:32`（仅时间）
  - 6 天内：`周一 14:32` / `Mon 14:32`
  - 更早：`2026-01-15 14:32`
- zh-CN 使用中文星期，en-US 使用英文缩写

### 14B. ProductBlock user_text 渲染

- `│ ` 行首后追加 dim 时间戳：`│ 14:32 用户消息正文...`
- 仅 `messageKind="user_text"` 块渲染时间戳；slash command 块不受影响
- `ProductBlock` 新增 `language` prop（默认 `"zh-CN"`）

### 14C. 时间戳数据源

- `createUserTextBlock(sequence, text, timestamp)` 新增可选 `timestamp?: number`
- 调用方 `index.ts` 传入 `Date.now()` — 记录用户提交时刻
- 存量测试兼容（无 timestamp 参数 → 不渲染时间戳）

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/shell/types.ts` | `ProductBlockViewModel` 新增 `timestamp?: number` |
| `packages/tui/src/shell/text-utils.ts` | 新增 `formatBriefTimestamp` + 辅助函数 |
| `packages/tui/src/shell/models/command-transcript-presenter.ts` | `createUserTextBlock` 新增 `timestamp` 参数 |
| `packages/tui/src/index.ts` | 传入 `Date.now()` |
| `packages/tui/src/shell/components/ProductBlock.tsx` | 导入 `formatBriefTimestamp`；user_text 渲染 timestamp；新增 `language` prop |
| `packages/tui/src/shell/components/ShellApp.tsx` | 传递 `language` 到 `ProductBlock` |

## 关键设计

1. **零 view-model 穿透：** 时间戳从块创建时注入（`Date.now()`），不经过 view-model 计算。view-model 只透传 `block.timestamp`。
2. **渐变梯度：** 对标 CCB 的三梯度策略（当天时间 → 近周星期 → 远日日期），中文/英文分别适配星期名。
3. **渲染叠加：** 时间戳作为内联 dim text 插入 `│ ` 与正文之间，不改变 Box 结构。
4. **可选字段：** `timestamp` 为可选，存量创建路径（如测试中的 `createUserTextBlock(7, "text")`）不受影响。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

### 自动化测试

```
packages/tui shell/* — 全部通过:
  view-model.test.ts      344 passed (含 createUserTextBlock 测试)
  shell 全 17 文件         593 passed
```

### 手动验证路径

1. `linghun` task 模式 → 输入文字提交
2. 确认用户消息 `│ ` 后出现 dim 时间戳（如 `│ 14:32 消息正文`）
3. 等待跨天/跨周 → 确认梯度变化
4. Slash command（如 `/model`）不显示时间戳
5. no-color 模式不崩

### formatBriefTimestamp 格式测试

| 输入（相对 now） | zh-CN | en-US |
|-----------------|-------|-------|
| 当天 14:32 | `14:32` | `14:32` |
| 昨天 09:15 | `周四 09:15` | `Thu 09:15` |
| 3天前 18:00 | `周一 18:00` | `Mon 18:00` |
| 7天前 10:30 | `2026-06-04 10:30` | `2026-06-04 10:30` |
| 去年 08:00 | `2025-12-25 08:00` | `2025-12-25 08:00` |
| 无效值 | `""` | `""` |

## 已知问题

- `timestamp` 使用 `Date.now()` 记录客户端时间，不反映服务端消息时间戳。未来可从服务端响应取精确时间。
- 时区依赖本地系统设置；无 UTC 偏移显示。
- PanelRow (ShellApp 内嵌 ProductBlock) 使用默认 `"zh-CN"`，非 user_text 块无影响。

## 不在本阶段处理的内容

- 服务端精确时间戳（当前用客户端 `Date.now()`）
- UTC 偏移显示
- 消息编辑/删除时间戳
- Task 展示双行布局（Phase 7）

## 下一阶段衔接

Phase 7：Task 展示专业化 — Todo 列表改为两行布局（title + owner 行 / status + blockedBy 行），completed strikethrough + dimColor。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §14 |
| 本阶段参考的 CCB 文件 | `formatBriefTimestamp.ts` (三梯度实现), `HighlightedThinkingText.tsx:24` (渲染位置), `UserPromptMessage.tsx` (整体结构) |
| 行为参考 | CCB 三梯度时间格式化 + dim 色 + 消息标签旁渲染 |
| 自研实现 | zh-CN/en-US 双语星期名；`│ ` 行内渲染（非 `"You"` 标签模式）；客户端 `Date.now()` 时间源 |
| 未复制可疑源码 | 仅参考梯度策略和渲染位置；Linghun 自写格式化和渲染逻辑 |

## 成品级结构化 Handoff Packet

```json
{
  "phase": 14,
  "status": "DONE",
  "next_phase": 7,
  "forbidden": [
    "server-side timestamps (current source is Date.now())",
    "UTC offset display",
    "message edit/delete timestamps"
  ],
  "evidence": ["593 shell tests pass", "createUserTextBlock test backward-compatible"],
  "index_state": "not checked",
  "permission_mode": "auto",
  "model": "claude-opus-4-6",
  "budget": "~6s test duration"
}
```
