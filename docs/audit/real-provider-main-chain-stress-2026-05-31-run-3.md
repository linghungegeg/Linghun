# Real Provider Main Chain Stress Smoke — 2026-05-31 Run 3

本轮包含两层口径：Initial Run 3 是开源前 release-candidate 主链深压，只记录真实结果；Run 3 Closure 只处理报告残留项，不开新阶段、不重构、不 commit。临时 provider / Feishu 凭据仅用于当前进程网络请求；本报告不写入 raw key、raw webhook、raw signing secret、raw App Secret 或完整 endpoint。

结论先行：Closure 后 full TUI / typecheck / build 已绿；OpenAI-compatible 配置诊断与 `/remote setup` invariant 已收口；唯一剩余红项是 root `corepack pnpm check` 的 `111` 个历史 Biome baseline。Initial Run 3 的 provider、Feishu、缓存与真实入站边界仍保留原始记录：Feishu real mobile inbound 本轮 NOT RUN，DingTalk / WeChat real inbound NOT RUN，cache hit 不用 Run 3 数据宣传。

---

## 1. 测试环境

| 项 | 值 |
| --- | --- |
| OS / shell | Windows / PowerShell |
| 仓库 | `F:\Linghun` |
| 压测前 HEAD | `9eadb2e Close Feishu remote mobile real inbound smoke` |
| 压测前 git status | only `?? .claude/` |
| 压测方式 | package tests + provider runtime direct stream + Feishu webhook/long-connection smoke |
| 是否修复源码 | No |
| 是否 commit | No |
| 密钥处理 | 当前进程内使用；未写 provider.env、源码、测试或报告 |

---

## 2. Preflight / 本地验证

### 2.1 Initial Run 3

| 项 | 结果 | 备注 |
| --- | --- | --- |
| `corepack pnpm exec tsc --noEmit` | PASS | Run 3 start preflight |
| `corepack pnpm typecheck` | PASS | Run 3 start preflight |
| `@linghun/providers vitest` | PASS, 118 tests | provider fixture 已绿 |
| `@linghun/tools vitest` | PASS, 11 tests | Windows timeout/cancel fixture 通过 |
| `@linghun/cli vitest` | PASS, 8 tests | CLI baseline 通过 |
| TUI build | PASS | `@linghun/tui build` |
| CLI build | PASS | `@linghun/cli build` |
| `git diff --check` | PASS | 压测前后均干净 |
| full TUI vitest | FAIL, 1 failed | 仅 `advanced-slash-panel-invariant.test.ts` 失败 |
| `corepack pnpm check` | FAIL | 124 errors / 1 warning；主要是历史 format/import/lint 噪音 |

### 2.2 Closure 后

| 项 | 结果 | 备注 |
| --- | --- | --- |
| `corepack pnpm exec tsc --noEmit` | PASS | Closure 复跑 |
| `corepack pnpm typecheck` | PASS | Closure 复跑 |
| full TUI vitest | PASS | final rerun, 52 files / 2042 tests |
| `@linghun/providers vitest` | PASS | 120 tests |
| `@linghun/cli vitest` | PASS | rerun, 8 tests |
| TUI build | PASS | `@linghun/tui build` |
| CLI build | PASS | `@linghun/cli build` |
| `git diff --check` | PASS | Closure 复跑 |
| `corepack pnpm check` | FAIL | 111 historical Biome baseline errors remain |

---

## 3. 真实 Provider 结果

### 3.1 文本流式 smoke

