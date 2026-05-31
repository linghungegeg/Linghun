# Linghun Phase 15 Pre-Beta Full Interaction Maturity Audit

> 审计类型：只读审计（未修改任何代码）
> 审计日期：2026-05-17
> 审计范围：基于 CCB 成熟交互链路，对 Linghun Phase 15 pre-Beta 做 16 维全面交互成熟度审计
> 审计依据：直接阅读全部 9 份必读文档、关键实现源码（natural-command-bridge.ts 1487 行、index.ts 6553+ 行、tools/index.ts 578 行、providers/index.ts 422 行 等）、codebase-memory 索引（780 nodes / 1527 edges）、前序审计报告（Full Parity Audit、CCB Interaction Parity Audit v2）
> 参考对象：F:\ccb-source（仅参考公开行为、交互边界、成熟产品体验和验收思路；未复制源码）

> 审计后裁决（2026-05-17 文档收口）：本报告原文保留只读审计发现，但执行口径以后续蓝图、规格书和 Phase 15 交付文档为准。Phase 15 Beta 继续暂停，必须一次性修复 P0-1 到 P0-6；P0-1 必须实现完整 `tool_use` / `tool_result` 工具协议和统一权限中枢，核心工具 schema 覆盖 `Read`、`Grep`、`Glob`、`Diff`、`Write`、`Edit`、`MultiEdit`、`Bash`、`Todo`。不得只做 Read/Grep/Glob 弱化版，不得用模型文本 hint 冒充真实工具调用。报告后文出现的“3 项 P0”“80-100 行”“只提示只读操作”等最小化建议，仅视为早期审计草案，不作为开工边界。

---

## Executive Summary

### 总体结论

**Linghun Phase 15 pre-Beta 的交互成熟度尚不足以支撑进入真实项目 Beta。存在 6 项 P0 阻塞项（其中 P0-1 为架构级缺口，P0-4 反幻觉系统装饰化、P0-5 模型流不可取消为新增发现）、7 项 P1 严重缺口、12 项 P2 体验差距。**

**P0 六项全览**：

| P0# | 发现 | 来源 |
|-----|------|------|
| P0-1 | Provider adapter 不支持 tool_use（模型降级为 Advisor） | 主审计 + Agent 2 |
| P0-2 | 文件智能指代缺失（零"最近文件"追踪） | 主审计 + Agent 1 |
| P0-3 | 新手零引导路径 | 主审计 |
| P0-4 | 证据从未注入模型上下文（反幻觉系统装饰化） | Agent 3 |
| P0-5 | 模型流不可取消（Ctrl+C 无效，AbortController 私有不暴露） | Agent 4 |
| P0-6 | 错误/未知命令/提示仅 zh-CN（en-US 环境崩坏） | Agent 3 |

**关键发现 P0-1（架构级）**：`packages/providers/src/index.ts` 的实际 `LinghunEvent` 类型只有 3 种事件，缺少 `tool_use`。且 `sendMessage()` 调用模型时不传 `tools` 参数——模型被当作纯文本聊天调用，无法使用任何工具。

**关键发现 P0-4（新发现）**：`sendMessage()` 的系统提示含有反幻觉指令（"涉及代码事实必须先有证据"），但 `context.evidence` 数组（含 Read/Grep/Glob 工具结果）**从未注入模型上下文**。模型看不到任何证据。反幻觉系统退化为仅依赖关键词的输入阻断器，对模型输出质量无实际影响。

**关键发现 P0-5（新发现）**：`sendMessage()` 中的 `AbortController` 是局部变量，不暴露给 REPL 主循环、SIGINT handler 或全局状态。长模型响应期间 TUI 完全冻结，用户只能杀进程。

CCB 的成熟不是在某个单一维度领先，而是在 **16 个交互维度的细节饱满度**上形成了整体"成品感"。Linghun 的 Natural Command Bridge 是正确的架构方向，但 6 项 P0 覆盖了"模型能否工作的核心闭环（P0-1）""反幻觉是否有效（P0-4）""交互是否可用（P0-5/P0-6）""文件操作是否流畅（P0-2）""新手能否上手（P0-3）"——每一项都会独立导致 Beta 验证数据失真。

### 推荐方案

**暂停 Phase 15 Beta，先执行最小交互硬化，再恢复 Beta。**

- **P0-1（tool_use）** 架构级修复：provider adapter ~80 行 + sendMessage ~100 行
- **P0-4（证据入模型）** ~40 行（sendMessage 注入证据摘要）
- **P0-5（取消模型流）** ~30 行（暴露 AbortController + SIGINT handler）
- **P0-6（i18n 错误）** ~50 行（formatError 双语 + 未知命令双语 + 提示双语）
- **P0-2（文件指代）** ~70 行
- **P0-3（新手引导）** ~20 行
- 总预估：~390 行新增/修改
- P1 记录为 Beta 中观察项，P2 放 Phase 15.5

---

## 1. CCB 交互链路总结：成熟点、可参考、不可吸收

### 1.1 CCB 的交互成熟点

基于 CCB 源码关键文件（commands.ts 841 行、Tool.ts、BuiltinStatusLine.tsx、CompactSummary.tsx、PermissionPrompt.tsx）的只读分析：

