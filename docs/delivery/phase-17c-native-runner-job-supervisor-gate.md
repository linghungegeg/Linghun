# Phase 17C Native Runner / Job Supervisor Gate 第一版

## 阶段目标

Phase 17C 本轮只完成 Native Runner / Job Supervisor Gate 第一版：Runner Resolver、最小 Runner Adapter、Node/TUI fallback、`/doctor runner`、durable job supervisor 状态写回、报告/日志/背景任务可见性、non-PASS evidence 边界，以及 Windows/中文/空格路径 focused test 覆盖。

本阶段不进入 Phase 18，不实现 Fast Workspace Scanner，不执行真实全量 smoke，不宣布 Beta PASS / smoke-ready / open-source-ready。Native Runner 不替代 Node/TUI 默认短任务路径，也不成为第二套 provider/tool/permission/evidence/MCP/index/agent/job runtime。

## Source-Level Reality Check 摘要

### Existing implementation

- codebase-memory 索引项目 `F-Linghun` 可用；本轮用索引/变更检测缩小范围后，再精读源码和交付文档确认。
- Phase 17A 已有 `/job` durable job、本地 bounded worker loop、`DurableJobState`、`BackgroundTaskState(kind='job')`、resource guard、handoff recovery、log/report/full-output artifact、verification/evidence non-PASS 边界。
- Phase 17B 已有 `/remote`，且报告明确 Phase 17B focused validation 已闭合，可由用户决定是否进入 Phase 17C。
- `prototypes/native-runner/` 已有 Rust prototype：`version/start/status/stop/heartbeat`、协议 `linghun-native-runner-prototype.v1`、版本 `0.1.0`、短 JSON + stdout/stderr log ref 边界、Windows `taskkill /pid /t` cleanup prototype。
- `native-runner-vs-node-benchmark.md` 显示 Node spawn/raw throughput 更快；Native Runner 价值是 supervision/durability/process-tree cleanup，不是性能宣传。

### Gaps closed

- 新增 `LinghunConfig.nativeRunner`：默认 disabled，包含 `enabled/path/expectedProtocol/source/timeoutMs`，并支持 partial config deep merge/validation。
- 新增 Runner Resolver：状态 `disabled` / `unavailable` / `available` / `protocol_mismatch`；版本协议 probe bounded；missing/unreadable/mismatch 不崩 TUI。
- 新增 `/doctor runner`：summary-first、redacted path、显示 enabled、resolved path ref、version/protocol、platform、Node fallback、last error、next action、DEFERRED 边界。
- 新增最小 approved job spec：只允许 `approvedTaskKind='durable_job_supervisor'`，包含 id/cwd/env allowlist/redacted env refs/timeout/log paths/expected protocol/permission/evidence refs。
- 新增 Runner Adapter 最小 start/status/stop 路径：available 时执行 Linghun-approved long-running supervisor task，不转发 raw user command；unavailable/mismatch/start/status failure 显式进入 Node/TUI fallback。
- durable job 报告、status、primary output、background/details 输出都写入 runner summary，并可见 heartbeat/log refs；runner lifecycle completed 仍是 partial，不是 verification PASS。
- cancel/timeout/recovery/status refresh 写回 runner terminal state；cancelled/timeout/stale/failed/protocol mismatch/start/status failure 不生成 PASS evidence。
- Natural Command Bridge 增加 runner/native runner/doctor runner 关键词，help 增加 `/doctor runner`。

### Minimal touch points

