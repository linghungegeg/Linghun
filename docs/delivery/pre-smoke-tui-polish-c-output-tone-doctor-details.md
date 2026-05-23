---
title: Pre-Smoke TUI Polish C - Output Tone, Doctor, Details, Light Hints
status: FINAL_CLOSE_PENDING_VERIFIER
updated: 2026-05-24
---

# Pre-Smoke TUI Polish C - Output Tone, Doctor, Details, Light Hints

## 本轮定位

本轮是 **Pre-Smoke TUI Polish C**，只收尾用户层输出噪声与可发现性：

1. Help / Slash Discovery 默认视图瘦身。
2. Light Hints 优先级、冷却与单轮限流。
3. Error / Details Blocks summary-first 输出。
4. Doctor / Problems 默认层级与完整层级分离。
5. Polish A/B 留下的用户层噪声收口，尤其 `/trust` 不出现在默认 help/discovery，但仍保留高级 fallback/status/recover。

本轮未进入 Polish D、Performance & Windows Stability Hardening Gate、Phase 18 或真实 smoke；未宣布 Beta PASS、smoke-ready、open-source-ready；未提交 commit。

## Source-Level Reality Check

本轮开工前按要求运行：

```bash
git status --short
```

开工时输出为空。

本轮确认 codebase-memory 项目：

```json
{"project":"F-Linghun","nodes":1894,"edges":3969,"status":"ready"}
```

索引定位在部分模式搜索上无结果时，按规则回退到本地精读源码与测试确认。

### Existing implementation

- Help / slash discovery 已有统一入口：`packages/tui/src/index.ts` 的 `handleSlashCommand()`、`formatCatalogHelp()`、`formatSlashDiscovery()`、`formatHelp()`；命令事实来自 `packages/tui/src/natural-command-bridge.ts` 的 capability catalog。
- Light Hints 已有实现：`collectLightHints()`、`createLightHint()`、`writeLightHints()`、`writeLightHintsForTest()`，并已有 `hintLastShownAt` 冷却存储。
- Doctor / Problems 已有 presenter：`packages/tui/src/terminal-readiness-presenter.ts` 的 `formatTerminalReadinessDoctor()`、`formatTerminalReadinessStatus()`、`formatTerminalProblemsPanel()`、`createReadinessItems()`。
- Details / output presenter 已有分层：`packages/tui/src/tool-output-presenter.ts` 的 `createLayeredToolOutput()` / `formatToolOutput()`，以及 `/details output <id>` 的 log artifact slice 路径。
- Error primary formatting 已有 `formatError()`，但旧口径偏“错误：原始消息”，不够 summary-first / action-first。

### Gaps

- 默认 `/help` 和 `/`/`/?` discovery 对普通用户仍偏命令百科；高级/恢复入口如 `/trust`、`/permissions` 容易过早前置。
- Light Hints 虽有 cooldown，但缺少显式 priority 与单轮限流，多个 hint 可同时打扰主屏。
- Tool truncation/details hint 没有明确指向 `/details output <id>`。
- `/doctor` 默认输出完整 checklist，信息量过大；缺少短摘要与 `/doctor all` 完整层的清晰分工。
- Generic error 仍需要更清晰的“发生了什么 / 影响范围 / 下一步 / 详情”结构，并继续清理 gate/request/token/header 等内部字段。

### Minimal touch points

- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/terminal-readiness-presenter.ts`
- `packages/tui/src/tool-output-presenter.ts`
- 本交付文档

### Forbidden duplicate systems

本轮没有新增第二套 command catalog、NCB、permission pipeline、Start Gate、Workspace Trust、doctor runtime、details/evidence store、job/agent runtime、provider/model loop 或 notification queue。

## 参考核对

### Linghun 文档

本轮读取并遵守：

- `START_NEXT_CHAT.md`
- `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- `docs/audit/pre-smoke-mature-tui-ux-source-level-audit.md`
- `docs/delivery/pre-smoke-tui-polish-a-natural-intent-command-surface.md`
- `docs/delivery/pre-smoke-tui-polish-b-interactive-controls-permission-workspace-trust.md`
- `docs/audit/reference-map.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`（按相关章节定向读取）
- `LINGHUN_IMPLEMENTATION_SPEC.md`（按相关章节定向读取）

### 参考源

只读参考了本地 CCB 行为与边界，未复制源码：