| 成熟点 | CCB 实现 | 成熟原因 |
|--------|---------|---------|
| 命令发现 | `/help` + `/command --help` + model prompt 中的命令摘要 | 三重发现路径 |
| 权限交互 | 18 种 PermissionRequest 组件 + PermissionPrompt（accept/reject/feedback/Tab 修改） | 每个工具类型有专用交互 |
| 工具流式输出 | Bash 实时 stdout/stderr 流式输出 + 退出码诊断 + 超时处理 | 实时反馈 |
| 状态栏密度 | model/context%/5h限额/7d限额/cost | 5-7 字段覆盖关键信息 |
| 上下文压缩 | "Conversation summarized" + ctrl+o 展开历史 + 压缩摘要可读 | 压缩可感知可回溯 |
| 文件指代 | 模型自由理解文件引用 + 自动 Read | 灵活但依赖模型能力 |
| 长任务 | Agent 后台 + 进度可查 + 可中断 | 生命周期完整 |
| 错误诊断 | API key 缺失专项提示 + 配置错误可操作建议 | 错误可行动 |
| 新手引导 | onboarding 提示 + feature 解释 + 首次使用引导 | 降低入门门槛 |

### 1.2 Linghun 应该参考的内容

| CCB 行为 | 参考方式 | 吸收到 Linghun |
|---------|---------|---------------|
| 权限反馈粒度（accept/reject/feedback） | 交互工程化参考 | Phase 15.5 做文本行增强版 |
| 状态栏 context 使用率 | 信息密度参考 | 标注来源后显示 |
| Bash 流式输出 | 工具体验参考 | 改为流式输出 |
| 文件智能指代 | 行为参考 | NCB 增加文件指代匹配 |
| 新手引导 | 体验参考 | 首次进入项目时提示 `/help` 和常用命令 |

### 1.3 明确不可吸收的内容

| 内容 | 原因 |
|------|------|
| CCB 的 PermissionPrompt 完整复刻 | 属于 UI 实现复制，违反 clean rewrite |
| CCB 的 cost 状态栏 | Linghun 设计已明确 cost 仅进入 `/usage`/`/stats` |
| CCB 的 analytics 埋点 | Linghun 不做任何遥测 |
| CCB 的 React/Ink 组件源码 | 源码复制违反 clean rewrite |
| CCB 的 feature flag 系统 | Linghun 已有更简单直接的 LINGHUN_FEATURE_* |

---

## 2. Linghun 当前已有能力

基于已读取全量关键源码的总结：

| 维度 | 已有能力 | 证据 |
|------|---------|------|
| 自然语言→命令 | NCB：44 capabilities + 6 inquiry types + 6 action types | `natural-command-bridge.ts` 1487 行 |
| 命令分发 | 35 路 else-if 链覆盖 44 个 slash command | `index.ts` lines 1257-1440 |
| 权限管道 | 8 步决策顺序（hardDeny→plan→userRules→dontAsk→acceptEdits→bypass→auto→default） | `index.ts` lines 5788-5891 |
| Plan 只读保护 | Plan check 在 user rules 之前 | `index.ts` line 5811 |
| Start Gate | 本地裁决 + 90s 过期 + exact confirmation + 高风险阻断 | `natural-command-bridge.ts` lines 1030-1130 |
| bypass/auto gating | LINGHUN_ENABLE_BYPASS=1 / LINGHUN_ENABLE_AUTO_PERMISSION=1 显式 opt-in | 环境变量开关 |
| 内置工具 | 9 个（Read/Write/Edit/MultiEdit/Grep/Glob/Bash/Todo/Diff） | `tools/index.ts` 578 行 |
| 缓存诊断 | 11 维度 freshness + break-cache + changedKeys | `index.ts` lines 4236-4468 |
| 状态栏 | 7 字段（session/model/mode/bg/cache/index/gate） | `index.ts` lines 6444-6461 |
| 后台任务 | BackgroundTaskState + cancel/interrupt + logPath | `index.ts` lines 2379-2868 |
| Evidence 系统 | EvidenceRecord + evidence_record 事件 + evidenceBlocked 阻断 | `index.ts` lines 3886-3895, 6326-6351 |
| i18n | 15 条消息表中英双语 + 全 handler 内联三元 | `index.ts` lines 6471-6529 |
| 项目规则读取 | NCB routing "项目规则/LINGHUN.md" → `/read LINGHUN.md` | `natural-command-bridge.ts` lines 851-862, 1371 |
| Handoff | structured handoff packet（phase/next/forbidden/evidence/validation） | `index.ts` lines 3280-3359 |
| Agent 生命周期 | explorer/worker/verifier/planner + transcript + cancel | `index.ts` lines 2379-2702 |
| MCP 稳定化 | description 去 timestamp/UUID + key 稳定排序 | Phase 10 已交付 |
| Catalog 漂移检测 | validateCommandCapabilityCoverage() + drift test | `natural-command-bridge.ts` lines 716-740 |

---

## 3. 缺口矩阵（P0 / P1 / P2）

### 3.1 P0 — Phase 15 Beta 阻塞项

这些缺口会使 Beta 验证数据失真，必须先修复才能进入 Beta。

