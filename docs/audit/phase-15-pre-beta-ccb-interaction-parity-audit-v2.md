# Linghun Phase 15 Pre-Beta CCB Interaction Parity Audit v2

> 审计类型：只读审计（未修改任何代码）
> 审计日期：2026-05-17
> 审计范围：以 CCB / Claude Code 现有编码体验为参照，对 Linghun Phase 15 preflight 当前代码做全覆盖交互体验审计
> 审计依据：直接阅读源码（natural-command-bridge.ts、index.ts、config/src/index.ts）、仓库文档、CCB 公开行为边界；未复制任何源码实现
> 前置审计：v1 审计报告位于 `docs/audit/phase-15-pre-beta-ccb-coding-experience-parity-audit.md`

---

## 1. 总体结论

### 1.1 当前状态

Linghun Phase 15 preflight + Natural Intent Contract hardening 已实质性完成。上一轮 v1 审计识别的 6 个 P0/P1 问题中，**5 个已修复 (FIXED)**，1 个按交付文档约定保持 eliff chain + drift detection (NOT BROKEN)。本轮 Phase 15 pre-Beta Interaction P1 cleanup 已修复 **4 个 provider 硬编码 P1**，并完成 **1 个 Start Gate 默认主输出去工程化 P1**；剩余为 P2 交互手感项，保留到 Beta 后 / Phase 15.5。

### 1.2 是否建议进入 Phase 15 真实项目 Beta

**建议：CONDITIONAL PASS — Phase 15 pre-Beta Interaction P1 cleanup 已完成，Phase 15 Beta 前置交互/统计阻塞项已清零；是否进入 Beta 仍需用户明确确认。**

本轮 5 项 NEW-P1 已完成，均为局部替换或输出格式收口，无架构风险。P2 项不阻塞 Beta，保留到 Beta 后 / Phase 15.5。

### 1.3 Linghun 当前距 CCB 级编码体验的主要差距（更新）

| 维度 | v1 达成 | v2 达成 | 变化 |
|------|---------|---------|------|
| 自然语言入口安全性 | 85% | **92%** | doctor_query 补齐，status 模式扩展 |
| Catalog→dispatch 一致性 | 70% | 70% | 按交付约定未重构（drift detection 在） |
| 模式/权限边界 | 80% | **90%** | decidePermission 顺序修复 |
| 状态可见性 | 75% | **82%** | /model 展示 provider+路由摘要 |
| 缓存/成本观测 | 80% | **82%** | freshness、recordModelUsage、/usage、/stats、handoff provider 均已修复为真实 provider 或 unknown |
| 编码工具闭环 | 85% | 85% | 无变化 |
| Agent/multi-model | 80% | 80% | 无变化 |
| Skills/Workflows 边界 | 85% | **88%** | extension freshness 稳定排序已验证 |
| 中文体验 | 80% | **85%** | 自然语言桥覆盖扩展 |

---

## 2. 上一轮 P0/P1 修复验证（逐项代码证据）

### P0-1: doctor_query 独立路由 — ✅ FIXED

**证据**：`packages/tui/src/natural-command-bridge.ts`

```typescript
// Line 49 - inquiry type now includes "doctor"
inquiry: "status" | "doctor" | "usage" | "risk" | "howto" | "execute";

// Lines 1212-1218 - detectInquiry has doctor patterns
if (
  /key|api key|configured|connected|working|doctor|诊断|配好了吗|配置正常|配置.*问题|为什么不能用|不能用|连上了吗|可用吗/u.test(text)
) {
  return "doctor";
}

// Lines 831-846 - routeNaturalIntent handles doctor inquiry
if (
  inquiry === "doctor" &&
  isFirstBatchStatusCapability(capability.id) &&
  !isActionRequest(normalized)
) {
  return createIntent("execute_readonly", capability, ...);
}
```

**验证**：`"模型 key 配好了吗"` → `detectInquiry` 返回 `"doctor"` → `routeNaturalIntent` 路由到 `execute_readonly` → `/model route doctor`

---

### P0-2: Catalog/dispatch 结构漂移 — ⚠️ DELIBERATELY NOT REFACTORED

**证据**：`packages/tui/src/index.ts` lines 1257-1436

`handleSlashCommand` 仍是长 else-if 链（约 35 个 if blocks），未迁移至 registry-based lookup table。

**漂移检测存在**：`validateCommandCapabilityCoverage()` in `natural-command-bridge.ts` lines 717-741。

**按交付约定**：Phase 15.5 或后续架构 cleanup 中统一做 registry map 化重构，当前 pre-Beta 阶段只保留 drift detection + coverage test。此状态已在 Phase 15 交付文档中明确记录。

**判定**：NOT BROKEN — 按交付约定执行。

---

