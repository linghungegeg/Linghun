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
- 能显示缓存命中率、token、费用、省钱估算。
- 默认严格工程模式，减少幻觉、绕路和过度设计。
- 桌面端从架构上预留，但不影响终端优先成品。
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

### 1.2 参考项目方向

| 项目/方向 | 地址/来源 | 借鉴 |
| --- | --- | --- |
| CCB / Claude Code Best | 本地 `ccb-source` / GitHub 原项目 | TUI、工具、权限、Plan、Agent、MCP、缓存 |
| CCB Dev Boost | 本地 `ccb-source/docs/ccb-optimizations.md` | 缓存命中、索引保护、MCP 稳定、中文体验 |
| OpenCode | `https://github.com/opencode-ai/opencode` | 多模型开放、provider 抽象、开放生态 |
| Hermes Agent | 公开 Hermes Agent 方向 | 记忆、USER/MEMORY、技能固化 |
| codebase-memory-mcp | 用户本机安装或随包内置，示例命令 `codebase-memory-mcp` | 代码库图索引 |
| AI Sessions MCP | 作为跨 Claude / Codex 会话读取方向 | 会话迁移与继续工作 |
| MCP 官方生态 | MCP SDK / 社区 MCP | 工具生态 |
| Ink | 标准 Ink | TUI |
| Tauri | 桌面端预留 | 后续 GUI |

原则：参考行为、架构和成熟交互，不复制可疑实现。

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

成品化闸门：

- 每阶段必须更新 `docs/delivery/phase-XX-*.md`。
- 每阶段必须给出用户可执行的命令或 TUI 操作路径。
- 每阶段必须说明失败时如何降级。
- 每阶段必须说明对缓存、成本、权限和会话的影响。
- 每阶段必须跑最小回归，确认前一阶段核心能力未破坏。
- 阶段产物如果只是内部 API、没有交互路径或验证路径，不算完成。

## 3. 外部竞品与防跑偏原则

### 3.1 外面已有相近工具

外部已经有不少 AI 编程工具，Linghun 不能假装自己处在空白市场。

| 工具 | 已有能力 | 对 Linghun 的启发 |
| --- | --- | --- |
| Claude Code / CCB | 强终端编码体验、工具闭环、Plan、Agent、权限 | Linghun 的核心编码体验参考对象 |
| OpenCode | 终端 AI coding agent、auto compact、MCP、LSP、自托管模型、权限快捷键 | 借鉴多模型开放、LSP、配置化和 TUI 交互 |
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
- 状态栏显示费用。

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
- `/stats`
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
- `/btw`
- `/background`

### 4.2 状态栏风格

第一屏必须能看懂：

```text
main · DeepSeek V4 Pro · strict · cache 94% · ¥0.12 · index ready · 1 agent
```

### 4.3 权限交互

权限提示必须说人话：

```text
将要修改 1 个文件：src/app.ts
风险：低
原因：工作区内普通代码编辑
选择：允许一次 / 永久允许此类编辑 / 拒绝
```

### 4.4 模型能力不足

不能假装能做：

```text
当前模型不支持图片理解。
可以切换到支持视觉的模型提取图片内容，再继续交给当前模型写代码。
```

### 4.5 新手模式

新手默认只看到推荐项：

- 推荐模型。
- 推荐索引。
- 推荐 MCP。
- 推荐权限模式。
- 成本状态栏。

高级配置隐藏到 `/config advanced`。

### 4.6 CCB / Claude Code 关键体验补齐

这些不是“锦上添花”，而是强编码手感的一部分，后续阶段必须逐步落地：

| 体验 | 要求 | 阶段 |
| --- | --- | --- |
| Todo / 任务列表 | 长任务必须能显示当前步骤、已完成项、阻塞项 | 阶段 5 |
| diff 审阅 | 写入前后能看到改动摘要，默认模式可确认应用 | 阶段 5-6 |
| 权限规则持久化 | allow/ask/deny 和最近拒绝记录可查看、可删除 | 阶段 6 |
| 快捷模式切换 | Shift+Tab 或等价快捷键切换 default/plan/acceptEdits/auto/bypass | 阶段 6 |
| Checkpoint / rewind | 关键写入前创建检查点，支持回到上一安全点 | 阶段 7 |
| 输入队列与中断 | 粘贴、多轮输入、Esc/Ctrl+C 不能打乱会话状态 | 阶段 4-7 |
| 后台任务 | 长命令、agent、job 可折叠、查看、恢复、中断 | 阶段 12 / 17 |
| 临时插问 | 类 `/btw` 小问题不打断主任务上下文 | 阶段 11 |
| 命令别名兼容 | 保留 Claude 风格 slash 命令，新增能力也要有中文说明 | 阶段 4 起 |

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
- Phase 02 可先使用 `~/.linghun/data/sessions` 作为默认路径，但后续必须接入完整 StorageConfig，支持项目内或自定义磁盘路径。

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
- 显示 token / cost 占位。
- 支持 Ctrl+C / Esc。
- 支持命令输入。
- 支持长文本粘贴和输入队列，不重复发送、不重复渲染。
- 命令面板能展示别名和中文说明。

