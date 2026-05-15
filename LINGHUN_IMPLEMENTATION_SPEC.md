# Linghun 实现规格书

> 本规格书配合 `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` 使用。蓝图说明“按什么阶段做”，本文件说明“具体怎么实现”。开发时以蓝图控制范围，以本规格书控制接口、数据结构、命令行为和验收细节。

## 0. 不变量

### 0.1 产品不变量

- 终端 TUI 优先。
- CCB 核心编码能力优先。
- CCB Dev Boost 降本增强必须保留。
- 默认中文友好，支持英文。
- 默认 strict 工程模式。
- 默认不全托管、不远程触发、不后台乱跑。
- 所有高级功能可见、可关、可诊断。

### 0.2 工程不变量

- 每个阶段必须能独立验收。
- core 不依赖 TUI。
- provider 不依赖 UI。
- tool 必须走权限管道。
- MCP 失败不得拖垮主对话。
- 会话必须可持久化和恢复。
- 长任务必须可中断。
- 成本和缓存必须可观测。
- 项目级数据必须支持项目内或指定磁盘存储，不能硬编码 C 盘或固定用户目录。

## 1. 推荐目录结构

```text
apps/
  cli/
    src/main.ts
    src/commands/
  tui/
    src/App.tsx
    src/components/
packages/
  core/
    src/session/
    src/loop/
    src/events/
    src/errors/
  providers/
    src/gateway.ts
    src/openai-compatible.ts
    src/deepseek.ts
    src/anthropic.ts
    src/gemini.ts
    src/ollama.ts
  tools/
    src/registry.ts
    src/builtin/
  permissions/
    src/pipeline.ts
    src/rules.ts
  context/
    src/builder.ts
    src/promptLayers.ts
    src/compact.ts
  cache/
    src/history.ts
    src/breakDetector.ts
    src/cost.ts
  mcp/
    src/manager.ts
    src/stabilize.ts
    src/doctor.ts
  indexers/
    src/codebaseMemory.ts
    src/largeFileScan.ts
    src/indexHealth.ts
  sessions/
    src/jsonl.ts
    src/importers/
  memory/
    src/memoryStore.ts
    src/rulesLoader.ts
  agents/
    src/agentRunner.ts
    src/types.ts
  verification/
    src/detectCommands.ts
    src/runner.ts
    src/verifierAgent.ts
  skills/
    src/loader.ts
    src/workflows/
  config/
    src/schema.ts
    src/load.ts
  shared/
    src/types.ts
    src/path.ts
docs/
```

## 2. 核心事件协议

所有模型、工具、Agent、验证器最终都转换为统一事件。

```ts
export type LinghunEvent =
  | { type: 'session_start'; sessionId: string; projectPath: string }
  | { type: 'user_message'; id: string; text: string }
  | { type: 'assistant_text_delta'; id: string; text: string }
  | { type: 'assistant_thinking_delta'; id: string; text: string }
  | { type: 'tool_call_start'; id: string; name: string; input: unknown }
  | { type: 'tool_call_delta'; id: string; message: string }
  | { type: 'tool_call_end'; id: string; output: ToolOutput }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_result'; requestId: string; decision: PermissionDecision }
  | { type: 'todo_update'; items: TodoItem[] }
  | { type: 'diff_update'; summary: DiffSummary }
  | { type: 'checkpoint_created'; checkpoint: Checkpoint }
  | { type: 'checkpoint_restored'; checkpointId: string }
  | { type: 'background_task_update'; task: BackgroundTask }
  | { type: 'btw_question'; question: BtwQuestion }
  | { type: 'usage'; usage: ModelUsage }
  | { type: 'cache_update'; stats: CacheTurnStats }
  | { type: 'verification_start'; run: VerificationRun }
  | { type: 'verification_end'; report: VerificationReport }
  | { type: 'agent_start'; agent: AgentRun }
  | { type: 'agent_end'; agentId: string; summary: string }
  | { type: 'error'; error: LinghunError }
  | { type: 'session_end'; sessionId: string }
```

要求：

- TUI 只消费事件，不直接调用 provider。
- JSONL transcript 记录核心事件。
- 桌面端未来也消费同一事件。

后台任务：

```ts
export type BackgroundTask = {
  id: string
  kind: 'bash' | 'agent' | 'job' | 'mcp'
  title: string
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  updatedAt: string
  cost?: CostSummary
  logPath?: string
}
```

