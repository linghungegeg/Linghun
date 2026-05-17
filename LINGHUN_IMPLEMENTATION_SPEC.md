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
  kind: 'bash' | 'agent' | 'job' | 'mcp' | 'verification' | 'compact'
  title: string
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  currentStep?: string
  progress?: {
    completed: number
    total?: number
    label?: string
  }
  startedAt: string
  updatedAt: string
  lastOutputAt?: string
  estimatedRemainingMs?: number
  heartbeatIntervalMs: number
  staleAfterMs: number
  cost?: CostSummary
  logPath?: string
  outputPath?: string
  result?: 'pass' | 'fail' | 'partial'
  userVisibleSummary: string
  nextAction?: string
}
```

要求：

- 长 Bash、agent、job、verification、compact 都进入统一后台任务表。
- TUI 状态栏只显示摘要，详情通过 `/background` 打开。
- 后台任务必须可取消；可恢复能力按 kind 声明。
- 后台任务启动后必须立即产生一条用户可见摘要，说明任务名称、当前步骤、预计范围和查看详情命令。
- 后台任务运行期间必须定期 heartbeat。超过 `heartbeatIntervalMs` 没有输出时，TUI 应提示“仍在运行”和当前步骤；超过 `staleAfterMs` 时提示可能较慢，并提供查看日志、后台运行或取消入口。
- 如果 `outputPath` 存在但尚无有效内容，状态必须显示“尚未产生有效输出”，不能让用户自己判断空文件。
- 完成后必须主动产生结果摘要：`pass` / `fail` / `partial` / `cancelled`，并给出下一步建议。
- 主任务不得在必要 verification / verifier task 未结束前宣称阶段完成。
- 用户询问“现在在干嘛 / 还要多久 / 卡住了吗”时，必须读取 `BackgroundTask` 状态表回答，不得靠猜。
- 后台任务状态事件必须进入 transcript 或等价任务日志，便于新会话 handoff。

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

### 4.3 语言与 i18n 规格

`language` 控制所有用户可见终端文案：

- `zh-CN`：状态栏、权限提示、错误信息、帮助说明、轻提示、工具结果摘要默认输出中文。
- `en-US`：状态栏、权限提示、错误信息、帮助说明、轻提示、工具结果摘要默认输出英文。
- Slash 命令、配置键、环境变量、transcript 结构化事件字段保持英文，不随语言变化。
- 模型回复语言默认跟随 `language`；用户当前请求明确指定回复语言时，以用户请求为准。
- Phase 07 开始，新增用户可见文案必须通过统一 i18n helper 或等价字典输出。
- Phase 06 已落地的中文权限文案可在 Phase 07 统一接入 i18n，不应打断 Phase 06 权限闭环。
- 测试至少覆盖一个中文输出和一个英文输出路径。

### 4.4 数据存储路径规格

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
  cache: StorageLocation
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
userData: ~/.linghun/data/
sessions: ~/.linghun/data/sessions/
user memory: ~/.linghun/data/memory/
logs: ~/.linghun/data/logs/
jobs: ~/.linghun/data/jobs/
cache history: ~/.linghun/data/cache/
```

环境变量：

```text
LINGHUN_DATA_DIR=<absolute path>
```

`LINGHUN_DATA_DIR` 是统一用户数据根目录。设置后，未被 `storage.*` 单项覆盖的用户级数据默认写入：

```text
sessions: <LINGHUN_DATA_DIR>/sessions/
user memory: <LINGHUN_DATA_DIR>/memory/
logs: <LINGHUN_DATA_DIR>/logs/
jobs: <LINGHUN_DATA_DIR>/jobs/
cache history: <LINGHUN_DATA_DIR>/cache/
```

路径解析优先级：

```text
CLI 参数指定的路径
> storage.* 单项配置
> LINGHUN_DATA_DIR
> 默认 ~/.linghun/data/
```

要求：

- 不允许硬编码 `C:`、`C:\Users\...` 或固定用户名。
- 所有路径必须通过配置解析函数获得，不能散落在业务代码中拼接。
- 项目级记忆优先支持项目内 `.linghun/memory/`，便于迁移和备份。
- 用户级记忆默认在 `~/.linghun/data/memory/`，但可通过 `LINGHUN_DATA_DIR` 或 `storage.memory.user` 配置到任意磁盘。
- 会话数据 Phase 02 默认使用 `~/.linghun/data/sessions/`；Phase 11 必须支持通过 `LINGHUN_DATA_DIR` 或 `storage.sessions` 切换到项目内或自定义路径。
- 用户级记忆、日志、长期任务和缓存历史必须支持跟随 `LINGHUN_DATA_DIR` 迁移。
- 索引产物默认项目内存储，避免与其他项目混用。
- 写入项目内 `.linghun/` 的文件必须有 gitignore 建议，避免误提交敏感内容。
- `/memory storage` 或等价命令必须显示当前项目记忆、用户记忆、会话、索引、日志的实际路径。
- 路径迁移必须可诊断：旧路径不存在时给出可操作错误，而不是静默新建错误目录。
- Windows 示例必须使用非固定盘符写法说明，例如 `LINGHUN_DATA_DIR=F:\LinghunData` 只是示例，不能写死到代码或默认配置。

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
| `/resume` | 恢复最近或指定会话 |
| `/branch` | 从当前任务创建分支会话 |
| `/memory` | 记忆查看 |
| `/memory storage` | 查看记忆、会话、索引数据存储位置 |
| `/usage` | 原始 token/cache usage |
| `/stats` | 会话、缓存、模型、耗时等综合统计 |
| `/cache-log` | 最近 20 轮缓存日志 |
| `/break-cache status` | 缓存破坏原因 |
| `/verify` | 运行验证 |
| `/agents` | Agent 管理 |
| `/features` | 功能开关 |
| `/doctor` | 环境诊断 |
| `/job` | 长期任务，默认 feature 关闭 |
| `/todo` | 查看当前任务列表 |
| `/diff` | 查看本轮改动摘要 |
| `/review` | 基于 diff / 关键文件做只读审查 |
| `/rewind` | 查看并回退检查点 |
| `/btw` | 临时插问，不打断主任务 |
| `/background` | 查看后台任务和 agent |
| `/workflows` | 查看/运行工作流 |
| `/fork` | 派生子会话或 agent |
| `/skills` | Skills 管理 |
| `/plugins` | Plugins 管理 |
| `/plugins doctor` | 插件诊断 |
| `/doctor hooks` | Hooks 诊断 |

命令要求：

- 中文说明。
- 出错时给可操作建议。
- 新手模式隐藏高级危险命令。
- Claude 风格常用命令尽量保留，新增命令必须有中文解释。
- 命令别名必须可发现，不能只靠用户记忆。

### 5.1 自然语言控制桥规格

自然语言控制桥让用户用普通中文或英文查看和控制 Linghun 的核心状态，但执行裁决必须在本地程序中完成，不能让模型自由猜测或绕过命令系统。用户不需要按固定关键词说话；实现必须基于命令能力目录和语义识别。

Linghun 必须维护稳定的命令能力目录：

```ts
export type CommandCapabilityRisk =
  | 'readonly'
  | 'start_gate'
  | 'config_write'
  | 'tool_permission'
  | 'dangerous'
  | 'unsupported'

export type CommandCapability = {
  id: string
  slash: string
  aliases?: string[]
  titleZh: string
  titleEn: string
  descriptionZh: string
  descriptionEn: string
  whenToUseZh: string[]
  whenToUseEn: string[]
  risk: CommandCapabilityRisk
  readonly: boolean
  modelInvocable: boolean
  userInvocable: boolean
  requiresStartGate: boolean
  writesConfig: boolean
  entersPermissionPipeline: boolean
  bridgeSafe: boolean
  hiddenInBeginnerMode?: boolean
}

export type SlashCommandRegistryEntry = {
  slash: string
  subcommands?: string[]
  handlerId: string
  capabilityId: string
  userVisible: boolean
  hiddenReason?: string
  risk: CommandCapabilityRisk
  readonly: boolean
}
```

要求：

- 所有 slash 命令必须注册到 `CommandCapability` 或等价目录。
- `CommandCapability` 应从命令注册表、help 元数据或统一 manifest 派生，禁止另写一份长期漂移的手工清单；确需手工补充时必须有测试发现未登记命令。
- Phase 15 preflight hardening 的最低要求是建立 `SlashCommandRegistryEntry` 或等价真实 dispatch 清单，并测试 `dispatch user-visible slash commands -> capability metadata` 不漂移；新增可执行 slash command 没有 capability 时测试必须失败。
- `/help`、Natural Intent Router、model-visible `CommandCapabilitySummary` 和 slash dispatch 的用户可见命令列表必须来自同一 registry / manifest 或被同一个 drift test 约束。
- intent router 和模型提示都消费同一份稳定目录摘要，避免两套解释漂移。
- 目录摘要必须稳定排序、短描述、可截断，不能把动态日志、时间戳或大输出放进去。
- 中文和英文都必须有说明与 when-to-use，不要求机器翻译完全一致，但语义必须一致。
- 必须区分用户可见说明和模型可见摘要；模型可见摘要只用于语义匹配和风险解释，不能包含完整 skill/plugin/hook 正文。
- `modelInvocable=false` 的命令可以被自然语言解释用途和风险，但不得由模型或自然语言桥直接触发。
- `bridgeSafe=false` 的命令不得从远程/IM/桥接入口直接执行，只能生成确认说明或要求用户回到本地终端。
- 参考 CCB 的“命令/技能目录 + 描述 + whenToUse + disable model invocation + bridge safe allowlist + language preference”方向，但 Linghun 自研实现，不能复制可疑源码。

