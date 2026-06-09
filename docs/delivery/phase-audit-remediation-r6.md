# Phase R6 — 超时容错 + 高级面板降噪 交付文档

## 阶段目标

实现 AUDIT_REMEDIATION_PLAN.md Phase R6 的 6 项功能：超时容错、重试 UI、circuit breaker 通知、/status 高级面板。

## 已完成功能

### 1. 长请求容错（tool_running 免超时）
- Slow-hint 20s 定时器在 `requestActivityPhase === "tool_running"` 时不触发
- Bash 工具执行 60s+ 不再误报"模型没反应"

### 2. 重试 UI
- Provider 层 `onRetry` 回调：重试时通知 TUI 当前 attempt/delay/statusCode
- 新 activity phase `provider_retrying`
- Spinner 文案："重试中 (1/3)…3s 后重试" / "Retrying (1/3)… retry in 3s"

### 3. Circuit Breaker 通知
- `recordProviderFailure` 返回 boolean（是否 breaker 刚打开）
- Breaker open 时调用 `context.pushNotification`
- 用户看到："Provider 暂时不可用，45s 后重试" transient notification

### 4. 优雅降级通知
- `context.pushNotification` hook 暴露在 TuiContext 上
- index.ts 初始化时绑定到 `pushTransientNotification`
- 跨模块可用（model-stream-runtime 等）

### 5. /status 高级面板
- Ink 模式：CommandPanel overlay（不进 transcript）
- 7 个 section：Model / Context / Cost / Provider Health / Cache / Index / Rate Limit
- Summary 行始终可见：模型名 + context% + 权限模式
- Plain 模式：保留原有 writeStatus 行为

### 6. 面板降噪（折叠/展开）
- 默认 `expanded: false`（只显示 summary）
- Enter 切换展开完整 sections
- Esc 关闭面板

## 涉及模块

| 文件 | 变更类型 |
|------|----------|
| `packages/providers/src/index.ts` | 修改：retry loop 调用 onRetry hook |
| `packages/providers/src/provider-client-runtime.ts` | 修改：ProviderClientHooks 增加 onRetry |
| `packages/tui/src/request-lifecycle-presenter.ts` | 修改：新增 provider_retrying phase |
| `packages/tui/src/model-stream-runtime.ts` | 修改：slow-hint 免触发 + breaker 通知 |
| `packages/tui/src/provider-circuit-breaker.ts` | 修改：recordProviderFailure 返回 boolean |
| `packages/tui/src/tui-context-runtime.ts` | 修改：TuiContext 新增 pushNotification |
| `packages/tui/src/index.ts` | 修改：注册 onRetry hook + 初始化 pushNotification + /status 面板化 |
| `packages/tui/src/details-status-runtime.ts` | 修改：新增 buildStatusPanel |
| `packages/tui/src/shell/view-model.ts` | 修改：provider_retrying phase mapping |

## 测试与验证

- TypeScript typecheck: PASS
- Build: PASS
- Tests: 3213 pass / 0 fail / 2 skip（与基线一致）

## 参考核对

- 参考了 CCB withRetry 的重试计数 + 429/503 区分行为（仅行为参考）
- 参考了 CCB BuiltinStatusLine 的分段布局思路（仅布局参考）
- 参考了 CCB "hasActiveTools 时 timer 不计" 的行为边界（仅条件判断思路）
- 未复制可疑源码实现

## Handoff Packet

```yaml
phase: R6
status: COMPLETE
branch: codex/meta-scheduler-closure
commit: 0c4eca70
verification:
  typecheck: PASS
  build: PASS
  tests: 3213/3213 (0 fail, 2 skip)
next_phase: R7
```