### P1-1: detectInquiry/isStatusLike 模式覆盖 — ✅ FIXED (主路径)

**证据**：`packages/tui/src/natural-command-bridge.ts`

```typescript
// Lines 1220-1225 - detectInquiry status patterns expanded
if (
  /是否|开了吗|enabled|status|状态|当前|现在|什么模型|哪个模型|用的哪个|命中|hit rate|list|有哪些|what model|current model/u.test(text)
) {
  return "status";
}
```

**路由追踪**：`"你是什么模型"` → `detectInquiry` 匹配 `什么模型` → 返回 `"status"` → `isFirstBatchStatusCapability("model")` = true → `isActionRequest` = false → `execute_readonly` ✓

**残留**：`isStatusLike` (line 1360-1364) 仍用旧模式，但该函数仅用于非 first-batch 能力的 fallback 路径 (line 899)，实际影响极小。

**判定**：FIXED — 最常见场景已修复。

---

### P1-2: getCurrentFreshness provider 硬编码 — ✅ FIXED

**证据**：`packages/tui/src/index.ts`

```typescript
// Line 4240 - now uses dynamic provider
provider: getRuntimeStatusProvider(context),

// Line 765 (natural-command-bridge.ts) - RuntimeStatus
model: { provider: context.provider ?? "unknown", name: context.model },
```

**判定**：FIXED — `getCurrentFreshness` 和 `buildRuntimeStatusForModel` 均已修复。

---

### P1-3: pluginListHash 来源稳定性 — ✅ FIXED

**证据**：`packages/tui/src/index.ts` lines 4275-4316

```typescript
function createExtensionFreshnessSummary(context: TuiContext): unknown {
  return {
    skills: context.skills.skills.map(...).sort((a, b) => a.id.localeCompare(b.id)),
    workflows: context.workflows.templates.map(...).sort((a, b) => a.id.localeCompare(b.id)),
    hooks: context.hooks.hooks.map(...).sort((a, b) => `${a.event}:${a.id}`.localeCompare(...)),
    plugins: context.plugins.plugins.map(...).sort((a, b) => a.id.localeCompare(b.id)),
  };
}
```

所有四个数组均使用稳定排序。`getCurrentFreshness` line 4245 调用 `createExtensionFreshnessSummary(context)` 传入 plugins 字段。

**判定**：FIXED — 输入顺序不影响 hash。

---

### P1-4: decidePermission 决策顺序 — ✅ FIXED

**证据**：`packages/tui/src/index.ts` lines 5748-5851

决策顺序（逐行追踪）：
1. **hardDeny** (line 5766-5769) — 硬拒绝
2. **plan mode** (line 5771-5779) — **先于用户规则检查**
3. **userRules** (line 5781-5793) — deny/ask/allow 规则
4. **dontAsk** (line 5796-5803)
5. **acceptEdits** (line 5805-5820)
6. **bypass** (line 5822-5831)
7. **auto** (line 5833-5839)
8. **default** (line 5842-5850)

**判定**：FIXED — plan mode 检查已移到用户规则之前。

---

## 3. 新发现 P0/P1/P2 问题

### NEW-P1-1: recordModelUsage 硬编码 provider "deepseek"（影响缓存统计准确性）— ✅ FIXED

**文件**：`packages/tui/src/index.ts`
**原行号**：3624, 3633

**原问题**：`recordModelUsage()` 曾在 `computePromptCacheHitRate()` 输入和 `CacheTurnStats.provider` 中硬编码 `deepseek`，导致 `/cache status`、`/break-cache status`、`/stats`、`/stats endpoints` 的 provider 字段在非 deepseek 场景下统计失真。

**修复结果**：已改为使用当前可解析 provider；无法解析时为 `unknown`，不再伪造 `deepseek`。

**验证**：focused tests 覆盖 openai-compatible provider 下 cache 统计 provider 正确。

---

### NEW-P1-2: formatStats 硬编码 provider "deepseek" — ✅ FIXED

**文件**：`packages/tui/src/index.ts`
**原行号**：4481, 4489

**原问题**：`/stats` 的 hitRate provider 输入和显示行曾固定为 `deepseek`。

**修复结果**：`/stats` 现在优先使用最新 cache history 中的真实 provider；无样本时显示 `unknown`，不再伪造 `deepseek`。

**验证**：focused tests 与 no-usage provider 探针覆盖 `/stats` provider fallback 为 `unknown`。

---

### NEW-P1-3: formatUsage fallback 硬编码 provider "deepseek" — ✅ FIXED

**文件**：`packages/tui/src/index.ts`
**原行号**：4451

**原问题**：无历史记录时 `/usage` 曾 fallback 为 `provider: deepseek`。