```ts
export type NaturalIntentRisk =
  | 'readonly'
  | 'start_gate'
  | 'config_write'
  | 'tool_permission'
  | 'unsupported'

export type NaturalRequestKind =
  | 'status_query'
  | 'doctor_query'
  | 'usage_help'
  | 'safe_action_request'
  | 'config_change_request'
  | 'dangerous_action_request'
  | 'ambiguous_request'

export type NaturalIntent =
  | { kind: 'memory.status'; risk: 'readonly' }
  | { kind: 'memory.review'; risk: 'readonly' }
  | { kind: 'memory.storage'; risk: 'readonly' }
  | { kind: 'index.status'; risk: 'readonly' }
  | { kind: 'index.init'; mode: 'fast'; risk: 'start_gate' }
  | { kind: 'index.refresh'; risk: 'start_gate' }
  | { kind: 'cache.status'; risk: 'readonly' }
  | { kind: 'cache.breakStatus'; risk: 'readonly' }
  | { kind: 'model.status'; risk: 'readonly' }
  | { kind: 'model.doctor'; risk: 'readonly' }
  | { kind: 'model.set'; model: string; risk: 'config_write' }
  | { kind: 'mode.status'; risk: 'readonly' }
  | { kind: 'mode.set'; mode: PermissionMode; risk: 'config_write' }
  | { kind: 'workflow.list'; risk: 'readonly' }
  | { kind: 'workflow.startGate'; name: string; risk: 'start_gate' }
  | { kind: 'skills.status'; risk: 'readonly' }
  | { kind: 'plugins.status'; risk: 'readonly' }
  | { kind: 'plugins.doctor'; risk: 'readonly' }
  | { kind: 'hooks.doctor'; risk: 'readonly' }
  | { kind: 'session.resume'; risk: 'readonly' }
  | { kind: 'session.branch'; purpose?: string; risk: 'start_gate' }
  | { kind: 'unknown'; risk: 'unsupported' }

export type NaturalIntentSlot =
  | { name: 'mode'; value: PermissionMode; confidence: number }
  | { name: 'workflow'; value: 'bug-fix' | 'review' | 'refactor-plan' | 'doc-to-code' | 'design-to-code' | 'release-note'; confidence: number }
  | { name: 'agentRole'; value: 'explorer' | 'planner' | 'verifier' | 'worker'; confidence: number }
  | { name: 'indexAction'; value: 'status' | 'init' | 'refresh' | 'search' | 'architecture'; confidence: number }
  | { name: 'modelAction'; value: 'status' | 'route' | 'doctor' | 'setCandidate'; confidence: number }
  | { name: 'modelCandidate'; value: string; confidence: number }
  | { name: 'branchPurpose'; value: string; confidence: number }

export type NaturalRouteResult = {
  intent: NaturalIntent
  requestKind: NaturalRequestKind
  capabilityId?: string
  equivalentCommand?: string
  slots: NaturalIntentSlot[]
  confidence: number
  candidates: Array<{ capabilityId: string; command: string; score: number }>
  riskHandler: CommandCapabilityRisk | 'clarify' | 'model'
}

export type RuntimeStatusForModel = {
  memory: {
    projectRules: 'found' | 'missing' | 'unreadable'
    candidates: number
    accepted: number
    autoAccept: boolean
  }
  index: {
    status: 'unknown' | 'ready' | 'missing' | 'stale' | 'error' | 'indexing'
    changedFiles: number
  }
  cache: {
    latestHitRate?: number
    changedKeys: string[]
  }
  model: {
    provider: string
    name: string
  }
  permissionMode: PermissionMode
  extensions: {
    skills: { enabled: boolean; count: number }
    plugins: { enabled: boolean; count: number }
    hooks: { enabled: boolean; count: number }
  }
}

export type PendingStartGate = {
  gateId: string
  source: 'natural_command' | 'slash' | 'workflow' | 'agent' | 'plugin' | 'hook' | 'remote_channel' | 'user_request'
  capabilityId: string
  exactCommand: string
  structuredAction?: unknown
  risk: CommandCapabilityRisk
  scope: string
  budgetHint?: string
  logPath?: string
  cancelHint: string
  createdAt: string
  expiresAt: string
  requiresExactConfirmation: boolean
  requiresPermissionPipeline: boolean
  writesConfig: boolean
  writesFiles: boolean
  runsBash: boolean
  usesNetwork: boolean
}

export type PermissionEscalationProposal = {
  requestId: string
  source: PendingStartGate['source'] | 'tool' | 'model'
  exactAction: string
  risk: CommandCapabilityRisk
  scope: string
  reason: string
  rollback: string
  choices: Array<'allow_once' | 'allow_session' | 'allow_project' | 'deny' | 'deny_with_feedback'>
  allowAlwaysAvailable: boolean
}
```

执行规则：

- 自然语言桥必须先判断 `requestKind`，再决定读取状态、解释用途、进入 doctor、生成 Start Gate、写配置确认、权限阻断或追问。不能只命中 capability 后直接退回 slash command 用法。
- `status_query` 必须读取本地真实状态或等价只读 slash handler，并返回短摘要。例如“现在是什么模型”“自动记忆是否打开”“缓存命中怎么样”“索引好了没”不得回答成命令用法。
- `doctor_query` 必须进入对应诊断能力，例如“模型 key 配好了吗”“模型配置正常吗”应走 model doctor / route doctor 诊断口径；缺失 provider/baseUrl/apiKey/model 时给可操作修复提示，但不得输出真实 API key。
- `usage_help` 只用于用户明确询问“怎么用/能做什么/风险是什么/这个命令是什么意思”的场景；所有 slash 命令都必须可解释用途、风险和边界。
- `safe_action_request` 只能生成 Start Gate，例如建立索引、启动 workflow、resume/branch/fork/verifier 等安全启动请求；确认后仍走等价 slash command 和后续权限管道。
- `config_change_request` 必须展示将修改的配置键、旧值/新值摘要、风险、scope 和回滚方式；模型切换、mode 切换、role route 设置不能静默写配置。
- `dangerous_action_request` 必须阻断或进入权限管道，例如 Bash、依赖安装、write/edit、permission 规则、bypass、force refresh、memory accept/delete、第三方 enable、hook/job/remote；不得自然语言直通。
- `ambiguous_request` 必须列候选或追问，不得猜测执行。候选应包含 capability、可能的等价命令和风险摘要。
- `readonly` 意图直接调用本地状态函数或等价 slash handler，返回短摘要。
- `start_gate` 意图只输出确认门；用户确认后再调用等价 slash command。
- `config_write` 意图必须展示即将变更的配置、风险和回滚方式；用户确认后再写配置。
- `tool_permission` 意图不得由自然语言桥直接执行，必须进入现有工具权限管道。
- `unsupported` 意图交给普通模型对话，但模型请求必须带短 `RuntimeStatusForModel`。
- 自然语言桥确认路径必须生成 `PendingStartGate`。pending gate 必须短时间过期；确认时必须重放 exact command、risk、scope；高风险 gate 必须要求 exact command/明确选项或进入权限管道。
- `PendingStartGate.requiresPermissionPipeline=true` 时，Start Gate 只能作为任务启动确认，不能直接执行底层工具或配置写入。
- 自然语言请求 `mode bypass`、权限规则、第三方 enable、`cache refresh`、`index refresh --force`、Bash、依赖安装、记忆接受/删除、rewind restore、hook/job/remote 时，必须生成 `PermissionEscalationProposal` 或阻断说明，不得直接执行。
- pending gate 存在时，TUI 状态栏或 footer 必须显示待确认状态；用户输入非确认内容时取消或重新选择，不得让旧 gate 在后台继续等待。

语义识别要求：

- 不能只做固定关键词匹配；必须至少支持同义表达、问句/祈使句、中文/英文、带参数和不带参数的变体。
- 同一 capability 下必须区分状态查询、诊断查询、用法/风险询问和动作请求。例如 `model` 能力下，“现在是什么模型”是 `status_query`，“模型配置正常吗/key 配好了吗”是 `doctor_query`，“/model 怎么用”是 `usage_help`，“切到 gpt-5.5”是 `config_change_request`。
- 实现可以先用规则化 parser + capability catalog，不要求 Phase 15 preflight 引入额外模型分类器。
- 如果规则识别置信度低，必须追问或给出候选命令，不能擅自执行。
- 自然语言询问“这个能做什么/怎么用/风险是什么”时，所有 slash 命令都必须能被解释。
- 回复语言必须跟随当前 language preference；没有设置时按用户输入主语言回复。命令名、路径、模型 id、provider id 和错误码保持原文。
- 同一 `NaturalIntent` 的中英文、多种同义说法必须归一到同一 risk handler，不能出现中文直通、英文 Start Gate 或相反的风险不一致。
- 参数提取必须显式返回置信度和候选值；例如 workflow/model/mode/branch purpose 缺失或模糊时，只能提示候选，不能猜测执行。
- Phase 15 preflight hardening 必须补齐关键 slot：`mode`、`workflow`、`agentRole`、`indexAction`、`modelAction/modelCandidate`、`branchPurpose`。不能把“切到 plan mode”“打开 review workflow”“开 verifier agent”“搜索 TODO”“创建修复登录 bug 的分支会话”都退化成泛化 `/mode`、`/workflows`、`/fork`、`/index` 或 `/branch`。
- 普通模型对话前注入的 RuntimeStatus 必须是短结构化摘要，且必须可关闭或可审计，避免每轮增加大 token 成本。

模式和提权硬边界：

- `bypass` 必须有本地显式 opt-in 配置，例如 `permission.allowBypass=true` 或等价交互确认；模型、自然语言桥、remote channel、workflow、agent、plugin、hook 不得静默打开。
- `auto` 必须检查本地 classifier/gate 可用性；不可用时拒绝或降级到 `default`，并记录 reason。
- `plan` 模式禁止写文件和高危命令；计划批准必须生成结构化决策：`approve_manual_edits`、`approve_accept_edits`、`reject_with_feedback` 或等价值。
- `acceptEdits` 只自动允许工作区内低风险编辑；Bash、联网、依赖、权限、越界路径、第三方扩展、hook/job/remote 仍必须审批或拒绝。
- mode change 必须写入 session-visible event，避免状态栏、transcript 和权限管道状态漂移。

