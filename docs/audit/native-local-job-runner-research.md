# Native Local Job Runner / Process Supervisor Research + Prototype

## 状态

- 性质：Phase 17A 旁路研究 + 独立 prototype。
- 目标：评估 Linghun Phase 17A 是否适合接入 Native Local Job Runner / Process Supervisor，并验证 Linghun-managed native runner 能否作为低资源多 agent/job 底座。
- 结论口径：这是 17A 接入建议，不是当前接入。
- Runtime 接入：未接入 Linghun runtime。
- 主链路影响：未修改现有 TUI / provider / permission / evidence / agent / job 主链路。
- 阶段状态：不是 Phase 17A 完成，不是 smoke-ready，不是 open-source-ready。
- 验证口径：本轮不执行真实 smoke，不提交 commit。

## 读取与核对范围

本轮已按要求读取 / 核对：

- `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/phase-15-5b-resource-task-lifecycle.md`
- `docs/delivery/README.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md` 中 Phase 17 摘要
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/tools/src/index.ts`
- `packages/tools/src/index.test.ts`
- `packages/core/src/session.ts`

codebase-memory 索引状态：`F-Linghun` ready。索引查询对部分具体符号无结果后，降级为 targeted source read/search 确认。

## Source-Level Reality Check

### 1. 当前 Node runner / background task / resource guard 已有什么

当前实现已经具备 Phase 15.5B 的本地任务生命周期地基：

- `BackgroundTaskState` 位于 `packages/tui/src/index.ts`，支持 `bash | verification | compact | agent | job | mcp | index` kind。
- background status 已包含 `running / paused / completed / failed / cancelled / timeout / stale`。
- background 字段包含 `heartbeatIntervalMs`、`staleAfterMs`、`lastOutputAt`、`logPath`、`outputPath`、`userVisibleSummary`、`nextAction`。
- `packages/core/src/session.ts` 已记录 `background_task_update` transcript event，并同步 background kind/status/result 类型。
- Resource Guard Lite 已有：前台模型请求并发 1、background active global cap 4、kind cap（`bash=1`、`verification=1`、`index=1`、`agent=3`）、`verification/index/agent/bash` heavy task 互斥。
- `refreshBackgroundLifecycle()` 基于 `lastOutputAt ?? updatedAt ?? startedAt` 和 `staleAfterMs` 把 running task 标记 stale，并提示 `/details background <id>` / `/interrupt`。
- Bash tool 位于 `packages/tools/src/index.ts`，使用 Node `spawn(command, { shell: true })`，支持 `timeoutMs`、`AbortSignal` cancel、stdout/stderr progress callback、长输出写 `.linghun/logs/tools/bash-*.log`、outcome=`completed|timeout|cancelled`。
- Bash timeout/cancel 在 Windows 下使用 `taskkill /pid <pid> /t`，force path 使用 `/f`。
- Verification runner 位于 `packages/tui/src/index.ts`，使用 Node `spawn(command, { shell: true })`，每步日志写 `.linghun/logs/verification/...`，支持 timeout/cancel，Windows 下同样使用 `taskkill /pid <pid> /t` 和 force `/f`。
- Verification / Review evidence 边界已保守：`cancelled / timeout / stale` 不生成 PASS evidence。
- `/interrupt` 先取消 active verification 或 foreground model request；否则取消最近 running background task。有 registered background `AbortController` 时发送 abort signal，没有 controller 时只保守标记 cancelled。
- Agent 路径已有 `AgentRun` 与 background task 表，但 `/fork --background` 明确同步降级，避免制造假的 running 状态；这不是 durable jobs，也不是 Phase 17A scheduler。

### 2. 当前痛点和 17A 需求

当前痛点：

- Background task 仍是 TUI session-scoped memory state，重启后不 durable。
- Bash / verification process supervision 分散在 Node helper 中，语义相似但不是统一 runner protocol。
- Node `spawn(shell: true)` 依赖平台 shell 行为；Windows 复杂进程树 cleanup 虽已有 `taskkill /t`，但仍需专门压力测试。
- Agent 后台执行当前是同步降级，不具备真实 local durable job / scheduler。
- Stale 刷新依赖 TUI 展示/守门路径，没有独立 supervisor 持续维护状态。

Phase 17A 需求：

- local durable jobs + Virtual Agent Concurrency。
- 用户可以发起多个 agent/job，但 runtime 必须按资源预算决定 queued/running/sleeping/blocked/stale，而不是无限真并发。
- agent/job 输入必须是短摘要、project facts、evidence refs、workspace cache refs、codebase-memory refs 和必要文件摘要，禁止复制完整聊天、完整源码、完整日志或完整索引结果。
- 长输出只进日志，主消息流只接收结构化摘要、风险、验证结果和 refs。
- cancel/timeout/stale/owner 死亡/heartbeat 失联不得贡献 PASS evidence。
- Windows/Linux/macOS process tree cleanup 必须可验证。
- native runner 缺失、损坏、协议不兼容或启动失败时必须 fallback 到 Node runner。

### 3. Native runner 能解决什么，不能解决什么

能解决：

- 统一本地进程监督：`start / status / stop / timeout / heartbeat`。
- stdout/stderr 持续写日志，JSON result 只返回短状态和 log path。
- timeout/cancel 后封装 graceful terminate + force kill。
- Windows/Linux/macOS process tree cleanup 可集中实现和压测。
- owner/heartbeat/state 文件可被 TUI 新会话读取，为 durable recovery 提供底座。
- 多 job 场景下，把长时间等待、日志写入和子进程清理移出 TUI 主事件流。

不能解决：

- 不能判断权限，不能绕过 Start Gate 或 permission pipeline。
- 不能决定任务是否允许执行、是否允许 Bash、是否允许写文件或联网。
- 不能接 provider/tool loop，不能调用模型。
- 不能保存完整 prompt/chat/tool result。
- 不能写 evidence verdict，不能决定 PASS/PARTIAL/FAIL。
- 不能做 agent 分工、context packing、budget policy 或结果采纳/拒绝。
- 不能替代 TUI 的 summary-first 输出、人类确认、风险解释、`/background` 和 `/job report`。

### 4. 哪些必须留在 Linghun TUI/runtime

必须留在 Linghun TUI/runtime：

- Start Gate、permission approval、permission mode、高风险动作策略。
- Provider/model route、tool_use/tool_result loop、context builder、compact boundary。
- Evidence / verification verdict / review scope / claim-check。
- Agent role assignment、模型与工具预算、allowed tools、allowed write/bash 策略。
- Workspace Reference Cache、codebase-memory 查询、Architecture Runtime、Freshness/Web Evidence。
- 用户可见状态、doctor、handoff packet、阶段交付文档。
- native-vs-Node runner 选择、runner doctor、protocol compatibility 判断和 fallback。

### 5. 不接入当前 runtime 的边界

本轮只新增独立 prototype 与研究报告：

- 未导入或引用 `prototypes/native-runner` 到任何 existing package。
- 未修改 `package.json`、workspace、build、CI 或 scripts。
- 未修改 TUI、provider、permission、evidence、agent、job、Bash 或 verification 主链路。
- 未新增 `/doctor runner`、`/job` 命令或 runtime adapter。
- 未执行真实 smoke。

## Prototype

路径：`prototypes/native-runner/`

文件：

- `prototypes/native-runner/Cargo.toml`
- `prototypes/native-runner/src/main.rs`

语言：Rust；标准库 prototype，无外部 crate。

### 协议

命令：

```text
version
start --id <job-id> [--root <dir>] [--timeout-ms <ms>] [--heartbeat-ms <ms>] -- <command> [args...]
status --id <job-id> [--root <dir>]
stop --id <job-id> [--root <dir>]
heartbeat --id <job-id> [--root <dir>]
```

短 JSON result 示例（V1 closure 后普通 JSON result 使用 job-root relative log refs，不输出完整本地绝对路径）：

```json
{"ok":true,"protocol":"linghun-native-runner-prototype.v1","id":"demo","status":"running","pid":1234,"stdoutPath":"stdout.log","stderrPath":"stderr.log"}
```

状态文件：

```text
<root>/<job-id>/state.json
<root>/<job-id>/stdout.log
<root>/<job-id>/stderr.log
<root>/<job-id>/stop.request
```

边界：

- JSON 只传 `id/status/pid/exitCode/timeoutMs/heartbeatAt/stdoutPath/stderrPath` 等短字段。
- stdout/stderr 只写 log file，不进入 JSON result。
- 不传 prompt、聊天、源码、完整日志、API key、provider request 或 evidence。
- runner 不做权限判断；未来正式接入时只能执行 Linghun runtime 已批准的 job。

### Windows process tree cleanup

Prototype 重点覆盖 Windows：

- graceful：`taskkill /pid <pid> /t`
- force：`taskkill /pid <pid> /t /f`

Linux/macOS prototype fallback：

- `pkill -TERM/-KILL -P <pid>`
- `kill -TERM/-KILL <pid>`

注意：Unix 侧 prototype 仍不是完整 process group/session 管理；正式 Phase 17A 若接入，应创建独立 process group/session 后按 group terminate。

### 运行方式

V0 历史状态：最初研究轮次中当前环境未安装 Rust 工具链，`cargo` / `rustc` 不可用，因此 V0 当轮没有本地编译运行 prototype。

V1 hardening / closure 状态：后续已按授权安装 Rust stable，并使用 `stable-x86_64-pc-windows-gnu` 完成 prototype 编译、测试、release build 和本地 lifecycle smoke。具备 Rust 工具链后可运行：

```bash
cd prototypes/native-runner
cargo run -- version
cargo run -- start --id demo --root .runner --timeout-ms 3000 -- node -e "console.log('hello'); setTimeout(()=>{}, 1000)"
cargo run -- status --id demo --root .runner
cargo run -- heartbeat --id demo --root .runner
cargo run -- stop --id demo --root .runner
```

本报告中的 V1 验证仍只是 isolated prototype validation，不是 Linghun 真实项目 smoke。

## 一条命令安装路线建议

Phase 17A 若正式接入，应采用 Linghun-managed runtime：

1. Optional platform packages
   - `@linghun/native-runner-win32-x64`
   - `@linghun/native-runner-linux-x64`
   - `@linghun/native-runner-darwin-arm64`
   - optional dependency 缺失不导致安装失败。
2. Bundled / managed runtime
   - Linghun 只通过内部 resolver 获取 runner path。
   - runner source 标记为 `bundled | optional-package | project-local | missing | fallback-node`。
   - 默认不读取用户 PATH 上不受控同名 runner。
3. `/doctor runner`
   - 显示 ready/missing/incompatible/fallback。
   - 显示脱敏 binary path、version、protocol、source、fallback reason、last self-test。
   - 不显示完整 home path、API key、prompt、日志正文。
4. Version / protocol compatibility
   - runner `version` 返回 `{ version, protocol }`。
   - Linghun adapter pin 支持协议范围。
   - incompatible 自动 fallback Node runner。
5. Fallback Node runner
   - native missing/crash/protocol mismatch/start failure 时 fallback 到现有 Node spawn path。
   - fallback 保留 `cancelled / timeout / stale` 非 PASS 口径。

## Windows / Linux / macOS 打包可行性

- Windows：可行，收益最大；重点是 `taskkill /t` 清理 shell -> child -> grandchild，另需签名、杀软误报、中文/空格路径测试。
- Linux：可行；正式版应使用 process group/session，验证 shell 子进程树、权限不足和 zombie 处理。
- macOS：可行；除 process group/session 外，还需评估 notarization、quarantine、Gatekeeper 体验。
- npm 分发：推荐 optional platform packages；不建议 install script 编译 Rust，不建议要求系统服务。

## Benchmark / Stress 设计

正式接入前必须做独立 benchmark/stress，不跑真实 provider，不跑真实项目 smoke。

- 多 job 并发：N=1/2/4/8/16，观察 CPU/RSS、state update latency、TUI status latency；超过 Linghun cap 的 job 不应真实运行。
- 大 stdout/stderr：10MB / 100MB；验证 JSON 不含完整日志、主屏只显示摘要和路径。
- cancel/timeout：job 忽略 TERM 或生成 child/grandchild；验证 graceful -> force，最终状态为 cancelled/timeout，不产生 PASS。
- stale heartbeat：模拟 runner 卡住或 state 不更新；Linghun 根据 `heartbeatAt` 标记 stale，并只给恢复/查看日志/取消建议。
- process tree cleanup：Windows 必测 `cmd /c`、PowerShell、Node child/grandchild；Unix 必测 shell -> child -> grandchild + process group。
- TUI 前台不卡顿：前台模型请求期间查询 background status；大日志 job 并发期间连续输入 `/background`、`/status`、普通自然语言。

## Phase 17A 接入条件

建议满足以下条件再接入：

1. Rust runner 在 Windows / Linux / macOS 均能编译运行。
2. Windows process tree cleanup 压测通过。
3. 大 stdout/stderr 不进入 JSON、不进入主屏、不阻塞 TUI。
4. Runner protocol 固定为短 JSON，带 protocol version 和 compatibility check。
5. Node fallback adapter 设计完成，并有 missing/incompatible/crash fallback tests。
6. `/doctor runner` 设计完成，能展示脱敏 path/version/protocol/source/fallback reason。
7. Phase 17A scheduler 明确 runner 只执行已批准 job，不做权限判断。
8. Evidence boundary tests 明确 cancelled/timeout/stale/runner crash 不产生 PASS evidence。
9. Benchmark 证明 native runner 在多 job、日志、cancel/timeout 或 process cleanup 上相对 Node runner 有明确收益。

## 不接入条件

以下任一情况成立，不建议接入 native runner：

- Windows process tree cleanup 不能稳定优于现有 Node `taskkill /t` 路径。
- 需要用户手动安装 Rust/Go、下载 exe、配置 PATH 或启动服务。
- runner protocol 需要传完整日志、完整 prompt、完整聊天、源码片段或 API key。
- runner 开始承接权限、provider/tool loop、evidence verdict 或 agent 分工。
- native 缺失/协议不兼容时不能自动 fallback Node runner。
- benchmark 不能证明收益，只增加发布复杂度。
- 打包/签名/杀软/平台兼容成本超过 Phase 17A local durable jobs 的实际收益。

## 接入建议

建议：Phase 17A 可以把 Native Local Job Runner / Process Supervisor 作为候选核心底层增强，但必须先完成独立 benchmark 与 packaging spike，再决定是否正式接入。

推荐形态：

- Linghun TUI/runtime 继续是唯一权限、调度、evidence 和用户交互中枢。
- Phase 17A scheduler 生成 approved job spec 后，调用 runner `start`。
- Runner 返回短 JSON + log paths；TUI 映射回 `BackgroundTask` / job report。
- `/background` / `/job report` 读取 Linghun 状态表，必要时读取 runner short state 或 bounded log slice。
- native runner 缺失/失败时自动 fallback Node runner，并通过 `/doctor runner` 显示原因。

不建议在当前 Phase 15.5 / Phase 16 期间接入。当前最多保留本报告和 isolated prototype 作为 Phase 17A 开工前证据输入。

## V1 Hardening 追加记录

### 状态

- 性质：Phase 17A 旁路底座增强；仍是独立 prototype hardening。
- Runtime 接入：未接入 Linghun runtime。
- 主链路影响：未修改 TUI / provider / permission / evidence / agent / job 主链路。
- 阶段口径：不是 Phase 17A 完成，不是 Beta PASS，不是 smoke-ready，不是 open-source-ready。
- 提交口径：本轮未提交 commit。

### Rust 工具链

本轮因本机初始 `cargo` / `rustc` / `rustup` 不在 PATH，按授权安装 Rust stable：

- 安装方式：`rustup-init.exe`，来源 `https://win.rustup.rs/x86_64`，minimal profile。
- 已安装版本：`cargo 1.95.0 (f2d3ce0bd 2026-03-21)`；`rustc 1.95.0 (59807616e 2026-04-14)`。
- MSVC toolchain：`stable-x86_64-pc-windows-msvc` 安装成功，但本机缺少 Visual Studio C++ Build Tools / Windows SDK linker prerequisites，`cargo test` 链接阶段失败，错误指向 `link.exe` / `kernel32.lib` 等依赖缺失。
- 验证用 toolchain：追加安装 `stable-x86_64-pc-windows-gnu`，并安装 `rustfmt` / `clippy` 组件，用于本轮 prototype 编译、测试和 release build。

