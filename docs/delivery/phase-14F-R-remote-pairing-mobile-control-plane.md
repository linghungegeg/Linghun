# Phase 14F-R：Remote Pairing Mobile Control Plane

## 目标

在 D.14F mobile bridge skeleton 之上，补齐可产品化手机控制面的最小闭环：本地 pairing code、手机 `/bind CODE` 绑定、active turn inbox 防冲突、fixture 与真实 adapter proof 分界，以及报告口径。核心要求不变：webhook 永远是 notification-only，不把 webhook POST 成功说成可审批或可自然语言控制。

本阶段未进入 Run 3，未 commit，未改 provider/env/key/model route，未放松 default/auto-review/plan/full-access 权限语义，未恢复本地自然语言关键词截获，未把 remote 做成第二套执行器。

## 本阶段范围

- 保留 D.14F 三平台 bridge 能力分层。
- 增加 pairing / bind / inbox 的本地产品闭环。
- 入站仍统一为 `platform adapter -> RemoteInboundMessage -> processRemoteInbound -> handleRemoteInboundMessage`。
- Feishu 只复用用户提供的 webhook 做真实出站 notification smoke；真实手机入站未跑。
- DingTalk / WeCom 只做本地闭环和诚实 doctor，不跑真实外网。

## 已完成功能

- `/remote bridge pair <channel>` 生成 5 分钟有效 pairing code、`linghun://remote-bind?...` QR payload 和 `/bind CODE` fallback。
- `/bind CODE` 作为远程自然语言入站的特殊绑定命令，在进入 `sendMessage` 前完成本地绑定，不触发模型、不执行工具。
- `/bind` 覆盖过期、重放、错 channel、未知 code，成功后只更新本会话 `bindingUserId` / `bindingDeviceId` / `trustedSources`。
- `/remote inbox` 支持 `list` / `clear` / `reject <id>` / `drain`，用于 active model turn、active job/tool、pending approval 期间暂存手机自然语言。
- `status_query` 和 `approval_response` 不进入 inbox；approval 仍复用本地 pending approval 续跑链路。
- fixture mock proof 与 adapter proof 分离：无 `signingSecretRef` 时，仅 `origin=fixture` 的 deterministic mock proof 可通过；adapter mock proof 被拒绝。
- source invariant 测试继续保证 adapter 只产出 `RemoteInboundMessage`，不 import/调用 Bash/Write/Git/index/job/tool executor。

## 使用方式

```text
/remote bridge doctor feishu
/remote bridge pair feishu
/remote bridge pair status
/remote bridge pair cancel feishu
/remote bridge test-inbound feishu
/remote bridge test-approval feishu
/remote bridge test-status feishu
/remote inbox
/remote inbox drain
```

`pair` 只在非 webhook notification-only 通道上可用。webhook 通道会明确阻断绑定，并提示需要平台应用、callback 或 daemon。

## 涉及模块

- 代码：`packages/tui/src/remote-inbound-bridge-runtime.ts`、`packages/tui/src/remote-command-runtime.ts`、`packages/tui/src/index.ts`、`packages/tui/src/tui-data-types.ts`、`packages/tui/src/tui-state-runtime.ts`
- 配置：`packages/config/src/index.ts`
- 测试：`packages/config/src/index.test.ts`、`packages/tui/src/index.test.ts`
- 文档：`docs/delivery/phase-14F-remote-mobile-bridge-productization.md`、`docs/delivery/phase-14F-R-remote-pairing-mobile-control-plane.md`
- 用户已有 diff / 非本轮证据：`WHITEPAPER.md` 已有修改，本阶段未触碰。

## 关键设计

### 三平台能力矩阵

| 平台 | webhook | mobile bridge 上限 | 未配置状态 | 真实入站下一步 |
| --- | --- | --- | --- | --- |
| Feishu/Lark | notification-only | full-mobile-control-capable | needs-app-setup / needs-daemon | 配置 Feishu/Lark appId/appSecret refs、事件回调或 CLI/daemon、callback verification refs |
| DingTalk | notification-only | approval-capable / stream-callback-capable | needs-dingtalk-app / needs-daemon | 配置 DingTalk app/Stream/callback 凭证与 daemon |
| WeCom | notification-only | natural-language-inbound-capable / app-callback-capable | needs-wecom-app / needs-daemon | 配置企业微信自建应用回调或 CLI poll 凭证 |