三批覆盖：

| 批次 | 范围 | 要求 |
| --- | --- | --- |
| 第一批 | memory、index、cache、model、mode、workflow、skills、plugins、hooks、sessions、resume、branch | Phase 15 preflight 必须完整实现；中英文自然语言可查询状态或进入安全启动门 |
| 第二批 | read、grep、glob、todo、verify、review、diff、fork、agents、background | Phase 15 preflight 必须纳入 Catalog、自然语言发现、用途/风险解释、参数提取、确认门和 focused tests；Phase 15 Beta 继续用真实项目验证，Phase 15.5 修 P0/P1；长任务必须显示范围、预算、日志和取消方式 |
| 第三批 | write、edit、multiedit、bash、permissions add/remove、mode bypass、cache refresh、index force、skills enable、plugins enable、memory accept/delete、rewind restore、hook/job/remote | 不允许自然语言直通；只允许解释风险、生成 Start Gate 或进入权限审批 |

Beta 前 hardening 验收：

- Drift test：实际 dispatch 可执行用户可见 slash command 与 `CommandCapability` / registry 一致。
- Matrix test：每个 capability 至少覆盖中文用途/风险询问、英文用途/风险询问、动作请求、状态/只读路径如适用、高风险反例如适用。
- Request-kind test：每个第一批 capability 至少覆盖 `status_query`、`usage_help` 和动作请求；有 doctor 能力的 capability 必须覆盖 `doctor_query`；高风险 capability 必须覆盖 `dangerous_action_request`；模糊请求必须覆盖 `ambiguous_request`。
- Slot test：mode/workflow/agentRole/indexAction/model/branchPurpose 能提取常见参数；模糊时给候选，不猜。
- Gate test：pending gate 有过期、状态可见、确认时重放 exact command/risk/scope；高风险 gate 不接受普通“确认”直通。
- Mode test：bypass 无本地 opt-in 时拒绝；auto gate 不可用时拒绝或降级；plan approval 不等于授权后续所有工具。
- Summary test：RuntimeStatus 和 CommandCapabilitySummary 保持短、稳定排序，不包含完整 transcript/memory/index/log/skill/plugin/hook 正文。

第一批验收样例必须覆盖中英文，但实现不能只匹配这些固定短语：

| 意图 | 中文样例 | English samples | 等价命令 |
| --- | --- | --- | --- |
| memory.status | 自动记忆开了吗、记住了什么、记忆状态 | is memory enabled, what do you remember | `/memory` |
| memory.review | 有待确认记忆吗、记忆候选 | pending memories, memory candidates | `/memory review` |
| memory.storage | 记忆存在哪里、会话存在哪里 | where is memory stored, session storage | `/memory storage` |
| index.status | 索引状态、索引好了没 | index status, is indexing ready | `/index status` |
| index.init | 建立索引、初始化索引 | build the index, initialize index | `/index init fast` |
| cache.status | 缓存命中怎么样、cache 状态 | cache hit rate, cache status | `/cache status` |
| cache.breakStatus | 为什么 cache 变了、缓存为什么失效 | why did cache change, cache break status | `/break-cache status` |
| model.status | 当前模型、你是什么模型 | current model, what model are you using | `/model` |
| model.doctor | 模型配置有问题吗、key 配好了吗 | model doctor, is the API key configured | `/model doctor` |
| mode.status | 当前权限模式、现在是什么模式 | current mode, permission mode | `/mode` |
| workflow.list | 有哪些工作流 | list workflows, available workflows | `/workflows` |
| workflow.startGate | 打开 bug-fix 工作流、开始修 bug 工作流 | start bug-fix workflow, open bug fix flow | `/workflows bug-fix` |
| skills.status | 有哪些 skills、技能开了吗 | list skills, are skills enabled | `/skills` |
| plugins.status | 有哪些 plugins、插件开了吗 | list plugins, plugin status | `/plugins` |
| hooks.doctor | hook 开了吗、hook 状态 | are hooks enabled, hook status | `/doctor hooks` |
| session.resume | 恢复会话、继续上次 | resume session, continue last session | `/resume` |
| session.branch | 创建分支会话、开个分支试试 | create branch session, branch this conversation | `/branch` |

第一批成品级手感验收还必须覆盖以下反例，避免把状态查询误当成用法帮助：

| 用户说法 | 必须识别为 | 期望行为 |
| --- | --- | --- |
| 现在是什么模型、你现在用的哪个模型 | `model.status` + `status_query` | 返回当前 provider/model、角色路由短摘要和可选 doctor 提示；不得只返回 `/model route` 用法。 |
| 模型 key 配好了吗、模型配置正常吗 | `model.doctor` + `doctor_query` | 返回 provider/baseUrl/apiKey/model 的诊断摘要和环境变量修复建议；不得泄露 API key。 |
| `/model` 怎么用、模型命令有什么风险 | `model.*` + `usage_help` | 解释 `/model`、`/model route`、`/model route doctor`、`/model route set` 的用途和风险边界。 |
| 自动记忆是否打开、现在记住了什么 | `memory.status` + `status_query` | 返回 `autoAccept`、candidate 数、accepted 数和 `LINGHUN.md` 状态；不得让模型泛泛自称没有记忆。 |
| 索引好了没、当前索引状态 | `index.status` + `status_query` | 返回本地 index 状态、changedFiles/staleHint 和下一步建议；不得自动 refresh。 |
| 帮我建立索引、初始化索引 | `index.init` + `safe_action_request` | 进入 Start Gate，并保留大文件安全门；不得直接执行。 |
| 直接开启 bypass、直接 npm install、接受所有记忆 | 对应能力 + `dangerous_action_request` | 阻断或进入权限管道，显示风险、scope、reason 和恢复方式。 |

禁止：

- 不允许把自然语言“帮我改/写/运行/安装”直接映射到 `/write`、`/edit`、`/multiedit`、`/bash` 或依赖安装。
- 不允许自然语言直接开启 `bypass`、写权限规则、接受长期记忆、启用第三方 plugin/skill、强制刷新索引或执行 hook/job/remote。
- 不允许模型自行宣称“记忆已开启”“索引 ready”“缓存命中率”等状态；这些必须来自 RuntimeStatus 或本地命令结果。
- 不允许为了让模型更聪明而把完整 memory、完整 transcript、大索引结果、大日志塞入 prompt。
- 不允许只用少量硬编码中文/英文关键词冒充语义识别；至少要通过 capability catalog、别名、描述、when-to-use 和参数 parser 共同判断。
- 不允许新增命令后没有自然语言用途/风险说明；这必须在 test/check 中失败。

验收：

- `CommandCapability` 覆盖率测试必须确保所有用户可见 slash 命令都有能力记录；隐藏或内部命令必须显式标记原因。
- 自然语言 router 测试必须覆盖每个第一批能力的中文问句、中文祈使句、英文问句、英文祈使句和用途/风险询问。
- 风险一致性测试必须覆盖同一意图的中文/英文/同义表达映射到同一 risk handler。
- 低置信度测试必须覆盖相似命令、拼写错误、缺少参数、多个候选，结果只能追问或列候选。
- 负向安全测试必须覆盖 write/edit/bash/install/bypass/permissions/memory accept/plugin enable/index force/hook/job/remote 等自然语言请求不会直通。
- RuntimeStatus 测试必须确保 memory/index/cache/model/mode/extensions 来源真实、字段短小、不会包含完整 memory/transcript/index/log。
- 用户输入“自动记忆功能是否打开”时，回答必须包含当前 `autoAccept`、candidate 数、accepted 数和 `LINGHUN.md` 状态。
- 用户输入 “is memory enabled?” 时必须得到同等英文或当前语言下的本地状态回答。
- 用户输入“帮我建立索引”时，必须进入 Start Gate，并保留大文件安全门。
- 用户输入 “build the index” 时必须进入同等 Start Gate。
- 用户输入“缓存命中怎么样”时，必须读取 `/cache status` 的真实公式和来源，不得自行估算。
- 用户输入“你是什么模型”时，必须基于当前 provider/model 状态回答，而不是只复述 system prompt 身份。
- 用户询问任意 slash 命令“这个能做什么/风险是什么”时，必须基于 `CommandCapability` 回答。
- 未命中意图的普通问题仍能走模型对话，并且模型能看到短 RuntimeStatus。

## 6. TUI 规格

### 6.1 布局

```text
┌──────────────── messages ────────────────┐
│ user / assistant / tool / agent messages │
├──────────────── input ───────────────────┤
│ > 输入框                                 │
├──────────────── status ──────────────────┤
│ project · model · mode · cache · index   │
└──────────────── hints ───────────────────┘
```

### 6.2 状态栏字段

| 字段 | 来源 |
| --- | --- |
| project | Session.projectName |
| model | ModelGateway.currentModel |
| mode | PermissionMode |
| cache | CacheSummary.hitRate |
| index | IndexHealth.status |
| agents | AgentManager.runningCount |
| job | JobManager.currentJob 可选 |

示例：

```text
main · DeepSeek V4 Pro · strict · cache 94% · index ready · 1 agent
```

状态栏要求：

- 默认不显示金额，避免多模型、多 provider 和第三方中转价格不准造成误导。
- 费用、节省金额和账单对账只在 `/usage`、`/stats` 或详情面板中显示。
- 费用必须标记 `estimated`，除非 provider 明确返回可直接计费的真实账单字段。
- 状态栏轻提示只显示建议命令，不自动执行。

### 6.3 TUI 渲染稳定性规格

Phase 07 开始，TUI 必须建立稳定渲染模型：

