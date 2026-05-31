# Linghun D.13 Pre-Smoke 源码审计 + CCB 对比审计

报告时间：2026-05-27（D.13J tail fix 后同步）
基线：master @ a41aff2 "Stabilize Pre-Smoke D.13D TUI Composer Owner-Priority Dispatcher Closure" + 工作树 D.13J tail fix（Block A/B/C/D 已落地，未 commit）
对比基线：F:\ccb-source（CCB 源码）

> 本报告只看源码事实，不跑 smoke，不 commit，不动 D13D_TUI_FOUNDATION_PLAN.md。D.13J tail fix 仅含本次 4 个收口块（MCP tools/list / mutating 死路文案 / 占位模型 doctor BLOCK / 文档同步），不扩散到其他模块。

---

## 一、源码事实（先列事实，再判断）

### 1.1 仓库结构

- Linghun 6 个内部包：`config / core / providers / shared / tools / tui`，无 native bindings、无独立 ink fork、无独立 mcp-client。
- CCB 13 个包：`@ant/{model-provider, ink, computer-use-*, claude-for-chrome-mcp}`、`builtin-tools`、`agent-tools`、`mcp-client`、`acp-link`、`remote-control-server`、4 个 NAPI 原生绑定、`weixin`。
- Linghun 主体在单文件 `packages/tui/src/index.ts`（15846 行）；CCB ink 单包就拆 30+ 文件。

### 1.2 Provider / endpoint 协议

事实：
- `packages/providers/src/index.ts` 实现 3 个 endpointProfile：`chat_completions`、`responses`、`anthropic_messages`；CompatibilityProfile 4 类（deepseek / strict_openai_compatible / permissive_openai_compatible / anthropic_messages）。
- Anthropic 路径鉴权同时下发 `x-api-key + anthropic-version: 2023-06-01` 与 `Authorization: Bearer`，兼容官方 API 与 OpenAI 风格中转（providers/src/index.ts:666-670）。
- `resolveProviderBaseUrlDiagnostic` 自动剥离 `/chat/completions / /responses / /v1/messages` 后缀，并对 `/v1/v1/messages` 做去重。
- D.13G：anthropic_messages 原生支持 tool_use / tool_result / continuation。两条独立修复路径要分清：
  - **request builder（providers/src/index.ts:1268-1349）**：在把 request.messages 翻译成 Anthropic conversation 时，用 builder-scope `pendingToolUseIds: Set<string>` 跨消息追踪 assistant 已发起但未配对的 tool_use；orphan tool_result 直接丢弃；流尾仍未配对的 tool_use 在末位 user 消息追加合成 `is_error: true` tool_result。这是 outbound 修复，发生在请求出网前。
  - **stream parser（providers/src/index.ts:1627、1682、1754-1820）**：另一条路径，用 `pendingToolUses: Map<number, AnthropicPendingToolUse>` 在解码 SSE 时跨 content_block 事件累积 `input_json_delta` 的 partial_json，按 content_block index 闭合 tool_use 块。这是 inbound 解析，与 builder 修复完全不同。
- D.13F：cache_control 仅在 anthropic_messages 路径下挂在最后一个 system block；默认 5m 不写 ttl 字面量；1h 显式时写 `ttl: "1h"`；`linghun-break-cache:<nonce>` 仅注入到最后一个 system block 文本。
- D.13H：cache_edits / cache_reference 是硬禁字段——即便 `contextEditingEnabled=true + endpointProfile=anthropic_messages + anthropicBetaHeaders 非空`，request body 也永不写入这两个字段，只追加 `anthropic-beta` header。Anthropic 官方 `CACHE_EDITING_BETA_HEADER` 仍是空串，因此默认实际还是没动。
- OpenAI 路径硬隔离：`prompt_cache_key / prompt_cache_retention / cache_control` 在 OpenAI chat 与 responses 永不出现（providers/src/index.test.ts:1822、1851-1853）。