这只是本机开发验证工具链，不改变未来 Linghun managed runtime 口径；未来用户不应被要求手动安装 Rust/Go、下载 exe、配置 PATH 或启动服务。

### V1 hardening 内容

本轮只修改 `prototypes/native-runner/src/main.rs`，保持 `Cargo.toml` 无外部依赖，未接入 workspace。

已补强：

- Job id 边界：限制长度 `1..=64`，仅允许 ASCII letters / digits / `_` / `-`，拒绝路径分隔符、`.`、空格、冒号、Unicode、控制字符，以及 Windows reserved device names（`CON` / `PRN` / `AUX` / `NUL` / `COM1..9` / `LPT1..9`）。
- Root/path 处理：相对 root 解析到当前工作目录，start 时创建并 canonicalize root，拒绝非目录 root；job path 必须保持在 root 下。
- Duplicate job lock：新增 `<root>/<job-id>/job.lock`，用 atomic `create_new(true)` 防止同 id 并发 start 覆盖 state/log；终态后 best-effort 删除 lock。
- Missing stop 行为：`stop` 对 missing job 返回短 JSON `status:"missing"`，不再创建空 job 目录。
- State 写入：`state.json.tmp.<pid>.<timestamp>` 唯一临时文件，同目录写入、flush、`sync_all` 后 rename；避免固定 `state.json.tmp` 并发碰撞。
- Log drain：stdout/stderr reader thread 改为返回 join handle；child terminal/timeout/cancel 后先等待日志 flush，再写 terminal state / result JSON。
- JSON escaping：补齐 quote、backslash、newline、carriage return、tab、backspace、form feed 和其他 ASCII control chars 的 JSON 转义。
- 错误输出：错误字符串进入 JSON 前做短上限截断，避免长错误污染主协议。
- 单元测试：新增 8 个 Rust unit tests，覆盖 parser、invalid args、job id、JSON escaping、path/root、missing stop/status 不建目录、state repeated write、duplicate lock。