| # | 缺口 | 影响 | 文件证据 | 最小修复建议 | Focused Test 建议 |
|---|------|------|---------|-------------|------------------|
| **P0-1** | **Provider adapter 不支持 tool_use 事件（架构级缺口）** | **关键发现**：`packages/providers/src/index.ts` 定义的 `LinghunEvent` 只有 3 种事件（`assistant_text_delta`、`usage`、`error`），没有 `tool_use`/`tool_result`。即使模型支持 function calling，Linghun 也无法接收工具调用。模型从"编码 Agent"降级为"编码 Advisor"——只能产出文本计划，不能主动使用工具。用户必须在模型文本输出和 slash command 之间来回翻译。这是**架构级缺口**，不是交互手感问题。 | `providers/index.ts` lines 15-18：`LinghunEvent` 类型定义只有 3 个变体。对比蓝图 Section 9.2 定义的计划类型（8 个变体含 `tool_use`/`tool_result`），实际实现缺失 5 种事件。Grep 确认：`packages/` 全目录 `tool_use` 零匹配。`sendMessage()` lines 5354-5372 确认只处理 3 种事件。 | **最小可行修复**：在 provider adapter 中补齐 `tool_use` 事件转换（DeepSeek/OpenAI 兼容 API 均支持 function calling）。`sendMessage()` 中增加 tool_use 事件处理：收到 tool_use → decidePermission() → 执行工具 → 结果回灌模型（新请求）。第一期只支持只读工具（Read/Glob/Grep），降低安全风险。**预估工作量**：provider adapter ~80 行 + sendMessage ~100 行。 | TUI smoke：输入"帮我找一下所有 .ts 文件"，模型应主动发起 Glob 工具调用而非仅文本建议。确认 Glob 结果回灌后模型能基于结果继续推理。 |
| **P0-2** | **文件智能指代缺失** | 用户说"读一下那个配置文件"、"打开刚才改的文件"时，NCB 无法解析指代。Grep/Glob 结果返回多个文件时，没有"最近提到文件"追踪来消歧义。"找不到文件"只有通用错误，无候选推荐。关键影响：Beta 中最频繁的"读文件"操作会反复摩擦。 | `natural-command-bridge.ts`：仅对 `项目规则/本仓库规则/linghun.md/project rules` 有特殊 scoring（line 1371, 1501），无通用文件指代解析。`index.ts`：无 `recentlyMentionedFiles` 字段，无 `resolveFileReference()` 函数。Grep 确认：`最近.*文件|recently.*mentioned|unique.*match|multiple.*match|找不到|file.*reference` 零匹配。 | 在 TuiContext 中新增 `recentlyMentionedFiles: string[]`（最多 10 条），每次 Read/Write/Edit/Grep/Glob 操作后追加。NCB 增加 `resolveFileReference(normalized)` 函数：当模型输出或用户输入含模糊文件指代时，用最近文件列表做候选匹配。 | TUI smoke：先 `/read package.json`，再输入"再看一下刚才那个文件"，确认 NCB 能映射。多匹配场景：输入"读一下 tsconfig"，如果项目有多个 tsconfig*.json，列出候选。 |
| **P0-3** | **新手无引导路径** | 不会 slash command 的用户进入 REPL 后看到 `>` 提示符，无任何引导。初次进入项目无提示建立索引，无提示读取项目规则，无提示常用命令。Beta 选真实老项目测试时，如果是新用户操作，会因为不知道命令而无法完成开发闭环。 | Grep 确认：`新手|novice|onboarding|wizard|首次|向导|first.time` 零匹配。`index.ts` 无任何首次使用检测或引导逻辑。`sendMessage()` lines 5314-5386 直接进入模型请求，无首次提示。 | 在 `ensureSession()` 或首次 `sendMessage()` 前增加轻量首次提示（仅在项目无 `.linghun/` 目录或首次会话时）：`首次使用提示：可以直接说"帮我看看项目结构""帮我建立索引""项目规则是什么"。输入 /help 查看所有命令。` 不增加完整向导，只是 2-3 行轻提示。 | TUI smoke：在新项目目录启动 linghun，确认首次进入时显示引导提示。已有 `.linghun/` 的项目不重复提示。 |
| **P0-4** | **证据从未注入模型上下文（反幻觉系统装饰化）** | **Agent 3 关键发现**：`sendMessage()` 的系统提示含反幻觉指令（"涉及代码事实必须先有证据"），但 `context.evidence` 数组（含 Read/Grep/Glob/Verify 等工具结果）**从未注入模型上下文**。Evidence Gate (`checkEvidenceGate`) 只在输入端基于关键词阻断，但模型实际收到的系统提示中只有 `RuntimeStatusForModel`（记忆/索引/缓存状态）和 `CommandCapabilitySummary`（命令目录），**没有文件内容、工具输出或 evidence_record 事件**。反幻觉系统退化为仅依赖关键词的输入阻断器，对模型输出质量无实际影响。 | `index.ts` lines 5342-5349：系统提示只注入 `RuntimeStatusForModel` 和 `CommandCapabilitySummary`，不注入 `context.evidence`。`checkEvidenceGate()` line 6326：仅检查 `context.evidence.length > 0`，但不把证据传给模型。`buildRuntimeStatusForModel()` line 751：只含 memory/index/cache/model/permissionMode，不含 evidence。Grep 确认：证据数组只被推入（`context.evidence.unshift()`）和持久化（`appendEvent`），不被注入系统提示。 | 在 `sendMessage()` 的 system prompt 末尾注入 `EvidenceSummary`：将 `context.evidence.slice(0, 5)` 的 id/kind/source/summary 以短 JSON 注入（<500 字符）。模型可基于真实工具结果做事实断言。 | TUI smoke：先执行 `/grep TODO`，再让模型回答"项目里有 TODO 吗"，确认模型引用了 grep 结果而非猜测。 |
| **P0-5** | **模型流不可取消（TUI 冻结）** | **Agent 4 关键发现**：`sendMessage()` 中的 `AbortController`（line 5337）是局部变量，不暴露给 REPL 主循环、SIGINT handler 或全局状态。长模型响应期间 TUI 完全冻结——Ctrl+C 无效、`/interrupt` 无法接收（因为输入循环阻塞在 `await sendMessage()`）。用户只能 kill 整个进程。 | `index.ts` lines 5337：`const controller = new AbortController()` 局部创建。line 5354：`gateway.stream("deepseek", ..., controller.signal)` 使用信号。`runTui()` line 1226：`while` 循环中 `await` sendMessage，阻塞所有输入处理。无 SIGINT listener。 | 将 `AbortController` 提升到 `TuiContext` 或模块级引用。在 REPL 启动时注册 SIGINT handler 调用 `controller.abort()`。`sendMessage()` 的 while 循环改为 race 模式（支持中断信号）。 | TUI smoke：启动一次到模型的请求，在模型流式输出中按 Ctrl+C，确认流被中断且 TUI 恢复提示符。 |
| **P0-6** | **错误/未知命令/提示仅 zh-CN（en-US 环境崩坏）** | **Agent 3 关键发现**：`formatError()`（line 6571）始终输出中文：`错误：xxx`。未知命令回退（line 1438）始终中文：`未知命令：xxx。输入 /help 查看可用命令。`。TUI 启动失败（line 1251）始终中文：`TUI 运行失败。`。Light hints（lines 4580-4618）全部中文。LINGHUN.md 缺失提示（line 1222）仅中文。en-US 环境下用户看到混合语言的操作性消息，严重破坏信任。 | `formatError()` line 6571-6579：三项分支全中文。line 1438：未知命令只有 zh-CN。line 1222：LINGHUN.md 提示仅 zh-CN。line 1251：TUI 失败仅 zh-CN。`writeLightHints()` lines 4580-4618：全部中文。24 键 messages 对象中 zh-CN/en-US 各有完整翻译，但约 12 处关键输出绕过 `t()` 系统。 | 将 `formatError()` 改为接收 `language` 参数，三项分支双语。未知命令改为 `t(context, "unknownCommand", {command})`。TUI 启动失败改用 `t()`。Light hints 改用 `t()` 键。LINGHUN.md 提示改用 `t()`。**范围**：~50 行修改，不新增 i18n 框架。 | TUI smoke：`LINGHUN_LANGUAGE=en-US` 启动，执行不存在的命令如 `/foo`，确认提示为英文 "Unknown command: /foo"。触发错误（如读取不存在的文件），确认 formatError 输出英文。 |