判断：协议层是 D.13 真正成熟的部分。三种 endpoint 都有专属 builder、专属 stream parser，错乱场景（orphan tool_result、partial_json、stop_reason 缺失）都有明确兜底。

### 1.3 Model route / env override

事实：
- `packages/config/src/index.ts` 默认 `defaultLinghunModel = LINGHUN_DEFAULT_MODEL ?? LINGHUN_DEEPSEEK_MODEL ?? "deepseek-v4-flash"`。
- 5 类 role route：planner / executor / reviewer / verifier / commit-message；每个 role 各自 `primaryModel + fallbackModels`，role 缺失时降级到 `defaultModel`。
- env 来源 4 路：`process.env`、`~/.linghun/provider.env`（mergeProviderEnvConfig）、project `settings.json`、user `settings.json`。优先级在 `mergeProviderEnvConfig` 内部解决——`providerEnv.modelRoutes` 会盖过 `projectSettings.modelRoutes`（config/src/index.ts:844）。
- D.13H tail 校验：`contextEditingEnabled` 必须是 optional boolean；`anthropicBetaHeaders` 出现时必须是 `string[]`，单个元素也要是 string（config/src/index.ts:1201-1218）。

判断：
- 优先级链是清晰的，但**用户级 `~/.linghun/provider.env` 直接能覆盖项目级 modelRoutes**——这就是上一轮 Block 1 三个 pre-existing 测试失败的真因。生产场景同样会触发：用户在 `~/.linghun/provider.env` 写一个 LINGHUN_OPENAI_MODEL，整个项目的 default route 就漂到 openai-compatible。这条优先级在 README 必须显式说明。

### 1.4 Tools / continuation 链路

事实：
- 内置工具直接挂在 model loop（Read/Edit/Write/Bash/Grep/Glob/Todo），不进 ExecuteExtraTool。
- deferred tool 4 类（tui/src/index.ts:10193-10283）：
  - `codebase-memory`：10 个静态白名单（`list_projects / index_status / detect_changes / index_repository / search_code / get_architecture / get_code_snippet / query_graph / trace_path / search_graph`），`executable=true`，每个工具有 `requiredArgs` 校验。
  - `mcp:<server>:<tool>`：D.13J Block 4 已落地本地 stdio MCP runtime adapter——`isLocalStdioMcpServer`（command 非空、未 disabled）的 server 在 `/mcp doctor` 路径会真实跑 `initialize → tools/list → tools/call`（`runMcpStdioToolList` 5s 探测；`runMcpStdioToolCall` 15s 调用）；schema 来自真实 `tools/list` 返回，`executable=true / trusted=true / schemaLoaded=true`。**非本地 stdio**（远程、command 缺失、disabled）仍 `executable=false / discovery=placeholder`。D.13J tail fix（Block A）：执行前先 `tools/list` 校验目标 tool 在 server 公布列表内，未公布直接 `MCP_TOOL_NOT_FOUND` 拒绝。
  - `skill:<id>`：discover trusted manifest，`executable=false`，无安全执行适配器。
  - `plugin:<id>`：同上。
- D.13I 自研 dispatcher：`SearchExtraTools` 必须先调用，匹配上的工具名写入 `context.discoveredDeferredToolNames: Set<string>`；`ExecuteExtraTool` 顺序检查——先 Set gating，再白名单存在性，再 executable，再 requiredArgs，再适配器。
- continuation：`PendingModelContinuation` 跨轮持有 messages、provider、model、endpointProfile、reasoningLevel、reasoningSent、reportWriteGuard；tool_result 入栈后调用 `continueModelAfterToolResults`。
- D.13J tail fix（Block B）：mutating MCP / mutating codebase-memory 默认拒绝，**不再输出虚构的 `/mcp permission` / `/codebase-memory permission`**，转而提示真实的 `/index refresh` / `/index init fast --force` 或在 `.linghun/settings.json` / server 自身关闭 mutating 工具。

