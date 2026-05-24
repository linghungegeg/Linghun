# Pre-Smoke Slice D.9: Long Task / Runner Resilience Closure

> 日期：2026-05-25
> 范围：TUI 层 Long Task / Runner Resilience 闭环——自然语言路由、Start Gate、Runner Fallback、Timeout/Cancel 非 PASS、Windows 进程树清理、Activity Phase、Stale Recovery
> 模式：focused local implementation，无真实 provider 调用，无 commit

---

## Git Status（当前）

```
On branch master
 M packages/tui/src/index.test.ts
 M packages/tui/src/natural-command-bridge.ts
 M packages/tui/src/natural-command-bridge.test.ts
?? docs/delivery/pre-smoke-slice-d8-provider-resilience-lite.md
?? docs/delivery/pre-smoke-slice-d9-long-task-runner-resilience.md
```

注：D.9 源码改动均为本轮新增，未 commit。`packages/tui/src/index.ts` 未被 D.9 修改（仅读取）。`index.test.ts` 的 M 状态包含 D.8 integration tests + D.9 tests + 4 个 Phase 06 测试的 job 隔离修复。本报告不宣布 Beta PASS / smoke-ready / open-source-ready。

---

## Source-Level Reality Check

### 实际读取的文件

| 文件 | 审计深度 |
|------|----------|
| `packages/tui/src/index.ts` | 分段精读（handleJobCommand、createDurableJob、startRunnerForDurableJob、startApprovedRunnerSpec、resolveNativeRunner、checkResourceGuard、checkBackgroundStartGuard、hydrateDurableJobBackgroundTasks、recoverDurableJobForContext、resumeDurableJob、transitionDurableJob、applyDurableJobBudgetStop、runDurableJobLiteTick、stopRunnerForDurableJob） |
| `packages/tui/src/index.test.ts` | 分段精读（createTestContext helper、createMockNativeRunner、existing job tests with `jobs: { scope: "project" }` pattern） |
| `packages/tui/src/natural-command-bridge.ts` | 分段精读（routeNaturalIntent、scoreCapability、isNaturalControlPlaneIntent） |
| `packages/tui/src/natural-command-bridge.test.ts` | 分段精读（existing natural language tests、capability routing） |
| `packages/tui/src/request-lifecycle-presenter.ts` | 全文精读（RequestActivityPhase、formatRequestActivity） |
| `packages/tui/src/job-runner-presenter.ts` | 全文精读（formatRunnerDoctor、formatJobRunnerInline） |
| `packages/config/src/index.ts` | 分段精读（resolveStoragePaths、storage.jobs scope、BACKGROUND_KIND_CAPS） |
| `docs/delivery/pre-smoke-slice-d8-provider-resilience-lite.md` | 全文精读（报告格式参考） |

### 参考核对

- 本阶段参考了 `packages/tui/src/index.ts` 中已有的 durable job 系统（createDurableJob、startRunnerForDurableJob、resolveNativeRunner、checkBackgroundStartGuard、hydrateDurableJobBackgroundTasks）。
- 参考了已有 job 测试中 `storage: { ...defaultConfig.storage, jobs: { scope: "project" } }` 的隔离模式。
- D.9 不修改 job 系统核心逻辑；仅补充自然语言路由和 focused integration tests。
- 未复制可疑源码实现。自然语言路由为标准 score-based intent matching。

---

## Actual Code Changes

### 1. `packages/tui/src/natural-command-bridge.ts`（修改）

**自然语言 Long Task 路由增强：**

- `isNaturalControlPlaneIntent`：新增 `["autopilot", "job", "background"]` 分支，使用 regex guard 匹配中英文长任务别名（持续推进、继续做、不用每步都问、autopilot、本地任务、长期任务、任务报告、durable job、job report、后台、background、长任务、long task）
- `scoreCapability`：
  - autopilot 匹配 `/持续推进|继续做|不用每步都问|autopilot/` → score += 6
  - job 匹配 `/本地任务|长期任务|durable job|job report/` → score += 6
  - job 精确匹配 `/^任务报告$/` → score += 6（避免 "分析这个 repo 并写一份报告" 误匹配）
  - todo 排除 regex 扩展，避免与 job 别名竞争
- 路由逻辑：新增 agents-jobs group 早期返回路径（topScore >= 5 时直接路由到 start_gate/execute_readonly，不进入 ask_clarify）

**设计决策**：
- 短别名（继续做、持续推进、长任务、后台、本地任务）通过 `isNaturalControlPlaneIntent` regex guard 精确匹配，避免与 model/todo 竞争
- "任务报告" 使用 `^任务报告$` 精确匹配，防止 "分析这个 repo 并写一份报告" 误触发
- autopilot 路由到 `start_gate`（进入 Start Gate 确认流程），job/background 路由到 `execute_readonly`

### 2. `packages/tui/src/natural-command-bridge.test.ts`（修改）

新增 "Slice D.9: Long Task / Runner Resilience — Natural Language Route" describe block：