### 主链接入

```text
platform adapter
  -> RemoteInboundMessage
  -> processRemoteInbound
  -> handleRemoteInboundMessage
  -> sendMessage / executePermissionApprove / executePermissionDeny
```

adapter 不执行任何工具。自然语言消息在空闲时进入现有 `sendMessage` 主链；忙碌时进入 remote inbox；审批消息只恢复已有 `pendingLocalApproval`，plan 模式 remote approve blocked。

### 手机消息体验

出站通知保持三行 summary-only：

```text
Linghun / project / status
event type + result
next action
```

不发送完整 transcript、完整命令、完整路径、完整 endpoint。`approval_request` 只给操作类型、风险等级、approve/reject 方式和过期时间；`status_query` 回包只给 summary，不给日志全文。

## 配置项

- `appIdRef` / `appSecretRef`：平台应用凭证引用，不保存明文。
- `tokenRef` / `signingSecretRef`：平台 token 或入站 proof 引用，不保存明文。
- `inboundMode=poll|callback|none`：真实手机入站模式。
- `callbackEndpoint` / `localBridgePort` / `cliPath`：callback 或 daemon 入口。
- `bindingUserId` / `bindingDeviceId` / `trustedSources`：入站绑定与来源约束。
- `encryptKeyRef` / `verificationTokenRef`：Feishu/Lark callback 校验引用。

## 命令

CLI 示例默认仍使用 `linghun`；本阶段未改启动入口，Windows `Linghun` 兼容路径未变。

```text
linghun
/remote doctor
/remote bridge doctor feishu
/remote bridge pair feishu
/remote inbox
```

## 测试与验证

全部通过：

- `corepack pnpm exec tsc --noEmit` -> PASS.
- `corepack pnpm typecheck` -> PASS.
- `corepack pnpm --filter @linghun/tui build` -> PASS.
- `corepack pnpm --filter @linghun/cli build` -> PASS.
- `corepack pnpm --filter @linghun/tui exec vitest run src/remote*.test.ts src/index.test.ts -t "remote|Remote|D.14F|pair|bind|inbox|active turn|mobile|approval|status|feishu|dingtalk|wecom"` -> PASS, 56 passed.
- `corepack pnpm --filter @linghun/tui exec vitest run` -> PASS, 51 files / 2024 tests passed.
- `git diff --check` -> PASS.
- Secret leak scan for the real Feishu hook id/signing secret -> PASS, no matches in repo files.

## Smoke 结果

| 项 | 结果 | 说明 |
| --- | --- | --- |
| outbound real smoke: Feishu webhook | PASS | 保留 D.14F 用户提供 Feishu webhook 真实 smoke 结果：HTTP 200，platform code 0；URL/secret 未写入源码、测试或报告。本轮附件中未包含可解析 key，因此未新增第二次真实出站记录 |
| outbound real smoke: DingTalk webhook | NOT RUN | 未提供真实 DingTalk webhook；本阶段只做产品边界与本地闭环 |
| outbound real smoke: WeCom webhook | NOT RUN | 未提供真实 WeCom webhook；本阶段只做产品边界与本地闭环 |
| inbound local fixture | PASS | deterministic signed fixture 覆盖 natural_language_message / approval_response / status_query，以及 expiry/replay/source/binding/signature |
| pairing local closure | PASS | 本地 pairing code、`/bind CODE`、expired/replayed/wrong-channel 均有回归 |
| real mobile inbound | NOT RUN | 未配置 Feishu app callback/daemon、DingTalk app/Stream、WeCom app callback/CLI poll；不冒充真实手机入站 |

## 性能结果

无新长驻进程默认启动。pairing / inbox 仅维护本会话小数组：pending pairing 最多 5 个，remote inbox 最多 20 条 summary-only 消息。

## 已知问题

- pairing 绑定当前为 session-state，不写回持久配置；重启后需要重新绑定。
- QR 只输出 `linghun://remote-bind` payload 和 `/bind CODE` fallback，终端内不渲染二维码。
- 真实手机入站需要平台应用、公网回调或 daemon，本阶段没有真实凭证与 daemon，因此标记 NOT RUN。