要求：

- 长 Bash、agent、job 都进入统一后台任务表。
- TUI 状态栏只显示摘要，详情通过 `/background` 打开。
- 后台任务必须可取消；可恢复能力按 kind 声明。

## 3. Session 规格

```ts
export type Session = {
  id: string
  projectPath: string
  projectName: string
  createdAt: string
  updatedAt: string
  model: string
  permissionMode: PermissionMode
  language: 'zh-CN' | 'en-US'
  transcriptPath: string
  summary?: string
  cost: CostSummary
  cache: CacheSummary
}
```

Session 必须：

- 独立状态。
- 独立 transcript。
- 可恢复。
- 可被 Agent 派生。
- 可关联长期任务。

禁止：

- 全局 mutable state 存储当前会话核心状态。
- 多会话共用可变权限上下文。

## 4. 配置规格

### 4.1 配置优先级

```text
CLI 参数
> 环境变量
> 项目配置 .linghun/settings.json
> 用户配置 ~/.linghun/settings.json
> 默认配置
```

### 4.2 配置结构

```ts
export type LinghunConfig = {
  language: 'zh-CN' | 'en-US'
  defaultModel: string
  providers: Record<string, ProviderConfig>
  modelRoutes: ModelRouteConfig
  permission: {
    defaultMode: PermissionMode
    allowRules: PermissionRule[]
    askRules: PermissionRule[]
    denyRules: PermissionRule[]
  }
  features: FeatureFlags
  mcp: {
    enabledServers: string[]
    servers: Record<string, McpServerConfig>
  }
  cache: {
    showStatus: boolean
    warnBelowHitRate: number
    historySize: number
  }
  storage: StorageConfig
  index: {
    enabled: boolean
    mode: 'fast' | 'moderate' | 'full'
    ignoreFile: '.linghunignore' | '.cbmignore'
  }
  verification: {
    autoVerify: boolean
    maxRetries: number
    preferFastChecks: boolean
  }
  skills: {
    enabled: boolean
    projectDir: string
    userDir: string
  }
  plugins: {
    enabled: boolean
    projectDir: string
    userDir: string
    allowGithubInstall: boolean
    trustedSources: PluginTrustLevel[]
  }
  jobs: {
    enabled: boolean
    maxConcurrent: number
  }
}
```

### 4.3 数据存储路径规格

```ts
export type StorageScope = 'project' | 'user' | 'custom'

export type StorageLocation = {
  scope: StorageScope
  path?: string
}

export type StorageConfig = {
  projectData: StorageLocation
  userData: StorageLocation
  sessions: StorageLocation
  memory: {
    project: StorageLocation
    user: StorageLocation
    session: StorageLocation
  }
  index: StorageLocation
  logs: StorageLocation
  jobs: StorageLocation
  plugins: {
    project: StorageLocation
    user: StorageLocation
  }
  skills: {
    project: StorageLocation
    user: StorageLocation
  }
}
```

默认路径：

```text
projectData: <project>/.linghun/
project memory: <project>/.linghun/memory/
session memory: <project>/.linghun/memory/session/
index metadata: <project>/.linghun/index/
codebase-memory artifact: <project>/.codebase-memory/
userData: ~/.linghun/
user memory: ~/.linghun/memory/
logs: ~/.linghun/logs/
jobs: ~/.linghun/jobs/
```

要求：

- 不允许硬编码 `C:`、`C:\Users\...` 或固定用户名。
- 所有路径必须通过配置解析函数获得，不能散落在业务代码中拼接。
- 项目级记忆优先支持项目内 `.linghun/memory/`，便于迁移和备份。
- 用户级记忆默认在 `~/.linghun/memory/`，但可配置到任意磁盘。
- 会话数据默认可使用用户目录，但必须支持切换到项目内或自定义路径。
- 索引产物默认项目内存储，避免与其他项目混用。
- 写入项目内 `.linghun/` 的文件必须有 gitignore 建议，避免误提交敏感内容。
- `/memory storage` 或等价命令必须显示当前项目记忆、用户记忆、会话、索引、日志的实际路径。
- 路径迁移必须可诊断：旧路径不存在时给出可操作错误，而不是静默新建错误目录。

## 5. 命令规格

命名约定：

