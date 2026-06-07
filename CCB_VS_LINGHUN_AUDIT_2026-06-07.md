# CCB vs Linghun 全量代码审计对比报告

**审计日期**：2026-06-07  
**审计范围**：CCB (claude-code-best v2.4.3) 核心源码 vs Linghun 全量代码库  
**方法**：三轮共 11 路并行智能体 + 1 次结构扫描脚本 + 直接 Read 精读关键文件  
**CCB 规模**：2165 非测试 TS/TSX 文件，479,329 行  
**CCB 精读覆盖**：~190 个核心文件逐行精读 + 2674 文件逐行模式扫描(614,222行) + 27目录结构扫描
**空catch硬数据**：CCB 3 个 vs Linghun 16+ 个  

---

## 一、Provider 抽象层

### 1.1 CCB 架构：水平隔离 + DI 注入

CCB 没有统一的 Provider interface。每个 provider 是独立的 async generator 函数，运行时字符串分发：

| Provider | 文件 | 行数 | 分派方式 |
|----------|------|------|---------|
| Anthropic | `src/services/api/claude.ts` | 3568 | `queryModel()` 默认分支 L1375 |
| OpenAI | `src/services/api/openai/index.ts` | 513 | 动态 `await import()` L1335 |
| Gemini | `src/services/api/gemini/index.ts` | 216 | 动态 `await import()` L1350 |
| Grok | `src/services/api/grok/index.ts` | 233 | 动态 `await import()` L1363 |

用 `registerClientFactories()` + `registerHooks()` 两个注册函数做依赖注入——`@ant/model-provider` 包**本身不发起任何网络请求**。

**`ClientFactories` 接口**（`client/types.ts:5-35`）含 4 个工厂：
- `getAnthropicClient` — 返回 Anthropic 客户端（支持 firstParty/Bedrock/Foundry/Vertex 四种后端）
- `getOpenAIClient` — OpenAI 兼容客户端
- `streamGeminiGenerateContent` — Gemini 原生流
- `getGrokClient` — Grok 客户端

**`ModelProviderHooks` 接口**（`hooks/types.ts:8-48`）含 11 个钩子：`logEvent`、`reportCost`、`getToolPermissionContext`、`getFeatureFlag`、`getSessionId`、`addNotification`、`getAPIProvider`、`getOrCreateUserID`、`isNonInteractiveSession`、`getOauthAccountInfo`

### 1.2 Linghun 现状

`providers/src/index.ts` 2751 行单文件。`Provider` interface (L151-157) 仅 2 方法。`OpenAiCompatibleProvider` 单类承载所有协议。`DeepSeekProvider` 仅 11 行构造函数包装。

### 1.3 Claude.ts 核心流程（对比 Linghun sendMessage）

**CCB `queryModel()`（claude.ts L1040-1071）：**
- 消息归一化：`normalizeMessagesForAPI()` + `stripExcessMediaItems()` + `ensureToolResultPairing()`（L1274-1331）
- 多 Provider 分派：先 openai → 再 gemini → 再 grok → 最后 Anthropic 默认（L1332-1373）
- Stream Idle Watchdog：90 秒无 chunk 主动 abort（L1949-2010）
- Stream Stall 检测：30 秒无事件记录 stall 日志（L2021-2048）
- 非流式 Fallback：`executeNonStreamingRequest()` max_tokens 上限截断 64k（L831-940）
- 6 种重试路径：max_output_tokens_escalate、collapse_drain_retry、reactive_compact_retry 等

**Linghun `sendMessage()`（model-stream-runtime.ts L359-1022）：**
- 663 行单函数
- `prepareMessagesForProviderPreflight()` 做上下文管理
- for-await 循环处理 stream event
- 无 idle watchdog、无 stall 检测、无非流式回退、无多轮恢复重试

### 1.4 错误分类对比

| 维度 | CCB | Linghun |
|------|-----|---------|
| 错误分类种类 | 25 种（`errors.ts`：aborted/api_timeout/repeated_529/rate_limit/server_overload/prompt_too_long/pdf_too_large/tool_use_mismatch/credit_balance_low/ssl_cert_error 等） | ~10 种 |
| 流错误脱敏 | `maskSensitiveFragments` 覆盖 4 处正则 | 2 个错误路径未脱敏（`providers/index.ts:2539`） |

