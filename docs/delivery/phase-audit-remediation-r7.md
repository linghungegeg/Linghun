# Phase R7 — 编排微调 + Brief 模式 交付文档

## 阶段目标

实现 AUDIT_REMEDIATION_PLAN.md Phase R7 的 5 项功能：Bash 子命令解析器、多工具批量确认、Agent handoff 安全审查、Brief 模式、Meta Scheduler 复杂度估计。

## 已完成功能

### 1. Bash 子命令级解析器
- `bash-subcommand-parser.ts`：纯函数模块，解析管道/链式命令为独立段
- 支持 `|` `&&` `||` `;` 分段，正确处理引号、反引号、`$()` 嵌套和重定向
- 每段独立分类（classifyBashHead）后聚合决策
- 输出重定向 `>` `>>` 被检测并升级为 mutating
- 已集成到 permission-policy-engine.ts 的 compound 路径
- 子 shell 执行（`$()` / 反引号）独立短路为 require_permission

### 2. 多工具调用合并确认 UX
- `batch-tool-confirmation.ts`：纯函数模块
- `groupToolCallsForConfirmation`：相同工具名+相同风险等级的连续调用合并为单次批量确认
- 保守规则：destructive/secret_read/outside_workspace 始终单独确认
- auto_allow_readonly 工具自动分组为 auto_allow batch（无弹窗）

### 3. Agent Handoff 安全审查
- `agent-handoff-safety.ts`：纯函数模块
- `validateHandoff`：验证子 agent 能力不超出父权限边界
- Plan 模式下禁止 mutating 工具（Edit/Write/Bash 等）
- 子 scope 不得超出父 scope（路径前缀检查）

### 4. Brief 模式
- `/brief` 命令切换（已注册到 SLASH_COMMAND_REGISTRY + 能力目录）
- `LINGHUN_TUI_BRIEF=1` 环境变量支持
- view-model 效果：
  - thinking/continuing activity 阶段静默（不渲染 spinner）
  - streaming assistant 预览静默
  - tool_running / permission_waiting / error / completed 保留
- 双语消息（tui-messages.ts）

### 5. Meta Scheduler 复杂度估计
- `meta-scheduler-complexity.ts`：纯函数模块
- 四级分类：trivial / simple / moderate / complex
- 输出建议：suggestedMaxTools / suggestedMaxAgents / rationale
- 防止小任务过度工程化

## 涉及模块

| 文件 | 变更类型 |
|------|----------|
| `packages/tui/src/bash-subcommand-parser.ts` | 新增 |
| `packages/tui/src/batch-tool-confirmation.ts` | 新增 |
| `packages/tui/src/agent-handoff-safety.ts` | 新增 |
| `packages/tui/src/meta-scheduler-complexity.ts` | 新增 |
| `packages/tui/src/permission-policy-engine.ts` | 修改：compound 分类集成 + 子 shell 检测 |
| `packages/tui/src/permission-policy-engine.test.ts` | 修改：新增 auto_allow 全段 readonly 用例 |
| `packages/tui/src/index.ts` | 修改：/brief 命令处理 |
| `packages/tui/src/tui-context-runtime.ts` | 修改：briefMode 字段 |
| `packages/tui/src/tui-messages.ts` | 修改：r7BriefEnabled/Disabled 双语 |
| `packages/tui/src/shell/view-model.ts` | 修改：brief 模式抑制 thinking + streaming |
| `packages/tui/src/natural-command-bridge.ts` | 修改：/brief 注册 |
| `packages/tui/docs/delivery/README.md` | 新增：phase table |

## 验收标准覆盖

- `ls | grep foo` → 两个子命令独立分类：ls=readonly, grep=unknown → aggregate require_permission ✓
- `git status || true` → 两个段均 readonly → auto_allow_readonly ✓
- 连续 3 个同风险工具调用 → groupToolCallsForConfirmation 合并为 batch_confirm ✓
- brief 模式下 thinking spinner 不渲染 ✓
- build 通过 ✓
- 测试全绿 ✓

## 测试与验证

- TypeScript typecheck: PASS
- Build: PASS
- Tests: 2908 pass / 0 fail (tui) + 141 pass (providers) = 全绿

## 参考核对

- 参考了 CCB subcommandResults 的管道/重定向识别行为边界（仅行为参考）
- 参考了 CCB BriefMode 的折叠效果思路（仅概念参考）
- 参考了 CCB auto mode 零打断体验的批量确认合并设计思路（仅行为参考）
- 未复制可疑源码实现

## Handoff Packet

```yaml
phase: R7
status: COMPLETE
branch: codex/meta-scheduler-closure
baseline_tag: stable/r6-complete
verification:
  typecheck: PASS
  build: PASS
  tests: 2908/2908 (tui) + 141/141 (providers)
next_phase: R8 (if applicable per AUDIT_REMEDIATION_PLAN)
禁止事项:
  - 不得复制 CCB KAIROS flag 系统
  - 不得将 batch-tool-confirmation 集成到生产 model-stream dispatch 前需先有 R8 TUI 集成层
  - 不得修改 classifyBashHead 的 READONLY_HEADS 集合以添加 grep 等未审慎评估的命令
索引状态: N/A (pure logic modules, no runtime index dependency)
权限模式: default
模型/provider: N/A
预算使用: 单 conversation turn
```
