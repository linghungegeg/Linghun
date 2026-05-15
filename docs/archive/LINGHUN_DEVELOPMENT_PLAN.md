# Linghun 开发设计文档草案

## 1. 项目定位

Linghun 是一个面向中文开发者的 AI 编程助手，核心目标不是做一个普通聊天工具，而是做一个低成本、高命中、强约束、可扩展、适合长期项目开发的工程型 AI 终端。

一句话定位：

> Linghun = CCB 级编码体验 + OpenCode 式多模型开放 + Hermes 式记忆技能 + CCB Dev Boost 式缓存降本 + 中文新手友好。

核心原则：

- 编码能力优先，不能为了花哨功能牺牲修 bug、读代码、改代码的实际效果。
- 默认简单可用，高级能力可选开启。
- 借鉴成熟社区方案，避免自己造不稳定的轮子。
- 先做好终端 TUI，再考虑桌面端 GUI。
- 行为上参考优秀产品体验，代码上坚持 clean rewrite，不复制可疑源码。
- 默认中文友好，同时支持中英文无缝切换。

## 2. 主要目标

### 2.1 必须解决的问题

- 安装部署复杂，新手不会配置。
- 模型容易绕路，容易幻觉，容易过度设计。
- 多模型切换成本高，不知道哪个模型适合当前任务。
- 长项目上下文越来越脏，成本越来越高。
- 缓存命中不可见，用户不知道钱花在哪里。
- MCP、记忆、索引、会话迁移等能力强，但配置门槛高。
- 终端工具缺少桌面端那种会话恢复、项目识别、状态可视化体验。

### 2.2 预期效果

- 新项目首次启动即可用，常用增强功能有向导。
- 常规开发默认走最小改动、先读代码、再修改、后验证的工程流程。
- 支持 DeepSeek、Claude、GPT、Gemini、Ollama 等模型。
- 支持模型能力路由，例如视觉任务交给视觉模型，代码任务交给代码模型。
- 长期项目开发能维持高缓存命中率，并显示 token、费用、节省金额。
- 支持 codebase-memory、AI sessions、搜索、MCP、Skills 等生态能力。
- 支持会话列表、项目历史、继续上次工作。

## 3. 灵感来源与取舍

| 来源 | 保留优点 | 去掉或避免 |
| --- | --- | --- |
| CCB / Claude Code | TUI 体验、原子工具、权限模式、Plan、Agent、缓存结构、命令习惯 | 可疑源码、内部 API 依赖、过度魔改、英文体验不友好 |
| CCB Dev Boost | 缓存保护、索引集成、MCP 稳定化、中文汉化、模型能力表、命中率观测 | 只作为补丁存在、配置分散 |
| OpenCode | 多模型适配、模型无关架构、LSP 思路、开放插件结构 | 如果执行层体验不如 CCB，不照搬 |
| Hermes Agent | 记忆、技能固化、跨会话学习 | 后台过度自治、复杂学习闭环先不做重 |
| MCP 生态 | codebase-memory、AI sessions、搜索、浏览器、数据库等外部能力 | 默认全开、配置复杂、容易挂的服务 |
| Reasonix 类方案 | 缓存稳定、prompt 分层、命中率监控、缓存破坏定位 | 用户看不懂的黑盒优化 |
| 桌面端 AI 工具 | 会话列表、继续工作、配置面板、模型切换、审批模式切换 | 一开始就做大 GUI |

## 4. CCB 审计后必须保留的能力

本节基于 `CODE_AUDIT_REPORT.md` 的 Clean Rewrite 功能对照表整理。Linghun 不是从零发明一个新交互，而是保留 CCB 已被验证的强编码能力，再用 clean rewrite 重新实现。

### 4.1 必须保留

