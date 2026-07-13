# Phase 6 Fix Summary

## 问题描述

原commit 831f3613存在以下问题：
1. 问题类型分析了模型回答claim而非原始userText
2. historical QA中的completion claim仍需evidence gate
3. 新增了evidenceIsFromCurrentRequestOwner，应复用现有函数
4. "任意两种verification即completion"过度放宽
5. classifier用脆弱关键词正则

## 实现方案

### 1. 删除question-type-classifier
- 未创建question-type-classifier.ts文件（原worktree中不存在）
- 不使用关键词正则分析问题类型

### 2. 使用请求元数据判断问题类型
- 使用 `context.lastMetaSchedulerDecision?.policyDecision.taskKind`
- `taskKind === "chat"` 或 `taskKind === "code_fact"` 判定为历史/通用QA
- 不分析模型回答文本来判断问题类型

### 3. 历史/通用QA的处理
- 历史/通用QA不要求工程验证（不触发verification）
- **但**回答中的completion claim仍需evidence gate
- 通过`looksLikeFinalClosureStatement()`检测是否为闭合声明

### 4. 复用现有函数
- 复用 `evidenceMatchesRequestOwner` (packages/tui/src/evidence-runtime.ts:163)
- 复用 `verificationEvidenceMatchesContext` (packages/tui/src/model-stream-runtime.ts:1085)
- 未新增重复功能函数

### 5. 严格completion条件
- 任务完成必须匹配：目标 + 执行/改动evidence + 验证scope
- 未放宽"任意两种verification即completion"
- 保持原有严格的completion_claim要求

## 改动文件

### packages/tui/src/final-answer-gate.ts
```typescript
export function checkClaimSupport(claim: string, context: TuiContext): ClaimCheck {
  // Phase 6: Check request metadata to determine if this is a historical/general QA request.
  // Historical questions and general Q&A about past state don't need engineering verification.
  // BUT completion claims in the answer text still need evidence gate regardless of question type.
  const taskKind = context.lastMetaSchedulerDecision?.policyDecision.taskKind;
  const isHistoricalOrGeneralQA = taskKind === "chat" || taskKind === "code_fact";

  // ... existing headless diagnostics check ...

  if (structuredClaims.length === 0) {
    // Phase 6: Skip NL claim detection for historical/general QA unless there's a closure statement.
    if (!isHistoricalOrGeneralQA || looksLikeFinalClosureStatement(claim)) {
      const nlCheck = detectNaturalLanguageHighRiskClaims(claim);
      if (nlCheck.status !== "passed") {
        return nlCheck;
      }
    }
    return { status: "passed", unsupportedClaims: [] };
  }
  // ... rest of function unchanged ...
}
```

### packages/tui/src/model-loop-runtime.test.ts
新增测试：
- historical QA (chat taskKind) passes without verification if no completion claim
- general QA (code_fact taskKind) passes without verification if no completion claim
- historical QA with completion claim in answer still requires evidence gate
- completion claim requires matching goal + execution evidence + verification scope
- directive input does not change historical QA classification

## 验证结果

### 测试
```
✓ packages/tui/src/model-loop-runtime.test.ts (182 tests) 99ms
  Test Files  1 passed (1)
  Tests  182 passed (182)
```

所有测试通过，包括新增的5个Phase 6测试。

### Typecheck
修改的文件无新增类型错误（现有类型错误为依赖缺失，与本次改动无关）。

## 关键设计决策

1. **不分析模型回答文本**：使用请求阶段的policyDecision.taskKind，而非分析回答内容
2. **completion claim仍需gate**：即使是历史问答，回答中的completion claim也必须有evidence支持
3. **复用现有函数**：未引入新的owner匹配逻辑，使用已有的evidenceMatchesRequestOwner
4. **保守的completion条件**：未放宽completion要求，保持原有严格标准
5. **无classifier**：不使用关键词正则，避免脆弱的模式匹配

## 未提交

改动已完成并验证，但按用户要求未提交到git。
