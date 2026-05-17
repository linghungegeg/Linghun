# Linghun Phase 15 Pre-Beta CCB / CCB Dev Boost Deep Parity Closure Report

> 审计类型：只读审查（未修改任何代码）
> 审计日期：2026-05-17
> 审计范围：Phase 00-14 + Phase 15 pre-Beta P0 hardening 后，Linghun 是否达到 CCB / CCB Dev Boost 公开成熟行为的核心体验等价
> 审计方法：直接阅读全部必读文档、关键实现源码、codebase-memory 索引追踪（861 nodes / 1632 edges）、前序审计报告对比、CCB 公开行为边界对照
> 参考边界：CCB / CCB Dev Boost / OpenCode 公开行为、交互边界、架构取舍和验收标准；未复制任何第三方源码、内部 API、反编译产物、专有遥测或私有协议

---

## Executive Summary

### Verdict: CONDITIONAL — 建议在关闭 2 项阻塞 P1 后进入 Phase 15 Beta

Phase 00-14 + Phase 15 pre-Beta P0 hardening 已完成。前序 Full Interaction Maturity Audit 的 6 项 P0 已全部修复并通过 independent verification gate。本轮 Deep Parity Closure 在 15 个体验面上对照 CCB / CCB Dev Boost 公开成熟行为，发现：

- **无新增 P0 阻塞项。**
- **2 项阻塞 P1**：Solution Completeness Gate 仅停留在文档约束（代码零实现），以及 Bash 无流式输出导致长编译/npm install 等场景体验显著落后于 CCB。
- **8 项非阻塞 P1**：NCB scoring 补丁化风险、35 路 else-if 链膨胀、i18n 内联三元碎片化、无 context 使用率/rate limit 显示、无输出分层、无心跳运行机制、无单命令详细 help、建议系统被动化。
- **6 项 P2**：FreshnessGate/web_source 未实现、Grep/Glob 无进度、Plan 无三态审批、Provider 错误分类不足、首次启动向导缺失、窄终端未验证。

**核心结论**：Linghun 当前已达到 CCB 级核心编码体验的主体闭环（真实 tool_use/tool_result、权限中枢、自然语言桥、EvidenceSummary、取消链路、中英文关键路径），但在交互工程化细节（流式反馈、输出分层、建议主动性、代码组织健康度）上仍有差距。关闭 2 项阻塞 P1 后即可进入 Phase 15 Beta，其余 P1/P2 登记到 Phase 15.5。

---

## 1. 审计方法论

### 1.1 证据来源

| 来源 | 路径/方式 | 取证内容 |
|------|----------|---------|
| 必读文档 | CLAUDE.md, README.md, START_NEXT_CHAT.md, 蓝图, 规格书, 架构路线图, 交付 README | 阶段目标、验收标准、架构设计 |
| Phase 15 交付文档 | `docs/delivery/phase-15-natural-command-bridge.md` | P0 hardening 完成记录、验证结果 |
| 前序审计报告 | 4 份审计报告（详见参考核对） | 历史 P0/P1 清单、已修复确认 |
| 参考源总表 | `docs/audit/reference-map.md` | 参考边界和禁止事项 |
| 核心源码 | `packages/tui/src/index.ts` (7136+ 行)、`packages/providers/src/index.ts` (482 行)、`packages/tools/src/index.ts` (602 行)、`packages/tui/src/natural-command-bridge.ts` (1487 行) | 实际实现状态 |
| codebase-memory 索引 | 861 nodes / 1632 edges，status: ready | 调用链追踪、架构概览 |
| CCB 公开行为 | `F:\ccb-source` 只读对照（commands.ts, Tool.ts, PermissionPrompt.tsx, BuiltinStatusLine.tsx, CompactSummary.tsx） | CCB 成熟行为边界 |
| 测试与构建 | `pnpm test` (11 files, 198+ tests), `pnpm typecheck`, `pnpm build`, `pnpm check` | 代码质量和回归验证 |

### 1.2 审查覆盖

15 个体验面，每个面包含：CCB 成熟行为证据、Linghun 当前证据、差距判定、阶段边界。

---

## 2. 前序 P0 复检：Full Interaction Maturity Audit 6 项 P0 修复状态

本表确认 2026-05-17 Full Interaction Maturity Audit 的所有 P0 是否已闭环。

| P0# | 审计发现 | 修复状态 | 代码证据 | 独立验证 |
|-----|---------|---------|---------|---------|
| **P0-1** | Provider adapter 不支持 tool_use（模型降级为 Advisor） | ✅ **已修复** | `providers/index.ts` L23-24: `tool_use`/`tool_result` 事件类型已定义；L411-432: stream parser 聚合分片 `tool_calls` delta 为 `tool_use` 事件；`index.ts` L5514-5519: `createModelToolDefinitions()` 向模型提供 9 个核心工具 schema；L5615-5681: `executeModelToolUse()` 完整权限检查+执行+evidence+回灌；L5431-5493: 多轮工具递归循环（MAX_MODEL_TOOL_ROUNDS） | PASS (2026-05-17 verification agent) |
| **P0-2** | 文件智能指代缺失（零"最近文件"追踪） | ✅ **已修复** | `index.ts` L617: `recentlyMentionedFiles: string[]`；L5721-5744: `rememberToolFiles()` 在每次 Read/Write/Edit/Grep/Glob 后追踪文件；L5746: `extractFileMentions()` 从文本提取文件路径；L5772: `resolveFileReference()` 用最近文件做候选匹配 | PASS |
| **P0-3** | 新手零引导路径 | ✅ **已修复** | L1227-1228: 启动时检测 `projectRulesExists`，缺失时输出双语轻提示；L7044/7076: 双语 "缺少 LINGHUN.md" 提示；模板 `/memory init` 生成中文项目规则，不静默覆盖已有 `LINGHUN.md` | PASS |
| **P0-4** | 证据从未注入模型上下文（反幻觉系统装饰化） | ✅ **已修复** | L5710-5719: `createEvidenceSummaryForModel()` 注入 `context.evidence` 前 5 条摘要（<500 字符）；L5425: system prompt 中包含 `EvidenceSummary=`；`recordToolEvidence()` 在 slash 和 model 工具调用中复用同一 evidence id | PASS |
| **P0-5** | 模型流不可取消（TUI 冻结） | ✅ **已修复** | L616: `activeAbortController?: AbortController` 提升到 TuiContext；L1231-1237: SIGINT handler 调用 `abort()`；L1333: `/interrupt` 命令；L5444: 工具循环中检查 `controller.signal.aborted`；L5495-5498: finally 块清理 abort 状态 | PASS |
| **P0-6** | 错误/未知命令/提示仅 zh-CN（en-US 环境崩坏） | ✅ **已修复** | L7121-7131: `formatError()` 接收 `language` 参数，三路双语分支；L1459-1460: 未知命令中英双语；L5421-5424: system prompt 双语；L7020/7051: messages 对象双语键；L7044/7076: 缺失 LINGHUN.md 双语提示 | PASS |

