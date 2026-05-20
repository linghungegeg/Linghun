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
- 参考 Warp 的现代终端 block/panel、命令发现和 runbook 手感，但不做重 GUI、云同步工作台或为美观增加 prompt 成本。
- 参考 Hermes 的记忆与技能沉淀，但第一阶段不做后台自治。
- 保留 CCB Dev Boost 已验证的缓存、索引、MCP 稳定、中文化和成本观测能力。
- 默认简单，新手可用；高级能力通过 `/features` 和首次向导打开。
- 先 TUI，后桌面端；桌面端只在终端成熟、真实项目实测稳定、核心 API 边界清楚之后再讨论。当前只保持 core/UI 分离，不提前做桌面产品。

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
- codebase-memory-mcp 推荐接入；当前 Phase 10 只完成本机 CLI/MCP 最小闭环，随包内置固定版本和免安装体验必须在 Bundled codebase-memory Lite / 开源前 hardening 单独验收。
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
| Warp | 现代终端 block/panel、Command Palette、workflow/runbook、命令输出可扫读状态 | 云同步 Drive、重 GUI、常驻侧边栏、动画/鼠标重交互、为美观增加模型调用或破坏 cache prefix |
| Hermes Agent | MEMORY / USER / Skills / 经验固化 | 后台自主演练第一阶段不做 |
| codebase-memory-mcp | 代码图索引、调用链、架构查询 | 不强制自动全量索引，不让 MCP 崩溃拖垮主程序 |
| AI Sessions MCP | 跨工具会话检索 | 不承诺全自动接管所有工具上下文 |
| Reasonix 类缓存方案 | 缓存稳定、命中率观测、静态上下文稳定 | 不做用户看不懂的黑盒 |

详细参考源、公开地址、本地路径、禁止事项和阶段对应关系维护在 `docs/audit/reference-map.md`。后续阶段执行时必须先按该表确认参考边界；需要联网核验的公开项目应按需联网，不得虚造或复制实现。

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

默认简单不是功能弱化。Linghun 必须采用渐进披露：

- 默认界面只给当前任务最有用的短路径，减少学习成本。
- 完整能力仍必须通过 `/help all`、`/features`、`/config advanced`、doctor 详情和自然语言用途询问可发现。
- 常见工作不要求用户先学 slash command；自然语言应能进入成熟的状态查询、项目规则读取、索引、缓存、模型、验证和恢复路径。
- 高级功能默认隐藏或关闭，但开启后必须完整：有诊断、权限、审计、失败降级和关闭入口。
- 安全确认只在真正需要用户决策时出现，不能让普通只读查询和低风险本地动作变成学习负担。

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
  -> Natural Command Bridge 识别程序状态查询/控制意图
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

Natural Command Bridge 是 Linghun 的人性化入口，不是模型自由猜测层。它负责把“自动记忆开了吗”“帮我建索引”“缓存命中怎么样”“切到更强模型”等中英文自然语言映射为本地状态查询、等价 slash command 或 Start Gate。模型只负责解释结构化结果；是否能执行、是否需要确认、是否进入权限审批，都由 Linghun 本地 core 裁决。

设计上参考 CCB 的公开行为边界：命令/技能不是要求用户死记固定关键词，而是通过命令目录、description、when-to-use 和工具提示让模型做语义匹配；同时用 disable model invocation、bridge safe allowlist、权限模式和语言偏好把风险压回本地系统。Linghun 要自研一份稳定的 Command Capability Catalog，供 intent router、帮助系统和模型提示共同使用，避免“自然语言入口”和 slash help 两套解释漂移。

分层规则：

- 可自然语言查询：memory、index、cache、model、mode、skills、plugins、hooks、sessions、resume、branch 等状态。
- 可自然语言建议：全部 slash 命令都应能被解释用途和风险。
- 可自然语言确认后执行：索引建立/刷新、模型切换、模式切换、workflow Start Gate、低风险配置变更。
- 不可自然语言直通：写文件、Bash、安装依赖、权限规则变更、长期记忆接受/删除、第三方 plugin/skill enable、force index、hook/job/remote。
- 中英文一致：Command Capability Catalog 必须同时提供中文和英文语义说明；最终回复跟随 language preference 或用户输入主语言。
- 目录预算：模型只看到短摘要和 when-to-use，不加载完整 skill/plugin/hook 内容；长描述截断且稳定排序，避免破坏 prompt cache。

