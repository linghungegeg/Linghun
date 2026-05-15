# Linghun 终极架构设计与开发路线

> 目标：把前期聊天讨论、`docs/archive/open-raw-ideas.txt` 的杂乱想法、CCB 审计报告、CCB Dev Boost 实测增强、以及社区成熟项目方向，收敛成一份能指导实际开发的终版路线。

## 0. 结论先行

Linghun 不应该做成“另一个 CCB 补丁版”，也不应该做成“什么都支持但编码能力一般”的大杂烩。

Linghun 的正确定位是：

> 面向中文开发者的工程型 AI 编程终端。以 CCB 级编码体验为核心，融合多模型开放、代码库索引、跨会话记忆、缓存降本、MCP/Skills 生态和严格工程行为约束，让个人开发者低成本、低幻觉、持续地完成真实项目开发。

关键取舍：

- 核心编码能力必须先到位，工具、权限、上下文、缓存、Agent 是底座。
- 参考 CCB 的行为与交互，不复制可疑源码。
- 参考 OpenCode 的多模型开放，不牺牲 CCB 的执行体验。
- 参考 Hermes 的记忆与技能沉淀，但第一阶段不做后台自治。
- 保留 CCB Dev Boost 已验证的缓存、索引、MCP 稳定、中文化和成本观测能力。
- 默认简单，新手可用；高级能力通过 `/features` 和首次向导打开。
- 先 TUI，后桌面端；但从第一天就把核心引擎和 UI 分离，给桌面端留路。

## 1. 设计来源

### 1.1 用户原始目标

来自原始想法归档和聊天上下文的真实需求：

- 安装简单、部署简单，不强制 C 盘，不要求用户手写复杂配置。
- 编码高效，CCB 核心能力不能丢。
- CCB Dev Boost 的加强能力不能丢。
- 中文友好，适合新手。
- 减少模型幻觉、绕路、过度设计。
- 多模型兼容，不绑定单一厂商。
- MCP 开放包容，能接成熟生态。
- 支持联网检索。
- 支持记忆、索引、跨会话继续工作。
- 最好能读其他工具会话，例如 Claude / Codex。
- 能看见缓存命中率、token、费用、省多少钱。
- 先终端 TUI，后桌面端。
- 终端也要有项目名、会话列表、继续工作体验。
- 命令习惯尽量保持 Claude 原味。
- 所有功能优先借鉴成熟社区方案，不造不稳定轮子。
- 不降低编码能力的前提下降本。

### 1.2 CCB 必须继承的能力

基于 `docs/audit/CODE_AUDIT_REPORT.md`，必须继承这些“能力结构”：

- CLI 快速路径。
- TUI 主交互。
- 流式 API 响应处理。
- Tool 接口与注册表。
- Read / Edit / Write / Grep / Glob / Bash。
- 权限审批管道。
- Plan 模式。
- Agent 子代理与生命周期清理。
- MCP 连接、工具发现和资源管理。
- CLAUDE.md 多层加载与 include。
- JSONL 会话持久化。
- 多 Provider 适配。
- 上下文压缩。
- prompt cache 诊断与统计。
- 状态栏。
- 多层设置来源。
- Todo / 任务列表，用来让长任务进度可见、可恢复。
- Checkpoint / rewind，用来在修改跑偏时回退到上一个安全点。
- 后台任务折叠、查看、恢复和中断。
- 临时插问能力，用户能在长任务中问小问题而不打断主任务。
- 输入队列和中断控制，避免粘贴、多轮输入、Esc/Ctrl+C 时状态错乱。
- diff 审阅和应用前确认，尤其是 plan / default 模式。
- 权限规则持久化和最近拒绝记录。
- Claude 风格 slash 命令和常用别名兼容。

### 1.3 CCB Dev Boost 必须继承的增强

基于本地 `ccb-source/docs/ccb-optimizations.md`：

- 状态栏缓存命中率提示。
- 缓存警告中文化。
- 并行工具调用指引。
- 去除不必要云端 MCP 启动延迟。
- 消息重复渲染修复经验。
- 内置 codebase-memory-mcp 推荐接入。
- AI sessions 会话历史检索。
- DeepSeek V4 / V4 Pro 1M 上下文能力表。
- 缓存破坏定位器。
- MCP tool description / schema 稳定化。
- 索引过期提醒。
- 大文件索引保护。
- 最近 20 轮 cache 命中率日志。
- `/cache-log` 和 `/break-cache` 类诊断面板。
- 中文配置面板。

