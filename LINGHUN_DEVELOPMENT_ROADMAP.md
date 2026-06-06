# Linghun 开发总路线图（三份审计报告合并）

**生成日期**：2026-06-07
**来源**：`CODE_AUDIT_2026-06-07.md`（自审 107 文件）+ `CCB_VS_LINGHUN_AUDIT_2026-06-07.md`（CCB 对比 ~190 核心文件）+ `CCB_FULL_LINE_AUDIT.md`（CCB 全量逐行扫描 2674 文件/614,222 行）+ `CCB_STRUCTURE_SCAN.md`（结构扫描 2165 文件/479k 行）
**CCB vs Linghun 空 catch 硬数据**：CCB 3 个 vs Linghun 16+ 个——错误处理严谨度差距
**原则**：
- 不降级——每项任务必须提升 Linghun，不允许退化
- 大文件拆分暂不处理——保持现状，只做功能/质量改进
- 每个 Phase 独立交付、独立验证、不可跳阶段
- 每个任务含：具体位置 → 做什么 → 验收标准

---

## Phase A：正确性修复（立即，不依赖其他阶段）

所有发现的实际 bug——必须修复，无任何前置条件。

| # | 问题 | 位置 | 修复方法 | 验收 |
|---|------|------|---------|------|
| A1 | 未知 workflow step.action 静默返回 completed | `workflow-command-runtime.ts:1391-1402` | 缺少的 else 分支：对未知 action 返回 `{ status: "blocked" }` 而非默认 `"completed"` | 未知 action 的 registry workflow 步骤不再静默成功 |
| A2 | MAX_BACKGROUND_TASKS 定义冲突 | `tui-agent-job-runtime.ts:62` (值=8) vs `tui-context-runtime.ts:496` (值=50) | 统一为导出版 50，删除模块私有 8 | `rememberBackgroundTask` 使用 50 上限 |
| A3 | workflowStepStatusFromNestedJob 默认返回 completed | `workflow-command-runtime.ts:1444-1458` | 对 `created` 等未覆盖状态显式返回 `"blocked"` | 未知 job 状态不再误报完成 |
| A4 | validateProviderApiKey 对 undefined 抛 TypeError | `config/src/index.ts:899` | 参照 `validateProviderModel:919` 添加 `if (!value)` 守卫 | undefined 输入返回结构化 LinghunError |
| A5 | verifyFailureLearningContract 中 `void` 调用可能导致 unhandled rejection | `job-agent-command-runtime.ts:2174-2176, 3635-3637` | 替换为 `.catch()` 显式处理 | 无静默 unhandled rejection |
| A6 | Anthropic 流解析残留 tool_use 静默丢弃 | `providers/src/index.ts:1905-1911` | 参照 OpenAI 实现（1828-1839），在流结束检测残留 pendingToolUses 并 emit error | 孤儿 tool_use 不被静默丢弃 |
| A7 | normalizeProviderError 中 2 个路径未脱敏 | `providers/src/index.ts:2539, 2518` | 在这些路径上调用 `maskSensitiveFragments` | API key 不在错误消息中泄漏 |
| A8 | `approval.warnings.map(...)` 若 warnings 为 undefined 崩溃 | `pending-details-presenter.ts:63` | 添加 `approval.warnings?.map(...) ?? []` | undefined warnings 降级为空数组 |
| A9 | `estimatedCny.toFixed(4)` 不检查 NaN | `usage-stats-presenter.ts:32` | 添加 `Number.isNaN(estimatedCny) ? "估算中" : estimatedCny.toFixed(4)` | NaN 输出人性化文本 |
| A10 | `bundled-runtime.ts` 源文件不存在，测试文件遗留 | 根目录 | 删除 `bundled-runtime.test.ts` 孤儿测试文件 | 测试套件无缺失模块错误 |
| A11 | `deep-compact-runtime.ts:86` — AbortController 创建但从不 abort | `deep-compact-runtime.ts:86` | 移除未使用的 controller 或在超时路径调用 abort | 无废 AbortController |
| A12 | activityTicker 无停止逻辑——ExitPromise 永不 resolve 则 interval 永久泄漏 | `tui/src/index.ts:1586-1587` | 在 `finally` 块中 `clearInterval(activityTicker)` | activityTicker 在 TUI 退出后正确回收 |
| A13 | feishu WS `close()` 不可等待、无错误处理、无事件注销 | `feishu-long-connection-runtime.ts:36-39` | 将 `close` 改为 awaitable + 调用前注销 `im.message.receive_v1` 事件监听 | WS 关闭后无事件泄漏 |
| A14 | `context.backgroundTasks` 无 undefined 守卫，若结构不完整崩溃 | `model-stream-runtime.ts:1322-1327` | 在每个 `.some()` 调用前添加 `context.backgroundTasks?.` 可选链 | undefined backgroundTasks 不崩 |
| A15 | 未知 Ink 事件类型闯入 submit 路径——触发空输入提交 | `tui/src/index.ts:2197-2223` | 在事件处理链末尾添加 `else` 分支记录 unrecognized event + return | 未知事件不再触发副作用 |
| A16 | `extension-command-runtime.ts:618` — `--ref` 作为最后一个 arg 时值为 undefined | `extension-command-runtime.ts:618` | `args[args.indexOf("--ref") + 1]` 后检查 `!== undefined` 并校验非空 | undefined ref 返回错误而非静默传播 |

