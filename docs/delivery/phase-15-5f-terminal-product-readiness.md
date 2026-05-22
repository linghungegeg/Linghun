# Phase 15.5F：Terminal Product Readiness

## 阶段目标

本轮只完成 Pre-Open-Source Terminal Product Completion Gate 的 Phase 15.5F：Terminal Product Readiness。范围限定为终端 TUI 主屏成熟度、summary-first readiness doctor、Problems Lite、本地/静态 pre-real-smoke readiness guard，以及帮助/状态入口与已实现能力对齐。

本轮不进入真实全量 smoke，不声明 Beta PASS、smoke-ready 或 open-source-ready，不进入 Phase 16 / 17 / 18，不提交 commit，不新增第二套 provider、tool、permission、evidence、MCP、index、agent、job、remote、learning、desktop 或 release runtime，不复制 CCB / Claude Code / OpenCode / 第三方源码。

## Source-Level Reality Check 摘要

### Existing implementation

- `packages/tui/src/index.ts` 已有统一 slash command dispatcher、`/status`、`/help`、`/model doctor`、`/index status|doctor`、`/cache status`、`/memory`、`/mcp doctor`、`/background`、`/verify last`、`/details`、provider failure evidence 和 transcript/system_event 分层。
- Phase 15.5A-E 已落地 Workspace Reference Cache / Workspace Snapshot Lite、Resource Guard / Background Lifecycle、Verification / Review Runtime Lite、Log Artifact Runtime Lite、Connect Lite、Provider Runtime Contract、Freshness Lite 和 Web-source Evidence Lite。
- `packages/tui/src/runtime-status-presenter.ts` 已提供短状态栏 presenter，`request-lifecycle-presenter.ts` 已提供 provider failure primary 人话化，`tool-output-presenter.ts` 已提供 tool output 主屏/详情分层。
- `packages/tui/src/natural-command-bridge.ts` 已有 Command Capability Catalog 与 user-visible dispatch coverage test，可作为 `/help` 与自然语言桥能力边界的 source of truth。

### Gaps

- `/doctor` 只支持 `/doctor hooks`，缺少 Phase 15.5F 要求的 pre-real-smoke 本地 readiness doctor/checklist/report guard。
- `/status` 只有短状态栏，没有明确把 A-F focused/local validation 与 Beta PASS / smoke-ready 区分开。
- 缺少 Problems Lite 主屏入口，无法集中展示 verification/provider/background/freshness/index 的本地 runtime 问题摘要。
- `/help` 和 command catalog 尚未显式暴露 terminal readiness / problems 入口。
- readiness 输出需要确保 cancelled/timeout/stale/missing/unknown 不会被展示为 PASS，并避免 raw provider body、apiKey、UUID、raw tool_result、完整路径或大输出进入主屏。

### Minimal touch points

- `packages/tui/src/terminal-readiness-presenter.ts`：新增最小 presenter/helper，只消费既有 runtime state，不新增第二套 runtime。
- `packages/tui/src/index.ts`：接入 `/doctor [readiness]`、`/problems`、`/status` readiness companion line；复用现有 state 生成 `TerminalReadinessView`。
- `packages/tui/src/natural-command-bridge.ts`：补齐 `/doctor` readiness 与 `/problems` command catalog/registry。
- `packages/tui/src/index.test.ts`：补 focused regression，覆盖 readiness doctor、Problems Lite、raw debug/path/secret 不泄露、timeout/stale 不 PASS、普通开发请求仍进 provider。
- `docs/delivery/README.md` 与本报告：阶段交付闭环。

### Forbidden duplicate systems

本轮未新增第二套 provider/tool/permission/evidence/MCP/index/agent/job/runtime；未新增真实 smoke runner、remote channel、durable job、learning/memory evolution、desktop 或 open-source release flow；未新增依赖；未复制 CCB / Claude Code / OpenCode / 第三方源码、内部 API、专有遥测或反编译痕迹。

## 已完成功能

