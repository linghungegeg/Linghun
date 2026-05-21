# Linghun 阶段性交付蓝图

> 目的：防止多开会话、换工具、断网、上下文压缩导致需求丢失。本文档把当前已经讨论清楚的目标拆成可闭环交付阶段。每个阶段完成后必须能验证，不能靠后续“补一补”才成立。

## 0. 总目标

最终交付物是一个可真实测试的 AI 编程终端：

- 中文友好。
- 安装简单。
- Windows 优先可用。
- 终端 TUI 优先打通。
- 编码能力以 CCB/Claude Code 体验为目标。
- 支持 DeepSeek / Claude / GPT / OpenAI compatible / Ollama 等模型。
- 支持 MCP、Skills、代码索引、会话交接。
- 能显示缓存命中率、token、usage 和估算省钱数据；金额只进入 `/usage`、`/stats` 等详情视图。
- 默认严格工程模式，减少幻觉、绕路和过度设计。
- 桌面端从架构上预留，但必须等终端 TUI 成熟、真实项目实测稳定、核心 API 边界清楚后再讨论；当前不提前做桌面产品。
- 项目级数据必须支持项目内存储或指定磁盘路径，不能硬绑 C 盘用户目录。

最终验收不是“功能都写了”，而是：

> 在真实老项目中，Linghun 能完成代码理解、bug 定位、最小修改、验证、成本观测和会话恢复闭环。

## 1. 参考来源清单

### 1.1 本地资料

| 来源 | 路径 | 用途 |
| --- | --- | --- |
| 用户原始想法 | `docs/archive/open-raw-ideas.txt` | 产品目标、中文新手体验、多模型、成本、工作流 |
| CCB 审计报告 | `docs/audit/CODE_AUDIT_REPORT.md` | CCB 核心能力、风险、clean rewrite 对照 |
| 已有 Linghun 草案 | `docs/archive/LINGHUN_DEVELOPMENT_PLAN.md` | 第一轮设计素材 |
| 终版架构路线 | `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md` | 总体架构和路线 |
| CCB 源码 | 本地 `ccb-source` 仓库 | 本地参考实现，不复制代码 |
| CCB Dev Boost 优化记录 | 本地 `ccb-source/docs/ccb-optimizations.md` | 缓存、MCP、索引、中文化、成本观测 |
| Linghun 实现规格书 | `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md` | 模块接口、命令、配置、权限、验证、数据结构 |
| 参考源总表 | `docs/audit/reference-map.md` | 每阶段参考项目、公开地址/本地路径、可参考内容、禁止事项 |

### 1.2 参考项目方向

| 项目/方向 | 地址/来源 | 借鉴 |
| --- | --- | --- |
| CCB / Claude Code Best | 本地 `ccb-source` / GitHub 原项目 | TUI、工具、权限、Plan、Agent、MCP、缓存 |
| CCB Dev Boost | 本地 `ccb-source/docs/ccb-optimizations.md` | 缓存命中、索引保护、MCP 稳定、中文体验 |
| OpenCode | `https://github.com/opencode-ai/opencode` | 多模型开放、provider 抽象、开放生态 |
| Warp | `https://www.warp.dev/` 与公开 docs/blog | 现代终端 block/panel、命令面板、workflow/runbook 交互 |
| Hermes Agent | 公开 Hermes Agent 方向 | 记忆、USER/MEMORY、技能固化 |
| codebase-memory-mcp | 用户本机安装或随包内置，示例命令 `codebase-memory-mcp` | 代码库图索引 |
| AI Sessions MCP | 作为跨 Claude / Codex 会话读取方向 | 会话迁移与继续工作 |
| MCP 官方生态 | MCP SDK / 社区 MCP | 工具生态 |
| Ink | 标准 Ink | TUI |
| Tauri | 桌面端预留 | 后续 GUI |

原则：参考行为、架构和成熟交互，不复制可疑实现。每个后续阶段开工前应查看 `docs/audit/reference-map.md`，确认本阶段的参考源、可参考内容和禁止事项；需要联网核验公开地址时按需联网，不得虚造。

## 2. 全局交付原则

每个阶段都必须满足：

- 有明确产物。
- 有真实验收命令或交互路径。
- 有性能指标。
- 有失败降级。
- 有中文交互文案。
- 不破坏前一阶段能力。
- 不依赖未来阶段才能跑通。

每个阶段结束都必须输出：

```text
阶段完成报告
  - 完成内容
  - 使用方式
  - 测试命令
  - 性能结果
  - 已知限制
  - 是否可进入下一阶段
```

阶段完成报告是给用户和后续开发者接手用的成品级交接，不是调试日志。默认只写用户判断下一步所需的信息；完整 stdout/stderr、tool_result、EvidenceSummary、trace、raw usage、完整索引结果和内部 id 必须进入 transcript、evidence、fullOutputPath、logPath 或 debug/export 入口。报告必须包含：

- verdict：`PASS` / `FAIL` / `PARTIAL` / `CANCELLED`，以及是否允许进入下一阶段。
- scope：本阶段实际做了什么、明确没做什么、是否越出阶段边界。
- changed files：真实改动文件列表，区分代码、测试、文档、生成物和用户已有 diff。
- validation：实际运行的命令、结果、失败原因和未运行原因。
- risk：P0/P1/P2 分类、是否阻断 Beta 或下一阶段、建议处理阶段。
- runtime facts：provider/model、权限模式、索引状态、cache/usage 来源、关键配置来源。
- evidence refs：指向 transcript 事件、验证报告、日志路径、fullOutputPath 或文件路径；不得用泛泛描述替代证据。
- next action：用户可执行的下一步命令或审核点；不得自动推进下一阶段。

成品化闸门：

- 每阶段必须更新 `docs/delivery/phase-XX-*.md`。
- 每阶段必须给出用户可执行的命令或 TUI 操作路径。
- 每阶段必须说明失败时如何降级。
- 每阶段必须说明对缓存、成本、权限和会话的影响。
- 每阶段必须跑最小回归，确认前一阶段核心能力未破坏。
- 阶段产物如果只是内部 API、没有交互路径或验证路径，不算完成。
- 阶段内承诺的用户能力必须在本阶段闭环；允许保留的“后续能力”必须是蓝图中单独列出的后续阶段目标，不能作为当前阶段验收成立的前置条件。
- 阶段交付文档中的“已知限制”只能描述当前阶段边界，不得把当前阶段必做能力推迟到后续补丁。
- 自动工作、agent、workflow、job、hook、remote channel 或模型回复默认只能推进当前用户明确确认的单个阶段；阶段完成后必须停止在用户审核点，输出交付文档、验证结果和 handoff packet，等待用户明确确认下一阶段。
- 连续阶段模式是高级危险开关，默认关闭；必须由本地用户在高级设置或等价显式命令中单独 opt-in，不能由模型、自然语言、agent、workflow、job、hook、plugin 或 remote channel 静默开启。
- 即使连续阶段模式已开启，每个阶段之间仍必须生成独立交付文档、验证结果、handoff packet 和下一阶段确认点；不得把多个阶段合并成无人审核的长链路。

## 3. 外部竞品与防跑偏原则

### 3.1 外面已有相近工具

外部已经有不少 AI 编程工具，Linghun 不能假装自己处在空白市场。

| 工具 | 已有能力 | 对 Linghun 的启发 |
| --- | --- | --- |
| Claude Code / CCB | 强终端编码体验、工具闭环、Plan、Agent、权限 | Linghun 的核心编码体验参考对象 |
| OpenCode | 终端 AI coding agent、auto compact、MCP、LSP、自托管模型、权限快捷键 | 借鉴多模型开放、LSP、配置化和 TUI 交互 |
| Warp | 现代终端 Blocks、Command Palette、Workflows、Warp Drive / notebooks | 借鉴轻量 block/panel、可扫读状态、命令发现和 runbook 组织；不照搬云同步或重 GUI |
| OpenHands | SDK、CLI、Local GUI、REST API、云端/企业版、多模型 | 借鉴 core 与 UI 分离、后续桌面端/服务端预留 |
| Aider | 终端 pair programming、真实 Git 仓库编辑、开发者控制感强 | 借鉴小而稳、Git 工作流和精准编辑体验 |
| Codex / Claude / Cursor 等 | 强模型能力、会话和 IDE 体验 | 借鉴会话恢复、审批模式、开发者体验 |

结论：

> 外面有很多相近工具，但没有一个完全覆盖“CCB 级编码体验 + CCB Dev Boost 降本 + 中文新手友好 + codebase-memory + AI sessions + 可控长期托管”的组合。

Linghun 的机会不是“别人没有 AI 编程工具”，而是：

- 中文开发者友好。
- 低成本透明。
- 缓存命中率可观测。
- CCB 风格强终端体验。
- 多模型开放。
- 项目索引和跨会话交接内置成低门槛能力。
- 可控长期托管，不默认乱跑。

### 3.2 防止自己造轮子

每个模块开工前必须先做“成熟方案检查”：

```text
1. 这个能力外部有没有成熟库或成熟项目？
2. 能不能直接集成？
3. 不能集成时，能不能只借鉴协议/接口？
4. 自研是否会影响核心编码能力？
5. 自研是否会拖慢当前阶段闭环？
```

默认选择：

- TUI：标准 Ink，不自研渲染器。
- Schema：Zod。
- 子进程：execa。
- 文件监听：chokidar。
- 搜索：ripgrep。
- MCP：官方 SDK。
- 代码索引：优先 codebase-memory-mcp。
- 会话导入：优先 AI sessions MCP。
- 桌面端：Tauri 优先。
- LSP：后置，优先成熟 LSP client。

禁止：

- 第一版自研代码图索引。
- 第一版自研终端渲染器。
- 第一版自研技能市场。
- 第一版自研远程控制平台。
- 为了“高级”牺牲工具稳定性。

### 3.3 降本、效率、幻觉控制

这三个指标必须进入验收，而不是宣传口号。

降本靠：

- prompt 分层。
- cache guard。
- MCP 工具稳定化。
- codebase-memory 减少反复 Grep/Read。
- AI sessions 减少重复解释上下文。
- 大文件保护。
- 状态栏显示真实缓存/索引状态；费用只进入 `/usage` 和 `/stats`，并标记 `estimated`。

实测口径：

- CCB 增强工作流 + GPT-5.5 + 稳定项目上下文下，已在 Linghun/老项目开发中观测到长期 90%+ prompt cache 命中，部分阶段汇总可达 97% 左右。
- 该结果不是“GPT-5.5 天然保证高命中”，而是模型缓存能力、稳定 system prompt、稳定 tool schema、MCP 稳定化、阶段化开发、项目索引和记忆共同作用。
- 后续文档和宣传只能表述为“组合工作流实测”，不得表述为任意模型、任意项目都能固定达到该命中率。
- 成本结论必须同时参考本地 usage/cache read-write tokens 与账号账单，不能只看 UI 百分比。

效率靠：

- 核心工具稳定。
- 并行只读工具。
- 索引缩小搜索范围。
- verifier agent 自动复检。
- 会话恢复。
- 工作流模板。

压幻觉靠：

- strict engineering mode。
- 能力边界检查。
- 没读代码不下结论。
- 最新信息必须搜索。
- 修改后验证。
- verifier agent 复核。
- 记忆可审查、可删除、可回滚。

### 3.4 遗漏控制

每个阶段开始前必须检查：

- 是否遗漏 CCB 核心能力。
- 是否遗漏 CCB Dev Boost 增强。
- 是否有成熟社区方案可用。
- 是否会增加新手学习成本。
- 是否会降低编码能力。
- 是否会破坏缓存命中。
- 是否会让模型更容易幻觉。
- 是否会影响后续桌面端复用。
- 是否把项目级数据硬编码到用户目录或 C 盘；如有，必须改为可配置路径。

### 3.5 数据存储与便携性原则

Linghun 不能像部分工具一样把项目记忆、会话和索引强绑到用户目录或 C 盘。成品必须支持：

- 项目级数据优先可放在项目内 `.linghun/`。
- 用户级数据默认放在 `~/.linghun/`，但路径必须可配置。
- 会话、记忆、索引、日志、长期任务数据都必须支持指定磁盘路径。
- Windows 下不能硬编码 `C:`、`C:\Users\...` 或固定用户名。
- 支持便携模式：项目目录迁移到另一台机器后，项目级记忆和阶段上下文仍可随项目走。
- 默认策略必须安全：不会把敏感用户全局记忆误写入项目仓库。
- 任何写入项目内 `.linghun/` 的内容都必须说明是否建议 gitignore。

## 4. 交互设计标准

Linghun 的交互要采用成熟开发语言和 Claude 风格命令，避免自造难懂概念。

### 4.0 启动命令约定

- 项目名使用 `Linghun`。
- CLI 可执行名和文档示例默认使用小写 `linghun`。
- Windows 下必须兼容 `Linghun` 大小写入口，可通过别名、shim 或同名入口实现。
- 所有脚本、README、阶段交付文档优先写 `linghun`，只在兼容说明里写 `Linghun`。
- Phase 01 必须验证 `linghun --version`、`linghun --help` 和 Windows 下 `Linghun --version` 或等价别名。

### 4.1 命令风格

保留用户熟悉的命令：

- `/help`
- `/config`
- `/model`
- `/permissions`
- `/mcp`
- `/memory`
- `/sessions`
- `/resume`
- `/stats`
- `/usage`
- `/compact`
- `/plan`
- `/agents`
- `/features`
- `/doctor`
- `/cache-log`
- `/break-cache`
- `/index`
- `/todo`
- `/rewind`
- `/diff`
- `/review`
- `/branch`
- `/fork`
- `/btw`
- `/background`
- `/workflows`

### 4.2 状态栏风格

第一屏必须能看懂：

```text
main · DeepSeek V4 Pro · strict · cache 94% · index ready · 1 agent
```

状态栏默认只显示能稳定读取、低误导的数据。费用不默认进入状态栏，统一放到 `/usage` 和 `/stats`；只有 provider 返回真实 usage 且模型价格配置明确时，费用才以 `estimated` 标识展示。

### 4.2.1 主输出与汇报口径

Linghun 的终端输出必须参考 CCB 的成熟手感：主屏只放用户当前需要决策或理解的信息，复杂证据保留在底层。输出成熟度是 Phase 15 Beta 前置，不是 Phase 15.5 才补的外观优化。

终端输出分三层：

- `primary`：默认展示。只包含短摘要、当前动作、关键风险、下一步、确认选择和最终结果。
- `details`：用户显式展开或运行详情命令后展示。包含证据摘要、影响文件、验证命令、日志路径和诊断来源。
- `debug`：只在 doctor/debug/export 或交付证据中出现。包含 requestId、gateId、raw risk flags、schema 摘要、hash、raw usage、完整 stdout/stderr 路径等。

成品级要求：

- 权限提示必须是 human-first decision prompt，不得在主屏展示 `risk=start_gate`、`readonly=no`、`permissionPipeline=false` 这类内部字段。
- Read/Grep/Glob/Todo/Bash/agent/index 的长输出必须截断；完整内容写入 transcript/evidence/fullOutputPath/logPath，并在主屏给出路径或详情入口。
- Bash 成功时默认显示命令意图、exitCode、短结果和完整日志入口；失败时显示关键错误、exitCode、可能原因和下一步建议。
- model doctor、MCP doctor、plugin/skill/hook/workflow doctor 必须 summary-first；API key、token、完整 header、私有 baseUrl 参数不得原文出现。
- tool_result、EvidenceSummary、handoff packet、index raw result、cache raw key 和 provider raw usage 不得污染普通 assistant 主文本。
- cache/index/status/hint 只在有行动价值时出现；同一 warning 不得每轮重复刷屏。
- zh-CN 与 en-US 必须语义等价；不能中文成品化、英文只剩命令用法。
- 窄终端、Windows Terminal、中文路径、长模型名、连续工具输出和多行粘贴必须有 smoke 或 snapshot 覆盖。

### 4.3 权限交互

权限提示必须说人话：

```text
将要修改 1 个文件：src/app.ts
风险：低
原因：工作区内普通代码编辑
选择：允许一次 / 永久允许此类编辑 / 拒绝
```

权限交互不是一个弹窗文案，而是 Linghun 压住模型越权和用户误触的核心产品层。所有需要提权、写配置、写文件、运行 Bash、启用第三方扩展、切换高权限模式或启动长期任务的路径，都必须有一致的提权说明：

- 明确展示 exact action：等价 slash command、工具名、目标文件/目录、将变更的配置键或将启动的任务。
- 明确展示 risk：只读、写配置、写文件、Bash、联网、依赖安装、权限规则、长期记忆、第三方扩展、远程通道等风险类型。
- 明确展示 scope：当前项目、用户级配置、系统 keychain、远程通道、agent/job、索引/cache 状态等影响范围。
- 明确展示 reason：为什么需要这个权限、是否来自自然语言桥、workflow、agent、hook、plugin、remote channel 或用户显式 slash command。
- 明确展示 rollback / recovery：可用 `/diff`、checkpoint、配置回滚、禁用扩展、取消 job、删除候选记忆等方式。
- 明确展示 choices：允许一次、按当前 session 允许、按当前项目允许、拒绝、带反馈拒绝；高风险操作默认不提供永久允许，除非用户进入高级设置并明确 opt-in。
- 权限决策必须写入 transcript 或审计事件，包含 requestId、来源、风险摘要、decision、reason 和时间。

自然语言桥、workflow、agent、plugin、hook、remote channel 只能生成权限请求，不能绕过权限管道。提权请求必须能被用户看懂，也必须能被测试读取；不能只在模型回复里“建议一下”。

权限模式必须有清晰边界。2026-05-21 pre-smoke 基线要求用户可见权限模式收口为四个 canonical modes：

- `default`：默认审慎模式；展示风险摘要后按规则执行，写入、Bash、联网、依赖、权限、第三方扩展、越界路径、hook/job/remote 仍走权限管道。
- `auto-review`：低风险工作区编辑可减少审批；它合并历史 `acceptEdits` 与受本地 gate 限制的 `auto`，但不得自动通过 Bash、联网、依赖、权限、第三方扩展、越界路径、hook/job/remote。
- `plan`：只规划，不写文件，不运行高危命令；退出 plan 必须经用户确认。
- `full-access`：高权限模式；历史 `bypass` 的用户可见新名，必须本地显式 opt-in，不能由模型、自然语言桥、remote channel、workflow、agent、plugin 或 hook 静默开启；硬拒绝和安全路径仍优先。

