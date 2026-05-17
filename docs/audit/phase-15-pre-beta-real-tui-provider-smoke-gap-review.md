# Phase 15 Pre-Beta Final Real TUI / Provider Smoke Gap Review

> 审计类型：只读审计（未修改任何代码）
> 审计日期：2026-05-17
> 触发原因：Solution Completeness Gate 触发后的系统性复审——真实 TUI smoke 暴露 5 类交互/能力问题，必须先判断系统性缺口、列影响面、P0/P1/P2 分类，再决定是否进入 Phase 15 Beta。
> 审计范围：Natural Command Bridge、Command Capability Catalog / risk copy、Tool output layer、Provider tool_use compatibility、Doctor/help aliases、Real provider smoke、CCB 成熟行为对照
> 审计方法：直接阅读 10 份必读文档、4 份关键源码、codebase-memory 索引（867 nodes / 1652 edges）、前序 4 份审计报告交叉对比、CCB 只读行为边界对照
> 参考边界：CCB / CCB Dev Boost 公开行为边界；未复制任何第三方源码或内部实现。

---

## Executive Summary

### Verdict: BLOCKED — 3 项 P0、2 项阻塞 P1 必须在 Phase 15 Beta 前修复

本轮审计发现当前代码中存在 **3 项 P0** 和 **2 项阻塞 P1**，均影响 Phase 15 Beta 的真实项目测试基线。这些不是"发现一个补一个"的单点 bug，而是跨 Natural Command Bridge、Provider adapter、Output layer、Doctor/help routing 和 Index capability 的系统性缺口。

**核心结论**：当前代码不可直接进入 Phase 15 真实项目 Beta。必须先修复 P0 和阻塞 P1 并经过 independent verification gate 后，再由用户明确确认是否进入。

---

## 1. 触发原因

真实 TUI smoke 暴露以下 5 类问题，触发 Solution Completeness Gate 系统性复审：

| # | 问题 | 类型 |
|---|------|------|
| 1 | "帮我更新项目索引" 误映射为 `/index status` | NCB 关键词覆盖缺口 |
| 2 | `/index status` 出现 Start Gate / 风险文案错位 | Catalog risk 标记与路由不一致 |
| 3 | Todo 工具结果刷屏，污染主输出 | 无输出分层机制 |
| 4 | DeepSeek tool_use / tool_result 后 HTTP 400 | Provider 请求整形与 capability 检查缺失 |
| 5 | `/model doctor` 没进入真实 doctor | Doctor alias 未实现 |

---

## 2. 证据来源

| 证据 | 路径 |
|------|------|
| 必读文档 (10 份) | README.md, START_NEXT_CHAT.md, 架构路线图, 蓝图, 规格书, 交付 README, Phase 15 交付文档, Deep Parity Closure 交付文档, reference-map, Deep Parity Closure Report |
| 核心源码 (4 份) | `packages/tui/src/index.ts` (7136+ 行), `packages/tui/src/natural-command-bridge.ts` (1487 行), `packages/providers/src/index.ts` (561 行), `packages/tools/src/index.ts` (620 行) |
| 测试文件 (2 份) | `packages/tui/src/index.test.ts`, `packages/tui/src/natural-command-bridge.test.ts` |
| 前序审计报告 (4 份) | Phase 15 preflight interaction review, cross-review, CCB full parity audit, CCB deep parity closure report |
| codebase-memory 索引 | 867 nodes / 1652 edges, status: ready |
| CCB 公开行为 | `F:\ccb-source\src\commands.ts`, `Tool.ts`, `PermissionPrompt.tsx`, `BuiltinStatusLine.tsx` (只读对照) |

---

## 3. 审计发现详解

### 3.1 NCB-INDEX-1：Index 命令关键词覆盖缺口（P0）

**问题**："帮我更新项目索引" 误映射为 `/index status`。

**代码证据**：

