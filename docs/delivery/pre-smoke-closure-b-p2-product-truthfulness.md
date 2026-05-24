# Pre-Smoke Closure B - P2 Product & Truthfulness Closure

## 状态声明

- 本轮目标：真实项目 smoke 前收口终极审计中高收益、低风险 P2 项。
- 本轮只做成熟度、可见性和口径收口；不做发布、真实 provider、真实 smoke 或大架构改动。
- 本轮未执行真实项目 smoke。
- 本轮不是 Beta PASS / smoke-ready / open-source-ready。
- 本轮未进入 Phase 18 / 桌面端 / 开源发布。
- 本轮未提交 commit。
- 本轮未调用 live provider/API，未使用真实 key。
- 本轮未新增第二套 help / doctor / memory / runtime / config / provider / tool / permission / evidence / job / MCP / index / agent 系统。
- 本轮未改变四权限模式、Start Gate、permission pipeline、Plan approval 或 PASS evidence 语义。
- 本轮未复制 CCB / OpenCode / Warp / 第三方源码。

## Source-Level Reality Check 摘要

### 索引状态

- 开工前运行 `git status --short`：输出为空，工作树无冲突/半成品。
- codebase-memory `index_status` 首次以 `project_name=F-Linghun` 查询失败，随后用 `list_projects` 确认项目存在，再以 `project=F-Linghun` 查询成功。
- codebase-memory 项目：`F-Linghun`
- 状态：`ready`
- 规模：`nodes=1939`，`edges=4018`

索引只用于缩小定位范围；最终结论以源码、测试和验证命令为准。

### Existing implementation

- `/help` 统一走 `packages/tui/src/index.ts` 的 `handleSlashCommand()`、`formatCatalogHelp()`、`formatSlashDiscovery()` 与 Command Capability Catalog；已有 `/help all|advanced|details` 完整入口，默认已是短视图。
- `/doctor` 统一走 `handleDoctorCommand()` 与 `packages/tui/src/terminal-readiness-presenter.ts` 的 `formatTerminalReadinessDoctor()`；已有 `showAll` 分层，`/doctor all|details|checklist|project|report` 完整入口已存在。
- `/memory stats` 走 `packages/tui/src/index.ts` 的 `formatMemoryStats()`；Memory runtime 已有 candidate / accepted / rejected / disabled / retired lifecycle，`writeMemoryRecord()` 对 `session` scope 不落盘，prompt injection 已是 accepted-only topK。
- README / START_NEXT_CHAT / delivery reports 已有真实 smoke 前状态说明，但 README/START 对 Closure A 后当前状态和 provider key 临时 env 边界还不够新。
- Polish B/C/D 报告均已有本地验证说明，但 frontmatter 使用 `FINAL_CLOSE` / `FINAL_CLOSE_LOCAL_VERIFIED` / `LOCAL_VERIFIED` 三种状态口径。

### Gaps

- Polish B/C/D 报告状态口径不统一，容易让后续开发者误解本地验证、independent verifier、整体 readiness 的关系。
- `/memory stats` 虽已说明 accepted-only topK 与 no auto-learning，但没有明确区分 session-scope 与 project/user persistent scope。
- README / START_NEXT_CHAT 没有明确写出 Closure A 已完成、当前 Closure B 边界、真实 smoke 仍需用户确认、真实 key 只能临时 env 注入。
- `/help` 默认短视图仍出现“高级、恢复、调试命令”文案，容易把高级入口重新前置给新手。
- `/doctor` 默认在存在 hard BLOCK 时只展示 hard block，WARN/PARTIAL actionable items 可能被隐藏到完整详情；本轮目标要求默认 summary + non-pass。

### Minimal touch points

- `packages/tui/src/index.ts`
- `packages/tui/src/terminal-readiness-presenter.ts`
- `packages/tui/src/index.test.ts`
- `README.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/README.md`
- `docs/delivery/pre-smoke-tui-polish-b-interactive-controls-permission-workspace-trust.md`
- `docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md`
- `docs/delivery/pre-smoke-tui-polish-d-language-memory-agent-productization.md`
- `docs/delivery/pre-smoke-closure-b-p2-product-truthfulness.md`

### Forbidden duplicate systems

本轮没有新增第二套：

- command catalog / help renderer / slash router
- doctor runtime / readiness data source / evidence store
- memory lifecycle / auto-learning loop / per-turn learner
- provider/model loop / tool runtime / permission pipeline
- Start Gate / Plan approval / PASS evidence semantics
- job / agent / MCP / index runtime
- config/provider/tool/permission/evidence systems

