# Visual Alignment Phase 01 — 视觉去卡片化 + 全量显示

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

消除 Linghun 的"边框卡片感"，输出默认全量显示，接近 CCB 的扁平流式视觉。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `MessageResponse.tsx` 的 `⎿ ` prefix + dimColor + flexRow 输出前缀模式；CCB 仅 PermissionDialog 使用 `borderStyle="round"` |
| 自研行为 | Panel 组件边框替换为 dim `─` 分隔线（Linghun 自研 Panel 层架构） |
| 新增模块 | `MessageResponse.tsx` — 对齐 CCB MessageResponse 输出前缀组件 |

## 已完成功能

### 1A. 去边框

- **ProductBlock.tsx:220** — `emphasized` 条件从 `isAlert && !compact` 改为 `block.kind === "permission" && !compact`，仅 permission 块保留边框
- **ProductBlock.tsx:236-270** — `tool_result_error` 移除 `borderStyle="single"` 卡片化，改用 `MessageResponse`（`⎿ ` prefix + error color）
- **Composer.tsx:1467-1469** — 移除 `borderStyle="round"` 和 `borderColor`，输入区无边框
- **CommandPanel.tsx:85-91** — 移除 `borderStyle="single"`，改为 dim `─` 分隔线
- **HelpPanel.tsx:70-75** — 同上
- **ConfigPanel.tsx:59-63 (panel_list)** — 同上
- **ConfigPanel.tsx:91-96 (panel_detail)** — 同上
- **SessionsPanel.tsx:87-91** — 同上

### 1B. 去折叠

- **tool-output-presenter.ts:18** — `BASH_TAIL_LINE_LIMIT` 从 `3` 改为 `0`（不截断非折叠输出尾部）
- **tool-output-presenter.ts:559-560** — 折叠阈值大幅提高：
  - 行数阈值：`3` → `100`
  - 文本长度阈值：`200` → `10000`
- **tool-output-presenter.ts:604** — `formatBashTail` 在 LIMIT=0 时返回空数组（不生成独立尾部标题）
- **tool-output-presenter.ts:567-571** — Bash 非折叠路径显示完整文本而非仅 stats 行

### 1C. MessageResponse 组件

- **新建 `packages/tui/src/shell/components/MessageResponse.tsx`**
  - `⎿ ` prefix + dimColor
  - flexRow 布局（prefix + children）
  - 用于 `tool_result_success`、`diagnostic`、`local_command_output`、`tool_result_error`

- **ProductBlock.tsx** 集成：
  - `isMessageKind` 分支：`tool_result_success` 和 `diagnostic` 现在也使用 `MessageResponse`（之前仅 `local_command_output` 有 `⎿ ` prefix）
  - `tool_result_error` 分支：移除边框卡片，改用 `MessageResponse`

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/shell/components/MessageResponse.tsx` | 新建 |
| `packages/tui/src/shell/components/ProductBlock.tsx` | 边框策略 + MessageResponse 集成 |
| `packages/tui/src/shell/components/Composer.tsx` | 移除 round 边框 |
| `packages/tui/src/shell/components/CommandPanel.tsx` | 移除 single 边框 |
| `packages/tui/src/shell/components/HelpPanel.tsx` | 移除 single 边框 |
| `packages/tui/src/shell/components/ConfigPanel.tsx` | 移除 single 边框（×2） |
| `packages/tui/src/shell/components/SessionsPanel.tsx` | 移除 single 边框 |
| `packages/tui/src/tool-output-presenter.ts` | 折叠阈值 + BashTail 逻辑 |
| `packages/tui/src/tool-output-presenter.test.ts` | 测试阈值更新 |
| `packages/tui/src/shell/models/tui-interaction-contract.test.ts` | 测试阈值更新 |
| `packages/tui/src/shell/view-model.test.ts` | 边框断言更新 |
| `packages/tui/src/index.test.ts` | 集成测试断言更新（BashTail=0） |

## 关键设计

1. **边框分层：** permission 块保留 `borderStyle="single"` + `theme.permission` 配色，与 CCB PermissionDialog 行为对齐。其他 alert 类型（error/fail/blocked）仅通过状态颜色区分，不加边框。

2. **折叠阈值：** `>100 行` 或 `>10000 字符` 才触发 Ctrl+O 折叠提示。Bash Tail 不再独立截断（LIMIT=0），非折叠 Bash 输出显示完整文本。

3. **MessageResponse：** 独立组件封装 `⎿ ` prefix 模式，供 product block 和 error block 复用。

## 配置项

无新增配置。

## 命令

无新增命令。

## 测试与验证

- `vitest run packages/tui/` 全量通过（2967 测试，87 文件）
- 4 个既有测试因阈值/边框变更更新预期值
- 1 个预存 model routing flaky test 非本次引入（`index.test.ts:9497`）

## 已知问题

无。本阶段为纯视觉层改动，不影响功能逻辑。

## 不在本阶段处理的内容

- 进度反馈专业化（阶段 2）
- Agent Tree 布局对齐（阶段 3）
- Modal/Panel 全屏覆盖（阶段 4）
- 配色体系对齐（阶段 11）

## 下一阶段衔接

按 `VISUAL_ALIGNMENT_PLAN.md` 顺序，下一阶段为阶段 11（配色体系对齐），或按用户选择跳转到阶段 2。

## 参考核对

- 本阶段参考了 CCB `MessageResponse.tsx:14-31`、`PermissionDialog.tsx:31`、`PlanApprovalMessage.tsx`、`BashToolResultMessage.tsx:92-119`、`OutputLine.tsx:75-84` 的行为描述（已记录在 `VISUAL_ALIGNMENT_PLAN.md` 中）
- Linghun 文档读取：`VISUAL_ALIGNMENT_PLAN.md`
- 未复制 CCB 源码实现；`MessageResponse.tsx` 为 Linghun 自研（基于 CCB 视觉行为参考）

## 开发者排查入口

- 折叠策略：`packages/tui/src/tool-output-presenter.ts` `hasHiddenContent` + `BASH_TAIL_LINE_LIMIT` + `formatBashTail`
- 边框策略：`packages/tui/src/shell/components/ProductBlock.tsx` `emphasized` 变量
- 输出前缀：`packages/tui/src/shell/components/MessageResponse.tsx`

---

## Handoff Packet

```yaml
phase: "visual-alignment-01"
status: DONE
next_phase: "visual-alignment-11"  # 按 VISUAL_ALIGNMENT_PLAN.md 顺序
forbidden:
  - "不得恢复边框到 Composer/Panel/tool_result_error"
  - "不得降低折叠阈值回 <100 行"
  - "不得在非 permission 块新增边框"
evidence:
  - "vitest: packages/tui 全量 PASS"
  - "biome check: 无新增 lint error"
  - "tsc: 无新增 type error（既有 providers .d.ts 缺失与本次无关）"
index_status: "N/A（本阶段不涉及索引改动）"
permission_mode: "N/A"
model: "claude-opus-4-6"
budget: "N/A"
```
