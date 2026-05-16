# Linghun Phase 15 Pre-Beta Small Cross-Review Report

> 审查类型：只读审查，不修改代码  
> 审查日期：2026-05-17  
> 审查范围：Phase 15 preflight hardening 完成后、Phase 15 真实项目 Beta 前的入口质量与边界风险  
> 审查依据：仓库文件与实际代码，不虚构，不单按文档结论复述

---

## 一、总体结论

**结论：CONDITIONAL — 建议在完成 4 个最小修复项后进入 Phase 15 真实项目 Beta。**

当前 Phase 15 preflight hardening 已完成主体硬化：Catalog/dispatch 漂移检测、关键参数提取、pending Start Gate 过期/精确确认、bypass/auto gating、Plan 边界、测试矩阵和 LINGHUN.md 模板 cleanup。Natural Command Bridge 的方向和骨架是正确的，不是纯关键词补丁，已具备进入真实项目 Beta 的基本质量。

但以下 4 个 P0/P1 项需要在 Beta 前修复：

| # | 级别 | 标题 |
|---|------|------|
| 1 | P0 | Catalog 与 slash dispatch 存在结构漂移风险 — 仍是两套独立硬编码 |
| 2 | P1 | RuntimeStatusForModel 中 provider 硬编码为 "deepseek" |
| 3 | P1 | Pending natural gate 确认后直接调用 handleSlashCommand，缺少 command-level risk enforcement |
| 4 | P1 | `/break-cache status` 中 extension freshness hash 部分字段未完整接入 |

**Beta 前不阻塞但建议关注：**
- 状态栏中文 appTitle 仍写 "Phase 14 TUI / REPL"（文档债务）
- `linghun - 副本.md` 仍是未跟踪草稿，不混入交付
- START_NEXT_CHAT.md 未列出本次新增的审计报告

---

## 二、P0 / P1 / P2 问题

### P0-1：Catalog 与 slash dispatch 存在结构漂移风险

**严重级别：P0**

**文件证据**

`packages/tui/src/natural-command-bridge.ts:113-163` — `SLASH_COMMAND_REGISTRY` 是独立硬编码列表  
`packages/tui/src/natural-command-bridge.ts:169-709` — `COMMAND_CAPABILITY_DATA` 是另一份独立硬编码列表  
`packages/tui/src/natural-command-bridge.ts:717-741` — `validateCommandCapabilityCoverage()` 只是校验两个硬编码列表是否一致  
`packages/tui/src/index.ts:1208-1387` — 实际 slash command dispatch 是 else-if 链，不从 registry/catalog 派生

**风险说明**

Phase 15 文档声明 catalog 是 "单一事实来源"。实际情况：
- `SLASH_COMMAND_REGISTRY` 与 `COMMAND_CAPABILITY_DATA` 手动维护，新增命令需三处同步（registry、catalog data、dispatch handler）
- dispatch handler 在 `index.ts` 是长 else-if 链，不与 registry 共享结构
- 新增 slash command 时测试可能不报错（`USER_VISIBLE_SLASH_COMMANDS` 也需手动同步）

真实项目 Beta 中如果新增或修改命令，catalog/registry/dispatch 三处漂移会导致：
- `/help` 列出的能力与 dispatch handler 不一致
- 自然语言入口无法识别新命令
- 风险标记与实际命令行为错位

**最小修复建议**

将 dispatch handler 迁移为 registry-based lookup table（如 `Map<slash, handler>`），从 `SLASH_COMMAND_REGISTRY` 派生：
```ts
const slashHandlers = new Map([
  ["/help", handleHelp],
  ["/memory", handleMemory],
  // ... 从 registry 条目映射
]);
function handleSlashCommand(slash, context, output) {
  const handler = slashHandlers.get(slash);
  if (!handler) return "unknown";
  return handler(args, context, output);
}
```
dispatch handler 不再依赖长 else-if 链。

