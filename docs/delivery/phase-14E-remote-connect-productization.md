# Phase 14E Remote Connect Productization

## 阶段目标

把企业微信 / 飞书-Lark / 钉钉远程通道从「安全壳」升级为「强底座、用户低学习」的成品连接能力：用户只选一个手机通道、填必要字段，就能在手机收到 Linghun 任务状态/验证/审批/失败摘要、在手机 approve/reject 本地 pending approval、用自然语言继续驱动本地开发。所有执行仍发生在本地，复用现有模型主链、tool schema、permission pipeline、evidence、transcript、failure learning、anti-hallucination gate。

本阶段停在阶段边界：未进入 Run 2，未 commit，未改 provider/env/key/model route 真实选择逻辑，未放松任何权限语义，未恢复 FreshnessLite。

## 当前 remote 从什么状态升级到什么状态

升级前（Phase 17B 第一版，安全壳）：
- 三方 config / type / state / slash / approval safety helper 已有。
- `/remote test` 只是 create event + 标记 sent/failed/rejected，**不是真实发送**。
- 没有真实 webhook / CLI send；没有手机消息接收/回调入口；没有远程自然语言进入本地模型主链。

升级后（Phase 14E 成品连接）：
- **真实发送链路**：`sendRemoteEventReal` 走真实 HTTP POST（webhook）或安全参数数组（official_cli，execFile，不 shell 拼接）；`webhook_mock` 恒为 diagnostic mock，绝不显示为真实 delivery PASS。
- **真实入站模型**：新增 `RemoteInboundMessage`（approval_response / natural_language_message / status_query），统一经 `processRemoteInbound` 校验后交回本地主链。
- **手机自然语言进入本地模型主链**：通过 `handleRemoteInboundMessage` glue 原样进 `sendMessage`，无本地关键词截获、无第二套执行器。
- **远程审批闭环**：手机 approve/reject 只能恢复本地已有 `pendingLocalApproval`，复用 `executePermissionApprove` / `executePermissionDeny`；plan 模式远程 approve 也不执行写操作。
- **成品命令体验**：低学习 setup 向导（字段清单 + 人话 next action）、按平台真实能力分级的 doctor、`/remote events` / `/remote inbox` 事件摘要。
- 事件类型从 4 种扩展到 7 种（section F）：approval_request / job_status / job_report / verification_result / failure_summary / stable_point_result / index_result。

## 三个平台分别支持什么、不支持什么

能力分级基于官方文档/官方 CLI 事实（2026-05-31 三个研究智能体核对，见「参考核对」），不臆测。**所有三个 webhook 路径都是 notification-only（仅出站，不能接收）**；审批/自然语言回传需官方 CLI / 完整应用入站能力。

| 平台 | webhook 路径 | 官方 CLI / 应用路径 | payload | 签名 |
|------|-------------|---------------------|---------|------|
| 飞书 / Lark | notification-only | full-mobile-control-capable（`lark-cli` 事件订阅 `im.message.receive_v1` + 审批域） | `{msg_type:"text",content:{text}}` | `base64(HMAC_SHA256(key=`ts\nsecret`, msg=""))`，ts=秒，body 内带 timestamp/sign |
| 钉钉 / DingTalk | notification-only | approval-capable（`dws` 的 `oa` approve/reject；实时回传需 Stream/回调应用） | `{msgtype:"text",text:{content}}` | `urlEncode(base64(HMAC_SHA256(key=secret, msg=`ts\nsecret`)))`，ts=毫秒，拼到 URL |
| 企业微信 / WeCom | notification-only | natural-language-inbound-capable（`wecom-cli` 轮询消息历史；交互审批需自建应用回调） | `{msgtype:"text",text:{content}}` | 无 HMAC，安全性来自 URL key |

实现按真实能力分级：
- webhook / webhook_mock 通道：`inboundMode` 恒为 `none`，doctor/setup 显示 `notification-only`。
- official_cli 通道开启 `inboundMode=poll|callback` 后：feishu/lark→`full-mobile-control-capable`，wecom→`natural-language-inbound-capable`，dingtalk→`approval-capable`；`inboundMode=none` 的官方 CLI 仍只出站通知。

