# Phase 15 preflight：Natural Command Bridge / 自然语言控制桥

## 阶段目标

完成 Phase 15 真实项目 Beta 之前的 preflight：让普通中文/英文自然语言先进入本地 Natural Command Bridge，由本地 Command Capability Catalog 与 intent router 裁决是否可回答、是否可执行只读状态查询、是否进入 Start Gate、是否进入权限管道，模型只负责解释，不靠猜测执行命令。

本阶段只完成自然语言控制桥 preflight，不进入 Phase 15 真实项目 Beta，不进入 Phase 15.5 双模型交叉审查，也不实现 Phase 16+ 的长期学习、长期任务、Remote Channels 或桌面端。

## 已完成功能

- Command Capability Catalog：
  - 覆盖当前 TUI 用户可见 slash commands：`/help`、`/language`、`/model`、`/vision`、`/image`、`/skills`、`/workflows`、`/plugins`、`/doctor`、`/sessions`、`/resume`、`/branch`、`/memory`、`/mode`、`/tab`、`/plan`、`/permissions`、`/background`、`/agents`、`/fork`、`/rewind`、`/btw`、`/interrupt`、`/claim-check`、`/verify`、`/review`、`/cache-log`、`/cache`、`/break-cache`、`/mcp`、`/index`、`/usage`、`/stats`、`/read`、`/write`、`/edit`、`/multiedit`、`/grep`、`/glob`、`/bash`、`/todo`、`/diff`、`/exit`。
  - 显式标记内部隐藏入口 `/status`，并保留 `hiddenReason`。
  - 每项能力包含 `id`、`slash`、`aliases`、中英文标题、描述、whenToUse、risk、只读性、modelInvocable、userInvocable、Start Gate、配置写入、权限管道和 bridgeSafe 元数据。
- `/help` 使用同一份 catalog 展示能力、风险与自然语言桥说明，同时保留原有详细 help 内容，避免破坏既有用户路径和测试。
- Model prompt 只注入短摘要：
  - `RuntimeStatusForModel`：memory/index/cache/model/permissionMode/extensions 的短结构化字段。
  - `CommandCapabilitySummary`：稳定排序、可截断、短文本，不包含完整 transcript、完整 memory、完整索引、完整 skill/plugin/hook 正文或动态大输出。
- Natural Intent Router：
  - 普通非 slash 输入先经本地 router。
  - 支持中英文语义变体、疑问句、命令式、slash command 用途/风险询问。
  - 低置信度、拼写不准、多候选时进入澄清，不猜测执行。
  - 中文/英文同一能力进入同一风险处理路径。
- 风险裁决与 preflight hardening：
  - 只读状态查询可走等价 slash command。
  - 需要动作的索引、workflow、resume、branch、fork、verify、review 等进入 Start Gate。
  - Catalog 增加 `SLASH_COMMAND_REGISTRY`，并用 TUI 真实用户可见 dispatch 列表做漂移检测。
  - mode/workflow/fork/index/model/branch 支持关键自然语言参数提取；低置信度或多候选时澄清，不猜测。
  - pending natural Start Gate 记录 `gateId`、`createdAt`、`expiresAt`、`source`、`exactCommand`、`risk`、`scope`，状态栏显示 pending gate。
  - refresh/init、workflow、fork、高风险、写配置、权限管道等 gate 不接受普通“确认/yes”，必须输入 exact command；过期 gate 拒绝执行。
  - `bypass` 必须 `LINGHUN_ENABLE_BYPASS=1` 本地显式 opt-in；`auto` 必须 `LINGHUN_ENABLE_AUTO_PERMISSION=1` 表示本地 gate/classifier 可用；Plan approval 只确认方案边界，不授权所有工具。
  - 写文件、编辑、多处编辑、Bash、权限规则、bypass、force refresh、第三方启用、记忆接受/删除、rewind restore、hook/job/remote/dependency install 等自然语言不直通，只解释风险或进入权限管道。