- 渲染区域必须分层：`messages`、`background summary`、`system events`、`input`、`status`、`hints`。
- 主消息流不得直接混入后台任务长输出、compact 进度、agent 原始日志或 verification 原始日志。
- 输入区必须由单一组件或单一渲染路径控制，不允许系统事件插入输入框内部，不允许出现多个 prompt 光标残留。
- 后台任务、agent、verification、compact 默认只显示一行摘要；详情通过 `/background`、任务详情或展开操作查看。
- 状态栏字段必须短、稳定、可截断；宽度不足时按优先级降级显示，不允许撑爆终端宽度。
- ANSI 样式必须在宽度计算前剥离或正确处理；中文、全角字符和 emoji 宽度必须按终端显示宽度计算。
- Windows Terminal resize、长中文路径、多行粘贴、连续工具输出必须有回归测试。
- 工具、agent、provider、background task 不得直接写 UI stdout；必须产生结构化事件，由 TUI 统一消费。
- 长输出必须截断展示并保存完整日志路径。
- 轻提示只能进入 `hints` 或 `system events` 区域，不得打断当前输入。
- 渲染失败必须降级为普通文本日志，不得导致主进程崩溃。
- 复查、验证、compact、agent 等长任务不能只显示“still running”；必须显示当前步骤、进度、耗时、预计范围、日志路径和可用操作。

推荐显示优先级：

1. 当前输入和正在执行的关键确认。
2. 当前任务/工具的一行状态。
3. 状态栏短字段。
4. 轻提示。
5. 可展开后台详情。

渲染回归至少覆盖：

- 连续 20 轮普通对话。
- 连续 10 个工具事件。
- 一个后台任务运行并刷新状态。
- 一个 verifier/verification 任务运行、heartbeat、完成结果上报。
- 一个 compact/system event 插入。
- 中文路径和全角文本。
- 多行粘贴。
- 终端宽度变窄。
- 长状态栏字段截断。

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

### 7.0 Provider adapter 成品级验收

每个 provider adapter 不只负责“能发请求”，还必须完成能力、usage、错误和诊断闭环。新增或增强 provider 时必须至少交付：

- request / response 到 `LinghunEvent` 的稳定转换，业务层不得依赖 provider 原始事件。
- streaming 文本输出；不支持 streaming 的 provider 必须明确降级为非流式，并在 doctor 中说明。
- tool calling 能力声明和格式适配；不支持工具调用时，`supportsTools=false`，不得假装可用。
- usage 字段映射：input、output、total、rawUsage、provider/model/endpoint。
- prompt cache 字段映射：cache read、cache write/create、字段来源 `reported` / `zero_reported` / `missing` / `estimated`。
- `listModels()` 或等价静态 model metadata，至少包含 context window、max output、tools、vision、thinking、prompt cache 和价格字段。
- capability table 接入 `/model route doctor`，能解释能力不足、fallback 不可用、价格/上下文缺失。
- provider 错误归一化为 `LinghunError`，错误信息必须中文可读并给修复建议。
- 配置诊断：base_url、api_key、model、endpoint、headers、timeout、代理/中转站兼容风险。
- quota / balance query 可选支持；不支持时标记 `unknown`，不得用本地估算冒充真实余额。
- focused tests：正常流式、非流式降级、错误归一化、usage 映射、cache 字段映射、capability doctor、Windows 环境变量和 base_url 配置。

阶段边界：

- Phase 03 只要求 DeepSeek / OpenAI-compatible 最小 adapter 闭环。
- Phase 13 只要求 role route、capability doctor 和 role usage 对接现有 provider 能力。
- Phase 15 才做真实项目 provider usage、账单和 quota/balance 抽样对账；硬验收是来源、公式、endpoint 拆分、诊断和对账完整，不要求每个 provider、每个项目都达到固定命中率。
- 后续新增 Claude / Gemini / Ollama / OpenRouter / Grok / Azure / Bedrock / Vertex adapter 时，必须按本清单验收。

### 7.1 多模型路由规格

```ts
export type ModelRole =
  | 'planner'
  | 'executor'
  | 'reviewer'
  | 'verifier'
  | 'summarizer'
  | 'vision'
  | 'image'

export type RoleModelRoute = {
  role: ModelRole
  primaryModel: string
  fallbackModels: string[]
  requiredCapabilities?: ModelCapability[]
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

export type RoleRouteDecision = {
  id: string
  role: ModelRole
  taskId: string
  reason: string
  selectedModel: string
  selectedProvider: string
  fallbackModels: string[]
  requiredCapabilities: ModelCapability[]
  budget: {
    maxInputTokens?: number
    maxOutputTokens?: number
    maxCostCny?: number
  }
  stopConditions: string[]
  createdAt: string
}

export type VisionObservation = {
  id: string
  source: 'image' | 'screenshot' | 'design' | 'browser-capture'
  model: string
  provider: string
  summary: string
  extractedText: string[]
  uiRegions: string[]
  suspectedFiles: string[]
  confidence: number
  evidenceRefs: EvidenceRef[]
  createdAt: string
}

export type ImageProviderKind =
  | 'openai-images'
  | 'openai-responses'
  | 'openai-compatible-images'
  | 'openai-compatible-responses'
  | 'custom-http'
  | 'local'

export type ImagePromptPolicy = {
  mode: 'raw' | 'light-enhance' | 'project-style'
  maxPromptChars: number
  preserveUserPrompt: boolean
}

export type ImageGenerationRequest = {
  prompt: string
  size?: string
  quality?: string
  outputFormat?: 'png' | 'jpg' | 'webp' | string
  background?: 'transparent' | 'opaque' | 'auto'
  count?: number
  referenceImages?: string[]
  maskImage?: string
  outputDir: string
  fileNameHint?: string
  promptPolicy: ImagePromptPolicy
}

export type ImageGenerationResult = {
  id: string
  provider: string
  model: string
  images: Array<{
    path: string
    mimeType: string
    revisedPrompt?: string
    seed?: number
  }>
  usage?: CostSummary
  evidenceRefs: EvidenceRef[]
  createdAt: string
}
```

默认角色约束：

- `planner`：只规划，输出 `PlanProposal`，不允许写入。
- `executor`：执行已批准计划或用户明确任务，可写入但必须走权限。
- `reviewer`：只读审查，基于 diff、证据和关键文件给风险。
- `verifier`：只读复核，可运行验证命令。
- `summarizer`：低成本摘要，不允许写入。
- `vision`：处理图片/截图/OCR/UI 视觉理解，只输出 `VisionObservation` 和 evidence，不允许写文件或执行 Bash。
- `image`：异步生图/改图，只生成或编辑图片资产，默认不改代码、不覆盖原图。

路由规则：

- 优先按用户显式指定模型。
- 其次按 role-to-model 配置。
- 再按模型能力表选择支持工具、视觉、thinking、上下文、缓存的模型。
- 模型不可用、能力不足、超预算时使用 fallback。
- fallback 仍失败时暂停，提示用户选择模型或降低任务范围。
- 不允许为了多模型协作把完整 transcript 无差别发送给每个模型。
- 角色交接只传 `RoleHandoff`、必要文件片段和证据引用。
- 每次自动或半自动路由必须记录 `RoleRouteDecision`，用于 `/model route doctor`、`/stats` 和 transcript evidence。
- `RoleHandoff.summary` 必须是短摘要；`evidence` 必须引用 transcript、文件、diff、验证报告或 vision/image evidence，不允许把原始长聊天、完整索引、大日志塞入 handoff。
- 每个角色的 usage、cache、cost 必须单独统计。
- 每个角色的耗时、token、费用、是否命中 fallback、是否超预算停止，都必须进入 role usage summary。
- 当前主模式或 executor 不支持图片时，不永久切换主模型；只临时调用 `vision` provider，把图片理解结果结构化为 `VisionObservation` / evidence，再交回当前 executor。
- `vision` provider 只能接收图片、必要用户问题和最小项目上下文；不得接收完整 transcript、完整 diff 或无关源码。
- 同一图片或截图的 `VisionObservation` 可复用；后续步骤优先引用 evidence id，避免重复调用多模态模型。
- 如果没有配置 vision provider，遇到图片输入时必须提示配置或切换支持视觉的模型，不能声称已经看懂图片。
- image provider 必须支持异步后台任务语义；生图可能排队或耗时，TUI 只显示任务摘要、耗时、保存路径和日志路径。
- image provider 默认走极简请求：只传 `model`、用户 prompt 和必要输出目录；不固定 size/quality/format/background，用户明确指定或项目资产场景需要时才传。
- image prompt 默认使用 `light-enhance`：保留用户原始需求，只补尺寸、透明背景、无文字、资产用途等必要工程约束；不得生成大段提示词。
- image provider 不接收完整项目代码，只接收生图需求、必要风格/尺寸约束和可选参考图。
- image 结果必须保存到本地资产目录，写入 transcript/evidence；不得默认覆盖原图。
- 支持 OpenAI Images / Responses、OpenAI-compatible Images / Responses、custom-http 和 local adapter，兼容国内第三方 image2 中转接口。

命令：

```text
/model route
/model route doctor
/model route set planner gpt-5.5
/model route set executor deepseek-v4-pro
/model route set reviewer claude
/model route set vision qwen-vl
/model route set image gpt-image-2
```

`/model route doctor` 必须检查：

- 每个角色是否有可用 primary model。
- fallback 是否可用。
- 角色模型是否满足能力要求。
- 价格和上下文信息是否完整。
- 是否存在会导致高成本的配置。
- 最近 `RoleRouteDecision` 是否存在能力不匹配、预算缺失、fallback 不可用或跨角色写入权限过宽。
- vision route 是否具备图片输入/OCR/UI 理解能力。
- executor 缺少视觉能力时，是否存在可用 vision provider 作为临时能力补充。
- image route 是否支持 generate/edit、返回 b64_json 或 URL、是否能落盘保存。

image provider 命令方向：

```text
/image provider list
/image provider set <id>
/image provider doctor
/image generate <prompt>
/image edit <path> <prompt>
/image variants <path> --count <n>
```

默认体验：