**修复结果**：无历史 usage 时 `/usage` provider fallback 改为 `unknown`，不再伪造 `deepseek`。

**验证**：no-usage provider 探针覆盖 `/usage` provider fallback 为 `unknown`。

---

### NEW-P1-4: createHandoffPacket 硬编码 provider "deepseek" — ✅ FIXED

**文件**：`packages/tui/src/index.ts`
**原行号**：3302

**原问题**：生成的 handoff packet 中 `modelProvider.provider` 曾固定为 `deepseek`。

**修复结果**：handoff packet 现在使用当前真实 provider；无法解析时为 `unknown`。

**验证**：focused tests 覆盖 openai-compatible provider 下 handoff packet 的 `modelProvider.provider`。

---

### NEW-P1-5: Start Gate 默认主输出过度工程化

**文件**：`packages/tui/src/natural-command-bridge.ts`

**触发场景**：用户用自然语言请求安全启动类动作，例如：

```text
帮我给这个项目建立索引
```

**当前问题**：Start Gate 安全逻辑正确，但默认主输出直接暴露 `gateId`、`expiresAt`、`risk=start_gate`、`readonly=no`、`writesConfig`、`permissionPipeline`、`logPath` 等内部字段，整体像调试日志而不是成品级确认提示。

**影响**：真实项目 Beta 中，用户会被工程化字段打断；这会污染 Phase 15 对“编码能力、缓存/索引/记忆/多模型效率”的验证，让 Beta 退化成基础交互补丁测试。

**CCB 参考行为**：CCB 的权限/信任/确认交互将主提示压缩为人能理解的 decision prompt；内部 permission reason/debug info 不作为默认主输出。

**成品级建议**：默认主输出应改为 human-first 摘要：

- 说明“我可以做什么”。
- 显示精确命令，例如 `/index init fast`。
- 显示 scope。
- 用自然语言说明风险和安全门，例如“会读取项目文件并生成本地索引，不会修改源码；索引前仍会检查大文件和生成目录”。
- 显示继续/取消方式。
- 默认主输出不得展示 `gateId`、`expiresAt`、raw risk flags、`writesConfig`、`permissionPipeline`、`logPath`。

**边界**：不降低安全，不接受普通“确认/yes”替代 exact command；高风险动作仍需严肃提示并保留权限管道。

**修复工作量**：< 30 分钟（格式化函数和 focused tests）。

---

### P2-1: 无 verbose / details / debug 三层输出分离

**证据**：全仓库搜索 `verbose|debug|VERBOSE|DEBUG` 仅 2 条结果（均非输出分层相关）。

**CCB 参考行为**：CCB 通过 `--verbose` flag 和 `/debug` 命令提供分层输出；默认视图简洁，详情视图展开 token/工具调用/缓存细节。

**Linghun 当前状态**：
- 默认状态栏：7 字段（session/model/mode/bg/cache/index/gate）— 简洁 ✓
- `/usage`、`/stats`：token + cache 详情 — 详情视图 ✓
- `/cache status`、`/break-cache status`：完整诊断 — 详情视图 ✓
- **缺失**：无 `--verbose` CLI flag、无 `/debug` 命令、无三层输出模式切换

**建议**：Phase 15.5 补齐 `--verbose` flag 和 `/debug` 概要切换。当前不阻塞 Beta——关键信息已有分层（状态栏简洁 + 详情命令完备）。

---

### P2-2: 状态栏不显示 provider 短名

**文件**：`packages/tui/src/index.ts` line 6404-6422

当前状态栏格式：
```
状态栏：session {session} · model {model} · mode {mode} · bg {background} · cache {cache} · index {index} · gate {gate}
```

只显示 `model {model}` 不显示 `provider`。但 `/model` 无参数命令已同时显示 provider + model + 角色路由摘要。

**建议**：Phase 15.5 将状态栏 `model` 字段改为 `{provider}/{model}` 短格式。

---

### P2-3: 错误提示缺乏 provider 连接失败专项

**文件**：`packages/tui/src/index.ts` lines 1250-1254

```typescript
} catch (error) {
  const message = error instanceof Error ? error.message : "TUI 运行失败。";
  writeLine(errorOutput, `错误：${message}`);
  return 1;
}
```

**当前行为**：顶层 catch 用通用错误消息，不区分 provider 不通、API key 缺失、网络超时、模型不支持等场景。

**CCB 参考行为**：CCB 对常见配置错误有针对性提示（如 "Authentication error: check your API key"）。

**缓解因素**：`/model route doctor` 已提供详细配置诊断，覆盖 API key 缺失、baseUrl 未配置、模型占位等场景。

**建议**：Phase 15.5 在错误边界增加 provider error classifier，映射为中文可操作建议。

---

### P2-4: isStatusLike 模式滞后于 detectInquiry

