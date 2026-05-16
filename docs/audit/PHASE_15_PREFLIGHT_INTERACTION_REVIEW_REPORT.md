# Linghun Phase 15 preflight 交互对照审查报告

> 审查类型：只读审查  
> 审查范围：Phase 15 preflight Natural Command Bridge / 自然语言控制桥  
> 审查日期：2026-05-17  
> 结论摘要：当前不建议直接进入 Phase 15 真实项目 Beta；应先完成 preflight hardening。

## 1. 总体结论：阻塞 Phase 15 真实项目 Beta

**结论：当前 Phase 15 preflight 不建议直接进入真实项目 Beta。**

它不是“纯关键词补丁”：已经有 Command Capability Catalog、本地 router、Start Gate、权限阻断格式、短 RuntimeStatus、catalog summary 和测试覆盖，方向是对的；但距离成品级 Natural Command Bridge 还有明显差距，主要阻塞点是：

- Catalog 不是实际 slash command dispatch 的真正单一事实来源，存在漂移风险。
- Router 仍以硬编码 alias / regex / substring 评分为主，语义泛化与参数提取不足。
- Start Gate 确认后直接执行等价 slash command，对状态写入/配置写入类命令缺少更细的二次权限硬化。
- 测试更像 smoke 覆盖，没有达到“每个 capability × 中英文 × 状态/动作/风险询问”的 Beta 前验收强度。
- 与 CCB 的 Plan / mode / bypass / auto gating 交互边界相比，Linghun 当前模式切换还偏粗，尤其 bypass/auto 可用性、本地 opt-in、Plan approve/escalation 颗粒度不足。

**建议：先做 Phase 15 preflight hardening，再进入 Phase 15 真实项目 Beta。**  
这不是要求进入 Phase 15 Beta，也不是 Phase 16+；只是对当前 preflight 的只读审查结论。

## 2. P0 / P1 / P2 问题清单

### P0

本次只读审查未发现会立即导致“自然语言直接写文件、直接 Bash、直接 bypass、直接安装依赖”的 P0 级破坏性直通证据。

正向证据：

- 高风险自然语言会被 `permission_pipeline` 阻断：  
  `packages/tui/src/natural-command-bridge.ts:781-792`、`857-868`、`923-945`
- Start Gate 明确输出 scope、budget、log path、cancel：  
  `packages/tui/src/natural-command-bridge.ts:947-975`
- 模型 prompt 注入的是短 RuntimeStatus 和短 capability summary：  
  `packages/tui/src/index.ts:5035-5043`
- RuntimeStatus 测试确认不注入完整 memory 文本：  
  `packages/tui/src/natural-command-bridge.test.ts:162-193`

但下面 P1 足以阻塞真实项目 Beta。

---

### P1-1：Catalog 不是 slash command dispatch 的真正单一事实来源

**文件证据**

- Catalog 覆盖列表是单独硬编码：  
  `packages/tui/src/natural-command-bridge.ts:97-141`
- Capability catalog 又是另一份硬编码：  
  `packages/tui/src/natural-command-bridge.ts:143-683`
- 覆盖校验只是“硬编码列表 A vs 硬编码 catalog B”：  
  `packages/tui/src/natural-command-bridge.ts:691-703`
- 实际 slash command dispatch 在另一处：  
  `packages/tui/src/index.ts` 的 slash command handler 区域；审查定位为 `index.ts:1208-1387`

**风险说明**

Phase 15 文档声称“Catalog 是单一事实来源：router、/help、model-visible summary 共用同一份能力目录”。现在 catalog 与实际 dispatch 仍是两套结构。新增或修改 slash command 时，测试可能不会失败，因为 `USER_VISIBLE_SLASH_COMMANDS` 本身也需要人工同步。

这会让 Natural Command Bridge 在真实项目 Beta 中出现：

- `/help` 说有的能力，实际 handler 不一致。
- handler 新增能力后，自然语言入口无法识别。
- 风险标记与实际命令行为漂移。
- 高风险命令被错误归类为 start_gate / readonly。

**最小修复建议**

- 建一个共享 slash command registry，至少包含：slash、aliases、risk、readonly、startGate、permissionPipeline、handler。
- `handleSlashCommand()` 和 catalog 从同一 registry 派生。
- 增加测试：任何 dispatch 中可执行的 slash command 没有 catalog metadata 时失败。

**Beta 前是否必须修：必须。**

---

### P1-2：Router 仍偏硬编码关键词/regex，语义泛化不足

**文件证据**