仍保持：

- `start` 打印 initial `running` JSON 后在同一 runner process 内 supervision，直到 terminal state；这仍不是 durable daemon / scheduler。
- stdout/stderr 只进 log file；JSON 只包含短字段与 log path refs。
- Runner 不读取 prompt、聊天、源码、完整日志、API key、provider request 或 evidence verdict。
- Runner 不判断权限，不调用 provider/tool loop，不做 agent 分工，不产生 PASS/PARTIAL/FAIL。

### V1 验证记录

构建与静态检查：

- `cargo +stable-x86_64-pc-windows-gnu fmt -- --check`：PASS。
- `cargo +stable-x86_64-pc-windows-gnu clippy -- -D warnings`：PASS。
- `cargo +stable-x86_64-pc-windows-gnu test`：PASS，8 passed / 0 failed。
- `cargo +stable-x86_64-pc-windows-gnu build --release`：PASS。
- `cargo +stable-x86_64-pc-windows-gnu run -- version`：PASS，返回 protocol `linghun-native-runner-prototype.v1`、version `0.1.0`。
- `cargo check`（MSVC toolchain，不链接）：PASS。
- `cargo test`（MSVC toolchain）：PARTIAL / environment blocker；源码编译通过但链接失败，本机缺少 VS C++ Build Tools / Windows SDK linker prerequisites，未作为代码失败处理。

