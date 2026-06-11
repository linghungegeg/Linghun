# 哲学模块升级 & 人格连续性 — 完整实现规格

## 前置约束

- 改动范围限于 `packages/tui/src/`
- `evaluateMetaScheduler()` 函数本身不改——它已经是纯函数，决策逻辑成熟
- 不做跨包提取（`packages/scheduler/` 等），当前阶段只闭合回路
- 不改动类型定义的结构，只在调用方补齐消费路径
- 每个改动点有独立的测试覆盖

---

## 任务一：哲学模块升级（闭合决策→执行回路）

### 目标

让 MetaScheduler 的 6 个布尔闸门和关键 PolicyDecision 字段从"模型参考文本"升级为"系统强制执行路径"。

### 1.1 将调度决策持久化到 TuiContext

**文件**：`tui-context-runtime.ts`

在 `TuiContext` 类型中，在 `lastMetaSchedulerFailureLearningFulfilled` 字段下方新增：

```typescript
/** 最近一轮 MetaScheduler 完整决策，供主链各子系统消费 */
lastMetaSchedulerDecision?: MetaSchedulerDecision;
```

导入 `MetaSchedulerDecision` 类型（type-only import）。

### 1.2 在 model-stream-runtime 存储并消费决策

**文件**：`model-stream-runtime.ts`

**1.2a** 在 `evaluateMetaScheduler` 调用后（约 line 508），新增一行：

```typescript
context.lastMetaSchedulerDecision = metaSchedulerDecision;
```

**1.2b 闸门一：shouldCompactBeforeProvider**

在 `prepareMessagesForProviderPreflight` 调用前（约 line 579），增加条件判断：

```typescript
// 当前代码：preflight 无条件执行
// 改为：
if (metaSchedulerDecision.shouldCompactBeforeProvider) {
  // 已有逻辑：preflight.blocked 时 return
}
// 如果 shouldCompactBeforeProvider 为 false，跳过 preflight
```

即：当前 compact 每次必跑。升级后，调度器说"不需要压缩"时跳过 preflight，节省一轮 I/O。

**1.2c 闸门二：shouldStopForBlockedRuntime**

在 `evaluateMetaScheduler` 返回后、system prompt 构建前（约 line 508-517 区间），增加：

```typescript
if (metaSchedulerDecision.shouldStopForBlockedRuntime) {
  writeLine(output, context.language === "en-US"
    ? "Blocked workflows/agents detected. Resolve them first, then retry."
    : "检测到阻塞的 workflow/agent，请先处理后再继续。");
  writeStatus(output, context);
  // 写入系统事件
  await appendSystemEvent(context, sessionId,
    "meta_scheduler:blocked_runtime_stop", "warning");
  return; // 阻断本轮模型调用
}
```

**1.2d 闸门三：shouldUseRetryGuard**

在 `model-tool-runtime.ts` 的工具执行路径中（工具失败后的重试逻辑处），检查 `context.lastMetaSchedulerDecision?.shouldUseRetryGuard`：

- 为 true 时：工具失败后最多重试 1 次，第二次仍失败则立即降级（不继续尝试更多工具）
- 为 false/undefined 时：保持现有重试逻辑

**1.2e 闸门四：shouldRunFinalAnswerGate**

在 `final-answer-gate.ts` 的 `runArchitectureAndCompletenessFinalGate` 被调用处（`model-stream-runtime.ts` 约 line 868），增加前置条件：

```typescript
// 当前：gate 无条件运行
// 改为：
if (metaSchedulerDecision.shouldRunFinalAnswerGate || finalAnswerClaimRetried) {
  // 运行 gate
}
```

调度器说"不需要闸门"时跳过，减少误触发。

**1.2f 闸门五：shouldPreferVerifier**

验证运行器调用前（`model-stream-runtime.ts` 中触发验证处），检查此标志：