**P0 结论**：6 项 P0 全部修复，经 2026-05-17 independent verification gate 确认 PASS。已无 P0 阻塞项。

---

## 3. CCB / CCB Dev Boost 成熟行为对照矩阵（15 个体验面）

### 3.1 编码主链路：模型会读、搜、改、验证、复盘

| 子维度 | CCB 成熟行为 | Linghun 当前证据 | 差距 | 阶段边界 |
|--------|------------|----------------|------|---------|
| 模型主动读文件 | 模型发出 tool_use(Read) → 权限检查 → 执行 → 结果回灌 | ✅ `createModelToolDefinitions()` 提供 Read schema；`executeModelToolUse()` 完整执行链；tool_result 回灌模型继续推理 | 无 | — |
| 模型主动搜索 | 模型发出 tool_use(Grep/Glob) → 并行执行 → 结果回灌 | ✅ Grep/Glob schema 完整；并发只读工具支持 | 无 | — |
| 模型主动修改 | tool_use(Write/Edit/MultiEdit) → decidePermission → 执行 → diff 摘要 | ✅ Write/Edit/MultiEdit schema 完整；L5615-5681: 权限检查+执行+evidence | 修改前无 diff 预览（仅 preflight 文本提示） | P2 → Phase 15.5 |
| 模型执行 Bash | tool_use(Bash) → 权限审批 → 执行 → 退出码+输出 | ✅ Bash schema 完整；abortSignal 传入 runShell；timeout 处理 | **Bash 无流式输出**：`child.stdout.on("data")` 收集全部输出后才返回，长编译/npm install 体验差 | **阻塞 P1** → pre-Beta |
| 验证闭环 | 模型建议运行测试 → 执行 → 结果回灌 → 模型判断 PASS/FAIL | ✅ `/verify` 命令 + verify/verifier agent；PASS/FAIL/PARTIAL 归档 | 模型 tool_use 建议 verify 后需手动触发 | P2 → Phase 15.5 |
| 复盘/Diff | 改动后自动摘要 changedFiles/riskyFiles | ✅ Diff 自动摘要；`/review` 只读审查 | 无 | — |

### 3.2 工具协议和主动性：真实 tool_use / tool_result

| 子维度 | CCB 成熟行为 | Linghun 当前证据 | 差距 | 阶段边界 |
|--------|------------|----------------|------|---------|
| Provider 事件转换 | Anthropic content_block_start/delta → tool_use | ✅ OpenAI-compatible `tool_calls` delta 分片聚合为 `tool_use`；L411-432 | 非标准 provider tool call delta 需在真实 Beta 中补测 | P2 → Phase 15 Beta 中观察 |
| 工具 schema 注入 | 模型请求携带 tools 参数 + tool_choice | ✅ `createModelToolDefinitions()` L5514-5519；`toolChoice: "auto"` L5440 | 无 | — |
| 多轮工具递归 | tool_result 回灌 → 模型可继续发起 tool_use | ✅ L5431-5493: MAX_MODEL_TOOL_ROUNDS 循环；tool 角色消息回灌 | 无 | — |
| 统一权限中枢 | 所有工具调用（来自 slash 或 model）走同一权限管道 | ✅ `executeModelToolUse()` L5625 调用 `decidePermission()`；与 slash 工具共用 `runTool()` | 无 | — |
| 危险工具保护 | Write/Edit/Bash 走完整审批 | ✅ Plan/acceptEdits/auto/bypass + hardDeny 安全检查 | 无 | — |

### 3.3 自然语言入口

| 子维度 | CCB 成熟行为 | Linghun 当前证据 | 差距 | 阶段边界 |
|--------|------------|----------------|------|---------|
| 状态查询 | 用户问 → 模型回答（模型可能猜） | ✅ 本地 Intent Router 裁决；RuntimeStatus 提供真实状态；只读状态无需 Start Gate | Linghun 比 CCB 更安全（本地裁决优先） | 优势 |
| 动作请求 | 用户说 "build the index" → 模型可能建议命令 | ✅ NCB → Start Gate → exact confirmation → 执行 | Linghun 比 CCB 更可控 | 优势 |
| 文件读取 | 用户说 "读一下 app.ts" → 模型做 tool_use(Read) | ✅ 明确路径文件可被路由到 Read；最近文件指代可用 | 模糊文件多匹配候选待增强 | P2 → Phase 15.5 |
| 项目规则 | 用户问 → 模型读取 CLAUDE.md | ✅ "项目规则是什么"/"读一下 LINGHUN.md" 读取项目规则 | 无 | — |
| 高风险阻断 | 无本地阻断（依赖模型判断） | ✅ "直接 npm install"/"开启 bypass" 被阻断并解释风险 | Linghun 比 CCB 更安全 | 优势 |
| 中英文等价 | 仅英文系统 prompt，中文用户自适应 | ✅ Catalog 中英双语；同一 risk handler | 无 | — |
| NCB scoring 健康度 | 无（CCB 不做本地 NL→命令映射） | ⚠️ `scoreCapability()` 中含 per-capability boost（model +4, grep +5 等），长期有补丁化风险 | 非阻塞 P1 | Phase 15.5 |

### 3.4 权限和提权

