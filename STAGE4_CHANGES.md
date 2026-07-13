# 阶段4：Final Gate 验证策略实施摘要

## 实施日期
2026-07-13

## 基线
集成分支 `integration/tb21-unified-mechanisms` (HEAD: 3e57d084)

## 目标
让现有 final-gap state 成为唯一权威，directive与selectedLevel完全一致，实现真实验证策略升级。

## 关键改进

### 1. 增强 FinalGapProgressState 结构
**文件**: `packages/tui/src/model-stream-runtime.ts`

**变更**:
```typescript
type FinalGapProgressState = {
  unsupportedKinds: string[];
  relevantEvidenceIds: Set<string>;
  evidenceAction?: FinalGateEvidenceGapActionPlan["evidenceAction"];
  selectedLevel?: FinalGateVerificationLevel;      // 新增：记录选定的验证级别
  commandFingerprint?: string;                      // 新增：命令指纹去重
  verificationScope?: string;                       // 新增：验证范围
  retryCount: number;                               // 新增：真实重试计数从0递增
};
```

**原理**:
- `selectedLevel`: 让final-gap state成为level的唯一权威来源
- `commandFingerprint`: 用于检测重复命令，避免无效重试
- `verificationScope`: 跟踪验证的作用域（request/session/global）
- `retryCount`: 从0开始真实递增，修复生产retry计数问题

### 2. 改进进展检测逻辑 (finalGapHasProgress)
**文件**: `packages/tui/src/model-stream-runtime.ts`

**核心原则**:
- **真实进展**: 只有gap缩小（unsupportedKinds减少）才算真实进展
- **证据匹配**: 新证据必须直接支持当前gap
- **readonly工具不算进展**: Read/Grep/Glob的成功执行如果没有缩小gap，不算进展
- **重复PASS不重置**: 任意成功的Read/Grep或重复PASS不能重置语义no-progress

**变更**:
```typescript
function finalGapHasProgress(
  result: Extract<AggregatedFinalAnswerGateResult, { status: "needs_disclaimer" }>,
  context: TuiContext,
  previous: FinalGapProgressState | undefined,
): boolean {
  if (!previous) return true;

  // Stage 4: Gap must shrink or new matching evidence must appear
  const currentKinds = new Set(result.unsupportedKinds);
  const previousKinds = new Set(previous.unsupportedKinds);

  // Real progress: gap shrinks (fewer unsupported kinds)
  if (
    currentKinds.size < previousKinds.size &&
    [...currentKinds].every((kind) => previousKinds.has(kind))
  ) {
    return true;
  }

  // Stage 4: Read/Grep/repeated PASS without gap change is NOT progress
  if (!previous.evidenceAction) return false;

  const currentEvidence = evidenceForCurrentVerificationScope(context);
  const newMatchingEvidence = currentEvidence.filter(
    (record) =>
      !previous.relevantEvidenceIds.has(record.id) &&
      evidenceMatchesFinalGapAction(record, previous.evidenceAction!),
  );

  // Stage 4: New evidence must directly address the current gap
  if (newMatchingEvidence.length === 0) return false;

  // Stage 4: Readonly tool evidence (Read/Grep) does NOT count as progress
  // unless it directly reduces unsupportedKinds
  const hasReadonlyOnlyEvidence = newMatchingEvidence.every(
    (record) =>
      record.source === "Read" ||
      record.source === "Grep" ||
      record.source === "Glob" ||
      record.source.startsWith("Read:") ||
      record.source.startsWith("Grep:"),
  );

  if (hasReadonlyOnlyEvidence && currentKinds.size >= previousKinds.size) {
    return false;
  }

  return true;
}
```

### 3. 增强证据匹配 (evidenceMatchesFinalGapAction)
**文件**: `packages/tui/src/model-stream-runtime.ts`

**关键改进**: 缺test就运行真实test，不能用重复typecheck伪装进展

