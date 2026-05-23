# Phase 17B Remote Channels 第一版

## 阶段目标

Phase 17B 本轮只完成 Remote Channels 第一版：企业微信 / 飞书 / 钉钉的本地配置、状态、doctor、setup/test/disable 命令、脱敏 remote event 与 remote approval safety 边界。默认关闭，只发送脱敏摘要、审批请求和结果报告。

本阶段不进入 Phase 17C / Phase 18，不接入 Native Runner，不实现 Fast Workspace Scanner，不执行真实全量 smoke，不宣布 Beta PASS / smoke-ready / open-source-ready。

## Source-Level Reality Check 摘要

### Existing implementation

- codebase-memory 索引项目 `F-Linghun` 可用，状态为 `ready`，约 1766 nodes / 3594 edges；remote/approval 关键词未命中已有 remote implementation，因此降级到源码精读确认。
- `packages/tui/src/index.ts` 已有统一 slash dispatcher、`TuiContext`、`pendingLocalApproval`、`EvidenceRecord`、`BackgroundTaskState`、durable `/job`、`appendSystemEvent()`、`background_task_update`、`/details evidence/background`。
- `packages/config/src/index.ts` 已有集中 `LinghunConfig`、默认配置、validate/merge 流程和 storage/provider/mcp/hooks/plugins 配置结构，可最小扩展 `remote` 配置。
- `packages/tui/src/natural-command-bridge.ts` 已有 slash registry / capability catalog，可登记 `/remote`，不需要新造第二套自然语言控制器。
- Phase 17A 报告存在，写明 `Phase 17A local closure PASS` 仅代表本地验证通过，下一步是否进入 17B 由用户决定；本轮用户已明确要求继续 Phase 17B。

### Gaps closed

- 新增 Remote Channels 配置模型：`enabled`、channel type、transport、endpoint/cli path、binding user/device、secret/token ref、summary-only redaction、allowed event types、trusted sources；小收口补齐 per-channel deep merge，用户只配置 `remote.channels.feishu.enabled` 或 `bindingUserId` 时仍保留默认 type/transport/cli/redaction/events/trusted sources。
- 新增 TUI remote runtime state：channel runtime status、binding status、transport status、last error、next action、bounded remote events、processed message ids、session-level disabled channel ids。
- 新增 `/remote setup <channel>`、`/remote test <channel>`、`/remote status`、`/remote doctor`、`/remote disable <channel>`；小收口确认 disable 在同一 TUI session/context 内持续生效，后续 status/doctor 不会被 config refresh 还原。
- 新增 remote event model：`id/channel/eventType/createdAt/expiresAt/nonce/messageId/source/redactedSummary/status/refs`。
- 新增 remote approval safety helper：校验 expiresAt、nonce/messageId、channel readiness、binding user/device、trusted source、signature/mock proof、idempotency，并且只在本地已有 `pendingLocalApproval` 时返回 approved。
- remote failed/expired/rejected/blocked 不创建 PASS evidence；remote event 自身也不生成 PASS evidence。

### Minimal touch points

- `packages/config/src/index.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/index.test.ts`
- `docs/delivery/phase-17b-remote-channels.md`

### Forbidden duplicate systems

- 不新增第二套 provider / tool / permission / evidence / MCP / index / agent / job runtime。
- 不绕过 Start Gate / permission pipeline；remote approval 只能恢复本地已有 pending approval。
- 不接入 Native Runner，不进入 Phase 17C，不实现 Fast Workspace Scanner。
- 不进入 Phase 18 desktop。
- 不做个人微信、完整远程工作台、商业化账号系统、云同步、插件/skill 市场。
- 不把 remote failed / timeout / expired / rejected / unknown source 生成 PASS evidence。

### reference-map / gate / 17A handoff / baseline 裁决

- DONE：Phase 17B 范围限定为企业微信 / 飞书 / 钉钉；默认关闭。
- DONE：只发送脱敏摘要、审批请求和结果报告；不发送完整 transcript、源码、日志、index result、evidence、API key/token 或 provider raw request。
- DONE：CLI-first setup/doctor 体验以 lark-cli / feishu-cli、dws、wecom-cli 作为公开 adapter 边界提示；CLI 缺失、未绑定、webhook 缺失、source 未信任时 blocked/disabled 并给 next action。
- DONE：Remote approval 校验 nonce/messageId、expiresAt、binding、source、signature/mock proof、idempotency。
- DONE：Phase 17A job PASS 语义未改变；remote event 只引用 refs，不生成 PASS evidence。
- DEFERRED：真实外网发送成功、真实 IM 回调服务器、真实 official CLI JSON 协议适配、解绑设备 UI、长期审计日志文件。
- NOT-DO：个人微信、Native Runner / Job Supervisor、Fast Workspace Scanner、Phase 18 desktop、云同步、市场、商业账号、真实全量 smoke。