判断：discovery → execution 边界是 clean 的；`codebase-memory` 是当前默认就 executable 的工具组；本地 stdio MCP server（用户自己 spawn 的）现在也走真协议（initialize / tools/list / tools/call），不再是 D.13H 之前的"全部 placeholder"假象。skill / plugin 仍然是 discover-only，这是有意的安全边界。

### 1.5 TUI / Composer / Owner-Priority

事实：
- `shell/models/input-owner-controller.ts:129` 定义 `OWNER_PRIORITY = ["permission", "paste", "slash", "composer"]`。
- Composer.tsx 的 useInput 回调被压成 4 段 if 链；paste 聚合通过 `pastePending` + 阈值长度判定。
- Shift+Tab 切换 permissionMode 走 quiet 路径，避免 `[Linghun] 会话…` 污染 Task transcript（tui/src/index.ts:2628-2660）。
- doctor 暴露 7 条核心健康线：model / index / MCP / hooks / plugins / skills / workflows（每条都有自己的子命令）。

判断：D.13D 的 Composer / Owner-Priority 已经稳定，输入区状态切换的隐式优先级被显式化，回归风险低。

### 1.6 Doctor 诊断

事实：
- `/doctor` 主屏聚合 7 类状态；分项有 `/model doctor / /model route doctor / /index doctor / /skills doctor / /plugins doctor / /mcp doctor / /cache doctor`、`/break-cache status`。
- `formatModelRouteDoctor` 已经把 `deferredToolsSummary` 注入（tui/src/index.ts:4257、4401）——doctor 能看到 deferred 工具的 4 类计数与 executable 数。
- D.13J Block 1：`provider.env merge` 行已落到 `/model route doctor` 顶部，显式给出 `applied=yes/no`、`overrodeModelRoutes`、`overrodeDefaultModel`、`providerIds` 列表，告知用户"`~/.linghun/provider.env` 是否覆盖了项目 settings"——之前需要手动 `cat` 文件确认，现在 doctor 直接说。
- D.13J Block 2：`discoveredDeferredTools` 行已落到 doctor——session 内通过 `SearchExtraTools` 记录过的工具名（截断展示 + `+N more`）；空集合时输出"本 session 还没运行过 SearchExtraTools；ExecuteExtraTool 现在会全部拒绝"，直接定位 D.13I gating 拒绝的原因。
- D.13J Block D（doctor-only）：`/model route doctor` 把 `deepseek-v4-flash / deepseek-v4-pro / openai-compatible-model` 这类占位模型升级为 blocking——primary 占位且 fallback 也是占位/不可用 → role 显示 BLOCK；primary 占位但 fallback 是现役模型 → role 显示 WARN；并在 `WARN placeholder model: providers=[…] routes=[…]` 一行集中列出全部命中。`runRoleModelRoute` 执行决策路径不受影响（占位检查只在 doctor 层，不会顶替已有 fallback 行为）。
- `/break-cache` 子命令完整：`status / once / always / off / --clear`；marker 与有界 event jsonl 在 TUI 层完成。

判断：doctor 现在可以解释 model / route / cache / deferred 工具 / 已发现 deferred 工具 / provider.env 覆盖 / 占位模型——D.13J 之前需要用户手动 `cat ~/.linghun/provider.env` 与"心算占位模型是否会 404"，**现在 doctor 直接给答案**，是 D.13J 的核心可观察性收口。

### 1.7 Background tasks / Agents / Workflows

事实：
- `/agents` 已有 spawn / show / cancel，并发上限 3（tui/src/index.ts:7133）。
- `BackgroundTaskState` + `BACKGROUND_KIND_CAPS` + `hydrateDurableJobBackgroundTasks`：durable job supervisor 已落地。
- `/workflows` 是模板 discovery：bug-fix / design-to-code / doc-to-code / refactor-plan / release-note / review。**autoRun=no**——只显示 Start Gate，不直接执行（tui/src/index.ts:3274）。
- `/skills` 与 `/plugins` 是 lifecycle 管理（add/install/validate/enable/disable/remove/update/doctor），不直接执行 skill 内容。