---

## Phase B：自审修复（不依赖 CCB 知识）

Linghun 自己的代码质量问题——无 CCB 参考也能修。

### B1：错误吞没消除

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| B1.1 | `core/src/jsonl.ts:47-53` | `fileExists()` catch 返回 false——权限错误被当文件不存在 | 区分 ENOENT（返回 false）vs 其他 error（重新抛出） |
| B1.2 | `core/src/session-store.ts:195-201` | `readMetadata()` catch 返回 null | 区分 ENOENT vs 其他 error（后者写 system event 再返回 null） |
| B1.3 | `core/src/session-store.ts:211-217` | `safeReadDir()` catch 返回 [] | 区分 ENOENT vs EACCES（后者写日志） |
| B1.4 | `providers/src/index.ts:1171-1177` | `safeReadResponseText()` catch 返回 undefined | 记录诊断日志后返回 undefined |
| B1.5 | `tools/src/index.ts:1420-1426` | `safeReadText()` catch 返回 null | 同 B1.4 |
| B1.6 | `tui/src/tui-output-surface.ts:74-82` | `compactOutputMemory()` fire-and-forget 无 rejection 处理 | 追加 `.catch()` 写 system event |
| B1.7 | `config/src/index.ts:829-832` | backup 恢复失败 `catch {}` 空块 | 至少写 `lastConfigRecoveryWarning` |
| B1.8 | `break-cache-runtime.ts:81-91, 110, 138-145` | 所有写操作 try/catch 吞错 | 追加 `appendSystemEvent` 警告日志 |
| B1.9 | `hydratePersistentAgents` 中两处空 catch | `job-agent-command-runtime.ts:3467-3468, 3513` | 追加 system event 记日志 |
| B1.10 | `tui/src/index.ts:1677-1686` | cycle-permission-mode `catch {}` 空块 | 追加 `console.error` 或 `writeErrorLine` |
| B1.11 | `model-tool-runtime.ts:524` | `runBoundaryBashPreflight` 空 `catch {}` 吞所有 readFile 异常 | 至少记录 warning 级 system event |
| B1.12 | `slash-command-runtime.ts:2844-2847` | `createIndexSafetyRepairPlan` 空 catch 吞所有文件读取错误（含权限/磁盘故障） | 区分 ENOENT（当作文件不存在）vs 其他错误（重新抛出） |
| B1.13 | `mcp-stdio-runtime.ts:150-153` | JSON.parse 失败 `catch {}` 静默跳过非 JSON 行——可能丢弃合法数据帧 | 解析失败时记录 warning system event 含原始行内容 |
| B1.14 | `compact-cache-command-runtime.ts:331-333` | `refreshCompactPressureSnapshot` catch 后仅 `= undefined`，无事件/日志 | 追加 system event 记日志 |
| B1.15 | `workflow-command-runtime.ts:418` | 空 catch 吞所有 readdir 错误（权限、ENOENT） | 区分错误类型，写 event 后降级 |
| B1.16 | `workflow-command-runtime.ts:490-492` | `readWorkflowRunState` catch 返回 null，吞 JSON 解析错误 | 解析失败写 warning event，含文件路径 |

### B2：死代码清理