| Case | 配置 | 结果 | 数据 |
| --- | --- | --- | --- |
| DeepSeek 用户口径模型名 | 用户填写的 “deepseek v4 pro” | FAIL | HTTP 400 `PROVIDER_BAD_REQUEST`；模型名/请求格式不被 provider 接受 |
| DeepSeek official chat | official chat model | PASS | 717 ms；10 chunks；usage total 23；endpoint `/v1/chat/completions` |
| OpenAI-compatible root + chat_completions | root baseUrl + chat profile | FAIL | HTTP 200 但 `content-type=text/html`，正确归类 `PROVIDER_NON_SSE_STREAM` |
| OpenAI-compatible root + responses | root baseUrl + responses profile | PASS | 2210 ms；usage total 41；endpoint `/v1/responses` |
| OpenAI-compatible `/v1` + chat_completions | `/v1` baseUrl + chat profile | PASS | 1577 ms；usage total 41；endpoint `/v1/chat/completions` |
| OpenAI-compatible `/v1` + responses | `/v1` baseUrl + responses profile | PASS | 2935 ms；usage total 30；endpoint `/v1/responses` |

结论：provider runtime 的 SSE/content-type 防线有效。OpenAI-compatible 网关可用，但默认配置引导需要更低学习：用户给 root baseUrl 时，`responses` 能通，`chat_completions` 会命中 HTML 页面；写成 `/v1` 后 chat/responses 都能通。

### 3.2 工具调用 smoke

| Case | 结果 | 数据 |
| --- | --- | --- |
| OpenAI-compatible `/v1` + chat tools | PASS | 真实产出 `EchoTool` tool_use，finishReason=`tool_calls`，usage total 85 |
| OpenAI-compatible root + responses tools | PASS | 真实产出 `EchoTool` tool_use，usage total 85 |
| DeepSeek chat + tools disabled | PASS as guard | 本地拒绝 `MODEL_TOOLS_UNSUPPORTED`，没有静默删 tools 后伪装成功 |

结论：工具调用稳定性在可用 OpenAI-compatible 配置下通过。DeepSeek 当前按 `supportsTools=false` 走硬边界，符合安全预期。

### 3.3 短 soak

| Provider path | Iterations | Result | Latency |
| --- | --- | --- | --- |
| DeepSeek official chat | 3 | 3/3 PASS | 739 / 777 / 875 ms |
| OpenAI-compatible `/v1` chat | 3 | 3/3 PASS | 3384 / 2145 / 1965 ms |
| OpenAI-compatible root responses | 3 | 3/3 PASS | 1848 / 1874 / 1667 ms |

usage/rawUsage 均存在。cacheRead 本轮均为 0；报告不推断缓存命中率，也不把 unsupported/empty cache 字段包装成命中。

---

## 4. Feishu Remote / Bot 结果

| Case | 结果 | 备注 |
| --- | --- | --- |
| Feishu webhook outbound | PASS | HTTP 200；platform code 0；notification-only 仍按 notification-only 记录 |
| Feishu official long connection start | PASS | SDK 输出 ready；`startFeishuLongConnection` resolve 并返回 handle |
| Feishu long connection start/stop with wait | PARTIAL | 首次脚本等待 60s 超时，二次 settle probe 证明 start 已 resolve；这更像脚本等待常驻连接方式不当 |
| Feishu real mobile inbound message | NOT RUN in Run 3 | 本轮没有现场手机发送消息；此前报告已有真实入站证据，但不冒充本轮新证据 |
| DingTalk bot real inbound | NOT RUN | 无真实凭据 |
| Personal WeChat bot real inbound | NOT RUN | 当前产品层仍 experimental blocked，不引 Wechaty，不伪造 QR smoke |

结论：Feishu 已具备真实出站和 official long-connection 启动能力；手机真实入站闭环需要现场用户消息或独立守护进程继续压，不应从本轮自动推断 PASS。

---

## 5. 主链 Focused 回归

| 模块 | 结果 |
| --- | --- |
| D.13U / D.13V final gate / git_operation | PASS, 63 passed |
| Git stable / worktree / index / failure / permission / remote filtered | PASS, 49 passed |
| remote transport + Feishu long connection adapter | PASS, 22 passed |
| Git operation + Git tool + failure learning | PASS, 76 passed |
| provider transit / circuit breaker / model doctor / setup | PASS, 159 passed |
| Shell view-model / scroll / permission elevation / footer / transcript | PASS, 333 passed |
| advanced slash panel invariant | FAIL, 1 failed / 26 passed |

