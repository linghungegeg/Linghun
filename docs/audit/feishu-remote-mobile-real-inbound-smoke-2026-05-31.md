# Feishu Remote Mobile Real Inbound Smoke - 2026-05-31

## Verdict

- OUTBOUND_PASS. 使用当前进程内临时凭证发送飞书群机器人通知，平台返回 HTTP 200 / code=0 / success；未将 webhook URL 或签名写入源码、报告或配置文件。
- REAL_INBOUND_TRANSPORT_PASS. 使用官方 `@larksuiteoapi/node-sdk` 的 `WSClient` / `EventDispatcher` 建立飞书长连接，收到真实 `im.message.receive_v1` 群消息；`event_id` / `message_id` / `sender_open_id` 均 present。
- PRODUCT_BIND_PASS. 真实飞书消息形态 `/bind <code>` 经 `feishuReceiveMessageToBridgeEvent -> feishuBridgeAdapter -> handleRemoteInboundMessage` 完成 first-time binding，`trustedSources` / `bindingUserId` 更新。
- STATUS_QUERY_PASS. 真实飞书消息形态 `状态` 被归一化为 `status_query`，进入现有 remote inbound 主链并 accepted。
- NATURAL_LANGUAGE_MAIN_CHAIN_PASS. 真实飞书消息形态自然语言被归一化为 `natural_language_message`，通过现有主链 accepted，并产生 `routedText`；本轮未注入真实 model gateway，因此未发起模型调用。
- REMOTE_INBOX_PASS. 在 active model turn 模拟状态下，同一自然语言消息进入 remote inbox，结果为 queued / reason=active local turn，不抢占本地当前任务。
- APPROVAL_NOT_RUN. 本轮未构造真实 pending approval 和卡片交互；文本 approve/deny 仍由既有 focused tests 覆盖。
- 未 commit，未进入 Run 3。

## Code Fact Check

- Remote config 已支持 `appIdRef` / `appSecretRef` / `signingSecretRef` / `inboundMode` / `callbackEndpoint` / `localBridgePort`。
- D.14F/D.14F-R 主入口存在：`remote-inbound-bridge-runtime`、`processRemoteInbound`、`handleRemoteInboundMessage`、`/remote bridge doctor|pair|test-inbound|test-approval|test-status`。
- Webhook 出站和 app 长连接入站是两层：
  - `remote-transport.ts`：webhook/official CLI 出站，webhook 永远 notification-only。
  - `remote-inbound-bridge-runtime.ts`：入站 envelope 校验、pairing、adapter normalization。
  - `index.ts handleRemoteInboundMessage`：唯一 glue，进入 `processRemoteInbound -> approval/sendMessage/status` 主链。
- 本轮新增最小飞书长连接接线：
  - `packages/tui/src/feishu-long-connection-runtime.ts` 使用官方 `@larksuiteoapi/node-sdk` 的 `WSClient` + `EventDispatcher`。
  - `feishuReceiveMessageToBridgeEvent` 只做 `im.message.receive_v1` -> `RemoteAdapterInboundEvent` 转换。
  - `/remote bridge start feishu` 读取 `appIdRef` / `appSecretRef` 指向的当前 shell env，启动官方长连接，收到消息后调用现有 `handleRemoteInboundMessage`。
  - Doctor 已区分飞书长连接与公网 callback：`callbackEndpoint=feishu-long-connection` 不要求 `encryptKeyRef` / `verificationTokenRef`；webhook 仍为 notification-only。
  - adapter 不执行工具、不运行 Bash、不写文件、不建立第二套执行器。

## Feishu Backend Config Check

基于真实出站和真实长连接入站 smoke：

- 长连接是否启用：PASS，官方 SDK connected。
- 机器人是否启用：PASS，飞书群真实消息被推送到本地长连接。
- 消息事件是否订阅：PASS，收到真实 `im.message.receive_v1`。
- 卡片交互事件是否订阅：NOT RUN，本轮仅新增消息事件最小 adapter，未扩展卡片业务逻辑。
- 权限是否满足：PASS for text message receive；approval card action 未验证。

## Outbound Notification Smoke

- expected: webhook URL + signing secret 发送一条飞书群测试通知。
- actual: PASS，飞书平台返回 success。
- HTTP status: 200。
- platform code: 0。

## Real Mobile Message Cases