- LINGHUN.md template cleanup follow-up：`/memory init` 默认生成中文“项目规则”模板，覆盖长期规则用途、写入/不写入边界、事实优先、Start Gate/权限审批、候选记忆确认、最小验证、上下文裁剪、clean rewrite 和中英文可读性；已有 `LINGHUN.md` 继续只提示已存在，不静默覆盖。

## 使用方式

进入 REPL 后可直接输入自然语言或 slash command：

```bash
corepack pnpm build
corepack pnpm exec linghun
```

示例：

```text
自动记忆功能是否打开
is memory enabled?
帮我建立索引
build the index
缓存命中怎么样
cache hit rate
你是什么模型
what model are you using?
当前权限模式
current permission mode
有哪些工作流
list workflows
打开 bug-fix 工作流
start bug-fix workflow
hook 开了吗
are hooks enabled?
恢复上次会话
resume last session
/cache status 是干什么的
what does /branch do?
怎么搜索代码里的 TODO
show me the diff
帮我做一次 review
start a verifier agent
帮我直接运行 npm install
直接开启 bypass
直接接受所有记忆
force refresh index
```

## 涉及模块

- `packages/tui/src/natural-command-bridge.ts`：新增 Command Capability Catalog、Natural Intent Router、RuntimeStatusForModel、自然语言回答/澄清/Start Gate/权限阻断格式化。
- `packages/tui/src/natural-command-bridge.test.ts`：新增 catalog 覆盖、第一批/第二批/第三批路由、安全阻断、风险一致性、低置信度、RuntimeStatus 测试。
- `packages/tui/src/index.ts`：接入普通输入的本地自然语言路由、pending natural Start Gate 确认、catalog help、model prompt 短 RuntimeStatus 和能力摘要。
- `docs/delivery/README.md`：Phase 15 preflight 状态更新。
- `README.md`：当前进度更新为 Phase 15 preflight 完成。
- `START_NEXT_CHAT.md`：下一会话 handoff 更新为 Phase 15 preflight 已完成，下一步必须先确认是否进入 Phase 15 真实项目 Beta 或 Phase 15.5。

## 关键设计

- Catalog 是单一事实来源：router、`/help` 和 model-visible summary 共用同一份能力目录。
- 本地裁决优先：自然语言是否执行不交给模型猜，先由本地 router 决定 action。
- 双语等价：中英文 title/description/whenToUse/aliases 都进入匹配与解释；同一能力的中英文意图保持同一 risk handler。
- Summary-first：给模型的 catalog/runtime 状态是短摘要，不注入完整日志、完整 transcript、完整 memory、完整索引、完整 skill/plugin/hook 正文。
- 保守安全：高风险自然语言不直通，即使用户写“直接”“force”“bypass”“npm install”“接受所有记忆”等，也只进入权限阻断/审批说明。
- Start Gate 不替代权限审批：自然语言确认只能触发等价 slash command；slash command 内部写文件、Bash、配置写入、第三方启用等仍必须走后续权限管道。

## 覆盖矩阵

| 批次 | 能力 | 自然语言处理 |
| --- | --- | --- |
| 第一批状态/动作 | `memory`、`index`、`cache`、`model`、`mode`、`workflows`、`skills`、`plugins`、`hooks`、`sessions`、`resume`、`branch` | 状态/用途可回答或只读执行；动作进入 Start Gate；危险变体进入权限管道。 |
| 第二批发现/解释/确认 | `read`、`grep`、`glob`、`todo`、`verify`、`review`、`diff`、`fork`、`agents`、`background` | 可解释用途/风险；只读状态可执行；需要实际动作或工具权限时进入 Start Gate/权限管道。 |
| 第三批高风险 | `write`、`edit`、`multiedit`、`bash`、`permissions`、`mode bypass`、`cache refresh`、`index force`、`skills/plugins enable`、`memory accept/delete`、`rewind restore`、`hook` | 不自然语言直通；只输出风险说明、Start Gate 或权限管道提示。 |
| 内部/隐藏 | `/status` | Catalog 中显式标记 hiddenReason，不在普通 `/help` 用户入口中作为可见命令主推。 |

## 禁止直通命令

