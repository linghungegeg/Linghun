---
title: Pre-Smoke TUI Polish D - Language, Memory UX, Narrow Terminal, Agent Display Names
status: LOCAL_VERIFIED
updated: 2026-05-24
---

# Pre-Smoke TUI Polish D - Language, Memory UX, Narrow Terminal, Agent Display Names

## 本轮定位

本轮是 **Pre-Smoke TUI Polish D**，只收尾 TUI 产品化体验层：

1. 首次 TTY 启动语言选择与持久化。
2. `/language` 语言切换持久化，并继续复用现有 prompt/runtime language 机制。
3. Memory UX 默认瘦身：候选优先、人工接受、accepted-only topK 注入、无自动逐轮学习。
4. 窄终端与主屏节奏：help/doctor/details/status/background/job/report 的关键行更短、更 summary-first。
5. Agent displayName 展示层产品化：ASCII-safe、可截断、可读，但不改变 agent/job 生命周期或权限语义。

本轮未进入 Performance & Windows Stability Hardening Gate、Phase 18、真实 smoke、开源发布或桌面阶段；未声明 Beta PASS、smoke-ready、open-source-ready；未提交 commit。

## Polish C micro-fix

按要求只修改 Polish C 交付文档，不改 Polish C runtime：

- `docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md`
  - frontmatter `status` 改为 `FINAL_CLOSE_LOCAL_VERIFIED`。
  - 明确报告结论为本地验证闭合。
  - 明确不声明 independent verifier PASS。

## Source-Level Reality Check

### 索引状态

本轮使用 codebase-memory 项目 `F-Linghun` 定位现有实现，当前索引状态：

```json
{"project":"F-Linghun","nodes":1913,"edges":4015,"status":"ready"}
```

索引搜索结果只作为定位线索，最终以源码、测试与本地验证为准。

### Existing implementation

- 语言配置已有基础类型：`LinghunConfig.language: Language`，`Language = "zh-CN" | "en-US"`。
- TUI context 已通过 `context.language` 影响用户输出与 `createModelSystemPrompt()` 的语言指令。
- 配置写入已有 `loadConfig()` / `writeConfig()` 与 `.linghun/settings.json` 路径。
- Workspace Trust 已有 TTY-only 首次启动确认；非 TTY 不进入交互提示。
- Memory 已有候选、review、accept/reject/disable/rollback/delete、accepted memory 注入与 topK 限制。
- Agent/job 已有 `AgentRun`、`DurableJobAgent`、`DurableJobState`、`/fork`、`/agents`、`/agents show`、`/job run/list/status/report`。
- Background/job 输出已有统一 presenter：`packages/tui/src/job-runner-presenter.ts`。

### Gaps

- 默认 `language` 来自 defaultConfig 时，无法区分“用户已选择”与“默认值”；TTY 首次启动缺少明确语言 picker。
- `/language` 只更新当前上下文，缺少持久化到项目配置。
- Memory 主屏仍偏内部状态，不够明确区分候选、长期记忆、prompt 注入与 lifecycle action。
- Agent/job 输出使用 id/type/role 较多，缺少可读但不影响语义的展示名。
- Job/background/report 关键行仍容易在窄终端过长。

### Minimal touch points

- `packages/config/src/index.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/job-runner-presenter.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/job-runner-presenter.test.ts`
- `docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md`
- `docs/delivery/pre-smoke-tui-polish-d-language-memory-agent-productization.md`

### Forbidden duplicate systems

本轮没有新增第二套：

- NCB / command catalog
- permission pipeline / Start Gate / Workspace Trust
- memory runtime / auto-learning loop / per-turn learner
- agent runtime / job runtime / durable lifecycle
- doctor runtime / details store / evidence store
- provider/model loop / tool runtime
- resident agent registry / marketplace / team hierarchy

## 参考核对

### Linghun 文档

本轮按要求读取/遵守：