### 交互

```text
main · model · mode · cache -- · ¥-- · index --
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

- default。
- plan。
- Plan Choice UI。
- acceptEdits。
- dontAsk。
- bypass。
- 权限规则。
- 权限 UI。

### 必做

- plan 强制只读。
- Plan 模式必须先输出可选方案，用户选择或确认后才能进入执行。
- 可选方案必须包含保守方案、推荐方案；高风险任务还必须包含止血方案或分阶段方案。
- 每个方案必须说明影响范围、风险、预计修改文件、验证计划。
- 用户可以选择方案、要求修改计划、取消任务。
- 未经用户确认，不得从 plan 进入写入执行。
- acceptEdits 自动允许低风险工作区编辑。
- 高危操作永远询问。
- 可永久允许某类规则。
- 可查看和删除规则。
- 最近拒绝记录可查看，不能让用户猜为什么又被拦。
- default 模式下，写入前可展示 diff 摘要；plan 模式禁止写入。
- acceptEdits 只自动通过低风险工作区编辑，不自动通过命令执行。

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
- acceptEdits 修改普通项目文件不反复询问。
- 删除目录、改 `.git`、远程脚本必须询问。

## 12. 阶段 7：工程行为控制闭环

### 目标

解决模型绕、幻觉、过度设计。

### 参考

- 用户原始想法中的“减少幻觉、AI 说不、能力边界”。
- 当前 AGENTS.md 的最小改动规则。

### 产物

- strict engineering mode。
- 能力边界检查。
- Checkpoint / rewind。
- 输入中断控制。
- Evidence Gate 证据闸门。
- Claim Checker 结论检查器。
- Tool-before-answer 策略。
- 最小改动协议。
- 验证闭环。
- “不能做”替代方案。

### 必做

- 未读代码不允许声称代码事实。
- 最新信息必须搜索或声明无法确认。
- 当前模型能力不足时提示切换。
- 高风险改动先报备。
- 修改后必须验证或说明未验证原因。
- 涉及代码事实的结论必须有证据来源，例如已读文件、索引查询、命令输出或搜索来源。
- 没有证据时，模型只能说明“尚未确认，需要先检查”，不能靠猜下结论。
- 最终回答中如果出现“已修复”“已验证”“代码里是”等结论，必须能对应到工具证据。
- 代码任务默认必须先使用 Read / Grep / Index / Bash 等工具获取事实，再给实现结论。
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
- 没有验证时不会声称已验证。
- 写入后能通过 `/rewind` 回退本轮改动。
- Esc/Ctrl+C 后不会留下半执行状态。

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
- 检查是否违反用户要求、是否过度改动、是否缺少测试。
- 验证失败时回到修复循环，最多重试有限次数。

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

### 验收

- 修改 Node 项目后能自动发现并运行 typecheck/test。
- 修改 Python 项目后能建议 pytest/ruff。
- 验证失败能提取关键错误并继续修复。
- verifier agent 能指出 diff 中明显风险。
- 最终报告包含：改了什么、跑了什么、结果如何、未验证什么、剩余风险。

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
- cost tracker。
- cache warning。
- cache break detector。
- `/cache-log`。
- `/break-cache status`。
- 状态栏命中率和费用。

### 必做

- 最近 20 轮缓存日志。
- 命中率颜色提示。
- 费用估算。
- 节省估算。
- system prompt diff。
- tool schema diff。
- MCP tool list diff。
- model changed 检测。

### 性能要求

- cache 记录不能阻塞流式输出。
- 状态栏刷新轻量。

### 验收

- 连续 20 轮对话后 `/cache-log` 有数据。
- 切换模型后能显示缓存破坏原因。
- MCP 工具变化能显示原因。

## 15. 阶段 10：MCP 与 codebase-memory 闭环

### 目标

让索引和 MCP 真正可用，但不拖垮主程序。

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
- 大文件扫描。
- `.linghunignore` / `.cbmignore` 兼容。

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
- 修改大量文件后提示索引可能过期。
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
- 内部会话摘要。
- AI sessions 接入。
- `LINGHUN.md`。
- `MEMORY.md`。
- `.linghun/memory/` 项目级记忆存储。
- 可配置 memory/session 数据路径。
- `/btw` 临时插问。

### 必做

- 按项目列出会话。
- 恢复会话。
- 读取最近任务摘要。
- 从 Claude / Codex 会话导入上下文。
- 新会话基于记忆和索引开始。
- `/btw` 回答临时小问题时，不改变当前主任务计划、Todo 和执行状态。
- 会话摘要必须区分“已确认事实”和“用户想法/待确认假设”。
- 项目级记忆默认支持写入项目内 `.linghun/memory/`。
- 用户级记忆与项目级记忆必须分层，不能混写。
- 记忆和会话数据目录必须可通过配置切换到其他磁盘。
- 不允许硬编码 `C:` 或固定用户目录。
- 必须提供 `/memory storage` 或等价诊断，显示当前记忆/会话/索引存储位置。

### 交互

```text
/sessions
/sessions import codex
请基于最近 Codex 会话和项目索引继续处理这个问题
```

### 验收

- 在 Codex 做一半任务。
- 在 Linghun 读取相关会话摘要。
- 结合当前代码继续工作。
- 长任务中使用 `/btw` 后，主任务能继续。
- 能把项目级记忆写入项目内 `.linghun/memory/`。
- 能把会话或记忆数据路径配置到非 C 盘目录。
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
- Agent transcript。
- Agent 状态栏。
- Agent 成本统计。
- 后台 agent 查看、折叠和中断。

### 必做

- 用户明确要求才多开。
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
- worker 做明确小改。
- verifier 自动验证。
- 主线程合并结论。
- 单个 agent 被取消后，主会话仍能继续。

## 18. 阶段 13：多模型协作闭环

### 目标

实现实用的多模型协作，而不是炫技。

### 参考

- OpenCode 多模型方向。
- 用户需求：一个 AI 写方案，一个 AI 指挥，一个 AI 执行。

### 产物

- model router。
- capability table。
- role-to-model 配置。
- per-agent model。
- role context handoff。
- fallback policy。
- per-role budget。

### 必做

- 规划模型。
- 执行模型。
- 审查模型。
- 视觉模型。
- 成本显示。
- 角色路由必须明确：planner / executor / reviewer / verifier / summarizer / vision。
- planner 输出 PlanProposal，不直接写文件。
- executor 只能执行已批准计划或明确任务。
- reviewer/verifier 默认只读，必须基于 diff、关键文件和验证结果复核。
- 角色之间只传递结构化摘要、证据、diff 和必要文件列表，不无脑复制完整上下文。
- 每个角色可配置模型、最大 token、最大费用、是否允许工具、是否允许写入。
- 模型不可用、能力不足或超预算时，必须降级到备用模型或暂停让用户选择。
- 多模型协作必须显示每个角色的成本和贡献。

### 交互

```text
/model route
/model route doctor
/model route set planner gpt-5.5
/model route set executor deepseek-v4-pro
/agents run verifier --model gpt-5.5
/plan --model claude
```

### 验收

- DeepSeek 执行代码。
- GPT/Claude 做复核。
- 成本按模型显示。
- 能力不足时建议切换。
- planner 只产出计划，不写文件。
- executor 按批准计划完成修改。
- reviewer/verifier 能独立指出 diff 风险。
- 一个模型失败时能切到 fallback 或暂停选择。
- 超过角色预算时停止继续烧 token。
- 多模型上下文交接不会把全量会话重复塞给每个模型。

## 19. 阶段 14：Skills 与工作流闭环

### 目标

兼容技能、插件和常用工作流，但不影响核心速度。

本阶段的 Plugin 目标是“可用底座”，不是完整插件生态。第一版只做本地插件清单、启停、诊断、失败隔离和权限接入；不做插件市场、远程安装、自动更新、评分分发或复杂沙箱。

### 参考

- Hermes Skills。
- CCB Skills / workflow 工具方向。
- 当前 Codex skill 生态经验。
- OpenCode 插件化和配置化方向。

### 产物

- Skill loader。
- Plugin manifest loader。
- Project skills。
- User skills。
- Workflow templates。
- Plugin doctor。

### 必做工作流

- bug-fix。
- review。
- doc-to-code。
- design-to-code。
- release-note。
- refactor-plan。

### 交互

```text
/workflow bug-fix
/skills
/skills add
/plugins
/plugins doctor
```

### 性能要求

- 不加载无关 skill 全量内容进 prompt。
- skill 摘要稳定，避免破坏缓存。
- plugin 清单稳定排序，失败隔离。
- plugin 贡献的命令、MCP、provider、hook 必须可见。

### 验收

- 使用 bug-fix 工作流完成真实 bug 修复。
- skill 可禁用。
- skill 不导致启动明显变慢。
- plugin 可启停。
- plugin 加载失败不影响主会话。

### 成品级 Plugin System

本阶段先完成本地插件底座；成品版必须继续补齐 GitHub 安装和插件生命周期，不能遗漏。

必须支持：

- `/plugins install github:owner/repo`
- `/plugins install https://github.com/owner/repo`
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
- `/plugins doctor` 必须显示失败原因、路径、依赖、权限和版本兼容问题。
- 插件来源必须分级：local、official、third-party。
- 插件贡献内容必须稳定排序，不能污染 prompt cache。
- 必须提供插件开发文档：如何写插件、调试插件、发布插件。