| 测试 | 覆盖内容 |
|------|----------|
| Chinese long task aliases route to autopilot/job/background | 持续推进→autopilot、本地任务→job、后台→background、长任务→background |
| autopilot routes to start_gate action | start_gate 确认流程 |
| "任务报告" routes to job, not model | 精确匹配不误触发 |
| "分析这个 repo 并写一份报告" does NOT route to job | 防止误匹配回归 |

共 4 个测试 + 9 个子断言。

### 3. `packages/tui/src/index.test.ts`（修改）

新增 "Slice D.9: Long Task / Runner Resilience Closure" describe block：

| 测试 | 覆盖内容 |
|------|----------|
| autopilot/job/background enter existing start gate | pendingAutopilot 设置 + /esc 取消 + 不创建 job |
| runner completed ≠ verification PASS | cancel 后 backgroundTasks 不含 pass + 输出包含 invariant 消息 |
| timeout does not produce PASS evidence | /job create + 手动设 startedAt 过期 + /job resume 触发 timeout + result.status="timeout" |
| Windows mock runner cancel/timeout cleanup | native runner 启动 + /job cancel + state.runner.status="cancelled" + mock runner 收到 stop 命令（验证 stop 命令下发，非直接验证 taskkill /t 系统调用） |
| task activity view phases | formatRequestActivity 所有 phase 中英文输出非空、无 undefined 泄露 |
| runner ready uses runner; missing falls back | native runner available → adapter="native" + missing runner → adapter="node" + fallbackReason |
| stale job recovery marks runner terminal | 手动清除 owner/heartbeat + hydration 检测 stale + result.status="stale" + no PASS |

共 7 个 focused integration tests。

**关键修复**：所有 D.9 job 测试使用 `storage: { ...defaultConfig.storage, jobs: { scope: "project" } }` 隔离 job 目录，避免跨测试污染（根因：`defaultConfig.storage.jobs.scope = "user"` 导致全局 jobs 目录共享）。

---

## 发现并修复的问题

### 1. 自然语言路由竞争（11 个子断言失败）

**问题**：短中文别名（继续做、持续推进、长任务、后台、本地任务）被 model capability 的高 base score 抢走。

**修复**：
- `isNaturalControlPlaneIntent` 新增 autopilot/job/background regex guard
- `scoreCapability` 新增 autopilot/job 高分 boost（+6）
- todo 排除 regex 扩展
- agents-jobs group 早期返回路径

### 2. Job 测试跨测试污染（3 个测试失败）

**问题**：`defaultConfig.storage.jobs.scope = "user"` 导致所有测试共享全局 jobs 目录。`hydrateDurableJobBackgroundTasks` 在 `/job run` 前加载已有 job，触发 `BACKGROUND_KIND_CAPS["job"] = 1` 上限。

**修复**：D.9 所有 job 测试使用 `jobs: { scope: "project" }` 隔离。

### 3. EvidenceRecord kind 类型错误

**问题**：D.9 测试使用 `kind: "verification"`，但 `EvidenceRecord["kind"]` 不包含该值。

**修复**：改为 `kind: "test_result"`，并补充 `source: "vitest"` 字段。

### 4. Phase 06 测试 job 目录污染（4 个测试失败）

**问题**：4 个 Phase 06 `runTui` 测试（"keeps slash control-plane paths"、"returns Bash non-zero exits"、"shows index safety repair loop"、"runs Phase 15 pre-Beta end-to-end"）未设置 `storage.jobs.scope = "project"`，导致 `hydrateDurableJobBackgroundTasks` 加载其他测试遗留的 user-scope job，触发 `checkBackgroundStartGuard` 的 `"已有重任务正在运行：job ..."` 阻塞。

**根因**：与 D.9 issue #2 相同——`defaultConfig.storage.jobs.scope = "user"` 导致全局 jobs 目录共享。这些测试本身不涉及 job 功能，但 `runTui` 启动时无条件调用 `hydrateDurableJobBackgroundTasks`，加载了其他测试创建的 job state 文件。

**修复**：为这 4 个测试的 settings.json 添加 `storage: { ...defaultConfig.storage, jobs: { scope: "project" } }`，隔离 job 目录。对于无 settings.json 的测试（"shows index safety repair loop"），新增 `.linghun/settings.json` 写入。

---

## Verification Results