`natural-command-bridge.ts` L1460-1468 (`createNaturalEquivalentCommand`)：
```typescript
if (capability.id === "index") {
    if (/好了没|已经.*是吧|已经.*了吗|ready|status|状态/u.test(normalized)) {
      return "/index status";
    }
    if (/build|建立|init/u.test(normalized)) return "/index init fast";
    if (/refresh|刷新/u.test(normalized)) return "/index refresh";
    if (/architecture|架构/u.test(normalized)) return "/index architecture";
    if (/search|搜索|查找|todo/u.test(normalized)) return "/index search <query>";
    return "/index status";  // <-- DEFAULT: 所有未匹配的 fallback
}
```

"更新" 不匹配任何已知关键词 → 默认 fallback 到 `/index status`。

**根因**：
- `createNaturalEquivalentCommand` 最后一行 `return "/index status"` 是兜底默认值，但这不是安全选择。
- 当用户意图明确是动作（"帮我更新"、"帮我刷新"、"帮我重建"）但关键词不在匹配列表中时，不应该默认回到状态查询，而应该进入 `ask_clarify`（澄清）或至少映射到 `/index refresh`。
- 中文语义变体 "更新"、"重建"、"重新索引"、"重做索引"、"同步索引" 等均未被覆盖。

**影响面**：
- 用户说 "帮我更新项目索引" 意图是刷新，系统却返回索引状态。
- 这属于 NCB scoring 关键词补丁化的典型系统性缺口：新增中文语义变体需要手工加关键词。
- 与前序 Interaction Maturity Fix 暴露的 "索引已经建立了是吧" 问题同根——都是依赖关键词匹配而不是语义理解。上次修复了 "已经建立" 匹配到 `status` 的问题，但没覆盖 "更新" 等其他动作词。

**CCB 对照**：CCB 不做本地 NL→命令映射，模型直接理解用户意图并建议命令。Linghun 选择了本地 router 更安全的路线，但关键词覆盖不足导致安全默认值（返回 status）反而不安全。

**分类**：**P0** — 影响 NCB 的核心可靠性。这是一个系统性缺口（关键词覆盖不足），不是单点 bug。

---

### 3.2 NCB-INDEX-2：Catalog risk 标记与路由不一致（阻塞 P1）

**问题**：`/index status` 出现 Start Gate / 风险文案错位。

**代码证据**：

`natural-command-bridge.ts` L533-543 (index capability 定义)：
```typescript
cap(
    "index", "/index",
    ["index", "索引", "codebase", "architecture", "search code", "build index"],
    "代码索引", "Index",
    "查看、建立、刷新或查询 codebase-memory 索引。",
    "Shows, builds, refreshes, or queries the codebase-memory index.",
    "询问索引状态、建立索引、搜索代码、架构摘要。",
    "Use for index status, build, refresh, code search, or architecture summary.",
    "start_gate",  // <-- ALL index actions marked as start_gate
),
```

Index 的 `risk` 统一为 `"start_gate"`，但实际路由行为：
- `routeNaturalIntent` L827-837：如果 `inquiry === "status"` 且 capability 在 first-batch → `execute_readonly`
- `handleIndexCommand` L3654-3656：`/index status` 直接执行只读查询，无 Gate

**根因**：
- Catalog 中 index 的 `risk` 字段是 all-or-nothing：整个 capability 被标记为 `start_gate`，无法表达 "status 子命令是 readonly，init/refresh 是 start_gate"。
- `Natural Intent Contract` 在 phase 区分了 `status_query` vs `safe_action_request`，但 `/index` slash command 的 help 文案和 risk 展示不会自动区分子命令。
- 当用户通过 `/help` 或自然语言问 "/index 是干什么的" 时，显示的 risk 是统一的 `start_gate`，这与实际行为（status 可以直接执行）不一致。

**CCB 对照**：CCB 的命令 help 系统会列出子命令的不同行为和风险。Linghun 的 Catalog 是单一 risk 字段，无子命令级粒度。

**影响面**：
- 用户在 help 中看到 `/index` 标记为 "需要 Start Gate"，但 `/index status` 实际上不需要。
- 文案不一致会造成用户困惑，降低对 Start Gate 系统的信任。
- 属于 Catalog 粒度的设计缺口。

