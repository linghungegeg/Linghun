# Visual Alignment Phase 17 — WebSearch/WebFetch 专用 UI

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

WebSearch/WebFetch 工具输出从通用摘要改为专用紧凑格式。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `WebSearchTool/UI.tsx` + `WebFetchTool/UI.tsx` 专用格式（搜索次数+耗时、fetch 大小+状态码） |
| 自研行为 | Linghun `formatPrimaryToolLead` 新增 WebSearch/WebFetch 分支；ToolName 类型新增条目 |
| 新增模块 | 无新文件 |

## 已完成功能

### 17A. WebSearch 专用格式（DONE）

- `formatWebSearchLead`：从 `output.data` 读取 `searches`/`count` + `duration`/`durationMs`
- zh-CN：`执行 3 次搜索 · 2.3s`
- en-US：`Did 3 searches in 2.3s`
- 单复数区分（`1 search` vs `N searches`）
- Fallback：`WebSearch 已完成` / `WebSearch completed`

### 17B. WebFetch 专用格式（DONE）

- `formatWebFetchLead`：从 `output.data` 读取 `size`/`contentLength` + `status`/`statusCode` + `statusText`
- zh-CN：`收到 15.3KB · 200 OK`
- en-US：`Received 15.3KB · 200 OK`
- 自适应单位：≥1024 bytes → KB，<1024 bytes → B
- Fallback：`WebFetch 已完成` / `WebFetch completed`

### 17C. ToolName 类型扩展（DONE）

- `packages/tools/src/index.ts` ToolName 新增 `"WebSearch"` | `"WebFetch"`

## CCB 源码比对

| 维度 | CCB WebSearchTool/WebFetchTool UI | Linghun 实现 | 对齐 |
|------|----------------------------------|-------------|------|
| WebSearch 格式 | `"Did 3 searches in 2.3s"` | `"Did 3 searches in 2.3s"` | ✓ |
| WebFetch 格式 | `"Received 15KB (200 OK)"` | `"Received 15.3KB · 200 OK"` | ✓ (等效) |
| 搜索次数源 | data.searches | data.searches / data.count | ✓ |
| 状态码格式 | statusCode | data.status / data.statusCode + statusText | ✓ |
| 单复数 | searches / search(es) | `searches === 1 ? "search" : "searches"` | ✓ |
| 性能信息 | duration (seconds) | data.duration / data.durationMs | ✓ |
| 内置工具隔离 | 独立分支 | 在 Grep/Glob/Read/Bash 之后判断 | ✓ |

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tools/src/index.ts` | ToolName 新增 `"WebSearch"` \| `"WebFetch"` |
| `packages/tui/src/tool-output-presenter.ts` | `formatPrimaryToolLead` 新增 WebSearch/WebFetch 分支；新增 `formatWebSearchLead` + `formatWebFetchLead` 函数 |

## 关键设计

1. **数据源 elastic：** `formatWebSearchLead` 从 `data.searches` 或 `data.count` 读取搜索次数，从 `data.duration` 或 `data.durationMs` 读取耗时。兼容不同 MCP 实现的数据结构。
2. **自适应单位：** `formatWebFetchLead` 根据字节数选择 B 或 KB 单位（≥1024 → KB），1 位小数。
3. **Fallback 安全：** 缺少 `searches`/`size`/`status` 时，回退到泛型 `{name} 已完成` 不崩。
4. **工具未实现：** WebSearch/WebFetch 在当前 Linghun 中未实际实现；Phase 17 为格式化层预备，将来工具接入时直接适用。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

### 自动化测试

```
packages/tui tool-output-presenter.test.ts  33 passed
packages/tui shell/*                         593 passed
packages/tools index.test.ts                 40 passed
Total:                                       666 passed
```

### 手动验证路径

1. 将来 WebSearch 工具接入后：确认输出 `执行 N 次搜索 · Ss`
2. 将来 WebFetch 工具接入后：确认输出 `收到 N KB · 200 OK`
3. 内置工具（Grep/Glob/Read/Bash）格式不受影响

### formatWebSearchLead 格式测试（设计验证）

| data | zh-CN | en-US |
|------|-------|-------|
| `{searches:3, duration:2.3}` | `执行 3 次搜索 · 2.3s` | `Did 3 searches in 2.3s` |
| `{searches:1, duration:0.5}` | `执行 1 次搜索 · 0.5s` | `Did 1 search in 0.5s` |
| `{count:5}` | `执行 5 次搜索` | `Did 5 searches` |
| `{}` | `WebSearch 已完成` | `WebSearch completed` |

### formatWebFetchLead 格式测试（设计验证）

| data | zh-CN | en-US |
|------|-------|-------|
| `{size:15360, status:200, statusText:"OK"}` | `收到 15.0KB · 200 OK` | `Received 15.0KB · 200 OK` |
| `{contentLength:512, statusCode:404}` | `收到 512B · 404` | `Received 512B · 404` |
| `{size:1024}` | `收到 1.0KB` | `Received 1.0KB` |
| `{}` | `WebFetch 已完成` | `WebFetch completed` |

## 已知问题

- **工具未实际实现：** WebSearch/WebFetch 在当前 Linghun 代码库中未实现；Phase 17 仅为格式化层预备，需工具接入后验证。
- **无进度展示：** CCB WebSearch 有 `"Searching: {query}"` 进度文本，Linghun 未实现（需 tool streaming 支持）。
- **duration 固定秒显示：** `toFixed(1)` 强制 1 位小数，<0.1s 显示为 `0.0s`。

## 不在本阶段处理的内容

- WebSearch/WebFetch 工具实际实现
- 搜索进度展示（`"Searching: {query}"`）
- Fetch 响应内容渲染（仅格式化 lead 行）
- 超时/错误状态的专用格式

## 下一阶段衔接

Phase 9：Compact 边界标记 — 对话压缩后插入可视化边界标记。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §17 |
| 本阶段参考的 CCB 文件 | `WebSearchTool/UI.tsx`（搜索次数+耗时格式）；`WebFetchTool/UI.tsx`（fetch 大小+状态码格式） — 文件不在当前 CCB 源码树，通过计划文档转述 |
| 行为参考 | CCB `"Did 3 searches in 2.3s"` / `"Received 15KB (200 OK)"` 范式 |
| 自研实现 | Linghun 自写 `formatWebSearchLead` + `formatWebFetchLead`；elastic 数据源（searches/count, duration/durationMs, size/contentLength, status/statusCode） |
| 未复制可疑源码 | 仅参考格式范式；Linghun 自写所有实现 |

## 成品级结构化 Handoff Packet

```json
{
  "phase": 17,
  "status": "DONE",
  "next_phase": 9,
  "forbidden": [
    "WebSearch/WebFetch tool implementation",
    "search progress display (\"Searching: {query}\")",
    "fetch response body rendering",
    "timeout/error dedicated formats"
  ],
  "evidence": ["666 tests pass (593 shell + 33 tool-output + 40 tools)"],
  "index_state": "not checked (2 files, direct edits)",
  "permission_mode": "auto",
  "model": "claude-opus-4-6",
  "budget": "~6s test duration"
}
```