权限和提权交互必须是成品级安全面，而不是后补弹窗：

- Start Gate 是执行门，只确认“是否开始这个动作”；它不替代工具权限审批、配置写入审批、第三方扩展信任确认或远程审批。
- pending gate 必须在 UI 可见，带过期时间，确认时重放 exact command、risk、scope；高风险动作不能只靠普通“确认”直通。
- 权限请求必须展示 exact action、risk、scope、reason、rollback 和 choices，并记录可审计事件。
- `bypass` 必须本地显式 opt-in，不能由模型、自然语言桥、remote channel、workflow、agent、plugin 或 hook 静默开启。
- `auto` 必须依赖可用的本地 classifier/gate；不可用时拒绝或降级，不得默认放行。
- Plan 不是“批准后任意执行”。计划批准至少区分手动确认编辑、进入 acceptEdits 边界、拒绝并反馈；具体写入、Bash、联网、依赖和权限规则仍走权限管道。
- OpenCode 的 expand-collapse 视觉细节可以后置到体验 hardening；但 CCB 手感要求的 primary/details/debug 输出分层、summary-first、pending gate 可见、权限提示人话、doctor 脱敏、长输出落日志、大输出不进 prompt 是 Phase 15 Beta 前安全边界。

覆盖分三批：

- 第一批：状态查询和安全启动门，Phase 15 preflight 必须完成。
- 第二批：开发辅助命令的自然语言发现与确认，Phase 15 preflight 必须纳入 Catalog、用途/风险解释、参数提取、确认门和 focused tests；Phase 15 Beta 只能在 P0-1 到 P0-6 全量闭环后恢复真实项目验证，Phase 15.5 只承接非阻塞 P1/P2 与 release hardening。
- 第三批：高风险命令只解释和审批，不直通；必须保留 Start Gate 和权限管道。

模型请求前可注入短 `RuntimeStatus`，包含 memory/index/cache/model/mode/extensions 的摘要，帮助模型回答当前状态问题；禁止注入完整 memory、完整 transcript、完整索引结果和大日志。

非弱化验收：

- Command Capability Catalog 覆盖所有用户可见 slash 命令，隐藏/内部命令必须显式标记。
- Beta 前必须有真实 slash dispatch 与 Catalog 的 drift test；长期成品应由统一 command registry / manifest 派生 help、router、model summary 和 dispatch，不能靠两份手工清单互相校验。
- 每个能力都有中英文 description 和 when-to-use；模型看到短摘要，用户看到可读说明。
- 自然语言桥支持状态问句、动作祈使句、用途/风险询问、参数提取和低置信度候选。
- 参数提取必须覆盖 mode、workflow、fork/agent role、index action/query、model route/set candidate、branch purpose；低置信度时给候选。
- 中文、英文和同义表达必须落到同一个风险处理路径，不能因为语言不同绕过 Start Gate 或权限管道。
- 如果只能匹配少数固定短句、不能解释所有 slash 命令、不能给出来源真实的 RuntimeStatus，或不能保证 Start Gate / bypass / auto / permission escalation 边界，视为 preflight 未达到进入真实项目 Beta 的硬度。

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
- 没联网或没有新鲜 web evidence，不说“最新版本是”“当前价格是”“社区现在是”。
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
  -> require discover/register/trust/schema loaded for extra or contributed tools
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

Phase 15 Beta 前必须补齐当前真实 TUI 已暴露的 discovery-before-execute 底线：模型或自然语言不得直接执行未发现、未注册、未信任或 schema 未加载的 MCP/plugin/skill/workflow/hook 贡献工具；runtime 必须拒绝并提示先搜索/启用/诊断。Phase 15.5 release hardening 继续扩展到完整 `ExecuteExtraTool`、`MCPTool`、plugin command、skill action、workflow/hook 贡献工具矩阵。prompt 提醒只能辅助，不能替代执行层 guard。

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
| 视觉理解 | Qwen-VL / GLM Vision / Kimi Vision / Claude Vision / GPT Vision |
| 图片生成 | GPT Image / OpenAI-compatible image2 / 本地 ComfyUI |
| 低成本搜索总结 | DeepSeek / 本地模型 |

