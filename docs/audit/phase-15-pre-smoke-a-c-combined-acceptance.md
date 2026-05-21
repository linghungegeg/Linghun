# Phase 15 pre-smoke A-C 综合验收门

日期：2026-05-21

## 1. 范围与结论

本轮只执行 Phase 15 pre-smoke A-C 综合验收门：读取指定 source-of-truth 与 Batch A/B/C 报告，复核必要源码事实，运行指定验证命令，并输出本综合验收报告。

本轮未进入真实项目 smoke，未宣布 Phase 15 Beta PASS，未宣布 smoke-ready PASS，未进入 Phase 15.5 / Phase 16+，未提交 commit，未新增功能，未新增 agent / ADR DB / 长期 memory / DB，未改变四权限模式，未复制 CCB 或第三方源码。

综合验收 verdict：`READY_FOR_USER_DECISION_TO_START_REAL_PROJECT_SMOKE`。

该 verdict 只表示 Batch A/B/C 已满足进入“是否开始真实项目 smoke”的用户决策点；这不是 Beta PASS，也不是 smoke-ready PASS。真实项目 smoke 必须在用户明确确认后才能开始。

## 2. 读取的 source-of-truth 与 Batch 报告

本轮读取并以以下文件作为验收输入：

- `docs/audit/phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md`
  - 当前唯一 pre-smoke 执行基线。
  - 结论为 `READY_TO_IMPLEMENT`，不是 smoke-ready / Beta-ready。
  - 要求先完成 Batch A/B/C 并重新评估，真实项目 smoke 不得提前开始。
- `docs/audit/phase-15-pre-smoke-batch-a-four-permission-modes.md`
  - Batch A 四权限模式闭环报告。
- `docs/audit/phase-15-pre-smoke-batch-b-architecture-runtime-source-of-truth.md`
  - Batch B Architecture Runtime source-of-truth / implementation design 报告。
- `docs/audit/phase-15-pre-smoke-batch-c-architecture-runtime-minimal-implementation.md`
  - Batch C Architecture Runtime v1 最小 runtime 实现报告。
- `README.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/README.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/audit/reference-map.md`

## 3. Batch A：四权限模式闭环核对结果

核对源码：

- `packages/shared/src/index.ts`
- `packages/config/src/index.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/natural-command-bridge.ts`
- focused tests：
  - `packages/config/src/index.test.ts`
  - `packages/tui/src/natural-command-bridge.test.ts`
  - `packages/tui/src/index.test.ts`

核对结果：PASS。

### 3.1 canonical 权限模式

`packages/shared/src/index.ts` 中 `PermissionMode` 只保留四个 canonical mode：

- `default`
- `auto-review`
- `plan`
- `full-access`

legacy alias 仅作为输入兼容存在：

- `acceptEdits` -> `auto-review`
- `auto` -> `auto-review`
- `bypass` -> `full-access`
- `dontAsk` -> `default`

`isRawPermissionMode()` 只接受上述 canonical / legacy 输入集合；`normalizePermissionMode()` 写回 canonical。

### 3.2 config normalize / canonical writeback / invalid fail-closed

`packages/config/src/index.ts` 中读取旧 settings mode 时会通过 `normalizePermissionConfig()` 和 `normalizePermissionMode()` 归一化 legacy alias。

`writeConfig()` 写回前经过 `validateConfig()`，最终落盘为 canonical permission mode。

invalid mode 不被 normalize 为更高权限；读取恢复路径会回退默认配置，测试覆盖“invalid permission modes without escalating”。

### 3.3 TUI mode / tab / help / status / decidePermission

`packages/tui/src/index.ts` 中：

- `/mode` 展示 canonical 可选项：`default / auto-review / plan / full-access`。
- `/mode` 输入 legacy alias 时先 parse raw mode，再 normalize 成 canonical。
- `/tab` 只循环 `default -> auto-review -> plan -> default`，不把 `full-access` 放入快捷循环。
- `full-access` 需要本地显式 opt-in：`LINGHUN_ENABLE_FULL_ACCESS=1`。
- `full-access` 仍受 hard deny 和安全路径保护。
- `auto-review` 只自动允许工作区内低风险文件编辑和只读/会话内工具；不自动允许 Bash、高风险、越界路径、依赖、权限、plugin、hook、remote 等操作。
- `plan` 模式只允许只读或会话内规划工具；写入、Edit/MultiEdit、Bash 等会被拒绝。

### 3.4 Natural Command Bridge canonical 映射与高风险边界

`packages/tui/src/natural-command-bridge.ts` 中英文 mode alias 会映射到 canonical slash command：