- CLI 主命令为 `linghun`。
- Windows 必须兼容 `Linghun` 大小写入口。
- 配置、脚本、文档示例默认写 `linghun`。
- `Linghun` 只作为兼容入口，不作为内部包名或目录命名的默认形式。

第一批命令：

| 命令 | 行为 |
| --- | --- |
| `/help` | 显示常用命令 |
| `/config` | 打开配置面板 |
| `/model` | 查看/切换模型 |
| `/model route` | 查看多模型角色路由 |
| `/model route doctor` | 诊断多模型路由 |
| `/permissions` | 查看/编辑权限规则 |
| `/plan` | 进入只读计划模式 |
| `/mcp` | MCP 管理 |
| `/mcp doctor` | MCP 诊断 |
| `/index status` | 查看索引状态 |
| `/index init fast` | 建立 fast 索引 |
| `/sessions` | 会话列表 |
| `/memory` | 记忆查看 |
| `/memory storage` | 查看记忆、会话、索引数据存储位置 |
| `/stats` | token/费用统计 |
| `/cache-log` | 最近 20 轮缓存日志 |
| `/break-cache status` | 缓存破坏原因 |
| `/verify` | 运行验证 |
| `/agents` | Agent 管理 |
| `/features` | 功能开关 |
| `/doctor` | 环境诊断 |
| `/job` | 长期任务，默认 feature 关闭 |
| `/todo` | 查看当前任务列表 |
| `/diff` | 查看本轮改动摘要 |
| `/rewind` | 查看并回退检查点 |
| `/btw` | 临时插问，不打断主任务 |
| `/background` | 查看后台任务和 agent |
| `/workflow` | 查看/运行工作流 |
| `/skills` | Skills 管理 |
| `/plugins` | Plugins 管理 |
| `/plugins doctor` | 插件诊断 |

命令要求：

- 中文说明。
- 出错时给可操作建议。
- 新手模式隐藏高级危险命令。
- Claude 风格常用命令尽量保留，新增命令必须有中文解释。
- 命令别名必须可发现，不能只靠用户记忆。

## 6. TUI 规格

### 6.1 布局

```text
┌──────────────── messages ────────────────┐
│ user / assistant / tool / agent messages │
├──────────────── input ───────────────────┤
│ > 输入框                                 │
├──────────────── status ──────────────────┤
│ project · model · mode · cache · cost    │
└──────────────── hints ───────────────────┘
```

### 6.2 状态栏字段

| 字段 | 来源 |
| --- | --- |
| project | Session.projectName |
| model | ModelGateway.currentModel |
| mode | PermissionMode |
| cache | CacheSummary.hitRate |
| cost | CostSummary.sessionCny |
| index | IndexHealth.status |
| agents | AgentManager.runningCount |
| job | JobManager.currentJob 可选 |

示例：

```text
main · DeepSeek V4 Pro · strict · cache 94% · ¥0.12 · index ready · 1 agent
```

## 7. Provider 规格

```ts
export type Provider = {
  id: string
  displayName: string
  listModels(): Promise<ModelInfo[]>
  stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<LinghunEvent>
  supports: ProviderCapabilities
}
```

`ModelInfo`：

```ts
export type ModelInfo = {
  id: string
  displayName: string
  contextWindow: number
  maxOutputTokens: number
  supportsTools: boolean
  supportsVision: boolean
  supportsThinking: boolean
  supportsPromptCache: boolean
  inputPricePerMTok?: number
  outputPricePerMTok?: number
  cacheReadPricePerMTok?: number
  cacheWritePricePerMTok?: number
}
```

必须：

- DeepSeek V4 / V4 Pro 1M 上下文写入能力表。
- thinking 只对白名单启用。
- Provider 错误统一为 `LinghunError`。

### 7.1 多模型路由规格

```ts
export type ModelRole =
  | 'planner'
  | 'executor'
  | 'reviewer'
  | 'verifier'
  | 'summarizer'
  | 'vision'

export type RoleModelRoute = {
  role: ModelRole
  primaryModel: string
  fallbackModels: string[]
  maxInputTokens?: number
  maxOutputTokens?: number
  maxCostCny?: number
  allowTools: boolean
  allowWrite: boolean
  requireApprovalBeforeRun: boolean
}

export type ModelRouteConfig = {
  defaultModel: string
  routes: RoleModelRoute[]
}

export type RoleHandoff = {
  from: ModelRole
  to: ModelRole
  taskId: string
  summary: string
  evidence: EvidenceRef[]
  changedFiles: string[]
  diffSummary?: DiffSummary
  verificationReport?: VerificationReport
}
```