## 已完成功能

### Remote Channels 配置与状态

新增配置类型：

- channel type：`wecom` / `enterprise-wechat` / `feishu` / `lark` / `dingtalk`
- transport：`official_cli` / `webhook_mock` / `webhook`
- endpoint 或 cli path
- binding user/device id
- signing secret / token 引用字段，不展示明文
- redaction policy：当前固定 `summary_only`
- allowed event types：`approval_request` / `job_status` / `job_report` / `verification_result`
- trusted sources

默认配置：

- `remote.enabled = false`
- `feishu` 默认 `official_cli` + `feishu-cli`
- `wecom` 默认 `official_cli` + `wecom-cli`
- `dingtalk` 默认 `official_cli` + `dws`

### Remote event model

`RemoteEvent` 包含：

- `id`
- `channel`
- `eventType`
- `createdAt`
- `expiresAt`
- `nonce`
- `messageId`
- `source`
- `redactedSummary`
- `refs`
- `status`

内容边界：只允许 bounded summary 和 refs；不允许完整上下文、源码、日志、token、密钥或 provider request 出站。

### Remote approval safety

Remote approval 第一版只做本地安全边界：

- 必须对应 `approval_request` event。
- 必须有未过期 `expiresAt`。
- 必须匹配 `nonce/messageId`。
- 必须来自已信任 source。
- 必须匹配绑定 user/device。
- 必须通过 signature 或 mock proof。
- 必须幂等，重复 messageId 只会得到 `replayed`。
- 必须存在本地 `pendingLocalApproval`；否则返回 `blocked`，不能直接执行任意命令。
- approved 仅表示 remote proof 验证通过，本地权限管道仍是执行边界。

### Doctor / status / setup / test / disable

新增 slash 命令：

```text
/remote setup feishu
/remote setup wecom
/remote setup dingtalk
/remote test <channel>
/remote status
/remote doctor
/remote disable <channel>
```

输出约束：

- summary-first、人话、可操作。
- 不输出 secret/token/full endpoint/private payload。
- doctor 展示 enabled/disabled、binding 状态、transport 状态、last error、allowed event types、next action。
- setup 主路径提示：`/remote setup <channel>` -> CLI 登录或 webhook/mock webhook -> `/remote test <channel>` -> `/remote status`。

### Transcript / evidence / background

- remote doctor/test/disable 写入 bounded `system_event`，保留脱敏摘要。
- `/remote disable <channel>` 在当前 TUI session/context 内记录 disabled override；后续 `/remote status` 显示 `disabled_by_user`，但不写配置、不阻塞主 TUI。
- remote failed/expired/rejected/blocked 不生成 PASS evidence。
- remote event 可引用已有 evidence refs，但本轮 focused test 只验证 refs 边界，不把 remote event 写成 evidence。
- 不改变 BackgroundTask、durable job、Phase 17A job result/verification PASS 语义。

## 使用方式

```text
/remote status
/remote doctor
/remote setup feishu
/remote test feishu
/remote disable feishu
```

用户连接主路径：

1. `/remote setup <channel>`
2. 按提示完成 official CLI 登录或 webhook/mock webhook 填写
3. `/remote test <channel>`
4. `/remote status`

CLI-first 提示：

- feishu/lark：检测 `lark-cli` / `feishu-cli`，提示 `config init` / `auth login` / doctor。
- dingtalk：检测 `dws`，提示 `auth login` / `device login` / doctor。
- wecom：检测 `wecom-cli`，提示 `init` / `auth` 状态。

Webhook fallback：第一版允许 `webhook_mock` / `webhook` 配置边界；真实外网回调服务器后置。

## 涉及模块

- Config：新增 `RemoteConfig`、`RemoteChannelConfig`、`RemoteEventType`、默认 disabled 配置、validate/merge。
- TUI：新增 `RemoteState`、`RemoteEvent`、remote channel doctor/status/test/setup/disable、redaction、approval safety helper。
- Natural Command Bridge：新增 `/remote` registry/capability 与 remote 关键词评分。
- Tests：新增 Phase 17B focused test，覆盖配置、三通道、doctor、redaction、approval safety 和 no-PASS evidence。

## 关键设计

### 默认关闭

`remote.enabled` 默认 `false`。默认状态下不检测 CLI、不外发、不启用任何通道。只有配置显式开启后，doctor/test 才根据 channel 状态判断 ready/blocked。

### CLI-first + webhook fallback

第一版不实现 IM SDK，不复制任何第三方源码。官方/开源 CLI 只作为 adapter 边界：Linghun 生成结构化脱敏 event，adapter 负责发送摘要；外部 CLI 不得读取完整 transcript、memory、API key、账单或源码。