判断：agent / workflow / skill / plugin 在 D.13 都是"discover + lifecycle"层级，**没有任何"模型可以一键执行 skill 步骤或 workflow"的路径**，README 必须明说。

### 1.8 Permission / Risk gate

事实：
- `permissionMode` 在 TuiContext 顶层，Shift+Tab 切换；natural-command-bridge 不能开启 full-access，必须本地交互（tui/src/index.ts:15791）。
- index force/rebuild 不接受自然语言入口（tui/src/index.ts:12842）。
- Connect Lite guard：mcp/skill/plugin 未启用或未信任直接拒绝执行（tui/src/index.ts:3836-3842）。
- `validateCodebaseMemoryToolExecution` 在 ExecuteExtraTool 路径与 runCodebaseMemoryCli 路径都先跑一次 required-args 校验（双层防御）。

判断：权限边界正确但严格——这意味着实测中"模型自动跑 skill / 自动 force index"是不可能成功的；这是设计而不是 bug。

---

## 二、CCB 对比差异（不凭记忆）

| 维度 | CCB | Linghun | 影响实测？ |
|---|---|---|---|
| Provider 列表 | openai / grok / gemini，3 个独立 modelMapping，无 anthropic 子目录 | deepseek + openai-compatible + anthropic_messages，单文件 2363 行 | 否；Linghun 反而是 anthropic-first |
| MCP 客户端 | 独立 `mcp-client` 包 | TUI 内嵌 + codebase-memory 白名单 + 本地 stdio MCP runtime adapter（initialize/tools/list/tools/call） | **部分对齐**：本地 stdio server 现在能真协议执行；远程/HTTP MCP 仍在 phase 17b |
| Builtin tools | 60+（AgentTool / ConfigTool / DiscoverSkillsTool / EnterWorktreeTool / Monitor / PowerShell / REPL / Schedule / SyntheticOutput…） | 9 个核心（Read/Write/Edit/MultiEdit/Grep/Glob/Bash/Todo/Diff） | **是**：Linghun 没有 ScheduleCron / Monitor / EnterWorktree / SendUserFile 这些常用工具 |
| Ink 渲染层 | 独立 fork（Ansi / bidi / hit-test / line-width-cache / focus / reconciler / stringWidth / supports-hyperlinks…） | 复用上游 ink + 薄 wrapper（plain-renderer + ink-renderer + view-model） | 否；功能足够，但宽字符 / 超链接 / 双向文本场景可能弱 |
| Cache 高级特性 | shared/openaiConvertMessages / openaiConvertTools 显式 strip cache_control & defer_loading | 默认就不写 cache_control 在 OpenAI 路径 | 否 |
| Native bindings | audio-capture / color-diff / image-processor / modifiers / url-handler 5 个 NAPI | 无 | 否（D.13 范围内不用）|
| Computer use | computer-use-mcp / computer-use-input / computer-use-swift / claude-for-chrome-mcp | 无 | 否（不是 D.13 目标）|
| Remote control | acp-link + remote-control-server | TUI 层 `/remote doctor` 是 placeholder | **是**：远程联动是 ?，README 不要写"已支持" |
| OAuth / login | model-provider/types/errors.ts 含 OAuth token revoked 路径 | 无 OAuth；只有 API key | 否（API key 流够用）|
| Workflow 自动跑 | agent-tools registry 有运行时 | discover-only，autoRun=no | **是**：实测时"workflow 跑了"是错觉 |

CCB 单独有但 D.13 实测不该补的：computer-use / weixin / native bindings / 独立 mcp-client；这些属于阶段 17+ 范畴，提前补会破坏 clean rewrite 边界。