### 3.2 P1 — 严重缺口（不阻塞 Beta 但必须在 Phase 15.5 修复）

| # | 缺口 | 影响 | 文件证据 | 最小修复建议 |
|---|------|------|---------|-------------|
| **P1-1** | **模型回复中的工具意图未被捕获** | 模型回复 "I'll read the file first" 后，Linghun 需要用户再次手动输入 `/read xxx`。重复输入降低效率。这是 P0-1 的延伸：P0-1 做提示网关，P1-1 做自动执行。 | 同 P0-1。`sendMessage()` 不解析模型文本中的工具调用。CCB 也依赖模型的 tool_use event（非文本解析），但 Linghun 当前 provider adapter 是否完整转换 tool_use 事件值得验证。 | 核实 provider adapter 是否已支持 tool_use 事件流。若已支持，确保 tool_use → 本地工具执行路径畅通。若未支持，按 Phase 15.5 补齐。 |
| **P1-2** | **Bash 无流式输出** | Bash 执行时用户看不到进度，只能等全部完成后看到结果。长编译、npm install 等场景体验很差。 | `tools/index.ts` lines 531-553：`runShell()` 使用 `child.stdout.on("data", ...)` 收集所有输出到 `output` 字符串，`close` 事件后才 resolve。无 `yield`/`AsyncGenerator` 流式输出。 | 将 `bashTool()` 改为 `AsyncGenerator<ToolEvent>`（如 `call()` 接口已支持），每次 stdout/stderr chunk 时 yield progress event。 |
| **P1-3** | **i18n 覆盖不全（内联三元 ≠ 集中管理）** | 虽然 15 条消息表中英双语完整，但 handler 输出大量使用内联三元。新增 handler 时容易漏 i18n，且修改文案需 grep 所有三元位置。zh-CN 环境可能因新 handler 硬编码出现英文。 | `index.ts` 全文件：`context.language === "en-US" ? "..." : "..."` 出现 40+ 处。`getMessage(key)` 机制仅用于 15 条 message key，大量输出绕过消息表。 | 将所有面向用户的输出文案迁移到 messages 对象，handler 中只调用 `t(context, key)`。Phase 15.5 批量迁移。 |
| **P1-4** | **无 context 使用率显示** | 状态栏不显示 context 使用率，用户不知道当前上下文有多满、何时会触发压缩。长对话场景下可能突然发现上下文满了。 | `writeStatus()` lines 6444-6461：7 字段中无 context 使用率。CCB 状态栏显示 `contextUsedPct%` + token 数。 | 在状态栏增加 context 使用率（如 provider 支持 input token 计数）。标注来源（reported/estimated/unknown）。 |
| **P1-5** | **无 rate limit 提示** | 状态栏不显示 rate limit 倒计时。频繁请求时可能突然遇到 429。 | `writeStatus()` 不包含 rate limit。CCB 显示 5h/7d 倒计时。 | 在 usage 记录中追踪 rate limit 信息，状态栏显示可用的最短倒计时。来源标记。 |
| **P1-6** | **NCB scoring 算法补丁化风险** | `scoreCapability()` 中有针对特定 capability 的手工 boost（model +4, mode +5, grep +5 等），新增 capability 时需手工加 boost，长期会变成补丁堆。 | `natural-command-bridge.ts` lines 1306-1357：`scoreCapability()` 含大量 `if (capability.id === "xxx") score += N` 逻辑。 | 在 Phase 15.5 将 per-capability boost 收口到 catalog 字段中（如 `intentWeight`），让 scoring 公式化而非手工 if/else。 |
| **P1-7** | **else-if 链持续膨胀 (35 路)** | `handleSlashCommand()` 的 35 路 else-if 链在新增 command 时线性增长。当前 6553 行的 index.ts 有持续膨胀风险。 | `index.ts` lines 1257-1440：35 路 `if (command === "/xxx")` 链。与 `SLASH_COMMAND_REGISTRY` 独立维护。 | Phase 15.5 做 registry map 化：`Map<slash, handler>` 从 `SLASH_COMMAND_REGISTRY` 派生，消除 else-if 链。 |

