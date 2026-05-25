# Slice D.11B — Process Guard Implementation Closure

> 日期：2026-05-25
> 范围：基于 D.11A 审计完成最小成品级 Process Guard 闭环，增强主动 cancel/timeout/normal-exit cleanup；不引入 native addon，不新增第二套 runner/job 系统，不做真实 smoke。

---

## git status --short 真实输出

### 开工前

```text
?? docs/delivery/pre-smoke-slice-d10i-index-extraction-final-audit.md
?? docs/delivery/pre-smoke-slice-d11a-process-guard-design-audit.md
```

### 交付报告写入前

```text
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
 M packages/tui/src/job-runner-presenter.ts
 M packages/tui/src/job-runtime.ts
 M packages/tui/src/runner-runtime.test.ts
 M packages/tui/src/runner-runtime.ts
?? docs/delivery/pre-smoke-slice-d10i-index-extraction-final-audit.md
?? docs/delivery/pre-smoke-slice-d11a-process-guard-design-audit.md
?? packages/tui/src/process-guard.test.ts
?? packages/tui/src/process-guard.ts
```

### 用户要求停止独立复审后的当前状态

```text
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
 M packages/tui/src/job-runner-presenter.ts
 M packages/tui/src/job-runtime.ts
 M packages/tui/src/runner-runtime.test.ts
 M packages/tui/src/runner-runtime.ts
?? docs/delivery/pre-smoke-slice-d10i-index-extraction-final-audit.md
?? docs/delivery/pre-smoke-slice-d11a-process-guard-design-audit.md
?? docs/delivery/pre-smoke-slice-d11b-process-guard-implementation.md
?? packages/tui/src/process-guard.test.ts
?? packages/tui/src/process-guard.ts
```

### SIGTERM targeted fix 后当前状态

```text
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
 M packages/tui/src/job-runner-presenter.ts
 M packages/tui/src/job-runtime.ts
 M packages/tui/src/runner-runtime.test.ts
 M packages/tui/src/runner-runtime.ts
?? docs/delivery/pre-smoke-slice-d10i-index-extraction-final-audit.md
?? docs/delivery/pre-smoke-slice-d11a-process-guard-design-audit.md
?? docs/delivery/pre-smoke-slice-d11b-process-guard-implementation.md
?? packages/tui/src/process-guard.test.ts
?? packages/tui/src/process-guard.ts
```

---

## 实际读取文件列表

- `docs/delivery/pre-smoke-slice-d11a-process-guard-design-audit.md`
- `packages/tui/src/index.ts`
- `packages/tui/src/runner-runtime.ts`
- `packages/tui/src/runner-runtime.test.ts`
- `packages/tui/src/job-runtime.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/job-runner-presenter.ts`
- `packages/tui/src/process-guard.ts`（新增后复读确认）
- `packages/tui/src/process-guard.test.ts`（新增后复读确认）
- `package.json`

索引状态：`mcp__codebase-memory-mcp__index_status` 返回 `project=F-Linghun; status=ready; nodes=2077; edges=4491`。

---

## 改动文件列表

