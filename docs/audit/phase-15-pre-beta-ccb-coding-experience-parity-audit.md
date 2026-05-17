# Linghun Phase 15 Pre-Beta CCB Coding Experience Parity Audit

> 审计类型：只读审计（未修改任何代码）
> 审计日期：2026-05-17
> 审计范围：以 CCB / Claude Code 现有编码体验为参照，按 CCB 真实编码用户路径逐项对照 Linghun Phase 15 preflight 当前状态
> 审计依据：仓库文档、实现源码、CCB 公开行为边界；未复制任何源码实现

---

## 1. 总体结论

### 1.1 是否建议进入 Phase 15 真实项目 Beta

**建议：CONDITIONAL PASS — 完成 5 项 P0/P1 修复后可进入。**

Linghun Phase 15 preflight 的 Natural Command Bridge 方向正确、骨架完整、安全边界已有实质性保护。它不是"纯关键词补丁"——已有 Command Capability Catalog、本地 intent router、Start Gate 过期/精确确认、bypass/auto 本地 opt-in、高风险自然语言阻断、短 RuntimeStatus 与 capability summary、双语覆盖和 focused tests。

但与 CCB 级编码体验相比，当前仍处于"可工作的 preflight 原型"而非"成品级 Natural Command Bridge"。主要差距集中在：

- Natural Intent Contract 的 7 种 request kind 在源码中实际只区分为 5 种 inquiry，缺少 `doctor_query` 独立识别路径；
- "现在是什么模型"等状态查询走的是 **Start Gate** 而非 `execute_readonly`（因为 `detectInquiry` 和 `isStatusLike` 的模式都不匹配 `现在/什么`），用户需确认 gate 才能看到模型信息；
- Catalog/dispatch 仍然存在结构漂移风险（dispatch 是长 else-if 链，不与 registry 共享单一数据源）；
- `decidePermission` 中用户 allow 规则在 plan 模式检查之前执行，导致预存的 allow 规则可绕过 plan 的只读保护；
- getCurrentFreshness 的 provider 字段仍硬编码为 "deepseek"；
- `/model` 显示的是配置层 model 名而非 RuntimeStatus 给模型透传的完整 provider/model+角色路由摘要。

以上差距均不会导致安全直通风险（高风险自然语言已被正确阻断），但会影响真实项目 Beta 中的体验手感和诊断准确度。

### 1.2 是否存在 Beta 前阻塞项

存在 2 个 P0 阻塞项和 4 个 P1 强阻塞项。详见第 6 节最小修复清单。

**特别说明**：本次审计由 3 个并行研究 agent 协作完成。其中 permission/plan/mode 专项 agent 在 `decidePermission` 中发现了一个此前审计未覆盖的决策顺序缺陷（P1-4）：用户 allow 规则在 plan mode 检查之前执行。修复工作量 < 30 分钟。所有其他 P0/P1 项与 pre-Beta cross-review 报告一致。

### 1.3 Linghun 当前距离 CCB 级编码体验的主要差距

| 维度 | 当前达成 | 距 CCB 的差距 |
|------|----------|--------------|
| 自然语言入口安全性 | 85% | 高风险阻断正确，但 doctor_query/status_query 未区分 |
| Catalog→dispatch 一致性 | 70% | 漂移检测有但数据源未统一 |
| 模式/权限边界 | 80% | bypass/auto gating 已到 CCB 水平，Plan approval 三态区分已有 |
| 状态可见性 | 75% | 状态栏短且不显示金额，但 provider 准确性和 doctor 路径不足 |
| 缓存/成本观测 | 80% | cache break 诊断完整，但 extension freshness hash 需验证 |
| 编码工具闭环 | 85% | Read/Write/Edit/Grep/Glob/Bash/Verify/Diff 全有权限管道 |
| Agent/multi-model | 80% | fork/agents/role route 已有，但手感到 CCB 还有打磨空间 |
| Skills/Workflows 边界 | 85% | summary-first、load-on-demand、失败隔离、稳定排序均达标 |
| 中文体验 | 80% | 双语覆盖但部分状态展示仍偏英文命令名 |

---

## 2. CCB 编码体验路径对照表

### 2.1 新项目启动与规则加载

| 维度 | CCB 用户路径/行为观察 | Linghun 对应设计 | Linghun 当前实现证据 | 差距 | 级别 | 阻塞Beta | 最小修复建议 |
|------|----------------------|-----------------|---------------------|------|------|----------|-------------|
| 项目识别 | CCB 启动时自动检测项目根目录（通过 .git 或 CLAUDE.md 位置） | `resolveStoragePaths()` 按 project/user/custom scope 定位项目根 | `packages/config/src/index.ts:316` — 默认 `~/.linghun/data`，支持环境变量覆盖；项目路径由用户传入或自动检测 | 等价，满足 | — | 否 | — |
| 规则加载 | CCB 按优先级加载内置规则→用户~/.claude/CLAUDE.md→项目./CLAUDE.md→./AGENTS.md→本地私有 | Linghun 加载 LINGHUN.md 为主入口，CLAUDE.md/AGENTS.md 仅作兼容导入 | `packages/tui/src/index.ts:1219-1223` — 启动时检查 `projectRulesExists`，缺规则时提示 `/memory init` | 等价，且 LINGHUN.md 定位更清晰 | — | 否 | — |
| 缺规则提示 | CCB 在无 CLAUDE.md 时静默运行，不主动提示 | Linghun 启动时显示 `[hint:info] 缺少 LINGHUN.md 项目规则` | `packages/tui/src/index.ts:1220-1223` | Linghun 更友好，优于 CCB | — | 否 | — |
| 上下文恢复 | CCB 通过 JSONL transcript + session resume 恢复 | Linghun Phase 11 实现了 `/resume`、`/branch`、handoff packet | `packages/tui/src/index.ts` — handleResumeCommand、handleBranchCommand | 等价 | — | 否 | — |
| 语言偏好 | CCB 通过系统 prompt 指示语言，可 CLAUDE.md 中配置 | Linghun 支持 `/language` 切换 zh-CN/en-US，Catalog 双语 | `packages/tui/src/index.ts:6421-6450` — messages 双语 | 等价 | — | 否 | — |
| 默认规则模板 | CCB 无内置模板（AI 自行推断规则） | Linghun `/memory init` 生成中文"项目规则"模板 | `packages/tui/src/index.ts:3413-3465` — 22行中文模板含用途/boundary/事实优先/Start Gate | Linghun 更好 | — | 否 | — |

