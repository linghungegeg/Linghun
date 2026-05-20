# Phase 15 project settings API-key safety fix

本报告记录 Phase 15 real-project Beta 前的最小敏感配置成熟度修复。范围只限 API key 配置来源、`/model doctor` 显示、项目 settings 安全边界、测试与审计说明；未进入 Phase 15.5 / Phase 16+，也不宣布 Beta PASS。

## Reference behavior

参考 CCB / OpenAI-compatible / provider 配置成熟边界，本轮只采用行为边界，不复制源码实现：

- OpenAI-compatible / provider key 不应写入项目级配置作为常规路径。
- provider 类型、`baseUrl`、`model`、`endpointProfile` 等非敏感字段可以保存在项目配置中。
- API key 优先使用环境变量，或用户级私有/受控配置；本轮不实现完整 OS keychain 或密钥市场。
- doctor/status 只能显示 `apiKey=present|missing`、`source` 与 masked preview，不显示原值。
- 报告、transcript、日志和仓库文档不得写入真实 key。
- 如果项目 `.linghun/settings.json` 中存在 provider `apiKey`，doctor 应给出明确 WARN 与迁移建议。

## Linghun previous behavior

修复前的 Linghun 行为：

- `loadConfig()` 会兼容读取项目 `.linghun/settings.json` 中的 provider `apiKey`，且环境变量优先级已经高于项目配置。
- `/model doctor` / `/model route doctor` 已能 masked 显示 key，但 source 只显示环境变量名或笼统的 `.linghun/settings.json or merged config`，没有区分 `project-settings` / `user-settings`。
- 项目级 `apiKey` 存在时，doctor 没有明确提示“项目 settings 不建议保存 apiKey，应迁移到 env 或用户级私有配置”。
- `saveDefaultModel()`、`saveModelRoute()`、`saveExtensionEnablement()` 会通过 `writeConfig()` 将合并后的完整 config 写回项目 `.linghun/settings.json`；如果当前 config 中来自环境变量或旧项目 settings 的 `apiKey` 已被合并，存在被写回项目 settings 的风险。

## Fix

本轮最小修复：

- `packages/config/src/index.ts`
  - 保持兼容读取：旧项目 `.linghun/settings.json` 中已有 provider `apiKey` 仍可被 `loadConfig()` 读取。
  - 保持优先级：`LINGHUN_DEEPSEEK_API_KEY` / `LINGHUN_OPENAI_API_KEY` 仍优先于项目 settings 中的 key。
  - `writeConfig()` 写入项目前先移除所有 `providers.*.apiKey`，避免 settings 写入路径把 env key 或旧项目 key 固化到项目目录。
  - 仍允许写入 provider/model/baseUrl/endpointProfile 等非敏感字段。

- `packages/tui/src/index.ts`
  - `/model doctor` / `/model route doctor` 对每个 provider 显示 `apiKey=present source=env|project-settings|user-settings masked=...` 或 `apiKey=missing`。
  - source 判定顺序：环境变量优先；否则如果当前项目 `.linghun/settings.json` 中该 provider 存在非空 `apiKey`，标记为 `project-settings`；否则标记为 `user-settings` / merged private config。
  - source 为 `project-settings` 时输出 WARN：项目 `.linghun/settings.json` 不建议保存 `apiKey`，建议迁移到环境变量或用户级私有配置。
  - 所有 doctor 输出只显示 masked preview，不输出完整 key、完整项目路径或用户 prompt。

- `apps/cli/src/cli.ts`
  - headless / slash-compatible `linghun model doctor` / `linghun /model doctor` 也显示 `apiKey=present source=env|project-settings|user-settings masked=...` 或 `apiKey=missing`。
  - 项目级 DeepSeek `apiKey` 存在且未被 env 覆盖时输出同等 WARN 与迁移建议。
  - 不输出完整 key 或完整项目路径。

