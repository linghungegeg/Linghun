# Phase 14F Bot Unified Remote Bot Productization

## Verdict

- FEISHU_BOT_READY: PARTIAL. `/remote bot setup|start|stop|pair|doctor|inbox` is wired and reuses the existing Feishu long-connection path; real smoke was NOT RUN in this round because no real Feishu env/mobile message was provided.
- DINGTALK_BOT_READY: PARTIAL / NOT RUN. Offline Stream bot message normalization and Bot UX are present; real Stream connection is NOT RUN without DingTalk Client ID/Client Secret and a published Stream bot.
- WECHAT_BOT_EXPERIMENTAL_READY: BLOCKED. Personal WeChat is experimental, default blocked, and not backed by a bundled core dependency or fake inbound.

## User Experience Changes

- Main recommended path is now Bot-first:
  - `/remote bot doctor [channel]`
  - `/remote bot setup feishu|dingtalk|wechat`
  - `/remote bot start feishu|dingtalk|wechat`
  - `/remote bot stop <channel>`
  - `/remote bot pair <channel>`
  - `/remote bot inbox`
- Old `/remote bridge ...` and `/remote setup ...` remain compatible.
- Normal Bot output speaks in Bot states: ready, needs app id, needs app secret, needs client id, needs client secret, running, blocked, experimental.
- Internal fields remain out of the ordinary Bot path: `trustedSources`, `bindingUserId`, `inboundMode`, `callbackEndpoint`, `verificationTokenRef`, `encryptKeyRef`, nonce/signature/messageId, QR/session tokens, and raw endpoints.

## Platform Matrix

| Platform | notification | real inbound | bind | status | natural language | approval | inbox guard |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Feishu Bot | ready via existing notification/long-connection base | PARTIAL; long connection runtime present, real smoke NOT RUN this round | ready via `/remote bot pair feishu` + `/bind CODE` | ready through existing main chain | ready through existing main chain | ready through existing pending approval chain | ready |
| DingTalk Bot | existing notification path remains | offline adapter only; real Stream NOT RUN | pair code can be created, real source binding NOT RUN | fixture/adapter path only | fixture/adapter path only | fixture/adapter path only | ready after main-chain validation |
| Personal WeChat Bot | not enabled | BLOCKED experimental | blocked | blocked | blocked | blocked | no fake queue |

## Implementation

- `packages/tui/src/remote-command-runtime.ts`
  - Added `/remote bot ...` command wrapper.
  - `/remote bot start feishu` reuses `startRemoteFeishuBridge`, which uses existing `startFeishuLongConnection`.
  - `/remote bot stop feishu` closes the in-process long connection handle.
  - `/remote bot pair <channel>` reuses `createRemotePairing`.
  - `/remote setup` now recommends `/remote bot setup` while preserving legacy setup details for compatibility.
- `packages/tui/src/remote-inbound-bridge-runtime.ts`
  - Added `dingtalkStreamFrameToBridgeEvent` for conservative offline DingTalk Stream bot-message normalization.
  - DingTalk adapter still only produces `RemoteInboundMessage`; it does not execute tools, Bash, Git, jobs, or a second executor.
- `packages/tui/src/index.ts`
  - Only re-exports the DingTalk Stream normalizer for tests/consumers; no Bot business logic was added to `index.ts`.
- `packages/tui/src/index.test.ts`
  - Added focused D.14F-Bot coverage for routing, Feishu start reuse, DingTalk Stream fixture normalization, WeChat blocked behavior, and redaction.

## Real Vs Fixture

- Real platform smoke:
  - Feishu: NOT RUN in this round. Existing prior evidence remains in `docs/audit/feishu-remote-mobile-real-inbound-smoke-2026-05-31.md`; this round did not use real credentials.
  - DingTalk: NOT RUN. Missing real Client ID/Client Secret, published Stream bot, and mobile test session.
  - Personal WeChat: NOT RUN / BLOCKED. No opted-in plugin bridge or QR session.
- Fixture/offline:
  - DingTalk Stream bot message fixture normalizes to `RemoteInboundMessage`.
  - Feishu Bot start test uses an injected long-connection stub and proves reuse of `handleRemoteInboundMessage`.
  - No fixture is reported as real mobile inbound PASS.

## Security And Secrets

- No real webhook, key, App Secret, Client Secret, sessionWebhook, WeChat QR/session token, provider key, or raw endpoint was added to source, tests, or report.
- DingTalk `sessionWebhook` is treated as secret-like and is not copied into `RemoteInboundMessage`.
- Personal WeChat explicitly redacts puppet tokens, QR payload/image, session files, wxid/openid/unionid, cookies, device data, and provider endpoint credentials.
- Webhook remains notification-only; inbound requires official app/Stream/long-connection proof and still enters the existing validation chain.