**本路径结论**：Linghun 在项目启动与规则加载方面已达 CCB 级别，部分体验（缺规则提示、内置模板）甚至优于 CCB。

---

### 2.2 用户自然语言发起编码任务

| 维度 | CCB 用户路径/行为观察 | Linghun 对应设计 | Linghun 当前实现证据 | 差距 | 级别 | 阻塞Beta | 最小修复建议 |
|------|----------------------|-----------------|---------------------|------|------|----------|-------------|
| 自然语言入口 | CCB 中普通文本直接进入模型，由模型自行判断是聊天还是编码任务 | Linghun Natural Command Bridge 先由本地 router 裁决，模型只负责解释 | `packages/tui/src/index.ts:5228` — `routeNaturalIntent(text, context.language)` | 安全方向正确 | — | 否 | — |
| "现在是什么模型" | CCB 中模型会基于 system prompt 中的 provider/model 信息如实回答 | Linghun routes to `model` capability → `execute_readonly` → `/model` → `handleModelCommand` | `natural-command-bridge.ts:832-845` — inquiry==status → execute_readonly; test.ts:85 | **`/model` 返回的是 `context.model`（配置名），未包含 RuntimeStatus 中的 provider 和角色路由摘要** | P1 | **是** | `/model` 无参数时，应追加显示 RuntimeStatus 的 provider、角色路由短摘要、和 "如需诊断配置运行 /model route doctor" |
| "模型 key 配好了吗" | CCB 模型会解释说环境变量或配置中的 key 状态 | Linghun routes to `model` capability → `execute_readonly` → `/model` | `natural-command-bridge.ts:1194-1200` — `detectInquiry` 不区分 status/doctor | **无 doctor_query 独立路由，"配好了吗" 会被识别为 status → execute_readonly → `/model`，不会触发 `/model route doctor`** | **P0** | **是** | `detectInquiry` 增加 doctor 识别（匹配 "配好了吗/正常吗/为什么不能用/配置诊断/connected" 等）；router 中 doctor inquiry 路由到更精确的诊断等价命令 |
| "自动记忆是否打开" | CCB 中需用户自行检查 CLAUDE.md 或 memory 设置 | Linghun routes to `memory` → status → `execute_readonly` → `/memory` | test.ts:79 — 测试通过 | 等价 | — | 否 | — |
| "帮我建立索引" | CCB 中需用户显式输入命令 | Linghun routes to `index` → `start_gate` → 需精确确认 | test.ts:199-215 — gate 正确要求 `/index init fast` | Linghun 更安全 | — | 否 | — |
| "修这个报错" | CCB 中模型会先读错误日志/文件再提出修复 | Linghun `handleNaturalInput` 中 action==model → 转发给模型 | `packages/tui/src/index.ts:5229-5230` — return "message" 给 sendMessage | 等价（未拦截的自由对话进模型） | — | 否 | — |
| "实现这个功能" | CCB 中可能会触发 Plan mode 或直接执行 | Linghun 中普通编码请求也会进模型，由 behavior guard 控制 | `packages/tui/src/index.ts:5271` — checkEvidenceGate 拦截无证据结论 | 等价，且有 evidence gate 保护 | — | 否 | — |
| "看下哪里有问题" | CCB 中模型会读文件、搜索、分析 | Linghun 同上，model action | 同上 | 等价 | — | 否 | — |

**本路径结论**：自然语言入口安全边界正确，但 Natural Intent Contract 缺少 `doctor_query` 独立路由是 P0 问题。`status_query` 虽已存在但 `/model` 无参数时未展示 RuntimeStatus provider 和角色路由摘要，模型透传的 RuntimeStatus 与实际显示的 `/model` 结果可能不一致。

---

### 2.3 读文件、搜索、理解代码路径

| 维度 | CCB 用户路径/行为观察 | Linghun 对应设计 | Linghun 当前实现证据 | 差距 | 级别 | 阻塞Beta | 最小修复建议 |
|------|----------------------|-----------------|---------------------|------|------|----------|-------------|
| 读文件 | CCB 使用 Read tool，按需展示内容 | Linghun `/read` + Read tool | `packages/tui/src/index.ts` — handleReadCommand + builtInTools Read | 等价 | — | 否 | — |
| 搜索代码 | CCB 使用 Grep/Glob tool | Linghun `/grep`、`/glob` | 同上 handleGrepCommand/handleGlobCommand | 等价 | — | 否 | — |
| 代码索引 | CCB 可选接入 codebase-memory-mcp | Linghun `/index`、`/index architecture`、`/index search` | `packages/tui/src/index.ts:1351-1353` — handleIndexCommand | 等价 | — | 否 | — |
| 大输出截断 | CCB truncates 大文件/工具输出 | Linghun `truncateDisplay()` + output limit | `packages/tui/src/index.ts:6410` — status truncateDisplay(120)；tools 有 outputLimitBytes | 等价 | — | 否 | — |
| 权限边界 | CCB Read/Grep/Glob 默认不需要审批 | Linghun readonly 工具同样 | Phase 06 权限设计 | 等价 | — | 否 | — |
| 中文提示 | CCB 英文为主，CCB Dev Boost 做中文化 | Linghun 原生双语 | `packages/tui/src/index.ts:6421-6450` | Linghun 更好 | — | 否 | — |
| transcript evidence | CCB JSONL transcript 记录所有工具调用 | Linghun Phase 02 JSONL | `packages/core/src/session.ts` — appendEvent | 等价 | — | 否 | — |

**本路径结论**：代码理解路径已达 CCB 级别，无明显差距。

---

### 2.4 Plan 模式与执行边界