| 能力 | 为什么保留 | Linghun 实现方式 |
| --- | --- | --- |
| CLI 快速启动路径 | 终端工具必须启动快，`--version`、`--help` 不应加载完整系统 | 保留快速路径思想，命令模块拆分 |
| TUI 主交互 | CCB 的沉浸式终端体验是核心竞争力 | 用标准 Ink 重写，不使用 forked Ink 和反编译组件 |
| 流式响应处理 | 编码助手必须边生成边执行、边反馈 | 统一 StreamEvent 协议，所有 provider 适配到同一事件流 |
| Tool 接口和注册表 | 工具调用是编码能力核心 | 用 Zod schema + 权限声明重新设计 |
| Read/Edit/Write/Grep/Glob/Bash | 代码开发最低限度工具集 | MVP 必做，优先打磨稳定性 |
| 权限审批管道 | 保护用户项目和系统安全 | 保留多层决策树，简化实现，plan 强制只读 |
| Plan 模式 | 用户需要先看方案再执行 | MVP 支持，只读约束必须在权限层执行 |
| Agent 子代理 | 多文件探索、验证、并行分析很有用 | 先做手动多 agent，再做路由和自动委派 |
| Agent 生命周期清理 | 子代理会打开 MCP、bash、文件缓存，必须可靠清理 | 生命周期管理器统一注册和释放资源 |
| MCP 集成 | MCP 是生态入口 | 独立 MCP 管理层，失败隔离，工具列表稳定 |
| CLAUDE.md 多层加载 | 项目规则是编码质量关键 | 改名兼容 Linghun，同时支持 AGENTS.md / CLAUDE.md |
| 会话持久化 JSONL | 方便恢复、审计、跨工具交接 | 保留 JSONL 思路，增加项目会话列表 |
| 多 Provider | 用户需要 DeepSeek、Claude、GPT、Gemini、Ollama | 用 Model Gateway 统一能力表和事件适配 |
| 上下文压缩 | 长任务必须有兜底 | 保留 auto compact / manual compact，去掉空壳实现 |
| 提示缓存诊断 | 低成本能力的核心 | 保留 cache break detection、cache history、warning |
| 状态栏 | 用户需要实时知道模型、费用、命中率 | 第一版必须显示模型、项目、模式、命中率、费用 |
| 设置系统多层覆盖 | 用户级、项目级、本地级都需要 | 简化成统一配置，不保留 config/settings 双系统混乱 |

### 4.2 保留设计但必须重写

| CCB 当前实现 | 问题 | Linghun 处理 |
| --- | --- | --- |
| `main.tsx` 大型 Commander 单文件 | 命令集中，难维护 | 命令按文件拆分 |
| `bootstrap/state.ts` 全局单例 | 会话隔离差，状态难测 | Session 类 + 显式依赖 |
| forked `@anthropic/ink` | 维护成本高 | 标准 Ink + 小适配层 |
| React Compiler `_c()` 产物 | 反编译痕迹，不可维护 | 手写 React 组件和 memo |
| `feature()` 内联构建开关 | 受 Bun 限制 | 标准环境变量 + 配置开关 |
| 65+ feature flags | 用户难理解 | 稳定功能、增强功能、实验功能分层 |
| require 条件导入 | 加载顺序脆弱 | 插件注册和依赖注入 |
| build 后字符串替换 | 脆弱 | Vite/Rollup/tsup 插件或标准构建流程 |
| contextCollapse 空壳 | 给人错误安全感 | 要么实现，要么删除 |
| config.json + settings.json | 职责混乱 | 统一配置模型 |

### 4.3 CCB Dev Boost 必须继承

这些是我们在 CCB 上已经验证过的增强方向，Linghun 要作为一等能力重新设计：

- DeepSeek V4 / V4 Pro 1M 上下文能力表。
- codebase-memory-mcp 推荐接入。
- AI sessions 跨工具会话读取。
- MCP 工具列表稳定化，减少 cache 抖动。
- cache 破坏定位器。
- 索引过期提醒。
- 大文件保护和 ignore 规则。
- 最近 20 轮 cache 命中率日志。
- 状态栏显示命中率、token、费用、省钱估算。
- 中文界面和中文新手指引。
- 默认写代码增强预设。

### 4.4 不应该保留

以下内容不进入 Linghun：

- Anthropic 内部 beta header。
- `USER_TYPE === 'ant'` 内部分支。
- 内部服务 URL。
- Anthropic 专有遥测标识。
- GrowthBook / Statsig 内部实验平台依赖。
- 反编译产物和可疑源码结构。
- 默认开启太多实验功能。
- 会让普通用户困惑的远程控制、daemon、LAN pipes 等能力。

### 4.5 社区成熟方案优先

审计报告中提到的可替代方案应优先使用：