---

## 二、工具系统

### 2.1 接口设计：CoreTool (200 行) vs ToolDefinition (10 字段)

**CCB 两层 Tool 接口：**

底层 `CoreTool<Input, Output, P, Context>`（`agent-tools/types.ts:111-203`）含 25+ 个方法/属性：

| 类别 | 方法/属性 | 说明 |
|------|----------|------|
| 身份 | `name`、`aliases?`、`searchHint?` | 工具标识和搜索 |
| Schema | `inputSchema: ZodType`（必选）、`inputJSONSchema?`（MCP 用）、`outputSchema?` | Zod v4 类型安全 |
| 执行 | `call(args, context, canUseTool, parentMessage, onProgress?)` | 统一调用签名 |
| 描述 | `description()`、`prompt()` | 均 async，可基于 tools 集合动态生成 |
| 行为 | `isReadOnly()`、`isConcurrencySafe()`、`isEnabled()`、`isDestructive?()`、`isOpenWorld?()`、`interruptBehavior?()`、`requiresUserInteraction?()` | 安全元数据 |
| 权限 | `validateInput?()`、`checkPermissions()`（非可选——必须重写） | 返回 allow/deny/passthrough 三分支 |
| 渲染 | `userFacingName()`、`renderToolUseMessage()`（必实现）、`renderToolResultMessage?()`、`renderToolUseProgressMessage?()`、`renderToolUseRejectedMessage?()`、`renderToolUseErrorMessage?()`、`getToolUseSummary?()`、`getActivityDescription?()` | Ink/React UI |
| MCP | `isMcp?`、`isLsp?`、`shouldDefer?`、`alwaysLoad?`、`mcpInfo?` | 延迟加载支持 |
| 其他 | `inputsEquivalent?()`、`getPath?()`、`isResultTruncated?()`、`mapToolResultToToolResultBlockParam()`、`maxResultSizeChars` | 去重/路径/输出 |

上层 `Tool` 类型（`src/Tool.ts:383-716`）在 CoreTool 上追加 8+ 个 React 渲染方法。

**Linghun**：`tools/src/index.ts` 1872 行，9 个工具全部内联。`ToolDefinition<Input>` 仅 10 个字段。无 Zod 验证，无 `checkPermissions()` 三分支，无渲染层集成。

### 2.2 `buildTool()` 工厂 + 默认值（vs Linghun 无工厂）

CCB `buildTool<D>(def)`（`Tool.ts:804-813`）：
```
TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: () => false,   // fail-closed
  isReadOnly: () => false,          // fail-closed
  isDestructive: () => false,
  checkPermissions: (input) => ({ behavior: 'allow', updatedInput: input }),
  toAutoClassifierInput: () => '',
  userFacingName: () => def.name   // 始终用 tool 名
}
```
7 个 fail-closed 默认值 spread 后被 `def` 覆盖。

### 2.3 每个工具的 prompt.ts + UI.ts 伴生文件

CCB 的每个工具目录包含：
- `XTool.ts` — 工具实现
- `prompt.ts` — 系统提示段（BashTool 93 行、TodoWriteTool 182 行）
- `UI.tsx` — `renderToolUseMessage`/`renderToolResultMessage`/`renderToolUseProgressMessage`/`renderToolUseRejectedMessage`
- `limits.ts` — 工具特定限制（FileReadTool 有完整三层优先级：env var → GrowthBook → 默认值）

### 2.4 工具数量与覆盖

| 维度 | CCB | Linghun |
|------|-----|---------|
| 工具总数 | ~48 个（各自独立目录） | 9 个（同一文件内联） |
| CCB 有 Linghun 无的 | WebSearchTool、WebFetchTool、WebBrowserTool、LSPTool、NotebookEditTool、SkillTool、TaskOutputTool、TeamCreateTool、CronCreateTool、REPLTool、SnipTool、TerminalCaptureTool、VerifyPlanExecutionTool、ListMcpResourcesTool、VaultHttpFetchTool、LocalMemoryRecallTool、AskUserQuestionTool、SubscribePRTool、PushNotificationTool、MonitorTool、ListPeersTool、CtxInspectTool、TungstenTool、SleepTool、ReviewArtifactTool、WorkflowTool、SyntheticOutputTool | - |