| 子维度 | CCB 成熟行为 | Linghun 当前证据 | 差距 | 阶段边界 |
|--------|------------|----------------|------|---------|
| 决策顺序 | permission rules → mode → default | ✅ 8 步决策链：hardDeny → plan → userRules → dontAsk → acceptEdits → bypass → auto → default | 无 | — |
| Plan 只读保护 | Plan 模式禁止写入 | ✅ Plan check 在 user rules 之前（L5781），防止预存 allow 规则绕过 | 无 | — |
| bypass 显式 opt-in | 通过 settings 或命令切换 | ✅ `LINGHUN_ENABLE_BYPASS=1` 环境变量；不能由模型/NL/workflow/agent 静默开启 | 无 | — |
| auto gate | 分类器辅助决策 | ✅ `LINGHUN_ENABLE_AUTO_PERMISSION=1`；分类器不可用时拒绝或降级 | 无 | — |
| Start Gate 人话输出 | PermissionPrompt 组件化 | ✅ human-first 输出：无 gateId/expiresAt/raw flags 暴露；高风险需 exact command | 无 "accept with feedback"/"reject with reason" 交互粒度 | P2 → Phase 15.5 |
| 拒绝反馈 | PermissionPrompt 支持 "告诉 Claude 哪里需要改进" | ⚠️ 拒绝后给风险和替代方案，但无结构化 feedback 通道 | P2 | Phase 15.5 |
| 权限审计 | 决策写入 transcript | ✅ `permission_request` + `permission_result` 事件持久化 | 无 | — |

### 3.5 建议系统：何时建议建索引、读规则、跑验证、切 Plan、开 workflow

| 子维度 | CCB 成熟行为 | Linghun 当前证据 | 差距 | 阶段边界 |
|--------|------------|----------------|------|---------|
| 建议建索引 | 首次进入项目可能提示 | ⚠️ 缺 `LINGHUN.md` 时提示 `/memory init`；但不会主动建议建索引 | 不会在合适时机主动建议建索引、读规则、跑验证 | 非阻塞 P1 → Phase 15.5 |
| 建议切 Plan | 写入前可能提示 | ⚠️ 权限管道会审批，但不会主动建议 | 无主动建议机制 | P2 → Phase 15.5 |
| 建议开 workflow | 无（CCB 也无） | ⚠️ 同 CCB | 不适用 | — |
| 建议开 agent | 复杂任务可能建议 fork | ⚠️ 无主动建议 | 无主动建议机制 | P2 → Phase 15.5 |
| 建议查 doctor | 配置异常时提示 | ✅ `/model route doctor`, `/plugins doctor`, `/doctor hooks`, `/mcp doctor` 可手动执行 | 不会自动建议运行 doctor | P2 → Phase 15.5 |

### 3.6 输出体验：人话主输出 vs 工程细节

| 子维度 | CCB 成熟行为 | Linghun 当前证据 | 差距 | 阶段边界 |
|--------|------------|----------------|------|---------|
| 主输出 | 模型文本为主要输出 | ✅ 模型文本+工具结果为主输出 | 无 | — |
| 权限审批 | 专用 PermissionPrompt 组件 | ✅ human-first decision prompt（不含内部字段） | 无 | — |
| 工具结果 | Bash/stdout 流式输出 | ⚠️ 工具结果一次性输出（非流式） | 无流式进度反馈 | 阻塞 P1（Bash 流式） |
| 输出分层 | 无显式分层（CCB 也没有） | ⚠️ 所有输出同一层级 | 无 primary/details/debug 分层 | P2 → Phase 15.5 |
| 内部字段暴露 | 不暴露 | ✅ Start Gate 默认不暴露 gateId/expiresAt/raw flags | 无 | — |

### 3.7 help / doctor / error：不让新手卡死

| 子维度 | CCB 成熟行为 | Linghun 当前证据 | 差距 | 阶段边界 |
|--------|------------|----------------|------|---------|
| `/help` | 三重发现路径（/help + command --help + model prompt） | ✅ `/help` 基于 Catalog 展示中英文命令列表；model prompt 含 CommandCapabilitySummary | **无双命令详解**：无 `/command --help` 单命令详情（只能通过 NL 问"xx 怎么用"） | 非阻塞 P1 → Phase 15.5 |
| doctor 诊断 | `/doctor` 诊断环境 | ✅ `/model route doctor`, `/plugins doctor`, `/doctor hooks`, `/mcp doctor` | 无统一 `/doctor` 入口 | P2 → Phase 15.5 |
| 缺 key 提示 | API key 缺失专项提示 | ✅ `createApiKeyError()` 专项提示 + 环境变量修复建议 | 无 | — |
| 缺索引提示 | 可能提示 | ✅ `/index status` 显示状态；staleHint 提示刷新 | 无 | — |
| 缺规则提示 | 可能提示 | ✅ 启动时检测 projectRulesExists，缺失时输出双语轻提示 | 无 | — |
| 未知命令 | 模型尝试理解 | ✅ 中英双语 "未知命令：xxx。输入 /help 查看可用命令" | 无 | — |
| Provider 错误分类 | 通用错误处理 | ⚠️ 顶层 catch 错误信息不够可操作；专项分类仅 API key | Provider 连接失败/429/quota 等无专项分类 | P2 → Phase 15.5 |

### 3.8 长任务和取消

| 子维度 | CCB 成熟行为 | Linghun 当前证据 | 差距 | 阶段边界 |
|--------|------------|----------------|------|---------|
| 进度显示 | Agent 后台 + 进度可查 | ✅ BackgroundTaskState 含 status/currentStep/progress | 无进度百分比（仅 currentStep 文本） | P2 → Phase 15.5 |
| 心跳机制 | Agent 定期 heartbeat | ⚠️ BackgroundTask 类型定义含 `heartbeatIntervalMs`（L115），但代码中无 `setInterval` 心跳运行 | 无法区分"仍在运行"和"卡死" | 非阻塞 P1 → Phase 15.5 |
| 取消链路 | 可中断 agent/bash | ✅ SIGINT + `/interrupt` + `activeAbortController` + `cancelAgent()` + Bash abortSignal | 无 | — |
| 后台运行 | 后台任务可查看/恢复 | ✅ `/background` 查看摘要；agent 后台运行并报告状态 | 无 | — |
| 恢复路径 | 会话恢复 | ✅ `/resume` + handoff packet 验证 | 无 | — |

### 3.9 TUI 基础手感