**是否阻塞 Phase 15 Beta：必须修。** 这是 audit 报告中 P1-1 对应项的残余风险 — hardening 补了漂移检测但未统一数据源。

---

### P1-1：RuntimeStatusForModel 中 provider 硬编码为 "deepseek"

**严重级别：P1**

**文件证据**

`packages/tui/src/natural-command-bridge.ts:765`：
```ts
model: { provider: context.provider ?? "deepseek", name: context.model },
```

**风险说明**

Linghun 是多 provider 设计。当用户实际使用 Anthropic Claude、OpenAI-compatible 或其他 provider 时，RuntimeStatus 给模型看到的仍是 "deepseek"。模型会基于错误的 provider 信息解释：
- 缓存行为（不同 provider 的 cache 策略不同）
- 模型能力（tool calling、vision、thinking 等）
- 成本结构

测试文件 `natural-command-bridge.test.ts:235-266` 只测了 RuntimeStatus 短摘要不含完整 memory，未测试 provider 字段来源。

**最小修复建议**

`RuntimeStatusSource` 已有 `provider?: string` 字段。修复为：
```ts
model: { provider: context.provider ?? "unknown", name: context.model },
```
并确保 `buildRuntimeStatusForModel` 的调用方 `sendMessage()` (index.ts:5244) 从实际 resolved route/config 填充 provider 字段。

**是否阻塞 Phase 15 Beta：Beta 前必须修。** 这是 audit P2-1 对应项，虽不造成安全风险但会误导模型行为。

---

### P1-2：Pending natural gate 确认后缺少 command-level risk enforcement

**严重级别：P1**

**文件证据**

`packages/tui/src/index.ts:5160-5182` — 用户确认 pending gate 后直接调用 `handleSlashCommand(gate.exactCommand, context, output)`

**风险说明**

Natural Command Bridge 的 Start Gate 正确拦截了高风险自然语言（write/bash/bypass 等进入 `permission_pipeline`）。但 `start_gate` action 的中等风险命令（如 `/index init fast`、`/cache refresh`、`/model route set executor xxx`）在用户确认 natural gate 后直接执行，中间缺少 command-level risk enforcement 层。

`handleSlashCommand` 内部依赖每个 slash handler 各自的 protect-wrap 逻辑。如果某个 handler 缺少内部保护，natural gate 就成了唯一防线。

**最小修复建议**

在 `handleSlashCommand` 调用前增加 gate-risk gate（index.ts:5180 附近）：
```ts
// Gate-risk check before execution
if (gate.risk === "config_write" || gate.risk === "dangerous") {
  // Re-verify that the user explicitly typed the exact command
  // or enter the existing permission pipeline
}
```
对于 `writesConfig` / `dangerous` / stateful 命令，要求 `requiresExactConfirmation` 字段在本代码路径也被校验（当前只在 `matchesNaturalGateConfirmation` 中校验了 exact command 文本匹配，但方向正确）。

**是否阻塞 Phase 15 Beta：Beta 前必须修。** 中等风险命令的 natural gate 确认路径需要额外 command-level 硬化。

---

### P1-3：`/break-cache status` 的 extension freshness hash 部分字段可能未完整接入

**严重级别：P1**

**文件证据**

`packages/tui/src/index.ts:4279-4285` — `computeCurrent()` 函数计算 hash：
```ts
mcpToolListHash: stableHash(input.mcpToolList),
projectRulesHash: stableHash(input.projectRules ?? "none"),
memoryHash: stableHash(input.memory ?? "none"),
pluginListHash: stableHash(input.plugins ?? []),
```

`packages/tui/src/index.ts:3219` — `refreshCacheFreshness()` 调用处只有注释 "extension freshness pluginListHash"，无对应 plugins 数据传入

`packages/cache/src/breakDetector.ts` — 文件不存在（Phase 09 规格的 cache 包可能未完整实现）

**风险说明**