Legacy compatibility：`acceptEdits` -> `auto-review`，`auto` -> `auto-review`，`bypass` -> `full-access`，`dontAsk` -> `default` 或只作为 legacy alias。旧名称只能出现在迁移、历史证据、兼容提示或测试覆盖中，不得继续作为用户可见主路径。

Plan 交互必须参考 CCB 的公开行为边界但自研实现：进入 plan 要清晰说明“只规划不执行”；计划完成后至少要支持“批准计划但手动确认编辑”“批准计划并进入 auto-review 边界”“拒绝并继续讨论/反馈修改”三类决策。批准计划不等于授权所有后续工具，具体写入、Bash、联网、依赖和权限变更仍要走权限管道。

Architecture Runtime 是 Phase 15 pre-smoke 必须拉入的底层工程判断能力：它不是第五个权限模式、不是 Plan Mode、不是 skill、不是 prompt-only 文案；它与 Anti-Hallucination Runtime 协作，后者负责 facts/evidence/source/boundaries，前者负责工程方向、技术选择、拆解、风险、验证路线和长期可维护性。最小成熟版本必须能在跨模块、公共接口、依赖/配置、架构取舍或系统性缺口任务中隐式触发，避开 typo/单行修复/纯状态查询等小任务，并输出短 Architecture Card：target、project facts、recommended approach、rejected approaches、staged breakdown、risks、verification、non-goals。后续执行若偏离 Architecture Card 的 recommended approach 或 non-goals，必须提示 drift 并重新确认或更新 card。

Architecture Runtime v1 必须保持轻量：只作为普通对话链路前的工程判断 guard，不新增 agent、ADR 数据库、完整 spec 平台或强制计划模式。实现边界以四个函数级能力为主：`shouldTriggerArchitectureRuntime`、`collectArchitectureFacts`、`formatArchitectureCard`、`detectArchitectureDrift`。触发规则以任务形态为主，关键词只辅助；输出默认一屏内，默认给一个成熟推荐方案，只在预算、部署偏好、业务约束、合规或用户偏好无法从项目事实判断时提问。

Architecture Runtime 的 facts 也必须服从反幻觉和 Freshness Gate：项目事实优先来自 README、package/config、当前代码风格、索引、evidence 和工具结果；涉及最新版本、provider/API 当前行为、社区项目现状、模型价格、安全公告、部署平台规则或第三方方案对比时，必须按需联网取证并写入 `web_source` evidence。未授权联网、联网失败或来源冲突时，只能写 unknown / stale 并给下一步，不得把模型记忆或本地旧资料写成当前事实。

Architecture Runtime 的持久化边界必须同样轻量：允许 transcript `system_event`、短 `evidence_record` 和 handoff latest 中的 `currentArchitectureCard` 摘要；不得新增 ADR/DB/长期 memory，除非用户明确接受。后续执行若新增未写入 card 的依赖/配置、扩散到未提及模块、跳过 verification、违反 non-goals 或把 unknown/stale 当确定事实，必须提示 drift 并重新确认或更新 card。Batch C 的验收以 focused tests 证明触发/非触发、card 完整性、Freshness 边界、drift 检测以及不改变权限模式/不绕过 Start Gate/permission/Plan 为准。

### 4.4 模型能力不足

不能假装能做：

```text
当前模型不支持图片理解。
可以配置 vision provider 临时提取图片内容，再继续交给当前主模型写代码。
```

成品行为：

- 不要求主力 coding 模型本身支持多模态。
- 当用户输入图片、截图、设计图或 UI 错位图时，Linghun 应按需调用已配置的 vision provider。
- vision provider 只负责 OCR、截图理解、UI 区域识别和结构化观察，不负责写代码。
- 视觉结果必须写入 evidence / transcript，并交回当前 executor 模型继续开发。
- 当前主模式不被永久切换；例如 deep 模式下仍由 DeepSeek V4 Pro 执行代码，vision provider 只是临时能力补充。
- 未配置 vision provider 时，必须提示用户配置或切换支持视觉的模型，不能假装看懂图片。

### 4.5 新手模式

新手默认只看到推荐项：

- 推荐模型。
- 推荐索引。
- 推荐 MCP。
- 推荐权限模式。
- 缓存/usage 统计。
- `LINGHUN.md` 项目规则。

高级配置隐藏到 `/config advanced`。

降低学习成本不能降低功能完整性。Linghun 必须采用渐进披露：

- 默认首屏、状态栏、`/help` 和轻提示只展示当前最可能需要的短路径，让新手能直接开始真实开发。
- 完整能力必须可发现：`/help all`、`/features`、`/config advanced`、doctor 详情和自然语言“你能做什么 / 这个怎么用 / 有什么风险”必须能找到高级能力、风险边界和下一步命令。
- Slash command 是精确入口，不是学习门槛；常见状态查询、项目规则、索引、缓存、模型、验证和恢复路径必须支持自然语言进入成熟路径。
- 高级能力默认隐藏或关闭，但不能残缺：Agent、Workflow、Skills、Plugins、Hooks、Jobs、Remote Channels 必须在开启后有完整 doctor、权限、审计、关闭和失败降级路径。
- 安全提示只在真正需要决策时出现；只读查询和普通本地低风险动作不得被长审批文案淹没。
- 帮助必须按任务组织，而不是只按命令表组织；用户应能从“我要看项目 / 改代码 / 跑验证 / 查成本 / 恢复会话 / 开 agent / 诊断配置”找到对应能力。
- 任何新增功能都必须同时说明：新手默认是否展示、如何自然语言发现、对应 slash 精确入口、风险等级、如何关闭、是否影响缓存/成本/权限。

### 4.6 CCB / Claude Code 关键体验补齐

这些不是“锦上添花”，而是强编码手感的一部分，后续阶段必须逐步落地：

| 体验 | 要求 | 阶段 |
| --- | --- | --- |
| Todo / 任务列表 | 长任务必须能显示当前步骤、已完成项、阻塞项 | 阶段 5 |
| diff 审阅 | 写入前后能看到改动摘要，默认模式可确认应用 | 阶段 5-6 |
| 权限规则持久化 | allow/ask/deny 和最近拒绝记录可查看、可删除 | 阶段 6 |
| 快捷模式切换 | Shift+Tab 或等价快捷键切换 default/auto-review/plan/full-access；旧 acceptEdits/auto/bypass/dontAsk 只作 legacy alias | 阶段 6 / Phase 15 pre-smoke Batch A 收口 |
| Checkpoint / rewind | 关键写入前创建检查点，支持回到上一安全点 | 阶段 7 |
| 输入队列与中断 | 粘贴、多轮输入、Esc/Ctrl+C 不能打乱会话状态 | 阶段 4-7 |
| TUI 渲染稳定性 | 主消息、后台任务、系统事件、输入框、状态栏分区渲染，不重复、不残影、不混排 | 阶段 7 前置 |
| 后台任务状态反馈 | 长命令、verification、agent、job 必须显示当前步骤、进度、heartbeat、日志和结果 | 阶段 7 / 8 / 12 / 17 |
| 后台任务 | 长命令、agent、job 可折叠、查看、恢复、中断 | 阶段 12 / 17 |
| 临时插问 | 类 `/btw` 小问题不打断主任务上下文 | 阶段 11 |
| 命令别名兼容 | 保留 Claude 风格 slash 命令，新增能力也要有中文说明 | 阶段 4 起 |
| 自然语言控制桥 | 常见状态查询和安全控制可用自然语言触发，由本地 intent router 裁决，模型只负责解释 | 阶段 15 preflight |
| 语言跟随设置 | 用户设置中文则中文输出，设置 English 则英文输出；slash 命令和 transcript 字段保持英文 | 阶段 7 前置 |
| resume / branch / fork | 恢复历史、分支试验、派生子会话或 agent | 阶段 11 / 12 / 17 |
| review / diff / usage / stats | 审查、改动摘要、原始 usage、综合统计 | 阶段 5 / 8 / 9 |
| workflows | 修 bug、审计、重构计划、发布检查等标准流程模板 | 阶段 14 |
| IDE 上下文 | 当前打开文件、选区、诊断和 Git diff 只读进入上下文 | 阶段 18 前完成预留 |
| Hooks | PreToolUse、PostToolUse、Stop、Notification 等高级自动化 | 阶段 14 / 17 |
| 轻提示 | 上下文、索引、缓存、风险、LINGHUN.md 缺失等非打断提示 | 阶段 9 / 10 / 11 |

### 4.7 任务启动确认 / Start Gate

Linghun 必须区分“讨论中”和“执行中”。当用户只是咨询、评估、提出想法、问是否要做、要求设计方案或比较风险时，不得自动进入写文件、跑高成本命令、启动 agent/job/workflow 的执行状态。

进入实际任务前，必须轻量确认：

```text
我理解这是一个新增任务。是否现在开始执行？
1. 开始
2. 先不要，只继续讨论
```

可以直接开始的情况：

- 用户明确说“开始做”“直接改”“写进去”“推送”“运行测试”“删除这个目录”等。
- 只读查询和低风险定位，例如 `rg`、`git status`、读取少量相关文件。

不能跳过 Start Gate 的情况：

- 多文件修改。
- 阶段开发。
- 自动任务、长期任务、agent、workflow。
- 联网安装、依赖变更、构建发布、数据迁移。
- 写入文档、代码、配置但用户尚未明确授权。

Start Gate 不替代权限审批。用户同意开始任务后，具体高风险工具调用仍必须走权限/风险管道。

Start Gate 必须是 modal-like 的执行门，而不是普通聊天文本。进入 Start Gate 后，系统必须记录 pending gate，并在状态栏或 footer 显示有待确认操作。用户输入非确认内容时默认取消或要求重新选择，不能把过期的确认门悄悄留到后面。

Start Gate 记录必须包含：

- gateId、createdAt、expiresAt。
- 来源：natural command、slash command、workflow、agent、plugin、hook、remote channel 或用户直接请求。
- exact command 或 structured action。
- capability id、risk、scope、预算、输出/日志路径、取消方式。
- 是否需要进入权限管道、是否写配置、是否写文件、是否 Bash、是否联网、是否第三方扩展。

确认规则：

- 低风险 Start Gate 可以接受 `确认` / `yes`。
- 写配置、stateful refresh/init、权限规则、`full-access` 切换、legacy `bypass` alias、第三方 skill/plugin enable、记忆接受/删除、rewind restore、Bash、依赖安装、remote/job/hook 类高风险动作，不能只靠普通“确认”直通；必须要求用户输入 exact command、选择明确选项，或进入权限管道。
- pending gate 必须短时间过期，过期后用户需要重新发起请求。
- 确认时必须重放 exact command、risk 和 scope，避免用户忘记刚才确认的是什么。

### 4.8 自然语言控制桥 / Natural Command Bridge

Linghun 不能只依赖 slash 命令。真实用户会直接问“自动记忆开了吗”“帮我建索引”“缓存命中怎么样”“切到更强模型”。这些请求必须基于本地真实状态回答或进入安全确认门，不能让模型凭印象泛泛回答。

自然语言控制桥是成品级交互层，不是简单同义词补丁：

```text
用户自然语言
  -> 本地 Intent Router 判断是否为程序状态查询/控制请求
  -> 命中后读取本地状态或映射到等价 slash command
  -> 模型只负责把结构化结果解释成人话
  -> 高风险动作仍走 Start Gate 和权限管道
```

原则：

- 底层负责判断、读取真实状态和执行安全命令；模型不能凭空猜当前开关、索引、缓存、记忆或权限状态。
- slash 命令仍是精确入口；自然语言是可发现、可解释、可确认的桥接层。
- 只读查询可以直接返回本地真实状态摘要。
- 配置变更、索引、cache warmup/refresh、workflow、agent、skill/plugin enable 等必须进入确认门。
- 写文件、Bash、安装依赖、权限规则修改、hook/job/remote 等高风险动作必须继续走权限管道。
- 自然语言桥不得绕过 Start Gate、Plan、权限审批、验证闭环或阶段边界。
- prompt 只能注入短 RuntimeStatus 摘要，不得注入完整 memory、完整 transcript、完整索引结果、完整 plugin/skill/hook 日志。

自然语言控制桥必须参考 CCB 的“命令/技能目录给模型做语义匹配”的方向，但不能复制实现。CCB 的可参考行为边界是：命令/技能有 description、when-to-use、是否允许模型调用、用户可见说明、桥接/远程安全 allowlist 和语言偏好提示；模型看到的是短目录摘要，真正执行仍由本地命令系统和权限系统裁决。Linghun 应维护一份稳定的 Command Capability Catalog：每个命令声明 `id`、slash 入口、中文说明、英文说明、whenToUse、risk、是否只读、是否允许模型建议调用、是否需要 Start Gate、是否会写配置、是否会触发权限管道、是否允许远程/桥接入口。模型和 intent router 都消费这份目录，而不是靠零散关键词。

用户不需要按固定关键词触发。下面的中文/英文只是验收样例，真实实现必须做语义识别：

| 能力域 | 中文自然说法示例 | English examples | 等价能力 | 风险处理 |
| --- | --- | --- | --- | --- |
| memory | 自动记忆开了吗、记住了什么 | is memory on, what do you remember | `/memory`、`/memory review`、`/memory storage` 摘要 | 只读直接回答 |
| index | 索引好了没、帮我建索引 | is the index ready, build the index | `/index status`、`/index init fast`、`/index refresh` | 查询只读；建立/刷新走 Start Gate |
| cache | 缓存命中怎么样、为什么 cache 变了 | cache hit rate, why did cache change | `/cache status`、`/break-cache status` | 只读直接回答 |
| model | 当前什么模型、切到更强模型 | current model, switch model | `/model`、`/model doctor`、`/model set`、`/model route doctor` | 查询只读；切换需确认 |
| mode / permissions | 当前权限模式、切 plan mode | current mode, switch to plan mode | `/mode`、`/permissions`、`/permissions recent` | 查询只读；切换/写规则需确认或权限管道 |
| workflow | 有哪些工作流、开始修 bug 流程 | list workflows, start bug fix workflow | `/workflows`、`/workflows <name>` | workflow 只进 Start Gate |
| extensions | 有哪些 skills/plugins、hook 开了吗 | list skills/plugins, are hooks enabled | `/skills`、`/plugins`、`/plugins doctor`、`/doctor hooks` | 查询只读；enable 第三方需确认和权限摘要 |
| sessions | 恢复会话、开个分支试试 | resume session, create a branch session | `/resume`、`/branch`、`/sessions` | resume 只读；branch 生成 handoff 摘要 |

覆盖分三批，不允许做成后续缝补：

1. **第一批：状态查询和安全启动门**  
   Phase 15 preflight 必须完成。覆盖 memory、index、cache、model、mode、workflow、skills、plugins、hooks、sessions、resume、branch。目标是让真实用户接入模型后，不必记 slash 命令也能查看 Linghun 状态和进入安全启动门。

2. **第二批：开发辅助命令的自然语言发现与确认**  
   Phase 15 preflight 必须先完成 Catalog 覆盖、自然语言发现、用途/风险解释、参数提取、确认门和 focused tests；P0-1 到 P0-6 全量闭环前不得进入 Phase 15 Beta。Phase 15.5 只承接非阻塞 P1/P2 和 release hardening。覆盖 read/grep/glob/todo/verify/review/diff/fork/agents 等。自然语言可以发现、解释、建议和进入确认门；涉及 agent/fork/verify 长任务时必须显示范围、预算、输出和取消方式。

3. **第三批：高风险命令只解释和审批，不直通**  
   write/edit/multiedit/bash/permissions add/remove/mode full-access/legacy mode bypass alias/cache refresh/index force/skills enable/plugins enable/memory accept/delete/rewind restore/hook/job/remote 不能被自然语言直接执行。自然语言只能生成“我理解你要做 X，风险是 Y，是否继续”的 Start Gate 或权限请求。

成品级非弱化要求：

- Phase 15 preflight 不能只覆盖几个演示短句；必须从现有 slash command 注册表生成或校验 Command Capability Catalog，保证新增命令不会遗漏用途/风险说明。
- Catalog 不能只是“硬编码列表 A 对硬编码列表 B”。Beta 前必须至少做到真实 slash dispatch 可执行命令与 Catalog metadata 的自动漂移检测；成品版应由统一 command registry / manifest 派生 help、router、model summary 和 dispatch。
- 每个能力至少有三类自然语言验收：状态问句、动作祈使句、用途/风险询问；中文和英文都要覆盖。
- 状态类回答必须附带来源，例如 RuntimeStatus、本地 slash handler 或本地状态函数；不能只输出模型自我介绍或泛泛产品说明。
- 对同一意图的不同说法必须得到一致风险处理，例如“帮我建索引”“初始化索引”“build the index”都只能进入同一个索引 Start Gate。
- 参数化意图必须能提取常见参数，例如 workflow 名称、model 名称、mode 名称、branch 目的；低置信度时给候选而不是猜。
- Phase 15 preflight hardening 必须补齐关键参数提取：mode、workflow、fork/agent role、index action/query、model route/set candidate、branch purpose；不能把所有自然语言动作都退化成泛化 slash command。
- pending natural confirmation 必须有过期、风险重放和高风险精确确认；自然语言确认不能替代权限审批。
- `full-access` 和 `auto-review` gating 是 Beta 前硬边界：`full-access` 必须本地 opt-in；`auto-review` 必须检查本地 gate/classifier 可用，不可用时拒绝或降级；legacy `bypass` / `auto` alias 必须先 normalize。
- OpenCode 风格输出组织可以作为后续体验 hardening，但 pending gate 可见性、summary-first、大输出不进 prompt 是 Beta 前边界。
- 未实现或被阶段禁止的能力必须明确说明边界和下一步，而不是假装执行或悄悄降级。
- 交付文档必须列出自然语言覆盖矩阵、未覆盖命令、被禁止直通命令、误识别/低置信度处理和中英文 smoke 结果。

阶段要求：