**分类**：**阻塞 P1** — 不修复会污染 Beta 测试的 help/risk 展示基线。

---

### 3.3 OUT-1：Tool 结果无输出分层，污染主输出（P0）

**问题**：Todo、Read、Grep、Glob、Bash 等 tool_result 全部直接写入主输出，无 primary/details/debug 分层或折叠机制。

**代码证据**：

`index.ts` L7091-7104 (`formatToolOutput`)：
```typescript
function formatToolOutput(name: ToolName, output: ToolOutput, language: Language): string {
  const lines = [
    language === "en-US" ? `Tool ${name} result:` : `工具 ${name} 结果：`,
    output.text,
  ];
  if (output.truncated && output.fullOutputPath) {
    lines.push(...);
  }
  return lines.join("\n");
}
```

此函数：
- 不截断长输出（仅 Bash 在 `bashTool` 中有 `BASH_PREVIEW_LIMIT=4000` 但 Grep 可到 100 行、Todo 全部展开）
- 不区分 primary/details/debug 输出层级
- 不提供折叠/展开标记或后续路由
- 模型 tool_use 结果（L5693 `writeLine(output, formatToolOutput(...))`）和 slash 工具结果（L6342）都走同一路径

**具体场景**：
- Todo list：当有 10+ 任务时，全部展开刷屏主输出
- Grep 100 条匹配结果：全部打印在主输出
- Read 大文件（200 行限制）：全量输出

**CCB 对照**：CCB 的 Todo 结果以紧凑格式显示（行内状态 + 截断），Grep 结果可滚动但不直接塞满对话；Bash stdout 流式输出且可折叠。

**影响面**：
- 模型 tool_use 回灌的结果太长会消费大量上下文 token
- 用户主屏被工具结果淹没，丢失对话流
- 与蓝图 L87 的 Phase 15.5 要求（"primary/details/debug 输出层级必须在 Phase 15.5 收口"）形成矛盾：这是 Beta 体验质量门，不应完全推迟。

**分类**：**P0** — Todo 刷屏在真实项目中每次工具调用都会发生；这是阻塞 Beta 的用户体验缺陷。蓝图将完整输出分层放在 Phase 15.5，但最小折叠/截断应在 Beta 前到位。

---

### 3.4 PROV-1：Provider tool_use / tool_result HTTP 400 风险（P0）

**问题**：DeepSeek / OpenAI-compatible tool_use/tool_result 消息格式可能导致 HTTP 400。

**代码证据**：

