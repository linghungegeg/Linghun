# Slice D.11A — Long-Task Process Guard Design Audit

> 日期：2026-05-25
> 范围：审计 Linghun 当前 long-task/native-runner/job/background task 的进程生命周期保护，设计 Windows Job Object / cross-platform process guard 最小可行方案
> 模式：纯审计，不改代码，不 commit

---

## git status --short 真实输出

```
?? docs/delivery/pre-smoke-slice-d10i-index-extraction-final-audit.md
```

注：当前工作树干净（除一个未跟踪的文档文件），D.11A 不修改任何源码。

---

## 实际读取文件列表

| 文件 | 审计深度 |
|------|----------|
| `packages/tui/src/index.ts` | 分段精读（spawn 使用点 L9229–9279、L10740–10845、SIGINT handler L2280–2310、VERIFICATION_COMMAND_TIMEOUT_MS L494） |
| `packages/tui/src/runner-runtime.ts` | 全文精读（resolveNativeRunner、startApprovedRunnerSpec、stopRunnerForDurableJob、detached spawn） |
| `packages/tui/src/runner-runtime.test.ts` | 全文精读（resolution/fallback/terminal 测试） |
| `packages/tui/src/job-runtime.ts` | 全文精读（job 状态管理、persistence、reschedule） |
| `packages/tui/src/job-runtime.test.ts` | 全文精读（job 纯计算测试） |
| `packages/tui/src/job-runner-presenter.ts` | 全文精读（格式化、状态映射） |
| `packages/tui/src/index.test.ts` | 关键词搜索（taskkill、orphan、process guard、detached） |
| `docs/delivery/pre-smoke-slice-d9-long-task-runner-resilience.md` | 全文精读 |
| `docs/delivery/pre-smoke-slice-d10i-index-extraction-final-audit.md` | 全文精读 |

---

## 1. 当前进程启动路径

### 1.1 Native Runner Resolution（runner-runtime.ts）

| 路径 | 代码位置 | 行为 |
|------|----------|------|
| `resolveNativeRunner()` | runner-runtime.ts L139–244 | 解析 bundled/project-local runner 二进制，检查 exists + executable + version + protocol |
| `startApprovedRunnerSpec()` | runner-runtime.ts L424–517 | 当 resolution="available" 时 spawn native runner |
| spawn 调用 | runner-runtime.ts L462–468 | `spawn(command, args, { cwd, detached: true, stdio: "ignore", windowsHide: true })` + `child.unref()` |

**关键特征**：
- 使用 `detached: true` — 子进程在新的 process group 中运行
- 使用 `child.unref()` — 父进程不等待子进程退出
- 使用 `stdio: "ignore"` — 无 pipe 连接

### 1.2 Node Fallback Runner（runner-runtime.ts）

当 native runner 不可用时，`startApprovedRunnerSpec()` 返回 `{ status: "node_fallback", adapter: "node" }`。此路径不 spawn 外部进程，job 由 TUI 主进程内的 durable job 状态机管理。

### 1.3 Verification Command Runner（index.ts L10740–10825）

| 路径 | 代码位置 | 行为 |
|------|----------|------|
| verification command spawn | index.ts L10750 | `spawn(command, { cwd, shell: true, windowsHide: true })` |
| 无 detached | — | 子进程继承父进程 process group |
| 超时 | L10793–10799 | `VERIFICATION_COMMAND_TIMEOUT_MS = 10min` 后触发 requestStop |

### 1.4 Generic Command Runner（index.ts L9229–9279）

| 路径 | 代码位置 | 行为 |
|------|----------|------|
| generic spawn | index.ts L9231 | `spawn(command, args, { cwd, shell: false, windowsHide: true })` |
| 无 detached | — | 子进程继承父进程 process group |
| 超时 | L9245–9253 | 由调用方传入 timeoutMs，超时后 `child.kill()` |

---

## 2. 当前停止/取消/超时路径

### 2.1 停止路径表

