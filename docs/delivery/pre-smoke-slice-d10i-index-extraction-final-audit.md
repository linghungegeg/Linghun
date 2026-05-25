# Slice D.10I — Index Extraction Final Audit + Long-Term Maintenance Rule

## git status --short 真实输出

```
M packages/tui/src/index.ts
?? docs/delivery/pre-smoke-slice-d10d-index-extraction-final-audit.md
?? docs/delivery/pre-smoke-slice-d10e-model-setup-provider-doctor-extraction.md
?? packages/tui/src/model-doctor-runtime.test.ts
?? packages/tui/src/model-doctor-runtime.ts
?? packages/tui/src/model-loop-runtime.test.ts
?? packages/tui/src/model-loop-runtime.ts
?? packages/tui/src/model-setup-runtime.test.ts
?? packages/tui/src/model-setup-runtime.ts
```

## 实际读取文件列表

- `packages/tui/src/index.ts`（多段读取，确认 imports、re-exports、剩余职责）
- `packages/tui/src/startup-runtime.ts`（确认导出和依赖）
- `packages/tui/src/permission-continuation-runtime.ts`（确认导出和依赖）
- `packages/tui/src/model-loop-runtime.ts`（确认导出和依赖）
- `packages/tui/src/model-setup-runtime.ts`（确认导出和依赖）
- `packages/tui/src/model-doctor-runtime.ts`（确认导出和依赖）
- `packages/tui/src/context-estimator.ts`（确认导出和依赖）
- `packages/tui/src/cache-freshness.ts`（确认导出和依赖）
- `packages/tui/src/slash-dispatch.ts`（确认导出和依赖）
- `packages/tui/src/job-runtime.ts`（确认导出和依赖）
- `packages/tui/src/runner-runtime.ts`（确认导出和依赖）
- `packages/tui/src/tool-output-presenter.ts`（确认导出和依赖）
- 所有 11 个测试文件（通过运行验证）

## D.10A–H 搬迁模块总览

| 切片 | 模块文件 | 行数 | 职责 |
|------|---------|------|------|
| D.10A | `startup-runtime.ts` | 309 | IO helpers、TTY 检测、display utilities、error formatting、startup warning formatters |
| D.10B | `context-estimator.ts` | 63 | Token 估算 helpers |
| D.10B | `cache-freshness.ts` | 95 | 缓存新鲜度判断 helpers |
| D.10C | `slash-dispatch.ts` | 582 | Slash 命令解析与分发 helpers |
| D.10D | `job-runtime.ts` | 595 | Job/background task 纯 helpers |
| D.10D | `runner-runtime.ts` | 726 | Runner/execution 纯 helpers |
| D.10E | `model-setup-runtime.ts` | 236 | Model setup/provider 纯 helpers |
| D.10E | `model-doctor-runtime.ts` | 434 | Model doctor 诊断纯 helpers |
| D.10F | `tool-output-presenter.ts` | — | Tool output 格式化（D.10F 前已存在，D.10G 依赖） |
| D.10G | `permission-continuation-runtime.ts` | 416 | Permission decision helpers、report write guard、remote redaction、tool name normalization |
| D.10H | `model-loop-runtime.ts` | 442 | Tool definition helpers、drift summary、freshness helpers、natural file read helpers、solution completeness helpers |

**搬迁模块总行数：3,898 行**

## index.ts 剩余职责结论

index.ts（14,228 行）仍承担以下不可拆分的核心 orchestration 职责：

1. **TuiContext 状态机** — 全局状态定义、初始化、生命周期管理
2. **sendMessage 主函数** — 340 行 async 函数，深度依赖 gateway + context + store + AbortController
3. **Provider stream for-await 主循环** — 嵌套在 sendMessage 内，直接操作 output/toolCalls/assistantText
4. **Tool-call round loop** — executeModelToolUse / executeApprovedModelToolUse 执行链
5. **continueModelAfterToolResults** — 与 sendMessage 结构相同的续接函数
6. **streamFinalModelAnswerWithoutTools** — 依赖 gateway.stream + context.store
7. **buildModelMessagesWithRecentContext** — 依赖 context.store.resume
8. **createModelSystemPrompt** — 依赖 TuiContext 多字段读取
9. **Permission state machine entries** — 依赖 TuiContext 状态读写
10. **processTuiLine / handleSlashCommand** — 依赖 sendMessage + context
11. **Session persistence** — context.store 读写
12. **Gateway lifecycle** — provider 连接管理

这些函数/区域因深度耦合 TuiContext、gateway、store、AbortController 等有状态依赖，无法在不引入大量 callback/deps 注入的前提下安全拆分。

## 循环依赖检查结论

**确认：无循环依赖。**

所有搬迁模块的 import 方向：

```
startup-runtime.ts          → 无内部 TUI 依赖
context-estimator.ts        → 无内部 TUI 依赖
cache-freshness.ts          → 无内部 TUI 依赖
slash-dispatch.ts           → 无内部 TUI 依赖
job-runtime.ts              → 无内部 TUI 依赖
runner-runtime.ts           → 无内部 TUI 依赖
model-setup-runtime.ts      → 无内部 TUI 依赖
model-doctor-runtime.ts     → 无内部 TUI 依赖
tool-output-presenter.ts    → 无内部 TUI 依赖
permission-continuation-runtime.ts → startup-runtime.js, tool-output-presenter.js
model-loop-runtime.ts       → permission-continuation-runtime.js
```