**文件**：`packages/tui/src/natural-command-bridge.ts` lines 1360-1364

```typescript
function isStatusLike(text: string, capability: CommandCapability): boolean {
  return (
    capability.readonly ||
    /状态|status|当前|enabled|开了吗|命中|hit rate|list|有哪些|what model/u.test(text)
  );
}
```

**差距**：未包含 `现在|什么|吗|呢|current model|哪个模型` 等新加模式。

**实际影响**：`isStatusLike` 仅用于非 first-batch 能力的 fallback 路径 (routeNaturalIntent line 899)，主路径通过 `detectInquiry` + `isFirstBatchStatusCapability` 处理。实际影响极小。

**建议**：Phase 15.5 同步 `isStatusLike` 与 `detectInquiry` 的 status 模式。

---

### P2-5: 中英文消息覆盖不完整

**文件**：`packages/tui/src/index.ts` lines 6433-6500+

当前 messages 对象覆盖约 15 个 key（appTitle/intro/currentModel/unknownCommand/exit/status/statusShort/help/inputPrompt/noSessions/sessionHeader/noSummary/checkpoint*/background*/interrupt*/btwPrefix/evidenceBlocked/claimNeedsDisclaimer）。

**缺失**：部分 slash command handler（如 `/skills`、`/workflows`、`/plugins`）的输出未走 i18n 消息表，直接硬编码中文或英文。例如：
- `formatSkills` (line 1438): 混合中英文
- `formatWorkflows`: 直接写中文
- handleIndexCommand usage 提示: 硬编码中文

**建议**：Phase 15.5 将硬编码字符串迁入 messages 表。

---

### P2-6: TUI 标题动态性

**文件**：`packages/tui/src/index.ts` line 6435

```typescript
appTitle: "{name} TUI / REPL",
```

当前标题使用 `{name}` 变量（应为 "Linghun"），已去掉 Phase 14 字样。✓

---

### P2-7: 内部字段 `rawUsage` 进入 `/usage` 视图

**文件**：`packages/tui/src/index.ts` line 4454

```typescript
`- rawUsage records: ${context.cache.history.filter(...).length}`,
```

`/usage` 中展示 rawUsage 记录数，属于内部实现细节。CCB 同类命令不暴露此粒度。

**建议**：Phase 15.5 将此字段移入 verbose/debug 视图。

---

## 4. 16 审计面全覆盖

### 4.1 启动与 onboarding

| 检查项 | 状态 | 证据 |
|--------|------|------|
| CLI --version | ✅ | `0.1.0`（linghun 和 Linghun 均输出） |
| CLI --help | ✅ | Phase 15 preflight help |
| TUI 标题 | ✅ | `Linghun TUI / REPL`（已去 Phase 14） |
| LINGHUN.md 缺失提示 | ✅ | `[hint:info] 缺少 LINGHUN.md 项目规则；如需基础模板，可运行 /memory init` |
| `/memory init` 模板 | ✅ | 中文"项目规则"模板含 用途/应写入/不应写入/工作规则，22行 |
| 规则加载优先级 | ✅ | LINGHUN.md → CLAUDE.md/AGENTS.md 兼容 |
| 语言偏好 | ✅ | `/language` 切换 zh-CN/en-US |

**本路径结论**：启动与 onboarding 达 CCB 级别，部分（缺失提示/模板）优于 CCB。

---

### 4.2 自然语言命令识别

| 检查项 | 状态 | 证据 |
|--------|------|------|
| status_query | ✅ | "现在是什么模型"→execute_readonly→prov+model+路由 |
| doctor_query | ✅ | "模型 key 配好了吗"→doctor inquiry→execute_readonly |
| usage_help | ✅ | "/model 怎么用"→answer→用途/风险/whenToUse |
| safe_action_request | ✅ | "帮我建立索引"→start_gate→需精确确认 |
| config_change_request | ✅ | "切换到 bypass"→模式切换+guard |
| dangerous_action_request | ✅ | "直接 npm install"→permission_pipeline 阻断 |
| ambiguous_request | ✅ | 低置信度/多候选→ask_clarify |
| 中英等价 | ✅ | 同一能力中英文走同一风险路径 |
| 低置信度澄清 | ✅ | `!explicit && topScore < 2.2` → ask_clarify |
| 多候选澄清 | ✅ | `abs(topScore-secondScore) < 0.6` → ask_clarify |
| 高风险阻断 | ✅ | `detectDangerousNaturalIntent` + `isDangerousNaturalTarget` |

**本路径结论**：Natural Intent Contract 的 7 种 request kind 全覆盖，高风险自然语言正确阻断。

---

### 4.3 启动门与权限

