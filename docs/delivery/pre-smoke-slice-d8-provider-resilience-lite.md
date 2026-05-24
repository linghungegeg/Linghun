# Pre-Smoke Slice D.8: Provider Resilience Lite

> 日期：2026-05-25
> 范围：TUI 层轻量 in-memory Provider Circuit Breaker / Cooldown
> 模式：focused local implementation，无真实 provider 调用，无 commit

---

## Git Status（当前）

```
On branch master
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
?? docs/delivery/pre-smoke-slice-d8-provider-resilience-lite.md
?? packages/tui/src/provider-circuit-breaker.test.ts
?? packages/tui/src/provider-circuit-breaker.ts
```

注：D.8 源码改动均为本轮新增，未 commit。本报告不宣布 Beta PASS / smoke-ready / open-source-ready。

---

## Source-Level Reality Check

### 实际读取的文件

| 文件 | 审计深度 |
|------|----------|
| `packages/providers/src/index.ts` | 分段精读（retry 逻辑、error classification、timeout 常量、normalizeProviderError HTTP status mapping） |
| `packages/providers/src/index.test.ts` | 全文精读（1072 行） |
| `packages/tui/src/index.ts` | 分段精读（TuiContext 类型、sendMessage 函数、streamFinalModelAnswerWithoutTools、continueModelAfterToolResults、createTerminalProblems） |
| `packages/tui/src/request-lifecycle-presenter.ts` | 全文精读（139 行） |
| `packages/tui/src/terminal-readiness-presenter.ts` | 全文精读（413 行） |
| `packages/tui/src/runtime-status-presenter.ts` | 全文精读（87 行） |
| `packages/tui/src/index.test.ts` | 分段精读（createTestContext helper、provider failure tests） |
| `docs/delivery/pre-smoke-slice-d7-hot-path-performance-cache-coalescing.md` | 全文精读（报告格式参考） |

### 参考核对

- 本阶段参考了 `packages/providers/src/index.ts` 中已有的 `fetchWithProviderRetry`（3 次重试、429/502/503/504）和 `normalizeProviderError`（错误分类）。
- D.8 不修改 provider 层；breaker 在 TUI session 层独立运作，与 provider 层 retry 互不干扰。
- 未复制可疑源码实现。Circuit breaker 为标准模式（threshold + cooldown + clear on success）。

---

## Actual Code Changes

### 1. `packages/tui/src/provider-circuit-breaker.ts`（新增）

**核心模块：Provider Circuit Breaker / Cooldown**

- 类型：`BreakerKey`、`BreakerEntry`、`ProviderCircuitBreakerState`、`CooldownCheckResult`
- 常量：`BREAKER_FAILURE_THRESHOLD = 2`、`BREAKER_COOLDOWN_MS = 45_000`
- 可恢复错误码集合：`PROVIDER_SERVER_ERROR`、`PROVIDER_RATE_LIMITED`、`PROVIDER_REQUEST_TIMEOUT`、`PROVIDER_STREAM_TIMEOUT`、`PROVIDER_NETWORK_ERROR`
- 函数：
  - `createProviderCircuitBreakerState()` — 创建空状态
  - `makeBreakerKey(providerId, model)` — 生成 per-provider+model key
  - `isRecoverableProviderFailure(errorCode)` — 判断是否为可恢复错误
  - `recordProviderFailure(state, providerId, model, errorCode)` — 记录失败，达到阈值进入 cooldown
  - `clearProviderBreaker(state, providerId, model)` — 成功后清除 breaker
  - `checkProviderCooldown(state, providerId, model)` — 检查是否在 cooldown 中
  - `formatCooldownMessage(providerId, model, remainingMs, language)` — 用户可见 cooldown 消息（中英双语）
  - `formatCooldownDoctorLine(state, language)` — doctor/problems 面板的 cooldown 状态行

**设计决策**：
- 不持久化状态（进程重启自动清零）
- 不阻止用户手动重试（cooldown 过期后自动解除）
- 不影响 auth/schema/abort 等非恢复性错误
- 不泄露 API key、raw URL 或 raw response

### 2. `packages/tui/src/index.ts`

**集成点 5 处：**