### Failure downgrade

缺配置、未绑定、未信任、CLI 不存在、webhook 缺失、签名失败、发送失败都降级为 disabled/blocked/failed/rejected，不阻塞主 TUI，不产生 PASS evidence。

### Approval does not execute

Remote approval helper 不执行工具、不运行 Bash、不写文件、不恢复任意命令。它只验证 remote proof，并确认本地已有 `pendingLocalApproval`；实际执行仍由本地权限管道处理。

## 配置项

新增 `LinghunConfig.remote`：

```ts
remote: {
  enabled: false,
  channels: {
    feishu: { enabled: false, type: 'feishu', transport: 'official_cli', cliPath: 'feishu-cli', ... },
    wecom: { enabled: false, type: 'wecom', transport: 'official_cli', cliPath: 'wecom-cli', ... },
    dingtalk: { enabled: false, type: 'dingtalk', transport: 'official_cli', cliPath: 'dws', ... }
  }
}
```

Secret/token 只保存引用字段：`signingSecretRef` / `tokenRef`；主屏、doctor 和 status 不显示明文。

## 命令

新增用户可见命令：

- `/remote setup <channel>`
- `/remote test <channel>`
- `/remote status`
- `/remote doctor`
- `/remote disable <channel>`

Natural Command Bridge 新增 capability：

- `remote`，slash `/remote`，risk=`start_gate`

## 测试与验证

已运行：

```text
corepack pnpm exec vitest run packages/config/src/index.test.ts
```

结果：PASS，1 file passed，22 tests passed。

```text
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Phase 17B|Remote Channels"
```

结果：PASS，1 file passed，1 test passed，148 skipped。

```text
corepack pnpm exec vitest run packages/tui/src/index.test.ts
```

结果：PASS，1 file passed，149 tests passed。

```text
corepack pnpm typecheck
```

结果：PASS，`tsc -b tsconfig.json` 完成。

```text
corepack pnpm check
```

结果：PASS，Biome check 通过。

```text
corepack pnpm build
```

结果：PASS，monorepo build 完成。

```text
git diff --check
```

结果：PASS，仅有 Windows LF/CRLF warning，无 whitespace error。

## 本地自复检与 independent verifier 状态

本轮小收口完成后已重新启动 independent verifier。第一次 verifier 因只按小收口文件清单判断，把既有 Phase 17B `/remote` natural-command bridge 变更误判为范围外；补充完整 Phase 17B 范围后，verifier 重新检查并给出 PASS。随后本地复跑 focused config test、focused remote test 和 `git diff --check`，结果与 verifier 报告一致。

本地自复检重点：

- 确认 `/remote` 复用现有 slash dispatcher、`pendingLocalApproval`、`appendSystemEvent()` 和 evidence 边界，没有新增第二套 provider/tool/permission/evidence/MCP/index/agent/job runtime。
- 确认 remote approval helper 只返回验证结果，不执行工具、不写文件、不运行 Bash、不清空本地 pending approval。
- 确认 remote event / status / doctor 主输出只展示脱敏摘要、状态和 next action，不展示 secret/token/full endpoint/private payload。
- 确认 failed / expired / rejected / blocked / unknown source 路径不创建 PASS evidence。
- 确认报告未写 Phase 17C/18、Native Runner、Fast Workspace Scanner、真实全量 smoke、Beta PASS / smoke-ready / open-source-ready。

## Focused test 覆盖

- 默认 disabled。
- 三种 channel type 被识别：`feishu` / `wecom` / `dingtalk`。
- 未绑定 / CLI 缺失 / webhook 缺失时 doctor blocked/disabled。
- outbound payload 脱敏，不包含 secret/token/API key/Bearer/sk/Authorization/full transcript/source/log/index/full endpoint。
- remote config per-channel deep merge 保留默认 type/transport/cliPath/redactionPolicy/allowedEventTypes/trustedSources。
- `/remote disable feishu` 后同一 TUI session/context 的 `/remote status` 继续显示 disabled/disabled_by_user。
- `approval_request` event 有 `expiresAt`、`nonce`、`messageId`。
- expired / replayed / unknown source / wrong binding / bad signature 被拒绝。
- approval 成功不绕过 permission pipeline，只在已有 pending approval 时返回 approved，且不清空 pending approval。
- remote failed / expired / rejected / blocked 不生成 PASS evidence。
- `/remote status` / `/remote doctor` summary-first。
- 不接入 Native Runner，不进入 17C。

## 性能结果

本阶段无真实外网发送、无 native runner、无全量 smoke。Runtime 开销仅为本地配置解析、bounded channel 状态、短 event 列表和 CLI `--version` 级别状态探测；remote 默认关闭时不做 CLI 探测。

