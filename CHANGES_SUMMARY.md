# 修复项10：Verification scope接线 - 改动摘要

## 改动范围
基于分支：`integration/tb21-unified-mechanisms` (HEAD: 1f2ac7ac)

## 问题诊断
1. `VerificationScope`的`originalTask`和`targetPackage`字段只是类型字段，未从真实调用点传入
2. 缺少从workflow goal、agent task、request metadata到verification scope的数据流
3. 这些字段应当用于选择和记录真实验证范围，而非仅作为类型占位

## 实现方案

### 1. 类型定义更新
**文件**: `packages/tui/src/tui-data-types.ts`

```typescript
export type VerificationScope = {
  ownerKey: string;
  cwd: string;
  changedFiles: string[];
  ownerSessionId: string;
  ownerAgentId?: string;
  workflowRunId?: string;
  requestTurnId?: string;
  level?: string;
  originalTask?: string;      // 新增：原始任务描述
  targetPackage?: string;      // 新增：目标包路径
};
```

### 2. 核心运行时更新
**文件**: `packages/tui/src/verification-command-runtime.ts`

- 在`runVerificationPlan`的options中添加`originalTask`和`targetPackage`参数
- 在构造`VerificationScope`时传递这两个字段

```typescript
const scope: VerificationScope = {
  ownerKey,
  cwd,
  changedFiles: [...(options.changedFiles ?? [])],
  ownerSessionId,
  ...(options.ownerAgentId ? { ownerAgentId: options.ownerAgentId } : {}),
  ...(options.workflowRunId ? { workflowRunId: options.workflowRunId } : {}),
  ...(options.requestTurnId ? { requestTurnId: options.requestTurnId } : {}),
  ...(options.level ? { level: options.level } : {}),
  ...(options.originalTask ? { originalTask: options.originalTask } : {}),
  ...(options.targetPackage ? { targetPackage: options.targetPackage } : {}),
};
```

### 3. Workflow集成
**文件**: `packages/tui/src/workflow-command-runtime.ts`

#### 3.1 runWorkflowVerificationStep函数
- 在options中添加`originalTask`和`targetPackage`参数
- 在构造`verificationScope`时传递这两个字段
- 在调用`runVerificationPlan`时传递这两个字段

#### 3.2 调用点更新
两处workflow verification调用点（registry workflow step和bridged workflow request）：
```typescript
// 调用点1: executeRegistryWorkflowStep
const report = await runWorkflowVerificationStep(step.level ?? "focused", context, output, {
  // ... 其他参数
  originalTask: goal,  // 从workflow goal传入
  targetPackage: run?.cwd ? relative(context.projectPath, run.cwd) || undefined : undefined,
});

// 调用点2: executeWorkflowBridgeRequest
const report = await runWorkflowVerificationStep(req.level, context, output, {
  // ... 其他参数
  originalTask: run?.goal,  // 从workflow run state传入
  targetPackage: run?.cwd ? relative(context.projectPath, run.cwd) || undefined : undefined,
});
```

### 4. Agent集成
**文件**: `packages/tui/src/job-agent-command-runtime.ts`

在verifier agent的verification调用中传递task和cwd：
```typescript
const report = await runVerificationPlan(plan, context, agent.transcriptSessionId, output, deps().appendBackgroundTaskEvent, {
  // ... 其他参数
  originalTask: agent.task,  // 从agent task传入
  targetPackage: verificationCwd !== context.projectPath
    ? relative(context.projectPath, verificationCwd) || undefined
    : undefined,
});
```

### 5. 测试覆盖
**新文件**: `packages/tui/src/verification-command-runtime-scope.test.ts`

添加4个测试用例：
1. `passes originalTask and targetPackage from runVerificationPlan options to scope` - 验证直接传递
2. `passes originalTask from workflow goal to verification scope` - 验证workflow集成
3. `derives targetPackage from verification cwd when different from project root` - 验证package路径推导
4. `omits originalTask and targetPackage from scope when not provided` - 验证可选性

## 数据流路径

### Workflow → Verification
```
WorkflowRunState.goal 
  → runWorkflowVerificationStep(options.originalTask)
  → runVerificationPlan(options.originalTask)
  → VerificationScope.originalTask

WorkflowRunState.cwd
  → relative(projectPath, cwd)
  → runWorkflowVerificationStep(options.targetPackage)
  → runVerificationPlan(options.targetPackage)
  → VerificationScope.targetPackage
```

### Agent → Verification
```
AgentRun.task
  → runVerificationPlan(options.originalTask)
  → VerificationScope.originalTask

AgentRun.cwd (via verificationCwd)
  → relative(projectPath, verificationCwd)
  → runVerificationPlan(options.targetPackage)
  → VerificationScope.targetPackage
```

### Slash/Request → Verification
由各调用点通过`context.currentRequestTurnId`等metadata传入，当前未实现（未来可扩展）。

## 验证清单
- [x] 类型定义添加originalTask和targetPackage
- [x] runVerificationPlan接受并传递这两个字段
- [x] workflow两处调用点传递goal和package
- [x] agent verifier调用点传递task和package
- [x] 添加测试覆盖scope传播
- [ ] typecheck通过（需要pnpm install后验证）
- [ ] 测试通过（需要pnpm test后验证）

## 未改动范围
- 未新增package resolver（按要求）
- 未扩展slash command的scope传递（当前slash由用户手动触发，task描述不明确）
- 未修改synthetic smoke判定逻辑（synthetic字段已存在于VerificationStep，不在scope中）

## 后续建议
1. 从slash command调用中提取用户输入作为originalTask
2. 在model-tool-runtime的verification调用中传递当前request的metadata
3. 在verification report格式化中展示originalTask和targetPackage