---

## 三、实测前阻断项（必须修才能实测）

> 以下按"必须 / 强烈建议 / 可推迟"分级。

### A. 必须修
当前没有发现真正的"实测阻断"——D.13F/G/H/I 测试链全 PASS、tsc clean、git diff --check clean。**实测可以直接开跑**。

### B. 强烈建议（实测前 30 分钟内能搞定，不修风险高）
1. **占位模型替换**：DeepSeek 官方目前还没有 v4 系列；如果不替换，第一次 `/model route doctor` 会直接看到 `- planner/executor/...: BLOCK` 与 `WARN placeholder model: …`（D.13J Block D 已经把这个升级为 doctor blocking）。实测前用 `LINGHUN_DEEPSEEK_MODEL=deepseek-chat`（或 `deepseek-reasoner`）覆盖。**不再需要"手动 cat / rename provider.env"才能发现这个问题**——doctor 的 `provider.env merge` 行（D.13J Block 1）会直接展示是否被覆盖、覆盖了哪些字段。
2. **本地 stdio MCP server 探测**：如果 `.linghun/settings.json` 里配了非 codebase-memory 的本地 stdio MCP server（command 非空），D.13J Block 4 会在 `/mcp doctor` 真跑一次 `tools/list`（5s 超时），失败会以 placeholder + 错误摘要落到 doctor 输出；实测前可以先 `/mcp doctor` 看一遍是否有 server 启动失败。

### C. 可推迟（实测过程中暴露再说）
- TUI Composer 在大 chunk paste（>阈值）下的渲染抖动——D.13D 已收口，回归概率低。
- 远程/HTTP MCP（非本地 stdio）仍是 placeholder——phase 17b 范畴。

---

## 四、非阻断但 README 必须写明的限制

1. **deferred 工具执行边界**：`codebase-memory` 默认 10 个白名单工具 executable；本地 stdio MCP server（command 非空、未 disabled）的工具在 `tools/list` 公布范围内时 executable（D.13J Block 4 + Block A）；远程 MCP / HTTP MCP / skill / plugin 仍 `executable=false`。README 不能写"支持调用任意 MCP / 任意 skill"。
2. **anthropic-beta header 是出口、cache_edits 是硬禁**。即使开 `contextEditingEnabled=true + anthropicBetaHeaders=[...]`，body 也永远不会出现 cache_edits 字段——这是有意的，README 要说"context editing 在 D.13 是只发 header、不发 body 字段的探针，不要期待真正生效"。
3. **default model 名 `deepseek-v4-flash` / `deepseek-v4-pro` / `openai-compatible-model` 是占位**，必须用环境变量替换为现役模型名；`/model route doctor` 现在会把占位模型升级为 BLOCK / WARN（D.13J Block D），不会沉默。
4. **prompt cache 5m 默认不写 ttl 字面量、1h 才写**——这是 Anthropic 计费分类，README 必须区分。
5. **break-cache `always` ≠ 每请求破缓存**，是固定 nonce 切到新 namespace 后在该 namespace 内继续命中。这一句必须直接抄 tui/src/index.ts:7853 的现成解释。
6. **OpenAI 路径硬隔离**：OpenAI compat / responses 不会发 cache_control / prompt_cache_key / prompt_cache_retention，与 Anthropic 路径完全隔离。
7. **workflow / skill / plugin 是 discover-only**，autoRun=no；模型不会自动跑 workflow 步骤。
8. **`~/.linghun/provider.env` 优先级最高**，会覆盖项目 settings.json 的 modelRoutes；`/model route doctor` 顶部的 `provider.env merge` 行（D.13J Block 1）会显式给出 applied / overrodeModelRoutes / overrodeDefaultModel / providerIds，**不再需要用户手动 `cat` 文件确认**。
9. **agents 并发上限 3**；durable job supervisor 已上线。
10. **远程控制（remote control）目前是 placeholder**，不要写"支持"。
11. **base URL 自动剥离 `/v1/messages / /chat/completions / /responses` 后缀并 dedupe `/v1`**——用户写 `https://relay.example.com/v1/messages` 也不会出现 `/v1/messages/v1/messages`。
12. **Anthropic 鉴权双发**：x-api-key + anthropic-version 与 Authorization Bearer 同时下发，便于 OpenAI 风格中转网关复用。
13. **MCP / codebase-memory 写权限**：D.13J Block B 后，mutating MCP 工具与 mutating codebase-memory 工具默认拒绝，**没有 `/mcp permission` 或 `/codebase-memory permission` slash 入口**——授权写入需要走真实命令 `/index refresh` / `/index init fast --force`，或在 server 自身 / `.linghun/settings.json` 中关闭对应 mutating 工具。