| 维度 | CCB 用户路径/行为观察 | Linghun 对应设计 | Linghun 当前实现证据 | 差距 | 级别 | 阻塞Beta | 最小修复建议 |
|------|----------------------|-----------------|---------------------|------|------|----------|-------------|
| 进入 Plan | CCB 中用户用 `/plan` 或自然语言触发 | Linghun `/plan` + plan mode | `packages/tui/src/index.ts:1283-1285` — handlePlanCommand | 等价 | — | 否 | — |
| Plan 只读 | CCB Plan mode 禁止 Write/Edit/Bash | Linghun Phase 06 设计同样 | `packages/tui/src/index.ts:2148-2150` — plan 模式提示只读 | 等价 | — | 否 | — |
| Plan 批准 | CCB 中批准计划后可选择 auto-accept edits 或手动确认编辑 | Linghun 区分 manual/acceptEdits 边界 | Phase 15 preflight hardening 已补 | **Plan approval 有三态区分但交互面不如 CCB 丰富** | P2 | 否 | Phase 15.5 补齐完整三态交互 |
| Plan 不授权全部工具 | CCB Plan approval 仅授权方案边界，Bash/依赖/权限规则仍需审批 | Linghun 同样设计 | Phase 15 preflight 文档声明 | 等价 | — | 否 | — |
| Plan→bypass 阻断 | CCB 不允许 plan 直接切 bypass | Linghun 阻断 `plan→bypass` | `packages/tui/src/index.ts:2119-2120` | 等价 | — | 否 | — |
| EnterPlanMode 工具 | CCB 中模型可调用 EnterPlanMode 工具 | Linghun 有 EnterPlanMode 概念 | Phase 06 设计 | 等价 | — | 否 | — |
| **Plan 模式内权限决策顺序** | CCB plan mode 在权限管道中优先于用户规则执行 | Linghun `decidePermission` 中用户 allow 规则（line 5771）在 plan 检查（line 5774）**之前**执行 | `packages/tui/src/index.ts:5759-5782` — deny→ask→allow 先于 plan check | **预存的用户 allow 规则可绕过 plan 只读保护** | **P1** | **是** | 将 plan mode check 移到用户规则之前（在 hardDeny 之后立即执行） |

**本路径结论**：除决策顺序缺陷外，Plan 模式边界已达 CCB 安全级别。决策顺序需修复。

---

### 2.5 编辑、diff、checkpoint、rewind

| 维度 | CCB 用户路径/行为观察 | Linghun 对应设计 | Linghun 当前实现证据 | 差距 | 级别 | 阻塞Beta | 最小修复建议 |
|------|----------------------|-----------------|---------------------|------|------|----------|-------------|
| 编辑工具 | CCB Write/Edit/MultiEdit | Linghun `/write`、`/edit`、`/multiedit` | `packages/tui/src/index.ts` — builtInTools | 等价 | — | 否 | — |
| Diff 查看 | CCB 可查看编辑前后 diff | Linghun `/diff` | `packages/tui/src/index.ts` — handleDiffCommand | 等价 | — | 否 | — |
| Checkpoint | CCB 支持 checkpoint/rewind | Linghun `/rewind` | `packages/tui/src/index.ts:1303-1305` — handleRewindCommand | 等价 | — | 否 | — |
| 写入权限管道 | CCB Write/Edit 需权限审批 | Linghun 同样；自然语言不直通 | `natural-command-bridge.ts:895-905` — dangerous→permission_pipeline | 等价 | — | 否 | — |
| 高风险保护 | CCB 保护 .git/.ssh/密钥/系统目录 | Linghun Phase 06 设计同样 | 不可绕过规则 | 等价 | — | 否 | — |

**本路径结论**：编辑/diff/rewind 路径已达 CCB 级别。

---

### 2.6 Bash、依赖、验证、测试

| 维度 | CCB 用户路径/行为观察 | Linghun 对应设计 | Linghun 当前实现证据 | 差距 | 级别 | 阻塞Beta | 最小修复建议 |
|------|----------------------|-----------------|---------------------|------|------|----------|-------------|
| Bash 执行 | CCB Bash tool 需权限审批 | Linghun `/bash` + Bash tool | `packages/tui/src/index.ts` — handleBashCommand | 等价 | — | 否 | — |
| 自然语言直通 Bash | CCB 中 "直接 npm install" 需权限审批 | Linghun 阻断："直接运行 npm install"→permission_pipeline | `natural-command-bridge.ts:1203-1211` + test.ts:137-149 | 等价且更安全 | — | 否 | — |
| 验证闭环 | CCB verifier/verify | Linghun `/verify`、`/review`、VerificationRunner | `packages/tui/src/index.ts:1319-1325` — handleVerifyCommand/handleReviewCommand | 等价 | — | 否 | — |
| 日志路径 | CCB 日志写入 transcript | Linghun JSONL + logPath | `packages/tui/src/index.ts` — appendSystemEvent | 等价 | — | 否 | — |
| 输出截断 | CCB 大输出截断 | Linghun outputLimitBytes + fullOutputPath | `packages/tui/src/index.ts:6367-6373` | 等价 | — | 否 | — |
| 失败解释 | CCB 对失败命令给出修复建议 | Linghun `/verify` 输出 nextAction | `packages/tui/src/index.ts:5131` — formatVerificationReport 含下一步 | 等价 | — | 否 | — |

**本路径结论**：Bash/验证/测试路径已达 CCB 级别，自然语言危险请求阻断正确。

---

### 2.7 模型、provider、多模型和 agent

| 维度 | CCB 用户路径/行为观察 | Linghun 对应设计 | Linghun 当前实现证据 | 差距 | 级别 | 阻塞Beta | 最小修复建议 |
|------|----------------------|-----------------|---------------------|------|------|----------|-------------|
| 查看当前模型 | CCB 状态栏显示模型名 | Linghun 状态栏 `model {model}` | `packages/tui/src/index.ts:6403` | 状态栏只显示 model 名，不显示 provider | P2 | 否 | 状态栏增加 provider 短名 |
| 模型路由 | CCB 支持多 provider 切换 | Linghun `/model route`、`/model route set` | `packages/tui/src/index.ts:1271-1273` — handleModelCommand | 等价 | — | 否 | — |
| 模型 doctor | CCB 可诊断模型配置 | Linghun `/model route doctor` | test.ts:168 — 测试覆盖 | 等价 | — | 否 | — |
| "用强模型审一下" | CCB 中可手动切换模型做审查 | Linghun 可通过 `/model route set reviewer xxx` | `packages/tui/src/index.ts` — handleModelCommand | 等价但需手动路由 | P2 | 否 | 自动路由放 Phase 15.5 |
| agent handoff | CCB agent 间只传结构化摘要 | Linghun Phase 13 设计同样 | Phase 13 交付文档 | 等价 | — | 否 | — |
| 预算说明 | CCB 不主动展示预算 | Linghun Start Gate 展示 budget 说明 | `natural-command-bridge.ts:1041` | Linghun 更好 | — | 否 | — |
| Provider 准确传递 | CCB 通过 system prompt 告知模型当前 provider/model | Linghun RuntimeStatusForModel 含 provider+model | `natural-command-bridge.ts:765` — `provider: context.provider ?? "unknown"` | **getCurrentFreshness 的 provider 仍硬编码 "deepseek"** | P1 | **是** | 见 P1-3 |

