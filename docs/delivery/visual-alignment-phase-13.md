# Visual Alignment Phase 13 — 代码块渲染对齐（行号 Gutter）

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

代码块从 box-drawing 边框风格改为行号 gutter 风格，对齐 CCB `HighlightedCode.tsx` 的 Gutter 范式。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `HighlightedCode.tsx` 行号 gutter + NoSelect 保护；无 box-drawing 边框 |
| 自研行为 | Linghun 保留 `cli-highlight` 着色 + `CodeLine` 组件；行号右对齐 gutter；移除 `codePrefix` |
| 新增模块 | 无新文件 |

## 已完成功能

### 13A. 行号 Gutter 替换 Box-Drawing 边框

**Before（Linghun 旧样式）：**
```
  ┌ javascript
  | const x = 1;
  | const y = 2;
  └
```

**After（CCB 对齐样式）：**
```
  javascript
 1 │ const x = 1;
 2 │ const y = 2;
```

### 改动项

1. **`renderCodeBlock` 函数：** 移除 `┌ lang` / `└` box-drawing 行；改为 `  lang` 标签行 + `{num} │ ` gutter 前缀
2. **`renderSelectablePlainMarkdown` 内联代码路径：** 移除 `codePrefix` 调用；改为 `{num} │ ` gutter + `codeLineNum` 行内计数
3. **`codePrefix` 函数：** 已移除（仅剩 dead code，无外部引用）
4. **`wrapWidth` 调整：** gutter 宽度从固定 `5` 改为动态 `gutterWidth + 4`

### CCB 源码比对

| 维度 | CCB `HighlightedCode.tsx` | Linghun 实现 | 对齐 |
|------|--------------------------|-------------|------|
| 边框字符 | 无（无边框） | 无（已移除 ┌ │ └） | ✓ |
| 行号 gutter | `ColorFile.render()` 输出 ANSI（`{spaces}{num} {code}`） | `{pad(num)} │ {code}` Ink Text | ✓ (等效) |
| gutter 宽度 | `lineCount.toString().length + 2`（fullscreen 模式） | `String(lineCount).length` + `" │ "` 前缀 | ✓ |
| NoSelect 保护 | `<NoSelect fromLeftEdge>` 包裹 gutter | Ink 无此能力（不适用） | N/A |
| 语法高亮 | `color-diff-napi`（ColorFile） | `cli-highlight`（getCachedHighlightedCodeLines） | Linghun 保留 |
| dim 模式 | `dim={boolean}` prop 传递到 ColorFile.render | `dimColor={dim}` 在 CodeLine + gutter 上 | ✓ |
| 语言标签 | 通过 `filePath` prop 推断 | 上方 dim 行 `{lang}` | ⚠ 等效 |
| 代码行前缀 | ColorFile 在 ANSI 中内嵌行号前缀 | `{num} │ ` 独立 Text 组件 | ✓ |
| diff +/- 颜色 | 无（依赖 ColorFile 输出） | `theme.success/error` 着色（保留） | ✓ |

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/shell/components/MessageMarkdown.tsx` | `renderCodeBlock` + `renderSelectablePlainMarkdown` 代码路径 gutter 化；移除 `codePrefix` 函数 |

## 关键设计

1. **行号右对齐：** `String(lineIndex + 1).padStart(gutterWidth, " ")`，gutterWidth = max line number 的字符宽度
2. **分隔符统一：** ` │ `（空格 + box-drawing 轻竖 + 空格），对齐 CCB 的 ` {num} {content}` 视觉间距
3. **双路径一致：** `renderCodeBlock`（单 fenced block）和 `renderSelectablePlainMarkdown`（多 block inline）使用相同的 gutter 风格
4. **wrapWidth 动态：** 代码行可用宽度从 `Math.max(8, wrapWidth - 5)` 改为 `Math.max(8, wrapWidth - gutterWidth - 4)`，随行号宽度自适应
5. **不引入 NoSelect：** Ink 无终端选择保护能力，不引入 CCB 的 `<NoSelect>` 组件
6. **不替换语法高亮引擎：** 保留 `cli-highlight`，不引入 `color-diff-napi`（原生依赖）

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

1. `linghun` task 模式 → 让模型输出含代码块（如 ` ```javascript ... ``` `）的回复
2. 确认代码块无 `┌` / `└` 边框字符
3. 确认每行有右对齐行号 + ` │ ` gutter（如 ` 1 │ `, ` 2 │ `, `10 │ `）
4. 确认 diff 模式（` ```diff `）的 `+` / `-` 颜色保留
5. 确认 dim 模式代码块整体淡化
6. 确认多代码块场景（两次 fenced block）行号分别从 1 计数

## 已知问题

- **Inline code path 行号未预计算：** `renderSelectablePlainMarkdown` 使用运行时 `codeLineNum++` 逐行递增，而非预先扫描代码块行数。这导致单行渲染时不知道总行数，gutterWidth 固定为 2（即 `<100` 行场景）。对于超长代码块（≥100 行），行号对齐可能不完美。
- **无 NoSelect 保护：** Ink 不支持 CCB 的 `<NoSelect>` 包裹 gutter 区域，全屏选择时行号会随代码一起被选中。

## 不在本阶段处理的内容

- `color-diff-napi` 原生模块迁移
- `<NoSelect>` 终端选择保护
- 代码块内 diff hunk header 着色（`@@` 行）
- 代码块折叠/展开

## 下一阶段衔接

Phase 18：Markdown 表格渲染对齐 — 表格列宽自适应 + 中文字符宽度处理。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §13 |
| 本阶段参考的 CCB 文件 | `HighlightedCode.tsx:1-129`（全文：ColorFile gutter + Ansi 渲染 + NoSelect 保护 + LRU 缓存 + dim 模式） |
| 行为参考 | CCB 无边框 + 行号 gutter + `ColorFile.render(theme, measuredWidth, dim)` 着色入口 |
| 自研实现 | `{num} │ ` gutter 组件渲染；cli-highlight 保留；双路径一致 gutter；codePrefix 移除 |
| 未复制可疑源码 | 仅参考 gutter 范式和无边框视觉；Linghun 自写所有实现 |

## 成品级结构化 Handoff Packet

```json
{
  "phase": 13,
  "status": "DONE",
  "next_phase": 18,
  "forbidden": [
    "color-diff-napi native module migration",
    "NoSelect terminal selection protection",
    "diff hunk header coloring",
    "code block folding"
  ],
  "evidence": ["593 shell tests pass"],
  "index_state": "not checked (1 file, direct edit)",
  "permission_mode": "auto",
  "model": "claude-opus-4-6",
  "budget": "~6s test duration"
}
```