### 3.3 P2 — Beta 后修补

| # | 缺口 | 说明 | 建议阶段 |
|---|------|------|---------|
| P2-1 | 无 `--verbose` CLI flag 和 `/debug` 命令 | 调试困难，出问题时用户看不到内部状态 | Phase 15.5 |
| P2-2 | Grep/Glob 无进度反馈 | 大项目搜索时无进度提示 | Phase 15.5 |
| P2-3 | 无长任务心跳 | 无法区分"仍在运行"和"卡死" | Phase 15.5 |
| P2-4 | Plan approval 无三态交互（accept+manual/accept+auto/reject+feedback） | 当前只有确认/拒绝 | Phase 15.5 |
| P2-5 | Provider 连接失败无专项分类 | 通用 catch，错误信息不够可操作 | Phase 15.5 |
| P2-6 | 无 `web_source` evidence / FreshnessGate | 联网取证未闭环 | Phase 15.5 |
| P2-7 | 自然语言无法表达"读文件"通用形式 | "读一下 app.ts" 不会路由到 `/read app.ts` | Phase 15.5 |
| P2-8 | 多匹配文件无消歧义 | Grep 返回多文件时无智能排序或候选推荐 | Phase 15.5 |

---

## 4. 逐维度详细分析

### 4.1 普通自然语言 → 动作/状态/只读工具/模型对话

**已有能力**：
- NCB 支持 44 个 capability 的自然语言映射
- 6 种 inquiry 类型：status/doctor/usage/risk/howto/execute
- 6 种 action：answer/execute_readonly/start_gate/permission_pipeline/ask_clarify/model
- 中英文等价路径：同一 capability 中英文走同一 risk handler

**缺口**：
- 自然语言"读文件"通用形式缺失（仅项目规则有特殊映射）
- "打开刚才的文件"等指代消解缺失（P0-2）
- 模型计划话术不被转换（P0-1）
- NCB scoring 的 per-capability boost 有补丁化风险（P1-6）

**结论**：NCB 架构完整，但覆盖范围主要在"状态查询/动作启动"，日常最频繁的"读文件"操作覆盖不足。

### 4.2 Slash Command 发现、Help、用法解释

**已有能力**：
- `/help` 基于 Catalog 展示中英文命令列表
- Catalog 每项含 title/description/whenToUse/risk（中英双语）
- `CommandCapabilitySummary` 注入模型 prompt（<1200 字符）

**缺口**：
- 无 `/command --help` 单命令详解（只能通过 NCB 自然语言问"xx 怎么用"）
- 命令发现依赖用户主动输入 `/help`，无被动提示

**结论**：命令发现基础可用，但缺少单命令详解入口。

### 4.3 文件读取、搜索、指代

**已有能力**：
- `/read <path>`、`/grep <pattern>`、`/glob <pattern>` 命令完整
- 项目规则文件读取有特殊 NCB 路径

**缺口**：
- **P0-2**：无文件智能指代（"那个配置文件"、"刚才的文件"）
- **P2-7**：自然语言无法表达通用"读文件"（"读一下 app.ts" 不进 `/read`）
- **P2-8**：多匹配文件无消歧义
- 无"找不到文件"的智能候选推荐

**结论**：文件操作是最高频交互，当前指代能力是最大交互摩擦点。

### 4.4 项目规则 LINGHUN.md / Memory / Handoff / Resume

**已有能力**：
- NCB "项目规则是什么"/"读一下 LINGHUN.md" → `/read LINGHUN.md`
- `/memory init` 生成中文模板
- `/memory` 查看记忆状态
- `/sessions resume <id>` 恢复会话 + handoff 验证
- 缺规则时有 hint 提示

**缺口**：
- 项目规则不存在时模型只说"可运行 `/memory init`"，但不会主动读取其他可用规则文件（AGENTS.md, CLAUDE.md）
- Memory 管理和候选记忆确认路径完整，但"自动记忆是否打开"的查询只返回状态

**结论**：项目规则入口已成品化，Memory/Handoff/Resume 路径完整。

### 4.5 只读工具：自动执行 vs 确认 vs 权限管道

**已有能力**：
- `decidePermission()` 8 步决策顺序正确
- Plan 模式强制只读（在 user rules 之前检查）
- default 模式只读工具自动 allow
- bypass/auto 有显式 opt-in 环境变量

**缺口**：
- `dontAsk` 模式写入工具 deny，但无主动提示用户切换模式的建议
- `auto` 模式分类器不可用时 deny，但无明确的"为什么分类器不可用"的诊断

**结论**：权限决策链可审计、正确，但错误反馈信息密度可增强。

### 4.6 模型计划话术 → 本地工具执行（P0-1，阻塞 Beta）

**已有能力**：
- 无。这是当前最大的架构缺口。