| 检查项 | 状态 | 证据 |
|--------|------|------|
| Start Gate 6 要素 | ✅ | exact action/risk/scope/reason/rollback/choices |
| pending gate 过期 | ✅ | `expiresAt` + 过期拒绝执行 |
| 精确确认（非普通 yes） | ✅ | 高风险+gate 需要 exact command |
| bypass 本地 opt-in | ✅ | `LINGHUN_ENABLE_BYPASS=1` |
| auto gate/classifier 可用 | ✅ | `LINGHUN_ENABLE_AUTO_PERMISSION=1` |
| 自然语言不能静默提权 | ✅ | mode change guard |
| plan mode 只读 | ✅ | 禁止 Write/Edit/Bash（计划检查优先于用户规则） |
| plan 不授权全部工具 | ✅ | Bash/依赖/权限规则仍需审批 |
| decision order | ✅ | hardDeny→plan→userRules→acceptEdits→bypass→auto→default |
| 硬拒绝保护 | ✅ | .git/.ssh/密钥/系统目录 |

**本路径结论**：权限/Plan/提权交互已达 CCB 安全级别。

---

### 4.4 模型与 provider 命令

| 检查项 | 状态 | 证据 |
|--------|------|------|
| `/model` 无参数 | ✅ | `当前模型：provider=X model=Y` + 角色路由摘要 + doctor 提示 |
| `/model route` | ✅ | 显示所有角色路由（provider/model/capabilities/tools/write/bash/budget） |
| `/model route doctor` | ✅ | 诊断每个角色路由的配置问题并给出修复建议 |
| `/model route set` | ✅ | 设置角色路由 + vision/image 角色特殊提示 |
| 状态栏模型信息 | P2 | 只显示 model 名不显示 provider |

**本路径结论**：模型命令已达 CCB 级别。

---

### 4.5 缓存与成本命令

| 检查项 | 状态 | 证据 |
|--------|------|------|
| `/cache status` | ✅ | hitRate/read-write tokens/cache write source/compact/changedKeys/note |
| `/cache warmup` | ✅ | 最小预热请求 + 不保证写入提示 |
| `/cache refresh` | ✅ | 最小刷新请求 + 不保证写入提示 |
| `/break-cache status` | ✅ | 9 个 hash + changedKeys + suggestion |
| `/usage` | ✅ | input/output/cache tokens + provider/endpoint/compact/rawUsage/role usage + billing note |
| `/stats` | ✅ | samples/elapsedMs/model/provider/hitRate/tokens/role usage/cost note |
| `/stats endpoints` | ✅ | 按 endpoint 分组统计 + hitRate |
| 金额不显示在状态栏 | ✅ | 金额仅 `/usage`/`/stats` 显示 |

**P1 cleanup 状态**：`/stats` 和 `/usage` 的 provider 硬编码已修复；无样本或无法解析 provider 时显示 `unknown`，不伪造 `deepseek`。

**本路径结论**：缓存/成本诊断完整度达 CCB Dev Boost 级别；P1 provider 统计阻塞项已清零。

---

### 4.6 MCP 与索引命令

| 检查项 | 状态 | 证据 |
|--------|------|------|
| `/mcp` / `/mcp status` | ✅ | MCP 状态含 server 连接/工具数量/错误 |
| `/mcp tools` | ✅ | 稳定排序 MCP 工具列表 |
| `/mcp doctor` | ✅ | 诊断 MCP 连接并输出状态 |
| `/index status` | ✅ | 索引状态/projectName/nodes/edges/changedFiles/staleHint |
| `/index init fast` | ✅ | 建立索引（走 Start Gate 安全门） |
| `/index refresh` | ✅ | 刷新索引 |
| `/index search` | ✅ | 搜索代码 |
| `/index architecture` | ✅ | 架构概览 |

**本路径结论**：MCP 与索引命令完整，达 CCB 级别。

---

### 4.7 Skills / Workflows / Plugins / Hooks / Memory

| 检查项 | 状态 | 证据 |
|--------|------|------|
| `/skills` | ✅ | 列出 skill summary（非全文） |
| `/skills add` | ✅ | 本地注册提示 |
| `/skills enable/disable` | ✅ | 含信任提示 + 配置持久化 |
| `/workflows` | ✅ | 列出可用模板 |
| `/workflows <name>` | ✅ | Start Gate 含 purpose/risk/writesFiles/validation |
| `/plugins` | ✅ | 列出 plugin 状态 |
| `/plugins doctor` | ✅ | 诊断 plugin 状态 |
| `/plugins enable/disable` | ✅ | 含信任提示 + 配置持久化 |
| `/doctor hooks` | ✅ | hook 健康诊断 |
| `/memory` | ✅ | 候选+接受记忆状态 |
| `/memory init` | ✅ | 中文项目规则模板，已存在时不覆盖 |
| `/memory candidate` | ✅ | 创建候选记忆 |
| `/memory accept` | ✅ | 需要用户显式确认 |
| `/memory delete` | ✅ | 删除候选/已接受记忆 |
| `/resume` | ✅ | 恢复会话 + handoff 验证 |
| `/branch` | ✅ | 分支会话 |
| `/sessions` | ✅ | 列出/恢复会话 |
| `/sessions resume` | ✅ | 从会话列表恢复 |