不支持（本阶段明确不做）：真实外网平台 smoke（无真实凭证）；个人微信；完整远程工作台；云同步；账号系统；插件/skill 市场；Native Runner；Fast Workspace Scanner；Phase 18 desktop。webhook「发出成功」**不**等于「手机可审批/可自然语言控制」，doctor/报告都明确区分。

## 用户最少需要填哪些字段

`/remote setup <channel>` 是低学习向导，只展示必要字段清单（`[已填]` / `[待填]` + 人话 next action），不要求理解 nonce/evidence/provider/transcript，也不在主屏打印 secret / full endpoint：

- webhook 通道：webhook endpoint、signing secret 引用（企业微信可留空）、绑定用户、可信来源（设备可选）。
- official_cli 通道：CLI 登录状态、入站模式 inboundMode、绑定用户、可信来源（设备/回调端点按需）。

缺字段时通道保持 blocked 并给出具体 next action。

## 手机自然语言如何进入本地主链

1. 手机回传 `natural_language_message`（带 messageId/nonce/expiry/source/binding/signature）。
2. `processRemoteInbound` 校验：channel ready、inbound 已启用（非 notification-only）、未过期、未重放、可信来源、绑定匹配、签名/等价证明。
3. 通过后返回 `routedText`（原文逐字透传，**不做关键词匹配/截获**）。
4. `handleRemoteInboundMessage` glue 把 `routedText` 原样交给 `sendMessage(text, context, gateway, output)`，即既有本地模型主链。
5. 模型用现有 tool schema / runtime 决策；mutating 操作仍走 PermissionPanel / `pendingLocalApproval`；结果只回发摘要。

源不变式：远程自然语言没有独立执行器、没有第二套 agent、没有 `if text.includes(...)` 关键词执行（index.ts source-invariant 测试断言）。

## 手机审批如何复用本地 permission pipeline

1. 本地出现 `pendingLocalApproval` 时可创建 `approval_request` remote event。
2. 手机回传 `approval_response`，`processRemoteInbound` 校验 channel/inbound/expiry/replay/source/binding/signature，并核对 `eventId`+`nonce` 对应已发出的 approval_request。
3. 仅当本地确有 `pendingLocalApproval` 时返回 `approved`/`rejected`；否则 `no_pending_approval`。
4. `handleRemoteInboundMessage` 复用 `executePermissionApprove` / `executePermissionDeny`，由**本地 resolver 完成执行**；approval 成功只代表本地权限管道被确认。
5. **plan 模式**：远程 approve 直接在边界返回 `blocked`，不消费 nonce，不执行任何写操作，pending approval 保留。
6. approve/reject 都写脱敏 system_event/transcript 摘要，不创建假 PASS evidence（`evidenceCreated: false`）。

## 隐私和安全边界

- 远程消息只发 summary-first 脱敏摘要。`redactRemoteSummary` 脱敏 api_key/token/secret/authorization/Bearer/sk-/transcript/source/log/index/evidence/完整 endpoint，本阶段新增**绝对路径脱敏**（Windows 盘符路径 + 常见 Unix 根路径 → `[REDACTED_PATH]`）。
- 真实 endpoint URL（可能含 access_token/key）与解析后的 signing secret 只用于实际请求，**不写入** deliveryDetail / transcript / report；网络错误 detail 为通用文案，不回显 endpoint/payload。
- signing secret 只存引用字段（`signingSecretRef`/`tokenRef`），运行时从环境变量解析；解析失败则 `failed`，不外发。
- 入站强校验：messageId/nonce/expiry、trusted source、binding user/device、signature 或等价 proof、replay 防护；任一不过即拒绝。
- webhook_mock 永不被当真实 delivery PASS（独立 `mock` 状态 + 文案标注）。
- 远程端不能直接执行工具/Bash/写文件/Git，只能把输入/审批交回本地主链；不新增第五种权限模式，不放松 default/auto-review/plan/full-access 语义。

## 测试结果