## 已知问题

- 第一版没有真实外网回调服务器。
- 第一版没有真实 official CLI JSON 协议矩阵，只实现 CLI-first 边界和 doctor/setup/test UX。
- 第一版没有设备解绑命令和长期 audit log 文件；当前 transcript 只写 bounded system_event。
- 第一版不保证本机已安装 lark-cli / feishu-cli / dws / wecom-cli。

## 不在本阶段处理的内容

- 个人微信。
- 完整远程工作台。
- 商业化账号系统。
- 云同步。
- 插件/skill 市场。
- Native Runner / Job Supervisor（Phase 17C）。
- Fast Workspace Scanner。
- Phase 18 desktop。
- 真实全量 smoke。
- Beta PASS / smoke-ready / open-source-ready 宣告。

## 下一阶段衔接

Phase 17B 当前本地实现和 focused validation 已闭合；是否进入 Phase 17C 仍必须由用户决定。

Phase 17C 若启动，只能处理 Native Runner / Job Supervisor Gate：Runner Resolver、Runner Adapter、Node fallback、`/doctor runner`、Windows process-tree cleanup、heartbeat/log/status supervisor、crash/missing/protocol mismatch fallback、scheduler/evidence/resource guard/log artifact/handoff recovery 集成。不得把 Phase 17B remote channels、Fast Workspace Scanner 或 Phase 18 desktop 混入 17C。

## 开发者排查入口

- `/remote status`：查看 remote 总状态和每个 channel next action。
- `/remote doctor`：查看 binding、transport、last error、allowed event types、next action。
- `/remote setup <channel>`：查看用户友好的 CLI-first / webhook fallback 连接步骤。
- `/remote test <channel>`：发送 mock/bounded redacted test event。
- `packages/config/src/index.ts`：remote 配置类型、默认配置、validate/merge。
- `packages/tui/src/index.ts`：RemoteState、RemoteEvent、redaction、approval safety、slash handler。
- `packages/tui/src/index.test.ts`：Phase 17B focused behavior test。

## 参考核对

### 实际读取的 Linghun 文档

- `START_NEXT_CHAT.md`
- `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- `docs/delivery/phase-17a-local-durable-jobs-virtual-agent-concurrency.md`
- `docs/audit/reference-map.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` Phase 17 相关段落
- `LINGHUN_IMPLEMENTATION_SPEC.md` Remote Channel 相关段落
- `docs/audit/native-runner-vs-node-benchmark.md`

### 实际参考的来源

- `reference-map.md` 中 Feishu/Lark CLI、DingTalk CLI、WeCom CLI 条目：只参考 CLI-first、doctor、登录状态、失败降级和禁止泄露完整上下文的边界。
- `pre-open-source-terminal-product-completion-gate.md` Phase 17B 条目：只做企业微信 / 飞书 / 钉钉，默认关闭，脱敏摘要/审批/报告。
- `phase-17a-local-durable-jobs-virtual-agent-concurrency.md`：复核 17A local closure 与禁止进入 17B/17C/18 的历史边界；本轮由用户明确进入 17B。
- `native-runner-vs-node-benchmark.md`：仅确认 Native Runner 未接入 runtime，仍属于 Phase 17C 后续门禁。

### 未复制事项

未复制 CCB / Claude Code / OpenCode / Hermes / Feishu / DingTalk / WeCom / third-party 源码、内部 API、私有协议、专有遥测或反编译痕迹。Linghun 本轮实现为 clean rewrite，只吸收公开行为边界和验收要求。

## 成品级结构化 handoff packet

- nextPhase: user decision before Phase 17C Native Runner / Job Supervisor Gate.
- prohibited:
  - do not run real full smoke
  - do not claim Beta PASS / smoke-ready / open-source-ready
  - do not enter Phase 18 desktop
  - do not integrate Native Runner outside Phase 17C gate
  - do not implement Fast Workspace Scanner
  - do not add personal WeChat, full remote workspace, cloud sync, account system, plugin/skill market
  - do not create a second provider/tool/permission/evidence/MCP/index/agent/job runtime
- evidence:
  - focused Phase 17B vitest command above
  - full TUI index.test command above
  - typecheck/check/build/diff-check commands above
- indexStatus:
  - codebase-memory project `F-Linghun` status was ready during Source-Level Reality Check
- permissionMode:
  - `/remote` registered as start_gate capability; remote approval does not bypass existing local permission pipeline
- provider/model:
  - no external provider calls required for focused tests
- budgetUsage:
  - local validation only; no real IM send, no live provider token spend

## Blocking 判断

当前未发现 Phase 17B blocking 问题。可以由用户决定是否进入 Phase 17C；不得自动进入。