主力 coding 模型不必同时具备多模态能力。Linghun 应把 vision provider 设计成按需能力补充：检测到图片、截图、设计图或 UI 错位图时，临时调用支持视觉的模型生成结构化观察和 evidence，然后交回当前 executor 继续写代码。当前主模式不被永久切换，例如 DeepSeek V4 Pro 仍负责高频编码，vision provider 只负责“看图”。

图片生成单独走 image provider。它默认是异步后台任务，支持 OpenAI Images / Responses、OpenAI-compatible image2 中转、自定义 HTTP 和本地生图服务。默认不固定尺寸、不长篇扩写提示词，只传用户 prompt 和必要工程约束；生成结果保存到本地资产目录并写入 evidence。

oh-my-openagent 的 team / category routing 可以作为公开交互和验收边界参考：Linghun 吸收“按角色选模型、显示成员贡献、能诊断路由失败”的产品思路，但不复制实现。每次角色路由都必须可审计，记录触发原因、选用模型、fallback、预算和停止条件；角色之间只传结构化摘要、证据、diff、验证结果和必要文件列表，不传完整历史。

第一版只做手动路由：

```text
/agent run explorer --model deepseek-v4-pro
/agent run reviewer --model gpt-5.5
/model route set vision qwen-vl
/model route set image gpt-image-2
/image generate "H5 游戏金色按钮背景"
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
  | { type: 'tool_result'; toolUseId: string; content: unknown; isError?: boolean }
  | { type: 'usage'; usage: ModelUsage }
  | { type: 'message_stop'; reason: string }
  | { type: 'error'; error: LinghunError }
```

业务层不能直接依赖 Anthropic 或 OpenAI 原始事件。

Provider adapter 的成品级验收不能只看“能返回文本”。每个 adapter 都要补齐事件转换、streaming/非流式降级、tool calling 能力声明、usage 映射、prompt cache 字段映射、model metadata、capability doctor、错误归一化、配置诊断和 focused tests。quota / balance query 在 Phase 15 真实项目对账中验证可行性，并在 Phase 15.5 做模型接入成熟度收口；不支持时必须标记 unknown，不能用本地估算冒充真实余额。

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

- 特定稳定工作流下，目标常态缓存命中率：92% - 96%。
- 理想峰值：98%，只作为特定样本峰值，不作为普遍承诺。
- 缓存破坏可定位。
- 成本实时可见。

公开口径必须保守：高命中率是 provider、模型、稳定上下文、工具列表、MCP 稳定化、索引和阶段化工作流共同作用的实测结果，不是任意模型天然保证。账单截图和 CSV usage 可以作为对账证据，但不能宣传固定 25 倍省钱或所有项目必达 98%。

Phase 15 可以参考 CC Switch 的 usage query 思路补齐可选额度/余额对账，但只能参考公开行为和边界：官方订阅能自动查的才标记为 official / oauth reported；第三方中转站、New API、私有服务必须走模板或自定义脚本；查不到时标记 unknown。Linghun 的预算体系必须分成 local limit、provider usage、provider quota 和 billing reconciled 四类，不允许把本地估算伪装成真实余额，也不把不同 provider 的 tokens、credits、requests、interactions、CNY/USD 余额混成一个数字。

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
- project rules hash changed。
- memory hash changed。
- plugin list changed。
- endpoint changed。
- cache write source changed。

展示：

```text
上次缓存破坏：
原因：MCP tools changed (+2/-0)
新增：mcp__x__search
cache read：45231 -> 2108
```

如果 provider 长期返回 `cache_creation_tokens=0`，Linghun 只记录为字段口径：可能是 provider 不计费、不返回或只读已有缓存。缓存是否需要刷新必须看 system prompt / tool schema / MCP tool list / project rules / memory 等 hash 是否变化，而不是看 creation token 是否为 0。

新增命令：