新增/更新测试（全部本地通过）：
- `src/remote-transport.test.ts`（15 tests）：三平台 webhook payload 字段与签名（feishu HMAC over empty body / dingtalk HMAC ms 拼 URL / wecom 无 HMAC）、secret 不入 URL/body、official_cli 参数数组不 shell 拼接、缺 endpoint/cli/binding 显式报错、delivery 区分 sent/auth-fail/platform-fail/errcode/network/ENOENT-blocked。
- `src/remote-mcp-presenter.test.ts`（5 tests）：webhook_mock 标注为诊断演练而非真实 PASS。
- `src/index.test.ts` D.14E（8 tests）：sendRemoteEventReal mock/sent/auth/platform/cli-missing/rejected；inbound expired/replay/bad-nonce/bad-sig/source-mismatch/binding-mismatch/no-pending/inbound-disabled；plan 模式远程 approve 不写；remote NL 逐字进本地主链（无关键词执行）；summary 不含 secret/baseUrl/abs-path/transcript；doctor 能力分级；index.ts source invariant；inbound glue。

验证命令与结果：
- `corepack pnpm exec tsc --noEmit` → PASS（全工作区）。
- `corepack pnpm --filter @linghun/tui build` → PASS。
- `corepack pnpm --filter @linghun/cli build` → PASS。
- `corepack pnpm --filter @linghun/tui exec vitest run src/remote*.test.ts src/index.test.ts -t "remote|Remote|D.14E|GitStablePointCreate|D.13U|D.13V"` → 67 passed。
- `corepack pnpm --filter @linghun/tui exec vitest run` → 1996 passed（51 files）。
- `corepack pnpm --filter @linghun/config exec vitest run` → 38 passed。
- `git diff --check` → 干净（无 whitespace error）。
- biome：改动文件已格式化并通过 `biome check`；仓库其它 dirty/untracked 文件的既有 biome 告警未在本阶段触碰（不批量格式化无关文件）。

## 未跑/已跑真实平台 smoke 的脱敏说明

**未跑真实平台 smoke。** 当前没有真实企业微信 / 飞书 / 钉钉 webhook/secret/token 凭证，因此没有进行任何外网投递，不伪装已完成外网 delivery。`webhook_mock` 路径只做本地诊断演练。

如用户后续提供真实 webhook/secret/token：只用临时 env/config（`signingSecretRef` 指向环境变量），不写入源码/report/transcript，跑完清理；真实 smoke 结果会单独脱敏记录，仍不改 provider/env/key/model route 选择逻辑。

## 明确边界声明

- 未进入 Run 2。
- 未 commit（改动留在工作区）。
- 未改 provider / env / key / model route 真实选择逻辑。
- 未放松 default / auto-review / plan / full-access 权限语义，未新增第五种权限模式。
- 未改 D.13U / D.13V anti-hallucination / final gate 语义（回归测试通过）。
- 未恢复 FreshnessLite。
- 未把业务逻辑塞回 index.ts（source-invariant 测试断言）；index.ts 只做 composition/glue。
- 未删除历史 dirty/untracked，未批量格式化，未顺手整理无关文档。

## 涉及模块

- `packages/config/src/index.ts`：`RemoteEventType` 扩到 7 种；新增 `RemoteInboundMode`、`RemoteChannelConfig.inboundMode`/`callbackEndpoint`；validate/default 同步。
- `packages/tui/src/remote-transport.ts`（新增）：纯 payload/签名 builder + 可注入 fetch/execFile delivery。
- `packages/tui/src/remote-command-runtime.ts`：`sendRemoteEventReal`、`processRemoteInbound`、`verifyRemoteInboundSignature`、能力分级、setup 向导、`/remote events`。
- `packages/tui/src/remote-mcp-presenter.ts`：诚实标注 mock/blocked + delivery detail。
- `packages/tui/src/tui-data-types.ts`：`RemoteInboundMessage`/`RemoteInboundDecision`、event status 扩展 + `deliveryDetail`。
- `packages/tui/src/permission-continuation-runtime.ts`：`redactRemoteSummary` 新增绝对路径脱敏。
- `packages/tui/src/index.ts`：`handleRemoteInboundMessage` glue、导入/导出、`/remote events` 非 mutating 分类。
- 测试：`remote-transport.test.ts`（新增）、`remote-mcp-presenter.test.ts`、`index.test.ts`、`config/src/index.test.ts`。