验收：

- 能从 GitHub 安装一个测试插件。
- 首次启用时能展示权限申请。
- 插件崩溃后主会话仍可继续。
- 版本不兼容插件会被拒绝或禁用，并给出中文原因。
- `/plugins doctor` 能定位路径、依赖、权限、manifest、版本问题。
- 插件贡献的命令、MCP、provider、hook、workflow、skill 都能在面板中看到来源。
- 重启后插件顺序稳定，不造成缓存无意义抖动。

成品版仍然暂不做：

- 大型插件市场。
- 插件评分、推荐、分发。
- 插件商业化和账号体系。

## 20. 阶段 15：真实项目测试版

### 目标

所有核心阶段完成后，进入可测试成品。

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

### 通过标准

- 能完成真实 bug 修复。
- 命中率长期稳定 92% - 96%。
- 峰值可接近 98%。
- 成本可见。
- MCP 崩溃不影响主程序。
- plan 不写文件。
- acceptEdits 减少审批。
- 多 agent 不乱。

本阶段完成后，Linghun 才算真正进入可用测试。

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

### 验收

- 完成一次 bug 修复后，能生成候选经验。
- 用户确认后写入项目记忆。
- 新会话能基于这条记忆少走弯路。
- 删除错误记忆后不再影响后续回答。