- 新增 `Terminal Readiness Presenter`：集中格式化 terminal readiness doctor、readiness status companion line 和 Problems Lite 输出。
- `/doctor` 默认输出本地/静态 readiness checklist；`/doctor readiness`、`/doctor status`、`/doctor checklist`、`/doctor project`、`/doctor report` 等价输出 Phase 15.5F readiness/report guard；`/doctor hooks` 继续保留既有 hooks doctor。
- `/status` 保持既有短状态栏，同时追加一行 readiness companion：本地 pass 数、待处理数，并明确 `非 smoke/Beta PASS`。
- 新增 `/problems`：仅从既有 runtime state 汇总 verification、provider failure、background blocked task、freshness missing source、index stale/error，以及 project/drift/context/rollback/cost Lite 的轻量问题摘要。
- `/help` 与 Command Capability Catalog 更新：暴露 `/doctor [readiness]`、`/doctor project` 和 `/problems`，并保持 `/doctor hooks` 可见。
- Readiness checklist 覆盖：provider/model、index、cache/context、memory/rules、mcp/connect、background/tasks、verification、freshness/web evidence、Project Doctor Lite、Source-of-Truth Drift Linter Lite、Context Picker Lite、Rollback Coach Lite、Task Cost Preview Lite。
- 成熟度判定收紧：Project Doctor Lite 逐项检查 test/typecheck/check/build scripts、tsconfig、Vitest、Biome、pnpm/corepack、CI workflow、LINGHUN.md；任一关键项缺失不得 PASS。Source-of-Truth Drift Linter Lite 检查 15.5A-E 报告存在和 15.5F 四类否定声明；Rollback Coach Lite 读取真实 `git status --short`；Context Picker Lite 只有 project rules + fresh index + workspace snapshot + evidence/verification ref 同时具备才 PASS。
- Product readiness guard：`pass` 只用于明确本地状态；missing/unknown/stale/cancelled/timeout/fail/partial 不会被计入 readiness PASS，也不会被表述为 Beta PASS、smoke-ready 或 open-source-ready。
- 主屏脱敏与收敛：Problems Lite 对 secret、本地绝对路径、raw provider diagnostic 做主屏脱敏/截断；详情仍通过 `/model doctor`、`/details evidence`、`/details background <id>`、`/verify last`、`/index doctor` 等入口查看。
- 普通开发请求不被 readiness doctor/local gate 拦截，仍按既有 provider/tool loop 执行。

## 使用方式

```text
/status
/doctor
/doctor readiness
/doctor project
/doctor report
/doctor hooks
/problems
```

- `/doctor`：查看本地/静态 terminal readiness checklist。该命令不运行真实 full smoke，不联网，不安装依赖，不刷新索引，不执行高风险动作。
- `/doctor project` / `/doctor report`：同一 readiness 输出中展开 Project Doctor Lite、Source-of-Truth Drift Linter Lite、Context Picker Lite、Rollback Coach Lite、Task Cost Preview Lite；仍为只读本地/静态 guard。
- `/status`：显示短状态栏，并追加 readiness companion line；只代表当前本地 runtime 摘要。
- `/problems`：查看当前 local runtime evidence 派生的问题摘要；没有问题也不代表 readiness PASS。
- `/doctor hooks`：继续查看既有 hooks doctor。

## 涉及模块

- `packages/tui/src/terminal-readiness-presenter.ts`：Phase 15.5F readiness/problem presenter；集中格式化 Project Doctor Lite、Source-of-Truth Drift Linter Lite、Context Picker Lite、Rollback Coach Lite、Task Cost Preview Lite。
- `packages/tui/src/index.ts`：接入 `/doctor` readiness/project/report、`/problems`、`/status` readiness line；新增 `createTerminalReadinessView()` / `createTerminalProblems()`，复用既有 `TuiContext` 派生 project/drift/context/rollback/cost Lite state。
- `packages/tui/src/natural-command-bridge.ts`：更新 command registry 与 capability catalog，补 `/doctor project` 自然语言入口。
- `packages/tui/src/index.test.ts`：新增 focused tests 并更新 help/status/readiness/problem 断言。
- `docs/delivery/README.md`：新增 Phase 15.5F 交付记录。
- `docs/delivery/phase-15-5f-terminal-product-readiness.md`：本报告。

## 关键设计

### Readiness is a local/static guard, not a smoke runner