---

## 五、建议实测顺序

按风险递增、覆盖度递增：

1. `linghun --version / --help / --doctor`：先确认 CLI 入口、不调外网。
2. **裸 deepseek chat_completions**：纯文本对话，验证 baseline。
3. **deepseek + tool_use**（chat_completions tools）：触发 Read/Edit/Bash 内置工具。
4. **/model doctor / /model route doctor**：观察 deferredToolsSummary 是否正确反映 codebase-memory 10 项 executable + MCP/skill/plugin 数。
5. **/break-cache once → 单请求 → /break-cache status**：验证 marker 文件 + event log + 自动消费 once。
6. **anthropic_messages 路径**（带 tools）：tool_use → tool_result → text 至少 3 轮；重点看 stop_reason 与 input_json_delta partial_json 边界。
7. **anthropic prompt cache 1h + break-cache always**：观察 cache_control.ttl 是否落到 wire；cache namespace 切换是否生效。
8. **SearchExtraTools → ExecuteExtraTool(list_projects)**：D.13I gating 端到端验证，确认 Set-based discovery 真生效。
9. **SearchExtraTools → ExecuteExtraTool(get_code_snippet)**：required-args 校验路径。
10. **/agents 启动 + /agents cancel**：3 个并发上限 + 中断。
11. **/workflows / /skills / /plugins**：只看 discover + doctor，**不要期待执行**。
12. **OpenAI compat（responses）路径**：如果时间允许，验证硬隔离没把 cache_control 漏出去。

每一步都先看 doctor，再发请求，再回看 doctor，避免事后无法追查状态。

---

## 六、不建议在实测前继续补的项

1. **通用 MCP 执行适配器**——这是 phase 17b 的范围，实测前补就违反 clean rewrite 边界。
2. **Computer Use / weixin / native bindings**——CCB 有但 Linghun 阶段蓝图明确不在 D.13。
3. **Workflow 自动执行 / Skill 自动执行**——是有意保留的安全边界，模型不能绕过 Start Gate 跑步骤。
4. **OAuth login**——CCB 有，Linghun 用 API key 已经够；OAuth 在 phase 17 之后。
5. **Ink 独立 fork（Ansi / bidi / hit-test 等）**——上游 ink 当前覆盖足够，独立 fork 只解决双向文本 / 超链接 / 宽字符 corner，与 D.13 实测目标无关。
6. **D13D Composer 二次重构**——刚收口，再动会破坏稳定点。
7. **Anthropic Context Editing 真启**——CCB 上游 `CACHE_EDITING_BETA_HEADER` 还是空串，Anthropic 官方还没固化协议；Linghun 现在的"只发 header、不发 body 字段"是正确姿态。
8. **`discoveredDeferredToolNames` 持久化到磁盘**——session-scoped 是 D.13I gating 的语义；持久化反而会把"未发现就执行"重新放进来。

---

## 七、Linghun 还能加强 / 不足的点