### 1.4 参考社区项目的边界

| 项目/方向 | 借鉴 | 不照搬 |
| --- | --- | --- |
| CCB / Claude Code | 编码工作流、工具闭环、TUI、Plan、Agent、缓存组织 | 可疑源码、内部 API、反编译产物、专有遥测 |
| OpenCode | 多模型开放、provider 抽象、LSP/插件思路 | 如果执行体验弱于 CCB，不照搬执行层 |
| Hermes Agent | MEMORY / USER / Skills / 经验固化 | 后台自主演练第一阶段不做 |
| codebase-memory-mcp | 代码图索引、调用链、架构查询 | 不强制自动全量索引，不让 MCP 崩溃拖垮主程序 |
| AI Sessions MCP | 跨工具会话检索 | 不承诺全自动接管所有工具上下文 |
| Reasonix 类缓存方案 | 缓存稳定、命中率观测、静态上下文稳定 | 不做用户看不懂的黑盒 |

## 2. 产品原则

### 2.1 强编码优先

Linghun 的第一优先级是：

1. 看懂项目。
2. 定位问题。
3. 做最小必要修改。
4. 跑验证。
5. 给清楚结论。

不是第一优先级：

- 宠物。
- 语音。
- 花哨远控。
- 全自动后台自治。
- 复杂工作流市场。

这些可以作为后续扩展，但不能影响核心编码体验。

### 2.2 默认简单，高级可选

新用户默认只看到：

- 对话。
- 项目名。
- 当前模型。
- 权限模式。
- 缓存命中率。
- 常用命令。

高级功能放进：

- `/features`
- `/mcp`
- `/config advanced`
- 首次启动向导。

### 2.3 严格工程行为

模型默认不是“自由聊天人格”，而是工程执行者：

- 先查证，再回答。
- 先读代码，再修改。
- 默认最小改动。
- 不确定就说不确定。
- 不能做就说不能做，并给替代方案。
- 修改后验证。
- 高风险先询问。

这个行为约束不会降低编码能力，它限制的是绕路、幻觉和自作聪明。

## 3. 总体架构

```text
packages/
  core/                 Agent 核心、Session、事件流、任务循环
  tui/                  Ink 终端 UI
  cli/                  命令入口与 headless 模式
  tools/                内置工具
  permissions/          权限审批管道
  providers/            模型网关
  context/              上下文、prompt、压缩、缓存
  mcp/                  MCP 客户端与内置推荐服务器
  memory/               项目规则、记忆、会话摘要
  indexers/             codebase-memory 接入与索引健康
  sessions/             JSONL 会话、跨工具导入
  skills/               Skills 和工作流
  cost/                 token、费用、命中率统计
  desktop-bridge/       未来桌面端复用 API
apps/
  linghun-cli/
  linghun-tui/
  linghun-desktop/      后续
```

核心原则：

- `core` 不依赖 Ink。
- `providers` 不依赖 UI。
- `tools` 只通过权限管道执行。
- `mcp` 失败不能让主会话崩。
- `context/cache` 必须可观测。
- TUI 和未来桌面端共用同一个 `core`。

## 4. 核心数据流

### 4.1 一轮对话流程

```text
UserInput
  -> Session 接收
  -> Behavior Guard 判断任务类型和风险
  -> Context Builder 组装上下文
  -> Cache Planner 稳定静态/半稳定层
  -> Model Gateway 发起流式请求
  -> Stream Parser 统一为 LinghunEvent
  -> Tool Scheduler 执行工具
  -> Permission Pipeline 决策
  -> Tool Result 回灌模型
  -> Verification Runner 运行验证
  -> Cost/Cache Recorder 记录命中率和费用
  -> TUI 更新消息、状态栏、会话
```

### 4.2 上下文分层

```text
静态层：
  - Linghun 核心行为规则
  - 工具使用协议
  - 输出格式协议
  - 权限模式说明

半稳定层：
  - 项目规则 LINGHUN.md / AGENTS.md / CLAUDE.md
  - 模型能力表
  - MCP 工具目录摘要
  - Skills 摘要
  - codebase index 状态摘要

动态层：
  - 用户本轮输入
  - 最近必要消息
  - 文件片段
  - 工具结果
  - 验证输出
```