Terminal readiness doctor 只读取既有 TUI runtime state：provider/model runtime、index status、cache/workspace snapshot、memory rules、MCP state、background lifecycle、last verification、last provider failure、evidence kind，以及少量本地静态文件存在性/短文本信号（package/config/CI/阶段报告）。它不触发真实 provider smoke、不自动刷新索引、不安装依赖、不联网、不执行构建发布流程。

### No PASS inflation

Readiness status 使用 `pass/partial/fail/unknown/stale/blocked`。只有明确本地 OK 的检查项计入 local pass；`cancelled`、`timeout`、`stale`、`missing`、`unknown`、`fail`、`partial` 都不会被升级成 PASS。输出固定声明这不是 Beta PASS、smoke-ready 或 open-source-ready。

### Primary/details/debug layering

主屏只输出短摘要、状态和下一步。Secrets、本地绝对路径、raw provider diagnostic 和长文本在 Problems Lite 主屏中脱敏/截断；完整 evidence、background output、verification logs 和 provider/index/cache/mcp 细节仍走既有 `/details` 与 doctor 入口。

### Reuse existing runtime state

本轮没有新增 readiness DB、problem DB、verification runner、provider resolver、index runtime 或 evidence runtime。`createTerminalReadinessView()` 只是对现有 `TuiContext` 做只读聚合，`terminal-readiness-presenter.ts` 只负责展示。

## 配置项

本阶段没有新增用户必须配置的新顶层配置项。沿用既有配置：provider/model route、permission mode、cache、index、memory、MCP、skills/plugins/hooks 等配置。

## 命令

本阶段新增或扩展终端入口：

- `/doctor`：新增默认 readiness doctor。
- `/doctor readiness` / `/doctor status` / `/doctor checklist`：readiness doctor alias。
- `/doctor project` / `/doctor report`：同一只读输出中展示 Project Doctor Lite、Source-of-Truth Drift Linter Lite、Context Picker Lite、Rollback Coach Lite、Task Cost Preview Lite 与 report/readiness guard。
- `/doctor hooks`：保留既有 hooks doctor。
- `/problems`：新增 Problems Lite 摘要，包含 verification/provider/background/freshness/index/project/drift/context/rollback/cost 来源。
- `/status`：追加 readiness companion line。

## 测试与验证

Focused/local validation（本轮已执行）：

- `corepack pnpm exec vitest run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts`：PASS（2 files，268 tests）。覆盖 `/doctor` readiness 默认路由、`/doctor project`、`/doctor hooks` 保留、`/status` readiness companion、`/problems`、Project Doctor Lite 逐项缺失不 PASS、Source-of-Truth Drift Linter Lite 15.5A-E 与否定声明检查、Context Picker Lite 收紧 PASS、Rollback Coach Lite 真实 `git status --short` 读取、Task Cost Preview Lite、主屏脱敏/无金额伪装/无 destructive rollback 建议，以及普通开发请求不被拦截。
- `corepack pnpm check`：PASS（Biome checked 57 files, no fixes applied）。
- `corepack pnpm typecheck`：PASS。
- `corepack pnpm build`：PASS。
- `git diff --check`：PASS（仅 Windows LF/CRLF warning，无 whitespace error）。

以上只表示 Phase 15.5F focused/local validation 通过；不代表真实全量 smoke、Beta PASS、smoke-ready 或 open-source-ready。

## 性能结果

- `/doctor` readiness 与 `/problems` 主要聚合内存中的 `TuiContext`，并做少量本地静态存在性/短文本读取；不新增 provider 请求、shell 命令、索引刷新、网络请求或后台任务。
- `/status` 只增加一行本地 readiness companion，避免扩展窄状态栏本体。
- Project Doctor Lite 只读取 package/config/CI/rules 的存在性和短 script key，不解析全仓库、不运行安装/测试。
- Source-of-Truth Drift Linter Lite 只核对固定阶段文档是否存在及报告是否提及关键 Lite 能力，不做完整文档审计平台。
- Problems Lite 限制展示前 8 个问题，并对长摘要截断，避免主屏 flood。

## 已知问题