- 自然语言危险意图主要靠 regex：  
  `packages/tui/src/natural-command-bridge.ts:1089-1097`
- action/status 判断主要靠 regex：  
  `packages/tui/src/natural-command-bridge.ts:1080-1087`、`1135-1139`
- capability scoring 主要靠 alias/token/substring：  
  `packages/tui/src/natural-command-bridge.ts:1141-1181`
- 测试主要是 curated smoke phrases：  
  `packages/tui/src/natural-command-bridge.test.ts:75-160`

**风险说明**

这比“几个 if 关键词补丁”好，但还没有达到“自然语言控制桥”的成品级。真实用户会输入大量变体：

- “把权限切回计划模式”
- “现在是不是只读模式？”
- “开一个只做审查的 agent”
- “索引是不是旧了，要不要更新？”
- “帮我查 TODO，但别改东西”
- “换到更强的 reviewer 模型”

当前 router 很可能保守澄清或落到泛化命令，安全上不一定危险，但 Beta 体验会像“关键词命令别名”，不够自然。

**最小修复建议**

- 不要把安全决策交给模型；但应把本地 parser 扩展为 capability-level pattern family。
- 每个 capability 定义 status/action/howto/risk/deny phrase families。
- 增加 paraphrase、near-miss、反例测试，而不是只测固定 smoke 句。
- 对低置信度继续澄清，保持保守安全边界。

**Beta 前是否必须修：必须。**

---

### P1-3：参数提取不足，真实自然语言动作会退化成泛化 slash command

**文件证据**

- 等价命令生成只处理少数特殊情况：  
  `packages/tui/src/natural-command-bridge.ts:1214-1237`
- workflow 只提取 `bug-fix`：  
  `packages/tui/src/natural-command-bridge.ts:1230-1231`
- fork 只特殊处理 verifier：  
  `packages/tui/src/natural-command-bridge.ts:1232`
- mode 只特殊处理 bypass：  
  `packages/tui/src/natural-command-bridge.ts:1235`

**风险说明**

Phase 15 目标不是仅识别“这是 /mode”，而是能把常见自然语言映射成安全、可解释的本地命令路径。当前参数提取不足会导致：

- “切到 plan mode”可能只变成 `/mode`，不变成 `/mode plan`。
- “打开 review workflow”可能无法生成 `/workflows review`。
- “开 reviewer agent”可能无法区分 verifier/planner/explorer。
- “换到 claude-sonnet”不能形成清晰 Start Gate / model route candidate。
- “创建一个修复登录 bug 的分支会话”不能保留 branch purpose。

这会让 Beta 中的自然语言控制显得残缺。

**最小修复建议**

先补最小参数提取，不要大改架构：

- `mode`: plan / default / acceptEdits / auto / dontAsk / bypass。
- `workflow`: bug-fix / review / refactor-plan / doc-to-code / design-to-code。
- `fork`: explorer / planner / verifier / reviewer / worker。
- `index`: status / init / refresh / query。
- `model`: current / route / set candidate。
- `branch`: purpose 文本作为 Start Gate scope 展示，不必立即执行复杂逻辑。

**Beta 前是否必须修：必须。**

---

### P1-4：Start Gate 确认后直接执行 slash command，缺少命令级二次硬化

**文件证据**

- pending natural command 只保存 command/capability/time：  
  `packages/tui/src/index.ts:4999-5005`
- 用户回复确认后直接调用 `handleSlashCommand(command, context, output)`：  
  `packages/tui/src/index.ts:4960-4970`
- `createdAt` 被保存但确认时没有过期校验：  
  `packages/tui/src/index.ts:5000-5004`
- 非确认输入会清掉 pending gate：  
  `packages/tui/src/index.ts:4972-4974`

**风险说明**

设计文档说得对：Start Gate 不替代权限审批。但当前自然语言确认后的执行路径主要依赖 slash command 自己是否已有审批。对某些“状态写入 / 配置写入 / 本地索引状态变更 / cache refresh”类命令，如果 slash command 内部没有统一权限管道，那么自然语言 Start Gate 就成了唯一保护。

这和 CCB/OpenCode 的边界相比偏弱：

- CCB：bypass/auto/plan 都有额外 gating，不能由 bridge/client 请求静默提权。
- OpenCode：pending permission 是 modal gate，正常输入会被阻塞，权限选择有 allow once / always / reject，并明确展示 exact action。

**最小修复建议**

- 在 natural confirmation 与 `handleSlashCommand` 之间增加 risk enforcement。
- 对 `writesConfig`、`dangerous`、`entersPermissionPipeline`、stateful refresh/init 类命令要求：
  - 显式 slash command 输入；或
  - 第二层确认展示 exact command + risk + affected state；或
  - 进入已有 permission pipeline。
