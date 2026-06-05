# Phase 7.5-D — Provider Smoke / Doctor Isolation Source Closure

## 结论

- **阶段状态**: DONE
- **范围**: 只修 live provider smoke 的 DeepSeek provider.env-only 路径，以及 TUI/headless CLI doctor 的 provider.env source 文案。
- **结果**: 隔离 `LINGHUN_CONFIG_DIR/provider.env` 下 OpenAI-compatible 与 DeepSeek 均能被识别；doctor source 可区分 `shell-env`、`config-dir-provider-env`、`user-provider-env`、`project-settings-legacy`。
- **未做**: 未改主链逻辑，未改 workflow/job/agent，未处理 DH1-DH4，未写真实 key，未提交压测日志。

## 阶段目标

- `scripts/live-provider-smoke.mjs` 支持 DeepSeek provider.env-only 字段。
- `LINGHUN_CONFIG_DIR` 设置时，只读隔离目录 provider.env，不回退 home provider.env。
- `/model doctor` 与 headless `linghun model doctor` 的 key source 文案与真实来源一致。
- 保持 key 合并优先级、provider route 选择、`maskSecret` 行为不变。

## 已完成功能

- live smoke 读取 `LINGHUN_DEEPSEEK_BASE_URL`、`LINGHUN_DEEPSEEK_API_KEY`、`LINGHUN_DEEPSEEK_MODEL`。
- DeepSeek smoke route 透传 `LINGHUN_DEEPSEEK_BASE_URL`，支持隔离 mock/fake key 验证。
- provider.env source 在 `LINGHUN_CONFIG_DIR` 下显示 `config-dir-provider-env`。
- shell env source 显示 `shell-env`。
- project settings legacy apiKey source 保持 `project-settings-legacy`。

## 使用方式

- `node scripts/live-provider-smoke.mjs`
- TUI: `/model doctor`
- Headless CLI: `linghun model doctor`

## 涉及模块

- `scripts/live-provider-smoke.mjs`
- `packages/tui/src/model-doctor-runtime.ts`
- `apps/cli/src/cli.ts`
- `packages/tui/src/model-doctor-runtime.test.ts`
- `packages/tui/src/index.test.ts`
- `apps/cli/src/main.test.ts`
- `packages/config/src/index.test.ts`

## 关键设计

- 不新增公共配置抽象；只在现有 doctor/source 判断处补齐 source label。
- 不改变 provider.env 合并优先级：shell env 仍优先于 provider.env，provider.env 仍高于 project settings。
- `LINGHUN_CONFIG_DIR` 隔离由既有 `getUserConfigDir()` 路径规则负责，本阶段只补文案和回归测试。
- smoke 输出只展示 present/missing/source，不打印 raw key 或完整 provider response。

## 配置项

- 使用既有 `LINGHUN_CONFIG_DIR`。
- 使用既有 provider.env 字段：
  - `LINGHUN_OPENAI_BASE_URL`
  - `LINGHUN_OPENAI_API_KEY`
  - `LINGHUN_OPENAI_MODEL`
  - `LINGHUN_DEEPSEEK_BASE_URL`
  - `LINGHUN_DEEPSEEK_API_KEY`
  - `LINGHUN_DEEPSEEK_MODEL`

## 命令

- `corepack pnpm --filter @linghun/tui typecheck`
- `corepack pnpm --filter @linghun/tools typecheck`
- `corepack pnpm exec vitest run packages/tui/src/model-doctor-runtime.test.ts packages/tui/src/index.test.ts -t "provider.env|model doctor|config-dir-provider-env" --no-color`
- `corepack pnpm exec vitest run apps/cli/src/main.test.ts packages/config/src/index.test.ts -t "provider.env|config dir|model doctor" --no-color`
- `node --check scripts/live-provider-smoke.mjs`
- `node scripts/live-provider-smoke.mjs` via isolated mock server scenarios

## 测试与验证