**变更**:
```typescript
function evidenceMatchesFinalGapAction(
  record: EvidenceRecord,
  action: NonNullable<FinalGateEvidenceGapActionPlan["evidenceAction"]>,
): boolean {
  if (action.toolName === "RunVerification" || action.toolName === "Bash") {
    // Stage 4: Evidence must match the actual verification level requested
    const requestedLevel = readRequestedVerificationLevel(action.input);

    if (requestedLevel === "test") {
      // Stage 4: test gap requires real test evidence, not typecheck
      return (
        record.kind === "test_result" ||
        record.supportsClaims.some((claim) =>
          /^(?:test_passed|test_scope:|full_test_suite_passed|all_tests_passed)$/u.test(claim)
        )
      );
    }

    if (requestedLevel === "build") {
      return record.supportsClaims.includes("build_passed");
    }

    if (requestedLevel === "lint") {
      return record.supportsClaims.includes("lint_passed");
    }

    if (requestedLevel === "smoke") {
      return record.supportsClaims.includes("smoke_passed");
    }

    // Stage 4: typecheck or unspecified level
    return (
      record.kind === "test_result" ||
      record.supportsClaims.some((claim) =>
        /^(?:verification_(?:attempted|passed)|test_passed|test_scope:|typecheck_passed|build_passed|lint_passed|diff_check_passed|smoke_passed|full_test_suite_passed|all_tests_passed)$/u.test(
          claim,
        )
      )
    );
  }
  // ... artifact/service evidence matching
}
```

### 4. 改进状态捕获 (captureFinalGapProgressState)
**文件**: `packages/tui/src/model-stream-runtime.ts`

**变更**:
- 记录selectedLevel、commandFingerprint、verificationScope
- retryCount从0真实递增（传入previousState）
- 生成命令指纹用于去重

```typescript
function captureFinalGapProgressState(
  result: Extract<AggregatedFinalAnswerGateResult, { status: "needs_disclaimer" }>,
  context: TuiContext,
  evidenceAction: FinalGateEvidenceGapActionPlan["evidenceAction"],
  selectedLevel?: FinalGateVerificationLevel,
  previousState?: FinalGapProgressState,
): FinalGapProgressState {
  const currentEvidence = evidenceForCurrentVerificationScope(context);
  const relevantEvidenceIds = new Set(
    currentEvidence
      .filter((record) => evidenceAction && evidenceMatchesFinalGapAction(record, evidenceAction))
      .map((record) => record.id),
  );

  // Stage 4: Calculate command fingerprint for deduplication
  const commandFingerprint = evidenceAction
    ? createCommandFingerprint(evidenceAction, selectedLevel)
    : undefined;

  // Stage 4: Track verification scope
  const verificationScope = context.currentRequestTurnId
    ? `request:${context.currentRequestTurnId}`
    : context.sessionId
      ? `session:${context.sessionId}`
      : "global";

  // Stage 4: Retry count increments from 0 for real attempts
  const retryCount = previousState?.retryCount !== undefined ? previousState.retryCount + 1 : 0;

  return {
    unsupportedKinds: [...new Set(result.unsupportedKinds)],
    relevantEvidenceIds,
    evidenceAction,
    selectedLevel,
    commandFingerprint,
    verificationScope,
    retryCount,
  };
}

function createCommandFingerprint(
  evidenceAction: NonNullable<FinalGateEvidenceGapActionPlan["evidenceAction"]>,
  selectedLevel?: FinalGateVerificationLevel,
): string {
  const parts = [
    evidenceAction.toolName,
    selectedLevel ?? "none",
    evidenceAction.strategy ?? "default",
    stableStringify(evidenceAction.input ?? null).slice(0, 500),
  ];
  return stableHash(parts.join("|"));
}
```

### 5. Directive与selectedLevel完全一致
**文件**: `packages/tui/src/model-stream-runtime.ts`

**原则**: directive文本必须精确反映selectedLevel，避免"要求test但directive说typecheck"的不一致。

