# Phase 15 CCB-Grade Default Runtime Reconciliation

日期：2026-05-20
范围：只读审计 / reconciliation；不修改运行时代码；不宣布 Phase 15 Beta PASS；不进入 Phase 15.5 / Phase 16+。

## 0. Executive verdict

**READY_TO_FIX**

Phase 15 当前不应继续依赖旧的“局部 PASS / closure / READY_FOR_USER_DECISION”叙事直接进入 Beta。最新真实 TUI 暴露的问题和 `PHASE_15_BETA_CCB_MATURITY_REMEDIATION_BASELINE.md` 表明：Phase 15 Beta 前仍有一组直接影响 **CCB-grade 默认编码链路** 的成熟度缺口，必须作为 Pre-Beta P1 拉回 Phase 15 收口。

本轮结论不是 `NEEDS_MORE_AUDIT`：核心 Linghun 文档、既有 Phase 15 audit、真实输入修复报告、decision review、以及 CCB `processUserInput` / `Tool` / `PermissionPrompt` / `StatusLine` / 内置工具 UI 参考已经足以形成执行口径。

本轮结论也不是 `NO_ACTION`：虽然普通输入被 NCB / catalog 抢答的问题已经修复，且 Gate F 双 provider report-generation smoke 有 scoped PASS 证据，但真实 Beta 前仍存在会污染默认编码体验的缺口：工具主屏输出过载、report-generation 路径曾错误落到 Bash 并触发 Windows mojibake、pending approval / 用户追问 / mode switching 体验不成熟、OpenAI-compatible 默认 `chat_completions` 下 reasoning/profile 可见性不足等。

控制口径：

- **可以进入修复批次设计**：是。
- **可以宣布 Phase 15 Beta readiness PASS**：否。
- **可以进入 Phase 15.5 / Phase 16+**：否。
- **可以用关键词补丁或 prompt-only 补丁替代 runtime 修复**：否。

## 1. Current source of truth

### 1.1 当前最高优先级基线

当前 Phase 15 默认运行时成熟度的最高优先级依据是：

- `PHASE_15_BETA_CCB_MATURITY_REMEDIATION_BASELINE.md`

该 baseline 明确把 Phase 15 Beta 暂停在默认运行时链路闭环之前，并将真实 Beta 前必须满足的目标收敛为：

```text
ordinary user request
-> session/context assembly
-> model query
-> tool_use
-> permission
-> tool_result
-> continuation
-> final answer
```

因此，判断某项是否必须拉回 Phase 15 Pre-Beta 的标准不是“它是否属于完整 CCB 复刻”，而是：

1. 它是否会破坏普通用户请求进入模型 / 工具 / 权限 / continuation / final answer 的主链路；
2. 它是否会让用户误以为本地控制面输出就是模型完成了任务；
3. 它是否会让工具结果、权限结果、provider profile、Windows runtime 状态以错误或不可诊断方式污染真实项目 Beta 数据；
4. 它是否把本应由 runtime 保证的能力退化成 prompt 约束、文案约束或测试偶然通过。

### 1.2 旧 audit / closure 的降级口径

以下旧结论仍可作为 evidence source，但不再作为 Phase 15 Beta readiness 的最终裁决：

- `docs/audit/phase-15-pre-beta-ccb-full-parity-audit.md`
  - 旧口径：Phase 15 pre-Beta 基本具备真实项目 Beta 条件、无 P0 blockers，若干权限反馈、status/debug/provider 细节可后移。
  - 当前口径：被 baseline 降级为“局部 surface parity evidence”。其中直接影响默认编码链路的项必须重新分类。
- `docs/audit/phase-15-pre-beta-source-level-runtime-output-permission-parity.md`
  - 旧口径：runtime/output/permission declared surface parity PASS，Beta readiness PARTIAL。
  - 当前口径：保留其 source inventory 价值；但 PASS 只覆盖已声明 surface，不能证明真实默认 tool loop、permission continuation、output layering 都达标。