| 验证 | 结果 |
|---|---|
| `corepack pnpm --filter @linghun/tui typecheck` | PASS |
| `corepack pnpm --filter @linghun/tools typecheck` | PASS |
| TUI filtered vitest | PASS, 19 passed / 695 skipped |
| CLI/config filtered vitest | PASS, 63 passed / 8 skipped |
| `node --check scripts/live-provider-smoke.mjs` | PASS |
| smoke: config dir only OpenAI-compatible fake env | PASS, route openai-compatible, source `config-dir-provider-env`, mock auth exit 1 |
| smoke: config dir only DeepSeek fake env | PASS, route deepseek, source `config-dir-provider-env`, mock auth exit 1 |
| smoke: empty config dir + home provider.env present | PASS, skipped and did not use home provider.env |
| smoke: shell env priority | PASS, route openai-compatible, source `shell-env`, mock auth exit 1 |
| `git diff --check` | PASS, only existing CRLF warning for smoke script |

## 性能结果

- 本阶段只改变本地配置读取字段和 doctor/source 文案，无新增后台任务、缓存写入、索引刷新或 provider 调用常驻开销。

## 已知问题

- fake key smoke 使用本地 mock auth failure 验证 route/source，不代表真实 provider 账号可用性。
- DH1-DH4 仍未处理；本阶段不声明真实全量实测就绪。

## 不在本阶段处理的内容

- 不改主链 provider/tool 流。
- 不改 workflow/job/agent。
- 不处理 DH1-DH4。
- 不新增真实 provider key。
- 不保存压测日志。

## 下一阶段衔接

- 下一步仍应按用户确认推进；不得因本阶段通过而自动进入 DH1-DH4 或真实全量 smoke。
- 如进入真实 provider 压测，应继续使用临时 `LINGHUN_CONFIG_DIR`，避免 home provider.env 污染结果。

## 开发者排查入口

- live smoke provider.env 读取：`scripts/live-provider-smoke.mjs`
- TUI doctor source：`packages/tui/src/model-doctor-runtime.ts`
- headless CLI doctor source：`apps/cli/src/cli.ts`
- config dir provider.env 隔离：`packages/config/src/index.ts`

## 参考核对

- 本阶段读取：
  - `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
  - `LINGHUN_IMPLEMENTATION_SPEC.md`
  - `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
  - `docs/delivery/README.md`
  - `docs/delivery/phase-07-4-post-split-full-product-readiness-audit.md`
  - `docs/delivery/phase-07-5a-structure-duplicate-runtime-closure.md`
  - `docs/delivery/phase-07-5b-mainchain-capability-test-stability-closure.md`
- 本阶段未读取 CCB 源码或社区源码；未复制可疑源码、内部 API、专有遥测或反编译实现。
- codebase-memory MCP 工具本轮未暴露；已按规则降级为 `rg` 与源码精读。

## Handoff Packet

```json
{
  "phase": "7.5-D",
  "status": "DONE",
  "nextPhase": "user-confirmed next step only",
  "forbiddenNextActions": [
    "do not touch workflow/job/agent from this patch",
    "do not touch DH1-DH4 from this patch",
    "do not write real provider keys",
    "do not commit pressure-test logs"
  ],
  "evidenceRefs": [
    "scripts/live-provider-smoke.mjs",
    "packages/tui/src/model-doctor-runtime.ts",
    "apps/cli/src/cli.ts",
    "packages/tui/src/model-doctor-runtime.test.ts",
    "packages/tui/src/index.test.ts",
    "apps/cli/src/main.test.ts",
    "packages/config/src/index.test.ts"
  ],
  "validation": {
    "tuiTypecheck": "PASS",
    "toolsTypecheck": "PASS",
    "tuiFilteredVitest": "PASS",
    "cliConfigFilteredVitest": "PASS",
    "liveProviderSmokeIsolated": "PASS with mock auth failures for fake keys"
  },
  "indexStatus": "codebase-memory tools unavailable in this turn; rg/source-read fallback used",
  "permissionMode": "local repo edits only; no real provider keys; no network provider calls beyond local mock server",
  "modelProviderAndBudget": "Codex session model not recorded by repo runtime; no Linghun provider budget or usage generated"
}
```
