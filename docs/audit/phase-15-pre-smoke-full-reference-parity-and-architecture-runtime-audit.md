# Phase 15 Pre-Smoke Full Reference Parity Audit + Permission / Architecture Runtime Feasibility + Source-of-Truth Reset

> 审计日期：2026-05-21
> 审计类型：文档与现有 runtime 只读审计；本报告不修改运行时代码。
> 当前用途：Phase 15 real-project smoke 之前的最新执行基线。历史 audit / READY / PASS / closure 只能作为 evidence 输入，不能越过本报告。
> 禁止推断：本报告不宣布 Phase 15 Beta PASS，不允许自动进入 Phase 15.5 / Phase 16+，不允许把历史 focused / mock / local / scoped PASS 升级为真实 smoke 通过。

## 1. Executive verdict

**Verdict：`READY_TO_IMPLEMENT`。**

含义：已经具备足够证据确定 Phase 15 real-project smoke 前必须先执行的最小 remediation batch；不是 smoke-ready，也不是 Beta-ready。

当前结论：

1. **Phase 15 real-project smoke 暂不允许启动。**
2. **必须先完成 Batch A / B / C。**
   - Batch A：四个用户可见权限模式收口。
   - Batch B：Architecture Runtime source-of-truth 设计写入活跃文档。
   - Batch C：Architecture Runtime 最小成熟 runtime 实现。
3. Batch D 只承接本报告列出的其他 pre-smoke blocker；若执行 Batch A-C 时未发现新的真实 smoke 阻塞，可不扩展。
4. Compact Lite、Verification / Review Runtime Lite、Write/Edit/MultiEdit CCB-grade UX、provider maturity、Freshness / Web Evidence、MCP / Skills / Plugins Connect Lite、release/open-source gate、TUI runtime maintainability hardening 等仍主要归属 Phase 15.5，除非真实 smoke 直接证明污染 Phase 15 默认路径。

## 2. Current source of truth

本报告之后，Phase 15 smoke 前的文档优先级为：

1. `README.md`、`START_NEXT_CHAT.md`、`docs/delivery/README.md` 中对当前状态和下一步的最新口径。
2. 本报告：`docs/audit/phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md`。
3. `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md` 中经本轮同步后的权限模式、Architecture Runtime、阶段归属和 smoke gate。
4. `docs/audit/reference-map.md` 作为参考源总表。
5. 历史 audit / closure / delivery report 只作为 evidence，不作为当前执行入口。

历史报告降级规则：

- 任何历史 `PASS` / `READY` / `READY_TO_FIX` / `READY_FOR_USER_DECISION` 都不得覆盖本报告。
- Batch 1/2/3 focused/mock/local verification guard、Batch 3.5 PASS、单个 live text PASS、silent-failure ban PASS 不能推断 Beta PASS。
- Phase 00-14 的 done 只能代表当时阶段最小闭环，不能写成开源前成熟度。

## 3. Evidence read in this audit

### 3.1 Linghun active source-of-truth docs

已读取或按需检索：

- `README.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/README.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/audit/reference-map.md`
- `docs/delivery/active-docs-source-of-truth-hardening-2026-05-21.md`

关键事实：

- 当前活跃文档仍强调 Phase 15 Beta readiness 为 PARTIAL/BLOCKED。
- 当前下一步在本报告之前仍指向 Active Docs Source-of-Truth Hardening 后进入 smoke；本报告将该下一步替换为 pre-smoke Batch A-C。
- 蓝图、规格书、路线图中仍存在旧权限模式文本：`acceptEdits`、`dontAsk`、`auto`、`bypass`。
- 这些旧名称需要变成 legacy alias / internal compatibility，不应继续作为用户可见主路径。

### 3.2 Linghun runtime evidence

已读取或按需检索：

- `packages/shared/src/index.ts`
- `packages/config/src/index.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/permission-presenter.ts`
- `packages/providers/src/index.ts`

关键事实：