- `packages/config/src/index.ts`
- `packages/config/src/index.test.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `docs/delivery/phase-17c-native-runner-job-supervisor-gate.md`

### Forbidden duplicate systems

- 未新增第二套 provider/tool/permission/evidence/MCP/index/agent/job runtime。
- 未绕过 Start Gate / permission pipeline；runner 只消费 Linghun-approved job spec。
- 未让 runner 决定 PASS / PARTIAL / FAIL。
- 未改 Phase 17A job PASS 语义：completed lifecycle 仍是 partial。
- 未改 Phase 17B remote channels。
- 未接入 Fast Workspace Scanner。
- 未进入 Phase 18 desktop。

### reference-map / 17A handoff / 17B handoff / native benchmark / prototype 裁决

- DONE：Phase 17C 限定为 Native Runner / Job Supervisor Gate；Node/TUI 仍默认。
- DONE：Runner Resolver 覆盖 disabled/unavailable/available/protocol_mismatch 与 Node fallback。
- DONE：最小 adapter 只执行 approved job spec，不执行任意用户字符串。
- DONE：`/doctor runner` redacted、summary-first、给 next action。
- DONE：durable job / background / report / log artifact / resource guard 可见 runner 状态、heartbeat 和 stdout/stderr log refs。
- DONE：runner completed 不等于 verification PASS；failed/timeout/cancelled/stale/protocol mismatch/start/status failure 不生成 PASS evidence。
- DONE：Windows 中文/空格路径作为 focused test 边界覆盖；mock runner 路径包含空格和中文目录。
- DONE（17C.A）：placeholder `node -e process.exit(0)` 已替换为 Linghun-approved long-running supervisor task，启动后先写 observable running/heartbeat，再由 status/cancel/timeout 刷新状态。
- DEFERRED：managed package / bundled binary distribution、真实 daemon/owner-death benchmark、official release signing/AV/install matrix、Unix/macOS process-group cleanup、真实 Linghun workload benchmark、长期 native heartbeat owner-death benchmark。
- NOT-DO：Fast Workspace Scanner、Phase 18 desktop、真实全量 smoke、Beta PASS/smoke-ready/open-source-ready、native runner 替代 Node 默认路径。

## 已完成功能

### Runner Resolver

新增 `nativeRunner` 配置默认关闭：

```ts
nativeRunner: {
  enabled: false,
  expectedProtocol: 'linghun-native-runner-prototype.v1',
  source: 'disabled',
  timeoutMs: 60_000,
}
```

Resolver 行为：

- disabled：返回 `disabled`，Node fallback available。
- enabled 但 path 缺失：返回 `unavailable`，主 TUI 不崩溃。
- path 存在但 version probe 失败：返回 `unavailable`。
- protocol 不匹配：返回 `protocol_mismatch`。
- protocol 匹配：返回 `available`。

输出只显示 redacted path ref，例如 `present:linghun-native-runner-mock.cjs`，不显示完整私有路径。

### Runner Adapter

新增 `ApprovedRunnerJobSpec`：

- `id`
- `approvedTaskKind: 'durable_job_supervisor'`
- `cwd`
- `envAllowlist`
- `redactedEnvRefs`
- `timeoutMs`
- `logPaths.state/stdout/stderr/jobLog/fullOutput/report`
- `expectedProtocol`
- `permissionRef`
- `evidenceRefs`
- `runnerRoot`

Adapter 支持：

- `start`：available 时调用 runner `start --id --root --timeout-ms --heartbeat-ms -- node -e <Linghun-approved supervisor task>`，启动受控 long-running lifecycle task，先写 `running`/heartbeat/log refs；不再使用 instant `process.exit(0)` placeholder。
- `status`：`/job status` / `/job report` 时 refresh native status、heartbeat 与 stdout/stderr log refs；runner 返回绝对路径、盘符路径、反斜杠路径、`..` 或疑似私有路径时只显示安全 ref / redacted basename ref。
- `stop`：`/job cancel` 时调用 runner stop，并将 runner/job 标记 cancelled，non-PASS。
- `timeout`：runner status 刷新为 timeout 时写入 durable job timeout/result timeout，仍不生成 PASS evidence。
- fallback：disabled/unavailable/protocol_mismatch/start_failed/status_failed 都显式记录 `adapter=node`、`status=node_fallback`、`fallbackReason`。

### `/doctor runner`

新增命令：

```text
/doctor runner
```

输出包含：

- native runner enabled/disabled
- resolved path ref
- version/protocol
- platform
- source
- Node fallback status
- last error
- next action
- boundary / deferred

`/help` 和 Natural Command Bridge 已增加 runner/native runner 入口。

### Job Supervisor integration

- `/job run` 在 job 进入 running 后启动 runner adapter，runner 监督 approved long-running lifecycle task，再继续 Phase 17A bounded worker loop。
- `/job status`、`/job report` refresh runner status、heartbeat、log refs，并写回 state/report/background。
- `/job cancel` 调用 runner stop，再走 durable job transition。
- `resumeDurableJob()` running 后启动 runner adapter。
- `recoverDurableJobForContext()` stale recovery 时同步 runner stale terminal metadata。
- `createJobBackgroundTask()` 的 `currentStep` / `userVisibleSummary` 包含 runner adapter/status/resolution/fallback，resource guard 仍把 runner-managed job 作为 existing `kind='job'` 处理。
- `writeDurableJobReport()` 增加 runner line 和 approved spec line；只写 log refs 和 redacted path，不写完整 env、secret、source、transcript。

### Evidence boundary

- runner lifecycle completed 只代表 lifecycle completed，不代表 verification PASS。
- job completed 仍映射 background result `partial`。
- cancelled / failed / timeout / stale / unavailable / protocol mismatch / start_failed / node_fallback 不创建 PASS evidence。
- runner 不调用 provider/tool loop，不创建 evidence verdict，不改变 local permission pipeline。

## 使用方式

```text
/doctor runner
/job run <goal> --tokens 50000 --timeout 60000
/job status <job-id>
/job report <job-id>
/job logs <job-id>
/job cancel <job-id>
```

17C.B 产品主路径走 bundled/internal resolver；用户不需要手动配置 prototype path。project-local/custom path 只作为开发/调试入口，例如本地验证 prototype 或 mock runner 时使用。

真实 bundled binary release artifact、package files/bin 和一条命令安装验证仍保留到 release/open-source packaging gate；当前不声明 bundled binary release PASS。

未配置、bundled candidate 缺失、不可执行或协议不匹配时无需用户操作；Node/TUI fallback 仍默认可用并显式生效。

## 涉及模块

- Config：`NativeRunnerConfig`、`NativeRunnerSource`、默认 disabled、validate/merge、focused test。
- TUI：Runner Resolver、approved job spec、adapter start/status/stop、`/doctor runner`、durable job report/background/status/cancel/recovery integration。
- Natural Command Bridge：readiness capability 增加 runner/native runner/doctor runner 关键词。
- Tests：Phase 17C focused TUI test、config merge/default test、Phase 17B remote unaffected test。

## 关键设计

### 默认 Node/TUI fallback

Native Runner 默认关闭。即使配置开启，只要 path 缺失、version probe 失败、protocol mismatch 或 start failed，job 仍走 Node/TUI fallback，并在 state/report/background 中显式写出 fallback reason。

### Approved spec only

Adapter 不转发用户输入中的 raw command。Focused test 用 goal 中的 `rm -rf secret` 验证 runner start argv 只包含 approved supervisor task，不包含用户 raw command 或 secret 文本。

### Phase 17C.A real minimal supervision loop

17C.A 已将 `node -e process.exit(0)` instant placeholder 替换为 Linghun-approved long-running lifecycle task。Adapter 现在用 native prototype 的 `start/status/stop` protocol 启动受控任务，传入 bounded heartbeat interval 和 timeout；启动后等待 observable `state.json`，并把 `running`、`heartbeatAt`、`stdout.log` / `stderr.log` refs 写回 durable job state/report/background。Phase 17A bounded worker loop 仍负责 Linghun job 本体，不把 raw user command 交给 runner。

### Minimal lifecycle adapter, not full daemon

本轮 adapter 仍不是完整 daemon/owner-death supervision：runner 监督的是 approved lifecycle task，用于打通 running/heartbeat/status/log/cancel/timeout 闭环；真实长期 daemon owner-death benchmark、managed/bundled distribution 和跨平台 process-group release hardening 后置。

### Redaction

Doctor/status/report 输出：

- 不显示完整 private path。
- 不显示 secret/token/API key/Bearer/full env。
- runner stdout/stderr/state refs 只允许安全相对 ref 或 redacted basename ref；不信任 runner state 返回的完整路径。
- approved spec 只显示 cwdRef、env allowlist、redacted env refs 和 log refs。

## 配置项

新增 `LinghunConfig.nativeRunner`：

```ts
export type NativeRunnerSource =
  | 'disabled'
  | 'bundled'
  | 'optional-package'
  | 'project-local'
  | 'custom';