- `docs/audit/phase-15-pre-beta-red-flag-sweep.md`
  - 旧口径：`NOT_READY`，含 8 个 BLOCKING、7 个 BETA-WATCH。
  - 当前口径：后续修复和 decision review 已关闭部分 blocker；但其中 provider/profile、report path、output、Windows、evidence/doctor 相关项仍要按默认链路重新审查。
- `docs/audit/phase-15-real-project-beta-decision-review.md`
  - 当前口径：`READY_FOR_USER_DECISION`，remaining BLOCKING = 0，P15-A4 / P15-A8 DONE，Gate F scoped PASS。
  - 重要边界：它明确不是 Phase 15 Beta readiness PASS；剩余 PARTIAL / DEFERRED 风险仍需在是否开始真实 Beta 前被用户显式接受，或被 Pre-Beta fix 收口。
- `docs/audit/phase-15-real-beta-ccb-style-input-preprocessor-fix.md`
  - 当前口径：最新真实问题修复证据。它证明普通输入默认进入 model/provider/tool loop 是 Pre-Beta 必须保持的 runtime boundary，不是 Phase 15.5 polish。

### 1.3 CCB 行为参考边界

本轮只参考 CCB 默认编码体验和边界，不复制可疑源码或内部专有实现。

实际对照的本地 CCB 文件包括：

- `F:\ccb-source\src\utils\processUserInput\processUserInput.ts`
  - CCB 在输入前置阶段处理 slash、bridge-safe command、hooks、attachments、bash mode 等结构化入口；普通文本若未被结构化入口拦截，会继续进入 query。
- `F:\ccb-source\src\utils\processUserInput\processTextPrompt.ts`
  - 普通文本构造 user message 并返回 `shouldQuery: true`。
- `F:\ccb-source\src\Tool.ts`
  - 工具定义包含 input schema、permission context、tool use context、progress、tool result / new messages / context modifier 等运行时概念。
- `F:\ccb-source\src\components\permissions\PermissionPrompt.tsx`
  - 权限交互支持 accept/reject/cancel 和 feedback；rich UI 可后移，但功能性 approval result 必须能回到模型链路。
- `F:\ccb-source\src\components\BuiltinStatusLine.tsx`
  - 显示 model、context usage、token/rate limit/cost 等 runtime 状态；Linghun 不必逐项复制，但 provider/profile/context 可见性不能缺位。
- `F:\ccb-source\packages\builtin-tools\src\tools\FileReadTool\UI.tsx`
  - Read 主屏显示 `Read N lines` 等摘要，而不是倾倒全文。
- `F:\ccb-source\packages\builtin-tools\src\tools\GrepTool\UI.tsx`
  - 搜索结果默认 summary-first，详细内容通过 verbose / expand 查看。
- `F:\ccb-source\packages\builtin-tools\src\tools\GlobTool\UI.tsx`
  - Glob 复用搜索结果摘要展示。
- `F:\ccb-source\packages\builtin-tools\src\tools\BashTool\UI.tsx`
  - Bash command 展示有行数和字符上限。
- `F:\ccb-source\packages\builtin-tools\src\tools\BashTool\BashToolResultMessage.tsx`
  - Bash 结果按 stdout/stderr/timeout/background/no-output 等结构化展示。

对照结论：CCB 的成熟体验不是“把所有普通输入先交给本地 capability scorer”，也不是“主屏直接 dump 工具原始结果”。它的关键成熟点是：普通 prompt 默认 query；工具使用有 schema/permission/progress/result；主屏 summary-first；权限结果回到模型；状态和错误可诊断。

## 2. Reclassification table