- `packages/shared/src/index.ts` 当前定义：`PermissionMode = "default" | "plan" | "acceptEdits" | "dontAsk" | "auto" | "bypass"`。
- `packages/config/src/index.ts` 当前 config validation 只接受上述六个旧 mode，不接受 `auto-review` / `full-access`。
- TUI `/mode` 当前仍展示 `default / plan / acceptEdits / dontAsk / auto / bypass`。
- `cycleMode()` 当前循环 `default / plan / acceptEdits / auto`。
- `/plan accept` 当前会把 `acceptEdits` 作为批准边界之一。
- `getAgentPermissionMode()` 仍可能使用 `dontAsk`。
- Natural Command Bridge 的 RuntimeStatus、slot、mode action 和 catalog 仍使用旧 `PermissionMode`。
- `permission-presenter.ts` 已有人类可读权限卡片基础，但 mode 字段仍来自旧 `PermissionMode`。
- Provider runtime 已有真实 `tool_use` / `tool_result` 事件、OpenAI-compatible chat / responses profile、retry / timeout、`supportsTools` guard 和 error classifier，但这不等于 provider maturity 已完成。
- 未发现 Architecture Runtime 作为独立 runtime capability 的实现证据；现有 Plan / Natural Command Bridge / Anti-Hallucination evidence 不能替代它。

### 3.3 CCB / CCB Dev Boost local reference evidence

已读取或按需检索：

- `F:\ccb-source\packages\builtin-tools\src\tools\AskUserQuestionTool\AskUserQuestionTool.tsx`
- `F:\ccb-source\packages\builtin-tools\src\tools\EnterPlanModeTool\EnterPlanModeTool.ts`
- `F:\ccb-source\packages\builtin-tools\src\tools\ExitPlanModeTool\ExitPlanModeV2Tool.ts`
- `F:\ccb-source\src\components\permissions\PermissionRequest.tsx`
- `F:\ccb-source\docs\safety\plan-mode.mdx`
- `F:\ccb-source\docs\safety\permission-model.mdx`
- `F:\ccb-source\docs\ccb-optimizations.md`
- `F:\ccb-source\docs\context\compaction.mdx`
- `F:\ccb-source\docs\context\token-budget.mdx`
- `F:\ccb-source\docs\agent\sub-agents.mdx`
- `F:\ccb-source\docs\features\background-agent-selector.md`
- `F:\ccb-source\docs\features\mcp-skills.md`
- `F:\ccb-source\docs\features\status-line.mdx`
- `F:\ccb-source\docs\features\workflow-scripts.md`
- `F:\ccb-source\docs\features\web-search-tool.md`
- `F:\ccb-source\docs\features\context-collapse.md`

参考边界：只参考公开行为、交互边界、验收标准和失败降级；不复制源码、不复制内部 API、不复制专有实现。

关键参考事实：

- CCB Plan Mode 是显式 read-only runtime：EnterPlanMode、ExitPlanMode、用户批准、plan 文件、restore previous mode、prompt-based permission。
- AskUserQuestion 是工具级用户问题 primitive，read-only、requires user interaction、返回 tool_result。
- CCB PermissionRequest 是工具级 UI routing，不是单一泛化 prompt。
- CCB compaction 关注 tool_use/tool_result pairing、compact boundary、microcompact、post-compact reinjection 和 token budget。
- CCB agent lifecycle 区分同步/后台/fork/teammate、权限模式、tool pool、sidechain transcript、TaskOutput / TaskStop 类生命周期。
- CCB Dev Boost 参考了 codebase-memory、cache-first、MCP tool schema 稳定和 usage/stats，但不能把宣传收益或 provider 字段写成 Linghun 成熟度。

## 4. Reference coverage matrix