重要事实：业务主链 focused 大面积通过，但 full TUI 被同一个不变式测试拖住，不能宣称“全量绿”。

---

## 6. Findings

### P0

无。未观察到越权写入、危险命令绕过、key/baseUrl 落盘、webhook mock 冒充真实 PASS、fixture 冒充手机真实入站。

### P1

无新的 P1。Run 2 中的稳定点/plan/final-gate/large-file guard 等关键项，本轮 focused 均通过或未复现阻塞。

### P2

**P2-1 advanced slash CommandPanel source invariant 未随 Bot UX 更新。**

- 现象：`src/advanced-slash-panel-invariant.test.ts` 断言 `/remote setup` 必须直接包含 `detailsText: formatRemoteSetup(args[1], context)`。
- 当前源码已经改为 Bot-first setup details，再拼 legacy setup compatibility details，因此测试字符串不再匹配。
- 影响：full TUI vitest 仍失败 1 项；开源前不应保留全量红。
- 定性：更像测试/source invariant 陈旧，不是用户功能主链坏；但发布口径上仍是 P2。

**P2-2 OpenAI-compatible root baseUrl + chat_completions 低学习配置失败。**

- 现象：用户给 root baseUrl 时，chat profile 拼 `/chat/completions` 后返回 HTML 页面，runtime 正确报 `PROVIDER_NON_SSE_STREAM`。
- 可用路径：root + responses PASS；`/v1` + chat PASS；`/v1` + responses PASS。
- 影响：用户照“填必要字段”的直觉配置时容易踩坑，doctor/setup 应该给更明确建议或自动检测 profile/baseUrl 组合。

**P2-3 root `pnpm check` 仍不绿。**

- 现象：`corepack pnpm check` 报 124 errors / 1 warning，主要为历史 formatter、import order、lint 噪音。
- 影响：开源仓库第一印象和 CI 可读性受影响；虽然 typecheck/build/test focused 多数通过，但 check 不绿会降低外部信任。

### P3

**P3-1 provider live smoke 脚本易误测。**

- 现象：压测脚本显式传 `toolChoice:"none"` 时，provider runtime 把它视为工具控制字段，在 `supportsTools=false` 时拒绝。
- 复核：不传 `toolChoice` 后纯文本 smoke 正常通过。
- 定性：不是 runtime 主链 bug，更像 smoke harness 写法要贴近真实请求。

**P3-2 Feishu long-connection smoke 需要专用 harness。**

- 现象：直接 start 后等待消息的脚本容易把常驻连接误判成 timeout。
- 复核：settle probe 显示 SDK ready 且 start resolved。
- 建议：后续做一个明确的 start/ready/close smoke，避免测试脚本误导。

---

## 7. Release Readiness Verdict

### 7.1 Initial Run 3

Initial Run 3 结论是 **PARTIAL / not release-blocker-clean**。

可以肯定的能力：

- 真实 DeepSeek official 文本流可用。
- 真实 OpenAI-compatible 文本流与 tool_use 在正确配置下可用。
- provider 非 SSE/HTTP 400 能被清楚归类，不空口成功。
- Feishu webhook 出站和 official long connection start 可用。
- Git、index、permission、failure learning、final gate、remote bridge、shell view-model 等 focused 主链回归大面积通过。

不能越界宣传的点：

- full TUI 仍有 1 个 P2 测试失败，不能写“全量绿”。
- Feishu 本轮没有现场手机真实入站消息，不能把本轮标成 real mobile inbound PASS。
- DingTalk / WeChat Bot 未做真实入站。
- 本轮 cacheRead 为 0，不能用这轮数据宣传缓存命中率。

### 7.2 Closure 后

Closure 后结论是 **tests mostly green / check baseline remains**。

- full TUI、typecheck、TUI build、CLI build、providers vitest、CLI vitest 均已绿。
- P2-1 `/remote setup` CommandPanel invariant 已收口。
- P2-2 OpenAI-compatible root baseUrl + `chat_completions` 低学习诊断已收口，未放松 SSE/content-type 检查。
- 唯一剩余红项是 root `corepack pnpm check`：仍有 `111` 个历史 Biome baseline errors。
- NOT RUN 边界不变：Feishu real mobile inbound 本轮未跑，DingTalk / WeChat real inbound 未跑，cache hit 不用 Run 3 宣传。