- 本轮没有执行真实 full smoke，也没有证明安装、跨平台真实终端交互或 open-source release 流程 ready。
- Problems Lite 只读取已有 runtime state；没有新增 LSP、常驻 diagnostics、problem DB 或完整 IDE problem panel。
- Readiness doctor 是 pre-real-smoke 本地/静态 guard，不替代后续综合验收或真实项目测试。
- Freshness 项仍只基于现有 `web_source` evidence presence；本轮没有新增真实 WebSearch/WebFetch source runtime。

## 不在本阶段处理的内容

- 真实全量 smoke、Beta PASS、smoke-ready、open-source-ready 决策。
- Phase 16 / 17 / 18。
- 自动安装、自动刷新、自动联网、真实 release flow、发布包签名/上传。
- 第二套 provider / tool / permission / evidence / MCP / index / agent / job runtime。
- Learning/memory evolution、durable jobs、remote channels、desktop。
- 完整 LSP diagnostics、完整 problem DB、完整 provider compatibility matrix UI。
- commit。

## 下一阶段衔接

Phase 15.5F 完成后必须停止。下一步只能由用户确认是否进入 pre-real-smoke comprehensive audit / 综合验收；不得自动进入真实全量 smoke、Phase 16/17/18、开源发布或 commit。

## 开发者排查入口

- Readiness presenter：`packages/tui/src/terminal-readiness-presenter.ts`。
- `/doctor` / `/problems` / `/status` 接入：`packages/tui/src/index.ts` 的 `handleDoctorCommand()`、`createTerminalReadinessView()`、`createTerminalProblems()`、`writeStatus()` 调用点。
- Command catalog：`packages/tui/src/natural-command-bridge.ts` 的 `SLASH_COMMAND_REGISTRY` 与 `COMMAND_CAPABILITY_DATA`。
- Focused tests：`packages/tui/src/index.test.ts`、`packages/tui/src/natural-command-bridge.test.ts`。

## 参考核对

本阶段实际读取/核对的 Linghun 文档：