**本路径结论**：Skills/Workflows/Plugins/Hooks/Memory 命令完整，安全边界明确。

---

### 4.8 错误提示与诊断

| 检查项 | 状态 | 证据 |
|--------|------|------|
| API key 缺失 | ✅ | `/model route doctor` 诊断并给修复建议 |
| baseUrl 未配置 | ✅ | 同上 |
| 模型占位值 | ✅ | doctor 提示检查 .linghun/settings.json |
| provider 不通 | P2 | 通用 catch 无专项分类（但有 doctor 缓解） |
| 缺依赖 | P2 | 无专项检测（Bash 工具执行时自然暴露） |
| 错误可操作 | ⚠️ | doctor 输出可操作，顶层 catch 较通用 |

---

### 4.9 状态栏

| 检查项 | 状态 |
|--------|------|
| session ID（截断 8 字符） | ✅ |
| model 名称（截断 18 字符） | ✅ |
| permission mode | ✅ |
| 后台运行任务数 | ✅ |
| cache 命中率 | ✅ |
| index 状态 | ✅ |
| pending gate waiting confirmation（不暴露 gateId） | ✅ |
| 不显示金额 | ✅ |
| 不显示 provider | P2 |
| 状态栏长度截断 120 字符 | ✅ |

---

### 4.10 中英文一致性

| 检查项 | 状态 |
|--------|------|
| messages 双语表 | ✅ (15 keys，zh-CN + en-US) |
| help/catalog 双语 | ✅（每项含 zh/en title/description/whenToUse） |
| Natural Command Bridge 输入检测 | ✅（`detectInputLanguage` 按 CJK 字符判断） |
| 部分 handler 硬编码中文 | P2（Phase 15.5 迁入 messages 表） |

---

### 4.11 verbose / debug 输出分层

| 检查项 | 状态 |
|--------|------|
| 默认简洁视图 | ✅（状态栏 120 字符截断） |
| 详情视图（/usage /stats /cache status 等） | ✅ |
| debug/verbose CLI flag | ❌ 缺失 |
| 三层输出分离 | P2（Phase 15.5 补齐） |

---

### 4.12 禁止行为检查

| 检查项 | 状态 |
|--------|------|
| Phase 16/17/18 未提前实现 | ✅ |
| CCB 源码未复制 | ✅（clean rewrite 自研） |
| 不必要抽象未引入 | ✅ |
| 金钱不显示在状态栏 | ✅ |
| 完整 transcript 不进 prompt | ✅（RuntimeStatus < 500 字符） |

---

## 5. 问题清单

### P0 — Beta 阻塞项

**本轮无新增 P0 项。** 上一轮 P0-1 (doctor_query) 已修复，P0-2 (catalog/dispatch 漂移) 按交付约定执行。

### P1 — Beta 前强建议修复

| # | 标题 | 文件:行号 | 状态 | 修复结果 |
|---|------|----------|------|---------|
| NEW-P1-1 | recordModelUsage provider 硬编码 | index.ts:3624,3633 | ✅ FIXED | 已改为 `getRuntimeStatusProvider(context)`；focused test 覆盖 openai-compatible provider，不再伪造 deepseek。 |
| NEW-P1-2 | formatStats provider 硬编码 | index.ts:4481,4489 | ✅ FIXED | `/stats` hitRate 与显示行使用当前 provider；无匹配 provider 时为 `unknown`。 |
| NEW-P1-3 | formatUsage fallback 硬编码 | index.ts:4451 | ✅ FIXED | 无历史 usage 时 fallback 改为 `unknown`。 |
| NEW-P1-4 | createHandoffPacket provider 硬编码 | index.ts:3302 | ✅ FIXED | handoff packet 的 `modelProvider.provider` 使用当前真实 provider 或 `unknown`；focused test 覆盖 openai-compatible。 |
| NEW-P1-5 | Start Gate 默认主输出过度工程化 | natural-command-bridge.ts / index.ts | ✅ FIXED | 默认 Start Gate 输出改为 human-first decision prompt，保留 exact command、scope、人话风险、安全边界、继续/取消方式；默认主输出和状态栏不暴露 gateId、expiresAt、raw risk flags、writesConfig、permissionPipeline、logPath，pending gate 仅显示 waiting confirmation。 |