自然语言请求以下能力时不得直接执行：写文件、编辑、多处编辑、Bash、依赖安装、权限规则增删、bypass 权限模式、force refresh index/cache、第三方 skill/plugin 启用、记忆批量接受或删除、rewind restore、hook 执行或启用、job/remote 类能力。

## 低置信度处理

- 无匹配或低分：返回澄清提示，不转给等价命令。
- 多候选分数接近：列出候选能力，不猜测用户意图。
- 明确 slash command 用途/风险询问：直接回答该 command 的用途、风险与安全边界。

## 中英文 smoke 覆盖

单元测试覆盖以下代表性中文/英文短语：

- `自动记忆功能是否打开` / `is memory enabled?`
- `帮我建立索引` / `build the index`
- `缓存命中怎么样` / `cache hit rate`
- `你是什么模型` / `what model are you using?`
- `当前权限模式` / `current permission mode`
- `有哪些工作流` / `list workflows`
- `打开 bug-fix 工作流` / `start bug-fix workflow`
- `hook 开了吗` / `are hooks enabled?`
- `恢复上次会话` / `resume last session`
- `开个分支试试` / `create a branch session`
- `怎么搜索代码里的 TODO`
- `how do I read a file`
- `怎么按模式找文件`
- `todo 怎么用`
- `怎么跑验证`
- `帮我做一次 review`
- `show me the diff`
- `start a verifier agent`
- `有哪些 agents`
- `后台任务怎么看`
- `帮我直接运行 npm install`
- `直接开启 bypass`
- `直接接受所有记忆`
- `force refresh index`
- `直接帮我写文件`
- `install dependency now`

## 配置项

本阶段不新增持久化配置 schema；为避免自然语言、workflow、agent、plugin 或 hook 静默提权，preflight hardening 仅使用本地显式环境开关：

- `LINGHUN_ENABLE_BYPASS=1`：允许用户本地显式切换 `/mode bypass`。未设置时拒绝切换。
- `LINGHUN_ENABLE_AUTO_PERMISSION=1`：表示本地 auto gate/classifier 已可用，允许 `/mode auto`。未设置时拒绝切换。

上述开关不替代 Start Gate 或工具权限审批；Plan approval 也不授权 Bash、联网、依赖、权限规则或第三方启用。

## 命令

CLI：

```bash
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
corepack pnpm exec linghun
```

REPL：

```text
/help
/cache status
/model
/mode
/memory
/index status
/workflows
/skills
/plugins
/doctor hooks
/sessions
/resume
/branch
/agents
/background
/diff
/exit
```

自然语言入口见“使用方式”和“中英文 smoke 覆盖”。

## 测试与验证

阶段要求执行：

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm check
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
```

已执行：

- `corepack pnpm test -- --run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts`：通过，11 个测试文件、154 个测试通过。
- `corepack pnpm test`：通过，11 个测试文件、154 个测试通过。首次完整重跑曾命中一个既有长耗时验证 runner 用例 5s 超时；未改测试超时配置，直接重跑通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过，workspace 7 个包构建通过。
- `corepack pnpm check`：通过，43 个文件检查通过。
- `corepack pnpm exec linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec Linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec linghun --help`：通过，输出 Phase 15 preflight CLI help，并说明 TUI Natural Command Bridge。

本次 LINGHUN.md template cleanup follow-up 已执行：

- `corepack pnpm test -- --run packages/tui/src/index.test.ts`：通过，11 个测试文件、154 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm check`：通过，43 个文件检查通过。
- `corepack pnpm build`：通过，workspace 7 个包构建通过。
- 临时空项目 TUI smoke：通过；`/memory init` 生成中文“项目规则”模板，再次运行 `/memory init` 只提示 `LINGHUN.md 已存在`，`/memory` 显示截断摘要而非全文 dump。

本次 Phase 15 pre-Beta cleanup 已执行：

- `corepack pnpm test -- --run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts`：通过，11 个测试文件、157 个测试通过。
- 其余验证命令见本节下方“Phase 15 pre-Beta cleanup 验证结果”。