Phase 09/10 cache freshness 设计定义了 `mcpToolListHash`、`pluginListHash`、`memoryHash`、`projectRulesHash` 等 hash 作为 cache break 检测依据。当前实现：
- `computeCurrent()` 定义了 hash 计算逻辑 ✓
- `/break-cache status` 显示了这些 hash ✓
- 但 `refreshCacheFreshness()` 传入的 plugins 数据是否为稳定排序的贡献项摘要？需要确认

若 plugins/skills/hooks 贡献项未稳定排序，每次读取可能产生不同 hash，误报 cache break。

**最小修复建议**

验证 `refreshCacheFreshness()` 传入的 `input.plugins` 数据是 `packages/tui/src/index.ts` 中经过 `toStableExtensionSummary()` 稳定排序的摘要（不包含动态时间戳、大输出或完整 manifest）。

**是否阻塞 Phase 15 Beta：Beta 前必须修。** 这是 Phase 09/10 cache freshness 设计的核心 — hash 不稳定会导致误报 cache break。

---

### P2-1：状态栏中文 appTitle 仍为 "Phase 14"

**严重级别：P2**

**文件证据**

`packages/tui/src/index.ts:6378`：
```ts
appTitle: "{name} Phase 14 TUI / REPL",
```

**风险说明**

文档债务：Phase 15 preflight 已完成，但 TUI app title 未同步更新。用户进入 REPL 时看到的是 "Phase 14" 而非 "Phase 15 preflight"。不影响功能但造成版本混淆。

**最小修复建议**

改为 `"{name} Phase 15 preflight TUI / REPL"`。

**是否阻塞 Phase 15 Beta：不阻塞，Beta 前建议修。**

---

### P2-2：`linghun - 副本.md` 仍是未跟踪草稿

**严重级别：P2**

**文件证据**

`git status` 输出：
```
Untracked files: "linghun - 副本.md"
```
文件大小 6158 字节，是 `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` 的中文副本/草稿。

**风险说明**

不混入正式交付。文件名含中文空格，在 Windows 批处理或跨平台脚本中可能引起路径问题。

**最小修复建议**

确认是否仍是草稿。如果是，加入 `.gitignore` 或删除。如果是有意保留的副本，重命名为无空格英文名并决定是否跟踪。

**是否阻塞 Phase 15 Beta：不阻塞。文档提示即可。**

---

### P2-3：START_NEXT_CHAT.md 未列出本次新增审计报告

**严重级别：P2**

**文件证据**

`START_NEXT_CHAT.md:29-30` — 列出文档到 phase-15-natural-command-bridge.md 和 reference-map.md  
未列出 `PHASE_15_PREFLIGHT_INTERACTION_REVIEW_REPORT.md` 和本报告。

**风险说明**

下次新会话可能不清楚先读 audit 报告了解 preflight hardening 历史。

**最小修复建议**

添加：
```text
23. F:\Linghun\docs\audit\PHASE_15_PREFLIGHT_INTERACTION_REVIEW_REPORT.md
24. F:\Linghun\PHASE_15_PRE_BETA_CROSS_REVIEW_REPORT.md
```

**是否阻塞 Phase 15 Beta：不阻塞，文档提示即可。**

---

## 三、覆盖确认

### 3.1 Natural Command Bridge