`providers/index.ts` L249-283 (`stream`)：
```typescript
async *stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<LinghunEvent> {
    this.assertReady();
    const body = this.createChatRequest(request);
    const response = await fetch(`${this.normalizedBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    // ... 401/403 处理，通用 HTTP 错误 ...
}
```

`index.ts` L5456-5464 (`sendMessage`)：
```typescript
for await (const event of gateway.stream(
    "deepseek",  // <-- HARDCODED provider ID
    {
      messages,
      model: context.model,
      tools: createModelToolDefinitions(),  // <-- ALWAYS sends tools
      toolChoice: "auto",                   // <-- ALWAYS sets tool_choice
    },
    controller.signal,
))
```

**具体风险**：

1. **不检查 `supportsTools`**：`createModelToolDefinitions()` 总是返回 9 个工具 schema，`toolChoice` 总是 `"auto"`。如果当前 model 的 `supportsTools` 为 false（例如某些 DeepSeek 模型配置、第三方中转站），发送 `tools` 参数可能导致 HTTP 400。
   - 代码中存在 `ModelInfo.supportsTools` 字段（providers L129），但 `sendMessage()` 从不检查。
   
2. **tool role 消息格式**：`toOpenAiMessage()` (L310-333) 将 `assistant` 消息的 toolCalls 转为 OpenAI 格式。但 DeepSeek API 对 `tool_calls` 在 `assistant` 消息中的格式可能有差异。如果 DeepSeek 期望的 `tool_calls` 格式与标准 OpenAI 不同（如索引方式、additional fields），会导致后续请求 400。

3. **tool_use delta 解析**：`parseOpenAiStream()` (L335-366) 的分片聚合逻辑假设 DeepSeek 的流式 `tool_calls` delta 格式与 OpenAI 一致。如果 DeepSeek 以不同的方式分片（例如一次发送完整 tool_call 而不分片，或使用不同的 JSON 路径），`parseOpenAiStreamLine()` 可能：
   - 无法正确聚合分片
   - `isCompleteJsonObject()` 返回 false → 不发出 `tool_use` 事件
   - 下一轮请求中 tool_call_id 不匹配 → HTTP 400

4. **无 capability doctor 阻断**：如果 provider 确实不支持 tool calling，没有 doctor 检查在发送请求前 BLOCK。用户只会看到 HTTP 400 错误，无法自行诊断。

**CCB 对照**：CCB 在发送 tools 前已验证 model 能力，如果模型不支持 tool_use，会降级为纯文本对话而不崩溃。CCB 也使用 Anthropic 原生 API（非 OpenAI-compatible），tool_use 协议是 API 原生支持的。

**影响面**：
- 使用 DeepSeek V4 Pro 真实 API 时，首次 tool_use → tool_result → 第二轮请求可能因消息格式不兼容而 HTTP 400。
- 第三方中转站（如 New API、one-api）可能完全不支持 tool calling，发送 tools 直接 400。
- P0 hardening 已验证了本地测试，但真实 API 未测试。Phase 15 Beta 将首次暴露这些问题，届时用户的主要编码链路不可用。

**分类**：**P0** — 这是阻塞 Phase 15 Beta 的核心功能缺陷。tool_use/tool_result 是 Phase 00-14 编码主链路的底座，真实 provider 不可用意味着核心编码体验无法验证。

---

### 3.5 DOC-1：`/model doctor` alias 未实现（阻塞 P1）

**问题**：`/model doctor` 没有进入真实 doctor。

**代码证据**：

`index.ts` L1745-1760 (`handleModelCommand`)：
```typescript
async function handleModelCommand(args, context, output) {
  const action = args[0];
  if (action === "route") {
    await handleModelRouteCommand(args.slice(1), context, output);
    return;
  }
  // 缺省走这里——显示当前模型和路由摘要，不是 doctor
  writeLine(output, `当前模型：provider=${provider} model=${context.model}`);
  writeLine(output, formatModelRouteSummary(context));
  writeLine(output, "提示：如需诊断配置，可运行 /model route doctor。");
}
```

`/model doctor` → `action === "doctor"` → 不匹配 `"route"` → 落入 else 分支 → 显示模型摘要 + 提示运行 `/model route doctor`。

**期望行为**：`/model doctor` 应等价于 `/model route doctor`（或至少给出明确的路由建议）。

**分析**：
- 这是一个**设计意图与实现之间的偏差**：代码中 `handleModelCommand` 只处理 `route` 子命令，不处理 `doctor`。
- 自然语言中 "模型 doctor" 可以通过 NCB `createNaturalEquivalentCommand` (L1484-1494) 正确路由到 `/model route doctor`（如果用户说 "模型 key 配好了吗"），但直接输入 `/model doctor` 走的是 slash dispatch，不会经过 NCB。
- 修复应该是：在 `handleModelCommand` 中增加 `action === "doctor"` 的处理。

**影响面**：
- 用户从 help 文档或其他渠道学到 `/model doctor`（这是直觉性的），但实际不工作。
- 会降低 doctor 诊断的可发现性。

**分类**：**阻塞 P1** — 不阻塞核心编码链路，但会显著降低新用户的配置调试成功率。

---

### 3.6 其他发现（非阻塞）

#### DOCTOR-2：无统一 `/doctor` 入口（P2）

`/doctor hooks` 存在，`/model route doctor` 存在，`/plugins doctor` 存在，`/mcp doctor` 存在。但没有一个统一的 `/doctor` 命令给用户做全局诊断。蓝图 Phase 15.5 已登记此项。

#### PROVIDER-2：无 capability 检查阻断（P2）

在 `sendMessage()` 发送 `tools` 参数前不检查 `ModelInfo.supportsTools`，也不检查 `supportsPromptCache`。这属于 provider adapter 成熟度收口范围（Phase 15.5），但 Phase 15 Beta 中至少需要 provider tool smoke 记录哪些模型支持 tool calling。

#### SMOKE-1：无真实 provider tool_use smoke（P2 → Phase 15 Beta 启动条件）

Deep Parity Closure Report 已明确标注："未运行真实 provider 在线 tool_call 对话"。Phase 15 Beta 启动的第一个动作应该是 `linghun` 在真实 DeepSeek API 下执行 tool_use 对话。如果第一个 tool_use/tool_result 循环就 HTTP 400，需要立刻修复再继续 Beta。

---

## 4. CCB 成熟行为对照

| 对比面 | CCB 成熟行为 | Linghun 当前 | 差距 |
|--------|------------|-------------|------|
| **Tool output** | 紧凑格式、可折叠、流式、截断 | 全量直接输出到主屏 | P0 |
| **Provider tool check** | 验证 model 能力后发送 tools | 不检查 supportsTools 就发送 | P0 |
| **NCB routing** | 无本地 NCB（模型理解意图） | 关键词匹配，未覆盖 "更新" 等语义变体 | P0 |
| **Doctor/help** | 统一 `/doctor` + 子命令 | 分散的 doctor 子命令，`/model doctor` 不工作 | 阻塞 P1 |
| **Command risk copy** | 子命令级 risk 描述 | Catalog 级统一 risk 标记 | 阻塞 P1 |
| **权限审批** | PermissionPrompt 组件化 | Human-first decision prompt | ✅ 优势 |
| **工具协议** | Anthropic 原生 tool_use | OpenAI-compatible 适配 | ✅ 主体闭环 |
| **取消链路** | abort + cleanup | SIGINT + /interrupt + abortSignal | ✅ PASS |
| **Evidence 入模型** | 无显式证据系统 | EvidenceSummary 注入 model | ✅ 优势 |

---

## 5. 差距分类汇总

### P0（3 项，阻塞 Phase 15 Beta）

| # | ID | 问题 | 最小修复边界 | 验证方式 |
|---|----|------|------------|---------|
| **P0-1** | NCB-INDEX-1 | "帮我更新项目索引" 误映射为 `/index status`；中文动作词覆盖不足 | `createNaturalEquivalentCommand` 增加 "更新/重建/重新索引/同步索引" 等中文变体覆盖，并将 "index 动作无匹配时默认 fallback 为 `/index status`" 改为 "ask_clarify" 安全默认。约 10-15 行。 | Focused test: `routeNaturalIntent("帮我更新项目索引")` → `/index refresh`；`routeNaturalIntent("帮我重建索引")` → `ask_clarify` 或 `/index init fast` |
| **P0-2** | OUT-1 | Todo/Grep/Glob/Read 工具结果无截断、无折叠，污染主输出 | `formatToolOutput()` 增加最小截断（Grep/Glob 默认 15 行 + "...（共 N 条）" 折叠提示，Todo 限制 8 条展开）。不影响工具日志的完整存储。约 20-30 行。 | Focused TUI smoke: `tool_use(Grep pattern=".")` 返回 100 条结果时主输出只显示 15 行 + 折叠提示 |
| **P0-3** | PROV-1 | 不检查 `supportsTools` 就发送 tools 参数；tool_use/tool_result 消息格式可能导致 DeepSeek HTTP 400 | (a) `sendMessage()` 发送前检查 ModelInfo.supportsTools，不支持时降级为纯文本请求。(b) 补 capability doctor 在 provider 不支持 tool calling 时给出明确提示。约 15-20 行。 | (a) 配置一个 supportsTools=false 的 mock provider，确认 tools 参数不发送。(b) 用真实 DeepSeek API 运行最小 tool_use → tool_result → 第二轮对话，确认无 HTTP 400 |

### 阻塞 P1（2 项，建议 Beta 前修复）

| # | ID | 问题 | 最小修复边界 | 验证方式 |
|---|----|------|------------|---------|
| **BP1-1** | NCB-INDEX-2 | Index catalog risk 标记为 start_gate，但 `/index status` 实际只读执行，help 文案不一致 | 方案A（最小）：在 `formatCapabilityAnswer` 中区分 "只读子命令 status/search/architecture 可直接使用，init/refresh 需要确认"。方案B（更完整）：拆分 index 为 index-status（readonly）和 index-action（start_gate）两个 capability。推荐方案A，约 10 行。 | Focused test: `/help` 输出中 index 行显示 "status/search 只读；init/refresh 需确认" |
| **BP1-2** | DOC-1 | `/model doctor` alias 未实现 | `handleModelCommand` 增加 `action === "doctor"` → `/model route doctor` 的映射。约 5 行。 | Focused test: `/model doctor` 输出 model route doctor 诊断结果 |

### 非阻塞 P1（Phase 15.5，0 项新增）

本轮审计无新增非阻塞 P1。前序 Deep Parity Closure Report 的 8 项非阻塞 P1（NCB-1, CODE-1, I18N-1, STAT-1, STAT-2, OUT-1, LONG-1, HELP-1）继续登记。

### P2（Phase 15.5 或后续，3 项新增）

| # | ID | 问题 | 建议阶段 |
|---|----|------|---------|
| P2-1 | DOCTOR-2 | 无统一 `/doctor` 入口 | Phase 15.5 |
| P2-2 | PROVIDER-2 | 无 capability 检查阻断（supportsTools/supportsPromptCache 等） | Phase 15.5 |
| P2-3 | SMOKE-1 | 无真实 provider tool_use smoke 记录 | Phase 15 Beta 启动条件 |

### not-do（明确不做）

- 不给 NCB 引入完整 NLP/ML 语义理解（违背本地保守 route 设计原则）
- 不做完整 output grouping / TUI 美化（Phase 15.5 范围）
- 不拆分 index capability（除非阻塞 P1 修复选择方案B）
- 不做 registry/dispatch 大重构

---

## 6. 最小修复边界

全部 5 项修复（3 P0 + 2 阻塞 P1）的总范围控制在 **~70-90 行新增**，不涉及架构变更：

| 修复 | 文件 | 估计行数 |
|------|------|---------|
| NCB-INDEX-1 | `natural-command-bridge.ts` | 10-15 |
| OUT-1 | `index.ts` (formatToolOutput) | 20-30 |
| PROV-1 | `index.ts` (sendMessage) + `providers/index.ts` | 15-20 |
| NCB-INDEX-2 | `natural-command-bridge.ts` (formatCapabilityAnswer) | 10 |
| DOC-1 | `index.ts` (handleModelCommand) | 5 |

**不做的**：
- 不新增模块/文件/抽象层
- 不改 registry/dispatch 架构
- 不改权限管道
- 不做 provider adapter 大改（仅增加 supportsTools 检查）
- 不引入 NLP/ML

---

## 7. 验证方式

### 修复后必须执行的验证命令

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm exec linghun --help
corepack pnpm exec Linghun --help
```

