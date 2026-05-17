# Phase 15 pre-Beta CCB / CCB Dev Boost Deep Parity Closure

本文件记录一个待决质量门，不代表当前已经进入执行。本阶段只能在 Phase 15 pre-Beta P0 hardening 报告输出并被审阅后，由用户明确确认是否启动。

## 目的

Phase 15 是真实项目 Beta。进入 Beta 前，Phase 00-14 不能只是“功能存在”，还必须在真实使用体验上达到 CCB / CCB Dev Boost 公开成熟行为的核心体验等价。否则 Phase 15 测到的会混入交互入口、提权建议、工具主动性、错误提示或 TUI 手感缺陷，导致测试数据失真。

本 closure 是 Solution Completeness Gate 在真实测试基线上的落地：先求实取证、对照成熟参考、判断系统性缺口，再决定是否修 P0/P1 或登记 P2。它不是新功能堆叠，不是 Phase 15 Beta，不是 Phase 15.5，也不是 Phase 16+。

当前 Solution Completeness Gate 主要是规格和工作规则约束。本 closure 必须明确评估：这些约束是否已经足够，还是需要在 pre-Beta 补成更强的 workflow check、TUI smoke gate、handoff checklist 或 runtime guard。若仍只停留在“文档提醒”，但真实工作中模型会继续发现一个补一个，则必须把该问题列为阻塞 P1 或 P0。

## 启动条件

- Phase 15 pre-Beta P0 hardening 已完成，并输出验证报告。
- 用户已经审阅 P0 报告，仍需要确认 Phase 00-14 是否具备 CCB / CCB Dev Boost 级核心使用体验。
- 用户明确确认启动本 closure。

禁止在 P0 hardening 报告未审阅时自动启动本 closure，也禁止跳过本 closure 的决策直接进入 Phase 15 Beta。

## 对照范围

至少覆盖以下体验面：

- 编码主链路：模型会读、搜、改、验证、复盘，不让用户手敲一堆命令。
- 工具协议和主动性：真实 `tool_use` / `tool_result`，不是文本建议。
- 自然语言入口：状态查询、动作请求、文件读取、项目规则、模型路由、cache/index/memory/session/permissions 都能自然使用。
- 权限和提权：什么时候申请、什么时候拒绝、什么时候解释、拒绝后给什么下一步。
- 建议系统：该建索引、读规则、跑验证、切 Plan、开 workflow 时，会合理建议。
- 输出体验：人话主输出，工程细节进入 details/debug，不污染主屏。
- help / doctor / error：缺 key、缺索引、缺规则、未知命令、provider 配置异常时不让新手卡死。
- 长任务和取消：进度、heartbeat、日志、后台运行、取消和恢复路径清楚。
- TUI 基础手感：首屏、状态栏、Start Gate、窄终端、中英文关键路径。
- cache / index / memory：降本增效，不增加用户负担，不污染 prompt。
- 多模型协作：role route、handoff、summary/evidence 传递可用，不传完整历史。
- Skills / Workflows / Hooks / Plugins：summary-first、load-on-demand、权限不可绕过。
- 反幻觉：本地证据、EvidenceSummary、Freshness Gate 和 Solution Completeness Gate 能压住模型靠猜。

## 必须产出的对照矩阵

本 closure 不能只写概括性评价，必须产出可执行矩阵：

- CCB / CCB Dev Boost 成熟行为：证据来自本地只读对照、公开文档或 Freshness Gate。
- Linghun 当前行为：证据来自代码、测试、TUI smoke、交付文档或用户实测。
- 差距类型：缺功能、缺交互手感、缺 runtime gate、缺 i18n、缺测试、缺文档或明确不做。
- 用户影响：是否会污染 Phase 15 Beta 数据，是否会让用户手动绕路，是否会增加幻觉、成本或安全风险。
- 阶段处理：pre-Beta 必修、Phase 15.5、later、not-do。

尤其必须给出“何时建议、何时提权、何时只读回答、何时 Start Gate、何时权限审批、何时拒绝、拒绝后给什么下一步”的交互决策矩阵。该矩阵是判断 0-14 是否达到 CCB 级使用手感的核心证据。

## 必须复检的真实场景

至少用真实 TUI smoke 或等价脚本覆盖：

- 新项目首次启动：缺 `LINGHUN.md`、缺 index、缺 provider/key、无 session。
- 常见状态问法：模型、索引、cache、memory、permissions、sessions、background、agents。
- 常见文件问法：明确文件、刚才那个文件、模糊文件、多匹配候选、项目规则。
- 常见开发链路：读文件、搜代码、修改、看 diff、跑验证、失败后复盘。
- 权限链路：写文件、Edit/MultiEdit、Bash、Todo、Plan、acceptEdits、auto、bypass、拒绝后的下一步。
- 建议链路：何时建议建索引、读规则、跑测试、开 workflow、开 agent、查 doctor。
- 错误链路：未知命令、provider 配置错误、model 不存在、quota/rate limit、MCP/index/plugin/skill/hook 诊断。
- 长任务链路：索引、验证、agent、多模型审查的进度、heartbeat、后台查看、取消和恢复。
- zh-CN / en-US 关键路径：不得出现中文环境混英文模板或英文环境混中文关键提示。

## 参考边界

- 参考源以 `docs/audit/reference-map.md` 为准。
- 只参考 CCB / CCB Dev Boost / OpenCode 等公开行为、交互边界、架构取舍和验收标准。
- 不复制第三方源码、内部 API、反编译产物、专有遥测、私有协议或补丁代码。
- 需要最新公开项目行为时，必须走 Web Evidence / Freshness Gate；未联网或证据不足时不得声称已经完成最新对照。