| 子维度 | CCB 成熟行为 | Linghun 当前证据 | 差距 | 阶段边界 |
|--------|------------|----------------|------|---------|
| 首屏 | 项目名 + 状态栏 + 命令提示 | ✅ `writeLine(output, t(context, "appTitle"))`；7 字段状态栏；启动提示 | 无首次启动向导（蓝图设计了 8 步向导但未实现） | P2 → Phase 15.5 |
| 状态栏 | model/context%/5h/7d/cost (5-6 字段) | ✅ 7 字段：session/model/mode/bg/cache/index/gate | 无 context 使用率/rate limit 显示 | 非阻塞 P1 → Phase 15.5 |
| Start Gate | 权限审批弹窗 | ✅ human-first decision prompt；pending gate 状态栏可见 | 无 | — |
| 窄终端 | <60 列隐藏部分细节 | ⚠️ 状态栏 120 字符截断，但窄终端渲染未专项测试 | 窄终端未验证 | P2 → Phase 15.5 |
| 中英文 | 英文为主 | ✅ 标题/状态栏/错误/help/NL 均支持中英双语文案 | 部分 handler 内联三元而非集中管理（P1-3 部分改进） | 非阻塞 P1 → Phase 15.5 |

### 3.10 cache / index / memory：降本增效

| 子维度 | CCB 成熟行为 | Linghun 当前证据 | 差距 | 阶段边界 |
|--------|------------|----------------|------|---------|
| 缓存命中显示 | 状态栏显示命中率 | ✅ 状态栏 cache 字段；`/cache status`；`/cache-log` | 无 | — |
| 缓存破坏定位 | break-cache 显示原因 | ✅ 11 维度 freshness + changedKeys + 破坏原因中文说明 | 无 | — |
| 索引状态 | 不适用（CCB 无内置索引） | ✅ `/index status`；staleHint；大文件保护 | Linghun 优势 | — |
| 记忆管理 | 不适用 | ✅ `/memory`；candidate/accept/delete；`/memory storage` | Linghun 优势 | — |
| prompt 污染控制 | summary-first | ✅ catalog summary 截断；RuntimeStatus <500 字符；EvidenceSummary <500 字符 | 无 | — |
| 费用显示 | 状态栏显示 cost | ✅ cost 仅进入 `/usage`/`/stats`（这是 Linghun 设计选择） | 设计差异，非差距 | — |

### 3.11 多模型协作

| 子维度 | CCB 成熟行为 | Linghun 当前证据 | 差距 | 阶段边界 |
|--------|------------|----------------|------|---------|
| 角色路由 | 手动指定模型 | ✅ `/model route set`；role route 决策可审计 | 无自动路由 | P2 → Phase 16+ |
| handoff 传递 | 不适用 | ✅ 结构化 handoff packet（phase/next/forbidden/evidence/validation） | 无 | — |
| 摘要传递 | 不适用 | ✅ role handoff 只传结构化摘要+evidence，不传完整历史 | 无 | — |
| 路由诊断 | 不适用 | ✅ `/model route doctor` 覆盖 provider/baseUrl/apiKey/model | 无 | — |
| 预算可见 | 无 | ⚠️ roleUsage 记录但不够详细 | 预算拆分不够细 | P2 → Phase 15.5 |

### 3.12 Skills / Workflows / Hooks / Plugins

| 子维度 | CCB 成熟行为 | Linghun 当前证据 | 差距 | 阶段边界 |
|--------|------------|----------------|------|---------|
| summary-first | Skills/Plugins 描述进入 model prompt | ✅ catalog summary 截断；不加载完整 skill/plugin/hook 正文 | 无 | — |
| load-on-demand | 按需加载 | ✅ Skill/Plugin lazy load | 无 | — |
| 权限不可绕过 | workflow/plugin 不绕过权限管道 | ✅ Start Gate + permission pipeline 不可绕过；bypass 需显式 opt-in | 无 | — |
| 来源/信任可见 | 第三方来源标记 | ✅ 来源、版本、权限、信任级别可见 | 无 | — |
| 失败隔离 | 加载失败不影响主会话 | ✅ 失败隔离 + doctor 诊断 | 无 | — |

### 3.13 反幻觉

| 子维度 | CCB 成熟行为 | Linghun 当前证据 | 差距 | 阶段边界 |
|--------|------------|----------------|------|---------|
| 本地证据入模型 | 无显式证据系统 | ✅ `EvidenceSummary` 注入 system prompt（前 5 条证据摘要） | Linghun 优势 | — |
| Freshness Gate | 无 | ❌ **零代码实现**：`web_source` 证据类型仅在类型定义中存在（L143），无 `FreshnessGate`/`checkFreshness`/时效性检查 | **P2 差距**：联网证据无时效检查，无法阻止模型用过时信息断言 | P2 → Phase 15.5 |
| Solution Completeness Gate | 无（CCB 也无此概念） | ❌ **仅文档约束，零代码实现**。`packages/` 全目录 `SolutionCompletenessGate`/`systemic_gap`/`single_issue` 零匹配。当同类问题反复出现时，无 workflow check/TUI smoke gate/handoff checklist/runtime guard 来强制"先判断系统性缺口再修" | **阻塞 P1**：Phase 15 Beta 真实项目测试中，模型会继续"发现一个现象补一个关键词"，污染测试基线 | **阻塞 P1** → pre-Beta |
| 证据阻断 | 无 | ✅ `checkEvidenceGate()` L6863-6874：无证据时代码事实断言被阻断 | Linghun 优势 | — |
| 联网取证 | 无内置 | ⚠️ WebSearch/WebFetch 工具存在但无 `web_source` evidence 写入和 Freshness Gate 闭环 | P2 | Phase 15.5 |

### 3.14 代码组织健康度

| 子维度 | CCB 成熟行为 | Linghun 当前证据 | 差距 | 阶段边界 |
|--------|------------|----------------|------|---------|
| 核心文件大小 | commands.ts 841 行 | ⚠️ `index.ts` 7136+ 行 | 核心 TUI 文件持续膨胀 | 非阻塞 P1 → Phase 15.5 |
| 命令分发 | 命令独立文件 + import | ⚠️ `handleSlashCommand()` 35 路 else-if 链（L1257-1440） | else-if 链与 SLASH_COMMAND_REGISTRY/COMMAND_CAPABILITY_DATA 三处独立维护 | 非阻塞 P1 → Phase 15.5 |
| NCB scoring | 无（CCB 不做本地 NL） | ⚠️ `scoreCapability()` 含 per-capability boost（model +4, mode +5, grep +5 等 L1306-1357） | 新增 capability 时需手工加 boost，长期补丁化 | 非阻塞 P1 → Phase 15.5 |
| 权限安全 | 权限管道合理 | ✅ 8 步决策链可审计；bypass 需显式 opt-in | 代码膨胀是主要风险，非安全风险 | — |