## 配置项

```ts
remote.channels.<id> = {
  enabled, type, transport,          // official_cli | webhook | webhook_mock
  endpoint?, cliPath?,
  bindingUserId?, bindingDeviceId?,
  signingSecretRef?, tokenRef?,      // 只存引用，不存明文
  redactionPolicy: "summary_only",
  allowedEventTypes,                 // 7 种
  trustedSources,
  inboundMode?,                      // none | poll | callback（webhook 恒 none）
  callbackEndpoint?,                 // 仅 inboundMode=callback
}
```

## 命令

- `/remote status`：所有通道 connected/disabled/blocked/mock-only。
- `/remote doctor`：诊断 + 按平台能力分级（不泄露 secret/full endpoint）。
- `/remote setup <channel>`：低学习字段清单向导。
- `/remote test <channel>`：真实发送 smoke（webhook/CLI），失败明确区分原因；webhook_mock 标注诊断演练。
- `/remote disable <channel>`：session 内禁用。
- `/remote events` / `/remote inbox`：最近远程事件脱敏摘要。

## 已知问题 / 不在本阶段处理的内容

- 未跑真实外网平台 smoke（无真实凭证）。
- 官方 CLI 子命令 flag 按官方文档能力 best-effort，未与真实 CLI 二进制做协议级对接（无凭证无法验证）。
- 入站当前是「校验 + 交回本地主链」的运行时入口；真实手机回调服务器/长连接监听（Stream/event-subscription daemon）后置，不在本阶段。
- 个人微信、完整远程工作台、云同步、账号系统、市场、Native Runner、Fast Workspace Scanner、Phase 18 desktop 均不做。

## 下一阶段衔接

Phase 14E 本地实现与 focused/full validation 已闭合，停在阶段边界。是否进入下一步（真实平台 smoke 或入站回调 daemon）由用户决定；不得自动进入 Run 2，不得自动 commit。

## 开发者排查入口

- `/remote doctor`：能力分级 + binding/transport/last error/next action。
- `/remote events`：最近脱敏事件。
- `packages/tui/src/remote-transport.ts`：payload/签名/delivery。
- `packages/tui/src/remote-command-runtime.ts`：发送 + 入站校验 + 向导 + 分级。
- `packages/tui/src/index.ts` `handleRemoteInboundMessage`：入站进本地主链 glue。
- `packages/tui/src/index.test.ts`（搜 `D.14E`）+ `remote-transport.test.ts`：行为与边界。

## 参考核对

### 实际读取的 Linghun 文档
- `CLAUDE.md`（全局 + 项目工作规则、Source-Level Reality Check、用户可见输出标准）。
- `docs/delivery/phase-17b-remote-channels.md`（remote 第一版安全壳现状与边界）。

### 实际参考的官方/准官方来源（2026-05-31，三个独立研究智能体核对官方文档 + 官方 CLI README）
- 飞书/Lark：官方 CLI `github.com/larksuite/cli`（事件订阅 `im.message.receive_v1`、审批域）；自定义机器人 + 卡片回调官方文档（SPA 无法直接抓取正文，签名 schema 以官方方案实现 go-lark `crypto.go`/`api_bot.go` 核对）。
- 钉钉/DingTalk：官方 `github.com/DingTalk-Real-AI/dingtalk-workspace-cli`（`oa` 审批）；webhook 机器人 + 互动卡片官方文档（doc 页被网络拦截，加签构造以官方 `open-dingtalk/*` 仓库 + `dingtalk-stream` SDK 核对，确认 Stream/回调需企业内部应用）。
- 企业微信/WeCom：官方群机器人文档 doc 91770（确认无 HMAC、仅 URL key、纯出站）；官方 `github.com/WecomTeam/wecom-cli`（轮询消息历史、绑定身份）。