- Phase 15 真实项目 Beta 前必须先做 Natural Command Bridge 第一批完整闭环，作为 Phase 15 preflight。
- Phase 15 preflight 完成后，如果交互审查发现 Catalog 漂移、参数提取不足、Start Gate 风险确认不足、`full-access` / `auto-review` gating 或 legacy alias normalization 不完整、测试矩阵不足，必须先做 Phase 15 preflight hardening；这仍属于 Phase 15 Beta 前置，不等于进入 Phase 15 Beta 或 Phase 15.5。
- Phase 15 preflight 不是固定关键词补丁；必须基于 Command Capability Catalog 做中英文语义识别。
- Command Capability Catalog 必须区分用户可见说明和模型可见短摘要；长描述要预算截断，稳定排序，避免破坏 prompt cache。
- 语言偏好必须进入自然语言桥：中文用户用中文解释，英文用户用英文解释；代码标识、命令名和 provider/model id 保持原文。
- 所有 slash 命令都必须能被自然语言询问“这个能做什么/怎么用/风险是什么”，但不是所有命令都能自然语言直接执行。
- 未命中的普通问题仍走普通模型对话，但模型请求前必须带短 RuntimeStatus，让模型知道当前 memory/index/cache/model/mode 的真实状态。
- 如果实现只做硬编码关键词、只覆盖中文、只覆盖第一批演示句、或无法解释所有 slash 命令用途/风险，则 Phase 15 preflight 不算完成，不能进入 Phase 15 真实项目 Beta。

## 5. 阶段 0：设计冻结与基线确认

### 目标

把路线定死，防止后续开发反复改方向。

### 输入

- `docs/archive/open-raw-ideas.txt`
- `docs/audit/CODE_AUDIT_REPORT.md`
- `ccb-optimizations.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`

### 产物

- `docs/architecture.md`
- `docs/mvp-scope.md`
- `docs/references.md`
- `docs/interaction-standard.md`
- `docs/acceptance.md`

### 必做

- 明确 MVP 包含和不包含。
- 明确目录结构。
- 明确模型网关接口。
- 明确工具接口。
- 明确权限模式。
- 明确缓存指标。

### 验收

- 所有后续阶段能追溯到本文档。
- 没有“以后再说”的核心底座问题。

## 6. 阶段 1：工程骨架闭环

### 目标

建立可持续开发的 monorepo。

### 技术选择

- TypeScript。
- Node.js 22+。
- pnpm。
- Vitest。
- Biome。
- tsup 或 Vite。

### 参考

- CCB 的 workspace 思路：本地 `ccb-source/package.json`
- 审计报告中推荐：Node.js + pnpm + Vitest + Biome

### 产物

```text
apps/cli
packages/core
packages/shared
packages/config
packages/tui
packages/providers
packages/tools
```

### 必做

- `linghun --version`
- `linghun --help`
- Windows 下 `Linghun --version` 兼容入口。
- 配置目录创建。
- 日志系统。
- 错误类型。
- CI 脚本。

### 性能要求

- `linghun --version` 小于 300ms。
- `Linghun --version` 兼容入口应与 `linghun --version` 行为一致。
- 不加载模型、不加载 MCP、不启动 TUI。

### 验收

```text
pnpm install
pnpm test
pnpm build
linghun --version
linghun --help
Linghun --version
```

本阶段完成后必须能发布一个空壳 CLI。

## 7. 阶段 2：Session 与会话持久化闭环

### 目标

先解决 CCB 审计里最大风险：全局状态。Linghun 从一开始就用 Session。

### 参考

- CCB 问题来源：`src/bootstrap/state.ts`
- CCB 会话持久化：`src/utils/sessionStorage.ts`

### 产物

- `Session` 类。
- `SessionStore`。
- JSONL transcript。
- 项目识别。
- 会话摘要字段。

### 必做

- 每个会话独立 id。
- 每个项目独立历史。
- 会话可恢复。
- 会话可列出。
- 会话存储路径必须通过配置 helper 获取，不允许业务代码硬编码 C 盘。
- Phase 02 必须完整落地默认用户数据目录：`~/.linghun/data/sessions`。
- Phase 02 不要求暴露用户可配置数据目录；完整 StorageConfig、`LINGHUN_DATA_DIR`、项目内/自定义磁盘路径切换属于 Phase 11 的成品验收，不能影响 Phase 02 的会话创建、列出、恢复闭环。

### 交互

```text
/sessions
/sessions resume
/sessions summary
```

### 性能要求

- 读取最近 100 个会话小于 500ms。
- 单会话 append 不阻塞 UI。

### 验收

- 新建会话。
- 发送 3 条消息。
- 退出。
- 重新进入。
- `/sessions` 能看到并恢复。
- 会话路径来自配置 helper，代码中没有硬编码 C 盘或固定用户名。

## 8. 阶段 3：模型网关最小闭环

### 目标

先打通 OpenAI compatible / DeepSeek，让终端能真实对话。

### 参考

- CCB OpenAI 路径：`src/services/api/openai`
- CCB Provider 判断：`src/utils/model/providers.ts`
- CCB model capabilities：`src/utils/model/modelCapabilities.ts`

### 产物

- `Provider` 接口。
- `ModelGateway`。
- `LinghunEvent` 统一事件流。
- DeepSeek 模型能力表。
- OpenAI compatible 配置。

### 必做

- 支持 base_url。
- 支持 api_key。
- 支持 model。
- 支持流式文本。
- 支持 usage 记录。
- 支持最大输出限制。

### 交互

```text
/model
/model set deepseek-v4-pro
/model doctor
```

### 性能要求

- 首 token 延迟可显示。
- 流式输出不卡 TUI。

### 验收

- 用 DeepSeek / OpenAI compatible 完成普通问答。
- 模型名、上下文、输出上限显示正确。
- 断网或 key 错误时错误可读。

## 9. 阶段 4：TUI 成品骨架闭环

### 目标

先把终端体验打通成“能用的产品”，不是裸 CLI。

### 参考

- CCB TUI 结构：`src/screens/REPL.tsx`
- CCB 状态栏：`src/components/StatusLine.tsx`
- 标准 Ink。

### 产物

- 消息列表。
- 输入框。
- 底部状态栏。
- 命令面板。
- 中文 UI。
- 主题基础。

### 必做

- 显示项目名。
- 显示当前模型。
- 显示权限模式。
- 显示缓存、索引、agent 数量等稳定占位。
- 支持 Ctrl+C / Esc。
- 支持命令输入。
- 支持长文本粘贴和输入队列，不重复发送、不重复渲染。
- 命令面板能展示别名和中文说明。

### 交互

```text
main · model · mode · cache -- · index --
```

### 性能要求

- 普通输入无明显卡顿。
- 长消息渲染不重复。
- 终端 resize 不崩。

### 验收

- Windows Terminal 下连续对话 20 轮。
- 粘贴中文路径、中文问题正常。
- 粘贴多行内容不会拆成多次误发送。
- Esc/Ctrl+C 能中断当前流式输出或长任务，不破坏会话。
- 状态栏持续更新。

## 10. 阶段 5：核心工具闭环

### 目标

让 Linghun 真正具备编码能力。

### 参考

- CCB Tool 接口：`src/Tool.ts`
- CCB 工具执行：`src/services/tools/toolExecution.ts`
- CCB 核心工具清单：`src/constants/tools.ts`

### 产物

- `Read`
- `Write`
- `Edit`
- `MultiEdit`
- `Glob`
- `Grep`
- `Bash`
- `Todo`
- `Diff`

### 必做

- Zod schema。
- 工具权限声明。
- 工具执行进度。
- 工具结果结构化。
- Bash 输出截断。
- 完整输出保存路径。
- Edit 唯一性检查。
- CRLF/LF 保留。
- Todo 工具能展示计划、当前步骤和完成状态。
- Diff 工具能输出本轮改动摘要和文件列表。
- 写入工具必须返回 changedFiles，供 diff、checkpoint、verification 使用。

### 性能要求

- Grep 使用 ripgrep。
- 大输出必须截断。
- 工具并发不超过限制。

### 验收

真实项目里完成：

1. 搜索函数。
2. 读取文件。
3. 修改一处代码。
4. 运行测试或语法检查。
5. 输出总结。
6. Todo 状态和 diff 摘要正确。

本阶段结束后，Linghun 必须能完成简单 bug 修复。

## 11. 阶段 6：权限与 Plan 闭环

### 目标

达到可安全使用，而不是每步都烦或完全放飞。

### 参考

- CCB 权限管道：`src/utils/permissions/permissions.ts`
- 我们已修复的 CCB Plan bypass 问题。

### 产物

- `default`。
- `plan`。
- Plan Choice UI。
- `auto-review`。
- `full-access`。
- legacy alias normalization（`acceptEdits` / `auto` / `bypass` / `dontAsk` 仅作为兼容输入）。
- 权限规则。
- 权限 UI。

### 必做

- plan 强制只读。
- Plan 模式必须先输出可选方案，用户选择或确认后才能进入执行。
- 可选方案必须包含保守方案、推荐方案；高风险任务还必须包含止血方案或分阶段方案。
- 每个方案必须说明影响范围、风险、预计修改文件、验证计划。
- 用户可以选择方案、要求修改计划、取消任务。
- 未经用户确认，不得从 plan 进入写入执行。
- `auto-review` 自动允许低风险工作区编辑或本地 gate 明确允许路径。
- 高危操作永远询问。
- 可永久允许某类规则。
- 可查看和删除规则。
- 最近拒绝记录可查看，不能让用户猜为什么又被拦。
- `default` 模式下，写入前可展示 diff 摘要；`plan` 模式禁止写入。
- `auto-review` 只自动通过低风险工作区编辑，不自动通过命令执行；legacy `acceptEdits` alias 必须 normalize 到 `auto-review`。

### 交互

```text
shift+tab 切换权限模式
/permissions 查看规则
/plan 进入计划模式
1/2/3 选择计划方案
revise 修改计划
cancel 取消
/permissions recent 查看最近拒绝
```

### 性能要求

- 权限判断不得明显拖慢工具执行。

### 验收

- plan 模式尝试写文件必须被拦截。
- plan 模式能给出多个可选方案，并在用户确认前不执行写入。
- `auto-review` 修改普通项目文件不反复询问；legacy `acceptEdits` alias normalize 到 `auto-review`。
- 删除目录、改 `.git`、远程脚本必须询问。

## 12. 阶段 7：工程行为控制闭环

### 目标

解决模型绕、幻觉、过度设计。

### 参考

- 用户原始想法中的“减少幻觉、AI 说不、能力边界”。
- 当前 AGENTS.md 的最小改动规则。

### 产物

- strict engineering mode。
- 基础 i18n 文案机制。
- TUI 渲染稳定性底座。
- 后台任务状态反馈底座。
- 能力边界检查。
- Checkpoint / rewind。
- 输入中断控制。
- Evidence Gate 证据闸门。
- Claim Checker 结论检查器。
- Solution Completeness Gate 方案完整性闸门。
- Tool-before-answer 策略。
- 最小改动协议。
- 验证闭环。
- “不能做”替代方案。

### 必做

- Phase 07 开始前必须补齐 TUI 渲染稳定性底座，防止 CCB 逆向版常见的重复渲染、输入区错位、后台输出混排和状态栏撑爆。
- 主消息流、后台任务、system event、compact event、agent output、输入框、状态栏、轻提示必须分区渲染，不能互相污染。
- 后台任务、agent 输出、verification 输出、compact 进度默认折叠为一行摘要；详情通过 `/background`、任务详情或展开操作查看。
- 长任务启动后必须立即显示用户可见摘要：任务名、当前步骤、预计范围、查看详情命令。
- 长任务运行期间必须定期 heartbeat；长时间无输出时主动提示“仍在运行”和当前步骤，超过预计时间时提示可查看日志、后台运行或取消。
- verifier / verification / compact / agent 输出文件为空时必须显示“尚未产生有效输出”，不能让用户误判卡死或完成。
- 任务完成后必须主动汇报 `PASS` / `FAIL` / `PARTIAL` / `CANCELLED` 或等价结果，并给出下一步建议。
- 用户问“在干嘛、还要多久、卡住了吗”时，必须读取任务状态表回答，不得靠猜。
- 输入框区域必须稳定，系统事件不得插入输入框内部或造成多个 prompt 光标残留。
- 状态栏只显示短字段，必须支持宽度不足时截断或降级显示，不能撑爆终端宽度。
- 长工具输出、Bash 输出、agent 输出、verification 输出必须截断展示并保留完整日志路径。
- 中文宽度、全角字符、ANSI 样式、Windows Terminal resize 必须作为渲染兼容场景处理。
- compact、cache warning、index stale、verification、agent/task update 只能作为系统事件或轻提示展示，不能打断当前输入。
- TUI 渲染层只能消费结构化事件，不允许工具/agent 直接向 UI 区域写裸 stdout。
- 未读代码不允许声称代码事实。
- Phase 07 开始前必须建立基础 i18n 文案机制：用户设置 `zh-CN` 时用户可见文案输出中文，设置 `en-US` 时输出英文。
- 新增用户可见文案必须通过统一 i18n helper 或等价字典输出，不允许继续散落手写中英文分支。
- Slash 命令、配置键和 transcript 结构化事件字段保持英文，不随语言变化。
- 模型回复默认跟随 UI language；用户明确指定回复语言时，以用户当前请求为准。
- 最新信息必须搜索或声明无法确认。
- 当前模型能力不足时提示切换。
- 高风险改动先报备。
- 修改后必须验证或说明未验证原因。
- 涉及代码事实的结论必须有证据来源，例如已读文件、索引查询、命令输出或搜索来源。
- 没有证据时，模型只能说明“尚未确认，需要先检查”，不能靠猜下结论。
- 最终回答中如果出现“已修复”“已验证”“代码里是”等结论，必须能对应到工具证据。
- 代码任务默认必须先使用 Read / Grep / Index / Bash 等工具获取事实，再给实现结论。
- 实时信息必须走 Web Evidence / Freshness Gate：涉及最新版本、当前社区、provider 文档、模型价格、API 行为、安全公告或法规政策时，本地资料只能作为背景；未授权联网时先说明需要联网取证，已授权联网时优先官方来源，联网失败时降级说明，不得编造。
- 联网取证必须写入 `web_source` evidence，包含来源链接、查询时间、摘要和支持的结论；不得把完整网页、大 release 列表或大搜索结果塞进 prompt。
- 当真实使用反复暴露同一类问题、用户要求成品级/不要缝补、问题影响 Beta 或跨 natural command / TUI / 权限 / provider / memory / docs / tests 多个能力面时，必须触发 Solution Completeness Gate：先判断单点 bug 还是系统性缺口，列影响面、参考源、P0/P1/P2、当前阶段处理边界和验证方式，再给修复命令。
- Solution Completeness Gate 不得变成过度设计：独立小 bug 仍按最小修复处理；系统性缺口才要求先审计/定界；不得新增第二套命令解释系统、不得绕过 Start Gate/权限管道、不得复制第三方源码。
- 每次跨文件写入或高风险编辑前创建 checkpoint。
- `/rewind` 能列出检查点并回到上一安全状态。
- 用户中断后，必须能清楚显示当前任务是取消、暂停还是可恢复。

### 交互

模型回答必须更像工程师：

```text
我先检查相关文件。
我只改这个函数。
验证结果如下。
剩余风险是...
```

### 验收

给它一个模糊 bug，检查是否：

- 先定位。
- 再读文件。
- 小改。
- 验证。
- 不编造。
- 未查证时不会声称已确认。
- 遇到系统性产品/交互缺口时不会发现一个补一个，而是先触发 Solution Completeness Gate，给出最小完整修复边界。
- 没有验证时不会声称已验证。
- 写入后能通过 `/rewind` 回退本轮改动。
- Esc/Ctrl+C 后不会留下半执行状态。
- 切换 language 后，状态栏、权限提示、错误、帮助说明输出对应语言。
- 连续工具输出、后台任务刷新、compact 事件、中文路径、多行粘贴、终端 resize、长状态栏场景下不重复渲染、不混排、不破坏输入区。
- verifier 运行时能显示当前验证步骤、进度、已用时、预计范围、日志路径；完成后主动显示 PASS/FAIL/PARTIAL。

## 13. 阶段 8：代码自检与验证增强闭环

### 目标

把“修完自动自检”做成核心能力，避免只改代码不验证。这个阶段直接影响 Linghun 的真实编码能力，必须在缓存和 MCP 增强之前完成。

### 参考

- CCB verification agent 思路。
- CCB Dev Boost 中“自动验证增强”的讨论。
- 当前 Codex/工程开发流程：改动后运行最小必要测试、typecheck、build。

### 产物

- Verification Runner。
- 项目验证命令探测器。
- verifier agent。
- diff 复检器。
- 验证报告。
- 失败后修复循环。

### 必做

- 从项目文件识别验证命令：
  - `package.json`：test / typecheck / lint / build。
  - `pyproject.toml`：pytest / ruff / mypy。
  - `go.mod`：go test。
  - `Cargo.toml`：cargo test。
  - `Makefile`：make test / make check。
  - `CMakeLists.txt`：cmake / make / ninja。
  - `LINGHUN.md` / `AGENTS.md` / `CLAUDE.md`：项目自定义验证命令。
- 修改后优先运行最小相关验证。
- 没有测试时运行语法检查或构建检查。
- 无法验证时必须说明原因。
- verifier agent 独立读取 diff 和关键文件。
- verifier / verification 必须复用后台任务状态反馈：启动摘要、步骤进度、heartbeat、日志路径、PASS/FAIL/PARTIAL、下一步建议。
- verifier 未完成时不得宣称阶段完成；只能说明“等待复查结果”。
- 用户不需要反复追问复查状态；超过 30 秒无输出时应主动轻提示当前步骤仍在运行。
- 检查是否违反用户要求、是否过度改动、是否缺少测试。
- 验证失败时回到修复循环，最多重试有限次数。
- 必须区分验证命令失败和验证器/运行时自身异常。若测试日志显示用例已全部通过，但 Node/Vitest/pnpm 在退出清理阶段抛出异常，应记录为 `PARTIAL` 或 runner error 风险，保留日志路径和 Node 版本，不得误判为业务测试失败。

### 交互

```text
/verify
/verify auto on
/verify plan
/verify last
```

### 性能要求

- 默认只跑最小必要验证，不全量慢测。
- 长测试必须显示进度和耗时。
- 验证输出要截断，但保留完整日志路径。
- 验证或 verifier 输出文件为空时，必须明确显示“尚未产生有效输出”。

### 验收

- 修改 Node 项目后能自动发现并运行 typecheck/test。
- 修改 Python 项目后能建议 pytest/ruff。
- 验证失败能提取关键错误并继续修复。
- verifier agent 能指出 diff 中明显风险。
- 最终报告包含：改了什么、跑了什么、结果如何、未验证什么、剩余风险。
- 复查过程中 `/background` 或状态摘要能看到当前命令、进度、已用时、预计范围、日志路径和最近输出时间。