- pending gate 加短过期时间。
- 对高风险 gate 可要求 `确认 /exact-command`，避免普通“确认”误触。

**Beta 前是否必须修：必须。**

---

### P1-5：测试覆盖不满足 Beta 前交互矩阵

**文件证据**

- 现有测试覆盖 catalog 存在、部分中英文 smoke、高风险阻断、短 RuntimeStatus：  
  `packages/tui/src/natural-command-bridge.test.ts:55-193`
- 第三批风险测试只检查 catalog risk 属于 dangerous/start_gate：  
  `packages/tui/src/natural-command-bridge.test.ts:149-153`

**风险说明**

Phase 15 Beta 要在真实项目里验证自然语言控制。如果测试仍只是少量 curated phrase，很容易漏掉：

- 新增命令未进 catalog。
- 中文/英文风险 handler 不一致。
- “询问用途”和“请求执行”被混淆。
- 高风险参数绕过。
- readonly 状态查询误入 Start Gate。
- Start Gate action 没有 correct equivalent command。

**最小修复建议**

- 从 catalog 生成 table-driven matrix。
- 每个 capability 至少测：
  - 中文用途/风险询问。
  - 英文用途/风险询问。
  - action imperative。
  - status/read-only 路径，如适用。
  - dangerous phrase variant，如适用。
  - equivalent command 是否符合预期。
- 增加 negative tests：拼写错误、近义但不同能力、多候选、伪 slash、高风险动词混入只读命令。

**Beta 前是否必须修：必须。**

---

### P1-6：模式切换与 Plan/bypass/auto 边界弱于 CCB 参考行为

**文件证据**

Linghun 当前：

- `/mode` 可选项直接列出 default / plan / acceptEdits / dontAsk / auto / bypass：  
  `packages/tui/src/index.ts:1998-2006`
- 仅阻止 “plan 未接受时直接切到 bypass”：  
  `packages/tui/src/index.ts:2008-2014`
- `cycleMode()` 只循环 default / plan / acceptEdits / auto，不含 bypass：  
  `packages/tui/src/index.ts:2027-2033`
- `/plan accept` 只有一个接受路径，接受后回 default：  
  `packages/tui/src/index.ts:2041-2063`

CCB 参考行为审查摘要：

- CCB permission modes 包含 Default / Accept Edits / Plan / Auto / Bypass / Don’t Ask，并有明确模式语义。
- bypass 不能因 bridge/client/natural language 请求而静默可用，必须本地 opt-in。
- auto 也应 gated；classifier/gate 不可用时要拒绝。
- 进入 Plan mode 是明确用户边界：“Enter plan mode?”。
- Plan exit/approval 有不同升级选择：approve + auto-accept edits、approve + manual confirm edits、reject with feedback。

**风险说明**

Linghun 目前已避免 plan 直接 bypass 的一个关键风险，但整体边界还不够完整：

- bypass 是否本地显式启用不清楚。
- auto 是否具备 classifier/gate 前置条件不清楚。
- Plan approval 不能选择“批准计划但手动确认编辑”或“批准并 accept edits”。
- 自然语言请求模式切换时容易退化为 `/mode` 或 Start Gate，而不是完整模式安全策略。

**最小修复建议**

- 为 bypass 增加本地 opt-in / config gate；不可用时明确拒绝。
- 为 auto 增加 classifier/gate 可用性检查。
- Plan approval surface 至少区分：
  - approve plan + manual edits；
  - approve plan + accept edits；
  - reject / keep planning with feedback。
- mode change 必须统一写入 session-visible status/event，避免状态漂移。

**Beta 前是否必须修：必须，至少 bypass/auto gating 必须修；Plan approval 多选可作为 Beta 前强建议。**

---

## 3. P2 问题清单

### P2-1：RuntimeStatus 短摘要方向正确，但 provider 硬编码

**文件证据**

- RuntimeStatus 结构短，未注入完整 memory/transcript/index：  
  `packages/tui/src/natural-command-bridge.ts:705-735`
- provider 硬编码为 `"deepseek"`：  
  `packages/tui/src/natural-command-bridge.ts:727`
- system prompt 注入 RuntimeStatus 与 capability summary：  
  `packages/tui/src/index.ts:5035-5043`

**风险说明**

Linghun 是多 provider 设计。RuntimeStatus 给模型看的 provider 不准确，会影响模型解释当前状态，也会误导用户对路由/成本/cache 的理解。