- Runtime：Node.js 22+ 优先，Bun 可选。
- Package manager：pnpm。
- Test：Vitest。
- TUI：标准 Ink。
- Schema：Zod。
- 子进程：execa。
- 文件监听：chokidar。
- Glob 匹配：picomatch。
- 搜索：ripgrep + MiniSearch/Fuse.js。
- 构建：Vite / tsup。

## 5. 模型行为控制层

这是 Linghun 区别于普通 AI 编程工具的关键层，用来降低幻觉、减少绕路、避免模型自作聪明。

### 4.1 默认工程模式

默认模式为 strict engineering mode：

- 先理解任务，再读相关代码。
- 优先索引和搜索缩小范围，不全量乱读。
- 默认最小必要改动，不顺手重构。
- 不确定就说明不确定，不编造。
- 修改后必须验证，无法验证必须说明原因。
- 不主动改变公共接口、构建脚本、依赖和架构。
- 超过风险边界时先向用户报备。

### 4.2 能力边界检查

每次任务开始前，系统应判断：

- 当前模型是否支持任务所需能力。
- 是否需要联网搜索。
- 是否需要视觉模型。
- 是否需要代码索引。
- 是否需要多 agent。
- 是否需要用户审批。

如果当前模型无法完成，应明确提示并给出替代方案，例如：

> 当前模型不支持图片理解。可以切换到支持视觉的模型提取图片内容，再交给代码模型继续实现。

### 4.3 简单高效路径

模型默认遵守：

1. 先定位问题。
2. 再读取最少必要文件。
3. 再做局部修改。
4. 再跑最小验证。
5. 最后总结影响和风险。

这会限制模型自由发挥，但不会降低编码能力。它减少的是绕路、幻觉、过度设计和无效消耗。

### 4.4 可切换行为模式

| 模式 | 用途 | 默认 |
| --- | --- | --- |
| strict | 日常开发、修 bug、代码审计 | 是 |
| plan | 只做计划，不写入文件 | 否 |
| acceptEdits | 少审批，自动接受低风险编辑 | 否 |
| autonomous | 自主推进复杂任务 | 否 |
| creative | 产品设计、头脑风暴 | 否 |

## 6. 总体架构

```text
CLI / TUI
  ├─ 输入框、消息流、状态栏、会话列表
  ├─ /config /model /permissions /mcp /stats /sessions
  └─ 中文/英文显示层

Agent Core
  ├─ 对话循环
  ├─ 任务规划
  ├─ 工具调用调度
  ├─ 多 agent 协作
  ├─ 权限审批
  └─ 验证闭环

Behavior Guardrail
  ├─ 能力边界检查
  ├─ 最小改动协议
  ├─ 反幻觉规则
  ├─ 风险分级
  └─ 模式控制

Context & Cache
  ├─ prompt 分层
  ├─ cache_control 管理
  ├─ 命中率记录
  ├─ cache 破坏定位
  ├─ 自动压缩策略
  └─ 大文件保护

Model Gateway
  ├─ Anthropic
  ├─ OpenAI compatible
  ├─ DeepSeek
  ├─ Gemini
  ├─ Ollama
  └─ capability router

Tool & Ecosystem
  ├─ 内置 Read/Edit/Write/Grep/Glob/Bash
  ├─ MCP
  ├─ Skills
  ├─ codebase-memory
  ├─ AI sessions
  ├─ Web search
  └─ LSP
```

## 7. 核心模块设计

### 6.1 TUI 终端界面

MVP 先做终端，不先做桌面端。

必须包含：

- 项目名称显示。
- 当前模型显示。
- 当前权限模式显示。
- 当前缓存命中率显示。
- 当前 token 和费用估算。
- 最近工具调用状态。
- 后台 agent 状态。
- 会话列表和恢复入口。
- 中文命令说明。

推荐命令保留 Claude 风格：

- `/config`
- `/model`
- `/permissions`
- `/mcp`
- `/memory`
- `/sessions`
- `/stats`
- `/compact`
- `/plan`
- `/agents`
- `/features`
- `/doctor`

### 6.2 工具系统

内置工具优先保持原子化：

- `Read`
- `Write`
- `Edit`
- `MultiEdit`
- `Glob`
- `Grep`
- `Bash`
- `Todo`
- `Agent`
- `WebSearch`
- `MCPTool`

工具设计要求：

- 每个工具声明权限等级。
- 每个工具声明是否会写文件、执行命令、联网、访问敏感路径。
- 工具错误必须清晰可操作。
- 工具结果尽量结构化，方便模型稳定使用。