- 中文“自动审查/自动模式/自动审批/接受编辑”与英文 `auto-review` / `auto` / `acceptEdits` -> `/mode auto-review`
- 中文“完全访问”与英文 `full-access` / `bypass` -> `/mode full-access`
- 中文“默认/不询问”与英文 `default` / `dontAsk` -> `/mode default`
- `plan` / “计划” -> `/mode plan`

`full-access` / `bypass` / 依赖安装 / hook / remote / job 等高风险表达不会自然语言直通执行，而是进入 permission pipeline。

## 4. Batch B：Architecture Runtime source-of-truth 核对结果

核对文件：

- `docs/audit/phase-15-pre-smoke-batch-b-architecture-runtime-source-of-truth.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `README.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/README.md`
- `docs/audit/reference-map.md`

核对结果：PASS。

### 4.1 Batch B 报告边界

Batch B 报告只声明完成 source-of-truth / implementation design：

- 未实现 runtime code。
- 未进入真实项目 smoke。
- 未宣布 Beta PASS / smoke-ready。
- 未进入 Phase 15.5 / Phase 16+。
- 未提交 commit。

### 4.2 Architecture Runtime v1 定义

Batch B 将 Architecture Runtime v1 定义为普通模型请求链路前的轻量工程判断 guard，用于系统性工程任务生成短 Architecture Card，并在后续动作 drift 时要求确认。

它明确不是：

- 第五权限模式。
- Plan Mode。
- skill。
- agent。
- ADR DB。
- 完整 spec 平台。
- prompt-only 文案。

### 4.3 v1 函数与字段边界

Batch B / 实现规格明确 v1 最小函数边界为：

- `shouldTriggerArchitectureRuntime(input, context)`
- `collectArchitectureFacts(context)`
- `formatArchitectureCard(card)`
- `detectArchitectureDrift(card, nextAction)`

Architecture Card 字段固定为：

- `target`
- `projectFacts`
- `recommendedApproach`
- `rejectedApproaches`
- `stagedBreakdown`
- `risks`
- `verification`
- `nonGoals`

### 4.4 后续能力未前置进入 v1

Batch B 明确将以下内容留在后续阶段，不在 Batch C / v1 中实现或命名为 v2/v3：

- OpenSpec-lite。
- Verification / Freshness 深协同。
- 学习沉淀。
- durable jobs。
- Phase 15.5 / Phase 16 / Phase 17 的后续能力。

### 4.5 active docs 状态

`README.md`、`START_NEXT_CHAT.md`、`docs/delivery/README.md` 已指向 Phase 15 pre-smoke baseline 和 Batch B source-of-truth 报告；同时其中仍保留“下一步是 Batch C / 完成 Batch C 前不得进入真实项目 smoke”的旧文字。

本轮判断：这属于 Batch C 完成后、A-C 综合验收报告生成前的 active-doc stale wording，不构成 runtime/source acceptance blocker；本报告作为 A-C 综合验收输出记录当前最新 verdict。若用户确认进入真实项目 smoke，可在 smoke 前或 smoke handoff 中做最小文档状态更新，但本轮未扩大范围修改 active docs。

## 5. Batch C：Architecture Runtime v1 runtime 实现核对结果

核对源码与测试：

- `packages/tui/src/architecture-runtime.ts`
- `packages/tui/src/architecture-runtime.test.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`

核对结果：PASS。

### 5.1 v1 函数实现范围

`packages/tui/src/architecture-runtime.ts` 已实现并只实现 Architecture Runtime v1 的最小 runtime 能力：

- `shouldTriggerArchitectureRuntime(input, context)`
- `collectArchitectureFacts(context)`
- `formatArchitectureCard(card)`
- `detectArchitectureDrift(card, nextAction)`

同时提供必要 glue：

- `createArchitectureCard()`
- `createArchitectureRuntimeDirective()`
- `summarizeArchitectureCard()`

未发现新增第五权限模式、agent、ADR DB、长期 memory / DB 或完整 spec 平台。

### 5.2 trigger 规则

focused tests 覆盖并通过：

- 小任务不触发：typo、单文件小 bug、只读状态查询、简单解释、只改一处。
- 架构/系统性任务触发：跨模块、多文件、公共 API、依赖/配置、部署、性能、安全。
- 常见新功能请求触发：例如“实现登录功能”“加一个导出报表功能”“add export report feature”。
- 用户要求 mature / complete / reference-aligned / no omissions 或中文“成熟、完整、对齐参考源、不要遗漏”时触发。
- control-plane / slash command 请求不触发。

### 5.3 projectFacts / Freshness 边界

`collectArchitectureFacts(context)` 只使用 runtime context 中已有 evidence、index、permission mode 等可见事实。

无证据时写入：

- `unknown: no verified README/package/source/index/evidence facts are available in this request`

涉及 `latest/current/provider/API/价格/安全公告/第三方方案` 等当前外部事实时，会写 `stale` 或要求 Freshness/Web Evidence；不会把模型记忆当当前事实。

### 5.4 drift check 覆盖

`detectArchitectureDrift(card, nextAction)` 覆盖并由 focused tests 验证：

- 新增或修改依赖 / 配置。
- 扩散到 Architecture Card 未提及的架构范围模块 / 文件。
- 跳过 verification。
- 违反 nonGoals。
- 改变 `recommendedApproach`。
- 把 `unknown` / `stale` 外部事实当确定事实。
- 对 card 已覆盖的本地小修不误报 drift。

### 5.5 TUI 普通模型请求链路接入

`packages/tui/src/index.ts` 中 Architecture Runtime 接入位置符合 Batch C 边界：

1. 普通 `sendMessage()` 链路先构造 `RuntimeStatusForModel`。
2. 在 `createModelSystemPrompt()` / `buildModelMessagesWithRecentContext()` 前判断是否触发 Architecture Runtime。
3. 触发时创建短 Architecture Card，并通过当前 request 的 system prompt directive 注入。
4. 复用 transcript `system_event`、`evidence_record` 和 handoff latest 摘要。
5. 不新增额外模型调用。
6. 不接管 Natural Command Bridge / control-plane。
7. 不改变权限模式。
8. 不绕过 Start Gate、permission pipeline 或 Plan approval。
9. 不替代 verifier / Freshness/Web Evidence。
10. 不写长期 memory / DB。
11. 不污染 cache prefix / stable context；Architecture Runtime directive 只随当前 request 注入。
12. 非触发小任务会清空旧 `currentArchitectureCard`，避免旧 card 跨 turn 污染后续小任务 tool_use drift check。

`executeModelToolUse()` 中 drift check 位于 permission pipeline 前；drift 只 warning + 等待用户确认，确认后仍进入 `decidePermission()`、permission request/result、`runTool()`、`tool_result` 和 continuation 原链路。

## 6. 验证命令与结果

本轮运行了用户指定验证命令，结果如下。

### 6.1 focused vitest

命令：

```bash
corepack pnpm exec vitest run packages/config/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts packages/tui/src/architecture-runtime.test.ts packages/tui/src/index.test.ts
```

结果：PASS。

输出摘要：

```text
Test Files 4 passed (4)
Tests 282 passed (282)
Duration 19.99s
```

### 6.2 typecheck

命令：

```bash
corepack pnpm typecheck
```

结果：PASS。

输出摘要：

```text
> tsc -b tsconfig.json
```

无错误输出。

### 6.3 Biome check

命令：

```bash
corepack pnpm check
```

结果：PASS。

输出摘要：

```text
Checked 49 files in 187ms. No fixes applied.
```

### 6.4 full test

命令：

```bash
corepack pnpm test
```

结果：PASS。

输出摘要：

```text
Test Files 12 passed (12)
Tests 341 passed (341)
Duration 20.47s
```

### 6.5 build

命令：

```bash
corepack pnpm build
```

结果：PASS。

输出摘要：workspace build 完成，构建包包括：

- `packages/shared`
- `packages/tools`
- `packages/config`
- `packages/core`
- `packages/providers`
- `packages/tui`
- `apps/cli`

无 build failure 输出。

### 6.6 diff whitespace check

命令：

```bash
git diff --check
```

结果：PASS。

输出摘要：无输出，即未发现 diff whitespace error。

## 7. Blocker 与最小回打范围

Blocker：无。

最小回打范围：无必需回打。

非阻塞观察：active docs 中仍有“下一步 Batch C”的旧文字；该文字不影响本轮 A-C 综合验收 verdict。若用户确认进入真实项目 smoke，建议在 smoke 前或 smoke handoff 中做最小状态更新，避免后续接手者误读，但本轮未扩大验收任务范围修改这些 active docs。

## 8. 综合验收 verdict

`READY_FOR_USER_DECISION_TO_START_REAL_PROJECT_SMOKE`

含义：

- Batch A 四权限模式 canonical closure：PASS。
- Batch B Architecture Runtime source-of-truth / implementation design：PASS。
- Batch C Architecture Runtime v1 最小 runtime 实现与接入：PASS。
- 用户指定 focused tests、typecheck、check、full test、build、diff whitespace check：PASS。
- 当前无必须阻塞真实项目 smoke 决策的 A-C blocker。

## 9. 禁止推断与下一步边界

本报告不得被解读为：

- Phase 15 Beta PASS。
- smoke-ready PASS。
- 已进入真实项目 smoke。
- 已完成真实项目 smoke。
- 已进入 Phase 15.5 / Phase 16+。
- 已提交 commit。

真实项目 smoke 仍必须由用户明确确认后才能开始。用户确认前，不得启动真实项目 smoke，不得宣布 Phase 15 Beta PASS / smoke-ready，不得进入 Phase 15.5 / Phase 16+。
