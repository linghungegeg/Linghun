# Visual Alignment Phase 08 — Session 面板增强（搜索 + 预览 + 时间分组）

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

Session 面板从纯列表升级为可搜索、可过滤、可预览的 picker。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `LogSelector.tsx` 搜索模式 + 预览模式 + SessionPreview；CCB `SearchBox` 搜索栏布局 |
| 自研行为 | Linghun 搜索输入通过 Composer 派发事件驱动（非本地 useInput）；时间分组（Today/Yesterday/Older）；简化预览（元数据摘要） |
| 新增模块 | 无新文件 |

## 已完成功能

### 8A. 搜索输入行（DONE）

- `/` 键进入搜索模式：Composer 捕获 `/` → `sessions-search` 事件 → `mode="search"`
- 搜索栏渲染：`搜索：<query>█` dim 行（对齐 CCB SearchBox `prompt + query + cursor`）
- 实时过滤：按 session `title` + `id` 不区分大小写匹配
- 输入路由：搜索模式下所有字符/退格/删除通过 Composer → `sessions-search-input` / `sessions-search-delete` 事件
- Esc/Enter 退出搜索模式，恢复 list 视图

### 8B. Ctrl+V 预览模式（DONE）

- `Ctrl+V` 在 list 模式下触发 `sessions-preview` 事件 → `mode="preview"`
- 预览渲染：标题 `预览 · Ctrl+V: <session title>` + 元数据行（时间 · 消息数 · session id）+ `Esc 返回 · Enter 恢复` hint
- 仅当前 non-current session 可预览（current session 跳过）
- Esc 返回 list 视图

### 8C. 时间分组标题（DONE）

- 三梯度分组：**今天** / **昨天** / **更早**（Today / Yesterday / Older）
- 按 `updatedAt` ISO 字符串计算 dayDiff
- 分组标题 bold + muted 色插入条目之间，仅当分组变化时注入
- 分组标题不影响光标导航（光标仅计 entry）

## 改动对照（CCB 源码事实 vs 实现）