---

## 三、命令系统

### 3.1 架构差异：注册表 vs if/else-if

**CCB**：`commands.ts`（L290-424）的 `COMMANDS()` 函数返回 ~170+ 个 `Command` 对象。三种类型：
| 类型 | 说明 | 示例 |
|------|------|------|
| `PromptCommand` | AI 驱动——`getPromptForCommand()` 展开为 content block 发送给模型 | `/commit`、`/init`、`/security-review`、`/init-verifiers` |
| `LocalCommand` | 程序化——`load()` 惰性加载 + 纯文本输出 | `/compact`、`/context(非交互)` |
| `LocalJSXCommand` | Ink UI——`load()` 返回完整 React 组件 | `/resume`、`/mcp`、`/model`、`/doctor` |

7 源合并：bundled skills → builtin plugin skills → `.claude/skills` → workflow commands → plugin commands → plugin skills → COMMANDS 数组（`loadAllCommands()` L527-547）。

特性门控：`feature('KAIROS') ? require(...) : null`（L66-165），bun bundler 做 tree-shaking。

**Linghun**：`slash-command-runtime.ts` 3075 行。`handleSlashCommand` 中 ~55 个 `if (command === "/...")` 顺序分支。**无 PromptCommand 类型**——所有 Linghun 命令都是本地执行的，无法通过提示词委托模型。

### 3.2 CCB 独有命令（Linghun 完全没有）

| 命令 | 类型 | 说明 |
|------|------|------|
| `/init` | Prompt | ~200 行提示词，分 8 阶段创建 CLAUDE.md/技能/钩子 |
| `/commit` | Prompt | git 提交工作流，用受限工具集 |
| `/init-verifiers` | Prompt | 5 阶段验证器创建向导 |
| `/security-review` | Prompt | ~190 行安全审查提示词，覆盖 SQL 注入/RCE/XSS 等 |
| `/commit-push-pr` | Prompt | git 分支→提交→推送→创建 PR |
| `/compact` | Local | 三层压实策略（session memory/microcompact/full compact） |
| `/context` | Local-JSX | API-view 上下文可视化（compact boundary/collapse 变换后） |
| `/usage`（`/cost`） | Local-JSX | 会话成本 + token 计数 |
| `/keybindings` | Local-JSX | 键盘快捷键自定义，JSON Schema 校验 + chokidar 热重载 |
| `/daemon` | Local-JSX | 守护进程管理（status/start/stop/attach/logs/kill） |
| `/ide` | Local-JSX | IDE 检测/连接/打开项目 |
| `/model` | Local-JSX | 交互式模型选择 + 别名匹配 + 1M 访问检查 |

---

## 四、会话管理

| 维度 | CCB | Linghun |
|------|-----|---------|
| 持久化 | 服务端 API（`/v1/sessions`、`/v1/sessions/{id}/events`） | 本地 JSONL + session.json |
| 会话列表 | 远端 API 按状态过滤（idle/working/waiting） | 本地文件系统 readdir + 按 updatedAt 排序 |
| 事件加载 | 从 API 逐页拉取（100 条/页，`before_id` cursor） | `SessionStore.resume()` 读本地全文 |
| 崩溃恢复 | bridgePointer + perpetual mode + 3 次重试 | 无——无独立进程 |
| Branch | SpawnMode 进程级隔离（single-session/worktree/same-dir） | 无 |
| Assistant/KAIROS | GrowthBook gate 控制的守护进程模式 | 无 |

---

## 五、远程/Bridge

CCB `src/bridge/` 30+ 文件，完整的双向 REPL 协议。Linghun 仅 webhook 通知。