| Check | Result |
|-------|--------|
| `vitest run` (3 test files) | **386 passed, 0 failed** |
| D.9 index tests (7) | ALL PASS |
| D.9 natural-command-bridge tests (4+9 assertions) | ALL PASS |
| Phase 06 previously-failing tests (4) | ALL PASS (fixed by job scope isolation) |
| provider-circuit-breaker tests (39) | ALL PASS |
| natural-command-bridge tests (150) | ALL PASS |
| index tests (197) | ALL PASS |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm check` (biome) | PASS — 0 errors |
| `git diff --check` | PASS |

---

## 边界遵守

| 禁止项 | 状态 |
|--------|------|
| 不 commit | ✓ 未 commit |
| 不做真实 provider 调用 | ✓ 无网络调用 |
| 不做 native runner bundling/signing | ✓ 仅测试 mock runner |
| 不修改 provider 层 | ✓ `packages/providers/src/index.ts` 未改动 |
| 不做 schema 变更 | ✓ 无 schema 改动 |
| 不创建第二个 long-task 系统 | ✓ 仅补充路由和测试 |
| 不修改 job 核心逻辑 | ✓ 仅在 natural-command-bridge 加路由 |
| 不做 provider key 变更 | ✓ 无 key 操作 |

---

## 行为说明

### 自然语言 Long Task 路由

| 输入 | 路由目标 | Action |
|------|----------|--------|
| "持续推进" / "继续做" / "不用每步都问" | autopilot | start_gate |
| "本地任务" / "长期任务" / "durable job" / "job report" | job | execute_readonly |
| "任务报告" | job | execute_readonly |
| "后台" / "background" / "长任务" / "long task" | background | execute_readonly |
| "分析这个 repo 并写一份报告" | 不路由到 job | 保持原有行为 |

### Runner Resilience 行为

- **Runner available**：resolveNativeRunner 返回 "available" → startApprovedRunnerSpec spawn 进程 → 等待 state 文件 → adapter="native"
- **Runner missing/unavailable**：resolveNativeRunner 返回 "unavailable" → startApprovedRunnerSpec 直接返回 node_fallback → adapter="node"
- **Runner start timeout**：进程启动但 state 文件未在 1.5s 内写出 → fallback 到 node
- **Cancel**：stopRunnerForDurableJob 调用 → Windows 上 `taskkill /pid /t` → state.runner.status="cancelled"
- **Timeout**：applyDurableJobBudgetStop 检测 runtimeMs > maxRuntimeMs → transitionDurableJob("timeout") → result.status="timeout"
- **Stale recovery**：hydrateDurableJobBackgroundTasks → recoverDurableJobForContext 检测 missing owner/heartbeat → status="stale"

### 不变量

- **runner completed ≠ PASS**：任何 terminal 状态（completed/cancelled/timeout/stale/blocked）都不产生 verification PASS evidence
- **autopilot 进入 Start Gate**：自然语言路由到 autopilot 时 action="start_gate"，不直接启动 job
- **Activity phases 无泄露**：所有 RequestActivityPhase 值产生人类可读中英文输出，不含 "undefined"

---

## 已知限制

- 自然语言路由依赖 regex 匹配，不做 NLP/embedding；极端边界输入可能误匹配
- Mock runner 测试依赖真实进程 spawn；在极慢 CI 环境中 `waitForRunnerState` 可能超时（当前 1.5s timeout 在 Windows 测试中稳定通过）
- Windows runner cleanup 测试验证的是 stop 命令下发到 mock runner，非直接验证 `taskkill /pid /t` 系统调用（实际 taskkill 调用在 `stopRunnerForDurableJob` 内部，由 mock runner 的 stop handler 代理）
- `isNaturalControlPlaneIntent` 的 regex 列表是硬编码的；新增别名需要手动维护

---

## Handoff Packet

```yaml
completed_slice: D.9
next_slice: D.10 或用户指定
files_changed:
  - packages/tui/src/natural-command-bridge.ts (修改 — isNaturalControlPlaneIntent + scoreCapability + early return)
  - packages/tui/src/natural-command-bridge.test.ts (修改 — D.9 describe block 4 tests + autopilot assertion tightened to exact start_gate)
  - packages/tui/src/index.test.ts (修改 — D.9 describe block 7 tests + 4 Phase 06 tests job scope isolation fix + evidence type fix)
forbidden:
  - 不 commit（用户未要求）
  - 不修改 job 核心逻辑（packages/tui/src/index.ts 未改动）
  - 不做 native runner bundling/signing
  - 不做真实 provider 调用
  - 不创建第二个 long-task 系统
verification:
  tests: 386 passed, 0 failed (39 breaker + 150 natural-command-bridge + 197 index)
  d9_tests: 11 passed (7 index + 4 natural-command-bridge)
  phase06_fixed: 4 tests fixed (job scope isolation)
  typecheck: PASS
  biome_check: PASS
  git_diff_check: PASS
root_cause_fixes:
  - natural language routing competition (11 assertions): added regex guard + score boost + early return
  - cross-test job directory pollution (7 tests total: 3 D.9 + 4 Phase 06): added jobs scope "project" isolation
  - EvidenceRecord kind type error: changed "verification" to "test_result" + added source field
  - autopilot assertion looseness: tightened from toContain array to exact toBe("start_gate")
  - Windows cleanup test title: renamed from "taskkill /t" to "sends stop command to runner" (reflects actual verification scope)
index_status: not refreshed (no code graph changes)
permission_mode: default
model: N/A (no provider calls)
budget: minimal — 0 new files, 3 files modified, 11 new tests (7 integration + 4 natural language), 0 new dependencies
```