```text
/cache status
/cache warmup
/cache refresh
/stats endpoints
```

`/cache warmup` 和 `/cache refresh` 只表示发起用户可控的最小预热请求，不保证所有 provider 一定写入缓存。

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
- `/stats endpoints`
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

Linghun 产品运行时的项目规则主入口是项目根目录 `LINGHUN.md`。`AGENTS.md` / `CLAUDE.md` 仅作为兼容导入或迁移来源；只有在开发 Linghun 仓库自身或用户明确指定时，才把 `CLAUDE.md` 当作当前仓库的开发规则读取。

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

handoff packet 是跨会话继续工作的成品级契约，必须包含当前阶段、下一阶段、已完成、待处理、禁止事项、Todo、关键文件、变更文件、证据引用、验证结果、风险、索引状态、权限模式、模型/provider、最近提交和预算使用。新会话、自动任务、`/resume`、`/branch`、`/fork` 都只能消费结构化 handoff，不得复制完整历史聊天。

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

Skills / Hooks / Plugins 的成品级边界：

- Skill 默认 summary-first、load-on-demand，不把所有 skill 全文塞进 prompt。
- 第三方 skill / plugin / hook 必须显示来源、版本、路径、权限、信任级别和是否会联网或执行命令。
- 项目级 hook 和 plugin 首次启用前必须经过项目信任确认。
- hook 默认关闭，新手隐藏，不能绕过权限管道。
- workflow 启动前走 Start Gate，内部写入、Bash、联网仍走权限审批。
- plugin / skill / hook 列表和贡献点必须稳定排序，避免破坏 prompt cache。
- 加载失败必须失败隔离，诊断进入 `/plugins doctor` 或 `/doctor hooks`，主会话继续可用。

OpenCode 值得吸收：

- provider 抽象和模型能力表。
- OpenAI compatible / 本地模型 / 多厂商统一路由。
- 配置化、可迁移的项目设置。
- LSP 思路后置吸收，用于更精准的符号理解。
- 插件生态的开放边界，但不牺牲 CCB 风格执行体验。

Warp 值得吸收：

- 命令和输出按 block 组织，用户能扫到状态、耗时、失败和下一步。
- Command Palette 的命令发现手感，但 Linghun 只复用 slash command catalog / 自然语言用途查询，不新增第二套命令注册表。
- workflow / runbook / notebook 的“可复用操作说明”思路，但 Phase 15.5 只做轻量 run block、报告路径和可展开 details，不做云同步工作台。
- block/panel 必须只消费已有事件、evidence、logPath、fullOutputPath、RuntimeStatus 和 Command Capability Catalog；不得额外调用模型、注入 raw details 或破坏 cache prefix。

Hermes 值得吸收：

- MEMORY / USER 分层记忆。
- 成功任务沉淀为可审查 Skill。
- 工作流可进化，但必须用户确认。
- 长期任务和自主能力可控开启，默认关闭。

Hermes 的“越用越聪明”只能吸收为工程化、低成本、可审计版本：