| Item | Old classification | New classification | Evidence | Why it affects / does not affect default CCB-grade coding loop | Minimal required fix | Verification required |
| --- | --- | --- | --- | --- | --- | --- |
| 普通输入默认路由边界 / NCB downgrade | 曾被 full-parity audit 视为 Linghun NCB 增强；真实 Beta 前一度暴露为普通 prompt 被 `/index` 等 catalog 抢答 | **PRE_BETA_P1**，且已有一轮修复；后续必须设防防回归 | `phase-15-real-beta-ccb-style-input-preprocessor-fix.md`；CCB `processTextPrompt.ts` 返回 `shouldQuery: true` | 普通任务如果被本地 catalog 抢答，就直接断开 model/tool loop，是默认链路 blocker | 保持 `handleNaturalInput()` 普通主路径默认 `message`；catalog 仅保留在 slash/help/明确控制面/安全 pending path；禁止关键词 allowlist 补丁 | 回归真实 prompt：`帮我看看这是什么项目 该怎么部署 把报告更新在根目录下 有索引 优先使用索引` 必须进入 provider/model request；同时 slash、pending approval、Start Gate confirmation 仍走本地结构化路径 |
| Read / Glob / Grep 主屏输出 summary-first | 旧 parity 把 output polish 多数后移到 Phase 15.5 / P2；真实症状显示 Glob/Read 主屏仍过 verbose | **PRE_BETA_P1** | 真实 Beta 症状；CCB `FileReadTool/UI.tsx` 只显示 `Read N lines`；`GrepTool/UI.tsx` 默认显示 result summary | 普通 coding loop 高频使用 Read/Glob/Grep；主屏倾倒原始内容会污染对话、遮蔽模型意图和 permission/result continuation，不只是 UI polish | 保留 model-visible bounded tool_result；用户 primary 层只显示 tool name、intent、数量、短摘要、fullOutputPath/details 提示；不要新增复杂 rich UI | TUI smoke：Read 大文件、Glob 多结果、Grep 多结果时 primary 不输出全文/全列表；details/evidence/fullOutputPath 仍可取完整信息 |
| Tool result continuation for allow/deny/cancel/error/timeout/abort | 旧 audit 中权限反馈和 accept/reject reason 偏向 Phase 15.5/P1/P2；baseline 拉回 tool_result continuation | **PRE_BETA_P1** | baseline 默认链路含 `permission -> tool_result -> continuation -> final answer`；CCB `PermissionPrompt.tsx` 支持 accept/reject/cancel/feedback | 只显示权限 UI 但不把 allow/deny/cancel/error 作为 model-visible continuation，会让模型无法正确收束任务或改用安全替代方案 | 最小实现不是 rich modal，而是确保每个 permission outcome 都产生结构化 tool_result / continuation context；用户追问不能破坏 pending state | 测试 allow、deny、cancel、tool error、timeout、abort 后模型能继续/解释/请求替代；pending state 不被普通输入误消费 |
| Pending approval 期间用户追问 / mode switching | 过去多归为交互 polish；真实症状显示体验不成熟 | **PRE_BETA_P1**，但仅限状态机正确性；rich editing UI 可后移 | 真实症状；baseline permission continuation；CCB permission prompt 有明确 cancel/feedback boundary | Pending approval 是默认写文件/执行命令链路的核心节点；用户追问或切换模式若丢失 pending tool_use，会造成误执行、误拒绝或上下文断裂 | 保持 pending approval 独立状态；普通追问要么明确提示先处理 pending，要么作为 clarification 进入安全路径；不得静默吞掉或当成 yes/no | TUI smoke：pending Write/Bash 时输入普通问题、slash/status、cancel、deny、confirm，各自行为稳定且可见 |
| Report-generation path runtime closure | Red Flag Sweep RF-B06 曾指出 report generation prompt-enforced；Gate F later scoped PASS | **PRE_BETA_P1**，已有 scoped evidence 但仍需保持为 regression gate | `phase-15-real-project-beta-decision-review.md` Gate F dual-provider report-generation scoped PASS；真实症状曾错误走 Bash 并触发 Windows mojibake | “读项目并写报告”是 Beta 核心任务；若依赖 prompt 或 Bash 重定向而非 Write/permission/tool_result/final answer，默认链路不可证明 | 保证 report task 走 model tool loop：Read/Glob -> Write approval -> Write tool_result -> model continuation -> final answer references path；不要靠 Bash echo/cat 重定向写中文报告 | 双 provider 或 mock provider smoke：生成报告文件存在、final answer 引用路径、Write evidence 存在；Windows 中文内容不 mojibake |
| Bash routing and Windows mojibake guard | 旧 audit 中 Bash diagnosis 多偏后移；真实 report task 误走 Bash 暴露为默认链路问题 | **PRE_BETA_P1** for report/write misuse and mojibake pollution；deep Bash UX remains Phase 15.5 | 真实症状；CCB Bash UI truncates command and structures stdout/stderr | Bash 是高风险工具；错误用 Bash 代替 Write 会绕过更精确的文件意图和中文编码安全，污染 report-generation path | 对“写报告/更新文件”优先使用 Write/Edit；Bash primary 输出摘要化；Windows stdout/stderr 编码异常要有诊断或避免进入 report content | TUI smoke：中文报告不用 Bash 重定向；Bash 输出 primary 截断且 stderr/stdout 可诊断；Windows 非 ASCII 路径/内容不破坏最终报告 |
| Provider endpointProfile / reasoning visibility | Red Flag Sweep RF-B07/RF-W06；decision review P15-A6 仍 PARTIAL | **PRE_BETA_P1** for profile/status clarity in default request path；deep quota UI remains Phase 15.5 | OpenAI-compatible 默认 `chat_completions` 下 reasoning 不生效的真实症状；P15-A6 PARTIAL | 用户若看不到当前是 `chat_completions` / `responses`、reasoning 是否有效，会误判模型质量和 Beta 结果 | `/model doctor`、请求前状态或 `/model` 显示 provider、model、endpointProfile、reasoning effective/ignored/missing、tool support；禁止隐藏 fallback | Provider tests/smoke：OpenAI-compatible chat_completions 下 reasoning 被标注为 ignored/unsupported；responses profile 显示有效；错误不泄漏 key/baseUrl |
| Provider profile contract / no hidden schema fallback | 旧 full parity 部分把 provider classification 后移；baseline 明确拉回 | **PRE_BETA_P1** | baseline provider profile contract；decision review P15-A4 DONE but P15-A6 PARTIAL | 模型请求 schema/profile 错配会直接导致 tool_use、reasoning、continuation 失败 | 明确 `deepseek_chat_completions`、`openai_compatible_chat_completions`、`openai_responses` contract；失败时诊断 profile 而不是静默 fallback | Unit + smoke：各 profile 请求体、tool support、reasoning handling、错误分类、identity header secret safety |
| Session/context assembly and budget visibility | 旧 audit 中 context/rate/status 多后移；baseline 拉回 session/context | **PRE_BETA_P1** for minimum context assembly correctness and budget signal；rich status line can defer | baseline 默认链路第一段是 session/context assembly；CCB status line显示 context usage/rate limits | 若 recent history、system rules、tool results、budget 截断不可控，真实项目 Beta 的每次请求都不可解释 | 最小闭环：请求前能说明本次 context 来源、历史截断、token/budget大致状态；不要要求复制 CCB cost line | Tests/smoke：连续多轮 tool loop 后 history/tool_result 被纳入或有明确截断说明；状态不显示虚假成本/额度 |
| Tool runtime validation / metadata / max result size | 旧 declared surface PASS 容易只证明类型存在；baseline 要 runtime behavior | **PRE_BETA_P1** | `LINGHUN_IMPLEMENTATION_SPEC.md` ToolDefinition；CCB `Tool.ts` input schema/permission/progress/result | 工具若只靠 TypeScript 类型而无 runtime validation，会在真实模型 tool_use 输入下失败或产生危险默认值 | 每个核心 tool 至少有 input validation、read/write/destructive metadata、max result bounding、error class | Tests：缺参/错参/超大输出/危险路径/权限需求均返回结构化错误或审批，不崩溃不泄漏 |
| TYPE-SHELL surfaces: MCP / Skills / Plugins / Agents / Workflows | 旧 docs 中部分作为已存在能力或后续增强；decision review仍 PARTIAL | **BETA_WATCH** by default；若默认链路可见并误导用户则升级 PRE_BETA_P1 | baseline TYPE-SHELL 章节；decision review P15-A1/P15-A2/P15-A3 PARTIAL | 若普通编码 loop 不依赖这些表面，可观察；但如果 help/doctor/status 把 type-only shell 宣传成可用能力，会误导 Beta | 默认隐藏、标注 diagnostic/planned、或给出真实最小 runtime；不得用 type declarations 当 maturity proof | Help/doctor smoke：不可用 surface 不宣称可用；MCP deferred guard缺参/未知工具拒绝而非盲执行 |
| Redaction / transcript / evidence secret safety | Red Flag Sweep RF-B03；后续 cleanup 表明 key leakage check clean | **BETA_WATCH** unless current runtime leaks secrets；leak则 PRE_BETA_P1 | cleanup / decision review key leakage clean；RF-B03 原始风险 | 不泄漏时不阻断默认 loop；一旦 report/transcript/error 暴露 key/baseUrl/prompt 私密内容就是 blocker | 保持 secret redaction；provider error、doctor、evidence路径不输出 Authorization、真实 key、私密 query | Secret-safety targeted tests；真实错误 smoke检查 key/baseUrl/prompt不泄漏 |
| Slash command registry mapization / handleSlashCommand 重构 | 旧 audit P1-B / Phase 15.5 候选 | **PHASE_15_5** unless current dispatch bug affects default loop | full parity audit；baseline禁止大重构替代必要 runtime修复 | 这是维护性/扩展性问题，不直接破坏普通 prompt -> model -> tool loop；不应在 Pre-Beta 用大重构扩散风险 | 暂不重构；仅当具体 slash dispatch correctness bug 阻断 Beta 时做局部补丁 | Existing slash regression 保持通过；无须为“更优雅”改结构 |
| Rich permission UI: Tab 修改、accept/reject reason UX、IDE diff | 旧 audit P1/P2；CCB 有成熟实现 | **PHASE_15_5** for rich UI；functional outcomes remain PRE_BETA_P1 | CCB `PermissionPrompt.tsx` | 富交互提升体验，但 Beta 前核心是 approval outcome 和 continuation，不是复制 modal | 不做 rich UI；先保证 allow/deny/cancel/error 语义和 pending 状态 | Rich UI 不作为 Phase 15 Beta gate；功能测试覆盖结果语义 |
| Full semantic compact / hierarchical summarization | baseline deferred | **PHASE_15_5** | baseline deferred issue register | 只要最小 context budget 和 history assembly 可诊断，完整 compact 可后移 | 不在 Phase 15 修；避免 prompt-only fake compact | 后续 Phase 15.5/16 单独验收 |
| Full hooks / plugin marketplace / workflow state machine / agent team scheduler | baseline deferred | **PHASE_15_5** or later | baseline explicit deferrals | 不是普通 coding loop 的最小闭环；提前做会扩散范围 | 保持隐藏/diagnostic/planned，不作为 Beta maturity claim | Help/status 不误导；默认 loop 不依赖它们 |
| Freshness / Web evidence runtime | decision review P15-A7 DEFERRED | **PHASE_15_5** unless Beta task asks latest/current external facts | `phase-15-real-project-beta-decision-review.md` P15-A7 | 默认本地项目编码不必联网；但当前外部事实若无 source 会污染报告 | Beta scope避免 unsourced latest/current claims；需要外部事实时引用 fresh source或降级 | Freshness-specific任务单独验证；普通本地项目 Beta不以此为PASS前置 |