## 不在本阶段处理

- 不进入 Run 3。
- 不做真实 Feishu app callback / DingTalk Stream / WeCom callback 端到端。
- 不把 webhook 升级为审批或自然语言入站。
- 不新增第二套执行器或本地自然语言关键词截获。
- 不持久化真实 webhook URL、secret、token。

## 下一阶段衔接

Run 3 handoff：

- 可纳入长压：Feishu outbound notification-only real smoke、三平台 local fixture、pair/bind expiry/replay/source/binding/signature、inbox active-turn guard、doctor/report 诚实分级。
- 只能标 `NOT RUN`：真实手机入站、真实 mobile approval E2E、真实 DingTalk/WeCom outbound，直到有真实 app/daemon/webhook 配置。
- 永久 `NOT SUPPORTED`：webhook approval、webhook natural-language inbound。

## 开发者排查入口

- Bridge runtime：`packages/tui/src/remote-inbound-bridge-runtime.ts`
- Remote commands：`packages/tui/src/remote-command-runtime.ts`
- Glue：`packages/tui/src/index.ts` 的 `handleRemoteInboundMessage`
- Types：`packages/tui/src/tui-data-types.ts`
- Config schema：`packages/config/src/index.ts`
- Regression tests：`packages/tui/src/index.test.ts` 中 `D.14F` / `D.14F-R` 用例

## 状态栏与统计口径

本阶段未新增状态栏字段。remote inbox 使用 `/remote inbox` 查看，不把完整手机消息、endpoint、secret 或 transcript 放进主屏。

## 学习成本与渐进披露

新增能力通过 `/remote bridge doctor`、`/remote bridge pair`、`/remote inbox` 可发现。默认 `/remote doctor` 用人话显示当前能做什么、缺什么、下一步填什么；高级配置仍通过 setup/doctor 细节暴露。

## TUI 渲染稳定性

用户可见输出走现有 `showCommandPanel`。长内容只进 details；主屏保持短摘要。没有新增 input/status/hints/background summary 分区，也不向普通消息区写完整 transcript。

## 主输出与日志分层

主屏只展示 pairing code、过期时间、当前 readiness、next action。secret-bearing endpoint 不显示；status/inbox 都是 summary-only。结构化 system_event 仅记录状态和 id，不记录完整命令、完整 endpoint、完整手机正文。

## 阶段 Verdict

- verdict：PASS
- 是否允许进入下一阶段：no，需用户确认
- P0/P1/P2 风险分类：P1 真实手机入站未跑；P2 pairing 不持久化
- 阻塞项：真实 Feishu app/callback/daemon、DingTalk app/Stream、WeCom callback/CLI poll 未配置
- 用户下一步审核点或命令：查看 `/remote bridge doctor feishu` 与本报告；如要真实入站，先配置平台 app/daemon

## 真实改动文件

- 代码：`packages/config/src/index.ts`、`packages/tui/src/tui-data-types.ts`、`packages/tui/src/tui-state-runtime.ts`、`packages/tui/src/remote-inbound-bridge-runtime.ts`、`packages/tui/src/remote-command-runtime.ts`、`packages/tui/src/index.ts`
- 测试：`packages/config/src/index.test.ts`、`packages/tui/src/index.test.ts`
- 文档：`docs/delivery/phase-14F-remote-mobile-bridge-productization.md`、`docs/delivery/phase-14F-R-remote-pairing-mobile-control-plane.md`
- 生成物：无
- 用户已有 diff / 非本轮证据：`WHITEPAPER.md` 已有修改，本阶段未触碰；`.claude/` untracked 未触碰

## 运行时事实

- provider/model：未改 provider/model route；本阶段验证不依赖模型 provider。
- permission mode：remote approval 仍复用本地 pending approval；plan remote approve blocked。
- index status：未重建索引；以源码精读、`rg`、阶段文档与子智能体只读审阅为准。
- cache/usage 来源：无真实 billing 字段，无成本估算变更。
- 配置来源：只增加 remote bridge 引用字段；不保存明文 secret/token。
- 是否有脱敏/密钥风险：Feishu webhook 只用于临时 outbound smoke；报告与测试不含真实 URL/secret/token。