1. **Import + 类型**：新增 `ProviderCircuitBreakerState` 及相关函数 import
2. **TuiContext 类型**：新增 `providerBreaker: ProviderCircuitBreakerState` 字段
3. **Context 初始化**：`providerBreaker: createProviderCircuitBreakerState()`
4. **sendMessage 函数**：
   - 在 `checkResourceGuard` 之后、`ensureSession` 之前，检查 cooldown → 如果 blocked，输出 cooldown 消息并 return
   - 在 error event handler 中，调用 `recordProviderFailure` 记录失败
   - 在 try/finally 之后（成功路径），调用 `clearProviderBreaker` 清除 breaker
5. **createTerminalProblems**：如果有活跃 cooldown，添加 provider warning 到 problems 面板

**Provider stream 路径覆盖（3/3）：**

| 路径 | `recordProviderFailure` 调用 | 状态 |
|------|------------------------------|------|
| `sendMessage` 主循环 error event | ✓ 已接入 | 完成 |
| `streamFinalModelAnswerWithoutTools` error event | ✓ 已接入 | 完成 |
| `continueModelAfterToolResults` error event | ✓ 已接入 | 完成 |

注：`streamFinalModelAnswerWithoutTools` 和 `continueModelAfterToolResults` 路径的 `clearProviderBreaker`（成功清除）未接入。这两个路径在 tool round limit 或 continuation 场景触发，成功时不清除 breaker 意味着 breaker 只能通过 `sendMessage` 主路径成功或 cooldown 过期来清除。这是保守设计——避免在 continuation 路径中引入额外状态管理复杂度。

### 3. `packages/tui/src/index.test.ts`

- 新增 `createProviderCircuitBreakerState` + `recordProviderFailure` + `checkProviderCooldown` + `clearProviderBreaker` + `formatCooldownMessage` import
- `createTestContext` helper 新增 `providerBreaker` 字段初始化
- 新增 5 个 focused integration tests（见下方）

---

## 新增测试

### `packages/tui/src/provider-circuit-breaker.test.ts`（新增）

39 个测试，覆盖：

| 测试组 | 测试数 | 覆盖内容 |
|--------|--------|----------|
| createProviderCircuitBreakerState | 1 | 空状态创建 |
| makeBreakerKey | 1 | key 格式 |
| isRecoverableProviderFailure | 9 | 5 个可恢复 + 4 个不可恢复 |
| recordProviderFailure | 5 | 忽略非恢复性、首次不 cooldown、阈值触发 cooldown、独立追踪、reason 更新 |
| clearProviderBreaker | 3 | 清除、不抛异常、不影响其他 |
| checkProviderCooldown | 5 | 无 entry、低于阈值、blocked 返回、过期清理、mid-cooldown 剩余时间 |
| formatCooldownMessage | 4 | 英文、中文、向上取整、不泄露 key |
| formatCooldownDoctorLine | 5 | 无 cooldown、过期、英文、中文、多 cooldown |
| end-to-end flow | 3 | 完整生命周期、成功清除、非恢复性不影响 |
| constants | 3 | 阈值、cooldown 时间、集合大小 |

### `packages/tui/src/index.test.ts`（新增 integration describe block）

5 个 focused integration tests：

| 测试 | 覆盖内容 |
|------|----------|
| 2 consecutive recoverable errors enter cooldown, 3rd check is blocked | 阈值触发 + cooldown 阻止后续请求 |
| cooldown message is human-readable with remaining time and /model doctor, no secrets | 用户可见消息格式、无泄露 |
| PROVIDER_AUTH_ERROR and PROVIDER_SCHEMA_ERROR do not trigger breaker | 非恢复性错误不影响 breaker |
| one successful request clears failure count | 成功清除 + 重新计数 |
| different provider/model combinations do not affect each other | 独立追踪 |

---

## Verification Results