### 修复后必须执行的 focused tests / TUI smoke

| 场景 | 输入 | 期望行为 |
|------|------|---------|
| NCB-INDEX-1 | "帮我更新项目索引" | 映射到 `/index refresh` |
| NCB-INDEX-1 | "帮我重建索引" | 进入 `ask_clarify` 或明确提示 |
| NCB-INDEX-1 | "索引状态怎么样" | 仍正确映射到 `/index status` |
| OUT-1 | Grep 返回 100 条 | 主输出 ≤ 15 行 + 折叠 |
| OUT-1 | Todo list 10+ | 主输出 ≤ 8 条 |
| PROV-1 | supportsTools=false provider | tools 参数不发送 |
| PROV-1 | 真实 DeepSeek API tool_use | 无 HTTP 400 |
| NCB-INDEX-2 | `/help` 中 index 行 | 显示 status 只读 / init+refresh 需确认 |
| DOC-1 | `/model doctor` | 输出 model route doctor 诊断 |

### Independent Verification Gate

修复后必须通过独立 verifier agent 复检，确认：
1. 全部 test/typecheck/build/help 通过
2. 上述 focused tests 全部通过
3. 无新增回归（已有 200+ 测试继续通过）
4. 如果条件允许，至少运行一次真实 DeepSeek API tool_use smoke（或记录无法运行的原因）