### 哪些是行为参考，哪些进入自研实现
- 只参考：每个平台真实能力边界（能否接收回传、webhook vs 应用）、payload 字段名、签名构造、失败降级思路、能力分级。
- 进入自研：Linghun 自己的 `RemoteChannelConfig` / `RemoteEvent` / `RemoteInboundMessage` 模型、`sendRemoteEventReal` / `processRemoteInbound` / 能力分级 / setup 向导 / 脱敏 / 复用本地权限管道的 glue。

### 未复制事项
未复制 CCB / Claude Code / OpenCode / Hermes / 飞书 / 钉钉 / 企业微信 / 第三方源码、内部 API、私有协议、专有遥测或反编译痕迹。本阶段为 clean rewrite，只吸收公开行为边界与官方文档事实。

## 成品级结构化 handoff packet

- nextPhase: 用户决定是否进入真实平台 smoke 或入站回调 daemon；不得自动进入 Run 2。
- prohibited:
  - do not run/claim real external platform smoke without user-provided credentials
  - do not commit; do not enter Run 2
  - do not change provider/env/key/model route selection logic
  - do not relax default/auto-review/plan/full-access; no fifth permission mode
  - do not change D.13U/D.13V anti-hallucination/final gate semantics
  - do not restore FreshnessLite
  - do not push remote business logic into index.ts (glue only)
  - do not let remote NL bypass the local model main chain or use keyword interception
  - do not present webhook_mock or "webhook POST succeeded" as real delivery / mobile-control PASS
- evidence:
  - tsc --noEmit PASS; tui build PASS; cli build PASS
  - scoped vitest 67 passed; full tui vitest 1996 passed; config vitest 38 passed
  - git diff --check clean
- indexStatus: codebase-memory project `F-Linghun` 索引可用；本阶段以源码精读 + 官方文档研究为准。
- permissionMode: `/remote` 为 start_gate capability；远程审批不绕过本地权限管道；plan 模式远程 approve 不执行写操作。
- provider/model: 本阶段无外部 provider 调用；无真实 IM 投递 token 花费。
- budgetUsage: 仅本地验证 + 三次只读官方文档研究；无真实平台外网投递。

## Blocking 判断

未发现 Phase 14E blocking 问题。停在阶段边界，等待用户决定是否进入真实平台 smoke 或下一阶段。

## 小返修 Addendum — 远程审批 expiry 闭环（2026-05-31）

### 问题
`processRemoteInbound` 的 `approval_response` 分支只校验了 `RemoteInboundMessage.expiresAt`（入站消息自身时效），没有校验被引用的 `approval_request` `RemoteEvent.expiresAt`。结果：一个已过期的审批请求，仍可能被一条「新鲜」的手机消息 approve。

### 修复
在 `approval_response` 分支找到 `event` 且确认 `eventType === "approval_request"` 后、`nonce` 校验之前，补一道 `Date.parse(event.expiresAt) <= Date.now()` 检查；过期时返回 `expired`。该路径走纯 `reject` helper：**不消费 messageId、不改 `event.status`、不清 `pendingLocalApproval`、不执行 approve/deny、不创建 evidence**。

仅改 `packages/tui/src/remote-command-runtime.ts` 一处逻辑 + `packages/tui/src/index.test.ts` 一条新测试 + 本 addendum，未顺手重构。

### 新增测试
`D.14E 小返修: expired approval_request is rejected even when the inbound message itself is fresh`：构造已过期的 approval_request（ttl=-1），入站消息未过期、nonce/source/binding/signature 全部正确、且存在 `pendingLocalApproval`，断言：
- 决策 `status === "expired"`、`evidenceCreated === false`；
- `processedMessageIds` 未消费该 messageId；
- `event.status` 仍为 `pending`；
- `pendingLocalApproval` 保留；
- `context.evidence` 为空。

### 验证结果
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "D.14E"` → 9 passed（原 8 + 新 1）。
- `corepack pnpm --filter @linghun/tui exec vitest run src/remote*.test.ts` → 20 passed。
- `corepack pnpm exec tsc --noEmit` → PASS。
- `git diff --check` → 干净。

### 边界
未改 provider/env/key/model route，未放松权限，未改 D.13U/D.13V gate，未做真实平台 smoke，未进入 Run 2，未顺手重构。停在 D.14E 小返修边界，未 commit。