| # | 位置 | 发现 |
|---|------|------|
| B2.1 | `model-tool-runtime.ts` | 37 个死导入——从 20 个模块导入但文件内零引用。删除：writeLightHints、formatWorkflows、checkClaimSupport、isPotentiallyMutatingMcpTool、runMcpStdioToolCall、evaluateMetaScheduler、createToolInputSchema、routeNaturalIntent、buildRuntimeStatusForModel、formatPendingApprovalDetails、createReportFinalReferenceReminder 等 |
| B2.2 | `model-loop-runtime.ts:818` | `detectHighRiskClaims` 是 `extractStructuredFinalAnswerClaims` 的纯别名——改为 re-export |
| B2.3 | `model-loop-runtime.ts:1305-1310` | `buildDowngradedFinalAnswer` 接受但不使用 `originalText`——若确认永远不用则移除参数 |
| B2.4 | `compact-cache-command-runtime.ts:705-707` | `hashFileContent` 定义但从不被调用（被 `slash-command-runtime.ts:2873` 本地版本遮蔽） |
| B2.5 | `slash-command-runtime.ts:2125` | `_builtInToolsHashCache` 声明但从不赋值/读取 |
| B2.6 | `workflow-command-runtime.ts:2236-2241` | `findWorkflowSliceTitle` 定义但从不调用 |
| B2.7 | `natural-command-bridge.ts:2016-2018` | `isOrdinaryDevelopmentRequest` 定义但从不调用 |
| B2.8 | `job-agent-command-runtime.ts:44, 95, 104` | `formatJobAgentLabels`/`isActiveBackgroundStatus`/`toJobContext`——3 个死导入 |
| B2.9 | `job-agent-command-runtime.ts:3033-3034` | `"Bash"/"Write"/"Edit"/"MultiEdit"` 硬编码与 L138 `AGENT_PERMISSION_BRIDGE_TOOLS` Set 重复——统一引用 |
| B2.10 | `model-stream-runtime.ts:100` | `_cooldown` 别名 import 从未使用 |
| B2.11 | `config/src/index.ts:1876-1883` | `inferProviderForModel` 全仓库无调用者 |
| B2.12 | `runner-runtime.ts:124-130` | `sanitizeDiagnosticText` 本地重复定义（应从 `startup-runtime.ts` 导入） |
| B2.13 | `providers/src/index.ts:1102` | `throw lastError` 不可达死代码 |
| B2.14 | `model-tool-runtime.ts:1513-1526` | `parseStringFieldToolInput` 全仓库无引用——死函数 | 删除 |
| B2.15 | `model-stream-runtime.ts:1696-1698` | 冗余 `replaceAssistantBlockContent` 调用——逻辑上永不执行 | 删除冗余调用 |
| B2.16 | `providers/src/index.ts:1447-1463` | Builder 侧 orphan 注入是死代码——`repairToolMessagePairing` 已修复所有缺失 | 删除或注释标注"defense-only dead code" |
| B2.17 | `providers/src/index.ts:1532` | `createAnthropicTools` 中 `!tools` 分支是死分支——调用方已做守卫 | 删除死分支 |
| B2.18 | `providers/src/index.ts:1493-1495` | `(contract.supportsTools && request.toolChoice)` 空分支（仅含注释） | 删除或改为完整分支 |
| B2.19 | `workflow-command-runtime.ts:2264` | `"workflow_preview_only"` 拼写错误（缺少 'v'） | 改为 `"workflow_preview_only"` |
| B2.20 | `model-loop-runtime.ts:1440` | `buildExtendedDowngradedFinalAnswer` 同样 `void originalText` | 与 B2.3 一并处理——移除死参数 |

### B3：硬编码消除

| # | 位置 | 硬编码 | 修复 |
|---|------|--------|------|
| B3.1 | `config/src/index.ts:491` + `providers/src/index.ts:2500` | `"https://api.deepseek.com/v1"` 双份副本 | 提取为 `DEFAULT_DEEPSEEK_BASE_URL` 常量，一处定义双向引用 |
| B3.2 | `tui-context-runtime.ts:487` + `config/src/index.ts:514` | `"codebase-memory-mcp"` 双份 | 消除冲突——仅 tui-context-runtime 定义，config 从 runtime-budget 导入 |
| B3.3 | `mcp-index-command-runtime.ts:6` + `mcp-index-runtime.ts:66` | `"LINGHUN_CODEBASE_MEMORY_MCP"` 双份 | 统一为一个常量 |
| B3.4 | `config/src/index.ts:575` | `"feishu-cli"` 硬编码 | 环境变量覆盖路径 `LINGHUN_FEISHU_CLI` |
| B3.5 | `"Ctrl+O"` 在 15+ 文件 30+ 处 | 无集中常量 | 定义 `TOGGLE_DETAILS_KEYBIND = "Ctrl+O"` |
| B3.6 | `config/src/index.ts:405-455` | 7 个 model route 全硬编码 `provider: "deepseek"` | 保持但添加注释标注——这是配置默认值 |
| B3.7 | `runtime-budget.ts` 8 个常量 | 全部不可配置 | 为 `MAX_AGENTIC_TURNS`、`VERIFICATION_COMMAND_TIMEOUT_MS` 添加 env 覆盖路径 |
| B3.8 | `tui-context-runtime.ts` ~15 个常量 | 全部不可配置（`MAX_BACKGROUND_TASKS=50`、`BACKGROUND_RUNNING_GLOBAL_CAP=4` 等） | 为 `BACKGROUND_RUNNING_GLOBAL_CAP`、`MAX_EVIDENCE_RECORDS`、`REQUEST_SLOW_HINT_MS` 添加 env 覆盖 |
| B3.9 | `compact-preflight-runtime.ts` 6 个 context window 常量 | `DEFAULT_CONTEXT_WINDOW_TOKENS=128000` 等 | 为 `DEFAULT_CONTEXT_WINDOW_TOKENS` 添加 env `LINGHUN_CONTEXT_WINDOW_TOKENS` 覆盖 |
| B3.10 | `providers/src/index.ts:367-368` | `PROVIDER_STREAM_IDLE_TIMEOUT_MS=30000`、`PROVIDER_REQUEST_TIMEOUT_MS=30000`、`BREAKER_COOLDOWN_MS=45000` 不可配置 | 添加 env 覆盖路径 `LINGHUN_PROVIDER_TIMEOUT_MS` 等 |
| B3.11 | `handoff-session-runtime.ts:327-334` | `keyFiles` 数组硬编码 6 个具体文件路径 | 从 config/memory 动态生成或提供默认值回退 |
| B3.12 | `config/src/index.ts:349` | `defaultDeepSeekModel` fallback `"deepseek-chat"` | 已有 env 覆盖但应标注为可配置 |