| 维度 | CCB | Linghun |
|------|-----|---------|
| 协议 | Environments API (poll) + Bridge JWT (SSE) | HTTP Local Connector (localhost only) |
| 认证 | OAuth + JWT worker token（过期前 5 分钟自动刷新） | api_key / local_token |
| 去重 | 4 层 UUID（recentPostedUUIDs + initialMessageUUIDs + recentInboundUUIDs + FlushGate） | 无 |
| 崩溃恢复 | bridgePointer + perpetual + 3 次重试 | 无 |
| Transport | WS/SSE + CCRClient (dual transport) | 仅 HTTP |
| Spawn 模式 | single-session/worktree/same-dir | 无独立 spawner |
| 工作分发 | register→poll→acknowledge→heartbeat→stop→deregister | 无 |

---

## 六、权限系统

### 6.1 决策管道对比

**CCB**（`filesystem.ts:1030-1205`）：9 步安全检查（read）：
1. 原始路径检查→2. 符号链接解析→3. Windows 黑名单→4. Claude 设置保护→5. 危险文件列表→6. 内部路径映射→7. 工作目录验证→8. 权限规则匹配→9. 回退到 ask

写入权限（5 步）：原始路径 + 符号链接路径双查 + 多个危险文件/目录保护列表。

**Linghun**：`permission-policy-engine.ts` 确定性规则，无 Windows 特定安全检查、无双路径符号链接检查、无内部路径映射。

### 6.2 Auto Mode (YoloClassifier)

CCB 的 Auto Mode 用 **2 阶段 XML 分类器**（LLM 调用）：
- Stage 1（fast）：`max_tokens=64`，`stop_sequences=['</block>']`，输出 `yes/no` + 理由
- Stage 2（thinking）：仅在 Stage 1 blocked 后运行，`max_tokens=1024`
- Iron Gate：fail-closed（deny）或 fail-open（passthrough）取决于 GrowthBook 配置
- Denial Tracking：连续 3 次拒绝/总共 20 次拒绝→回退到人工提示
- 使用 `cache_control` 优化分类器成本

### 6.3 文件系统安全（CCB 有，Linghun 完全缺失）

| 安全检查 | CCB | Linghun |
|---------|-----|---------|
| Windows ADS（替代数据流） | `filesystem.ts` | 无 |
| 8.3 短名称 | `filesystem.ts` | 无 |
| 尾随点/空格 | `filesystem.ts` | 无 |
| DOS 设备名称（CON/NUL/PRN） | `filesystem.ts` | 无 |
| 连续点攻击 | `filesystem.ts` | 无 |
| UNC 路径 | `filesystem.ts` | 无 |
| 危险目录列表（`.git`/`.vscode`/`.idea`/`.claude`） | `filesystem.ts:74-79` | 无 |
| 危险文件列表（`.gitconfig`/`.bashrc`/`.ssh` 等） | `filesystem.ts:57-68` | 无 |

---

## 七、Context 与 Compaction

| 维度 | CCB | Linghun |
|------|-----|---------|
| 上下文窗口 | 模型特定（默认 200k，1M 检测 `[1m]` 后缀 + GrowthBook experiment） | 字符计数器 + 令牌估算 |
| 1M Context | `CLAUDE_CODE_DISABLE_1M_CONTEXT` env + beta header + capability 查询 | 无 |
| 槽位保留 | `CAPPED_DEFAULT_MAX_TOKENS`=8k, `ESCALATED_MAX_TOKENS`=64k | 无 |
| Compaction | 三层：session memory → microcompact → full compact | micro compact + deep compact |
| Deep Compact | 无（服务端依赖 `STREAM_ONLY`） | **Linghun 优势**——本地 LLM 驱动 |
| 上下文利用率 | `calculateContextPercentages()` 零 token 防闪烁保护 | `context-estimator.ts` 仅估算 |
| Git 状态注入 | `getGitStatus` memoized，1000 字符截断 | 无自动注入 |

---

## 八、费用追踪