| 参考源 | 本轮覆盖方式 | 本轮结论 | 阶段归属 |
| --- | --- | --- | --- |
| CCB / Claude Code Best | 本地 CCB Plan、Question、Permission、Context、Agent、Feature docs | 权限、Plan、tool protocol、compact、agent lifecycle、status/handfeel 是主要成熟参考；不可复制源码 | Phase 15 pre-smoke / 15.5 |
| CCB Dev Boost | `docs/ccb-optimizations.md` | cache-first、codebase-memory、usage/stats 和 MCP schema 稳定是参考；不得宣传固定收益 | Phase 09/10/15/15.5 |
| Phase 15 interaction review | `PHASE_15_PREFLIGHT_INTERACTION_REVIEW_REPORT.md` | 历史 P1 已作为 evidence；本报告重新裁决当前 pre-smoke blocker | Phase 15 evidence |
| OpenCode | 公开 GitHub；当前公开页显示 archived/moved to Crush | 参考 terminal coding assistant、多 provider、TUI/LSP/MCP 方向；不推断 Linghun 成熟度 | Phase 13/14/15.5/18 |
| Warp | 公开网站 | 参考 block/panel、agent visibility、workflow/runbook、output readability；仅作 handfeel | Phase 15.5/18 |
| OpenSpec | 公开网站 | 参考 proposal/design/tasks/spec delta 的 process；不阻塞 Phase 15 smoke | Phase 15.5 |
| LiteLLM / OpenRouter / Vercel AI SDK 类 provider abstraction | LiteLLM/OpenRouter docs；Vercel AI SDK 按同类抽象处理，不在本轮做 runtime claim | 参考 provider routing、OpenAI-compatible、usage/cost/fallback/capability metadata；Linghun provider maturity 仍 Phase 15.5 | Phase 13/15/15.5 |
| Hermes Agent | 公开 release / memory-skill references | 参考 memory、skills、plugin、durable multi-agent、goal persistence；不能提前进入自动学习 | Phase 16 |
| codebase-memory-mcp | 公开 GitHub + Linghun runtime evidence | 参考 indexing、architecture query、trace/search/detect_changes、本地处理；bundled/license/NOTICE/doctor maturity 仍后置 | Phase 10/15/15.5/17 |
| AI Sessions MCP | WebSearch 受限，未获得可靠项目页；仅按 reference-map 方向处理 | 只作为跨工具 session 迁移方向；本轮不作当前 runtime claim | Phase 11/17 |
| MCP 官方生态 | MCP docs | tools/resources/prompts/server/client/discovery/trust 是 Connect Lite 基础；不阻塞 smoke，除非默认路径依赖 | Phase 10/14/17/15.5 |
| CC Switch | 公开 GitHub | 参考 provider switch、usage dashboard、quota/balance 来源标记和单位 caveat；不把本地估算伪装成 billing | Phase 13/15/15.5 |
| oh-my-openagent | WebSearch 得到公开 GitHub 入口，未深入抓取详情 | 只作为 team mode / skills / hooks / lifecycle 的公开行为参考；本轮不作 Linghun runtime claim | Phase 12-14/17 |
| Feishu / Lark CLI | reference-map only，本轮未发现 Phase 15 本地 smoke 相关性 | 仅 remote channel adapter 方向；本轮明确不相关 | Phase 17 |
| DingTalk CLI | reference-map only，本轮未发现 Phase 15 本地 smoke 相关性 | 仅 remote channel adapter 方向；本轮明确不相关 | Phase 17 |
| WeCom / 企业微信 CLI | reference-map only，本轮未发现 Phase 15 本地 smoke 相关性 | 仅 remote channel adapter 方向；本轮明确不相关 | Phase 17 |
| OpenHands | 公开 GitHub | 参考 core / CLI / local GUI / cloud / enterprise 分层；仅作桌面/服务端预留 | Phase 18 |
| Aider | 公开 GitHub | 参考 terminal pair programming、Git-centered reversible edits、surgical diff handfeel | Phase 05/08/15/15.5 |
| Reasonix 类缓存方案 | reference-map only；未获得可核验公开实现 | 仅保留 cache-first / prefix stable 思想；不得宣传固定收益 | Phase 09/15 |
| Ink | 公开 GitHub | 参考 React-style terminal UI primitives；不让 UI 细节污染 core | Phase 04/07/18 |
| Tauri | 公开网站 | 参考 desktop packaging、安全、IPC 边界；不是当前 TUI smoke blocker | Phase 18 |

