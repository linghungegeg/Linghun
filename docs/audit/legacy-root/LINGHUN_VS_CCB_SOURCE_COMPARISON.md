# Linghun vs ccb-source 源码级对比报告

> 对比时间：2026-05-27
> 索引：F-Linghun（2589 nodes / 5140 edges, ready）
> 方法：直接读两侧源码，不依赖任何文档/审计报告
> 范围：F:\Linghun（monorepo）vs F:\ccb-source\src（flat）

---

## 一、关键差距（源码事实）

### 1.1 推理 / 思考能力体系

| 能力维度 | ccb-source | Linghun |
|---|---|---|
| Effort 档位 | 5 档 `low/medium/high/xhigh/max`（`utils/effort.ts:19`） | 3 档 `Low/Medium/High`（`packages/tui/src/shell/view-model.ts` setupReasoningPlaceholder） |
| 模型支持判断 | `modelSupportsEffort` / `modelSupportsXhighEffort` / `modelSupportsMaxEffort` 三段 allowlist + 3P override | 无 per-model 能力门，单一布尔决策 |
| 默认值策略 | `getDefaultEffortForModel` 区分 Pro/Max/Team 订阅 + `tengu_grey_step2` 远程配置 | 无订阅感知，无远程配置 |
| 降级钳制 | `xhigh→high`、`max→high`、`max→xhigh`(ChatGPT) 自动钳制 | 无（且无 xhigh/max） |
| Adaptive Thinking | `modelSupportsAdaptiveThinking`（opus-4-7/4-6, sonnet-4-6） | 无 |
| ultrathink 关键词 | `hasUltrathinkKeyword` + `findThinkingTriggerPositions` UI 高亮 | 无关键词触发链路 |
| 默认 thinking 开关 | `shouldEnableThinkingByDefault` 默认 true | 默认按 reasoningLevel 是否设置 |

### 1.2 子系统覆盖差异

ccb-source 拥有但 Linghun 完全缺失或极薄的子系统（按 `src/` 顶层目录核对）：
- `hooks/`（PreToolUse/PostToolUse/Stop/Compact 等生命周期钩子）
- `jobs/`（后台 job runner / scheduling）
- `skills/`（skill 包加载、市场风格的扩展机制）
- `remote/` + `ssh/`（远程会话与桥接）
- `buddy/`（pair-programmer 模式）
- `daemon/`（后台守护与 IPC）
- `screens/`（多屏切换）
- `bridge/`、`bootstrap/`、`assistant/`、`query/`、`tasks/`（结构化任务系统）
- `services/analytics/growthbook`（功能开关远程下发）

Linghun 当前 `packages/`：`providers / tools / tui / runtime / config / permission` 等核心路径，定位仍在终端内核闭环阶段，与 ccb-source 的产品级广度差距明显，但这与阶段蓝图一致，并非 bug。

### 1.3 权限模型差异

- ccb-source `utils/permissions/`：~20 文件，含 `bashClassifier`、`yoloClassifier`（LLM 驱动）、`pathValidation`、`dangerousPatterns`、`shadowedRules`、`ruleParser`、`promptForPermission`，规则可继承、可阴影、可分类自动放行。
- Linghun `packages/tools/src/index.ts:1147`：每个工具静态绑定 `permission: ToolPermissionSpec`，`ToolRisk = low|medium|high`。无规则解析器、无 classifier、无 shadowed 规则检测，更多依赖一次性 prompt。

---

## 二、是否过度拦截（结论：是，但性质是"少白名单"而不是"多黑名单"）

### 2.1 重要事实更正（限定 grep pattern 后）

窄 pattern grep（针对 CCB bash 权限专用术语）：

```
Linghun packages 下搜
  dangerousPattern | bashClassifier | keywordFilter
  | blockedPattern | denyPattern | forbiddenWord | sensitiveWord
→ No files found
```

但宽 pattern grep（`dangerous|sensitive|blocked|secret`，大小写不敏感）：

```
Linghun packages → 命中 40 个文件
（natural-command-bridge、tui-state-runtime、tui-memory-runtime、
 model-doctor-runtime、provider 冷却、job blocked、敏感路径检测等）
```

所以更准确的写法是：

> **Linghun 没有 CCB 那种 bash permission 专用的 `dangerousPatterns` / `bashClassifier` / `yoloClassifier` / `readOnlyCommandValidation` 体系**；并不是说 Linghun 全项目没有任何 dangerous / sensitive / blocked 逻辑——它在 natural-command、敏感路径、provider 冷却、job blocked 等子系统里仍有分散的安全判断。