Protocol / lifecycle checks：

- quick start/status/heartbeat/stop-missing：PASS。
  - quick command 完成后 state=`completed`。
  - heartbeat 返回短 JSON。
  - missing stop 返回 `status:"missing"`，不创建 job 目录。
- timeout：PASS。
  - PowerShell long sleep 在 `timeout-ms=1000` 下终止，state=`timeout`，exitCode=1。
- stop/cancel：PASS。
  - 后台启动 long sleep，`stop` 返回 `stop_requested`，最终 state=`cancelled`。
- duplicate id：PASS。
  - 同 id active job 期间二次 `start` 返回 `status:"duplicate"`，未覆盖 active job；stop 后最终 state=`cancelled`。
- large stdout/stderr：PASS。
  - Node 生成 stdout 10,485,760 bytes、stderr 10,485,760 bytes。
  - Runner JSON output 文件约 609 bytes，只包含短 running/result JSON 与 log path，不包含完整日志正文。
- multi-job benchmark：PASS（prototype-level observation，不代表 Phase 17A scheduler）。
  - N=1：约 2624.74 ms。
  - N=2：约 3072.64 ms。
  - N=4：约 3231.08 ms。
  - N=8：约 5793.31 ms。
- Windows process tree timeout：PARTIAL/PASS by case。
  - Node child process tree timeout：PASS；记录 child pid，timeout 后 child 不存活。
  - `cmd.exe /c powershell ...` timeout：PASS；terminal state=`timeout`。
  - PowerShell encoded child stress：PARTIAL；命令 quoting 在手工 stress 中失败，未形成有效 child pid 文件，因此不作为 cleanup 证明。