### 6.3 权限系统

权限模式：

| 模式 | 行为 |
| --- | --- |
| default | 常规审批 |
| plan | 只读规划，不允许写入和执行高风险命令 |
| acceptEdits | 自动接受低风险编辑 |
| dontAsk | 尽量少问，但保留高危拦截 |
| bypass | 高权限模式，仅高级用户手动开启 |

高危操作永远需要保护：

- 删除大量文件。
- 修改 `.git`。
- 执行远程脚本。
- 写系统目录。
- 修改密钥配置。
- 运行未知安装命令。

### 6.4 模型适配层

采用统一 Model Gateway，不让业务层直接绑定某一个模型 API。

第一批支持：

- Anthropic Claude
- OpenAI compatible
- DeepSeek
- Gemini
- Ollama

模型能力表必须包含：

- 最大上下文。
- 最大输出。
- 是否支持工具调用。
- 是否支持视觉。
- 是否支持 thinking。
- 是否支持 prompt cache。
- 缓存价格。
- 输入输出价格。

能力不足时必须提示切换模型，而不是硬做。

### 6.5 多模型协作

MVP 不做复杂自动自治，先做可控委派。

典型路由：

- 规划：强推理模型。
- 执行：高性价比代码模型。
- 审查：另一个模型复核。
- 视觉：视觉模型。
- 搜索总结：搜索模型或 web search + 当前模型。

示例：

```yaml
routers:
  planning: claude-sonnet
  coding: deepseek-v4-pro
  review: gpt-5.5
  vision: claude-sonnet
  local_fast: ollama/qwen-coder
```

### 6.6 缓存与成本控制

保留 CCB Dev Boost 的加强方向：

- prompt 分层：静态层、半稳定层、动态层。
- MCP 工具列表稳定化。
- cache 破坏定位器。
- 缓存命中率日志页。
- 最近 20 轮 cache read/write 记录。
- 模型、compact、MCP 变化对缓存的影响记录。
- 大文件保护。
- 索引过期提醒。

状态栏必须显示：

- 当前命中率。
- 最近一轮 cache read tokens。
- 最近一轮 cache write tokens。
- 预估费用。
- 相比无缓存节省金额。

### 6.7 记忆与索引

优先接入成熟方案，不自研大系统。

第一阶段：

- codebase-memory-mcp 作为代码库索引能力。
- AI sessions 作为跨工具会话读取能力。
- 项目内 `LINGHUN.md` 或 `AGENTS.md` 作为项目规则。
- 用户级 `MEMORY.md` 保存稳定偏好。

索引策略：

- 不默认自动重建。
- 检测大量文件变化后提示用户刷新。
- 支持 fast / moderate / full。
- 支持 `.linghunignore` 或复用 `.gitignore`、`.cbmignore`。

### 6.8 MCP 集成

MCP 是开放生态核心，但默认不全部启用。

内置注册但默认可选：

- codebase-memory-mcp
- AI sessions MCP
- web search MCP
- browser MCP
- database MCP

要求：

- MCP 工具列表顺序稳定。
- MCP 启动失败不能拖垮主程序。
- `/mcp doctor` 可以诊断安装、路径、启动失败原因。
- 新手模式只显示推荐项。

### 6.9 Skills 与工作流

Skills 不作为 MVP 的核心阻塞，但需要预留接口。

优先支持：

- 项目规则 skill。
- bug-fix 工作流。
- review 工作流。
- design-to-code 工作流。
- doc-to-code 工作流。
- release-note 工作流。

原则：

- Skill 是可复用流程，不是堆 prompt。
- 成功流程可建议固化为 skill，但不默认自动写入。

### 6.10 联网搜索

涉及最新信息时，系统应主动判断是否需要搜索。

搜索要求：

- 明确来源。
- 避免无来源结论。
- 搜索结果摘要化进入上下文。
- 对高成本搜索有开关。

## 8. 功能开关设计

保留 CCB FEATURE 开关思想，但统一命名、统一展示。