缓存策略：

- 静态层尽量字节稳定。
- 半稳定层变化要可解释。
- 动态层不追求缓存。
- 每轮记录 cache read / cache write / hit rate。
- 任何 system prompt、tool schema、MCP 列表变化都要能定位。

## 5. 模型行为控制层

### 5.1 为什么需要

用户明确担心模型：

- 容易绕。
- 幻觉强。
- 把简单问题复杂化。
- 没看代码就猜。
- 新手分不清真假。

所以 Linghun 必须在底层做行为框架，而不是只靠一句 prompt。

### 5.2 行为模式

| 模式 | 用途 | 工具权限 | 默认 |
| --- | --- | --- | --- |
| strict | 日常开发、修 bug | 最小必要工具 | 是 |
| plan | 只规划 | 禁止写入和高危命令 | 否 |
| acceptEdits | 少审批开发 | 低风险编辑自动通过 | 否 |
| auto | 分类器辅助选择权限 | 受规则限制 | 否 |
| bypass | 高权限执行 | 高危仍保护 | 否 |
| creative | 产品方案、头脑风暴 | 默认不执行工具 | 否 |
| autonomous | 长任务自主推进 | 需要用户明确开启 | 否 |

### 5.3 反幻觉协议

模型必须遵守：

- 没读到文件，不说“代码一定是”。
- 没联网，不说“最新版本是”。
- 没运行验证，不说“已验证通过”。
- 当前模型不支持视觉，就提示切换视觉模型。
- 当前环境没有 MCP，就不要假装已查索引。
- 不确定时给置信度和下一步核实方式。

### 5.4 简单路径优先

任务默认流程：

1. 确认目标。
2. 查询索引或搜索定位。
3. 读取最少文件。
4. 小步修改。
5. 最小验证。
6. 总结影响。

禁止默认行为：

- 一上来大范围重构。
- 顺手改无关文件。
- 自创复杂抽象。
- 未经确认改依赖、构建、公共接口。

## 6. 工具系统

### 6.1 MVP 内置工具

第一批必须实现：

- `Read`
- `Write`
- `Edit`
- `MultiEdit`
- `Glob`
- `Grep`
- `Bash`
- `Todo`
- `WebFetch`
- `WebSearch`
- `Agent`
- `AskUser`
- `EnterPlanMode`
- `ExitPlanMode`
- `Verify`
- `SearchExtraTools`
- `ExecuteExtraTool`
- `MCPTool`

### 6.2 Tool 接口

每个工具必须声明：

```ts
type ToolDefinition<Input, Output> = {
  name: string
  description: string
  inputSchema: ZodSchema<Input>
  permission: ToolPermissionSpec
  isReadOnly: boolean
  isConcurrencySafe: boolean
  isCacheSensitive?: boolean
  validate(input: Input, ctx: ToolContext): Promise<void>
  call(input: Input, ctx: ToolContext): AsyncGenerator<ToolEvent, Output>
}
```

### 6.3 工具执行管道

```text
find tool
  -> parse input
  -> validate input
  -> permission check
  -> pre hooks
  -> execute
  -> stream progress
  -> normalize result
  -> post hooks
  -> record cost/time/error
```

### 6.4 并发规则

借鉴 CCB：

- 只读工具可并行。
- 独立 Grep/Glob/Read 可并行。
- 写入工具默认串行。
- Bash 默认串行，除非显式标记安全。
- 同一文件 Edit 串行。
- Agent 可并行，但受数量限制。

默认限制：

- 同轮并发工具上限：8。
- Agent 上限：3。
- Bash 超时默认：120 秒。
- query 默认 max turns：100。

## 7. 权限系统

### 7.1 权限模式

| 模式 | 说明 |
| --- | --- |
| default | 正常询问 |
| plan | 只读规划 |
| acceptEdits | 工作区内低风险编辑自动通过 |
| dontAsk | 无法询问时自动拒绝需要审批的操作 |
| auto | 分类器辅助，但不得绕过硬规则 |
| bypass | 高权限，仅用户明确打开 |

### 7.2 不可绕过规则

即使 bypass 也必须保护：