## 5. Full gap table

> 分类只能使用：`PRE_SMOKE_BLOCKING`、`PRE_SMOKE_PULL_FORWARD`、`BETA_WATCH`、`PHASE_15_5`、`PHASE_16`、`PHASE_17`、`PHASE_18`、`NOT_DO`。

| # | 面向 | Current evidence | Gap | Category | Batch | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Permission modes | Shared/config/TUI/NCB/docs 仍使用 `default/plan/acceptEdits/dontAsk/auto/bypass` 六模式 | 用户可见模式未统一到四个：`default`、`auto-review`、`plan`、`full-access`；`auto-review` / `full-access` runtime 不可配置 | `PRE_SMOKE_BLOCKING` | A | `PermissionMode` canonical 四模式；legacy alias 映射：`acceptEdits`/`auto` -> `auto-review`，`bypass` -> `full-access`，`dontAsk` -> `default` 或 legacy alias；config normalize 后持久化 canonical；TUI/help/status/NCB/tests 不再主展示旧模式 |
| 2 | Permission safety semantics | 旧 `bypass` / `auto` 已有 opt-in/gate 概念，但命名和展示分散 | 收口后必须保持甚至强化安全边界，不能因改名放宽 | `PRE_SMOKE_BLOCKING` | A | `full-access` 必须本地显式 opt-in；`auto-review` 必须有本地 gate/classifier 或明确只覆盖低风险 workspace edits；Plan 仍禁止写入；工具权限管道不被自然语言绕过 |
| 3 | Plan / Question runtime | Linghun 有 `/plan` 基础；CCB 有 Enter/Exit/AskUserQuestion 工具级成熟边界 | Linghun 不能宣称 CCB-equivalent；但 smoke 前不必完整复制 AskUserQuestion/ExitPlanMode 工具 | `BETA_WATCH` | D if exposed | smoke 若出现架构澄清只能口头模糊/无法选择，登记 P1；否则留 Phase 15.5/16 设计 |
| 4 | Architecture Runtime | 未发现独立 runtime capability；Plan / NCB / evidence 不能替代 | 用户已冻结为 smoke 前底层能力；必须先设计并实现最小成熟版本 | `PRE_SMOKE_BLOCKING` | B/C | 活跃 docs 定义 Architecture Runtime；runtime 能在复杂/架构场景隐式触发、避开小任务、读取项目事实、输出 Architecture Card、记录 drift check；测试覆盖触发/不触发/卡片字段/漂移提醒 |
| 5 | Anti-Hallucination coordination | EvidenceSummary、RuntimeStatus、local docs/index 已有事实基础 | Architecture Runtime 必须调用事实层，不得自造项目事实 | `PRE_SMOKE_PULL_FORWARD` | C | Architecture Card 的 project facts 必须来自 README/package/config/index/current style 或明确 unknown；unknown 时才问用户；不能把外部参考当 Linghun 已实现 |
| 6 | Natural Command Bridge | Catalog、router、Start Gate、permission_pipeline 已有；历史 P1 多轮修过 | 仍需防止四模式改名导致 slot/parser/help 漂移；Architecture Runtime 触发不能污染 NCB | `PRE_SMOKE_PULL_FORWARD` | A/C | `mode` slot 支持 canonical + legacy alias；自然语言 `切到自动审查/full access/计划/default` 映射正确；危险 mode 仍进 gate/permission；小任务不触发 Architecture Card |
| 7 | Tool protocol / permission / continuation | Provider has `tool_use` / `tool_result` event loop, supportsTools guard, continuation | 成熟度仍需真实 provider smoke；本轮不改 runtime | `BETA_WATCH` | D if smoke fails | smoke 必须证明真实 provider tool_use/tool_result、denial tool_result、final continuation、unsupported fallback 不假装成功 |
| 8 | Index / codebase-memory | Linghun 有 managed/env/path binary source/status；reference-map 规定 bundled maturity 后置 | 不应把外部 MCP/managed status 写成开源前 bundled maturity | `PHASE_15_5` | none | Phase 15.5 再验 packaging/license/NOTICE/fixed version/doctor/path masking；Phase 15 smoke 只需 index status/query 不污染默认路径 |
| 9 | Compact / context | CCB compact 参考明确；Linghun Compact Lite 已归属 15.5 | 非 smoke blocker，除非真实 smoke 出现上下文爆炸/工具对破坏 | `PHASE_15_5` | none | 15.5 保护 tool_use/tool_result pair、boundary、manual/auto/micro compact、失败降级 |
| 10 | Verification / Review Runtime | Linghun 有 background/verify/report 基础；lite hardening 已后置 | 成熟 cancel/timeout/stale/log-path 仍未作为 smoke 前必须项 | `PHASE_15_5` | none | 15.5 统一 evidence，cancel/timeout 不残留，long output only log/details，不能无证据 PASS |
| 11 | Write/Edit/MultiEdit editing UX | 核心工具基础存在；Aider/CCB 提供 surgical/reviewable reference | CCB-grade diff preview/stale/read-before-edit/multiedit handfeel 属开源前 hardening | `PHASE_15_5` | none | 15.5 才补 read-before-edit guard、diff review、stale detection、Windows/中文路径、changedFiles summary |
| 12 | Provider / gateway maturity | Linghun provider runtime 有 profiles/retry/timeout/supportsTools；LiteLLM/OpenRouter/CC Switch 显示更成熟 provider abstraction | 当前不能宣称 provider maturity、quota/balance billing maturity | `PHASE_15_5` | none | 15.5 区分 reported/estimated/missing/unknown；usage/cache/quota/balance 来源可诊断；fallback/retry 审计；native/gateway/custom profile matrix |
| 13 | Freshness / Web Evidence | 本报告使用 web evidence；Linghun runtime Freshness Gate 仍未作为成熟能力证明 | 不应声称最新价格/API/社区状态，除非有 web_source evidence | `PHASE_15_5` | none | 15.5 建 Freshness Gate：本地优先、联网授权、官方来源优先、web_source evidence、失败降级 |
| 14 | MCP / Skills / Plugins Connect Lite | Phase 14 loader/doctor/trust/permissions 已完成；MCP docs 参考 discovery/lifecycle | Connect Lite 市场/安装/更新/发现-before-execute 等仍后置 | `PHASE_15_5` | none | 15.5 实现 discovery-before-execute、trust/schema/doctor/enable-disable failure isolation；不阻塞 Phase 15 smoke 默认路径 |
| 15 | Agent / task lifecycle | Linghun 有 background/task/agent 基础；CCB 参考 TaskOutput/TaskStop/selector/fork lifecycle | 完整 CCB-grade TaskOutput/TaskStop 和 UI selector 不是当前 blocker | `PHASE_15_5` | none | 15.5 补统一 stop/output/status、terminal before cleanup、background retention、long output path |
| 16 | TUI / output / report handfeel | Linghun 有 summary-first 和 reports；Warp/OpenCode/CCB 提供 handfeel reference | 轻量 block/panel/polish 仍后置；pre-smoke 只需不污染默认路径 | `BETA_WATCH` | D if smoke fails | smoke 中若输出不可扫读、权限等待不可见、长输出进 prompt，则登记 blocker；否则 Phase 15.5 polish |
| 17 | Release / open-source gate | 活跃 docs 已说明 P0/P1/P2 gate | 不能把 terminal-scope P2 默认留到开源发布 | `PHASE_15_5` | none | 开源前 terminal-scope P0/P1/P2 清零、NOT-DO 或 out-of-scope 证明 |
| 18 | Maintainability | `packages/tui/src/index.ts` 接近超长；规格已把拆分列入 15.5 | 当前不因可维护性直接阻塞 smoke，除非改 Batch A/C 无法安全落地 | `PHASE_15_5` | D only if needed | 若 Batch A/C 必须局部拆分，只允许最小行为保持；大拆分仍 15.5 |
| 19 | Remote channels / official CLI adapters | Feishu/Lark、DingTalk、WeCom only reference-map | 与本地 Phase 15 smoke 无直接关系 | `PHASE_17` | none | Phase 17 再按 official_cli、脱敏、登录诊断、幂等、nonce/signature 验收 |
| 20 | Learning / memory / skill evolution | Hermes reference shows mature memory/skills/learning loop | 不得提前做自动学习/后台自主演练 | `PHASE_16` | none | Phase 16 才做候选生成、accept/reject/retire、stale/conflict、成本 guard/cache 稳定 |
| 21 | Desktop / server reservation | OpenHands/Tauri/Ink reference | 不得用桌面/GUI补当前 TUI 手感 | `PHASE_18` | none | Phase 18 只验证 core/API/IPC 复用，前提是终端 TUI 成熟 |
| 22 | Copying third-party implementation | reference-map 明确禁止 | 禁止复制 CCB/OpenCode/Hermes/third-party source/internal API | `NOT_DO` | none | 只写行为参考和验收边界；不粘贴/移植第三方实现 |