| 维度 | CCB | Linghun |
|------|-----|---------|
| 成本数据 | 真实 USD，`calculateUSDCost()`，按模型定价表 | `estimatedCny: 0` 全零占位 |
| 按模型追踪 | `getModelUsage(): { [modelName]: { costUSD } }` | 无 |
| 基于速度定价 | Opus 4.6 fast/standard 模式不同 rate | 无 |
| 未知模型 | `trackUnknownModelCost()` 分析事件 | 无 |
| TUI 显示 | StatusLine 实时显示 cost + token + 代码行数 | 需手动 `/usage` |
| 持久化 | `saveCurrentSessionCosts()` 写入项目 config | 会话 store 中隐式记录 |

---

## 九、MCP 集成

| 维度 | CCB | Linghun |
|------|-----|---------|
| 传输层 | 7 种（stdio/sse/sse-ide/http/ws/sdk/claudeai-proxy） | 仅本地 stdio |
| 配置作用域 | 7 个（local/user/project/dynamic/enterprise/claudeai/managed） | 单一配置文件 |
| OAuth / XAA | `McpOAuthConfigSchema`，含 clientId/callbackPort/authServerMetadataUrl | 无 |
| 去重 | 基于签名（URL/命令）跨插件/手动/连接器 | 无 |
| 策略 | 基于名称/命令/URL 的 allowlist + denylist | 信任级别 + mutating 门控 |
| 工具发现 | SDK `tools/list`，完整 description/inputSchema | `tools/list` 仅名称，描述截断至 120 字符 |

---

## 十、Skills/内存加载

### 10.1 CCB 的 `claudemd.ts`（1477 行）

**5 层优先级加载**：Managed &gt; User &gt; Project &gt; Local &gt; AutoMem &gt; TeamMem

**`@include` 指令**：跨文件引用，深度上限 5，循环检测。解析 @include 引用时读取文件内容并递归合并。

**条件规则（glob-matched）**：`.claude/rules/*.md` 文件，frontmatter `paths:` 仅对匹配文件类型/目录生效。

**外部包含跟踪**：标记来自项目 CWD 外部的 `@include`，警告用户。

### 10.2 Linghun 缺失

- 无 `@include` 递归（Linghun memory 是扁平文件列表）
- 无条件规则（按 glob 匹配 `.md` 规则）
- 无 TeamMem 层
- 无 AutoMem（MEMORY.md 入口点）
- 无 HTML 注释去除
- 无内存字符限制（CCB 40k 截断，`claudemd.ts:91`）

---

## 十一、Token 估算

### 11.1 CCB 的多层估算（`tokenEstimation.ts` 563 行）

| 层级 | 方法 | 精度 |
|------|------|------|
| 1. API 计数 | `countMessagesTokensWithAPI()` 使用 `anthropic.beta.messages.countTokens` | 准确 |
| 2. Haiku 回退 | `countTokensViaHaikuFallback()` 实际 API 调用 | 准确 |
| 3. 文件类型估算 | `bytesPerTokenForFileType()`（JSON=2，默认=4） | 粗略 |
| 4. 图片/文档 | 固定 2000 令牌 | 保守 |
| 5. Bedrock/Vertex | 多 Provider 特定路径 | 准确 |

### 11.2 Linghun 缺失

- 无 API 令牌计数（`context-estimator.ts` 仅做 `length/4` 粗略估算）
- 无 Haiku 回退
- 无文件类型特定的 bytesPerToken 比率
- 无图片/文档令牌估算

---

## 十二、组织策略限制（CCB 有，Linghun 无）

`policyLimits/index.ts`（664 行）：HTTP 请求 `GET /api/claude_code/policy_limits`，ETag 缓存，每小时轮询，fail-open 设计（HIPAA 基本流量除外）。

---

## 十三、键绑定系统（CCB 有，Linghun 无）

`src/keybindings/` 16 个文件。集中式引擎：
- `defaultBindings.ts`：全局/聊天/自动补全三层上下文作用域
- `~/.claude/keybindings.json`：用户自定义，JSON Schema 校验 + chokidar 热重载
- 和弦支持（`ctrl+x ctrl+k`）
- 保留快捷键检查，防止覆盖关键绑定

Linghun：键绑定全部分散硬编码在 `index.ts:1622-1664`（Escape/Ctrl+C/Shift+Tab）。

---

## 十四、Swarm/多代理（CCB 有，Linghun 无）