**最小修复建议**

- `RuntimeStatusSource` 增加 provider id/name。
- 从当前 resolved route/config 填充，不硬编码 deepseek。

**是否 Beta 前必须修：建议 Beta 前修，但不单独阻塞。**

---

### P2-2：Help 已接 catalog，但 detailed help 仍可能漂移

**文件证据**

- catalog help 由 catalog 生成：  
  `packages/tui/src/index.ts:5129-5147`
- detailed help 仍有静态内容拼接：  
  `packages/tui/src/index.ts:5150+`

**风险说明**

这会造成 OpenCode 参考中提到的典型问题：help 变成静态手册，容易承诺不可用命令或遗漏真实命令。Phase 15 当前最需要避免“自然语言入口”和 slash help 两套解释漂移。

**最小修复建议**

- 继续保留详细说明，但命令列表、风险、自然语言桥提示从 registry/catalog 派生。
- 增加 help/catalog snapshot 或 coverage test。

**是否 Beta 前必须修：Beta 前建议修；若 P1-1 共享 registry 已修，这个可顺带解决。**

---

### P2-3：pending natural confirmation 没有过期与风险重放

**文件证据**

- pending 记录包含 `createdAt`，但确认时未检查：  
  `packages/tui/src/index.ts:4999-5005`、`4960-4970`
- 确认只显示 “Confirmed. Running equivalent slash command”：  
  `packages/tui/src/index.ts:4963-4968`

**风险说明**

用户隔一段时间后输入“确认”，可能执行早已忘记上下文的命令。虽然任意非确认输入会取消 pending gate，但仍建议增加过期和风险重放。

**最小修复建议**

- 例如 60-120 秒过期。
- 确认时再次显示 exact command、risk、scope。
- 对高风险命令要求 `确认 /command`。

**是否 Beta 前必须修：建议 Beta 前修；可与 P1-4 合并。**

---

### P2-4：OpenCode 风格的输出组织和 pending gate 可见性还可增强

**OpenCode 参考边界摘要**

- status 按 MCP / LSP / formatters / plugins 分组，并有 empty state。
- permission prompt 会展示 exact risky action，区分 allow once / allow always / reject。
- pending permissions 会阻塞正常输入，并在 footer/status 显示。
- tool output 默认 summary-first，可展开，不 flood transcript。

**Linghun 风险**

Natural Bridge 输出目前能给出 Start Gate 和阻断说明，但对真实 Beta 的 TUI/output 组织还不够强：

- pending natural gate 是否在状态栏持续可见不明显。
- 权限/Start Gate 与普通模型聊天之间的 modal 边界不够强。
- tool output summary-first / expand 主要不是本次 Phase 15 preflight 核心，但会影响真实项目 Beta 体验。

**最小修复建议**

- pending Start Gate 在 status/footer 显示。
- pending gate 存在时，普通输入默认取消或要求明确选择，不应悄悄混入模型聊天。
- 对 long task/tool output 保持 summary-first，不默认输出大段日志。

**是否 Beta 前必须修：属于体验 hardening；pending gate 可见性建议 Beta 前修，完整 expand/collapse 可后续。**

---

## 4. 哪些必须在 Phase 15 Beta 前修，哪些是后续 hardening

### 必须在 Phase 15 Beta 前修

1. **Catalog / slash dispatch 单一事实来源**  
   否则自然语言入口和实际命令会漂移。

2. **Router 从关键词 smoke 升级到 capability-level intent patterns**  
   不要求模型语义执行，但必须比固定关键词更稳。

3. **关键参数提取**  
   至少覆盖 mode/workflow/fork/index/model/branch 的常见参数。

4. **Start Gate 后的 command-level risk enforcement**  
   特别是 writesConfig、dangerous、stateful refresh/init、permission pipeline 类命令。

5. **测试矩阵补齐**  
   每个 capability 至少中英文用途/风险/动作/状态路径，外加高风险反例。

6. **bypass / auto mode gating**  
   bypass 必须本地 opt-in；auto 必须检查可用性，不可自然语言或 bridge 请求静默提权。

### Beta 前强建议修，但可与上面合并

1. RuntimeStatus provider 不再硬编码。
2. pending natural confirmation 加过期和风险重放。
3. `/help` detailed 内容从 catalog/registry 派生，避免漂移。
4. pending gate 在 status/footer 可见。

### 后续体验 hardening

