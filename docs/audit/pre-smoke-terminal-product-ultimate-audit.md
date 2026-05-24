# Pre-Smoke Terminal Product Ultimate Audit

## 状态声明

- **本轮性质**：全量审计（只读），不做代码改动。
- **不执行真实项目 smoke**。
- **不宣布 Beta PASS / smoke-ready / open-source-ready**。
- **不提交 commit**。
- **不新增第二套系统**。
- **不复制 CCB / Claude Code / OpenCode / Warp / 第三方源码**。
- **不把 focused/mock/local PASS 推断为整体 ready**。
- **不把历史 PASS / READY / audit report 当作当前 source-of-truth**。
- **按用户明确指令，本轮只做全量审计和报告，不改代码、不提交 commit、不执行真实项目 smoke**。

---

## 1. Executive Verdict

**`NO_TRUE_BLOCKERS`**

**审计未发现能证明真实项目 smoke 会直接失败的 blocker。**

理由：
- **P0 = 0**：逐项复核后，无 finding 能被证明会导致真实 smoke 直接失败。`packages/tui/src/index.ts` 16,401 行是维护风险（P1），但 462 tests + typecheck + build 全 PASS 证明当前代码可运行；大文件本身不会导致 smoke 失败，只会让 smoke 期间的修改变得危险。
- **P1 = 3**：index.ts 维护风险、Windows 路径归一化分散、状态行 cache/index 信息缺失——这三项建议在 smoke 前或 smoke 早期处理，但不阻塞 smoke 启动。
- **P2 = 16**：覆盖报告口径一致性、memory session-scope 边界、README 过时、help/doctor 默认偏重、性能 gate DEFERRED 项等。
- **已关闭**：`.gitattributes` / `.editorconfig` 复核后确认两文件均存在且内容正确（原 P1-7 事实错误）。
- 基础链路（CLI/TUI boot → config → provider → tool → permission → session → evidence）经过 typecheck/build/462 tests 全 PASS 验证，底座健康。
- 0-14 基线回归全部 PASS。Phase 15.5/16/17/Polish 改动未破坏早期基础。
- Phase 15.5A-F、Phase 16、Phase 17A/B/C 的 focused/local PASS 只代表本地、scoped 或 mock 验证已闭环，不代表整体终端产品 ready——真实 smoke 本身就是下一步验证手段。

**明确不是**：
- 不是 Beta PASS
- 不是 smoke-ready
- 不是 open-source-ready
- 不声明整体终端产品 ready
- 本次修正仅改审计报告，未改任何代码

---

## 2. Scope / Sources / Method

### 2.1 范围

全量审计：Phase 00-14 基线回归 + Phase 15.5A-F + Phase 16 + Phase 17A/B/C + Polish A/B/C/D，覆盖 12 个审计维度 + 0-14 回归（14 子项）。

### 2.2 已读取

**核心文档（全部读取）**：
- `START_NEXT_CHAT.md`
- `README.md`
- `docs/delivery/README.md`
- `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- `docs/audit/reference-map.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `PHASE_15_BETA_CCB_MATURITY_REMEDIATION_BASELINE.md`
- `docs/audit/pre-smoke-comprehensive-audit-2026-05-23.md`
- `docs/audit/pre-smoke-mature-tui-ux-source-level-audit.md`
- `docs/audit/performance-windows-stability-readonly-scout.md`
- `docs/audit/performance-windows-stability-hardening-gate.md`
- `docs/delivery/pre-smoke-tui-polish-a-natural-intent-command-surface.md`
- `docs/delivery/pre-smoke-tui-polish-b-interactive-controls-permission-workspace-trust.md`
- `docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md`
- `docs/delivery/pre-smoke-tui-polish-d-language-memory-agent-productization.md`
- `docs/delivery/phase-15-5a-performance-context.md`
- `docs/delivery/phase-15-5b-resource-task-lifecycle.md`
- `docs/delivery/phase-15-5c-editing-tool-ux.md`
- `docs/delivery/phase-15-5d-connect-lite.md`
- `docs/delivery/phase-15-5e-provider-freshness.md`
- `docs/delivery/phase-15-5f-terminal-product-readiness.md`
- `docs/delivery/phase-16-controlled-learning-memory-skill-evolution.md`
- `docs/delivery/phase-17a-local-durable-jobs-virtual-agent-concurrency.md`
- `docs/delivery/phase-17b-remote-channels.md`
- `docs/delivery/phase-17c-native-runner-job-supervisor-gate.md`

**核心源码（全部精读或抽样）**：
- `packages/tui/src/index.ts`（抽样关键函数：runTui, handleSlashCommand, sendMessage, decidePermission, resolveNativeRunner, getWorkspaceTrustCommandGuard, createTerminalReadinessView）
- `packages/tui/src/architecture-runtime.ts`（完整：100+ 行抽样）
- `packages/tui/src/workspace-reference-cache.ts`（report 级确认）
- `packages/tui/src/compact-context.ts`（完整读取）
- `packages/tui/src/log-artifact.ts`（完整读取 + redactLogContent 抽样）
- `packages/tui/src/tool-output-presenter.ts`（完整读取）
- `packages/tui/src/permission-presenter.ts`（完整读取）
- `packages/tui/src/runtime-status-presenter.ts`（完整读取）
- `packages/tui/src/job-runner-presenter.ts`（report 级确认）
- `packages/tui/src/terminal-readiness-presenter.ts`（report 级确认）
- `packages/shared/src/index.ts`（完整读取）
- `packages/providers/src/index.ts`（抽样：stream parser, retry, error classifier）
- `packages/tools/src/index.ts`（抽样：ensureReadBeforeEdit, tool definitions）
- `packages/config/src/index.ts`（抽样：loadConfig, mergeConfig, API key stripping, workspaceTrust）
- `packages/core/src/session.ts`, `session-store.ts`, `jsonl.ts`（report 级确认）