本阶段完成后，Linghun 才具备真正可控的“越用越聪明”。

## 22. 阶段 17：长期托管任务与自动会话

### 目标

把 CCB 中分散的 daemon、background sessions、job、cron、proactive、Agent 能力，产品化成可控的长期托管任务。用户可以让 Linghun 定时醒来，自动创建新会话、多开 agent 继续工作，完成后生成报告；遇到高风险则暂停等待用户确认。

### 参考

- CCB feature 方向：`DAEMON`、`BG_SESSIONS`、`TEMPLATES`、`KAIROS`、`PROACTIVE`、`BRIDGE_MODE`。
- CCB Agent 生命周期。
- CCB Cron / job 类能力。
- 当前蓝图的 Session、Agent、权限、缓存、会话恢复能力。

### 产物

- 长期任务定义。
- 定时调度器。
- 后台会话创建。
- 自动 agent 分工。
- 预算限制。
- 风险暂停。
- 任务日志。
- 结果报告。
- 后台任务折叠、恢复和中断入口。

### 必做

- 任务名称。
- 项目路径。
- 任务目标。
- 运行计划。
- 最大运行时间。
- 最大 token。
- 最大费用。
- 是否允许编辑。
- 是否允许 Bash。
- 是否允许多 agent。
- 是否需要先输出 plan。
- 是否需要用户审批后写入。
- 后台任务在 TUI 状态栏显示数量、费用和最近状态。
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

### 性能要求

- 后台任务不能拖慢前台 TUI。
- 每个自动会话必须独立 transcript。
- 任务运行必须可中断。
- 任务成本必须可追踪。

### 验收

- 创建一个每天运行的只读检查任务。
- 到时间自动创建会话。
- 自动读取项目记忆和索引状态。
- 必要时开 explorer / verifier。
- 生成报告。
- 不进行未授权写入。
- 超预算能停止。

本阶段完成后，Linghun 才具备“全托管”的基础，但仍然是可控全托管，不是无边界自治。

## 23. 阶段 18：桌面端预留验证

### 目标

不做完整桌面端，但验证架构没有堵死桌面端。

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
16 可控学习闭环
17 长期托管任务与自动会话
18 桌面端预留验证
```

不能跳过：

- 没有阶段 5，不做 Agent。
- 没有阶段 6，不做 acceptEdits/bypass。
- 没有阶段 8，不宣称修复闭环。
- 没有阶段 9，不谈省钱。
- 没有阶段 10，不谈索引增强。
- 没有阶段 15，不宣称可用。
- 没有阶段 16，不宣称越用越聪明。
- 没有阶段 17，不宣称全托管。

## 25. 缺失复查清单

当前蓝图已覆盖：

- CCB 核心工具、TUI、权限、Plan、Agent。
- CCB Dev Boost 缓存、索引、MCP 稳定、成本观测、中文增强。
- OpenCode 的多模型开放和 provider 抽象。
- Hermes 的记忆、用户偏好、技能固化。
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
