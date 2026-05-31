# Phase 14F Remote Mobile Bridge Productization

## 阶段目标

D.14F 在 D.14E 已证明 Feishu/Lark webhook notification-only 出站真实可用的基础上，把飞书 / 钉钉 / 企业微信 remote 从“只通知”推进到“可产品化手机桥接”的最小成品骨架。核心边界是诚实分级：webhook 仍然只通知；真实手机入站必须走平台应用、回调、Stream 或 daemon，不把本地 fixture 冒充为真实手机控制。

本阶段未进入 Run 3，未 commit，未改 provider/env/key/model route，未放松 default/auto-review/plan/full-access 权限语义，未恢复本地自然语言关键词截获，未把 remote 做成第二套执行器。

## 已完成功能

- 保留三平台 webhook notification-only：飞书、钉钉、企业微信 webhook 仅用于状态/验证/失败/稳定点/索引摘要等短消息通知。
- 新增独立 remote inbound bridge runtime：`packages/tui/src/remote-inbound-bridge-runtime.ts`，不塞回 `index.ts`。
- 新增 `/remote bridge doctor|test-inbound|test-approval|test-status <channel>` 最小入口。
- 三类统一入站消息继续走 `RemoteInboundMessage -> processRemoteInbound -> handleRemoteInboundMessage`。
- Feishu/Lark 配置支持 `appIdRef` / `appSecretRef`、`inboundMode`、`callbackEndpoint`、`localBridgePort`、`bindingUserId`、`trustedSources`、`encryptKeyRef`、`verificationTokenRef`。
- 钉钉 / 企业微信按真实平台边界显示 `needs-dingtalk-app` / `needs-wecom-app`，未配置不显示 ready。
- 增加 deterministic signed fixture，用于本地 test-inbound / test-status，不需要公网回调。
- 增加 source invariant：adapter 只产出 `RemoteInboundMessage`，不得 import/调用工具执行器、Bash、Git、job、index。

## 三平台能力矩阵

| 平台 | webhook | 产品化 bridge 上限 | 未满足配置时状态 | 真实入站要求 |
| --- | --- | --- | --- | --- |
| Feishu/Lark | notification-only | full-mobile-control-capable | needs-app-setup / needs-daemon | 官方应用事件订阅或 `lark-cli event consume im.message.receive_v1`；callback 需 endpoint、encrypt key、verification token |
| DingTalk | notification-only | approval-capable / stream-callback-capable | needs-dingtalk-app / needs-daemon | 官方应用机器人 Webhook/Stream；Stream daemon 或公网回调 |
| WeCom | notification-only | natural-language-inbound-capable / app-callback-capable | needs-wecom-app / needs-daemon | 自建应用“接收消息”回调；群机器人 webhook 只出站 |

## 使用方式

```text
/remote doctor
/remote bridge doctor feishu
/remote bridge test-inbound feishu
/remote bridge test-status feishu
/remote bridge test-approval feishu
```

`test-inbound` / `test-status` 使用本地 deterministic signed fixture。真实手机回消息仍需要平台应用、公网回调或常驻 daemon。

## Inbound Bridge 主链接入

统一链路：

```text
platform adapter
  -> RemoteInboundMessage
  -> processRemoteInbound
  -> handleRemoteInboundMessage
  -> sendMessage / executePermissionApprove / executePermissionDeny
```

adapter 不执行 Bash/Write/Git/index/job。自然语言只返回 `routedText` 并进入现有 `sendMessage` 主链；远程审批只恢复本地已有 `pendingLocalApproval`，由 `executePermissionApprove` / `executePermissionDeny` 继续执行。plan 模式远程 approve 仍 blocked，不消费 pending approval。

## 手机消息体验

出站消息继续 summary-only：

```text
Linghun / project / status
event type + result
next action
```

不会发送完整 transcript、完整命令、完整路径、完整 endpoint。approval_request 只描述操作类型、风险等级、approve/reject 方式和过期时间；status_query 回包只给摘要，不给日志全文。

## Smoke 结果

| 项 | 结果 | 说明 |
| --- | --- | --- |
| outbound real smoke: Feishu webhook | PASS | 用户提供的 Feishu webhook 临时 env 发送，HTTP 200，平台 code 0；未写入源码、测试、报告明文 |
| outbound real smoke: DingTalk webhook | NOT RUN | 未提供真实钉钉 webhook |
| outbound real smoke: WeCom webhook | NOT RUN | 未提供真实企业微信 webhook |
| inbound local fixture | PASS | D.14F deterministic signed fixture 通过 `processRemoteInbound` |
| real mobile inbound | NOT RUN | 未配置平台应用、回调 endpoint 或常驻 daemon；不冒充真实手机入站 |

