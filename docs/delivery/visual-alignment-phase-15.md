# Visual Alignment Phase 15 — 错误恢复/重试 UI

> **日期：** 2026-06-11
> **状态：** DONE
> **基线：** CCB = `F:\ccb-source`，Linghun = `F:\Linghun`

## 阶段目标

API 错误/工具失败时在 tool_result_error 块中显示倒计时重试提示。

## 行为边界

| 类别 | 说明 |
|------|------|
| 参考行为 | CCB `SystemAPIErrorMessage.tsx` 倒计时 + 尝试 N/M + 前 3 次降噪 |
| 自研行为 | Linghun `ProductBlockViewModel` 新增 `retrySeconds`/`retryAttempt`/`retryMax`；`writeErrorLine` 从 `context.retryInfo` 读取并填充；ProductBlock + plain-renderer 渲染 |
| 新增模块 | 无新文件 |

## 已完成功能

### 15A-1. ProductBlockViewModel 扩展

- 新增 `retrySeconds?: number` — 重试倒计时（秒）
- 新增 `retryAttempt?: number` — 当前重试次数（从 1 起）
- 新增 `retryMax?: number` — 最大重试次数

### 15A-2. retryInfo 类型化

- `TuiContext` 新增 `retryInfo?: { attempt: number; max: number; delaySec: number }`
- `index.ts` 注册 `registerProviderHooks.onRetry` 直接写入 `context.retryInfo`（移除旧 cast）

### 15A-3. writeErrorLine 自动填充

- 创建 tool_result_error block 时从 `context.retryInfo` 读取并填充 retry 字段

### 15A-4. Ink 渲染（ProductBlock.tsx）

- `tool_result_error` 分支增加 retry hint：
  - 仅当 `retrySeconds > 0` 且 `retryAttempt >= 4` 时显示（CCB 前 3 次降噪）
  - zh-CN：`正在重试 {N}s 后… (第 {n}/{m} 次)`
  - en-US：`Retrying in {N}s… (attempt {n}/{m})`
  - dimColor 渲染，不抢错误正文权重

### 15A-5. Plain 渲染（plain-renderer.ts）

- `tool_result_error` 分支同 Ink 逻辑：前 3 次降噪，dim 显示

## CCB 源码比对

| 维度 | CCB `SystemAPIErrorMessage.tsx` | Linghun 实现 | 对齐 |
|------|----------------------------------|-------------|------|
| 倒计时格式 | `"Retrying in 12 seconds… (attempt 3/5)"` | `"Retrying in 12s… (attempt 3/5)"` | ✓ (等效) |
| 前 N 次降噪 | 前 3 次隐藏（`retryAttempt < 4`） | `retryAttempt >= 4` 才显示 | ✓ |
| 渲染 | dim + 独立行 | dimColor + 独立 Text | ✓ |
| 倒计时源 | `useInterval` 实时递减 | `context.retryInfo.delaySec` 快照（创建时值） | ⚠ Linghun 不做实时 tick |

## 涉及模块

| 文件 | 改动性质 |
|------|---------|
| `packages/tui/src/tui-context-runtime.ts` | `TuiContext` 新增 `retryInfo` 字段 |
| `packages/tui/src/index.ts` | `registerProviderHooks.onRetry` 移除 cast，直接用 `context.retryInfo` |
| `packages/tui/src/shell/types.ts` | `ProductBlockViewModel` 新增 `retrySeconds`/`retryAttempt`/`retryMax` |
| `packages/tui/src/tui-output-surface.ts` | `writeErrorLine` 填充 retry 字段 |
| `packages/tui/src/shell/components/ProductBlock.tsx` | `tool_result_error` 分支增加 retry hint |
| `packages/tui/src/shell/plain-renderer.ts` | `tool_result_error` 分支增加 retry hint |

## 关键设计

1. **快照而非实时：** `retrySeconds` 是创建 block 时的快照值，不实时递减。Linghun 不使用 CCB 的 `useInterval` 模式，避免 Ink 重渲染开销。
2. **前 3 次降噪：** `retryAttempt >= 4` 才显示，对齐 CCB `retryAttempt < 4 隐藏`。快速重试（<4 次）用户无需感知。
3. **解耦 retryInfo：** 从旧 cast 改为 `TuiContext.retryInfo` 字段，类型安全，多处复用。
4. **仅 tool_result_error 路径：** retry info 仅通过 `writeErrorLine` 填充，不影响其他 block 创建路径。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

### 自动化测试

- `index.test.ts:25541` `writeErrorLine` 测试：验证 `messageKind: "tool_result_error"` 且 `status: "fail"`。新增 retry 字段不影响已有断言。
- `index.test.ts:25557` `formatError catch` 测试：同上。
- `view-model.test.ts:5350` `ShellBlockOutput.writeErrorLine` 测试：验证 tool_result_error block。retry 字段不影响。

### 手动验证路径

1. 启动 `linghun`，触发 provider API 失败（如错误 endpoint）
2. 观察 tool_result_error block 是否出现重试倒计时提示（第 4 次起）
3. 前 3 次重试 block 应无 retry hint

## 已知问题

- **快照倒计时不实时递减：** `retrySeconds` 是创建时的快照，不每秒更新。视觉上不如 CCB 的 `useInterval` 动态倒计时生动。
- **retryAttempt 归零时机：** 成功后 `retryInfo` 不清除，可能在下一次非重试错误中误显示。需在请求成功时清理（不在本阶段范围）。
- **仅 provider retry 触发：** `retryInfo` 仅由 `registerProviderHooks.onRetry` 设置；工具层面的重试（如 Bash 重试）不走此路径。

## 不在本阶段处理的内容

- 实时递减倒计时（`useInterval` / 定时器刷新）
- 成功请求后 `retryInfo` 清理
- 工具级重试（Bash、Write 等）的 retry 提示
- CtrlOToExpand 对 retry hint 的交互

## 下一阶段衔接

Phase 6：消息结果摘要格式统一 — 工具输出摘要展示格式对齐 CCB。

## 参考核对

| 参考项 | 详情 |
|--------|------|
| 本阶段读取的 Linghun 文档 | `VISUAL_ALIGNMENT_PLAN.md` §15 |
| 本阶段参考的 CCB 文件 | `SystemAPIErrorMessage.tsx`（倒计时格式 + 前 3 次降噪策略）— 通过计划文档转述 |
| 行为参考 | CCB `"Retrying in N seconds… (attempt n/m)"` + `retryAttempt < 4 隐藏` 降噪 |
| 自研实现 | Linghun 快照式 retry 字段 + `writeErrorLine` 自动填充 + ProductBlock/plain 双路径渲染 |
| 未复制可疑源码 | 仅参考格式文本和降噪阈值；Linghun 自写所有实现 |

## 成品级结构化 Handoff Packet

```json
{
  "phase": 15,
  "status": "DONE",
  "next_phase": 6,
  "forbidden": [
    "real-time countdown decrement (useInterval)",
    "retryInfo cleanup on success",
    "tool-level retry hints (Bash, Write, etc.)",
    "CtrlOToExpand on retry hint"
  ],
  "evidence": ["biome check clean", "existing writeErrorLine tests unaffected", "retryInfo type-safe (no cast)"],
  "index_state": "not checked (6 files, direct edits)",
  "permission_mode": "auto",
  "model": "claude-opus-4-6",
  "budget": "N/A"
}
```