本阶段完成后，Linghun 才能称为“可闭环修代码”，不是只会生成补丁。

## 14. 阶段 9：缓存与成本闭环

### 目标

复刻并产品化 CCB Dev Boost 的降本能力。

### 参考

- 本地 `ccb-source/docs/ccb-optimizations.md`
- `src/utils/cacheHistory.ts`
- `src/utils/cacheWarning.ts`
- `src/services/api/promptCacheBreakDetection.ts`
- `src/utils/mcpStabilize.ts`

### 产物

- cache history。
- cache warning。
- cache break detector。
- `/cache-log`。
- `/break-cache status`。
- `/usage`。
- `/stats`。
- 状态栏可选短命中率。
- CCB 风格轻提示。
- cache freshness。
- cache warmup / refresh。
- endpoint-level cache stats。
- public claim guard。

### 必做

- 最近 20 轮缓存日志，默认环形保留，超过自动删除旧记录。
- 缓存日志保留数量可配置，例如 `/cache-log config size 50`。
- 命中率颜色提示。
- 费用估算只能在 `/usage` 或 `/stats` 中展示，且必须标记 `estimated`；默认状态栏不显示金额。
- system prompt diff。
- tool schema diff。
- MCP tool list diff。
- model changed 检测。
- usage 原始字段记录：input tokens、output tokens、cache read tokens、cache write/create tokens。
- 命中率必须基于 provider/API 返回的 usage 字段计算，不能用 UI 估算值代替。
- cache creation/write 字段必须记录来源：reported、zero_reported、missing、estimated。`cache_creation_tokens=0` 不能直接解释为“无写入成本”或“缓存一定新鲜”，只能表示 provider 当前返回为 0。
- 缓存新鲜度不得依赖 cache creation token 判断，必须基于 system prompt、tool schema、MCP 工具列表、model/provider、reasoning effort、project rules、memory、compact、plugin list 等 hash 判断。
- 需要提供 `/cache status`、`/cache warmup`、`/cache refresh`；warmup/refresh 只做用户可控的最小请求，不保证所有 provider 一定写入缓存。
- `/stats endpoints` 或等价入口必须按 endpoint 展示命中率，例如 `/v1/messages` 与 `/v1/responses` 分开统计。
- 支持导出最近缓存日志，便于和账号账单交叉验证。
- 明确区分“模型自身能力”和“Linghun 稳定上下文带来的命中提升”。
- 对外宣传必须使用真实 usage / 账单对账口径，不能承诺固定 98% 命中、25 倍省钱或所有模型必然达到同等效果。
- 轻提示采用 CCB 风格，不弹窗打断，只在状态栏或底部提示建议命令。
- 轻提示覆盖：上下文过长建议 `/compact`、缓存命中下降建议 `/break-cache status`、cache creation 长期为 0 但 cache read 很高时提示字段口径、system prompt / tool schema / MCP 列表 hash 变化建议 `/cache warmup`、大文件建议 `.linghunignore`、高风险修改建议 `/plan`。
- 同类轻提示必须限频，可关闭，可静默；新手模式提示更多，高级模式提示更少。

### 性能要求

- cache 记录不能阻塞流式输出。
- 状态栏刷新轻量。
- 轻提示必须基于本地状态和阈值触发，不额外调用模型。

### 验收

- 连续 20 轮对话后 `/cache-log` 有数据。
- 修改 cache log size 后，超过上限会自动淘汰旧记录。
- 切换模型后能显示缓存破坏原因。
- MCP 工具变化能显示原因。
- `/cache-log` 必须显示每轮 cache read/write/input/output tokens 和模型。
- `/usage` 能显示本会话原始 usage；`/stats` 能显示综合统计。
- `/stats endpoints` 能显示不同 endpoint 的 cache 命中率和样本数。
- 长期 `cache_creation_tokens=0` 时，UI 能解释字段来源为 `zero_reported` 或 provider 未报告，不夸大为零成本。
- system prompt / tool schema / MCP 工具列表变化后，`/break-cache status` 能指出 freshness 变化并建议 `/cache warmup`。
- 状态栏不默认显示金额。
- 上下文过长、cache 命中下降、大文件读取等场景能出现非打断轻提示。
- 抽样对比 transcript/API usage 与 `/cache-log`，命中率计算一致。
- 至少提供一次账号账单或 provider usage 对账流程说明，证明成本估算不是纯 UI 推测。
- 文档示例必须使用“特定 provider + 特定工作流实测”口径，不得写成任意模型天然保证。

## 15. 阶段 10：MCP 与 codebase-memory 闭环

### 目标

让索引和 MCP 真正可用，但不拖垮主程序。

当前口径覆盖说明（2026-05-20）：阶段 10 的 `done` 只覆盖本机 `codebase-memory-mcp` CLI / MCP 配置的最小闭环，不代表 codebase-memory 已随 Linghun 内置、固定版本、免安装、license/NOTICE 或发布成熟。Bundled codebase-memory Lite 必须作为 Phase 15 Beta 前尾项或 Phase 15.5 开源前 hardening 独立验收，不能回填到旧阶段 10 完成口径。

### 参考

- CCB MCP 客户端：`src/services/mcp`
- CCB codebase-memory：`src/services/mcp/codebaseMemory.ts`
- 本机或内置 MCP：`codebase-memory-mcp`

### 产物

- MCP manager。
- `/mcp` 面板。
- `/mcp doctor`。
- codebase-memory 推荐配置。
- `index_repository` 调用。
- 索引状态。
- 大文件保护。
- 索引过期提醒。

### 必做

- MCP 失败隔离。
- 工具列表稳定排序。
- description/schema 稳定化。
- `/index status` 优先使用 `codebase-memory-mcp cli detect_changes` 做 stale 检测；不可用时清晰降级，不自动刷新。
- `/index init fast` 和 `/index refresh` 前执行大文件扫描。
- `.linghunignore` / `.cbmignore` 兼容。
- 大文件安全门默认阻止未排除的大 JSON、SQL、XML、min.js 和常见生成物/资源目录；用户显式追加 `--force` 才继续。
- break-cache 深度诊断记录为后续独立增强，不混入 Phase 10 hardening。

### 交互

```text
/index status
/index init fast
/mcp doctor
```

### 性能要求

- MCP 启动失败不影响普通聊天。
- 索引检查异步执行。

### 验收

- 当前项目建立索引。
- 使用索引查调用链。
- `/index status` 在 `detect_changes` 可用且发现变更时显示 stale 或 stale hint，并只提示 `/index refresh`。
- `detect_changes` 不可用时 `/index status` 清晰降级，不影响基本索引状态查看。
- `/index init fast` 和 `/index refresh` 在发现未排除大文件风险时默认阻止索引，并提示加入 `.linghunignore` 或 `.cbmignore`。
- `/index init fast --force` 和 `/index refresh --force` 可作为显式继续路径。
- 大文件未排除时给明确提示。

## 16. 阶段 11：会话交接与记忆闭环

### 目标

解决多开会话、换工具开发导致上下文丢失。

### 参考

- CCB JSONL 会话。
- AI Sessions MCP 方向。
- Hermes 的 MEMORY / USER 思路。

### 产物

- `/sessions`。
- `/resume`。
- `/branch`。
- 内部会话摘要。
- handoff packet。
- AI sessions 接入。
- `LINGHUN.md`。
- `MEMORY.md`。
- `.linghun/memory/` 项目级记忆存储。
- 可配置 memory/session 数据路径。
- `/btw` 临时插问。

### 必做

- 按项目列出会话。
- 恢复会话。
- `/resume` 必须恢复最近或指定会话，但不能无脑复制完整历史上下文。
- `/branch` 必须从当前任务生成一条新路线，用于试验不同方案；分支必须有独立 transcript 和明确父会话引用。
- 读取最近任务摘要。
- 从 Claude / Codex 会话导入上下文。
- 新会话基于记忆和索引开始。
- 新会话启动时必须构造稳定启动上下文包：`LINGHUN.md` / 项目规则、阶段状态、最近 handoff packet、未完成 Todo、最近验证结果、索引状态。
- 禁止把完整历史聊天直接塞入新会话上下文。
- handoff packet 必须是成品级结构化交接包，至少包含：当前阶段、下一阶段、目标、已完成、待处理、禁止事项、Todo、关键文件、变更文件、证据引用、验证结果、风险、索引状态、权限模式、模型/provider、最近提交和预算使用。
- `/resume`、`/branch`、自动新会话和后续 `/fork` 都必须消费结构化 handoff packet，而不是自由文本复制粘贴。
- 新会话启动前必须校验 handoff packet；缺少验证结果、证据引用、禁止事项或索引状态时，降级为只读恢复并提示用户补齐。
- `LINGHUN.md` 只保存长期稳定事实和工程规则；临时想法、阶段进度和短期计划写入 handoff packet。
- 首次进入项目如果缺少 `LINGHUN.md`，必须轻提示建议 `/init linghun-md` 或等价向导生成基础模板。
- AI 可以建议更新 `LINGHUN.md`，但默认需要用户确认；不得无限追加流水账。
- `/btw` 回答临时小问题时，不改变当前主任务计划、Todo 和执行状态。
- 会话摘要必须区分“已确认事实”和“用户想法/待确认假设”。
- 项目级记忆默认支持写入项目内 `.linghun/memory/`。
- 用户级记忆与项目级记忆必须分层，不能混写。
- 记忆和会话数据目录必须可通过配置切换到其他磁盘。
- 必须支持 `LINGHUN_DATA_DIR` 作为统一用户数据根目录，覆盖 sessions、user memory、logs、jobs、cache history 等用户级数据的默认根路径。
- 必须支持配置项 `storage.userData`、`storage.sessions`、`storage.memory.user`、`storage.logs`、`storage.jobs`、`storage.cache`；未单独配置时继承 `LINGHUN_DATA_DIR` 或默认 `~/.linghun/data`。
- 不允许硬编码 `C:` 或固定用户目录。
- 必须提供 `/memory storage` 或等价诊断，显示当前记忆/会话/索引存储位置。

### 交互

```text
/sessions
/resume
/branch
/sessions import codex
/init linghun-md
请基于最近 Codex 会话和项目索引继续处理这个问题
```

### 验收

- 在 Codex 做一半任务。
- 在 Linghun 读取相关会话摘要。
- 结合当前代码继续工作。
- 新会话能基于 `LINGHUN.md`、handoff packet、Todo、验证结果和索引状态启动，不需要用户重复解释。
- `/resume` 能恢复最近会话，并只注入必要摘要和证据。
- `/branch` 能创建独立分支会话，保留父会话引用。
- handoff packet 缺少关键字段时不会自动继续执行，只读恢复并给出补齐建议。
- handoff packet 中的 `mustNotDo` 能阻止新会话越界进入后续阶段或执行未授权高风险操作。
- 缺少 `LINGHUN.md` 时出现 CCB 风格轻提示，用户确认后生成基础模板。
- 长任务中使用 `/btw` 后，主任务能继续。
- 能把项目级记忆写入项目内 `.linghun/memory/`。
- 能通过 `LINGHUN_DATA_DIR` 把用户级会话、记忆、日志、任务、缓存历史迁移到非 C 盘目录。
- 能通过 `storage.*` 配置覆盖单项数据路径，例如只把 sessions 放到指定目录。
- `/memory storage` 能显示项目级、用户级、会话、索引的实际路径。

## 17. 阶段 12：Agent 闭环

### 目标

实现可控多 agent，而不是默认乱开烧 token。

### 参考

- CCB Agent：`packages/builtin-tools/src/tools/AgentTool`
- CCB 工具限制：`src/constants/tools.ts`

### 产物

- explorer。
- worker。
- verifier。
- planner。
- `/fork`。
- Agent transcript。
- Agent 状态栏。
- Agent 成本统计。
- 后台 agent 查看、折叠和中断。

### 必做

- 用户明确要求才多开。
- `/fork` 从当前上下文派生子会话或 agent，用于并行探索；必须限制上下文为任务摘要、证据、必要文件列表和权限范围。
- explorer 只读。
- verifier 只验证。
- worker 可编辑但受权限。
- Agent 清理可靠。
- 每个 Agent 成本可见。
- 前台主任务可以查看后台 agent 进度。
- 用户可以中断单个 agent，不影响整个会话。

### 性能要求

- 默认最多 3 个 agent。
- agent 输出摘要化回主线程。

### 验收

- 多开 explorer 查两个独立问题。
- `/fork` 能派生一个子会话或 agent，且不会把完整历史无脑复制过去。
- worker 做明确小改。
- verifier 自动验证。
- 主线程合并结论。
- 单个 agent 被取消后，主会话仍能继续。

## 18. 阶段 13：多模型协作闭环

### 目标

实现实用的多模型协作，而不是炫技。

### 参考

- OpenCode 多模型方向。
- oh-my-openagent 的 team / category routing 方向，只参考角色分工、状态可见和验收边界，不复制实现。
- 用户需求：一个 AI 写方案，一个 AI 指挥，一个 AI 执行。

### 产物

- model router。
- capability table。
- role-to-model 配置。
- per-agent model。
- role context handoff。
- fallback policy。
- per-role budget。
- vision provider。
- image provider。
- vision observation evidence。
- image generation evidence。

### 必做

- 规划模型。
- 执行模型。
- 审查模型。
- 视觉模型。
- 生图模型。
- 成本显示。
- 角色路由必须明确：planner / executor / reviewer / verifier / summarizer / vision / image。
- 每次角色路由必须产生可审计记录：触发原因、选择角色、选择模型、fallback 候选、能力要求、预算上限和停止条件。
- planner 输出 PlanProposal，不直接写文件。
- executor 只能执行已批准计划或明确任务。
- reviewer/verifier 默认只读，必须基于 diff、关键文件和验证结果复核。
- vision 只处理图片、截图、OCR、UI 理解，输出结构化 observation 和 evidence，不写代码、不执行 Bash。
- image 只处理异步生图/改图，输出本地图片资产和 evidence，默认不改代码、不覆盖原图。
- 角色之间只传递结构化摘要、证据、diff 和必要文件列表，不无脑复制完整上下文。
- 每个角色可配置模型、最大 token、最大费用、是否允许工具、是否允许写入。
- 模型不可用、能力不足或超预算时，必须降级到备用模型或暂停让用户选择。
- 多模型协作必须显示每个角色的成本、耗时、贡献摘要和是否影响最终结论。
- `/model route doctor` 必须能诊断角色模型缺失、能力不匹配、fallback 不可用、预算不足、vision/image provider 未配置和路由配置冲突。
- role context handoff 必须使用结构化 `RoleHandoff`，只包含任务摘要、证据、diff、验证结果、必要文件列表和风险，不允许复制完整 transcript。
- 主 executor 不支持视觉时，不能要求用户手动永久切换主模型；应按需调用 vision provider，然后把结构化视觉结果交回当前 executor。
- 生图必须作为后台任务运行，显示任务 id、模型、耗时、保存路径和日志路径。
- image provider 默认不固定尺寸，不传 size/quality/format；只有用户明确指定或项目资产场景需要时才传。
- image prompt 默认轻量增强，不生成大段提示词；保留用户原始需求，只补透明背景、无文字、资产用途等必要工程约束。
- 同一图片的视觉/生图结果必须可复用为 evidence，避免重复调用多模态或生图模型烧钱。
- 未配置 vision/image provider 时，遇到对应输入必须明确提示配置，不得假装识图或生图。

### 交互

```text
/model route
/model route doctor
/model route set planner gpt-5.5
/model route set executor deepseek-v4-pro
/model route set vision qwen-vl
/model route set image gpt-image-2
/image generate "H5 游戏金色按钮背景"
/agents run verifier --model gpt-5.5
/plan --model claude
```

### 验收

- DeepSeek 执行代码。
- GPT/Claude 做复核。
- 成本按模型显示。
- 能力不足时建议切换。
- DeepSeek V4 Pro 作为 executor 时，截图任务能临时调用 vision provider，再回到 DeepSeek 执行代码。
- `/image generate` 能通过 OpenAI-compatible image2 接口异步生图并保存到本地资产目录。
- 不指定尺寸时 image provider 使用模型/provider 默认能力；指定尺寸时才传参数。
- vision/image 结果写入 evidence，后续步骤不重复识别或生成同一素材。
- planner 只产出计划，不写文件。
- executor 按批准计划完成修改。
- reviewer/verifier 能独立指出 diff 风险。
- 一个模型失败时能切到 fallback 或暂停选择。
- 超过角色预算时停止继续烧 token。
- 多模型上下文交接不会把全量会话重复塞给每个模型。
- `/model route doctor` 能解释至少一个能力不足或 fallback 缺失问题，并给出中文修复建议。
- 多模型运行后能在 `/stats` 或等价视图看到按角色拆分的 token、成本、耗时和贡献摘要。

## 19. 阶段 14：Skills 与工作流闭环

### 目标

兼容技能、插件和常用工作流，但不影响核心速度。

本阶段的 Plugin 目标是“可用底座”，不是完整插件生态。第一版只做本地插件清单、启停、诊断、失败隔离和权限接入；不做插件市场、远程安装、自动更新、评分分发或复杂沙箱。

Phase 14 必须拆成“主闭环”和“hardening”两段交付。主闭环只完成本地 skills/workflows/hooks/plugin loader、doctor、启停、信任和权限接入；hardening 再补加载顺序稳定性、缓存 hash、失败隔离、hook 超时、大输出截断和工作流验收。GitHub / 社区源安装、插件生命周期和开发文档登记到 Phase 15.5 的 Connect Lite 小阶段，除非用户明确确认，不得混入 Phase 14 主闭环导致阶段膨胀。

### 参考

- Hermes Skills。
- CCB Skills / workflow 工具方向。
- 当前 Codex skill 生态经验。
- OpenCode 插件化和配置化方向。
- oh-my-openagent 的 skills / hooks / lifecycle 方向，只参考加载边界、诊断面板和失败隔离，不复制实现。

### 产物

- Skill loader。
- Plugin manifest loader。
- Project skills。
- User skills。
- Workflow templates。
- Hooks runtime。
- Plugin doctor。
- Skill / Plugin / Hook trust report。

### 必做工作流

- bug-fix。
- review。
- doc-to-code。
- design-to-code。
- release-note。
- refactor-plan。

### 必做 Hooks

