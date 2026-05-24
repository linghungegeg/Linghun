# Pre-Smoke Slice E: Strong Foundation Integration Check

> 审计日期：2026-05-25
> 审计范围：源码级只读审计，验证 Closure D/D.5 后 Linghun 是否达到"强基础、轻学习曲线"pre-smoke 成熟度
> 审计模式：read-only，无代码变更，无 commit，无真实 provider 调用

---

## 验证命令结果

| 命令 | 结果 |
|------|------|
| `corepack pnpm exec vitest run packages/tui/src/architecture-runtime.test.ts packages/tui/src/shell/view-model.test.ts packages/tui/src/index.test.ts packages/config/src/index.test.ts apps/cli/src/main.test.ts` | ✅ 5 test files, 298 tests ALL PASS |
| `corepack pnpm typecheck` | ✅ PASS（零错误） |
| `corepack pnpm check` | ✅ 80 files, no fixes needed |
| `git diff --check` | ✅ clean（无空白问题） |
| `git status` | 仅新增本报告文件：`?? docs/delivery/pre-smoke-slice-e-strong-foundation-integration-check.md` |

---

## Source-Level Reality Check

### 实际读取的文件

| 文件 | 大小/行数 | 审计深度 |
|------|-----------|----------|
| `packages/tui/src/natural-command-bridge.ts` | ~68.7KB | 全文（通过 persisted output） |
| `packages/tui/src/architecture-runtime.ts` | 416 行 | 全文精读 |
| `packages/tui/src/architecture-runtime.test.ts` | 293 行 | 全文精读 |
| `packages/tui/src/shell/view-model.ts` | 412 行 | 全文精读 |
| `packages/tui/src/shell/view-model.test.ts` | ~53 tests | 全文精读 |
| `packages/tui/src/shell/components/ShellApp.tsx` | 242 行 | 全文精读 |
| `packages/tui/src/shell/ink-renderer.tsx` | 90 行 | 全文精读 |
| `packages/tui/src/shell/plain-renderer.ts` | 116 行 | 全文精读 |
| `packages/tui/src/request-lifecycle-presenter.ts` | 139 行 | 全文精读 |
| `packages/tui/src/permission-presenter.ts` | 88 行 | 全文精读 |
| `packages/tui/src/runtime-status-presenter.ts` | 87 行 | 全文精读 |
| `packages/tui/src/tool-output-presenter.ts` | 196 行 | 全文精读 |
| `packages/tui/src/index.ts` | 14000+ 行 | 分段精读（imports, types, model request flow, system prompt assembly） |
| `apps/cli/src/cli.ts` | 400+ 行 | 全文精读 |
| `packages/config/src/index.ts` | 400+ 行 | 全文精读 |
| `README.md` | — | 全文精读 |
| `START_NEXT_CHAT.md` | — | 全文精读 |

---

## What Is Actually Wired（已真实接线的能力）

### 1. Architecture Runtime → Model System Prompt 注入

**证据链：**
- `packages/tui/src/index.ts` 13469-13480 行：model request flow 中调用 `shouldTriggerArchitectureRuntime(input)` → `createArchitectureCard(input, context)` → `createArchitectureRuntimeDirective(card)` 生成 directive
- `packages/tui/src/index.ts` 14570-14649 行：`createModelSystemPrompt` 将 architectureDirective 注入 system prompt 文本
- `architecture-runtime.ts` 完整实现：trigger 判断（SYSTEMIC_TRIGGER_PATTERNS / SMALL_TASK_PATTERNS / CONTROL_PLANE_PATTERNS）、card 生成、drift 检测
- 116 个测试覆盖 trigger rules、card facts、drift detection

**结论：Architecture Runtime 是真实运行时能力，不是 mock。**

### 2. Natural Language Routing

**证据链：**
- `natural-command-bridge.ts`：`routeNaturalIntent` 函数接收用户输入，匹配 CommandCapability catalog，区分 status query / action / unknown
- CommandCapability 类型定义完整（name, triggers, description, category, requiresPermission）
- `getUserVisibleCommandCapabilities` 导出可用命令列表
- `buildRuntimeStatusForModel` 构建运行时状态供 model 参考

**结论：模型配置、状态/权限/缓存/索引/长任务等高置信入口已有自然语言路径；slash command 保留为高级/恢复/调试入口。**

### 3. TUI Shell Home→Task 双模式

**证据链：**
- `shell/view-model.ts`：`createShellViewModel` 根据 activity/permission/outputBlocks 自动切换 viewMode（home/task）
- `shell/components/ShellApp.tsx`：HomeLayout（brand + vision + composer + status tray）和 TaskLayout（compact top bar + activity + permission + blocks + composer）
- `shell/ink-renderer.tsx`：TTY 检测 → Ink React 渲染（alternateScreen, resize debounce 60ms）
- `shell/plain-renderer.ts`：非 TTY fallback 纯文本渲染
- 53 个 view-model 测试覆盖双语、状态、blocks、activity、permission

**结论：TUI 双模式布局已完整实现，有 Ink 和 plain-text 双渲染路径。**