export type NativeRunnerConfig = {
  enabled: boolean;
  path?: string;
  expectedProtocol: string;
  source: NativeRunnerSource;
  timeoutMs: number;
};
```

默认：

```ts
nativeRunner: {
  enabled: false,
  expectedProtocol: 'linghun-native-runner-prototype.v1',
  source: 'disabled',
  timeoutMs: 60_000,
}
```

## 命令

新增用户可见命令：

- `/doctor runner`

既有 job 命令新增 runner 状态可见性：

- `/job run <goal>`
- `/job status <id>`
- `/job report <id>`
- `/job logs <id>`
- `/job cancel <id>`

## 17C.B：Bundled Native Runner Internal Capability Lite

### Source-Level Reality Check 摘要

#### Existing implementation

- 17C.A 已有 `LinghunConfig.nativeRunner`、Runner Resolver、Runner Adapter、`/doctor runner`、durable job runner summary、background/report/status 写回、approved spec only、safe log refs、cancel/timeout/status failure fallback 与 non-PASS evidence 边界。
- 17A durable job 仍复用 `BackgroundTaskState(kind='job')`、resource guard、handoff、log/report/full-output artifact；completed lifecycle 仍为 `partial`，不是 verification PASS。
- 17B remote channels 已有默认关闭、脱敏、approval safety、no-PASS 边界；本轮不改 remote runtime。
- prototype native runner 已有 `version/start/status/stop/heartbeat` 与短 JSON protocol；benchmark 已证明 Windows supervision/path/log 边界有价值，但 Node spawn/raw throughput 更快，不能做性能宣传。

#### Gaps closed in 17C.B

- 17C.A 仍以 `path` 手动配置为主；17C.B 新增 bundled/internal candidate resolver：`nativeRunner.source='bundled'` 时无需 `path`，按随包路径约定自动解析候选。
- `/doctor runner` 补齐 source、platform/arch、bundled platform/arch、bundled candidate ref、resolved path ref、version/protocol、fallback reason、next action。
- Bundled candidate missing / unreadable / protocol mismatch 均显式进入 Node/TUI fallback，不崩 TUI，不生成 PASS evidence。
- project-local/custom path 仍保留为开发/调试入口，并且不会被 bundled candidate 覆盖；只有 `source='bundled'` 才走 bundled path convention。
- macOS/Linux 只通过 mocked platform/arch path convention 覆盖 candidate ref/fallback，不声明真实平台验证 PASS。

#### Minimal touch points

- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/config/src/index.test.ts`
- `docs/delivery/phase-17c-native-runner-job-supervisor-gate.md`