- `packages/tui/src/process-guard.ts`（新增）
- `packages/tui/src/process-guard.test.ts`（新增）
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/runner-runtime.ts`
- `packages/tui/src/runner-runtime.test.ts`
- `packages/tui/src/job-runtime.ts`
- `packages/tui/src/job-runner-presenter.ts`
- `docs/delivery/pre-smoke-slice-d11b-process-guard-implementation.md`（本报告）

未触碰 provider/model loop；未修改 job 状态机语义；未新增 native addon / node-gyp / napi-rs；未新增第二套 runner/job 系统。

---

## ProcessGuard 行为表

| 场景 | D.11B 行为 | 说明 |
|---|---|---|
| Windows tracked child | `taskkill /pid <pid> /t` | 只对本进程刚 spawn 且已 track 的 child pid 操作，不裸杀历史 PID。 |
| Windows force stop | `taskkill /pid <pid> /t /f` | force 时追加 `/f`；taskkill spawn 失败时 best-effort fallback 到 `child.kill(signal)` 并记录 failure。 |
| Unix detached child | `process.kill(-pid, signal)` | 仅当调用方明确以 `detached: true` spawn 并以 `detached: true` track，才使用负 pid 杀进程组。 |
| Unix non-detached child | `child.kill(signal)` | 不对非 detached child 使用 `kill(-pid)`，避免误杀父进程所在进程组。 |
| graceful stop | `SIGTERM` / Windows taskkill without `/f` | `requestStop(false)`，幂等；重复 graceful 不重复发送。 |
| force stop | `SIGKILL` / Windows taskkill with `/f` | `requestStop(true)`，允许 graceful 后升级一次 force。 |
| idempotent cleanup | per tracked entry stop state | 已 force 后不重复 stop；已 graceful 再 graceful 会 skipped。 |
| failure observable | `ProcessGuardStopResult.failures[]` | stop 失败不 throw，记录 `{ pid, message }`。 |
| registry cleanup | `exit` / `close` untrack | tracked child 退出后从 registry 移除。 |
| normal exit cleanup | `beforeExit` / `exit` / `SIGTERM` best-effort cleanup | `SIGTERM` 先 best-effort 请求 tracked stop，再以 exit code 143 保留终止语义；`exit` 路径只做同步/best-effort signal fallback，不宣称可等待异步 `taskkill` 完成。SIGINT 保持现有 controller.abort 语义，同时先 best-effort 请求 tracked stop。 |
| stale recovery | native runner `stop --id` best-effort | stale recovery 不裸杀历史 PID；如 job 有 native runner spec 且 runner 可用，仍走 `runner stop --id --root`；不可用时只记录 conservative note。 |

---

## 接入点

### Verification command

- `runVerificationCommand()` spawn verification child 时创建 `ProcessGuard` 并 track child。
- Unix verification child 使用 `detached: process.platform !== "win32"`，确保只有明确独立 process group leader 才会走 `kill(-pid, signal)`。
- cancel/timeout 均执行：
  1. `guard.requestStop(false)`
  2. 1 秒后 `guard.requestStop(true)`
- 保持原有输出采集、timeout/cancel outcome、runnerError、PASS 保守逻辑。

### Generic command timeout

- `runCommandCapture()` 的 `shell:false` generic spawn 路径 track child。
- timeout 从 `child.kill()` 改为 `guard.requestStop(false)`。
- 返回结构和超时文案保持不变：`exitCode=124`，summary 仍为 `命令超时：present:<basename>`。

### Native runner contract

- 新增 `NATIVE_RUNNER_PROCESS_GUARD_CONTRACT` 与 `formatNativeRunnerProcessGuardContract()`。
- `/doctor runner` 和 job report helper 均暴露 native runner process guard contract：
  - Windows native runner SHOULD use Job Object with kill-on-job-close for supervised children.
  - Unix native runner SHOULD create/process-manage child process group and kill group on stop/exit.
  - Parent death cleanup is only proven by real native runner smoke, not by Node tests.
- `stopRunnerForDurableJob()` 仍通过 native runner `stop --id --root`，没有改成裸 `taskkill` runner pid。

---

## 已完成能力 vs 仍需真实 smoke 证明

### 已完成

- 主动 cancel cleanup 已增强：verification cancel 现在走 ProcessGuard graceful + force 升级路径。
- 主动 timeout cleanup 已增强：verification timeout 现在走 ProcessGuard graceful + force 升级路径；generic command timeout 走 ProcessGuard graceful path。
- normal-exit cleanup 已增强：维护当前进程内 tracked child registry，并在 `beforeExit` / `exit` / `SIGTERM` 进行 best-effort cleanup；`SIGTERM` cleanup 后显式以 143 退出，避免 handler 覆盖 Node 默认终止语义。
- Windows taskkill tree-kill fallback 统一进 ProcessGuard：`/pid <pid> /t`，force 追加 `/f`。
- Unix detached/process-group kill 已实现：仅对明确 detached tracked child 使用 `kill(-pid, signal)`。
- stale recovery 不裸杀历史 PID；native runner stale cleanup 只走可验证 job id 的 `runner stop --id --root`。
- ProcessGuard stop failure 不 throw，返回 observable failure result。

### 仍需真实 smoke 证明

- Windows Job Object orphan cleanup 未证明；D.11B 只定义 native runner contract，不实现 native addon，也不验证真实 Job Object。
- parent hard-kill/crash cleanup 未由 Node fallback 保证；`process.on("exit")` 只能同步 best-effort，不能覆盖强杀或崩溃。
- Windows `taskkill /t`、Unix process group kill 对真实 shell grandchild 的 OS 级效果未做真实 smoke。
- Native runner parent-death / orphan cleanup 仍需真实 native runner smoke。

明确声明：未真实 smoke；未 Beta PASS / smoke-ready / open-source-ready。

---

## 测试命令和真实结果

### 1. 指定 focused vitest

命令：

```bash
corepack pnpm exec vitest run packages/tui/src/process-guard.test.ts packages/tui/src/runner-runtime.test.ts packages/tui/src/index.test.ts
```

真实结果：

```text
Test Files  3 passed (3)
Tests       224 passed (224)
Duration    36.71s
```

### 2. Typecheck

命令：

```bash
corepack pnpm typecheck
```

真实结果：

```text
> linghun-monorepo@0.1.0 typecheck F:\Linghun
> tsc -b tsconfig.json
```

退出码：0。

### 3. Check

命令：

```bash
corepack pnpm check
```

真实结果：

```text
> linghun-monorepo@0.1.0 check F:\Linghun
> biome check .