## 6. Permission feasibility verdict

**Verdict：可行，但必须作为 pre-smoke blocker 先实现。**

目标用户可见模式冻结为四个：

| Canonical mode | 用户含义 | 主要边界 |
| --- | --- | --- |
| `default` | 默认审慎模式 | 写文件、Bash、高风险动作仍走权限管道；`dontAsk` legacy alias 不得带来静默越权 |
| `auto-review` | 低风险编辑自动审查 / 自动通过受控低风险路径 | `acceptEdits` 与可用 gate 的 `auto` 归并；不得自动通过 Bash、联网、依赖、权限、越界路径、第三方扩展、hook/job/remote |
| `plan` | 只规划，不执行写入 | 写文件、Bash、高风险动作拒绝；退出 plan 必须明确用户批准边界 |
| `full-access` | 显式本地 opt-in 的高权限模式 | `bypass` legacy alias；必须本地显式开启，不能由模型、自然语言、workflow、agent、plugin、hook、remote 静默打开；硬拒绝仍生效 |

Legacy mapping：

| Legacy | Mapping | 说明 |
| --- | --- | --- |
| `acceptEdits` | `auto-review` | 作为配置/历史 transcript alias 接受，但展示 canonical |
| `auto` | `auto-review` | 若本地 gate/classifier 不可用，必须降级或拒绝并说明 reason |
| `bypass` | `full-access` | 必须本地 opt-in；旧名只作 alias |
| `dontAsk` | `default` 或 legacy alias | 不得作为用户可见主模式继续推广 |
| `default` | `default` | 不变 |
| `plan` | `plan` | 不变 |