- 为 true 且当前 assistant text 含完成声明 → 自动触发 focused verification（不等待用户手动 `/verify`）
- 为 false → 保持当前行为（等待用户主动触发）

### 1.3 权限引擎消费调度决策

**文件**：`permission-policy-engine.ts`

在权限判定入口函数中，检查 `context.lastMetaSchedulerDecision`：

- `permissionPlan.requireExplicitGate === true` → 权限引擎预加热，对当前轮的首次写入操作提高确认级别
- `expectedMutating === true` 且 `permissionMode === "auto"` → 提示用户"本轮预计有写入操作"

### 1.4 验证运行器消费调度决策

**文件**：`verification-level.ts`

在 `classifyVerificationLevel` 或等效入口处：

- 读取 `context.lastMetaSchedulerDecision?.policyDecision.verificationRoute`
- 按 `verificationRoute.domain` 选择验证命令集（而非一刀切）
- 当 `verificationRoute.conservativeNoPass === true` 时，验证结果不允许 PASS

### 1.5 展开策略提示

**文件**：`model-stream-runtime.ts`

修改 `shouldSurfacePolicyHint` 函数（约 line 1183），从仅放行 2 种改为放行以下：

```
保留：provider-cooldown, blocked-runtime
新增：verification-required, windows-safe, permission-risk,
      compact-before-provider, provider-fallback, source-first,
      failure-learning, architecture-guard
```

`user-state-*` 系列提示继续保留在优先队列但不直接展示（避免用户疲劳）。

### 1.6 测试要求

- `meta-scheduler-runtime.test.ts`：现有测试保持通过
- 新增：每个闸门的消费路径在 `index.test.ts` 中至少 1 个集成测试
- 新增：`context.lastMetaSchedulerDecision` 的读写测试

### 1.7 完成标准

- [ ] 6 个闸门全部有代码路径强制执行（不再仅文本注入）
- [ ] 权限引擎、验证运行器读取调度决策
- [ ] `shouldSurfacePolicyHint` 放行 ≥8 种提示
- [ ] 现有 50+ 调度器测试全部通过
- [ ] 无新增 typecheck 错误
- [ ] `formatMetaSchedulerDirective` 仍然注入 system prompt（双保险：系统执行 + 模型知晓）

---

## 任务二：人格连续性（跨轮状态追踪）

### 目标

给调度器增加跨轮状态输入，让 `UserStateDecision` 不再每轮从零评估，而是携带历史趋势。

### 2.1 新建 turn-continuity-runtime.ts

**文件**：`packages/tui/src/turn-continuity-runtime.ts`（新建，约 200 行）

导出以下类型和函数：

```typescript
export type TurnContinuityState = {
  /** 连续失败计数（工具失败、provider 失败、验证失败） */
  consecutiveFailures: number;
  /** 连续成功计数（无失败、无降级、验证通过） */
  consecutiveSuccesses: number;
  /** 当前任务域标签（从最近 N 轮的 taskKind 推断） */
  dominantTaskKind: PolicyDecision["taskKind"] | null;
  /** 任务域是否刚发生切换 */
  taskDomainSwitched: boolean;
  /** 上一轮的用户状态 */
  lastUserStateKind: UserStateKind;
  /** 用户状态持续轮数（同一种状态连续出现多少轮） */
  userStatePersistence: number;
  /** 当前会话的总轮数 */
  totalTurns: number;
  /** 用户消息平均长度趋势（缩短中 = 疲劳/信任下降，增长中 = 探索/深入） */
  messageLengthTrend: "shortening" | "stable" | "lengthening";
  /** 信任分数（0-100，从成功/失败/验证通过/用户纠正等事件累积） */
  trustScore: number;
};

export function createInitialContinuityState(): TurnContinuityState;

export function updateTurnContinuity(
  prev: TurnContinuityState,
  currentInput: {
    taskKind: PolicyDecision["taskKind"];
    userStateKind: UserStateKind;
    hadToolFailure: boolean;
    hadProviderFailure: boolean;
    hadVerificationFailure: boolean;
    lastVerificationStatus?: string;
    userText: string;
    userCorrectedAssistant: boolean; // 用户是否纠正了助手的输出
  },
): TurnContinuityState;
```