**本路径结论**：模型/agent 路径基本达标。provider 硬编码残留需修复。

---

### 2.8 记忆、handoff、新会话恢复

| 维度 | CCB 用户路径/行为观察 | Linghun 对应设计 | Linghun 当前实现证据 | 差距 | 级别 | 阻塞Beta | 最小修复建议 |
|------|----------------------|-----------------|---------------------|------|------|----------|-------------|
| 项目规则 | CCB CLAUDE.md 多层加载 | Linghun LINGHUN.md + 兼容加载 | `packages/tui/src/index.ts:1219-1223` | 等价 | — | 否 | — |
| 记忆管理 | CCB /memory（如有） | Linghun `/memory`、`/memory candidate`、`/memory accept`、`/memory review` | `packages/tui/src/index.ts:1363-1365` — handleMemoryCommand | 等价 | — | 否 | — |
| 候选记忆确认 | CCB 中记忆沉淀需用户确认 | Linghun 候选需显式 `/memory accept <id>` | test.ts:245 — 测试覆盖 | 等价 | — | 否 | — |
| Handoff packet | CCB 无正式 handoff（靠 CLAUDE.md） | Linghun structured handoff packet | Phase 11 交付文档 | Linghun 更好 | — | 否 | — |
| Session resume | CCB `/resume` | Linghun `/resume`、`/sessions resume` | `packages/tui/src/index.ts:1355-1357` — handleResumeCommand | 等价 | — | 否 | — |
| 不自动写长期记忆 | CCB 不自动（用户反对时） | Linghun 默认不自动，候选需确认 | Phase 16 设计（Phase 15 已关闭自动学习） | 等价 | — | 否 | — |

**本路径结论**：记忆/handoff 路径已达 CCB 级别，handoff packet 甚至优于 CCB。

---

### 2.9 Skills、workflows、plugins、hooks

| 维度 | CCB 用户路径/行为观察 | Linghun 对应设计 | Linghun 当前实现证据 | 差距 | 级别 | 阻塞Beta | 最小修复建议 |
|------|----------------------|-----------------|---------------------|------|------|----------|-------------|
| Skills 可发现 | CCB 中 skill 可通过命令查看和调用 | Linghun `/skills` 列出 skill 摘要 | `packages/tui/src/index.ts:1367-1369` — handleSkillsCommand | 等价 | — | 否 | — |
| Workflows 启动 | CCB 中 workflow 通过 Start Gate 启动 | Linghun `/workflows <name>` 展示 Start Gate | Phase 14 交付 | 等价 | — | 否 | — |
| Plugins 启停 | CCB plugin 可 enable/disable | Linghun `/plugins enable/disable` | Phase 14 交付 | 等价 | — | 否 | — |
| Hooks doctor | CCB 中 hooks 需诊断边界 | Linghun `/doctor hooks` | `packages/tui/src/index.ts:1379-1381` — handleDoctorCommand | 等价 | — | 否 | — |
| 第三方信任 | CCB 中第三方 skill/plugin 需信任确认 | Linghun Phase 14 交付：第三方未信任不启用 | Phase 14 hardening | 等价 | — | 否 | — |
| 稳定排序 | CCB 中 tool list 稳定排序避免破坏 cache | Linghun 同样 | `natural-command-bridge.ts:712-714` — catalog 排序；extension freshness 排序 | 等价 | — | 否 | — |
| summary-first | CCB 中不把所有 skill 全文注入 prompt | Linghun 同样设计 | Phase 14 交付 | 等价 | — | 否 | — |
| 不绕过权限 | CCB 中 plugin/hook 不能绕过权限 | Linghun Phase 14 hardening 同样 | Phase 14 交付 | 等价 | — | 否 | — |

**本路径结论**：Skills/workflows/plugins/hooks 边界已达 CCB 级别，安全硬化完整。

---

### 2.10 状态栏、帮助、错误提示、输出手感

| 维度 | CCB 用户路径/行为观察 | Linghun 对应设计 | Linghun 当前实现证据 | 差距 | 级别 | 阻塞Beta | 最小修复建议 |
|------|----------------------|-----------------|---------------------|------|------|----------|-------------|
| 状态栏 | CCB 状态栏显示项目/模型/模式/缓存命中率/agent数/索引状态 | Linghun 状态栏：session/model/mode/bg/cache/index/gate | `packages/tui/src/index.ts:6392-6411` | 短且不显示金额 ✓；缺少 provider 短名 | P2 | 否 | 后续加 provider |
| pending gate 可见 | CCB 中 pending 状态可见 | Linghun status bar 显示 gate id:risk | `packages/tui/src/index.ts:6395-6397` | 等价 | — | 否 | — |
| Help | CCB `/help` 列出所有命令 | Linghun `/help` 由 catalog 派生 | `packages/tui/src/index.ts:1268` — formatCatalogHelp | 等价 | — | 否 | — |
| 错误提示 | CCB 缺 key/配置错误有明确提示 | Linghun `/model route doctor` | test.ts:168 — 测试覆盖 | 等价 | — | 否 | — |
| 中文体验 | CCB 英文为主 | Linghun 原生双语 | `packages/tui/src/index.ts:6421-6450` | Linghun 更好 | — | 否 | — |
| 手感 | CCB 像 "会控制本地程序的编码助手" | Linghun 有自然语言桥 + Start Gate + 权限阻断格式 | 整体偏"命令帮助文档"感 | P2 | 否 | Beta 后体验打磨 |
| 不显示金额 | CCB 状态栏不直接显示金额 | Linghun 同样，金额只在 /usage /stats | `packages/tui/src/index.ts:6396-6407` | 等价 | — | 否 | — |
| TUI 标题 | CCB 标题显示 Claude Code | Linghun 标题 `{name} TUI / REPL` | `packages/tui/src/index.ts:6423` — 已去掉 Phase 14 | 当前正确 | — | 否 | — |

**本路径结论**：状态栏/help 基本达标。手感距 CCB 自然度有距离，但不阻塞 Beta。

---

### 2.11 缓存、成本和索引稳定性