- `.git`、`.ssh`、密钥目录。
- 系统目录。
- 批量删除。
- 远程脚本执行。
- 修改配置中的密钥。
- 未知安装命令。
- 跨盘大范围移动/删除。

### 7.3 Plan 模式

Plan 模式必须在权限层强制只读：

- 允许 Read / Grep / Glob / WebSearch / index query。
- 禁止 Write / Edit / MultiEdit。
- Bash 只允许安全只读命令白名单。
- 禁止安装、删除、启动长驻服务。

这是 CCB 里已发现问题的明确修正点。

## 8. Agent 与多模型协作

### 8.1 Agent 类型

MVP：

- `explorer`：只读，查代码、查索引、总结。
- `worker`：可编辑，执行明确子任务。
- `verifier`：验证、测试、复核。
- `planner`：只规划。

后续：

- `reviewer`
- `migration`
- `security`
- `frontend`
- `database`

### 8.2 生命周期

每个 Agent 必须有：

- agent id。
- transcript。
- 独立 AbortController。
- 工具权限范围。
- 可用 MCP 范围。
- 文件缓存。
- 清理 finally。

清理必须容错：

```text
cleanup MCP
cleanup hooks
kill bash tasks
flush transcript
release file cache
unregister agent
```

每一步失败都记录，但不阻断后续清理。

### 8.3 多模型路由

多 AI 协作不是默认乱开，而是按能力路由：

| 任务 | 推荐模型 |
| --- | --- |
| 日常代码执行 | DeepSeek V4 Pro / Claude Sonnet |
| 复杂规划 | Claude / GPT-5.5 |
| 审查复核 | GPT-5.5 / Claude |
| 视觉理解 | 支持视觉的 Claude / GPT |
| 低成本搜索总结 | DeepSeek / 本地模型 |

第一版只做手动路由：

```text
/agent run explorer --model deepseek-v4-pro
/agent run reviewer --model gpt-5.5
```

后续再做自动路由。

## 9. 模型网关

### 9.1 Provider 支持

第一批：

- OpenAI compatible。
- DeepSeek。
- Anthropic Claude。
- Gemini。
- Ollama。

第二批：

- Grok。
- OpenRouter。
- Azure OpenAI。
- Bedrock。
- Vertex。

### 9.2 统一事件流

所有 provider 必须转换为统一事件：

```ts
type LinghunEvent =
  | { type: 'message_start' }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; result: unknown }
  | { type: 'usage'; usage: ModelUsage }
  | { type: 'message_stop'; reason: string }
  | { type: 'error'; error: LinghunError }
```

业务层不能直接依赖 Anthropic 或 OpenAI 原始事件。

### 9.3 模型能力表

每个模型记录：

- 上下文窗口。
- 最大输出。
- 是否支持工具。
- 是否支持 thinking。
- 是否支持视觉。
- 是否支持 prompt cache。
- 输入价格。
- 输出价格。
- cache read 价格。
- cache write 价格。

DeepSeek V4 / V4 Pro：

- 1M 上下文要正确展示。
- 输出 token 上限要可配置。
- thinking 只能白名单启用。

## 10. 上下文、缓存与降本

### 10.1 核心目标

真实项目长期开发目标：

- 常态缓存命中率：92% - 96%。
- 理想峰值：98%。
- 缓存破坏可定位。
- 成本实时可见。

### 10.2 Cache Guard

必须内置：

- system prompt diff。
- tool schema diff。
- MCP tool list diff。
- model changed。
- reasoning effort changed。
- cache_control changed。
- compact changed。
- beta/header changed。

展示：

```text
上次缓存破坏：
原因：MCP tools changed (+2/-0)
新增：mcp__x__search
cache read：45231 -> 2108
```

### 10.3 MCP 稳定化

必须继承 CCB Dev Boost：

- description 去时间戳、UUID、版本号、hash。
- input schema key 稳定排序。
- required 数组排序。
- MCP 工具按稳定规则排序。
- MCP 失败不改变主工具列表字节结构，尽量只改变状态。

### 10.4 大文件保护

索引前扫描：

- JSON
- SQL
- XML
- CSV
- min.js
- bin/dat/pak
- 图片/视频/字体

超过阈值提示 `.linghunignore` 或 `.cbmignore` 排除。

### 10.5 状态栏

第一版状态栏必须显示：

```text
项目 | 模型 | 模式 | 命中率 | agent 数 | 索引状态
```

