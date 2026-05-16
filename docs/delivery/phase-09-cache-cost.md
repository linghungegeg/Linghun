# Phase 09：缓存与成本闭环

## 阶段目标

完成 Linghun Phase 09 缓存与成本闭环，在 Phase 08 Verification Runner、Evidence Gate、Claim Checker 和 BackgroundTask 基础上接入缓存命中率、usage 记录、保守成本口径、cache freshness 诊断、轻量提示和本地统计命令。

本阶段只实现 Phase 09 cache/cost/usage/stats 最小闭环，不进入 Phase 10 MCP/index 完整闭环，不实现 Phase 11 会话记忆/handoff 新能力，不实现 Agent、多模型协作、Vision Provider、Plugins、Hooks、长期任务、Remote Channels 或桌面端。

## 已完成功能

- Cache history ring buffer：
  - 默认 `maxTurns=20`。
  - `/cache-log config size <n>` 可调整当前 REPL 进程内历史容量。
  - 超出容量时淘汰旧记录。
- Cache hit rate：
  - 公式固定为 `cacheReadTokens / (inputTokens + cacheWriteTokens + cacheReadTokens)`。
  - output tokens 不进入分母。
  - 分母 `<= 0` 时返回 `null`，展示为 `n/a`。
- Raw usage 记录：
  - 记录 input tokens、output tokens、cache read tokens、cache write/create tokens、model、provider、endpoint、compact 状态、freshness、rawUsage。
  - provider usage 进入 transcript 的 `usage` 和 `cache_update` event。
- Cache write/create source classification：
  - `reported`：provider 明确返回非零 cache write/create tokens。
  - `zero_reported`：provider 明确返回 0。
  - `missing`：provider 未返回对应字段。
  - `estimated`：本地只能估算。
- 保守字段解释：
  - `cache_creation_tokens=0` 只描述为 provider 字段口径。
  - 不把 0 写入字段解释为“零写入成本”或“零成本”。
- Cache Freshness：
  - 记录 `systemPromptHash`、`toolSchemaHash`、`mcpToolListHash`、`modelProviderHash`、`reasoningEffortHash`、`projectRulesHash`、`memoryHash`、`compactHash`、`pluginListHash`、`changedKeys`。
  - `/break-cache status` 展示当前 freshness 变化。
- Cache 命令：
  - `/cache-log`
  - `/cache-log config size <n>`
  - `/cache-log export [path]`
  - `/cache status`
  - `/cache warmup`
  - `/cache refresh`
  - `/break-cache status`
- Usage / Stats：
  - `/usage` 展示 token 汇总、cache hit rate、cache write source 和保守成本口径。
  - `/stats` 展示本地运行期 cache/usage 统计。
  - `/stats endpoints` 按 endpoint 聚合样本、tokens 和 hit rate。
- 状态栏：
  - 状态栏显示 session、model、mode、background、cache hit rate、index 占位。
  - 状态栏不显示金额。
- 轻量提示：
  - 本地规则判断，不调用模型。
  - 只输出命令建议，不写入用户输入区。
  - 当前覆盖 cache hit rate 下降、context 较长建议 `/compact`、zero-reported write + cache read 字段解释、freshness 关键 hash 变化建议 `/cache warmup`。
  - 支持去重与冷却，避免弹窗式打断。
- 保留 Phase 08：
  - `/verify`、`/verify plan`、`/verify last`、`/verify smoke` 保持可用。
  - `/review` 保持可用。
  - `test_result` evidence、`verification_start`、`verification_end` transcript event 保持可用。

## 使用方式

构建后进入 REPL：

```bash
corepack pnpm build
corepack pnpm exec linghun
```

Phase 09 新增或更新命令：

```text
/cache-log
/cache-log config size <n>
/cache-log export [path]
/cache status
/cache warmup
/cache refresh
/break-cache status
/usage
/stats
/stats endpoints
```

最小 smoke：

```bash
printf '/cache-log\n/cache status\n/stats endpoints\n/exit\n' | corepack pnpm exec linghun
```

典型排查路径：

```text
/cache status
/break-cache status
/cache-log
/usage
/stats endpoints
```

当 freshness 变化后，可以显式尝试：

```text
/cache warmup
/cache refresh
```

这两个命令只声明“已尝试”，不保证 provider 一定写入缓存；真实账单和 provider usage 仍以 provider 返回与账号账单为准。

## 涉及模块