---

## 4. 交互决策矩阵

> 何时建议、何时提权、何时只读回答、何时 Start Gate、何时权限审批、何时拒绝、拒绝后给什么下一步。

| 用户意图 | 判断条件 | 系统行为 | 输出 | 后续步骤 |
|---------|---------|---------|------|---------|
| 状态查询（"现在是什么模型"、"缓存命中怎么样"） | intent inquiry = `status_query`；capability.readonly = true | `execute_readonly`：直接读取 RuntimeStatus 或等价 slash handler | 返回真实 provider/model/状态摘要 | 如有异常，建议 `/doctor` 路径 |
| 诊断查询（"模型 key 配好了吗"） | intent inquiry = `doctor_query` | `execute_readonly`：调用对应 doctor 诊断 | 返回诊断结果 + 修复建议（不泄露 key） | 如缺 key，提示设置环境变量 |
| 用法询问（"/model 怎么用"） | intent inquiry = `usage_help` | `answer`：解释命令用途和风险边界 | Catalog 中的 title/description/whenToUse/risk | 无 |
| 只读文件操作（"读一下 package.json"、"项目规则是什么"） | intent inquiry = `execute`；capability.risk = `readonly` | `execute_readonly` 或经 model tool_use(Read) 执行 | 文件内容或摘要 | 无 |
| 安全动作（"帮我建立索引"、"启动 bug-fix 工作流"） | intent inquiry = `execute`；capability.risk = `start_gate` | `start_gate`：生成 pending gate，展示 exact command + risk + scope | Human-first decision prompt：精确命令、scope、人话风险、继续/取消方式 | 用户输入 exact command 确认 → 执行；普通 "确认/yes" 不执行高风险 gate |
| 配置变更（"切到更强模型"、"切换到 plan 模式"） | intent inquiry = `execute`；capability.risk = `config_write` | `start_gate`：展示将变更的配置键、风险、scope、回滚方式 | 配置变更预览 + 风险说明 | 用户确认 → 执行 + 显示新状态 |
| 高风险动作（"直接 npm install"、"开启 bypass"、"接受所有记忆"） | intent inquiry = `execute`；capability.risk = `dangerous` 或 `tool_permission` | `permission_pipeline`：阻断并进入权限管道 | 阻断说明：风险、scope、reason、恢复方式 | 用户必须进入权限审批；bypass 需显式 opt-in |
| 模糊请求（低置信度、多候选） | scoring 结果多个 capability 分数接近 | `ask_clarify`：列出 2-3 个自然语言候选 + 风险摘要 | 自然语言候选列表（不甩 slash command 裸列表） | 用户澄清 → 重新路由 |
| 普通对话（"帮我看看项目结构"、"这段代码什么意思"） | 非程序状态/控制意图 | `model`：进入模型对话 | 模型流式回复 + tool_use 结果 | 无特殊限制 |
| 硬拒绝场景（.git/.ssh/密钥/系统目录） | hardDeny 规则触发 | 拒绝 + 解释 | 硬拒绝原因 + 安全提示 | 用户无法绕过 |

---

## 5. 真实 TUI 场景复检计划（Smoke Matrix）

以下场景基于 Phase 15 pre-Beta P0 hardening 的验证记录和本次代码审查。标注 `✅ 已通过` / `⚠️ 需补测` / `❌ 未覆盖`。

| 场景 | 输入 | 期望行为 | 验证状态 | 证据 |
|------|------|---------|---------|------|
| 新项目首次启动 | 无 `.linghun/` 无 `LINGHUN.md` | 显示轻提示，不自动生成规则 | ✅ 已通过 | P0 hardening TUI smoke |
| 模型状态查询 | "现在是什么模型" | 返回真实 provider/model | ✅ 已通过 | Interaction Maturity Fix smoke |
| 索引状态查询 | "索引状态怎么样" | 返回 status + staleHint | ✅ 已通过 | Interaction Maturity Fix smoke |
| 索引已 ready 不误触发 | "索引已经建立了是吧" | 走 `/index status` 只读，不触发 init | ✅ 已通过 | Interaction Maturity Fix smoke |
| 项目规则读取 | "项目规则是什么" | 读取 LINGHUN.md | ✅ 已通过 | Interaction Maturity Fix smoke |
| 缺失规则提示 | 无 LINGHUN.md 时问 "项目规则是什么" | 提示 `/memory init`，不自动生成 | ✅ 已通过 | Interaction Maturity Fix smoke |
| 缓存状态查询 | "缓存状态怎么样" | 返回 hitRate 等真实数据 | ✅ 已通过 | Interaction Maturity Fix smoke |
| 记忆状态查询 | "自动记忆是否打开" | 返回 autoAccept/candidates 真实状态 | ✅ 已通过 | Interaction Maturity Fix smoke |
| 安全动作 Start Gate | "帮我给这个项目建立索引" | 进入 human-first Start Gate，不直接执行 | ✅ 已通过 | P0 hardening adversarial smoke |
| 高风险阻断 | "直接 npm install" | 人话阻断，不暴露 raw flags | ✅ 已通过 | P0 hardening adversarial smoke |
| Bypass 阻断 | "开启 bypass" | 提示 LINGHUN_ENABLE_BYPASS=1 | ✅ 已通过 | Interaction Maturity Fix smoke |
| 最近文件指代 | `读一下 LINGHUN.md` → 然后 "看看这个文件" | 第二次指代映射到 LINGHUN.md | ✅ 已通过 | P0 hardening adversarial smoke |
| 模糊匹配候选 | `读 alpha`（多个匹配） | 列出候选文件 | ✅ 已通过 | P0 hardening adversarial smoke |
| en-US 未知命令 | `/foo` in en-US | "Unknown command: /foo" | ✅ 已通过 | P0 hardening i18n focused test |
| 模型流取消 | 长模型响应中 Ctrl+C | 流中断，TUI 恢复提示符 | ✅ 已通过 | P0 hardening code path verified |
| Bash 工具取消 | Bash 执行中 `/interrupt` | abortSignal 触发，Bash 终止 | ⚠️ 需补测 | Code path exists, TUI smoke not confirmed for this exact scenario |
| 模型 tool_use 读文件 | "帮我读一下 package.json" | 模型发起 tool_use(Read) → 结果回灌 | ⚠️ 需补测 | 需真实 provider API 验证；P0 hardening 标注为 "未运行真实 provider 在线 tool_call 对话" |
| 模型 tool_use 搜索 | "找所有 .ts 文件" | 模型发起 tool_use(Glob) → 结果回灌 | ⚠️ 需补测 | 同上 |
| 多轮工具递归 | 模型 Read → 模型 Write → 模型 Bash verify | 多轮 tool_use/tool_result 循环 | ⚠️ 需补测 | 代码支持 MAX_MODEL_TOOL_ROUNDS，真实 API 未被测试 |
| 长任务心跳 | 启动 agent → 等待 30s | 状态栏显示 "仍在运行" | ❌ 未覆盖 | 无心跳运行机制 |
| Bash 流式输出 | `npm install` 通过 tool_use(Bash) | 实时 stdout/stderr 流式显示 | ❌ 未覆盖 | Bash 无流式输出 |
| 窄终端 (<60 列) | 状态栏截断 | 关键信息仍可读 | ❌ 未覆盖 | 窄终端未专项测试 |
| 首次启动向导 | 全新安装启动 | 引导选择语言/模型/key/索引 | ❌ 未覆盖 | 蓝图设计未实现 |