## 输出要求

报告必须包含：

- 实际读取的本地文档、代码、索引、测试和参考源。
- 每个体验面的 CCB / CCB Dev Boost 对照结论。
- Linghun 当前证据。
- 差距分类：P0、阻塞 P1、非阻塞 P1、P2、not-do。
- 每项差距的阶段边界：pre-Beta 必修、Phase 15.5、later、明确不做。
- 最小完整修复建议和验证方式。
- Solution Completeness Gate 当前是文档约束、工作流检查还是 runtime guard 的结论；如果不足，必须说明最小升级路径。
- 是否允许进入 Phase 15 Beta 的明确结论。

## 验收

- P0 和阻塞 P1 未关闭时，不得进入 Phase 15 Beta。
- 非阻塞 P1/P2 必须登记到 Phase 15.5 或后续，并说明不阻塞原因。
- 报告不能只给单点补丁命令；必须说明是否属于系统性缺口。
- 报告必须给证据，不得只写“感觉已接近 CCB”。
- 没有交互决策矩阵、真实场景复检和 gate 成熟度结论时，本 closure 不算完成。
- 完成后更新 `START_NEXT_CHAT.md` 和本文件的验证记录。

## Blocking P1 fix 完成记录（SC-1 / BASH-1）

本轮性质：Phase 15 pre-Beta Deep Parity Closure blocking P1 fix，只关闭报告中的 2 项阻塞 P1；未进入 Phase 15 Beta、Phase 15.5 或 Phase 16+。

### SC-1：Solution Completeness Gate 最小升级

已完成：

- 在 TUI 模型 system prompt 构建路径增加轻量 Solution Completeness Gate 工作流检查。
- 触发条件保持最小：用户明确要求“成品级 / 不要缝补 / 先看 CCB / 有没有漏 / 系统性 / Solution Completeness”等，或最近同类 permission denial 反复出现。
- 触发后注入 `SYSTEMIC_GAP_WARNING`，要求先判断 `single_issue / systemic_gap`、影响面、P0/P1/P2、阶段边界和验证方式，不直接给单点补丁。
- `HandoffPacket` 增加 `solutionCompleteness` 状态，记录是否触发、触发原因、是否要求分类和 checklist。
- workflow 模板增加 `solution-completeness-check`，只提供判断框架，不自动修代码。

明确未做：完整 runtime guard、完整 FreshnessGate/web_source runtime、第二套命令解释系统、registry/dispatch 大重构。

### BASH-1：Bash 流式输出 / 实时进度反馈最小闭环

已完成：

- 保持 `runTool()` Promise 最终结果兼容，不改 Bash 最终 `ToolOutput`、exit code、error、timeout、abortSignal 语义。
- 仅在 `ToolContext` 增加可选 `onProgress` 回调；Bash stdout/stderr/system chunk 到达时调用进度回调。
- TUI 工具执行路径安装临时 progress handler：写入 `tool_call_delta` transcript event、刷新 background task，并即时写入 TUI 输出，让长命令可见仍在输出。
- 权限管道、Start Gate、Plan、auto、bypass、hard deny、安全检查仍在 `decidePermission()` / `runTool()` 外层路径中执行，未绕过。

明确未做：不把整个工具接口改成 AsyncGenerator，不做完整 TUI 输出分层美化，不扩展 Grep/Glob 进度反馈。

### Blocking P1 focused 验证

已执行：

- `corepack pnpm test -- --run packages/tools/src/index.test.ts packages/tui/src/index.test.ts`：通过，11 个测试文件、200 个测试通过。覆盖 Bash stdout/stderr progress chunk、最终输出/exitCode 兼容；覆盖 Solution Completeness Gate 显式触发、同类 denied 触发、system prompt checklist 和 handoff `solutionCompleteness` 写入。
- `corepack pnpm typecheck`：通过。

本轮最终收口已执行：

- `corepack pnpm test`：通过，11 个测试文件、200 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过，workspace packages 构建通过。
- `corepack pnpm exec linghun --help`：通过，输出 Linghun 0.1.0 help。
- `corepack pnpm exec Linghun --help`：通过，输出 Linghun 0.1.0 help。
- `git status --short`：已执行，列出本轮修改文件和新增审计报告。
- `git diff --check`：通过；仅有 Windows LF/CRLF 提示，无 whitespace error。
- independent verification gate：PASS。verifier 独立运行并通过 `corepack pnpm test`、`corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm build`、`corepack pnpm exec linghun --help`、`corepack pnpm exec Linghun --help`、`git diff --check`，并额外执行 Bash timeout adversarial probe；结论为 SC-1/BASH-1 硬约束、权限管道和 Bash final result 兼容性均 PASS。
- 主会话 spot-check：复跑 `corepack pnpm typecheck`、`corepack pnpm exec linghun --help`、`git diff --check`，结果与 verifier 报告一致；`git diff --check` 仅 Windows LF/CRLF warning，无 whitespace error。

### 剩余风险与阶段边界

- SC-1 当前是最小 workflow/prompt/handoff check，不是完整 runtime 强制中断；完整 runtime guard 仍登记到 Phase 15.5 或后续，必须用户确认后才可做。
- BASH-1 当前只覆盖 Bash chunk streaming；Grep/Glob 进度、完整 output grouping、长任务 heartbeat 美化仍为 Phase 15.5 范围。
- 仍禁止自动进入 Phase 15 Beta、Phase 15.5 或 Phase 16+；Phase 15 Beta 即使 blocking P1 全部关闭，也必须用户明确确认后才可启动。