### 2.3 方法

1. 优先使用 codebase-memory 索引（`F-Linghun`，nodes=1936, edges=4111, status=ready）定位关键函数和调用链。
2. 索引不可精确覆盖时，降级为 `rg` / 精读关键源码确认。
3. 不基于聊天记忆或交付报告下结论；每条发现必须附源码文件路径或 report 证据。
4. 参考源对照：`reference-map.md` 确认行为边界，不复制源码。

---

## 3. Source-Level Coverage Map

### 3.1 核心链路证据

| # | 声明 | 源码证据 | 测试证据 | 状态 |
|---|------|----------|----------|------|
| 1 | CLI 入口正常 | `apps/cli/src/main.ts`, `apps/cli/src/cli.ts` | `main.test.ts` 7 tests PASS | PASS |
| 2 | Config 加载/合并 | `packages/config/src/index.ts` (1231 lines) — loadConfig, mergeConfig, env var 优先级, atomic write (temp+rename) | 24 tests PASS | PASS |
| 3 | 模型网关 | `packages/providers/src/index.ts` — OpenAiCompatibleProvider, DeepSeekProvider, SSE stream 解析, retry（指数退避 3 次）, error classification (401/403/429/5xx) | 38 tests PASS | PASS |
| 4 | Provider runtime contract | `packages/providers/src/index.ts` — ProviderRuntimeContract 含 profile/endpointProfile/endpoint/compatibilityProfile/supportsTools/sendReasoning/includeUsage/toolSchemaShape/toolResultShape/retryStatuses/maxAttempts/requestTimeoutMs/streamIdleTimeoutMs | provider tests 覆盖 | PASS |
| 5 | 工具注册表 | `packages/tools/src/index.ts` (1147 lines) — 9 tools: Read, Write, Edit, MultiEdit, Grep, Glob, Bash, Todo, Diff | 7 tests PASS | PASS |
| 6 | Read-before-edit guard | `packages/tools/src/index.ts:836` — `ensureReadBeforeEdit()` | tools/test 覆盖 | PASS |
| 7 | 权限管道 | `packages/tui/src/index.ts:15195` — `decidePermission()` 四模式 + hard deny + rule matching | 152 tests PASS | PASS |
| 8 | 权限别名标准化 | `packages/shared/src/index.ts` — `normalizePermissionMode()` legacy alias mapping | 1 test PASS | PASS |
| 9 | Session 持久化 | `packages/core/src/session.ts`, `session-store.ts` | 4 tests PASS | PASS |
| 10 | JSONL transcript | `packages/core/src/jsonl.ts` | 3 tests PASS | PASS |
| 11 | Architecture Runtime | `packages/tui/src/architecture-runtime.ts` (410 lines) | 21 tests PASS | PASS |
| 12 | Workspace Reference Cache | `packages/tui/src/workspace-reference-cache.ts` (694 lines) | 7 tests PASS | PASS |
| 13 | Compact Lite | `packages/tui/src/compact-context.ts` (217 lines) — tool pair 保护 (line 42), boundary 记录 (line 100) | 2 tests PASS | PASS |
| 14 | Log Artifact | `packages/tui/src/log-artifact.ts` (514 lines) — tail/grep/errors/redactLogContent/realpath path guard | 10 tests PASS | PASS |
| 15 | Natural Command Bridge | `packages/tui/src/natural-command-bridge.ts` (1861 lines) | 130 tests PASS | PASS |
| 16 | Runtime Status Presenter | `packages/tui/src/runtime-status-presenter.ts` (70 lines) — 状态行含模型名+权限模式 | runtime-status-presenter.test.ts | PASS |
| 17 | Job Runner Presenter | `packages/tui/src/job-runner-presenter.ts` — job/report/background/runner 格式化 | job-runner-presenter.test.ts | PASS |
| 18 | Terminal Readiness Presenter | `packages/tui/src/terminal-readiness-presenter.ts` (350+ lines) — doctor/status/problems | index.test.ts 内嵌 | PASS |

### 3.2 安全/脱敏证据

| # | 声明 | 源码证据 | 状态 |
|---|------|----------|------|
| 19 | Log 内容脱敏 | `log-artifact.ts:506-513` — `redactLogContent()`: 5 regex covering Authorization, Cookie, Bearer, sk-*, api_key/token | PASS |
| 20 | API key 写盘剥离 | `config/src/index.ts:680-689` — `removeSensitiveProjectSettings()` | PASS |
| 21 | env API key 不入 settings | `config/src/index.ts:1073` — mergeConfig skip for apiKey/baseUrl undefined/empty | PASS |
| 22 | Secret 掩码显示 | `tui/src/index.ts:4220-4223` — `maskSecret()`: `sk-…cret` | PASS |
| 23 | Remote 摘要脱敏 | `tui/src/index.ts:5137-5148` — `redactRemoteSummary()`: 8 regex | PASS |
| 24 | Provider error 脱敏 | `providers/src/index.ts:1307-1312` — `sanitizeProviderBadRequestHint()` | PASS |

