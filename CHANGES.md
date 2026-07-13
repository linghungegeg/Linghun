# 修复项11：Windows compound command

## 问题描述

stage8的shell adapter硬拦截所有包含分号的命令，导致合法的PowerShell `cmd1; cmd2` 无法执行。

## 根本原因

`tokenizeSimpleShellCommand` 函数在第2921行使用 `/[\r\n|;&<>]/u.test(trimmed)` 硬拦截所有包含分号的命令。这个函数被 `convertUnixReadOnlyCommandForPowerShell` 和 `blockUnsupportedUnixReadOnlyCommand` adapter 使用，用于处理简单的Unix只读命令（如 `cat file.txt`）。

但是，合法的PowerShell compound命令（如 `node --version; npm --version`）在到达这些adapter之前，没有被正确识别并豁免，导致被错误拦截。

## 修复方案

在 `WINDOWS_SHELL_ADAPTER_REGISTRY` 的 `UnsupportedPosixAdapter` **之前**添加新的 `PowerShellCompoundAdapter`：

### 策略

1. **识别合法的PowerShell分号命令**并让它们原样通过
2. **危险命令**由前置adapter处理（已有机制无需修改）：
   - remote shell payload 泄漏 → `DiagnosticAdapter` 拦截
   - 文件写入操作 → `BlockedWriteAdapter` 拦截
   - POSIX shell语法 → `UnsupportedPosixAdapter` 拦截

### 实现逻辑

```typescript
{
  name: "PowerShellCompoundAdapter",
  adapt: (command) => {
    const normalized = command.trim();
    // 只处理包含分号的命令
    if (!normalized.includes(";")) return undefined;
    // 拒绝多行命令
    if (/\n/u.test(normalized)) return undefined;
    // 如果是PowerShell脚本语法，直接通过
    if (looksLikePowerShellScript(normalized)) {
      return { command, adapter: "native" };
    }
    // 如果不包含管道/后台执行，且不包含POSIX特殊语法，允许通过
    if (!/[|&]/u.test(normalized) && !/<<|export\s+\w+=|\$\([^)]*\)/u.test(normalized)) {
      return { command, adapter: "native" };
    }
    return undefined;
  },
}
```

### 处理的场景

**✅ 允许通过：**
- PowerShell cmdlets: `Write-Output 'hello'; Write-Output 'world'` → `powershell-adapted`
- 普通命令: `node --version; npm --version` → `native`
- 多命令: `git --version; node --version; npm --version` → `native`
- 显式PowerShell: `powershell.exe -NoProfile -Command 'Get-Date; Write-Output test'` → `native`

**🚫 拦截危险命令：**
- remote payload泄漏: `adb shell ls | grep .apk` → `blocked` (DiagnosticAdapter)
- 文件写入: `cat <<EOF > file.txt` → `blocked` (BlockedWriteAdapter)
- POSIX export: `export VAR=value; echo $VAR` → `blocked` (UnsupportedPosixAdapter)
- 命令替换: `echo $(date); echo done` → `blocked` (UnsupportedPosixAdapter)

## 修改文件

### 1. `packages/tools/src/index.ts`
- 在 `WINDOWS_SHELL_ADAPTER_REGISTRY` 第2416行之前添加 `PowerShellCompoundAdapter`
- 位置：`UnsupportedMultilineAdapter` 之后，`UnsupportedPosixAdapter` 之前
- 新增代码：15行

### 2. `packages/tools/src/index.test.ts`
- 第2512行：添加测试 "allows legitimate PowerShell compound commands with semicolons"
  - 测试PowerShell cmdlets、普通命令、多命令、显式PowerShell
- 第2539行：添加测试 "blocks dangerous compound commands on Windows"
  - 测试remote payload、文件写入、POSIX export、命令替换
- 新增代码：47行

## 验证结果

### 手动测试
```
✓ PowerShell cmdlets with semicolon
✓ Ordinary commands with semicolon
✓ Multiple ordinary commands
✓ Explicit PowerShell
✓ Remote shell with pipe (should block)
✓ File write with heredoc (should block)
✓ POSIX export (should block)
✓ Command substitution (should block)
✓ Simple command without semicolon

Results: 9 passed, 0 failed
```

### Typecheck
- `packages/tools` typecheck通过

### 测试套件
- 等待完整测试套件结果

## 影响范围

- **最小改动**：只在adapter链中添加一个新的adapter，不修改现有逻辑
- **向后兼容**：不影响现有命令的处理
- **安全性保持**：危险命令仍然被前置adapter拦截
- **覆盖场景**：
  - ✅ 普通PowerShell `cmd1; cmd2`
  - ✅ official runner的合法分号命令
  - ✅ PowerShell cmdlet分号组合
  - ✅ 显式PowerShell语法
  - 🚫 remote payload泄漏（保持拦截）
  - 🚫 危险文件写入（保持拦截）
  - 🚫 POSIX shell特殊语法（保持拦截）

## 设计原则

1. **最小必要改动**：只添加新adapter，不修改现有逻辑
2. **分层防御**：危险命令由前置adapter处理，新adapter只处理合法场景
3. **保守策略**：只豁免明确安全的模式，有疑问的交给后续adapter处理
4. **显式判断**：逻辑清晰，易于理解和维护