### V1 residual risks

- Unix/macOS 仍是 prototype-grade `pkill -P` + `kill`，不是正式 process group/session cleanup。
- Duplicate lock 不做 stale lock stealing；V1 选择保守拒绝，恢复/清理策略应留给未来 adapter/doctor。
- `start` 仍是 blocking supervisor process，不是 durable daemon/service；Phase 17A 仍需 scheduler、owner、recovery、resource cap、handoff、report。
- MSVC toolchain 在本机链接不可用，Windows MSVC release path 需在具备 Visual Studio C++ Build Tools / Windows SDK 的环境复核；本轮使用 GNU toolchain 完成 prototype 验证。

### V1 接入建议更新

V1 hardening 后，native runner 作为 Phase 17A 候选底座的可评估性提高：短 JSON、日志落盘、duplicate id、state 原子写、cancel/timeout、Windows `taskkill /t` 和基础 stress 已有本地证据。

V1 closure 后，普通 JSON result / persisted state 的 `stdoutPath` / `stderrPath` 已收口为 job-root relative refs（`stdout.log` / `stderr.log`），不再输出完整本地绝对路径。正式 adapter / doctor / main screen 仍必须继续保持脱敏路径口径，不展示完整 home/project 私有路径。

但仍不建议在 Phase 15.5 / Phase 16 接入，也不能宣布 Phase 17A ready。正式接入前仍必须补：managed binary packaging、protocol compatibility、adapter fallback tests、doctor runner、Unix/macOS process group/session、Windows MSVC/签名/杀软/中文路径矩阵、以及与 Phase 17A scheduler/evidence/resource guard 的边界测试。