## 3. Explicit pull-forward list

以下项目应从旧 Phase 15.5 / Beta-watch / P2 口径拉回 Phase 15 Pre-Beta 修复或保持为硬回归门：

1. **普通输入默认进入 model/provider/tool loop**
   - 已有一轮真实修复，但必须作为回归门保留。
   - 禁止把 NCB / capability catalog 重新接回普通主路径。
2. **Read / Glob / Grep 主屏 summary-first**
   - 真实 Beta 高频路径；不能把 raw/full result 直接倾倒到 primary screen。
3. **Write/report-generation runtime closure**
   - “生成/更新报告”必须证明 tool loop、Write approval、tool_result、model continuation、final answer path，而不是 prompt-only 或 Bash 重定向偶然成功。
4. **Pending approval continuation 和用户追问状态机**
   - 必须覆盖 allow / deny / cancel / error / timeout / abort；普通用户追问不能丢 pending tool_use。
5. **Bash routing 与 Windows 中文/编码污染防线**
   - 尤其是报告写入不能错误落到 Bash 导致 mojibake。
6. **Provider endpointProfile / reasoning 可见性**
   - OpenAI-compatible `chat_completions` 下 reasoning 不生效必须清楚显示；不能让用户误以为 reasoning 生效。
7. **Provider profile contract 与 no hidden fallback**
   - schema/profile/tool support/reasoning 的差异必须显式。