- `F:/ccb-source/src/components/HelpV2/HelpV2.tsx`
- `F:/ccb-source/src/components/HelpV2/General.tsx`
- `F:/ccb-source/src/components/HelpV2/Commands.tsx`
- `F:/ccb-source/src/components/BaseTextInput.tsx`
- `F:/ccb-source/src/components/PromptInput/PromptInputFooterSuggestions.tsx`
- `F:/ccb-source/src/context/notifications.tsx`
- `F:/ccb-source/src/components/PromptInput/Notifications.tsx`
- `F:/ccb-source/src/screens/Doctor.tsx`
- `F:/ccb-source/src/utils/status.tsx`
- `F:/ccb-source/src/components/permissions/PermissionDialog.tsx`
- `F:/ccb-source/src/components/permissions/PermissionPrompt.tsx`
- `F:/ccb-source/src/components/permissions/PermissionRequest.tsx`
- `F:/ccb-source/src/components/permissions/PermissionExplanation.tsx`
- `F:/ccb-source/src/commands.ts`
- `F:/ccb-source/src/commands/help/index.ts`
- `F:/ccb-source/src/commands/help/help.tsx`
- `F:/ccb-source/src/commands/status/index.ts`
- `F:/ccb-source/src/commands/status/status.tsx`
- `F:/ccb-source/src/commands/doctor/index.ts`

OpenCode / Warp 本地源码未找到；本轮不虚构 source-level 事实，不做源码对照结论。

## Reference-source delta catch-up 裁决

- **DONE**：默认 help/discovery 改为 beginner-first / core entries；完整命令表放到 `/help all|advanced|details`。
- **DONE**：提示/通知只借鉴 key + priority + timeout/dedupe 的轻量行为，不做持久通知系统。
- **DONE**：`/doctor` 默认摘要化，`/doctor all` 展开完整 checklist。
- **DONE**：长输出/截断输出明确提示 `/details output <id>`。
- **DONE**：普通 primary 输出继续压低 raw evidence、tool_result、gate/request/token 等内部字段。
- **DEFERRED**：OpenCode / Warp source-level 对照，因本地源码不可用。
- **DEFERRED**：Rich command palette、搜索过滤、多层 UI 面板、AI 生成解释。
- **NOT-DO**：不复制 CCB / OpenCode / Warp / 第三方源码。
- **NOT-DO**：不引入第二套 notification queue、doctor runtime、permission pipeline 或 command registry。
- **NOT-DO**：不把隐藏/恢复/调试入口从系统中删除；仅从默认用户层降噪。

## 实现内容

### Help / Slash Discovery slimming

- 默认 `/help` 改为短视图：先鼓励直接描述目标，再列出 6 个核心入口。
- `/help all`、`/help advanced`、`/help details` 保留完整命令表。
- 默认 `/` 和 `/?` 改为短 discovery，不再展示完整分组命令百科。
- slash prefix discovery 只返回默认核心入口候选，避免刚输入 `/` 就暴露恢复/调试/高级入口。
- `/trust`、`/permissions` 不出现在默认 help/discovery，但 dispatch、完整 help 和高级 fallback 仍保留。

### Light Hints noise reduction

- `LightHint` 增加 `priority`。
- 每轮最多展示 1 条 hint。
- 继续复用已有 `hintLastShownAt` 和 cooldown，不新增持久通知队列。
- Hint 文案从内部诊断口径改为“发生了什么 + 下一步命令”。

### Error / Details Blocks

- Tool output summary-first preview 继续隐藏 Read/Glob/Grep/Bash/Write/Edit/MultiEdit 的 raw primary 输出。
- 截断或存在 details 时，明确提示：`/details output <id>`。
- Generic error 改为：发生了什么、影响范围、下一步、详情入口。
- User-facing error 增加对 `gateId`、`requestId`、`token`、`Authorization` 等字段的 redaction。

### Doctor / Problems hierarchy

- `/doctor`、`/doctor readiness`、`/doctor status` 默认输出短摘要：OK/WARN/BLOCK、通过数量、需要处理项和 `/doctor all` 提示。
- `/doctor all`、`/doctor details`、`/doctor checklist`、`/doctor project`、`/doctor report` 输出完整 checklist 和 lite sections。
- Problems Lite 保持最多 8 条、本地 runtime evidence 派生、primary redaction。
- 不改变 `TerminalReadinessView` 数据来源，不新增 doctor 数据源。

## 修改文件清单

### Code

- `packages/tui/src/index.ts`
  - 默认 help/discovery 降噪。
  - Light Hint priority + 单轮限流。
  - `/doctor` 默认摘要、`/doctor all` 完整层级。
  - Generic error summary-first + redaction。
- `packages/tui/src/terminal-readiness-presenter.ts`
  - `formatTerminalReadinessDoctor(view, { showAll })`。
  - 新增默认 doctor summary formatter。