## 后台/复查任务状态反馈

本阶段没有新增默认后台任务或 daemon。子智能体仅做只读审阅；结果用于报告 checklist 与安全复查，不作为 PASS 的唯一证据。

## 语言与 i18n 口径

新增 slash 输出沿用当前中英混合 remote command 风格；未引入新的 i18n helper。用户可见风险和 next action 使用短句，避免把 notification-only 误说成 full control。

## 参考核对

已读取/参考的 Linghun 文档：

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/TEMPLATE.md`
- `docs/delivery/phase-14E-remote-connect-productization.md`
- `docs/delivery/phase-14F-remote-mobile-bridge-productization.md`
- `docs/delivery/phase-17b-remote-channels.md`

官方能力核对：

- Feishu/Lark event callback：`https://open.feishu.cn/document/event-subscription-guide/callback-subscription/receive-and-handle-callbacks?lang=zh-CN`
- DingTalk Stream：`https://open.dingtalk.com/document/orgapp/stream`
- DingTalk callback overview：`https://open.dingtalk.com/document/isvapp-server/callback-overview`
- WeCom callback/message docs entry：`https://developer.work.weixin.qq.com/document/path/90238`

以上只用于核对能力边界和配置口径；Linghun 实现为自研 adapter normalization、doctor、fixture、pairing 与 inbox，未复制第三方源码、内部 API、专有协议或反编译痕迹。

## 交接摘要

```json
{
  "nextPhase": "Stop after D.14F-R; wait for user confirmation before Run 3 or real app/daemon setup.",
  "prohibited": [
    "do not enter Run 3",
    "do not commit",
    "do not change provider/env/key/model route",
    "do not relax permission modes",
    "do not restore local natural-language keyword interception",
    "do not persist real webhook URL/secret/token",
    "do not present webhook as approval or natural-language inbound"
  ],
  "evidence": [
    "Feishu outbound real smoke PASS: HTTP 200, platform code 0",
    "focused D.14F/D.14F-R remote tests PASS",
    "focused D.14F/D.14F-R remote tests PASS: 56 passed",
    "full TUI vitest PASS: 51 files / 2024 tests passed",
    "typecheck/build/git diff check PASS",
    "secret leak scan PASS"
  ],
  "validation": "PASS",
  "indexStatus": "not rebuilt; source and docs checked locally",
  "permissionMode": "default/auto-review/plan/full-access unchanged; plan remote approve blocked",
  "providerModel": "unchanged; no provider route edits",
  "budgetUsage": "local tests/builds plus one Feishu notification-only outbound smoke; no real mobile inbound"
}
```

## Addendum：D.14F-R 小返修

修复 P1：首次 `/bind CODE` 不再复用普通自然语言入站 envelope。pairing 专用 envelope 只校验 channel ready、非 webhook 入站能力、message expiry、messageId replay、signature/proof，以及 pairing code 存在、未过期、channel 匹配、未使用；不要求新手机 `source` 已在 `trustedSources`，也不要求新手机 `bindingUserId` 等于旧配置。绑定成功后才写入本 session 的 `bindingUserId` / `bindingDeviceId` / `trustedSources`。

保持边界：

- adapter mock proof 仍拒绝，fixture mock proof 只用于本地测试。
- `/bind CODE` 不进入 `sendMessage`，不创建 evidence PASS。
- 普通 `natural_language_message` 仍要求 trusted source 与 binding 匹配。
- webhook / webhook_mock 的 `/bind CODE` 仍 `inbound_disabled`。

处理 P2：`/remote inbox drain` 明确改为 `drain/export and clear`，只导出并清空排队摘要，不投递到 `sendMessage`，不代表执行排队手机消息。真正“处理队列”留给后续显式阶段设计，不能在本阶段暗中绕过权限或任务忙碌状态。

新增回归覆盖：

- 旧绑定或未绑定 channel 上，新 source/user 通过 `ref:` proof + valid code 可完成首次绑定。
- untrusted source / wrong binding 的普通自然语言仍拒绝。
- webhook channel 的 `/bind` 仍拒绝入站。
- adapter mock proof 的 `/bind` 仍 `bad_signature`。
- used / expired / wrong-channel code 仍拒绝。
