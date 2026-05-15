# CCB 项目全量代码审计报告

> 审计日期: 2026-05-14
> 项目版本: 2.2.1 (scripts/defines.ts)
> 审计范围: 全量代码 (src/, packages/, scripts/, build.ts)
> 审计目标: 为后续增强和 clean rewrite 做准备

---

## 目录

1. [架构总览](#1-架构总览)
2. [高风险问题列表](#2-高风险问题列表)
3. [编程能力关键模块说明](#3-编程能力关键模块说明)
4. [Clean Rewrite 功能对照表](#4-clean-rewrite-功能对照表)
5. [推荐优先修复清单](#5-推荐优先修复清单)
6. [推荐重写路线](#6-推荐重写路线)

---

## 1. 架构总览

### 1.1 整体分层

```
┌─────────────────────────────────────────────────────────┐
│                    CLI 入口层                              │
│  cli.tsx (382行) → 快速路径分发 → main.tsx (5587行)      │
├─────────────────────────────────────────────────────────┤
│                    TUI/UI 渲染层                           │
│  REPL.tsx → Ink组件树(149+组件) → @anthropic/ink框架    │
├─────────────────────────────────────────────────────────┤
│                    查询引擎层                              │
│  query.ts (主循环) → QueryEngine.ts (SDK封装)            │
├─────────────────────────────────────────────────────────┤
│                    API 提供者层                            │
│  claude.ts (核心) → 7个Provider适配器                    │
│  firstParty | bedrock | vertex | foundry |              │
│  openai | gemini | grok                                 │
├─────────────────────────────────────────────────────────┤
│                    工具执行层                              │
│  Tool.ts (接口) → tools.ts (注册) → toolExecution.ts     │
│  → 60个内置工具 + MCP工具                                 │
├─────────────────────────────────────────────────────────┤
│                    代理运行时                             │
│  runAgent.ts → query()循环 → 子代理生命周期管理          │
├─────────────────────────────────────────────────────────┤
│                    基础设施层                             │
│  权限 | MCP | 会话 | 记忆 | 配置 | 缓存 | 压缩 | 钩子    │
└─────────────────────────────────────────────────────────┘
```

### 1.2 CLI 启动流程

```
cli.tsx main()
  ├── performanceShim (全局替换)
  ├── MACRO 回退
  ├── --version / -v      → 零导入快速路径
  ├── --dump-system-prompt → (DUMP_SYSTEM_PROMPT)
  ├── --claude-in-chrome-mcp → Chrome MCP server
  ├── --computer-use-mcp  → (CHICAGO_MCP)
  ├── --acp               → ACP Agent 模式
  ├── weixin              → 微信集成
  ├── --daemon-worker     → (DAEMON)
  ├── remote-control/rc   → bridgeMain() (BRIDGE_MODE)
  ├── daemon              → daemonMain() (DAEMON/BG_SESSIONS)
  ├── --bg / ps/logs/...  → 后台会话管理
  ├── job/new/list/reply  → (TEMPLATES)
  ├── --tmux --worktree   → tmux 组合
  └── [默认]              → import main.tsx → cliMain()
       └── main.tsx:main()
            ├── Commander.js 命令注册 (60+选项, 50+子命令)
            ├── preAction: init() → 设置 → 权限 → MCP
            └── .action(): launchRepl() 或 runHeadless()
```

### 1.3 TUI/UI 渲染结构

```
App.tsx (AppStateProvider)
  └── REPL.tsx (主屏幕)
       ├── Messages.tsx → MessageRow.tsx (对话消息列表)
       ├── PromptInput/ (用户输入)
       ├── permissions/ (工具审批对话框, 14个专业组件)
       ├── design-system/ (Dialog, FuzzyPicker, ProgressBar等)
       └── StatusLine (状态栏: token/cost/缓存命中率)
```

**关键组件分布:**
- `src/components/` — 149个组件目录
- `packages/@ant/ink/` — Forked Ink框架 (自定义React渲染器)
- React Compiler memoization (`_c()`) 贯穿所有组件

### 1.4 代理运行时

```
AgentTool.call()
  → runAgent()
       ├── 创建 agentId (UUID)
       ├── 设置 transcript 子目录
       ├── 克隆/创建 FileStateCache
       ├── resolveAgentTools() (按 agents.md 配置过滤)
       ├── 连接 agent 特定的 MCP 服务器
       ├── createSubagentContext() (隔离上下文)
       ├── query() 循环 ← 核心 API 调用循环
       └── finally 块:
            ├── MCP 清理
            ├── 会话钩子清理
            ├── FileStateCache 释放
            ├── 后台 bash 任务终止
            └── 待办事项条目清理
```

### 1.5 工具调用系统

```
runToolUse() 管道:
  1. findToolByName(currentTools, toolName)
  2. 回退: 别名弃用检查
  3. 输入验证 (Zod schemas.safeParse)
  4. 工具验证 (tool.validateInput)
  5. 权限 (canUseTool → hasPermissionsToUseTool)
  6. 前置钩子 (PreToolUse)
  7. tool.call() 执行
  8. 映射为 ToolResultBlockParam
  9. 后置钩子 (PostToolUse)
```

**并发执行:** `partitionToolCalls()` 将工具分为并发安全组和串行组，通过 `runToolsConcurrently()` (上限10个) 或 `runToolsSerially()` 执行。

### 1.6 权限/审批模式

| 模式 | 行为 |
|------|------|
| `default` | 正常模式，提示用户批准每个工具 |
| `acceptEdits` | 自动接受工作目录内的文件编辑 |
| `bypassPermissions` | 跳过所有权限检查 (受多层门控) |
| `dontAsk` | 静默拒绝后台/无头代理 |
| `plan` | 只读模式 (但不强制执行 — 依赖工具级验证) |
| `auto` | AI 分类器决定 (仅 ant, TRANSCRIPT_CLASSIFIER) |

**权限管道优先级:**
1. 拒绝规则 (不可绕过)
2. 工具自己的 deny (即使在 bypass 模式也尊重)
3. requiresUserInteraction (始终提示)
4. 安全路径检查 (.git/, .claude/ 等)
5. bypassPermissions/plan 模式检查
6. 允许规则
7. 转为 ask

### 1.7 MCP 管理

```
MCP 客户端:
  └── src/services/mcp/client.ts
       ├── getMcpToolsCommandsAndResources()
       ├── prefetchAllMcpResources()
       ├── connectMcpServer() / disconnectMcpServer()
       └── MCP 工具作为 "mcp__server__tool" 注册

MCP OAuth: 简化版, 基本 auth 流程
MCP 工具发现: SearchExtraTools → TF-IDF 索引 → ExecuteExtraTool
```

### 1.8 记忆/会话/索引

```
记忆系统:
  ├── CLAUDE.md 发现 (claudemd.ts)
  │    ├── 托管: /etc/claude-code/CLAUDE.md
  │    ├── 用户: ~/.claude/CLAUDE.md
  │    ├── 项目: CLAUDE.md, .claude/CLAUDE.md, .claude/rules/*.md
  │    └── 本地: CLAUDE.local.md
  ├── 自动记忆 (extract_memories, auto-memory files)
  └── @include 指令支持

会话管理:
  ├── bootstrap/state.ts — 会话 ID (UUID, import 时生成)
  ├── sessionStorage.ts — JSONL 会话持久化
  └── 大小写不敏感 (Windows) 路径匹配

索引:
  ├── TF-IDF 工具索引 (searchExtraTools/toolIndex.ts)
  ├── 加权字段: 名称(3.0x), searchHint(2.5x), 描述(1.0x)
  └── 外部 codebase-memory MCP (独立进程)
```

### 1.9 模型提供者/上下文窗口

```
7 个 Provider:
  firstParty → Anthropic 直连 (默认)
  bedrock    → AWS Bedrock
  vertex     → Google Cloud Vertex AI
  foundry    → 自托管
  openai     → OpenAI 兼容 (Ollama/DeepSeek/vLLM)
  gemini     → Google Gemini
  grok       → xAI Grok

Provider 选择优先级:
  1. settings.modelType
  2. 环境变量 (CLAUDE_CODE_USE_BEDROCK/VERTEX/OPENAI/GEMINI/GROK)
  3. 默认 firstParty

上下文窗口:
  ├── 默认: 200,000 tokens
  ├── 1M 支持: [1m] 后缀, GrowthBook 实验, SDK betas
  ├── 压缩: autoCompact → compact → microCompact
  └── contextCollapse: 已禁用 (空壳 stub)
```

### 1.10 缓存相关逻辑

```
6 层缓存:
  1. 提示缓存中断检测 (PROMPT_CACHE_BREAK_DETECTION)
  2. 缓存警告系统 (cacheWarning.ts)
  3. 缓存历史环形缓冲 (cacheHistory.ts, 20轮)
  4. 缓存微紧凑 (cachedMicrocompact.ts)
  5. 缓存统计持久化 (cacheStats.ts)
  6. 统计聚合缓存 (statsCache.ts)
```

### 1.11 配置/功能标志

```
功能标志系统:
  ├── scripts/defines.ts — 中央定义 (65+ 默认启用标志)
  ├── feature() from 'bun:bundle' — 构建时 DCE
  ├── FEATURE_<NAME>=1 — 运行时叠加
  └── 约束: feature() 必须直接用于 if/ternary

设置系统:
  ├── userSettings   → ~/.claude/settings.json
  ├── projectSettings → <cwd>/.claude/settings.json
  ├── localSettings   → <cwd>/.claude/settings.local.json
  ├── flagSettings    → --settings CLI flag
  └── policySettings  → 托管设置 (注册表/plist/文件)

三层设置缓存: session → perSource → parseFile
变更检测: chokidar 文件观察 + MDM 轮询 (30分钟)
```

### 1.12 Windows 路径兼容

**良好实践 (90+ platform checks):**
- `path.sep` 一致使用
- Named pipe 抽象 (`\\.\pipe\...`)
- SIGTERM/SIGKILL 回避 (使用默认信号)
- `execa` 跨平台子进程
- 大小写不敏感文件系统处理
- CR/CRLF 处理

**已知问题:**
- WSL 路径硬编码 C: 盘 (`claudeDesktop.ts:40`)
- `gracefulShutdown.ts:219` — SIGKILL 在 Windows 上 throw
- `powershell.exe` 依赖 (`genericProcessUtils.ts`)
- 长路径 (>260 字符) 触发手动审批

---

## 2. 高风险问题列表

按严重程度排序 (CRITICAL > HIGH > MEDIUM > LOW):

### CRITICAL

#### C1. 可变全局状态无隔离
- **文件:** `src/bootstrap/state.ts`
- **问题:** `STATE` 单例是一个可变模块级对象。所有模块共享同一状态。长驻进程中无会话间重置机制。`resetStateForTests()` 仅在 `NODE_ENV === 'test'` 时存在。
- **影响:** 多会话复用进程时状态泄漏。并发异步操作修改同一字段导致竞态条件。
- **建议:** 引入 Session 类封装状态；每次新会话创建新的 Session 实例。

#### C2. 上下文崩溃检测完全空壳
- **文件:** `src/services/contextCollapse/index.ts`
- **问题:** `isContextCollapseEnabled()` 永远返回 `false`；`applyCollapsesIfNeeded()` 和 `recoverFromOverflow()` 均为无操作；`isWithheldPromptTooLong()` 永远返回 `false`。
- **影响:** 上下文过长无兜底检测；模型可能收到截断/损坏的上下文。
- **建议:** 实现真正的上下文完整性检测，或在 rewrite 中移除空壳代码。

#### C3. config.json 明文 API 密钥
- **文件:** `src/utils/config.ts` (line 230)
- **问题:** `workspaceApiKey` 以明文存储在 `~/.claude/config.json`。代码注释说应 `chmod 600 + gitignore`，但未强制执行。
- **影响:** 用户凭据泄露风险。
- **建议:** 使用系统 keychain (Windows Credential Manager / macOS Keychain / Linux libsecret)。

### HIGH

#### H1. 导入时副作用触发子进程
- **文件:** `src/main.tsx` (lines 9-22)
- **问题:** `startMdmRawRead()` 和 `startKeychainPrefetch()` 在模块求值时立即执行。即使简单的 `import './main.jsx'` 也会触发子进程。
- **影响:** 测试和工具链中非预期的子进程执行。
- **建议:** 延迟到显式调用时再执行。

#### H2. feature() 赋值模式破坏 DCE
- **文件:** `src/tools.ts` (lines 39-188), `src/main.tsx` (lines 119-128)
- **问题:** 代码注释说 `feature()` 必须内联使用，但大量代码先赋值给变量: `const MonitorTool = feature('MONITOR_TOOL')`。Bun 编译器可能无法正确消除死代码。
- **影响:** 禁用的功能代码仍出现在 bundle 中。
- **建议:** 统一使用内联 `feature()` 模式，或升级 Bun 编译器支持变量赋值。

#### H3. CACHED_MICROCOMPACT 控制平面混乱
- **文件:** `src/constants/prompts.ts` (line 69), `src/services/compact/cachedMicrocompact.ts` (line 27)
- **问题:** 功能标志 `CACHED_MICROCOMPACT` 只门控一个配置加载。实际行为由 `CLAUDE_CACHED_MICROCOMPACT=1` 环境变量独立控制。
- **影响:** 标志和变量不同步时功能行为不可预测。
- **建议:** 统一控制平面，移除双重门控。

#### H4. WSL 路径硬编码 C: 盘
- **文件:** `src/utils/claudeDesktop.ts` (line 40)
- **问题:** `const configPath = /mnt/c${wslPath}/AppData/Roaming/Claude/...` — 硬编码 `C:` 驱动器映射为 `/mnt/c`。
- **影响:** 用户配置文件在 D: 或其他驱动器时 WSL 路径解析失败。
- **建议:** 从 `USERPROFILE` 中提取驱动器字母并正确映射。

#### H5. config.json 无界增长
- **文件:** `src/utils/config.ts` (line 188)
- **问题:** `GlobalConfig.projects` 映射随时间累积每个访问过的项目。`cachedStatsigGates`、`cachedDynamicConfigs`、`cachedGrowthBookFeatures` 等缓存字段也可无限增长。
- **影响:** 长期使用后启动变慢、磁盘占用增大。
- **建议:** 添加 LRU 驱逐或定期修剪机制。

#### H6. 提供者路由错误: isFirstPartyAnthropicBaseUrl
- **文件:** `src/utils/model/providers.ts` (line 45)
- **问题:** 当 `ANTHROPIC_BASE_URL` 未设置时，该函数返回 `true`。仅配置了 OpenAI 协议的用户将错误进入 Anthropic 代码路径。代码中已有 TODO 注释承认此问题。
- **影响:** OpenAI-only 用户体验异常。
- **建议:** 基于实际 provider 决策而非 URL 判断。

#### H7. DeepSeek 思考模式自动检测过宽
- **文件:** `src/services/api/openai/requestBody.ts` (lines 21-28)
- **问题:** 模型名称包含 `deepseek`（不区分大小写）时自动启用思考并发送 3 种互斥格式。非 DeepSeek 模型收到无法识别的参数。
- **影响:** 使用 `deepseek` 名称的自定义模型异常。
- **建议:** 白名单已知 DeepSeek 模型，或通过配置显式控制。

#### H8. 查询循环无硬上限
- **文件:** `src/query.ts` (line 459)
- **问题:** `while(true)` 循环永远运行，直到遇到返回或抛出。`turnCount` 递增但无硬上限（除非传入 `maxTurns`）。
- **影响:** 错误对话中无限循环，消耗 token 直到上下文窗口限制。
- **建议:** 添加默认 `maxTurns` 上限（如 100）。

#### H9. ContentReplacementState 键累积
- **文件:** `src/services/tools/toolExecution.ts`
- **问题:** `applyToolResultBudget` 的替换状态使用 `Map<string, ...>`，键为 `tool_use_id`。长时间会话中，压缩清除了消息但未清除替换，过时键累积。
- **影响:** 内存泄漏。
- **建议:** 微压缩时同步清除替换状态。

#### H10. 无界无限增长的 feature flag 私有代码
- **影响范围:** 全项目
- **问题:** 26+ 个 feature flags 未在 `DEFAULT_BUILD_FEATURES` 中启用，但代码中存在大量引用。这些功能可能需要通过 `FEATURE_<NAME>=1` 环境变量手动启用，否则无法在生产构建中使用。
- **影响:** 大量代码将变成死代码，但不会被完全清除，影响 bundle 体积。
- **建议:** 识别并清理或正确启用。

### MEDIUM

#### M1. 模型能力匹配使用子字符串而非精确匹配
- **文件:** `src/utils/model/modelCapabilities.ts`
- **问题:** 静态回退使用 `includes()`，如模型名包含 `deepseek-v4-flash` 会错误匹配。
- **影响:** 自定义模型名误触发能力假设。

#### M2. OpenAI 输出模式与 Anthropic 不一致
- **文件:** `src/services/api/openai/index.ts`
- **问题:** OpenAI 在 `message_stop` 输出组合 `AssistantMessage`；Anthropic/Gemini/Grok 在 `content_block_stop` 为每个块输出一条消息。
- **影响:** 期望每条消息只有单个内容块的 downstream 处理可能异常。

#### M3. 无流式看门狗 on Gemini/Grok
- **文件:** `src/services/api/claude.ts` (lines 1955-2009)
- **问题:** Anthropic 路径有 90 秒流空闲超时；Gemini 和 Grok 路径缺失。
- **影响:** Gemini/Grok 流挂起无声卡住。

#### M4. 模型能力缓存无自动刷新
- **文件:** `src/utils/model/modelCapabilities.ts`
- **问题:** `model-capabilities.json` 写入磁盘，由 `refreshModelCapabilities()` 刷新，但无自动间隔刷新或基于时间的过期。
- **影响:** 新模型发布后能力信息过期。

#### M5. 权限 bypass 禁用竞态
- **文件:** `src/state/AppState.tsx` (line 65), `src/utils/permissions/bypassPermissionsKillswitch.ts`
- **问题:** App 挂载时同步检查 `isBypassPermissionsModeDisabled()`，但异步 `checkAndDisableBypassPermissions()` 稍后可能触发 `gracefulShutdown(1)`。两者之间存在时间窗口。
- **影响:** bypass 在 gate 应该关闭时短暂可用。

#### M6. Plan 模式不强制执行只读
- **文件:** `src/utils/permissions/permissions.ts` (lines 1289-1293)
- **问题:** Plan 模式检查 `isBypassPermissionsModeAvailable`，如果为 true 则继承 bypass 行为。只读意图依赖工具级验证而非权限管道。
- **影响:** Plan 模式中可能执行写入操作。

#### M7. 设置缓存 N 路颠簸回归风险
- **文件:** `src/utils/settings/changeDetector.ts` (lines 420-439)
- **问题:** 注释记录了过去 `fanOut()` 单生产者修复之前的 bug。任何绕过 `fanOut()` 的新代码路径都会重新引入多路复用颠簸。
- **影响:** 设置变更时多次磁盘重新加载。

#### M8. stats-cache.json 原子写入竞态
- **文件:** `src/utils/statsCache.ts` (lines 214-254)
- **问题:** `saveStatsCache()` 写入临时文件并在锁外重命名。并发调用者可能丢失数据。
- **影响:** 统计缓存损坏。

### LOW

#### L1. init() 无超时保护
- **文件:** `src/entrypoints/init.ts`
- **问题:** 记忆化的 `init` 函数无超时。若首个调用者的 init 挂起（如 CCR upstream proxy），所有后续调用者永久阻塞。

#### L2. 流式执行器丢弃丢失部分结果
- **文件:** `src/services/tools/StreamingToolExecutor.ts` (line 73)
- **问题:** `discard()` 清除所有挂起和进行中工具，包括已产生部分输出的工具。这些部分结果被默默丢弃。

#### L3. 子代理清理顺序问题
- **文件:** `packages/builtin-tools/src/tools/AgentTool/runAgent.ts`
- **问题:** 清理是顺序的。若清理中某步抛出，后续步骤被跳过，可能泄漏资源。

#### L4. 统计缓存迁移丢弃数据
- **文件:** `src/utils/statsCache.ts` (lines 112-113)
- **问题:** v1 版本缓存返回空，所有历史统计丢失，无用户警告。

#### L5. Windows 长路径手动审批
- **文件:** `src/utils/permissions/filesystem.ts` (lines 560-568)
- **问题:** 合法长路径 (>260 字符) 触发安全手动审批，用户体验受影响。

---

## 3. 编程能力关键模块说明

### 3.1 模型请求构造

```
完整管道:
  1. getSystemContext()     → 日期、git status、平台信息
  2. getUserContext()       → CLAUDE.md 内容、记忆文件
  3. getSystemPrompt()      → 核心系统提示词 + 工具指南
  4. normalizeMessagesForAPI() → 消息序列化/清理
  5. buildSystemPromptBlocks() → 提示词缓存控制
  6. buildRequestParams()   → 最终 API 参数组合
  7. queryModel()           → 发送请求、处理流式响应
```

**关键文件:**
- `src/context.ts` — git status, 平台上下文组装
- `src/utils/claudemd.ts` — CLAUDE.md 发现/加载/@include
- `src/constants/prompts.ts` — 系统提示词模板
- `src/utils/messages.ts` — 消息标准化、工具结果格式化
- `src/services/api/claude.ts` — 核心 API 客户端 (3700+ 行)

### 3.2 系统提示词/工具 Schema 组织

```
系统提示词结构:
  [归属头] [CLI 前缀] [核心提示词...]
  [+ Advisor 说明] [+ Chrome 搜索说明] [+ 缓存 nonce]

工具 Schema:
  toolToAPISchema() → BetaToolUnion
  ├── CORE_TOOLS (38个) → 始终包含, 完整 schema
  ├── deferred 内置工具 → shouldDefer: true, 通过 SearchExtraTools 发现
  └── MCP 工具 → mcp__server__tool 命名, 通过 SearchExtraTools 发现

提供者转换:
  Anthropic → 直接使用
  OpenAI → anthropicToolsToOpenAI()
  Gemini → anthropicToolsToGemini()
  Grok → anthropicToolsToOpenAI()
```

### 3.3 文件搜索→读取→编辑→测试闭环

```
搜索:
  GrepTool → ripgrep (src/utils/ripgrep.ts)
            → 自动 CR 剥离
            → 结果截断/持久化
  GlobTool → picomatch 模式匹配

读取:
  FileReadTool → 行号前缀、代码块检测
               → 图像/PDF 处理
               → <system-reminder> 网络安全缓解

编辑:
  FileEditTool → 精确字符串替换
               → old_string 唯一性检查
               → CRLF/LF 保留

写入:
  FileWriteTool → 文件创建/覆盖
                → 目录自动创建

测试:
  BashTool → 执行测试命令
           → 输出截断/持久化到磁盘
           → <system-reminder> 完整输出路径提示
```

### 3.4 多代理创建、通信、汇总

```
创建:
  AgentTool.call()
    ├── 标准: resolveAgentTools(agentDefinition, availableTools)
    ├── Fork: useExactTools (直接使用 availableTools)
    └── 分支: forkSubagent (提示词缓存共享设计)

通信:
  ├── SendMessageTool → 写邮箱 (teammateMailbox.ts)
  ├── TaskCreate/Update/List/Get → 任务管理系统
  └── 代理结果 → 通过 runAgent() 生成器 yield

汇总:
  ├── 代理完成后产生最终 AssistantMessage
  ├── Coordinator 模式: 协调器 Agent + 工作 Agent
  └── AgentSummary 生成器 (summaryPrompt.ts)

隔离:
  ├── 异步代理: 独立 AbortController
  ├── 权限: shouldAvoidPermissionPrompts + dontAsk 模式
  ├── Worktree: EnterWorktreeTool / ExitWorktreeTool
  └── 文件缓存: 克隆 FileStateCache
```

### 3.5 权限模式影响工具执行

```
canUseTool() 决策树:
  1. 检查工具级拒绝规则 → 立即拒绝
  2. 检查工具级询问规则 → 询问 (Bash sandbox 自动允许除外)
  3. 工具自己的 checkPermissions() → 工具特定逻辑
  4. 工具自己的 deny → 立即拒绝
  5. requiresUserInteraction() → 询问 (即使 bypass 模式)
  6. 内容特定询问规则 → 尊重 (即使 bypass 模式)
  7. 安全检查 (.git/ 等) → 始终提示 (bypass-immune)
  8. 模式检查:
     bypassPermissions 或 plan+bypass → 允许
     auto 模式 → 分类器决定
     acceptEdits → 自动允许文件编辑
     dontAsk → 自动拒绝询问
  9. 工具级允许规则 → 允许
  10. passthrough → 转为询问
```

**BypassPermissions 可用性 (三层门控):**
1. Statsig/GrowthBook gate (`tengu_disable_bypass_permissions_mode`)
2. settings.json (`disableBypassPermissionsMode: "disable"`)
3. CCR/BYOC 限制 (仅 acceptEdits/plan/default)

### 3.6 记忆/索引参与上下文

```
上下文注入:
  CLAUDE.md 内容 → getUserContext() → 系统提示词的一部分
  自动记忆文件 → filterInjectedMemoryFiles() → 附件消息
  工具输出中的记忆提示 → withMemoryCorrectionHint()
  代码库索引 → 外部 codebase-memory MCP (独立进程)
  TF-IDF 工具索引 → 仅用于工具发现，不直接注入上下文
```

---

## 4. Clean Rewrite 功能对照表

### 4.1 必须保留的能力

| 能力 | 说明 | 当前实现质量 |
|------|------|-------------|
| CLI 启动 + 快速路径 | 多种快速路径分发 | 中等 (Commander.js 单文件过大) |
| 流式 API 响应处理 | SSE 解析 + 看门狗 | 高 (Anthropic 路径) |
| 工具接口 + 注册表 | Zod schema + 权限集成 | 高 |
| 权限/审批管道 | 多层决策 + 拒绝跟踪 | 高 |
| Agent 生成 + 生命周期 | 子代理 + 资源清理 | 中高 (清理顺序有风险) |
| MCP 集成 | 服务器连接 + 工具发现 | 中高 |
| CLAUDE.md 多层次加载 | 托管→用户→项目→本地 | 高 |
| 多 Provider 支持 | Anthropic + OpenAI + Gemini + Grok | 中高 (各 provider 完整度不一) |
| 上下文压缩 | autoCompact + microCompact | 中高 |
| 提示缓存管理 | 中断检测 + 统计 + 警告 | 高 |
| 文件搜索/编辑 | Grep + Glob + Read + Edit + Write | 高 |
| 会话持久化 | JSONL 记录 + 大小写不敏感 | 高 |
| 后台任务管理 | TaskCreate + 文件存储 | 中 |
| Terminal/Ink 渲染 | React 组件树 | 中 (forked Ink, 149组件) |
| 计划模式 | Plan + verification agent | 中 |
| 设置系统 | 多层 merge + MDM/注册表 | 中高 |

### 4.2 不建议照搬的实现

| 当前实现 | 问题 | 建议替代 |
|----------|------|---------|
| Forked `@anthropic/ink` | 与社区 Ink 分化, 维护成本高 | 使用标准 Ink 4.x + 适配层 |
| Commander.js 单文件 5587 行 | 不可维护 | 拆分为独立命令模块; 考虑 clipanion |
| `bootstrap/state.ts` 单例 (1762行) | 可变全局状态 | Session 类 + DI 容器 |
| feature() 必须内联的约束 | Bun 编译器限制 | 标准环境变量/配置门控 |
| `bun:bundle` 导入 | Bun 专用, 不可移植 | 使用标准条件编译模式 |
| 65+ feature flags | 复杂度过高 | 合并/简化; 区分 build-time vs runtime |
| require() 条件导入防止循环依赖 | 脆弱的加载顺序 | 依赖注入; 接口抽象 |
| React Compiler `_c()` memoization | 反编译产物 | 手写 memo/useMemo |
| build.ts 手动字符串替换 | 脆弱的后处理 | 使用 Vite/Rollup 插件 |
| config.json + settings.json 双重配置 | 关注点混淆 | 统一配置系统 |

### 4.3 可抽象为独立模块的组件

| 模块 | 职责 | 复用价值 |
|------|------|---------|
| Tool 接口 + 注册表 | 工具定义/发现/执行 | 高 — 任何 agent 框架的通用需求 |
| 权限管道 | canUseTool 多层决策 | 高 — 安全审批的参考实现 |
| MCP 客户端 | MCP 服务器连接/工具发现 | 高 — 可独立发布 npm 包 |
| 流适配器 | 多 Provider 统一 | 高 — OpenAI→Anthropic 事件适配 |
| 提示缓存检测 | 缓存中断诊断 | 中高 — 调试/监控工具 |
| 上下文压缩 | 消息摘要/修剪 | 中高 — 通用 LLM 上下文管理 |
| CLAUDE.md 加载器 | 多层次指令发现 | 中 — 可在其他项目中复用 |
| 会话持久化 | JSONL 记录/重放 | 中 — 调试/审计需求 |
| TF-IDF 工具索引 | 延迟工具搜索 | 中 — 可用 MiniSearch 替代 |

### 4.4 侵权/不可复用风险

| 风险项 | 说明 |
|--------|------|
| Anthropic 专有标识符 | `src/types/global.d.ts` 中声明了内部 Anthropic-only 标识符 |
| 反编译产物 (`_c()`) | React Compiler 编译输出，需全部重写 |
| `USER_TYPE === 'ant'` 分支 | Anthropic 内部功能，不可在外部使用 |
| Anthropic API 内部 beta 头 | `cli-internal-2026-02-09` 等，非公开 API |
| 内部服务 URL | `api-staging.anthropic.com` 等内部端点 |
| GrowthBook/Statsig 集成 | 依赖 Anthropic 内部实验平台 |
| 匿名化遥测 (`tengu_*`) | API 调用中包含专有分析标识符 |
| Anthropic SDK 深度依赖 | `@anthropic-ai/sdk` 非标准 API 用法 |

### 4.5 可替代的社区方案

| 当前依赖 | 替代方案 |
|----------|---------|
| Bun (runtime) | Node.js 20+ / Deno 2 |
| Bun.build (bundler) | Vite / esbuild / tsup |
| Forked `@anthropic/ink` | `ink` 4.x (社区版) |
| Commander.js | `clipanion` / `cac` / `yargs` |
| Biome (lint/format) | 直接使用 (社区标准) |
| lodash-es (tree-shaking) | `es-toolkit` / 原生实现 |
| TF-IDF (手写) | `MiniSearch` / `Fuse.js` |
| chokidar (文件观察) | 直接使用 (社区标准) |
| execa (子进程) | 直接使用 (社区标准) |
| picomatch (glob) | 直接使用 (社区标准) |
| Zod v4 (schema) | 直接使用 (社区标准) |
| React (UI) | 直接使用 (社区标准) |

---

## 5. 推荐优先修复清单

### P0 — 立即修复 (安全/数据丢失)

| # | 问题 | 文件 | 工作量 |
|---|------|------|--------|
| P0-1 | 明文 API 密钥存储 | `src/utils/config.ts:230` | 小 (使用 keychain) |
| P0-2 | config.json 无界增长 | `src/utils/config.ts:188` | 小 (LRU 驱逐) |
| P0-3 | WSL 路径硬编码 C: 盘 | `src/utils/claudeDesktop.ts:40` | 小 (动态驱动器字母) |

### P1 — 短期修复 (稳定性)

| # | 问题 | 文件 | 工作量 |
|---|------|------|--------|
| P1-1 | 上下文崩溃检测空壳 | `src/services/contextCollapse/` | 中 (实现或移除) |
| P1-2 | 提供者路由错误 | `src/utils/model/providers.ts:45` | 小 |
| P1-3 | DeepSeek 思考检测过宽 | `src/services/api/openai/requestBody.ts` | 小 |
| P1-4 | 查询循环无硬上限 | `src/query.ts:459` | 小 (添加 maxTurns) |
| P1-5 | CACHED_MICROCOMPACT 控制平面 | `prompts.ts` + `cachedMicrocompact.ts` | 小 (统一) |
| P1-6 | feature() 赋值模式 | `src/tools.ts`, `src/main.tsx` | 中 (批量替换) |

### P2 — 中期改进 (架构)

| # | 问题 | 文件 | 工作量 |
|---|------|------|--------|
| P2-1 | 全局可变状态 | `src/bootstrap/state.ts` | 大 (设计 Session 类) |
| P2-2 | Commander.js 单文件 | `src/main.tsx` | 大 (拆分命令) |
| P2-3 | 导入时副作用 | `src/main.tsx:9-22` | 小 (延迟执行) |
| P2-4 | 设置缓存颠簸回归 | `changeDetector.ts:420` | 小 (添加断言) |
| P2-5 | Plan 模式不强制执行只读 | `permissions.ts:1289` | 中 (添加只读检查) |
| P2-6 | ContentReplacementState 泄漏 | `toolExecution.ts` | 小 (微压缩时清除) |

### P3 — 长期 (代码质量)

| # | 问题 | 文件 | 工作量 |
|---|------|------|--------|
| P3-1 | React Compiler `_c()` 产物 | 所有组件 | 大 (手写 memo) |
| P3-2 | 26+ 未启用的 feature flags | 全项目 | 中 (清理/分类) |
| P3-3 | Forked Ink 框架 | `packages/@ant/ink/` | 大 (迁移到标准 Ink) |
| P3-4 | require() 条件导入 | 全项目 | 中 (DI 重构) |
| P3-5 | 模型能力缓存过期 | `modelCapabilities.ts` | 小 (添加 TTL) |
| P3-6 | 统计缓存数据丢失 | `statsCache.ts:112` | 小 (实现迁移) |

---

## 6. 推荐重写路线

### Phase 0: 准备工作 (2-3 周)

```
目标: 建立新项目骨架和基础设施

1. 搭建新 monorepo
   - Runtime: Node.js 22+ (放弃 Bun 依赖, 提升可移植性)
   - Bundler: tsup / Vite
   - Lint/Format: Biome (保留, 社区标准)
   - Test: vitest (替代 bun:test)
   - Package manager: pnpm (workspace 支持更好)

2. 抽象核心接口 (从现有代码提取)
   - Tool 接口 (Tool.ts)
   - Provider 接口 (providers.ts)
   - Permission 接口 (permissions.ts)
   - Session 接口 (新的 Session 类)

3. CI/CD 流水线
   - TypeScript strict mode
   - Lint + Format + Test + Build
   - Windows / macOS / Linux 矩阵
```

### Phase 1: 核心基础设施 (4-6 周)

```
目标: 建立可工作的最小 CLI

1. CLI 框架
   - 使用 clipanion 或 cac (替代 Commander.js)
   - 命令拆分: 每个子命令独立文件
   - 统一的 --help / --version

2. Session 管理
   - Session 类 (替代 bootstrap/state.ts 单例)
   - 会话持久化: JSONL 格式 (保留, 已验证)
   - 多会话隔离

3. 配置系统
   - 统一配置层 (合并 config.json + settings.json)
   - 多层来源: 用户 → 项目 → 本地 → 托管
   - JSON Schema 验证
   - 加密敏感字段

4. Provider 抽象 (从现有 7 个提取)
   - 统一接口: stream(messages, tools, systemPrompt) → AsyncGenerator<StreamEvent>
   - firstParty (Anthropic SDK)
   - OpenAI 兼容 (适配器模式)
   - 保留 Gemini, Grok (适配器模式)
```

### Phase 2: 工具系统 (4-6 周)

```
目标: 重新设计工具注册、发现、执行

1. 工具注册表
   - Plugin 式工具注册 (替代 require() 条件导入)
   - 懒加载: 工具按需发现和加载
   - 工具权限声明: 内置在工具定义中

2. 核心内置工具 (从现有 60 个提取)
   必须:
   - FileRead / FileWrite / FileEdit
   - Grep (ripgrep) / Glob
   - Bash (shell 执行)
   - WebFetch / WebSearch
   - Agent (子代理)
   - TaskCreate/Update/List/Get
   - AskUserQuestion
   - EnterPlanMode / ExitPlanMode

   可选:
   - LSP (语言服务器)
   - Skill (技能系统)
   - Cron (定时任务)
   - NotebookEdit (Jupyter)
   - WebBrowser
   - MCP (MCP 工具调用)

3. 权限管道 (保留现有设计, 简化实现)
   - 多层决策树
   - 拒绝规则不可绕过
   - 安全检查免疫 bypass
   - ACP 权限桥接

4. 流式工具执行
   - StreamingToolExecutor (保留设计)
   - 并发安全检测
   - 兄弟工具取消
```

### Phase 3: Agent 系统 (3-4 周)

```
目标: 实现可靠的子代理创建、通信、清理

1. Agent 生命周期管理器
   - Agent 注册/销毁
   - 资源追踪: 后台任务、MCP 连接、文件缓存
   - 优雅关闭: finally 块保证清理 (保留设计, 加强)

2. 代理类型
   - general-purpose (全工具)
   - Explore (只读, 研究)
   - Plan (规划, 无执行)
   - verification (验证)
   - custom (用户定义 via agents.md)

3. 通信机制
   - SendMessage (点对点)
   - Task 管理 (共享状态)
   - Coordinator 模式 (可选)

4. Worktree 隔离 (保留设计)
```

### Phase 4: UI/TUI (5-7 周)

```
目标: 从 forked Ink 迁移到社区 Ink

1. 使用标准 Ink 4.x
   - 移除 packages/@ant/ink/ fork
   - 适配层处理 API 差异
   - 主题系统 (保留设计)

2. 重写组件 (不使用 React Compiler _c())
   - App.tsx (状态 Provider)
   - Messages.tsx / MessageRow.tsx
   - PromptInput (输入处理)
   - 权限对话框 (14 个专用组件)
   - StatusLine (状态栏)

3. 保持的功能
   - 键盘快捷键 (keybindings.json)
   - 终端通知 (bell, title)
   - 模糊搜索 (FuzzyPicker)
   - Markdown 渲染 (语法高亮)

4. Headless / Print 模式
   - -p/--print 管道模式
   - --output-format stream-json (SDK 接口)
   - 非交互式后台运行
```

### Phase 5: 记忆/上下文/缓存 (2-3 周)

```
目标: 保留有效的记忆和缓存机制

1. CLAUDE.md 系统 (保留, 清理实现)
   - 多层次加载 (托管→用户→项目→本地)
   - @include 指令
   - 文件观察器自动重载

2. 自动记忆 (可选, 默认关闭)
   - extract_memories 流水线

3. 上下文管理
   - 提示缓存控制 (保留设计)
   - 自动压缩 (保留 autoCompact)
   - 微压缩 (保留 microCompact)

4. 提示缓存诊断 (保留)
   - 中断检测 (PROMPT_CACHE_BREAK_DETECTION)
   - 缓存统计 (cacheHistory.ts)
   - 缓存警告 (cacheWarning.ts)

5. 删除空壳代码
   - contextCollapse (完全移除或正确实现)
```

### Phase 6: MCP / 扩展 (3-4 周)

```
目标: 独立的 MCP 客户端 + 扩展系统

1. MCP 客户端 npm 包
   - 独立的 @anthropic-ai/mcp-client (或社区替代)
   - 服务器连接/断开/重连
   - 工具/资源/Prompt 发现
   - OAuth 认证

2. Plugin 系统
   - 插件发现 (目录扫描)
   - 钩子系统 (保留 PreToolUse/PostToolUse/Stop 等)
   - 市场集成 (可选)

3. ACP 协议支持
   - Agent Client Protocol
   - WebSocket + stdio transport
```

### Phase 7: 周边功能 + 打磨 (3-4 周)

```
1. Bridge / Remote Control (可选)
   - 自托管 Web UI
   - REST API + WebSocket

2. 多平台测试
   - Windows: 路径、shell、进程管理
   - macOS: keychain、桌面集成
   - Linux: headless、WSL

3. 文档
   - API 文档
   - 插件开发指南
   - 迁移指南

4. 性能优化
   - 启动时间
   - 内存使用
   - Bundle 大小
```

### 重写总时间估算: 24-33 周

---

## 附录

### A. 关键文件索引

| 文件 | 大小 | 职责 |
|------|------|------|
| `src/main.tsx` | ~5587 行 | CLI 命令定义 (Commander.js) |
| `src/query.ts` | ~1800 行 | 核心查询循环 |
| `src/services/api/claude.ts` | ~3700 行 | 核心 API 客户端 |
| `src/bootstrap/state.ts` | ~1762 行 | 全局状态单例 |
| `src/screens/REPL.tsx` | ~1500 行 | TUI 主屏幕 |
| `src/utils/messages.ts` | ~1500 行 | 消息标准化/格式化 |
| `src/Tool.ts` | ~800 行 | 工具接口定义 |
| `src/utils/permissions/permissions.ts` | ~1400 行 | 权限管道 |
| `src/context.ts` | ~400 行 | 上下文组装 |
| `src/utils/claudemd.ts` | ~800 行 | CLAUDE.md 加载 |

### B. 包依赖分析

| 包 | 状态 | 建议 |
|----|------|------|
| `@anthropic/ink` (forked) | 需要迁移 | → `ink` 4.x |
| `@commander-js/extra-typings` | 需要替换 | → `clipanion` |
| `@anthropic-ai/sdk` | 保留 | 核心依赖 |
| `openai` | 保留 | 兼容层 |
| `lodash-es` | 优化 | → `es-toolkit` 或原生 |
| `zod` v4 | 保留 | 社区标准 |
| `picomatch` | 保留 | 社区标准 |
| `execa` | 保留 | 社区标准 |
| `chokidar` | 保留 | 社区标准 |
| `react` + `ink` | 保留 | UI 框架 |

### C. 审计方法

- **总文件探索**: 200+ 源文件
- **深度分析**: 50+ 核心文件全文阅读
- **feature() 调用追踪**: 212 文件, 870 次调用
- **Windows 兼容检查**: 90+ `process.platform` 检查点
- **进程生命周期检查**: 所有 `spawn`/`kill`/`exit` 调用
- **异步模式检查**: `Promise`、`async`、`setTimeout`/`setInterval`
- **索引辅助**: 代码库记忆索引 (46,025 节点, 111,229 边)

---

*报告生成时间: 2026-05-14*
*审计基于 commit: main 分支当前 HEAD*