进阶面板：

- `/cache-log`
- `/break-cache status`
- `/usage`
- `/stats`
- `/index status`

## 11. 记忆、索引、会话交接

### 11.1 项目规则

加载顺序：

```text
内置默认规则
用户规则 ~/.linghun/LINGHUN.md
项目规则 ./LINGHUN.md
兼容规则 ./AGENTS.md
兼容规则 ./CLAUDE.md
本地私有规则 ./LINGHUN.local.md
```

兼容是为了迁移方便，但 Linghun 自己的主文件应叫 `LINGHUN.md`。

### 11.2 代码库索引

第一版接入 codebase-memory-mcp：

- `index_repository`
- `index_status`
- `search_graph`
- `query_graph`
- `trace_path`
- `get_code_snippet`
- `get_architecture`
- `detect_changes`

策略：

- 不默认强制索引。
- 首次进入项目提示是否建立 fast 索引。
- 文件变化超过阈值提醒刷新。
- 大文件未排除时阻止默认索引，用户确认后才继续。

### 11.3 会话系统

内部会话：

- JSONL。
- 按项目分组。
- 支持标题、摘要、模型、成本、最后任务。
- 支持 `/sessions` 选择恢复。

外部会话：

- 第一阶段接 AI sessions MCP。
- 支持 Claude / Codex。
- Cursor 等放后续。

使用方式：

```text
/sessions
/sessions import
请基于最近 Codex 会话和项目索引继续处理 xxx
```

## 12. MCP 与 Skills

### 12.1 MCP

默认推荐但不强制启用：

- codebase-memory-mcp。
- AI sessions MCP。
- web search MCP。
- browser MCP。

必须有：

- `/mcp`
- `/mcp doctor`
- `/mcp enable`
- `/mcp disable`
- `/mcp tools`

MCP 启动失败时：

- 不影响主对话。
- 显示明确错误。
- 给安装命令或路径修复建议。

### 12.2 Skills 与 Plugins

第一版只做加载和执行，不做复杂市场：

- 项目 skill。
- 用户 skill。
- 内置 workflow skill。
- Plugin 清单与启停。

内置工作流：

- bug-fix。
- review。
- doc-to-code。
- design-to-code。
- release-note。
- refactor-plan。

成功经验可建议固化，但不默认自动写文件。

Skill 和 Plugin 的边界：

- Skill：面向模型的能力说明、工作流步骤、领域经验，例如 bug-fix、review、发布说明。
- Plugin：面向系统的扩展包，可以包含 MCP server 配置、skills、commands、providers、hooks。
- 第一版 Plugin 不做市场，只做本地清单、启停、诊断和安全隔离。
- Plugin 不能绕过权限管道，不能静默新增高风险工具。

OpenCode 值得吸收：

- provider 抽象和模型能力表。
- OpenAI compatible / 本地模型 / 多厂商统一路由。
- 配置化、可迁移的项目设置。
- LSP 思路后置吸收，用于更精准的符号理解。
- 插件生态的开放边界，但不牺牲 CCB 风格执行体验。

Hermes 值得吸收：

- MEMORY / USER 分层记忆。
- 成功任务沉淀为可审查 Skill。
- 工作流可进化，但必须用户确认。
- 长期任务和自主能力可控开启，默认关闭。

## 13. 功能开关

保留 CCB 的 FEATURE 思路，但统一、可见、可解释。

命名：

```text
LINGHUN_FEATURE_MEMORY=1
LINGHUN_FEATURE_SEARCH=1
LINGHUN_FEATURE_MCP=1
LINGHUN_FEATURE_CODEBASE_INDEX=1
LINGHUN_FEATURE_AI_SESSIONS=1
LINGHUN_FEATURE_MULTI_AGENT=1
LINGHUN_FEATURE_CACHE_GUARD=1
LINGHUN_FEATURE_STATUS_DASHBOARD=1
LINGHUN_FEATURE_SKILLS=0
LINGHUN_FEATURE_LSP=0
LINGHUN_FEATURE_PROACTIVE=0
LINGHUN_FEATURE_AUTONOMOUS=0
LINGHUN_FEATURE_DAEMON=0
LINGHUN_FEATURE_REMOTE_TRIGGERS=0
LINGHUN_FEATURE_LAN_PIPES=0
```

默认开启：