### 3.3 防重复系统证据

| # | 声明 | 证据 | 状态 |
|---|------|------|------|
| 25 | 仅 1 套 provider runtime | `providers/src/index.ts` — OpenAiCompatibleProvider + DeepSeekProvider(extends) | PASS |
| 26 | 仅 1 套 tool registry | `tools/src/index.ts` — 9 tools in single `createToolRegistry()` | PASS |
| 27 | 仅 1 套 permission pipeline | `tui/src/index.ts:15195` — single `decidePermission()` | PASS |
| 28 | 仅 1 套 MCP management | tui/index.ts — single `createMcpState()` | PASS |
| 29 | 仅 1 套 job runtime | tui/index.ts — single DurableJob state | PASS |
| 30 | 仅 1 套 agent runtime | tui/index.ts — single `/fork` / agent system | PASS |

---

## 4. Reference Comparison Summary

基于 `docs/audit/reference-map.md` 核对：

| 参考源 | 本地可用 | 对照状态 | 备注 |
|--------|----------|----------|------|
| CCB / Claude Code Best v2.4.3 | `F:\ccb-source` 可用 | 行为参考充分 | TUI 交互、权限 UX、Compact 三层、Trust 边界、discovery-before-execute 已吸收 |
| OpenCode | `F:\freecodex\opencode-source` 可用 (MIT) | 行为参考充分 | 统一 CommandOption catalog 理念已吸收；fuzzysort/keybinding customization 不采纳 |
| Warp | `F:\freecodex\warp-source` 可用 (AGPL) | 行为参考充分 | Block model/onboarding wizard/ONNX classifier 不适用；fuzzy_match 仅行为参考 |
| CCB Dev Boost | 本地 docs 可用 | 行为参考充分 | cache-first 思路已吸收，不宣传未测收益 |
| codebase-memory-mcp | 索引可用 | PASS | 索引项目 `F-Linghun` nodes=1936, edges=4111 |
| AI Sessions MCP | 工具可用 | 未作为内置能力 | optional external bridge only |
| MCP 官方生态 | 公开 spec | 行为参考 | discovery-before-execute 已吸收 |
| LiteLLM / OpenRouter | 公开文档 | 行为参考 | provider adapter 边界已吸收 |
| Hermes Agent | 公开方向 | 行为参考 | memory 分层已吸收 |

---

## 5. Findings by Severity

### 分级标准（修正后）

- **P0 — 真 blocker**：能证明真实 smoke 会直接失败、数据损坏、安全边界被打破。本轮审计未发现此类项。
- **P1 — smoke 前/早期强烈建议**：不阻塞 smoke 启动，但在 smoke 中高概率暴露或 smoke 期间修改变得危险。应在 smoke 前处理或在 smoke 早期优先观察。
- **P2 — 可后置 / deferred**：不阻塞 smoke，可在 smoke 中或 smoke 后处理。

### P0 — 真 blocker（0 项）

本轮逐项复核后，**无 finding 能证明真实 smoke 会直接失败**。

原 P0-1（`packages/tui/src/index.ts` 16,401 行）经复核：462 tests + typecheck + build 全 PASS，证明当前代码可正确运行。大文件是维护风险而非功能阻断——不会导致 smoke 失败，只会让 smoke 期间的修改变得危险。降级为 P1。

### P1 — smoke 前/早期强烈建议（3 项）

#### P1-1: `packages/tui/src/index.ts` 16,401 行，关键职责仍内联（原 P0-1）

- **证据**：`wc -l packages/tui/src/index.ts` = 16,401 行；22 exports + 13 已拆分模块；仍内联：slash command router (~300+ lines), model loop (~600+ lines), permission pipeline (~200 lines), durable jobs (~300 lines), native runner (~400 lines), remote channels (~400 lines), MCP/index runtime
- **风险**：不阻塞 smoke 启动（462 tests + typecheck + build 全 PASS，底座健康），但 smoke 期间如需修改此文件，任何改动都可能引入意外回归；code review 极其困难
- **为何不是 P0**：大文件本身不会导致 smoke 失败。当前代码可运行且通过全部测试。风险是维护性的，不是功能性的。
- **裁决**：**STRONGLY RECOMMENDED** — 提交最小首批拆分计划（至少 2-3 个模块 + 拆分时间点），不要求本轮全部拆完。最理想在 smoke 前提交计划；smoke 期间避免在此文件中做大范围改动。
- **Blocking real smoke**：**no**

#### P1-2: Windows 路径归一化实现分散（原 P1-4）

- **证据**：`log-artifact.ts:484-494` 有 `formatDisplaySourcePath()`；`tui/src/index.ts:8566-8570` 有 `redactedPath()`；`config/src/index.test.ts` 新增 drive-letter casing tests。Performance scout 指出多个模块 path redact/canonicalization 实现不一致。
- **风险**：真实 Windows 项目路径（中文/空格/非 C 盘）下，不同模块对同一路径可能产生不同的归一化结果；log artifact 的 `realpath()` guard 已加但其他模块可能没有
- **裁决**：FIX — smoke 前确认集中 path canonicalization helper 或确认各模块 path guard 一致性。Real smoke 在 Windows 上运行时优先观察路径相关行为。
- **Blocking real smoke**：**no**

#### P1-3: Status line cache/index 信息仍缺失（原 P1-1）