- PreToolUse。
- PostToolUse。
- Stop。
- Notification。
- Workflow hook。
- Plugin hook。

Hooks 是高级自动化能力，默认关闭，新手模式隐藏。项目 Hook 必须在项目信任后才允许执行，不能绕过权限系统。

### 成品级加载边界

- Skill 默认只加载稳定 metadata 和短摘要；只有触发命中且用户任务需要时，才加载对应 `SKILL.md` 或工作流正文。
- 第三方 skill / plugin / hook 必须显示来源、路径、版本、权限、信任级别和是否会联网或执行命令。
- 项目级 skill / plugin / hook 首次启用前必须经过项目信任确认。
- workflow 启动前必须走 Start Gate；工作流内部写文件、运行 Bash、联网、安装依赖仍必须走权限管道。
- skill / plugin / hook 的列表、摘要、贡献点和 schema 必须稳定排序，动态字段不得进入 prompt 稳定层。
- 加载失败必须失败隔离：禁用失败项、记录 doctor 信息、主会话继续可用。
- hook、plugin、workflow 的长输出必须截断展示并写入日志路径，不得混入主消息流或污染输入区。

### 交互

```text
/workflows bug-fix
/workflows
/skills
/skills add
/plugins
/plugins doctor
/doctor hooks
```

### 性能要求

- 不加载无关 skill 全量内容进 prompt。
- skill 摘要稳定，避免破坏缓存。
- skill 命中机制必须 summary-first、load-on-demand，不能把所有 skill 全文塞进 prompt。
- plugin 清单稳定排序，失败隔离。
- plugin 贡献的命令、MCP、provider、hook 必须可见。
- hook 输出必须截断，大输出写日志路径；hook 超时必须有限制。
- `/skills`、`/plugins doctor`、`/doctor hooks` 必须显示来源、信任级别、启用状态、最近错误、权限和缓存影响摘要。

### 验收

- 使用 bug-fix 工作流完成真实 bug 修复。
- `/workflows` 能列出可用工作流，并说明每个工作流的用途和风险。
- skill 可禁用。
- skill 不导致启动明显变慢。
- plugin 可启停。
- plugin 加载失败不影响主会话。
- PreToolUse 能拦截高风险命令。
- PostToolUse 能触发最小验证或检查。
- Stop hook 能阻止未完成交付文档/未验证的阶段任务直接结束。
- Notification hook 能发送任务完成摘要，但默认不推送完整上下文。
- 第三方 skill/plugin/hook 未信任时不会执行命令、联网或写文件。
- 禁用某个 skill/plugin/hook 后，重启仍保持禁用，且不会继续进入 prompt 稳定层。
- workflow 验收必须包含启动前 Start Gate、执行中权限审批、结束时验证/交付检查。

### Phase 15.5 交接：MCP / Skills / Plugins Connect Lite

Phase 14 先完成本地底座；Phase 15.5 再按 CCB 成熟路径补齐“可安装、可验证、可启停、可诊断”的轻量连接能力，不能遗漏，但也不得做成市场。

必须支持：

- `/mcp add <name> --transport stdio|http|sse ...`
- `/mcp remove <name>`
- `/mcp enable <name>` / `/mcp disable <name>`
- `/mcp reconnect <name>` / `/mcp doctor <name>`
- `/skills add <path|git-url|github:owner/repo[#subdir]>`
- `/skills remove <skill-id>`
- `/skills enable <skill-id>` / `/skills disable <skill-id>`
- `/skills search <query>` 或等价 summary-first discover
- `/plugins install github:owner/repo`
- `/plugins install https://github.com/owner/repo`
- `/plugins install <local-path>`
- `/plugins validate <path>`
- `/plugins update <plugin-id>`
- `/plugins remove <plugin-id>`
- `/plugins enable <plugin-id>`
- `/plugins disable <plugin-id>`

安全要求：

- 安装前读取 manifest，不执行仓库脚本。
- 展示插件来源、版本、commit hash 和申请权限。
- 用户确认后才安装。
- 默认不自动启用高风险权限。
- 更新时重新展示权限变化。
- 锁定 commit hash，避免远程仓库内容变更后静默漂移。
- GitHub 安装失败不能影响本地插件和主会话。
- 插件运行必须失败隔离，插件崩溃不能拖垮主进程。
- 插件必须声明 Linghun 最低版本和 Plugin API 版本。
- 插件贡献点必须有明确规范：command、MCP、provider、hook、workflow、skill。
- Skill 安装必须验证 `SKILL.md`、metadata、触发摘要、风险标记和来源；默认只加载摘要，不把正文塞进 prompt。
- MCP 安装必须支持 project/user/local scope、env/header 脱敏、`.mcp.json` 或等价项目配置的首次信任确认。
- 第三方 skill / plugin / MCP server 默认不自动启用高风险能力，不执行 postinstall 脚本，不自动更新。
- `/plugins doctor` 必须显示失败原因、路径、依赖、权限和版本兼容问题。
- 插件来源必须分级：local、official、third-party。
- 插件贡献内容必须稳定排序，不能污染 prompt cache。
- 必须提供插件开发文档：如何写插件、调试插件、发布插件。

验收：

- 能从 GitHub 安装一个测试插件。
- 能从 GitHub 或本地路径安装一个测试 skill。
- 能添加一个测试 MCP server，并在 `/mcp doctor` 看到 transport、scope、tools 摘要和脱敏 env/header 状态。
- 首次启用时能展示权限申请。
- 插件崩溃后主会话仍可继续。
- 版本不兼容插件会被拒绝或禁用，并给出中文原因。
- `/plugins doctor` 能定位路径、依赖、权限、manifest、版本问题。
- 插件贡献的命令、MCP、provider、hook、workflow、skill 都能在面板中看到来源。
- 重启后插件顺序稳定，不造成缓存无意义抖动。

成品版仍然暂不做：

- 大型插件市场。
- 技能市场。
- 插件评分、推荐、分发。
- 插件商业化和账号体系。

## 20. 阶段 15：真实项目测试版

### 目标

所有核心阶段完成后，进入可测试成品。Phase 15 开始前必须先补齐 Natural Command Bridge 最小闭环，确保真实用户能用自然语言查看/控制 Linghun 核心状态，而不是必须记住每个 slash 命令。

### Phase 15 preflight：自然语言控制桥

正式真实项目测试前，必须先完成：

- 普通输入先经过本地 intent router。
- 基于 Command Capability Catalog 做中英文语义识别；用户不必说固定关键词。
- 能识别 memory/index/cache/model/mode/workflow/skills/plugins/hooks/sessions/resume/branch 的高频自然语言查询和安全启动请求。
- 只读查询直接读取本地真实状态并返回短摘要。
- 索引建立/刷新、模型切换、模式切换、workflow 启动、skill/plugin enable 等动作必须给出确认门。
- 写文件、Bash、权限规则、安装依赖、hook/job/remote 不得自然语言直通，必须继续走权限管道。
- 模型请求前注入短 RuntimeStatus：memory autoAccept/candidates/accepted/LINGHUN.md、index status、cache hitRate/changedKeys、model、mode、skills/plugins/hooks 计数。
- focused tests 覆盖中英文自然语言入口，例如“自动记忆是否打开 / is memory enabled”“帮我建立索引 / build the index”“缓存命中怎么样 / cache hit rate”“现在什么模型 / current model”“打开 bug-fix 工作流 / start bug-fix workflow”。

Phase 15 Beta 前还必须补一次 Solution Completeness Gate 收口。真实 TUI smoke 如果暴露“自然语言入口像命令壳”“只读查询误进 Start Gate”“模型只口头说要 /read 却不执行”“用户需要不断纠正方向”等系统性问题，不能继续按单句补丁推进 Beta。必须先基于完整交互审计和 CCB / OpenCode 等公开行为参考，定界 P0/P1/P2：P0 和阻塞 P1 在 pre-Beta 修复，非阻塞 P1/P2 登记到 Phase 15.5 或后续，不得把 Phase 15 真实项目测试建立在已经失真的入口上。

Phase 15 Beta 前还必须通过 TUI output/report gate。真实项目测试前，主输出、权限提示、工具结果、错误诊断、状态栏、hint、doctor 和阶段汇报必须达到 4.2.1 的成品级口径。若实测出现长输出刷屏、内部字段泄露、权限提示不可读、tool_result/EvidenceSummary 污染主对话、doctor 泄露 key、状态栏显示错误 provider/model、重复无效 warning 或阶段报告缺少 verdict/evidence/validation/risk/next action，则按 P0 或阻塞 P1 处理，不能进入 Phase 15 Beta。

Phase 15 Beta 前还必须通过 CCB handfeel gate。该 gate 只收口真实 TUI 可用性，不引入新架构，不把 Phase 15.5/16+ 能力提前塞入本阶段。必须逐项通过：

1. **Provider/model 真实生效**：TUI 不得 hardcode deepseek；状态栏、`/model`、`/model doctor`、usage、stats 和 handoff 必须显示实际 provider/model；`LINGHUN_DEFAULT_MODEL`、role route、project config、env 的生效顺序必须可诊断。
2. **默认权限不静默执行高风险工具**：`default` 模式只自动允许只读工具和会话内低风险工具；Bash、write/edit/delete、配置修改、依赖安装、联网和权限变更必须走权限管道。当前最小 REPL 没有交互式审批 UI 时，应拒绝并给下一步，不得先执行。
3. **控制面请求本地处理**：index/mcp/model/memory/cache/permissions/features/help/doctor/status 等状态或启用询问优先由本地控制面处理；“打开 mcp 的索引功能”这类请求不得落到模型让它用 Bash 猜。普通开发请求才进入模型 tool_use/tool_result 主循环。
4. **无 pending gate 的确认词不进模型**：`yes`、`确认`、`继续`、`ok` 在没有 pending gate 时必须本地提示“当前没有等待确认的动作”；有 pending gate 时只接受当前 gate 的确认格式；取消或过期后必须清空 gate。
5. **tool_result 兼容和 provider 降级**：provider/model 不支持 tools 时不得发送 tools/toolChoice；支持 tools 时 `tool_call -> tool_result -> second request` 格式必须正确；HTTP 400 必须能区分 model/baseUrl/tool schema/tool_result 兼容问题。
6. **输出保持 CCB 手感**：主屏只显示摘要、风险、结果、下一步；长输出截断并写入 fullOutputPath/log/transcript/evidence；权限提示不暴露内部字段；tool_result、EvidenceSummary、raw index/cache 不污染普通对话；hint/warning 去重。
7. **Windows 真实可用**：RuntimeStatus 和 system prompt 暴露真实 Windows `projectPath`，不得出现 `/workspace`；中文 stdout/stderr 不乱码；路径、错误建议和命令符合当前 shell/平台。
8. **密钥持久化简单但安全**：允许 env、本地私有配置和项目配置作为配置来源；API key/token 输出必须脱敏；doctor 显示 source + present/missing/masked preview；若支持 `settings.local.json` 必须 gitignore；若 `settings.json` 存真实 key，doctor 温和 warning，不阻断测试。
9. **错误恢复可操作**：HTTP 400/401/403/429/5xx、provider/key/baseUrl/model、index、MCP、tool schema 和 tool_result 错误必须分类提示，并给下一步：`/model doctor`、切模型、检查 baseUrl、禁用 tools、换 provider 或查看日志。
10. **测试不是固定句子表**：focused tests 必须覆盖意图类别：状态查询、doctor、用法、safe local action、危险动作、普通开发请求、模糊请求；中文/英文走同一行为矩阵；必须覆盖真实 TUI smoke 路径。

Phase 15 pre-Beta Full Interaction Maturity Audit 已确认 6 项 P0 阻塞：P0-1 provider/tool_use/tool_result 架构缺口，P0-2 文件智能指代缺失，P0-3 新手轻引导和默认 `LINGHUN.md` 模板成熟度不足，P0-4 evidence 未注入模型上下文，P0-5 模型流不可取消，P0-6 en-US 关键提示不完整。进入 Phase 15 Beta 前必须一次性修复 P0-1 到 P0-6，不能只修 3 项，不能做“只读工具版”或“文本 hint 版”弱化方案。

P0-1 的收口必须参考 CCB 的公开成熟边界：完整 tool_use / tool_result 工具协议 + 统一权限中枢。Linghun 必须让模型能通过真实工具事件发起现有核心工具：Read、Grep、Glob、Diff、Write、Edit、MultiEdit、Bash、Todo；执行层复用现有工具实现、Start Gate、decidePermission、`plan`、`auto-review`、`full-access`、legacy alias normalization 和安全检查。只读工具可直接按只读路径处理；写入、编辑、Bash、Todo 等危险或变更类工具必须进入权限管道，不得因来自模型 tool_use 而绕过审批。

P0 hardening 完成后不能自动进入 Phase 15 Beta。必须先读取 P0 hardening 报告和验证结果，判断是否启动 **Phase 15 pre-Beta CCB / CCB Dev Boost Deep Parity Closure**。这一步是 Solution Completeness Gate 在真实测试基线上的落地：确认 Phase 00-14 不是“功能有但手感弱”，而是在真实使用上达到 CCB / CCB Dev Boost 公开成熟行为的核心体验等价。审查范围至少覆盖编码主链路、工具主动性、自然语言入口、权限/提权、建议系统、错误/doctor/help、长任务、TUI 基础手感、cache/index/memory、多模型协作、Skills/Workflows/Hooks/Plugins 边界和中英文关键路径。若发现 P0 或阻塞 P1，必须在 Beta 前修复；非阻塞 P2 才登记到 Phase 15.5。

进入 Phase 15 真实项目 Beta 前，还必须启动 **Phase 15 Pre-Beta Non-Real-Test Completeness Audit**。该审计只处理不依赖真人项目实测也能确认的成熟度和技术债，不替代 Phase 15 real-project Beta，也不得把 Phase 16 / 17 / 18 的完整功能提前实现。审计必须按参考源矩阵执行，不能空头承诺；每一项必须写出 `Reference -> Reference behavior -> Linghun current evidence -> Gap -> Decision -> Required evidence`。

本审计至少覆盖：

- Agent / multi-agent lifecycle：对照 CCB Agent 生命周期、OpenCode build/plan/general agent 交互和 oh-my-openagent team 状态表；检查 agent 定义、选择、状态表、取消/恢复、结果采纳、权限/模型/预算、日志路径和 verifier 证据。
- Learning / Memory / Skill evolution：对照 Hermes MEMORY / USER / Skills 和 CCB skillLearning observation / instinct / candidate / review 生命周期；检查候选生成阈值、证据数量、accept/reject/disable/retire/stale/conflict、回滚、成本 guard 和 cache 稳定性。
- MCP / Skills / Plugins Connect Lite：对照 CCB MCP/skills/plugins 和 OpenCode MCP/plugin 管理；检查 Git/community 安装、validate、enable/disable/remove/update、trust notice、doctor、source/commit/permissions 记录和 discovery-before-execute。
- Provider / gateway request identity：检查 CLI 请求是否显式、稳定、脱敏地声明 Linghun 身份，例如 User-Agent / X-Title / metadata；确认中转站显示的 `note` 是否来自 Linghun 代码、SDK 默认或网关默认；不得泄露本地路径、项目名、API key 或用户信息。
- TUI / help / doctor / hints / output polish 非实测项：对照 CCB、OpenCode 和 Warp；检查主输出分层、轻提示、命令发现、doctor 可操作性、长输出路径、窄终端 snapshot 和 cache 不回退。
- Provider/model/usage/cache/quota：对照 CCB Dev Boost、CC Switch、LiteLLM/OpenRouter/Vercel AI SDK 类 provider 抽象；检查 usage/cache 字段来源、quota 来源、错误分类、fallback、role route doctor 和中英文提示。
- Freshness / Web evidence：对照 Freshness Gate、官方文档和公开来源规则；检查最新信息必须联网核验、web_source evidence、失败降级和引用口径。
- Hardcoded artifact sweep：再次检查固定 provider、固定 model、固定 report path、旧 CLI 名、固定网关名、固定项目路径、`/workspace`、旧阶段口径和密钥泄漏。

审计状态必须使用：`DONE`、`DOC-ONLY`、`PARTIAL`、`BLOCKING`、`DEFERRED`、`NOT-DO`。其中 `BLOCKING` 和确认后的阻塞 `PARTIAL` 必须在真实项目 Beta 前修复；`DOC-ONLY` 不能冒充已实现；`DEFERRED` 必须登记到 Phase 15.5 / 16 / 17 / 18 的明确阶段；`NOT-DO` 必须写原因。审计报告必须列出验证命令、source probe、TUI smoke 或文档证据；没有证据的项不得标为 `DONE`。

Phase 15 Pre-Beta Red Flag Sweep reconciliation 归属：

- 当前 Beta 前只修会污染真实项目实测数据面的红线：provider/config source 归因不实、项目 settings 密钥残留写回、provider 请求/header 无超时、provider 失败不落 evidence/doctor、明确报告请求缺少本地 Write evidence 闭合、普通状态面隐藏 provider/endpointProfile/reasoning、headless CLI doctor 与 TUI doctor 口径不一致。修复必须是最小 runtime/doctor/test 闭口，不借机做 provider 管理 UI、TUI 美化或完整安全平台。
- 已由后续 closure/live report 关闭的红线不得反复当作未修复问题；baseline 和 sweep 是问题清单，最新 reconciliation、closure、live smoke 和 independent verification 决定条目状态。
- `RF-B03` 这类 transcript/report/handoff 持久化统一脱敏边界是 release/security hardening，若当前实测没有 raw key/path/prompt 泄漏证据，登记到 Phase 15.5；若真实 Beta 发现 durable artifact 泄漏，则立即升级为 P0 回补。
- `RF-W01` 到 `RF-W07` 默认作为 Phase 15 real-project Beta 观察项：multi-tool sibling evidence 完整性、无人值守脚本的 Write approval、报告 final answer 路径引用、无显式文件名报告的安全默认、env 覆盖时仍提示项目 settings 残留 key、endpointProfile/reasoning 作为高级项的可理解性、baseUrl query/fragment 诊断。只有在真实项目实测污染数据或误导用户时才升级为阻塞。
- `RF-P01` / `RF-P02` 不阻塞 Phase 15：富 TUI polish 和 Claude/Anthropic native provider 不在当前 Beta 前实现；Phase 15.5 可以做轻量复检或 provider maturity 登记，但不得宣传 Phase 15 已原生支持。
- `RF-N01` 到 `RF-N05` 是 no-action / regression guard：不得再实现静默 endpointProfile 切换，不得绕过权限，不得把固定 Gate/report artifact 写入 runtime，不得把 MCP 市场、桌面端、长期自治塞回 Phase 15。
- Red Flag Sweep 之后不再无限审计。若 blockers 归零，下一步是用户确认的真实项目 Beta；Beta 中发现问题按 P0/P1/P2 分类，P0/阻塞 P1 当轮修，非阻塞 P2 登记到后续阶段。