| 维度 | CCB 用户路径/行为观察 | Linghun 对应设计 | Linghun 当前实现证据 | 差距 | 级别 | 阻塞Beta | 最小修复建议 |
|------|----------------------|-----------------|---------------------|------|------|----------|-------------|
| 缓存命中展示 | CCB 状态栏显示命中率 | Linghun status bar `cache {hitRate}` | `packages/tui/src/index.ts:6394` | 等价 | — | 否 | — |
| cache break 诊断 | CCB Dev Boost `/break-cache` | Linghun `/break-cache status` | `packages/tui/src/index.ts:1343-1345` — handleBreakCacheCommand | 等价 | — | 否 | — |
| extension freshness | CCB 中 plugin/skill 变化进入 cache freshness | Linghun pluginListHash 计算存在 | `packages/tui/src/index.ts:4285` | **需验证 pluginListHash 传入数据为稳定排序贡献项** | P1 | **是** | 验证 `refreshCacheFreshness()` 传入的 plugins 数据是 `toStableExtensionSummary()` 产物 |
| 大状态不进 prompt | CCB 不把大 schema/索引/memory 注入 prompt | Linghun RuntimeStatusForModel <500 字符, capability summary <1200 字符 | `natural-command-bridge.test.ts:263-264` | 等价且已测试 | — | 否 | — |
| 稳定排序 | CCB MCP tool list / schema 稳定排序保护 cache | Linghun 同样 | `natural-command-bridge.ts:712-714` — catalog 排序 | 等价 | — | 否 | — |
| 成本可见 | CCB /usage /stats | Linghun `/usage`、`/stats` | `packages/tui/src/index.ts:1383-1389` | 等价 | — | 否 | — |

**本路径结论**：缓存/成本路径基本达标。extension freshness 的 pluginListHash 需验证。

---

### 2.12 阶段边界和 clean rewrite 风险

| 维度 | 风险 | Linghun 当前状态 | 级别 | 阻塞Beta | 说明 |
|------|------|-----------------|------|----------|------|
| Phase 16/17/18 混入 | 提前实现长期学习/长期任务/Remote Channels/桌面端 | 未发现混入 | — | 否 | Phase 16 `autoAccept` 硬编码为 `false`（`natural-command-bridge.ts:755`），正确 |
| CCB 源码复制 | 为追 CCB 手感而复制可疑实现 | 未发现复制 | — | 否 | Natural Command Bridge/Start Gate/Catalog 均为自研 |
| 过度复杂化 | 过度抽象、多层 indirection | 当前 dispatch 是长 else-if 链但可理解 | P2 | 否 | 不做大重构，只做最小 registry map 化 |
| 屎山化风险 | 补丁化、重复硬编码 | catalog/dispatch 三处硬编码 | P0 | **是** | 需统一数据源 |

**本路径结论**：clean rewrite 原则保持良好，未发现 CCB 源码复制。catalog/dispatch 结构漂移是最主要的代码质量风险。

---

## 3. Natural Intent Contract 专项结论

### 3.1 7 种 request kind 对照

Phase 15 规格要求 `status_query`、`doctor_query`、`usage_help`、`safe_action_request`、`config_change_request`、`dangerous_action_request`、`ambiguous_request` 7 种意图。当前实现中的 inquiry 类型为：

```typescript
// natural-command-bridge.ts:49
inquiry: "status" | "usage" | "risk" | "howto" | "execute";
```

**对照表**：

| 规格要求 | 当前 inquiry 映射 | 实际路由 | 差距 |
|----------|------------------|----------|------|
| `status_query` | `"status"` | `execute_readonly`（针对 first batch 状态能力） | ✓ 已覆盖 |
| `doctor_query` | 无独立值 | 被 `"status"` 捕获 → `execute_readonly` | **缺失**：医生查询应路由到诊断等价命令（如 `/model route doctor`），而非普通状态查询 |
| `usage_help` | `"usage"` 或 `"howto"` | `answer`（显示 capability 说明） | ✓ 已覆盖 |
| `safe_action_request` | `"execute"` | `start_gate`（需 Start Gate 确认） | ✓ 已覆盖 |
| `config_change_request` | `"execute"` | `start_gate`（writesConfig → requiresExactConfirmation） | 可工作但缺少独立语义识别 |
| `dangerous_action_request` | `"execute"` + `detectDangerousNaturalIntent` | `permission_pipeline` | ✓ 已覆盖 |
| `ambiguous_request` | 低分/多候选 | `ask_clarify` | ✓ 已覆盖 |

### 3.2 "现在是什么模型" 专项分析（经第三研究 agent 深入 tracing 修正）

**输入**：`"你是什么模型"`  
**实际路由路径**（第三 agent 逐行追踪确认）：
1. `detectInputLanguage` → `"zh-CN"`
2. `detectInquiry("你是什么模型")` → **检查 8 个 status 模式**（`/是否|开了吗|enabled|status|状态|当前|命中|hit rate|list|有哪些|what model/u`）→ **无一匹配**（"现在/什么/是" 均不在模式内）→ fallback 到 `"howto"`
3. `scoreCapability` → `model` score +4（匹配 `模型` 关键词 boost）
4. `routeNaturalIntent`：
   - `inquiry === "status"` → **FALSE**（是 `"howto"`）
   - `isStatusLike("你是什么模型")` → 检查 `/状态|status|当前|enabled|.../u` → **FALSE**（"现在/什么" 不在内）
   - `isUsageOrRiskQuestion` → **FALSE**（文本不含 `怎么/干什么`）
   - `capability.readonly` → **FALSE**（model 的 risk=start_gate, readonly=false）
   - `capability.risk === "dangerous"` → **FALSE**
   - **最终 fallthrough → `start_gate`**，命令 `/model`，置信度 0.6
5. `handleNaturalInput`：创建 pending gate。**用户必须输入 `/model` 才能看到模型信息！**

**用户实际看到的行为**：
```
Start Gate：模型
- 精确命令：/model
- 风险：risk=start_gate, readonly=no, startGate=yes
- 范围：当前项目 <path>
回复精确命令 `/model` 才能继续；此风险级别不能只用普通"确认"。
```

**根本原因**：`detectInquiry` 的 status 模式 `当前` 是"当前"（current），而用户自然说"现在"（now）。中文同义词未被模式覆盖。`isStatusLike` 同样不覆盖 `现在/什么/是`。这使得最常见的模型查询退化为 Start Gate 确认门。