- `packages/tui/src/tool-output-presenter.ts`
  - Details hint 指向 `/details output <id>`。

### Tests

- `packages/tui/src/index.test.ts`
  - 更新 help/discovery 默认短视图断言。
  - 覆盖 `/trust` / `/permissions` 不在默认 help/discovery。
  - 覆盖 `/doctor` 默认摘要、`/doctor all` 完整细节。
  - 覆盖 tool output details hint 与 error tone。
  - 覆盖 light hints 新文案与限流行为。

### Docs

- `docs/delivery/pre-smoke-tui-polish-c-output-tone-doctor-details.md`

### Generated

- 本轮未手写 `dist`。`corepack pnpm build` 后工作树未出现 dist 变更。

## 验证结果

### Focused Polish C tests

```bash
corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts -t "Polish C|help|slash|discovery|hint|doctor|details|error|output|trust|permission|problems"
```

结果：PASS

- Test Files: 2 passed
- Tests: 191 passed, 115 skipped

备注：首次 focused 运行发现 3 个断言仍按旧输出口径检查；已更新为 Polish C 短 help、短 doctor 和核心 discovery 口径后重跑通过。

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

备注：首次运行发现格式化差异，已按项目 formatter 期望最小修正后重跑通过。

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
- Tests: 451 passed

### Build

```bash
corepack pnpm build
```

结果：PASS

## 复检状态

按用户最新要求，已停止独立 verifier 复检；本轮改为执行者本地单独复检。

本报告不声明 independent verifier PASS。

## 本地自审结论

本地自审确认：

- Polish C 只改用户层输出层级、提示噪声和 details 可发现性。
- `/help` 默认是短视图，完整命令仍通过 `/help all|advanced|details` 可用。
- `/trust` 保留高级 fallback/status/recover，但不出现在默认 help/discovery。
- `/doctor` 默认不再刷完整 checklist；完整细节通过 `/doctor all` 等入口打开。
- Light Hints 未新增第二套通知系统；只复用现有缓存字段做 priority/cooldown/limit。
- Tool output 和 generic error 均保持 summary-first，不把 raw tool result、raw evidence、完整日志、内部 gate/request/token 字段放回 primary。
- 未改变四权限模式语义、Start Gate、permission pipeline、Workspace Trust guard、NCB、provider/model loop、MCP/index/memory/job runtime。

## Blocking P0/P1

Polish C 范围内未发现剩余 blocking P0/P1。

注意：这不是整体 terminal-product-ready、Beta PASS、smoke-ready 或 open-source-ready 结论。

## NOT-DO

- 未进入真实 smoke。
- 未宣布 Beta PASS / smoke-ready / open-source-ready。
- 未进入 Polish D、Performance & Windows Stability Hardening Gate、Phase 18、开源发布或桌面阶段。
- 未新增第二套 NCB / permission / Start Gate / doctor / details / evidence / job / provider / tool runtime。
- 未复制 CCB / OpenCode / Warp / 第三方源码。
- 未新增依赖。
- 未改变四权限模式语义。
- 未绕过 Start Gate / permission pipeline / Plan approval。
- 未提交 commit。

## 已知边界

- `/help all` 仍是完整命令表，适合高级/恢复/调试场景；默认 `/help` 才是短视图。
- `/details output <id>` 文案使用占位 `<id>`；实际 id 来自 recent details/evidence/background 列表。
- `/doctor` 默认摘要仍基于本地 runtime evidence，不执行真实 smoke，也不验证外部事实新鲜度。
- OpenCode / Warp source-level 对照因本地源码不可用而 deferred。

## Handoff Packet

- 当前阶段：Pre-Smoke TUI Polish C final close；按用户要求已停止独立 verifier 复检。
- 当前结论：Light Hints / Error / Doctor / Details Blocks / Output Tone 范围已本地复检闭合。
- 下一步：停止，等待用户确认是否进入后续 gate。
- 禁止事项：不要自动进入 Polish D、Performance & Windows Stability Hardening Gate、Phase 18 或真实 smoke；不要宣布 Beta PASS / smoke-ready / open-source-ready；不要提交 commit。
- 证据引用：本报告“验证结果”。
- 索引状态：`F-Linghun` ready；nodes=1894；edges=3969。
- 权限模式：本轮未提交 commit；未进入真实 smoke。
- 模型/provider：本轮由当前 Claude Code 会话执行；未调用产品 provider 做真实请求。
- 预算使用：未做真实 smoke；运行 focused vitest、typecheck、check、full test、build、diff whitespace。