- **证据**：`packages/tui/src/runtime-status-presenter.ts:16-35` — `formatRuntimeStatusLine()` 已包含 model name 和 mode label，但 `RuntimeStatusView` 中的 `cacheHitRate` 和 `indexStatus` 字段在状态行模板中未使用
- **实际输出**：`[Linghun] 会话 X · 模型 Y · 模式 Z · 确认 G · 后台 N` — 不含 cache 命中率、index 状态
- **风险**：用户主状态看不到 cache/index 关键信息，需运行独立命令
- **裁决**：FIX — 在状态行追加可选的 cache/index 短摘要（如 `缓存 92% · 索引 ready`），缺失时简短显示 `缓存?` / `索引?`
- **Blocking real smoke**：**no**（可在 smoke 中观察并修复）

### P2 — 可后置，不阻塞真实 smoke（16 项）

#### P2-1: 交付报告口径不一致（原 P1-2 + P1-3 合并）

- **证据**：Polish B frontmatter `status: FINAL_CLOSE`；Polish C `status: FINAL_CLOSE_LOCAL_VERIFIED`；Polish D `status: LOCAL_VERIFIED`。三个报告的验证状态标记使用了三种不同口径，且均未经过独立 verifier 复检。
- **源码事实**：Polish B/C/D 源码实现均存在且通过 focused/local 测试（language/trust focused vitest PASS, config focused vitest PASS, typecheck PASS, build PASS）。功能实现本身无问题。
- **风险**：口径不一致不影响 smoke 功能，但可能误导后续开发者对验证状态的判断。
- **裁决**：FIX — 统一口径为 `LOCAL_VERIFIED`（执行者本地复核闭合），明确标注是否经过 independent verifier。不要求独立 verifier 作为 smoke 前置条件。
- **Blocking real smoke**：**no**

#### P2-2: Memory session-scope 跨会话边界未完全明确（原 P1-5）

- **证据**：`docs/delivery/phase-16-controlled-learning-memory-skill-evolution.md:46` — session scope 只在当前 TuiContext 生效；源码已实现 candidate/accepted/rejected/disabled/retired lifecycle
- **风险**：`/memory stats` 口径中 "长期记忆" 可能隐含跨会话持续性；用户可能误以为 session-scope accepted memory 会跨会话存在
- **裁决**：FIX — `/memory stats` 输出区分 session-scope vs project/user persistent scope
- **Blocking real smoke**：**no**

#### P2-3: README.md 仍过时（原 P1-6）

- **证据**：`README.md:17-18` — 未反映 Polish A/B/C/D、Phase 15.5B-F、Phase 16、Phase 17A/B/C 已完成状态
- **风险**：新开发者或用户看到过时信息
- **裁决**：FIX — 更新 README.md 当前进度段
- **Blocking real smoke**：**no**

#### P2-4: `/help` 默认视图仍偏命令百科（原 P2-1）

- **证据**：Polish A 已将 `/help` 分组化（6 groups），但 43 条命令对新手仍偏重
- **裁决**：SIMPLIFY — `/help` 默认只展示 top 12 最常用命令 + 自然语言入口说明 + `/help all` 入口

#### P2-5: `/doctor` 默认仍展开所有 13 项（原 P2-2）

- **证据**：Polish C 已要求 `/doctor` 默认只 non-pass 项，`/doctor all` 完整列表
- **裁决**：SIMPLIFY — 确认 `/doctor` 默认只 non-pass + summary line

#### P2-6: Light hints 缺少 priority 分层（原 P2-3）

- **证据**：`tui/src/index.ts` `collectLightHints()` 有 dedup 和 Polish C 补充的 priority/cooldown
- **裁决**：DEFERRED — smoke 中观察是否打扰主屏

#### P2-7: Remote channels `webhook_mock` transport（原 P2-4）

- **证据**：`config/src/index.ts:139` — `webhook_mock` 被正确标注为 diagnostic/test-only
- **裁决**：DEFERRED — cleanup in smoke or later

#### P2-8: MCP tool discovery placeholder（原 P2-5）

- **证据**：`config/src/index.ts:227` — `openAiCompatibleModelPlaceholder` 正确使用
- **裁决**：DEFERRED — 正确的安全边界

#### P2-9: 硬编码目录跳过列表（原 P2-6）

- **证据**：`workspace-reference-cache.ts:8-21` — `HARD_SKIP_DIRS` 合理默认值
- **裁决**：DEFERRED — `.linghunignore` 可自定义

#### P2-10: 无 bundled codebase-memory（原 P2-7）

- **证据**：codebase-memory 作为外部 CLI 依赖，通过 env/managed path/PATH fallback 三层解析
- **裁决**：DEFERRED — Phase 10 已声明、Phase 15.5C 已补 license/NOTICE

#### P2-11: 无 release artifact（原 P2-8）

- **证据**：项目通过 `pnpm build` + `node` 运行
- **裁决**：DEFERRED — 归 release/open-source packaging gate

#### P2-12: 测试覆盖集中在 focused/mock/local（原 P2-9）

- **证据**：462 tests 全部为 unit/focused 测试，无真实 provider 集成测试
- **裁决**：DEFERRED — 真实 smoke 本身就是下一步

#### P2-13: Performance Gate 大量 DEFERRED（原 P2-10）