| 场景 | 代码位置 | Windows 行为 | Unix 行为 |
|------|----------|-------------|-----------|
| **Native runner stop** | runner-runtime.ts L646–672 | `spawnSync(runner, ["stop", "--id", ...])` — 委托 native runner 自行停止 | 同左 |
| **Verification cancel** | index.ts L10786–10791 | `requestStop(false)` → `taskkill /pid <pid> /t` | `child.kill("SIGTERM")` |
| **Verification timeout** | index.ts L10793–10799 | 同 cancel，先 SIGTERM 再 1s 后 force | 同左 |
| **Verification force stop** | index.ts L10766–10768 | `taskkill /pid <pid> /t /f` | `child.kill("SIGKILL")` |
| **Generic command timeout** | index.ts L9245–9246 | `child.kill()` (SIGTERM) | `child.kill()` (SIGTERM) |
| **TUI SIGINT** | index.ts L2287 | `controller.abort()` → 触发 verification onAbort | 同左 |

### 2.2 requestStop 实现细节（index.ts L10754–10765）

```typescript
const requestStop = (force: boolean) => {
  if (process.platform === "win32" && child.pid) {
    const args = ["/pid", String(child.pid), "/t"];
    if (force) args.push("/f");
    const killer = spawn("taskkill", args, { windowsHide: true });
    killer.on("error", () => child.kill(force ? "SIGKILL" : "SIGTERM"));
    return;
  }
  child.kill(force ? "SIGKILL" : "SIGTERM");
};
```

**Windows**：使用 `taskkill /pid <pid> /t` 杀进程树（`/t` = tree kill）
**Unix**：直接 `child.kill(signal)` — 只杀直接子进程，不杀 grandchild

### 2.3 Parent Process Exit Cleanup

| 机制 | 存在？ | 说明 |
|------|--------|------|
| `process.on('exit', cleanup)` | **否** | 无全局 exit handler 清理子进程 |
| `process.on('beforeExit', cleanup)` | **否** | 无 |
| `process.on('SIGTERM', cleanup)` | **否** | 无 |
| `process.on('uncaughtException', cleanup)` | **否** | 无 |
| SIGINT handler | 仅 abort controller | 只中断当前 model 请求，不清理 spawned 进程 |

---

## 3. 风险判断

### 3.1 Windows 孤儿进程风险

| 场景 | 风险等级 | 说明 |
|------|----------|------|
| Native runner（detached + unref） | **高** | 父进程崩溃后，detached 子进程继续运行，无人回收。native runner 自身可能再 spawn grandchild（approved task script），形成孤儿链 |
| Verification command（shell: true） | **中** | `shell: true` 在 Windows 上创建 cmd.exe 中间进程。`taskkill /t` 可以杀树，但如果父进程崩溃前未调用 requestStop，cmd.exe + 实际命令都成为孤儿 |
| Generic command（shell: false） | **低-中** | 无 detached，但如果父进程被 taskkill /f 强杀，子进程可能存活 |
| Node fallback（无外部进程） | **无** | 纯内存状态机，父进程退出即终止 |

### 3.2 Linux/macOS 当前保护状态

| 机制 | 状态 | 说明 |
|------|------|------|
| Process group kill（`kill(-pid)`） | **未实现** | 当前 Unix 路径只 `child.kill(signal)`，不杀 process group |
| Session group（setsid） | **未使用** | 无 setsid 调用 |
| detached spawn（native runner） | **已使用** | 但 detached 在 Unix 上创建新 session leader，反而使 parent 更难清理 |
| prctl PR_SET_PDEATHSIG | **未使用** | Linux 特有，需 native addon |

### 3.3 测试验证范围

| 测试内容 | 验证的是什么 | 不验证什么 |
|----------|-------------|-----------|
| D.9 "Windows mock runner cancel/timeout cleanup" | stop 命令下发到 mock runner | 不验证 taskkill /t 系统调用实际杀进程树 |
| runner-runtime.test.ts terminal states | 状态标记正确性 | 不验证进程实际被终止 |
| index.test.ts "continues denied model tool permission without orphaning sibling tool calls" | tool call 逻辑层面不遗漏 | 不验证 OS 级进程孤儿 |