1. OpenCode 风格完整 output grouping / expand-collapse。
2. 更丰富的 permission prompt：allow once / allow always / reject with feedback。
3. Plan exit approval 的多选交互完全对齐 CCB：批准并 auto-accept edits、批准但手动确认 edits、拒绝并反馈。
4. Status dialog 按 subsystem 分组展示 MCP / index / memory / cache / skills / plugins / hooks 健康状态。

---

## 5. 对“是否弱化、残缺、关键词补丁”的判断

**判断：不是纯关键词补丁，但目前仍偏“硬编码 heuristic preflight”，还不是成品级 Natural Command Bridge。**

它已经具备正确骨架：

- catalog；
- local router；
- Start Gate；
- permission block；
- short RuntimeStatus；
- model-visible capability summary；
- bilingual smoke；
- high-risk natural language block。

但核心风险是：  
**catalog 和实际 command 没有真正统一，router 语义和参数提取不足，测试矩阵不够，模式/权限边界不如 CCB 成熟。**

所以它适合作为 Phase 15 preflight 原型完成记录，但不适合作为真实项目 Beta 的入口直接放大测试。

---

## 6. 审查边界说明

本次按要求执行了只读审查：

- 没有修改代码。
- 没有进入 Phase 15 Beta。
- 没有进入 Phase 15.5。
- 没有进入 Phase 16+。
- CCB / OpenCode 仅参考公开行为、交互边界和验收思路，没有复制源码实现。

本次并行审查来源：

- Linghun implementation 审查。
- CCB interaction boundary 参考审查。
- OpenCode TUI/output 组织参考审查。

---

## 7. 参考文件

Linghun 当前实现：

- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/natural-command-bridge.test.ts`
- `packages/tui/src/index.ts`
- `docs/delivery/phase-15-natural-command-bridge.md`

Linghun 项目约束与阶段文档：

- `CLAUDE.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`

外部行为参考，仅限交互与验收边界：

- `F:\ccb-source`
- `F:\freecodex\opencode-source`

未复制 CCB、OpenCode、Hermes 或任何可疑/专有源码实现。

---

## 8. Phase 15 preflight hardening 后复核结论

> 复核类型：文档收尾复核  
> 复核日期：2026-05-17  
> 复核范围：仅复核本报告所列 Phase 15 preflight hardening 阻塞项的闭环状态，不代表已进入 Phase 15 真实项目 Beta。

本报告前文保留为 **pre-hardening 历史审查记录**：其结论反映的是 Phase 15 preflight hardening 开始前的风险状态，用于说明当时为什么阻塞 Phase 15 真实项目 Beta。

Phase 15 preflight hardening 完成后，原报告指出的主要阻塞项已补齐：

- **Registry / dispatch drift detection**：已补充 slash command registry，并用真实用户可见 dispatch 列表校验 catalog 覆盖，降低 catalog、help、router 与实际 slash handler 漂移风险。
- **Key parameter extraction**：已补齐 mode、workflow、fork/agent role、index、model、branch 等关键自然语言参数提取；低置信度和多候选继续澄清，不猜测执行。
- **Pending Start Gate metadata / expiry / exact command**：pending gate 已记录 `gateId`、`createdAt`、`expiresAt`、`source`、`exactCommand`、`risk`、`scope`，状态栏显示 pending gate；过期 gate 拒绝执行，refresh/init、workflow/fork、高风险、写配置和权限管道类 gate 要求 exact command，不接受普通“确认/yes”直通。
- **bypass / auto 本地 opt-in**：`bypass` 需要本地显式 `LINGHUN_ENABLE_BYPASS=1`；`auto` 需要本地 `LINGHUN_ENABLE_AUTO_PERMISSION=1` 表示 gate/classifier 可用；自然语言、workflow、agent、plugin 或 hook 不能静默开启。
- **Plan approval 边界**：Plan approval 已区分 manual / acceptEdits 边界，并明确不授权 Bash、联网、依赖、权限规则或第三方启用；reject 可记录反馈。
- **测试矩阵**：已扩展 catalog/dispatch drift、关键参数提取、高风险反例、pending gate metadata/expiry/exact confirmation、bypass/auto gating、Plan 边界、RuntimeStatus 和 CommandCapabilitySummary 短摘要稳定性测试。

复核后的当前结论：**不再因本报告列出的 Phase 15 preflight hardening 项阻塞 Phase 15 真实项目 Beta**。

仍需注意：Phase 15 真实项目 Beta 尚未开始；是否进入 Beta 仍必须由用户明确确认。进入 Beta 后仍需要在真实项目中验证自然语言命中率、交互噪声、权限边界、Start Gate 体验、RuntimeStatus 稳定性和真实工作流表现。