默认角色约束：

- `planner`：只规划，输出 `PlanProposal`，不允许写入。
- `executor`：执行已批准计划或用户明确任务，可写入但必须走权限。
- `reviewer`：只读审查，基于 diff、证据和关键文件给风险。
- `verifier`：只读复核，可运行验证命令。
- `summarizer`：低成本摘要，不允许写入。
- `vision`：处理图片/截图，只输出结构化观察。

路由规则：

- 优先按用户显式指定模型。
- 其次按 role-to-model 配置。
- 再按模型能力表选择支持工具、视觉、thinking、上下文、缓存的模型。
- 模型不可用、能力不足、超预算时使用 fallback。
- fallback 仍失败时暂停，提示用户选择模型或降低任务范围。
- 不允许为了多模型协作把完整 transcript 无差别发送给每个模型。
- 角色交接只传 `RoleHandoff`、必要文件片段和证据引用。
- 每个角色的 usage、cache、cost 必须单独统计。

命令：

```text
/model route
/model route doctor
/model route set planner gpt-5.5
/model route set executor deepseek-v4-pro
/model route set reviewer claude
```

`/model route doctor` 必须检查：

- 每个角色是否有可用 primary model。
- fallback 是否可用。
- 角色模型是否满足能力要求。
- 价格和上下文信息是否完整。
- 是否存在会导致高成本的配置。

## 8. Tool 规格

```ts
export type ToolDefinition<Input, Output> = {
  name: string
  title: string
  description: string
  inputSchema: z.ZodType<Input>
  permission: ToolPermissionSpec
  isReadOnly: boolean
  isConcurrencySafe: boolean
  isLongRunning?: boolean
  isCacheSensitive?: boolean
  validate(input: Input, ctx: ToolContext): Promise<void>
  call(input: Input, ctx: ToolContext): AsyncGenerator<ToolProgress, Output>
}
```

内置工具必须优先完成：

- Read
- Write
- Edit
- MultiEdit
- Grep
- Glob
- Bash
- Todo
- Diff

Tool 输出：

```ts
export type ToolOutput = {
  text: string
  data?: unknown
  truncated?: boolean
  fullOutputPath?: string
  changedFiles?: string[]
  checkpointId?: string
}
```

### 8.1 Todo 规格

```ts
export type TodoItem = {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'blocked'
  evidence?: string
}
```

要求：

- 长任务必须维护 Todo。
- 同一时间最多一个 `in_progress`。
- Todo 更新必须写入 transcript，恢复会话后可继续显示。
- Todo 只表达当前任务进度，不写入长期记忆。

### 8.2 Diff 规格

```ts
export type DiffSummary = {
  changedFiles: string[]
  addedLines: number
  removedLines: number
  summary: string
  riskyFiles: string[]
}
```

要求：

- 写入工具必须记录本轮 changedFiles。
- `/diff` 基于 changedFiles 生成摘要。
- default / plan / 高风险任务可在应用前展示 diff 摘要。
- diff 不应读取超大文件全文，必要时只展示 hunks 摘要。

## 9. 权限规格

```ts
export type PermissionMode =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'dontAsk'
  | 'auto'
  | 'bypass'
```

权限决策顺序：

1. 硬拒绝规则。
2. 工具自身 deny。
3. 安全路径检查。
4. plan 只读检查。
5. 用户 deny 规则。
6. 用户 ask 规则。
7. acceptEdits 低风险编辑。
8. bypass。
9. allow 规则。
10. ask。

Plan 模式允许：

- Read。
- Grep。
- Glob。
- WebSearch。
- Index query。
- 只读 Bash 白名单。

Plan 模式禁止：

- Write。
- Edit。
- MultiEdit。
- 安装命令。
- 删除命令。
- 长驻服务。

### 9.1 Plan Choice 规格

Plan 模式必须支持用户选择方案，而不是只输出一段文字。

```ts
export type PlanProposal = {
  id: string
  title: string
  summary: string
  rationale: string
  risk: 'low' | 'medium' | 'high'
  estimatedFiles: string[]
  steps: string[]
  validationPlan: string[]
  tradeoffs: string[]
  recommended: boolean
}

export type PlanDecision =
  | { type: 'approve'; proposalId: string }
  | { type: 'revise'; feedback: string }
  | { type: 'cancel' }
```