- `packages/core/src/session.ts`：新增 Cache / Cost / Freshness 类型、`usage` / `cache_update` transcript event、hit-rate 公式 helper。
- `packages/providers/src/index.ts`：OpenAI-compatible usage parser 透出 cache read/write/create 字段、rawUsage 和 endpoint。
- `packages/providers/src/index.test.ts`：更新 usage parser 回归。
- `packages/tui/src/index.ts`：CacheState、cache commands、usage/stats formatter、freshness hash、light hints、status bar cache 字段、transcript usage/cache event 写入。
- `packages/tui/src/index.test.ts`：Phase 09 cache/cost/usage/stats 回归测试，并保留 Phase 08 验证能力测试。
- `apps/cli/src/cli.ts`：帮助文案更新到 Phase 09，保留 `--version` / `--help` 快速路径。
- `apps/cli/src/main.test.ts`：CLI help 回归更新到 Phase 09。
- `docs/delivery/README.md`：Phase 09 标记为 done，Phase 10 保持 pending。
- `docs/delivery/phase-09-cache-cost.md`：本交付文档。

## 关键设计

- 保持最小改动：Phase 09 直接接入现有 TUI command router 和 provider usage event，避免新增包和大拆 TUI。
- Cache history 当前是 REPL 进程内状态；显式 `/cache-log export [path]` 可导出最近缓存日志。
- 命中率只按 prompt/cache 相关 token 计算，output token 永不进入分母。
- 成本口径默认保守：本阶段没有真实 billing 字段接入，因此 `/usage` / `/stats` 中金额只允许描述为 estimated unavailable，不在状态栏展示。
- `cache_creation_tokens=0` 不等于零写入成本；相关输出只说明 provider 字段口径。
- Freshness 使用稳定 hash 暴露“哪些维度变化”，不把完整 prompt、工具 schema、项目规则或 memory 内容 dump 到主界面。
- Light hints 是本地规则、短文本、命令建议，不调用模型、不弹窗、不写入输入区。
- Phase 08 Verification Runner 和 `test_result` evidence 不被 Phase 09 cache/stats 输出污染。

## 配置项

本阶段新增运行期 cache 配置，当前位于 TUI 进程内状态：

```ts
{
  maxTurns: 20,
  warnBelowHitRate: 0.75,
  persistPath: "<project>/.linghun/cache-log.json",
  hintsMuted: false
}
```

用户可通过 REPL 调整历史容量：

```text
/cache-log config size <n>
```

约束：

- 最小值：`1`。
- 最大值：`200`。
- 当前不修改 `@linghun/config` 持久配置 schema，避免为 Phase 09 最小闭环扩大配置面。

## 命令

CLI：

```bash
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
corepack pnpm exec linghun
```

REPL：

```text
/cache-log
/cache-log config size <n>
/cache-log export [path]
/cache status
/cache warmup
/cache refresh
/break-cache status
/usage
/stats
/stats endpoints
/verify
/verify plan
/verify last
/verify smoke
/review
/background
/claim-check
/exit
```

## 测试与验证

