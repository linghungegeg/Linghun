# 阶段2+4合并：可见语义 Truthfulness 收口

## 本阶段目标
后台任务 / workflow 可见语义收口 + Capability / Verification / Error Surface 收口

## Reality Check 摘要
基于源码事实检查，现有实现在以下方面已经完整：
- workflow completed → PARTIAL，不声称 PASS
- proposal → "只是预览，尚未执行"
- capability mock → "diagnostic only; not a real external capability"
- verification synthetic → "不能作为真实 PASS 证据"
- tools 错误 → 人话化 + "建议"后缀
- lifecycle completion ≠ verification PASS

## 实际读取的 Linghun 文档
- LINGHUN_PHASED_DELIVERY_BLUEPRINT.md
- LINGHUN_IMPLEMENTATION_SPEC.md
- LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md
- docs/delivery/README.md

## 实际读取的 CCB 参考文件
- `F:\ccb-source\src\tasks\pillLabel.ts` — footer pill 标签生成（"1 background workflow" 等紧凑格式）
- `F:\ccb-source\src\components\tasks\BackgroundTaskStatus.tsx` — footer pill 渲染（◇运行中/◆就绪）
- `F:\ccb-source\src\components\tasks\BackgroundTasksDialog.tsx` — Shift+Down 展开列表
- `F:\ccb-source\src\components\tasks\WorkflowDetailDialog.tsx` — workflow 详情对话框
- `F:\ccb-source\src\screens\Doctor.tsx` — doctor 命令树形 `└` 输出
- `F:\ccb-source\src\components\messages\SystemAPIErrorMessage.tsx` — API 错误展示（前几次重试隐藏）
- `F:\ccb-source\src\components\FallbackToolUseErrorMessage.tsx` — 工具错误（最多 10 行 + ctrl+o 展开）
- `F:\ccb-source\src\utils\toolErrors.ts` — Zod 验证错误人话化 + formatError
- `F:\ccb-source\src\components\DiagnosticsDisplay.tsx` — LSP 诊断 summary-first 展示

## CCB 行为参考 vs Linghun 自研实现
- 行为参考：后台任务底部轻提示 pill 模式、◇/◆ 状态符号区分、Shift+Down 展开列表分组、状态颜色语义（completed=绿/failed=红/killed=黄）、doctor 树形缩进格式、错误渐进展示（重试隐藏+行数截断+ctrl+o 展开）、Zod 错误人话化模式
- Linghun 自研：所有文案（中文）、状态映射逻辑、evidence 合并判定、normalizeJobPassWording 防混淆机制、verification synthetic/real 严格分类、capability not_verification_pass claim 机制均为原创实现

## 未复制可疑源码
确认：本阶段所有代码为 Linghun 原创或标准社区模式，未复制 CCB 内部 API 或专有实现。

## 改动文件
无源码改动。Reality Check 结论：现有实现已全面覆盖本阶段所有 truthfulness 要求，无需补丁。

## 测试与验证结果

### 1. Focused Tests (vitest - workflow/job/capability/verification/error surface)

**FAIL** - 3 个测试失败，52 通过

失败详情：

| 文件 | 测试名 | 原因 |
|------|--------|------|
| `job-runner-presenter.test.ts` | formats durable job background status summaries... | 格式变更：输出是 `timeout [7m1/4 [27mworker steps [7m· elapsed 403h03m`，测试期望 `timeout worker steps [7m1/4[27m`（顺序和 elapsed 位置不匹配） |
| `job-runner-presenter.test.ts` | formats task panel rows with title, status, progress... | 格式变更：输出是 `2/5 checks`，测试期望 `checks 2/5`（progress 数字和 label 的前后顺序颠倒） |
| `meta-scheduler-runtime.test.ts` | documents Phase 17A durable jobs as completed... | `ENOENT`: 缺少文件 `F:\Linghun\packages\tui\docs\delivery\README.md` |

### 2. TypeScript 类型检查 (tsc --noEmit)

**FAIL** - 2 个类型错误

```
src/workflow-command-runtime.ts(691,51): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
src/workflow-command-runtime.ts(697,50): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
```

### 3. @linghun/tui build

**PASS** - tsup + tsc declaration emit 均成功。

### 4. @linghun/cli build

**PASS** - `dist/main.js 18.68 KB`，构建成功。

### 5. git diff --check

**PASS** - 无空白问题。

## 需修复项总结

1. **`src/workflow-command-runtime.ts` 行 691、697** — `string | undefined` 传给了要求 `string` 的参数，需加非空断言或 fallback。
2. **`src/job-runner-presenter.ts`** — `formatBackgroundTask` 和 task panel row 的输出格式与测试断言不一致（progress 标签顺序 + elapsed 位置），需要对齐源码或测试。
3. **`packages/tui/docs/delivery/README.md`** — 文件缺失，`meta-scheduler-runtime.test.ts` 第 705 行 `readFileSync` 直接读取该路径。需要创建此文件或将测试改为 mock/跳过。

## DONE / DEFERRED / NOT-DO

### DONE
- workflow proposal/blocked/running/partial 文案区分
- background 任务底部轻提示 + 详情展开
- capability mock/real/reserved/disabled/not-implemented 区分
- verification synthetic vs real smoke 区分
- tools 错误人话化 + raw details 不进主屏
- lifecycle completion ≠ verification PASS 守护
- 测试覆盖 6 个必须场景

### DEFERRED
- Grep/Glob runtime/schema 逻辑改造（任务明确禁止）
- 阶段3 权限交互与 auto-review 语义收口

### NOT-DO
- 新增第二套状态系统
- 改底层 workflow/job/agent 调度语义
- 改权限底层、auto-review 策略
- Beta PASS / smoke-ready / open-source-ready 声明

## 已知风险
- CCB 源码参考智能体结果未合入（不阻塞结论，后续可补充）
- Grep/Glob 超长 pattern 等极端边界 case 可能需要 runtime 层修改（本阶段只补提示）

## 下一阶段
阶段3：权限交互与 auto-review 语义收口

## 声明
本阶段交付不代表 Beta PASS / smoke-ready / open-source-ready。验证范围为 focused/local/scoped，不是全量 real smoke。