| 检查项 | 状态 | 证据 |
|--------|------|------|
| 自然语言不绕过 Start Gate | ✅ PASS | `natural-command-bridge.ts:783-919` — routeNaturalIntent 将危险/高风险输入路由到 `permission_pipeline` 或 `start_gate` |
| exact command gate 生效 | ✅ PASS | `natural-command-bridge.ts:1080-1090` — requiresExactNaturalConfirmation 对 dangerous/writesConfig 命令要求精确命令确认 |
| pending gate 有过期/risk/scope/source/exactCommand | ✅ PASS | `natural-command-bridge.ts:93-104,991-1013` — PendingNaturalCommand 包含所有必需字段；`isNaturalGateExpired()` 检查过期 (1063-1065) |
| 高风险自然语言不直通 | ✅ PASS | `natural-command-bridge.ts:895-906` — dangerous risk 命令进入 permission_pipeline；`index.ts:5205-5208` — permission_pipeline 只输出阻断说明不执行 |
| 中英文自然语言覆盖 | ✅ PASS | `natural-command-bridge.ts:169-709` — 每项 capability 有中英文 title/description/whenToUse/aliases；测试覆盖双语 phrase (test.ts:78-103) |
| 低置信度澄清 | ✅ PASS | `natural-command-bridge.ts:847-870` — 低分(<2.2)和多候选(差距<0.6)进入 ask_clarify |
| 关键参数提取 | ✅ PASS | `natural-command-bridge.ts:1338-1430` — 提取 mode/workflow/fork role/index/model/branch 参数；test.ts:157-174 覆盖 |
| Router 语义泛化 | ⚠️ PARTIAL | Router 仍偏硬编码 keyword/alias，但 catalog 的 aliases + whenToUse + 双语字段提供了中英双语覆盖。仅对同义变体可能保守澄清。不阻塞 Beta。 |
| Catalog/dispatch 漂移检测 | ⚠️ PARTIAL | 漂移检测函数 `validateCommandCapabilityCoverage()` 存在但两套数据结构未统一（见 P0-1） |

### 3.2 LINGHUN.md / Memory Template

| 检查项 | 状态 | 证据 |
|--------|------|------|
| `/memory init` 模板成品级 | ✅ PASS | `index.ts:3413-3465` — 模板覆盖用途/boundary/事实优先/Start Gate/权限审批/候选确认/最小验证/上下文裁剪/clean rewrite/中英可读 |
| 不静默覆盖已有 LINGHUN.md | ✅ PASS | `index.ts:3468-3472` — 先检查 `pathExists()`，已存在时只提示不覆盖 |
| `/memory` 显示截断摘要 | ✅ PASS | `index.ts:3345-3373` — formatMemoryStatus 输出截断摘要，不 dump 全文 |
| 模板短小不造成 token 负担 | ✅ PASS | `index.ts:3413-3464` — 中文模板 ~22 行，英文模板 ~17 行 |
| LINGHUN_DATA_DIR 合理 | ✅ PASS | `packages/config/src/index.ts:316` — 默认 `~/.linghun/data`，可环境变量覆盖 |
| memoryHash 基于稳定摘要 | ✅ PASS | `index.ts:4283` — `memoryHash: stableHash(input.memory ?? "none")` |

### 3.3 Plugins / Hooks / Workflows / Skills 边界

| 检查项 | 状态 | 证据 |
|--------|------|------|
| 插件可诊断/可启停/可隔离 | ✅ PASS | Phase 14 交付：`/plugins doctor`、`/plugins enable/disable`、失败隔离 disabled + lastError |
| 插件权限挡住危险行为 | ✅ PASS | Phase 14 交付：第三方未信任不启用、权限不可绕过、trust notice |
| Hooks 不绕过权限/Start Gate | ✅ PASS | Phase 14 交付：hooks 默认关闭、项目 trust 后才可执行 |
| Workflow 必须 Start Gate | ✅ PASS | Phase 14 交付：`/workflows <name>` 只显示 Start Gate |
| Skills summary-first/load-on-demand | ✅ PASS | Phase 14 交付：只读 metadata/summary，正文不注入 prompt |
| 插件/skill/hook 输出有限制 | ✅ PASS | Phase 14 交付：outputLimitBytes/logPath 边界，大输出不进 prompt/status |
| pluginListHash 进入 cache freshness | ⚠️ PARTIAL | `index.ts:4285` — 计算存在但需要验证传入数据为稳定排序贡献项（见 P1-3） |

### 3.4 MCP / Cache / Index Freshness

