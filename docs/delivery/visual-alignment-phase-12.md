# Visual Alignment Phase 12 — 工具输出摘要格式对齐

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

`formatPrimaryToolLead` 从"统计先行"改为 CCB 的"动词+粗体数字"格式。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `SearchResultSummary` 的 `"Found {N} lines"` + bold 数字 + 单复数 |
| 自研行为 | 保留中英双语，数字用 `**N**` markdown 标记供下游 bold 渲染 |
| 新增模块 | 无新文件 |

## 已完成功能

### 12A-1. formatPrimaryToolLead 格式变更

| 工具 | 旧格式 (zh-CN) | 新格式 (zh-CN) | 旧格式 (en-US) | 新格式 (en-US) |
|------|-------------|-------------|---------------|---------------|
| Grep | `搜索摘要：5 处。` | `找到 **5** 处匹配。` | `Search summary: 5 match(es).` | `Found **5** matches.` |
| Read | `读取摘要：42 行。` | `读取 **42** 行。` | `Read summary: 42 line(s).` | `Read **42** lines.` |
| Glob | `文件搜索摘要：3 个文件。` | `找到 **3** 个文件。` | `File search summary: 3 file(s).` | `Found **3** files.` |
| Bash | `Bash 已结束：退出码 0。` | （移除） | `Bash finished: exit code 0.` | （移除） |

### 12A-2. Bash 摘要行移除

- `formatPrimaryToolLead` 对 Bash 返回空字符串
- `formatToolOutput` 跳过空 lead（不产生空白首行）
- exit code 仍由 `formatBashEndSummary` 在输出尾部显示（`"命令已退出 0"`）

### 12A-3. 数字加粗

- 所有数字用 markdown `**N**` 包裹，供 `MessageMarkdown` bold 渲染

## CCB 源码比对

| 维度 | CCB | Linghun |
|------|-----|---------|
| Grep 格式 | `"Found {N} lines"` | `"Found **{N}** matches."` |
| Read 格式 | `"Read {N} lines"` | `"Read **{N}** lines."` |
| Glob 格式 | `"Found {N} files"` | `"Found **{N}** files."` |
| Bash 摘要 | 无独立摘要行 | 已移除，仅尾部 `Command exited {code}` |
| 数字加粗 | `<Text bold>` | `**N**` → MessageMarkdown bold |

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `tool-output-presenter.ts` | `formatPrimaryToolLead`: 4 工具格式变更；移除 `exitCode` 变量；`formatToolOutput`: 空 lead 跳过 |

## 关键设计

1. **Bash 双行问题：** 以前 Bash 既有 lead 行 (`Bash 已结束：退出码 0`) 又有 tail 行 (`命令已退出 0`)，信息重复。移除 lead 后仅保留 tail。
2. **空 lead 处理：** `formatToolOutput` 改为 `lead ? [lead] : []`，避免 Bash 出现空白首行。
3. **数字加粗：** `**N**` 标记由 `MessageMarkdown` 的 bold regex 匹配渲染，无需额外组件改动。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

- `tool-output-presenter.test.ts`: 33/33 pass — 覆盖 Grep/Read/Glob/Bash/WebSearch/WebFetch/MCP 所有格式分支
- biome check clean

## 已知问题

- 无。

## 不在本阶段处理的内容

- 单复数自动处理（固定用复数 `matches`/`files`/`lines`）
- `Bash` 退出码非零时的视觉差异化

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §12 |
| 本阶段参考的 CCB 文件 | `SearchResultSummary` + `FileReadTool/UI.tsx` — 通过计划文档转述 |
| 行为参考 | CCB `"Found N lines"` + bold 数字 + 动词先行 |
| 自研实现 | Linghun 中英双语 `**N**` markdown + Bash 空 lead 处理 |
| 未复制可疑源码 | 仅参考输出格式字符串模式 |

## 成品级结构化 Handoff Packet

```json
{
  "phase": 12,
  "status": "DONE",
  "next_phase": "complete",
  "forbidden": [
    "singular/plural auto-detection (use fixed plural forms)",
    "Bash non-zero exit code visual differentiation"
  ],
  "evidence": ["33/33 tool-output-presenter tests", "biome clean"],
  "index_state": "not checked (1 file, target edit)",
  "permission_mode": "auto",
  "model": "claude-opus-4-6",
  "budget": "N/A"
}
```