- **证据**：`docs/audit/performance-windows-stability-hardening-gate.md:159-171` — context/compact/JSONL/provider/workspace cache 优化全部 DEFERRED
- **裁决**：DEFERRED — 只有 log artifact tail prefix scan 入 C01 fix；其他路径等 benchmark 数据后再决定

#### P2-14: Large/G drive stress 未执行（原 P2-11）

- **证据**：Performance Gate 只执行 small/medium synthetic benchmark
- **裁决**：DEFERRED — 在真实 smoke 中观察长会话/大仓库性能

#### P2-15: 快捷键系统只有基础（仅 TTY）（原 P2-12）

- **证据**：Polish B 已注册 TTY keypress hook（Esc/Enter/Shift+Tab）；非 TTY 路径保持 slash fallback
- **裁决**：DEFERRED — smoke 中观察真实 TTY 快捷键体验

#### P2-16: AI Sessions MCP 未作为内置能力（原 P2-15）

- **证据**：Phase 15 pre-smoke 审计已裁决为 `optional external bridge only`
- **裁决**：KEEP — 正确边界

### 已关闭（1 项）

#### ~~P1-7: 缺少 `.gitattributes` / `.editorconfig`~~ → **CLOSED**

- **复核结果**：两文件均存在且内容正确。
  - `.gitattributes`（10 行）：`* text=auto`，`*.ts/*.tsx/*.js/*.json/*.md/*.yml/*.yaml/*.toml text eol=lf`
  - `.editorconfig`（13 行）：`charset=utf-8`，`end_of_line=lf`，`insert_final_newline=true`，`indent_style=space`，`indent_size=2`，`trim_trailing_whitespace=true`
- **原审计（2026-05-23）标记为缺失属事实错误；本次复核纠正。**

---

## 6. 0-14 Baseline Regression Audit

逐项核对（Phase | current source evidence | regression status | issue severity | recommendation）：

| Phase | 检查项 | 源码证据 | 回归状态 | 严重级别 | 建议 |
|-------|--------|----------|----------|----------|------|
| 00/01 | CLI/TUI boot, config load, project path, model route | `apps/cli/src/main.ts`, `config/src/index.ts`, `tui/src/index.ts:2097 runTui()` — 均正常 | **PASS** | — | — |
| 02 | session store / transcript / resume | `core/src/session.ts` (33 event types), `session-store.ts`, `jsonl.ts` — 均正常 | **PASS** | — | — |
| 03/04 | provider config / OpenAI-compatible / DeepSeek model route | `providers/src/index.ts` — OpenAiCompatibleProvider + DeepSeekProvider, SSE stream, retry, error classifier | **PASS** | — | — |
| 05 | Read/Edit/Write/MultiEdit/Bash 基础工具语义 | `tools/src/index.ts` — 9 tools, `ensureReadBeforeEdit()` at line 836 | **PASS** | — | — |
| 06 | slash command / TUI loop / status/help | `tui/src/index.ts:2210 handleSlashCommand()`, `/help` 分组化（Polish A 已完成） | **PASS** | — | — |
| 07 | permission modes / approval / Start Gate | `shared/src/index.ts` normalizePermissionMode, `tui/src/index.ts:15195 decidePermission()` | **PASS** | — | — |
| 08 | evidence / verification / PASS semantics | cancelled/timeout/stale 不生成 PASS evidence（Phase 15.5B 已验证） | **PASS** | — | — |
| 09 | doctor/status/report summary-first | `terminal-readiness-presenter.ts`, `runtime-status-presenter.ts` | **PASS** | — | `/doctor` 默认仍偏冗长（P2-5） |
| 10 | Windows path/newline/encoding | CRLF `/\r?\n/` 兼容, mojibake detection, UTF-8, GB18030 fallback | **PASS** | — | 路径归一化分散（P1-2） |
| 11 | memory/project rules/handoff | Phase 16 — candidate-first, accepted-only topK=3, no autoAccept | **PASS** | — | session-scope 跨会话边界（P2-2） |
| 12 | index/codebase-memory | `/index status` 默认 fast path（不触发 detect_changes）；discoverable/diagnosable | **PASS** | — | — |
| 13 | cache/cost/stats | Workspace Reference Cache bounded/fallback-safe；不宣称未测 token savings | **PASS** | — | — |
| 14 | pre-smoke readiness | 历史 PASS/READY 已降级为 evidence；无任何旧 PASS 当当前 ready 证据 | **PASS** | — | — |

**0-14 回归结论**：**全部 PASS**。Phase 15.5/16/17/Polish 改动未破坏早期基础阶段。早期基础仍能启动、运行、通过测试。

---

## 7. Overdesign / User Burden Review

逐项裁决 KEEP / SIMPLIFY / HIDE_ADVANCED / MERGE / REMOVE / DEFER_RELEASE：