### Phase 15 pre-Beta cleanup 验证结果

已执行：

- `corepack pnpm test -- --run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts`：通过，11 个测试文件、157 个测试通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm check`：通过，43 个文件检查通过。首次运行发现 `packages/tui/src/index.test.ts` 格式问题，按 formatter 建议做最小格式修正后通过。
- `corepack pnpm build`：通过，workspace 7 个包构建通过。
- `corepack pnpm exec linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec Linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec linghun --help`：通过，输出 Phase 15 preflight CLI help。
- TUI stdin smoke：通过，覆盖 `/cache status`、`/break-cache status`、`/index status`、`/memory`、`/memory storage`、`/mode`、`/plugins doctor`、`/doctor hooks`、`/model route doctor`、`/exit`；输出标题为 `Linghun TUI / REPL`，未显示 Phase 14 标题。

## 性能结果

- `RuntimeStatusForModel` 单元测试要求 JSON 序列化长度小于 500 字符，并确认不包含完整 memory 文本。
- `createModelCapabilitySummary(8)` 单元测试要求摘要小于 1200 字符，并确认不包含 transcript/full log 等大上下文内容。
- Catalog 稳定排序，model-visible summary 可按 limit 截断。

## Phase 15 pre-Beta cleanup 记录

本轮性质：Phase 15 pre-Beta cleanup，只做进入真实项目 Beta 前的小范围修复和补测；未进入 Phase 15 真实项目 Beta、Phase 15.5 或 Phase 16+。

修复项：

- RuntimeStatus provider：`buildRuntimeStatusForModel()` 不再把缺失 provider fallback 为 `deepseek`；调用方传入当前配置可解析出的真实 provider，无法解析时显示 `unknown`。
- TUI 标题：中英文 `appTitle` 从 `Phase 14 TUI / REPL` 改为 `Linghun TUI / REPL` 口径，避免误导当前阶段；CLI 名称和启动命令未改。
- Extension freshness：补充 focused test，证明 skill/plugin/hook/workflow/contribution 输入顺序变化不会导致 `pluginListHash` 无意义变化；未把完整 skill/plugin manifest/hook log 塞入 prompt、状态栏或 freshness。
- 审计文档：pre-Beta cross-review 报告已纳入 `docs/audit/phase-15-pre-beta-cross-review-report.md`，并加入下一轮启动必读清单。

DeepSeek V4 Pro 报告裁决：

- RuntimeStatus provider fallback：已修。
- TUI appTitle Phase 14 文案：已修。
- pluginListHash / extension freshness 稳定性：已补测；当前实现已有稳定排序，无需重构。
- START_NEXT_CHAT 与交付文档未同步 cross-review 报告：已修。
- Catalog/dispatch registry-map 重构：不在本轮做；当前只保留 drift detection + coverage test。完整同源 registry/dispatch 重构属于 Phase 15.5 或后续架构 cleanup，不能混入 pre-Beta 小修。
- command-level permission framework、permission modal、allow once/always、插件市场、远程安装、完整 hook 执行、长期任务、Remote Channels、桌面端：不在本轮做，也不阻塞 Phase 15 Beta；当前安全边界仍由 Start Gate、exact command、drift detection、权限管道和 focused tests 兜底。

Phase 15 Beta 仍需用户明确确认后才能开始。

## 已知问题

- 本阶段是 preflight，不承诺真实项目 Beta 的完整自然语言命令成功率。
- Router 采用本地 catalog、aliases、描述、whenToUse 与 intent clues 的保守评分；低置信度会澄清，可能比模型猜测更保守。
- 高风险命令的真实审批、工具执行与权限细节仍由已有 slash/tool 权限管道负责。
- 未实现 Phase 15.5 双模型交叉审查与开源前 hardening。

## 不在本阶段处理的内容

- Phase 15 真实项目 Beta。
- Phase 15.5 双模型交叉审查与开源前 hardening。
- Phase 16 可控学习闭环。
- Phase 17 长期托管任务、Remote Channels、job 状态表。
- Phase 18 桌面端。
- 插件市场、GitHub 安装、远程安装、自动更新、依赖联网安装。

## 下一阶段衔接

完成本阶段并经验证后，下一步只能在用户明确确认后进入：

1. Phase 15 真实项目 Beta；或
2. Phase 15.5 双模型交叉审查与开源前 hardening。

不得自动进入 Phase 16+。

## 开发者排查入口

- Catalog 覆盖：`validateCommandCapabilityCoverage()`。
- Catalog 数据：`getCommandCapabilityCatalog()`。
- Model 摘要：`createModelCapabilitySummary(limit)`。
- Runtime 状态：`buildRuntimeStatusForModel(context)`。
- 自然语言路由：`routeNaturalIntent(text, language)`。
- TUI 接入：`handleNaturalInput()`、`formatCatalogHelp()`、`sendMessage()` system prompt。
- 测试：`packages/tui/src/natural-command-bridge.test.ts`。

## 参考核对

本阶段实际读取并遵守：

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\README.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-14-skills-workflow.md`
- `F:\Linghun\START_NEXT_CHAT.md`