本轮未修改 native runner prototype、provider、tool、permission、evidence、MCP、index、agent、job runtime 公共接口，也未新增 package 发布系统。

#### Forbidden duplicate systems

- 不新增第二套 provider / tool / permission / evidence / MCP / index / agent / job runtime。
- 不让 Native Runner 替代 Node/TUI 默认短任务路径；Node/TUI 仍是默认短任务和 fallback。
- 不绕过 Start Gate / permission pipeline；runner 仍只消费 Linghun-approved durable job spec。
- 不让 runner 生成 verification PASS 或改变 17A durable job non-PASS 语义。
- 不进入 Fast Workspace Scanner、Phase 18 desktop、remote channel 扩展、自动升级、签名/AV 或完整 release matrix。

### 17C.A / research / benchmark / reference-map 裁决

- DONE：17C.A approved spec only、runner completed remains partial、safe log refs、cancel/timeout/status failure fallback、protocol mismatch fallback、remote unaffected 回归边界继续保留。
- DONE：native research 中的 `version` bounded probe、protocol compatibility、doctor redacted path/version/protocol/source/fallback reason、fallback Node runner 思路进入 17C.B Lite。
- DONE：benchmark 中“Native value is supervision/durability/process-tree cleanup, not raw speed”继续写入阶段边界；本轮不做性能宣传。
- DONE：reference-map 中 Phase 17C 只吸收 supervisor、doctor、fallback、heartbeat/log/status 边界，不复制 CCB / OpenCode / 第三方源码。
- DEFERRED：真实 bundled binary release、optional platform package 发布、Unix/macOS process-group cleanup、真实 Linghun workload benchmark、owner-death daemon benchmark。
- NOT-DO：自动升级、签名/AV、完整 release matrix、Fast Workspace Scanner、Phase 18 desktop、真实全量 smoke、Beta PASS / smoke-ready / open-source-ready 宣告。

### Bundled/internal path 规则

17C.B 的 bundled path convention：

```text
<native-runner-root>/<platform>-<arch>/linghun-native-runner[.exe]
<native-runner-root>/<platform>-<arch>/linghun-native-runner.cjs
```

当前支持的平台/架构候选：

- `win32-x64`
- `linux-x64`
- `darwin-arm64`
- `darwin-x64`

Resolver 先生成 `bundled:<platform-arch>/<binary-name>` 形式的 candidate ref；doctor 与 job status/report 只显示 ref 或 `present:<basename>`，不显示完整私有路径。测试可用 `LINGHUN_NATIVE_RUNNER_BUNDLED_DIR` 指向 mock bundled root；真实产品路径由随包目录解析，仍不要求用户手动填写 prototype path。