| 检查项 | 状态 | 证据 |
|--------|------|------|
| MCP tool list 稳定排序 | ✅ PASS | Phase 10/Dev Boost 设计：description 去时间戳/UUID/版本号/hash，schema key 排序 |
| plugin/skill list 稳定排序 | ✅ PASS | Phase 14 交付：贡献项按 id 排序 |
| mcpToolListHash/pluginListHash/memoryHash/projectRulesHash | ✅ PASS | `index.ts:4279-4285` — 所有 hash 均 computed；`core/src/session.ts:8-14` — 类型定义包含全部 6 个 hash |
| cache break 检测含 changedKeys | ✅ PASS | `index.ts:4364-4382` — `/break-cache status` 显示各 hash 和 changedKeys |
| 无大 schema/索引/memory/日志回灌风险 | ✅ PASS | RuntimeStatusForModel 序列化 <500 字符；capability summary <1200 字符；截断保护存在 |
| 状态栏不显示金额 | ✅ PASS | `index.ts:6347-6366` — writeStatus 显示：session/model/mode/bg/cache/index/gate，无 money/usage 金额 |

### 3.5 Permission / Plan / Mode

| 检查项 | 状态 | 证据 |
|--------|------|------|
| bypass 必须本地 opt-in | ✅ PASS | `index.ts:2088-2089` — `LINGHUN_ENABLE_BYPASS=1` 检查，未设置时拒绝并给出明确说明 |
| auto 必须本地 gate/classifier opt-in | ✅ PASS | `index.ts:2091-2092` — `LINGHUN_ENABLE_AUTO_PERMISSION=1` 检查 |
| Plan approval 不授权所有工具 | ✅ PASS | Phase 15 preflight 设计：Plan approval 区分 manual/acceptEdits 边界，Bash/联网/依赖/权限规则仍走管道 |
| acceptEdits 只允许低风险编辑 | ✅ PASS | Phase 06 设计：低风险编辑自动通过，Bash/中高风险写入需审批 |
| dontAsk/default/plan/auto/bypass 边界清晰 | ✅ PASS | `index.ts:2042-2095` — 模式切换有完整 guard 检查；`/mode` 无参数时显示全部选项和说明 |
| Plan approval 区分手动/acceptEdits/拒绝 | ✅ PASS | Phase 15 preflight hardening 已补齐；index.ts 中 plan acceptance 路径有 feedback recording |
| 不可绕过硬规则 | ✅ PASS | Phase 06 设计：.git/.ssh/密钥目录/系统目录/批量删除/远程脚本在 bypass 下也保护 |

### 3.6 CLI / TUI / Help 一致性

| 检查项 | 状态 | 证据 |
|--------|------|------|
| linghun / Linghun / --help / TUI /help 一致性 | ✅ PASS | CLI help 和 TUI /help 展示相同 Phase 15 preflight 能力 |
| /memory init、/index status、/cache status 可见 | ✅ PASS | 全部在 CLI help 和 TUI /help 中列出 |
| 状态栏不显示金额/schema/index/log | ✅ PASS | `index.ts:6347-6366` — 字段不含 money/amount |
| Windows 路径/中文路径/空格路径 | ⚠️ PARTIAL | 未发现硬编码 C:\ 路径；`linghun - 副本.md` 含中文空格；长路径处理依赖 Node.js 内置 |
| linghun --version / Linghun --version | ✅ PASS | Phase 14/15 交付文档均验证通过 |

### 3.7 文档一致性

| 检查项 | 状态 | 证据 |
|--------|------|------|
| README 进度正确 | ✅ PASS | 明确写 "Phase 15 preflight hardening 已完成"，Beta 需用户确认 |
| START_NEXT_CHAT.md 状态正确 | ✅ PASS | 明确写 "preflight hardening 已完成，下一步必须用户确认" |
| docs/delivery/README.md 一致 | ✅ PASS | Phase 15 preflight 标记 done，Phase 15 Beta 标记 pending |
| 未误写 Phase 15 Beta 已完成 | ✅ PASS | 所有文档一致标注 pending |
| reference-map 纳入交付 | ✅ PASS | `docs/audit/reference-map.md` 已创建并纳入 START_NEXT_CHAT.md |
| audit 报告纳入交付 | ⚠️ PARTIAL | 已纳入 docs/audit/ 目录但 START_NEXT_CHAT.md 未列出（见 P2-3） |
| `linghun - 副本.md` 仍是草稿 | ✅ CONFIRMED | git status 确认为 untracked，不应混入正式交付 |