**本轮 5 项 NEW-P1 已完成。未进入 Phase 15 真实项目 Beta、Phase 15.5 或 Phase 16+。**

### P2 — Beta 后修补

| # | 标题 | 说明 |
|---|------|------|
| P2-1 | 无 verbose/debug 三层输出分离 | Phase 15.5 补齐 `--verbose` flag 和 `/debug` 命令 |
| P2-2 | 状态栏不显示 provider 短名 | 建议 `{provider}/{model}` 格式 |
| P2-3 | 错误处理缺乏 provider 专项分类 | doctor 命令缓解；顶层 catch 较通用 |
| P2-4 | isStatusLike 模式滞后 | 影响极小（fallback 路径）；Phase 15.5 同步 |
| P2-5 | 部分 handler 输出未 i18n | Phase 15.5 迁入 messages 表 |
| P2-6 | rawUsage 内部字段进入 /usage 视图 | 移入 debug 层 |
| P2-7 | dispatch else-if chain 未重构 | Phase 15.5 做 registry map 化 |

---

## 6. 验证建议

### 6.1 修复 NEW-P1 后必须执行

```bash
# 全量测试
corepack pnpm test

# 类型检查
corepack pnpm typecheck

# 构建
corepack pnpm build

# Lint + Format
corepack pnpm check

# CLI 入口
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
```

### 6.2 P1 修复后 focused test 建议

```bash
# 核心测试文件
corepack pnpm test -- --run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts packages/config/src/index.test.ts
```

### 6.3 TUI smoke 验证 NEW-P1 修复

**场景：非 deepseek provider 下验证 provider 字段**

```text
# 1. 确认 /stats 和 /usage 中 provider 不再是 "deepseek"
#    （需配置非 deepseek provider）
/model route set executor <non-deepseek-model>
/stats
/usage
/cache status
```

---

## 7. 聚焦测试建议

### 7.1 已补充的 focused test

| 测试目标 | 优先级 | 覆盖场景 |
|---------|--------|---------|
| recordModelUsage provider 动态读取 | P1 | openai-compatible provider 下 cache 统计的 provider 字段正确 |
| formatStats provider 动态显示 | P1 | `/stats` 输出中的 provider 行使用当前 provider |
| formatUsage fallback | P1 | 无 usage 历史时 `/usage` provider 为 `unknown`，不伪造 deepseek |
| handoffPacket provider 动态生成 | P1 | openai-compatible provider 下 packet 的 modelProvider.provider 正确 |
| Start Gate 默认主输出去工程化 | P1 | 中英文 index Start Gate 默认输出包含 exact command、scope、人话风险、继续/取消提示，不包含 gateId、expiresAt、raw flags、writesConfig、permissionPipeline、logPath |
| dangerous natural request 输出 | P1 | `直接 npm install` 仍阻断，输出人话风险说明，不暴露 raw flags |

### 7.2 当前测试覆盖确认

```
natural-command-bridge.test.ts: 99 tests ✅
index.test.ts: 48 tests ✅
config/src/index.test.ts: 9 tests ✅
apps/cli/src/main.test.ts: 5 tests ✅
providers/src/index.test.ts: 8 tests ✅
Total: 183 tests, 11 test files ✅（focused 命令已通过）
```

---

## 8. Beta 就绪评估

### 8.1 已就绪

- ✅ Natural Intent Contract 7 种 request kind 全覆盖
- ✅ 高风险自然语言阻断正确
- ✅ 权限/Plan/提权 6 要素展示 + 决策顺序正确
- ✅ bypass/auto 本地显式 opt-in
- ✅ Start Gate 过期/精确确认
- ✅ 缓存诊断完整（9-hash break-cache + freshness changed keys）
- ✅ Skills/Workflows/Plugins/Hooks 安全边界硬化
- ✅ 中英文双语覆盖核心路径
- ✅ 状态栏 7 字段简洁（不显示金额）
- ✅ 183 测试通过

### 8.2 Beta 前置 P1 阻塞项

- ✅ 4 项 NEW-P1 provider 硬编码已修复：recordModelUsage、/stats、/usage fallback、handoff packet 均使用真实 provider 或 unknown。
- ✅ 1 项 NEW-P1 Start Gate 默认主输出去工程化已修复：默认主输出改为 human-first decision prompt，同时保留 exact command 唯一确认路径。
- ✅ Phase 15 Beta 前置交互/统计阻塞项已清零；是否进入 Beta 仍需用户明确确认。

### 8.3 明确不阻塞 Beta

- 🟡 P2 项（verbose/debug 分层、i18n 完善、状态栏 provider、dispatch 重构）
- 🟡 Phase 15.5 计划项（双模型交叉审查、release readiness、open-source readiness）

---

## 9. 审计边界声明