- search。
- mcp 基础能力。
- codebase index 推荐能力。
- cache guard。
- status dashboard。
- memory 基础加载。

默认关闭：

- proactive。
- autonomous。
- daemon。
- remote triggers。
- lan pipes。
- skills 自动生成。

`/features` 必须解释：

- 这个功能做什么。
- 是否推荐新手开启。
- 是否会增加 token。
- 是否会后台运行。
- 是否有安全风险。

## 14. 安装与配置

### 14.1 Windows 优先

必须支持：

- 任意盘安装。
- 任意盘项目。
- PowerShell / CMD / Windows Terminal。
- WSL 路径识别。
- 长路径处理。
- 中文路径。

### 14.2 首次启动向导

```text
1. 选择语言：中文 / English
2. 选择模型：DeepSeek / Claude / OpenAI compatible / Ollama
3. 配置 API Key 或 base_url
4. 是否启用 usage / stats 估算详情
5. 是否启用代码索引
6. 是否启用 MCP 推荐组件
7. 是否启用跨会话读取
8. 选择默认审批模式
```

### 14.3 配置优先级

```text
命令行参数
> 环境变量
> 项目配置 .linghun/settings.json
> 用户配置 ~/.linghun/settings.json
> 默认配置
```

密钥：

- 第一版可以支持环境变量和本地配置。
- 正式版必须支持系统 keychain。

## 15. 技术选型

推荐：

| 层 | 方案 |
| --- | --- |
| 语言 | TypeScript |
| Runtime | Node.js 22+ |
| Package manager | pnpm |
| Build | tsup 或 Vite |
| Test | Vitest |
| Lint/Format | Biome |
| TUI | Ink 标准版 |
| Schema | Zod |
| 子进程 | execa |
| 文件监听 | chokidar |
| Glob | picomatch |
| 搜索 | ripgrep |
| 本地数据库 | SQLite |
| MCP | 官方 MCP SDK |
| Desktop | Tauri 优先，Electron 备选 |

不建议：

- 第一版全 Rust/Go。
- 第一版直接桌面端。
- 第一版自研代码图索引。
- 第一版做大而全插件市场。

## 16. 目录规划

```text
F:\LinghunProject 或新仓库根目录
  apps/
    cli/
    tui/
    desktop/
  packages/
    core/
    providers/
    tools/
    permissions/
    context/
    cache/
    mcp/
    memory/
    sessions/
    skills/
    cost/
    config/
    shared/
  docs/
    architecture.md
    mvp.md
    provider.md
    tools.md
    permissions.md
    cache.md
    mcp.md
    roadmap.md
```

## 17. 开发路线

具体阶段范围、产物和验收以 `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` 为准。本节只保留架构路线索引，避免出现两套阶段编号。

| 阶段 | 名称 | 目标 |
| --- | --- | --- |
| Phase 00 | 设计冻结与基线确认 | 冻结产品方向、参考来源、阶段边界和开发准则 |
| Phase 01 | 工程骨架闭环 | pnpm monorepo、CLI 入口、基础包、测试/构建/typecheck |
| Phase 02 | Session 与会话持久化闭环 | 项目识别、JSONL transcript、会话创建/列出/恢复/摘要 |
| Phase 03 | 模型网关最小闭环 | Provider、ModelGateway、DeepSeek/OpenAI-compatible、模型能力表、usage 事件 |
| Phase 04 | TUI / REPL 最小闭环 | 无参数进入 REPL、状态栏、slash 命令、对话写入 transcript |
| Phase 05 | 核心工具闭环 | Read / Write / Edit / MultiEdit / Grep / Glob / Bash / Todo / Diff |
| Phase 06 | 权限与 Plan 闭环 | 权限规则、Plan 方案选择、acceptEdits、模式切换 |
| Phase 07 | 工程行为控制闭环 | 反幻觉、最小改动、基础 i18n、TUI 渲染稳定性、后台状态反馈、checkpoint/rewind、输入队列与中断 |
| Phase 08 | 代码自检与验证增强闭环 | verifier、验证计划、验证进度、PASS/FAIL/PARTIAL 结果归档、review |
| Phase 09 | 缓存与成本闭环 | cache history、cache break、`/usage`、`/stats`、轻提示 |
| Phase 10 | MCP 与 codebase-memory 闭环 | MCP 面板、索引、索引过期提醒、大文件保护 |
| Phase 11 | 会话交接与记忆闭环 | `/resume`、`/branch`、`LINGHUN.md`、handoff packet、跨会话导入 |
| Phase 12 | Agent 闭环 | explorer、worker、verifier、planner、`/fork`、agent transcript |
| Phase 13 | 多模型协作闭环 | planner/executor/verifier 多角色模型、路由与预算 |
| Phase 14 | Skills 与工作流闭环 | Skills、Workflows、Hooks、Plugin 底座 |
| Phase 15 | 真实项目测试版 | 用真实老项目验证完整开发闭环 |
| Phase 16 | 可控学习闭环 | 越用越聪明，但学习内容可审计、可撤销、可关闭 |
| Phase 17 | 长期托管任务与自动会话 | 定时任务、自动会话、Remote Channels、单阶段自动工作 |
| Phase 18 | 桌面端预留验证 | 终端核心可复用到桌面端，验证 IPC/API 边界 |