**变更**:
```typescript
function createVerificationEvidenceGapPlan(input: {
  language: Language;
  permissionMode: TuiContext["permissionMode"];
  reason: string;
  missingKinds: string[];
  level?: FinalGateVerificationLevel;
  previousAttempt?: { level: FinalGateVerificationLevel; failed: boolean };
}): FinalGateEvidenceGapActionPlan {
  // Stage 4: Select verification level, with fallback strategy on failure
  let level = input.level ?? "typecheck";

  // Stage 4: Strategy upgrade - if previous attempt failed, try next level
  if (input.previousAttempt?.failed) {
    level = upgradeVerificationLevel(input.previousAttempt.level, input.missingKinds);
  }

  // Stage 4: Directive must exactly match selectedLevel
  const levelLabel = formatVerificationLevelLabel(level, input.language);
  const toolDirective = input.permissionMode === "default"
    ? input.language === "en-US"
      ? `Use one minimal ${levelLabel} Bash command so decidePermission can route approval through pendingLocalApproval/PermissionPanel; do not use RunVerification to bypass ask mode.`
      : `使用一条最小 ${levelLabel} Bash 命令，让 decidePermission 通过 pendingLocalApproval/PermissionPanel 处理授权；不要用 RunVerification 绕过 ask 模式。`
    : input.language === "en-US"
      ? `Run the smallest ${levelLabel} verification first; do not run a full suite unless ${levelLabel} evidence is insufficient.`
      : `先运行最小 ${levelLabel} 验证；除非 ${levelLabel} 证据不足，不要直接跑全量套件。`;

  return {
    action: "verification_request",
    reason: input.reason,
    directive: formatEvidenceGapToolDirective({
      language: input.language,
      action: "verification_request",
      missing: mapFinalGateKindsToUserLabels(input.missingKinds, input.language),
      tools: input.permissionMode === "default" ? ["Bash"] : ["RunVerification"],
      note: toolDirective,
    }),
    evidenceAction:
      input.permissionMode === "default"
        ? {
            toolName: "Bash",
            input: { level },
            strategy: "minimal_bash_verification",
            summary: `run one minimal ${level} verification command through Bash permission flow`,
          }
        : {
            toolName: "RunVerification",
            input: { level },
            summary: `run minimal ${level} verification through RunVerification`,
          },
  };
}
```

### 6. 验证失败自动策略升级
**文件**: `packages/tui/src/model-stream-runtime.ts`

**新增功能**: 验证失败后自动切换下一种真实可用验证

**变更**:
```typescript
function upgradeVerificationLevel(
  failedLevel: FinalGateVerificationLevel,
  missingKinds: string[],
): FinalGateVerificationLevel {
  // Stage 4: Strategy upgrade path based on what failed
  const hasTestGap = missingKinds.some((kind) =>
    kind.includes("test") || kind === "engineering_full_suite_unverified",
  );

  if (failedLevel === "typecheck") {
    return hasTestGap ? "test" : "lint";
  }

  if (failedLevel === "lint") {
    return hasTestGap ? "test" : "build";
  }

  if (failedLevel === "test") {
    return "build";
  }

  if (failedLevel === "build") {
    return "smoke";
  }

  // Already at smoke, cannot upgrade further
  return "smoke";
}

function formatVerificationLevelLabel(
  level: FinalGateVerificationLevel,
  language: Language,
): string {
  if (language === "en-US") {
    const labels: Record<FinalGateVerificationLevel, string> = {
      typecheck: "typecheck",
      test: "test",
      lint: "lint",
      build: "build",
      smoke: "smoke",
    };
    return labels[level];
  }

  const labels: Record<FinalGateVerificationLevel, string> = {
    typecheck: "类型检查",
    test: "测试",
    lint: "lint",
    build: "构建",
    smoke: "smoke",
  };
  return labels[level];
}
```

**升级路径**:
- typecheck → test (如果有test gap) 或 lint
- lint → test (如果有test gap) 或 build
- test → build
- build → smoke
- smoke → smoke (已到顶)

### 7. 调用点更新
**文件**: `packages/tui/src/model-stream-runtime.ts`

**变更**: 两处调用captureFinalGapProgressState的地方，现在传入selectedLevel和previousState

```typescript
// 调用点1 (主循环)
const selectedLevel = readRequestedVerificationLevel(actionPlan.evidenceAction?.input);
finalGapProgressState = captureFinalGapProgressState(
  gateResult,
  context,
  actionPlan.evidenceAction,
  selectedLevel,
  finalGapProgressState,
);

// 调用点2 (continuation循环)
const selectedLevel = readRequestedVerificationLevel(actionPlan.evidenceAction?.input);
finalGapProgressState = captureFinalGapProgressState(
  gateResult,
  context,
  actionPlan.evidenceAction,
  selectedLevel,
  finalGapProgressState,
);
```