Checked 103 files in 414ms. No fixes applied.
Found 1 warning.
```

说明：warning 为既有 `packages/tui/src/model-doctor-runtime.test.ts:91:9 suppressions/unused`，非 D.11B 改动引入；命令退出码为 0。

### 复审说明

按用户最新要求，已停止单独 verifier/agent 复审；本报告中的验证结论来自本轮主会话内的自检命令与人工自查。未声明独立 verifier PASS。

### 4. Diff whitespace

命令：

```bash
git diff --check
```

真实结果：无输出，退出码 0。

---

## 测试覆盖映射

| 要求 | 覆盖 |
|---|---|
| Windows taskkill args `/pid <pid> /t` and force adds `/f` | `process-guard.test.ts` |
| Unix detached/process-group child uses negative pid | `process-guard.test.ts` |
| Unix non-detached child falls back to child.kill | `process-guard.test.ts` |
| repeated stop idempotent | `process-guard.test.ts` |
| guard failure does not throw and records failure | `process-guard.test.ts` |
| tracked registry cleanup removes exited child | `process-guard.test.ts` |
| exit cleanup is best-effort and documented | `process-guard.test.ts` |
| SIGTERM handler calls cleanup and preserves termination intent | `process-guard.test.ts` |
| installProcessGuardExitHandlers remains idempotent | `process-guard.test.ts` |
| beforeExit / exit best-effort note remains accurate | `process-guard.test.ts` |
| verification cancel uses guard path and keeps cancelled non-PASS | `index.test.ts` |
| verification timeout uses graceful then force guard path and keeps timeout non-PASS | `index.test.ts` |
| generic command timeout uses guard without changing result | `index.test.ts` |
| native runner doctor/report exposes process guard contract | `runner-runtime.test.ts` |
| stopRunnerForDurableJob still sends runner stop --id, not naked kill | `runner-runtime.test.ts` |

---

## 参考核对

- 本阶段实际读取 Linghun 文档：`docs/delivery/pre-smoke-slice-d11a-process-guard-design-audit.md`。
- 本阶段实际读取源码：`index.ts`、`runner-runtime.ts`、`runner-runtime.test.ts`、`job-runtime.ts`、`index.test.ts`、`job-runner-presenter.ts`。
- 本阶段未参考外部 CCB / CCB Dev Boost / 社区项目源码。
- 本阶段实现为 Linghun 自研最小 ProcessGuard；未复制可疑源码实现、反编译痕迹、内部 API、专有遥测或内部服务逻辑。

---

## 成品级结构化 handoff packet

```yaml
completed_slice: D.11B
next_slice: pre-smoke follow-up / real native runner smoke when explicitly approved
files_changed:
  - packages/tui/src/index.ts
  - packages/tui/src/index.test.ts
  - packages/tui/src/job-runner-presenter.ts
  - packages/tui/src/job-runtime.ts
  - packages/tui/src/runner-runtime.ts
  - packages/tui/src/runner-runtime.test.ts
files_created:
  - packages/tui/src/process-guard.ts
  - packages/tui/src/process-guard.test.ts
  - docs/delivery/pre-smoke-slice-d11b-process-guard-implementation.md
forbidden_preserved:
  - no native addon / node-gyp / napi-rs
  - no second runner/job system
  - no provider/model loop changes
  - no job state machine semantic changes
  - no verification PASS/partial semantic changes
  - no real smoke claim
  - no Windows Job Object orphan cleanup proof claim
completed_capabilities:
  - active verification cancel/timeout cleanup improved through ProcessGuard
  - generic shell:false timeout cleanup improved through ProcessGuard
  - in-process tracked registry with best-effort normal-exit cleanup
  - native runner process guard contract documented in doctor/report helpers
  - stale recovery avoids naked historical PID kill and uses runner stop --id when verifiable
verification:
  vitest: "PASS: 3 files, 224 tests"
  typecheck: "PASS"
  check: "PASS with one existing warning in model-doctor-runtime.test.ts"
  diff_check: "PASS"
  real_smoke: "not run"
index_status:
  project: F-Linghun
  status: ready
  nodes: 2077
  edges: 4491
permission_mode: default
model_provider: claude-sonnet-4-6 via Claude Code
budget_notes: "No dependency/config changes; no native binary work; no real smoke."
```