真正持有"bash 权限专用关键词/模式资产"的是 ccb-source（21 文件命中）：

```
src/utils/permissions/dangerousPatterns.ts       危险命令模式
src/utils/permissions/yoloClassifier.ts          LLM 分类器自动放行
src/utils/permissions/classifierShared.ts        分类器共享逻辑
src/utils/permissions/filesystem.ts              文件系统路径校验
src/utils/bash/ast.ts                            bash AST
src/utils/bash/treeSitterAnalysis.ts             tree-sitter 分析
src/utils/powershell/dangerousCmdlets.ts         PowerShell 危险 cmdlet
src/utils/shell/readOnlyCommandValidation.ts     只读命令识别
src/components/permissions/BashPermissionRequest/...
```

### 2.2 真正的"过拦截"性质

| 维度 | ccb-source | Linghun |
|---|---|---|
| 关键词/模式数据库 | 有，识别危险也识别只读 | 无 |
| 分类器（safe / dangerous / yolo） | 有 | 无 |
| 默认决策 | 命中 safe → **自动放行**；命中 dangerous → 询问/阻塞；其它 → 询问 | 按工具静态 risk → **一律 prompt** |
| 粒度 | 按命令语义、按路径、按 AST 节点 | 按工具静态绑定 |

CCB 表面看起来"规则更多"，实际上靠 `yoloClassifier` 和 `readOnlyCommandValidation` 把绝大多数读类、安全 bash 命令**在不打扰用户的情况下放过去**了。Linghun 没有这层"自动放行旁路"，每一个 medium/high 风险工具默认走 prompt，给人"层层拦"的感受。

### 2.3 加重过拦感的次要因素

1. **每工具静态绑定权限规格**：`packages/tools/src/index.ts` 所有工具声明 `permission: ToolPermissionSpec`，预门控发生在工具执行入口，无 classifier 旁路。
2. **TUI 侧多层 guard / runtime / presenter 包装**：`packages/tui/src/` 下 `architecture-runtime`、`guard-wiring`、`process-guard`、`permission-continuation-runtime`、`request-lifecycle-presenter` 等命名，每层都可能触发 prompt 或挂起。
3. **continuation 重复确认**：`packages/tui/src/index.ts:12361` 等位置在续期时再次检查并打断，同一类操作单次会话会被重复确认。

### 2.4 整改方向（指出，不实施）

- **少加黑名单，多加白名单分类器**：移植 yolo/readOnly 思路（参考行为，不复制源码），让 `ls / cat / git status / which` 这类只读命令自动放行。
- **把工具级静态 permission 改造为"规则评估 + 分类器旁路"**。
- **guard/presenter 多层合并到单一 permission gateway**，避免续期路径多点打断。

---

## 三、为什么 Claude 推理等级"没有生效"（必须区分两层）

> 用户已经手动配 `anthropic_messages + High`，且 Claude 已有自动切 `anthropic_messages` 路由，所以"chat_completions + strict 静默丢弃"**不是这次实测的主要解释**。问题需要拆成 **请求层** 与 **TUI 显示层** 两个独立问题分别排查。

### 3.1 请求层：是否真的发出了 `thinking`？

文件：`F:\Linghun\packages\providers\src\index.ts`

`sendReasoning` 契约（约 800–896 行）：

```
endpointProfile === "deepseek_chat_completions"  → sendReasoning: false（永远）
endpointProfile === "anthropic_messages"         → sendReasoning: Boolean(reasoningLevel)
endpointProfile === "openai_responses"           → sendReasoning: Boolean(reasoningLevel)
endpointProfile === "chat_completions"           → sendReasoning:
    compatibilityProfile === "permissive_openai_compatible" && Boolean(reasoningLevel)
```

### 3.2 关键事实

1. **strict 静默丢弃（旁路情况）**：当 endpoint 解析为 `chat_completions` 且 compatibilityProfile 为默认的 `strict_openai_compatible` 时，`sendReasoning=false`，请求构建阶段直接跳过 `reasoning.effort` 字段，**没有任何 warning**。**注意**：用户当前已手动配 `anthropic_messages + High`，**这不是当前实测主因**，仅作为旁路场景列出。
2. **Anthropic 路径**：`packages/providers/src/index.ts:1428` 处 `if (contract.sendReasoning) { body.thinking = createAnthropicThinkingPayload(level) }` 才会注入 thinking。Linghun 已有"模型名包含 claude → 自动 anthropic_messages"的路由逻辑，所以一般不会被错路由到 OpenAI 分支。
3. **Anthropic 思考预算映射**：`createAnthropicThinkingPayload` 把 Low→1024、Medium→4096、High→8192 budget_tokens；max_tokens 自动 bump 到 budget+1024。**这一段写得正确，前提是 reasoningLevel 真的传到契约层**。
4. **缺 ultrathink / adaptive**：即便进入分支，Linghun 也没有 `hasUltrathinkKeyword` 触发的"用户在 prompt 里写 ultrathink 自动升级"链路，没有 adaptive 类型，没有按订阅默认升档。

