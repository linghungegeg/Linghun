# Phase 15 OpenAI-compatible endpoint/profile maturity fix

本报告记录 Phase 15 real-project Beta 前发现的 OpenAI-compatible endpoint/profile 成熟度缺口修复。范围只限 provider `baseUrl` 归一化、`/model doctor` 诊断、HTTP 400/502 错误提示和对应测试；未进入 Phase 15.5 / Phase 16+，也不宣布 Beta PASS。

## Reference behavior

参考 CCB / OpenAI-compatible 常见成熟行为，本轮只采用行为边界，不复制源码实现：

- OpenAI-compatible API-key 路径默认走 Chat Completions。
- 用户配置的 `OPENAI_BASE_URL` 应是根路径，例如 `https://example.com/v1`。
- 底层请求再按 profile 拼接 `/chat/completions` 或 `/responses`。
- 状态/doctor 必须让用户看清 provider、baseUrl 是否存在、model、endpointProfile、compatibilityProfile 和最终 endpoint path。
- 普通 OpenAI-compatible Chat Completions 与 Responses 路径不能混成用户必须猜的配置。

## Linghun previous behavior

修复前的 Linghun 行为：

- `LINGHUN_OPENAI_BASE_URL` 只 strip trailing slash。
- 请求 URL 按 `endpointProfile` 直接拼接 `/chat/completions` 或 `/responses`。
- 如果用户把 `baseUrl` 填成 `https://example.com/v1/responses` 或 `https://example.com/v1/chat/completions`，容易形成重复或错配 endpoint，例如 `/responses/responses` 或 `/responses/chat/completions`。
- `/model doctor` 已显示部分 provider/profile 信息，但没有明确展示最终 endpoint path，也没有对 full-endpoint baseUrl 给出 root baseUrl 修复建议。
- HTTP 400 主要提示 schema/profile/model mismatch；HTTP 502 仍偏“服务端异常”，对 OpenAI-compatible gateway endpointProfile 不支持或 base_url 填错的提示不够明确。

## Fix

本轮最小修复：

- `packages/providers/src/index.ts`
  - 新增 `resolveProviderBaseUrlDiagnostic(...)`，识别 `baseUrl` 是否以 `/responses` 或 `/chat/completions` 结尾。
  - 对 full-endpoint `baseUrl` 归一为 root baseUrl，再按当前 `endpointProfile` 拼接 endpoint。
  - 最终请求不会出现 `/responses/responses`、`/responses/chat/completions` 这类重复/错配路径。
  - 只归一化请求 URL 和 doctor 诊断；不静默切换 `endpointProfile`，不做自动 fallback。
  - HTTP 502 在 OpenAI-compatible provider 下增加 endpointProfile/base_url/gateway 支持方向的建议。
  - HTTP 400 保持 schema/profile/model mismatch 方向，并将未知 provider body hint 收敛为脱敏摘要，避免把 prompt、本地路径或 key 透出到错误信息。

- `packages/tui/src/index.ts`
  - `/model route doctor` 的 provider 行显示：`provider`、`model`、`endpointProfile`、`compatibilityProfile`、`baseUrl=present/missing`、`endpointPath`、tools、includeUsage、reasoning、apiKey present/masked。
  - 对 `baseUrl` 包含完整 endpoint suffix 的配置输出 warning 和 recommendation：`baseUrl` 应填根路径，例如 `https://example.com/v1`，`endpointProfile` 使用 `chat_completions` 或 `responses`。
  - 对 `baseUrl` suffix 与当前 `endpointProfile` 不一致的情况输出 `profile/baseUrl 不匹配`。
  - API key 仅显示 present 与 masked，不输出完整 key。

未做事项：

- 不改变默认 OpenAI-compatible Chat Completions 路径。
- 不自动切换 endpointProfile。
- 不做 Responses/Chat 自动 fallback。
- 不进入 Phase 15.5 / Phase 16+。
- 不宣布 Phase 15 Beta PASS。

## Tests

新增/更新测试覆盖：

- `packages/providers/src/index.test.ts`
  - `baseUrl=https://example.com/v1` + `chat_completions` -> 请求 `https://example.com/v1/chat/completions`。
  - `baseUrl=https://example.com/v1` + `responses` -> 请求 `https://example.com/v1/responses`。
  - `baseUrl=https://example.com/v1/responses` + `responses` -> 请求 `https://example.com/v1/responses`，不会请求 `/responses/responses`。
  - `baseUrl=https://example.com/v1/responses` + `chat_completions` 的 diagnostic 标记 `profileMismatch=true`，最终 endpoint path 为 `/v1/chat/completions`。
  - HTTP 400 诊断包含 profile/schema/model 方向，且不泄漏 api key、prompt、本地路径。
  - OpenAI-compatible HTTP 502 诊断包含 endpointProfile/base_url/gateway 方向，且不泄漏 api key 或 prompt。

- `packages/tui/src/index.test.ts`
  - `/model route doctor` 在 OpenAI-compatible full-endpoint `baseUrl` 与 `endpointProfile` 不匹配时输出 warning、recommendation、`endpointPath` 和 `profile/baseUrl 不匹配`。
  - `/model route doctor` 只显示 apiKey present/masked，不输出完整 key。
  - 更新既有 doctor 断言，覆盖 provider/model/baseUrl present/final endpoint path。

已先执行 focused 验证：

```bash
corepack pnpm exec vitest run packages/providers/src/index.test.ts packages/tui/src/index.test.ts
```

结果：PASS，2 个测试文件，126 个测试通过。

## Remaining risks

- 本轮只覆盖 OpenAI-compatible `baseUrl` endpoint suffix 归一化和诊断，不验证所有第三方网关的 live 行为。
- Doctor 只给建议，不替用户修改配置；用户仍需把 `baseUrl` 改为 root，例如 `https://example.com/v1`，并选择正确 `endpointProfile`。
- HTTP 502 仍可能由 provider 网关、网络、账号、限流或模型服务异常导致；本轮只让 OpenAI-compatible 场景的排查方向更明确。
- Responses 与 Chat Completions schema 仍保持显式 profile 分离；不会为了“看起来能跑”自动 fallback。
- Phase 15 Beta readiness 仍不得从本轮 focused PASS 或后续本地 PASS 自动推断为 PASS，是否进入 Beta 仍需用户明确确认。