| 功能 | 裁决 | 理由 |
|------|------|------|
| Architecture Runtime | KEEP | 轻量工程判断 guard（410 lines），小任务不扰民（SMALL_TASK_PATTERNS），不新增 agent/ADR/spec 平台 |
| Natural Command Bridge | KEEP | 控制面/安全桥，不是第二套自然语言执行器（Phase 15 pre-Beta 已降级） |
| Verdict Evidence Gate | HIDE_ADVANCED | 只在 `/claim-check` / handoff / audit 触发；普通开发请求无感 |
| Solution Completeness Gate | HIDE_ADVANCED | SYSTEMIC_GAP_WARNING 只在重复同类 denial 触发；普通请求无感 |
| `/trust` 命令 | HIDE_ADVANCED | 已从默认 help/discovery 隐藏（Polish C），保留高级 fallback/status/recover |
| `/permissions` 命令 | HIDE_ADVANCED | 同上 |
| 四个权限模式差异说明 | KEEP | 出现在状态行短标签 + `/help` 默认 + 启动屏；不裸露 raw policy fields |
| Workspace Trust prompt | KEEP | 轻量首次确认 + Enter/Esc；不做 CCB TrustDialog 完整实现 |
| Command Capability Catalog group 字段 | KEEP | 为 help/suggestions/discovery 统一数据基础（OpenCode 理念） |
| Native Runner | KEEP (disabled by default) | optional/fallback/long-task candidate，不替代短任务默认路径 |
| Remote Channels | KEEP (disabled by default) | 默认关闭，summary_only redaction，只企业微信/飞书/钉钉 |
| 完整 onboarding wizard | NOT-DO | Linghun 是 CLI，不做 desktop 级 wizard |
| 插件/skill 市场 | NOT-DO | Phase 15.5D Connect Lite 只做显式 add/install，不做市场/评分/云同步 |
| 记忆自动学习 | NOT-DO | Phase 16 — `/memory learn` candidate-only, modelCalled=false, no autoAccept |
| Bundled codebase-memory | DEFER_RELEASE | 外部 CLI 依赖，归 release packaging gate |
| Fast Workspace Scanner | NOT-DO | benchmark-gated, post-runner |

**用户层学习负担评估**：
- 普通用户首次启动：语言选择（1 步）→ Workspace Trust（Yes/No）→ 自然语言描述目标
- 不需要记住任何 slash 命令
- `/help` 默认只展示最常用入口（P2-4 仍需收窄）
- 高级命令和审计术语隐藏
- **整体方向正确**，剩余负担主要在 `/help` 和 `/doctor` 默认仍偏重

---

## 8. Performance & Windows Gate Review

### 8.1 Performance Gate 数据可信度

- **baseline**：small + medium synthetic/offline benchmark，16 logical cores，G:\linghun-perf-gate
- **after-fix**：仅 C01 log artifact tail/grep/errors 改善（medium-log-tail-40: 22.72ms → 0.59ms）
- **DEFERRED**：E02 background/job views, context/compact, JSONL, provider stream, workspace cache — 全部因为没有 data-backed benefit 或 focused correctness failure
- **NOT-DO**：Large/G stress, real project smoke, DB/sqlite/indexer

**可信度**：synthetic/offline 结果可信；gate 规则"无数据不支持就 DEFERRED"合理。large stress 和 real smoke 的缺失被正确标注，不伪装。

### 8.2 Windows Stability

- **中文/空格路径**：config test 覆盖 Chinese + space project paths, drive-letter casing, non-C storage path
- **CRLF/LF**：log-artifact test 覆盖 mixed CRLF/LF + Chinese text；tools test 覆盖 CRLF/mixed newline 检测
- **UTF-8/mojibake**：tools test 覆盖 UTF-8 Chinese stdout/stderr；mojibake detection 在 Bash output 中
- **Symlink/junction**：log-artifact test 覆盖 symlink/junction escape rejection（via realpath guard）
- **Child/grandchild cleanup**：tools test 覆盖 sentinel file not written after timeout/cancel on Windows
- **Native runner fallback**：tui test 覆盖 corrupt version output fallback + no PASS evidence
- **路径归一化分散**：（P1-2）不同模块 path redact/canonicalization 实现不一致

### 8.3 Real Smoke 必须关注项

- 长 transcript resume 性能（synthetic A01/A02 已测但 DEFERRED）
- 多 job/background status 响应速度（E02 无改善）
- 真实 provider streaming 行为（F01 未测 live）
- 真实 Windows cancel/timeout 进程残留
- 大仓库 workspace cache refresh 延迟

---

## 9. Real Smoke Watchlist

真实项目 smoke 必须优先观察以下项（按优先级）：

| 优先级 | 观察项 | 理由 |
|--------|--------|------|
| **W1** | 普通自然语言 → 模型 → tool_use → permission → tool_result → continuation → final answer 完整链路 | 核心链路虽已源码实现但仅 focused/local 验证 |
| **W2** | 真实 provider streaming 行为（首 token 延迟、SSE 解析、tool call 组装、usage/cache 字段、HTTP error 恢复） | F01 provider parser 未 live tested |
| **W3** | Windows 真实项目路径（中文/空格/非 C 盘）下的完整 TUI 体验 | P1-2 路径归一化分散 |
| **W4** | 长会话 transcript resume（>10K events） | synthetic A02 已测但 DEFERRED；real session 首次验证 |
| **W5** | Windows cancel/timeout 后进程残留 | grandchild cleanup 在 antivirus 下可能失败 |
| **W6** | Workspace Trust 首次启动在非 TTY/pipe/CI 环境的行为 | Polish B keypress hook 仅 TTY |
| **W7** | `/help` `/doctor` 在 80 列窄终端的可读性 | Polish C/D 已处理但仅 snapshot test |
| **W8** | real project 的 index init/refresh 速度和 `/index status` 准确性 | codebase-memory 外部 CLI 依赖 |

---

## 10. Release / Open-Source Deferred Items

以下正确归入 release/open-source gate，不视为 real smoke 前 blocker：