### 3.3 请求层可能的 fail 点（用户当前配置下，按概率排序）

- ⚠️ **`appState.reasoningLevel === undefined`**：用户虽然在配置里写了 High，但若该值未被加载到 appState（设置加载顺序、配置作用域、ModelPicker 未重新选择），契约 `Boolean(undefined)===false`，请求体仍不带 thinking。
- ⚠️ **endpointProfile 实际解析与配置预期不一致**：去看启动日志里实际的 `endpointProfile`，而不是配置文件里写的那个。
- ⚠️ **Anthropic 兼容代理静默剥离**：部分中间网关在转发时丢掉 `thinking` 字段。
- ❌ ~~chat_completions + strict 默认丢弃~~：用户已切 anthropic_messages，**已排除**。

### 3.4 请求层验证手法

1. 抓代理或 raw HTTP 出口流量，看实际发出的 request body 是否包含 `"thinking":{...}`、`max_tokens` 是否 ≥ budget+1024。
2. 看 `packages/tui/src/index.ts:11938` 的 `[model_request]` 日志中 `reasoningLevel` 字段是否非空、`endpointProfile` 是否真为 `anthropic_messages`。
3. 任何一项不满足，就先解决请求层；满足后再看下一节 TUI 显示层。

### 3.5 TUI 显示层（请求层 OK 之后才看这里）

文件：`F:\Linghun\packages\tui\src\index.ts:12054–12108`

```ts
if (event.type === "assistant_text_delta") {
  ...
  writeAssistantDelta(output, assistantStreamBlockId, event.text);   // 写主屏
  continue;
}
if (event.type === "assistant_thinking_delta") {
  roundHadThinking = true;          // 只设旗，不写主屏，不进 transcript
  continue;
}
...
if (!roundAssistantText && toolCalls.length === 0) {
  // 空响应判定只看 roundAssistantText，不看 roundHadThinking
  const message = await recordProviderEmptyResponse(
    context, sessionId, roundChunkCount, roundHadUsage,
    roundFinishReason, roundHadThinking,
  );
  writeLine(output, message);
  return;
}
```

**显示层的源码事实**：

1. **`assistant_thinking_delta` 不渲染**：thinking 文本只触发布尔旗 `roundHadThinking`，没有任何 `writeAssistantDelta` / `writeLine` / transcript append。**主屏永远看不见 thinking 内容**。这是有意的（thinking 不应当作普通 assistant 文本流），但意味着：用户看到"屏幕长时间静默"完全可能是 thinking 在跑，而不是模型卡住。
2. **空响应判定只看 text**：`if (!roundAssistantText && toolCalls.length === 0)` 直接走"empty response"分支。如果某轮模型只返回了 thinking 块、tool_use 还没跟上、或上游网关只透传了 thinking 没透传 text，TUI 会把整轮当成"空响应"打印 `recordProviderEmptyResponse` 文案——**用户体感就是"High 没生效，模型啥也没说"**。
3. **provider SSE 解析层：text_delta 正确，thinking_delta 当前源码未处理**：`packages/providers/src/index.ts:1873-1906` 的 Anthropic `content_block_delta` 分支**只处理 `text_delta`（emit `assistant_text_delta`）和 `input_json_delta`（累积 tool_use 参数）**，对 `thinking_delta` / `signature_delta` / `redacted_thinking` 三种子类型**没有任何处理路径**——直接走到末尾的 `return []`（第 1905 行）静默丢弃。事件类型 `assistant_thinking_delta` 在源码中确实存在，但只在 OpenAI reasoning / responses 分支（约第 2112、2184 行）emit，**Anthropic /v1/messages 路径不会 emit `assistant_thinking_delta`**。这意味着：
   - 如果模型只返回 thinking 块没返回 text 块，Anthropic 解析器对全部 thinking_delta 事件返回空数组，TUI 永远收不到任何 assistant_*_delta，触发"empty response"判定。
   - 如果模型既返回 thinking 又返回 text，TUI 仍能拿到 text_delta 正常渲染，但 thinking 部分被解析器吞掉，`roundHadThinking` 旗也不会被置位。
   - **当前用户配置（anthropic_messages + High）下，这是最可能的"High 没生效 / 主屏静默 / 看到空响应文案"根因，比下文§3.5 显示层的两个潜在断点更靠前**。