## P2 裁决总表

| P2 item | 裁决 | 处理说明 |
| --- | --- | --- |
| P2-1 Report status label inconsistency | DONE | Polish B/C/D frontmatter 统一为 `LOCAL_VERIFIED`，正文明确本地复核、无 independent verifier PASS、不等于 readiness。 |
| P2-2 Memory session-scope boundary | DONE | `/memory stats` 明确 session-scope 仅当前 TuiContext/当前会话、project/user persistent scope 为 accepted-only topK、candidate 不自动接受/注入。 |
| P2-3 README / START current state | DONE | README、START_NEXT_CHAT 更新到 Phase 15.5A-F、Phase 16、Phase 17A/B/C、Polish A-D、Performance Gate 小范围修复、Closure A 已本地/聚焦/模拟/合成验证闭合；真实 smoke 仍需确认。 |
| P2-4 `/help` default slimming | DONE | 默认 `/help` 保持最常用入口，文案改为完整命令表入口，不把“高级/恢复/调试”作为新手默认视野；`/help all|advanced|details` 保留完整入口。 |
| P2-5 `/doctor` default slimming | DONE | 默认 `/doctor` summary-first，展示全部 non-pass actionable items；完整详情仍走 `/doctor all|details|checklist|project|report`。 |
| P2-6 Light hints priority | NOT-DO | Polish C 已完成 priority/cooldown/单轮限流；本轮不再重复改。 |
| P2-7 Remote `webhook_mock` | DEFERRED | 继续作为 diagnostic/test-only；不在默认新手视野新增宣传或功能。 |
| P2-8 MCP placeholder | DEFERRED | 保持 safe placeholder 边界，不写成 fake implementation。 |
| P2-9 hard-skip dirs | DEFERRED | 保持 `.linghunignore` / ignore override 边界说明；不改 workspace cache/index。 |
| P2-10 bundled codebase-memory | DEFERRED | 归 release/open-source packaging gate；本轮不做 bundled artifact。 |
| P2-11 release artifact | DEFERRED | 归 release/open-source packaging gate；本轮不做发布物。 |
| P2-12真实 provider integration tests | DEFERRED | 真实 smoke 本身是下一步待用户确认；本轮不跑 live provider/API。 |
| P2-13 Performance Gate deferred items | DEFERRED | 保留为 real smoke watchlist 或 future gate；本轮不跑 large/G stress。 |
| P2-14 Large/G drive stress | DEFERRED | 不在本轮跑；真实 smoke/后续性能门观察。 |
| P2-15 shortcut system maturity | DEFERRED | Polish B 已覆盖 TTY Esc/Enter/Shift+Tab 与 slash fallback；真实 TTY 体验留到 smoke watchlist。 |
| P2-16 AI Sessions MCP builtin | KEEP / NOT-DO | 保持 optional external bridge，不内置、不新增系统。 |

## 实现内容

### A. Report status truthfulness

- `pre-smoke-tui-polish-b-interactive-controls-permission-workspace-trust.md`
  - frontmatter `status` 改为 `LOCAL_VERIFIED`。
  - 正文新增统一口径：执行者本地复核闭合、未声明 independent verifier PASS、independent verifier 不作为真实 smoke 前置条件、不等于 Beta PASS / smoke-ready / open-source-ready。
- `pre-smoke-tui-polish-c-output-tone-doctor-details.md`
  - frontmatter `status` 改为 `LOCAL_VERIFIED`。
  - 正文新增同样状态口径。
- `pre-smoke-tui-polish-d-language-memory-agent-productization.md`
  - 保留 `LOCAL_VERIFIED`，正文补齐同样状态口径。

### B. Memory scope clarity

- `/memory stats` 新增：
  - `session-scope`：只在当前 `TuiContext` / 当前会话生效，不跨新会话持久化。
  - `project/user persistent scope`：仅已接受记录参与 accepted-only topK prompt injection。
  - `candidate`：候选不自动接受，不自动注入 prompt。
  - 保留 `autoLearning=off`、`no per-turn learning model call`、`autoAccept=no`、不注入完整候选/聊天/日志/index dump。
- 未改变 Memory lifecycle：仍是 candidate-first、显式 accept、可 disable/rollback/delete。
- 未新增自动学习或逐轮学习。

### C. README / START_NEXT_CHAT current state