### B4：代码重复消除

| # | 涉及文件 | 重复内容 | 修复 |
|---|---------|---------|------|
| B4.1 | `startup-runtime.ts` + `runner-runtime.ts` | `sanitizeDiagnosticText` 定义两次 | 统一到 startup-runtime，runner 导入 |
| B4.2 | `process-command-runtime.ts` + `runner-runtime.ts` | `redactedPath` 定义两次 | 统一到 startup-runtime |
| B4.3 | `job-agent-command-runtime.ts` + `slash-command-runtime.ts` | `createSilentOutput` 定义两次 | 提取为共享导出 |
| B4.4 | `cache-freshness.ts` + `compact-context.ts:287-301` | `stableHash`/`stableStringify` 完全相同 | compact-context 从 cache-freshness 导入 |
| B4.5 | `context-estimator.ts` + `compact-context.ts` | 字符估算两套实现（depth 6 vs 8, 固定开销 24 vs 28） | 统一到 context-estimator，compact-context 导入 |
| B4.6 | `cache-command-runtime.ts:136-143` + `compact-preflight-runtime.ts:450-457` + `deep-compact-runtime.ts:586-593` | 密钥脱敏正则三份 | 提取到 `shared/src/index.ts` |
| B4.7 | `slash-command-runtime.ts:2605-2827` | `requestIndexRefreshApproval` 与 `requestIndexInitFastApproval` 95% 重复 | 提取共享权限管道函数 |
| B4.8 | `mcp-stdio-runtime.ts` | `runMcpStdioToolCall` 与 `runMcpStdioToolList` 共享 60%+ 结构：spawn/settle/pending map/sendRequest/stdout frame parsing | 提取为共享基类 `createMcpStdioRunner` |
| B4.9 | `footer-view.ts` + `view-model.ts` | `truncateMiddle`/`sliceFront`/`sliceBack` 两套几乎相同实现 | 统一到 `text-utils.ts` |
| B4.10 | `extension-slash-runtime.ts` | `handleSkillsCommand`/`handlePluginsCommand` 80%+ 重复 | 提取共享命令模板函数 |
| B4.11 | `providers/src/index.ts:2136-2138` | `cacheWriteTokens` 双字段冗余：`cacheWriteTokens: number\|undefined` + `cacheWriteTokensRaw: number\|null` | 统一为一个字段 |

---

## Phase C：CCB 成熟度对齐——P0（费用、Git、Token）

必须在下一阶段功能之前实现的基础能力。

| # | 任务 | 参考 CCB | 具体实现 | 验收 |
|---|------|---------|---------|------|
| C1 | **实时费用计算** | `modelCost.ts`——`calculateUSDCost()` + 定价表 | 在 `addRoleUsage` 中按 `modelName` 查定价表计算 CNY，存储到 `RoleUsage.estimatedCny`。内置 DeepSeek/OpenAI 常用模型定价 | `/usage` 显示非零 CNY 金额 |
| C2 | **TUI 实时费用显示** | StatusLine `$1.23` + `getTotalCost` | 在 footer-view 中添加 `formatCost` 段，显示累计 CNY | 状态栏显示实时累计费用 |
| C3 | **Git 状态自动注入** | `context.ts`——`getGitStatus` memoized, 1000 char | 在 `createModelSystemPrompt` 中添加 `gitStatus` 段：当前分支、git status --short、最近 5 提交、`git config user.name` | 系统提示含有 git 上下文 |
| C4 | **按文件类型 token 估算** | `tokenEstimation.ts`——`bytesPerTokenForFileType`（JSON=2, default=4） | 在 `context-estimator.ts` 添加 `bytesPerTokenForFileType(fileExt)` | JSON 估算更精确 |
| C5 | **模型定价表** | `modelCost.ts` `MODEL_COSTS` 映射 | 在 config 包定义 `MODEL_PRICING: Record<string, { inputPer1K, outputPer1K, currency }>` | `/usage` 显示精确到模型的成本 |
| C6 | **拼写修复** | - | `workflow-command-runtime.ts:2264` "workflow_preview_only" → "workflow_preview_only"（补 'v'） | 拼写正确 |