当前进度：

- Phase 00-06 已完成。
- 下一阶段是 Phase 07：工程行为控制闭环。
- 自动工作默认一次只推进一个阶段；每阶段完成后必须写交付文档、验证结果和 handoff packet。

## 18. MVP 定义

MVP 必须包含：

- CLI + TUI。
- 单模型 OpenAI compatible + DeepSeek。
- Read/Edit/Write/Grep/Glob/Bash。
- 权限系统。
- Plan 模式。
- strict 行为。
- 状态栏。
- JSONL 会话。
- 基础 cost/cache 记录。
- codebase-memory-mcp 推荐接入。
- 中文界面。

MVP 不包含：

- 桌面端。
- 后台 daemon。
- 远程触发。
- LAN pipes。
- 全自动自治。
- 完整 Skills 市场。
- 全自动多模型编排。
- 全量 LSP。

## 19. 真实验收场景

必须用真实项目验收，而不是 demo：

1. H5 游戏老项目 bug 修复。
2. C++ / Lua 混合项目调用链分析。
3. Python / Flask 后台问题定位。
4. TypeScript 前端组件修改。
5. 大 JSON / SQL 存在时索引保护。
6. DeepSeek V4 Pro 长上下文开发。
7. Claude / Codex 会话交接。
8. 缓存命中率从低到高的诊断。

指标：

- 单次 bug 修复能闭环。
- 多文件影响面能查准。
- 计划模式不误写。
- MCP 崩溃不拖垮主会话。
- 缓存命中常态 92% - 96%，峰值可接近 98%。
- 用户能看懂花了多少钱、省了多少钱。

## 20. 最大风险

### 20.1 做出来编码能力不如 CCB

控制：

- 先复刻核心工作流，不先堆功能。
- 工具系统和上下文系统优先级最高。
- 每阶段都拿真实项目对比 CCB。

### 20.2 功能太多变复杂

控制：

- 默认少。
- 高级开关可见。
- MVP 严格砍范围。

### 20.3 多模型导致体验不稳定

控制：

- 统一事件流。
- 模型能力表。
- 能力不足明确提示。
- 第一版默认推荐少数模型。

### 20.4 缓存优化损害输出质量

控制：

- 只缓存稳定层。
- 动态任务上下文保证完整。
- 命中率和任务成功率一起看。

### 20.5 MCP 生态不稳定

控制：

- MCP 隔离进程。
- 失败降级。
- `/mcp doctor`。
- 推荐少量成熟 MCP。

## 21. 最终判断

Linghun 要想“不输 CCB”，不是靠堆 100 个功能，而是要把这五个底座磨稳：

1. 工具系统。
2. 上下文与缓存。
3. 权限与 Plan。
4. Agent 生命周期。
5. 模型事件适配。

在这五个底座稳定之前，桌面端、技能市场、远程控制、自动自治都应该后置。

如果按本文路线执行，Linghun 的第一阶段目标不是立刻超越 CCB，而是达到：

- CCB 核心编码体验的 70% - 80%。
- 中文体验、安装配置、成本可见性明显优于 CCB。
- 后续通过真实项目打磨接近 90%+。

最终优势应落在：

- 更可维护。
- 更开放。
- 更适合中文开发者。
- 更低成本。
- 更容易从终端走向桌面端。

这才是 Linghun 值得做的地方。