8. **最小 session/context assembly 与 budget 可诊断性**
   - 不要求复制 CCB status line，但请求链路要能解释上下文来源和截断。
9. **核心工具 runtime validation / metadata / result cap**
   - 不能只用类型声明证明成熟。
10. **TYPE-SHELL honesty for default-visible surfaces**
    - 若 help/status/doctor 默认可见，就必须隐藏、降级标注或提供真实最小 runtime。

## 4. Explicit keep-deferred list

以下项目不应在本轮作为 Phase 15 Pre-Beta 必修项扩大范围，除非后续真实 Beta 再次证明它们直接污染默认编码链路：

1. Rich permission modal、Tab 修改、完整 accept/reject feedback UX、IDE diff。
2. `handleSlashCommand` registry mapization / 大范围结构重构。
3. Full semantic compact、hierarchical summarization、长期自动学习闭环。
4. Full hooks ecosystem、workflow state machine、plugin marketplace。
5. Agent team coordination、完整后台任务/并发 scheduler。
6. Rich expand/collapse block UI、完整 terminal polish、窄屏高级布局。
7. Deep provider matrix UI、真实 billing/quota reconciliation。
8. Full Freshness Gate runtime；普通本地项目 Beta 只需避免 unsourced current/latest claim。
9. Desktop shell、remote channels、vision routing、Phase 16+ 能力。
10. 完整复刻 CCB 内部实现、内部服务、专有遥测或可疑源码。