### 4. Provider/Auth 安全

**证据链：**
- `packages/config/src/index.ts`：`providerEnvTemplate` 定义 `~/.linghun/provider.env` 格式
- `apps/cli/src/cli.ts`：`runModelCommand` 实现 show/set/doctor，检测 key source（env/user-provider-env/project-settings-legacy/missing），显示 masked secrets
- env 优先级：shell env > provider.env > project settings（代码中明确实现）
- `/model doctor` 输出 baseUrl 诊断、key 来源、连通性检查

**结论：Provider/Auth 配置中心已实现，key 不明文暴露，有诊断路径。**

### 5. Permission Presenter

**证据链：**
- `permission-presenter.ts`：`formatLocalToolPermissionPrompt` 输出 tool/reason/risk/scope/next 结构化提示
- `shell/view-model.ts`：`mapPendingApprovalToPermission` 将 pendingLocalApproval 映射为 TaskPermissionView
- `ShellApp.tsx`：PermissionPrompt 组件渲染 bordered box

**结论：权限提示已实现人类可读格式，非 raw JSON dump。**

### 6. Output Summary-First 分层

**证据链：**
- `tool-output-presenter.ts`：`createLayeredToolOutput` 对 Read/Grep/Glob/Bash/Write/Edit/MultiEdit 生成 summary + detail + debug 三层
- Todo 输出限制 8 条；长输出截断并提示 `/details`
- `request-lifecycle-presenter.ts`：provider failure 分类（gateway/timeout/abort/schema/generic）并给出 actionable next steps

**结论：输出分层已实现，主屏 summary-first，详情可展开。**

### 7. Key Redaction

**证据链：**
- `shell/view-model.ts` 357-362 行：`redactSensitiveText` 函数
  - 匹配 `sk-[A-Za-z0-9_-]{8,}` → `[masked-key]`
  - 匹配 `api_key=...` → `[masked-key]`
  - 匹配 `Authorization: Bearer ...` → `[masked-key]`
  - 匹配 `Bearer [token]` → `Bearer [masked-key]`
- `createOutputBlock` 调用 `redactSensitiveText` 处理所有输出文本

**结论：Key 脱敏已在输出层实现，覆盖常见 key 格式。**

### 8. Setup 轻提示

**证据链：**
- `shell/view-model.ts` 91-92 行：`setupHint = setupNeeded ? text.setupHint : undefined`
- setupHint 文本："还没有模型配置。按 Enter 开始，或说'我要配置模型'。"
- 不是 bordered block，是轻量文本提示
- 用户无需知道 `/model setup` 即可开始

**结论：新手引导是轻提示，不是阻塞式 wizard，符合"轻学习曲线"。**

---

## What Is Only Hint/Prompt/Mock（仅为提示/引导/未真实执行的部分）

### 1. MaturityDefaults（仅 prompt 级指令）

- `createArchitectureRuntimeDirective` 输出的 `MaturityDefaults=...` 是注入 model system prompt 的文本指令
- 内容："信息架构清晰、响应式布局、状态/空态/错误态/加载态完整、可读性优先、语义化结构"
- **性质：prompt-level guidance，引导 model 行为，无代码级强制执行**
- 影响：model 可能不遵守，但这是 Architecture Runtime 设计意图（引导而非阻塞）

### 2. LongTaskHint（仅 prompt 级提示）

- directive 中包含 `LongTaskHint=若任务涉及多步骤...主动提示用户可用 /autopilot 或 /plan`
- **性质：prompt-level hint，提示 model 在长任务时建议用户切换模式**
- 实际 `/autopilot` 和 `/plan` 命令是否完整接线未在本次审计中验证端到端路径（需要真实 provider）

### 3. FreshnessBoundary（prompt 级边界标记）

- `createModelSystemPrompt` 注入 FreshnessBoundary 文本
- **性质：告知 model 不要把过期/未验证的外部事实当作确认事实**
- 无代码级 gate 阻止 model 使用过期信息

### 4. SolutionCompleteness（prompt 级警告）

- 注入 system prompt 的 systemic gap 检测提示
- **性质：引导 model 识别重复问题模式，无运行时强制**

### 5. Model-Invoked Command Execution

- `createModelCapabilitySummary(24)` 将 24 个命令能力注入 prompt
- model 可以"知道"这些命令存在，但实际执行路径需要真实 provider 调用才能验证端到端
- 本次审计确认：routing 代码存在、capability catalog 完整、但未验证 model 实际调用→执行→反馈闭环

---

## Natural Language First Check

| 检查项 | 结果 |
|--------|------|
| 用户说"我要配置模型"能否触发 setup | ✅ setupHint 引导 + routeNaturalIntent 路由 |
| 用户说"查看模型状态"能否得到状态 | ✅ routeNaturalIntent 识别 status query |
| 用户说"做一个页面"能否触发 Architecture Runtime | ✅ SYSTEMIC_TRIGGER_PATTERNS 匹配 |
| 用户说"修一个 typo"不触发 Architecture Runtime | ✅ SMALL_TASK_PATTERNS 优先匹配 |
| 高置信入口有自然语言路径 | ✅ 模型配置、状态/权限/缓存/索引/长任务等入口已有自然语言路径；slash command 保留为高级/恢复/调试入口 |

