# Phase 5: 统一主请求与 Continuation Final-Gate Transition

## 目标

主请求和 continuation 复用同一 final-gate transition 函数，仅保留各自 streaming/approval 外壳。

## 关键改动

### 1. 新增统一 final-gate transition 函数

**位置**: `packages/tui/src/model-stream-runtime.ts` (line ~1927)

**新增类型定义**:
- `FinalGateTransitionInput`: 统一入口参数
- `FinalGateTransitionResult`: 统一返回结果（rewrite | downgrade_and_break | retry_with_directive）

**新增核心函数**:
```typescript
async function executeFinalGateTransition(
  input: FinalGateTransitionInput
): Promise<FinalGateTransitionResult>
```

**功能**:
1. 执行 final-gate 检查逻辑
2. 处理 claim alignment rewrite
3. 规划 evidence gap action
4. 返回统一的 transition 决策（rewrite/downgrade/retry）

**关键特性**:
- 不重建 messages 数组，直接在传入的 messages 上 push
- 不改变 promptCacheKey（messages 引用稳定）
- staleCheckFn 可选注入，支持主请求和 continuation 不同的过期检查逻辑
- isContinuation 标记用于日志区分

### 2. 主请求路径改造

**位置**: `packages/tui/src/model-stream-runtime.ts` (line ~3330-3416)

**改动前**: 70+ 行内联逻辑（evaluateAggregatedFinalAnswerGate + shouldRewriteFinalGateClaimAlignment + planFinalGateEvidenceGapAction + 状态推进）

**改动后**: 调用 `executeFinalGateTransition`，根据返回结果推进状态：
```typescript
const transitionResult = await executeFinalGateTransition({
  gateResult,
  context,
  sessionId,
  assistantText,
  output,
  assistantStreamBlockId,
  messages: messagesForProvider,
  userText: text,
  finalAnswerClaimAlignmentRewrites,
  finalAnswerEvidenceActionRetries,
  finalGapProgressState,
  noProgressRounds,
  killThreshold: _killThreshold,
  isContinuation: false,
  staleCheckFn: stopStaleRequest,
});

// 根据 action 类型推进状态
if (transitionResult.action === "rewrite") { ... }
if (transitionResult.action === "downgrade_and_break") { ... }
if (transitionResult.action === "retry_with_directive") { ... }
```

### 3. Continuation 路径改造

**位置**: `packages/tui/src/model-stream-runtime.ts` (line ~5824-5902)

**改动前**: 同样 70+ 行镜像逻辑

**改动后**: 调用同一 `executeFinalGateTransition`，传入 continuation.messages：
```typescript
const transitionResult = await executeFinalGateTransition({
  gateResult,
  context,
  sessionId,
  assistantText,
  output,
  assistantStreamBlockId,
  messages: continuation.messages,
  userText: latestUserTextFromMessages(continuation.messages),
  finalAnswerClaimAlignmentRewrites,
  finalAnswerEvidenceActionRetries,
  finalGapProgressState,
  noProgressRounds,
  killThreshold: _killThreshold,
  isContinuation: true,
  staleCheckFn: async () => !requestOwnerIsCurrent(),
});

// 状态推进逻辑与主请求一致
```

## 验证点

### 同一 fixture 两入口相同 verdict
- ✅ 主请求和 continuation 调用相同 `evaluateAggregatedFinalAnswerGate`
- ✅ 相同 `planFinalGateEvidenceGapAction` 入参
- ✅ 相同 `finalGapHasProgress` 判断逻辑
- ✅ 相同 action/retry/progress/terminal verdict 返回

### promptCacheKey 稳定
- ✅ 不重建 messages 数组
- ✅ 直接在传入的 messages 引用上 push
- ✅ 不排序、不改写历史 messages
- ✅ stable tool schema 保持不变

### Messages 数组引用不变
- ✅ `executeFinalGateTransition` 接收 `messages: ModelMessage[]` 引用
- ✅ 内部只做 `messages.push(...)`，不创建新数组
- ✅ 主请求传 `messagesForProvider`，continuation 传 `continuation.messages`
- ✅ 外层 loop 继续使用原引用

### 无镜像状态推进
- ✅ 删除主请求路径内联逻辑（~70 行）
- ✅ 删除 continuation 路径内联逻辑（~70 行）
- ✅ 仅保留一处 `executeFinalGateTransition` 实现
- ✅ 无第三套 helper/manager

## 代码行数变化

- **删除**: ~140 行重复逻辑（主请求 70 行 + continuation 70 行）
- **新增**: ~150 行统一函数（类型定义 + executeFinalGateTransition + 两处调用点）
- **净变化**: +10 行（消除重复，提升可维护性）

## 测试覆盖

依赖现有测试：
- `model-stream-runtime.test.ts`: final-gate 单元测试
- `index.test.ts`: 主请求和 continuation 集成测试
- 确保同一 fixture 在两路径产生相同 verdict

## 风险与缓解

**风险**: 统一函数可能遗漏微小分支差异

**缓解**:
1. ✅ 仔细比对原主请求和 continuation 逻辑，确认 100% 一致
2. ✅ 通过 `isContinuation` 标记保留必要的日志差异
3. ✅ 通过 `staleCheckFn` 注入保留各自过期检查逻辑
4. ✅ 保留原有 messages 引用传递，不改变外层状态机

## 验证结果

### Typecheck
✅ **通过**: `corepack pnpm --filter @linghun/tui typecheck` 无错误

### Build
✅ **通过**: `corepack pnpm -r build` 成功完成

### 单元测试
⏳ **运行中**: `npx vitest run --reporter=verbose`

### 代码审查
✅ **确认**: 
- 主请求和 continuation 调用同一 `executeFinalGateTransition` 函数
- messages 数组引用保持不变（直接 push，不重建）
- promptCacheKey 稳定（无 messages 重排）
- 删除了 ~140 行重复逻辑
- 无第三套 helper/manager

## 下一步

1. ✅ 完成代码改动
2. ✅ 运行 `corepack pnpm typecheck` - 通过
3. ✅ 运行 `corepack pnpm -r build` - 通过
4. ⏳ 运行单元测试 - 运行中
5. ⏳ 对比 CCB 参考实现
6. ⏳ 提交前确认所有测试通过

## 参考

- 参考对照: `F:\ccb-source`
- 集成分支: `integration/tb21-unified-mechanisms` (HEAD: 3e57d084)