### Source 优先级 / 边界

- `enabled=false` 或 `source='disabled'`：默认 disabled，Node/TUI fallback 不变。
- `source='bundled'`：只走 bundled/internal candidate；无需 `nativeRunner.path`。
- `source='project-local'` / `source='custom'`：只使用显式 path，作为开发/调试入口；即使 bundled candidate 存在，也不会覆盖 custom/project-local path。
- `source='optional-package'`：保留配置枚举边界，17C.B 不实现真实 optional package 发布或 release matrix。

### Protocol/version probe

- bundled/project-local/custom runner 均先执行 bounded `version` probe。
- `protocol !== expectedProtocol` 时 resolution=`protocol_mismatch`，job runner adapter=`node`、status=`node_fallback`、fallbackReason=`protocol_mismatch`。
- probe failure / missing / unreadable / not executable 均 resolution=`unavailable`，保守 fallback Node/TUI。
- doctor 输出 version/protocol、fallback reason、next action；错误信息经过脱敏，不展示 token/API key/Bearer 或完整私有路径。

### Fallback 行为

- Node/TUI 继续是默认短任务路径和 durable job fallback。
- fallback 写入 job state/report/background summary，`runner=node/node_fallback` 可见。
- fallback 不生成 PASS evidence；17A durable job completed lifecycle 仍保持 result/verification partial。
- 17C.A 的 approved spec only、safe log refs、cancel/timeout/status failure 语义未改变。

### Windows 真实验证与 macOS/Linux mock-only 边界

- Windows 当前环境运行了 bundled source focused test：真实 Node/Vitest 下解析 `win32-x64` mock bundled path、启动 mock runner、写回 heartbeat/log refs、protocol mismatch fallback、candidate missing fallback、custom 不被 bundled 覆盖。
- macOS/Linux 只用 mocked platform/arch env 覆盖 candidate ref/path convention；未在 macOS/Linux 真机运行，不声明真实 PASS。
- 没有真实 bundled binary 发布物，因此不得声明 bundled binary release PASS。

### Minimal packaged capability record

17C.B 只是“随包/内置能力边界”的最小闭环：代码具备 bundled/internal path convention、doctor 可诊断、fallback 可见、测试可 mock。它不是用户 setup 平台，不新增自动下载/升级，不做签名/AV，不做完整 release matrix，也不声明一条命令安装目标已完成；一条命令安装仍保留到 release/open-source packaging gate 做最终验收。

## 测试与验证

已运行（17C.B 本轮验证）：

```text
corepack pnpm exec vitest run packages/config/src/index.test.ts -t "native runner|Phase 17C"
```

结果：PASS，1 file passed，2 tests passed，22 skipped；覆盖 native runner 默认 disabled / Node fallback 不变、project-local deep merge、bundled source 无手动 path 配置。

```text
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Phase 17C.B bundled native runner|Phase 17C native runner|Phase 17B Remote Channels|remote channels unaffected"
```

结果：PASS，1 file passed，4 tests passed，148 skipped；覆盖 bundled source 自动解析、missing fallback、available + protocol match、protocol mismatch fallback、doctor redaction/path refs、custom 不被 bundled 覆盖、17C.A regression、17B remote unaffected。

```text
corepack pnpm typecheck
```

结果：PASS，`tsc -b tsconfig.json` 完成。

```text
corepack pnpm check
```

结果：PASS，Biome check 通过。第一次运行曾发现 formatting/import order 问题；已用 Biome 格式化 touched TUI files 后复跑通过。

```text
corepack pnpm build
```

结果：PASS，monorepo build 完成。

```text
git diff --check
```

结果：PASS，仅有 Windows LF/CRLF warning，无 whitespace error。

未运行真实全量 smoke；未运行 cargo test/build；未验证真实 macOS/Linux runner binary；未声明 bundled binary release PASS。

已运行（17C.A 追加复检）：

```text
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Phase 17C native runner"
```

结果：PASS，1 file passed，1 test passed，150 skipped；覆盖 real minimal long-running supervision、heartbeat/log refs、cancel/timeout/status failure fallback 与 non-PASS 边界。

```text
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Phase 17C native runner|remote channels unaffected|Phase 17B Remote Channels"
```