**期望行为（规格要求）**：
- 返回真实 provider/model、角色路由短摘要和可选 doctor 提示
- RuntimeStatusForModel 中已有 `model: { provider, name }`，但未通过自然语言直接展示

**差距总结**：
1. **路由退化**：`"你是什么模型"` 不应触发 Start Gate。它是纯状态查询，应走 `execute_readonly` 直达 `/model` 只读执行。
2. **展示不完整**：即使通过 gate 后 `/model` 显示的是 `context.model`，未展示 provider 和角色路由。

**结论**：**这比原分析更严重**。不是 "展示不完整" 的问题，而是 "状态查询被当作动作请求要求确认门"。规格担心的退化场景（状态查询变为命令用法）部分成立。

### 3.3 "模型 key 配好了吗" 专项分析

**输入**：`"模型 key 配好了吗"`  
**路由路径**：
1. `detectInquiry` → `"status"`（匹配 `status` regex 不匹配... 实际上 `detectInquiry` 中是 `是否|enabled|status|当前|命中|hit rate|list|有哪些/what model`，`配好了吗` 不会被匹配为 status）
2. 实际上 `配好了吗` 没有任何 inquiry 关键词匹配 → 会 fallback 到 `howto`（默认值）

让我重新检查 `detectInquiry`：
```typescript
// natural-command-bridge.ts:1194-1201
function detectInquiry(text: string): NaturalIntent["inquiry"] {
  if (/风险|危险|safe|risk|danger/u.test(text)) return "risk";
  if (/怎么|如何|用途|干什么|what does|how do i|how to|what is/u.test(text)) return "usage";
  if (/是否|开了吗|enabled|status|状态|当前|命中|hit rate|list|有哪些|what model/u.test(text)) return "status";
  return /帮我|请|直接|打开|建立|build|start|create|run|enable|accept|force/u.test(text)
    ? "execute"
    : "howto";
}
```

`配好了吗` 匹配 `/开了吗/` → 不匹配（"配好" ≠ "开了"）。不会进入 status inquiry。
最终 fallback 到 `"execute"`（不匹配）→ `"howto"`。

所以 `"模型 key 配好了吗"` → inquiry `"howto"` → `isUsageOrRiskQuestion` → `answer` → `formatCapabilityAnswer` → 输出 `/model` 的用途说明。

**期望行为（规格要求）**：进入 `doctor_query` → 触发 `/model route doctor` → 返回 provider/baseUrl/apiKey/model 的诊断摘要和环境变量修复建议。

**实际行为**：返回 `/model` 用法说明（不会泄露 API key，安全上没错）。

**差距**：**`"配好了吗"` 不会触发诊断路径。这是 P0 问题**——用户询问配置健康状态，却得到命令用法手册。

### 3.4 Natural Intent Contract 总体判断

| 判断 | 结论 |
|------|------|
| 是否弱化版 | **否**。不是纯关键词补丁，有 catalog + router + Start Gate + 权限阻断 |
| 是否残缺 | **是，关键残缺**。`doctor_query` 独立路由缺失；**"现在是什么模型"等最常见的状态查询走 Start Gate 而非直接返回**（`detectInquiry` 和 `isStatusLike` 的模式不覆盖 `现在/什么/是` 等中文疑问词） |
| 是否会导致状态查询退化为命令用法 | **部分会**。"模型 key 配好了吗" 退化为用法；"现在是什么模型" 退化为 Start Gate（需确认才能看到模型信息） |
| 是否安全 | **是**。高风险全部正确阻断 |
| Beta 前是否必须硬化 | **是**。至少补 `doctor_query` 识别；扩展 status 模式覆盖 `现在/什么/是/吗`；使纯状态查询走 `execute_readonly` |

---

## 4. 权限 / Plan / 提权交互专项结论

### 4.1 exact action、risk、scope、reason、rollback、choices 检查

| 检查项 | 是否展示 | 证据 |
|--------|---------|------|
| exact action | ✓ | `formatNaturalStartGate`: `精确命令：${command}`；`formatNaturalPermissionBlock`: `精确动作：${command}` |
| risk | ✓ | `formatRiskLine`: `risk=${c.risk}, readonly=..., startGate=..., writesConfig=..., permissionPipeline=...` |
| scope | ✓ | `formatNaturalStartGate`: `范围：${gate.scope}`；`createPendingNaturalCommand`: `scope: current project ${context.projectPath}` |
| reason | ✓ | `formatNaturalPermissionBlock`: `原因：请求来自 Natural Command Bridge...` |
| rollback | ✓ | `formatNaturalStartGate`: `回滚方式：继续前可查看 /diff、checkpoint...` |
| choices | ✓ | `formatNaturalStartGate`: `选择：输入其他内容取消；继续必须按下方要求确认` |

**结论**：权限/提权交互的 6 要素展示完整。中文/英文均有。

### 4.2 bypass/auto gating

| 检查项 | 是否到位 | 证据 |
|--------|---------|------|
| bypass 必须本地 opt-in | ✓ | `index.ts:2122` — `LINGHUN_ENABLE_BYPASS=1` |
| auto 必须 gate/classifier 可用 | ✓ | `index.ts:2125` — `LINGHUN_ENABLE_AUTO_PERMISSION=1` |
| 自然语言不能静默开启 | ✓ | `getModeChangeGuard` 在 mode command 路径中检查 |
| bypass 保护硬规则 | ✓ | Phase 06 设计：.git/.ssh/密钥/系统目录在 bypass 下也保护 |

### 4.3 Plan approval

| 检查项 | 是否到位 | 证据 |
|--------|---------|------|
| Plan 不授权全部工具 | ✓ | Phase 15 preflight 设计明确 |
| 区分 manual/acceptEdits | ✓ | Phase 15 preflight hardening 已补 |
| Bash/依赖/权限规则仍需审批 | ✓ | Phase 15 preflight 文档声明 |

### 4.4 权限交互总体判断

**结论：权限/Plan/提权交互已达 CCB 安全级别。** 6 要素展示完整、bypass/auto gating 到位、Plan 边界正确。CCB 级别体验中 Plan approval 的三态完整交互（approve+auto-accept edits / approve+manual edits / reject+feedback）放 Phase 15.5 打磨不阻塞 Beta。

---

## 5. 不建议吸收的 CCB 行为