---

## Phase D：CCB 成熟度对齐——P1（工具、命令、Token 计数）

### D1：工具系统升级

| # | 任务 | 参考 CCB | 具体实现 |
|---|------|---------|---------|
| D1.1 | **每个工具独立文件** | 每工具独立目录（`XTool.ts` + `prompt.ts` + `UI.ts`） | 从 `tools/src/index.ts` 拆分 9 个工具到 `packages/tools/src/tools/<Name>/` 各目录 |
| D1.2 | **CoreTool 接口补齐** | `CoreTool` 25+ 方法 | 为 `ToolDefinition` 添加：`isReadOnly()`、`isDestructive()`、`checkPermissions()`（返回 allow/deny/ask）、`userFacingName()`、`getToolUseSummary()`、`prompt()`、`getActivityDescription()` |
| D1.3 | **工具的 prompt.ts 提示词** | BashTool 93 行、TodoWriteTool 182 行提示词 | 为每个工具编写 `prompt.ts`——告诉模型何时使用、何时不用、最佳实践 |
| D1.4 | **`buildTool()` 工厂** | `Tool.ts:804-813`——7 个 fail-closed 默认值 | 实现 `createTool(def)` 工厂：`isReadOnly: false`、`isConcurrencySafe: false`、`isDestructive: false` |
| D1.5 | **Diff 工具 schema 补齐** | - | `createToolInputSchema` 为 Diff 添加专属 schema（当前落入错误 fallback） |

### D2：命令系统升级

| # | 任务 | 参考 CCB | 具体实现 |
|---|------|---------|---------|
| D2.1 | **命令注册表路由** | `COMMANDS[]` 数组 + `findCommand()` | 从 `slash-command-runtime.ts` 提取 60+ 命令到 `Record<string, CommandHandler>` 注册表 |
| D2.2 | **PromptCommand 类型** | `type: 'prompt'`——模型驱动命令 | `CommandHandler` 添加 `promptCommand?: boolean`。实现 `/commit`、`/init`、`/security-review` 为 PromptCommand |
| D2.3 | **`/init` 命令** | `init.ts`——8 阶段 CLAUDE.md 创建 | 用 PromptCommand 实现——给模型的 ~200 行提示词：询问范围→探索代码→编写文件→创建技能→总结 |
| D2.4 | **`/security-review` 命令** | 190 行安全审查提示词 | PromptCommand——收集 git diff + 模型分析 SQL 注入/XSS/RCE + 过滤误报 + Markdown 报告 |
| D2.5 | **`/commit-push-pr` 命令** | `commit-push-pr.ts` | PromptCommand——分支→提交→推送→gh pr create，含 heredoc 归因 |
| D2.6 | **`/init-verifiers` 命令** | 5 阶段验证器向导 | PromptCommand——检测项目→安装验证工具→交互确认→生成 SKILL.md |
| D2.7 | **`/context` 命令增强** | `context.tsx`——API-view 可视化 | 在压缩/裁剪变换后显示上下文使用率 |
| D2.8 | **`/model` 命令增强** | `model.tsx`——交互式选择 + 别名 + 1M 检查 | 添加模型别名匹配和上下文窗口感知 |

### D3：Token 计数系统

| # | 任务 | 参考 CCB | 具体实现 |
|---|------|---------|---------|
| D3.1 | **API Token 精确计数** | `countMessagesTokensWithAPI()` | 在 `model-stream-runtime.ts` 的 usage 事件后调用 API countTokens 端点 |
| D3.2 | **上下文利用率百分比** | `calculateContextPercentages()` | 在 `/context` 和 status line 显示 `上下文 15% (12k/200k)` |
| D3.3 | **Context Window 获取** | `getContextWindowForModel()` ——模型特定 | 从 provider config 或模型能力表中获取 maxInputTokens |

---

## Phase E：自审修复——测试覆盖

Linghun 的关键无测试文件——每个必须补测。