本阶段参考内容仅限公开行为边界与验收思路：自然语言命令先由本地能力目录/风险管道裁决，模型不猜测执行；高风险动作不绕过 Start Gate 或权限审批。

未复制 CCB、Claude Code、CCB Dev Boost 或任何可疑/专有源码实现；Linghun 的 catalog、router、runtime summary 与测试均为本仓库自研实现。

## 成品级结构化 Handoff Packet

```yaml
phase: "Phase 15 preflight"
status: "done"
delivery_doc: "F:\\Linghun\\docs\\delivery\\phase-15-natural-command-bridge.md"
next_phase_options:
  - "Phase 15 real-project Beta（必须用户明确确认）"
  - "Phase 15.5 cross-model hardening（必须用户明确确认）"
forbidden_without_user_confirmation:
  - "Phase 15 real-project Beta"
  - "Phase 15.5 双模型交叉审查"
  - "Phase 16+"
  - "长期学习/长期任务/Remote Channels/桌面端"
  - "依赖安装或联网安装"
evidence:
  - "packages/tui/src/natural-command-bridge.ts"
  - "packages/tui/src/natural-command-bridge.test.ts"
  - "packages/tui/src/index.ts"
  - "docs/delivery/phase-15-natural-command-bridge.md"
validation_completed:
  - command: "corepack pnpm exec tsc --noEmit --pretty false --project packages/tui/tsconfig.json"
    result: "pass"
  - command: "corepack pnpm test -- --run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts"
    result: "pass"
  - command: "corepack pnpm test"
    result: "pass; 11 test files, 154 tests"
  - command: "corepack pnpm typecheck"
    result: "pass"
  - command: "corepack pnpm build"
    result: "pass; workspace 7 packages"
  - command: "corepack pnpm check"
    result: "pass; 43 files"
  - command: "corepack pnpm exec linghun --version"
    result: "pass; 0.1.0"
  - command: "corepack pnpm exec Linghun --version"
    result: "pass; 0.1.0"
  - command: "corepack pnpm exec linghun --help"
    result: "pass; Phase 15 preflight help"
  - command: "TUI stdin bilingual natural-command smoke"
    result: "pass; first/second/third batch samples covered, high-risk samples blocked"
verification_agent:
  verdict: "PASS"
  spot_check:
    - "corepack pnpm test: pass; 11 test files, 154 tests"
    - "corepack pnpm build: pass; workspace 7 packages"
    - "corepack pnpm check: pass; 43 files"
index_status:
  project: "F-Linghun"
  status: "ready"
  nodes: 706
  edges: 1371
permission_mode: "default"
model_provider: "claude-sonnet-4-6 in Claude Code session; Linghun runtime model unchanged"
budget_notes: "No dependency install; no remote execution; no full transcript/memory/index injection."
remaining_risk:
  - "Router is intentionally conservative and may ask clarification on ambiguous natural language."
  - "Phase 15 real-project Beta and Phase 15.5 hardening are not implemented in this preflight."
```