CCB 基于 tmux 的多代理系统：`swarm/constants.ts` + `teamHelpers.ts`（684 行）。
- tmux 窗格生成队友，每 PID 独立 socket
- `TeamFile` JSON 持久化
- Git worktree 隔离 + 销毁（`git worktree remove` 回退 `rm -rf`）
- 会话级清理注册（退出时自动清理临时目录和 worktree）
- 成员模式批量更新

---

## 十五、Linghun 做得比 CCB 好的部分（不应改变）

| 维度 | Linghun 做法 | CCB 劣势 |
|------|-------------|---------|
| Shell 层纯渲染 | `shell/*` 全部纯函数 + ShellController 接口 | React 组件与业务逻辑耦合更深 |
| Session 类型 | Discriminated union（30+ event type），exhaustive check | `any` 较多 |
| 架构边界检测 | `architecture-boundary.ts` 纯检测器，阈值可配置 | CCB 无等价物 |
| MetaScheduler | 纯函数决策引擎，14 维度，50+ 测试 | CCB 无等价物 |
| 权限管道 | 确定性规则，路径安全检测，输出脱敏 | CCB 依赖 LLM 分类器（误判风险） |
| 本地 Deep Compact | LLM 驱动结构化 handoff packet | CCB 依赖服务端 |
| 本地优先架构 | 无外部 API 依赖 | CCB 依赖 Anthropic Sessions API |
| Plan Mode 内在安全 | 仅允许读取工具 | CCB 的 auto mode 依赖分类器 |

---

## 十六、优先级排序（Linghun 改进建议）

| 优先级 | 改进项 | 参考 CCB 的 | 影响范围 | 工作量 |
|--------|--------|-----------|---------|--------|
| P0 | 实时费用计算 | `calculateUSDCost` + 模型定价表（`modelCost.ts`） | config + tui-model-runtime | 1-2 天 |
| P0 | Git 上下文自动注入 | `getGitStatus` (memoized, 1000 char) | model-prompt-runtime | 半天 |
| P0 | 按文件类型的 token 估算 | `bytesPerTokenForFileType`（JSON=2，默认=4） | context-estimator | 1 天 |
| P1 | 每个工具独立文件 + CoreTool 接口扩展 | `buildTool()` + 25 方法接口 + prompt.ts/UI.ts 伴生文件 | tools 包 | 2-3 天 |
| P1 | 命令模块化（注册表路由 + PromptCommand 类型） | 每命令独立目录 + feature flag | slash-command-runtime | 3-5 天 |
| P1 | API 令牌计数 | `countMessagesTokensWithAPI` | providers | 1 天 |
| P2 | Provider 拆解为合约+适配器 | `ClientFactories` + `Hooks` DI + 每 Provider 独立 async generator | providers 包 | 1-2 周 |
| P2 | 工具权限补齐 | `checkPermissions()` 三分支 + `isDestructive()` + `isOpenWorld()` | tools + permission | 1 周 |
| P2 | Windows 安全检查补齐 | `filesystem.ts` 的 ADS/8.3/DOS device/UNC 检测 | permission-policy-engine | 2-3 天 |
| P2 | 统一 context estimator 两套实现 | `context-estimator.ts` vs `compact-context.ts` 常量不一致 | compact/context | 半天 |
| P3 | 远程 REPL 协议 | Environments API + JWT + FlushGate | remote/bridge | 2-4 周 |
| P3 | Feature flag 系统 | `feature('X')` + tree-shaking | 构建 | 1-2 天 |
| P3 | 拒绝跟踪（连续 N 次回退） | `denialTracking`（maxConsecutive=3, maxTotal=20） | permission | 半天 |
| P3 | @include 递归内存 | `claudemd.ts` 的 @include 深度上限 5 + 循环检测 | tui-memory-runtime | 1-2 天 |
| P3 | 条件规则（glob-matched rules） | `.claude/rules/*.md` frontmatter `paths:` | memory | 1 天 |
| P3 | 键绑定系统 | `keybindings/` 集中引擎 + JSON 热重载 | tui | 2-3 天 |