- `/image generate "金色按钮背景"` 不传固定尺寸，优先使用 provider/model 默认能力。
- 用户指定 `--size`、`--quality`、`--format`、`--transparent` 时才传对应参数。
- 生成前显示模型、数量、保存路径和是否覆盖；默认生成新文件。
- provider 返回 `usage` 时记录真实 usage；没有价格或账单字段时标记 `unknown` / `estimated`，不得瞎算费用。

## 8. Tool 规格

### 8.0 任务启动确认 / Start Gate

```ts
export type StartGateDecision =
  | { status: 'discussion_only'; reason: string }
  | { status: 'needs_confirmation'; taskSummary: string; risk: 'low' | 'medium' | 'high' }
  | { status: 'confirmed'; taskSummary: string }
```

要求：

- 用户只是咨询、评估、提想法、问“要不要做”、要求设计方案时，默认 `discussion_only` 或 `needs_confirmation`。
- 进入写文件、多文件修改、阶段开发、agent、job、workflow、联网安装、依赖变更、构建发布、数据迁移前必须确认。
- 只读定位、少量文件读取、`rg`、`git status`、解释报错可以不弹确认，但必须保持范围收敛。
- Start Gate 不替代权限审批；确认开始任务后，具体工具仍走权限管道。
- TUI 确认文案必须轻量：`开始` / `先不要，只继续讨论`。

示例：

```text
我理解这是一个新增任务。是否现在开始执行？
1. 开始
2. 先不要，只继续讨论
```

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

Verifier / verification 运行状态必须复用 `BackgroundTask`：

- 启动后立即显示摘要：验证目标、验证命令数量、预计耗时范围、日志入口。
- 每个验证步骤更新 `currentStep` 和 `progress`，例如 `typecheck 2/5`。
- 长时间无输出时主动 heartbeat，不需要用户追问。
- 输出文件为空时显示“复查尚未产生有效输出”，不得误报 PASS / FAIL。
- 完成后统一给出 `pass` / `fail` / `partial`：
  - `pass`：验证命令通过，复查未发现阻塞问题。
  - `fail`：验证失败或发现必须修复的问题。
  - `partial`：本地验证通过但关键外部条件缺失，或只完成部分检查。
- runner 必须区分被验证命令失败和验证器自身异常。若日志显示测试/构建步骤已经全部通过，但 Node、Vitest、pnpm 或子进程清理阶段抛出 runner error，应记录为 `partial` 或 `runner_error` 风险，不得误写成代码测试失败。
- Node 24 等新版本工具链出现 `emitter.removeListener is not a function`、退出阶段异常或生命周期异常时，报告必须保留原始日志路径、Node 版本、命令和建议动作，例如用 Node 22 LTS 复核。
- verifier 未完成时，主会话只能说“等待复查结果”，不能宣布阶段完成。
- `/background` 和 `/verify last` 必须能看到最近一次 verifier 的命令、状态、日志、结果和下一步建议。

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
  retrievedAt?: string
  freshness?: 'current' | 'possibly_stale' | 'stale' | 'unknown'
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

### 11.2.1 Web Evidence / Freshness Gate

实时信息、第三方公开项目、provider 文档、模型价格、API 规则、开源 release、法律/安全更新和社区现状必须走 Freshness Gate。目标是允许联网取证，但禁止在未联网或本地证据过期时虚构“最新”结论。

```ts
export type FreshnessSensitiveTopic =
  | 'latest_release'
  | 'provider_docs'
  | 'model_pricing'
  | 'quota_policy'
  | 'api_behavior'
  | 'security_advisory'
  | 'legal_or_policy'
  | 'community_project_status'

export type WebEvidenceDecision =
  | { type: 'local_evidence_sufficient'; reason: string }
  | { type: 'require_web_permission'; reason: string; preferredSources: string[] }
  | { type: 'web_evidence_allowed'; preferredSources: string[] }
  | { type: 'web_unavailable'; reason: string; fallback: 'answer_with_disclaimer' | 'ask_user' | 'stop' }
```

规则：

- 用户问“最新、现在、当前外面、社区有没有、价格、版本、官方文档、release、API 是否支持”等问题时，默认判定为 freshness-sensitive。
- 本地索引、旧交付文档、旧审计报告和模型记忆只能作为背景，不能支撑“最新”断言。
- 未授权联网时，必须提示“这属于实时信息，本地证据可能过期，需要联网查询公开来源，是否继续？”并说明将优先查询哪些来源。
- 已授权联网时，优先官方/项目源：official docs、release notes、GitHub repo、provider docs、标准文档；其次才是社区文章或二手资料。
- 联网结果必须写入 `EvidenceRecord(kind='web_source')`，包含摘要、URL/source、`retrievedAt`、freshness 状态和支持的 claims。
- 最终回答必须给来源链接、查询时间和保守结论；不得把搜索摘要包装成确定事实。
- 联网失败、权限拒绝、来源冲突、页面不可访问或结果不可信时，必须降级：说明本地证据不足、联网失败/未授权、可执行下一步；不得卡死或编造。
- Web evidence 不得把完整网页、完整 PDF、完整 release 列表或大结果塞进 prompt；只注入短摘要、链接和必要证据 id。
- 插件、workflow、hook、agent、remote channel 触发联网仍必须走 Start Gate 或权限管道；Web Evidence 不能绕过工具权限。

示例：

```text
用户问：OpenCode 最新版本改了什么？
Linghun：这属于实时信息，本地索引可能过期。需要联网查询官方 release / repo，是否继续？
```

已授权联网后：

```text
已查询官方 release / repo。结论：...
来源：...
查询时间：...
```

联网不可用时：

```text
本地资料不足以确认最新版本；当前未联网/联网失败。可以先基于本地文档讨论已知设计，或授权联网后再核验。
```

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
- 没联网或没有新鲜 web evidence 就声称最新版本、最新规则、当前价格、当前 API 支持状态或社区现状。
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
  cacheWriteTokensSource: 'reported' | 'zero_reported' | 'missing' | 'estimated'
  inputTokens: number
  outputTokens: number
  model: string
  provider: string
  endpoint?: string
  source: 'api_usage' | 'provider_usage' | 'estimated'
  compacted: boolean
  freshness: CacheFreshness
  rawUsage?: unknown
}

export type CacheFreshness = {
  systemPromptHash: string
  toolSchemaHash: string
  mcpToolListHash: string
  modelProviderHash: string
  reasoningEffortHash?: string
  projectRulesHash?: string
  memoryHash?: string
  compactHash?: string
  pluginListHash?: string
  changedKeys: string[]
}

export type CacheHistoryConfig = {
  maxTurns: number
  warnBelowHitRate: number
  persistPath: string
}

export type LightHint = {
  id: string
  severity: 'info' | 'warning'
  message: string
  suggestedCommand: string
  dedupeKey: string
  cooldownMs: number
}
```

要求：

- 最近 20 轮环形缓冲，默认 `maxTurns=20`。
- `maxTurns` 可通过配置或 `/cache-log config size <n>` 修改，超过上限自动淘汰旧记录。
- `/cache-log` 可查看。
- 低于阈值使用 CCB 风格轻提示，不弹窗打断。
- cache break 必须记录原因。
- 命中率优先基于 provider/API 返回的真实 usage 字段计算。
- 如果 provider 不返回 cache read/write usage，`source` 必须标记为 `estimated`，UI 必须显示“不支持真实缓存统计”。
- GPT-5.5 等模型的高命中率只能记录为特定 provider + 工作流实测结果，不能写成模型天然保证。
- `cache_creation_tokens=0` 或 cache write 为 0 时，必须区分 provider 明确返回 0、字段缺失和估算值；不得宣传为“零写入成本”。
- 缓存是否新鲜必须根据 `CacheFreshness` 的 hash 变化判断，不得根据 cache write/create token 是否为 0 判断。
- 当 system prompt、tool schema、MCP 工具列表、model/provider、project rules、memory、compact 或 plugin list hash 变化时，`/break-cache status` 必须显示变化项，并建议 `/cache warmup` 或 `/cache refresh`。
- `/cache warmup` / `/cache refresh` 是用户可控最小请求，只能声明“已尝试刷新/预热”，不得保证 provider 一定写入缓存。
- `/cache-log` 必须显示每轮 input/output/cache read/cache write tokens、model、provider、compact 状态。
- `/cache-log` 必须显示 endpoint 与 cache write source。
- 支持导出最近 20 轮缓存日志，用于和账号账单交叉验证。
- cache break 诊断必须覆盖 system prompt、tool schema、MCP tool list、model changed、compact、memory changed。
- cache 诊断必须按 endpoint 分组展示命中率，避免把 `/v1/messages`、`/v1/responses`、`/v1/chat/completions` 的行为混成一个结论。
- 轻提示必须本地规则触发，不额外调用模型。
- 轻提示必须限频、可关闭、可静默。
- 轻提示只建议命令，不替用户执行。
- 对外数据展示必须标注样本来源、provider、模型、endpoint、时间范围和计算公式；不得承诺任意模型都能稳定 98% 或固定 25 倍省钱。

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
  billingReconciled?: boolean
  billingSource?: string
  endpoint?: string
  providerReported?: boolean
}

export type BudgetSource =
  | 'local_limit'
  | 'provider_usage'
  | 'provider_quota'
  | 'billing_reconciled'

export type ProviderQuotaSource =
  | 'official_reported'
  | 'oauth_reported'
  | 'template_reported'
  | 'custom_script'
  | 'estimated'
  | 'unknown'

export type ProviderQuotaQuery = {
  providerId: string
  enabled: boolean
  source: ProviderQuotaSource
  refreshIntervalMinutes: number
  template?: 'claude_official' | 'codex_official' | 'gemini_official' | 'github_copilot' | 'deepseek_balance' | 'openrouter_balance' | 'new_api_quota' | string
  endpoint?: string
  method?: 'GET' | 'POST'
  headersEnv?: string[]
  extractor?: string
}

export type ProviderQuotaSnapshot = {
  providerId: string
  source: ProviderQuotaSource
  fetchedAt: string
  planName?: string
  remaining?: number
  used?: number
  total?: number
  unit: 'tokens' | 'credits' | 'cny' | 'usd' | 'requests' | 'interactions' | 'unknown'
  resetAt?: string
  warning?: string
}
```