Plan 输出要求：

- 至少给出一个推荐方案。
- 非简单任务应给出 2-3 个可选方案。
- 高风险任务必须包含保守方案或分阶段方案。
- 每个方案必须说明风险、影响文件、验证计划。
- 用户确认前不得执行写入工具。

Plan 交互：

```text
1. 保守修复（推荐）
2. 完整整理
3. 临时止血

选择：1 / 2 / 3 / revise / cancel
```

执行规则：

- `approve` 后把选中的 proposal 转成执行任务。
- `revise` 后继续只读规划。
- `cancel` 后退出 plan，不修改文件。

### 9.2 权限规则持久化

```ts
export type PermissionRuleRecord = {
  id: string
  scope: 'project' | 'user'
  effect: 'allow' | 'ask' | 'deny'
  matcher: string
  reason?: string
  createdAt: string
}

export type RecentPermissionDecision = {
  requestId: string
  tool: string
  summary: string
  decision: 'allowed' | 'denied' | 'asked'
  reason: string
  createdAt: string
}
```

要求：

- `/permissions` 能查看、添加、删除规则。
- `/permissions recent` 能查看最近审批和拒绝原因。
- `acceptEdits` 只能自动允许低风险工作区文件编辑。
- `bypass` 不能绕过硬拒绝、安全路径和高风险交互检查。

## 9.3 Checkpoint / Rewind 规格

```ts
export type Checkpoint = {
  id: string
  sessionId: string
  createdAt: string
  reason: string
  changedFiles: string[]
  restoreKind: 'git' | 'snapshot'
}
```

要求：

- 跨文件写入、高风险编辑、批量替换前必须创建 checkpoint。
- Git 仓库优先使用轻量 diff/snapshot，不自动 commit。
- 非 Git 项目使用本地 snapshot，只保存受影响文件。
- `/rewind` 列出 checkpoint，用户确认后恢复。
- rewind 本身必须记录到 transcript。

## 9.4 输入队列、中断与临时插问

```ts
export type InterruptState =
  | { type: 'idle' }
  | { type: 'running'; taskId: string; canPause: boolean; canCancel: boolean }
  | { type: 'paused'; taskId: string; resumeToken: string }

export type BtwQuestion = {
  id: string
  text: string
  createdAt: string
  answeredAt?: string
}
```

要求：

- 多行粘贴必须作为一次用户输入处理，除非用户明确拆分。
- 流式输出、工具执行、agent 运行都必须能响应 AbortSignal。
- Esc/Ctrl+C 后显示任务状态：已取消、已暂停或仍在后台。
- `/btw` 只回答临时小问题，不修改当前 Todo、PlanDecision、checkpoint。
- `/btw` 的问答可记录到 transcript，但默认不进入长期记忆。

## 10. 验证增强规格

### 10.1 验证命令识别

```ts
export type VerificationCandidate = {
  id: string
  label: string
  command: string
  cwd: string
  confidence: 'high' | 'medium' | 'low'
  source: 'package.json' | 'pyproject.toml' | 'go.mod' | 'Cargo.toml' | 'Makefile' | 'CMakeLists.txt' | 'project-rules'
  estimatedCost: 'fast' | 'medium' | 'slow'
}
```

识别规则：

- `package.json`：优先 typecheck、test、lint、build。
- `pyproject.toml`：pytest、ruff、mypy。
- `go.mod`：go test ./...。
- `Cargo.toml`：cargo test。
- `Makefile`：test、check。
- `CMakeLists.txt`：项目规则优先。
- `LINGHUN.md` / `AGENTS.md` / `CLAUDE.md`：用户指定优先级最高。

### 10.2 Verification Runner

```ts
export type VerificationReport = {
  status: 'passed' | 'failed' | 'skipped'
  commands: VerificationCommandResult[]
  summary: string
  unverified: string[]
  risk: string[]
}
```

要求：

- 默认跑最小验证。
- 失败时提取关键错误。
- 输出截断但保存完整日志。
- 最多自动修复重试 `config.verification.maxRetries` 次。

### 10.3 Verifier Agent

输入：

- diff。
- 用户原始需求。
- 修改文件列表。
- 验证报告。

输出：

- 是否满足需求。
- 是否过度修改。
- 是否缺测试。
- 是否有明显回归。
- 是否建议继续修。