### 3.6 命中场景重排（按当前用户配置）

| # | 场景 | 现象 | 排查锚点 |
|---|---|---|---|
| 0 | **请求体发了 thinking，SSE 返回 thinking_delta，但 provider Anthropic parser 未处理** | TUI empty response / 无可见输出（最高优先级，源码事实级断点） | 看 `packages/providers/src/index.ts:1873-1906` content_block_delta 分支；抓 SSE 出口流量看 thinking_delta 是否实际到达 |
| 1 | 请求体确实没发 `thinking`（reasoningLevel 没注入到 appState、或被代理剥离） | 模型按默认推理回 text，但回得短/没体感 | 抓 raw request body |
| 2 | 请求体发了 thinking，模型只回 thinking_delta，没有 text_delta（短轮、tool 前置思考） | TUI 打印 empty response 文案（与场景 0 叠加，效应相同） | provider 日志看 delta 计数 |
| 3 | 请求体发了 thinking 且模型回了 text_delta，但 TUI 把 thinking_delta 静默吞掉 | 主屏只显示 text，"看不见思考过程" | 设计行为；但当前 Anthropic 路径上 thinking_delta 在 provider 层就被吞了，TUI 层这条路径在 Anthropic 上不会触发 |
| 4 | 兼容代理只透传 thinking、丢弃 text | TUI empty response | 抓 SSE 出口流量 |

**当前用户配置（anthropic_messages + High）下，"High 没生效 / 主屏空响应"最可能落在场景 0**——这是源码层确认的断点（Anthropic content_block_delta 分支只识别 text_delta / input_json_delta，thinking_delta 静默丢弃），优先级高于"空响应判定不计 thinking"等显示层因素。其次是场景 1（reasoningLevel 未注入）。原报告强调的 chat_completions/strict 路径在用户已切 anthropic_messages 后已被排除。

---

## 四、TUI 输出渲染是否断了（必须分两层看：渲染框架没断，但 SSE→TUI 写入链有可能让用户看起来像断了）

### 4.1 渲染框架（Ink 层）：未断

1. **Ink 渲染器健在**：`packages/tui/src/shell/ink-renderer.tsx` 完整 140 行，`shouldUseInkShell` 门控（LINGHUN_TUI_PLAIN=1 / TERM=dumb / 双端 isTTY / cursorPositioning）正常，capability 失败时回落 plain。
2. **资源清理正确**：`doUnmount` 处理 stdin/stdout close/end/error，`showTerminalCursor` 在卸载时恢复光标 `\x1B[?25h`。
3. **resize 防抖**:60ms 节流的 `instance.clear() + rerender()`，未发现死循环或阻塞。
4. **中文文案完整**：`shell/view-model.ts` 的 `shellText["zh-CN"]` 与品牌字符串 "LingHun" 在位，本地化未掉。
5. **错误兜底**：`rerender` 与 `clear` 均 try/catch 吞掉流关闭竞态，不会因 stdout EPIPE 让进程崩。

### 4.2 SSE → TUI 写入链（关键，可能"显示像断了"）

证据从 provider 到 TUI 全链路追：

1. **Provider SSE 解析**（`packages/providers/src/index.ts:1873–1906`）：
   - `content_block_delta(text_delta)` → emit `assistant_text_delta`（已识别）
   - `content_block_delta(input_json_delta)` → 累积到 pendingToolUses（已识别）
   - `content_block_delta(thinking_delta / signature_delta / redacted_thinking)` → **当前源码未处理，直接 `return []` 静默丢弃**（疑似断点）
   - `message_delta` → emit usage
   - **结论**：text_delta 解析正确；thinking_delta 是当前疑似断点，Anthropic 路径不会 emit `assistant_thinking_delta`（该事件类型只由 OpenAI reasoning / responses 分支产生）。
2. **TUI 消费**（`packages/tui/src/index.ts:12054–12068`）：
   - `assistant_text_delta` → `writeAssistantDelta(output, assistantStreamBlockId, event.text)`，进 streaming block。
   - `assistant_thinking_delta` → 只设 `roundHadThinking=true`，**不写主屏**。
3. **ShellBlockOutput 累积**（`packages/tui/src/index.ts:1628–1748`）：
   - 文档注释明确：`流式 assistant_text_delta 不应被当作普通 writeLine 反复 push/splice`，走 begin/append/end 三段式累积到同一条 `keep:true` block。
   - 这一段是有针对性写的，逻辑上正确。