## Source Boundary

- `index.ts` remains glue-only for this stage. The only change is a re-export.
- Bot command behavior lives in `remote-command-runtime.ts`.
- Platform normalization lives in `remote-inbound-bridge-runtime.ts`.
- No second executor was added. Remote natural language still routes through the existing `RemoteInboundMessage -> handleRemoteInboundMessage -> processRemoteInbound -> decideRemoteInbox/sendMessage` path.

## Reference Check

- Read Linghun docs:
  - `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
  - `LINGHUN_IMPLEMENTATION_SPEC.md`
  - `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
  - `docs/delivery/README.md`
  - `docs/delivery/phase-17b-remote-channels.md`
  - `docs/delivery/phase-14F-remote-mobile-bridge-productization.md`
  - `docs/audit/feishu-remote-mobile-real-inbound-smoke-2026-05-31.md`
- Source audit:
  - `packages/tui/src/remote-command-runtime.ts`
  - `packages/tui/src/remote-inbound-bridge-runtime.ts`
  - `packages/tui/src/feishu-long-connection-runtime.ts`
  - `packages/tui/src/remote-transport.ts`
  - `packages/tui/src/index.ts`
  - `packages/config/src/index.ts`
- Public references:
  - DingTalk official/open package facts: `dingtalk-stream`, current npm version `2.1.6-beta.1`, Client ID / Client Secret, Stream bot topic `/v1.0/im/bot/messages/get`, card callback topic `/v1.0/card/instances/callback`.
  - Wechaty facts: `wechaty` npm version `1.20.2`; personal WeChat depends on third-party puppet/provider/token routes and remains inappropriate as a core default dependency.
- No questionable source, internal API, proprietary telemetry, or reverse-engineered implementation was copied.

## Validation

- `corepack pnpm exec tsc --noEmit` -> PASS.
- `corepack pnpm typecheck` -> PASS.
- `corepack pnpm --filter @linghun/tui typecheck` -> PASS.
- `corepack pnpm --filter @linghun/tui exec vitest run src/feishu-long-connection-runtime.test.ts` -> PASS, 7 passed.
- `corepack pnpm --filter @linghun/tui exec vitest run src/remote-mcp-presenter.test.ts src/remote-transport.test.ts` -> PASS, 20 passed.
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts --% -t "D.14F-Bot"` -> PASS, 4 passed.
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts --% -t "remote bot|remote bridge|Feishu|DingTalk|WeChat|bind|approval"` -> PASS, 20 passed.
- Original requested `corepack pnpm --filter @linghun/tui exec vitest run src/remote*.test.ts` -> NOT RUN as written on this shell: Vitest did not expand the glob and returned "No test files found"; rerun with explicit remote test filenames passed.

## Known Issues / Not In This Stage

- No DingTalk real Stream connection is started in this patch.
- DingTalk card callback remains NOT RUN because official Node payload typing is not stable enough without real samples.
- Personal WeChat remains experimental blocked; no Wechaty/PadLocal dependency was added.
- Enterprise WeChat is future/not implemented in this Bot productization stage.
- This is not Run 3 and no commit was made.

## Addendum: D.14F-Bot P1 First-Time Binding Fix

- P1 fixed: Feishu Bot start readiness is now separated from ordinary inbound readiness.
- `/remote bot start feishu` can start the Bot before binding when Feishu app refs and current shell env values are present, allowing the long connection to wait for `/bind CODE`.
- Ordinary inbound messages still go through the existing trusted source, binding, proof, replay, and expiry validation path.
- Webhook remains notification-only and was not converted into an inbound channel.
- Feishu real smoke was not rerun in this round. Existing real-platform evidence remains in `docs/audit/feishu-remote-mobile-real-inbound-smoke-2026-05-31.md`.

## Handoff Packet

- nextPhase: wait for user confirmation before real DingTalk/WeChat credential work or Run 3.
- prohibited: do not commit; do not enter Run 3; do not alter provider/env/key/model route; do not change permission modes; do not restore local natural-language keyword interception; do not fake real mobile inbound; do not add WeCom adapter in this stage; do not add Wechaty as a core default dependency.
- evidence: validation commands above; subagent source audit confirmed Feishu main chain reuse and index.ts glue boundary.
- indexStatus: no index rebuild; source facts confirmed with `rg`, file reads, and subagent audit.
- permissionMode: unchanged; remote approval still uses local pending approval and plan-mode block.
- provider/model: no provider calls and no route changes.
- budgetUsage: local tests and npm metadata checks only; no real platform credential spend.