---

## 8. 是否阻塞 Phase 15 Beta

### BLOCKED

Phase 15 Beta 不可在以下条件未满足前启动：

1. ❌ P0-1 (NCB-INDEX-1) 未修复
2. ❌ P0-2 (OUT-1) 未修复
3. ❌ P0-3 (PROV-1) 未修复
4. ❌ 阻塞 P1-1 (NCB-INDEX-2) 未修复
5. ❌ 阻塞 P1-2 (DOC-1) 未修复
6. ❌ Independent verification gate 未 PASS
7. ⛔ 用户未明确确认进入 Phase 15 Beta

### 建议流程

```
本轮 P0+阻塞P1 修复 → independent verification gate PASS
  → 用户明确确认进入 Phase 15 Beta
  → Phase 15 Beta 首个动作：真实 DeepSeek API tool_use smoke
  → 如果 smoke 通过：继续 Beta 真实项目测试
  → 如果 smoke 失败（如 HTTP 400）：先诊断修复再继续 Beta
```

---

## 9. 前序报告结论更新

本轮审计确认前序 Deep Parity Closure Report 的以下结论仍然有效：
- **Deep Parity Closure Report verdict: CONDITIONAL** → 升级为 **BLOCKED**（因新发现 3 项 P0）
- 前序 2 项阻塞 P1（SC-1, BASH-1）已在 blocking P1 fix 轮关闭并 PASS → 继续有效
- 前序 8 项非阻塞 P1 继续登记到 Phase 15.5
- 前序 6 项 P2 继续 + 本轮新增 3 项 P2