## V1 Closure Tightening 追加记录

### 状态

- 性质：Phase 17A 旁路收尾；只收口 V1 prototype / report 明显遗留。
- Runtime 接入：未接入 Linghun runtime。
- 主链路影响：未修改 TUI / provider / permission / evidence / agent / job 主链路。
- 阶段口径：不是 Phase 17A 完成，不是 Beta PASS，不是 smoke-ready，不是 open-source-ready。
- 提交口径：本轮未提交 commit。

### 修改文件清单

- `prototypes/native-runner/src/main.rs`
- `docs/audit/native-local-job-runner-research.md`

未修改 `package.json`、`pnpm-workspace.yaml`、`tsconfig.json`、主构建脚本，未在 `packages/` / `apps/` 引用 native runner，未新增 `/doctor runner`、`/job` 或 runtime adapter。

### Closure tightening 内容

- 修正 V0 运行方式口径：旧的“当前环境未安装 Rust 工具链，因此没有本地编译运行 prototype”已明确标为 V0 历史状态；V1 hardening / closure 已安装 Rust stable，并使用 GNU toolchain 完成验证。
- 路径输出相对化：普通 JSON result 与 `state.json` 中的 `stdoutPath` / `stderrPath` 改为 `stdout.log` / `stderr.log`，不再输出完整本地绝对路径；stdout/stderr 正文仍只写 log file，不进入 JSON。
- Heartbeat 持久化：`heartbeat` 对 running state 更新 persisted `heartbeatAt`；对 terminal state 不改变 status / state；missing job 返回 `status:"missing"` 且不创建 job 目录。
- 测试补齐：Rust unit tests 从 8 个增加到 12 个，新增覆盖 relative log refs、running heartbeat persisted update、terminal heartbeat no mutation、missing heartbeat no directory creation。

