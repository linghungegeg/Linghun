# Visual Alignment Phase 10 — Context 可视化（/context 命令输出增强）

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

`/context`（等效 `/compact status`）输出从纯文本字段列表升级为含可视化条形图 + 优化建议。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `ContextVisualization.tsx` + `ContextSuggestions.tsx` token 分布条形图 + 优化建议 |
| 自研行为 | Linghun `formatCompactStatus` 内联条形图 + `buildCompactSuggestions` 建议函数；`formatContextProgressBar` 空字符替换 |
| 新增模块 | 无新文件 |

## 已完成功能

### 10A-1. Token 分布条形图

- `formatContextProgressBar`：空字符从 `░` 改为 `─`（对齐计划规格），宽度保持 10（status line）不变
- `formatCompactStatus` 调用 `formatContextProgressBar(ratio, 24)` 渲染 24 字符宽条：`[████████████████────────]`
- 追加 `  context [bar] usedTokens/maxTokens` 行

### 10A-2. Token 组成细分

- 若 `context.lastApiTokenCount` 有 `inputTokens` 数据，追加 `latest request` 行：
  - `  latest request  ████████████────────  input Nk (XX%) · output Mk (XX%)`
- 输入/输出比例用 `█`/`─` 分色条形图（20 字符宽）

### 10A-3. 优化建议

- `buildCompactSuggestions(context, usage, pressure)` 函数：
  - `ratio > 0.85`：⚠ 紧急建议运行 `/compact deep`
  - `ratio > 0.7`：提示接近上限
  - `ratio > 0.6` 且未压缩过：提示自动压缩阈值
- 仅在有 `contextUsage` 和 `pressure` 数据时输出

## CCB 源码比对

| 维度 | CCB ContextVisualization/ContextSuggestions | Linghun 实现 | 对齐 |
|------|-------------------------------------------|-------------|------|
| 条形图 | `█` 字符比例条 | `█` + `─` 24 字符宽条形图 | ✓ |
| 空字符 | `─`（推测） | `─` | ✓ |
| Token 组成细分 | input/output 分色 | `█`（input）+ `─`（output）20 字符宽 | ✓ (自研) |
| 优化建议 | 可节省 token 数、严重度图标 | 三级建议（85%/70%/60%）+ ⚠ 紧急标记 | ✓ (简化) |
| 展示位置 | context 面板 / tooltip | `/context` 命令文本输出 | ✓ (等效) |

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/context-window-runtime.ts` | `formatContextProgressBar` 空字符 `░` → `─` |
| `packages/tui/src/cache-command-runtime.ts` | `formatCompactStatus` 重构为 lines 数组 + 条形图 + token 细分 + 建议；新增 `buildCompactSuggestions` |

## 关键设计

1. **条形图宽度可配：** `formatContextProgressBar` 保持 `width` 参数；status line 用 8 字符不变；`formatCompactStatus` 用 24 字符
2. **Token 细分弹性数据源：** `context.lastApiTokenCount` 仅在 API 回报时非空；未回报时静默跳过
3. **建议不啰嗦：** 最多 2 条（ratio-based 1 条 + never-compacted 1 条），避免轰炸用户
4. **不影响 status line：** `formatContextProgressBar` 仍为 `[██────]` 格式，空字符替换为 `─` 视觉一致

## 配置项

无新增配置项。

## 命令

| 命令 | 效果 |
|------|------|
| `/context` | 显示含条形图 + 建议的完整状态 |
| `/compact status` | 同上（同一 handler） |

## 测试与验证

### 自动化测试

- `context-window-runtime.test.ts`：不检查 bar 字符内容（仅测 ratio/label），`░` → `─` 不影响
- `index.test.ts:3140`：`formatCompactStatus` 仅测 redaction（secrets 替换为 `***`），格式改动不影响
- `biome check`：clean

### 手动验证路径

1. 启动 `linghun`，运行多轮对话产生上下文
2. 执行 `/context`：
   - 看到 `[████████████████────────]` 24 字符宽条形图
   - 若 `lastApiTokenCount` 存在，看到 `latest request` 输入/输出比例条
   - 若 ratio > 0.6，看到优化建议
3. 执行 `/compact status`：输出相同

### 预期输出样例

```
Context Compact status
- pressure: 62.3% (24500/40000 chars; trigger 32000)
- compacted: no · boundaries: 0
- latest: none
- latest tokens: -→-
- latest compact time: none
  context [███████████████─────────] 6125/32000
- deep scope: full transcript semantic compact
- projection scope: provider-visible recent context projection
...
提示：自动压缩约在 80% 触发。你也可以 /compact manual 对较早上下文做语义重写。
```

## 已知问题

- **无系统/消息/工具分类：** CCB 显示 system/messages/tools/cache 各分类占比；Linghun 当前仅展示整体上下文压力和 API token 的 input/output 细分
- **建议无 severity icon：** CCB 用不同 severity 图标区分严重度；Linghun 仅用 `⚠` 前缀标记 >85% 紧急建议
- **条形图精度：** 24 字符宽时每格 ≈4.2%，<5% 差异不可见

## 不在本阶段处理的内容

- System/messages/tools/cache 分类占比条形图（需额外数据采集管线）
- 可节省 token 数的精确估算
- Severity 图标分层
- Ink 渲染的交互式 context 面板（当前 `/context` 仅文本输出）

## 下一阶段衔接

Phase 15：输入预处理器 — 自然语言边界封闭，系统提示泄漏防护。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §10 |
| 本阶段参考的 CCB 文件 | `ContextVisualization.tsx`（条形图范式）；`ContextSuggestions.tsx`（优化建议范式） — 通过计划文档转述 |
| 行为参考 | CCB token 分布条形图 + 上下文优化建议 |
| 自研实现 | Linghun `formatContextProgressBar` 空字符替换 + `formatCompactStatus` 内联可视化 + `buildCompactSuggestions` |
| 未复制可疑源码 | 仅参考条形图和建议的视觉范式；Linghun 自写所有实现 |

## 成品级结构化 Handoff Packet

```json
{
  "phase": 10,
  "status": "DONE",
  "next_phase": 15,
  "forbidden": [
    "system/messages/tools/cache category breakdown bars",
    "exact token savings estimation",
    "severity icon hierarchy",
    "interactive Ink context panel"
  ],
  "evidence": ["biome check clean", "formatContextProgressBar tests pass (bar char not asserted)", "formatCompactStatus redaction tests pass"],
  "index_state": "not checked (2 files, direct edits)",
  "permission_mode": "auto",
  "model": "claude-opus-4-6",
  "budget": "N/A"
}
```