没有任何搬迁模块 import `index.ts`。依赖图为 DAG，无环。

## 累计行数表

| 指标 | 值 |
|------|---|
| index.ts 原始行数（D.10 系列开始前） | ~15,094 行 |
| index.ts 当前行数（D.10H 后） | 14,228 行 |
| 净减少 | ~866 行 |
| 搬迁模块总行数 | 3,898 行 |
| 测试文件总数 | 11 个 |
| 测试文件总行数 | ~12,953 行 |
| 测试用例总数 | 708 个 |

## 验证命令和真实结果

```
$ corepack pnpm typecheck
> tsc -b tsconfig.json
（无错误输出，退出码 0）

$ corepack pnpm exec vitest run
Test Files  11 passed (11)
     Tests  708 passed (708)
  Duration  ~35s

$ corepack pnpm check
Checked 101 files in 335ms. No fixes applied.
Found 1 warning.
（warning 来自 model-doctor-runtime.test.ts 中已有的 biome-ignore 注释，非本次引入）

$ git diff --check
（无输出，无 whitespace 问题）
```

## Long-Term index.ts Maintenance Rule

### 规则正文

从 D.10I 起，对 `packages/tui/src/index.ts` 的后续开发遵守以下维护规则：

1. **新增纯 helper 函数禁止直接写入 index.ts。** 如果新函数满足以下全部条件，必须放入对应的 `-runtime.ts` 模块：
   - 不读写 `TuiContext` 状态
   - 不调用 `gateway.stream()` 或 `context.store` 方法
   - 不操作 `AbortController` 生命周期
   - 不依赖 `sendMessage` 或 `executeModelToolUse` 执行链
   - 输入/输出完全由参数和返回值决定

2. **模块归属判断：**
   - Permission/report guard 相关 → `permission-continuation-runtime.ts`
   - Tool definition/schema 相关 → `model-loop-runtime.ts`
   - Freshness/natural file read/solution completeness 相关 → `model-loop-runtime.ts`
   - Model setup/provider config 相关 → `model-setup-runtime.ts`
   - Model doctor/diagnostics 相关 → `model-doctor-runtime.ts`
   - Startup/IO/TTY/display 相关 → `startup-runtime.ts`
   - Slash command parsing 相关 → `slash-dispatch.ts`
   - Job/background task 相关 → `job-runtime.ts`
   - Runner/execution 相关 → `runner-runtime.ts`
   - Token estimation 相关 → `context-estimator.ts`
   - Cache freshness 相关 → `cache-freshness.ts`
   - 不属于以上任何类别的新纯 helper → 新建 `<domain>-runtime.ts`，遵循相同模式

3. **index.ts 只保留：**
   - TuiContext 定义和初始化
   - 有状态 orchestration 函数（sendMessage、provider loop、tool execution chain）
   - 依赖 TuiContext 突变的状态机逻辑
   - 模块间的 re-export（保持外部消费者兼容）

4. **新模块创建规则：**
   - 文件名格式：`<domain>-runtime.ts`
   - 必须配套 `<domain>-runtime.test.ts`
   - 不得 import `index.ts`（防止循环依赖）
   - 只能依赖 `@linghun/*` 包和其他 `-runtime.ts` 模块
   - 依赖方向必须保持 DAG

5. **搬迁触发条件：**
   - 当 index.ts 中某个纯 helper 被修改或新增时，reviewer 应检查是否应搬迁
   - 当 index.ts 行数超过 15,000 行时，必须优先搬迁新增纯 helper
   - 搬迁必须配套测试和 typecheck 验证

### 规则生效范围

本规则适用于 Linghun TUI 包（`packages/tui/src/`）的所有后续开发，直到架构发生根本性变更（如 index.ts 被拆分为多个有状态模块）。

## 已知残留

| 项目 | 状态 | 说明 |
|------|------|------|
| Biome warning | 已知 | `model-doctor-runtime.test.ts` 中 `biome-ignore` 注释触发，非本次引入 |
| 真实 TUI smoke | 未执行 | 所有切片为纯代码搬迁，未改变运行时行为 |
| sendMessage 拆分 | NOT_MOVED | 依赖 8+ 有状态组件，违反硬边界 |
| Windows Job Object | 未涉及 | 不在 D.10 系列范围内 |
| index.ts 仍 14,228 行 | 已知 | 剩余为不可安全拆分的有状态 orchestration |

## 下一阶段建议

1. **真实 TUI smoke 验证** — 在实际终端中启动 `linghun`，验证搬迁后的运行时行为无回归
2. **sendMessage 重构** — 如果未来需要拆分，建议引入 middleware/pipeline 模式而非简单函数提取
3. **index.ts 进一步瘦身** — 可考虑将 TuiContext 定义和初始化提取为 `tui-context.ts`，但需要仔细处理循环依赖
4. **模块边界文档化** — 考虑在 `packages/tui/src/` 下添加 `MODULES.md` 说明各模块职责

## 参考核对

- 本阶段实际读取了 `packages/tui/src/` 下所有搬迁模块和测试文件。
- 未参考外部 CCB / CCB Dev Boost / 社区项目文件。
- 本阶段为纯审计和规则制定，无外部行为参考。
- 明确说明未复制可疑源码实现。

## 未真实 smoke

本切片为审计和规则制定，未改变任何代码，未执行真实 TUI 启动 smoke。

## 未 Beta PASS / smoke-ready / open-source-ready