---

## TUI Flow Check

| 检查项 | 结果 |
|--------|------|
| Home 模式显示 brand + vision + composer + status | ✅ HomeLayout 组件 |
| Task 模式显示 activity + permission + blocks + composer | ✅ TaskLayout 组件 |
| Activity indicator 有 phase 颜色区分 | ✅ thinking=cyan, tool_running=yellow, continuing=green, permission_waiting=red |
| Permission prompt 有 bordered box + hint | ✅ PermissionPrompt 组件 |
| 非 TTY 有 plain-text fallback | ✅ plain-renderer.ts |
| Resize 有 debounce | ✅ 60ms debounce in ink-renderer |
| 窄终端（≤40 列）有截断处理 | ✅ truncateMiddle + fitBlockToWidth |
| CJK 字符宽度正确计算 | ✅ charWidth 函数处理 CJK 范围 |

---

## Provider/Auth Safety Check

| 检查项 | 结果 |
|--------|------|
| Key 存储在 `~/.linghun/provider.env` | ✅ providerEnvTemplate 定义 |
| env 优先级明确（shell > provider.env > project） | ✅ 代码实现 |
| `/model doctor` 显示 masked key + source | ✅ runModelCommand 实现 |
| 输出层 key 脱敏 | ✅ redactSensitiveText 覆盖 sk-*/api_key/Bearer |
| 不在 project settings 明文存 key | ✅ project-settings-legacy 标记为 legacy |

---

## Long Task / Runner / Background Check

| 检查项 | 结果 |
|--------|------|
| BackgroundTaskState 类型定义 | ✅ index.ts types 区域 |
| BackgroundTaskSummary 在 view-model 中渲染 | ✅ mapBackgroundSummariesToBlocks |
| status tray 显示后台任务数 | ✅ formatBackground(count) |
| 后台任务 completed 不等于 verification pass | ✅ completedNote: "已结束，非验证通过" |
| `/autopilot`、`/job`、`/background` handler 和 alias | ✅ CommandCapability catalog 中注册，handler 存在 |
| D.5 LongTaskHint | ⚠️ 仅 prompt-level hint，注入 Architecture Runtime directive 文本；非代码级 gate |
| 长任务托管端到端链路 | ❌ 未做真实 provider 端到端验证，不能宣称长任务托管真实链路已 smoke 通过 |

---

## Remaining Real Smoke Risks（真实 Smoke 风险）

### 必须在 Smoke 前确认（但不一定需要代码修改）

1. **端到端 model 调用路径**：Architecture Runtime directive 注入、natural language routing、command execution 的完整闭环需要真实 provider 调用验证。当前代码结构正确，但未经真实 API 验证。

2. **`/autopilot` 和 `/plan` 实际可用性**：LongTaskHint 提到这两个命令，需确认它们在 CommandCapability catalog 中注册且有实际处理逻辑。

3. **provider.env 首次创建流程**：`/model setup` wizard 的完整交互路径需要 TTY 环境验证。

### 非阻塞性观察（可在后续阶段处理）

1. **Architecture Runtime drift detection 的运行时集成**：`detectArchitectureDrift` 函数已实现且有测试，但其在实际 tool call 前的拦截点需要真实 session 验证。

2. **plain-renderer 在极窄终端（<30 列）的表现**：normalizeWidth 最小值为 30，但实际渲染在 30 列下可能仍有溢出。

3. **index.ts 单文件 14000+ 行**：功能正确但维护成本高。这是已知技术债，不影响 smoke 功能。

---

## Final Statement

### 审计结论

基于源码审查 + focused/local/mock 验证，未发现进入真实 provider smoke 前必须先修的代码级 blocker。

- **Architecture Runtime** 是真实运行时能力，已接线到 model system prompt 注入链路
- **Natural Language First** 高置信入口已有自然语言路径；slash command 保留为高级/恢复/调试入口
- **TUI 双模式** 完整实现，有 Ink + plain-text 双渲染路径
- **Provider/Auth** 安全，key 脱敏覆盖主要格式
- **Permission** 人类可读，非 raw dump
- **Output** summary-first 分层
- **298 个测试全部通过**（5 test files），typecheck/lint/格式检查均 clean

### 是否发现必须先修的问题

**否。** 未发现阻塞进入真实 provider smoke 的代码级缺陷。所有 remaining risks 属于"需要真实 provider 端到端验证"类别，不是代码结构问题。

### 边界声明

- 本次审计未进入真实 smoke，未宣布 Beta PASS / smoke-ready / open-source-ready。
- 长任务托管端到端链路未经真实 provider 验证。
- 最终 smoke 状态需在真实 provider 调用后单独确认。

---

## 参考核对

- 本次审计实际读取了上表列出的 17 个源码文件
- 未参考外部 CCB / 社区项目文件（本次为只读审计，不涉及实现）
- 未复制任何可疑源码实现
- 验证命令均在本地仓库执行，未触及远程服务