P0 收尾禁止事项：

- 不得用解析模型文本里的 `/read`、`Read(...)` 或“我会先读取文件”来冒充 tool_use。
- 不得只把 Read/Grep/Glob 暴露给模型后宣布 tool_use 闭环完成；只读工具可以先跑通，但 schema、事件、权限和测试必须覆盖完整核心工具集。
- 不得复制 CCB、OpenCode 或其他第三方源码；只参考公开行为、权限边界和验收标准。
- 不得把 registry 大重构、完整 TUI 美化、Bash 流式输出、完整 onboarding wizard、rate limit/context 状态栏或 Web Evidence runtime 混入本轮 P0。
- 不得把用户测试仓库中的长规则草稿原样塞入默认模板；必须提炼为短而硬的工程纪律，避免增加默认 token 负担。

### 测试项目

- H5 游戏老项目。
- C++ / Lua 混合项目。
- TypeScript 前端项目。
- Python / Flask 项目。
- 大文件多的项目。

### 测试任务

1. 读取项目规则。
2. 建立索引。
3. 查调用链。
4. 修 bug。
5. 验证。
6. 查看缓存命中率。
7. 切换模型。
8. 开多 agent。
9. 恢复会话。
10. 读取 Codex / Claude 历史会话继续工作。
11. 抽样对账 provider usage、账号账单或额度查询。
12. 验证中转站 / 官方订阅 / 自定义脚本三类 quota 查询降级行为。

### 通过标准

- 能完成真实 bug 修复。
- 在稳定上下文、稳定工具列表、索引和 handoff 都正确工作的样本中，目标观察到常态命中率 92% - 96%；这只是真实项目测试目标，不是硬性承诺。
- 峰值可接近 98%，只能作为特定样本峰值记录，不能作为发布宣传承诺。
- 高命中率必须来自真实 usage/cache read-write tokens，并尽量用账号账单抽样交叉确认。
- Phase 15 的硬验收不是“每个项目都达到固定命中率”，而是命中率公式、来源标记、endpoint 拆分、cache break 诊断、账单/usage 抽样对账和未达标原因说明必须完整。
- Phase 15 必须加入 provider quota / balance 查询设计验证，参考 CC Switch 的 usage query 思路：官方订阅可自动查的才自动查；第三方中转站和私有服务必须走模板或自定义脚本；查不到时标记 `unknown`，不能假装知道余额。
- 预算来源必须分层展示：`local_limit`、`provider_usage`、`provider_quota`、`billing_reconciled`。其中 `provider_usage` 和 `provider_quota` 不得覆盖原始 usage，只能作为对账来源。
- quota / balance 来源必须标记：`official_reported`、`oauth_reported`、`template_reported`、`custom_script`、`estimated`、`unknown`。
- quota 查询必须默认低频、可关闭、可手动刷新；查询本身可能消耗少量 API 请求额度，UI 必须提示。
- token plan、第三方余额、中转站 quota、官方订阅次数必须区分单位和语义，不能混成同一个“余额”数字。
- 对外表述必须写清楚：这是特定模型、稳定上下文、索引和缓存保护组合下的实测，不是任意模型天然保证。
- 成本可见。
- MCP 崩溃不影响主程序。
- plan 不写文件。
- `auto-review` 减少低风险编辑审批；legacy `acceptEdits` 只作为 alias。
- 多 agent 不乱。
- P0-1 到 P0-6 全部修复并通过 focused tests / TUI smoke；尤其真实 tool_use/tool_result、EvidenceSummary、取消、文件指代、新手轻提示、默认 `LINGHUN.md` 模板成熟度和 en-US 关键路径必须可实测。
- CCB handfeel gate 全部通过；尤其真实 provider/model、default 权限不静默 Bash、本地控制面、无 pending gate 确认词、tool_result 兼容、输出分层、Windows 路径/编码、密钥脱敏、错误分类和行为矩阵测试必须可实测。
- Solution Completeness Gate 生效：真实测试中若出现跨能力系统性缺口，报告必须区分单点 bug / 系统性缺口，列出影响面、阶段处理边界、参考源和验证方式；不能只给单条修复命令。
- P0 hardening 报告已被审阅，并明确是否需要执行 Deep Parity Closure；若需要，则 Deep Parity Closure 的 P0 / 阻塞 P1 已修复，P2 已登记到 Phase 15.5。

本阶段完成后，Linghun 才算真正进入可用测试。

## 20.5 阶段 15.5：双模型交叉审查、终端 TUI 非阻塞 polish 与开源前 hardening

### 目标

Phase 15 真实项目测试完成后，增加一次只读优先的双模型交叉审查，并把非阻塞 TUI polish、模型接入成熟度、联网取证成熟度和开源前发布就绪一起复检收口，降低漏 bug、漏安全问题、漏产品体验问题和阶段边界偏移的概率。本阶段不新增 Phase 16+ 产品功能，不提前进入 Phase 16。

Phase 15 Beta 前已经必须达到 CCB 手感底线：真实 provider/model、默认权限不静默跑 Bash、控制面本地处理、主输出分层、权限提示人话、tool_result 摘要、doctor/key 脱敏、状态栏准确、hint 去重、长输出落日志和阶段汇报完整。Phase 15.5 不得把这些基础能力当作“后续再补”；它只复查真实 Beta 反馈，并修确认阻塞的 P0/P1 或非阻塞 polish。桌面端仍后置到 Phase 18；Phase 18 只验证 core/API/IPC 是否可复用，不负责补基础终端交互。

Phase 15.5 也必须复检 Solution Completeness Gate：双模型审查和真实项目测试报告中出现的缺陷，必须先分类为单点修复、系统性缺口、后续登记或不做。系统性缺口要给最小完整修复边界，避免把 Phase 15.5 变成无限补体验细节。

Phase 15.5 必须安排一次 TUI runtime maintainability hardening。`packages/tui/src/index.ts` 已长期承载 provider/model resolver、index/MCP runtime、slash dispatch、tool output formatting、background task、permission prompt、doctor/status/help、compact/context 等多类职责；当它接近或超过万行时，继续堆叠会直接增加回归、审计和接手成本。本阶段应做最小渐进拆分：只抽出现有稳定 presenter/resolver/runtime helper，保持行为不变、测试先行、每批次小 diff；不得借机重写 TUI、改公共交互、改权限语义或阻塞 Phase 15 真实项目 smoke。

Phase 15.5 必须安排一次 **Verification / Review Runtime Lite**。当前 Linghun `/verify` 已能生成验证计划、运行命令、写日志、写 `test_result` evidence，并把结果展示为 background task；但它仍是同步等待的轻量 runner，不等于 CCB 的完整后台 task / agent 生命周期。CCB 参考边界是：`VerifyPlanExecution` 只做计划完成确认，真正成熟度来自 task registry、`TaskOutput` 的阻塞/非阻塞读取、timeout、`TaskStop` 统一终止、output file、terminal status 先于慢 cleanup/classifier 更新、完成通知防重和可恢复读取。Linghun 只吸收这些行为和验收标准，不复制实现。

Verification / Review Runtime Lite 的目标是把复核从“能跑一次命令”打磨到“不会卡死、能中断、能诊断、能接续”的开源前底座：`/verify` 必须支持 abort signal、timeout 后可靠终止子进程或进程树、grace 后强制 kill、日志限流/落盘、非阻塞状态查询、stale/heartbeat 标记、完成/失败/取消/超时都写入 evidence 和 background event；`/review` 必须基于 diff、changedFiles、最近 verification、evidence refs 和风险摘要，不得把没有验证的结论说成 PASS。若 Phase 15 真实项目 smoke 中复核卡住、取消无效、长日志污染主屏或阻塞默认任务链路，必须按 Phase 15 遗漏/P1 回补；否则作为 Phase 15.5 开源前 hardening 小批次处理，不和 Batch 3.5 或 Compact Lite 混做。

Phase 15.5 可参考 OpenSpec 的公开 spec-driven development workflow，但只做 **OpenSpec-lite / Spec Delta Gate**，不引入完整 OpenSpec runtime，也不要求普通小改动填表。触发条件限定为新功能、跨模块改动、架构变化、provider/tool/permission/memory/cache 等底座变更、用户明确要求“完整设计/不要遗漏/对齐成熟度”的任务，或双模型审查确认的系统性缺口。输出应是一页短 spec：goal、scope、non-goals、affected modules、acceptance gates、required evidence、risks/rollback、deferred items；变更时记录 delta，修复后 verifier 按 spec 验收。OpenSpec-lite 不得阻塞 typo、小 bug、小文档、小测试等日常最小改动。

Phase 15 建立的是 CCB workflow parity 总基线：Phase 00-14 已声明完成的核心终端编码能力，必须先按 CCB 源码体现的真实工作流完成 inventory、mapping、阻塞修复和 workflow 级验证。后续 Phase 16-18 不再重复全量 CCB inventory，而是做 delta parity audit：只审新增能力、它们参考的成熟项目边界、是否破坏 Phase 15 已建立的默认 CCB 手感、是否引入新的权限/成本/幻觉/长期状态风险。若 delta audit 发现回归到 Phase 15 Beta 前基础手感缺口，必须按回归或遗漏处理，不能登记为普通后续 polish。

2026-05-19 Phase 00-18 Design + Runtime Overdesign Full Audit v1/v2 曾将 Phase 15 Beta 前置口径升级为 CCB Maturity Remediation，并形成历史基线 `F:\Linghun\PHASE_15_BETA_CCB_MATURITY_REMEDIATION_BASELINE.md`。该历史基线只作为 evidence / traceability，不再作为当前执行入口；当前 pre-smoke 执行基线已由 `docs/audit/phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md` 覆盖。进入 Phase 15 Beta 前，不仅要满足基础 handfeel，还必须结合最新 pre-smoke 报告和历史 baseline 中的会话上下文、provider profile contract、tool lifecycle、permission continuation、NCB 降级、TYPE-SHELL 可见面、config/Windows/operational reliability 和真实 report-generation path 验收。历史 pre-Beta closure 文档只作为证据输入，不再作为 readiness proof。

该 baseline 第 12 节 `Deferred Issue Register` 和第 13 节 `Audit Traceability Matrix` 是两份全量审计中后置问题与小类别成熟度细节的集中登记表。Phase 15.5 / 16 / 17 / 18 开工时必须从该表复制本阶段相关条目到阶段 scope，并逐项标记 DONE / DEFERRED / NOT-DO；不得依赖聊天记忆或旧 closure 文档追踪后置项与细节项。

2026-05-21 pre-smoke 状态口径：`docs/audit/phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md` 是当前 pre-smoke 执行基线，verdict 为 `READY_TO_IMPLEMENT`，不是 Beta PASS，也不是 smoke-ready。该报告 supersede “Active Docs Source-of-Truth Hardening 后直接进入真实项目 smoke”的旧下一步。Phase 15 Beta readiness 仍为 PARTIAL/BLOCKED；不得从 focused/mock/local/scoped PASS、Batch 3.5 PASS、单个 live text PASS、SKIPPED/PENDING smoke、silent-failure ban PASS 或本报告 `READY_TO_IMPLEMENT` 推断 Beta readiness PASS。Batch A 四权限模式收口和 Batch B Architecture Runtime source-of-truth 设计已完成；当前下一步只能在用户明确确认后进入 Batch C：Architecture Runtime 最小成熟实现。Batch C 完成并重新验收前不得进入真实项目 smoke，也不得宣布 Beta PASS。后续阶段接手时除 baseline 第 12/13 节外，还必须复制最新 pre-smoke 报告和 reconciliation 中的 pull-forward / keep-deferred 决策：`PRE_SMOKE_BLOCKING` / `PRE_SMOKE_PULL_FORWARD` 必须在 smoke 前闭口，`BETA_WATCH` 必须进入真实测试观察表，`PHASE_15_5` / `PHASE_16` / `PHASE_17` / `PHASE_18` / `NOT_DO` 不得因聊天记忆或旧审计口径回流为当前必做项。历史 audit、历史 PASS、READY、READY_TO_FIX、READY_FOR_USER_DECISION 和聊天记忆只能作为 evidence，必须被 README、START_NEXT_CHAT、docs/delivery/README、本蓝图和最新 pre-smoke 报告覆盖。若后续阶段发现某个后置项实际影响普通请求 -> model -> tool_use -> permission -> tool_result -> continuation -> final answer 默认链路，必须按 Phase 15 遗漏处理，而不是登记为普通后续 polish。Bundled codebase-memory Lite / Batch 3.5 仍按独立任务推进，当前不得假设 `docs/audit/phase-15-bundled-codebase-memory-lite.md` 已完成。

Phase 15 Pre-Beta Red Flag Sweep 进入后续阶段的登记规则：

- Phase 15.5 release/security hardening：集中处理 durable artifact 脱敏边界，覆盖 transcript、tool_result、handoff、report、debug bundle 和默认日志；不把完整 prompt、API key、私有 baseUrl query、用户 home path 或项目私有路径写入可公开材料。
- Phase 15.5 provider maturity：收口 baseUrl query/fragment 诊断、advanced endpointProfile/reasoning knob 的用户口径、OpenAI-compatible / Claude-compatible gateway 与 native provider 的能力差异、usage/cache/quota/error/fallback 来源标记；不做静默 profile fallback。
- Phase 15.5 editing UX hardening：Linghun 已有 `Write` / `Edit` / `MultiEdit` 底座，但开源前必须补齐 CCB-grade 文件编辑体验：read-before-edit、唯一匹配失败提示、structured diff / patch 摘要、权限审批 diff preview、rejected edit 可理解反馈、stale file / Windows 路径 / 编码换行边界和回归测试。该项是终端开源前 hardening，不得误判为“已经有工具所以无需验收”。
- Phase 15.5 verification/review runtime hardening：收口 `/verify`、`/review`、background task 和 evidence 的 CCB-grade 复核手感，覆盖 abort/cancel、timeout/kill、非阻塞状态、stale/heartbeat、日志限流、完成通知防重、`/details background|output` 可追溯和 review 不夸大 PASS。不得把一次 focused PASS 或 runner partial 包装成整体 readiness。
- Phase 15.5 TUI polish：只做真实 Beta 反馈和非阻塞手感细节，例如报告路径确定性提示、无显式报告文件名时的安全建议、help/doctor/hint 可扫读、轻量 block/panel；不得补 Phase 15 Beta 前已经要求的基础状态/doctor/权限/report gate。
- Phase 16：只承接学习、记忆和 skill evolution 的候选生成、证据阈值、accept/reject/retire/stale/conflict、成本 guard 和 cache 稳定性；不得借 Red Flag Sweep 自动写长期记忆或把完整 transcript 注入 prompt。
- Phase 17：只承接 unattended / durable job runbook、approval handling、job report、remote channel 脱敏摘要和幂等审批；真实 Beta 的手动审批脚本先按 runbook 处理，不提前做远程自动托管。
- Phase 18：只验证 core/UI/API/IPC 能否复用到桌面壳；MCP 市场、完整桌面端和长期自治仍不得回流到 Phase 15 或 15.5 的必做范围。

### 审查输入

- Phase 00-15 交付文档。
- 当前 git diff 或 Phase 15 完成提交。
- Phase 15 真实项目测试报告。
- 测试命令和结果。
- 已知风险和不在本阶段处理的内容。
- CCB Dev Boost 对照清单。
- 当前缓存、索引、记忆、agent、多模型、权限和存储设计证据。
- 对复杂任务或系统性缺口，附 OpenSpec-lite spec/delta；没有触发条件时明确写 not needed，不能为小改动制造流程负担。

### 模型分工

- 模型 A：GPT-5.5 / Claude 或同级强推理模型，做产品与架构审查。
- 模型 B：DeepSeek V4 Pro 或同级强代码模型，做代码与安全审查。

### 审查范围

模型 A 重点检查：

- 是否偏离 Linghun 蓝图。
- 是否阶段边界混乱。
- 是否复制可疑实现或引入 clean rewrite 风险。
- 是否过度复杂化。
- 是否用户交互不清楚。
- 是否新手可用。
- 缓存、索引、记忆、agent、多模型是否冲突。
- 是否有隐藏长期维护风险。

模型 B 重点检查：

- 代码正确性和边界条件。
- 文件写入安全、路径穿越、权限绕过。
- 并发状态污染。
- 大文件、大输出、大日志处理。
- Windows 兼容。
- 测试覆盖缺口。
- 真实项目回归风险。

### 必做

- 两个模型都必须只读审查，不自动改代码。
- 两份报告都按 P0 / P1 / P2 输出，必须给文件证据、风险说明、最小修复建议和是否阻塞。
- 模型 A 复核模型 B 报告中哪些代码问题影响产品方向或阶段边界。
- 模型 B 复核模型 A 报告中哪些问题真实、哪些缺证据、哪些需要最小测试。
- 主模型或人工最终裁决，形成统一问题表：问题、来源模型、严重级别、是否确认、是否阻塞、修复阶段、最小修复方式、验证命令。
- Beta 实测期间可以按 P0/P1/P2 分类；只修 P0 和确认后的 P1，非 terminal-scope P2 可登记后续，不在 hardening 中无限扩范围；终端开源发布前 terminal-scope P0/P1/P2 必须清零、降级为 NOT-DO，或证明 out-of-scope。
- 对触发 OpenSpec-lite 的任务，修复前先确认短 spec，修复后按 acceptance gates 和 required evidence 验收；未触发时不得把 OpenSpec-lite 当作必经流程。
- 修复后必须重新运行 Phase 15 关键验证命令，并更新本阶段交付文档。

### 开源前发布就绪检查

Phase 15.5 还必须补一次 release readiness / open-source readiness 审查，目标是确认项目可以被个人开发者安全安装、配置、排查和回滚，而不是只在作者机器上可用。

