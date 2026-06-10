# Visual Alignment Phase 18 — MCP 工具输出结构化展示

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

非内置工具（MCP 等）的输出从通用摘要升级为结构化解析展示，含大响应 token 警告。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `MCPTool` 系列组件结构化输出策略（tryUnwrapTextPayload / tryFlattenJson / MCPTextOutput） |
| 自研行为 | Linghun 自有 JSON 结构化解包 + 大响应警告；不影响 Grep/Glob/Read/Bash 内置工具路径 |
| 新增模块 | 无新文件 |

## 已完成功能

### 18A. 结构化输出解包（DONE）

- **`tryUnwrapStructuredText`** 函数：尝试从 JSON 工具输出中提取人类可读文本
  - 单字段解包：`content` / `text` / `result` 字符串字段 → 直接展开为正文
  - 数组解包：`[{type:"text", text:"hello"}, ...]` → 拼接 text 字段
  - 多字段回退：`JSON.stringify(obj, null, 2)` 紧凑可读格式
- **集成点：** `createToolOutputPreview` 默认分支（非 Todo / 非 summary-first）调用 `tryUnwrapStructuredText`
- 仅影响非内置工具（Grep/Glob/Read/Bash/Write/Edit/MultiEdit 走独立路径）

### 18B. 大响应 Token 警告（DONE）

- `formatToolOutput` 检测 `output.text.length > 10_000`
- 追加大响应警告行：`⚠ 大响应 · ~N tokens` / `⚠ Large response · ~N tokens`
- 估算公式：字符数 ÷ 4 ≈ token 数

### 18C. Lead 行改善（DONE）

- `formatPrimaryToolLead` 默认分支新增 `tryExtractLeadText`
- 非内置工具：从输出文本提取首行（≤80 chars）作为 lead，替代泛型 `{name} 摘要`
- 保持 `{name} 摘要：{layered.summary}` 作为无结构化文本时的 fallback

## CCB 源码比对

| 维度 | CCB MCPTool 系列 | Linghun 实现 | 对齐 |
|------|-----------------|-------------|------|
| 结构化解包 | `tryUnwrapTextPayload` / `tryFlattenJson` (Tool.ts renderToolResultMessage) | `tryUnwrapStructuredText` JSON 解析 + 字段提取 | ✓ (自研) |
| content 字段展开 | `MCPTextOutput` 三种输出策略 | 单字段 text/content/result → 展开 | ✓ (简化) |
| 数组内容拼接 | content[{type, text}] 拼接 | `item.text` / `item.content` 过滤 + join | ✓ |
| 大响应警告 | >10K tokens 追加警告 | >10K chars → `⚠ 大响应 · ~N tokens` | ✓ |
| Lead 行 | renderToolResultMessage 首行摘要 | `tryExtractLeadText` 首行 ≤80 chars | ✓ (自研) |
| 内置工具隔离 | Grep/Glob/Read/Bash 独立分支 | 同上，结构化解包仅针对 default 分支 | ✓ |

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/tool-output-presenter.ts` | `formatToolOutput`：大响应警告；`formatPrimaryToolLead`：default 分支改善；`createToolOutputPreview`：结构化解包；新增 `tryUnwrapStructuredText` + `tryExtractLeadText` 函数 |

## 关键设计

1. **不影响内置工具：** `tryUnwrapStructuredText` 仅在 `createToolOutputPreview` 的 default 分支调用（`!isSummaryFirstTool(name)`）。Grep/Glob/Read/Bash/Write/Edit/MultiEdit 的 summary-first 路径不受影响。
2. **JSON 解析安全：** 所有解析在 try/catch 内，解析失败静默返回 undefined，fallback 到原文。
3. **大响应阈值：** 10K 字符 ≈ 2.5K tokens，与 CCB 阈值对齐。
4. **Lead 文本截断：** `tryExtractLeadText` 最多返回 80 字符，超长截断加 `...`。
5. **数组解包：** 支持 MCP content array 格式 `[{type: "text", text: "..."}]`，提取所有 text 字段拼接。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

### 自动化测试

```
packages/tui tool-output-presenter.test.ts  33 passed (existing)
packages/tui shell/*                         593 passed
Total:                                       626 passed
```

### 手动验证路径

1. 使用 MCP 工具（如 codebase-memory search_code）→ 确认输出有结构化摘要而非泛型 `摘要：...`
2. 构造大响应（>10K 字符）→ 确认 `⚠ 大响应 · ~N tokens` 警告出现
3. Grep/Glob/Read/Bash 输出格式不变（回归验证）

### tryUnwrapStructuredText 格式测试（非自动化）

| 输入 | 输出 |
|------|------|
| `"{\"content\":\"hello\"}"` | `hello` |
| `"{\"text\":\"hello world\"}"` | `hello world` |
| `"{\"result\":\"ok\"}"` | `ok` |
| `"{\"content\":[{\"type\":\"text\",\"text\":\"a\"},{\"type\":\"text\",\"text\":\"b\"}]}"` | `a\nb` |
| `"{\"a\":1,\"b\":2}"` | `{\n  \"a\": 1,\n  \"b\": 2\n}` |
| `"plain text"` | undefined (fallthrough to raw text) |
| `""` | undefined |
| `"not json"` | undefined (parse failure → catch) |

## 已知问题

- **JSON 检测依赖 parse 成功：** `tryUnwrapStructuredText` 仅在 `JSON.parse` 成功时触发；非 JSON 纯文本（如 MCP 工具返回 markdown）不经过结构化解包
- **大响应阈值固定：** 10K 字符阈值不可配置；可通过未来 `/config` 暴露
- **content 数组仅取 text：** MCP 的 `content[{type: "image", ...}]` 等非文本类型被跳过
- **token 估算粗略：** `chars ÷ 4` 是近似值，实际 token 数因模型 tokenizer 差异可能不同

## 不在本阶段处理的内容

- MCP 工具详情视图（CCB `MCPToolDetailView`）
- MCP 工具列表视图（CCB `MCPToolListView`）
- MCP server 连接状态展示
- 可配置的大响应阈值
- 进度百分比展示

## 下一阶段衔接

Phase 17：命令面板历史分组 — `/` 斜杠命令面板历史展示。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §18 |
| 本阶段参考的 CCB 文件 | `MCPToolListView.tsx:1-85`；`MCPToolDetailView.tsx:1-121`；`UserToolSuccessMessage.tsx` (renderToolResultMessage 调用)；`Messages.tsx` (MCP 消息渲染) |
| 行为参考 | CCB renderToolResultMessage 结构化输出策略；tryUnwrapTextPayload / tryFlattenJson 语义 |
| 自研实现 | `tryUnwrapStructuredText` JSON 单字段/数组解包；`tryExtractLeadText` 首行摘要；10K chars 大响应阈值 + 字符/token 近似估算 |
| 未复制可疑源码 | 仅参考结构化策略语义；Linghun 自写所有实现 |

## 成品级结构化 Handoff Packet

```json
{
  "phase": 18,
  "status": "DONE",
  "next_phase": 17,
  "forbidden": [
    "MCP tool detail/list views",
    "MCP server connection status UI",
    "configurable large-response threshold",
    "progress percentage display"
  ],
  "evidence": ["626 tests pass (593 shell + 33 tool-output-presenter)"],
  "index_state": "not checked (1 file, direct edits)",
  "permission_mode": "auto",
  "model": "claude-opus-4-6",
  "budget": "~6s test duration"
}
```