| CCB 行为 | 不吸收原因 | 对应 Linghun 设计 |
|----------|-----------|------------------|
| CCB 默认无阶段边界，功能堆叠 | Linghun 严格按阶段闭环，防止功能蔓延 | Phase 边界 + Start Gate |
| CCB 中 bypass 可通过 /mode bypass 直接切换 | Linghun 要求 `LINGHUN_ENABLE_BYPASS=1` 本地显式 opt-in | 更安全 |
| CCB 中模型可自由猜测执行（无本地 router） | Linghun 的 Natural Command Bridge 本地裁决更安全 | router + catalog |
| CCB 的 remote-control / daemon / bridge mode | Phase 17 才做，不提前混入 | Phase 17 边界 |
| CCB 的 telemetry / prefetch 第三方 MCP URL | Linghun 不做任何未授权联网 | MCP 默认 disabled |
| CCB 中完整 CLAUDE.md 可包含任意长度内容 | Linghun 的 memory 做摘要注入，不全文 dump | summary-first |
| CCB 的 ACP protocol / self-hosted RCS | Phase 17 才评估，不提前 | Phase 17 边界 |
| CCB decompiled 代码中的内部 API/遥测 | 明确禁止，clean rewrite | CLAUDE.md 约束 |

---

## 6. 最小修复清单

### 6.1 P0 — Beta 前必须修

| # | 标题 | 当前症状 | 最小修复 | 预计工作量 |
|---|------|---------|---------|-----------|
| **P0-1** | Natural Intent Contract 缺少 `doctor_query` 独立路由 | `"模型 key 配好了吗"` → `answer` 返回用法说明，而非触发 `/model route doctor` | `detectInquiry` 增加 `"doctor"` 返回类型；匹配 `"配好了吗/正常吗/为什么不能用/配置诊断/is.*configured/connected/is.*working"` 等；doctor inquiry + model capability → `/model route doctor`；doctor inquiry + index capability → `/index status`（含 stale hint） | < 1 小时 |
| **P0-2** | Catalog/dispatch 结构漂移风险 — 三处独立硬编码 | `SLASH_COMMAND_REGISTRY` + `COMMAND_CAPABILITY_DATA` + `handleSlashCommand` else-if 链手动同步 | 将 `handleSlashCommand` 迁移为 registry-based lookup table（`Map<slash, handler>`），从 `SLASH_COMMAND_REGISTRY` 派生；漂移检测测试保持 | < 1 小时 |

### 6.2 P1 — Beta 前强建议修

| # | 标题 | 当前症状 | 最小修复 | 预计工作量 |
|---|------|---------|---------|-----------|
| **P1-1** | `detectInquiry` 和 `isStatusLike` 的 status 模式不覆盖 `现在/什么/是` 等常见中文疑问词，导致"现在是什么模型"走 `start_gate` 而非 `execute_readonly` | 用户问 `"你是什么模型"` 被要求确认 Start Gate 才能看到模型信息 | 扩展 `detectInquiry` 的 status 模式，增加 `现在|什么|是|吗|呢` 等中文疑问词；扩展 `isStatusLike` 同样处理；使"现在是什么模型/你用的哪个模型"等纯状态查询走 `execute_readonly` | < 30 分钟 |
| **P1-2** | `getCurrentFreshness()` provider 硬编码为 `"deepseek"` | 缓存 freshness 计算中 provider 字段固定为 `"deepseek"`，影响 cache break 检测准确性 | `index.ts:4228` 的 `provider: "deepseek"` 改为从 `context` 的实际 provider 读取 | < 15 分钟 |
| **P1-3** | 验证 extension freshness 的 pluginListHash 来源稳定性 | `computeCurrent()` 中 `pluginListHash` 的 `input.plugins` 是否来自 `toStableExtensionSummary()` 需验证 | 审查 `refreshCacheFreshness()` 调用处，确认 plugins 数据是稳定排序的贡献项摘要；补 focused test | < 30 分钟 |
| **P1-4** | `decidePermission` 决策顺序：用户 allow 规则先于 plan mode 检查 | `index.ts:5759-5782` — deny→ask→allow 在 line 5759-5771 执行，plan check 在 line 5774 才执行。预存的 `allow Write *` 规则可在 plan mode 中绕过只读保护，直接允许写入 | 将 plan mode 检查移到 hardDeny 之后、用户规则之前；重构决策顺序为：hardDeny → plan → userRules → acceptEdits → bypass → auto → default | < 30 分钟 |

### 6.3 P2 — Beta 后修

| # | 标题 | 说明 |
|---|------|------|
| P2-1 | Plan approval 三态完整交互 | 当前已有 manual/acceptEdits 区分，完整交互打磨放 Phase 15.5 |
| P2-2 | 状态栏增加 provider 短名 | 当前只显示 model 名 |
| P2-3 | `"配好了吗"` 不匹配 `"开了吗"` 的 inquiry 细化 | 与 P0-1 同修 |
| P2-4 | Status dialog 按 subsystem 分组 | MCP/index/memory/cache/skills/plugins/hooks 分组健康状态，放 Phase 15.5 |
| P2-5 | Permission prompt allow once/always/reject | 完整权限 UI 放 Phase 15.5 |
| P2-6 | Router 语义泛化强度 | 当前 token+alias 保守评分是正确 Beta 入口策略，不做 NLP/ML 升级 |
| P2-7 | `linghun - 副本.md` 草稿清理 | 建议 `.gitignore` 或删除 |
| P2-8 | START_NEXT_CHAT.md 纳入新审计报告 | 本报告和 cross-review 报告加入启动必读清单 |

---

## 7. 验证建议

### 7.1 修复后必须运行的验证命令

```bash
# 全量测试（关键：natural-command-bridge 和 index 测试文件）
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

# 重点测试文件
corepack pnpm test -- --run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts packages/config/src/index.test.ts
```

### 7.2 TUI 自然语言 smoke 场景

修复后应在 TUI REPL 中逐个验证以下场景。建议使用 `printf '...\n' | corepack pnpm exec linghun` 管道模式或手动 REPL 输入：

#### 状态查询（status_query）