加强（不在实测阻断范围，但 D.13 之后可以做）：
- doctor 摘要里加一段 `discoveredDeferredToolNames` 计数，方便排查 ExecuteExtraTool 拒绝。
- `tui/src/index.ts` 单文件 15846 行；phase-17 modularization 已规划 batch 1/2/3，建议合并。
- `provider.env` 与 project settings 的优先级表写一份在 doctor 里直接展示。
- `validateCodebaseMemoryToolExecution` 错误信息可以加上"在哪一步拒绝"（required-args / unknown tool / not in whitelist），目前只说被拒。
- ScheduleCron / Monitor / EnterWorktree 这三个能用得上，但实测前不要补。

不足（事实层面）：
- 无 OAuth / Bearer 长期凭据。
- 无 Native bindings（截屏、剪贴板、URL handler）；Windows 下某些场景退化为 plain-renderer。
- 没有独立 mcp-client，所以"接 N 个 MCP server"现阶段不可能。
- skill / plugin 的"执行"完全空缺，目前只是 discovery + manifest 验证。
- workflow autoRun=no，离 CCB 风格的"workflow 一键跑完整 pipeline"还差一段。
- TUI 单文件 15k 行带来排查、修改、code review 成本——不阻断实测，但阻断后续节奏。

---

## 八、Linghun vs 下一代编程工具差多远

下一代编程工具（CCB / Cursor / Windsurf 类）当前的核心能力栈：

| 维度 | 下一代 | Linghun D.13 | 距离 |
|---|---|---|---|
| 多 provider + tool_use | ✓ | ✓（chat / responses / anthropic_messages 全有）| 已对齐 |
| Prompt cache 5m/1h + break-cache | ✓ | ✓（5m default、1h 显式、once/always/off/--clear）| 已对齐 |
| Context editing | ✓ | header-only 探针 | 半步差距，但 CCB 上游本身也半步 |
| Continuation / tool_result 回灌 | ✓ | ✓（pendingToolUses + 合成 is_error 兜底）| 已对齐 |
| MCP discover | ✓ | ✓ | 已对齐 |
| MCP execute（通用 adapter） | ✓ | ✗（仅 codebase-memory 白名单）| **1 个阶段差距**（phase 17b）|
| Skill execute | ✓ | ✗（discover only）| **1 个阶段差距**（phase 14 + 后续 evolution）|
| Workflow autoRun | ✓ | ✗ | **1 个阶段差距** |
| Subagent 并发 | ✓ | ✓（agents 上限 3 + durable job supervisor）| 已对齐 |
| Doctor / Risk gate | ✓ | ✓（7 类 doctor + Connect Lite guard + permission mode）| 已对齐 |
| Owner-priority Composer | ✓ | ✓（permission > paste > slash > composer）| 已对齐 |
| Computer use / Browser MCP | ✓ | ✗ | **2-3 个阶段差距**（不是 D.13 目标）|
| Native bindings（截屏/剪贴板/超链接） | ✓ | ✗ | 与 D.13 目标无关 |
| OAuth / 远程控制 / 微信 | ✓ | ✗ | 与 D.13 目标无关 |

总评：
- **入门深度**：协议层、tool 链路、prompt cache、doctor、permission、Composer、agent 并发，**这 7 项已经入门到能稳定跑实测**——这是 D.13 的核心成果。
- **距离下一代的硬差距**：通用 MCP 执行、skill 执行、workflow 自动跑、computer use。前三项在 phase 14/17 路线图里；computer use 不在 Linghun 当前蓝图范围。
- **clean rewrite 优势**：Linghun 没复制 CCB 任何可疑源码，cache_edits 硬禁、deferred tool gating、env override 优先级、anthropic-beta 三重门——这些都是 Linghun 自己定义的边界，不是抄 CCB 抄出来的，反而比 CCB 在某些点更严。
- **D.13 的位置**：从"对话 + 工具 + cache + agent + doctor"维度，已经达到下一代工具的可用门槛；从"通用扩展执行（MCP/skill/workflow autoRun）"维度，仍然在门口。**实测可信度足够**，但 README 不能宣称"对齐 CCB 全部能力"。