**关键发现：Provider adapter 不支持 tool_use 事件**

`packages/providers/src/index.ts` lines 15-18 定义的实际 `LinghunEvent` 类型：
```typescript
export type LinghunEvent =
  | { type: "assistant_text_delta"; id: string; text: string }
  | { type: "usage"; usage: ModelUsage }
  | { type: "error"; error: LinghunError };
```

对比蓝图/架构文档中计划的 `LinghunEvent`（含 `tool_use`、`tool_result`、`message_start`、`message_stop`、`thinking_delta` 共 8 种事件），**实际实现只有 3 种事件**——`tool_use` 和 `tool_result` 完全未实现。

这意味着：
- 即使模型（如 DeepSeek）支持 function calling 并返回 tool_use，Linghun 的 provider adapter **无法产生** tool_use 事件
- `sendMessage()` lines 5354-5372 只处理了 `assistant_text_delta`、`usage`、`error` 三种事件
- 模型无法通过 tool_use 主动使用任何工具
- 模型只能产出文本——当模型说 "I'll first read the package.json" 时，这只是文本描述，无法触发实际的 Read 操作

**这是从"编码 Agent"降级为"编码 Advisor"的架构缺口。**

- CCB：模型发出 `tool_use` 事件 → 权限管道 → 执行工具 → 结果回灌模型 → 模型继续推理
- Linghun 当前：模型输出文本建议 → 用户必须手动输入 slash command → 人工充当工具执行器

**结论**：P0-1，阻塞 Beta。这不是"交互手感"问题，而是"模型能否主动使用工具"的架构级缺口。在修复之前，所有编码任务都需要用户在模型和命令输入之间来回翻译，客观验证编码能力的目标无法实现。

### 4.7 Start Gate、权限确认、拒绝反馈

**已有能力**：
- Start Gate 含 90s 过期、exact confirmation（高风险必须输入精确命令）
- pending gate 在状态栏显示
- 格式化为 human-first（不暴露 gateId/expiresAt/raw flags）
- bypass/auto 显式 opt-in

**缺口**：
- **P1**: 无"accept with note" / "reject with reason" 反馈粒度（CCB 的 PermissionPrompt 支持）
- Plan approval 只有确认/拒绝，无三态（accept+manual/accept+auto/reject+feedback）
- 提权说明（escalation explanation）依赖 `/help`，不在 gate 内联展示

**结论**：安全边界扎实，但交互粒度可增强（Phase 15.5）。

### 4.8 Plan / AcceptEdits / Auto / Bypass 边界

**已有能力**：
- Plan 只读保护（在 user rules 之前）
- AcceptEdits 低风险工作区编辑自动通过
- Auto 需要 LINGHUN_ENABLE_AUTO_PERMISSION=1
- Bypass 需要 LINGHUN_ENABLE_BYPASS=1
- bypass 下硬拒绝仍生效（.git/.ssh/密钥/系统目录）

**缺口**：
- 无 Plan→acceptEdits→auto→bypass 的渐进说明
- 模式切换时无"当前模式能做什么/不能做什么"的总结

**结论**：安全边界正确，交互说明可增强。

### 4.9 Bash / Read / Write / Edit / MultiEdit / Grep / Glob / Diff / Verify / Review 手感

**已有能力**：
- 9 个内置工具完整实现
- Bash 有 timeout、exit code、log 文件、预览截断
- Diff 自动摘要 changedFiles/riskyFiles
- 工具并行规则（只读并行、写入串行）

**缺口**：
- **P1-2**：Bash 无流式输出（collect all then return）
- Grep/Glob 无进度反馈（大项目搜索无感知）
- 无 Diff 预览 before Write/Edit（仅 preflight 文本提示）
- Verify/Review 存在但输出格式偏结构化

**结论**：工具功能完整，但流式反馈缺失影响长操作体验。

### 4.10 长任务进度、心跳、日志路径、取消、恢复、后台

**已有能力**：
- BackgroundTaskState（running/paused/completed/failed/cancelled）
- `/background` 查看一行摘要
- `/agents cancel <id>` 中断
- `/interrupt` 标记取消
- logPath 日志文件路径

**缺口**：
- **P2-3**：无心跳机制（无法区分"仍在运行"和"卡死"）
- 无后台任务自动清理
- 长任务无进度百分比（只有 currentStep 文本）

**结论**：后台任务生命周期管理完整，心跳和进度量化是 P2。

### 4.11 状态栏、Footer、Hint、错误提示、Doctor、下一步建议

**已有能力**：
- 状态栏 7 字段（session/model/mode/bg/cache/index/gate）
- light hints（context-long 等）
- Doctor 命令：`/model route doctor`、`/plugins doctor`、`/doctor hooks`、`/mcp doctor`
- 错误时有 `evidenceBlocked` / `claimNeedsDisclaimer` 提示

**缺口**：
- **P1-4**：无 context 使用率
- **P1-5**：无 rate limit 提示
- **P2-1**：无 verbose/debug 输出分层
- 错误提示有时偏通用（顶层 catch 给的错误不够可操作）
- 无"下一步建议"（如：完成了 bug 修复后建议运行 `/verify`）

**结论**：状态栏基础可用，但信息密度和错误可操作性需增强。

### 4.12 Compact / Cache / Index / Memory / Model / Provider / Role Route 状态查询

**已有能力**：
- Cache：11 维度 freshness + break-cache + `/cache status/log` + `/usage` + `/stats`
- Index：`/index status/search/architecture` + staleHint
- Memory：`/memory` + `/memory storage` + candidate/accept/delete
- Model/Provider：`/model` + `/model route` + `/model route doctor` + `/model route set`