- `README.md` 当前进度更新为：Phase 15.5A-F、Phase 16、Phase 17A/B/C、Polish A-D、Performance Gate 小范围修复、Closure A 已完成对应 local/focused/mock/synthetic validation。
- 明确当前仍不是 Beta PASS / smoke-ready / open-source-ready。
- 明确下一步是 Closure B 完成后由用户确认是否进入真实项目 smoke。
- 明确 provider keys 只能在真实 smoke 时通过临时 env 注入，不得写入文档或配置。
- `START_NEXT_CHAT.md` 同步当前任务状态：Closure B 是当前阶段，完成后停止；真实 smoke、Phase 18、开源发布都不能自动进入。
- `docs/delivery/README.md` 新增 Closure A / Closure B 记录，便于后续开发者定位。

### D. `/help` default slimming

- 默认 `/help` 继续只展示最常用入口：`/model`、`/mode`、`/doctor`、`/problems`、`/help`、`/exit`。
- 默认文案从“高级、恢复、调试命令仍可用”收窄为“完整命令表：/help all、/help advanced 或 /help details”。
- `/trust`、`/permissions`、debug/audit/internal 命令未回到默认视野。
- `/help all|advanced|details` 仍保留完整命令表。

### E. `/doctor` default slimming

- 默认 `/doctor` 继续 summary-first：OK/WARN/BLOCK 结论 + 本地检查范围 + non-pass actionable items。
- 调整点：存在 BLOCK 时也展示全部 non-pass items，不只展示 hard block，避免 WARN/PARTIAL 被默认隐藏。
- 完整详情仍走 `/doctor all|details|checklist|project|report`。
- 未改变 doctor runtime facts、readiness items、problems/evidence 来源。
- 不泄露 raw evidence/tool_result/gateId/API key/path raw details 到默认输出。

### F. Other P2 items裁决

- Remote `webhook_mock`：继续作为 diagnostic/test-only，不在默认新手视野误导。
- MCP placeholder：保持 safe placeholder，不伪装成真实实现。
- hard-skip dirs：保持 `.linghunignore` / ignore override 边界，真实项目 smoke 观察。
- bundled codebase-memory / release artifact / native runner binary：归 release/open-source gate。
- Performance Gate DEFERRED / large stress：保留为 real smoke watchlist 或 future performance gate，不现在跑。
- AI Sessions MCP：保持 optional external bridge，不内置。

## 修改文件清单

### Code

- `packages/tui/src/index.ts`
  - `/memory stats` 输出补充 session-scope / project-user persistent / candidate scope 边界。
  - `/help` 默认文案进一步降噪，不把高级/恢复/调试词放回新手默认视图。
- `packages/tui/src/terminal-readiness-presenter.ts`
  - 默认 `/doctor` 输出全部 non-pass actionable items，完整 checklist 仍只在 details/all 层。

### Tests

- `packages/tui/src/index.test.ts`
  - 覆盖 `/memory stats` 的 session-scope boundary、project/user persistent accepted-only topK、candidate 不自动接受/不注入、no autoAccept/no per-turn learning。
  - 覆盖 `/doctor` 默认不隐藏 BLOCK/WARN/PARTIAL non-pass 项。
  - 保留 `/help` 默认不显示 `/trust` / `/permissions`、`/help all` 完整可发现的回归断言。

### Docs

- `README.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/README.md`
- `docs/delivery/pre-smoke-tui-polish-b-interactive-controls-permission-workspace-trust.md`
- `docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md`
- `docs/delivery/pre-smoke-tui-polish-d-language-memory-agent-productization.md`
- `docs/delivery/pre-smoke-closure-b-p2-product-truthfulness.md`

## Focused tests 结果

### Focused filter run

```bash
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Closure B|memory|help|doctor|Polish C|Polish D|trust|permission"
```

结果：PASS（第二次运行）

- Test Files: 1 passed
- Tests: 43 passed, 130 skipped
- 备注：首次运行发现 `/doctor` 默认只展示 hard block 时测试断言未覆盖 non-pass actionable item，已最小调整 presenter 后复跑通过。
- 备注：doctor presenter 覆盖通过 `packages/tui/src/index.test.ts` 现有 focused tests 完成，本轮未新增测试文件。

### Focused file run + validation chain

```bash
corepack pnpm exec vitest run packages/tui/src/index.test.ts && corepack pnpm typecheck && corepack pnpm check && corepack pnpm build && git diff --check
```

结果：PASS（第二次运行）

- Vitest: Test Files 1 passed；Tests 173 passed。
- Typecheck: PASS。
- Check: PASS。
- Build: PASS。
- `git diff --check`: PASS。
- 备注：首次 validation chain 在 `corepack pnpm check` 发现 `packages/tui/src/index.test.ts` 新增长断言格式化差异；按 formatter 期望最小换行后复跑全链路 PASS。