---

## 九、关键结论一句话

D.13 + D.13J tail fix 后已经具备实测条件，**唯一一个实测前手动动作**是用 `LINGHUN_DEEPSEEK_MODEL` 把占位的 `deepseek-v4-flash` 替换成现役模型名（如 `deepseek-chat / deepseek-reasoner`）；`/model route doctor` 会直接告诉你是否还有占位、`provider.env merge` 是否覆盖了 modelRoutes、`discoveredDeferredTools` 是否记录过——不再需要手动 `cat ~/.linghun/provider.env` 或心算占位 404。

剩下的所有"差距"都是 phase 14 / 17 / 17b 范围或 computer-use 类非 D.13 范围，实测前补反而破坏稳定点。

---

## 十、D.13J tail fix 落地清单（本次同步增补）

| Block | 位置 | 收口动作 | 测试 |
|---|---|---|---|
| A | tui/src/index.ts `runMcpStdioToolCall` / `runMcpStdioToolList` / `extractMcpToolNames` / `runMcpDoctor` | 本地 stdio MCP 调用插入 `tools/list` 校验；`MCP_TOOL_NOT_FOUND` 拒绝路径；doctor discovery 改用真实 `tools/list` | `executeExtraTool: rejects when tools/list does not contain target tool` + readonly mcp 帧序断言 |
| B | tui/src/index.ts mutating codebase-memory / mutating MCP 拒绝文案 | 删除虚构的 `/mcp permission` / `/codebase-memory permission` 命令，改为真实命令 `/index refresh` / `/index init fast --force` 提示或 server / `.linghun/settings.json` 处置 | 既有 mutating 测试 + 文案断言（`not.toContain('/mcp permission')` + `toContain('/index refresh')`） |
| C | PRE_SMOKE_AUDIT_D13.md（本文件） | 全文同步 D.13J 后事实：MCP 不再"全部 executable=false"；discoveredDeferredTools 入 doctor；provider.env merge 入 doctor；占位模型 doctor 升级 BLOCK；删除"必须手动 cat/rename"旧结论 | 文档审查 |
| D | tui/src/model-doctor-runtime.ts `diagnoseRoute` / `getRouteDoctorLevel` | doctor-only placeholder 升级为 blocking——primary 占位且 fallback 不可用 → BLOCK；primary 占位且 fallback 现役 → WARN；`runRoleModelRoute` 执行决策路径**不**受影响（占位 check 不下沉到 `diagnoseConcreteRoute`） | `getRouteDoctorLevel D.13J tail fix Block D: placeholder primary with placeholder/valid fallback → BLOCK/WARN` + `getRouteBlockingProblems D.13J tail fix Block D: treats placeholder model as blocking` |

回归对账（基线 master a41aff2 vs D.13J tail fix 工作树）：

| 测试集 | baseline | D.13J |
|---|---|---|
| `@linghun/config src/index.test.ts` | 35/35 PASS | 35/35 PASS |
| `@linghun/providers` | 90/90 PASS | 90/90 PASS |
| `@linghun/tui src/cache-freshness.test.ts + src/model-doctor-runtime.test.ts` | 95/95 PASS | 95/95 PASS |
| `@linghun/tui src/index.test.ts -t "D.13I"` | n/a | 13/13 PASS（240 skipped） |
| `@linghun/tui src/index.test.ts -t "D.13J"` | n/a | 20/20 PASS（233 skipped） |
| `@linghun/tui src/index.test.ts` 全量 | 36 fails / 197 pass | 36 fails / 197 pass（**新增回归=0**，36 条同名 pre-existing failure 与 D.13J 无关） |
| `tsc --noEmit` (tui / providers) | clean | clean |
| `git diff --check` | clean | clean |