## 5. Implementation batch proposal

建议最多 3 个小批次；每批只修默认链路直接相关点，不做大重构。

### Batch 1 — Runtime chain correctness

目标：先保证普通请求 -> model -> tool_use -> permission -> tool_result -> continuation -> final answer 不断链。

最小范围：

- 保持并加固普通输入 `message` 回归；覆盖 catalog 不抢答。
- 修 pending approval 状态机：allow / deny / cancel / user question / slash during pending / timeout / tool error。
- report-generation path：确保读项目后使用 Write/Edit，而不是 Bash 重定向；final answer 引用实际路径。
- 工具结果 continuation：permission outcome 和 tool result 都要 model-visible。

不做：rich permission UI、大型 command registry 重构、workflow/agent 扩展。

### Batch 2 — Output / provider / Windows clarity

目标：防止真实 Beta 主屏和 provider profile 污染判断。

最小范围：

- Read / Glob / Grep / Bash primary layer summary-first；完整结果放 details / fullOutputPath / evidence。
- OpenAI-compatible endpointProfile / reasoning effective state 在 `/model doctor`、请求状态或相关 status 中可见。
- Windows 中文输出、非 ASCII 路径、Bash stdout/stderr 编码异常不污染 report 文件。
- provider error 分类和 secret-safe 诊断保持可操作。

不做：完整 rich expand/collapse UI、真实 billing/quota 深度对账。

### Batch 3 — Verification guard

目标：把上述修复变成 Phase 15 Beta 前的稳定验收矩阵。

最小范围：

- TUI stdin smoke：普通中文项目/report/index prompt 必须进入 provider request。
- Tool output smoke：Read/Glob/Grep 大输出 primary 不倾倒原始结果。
- Permission continuation smoke：Write approval allow/deny/cancel 后模型能继续。
- Report-generation smoke：mock + 至少已有 scoped live provider evidence复用；必要时再补一次最小 live。
- Provider profile smoke：OpenAI-compatible chat_completions reasoning ignored 状态明确。
- Windows smoke：help/version/TUI stdin/中文报告/路径含空格或非 ASCII。

不做：以测试数量替代真实默认链路；不把 scoped smoke 自动升级为 Beta PASS。