`updateTurnContinuity` 核心逻辑：

1. **consecutiveFailures**：`hadToolFailure || hadProviderFailure || hadVerificationFailure` → +1；否则归零
2. **consecutiveSuccesses**：无失败且验证通过 → +1；有失败 → 归零
3. **dominantTaskKind**：最近 5 轮中出现最多的 taskKind；过去数据存数组
4. **taskDomainSwitched**：当前 taskKind !== dominantTaskKind（从上一轮的 dominant 判断）
5. **userStatePersistence**：当前 userStateKind === 上一轮 → +1；否则归 1
6. **messageLengthTrend**：最近 5 条用户消息长度做简单线性趋势
7. **trustScore**：初始 50；每次成功 +1（上限 100）；工具失败 -3，provider 失败 -5，用户纠正 -8，验证通过 +2

### 2.2 在 TuiContext 中新增字段

**文件**：`tui-context-runtime.ts`

在 `lastMetaSchedulerFailureLearningFulfilled` 下方新增：

```typescript
/** 跨轮人格连续性状态 */
turnContinuity?: TurnContinuityState;
/** 最近 N 轮的 taskKind 历史（用于 dominantTaskKind 计算） */
recentTaskKinds?: PolicyDecision["taskKind"][];
/** 用户状态 suppression 的结束时间戳（ms） */
userStateDismissedUntilMs?: number;
/** 用户状态 cooldown 的结束时间戳（ms） */
userStateCooldownUntilMs?: number;
```

导入 `TurnContinuityState` 和 `PolicyDecision` 类型。

### 2.3 初始化连续性状态

**文件**：TUI 启动时初始化 TuiContext 的位置（`tui-context-runtime.ts` 的 `createTuiContext` 或等效工厂函数）

```typescript
context.turnContinuity = createInitialContinuityState();
context.recentTaskKinds = [];
```

### 2.4 每轮更新连续性状态

**文件**：`model-stream-runtime.ts`

在 `evaluateMetaScheduler` 调用之前（约 line 494 之前），调用：

```typescript
if (context.turnContinuity) {
  context.turnContinuity = updateTurnContinuity(
    context.turnContinuity,
    {
      taskKind: /* 本轮分类结果——需要先跑一次轻量分类，或使用上轮结果 */,
      userStateKind: /* 从 user-state-signal 获取 */,
      hadToolFailure: Boolean(context.lastToolFailure),
      hadProviderFailure: Boolean(context.lastProviderFailure),
      hadVerificationFailure: context.lastVerification?.status === "failed",
      lastVerificationStatus: context.lastVerification?.status,
      userText: text,
      userCorrectedAssistant: /* 从上下文检测用户纠正信号 */,
    },
  );
}
```

注意：这里存在一个循环依赖——连续性状态需要在调度器之前更新，但 `taskKind` 和 `userStateKind` 是调度器的输出。解决方案：

- 使用**上一轮**的调度决策来更新连续性状态（上轮决策存储在 `context.lastMetaSchedulerDecision`）
- 第一轮使用默认值（neutral, chat）

### 2.5 将连续性信号传入调度器

**文件**：`model-stream-runtime.ts` 的 `createMetaSchedulerInput` 函数

在返回对象中新增以下字段：