**结论**：当前测试验证的是"stop 命令被正确下发"和"状态被正确标记"，不验证系统级孤儿进程清理。

### 3.4 已做好 vs 只是 mock/fallback

| 能力 | 状态 |
|------|------|
| Windows taskkill /t 进程树杀 | **已实现**（verification command 路径） |
| Native runner stop 命令 | **已实现**（委托 runner 自行停止） |
| 超时后 graceful → force 两阶段停止 | **已实现**（1s 延迟后 /f） |
| 父进程崩溃后自动清理 | **未实现** |
| Windows Job Object 绑定 | **未实现** |
| Unix process group kill | **未实现** |
| detached runner 的 orphan 回收 | **未实现** |
| stale job recovery 后杀残留进程 | **未实现**（只标记状态为 stale，不杀进程） |

---

## 4. Windows / Linux / macOS 差异表

| 维度 | Windows | Linux | macOS |
|------|---------|-------|-------|
| 进程树杀 | `taskkill /pid <pid> /t [/f]` | `kill(-pgid, signal)` 或 `kill(pid, signal)` | 同 Linux |
| 当前实现 | taskkill /t（仅 verification 路径） | child.kill(signal)（仅直接子进程） | 同 Linux |
| 父崩溃后孤儿 | 子进程存活，无自动回收 | 子进程 reparent 到 init/systemd | 同 Linux |
| OS 级 process guard | Job Object（绑定后父退出自动杀子） | prctl PR_SET_PDEATHSIG（Linux only） | 无等价机制 |
| detached 行为 | 新 console group | 新 session leader（setsid） | 同 Linux |
| shell: true 中间进程 | cmd.exe | /bin/sh | /bin/sh |

---

## 5. D.11B 推荐最小实现方案

### 5.1 Windows Job Object 方案

**问题**：Node.js 原生 API 不支持 Windows Job Object。需要以下方式之一：

| 方案 | 可行性 | 复杂度 | 说明 |
|------|--------|--------|------|
| A. Native addon（node-gyp / napi-rs） | 高 | 高 | 编写 C++/Rust addon 调用 CreateJobObject + AssignProcessToJobObject |
| B. Native runner 承担 process guard | **推荐** | 中 | native runner 二进制自身创建 Job Object，将 supervised 子进程绑定到 Job Object |
| C. 外部 helper binary | 中 | 中 | 独立的 `linghun-process-guard.exe` 小工具 |
| D. Node fallback: taskkill /t + stale recovery | 已有 | 低 | 不能防父崩溃孤儿，但覆盖主动 cancel/timeout |