## 11. Behavior Guardrail / Evidence Gate 规格

### 11.1 目标

在代码层面降低幻觉，阻止模型在没有事实依据时靠猜回答。该模块不是普通 prompt，而是对工具使用、结论输出和最终回答进行约束的中间层。

### 11.2 Evidence 证据模型

```ts
export type EvidenceKind =
  | 'file_read'
  | 'grep_result'
  | 'index_query'
  | 'command_output'
  | 'test_result'
  | 'web_source'
  | 'user_provided'

export type EvidenceRecord = {
  id: string
  kind: EvidenceKind
  summary: string
  source: string
  createdAt: string
  supportsClaims: string[]
}

export type EvidenceRef = {
  id: string
  kind: EvidenceKind
  source: string
  summary: string
}
```

证据来源：

- `Read` 产生 `file_read`。
- `Grep` / `Glob` 产生 `grep_result`。
- codebase-memory 产生 `index_query`。
- `Bash` 产生 `command_output`。
- Verification Runner 产生 `test_result`。
- WebSearch / WebFetch 产生 `web_source`。
- 用户粘贴的明确内容产生 `user_provided`。

### 11.3 Evidence Gate

Evidence Gate 在以下场景触发：

- 用户要求分析代码。
- 用户要求修 bug。
- 用户要求解释某个函数或调用链。
- 用户要求判断“是不是已经修好”。
- 用户要求最新资料。
- 模型准备输出最终结论。

规则：

```ts
export type EvidenceGateDecision =
  | { type: 'allow' }
  | { type: 'require_tool'; reason: string; suggestedTools: string[] }
  | { type: 'require_disclaimer'; reason: string }
  | { type: 'block_claim'; reason: string }
```

必须阻止：

- 没读文件就断言代码实现。
- 没查索引就断言调用链。
- 没跑验证就声称验证通过。
- 没联网就声称最新版本或最新规则。
- 当前模型无视觉能力却声称看懂图片。

允许：

- 说明“我还没确认，需要先检查”。
- 给出初步假设，但必须标注为假设。
- 提出下一步工具检查计划。

### 11.4 Tool-before-answer 策略

代码任务默认进入 tool-before-answer：

```text
代码事实类问题：
  先 Read/Grep/Index
  再回答

修改类问题：
  先定位和读取
  再 Edit/Write
  再 Verify

最新信息类问题：
  先 WebSearch/WebFetch
  再回答
```

可跳过工具的情况：

- 用户只问概念性问题。
- 用户明确要求不要读取文件。
- 用户已经粘贴完整相关代码。
- 当前阶段只是产品头脑风暴。

跳过时最终回答必须说明依据来自用户提供内容或通用知识。

### 11.5 Claim Checker

Claim Checker 检查模型最终回答中的高风险结论。

高风险关键词：

- “已修复”
- “已验证”
- “测试通过”
- “代码里”
- “调用链是”
- “最新版本”
- “一定”
- “不会影响”
- “没有风险”

```ts
export type ClaimCheckResult = {
  status: 'passed' | 'needs_disclaimer' | 'blocked'
  unsupportedClaims: string[]
  requiredEvidence: EvidenceKind[]
  rewriteHint?: string
}
```

处理方式：

- 有证据：允许。
- 证据不足：要求改写为不确定表达。
- 明显无证据却强断言：阻止最终回答，要求先查证。

### 11.6 最终回答结构

涉及代码改动的最终回答必须包含：

```text
已确认：
已修改：
已验证：
未验证：
剩余风险：
```

如果没有修改代码：

```text
已确认：
依据：
建议下一步：
```

禁止在没有证据时写：

- “已验证通过”
- “不会有问题”
- “已经完全修复”

### 11.7 与 Verification Runner 的关系

- Evidence Gate 负责“不能靠猜”。
- Verification Runner 负责“改完要验证”。
- Claim Checker 负责“最终回答不能虚构结论”。

三者必须串联：

```text
tool evidence -> verification evidence -> claim check -> final answer
```

## 12. Cache / Cost 规格

```ts
export type CacheTurnStats = {
  turn: number
  timestamp: number
  hitRate: number | null
  cacheReadTokens: number
  cacheWriteTokens: number
  inputTokens: number
  outputTokens: number
  model: string
  compacted: boolean
}
```

要求：