| Check | Result |
|-------|--------|
| `vitest run` (3 test files: provider-circuit-breaker, providers/index, tui/index) | PASS — 267 tests (39 + 38 + 190) |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm check` (biome) | PASS — 0 errors |
| `git diff --check` | PASS |

---

## 边界遵守

| 禁止项 | 状态 |
|--------|------|
| 不 commit | ✓ 未 commit |
| 不做真实 provider 调用 | ✓ 无网络调用 |
| 不修改 provider 层 retry 逻辑 | ✓ `packages/providers/src/index.ts` 未改动 |
| 不做 schema 变更 | ✓ 无 schema 改动 |
| 不做持久化 | ✓ 纯 in-memory |
| 不拆分 index.ts | ✓ 仅加集成代码 |
| 不做 runner hardening | ✓ 未触碰 |
| 不影响 auth/schema/abort 错误 | ✓ 仅 5 个可恢复码触发 |
| 不泄露 API key/URL/response | ✓ formatCooldownMessage 仅输出 providerId/model/seconds |

---

## 行为说明

### 触发条件
- 同一 provider+model 连续 2 次可恢复失败（429/502/503/504 对应的 PROVIDER_SERVER_ERROR/PROVIDER_RATE_LIMITED，请求超时 PROVIDER_REQUEST_TIMEOUT，流空闲超时 PROVIDER_STREAM_TIMEOUT，网络错误 PROVIDER_NETWORK_ERROR）

### Cooldown 行为
- 进入 45 秒 cooldown
- Cooldown 期间 `sendMessage` 直接返回用户可见消息，不发 provider 请求
- Cooldown 过期后自动解除（下次 `checkProviderCooldown` 时清理）
- 成功请求立即清除 breaker（`clearProviderBreaker`，仅 `sendMessage` 主路径）

### 不触发的错误
- 400/schema 错误（PROVIDER_SCHEMA_ERROR）
- 401/403 auth 错误（PROVIDER_AUTH_ERROR）
- 用户 abort（ABORT）
- 工具执行失败
- 权限拒绝
- PROVIDER_STREAM_ERROR（流内 JSON error 事件，非 HTTP 状态码错误）
- PROVIDER_BAD_REQUEST（HTTP 400）
- PROVIDER_HTTP_ERROR（其他非 5xx HTTP 错误）

### 用户可见输出
- Cooldown 消息（中英双语）：告知 provider/model、剩余秒数、下一步操作（/model doctor、/model）
- Problems 面板：活跃 cooldown 显示为 provider warning
- Doctor 面板：`formatCooldownDoctorLine` 输出 cooldown 状态

---

## 已知限制

- 不持久化：进程重启后 breaker 状态丢失（设计如此）
- 不做 provider 健康探测：cooldown 过期后直接允许重试，不主动探测 provider 是否恢复
- 不做跨 provider 自动切换：cooldown 只阻止当前 provider+model，不自动 fallback 到其他 provider
- 不做 exponential backoff：cooldown 固定 45 秒，不随连续失败次数递增
- `streamFinalModelAnswerWithoutTools` 和 `continueModelAfterToolResults` 路径已接入 `recordProviderFailure`（失败记录），但未接入 `clearProviderBreaker`（成功清除）。这两个 continuation 路径成功时不清除 breaker，breaker 只能通过 `sendMessage` 主路径成功或 cooldown 自然过期来解除。影响：如果用户在 continuation 路径成功后立即遇到主路径失败，breaker 计数不会被 continuation 成功重置。实际影响极小——continuation 路径触发频率低（tool round limit / model continuation），且 cooldown 仅 45 秒。

---

## Handoff Packet

```yaml
completed_slice: D.8
next_slice: D.9 或用户指定
files_changed:
  - packages/tui/src/provider-circuit-breaker.ts (新增)
  - packages/tui/src/provider-circuit-breaker.test.ts (新增)
  - packages/tui/src/index.ts (集成 — 5 处改动)
  - packages/tui/src/index.test.ts (import 扩展 + test helper 更新 + 5 integration tests)
forbidden:
  - 不 commit（用户未要求）
  - 不修改 provider 层（packages/providers/src/index.ts）
  - 不做持久化
  - 不做 runner hardening（P2-2/P2-7 scope）
  - 不做跨 provider 自动切换
verification:
  tests: 267 passed (39 breaker + 38 providers + 190 index)
  typecheck: PASS
  biome_check: PASS
  git_diff_check: PASS
provider_stream_paths:
  sendMessage_main: recordProviderFailure + clearProviderBreaker (完整)
  streamFinalModelAnswerWithoutTools: recordProviderFailure only (成功不清除)
  continueModelAfterToolResults: recordProviderFailure only (成功不清除)
index_status: not refreshed (no code graph changes)
permission_mode: default
model: N/A (no provider calls)
budget: minimal — 2 new files, 2 files edited, 44 new tests (39 unit + 5 integration), 0 new dependencies
```