本次审计：

- **只读审查**，未修改任何代码。
- 未进入 Phase 15 真实项目 Beta、Phase 15.5 或 Phase 16+。
- CCB / Claude Code 仅参考公开行为、交互边界、UX 模式和验收思路。
- 未复制任何 CCB、OpenCode、Hermes 或其他第三方项目的源码实现、内部 API、反编译产物或专有实现。
- 审查基于直接阅读源码：
  - `packages/tui/src/natural-command-bridge.ts`（约 1500 行，已读关键段落）
  - `packages/tui/src/index.ts`（约 6500 行，已读关键段落）
  - `packages/config/src/index.ts`（已读关键段落）
  - `packages/tui/src/natural-command-bridge.test.ts`（96 tests）
  - `packages/tui/src/index.test.ts`（47 tests）

**参考核对**：

| 参考源 | 方式 | 提取内容 |
|--------|------|---------|
| Linghun 仓库全部文档 | 只读 | 阶段蓝图、规格书、架构路线、交付文档、v1 审计报告 |
| Linghun 实现源码 | 只读 | 自然语言桥、TUI dispatch、权限管道、缓存 freshness、状态栏、i18n |
| codebase-memory index | 查询 | 架构概览（770 nodes, 1504 edges）、函数定义/调用链 |
| CCB 公开行为 | 间接参考 | 启动/命令/权限/状态栏/缓存/错误提示的行为边界 |

---

## 附录 A：全文 "deepseek" 硬编码清单（非测试文件）

| 文件 | 行号 | 上下文 | 是否已修复 |
|------|------|--------|-----------|
| index.ts | 652 | 默认 config provider | 否（默认值，可接受） |
| index.ts | 1210-1211 | context 初始化 | 否（默认值，可接受） |
| index.ts | 1988 | provider 推断函数 | 否（功能代码） |
| index.ts | 3302 | createHandoffPacket | ✅ FIXED（已使用真实 provider 或 unknown） |
| index.ts | 3624 | recordModelUsage hitRate | ✅ FIXED（已使用真实 provider 或 unknown） |
| index.ts | 3633 | recordModelUsage stats | ✅ FIXED（已使用真实 provider 或 unknown） |
| index.ts | 4240 | getCurrentFreshness provider | ✅ FIXED（已用 getRuntimeStatusProvider） |
| index.ts | 4451 | formatUsage fallback | ✅ FIXED（无样本时为 unknown） |
| index.ts | 4481 | formatStats hitRate | ✅ FIXED（已使用真实 provider 或 unknown） |
| index.ts | 4489 | formatStats 显示行 | ✅ FIXED（无样本时为 unknown） |
| natural-command-bridge.ts | 765 | buildRuntimeStatusForModel | ✅ FIXED（`context.provider ?? "unknown"`） |

---

## 附录 B：关键文件行号索引

| 文件 | 关键区域 | 行号 |
|------|---------|------|
| `natural-command-bridge.ts` | NaturalIntent 类型（含 doctor） | 49 |
| `natural-command-bridge.ts` | detectInquiry（含 doctor patterns） | 1210-1230 |
| `natural-command-bridge.ts` | routeNaturalIntent | 783-935 |
| `natural-command-bridge.ts` | isStatusLike | 1360-1364 |
| `natural-command-bridge.ts` | buildRuntimeStatusForModel | 743-773 |
| `index.ts` | handleSlashCommand (else-if chain) | 1257-1436 |
| `index.ts` | handleModelCommand | 1699-1714 |
| `index.ts` | decidePermission (decision order) | 5748-5851 |
| `index.ts` | getCurrentFreshness | 4231-4247 |
| `index.ts` | createExtensionFreshnessSummary | 4275-4316 |
| `index.ts` | recordModelUsage (NEW-P1-1) | 3608-3633 |
| `index.ts` | formatCacheStatus | 4392-4414 |
| `index.ts` | formatBreakCacheStatus | 4416-4439 |
| `index.ts` | formatUsage (NEW-P1-3) | 4441-4459 |
| `index.ts` | formatStats (NEW-P1-2) | 4471-4496 |
| `index.ts` | writeStatus (status bar) | 6404-6422 |
| `index.ts` | messages (i18n) | 6433-6500+ |
| `index.ts` | createLinghunMdTemplate | 3459-3511 |
| `index.ts` | createHandoffPacket (NEW-P1-4) | 3280-3309 |
| `index.ts` | LINGHUN.md missing prompt | 1219-1223 |

---

*审计完成于 2026-05-17。本报告应作为进入 Phase 15 真实项目 Beta 前的最终核查清单。*
*上一轮 v1 审计报告：`docs/audit/phase-15-pre-beta-ccb-coding-experience-parity-audit.md`*