Phase 15.5 必须拆出独立的 **MCP / Skills / Plugins Connect Lite** 小阶段。该小阶段只对齐 CCB 的成熟安装与管理闭环：本地/GitHub/URL 来源安装、manifest / SKILL.md 验证、enable/disable/remove/update、trust notice、doctor、来源/commit/权限记录、失败隔离和 discovery-before-execute。它不得扩展成插件市场、技能市场、评分推荐、自动更新、云同步或复杂沙箱；若审查发现需要市场化能力，只登记到后续，不阻塞 Connect Lite。

Phase 15.5 还必须拆出 **Bundled codebase-memory Lite** 小阶段或在 Phase 15 Beta 前尾项单独完成。它只做“用户不用手装索引器”的成熟底座：随包固定版本或受控本地安装、binary path/version doctor、artifact/status doctor、缺失/损坏清晰降级、license/NOTICE、`/index status` 默认 fast/local、`/index status --fresh` 或 `/index check` 才做慢 detect_changes。不得做自研索引引擎、完整 MCP 市场、自动全量重建或后台常驻重索引。

必须检查：

- 安装包、CLI 入口、Windows `linghun` / `Linghun` shim、`--version`、`--help` 和基础 doctor。
- 配置路径、数据路径、日志路径、跨盘项目、中文路径和长路径。
- API key / token 存储：正式版必须走系统 keychain 或等价安全存储；若仍使用环境变量/本地配置，必须标明阶段限制并避免写入 transcript、日志、交付文档。
- provider/base_url/model 配置错误时有中文 doctor 和最小修复建议。
- crash report / debug bundle 只包含脱敏摘要、版本、平台、命令、错误码和必要日志路径，不包含 key、原始账单、完整 prompt、完整 transcript 或私有大文件内容。
- 升级、降级和回滚策略：配置 schema 变更必须有版本号、迁移说明和失败回退。
- 工具执行不变量：MCP tool、plugin command、skill action、workflow/hook 贡献工具或延迟加载工具，必须先 discover/register/trust/load schema，才能进入执行层；未发现、未信任、schema 未加载或版本不兼容时，runtime 必须拒绝执行并提示先搜索/启用/诊断，不能只靠 prompt 约束模型。
- discovery-before-execute 必须有 focused tests：未发现的延迟工具直接执行会被拒绝；已发现且 schema 已加载后仍必须走 Start Gate 或权限管道；错误提示不得 dump 完整 schema、key 或敏感配置。
- `Write` / `Edit` / `MultiEdit` 开源前必须达到 CCB-grade 成熟度：编辑前读取确认、编辑失败原因可操作、权限审批能看到 diff/影响范围、成功后有 changedFiles / patch 摘要、拒绝后模型能收到可调整的 tool_result、外部修改或多重匹配不会静默覆盖。
- README / START_NEXT_CHAT / docs/delivery 口径一致，不宣称未完成阶段能力。

### 模型接入成熟度收口

Phase 13 的目标是多模型角色路由闭环；Phase 15.5 必须把模型接入从“能配置、能路由”打磨到“可诊断、可对账、可 fallback、可开源给个人开发者使用”。中转站大多兼容 OpenAI 或 Claude 接口，但兼容接口不等于能力、错误、usage、cache、quota 和 tool calling 语义完全一致。

必须收口：

- Provider adapter 成品级验收：每个 adapter 不只验证返回文本，还必须验证事件转换、streaming/非流式降级、tool calling 能力声明、usage 映射、prompt cache 字段映射、model metadata、错误归一化、配置诊断和 focused tests。
- Provider profile 分层：区分 `openai_native`、`anthropic_native`、`deepseek_native`、`openai_compatible_gateway`、`claude_compatible_gateway`、`custom_http`、`unknown`；第三方中转站不得伪装成官方 provider。
- Capability registry / doctor：记录并诊断 tool calling、vision、image、reasoning effort、prompt cache、JSON schema、max context、max output、streaming usage、quota query 等能力；缺失时 `BLOCK` 或 `WARN`，不能假装支持。
- Role route policy：planner、executor、reviewer、verifier、summarizer、vision、image 的能力需求必须可检查；不匹配时 `/model route doctor` 给出角色、provider/model、缺失能力、fallback 和中文修复建议。
- Usage/cache 归一：input/output/cache read/cache write/cache creation 必须按 provider 字段映射，来源标记 `reported`、`zero_reported`、`missing`、`estimated`、`unknown`；`cache_creation_tokens=0` 只能解释为 provider 字段口径，不能说成零成本。
- Quota/balance 查询：参考 CC Switch、LiteLLM/OpenRouter 等公开行为和边界，只做来源标记和手动/低频查询；官方 OAuth/订阅、第三方中转站、自定义脚本、不可查询必须区分，不能把 token、credits、requests、CNY/USD、订阅次数混成一个余额数字。
- Provider error classifier：key 缺失、baseUrl 错误、model 不存在、quota 不足、rate limit、tool 不支持、gateway 返回格式异常、网络超时、HTML 错误页必须被归类成人能处理的 doctor 输出。
- Fallback / retry policy：降级必须可见，记录原模型、fallback 模型、原因、是否保留工具能力、是否影响 cost/cache 统计；不得静默切模型。
- 配置体验：环境变量、本地 config、系统 keychain 的优先级必须明确；key 不进入日志、transcript、debug bundle 或交付文档；`/model provider doctor` 或等价 doctor 必须能给出最小修复路径。

验收至少覆盖：

- OpenAI-compatible 中转站、DeepSeek、OpenAI native、Claude/Anthropic native 或 mock native adapter 的配置诊断路径；未实现 native adapter 时必须标记 pending/unsupported，不得假装已支持。
- role route doctor 对 planner/executor/reviewer/verifier/summarizer/vision/image 的 OK/WARN/BLOCK。
- usage/cache 字段缺失、0、reported、estimated 的分支。
- quota/balance unknown、custom_script、gateway reported 的分支。
- provider 错误分类的中英文提示。
- fallback 发生时 transcript / usage / handoff 中有可审计记录。

### 联网取证 / Freshness Gate 收口

Phase 15.5 必须把“允许有边界地联网取证”做成成品级交互，而不是一刀切禁止联网，也不是让模型在本地资料过期时胡说最新信息。

必须收口：

- Freshness-sensitive 分类：最新版本、社区现状、provider/API 文档、模型价格、quota 政策、安全公告、法律/政策、第三方项目状态默认需要新鲜证据。
- 本地证据降级：本地索引、旧文档、旧审计报告和 memory 只能说明“已知到某时间点”，不能支撑“最新/当前”结论。
- 联网授权交互：未授权联网时必须先说明为什么需要联网、优先查哪些公开来源、是否继续；不得静默联网。
- 官方来源优先：官方 docs、release notes、GitHub repo、provider docs、标准文档优先；社区文章只能作为辅助证据。
- 失败降级：联网失败、权限拒绝、来源冲突或来源不可信时，必须说明无法确认，并给出继续本地分析或重新授权联网的下一步，不得卡死。
- evidence 写入：WebSearch / WebFetch 结果必须写入 `web_source` evidence，包含 URL/source、查询时间、短摘要、freshness 状态和支持的 claims。
- prompt 控制：不把完整网页、完整 PDF、完整 release 列表、大搜索结果塞回 prompt；只传摘要、链接和 evidence id。
- 权限边界：agent、workflow、plugin、hook、remote channel 发起联网仍走 Start Gate 或权限管道，不能借 Web Evidence 绕过审批。
- 输出口径：最终回答必须写清“已联网查询/未联网/联网失败/来源冲突”，不能把模型记忆说成实时事实。

验收至少覆盖：

- 用户问“OpenCode 最新版本改了什么”时，未授权联网会提示需要查官方 release/repo。
- 已授权联网时，输出来源链接、查询时间和 `web_source` evidence 摘要。
- 联网失败时，输出降级说明和下一步，不给假结论。
- 本地文档存在但可能过期时，回答必须标记 “本地资料可能过期”。
- 插件/workflow/agent 请求联网时仍触发 Start Gate 或权限管道。

### 终端 TUI 非阻塞 polish 与复检

Phase 15.5 必须参考 CCB 的公开终端编码体验边界、OpenCode 的公开 output grouping / visual hierarchy 思路，以及 Warp 的公开 block/panel 现代终端体验，但只吸收行为、层级和验收标准，不复制源码或内部实现。目标是让 Linghun 成为轻量、可扫读、可展开的工程终端：好看但不重，现代但不牺牲速度、权限边界、证据链、cache 命中和真实开发效率。下列条目中属于 Phase 15 Beta 前基础手感的部分必须已经闭合；Phase 15.5 只做复检、非阻塞 polish 和真实 Beta 反馈修复。

Compact Lite 属于 Phase 15.5 的开源前 hardening，不回写 Phase 11。它复用 Phase 11 的 handoff packet 和 evidence 底座，但实现边界放在本阶段：上下文诊断、自动 MicroCompact、手动 `/compact`、受控 auto compact、CompactBoundary 记录和 bounded restore。不得把完整历史聊天、完整工具输出、完整索引或完整 MCP schema 重新塞进 prompt；接近上下文阈值时必须有轻提示，不得静默频繁调用 summarizer；压缩失败必须保留原会话并给出重试、取消或 handoff 选项。

Compact Lite 必须参考 CCB 已有公开/本地可读行为边界，而不是凭空设计。CCB 的成熟方向是三层递进：MicroCompact 自动清理旧工具输出且不调用 API；Session Memory Compact 优先复用已有会话记忆且不调用摘要模型；传统 `/compact` 或自动回退才调用模型摘要，并用 compact boundary 标记压缩边界。Linghun 只吸收这些行为和验收标准，不复制实现。

Compact Lite 的默认策略必须兼顾新手和可靠性：

- **MicroCompact auto 默认启用**：只做本地上下文修剪，不调用 summarizer，不执行工具，不改文件；仅将旧的大工具结果、长日志、重复 index/search/read/grep/bash 输出从模型上下文移出，原始内容继续保留在 transcript/evidence/log/fullOutputPath；必须记录 microcompact boundary、pre tokens、tokens saved、compacted tool ids 或等价字段。
- **Manual `/compact` 保留**：用户显式触发完整语义 compact；执行前先写 HandoffCheckpoint，执行后写 CompactBoundary，记录 compact type、pre/post token estimate、保留摘要、evidence refs、preserved segment、被移出 prompt 的大输出引用和恢复方式。
- **Guarded auto compact 可选**：接近 context window 阈值时默认先轻提示；只有用户显式开启 autoCompact 或运行在明确允许的长期任务/自动会话模式时，才允许自动完整 compact。完整 auto compact 必须有单次触发限制、cooldown、timeout、cancel/retry，不得进入频繁 compact 循环。
- **失败可恢复**：compact 开始前必须先落盘 HandoffCheckpoint；compact 超时、失败或用户取消时，必须保留原会话、transcript/evidence/log 和当前 prompt 状态，并输出新会话恢复命令或 handoff 路径，不能像黑盒一样卡在 compacting。
- **API/tool invariant**：裁剪窗口时必须保护 tool_use/tool_result 配对、assistant thinking/tool blocks 的同源消息边界和最近用户目标；不得切出会导致 provider 400 的半截工具对。
- **成本/cache 边界**：MicroCompact 不应破坏稳定 prompt prefix；完整 compact 会改变 `compactHash`，必须进入 cache freshness 维度并在 `/cache` / `/usage` 可诊断。若调用 summarizer，必须走 summarizer role、token 上限、超时和失败降级。
- **禁止项**：不得在 compact 过程中执行工具、写文件、启动新的开发任务、自动进入下一阶段、写长期记忆、塞完整 transcript/index/MCP schema 进摘要，或把 compact 失败伪装成完成。

Warp / OpenCode / CCB 参考边界：

- CCB 负责定义编码主链路手感：权限/提权、Plan、tool_use/tool_result、错误 doctor、状态栏和轻提示必须服务真实开发，不把内部调试暴露给用户。
- OpenCode 负责补充输出组织和视觉层级：tool part、pending 状态、summary-first、块状工具输出和配置化 TUI 入口可以参考行为，不复制实现。
- Warp 负责补充现代终端产品感：命令/输出 block、成功/失败/耗时/exit 状态、Command Palette、可搜索 workflow/runbook、块级上下文等可以作为 Phase 15.5 polish 参考。
- Linghun 不做重 GUI、不做常驻侧边栏、不做动画/鼠标重交互、不做云同步 workflow/notebook、不把所有面板铺进主屏、不为了美观增加 prompt 长度或破坏 cache prefix。
- 所有 block/panel 都必须由已有结构化事件、evidence、logPath、fullOutputPath、RuntimeStatus 和 Command Capability Catalog 派生；不得创建第二套事实来源。

必须收口：

- 启动页和首屏：项目、provider/model、权限模式、规则、index/cache/memory 状态必须短而清楚；缺失项给下一步，不制造恐慌。
- 状态栏：只显示 scan-friendly 短字段；不显示金额、长 hash、raw risk flags、完整路径、完整 schema 或大日志；宽度不足时按优先级降级。
- `/help`：按常用任务分组，不再让新手面对一整屏无层级命令；每组给短用途和安全边界。
- block/panel 输出：每个模型轮次、tool call、Bash、verification、permission、report-generation、agent/job 更新默认呈现为短 block：名称、状态、耗时、影响文件、evidence id、下一步；长输出默认折叠到 `/details`、logPath 或 fullOutputPath。
- Write/Edit/MultiEdit 输出：默认显示文件、操作类型、added/removed 或 patch 摘要、changedFiles、evidence id 和下一步；长 diff 进入 `/details` 或 log/fullOutputPath。不得用 Bash redirection 代替报告写入或普通文件编辑；模型请求编辑仍必须走权限管道。
- Command Palette Lite：增强 `/help` / `/commands` / 自然语言用途查询即可，按 model/cache/index/tools/memory/permissions/debug 分组；显示用途、风险、是否写文件、是否需要确认；不引入复杂 GUI palette。
- Run history / beta run 记录：真实测试每轮可产生轻量 run block 和报告路径，支持一轮一轮查看，不把完整 transcript 或大日志塞进 prompt。
- Context chips lite：只显示短上下文引用，例如 `LINGHUN.md`、当前报告、evidence id、index ready、cache source；模型只接收短摘要和 evidence 引用。
- 渐进披露：默认 help/首屏只展示推荐路径；`/help all`、`/features`、`/config advanced`、doctor details 和自然语言用途询问必须能发现完整能力，不得因为新手模式让高级功能不可达或不可诊断。
- Start Gate / 权限 / 提权：统一 human-first 卡片，默认显示动作、范围、风险、为什么需要确认、继续方式和取消方式；内部 gateId、expiresAt、raw flags、logPath、permissionPipeline 只在 debug/details 中显示。
- `default`、`plan`、`auto-review`、`full-access`：每种 canonical 模式的“能做什么、不能做什么、是否会写文件、是否仍需权限审批”必须在交互中可见，不能靠用户猜；旧模式名只在 legacy alias 迁移提示中出现。
- 错误和 doctor：provider/key/baseUrl/model、index、MCP、plugin、skill、hook、workflow 出错时必须给“发生了什么、可能原因、下一步命令”，不只输出用法。
- 轻提示：长任务、复检、索引、验证、agent、多模型审查必须显示预计时间范围、是否需要用户值守、完成后会产出什么、如何查看后台和如何取消；等待确认时必须明确“正在等你确认，不会继续执行”。
- 输出层级：默认只显示 primary summary；details/debug/raw 通过显式命令或展开查看。大输出、完整日志、完整 memory、完整 handoff、完整 index 结果不得塞进主消息流或 prompt。
- Compact Lite：`/context` 显示上下文组成短摘要；默认自动 MicroCompact 只从模型上下文清理旧大工具结果，原始内容继续留 transcript/evidence/log/fullOutputPath；`/compact` 手动生成结构化摘要和 CompactBoundary；可选 autoCompact 只在阈值、用户 opt-in、HandoffCheckpoint、timeout/cancel/retry 和 cooldown 均满足时执行完整 compact。完整语义树、后台频繁自动总结、compact 中工具执行、compact 中写文件和失败后继续烧 token 均不得进入 Phase 15.5。
- `packages/tui/src/index.ts` maintainability：拆分 provider/model resolver、index/MCP runtime、doctor/status/help presenter、tool output/background/permission/compact-context 等稳定职责；每次拆分必须保持行为不变并有 focused tests，禁止在同一批次混入新功能、UI 重写或权限语义变化。
- 自然语言交互：状态/完成度查询必须优先读取本地 RuntimeStatus，不得因为句子里有“建立/打开/配置”等动作词就误开 Start Gate；动作请求再进入 Start Gate 或权限管道。
- cache/index/memory/model/agent/multi-model 面板：默认短摘要，展开后再看证据、来源和诊断；所有来源必须标记 reported / estimated / missing / unknown。
- 中英文一致性：同一 capability 的中文和英文文案必须语义等价；默认语言下不混用半成品提示。
- 窄终端和 Windows：中文路径、长模型名、长 provider、长状态栏、resize、多行粘贴不能撑爆、错位或遮挡输入。

终端 TUI 验收至少覆盖：

- 启动首屏、缺少 `LINGHUN.md`、缺 provider/key、index missing/ready/stale、cache status、memory status。
- `/help` 分组、`/help all` 完整发现、`/features` 风险说明、自然语言问状态、自然语言问用法、自然语言发起安全动作、自然语言发起危险动作。
- Start Gate、权限审批、提权说明、`plan`、`auto-review`、`full-access` 和 legacy alias normalization 的核心交互。
- 长任务轻提示：索引、验证、agent、双模型审查、复检。
- Verification / Review Runtime Lite：`/verify plan` 只展示计划；`/verify` 运行时可 `/background` 查看状态、可 `/interrupt` 或等价 cancel 终止；timeout 后进程不残留；长输出只进日志/`/details output`；`/verify last`、`/review` 和 claim-check 使用同一份 verification evidence；失败、partial、cancelled、timeout 不得显示成 PASS。
- provider/model doctor、MCP doctor、plugin/skill/hook/workflow doctor。
- Write/Edit/MultiEdit：read-before-edit、单点 edit、多点 edit、多重匹配失败、未找到 oldText、拒绝审批、批准后 changedFiles/diff 摘要、外部修改/stale file 和 Windows/中文路径。
- zh-CN 和 en-US 基础路径。
- 文本 snapshot / TUI smoke / 窄宽度渲染测试。
- block/panel snapshot：tool block、permission block、verification block、diagnostic panel、run summary 在 80/120/160 宽度下不撑爆、不遮挡输入。
- cache 回归：polish 不得增加额外模型调用，不得把 raw details 放入 prompt，不得破坏稳定 system prompt/tool schema/MCP tool list 前缀。