**推荐方案 B**：
- Native runner 已经是 Linghun 的 platform-specific 二进制
- Native runner 启动 approved task 时，自身创建 Job Object 并将子进程绑定
- Job Object 设置 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` — runner 退出时自动杀所有子进程
- 如果 TUI 父进程崩溃，runner 本身也是 detached 的，但 runner 可以设置自己的 heartbeat 检测（定期检查 parent PID 是否存活）
- 如果 runner 也崩溃，Job Object handle 关闭，OS 自动杀绑定的子进程

**Node fallback 下的补充**：
- 继续使用 `taskkill /pid <pid> /t` 作为主动停止手段
- 新增 `process.on('exit', cleanupTrackedChildren)` 在 TUI 正常退出时清理
- stale recovery 路径增加 "尝试 taskkill 残留 PID" 逻辑（best-effort，PID 可能已被复用）

### 5.2 Linux/macOS 方案

| 方案 | 说明 |
|------|------|
| Process group kill | 对非 detached 子进程：spawn 时不设 detached，cancel/timeout 时使用 `process.kill(-child.pid, signal)` 杀整个 process group |
| Native runner 自管理 | 对 detached native runner：runner 自身使用 `setsid()` + 将子进程放入自己的 process group，runner 退出时 kill group |
| Parent death detection | Linux: native runner 可用 `prctl(PR_SET_PDEATHSIG, SIGTERM)` 让内核在父死时发信号。macOS 无等价，需 kqueue EVFILT_PROC |

**推荐**：
- Verification command 路径：去掉 `shell: true`（避免中间 sh 进程），或保留 shell 但 cancel 时使用 `process.kill(-child.pid, signal)`
- Native runner 路径：runner 自身负责 process group 管理，与 Windows Job Object 对称

### 5.3 统一 Process Guard 接口

```typescript
// 最小接口设计（D.11B 实现目标）
interface ProcessGuard {
  /** 将子进程绑定到 guard（Windows: Job Object, Unix: process group tracking） */
  attach(childPid: number): void;
  /** 请求停止所有 guarded 进程 */
  requestStop(force: boolean): void;
  /** guard 是否可用（native runner 提供 vs Node fallback） */
  readonly available: boolean;
  /** 平台实现类型 */
  readonly kind: "job_object" | "process_group" | "taskkill_fallback" | "signal_fallback";
}
```

### 5.4 实现边界

| 层 | D.11B 应做 | D.11B 不应做 |
|----|-----------|-------------|
| runner-runtime.ts | 新增 ProcessGuard 接口定义 + factory | 不改 startApprovedRunnerSpec 的 spawn 逻辑 |
| runner-runtime.ts | stopRunnerForDurableJob 增加 guard.requestStop 调用 | 不引入第二套 runner 系统 |
| index.ts | verification command 路径增加 process group kill（Unix） | 不重写 requestStop |
| index.ts | 新增 `process.on('exit', ...)` 清理 tracked children | 不改 SIGINT handler 语义 |
| native runner spec | 文档化 Job Object 要求（runner 实现者参考） | 不在 D.11B 实现 native runner 二进制 |
| 测试 | mock guard attach/requestStop/fallback | 不做真实 Job Object orphan cleanup 验证 |

---

## 6. D.11B 不应触碰的边界

| 禁止项 | 原因 |
|--------|------|
| 不引入 native addon（node-gyp / napi-rs） | Job Object 由 native runner 二进制承担，不在 Node 层实现 |
| 不创建第二套 runner/job 系统 | 复用现有 runner-runtime + job-runtime |
| 不修改 detached spawn 语义 | native runner 需要 detached 才能独立于 TUI 生命周期 |
| 不做 native runner 二进制分发/签名 | 属于后续 Phase |
| 不做 daemon supervision | 超出 process guard 范围 |
| 不修改 job 状态机核心逻辑 | 只在 stop/cancel 路径增加 guard 调用 |
| 不做 PID 文件持久化 | stale recovery 的 PID 回收是 best-effort，不保证正确性 |
| 不做跨 session 进程追踪 | 超出最小可行范围 |

---

## 7. 测试计划

### 7.1 单元测试（mock 级别）

| 测试 | 验证内容 |
|------|----------|
| `ProcessGuard factory returns correct kind per platform` | win32 → job_object/taskkill_fallback, linux/darwin → process_group/signal_fallback |
| `guard.attach(pid) tracks pid` | 内部 tracked set 包含 pid |
| `guard.requestStop(false) sends graceful stop` | Windows: 调用 taskkill /t, Unix: kill(-pid, SIGTERM) |
| `guard.requestStop(true) sends force stop` | Windows: taskkill /t /f, Unix: kill(-pid, SIGKILL) |
| `guard.available reflects native runner presence` | native runner available → guard.available=true |
| `guard unavailable falls back gracefully` | guard.available=false → 使用 signal_fallback/taskkill_fallback |
| `repeated requestStop is idempotent` | 多次调用不 throw，不重复杀 |
| `process exit handler calls guard.requestStop` | process.on('exit') 触发清理 |
| `guard failure degrades gracefully` | attach/requestStop throw 时不崩溃 TUI |

### 7.2 集成测试（D.9 风格 mock runner）

| 测试 | 验证内容 |
|------|----------|
| `cancel with guard available sends guarded stop` | native runner 可用时，cancel 路径调用 guard.requestStop |
| `timeout with guard available sends guarded stop` | 超时路径同上 |
| `runner native guard available path` | startRunnerForDurableJob 时 guard.attach 被调用 |
| `runner guard unavailable fallback path` | native runner 不可用时，fallback 到 taskkill/signal |
| `stale recovery attempts cleanup of tracked PIDs` | stale 检测后尝试 requestStop（best-effort） |

### 7.3 真实 smoke 验证（D.11B 不做，需后续 Windows 真机）

| 验证项 | 需要环境 |
|--------|----------|
| Job Object 绑定后父崩溃，子进程被 OS 自动杀 | Windows 真机 + native runner 二进制 |
| taskkill /t 杀 cmd.exe + grandchild | Windows 真机 + shell: true spawn |
| process group kill 杀 sh + grandchild | Linux/macOS 真机 |
| detached runner 的 parent death detection | 真机 + native runner |

---

## 8. 已有能力 vs 缺口总结

| 能力 | 状态 | 缺口 |
|------|------|------|
| 主动 cancel/timeout 停止子进程 | ✅ 已实现 | Unix 只杀直接子进程，不杀 process group |
| Windows taskkill /t 进程树杀 | ✅ 已实现（verification 路径） | native runner stop 路径未使用 taskkill |
| 两阶段 graceful → force | ✅ 已实现 | — |
| 父进程正常退出时清理 | ❌ 未实现 | 需 process.on('exit') handler |
| 父进程崩溃时清理 | ❌ 未实现 | 需 Job Object（Win）/ parent death signal（Linux） |
| detached runner 孤儿回收 | ❌ 未实现 | 需 runner 自身 heartbeat + parent alive check |
| Unix process group kill | ❌ 未实现 | 需 kill(-pid, signal) |
| stale recovery 杀残留进程 | ❌ 未实现 | 需 PID tracking + best-effort kill |
| ProcessGuard 统一接口 | ❌ 未实现 | D.11B 目标 |

---

## 9. 参考核对

- 本阶段实际读取了 `packages/tui/src/` 下 runner-runtime.ts、job-runtime.ts、job-runner-presenter.ts、index.ts（关键段）、index.test.ts（关键词搜索）、runner-runtime.test.ts、job-runtime.test.ts。
- 本阶段实际读取了 `docs/delivery/pre-smoke-slice-d9-long-task-runner-resilience.md` 和 `docs/delivery/pre-smoke-slice-d10i-index-extraction-final-audit.md`。
- 未参考外部 CCB / CCB Dev Boost / 社区项目文件（本切片为纯内部审计）。
- 明确说明未复制可疑源码实现。

---

## 未真实 smoke

本切片为纯设计审计，未执行任何代码修改，未运行测试，未启动真实 TUI。

## 未证明 Job Object orphan cleanup

Windows Job Object 的孤儿进程自动清理需要：
1. 真实 native runner 二进制（当前不存在）
2. 真实 Windows 环境 spawn + 父进程强杀
3. 验证子进程确实被 OS 回收

这些在 D.11B 的 mock 测试中无法证明，需要后续真实 Windows smoke 环境。

## 未 Beta PASS / smoke-ready / open-source-ready

---

## Handoff Packet

```yaml
completed_slice: D.11A
next_slice: D.11B (Process Guard 最小实现)
files_changed: []  # 纯审计，无代码改动
files_created:
  - docs/delivery/pre-smoke-slice-d11a-process-guard-design-audit.md
forbidden:
  - 不引入 native addon
  - 不创建第二套 runner/job 系统
  - 不修改 detached spawn 语义
  - 不做 native runner 二进制分发/签名
  - 不做 daemon supervision
  - 不做 PID 文件持久化
  - 不做跨 session 进程追踪
d11b_scope:
  - ProcessGuard 接口定义 + platform factory
  - process.on('exit') tracked children cleanup
  - Unix verification command 路径增加 process group kill
  - stopRunnerForDurableJob 增加 guard.requestStop
  - stale recovery best-effort PID cleanup
  - 9 个单元测试 + 5 个集成测试
  - 文档化 native runner Job Object 要求
verification:
  tests: 未运行（纯审计）
  typecheck: 未运行（纯审计）
  real_smoke: 未执行
index_status: not refreshed
permission_mode: default
model: N/A (no provider calls)
budget: 0 files modified, 1 doc created, 0 tests, 0 dependencies
```