| # | 文件 | 行数 | 测试要求（最小） |
|---|------|------|----------------|
| E1 | `model-stream-runtime.ts` | 2313 | `sendMessage` 的 stream event 处理（6 event type）+ abort 路径 |
| E2 | `model-tool-runtime.ts` | 2604 | 工具分发路由（deferred/git/index/control/builtin）+ `executeLinghunControlToolUse` 7 个控制工具 |
| E3 | `job-agent-command-runtime.ts` | 3901 | `runModelBackedAgent` agent 循环 + tool loop 终止条件 + mailbox 消费 |
| E4 | `slash-command-runtime.ts` | 2997 | 10 个最常用命令的 handler 路径 |
| E5 | `workflow-command-runtime.ts` | 2200 | `executeWorkflowStep` 所有 mainChain 分支 + `executeRegistryWorkflowStep` 未知 action 路径 |
| E6 | `permission-approval-runtime.ts` | 1056 | `executePermissionApprove` 11 种 kind 全覆盖 |
| E7 | `permission-policy-engine.ts` | 972 | 每种决策结果：auto_allow_readonly/require_permission/hard_deny |
| E8 | `request-lifecycle-presenter.ts` | ~300 | `classifyProviderFailure` 25 种错误分类（至少覆盖 15 种） |
| E9 | `mcp-stdio-runtime.ts` | 434 | `runMcpStdioToolCall` 正常/错误/超时/abort 四路径 |
| E10 | `compact-preflight-runtime.ts` | ~600 | `prepareMessagesForProviderPreflight` 10+ 分支全覆盖 |
| E11 | `remote-inbound-bridge-runtime.ts` | 752 | 配对创建/验证/取消 + inbox 入队/清空 |
| E12 | `evidence-runtime.ts` | ~600 | `recordProviderFailureEvidence` + `captureFailureLearning` + `recordVerificationEvidence` |
| E13 | `cache-command-runtime.ts` | ~290 | `collectLightHints`/`writeLightHints` 提示收集和去重逻辑 |
| E14 | `break-cache-runtime.ts` | ~290 | `buildPromptCacheRequestFields`/`consumeBreakCacheNonceForRequest`——所有写操作吞错，需在修复 B1.8 后补测 |
| E15 | `deep-compact-runtime.ts` | ~750 | `runDeepCompact`/`maybeRunDeepCompactBeforeProvider`/`shouldRunDeepCompact`——当前 AbortController 废代码（A11） |
| E16 | `compact-cache-command-runtime.ts` | ~880 | 19 个导出函数——至少覆盖 `getCurrentFreshness`/`refreshCacheFreshness`/`executeBreakCacheMutation` |
| E17 | `handoff-session-runtime.ts` | ~450 | `hydrateResumeContext`/`loadOrCreateHandoffPacket`——会话恢复核心路径 |
| E18 | `natural-command-bridge.ts` | 2290 | `routeNaturalIntent` 21 个分支——至少覆盖 8 种 intent action |
| E19 | `connector-runtime.ts` | ~600 | `connectAppConnector`/`listAppConnectors`——HTTP local connector |
| E20 | `index-result-presenter.ts` | ~330 | `scanIndexSafety`/`summarizeIndexResult` |

---

## Phase F：CCB 成熟度对齐——P2（Provider、权限、安全）

### F1：Provider 合约化

| # | 任务 | 参考 CCB | 具体实现 |
|---|------|---------|---------|
| F1.1 | **ClientFactories DI 模式** | `registerClientFactories()` + `registerHooks()` | 拆 `OpenAiCompatibleProvider` 的三个协议构建器（chat/responses/anthropic）到独立文件 |
| F1.2 | **流 Idle Watchdog** | 90 秒无 chunk 主动 abort | 在 `withStreamIdleTimeout` 中添加 watchdog |
| F1.3 | **6 种重试路径** | 升级重试/max_tokens 恢复/collapse drain | 在 `sendMessage` 中添加重试上下文 |
| F1.4 | **错误分类补齐到 25 种** | `errorUtils.ts` | 添加 `prompt_too_long`/`pdf_too_large`/`tool_use_mismatch`/`duplicate_tool_use_id`/`server_overload`/`ssl_cert_error` 等 |
| F1.5 | **非流式 Fallback** | `executeNonStreamingRequest()` | `sendMessage` 在流失败时回退到非流式请求 |

### F2：权限系统补齐