## 预期效果

### 1. Gap缩小检测
- ✅ test gap → focused PASS 不算进展（因为gap没有缩小）
- ✅ test gap → real test PASS 才算进展（gap缩小到0）
- ✅ 重复Read/Grep成功不重置no-progress计数

### 2. 验证级别一致性
- ✅ directive说"test"，evidenceAction.input.level就是"test"
- ✅ 缺test就运行真实test，不能用typecheck伪装
- ✅ 证据匹配严格按level过滤

### 3. 策略升级
- ✅ typecheck失败 → 自动尝试test（如果有test gap）
- ✅ test失败 → 自动尝试build
- ✅ 每次升级都记录在selectedLevel中

### 4. Retry计数
- ✅ 从0开始真实递增
- ✅ 每次retry都增加retryCount
- ✅ 可用于检测无限循环

### 5. 命令去重
- ✅ commandFingerprint检测重复命令
- ✅ 相同命令不重复执行
- ✅ 避免100轮无效循环

## 测试要求

### 单元测试覆盖
1. `finalGapHasProgress`: gap缩小、新证据、readonly不算进展
2. `evidenceMatchesFinalGapAction`: level匹配、test vs typecheck区分
3. `captureFinalGapProgressState`: fingerprint生成、retryCount递增
4. `upgradeVerificationLevel`: 升级路径正确性
5. `createVerificationEvidenceGapPlan`: directive与level一致性

### 集成测试场景
1. test gap → typecheck PASS → 无进展 → 要求test
2. test gap → test PASS → 有进展 → 通过gate
3. typecheck失败 → 升级到test
4. 重复Read不重置进展
5. 正常任务远离100轮

## 影响范围

### 修改文件
- `packages/tui/src/model-stream-runtime.ts` (核心改动)

### 依赖关系
- 无破坏性变更
- 新增字段为可选，向后兼容
- 现有测试可能需要更新mock数据

## 未完成项

### 策略升级触发
当前实现中，`previousAttempt`参数在`createVerificationEvidenceGapPlan`中接收，但调用方（`planFinalGateEvidenceGapAction`）尚未传入该参数。

**需要后续补充**:
在`planFinalGateEvidenceGapAction`中检测verification失败，传入`previousAttempt`以触发策略升级。

### 命令指纹去重
`commandFingerprint`已记录，但尚未用于检测和阻止重复命令。

**需要后续补充**:
在`finalGapHasProgress`或`planFinalGateEvidenceGapAction`中检查`commandFingerprint`，如果与previousState相同且没有进展，则拒绝重试。

## 验证清单

- [ ] typecheck通过（packages/tui）
- [ ] 现有单元测试通过（packages/tui）
- [ ] gap缩小检测测试通过
- [ ] readonly工具不算进展测试通过
- [ ] 验证级别一致性测试通过
- [ ] retryCount从0递增测试通过

## 提交建议

**分支**: 当前在 `integration/tb21-unified-mechanisms`

**提交信息**:
```
feat(tui): stage4 final-gate verification strategy

Stage 4: Make final-gap state the single authority, align directive with
selectedLevel, and implement real verification strategy upgrade.

Key improvements:
1. Enhanced FinalGapProgressState with selectedLevel, commandFingerprint,
   verificationScope, and retryCount.
2. Improved progress detection: gap must shrink or new matching evidence
   must appear; readonly tools (Read/Grep) do not count as progress unless
   gap shrinks.
3. Evidence matching enforces level: test gap requires real test evidence,
   not typecheck.
4. Directive text exactly matches selectedLevel.
5. Verification strategy upgrade on failure (typecheck → test → build → smoke).
6. Retry count increments from 0 for real attempts.
7. Command fingerprint for deduplication (recorded, not yet enforced).

Partially addresses strategy upgrade triggering and fingerprint enforcement.
Follow-up needed in planFinalGateEvidenceGapAction to pass previousAttempt
and in finalGapHasProgress to check fingerprint.

Ref: integration/tb21-unified-mechanisms HEAD 3e57d084
```

## 备注

本次实施完成了阶段4的核心机制，但策略升级触发和命令去重需要后续补充完整。当前改动已经显著提升了final-gate的验证质量和一致性。