- 最近 20 轮环形缓冲。
- `/cache-log` 可查看。
- 低于阈值状态栏警告。
- cache break 必须记录原因。

Cost：

```ts
export type CostSummary = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  estimatedUsd: number
  estimatedCny: number
  estimatedSavedCny?: number
}
```

## 13. MCP 规格

MCP manager 必须支持：

- stdio server。
- 启用/禁用。
- doctor。
- 工具发现。
- 工具稳定排序。
- description 稳定化。
- input schema 稳定化。
- 失败隔离。

MCP server config：

```ts
export type McpServerConfig = {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  enabled: boolean
  autoStart: boolean
}
```

默认推荐但不强制：

- codebase-memory-mcp。
- AI sessions MCP。
- web search MCP。

## 14. Codebase Index 规格

```ts
export type IndexHealth = {
  status: 'none' | 'ready' | 'stale' | 'indexing' | 'error'
  indexedAt?: string
  changedFiles?: number
  totalFiles?: number
  warning?: string
}
```

要求：

- 首次进入项目提示 fast index。
- 大文件扫描。
- `.linghunignore` 与 `.cbmignore` 兼容。
- 变更超过阈值提示刷新。
- 不自动强制重建。

## 15. Memory 规格

记忆分级：

- user memory。
- project memory。
- session memory。
- candidate memory。

```ts
export type MemoryItem = {
  id: string
  scope: 'user' | 'project' | 'session'
  text: string
  storagePath: string
  sourceSessionId?: string
  confidence: number
  createdAt: string
  updatedAt: string
  status: 'active' | 'disabled' | 'candidate'
}
```

要求：

- 长期记忆写入前默认确认。
- 可查看、编辑、删除、禁用。
- 不存大段原始对话。
- 不让错误记忆不可逆。
- 项目级记忆默认写入 `<project>/.linghun/memory/`。
- 用户级记忆默认写入 `~/.linghun/memory/`，但必须可配置到其他磁盘。
- 会话级临时记忆默认跟随 session 存储位置。
- 记忆写入前必须明确 scope 和 storagePath。
- `/memory storage` 必须能解释每类记忆当前写在哪里。
- 迁移项目时，项目级记忆必须能随项目目录一起迁移。

## 16. Agent 规格

```ts
export type AgentRun = {
  id: string
  type: 'explorer' | 'worker' | 'verifier' | 'planner'
  model: string
  permissionMode: PermissionMode
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  transcriptPath: string
  cost: CostSummary
}
```

Agent 限制：

- explorer 只读。
- verifier 默认只读，可运行验证命令。
- worker 可编辑但受权限。
- planner 只规划。
- 默认最多 3 个并发 agent。

## 17. Jobs 长期托管规格

默认 feature 关闭。

```ts
export type JobDefinition = {
  id: string
  name: string
  projectPath: string
  prompt: string
  schedule: string
  enabled: boolean
  maxRuntimeMinutes: number
  maxTokens: number
  maxCostCny: number
  allowEdits: boolean
  allowBash: boolean
  allowAgents: boolean
  requirePlanBeforeWrite: boolean
}
```

要求：

- 每次 job 创建独立 session。
- 超预算停止。
- 高风险暂停。
- 生成报告。
- 可手动 run-now。
- 可 pause/resume。

## 18. Skills / Workflow 规格

Skill 目录：

```text
.linghun/skills/
~/.linghun/skills/
```

Skill metadata：

```ts
export type Skill = {
  id: string
  name: string
  description: string
  triggers: string[]
  file: string
  enabled: boolean
}
```

要求：

- 不把所有 skill 全文塞进 prompt。
- 先检索摘要，再加载必要 skill。
- 成功任务可生成候选 skill，用户确认后写入。

## 18.1 Plugin 规格

Plugin 是系统扩展包，和 Skill 分开。Skill 影响模型怎么做事，Plugin 影响 Linghun 能接入什么外部能力。

本规格只定义第一版 Plugin 底座，不定义完整插件生态。第一版重点是本地加载、启停、诊断、权限管道接入和失败隔离。

Plugin 目录：

```text
.linghun/plugins/
~/.linghun/plugins/
```

Plugin metadata：