- `docs/delivery/phase-15-natural-command-bridge.md`
  - 补充安全边界：项目级 settings 可保存 provider/model/baseUrl/endpointProfile 等非敏感配置；`apiKey` 应优先使用 env 或用户级私有配置；项目级 `apiKey` 仅兼容读取并在 doctor 中警告。

未做事项：

- 不实现 OS keychain、密钥市场或完整 provider credential UI。
- 不删除旧用户项目 settings 中的 key；只在下一次 Linghun 配置写入时不再写出 `apiKey`。
- 不进入 Phase 15.5 / Phase 16+。
- 不宣布 Phase 15 Beta PASS。

## Tests

新增/更新测试覆盖：

- `packages/config/src/index.test.ts`
  - 旧项目 `.linghun/settings.json` 中的 legacy `apiKey` 仍可被 `loadConfig()` 读取，保证兼容旧用户。
  - 触发 settings 写入路径后，项目 `.linghun/settings.json` 不再包含旧项目 key 或 `"apiKey"` 字段。
  - env `LINGHUN_OPENAI_API_KEY` 被合并进运行时 config 后，`saveModelRoute()` 写回项目 settings 时不会写入 env key 或 `"apiKey"` 字段。

- `packages/tui/src/index.test.ts`
  - 项目 `.linghun/settings.json` 存在 `apiKey` 时，自然语言 `/model doctor` 路径显示 `source=project-settings` 与 WARN，但不泄漏 key 原值。
  - env key 覆盖项目 key 时，doctor 显示 `source=env`，不显示 project key，也不输出 project-settings WARN。
  - doctor 输出不包含测试 key 原值、完整临时项目路径或用户 prompt。
  - 既有 doctor masked 输出断言继续覆盖 `apiKey=present` 与 masked preview。

实际验证命令：

```bash
corepack pnpm exec vitest run packages/config/src/index.test.ts packages/tui/src/index.test.ts
corepack pnpm check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

结果：

- `corepack pnpm exec vitest run packages/config/src/index.test.ts packages/tui/src/index.test.ts`：PASS，2 files / 109 tests。
- 追加复检 `corepack pnpm exec vitest run apps/cli/src/main.test.ts packages/config/src/index.test.ts packages/tui/src/index.test.ts`：PASS，3 files / 116 tests；覆盖 headless / slash-compatible CLI `/model doctor` 同等 source/WARN/masked 行为。
- `corepack pnpm check`：首次因新增代码格式换行失败，按 formatter 建议调整后 PASS，47 files；CLI doctor 补丁后再次 PASS。
- `corepack pnpm typecheck`：PASS。
- `corepack pnpm test`：PASS，11 files / 283 tests。
- `corepack pnpm build`：PASS，7 workspace projects built。

本报告不写入任何真实 API key。

## Remaining risks

- 本轮只做最小敏感配置成熟度修复；没有引入 OS keychain、加密 secret store 或交互式 provider credential manager。
- 如果旧项目 settings 已经包含真实 key，本轮不会主动删除用户文件中的旧值；用户应手动迁移到环境变量或用户级私有配置。后续 Linghun settings 写入会停止继续写出 `apiKey`。
- `source=user-settings` 当前代表“非 env、非当前项目 settings 的运行时/私有合并来源”；完整用户级安全存储仍属于后续阶段能力，不在本轮实现。
- Doctor 的 WARN 是安全提示，不会阻止运行时兼容读取旧配置；这是为了避免破坏已有用户。

## 是否阻塞 Phase 15 real-project Beta

本缺口属于 Phase 15 real-project Beta 前的敏感配置成熟度风险。修复后，项目级 `apiKey` 常规写回路径已被收口，doctor 已能显示 source 与项目级 WARN，且保留旧配置兼容读取。

结论口径：本轮修复用于降低进入 Phase 15 real-project Beta 前的敏感配置污染风险；是否解除阻塞仍以本轮完整验证与用户审核为准。不得把本轮 focused PASS 或本地验证结果自动升级为 Phase 15 Beta PASS。