---

## 8. 下一轮修复建议

### 8.1 Initial Run 3 原始建议

Initial Run 3 曾建议修 P2-1 `/remote setup` invariant、P2-2 OpenAI-compatible 诊断、P2-3 root `pnpm check`、以及 Feishu real inbound harness。Closure 后，P2-1 / P2-2 已完成，不再作为下一轮建议。

### 8.2 Closure 后剩余事项

1. root Biome hygiene：单独收敛 `corepack pnpm check` 剩余 `111` 个历史 baseline；如果 CI 默认跑 check，开源前必须绿，或明确不作为硬门禁。
2. Feishu real mobile inbound：用真实手机消息单独跑 `/bind CODE` / `状态` / 普通自然语言；无现场消息时只能 NOT RUN。
3. DingTalk / WeChat real inbound：后续只在真实凭据和真实平台消息下验证，不用 mock/fixture 冒充 PASS。
4. 缓存命中专项压测：单独设计 cache hit / read-token 收益测试；Run 3 cacheRead 为 0，不能用于宣传命中率。

---

## 9. Secret Hygiene

### 9.1 Initial Run 3

报告正文未写入用户提供的 raw provider key、raw Feishu webhook URL、raw signing secret、raw App ID 或 raw App Secret。

最终精确扫描结果：

| Pattern | Result |
| --- | --- |
| DeepSeek raw key | clean |
| OpenAI-compatible raw key | clean |
| Feishu webhook hook id | clean |
| Feishu signing secret | clean |
| Feishu App ID | clean |
| Feishu App Secret | clean |

Initial Run 3 压测结束 git status：`?? .claude/`、`?? docs/audit/real-provider-main-chain-stress-2026-05-31-run-3.md`。Initial Run 3 除新增本报告外未修改源码。

### 9.2 Closure 后

Closure 后实际 git status：

- 6 个源码/测试文件 modified：`packages/providers/src/index.test.ts`、`packages/providers/src/index.ts`、`packages/tui/src/advanced-slash-panel-invariant.test.ts`、`packages/tui/src/feishu-long-connection-runtime.test.ts`、`packages/tui/src/model-doctor-runtime.test.ts`、`packages/tui/src/model-doctor-runtime.ts`。
- `docs/audit/real-provider-main-chain-stress-2026-05-31-run-3.md` untracked。
- `.claude/` untracked。
- 未 commit。

Closure 后 secret scan 继续保持 clean：报告不含真实 provider key、Feishu webhook、signing secret、App ID、App Secret；报告也不写完整 baseUrl endpoint。

---

## 10. Run 3 Closure Addendum

本次 Closure 只处理 Run 3 报告残留项，不开新阶段、不重构、不 commit。未修改 provider route/env/key/model 的真实选择策略，未放松 provider SSE 检查，未恢复自然语言关键词截获，未把 fixture/mock 冒充真实平台 PASS。

### 10.1 已收口项

| 项 | Closure 结果 | 说明 |
| --- | --- | --- |
| P2-1 advanced slash CommandPanel invariant | DONE | 更新 source invariant：`/remote setup` 仍必须走 `showCommandPanel`；Bot-first details 保留；legacy `formatRemoteSetup(args[1], context)` 仍必须在 compatibility details 区；禁止裸 `writeLine(output, formatRemoteSetup(...))`。 |
| P2-2 OpenAI-compatible 低学习配置体验 | DONE | `/model doctor` 与 provider non-SSE suggestion 增加通用提示：root baseUrl + responses 可能可用；chat_completions 通常需要 `/v1` root；如果返回 `content-type=text/html`，baseUrl 可能填到了网页登录页或少了 `/v1`。未放松 SSE/content-type 检查。 |
| P2-3 root `pnpm check` 盘点 | PARTIAL / documented | 本轮只格式化/收敛触碰文件；root check 仍有历史 Biome baseline 噪音，未批量格式化约 69 个历史文件，避免污染 Closure diff。 |
| P3-1 live provider smoke harness 易误测 | DONE as guard | 当前 root `smoke:live-provider` 纯文本请求不发送 tools/toolChoice；新增 provider 回归：`supportsTools=false` 的纯文本请求不输出 `tools/tool_choice`，但 `toolChoice`-only 或真实 tools 请求仍抛 `MODEL_TOOLS_UNSUPPORTED`，不静默删字段。 |
| P3-2 Feishu long connection smoke harness | PARTIAL / test guarded | 增加 start/ready/close 语义测试：start resolved 后可 stop/close；不会把 start smoke 写成 REAL_INBOUND_PASS。真实手机 inbound 本轮仍是 NOT RUN。 |