- 默认不每轮学习，不后台偷偷写长期记忆。
- 只在任务完成、验证结束、workflow 收尾、阶段交付或用户明确要求时生成候选。
- 候选优先来自 evidence、Todo、验证报告和 handoff；需要模型总结时走低成本 summarizer role，并有 token 上限。
- 每轮 prompt 只注入少量相关记忆摘要，不能把完整 memory store 或完整 skill 全文塞进上下文。
- 记忆 hash 必须基于稳定摘要，避免破坏 prompt cache。
- `/memory stats` 必须让用户看到记忆数量、注入条数和估算 token，证明学习是在省重复解释，而不是增加负担。

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
- Phase 15.5 必须做 release readiness / open-source readiness 检查：CLI 入口、安装路径、doctor、keychain/密钥脱敏、debug bundle、配置 schema、升级回滚和文档同步都要有明确结论。

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
| Phase 07 | 工程行为控制闭环 | 反幻觉、最小改动、方案完整性闸门、基础 i18n、TUI 渲染稳定性、后台状态反馈、checkpoint/rewind、输入队列与中断 |
| Phase 08 | 代码自检与验证增强闭环 | verifier、验证计划、验证进度、PASS/FAIL/PARTIAL 结果归档、review |
| Phase 09 | 缓存与成本闭环 | cache history、cache break、`/usage`、`/stats`、轻提示 |
| Phase 10 | MCP 与 codebase-memory 外部 CLI 最小闭环 | MCP 面板、索引、索引过期提醒、大文件保护；不代表 codebase-memory 已随包内置、固定版本或免安装 |
| Phase 11 | 会话交接与记忆闭环 | `/resume`、`/branch`、`LINGHUN.md`、handoff packet、跨会话导入 |
| Phase 12 | Agent 闭环 | explorer、worker、verifier、planner、`/fork`、agent transcript |
| Phase 13 | 多模型协作闭环 | planner/executor/verifier 多角色模型、路由与预算 |
| Phase 14 | Skills 与工作流闭环 | Skills、Workflows、Hooks、本地 Plugin 底座；主闭环和 hardening 分段交付，不把 GitHub 安装/插件市场塞进主闭环 |
| Phase 15 | 真实项目测试版 | 先完成 Natural Command Bridge preflight、P0-1 到 P0-6 全量交互硬化、TUI output/report gate 和真实 TUI provider/permission/control-plane smoke，再用真实老项目验证完整开发闭环；命中率是目标观察区间，硬验收是来源、公式、endpoint、诊断和账单/usage 对账 |
| Phase 15.5 | 双模型交叉审查、模型接入成熟度、联网取证成熟度、Bundled codebase-memory Lite、终端 TUI polish 清零与开源前 hardening | GPT-5.5/Claude 做产品架构审查，DeepSeek V4 Pro 做代码安全审查，并补 Solution Completeness Gate 复检、provider adapter/capability doctor/usage-cache/quota/error/fallback/config、Freshness Gate/web_source evidence、随包 codebase-memory 固定版本/doctor/license 降级、参考 Warp/OpenCode/CCB 的轻量 block/panel 终端产品细节、release readiness / open-source readiness；不得把 Phase 15 Beta 已需的基础 TUI 手感留到本阶段；终端开源前 terminal-scope P0/P1/P2 必须清零、降级为 NOT-DO，或证明不属于终端发布范围 |
| Phase 16 | 可控学习闭环 | 越用越聪明，但学习内容可审计、可撤销、可关闭 |
| Phase 17 | 长期托管任务与自动会话 | 分 17A local durable jobs 与 17B remote channels/adapters；17A 先闭合定时任务、自动会话、handoff 校验、预算/暂停、job report 和单阶段自动工作，Remote Channels 与 IM adapter 默认关闭且不阻塞本地 job 底座 |
| Phase 18 | 桌面端预留验证 | 终端成熟后再验证核心可复用到桌面端、IPC/API 边界和安全模型；不承诺立即做完整桌面端，不承担基础 TUI 美化和交互补课 |

Phase 17 的 Remote Channels 只作为 17B 能力，必须在 17A 本地 durable jobs 稳定后开启。Remote Channels 优先使用官方或官方团队开源 CLI 作为 adapter，例如飞书/Lark CLI、钉钉 CLI、企业微信 wecom-cli。Linghun 只把结构化、脱敏的任务摘要、审批和结果报告交给 CLI，不允许外部 CLI 直接读取完整 transcript、memory、API key、账单或项目源码。CLI 缺失、未登录、权限不足、版本不兼容或输出不可解析时，通道保持关闭，并由 `/remote channels doctor` 给出中文修复建议。Remote Channels 不得引入完整 IM SDK、复杂分布式调度、全自动多阶段推进或第二套 agent runtime。

当前进度：