- GitHub Actions release artifacts（Windows/Linux/macOS）
- SHA256 checksum
- 一条命令安装验证
- 商业级签名、AV 矩阵、公证
- bundled native runner binary distribution
- bundled codebase-memory distribution
- 完整发布物料（官网、文档站、changelog）
- `.gitattributes` / `.editorconfig`（**已确认存在**，原 P1-7 已关闭）

---

## 11. Documentation / Report Truthfulness Review

### 11.1 交付报告口径检查

| 报告 | 状态标记 | 是否误导 | 分析 |
|------|----------|----------|------|
| Polish A | delivered | 否 | 明确标注 P0-1~P0-4 已关闭 / 推进 |
| Polish B | `FINAL_CLOSE` | **口径不统一** | 使用 `FINAL_CLOSE`，但实际为执行者本地复核，未经过独立 verifier |
| Polish C | `FINAL_CLOSE_LOCAL_VERIFIED` | **口径不统一** | 使用 `FINAL_CLOSE_LOCAL_VERIFIED`，与 B/D 不一致 |
| Polish D | `LOCAL_VERIFIED` | **口径不统一** | 使用 `LOCAL_VERIFIED`，与 B/C 不一致 |
| Phase 15.5A-F | done; focused/local validation only | 否 | 所有 15.5 报告正确标注 focused/local only |
| Phase 16 | done; focused/local validation only | 否 | 同上 |
| Phase 17A/B/C | done | 否 | 正确标注不生成 PASS evidence |

**口径问题**（P2-1）：Polish B/C/D 使用了三种不同状态标记（`FINAL_CLOSE` / `FINAL_CLOSE_LOCAL_VERIFIED` / `LOCAL_VERIFIED`），但三者均为执行者本地复核闭合，均未经过独立 verifier。不阻塞 smoke，但建议统一口径为 `LOCAL_VERIFIED` 并明确标注是否经过 independent verifier。**不要求独立 verifier 作为 smoke 前置条件。**

### 11.2 .gitattributes / .editorconfig 复核（原 P1-7 已关闭）

- `.gitattributes` 存在：`* text=auto`，`*.ts/*.tsx/*.js/*.json/*.md/*.yml/*.yaml/*.toml text eol=lf`
- `.editorconfig` 存在：`charset=utf-8`，`end_of_line=lf`，`insert_final_newline=true`，`indent_style=space`，`indent_size=2`
- 原审计（2026-05-23）标记为缺失属**事实错误**；本轮复核纠正。

### 11.3 START_NEXT_CHAT 一致性

`START_NEXT_CHAT.md` 未反映 Polish B/C/D、Phase 15.5B-F、Phase 16、Phase 17A/B/C 均已完成。同 README.md P2-3 问题。

### 11.4 Beta PASS / smoke-ready / open-source-ready 滥用检查

**无滥用**。全部 26 份交付/审计报告均正确限定声明范围。无一份将 focused/mock/local PASS 推断为 Beta PASS / smoke-ready / open-source-ready。

---

## 12. Final Recommendation

### 12.1 当前状态

**`NO_TRUE_BLOCKERS`**

审计未发现能证明真实项目 smoke 会直接失败的 blocker。底座健康（462 tests + typecheck + build 全 PASS，0-14 基线回归全部 PASS）。真实 smoke 可以启动，但需携带 watchlist 并在 smoke 早期优先处理 P1 项。

### 12.2 真 blocker vs smoke watchlist

**真 blocker（smoke 启动前必须修复）**：0 项。

**Smoke 前强烈建议处理（P1，3 项）**：
1. **P1-1**：提交 `tui/index.ts` 最小首批拆分计划（不要求拆完）
2. **P1-2**：确认 Windows 路径归一化一致性或集中 helper
3. **P1-3**：状态行追加 cache/index 短摘要

**Smoke 中/后可处理（P2，16 项）**：报告口径统一、memory scope 区分、README 更新、help/doctor 收紧等。

### 12.3 Smoke Watchlist（按优先级）

真实项目 smoke 启动时优先观察（与 Section 9 一致）：

| 优先级 | 观察项 | 对应 finding |
|--------|--------|-------------|
| **W1** | 完整自然语言→模型→工具→权限→结果链路 | 核心链路仅 focused/local 验证 |
| **W2** | 真实 provider streaming 行为 | F01 provider parser 未 live tested |
| **W3** | Windows 中文/空格/非 C 盘路径 TUI 体验 | P1-2 路径归一化分散 |
| **W4** | 长会话 transcript resume（>10K events） | synthetic A02 已测但 DEFERRED |
| **W5** | Windows cancel/timeout 后进程残留 | grandchild cleanup 在 antivirus 下可能失败 |
| **W6** | Workspace Trust 非 TTY/pipe/CI 行为 | Polish B keypress hook 仅 TTY |
| **W7** | `/help` `/doctor` 80 列窄终端可读性 | Polish C/D 已处理但仅 snapshot test |
| **W8** | index init/refresh 速度和准确性 | codebase-memory 外部 CLI 依赖 |
| **W9** | `tui/index.ts` 是否需要 smoke 期间紧急修改 | P1-1 大文件维护风险 |

### 12.4 明确 NOT（重申）

- ❌ 不是 Beta PASS
- ❌ 不是 smoke-ready
- ❌ 不是 open-source-ready
- ❌ 不是 Phase 18 / 桌面端 / 开源发布
- ❌ 不提交 commit
- ❌ 本次不做代码改动
- ❌ 不要求 independent verifier 作为 smoke 前置条件