结果：PASS，1 file passed，3 tests passed，148 skipped。

```text
corepack pnpm typecheck
```

结果：PASS，`tsc -b tsconfig.json` 完成。

```text
corepack pnpm check
```

结果：PASS，Biome check 通过。

```text
corepack pnpm exec vitest run packages/tui/src/index.test.ts
```

结果：PASS，1 file passed，151 tests passed。

```text
corepack pnpm build
```

结果：PASS，monorepo build 完成。

```text
git diff --check
```

结果：PASS，仅有 Windows LF/CRLF warning，无 whitespace error。

未运行 config focused test：17C.A 未修改 `packages/config/`。未运行 cargo test/build：本轮未修改 `prototypes/native-runner/`，不声明 cargo PASS。

历史 Phase 17C gate 已运行：

```text
corepack pnpm exec vitest run packages/config/src/index.test.ts -t "Phase 17C|native runner"
```

结果：PASS，1 file passed，1 test passed，22 skipped。

```text
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Phase 17C native runner|remote channels unaffected|Phase 17B Remote Channels"
```

结果：PASS，1 file passed，3 tests passed，148 skipped。

```text
corepack pnpm typecheck
```

结果：PASS，`tsc -b tsconfig.json` 完成。

```text
corepack pnpm check
```

结果：PASS，Biome check 通过。

```text
corepack pnpm exec vitest run packages/config/src/index.test.ts
```

结果：PASS，1 file passed，23 tests passed。

```text
corepack pnpm exec vitest run packages/tui/src/index.test.ts
```

结果：PASS，1 file passed，151 tests passed。

```text
corepack pnpm build
```

结果：PASS，monorepo build 完成。

```text
git diff --check
```

结果：PASS，仅有 Windows LF/CRLF warning，无 whitespace error。

未运行 cargo test/build：本轮未修改 `prototypes/native-runner/`，Phase 17C 只接入 TUI/config 边界和 mock runner focused test。

## Focused test 覆盖

- config 默认 native runner disabled。
- config partial nativeRunner settings deep merge 保留 expectedProtocol/timeoutMs。
- `/doctor runner` available 输出 summary-first、Node fallback、redacted path。
- runner available -> adapter start/status/stop path。
- approved job spec 不转发任意用户 raw command。
- Windows/中文/空格路径：mock runner/project 路径含中文与空格，log/spec path 可写可读。
- start failure -> Node fallback + sanitized last error。
- protocol mismatch -> Node fallback + doctor warning。
- cancel/stop 不生成 PASS evidence。
- completed runner lifecycle remains partial / not verification PASS。
- background/details/status/report 可见 runner-managed job。
- runner 返回绝对 stdoutPath/stderrPath 时不泄露完整私有路径，只显示安全 ref/redacted ref。
- Phase 17B remote channels unaffected。
- Fast Workspace Scanner 未连接。

## 性能结果

本阶段不做性能宣传，不执行真实全量 smoke。已知 native benchmark 结论仍成立：Node spawn/raw throughput 更快；native runner 的价值只在 supervision/durability/process-tree cleanup。当前 TUI adapter 的 version/start/status/stop probe 都是 bounded local calls。

## 已知问题

- 当前 adapter start 运行受控 Linghun-approved long-running lifecycle task，可覆盖 running/heartbeat/status/log/cancel/timeout 闭环；仍不是真实 owner-death daemon supervision 或完整 Linghun workload runtime。
- 已有 bundled/internal path convention 与 mock fixture tests，但仓库没有真实 bundled native binary 发布物；不得声明 bundled binary release PASS。
- 未提供 optional platform package、签名、安装、升级、回滚或 AV false-positive 矩阵。
- Unix/macOS process-group/session cleanup 未验证；macOS/Linux 本轮只做 mocked path convention/fallback test，不声明真实平台 PASS。
- 尚无长期 native heartbeat owner-death benchmark。
- project-local/custom path 仍作为开发/调试入口；产品主路径应走 bundled/internal resolver，17C.B 不新增用户 setup 命令。

## 不在本阶段处理的内容

- Fast Workspace Scanner。
- Phase 18 desktop。
- 真实全量 smoke。
- Beta PASS / smoke-ready / open-source-ready 宣告。
- Native Runner 替代 Node/TUI 默认短任务路径。
- 第二套 provider/tool/permission/evidence/MCP/index/agent/job runtime。
- managed package/bundled binary release。
- 商业化账号系统、云同步、插件/skill 市场。