### 10.2 仍未运行 / 不宣称

- Feishu real mobile inbound：NOT RUN。本轮没有现场手机发送消息；start/ready/close smoke 只证明长连接启动与关闭路径。
- DingTalk bot real inbound：NOT RUN。无真实凭据/现场平台消息。
- Personal WeChat bot real inbound：NOT RUN。当前仍 experimental blocked。
- Cache hit 真实收益：NOT CLAIMED。本轮不因 cacheRead 为 0 或 fixture 字段宣传缓存命中率。

### 10.3 `pnpm check` 现状

子任务只读盘点显示，Closure 前 root `corepack pnpm check` 为 `124 errors / 1 warning`，主要是既有 Biome `format` 与 `organizeImports` 噪音，夹少量风格 lint，横跨约 69 个历史文件。

Closure 中只对本轮触碰文件做 `biome check --write` 与少量低风险 lint 收敛；复跑 root `corepack pnpm check` 仍失败，但降为 `111 errors`。剩余仍是历史 baseline 噪音，典型包括：

- `packages/core/src/session-store.test.ts` format。
- `packages/tui/src/cache-command-runtime.ts` format/import。
- `packages/tui/src/cache-freshness.test.ts` format。
- `packages/config/src/index.ts` format。
- `packages/tui/src/git-*` 相关 format/import/lint。
- 多个 TUI extension / handoff / index 工具文件的 format/import。

结论：如果 CI 默认跑 root `corepack pnpm check`，当前仍会失败；开源前必须单独开 hygiene 批次清理 Biome baseline，或明确 CI 暂不把 root check 作为硬门禁。本轮不做大面积格式化，避免把 Run 3 Closure 与 69 文件无语义 diff 混在一起。

### 10.4 Closure 验证结果

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm exec tsc --noEmit` | PASS |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm --filter @linghun/tui exec vitest run src/advanced-slash-panel-invariant.test.ts` | PASS, 27 tests |
| `corepack pnpm --filter @linghun/tui exec vitest run` | PASS on final rerun, 52 files / 2042 tests |
| `corepack pnpm --filter @linghun/providers exec vitest run` | PASS, 120 tests |
| `corepack pnpm --filter @linghun/cli exec vitest run` | PASS on rerun, 8 tests |
| `corepack pnpm --filter @linghun/tui build` | PASS |
| `corepack pnpm --filter @linghun/cli build` | PASS |
| `corepack pnpm check` | FAIL, 111 historical Biome baseline errors remain |
| `git diff --check` | PASS |

备注：一次 full TUI run 曾在 `dist-integrity.test.ts` 动态 import 5 秒超时；单独复跑该测试 PASS，随后完整 TUI 复跑 PASS。一次 CLI vitest 与 TUI build 并发时曾因 `@linghun/tui` dist 入口被清理而失败；TUI build 完成后复跑 CLI vitest PASS。

### 10.5 Secret Hygiene

Closure diff 与本报告 addendum 未写入 raw provider key、Feishu webhook、signing secret、App ID、App Secret 或完整 baseUrl endpoint。新增测试只使用 fake `sk-test-*` / `test-*` 哨兵值和公开示例域，不包含用户真实凭据。