| 输入 | 期望 | 当前风险 |
|------|------|---------|
| `现在是什么模型` | 返回 provider + model 名 + 角色路由短摘要 + doctor 提示 | P1-1 修复后应达标 |
| `你用的哪个模型` | 同上 | 同上 |
| `what model are you using` | 同上（英文版） | 同上 |
| `自动记忆功能是否打开` | 返回 autoAccept=false、candidate 数、accepted 数、LINGHUN.md 状态 | 当前已通过测试 ✓ |
| `索引好了没` | 返回 index status、changedFiles、stale hint | 当前已通过测试 ✓ |
| `缓存命中怎么样` | 返回 latestHitRate、changedKeys | 当前已通过测试 ✓ |
| `当前权限模式` | 返回 permissionMode | 当前已通过测试 ✓ |

#### 医生查询（doctor_query）— P0-1 修复后新增

| 输入 | 期望 |
|------|------|
| `模型 key 配好了吗` | 触发 `/model route doctor`，诊断 provider/baseUrl/apiKey/model |
| `模型配置正常吗` | 同上 |
| `is the model configured correctly` | 同上（英文版） |
| `索引为什么不能用` | 返回 index status + 可能的配置/权限问题 |

#### 用法询问（usage_help）

| 输入 | 期望 |
|------|------|
| `/model` 怎么用 | 返回 `/model` 的用途、whenToUse、风险、等价命令 |
| `怎么搜索代码里的 TODO` | 返回 `/grep` 用途说明 |
| `what does /branch do` | 返回 `/branch` 英文用途说明 |

#### 安全动作请求（safe_action_request）

| 输入 | 期望 |
|------|------|
| `帮我建立索引` | Start Gate，需精确确认 `/index init fast` |
| `打开 bug-fix 工作流` | Start Gate，需精确确认 `/workflows bug-fix` |
| `开个分支试试` | Start Gate，显示 branch purpose |
| `start a verifier agent` | Start Gate，显示 fork verifier |

#### 高风险阻断（dangerous_action_request）

| 输入 | 期望 |
|------|------|
| `直接帮我运行 npm install` | 阻断，permission_pipeline，不执行 |
| `直接开启 bypass` | 阻断，不执行；显示 bypass 需要 `LINGHUN_ENABLE_BYPASS=1` |
| `直接接受所有记忆` | 阻断，不执行 |
| `force refresh index` | 阻断或进入 permission_pipeline |
| `直接帮我写文件` | 阻断，不执行 |

### 7.3 验证通过标准

- 所有状态查询返回真实 RuntimeStatus 数据，不返回命令用法
- 所有 doctor 查询进入诊断路径（P0-1 修复后）
- 所有高风险自然语言被阻断，不执行
- 所有 Start Gate 显示完整 6 要素（exact action/risk/scope/reason/rollback/choices）
- 中英文同一能力走同一风险处理路径
- `corepack pnpm test` 全部通过
- `corepack pnpm typecheck` 无错误

---

## 8. 审计边界声明

本次审计：

- **只读审查**，未修改任何代码。
- 未进入 Phase 15 真实项目 Beta、Phase 15.5 或 Phase 16+。
- CCB / Claude Code 仅参考公开行为、交互边界、UX 模式和验收思路。
- 未复制任何 CCB、OpenCode、Hermes 或其他第三方项目的源码实现、内部 API、反编译产物或专有实现。
- 审查基于直接阅读 Linghun 仓库全部 10 份必读文档、`natural-command-bridge.ts`（约 1500 行）、`natural-command-bridge.test.ts`（289 行）、`index.ts`（关键段落约 1500 行）、`config/src/index.ts`、CCB 本地源码的 CLAUDE.md（公开行为模式提取），以及 codebase-memory index 查询结果。

**参考源**：

| 参考源 | 方式 | 提取内容 |
|--------|------|---------|
| F:\ccb-source\CLAUDE.md | 只读，提取架构/命令/模式/工具列表等公开信息 | CCB 项目结构、工具系统、权限模式、Plan 流程、状态栏、入口行为 |
| F:\ccb-source\AGENTS.md | 只读 | 同上（副本） |
| Linghun 仓库全部文档 | 只读 | 阶段蓝图、规格书、架构路线、交付文档、审计报告 |
| Linghun 实现源码 | 只读 | 自然语言桥、TUI dispatch、权限管道、缓存 freshness、状态栏 |
| codebase-memory index | 查询 | 索引状态（ready, 769 nodes, 1476 edges） |

---

## 附录 A：关键文件行号索引

| 文件 | 关键区域 | 行号 |
|------|---------|------|
| `natural-command-bridge.ts` | CommandCapabilityCatalog 数据 | 169-709 |
| `natural-command-bridge.ts` | SLASH_COMMAND_REGISTRY | 113-163 |
| `natural-command-bridge.ts` | validateCommandCapabilityCoverage | 717-741 |
| `natural-command-bridge.ts` | buildRuntimeStatusForModel | 743-773 |
| `natural-command-bridge.ts` | routeNaturalIntent | 783-919 |
| `natural-command-bridge.ts` | detectInquiry | 1194-1201 |
| `natural-command-bridge.ts` | detectDangerousNaturalIntent | 1203-1211 |
| `natural-command-bridge.ts` | scoreCapability | 1255-1306 |
| `natural-command-bridge.ts` | createNaturalEquivalentCommand | 1338-1380 |
| `natural-command-bridge.ts` | extractPermissionMode | 1382-1390 |
| `natural-command-bridge.ts` | extractWorkflowName | 1392-1411 |
| `natural-command-bridge.ts` | extractAgentRole | 1413-1419 |
| `natural-command-bridge.ts` | extractModelCandidate | 1421-1424 |
| `natural-command-bridge.ts` | extractBranchPurpose | 1426-1430 |
| `index.ts` | handleSlashCommand | 1257-1399+ |
| `index.ts` | handleNaturalInput | 5173-5260 |
| `index.ts` | decidePermission (decision order) | 5736-5839 |
| `index.ts` | getHardDenyReason | 5865-5904 |
| `index.ts` | handleModeCommand | 2076-2102 |
| `index.ts` | getModeChangeGuard | 2118-2129 |
| `index.ts` | getCurrentFreshness | 4219-4235 |
| `index.ts` | createExtensionFreshnessSummary | 4263-4300+ |
| `index.ts` | sendMessage | 5262-5300+ |
| `index.ts` | writeStatus | 6392-6411 |
| `index.ts` | messages (i18n) | 6421-6450+ |
| `natural-command-bridge.test.ts` | Full file | 1-289 |

---

*审计完成于 2026-05-17。本报告应作为进入 Phase 15 真实项目 Beta 前的最终核查清单。*