## 下一阶段衔接

Phase 17C.B 当前本地实现和 focused validation 已闭合。下一步不是自动进入真实全量 smoke，也不是 Phase 18；只能由用户决定是否进入 pre-smoke comprehensive audit / polish / smoke pre-acceptance。

进入下一步前仍需保留边界：不做自动升级、签名/AV、完整 release matrix、Phase 18 desktop、Fast Workspace Scanner，不宣布 Beta PASS / smoke-ready / open-source-ready；如后续 release/open-source packaging gate 需要真实 bundled binary，再单独验证一条命令安装、package files/bin、平台矩阵和 release artifacts。

## 开发者排查入口

- `/doctor runner`：查看 native runner resolver、protocol、fallback 和 next action。
- `/job status <id>`：查看 runner adapter/status/resolution/fallback 与 durable job 状态。
- `/job report <id>`：查看 approved spec、evidence refs、non-PASS boundaries。
- `/details background <id>`：查看 resource guard/background task 可见 runner summary。
- `packages/config/src/index.ts`：native runner config/default/validate/merge。
- `packages/tui/src/index.ts`：resolver、adapter、doctor、job supervisor integration。
- `packages/tui/src/index.test.ts`：Phase 17C focused behavior tests。

## 参考核对

### 实际读取的 Linghun 文档

- `START_NEXT_CHAT.md`
- `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- `docs/delivery/phase-17a-local-durable-jobs-virtual-agent-concurrency.md`
- `docs/delivery/phase-17b-remote-channels.md`
- `docs/audit/native-local-job-runner-research.md`
- `docs/audit/native-runner-vs-node-benchmark.md`
- `docs/audit/reference-map.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` Phase 17C 相关段落
- `LINGHUN_IMPLEMENTATION_SPEC.md` permission / verification runner 相关段落
- `docs/delivery/README.md`

### 实际参考的来源

- `prototypes/native-runner/Cargo.toml`
- `prototypes/native-runner/src/main.rs`
- native research / benchmark 文档中的 protocol、status、log ref、Windows cleanup、DEFERRED 风险边界。
- Phase 17A 报告中的 durable job/source-of-truth/evidence semantics。
- Phase 17B 报告中的 remote boundary 和 handoff gate。

### 未复制事项

未复制 CCB / Claude Code / OpenCode / Hermes / third-party 源码、内部 API、私有协议、专有遥测或反编译痕迹。Linghun 本轮实现为 clean rewrite，只吸收公开行为边界和验收要求。

## 成品级结构化 handoff packet

- nextPhase: user decision before pre-smoke comprehensive audit / polish / smoke pre-acceptance; Phase 17C.B itself is locally closed by focused/mock validation only.
- prohibited:
  - do not run real full smoke without explicit user approval
  - do not claim Beta PASS / smoke-ready / open-source-ready
  - do not enter Phase 18 desktop
  - do not implement Fast Workspace Scanner
  - do not do auto-upgrade, signing/AV, or a full release matrix in this gate
  - do not make native runner default short-task executor
  - do not add a second provider/tool/permission/evidence/MCP/index/agent/job runtime
  - do not claim bundled binary release PASS until real packaged artifacts exist and are validated
- evidence:
  - 17C.B focused config vitest command above
  - 17C.B focused TUI vitest command above
  - 17C.B typecheck/check/build/diff-check commands above
  - prior 17C.A focused config/TUI and full TUI/build commands above
- indexStatus:
  - codebase-memory project `F-Linghun` was ready during Source-Level Reality Check.
- permissionMode:
  - runner consumes approved durable job specs only; it does not bypass Start Gate or local permission pipeline.
- provider/model:
  - no external provider calls required for focused tests; mock runner is local CJS fixture.
- budgetUsage:
  - local validation only; no real IM send, no native prototype rebuild, no provider token spend.

## Blocking 判断

当前未发现 Phase 17C.B blocking 问题。17C.B 仍不是 Beta PASS / smoke-ready / open-source-ready，也不是 bundled binary release PASS；本轮只完成 bundled/internal path convention、doctor、protocol probe 和 fallback 的最小闭环。用户可决定是否进入 pre-smoke comprehensive audit / polish / smoke pre-acceptance；后续仍不得自动升级、签名/AV、完整 release matrix、Phase 18 desktop、Fast Workspace Scanner 或真实全量 smoke。