4. **空响应判定**（`packages/tui/src/index.ts:12096`）：
   - `if (!roundAssistantText && toolCalls.length === 0) → recordProviderEmptyResponse`
   - **不把 `roundHadThinking` 计入"非空"判定**——只回 thinking 没回 text 的轮次会被报空响应。

### 4.3 结论

- **Ink 框架没断**，本地化、capability、清理、防抖都到位。
- **SSE 解析路径有疑似断点**：text_delta 识别正确；**thinking_delta 是当前疑似断点（provider Anthropic parser 未处理）**——Anthropic /v1/messages 的 `content_block_delta(thinking_delta)` 在 `packages/providers/src/index.ts:1873-1906` 中没有被识别，直接 `return []` 丢弃；`assistant_thinking_delta` 只由 OpenAI reasoning/responses 分支产生，Anthropic 路径**不会 emit 任何 thinking 事件到 TUI**。
- **TUI 显示层另有两个潜在"看起来像断"的点**：
  1. **thinking 内容不渲染到主屏**（设计行为，但用户在长 thinking 期间会感到"屏幕静默"）；
  2. **空响应判定不计 thinking**，只回 thinking 没回 text 的轮次会让用户看到 empty response 文案，体感上"输出断了"。
  注意：在 §4.2 第 1 点未修复前，这两点对 Anthropic 路径都不会真正触发——因为 thinking_delta 根本没进 TUI，`roundHadThinking` 永远是 false。

**所以"TUI 渲染未断"这个结论需要严格限定到 Ink 框架；不能等价于"用户看到的最终输出一定不会断"**。当前最高优先级断点在 provider Anthropic SSE 解析器，而不是 TUI 显示层。

### 4.4 体量/可维护性隐忧（与"是否断"无关）

- `packages/tui/src/index.ts` 单文件 **14539 行**，巨型单体。
- reasoningLevel 在其中多点穿线（768 / 1176 / 11938 / 12037 / 12361）。
- 多个 `*-runtime` / `*-presenter` 文件并存，定位困难，但不影响运行时输出。

### 4.5 排查锚点（建议截图配合）

收到"输出断"截图时，按顺序确认：

1. 截图里有没有 `recordProviderEmptyResponse` 的固定文案（中文里类似"模型未返回内容"的提示）？有 → 落 §3.5/§3.6 场景 2/4。
2. 主屏一片静默但 spinner 还在 → 可能在 thinking 期间，§3.6 场景 3，设计行为。
3. 看 `[model_request]` 日志的 `reasoningLevel` 是否非空 → 不是 → §3.6 场景 1。
4. 抓 SSE 流量看 text_delta vs thinking_delta 比例 → 决定问题在上游还是 TUI。

---

## 五、最小行动清单（仅指出，不实施）

1. **修补静默丢弃**：`packages/providers/src/index.ts` chat_completions 分支，当 reasoningLevel 存在但 compatibilityProfile=strict 时，至少打一条 warning，建议提示用户切换 permissive 或 anthropic_messages。
2. **endpointProfile 自动路由扩展**：对 model 名包含 `claude` 的请求强制走 `anthropic_messages`，除非用户显式覆盖。
3. **补齐档位**：把 reasoning 档位扩展到 5 档以对齐主流模型；同时补 per-model allowlist（参考 ccb-source 的设计行为，不复制源码）。
4. **权限旁路**：为 low risk 工具加白名单自动放行通道，缓解过拦感受。
5. **TUI 巨文件拆分**：`packages/tui/src/index.ts` 14k 行需要按职责拆分（reasoning 续期、permission 续期、request 生命周期），但属阶段性重构，不在当前最小改动范畴。

---

## 六、参考核对

- 实际读取的 Linghun 源码：`packages/providers/src/index.ts`（800–920、1380–1577）、`packages/tui/src/shell/ink-renderer.tsx`、`packages/tui/src/shell/view-model.ts`（前 80 行）、`packages/tools/src/index.ts`（结构与权限字段）。
- 实际读取的 ccb-source 源码：`src/utils/thinking.ts`（全文 167 行）、`src/utils/effort.ts`（全文 411 行）、`src/utils/permissions/`（目录结构）、`src/` 顶层子系统目录。
- 仅做行为参考，未复制任何 ccb-source 实现到 Linghun。
- 未读取任何 Linghun 阶段文档、审计报告、handoff packet；本报告全部结论基于直接读源码与 grep 事实。