最小影响面：

- `packages/shared/src/index.ts`
- `packages/config/src/index.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/permission-presenter.ts`
- 相关 tests：config、TUI mode、Natural Command Bridge、permission presenter / runtime status。
- 活跃 docs 与 delivery docs。

不可接受的弱化实现：

- 只改 README/help，不改 runtime type/config/parser。
- 把 `auto-review` 伪装成旧 `auto` 全自动执行。
- 把 `full-access` 变成默认可用或自然语言可开。
- 删除高级能力而不是隐藏旧名。

## 7. Architecture Runtime feasibility verdict

**Verdict：可行，且必须作为 pre-smoke bottom-layer capability 先落地最小成熟版。**

Architecture Runtime 定义：

- 不是第五个 permission mode。
- 不是 Plan Mode。
- 不是 skill。
- 不是 prompt-only 文案。
- 是底层工程判断 capability，与 Anti-Hallucination Runtime 协作。

职责分工：

| Runtime | 负责 | 不负责 |
| --- | --- | --- |
| Anti-Hallucination Runtime | facts、evidence、source、boundaries、freshness、unknown 标记 | 工程路线选择本身 |
| Architecture Runtime | 工程方向、技术选择、拆解、风险、验证路线、长期可维护性、non-goals | 编造事实、替代权限、替代 Plan approval |