| case | message id | kind | expected | actual | entered main chain |
| --- | --- | --- | --- | --- | --- |
| 手机发送“状态” | present/redacted | status_query | 返回 summary/status，不打断本地任务 | PASS：真实长连接收到，主链 accepted | YES |
| 手机发送“继续开发一个最小任务…” | present/redacted | natural_language_message | 进入 sendMessage 主链；active turn 时进入 remote inbox | PASS：主链 accepted/routed；active turn 模拟 queued | YES |
| 手机 approve/deny 或卡片按钮 | NOT RUN | approval_response | 复用 pending approval；plan mode blocked | NOT RUN：未构造真实 pending approval / 卡片交互 | NO |

Focused tests 已覆盖真实 adapter 形态的本地转换与主链边界，但 fixture/mock 未标记为真实手机入站。

## Approval Case

- pending approval 是否复用：代码路径已存在，`handleRemoteInboundMessage` 在 `approval_response` 通过 `processRemoteInbound` 后复用 `pendingLocalApproval`，再调用本地 approve/deny continuation。
- plan mode 是否 blocked：代码路径已存在，`processRemoteInbound` 在 `permissionMode === "plan"` 时拒绝 remote approval，且不消费 nonce。
- real mobile approval：NOT RUN，本轮未构造真实 pending approval；飞书卡片交互事件未验证。

## Binding Case

- `/remote bridge pair feishu` + `/bind CODE`：PASS，真实飞书消息形态完成 first-time source binding，不被 `trustedSources` 卡死。
- code 一次性消费：本地 focused tests 覆盖 replay 拒绝。
- 真实手机完成绑定：PASS，`trustedSources` / `bindingUserId` 更新为 present；报告只记录 present/redacted。

## Negative Cases

- replay：PASS，真实消息形态重复 messageId 被拒绝为 `replayed`。
- expired：focused tests PASS。
- wrong binding / wrong source：PASS，真实消息形态 wrong source 被拒绝为 `unknown_source`；既有 focused tests 覆盖 wrong binding。
- fixture/mock 不能标记为 real mobile inbound：focused tests PASS。
- webhook channel 尝试入站：既有能力分级保持 notification-only。

## Dependency Note

- 新增 `@larksuiteoapi/node-sdk` 到 `@linghun/tui`。
- 原因：现有代码只有 webhook/official CLI 出站与本地 fixture 入站，没有飞书开放平台长连接 listener；真实手机入站需要官方 SDK 的 `WSClient` / `EventDispatcher`。
- 未改 package manager；只更新 `packages/tui/package.json` 和 `pnpm-lock.yaml`。

## Validation

- `corepack pnpm exec tsc --noEmit` -> PASS。
- `corepack pnpm typecheck` -> PASS。
- `corepack pnpm --filter @linghun/tui exec vitest run src/feishu-long-connection-runtime.test.ts` -> PASS，7 tests passed。
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts --% -t "remote bridge|Feishu|bind|approval"` -> PASS，18 tests passed。
- `corepack pnpm --filter @linghun/tui build` -> PASS。
- `git diff --check` -> PASS。

## Secret Scan

- webhook URL 未落盘：PASS，未发现本轮真实 webhook token。
- signing secret 未落盘：PASS，未发现本轮真实 signing secret。
- App Secret 未落盘：PASS，未发现本轮真实 App Secret。
- raw endpoint 未落盘：PASS，报告和源码未写真实 endpoint；既有测试中有假 webhook 示例 URL。
- 扫描说明：精确扫描真实 token/signature/App ID/App Secret 特征无命中；本轮改动文件的泛化扫描仅出现 `task-scroll` 这类 `sk-` 误报。

## Git Status Short

```text
 M packages/tui/package.json
 M packages/tui/src/index.ts
 M packages/tui/src/remote-command-runtime.ts
 M packages/tui/src/remote-inbound-bridge-runtime.ts
 M pnpm-lock.yaml
?? .claude/
?? docs/audit/feishu-remote-mobile-real-inbound-smoke-2026-05-31.md
?? packages/tui/src/feishu-long-connection-runtime.test.ts
?? packages/tui/src/feishu-long-connection-runtime.ts
```

`.claude/` 为本轮开始前已有未跟踪目录，未修改。

## Final Notes

- 未 commit。
- 未进入 Run 3。
- 未改 provider/env/key/model route。
- 未改权限四档语义。
- 未恢复本地自然语言关键词截获。
- 未把 fixture/mock 当真实手机入站。
