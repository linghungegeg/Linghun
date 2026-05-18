# Phase 15 Beta 前 CCB handfeel detail 只读审计

## 0. 审计声明

- 审计类型：Phase 15 Beta 前 CCB handfeel detail 全量只读审计。
- 执行范围：仅阅读 Linghun 文档、Linghun TUI 源码/测试、以及本地 CCB 行为参考文档/组件。
- 本轮未修改任何代码，未提交 commit，未进入真人实测，未进入 Phase 15 Beta / Phase 15.5 / Phase 16+。
- CCB 内容仅作为行为边界和成熟 handfeel 参考；未复制 CCB / Claude Code / OpenCode 源码实现。

## 1. Executive verdict

**Verdict: PARTIAL（发现 1 个 blocking P1；源码级最小修复后已关闭）**

Phase 15 当前源码和交付文档已覆盖 Beta smoke 恢复所需的大部分 CCB handfeel 基线：普通开发请求可回到模型 `tool_use` / `tool_result` 循环，核心控制面请求本地处理，高风险操作不静默执行，Start Gate 与 permission pipeline 分离，长输出主视图截断并保留 transcript/evidence，复合状态、密钥隐藏和中英文行为矩阵已有回归。

纠正项：真实 Phase 15 smoke 暴露 `Index safety repair continuation 未闭环`。用户明确输入“帮我排除大文件 然后更新项目索引”时，旧行为只停在 safety warning、手动编辑路径和 `/index refresh` 重试命令，未准备 ignore 写入并继续刷新索引；这会污染 Phase 15 真人实测，按 blocking P1 处理。当前已做最小源码级修复：有 index safety riskyFiles 且用户自然语言明确要求排除/忽略大文件并刷新索引时，本地 continuation 会准备 `.linghunignore`/`.cbmignore` 写入计划，走现有 Write/`decidePermission()` 权限管道，允许后写入并自动继续 `/index refresh`；权限拒绝或写入失败时输出可操作下一步。

## 2. 审计输入与证据范围

### 2.1 Linghun 文档

- `START_NEXT_CHAT.md`：当前状态为 Phase 15 preflight hardening 与 Whole-System Interaction Boundary minimal fix 已闭环；可建议恢复 Phase 15 真人 smoke，但不得自动进入 Phase 15 Beta / 15.5 / 16+。
- `README.md`：确认 Phase 00-14 complete，Phase 15 Beta 需显式确认，Start Gate 边界仍有效。
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`：确认 NCB、Behavior Guard、Context Builder、Model Gateway、Tool Scheduler、Permission Pipeline、Verification Runner、TUI 状态链路。
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`：确认 primary/details/debug 三层输出、Phase 15 Beta handfeel gate、Phase 15.5 不得承接 Phase 15 Beta 基线缺口。
- `LINGHUN_IMPLEMENTATION_SPEC.md`：确认 `TuiOutputEnvelope`、`UserFacingToolSummary`、`CommandCapabilityRisk`、`NaturalRequestKind` 等规格。
- `docs/delivery/phase-15-natural-command-bridge.md`：确认 P0 hardening、deep parity closure、whole-system boundary minimal fix 已记录。
- `docs/delivery/TEMPLATE.md`：确认阶段报告应包含 verdict/evidence/validation/risk/next action。
- `docs/audit/phase-15-pre-beta-whole-system-interaction-boundary-reconciliation.md`：前序审计已将 4 个 blocking P1 最小闭环，当前 blocking P1=0。

### 2.2 Linghun 源码/测试

- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/natural-command-bridge.test.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`

### 2.3 CCB 行为参考

- `F:\ccb-source\src\screens\REPL.tsx`
- `F:\ccb-source\src\components\permissions\PermissionRequest.tsx`
- `F:\ccb-source\src\utils\permissions\permissions.ts`
- `F:\ccb-source\src\components\messages\AssistantToolUseMessage.tsx`
- `F:\ccb-source\src\components\messages\UserToolResultMessage\UserToolResultMessage.tsx`
- `F:\ccb-source\docs\tools\what-are-tools.mdx`
- `F:\ccb-source\docs\design\tool-search-design-guide.md`

## 3. 分类总览

| 分类 | 数量 | Beta 前是否必须修 |
|---|---:|---|
| P0 | 0 | 无 |
| blocking P1 | 1（已关闭） | 是，已最小修复 |
| non-blocking P1 | 4 | 否 |
| P2 | 5 | 否 |
| Phase 15.5 | 5 | 否，15.5 承接 |
| Phase 16+ | 3 | 否，后续阶段 |
| not-do | 5 | 明确避免 |

## 4. P0

| ID | 标题 | 现象 | 用户影响 | Linghun 源码证据 | CCB 行为参考 | 阶段归属 | 最小修复建议 | 验证句子或验证命令 |
|---|---|---|---|---|---|---|---|---|
| P0 | 无 | 未发现会直接污染 Beta 数据或导致高风险静默执行的 P0。 | 无。 | `handleNaturalInput()` 将普通 `model` intent 返回 `"message"`；`decidePermission()` default 模式对写入/Bash 返回 ask；测试覆盖普通开发请求、权限提示、索引安全门、密钥不泄漏。 | CCB 工具链强调 tool_use -> validate -> permission -> call -> tool_result；权限默认可拒绝/中断。 | Phase 15 Beta 前 | 无需修复。 | `corepack pnpm --filter @linghun/tui test -- natural-command-bridge index` |

## 5. blocking P1

| ID | 标题 | 现象 | 用户影响 | Linghun 源码证据 | CCB 行为参考 | 阶段归属 | 最小修复建议 | 验证句子或验证命令 |
|---|---|---|---|---|---|---|---|---|
| BP1-5 | Index safety repair continuation 未闭环（已关闭） | 用户明确要求“排除大文件并更新索引”时，旧行为停在说明文字，没有准备写入 `.linghunignore/.cbmignore`，也没有在写入后继续 `/index refresh`。 | 会污染 Phase 15 真人实测；用户需要自己拼流程，手感不像 CCB。 | 修复前：`runIndexRepository()` 只保存 `safetyWarning` 并输出手动修复路径。修复后：`handleIndexSafetyRepairContinuation()` 复用 `context.index.safetyRiskyFiles`、Write 工具、`decidePermission()` 与 `runIndexRepository(..., "refresh")`；`index.test.ts` 覆盖中英文 continuation、去重、拒绝、force/rebuild 阻断、主输出不重复 warning、普通开发请求回模型。 | CCB 成熟手感中可修复 blocker 应进入工具主链路或本地 continuation；真正写文件等风险动作才进入底层权限管道，而不是再次要求用户拼 slash command。 | Phase 15 Beta 前必须修 | 已最小修复：产生 continuation plan，优先 `.linghunignore`，已有 `.cbmignore` 时尊重惯例；追加缺失条目避免重复；写入走现有权限管道；允许后自动 refresh；拒绝/失败给下一步；自然语言 force/rebuild 仍不直通。 | `corepack pnpm test -- --run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts` |

## 6. non-blocking P1

| ID | 标题 | 现象 | 用户影响 | Linghun 源码证据 | CCB 行为参考 | 阶段归属 | 最小修复建议 | 验证句子或验证命令 |
|---|---|---|---|---|---|---|---|---|
| NP1-1 | 交互式权限审批选择仍是最小 REPL 形态 | 默认模式下模型触发写入/Bash 会显示权限提示并返回 denied/ask tool_result，但当前提示说明“最小 REPL 没有交互式审批 UI”。 | Beta 用户能理解未执行和下一步，但成熟 CCB 那种 allow/reject/cancel/feedback 选择手感不足。 | `decidePermission()` 对 default 写入/Bash 返回 ask；`formatModelToolPermissionPrompt()` 输出 tool/decision/risk/mode/reason/scope/next；测试 `shows model tool permission prompts and returns denied tool_result evidence`。 | `PermissionRequest.tsx` 根据工具类型选择权限组件，并支持 `onAllow`、`onReject(feedback)`、`onAbort`、Ctrl+C 拒绝。 | Phase 15 non-blocking P1 / Phase 15.5 polish | 不阻塞 Beta；15.5 增加轻量交互式选择和 reject feedback，不改当前权限决策边界。 | 句子：`请检查当前环境`，模型请求 Bash 时应显示权限提示、不执行命令、回灌失败 tool_result。 |
| NP1-2 | provider/tool failure 分类仍偏通用 | `formatError()` 主要输出 Error message 和 optional suggestion，未在 TUI 层显式区分 400/401/403/429/5xx、unsupported tools、invalid tool_result、gateway format error。 | 失败可见，但 Beta 用户遇到 provider 错误时恢复路径不如 CCB 成熟，可能需要开发者解释。 | `formatError()` 仅处理 `error.message` 与 `error.suggestion`；`sendMessage()` 对 `event.type === "error"` 直接 `formatError(event.error)`。 | CCB 权限/工具链在不同错误状态中分层渲染；成熟产品通常给认证、限流、服务端、格式错误不同恢复建议。 | Phase 15 non-blocking P1 / Phase 15.5 | 不阻塞 Beta；15.5 在 provider gateway 或 TUI error formatter 增加最小分类映射。 | 模拟 401/429 provider 响应，主输出应包含“认证/限流”与下一步命令 `/model doctor`。 |
| NP1-3 | primary/details/debug 统一展开入口仍不完整 | 长输出已有主视图截断和 evidence/transcript 保留，但普通 TUI 输出还没有统一 `details` 展开命令或 envelope 化展示。 | Beta 主输出不会爆屏；但用户想查看细节时入口不够一致。 | `formatToolOutput()` 对 Todo/Read/Grep/Glob 截断并提示 `fullOutputPath` 或 transcript/evidence；测试 `truncates long Todo, Grep, Glob, and Read outputs in the main output`。 | CCB tool/result rendering 分组件呈现 queued/running/resolved/error，细节路径更自然。 | Phase 15 non-blocking P1 / Phase 15.5 | 不阻塞 Beta；15.5 统一 `/details <evidenceId>` 或等价最小入口。 | `/read long.txt` 主输出应截断，并提示完整结果仍在 transcript/evidence 或 full log。 |
| NP1-4 | 贡献工具发现与真实执行链仍主要停留在 discover/diagnose 边界 | Skills/plugins/workflows/hooks/MCP 已有 manifest 发现、信任提示和“autoExecute=no”，但贡献工具的 `SearchExtraTools -> ExecuteExtraTool` 等价运行时链路尚未成为 Linghun TUI 的完整执行闭环。 | Beta 不会误执行第三方贡献工具；但成熟 CCB deferred tools 手感尚未完整。 | `formatFeaturePolicy()` 显示 skills/plugins/workflows discover，autoExecute=no；`formatPlugins()`/`formatHooksDoctor()` 说明贡献工具仍走权限管道、hook 不绕过权限；测试 Phase 14 skills/workflows/plugins/hooks/freshness。 | `tool-search-design-guide.md` 描述 Core Tools + Deferred Tools，先 SearchExtraTools 再 ExecuteExtraTool，执行时仍委托目标工具权限检查。 | Phase 15 non-blocking P1 / Phase 16+ | 不作为 Beta 阻塞；Phase 15.5 只补文案/诊断，Phase 16+ 再实现完整贡献工具执行链。 | `/features` 应显示 autoExecute=no；`/plugins doctor` 应显示 untrusted/broken manifest 隔离。 |

## 7. P2

| ID | 标题 | 现象 | 用户影响 | Linghun 源码证据 | CCB 行为参考 | 阶段归属 | 最小修复建议 | 验证句子或验证命令 |
|---|---|---|---|---|---|---|---|---|
| P2-1 | 权限提示中仍有 `decision/risk/mode/scope` 标签 | 这些标签可读，但仍偏开发者字段，不完全是 CCB 式人类句子。 | 不会误导执行边界；可能轻微影响新手手感。 | `formatModelToolPermissionPrompt()` 输出 `- decision:`、`- risk:`、`- mode:`、`- scope:`；相关测试也断言这些字段。 | CCB 权限 prompt 会用工具专属组件表达 action/scope/reason/choices。 | Phase 15.5 | 改为“动作/范围/风险/原因/选择”中文标签，保留 evidence/debug 中原字段。 | 模型请求 Write 时，主输出不应出现 raw `decision=` 类内部字段。 |
| P2-2 | 自然命令 capability answer 可能展示 risk-line 技术字段 | Start Gate 输出已测试不泄漏 `risk=` 等 raw 字段；但查询能力风险时，`formatRiskLine()` 会生成 `risk= readonly= startGate=` 等说明。 | 查询帮助时可理解，但 primary handfeel 偏工程化。 | `natural-command-bridge.ts` 的 capability formatting 使用 risk/readOnly/startGate/writesConfig/permissionPipeline 等字段；测试重点覆盖 Start Gate 不泄漏。 | CCB 帮助通常按用户任务和风险说明，不直接展示内部 schema 标志。 | Phase 15.5 | 只改展示文案，不改 catalog 数据结构。 | 句子：`/index 有什么风险`，主输出应使用人类风险描述而非 `risk=` 串。 |
| P2-3 | 状态栏 120 字符截断可能丢细节 | `writeStatus()` 把 session/model/mode/background/cache/index/gate 汇总到一行并截断。 | Beta 不阻塞；极端长 model/provider 时状态细节可能不可见。 | `writeStatus()` 使用 `truncateDisplay(status, 120)`；复合状态查询可展示完整状态。 | CCB REPL 通过多组件/布局表达状态，终端尺寸适配更成熟。 | Phase 15.5 | 保持一行简洁；15.5 可增加 `/status details` 或复合状态说明。 | 句子：`Are model, index and permissions ready?` 应展示复合状态，不发送模型。 |
| P2-4 | hint/warning 去噪仍是轻量实现 | light hints 已不进入 prompt/input area，但去重、频率控制、优先级策略仍有限。 | 不污染模型；偶发提示噪音可能影响手感。 | `index.test.ts` 覆盖 `keeps light hints out of the prompt/input area`；`TuiContext` 有 `hintLastShownAt`、`hintsMuted`。 | CCB 有通知、超时提示、权限提示等更成熟的 UI 节流。 | Phase 15.5 | 只补最小去重和静音说明，不扩展通知系统。 | `/cache status` 与 `/status` 后提示不得出现在 `你>` / `you>` 输入区域。 |
| P2-5 | hook/plugin doctor 输出仍偏 debug 密集 | hooks doctor 会展示 logPath、timeout、permissions、lastError 等详细字段。 | 对开发者有用；新手可能觉得信息量大。 | `formatHooksDoctor()` 输出 `logPath`、`lastError`、`permissions`；测试断言包含 `logPath` 和边界说明。 | CCB 将主消息、details、debug 分层更明确。 | Phase 15.5 | 保留 doctor/debug 详细度；不要把这些字段迁移到默认 primary。 | `/doctor hooks` 可保留 logPath；普通自然状态查询不应输出 logPath。 |

## 8. Phase 15.5 承接

| ID | 标题 | 现象 | 用户影响 | Linghun 源码证据 | CCB 行为参考 | 阶段归属 | 最小修复建议 | 验证句子或验证命令 |
|---|---|---|---|---|---|---|---|---|
| 15.5-1 | 交互式 permission choices | 当前 default ask 以拒绝/提示为主，没有 inline allow once / deny / feedback。 | 不影响 Beta 安全；影响成熟手感。 | `decidePermission()` default 写操作返回 ask；`formatModelToolPermissionPrompt()` 给下一步。 | CCB `PermissionRequest` 支持 allow/reject/abort/feedback。 | Phase 15.5 | 增加最小一次性 allow/deny 交互，不改变默认安全。 | 模型请求 Bash 后，用户可选择 deny 并带反馈回灌 tool_result。 |
| 15.5-2 | provider error taxonomy | 错误输出仍通用。 | 恢复路径不够精确。 | `formatError()` 泛化。 | CCB 成熟 UI 区分错误/拒绝/取消/成功。 | Phase 15.5 | 增加 400/401/403/429/5xx/unsupported-tools 分类。 | mock 429，应建议等待/换模型/检查 quota。 |
| 15.5-3 | details/evidence 展开入口 | evidence 有记录，但主输出到细节的统一路径不足。 | 查证略麻烦。 | `recordToolEvidence()`、`formatToolOutput()` 已有 evidence/fullOutputPath 基础。 | CCB result components 可按状态展开。 | Phase 15.5 | 增加 `/evidence <id>` 或 `/details <id>` 的最小只读入口。 | 长 grep 后可用 evidenceId 查看完整摘要/路径。 |
| 15.5-4 | capability answer 人类化 | 风险/能力说明仍可能 raw flag 化。 | 轻微影响 handfeel。 | `formatRiskLine()` 风格。 | CCB 帮助更像人类任务说明。 | Phase 15.5 | 仅替换展示文案，不改分类逻辑。 | `怎么切模型` 输出步骤/风险/取消方式。 |
| 15.5-5 | status/hint/warning 策略 | 当前有基础去噪，但没有成熟通知策略。 | 轻微噪音。 | `hintLastShownAt`、`writeLightHints()` 相关测试。 | CCB 有 notify-after-timeout 等机制。 | Phase 15.5 | 最小节流、mute/status details 文案。 | 连续低缓存命中提示不应每轮刷屏。 |

## 9. Phase 16+ 延后

| ID | 标题 | 现象 | 用户影响 | Linghun 源码证据 | CCB 行为参考 | 阶段归属 | 最小修复建议 | 验证句子或验证命令 |
|---|---|---|---|---|---|---|---|---|
| 16+-1 | 完整 deferred contributed tools 执行系统 | Linghun 当前安全边界为 discover/diagnose/autoExecute=no，未实现完整工具市场式 deferred execution。 | Beta 更安全；高级扩展能力未成品化。 | `/features`、`/plugins doctor`、manifest loading、trust notice。 | CCB ToolSearch / ExecuteExtraTool deferred loading。 | Phase 16+ | 到扩展生态阶段再实现注册表、schema、权限委托、执行和审计。 | 第三方 plugin 工具不能绕过权限自动执行。 |
| 16+-2 | 成熟多 agent/job/workflow 自动编排 | 当前 workflows 只显示 Start Gate，不自动运行。 | 不影响 Phase 15 Beta；高级自动化未开放。 | `formatWorkflows()` 说明 `/workflows <name>` 只进入启动确认说明。 | CCB/Cowork 类产品可有更强自动化，但风险更高。 | Phase 16+ | 不提前做自动编排；保持 Start Gate。 | `/workflows bug-fix` 不应直接写文件或运行 Bash。 |
| 16+-3 | 远程/浏览器/电脑控制/市场安装 | 功能策略明确默认不支持或不自动连接。 | 不影响代码终端 Beta；避免污染安全边界。 | `formatFeaturePolicy()` 写明 remote channels、voice、computer-use/browser control、daemon jobs、plugin marketplace 不默认。 | 成熟产品可能有远程或浏览器能力。 | Phase 16+ | 后续阶段单独设计权限、审计、回滚。 | `/features` 应继续显示这些不是默认功能。 |

## 10. not-do / 避免过度设计

| ID | 标题 | 现象 | 用户影响 | Linghun 源码证据 | CCB 行为参考 | 阶段归属 | 最小修复建议 | 验证句子或验证命令 |
|---|---|---|---|---|---|---|---|---|
| ND-1 | 不把所有 P2 升级为 Beta blocker | P2 多为 polish，不构成数据污染或安全阻断。 | 避免拖延 Beta。 | 前序审计 blocking P1=0；本轮未见 P0/blocking P1。 | CCB 成熟细节可参考，但不能把成熟产品全量作为 Beta 门槛。 | not-do | 只修 P0/blocking P1。 | 审计报告应分离 Beta 必修与 15.5 polish。 |
| ND-2 | 不复制 CCB 源码或内部实现 | 本轮只看行为边界。 | 保持 clean rewrite。 | 项目 CLAUDE.md 与交付文档要求禁止复制可疑源码。 | CCB 文件仅作为行为参考。 | not-do | 只用行为描述和自研实现。 | 代码 diff 不应包含 CCB 源码片段。 |
| ND-3 | 不为 Beta 前重写 TUI/权限系统 | 当前最低安全闭环存在，重写风险大。 | 避免引入新回归。 | `decidePermission()`、`executeModelToolUse()`、`formatToolOutput()` 已有最小链路。 | CCB 的组件化 UI 更成熟但复杂。 | not-do | 15.5 做局部补丁。 | Beta 前改动不得扩散到大范围架构重写。 |
| ND-4 | 不提前启用第三方贡献工具自动执行 | 当前 autoExecute=no 是正确边界。 | 避免第三方工具污染 Beta 数据或越权。 | `/features` 显示 skills/plugins/workflows discover but autoExecute=no。 | CCB deferred tools 有完整权限委托；Linghun 尚未进入该阶段。 | not-do | 保持禁用自动执行。 | 第三方 plugin/skill 只能 discover/enable，经权限链后续阶段再执行。 |
| ND-5 | 不自动进入 Phase 15 Beta / 15.5 / 16+ | 当前审计只是 Beta 前只读审计。 | 避免阶段跳跃。 | `START_NEXT_CHAT.md` 与阶段文档均要求用户显式确认。 | CCB 参考不改变 Linghun 阶段门。 | not-do | 报告完成后停止，等待用户确认。 | 最终汇报必须说明未进入任何后续阶段。 |

## 11. 15 个审计焦点逐项结论

| # | 焦点 | 结论 | 关键证据 |
|---:|---|---|---|
| 1 | 普通开发请求回到模型 tool loop | PASS | `routeNaturalIntent()` 对普通开发请求返回 `model`；测试覆盖中英文普通开发请求；`sendMessage()` 使用真实 provider stream 和 tools。 |
| 2 | 控制面请求本地处理 | PASS | `handleNaturalInput()` 对 composite status、readonly/safe local/start_gate/permission_pipeline 本地处理；`/index`、`/mcp`、`/memory`、`/cache` 等有 slash handlers。 |
| 3 | 可修复 blocker 能继续 | PARTIAL / blocking P1（已关闭） | 旧行为在 index safety pause 后只给手动路径并停住；已修复为明确排除大文件并刷新索引的自然语言 continuation，写 ignore 走权限管道，成功后自动继续 refresh。 |
| 4 | 权限提示 human-first | PARTIAL PASS | 已展示 tool/risk/reason/scope/next 且不执行；交互式 choice/feedback 属 15.5。 |
| 5 | tool 成功/失败/拒绝/取消 readable/resumable | PASS with polish | 成功输出 `formatToolOutput()`，失败 evidence，拒绝 tool_result；取消/中断已有基础路径，UI 成熟度 15.5。 |
| 6 | primary 输出不重复/无 raw fields | PASS with P2 | Start Gate 测试确认不泄漏 `gateId/risk=/readonly=`；部分 capability/permission 文案仍偏字段化，列为 P2。 |
| 7 | 长输出 summary-first | PASS | Todo/Read/Grep/Glob 主输出截断，完整内容留 transcript/evidence/fullOutputPath。 |
| 8 | composite status 覆盖关键状态 | PASS | 测试覆盖 model/index/permissions/memory/mcp；`writeStatus()` 覆盖 model/mode/background/cache/index/gate。 |
| 9 | provider/tool failure recovery | PARTIAL PASS | 工具失败有 evidence；provider error 分类不足，列 NP1-2。 |
| 10 | 贡献工具 discovery-before-execute | PASS for Beta boundary / PARTIAL for maturity | 当前 discover/diagnose/autoExecute=no 安全；完整 deferred execution 属 Phase 16+。 |
| 11 | 中英文共享行为矩阵 | PASS | natural-command-bridge tests 覆盖中英文路由、风险处理、普通请求回模型。 |
| 12 | secrets redacted | PASS | model doctor/status 测试断言不泄漏 API key；配置输出隐藏 secret。 |
| 13 | status/hint/warning 准确去噪 | PASS with P2 | light hints 不进入 prompt/input；成熟节流列 P2。 |
| 14 | phase report 不泄漏 raw tool_result/EvidenceSummary | PASS | delivery template 与 phase-15 文档按 verdict/evidence/validation/risk/next action 组织；模型系统 prompt 中 EvidenceSummary 不直接作为主报告输出。 |
| 15 | 区分 Beta 必修与 15.5 polish | PASS | 本报告单列 Beta 前必须修、15.5 承接、not-do。 |

## 12. Phase 15 Beta 前必须修

数量：**1（已关闭）**

- P0：0。
- blocking P1：1，`Index safety repair continuation 未闭环`，已通过最小源码级修复关闭。

结论：本轮 CCB handfeel detail 审计纠正为 PARTIAL：发现 1 个 Phase 15 Beta 前必须修的 blocking P1。当前源码已补上 continuation 闭环；是否进入 Phase 15 Beta 仍必须由用户明确确认。

## 13. Phase 15.5 承接

数量：**5**

1. 交互式 permission choices。
2. provider error taxonomy。
3. details/evidence 展开入口。
4. capability answer 人类化。
5. status/hint/warning 策略。

## 14. 明确不做 / 避免过度设计

1. 不把所有 P2 升级为 Beta blocker。
2. 不复制 CCB / Claude Code / OpenCode 源码或内部实现。
3. 不在 Beta 前重写 TUI/权限系统。
4. 不提前启用第三方贡献工具自动执行。
5. 不自动进入 Phase 15 Beta / Phase 15.5 / Phase 16+。

## 15. 验证与索引状态

- codebase-memory index：`F-Linghun`，status=`ready`，nodes=`894`，edges=`1736`。
- 本轮为只读审计，未运行真人 smoke，未运行 Beta。
- 建议最小验证命令（若后续用户确认执行验证）：
  - `corepack pnpm --filter @linghun/tui test -- natural-command-bridge index`
  - `corepack pnpm --filter @linghun/tui test`

## 16. 结构化 handoff packet

- 当前阶段：Phase 15 Beta 前 CCB handfeel detail 只读审计。
- 审计 verdict：PARTIAL（发现 1 个 blocking P1；最小源码级修复后已关闭）。
- Beta 前必须修：1 项，`Index safety repair continuation 未闭环`，已关闭。
- Phase 15.5 承接：5 项。
- 禁止事项：不改代码、不提交、不进入真人实测、不进入 Phase 15 Beta / 15.5 / 16+、不复制 CCB 源码、不把 P2 全部升级为 blocker。
- 证据引用：Linghun Phase 15 文档、Whole-System Interaction Boundary 前序审计、`natural-command-bridge.ts`、`natural-command-bridge.test.ts`、`index.ts`、`index.test.ts`、CCB permission/tool/result/deferred-tools 行为文档。
- 权限模式：本轮审计未改变项目权限模式。
- provider/model：本轮未调用 Linghun provider，不进入真人模型 smoke。
- 预算/缓存影响：本轮修复未调用真实 provider，未进入真人 smoke；验证仅使用本地测试/构建命令。
- 下一步：如用户确认，可恢复 Phase 15 真人 smoke；是否进入 Phase 15 Beta 仍需用户显式确认。
