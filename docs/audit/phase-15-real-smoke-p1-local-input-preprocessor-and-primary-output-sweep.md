# Phase 15 real-smoke 前 P1：local input preprocessor + primary output leak sweep

## Verdict

`P1_REMEDIATION_IMPLEMENTED_AND_LOCALLY_VERIFIED`

本轮只修复 Phase 15 real-project smoke 前暴露的入口/control-plane 路由与主屏输出泄露问题；未进入真实项目 smoke，未宣布 Beta PASS / smoke-ready，未进入 Phase 15.5 / Phase 16+，未提交 commit。

## 读取的 Linghun source-of-truth 文档

- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_CCB_MATURITY_COMPARISON_REPORT.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-15-natural-command-bridge.md`
- `F:\Linghun\docs\audit\phase-15-real-beta-ccb-style-input-preprocessor-fix.md`
- `F:\Linghun\docs\audit\phase-15-pre-beta-output-provider-windows-clarity-fix.md`
- `F:\Linghun\docs\audit\phase-15-pre-beta-whole-system-interaction-boundary-reconciliation.md`
- `F:\Linghun\docs\audit\PHASE_15_PREFLIGHT_INTERACTION_REVIEW_REPORT.md`
- `F:\Linghun\docs\audit\phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md`
- `F:\Linghun\docs\audit\phase-15-pre-smoke-a-c-combined-acceptance.md`
- `F:\Linghun\docs\audit\reference-map.md`

## 只读 CCB 对照文件

本轮只参考公开行为边界与交互取舍，没有复制 CCB 源码、内部 API、专有实现或遥测逻辑。

- `F:\ccb-source\src\utils\processUserInput\processUserInput.ts`
- `F:\ccb-source\src\utils\processUserInput\processTextPrompt.ts`
- `F:\ccb-source\src\utils\processUserInput\processSlashCommand.tsx`
- `F:\ccb-source\src\components\PromptInput\inputModes.ts`
- `F:\ccb-source\src\screens\REPL.tsx`
- `F:\ccb-source\src\components\Messages.tsx`
- `F:\ccb-source\src\components\permissions\PermissionPrompt.tsx`
- `F:\ccb-source\src\components\StatusLine.tsx`

参考到的行为边界：CCB 在进入模型查询前先处理 pending / bash-prefix / slash command 等本地结构化输入，普通 text prompt 默认进入模型；主屏输出保持可读摘要，细节留在 transcript / details / evidence 路径。

## Root cause

上一次移除普通输入的默认 NCB 全量 catalog 路由是正确且有意的：它避免了 catalog 抢走正常开发任务，例如 project / deploy / report / index 相关的真实需求。

本轮 real-smoke gap 是另一侧边界：明确的 control-plane 自然语言命令没有在进入 provider/model 前被本地预处理，导致诸如“模型配置正常吗”“索引状态怎么样”“切到自动模式”等高置信控制面输入仍可能进入 provider 路径。

正确修复不是恢复“普通输入全量 catalog scoring”，而是在 `handleNaturalInput()` 进入 `sendMessage()` 前增加 CCB-style 的窄 local input preprocessor：

- pending / slash / control-plane 本地处理；
- 普通开发、分析、报告、部署、修 bug、实现功能请求继续进入 provider/model/tool loop。

## 为什么不是 phrase patch

实现没有为每个样例写“句子级 if”。本轮复用 `routeNaturalIntent()` 与 Command Capability Catalog，新增的是：

- control-plane capability allowlist；
- high-confidence gate；
- allowed readonly slash command allowlist；
- mode Start Gate allowlist；
- ordinary development request guard。

这保留了 catalog/intent 的能力级路由，同时避免把普通项目任务误判为本地命令。

## 为什么不回滚 broad ordinary-input NCB

Phase 15 真实 smoke 已证明 broad ordinary-input catalog scoring 会把“分析项目 / 部署 / 生成报告 / 有索引优先用索引”等普通开发任务误路由到本地 `/index` 等控制面输出。回滚会重新引入该 P1 问题。

本轮实现只在 `handleNaturalInput()` 尾部、既有 pending approval / pending natural command / index safety continuation / composite status / direct file read 之后，尝试窄 control-plane 预处理；不命中则返回 `"message"` 继续原模型主链路。

## 修改文件

- `packages/tui/src/index.ts`
  - 引入 `routeNaturalIntent()` 与现有 NCB Start Gate / answer formatter。
  - 增加窄 `handleLocalControlPlaneInput()`。
  - 仅允许高置信 control-plane intents 本地处理：help/features/status/mode/model/index/cache/permissions/hooks 的有限路径。
  - mode 切换只允许 `default` / `auto-review` / `plan` 进入既有 Start Gate；不允许自然语言开启 `full-access`。
  - provider failure 主屏改为简短行动提示，不再输出 evidence id / raw provider error。
  - model empty response 主屏移除 `Evidence:` / `证据记录：`，仍写入 evidence/system event。
- `packages/tui/src/natural-command-bridge.ts`
  - 调整 cache capability scoring，使“缓存状态怎么样”能稳定命中 cache control-plane。
- `packages/tui/src/index.test.ts`
  - 新增/更新 main-chain integration tests：control-plane 不调用 provider，普通 report/deploy/bug/feature 请求调用 provider，provider failure/empty response 主屏不泄露 evidence/debug/raw 字段且 transcript 保留 evidence。
- `docs/audit/phase-15-real-smoke-p1-local-input-preprocessor-and-primary-output-sweep.md`
  - 本报告。

## 行为结果

### 本地处理且不调用 provider

已由 `packages/tui/src/index.test.ts` 覆盖：

- `帮我切到自动模式` -> 本地 Start Gate，等价 `/mode auto-review`。
- `切到自动审查` -> 本地 Start Gate，等价 `/mode auto-review`。
- `switch to auto mode` -> 本地 Start Gate，等价 `/mode auto-review`。
- `当前权限模式是什么` -> 本地 `/mode`。
- `模型配置正常吗` -> 本地 `/model route doctor`。
- `索引状态怎么样` -> 本地 `/index status`。
- `缓存状态怎么样` -> 本地 `/cache status`。

断言：mock provider request 数为 `0`，输出不包含“状态：正在请求模型”。

### 继续进入 provider/model/tool loop

已由 `packages/tui/src/index.test.ts` 覆盖：

- `帮我分析一下这是什么项目，技术栈是什么，怎么部署，输出报告在根目录`
- `有索引，优先使用索引，帮我分析项目并生成报告`
- `修复这个 bug`
- `帮我实现导出报表功能`

断言：这些普通任务进入 mock provider 路径，未被 `/index` 或 mode Start Gate 抢路由。

### 主屏输出泄露收敛

Provider failure primary 现在只输出人类可读摘要和下一步：

```text
请求模型失败。运行 /model doctor 检查 provider/baseUrl/model/endpointProfile，然后重试。
```

Empty response primary 现在只输出：

```text
模型返回空响应。运行 /model doctor 检查 provider/baseUrl/model/endpointProfile，或切换 provider/model 后重试。
```

测试断言 primary 不包含：

- `Evidence:`
- `证据记录：`
- `tool_result`
- `EvidenceSummary`
- UUID pattern
- raw provider error detail such as `quota exceeded`

同时 transcript 仍保留 `evidence_record` 与 `system_event`。

## 2026-05-21 追加：primary vocabulary leak sweep

### Targeted grep sweep 结论

本轮按 primary/details/debug 分层只收口用户主屏路径，没有修改模型上下文协议、transcript/evidence/system_event 事件类型或 provider tool protocol。

保留的 model-visible/internal 命中：

- `buildModelMessagesWithRecentContext(...)` / `createModelSystemPrompt(...)` 中的 `tool_result` 与 `EvidenceSummary`：给模型恢复工具上下文和证据摘要使用，未进入普通主屏。
- `appendToolResultEvent(...)` 与 transcript `type: "tool_result"`：结构化 transcript/model continuation 必需，未改事件类型。
- `appendSystemEvent(...)` 中的 `evidence=<id>`：用于 debug/evidence/system_event 追踪，未进入 primary。
- handoff/agent context 中的 `evidence=...`：属于 trimmed internal package / handoff 语义，不是普通用户主屏输出路径。
- focused tests 中对 `tool_result`、`Evidence:`、`EvidenceSummary` 的 negative assertions 或 transcript assertions：用于防回归，保留。

已修的 primary leak：

- `/features`：移除主屏文案中的 `EvidenceSummary`，改为说明 evidence 与长输出保留在 details，可用 `/details` 查看。
- `/model doctor` / `/model route doctor`：`last provider failure` 不再显示 `evidence=<uuid>`；primary 保留 `code/provider/model/endpointProfile` 和 `details: /details evidence`。
- permission denial/cancel：主屏不再显示 `tool_result`；改为人话提示“已拒绝。本轮未写入文件，模型会收到拒绝结果并继续调整。”/“Denied. No file was written; the assistant will receive the denial and adjust.”。model-visible denial result 与 transcript `tool_result` 保留。
- `/claim-check` Beta verdict：primary 不再显示 `Evidence: <id>` / `Evidence：<id>`，改为“证据已记录；详情用 /details evidence。”；具体 evidence id 仍保留在 evidence/transcript/debug 路径。
- 普通 report-generation path：继续保持主屏不含 `Evidence:` / `证据记录：` / `tool_result`。

### 本轮验证结果

已运行：

```text
corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts
```

结果：PASS，2 files passed，249 tests passed。

```text
corepack pnpm typecheck
```

结果：PASS。

```text
corepack pnpm check
```

结果：PASS，Biome checked 49 files，no fixes applied。

```text
corepack pnpm build
```

结果：PASS，workspace build completed。

```text
git diff --check
```

结果：PASS；仅输出 Windows 工作区 LF→CRLF 提示，无 whitespace error。

### 本轮明确未做

- 未进入真实项目 smoke。
- 未宣布 Beta PASS。
- 未宣布 smoke-ready。
- 未进入 Phase 15.5 / Phase 16+。
- 未提交 commit。
- 未修改模型上下文协议、provider tool protocol、transcript/evidence/system_event 事件类型或权限语义。
- 未做全局 TUI rewrite。

## 验证结果

已运行：

```text
corepack pnpm exec vitest run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts packages/providers/src/index.test.ts packages/config/src/index.test.ts
```

结果：PASS，4 files passed，306 tests passed。

```text
corepack pnpm typecheck
```

结果：PASS。

```text
corepack pnpm check
```

结果：PASS，Biome checked 49 files。

```text
corepack pnpm build
```

结果：PASS，workspace build completed。

```text
git diff --check
```

结果：PASS。

## 明确边界

- 本轮没有进入真实项目 smoke。
- 本轮没有宣布 Beta PASS。
- 本轮没有宣布 smoke-ready。
- 本轮没有进入 Phase 15.5 / Phase 16+。
- 本轮没有 commit。
- 本轮没有复制 CCB / OpenCode / Hermes / 任何第三方源码实现。
- 本轮没有做全局 TUI rewrite。
- 本轮没有恢复普通输入 broad catalog scoring。

## 剩余状态

该 P1 remediation 已完成本地实现与本地验证。下一步仍应由用户明确决定是否进入 Phase 15 real-project smoke；不能从本报告推出 Beta PASS / smoke-ready。