触发规则：

- 应触发：多文件/跨模块改动、架构选择、公共接口变化、依赖/配置变化、阶段性实现、系统性缺口修复、用户要求对照成熟参考、可能影响长期维护性的实现。
- 不应触发：拼写、单行修复、明确局部 bug、纯只读状态查询、用户只问事实且无需工程决策。

最小 Architecture Card 字段：

```text
Architecture Card
- target
- project facts
- recommended approach
- rejected approaches
- staged breakdown
- risks
- verification
- non-goals
```

最小 runtime acceptance：

1. 小任务不触发 Architecture Card。
2. 明显架构任务会触发 Architecture Card。
3. Card 的 `project facts` 只来自本地证据：README/package/config/current style/index/source；没有证据必须写 unknown。
4. 推荐方案默认给出一个成熟方案，不把选择推给新手；只有事实不可知才问用户。
5. 后续执行前检查 drift：若实现路径偏离 Card 的 recommended approach / non-goals，必须提示并重新确认或更新 card。
6. Card 不授权写文件、不改变权限 mode、不替代 Start Gate。

## 8. Pull-forward list

必须在 real-project smoke 前拉入 Phase 15 pre-smoke：

1. **Batch A：four permission modes closure**
   - Canonical modes、legacy alias、config normalization、TUI/NCB/help/status/tests 同步。
2. **Batch B：Architecture Runtime source-of-truth design into docs**
   - 蓝图、规格书、路线图、delivery README、START_NEXT_CHAT、README 明确 Architecture Runtime 定义、触发规则、Architecture Card、drift check、与 Anti-Hallucination Runtime 的边界。
3. **Batch C：Architecture Runtime minimal mature implementation**
   - 本地触发器、facts collector、Architecture Card output、drift check、测试。
4. **Batch D：other pre-smoke blockers if found**
   - 只处理 Batch A-C 实施或最小 smoke preflight 中暴露的真实 blocker；不得借 Batch D 启动 Phase 15.5/16+。

## 9. Keep-deferred list

保持后置，不得写成 Phase 15 smoke 前完成：

- Compact Lite 完整成熟度。
- Verification / Review Runtime Lite 完整成熟度。
- Write/Edit/MultiEdit CCB-grade editing UX。
- Provider maturity：native/gateway/custom profile matrix、usage/cache/quota/balance source diagnostics、billing reconciliation。
- Freshness / Web Evidence runtime gate。
- MCP / Skills / Plugins Connect Lite：discovery-before-execute、schema/trust/install/enable/disable/update maturity。
- Agent / task lifecycle CCB-grade TaskOutput / TaskStop / background selector。
- Terminal block/panel polish。
- Release/open-source terminal-scope P2 清零。
- TUI runtime maintainability large split。
- Phase 16 learning/memory/skill evolution。
- Phase 17 durable jobs / remote channels / official CLI adapters。
- Phase 18 desktop/server reservation。

## 10. Minimal implementation batches

### Batch A：four permission modes closure

Scope：runtime + docs 的最小闭口。

Required changes：

- `PermissionMode` canonical type 改为四模式，或引入明确 `CanonicalPermissionMode` 并确保 user-visible path 使用 canonical。
- 配置读取时接受 legacy alias 并 normalize。
- 配置写入、`/mode`、Shift+Tab、status、doctor、Natural Command Bridge、permission prompt、handoff packet 显示 canonical。
- Legacy alias 只在兼容层、历史配置迁移、错误提示中出现。
- Tests 覆盖：alias normalize、invalid mode、mode switch、natural mode slot、full-access opt-in、auto-review gate/low-risk boundary、plan write denial。

Acceptance：