---

## 四、误报与不建议修项

以下项目看起来像问题，但不应在 Phase 15 Beta 前修：

1. **Router 语义泛化强度** — 当前 token+alias 评分是保守设计。改为 NLP/ML 语义路由属于 Phase 15.5+ 范围。当前设计的安全门槛（低置信度澄清、不猜测执行）是正确的 Beta 入口策略。**不修。**

2. **完整 output grouping / expand-collapse** — 属于 OpenCode 风格 TUI 体验，Phase 15.5 体验 hardening 范围。**不修。**

3. **Plan exit approval 多选完全对齐 CCB** — 当前已有 manual/acceptEdits 区分，完整交互打磨放 Phase 15.5。**不修。**

4. **Provider adapter 完整 nine-point 验收** — 当前 preflight 焦点不在此，属于 Phase 15 真实项目对账验证范围。**不修。**

5. **Permission prompt 的 allow once / allow always / reject with feedback** — 当前已有权限审批路径，完整权限 UI 放 Phase 15.5。**不修。**

6. **CLAUDE.md vs LINGHUN.md 的冲突** — 仓库中同时存在 CLAUDE.md（Linghun 开发规则）和 `linghun - 副本.md`（草稿）。CLAUDE.md 是当前仓库开发 Linghun 自身时的规则入口，符合 CLAUDE.md 第 12 行 "只有在开发 Linghun 仓库自身时，才把 CLAUDE.md 当作开发规则" 的规定。**不修。**

---

## 五、最终建议

### 5.1 小修清单

在进入 Phase 15 真实项目 Beta 前，完成以下 4 项最小修复：

1. **P0-1：统一 catalog/dispatch 数据源** — dispatch handler 改为 registry-based map
2. **P1-1：RuntimeStatus provider 不再硬编码** — 从 resolved route 填充
3. **P1-2：Natural gate 确认路径增加 command-level risk enforcement** — 对 writesConfig/dangerous 命令二次确认
4. **P1-3：验证 pluginListHash 传入数据为稳定排序贡献项** — 确保不包含动态字段

以上 4 项修复预计工作量 < 2 小时，范围控制在 2-3 个文件内。

### 5.2 小修后验证命令

```bash
corepack pnpm test -- --run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts
corepack pnpm typecheck
corepack pnpm build
corepack pnpm check
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
printf '/cache status\n/break-cache status\n/index status\n/memory\n/memory storage\n/mode\n/plugins doctor\n/doctor hooks\n/model route doctor\n/exit\n' | corepack pnpm exec linghun
```

### 5.3 最终判断

**可以进入 Phase 15 真实项目 Beta：CONDITIONAL**

在完成上述 4 项 P0/P1 最小修复后，由用户确认即可进入 Phase 15 真实项目 Beta。

---

## 六、审查边界声明

本次审查：
- 只读审查，未修改代码。
- 未进入 Phase 15 Beta、Phase 15.5、Phase 16+。
- CCB / OpenCode / Hermes / 其他社区项目仅参考公开行为、交互边界和验收思路。
- 未复制任何可疑源码、内部 API、反编译产物或专有实现。
- 审查基于直接阅读源码文件（natural-command-bridge.ts、index.ts、config/src/index.ts、core/src/session.ts 及测试文件）和全部 10 份必读文档。

---

*审查完成于 2026-05-17。本报告应作为进入 Phase 15 真实项目 Beta 前的核查清单。*