```typescript
userStateDismissedUntilMs: context.userStateDismissedUntilMs,
userStateCooldownUntilMs: context.userStateCooldownUntilMs,
userStatePolicyEnabled: true, // 默认启用，可通过 /mode 关闭
// 以下为新增输入信号，需先在 MetaSchedulerInput 类型中添加
consecutiveFailures: context.turnContinuity?.consecutiveFailures ?? 0,
consecutiveSuccesses: context.turnContinuity?.consecutiveSuccesses ?? 0,
taskDomainSwitched: context.turnContinuity?.taskDomainSwitched ?? false,
userStatePersistence: context.turnContinuity?.userStatePersistence ?? 1,
trustScore: context.turnContinuity?.trustScore ?? 50,
totalTurns: context.turnContinuity?.totalTurns ?? 0,
```

### 2.6 扩展 MetaSchedulerInput 类型

**文件**：`meta-scheduler-runtime.ts`

在 `MetaSchedulerInput` 类型中新增可选字段：

```typescript
consecutiveFailures?: number;
consecutiveSuccesses?: number;
taskDomainSwitched?: boolean;
userStatePersistence?: number;
trustScore?: number;
totalTurns?: number;
```

### 2.7 在调度器中使用连续性信号

**文件**：`meta-scheduler-runtime.ts` 的 `evaluateMetaScheduler` 函数

以下位置利用新信号增强决策：

- **trustScore < 30** → 自动提升为 `trust_repair` 交互模式（源码优先、解释优先、拒绝空口 PASS）
- **consecutiveFailures >= 2** → `shouldUseRetryGuard = true`（已在闸门中实现，此处增强触发条件）
- **consecutiveSuccesses >= 5 且 trustScore > 70** → 降级验证要求（从 full → focused），减少不必要的闸门
- **taskDomainSwitched === true** → 降低上一域的失败学习权重，`contextPlan.includeFailureLearning = false`
- **userStatePersistence >= 5 且同一状态** → 抑制重复提示，设置 `userStateCooldownUntilMs = Date.now() + 300000`（5 分钟冷却）
- **totalTurns > 30** → 自动启用 compact 倾向

### 2.8 提供关闭入口

用户可通过对话自然语言关闭（"不要检测我的状态"/"关闭状态感知"），设置 `context.userStatePolicyEnabled = false`。此时 `user-state-signal-runtime.ts` 已有的 `policyEnabled` 检查自动生效（line 68），返回 suppressed neutral。

### 2.9 测试要求

- `turn-continuity-runtime.test.ts`（新建）：测试以下场景
  - `createInitialContinuityState` 初始值正确
  - 连续失败计数递增和归零
  - 连续成功计数递增和归零
  - 任务域切换检测
  - trustScore 上下界和增减规则
  - 用户纠正大幅降分
  - 消息长度趋势计算
- `meta-scheduler-runtime.test.ts`：新增测试验证连续性字段影响调度决策
- `index.test.ts`：至少 2 个集成测试验证跨轮状态流转

### 2.10 完成标准

- [ ] `turn-continuity-runtime.ts` 文件存在，所有导出函数有测试
- [ ] `TuiContext` 新增 4 个字段
- [ ] `MetaSchedulerInput` 新增 6 个字段
- [ ] `createMetaSchedulerInput` 传递连续性信号
- [ ] `evaluateMetaScheduler` 消费连续性信号影响决策
- [ ] `userStateDismissedUntilMs` / `userStateCooldownUntilMs` 不再为 null
- [ ] 用户可关闭状态感知
- [ ] 现有测试全部通过
- [ ] 无新增 typecheck 错误

---

## 两个任务之间的关系

- **哲学模块升级**不依赖人格连续性：可以先做
- **人格连续性**依赖哲学模块的 step 1.1（`context.lastMetaSchedulerDecision`）：做连续性时，上轮决策已有存储位置
- 建议顺序：先哲学模块，后人格连续性

## 不做的事

- 不改 `evaluateMetaScheduler` 的纯函数签名
- 不改 `formatMetaSchedulerDirective` 的输出格式
- 不提取调度器到独立包
- 不碰 capability mock（`mock.canvas.create` 等）
- 不碰 Natural Command Bridge
- 不新增 slash command
- 不修改 provider/config/core 包