要求：

- Cost 默认不进入状态栏。
- `/usage` 展示原始 token/cache usage。
- `/stats` 展示综合统计、耗时、模型和可选费用估算。
- 金额必须标记 `estimated`，不得伪装成真实账单。
- Phase 15 可加入可选 provider quota / balance 查询，但必须和 `provider_usage`、本地预算和账单对账分开展示。
- `ProviderQuotaQuery` 默认关闭或低频刷新；用户必须能手动刷新、关闭或删除查询配置。
- 官方订阅类 quota 只有在来源明确时才能标记为 `official_reported` 或 `oauth_reported`；第三方中转站、New API、私有服务必须使用 `template_reported` 或 `custom_script`。
- quota 查询可能消耗少量 API 请求额度，UI 必须提示刷新间隔和最近查询时间。
- quota 查询结果不得写入状态栏；只进入 `/usage`、`/stats`、`/stats providers` 或等价详情视图。
- 不同 provider 的单位必须保留原语义，例如 tokens、credits、CNY、USD、requests、interactions，不得混成一个统一余额。
- 查询失败时标记 `unknown` 并保留最近成功快照；不得用本地估算冒充 provider 余额。

### 12.1 缓存命中率计算口径

```ts
export type CacheUsageRaw = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  provider: string
  model: string
}

export function computePromptCacheHitRate(usage: CacheUsageRaw): number | null
```

计算规则：

```text
denominator = inputTokens + cacheWriteTokens + cacheReadTokens
hitRate = cacheReadTokens / denominator
```

要求：

- `denominator <= 0` 时返回 `null`。
- 命中率展示为 0-100 的百分比。
- 不把 output tokens 放入命中率分母。
- cache write/create 字段按 provider 适配到统一 `cacheWriteTokens`。
- 任何“省钱比例”必须和输出 tokens、cache write 成本、模型单价分开说明。
- 账单对账只能作为验证来源，不得覆盖原始 usage 记录。
- Phase 15 真实项目测试中的 92% - 96% 命中率是目标观察区间，不是任意模型/项目/provider 的硬承诺；未达到目标时必须输出 provider、模型、endpoint、样本数、cache 字段来源和 break-cache 原因。

### 12.2 公开数据口径

允许写：

- “在特定大型项目、特定 provider、中转站 GPT-5.5、稳定 CCB Dev Boost 工作流下，CSV usage 与账单页对账显示 prompt cache 命中率约 96%。”
- “Linghun 的目标是通过稳定 system prompt、tool schema、MCP 列表、索引和 handoff 提高可复现命中率。”

禁止写：

- “所有模型都能稳定 96%/98%。”
- “固定节省 25 倍。”
- “cache_creation_tokens=0 等于零写入成本。”
- “某个模型天然保证高命中。”

真实样本展示必须同时给出：

- 时间范围。
- provider / model / endpoint。
- 请求数。
- input / output / cache read / cache write tokens。
- 公式：`cacheRead / (input + cacheWrite + cacheRead)`。
- 是否有账单页或 provider usage 对账。

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
- `/index status` 优先调用 `codebase-memory-mcp cli detect_changes` 做 stale 检测；可用且发现变更时显示 `stale` / changedFiles / stale hint。
- `detect_changes` 不可用时必须清晰降级，不影响 `/index status` 基于 `index_status` 展示基本状态。
- 大文件扫描必须在 `/index init fast` 和 `/index refresh` 前执行。
- 风险文件包括未排除的大 JSON、SQL、XML、min.js，以及常见生成物/资源目录中的大文件。
- `.linghunignore` 与 `.cbmignore` 兼容。
- 大文件安全门发现风险时默认阻止索引，并提示用户加入 `.linghunignore` 或 `.cbmignore`。
- 用户显式执行 `/index init fast --force` 或 `/index refresh --force` 时才允许继续。
- 变更超过阈值或 `detect_changes` 发现明显变更时提示刷新。
- 不自动强制重建。
- break-cache 深度诊断（last break 前后 cache read、工具增删、diff 路径等）记录为后续增强，不作为 Phase 10 hardening 实现范围。

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

export type MemoryLearningPolicy = {
  enabled: boolean
  autoAccept: boolean
  triggerOn: Array<'task_completed' | 'verification_passed' | 'workflow_finished' | 'phase_delivery' | 'manual'>
  summarizerRole: 'summarizer'
  maxCandidateChars: number
  maxInjectedItems: number
  maxInjectedCharsPerItem: number
  maxSummarizerInputTokens: number
  maxSummarizerOutputTokens: number
}

export type MemoryStats = {
  candidates: number
  accepted: number
  disabled: number
  injectedItems: number
  estimatedInjectedTokens: number
  autoAcceptEnabled: boolean
  lastLearningRunAt?: string
}