---

## 10. 参考核对

### 10.1 本轮实际读取的 Linghun 文档

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\README.md`
- `F:\Linghun\START_NEXT_CHAT.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`（部分）
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`（部分）
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-15-natural-command-bridge.md`
- `F:\Linghun\docs\delivery\phase-15-pre-beta-ccb-deep-parity-closure.md`
- `F:\Linghun\docs\audit\reference-map.md`
- `F:\Linghun\docs\audit\phase-15-pre-beta-ccb-deep-parity-closure-report.md`

### 10.2 本轮实际读取的代码文件

- `F:\Linghun\packages\tui\src\natural-command-bridge.ts`（全文）
- `F:\Linghun\packages\tui\src\index.ts`（关键段落：L1380-1480, L1745-1900, L3620-3920, L5300-5530, L5637-5700, L5820-5910, L7091-7138）
- `F:\Linghun\packages\providers\src\index.ts`（全文）
- `F:\Linghun\packages\tools\src\index.ts`（全文）
- `F:\Linghun\packages\tui\src\index.test.ts`（关键段落）
- `F:\Linghun\packages\tui\src\natural-command-bridge.test.ts`（关键段落）

### 10.3 本轮实际参考的 CCB 文件

- `F:\ccb-source\src\commands.ts`：命令系统架构
- `F:\ccb-source\src\Tool.ts`：工具接口设计
- `F:\ccb-source\src\components\permissions\PermissionPrompt.tsx`：权限交互
- `F:\ccb-source\src\components\BuiltinStatusLine.tsx`：状态栏

### 10.4 参考方式

- 仅参考 CCB 公开行为边界、交互设计和验收标准。
- 未复制 CCB、CCB Dev Boost、OpenCode 或任何第三方的源码或内部实现。
- 本轮为本地只读审计，未使用联网取证。
- codebase-memory 索引用于调用链追踪（867 nodes / 1652 edges, status: ready）。

---

## 11. 成品级结构化 Handoff Packet

```yaml
phase: "Phase 15 pre-Beta Final Real TUI / Provider Smoke Gap Review"
status: "audit complete; verdict: BLOCKED"
delivery_doc: "F:\\Linghun\\docs\\audit\\phase-15-pre-beta-real-tui-provider-smoke-gap-review.md"
verdict: "BLOCKED — 3 项 P0 + 2 项阻塞 P1 必须在 Phase 15 Beta 前修复"
p0_count: 3
blocking_p1_count: 2
non_blocking_p1_count: 0
p2_count: 3
p0_details:
  - id: "NCB-INDEX-1"
    gap: "Index 命令关键词覆盖不足；'帮我更新项目索引' 误映射为 /index status"
    fix: "createNaturalEquivalentCommand 增加中文变体覆盖 + 安全默认值"
    loc: "~10-15"
  - id: "OUT-1"
    gap: "Tool 结果无输出分层；Todo/Grep/Glob/Read 全量写入主输出，污染主屏"
    fix: "formatToolOutput 增加最小截断和折叠提示"
    loc: "~20-30"
  - id: "PROV-1"
    gap: "不检查 supportsTools 就发送 tools；tool_use/tool_result 消息格式可能导致 DeepSeek HTTP 400"
    fix: "sendMessage 前检查 ModelInfo.supportsTools + 真实 API smoke"
    loc: "~15-20"