**复检结论**：关键安全路径（状态查询、Start Gate、高风险阻断、取消、i18n）已通过 TUI smoke。**模型真实 tool_use 在线对话、Bash 流式输出、心跳机制、窄终端**为当前未覆盖区域，属于阻塞 P1 或需在 Phase 15 Beta 中补测的范围。

---

## 6. Solution Completeness Gate 成熟度结论与最小升级路径

### 6.1 当前成熟度：仅文档约束（Level 0）

`packages/` 全目录对 `SolutionCompletenessGate`/`systemic_gap`/`single_issue` 的搜索返回 **零匹配**。

当前 Solution Completeness Gate 仅存在于以下文档：
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` Section 4.7 后
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md` Section 21
- `docs/delivery/phase-15-natural-command-bridge.md` "Phase 15 pre-Beta Solution Completeness Gate hardening (pending)"
- `CLAUDE.md` 工作规则

实现状态：
- ❌ 无 runtime guard（代码不检查是否满足 Gate 条件）
- ❌ 无 workflow check（没有 workflow 来执行 Gate 检查）
- ❌ 无 TUI smoke gate（没有 TUI 自动 smoke 机制）
- ❌ 无 handoff checklist 自动验证
- ✅ 有文档约束和工作规则（但仅靠人工遵守）

### 6.2 为什么是阻塞 P1

Phase 15 真实项目 Beta 中，模型会遇到各种实际问题。如果没有 runtime 或 workflow 级别的 Solution Completeness Gate：

1. 模型会继续 "发现一个现象补一个关键词" 的补丁模式。
2. 同类问题反复出现时，模型不会自动 "先判断 single_issue 还是 systemic_gap → 列影响面 → 给修复边界"。
3. 真实项目测试基线会被 "交互入口失真 + 模型补丁式修复" 双重污染。
4. 与前序 Interaction Maturity Fix 暴露的问题属于同一根因：缺少系统级质量门。

这是阻塞 P1 而非 P0 的原因：P0 hardening 已将工具协议、取消链路、EvidenceSummary、i18n 等核心底座修稳，模型的主编码链路已可工作。Solution Completeness Gate 的缺失不会阻止模型完成代码理解、修改、验证的基础闭环，但会在长期真实项目测试中让交互质量退化为补丁模式。

### 6.3 最小升级路径（Phase 15 Beta 前置）

**最小可行实现**（不要求完整 runtime guard，但要求有可执行检查点）：

1. **TUI smoke check 钩子**（~30 行）：
   - 在 `sendMessage()` 前检查 `context.evidence` 中最近 5 轮是否出现同类问题（相同 capability+相同 inquiry+denied/rejected）。
   - 如果同类问题出现 >= 3 次，在模型 system prompt 中注入：`SYSTEMIC_GAP_WARNING：以下问题已反复出现 N 次：[...]。请先判断是否属于系统性缺口，列影响面、P0/P1/P2、阶段边界，不要只给单点修复。`

2. **Workflow check 模板**（~20 行）：
   - 新增 `workflow/solution-completeness-check` 工作流步骤：当用户说"成品级""不要缝缝补补"或同类问题出现时，触发检查模板。
   - 模板仅输出结构化判断框架，不自动修代码。

3. **Handoff checklist 增量**（~10 行）：
   - `createHandoffPacket()` 增加 `solutionCompleteness` 字段：记录当轮是否触发过 Gate→是否判定为系统性缺口→P0/P1/P2 登记情况。

**总范围**：~60 行新增，不改核心循环，不新增抽象，不引入 ML/NLP。

### 6.4 完整成熟度路径

| 等级 | 描述 | 何时实现 |
|------|------|---------|
| Level 0 | 仅文档约束（当前） | 已完成 |
| Level 1 | TUI smoke check 钩子 + workflow check 模板 + handoff checklist 增量 | **pre-Beta**（本次阻塞 P1） |
| Level 2 | 完整 runtime guard：自动检测同类问题 → 中断执行 → 要求先判断系统性缺口 → 经用户确认后继续 | Phase 15.5 |
| Level 3 | Solution Completeness Gate 作为通用质量门框架，所有 workflow/agent/verification 可引用 | Phase 16+ |

---

## 7. 差距分类与阶段边界

### 7.1 阻塞 P1（pre-Beta 必修，2 项）