| # | 任务 | 参考 CCB | 具体实现 |
|---|------|---------|---------|
| F2.1 | **`checkPermissions()` 三分支** | `{ behavior: 'allow'|'deny'|'passthrough' }` | 每个工具实现 `checkPermissions()`——allow 不需要审批，deny 硬拒绝，passthrough 走权限管道 |
| F2.2 | **Denial Tracking** | 连续 3 次/总计 20 次→回退询问 | `hasRepeatedPermissionDenial` 返回 boolean，触发模式切换提示 |
| F2.3 | **"Always Allow" 持久化** | `PermissionUpdate` 持久化到 settings | 用户确认后写入 `permissions.rules[]` 并持久化 |
| F2.4 | **Windows 安全检查** | `filesystem.ts`——ADS/8.3/DOS device/UNC | `process-guard.ts` 或新文件 `platform-security.ts`：8 个 Windows 攻击面检测 |
| F2.5 | **危险文件/目录列表** | `DANGEROUS_FILES` + `DANGEROUS_DIRECTORIES` | 定义 `.gitconfig`、`.bashrc`、`.ssh/` 等受保护路径，权限管道自动拒绝 |

### F3：MCP 升级

| # | 任务 | 参考 CCB | 具体实现 |
|---|------|---------|---------|
| F3.1 | **MCP Server 去重** | 基于签名去重（`stdio:${cmd}` / `url:${url}`） | `addMcpServer` 前检查重复 |
| F3.2 | **tool calls 结果验证** | `validateCodebaseMemoryToolExecution` 需补全 | 从 `requiredArgs` 和 schema 完整性做完整验证 |
| F3.3 | **MCP 传输层扩展** | SSE + HTTP + WebSocket 支持 | 从本地 stdio-only 扩展到至少支持 SSE |

---

## Phase G：CCB 成熟度对齐——P3（远程、Feature Flag、内存、键绑定）

### G1：远程能力

| # | 任务 | 参考 CCB | 具体实现 |
|---|------|---------|---------|
| G1.1 | **本地 REPL 协议** | `replBridge.ts`——register→poll→acknowledge→heartbeat→stop→deregister | Unix domain socket / WebSocket，第二客户端连入 |
| G1.2 | **4 层去重** | recentPostedUUIDs + initialMessageUUIDs + recentInboundUUIDs + FlushGate | 实现 BoundedUUIDSet + FlushGate |
| G1.3 | **JWT Token 自动刷新** | 过期前 5 分钟主动刷新 | 如使用 JWT 认证则添加 refreshScheduler |

### G2：特性门控

| # | 任务 | 参考 CCB | 具体实现 |
|---|------|---------|---------|
| G2.1 | **Feature Flag 系统** | `feature('KAIROS') ? require(...) : null` | 在构建时根据 flags 决定是否包含模块 |
| G2.2 | **实验性命令门控** | `isEnabled()` + availability 过滤 | `deferred-tools-catalog` 中 `executable: false` 改为 feature-flag 驱动 |

### G3：内存系统

| # | 任务 | 参考 CCB | 具体实现 |
|---|------|---------|---------|
| G3.1 | **`@include` 递归内存** | `claudemd.ts`——深度上限 5，循环检测 | 在 memory 加载中实现跨文件递归引用 |
| G3.2 | **条件规则（glob-matched）** | frontmatter `paths:` 按文件类型匹配 | 解析 `.linghun/rules/*.md` 的 frontmatter |
| G3.3 | **内存文件 40k 字符限制** | `MAX_MEMORY_CHARACTER_COUNT = 40000` | 超限截断并提示用户 |

### G4：键绑定系统

| # | 任务 | 参考 CCB | 具体实现 |
|---|------|---------|---------|
| G4.1 | **集中式键绑定引擎** | `keybindings/` 16 文件 | 定义 `context: "global"|"chat"|"autocomplete"` 三层作用域 |
| G4.2 | **用户自定义键绑定** | `~/.claude/keybindings.json` + JSON Schema + chokidar 热重载 | `.linghun/keybindings.json` 可覆盖默认绑定 |
| G4.3 | **和弦支持** | `ctrl+x ctrl+k` | 解析多键和弦 |

---

## 不纳入本路线图的项目

以下问题在审计中发现但**不纳入当前开发路线图**——在这些项目上 Linghun 已做出不同的架构决策：

- **大文件拆分**（用户明确要求暂不处理）——15 个超过 1000 行的文件保持现状，只在新功能中自然地最小拆分
- **CCB 的 Swarm/tmux 多代理**——Linghun 的 in-process multi-agent 已实现基于角色的路由，不需要 tmux 依赖
- **CCB 的 Advisor 工具**——Linghun 已通过 MetaScheduler + Final Answer Gate 实现类似的结果审查
- **CCB 的 1M 上下文**——暂时不需要，当前使用模型不需要 1M 窗口
- **CCB 的 OAuth 认证**——Linghun 用 provider.env 配置 API key，不依赖 OAuth
- **CCB 的 GrowthBook 远程特性门控**——如果 Linghun 保持 local-first，不需要远程门控
- **CCB 的 AI 驱动自动模式 (YoloClassifier)**——Linghun 的确定性规则策略引擎是更好的路线，不改为 LLM 分类
- **CCB 的 Policy Limits（组织策略）**——Linghun 是个人开发者工具，不需要企业策略