## 验证命令结果

| command | result |
| --- | --- |
| `git status --short` | 开工前输出为空；无冲突/半成品。 |
| `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Closure B|memory|help|doctor|Polish C|Polish D|trust|permission"` | PASS：1 file passed，43 tests passed，130 skipped。 |
| `corepack pnpm exec vitest run packages/tui/src/index.test.ts` | PASS：1 file passed，173 tests passed。 |
| `corepack pnpm typecheck` | PASS。 |
| `corepack pnpm check` | PASS。首次发现测试断言格式化差异，已最小修正后复跑通过。 |
| `corepack pnpm build` | PASS。 |
| `git diff --check` | PASS。 |

## 最终单独复审

用户要求停止继续追加独立复审后，本轮改为执行者单独复审并更新报告；不再把独立 verifier 作为本轮完成前置。

| check | result |
| --- | --- |
| `Grep docs terminal-readiness-presenter.test.ts` | PASS：无匹配；报告不再引用不存在的 `terminal-readiness-presenter.test.ts`。 |
| `Grep Polish B/C/D FINAL_CLOSE / status` | PASS：Polish B/C/D frontmatter 均为 `LOCAL_VERIFIED`；无冲突的 `FINAL_CLOSE` / `FINAL_CLOSE_LOCAL_VERIFIED` 当前状态口径。 |
| `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Closure B\|memory\|help\|doctor\|Polish C\|Polish D\|trust\|permission"` | PASS：1 file passed；43 tests passed，130 skipped。 |
| `corepack pnpm check && git diff --check` | PASS：Biome check 68 files；`git diff --check` 无输出。 |
| `git status --short` | PASS：仅本轮预期修改文件与新增 Closure B 报告；未提交 commit。 |

## 剩余风险和 real smoke watchlist

- `/doctor` 默认现在展示全部 non-pass items；若真实项目中 non-pass 数量过多，后续可按数据再收窄为“全部 BLOCK + top WARN + /problems”，但本轮按 Closure B 要求优先保证 non-pass 不隐藏。
- `/memory stats` 只收口文案和 scope 计数，不改变 memory lifecycle；真实 smoke 仍需观察用户是否理解 session-scope 不跨新会话。
- `/help` 默认仍保留 6 个核心入口；完整命令表通过 `/help all|advanced|details`，真实 smoke 观察新手是否能发现细节入口。
- 真实 provider streaming、tool_use/tool_result、真实项目路径、长会话 resume、大仓库 index/cache、Windows cancel/timeout、large/G drive stress 仍属于 real smoke / future gate watchlist。
- 未执行 live provider/API、真实项目 smoke、large stress、release artifact、bundled binary 或真实 provider integration test。

## 参考核对

### Linghun 文档

本轮实际读取并遵守：

- `START_NEXT_CHAT.md`
- `README.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/audit/pre-smoke-terminal-product-ultimate-audit.md`
- `docs/delivery/pre-smoke-closure-a-p1-engineering-risk.md`
- `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- `docs/delivery/pre-smoke-tui-polish-b-interactive-controls-permission-workspace-trust.md`
- `docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md`
- `docs/delivery/pre-smoke-tui-polish-d-language-memory-agent-productization.md`

### 参考源

- 本轮没有读取或复制 CCB / OpenCode / Warp / 第三方源码。
- 本轮只依据 Linghun 现有源码、交付文档和终极审计 P2 清单做最小产品/真实性收口。
- 本轮未引入第三方实现、依赖或发布物。

## Handoff Packet

- 当前阶段：Pre-Smoke Closure B - P2 Product & Truthfulness Closure。
- 当前结论：P2 高收益低风险项已做最小本地收口；不声明 Beta PASS / smoke-ready / open-source-ready。
- 下一步：停止，等待用户确认是否进入用户指定真实项目的 Real Provider + Real Project Smoke。
- 禁止事项：不要自动进入真实 smoke、Phase 18、桌面端、开源发布、release artifact、bundled binary、large stress 或真实 provider live test；不要提交 commit。
- Evidence：本报告、修改文件清单、focused tests、typecheck、check、build、diff-check。
- Index status：`F-Linghun` ready，`nodes=1939`，`edges=4018`。
- Permission / provider context：本轮为本地源码和文档收口；未调用真实 provider；未改变权限模式。
- Commit status：未提交 commit。