环境变量：

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
LINGHUN_FEATURE_PROACTIVE=0
LINGHUN_FEATURE_AUTONOMOUS=0
LINGHUN_FEATURE_DAEMON=0
LINGHUN_FEATURE_REMOTE_TRIGGERS=0
LINGHUN_FEATURE_LAN_PIPES=0
```

默认开启：

- memory
- search
- mcp
- codebase index
- cache guard
- status dashboard

默认关闭：

- proactive
- autonomous
- daemon
- remote triggers
- lan pipes

`/features` 面板必须显示：

- 当前是否开启。
- 功能用途。
- 可能风险。
- 是否推荐新手开启。

## 9. 配置与安装

目标：

- Windows 友好。
- 不强制装 C 盘。
- 不要求用户手写复杂 JSON。
- 首次启动提供向导。

首次启动询问：

1. 选择语言：中文 / English。
2. 选择默认模型。
3. 是否开启代码库索引。
4. 是否开启 MCP。
5. 是否开启搜索。
6. 是否开启记忆。
7. 是否显示成本状态栏。

配置优先级：

```text
命令行参数 > 环境变量 > 项目配置 > 用户配置 > 默认配置
```

## 10. 会话与交接

必须支持：

- 按项目查看历史会话。
- 继续上次会话。
- 查看最近任务摘要。
- 从其他工具导入上下文。

第一阶段通过 AI sessions MCP 接入：

- Claude 会话。
- Codex 会话。

后续再考虑：

- Cursor。
- Windsurf。
- VS Code 插件。

## 11. 开发阶段规划

### Phase 0：设计冻结与原型验证

目标：

- 完成产品设计。
- 完成技术设计。
- 明确 MVP 边界。
- 选定语言和框架。

产物：

- `PRODUCT_DESIGN.md`
- `TECHNICAL_DESIGN.md`
- `MVP_SCOPE.md`
- `ROADMAP.md`

### Phase 1：TUI 骨架与单模型对话

目标：

- 启动 CLI。
- 显示 TUI。
- 支持输入输出。
- 接入一个 OpenAI compatible 模型。
- 支持基础配置。

验收：

- Windows 可运行。
- 能在项目目录启动。
- 能完成普通问答。
- 状态栏能显示模型和项目名。

### Phase 2：工具系统与权限审批

目标：

- 实现 Read/Edit/Write/Grep/Glob/Bash。
- 实现权限模式。
- 实现工具调用消息流。

验收：

- 能读代码。
- 能改文件。
- 高风险命令会询问。
- plan 模式不能写入。

### Phase 3：工程行为控制

目标：

- strict 模式。
- 最小改动协议。
- 能力边界检查。
- 验证闭环。

验收：

- 模型不会没读代码就乱改。
- 不支持的任务会明确拒绝或建议切换模型。
- 修改后自动建议或执行验证。

### Phase 4：模型网关

目标：

- 支持 Claude、DeepSeek、OpenAI、Gemini、Ollama。
- 支持模型能力表。
- 支持模型切换。

验收：

- `/model` 可查看和切换模型。
- 不同模型的上下文、输出、工具能力显示正确。
- DeepSeek 1M 上下文显示正确。

### Phase 5：缓存与成本面板

目标：

- prompt 分层。
- cache guard。
- 命中率记录。
- 费用估算。

验收：

- 状态栏显示命中率、token、费用。
- 能定位缓存破坏原因。
- MCP 列表稳定不抖动。

### Phase 6：MCP、索引、会话

目标：

- 接入 codebase-memory-mcp。
- 接入 AI sessions。
- 支持 `/mcp doctor`。
- 支持索引过期提醒。

验收：

- 能为当前项目建立索引。
- 新对话能基于索引分析代码。
- 能读取其他工具的会话摘要。

### Phase 7：多 agent 与多模型协作

目标：

- 支持手动多 agent。
- 支持模型路由。
- 支持规划、执行、审查分工。

验收：

- 用户明确要求时才开多 agent。
- 能显示每个 agent 的状态和成本。
- agent 之间输出可合并。

### Phase 8：Skills 与工作流

目标：

- 支持 skill 加载。
- 支持常见工作流模板。

验收：

- `/workflow bug-fix` 可用。
- `/workflow review` 可用。
- skill 不影响普通启动性能。

### Phase 9：桌面端准备

目标：

- 抽离核心引擎。
- TUI 和未来 GUI 共用核心。
- 预留本地 API。

验收：

- CLI 不是所有逻辑的唯一入口。
- 核心 agent 可被桌面端复用。

## 12. 技术选型建议

### 11.1 推荐主方案

| 层 | 推荐 |
| --- | --- |
| 语言 | TypeScript |
| 运行时 | Node.js 优先，Bun 可选 |
| TUI | Ink 或 React Ink 生态 |
| 配置 | JSONC / YAML |
| 模型适配 | 自研 Gateway + 可参考 Vercel AI SDK 思路 |
| MCP | 官方 MCP SDK |
| 桌面端 | Tauri 优先，Electron 备选 |
| 本地数据库 | SQLite |
| 搜索索引 | 先接 MCP，后续再考虑内置 |

### 11.2 为什么不一开始用 Go / Rust 全写

Go / Rust 适合底层性能和分发，但 AI 编程助手的核心复杂度在：

- TUI 交互。
- 模型事件流。
- 工具协议。
- MCP 生态。
- 插件和前端复用。

TypeScript 更适合快速迭代和生态接入。后续需要高性能部分时，再用 Rust/Go 做子模块。

## 13. MVP 范围

第一版必须做：

- CLI/TUI。
- 单模型对话。
- 基础工具系统。
- 权限审批。
- strict 行为模式。
- 模型配置。
- 中文界面。
- 状态栏。
- codebase-memory 接入。
- cache 命中率记录。

第一版不做：

- 完整桌面端。
- 后台 daemon。
- 远程触发。
- 自动长期自治。
- 复杂技能市场。
- 全自动跨工具接管。
- 大而全 LSP。

## 14. 风险与控制

### 13.1 编码能力不如 CCB

控制方式：

- 先复刻体验和工作流，不先堆新功能。
- 工具调用设计必须稳定。
- 每阶段用真实旧项目修 bug 测试。
- 与 CCB Dev Boost 实测对比。

### 13.2 功能过多导致失控

控制方式：

- 默认简单。
- 高级功能开关化。
- 每阶段可运行可验收。

### 13.3 缓存优化影响模型能力

控制方式：

- 缓存只稳定静态和半稳定上下文。
- 动态任务上下文不强行缓存。
- 命中率和输出质量同时观察。

### 13.4 多 agent 浪费 token

控制方式：

- 默认不开。
- 用户明确要求才开。
- 显示每个 agent 成本。
- 支持限制 agent 数量。

### 13.5 MCP 不稳定

控制方式：

- MCP 失败隔离。
- 启动诊断。
- 默认推荐少量成熟 MCP。
- 工具列表稳定化。

## 15. 验收指标

### 14.1 体验指标

- 新用户 10 分钟内能启动并完成一次代码修改。
- 常规修 bug 不需要复杂配置。
- 中文提示清晰。
- 权限模式可理解。

### 14.2 编码指标

- 能完成多文件 bug 修复。
- 能做调用链分析。
- 能正确执行最小改动。
- 能跑验证并解释结果。

### 14.3 成本指标

- 长期同项目开发缓存命中率目标：92% - 96%。
- 理想峰值：98%。
- 状态栏可显示费用和节省估算。

### 14.4 稳定性指标

- MCP 挂掉不影响主对话。
- 索引过期有提示。
- 配置文件不会无界增长。
- 默认不会无限循环调用工具。

## 16. 下一步需要确认的问题

1. MVP 是否确定只做终端，不做桌面端。
2. 默认模型是否以 DeepSeek V4 Pro / OpenAI compatible 为第一优先。
3. 是否把 codebase-memory-mcp 作为第一批内置推荐。
4. AI sessions 是否放进 MVP，还是 Phase 6。
5. 是否保留 Claude 风格命令作为默认命令体系。
6. strict 模式是否作为默认唯一推荐模式。
7. 成本状态栏是否第一版必须做。
8. Skills 是否第一版只预留，不正式做市场。

## 17. 当前结论

Linghun 的开发应以 CCB 的强编码体验为核心，但不要成为 CCB 的补丁集合。正确方向是：

- 用 clean rewrite 降低长期风险。
- 用 CCB Dev Boost 的经验保留高命中和低成本优势。
- 用 OpenCode 思路解决多模型开放。
- 用 Hermes 思路解决记忆和技能沉淀。
- 用行为控制层解决模型绕路和幻觉。
- 用中文友好和简单配置解决新手上手问题。

第一阶段不要追求“大而全”，而是先做一个能在真实项目里稳定修 bug、成本可见、行为可控的 AI 编程终端。