- `F:\Linghun\START_NEXT_CHAT.md`
- `F:\Linghun\docs\delivery\pre-open-source-terminal-product-completion-gate.md`
- `F:\Linghun\docs\audit\reference-map.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` Phase 15.5F 相关段落
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md` Phase 15.5F / TUI output layer / Problems Lite / readiness report 相关段落
- `F:\Linghun\docs\delivery\phase-15-5a-performance-context.md`
- `F:\Linghun\docs\delivery\phase-15-5b-resource-task-lifecycle.md`
- `F:\Linghun\docs\delivery\phase-15-5c-editing-tool-ux.md`
- `F:\Linghun\docs\delivery\phase-15-5c-plus-log-artifact-runtime-lite.md`
- `F:\Linghun\docs\delivery\phase-15-5c-plus-plus-workspace-snapshot-lite.md`
- `F:\Linghun\docs\delivery\phase-15-5d-connect-lite.md`
- `F:\Linghun\docs\delivery\phase-15-5e-provider-freshness.md`
- `F:\Linghun\docs\audit\phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md`
- `F:\Linghun\docs\audit\phase-15-pre-smoke-a-c-combined-acceptance.md`
- `F:\Linghun\docs\audit\phase-15-ccb-grade-default-runtime-reconciliation.md`
- `F:\Linghun\PHASE_15_BETA_CCB_MATURITY_REMEDIATION_BASELINE.md` sections 12 / 13
- `F:\Linghun\docs\delivery\README.md`

本阶段参考核对范围：

- CCB / Claude Code Best / OpenCode：仅参考 summary-first、primary/details/debug 分层、doctor/status/help 可操作性和“不把 focused PASS 当 ready”的产品边界；未复制源码或内部实现。
- Warp / Codex CLI / Aider：仅参考终端状态、问题摘要、命令帮助与可恢复下一步的行为边界；未复制源码。
- codebase-memory / MCP：仅复用 Linghun 既有 index/MCP state 和 doctor/status 命令，不新增外部 runtime。
- 进入 Linghun 自研实现的内容：readiness presenter、`/doctor` readiness、`/problems`、`/status` readiness companion、focused tests 和本交付报告。
- 未复制可疑源码实现、内部 API、专有遥测或第三方实现细节。

### Reference delta catch-up 裁决表

| 来源细节 | 裁决 | Phase 15.5F 处理 |
| --- | --- | --- |
| gate/spec：terminal TUI polish、help/doctor/status/error/report gate | DONE（Lite） | `/doctor` readiness、`/status` companion、`/problems` 和 help/catalog 对齐。 |
| spec：Project Doctor Lite / readiness checklist | DONE（Lite） | `/doctor` / `/doctor project` 聚合既有 runtime state，并静态读取 package/config/CI/rules 短信号；无安装、无测试执行、无联网。 |
| spec：Context Picker Lite | DONE（Lite） | `/doctor project` 输出 project-rules、workspace-snapshot、index-status、verification/background/evidence kind 等短 refs；不 dump raw source/log/index。 |
| spec：Source-of-Truth Drift Linter Lite | DONE（Lite） | 静态核对固定阶段文档存在性与 15.5F 报告关键 Lite 能力提及；不做完整审计平台。 |
| spec：Rollback Coach | DONE（Advisory Lite） | 只读展示 changedFiles/checkpoints 和下一步建议；不执行 reset/checkout/restore/commit。 |
| spec：Task Cost Preview Lite | DONE（Lite） | 展示 local-only/no-network/no-real-smoke/may-run-tests 等资源标签；不预测真实金额、不查 quota。 |
| spec：Problems panel Lite | DONE（Lite） | `/problems` 从 verification/provider/background/freshness/index/project/drift/context/rollback/cost runtime state 生成短摘要；无 LSP/problem DB。 |
| spec：primary/details/debug layering | DONE | 主屏 summary-first；详情仍走 `/details`、doctor、verification logs。 |
| baseline section 13：主屏不泄露 raw evidence / raw flags / full output | DONE | Problems Lite 主屏脱敏/截断；测试覆盖 secret/path 不泄露。 |
| baseline section 13：cancelled/timeout/stale 不能 PASS | DONE | verification cancelled/timeout/stale 显示为 blocked；background blocked 不计入 pass。 |
| baseline section 13：普通输入必须进 provider/tool loop | DONE | 测试覆盖普通开发请求仍到 provider。 |
| full expand/collapse rich TUI UI | DEFERRED | 本轮只做 terminal-scope summary/details 命令入口，不做 rich UI。 |
| full provider matrix / quota/balance reconciliation | DEFERRED | 不在 15.5F Lite 范围。 |
| real full smoke / Beta PASS / smoke-ready / open-source-ready | NOT-DO | 输出固定声明不代表 ready。 |
| Phase 16 / 17 / 18 | NOT-DO | 本轮停止在 Phase 15.5F。 |

## 成品级结构化 handoff packet

- Current phase：Phase 15.5F Terminal Product Readiness。
- Status：focused/local validation passed so far；不是 Beta PASS，不是 smoke-ready/open-source-ready。
- Next step：user-confirmed pre-real-smoke comprehensive audit / 综合验收。
- Must not do next without confirmation：真实全量 smoke、Phase 16/17/18、commit、open-source release、remote channels、durable jobs、learning/memory evolution、desktop、第二套 runtime。
- Modified files：
  - `docs/delivery/README.md`
  - `docs/delivery/phase-15-5f-terminal-product-readiness.md`
  - `packages/tui/src/index.ts`
  - `packages/tui/src/index.test.ts`
  - `packages/tui/src/natural-command-bridge.ts`
  - `packages/tui/src/terminal-readiness-presenter.ts`
- Evidence references：focused vitest / typecheck / check command outputs in this session；本报告测试与验证章节。
- Verification results：focused/local commands passed；未执行真实全量 smoke，未执行真实联网/provider smoke，未执行 release flow。
- Index status：codebase-memory project `F-Linghun` was checked before implementation and reported ready（约 1570 nodes / 3059 edges）；index search returned no useful code hits, so implementation used source reads and focused tests for confirmation。
- Permission mode：local repository edits only；no remote operation；no dependency/config build pipeline changes；no commit。
- Model/provider：assistant session used Claude Sonnet 4.6 through Claude Code environment；Linghun runtime changes are provider-agnostic and only read existing TUI runtime state。
- Budget/cost note：no real provider/network smoke was run; validation used local pnpm/vitest/typecheck/check only。