### Closure 验证记录

启动检查：

- `git status --short`：PASS；当前 native runner 相关变更仍在 untracked prototype/report 范围内，另有无关 untracked `docs/audit/fast-workspace-scanner-feasibility-design.md`。
- `C:\Users\Admin\.cargo\bin\cargo.exe --version`：`cargo 1.95.0 (f2d3ce0bd 2026-03-21)`。
- `C:\Users\Admin\.cargo\bin\rustc.exe --version`：`rustc 1.95.0 (59807616e 2026-04-14)`。
- codebase-memory index：`F-Linghun` ready。

验证命令：

- `cargo +stable-x86_64-pc-windows-gnu fmt -- --check`：PASS。
- `cargo +stable-x86_64-pc-windows-gnu clippy -- -D warnings`：PASS。
- `cargo +stable-x86_64-pc-windows-gnu test`：PASS，12 passed / 0 failed。
- `cargo +stable-x86_64-pc-windows-gnu build --release`：PASS。
- `cargo +stable-x86_64-pc-windows-gnu run -- version`：PASS，返回 protocol `linghun-native-runner-prototype.v1`、version `0.1.0`。
- `git diff --check`：PASS。
- start/status/heartbeat/stop smoke：PASS。
  - initial running JSON：`stdoutPath:"stdout.log"`、`stderrPath:"stderr.log"`。
  - status JSON：`stdoutPath:"stdout.log"`、`stderrPath:"stderr.log"`。
  - heartbeat 更新 running state 的 persisted `heartbeatAt`。
  - stop 返回 `stop_requested`，最终 state=`cancelled`。
  - missing stop 返回 `status:"missing"`。

### V1 candidate closure verdict

V1 candidate closure：YES，作为独立 prototype / report 级别的 Phase 17A evaluation input 已收口。

该 verdict 仅表示 V1 prototype/report 明显遗留已收口，不表示 Linghun runtime 已接入，不表示 Phase 17A 完成，不表示真实项目 smoke-ready / Beta PASS / open-source-ready。

### Closure 后剩余风险

- Unix/macOS process group/session cleanup 仍未正式实现。
- Windows MSVC linker、签名、杀软误报、中文/空格路径矩阵仍需独立验证。
- Managed platform package / bundled runtime 分发尚未实现。
- `/doctor runner` 尚未实现。
- Native-vs-Node adapter fallback tests 尚未实现。
- Phase 17A scheduler / evidence / resource guard integration 尚未实现。

## 本轮产物

- 研究报告：`docs/audit/native-local-job-runner-research.md`
- Prototype：`prototypes/native-runner/`

明确未完成 / 未发生：

- 未接入 Linghun runtime。
- 未修改现有主链路。
- 未完成 Phase 17A。
- 未执行真实 smoke。
- 未宣布 smoke-ready / open-source-ready。
- 未提交 commit。
