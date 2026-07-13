# 阶段8实现摘要：Verifier、Artifact 与 Windows Shell

**分支**: integration/tb21-unified-mechanisms  
**基础提交**: 3e57d084

## 实现目标

1. **Verifier使用原任务、changedFiles、cwd、package和真实验证目标**
2. **Artifact验证必须有初始快照、当前owner、freshness**
3. **Windows shell adapter明确处理host compound命令**

## 改动文件

### 1. 类型定义增强 (packages/tui/src/tui-data-types.ts)

**VerificationScope 新增字段**：
- `originalTask?: string` - 用户原始任务描述
- `targetPackage?: string` - 目标包路径

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
  originalTask?: string;      // 新增
  targetPackage?: string;     // 新增
};
```

### 2. Artifact验证增强 (packages/tui/src/artifact-evidence-runtime.ts)

**新增 freshness 验证**：
- 增加 `validateArtifactFreshness()` 函数
- `hasStructuredArtifactEvidence()` 和 `hasStructuredArtifactEvidenceForPath()` 支持可选的 freshness 验证
- 检查 owner (ownerSessionId/ownerAgentId)
- 检查时间戳 (createdAt vs maxAgeMs)

**关键规则**：
- `requireFresh: true` 时必须验证 owner 和 age
- 预存的非空文件如果不满足 freshness 条件会被拒绝
- 默认行为向后兼容（不传 options 时不检查 freshness）

**函数签名变更**：
```typescript
export function hasStructuredArtifactEvidence(
  evidence: Array<Pick<EvidenceRecord, "data" | "ownerScope" | "createdAt">>,
  targets: string[],
  options?: { requireFresh?: boolean; currentOwner?: string; maxAgeMs?: number },
): boolean

export function hasStructuredArtifactEvidenceForPath(
  evidence: Array<Pick<EvidenceRecord, "data" | "ownerScope" | "createdAt">>,
  path: string,
  options?: { requireFresh?: boolean; currentOwner?: string; maxAgeMs?: number },
): boolean
```

### 3. Verification Runtime 增强 (packages/tui/src/verification-command-runtime.ts)

**runVerificationPlan 新增参数**：
- `originalTask?: string` - 传递原始任务描述
- `targetPackage?: string` - 传递目标包路径

**Scope 构建**：
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

### 4. Windows Shell Adapter 增强 (packages/tools/src/index.ts)

**新增 compound 命令检测**：
- 在 `WINDOWS_SHELL_ADAPTER_REGISTRY` 最前面添加 `CompoundCommandAdapter`
- 新增 `detectHostCompoundCommand()` 函数检测 host-level 的 semicolon 分隔符
- 排除 PowerShell native 语法（显式 PowerShell 命令或 PowerShell script）

**适配规则**：
```typescript
{
  name: "CompoundCommandAdapter",
  adapt: (command) => {
    const hasCompound = detectHostCompoundCommand(command);
    if (!hasCompound) return undefined;
    return createBlockedPowerShellAdapter(
      "Host-level compound commands (cmd1; cmd2) on Windows require PowerShell syntax; use 'cmd1; cmd2' in PowerShell or chain with && for sequential execution.",
    );
  },
}
```

**detectHostCompoundCommand 逻辑**：
- 检测未引用的分号
- 排除显式 PowerShell 命令（`powershell.exe`, `pwsh.exe`）
- 排除 PowerShell script 语法（`$var =`, cmdlets, etc.）
- 使用 `scanShellCommand()` 扫描未引用的字符

### 5. 测试覆盖

**Artifact Freshness 测试** (packages/tui/src/artifact-evidence-runtime.test.ts):
- ✅ 接受无 freshness 要求的 artifact
- ✅ 拒绝 stale artifact (超过 maxAgeMs)
- ✅ 接受 fresh artifact (在 maxAgeMs 内)
- ✅ 拒绝错误 owner 的 artifact
- ✅ 接受当前 owner 的 artifact
- ✅ 多目标场景下的 freshness 验证

**Windows Compound 命令测试** (packages/tools/src/index.test.ts):
- ✅ 阻止 host-level compound 命令 (`echo hello; echo world`)
- ✅ 阻止 git compound 命令 (`git add .; git commit -m 'test'`)
- ✅ 允许 PowerShell native semicolons (`$x = 1; Write-Output $x`)
- ✅ 允许显式 PowerShell 命令中的 semicolons

## 验证结果

### Typecheck
```
✅ tsc -b tsconfig.json - 通过
```

### 单元测试
```
✅ packages/tui/src/artifact-evidence-runtime.test.ts
   - 9 个测试全部通过
   
✅ packages/tools/src/index.test.ts (compound 命令相关)
   - 相关测试全部通过
```

### 完整测试套件
运行中（后台任务 ID: bvphkhvxt）

## 向后兼容性

1. **VerificationScope** - 新增字段为可选，现有代码无需改动
2. **Artifact 验证** - 默认不检查 freshness，现有调用者行为不变
3. **Windows Shell Adapter** - 新增 adapter 在 registry 最前面，不影响现有 adapter 的优先级

## 下一步建议

1. 在实际 verification 调用点传递 `originalTask` 和 `targetPackage`
2. 在 artifact 验证场景中根据需要启用 freshness 检查
3. 验证 Windows 环境下 compound 命令的错误提示是否清晰

## 关键设计决策

1. **Freshness 可选** - 保持向后兼容，让调用者决定是否需要 freshness 验证
2. **Compound 命令早期阻止** - 在 adapter registry 最前面检查，避免误适配
3. **PowerShell native 豁免** - 明确识别 PowerShell 语法，不误报 compound 命令
4. **Owner 灵活匹配** - 支持 ownerSessionId 或 ownerAgentId 任一作为 owner 标识