- Phase 00-14 主闭环已完成。
- Phase 14 hardening 已完成：Skills / Workflows / Hooks / Plugins 稳定性、安全边界、缓存 changedKeys 和 workflow 验收已加固。
- Phase 15 preflight 已完成：Natural Command Bridge / 自然语言控制桥已接入 Command Capability Catalog、本地 intent router、RuntimeStatusForModel 与高风险自然语言阻断。
- Phase 15 pre-Beta P0 hardening 已完成并通过 independent verification gate；当时的旧口径是下一步由用户确认启动 Deep Parity Closure 或进入 Phase 15 真实项目 Beta，但该口径已被 2026-05-19 全量审计后的 CCB Maturity Remediation baseline supersede。
- 2026-05-19 Phase 00-18 Design + Runtime Overdesign Full Audit v1/v2 已 supersede 上述“下一步可能进入 Beta”的旧口径。当前唯一执行基线为 `F:\Linghun\PHASE_15_BETA_CCB_MATURITY_REMEDIATION_BASELINE.md`：Phase 15 Beta 继续暂停，历史 P0 hardening / Deep Parity / Runtime Acceptance / Verdict Evidence closure 只作为证据输入，不作为 readiness proof。下一步必须先执行 CCB Maturity Remediation，关闭会话上下文、provider profile contract、tool lifecycle、permission continuation、NCB 降级、TYPE-SHELL 可见面、config/Windows/operational reliability 和真实 report-generation path 验收后，才允许建议恢复真人实测。
- P0 hardening 完成并输出报告后，必须先基于报告决定是否启动 Phase 15 pre-Beta CCB / CCB Dev Boost Deep Parity Closure。该闭环用于确认 Phase 00-14 的实际使用体验、交互细节、建议/提权、错误/doctor/help、自然语言入口、cache/index/memory、多模型和 TUI 基础手感是否达到 CCB / CCB Dev Boost 公开成熟行为的核心体验等价；P0 或阻塞 P1 必须在 Beta 前修复，非阻塞 P2 才能登记到 Phase 15.5。
- Phase 15 preflight 不等于 Phase 15 真实项目 Beta；真实项目完整闭环、provider quota/balance 对账、模型接入成熟度、联网取证成熟度、release readiness 和双模型交叉审查仍必须按 Phase 15 / Phase 15.5 边界执行。终端 TUI 的基础成品手感（主输出分层、权限提示、tool_result 摘要、doctor 脱敏、状态栏准确、hint 去重、阶段汇报）是 Phase 15 Beta 前置 gate；Phase 15.5 承接实测反馈、终端 TUI polish 清零和开源前 hardening，不能把 terminal-scope P2 带过开源发布门。
- Phase 15 preflight 交互审查发现的 Beta 前硬化项必须先闭环：Catalog/dispatch 漂移检测、关键参数提取、pending Start Gate 过期和风险重放、bypass/auto gating、权限提权说明与测试矩阵；这些属于 Phase 15 Beta 前置 hardening，不等于进入 Phase 16+。
- Phase 15 Beta 前和 Phase 15.5 必须启用 Solution Completeness Gate：真实使用暴露跨能力系统性缺口时，先区分单点 bug / 系统性缺口，列影响面、参考源、P0/P1/P2、阶段边界和验证方式，再给修复命令；不能发现一个现象补一个关键词。若系统性缺口涉及“0-14 与 CCB / CCB Dev Boost 使用体验不等价”，必须先做 Deep Parity Closure 决策，不得把 Phase 15 真实项目测试建立在不干净的交互基线上。
- Phase 15 pre-Beta Full Interaction Maturity Audit 已把 Beta 恢复条件升级为 P0-1 到 P0-6 全量闭环：完整 tool_use/tool_result 架构、文件智能指代、新手轻引导和默认 `LINGHUN.md` 模板成熟度、EvidenceSummary 入模型、模型流可取消、en-US 关键提示。P0-1 必须做完整工具协议和权限中枢，不得只做 Read/Grep/Glob 弱化版或模型文本 hint。
- 自动工作默认一次只推进一个阶段；每阶段完成后必须写交付文档、验证结果和 handoff packet。
- 连续阶段模式必须是高级危险开关，默认关闭，只能由本地用户通过高级设置或显式本地命令单独 opt-in；模型、自然语言、agent、workflow、job、hook、plugin 和 remote channel 都不能静默开启。
- 即使连续阶段模式已开启，每个阶段之间仍必须停止在用户审核点，生成独立交付文档、验证结果、handoff packet 和下一阶段确认；普通“继续/确认/yes”不能作为跨阶段授权。
- 自动会话和长期任务必须先校验 handoff packet；缺少验证、证据、禁止事项、索引状态或预算信息时暂停，不继续自动执行。

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