### 验收

- 有两份独立审查报告。
- 有交叉复核记录。
- 有最终裁决表。
- P0 全部修复或明确说明无法发布。
- 确认阻塞的 P1 已修复或降级并说明风险。
- Beta 实测期间的 P2 必须区分 terminal-scope 与 non-terminal-scope；非 terminal-scope P2 可记录到后续阶段，不阻塞 Phase 16；终端开源发布前 terminal-scope P0/P1/P2 必须清零、降级为 NOT-DO，或证明 out-of-scope。
- release readiness 检查有独立小节，列出安装、配置、keychain、doctor、日志脱敏、版本回滚、discovery-before-execute 工具 guard 和文档同步结果。
- Solution Completeness Gate 有独立记录，列出本阶段发现的问题如何区分单点 bug / 系统性缺口、哪些 P0/P1 已修、哪些 P2 登记后续、哪些明确不做。
- OpenSpec-lite / Spec Delta Gate 有独立小节：列出哪些任务触发、短 spec/delta、验收证据，以及哪些小改动明确未触发以避免过度流程化。
- Verification / Review Runtime Lite 有独立小节：列出 `/verify`、`/review`、background task、cancel/timeout/stale、log/evidence、non-blocking status 和 review verdict scope 的验证结果；若仍只是同步 runner，必须保守标为 PARTIAL，不得宣称 CCB-grade verifier。
- 模型接入成熟度有独立小节，列出 adapter/profile/capability doctor/role route/usage-cache/quota/error/fallback/config 验证结果。
- 联网取证成熟度有独立小节，列出 Freshness Gate、授权联网、官方来源优先、web_source evidence、失败降级和 prompt 控制验证结果。
- 终端 TUI polish / 复检有独立小节，列出首屏、状态栏、help、Start Gate、权限/提权、错误 doctor、轻提示、输出层级、自然语言状态查询、zh/en 和窄终端验证结果；若发现 Phase 15 Beta 前应已满足的基础手感缺口，必须标为回归或遗漏，不得登记成普通 Phase 15.5 新需求。
- 本阶段不新增 Phase 16+ 功能，不改变既定阶段边界。

## 21. 阶段 16：可控学习闭环

### 目标

把“越用越聪明”做成可控能力，而不是后台偷偷学习、偷偷改规则。

### 参考

- 用户原始想法中的“越用越聪明”。
- Hermes 的 MEMORY / USER / Skill 固化思路。
- CCB 的自动记忆和 CLAUDE.md 多层加载。

### 产物

- 候选记忆提取。
- 候选 Skill 提取。
- 用户确认写入。
- 记忆分级。
- 记忆审查面板。
- 记忆回滚。

### 必做

- 项目级记忆：项目架构、常用命令、坑点、部署方式、业务规则。
- 用户级记忆：语言偏好、默认模型、审批偏好、最小改动偏好。
- 会话级临时记忆：只在当前任务中生效。
- 成功任务可生成候选 Skill。
- 写入长期记忆前必须让用户确认，或由用户明确开启自动确认。
- 错误记忆可删除、禁用、回滚。
- 默认不每轮学习；只有任务完成、验证结束、用户明确要求、workflow 收尾或阶段交付收尾时，才生成候选记忆或候选 Skill。
- 普通聊天、临时插问、失败的中间尝试和未经验证的猜测默认不得进入长期记忆候选。
- 候选提取优先基于结构化 evidence、Todo、验证报告、handoff packet 和用户确认内容；需要模型总结时必须走低成本 summarizer role，并设置 token 上限。
- 自动接受长期记忆默认关闭；用户明确开启后也必须可随时关闭，并能查看最近自动接受记录。
- 每轮上下文注入只能使用与当前任务相关的少量记忆摘要，不得把完整 memory store、完整历史经验或完整 Skill 全文塞进 prompt。
- 自动学习必须服从降本：默认不增加主链路模型调用，不破坏 cache-first / summary-first，不因学习而让普通请求变慢、变贵或更难诊断。

### 交互

```text
/memory
/memory review
/memory accept
/memory delete
/skills propose
```

### 性能要求

- 不把大段对话直接塞进长期记忆。
- 记忆摘要必须短小稳定，避免破坏 prompt cache。
- 记忆检索必须按项目和任务相关性过滤。
- prompt 注入默认 top-k 限制，建议 3-5 条相关记忆；每条记忆必须有最大字符数。
- `memoryHash` 只能基于稳定摘要、scope、status 和排序后的 id 计算，不能因为时间戳、访问次数、最近查看时间或随机顺序导致 cache freshness 抖动。
- 记忆列表、Skill 候选和注入摘要必须稳定排序。
- `/memory stats` 或等价视图必须显示候选数、已接受数、禁用数、本轮注入条数和估算 token。
- 记忆学习不能在前台每轮额外调用高成本模型；需要总结时必须可见、可限额、可关闭。
- Phase 16 开工时必须先设 Cost Guard：记录学习触发原因、调用模型、token 上限、候选数量、注入条数和估算 token；如果某类学习不能减少重复读取、重复解释、错误率或后续 token，就不得默认开启。

### 验收

- 完成一次 bug 修复后，能生成候选经验。
- 用户确认后写入项目记忆。
- 新会话能基于这条记忆少走弯路。
- 删除错误记忆后不再影响后续回答。
- 普通聊天和 `/btw` 不会自动生成长期记忆候选。
- `/memory stats` 能显示本轮注入条数和估算 token。
- 关闭自动学习后，不再自动接受长期记忆。
- 启用自动学习后，普通编码请求的默认路径不能额外增加前台学习调用；学习失败或预算不足时必须降级为不学习，而不是阻塞主任务。

本阶段完成后，Linghun 才具备真正可控的“越用越聪明”。

## 22. 阶段 17：长期托管任务与自动会话

### 目标

把 CCB 中分散的 daemon、background sessions、job、cron、proactive、Agent 能力，产品化成可控的长期托管任务。用户可以让 Linghun 定时醒来，自动创建新会话、多开 agent 继续工作，完成后生成报告；遇到高风险则暂停等待用户确认。

### 参考

- CCB feature 方向：`DAEMON`、`BG_SESSIONS`、`TEMPLATES`、`KAIROS`、`PROACTIVE`、`BRIDGE_MODE`。
- CCB Agent 生命周期。
- CCB Cron / job 类能力。
- 当前蓝图的 Session、Agent、权限、缓存、会话恢复能力。
- oh-my-openagent 的 team mode / background lifecycle 方向，只参考任务编排、成员状态和报告形态，不复制实现。
- 飞书/Lark CLI、钉钉 CLI、企业微信 wecom-cli 等官方或官方团队开源 CLI，可作为 Remote Channels 的优先 adapter 参考，只参考公开命令边界、认证模式、JSON 输出、AI Agent skills 和失败诊断，不复制实现。

### 产物

- 长期任务定义。
- 定时调度器。
- 后台会话创建。
- 自动会话 handoff packet。
- 自动 agent 分工。
- Remote Channels。
- Official CLI adapters：Feishu/Lark、DingTalk、WeCom。
- 预算限制。
- 风险暂停。
- 任务日志。
- 结果报告。
- 后台任务折叠、恢复和中断入口。
- Team / job 状态表。
- Agent assignment report。

### 阶段边界

Phase 17 必须分层交付，避免把长期任务、远程通道、多 agent 团队化和 IM adapter 一次性做成沉重系统：

- **Phase 17A local durable jobs**：只要求本地长期任务、定时唤醒、后台会话、handoff 校验、预算/超时/取消、风险暂停、job report 和本地 TUI 状态可见。17A 通过后才算具备可控长期托管底座。
- **Phase 17B remote channels / adapters**：只在 17A 稳定后开启，默认关闭；先做一个最小通知或审批 adapter / mock adapter，证明脱敏、去重、过期、来源校验和失败降级，再考虑更多通道。
- Remote Channels、Official CLI adapters、Team / job 状态表高级视图和多 agent 展示不得阻塞 17A；如果它们不成熟，必须降级为 disabled / unsupported / planned，并给 doctor 建议。
- 成熟参考只吸收边界和验收：durable job、resume、audit log、budget、approval、diagnostic、failure downgrade。不得引入完整 IM SDK、复杂分布式调度、全自动多阶段推进或第二套 agent runtime。
- Phase 17 不得改变 Phase 15 已建立的 provider/tool/permission/evidence 主链路，也不得为了后台任务增加前台默认 token、默认远程推送或默认多 agent。

### 必做

- 任务名称。
- 项目路径。
- 任务目标。
- 目标阶段。
- 运行计划。
- 最大运行时间。
- 最大 token。
- 最大费用。
- 是否允许编辑。
- 是否允许 Bash。
- 是否允许多 agent。
- 是否需要先输出 plan。
- 是否需要用户审批后写入。
- 每个长期任务必须有结构化任务图：目标、阶段、子任务、agent 分工、依赖关系、验收标准、预算、超时和停止条件。
- team mode 只能作为 job / agent 状态表呈现，不允许把多个 agent 的原始聊天长流直接混进主消息区。
- agent 分工必须显式：role、模型、权限、允许工具、输入摘要、输出格式和预算。
- 自动工作默认一次只推进一个阶段；完成阶段后必须停止并输出交付文档、验证结果和 handoff packet。
- 连续阶段模式必须作为高级危险开关由本地用户单独 opt-in；默认关闭，不能被模型、自然语言、agent、workflow、job、hook、plugin 或 remote channel 自动开启。
- 连续阶段模式只允许“自动排队下一阶段的准备工作”，不允许跳过阶段审核；每个阶段之间仍必须生成独立交付文档、验证结果、handoff packet 和用户确认点。
- 普通“继续”“确认”“好的”不能作为跨阶段授权；跨阶段继续必须明确目标阶段或明确任务目标，并记录到 job 报告和 handoff。
- 自动新会话必须读取 `LINGHUN.md`、阶段状态、最近 handoff packet、Todo、验证结果和索引状态，不得塞入完整历史聊天。
- 自动新会话启动前必须校验 handoff packet 的 `nextPhase`、`mustNotDo`、`permissionMode`、`verification`、`evidenceRefs`、`indexStatus`、`model/provider` 和 `budgetUsed`。
- handoff packet 不完整时，job 必须暂停为 `needs_handoff_repair` 或等价状态，并输出需要补齐的字段，不能继续自动执行。
- job 报告必须记录读取的 handoff id、新建 session id、模型/provider、预算使用、验证结果、风险暂停原因和下一步建议。
- job 报告必须记录 agent assignment、每个 agent 的输入摘要、输出摘要、证据引用、验证结果和是否被采纳。
- Remote Channels 支持微信、飞书、QQ、钉钉、Telegram/Discord 等通道方向，但默认关闭。
- 飞书/Lark、钉钉、企业微信如果已有官方或官方团队 CLI，Phase 17 优先走 CLI adapter 方案，而不是直接自研完整 IM SDK；CLI 不存在、权限不足或输出不稳定时必须降级为 disabled / unsupported，并给出 doctor 建议。
- Official CLI adapter 必须只把 Linghun 的结构化 remote event 转成外部 CLI 调用，不能让外部 CLI 直接读取完整 transcript、memory store、API key、账单或项目源码。
- 手机/IM 通道只发送命令、摘要、审批和结果报告，不推送完整上下文。
- Remote Channels 必须具备反重放、过期时间、nonce 或消息 id、签名或等价来源校验、设备绑定/解绑、审批幂等、重复消息去重和审计日志。
- Remote Channels 的审批消息必须只包含任务摘要、风险、diff 摘要、命令摘要和确认选项；不得发送完整 prompt、完整 transcript、API key、账单明细或私有大文件内容。
- 高风险操作必须暂停等待用户明确审批。
- 后台任务在 TUI 状态栏显示数量和最近状态；费用详情放 `/usage` 或 `/stats`，不默认挤进状态栏。
- `/background` 和 `/job report` 必须以状态表、任务图和结构化报告为主，原始日志只能通过日志路径查看。
- 后台任务日志可随时打开，不需要等任务结束。

### 交互

```text
/job new
/job list
/job run
/job pause
/job resume
/job logs
/job report
/remote channels
```

### 安全闸门

- 默认关闭。
- 必须由用户明确开启。
- 超预算停止。
- 超时间停止。
- 连续失败停止。
- 高风险操作暂停。
- 模型不确定时暂停。
- 写文件前可要求计划审批。
- 远程触发默认关闭。
- 远程通道必须有来源校验、用户绑定、命令白名单和审批记录。
- 远程通道必须拒绝过期消息、重复 nonce、未知设备、签名不匹配消息和未绑定用户消息。
- 用户必须能随时解绑远程设备、暂停某个通道、查看最近审批审计记录。
- 远程通道失败不影响本地 TUI 和正在运行的任务。

### 性能要求

- 后台任务不能拖慢前台 TUI。
- 每个自动会话必须独立 transcript。
- 任务运行必须可中断。
- 任务成本必须可追踪。

### 验收

- 创建一个每天运行的只读检查任务。
- 到时间自动创建会话。
- 自动读取项目记忆和索引状态。
- 自动会话使用 handoff packet 交接，不重复塞完整历史。
- handoff packet 不完整时自动任务暂停，不继续烧 token。
- 必要时开 explorer / verifier。
- `/job report` 能显示任务图、agent 分工、预算使用、验证结果、被采纳结论和暂停原因。
- 生成报告。
- 不进行未授权写入。
- 超预算能停止。
- 默认只完成一个阶段并停止，等待用户确认是否进入下一阶段。
- 连续阶段模式默认关闭；开启测试必须证明它需要单独 opt-in，且阶段之间仍停在交付文档、验证结果、handoff packet 和用户审核点。
- 远程通道可以收到任务摘要并进行审批，但不会收到完整上下文。
- `/remote channels doctor` 能检查 Feishu/Lark、DingTalk、WeCom CLI 是否安装、版本是否支持、登录状态是否有效、输出是否可解析、权限是否足够，并在失败时保持通道关闭。
- 至少一个官方 CLI adapter 走通只读通知或审批模拟；如果本机没有对应 CLI，必须有 mock adapter 测试覆盖事件转换、去重、过期、失败降级和脱敏日志。
- 重复、延迟、丢失或乱序的远程审批不会导致重复执行写文件、Bash、联网或 agent/job 启动。

本阶段完成后，Linghun 才具备“全托管”的基础，但仍然是可控全托管，不是无边界自治。

## 23. 阶段 18：桌面端预留验证

### 目标

不做完整桌面端；只有在终端 TUI 成熟、真实项目实测稳定、核心 API 边界清楚后，才验证架构没有堵死桌面端。基础终端 TUI 的主输出分层、权限/提权交互、轻提示、错误提示和输出层级必须已在 Phase 15 Beta 前达到可真实测试手感，并在 Phase 15.5 复检/polish；Phase 18 只验证同一 core 能否被桌面壳复用，不启动桌面产品化。

### 产物

- core API。
- local IPC / WebSocket 原型。
- 会话列表 API。
- 配置 API。
- 状态 API。
- 长期任务 API。
- 记忆审查 API。

### 参考

- Tauri。
- 桌面端 AI 工具会话列表体验。

### 验收

- TUI 使用 core。
- 原型 GUI 也能读取同一批会话和状态。
- 不需要重写 Agent / tools / providers。
- GUI 原型能查看长期任务、会话、记忆和成本状态。

## 24. 阶段依赖关系

```text
0 设计冻结
1 工程骨架
2 Session
3 模型网关
4 TUI
5 核心工具
6 权限/Plan
7 行为控制
8 代码自检/验证增强
9 缓存/成本
10 MCP/索引
11 会话/记忆
12 Agent
13 多模型
14 Skills/Workflow
15 真实项目测试版
15.5 双模型交叉审查与开源前 hardening
16 可控学习闭环
17 长期托管任务与自动会话
18 桌面端预留验证
```

不能跳过：

- 没有阶段 5，不做 Agent。
- 没有阶段 6，不做 `auto-review` / `full-access`；legacy `acceptEdits` / `bypass` 只作为兼容 alias。
- 没有阶段 8，不宣称修复闭环。
- 没有阶段 9，不谈省钱。
- 没有阶段 10，不谈索引增强。
- 没有阶段 15，不宣称可用。
- 没有阶段 15.5，不宣称开源前 hardening 已完成。
- 没有阶段 16，不宣称越用越聪明。
- 没有阶段 17，不宣称全托管。

## 25. 缺失复查清单

当前蓝图已覆盖：

- CCB 核心工具、TUI、权限、Plan、Agent。
- CCB Dev Boost 缓存、索引、MCP 稳定、成本观测、中文增强。
- OpenCode 的多模型开放和 provider 抽象。
- Hermes 的记忆、用户偏好、技能固化。
- oh-my-openagent 的 team mode、角色路由、skills/hooks/lifecycle 方向已作为行为和验收参考覆盖到 Phase 13、14、17；只参考公开交互与边界，不复制实现。
- MCP 生态和 codebase-memory。
- AI sessions 跨 Claude / Codex 会话交接。
- 严格工程行为，减少幻觉和绕路。
- 代码自检、验证增强和 verifier agent。
- 长期托管任务和自动会话。
- 桌面端预留。

仍然后置、不进 MVP：

- 完整桌面端。
- 技能市场。
- 全自动远程控制。
- LAN pipes。
- 无审批自治写代码。
- 大而全 LSP。
- 复杂团队协同平台。

## 26. 最终效果判断

如果全部阶段按闭环完成，最终效果应该是：

- 终端体验接近 CCB/Claude Code。
- 中文体验明显更好。
- 多模型和成本控制更适合个人开发者。
- MCP 和 Skills 兼容，但默认不复杂。
- 能从 Claude / Codex 会话接着干。
- 能在真实老项目里修 bug，而不是只能 demo。
- 能把成功经验沉淀为可审查记忆和 Skill。
- 能创建可控长期托管任务，自动新开会话继续工作。
- 架构可以继续走向桌面端。

不是目标：

- 第一版就做完所有 GUI。
- 第一版就全自动自治。
- 第一版就超越所有 AI 编程工具。

真正目标：

> 先做一个能打、稳定、低成本、中文友好、可持续扩展的 AI 编程终端，然后再做桌面端和生态。