- 用户界面主路径只看到 `default / auto-review / plan / full-access`。
- 旧配置仍可读，不崩溃，且提示/持久化 canonical。
- `full-access` 无 opt-in 时无法开启。
- `auto-review` 不自动放行 Bash / dependency / permission / plugin / hook / remote。

### Batch B：Architecture Runtime source-of-truth design into docs

Scope：只更新活跃文档，不写 runtime code。

Required docs：

- `README.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/README.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/audit/reference-map.md`

Acceptance：

- 明确本报告为当前 pre-smoke source-of-truth。
- 明确 Architecture Runtime 是 pre-smoke bottom-layer capability，不是 permission mode / Plan / skill。
- 明确 Architecture Card 字段、触发/不触发、drift check。
- 明确 Batch A-C 是 smoke 前下一步。
- 不把 Phase 15.5/16/17/18 后置项写成已完成。

### Batch C：Architecture Runtime minimal mature implementation

Scope：最小 runtime，不做大重构。

Likely files：

- `packages/tui/src/index.ts` 或其现有 prompt/runtime context 区域。
- `packages/tui/src/natural-command-bridge.ts` only if trigger/status needs NCB integration。
- `packages/shared/src/index.ts` only if shared types are needed。
- `packages/tui/src/index.test.ts` / relevant tests。

Acceptance：

- 小局部请求不触发 Card。
- 架构/多文件/公共接口/依赖/阶段实现请求触发 Card。
- Card 字段完整、短小、中文默认、人类可读。
- `project facts` 有证据来源或 unknown。
- 执行前 drift check 生效。
- 不改变权限 mode，不绕过 Start Gate。

### Batch D：other pre-smoke blockers if found

Scope：只处理 A-C 暴露或 smoke preflight 直接证明的 blocker。

Acceptance：

- 每个新增 blocker 必须有 evidence、category、最小修复范围、验证命令。
- 不得把 Phase 15.5 hardening 打包进 Batch D。

## 11. Active docs update plan

必须更新：

- `README.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/README.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/audit/reference-map.md`

更新原则：

1. 将本报告设为当前 pre-smoke source-of-truth。
2. 将当前唯一下一步改为 Batch A-C，而不是直接 smoke。
3. 明确四权限模式方向与 legacy alias。
4. 明确 Architecture Runtime 定义与 smoke 前归属。
5. 保持 Phase 00-14 done 的最小闭环含义，不写成 open-source maturity。
6. 保持 Phase 15.5/16/17/18 后置项归属，不提前宣布完成。
7. 历史 audit 保留为 evidence，不删除。

## 12. Documentation invariant checks required after docs update

必须运行：

```bash
git diff --check
```

必须人工/脚本检查：

- 无未否定的 `Beta PASS` / `Beta readiness PASS`。
- 无自动进入 Phase 15.5 / 16+ 的表述。
- 无旧 audit READY/PASS 被写成当前执行入口。
- 活跃 docs 必须引用本报告。
- 用户可见权限模式统一为四个 canonical modes；旧模式只能出现在 legacy mapping / 历史证据 / 后置说明中。
- Architecture Runtime 不得写成 permission mode。
- 每个 `PRE_SMOKE_BLOCKING` / `PRE_SMOKE_PULL_FORWARD` 均有 batch 和 acceptance criteria。

## 13. Final recommendation

按以下顺序继续：

1. 更新活跃 source-of-truth docs，使本报告成为当前 pre-smoke 执行基线。
2. 运行 `git diff --check` 与 documentation invariant check。
3. 进入 Batch A：四权限模式 runtime/docs/tests 收口。
4. 进入 Batch B：Architecture Runtime source-of-truth 设计补齐。
5. 进入 Batch C：Architecture Runtime 最小成熟 runtime 实现。
6. A-C 独立验证通过后，才允许重新评估是否启动 real-project smoke。

**Smoke allowed：否。**

当前允许的下一步是：Active docs 同步本报告，然后执行 Batch A-C。不得宣布 Beta PASS，不得自动进入 Phase 15.5 / Phase 16+。