终端 TUI 的基础产品手感不应该后置到桌面端或 Phase 15.5。Phase 15 Beta 前必须达到基础 CCB 手感：真实 provider/model、default 权限不静默高风险工具、控制面本地处理、主输出 summary-first / primary-details-debug 分层、权限提示人话、tool_result 摘要、doctor/key 脱敏、状态栏准确、hint 去重、长输出落日志。Phase 15.5 只做复检、实测反馈修复、terminal-scope polish 清零和开源前 hardening；终端开源前不得遗留 terminal-scope P2。Phase 18 只验证桌面壳、IPC/API 和 core 复用，不负责补基础终端交互。

模型接入成熟度也不应该后置到 Phase 16+。Phase 15.5 必须把 provider adapter、profile、capability doctor、role route doctor、usage/cache 来源、quota/balance 来源、provider error classifier、fallback/retry 审计和配置/key 脱敏收口。OpenAI-compatible 或 Claude-compatible 中转站可以降低接入门槛，但不能被当作能力完全等价的 native provider。

联网取证也必须在 Phase 15.5 收口。Linghun 的反幻觉不是禁止联网，而是“本地证据优先、实时信息请求授权联网、官方来源优先、web_source evidence 记录、失败降级”。用户问最新 release、社区项目现状、provider 文档、模型价格、API 行为、安全公告或政策变化时，未联网不得给确定结论；已联网必须给来源、查询时间和保守结论。

方案完整性闸门也必须在 Phase 15 Beta 前开始生效，并在 Phase 15.5 收口。它不是新功能堆叠，而是工作质量门：当用户连续指出“这不是成品级”“不要缝缝补补”“先看成熟参考怎么做”，或实测暴露同类问题反复出现时，Linghun 必须先判断是否系统性缺口，再决定本轮修 P0/P1、登记 P2 或明确不做。这样既压住模型靠猜，也压住模型只会局部补丁化处理问题。

Phase 15 Beta 前的工具闭环不能弱化。CCB 的可参考成熟点不是“少量只读工具”，而是模型通过真实 tool_use 发起完整工具集、执行层统一走权限中枢、tool_result 回灌模型继续推理。Linghun 必须自研同等边界：核心工具 schema 覆盖 Read/Grep/Glob/Diff/Write/Edit/MultiEdit/Bash/Todo，危险工具继续受 Plan、Start Gate、decidePermission、acceptEdits、auto、bypass 和安全检查约束。

社区项目如 oh-my-openagent 证明 team mode、skills、hooks、角色路由和后台生命周期是有价值的方向，但 Linghun 只吸收公开行为和验收边界：角色可审计、状态表可见、预算可控、失败可诊断、输出摘要化。它们不能替代 Linghun 的 clean rewrite 原则，也不能成为提前堆功能、绕过权限或复制实现的理由。

如果按本文路线执行，Linghun 的第一阶段目标不是堆功能数量超越 CCB，而是在 Phase 15 P0 hardening 后，让真实项目测试的核心编码链路达到 CCB 级可用手感：

- 模型能通过真实 `tool_use` / `tool_result` 使用核心工具，并由统一权限中枢守住写入、Bash、Plan、auto、bypass 和 Start Gate 边界。
- 自然语言状态查询、文件指代、项目规则读取、新手轻引导、取消长任务、中英文关键提示和 EvidenceSummary 入模型必须在真实 TUI 中可实测。
- 中文体验、安装配置、成本可见性、模型中立、反幻觉证据链和 clean rewrite 可维护性应成为 Linghun 的差异化优势。
- Phase 15.5 再补实测期间登记的非阻塞 P1/P2、终端 TUI polish 清零、模型接入成熟度、联网取证成熟度和开源前 release hardening；Phase 15 Beta 已需的基础 TUI 手感不能后置，终端开源发布也不能带 terminal-scope P2。

最终优势应落在：

- 更可维护。
- 更开放。
- 更适合中文开发者。
- 更低成本。
- 更容易从终端走向桌面端。

这才是 Linghun 值得做的地方。
