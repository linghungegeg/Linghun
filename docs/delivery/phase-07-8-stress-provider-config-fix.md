# Phase 7.8-Stress-Fix：Provider / Config Availability

## 状态声明

- verdict: `PASS`
- 本轮只修重压暴露的 provider/config 可用性问题。
- 未触碰 `WHITEPAPER.md`、`WHITEPAPER.en.md`、DH1-DH4、主链重构、真实 key、压测日志或无关未跟踪项。
- 未运行真实 provider smoke；本轮验证全部为本地 typecheck/build/focused tests/static check。

## Source-Level Reality Check

### existing implementation

- `packages/config/src/index.ts` 的 `providerEnvToConfig()` 会把有效 `provider.env` 转成 `providers + defaultModel + modelRoutes`，所以 fresh project 会被 provider.env 接管 route。
- shell env 原本只在 `defaultConfig` / `mergeConfig()` 中覆盖 provider 字段；TUI/CLI 的 executor 实际依赖 `modelRoutes`，因此 shell OpenAI 三件套可能仍显示/走 `deepseek-chat`。
- `packages/tui/src/tui-model-runtime.ts` 通过 executor route 选择 provider/model；TUI 和 headless CLI 都消费同一份 config。
- `scripts/live-provider-smoke.mjs` 原本硬编码 `maxOutputTokens: 64`，并把 reasoning-only/no final text 当 PASS。

### gaps fixed

- 完整 shell provider env 与 provider.env 在 fresh/default route 场景采用一致路由语义。
- 项目 settings 已显式固定 `modelRoutes` 时，shell/provider env 只补 provider 凭据字段，不误覆盖项目 route/defaultModel。
- live smoke 默认不再传 `maxOutputTokens`；仅显式设置 `LINGHUN_SMOKE_MAX_OUTPUT_TOKENS` 时传入。
- live smoke 对 reasoning-only/no final text 输出明确诊断，不再误导为主链 PASS。

## 已完成改动

- `packages/config/src/index.ts`
  - 无 `provider.env` 文件时也检查完整 shell env 三件套。
  - OpenAI shell 三件套：`LINGHUN_OPENAI_BASE_URL` / `LINGHUN_OPENAI_API_KEY` / `LINGHUN_OPENAI_MODEL` 可接管 fresh/default text routes。
  - DeepSeek shell 三件套：`LINGHUN_DEEPSEEK_BASE_URL` / `LINGHUN_DEEPSEEK_API_KEY` / `LINGHUN_DEEPSEEK_MODEL` 可接管 fresh/default text routes。
  - 项目显式 `modelRoutes` 存在时保留项目 route/defaultModel。
- `packages/tui/src/model-doctor-runtime.ts`
  - 移除旧的 “shell env only fills provider fields” 误导提示。
  - provider.env merge 摘要改为说明 fresh route 接管与显式项目 route 保留边界。
- `scripts/live-provider-smoke.mjs`
  - 默认使用 provider/model 输出上限。
  - `LINGHUN_SMOKE_MAX_OUTPUT_TOKENS` 显式设置且为正整数时才传入请求。
  - 输出只包含 provider/model/source 与事件摘要，不打印 raw key 或完整 provider response。
  - reasoning-only 且无 final text 时返回失败诊断，说明这是 smoke/provider-output 诊断，不是主链失败证明。

## 测试覆盖

- shell OpenAI env fresh project：config 生成 `openai-compatible/gpt-5.5` executor route；CLI/TUI doctor 使用 shell-env source，不泄露 key。
- shell DeepSeek env fresh project：config 生成 `deepseek/deepseek-reasoner` executor route。
- project route 显式固定：完整 shell OpenAI env 不覆盖项目 executor route/defaultModel。
- provider.env 既有路径：继续覆盖 fresh/default route，shell key 仍高于 provider.env key。
- live smoke：`node --check` 通过；脚本不再含 `maxOutputTokens: 64` 或 reasoning-only PASS 文案。

## 验证结果

- `corepack pnpm --filter @linghun/tui typecheck` → PASS
- `corepack pnpm -r build` → PASS
- `corepack pnpm exec vitest run packages/config/src/index.test.ts apps/cli/src/main.test.ts packages/tui/src/index.test.ts -t "model setup|model doctor|provider.env|shell env|DeepSeek|OpenAI-compatible" --no-color` → PASS，39 selected / 675 skipped
- `corepack pnpm exec vitest run packages/providers/src/index.test.ts --no-color` → PASS，134/134
- `node --check scripts/live-provider-smoke.mjs` → PASS
- `git status --short` → 已复查；仍有用户/既有未触碰项：`WHITEPAPER*.md`、`docs/delivery/phase-6.7-full-source-maturity-audit.md`、`docs/stress/`、`img/`、`test-model-set.sh`

## 剩余风险

- 未执行真实 provider/API smoke；真实 DeepSeek v4 pro / reasoner 的输出行为仍需用户提供临时 shell env 后单独跑 live smoke。
- `provider.env` 仍是本机明文私有文件，不是 keychain/vault。
- 若用户只设置部分 shell env 字段，不会接管 route；必须完整 provider 配置存在才接管。

## 参考核对

- 实际读取 Linghun 文档：`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`、`docs/delivery/README.md`、`docs/delivery/phase-07-8-policy-kernel-active-signal-consumption.md`、`docs/delivery/phase-15-5e-provider-freshness.md`、`docs/delivery/pre-smoke-closure-c-provider-auth-config-center.md`。
- 实际读取 Linghun 源码：`packages/config/src/index.ts`、`packages/config/src/index.test.ts`、`packages/tui/src/tui-model-runtime.ts`、`packages/tui/src/model-doctor-runtime.ts`、`packages/tui/src/index.test.ts`、`apps/cli/src/cli.ts`、`apps/cli/src/main.test.ts`、`scripts/live-provider-smoke.mjs`、`packages/providers/src/index.ts`。
- 实际参考：两个只读子智能体分别核对 config/TUI route 事实与 live smoke 诊断边界。
- 本轮未读取或复制 CCB / 第三方可疑源码实现；只基于 Linghun 源码事实修复。

## Handoff Packet

- next: 用户审核本轮 diff；是否进入 DH1-DH4 或其他阶段必须另行确认。
- mustNotDo: 不自动进入 DH1-DH4、WHITEPAPER、主链重构、真实 smoke、发布或开源包装。
- evidenceRefs: 本文档与上述验证命令。
- indexStatus: codebase-memory 工具本轮未暴露；按项目规则降级为 `rg` + 关键源码精读；未触发 index rebuild/refresh。
- permissionMode: 本地仓库最小代码/测试/文档改动；无远程、无依赖变更、无真实 key。
- provider/model: 未调用 live provider；测试使用 fake secret 字符串。
- budgetUsed: 无显式预算；无真实 provider 成本。