blocking_p1_details:
  - id: "NCB-INDEX-2"
    gap: "Index catalog risk 统一为 start_gate，/index status 实际只读；help 文案不一致"
    fix: "formatCapabilityAnswer 或 help 区分只读子命令和动作子命令"
    loc: "~10"
  - id: "DOC-1"
    gap: "/model doctor alias 未实现"
    fix: "handleModelCommand 增加 doctor action 映射"
    loc: "~5"
next_phase_options:
  - "修复 3 P0 + 2 阻塞 P1 → independent verification gate → Phase 15 真实项目 Beta（必须用户明确确认）"
  - "Phase 15.5 双模型交叉审查与开源前 hardening（Phase 15 完成后且必须用户明确确认）"
forbidden_without_user_confirmation:
  - "Phase 15 真实项目 Beta"
  - "Phase 15.5 双模型交叉审查"
  - "Phase 16+"
  - "修复 P0/阻塞P1（必须先由用户确认是否开始修复）"
key_evidence:
  - "packages/tui/src/natural-command-bridge.ts L1460-1468: createNaturalEquivalentCommand index routing"
  - "packages/tui/src/natural-command-bridge.ts L533-543: index catalog risk=start_gate"
  - "packages/tui/src/index.ts L7091-7104: formatToolOutput no truncation"
  - "packages/tui/src/index.ts L5456-5464: sendMessage hardcoded deepseek + always sends tools"
  - "packages/providers/src/index.ts L249-283: OpenAiCompatibleProvider.stream no capability check"
  - "packages/tui/src/index.ts L1745-1760: handleModelCommand no doctor alias"
index_status:
  project: "F-Linghun"
  status: "ready"
  nodes: 867
  edges: 1652
permission_mode: "default"
model_provider: "claude-sonnet-4-6"
budget_notes: "No dependency install; no remote execution; read-only audit."
remaining_risk:
  - "Real provider tool_use online dialogue has NOT been tested; PROV-1 fix must include at minimum a capability guard, but full provider-specific format compatibility can only be truly validated in Phase 15 Beta."
  - "NCB scoring model remains keyword-based + per-capability boosts; long-term maintenance cost of adding new Chinese variants is acknowledged but not blocking Beta."
  - "Output layering fix is minimal (truncation + fold hint); full primary/details/debug architecture is Phase 15.5 scope."
  - "Phase 15 real-project Beta, Phase 15.5 and Phase 16+ are not entered by this handoff."
```