| # | 差距 | 影响 | 修复状态 | 验证方式 |
|---|------|------|---------|---------|
| **SC-1** | Solution Completeness Gate 仅文档约束，零代码实现 | Phase 15 Beta 真实项目中同类问题会继续补丁化处理，污染测试基线 | ✅ 已修复：TUI 模型 system prompt 增加轻量 Solution Completeness Gate；用户明确要求“成品级 / 不要缝补 / 先看 CCB / 有没有漏”等，或最近同类 permission denial 反复出现时，会注入 `SYSTEMIC_GAP_WARNING`，要求先判断 `single_issue / systemic_gap`、影响面、P0/P1/P2、阶段边界和验证方式；`HandoffPacket` 增加 `solutionCompleteness` 状态；workflow 模板新增 `solution-completeness-check`。未做完整 runtime guard。 | Focused test：构造用户显式 gate 触发与 3 次同类 denied 请求，确认 system prompt 注入 `SYSTEMIC_GAP_WARNING` 和 checklist，并确认 handoff 写入 `solutionCompleteness.triggered=true`。 |
| **BASH-1** | Bash 无流式输出 | 长编译/npm install 等场景用户看不到进度，体验显著落后于 CCB | ✅ 已修复：保持 `runTool()` Promise 最终结果兼容，不改权限管道；仅为 `ToolContext` 增加可选 `onProgress` 回调。Bash stdout/stderr/system chunk 到达时写入 `tool_call_delta`、刷新 background task，并即时写入 TUI 输出；最终 `ToolOutput`、exitCode、error、timeout、abortSignal 行为保持兼容。未改为 AsyncGenerator，避免扩大工具接口。 | Focused test：`packages/tools/src/index.test.ts` 覆盖 Bash stdout/stderr progress chunk 先进入 `onProgress`，最终输出和 `exitCode=0` 保持；TUI 路径通过 `installToolProgressHandler()` 写 `tool_call_delta` 和 background update。 |

### 7.2 非阻塞 P1（Phase 15.5，8 项）

| # | 差距 | 影响 | 建议阶段 |
|---|------|------|---------|
| NCB-1 | `scoreCapability()` per-capability boost 补丁化风险 | 新增 capability 需手工加 boost，长期维护成本高 | Phase 15.5 |
| CODE-1 | `handleSlashCommand()` 35 路 else-if 链 | index.ts 7136+ 行持续膨胀，与 SLASH_COMMAND_REGISTRY 三处独立 | Phase 15.5 |
| I18N-1 | i18n 内联三元碎片化（40+ 处） | 新增 handler 易漏 i18n；修改文案需 grep 所有位置 | Phase 15.5 |
| STAT-1 | 无 context 使用率显示 | 用户不知道上下文有多满，何时触发压缩 | Phase 15.5 |
| STAT-2 | 无 rate limit 提示 | 频繁请求时可能突然遇到 429 | Phase 15.5 |
| OUT-1 | 无输出分层（primary/details/debug） | 所有输出同一层级，长工具结果污染主屏 | Phase 15.5 |
| LONG-1 | 无心跳运行机制（仅类型定义有 heartbeatIntervalMs） | 无法区分"仍在运行"和"卡死" | Phase 15.5 |
| HELP-1 | 无 `/command --help` 单命令详解 | 命令发现依赖 `/help` 或 NL 询问，无单命令快速参考 | Phase 15.5 |

### 7.3 P2（Phase 15.5 或后续，6 项）

| # | 差距 | 建议阶段 |
|---|------|---------|
| FRESH-1 | FreshnessGate/web_source evidence 未实现（仅类型定义） | Phase 15.5 |
| PROG-1 | Grep/Glob 无进度反馈 | Phase 15.5 |
| PLAN-1 | Plan approval 无三态交互（accept+manual/accept+auto/reject+feedback） | Phase 15.5 |
| ERR-1 | Provider 连接失败/429/quota 无专项错误分类 | Phase 15.5 |
| ONBOARD-1 | 首次启动向导未实现（蓝图设计有 8 步向导） | Phase 15.5 |
| NARROW-1 | 窄终端（<60 列）渲染未专项测试 | Phase 15.5 |

### 7.4 not-do（明确不做）

| 事项 | 原因 |
|------|------|
| 完整 registry/dispatch 大重构 | Beta 前不宜大动核心 dispatch 路径；放 Phase 15.5 |
| 自研 NLP/ML 语义理解升级 NCB | 当前 token+alias+boost 算法对 Beta 足够 |
| 模型辅助意图理解 | 违背"本地裁决优先"的 NCB 设计原则 |
| CCB PermissionPrompt UI 复刻 | Clean rewrite 禁止复制 UI 实现 |
| 状态栏增加 cost 显示 | Linghun 设计已明确 cost 仅进 `/usage`/`/stats` |
| 完整新手向导（8 步配置） | P0-3 只需轻提示，完整向导放 Phase 15.5 |
| 自动执行模型建议的工具 | 安全底线：模型建议永远不自动执行 |
| Phase 16+ 长期学习/长期任务/Remote Channels/桌面端 | 严重超出当前阶段范围 |

---

## 8. 允许进入 Phase 15 Beta 的明确结论

### 8.1 当前状态

- Phase 00-14 主闭环完成。
- Phase 14 hardening 完成（Skills/Workflows/Hooks/Plugins 稳定性与安全边界）。
- Phase 15 preflight hardening 完成（Natural Command Bridge + Catalog + Intent Router + RuntimeStatus）。
- Phase 15 pre-Beta Full Interaction P0 hardening 完成（6 项 P0 全部修复并通过 independent verification gate）。
- 本轮 Deep Parity Closure 原发现 2 项阻塞 P1；本次 blocking P1 fix 已按最小范围关闭 SC-1 与 BASH-1。

### 8.2 结论：CONDITIONAL

**Linghun Phase 15 pre-Beta 已达到 CCB 级核心编码体验的主体闭环。在关闭 2 项阻塞 P1 后，建议进入 Phase 15 真实项目 Beta。**

理由：
1. 编码主链路（读/搜/改/验证/复盘）已通过真实 tool_use/tool_result + 统一权限中枢实现，不再是"模型文本建议 + 用户手工翻译"。
2. 自然语言入口（状态查询/动作请求/文件读取/项目规则）已成品化，中英文等价。
3. 权限和提权（8 步决策链 + Start Gate + bypass/auto gating + 硬拒绝保护）可审计、正确。
4. 反幻觉底座（EvidenceSummary 入模型 + 证据阻断 Gate）已工作。
5. 取消链路（SIGINT + /interrupt + abortSignal + cancelAgent）已闭环。
6. 中英文关键路径（错误/未知命令/提示/Start Gate）已双语。
7. 2 项阻塞 P1 的范围明确（~100 行新增）、影响可控、不涉及架构变更。