**缺口**：
- Compact 状态仅作为 cache freshness 的 1 个 hash 维度，无独立查询命令
- Role route 的预算信息不够详细

**结论**：状态查询覆盖较完整。

### 4.13 i18n：zh-CN / en-US 同等成熟度

**已有能力**：
- 15 条集中消息表中英双语
- NCB catalog 每项中英双语
- 全 handler 输出含语言分支

**缺口**：
- **P1-3**：大量内联三元而非集中管理，新增 handler 易漏 i18n
- 某些 handler 的部分子字符串硬编码为中文（如 `"agent ${agent.id} 已在后台运行"` 无 en-US fallback）
- 无 i18n coverage test

**结论**：功能上双语可用，但工程化不足，长尾风险。

### 4.14 新手路径：不会 slash command 的用户能否完成真实开发

**已有能力**：
- 自然语言可查询状态和启动动作
- `/help` 展示所有命令

**缺口**：
- **P0-3**：零新手引导。用户进入 `>` REPL 后无任何提示
- 无首次启动向导（蓝图有设计但未实现）
- 无被动命令发现（如：在合适时机提示"你可以用 /xxx 来做这个"）
- 无 `/features` 实现（蓝图有设计但未实现）

**结论**：P0 阻塞项。新手进入 Linghun 后会不知所措。

### 4.15 防幻觉：本地证据、索引、文件、Web Evidence、Tool Result

**已有能力**：
- EvidenceRecord 系统 + evidence_record 事件持久化
- `checkEvidenceGate()` 在 sendMessage 前检查
- `evidenceBlocked` 消息阻断无证据的代码事实断言
- system prompt 含 "Use evidence before code claims; avoid unverified claims"
- handoff packet 携带 evidenceRefs

**缺口**：
- **P2-6**：无 `web_source` evidence 类型（联网取证未闭环）
- 无 FreshnessGate（实时信息的时效性检查）
- `checkEvidenceGate()` 实现需要核实（`index.ts` line 5323 调用但判断逻辑需确认）
- Tool result 回灌模型依赖于 provider adapter 的 tool_result 事件处理（P0-1 关联）

**结论**：证据系统框架存在，但联网取证和时效性检查缺失。

### 4.16 补丁化、复杂化、绕过权限、过度工程化风险

**已有风险**：

| 风险 | 等级 | 证据 |
|------|------|------|
| NCB scoring 算法补丁化 | 中 | `scoreCapability()` 中 per-capability boost（model +4, mode +5, grep +5） |
| index.ts 膨胀 | 高 | 6553+ 行，35 路 else-if，持续增长 |
| else-if 链与 Catalog/Registry 三处独立 | 中 | handleSlashCommand + SLASH_COMMAND_REGISTRY + COMMAND_CAPABILITY_DATA 三处需同步 |
| 权限绕过风险 | 低 | hardDeny 在第一步，bypass 需显式环境变量 opt-in |
| 过度工程化风险 | 低 | NCB 1487 行属于合理范围；handoff packet 结构化是正确方向 |

**结论**：权限安全边界扎实。主要风险在代码组织（index.ts 膨胀、else-if 链、scoring 补丁化），需 Phase 15.5 registry map 化解决。

---

## 5. 哪些缺口阻塞 Phase 15 Beta

| P0# | 缺口 | 阻塞原因 |
|-----|------|---------|
| P0-1 | 模型计划话术→本地工具执行 | Beta 验证编码能力时，用户会反复遇到模型"说要做但没做"的情况。交互失真直接污染编码能力、缓存命中率、会话恢复等所有验证目标。 |
| P0-2 | 文件智能指代缺失 | Beta 中最频繁的"读文件/搜索文件"操作会因为指代失败而反复摩擦。用户被迫学习精确路径，测试退化为人肉命令输入。 |
| P0-3 | 新手无引导路径 | 真实项目中如果让不熟悉 Linghun 的用户测试，会因为不知道任何命令而无法完成开发闭环。即使熟悉 CCB 的用户也不知道 Linghun 有哪些命令。 |

**判定**：存在 3 项 P0 阻塞项，**Phase 15 Beta 应暂停**，先完成最小交互硬化。

---

## 6. 哪些缺口放 Phase 15.5

| 级别 | 数量 | 缺口 |
|------|------|------|
| P1 | 7 | 模型 tool_use 事件集成、Bash 流式输出、i18n 集中化、context 使用率、rate limit、NCB scoring 泛化、else-if→registry map |
| P2 | 8 | verbose/debug、Grep/Glob 进度、长任务心跳、Plan 三态、Provider error 分类、web_source evidence、通用文件读取 NL、多匹配消歧义 |

---

## 7. 最小修复建议

### 7.1 P0 修复方案（预计 3-5 天）

#### P0-1：模型计划话术→执行提示

**最小修改**：在 `sendMessage()` 的 `assistant_text_delta` 输出时，增加轻量文本模式匹配。
- 检测模型输出中的工具调用建议（`/read`, `/glob`, `/grep`, `/bash`, `Read`, `Grep`, `Glob` + 路径/模式）
- 在模型回复末尾追加 `<hint>` 提示行（不自动执行）：
  ```
  [hint] 模型建议执行以下只读操作：/glob "**/*.ts"，是否执行？直接输入 /glob **/*.ts 来执行。
  ```
- 仅提示只读工具（Read/Glob/Grep），不提示写入工具
- **范围**：`index.ts` sendMessage() ~30 行新增

#### P0-2：文件智能指代