---

## 阶段依赖关系

```
A（立即修复）→ 独立
B（自审修复）→ 独立于 C-G
C（P0 对齐）→ 独立
D（P1 对齐）→ 依赖 A（工具系统修复后才能 D1）
E（测试覆盖）→ 依赖 A+B（修复后才能测试）
F（P2 对齐）→ 依赖 C+D（Provider/权限基础就绪后）
G（P3 对齐）→ 依赖 D+F（命令/Feature Flag/Provider 就绪后）
```

## 附加数据：CCB vs Linghun 全量对比扫描结果

以下数据来自 CCB 全量逐行扫描脚本（2674 文件/614,222 行）与 Linghun 全量逐行扫描（107 文件/~36,000 行）的交叉对比：

| 维度 | CCB（2674 文件/614k 行） | Linghun（107 文件/36k 行） | 差距 |
|------|--------------------------|--------------------------|------|
| 空 catch 吞错 | **3 个** | **16+ 个** | Linghun 多 5 倍——错误处理是硬差距 |
| 硬编码 URL | 715 处 | 多重（双重 DeepSeek URL 等） | CCB 也有大量硬编码但大多为 API endpoint |
| 魔法数字（无命名常量） | 817 处 | 80+ 处 | 同等水平 |
| void Promise 无 catch | 扫描中 | 3 处已确认 | 同等水平 |
| 超大文件 (>500行) | 50 个（最大 6542 行） | 15 个（最大 3901 行） | CCB 神文件更大但模块数也多 25 倍 |
| 工具独立文件 | 48 个（每工具独立目录） | 9 个（全部在同一文件） | 架构差距 |
| 命令独立模块 | 70+ 个 | 60+ 个（同一 if/else-if 链） | 组织差距 |
| Provider 独立文件 | 4 个（Anthropic/OpenAI/Gemini/Grok） | 1 个神类 | 架构差距 |

**CCB 神文件榜单**（>2000 行）：
- `REPL.tsx` 6542, `messages.ts` 5979, `print.ts` 5840, `main.tsx` 5587, `hooks.ts` 5191, `sessionStorage.ts` 5121, `toolCalls.ts` 4471, `bashParser.ts` 4433, `attachments.ts` 4079, `claude.ts` 3568, `client.ts`(mcp) 3460, `pluginLoader.ts` 3306, `insights.ts` 3206, `bridgeMain.ts` 2997, `bash/ast.ts` 2680, `PromptInput.tsx` 2651, `marketplaceManager.ts` 2644, `bashSecurity.ts` 2635, `bashPermissions.ts` 2622, `yoga-layout/index.ts` 2582, `ManagePlugins.tsx` 2504, `replBridge.ts` 2478, `auth.ts`(mcp) 2466, `Config.tsx` 2180, `pathValidation.ts` 2059, `query.ts` 2046, `auth.ts` 2000

---

**每阶段完成标准**：
1. 所有任务有具体 diff
2. 能独立运行 + 验证
3. 无回归（跑 vitest 全量）
4. 更新 `docs/delivery/phase-XX-*.md`

---

## 任务总数

| 阶段 | 名称 | 任务数 | 来源 |
|------|------|--------|------|
| A | 正确性修复 | 16 | Linghun 自审（bug） |
| B1 | 错误吞没消除 | 16 | Linghun 自审 |
| B2 | 死代码清理 | 20 | Linghun 自审 |
| B3 | 硬编码消除 | 12 | Linghun 自审 |
| B4 | 代码重复消除 | 11 | Linghun 自审 |
| C | CCB P0 对齐（费用/Git/Token） | 6 | CCB 对比 |
| D1 | 工具系统升级 | 5 | CCB 对比 |
| D2 | 命令系统升级 | 8 | CCB 对比 |
| D3 | Token 计数系统 | 3 | CCB 对比 |
| E | 测试覆盖 | 20 | Linghun 自审 |
| F1 | Provider 合约化 | 5 | CCB 对比 |
| F2 | 权限系统补齐 | 5 | CCB 对比 |
| F3 | MCP 升级 | 3 | CCB 对比 |
| G1 | 远程能力 | 3 | CCB 对比 |
| G2 | 特性门控 | 2 | CCB 对比 |
| G3 | 内存系统 | 3 | CCB 对比 |
| G4 | 键绑定系统 | 3 | CCB 对比 |
| **总计** | | **141** | |