已执行：

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm check
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
printf '/cache-log\n/cache status\n/stats endpoints\n/exit\n' | corepack pnpm exec linghun
```

当前结果：

- `corepack pnpm test`：通过；10 个测试文件、54 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过。
- `corepack pnpm check`：首次因 Biome 格式/模板字符串 lint 失败，按 Biome 修复后通过；最终复跑通过。
- `linghun --version`：输出 `0.1.0`。
- `Linghun --version`：输出 `0.1.0`。
- `linghun --help`：显示 Phase 09 帮助与快速路径说明。
- REPL smoke：`/cache-log`、`/cache status`、`/stats endpoints`、`/exit` 可执行；空历史时显示 `n/a` / no samples，不显示金额。

新增/更新测试覆盖：

- cache hit rate 公式排除 output tokens。
- 分母 `<= 0` 返回 `null`。
- cache write/create source classification：`reported`、`zero_reported`、`missing`、`estimated`。
- `/cache-log` 展示最近记录。
- `/cache-log config size <n>` 会淘汰旧记录。
- `/cache status` 展示 hit rate、freshness changedKeys、cache write source 和保守字段说明。
- `/break-cache status` 展示 changed freshness key，并建议 `/cache warmup`。
- `/usage` / `/stats` 展示 estimated 口径，不显示 `¥`。
- `/stats endpoints` 按 endpoint 聚合。
- `cache_creation_tokens=0` 不输出“零成本”说法。
- 状态栏不显示金额。
- Light hints 不污染输入 prompt。
- Phase 08 `/verify`、`/verify last`、`/review` 和 `test_result` evidence 回归保持通过。

独立 verification agent 复检：PASS。首次复检发现 REPL `/help` 未列出 Phase 09 命令；修复 discoverability 并补充回归断言后，第二次独立复检 PASS。

## 性能结果

- `--version` / `--help` 仍保持 CLI 快速路径，不启动 TUI、模型、MCP、验证器或 cache 统计系统。
- Cache history 默认只保留 20 条 turn stats，避免长期无限增长。
- `/cache status`、`/usage`、`/stats`、`/stats endpoints` 只读取内存 history，不调用模型或外部服务。
- `/cache-log export` 只在用户显式调用时写入文件。
- Freshness 输出 hash 和 changedKeys，不输出大块 prompt/schema/raw usage。
- Light hints 本地计算、去重冷却，不阻塞主流程。

## 已知问题

- Cache history 当前默认是 REPL 进程内状态；跨进程自动恢复属于后续会话/持久化增强范围。本阶段提供显式 `/cache-log export [path]`。
- `/cache warmup` 和 `/cache refresh` 只更新本地 freshness 状态并声明“已尝试”，不保证 provider 一定创建缓存。
- 当前没有真实 billing 字段接入；所有金额口径均保持 estimated / unavailable，真实费用以 provider 账单为准。
- Light hints 当前覆盖 Phase 09 cache 直接相关的本地规则；大型文件建议 `.linghunignore`、高风险变更建议 `/plan` 的更完整规则可在后续不扩大 Phase 09 的前提下单独增强。
- Endpoint stats 来自当前 REPL 已记录 usage 样本；没有样本时显示 no samples。
- Freshness hash 是本地诊断信号，不等同于 provider 真实 cache key。

## 不在本阶段处理的内容

- 不实现 Phase 10 MCP/index 完整闭环。
- 不实现 Phase 11 会话记忆/handoff 新能力。
- 不实现 Agent、多模型协作、Vision Provider、Plugins、Hooks、长期任务、Remote Channels、桌面端。
- 不接入真实账单 API，不承诺固定省钱比例，不宣传通用“98%”命中或固定节省倍数。
- 不把完整 raw usage、账单截图、完整 prompt、工具 schema 或大日志 dump 到 transcript 主输出。
- 不做大型 TUI 重构或新增终端渲染器。

## 下一阶段衔接

Phase 10 可以在本阶段基础上接入 MCP 与 codebase-memory 闭环，但必须继续遵守：

- 不破坏 Phase 09 cache/cost 保守口径。
- 状态栏继续不显示金额。
- 使用 index 状态时优先输出短摘要，不把索引大结果塞进状态栏。
- 如果 MCP tool list 变化，应进入 `mcpToolListHash` / `changedKeys` 诊断，而不是静默改变 cache 状态。
- 保留 Phase 08 Verification Runner、`test_result` evidence 和 Phase 09 usage/cache transcript event。

## 开发者排查入口

- Cache state 初始化：`packages/tui/src/index.ts` 中 `createCacheState()`。
- Cache 命令：`handleCacheLogCommand()`、`handleCacheCommand()`、`handleBreakCacheCommand()`。
- Usage 记录：`recordModelUsage()`、`appendUsageEvents()`。
- Hit-rate 公式：`packages/core/src/session.ts` 中 `computePromptCacheHitRate()`。
- Provider usage parser：`packages/providers/src/index.ts` 中 `parseOpenAiStreamLine()` 与 `readCacheWriteTokens()`。
- Freshness：`getCurrentFreshness()`、`createCacheFreshness()`、`diffFreshness()`。
- Light hints：`collectLightHints()`、`writeLightHints()`。
- Stats formatter：`formatUsage()`、`formatStats()`、`formatEndpointStats()`。
- Phase 09 tests：`packages/tui/src/index.test.ts`、`packages/providers/src/index.test.ts`、`apps/cli/src/main.test.ts`。

## 状态栏与统计口径

- 状态栏显示 cache hit rate 百分比或 `n/a`，不显示金额、币种、账单估算或 savings。
- `/usage` 和 `/stats` 可以展示 token 与 estimated cost 口径，但本阶段没有真实 billing 字段，因此显示为 estimated unavailable。
- 所有 money 相关文案必须保守：除非 provider 明确返回真实 billing 字段，否则只能标记 estimated，不能暗示真实扣费。
- `cache_creation_tokens=0` 不可写成“零成本”；只能写成 provider 当前字段返回为 0，仍需以 provider usage / 账单对账。

## TUI 渲染稳定性

- Cache/status/stats 输出为短文本摘要，不使用弹窗，不污染用户输入 prompt。
- Light hints 以 `[hint:severity]` 单行输出，包含建议命令；有冷却时间，避免连续刷屏。
- `/cache-log` 展示最近 turn 摘要，不输出完整 rawUsage。
- `/cache-log export` 才将最近 cache history 写入文件，用于后续对账。
- 状态栏通过 `truncateDisplay(..., 96)` 保持短行。

## 后台/复查任务状态反馈

- Phase 09 本身不新增后台长任务。
- Phase 08 Verification Runner 的 BackgroundTaskState 保持原行为：`/verify` 启动验证，`/background` 可查看状态，`/verify last` 可查看最近结果。
- Cache/status/stats 命令为同步本地读状态，不进入 BackgroundTask 队列。
- `/review` 仍基于本地结构化摘要，不调用 Phase 12 reviewer agent。

## 语言与 i18n 口径

- 默认中文输出；`/language en-US` 保留 Phase 07 既有切换能力。
- Slash 命令、transcript event 字段、配置键和类型字段保持英文，方便日志检索和跨语言兼容。
- 核心状态词如 `reported`、`zero_reported`、`missing`、`estimated` 保持英文枚举。
- 状态栏不新增长中文解释；详细解释放在 `/cache status`、`/usage` 和 `/stats`。

## 参考核对

本阶段实际读取的 Linghun 文档：

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` Phase 09
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md` Cache / Cost、Cache Freshness、LightHint、CostSummary、usage/stats 相关规格
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md` context/cache/cost-reduction 相关设计
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-06-permissions-plan.md`
- `F:\Linghun\docs\delivery\phase-07-behavior-guardrail.md`
- `F:\Linghun\docs\delivery\phase-08-verification.md`

本阶段实际参考：

- `F:\ccb-source\docs\ccb-optimizations.md` 中 cache history、cache hit rate 监控阈值、cache break dimensions 和 `/break-cache status` 行为，只作为产品行为与验收思路参考。
- CCB / CCB Dev Boost 相关内容仅用于理解“本地轻提示、保守 cache 说明、历史 ring buffer、break-cache 诊断”的行为边界。
- 未复制 CCB / OpenCode / Hermes 的可疑源码实现、反编译痕迹、内部 API、专有遥测或内部服务逻辑。

## 成品级结构化 handoff packet

```yaml
current_phase: Phase 09 cache and cost loop
phase_status: completed
next_phase: Phase 10 MCP and codebase-memory loop
phase_10_status: pending
must_stop_after_phase_09: true
completed:
  - Cache history ring buffer with default maxTurns=20
  - /cache-log, /cache-log config size <n>, /cache-log export [path]
  - Cache hit rate formula excluding output tokens and returning null for denominator <= 0
  - Raw provider usage capture for input/output/cache read/cache write/model/provider/endpoint/compact/freshness/rawUsage
  - Cache write/create source classification: reported, zero_reported, missing, estimated
  - Conservative cache_creation_tokens=0 wording
  - CacheFreshness hashes and changedKeys
  - /cache status, /cache warmup, /cache refresh, /break-cache status
  - /usage, /stats, /stats endpoints
  - Status bar cache hit rate without money
  - Local light hints with command suggestions only
  - Phase 08 Verification Runner, /verify, /verify last, /review, test_result evidence preserved