**最小修改**：
- 在 `TuiContext` 中新增 `recentlyMentionedFiles: string[]`（最多 10 条）
- 在 `handleToolCommand()` 每次执行 Read/Write/Edit/Grep/Glob 后更新列表
- 在 NCB 路由中增加 `resolveFileReference(normalized, recentFiles)` 函数
- **范围**：`index.ts` ~40 行新增，`natural-command-bridge.ts` ~30 行新增

#### P0-3：新手引导

**最小修改**：
- 在 `ensureSession()` 检测项目是否首次使用 Linghun（无 `.linghun/` 目录）
- 输出 3-5 行轻提示：
  ```
  首次使用提示：
  - 直接说"帮我看看项目结构"或输入 /help 查看命令
  - 说"帮我建立索引"来加速代码搜索
  - 说"项目规则是什么"来查看当前规则
  ```
- **范围**：`index.ts` ensureSession() ~20 行新增

### 7.2 P1 修复方案（Phase 15.5）

详见 `docs/audit/phase-15-pre-beta-ccb-full-parity-audit.md` Section 9.2。

### 7.3 P2 修复方案（Phase 15.5）

详见 `docs/audit/phase-15-pre-beta-ccb-full-parity-audit.md` Section 5.3。

---

## 8. 明确不该做的事

| 不该做 | 原因 |
|--------|------|
| NLP/ML 语义理解升级 NCB | 当前 token+alias+boost 算法对 Beta 足够；引入 ML 增加复杂度且难审计 |
| 模型辅助意图理解 | 违背"本地裁决优先"的 NCB 设计原则 |
| 完整 registry/dispatch 大重构 | Beta 前不宜大动核心 dispatch 路径 |
| CCB PermissionPrompt 完整复刻 | 属于 clean rewrite 禁止的"复制 UI 实现" |
| 完整新手向导（首次启动 8 步配置） | P0-3 只需 3-5 行轻提示，完整向导放 Phase 15.5 |
| 文件指代用 NLP/ML 解析 | 最近文件列表 + 简单匹配足够；ML 过度工程化 |
| 自动执行模型建议的工具 | 安全底线：模型建议永远只给提示，不自动执行 |
| 状态栏增加 cost 显示 | 设计已明确 cost 仅进入 `/usage`/`/stats` |
| 修复 P1/P2 项 | P0 修复是最小必要范围，P1/P2 放 Phase 15.5 |

---

## 9. 最终结论

### 9.1 Phase 15 Beta 是否仍应暂停

**是，应暂停。**

在 3 项 P0 阻塞项修复之前，进入真实项目 Beta 会产生失真验证数据：
- 用户会被迫学习精确命令（而非自然语言交互），测试退化为"命令壳"验证
- 模型输出"我会先读文件再修改"但什么都不做，测试者会困惑
- 新用户不知道任何命令，会卡在第一个交互

这不是"功能不够"的问题，而是"交互入口太窄"的问题——底座（NCB、权限管道、缓存诊断、工具系统）都是可工作的，但用户触碰这些底座的门太窄。

### 9.2 恢复 Beta 的闸门

P0 全部修复 + 每项 focused test 通过后，即可恢复 Phase 15 Beta。不需要等 P1/P2。最小修复量约 80-100 行新增代码，不涉及架构变更。

### 9.3 后续路径

1. **当前 → 修复 P0-1, P0-2, P0-3**（预计 3-5 天）
2. **P0 修复完成 → Phase 15 真实项目 Beta**
3. **Beta 完成 → Phase 15.5 修复 P1/P2 + 双模型交叉审查**

---

## 10. 审计边界声明

- **只读审查**，未修改任何代码
- 未进入 Phase 15 真实项目 Beta、Phase 15.5 或 Phase 16+
- CCB / Claude Code 仅参考公开行为、交互边界、UX 模式和验收思路
- 未复制任何 CCB、OpenCode、Hermes 或其他第三方项目的源码实现、内部 API、反编译产物或专有实现
- 审查基于直接阅读 Linghun 仓库全部 9 份必读文档、关键实现源码、CCB 源码关键文件、codebase-memory 索引（780 nodes / 1527 edges）、前序审计报告

### 参考源核对

| 参考源 | 方式 | 提取内容 |
|--------|------|---------|
| Linghun 全部 9 份必读文档 | 只读 | 阶段蓝图、规格书、架构路线、Phase 15 preflight 交付文档、审计报告 |
| `natural-command-bridge.ts` (1487 行) | 只读 | NCB 全链路：catalog、router、scoring、intent 分派、Start Gate |
| `index.ts` (6553+ 行) | 只读 | TUI 主循环、sendMessage、权限管道、状态栏、i18n、background/agent |
| `tools/index.ts` (578 行) | 只读 | 9 个工具实现、Bash shell、权限 spec |
| `providers/index.ts` (422 行) | 只读 | Provider adapter、ModelGateway、事件转换 |
| CCB 源码（commands.ts, Tool.ts, BuiltinStatusLine.tsx, CompactSummary.tsx, PermissionPrompt.tsx） | 只读 | 命令系统架构、工具接口、权限交互模式、状态栏字段、上下文压缩 |
| codebase-memory index (780 nodes / 1527 edges) | 查询 | 架构概览、调用链追踪 |
| 前序审计报告 | 只读 | P0/P1/P2 历史、修复验证状态 |

---

*审计完成于 2026-05-17。本报告是 Phase 15 pre-Beta 最终交互成熟度审计，整合了 16 维交互评估、CCB 链路对比、缺口矩阵和最小修复建议。*