- `START_NEXT_CHAT.md`
- `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- `docs/audit/pre-smoke-mature-tui-ux-source-level-audit.md`
- `docs/delivery/pre-smoke-tui-polish-a-natural-intent-command-surface.md`
- `docs/delivery/pre-smoke-tui-polish-b-interactive-controls-permission-workspace-trust.md`
- `docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md`
- `docs/audit/reference-map.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`

### 参考源裁决

- **DONE**：语言选择只做 TTY first-run picker + config persistence，不引入新 i18n runtime。
- **DONE**：Memory UX 只暴露候选/接受/注入摘要，不做自动接受、逐轮学习或完整聊天/日志/index 注入。
- **DONE**：Agent displayName 只作为展示标签，不改变 role、permissionMode、resource guard、evidence 或 lifecycle。
- **DONE**：Job/background/report 主屏继续 summary-first，保留 `/job report`、日志和 details 路径作为深入入口。
- **DONE**：Polish A/B/C 回归守卫保留：默认 `/help` 短视图、`/` 和 `/?` core-only、`/trust` advanced-only、`/doctor` 默认摘要、`/doctor all` 完整层、主屏不泄露 raw evidence/tool_result/gate id。
- **DEFERRED**：Performance & Windows Stability Hardening Gate、Phase 18、真实 smoke、开源发布。
- **DEFERRED**：OpenCode / Warp source-level 对照，因本地源码不可用。
- **NOT-DO**：不复制 CCB / OpenCode / Warp / 第三方源码。
- **NOT-DO**：不新增 rich command palette、完整 theme system、LSP、remote channel、provider 能力或 native runner 新能力。

## 实现内容

### Language UX

- 新增 `hasRecordedLanguage(projectPath)`，通过读取 `.linghun/settings.json` 判断用户是否已经显式记录语言。
- 新增 `saveLanguage(language, projectPath)`，复用现有 `loadConfig()` / `writeConfig()` 合并写入配置。
- TTY 首次启动时，在 Workspace Trust 之前展示双语语言选择：
  - Enter / `1` / 中文变体 => `zh-CN`
  - `2` / English 变体 => `en-US`
- 非 TTY 不弹语言选择，避免脚本/管道卡住。
- `/language zh-CN|en-US` 持久化到项目配置，并同步 `context.language`。
- Model prompt/runtime language 继续走既有 `context.language` -> `createModelSystemPrompt()`，没有新增 provider/model loop。

### Memory UX slimming

- `/memory` 默认输出 review queue、accepted count、disabled/rejected count、acceptedOnly topK 注入、估算 token 和下一步动作。
- `/memory review` 即使没有候选，也明确 action lifecycle：accept/reject/disable/rollback/delete。
- `/memory stats` 输出 prompt 注入范围、估算 token/chars、自动学习默认关闭、完整候选/聊天/日志/index dump 不注入 prompt。
- `/memory learn` 明确为 controlled / candidate-only：只生成候选，不自动接受。

### Agent displayName UX

- `AgentRun` 和 `DurableJobAgent` 增加可选 `displayName`。
- `/fork` 和 durable job agent 创建时派生展示名：
  - 英文任务取最多 3 个有效 token + agent type，例如 `inspect-cache-explorer`。
  - 非 ASCII 或无法派生时使用稳定 hash fallback，例如 `task-xxxxxx-explorer`。
  - 输出为 ASCII-safe，并做长度截断。
- `/agents`、`/agents show`、`/job list`、`/job status`、`/job report`、background summary 展示 displayName。
- displayName 明确只用于 presentation：不改变 type、role route、permission mode、resource guard、evidence、verification 或 lifecycle。

### Narrow terminal / report rhythm

- `/agents` 默认列表缩短 task preview，保留 `role=` 兼容旧测试与用户排查。
- Background 一行摘要限制 title/currentStep/nextAction 长度。
- Background details 使用：status/result、why stale/blocked、resume/cancel、summary、artifact path。
- Job primary/status/report 输出更偏 summary-first：目标、范围、agent 数量、verification 边界、handoff/resource guard 检查、artifact/log 路径。
- Completed/cancelled/timeout/stale/blocked 仍不等于 verification PASS。

## 修改文件清单

### Code

- `packages/config/src/index.ts`
  - 新增 language recorded 检测与持久化 helper。
- `packages/tui/src/index.ts`
  - 首次 TTY language picker。
  - `/language` 持久化。
  - Memory UX 输出瘦身。
  - Agent displayName 派生、展示与边界说明。
  - Job/report/status/background display label 与窄行输出。
- `packages/tui/src/job-runner-presenter.ts`
  - Background summary/details 截断与 human reason。

### Tests

- `packages/tui/src/index.test.ts`
  - 覆盖 first-run TTY language picker、非 TTY 不提示、`/language` 持久化、model prompt 语言跟随。
  - 覆盖 Memory UX candidate-only / accepted-only topK / no autoAccept / no per-turn learning。
  - 覆盖 agent displayName ASCII-safe、hash fallback、窄行、presentation-only 边界。
  - 覆盖 durable job displayName 持久化、job list/status/report 可见性。
  - 保留 Polish A/B/C 回归断言。
- `packages/tui/src/job-runner-presenter.test.ts`
  - 覆盖 background summary/details 截断、artifact boundary 与 no-secret 输出。

### Docs

- `docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md`
- `docs/delivery/pre-smoke-tui-polish-d-language-memory-agent-productization.md`

### Untracked unrelated file

当前工作树存在未跟踪文件：

- `docs/audit/performance-windows-stability-readonly-scout.md`

该文件不是本轮 Polish D 产物，本轮未将其纳入实现或结论。

## 验证结果

### Targeted agent displayName regression

```bash
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "keeps Polish D agent display names cosmetic"
```

结果：PASS

- Test Files: 1 passed
- Tests: 1 passed, 170 skipped

### Focused Polish D / regression tests

```bash
corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/job-runner-presenter.test.ts packages/tui/src/natural-command-bridge.test.ts packages/tui/src/terminal-readiness-presenter.test.ts -t "Polish D|language|i18n|memory|narrow|wrap|report|background|job|agent|displayName|help|trust|doctor|hint"
```

结果：PASS

- Test Files: 3 passed
- Tests: 76 passed, 237 skipped

### Typecheck

```bash
corepack pnpm typecheck
```

结果：PASS

### Check

```bash
corepack pnpm check
```

结果：PASS

- Checked 65 files. No fixes applied.

### Diff whitespace

```bash
git diff --check
```

结果：PASS

### Full test

```bash
corepack pnpm test
```

结果：PASS

- Test Files: 19 passed
- Tests: 453 passed

### Build

```bash
corepack pnpm build
```

结果：PASS

## 复核状态

按用户最新要求，已停止 independent verifier 复检；本轮不再等待或声明 independent verifier PASS。

本轮改为执行者本地单独复核，复核依据为本报告“验证结果”中的 targeted vitest、focused vitest、typecheck、check、diff whitespace、full test、build，以及最终文档/状态复查。

本报告结论为 Polish D 本地验证闭合，不包含 independent verifier PASS。

## 本地自审结论

- Language UX 使用现有配置文件，不新增语言 runtime。
- `/language` 现在持久化；model prompt language 跟随现有 `context.language`。
- 首次语言选择只在 TTY 出现；非 TTY 不阻塞。
- Memory 仍是 candidate-first、accepted-only、topK、有人工 review；没有自动接受或逐轮学习。
- Agent displayName 是展示层增强，不改变 agent/job 语义。
- Job/background/report 输出更短，但保留 artifact/log/report 路径。
- Polish A/B/C 默认降噪边界继续保留。
- 未新增依赖、未提交 commit、未进入后续 gate。

## Remaining risk

- First-run language picker 当前是 line-based TTY prompt，不是完整 TUI widget；这符合本轮最小实现边界。
- displayName 派生是展示启发式；非 ASCII 任务使用 hash fallback，避免把中文/路径原文拼进 label。
- Narrow terminal 改进覆盖关键输出行，未引入全局 terminal layout/theme 系统。
- 按用户最新要求，已停止独立 verifier 复检；本轮为执行者本地单独复核，不声明 independent verifier PASS。

## Blocking P0/P1

Polish D 范围内本地验证未发现剩余 blocking P0/P1。

注意：这不是整体 terminal-product-ready、Beta PASS、smoke-ready、open-source-ready 或开源发布结论。

## NOT-DO

- 未进入 Performance & Windows Stability Hardening Gate。
- 未进入 Phase 18。
- 未执行真实 smoke。
- 未宣布 Beta PASS / smoke-ready / open-source-ready。
- 未提交 commit。
- 未新增依赖。
- 未新增第二套 NCB / permission / Start Gate / Workspace Trust / memory / agent / job / doctor / details / evidence / provider / tool runtime。
- 未新增 resident agent registry / marketplace / team hierarchy。
- 未复制 CCB / OpenCode / Warp / 第三方源码。
- 未改变四权限模式语义。
- 未绕过 Start Gate、permission pipeline 或 Plan approval。

## Handoff Packet

- 当前阶段：Pre-Smoke TUI Polish D local verified；按用户最新要求已停止 independent verifier 复检。
- 当前结论：Language / Memory UX / Narrow Terminal / Agent Display Names 范围已由执行者本地单独复核闭合；不声明 independent verifier PASS。
- 下一步：停止，等待用户确认是否进入 Performance & Windows Stability Hardening Gate。
- 禁止事项：不要自动进入 Performance gate、Phase 18、真实 smoke、开源发布或提交 commit。
- 证据引用：本报告“验证结果”。
- 索引状态：`F-Linghun` ready；nodes=1913；edges=4015。
- 权限模式：本轮未提交 commit；未进入真实 smoke。
- 模型/provider：本轮由当前 Claude Code 会话执行；未调用产品 provider 做真实请求。
- 预算使用：未做真实 smoke；运行 targeted vitest、focused vitest、typecheck、check、diff whitespace、full test、build。