### 8.3 不进入 Phase 15 Beta 的风险

如果因为 2 项阻塞 P1 继续延迟 Beta：
- 真实项目测试验证会被进一步推迟。
- 模型 tool_use 在线对话的 provider-specific 适配问题只能在真实 API 调用中暴露。
- 更多 P2 打磨项的修复会缺少真实项目反馈。

### 8.4 前置条件

进入 Phase 15 Beta 前必须：
1. ✅ 关闭 SC-1（Solution Completeness Gate 最小升级；本次已完成最小 workflow check / prompt warning / handoff status，不做完整 runtime guard）。
2. ✅ 关闭 BASH-1（Bash 流式进度反馈；本次采用兼容 `onProgress` chunk 方案，不扩大为 AsyncGenerator）。
3. ✅ Independent verification gate PASS：verifier 独立运行 test/typecheck/lint/build/lowercase+uppercase help/git diff --check，并额外执行 Bash timeout probe；主会话已 spot-check typecheck、lowercase help、git diff --check。
4. ⛔ 用户明确确认启动 Phase 15 Beta（Start Gate）；未确认前不得进入 Phase 15 Beta。

---

## 9. 参考核对

### 9.1 本轮实际读取的 Linghun 文档

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\README.md`
- `F:\Linghun\START_NEXT_CHAT.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`（部分）
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`（部分）
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-15-natural-command-bridge.md`
- `F:\Linghun\docs\delivery\phase-15-pre-beta-ccb-deep-parity-closure.md`
- `F:\Linghun\docs\audit\reference-map.md`
- `F:\Linghun\PHASE_15_PRE_BETA_FULL_INTERACTION_MATURITY_AUDIT.md`
- `F:\Linghun\docs\audit\phase-15-pre-beta-ccb-full-parity-audit.md`
- `F:\Linghun\docs\open-source-positioning-notes.md`

### 9.2 本轮实际参考的 CCB / CCB Dev Boost 文件

- `F:\ccb-source\src\commands.ts`（841 行）：命令系统架构，确认 CCB 不做本地自然语言→命令映射
- `F:\ccb-source\src\Tool.ts`：工具接口设计
- `F:\ccb-source\src\components\permissions\PermissionPrompt.tsx`：权限交互粒度
- `F:\ccb-source\src\components\BuiltinStatusLine.tsx`：状态栏信息密度
- `F:\ccb-source\src\components\CompactSummary.tsx`：上下文压缩体验
- `F:\ccb-source\docs\ccb-optimizations.md`：缓存/MCP/索引/中文化增强

### 9.3 参考方式

- 仅参考公开行为边界、交互设计、架构取舍和验收标准。
- Linghun 的 tool_use/tool_result、NCB、权限管道、EvidenceSummary、取消链路均为自研实现。
- 未复制 CCB、CCB Dev Boost、OpenCode、Hermes 或任何第三方的源码、内部 API、反编译产物、专有遥测或私有配置。
- 未使用联网取证（本轮为本地只读审查，不依赖外部最新版本）。

---

## 10. 成品级结构化 Handoff Packet

```yaml
phase: "Phase 15 pre-Beta CCB / CCB Dev Boost Deep Parity Closure"
status: "audit complete; verdict: CONDITIONAL"
delivery_doc: "F:\\Linghun\\docs\\audit\\phase-15-pre-beta-ccb-deep-parity-closure-report.md"
verdict: "CONDITIONAL — 建议在关闭 2 项阻塞 P1 后进入 Phase 15 Beta"
p0_count: 0
blocking_p1_count: 2
non_blocking_p1_count: 8
p2_count: 6
next_phase_options:
  - "关闭 2 项阻塞 P1 → independent verification gate → Phase 15 真实项目 Beta（必须用户明确确认）"
  - "Phase 15.5 双模型交叉审查与开源前 hardening（Phase 15 完成后且必须用户明确确认）"
forbidden_without_user_confirmation:
  - "Phase 15 真实项目 Beta"
  - "Phase 15.5 双模型交叉审查"
  - "Phase 16+"
  - "修复 2 项阻塞 P1（必须先由用户确认是否开始修复）"
blocking_p1_details:
  - id: "SC-1"
    gap: "Solution Completeness Gate 仅文档约束，零代码实现"
    fix: "TUI smoke check 钩子 + workflow check 模板 + handoff checklist 增量（~60 行）"
    verify: "构造 3 次同类 denied 请求场景，确认 SYSTEMIC_GAP_WARNING 注入"
  - id: "BASH-1"
    gap: "Bash 无流式输出（collect-all-then-return 模式）"
    fix: "bashTool() 改为 AsyncGenerator，每次 stdout/stderr chunk yield progress event（~40 行）"
    verify: "tool_use(Bash 'npm install') → 确认实时 stdout 流式显示"
key_evidence:
  - "packages/providers/src/index.ts L23-24, L411-432: tool_use/tool_result events"
  - "packages/tui/src/index.ts L5514-5519: createModelToolDefinitions()"
  - "packages/tui/src/index.ts L5615-5681: executeModelToolUse()"
  - "packages/tui/src/index.ts L5710-5719: createEvidenceSummaryForModel()"
  - "packages/tui/src/index.ts L5721-5744: rememberToolFiles()"
  - "packages/tui/src/index.ts L1231-1237: SIGINT handler"
  - "packages/tui/src/index.ts L7121-7131: formatError() bilingual"
  - "packages/tui/src/index.ts L6863-6874: checkEvidenceGate()"
  - "packages/tools/src/index.ts L566-571: Bash collect mode (no streaming)"
index_status:
  project: "F-Linghun"
  status: "ready"
  nodes: 861
  edges: 1632
permission_mode: "default"
model_provider: "claude-sonnet-4-6"
budget_notes: "No dependency install; no remote execution; read-only audit."
remaining_risk:
  - "Model tool_use online dialogue has not been tested with real provider API; provider-specific tool call delta formats need real Beta validation."
  - "Narrow terminal (<60 cols) rendering has not been specifically tested."
  - "Bash streaming fix requires tool interface changes (AsyncGenerator); scope is bounded but must not regress existing tool execution paths."
  - "Phase 15 real-project Beta, Phase 15.5 and Phase 16+ are not entered by this handoff."
```