forbidden_next_without_user_confirmation:
  - Phase 10 MCP/index complete loop
  - Phase 11 memory/handoff new capability
  - Agent, multi-model collaboration, Vision Provider, Plugins, Hooks, long-running jobs, Remote Channels, desktop
key_files:
  - packages/core/src/session.ts
  - packages/providers/src/index.ts
  - packages/providers/src/index.test.ts
  - packages/tui/src/index.ts
  - packages/tui/src/index.test.ts
  - apps/cli/src/cli.ts
  - apps/cli/src/main.test.ts
  - docs/delivery/README.md
  - docs/delivery/phase-09-cache-cost.md
validation_current:
  - command: corepack pnpm test
    result: pass_10_files_54_tests
  - command: corepack pnpm typecheck
    result: pass
  - command: corepack pnpm build
    result: pass
  - command: corepack pnpm check
    result: pass_after_biome_fix
  - command: corepack pnpm exec linghun --version
    result: pass_0.1.0
  - command: corepack pnpm exec Linghun --version
    result: pass_0.1.0
  - command: corepack pnpm exec linghun --help
    result: pass_phase09_help
  - command: "printf '/cache-log\\n/cache status\\n/stats endpoints\\n/exit\\n' | corepack pnpm exec linghun"
    result: pass_repl_cache_smoke
  - command: independent verification agent
    result: pass_after_help_discoverability_fix
index_status:
  project: F-Linghun
  status: ready
  nodes: 473
  edges: 719
  detect_changes_after_implementation: 7 code files before delivery doc/readme update
permission_mode: default Claude Code session; no repository permission config changed
model_provider: claude-sonnet-4-6 via Claude Code; Linghun runtime provider unchanged (DeepSeek config path)
budget_usage: Phase 09 reports no real billing; all money remains estimated/unavailable and status bar has no money
risks:
  - Cache history is process-local unless user explicitly exports with /cache-log export
  - /cache warmup and /cache refresh only claim attempted provider cache action
  - Light hints cover Phase 09 cache-specific rules; broader large-file/high-risk hints remain future enhancement
```