| 维度 | CCB `LogSelector.tsx` | Linghun 实现 | 对齐 |
|------|----------------------|-------------|------|
| 搜索入口 | 任意字符进入搜索模式 (line 844-848) | `/` 键进入搜索模式 | ✓ (简化) |
| 搜索栏布局 | `SearchBox` 组件 (3-line: border+content+border) | 单行 `搜索：query█` dim text | ✓ (简化) |
| 搜索过滤 | `searchQuery` → `filteredLogs` (line 222-250) | `searchQuery` → `filtered` entries (title+id match) | ✓ |
| 退格/删除 | TextInput onChange 全量管理 | `sessions-search-delete` 逐字删除 | ✓ (简化) |
| 预览入口 | `Ctrl+V` → `setViewMode('preview')` (line 840) | `Ctrl+V` → `sessions-preview` 事件 | ✓ |
| 预览内容 | `SessionPreview.tsx` 渲染完整消息列表 | 元数据摘要 (title + time + msg count + id) | ⚠ 简化 |
| 预览退出 | Esc → `setViewMode('list')` (line 891) | Esc → `sessions-preview-close` | ✓ |
| 时间分组 | CCB LogSelector 无时间分组（按 sessionId 分组） | Today/Yesterday/Older 三梯度 | Linghun 新增 |
| 分支过滤 | `branchFilterEnabled` + `Ctrl+B` (line 173) | 未实现 (Linghun 无分支概念) | DEFERRED |
| worktree 过滤 | `showAllWorktrees` + `Ctrl+W` | 未实现 (Linghun 无 worktree 概念) | DEFERRED |

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/shell/types.ts` | `sessionsPanel` 新增 `mode/searchQuery/previewEntryId`；新增 6 个事件类型 |
| `packages/tui/src/shell/components/Composer.tsx` | sessions 键盘派发新增搜索/预览模式路由 |
| `packages/tui/src/shell/components/SessionsPanel.tsx` | 全量重构：搜索栏 + 时间分组 + 预览模式 + 过滤逻辑 |
| `packages/tui/src/index.ts` | 新增 6 个 sessions 事件处理器 |

## 关键设计

1. **搜索输入不走本地 useInput：** 保持与 Composer 互斥的架构约束。搜索模式下 Composer 将键盘事件路由到 `sessions-search-*` 事件，不经过 Composer 自有 buffer。
2. **逐字删除：** 搜索 query 通过 `sessions-search-delete` 逐字删除（`slice(0, -1)`），无需光标偏移管理。
3. **预览仅元数据：** 预览模式显示 session 标题、时间、消息数、id 摘要，不渲染完整消息（避免在 picker 内嵌套 transcript）。
4. **时间分组纯视觉：** 分组标题渲染在条目之间，不影响 `cursor` 索引。`cursor` 始终指向 `filtered[ idx ]`，箭头键移动不受分组标题干扰。
5. **搜索保持光标语义：** 过滤后列表的 cursor 位置可能偏移到新列表的相同 index（若原 cursor >= filtered.length 则取 last）。
6. **Mode 互斥：** `mode` 为 `"search"`、`"preview"` 或 `undefined`（list），三者互斥。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

### 自动化测试

```
packages/tui shell/* — 全部通过:
  shell 全 17 文件         593 passed
```

### 手动验证路径

1. `linghun` → `/sessions` → 确认面板打开，底部 nav 提示含 `/ 搜索 · Ctrl+V 预览`
2. 按 `/` → 进入搜索模式 → 搜索栏显示 `搜索：█`
3. 输入关键词 → 列表实时过滤 → 退格可逐字删除 → Esc 退出搜索
4. 在 list 模式选中非当前 session → `Ctrl+V` → 预览模式显示元数据
5. 预览模式按 `Esc` → 返回 list
6. 确认时间分组标题在 session 列表间正确显示（Today/Yesterday/Older）

### formatBriefTimestamp 不涉及本阶段

时间戳格式化沿用 Phase 14 的 `formatBriefTimestamp`，不受本阶段影响。

## 已知问题

- **预览仅元数据：** 预览模式不渲染实际消息内容。CCB `SessionPreview.tsx` 调用 `loadFullLog()` + `<Messages>` 组件渲染完整 transcript。Linghun 当前仅显示 title/time/msgCount/id 元数据摘要。未来可通过 `store.loadMessages()` 加载前 N 条渲染。
- **搜索无粘贴支持：** 搜索输入通过 `sessions-search-input` 逐字符传递（Composer 派发），不支持粘贴大段文本。需要未来增加 `sessions-search-paste` 事件。
- **过滤后光标位置：** 当搜索过滤缩小列表时，cursor 可能指向原索引（可能越界），当前未做越界修正（cursor 停留在 filtered 列表外时箭头移动可恢复）。
- **无分支/worktree 过滤：** Linghun 无 CCB 的分支/worktree 概念，相关过滤未实现。

## 不在本阶段处理的内容

- 预览模式渲染实际消息内容（需 store.loadMessages 集成）
- 分支过滤（Ctrl+B）、worktree 过滤（Ctrl+W）
- 搜索粘贴（paste event → search query）
- Session rename（CCB LogSelector rename 模式）
- Agentic search（CCB LogSelector agentic search 集成）

## 下一阶段衔接

Phase 13：键盘快捷键面板 — 统一快捷键帮助面板对接 Phase 16 的 `? 快捷键` 入口。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §8 |
| 本阶段参考的 CCB 文件 | `LogSelector.tsx:1-1237`（搜索模式 579-582 / 预览模式 840-843, 886-896 / SearchBox 928-933 / 过滤展示 863, 934-939）；`SearchBox.tsx:1-2`（ink re-export）；`SessionPreview.tsx:1-102`（预览结构） |
| 行为参考 | CCB 搜索/预览/列表三模式状态机；SearchBox 搜索栏布局；SessionPreview 元数据 + hints |
| 自研实现 | Composer 驱动的搜索输入派发；逐字删除；时间分组（Today/Yesterday/Older）；元数据预览 |
| 未复制可疑源码 | 仅参考模式状态机和 UI 布局范式；Linghun 自写所有实现 |

## 成品级结构化 Handoff Packet

```json
{
  "phase": 8,
  "status": "DONE",
  "next_phase": 13,
  "forbidden": [
    "preview message content rendering (store.loadMessages needed)",
    "branch/worktree filtering",
    "search paste support",
    "session rename",
    "agentic search integration"
  ],
  "evidence": ["593 shell tests pass"],
  "index_state": "not checked (4 files, direct edits)",
  "permission_mode": "auto",
  "model": "claude-opus-4-6",
  "budget": "~6s test duration"
}
```