## 安全 / 隐私边界

- 不写真实 webhook URL、secret、token 到源码、测试、报告或 transcript。
- `RemoteChannelConfig` 新增字段只保存 `*Ref` 引用，不保存明文。
- webhook 成功只说明“短通知可发出”，不说明可审批或可自然语言控制。
- 入站校验仍覆盖 expiry、replay、source、binding、signature。
- adapter source invariant 禁止调用工具执行器或新增第二套 runtime。
- 不改变 provider/model route，不改变权限模式语义。

## 验证结果

- `corepack pnpm exec tsc --noEmit` -> PASS。
- `corepack pnpm typecheck` -> PASS。
- `corepack pnpm --filter @linghun/tui build` -> PASS。
- `corepack pnpm --filter @linghun/cli build` -> PASS。
- `corepack pnpm --filter @linghun/config exec vitest run src/index.test.ts -t "remote bridge|Phase 17B remote"` -> PASS，2 passed。
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t D.14F` -> PASS，5 passed。
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t D.14E` -> PASS，9 passed。
- `corepack pnpm --filter @linghun/tui exec vitest run src/remote*.test.ts src/index.test.ts -t "remote|Remote|D.14E|D.14F|inbound|bridge|approval|feishu|dingtalk|wecom"` -> PASS，24 passed。
- `corepack pnpm --filter @linghun/tui exec vitest run` -> first run PARTIAL: 2018 passed, 1 `dist-integrity` dynamic import timeout at 5s; targeted retry `corepack pnpm --filter @linghun/tui exec vitest run src/dist-integrity.test.ts` -> PASS，4 passed。
- `git diff --check` -> PASS。

## 涉及模块

- `packages/config/src/index.ts`
- `packages/config/src/index.test.ts`
- `packages/tui/src/remote-inbound-bridge-runtime.ts`
- `packages/tui/src/remote-command-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `docs/delivery/phase-14F-remote-mobile-bridge-productization.md`

## 参考核对

实际读取的 Linghun 文档：

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-14E-remote-connect-productization.md`
- `docs/delivery/phase-17b-remote-channels.md`

实际参考的官方/公开来源：

- Feishu/Lark：官方自定义机器人文档、接收消息事件文档、`larksuite/cli` event skill。
- DingTalk：官方聊天机器人概述、群 Webhook 机器人概述、机器人接收消息、Stream 概述/协议。
- WeCom：企业微信消息推送配置说明、接收消息与事件、接收普通消息。

进入 Linghun 自研实现的是能力边界、配置字段、bridge doctor、fixture 和 adapter normalization。未复制可疑源码、内部 API、专有协议、专有遥测或反编译痕迹。

## Run 3 Handoff

可纳入长压：

- webhook notification-only 出站摘要：Feishu 已可真实 smoke；DingTalk / WeCom 仅在用户提供真实 webhook 后纳入。
- inbound local fixture：Feishu / DingTalk / WeCom deterministic fixture、expiry/replay/source/binding/signature 校验、source invariant。
- `/remote bridge doctor` 人话边界输出。

只能标 NOT RUN：

- real mobile inbound：未配置真实平台应用、callback endpoint、Stream/CLI daemon 前不得纳入 PASS。
- mobile approval end-to-end：无真实平台入站 credentials / daemon 前不得纳入 PASS。
- webhook approval / webhook natural language：永久 NOT SUPPORTED，webhook 路径只能 notification-only。

## 成品级 Handoff Packet

- nextPhase: 停在 D.14F，等待用户决定是否配置真实平台应用/daemon 或进入 Run 3；不得自动推进。
- prohibited: 不进入 Run 3；不 commit；不改 provider/env/key/model route；不放松权限模式；不恢复自然语言关键词截获；不写真实 webhook/secret；不把 remote 做第二套执行器。
- evidence: Feishu outbound real smoke PASS；D.14F focused PASS；remote filtered PASS；build/typecheck PASS；git diff --check PASS；full TUI vitest first run only dist import timeout, targeted retry PASS。
- indexStatus: 未触发重建；本轮以源码精读、`rg` 和子智能体只读摸底为准。
- permissionMode: remote approval 仍复用本地 pending approval 和 permission continuation；plan approve blocked。
- provider/model: 未调用模型 provider；未改 route。
- budgetUsage: 本地验证 + 一次 Feishu webhook smoke；无真实手机入站。