```ts
export type PluginManifest = {
  id: string
  name: string
  description: string
  version: string
  linghunVersion: string
  pluginApiVersion: string
  enabled: boolean
  source?: PluginSource
  contributes: {
    skills?: string[]
    commands?: string[]
    mcpServers?: string[]
    providers?: string[]
    hooks?: string[]
  }
  permissions: PluginPermission[]
}

export type PluginPermission =
  | 'read_project'
  | 'write_project'
  | 'run_command'
  | 'network'
  | 'mcp'

export type PluginTrustLevel = 'local' | 'official' | 'third-party'
```

要求：

- Plugin 默认不启用高风险能力。
- Plugin 新增命令、MCP、provider、hook 时必须进入 `/plugins doctor` 可见。
- Plugin 贡献的工具仍走统一权限管道。
- Plugin 加载失败不能影响主会话。
- Plugin 清单排序稳定，避免破坏 prompt cache。
- Plugin 必须声明 Linghun 最低版本和 Plugin API 版本。
- Plugin 来源必须分级为 local / official / third-party。
- Plugin 贡献内容必须带来源，方便 `/plugins doctor` 和 UI 展示。

第一版本地底座暂不包含：

- 插件市场。
- 远程安装。
- 自动更新。
- 第三方插件评分和分发。
- 完整沙箱运行时。
- 插件商业化、账号或云同步。

后续成品级 Plugin System 需要补充：

- install / enable / disable / update / remove 生命周期。
- GitHub 插件安装：
  - `/plugins install github:owner/repo`
  - `/plugins install https://github.com/owner/repo`
  - 安装后记录 sourceUrl、version、commit hash。
  - 默认只读取 manifest 和插件文件，不执行 postinstall 脚本。
- 插件首次启用权限审批。
- 插件 API 版本和 Linghun 最低版本声明。
- command / MCP / provider / hook / workflow / skill 贡献点详细接口。
- `/plugins doctor` 的依赖、路径、权限、加载错误诊断。
- 本地插件、官方推荐插件、第三方插件的来源安全分级。
- 更新插件时必须重新计算权限差异，并要求用户确认。
- GitHub 拉取或解析失败时，必须保持已有插件状态不变。
- 插件隔离策略：插件加载、解析、执行错误必须转成可恢复错误，不能让主进程崩溃。
- 插件缓存保护：插件列表、贡献点、schema、description 必须稳定排序，动态字段不得进入 prompt 稳定层。
- 插件开发文档：必须提供如何创建、调试、发布插件的文档和最小示例。

GitHub 插件安装记录：

```ts
export type PluginSource = {
  type: 'local' | 'github'
  sourceUrl?: string
  owner?: string
  repo?: string
  ref?: string
  commit?: string
  installedAt: string
}
```

Plugin doctor 报告：

```ts
export type PluginDoctorReport = {
  pluginId: string
  status: 'ok' | 'warning' | 'error'
  path: string
  source: PluginSource
  trustLevel: PluginTrustLevel
  manifestValid: boolean
  versionCompatible: boolean
  dependencyIssues: string[]
  permissionSummary: PluginPermission[]
  contributionSummary: {
    commands: string[]
    mcpServers: string[]
    providers: string[]
    hooks: string[]
    workflows: string[]
    skills: string[]
  }
  errors: string[]
  suggestions: string[]
}
```

## 19. 错误规格

```ts
export type LinghunError = {
  code: string
  message: string
  suggestion?: string
  cause?: unknown
  recoverable: boolean
}
```

错误必须：

- 中文可读。
- 给下一步建议。
- 标明是否可恢复。

示例：

```text
模型请求失败：API Key 无效。
建议：运行 /model doctor 检查当前 provider 配置。
```

## 20. 测试规格

每个包至少有：

- unit tests。
- integration tests。
- Windows path tests。

关键端到端场景：

1. 启动 TUI。
2. 切换模型。
3. 读改测闭环。
4. plan 模式禁止写入。
5. acceptEdits 自动低风险编辑。
6. cache history 记录。
7. MCP 失败降级。
8. codebase index 状态。
9. 会话恢复。
10. verifier agent 复核。

## 21. 开工顺序

严格按蓝图：

1. 骨架。
2. Session。
3. 模型网关。
4. TUI。
5. 核心工具。
6. 权限。
7. 行为控制。
8. 验证增强。
9. 缓存成本。
10. MCP 索引。
11. 会话记忆。
12. Agent。
13. 多模型。
14. Skills。
15. 真实项目测试。
16. 可控学习。
17. 长期托管。
18. 桌面端预留。

不能为了后期功能牺牲前期闭环。