export type HandoffPacket = {
  id: string
  sessionId: string
  parentSessionId?: string
  projectPath: string
  phase?: string
  nextPhase?: string
  objective: string
  completed: string[]
  pending: string[]
  mustNotDo: string[]
  todoIds: string[]
  keyFiles: string[]
  changedFiles: string[]
  evidenceRefs: string[]
  verification: VerificationReport[]
  risks: string[]
  indexStatus: IndexHealth
  permissionMode: PermissionMode
  model: string
  provider: string
  lastCommit?: string
  budgetUsed?: CostSummary
  generatedBy: 'manual' | 'phase-delivery' | 'job' | 'resume' | 'branch' | 'agent'
  createdAt: string
}
```

要求：

- 长期记忆写入前默认确认。
- 可查看、编辑、删除、禁用。
- 不存大段原始对话。
- 不让错误记忆不可逆。
- 默认不每轮学习；只有 `MemoryLearningPolicy.triggerOn` 中允许的收尾事件才可生成候选记忆或候选 Skill。
- 普通聊天、`/btw`、失败的中间尝试和未经验证的猜测不得自动进入长期记忆候选。
- 候选提取优先基于结构化 evidence、Todo、验证报告、handoff packet 和用户确认内容；需要模型总结时必须使用 `summarizer` role，并受 `maxSummarizerInputTokens` / `maxSummarizerOutputTokens` 限制。
- `autoAccept=false` 为默认；开启自动接受必须由用户明确配置，并可在 `/memory` 或 `/memory stats` 中看到状态。
- prompt 注入默认只取相关 top-k 记忆摘要，受 `maxInjectedItems` 和 `maxInjectedCharsPerItem` 限制。
- `memoryHash` 只能基于稳定摘要、scope、status 和排序后的 id 计算；不得包含访问次数、最近查看时间、随机顺序或运行时日志。
- 记忆、候选 Skill 和注入摘要必须稳定排序，避免无意义破坏 prompt cache。
- `/memory stats` 必须展示 `MemoryStats`，包括候选数、已接受数、禁用数、本轮注入条数和估算 token。
- 项目级记忆默认写入 `<project>/.linghun/memory/`。
- 用户级记忆默认写入 `~/.linghun/data/memory/`，但必须可通过 `LINGHUN_DATA_DIR` 或 `storage.memory.user` 配置到其他磁盘。
- 会话级临时记忆默认跟随 session 存储位置。
- 记忆写入前必须明确 scope 和 storagePath。
- `/memory storage` 必须能解释每类记忆当前写在哪里。
- 迁移项目时，项目级记忆必须能随项目目录一起迁移。
- `LINGHUN.md` 只保存长期稳定事实、工程规则、常用命令和禁止事项。
- `/memory init` 生成的默认 `LINGHUN.md` 应使用中文友好的“项目规则”模板，覆盖用途、写入/不写入边界、事实优先、Start Gate/权限审批、候选记忆确认、最小验证、上下文裁剪、clean rewrite 和中英文可读性；模板必须短小，避免增加不必要 token 负担。
- Linghun 产品运行时的项目规则主入口是项目根目录 `LINGHUN.md`；`AGENTS.md` / `CLAUDE.md` 仅作为兼容导入或迁移来源，不能覆盖用户明确维护的 `LINGHUN.md`。
- 临时想法、阶段进度、短期计划必须写入 `HandoffPacket`，不得无限追加到 `LINGHUN.md`。
- `HandoffPacket` 是新会话、自动任务、`/resume`、`/branch` 和 `/fork` 的结构化交接契约，不是自由文本摘要。
- `HandoffPacket` 必须至少包含当前阶段、下一阶段、已完成、待处理、禁止事项、Todo、关键文件、变更文件、证据引用、验证结果、风险、索引状态、权限模式、模型/provider、最近提交和预算使用情况。
- `evidenceRefs` 必须引用 transcript 事件、文件路径、验证报告、索引查询或命令输出摘要；不得用“感觉已经看过”作为证据。
- `mustNotDo` 必须写明下一会话禁止越界的内容，例如“不要进入下一阶段”“不要复制完整历史”“不要执行高风险 Bash”。
- 新会话启动时必须先校验 `HandoffPacket` 是否完整；关键字段缺失时降级为只读恢复，并提示用户补齐或重新生成 handoff。
- 首次进入项目缺少 `LINGHUN.md` 时，用轻提示建议 `/init linghun-md`。
- AI 更新 `LINGHUN.md` 默认需要用户确认。
- 新会话启动上下文必须优先使用 `LINGHUN.md`、最近 `HandoffPacket`、Todo、验证结果和索引状态，禁止直接塞完整历史聊天。
- `/resume` 只注入必要摘要、证据和关键文件列表。
- `/branch` 创建独立分支会话并记录父会话 id。
- `/fork` 派生子会话或 agent 时，只传任务摘要、证据、必要文件列表和权限范围。

## 16. Agent 规格

```ts
export type AgentRun = {
  id: string
  type: 'explorer' | 'worker' | 'verifier' | 'planner'
  parentSessionId?: string
  forkedFrom?: string
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
- `/fork` 必须记录父会话和派生原因。
- `/fork` 不允许复制完整历史，只允许结构化 handoff、证据、必要文件列表和权限范围。

## 17. Jobs 长期托管规格

默认 feature 关闭。

```ts
export type JobDefinition = {
  id: string
  name: string
  projectPath: string
  prompt: string
  targetPhase?: string
  schedule: string
  enabled: boolean
  maxRuntimeMinutes: number
  maxTokens: number
  maxCostCny: number
  allowEdits: boolean
  allowBash: boolean
  allowAgents: boolean
  requirePlanBeforeWrite: boolean
  continuousPhases: boolean
  remoteChannels?: string[]
}

export type JobTaskGraph = {
  jobId: string
  objective: string
  targetPhase?: string
  nodes: Array<{
    id: string
    title: string
    status: 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled'
    assignedAgentId?: string
    dependsOn: string[]
    acceptance: string[]
  }>
  budget: {
    maxRuntimeMinutes: number
    maxTokens: number
    maxCostCny: number
  }
  stopConditions: string[]
}

export type AgentAssignment = {
  jobId: string
  agentId: string
  role: 'explorer' | 'worker' | 'verifier' | 'planner'
  model: string
  permissionMode: PermissionMode
  allowedTools: string[]
  inputSummary: string
  expectedOutput: string
  budget: {
    maxTokens?: number
    maxCostCny?: number
    maxRuntimeMinutes?: number
  }
}

export type JobReport = {
  jobId: string
  taskGraph: JobTaskGraph
  handoffId: string
  sessionId: string
  assignments: AgentAssignment[]
  acceptedResults: string[]
  rejectedResults: string[]
  verification: VerificationReport[]
  budgetUsed: CostSummary
  pauseReason?: string
  nextAction: string
}
```

要求：

- 每次 job 创建独立 session。
- 每次 job 必须创建 `HandoffPacket`，用于新会话接续。
- 每次 job 必须创建 `JobTaskGraph`，记录目标、阶段、子任务、依赖、agent 分工、验收标准、预算和停止条件。
- 默认一次只推进一个阶段；`continuousPhases=false`。
- 连续阶段模式必须由用户明确开启，每阶段之间仍必须有交付文档、验证结果和确认点。
- 自动新会话只能读取 `LINGHUN.md`、阶段状态、最近 handoff、Todo、验证结果和索引状态。
- 禁止把完整历史聊天直接塞入 job 新会话。
- job 创建自动新会话前必须校验 `HandoffPacket` 的 `nextPhase`、`mustNotDo`、`permissionMode`、`verification`、`evidenceRefs`、`indexStatus` 和 `budgetUsed`。
- 如果 `HandoffPacket` 缺少验证结果、证据引用或禁止事项，job 必须暂停并生成修复建议，不能继续自动执行。
- job 报告必须记录本次读取的 handoff id、新建 session id、模型/provider、预算使用、验证结果和下一步建议，方便用户审计。
- job 报告必须记录 `AgentAssignment`、每个 agent 的输入摘要、输出摘要、证据引用、验证结果和最终是否采纳。
- team mode 只能进入 `/background`、`/agents`、`/job report` 的状态表和结构化报告；原始 agent 长输出只能写日志路径，不得混入主消息流。
- 超预算停止。
- 高风险暂停。
- 生成报告。
- 可手动 run-now。
- 可 pause/resume。
- `/job report` 必须能显示任务图、agent 分工、预算使用、验证结果、被采纳结论和暂停原因。

Remote Channel：

```ts
export type RemoteChannelConfig = {
  id: string
  type: 'wechat' | 'feishu' | 'lark' | 'wecom' | 'qq' | 'dingtalk' | 'telegram' | 'discord' | 'webhook'
  adapter: 'official_cli' | 'webhook' | 'custom'
  enabled: boolean
  boundUserIds: string[]
  boundDeviceIds: string[]
  allowedCommands: string[]
  requireApprovalFor: PermissionMode[]
  summaryOnly: boolean
  signingSecretRef?: string
  maxMessageAgeSeconds: number
  auditLogPath: string
}

export type RemoteCliAdapterConfig = {
  channelId: string
  provider: 'feishu' | 'lark' | 'dingtalk' | 'wecom'
  command: string
  args: string[]
  versionCommand?: string
  authCheckCommand?: string
  supportsJsonOutput: boolean
  minVersion?: string
  enabled: boolean
}

export type RemoteCommandMessage = {
  id: string
  channelId: string
  userId: string
  deviceId?: string
  command: string
  payloadSummary: string
  nonce: string
  createdAt: string
  expiresAt: string
  signature?: string
}

export type RemoteApprovalRecord = {
  id: string
  channelId: string
  messageId: string
  userId: string
  action: 'approved' | 'rejected' | 'expired' | 'ignored_duplicate'
  riskSummary: string
  commandSummary: string
  createdAt: string
  auditLogPath: string
}

export type RemoteChannelDoctorReport = {
  channelId: string
  status: 'ok' | 'warning' | 'error' | 'disabled'
  adapter: 'official_cli' | 'webhook' | 'custom'
  provider?: 'feishu' | 'lark' | 'dingtalk' | 'wecom'
  commandFound: boolean
  version?: string
  authValid?: boolean
  jsonOutputValid?: boolean
  permissionIssues: string[]
  errors: string[]
  suggestions: string[]
}
```

要求：

- 默认关闭。
- 只发送命令、摘要、审批和结果报告，不推送完整上下文。
- 必须有来源校验、用户绑定、命令白名单和审批记录。
- 飞书/Lark、钉钉、企业微信优先通过官方或官方团队开源 CLI 做 `official_cli` adapter；不得在 Phase 17 里自研完整 IM SDK 或复制第三方实现。
- `official_cli` adapter 只接收 Linghun 生成的脱敏 remote event，并调用外部 CLI 发送摘要或接收审批；外部 CLI 不得直接读取完整 transcript、memory、API key、账单或项目源码。
- CLI 不存在、版本不兼容、未登录、权限不足、输出不可解析或返回非 JSON 时，通道必须保持 `disabled` / `error`，并通过 `/remote channels doctor` 给中文修复建议。
- `/remote channels doctor` 必须输出 `RemoteChannelDoctorReport`，覆盖 command found、version、auth、JSON output、权限和错误建议。
- 必须校验 `expiresAt`、`nonce` / `id` 去重、签名或等价来源证明、绑定用户和绑定设备。
- 远程审批必须幂等：重复、延迟、乱序消息只能产生一次有效动作。
- 用户必须能暂停通道、解绑设备、清理失效绑定并查看最近审计记录。
- 审计日志只能保存命令摘要、风险摘要、审批结果、时间、通道和脱敏 user/device id；不得保存完整 prompt、完整 transcript、API key、原始账单或大文件内容。
- 通道失败不影响本地 TUI 和当前任务。
- 高风险操作必须暂停等待明确审批。

## 17.1 Release readiness / Open-source readiness 规格

Phase 15.5 必须增加发布就绪检查，确认 Linghun 可以被个人开发者安全安装、配置、诊断和回滚。

```ts
export type ReleaseReadinessReport = {
  version: string
  platform: string
  cliEntrypoints: Array<'linghun' | 'Linghun'>
  installCheck: 'pass' | 'fail' | 'partial'
  helpCheck: 'pass' | 'fail' | 'partial'
  doctorCheck: 'pass' | 'fail' | 'partial'
  keyStorage: 'env' | 'local_config' | 'keychain' | 'unknown'
  secretLeakCheck: 'pass' | 'fail' | 'partial'
  pathCheck: {
    windowsDrive: boolean
    chinesePath: boolean
    longPath: boolean
  }
  debugBundlePolicy: 'redacted_summary_only'
  configSchemaVersion: string
  rollbackNotes: string[]
  docsSynced: boolean
  risks: string[]
}
```

要求：

- `linghun --version`、`Linghun --version`、`linghun --help` 和基础 doctor 必须进入检查清单。
- 正式版密钥必须支持系统 keychain 或等价安全存储；阶段内仍使用环境变量/本地配置时必须标记限制。
- 密钥、原始账单、完整 prompt、完整 transcript 和私有大文件内容不得写入 transcript、日志、交付文档、debug bundle 或公开样例。
- debug bundle 只能包含脱敏摘要、版本、平台、错误码、命令摘要、必要日志路径和复现步骤。
- 配置 schema 必须有版本号；升级、降级和回滚失败必须有说明和恢复路径。
- Phase 15.5 必须补齐 discovery-before-execute 工具执行不变量：MCP tool、plugin command、skill action、workflow/hook 贡献工具或任何延迟加载工具，必须先完成 discover/register/trust/schema load，执行层才能调用；未发现、未注册、未信任、schema 未加载或版本不兼容时必须拒绝执行并提示先发现/启用/诊断，不能只依赖 prompt 提醒模型。
- 上述 guard 必须在 runtime 执行层兜底，并写入 focused tests；测试至少覆盖“模型试图直接执行未发现的延迟工具时被拒绝”“已发现且 schema 已加载后才进入权限管道”“拒绝消息不泄露完整 schema 或敏感配置”。
- README、START_NEXT_CHAT、docs/delivery、蓝图和规格书必须同步当前阶段状态，不能宣称未完成阶段能力。

## 17.2 Terminal TUI product polish 规格

Phase 15.5 必须把终端 TUI 成品级收口作为 release gate。桌面端仍属于 Phase 18；Phase 18 只复用已成熟的 core 和终端交互语义，不承担补齐基础 TUI 手感。

终端输出必须分为三层：

```ts
export type TuiOutputLayer = 'primary' | 'details' | 'debug'
```

- `primary`：默认给用户看的短摘要、下一步、确认选择和关键风险。
- `details`：用户显式展开或运行详情命令后展示的证据、路径、来源、测试结果和诊断。
- `debug`：内部 id、gate expiresAt、raw risk flags、logPath、schema 摘要、hash、provider raw usage 等，只能在 debug/doctor/export 中出现。

终端成品级要求：

- 启动首屏必须显示项目、provider/model、权限模式、规则、index/cache/memory 的短状态和下一步建议；缺失项不自动生成、不自动刷新、不自动安装。
- 状态栏必须 scan-friendly：短字段、稳定排序、可截断；不得显示金额、API key、完整路径、完整 hash、raw flags、完整 schema、大日志或大 index 结果。
- `/help` 必须按任务分组：对话/模型、项目规则与记忆、索引与缓存、工具与验证、权限与计划、agent/多模型、skills/workflows/plugins/hooks、诊断与退出。每组只给短用途，详情通过命令询问。
- Start Gate、权限审批和提权提示必须统一为 human-first decision prompt：动作、范围、风险、原因、继续方式、取消方式、后续是否还会走权限管道。内部字段只进 `debug`。
- Plan、acceptEdits、auto、bypass 的提示必须说明边界：是否只读、是否可写、是否仍需工具权限、是否本地显式 opt-in。
- 错误必须包含 `what happened`、`likely cause`、`next action`。provider/key/baseUrl/model、index、MCP、plugin、skill、hook、workflow 的错误不得只返回 slash 用法。
- 长任务轻提示必须包含预计时间范围、是否需要值守、完成产物、查看方式、取消方式和等待确认状态；时间只能是范围或保守估计，不承诺精确分钟。
- 自然语言状态查询必须先读本地 RuntimeStatus / CommandCapability / storage 状态。包含动作词的完成度问题，例如“索引已经建立了吗”，必须走 status 查询，不得误开 Start Gate。
- cache/index/memory/model/agent/multi-model 的默认输出必须 summary-first；大输出、完整日志、完整 memory、完整 handoff、完整 transcript 和完整 index 结果只能通过 details/debug 或文件路径查看。
- provider usage、cache、quota、budget、balance 必须标记来源：`reported`、`zero_reported`、`estimated`、`missing` 或 `unknown`；状态栏不显示金额。
- zh-CN 和 en-US 文案必须语义等价，同一 capability 不得出现中文已成品、英文只剩命令用法的情况。
- 窄终端、Windows Terminal、中文路径、长 provider/model、长状态栏、多行粘贴、resize 和连续工具输出必须有 smoke 或 snapshot 覆盖。

Phase 15.5 的 TUI 验收必须至少覆盖：

- startup：无 `LINGHUN.md`、无 provider/key、index missing/ready/stale、cache n/a、memory empty。
- help：分组输出、中文/英文命令用途询问。
- natural intent：状态查询、doctor 查询、用法询问、安全动作、危险动作、模糊请求。
- decision prompts：Start Gate、权限审批、提权、Plan、acceptEdits、auto、bypass。
- long-running hints：index、verification、agent、cross-review、build/test。
- diagnostics：model doctor、MCP doctor、plugin/skill/hook/workflow doctor。
- rendering：窄宽度、中文路径、长模型名、长状态栏、连续工具输出和后台刷新。

## 17.3 Provider integration maturity 规格

Phase 15.5 必须把模型接入成熟度作为 release gate。Phase 13 只证明多模型角色路由闭环；Phase 15.5 要证明不同官方 provider、OpenAI-compatible 中转站、Claude-compatible 中转站和自定义服务在能力、usage/cache、quota、错误、fallback 和配置体验上不会误导用户。

```ts
export type ProviderProfileKind =
  | 'openai_native'
  | 'anthropic_native'
  | 'deepseek_native'
  | 'openai_compatible_gateway'
  | 'claude_compatible_gateway'
  | 'custom_http'
  | 'unknown'

export type ProviderCapabilitySource =
  | 'reported'
  | 'configured'
  | 'profile_default'
  | 'estimated'
  | 'unknown'

export type ProviderUsageSource =
  | 'reported'
  | 'zero_reported'
  | 'missing'
  | 'estimated'
  | 'unknown'

export type ProviderQuotaSource =
  | 'official_reported'
  | 'oauth_reported'
  | 'gateway_reported'
  | 'template_reported'
  | 'custom_script'
  | 'estimated'
  | 'unknown'
```

要求：

- Adapter 成品级验收不能只看“能返回文本”；必须验证统一事件转换、streaming/非流式降级、tool calling 能力声明、usage 映射、prompt cache 字段映射、model metadata、错误归一化、配置诊断和 focused tests。
- Provider profile 必须明确来源。第三方中转站即使兼容 OpenAI 或 Claude 接口，也只能标记为 gateway/custom，不得伪装成官方 native provider。
- Capability doctor 必须覆盖 tool calling、vision、image、reasoning effort、prompt cache、JSON schema、max context、max output、streaming usage、quota query；能力缺失时输出 `OK/WARN/BLOCK` 和下一步建议。
- Role route doctor 必须按 planner、executor、reviewer、verifier、summarizer、vision、image 检查能力需求、fallback、预算和 stop 条件；不能只检查模型名是否存在。
- Usage/cache 字段必须按 source 标记。`cache_creation_tokens=0` 只能解释为 `zero_reported`，不得说成零成本或缓存一定新鲜。
- Quota/balance 查询必须区分官方 OAuth/订阅、gateway reported、自定义脚本、模板查询和 unknown；不同单位不能混成一个余额数字。
- Provider error classifier 必须把 key 缺失、baseUrl 错误、model 不存在、quota 不足、rate limit、tool 不支持、gateway 格式异常、网络超时、HTML 错误页转成可操作 doctor 输出。
- Fallback/retry 必须可审计：记录原 provider/model、fallback provider/model、触发原因、是否保留工具能力、是否影响 usage/cache/quota；不得静默切模型。
- 配置优先级必须明确：环境变量、本地 config、系统 keychain 或等价安全存储的读取顺序、脱敏展示和删除/回滚方式必须可诊断。
- API key、token、原始账单、完整 prompt、完整 transcript、私有 baseUrl 参数不得进入 transcript、日志、debug bundle 或交付文档。

Phase 15.5 的模型接入验收必须至少覆盖：

- OpenAI-compatible gateway、DeepSeek、OpenAI native、Anthropic/Claude native 或 mock native adapter 的 doctor 路径；未实现的 native adapter 必须明确 pending/unsupported。
- role route doctor 的 OK/WARN/BLOCK 分支。
- usage/cache 的 reported、zero_reported、missing、estimated、unknown 分支。
- quota/balance 的 gateway_reported、custom_script、unknown 分支。
- provider error classifier 的中英文输出。
- fallback/retry 的 transcript、usage 和 handoff 审计记录。
- key 脱敏、baseUrl/model 配置错误和配置回滚路径。

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
- Skill 加载必须 summary-first、load-on-demand；metadata、description、triggers 必须稳定排序，命中后才读取 `file` 指向的正文。
- 第三方 skill 必须显示来源、路径、启用状态、信任级别和是否可能触发工具或 workflow。
- 成功任务可生成候选 skill，用户确认后写入。
- `/workflows` 必须列出工作流模板、用途、风险和是否会写文件。
- 工作流启动前走 Start Gate；写入和命令仍走权限管道。
- workflow 必须有验收定义：输入、步骤、是否允许写入、建议验证命令、完成条件和失败降级。

## 18.1 Hooks 规格

Hooks 是高级自动化能力，默认关闭，新手模式隐藏。

```ts
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'Notification'
  | 'Workflow'
  | 'Plugin'
  | 'SessionStart'
  | 'SessionEnd'
  | 'HandoffCreated'

export type HookConfig = {
  id: string
  event: HookEvent
  source: 'user' | 'project' | 'plugin'
  command?: string
  url?: string
  timeoutMs: number
  enabled: boolean
  requiresTrust: boolean
}

export type HookRunResult = {
  id: string
  hookId: string
  status: 'passed' | 'blocked' | 'failed' | 'timed_out'
  message?: string
  logPath?: string
}
```

要求：

- 项目 Hook 必须在项目信任后才执行。
- Hook 不能绕过权限系统。
- Hook 失败不能拖垮主对话。
- Hook 输出必须截断，大输出写日志路径。
- Hook 必须有超时，默认超时有限制。
- PreToolUse 可阻止高风险工具。
- PostToolUse 可触发最小验证或检查。
- Stop 可阻止阶段任务在未验证、未写交付文档、未生成 handoff 时结束。
- Notification 只发送摘要，不发送完整上下文。
- `/doctor hooks` 和 `/plugins doctor` 必须显示来源、路径、触发事件、最近运行结果、错误原因和是否被禁用。
- Hook 配置、来源、事件名和贡献点必须稳定排序；动态运行时间、随机 id、完整日志不得进入 prompt 稳定层。
- 第三方 Hook 未信任时不得执行 command/url。

## 18.2 Plugin 规格

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
- Plugin / MCP / skill / workflow / hook 贡献的延迟工具必须遵守 discovery-before-execute：贡献项先进入稳定排序的 catalog / doctor 摘要，用户或模型只有在工具已 discover、已注册、已信任且 schema 已加载后，才能进入 Start Gate 或权限管道；未发现工具名不得被 `ExecuteExtraTool` 类入口直接调用。
- Plugin 加载失败不能影响主会话。
- Plugin 清单排序稳定，避免破坏 prompt cache。
- Plugin 的 manifest、贡献点、权限摘要和 doctor 摘要必须稳定排序；动态字段只能进入日志或 doctor 详情，不进入 prompt 稳定层。
- 第三方 Plugin 首次启用前必须展示来源、路径、版本、commit、权限差异和信任级别。
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
15.5. 双模型交叉审查、终端 TUI 成品级收口与开源前 hardening。
16. 可控学习。
17. 长期托管。
18. 桌面端预留。

不能为了后期功能牺牲前期闭环。