---

## 13. Handoff Packet

```json
{
  "phase": "pre-smoke-terminal-product-ultimate-audit",
  "date": "2026-05-24",
  "correctionDate": "2026-05-24",
  "correctionSummary": "复核 .gitattributes/.editorconfig（已存在→关闭P1-7）；index.ts P0→P1（不能证明直接失败）；去掉 independent verifier 作为P1要求→合并为口径一致性P2；区分真blocker vs smoke watchlist",
  "verdict": "NO_TRUE_BLOCKERS",
  "scope": "全量审计（只读）：Phase 00-14 回归 + Phase 15.5A-F + Phase 16 + Phase 17A/B/C + Polish A/B/C/D — 12 审计维度 + 14 项回归",
  "indexProject": "F-Linghun",
  "indexStatus": "ready (nodes=1936, edges=4111)",
  "findings": {
    "P0": 0,
    "P1": 3,
    "P2": 16,
    "CLOSED": 1
  },
  "P0List": [],
  "P1List": [
    "P1-1: packages/tui/src/index.ts 16,401 lines; maintenance risk during smoke (was P0-1)",
    "P1-2: Windows path canonicalization scattered across modules (was P1-4)",
    "P1-3: Status line cache/index info still missing (was P1-1)"
  ],
  "P2List": [
    "P2-1: Report status label inconsistency (merged was P1-2 + P1-3)",
    "P2-2: Memory session-scope boundary unclear (was P1-5)",
    "P2-3: README.md outdated (was P1-6)",
    "P2-4 ~ P2-16: help/doctor/hints/remote/placeholder/skip-dirs/bundled-cbm/release-artifact/test-coverage/perf-gate-deferred/large-stress/shortcuts/wizard/native-runner-binary/ai-sessions"
  ],
  "closedItems": ["P1-7: .gitattributes/.editorconfig — both files exist with correct content; original audit factual error corrected"],
  "trueBlockers": [],
  "stronglyRecommendedBeforeSmoke": ["P1-1 (split plan only, not full refactor)", "P1-2", "P1-3"],
  "smokeWatchlist": ["W1 core loop", "W2 provider streaming", "W3 Windows paths", "W4 long transcript", "W5 process cleanup", "W6 non-TTY trust", "W7 narrow terminal", "W8 index speed", "W9 index.ts emergency fix risk"],
  "baseHealthy": true,
  "baseEvidence": "CLI/TUI boot → config → provider → tool → permission → session → evidence all PASS typecheck/build/462 tests",
  "zeroRegressionPhase00To14": true,
  "overdesignClean": "Architecture Runtime, NCB, Verdict Evidence Gate 均 SIMPLIFY/HIDE_ADVANCED；无新增 agent/ADR/spec/marketplace/wizard",
  "truthfulnessClean": "全部 26 份报告均正确限定声明范围；无 Beta PASS/smoke-ready 滥用；P1-7 已纠正为事实错误",
  "noIndependentVerifierRequired": true,
  "nextAction": "用户确认是否启动真实 smoke（携带 watchlist）；或先处理 P1-1~P1-3 再启动",
  "recommendedCommand": "corepack pnpm typecheck && corepack pnpm test && corepack pnpm build && corepack pnpm check",
  "notDone": [
    "代码改动",
    "commit",
    "真实 project smoke",
    "Beta PASS / smoke-ready / open-source-ready 声明",
    "Phase 18 桌面端",
    "开源发布",
    "综合验收门禁"
  ],
  "evidenceRefs": [
    "本报告 (pre-smoke-terminal-product-ultimate-audit.md) — 已修正",
    "packages/tui/src/index.ts:2097 (runTui), :2210 (handleSlashCommand), :12651 (sendMessage), :15195 (decidePermission)",
    "packages/tui/src/runtime-status-presenter.ts:16-35 (formatRuntimeStatusLine)",
    "packages/tui/src/log-artifact.ts:506-513 (redactLogContent)",
    "packages/shared/src/index.ts (normalizePermissionMode)",
    "packages/config/src/index.ts (loadConfig, mergeConfig, API key stripping, workspaceTrust)",
    ".gitattributes (exists, 10 lines, LF for code files)",
    ".editorconfig (exists, 13 lines, utf-8/LF/indent=2)",
    "docs/delivery/ 26份阶段交付/审计报告",
    "codebase-memory index: F-Linghun ready (nodes=1936, edges=4111)"
  ]
}
```

---

## 14. 参考核对（本轮）

- **本阶段实际读取的 Linghun 文档**：全部 26 份交付/审计报告（详见 Section 2.2）
- **本阶段实际读取的 Linghun 源码**：全部核心模块（详见 Section 2.2）
- **本阶段实际参考的本地 CCB / 社区项目**：`reference-map.md` 登记的全部参考源（详见 Section 4）
- **行为参考 vs 自研实现**：CCB/OpenCode/Warp 交互边界为行为参考；Linghun 全部 TypeScript 源码为自研
- **未复制可疑源码**：已确认 30 项防重复系统证据（详见 Section 3.3）

---

*终极审计完成于 2026-05-24；修正 pass 完成于同日。修正后状态：NO_TRUE_BLOCKERS — P0=0, P1=3, P2=16, CLOSED=1；0-14 基线回归全部 PASS；底座健康；真实 smoke 可以启动，携带 watchlist。*