## 6. Forbidden fixes

以下修法明确禁止用于关闭本 reconciliation：

1. **No keyword patch**
   - 不新增“部署 / 报告 / 项目 / 索引 / index”等 allowlist/denylist 来绕过 NCB。
   - 正确方向是入口边界：普通 prompt 默认 model query；结构化入口才走本地控制面。
2. **No prompt-only fix**
   - report generation、Write path、permission continuation、provider profile visibility 不能只靠 system prompt 要求模型“应该这样做”。
3. **No declaring Beta PASS**
   - Gate F PASS、cleanup PASS、`READY_FOR_USER_DECISION`、局部测试 PASS 都不是 Phase 15 Beta readiness PASS。
4. **No entering Phase 15.5 / Phase 16+**
   - 本轮只拉回默认编码链路 blocker；不借机做 rich UI、workflow、agent team、plugin marketplace、learning loop。
5. **No major refactor as substitute**
   - 不用 command registry 重构、抽象层、目录迁移替代最小 runtime 修复。
6. **No CCB source copying**
   - 只参考行为边界和验收思路，不复制可疑源码、内部 API、内部服务或专有 telemetry。
7. **No hidden fallback**
   - provider endpoint/profile/reasoning/tool support 不允许静默 fallback 到另一路径后仍显示“正常”。
8. **No raw output primary dump**
   - primary screen 不应直接输出完整文件、完整 Glob 列表、完整 grep content、长 stdout/stderr 或 raw evidence JSON。

## 7. Evidence and real symptom mapping

| Real symptom / evidence | Reconciliation result |
| --- | --- |
| 普通输入现在进入 model/tool loop | 这是正确方向；必须作为 Pre-Beta regression gate，而非一次性修复后移除关注 |
| Glob / Read main-screen output still too verbose | 拉回 PRE_BETA_P1；summary-first 是默认 tool loop 成熟度，不只是 UI polish |
| report-writing task previously routed through Bash and hit Windows mojibake | 拉回 PRE_BETA_P1；report-generation 是核心 Beta 任务，必须走 Write/permission/tool_result/final answer path |
| pending approval / mode switching / user inquiry immature | 拉回 PRE_BETA_P1 的状态机正确性；rich feedback UI 可 Phase 15.5 |
| OpenAI-compatible default chat_completions caused reasoning not to take effect | 拉回 PRE_BETA_P1 的 provider profile/status clarity；deep provider matrix UI 可后移 |
| Gate F dual-provider live report-generation PASS scoped | 作为 evidence，不作为 Beta PASS；需转成 regression guard |
| remaining BLOCKING=0 in decision review | 允许用户决策或 fix planning，不抵消 baseline 对默认链路的更高门槛 |

## 8. Index / memory / validation notes

- codebase-memory project：`F-Linghun`
- 本轮继续前确认索引状态：ready，nodes=`1304`，edges=`2437`。
- 记忆中相关约束已纳入口径：
  - 不用关键词补丁解决 Phase 15 输入抢路由。
  - 不把 scoped closure / Gate F PASS / READY_FOR_USER_DECISION 升级为 Beta readiness PASS。
  - 报告默认中文，并给出明确文件路径。
- 本轮为 audit/report 写入，不修改运行时代码，不运行测试。

## 9. Final recommendation

**建议下一步进入 Phase 15 Pre-Beta fix planning，而不是启动真实项目 Beta 或进入 Phase 15.5。**

最小优先级顺序：

1. Runtime chain correctness：普通输入边界、pending permission continuation、report Write closure。
2. Output/provider/Windows clarity：Read/Glob/Bash summary-first、provider endpointProfile/reasoning visibility、Windows 编码防线。
3. Verification guard：把真实 prompt、report generation、permission continuation、provider profile、大输出、Windows 路径纳入稳定验收。

只有这些默认编码链路问题闭环后，Phase 15 才能重新进入 Beta readiness decision；届时仍应由用户明确决定是否接受剩余 Beta-watch / Phase 15.5 风险，而不是由局部 PASS 自动宣布 Beta PASS。
