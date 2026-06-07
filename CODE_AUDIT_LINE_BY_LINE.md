# Linghun 逐行代码审计（自动化扫描）

**扫描时间**: 2026-06-06T17:33:42.383Z
**扫描文件数**: 214
**发现问题数**: 6378

---

## 扫描模式

| 模式 | 检测内容 |
|------|---------|
| 空catch吞错误 | 完全空的 catch 块将静默丢弃所有异常 |
| 空catch吞错误(带变量) | 带变量但空的 catch 块，吞错且丢失变量名 |
| catch返回null/undefined | catch 中返回 null/undefined/{} 将真实错误与正常缺值不可区分 |
| catch返回空数组 | catch 中返回 [] 将权限错误当无数据 |
| void Promise(潜在rejection) | void 调用异步函数未附 .catch() |
| 硬编码URL | 硬编码的 URL 字符串 |
| 硬编码文件路径(/tmp或~/) | 硬编码的文件系统路径 |
| 硬编码模型名 | 硬编码的模型名称 |
| as断言绕过类型 | as 类型断言绕过 TS 编译检查 |
| 魔法数字(MB/KB) | 常见的上下文/输出 token 魔法数字 |
| 魔法数字(毫秒超时) | 常见的超时魔法数字(ms) |
| 魔法数字(轮次/计数) | 可能为魔法数字的整数阈值 |
| export函数超过100行 | 长函数签名(需要手动检查体量) |
| TuiContext直接字段修改 | 对 TuiContext 属性的直接修改 |
| if-elseif链无else兜底 | if/else-if 链(需手动检查最后有无 else 兜底) |
| 默认值使用硬编码中文 | 可能硬编码的中文用户可见字符串 |

---

## 按严重度汇总

| 严重度 | 数量 |
|--------|------|
| high | 2 |
| medium | 3503 |
| low | 2873 |

---

## 详细发现


### packages/tui/src/job-agent-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 3513 | 空catch吞错误 | high | } catch {} |

### packages/tui/src/model-tool-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 524 | 空catch吞错误 | high | } catch {} |

### apps/cli/src/cli.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 8 | 默认值使用硬编码中文 | medium | ";  export const helpText = `${LINGHUN_NAME} ${LINGHUN_VERSION}  用法：   ${LINGHUN... |
| 90 | 默认值使用硬编码中文 | medium | ",     stderr: `未知命令：${command}\n运行 ${LINGHUN_CLI_NAME} --help 查看可用命令。\n`,     e... |
| 136 | 默认值使用硬编码中文 | medium | "用法：linghun model set <model>" |
| 142 | 默认值使用硬编码中文 | medium | "模型不可用。" |
| 148 | 默认值使用硬编码中文 | medium | ";     return {       stdout: `当前 headless 模型已切换为：${resolved.model}\n${aliasNote... |
| 175 | 默认值使用硬编码中文 | medium | ";     if (!target.provider.baseUrl) {       problems.push(`- 缺少 base_url：请设置 ${... |
| 220 | 默认值使用硬编码中文 | medium | ";     const header = `模型诊断：${target.modelId}\nprovider=${target.providerId} mod... |
| 222 | 默认值使用硬编码中文 | medium | ";     if (problems.length === 0) {       return { stdout: `${header}${warningTe... |
| 224 | 默认值使用硬编码中文 | medium | ", exitCode: 0 };     }     return {       stdout: `${header}${warningText}状态：发现... |
| 227 | 默认值使用硬编码中文 | medium | ")}\n建议：修复后重新运行 /model doctor。\n`,       stderr: " |
| 228 | 默认值使用硬编码中文 | medium | ",       exitCode: 0,     };   }    return usageError(`未知 model 子命令：${subcommand... |
| 243 | 默认值使用硬编码中文 | medium | ");     if (model) {       return `当前模型：${model.displayName} (${model.id})\nprov... |
| 245 | 默认值使用硬编码中文 | medium | "}\n上下文窗口：${model.contextWindow}\n厂商最大输出：${model.maxOutputTokens}\n请求输出上限：未设置\n`... |
| 248 | 默认值使用硬编码中文 | medium | "}\n上下文窗口：unknown\n厂商最大输出：unknown\n请求输出上限：未设置\n`; }  type DoctorProviderConfig =... |
| 252 | 默认值使用硬编码中文 | medium | ";   baseUrl?: string;   apiKey?: string;   model: string;   // Run 2 P1-3 修复 — ... |
| 360 | 默认值使用硬编码中文 | medium | "当前项目还没有会话。\n" |
| 363 | 默认值使用硬编码中文 | medium | ";         return `${session.id}  ${session.updatedAt}  ${summary}`;       });  ... |
| 375 | 默认值使用硬编码中文 | medium | ")) {         return jsonResult(session);       }       return { stdout: `已创建会话：... |
| 385 | 默认值使用硬编码中文 | medium | "用法：linghun sessions append <id> --message 文本" |
| 394 | 默认值使用硬编码中文 | medium | "用法：linghun sessions resume <id>" |
| 397 | 默认值使用硬编码中文 | medium | ")) {         return jsonResult(resumed);       }       return {         stdout:... |
| 410 | 默认值使用硬编码中文 | medium | "用法：linghun sessions summary <id> [--text 文本]" |
| 412 | 默认值使用硬编码中文 | medium | ");       if (text) {         const session = await store.updateSummary(sessionI... |
| 415 | 默认值使用硬编码中文 | medium | ", exitCode: 0 };       }       const resumed = await store.resume(sessionId);  ... |
| 480 | 默认值使用硬编码中文 | medium | ";   }   return `${diagnostics     .map((diagnostic) => `JSONL 第 ${diagnostic.li... |

### packages/config/src/index.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 24 | 默认值使用硬编码中文 | medium | ";   baseUrl?: string;   apiKey?: string;   model: string;   maxOutputTokens?: n... |
| 175 | 默认值使用硬编码中文 | medium | ";   allowedEventTypes: RemoteEventType[];   trustedSources: string[];   // D.14... |
| 230 | 默认值使用硬编码中文 | medium | ";   endpointProfile?: EndpointProfile;   includeUsage?: boolean;   auxModel?: s... |
| 242 | 默认值使用硬编码中文 | medium | "标出来，让用户在 smoke 之前 // 显式替换为现役模型名（例如 deepseek-chat / deepseek-reasoner）。 export c... |
| 268 | 默认值使用硬编码中文 | medium | "模型名不能为空。" |
| 285 | 默认值使用硬编码中文 | medium | ",       legacyAlias: normalized !== inputModel,     };   }   throw new Error(  ... |
| 290 | 默认值使用硬编码中文 | medium | ")}。`,   ); }  // D.13J Block 1：上一次 mergeProviderEnvConfig 的合并摘要。 // doctor 能据此明... |
| 295 | 默认值使用硬编码中文 | medium | "。 // 仅记录字段是否覆盖、provider id 列表，**绝不**记录 apiKey、baseUrl、modelRoutes 内容等敏感数据。 expo... |
| 326 | 默认值使用硬编码中文 | medium | ";   };   // D.13F：prompt cache 总开关与 Anthropic system block 的 ttl 选择。   // enabl... |
| 329 | 默认值使用硬编码中文 | medium | " 仅在用户显式选择时   // 写入 cache_control.ttl: " |
| 330 | 默认值使用硬编码中文 | medium | " 表示不传 ttl 字面量（Anthropic 默认 5m）。   promptCache: {     enabled: boolean;     syst... |
| 333 | 默认值使用硬编码中文 | medium | ";   };   skills: SkillConfig;   workflows: WorkflowConfig;   hooks: HookConfig;... |
| 491 | 硬编码URL | medium | "https://api.deepseek.com/v1" |
| 545 | 硬编码文件路径(/tmp或~/) | medium | "~/.linghun/skills" |
| 564 | 硬编码文件路径(/tmp或~/) | medium | "~/.linghun/plugins" |
| 874 | 默认值使用硬编码中文 | medium | "API 地址不能为空。" |
| 880 | 默认值使用硬编码中文 | medium | "这个地址看起来不对，请填写 root API 地址，例如 https://example.com/v1。" |
| 884 | 默认值使用硬编码中文 | medium | "这个地址看起来不对，请填写 http/https root API 地址，例如 https://example.com/v1。" |
| 889 | 默认值使用硬编码中文 | medium | "API 地址不要包含 query、fragment 或 token 参数，请填写 root API 地址，例如 https://example.com/v1。... |
| 894 | 默认值使用硬编码中文 | medium | "API 地址应为 root baseUrl，例如 https://example.com/v1，不要包含 /chat/completions 或 /respo... |
| 904 | 默认值使用硬编码中文 | medium | "API key 首尾不要包含空格，请重新粘贴单行 key。" |
| 907 | 默认值使用硬编码中文 | medium | "API key 不能包含换行，请重新粘贴单行 key。" |
| 915 | 默认值使用硬编码中文 | medium | "API key 不需要包裹引号，请去掉首尾引号。" |
| 921 | 默认值使用硬编码中文 | medium | "模型名称不能为空。" |
| 931 | 默认值使用硬编码中文 | medium | "推理等级可选 Low / Medium / High，默认 Medium。" |
| 956 | 默认值使用硬编码中文 | medium | ");     if (equalsIndex <= 0) {       throw new Error(`${path}:${index + 1} 不是有效... |
| 973 | 默认值使用硬编码中文 | medium | ') {     return value;   }   if (!value.endsWith(quote) \|\| value.length === 1) {... |
| 1090 | 默认值使用硬编码中文 | medium | ") {       lastProviderEnvWarning = undefined;       return providerEnvToConfig(... |
| 1108 | 硬编码文件路径(/tmp或~/) | medium | "~/.linghun/provider.env 已合并/覆盖了 modelRoutes/defaultModel/providers" |
| 1108 | 默认值使用硬编码中文 | medium | "。   // 仅记录 provider id 列表，不记录任何 apiKey/baseUrl/model 值。   const providerEnvProv... |
| 1415 | 默认值使用硬编码中文 | medium | "endpointProfile 可选 chat_completions / responses / anthropic_messages。" |
| 1517 | 默认值使用硬编码中文 | medium | "     ) {       throw new Error(`settings.providers.${providerId}.compatibilityP... |

### packages/core/src/jsonl.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 39 | 默认值使用硬编码中文 | medium | "无法解析 JSONL 行。" |

### packages/core/src/session-store.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 12 | 默认值使用硬编码中文 | medium | ";  // D.13O — sessionId 在写入 / 读取路径前必须做静态校验。 // 拒绝：空字符串、超长、`.` / `..`、绝对路径、盘符、sl... |
| 25 | 默认值使用硬编码中文 | medium | "sessionId 不能为空。建议：传入由 SessionStore.create 返回的会话 id。" |
| 33 | 默认值使用硬编码中文 | medium | "sessionId 不能是 . 或 ..；这是路径越界尝试。" |
| 36 | 默认值使用硬编码中文 | medium | "sessionId 不允许包含 ..；这是路径越界尝试。" |
| 40 | 默认值使用硬编码中文 | medium | 'sessionId 含非法字符（slash / backslash / 控制字符 / 空格 / : * ? " |
| 44 | 默认值使用硬编码中文 | medium | "sessionId 不能是绝对路径或盘符；只允许 sessions 子目录名。" |
| 100 | 默认值使用硬编码中文 | medium | ",       sessionId: id,       projectPath: project.projectPath,       createdAt,... |

### packages/core/src/session.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 3 | 默认值使用硬编码中文 | medium | ";  export type CacheFreshness = {   systemPromptHash: string;   toolSchemaHash:... |
| 16 | 默认值使用硬编码中文 | medium | ") 处理，保持向后兼容。   endpointProfileHash?: string;   cacheControlHash?: string;   cac... |
| 22 | 默认值使用硬编码中文 | medium | ") 处理，保持向后兼容；不影响 D.13F 既有 keys 顺序。   contextEditingHash?: string;   cacheEditing... |
| 28 | 默认值使用硬编码中文 | medium | ") 处理，向后兼容。   deferredToolListHash?: string;   changedKeys: string[]; };  export... |

### packages/providers/src/index.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 7 | 默认值使用硬编码中文 | medium | ";  export type ModelUsage = {   inputTokens: number;   outputTokens: number;   ... |
| 81 | 默认值使用硬编码中文 | medium | ";   displayName?: string;   baseUrl?: string;   apiKey?: string;   model: strin... |
| 95 | 默认值使用硬编码中文 | medium | "   //   AND anthropicBetaHeaders.filter(Boolean).length > 0   // 三者同时成立时才会在请求 h... |
| 127 | 默认值使用硬编码中文 | medium | ";   endpointProfile?: EndpointProfile;   reasoningLevel?: string;   // D.13F：pr... |
| 131 | 默认值使用硬编码中文 | medium | " 显式传，不传等于 5m 默认（cache_control 不写 ttl 字面量）。   // cacheBreakNonce 由 TUI/runtime 根... |
| 200 | 默认值使用硬编码中文 | medium | ";   name: string;   description: string;   parameters: unknown; };  type Pendin... |
| 219 | 默认值使用硬编码中文 | medium | " }，不传 ttl: " |
| 219 | 默认值使用硬编码中文 | medium | " 字面量。 // 1h 仅在用户显式 promptCache.systemTtl=" |
| 220 | 默认值使用硬编码中文 | medium | " 时设 ttl: " |
| 220 | 默认值使用硬编码中文 | medium | "，不附加 beta header。 export type AnthropicTextBlock = { type: " |
| 264 | 默认值使用硬编码中文 | medium | "; name: string };  // Anthropic Messages API extended thinking 配置；budget_tokens... |
| 295 | 默认值使用硬编码中文 | medium | ";       index?: number;       delta?: {         type?: string;         text?: s... |
| 311 | 默认值使用硬编码中文 | medium | ";       error?: { type?: string; message?: string };     };  type AnthropicUsag... |
| 425 | 默认值使用硬编码中文 | medium | ",         message: `未找到模型：${modelId}`,         suggestion: " |
| 427 | 默认值使用硬编码中文 | medium | ",         recoverable: true,       });     }     return model;   }    async *st... |
| 471 | 默认值使用硬编码中文 | medium | ",       message: `模型不支持工具调用：${model}`,       suggestion: " |
| 482 | 默认值使用硬编码中文 | medium | ",         message: `未找到模型供应商：${providerId}`,         suggestion: " |
| 519 | 默认值使用硬编码中文 | medium | "baseUrl 应填根路径，例如 https://example.com/v1；endpointProfile 使用 chat_completions / r... |
| 521 | 默认值使用硬编码中文 | medium | "baseUrl 应填不含 query/fragment 的根路径，例如 https://example.com/v1；私有 token 或路由参数不要放进 b... |
| 535 | 默认值使用硬编码中文 | medium | "、contextEditingEnabled === true、 // 且 anthropicBetaHeaders 至少包含一个非空字符串时，sendabl... |
| 537 | 默认值使用硬编码中文 | medium | ")>。 // 即使 sendable=true，请求 body 仍然永远不写入 cache_edits / cache_reference —— CCB //... |
| 564 | 默认值使用硬编码中文 | medium | "unsupported endpoint profile (chat_completions / responses 不支持 cache_edits)" |
| 580 | 默认值使用硬编码中文 | medium | ",     };   }   return {     enabled: true,     sendable: true,     betaHeaderCo... |
| 614 | 默认值使用硬编码中文 | medium | ")) {     return `${trimmedBase}${endpoint}`;   }   // endpoint 形如 /v1/messages：... |
| 685 | 默认值使用硬编码中文 | medium | ") {       const body = this.createAnthropicMessagesRequest(request);       // D... |
| 689 | 默认值使用硬编码中文 | medium | "       //   AND anthropicBetaHeaders.filter(Boolean).length > 0       // 三者同时成立... |
| 691 | 默认值使用硬编码中文 | medium | ")> 附加进 headers；       // 永不发空的 anthropic-beta header（即使长度 1 但全空字符串也按 0 处理）。    ... |
| 697 | 默认值使用硬编码中文 | medium | ",         ...LINGHUN_REQUEST_IDENTITY_HEADERS,         // Anthropic Messages 鉴权... |
| 740 | 默认值使用硬编码中文 | medium | "模型请求失败：响应中没有可读取的流。" |
| 788 | 默认值使用硬编码中文 | medium | "模型请求失败：响应中没有可读取的流。" |
| 806 | 默认值使用硬编码中文 | medium | "模型配置缺少 base_url。" |
| 807 | 默认值使用硬编码中文 | medium | "请为当前 provider 设置兼容的 base_url，然后运行 /model doctor 复查。" |
| 814 | 默认值使用硬编码中文 | medium | "模型配置缺少 api_key。" |
| 815 | 默认值使用硬编码中文 | medium | "请设置环境变量或本地配置中的 api_key，然后运行 /model doctor 复查。" |
| 837 | 默认值使用硬编码中文 | medium | ",       retryStatuses: [...PROVIDER_RETRY_STATUSES],       maxAttempts: PROVIDE... |
| 863 | 默认值使用硬编码中文 | medium | ") {     // D.13G：anthropic_messages profile 现在原生支持 tools/tool calling。     // 默... |
| 866 | 默认值使用硬编码中文 | medium | "     // 走 Anthropic 原生 schema（{name, description, input_schema}），     // toolRe... |
| 868 | 默认值使用硬编码中文 | medium | " 走 user content block 形态。     // D.13K：Anthropic Messages 原生支持 extended thinkin... |
| 919 | 默认值使用硬编码中文 | medium | ",     retryStatuses: [...PROVIDER_RETRY_STATUSES],     maxAttempts: PROVIDER_MA... |
| 936 | 默认值使用硬编码中文 | medium | "（无论来源是 provider.env 旧 setup 默认还是用户 settings 显式声明）  *      → 自动选 anthropic_messa... |
| 953 | 默认值使用硬编码中文 | medium | ";  export type EffectiveEndpointProfileResult = {   endpointProfile: EndpointPr... |
| 981 | 默认值使用硬编码中文 | medium | " 默认值带进 request；如果这里信任 request.chat_completions，   //      即使 config.endpointPro... |
| 986 | 默认值使用硬编码中文 | medium | ") {     if (baseUrlSuffix && baseUrlSuffix !== requestProfile) {       warnings... |
| 995 | 默认值使用硬编码中文 | medium | "request 显式声明 endpointProfile" |
| 1001 | 默认值使用硬编码中文 | medium | " && !requestIsChatPlaceholderForClaude) {     if (baseUrlSuffix && baseUrlSuffi... |
| 1010 | 默认值使用硬编码中文 | medium | "request 显式声明 endpointProfile" |
| 1014 | 默认值使用硬编码中文 | medium | " 且 Claude placeholder：继续走 baseUrl / auto-claude   // 决策；不在这里直接生效，避免被 TUI select... |
| 1027 | 默认值使用硬编码中文 | medium | ",       reason: `baseUrl 以 ${baseUrlSuffix === " |
| 1028 | 默认值使用硬编码中文 | medium | "} 结尾`,       warnings,     };   }    // 3. Claude 模型 + (config.endpointProfile ... |
| 1043 | 默认值使用硬编码中文 | medium | ",       reason: input.configEndpointProfile         ? `model=${model} 是 Claude ... |
| 1053 | 默认值使用硬编码中文 | medium | " && modelLooksClaude) {       warnings.push(         `model=${model} 看起来是 Claud... |
| 1061 | 默认值使用硬编码中文 | medium | "config 显式声明 endpointProfile" |
| 1070 | 默认值使用硬编码中文 | medium | "未配置 endpointProfile，且模型不像 Claude，缺省 chat_completions" |
| 1143 | 默认值使用硬编码中文 | medium | ",     message: `模型请求失败：等待 provider 响应头超过 ${timeoutMs}ms。`,     suggestion:     ... |
| 1184 | 默认值使用硬编码中文 | medium | ";   // 去除可能出现的密钥碎片（sk- / Bearer ...），避免错误信息把 token 回显出去。   const redacted = col... |
| 1198 | 默认值使用硬编码中文 | medium | ";   const lower = rawContentType.toLowerCase();   // 兼容 `text/event-stream`、`ap... |
| 1208 | 默认值使用硬编码中文 | medium | ",     message:       `模型请求失败：endpointProfile=${endpointProfile}，endpoint=${endp... |
| 1214 | 默认值使用硬编码中文 | medium | "OpenAI-compatible root baseUrl + responses 可能可用；chat_completions 通常需要 /v1 root。... |
| 1215 | 默认值使用硬编码中文 | medium | "如果返回 text/html，baseUrl 可能填到了网页登录页或少了 /v1。" |
| 1216 | 默认值使用硬编码中文 | medium | "或运行 /model doctor 复查 provider 路由。" |
| 1234 | 默认值使用硬编码中文 | medium | ",               message: `模型请求失败：流式响应超过 ${timeoutMs}ms 没有新数据。`,               s... |
| 1276 | 默认值使用硬编码中文 | medium | "请检查 endpointProfile；chat_completions 与 responses schema 不能混用。" |
| 1309 | 默认值使用硬编码中文 | medium | "请检查 endpointProfile；chat_completions 与 responses schema 不能混用。" |
| 1325 | 默认值使用硬编码中文 | medium | " as const }         : {}),     ...(contract.sendReasoning       ? createReasoni... |
| 1360 | 默认值使用硬编码中文 | medium | "请检查 endpointProfile；anthropic_messages 与 chat_completions / responses schema 不能... |
| 1397 | 默认值使用硬编码中文 | medium | ") {       const toolCalls = message.toolCalls ?? [];       if (toolCalls.length... |
| 1420 | 默认值使用硬编码中文 | medium | ") {       // tool role 必须配对到 user 消息的 tool_result block。       if (!pendingTool... |
| 1425 | 默认值使用硬编码中文 | medium | "等结构改动。         continue;       }       pendingToolUseIds.delete(message.tool_ca... |
| 1430 | 默认值使用硬编码中文 | medium | ",         tool_use_id: message.tool_call_id,         content: message.content, ... |
| 1441 | 默认值使用硬编码中文 | medium | ", content: [toolResultBlock] });       }     }   }   // D.13G：assistant 已经发起 to... |
| 1461 | 默认值使用硬编码中文 | medium | ", content: repairBlocks });     }   }   const body: AnthropicMessagesRequest = ... |
| 1489 | 默认值使用硬编码中文 | medium | " 时同步透传。   if (contract.supportsTools && request.tools && request.tools.length >... |
| 1492 | 默认值使用硬编码中文 | medium | " };   } else if (contract.supportsTools && request.toolChoice) {     // 没有 tool... |
| 1499 | 默认值使用硬编码中文 | medium | "）。     // 关闭时仍走 string 形态，request body 不会出现 cache_control 字段，避免误触发缓存计费。     // ... |
| 1521 | 默认值使用硬编码中文 | medium | ");     }   }   return body; }  function createAnthropicTools(request: ModelRequ... |
| 1553 | 默认值使用硬编码中文 | medium | ">(   key: K,   request: ModelRequest,   config: ProviderConfig, ): Partial<Reco... |
| 1581 | 默认值使用硬编码中文 | medium | " as const,       function: {         name: tool.name,         description: tool... |
| 1613 | 默认值使用硬编码中文 | medium | ",     message: `模型/provider profile 不支持工具调用：${contract.profile}`,     suggestio... |
| 1714 | 默认值使用硬编码中文 | medium | ") {     return normalized;   }   return level; }  // D.13K：Anthropic Messages e... |
| 1731 | 默认值使用硬编码中文 | medium | ") budget = 8192;   else budget = 4096; // medium / 未识别 → 与 model-setup 默认 Mediu... |
| 1833 | 默认值使用硬编码中文 | medium | "模型请求失败：流结束时仍有未完成的 tool call。" |
| 1835 | 默认值使用硬编码中文 | medium | "请重试；如持续出现，运行 /model doctor 检查 provider 的 tool calling 流式兼容性或切换 endpoint profile... |
| 1841 | 默认值使用硬编码中文 | medium | ",     id: state.lastId,     finishReason: state.finishReason,     chunkCount: s... |
| 1885 | 默认值使用硬编码中文 | medium | " 分隔；按事件粒度切，避免半截 data 行解析失败。     let separatorIndex = buffer.indexOf(" |
| 1906 | 默认值使用硬编码中文 | medium | ",     id: state.lastId,     finishReason: state.finishReason,     chunkCount: s... |
| 1963 | 默认值使用硬编码中文 | medium | "模型请求失败：provider 返回了无法解析的 Anthropic 流式 JSON。" |
| 1965 | 默认值使用硬编码中文 | medium | "请运行 /model doctor 检查 base_url 是否为 Anthropic Messages /v1/messages 接口，或切换 provid... |
| 1981 | 默认值使用硬编码中文 | medium | ",           message: `模型请求失败：Anthropic Messages 流式返回错误${message ? `：${message}`... |
| 1984 | 默认值使用硬编码中文 | medium | "请运行 /model doctor 检查 provider/model、额度、base_url 和 anthropic-version 头是否正确。" |
| 2004 | 默认值使用硬编码中文 | medium | ") {     // D.13G：tool_use 块开始时建立 pendingToolUses entry；text/其它块不产 LinghunEvent。... |
| 2017 | 默认值使用硬编码中文 | medium | "模型请求失败：Anthropic 流式 tool_use 缺 id 或 name。" |
| 2019 | 默认值使用硬编码中文 | medium | "请运行 /model doctor 检查 provider 是否完整支持 Anthropic Messages tool_use 流式协议；如持续出现请切换 ... |
| 2025 | 默认值使用硬编码中文 | medium | " });     }     // D.13M：redacted_thinking 整块（block.type === " |
| 2027 | 默认值使用硬编码中文 | medium | "）在 content_block_start 直接出现。     // 不暴露 block.data；只用空字符串 thinking_delta 标记本轮" |
| 2028 | 默认值使用硬编码中文 | medium | "，让 TUI 走 thinking-only 文案。     if (block?.type === " |
| 2039 | 默认值使用硬编码中文 | medium | ", id: state.lastId, text: delta.text }];     }     // D.13M：Anthropic extended ... |
| 2045 | 默认值使用硬编码中文 | medium | "，让 TUI 走 thinking-only 文案。     if (delta?.type === " |
| 2057 | 默认值使用硬编码中文 | medium | ") {       // D.13G：input_json_delta 累积 partial_json 到对应 index 上的 pendingToolUse... |
| 2069 | 默认值使用硬编码中文 | medium | "模型请求失败：Anthropic 流式 input_json_delta 落在非 tool_use 内容块上。" |
| 2071 | 默认值使用硬编码中文 | medium | "请运行 /model doctor 检查 provider 的 Anthropic Messages 流式实现是否完整；如持续出现请切换 provider/m... |
| 2085 | 默认值使用硬编码中文 | medium | ") {     // D.13G：tool_use 块结束 → JSON.parse 累积的 partial_json，emit 单个 LinghunEven... |
| 2102 | 默认值使用硬编码中文 | medium | "模型请求失败：Anthropic 流式 tool_use input_json 无法解析为 JSON。" |
| 2104 | 默认值使用硬编码中文 | medium | "请运行 /model doctor 检查 provider 的 Anthropic Messages 流式实现是否完整；如持续出现请切换 provider/m... |
| 2114 | 默认值使用硬编码中文 | medium | ") {     const stopReason = parsed.delta?.stop_reason;     if (stopReason) state... |
| 2131 | 默认值使用硬编码中文 | medium | ",         usage: {           inputTokens,           outputTokens,           tot... |
| 2239 | 默认值使用硬编码中文 | medium | "模型请求失败：provider 返回了无法解析的流式 JSON。" |
| 2241 | 默认值使用硬编码中文 | medium | "请运行 /model doctor 检查 base_url 是否为 OpenAI compatible 接口，或切换 provider/model 后重试。" |
| 2258 | 默认值使用硬编码中文 | medium | ",           message: `模型请求失败：provider 流式返回错误${message ? `：${message}` : " |
| 2261 | 默认值使用硬编码中文 | medium | "请运行 /model doctor 检查 provider/model、额度、base_url 和 tool calling 兼容性。" |
| 2340 | 默认值使用硬编码中文 | medium | ",           message: `模型请求失败：Responses endpoint 返回 ${parsed.type}。`,           ... |
| 2500 | 硬编码URL | medium | "https://api.deepseek.com/v1" |
| 2519 | 默认值使用硬编码中文 | medium | "模型请求失败：无法连接到模型服务。" |
| 2520 | 默认值使用硬编码中文 | medium | "请检查网络、base_url 是否正确，或稍后重试。" |
| 2532 | 默认值使用硬编码中文 | medium | "这通常是 provider 或网络传输层的临时问题。请稍后重试；反复出现时运行 /model doctor 查看配置摘要。" |
| 2538 | 默认值使用硬编码中文 | medium | ",       message: `模型请求失败：${error.message}`,       suggestion: " |
| 2547 | 默认值使用硬编码中文 | medium | "模型请求失败：未知错误。" |
| 2548 | 默认值使用硬编码中文 | medium | "请运行 /model doctor 检查当前 provider 配置。" |
| 2556 | 默认值使用硬编码中文 | medium | " \| null {   if (/retry\s*exhausted\|重试.*耗尽/iu.test(message)) {     return " |
| 2558 | 默认值使用硬编码中文 | medium | ";   }   if (     /crc\|checksum\|eventstream\|event[-\s]?stream\|stream\s*decode\|de... |
| 2598 | 默认值使用硬编码中文 | medium | ",     message: `模型请求失败：API Key 无效或没有权限（HTTP ${status}${suffix ? `，${suffix.slic... |
| 2602 | 默认值使用硬编码中文 | medium | "请检查当前 provider 的 api_key 是否对该网关有效；anthropic_messages 同时使用 x-api-key 和 Authoriza... |
| 2603 | 默认值使用硬编码中文 | medium | "请检查当前 provider 的 api_key 是否正确，或运行 /model doctor 复查配置。" |
| 2651 | 默认值使用硬编码中文 | medium | "; }  function isQuotaOrBalanceExhaustedResponse(responseText?: string): boolean... |
| 2675 | 默认值使用硬编码中文 | medium | ",       message: `模型请求失败：HTTP 400，请求格式不被 provider 接受${suffix}${hint ? `（${hint}... |
| 2678 | 默认值使用硬编码中文 | medium | "请运行 /model doctor；重点检查 model 名是否被网关接受、anthropic Messages schema（messages/system... |
| 2679 | 默认值使用硬编码中文 | medium | "请运行 /model doctor；重点检查 endpointProfile、compatibilityProfile、model、tools/tool_ch... |
| 2685 | 默认值使用硬编码中文 | medium | ",       message: `模型请求失败：HTTP 404，endpoint 不存在或不被 provider 支持${suffix}。`,      ... |
| 2689 | 默认值使用硬编码中文 | medium | "请运行 /model doctor；确认 base_url 没有误填完整 endpoint，且网关支持当前 endpointProfile 对应的路径。" |
| 2696 | 默认值使用硬编码中文 | medium | ",         message: `模型请求失败：HTTP 429，provider 返回额度或余额不足${suffix}。`,         sugg... |
| 2704 | 默认值使用硬编码中文 | medium | ",       message: `模型请求失败：HTTP 429，已触发 provider 限流${suffix}。`,       suggestion:... |
| 2712 | 默认值使用硬编码中文 | medium | ",       message: `模型请求失败：HTTP ${status}，provider 返回额度、余额或账单不可用${suffix}。`,     ... |
| 2721 | 默认值使用硬编码中文 | medium | ",       message: `模型请求失败：HTTP ${status}，provider 服务端异常${suffix}。`,       sugges... |
| 2725 | 默认值使用硬编码中文 | medium | "请稍后重试；如持续失败，运行 /model doctor 检查 provider/baseUrl/model、endpointProfile 是否被网关支持，... |
| 2726 | 默认值使用硬编码中文 | medium | "请稍后重试；如持续失败，运行 /model doctor 检查 base_url 或切换 fallback model。" |
| 2731 | 默认值使用硬编码中文 | medium | ",     message: `模型请求失败：HTTP ${status}${suffix}。`,     suggestion: " |

### packages/tools/src/index.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 139 | 默认值使用硬编码中文 | medium | "]; const RG_TIMEOUT_MS = 30_000;  export function createToolContext(workspaceRo... |
| 196 | 默认值使用硬编码中文 | medium | "读取工作区文件内容。" |
| 200 | 默认值使用硬编码中文 | medium | "只读查看文件内容。" |
| 212 | 默认值使用硬编码中文 | medium | "在工作区内写入完整文件内容。" |
| 216 | 默认值使用硬编码中文 | medium | "会修改工作区文件，Phase 06 将接入权限审批。" |
| 228 | 默认值使用硬编码中文 | medium | "在工作区内做唯一字符串替换。" |
| 232 | 默认值使用硬编码中文 | medium | "会在工作区内做单文件唯一字符串替换，属于低风险编辑。" |
| 243 | 默认值使用硬编码中文 | medium | "批量编辑文件" |
| 244 | 默认值使用硬编码中文 | medium | "在同一文件内按顺序做多个唯一字符串替换。" |
| 248 | 默认值使用硬编码中文 | medium | "会修改工作区文件，并逐项要求 oldText 唯一。" |
| 260 | 默认值使用硬编码中文 | medium | "在工作区内按正则搜索文本。" |
| 264 | 默认值使用硬编码中文 | medium | "只读搜索文件内容。" |
| 276 | 默认值使用硬编码中文 | medium | "在工作区内按 glob 模式匹配文件。" |
| 280 | 默认值使用硬编码中文 | medium | "只读列出文件路径。" |
| 292 | 默认值使用硬编码中文 | medium | "在工作区内执行 shell 命令并保存完整日志。" |
| 296 | 默认值使用硬编码中文 | medium | "会执行本地命令；Phase 05 仅声明风险，Phase 06 接入审批。" |
| 309 | 默认值使用硬编码中文 | medium | "维护当前会话任务、完成项和阻塞项。" |
| 313 | 默认值使用硬编码中文 | medium | "只修改当前会话内任务状态。" |
| 325 | 默认值使用硬编码中文 | medium | "输出本轮工具改动文件列表和摘要。" |
| 329 | 默认值使用硬编码中文 | medium | "只读汇总本轮 changedFiles。" |
| 373 | 默认值使用硬编码中文 | medium | ",     maxResultSizeChars: DEFAULT_TOOL_TEXT_LIMIT,   }; }  function normalizeTo... |
| 393 | 默认值使用硬编码中文 | medium | " \|\| Array.isArray(input)) {     throw new Error(`${toolName} 输入必须是对象。建议：按工具 sch... |
| 401 | 默认值使用硬编码中文 | medium | " \|\| value.length === 0) {     throw new Error(`${toolName}.${key} 必须是非空字符串。`); ... |
| 416 | 默认值使用硬编码中文 | medium | ") {     throw new Error(`${toolName}.${key} 必须是字符串。`);   }   return value; }  f... |
| 469 | 默认值使用硬编码中文 | medium | "MultiEdit.edits 必须是非空数组。" |
| 526 | 默认值使用硬编码中文 | medium | "Todo.action 必须是 list/add/start/done/block。" |
| 536 | 默认值使用硬编码中文 | medium | "Diff.files 必须是字符串数组。" |
| 543 | 默认值使用硬编码中文 | medium | ");   const info = await stat(filePath);   rememberReadSnapshot(context, filePat... |
| 593 | 默认值使用硬编码中文 | medium | ",     input.content,     readGuard,   ); }  async function editTool(input: Edit... |
| 611 | 默认值使用硬编码中文 | medium | ";     throw new Error(`${message} 建议：重新 Read 文件，确认最新内容后再提交可唯一匹配的编辑。`);   }   co... |
| 625 | 默认值使用硬编码中文 | medium | "MultiEdit 需要至少 1 个 edits 项。建议：传入 edits=[{oldText,newText}]。" |
| 640 | 默认值使用硬编码中文 | medium | "唯一性检查失败。" |
| 670 | 默认值使用硬编码中文 | medium | "未找到匹配内容。" |
| 694 | 默认值使用硬编码中文 | medium | "未找到匹配内容。" |
| 713 | 默认值使用硬编码中文 | medium | "未找到匹配文件。" |
| 732 | 默认值使用硬编码中文 | medium | "未找到匹配文件。" |
| 767 | 默认值使用硬编码中文 | medium | ");   const truncated = fullText.length > BASH_PREVIEW_LIMIT;   const preview = ... |
| 1082 | 默认值使用硬编码中文 | medium | ") {     if (context.todos.length >= MAX_TODO_ITEMS) {       throw new Error(`To... |
| 1139 | 默认值使用硬编码中文 | medium | "本轮暂无工具写入改动。" |
| 1163 | 默认值使用硬编码中文 | medium | "路径不能为空。建议：传入工作区内相对路径。" |
| 1167 | 默认值使用硬编码中文 | medium | " && target !== resolve(workspaceRoot))) {     throw new Error(`路径越界：${inputPath... |
| 1179 | 默认值使用硬编码中文 | medium | "oldText 不能为空。建议：提供足够上下文的唯一片段。" |
| 1183 | 默认值使用硬编码中文 | medium | "未找到 oldText。建议：先 Read 文件确认最新内容。" |
| 1218 | 默认值使用硬编码中文 | medium | " };   }   const rel = relativePath(context.workspaceRoot, filePath);   if (expe... |
| 1227 | 默认值使用硬编码中文 | medium | ", beforeHash: before.hash };   }   const snapshot = context.readSnapshots?.[rel... |
| 1262 | 默认值使用硬编码中文 | medium | ",   filePath: string,   before: string,   after: string,   readGuard: EditReadG... |
| 1278 | 默认值使用硬编码中文 | medium | ",     `- 换行：${newlineBefore} -> ${newlineAfter}`,     " |
| 1296 | 默认值使用硬编码中文 | medium | ",     },     changedFiles: [rel],   }; }  function createPatchSummary(changedFi... |
| 1618 | 默认值使用硬编码中文 | medium | ");   let result = `^${escaped}$`;   // D.14H Phase 7.5-C：**/ 开头的 pattern 应同时匹配根... |
| 1678 | void Promise(潜在rejection) | medium | void requestStop(true) |
| 1682 | 默认值使用硬编码中文 | medium | "\n工具调用已取消，正在终止子进程。" |
| 1689 | void Promise(潜在rejection) | medium | void requestStop(false) |
| 1692 | 默认值使用硬编码中文 | medium | ");     };     const timer = setTimeout(() => {       void handleTimeout();     ... |
| 1695 | void Promise(潜在rejection) | medium | void handleTimeout() |
| 1705 | void Promise(潜在rejection) | medium | void requestStop(false) |
| 1714 | 默认值使用硬编码中文 | medium | ", onAbort, { once: true });      // D.14H Phase 7.5-C：Windows 控制台输出可能为 GBK/GB18... |
| 1735 | 默认值使用硬编码中文 | medium | ", (error) => {       finish(1, `命令执行失败：${error.message}`);     });   }); }  fun... |
| 1842 | 默认值使用硬编码中文 | medium | ", finishStop);   }); }  function findTodo(items: TodoItem[], id: string): TodoI... |

### packages/tui/src/architecture-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 30 | 默认值使用硬编码中文 | medium | " > & {   projectFacts: string[]; };  export type ArchitectureNextAction = {   t... |
| 154 | 默认值使用硬编码中文 | medium | "先在主屏给出 1-2 行行动摘要，完整 Architecture Card 仅保留在内部记录；再按现有 Start Gate、Plan、权限和工具链路做最小分... |
| 156 | 默认值使用硬编码中文 | medium | "不把 Architecture Runtime 变成第五权限模式、agent、ADR DB 或完整 spec 平台。" |
| 157 | 默认值使用硬编码中文 | medium | "不为小修、状态查询或简单解释强制进入 Plan。" |
| 160 | 默认值使用硬编码中文 | medium | "确认目标、证据和 nonGoals。" |
| 161 | 默认值使用硬编码中文 | medium | "按最小影响面分阶段修改。" |
| 162 | 默认值使用硬编码中文 | medium | "执行 focused verification，并在 drift 时要求用户确认或更新 card。" |
| 165 | 默认值使用硬编码中文 | medium | "项目事实不足时只能标记 unknown/stale，不能把模型记忆当当前事实。" |
| 166 | 默认值使用硬编码中文 | medium | "后续动作可能扩散到未提及模块、依赖或配置，需要 drift check。" |
| 169 | 默认值使用硬编码中文 | medium | "运行与改动范围匹配的最小 focused tests/typecheck。" |
| 170 | 默认值使用硬编码中文 | medium | "涉及主链路或多文件改动时保留 verifier/复检，不由 Architecture Runtime 替代。" |
| 173 | 默认值使用硬编码中文 | medium | "不改变 default/auto-review/plan/full-access 四权限模式。" |
| 174 | 默认值使用硬编码中文 | medium | "不绕过 Start Gate、permission pipeline 或 Plan approval。" |
| 175 | 默认值使用硬编码中文 | medium | "不新增未确认的依赖、配置、agent、DB 或长期 memory。" |
| 176 | 默认值使用硬编码中文 | medium | "不替代 Freshness/Web Evidence、Verification Runner 或 verifier。" |
| 192 | 默认值使用硬编码中文 | medium | "); }  export function summarizeArchitectureCard(card: ArchitectureCard): Archit... |
| 214 | 默认值使用硬编码中文 | medium | "主屏只输出 1-2 行面向用户的行动摘要；不要把 Architecture Card、字段名或内部审计结构输出到主屏。" |
| 215 | 默认值使用硬编码中文 | medium | "后续动作必须保持与该 card 一致；完整 Architecture Card 仅用于内部记录、details/debug 或验证。" |
| 216 | 默认值使用硬编码中文 | medium | "Architecture Runtime 不授权写入、不改变权限模式、不替代 Plan approval、Freshness/Web Evidence 或 v... |
| 217 | 默认值使用硬编码中文 | medium | "Maturity defaults: 默认要求成熟方案：信息架构清晰、响应式布局、状态/空态/错误态/加载态完整、可读性优先、语义化结构。避免卡片流水席、营销... |
| 218 | 默认值使用硬编码中文 | medium | "Anti code blob: 新功能、新页面、新流程、长任务、UI 开发、跨文件改动时，默认不把逻辑堆进已有巨型文件。避免 god file、code bl... |
| 219 | 默认值使用硬编码中文 | medium | "Legacy large file debt: 已知历史债：packages/tui/src/index.ts 属 legacy-large-file。老项目... |
| 220 | 默认值使用硬编码中文 | medium | "Long task hint: 若任务涉及多步骤或预计超过 3 轮工具调用，主动提示用户可用 /autopilot 或 /plan 进入托管/规划模式，但不强... |
| 246 | 默认值使用硬编码中文 | medium | ")}).`,     );   }    if (     nextAction.skipVerification \|\|     /skip\s+(test\|... |
| 312 | 默认值使用硬编码中文 | medium | ",   ); }  function requiresFreshnessEvidence(value: string): boolean {   return... |
| 359 | 默认值使用硬编码中文 | medium | "].includes(toolName) \|\|     /写入\|修改\|删除\|新增\|edit\|write\|delete/.test(actionText)   ... |
| 379 | 默认值使用硬编码中文 | medium | ").toLowerCase(); }  function treatsUnknownOrStaleAsFact(card: ArchitectureCard,... |
| 399 | 默认值使用硬编码中文 | medium | "));   return /\.md$/.test(file) && /report\|报告/.test([cardText, fileName].join(" |

### packages/tui/src/background-control-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 45 | 默认值使用硬编码中文 | medium | ";  // -------------------------------------------------------------------------... |
| 96 | 默认值使用硬编码中文 | medium | ";       task.updatedAt = new Date(now).toISOString();       task.userVisibleSum... |
| 100 | 默认值使用硬编码中文 | medium | "           ? `Open /details background ${task.id}, inspect logs, or use /interr... |
| 111 | 默认值使用硬编码中文 | medium | " 或第五权限。 // - 测试在 docs/delivery/phase-13V-* 与 D13T audit 已记录；此常量是源码级断言锚点。 export... |
| 123 | 默认值使用硬编码中文 | medium | "并发上限：已有前台模型请求正在运行；请等待完成或使用 /interrupt 取消后再继续。这是 resource/concurrency cap，不是权限拒绝... |
| 142 | 默认值使用硬编码中文 | medium | ",     );     return heavy       ? `并发上限：已有 ${heavy.kind} 重任务正在运行。请等待完成、查看 /back... |
| 163 | 默认值使用硬编码中文 | medium | ", ignoreTaskId) : null)   ); }  // Module 4 — rememberBackgroundTask 已移至 ./tui-... |
| 205 | 默认值使用硬编码中文 | medium | "命令已完成；完整输出已写入日志。" |
| 206 | 默认值使用硬编码中文 | medium | "         ? `Command ended with ${task.status}; do not claim it passed.`        ... |
| 213 | 默认值使用硬编码中文 | medium | "可查看摘要输出或打开完整日志。" |
| 216 | 默认值使用硬编码中文 | medium | "先查看日志并修复问题，必要时重跑。" |
| 293 | 默认值使用硬编码中文 | medium | "选中的后台任务当前未运行。" |
| 332 | 默认值使用硬编码中文 | medium | "已发送取消信号。继续前可先查看 /background 和日志。" |
| 335 | 默认值使用硬编码中文 | medium | "未找到可用取消 controller；已标记为 stale/resumable。" |
| 340 | 默认值使用硬编码中文 | medium | "         ? `Stopped ${task.title}.`         : `已停止 ${task.title}。`       : cont... |
| 343 | 默认值使用硬编码中文 | medium | "         ? `${task.title} has no live abort controller; marked stale.`         ... |
| 375 | 默认值使用硬编码中文 | medium | "       ? `Interrupt requested for ${result.cancelled} active item(s); abort sig... |
| 421 | 默认值使用硬编码中文 | medium | "先查看验证日志，必要时复跑 /verify。" |
| 442 | 默认值使用硬编码中文 | medium | "临时插问已取消。" |
| 464 | 默认值使用硬编码中文 | medium | "Workflow 已由中断取消；重跑前请先查看 /workflows status。" |
| 503 | 默认值使用硬编码中文 | medium | "已发送取消信号。继续前可先查看 /background 和日志。" |
| 506 | 默认值使用硬编码中文 | medium | "未找到可用取消 controller；已标记为 stale/resumable。" |

### packages/tui/src/break-cache-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 21 | 默认值使用硬编码中文 | medium | "); }  function getBreakCacheOncePath(context: TuiContext): string {   return jo... |
| 47 | 默认值使用硬编码中文 | medium | ", nonce: nonce \|\| undefined };     }   } catch {     // 静默降级到 off；marker 不可读不应阻... |
| 66 | 默认值使用硬编码中文 | medium | ") {           events.push({ action: parsed.action, createdAt: parsed.createdAt ... |
| 137 | 默认值使用硬编码中文 | medium | ") targets.push(getBreakCacheAlwaysPath(context));   for (const target of target... |
| 167 | 默认值使用硬编码中文 | medium | ";     cacheBreakNonce?: string;   }>;   paths: (projectPath: string) => {     o... |
| 201 | 默认值使用硬编码中文 | medium | " as const } : {}),       ...(nonce ? { cacheBreakNonce: nonce } : {}),     };  ... |
| 228 | 默认值使用硬编码中文 | medium | ");   }   return nonce; }  // D.13F：把 promptCache 配置 + 当轮 nonce 折叠成 ModelRequest... |
| 245 | 默认值使用硬编码中文 | medium | " as const } : {}),     ...(nonce ? { cacheBreakNonce: nonce } : {}),   }; }  //... |
| 278 | 默认值使用硬编码中文 | medium | "（固定 break-cache namespace；不会每次请求都破坏缓存）" |
| 281 | 默认值使用硬编码中文 | medium | "- usage: /break-cache status \| once \| always \| off \| --clear；marker 与 event 仅记录... |
| 282 | 默认值使用硬编码中文 | medium | "- suggestion: 如 system prompt / tool schema / MCP list / model/provider / memor... |

### packages/tui/src/btw-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 10 | 默认值使用硬编码中文 | medium | "发起隔离单轮请求并提取纯文本答案" |
| 33 | 默认值使用硬编码中文 | medium | "你正在以「临时插问」(side question) 身份回答一个独立的小问题。这是一个隔离的单轮请求：" |
| 34 | 默认值使用硬编码中文 | medium | "不要假设你能看到主任务的完整上下文，不要调用任何工具，不要声称已完成/已验证/已修复任何主任务，" |
| 35 | 默认值使用硬编码中文 | medium | "不要修改任何状态。直接、简洁地回答这个问题即可。如果需要主任务上下文才能回答，请说明这一点。" |
| 41 | 默认值使用硬编码中文 | medium | ";  /**  * 把 side-question 问题包成隔离的 system+user 消息对。不注入 RuntimeStatusForModel /  ... |
| 66 | 默认值使用硬编码中文 | medium | "; }  /**  * 纯函数：把累计的文本、是否有 thinking、是否 provider 报错，归一成 BtwSideQuestionResult。  ... |
| 71 | 默认值使用硬编码中文 | medium | "等分支，不需要真实 provider。  */ export function extractBtwResult(   collected: { text: ... |
| 82 | 默认值使用硬编码中文 | medium | ", answer };   }   // 空响应（只有 thinking / 无内容）：给可见的降级文案，不冒充答案。   const emptyHint =... |
| 91 | 默认值使用硬编码中文 | medium | "模型只产生了内部思考，没有可见回答。可以换个说法再问一次这个临时问题。" |
| 92 | 默认值使用硬编码中文 | medium | "模型返回了空响应。可以重试或换个说法再问这个临时问题。" |
| 93 | 默认值使用硬编码中文 | medium | ", error: emptyHint }; }  /**  * 发起隔离单轮 side-question 请求。无工具、无 continuation、不记录 ... |
| 100 | 默认值使用硬编码中文 | medium | "；成功返回 status:" |
| 110 | 默认值使用硬编码中文 | medium | ";   let hadThinking = false;   let providerError: string \| undefined;   try {  ... |
| 129 | 默认值使用硬编码中文 | medium | "临时插问已取消。" |

### packages/tui/src/cache-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 9 | 默认值使用硬编码中文 | medium | "; const DEFAULT_LIGHT_HINT_COOLDOWN_MS = 5 * 60 * 1000; const MAX_LIGHT_HINTS_P... |
| 28 | 默认值使用硬编码中文 | medium | "缓存 · 尚无样本" |
| 39 | 默认值使用硬编码中文 | medium | "命中率偏低 — 可运行 /cache warmup 或核对 provider usage。" |
| 53 | 默认值使用硬编码中文 | medium | "最近缓存日志为空。真实 usage 需要 provider 返回 token/cache 字段；可用 /cache warmup 尝试预热。" |
| 79 | 默认值使用硬编码中文 | medium | "provider 当前返回 cache_creation/cache write 为 0；这只是字段口径，不代表零写入成本。" |
| 81 | 默认值使用硬编码中文 | medium | "provider 未返回 cache_creation/cache write 字段；不支持真实缓存写入统计。" |
| 82 | 默认值使用硬编码中文 | medium | "cache write/create 字段来自 provider/API usage。" |
| 84 | 默认值使用硬编码中文 | medium | ",     `- history: ${context.cache.history.length}/${context.cache.config.maxTur... |
| 161 | 默认值使用硬编码中文 | medium | "最近一轮复用效果变低" |
| 174 | 默认值使用硬编码中文 | medium | "这轮对话较长；如果开始变慢，再按需压缩" |
| 187 | 默认值使用硬编码中文 | medium | "要下成本结论前，建议先核对用量口径" |
| 205 | 默认值使用硬编码中文 | medium | "项目上下文有变化；结果像旧信息时再刷新复用数据" |
| 215 | 默认值使用硬编码中文 | medium | ",   priority: number,   message: string,   suggestedCommand: string, ): LightHi... |
| 267 | 默认值使用硬编码中文 | medium | "最近缓存复用变低，后续响应可能会慢一点。" |
| 271 | 默认值使用硬编码中文 | medium | "这轮对话较长；如果开始变慢，再按需压缩。" |
| 275 | 默认值使用硬编码中文 | medium | "用量数据可能需要复核后再下结论。" |
| 279 | 默认值使用硬编码中文 | medium | "项目上下文有变化；结果像旧信息时再刷新。" |

### packages/tui/src/cache-freshness.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 17 | 默认值使用硬编码中文 | medium | ")}}`;   }   return JSON.stringify(value) ?? String(value); }  export function c... |
| 34 | 默认值使用硬编码中文 | medium | " 处理，保持向后兼容。   endpointProfile?: unknown;   cacheControl?: unknown;   cacheTtl?:... |
| 40 | 默认值使用硬编码中文 | medium | " 处理，保持向后兼容。   contextEditing?: unknown;   cacheEditingBeta?: unknown;   // D.13... |
| 46 | 默认值使用硬编码中文 | medium | " 处理。   deferredToolList?: unknown;   _precomputedToolSchemaHash?: string; }): C... |

### packages/tui/src/capability-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 294 | 默认值使用硬编码中文 | medium | "- 运行时：Capability Runtime；mock provider 全局可用，Local HTTP connector 按项目隔离。" |
| 326 | 默认值使用硬编码中文 | medium | "详情：/capabilities doctor" |
| 340 | 默认值使用硬编码中文 | medium | "Artifact ref 已记录；需要时看 details。" |
| 343 | 默认值使用硬编码中文 | medium | "未创建 artifact。" |
| 347 | 默认值使用硬编码中文 | medium | "Capability execution 不等于验证通过。" |
| 350 | 默认值使用硬编码中文 | medium | "Capability failed；失败不等于验证通过。" |
| 404 | 默认值使用硬编码中文 | medium | "用法：/capabilities run <capabilityId> <json>" |
| 428 | 默认值使用硬编码中文 | medium | "用法：/capabilities list \| /capabilities doctor \| /capabilities run <capabilityId>... |

### packages/tui/src/command-panel-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 4 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX Task Surface Maturity Sweep — 通用 CommandPanel 设置器。  *  * 高级 ... |
| 18 | 默认值使用硬编码中文 | medium | "的关键状态填进 panel；guard / runtime / binary /  * source / version / schemaLoaded / t... |
| 34 | 默认值使用硬编码中文 | medium | ";   const hasOutput = Boolean(context.lastFullOutput);   const hasCompact = Boo... |
| 51 | 默认值使用硬编码中文 | medium | ",   ];    // ── 分区 1：最近输出（完整正文只进 detailsText）──────────────────────────   if (c... |
| 61 | 默认值使用硬编码中文 | medium | "})`           : `1 条最近输出（${lineCount} 行）`,       ],     });     detailsParts.pu... |
| 65 | 默认值使用硬编码中文 | medium | "## 最近输出（完整正文）" |
| 75 | 默认值使用硬编码中文 | medium | "} captured.`           : `已记录 ${evidenceCount} 条证据。`,       ],     });     deta... |
| 80 | 默认值使用硬编码中文 | medium | ");     for (const e of context.evidence.slice(0, 8)) {       detailsParts.push(... |
| 96 | 默认值使用硬编码中文 | medium | ").length;     const others = backgroundCount - running - failed;     const part... |
| 107 | 默认值使用硬编码中文 | medium | ");     for (const t of context.backgroundTasks.slice(0, 8)) {       detailsPart... |
| 128 | 默认值使用硬编码中文 | medium | "}`             : `最近压缩 ${projection.createdAt}；pairing ${projection.toolPairing... |
| 132 | 默认值使用硬编码中文 | medium | "没有成功的 compact projection" |
| 139 | 默认值使用硬编码中文 | medium | "没有 compact 失败冷却" |
| 205 | 默认值使用硬编码中文 | medium | "最近一次输出可展开。" |
| 210 | 默认值使用硬编码中文 | medium | "}.`         : `证据 ${evidenceCount} 条。`,     );   }   if (backgroundCount > 0) {... |
| 217 | 默认值使用硬编码中文 | medium | "}.`         : `后台任务 ${backgroundCount} 条。`,     );   }   if (hasCompact) {     ... |
| 222 | 默认值使用硬编码中文 | medium | "上下文压缩状态可查看。" |
| 234 | 默认值使用硬编码中文 | medium | "),     // D.14D — 默认折叠：主屏只显示 summary + 分区计数，panel 内显式展开     // detailsText（含 id... |

### packages/tui/src/compact-cache-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 116 | 默认值使用硬编码中文 | medium | "用法：/claim-check <claim>" |
| 137 | 默认值使用硬编码中文 | medium | ", 10);     if (!Number.isFinite(size) \|\| size < MIN_CACHE_HISTORY_SIZE) {      ... |
| 194 | 默认值使用硬编码中文 | medium | ", ...evidence });     writeLine(       output,       `已导出最近缓存日志：${path}。用于和 pro... |
| 214 | 默认值使用硬编码中文 | medium | ") {     // D.13Q-UX Task Surface — /cache 默认走降噪 CommandPanel。     showCommandPa... |
| 230 | 默认值使用硬编码中文 | medium | "         ? `已尝试预热 cache。workspace reference ${snapshot.source}；该最小路径不保证 provide... |
| 259 | 默认值使用硬编码中文 | medium | "Deep compact 不可用：模型网关尚未就绪。" |
| 268 | 默认值使用硬编码中文 | medium | ",       gateway: context.modelGateway,       deps: compactPreflightDeps.runDeep... |
| 287 | 默认值使用硬编码中文 | medium | "Compact auto：provider 压力触发时先尝试 deep compact agent（full transcript semantic comp... |
| 291 | 默认值使用硬编码中文 | medium | "用法：/compact status \| /compact manual \| /compact deep \| /compact auto" |
| 341 | 默认值使用硬编码中文 | medium | ";   // D.13F：standalone /break-cache 子命令。marker 写入与 event log 全部在 TUI/runtime 层... |
| 379 | 默认值使用硬编码中文 | medium | "用法：/break-cache status \| /break-cache once \| /break-cache always \| /break-cache... |
| 437 | 默认值使用硬编码中文 | medium | "         ? `Permission blocked break-cache ${action}: ${permission.reason}`    ... |
| 455 | 默认值使用硬编码中文 | medium | ") {     // /break-cache --clear 或 /break-cache <mode> --clear：清掉 once+always 两个... |
| 460 | 默认值使用硬编码中文 | medium | "已清除 break-cache marker（once + always）。下次请求不再附加 nonce。" |
| 469 | 默认值使用硬编码中文 | medium | "已设置 once：下一次模型请求将附加 cacheBreakNonce 破坏前缀缓存，命中后自动消费。" |
| 478 | 默认值使用硬编码中文 | medium | "已设置 always：固定 break-cache namespace（stable nonce），所有请求共享同一 cacheBreakNonce，相当于切... |
| 484 | 默认值使用硬编码中文 | medium | "已关闭 break-cache：下次请求不再附加 nonce。" |
| 611 | 默认值使用硬编码中文 | medium | "         ? `Permission blocked memory ${mutation.action}: ${permission.reason}`... |
| 793 | 默认值使用硬编码中文 | medium | ",     },     plugins: {       ...createExtensionFreshnessSummary(context),     ... |
| 802 | 默认值使用硬编码中文 | medium | ",     cacheTtl: context.config.promptCache.systemTtl,     // D.13I：deferred too... |

### packages/tui/src/compact-preflight-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 102 | 默认值使用硬编码中文 | medium | "上一次上下文压缩失败后仍在冷却中。我不会把超压的半截上下文继续发给 provider；请稍后重试或运行 /compact status 查看。" |
| 131 | 默认值使用硬编码中文 | medium | "当前上下文已超过 provider 上限，但存在未闭合 tool pair，压缩不安全。本次 provider 请求已阻断。" |
| 190 | 默认值使用硬编码中文 | medium | "上下文压缩摘要后仍超过 provider 上限，本次请求已阻断。" |
| 204 | 默认值使用硬编码中文 | medium | "上下文压缩后的 tool pairing 边界不安全，本次 provider 请求已阻断。" |
| 220 | 默认值使用硬编码中文 | medium | "上下文压缩失败，本次 provider 请求已阻断，不会拿半截上下文继续运行。" |

### packages/tui/src/connector-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 171 | 默认值使用硬编码中文 | medium | "Apps\n- 尚未连接 app。" |
| 182 | 默认值使用硬编码中文 | medium | "Apps doctor\n- 尚未连接 app。" |
| 231 | 默认值使用硬编码中文 | medium | "用法：/apps connect <manifestPath>" |
| 248 | 默认值使用硬编码中文 | medium | "用法：/apps disconnect <appId>" |
| 257 | 默认值使用硬编码中文 | medium | "用法：/apps list \| /apps connect <manifestPath> \| /apps doctor \| /apps disconnect ... |

### packages/tui/src/deep-compact-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 462 | 默认值使用硬编码中文 | medium | ":       if (         /fail\|failure\|failed\|compact\|cooldown\|risk\|decision\|scope\|... |
| 499 | 默认值使用硬编码中文 | medium | "]>(   transcript: TranscriptEvent[],   type: T, ): Extract<TranscriptEvent, { t... |
| 729 | 默认值使用硬编码中文 | medium | "Deep compact 不可用：模型网关尚未就绪。" |
| 733 | 默认值使用硬编码中文 | medium | "Deep compact 已跳过：transcript 压力未达到触发线。" |
| 737 | 默认值使用硬编码中文 | medium | "上一次 deep compact 失败后仍在冷却中。" |
| 741 | 默认值使用硬编码中文 | medium | "Deep compact 失败：compact agent 在禁用工具时尝试了 tool_use。" |
| 746 | 默认值使用硬编码中文 | medium | "Deep compact 在 provider 请求前失败。" |

### packages/tui/src/deferred-tools-catalog.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 6 | 默认值使用硬编码中文 | medium | ";  // D.13J Block 3 — codebase-memory 工具 risk 分层。 // readonly = 只读查询，无 session ... |
| 27 | 默认值使用硬编码中文 | medium | "; }  export function validateCodebaseMemoryToolExecution(   tool: string,   inp... |
| 42 | 默认值使用硬编码中文 | medium | ",   );   if (missing && missing.length > 0) {     return {       ok: false,    ... |
| 47 | 默认值使用硬编码中文 | medium | ")}。已拒绝盲执行。`,     };   }   return { ok: true }; }  // ==========================... |
| 123 | 默认值使用硬编码中文 | medium | ")     .filter((tool) => tool.schemaLoaded === true)     .filter((tool) => tool.... |
| 141 | 默认值使用硬编码中文 | medium | ",       };     })     .sort((a, b) => a.name.localeCompare(b.name)); }  // D.13... |
| 175 | 默认值使用硬编码中文 | medium | ",     }))     .sort((a, b) => a.name.localeCompare(b.name)); }  // D.13J Block ... |
| 181 | 默认值使用硬编码中文 | medium | "纯 metadata" |
| 241 | 默认值使用硬编码中文 | medium | ": 0,     mcp: 0,     skill: 0,     plugin: 0,   };   let executableCount = 0;  ... |
| 277 | 默认值使用硬编码中文 | medium | "了哪些工具。但只能输出" |
| 277 | 默认值使用硬编码中文 | medium | "—— // 不能输出 raw 参数、不能透出 secret，因为发现集合里有可能包含将来引入的非 codebase-memory 工具名。 // // san... |
| 281 | 默认值使用硬编码中文 | medium | " //   - 长度上限 80；超长直接截断（避免日志爆炸） //   - 总数上限 32；超过则按字典序保留前 32 项 + 一个 " |
| 283 | 默认值使用硬编码中文 | medium | " 提示位 export type DiscoveredDeferredToolsSummary = {   total: number;   names: s... |
| 294 | 默认值使用硬编码中文 | medium | "，避免在 doctor 输出里出现奇怪字符。   const cleaned = name.replace(/[^A-Za-z0-9_:.\-]/g, " |
| 320 | 默认值使用硬编码中文 | medium | ") return tools;   return tools.filter((tool) => {     const haystack = `${tool.... |
| 354 | 默认值使用硬编码中文 | medium | "; }  export function isCodebaseMemoryToolName(name: string): boolean {   return... |

### packages/tui/src/details-status-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 25 | 默认值使用硬编码中文 | medium | ";  // Module 4 — upsertJobBackgroundTask / createJobBackgroundTask / // toJobCo... |
| 38 | 默认值使用硬编码中文 | medium | "上一次的 /details 总览" |
| 60 | 默认值使用硬编码中文 | medium | "未找到 evidence。用法：/details evidence <id>" |
| 70 | 默认值使用硬编码中文 | medium | "未找到 background。用法：/details background <id>" |
| 82 | 默认值使用硬编码中文 | medium | "未找到 output。用法：/details output <backgroundId\|evidenceId> --tail [lines] \| --grep... |
| 106 | 默认值使用硬编码中文 | medium | "未找到 output。用法：/details output <backgroundId\|evidenceId>" |
| 113 | 默认值使用硬编码中文 | medium | "用法：/details \| /details evidence <id> \| /details background <id> \| /details outp... |
| 122 | 默认值使用硬编码中文 | medium | "当前没有可展开的完整内容。" |
| 140 | 默认值使用硬编码中文 | medium | ");   }   return [     `项目 ${project} · 模型 ${model} · 模式 ${mode}`,     " |
| 145 | 默认值使用硬编码中文 | medium | "需要精确命令时，用 /help 查看。" |
| 269 | 默认值使用硬编码中文 | medium | ",     sessionId,     createdAt: new Date().toISOString(),   }; }  /**  * Test-o... |
| 305 | 默认值使用硬编码中文 | medium | ").CommandPanelView \| undefined {   return buildExplicitDetailsCommandPanel(cont... |

### packages/tui/src/evidence-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 80 | 默认值使用硬编码中文 | medium | "       ? `\n\n[... ${omitted} characters omitted — full output preserved in art... |
| 254 | 默认值使用硬编码中文 | medium | "       ? `Architecture audit recorded: ${card.projectFacts.length} fact(s), ${c... |
| 318 | 默认值使用硬编码中文 | medium | ",     summary: `${formatVerificationEvidenceStatusSummary(report)} 日志：${report.... |

### packages/tui/src/extension-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 65 | 默认值使用硬编码中文 | medium | "配置概览（一站式只读）" |
| 72 | 默认值使用硬编码中文 | medium | "- 记忆：用 /memory、/memory storage、/memory review、/memory learn" |
| 80 | 默认值使用硬编码中文 | medium | "下一步：直接输入对应 slash 进入；用 /features 查看默认功能策略，用 /help all 查看完整命令表。" |
| 143 | 默认值使用硬编码中文 | medium | "- none：可运行 /skills add 查看注册路径，或 /skills install local <path> 安装本地 skill manifes... |
| 153 | 默认值使用硬编码中文 | medium | "- note: 默认只加载 metadata/description/triggers/stable summary；不会把 skill 正文塞进 promp... |
| 180 | 默认值使用硬编码中文 | medium | "Workflows（本地模板与真实 runner 入口）" |
| 187 | 默认值使用硬编码中文 | medium | "- preview: /workflows plan <goal> 只生成预览，不执行。" |
| 190 | 默认值使用硬编码中文 | medium | "- run: /workflows run <goal> 复用 durable job runner，写入真实 task/transcript/report。... |
| 193 | 默认值使用硬编码中文 | medium | "- gate: /workflows <name> 只进入启动确认说明；写文件/Bash/联网/安装依赖仍走权限管道。" |
| 199 | 默认值使用硬编码中文 | medium | "Plugins（本地 manifest loader）" |
| 209 | 默认值使用硬编码中文 | medium | "- none：把本地 manifest 放到 project/user plugins 目录，或运行 /plugins install local <path... |
| 217 | 默认值使用硬编码中文 | medium | "- note: plugin 贡献项稳定排序；贡献工具仍走统一权限管道，加载失败隔离。" |
| 232 | 默认值使用硬编码中文 | medium | "- boundary: 不执行远程安装/自动更新/完整沙箱；未信任 extension 不得写文件、联网或执行命令。" |
| 240 | 默认值使用硬编码中文 | medium | "}（默认关闭）`,     `- project trusted: ${context.hooks.projectTrusted ? " |
| 255 | 默认值使用硬编码中文 | medium | "- boundary: hook 诊断只检查来源、边界和可见状态，不执行完整 hook 脚本；hook 不能绕过权限系统；失败隔离；显示输出按 outputL... |
| 261 | 默认值使用硬编码中文 | medium | ",   item: SkillSummary \| PluginSummary, ): string {   return [     `Trust notic... |
| 275 | 默认值使用硬编码中文 | medium | "- 未信任 extension 不得写文件、联网或执行命令；实际工具调用仍走权限管道。" |
| 296 | 默认值使用硬编码中文 | medium | "- boundary: Git/GitHub 安装只做受控 clone/fetch 和 manifest/SKILL.md 读取；不执行 postinstal... |
| 367 | 默认值使用硬编码中文 | medium | "- risk: network + third-party extension metadata; install 前只读取 manifest / SKILL... |
| 368 | 默认值使用硬编码中文 | medium | "- boundary: 不执行仓库脚本、postinstall、hook、依赖安装或任意第三方代码。" |
| 369 | 默认值使用硬编码中文 | medium | "- recovery: 失败不会覆盖已有启用项；可运行 status/doctor 查看来源、加载错误和下一步。" |
| 370 | 默认值使用硬编码中文 | medium | "- permission: --confirm-network 是 exact-command Start Gate confirmation，不是完整 pe... |
| 423 | 默认值使用硬编码中文 | medium | "GitHub repo 格式应为 owner/repo，或使用完整 Git URL。" |
| 432 | 默认值使用硬编码中文 | medium | ", cloneArgs, context.projectPath, 60_000);     if (clone.exitCode !== 0) {     ... |
| 501 | 默认值使用硬编码中文 | medium | ");   return {     ok: true,     id,     summary: `已安装 ${kind === " |
| 505 | 默认值使用硬编码中文 | medium | "} manifest：${id}`,   }; }  export async function readExtensionSourceManifest(  ... |
| 527 | 默认值使用硬编码中文 | medium | ").catch(() => null);     if (!content) {       continue;     }     try {       ... |
| 565 | 默认值使用硬编码中文 | medium | "未找到 manifest.json / metadata.json / skill.json / plugin.json；skill 可提供 SKILL.md... |
| 587 | 默认值使用硬编码中文 | medium | "       ? context.skills.skills.find((skill) => skill.id === id)       : context... |
| 591 | 默认值使用硬编码中文 | medium | "}：${id}`;   }   await rm(item.path, { force: true });   context.config = await ... |
| 596 | 默认值使用硬编码中文 | medium | "}：${id}；若需要恢复，请从原 source 重新 install。`; }  export async function updateExtension... |
| 607 | 默认值使用硬编码中文 | medium | "       ? context.skills.skills.find((skill) => skill.id === id)       : context... |
| 621 | 默认值使用硬编码中文 | medium | " && !request.confirmNetwork) {     return formatExtensionInstallGate(kind, requ... |
| 637 | 默认值使用硬编码中文 | medium | " ? context.skills.skills : context.plugins.plugins;   const selected = id ? ite... |
| 641 | 默认值使用硬编码中文 | medium | "}：${id}`       : `没有已发现的 ${kind} manifest。`;   }   return [     `${kind === " |
| 666 | 默认值使用硬编码中文 | medium | "       ? context.skills.skills.find((skill) => skill.id === id)       : context... |
| 687 | 默认值使用硬编码中文 | medium | ") {     return {       ok: false,       summary: `Connect Lite guard: ${kind}:$... |

### packages/tui/src/extension-slash-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 41 | 默认值使用硬编码中文 | medium | ");   }   return runtimeDeps; }  export async function handleSkillsCommand(   ar... |
| 59 | 默认值使用硬编码中文 | medium | ",       summary: [         isEn           ? `Skills · ${total} total · ${enable... |
| 79 | 默认值使用硬编码中文 | medium | ") {     // D.14D-E — /skills doctor 走降噪 CommandPanel：完整校验进 detailsText。     sho... |
| 87 | 默认值使用硬编码中文 | medium | "技能诊断 — Ctrl+O 查看详情。" |
| 105 | 默认值使用硬编码中文 | medium | "- install 前只读取 manifest / SKILL.md / metadata；不执行第三方代码。" |
| 132 | 默认值使用硬编码中文 | medium | ") {     // D.14D-E — /skills validate 走降噪 CommandPanel：完整校验进 detailsText。     s... |
| 140 | 默认值使用硬编码中文 | medium | "技能校验 — Ctrl+O 查看详情。" |
| 152 | 默认值使用硬编码中文 | medium | "Skill evolution candidates（不会自动启用）" |
| 168 | 默认值使用硬编码中文 | medium | "未找到 skill evolution candidate。用法：/skills evolve reject <id>" |
| 180 | 默认值使用硬编码中文 | medium | ",       );       writeLine(output, `已拒绝 skill evolution candidate：${id}；不会生成或启用... |
| 188 | 默认值使用硬编码中文 | medium | "用法：/skills evolve \| /skills evolve candidate <summary> \| /skills evolve reject ... |
| 194 | 默认值使用硬编码中文 | medium | "用法：/skills evolve candidate <summary>" |
| 207 | 默认值使用硬编码中文 | medium | ",     );     writeLine(       output,       `已创建 skill evolution candidate：${ca... |
| 224 | 默认值使用硬编码中文 | medium | "用法：/skills remove <id>" |
| 244 | 默认值使用硬编码中文 | medium | "用法：/skills update <id> [--ref <ref>] [--confirm-network]" |
| 248 | 默认值使用硬编码中文 | medium | ") {     const id = args[1];     if (!id) {       writeLine(output, `用法：/skills ... |
| 255 | 默认值使用硬编码中文 | medium | ") {       if (!skill) {         writeLine(output, `未知 skill：${id}。请先在本地 manifes... |
| 275 | 默认值使用硬编码中文 | medium | "} skill：${id}（状态写入 .linghun/settings.json，重启后保留）`,     );     return;   }   wri... |
| 281 | 默认值使用硬编码中文 | medium | ",   ); }  export async function handlePluginsCommand(   args: string[],   conte... |
| 298 | 默认值使用硬编码中文 | medium | ",       summary: [         isEn           ? `Plugins · ${total} total · ${enabl... |
| 318 | 默认值使用硬编码中文 | medium | ") {     // D.14D-E — /plugins doctor 走降噪 CommandPanel：完整诊断进 detailsText。     sh... |
| 326 | 默认值使用硬编码中文 | medium | "插件诊断 — Ctrl+O 查看详情。" |
| 344 | 默认值使用硬编码中文 | medium | "- install 前只读取 manifest / metadata；不执行仓库脚本、postinstall、hook 或第三方代码。" |
| 372 | 默认值使用硬编码中文 | medium | ") {     // D.14D-E — /plugins validate 走降噪 CommandPanel：完整校验进 detailsText。     ... |
| 380 | 默认值使用硬编码中文 | medium | "插件校验 — Ctrl+O 查看详情。" |
| 395 | 默认值使用硬编码中文 | medium | "用法：/plugins remove <id>" |
| 415 | 默认值使用硬编码中文 | medium | "用法：/plugins update <id> [--ref <ref>] [--confirm-network]" |
| 419 | 默认值使用硬编码中文 | medium | ") {     const id = args[1];     if (!id) {       writeLine(output, `用法：/plugins... |
| 426 | 默认值使用硬编码中文 | medium | ") {       if (!plugin) {         writeLine(output, `未知 plugin：${id}。请先在本地 manif... |
| 443 | 默认值使用硬编码中文 | medium | "} plugin：${id}（状态写入 .linghun/settings.json，重启后保留）`,     );     return;   }   wr... |

### packages/tui/src/failure-learning-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 57 | 默认值使用硬编码中文 | medium | "} <id>`         : `未找到对应失败学习记录。用法：/failures ${status === " |
| 71 | 默认值使用硬编码中文 | medium | ") {     writeLine(       output,       isEn         ? `Marked failure learning ... |
| 114 | 默认值使用硬编码中文 | medium | "用法：/failures \| /failures list \| /failures resolve <id> \| /failures ignore <id>" |

### packages/tui/src/failure-learning-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 14 | 默认值使用硬编码中文 | medium | "模型请求失败" |
| 18 | 默认值使用硬编码中文 | medium | "最终回答降级" |
| 19 | 默认值使用硬编码中文 | medium | "报告守卫未满足" |
| 20 | 默认值使用硬编码中文 | medium | "并发上限拒绝" |
| 52 | 默认值使用硬编码中文 | medium | "}`       : `失败学习 · 活跃 ${active.length} · 已解决 ${resolved} · 已忽略 ${ignored}${degr... |
| 57 | 默认值使用硬编码中文 | medium | "暂无来自真实失败的活跃教训。" |
| 70 | 默认值使用硬编码中文 | medium | "这些是历史风险提示，不代表问题已修复。" |
| 94 | 默认值使用硬编码中文 | medium | "失败学习（基于事实）" |
| 113 | 默认值使用硬编码中文 | medium | "- 无；教训只来自真实失败事件（provider/tool/verification/git/final-gate/report-guard/resource... |
| 122 | 默认值使用硬编码中文 | medium | "根因(推断)" |
| 131 | 默认值使用硬编码中文 | medium | "说明：根因为基于证据的推断，不是确认事实；当作风险提示，不代表已修复。真正修复后用 /failures resolve <id>；不再关注用 /failure... |

### packages/tui/src/failure-learning-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 4 | 默认值使用硬编码中文 | medium | "模型自我反思小作文" |
| 33 | 默认值使用硬编码中文 | medium | ";  const MAX_FAILURE_RECORDS = 100; const FAILURE_SUMMARY_WIDTH = 200; const AV... |
| 66 | 默认值使用硬编码中文 | medium | ")     .trim(); }  // 关联目标脱敏：命令/工具/provider/git 操作。命令只保留可执行名首词，不暴露完整路径/参数。 expor... |
| 94 | 默认值使用硬编码中文 | medium | "; }  export function getFailureLearningDirectory(projectPath: string, config?: ... |
| 118 | 默认值使用硬编码中文 | medium | ",     message: normalizedMessage,   }); }  export type FailureLearningInput = {... |
| 176 | 默认值使用硬编码中文 | medium | ",   }; }  // 去重合并：相同 dedupeHash 命中已有 active/ignored 记录时，合并 count/lastSeen 并 // ... |
| 199 | 默认值使用硬编码中文 | medium | ";     return { record: existing, isNew: false };   }   state.records.unshift(ca... |
| 289 | 默认值使用硬编码中文 | medium | ")),       );       if (parsed) records.push(parsed);     } catch {       // 坏文件... |

### packages/tui/src/final-answer-gate.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 12 | 默认值使用硬编码中文 | medium | ";  export function needsSolutionCompletenessReportClosure(   context: TuiContex... |
| 38 | 默认值使用硬编码中文 | medium | " };   }   const card = context.currentArchitectureCard;   let driftWarnings: st... |
| 181 | 默认值使用硬编码中文 | medium | ")) &&       /report\|报告\|\.md\b/iu.test([item.summary, item.source, ...item.suppo... |
| 182 | 默认值使用硬编码中文 | medium | ")),   ); }  function hasFinalAnswerReportReference(   evidence: EvidenceRecord[... |
| 197 | 默认值使用硬编码中文 | medium | " &&         /(?:report[\w./\\-]*\.md\|报告文件\|生成的报告\|saved report)/iu.test(event.tex... |
| 221 | 默认值使用硬编码中文 | medium | " ? event.message : event.text;       return blockingStatusPattern.test(text);  ... |
| 231 | 默认值使用硬编码中文 | medium | "),     ) \|\| hasReportWriteEvidence([item])   ); }  export function checkClaimSu... |
| 243 | 默认值使用硬编码中文 | medium | ")         .map((item) => item.phrase),       verdict: createPhase15BetaVerdictS... |
| 251 | 默认值使用硬编码中文 | medium | "等无证据高风险表述     // 做最小匹配；普通低风险文本不误伤。     const nlCheck = detectNaturalLanguageHig... |
| 275 | 默认值使用硬编码中文 | medium | ",     unsupportedClaims: structuredClaims.map((item) => item.phrase),   }; }  /... |
| 282 | 默认值使用硬编码中文 | medium | "）不误伤。 // // D.14H Phase 7.5-C.1：JS 的 \b 是 ASCII 单词边界，CJK 全部是 \W， // \b 包住中文短语永远... |
| 290 | 默认值使用硬编码中文 | medium | ",   },   {     regex: /(?:已完成\|已修复并已验证\|已修复且已验证\|已经完成修复\|已经修复)/iu,     label: " |
| 294 | 默认值使用硬编码中文 | medium | ",   },   {     regex: /已修复/iu,     label: " |
| 298 | 默认值使用硬编码中文 | medium | ",   },   {     regex: /(?:全部通过\|全部完成\|完全通过)/iu,     label: " |
| 302 | 默认值使用硬编码中文 | medium | ",   },   {     regex: /(?:可上线\|可以上线\|达到上线标准)/iu,     label: " |
| 306 | 默认值使用硬编码中文 | medium | ",   },   {     regex: /(?:全部(?:单元)?测试(?:已\|已经)?通过\|所有(?:单元)?测试(?:已\|已经)?通过)/iu,   ... |
| 310 | 默认值使用硬编码中文 | medium | ",   },   // ── English / mixed patterns（保留 \b，避免误伤普通词）──   {     regex: /\b(?:b... |
| 319 | 默认值使用硬编码中文 | medium | ",   },   {     regex: /smoke\s*通过/iu,     label: " |
| 361 | 默认值使用硬编码中文 | medium | ")       : [           `Claim Checker：verdict ${result.verdict.status}；scope ${r... |
| 364 | 默认值使用硬编码中文 | medium | "}；详情用 /details evidence。`,           `Validation：${validation}。`,           `Un... |

### packages/tui/src/git-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 24 | 默认值使用硬编码中文 | medium | ";  /**  * D.13R/D.14G Git / Worktree / Stable Point slash 入口。  *  * 只读路径（不确认）：/... |
| 31 | 默认值使用硬编码中文 | medium | " [--include-untracked]  *   /worktree create <name> [--branch <b>] [--from <ref... |
| 85 | 默认值使用硬编码中文 | medium | ") {     // /checkpoint create 与 /git stable create 同义：先 snapshot 安全垫，再按 git 状态决... |
| 109 | 默认值使用硬编码中文 | medium | "当前目录不是 git 仓库。" |
| 119 | 默认值使用硬编码中文 | medium | "git 不可用，无法读取状态。" |
| 129 | 默认值使用硬编码中文 | medium | "}`       : `分支 ${status.branch ?? " |
| 136 | 默认值使用硬编码中文 | medium | "}`,     );   }   if (dirty) {     summary.push(       isEn         ? `${status.... |
| 196 | 默认值使用硬编码中文 | medium | "}.`       : `建议：将 ${stable.changedCount} 个改动提交为稳定点。`,     isEn       ? `Suggest... |
| 203 | 默认值使用硬编码中文 | medium | "这是只读建议；Linghun 不会自动提交，需要您显式确认。" |
| 209 | 默认值使用硬编码中文 | medium | "已暂存（预览）：" |
| 214 | 默认值使用硬编码中文 | medium | "未暂存（预览）：" |
| 219 | 默认值使用硬编码中文 | medium | "未跟踪（预览）：" |
| 237 | 默认值使用硬编码中文 | medium | "当前目录不是 git 仓库。" |
| 246 | 默认值使用硬编码中文 | medium | "无法读取 git worktree 列表。" |
| 257 | 默认值使用硬编码中文 | medium | "}`       : `共 ${report.entries.length} 个 worktree · 当前：${current?.branch ?? cur... |
| 258 | 默认值使用硬编码中文 | medium | "}`,     isEn       ? `Managed root: ${redactWorktreePath(managedRoot)}`       :... |
| 264 | 默认值使用硬编码中文 | medium | "用 slash 创建/删除受控 worktree；external worktree 仅列出，不允许在此删除。" |
| 299 | 默认值使用硬编码中文 | medium | "暂无 Linghun snapshot checkpoint。Linghun snapshot 是内存文件快照，不是 git commit。" |
| 307 | 默认值使用硬编码中文 | medium | "} (Linghun in-memory snapshots, not git commits).`       : `共 ${checkpoints.len... |
| 311 | 默认值使用硬编码中文 | medium | '需要真实 git 稳定点请用 /checkpoint create " |
| 311 | 默认值使用硬编码中文 | medium | " 或 /git stable create。' |
| 315 | 默认值使用硬编码中文 | medium | "最近 checkpoint" |

### packages/tui/src/git-operation-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 12 | 默认值使用硬编码中文 | medium | "，绝不假成功。  * - 参考 CCB worktree.ts 的产品行为（受控目录、slug 校验、git worktree remove 而非  *   ... |
| 26 | 默认值使用硬编码中文 | medium | ";  // worktree add / commit 比只读探测慢；给更宽的超时，但仍有界，避免挂死。 const GIT_MUTATION_TIMEOUT... |
| 66 | 默认值使用硬编码中文 | medium | " };   }   if (trimmed.length > MAX_STABLE_POINT_MESSAGE_LENGTH) {     return { ... |
| 95 | 默认值使用硬编码中文 | medium | "worktree 名称不能为空。" |
| 104 | 默认值使用硬编码中文 | medium | "worktree 名称不能包含控制字符。" |
| 107 | 默认值使用硬编码中文 | medium | 'worktree 名称不能是 " |
| 107 | 默认值使用硬编码中文 | medium | ' };   }   // 显式拒绝 slash/backslash/盘符，避免 path escape；这些在 VALID_WORKTREE_NAME 之外，... |
| 115 | 默认值使用硬编码中文 | medium | "worktree 名称不能包含盘符或冒号。" |
| 120 | 默认值使用硬编码中文 | medium | "worktree 名称只能包含字母、数字、点、下划线和连字符。" |
| 135 | 默认值使用硬编码中文 | medium | "git ref 不能包含空白或控制字符。" |
| 138 | 默认值使用硬编码中文 | medium | "git ref 不能以 - 开头。" |
| 149 | 默认值使用硬编码中文 | medium | "git ref 含非法字符；只允许字母、数字、点、下划线、斜杠和连字符。" |
| 163 | 默认值使用硬编码中文 | medium | "; }  /**  * managed worktree root = `<repo 父级>/.linghun-worktrees/<repo-slug>`。... |
| 180 | 默认值使用硬编码中文 | medium | ").toLowerCase(); }  function isUnderManagedRoot(repoRoot: string, candidatePath... |
| 201 | 默认值使用硬编码中文 | medium | ")}`; }  // --------------------------------------------------------------------... |
| 220 | 默认值使用硬编码中文 | medium | ");   return SENSITIVE_UNTRACKED_PATTERNS.some((re) => re.test(normalized)); }  ... |
| 243 | 默认值使用硬编码中文 | medium | ").pop() ?? path;     return `${name} (sensitive/ignored)`;   }); }  // --------... |
| 266 | 默认值使用硬编码中文 | medium | "; reason: string };  function uniquePaths(...lists: string[][]): string[] {   c... |
| 310 | 默认值使用硬编码中文 | medium | "工作区干净，没有可提交的改动；未创建空 commit。" |
| 332 | 默认值使用硬编码中文 | medium | ",     };   }    // git 操作以 repo toplevel 为 cwd，使 porcelain 相对路径正确解析。   const to... |
| 358 | 默认值使用硬编码中文 | medium | ",     sha,     subject,     branch: status.branch,     changedCount: toCommit.l... |
| 410 | 默认值使用硬编码中文 | medium | "]);   if (common.ok && common.stdout.trim()) {     // common-dir 形如 <main>/.git... |
| 424 | 默认值使用硬编码中文 | medium | "无法解析 git 仓库根目录。" |
| 442 | 默认值使用硬编码中文 | medium | ", reason: `branch 非法：${branchCheck.reason}` };     }     branch = branchCheck.r... |
| 450 | 默认值使用硬编码中文 | medium | ", reason: `fromRef 非法：${refCheck.reason}` };     }     fromRef = refCheck.ref; ... |
| 507 | 默认值使用硬编码中文 | medium | ",     path: targetPath,     name: nameCheck.displayName,     branch: resolvedBr... |
| 560 | 默认值使用硬编码中文 | medium | " };   }   const entry = list.entries.find((item) => normalizePath(item.path) ==... |
| 572 | 默认值使用硬编码中文 | medium | "该 worktree 不在 Linghun 受控目录下（external），不允许通过 Linghun 删除。" |
| 577 | 默认值使用硬编码中文 | medium | ",       reason: `未找到受控 worktree：${nameCheck.displayName}。`,     };   }   if (!i... |
| 584 | 默认值使用硬编码中文 | medium | "该 worktree 不在 Linghun 受控目录下（external），不允许通过 Linghun 删除。" |
| 608 | 默认值使用硬编码中文 | medium | "; reason: string };  /**  * 已确认后真正删除。只走 `git worktree remove [--force] <path>`，... |
| 627 | 默认值使用硬编码中文 | medium | ", path }; }  // ---------------------------------------------------------------... |
| 660 | 默认值使用硬编码中文 | medium | ";   // 链接 worktree：--absolute-git-dir 形如 <main>/.git/worktrees/<name>，   // 与 -... |

### packages/tui/src/git-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 2 | 默认值使用硬编码中文 | medium | ";  /**  * D.13R Git / Worktree / Stable Point Maturity Sweep — 只读 git 探测。  *  *... |
| 13 | 默认值使用硬编码中文 | medium | "，不抛异常。  *  * 不引入新依赖（与 LingHun 现有依赖收敛保持一致）；不复制 CCB 源码实现。  */  const execFileAsyn... |
| 125 | 默认值使用硬编码中文 | medium | " → not_a_git_repo  *   - git binary 缺失 / spawn 失败 / timeout / lock / 其他 git 内部错... |
| 128 | 默认值使用硬编码中文 | medium | " + changedCount=0 真的是干净工作区，  *     而不是 status 命令失败被静默吞掉。  */ export async funct... |
| 136 | 默认值使用硬编码中文 | medium | "]);   if (!repoCheck.ok) {     // 仅在 stderr 明确包含 " |
| 138 | 默认值使用硬编码中文 | medium | " 时才报告 not_a_git_repo。     // 其余失败（ENOENT / timeout / lock / 未知错误）一律 git_unavail... |
| 141 | 默认值使用硬编码中文 | medium | "，后者不能伪装成前者。     if (repoCheck.stderr.toLowerCase().includes(" |
| 147 | 默认值使用硬编码中文 | medium | ") {     // rev-parse exit 0 但 stdout 不是 " |
| 148 | 默认值使用硬编码中文 | medium | " 的情况理论上不会发生；保守归为     // git_unavailable 而不是 not_a_git_repo —— 异常输出不能映射为明确的结论。  ... |
| 159 | 默认值使用硬编码中文 | medium | "]),   ]);    // 关键 fail-closed 点：status 失败时**绝不**返回 ok/clean。   // 例如 `git stat... |
| 165 | 默认值使用硬编码中文 | medium | "信号；现在直接报告 git_unavailable，让上层提示用户。   if (!statusResult.ok) {     return {      ... |
| 219 | 默认值使用硬编码中文 | medium | ",     branch,     headShort,     headSubject,     changedCount: staged.length +... |
| 240 | 默认值使用硬编码中文 | medium | " 时返回 not_a_git_repo  *   - rev-parse 其他失败 / worktree list 失败 → git_unavailable（... |
| 339 | 默认值使用硬编码中文 | medium | "当前目录不是 git 仓库，跳过 stable point。" |
| 357 | 默认值使用硬编码中文 | medium | "工作区干净，没有可提交的改动。" |
| 358 | 默认值使用硬编码中文 | medium | ",       changedCount: 0,       staged,       unstaged,       untracked,     }; ... |
| 379 | 默认值使用硬编码中文 | medium | "工作区有改动，可以提交一个稳定点；建议 review 后用 feat/fix/chore 等前缀替换 wip。" |

### packages/tui/src/git-slash-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 49 | 默认值使用硬编码中文 | medium | ").trim();   return { message: message \|\| undefined, includeUntracked }; }  // 解... |
| 80 | 默认值使用硬编码中文 | medium | ")) {       name = arg;     }   }   return { name, branch, fromRef, force }; }  ... |
| 103 | 默认值使用硬编码中文 | medium | "stable point was NOT created because Plan mode is read-only. 稳定点未创建：计划模式只读。" |
| 140 | 默认值使用硬编码中文 | medium | "用法：/worktree create <name> [--branch <branch>] [--from <ref>]" |
| 162 | 默认值使用硬编码中文 | medium | "用法：/worktree remove <name> [--force]" |
| 171 | 默认值使用硬编码中文 | medium | ")) {     // slash 路径也走 pendingLocalApproval 轻/强确认；无 continuation（不回灌模型）。     co... |

### packages/tui/src/git-tool-dispatch-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 60 | 默认值使用硬编码中文 | medium | "; };  export type WorktreeCreateRunResult = {   ok: boolean;   text: string;   ... |
| 99 | 默认值使用硬编码中文 | medium | "],     summary: string,     source: string,     supportsClaims: string[],   ) =... |
| 155 | 默认值使用硬编码中文 | medium | ",     ...evidence,   });   return evidence; }  // system_event：结构化 git 事件，不含 se... |
| 172 | 默认值使用硬编码中文 | medium | ");   await deps.appendSystemEvent(context, sessionId, safe, level); }  // 在 git... |
| 206 | 默认值使用硬编码中文 | medium | ") {         checkpoint.files.push({ path: file, existed: false });         cont... |
| 318 | 默认值使用硬编码中文 | medium | " ? worktrees.entries.length : 0,   };   // 只读探测：用 file_read 类 evidence 即可（不写 gi... |
| 337 | 默认值使用硬编码中文 | medium | " ? `Git status: ${summary}` : `Git 状态：${summary}`,   );   return { ok: true, to... |
| 359 | 默认值使用硬编码中文 | medium | "stable point was NOT created because Plan mode is read-only. 稳定点未创建：计划模式只读。" |
| 406 | 默认值使用硬编码中文 | medium | "确认为当前工作区创建稳定点（git commit / snapshot）。" |
| 418 | 默认值使用硬编码中文 | medium | ",     );     if (!context.isInkSession) {       deps.writeLine(output, summaryT... |
| 450 | 默认值使用硬编码中文 | medium | ") {     message = defaultStablePointMessage();   } else {     const check = val... |
| 455 | 默认值使用硬编码中文 | medium | " };     }     message = check.message;   }    // 本地安全垫：稳定点前先 snapshot。   await ... |
| 517 | 默认值使用硬编码中文 | medium | ") {     // snapshot stable point 也写 git_operation evidence（已真实创建本地安全垫），     // ... |
| 540 | 默认值使用硬编码中文 | medium | ",     );     return { ok, text, evidenceId: evidence.id, outcome };   }    // f... |
| 573 | 默认值使用硬编码中文 | medium | ", branch: input.branch, fromRef: input.fromRef },     deps,   );   deps.clearRe... |
| 686 | 默认值使用硬编码中文 | medium | ")) {     // 进入轻/强确认；本工具本轮返回 pendingApproval，结果由 yes/no 后的 execute 回灌。     conte... |
| 712 | 默认值使用硬编码中文 | medium | ",     );     deps.writeLine(output, summary.text);     return { ok: false, tool... |
| 737 | 默认值使用硬编码中文 | medium | ",     `ManagedWorktreeRemove: ${summary.text}`,   );   await deps.appendDeferre... |
| 788 | 默认值使用硬编码中文 | medium | ".`         : `已删除 worktree：「${name}」。`;     return { ok: true, text, evidenceId... |
| 807 | 默认值使用硬编码中文 | medium | "       ? `Worktree removal failed; nothing removed: ${result.reason}`       : `... |
| 911 | 默认值使用硬编码中文 | medium | " was not removed.`       : `已${cancelled ? " |
| 912 | 默认值使用硬编码中文 | medium | "}删除 worktree；「${approval.name}」未被删除。`;   deps.writeLine(output, deniedText);   ... |
| 922 | 默认值使用硬编码中文 | medium | ",         evidenceId: evidence.id,       }),     });     await deps.continueAft... |
| 957 | 默认值使用硬编码中文 | medium | ",       tool_call_id: approval.toolCall.id,       content: JSON.stringify({    ... |
| 972 | 默认值使用硬编码中文 | medium | "给模型， // 让 final answer 无法声称已建立稳定点。 export async function resolveStablePointDeny... |
| 1002 | 默认值使用硬编码中文 | medium | "}; no commit or snapshot was created. The stable point was NOT created.`       ... |
| 1003 | 默认值使用硬编码中文 | medium | "}创建稳定点；未创建任何 commit 或 snapshot。稳定点未创建。`;   deps.writeLine(output, deniedText); ... |

### packages/tui/src/git-tool-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 127 | 默认值使用硬编码中文 | medium | " ? value : undefined; }  export type StablePointToolInput = {   message?: strin... |
| 192 | 默认值使用硬编码中文 | medium | "当前不是 git 仓库；已改为创建 Linghun snapshot 稳定点。" |
| 194 | 默认值使用硬编码中文 | medium | ":       return {         ok: false,         text: isEn           ? `git is unav... |
| 205 | 默认值使用硬编码中文 | medium | "}); no empty commit created.`           : `工作区干净（分支 ${outcome.branch ?? " |
| 206 | 默认值使用硬编码中文 | medium | "}）；未创建空 commit。`,       };     case " |
| 215 | 默认值使用硬编码中文 | medium | "仅有未跟踪文件；已创建 Linghun snapshot。需要纳入 git commit 请显式 includeUntracked。" |
| 218 | 默认值使用硬编码中文 | medium | "可纳入的未跟踪文件全部被判定为敏感/ignored 并排除；已创建 Linghun snapshot，未提交。" |
| 224 | 默认值使用硬编码中文 | medium | ")}.`             : ` 已排除敏感/ignored：${summarizeRejectedUntracked(outcome.rejecte... |
| 230 | 默认值使用硬编码中文 | medium | "} — ${outcome.subject} (${outcome.changedCount} file(s)).${rejected}`          ... |
| 231 | 默认值使用硬编码中文 | medium | "}）— ${outcome.subject}（${outcome.changedCount} 个文件）。${rejected}`,       };     ... |
| 234 | 默认值使用硬编码中文 | medium | ":       return {         ok: false,         text: isEn           ? `Stable poin... |
| 255 | 默认值使用硬编码中文 | medium | "当前不是 git 仓库，无法创建 managed worktree。" |
| 257 | 默认值使用硬编码中文 | medium | ":       return {         ok: false,         text: isEn           ? `git is unav... |
| 264 | 默认值使用硬编码中文 | medium | ":       return {         ok: false,         text: isEn           ? `Invalid wor... |
| 275 | 默认值使用硬编码中文 | medium | "}); resumed without overwriting.`           : `worktree「${outcome.name}」已存在于 ${... |
| 276 | 默认值使用硬编码中文 | medium | "}）；已复用，未覆盖。`,       };     case " |
| 282 | 默认值使用硬编码中文 | medium | "}, from ${outcome.fromRef}). cwd was NOT changed; cd there to work in it.`     ... |
| 283 | 默认值使用硬编码中文 | medium | "}，基于 ${outcome.fromRef}）。当前进程目录未切换；如需在其中工作请手动 cd 过去。`,       };     case " |
| 285 | 默认值使用硬编码中文 | medium | ":       return {         ok: false,         text: isEn           ? `Worktree cr... |
| 307 | 默认值使用硬编码中文 | medium | "当前不是 git 仓库。" |
| 309 | 默认值使用硬编码中文 | medium | ":       return {         ok: false,         needsConfirmation: false,         s... |
| 316 | 默认值使用硬编码中文 | medium | ":       return {         ok: false,         needsConfirmation: false,         s... |
| 345 | 默认值使用硬编码中文 | medium | " at ${redactWorktreePath(plan.path)} (clean).`           : `确认删除 managed worktr... |
| 354 | 默认值使用硬编码中文 | medium | " has uncommitted changes; refused. Pass force=true to remove anyway.`          ... |
| 363 | 默认值使用硬编码中文 | medium | " at ${redactWorktreePath(plan.path)}; uncommitted changes will be lost.`       ... |

### packages/tui/src/guard-wiring.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 70 | 默认值使用硬编码中文 | medium | "Ink 主路径已激活。本次会话的 TUI 成熟度声明有效。" |
| 72 | 默认值使用硬编码中文 | medium | "TUI 路径无需额外操作。" |
| 83 | 默认值使用硬编码中文 | medium | " is active. ${reason} TUI maturity cannot be claimed.`         : `当前使用降级路径" |
| 84 | 默认值使用硬编码中文 | medium | "。${reason}不能声称 TUI 已成熟。`,     nextAction:       language === " |
| 88 | 默认值使用硬编码中文 | medium | "在支持 Ink 的真实终端中运行以验证 TUI 成熟度。" |
| 107 | 默认值使用硬编码中文 | medium | "从源码运行。验证结果反映当前代码。" |
| 108 | 默认值使用硬编码中文 | medium | "无需额外操作。" |
| 119 | 默认值使用硬编码中文 | medium | "可能已过时。${translateStaleReason(marker.staleReason, language)}`,     nextAction:  ... |
| 123 | 默认值使用硬编码中文 | medium | "重新构建或从源码运行，确保验证反映当前代码。" |
| 142 | 默认值使用硬编码中文 | medium | "已达到真实 smoke 验证。成熟度声明有效。" |
| 143 | 默认值使用硬编码中文 | medium | "无需额外操作。" |
| 155 | 默认值使用硬编码中文 | medium | "         ? `Current level: ${levelExplanation}. Cannot claim mature or producti... |
| 158 | 默认值使用硬编码中文 | medium | " ? `Need: ${needed}` : `需要：${needed}`,   }; }  /**  * Format runner verificatio... |
| 176 | 默认值使用硬编码中文 | medium | "原生 runner 已成功完成。Runner 成熟度已验证。" |
| 181 | 默认值使用硬编码中文 | medium | "}. This does not prove native runner maturity. Real native runner smoke is requ... |
| 182 | 默认值使用硬编码中文 | medium | "}。这不能证明原生 runner 已成熟。需要真实原生 runner smoke 验证。`;   }    return language === " |
| 187 | 默认值使用硬编码中文 | medium | "不是成熟度证明。需要真实 smoke 验证。`; }  /**  * Format provider verification for /doctor or ... |
| 207 | 默认值使用硬编码中文 | medium | "Provider 端点已通过真实响应验证。Provider 就绪状态已确认。" |
| 213 | 默认值使用硬编码中文 | medium | "Provider 正在冷却中。冷却结束且真实请求成功前，不能声称 provider 已就绪。" |
| 219 | 默认值使用硬编码中文 | medium | "Provider 验证使用了 mock。需要真实端点请求来确认 provider 就绪状态。" |
| 225 | 默认值使用硬编码中文 | medium | "Provider 正在使用降级方案。主 provider 路径必须成功才能声称就绪。" |
| 230 | 默认值使用硬编码中文 | medium | "Provider 状态不确定。需要真实端点请求。" |
| 255 | 默认值使用硬编码中文 | medium | "：实际验证等级为${explainLevel(actualLevel, " |
| 255 | 默认值使用硬编码中文 | medium | ")}。成熟/就绪声明需要真实 smoke 验证。`,     );   }    // Check runtime path inflation   if (... |
| 266 | 默认值使用硬编码中文 | medium | "：TUI 正在降级路径" |
| 266 | 默认值使用硬编码中文 | medium | "上运行。需要 Ink 主路径验证。`,       );     }   }    if (warnings.length === 0) {     retu... |
| 278 | 默认值使用硬编码中文 | medium | "声明与现有证据一致。" |
| 288 | 默认值使用硬编码中文 | medium | "声明：发现 ${warnings.length} 个问题。`,   }; }  /**  * Validate a change declaration an... |
| 312 | 默认值使用硬编码中文 | medium | "输出不是 TTY（被管道或重定向）。" |
| 315 | 默认值使用硬编码中文 | medium | "正在 CI 环境中运行。" |
| 318 | 默认值使用硬编码中文 | medium | "Ink 渲染器不可用。" |
| 323 | 默认值使用硬编码中文 | medium | "配置强制使用 legacy 模式。" |
| 326 | 默认值使用硬编码中文 | medium | "被环境变量覆盖。" |
| 328 | 默认值使用硬编码中文 | medium | " ? `Degraded: ${reason}.` : `降级原因：${reason}。`; }  function explainLevel(level: ... |
| 333 | 默认值使用硬编码中文 | medium | "仅 mock/模拟测试" |
| 335 | 默认值使用硬编码中文 | medium | "本地测试运行器（vitest/jest）" |
| 337 | 默认值使用硬编码中文 | medium | "真实 smoke 已验证" |
| 344 | 默认值使用硬编码中文 | medium | "已达到成熟等级。" |
| 351 | 默认值使用硬编码中文 | medium | "真实进程/provider/TUI 观测" |
| 354 | 默认值使用硬编码中文 | medium | "主路径执行（非降级）" |
| 359 | 默认值使用硬编码中文 | medium | "真实依赖验证（非 mock）" |
| 362 | 默认值使用硬编码中文 | medium | "真实 smoke 测试执行" |
| 370 | 默认值使用硬编码中文 | medium | "无法确认是否为当前代码。" |
| 371 | 默认值使用硬编码中文 | medium | "dist 构建可能已过时。" |
| 372 | 默认值使用硬编码中文 | medium | "全局 bin 链接可能已过时。" |
| 373 | 默认值使用硬编码中文 | medium | "桌面 cmd 脚本可能已过时。" |
| 374 | 默认值使用硬编码中文 | medium | "未知入口点。" |
| 375 | 默认值使用硬编码中文 | medium | "无法确认是否为当前代码。" |
| 381 | 默认值使用硬编码中文 | medium | "变更声明缺失：文件列表为空。" |
| 384 | 默认值使用硬编码中文 | medium | "变更声明缺失：未指定主路径。" |
| 387 | 默认值使用硬编码中文 | medium | "变更声明缺失：未指定验证等级。" |
| 390 | 默认值使用硬编码中文 | medium | "大改动（>3 文件）未声明 realSmokeRequired 项。请声明哪些内容需要真实 smoke 验证。" |

### packages/tui/src/handoff-session-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 322 | 默认值使用硬编码中文 | medium | "继续当前会话任务。" |
| 347 | 默认值使用硬编码中文 | medium | ",     solutionCompleteness: context.solutionCompleteness,     ...(context.curre... |
| 365 | 默认值使用硬编码中文 | medium | "继续当前会话任务。" |
| 424 | 默认值使用硬编码中文 | medium | "Resume context package（摘要，不含完整历史）：" |
| 439 | 默认值使用硬编码中文 | medium | "- 下一步：补齐 handoff 关键字段或先只读检查 /index status、/memory review、/verify last。" |
| 440 | 默认值使用硬编码中文 | medium | "- 下一步：可基于摘要、Todo、证据和关键文件继续。" |

### packages/tui/src/index-result-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 6 | 默认值使用硬编码中文 | medium | ";  const LARGE_INDEX_FILE_BYTES = 1_000_000; const LARGE_INDEX_FILE_LIMIT = 12;... |
| 62 | 默认值使用硬编码中文 | medium | "Index search（语义符号搜索，最多 5 条）" |
| 77 | 默认值使用硬编码中文 | medium | "Index search（短摘要，最多 5 条）" |
| 263 | 默认值使用硬编码中文 | medium | ") {     return `索引${isRefresh ? " |
| 264 | 默认值使用硬编码中文 | medium | "}已执行，已跳过 ${count} 项大文件/生成物；当前状态仍为 stale。`;   }   return isRefresh     ? `索引已刷新，... |
| 274 | 默认值使用硬编码中文 | medium | "如需持久化忽略规则，可运行索引修复。" |
| 302 | 默认值使用硬编码中文 | medium | ");   }   return [     `本次 /index ${actionLabel} 使用 transient exclude，仅对本次刷新生效。`... |
| 306 | 默认值使用硬编码中文 | medium | ",     ...files,     safety.truncated ? `- 仅记录前 ${LARGE_INDEX_FILE_LIMIT} 项风险文件。... |
| 309 | 默认值使用硬编码中文 | medium | "持久化忽略建议：" |
| 310 | 默认值使用硬编码中文 | medium | "- 只有 /index repair 会写入这些条目；普通 refresh 不修改仓库文件。" |
| 311 | 默认值使用硬编码中文 | medium | "- 建议 ignore 文件：.linghunignore 或 .cbmignore" |
| 312 | 默认值使用硬编码中文 | medium | "建议加入条目：" |

### packages/tui/src/index-tool-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 12 | 默认值使用硬编码中文 | medium | "看索引 / 更新  *   索引" |
| 18 | 默认值使用硬编码中文 | medium | "已刷新 / 仅检查 / 未执行" |
| 26 | 默认值使用硬编码中文 | medium | " as const;  export const INDEX_TOOL_NAMES: readonly string[] = [   INDEX_STATUS... |
| 112 | 默认值使用硬编码中文 | medium | " ? obj.reason : undefined,   }; }  // -----------------------------------------... |
| 121 | 默认值使用硬编码中文 | medium | "，避免模型据此声称已刷新。  */ export function summarizeIndexStatusInspect(   status: string... |
| 135 | 默认值使用硬编码中文 | medium | "} edge(s)`         : `；图 ${nodes ?? " |
| 136 | 默认值使用硬编码中文 | medium | "} 个节点、${edges ?? " |
| 136 | 默认值使用硬编码中文 | medium | "} 条边`       : " |
| 137 | 默认值使用硬编码中文 | medium | ";   return isEn     ? `Index status inspected (not refreshed): status ${status}... |
| 156 | 默认值使用硬编码中文 | medium | "索引修复已执行并尝试刷新；当前状态仍为 stale。" |
| 160 | 默认值使用硬编码中文 | medium | "索引刷新已执行；当前状态仍为 stale。" |
| 166 | 默认值使用硬编码中文 | medium | "已修复并刷新" |

### packages/tui/src/index.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 1340 | 默认值使用硬编码中文 | medium | " },     recentlyMentionedFiles: [],     lastProviderFailure: undefined,     las... |
| 1388 | 默认值使用硬编码中文 | medium | ";     writeLine(errorOutput, `错误：${message}`);     return 1;   } finally {     ... |
| 1573 | 默认值使用硬编码中文 | medium | "   );   if (!shouldUseInkShell(input, output)) {     return await runPlainTui(i... |
| 1665 | 默认值使用硬编码中文 | medium | ") {         // Ink 路径下的 Shift+Tab 必须 quiet：只切 context.permissionMode，         /... |
| 1667 | 默认值使用硬编码中文 | medium | ") → setPermissionMode 那条 plain TUI         // 链路；那条链路会 writeLine(modeSwitched) ... |
| 1669 | 默认值使用硬编码中文 | medium | " StatusTray 文本写进 shellOutput，污染 Task 区 transcript。         // TaskFooter 的 perm... |
| 1683 | 默认值使用硬编码中文 | medium | ",           );         } catch {           // 会话/事件写入失败不阻断 UI 切换；底层日志路径不应把用户输入区... |
| 1700 | 默认值使用硬编码中文 | medium | ") {         // Composer 自己已经在 buffer 里 bufferInsert(" |
| 1701 | 默认值使用硬编码中文 | medium | ")（见 Composer.tsx 的         // Shift+Enter 分支），上抛 ShellInputEvent 仅作为占位事件，      ... |
| 1704 | 默认值使用硬编码中文 | medium | " 噪音 block。         // 这里仅 rerender 让光标 anchor 跟上新 buffer。         shell?.rerend... |
| 1711 | 默认值使用硬编码中文 | medium | "），用户输入区不会       // 出现 /details，transcript 命令行也不会多出一条 ❯ /details。/details slash ... |
| 1740 | 默认值使用硬编码中文 | medium | "当前没有可展开的完整内容。" |
| 1744 | 默认值使用硬编码中文 | medium | ",         });         shell?.rerender();         await shell?.waitUntilRenderFl... |
| 1848 | 默认值使用硬编码中文 | medium | ",         });         shell?.rerender();         await shell?.waitUntilRenderFl... |
| 1855 | 默认值使用硬编码中文 | medium | ") 仍然只 writeLine(formatConfigOverview(...))，       // 保留 plain TUI 与 index.test ... |
| 1857 | 默认值使用硬编码中文 | medium | ") {         const trimmed = event.text;         // 推 transcript 命令行（与其它 slash 一... |
| 1861 | 默认值使用硬编码中文 | medium | ", cursor: 0 };         submittedPending = false;         shell?.rerender();    ... |
| 1923 | 默认值使用硬编码中文 | medium | ");         const entries = build(context.helpPanelState.group, 0, context.langu... |
| 1950 | 默认值使用硬编码中文 | medium | " };         shell?.rerender();         await shell?.waitUntilRenderFlush();    ... |
| 1972 | 默认值使用硬编码中文 | medium | ") {         if (!context.sessionsPanelState) return;         const target = con... |
| 1983 | 默认值使用硬编码中文 | medium | "已在当前会话，无需恢复。" |
| 1991 | 默认值使用硬编码中文 | medium | ",           });           shell?.rerender();           await shell?.waitUntilRe... |
| 2027 | 默认值使用硬编码中文 | medium | ") {           // 关闭面板再派 slash，避免 panel UI 与 slash 输出叠加。           context.confi... |
| 2049 | 默认值使用硬编码中文 | medium | " ? undefined : (step.next as typeof context.configPanelState);         shell?.r... |
| 2087 | 默认值使用硬编码中文 | medium | ": {             // 修正 #3：先持久化 allow rule，成功后再 approve；失败则不 approve、保留 pending  ... |
| 2094 | 默认值使用硬编码中文 | medium | "此动作暂不支持项目级同类允许。请选择本次允许、拒绝或查看详情。" |
| 2103 | 默认值使用硬编码中文 | medium | "反馈降噪：             // 不再把 " |
| 2104 | 默认值使用硬编码中文 | medium | " 这类含 rule.id 的审计文案             // 直接写到主屏。added / duplicate 都视为持久化成功，给同一句" |
| 2105 | 默认值使用硬编码中文 | medium | "。             // save_failed / invalid 走人性化分支，仍保留可操作信息但不含 rule.id。             ... |
| 2108 | 默认值使用硬编码中文 | medium | ") {               // D.13Q-UX Real Smoke Fix v2 — F. allow_always_tool 成功反馈走   ... |
| 2111 | 默认值使用硬编码中文 | medium | " 大块）。NotificationStack               // 由 view-model 的 createdAt+timeoutMs 过滤过期... |
| 2125 | 默认值使用硬编码中文 | medium | ") {               writeLine(                 shellOutput,                 isEn ... |
| 2136 | 默认值使用硬编码中文 | medium | "权限规则未保存；当前 pending 仍保留，可重试或选择其它动作。" |
| 2142 | 默认值使用硬编码中文 | medium | ") {               writeLine(shellOutput, isEn ? `Unknown tool: ${tool}` : `未知工具... |
| 2210 | 默认值使用硬编码中文 | medium | ")) {         // D.13E Step 2 — 用 createCommandBlock 替代手写 push，统一 transcript 行格式... |
| 2213 | 默认值使用硬编码中文 | medium | " && event.text.length > 0) {         // D.13Q-UX Real Smoke Fix v2 — C. 用户普通消息立... |
| 2215 | 默认值使用硬编码中文 | medium | "成立：模型还没回话之前，用户输入也已经在屏幕上可见，         // 不会出现" |
| 2216 | 默认值使用硬编码中文 | medium | "的错觉。pendingModelSetup（apiKey 遮罩流）和正在         // 等待 enter confirmation 的特殊路径走单独的... |
| 2240 | 默认值使用硬编码中文 | medium | ") {         shell?.unmount();         resolveExit(0);         return;       }  ... |
| 2266 | 默认值使用硬编码中文 | medium | "           ? `Ink shell failed to start; falling back to plain TUI. ${error ins... |
| 2487 | 默认值使用硬编码中文 | medium | ") {     // D.14D — /index repair 是显式入口：在安全门阻塞（有 risky files）时把缺失的     // ignore... |
| 2512 | 默认值使用硬编码中文 | medium | ";   }   // D.13R Git / Worktree / Stable Point — 只读探测面板。   // /git、/worktree、/c... |
| 2597 | 默认值使用硬编码中文 | medium | "用法：/sessions resume <id>" |
| 2601 | 默认值使用硬编码中文 | medium | ";     }      const sessions = await context.store.list();     // D.13Q-UX Closu... |
| 2626 | 默认值使用硬编码中文 | medium | ";     }     // D.14E+ — plain TUI 也用 CommandPanel 避免刷屏：主屏显示总数+最近 5 个，     // 完整... |
| 2635 | 默认值使用硬编码中文 | medium | ")}`;       }),     ];     if (sessions.length > 5) {       summaryLines.push(`.... |

### packages/tui/src/job-agent-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 490 | 默认值使用硬编码中文 | medium | "); }  function toRunnerContext(context: TuiContext): RunnerContext {   return {... |
| 530 | 默认值使用硬编码中文 | medium | "没有后台任务。" |
| 539 | 默认值使用硬编码中文 | medium | ").length;     const needsAttention = blocked + stale + timeout;     const summa... |
| 563 | 默认值使用硬编码中文 | medium | "没有后台任务。" |
| 584 | 默认值使用硬编码中文 | medium | " },   ];   const sections: CommandPanelSection[] = [];   const used = new Set<s... |
| 639 | 默认值使用硬编码中文 | medium | ") {     const jobs = await listDurableJobs(context);     // D.13Q-UX Task Surfa... |
| 650 | 默认值使用硬编码中文 | medium | "没有 job。" |
| 657 | 默认值使用硬编码中文 | medium | ",       summary: [         isEn           ? `Jobs · ${total} total · ${running}... |
| 679 | 默认值使用硬编码中文 | medium | "用法：/job run <goal> [--phase <phase>] [--target <target>] [--agents <n>] [--runn... |
| 709 | 默认值使用硬编码中文 | medium | "未找到 job。用法：/job status\|report\|logs\|pause\|resume\|cancel <id>" |
| 712 | 默认值使用硬编码中文 | medium | ") {       refreshRunnerStatusForJob(context, job);       await persistDurableJo... |
| 722 | 默认值使用硬编码中文 | medium | "             ? `Job ${job.id} · ${job.status} — Ctrl+O for details.`           ... |
| 730 | 默认值使用硬编码中文 | medium | ") {       refreshRunnerStatusForJob(context, job);       await persistDurableJo... |
| 740 | 默认值使用硬编码中文 | medium | "             ? `Job ${job.id} report — Ctrl+O for details.`             : `Job ... |
| 748 | 默认值使用硬编码中文 | medium | ") {       // D.14D-E — /job logs 走降噪 CommandPanel：完整日志尾部进 detailsText。       sh... |
| 754 | 默认值使用硬编码中文 | medium | "             ? `Job ${job.id} logs — Ctrl+O for details.`             : `Job ${... |
| 796 | 默认值使用硬编码中文 | medium | "用法：/job list \| /job run <goal> \| /job create <goal> \| /job status <id> \| /job l... |
| 867 | 默认值使用硬编码中文 | medium | ");   }   return [     `[job] ${job.id} · ${job.status} · 状态未改变`,     `- ${actio... |
| 878 | 默认值使用硬编码中文 | medium | "       ? `[job] ${job.id} · ${job.status} · unchanged`       : `[job] ${job.id}... |
| 881 | 默认值使用硬编码中文 | medium | "       ? `- ${action}: ${job.status} already needs attention; no lifecycle tran... |
| 892 | 默认值使用硬编码中文 | medium | "     ? `- next: inspect /job report ${job.id} and /job logs ${job.id}; after fi... |
| 903 | 默认值使用硬编码中文 | medium | ");   }   return [     `Job ${job.id} 已是 ${job.status}；/job ${action} 不会启动新动作。`,... |
| 907 | 默认值使用硬编码中文 | medium | ",     `- 下一步：查看 /job report ${job.id} 或 /job logs ${job.id}；如需继续请新建/运行 job。`,  ... |
| 1549 | 默认值使用硬编码中文 | medium | " && hasRunnableJobAgents(job)) {     const stepIndex = job.budget.usedSteps ?? ... |
| 1601 | 默认值使用硬编码中文 | medium | ")}`);       // P1-5 — token 预算只在用户显式设置（--tokens）时强制；默认无用户可见预算。       if (      ... |
| 1852 | 默认值使用硬编码中文 | medium | "][number], ): string[] {   const workspaceRef = context.cache.workspaceReferenc... |
| 1856 | 默认值使用硬编码中文 | medium | "，不让   // 模型把上次成功的旧数据当 confirmed current fact。   const snapshotState = !workspac... |
| 1874 | 默认值使用硬编码中文 | medium | "}`,     `logs ${job.logPath}; report ${job.reportPath}`,   ]; }  export async f... |
| 1908 | 默认值使用硬编码中文 | medium | ", `budget_exceeded:${phase}`);     return true;   }   return false; }  // Modul... |
| 1930 | 默认值使用硬编码中文 | medium | "           ? `Custom agents · ${context.agentRegistry.agents.length} available ... |
| 1939 | 默认值使用硬编码中文 | medium | ") {     // D.14D-E — /agents 走降噪 CommandPanel：完整 agent 列表进 detailsText。     con... |
| 1950 | 默认值使用硬编码中文 | medium | ",       summary: [         isEn           ? `Agents · ${total} total · ${runnin... |
| 1976 | 默认值使用硬编码中文 | medium | "用法：/agents send <id\|name> <message> 或 /agents send --team <team> <message>" |
| 1987 | 默认值使用硬编码中文 | medium | "未找到 agent。" |
| 1995 | 默认值使用硬编码中文 | medium | "           ? `Agent ${agent.id} · ${agent.status} — Ctrl+O for details.`       ... |
| 2011 | 默认值使用硬编码中文 | medium | "未找到 agent。" |
| 2020 | 默认值使用硬编码中文 | medium | "未找到 agent。" |
| 2028 | 默认值使用硬编码中文 | medium | "用法：/agents \| /agents registry \| /agents show <id> \| /agents resume <id> \| /agen... |
| 2057 | 默认值使用硬编码中文 | medium | "用法：/fork explorer\|planner\|verifier\|worker\|<custom-agent-id> <task> [--backgroun... |
| 2061 | 默认值使用硬编码中文 | medium | "\n暂无自定义 agent，可在 .linghun/agents/ 下放置 JSON/MD 定义文件。" |
| 2070 | 默认值使用硬编码中文 | medium | ", true, workflowTaskId);   if (guard) {     writeLine(output, guard);     retur... |
| 2170 | 默认值使用硬编码中文 | medium | "         ? `Background agent started: ${agent.id}. Use /agents show ${agent.id}... |
| 2175 | void Promise(潜在rejection) | medium | void completeAgent(agent, background, context, output) |
| 2192 | 默认值使用硬编码中文 | medium | " && !isAgentIdle(agent)) {     writeLine(output, `agent ${agent.id} 当前状态为 ${age... |
| 2250 | 默认值使用硬编码中文 | medium | "查看 /agents show 输出。" |
| 2258 | 默认值使用硬编码中文 | medium | ",     agentId: agent.id,     status: result.status,     summary: result.summary... |
| 2294 | 默认值使用硬编码中文 | medium | ";   agent.summary = `agent ${agent.id} 执行失败：${truncateDisplay(message, 160)}`; ... |
| 2303 | 默认值使用硬编码中文 | medium | "查看 /agents show 输出，必要时重试。" |
| 2307 | 默认值使用硬编码中文 | medium | ",     summary: agent.summary,     createdAt: now,   });   await deps().appendBa... |
| 2350 | 默认值使用硬编码中文 | medium | ",       summary: `verifier 已运行真实验证，结果 ${report.status.toUpperCase()}；任务「${agent... |
| 2512 | 默认值使用硬编码中文 | medium | ",       summary: `${agent.type} blocked：模型网关未就绪，无法启动真实 agent loop。任务「${agent.ta... |
| 2533 | 默认值使用硬编码中文 | medium | ",       summary: `${agent.type} failed：无法创建 agent abort signal。`,       evidenc... |
| 2613 | 默认值使用硬编码中文 | medium | "               ? `${agent.type} blocked: child model request is waiting before ... |
| 2693 | 默认值使用硬编码中文 | medium | "                     ? `${agent.type} blocked: fallback child model is cooling ... |
| 2737 | 默认值使用硬编码中文 | medium | "                 ? `${agent.type} blocked: child model request failed with ${ki... |
| 2786 | 默认值使用硬编码中文 | medium | ",           summary: `${agent.type} blocked：${result.tool} 需要用户确认，agent loop 已停... |
| 2793 | 默认值使用硬编码中文 | medium | ",           summary: `${agent.type} blocked：${result.tool} 未成功执行：${truncateDisp... |
| 3207 | 默认值使用硬编码中文 | medium | ",     id: callId,     name,     input,     createdAt: new Date().toISOString(),... |
| 3245 | 默认值使用硬编码中文 | medium | ";   agent.summary = `agent ${agent.id} 已取消；主会话可继续。`;   setAgentActivity(agent, ... |
| 3284 | 默认值使用硬编码中文 | medium | "未找到 agent。" |
| 3302 | 默认值使用硬编码中文 | medium | "没有可取消的 agent；running agent 已清空。" |
| 3311 | 默认值使用硬编码中文 | medium | "       ? `Cancelled ${agents.length} agent(s).`       : `已取消 ${agents.length} 个... |
| 3324 | 默认值使用硬编码中文 | medium | " && !isAgentIdle(agent)) {     writeLine(output, `Agent 当前状态为 ${agent.status}，无... |
| 3330 | 默认值使用硬编码中文 | medium | ", true, agent.id);   if (guard) {     agent.summary = `agent ${agent.id} resume... |
| 3353 | 默认值使用硬编码中文 | medium | "已用新的 provider turn 恢复；不会回放旧 stream。" |
| 3636 | void Promise(潜在rejection) | medium | void completeAgent(target.agent, target.background, context, createSilentOutput(... |
| 3850 | 默认值使用硬编码中文 | medium | "当前没有 agent。用法：/fork explorer\|planner\|verifier\|worker <task>。" |
| 3871 | 默认值使用硬编码中文 | medium | "}`       : `可取消 agent IDs：${cancellable.map((agent) => agent.id).join(" |
| 3877 | 默认值使用硬编码中文 | medium | "使用 /agents cancel all 可停止所有 running agent。" |
| 3882 | 默认值使用硬编码中文 | medium | "displayName 仅用于展示；role、权限模式、资源守卫、证据和生命周期不变。" |
| 3897 | 默认值使用硬编码中文 | medium | "- .linghun/agents 下暂无自定义 agent" |

### packages/tui/src/job-runner-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 22 | 默认值使用硬编码中文 | medium | ";   processGuardContract?: readonly string[];   lastError?: string;   nextActio... |
| 98 | 默认值使用硬编码中文 | medium | "       ? `Use /job pause ${job.id}, /job cancel ${job.id}, /job report ${job.id... |
| 103 | 默认值使用硬编码中文 | medium | "       ? `Use /job resume ${job.id} when the handoff/resource guard is ready, o... |
| 110 | 默认值使用硬编码中文 | medium | "         ? `Repair the handoff packet or evidence state, then /job resume ${job... |
| 115 | 默认值使用硬编码中文 | medium | "         ? `Inspect /job report ${job.id} and /job logs ${job.id}; resume after... |
| 120 | 默认值使用硬编码中文 | medium | "         ? `Fix model/provider configuration, then /job resume ${job.id}.`     ... |
| 124 | 默认值使用硬编码中文 | medium | "       ? `Inspect /job report ${job.id} and /job logs ${job.id}; resume after f... |
| 129 | 默认值使用硬编码中文 | medium | "       ? `Inspect /job report ${job.id} and /job logs ${job.id}; resume only af... |
| 134 | 默认值使用硬编码中文 | medium | "       ? `Inspect /job report ${job.id} and /job logs ${job.id}; rerun with an ... |
| 139 | 默认值使用硬编码中文 | medium | "       ? `Inspect /job report ${job.id} or /job logs ${job.id}; create a new jo... |
| 144 | 默认值使用硬编码中文 | medium | "       ? `Review /job report ${job.id} and /job logs ${job.id}; run verificatio... |
| 148 | 默认值使用硬编码中文 | medium | "     ? `Inspect /job report ${job.id} and /job logs ${job.id}; lifecycle status... |
| 186 | 默认值使用硬编码中文 | medium | "       ? `Background ${task.id} has no output path yet.`       : `Background ${... |
| 208 | 默认值使用硬编码中文 | medium | "     ? `[background] ${title} · ${task.status} · ${step}${progress} · elapsed $... |
| 266 | 默认值使用硬编码中文 | medium | "heartbeat/output 已停止；恢复前应先检查日志和状态" |
| 271 | 默认值使用硬编码中文 | medium | "因资源守卫、handoff 修复或用户操作暂停" |
| 274 | 默认值使用硬编码中文 | medium | "       ? `${task.status}; this is not evidence that verification passed`       ... |
| 278 | 默认值使用硬编码中文 | medium | "未 stale" |

### packages/tui/src/job-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 29 | 默认值使用硬编码中文 | medium | ";  const appendFileAsync = promisify(fsAppendFile);  // -----------------------... |
| 174 | 默认值使用硬编码中文 | medium | ", 10);   if (!Number.isFinite(parsed) \|\| parsed < 1) {     return fallback;   }... |
| 194 | 默认值使用硬编码中文 | medium | "，不展示默认 max。 function formatJobBudgetLine(job: DurableJobState): string {   cons... |

### packages/tui/src/log-artifact.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 74 | 默认值使用硬编码中文 | medium | ") {       throw new Error(`日志 artifact 不存在：${sourcePath}。请确认任务已产生输出。`);     }  ... |
| 97 | 默认值使用硬编码中文 | medium | " ? `Log artifact ${slice.mode}` : `Log artifact ${slice.mode} 切片`;   const line... |
| 116 | 默认值使用硬编码中文 | medium | "- boundary: 仅有界读取；完整日志不会进入主屏、prompt、memory 或 handoff。" |
| 121 | 默认值使用硬编码中文 | medium | "未找到匹配日志内容。" |
| 132 | 默认值使用硬编码中文 | medium | "),     );     if (!background) {       throw new Error(`未找到 background：${source... |
| 146 | 默认值使用硬编码中文 | medium | "),     );     if (!evidence) {       throw new Error(         `未找到 evidence：${s... |
| 174 | 默认值使用硬编码中文 | medium | "拒绝读取日志 artifact：路径不在 workspace 或已知 log root 内。" |
| 179 | 默认值使用硬编码中文 | medium | "拒绝读取日志 artifact：路径不在 workspace 或已知 log root 内。" |
| 199 | 默认值使用硬编码中文 | medium | "Evidence source 不是 log/output artifact：请用 Read 或其他合适工具查看普通 workspace 文件。" |
| 453 | 默认值使用硬编码中文 | medium | "grep 模式缺失。用法：/details output <id> --grep <pattern> [--context N]" |

### packages/tui/src/mcp-index-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX Task Surface — /mcp status 的降噪 CommandPanel 视图。  * 仅暴露：是否启用、... |
| 23 | 默认值使用硬编码中文 | medium | "} · 服务器 ${serverCount} · 工具 ${toolCount}`,   ];   if (needsDoctor) {     summar... |
| 27 | 默认值使用硬编码中文 | medium | "尚未诊断 — 运行 /mcp doctor 检测。" |
| 44 | 默认值使用硬编码中文 | medium | ",     summary,     sections,     actions,     detailsText: formatMcpStatus(cont... |
| 54 | 默认值使用硬编码中文 | medium | "，不再 unknown 吓人；   //   - codebase-memory binary/version 未知时同样显示" |
| 56 | 默认值使用硬编码中文 | medium | "启动或检测失败会隔离" |
| 61 | 默认值使用硬编码中文 | medium | "未检测，运行 /mcp doctor 检测" |
| 74 | 默认值使用硬编码中文 | medium | "Linghun 内置 codebase-memory 或外部 fallback" |
| 90 | 默认值使用硬编码中文 | medium | "- 下一步：运行 /mcp doctor 做诊断、/mcp tools 查看已登记工具、/index status 查看 codebase-memory 状态... |
| 91 | 默认值使用硬编码中文 | medium | "); }  /**  * D.13Q-UX Task Surface — /index status 的降噪 CommandPanel 视图。  * 仅暴露：... |
| 108 | 默认值使用硬编码中文 | medium | "} · status: ${status}`       : `索引 ${enabled ? " |
| 109 | 默认值使用硬编码中文 | medium | "} · 状态：${status}`,   ];   const actions: string[] = [];   if (status === " |
| 114 | 默认值使用硬编码中文 | medium | "尚未建立 — 运行 /index init fast。" |
| 119 | 默认值使用硬编码中文 | medium | "已过期 — 建议运行 /index refresh。" |
| 123 | 默认值使用硬编码中文 | medium | "出错 — 运行 /index doctor。" |
| 139 | 默认值使用硬编码中文 | medium | "       ? `建议：配置 ${CODEBASE_MEMORY_ENV}，或安装/修复 Linghun-managed codebase-memory；普... |
| 143 | 默认值使用硬编码中文 | medium | "建议：确认 codebase-memory artifact 是否存在；可显式运行 /index init fast。普通聊天不受影响。" |
| 144 | 默认值使用硬编码中文 | medium | "建议：运行 /index init fast 建立索引；仓库很大时会自动跳过高风险大文件/生成物。" |
| 146 | 默认值使用硬编码中文 | medium | "建议：按需刷新索引；大文件/生成物会在默认刷新中临时跳过。" |
| 148 | 默认值使用硬编码中文 | medium | "建议：修复 codebase-memory runtime/artifact 后重试 /index doctor 或 /index status。" |
| 149 | 默认值使用硬编码中文 | medium | "建议：可用 /index search <query> 或 /index architecture 获取短结果；新鲜度检查用 /index status --... |
| 178 | 默认值使用硬编码中文 | medium | "索引刷新完成" |
| 178 | 默认值使用硬编码中文 | medium | "索引初始化完成" |
| 184 | 默认值使用硬编码中文 | medium | ");   }   return [     titleZh,     `- 状态：${context.index.status}`,     " |

### packages/tui/src/mcp-index-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 136 | 默认值使用硬编码中文 | medium | ") {     // D.13Q-UX Task Surface — /mcp status 默认走 CommandPanel（降噪），     // 内部细... |
| 149 | 默认值使用硬编码中文 | medium | ") {     await runMcpDoctor(context);     // D.14D-E — /mcp doctor 走降噪 CommandPa... |
| 158 | 默认值使用硬编码中文 | medium | "MCP 诊断 — Ctrl+O 查看完整诊断。" |
| 164 | 默认值使用硬编码中文 | medium | ") {     // D.14D-E — /mcp validate 走降噪 CommandPanel：完整校验结果进 detailsText。     co... |
| 170 | 默认值使用硬编码中文 | medium | "MCP 校验 — Ctrl+O 查看详情。" |
| 185 | 默认值使用硬编码中文 | medium | ", context)         : `用法：/mcp ${action} <server-id>`,     );     return;   }   ... |
| 192 | 默认值使用硬编码中文 | medium | "用法：/mcp remove <server-id>" |
| 201 | 默认值使用硬编码中文 | medium | "用法：/mcp \| /mcp status \| /mcp tools \| /mcp doctor \| /mcp validate [id] \| /mcp ad... |
| 212 | 默认值使用硬编码中文 | medium | "));     // D.13Q-UX Task Surface — /index status 默认走 CommandPanel 降噪。     showC... |
| 218 | 默认值使用硬编码中文 | medium | ") {     await refreshIndexStatus(context, true);     // D.14D-E — /index doctor... |
| 225 | 默认值使用硬编码中文 | medium | ") {     await refreshIndexStatus(context, true);     // D.14D-E — /index check ... |
| 271 | 默认值使用硬编码中文 | medium | "用法：/index search <query>" |
| 276 | 默认值使用硬编码中文 | medium | ", { query, limit: 5 });     await recordIndexEvidence(context, `search ${query}... |
| 290 | 默认值使用硬编码中文 | medium | "索引搜索结果 — Ctrl+O 查看详情。" |
| 299 | 默认值使用硬编码中文 | medium | ", result.summary);     // D.14D-E — /index architecture 短摘要走降噪 CommandPanel。   ... |
| 307 | 默认值使用硬编码中文 | medium | "索引架构摘要 — Ctrl+O 查看详情。" |
| 316 | 默认值使用硬编码中文 | medium | "用法：/index status [--fresh] \| /index doctor \| /index check \| /index search <quer... |
| 653 | 默认值使用硬编码中文 | medium | " ? undefined : resolution.summary;   }   context.mcp.lastDoctor = new Date().to... |
| 661 | 默认值使用硬编码中文 | medium | "），从而拒绝 ExecuteExtraTool。   const discoveredTools: McpToolState[] = [];   for (c... |
| 666 | 默认值使用硬编码中文 | medium | "));       continue;     }     const serverConfig = context.config.mcp.servers[s... |
| 688 | 默认值使用硬编码中文 | medium | ",         });       }     } else {       // tools/list 失败：暴露 server 仍可被 doctor ... |
| 701 | 默认值使用硬编码中文 | medium | ",       });     }   }   context.mcp.tools = stabilizeMcpToolList(discoveredTool... |
| 737 | 默认值使用硬编码中文 | medium | "- 本阶段 MCP 只支持本地 command 注册；Git/GitHub install 只用于 skills/plugins。" |
| 738 | 默认值使用硬编码中文 | medium | "- add 只写来源/权限记录，不执行 server；运行 /mcp doctor 才做受控 --version 诊断。" |
| 749 | 默认值使用硬编码中文 | medium | ",   };   context.config = await saveMcpServerConfig(id, server, false, context.... |
| 776 | 默认值使用硬编码中文 | medium | "Trust notice：即将启用本地 MCP server；Linghun 不会在 enable 时执行 server，但后续 tools/call 仍必须... |
| 780 | 默认值使用硬编码中文 | medium | "} MCP server：${id}；失败可通过 /mcp doctor 隔离诊断。`,   ]     .filter(Boolean)     .join... |
| 790 | 默认值使用硬编码中文 | medium | "用法：/mcp update <server-id> local <command> [args...]；Connect Lite 不执行 server，只更... |
| 803 | 默认值使用硬编码中文 | medium | ",   };   context.config = await saveMcpServerConfig(id, server, !server.disable... |
| 843 | 默认值使用硬编码中文 | medium | ";     context.index.error = `${resolution.summary}。普通聊天不受影响；如需索引，请配置 ${CODEBASE... |
| 882 | 默认值使用硬编码中文 | medium | "本地 codebase-memory artifact 损坏。" |
| 884 | 默认值使用硬编码中文 | medium | "检测到本地 .codebase-memory/graph.db.zst，但 codebase-memory list_projects 未能匹配当前项目。请运... |
| 885 | 默认值使用硬编码中文 | medium | "未找到当前项目索引。请运行 /index init fast 建立索引。" |
| 916 | 默认值使用硬编码中文 | medium | "fast status：未运行 detect_changes；需要新鲜度检查请用 /index status --fresh 或 /index check。" |
| 947 | 默认值使用硬编码中文 | medium | ",     { project: projectName },     context.projectPath,     15_000,   );   if ... |
| 966 | 默认值使用硬编码中文 | medium | ";     context.index.staleHint = `detect_changes 发现 ${changedCount} 个变更文件，建议运行 /... |
| 1003 | 默认值使用硬编码中文 | medium | " },     startedAt: now,     updatedAt: now,     heartbeatIntervalMs: 30_000,   ... |
| 1009 | 默认值使用硬编码中文 | medium | "}正在执行。`,     nextAction: " |
| 1037 | 默认值使用硬编码中文 | medium | ";     context.index.error = `${result.summary}。请确认索引运行时可用，修复后重试。`;     task.sta... |
| 1044 | 默认值使用硬编码中文 | medium | "查看 /index status，修复 runtime/artifact 后重试；不得声称索引刷新成功。" |
| 1052 | 默认值使用硬编码中文 | medium | "的假信号。这里把它   // 升级成一个可解释的成熟状态：索引刚刷新过、新鲜度待确认（stale + staleHint）。   const statusAf... |
| 1067 | 默认值使用硬编码中文 | medium | "索引已刷新，状态待确认。运行 /index status 可确认。" |
| 1076 | 默认值使用硬编码中文 | medium | "用 /index status 查看详情；需要新鲜度检查时用 /index status --fresh。" |
| 1206 | 默认值使用硬编码中文 | medium | "codebase-memory-mcp 未返回 JSON。" |
| 1225 | 默认值使用硬编码中文 | medium | "工具名记入本 session 已发现集合。   // ExecuteExtraTool 需要这个证据来证明模型确实通过 SearchExtraTools 发现... |
| 1244 | 默认值使用硬编码中文 | medium | "ExecuteExtraTool: tool_name 缺失或为空，请先运行 SearchExtraTools 找到目标工具。" |
| 1247 | 默认值使用硬编码中文 | medium | "集合。   // listDeferredTools 等价于" |
| 1248 | 默认值使用硬编码中文 | medium | "模型已通过 SearchExtraTools 发现过" |
| 1273 | 默认值使用硬编码中文 | medium | ") {     if (!isCodebaseMemoryToolName(target.name)) {       return {         ok... |
| 1290 | 默认值使用硬编码中文 | medium | "该索引写入动作不能通过通用工具入口执行。请使用 /index refresh 或让模型发起结构化的代码索引刷新工具；执行时仍会走 Linghun 权限边界。" |
| 1297 | 默认值使用硬编码中文 | medium | "}`,       };     }     return {       ok: true,       text: `ExecuteExtraTool(c... |
| 1307 | 默认值使用硬编码中文 | medium | ") {     // D.13J Block 4 — local stdio MCP runtime adapter.     // mcp:<server>... |
| 1329 | 默认值使用硬编码中文 | medium | ",       };     }     const stdio = await runMcpStdioToolCall(       serverConfi... |
| 1341 | 默认值使用硬编码中文 | medium | "}`,       };     }     return {       ok: true,       text: `ExecuteExtraTool($... |

### packages/tui/src/mcp-stdio-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 4 | 默认值使用硬编码中文 | medium | ";  // D.13J Block 4 — mutating heuristic for generic MCP tools。我们不知道具体 server 的... |
| 20 | 默认值使用硬编码中文 | medium | ", ];  export function isPotentiallyMutatingMcpTool(toolName: string): boolean {... |
| 191 | 默认值使用硬编码中文 | medium | ", (code, signal) => {       // 让 settle 决定 outcome：如果 tools/call 已经 resolve 过，s... |
| 210 | 默认值使用硬编码中文 | medium | " },         });         // D.13J tail fix（Block A）：tools/list 校验目标 tool 在 serve... |
| 225 | 默认值使用硬编码中文 | medium | ", {           name: toolName,           arguments: params,         });         ... |
| 257 | 默认值使用硬编码中文 | medium | " && name.length > 0) names.push(name);     }   }   return names; }  // D.13J ta... |

### packages/tui/src/memory-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 81 | 默认值使用硬编码中文 | medium | "; }  /**  * D.13Q-UX Task Surface — /memory status / list 的降噪 CommandPanel 视图。 ... |
| 99 | 默认值使用硬编码中文 | medium | "}`       : `记忆 · 已接受 ${accepted} · 候选 ${candidates} · 已禁用 ${disabled}${rejected... |
| 102 | 默认值使用硬编码中文 | medium | "}`       : `自动学习：${learning ? " |
| 124 | 默认值使用硬编码中文 | medium | ") {     // D.13Q-UX Task Surface — /memory status / list 默认走降噪 CommandPanel。   ... |
| 129 | 默认值使用硬编码中文 | medium | ") {     // D.14D-E — /memory storage 走降噪 CommandPanel：完整存储路径进 detailsText。     ... |
| 137 | 默认值使用硬编码中文 | medium | "记忆存储路径 — Ctrl+O 查看详情。" |
| 143 | 默认值使用硬编码中文 | medium | ") {     // D.14D-E — /memory review 走降噪 CommandPanel：完整复核清单进 detailsText。     s... |
| 151 | 默认值使用硬编码中文 | medium | "记忆复核 — Ctrl+O 查看详情。" |
| 157 | 默认值使用硬编码中文 | medium | ") {     // D.14D-E — /memory stats 走降噪 CommandPanel：完整统计进 detailsText。     show... |
| 165 | 默认值使用硬编码中文 | medium | "记忆统计 — Ctrl+O 查看详情。" |
| 182 | 默认值使用硬编码中文 | medium | "自动学习已开启。新偏好/习惯将作为候选记录（不会自动接受）。关闭：/memory learn off" |
| 195 | 默认值使用硬编码中文 | medium | "自动学习已关闭。不再自动生成新候选记忆。" |
| 203 | 默认值使用硬编码中文 | medium | "}; candidates ${context.memory.candidates.length}; accepted ${context.memory.ac... |
| 204 | 默认值使用硬编码中文 | medium | "}；来源 ${context.memory.learningModeSource ?? " |
| 204 | 默认值使用硬编码中文 | medium | "}；候选 ${context.memory.candidates.length}；已接受 ${context.memory.accepted.length}`... |
| 214 | 默认值使用硬编码中文 | medium | "           ? `Memory learn — ${result.candidatesCreated} candidate(s); Ctrl+O f... |
| 227 | 默认值使用硬编码中文 | medium | "用法：/memory candidate <短小稳定记忆摘要> [--scope project\|user\|session]" |
| 241 | 默认值使用硬编码中文 | medium | ",       candidate,       createdAt: new Date().toISOString(),     });     deps(... |
| 256 | 默认值使用硬编码中文 | medium | "未找到候选记忆。用法：/memory accept <candidate-id>" |
| 274 | 默认值使用硬编码中文 | medium | "未找到候选记忆。用法：/memory reject <candidate-id>" |
| 292 | 默认值使用硬编码中文 | medium | "未找到已接受记忆。用法：/memory disable <accepted-id>" |
| 310 | 默认值使用硬编码中文 | medium | "未找到已禁用记忆。用法：/memory rollback <disabled-id>" |
| 328 | 默认值使用硬编码中文 | medium | "未找到该记忆。用法：/memory delete <id> 或 /memory forget <id>" |
| 362 | 默认值使用硬编码中文 | medium | "用法：/memory \| /memory storage \| /memory review \| /memory stats \| /memory learn [... |
| 370 | 默认值使用硬编码中文 | medium | ", ): Promise<void> {   try {     const resumed = await context.store.resume(ses... |
| 388 | 默认值使用硬编码中文 | medium | "索引不是 ready：建议先运行 /index status 或 /index refresh；不会自动刷新。 " |
| 432 | 默认值使用硬编码中文 | medium | ", accepted);     deps().refreshCacheFreshness(context);     writeLine(       ou... |
| 447 | 默认值使用硬编码中文 | medium | ", rejected);     deps().refreshCacheFreshness(context);     writeLine(output, `... |
| 459 | 默认值使用硬编码中文 | medium | ", disabled);     deps().refreshCacheFreshness(context);     writeLine(output, `... |
| 471 | 默认值使用硬编码中文 | medium | ", accepted);     deps().refreshCacheFreshness(context);     writeLine(output, `... |
| 481 | 默认值使用硬编码中文 | medium | ", mutation.memory);     deps().refreshCacheFreshness(context);     writeLine(ou... |
| 607 | 默认值使用硬编码中文 | medium | ",   );   deps().refreshCacheFreshness(context);   return run; }  export async f... |
| 620 | 默认值使用硬编码中文 | medium | ");   context.memory.projectRulesExists = true;   context.memory.projectRulesSum... |
| 635 | 默认值使用硬编码中文 | medium | ").trim() \|\| basename(context.projectPath);   const summary = `AI sessions impor... |
| 645 | 默认值使用硬编码中文 | medium | ",     `外部会话导入线索：${source} / ${query}`,     " |

### packages/tui/src/meta-scheduler-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 506 | 默认值使用硬编码中文 | medium | "先压缩上下文" |
| 509 | 默认值使用硬编码中文 | medium | "准备 fallback 候选" |
| 528 | 默认值使用硬编码中文 | medium | "         ? `suggest ${decision.modelRouteSignal.suggestedRole}`         : `建议 $... |
| 538 | 默认值使用硬编码中文 | medium | "保持当前路线" |
| 539 | 默认值使用硬编码中文 | medium | "     ? `strategy: ${summary}; task ${decision.taskKind}; risk ${decision.riskLe... |
| 559 | 默认值使用硬编码中文 | medium | "; }): FailureLearningContractResult {   if (!input.decision.shouldCaptureFailur... |
| 678 | 默认值使用硬编码中文 | medium | ",       ...(options.memorySummary ? { summary: options.memorySummary } : {}),  ... |
| 704 | 默认值使用硬编码中文 | medium | 't understand\|do not understand\|explain\|what does .* mean\|why\b\|how should i und... |
| 734 | 默认值使用硬编码中文 | medium | "] {   if (     /(?:验证\|复检\|测试\|typecheck\|lint\|build\|test\|verify\|verification\|claim... |
| 738 | 默认值使用硬编码中文 | medium | ";   }   if (/(?:智能体\|子智能体\|\bagent\b\|\bfork\b\|multi-agent\|多开)/iu.test(userText)) ... |
| 741 | 默认值使用硬编码中文 | medium | ";   }   if (/(?:工作流\|\bworkflow\b\|\bjob\b\|流水线)/iu.test(userText)) {     return " |
| 747 | 默认值使用硬编码中文 | medium | ";   }   if (     /(?:实现\|修复\|修改\|更新\|新增\|删除\|写入\|创建\|改动\|edit\|write\|modify\|update\|fix\|im... |
| 754 | 默认值使用硬编码中文 | medium | ";   }   if (     /(?:源码\|代码事实\|文件\|读取\|定位\|调用链\|source\|code\|file\|read\|grep\|search\|ins... |
| 773 | 默认值使用硬编码中文 | medium | ") \|\|     /(?:写入\|修改\|更新\|新增\|删除\|创建\|实现\|修复\|提交\|commit\|write\|edit\|modify\|update\|delete\|... |
| 826 | 默认值使用硬编码中文 | medium | ";   }   if (     /(?:provider\|model\|模型\|供应商\|baseUrl\|api[_-]?key\|\bkey\b\|env\|环境变量... |
| 833 | 默认值使用硬编码中文 | medium | ";   }   if (     /(?:文档\|markdown\|frontmatter\|link\|链接\|README\|docs?\/\|\.md\b\|交付文档... |
| 840 | 默认值使用硬编码中文 | medium | ";   }   if (     /(?:\btui\b.*(?:交互\|ui\|render\|renderer\|keyboard\|hotkey\|面板)\|term... |
| 847 | 默认值使用硬编码中文 | medium | ";   }   if (     /(?:智能体\|子智能体\|\bagent\b\|\bfork\b\|\bjob\b\|workflow\|工作流\|后台\|backgr... |
| 857 | 默认值使用硬编码中文 | medium | " \|\|     expectedMutating \|\|     /(?:代码\|源码\|ts\|tsx\|js\|jsx\|test\|typecheck\|lint\|bui... |
| 876 | 默认值使用硬编码中文 | medium | ") return true;   if (input.blockedRuntime \|\| input.toolFailure \|\| input.provide... |
| 1263 | 默认值使用硬编码中文 | medium | "策略：发布风险较高，先做工作树、构建和验证边界检查。" |
| 1264 | 默认值使用硬编码中文 | medium | "策略：先核对源码事实，再给结论。" |
| 1277 | 默认值使用硬编码中文 | medium | "策略：命令优先，减少背景解释。" |
| 1287 | 默认值使用硬编码中文 | medium | "策略：先解释，不直接推进实现。" |
| 1297 | 默认值使用硬编码中文 | medium | "策略：保持讨论和架构判断，不启动代码执行。" |
| 1307 | 默认值使用硬编码中文 | medium | "策略：检测到权限风险，写入前会请求确认。" |
| 1317 | 默认值使用硬编码中文 | medium | "策略：Windows 环境，优先使用兼容命令。" |
| 1327 | 默认值使用硬编码中文 | medium | "策略：源码优先，先读取关键文件。" |
| 1339 | 默认值使用硬编码中文 | medium | "策略：建议先做 focused verification。" |
| 1340 | 默认值使用硬编码中文 | medium | "策略：高风险结论需要验证后再说通过。" |
| 1353 | 默认值使用硬编码中文 | medium | "策略：已有架构卡片，写入会继续走架构边界检查。" |
| 1363 | 默认值使用硬编码中文 | medium | "策略：上下文接近上限，先压缩再请求模型。" |
| 1373 | 默认值使用硬编码中文 | medium | "策略：已有任务阻塞，先检查 workflow/agent 状态。" |
| 1383 | 默认值使用硬编码中文 | medium | "策略：已有后台 agent/job 占用，先避免重复启动。" |
| 1393 | 默认值使用硬编码中文 | medium | "策略：识别为 capability 候选；执行仍走显式命令和权限边界。" |
| 1404 | 默认值使用硬编码中文 | medium | "策略：Provider 最近失败，准备 fallback 候选。" |
| 1414 | 默认值使用硬编码中文 | medium | "策略：Provider 冷却中，暂停本轮请求。" |
| 1424 | 默认值使用硬编码中文 | medium | "策略：参考历史失败，只作为风险提示。" |
| 1434 | 默认值使用硬编码中文 | medium | "策略：带入已接受记忆作为约束。" |

### packages/tui/src/model-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 72 | 默认值使用硬编码中文 | medium | ") {     // D.14D-E — /model doctor 走降噪 CommandPanel：完整诊断进 detailsText     // （C... |
| 82 | 默认值使用硬编码中文 | medium | "模型路由诊断 — Ctrl+O 查看完整诊断。" |
| 95 | 默认值使用硬编码中文 | medium | "用法：/model set <model>" |
| 102 | 默认值使用硬编码中文 | medium | "模型不可用。" |
| 108 | 默认值使用硬编码中文 | medium | ");     writeLine(       output,       `已设置默认模型为 ${resolved.model}（provider ${ro... |
| 129 | 默认值使用硬编码中文 | medium | "建议进 panel   // actions / detailsText（Ctrl+O 展开），不再 writeLine 多行写进 transcript。  ... |
| 133 | 默认值使用硬编码中文 | medium | ";   const reasoningSegment = `reasoning ${runtime.reasoningStatus}`;   const su... |
| 154 | 默认值使用硬编码中文 | medium | "],     detailsText: `${deps().currentModelText(context)}：role ${runtime.role} p... |
| 192 | 默认值使用硬编码中文 | medium | " ? text : trimmed;   if (/^(cancel\|no\|n\|取消\|否)$/iu.test(trimmed)) {     context.... |
| 195 | 默认值使用硬编码中文 | medium | ", context.language, setup));     return;   }   if (/^(details\|detail\|详情)$/iu.te... |
| 249 | 默认值使用硬编码中文 | medium | ") {       if (/^(yes\|y\|save\|ok\|confirm\|确认\|保存\|是)$/iu.test(value)) {         cons... |
| 259 | 默认值使用硬编码中文 | medium | ", context.language, setup));       return;     }   } catch (error) {     writeL... |
| 282 | 默认值使用硬编码中文 | medium | ",       summary: [         isEn           ? `Model routes · ${context.config.mo... |
| 293 | 默认值使用硬编码中文 | medium | ") {     // D.14D-E — /model route doctor 走降噪 CommandPanel：完整诊断进 detailsText。   ... |
| 302 | 默认值使用硬编码中文 | medium | "模型路由诊断 — Ctrl+O 查看完整诊断。" |
| 318 | 默认值使用硬编码中文 | medium | "用法：/model route set <planner\|executor\|reviewer\|verifier\|summarizer\|vision\|image... |
| 326 | 默认值使用硬编码中文 | medium | "模型不可用。" |
| 331 | 默认值使用硬编码中文 | medium | ") {       context.model = route.primaryModel \|\| context.model;     }     writeL... |
| 336 | 默认值使用硬编码中文 | medium | "}`,     );     if (resolved.legacyAlias) {       writeLine(         output,    ... |
| 344 | 默认值使用硬编码中文 | medium | " && context.config.defaultModel !== route.primaryModel) {       writeLine(     ... |
| 351 | 默认值使用硬编码中文 | medium | "vision role 只输出 VisionObservation evidence，不写代码、不执行 Bash。" |
| 354 | 默认值使用硬编码中文 | medium | "image role 只生成本地资产路径和 evidence，不改代码、不执行 Bash。" |
| 358 | 默认值使用硬编码中文 | medium | "用法：/model route \| /model route doctor \| /model route set <role> <model>" |

### packages/tui/src/model-doctor-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 70 | 默认值使用硬编码中文 | medium | ";     summary: string;   };   providerBreaker?: ProviderCircuitBreakerState;   ... |
| 78 | 默认值使用硬编码中文 | medium | ": number; mcp: number; skill: number; plugin: number };     executableCount: nu... |
| 196 | 默认值使用硬编码中文 | medium | "}`,     )     .slice(0, 4);   return `角色路由摘要：${routes.length > 0 ? routes.join(... |
| 204 | 默认值使用硬编码中文 | medium | "Model routes（多模型按角色触发，不默认乱开）" |
| 216 | 默认值使用硬编码中文 | medium | "提示：/model route doctor 诊断缺 provider、能力不足和预算配置。" |
| 248 | 默认值使用硬编码中文 | medium | "; }  // D.13J Block 1：检查任意 provider / role route 是否仍在使用占位 / 未成熟模型名。 // `default... |
| 280 | 默认值使用硬编码中文 | medium | "模型路由诊断" |
| 293 | 默认值使用硬编码中文 | medium | "} (provider.env / complete shell env can select the fresh-project default route... |
| 297 | 默认值使用硬编码中文 | medium | ",     );   }   // D.13J Block 1：占位 / 未成熟模型名 doctor 标记。   // deepseek-v4-flash /... |
| 312 | 默认值使用硬编码中文 | medium | "}] (这些是占位/未成熟模型名；smoke 前请用 LINGHUN_DEEPSEEK_MODEL/LINGHUN_DEFAULT_MODEL 替换为现役模型... |
| 318 | 默认值使用硬编码中文 | medium | "}; system ttl ${context.config.promptCache.systemTtl} (5m 默认 cache_control 无 tt... |
| 325 | 默认值使用硬编码中文 | medium | "]}; mcp ${summary.byKind.mcp}; skill ${summary.byKind.skill}; plugin ${summary.... |
| 329 | 默认值使用硬编码中文 | medium | "的可见性问题。   // discoveredDeferredToolNames 是 session-scoped Set；session 重启即清零。   ... |
| 339 | 默认值使用硬编码中文 | medium | ";       lines.push(         `- discovered deferred tools: total ${ds.total}; na... |
| 352 | 默认值使用硬编码中文 | medium | ");     const reasoningLevel = provider.reasoningLevel;     // D.13L Block A — d... |
| 355 | 默认值使用硬编码中文 | medium | "（生效路径）     //   " |
| 356 | 默认值使用硬编码中文 | medium | "（缺省）     //   " |
| 357 | 默认值使用硬编码中文 | medium | "（不生效）     // 技术字段（effective/sent level High，路径详情）仍写在同一行的括号里，     // 避免再开一段；既不破坏... |
| 370 | 默认值使用硬编码中文 | medium | "未配置推理等级" |
| 372 | 默认值使用硬编码中文 | medium | "           ? `Reasoning ${reasoningLevel} sent`           : `推理 ${reasoningLeve... |
| 375 | 默认值使用硬编码中文 | medium | "           ? `Reasoning ${reasoningLevel} not sent (gateway or model rejects it... |
| 383 | 默认值使用硬编码中文 | medium | "             ? `effective/sent level ${reasoningLevel}`             : `ignored/... |
| 386 | 默认值使用硬编码中文 | medium | ";     // 顺序保持 technical 在前，让诊断仍容易搜索；human-readable 段放在括号里，     // 给普通用户当主语义看。  ... |
| 397 | 默认值使用硬编码中文 | medium | "。     // 仅作只读摘要追加，不改 contract / endpointProfile / endpointPath 主行的信号。     const... |
| 412 | 默认值使用硬编码中文 | medium | "    openai-compatible endpoint hint: root baseUrl + responses 可能可用；chat_complet... |
| 420 | 默认值使用硬编码中文 | medium | "anthropic_messages profile 已原生支持 tools，但当前 provider 显式声明 supports tools false；如... |
| 427 | 默认值使用硬编码中文 | medium | ",       );     }     // D.13F：Anthropic prompt cache 可观察字段说明（与 promptCache.enab... |
| 439 | 默认值使用硬编码中文 | medium | "         }; usage fields cache_creation.ephemeral_5m_input_tokens/ephemeral_1h_... |
| 453 | 默认值使用硬编码中文 | medium | "} (cache_edits/cache_reference body 字段 hard-disabled)`,       );     }     if (... |
| 468 | 默认值使用硬编码中文 | medium | ",       );       lines.push(`    recommendation: ${baseUrlDiagnostic.recommenda... |
| 496 | 默认值使用硬编码中文 | medium | "- 最近路由决策：" |
| 519 | 默认值使用硬编码中文 | medium | ",         );       }     } else {       lines.push(         `- 最近模型服务失败：类型 ${hu... |
| 527 | 默认值使用硬编码中文 | medium | "- 额度/余额说明：这是上游错误分类，不是 Linghun 查询余额的结果。" |
| 544 | 默认值使用硬编码中文 | medium | ";     lines.push(       isEn         ? `- last fallback attempt: ${statusText};... |
| 558 | 默认值使用硬编码中文 | medium | "- openai-compatible 占位提示：请检查 .linghun/settings.json，避免 openai-compatible-model ... |
| 562 | 默认值使用硬编码中文 | medium | "- budget: 未配置预算只作为 WARN；金额仅在 /usage 或 /stats 中以 estimated 展示，状态栏不会显示金额。" |
| 565 | 默认值使用硬编码中文 | medium | "- handoff: 角色间只传 summary/evidence/diff/verification/keyFiles，不传完整 transcript/me... |
| 585 | 默认值使用硬编码中文 | medium | "; }  // -----------------------------------------------------------------------... |
| 602 | 默认值使用硬编码中文 | medium | ");   }   for (const fallbackModel of route.fallbackModels) {     const fallback... |
| 623 | 默认值使用硬编码中文 | medium | "权限过宽：不应写文件" |
| 629 | 默认值使用硬编码中文 | medium | "权限过宽：不应执行 Bash" |
| 643 | 默认值使用硬编码中文 | medium | "缺 provider" |
| 651 | 默认值使用硬编码中文 | medium | "openai-compatible 缺 baseUrl" |
| 652 | 默认值使用硬编码中文 | medium | "openai-compatible 缺 apiKey" |
| 654 | 默认值使用硬编码中文 | medium | "openai-compatible 缺已确认模型" |
| 660 | 默认值使用硬编码中文 | medium | "能力不足：tools/tool calling" |
| 671 | 默认值使用硬编码中文 | medium | " {   const primaryProblems = diagnoseConcreteRoute(route, route.primaryModel, r... |
| 707 | 默认值使用硬编码中文 | medium | ") \|\|         // D.13J tail fix（Block D）：placeholder 模型属于 blocking，不能被当成可用 route... |

### packages/tui/src/model-loop-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 20 | 默认值使用硬编码中文 | medium | "外部当前事实没有  * web_source 证据时不得断言" |
| 179 | 默认值使用硬编码中文 | medium | " } } },   }; }  // D.13I：Self-built deferred tools。两个固定 schema 工具，进入 toolSchema... |
| 376 | 默认值使用硬编码中文 | medium | "],   }; }  export function createDeferredToolDispatchDefinitions(): ModelToolDe... |
| 441 | 默认值使用硬编码中文 | medium | "时调用真实工具，     // 而不是文本冒充执行，也不是本地 NL 正则；mutating 刷新/修复走权限确认。     ...createIndexTo... |
| 502 | 默认值使用硬编码中文 | medium | " ? value : undefined; }  // ---------------------------------------------------... |
| 510 | 默认值使用硬编码中文 | medium | "：用 /最新\|当前\|今天\|now\|version\|.../ 关键词 // 误伤普通中英文输入（" |
| 511 | 默认值使用硬编码中文 | medium | "提示硬追加到 assistant // 末尾，污染 transcript。 // // 反幻觉边界改放在 system prompt + evidence r... |
| 516 | 默认值使用硬编码中文 | medium | "在 system prompt 里规定不能断言； // - 本地事实（git/branch、文件、配置）走本地工具证据，不需要 web_source。  //... |
| 733 | 默认值使用硬编码中文 | medium | ";   matchedClaims: FinalAnswerClaimMatch[];   unsupportedKinds: FinalAnswerClai... |
| 738 | 默认值使用硬编码中文 | medium | " 且确有过期证据被忽略时出现；不影响 D.13U 的现有判定语义。   staleKinds?: FinalAnswerClaimKind[]; };  ex... |
| 742 | 默认值使用硬编码中文 | medium | ";  // D.13V-A — 按 claim 类型分级的 evidence 过期阈值（毫秒）。null 表示不应用过期判断。 // 阈值依据真实工程节奏： ... |
| 747 | 默认值使用硬编码中文 | medium | "不安全。 // - external_current_fact：web_source 24 小时内变化大；超 24h 不再当" |
| 748 | 默认值使用硬编码中文 | medium | "。 // - ccb_parity：与文件版本快照绑定，不按时间过期。 // - beta_readiness：由 createPhase15BetaVerd... |
| 765 | 默认值使用硬编码中文 | medium | "声明，   // 绑定到本会话真实成功 evidence；执行成功通常 30 分钟内有效，超时按需重新验证。   action_executed: 30 * ... |
| 876 | 默认值使用硬编码中文 | medium | ")     .toLowerCase(); }  function claimWindow(text: string, phrase: string): st... |
| 895 | 默认值使用硬编码中文 | medium | " &&       /(?:typecheck\|type\s+check\|tsc\|类型检查)/iu.test(claimWindow(text, phrase... |
| 904 | 默认值使用硬编码中文 | medium | " && /(?:build\|构建)/iu.test(claimWindow(text, phrase)))   ); }  function isDiffCh... |
| 912 | 默认值使用硬编码中文 | medium | " &&       /(?:diff[-\s]?check\|git\s+diff\s+--check)/iu.test(claimWindow(text, p... |
| 921 | 默认值使用硬编码中文 | medium | " && /(?:smoke\|冒烟)/iu.test(claimWindow(text, phrase)))   ); }  function evidence... |
| 1087 | 默认值使用硬编码中文 | medium | "的 evidence 支撑。要求一条 command_output // 类 evidence，且它不是 tool_failure / denied / ca... |
| 1098 | 默认值使用硬编码中文 | medium | ")) {     return false;   }   // 非零退出的 Bash 命令" |
| 1102 | 默认值使用硬编码中文 | medium | ")) {     return false;   }   const tokens = evidenceTokens(record);   if (/(?:d... |
| 1140 | 默认值使用硬编码中文 | medium | "Architecture Card 与 drift check" |
| 1245 | 默认值使用硬编码中文 | medium | ") {       supporter = evidenceSupportsActionExecuted;     } else {       // bet... |
| 1300 | 默认值使用硬编码中文 | medium | ")}\uff09\uff0c\u4f46\u5f53\u524d\u4f1a\u8bdd\u6ca1\u6709\u5bf9\u5e94\u7c7b\u578... |
| 1322 | 默认值使用硬编码中文 | medium | "当前证据不足，不能给出已验证的最终结论。" |
| 1325 | 默认值使用硬编码中文 | medium | "我可以继续调用工具补齐证据，或只给出不包含已验证完成声明的有限结论。" |
| 1452 | 默认值使用硬编码中文 | medium | "当前证据不足，不能给出已验证的架构或完整性结论。" |
| 1455 | 默认值使用硬编码中文 | medium | "我可以继续补齐支撑，或只给出不包含闭合性声明的有限结论。" |

### packages/tui/src/model-prompt-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 13 | 默认值使用硬编码中文 | medium | "; const MEMORY_PROMPT_TOP_K = 3;  export function createModelSystemPrompt(   te... |
| 39 | 默认值使用硬编码中文 | medium | ";   // D.14B — FailureLearningSummary 是历史风险提示，不是已发生/已修复事实，不构成 completion eviden... |
| 49 | 默认值使用硬编码中文 | medium | "你是 Linghun 工程型 AI 编程助手，具备工具调用能力。默认用中文回答，除非用户明确指定其他语言。涉及代码事实必须先有证据，避免未验证断言。自然语言命... |
| 53 | 默认值使用硬编码中文 | medium | "OutputStyle=summary-first; 主屏用人话、少内部术语；错误提示给下一步；details/debug 保留高级信息。涉及前端/UI 开发... |
| 57 | 默认值使用硬编码中文 | medium | "EngineeringStructure=默认不把逻辑堆进已有大文件。避免 god file、code blob、超长函数（>200行）、深层嵌套（>3层）、... |
| 61 | 默认值使用硬编码中文 | medium | "ShellEnvironment=执行或建议 Bash 命令前必须尊重当前本地 OS 和 shell。Windows/PowerShell 下优先使用 Pow... |
| 86 | 默认值使用硬编码中文 | medium | "最近同类权限拒绝已记录；普通任务继续走 model/tool loop，必要时给短 hint 或让用户查看 /permissions recent。" |
| 92 | 默认值使用硬编码中文 | medium | "; }  export function collectSolutionCompletenessEvidenceRefs(context: TuiContex... |
| 104 | 默认值使用硬编码中文 | medium | "时）。 const INTERNAL_PROMPT_TOKENS = [   " |
| 181 | 默认值使用硬编码中文 | medium | " }], ] as const;  /**  * D.14D — main-screen prompt hygiene sanitizer。  *  * 在 ... |
| 189 | 默认值使用硬编码中文 | medium | "整行降级为一条人话提示，避免把内部  * 运行时上下文 token 泄漏到主屏。  *  * 设计约束：  *   - 只处理" |
| 193 | 默认值使用硬编码中文 | medium | "这种明确泄漏形态，不误伤普通  *     正文里偶然出现的同名英文单词（必须带 `=` 或 `:` 且后面有内容）。  *   - 不删除 doctor/d... |
| 206 | 默认值使用硬编码中文 | medium | "（行内或多行 JSON dump 的起始行）。   const lineRe = new RegExp(     `^\\s*(?:${tokenAltern... |
| 212 | 默认值使用硬编码中文 | medium | ");   let redacted = false;   const cleaned = lines.filter((line) => {     if (l... |
| 240 | 默认值使用硬编码中文 | medium | "（内部运行时上下文已从主屏省略；需要时用 /model doctor 或 /details 查看。）" |

### packages/tui/src/model-setup-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 45 | 默认值使用硬编码中文 | medium | "; }  // -----------------------------------------------------------------------... |
| 79 | 默认值使用硬编码中文 | medium | "; }  export function looksLikeModelSetupInput(text: string): boolean {   const ... |
| 106 | 硬编码URL | medium | "https://example.com/v1" |
| 150 | 默认值使用硬编码中文 | medium | "模型配置向导" |
| 151 | 默认值使用硬编码中文 | medium | "- 这是本机一次配置；配置后其他仓库会默认复用同一个用户 provider.env。" |
| 152 | 默认值使用硬编码中文 | medium | "- API key 会写入本机用户私密 provider.env，不会写入项目 .linghun/settings.json。" |
| 154 | 默认值使用硬编码中文 | medium | "- 已创建带注释模板，后续可直接编辑这个文件。" |
| 160 | 默认值使用硬编码中文 | medium | "缺少 API 地址。请输入 root API 地址，例如 https://example.com/v1。" |
| 163 | 默认值使用硬编码中文 | medium | "缺少 API key。请输入 API key（输入时会尽量 mask，不显示原值）。" |
| 166 | 默认值使用硬编码中文 | medium | "缺少模型名称。请输入模型名称。" |
| 169 | 默认值使用硬编码中文 | medium | "推理等级可选 Low / Medium / High，默认 Medium。直接回车使用 Medium。" |
| 172 | 默认值使用硬编码中文 | medium | "辅助模型可选，直接回车则跟随主模型。" |
| 175 | 默认值使用硬编码中文 | medium | "请输入 yes 保存，no 取消，details 查看安全说明。" |
| 178 | 默认值使用硬编码中文 | medium | "已取消模型配置，未保存任何 key。" |
| 188 | 默认值使用硬编码中文 | medium | ",           `- provider.env 路径：${setup.providerEnvPath}`,           " |
| 191 | 默认值使用硬编码中文 | medium | "- 真实 key 不会显示、不写入项目 settings、不写入文档或报告。" |
| 192 | 默认值使用硬编码中文 | medium | "- 不设置角色路由也可以正常使用，角色默认跟随主模型。" |
| 201 | 默认值使用硬编码中文 | medium | "检查未通过，请补全缺失项。" |
| 207 | 默认值使用硬编码中文 | medium | "模型配置摘要" |
| 216 | 默认值使用硬编码中文 | medium | "请输入 yes/保存 确认后才会写入；摘要不会显示 key 原值。" |
| 230 | 默认值使用硬编码中文 | medium | "已保存，请重启 Linghun 后使用新的用户级 provider 配置。" |
| 232 | 默认值使用硬编码中文 | medium | "- 这是用户级配置，之后进入其他仓库会默认复用。" |
| 233 | 默认值使用硬编码中文 | medium | "- 后续想更换 API 地址、key 或模型名称，可运行 /model setup，或编辑上述 provider.env。" |
| 234 | 默认值使用硬编码中文 | medium | "- 检查配置可运行 /model doctor。" |

### packages/tui/src/model-stream-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 173 | 默认值使用硬编码中文 | medium | "> {   const gateway = maybeOutput ? (gatewayOrOutput as ModelGateway) : undefin... |
| 182 | 默认值使用硬编码中文 | medium | ";     }     if (/^(yes\|y\|confirm\|ok\|okay\|确认\|是\|继续\|执行)$/iu.test(normalized)) {   ... |
| 189 | 默认值使用硬编码中文 | medium | ";     }     if (/^(no\|n\|deny\|取消\|拒绝\|不\|否\|cancel)$/iu.test(normalized)) {       co... |
| 202 | 默认值使用硬编码中文 | medium | "当前有本地权限审批待处理。输入 yes/确认/继续 可本次允许，输入 no/取消 可拒绝；这条输入不会发送给模型。" |
| 205 | 默认值使用硬编码中文 | medium | ";   }    if (context.pendingNaturalCommand) {     const gate = context.pendingN... |
| 222 | 默认值使用硬编码中文 | medium | ") {       if (/^(yes\|y\|confirm\|确认\|是\|执行\|继续)$/iu.test(text.trim())) {         wri... |
| 237 | 默认值使用硬编码中文 | medium | ";     }     context.pendingNaturalCommand = undefined;   }    if (/^(yes\|y\|conf... |
| 243 | 默认值使用硬编码中文 | medium | ";   }    // D.14D — 模型未配好时的 onboarding 入口（state-gated，不是普通自然语言截胡）。   // 只有当 sho... |
| 252 | 默认值使用硬编码中文 | medium | ";   }    // D.14D — 输入路由边界（参考：plain text 永远进模型，唯一分支是 " |
| 255 | 默认值使用硬编码中文 | medium | " 前缀）。   // 普通自然语言（不以 " |
| 256 | 默认值使用硬编码中文 | medium | " 开头、无 pending approval / 无 pending Start Gate）默认必须   // 发送给模型。这里**不再**做任何本地 NL ... |
| 258 | 默认值使用硬编码中文 | medium | "等）；   //   - 已移除 index safety repair NL 续跑（" |
| 259 | 默认值使用硬编码中文 | medium | "等）；   //   - 已移除 composite local status NL 应答（" |
| 260 | 默认值使用硬编码中文 | medium | "等）。   // 这些产品能力仍可通过精确 slash command 使用（/trust、/index、/doctor、/status），   // 普通自... |
| 365 | 默认值使用硬编码中文 | medium | ");   if (modelGuard) {     writeLine(output, modelGuard);     // D.14B — 并发上限拒绝... |
| 368 | 默认值使用硬编码中文 | medium | "事件（不是权限拒绝、不是用户取消）。     const guardSessionId = await ensureSession(context);    ... |
| 402 | 默认值使用硬编码中文 | medium | ",   );   const assistantEventId = randomUUID();   // 当 output 是 ShellBlockOutpu... |
| 421 | 默认值使用硬编码中文 | medium | ",     {       reportPath: reportWriteGuard?.requestedPath,     },   );   const ... |
| 555 | 默认值使用硬编码中文 | medium | "当前 provider/model 不支持 tool calling；本轮降级为纯文本，不发送 tools/toolChoice。可运行 /model doc... |
| 582 | 默认值使用硬编码中文 | medium | "自动压缩后这次请求仍过长。请缩短最新输入或先摘要较早上下文后重试。" |
| 788 | 默认值使用硬编码中文 | medium | ",             content: createReportFinalReferenceReminder(reportWriteGuard, con... |
| 809 | 默认值使用硬编码中文 | medium | ";             // D.13V — 同时清掉本轮 streaming block 累计的违规原文，             // 避免 Ctrl... |
| 880 | 默认值使用硬编码中文 | medium | "计划已记录。请继续执行验证工具（Read/Grep/Bash/GitStatusInspect）或给出尚未验证结论。" |
| 890 | 默认值使用硬编码中文 | medium | "             ? `Execution turn budget exhausted after ${MAX_MODEL_TOTAL_TOOL_RO... |
| 893 | 默认值使用硬编码中文 | medium | "             ? `Execution turn budget exhausted after ${MAX_MODEL_TOTAL_TOOL_RO... |
| 941 | 默认值使用硬编码中文 | medium | ",     );   }    if (reportWriteGuard && !reportWriteGuard.completed) {     cons... |
| 991 | 默认值使用硬编码中文 | medium | ",         );         assistantText = coherentAssistantText;         replaceAssi... |
| 1179 | 默认值使用硬编码中文 | medium | "         ? `Memory: ${count} candidate(s) created; review with /memory review.`... |
| 1219 | 默认值使用硬编码中文 | medium | ",   ); }  async function appendRuntimePolicyHint(   context: TuiContext,   sess... |
| 1449 | 默认值使用硬编码中文 | medium | ", content: currentUserText });   return messages; }  async function budgetRecen... |
| 1482 | 默认值使用硬编码中文 | medium | ";   const textSanitizer = createAssistantPrimaryTextSanitizer(context.language)... |
| 1681 | 默认值使用硬编码中文 | medium | ",       );       assistantText = buildExtendedDowngradedFinalAnswer(         as... |
| 1734 | 默认值使用硬编码中文 | medium | ",   );   const downgraded = buildDowngradedFinalAnswer(assistantText, verdict, ... |
| 1791 | 默认值使用硬编码中文 | medium | "已执行请求的命令。" |
| 1793 | 默认值使用硬编码中文 | medium | "           ? `已修改：${filePath}。`           : `已保存：${filePath}。`         : kind =... |
| 1797 | 默认值使用硬编码中文 | medium | "已修改请求的文件。" |
| 1798 | 默认值使用硬编码中文 | medium | "已保存请求的文件。" |
| 1802 | 默认值使用硬编码中文 | medium | "说明：已用本地证据替换一段自相矛盾的草稿最终回复；该草稿同时声称工具不可用或无法完成修改。" |
| 1803 | 默认值使用硬编码中文 | medium | "); }  function detectContradictorySuccessfulToolClaim(   assistantText: string,... |
| 1872 | 默认值使用硬编码中文 | medium | ";   let finalAnswerClaimRetried = false;   let continuationLoopCompleted = fals... |
| 1926 | 默认值使用硬编码中文 | medium | ",           ...promptCacheFields,         },         controller.signal,       )... |
| 2069 | 默认值使用硬编码中文 | medium | ",             content: createReportFinalReferenceReminder(reportWriteGuard, con... |
| 2090 | 默认值使用硬编码中文 | medium | ";             // D.13V — 同步丢弃 continuation 当前 streaming block 累计的违规原文。         ... |
| 2161 | 默认值使用硬编码中文 | medium | "计划已记录。请继续执行验证工具（Read/Grep/Bash/GitStatusInspect）或给出尚未验证结论。" |
| 2171 | 默认值使用硬编码中文 | medium | "             ? `Continuation execution turn budget exhausted after ${MAX_MODEL_... |
| 2174 | 默认值使用硬编码中文 | medium | "             ? `Continuation execution turn budget exhausted after ${MAX_MODEL_... |
| 2233 | 默认值使用硬编码中文 | medium | ",           );           assistantText = coherentAssistantText;           repla... |
| 2303 | 默认值使用硬编码中文 | medium | ");   // D.14H-F — reasoning-only stream（DeepSeek v4 pro 等 reasoning-first 模型）不再... |
| 2352 | 默认值使用硬编码中文 | medium | "需要使用工具时请发起结构化工具调用。不要把 raw tool protocol、XML、JSON tool_use 块或工具 schema 写成 assist... |
| 2358 | 默认值使用硬编码中文 | medium | "模型再次把工具协议写成了正文。Linghun 没有执行任何非结构化工具请求；请重试或使用明确的 slash 命令。" |

### packages/tui/src/model-tool-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 217 | 默认值使用硬编码中文 | medium | ";  export async function executeModelToolUse(   toolCall: ModelToolCall,   cont... |
| 236 | 默认值使用硬编码中文 | medium | "由其分发到的   // 子工具承担（codebase-memory 只读 + 命令白名单 + required args 校验）。   if (     to... |
| 269 | 默认值使用硬编码中文 | medium | ",       });     }     return gitResult;   }   // D.14D-R P0-2 — 结构化索引工具不走 built... |
| 304 | 默认值使用硬编码中文 | medium | ")}`           : `本次工具调用改变约定范围，需要确认后才能执行：${drift.warnings.join(" |
| 317 | 默认值使用硬编码中文 | medium | "本次工具调用会改变已约定范围。确认后才会运行本工具。" |
| 336 | 默认值使用硬编码中文 | medium | "报告文件生成不开放 Bash；请使用 Write/Edit，避免 shell 输出污染报告正文。" |
| 392 | 默认值使用硬编码中文 | medium | ");     // P0-1 — ink 主屏的提权 UI 必须是 PermissionPanel（pendingLocalApproval →     //... |
| 395 | 默认值使用硬编码中文 | medium | " 当作普通 assistant/output 文本糊到主屏。     // ink ask 路径只设 pendingLocalApproval，由 Permi... |
| 500 | 默认值使用硬编码中文 | medium | " \|\| /report\|报告/u.test(fileName)); }  async function runBoundaryBashPreflight(  ... |
| 550 | 默认值使用硬编码中文 | medium | ");   }   return [     `架构边界检查已暂停 ${preflight.path}。`,     `目标文件已有 ${preflight.l... |
| 595 | 默认值使用硬编码中文 | medium | ",     id: toolCall.id,     name: toolName,     input: toolCall.input,     creat... |
| 630 | 默认值使用硬编码中文 | medium | ")) {       reportWriteGuard.evidenceRead = true;     }     rememberToolFiles(co... |
| 724 | 默认值使用硬编码中文 | medium | ", ): Promise<void> {   await appendSystemEvent(context, sessionId, `policy_tool... |
| 764 | 默认值使用硬编码中文 | medium | "SearchExtraTools: query 必须是字符串（可为空字符串）。" |
| 784 | 默认值使用硬编码中文 | medium | ", {         text: result.text,         data: result.data,       } as ToolOutput... |
| 825 | 默认值使用硬编码中文 | medium | "命令提案必须是明确的 slash command。" |
| 840 | 默认值使用硬编码中文 | medium | "             ? `CommandProposal is not allowed for executable ${structuredTool}... |
| 856 | 默认值使用硬编码中文 | medium | "}`           : `建议命令：${command}${reason ? `（${reason}）` : " |
| 909 | 默认值使用硬编码中文 | medium | ",         `${dispatchName}: ${result.text}`,       );       await appendDeferre... |
| 1343 | 默认值使用硬编码中文 | medium | "     ? `Agent runtime did not start: no AgentRun was persisted after StartAgent... |
| 1690 | 默认值使用硬编码中文 | medium | ";   if (toolName === AGENT_CONTROL_TOOL_NAME) {     const record = isRecord(dat... |
| 1702 | 默认值使用硬编码中文 | medium | ") {       const cancellable = Array.isArray(record.cancellable) ? record.cancel... |
| 1710 | 默认值使用硬编码中文 | medium | "未找到指定后台智能体。" |
| 1712 | 默认值使用硬编码中文 | medium | "已更新后台智能体状态。" |
| 1717 | 默认值使用硬编码中文 | medium | "已启动后台智能体。" |
| 1719 | 默认值使用硬编码中文 | medium | "智能体已完成本次处理。" |
| 1721 | 默认值使用硬编码中文 | medium | "智能体启动结果已记录。" |
| 1725 | 默认值使用硬编码中文 | medium | "已启动后台工作流。" |
| 1726 | 默认值使用硬编码中文 | medium | "工作流已完成。" |
| 1727 | 默认值使用硬编码中文 | medium | "工作流结果已记录。" |
| 1730 | 默认值使用硬编码中文 | medium | ";     return zh       ? `验证已结束：${status \|\| " |
| 1751 | 默认值使用硬编码中文 | medium | "控制操作失败。诊断记录可在 /details 查看。" |
| 1830 | 默认值使用硬编码中文 | medium | ",     context,     sessionId,     output,     permission.preflight,     continu... |
| 1840 | 默认值使用硬编码中文 | medium | "，立即执行。 //   IndexRefresh / IndexRepair（mutating）：进入 pendingLocalApproval（Permis... |
| 1865 | 默认值使用硬编码中文 | medium | ",       id: toolCall.id,       name,       input: toolCall.input,       created... |
| 1892 | 默认值使用硬编码中文 | medium | ", ...evidence });     await appendDeferredToolResultEvent(       context,      ... |
| 1908 | 默认值使用硬编码中文 | medium | ");   const parsed = parseIndexRefreshInput(toolCall.input);   // 复用既有 decidePer... |
| 1968 | 默认值使用硬编码中文 | medium | ",       indexAction: action,       toolCall: { ...toolCall, name: dispatchName ... |
| 2042 | 默认值使用硬编码中文 | medium | ") {     // 复用 /index repair 续跑：追加 ignore 条目后刷新（内部已有 writeLine 摘要）。     await ru... |
| 2059 | 默认值使用硬编码中文 | medium | "}`.trim()       : `索引${action === " |
| 2060 | 默认值使用硬编码中文 | medium | "}未完成：状态 ${context.index.status}。${context.index.error ?? " |
| 2124 | 默认值使用硬编码中文 | medium | "可查看索引状态获取详情。" |
| 2175 | 默认值使用硬编码中文 | medium | ", path: explicit };   }    const recent = context.recentlyMentionedFiles.filter... |
| 2213 | 默认值使用硬编码中文 | medium | ",   );   // D.14B — report guard 未满足转 failure learning。relatedTarget 用脱敏路径基名，不记... |
| 2366 | 默认值使用硬编码中文 | medium | ",       id: callId,       name,       input,       createdAt: new Date().toISOS... |
| 2436 | 默认值使用硬编码中文 | medium | "用法：/read <path>" |
| 2440 | 默认值使用硬编码中文 | medium | "用法：/write <path> <text>" |
| 2444 | 默认值使用硬编码中文 | medium | ") {     const path = requireArg(args[0], `用法：/${name.toLowerCase()} <path> <old... |
| 2447 | 默认值使用硬编码中文 | medium | ");     if (separator < 0) {       throw new Error(`用法：/${name.toLowerCase()} <p... |
| 2459 | 默认值使用硬编码中文 | medium | "用法：/grep <pattern> [path]" |
| 2462 | 默认值使用硬编码中文 | medium | "用法：/glob <pattern> [path]" |
| 2465 | 默认值使用硬编码中文 | medium | "用法：/bash <command>" |
| 2475 | 默认值使用硬编码中文 | medium | "用法：/todo add <text>" |
| 2478 | 默认值使用硬编码中文 | medium | ") {       return { action, id: requireArg(args[1], `用法：/todo ${action} <id>`) }... |
| 2481 | 默认值使用硬编码中文 | medium | ");   }   return {}; }  function requireArg(value: string \| undefined, usage: st... |
| 2571 | 默认值使用硬编码中文 | medium | "正在执行命令" |
| 2581 | 默认值使用硬编码中文 | medium | "长任务已启动。可用 /background 查看详情。" |
| 2585 | 默认值使用硬编码中文 | medium | "等待完成，或用 /interrupt 中断。" |
| 2603 | 默认值使用硬编码中文 | medium | "未找到会话：" |
| 2659 | 默认值使用硬编码中文 | medium | "[stdout] ... 主屏已隐藏后续流式输出；完整输出保留在日志/transcript。\n" |

### packages/tui/src/natural-command-bridge.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 150 | 默认值使用硬编码中文 | medium | ", userVisible: true },   // D.13R Git Readiness — 只读发现层入口（commit/reset/checkout... |
| 216 | 默认值使用硬编码中文 | medium | "显示命令清单。" |
| 218 | 默认值使用硬编码中文 | medium | "了解可用命令或自然语言桥能力。" |
| 228 | 默认值使用硬编码中文 | medium | "显示默认功能策略、推荐底座、高级/危险/未支持边界。" |
| 230 | 默认值使用硬编码中文 | medium | "核对默认功能开关、自动执行边界和权限风险。" |
| 240 | 默认值使用硬编码中文 | medium | "查看 Capability Runtime 的可用能力、连接状态和 mock 执行入口。" |
| 242 | 默认值使用硬编码中文 | medium | "需要查看外部 app/plugin/MCP 能力桥接、doctor 或 mock capability 时使用。" |
| 253 | 默认值使用硬编码中文 | medium | "连接、查看、诊断或断开 Local HTTP Connector app。" |
| 255 | 默认值使用硬编码中文 | medium | "需要把本地外部应用接入 Capability Runtime 时使用。" |
| 266 | 默认值使用硬编码中文 | medium | "查看或切换界面语言。" |
| 268 | 默认值使用硬编码中文 | medium | "需要中英文体验跟随偏好时使用。" |
| 279 | 默认值使用硬编码中文 | medium | "查看当前模型与角色路由；切换路由需要确认。" |
| 281 | 默认值使用硬编码中文 | medium | "询问当前模型、provider、模型风险或路由。" |
| 291 | 默认值使用硬编码中文 | medium | "记录图片观察证据，不直接写代码。" |
| 293 | 默认值使用硬编码中文 | medium | "需要基于图片路径生成 evidence。" |
| 303 | 默认值使用硬编码中文 | medium | "生成本地图片资产 metadata。" |
| 305 | 默认值使用硬编码中文 | medium | "需要图片角色生成资产。" |
| 315 | 默认值使用硬编码中文 | medium | "列出本地 skill 摘要；启用第三方 skill 不直通。" |
| 317 | 默认值使用硬编码中文 | medium | "查看技能是否启用、有什么技能、如何注册技能。" |
| 336 | 默认值使用硬编码中文 | medium | "列出工作流模板；/workflows plan <目标> 生成计划预览。启动模板只展示 Start Gate。" |
| 338 | 默认值使用硬编码中文 | medium | "想知道有哪些工作流或启动 bug-fix/review 模板，或用 /workflows plan 生成计划预览。" |
| 349 | 默认值使用硬编码中文 | medium | "列出本地 plugin manifest 与诊断；启用第三方 plugin 不直通。" |
| 351 | 默认值使用硬编码中文 | medium | "查看插件状态、贡献项、加载错误和信任边界。" |
| 364 | 默认值使用硬编码中文 | medium | "原生 runner" |
| 380 | 默认值使用硬编码中文 | medium | "终端就绪诊断" |
| 382 | 默认值使用硬编码中文 | medium | "显示本地/静态终端就绪、Project Doctor、drift/context/rollback/cost 检查；不运行真实 smoke，也不声明 Beta... |
| 384 | 默认值使用硬编码中文 | medium | "检查 provider、index、cache、memory、MCP、background、verification、freshness、project fa... |
| 394 | 默认值使用硬编码中文 | medium | "显示来自 verification/provider/background/freshness/index/project/drift/context/rol... |
| 396 | 默认值使用硬编码中文 | medium | "查看当前阻塞、超时、stale、provider failure、项目事实缺口、文档漂移或缺少来源证据的问题。" |
| 406 | 默认值使用硬编码中文 | medium | "诊断 hooks 是否开启、来源、timeout、日志和权限边界；启用或执行 hook 不直通。" |
| 408 | 默认值使用硬编码中文 | medium | "询问 hook 开没开或 hook 风险。" |
| 419 | 默认值使用硬编码中文 | medium | "列出当前项目会话。" |
| 421 | 默认值使用硬编码中文 | medium | "查看历史会话或恢复入口。" |
| 431 | 默认值使用硬编码中文 | medium | "从结构化 handoff 恢复会话，不注入完整 transcript。" |
| 433 | 默认值使用硬编码中文 | medium | "想恢复上次会话。" |
| 443 | 默认值使用硬编码中文 | medium | "基于 handoff 创建分支会话。" |
| 445 | 默认值使用硬编码中文 | medium | "想试验另一条思路。" |
| 455 | 默认值使用硬编码中文 | medium | "查看 LINGHUN.md、候选/已接受/禁用记忆、受控注入统计和存储路径；accept/delete/disable 需明确命令。" |
| 457 | 默认值使用硬编码中文 | medium | "询问记忆是否开启、记忆数量、审查、stats 或存储。" |
| 467 | 默认值使用硬编码中文 | medium | "查看从真实失败（provider/工具/验证/git/最终回答降级/报告守卫/并发上限）提取的可复用教训；resolve/ignore 需明确命令。" |
| 469 | 默认值使用硬编码中文 | medium | "想查看历史失败教训、避免重复踩坑，或标记某条已解决/忽略。" |
| 495 | 默认值使用硬编码中文 | medium | "查看或切换权限模式；full-access 不能自然语言直通。" |
| 497 | 默认值使用硬编码中文 | medium | "询问当前权限模式或想切换模式。" |
| 507 | 默认值使用硬编码中文 | medium | "循环常用权限模式。" |
| 509 | 默认值使用硬编码中文 | medium | "只在用户明确要切换常用模式时使用。" |
| 516 | 默认值使用硬编码中文 | medium | "取消当前交互" |
| 517 | 默认值使用硬编码中文 | medium | "取消当前交互" |
| 519 | 默认值使用硬编码中文 | medium | "取消等待中的输入、确认、权限、计划或持续推进确认；不会取消已执行工具。" |
| 521 | 默认值使用硬编码中文 | medium | "需要取消当前等待确认的交互。" |
| 528 | 默认值使用硬编码中文 | medium | "确认当前选择" |
| 529 | 默认值使用硬编码中文 | medium | "确认当前选择" |
| 531 | 默认值使用硬编码中文 | medium | "确认当前显式选择；需要精确确认的危险动作仍不会放行。" |
| 533 | 默认值使用硬编码中文 | medium | "需要用等价 Enter 路径确认当前选择。" |
| 546 | 默认值使用硬编码中文 | medium | "信任这个项目" |
| 547 | 默认值使用硬编码中文 | medium | "调整工作区信任" |
| 553 | 默认值使用硬编码中文 | medium | "查看或设置当前工作区 trust / restricted / untrusted 边界。" |
| 555 | 默认值使用硬编码中文 | medium | "需要查看或调整当前项目的信任状态。" |
| 562 | 默认值使用硬编码中文 | medium | "不用每步都问" |
| 565 | 默认值使用硬编码中文 | medium | "基于现有 durable job 启动有预算、可暂停/取消的持续推进。" |
| 567 | 默认值使用硬编码中文 | medium | "用户明确要求持续推进或不用每步都问。" |
| 577 | 默认值使用硬编码中文 | medium | "生成或确认结构化方案。" |
| 579 | 默认值使用硬编码中文 | medium | "需要先规划再执行。" |
| 589 | 默认值使用硬编码中文 | medium | "查看权限规则；增删规则必须走配置写入/审批边界。" |
| 591 | 默认值使用硬编码中文 | medium | "查看权限、最近拒绝或规则风险。" |
| 602 | 默认值使用硬编码中文 | medium | "查看后台任务摘要、输出路径和取消入口。" |
| 604 | 默认值使用硬编码中文 | medium | "询问长任务状态、日志、取消方式。" |
| 613 | 默认值使用硬编码中文 | medium | "本地 Job" |
| 615 | 默认值使用硬编码中文 | medium | "管理本地 durable job 的 list/run/pause/resume/cancel/status/logs/report；复用后台任务和 evid... |
| 617 | 默认值使用硬编码中文 | medium | "查看或控制长期 job、预算、agent 分配、暂停原因和日志。" |
| 628 | 默认值使用硬编码中文 | medium | "设置、诊断或测试企业微信/飞书/钉钉远程通道；默认关闭，只发送脱敏摘要、审批请求和结果报告。" |
| 630 | 默认值使用硬编码中文 | medium | "需要连接或排查远程通知/审批通道。" |
| 640 | 默认值使用硬编码中文 | medium | "查看 evidence、后台任务和裁剪详情摘要，不把大输出塞回主屏。" |
| 642 | 默认值使用硬编码中文 | medium | "查看证据、工具详情或后台详情。" |
| 649 | 默认值使用硬编码中文 | medium | "停止所有智能体" |
| 652 | 默认值使用硬编码中文 | medium | "查看 agent 状态、transcript、usage 和取消入口。" |
| 654 | 默认值使用硬编码中文 | medium | "查看或解释 agent 状态。" |
| 662 | 默认值使用硬编码中文 | medium | "开 agent" |
| 663 | 默认值使用硬编码中文 | medium | "派生 Agent" |
| 665 | 默认值使用硬编码中文 | medium | "从裁剪 handoff 派生 agent；长任务必须 Start Gate。" |
| 667 | 默认值使用硬编码中文 | medium | "想开 explorer/planner/verifier/worker agent。" |
| 677 | 默认值使用硬编码中文 | medium | "列出或恢复 checkpoint；restore 不自然语言直通。" |
| 679 | 默认值使用硬编码中文 | medium | "查看 checkpoint 或理解恢复风险。" |
| 681 | 默认值使用硬编码中文 | medium | ",   ),   // D.13R Git / Worktree / Stable Point Maturity Sweep — 三个只读发现入口。   //... |
| 693 | 默认值使用硬编码中文 | medium | "只读探测：当前 branch、clean/dirty、改动数、HEAD、稳定点建议、worktree 摘要。" |
| 695 | 默认值使用硬编码中文 | medium | "查看 git 状态、决定要不要做稳定点提交。" |
| 705 | 默认值使用硬编码中文 | medium | "只读列出 git worktree；add/remove/switch 不在此处执行（走 Bash + 权限）。" |
| 707 | 默认值使用硬编码中文 | medium | "查看当前 worktree、其他 worktree 列表。" |
| 717 | 默认值使用硬编码中文 | medium | "查看 Linghun snapshot checkpoint 列表与 stable-point 建议；不是 git reset。" |
| 719 | 默认值使用硬编码中文 | medium | "查看 Linghun 内部快照或获取稳定点建议。" |
| 729 | 默认值使用硬编码中文 | medium | "回答临时问题，不改 Todo/Plan/checkpoint。" |
| 731 | 默认值使用硬编码中文 | medium | "长任务中临时问一个不改变状态的问题。" |
| 741 | 默认值使用硬编码中文 | medium | "标记当前长任务取消。" |
| 743 | 默认值使用硬编码中文 | medium | "要中断正在运行的长任务。" |
| 753 | 默认值使用硬编码中文 | medium | "降级缺证据结论。" |
| 755 | 默认值使用硬编码中文 | medium | "需要核查回答是否有证据。" |
| 765 | 默认值使用硬编码中文 | medium | "生成或运行验证计划。" |
| 767 | 默认值使用硬编码中文 | medium | "想跑测试、typecheck、build 或 verifier。" |
| 777 | 默认值使用硬编码中文 | medium | "审查 diff、风险和验证证据。" |
| 779 | 默认值使用硬编码中文 | medium | "想做一次 review 或看风险。" |
| 789 | 默认值使用硬编码中文 | medium | "查看或导出最近 cache usage 记录。" |
| 791 | 默认值使用硬编码中文 | medium | "需要对账 cache usage 或导出日志。" |
| 802 | 默认值使用硬编码中文 | medium | "查看 cache 命中率与 freshness；refresh 需确认。" |
| 804 | 默认值使用硬编码中文 | medium | "询问缓存命中率、预热或刷新。" |
| 814 | 默认值使用硬编码中文 | medium | "查看或执行受控 Context Compact：provider 请求前可写入脱敏摘要和边界，不执行工具、不写项目文件、不写长期记忆。" |
| 816 | 默认值使用硬编码中文 | medium | "需要查看上下文压力、压缩摘要、pairing 安全或 compact 边界。" |
| 824 | 默认值使用硬编码中文 | medium | "缓存破坏诊断" |
| 826 | 默认值使用硬编码中文 | medium | "查看 cache freshness hash 变化。" |
| 828 | 默认值使用硬编码中文 | medium | "排查为什么缓存命中下降。" |
| 838 | 默认值使用硬编码中文 | medium | "查看 MCP server 状态和稳定工具摘要。" |
| 840 | 默认值使用硬编码中文 | medium | "询问 MCP 是否可用或有哪些工具。" |
| 860 | 默认值使用硬编码中文 | medium | "status/search/architecture 为只读；init fast/refresh 是带安全扫描的本地安全动作；rebuild/force 需要... |
| 862 | 默认值使用硬编码中文 | medium | "询问只读索引状态、搜索代码、架构摘要；普通 init fast/refresh 可安全执行，重建或 force 需精确确认。" |
| 872 | 默认值使用硬编码中文 | medium | "查看 token/cache usage 摘要。" |
| 874 | 默认值使用硬编码中文 | medium | "询问 token、usage 或账单口径。" |
| 884 | 默认值使用硬编码中文 | medium | "查看本地 cache/cost 统计。" |
| 886 | 默认值使用硬编码中文 | medium | "查看总体统计或 endpoint 聚合。" |
| 905 | 默认值使用硬编码中文 | medium | "读取文件内容。" |
| 907 | 默认值使用硬编码中文 | medium | "自然语言询问怎么看文件时解释；项目规则读取走只读路径。" |
| 918 | 默认值使用硬编码中文 | medium | "写入文件，必须走权限管道。" |
| 920 | 默认值使用硬编码中文 | medium | "只用于解释风险或显式 slash 命令；自然语言不能直通。" |
| 931 | 默认值使用硬编码中文 | medium | "唯一替换编辑，必须走权限管道。" |
| 933 | 默认值使用硬编码中文 | medium | "只用于解释编辑风险或显式 slash 命令。" |
| 944 | 默认值使用硬编码中文 | medium | "多处编辑，必须走权限管道。" |
| 946 | 默认值使用硬编码中文 | medium | "只用于解释批量编辑风险或显式 slash 命令。" |
| 957 | 默认值使用硬编码中文 | medium | "搜索文本匹配。" |
| 959 | 默认值使用硬编码中文 | medium | "想搜索代码、TODO 或错误信息。" |
| 967 | 默认值使用硬编码中文 | medium | "按模式找文件" |
| 970 | 默认值使用硬编码中文 | medium | "按 glob 匹配文件路径。" |
| 972 | 默认值使用硬编码中文 | medium | "想找文件名或按模式列文件。" |
| 983 | 默认值使用硬编码中文 | medium | "执行 shell 命令，必须权限审批。" |
| 985 | 默认值使用硬编码中文 | medium | "自然语言只能解释风险和审批要求，不能直通执行。" |
| 996 | 默认值使用硬编码中文 | medium | "查看或更新会话任务列表。" |
| 998 | 默认值使用硬编码中文 | medium | "需要可见任务进度。" |
| 1008 | 默认值使用硬编码中文 | medium | "显示本轮工具改动摘要。" |
| 1010 | 默认值使用硬编码中文 | medium | "想看改了什么或 show me the diff。" |
| 1020 | 默认值使用硬编码中文 | medium | "退出 REPL。" |
| 1022 | 默认值使用硬编码中文 | medium | "需要结束当前 REPL。" |
| 1032 | 默认值使用硬编码中文 | medium | "概览当前 model/permission/language/index/MCP/memory/cache/background/remote/hooks/p... |
| 1034 | 默认值使用硬编码中文 | medium | "想一次看清楚 LingHun 的当前配置态势。" |
| 1044 | 默认值使用硬编码中文 | medium | "内部状态栏输出入口。" |
| 1046 | 默认值使用硬编码中文 | medium | "通常由系统自动输出；可用于调试短状态。" |
| 1122 | 默认值使用硬编码中文 | medium | ",       // D.13R: git readiness 的三个只读发现入口归到 diagnostics 组，       // 与 /cache、/c... |
| 1212 | 默认值使用硬编码中文 | medium | " inquiry (是否配好/configured/working/connected)   // about a specific subject (mod... |
| 1500 | 默认值使用硬编码中文 | medium | "我不确定你想做哪件事。请选择一个自然语言方向：" |
| 1501 | 默认值使用硬编码中文 | medium | "];   for (const item of intent.candidates.slice(0, 3)) {     const title = zh ?... |
| 1527 | 默认值使用硬编码中文 | medium | ");   return zh     ? [         `${c.slash}：${c.titleZh}`,         `- 用途：${descr... |
| 1562 | 默认值使用硬编码中文 | medium | ");   }   return [     `已阻止自然语言直通：${c.titleZh}`,     `- 精确动作：${command}`,     `-... |
| 1569 | 默认值使用硬编码中文 | medium | "- 原因：请求来自 Natural Command Bridge；自然语言桥、workflow、agent、plugin、hook、remote 只能生成确认... |
| 1570 | 默认值使用硬编码中文 | medium | "- 回滚方式：先查看 /diff、checkpoint、配置状态，或禁用受影响扩展，再接受后续变更。" |
| 1571 | 默认值使用硬编码中文 | medium | "- 选择：在本地显式输入 slash command、进入 Start Gate，或拒绝并提供反馈；普通自然语言确认不够。" |
| 1572 | 默认值使用硬编码中文 | medium | "- Start Gate 不替代现有权限审批管道。" |
| 1573 | 默认值使用硬编码中文 | medium | "- 本次没有执行。" |
| 1610 | 默认值使用硬编码中文 | medium | "如要继续，请输入精确 slash command；这个动作不能只回复“确认”或 yes。" |
| 1613 | 默认值使用硬编码中文 | medium | "回复 `确认` 继续；输入其他内容则取消。" |
| 1623 | 默认值使用硬编码中文 | medium | "我识别到你想调整工作区信任。是否授权？" |
| 1624 | 默认值使用硬编码中文 | medium | "- Yes：继续进入安全确认路径。" |
| 1625 | 默认值使用硬编码中文 | medium | "- No：取消；不改变工作区信任。" |
| 1626 | 默认值使用硬编码中文 | medium | "- Details：查看 workspace trust 可允许什么，以及哪些安全边界仍然生效。" |
| 1634 | 默认值使用硬编码中文 | medium | ");   }   return [     `可以准备执行：${c?.titleZh ?? " |
| 1638 | 默认值使用硬编码中文 | medium | "后续受保护操作仍会单独审批。" |
| 1655 | 默认值使用硬编码中文 | medium | ";   }   return /^(yes\|y\|confirm\|确认\|是\|执行\|继续)$/iu.test(normalized) ? " |
| 1665 | 默认值使用硬编码中文 | medium | "].includes(c.id) \|\|     /\b(refresh\|init\|enable\|accept\|delete\|restore\|bypass\|fu... |
| 1676 | 默认值使用硬编码中文 | medium | "风险未知；不确定时不要继续。" |
| 1680 | 默认值使用硬编码中文 | medium | "高风险。不能由自然语言直通执行，必须保留精确确认和权限管道。" |
| 1685 | 默认值使用硬编码中文 | medium | "可能使用工具或触及项目状态；任何受保护动作仍会进入工具权限审批。" |
| 1690 | 默认值使用硬编码中文 | medium | "可能修改 Linghun 配置；继续前请确认精确命令，并保留回滚路径。" |
| 1696 | 默认值使用硬编码中文 | medium | "status/search/architecture 为只读；init fast/refresh 是带安全扫描的本地安全动作，会生成本地代码索引；rebuil... |
| 1700 | 默认值使用硬编码中文 | medium | "需要先通过 Start Gate 才会启动等价命令；后续受保护动作仍需审批。" |
| 1702 | 默认值使用硬编码中文 | medium | "只读本地状态检查。" |
| 1717 | 默认值使用硬编码中文 | medium | "不能由自然语言直通执行" |
| 1721 | 默认值使用硬编码中文 | medium | "必须进入工具权限管道" |
| 1725 | 默认值使用硬编码中文 | medium | "需要 Start Gate 确认" |
| 1728 | 默认值使用硬编码中文 | medium | "只读本地状态" |
| 1818 | 默认值使用硬编码中文 | medium | "); }  function isCurrentWorkStatusQuestion(text: string): boolean {   return ( ... |
| 1845 | 默认值使用硬编码中文 | medium | " \| null;   projectRulesRead: boolean;   actionRequest: boolean; };  function cl... |
| 1869 | 默认值使用硬编码中文 | medium | ";   if (     /是否\|开了吗\|enabled\|status\|状态\|当前\|现在\|什么模型\|哪个模型\|用的哪个\|命中\|hit rate\|list\|有哪... |
| 1875 | 默认值使用硬编码中文 | medium | ";   }   if (     /key\|api key\|configured\|connected\|working\|doctor\|诊断\|配好了吗\|配置正常\|... |
| 1884 | 默认值使用硬编码中文 | medium | ";   if (/风险\|危险\|safe\|risk\|danger/u.test(text)) return " |
| 1885 | 默认值使用硬编码中文 | medium | ";   if (/怎么\|如何\|用途\|干什么\|what does\|how do i\|how to\|what is/u.test(text)) return " |
| 1899 | 默认值使用硬编码中文 | medium | " && /hook\|hooks\|钩子/u.test(normalized)) {     return catalog.find((item) => item... |
| 1900 | 默认值使用硬编码中文 | medium | ");   }   const registryEntry = SLASH_COMMAND_REGISTRY.find(     (item) => item.... |
| 1942 | 默认值使用硬编码中文 | medium | ") &&     /mcp/u.test(text) &&     /索引\|index/u.test(text) &&     /打开\|开启\|启用\|enabl... |
| 1949 | 默认值使用硬编码中文 | medium | "] {   if (/重建\|重新索引\|重做索引\|清空.*重建\|force rebuild\|rebuild\|reindex/u.test(text)) {   ... |
| 1951 | 默认值使用硬编码中文 | medium | ";   }   if (     /(?:帮我\|请)?.*(?:更新\|刷新\|同步).*索引\|refresh the project index\|update ... |
| 1975 | 默认值使用硬编码中文 | medium | " && /plan\|计划\|规划/u.test(text)) return true;   if ([" |
| 1976 | 默认值使用硬编码中文 | medium | "].includes(id)) {     return /持续推进\|继续做\|不用每步都问\|autopilot\|本地任务\|长期任务\|任务报告\|durable ... |
| 1981 | 默认值使用硬编码中文 | medium | ") {     return /agent\|agents\|智能体\|subagent\|停止\|停掉\|取消\|interrupt\|cancel\|stop\|kill\|有... |
| 2005 | 默认值使用硬编码中文 | medium | ",   ].includes(id); }  function isActionRequest(text: string): boolean {   if (... |
| 2038 | 默认值使用硬编码中文 | medium | " &&     /readiness\|就绪\|体检\|terminal readiness\|project doctor\|doctor project\|conte... |
| 2044 | 默认值使用硬编码中文 | medium | " && /hook\|钩子/u.test(normalized)) score += 3;   if (     capability.id === " |
| 2046 | 默认值使用硬编码中文 | medium | " &&     /bug-fix\|bug fix\|工作流\|workflow\|workflow plan\|工作流计划/u.test(normalized)   ... |
| 2051 | 默认值使用硬编码中文 | medium | " &&     /plan\|计划\|规划/u.test(normalized) &&     /workflow\|工作流/u.test(normalized) ... |
| 2056 | 默认值使用硬编码中文 | medium | " && /缓存\|命中\|hit rate\|cache/u.test(normalized)) score += 3;   if (capability.id =... |
| 2057 | 默认值使用硬编码中文 | medium | " && /记忆\|memory/u.test(normalized)) score += 3;   if (     capability.id === " |
| 2059 | 默认值使用硬编码中文 | medium | " &&     /索引\|index\|搜索代码\|search code\|architecture\|更新\|刷新\|重建\|重新索引\|重做索引\|同步索引/u.test(... |
| 2065 | 默认值使用硬编码中文 | medium | " && /项目规则\|本仓库规则\|linghun\.md\|project rules/u.test(normalized))     score += 8;  ... |
| 2068 | 默认值使用硬编码中文 | medium | " &&     /模型\|model\|provider\|claude\|deepseek\|gpt\|route\|路由/u.test(normalized)   ) ... |
| 2073 | 默认值使用硬编码中文 | medium | " &&     /权限模式\|permission mode\|full-access\|full access\|完全访问\|bypass\|auto-review\|a... |
| 2079 | 默认值使用硬编码中文 | medium | " && /diff\|改动\|差异/u.test(normalized)) score += 3;   if (capability.id === " |
| 2080 | 默认值使用硬编码中文 | medium | " && /review\|审查/u.test(normalized)) score += 3;   if (capability.id === " |
| 2081 | 默认值使用硬编码中文 | medium | " && /搜索代码\|search code\|搜索.*todo/u.test(normalized)) score += 5;   if (     capab... |
| 2083 | 默认值使用硬编码中文 | medium | " &&     /todo\|任务\|task/u.test(normalized) &&     !/搜索代码\|search code\|搜索.*todo\|本地任... |
| 2090 | 默认值使用硬编码中文 | medium | " && /后台\|background\|长任务\|long task/u.test(normalized))     score += 6;   if (capa... |
| 2092 | 默认值使用硬编码中文 | medium | " && /持续推进\|继续做\|不用每步都问\|autopilot/u.test(normalized))     score += 6;   if (capabi... |
| 2094 | 默认值使用硬编码中文 | medium | " && /本地任务\|长期任务\|durable job\|job report/u.test(normalized))     score += 6;   if ... |
| 2096 | 默认值使用硬编码中文 | medium | " && /^任务报告$/u.test(normalized)) score += 6;   if (     capability.id === " |
| 2098 | 默认值使用硬编码中文 | medium | " &&     /远程\|remote\|飞书\|lark\|feishu\|钉钉\|dingtalk\|企业微信\|wecom/u.test(normalized)   )... |
| 2102 | 默认值使用硬编码中文 | medium | " && /按模式找文件\|模式找文件\|find files\|匹配文件/u.test(normalized))     score += 4;   if (cap... |
| 2104 | 默认值使用硬编码中文 | medium | " && /agent\|智能体\|verifier/u.test(normalized)) score += 2;   return score; }  func... |
| 2126 | 默认值使用硬编码中文 | medium | " \|\|     /干什么\|what does\|危险\|risk\|how do i\|怎么/u.test(text)   ); }  function isAmbi... |
| 2137 | 默认值使用硬编码中文 | medium | " \|\|     isActionRequest(text) \|\|     Boolean(extractPermissionMode(text)) \|\|   ... |
| 2171 | 默认值使用硬编码中文 | medium | ") {     if (/好了没\|好了么\|已经.*是吧\|已经.*了吗\|已经建立了吗\|ready\|status\|状态/u.test(normalized)) {... |
| 2173 | 默认值使用硬编码中文 | medium | ";     }     if (/重建\|重新索引\|重做索引\|rebuild\|reindex/u.test(normalized))       return ... |
| 2176 | 默认值使用硬编码中文 | medium | ";     if (/更新\|刷新\|同步索引\|refresh\|update\|sync/u.test(normalized)) return " |
| 2177 | 默认值使用硬编码中文 | medium | ";     if (/build\|建立\|初始化\|创建\|init\|create/u.test(normalized)) return " |
| 2178 | 默认值使用硬编码中文 | medium | ";     if (/architecture\|架构/u.test(normalized)) return " |
| 2179 | 默认值使用硬编码中文 | medium | ";     if (/search\|搜索\|查找\|todo/u.test(normalized)) return " |
| 2183 | 默认值使用硬编码中文 | medium | ") {     if (/plan\|计划\|规划/u.test(normalized)) {       const planGoal = normalized... |
| 2195 | 默认值使用硬编码中文 | medium | ") {     if (       /停止所有\|全部停止\|停掉所有\|取消所有\|全部取消\|stop all\|cancel all\|kill all/u.tes... |
| 2199 | 默认值使用硬编码中文 | medium | ";     }     if (/停止\|停掉\|取消\|interrupt\|cancel\|stop\|kill/u.test(normalized)) return... |
| 2204 | 默认值使用硬编码中文 | medium | " && /add\|remove\|添加\|删除/u.test(normalized))     return " |
| 2216 | 默认值使用硬编码中文 | medium | ") {     if (       /key\|api key\|configured\|connected\|working\|doctor\|诊断\|配好了吗\|配置正... |
| 2222 | 默认值使用硬编码中文 | medium | ";     }     if (/route\|路由/u.test(normalized)) return " |
| 2233 | 默认值使用硬编码中文 | medium | " && /项目规则\|本仓库规则\|linghun\.md\|project rules/u.test(normalized))     return " |
| 2234 | 默认值使用硬编码中文 | medium | ";   return capability.slash; }  function extractPermissionMode(text: string): P... |
| 2239 | 默认值使用硬编码中文 | medium | ";   if (     /auto-review\|auto review\|自动审查\|自动模式\|自动审批\|acceptedits\|accept edits\|接... |
| 2246 | 默认值使用硬编码中文 | medium | 't ask\|dont ask\|不询问/u.test(text)) return " |
| 2246 | 默认值使用硬编码中文 | medium | ";   if (/plan\|计划/u.test(text)) return " |
| 2247 | 默认值使用硬编码中文 | medium | ";   if (/default\|默认/u.test(text)) return " |
| 2259 | 默认值使用硬编码中文 | medium | ",   ];   for (const name of names) {     if (text.includes(name)) return name; ... |
| 2264 | 默认值使用硬编码中文 | medium | ";   if (/审查\|代码审查/u.test(text)) return " |
| 2265 | 默认值使用硬编码中文 | medium | ";   if (/重构/u.test(text)) return " |
| 2266 | 默认值使用硬编码中文 | medium | ";   if (/文档.*代码\|doc to code/u.test(text)) return " |
| 2267 | 默认值使用硬编码中文 | medium | ";   if (/设计.*代码\|design to code/u.test(text)) return " |
| 2268 | 默认值使用硬编码中文 | medium | ";   if (/release\|发布说明/u.test(text)) return " |
| 2269 | 默认值使用硬编码中文 | medium | ";   return null; }  function extractAgentRole(text: string): string \| null {   ... |
| 2274 | 默认值使用硬编码中文 | medium | ";   if (/planner\|计划\|规划/u.test(text)) return " |
| 2275 | 默认值使用硬编码中文 | medium | ";   if (/verifier\|验证\|复检/u.test(text)) return " |
| 2276 | 默认值使用硬编码中文 | medium | ";   if (/worker\|执行\|实现/u.test(text)) return " |
| 2277 | 默认值使用硬编码中文 | medium | ";   return null; }  function extractModelCandidate(text: string): string \| null... |

### packages/tui/src/pending-details-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 28 | 默认值使用硬编码中文 | medium | ")     : [         `工作区信任：${level}`,         `- 已记录：${recorded}`,         `- 持久化... |
| 34 | 默认值使用硬编码中文 | medium | "- restricted/untrusted：只读状态和安全诊断可用；写文件、Bash、插件/skills/hooks 启用、远程通道和长任务会先受限。" |
| 53 | 默认值使用硬编码中文 | medium | "待确认权限详情" |
| 54 | 默认值使用硬编码中文 | medium | "- 动作：更新索引 ignore 文件，然后刷新索引" |
| 57 | 默认值使用硬编码中文 | medium | "- raw content、token、request id 和内部 gate id 已隐藏。" |
| 58 | 默认值使用硬编码中文 | medium | "- 下一步：yes/确认 允许一次；no/cancel/Esc 拒绝。" |
| 72 | 默认值使用硬编码中文 | medium | "待确认权限详情" |
| 75 | 默认值使用硬编码中文 | medium | "- tool input、token、request id 和内部 gate id 已隐藏。" |
| 76 | 默认值使用硬编码中文 | medium | "- 下一步：yes/确认 允许一次；no/cancel/Esc 拒绝。" |
| 90 | 默认值使用硬编码中文 | medium | "待确认：删除 managed worktree" |
| 92 | 默认值使用硬编码中文 | medium | "强制（有未提交改动，将丢失）" |
| 93 | 默认值使用硬编码中文 | medium | "- 动作：git worktree remove（不删分支，不 rm -rf）。" |
| 94 | 默认值使用硬编码中文 | medium | "- raw 路径、token、request id 和内部 id 已隐藏。" |
| 95 | 默认值使用硬编码中文 | medium | "- 下一步：yes/确认 删除一次；no/cancel/Esc 保留。" |
| 108 | 默认值使用硬编码中文 | medium | "待确认：创建稳定点" |
| 109 | 默认值使用硬编码中文 | medium | "- 动作：git commit（已跟踪改动）或 Linghun snapshot（仅未跟踪/干净）" |
| 110 | 默认值使用硬编码中文 | medium | "- 敏感/ignored 文件不会被提交；dirty/path/secret 边界仍生效。" |
| 111 | 默认值使用硬编码中文 | medium | "- raw 路径、token、request id 和内部 id 已隐藏。" |
| 112 | 默认值使用硬编码中文 | medium | "- 下一步：yes/确认 创建一次；no/cancel/Esc 跳过（不创建 commit/snapshot）。" |
| 126 | 默认值使用硬编码中文 | medium | "待确认权限详情" |
| 127 | 默认值使用硬编码中文 | medium | "}（重建代码索引，复用受控的 /index ${action} 路径）`,           " |
| 129 | 默认值使用硬编码中文 | medium | "- raw 路径、token、request id 和内部 gate id 已隐藏。" |
| 130 | 默认值使用硬编码中文 | medium | "- 下一步：yes/确认 允许一次；no/cancel/Esc 拒绝。" |
| 144 | 默认值使用硬编码中文 | medium | "待确认 agent 权限详情" |
| 147 | 默认值使用硬编码中文 | medium | "- 原因：子 agent 请求受保护工具，需要父会话确认。" |
| 148 | 默认值使用硬编码中文 | medium | "- tool input、token、request id 和内部 gate id 已隐藏。" |
| 149 | 默认值使用硬编码中文 | medium | "- 下一步：yes/确认 允许一次；no/cancel/Esc 拒绝。" |
| 161 | 默认值使用硬编码中文 | medium | "待确认权限详情" |
| 163 | 默认值使用硬编码中文 | medium | "- 原因：受保护工具运行前需要审批" |
| 164 | 默认值使用硬编码中文 | medium | "- tool input、token、request id 和内部 gate id 已隐藏。" |
| 165 | 默认值使用硬编码中文 | medium | "- 下一步：yes/确认 允许一次；no/cancel/Esc 拒绝。" |
| 183 | 默认值使用硬编码中文 | medium | "工作区信任详情" |
| 184 | 默认值使用硬编码中文 | medium | "- 信任后 Linghun 可以在当前目录读、改、运行命令。" |
| 185 | 默认值使用硬编码中文 | medium | "- Start Gate、Plan approval 和 permission pipeline 仍然生效。" |
| 186 | 默认值使用硬编码中文 | medium | "- /trust 仍是高级恢复/状态入口，不是普通用户主路径。" |
| 187 | 默认值使用硬编码中文 | medium | "- Yes 继续进入安全确认路径；No/Esc 取消。" |
| 201 | 默认值使用硬编码中文 | medium | "待确认 Start Gate 详情" |
| 205 | 默认值使用硬编码中文 | medium | "需要输入精确命令" |
| 205 | 默认值使用硬编码中文 | medium | "可用 yes/确认 或 /enter" |
| 206 | 默认值使用硬编码中文 | medium | "- raw schema、key、token 和内部 gate id 已隐藏。" |
| 207 | 默认值使用硬编码中文 | medium | "- 下一步：按提示确认，或输入 /esc 取消。" |

### packages/tui/src/permission-approval-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 112 | 默认值使用硬编码中文 | medium | "已取消待确认权限；未写入文件，也未刷新索引。可修改请求后重试。" |
| 113 | 默认值使用硬编码中文 | medium | ") {       writeLine(output, `已取消删除 worktree；「${approval.name}」未被删除。可调整请求后重试。`);... |
| 116 | 默认值使用硬编码中文 | medium | ");     }     writeStatus(output, context);     return;   }   if (context.pendin... |
| 136 | 默认值使用硬编码中文 | medium | "已取消待确认计划；没有进入执行。可重新运行 /plan 或继续说明修改意见。" |
| 147 | 默认值使用硬编码中文 | medium | "Esc 不会停止任务；按 Ctrl+C 或 /interrupt 停止。" |
| 212 | 默认值使用硬编码中文 | medium | "该动作需要输入精确 slash command；/enter 不会绕过精确确认。输入 /esc 可取消。" |
| 237 | 默认值使用硬编码中文 | medium | "当前没有等待确认的显式选择；请提交输入或先发起需要确认的请求。" |
| 280 | 默认值使用硬编码中文 | medium | ",           `- 当前：${context.permissionMode}`,           " |
| 283 | 默认值使用硬编码中文 | medium | "- Shift+Tab 会直接循环切换模式；/mode <mode> 可直接切换。" |
| 284 | 默认值使用硬编码中文 | medium | "- 切换模式不等于绕过硬拒绝；危险动作仍受权限底座约束。" |
| 321 | 默认值使用硬编码中文 | medium | "当前没有待确认计划。先运行 /plan 生成结构化方案。" |
| 328 | 默认值使用硬编码中文 | medium | "用法：/plan accept manual\|auto-review。批准计划不等于授权所有工具；Bash/联网/依赖/权限仍走权限管道。" |
| 347 | 默认值使用硬编码中文 | medium | ",     );     writeLine(       output,       `已确认计划 ${context.activePlan.id} / 方... |
| 358 | 默认值使用硬编码中文 | medium | "当前没有待拒绝计划。先运行 /plan 生成结构化方案。" |
| 370 | 默认值使用硬编码中文 | medium | ");     context.planAccepted = false;     writeLine(output, `已拒绝当前计划并保留 plan 模式。... |
| 383 | 默认值使用硬编码中文 | medium | "最小权限闭环（推荐）" |
| 385 | 默认值使用硬编码中文 | medium | "先用 Read/Grep/Glob/Diff 收集证据" |
| 386 | 默认值使用硬编码中文 | medium | "确认写入文件和风险摘要" |
| 387 | 默认值使用硬编码中文 | medium | "执行工作区内允许的低/中风险改动" |
| 388 | 默认值使用硬编码中文 | medium | "运行最小必要验证" |
| 390 | 默认值使用硬编码中文 | medium | "需要写入时必须离开 plan 或确认计划" |
| 390 | 默认值使用硬编码中文 | medium | "Bash 不会在 auto-review 中自动放行" |
| 395 | 默认值使用硬编码中文 | medium | "保持 plan 模式" |
| 395 | 默认值使用硬编码中文 | medium | "只运行 Read/Grep/Glob/Diff/Todo" |
| 395 | 默认值使用硬编码中文 | medium | "输出建议，不写文件" |
| 396 | 默认值使用硬编码中文 | medium | "不会完成需要落盘的代码改动" |
| 412 | 默认值使用硬编码中文 | medium | "确认执行请运行：/plan accept manual a 或 /plan accept auto-review a；拒绝请运行 /plan reject <... |
| 437 | 默认值使用硬编码中文 | medium | ").AddAllowRuleResult> {   return addAllowRule(context, toolName, risk); }  /** ... |
| 452 | 默认值使用硬编码中文 | medium | ") {     const agent = context.agents.find((item) => item.id === approval.agentI... |
| 573 | 默认值使用硬编码中文 | medium | ") {     // D.14D-R2 P1-1 — 用户确认后真实创建稳定点，并把工具结果回灌模型续轮。     await resolveStablePo... |
| 583 | 默认值使用硬编码中文 | medium | ") {     // D.14D-R P0-2 — 用户确认后真实刷新/修复索引，并把工具结果回灌模型续轮。     const result = await... |
| 641 | 默认值使用硬编码中文 | medium | ") {     await executeImageGeneration(approval, context, output);     if (!conte... |
| 650 | 默认值使用硬编码中文 | medium | "，否则  * " |
| 651 | 默认值使用硬编码中文 | medium | "。**调用方负责清空 pendingLocalApproval**。  */ export async function executePermissionD... |
| 662 | 默认值使用硬编码中文 | medium | ") {     const agent = context.agents.find((item) => item.id === approval.agentI... |
| 716 | 默认值使用硬编码中文 | medium | "已拒绝权限。本轮未写入文件，也未刷新索引。" |
| 829 | 默认值使用硬编码中文 | medium | ") {     // D.14D-R2 P1-1 — 拒绝稳定点：不创建 commit/snapshot，回灌" |
| 830 | 默认值使用硬编码中文 | medium | "给模型。     await resolveStablePointDeny(       approval,       context,       out... |
| 840 | 默认值使用硬编码中文 | medium | ") {     // D.14D-R P0-2 — 拒绝索引刷新/修复：记录失败，回灌" |
| 841 | 默认值使用硬编码中文 | medium | "工具结果给模型，     // 让 final answer 不会声称索引已刷新。     const evidence = await recordTool... |
| 925 | 默认值使用硬编码中文 | medium | "已拒绝权限。本轮未写入或删除记忆文件。" |
| 941 | 默认值使用硬编码中文 | medium | "已拒绝权限。本轮未修改 break-cache marker。" |
| 957 | 默认值使用硬编码中文 | medium | "已拒绝权限。本轮未写入 image metadata。" |
| 980 | 默认值使用硬编码中文 | medium | "已清空最近拒绝记录。" |
| 986 | 默认值使用硬编码中文 | medium | "用法：/permissions recent delete <id>" |
| 1006 | 默认值使用硬编码中文 | medium | "最近没有拒绝记录。" |
| 1034 | 默认值使用硬编码中文 | medium | "用法：/permissions add allow\|ask\|deny <tool\|*> [low\|medium\|high]" |
| 1037 | 默认值使用硬编码中文 | medium | ") {       // D.13E Step 2 修正 #4：复用 addAllowRule helper（去重 + 失败回滚 + 审计文案）       ... |
| 1044 | 默认值使用硬编码中文 | medium | " && !(toolName in builtInTools)) {       writeLine(output, `未知工具：${toolName}`);... |
| 1057 | 默认值使用硬编码中文 | medium | "用法：/permissions remove <id>" |
| 1071 | 默认值使用硬编码中文 | medium | "用法：/permissions \| /permissions add \| /permissions remove \| /permissions recent" |

### packages/tui/src/permission-continuation-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 80 | 默认值使用硬编码中文 | medium | "已拒绝。本轮未写入文件，模型会收到拒绝结果并继续调整。" |
| 92 | 默认值使用硬编码中文 | medium | ");   return `工具 ${name}；目标：${targets}；风险：${risk}`; }  export function formatDif... |
| 101 | 默认值使用硬编码中文 | medium | ");   return `写入前摘要：将执行 ${name}\n将影响文件：${fileText}\n风险：${risk}\n原因：工作区内工具操作；本阶段展... |
| 124 | 默认值使用硬编码中文 | medium | ")] : []; }  export function getHardDenyReason(   name: ToolName,   input: unkno... |
| 135 | 默认值使用硬编码中文 | medium | ")     // 检查。为保守起见，单独 hard-deny。     if (file.startsWith(" |
| 137 | 默认值使用硬编码中文 | medium | ") \|\| /@SSL@\d+\|@\d+@SSL/iu.test(file)) {       return `安全保护：UNC / WebDAV / 远程路径... |
| 142 | 默认值使用硬编码中文 | medium | " && !builtInTools[name].isReadOnly)) {       return `路径越界或指向工作区根：${file}。只允许操作当... |
| 147 | 默认值使用硬编码中文 | medium | "安全保护：禁止修改 .git 目录。" |
| 154 | 默认值使用硬编码中文 | medium | "安全保护：疑似密钥或敏感路径，需要更高阶段的安全流程处理。" |
| 161 | 默认值使用硬编码中文 | medium | "Bash 命令不能为空。" |
| 168 | 默认值使用硬编码中文 | medium | "安全保护：拒绝高风险删除、远程脚本执行或系统级命令。" |
| 200 | 默认值使用硬编码中文 | medium | "当前没有持久化权限规则。可用 /permissions add allow\|ask\|deny <tool\|*> [risk] 添加。" |
| 211 | 默认值使用硬编码中文 | medium | "最近没有拒绝记录。" |
| 238 | 默认值使用硬编码中文 | medium | ",     pathExplicit: Boolean(requestedPath),     completed: false,     reminderS... |
| 280 | 默认值使用硬编码中文 | medium | "); }  export function shouldSendReportEvidenceReminder(guard: ReportWriteGuard ... |
| 312 | 默认值使用硬编码中文 | medium | "     ? `The report file has been written. Give the final answer now: reference ... |
| 318 | 默认值使用硬编码中文 | medium | "     ? `Task-specific completion requirement for this turn only: the user expli... |
| 324 | 默认值使用硬编码中文 | medium | "     ? `The user explicitly asked you to generate and save a report file. No sa... |
| 380 | 默认值使用硬编码中文 | medium | " ? `Report saved: ${changedFile}` : `报告已保存：${changedFile}`;   }   if (toolName ... |
| 383 | 默认值使用硬编码中文 | medium | "报告文件写入已完成。" |
| 386 | 默认值使用硬编码中文 | medium | "       ? `${toolName} completed; continuing the report analysis.`       : `${to... |
| 420 | 默认值使用硬编码中文 | medium | ")       // D.14E — 绝对路径不得出站。Windows 盘符路径与常见 Unix 根路径都脱敏，避免       // 泄漏本地工作区位置；只... |

### packages/tui/src/permission-policy-engine.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 347 | 默认值使用硬编码中文 | medium | ",         pathSafety: classifyInputPath(req),         reason: `${req.toolName} ... |
| 360 | 默认值使用硬编码中文 | medium | ",         reason: `${req.toolName} 在内置工具定义中即为只读；engine 复述其判断。`,         redacte... |
| 368 | 默认值使用硬编码中文 | medium | ",         reason: `未识别的工具 ${req.toolName}，保守要求权限确认。`,         redactedSummary: ... |
| 388 | 默认值使用硬编码中文 | medium | "空 Bash 命令；保守要求权限确认。" |
| 397 | 默认值使用硬编码中文 | medium | "命令引用敏感路径或密钥命名；不自动放行。" |
| 406 | 默认值使用硬编码中文 | medium | "命令包含环境变量展开；不自动放行。" |
| 416 | 默认值使用硬编码中文 | medium | "命令含组合符 / 重定向 / 嵌套 shell / 编码命令；不自动放行。" |
| 427 | 默认值使用硬编码中文 | medium | "无法解析 Bash 命令 token；保守要求权限确认。" |
| 432 | 默认值使用硬编码中文 | medium | ";   const args = tokens.slice(1);   const semantic = classifyBashHead(head, arg... |
| 437 | 默认值使用硬编码中文 | medium | " 形式覆盖原始命令字符串；这是 allow_always_tool 的   // 命中键，避免因为 -m / --no-edit / 文件路径等微小差异导致每... |
| 455 | 默认值使用硬编码中文 | medium | "node 本地脚本路径不在工作区普通文件范围内；不自动放行。" |
| 472 | 默认值使用硬编码中文 | medium | ",             reason: `${head} 读取工作区内文件，自动放行。`,             redactedSummary,   ... |
| 482 | 默认值使用硬编码中文 | medium | "               ? `${head} 命中敏感路径；不自动放行。`               : `${head} 路径在工作区外或无法判定；... |
| 493 | 默认值使用硬编码中文 | medium | "wc 未提供可判定的工作区文件路径；不自动放行。" |
| 501 | 默认值使用硬编码中文 | medium | ",       reason: `${head} 是只读命令；自动放行。`,       redactedSummary,     };   }    ret... |
| 518 | 默认值使用硬编码中文 | medium | ") return pathArgs;   const firstPath = pathArgs[0];   return firstPath ? [first... |
| 535 | 默认值使用硬编码中文 | medium | "  *  * 子命令清单与 classifyGitSubcommand 一致，保持权限语义和持久化键的对齐。  */ function buildStable... |
| 541 | 默认值使用硬编码中文 | medium | ";   // worktree / remote / stash / config 这类多动词子命令，把第二个非 flag token   // 也带上（" |
| 543 | 默认值使用硬编码中文 | medium | "），这是用户授权时关心的真实意图。   if (sub === " |
| 553 | 默认值使用硬编码中文 | medium | ":       return `${head} 属于破坏性命令；保守要求权限确认。`;     case " |
| 555 | 默认值使用硬编码中文 | medium | ":       return `${head} 会发起网络访问；保守要求权限确认。`;     case " |
| 557 | 默认值使用硬编码中文 | medium | ":       return `${head} 会安装/卸载或拉取依赖；保守要求权限确认。`;     case " |
| 559 | 默认值使用硬编码中文 | medium | ":       return `${head} 会改写本地文件或系统状态；保守要求权限确认。`;     case " |
| 561 | 默认值使用硬编码中文 | medium | ":       return `${head} 触及敏感数据；保守要求权限确认。`;     case " |
| 563 | 默认值使用硬编码中文 | medium | ":       return `${head} 越界访问；保守要求权限确认。`;     default:       return `${head} 当前未... |
| 769 | 默认值使用硬编码中文 | medium | "Read 缺少 path 字段；保守要求权限确认。" |
| 779 | 默认值使用硬编码中文 | medium | "Read 工作区内普通文件；自动放行。" |
| 789 | 默认值使用硬编码中文 | medium | "Read 命中敏感路径；不自动放行。" |
| 790 | 默认值使用硬编码中文 | medium | "Read 路径在工作区外或无法判定；不自动放行。" |
| 805 | 默认值使用硬编码中文 | medium | "deferred 工具 manifest 声明只读；自动放行。" |
| 813 | 默认值使用硬编码中文 | medium | "deferred / MCP / ExecuteExtraTool 默认要求权限确认。" |

### packages/tui/src/permission-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 30 | 默认值使用硬编码中文 | medium | "需要先确认权限" |
| 35 | 默认值使用硬编码中文 | medium | "- 下一步：输入 yes/确认/继续 可本次允许；输入 no/取消/Esc 可拒绝；输入 details/详情 查看安全摘要。工具尚未执行。" |
| 50 | 默认值使用硬编码中文 | medium | ");   }   if (isReportWrite) {     return [`写入 ${files}`, " |
| 53 | 默认值使用硬编码中文 | medium | ");   }   return [`Linghun 想执行 ${action}。`, " |
| 74 | 默认值使用硬编码中文 | medium | ").pop() ?? file;   return /\.md$/.test(fileName) && (/report\|报告/.test(fileName)... |
| 84 | 默认值使用硬编码中文 | medium | "高 — 可能执行命令或改变重要状态" |
| 85 | 默认值使用硬编码中文 | medium | "中 — 可能修改工作区文件" |
| 86 | 默认值使用硬编码中文 | medium | "低 — 只读或仅影响当前会话" |

### packages/tui/src/process-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 50 | 默认值使用硬编码中文 | medium | "),         summary: `命令超时：${redactedPath(command)}`,       });     }, timeoutMs... |

### packages/tui/src/provider-circuit-breaker.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 150 | 默认值使用硬编码中文 | medium | ");   }   return [     `模型服务 ${providerId}/${model} 暂时不稳定，正在等待恢复。`,     `约 ${sec... |
| 172 | 默认值使用硬编码中文 | medium | "           ? `${entry.providerId}/${entry.model} waiting=${seconds}s reason=${e... |
| 181 | 默认值使用硬编码中文 | medium | "模型服务等待恢复" |

### packages/tui/src/remote-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 50 | 默认值使用硬编码中文 | medium | ",   ) => Promise<void>;   ensureSession: (context: TuiContext) => Promise<strin... |
| 102 | 默认值使用硬编码中文 | medium | ") {     // D.13Q-UX Task Surface — /remote status 默认走降噪 CommandPanel。     const... |
| 108 | 默认值使用硬编码中文 | medium | "}` : `远程 ${enabled ? " |
| 112 | 默认值使用硬编码中文 | medium | "尚未诊断 — 运行 /remote doctor。" |
| 130 | 默认值使用硬编码中文 | medium | ",     );     // D.14D-E — /remote doctor 走降噪 CommandPanel：完整诊断进 detailsText。   ... |
| 139 | 默认值使用硬编码中文 | medium | "远程诊断 — Ctrl+O 查看详情。" |
| 145 | 默认值使用硬编码中文 | medium | ") {     // D.14D-E — /remote setup 引导信息走降噪 CommandPanel：完整步骤进 detailsText。     ... |
| 153 | 默认值使用硬编码中文 | medium | "远程接入现在推荐 /remote bot setup <channel> — Ctrl+O 查看详情。" |
| 167 | 默认值使用硬编码中文 | medium | "Remote test：未识别通道。用法：/remote test feishu\|wecom\|dingtalk" |
| 182 | 默认值使用硬编码中文 | medium | ",     );     // D.14D-E — /remote test 结果走降噪 CommandPanel：完整结果进 detailsText。   ... |
| 189 | 默认值使用硬编码中文 | medium | "           ? `Remote test ${channel.id} · ${result.status} — Ctrl+O for details... |
| 200 | 默认值使用硬编码中文 | medium | "Remote disable：未识别通道。用法：/remote disable feishu\|wecom\|dingtalk" |
| 209 | 默认值使用硬编码中文 | medium | ");     // D.14D-E — /remote disable 结果走降噪 CommandPanel：完整结果进 detailsText。     s... |
| 215 | 默认值使用硬编码中文 | medium | "           ? `Remote channel disabled: ${channel.id} — Ctrl+O for details.`    ... |
| 228 | 默认值使用硬编码中文 | medium | "           ? `Recent remote events: ${context.remote.events.length} — Ctrl+O fo... |
| 250 | 默认值使用硬编码中文 | medium | "用法：/remote bot doctor\|setup\|start\|stop\|pair\|inbox <channel> \| /remote setup <ch... |
| 289 | 默认值使用硬编码中文 | medium | "Remote bot start：未识别 Feishu Bot 配置。" |
| 353 | 默认值使用硬编码中文 | medium | "Remote bot pair：未识别通道。用法：/remote bot pair feishu\|dingtalk\|wechat" |
| 389 | 默认值使用硬编码中文 | medium | "用法：/remote bot doctor [channel] \| /remote bot setup feishu\|dingtalk\|wechat \| /r... |
| 425 | 默认值使用硬编码中文 | medium | "         ? `Remote inbox: ${context.remote.inbox.length} queued — Ctrl+O for de... |
| 462 | 默认值使用硬编码中文 | medium | "Remote bridge start：未识别通道。用法：/remote bridge start feishu" |
| 466 | 默认值使用硬编码中文 | medium | "Remote bridge start：当前只支持 feishu/lark 长连接。" |
| 483 | 默认值使用硬编码中文 | medium | "Remote bridge：未识别通道。用法：/remote bridge doctor\|pair\|start\|test-inbound\|test-appro... |
| 496 | 默认值使用硬编码中文 | medium | "绑定被阻断：webhook 只能通知，不能真实绑定。" |
| 535 | 默认值使用硬编码中文 | medium | "           ? `Bridge ${channel.id}: ${report.readiness} — Ctrl+O for details.` ... |
| 549 | 默认值使用硬编码中文 | medium | "             ? `Bridge fixture blocked: ${report.readiness} — Ctrl+O for detail... |
| 587 | 默认值使用硬编码中文 | medium | "           ? `Bridge fixture ${channel.id}: ${decision.status} — Ctrl+O for det... |
| 602 | 默认值使用硬编码中文 | medium | "用法：/remote bridge doctor\|pair\|start\|test-inbound\|test-approval\|test-status feis... |
| 793 | 默认值使用硬编码中文 | medium | "Remote events：暂无远程事件。运行 /remote test <channel> 发送一条脱敏测试摘要。" |
| 795 | 默认值使用硬编码中文 | medium | "Remote events（最近在前，仅脱敏摘要，不含 secret/endpoint/正文）" |
| 807 | 默认值使用硬编码中文 | medium | "}；失败会降级为 disabled/blocked，不阻塞主 TUI。`,     " |
| 823 | 默认值使用硬编码中文 | medium | "Secrets/endpoints are redacted. webhook/webhook_mock 仅单向通知；审批/自然语言回传需官方 CLI/应用入... |
| 844 | 默认值使用硬编码中文 | medium | "Remote Bot doctor：请选择 feishu、dingtalk 或 wechat。" |
| 847 | 默认值使用硬编码中文 | medium | "Remote Bot doctor（普通视图只显示 Bot 状态；底层 bridge 诊断请用 /remote bridge doctor）" |
| 892 | 默认值使用硬编码中文 | medium | "Remote Bot setup：请选择 feishu、dingtalk 或 wechat。示例：/remote bot setup feishu" |
| 1026 | 默认值使用硬编码中文 | medium | ";  // D.14E — 按平台真实能力分级（基于官方文档事实，不臆测）。webhook/webhook_mock // 恒为单向通知；只有官方 CLI 通... |
| 1040 | 默认值使用硬编码中文 | medium | "webhook 单向投递摘要；不能接收审批或消息回传" |
| 1046 | 默认值使用硬编码中文 | medium | "官方 CLI 仅用于出站通知；inboundMode=none 未开启入站" |
| 1053 | 默认值使用硬编码中文 | medium | "Feishu/Lark 入站需要 appId/appSecret 引用和事件订阅配置；未配置不能显示 ready" |
| 1058 | 默认值使用硬编码中文 | medium | "官方应用事件/回调或 CLI 消费可接入审批与自然语言；真实手机入站仍需 callback/daemon" |
| 1065 | 默认值使用硬编码中文 | medium | "企业微信入站需要应用回调或 CLI poll 凭证；未配置显示 needs-wecom-app" |
| 1070 | 默认值使用硬编码中文 | medium | "应用回调/CLI poll 可接收自然语言；webhook 仍仅通知" |
| 1076 | 默认值使用硬编码中文 | medium | "钉钉入站/审批需要应用或 Stream 配置；未配置显示 needs-dingtalk-app" |
| 1081 | 默认值使用硬编码中文 | medium | "应用/Stream 配置后可做审批回传；实时消息需 daemon 或 callback" |
| 1088 | 默认值使用硬编码中文 | medium | "Remote setup：请选择 feishu、wecom 或 dingtalk。示例：/remote setup feishu" |
| 1094 | 默认值使用硬编码中文 | medium | " : ` — ${hint}`}`;   const lines = [     `Remote setup：${channel.id}（默认不自动启用；只需... |
| 1103 | 默认值使用硬编码中文 | medium | ",         Boolean(config.endpoint),         `配置脱敏 webhook 地址（${getRemoteLoginHi... |
| 1113 | 默认值使用硬编码中文 | medium | "企业微信群机器人无独立签名，安全性来自 URL key（可留空）" |
| 1114 | 默认值使用硬编码中文 | medium | "填环境变量名（如 LINGHUN_REMOTE_FEISHU_SECRET），不要粘贴明文" |
| 1127 | 默认值使用硬编码中文 | medium | "appIdRef/appSecretRef 或 tokenRef" |
| 1130 | 默认值使用硬编码中文 | medium | "填环境变量引用，不填明文；未配置时 bridge 显示 needs-app-setup" |
| 1135 | 默认值使用硬编码中文 | medium | "入站模式 inboundMode" |
| 1137 | 默认值使用硬编码中文 | medium | "poll=CLI 拉取消息 / callback=已部署回调端点；none 仅出站通知" |
| 1141 | 默认值使用硬编码中文 | medium | "绑定用户 bindingUserId" |
| 1141 | 默认值使用硬编码中文 | medium | "填手机端可信用户 id" |
| 1144 | 默认值使用硬编码中文 | medium | "绑定设备 bindingDeviceId" |
| 1146 | 默认值使用硬编码中文 | medium | "可选；填了则审批/入站会校验设备" |
| 1151 | 默认值使用硬编码中文 | medium | "可信来源 trustedSources" |
| 1153 | 默认值使用硬编码中文 | medium | "至少添加一个可信来源 id，否则通道保持 blocked" |
| 1159 | 默认值使用硬编码中文 | medium | "回调端点 callbackEndpoint" |
| 1161 | 默认值使用硬编码中文 | medium | "仅 inboundMode=callback 需要；poll 模式可留空" |
| 1171 | 默认值使用硬编码中文 | medium | "Feishu/Lark 公网 callback 需要事件回调校验引用；长连接不需要" |
| 1199 | 默认值使用硬编码中文 | medium | "检测 lark-cli / feishu-cli；未初始化请运行 feishu-cli config init 或 lark-cli auth login。" |
| 1202 | 默认值使用硬编码中文 | medium | "检测 dws；未登录请运行 dws auth login 或 dws device login。" |
| 1204 | 默认值使用硬编码中文 | medium | "检测 wecom-cli；未初始化请运行 wecom-cli init，然后检查 auth/login 状态。" |
| 1251 | 默认值使用硬编码中文 | medium | ";   }   context.remote.events.unshift(next);   context.remote.events = context.... |
| 1388 | 默认值使用硬编码中文 | medium | "); }  // D.14E — 入站消息的签名/等价证明校验。手机回传由手机端自带 messageId/nonce， // 无对应出站 event，因此独立... |
| 1404 | 默认值使用硬编码中文 | medium | "); }  // D.14E — 远程入站统一入口。三类入站（approval_response / natural_language_message / /... |
| 1419 | 默认值使用硬编码中文 | medium | ") {     // plan 模式恒只读：远程 approve 不能执行任何写操作。pending approval 在 plan     // 模式下只会... |
| 1446 | 默认值使用硬编码中文 | medium | ",         evidenceCreated: false,       };     }     // D.14E 小返修 — 必须校验被引用的 ap... |
| 1519 | 默认值使用硬编码中文 | medium | ");   }   // 入站能力分级：webhook / webhook_mock 恒为 notification-only；只有官方 CLI poll   ... |

### packages/tui/src/remote-inbound-bridge-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 730 | 默认值使用硬编码中文 | medium | "); }  function parseBindCode(text: string): string \| undefined {   const match ... |

### packages/tui/src/remote-mcp-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 5 | 默认值使用硬编码中文 | medium | "}；仅发送脱敏摘要/审批请求/结果报告。`,     " |
| 14 | 默认值使用硬编码中文 | medium | "- webhook_mock：diagnostic/test-only dry run，不代表真实 remote delivery PASS。" |
| 16 | 默认值使用硬编码中文 | medium | "- 主路径：/remote setup <channel> -> /remote test <channel> -> /remote status" |
| 26 | 默认值使用硬编码中文 | medium | "mock 演练（非真实投递）" |
| 40 | 默认值使用硬编码中文 | medium | "- 本测试只使用脱敏摘要；webhook_mock 仅为诊断演练，不代表真实外网回调服务器已接入。" |
| 47 | 默认值使用硬编码中文 | medium | "MCP tools：暂无稳定工具摘要。可运行 /mcp doctor 检测本机 server；不会输出完整 tool schema。" |
| 50 | 默认值使用硬编码中文 | medium | "MCP tools（稳定排序摘要，不输出完整 schema）" |
| 51 | 默认值使用硬编码中文 | medium | "- placeholder 表示安全占位摘要：未加载、未信任、不可执行真实 schema；schema loaded 只有在 discovery/doctor... |

### packages/tui/src/remote-transport.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 88 | 默认值使用硬编码中文 | medium | ",text:{content}}. // 加签: sign = urlEncode(base64(HMAC_SHA256(key = secret, msg ... |

### packages/tui/src/request-lifecycle-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 36 | 默认值使用硬编码中文 | medium | ") {     return `正在检查项目证据，随后把报告保存到 ${reportPath}。`;   }   if (phase === " |
| 40 | 默认值使用硬编码中文 | medium | "模型仍在等待响应。可用 /interrupt 中断本次请求。" |
| 42 | 默认值使用硬编码中文 | medium | ") {     return `正在运行 ${toolName}…`;   }   if (phase === " |
| 46 | 默认值使用硬编码中文 | medium | "工具结果已回传，正在继续生成…" |
| 49 | 默认值使用硬编码中文 | medium | "正在等待你的批准；模型请求已暂停。" |
| 90 | 默认值使用硬编码中文 | medium | "模型服务触发限流。本次请求未完成；请降低请求频率或稍后重试。若已配置备用模型，Linghun 会尝试切换。可运行 /model doctor 查看详情。" |
| 93 | 默认值使用硬编码中文 | medium | "模型服务返回额度、点数或账户余额不足。本次请求未完成；请充值或检查账单，或切换密钥、服务商或模型。Linghun 没有查询余额，只是根据上游错误分类。可运行 ... |
| 96 | 默认值使用硬编码中文 | medium | "当前网关或模型不接受推理参数。请降低推理等级或更换网关/模型。可运行 /model doctor 查看详情。" |
| 99 | 默认值使用硬编码中文 | medium | "模型服务拒绝了密钥或权限。本次请求未完成；请检查密钥、账号权限或当前服务商/模型配置。可运行 /model doctor 查看详情。" |
| 102 | 默认值使用硬编码中文 | medium | "接口或模型不存在。本次请求未完成；请检查服务地址、接口类型和模型名称。可运行 /model doctor 查看详情。" |
| 105 | 默认值使用硬编码中文 | medium | "上游模型服务或网关暂时异常，本次请求未完成。请稍后重试，或运行 /model doctor 查看详情。" |
| 108 | 默认值使用硬编码中文 | medium | "响应流传输失败，本次请求未完成。可能是模型服务、网关传输或本地兼容层问题；请稍后重试，或运行 /model doctor 和 /details evidenc... |
| 111 | 默认值使用硬编码中文 | medium | "等待模型响应过久，本次请求未完成。稍后重试，或运行 /model doctor 查看详情。" |
| 114 | 默认值使用硬编码中文 | medium | "已中断本次请求，可以继续输入。" |
| 117 | 默认值使用硬编码中文 | medium | "模型服务拒绝了请求格式：接口类型、工具选择、工具结果或推理设置不兼容。请运行 /model doctor 查看详情。" |
| 119 | 默认值使用硬编码中文 | medium | "模型请求未完成。可运行 /model doctor 查看详情后重试。" |
| 132 | 默认值使用硬编码中文 | medium | ") {     return `Fallback attempt: the primary model failed with ${formatProvide... |
| 144 | 默认值使用硬编码中文 | medium | "额度或余额不足" |
| 145 | 默认值使用硬编码中文 | medium | "请求格式不兼容" |
| 146 | 默认值使用硬编码中文 | medium | "密钥或权限问题" |
| 147 | 默认值使用硬编码中文 | medium | "接口或模型不存在" |
| 148 | 默认值使用硬编码中文 | medium | "服务端或网关异常" |
| 152 | 默认值使用硬编码中文 | medium | "推理设置不兼容" |
| 153 | 默认值使用硬编码中文 | medium | "模型请求失败" |
| 162 | 默认值使用硬编码中文 | medium | "模型没有返回有效回答。可运行 /model doctor 查看详情后重试。" |
| 166 | 默认值使用硬编码中文 | medium | "的通用文案。 export function formatProviderThinkingOnlyResponsePrimary(language: Lang... |
| 170 | 默认值使用硬编码中文 | medium | "模型已返回思考流但没有最终文本。请重试或降低推理等级，可运行 /model doctor 查看详情。" |
| 176 | 默认值使用硬编码中文 | medium | "写报告前需要先读取关键项目证据；未发现 README/package/config 时，请在报告中标记为未确认。" |
| 180 | 默认值使用硬编码中文 | medium | "     ? `Report generation is blocked: no saved report was produced at ${path}.`... |
| 217 | 默认值使用硬编码中文 | medium | " \|\|     /insufficient[_\s-]?quota\|quota\s*(?:exhausted\|exceeded\|limit\|reached)\|... |
| 225 | 默认值使用硬编码中文 | medium | " \|\|     status === 429 \|\|     /\brate\s*limit(?:ed)?\b\|too many requests\|请求过快\|限... |
| 229 | 默认值使用硬编码中文 | medium | ";   }   // 推理参数不被网关/模型接受 —— 必须在 schema 之前分流，否则会被 schema 吞掉。   if (     /thinkin... |
| 235 | 默认值使用硬编码中文 | medium | ";   }   // D.14D-R2 P2-1 — provider/transit 层失败：eventstream/SSE 流解码失败、CRC   // ... |
| 252 | 默认值使用硬编码中文 | medium | " \|\|     status === 401 \|\|     status === 403 \|\|     /api\s*key\|permission\|forbi... |
| 261 | 默认值使用硬编码中文 | medium | " \|\|     status === 404 \|\|     /not[_\s-]?found\|model.*not.*found\|endpoint.*not.... |
| 274 | 默认值使用硬编码中文 | medium | ";   }   if (/TIMEOUT\|timeout\|超时\|等待.*过久/iu.test(text)) {     return " |
| 277 | 默认值使用硬编码中文 | medium | ";   }   if (/AbortError\|aborted\|abort\|中断/iu.test(text) \|\| code === " |
| 286 | 默认值使用硬编码中文 | medium | " \|\|     /schema\|tool_choice\|tools?\|tool_result\|profile mismatch\|endpointProfile... |

### packages/tui/src/runtime-status-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 33 | 默认值使用硬编码中文 | medium | "       ? [`Model ${model}`, `Mode ${mode}`, cache, index, `background ${view.ba... |
| 37 | 默认值使用硬编码中文 | medium | " ? waitState : `确认 ${waitState}`);   }   const line =     language === " |
| 58 | 默认值使用硬编码中文 | medium | "全权限（仍守安全）" |

### packages/tui/src/runtime-status-snapshot.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 132 | 默认值使用硬编码中文 | medium | "当前：没有正在运行的任务。" |
| 139 | 默认值使用硬编码中文 | medium | "         ? `Recent: ${recent.title} ${formatStatus(status, language)} · ${trunc... |
| 208 | 默认值使用硬编码中文 | medium | "当前：正在等待你的确认。" |
| 211 | 默认值使用硬编码中文 | medium | " ? `Current: model request ${status}.` : `当前：模型请求${status}。`; }  function forma... |
| 286 | 默认值使用硬编码中文 | medium | " ? `elapsed ${elapsed}` : `耗时 ${elapsed}`; }  function truncate(value: string, ... |

### packages/tui/src/shell/components/BtwPanel.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * BtwPanel — D.14D model-backed side question  *  * /btw 是 model-backed... |
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * BtwPanel — D.14D model-backed side question  *  * /btw 是 model-backed... |
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * BtwPanel — D.14D model-backed side question  *  * /btw 是 model-backed... |
| 26 | 默认值使用硬编码中文 | medium | "正在询问模型…" |
| 26 | 默认值使用硬编码中文 | medium | "正在询问模型…" |
| 26 | 默认值使用硬编码中文 | medium | "正在询问模型…" |

### packages/tui/src/shell/components/CommandPanel.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * CommandPanel — D.13Q-UX Task Surface Maturity Sweep  *  * 高级 slash 命令... |
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * CommandPanel — D.13Q-UX Task Surface Maturity Sweep  *  * 高级 slash 命令... |
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * CommandPanel — D.13Q-UX Task Surface Maturity Sweep  *  * 高级 slash 命令... |
| 19 | 默认值使用硬编码中文 | medium | "  *   - summary 行走默认色，sections 标题走 theme.muted  *   - actions 走 theme.accent di... |
| 19 | 默认值使用硬编码中文 | medium | "  *   - summary 行走默认色，sections 标题走 theme.muted  *   - actions 走 theme.accent di... |
| 19 | 默认值使用硬编码中文 | medium | "  *   - summary 行走默认色，sections 标题走 theme.muted  *   - actions 走 theme.accent di... |
| 31 | 默认值使用硬编码中文 | medium | "↑/↓ 选择 · Enter 详情 · x 停止 · Esc 关闭" |
| 31 | 默认值使用硬编码中文 | medium | "↑/↓ 选择 · Enter 详情 · x 停止 · Esc 关闭" |
| 31 | 默认值使用硬编码中文 | medium | "↑/↓ 选择 · Enter 详情 · x 停止 · Esc 关闭" |

### packages/tui/src/shell/components/Composer.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 298 | 默认值使用硬编码中文 | medium | "; }  function isWordBoundary(ch: string): boolean {   return /[\s\p{P}]/u.test(... |
| 298 | 默认值使用硬编码中文 | medium | "; }  function isWordBoundary(ch: string): boolean {   return /[\s\p{P}]/u.test(... |
| 298 | 默认值使用硬编码中文 | medium | "; }  function isWordBoundary(ch: string): boolean {   return /[\s\p{P}]/u.test(... |
| 345 | 默认值使用硬编码中文 | medium | " }; }  export function historyUp(history: InputHistory, currentText: string): I... |
| 345 | 默认值使用硬编码中文 | medium | " }; }  export function historyUp(history: InputHistory, currentText: string): I... |
| 345 | 默认值使用硬编码中文 | medium | " }; }  export function historyUp(history: InputHistory, currentText: string): I... |
| 405 | 默认值使用硬编码中文 | medium | "动作；未命中视作" |
| 405 | 默认值使用硬编码中文 | medium | "动作。  */ export function isDoublePressWithin(   lastPressAt: number,   now: numb... |
| 405 | 默认值使用硬编码中文 | medium | "动作；未命中视作" |
| 405 | 默认值使用硬编码中文 | medium | "动作。  */ export function isDoublePressWithin(   lastPressAt: number,   now: numb... |
| 405 | 默认值使用硬编码中文 | medium | "动作；未命中视作" |
| 405 | 默认值使用硬编码中文 | medium | "动作。  */ export function isDoublePressWithin(   lastPressAt: number,   now: numb... |
| 417 | 默认值使用硬编码中文 | medium | " 开头，或 head 改变，则取消粘性。  */ export function shouldUnstickSlashHidden(   prevHead: ... |
| 417 | 默认值使用硬编码中文 | medium | " 开头，或 head 改变，则取消粘性。  */ export function shouldUnstickSlashHidden(   prevHead: ... |
| 417 | 默认值使用硬编码中文 | medium | " 开头，或 head 改变，则取消粘性。  */ export function shouldUnstickSlashHidden(   prevHead: ... |
| 460 | 默认值使用硬编码中文 | medium | ", ];  // D.13Q-UX Real Smoke Fix v2 — E. 旧的 PERMISSION_TEXT_MAP 把 PermissionAct... |
| 460 | 默认值使用硬编码中文 | medium | ", ];  // D.13Q-UX Real Smoke Fix v2 — E. 旧的 PERMISSION_TEXT_MAP 把 PermissionAct... |
| 460 | 默认值使用硬编码中文 | medium | ", ];  // D.13Q-UX Real Smoke Fix v2 — E. 旧的 PERMISSION_TEXT_MAP 把 PermissionAct... |
| 485 | 默认值使用硬编码中文 | medium | ");   const [hintNotice, setHintNotice] = useState<string \| undefined>(undefined... |
| 485 | 默认值使用硬编码中文 | medium | ");   const [hintNotice, setHintNotice] = useState<string \| undefined>(undefined... |
| 485 | 默认值使用硬编码中文 | medium | ");   const [hintNotice, setHintNotice] = useState<string \| undefined>(undefined... |
| 532 | 默认值使用硬编码中文 | medium | ";   const slashCandidates = useMemo(() => {     if (isBareSlash) return getCore... |
| 532 | 默认值使用硬编码中文 | medium | ";   const slashCandidates = useMemo(() => {     if (isBareSlash) return getCore... |
| 532 | 默认值使用硬编码中文 | medium | ";   const slashCandidates = useMemo(() => {     if (isBareSlash) return getCore... |
| 538 | 默认值使用硬编码中文 | medium | " 开头时强制还原。head 改变（" |
| 538 | 默认值使用硬编码中文 | medium | "）也还原。   const lastSlashHeadRef = useRef(slashHeadCurrent);   useEffect(() => { ... |
| 538 | 默认值使用硬编码中文 | medium | " 开头时强制还原。head 改变（" |
| 538 | 默认值使用硬编码中文 | medium | "）也还原。   const lastSlashHeadRef = useRef(slashHeadCurrent);   useEffect(() => { ... |
| 538 | 默认值使用硬编码中文 | medium | " 开头时强制还原。head 改变（" |
| 538 | 默认值使用硬编码中文 | medium | "）也还原。   const lastSlashHeadRef = useRef(slashHeadCurrent);   useEffect(() => { ... |
| 556 | 默认值使用硬编码中文 | medium | ") => {     const next = createEditBuffer(nextText);     bufferRef.current = nex... |
| 556 | 默认值使用硬编码中文 | medium | ") => {     const next = createEditBuffer(nextText);     bufferRef.current = nex... |
| 556 | 默认值使用硬编码中文 | medium | ") => {     const next = createEditBuffer(nextText);     bufferRef.current = nex... |
| 585 | void Promise(潜在rejection) | medium | void onInput({ type: "escape" }) |
| 585 | void Promise(潜在rejection) | medium | void onInput({ type: "escape" }) |
| 585 | void Promise(潜在rejection) | medium | void onInput({ type: "escape" }) |
| 588 | void Promise(潜在rejection) | medium | void onInput({ type: "permission-action", actionId: id }) |
| 588 | 默认值使用硬编码中文 | medium | ", actionId: id });     },     [onInput],   );    // 提示通知（Esc again to clear / C... |
| 588 | void Promise(潜在rejection) | medium | void onInput({ type: "permission-action", actionId: id }) |
| 588 | 默认值使用硬编码中文 | medium | ", actionId: id });     },     [onInput],   );    // 提示通知（Esc again to clear / C... |
| 588 | void Promise(潜在rejection) | medium | void onInput({ type: "permission-action", actionId: id }) |
| 588 | 默认值使用硬编码中文 | medium | ", actionId: id });     },     [onInput],   );    // 提示通知（Esc again to clear / C... |
| 622 | 默认值使用硬编码中文 | medium | "));     if (!joined) return;     const next = bufferInsert(bufferRef.current, j... |
| 622 | 默认值使用硬编码中文 | medium | "));     if (!joined) return;     const next = bufferInsert(bufferRef.current, j... |
| 622 | 默认值使用硬编码中文 | medium | "));     if (!joined) return;     const next = bufferInsert(bufferRef.current, j... |
| 663 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "wheelUp" }) |
| 663 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "wheelUp" }) |
| 663 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "wheelUp" }) |
| 665 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "wheelDown" }) |
| 665 | 默认值使用硬编码中文 | medium | " });         }         return;       }       const buffer = bufferRef.current; ... |
| 665 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "wheelDown" }) |
| 665 | 默认值使用硬编码中文 | medium | " });         }         return;       }       const buffer = bufferRef.current; ... |
| 665 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "wheelDown" }) |
| 665 | 默认值使用硬编码中文 | medium | " });         }         return;       }       const buffer = bufferRef.current; ... |
| 684 | 默认值使用硬编码中文 | medium | ");           return;         }         if (key.return) {           submitPermis... |
| 684 | 默认值使用硬编码中文 | medium | ");           return;         }         if (key.return) {           submitPermis... |
| 684 | 默认值使用硬编码中文 | medium | ");           return;         }         if (key.return) {           submitPermis... |
| 729 | 默认值使用硬编码中文 | medium | ");             return;           }         }         // 其他按键吞掉，避免 buffer 被污染。  ... |
| 729 | 默认值使用硬编码中文 | medium | ");             return;           }         }         // 其他按键吞掉，避免 buffer 被污染。  ... |
| 729 | 默认值使用硬编码中文 | medium | ");             return;           }         }         // 其他按键吞掉，避免 buffer 被污染。  ... |
| 740 | void Promise(潜在rejection) | medium | void onInput({ type: "help-close" }) |
| 740 | void Promise(潜在rejection) | medium | void onInput({ type: "help-close" }) |
| 740 | void Promise(潜在rejection) | medium | void onInput({ type: "help-close" }) |
| 741 | void Promise(潜在rejection) | medium | void onInput({ type: "btw-close" }) |
| 741 | void Promise(潜在rejection) | medium | void onInput({ type: "btw-close" }) |
| 741 | void Promise(潜在rejection) | medium | void onInput({ type: "btw-close" }) |
| 742 | void Promise(潜在rejection) | medium | void onInput({ type: "sessions-close" }) |
| 742 | void Promise(潜在rejection) | medium | void onInput({ type: "sessions-close" }) |
| 742 | void Promise(潜在rejection) | medium | void onInput({ type: "sessions-close" }) |
| 743 | void Promise(潜在rejection) | medium | void onInput({ type: "config-back" }) |
| 743 | void Promise(潜在rejection) | medium | void onInput({ type: "config-back" }) |
| 743 | void Promise(潜在rejection) | medium | void onInput({ type: "config-back" }) |
| 744 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-close" }) |
| 744 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-close" }) |
| 744 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-close" }) |
| 745 | void Promise(潜在rejection) | medium | void onInput({ type: "escape" }) |
| 745 | void Promise(潜在rejection) | medium | void onInput({ type: "escape" }) |
| 745 | void Promise(潜在rejection) | medium | void onInput({ type: "escape" }) |
| 750 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-move", delta: -1 }) |
| 750 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-move", delta: -1 }) |
| 750 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-move", delta: -1 }) |
| 754 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-move", delta: 1 }) |
| 754 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-move", delta: 1 }) |
| 754 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-move", delta: 1 }) |
| 758 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-toggle" }) |
| 758 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-toggle" }) |
| 758 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-toggle" }) |
| 762 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-stop" }) |
| 762 | 默认值使用硬编码中文 | medium | " });             return;           }           return;         }       }       ... |
| 762 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-stop" }) |
| 762 | 默认值使用硬编码中文 | medium | " });             return;           }           return;         }       }       ... |
| 762 | void Promise(潜在rejection) | medium | void onInput({ type: "command-panel-stop" }) |
| 762 | 默认值使用硬编码中文 | medium | " });             return;           }           return;         }       }       ... |
| 771 | 默认值使用硬编码中文 | medium | " 表示进入 paste 路径，包含 pending 期 Enter / Esc /       // 普通字符聚合 / 大 chunk 4 种情况。     ... |
| 771 | 默认值使用硬编码中文 | medium | " 表示进入 paste 路径，包含 pending 期 Enter / Esc /       // 普通字符聚合 / 大 chunk 4 种情况。     ... |
| 771 | 默认值使用硬编码中文 | medium | " 表示进入 paste 路径，包含 pending 期 Enter / Esc /       // 普通字符聚合 / 大 chunk 4 种情况。     ... |
| 773 | 默认值使用硬编码中文 | medium | ") {         // pending 期间 Enter 被吞掉（CCB BaseTextInput 的 paste-blocks-Enter 模式）。... |
| 773 | 默认值使用硬编码中文 | medium | ") {         // pending 期间 Enter 被吞掉（CCB BaseTextInput 的 paste-blocks-Enter 模式）。... |
| 773 | 默认值使用硬编码中文 | medium | ") {         // pending 期间 Enter 被吞掉（CCB BaseTextInput 的 paste-blocks-Enter 模式）。... |
| 776 | 默认值使用硬编码中文 | medium | ");           return;         }         // pending 期间 Esc 主动取消粘贴。         if (pa... |
| 776 | 默认值使用硬编码中文 | medium | ");           return;         }         // pending 期间 Esc 主动取消粘贴。         if (pa... |
| 776 | 默认值使用硬编码中文 | medium | ");           return;         }         // pending 期间 Esc 主动取消粘贴。         if (pa... |
| 837 | void Promise(潜在rejection) | medium | void onInput({ type: "submit", text: submitText }) |
| 837 | void Promise(潜在rejection) | medium | void onInput({ type: "submit", text: submitText }) |
| 837 | void Promise(潜在rejection) | medium | void onInput({ type: "submit", text: submitText }) |
| 846 | void Promise(潜在rejection) | medium | void onInput(             submitText ? { type: "submit", text: submitText } : { ... |
| 846 | void Promise(潜在rejection) | medium | void onInput(             submitText ? { type: "submit", text: submitText } : { ... |
| 846 | void Promise(潜在rejection) | medium | void onInput(             submitText ? { type: "submit", text: submitText } : { ... |
| 847 | 默认值使用硬编码中文 | medium | " },           );           return;         }         // 兜底 — slash owner 内未命中明确... |
| 847 | 默认值使用硬编码中文 | medium | " },           );           return;         }         // 兜底 — slash owner 内未命中明确... |
| 847 | 默认值使用硬编码中文 | medium | " },           );           return;         }         // 兜底 — slash owner 内未命中明确... |
| 861 | void Promise(潜在rejection) | medium | void onInput({ type: "task-suggestion-action", suggestionId: suggestion.id }) |
| 861 | 默认值使用硬编码中文 | medium | ", suggestionId: suggestion.id });         }         return;       }        // M... |
| 861 | void Promise(潜在rejection) | medium | void onInput({ type: "task-suggestion-action", suggestionId: suggestion.id }) |
| 861 | 默认值使用硬编码中文 | medium | ", suggestionId: suggestion.id });         }         return;       }        // M... |
| 861 | void Promise(潜在rejection) | medium | void onInput({ type: "task-suggestion-action", suggestionId: suggestion.id }) |
| 861 | 默认值使用硬编码中文 | medium | ", suggestionId: suggestion.id });         }         return;       }        // M... |
| 872 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "halfPageUp" }) |
| 872 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "halfPageUp" }) |
| 872 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "halfPageUp" }) |
| 876 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "halfPageDown" }) |
| 876 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "halfPageDown" }) |
| 876 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "halfPageDown" }) |
| 880 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "top" }) |
| 880 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "top" }) |
| 880 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "top" }) |
| 884 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "bottom" }) |
| 884 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "bottom" }) |
| 884 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "bottom" }) |
| 906 | 默认值使用硬编码中文 | medium | "));         return;       }        // ─── Submit: Enter（无 shift / fallback modi... |
| 906 | 默认值使用硬编码中文 | medium | "));         return;       }        // ─── Submit: Enter（无 shift / fallback modi... |
| 906 | 默认值使用硬编码中文 | medium | "));         return;       }        // ─── Submit: Enter（无 shift / fallback modi... |
| 919 | void Promise(潜在rejection) | medium | void onInput({ type: "task-suggestion-action", suggestionId: suggestion.id }) |
| 919 | 默认值使用硬编码中文 | medium | ", suggestionId: suggestion.id });             return;           }         }    ... |
| 919 | void Promise(潜在rejection) | medium | void onInput({ type: "task-suggestion-action", suggestionId: suggestion.id }) |
| 919 | 默认值使用硬编码中文 | medium | ", suggestionId: suggestion.id });             return;           }         }    ... |
| 919 | void Promise(潜在rejection) | medium | void onInput({ type: "task-suggestion-action", suggestionId: suggestion.id }) |
| 919 | 默认值使用硬编码中文 | medium | ", suggestionId: suggestion.id });             return;           }         }    ... |
| 935 | 默认值使用硬编码中文 | medium | "正在处理上一条，按 Ctrl+C 可中断，稍后再发。" |
| 935 | 默认值使用硬编码中文 | medium | "正在处理上一条，按 Ctrl+C 可中断，稍后再发。" |
| 935 | 默认值使用硬编码中文 | medium | "正在处理上一条，按 Ctrl+C 可中断，稍后再发。" |
| 948 | void Promise(潜在rejection) | medium | void onInput({ type: "submit", text: submitText }) |
| 948 | void Promise(潜在rejection) | medium | void onInput({ type: "submit", text: submitText }) |
| 948 | void Promise(潜在rejection) | medium | void onInput({ type: "submit", text: submitText }) |
| 957 | void Promise(潜在rejection) | medium | void onInput(submitText ? { type: "submit", text: submitText } : { type: "empty-... |
| 957 | 默认值使用硬编码中文 | medium | " });         return;       }        // Tab — 接受 slash 候选 head（保留 args）。       i... |
| 957 | void Promise(潜在rejection) | medium | void onInput(submitText ? { type: "submit", text: submitText } : { type: "empty-... |
| 957 | 默认值使用硬编码中文 | medium | " });         return;       }        // Tab — 接受 slash 候选 head（保留 args）。       i... |
| 957 | void Promise(潜在rejection) | medium | void onInput(submitText ? { type: "submit", text: submitText } : { type: "empty-... |
| 957 | 默认值使用硬编码中文 | medium | " });         return;       }        // Tab — 接受 slash 候选 head（保留 args）。       i... |
| 967 | 默认值使用硬编码中文 | medium | ";             const next = args ? `${picked.slash}${args}` : `${picked.slash} `... |
| 967 | 默认值使用硬编码中文 | medium | ";             const next = args ? `${picked.slash}${args}` : `${picked.slash} `... |
| 967 | 默认值使用硬编码中文 | medium | ";             const next = args ? `${picked.slash}${args}` : `${picked.slash} `... |
| 979 | void Promise(潜在rejection) | medium | void onInput({ type: "cycle-permission-mode" }) |
| 979 | 默认值使用硬编码中文 | medium | " });         return;       }        // Escape — 分层归属：slash 可见 → 仅隐藏；buffer 非空 →... |
| 979 | void Promise(潜在rejection) | medium | void onInput({ type: "cycle-permission-mode" }) |
| 979 | 默认值使用硬编码中文 | medium | " });         return;       }        // Escape — 分层归属：slash 可见 → 仅隐藏；buffer 非空 →... |
| 979 | void Promise(潜在rejection) | medium | void onInput({ type: "cycle-permission-mode" }) |
| 979 | 默认值使用硬编码中文 | medium | " });         return;       }        // Escape — 分层归属：slash 可见 → 仅隐藏；buffer 非空 →... |
| 999 | 默认值使用硬编码中文 | medium | "再按 Esc 清空输入" |
| 999 | 默认值使用硬编码中文 | medium | "再按 Esc 清空输入" |
| 999 | 默认值使用硬编码中文 | medium | "再按 Esc 清空输入" |
| 1014 | void Promise(潜在rejection) | medium | void onInput({ type: "escape" }) |
| 1014 | void Promise(潜在rejection) | medium | void onInput({ type: "escape" }) |
| 1014 | void Promise(潜在rejection) | medium | void onInput({ type: "escape" }) |
| 1027 | 默认值使用硬编码中文 | medium | ")) {         if ((key.ctrl && key.rightArrow) \|\| key.meta) {           setBuffe... |
| 1027 | 默认值使用硬编码中文 | medium | ")) {         if ((key.ctrl && key.rightArrow) \|\| key.meta) {           setBuffe... |
| 1027 | 默认值使用硬编码中文 | medium | ")) {         if ((key.ctrl && key.rightArrow) \|\| key.meta) {           setBuffe... |
| 1051 | void Promise(潜在rejection) | medium | void onInput({ type: "task-suggestion-move", delta: -1 }) |
| 1051 | void Promise(潜在rejection) | medium | void onInput({ type: "task-suggestion-move", delta: -1 }) |
| 1051 | void Promise(潜在rejection) | medium | void onInput({ type: "task-suggestion-move", delta: -1 }) |
| 1055 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "wheelUp" }) |
| 1055 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "wheelUp" }) |
| 1055 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "wheelUp" }) |
| 1080 | void Promise(潜在rejection) | medium | void onInput({ type: "task-suggestion-move", delta: 1 }) |
| 1080 | void Promise(潜在rejection) | medium | void onInput({ type: "task-suggestion-move", delta: 1 }) |
| 1080 | void Promise(潜在rejection) | medium | void onInput({ type: "task-suggestion-move", delta: 1 }) |
| 1084 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "wheelDown" }) |
| 1084 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "wheelDown" }) |
| 1084 | void Promise(潜在rejection) | medium | void onInput({ type: "transcript-scroll", action: "wheelDown" }) |
| 1140 | 默认值使用硬编码中文 | medium | ") {         setBufferAndResetSelection(bufferDeleteWordLeft(buffer));         r... |
| 1140 | 默认值使用硬编码中文 | medium | ") {         setBufferAndResetSelection(bufferDeleteWordLeft(buffer));         r... |
| 1140 | 默认值使用硬编码中文 | medium | ") {         setBufferAndResetSelection(bufferDeleteWordLeft(buffer));         r... |
| 1159 | 默认值使用硬编码中文 | medium | "再按 Ctrl+C 清空输入" |
| 1159 | 默认值使用硬编码中文 | medium | "再按 Ctrl+C 清空输入" |
| 1159 | 默认值使用硬编码中文 | medium | "再按 Ctrl+C 清空输入" |
| 1164 | void Promise(潜在rejection) | medium | void onInput({ type: "interrupt" }) |
| 1164 | 默认值使用硬编码中文 | medium | " });         return;       }        // Ctrl+V — 终端 host 通常拦截系统粘贴；这里不写入 " |
| 1164 | void Promise(潜在rejection) | medium | void onInput({ type: "interrupt" }) |
| 1164 | 默认值使用硬编码中文 | medium | " });         return;       }        // Ctrl+V — 终端 host 通常拦截系统粘贴；这里不写入 " |
| 1164 | void Promise(潜在rejection) | medium | void onInput({ type: "interrupt" }) |
| 1164 | 默认值使用硬编码中文 | medium | " });         return;       }        // Ctrl+V — 终端 host 通常拦截系统粘贴；这里不写入 " |
| 1168 | 默认值使用硬编码中文 | medium | "。       // 真实粘贴会进 paste 路径（looksLikePasteChunk 已处理）。       if (key.ctrl && inpu... |
| 1168 | 默认值使用硬编码中文 | medium | "。       // 真实粘贴会进 paste 路径（looksLikePasteChunk 已处理）。       if (key.ctrl && inpu... |
| 1168 | 默认值使用硬编码中文 | medium | "。       // 真实粘贴会进 paste 路径（looksLikePasteChunk 已处理）。       if (key.ctrl && inpu... |
| 1170 | 默认值使用硬编码中文 | medium | ") {         return;       }        // D.13Q-UX Ctrl+O — 查看完整内容：派发 toggle-detail... |
| 1170 | 默认值使用硬编码中文 | medium | ") {         return;       }        // D.13Q-UX Ctrl+O — 查看完整内容：派发 toggle-detail... |
| 1170 | 默认值使用硬编码中文 | medium | ") {         return;       }        // D.13Q-UX Ctrl+O — 查看完整内容：派发 toggle-detail... |
| 1175 | 默认值使用硬编码中文 | medium | "**，避免       // transcript 命令行里冒出 ❯ /details；/details slash 仍保留为兼容命令，       // 但... |
| 1175 | 默认值使用硬编码中文 | medium | "**，避免       // transcript 命令行里冒出 ❯ /details；/details slash 仍保留为兼容命令，       // 但... |
| 1175 | 默认值使用硬编码中文 | medium | "**，避免       // transcript 命令行里冒出 ❯ /details；/details slash 仍保留为兼容命令，       // 但... |
| 1180 | void Promise(潜在rejection) | medium | void onInput({ type: "toggle-details" }) |
| 1180 | 默认值使用硬编码中文 | medium | " });         return;       }        // 其他 ctrl/meta 不处理       if (key.ctrl \|\| k... |
| 1180 | void Promise(潜在rejection) | medium | void onInput({ type: "toggle-details" }) |
| 1180 | 默认值使用硬编码中文 | medium | " });         return;       }        // 其他 ctrl/meta 不处理       if (key.ctrl \|\| k... |
| 1180 | void Promise(潜在rejection) | medium | void onInput({ type: "toggle-details" }) |
| 1180 | 默认值使用硬编码中文 | medium | " });         return;       }        // 其他 ctrl/meta 不处理       if (key.ctrl \|\| k... |
| 1267 | 默认值使用硬编码中文 | medium | "Tab 选中 · ↑↓ 切换 · Esc 隐藏 · Enter 提交" |
| 1267 | 默认值使用硬编码中文 | medium | "Tab 选中 · ↑↓ 切换 · Esc 隐藏 · Enter 提交" |
| 1267 | 默认值使用硬编码中文 | medium | "Tab 选中 · ↑↓ 切换 · Esc 隐藏 · Enter 提交" |
| 1303 | 默认值使用硬编码中文 | medium | "]; }): React.ReactNode {   // D.13Q-UX Real Smoke Fix v2 — F. 主屏降噪：   //   - he... |
| 1303 | 默认值使用硬编码中文 | medium | "]; }): React.ReactNode {   // D.13Q-UX Real Smoke Fix v2 — F. 主屏降噪：   //   - he... |
| 1303 | 默认值使用硬编码中文 | medium | "]; }): React.ReactNode {   // D.13Q-UX Real Smoke Fix v2 — F. 主屏降噪：   //   - he... |
| 1312 | 默认值使用硬编码中文 | medium | ";   const summaryLine =     permission.actionSummary && permission.actionSummar... |
| 1312 | 默认值使用硬编码中文 | medium | ";   const summaryLine =     permission.actionSummary && permission.actionSummar... |
| 1312 | 默认值使用硬编码中文 | medium | ";   const summaryLine =     permission.actionSummary && permission.actionSummar... |
| 1337 | 默认值使用硬编码中文 | medium | "Enter 确认 · Tab 切换 · d 详情 · Esc 取消" |
| 1337 | 默认值使用硬编码中文 | medium | "Enter 确认 · Tab 切换 · d 详情 · Esc 取消" |
| 1337 | 默认值使用硬编码中文 | medium | "Enter 确认 · Tab 切换 · d 详情 · Esc 取消" |
| 1403 | 默认值使用硬编码中文 | medium | "允许以后这类操作" |
| 1403 | 默认值使用硬编码中文 | medium | "允许以后这类操作" |
| 1403 | 默认值使用硬编码中文 | medium | "允许以后这类操作" |
| 1421 | 默认值使用硬编码中文 | medium | "; }  // D.13E Step 2 — y/n 单字母在新 4 档 elevation（allow_once / allow_always_tool /... |
| 1421 | 默认值使用硬编码中文 | medium | "; }  // D.13E Step 2 — y/n 单字母在新 4 档 elevation（allow_once / allow_always_tool /... |
| 1421 | 默认值使用硬编码中文 | medium | "; }  // D.13E Step 2 — y/n 单字母在新 4 档 elevation（allow_once / allow_always_tool /... |

### packages/tui/src/shell/components/ConfigPanel.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * ConfigPanel — D.13E Step 2  *  * 渲染 14-panel 配置入口面板。两个阶段：  *   - pane... |
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * ConfigPanel — D.13E Step 2  *  * 渲染 14-panel 配置入口面板。两个阶段：  *   - pane... |
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * ConfigPanel — D.13E Step 2  *  * 渲染 14-panel 配置入口面板。两个阶段：  *   - pane... |
| 19 | 默认值使用硬编码中文 | medium | "通过 onInput  * config-* 事件路由到 controller，再由 controller 派发对应 slash 走  * processTu... |
| 19 | 默认值使用硬编码中文 | medium | "通过 onInput  * config-* 事件路由到 controller，再由 controller 派发对应 slash 走  * processTu... |
| 19 | 默认值使用硬编码中文 | medium | "通过 onInput  * config-* 事件路由到 controller，再由 controller 派发对应 slash 走  * processTu... |
| 24 | 默认值使用硬编码中文 | medium | "自身）。  */ const HINT_TEXT = {   " |
| 24 | 默认值使用硬编码中文 | medium | "自身）。  */ const HINT_TEXT = {   " |
| 24 | 默认值使用硬编码中文 | medium | "自身）。  */ const HINT_TEXT = {   " |
| 28 | 默认值使用硬编码中文 | medium | "↑↓ 选择 · Enter 进入 · Esc 关闭" |
| 28 | 默认值使用硬编码中文 | medium | "↑↓ 选择 · Enter 进入 · Esc 关闭" |
| 28 | 默认值使用硬编码中文 | medium | "↑↓ 选择 · Enter 进入 · Esc 关闭" |
| 29 | 默认值使用硬编码中文 | medium | "↑↓ 选择 · Enter 执行 · Esc 返回" |
| 29 | 默认值使用硬编码中文 | medium | "↑↓ 选择 · Enter 执行 · Esc 返回" |
| 29 | 默认值使用硬编码中文 | medium | "↑↓ 选择 · Enter 执行 · Esc 返回" |

### packages/tui/src/shell/components/CtrlOToExpand.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 4 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — CtrlOToExpand  *  * CCB CtrlOToExpand.tsx 范式：  * - 单一全局组件，... |
| 4 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — CtrlOToExpand  *  * CCB CtrlOToExpand.tsx 范式：  * - 单一全局组件，... |
| 4 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — CtrlOToExpand  *  * CCB CtrlOToExpand.tsx 范式：  * - 单一全局组件，... |
| 10 | 默认值使用硬编码中文 | medium | "提示统一渲染。  * - 双层 Context 守门：一旦在子 agent / 虚拟列表里，hint 隐藏，  *   避免一屏到处都是 (ctrl+o to... |
| 10 | 默认值使用硬编码中文 | medium | "提示统一渲染。  * - 双层 Context 守门：一旦在子 agent / 虚拟列表里，hint 隐藏，  *   避免一屏到处都是 (ctrl+o to... |
| 10 | 默认值使用硬编码中文 | medium | "提示统一渲染。  * - 双层 Context 守门：一旦在子 agent / 虚拟列表里，hint 隐藏，  *   避免一屏到处都是 (ctrl+o to... |
| 47 | 默认值使用硬编码中文 | medium | " 单行 dim 提示。  *  * 隐藏规则（CCB 同款）：  * - 在子 agent 上下文里隐藏。  * - 在虚拟列表上下文里隐藏（避免列表每行都画... |
| 47 | 默认值使用硬编码中文 | medium | " 单行 dim 提示。  *  * 隐藏规则（CCB 同款）：  * - 在子 agent 上下文里隐藏。  * - 在虚拟列表上下文里隐藏（避免列表每行都画... |
| 47 | 默认值使用硬编码中文 | medium | " 单行 dim 提示。  *  * 隐藏规则（CCB 同款）：  * - 在子 agent 上下文里隐藏。  * - 在虚拟列表上下文里隐藏（避免列表每行都画... |

### packages/tui/src/shell/components/HelpPanel.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * HelpPanel — D.13Q-UX Closure  *  * 真 UI 面板替换 /help 的 writeLine 文本表。CC... |
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * HelpPanel — D.13Q-UX Closure  *  * 真 UI 面板替换 /help 的 writeLine 文本表。CC... |
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * HelpPanel — D.13Q-UX Closure  *  * 真 UI 面板替换 /help 的 writeLine 文本表。CC... |
| 24 | 默认值使用硬编码中文 | medium | "↑↓ 选择 · Enter 执行 · Tab/←→ 切换分组 · Esc 关闭" |
| 24 | 默认值使用硬编码中文 | medium | "↑↓ 选择 · Enter 执行 · Tab/←→ 切换分组 · Esc 关闭" |
| 24 | 默认值使用硬编码中文 | medium | "↑↓ 选择 · Enter 执行 · Tab/←→ 切换分组 · Esc 关闭" |
| 80 | 默认值使用硬编码中文 | medium | ", delta: -1 });       return;     }     // 数字快捷键 1-9：直接定位 cursor 并立即 dispatch（C... |
| 80 | 默认值使用硬编码中文 | medium | ", delta: -1 });       return;     }     // 数字快捷键 1-9：直接定位 cursor 并立即 dispatch（C... |
| 80 | 默认值使用硬编码中文 | medium | ", delta: -1 });       return;     }     // 数字快捷键 1-9：直接定位 cursor 并立即 dispatch（C... |
| 142 | 默认值使用硬编码中文 | medium | "（此分组没有命令）" |
| 142 | 默认值使用硬编码中文 | medium | "（此分组没有命令）" |
| 142 | 默认值使用硬编码中文 | medium | "（此分组没有命令）" |

### packages/tui/src/shell/components/MessageMarkdown.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — MessageMarkdown  *  * CCB Markdown.tsx 范式：assistant 正文 / 多... |
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — MessageMarkdown  *  * CCB Markdown.tsx 范式：assistant 正文 / 多... |
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — MessageMarkdown  *  * CCB Markdown.tsx 范式：assistant 正文 / 多... |
| 19 | 默认值使用硬编码中文 | medium | ").trim() 这种破坏正文的处理。  * - 不解析 HTML / 链接，避免给 TUI 引入解析风险；行内 `code` / **bold**  *  ... |
| 19 | 默认值使用硬编码中文 | medium | ").trim() 这种破坏正文的处理。  * - 不解析 HTML / 链接，避免给 TUI 引入解析风险；行内 `code` / **bold**  *  ... |
| 19 | 默认值使用硬编码中文 | medium | ").trim() 这种破坏正文的处理。  * - 不解析 HTML / 链接，避免给 TUI 引入解析风险；行内 `code` / **bold**  *  ... |
| 26 | 默认值使用硬编码中文 | medium | "机制：  * 一旦消息已经在 ⎿ 前缀的从属响应里，子节点不应再画一层 ⎿。  * 没有 Provider 时默认为 false（顶层）。  */ const... |
| 26 | 默认值使用硬编码中文 | medium | "机制：  * 一旦消息已经在 ⎿ 前缀的从属响应里，子节点不应再画一层 ⎿。  * 没有 Provider 时默认为 false（顶层）。  */ const... |
| 26 | 默认值使用硬编码中文 | medium | "机制：  * 一旦消息已经在 ⎿ 前缀的从属响应里，子节点不应再画一层 ⎿。  * 没有 Provider 时默认为 false（顶层）。  */ const... |

### packages/tui/src/shell/components/NotificationStack.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 4 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — NotificationStack  *  * CCB Notifications.tsx 范式：右对齐栈，单时刻只... |
| 4 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — NotificationStack  *  * CCB Notifications.tsx 范式：右对齐栈，单时刻只... |
| 4 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — NotificationStack  *  * CCB Notifications.tsx 范式：右对齐栈，单时刻只... |

### packages/tui/src/shell/components/ProductBlock.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 7 | 默认值使用硬编码中文 | medium | ";  /**  * D13E-P3 cleanup #3 — title 噪音过滤：  * " |
| 7 | 默认值使用硬编码中文 | medium | ";  /**  * D13E-P3 cleanup #3 — title 噪音过滤：  * " |
| 7 | 默认值使用硬编码中文 | medium | ";  /**  * D13E-P3 cleanup #3 — title 噪音过滤：  * " |
| 11 | 默认值使用硬编码中文 | medium | " / 空白都视作没有 title，避免 ProductBlock 把  * fallback 占位词当作产品级标题渲染（" |
| 11 | 默认值使用硬编码中文 | medium | " / 空白都视作没有 title，避免 ProductBlock 把  * fallback 占位词当作产品级标题渲染（" |
| 11 | 默认值使用硬编码中文 | medium | " / 空白都视作没有 title，避免 ProductBlock 把  * fallback 占位词当作产品级标题渲染（" |
| 12 | 默认值使用硬编码中文 | medium | " 是观察到的真实泄漏）。  * 调用方仍可传任何字符串；这里只是渲染层的最后一道防线。  */ function isMeaningfulTitle(valu... |
| 12 | 默认值使用硬编码中文 | medium | " 是观察到的真实泄漏）。  * 调用方仍可传任何字符串；这里只是渲染层的最后一道防线。  */ function isMeaningfulTitle(valu... |
| 12 | 默认值使用硬编码中文 | medium | " 是观察到的真实泄漏）。  * 调用方仍可传任何字符串；这里只是渲染层的最后一道防线。  */ function isMeaningfulTitle(valu... |
| 19 | 默认值使用硬编码中文 | medium | ") return false;   return true; }  /**  * D.13Q-UX — 消息语义 block 集合：assistant_tex... |
| 19 | 默认值使用硬编码中文 | medium | ") return false;   return true; }  /**  * D.13Q-UX — 消息语义 block 集合：assistant_tex... |
| 19 | 默认值使用硬编码中文 | medium | ") return false;   return true; }  /**  * D.13Q-UX — 消息语义 block 集合：assistant_tex... |
| 65 | 默认值使用硬编码中文 | medium | ").trim(); }  export function ProductBlock({   block,   theme,   width, }: {   b... |
| 65 | 默认值使用硬编码中文 | medium | ").trim(); }  export function ProductBlock({   block,   theme,   width, }: {   b... |
| 65 | 默认值使用硬编码中文 | medium | ").trim(); }  export function ProductBlock({   block,   theme,   width, }: {   b... |
| 85 | 默认值使用硬编码中文 | medium | ") {     // D.13Q-UX Real Smoke Fix v2 — 用户普通消息（messageKind=" |
| 85 | 默认值使用硬编码中文 | medium | ") {     // D.13Q-UX Real Smoke Fix v2 — 用户普通消息（messageKind=" |
| 85 | 默认值使用硬编码中文 | medium | ") {     // D.13Q-UX Real Smoke Fix v2 — 用户普通消息（messageKind=" |
| 86 | 默认值使用硬编码中文 | medium | "）     // 与 slash command transcript 的 marker / 配色区分：     //   slash    → ❯ + ac... |
| 86 | 默认值使用硬编码中文 | medium | "）     // 与 slash command transcript 的 marker / 配色区分：     //   slash    → ❯ + ac... |
| 86 | 默认值使用硬编码中文 | medium | "）     // 与 slash command transcript 的 marker / 配色区分：     //   slash    → ❯ + ac... |
| 103 | 默认值使用硬编码中文 | medium | ";     const textColor = isUserText ? undefined : theme.accent;     return (    ... |
| 103 | 默认值使用硬编码中文 | medium | ";     const textColor = isUserText ? undefined : theme.accent;     return (    ... |
| 103 | 默认值使用硬编码中文 | medium | ";     const textColor = isUserText ? undefined : theme.accent;     return (    ... |
| 140 | 默认值使用硬编码中文 | medium | "}             </Text>             <MessageMarkdown               text={body}   ... |
| 140 | 默认值使用硬编码中文 | medium | "}             </Text>             <MessageMarkdown               text={body}   ... |
| 140 | 默认值使用硬编码中文 | medium | "}             </Text>             <MessageMarkdown               text={body}   ... |
| 177 | 默认值使用硬编码中文 | medium | "}         </Text>         <MessageMarkdown           text={body}           them... |
| 177 | 默认值使用硬编码中文 | medium | "}         </Text>         <MessageMarkdown           text={body}           them... |
| 177 | 默认值使用硬编码中文 | medium | "}         </Text>         <MessageMarkdown           text={body}           them... |
| 203 | 默认值使用硬编码中文 | medium | ";   const emphasized = isAlert && !compact;   // permission 卡保持中性 border 色（与 P0... |
| 203 | 默认值使用硬编码中文 | medium | ";   const emphasized = isAlert && !compact;   // permission 卡保持中性 border 色（与 P0... |
| 203 | 默认值使用硬编码中文 | medium | ";   const emphasized = isAlert && !compact;   // permission 卡保持中性 border 色（与 P0... |
| 212 | 默认值使用硬编码中文 | medium | "         ? (theme.error ?? theme.status.fail)         : (theme.status[block.sta... |
| 212 | 默认值使用硬编码中文 | medium | "         ? (theme.error ?? theme.status.fail)         : (theme.status[block.sta... |
| 212 | 默认值使用硬编码中文 | medium | "         ? (theme.error ?? theme.status.fail)         : (theme.status[block.sta... |
| 255 | 默认值使用硬编码中文 | medium | " 时不渲染 title 行。如果同时   // 也没有 detail / nextAction，summary 就上提到 marker 行，让块依然有视觉  ... |
| 255 | 默认值使用硬编码中文 | medium | " 时不渲染 title 行。如果同时   // 也没有 detail / nextAction，summary 就上提到 marker 行，让块依然有视觉  ... |
| 255 | 默认值使用硬编码中文 | medium | " 时不渲染 title 行。如果同时   // 也没有 detail / nextAction，summary 就上提到 marker 行，让块依然有视觉  ... |
| 257 | 默认值使用硬编码中文 | medium | " 这种安全拒绝回复就是典型场景）。空 summary   // 直接不渲染整个块，避免出现一个孤零零的 marker 行。   const titleVisi... |
| 257 | 默认值使用硬编码中文 | medium | " 这种安全拒绝回复就是典型场景）。空 summary   // 直接不渲染整个块，避免出现一个孤零零的 marker 行。   const titleVisi... |
| 257 | 默认值使用硬编码中文 | medium | " 这种安全拒绝回复就是典型场景）。空 summary   // 直接不渲染整个块，避免出现一个孤零零的 marker 行。   const titleVisi... |

### packages/tui/src/shell/components/ScrollViewport.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 9 | 默认值使用硬编码中文 | medium | ";  /**  * D.14D-C2 — Measured, clamped scroll viewport (standard ink).  *  * 替换... |
| 9 | 默认值使用硬编码中文 | medium | ";  /**  * D.14D-C2 — Measured, clamped scroll viewport (standard ink).  *  * 替换... |
| 9 | 默认值使用硬编码中文 | medium | ";  /**  * D.14D-C2 — Measured, clamped scroll viewport (standard ink).  *  * 替换... |
| 15 | 默认值使用硬编码中文 | medium | "）。  *  * 标准 ink 能做什么 / 不能做什么（诚实记录）：  * - 标准 ink **没有** @anthropic/ink 那种行级裁剪的 S... |
| 15 | 默认值使用硬编码中文 | medium | "）。  *  * 标准 ink 能做什么 / 不能做什么（诚实记录）：  * - 标准 ink **没有** @anthropic/ink 那种行级裁剪的 S... |
| 15 | 默认值使用硬编码中文 | medium | "）。  *  * 标准 ink 能做什么 / 不能做什么（诚实记录）：  * - 标准 ink **没有** @anthropic/ink 那种行级裁剪的 S... |
| 19 | 默认值使用硬编码中文 | medium | " 的 clip 矩形  *   丢弃不可见行。Phase 7.18 在现有 viewport 上增加 block-level  *   virtualizat... |
| 19 | 默认值使用硬编码中文 | medium | " 的 clip 矩形  *   丢弃不可见行。Phase 7.18 在现有 viewport 上增加 block-level  *   virtualizat... |
| 19 | 默认值使用硬编码中文 | medium | " 的 clip 矩形  *   丢弃不可见行。Phase 7.18 在现有 viewport 上增加 block-level  *   virtualizat... |
| 23 | 默认值使用硬编码中文 | medium | "方案是：测出内容高度与可视高度 → 夹紧偏移  *   → 用一个**有界的** translate（marginTop = -clampedOffset）把... |
| 23 | 默认值使用硬编码中文 | medium | "方案是：测出内容高度与可视高度 → 夹紧偏移  *   → 用一个**有界的** translate（marginTop = -clampedOffset）把... |
| 23 | 默认值使用硬编码中文 | medium | "方案是：测出内容高度与可视高度 → 夹紧偏移  *   → 用一个**有界的** translate（marginTop = -clampedOffset）把... |
| 25 | 默认值使用硬编码中文 | medium | " + minHeight=0 负责把溢出行裁掉。这与旧实现形似，  *   但本质不同：偏移由测量结果夹紧、且支持 stickToBottom 自动吸底，  ... |
| 25 | 默认值使用硬编码中文 | medium | " + minHeight=0 负责把溢出行裁掉。这与旧实现形似，  *   但本质不同：偏移由测量结果夹紧、且支持 stickToBottom 自动吸底，  ... |
| 25 | 默认值使用硬编码中文 | medium | " + minHeight=0 负责把溢出行裁掉。这与旧实现形似，  *   但本质不同：偏移由测量结果夹紧、且支持 stickToBottom 自动吸底，  ... |

### packages/tui/src/shell/components/SessionsPanel.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * SessionsPanel — D.13Q-UX Closure  *  * 真 picker 面板替换 /sessions / /res... |
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * SessionsPanel — D.13Q-UX Closure  *  * 真 picker 面板替换 /sessions / /res... |
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * SessionsPanel — D.13Q-UX Closure  *  * 真 picker 面板替换 /sessions / /res... |
| 26 | 默认值使用硬编码中文 | medium | "↑↓ 选择 · Enter 恢复 · Esc 关闭" |
| 26 | 默认值使用硬编码中文 | medium | "↑↓ 选择 · Enter 恢复 · Esc 关闭" |
| 26 | 默认值使用硬编码中文 | medium | "↑↓ 选择 · Enter 恢复 · Esc 关闭" |
| 27 | 默认值使用硬编码中文 | medium | "（暂无可恢复的会话）" |
| 27 | 默认值使用硬编码中文 | medium | "（暂无可恢复的会话）" |
| 27 | 默认值使用硬编码中文 | medium | "（暂无可恢复的会话）" |
| 29 | 默认值使用硬编码中文 | medium | "[当前 · 不可恢复]" |
| 29 | 默认值使用硬编码中文 | medium | "[当前 · 不可恢复]" |
| 29 | 默认值使用硬编码中文 | medium | "[当前 · 不可恢复]" |
| 93 | 默认值使用硬编码中文 | medium | " ? `${min}m ago` : `${min} 分钟前`;       const hr = Math.floor(min / 60);       i... |
| 93 | 默认值使用硬编码中文 | medium | " ? `${min}m ago` : `${min} 分钟前`;       const hr = Math.floor(min / 60);       i... |
| 93 | 默认值使用硬编码中文 | medium | " ? `${min}m ago` : `${min} 分钟前`;       const hr = Math.floor(min / 60);       i... |
| 95 | 默认值使用硬编码中文 | medium | " ? `${hr}h ago` : `${hr} 小时前`;       const day = Math.floor(hr / 24);       ret... |
| 95 | 默认值使用硬编码中文 | medium | " ? `${hr}h ago` : `${hr} 小时前`;       const day = Math.floor(hr / 24);       ret... |
| 95 | 默认值使用硬编码中文 | medium | " ? `${hr}h ago` : `${hr} 小时前`;       const day = Math.floor(hr / 24);       ret... |
| 97 | 默认值使用硬编码中文 | medium | " ? `${day}d ago` : `${day} 天前`;     } catch {       return iso;     }   };    r... |
| 97 | 默认值使用硬编码中文 | medium | " ? `${day}d ago` : `${day} 天前`;     } catch {       return iso;     }   };    r... |
| 97 | 默认值使用硬编码中文 | medium | " ? `${day}d ago` : `${day} 天前`;     } catch {       return iso;     }   };    r... |
| 106 | 默认值使用硬编码中文 | medium | "       borderColor={theme.panel ?? theme.border}       paddingX={1}       margi... |
| 106 | 默认值使用硬编码中文 | medium | "       borderColor={theme.panel ?? theme.border}       paddingX={1}       margi... |
| 106 | 默认值使用硬编码中文 | medium | "       borderColor={theme.panel ?? theme.border}       paddingX={1}       margi... |
| 126 | 默认值使用硬编码中文 | medium | " 标识，           // Enter 由 index.ts sessions-resume 拦截，不 dispatch /resume。      ... |
| 126 | 默认值使用硬编码中文 | medium | " 标识，           // Enter 由 index.ts sessions-resume 拦截，不 dispatch /resume。      ... |
| 126 | 默认值使用硬编码中文 | medium | " 标识，           // Enter 由 index.ts sessions-resume 拦截，不 dispatch /resume。      ... |

### packages/tui/src/shell/components/ShellApp.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 175 | 默认值使用硬编码中文 | medium | ", geometry });             });           }}         >           {/* C4：transcri... |
| 175 | 默认值使用硬编码中文 | medium | ", geometry });             });           }}         >           {/* C4：transcri... |
| 175 | 默认值使用硬编码中文 | medium | ", geometry });             });           }}         >           {/* C4：transcri... |
| 211 | 默认值使用硬编码中文 | medium | " 指示器渲染在 transcript 块**之后**（最新             用户消息下方），与 CCB 行为一致（spinner 位于对话流底部），而... |
| 211 | 默认值使用硬编码中文 | medium | " 指示器渲染在 transcript 块**之后**（最新             用户消息下方），与 CCB 行为一致（spinner 位于对话流底部），而... |
| 211 | 默认值使用硬编码中文 | medium | " 指示器渲染在 transcript 块**之后**（最新             用户消息下方），与 CCB 行为一致（spinner 位于对话流底部），而... |
| 248 | 默认值使用硬编码中文 | medium | ">         {/* D.13Q-UX：轻提示固定在 composer 上方，不和 footer/runtime summary 抢最底部。 */}  ... |
| 248 | 默认值使用硬编码中文 | medium | ">         {/* D.13Q-UX：轻提示固定在 composer 上方，不和 footer/runtime summary 抢最底部。 */}  ... |
| 248 | 默认值使用硬编码中文 | medium | ">         {/* D.13Q-UX：轻提示固定在 composer 上方，不和 footer/runtime summary 抢最底部。 */}  ... |
| 268 | 默认值使用硬编码中文 | medium | " leak source and stays out of Task mode.             D.13Q-UX：迁到 StatusFooter（左... |
| 268 | 默认值使用硬编码中文 | medium | " leak source and stays out of Task mode.             D.13Q-UX：迁到 StatusFooter（左... |
| 268 | 默认值使用硬编码中文 | medium | " leak source and stays out of Task mode.             D.13Q-UX：迁到 StatusFooter（左... |

### packages/tui/src/shell/components/StatusFooter.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — StatusFooter  *  * CCB PromptInputFooter / StatusLine / Bu... |
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — StatusFooter  *  * CCB PromptInputFooter / StatusLine / Bu... |
| 6 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — StatusFooter  *  * CCB PromptInputFooter / StatusLine / Bu... |
| 16 | 默认值使用硬编码中文 | medium | " 时 cache 段染 warning 色；模型 dim 时 model 段染 dim。  *  * 与 ShellApp 旧 TaskFooter 兼容：保... |
| 16 | 默认值使用硬编码中文 | medium | " 时 cache 段染 warning 色；模型 dim 时 model 段染 dim。  *  * 与 ShellApp 旧 TaskFooter 兼容：保... |
| 16 | 默认值使用硬编码中文 | medium | " 时 cache 段染 warning 色；模型 dim 时 model 段染 dim。  *  * 与 ShellApp 旧 TaskFooter 兼容：保... |
| 38 | 默认值使用硬编码中文 | medium | ", }: StatusFooterProps): React.ReactNode {   void language;   // 右栏（model · cac... |
| 38 | 默认值使用硬编码中文 | medium | ", }: StatusFooterProps): React.ReactNode {   void language;   // 右栏（model · cac... |
| 38 | 默认值使用硬编码中文 | medium | ", }: StatusFooterProps): React.ReactNode {   void language;   // 右栏（model · cac... |
| 52 | 默认值使用硬编码中文 | medium | " });    // 窄屏列向布局：左行（mode + cyclePermHint）一行，右栏分两行展示，避免挤压。   const narrow = wid... |
| 52 | 默认值使用硬编码中文 | medium | " });    // 窄屏列向布局：左行（mode + cyclePermHint）一行，右栏分两行展示，避免挤压。   const narrow = wid... |
| 52 | 默认值使用硬编码中文 | medium | " });    // 窄屏列向布局：左行（mode + cyclePermHint）一行，右栏分两行展示，避免挤压。   const narrow = wid... |

### packages/tui/src/shell/components/TaskSuggestionBar.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 5 | 默认值使用硬编码中文 | medium | ";  /**  * TaskSuggestionBar — D.13E Step 2  *  * 在 Task / Pending 模式下渲染 view-mo... |
| 5 | 默认值使用硬编码中文 | medium | ";  /**  * TaskSuggestionBar — D.13E Step 2  *  * 在 Task / Pending 模式下渲染 view-mo... |
| 5 | 默认值使用硬编码中文 | medium | ";  /**  * TaskSuggestionBar — D.13E Step 2  *  * 在 Task / Pending 模式下渲染 view-mo... |

### packages/tui/src/shell/models/command-transcript-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * CommandTranscriptPresenter — D.13E Step 1  *  * D.13D 已经把 slash comma... |
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * CommandTranscriptPresenter — D.13E Step 1  *  * D.13D 已经把 slash comma... |
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * CommandTranscriptPresenter — D.13E Step 1  *  * D.13D 已经把 slash comma... |
| 7 | 默认值使用硬编码中文 | medium | " + keep:true 进入 view.blocks。当前格式化  * 逻辑散落在两处：  *   - packages/tui/src/shell/pla... |
| 7 | 默认值使用硬编码中文 | medium | " + keep:true 进入 view.blocks。当前格式化  * 逻辑散落在两处：  *   - packages/tui/src/shell/pla... |
| 7 | 默认值使用硬编码中文 | medium | " + keep:true 进入 view.blocks。当前格式化  * 逻辑散落在两处：  *   - packages/tui/src/shell/pla... |
| 18 | 默认值使用硬编码中文 | medium | "。  *   - 仍只显示一行（不展开 detail）。  *   - 仍设置 keep:true，不被 thinking → completed 的 blo... |
| 18 | 默认值使用硬编码中文 | medium | "。  *   - 仍只显示一行（不展开 detail）。  *   - 仍设置 keep:true，不被 thinking → completed 的 blo... |
| 18 | 默认值使用硬编码中文 | medium | "。  *   - 仍只显示一行（不展开 detail）。  *   - 仍设置 keep:true，不被 thinking → completed 的 blo... |
| 23 | 默认值使用硬编码中文 | medium | "} ${title}`。  */  /** 转录行使用的前缀字符。U+276F 是单行 slash echo 的标准 marker。 */ export co... |
| 23 | 默认值使用硬编码中文 | medium | "} ${title}`。  */  /** 转录行使用的前缀字符。U+276F 是单行 slash echo 的标准 marker。 */ export co... |
| 23 | 默认值使用硬编码中文 | medium | "} ${title}`。  */  /** 转录行使用的前缀字符。U+276F 是单行 slash echo 的标准 marker。 */ export co... |
| 27 | 默认值使用硬编码中文 | medium | ";  /** 转录 block id 前缀。每条 transcript 用 `cmd:<n>:<slug>` 唯一标识。 */ export const CO... |
| 27 | 默认值使用硬编码中文 | medium | ";  /** 转录 block id 前缀。每条 transcript 用 `cmd:<n>:<slug>` 唯一标识。 */ export const CO... |
| 27 | 默认值使用硬编码中文 | medium | ";  /** 转录 block id 前缀。每条 transcript 用 `cmd:<n>:<slug>` 唯一标识。 */ export const CO... |
| 30 | 默认值使用硬编码中文 | medium | ";  /** 把单条 slash 文本规范化为转录行用的 title（去首尾空白，但保留中间空格）。 */ export function normalize... |
| 30 | 默认值使用硬编码中文 | medium | ";  /** 把单条 slash 文本规范化为转录行用的 title（去首尾空白，但保留中间空格）。 */ export function normalize... |
| 30 | 默认值使用硬编码中文 | medium | ";  /** 把单条 slash 文本规范化为转录行用的 title（去首尾空白，但保留中间空格）。 */ export function normalize... |
| 46 | 默认值使用硬编码中文 | medium | ";   return `${COMMAND_TRANSCRIPT_ID_PREFIX}${sequence}:${slug}`; }  /**  * 构造一条... |
| 46 | 默认值使用硬编码中文 | medium | ";   return `${COMMAND_TRANSCRIPT_ID_PREFIX}${sequence}:${slug}`; }  /**  * 构造一条... |
| 46 | 默认值使用硬编码中文 | medium | ";   return `${COMMAND_TRANSCRIPT_ID_PREFIX}${sequence}:${slug}`; }  /**  * 构造一条... |
| 54 | 默认值使用硬编码中文 | medium | " → ProductBlock / plain-renderer 的 command 分支命中。  *   - status=" |
| 54 | 默认值使用硬编码中文 | medium | " → ProductBlock / plain-renderer 的 command 分支命中。  *   - status=" |
| 54 | 默认值使用硬编码中文 | medium | " → ProductBlock / plain-renderer 的 command 分支命中。  *   - status=" |
| 55 | 默认值使用硬编码中文 | medium | " → 与现有 status 颜色映射兼容（command 渲染分支自己覆盖颜色，  *     这里给个稳定值便于其它 reducer 读取）。  *   -... |
| 55 | 默认值使用硬编码中文 | medium | " → 与现有 status 颜色映射兼容（command 渲染分支自己覆盖颜色，  *     这里给个稳定值便于其它 reducer 读取）。  *   -... |
| 55 | 默认值使用硬编码中文 | medium | " → 与现有 status 颜色映射兼容（command 渲染分支自己覆盖颜色，  *     这里给个稳定值便于其它 reducer 读取）。  *   -... |
| 68 | 默认值使用硬编码中文 | medium | ",     keep: true,   }; }  /**  * 取出转录行的最终 plain 文本（不含 ANSI），用于 plain-renderer 与... |
| 68 | 默认值使用硬编码中文 | medium | ",     keep: true,   }; }  /**  * 取出转录行的最终 plain 文本（不含 ANSI），用于 plain-renderer 与... |
| 68 | 默认值使用硬编码中文 | medium | ",     keep: true,   }; }  /**  * 取出转录行的最终 plain 文本（不含 ANSI），用于 plain-renderer 与... |
| 80 | 默认值使用硬编码中文 | medium | ";   return `${COMMAND_TRANSCRIPT_PREFIX} ${block.title}`; }  /** 类型守卫：判断一个 bloc... |
| 80 | 默认值使用硬编码中文 | medium | ";   return `${COMMAND_TRANSCRIPT_PREFIX} ${block.title}`; }  /** 类型守卫：判断一个 bloc... |
| 80 | 默认值使用硬编码中文 | medium | ";   return `${COMMAND_TRANSCRIPT_PREFIX} ${block.title}`; }  /** 类型守卫：判断一个 bloc... |
| 86 | 默认值使用硬编码中文 | medium | "; }  /**  * D.13Q-UX Real Smoke Fix v2 — C. 用户普通消息（非 slash）进 transcript 的  * us... |
| 86 | 默认值使用硬编码中文 | medium | "; }  /**  * D.13Q-UX Real Smoke Fix v2 — C. 用户普通消息（非 slash）进 transcript 的  * us... |
| 86 | 默认值使用硬编码中文 | medium | "; }  /**  * D.13Q-UX Real Smoke Fix v2 — C. 用户普通消息（非 slash）进 transcript 的  * us... |
| 93 | 默认值使用硬编码中文 | medium | " + keep:true，复用 ProductBlock 的  *     command 分支渲染（marker + accent title）。  *  ... |
| 93 | 默认值使用硬编码中文 | medium | " + keep:true，复用 ProductBlock 的  *     command 分支渲染（marker + accent title）。  *  ... |
| 93 | 默认值使用硬编码中文 | medium | " + keep:true，复用 ProductBlock 的  *     command 分支渲染（marker + accent title）。  *  ... |
| 101 | 默认值使用硬编码中文 | medium | ";  export function buildUserTextBlockId(sequence: number, _text: string): strin... |
| 101 | 默认值使用硬编码中文 | medium | ";  export function buildUserTextBlockId(sequence: number, _text: string): strin... |
| 101 | 默认值使用硬编码中文 | medium | ";  export function buildUserTextBlockId(sequence: number, _text: string): strin... |

### packages/tui/src/shell/models/config-control-plane.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 2 | 默认值使用硬编码中文 | medium | ";  /**  * ConfigControlPlane — D.13E Step 1  *  * 把 14 个配置面板（model / language /... |
| 2 | 默认值使用硬编码中文 | medium | ";  /**  * ConfigControlPlane — D.13E Step 1  *  * 把 14 个配置面板（model / language /... |
| 2 | 默认值使用硬编码中文 | medium | ";  /**  * ConfigControlPlane — D.13E Step 1  *  * 把 14 个配置面板（model / language /... |
| 18 | 默认值使用硬编码中文 | medium | "，不做内联编辑、不新增 settings writer。  *   - 任何写入都通过 dispatch 一个真实 slash（已落在 SLASH_COMMA... |
| 18 | 默认值使用硬编码中文 | medium | "，不做内联编辑、不新增 settings writer。  *   - 任何写入都通过 dispatch 一个真实 slash（已落在 SLASH_COMMA... |
| 18 | 默认值使用硬编码中文 | medium | "，不做内联编辑、不新增 settings writer。  *   - 任何写入都通过 dispatch 一个真实 slash（已落在 SLASH_COMMA... |
| 41 | 默认值使用硬编码中文 | medium | ";  export type ConfigPanelAction = {   id: string;   labelZh: string;   labelEn... |
| 41 | 默认值使用硬编码中文 | medium | ";  export type ConfigPanelAction = {   id: string;   labelZh: string;   labelEn... |
| 41 | 默认值使用硬编码中文 | medium | ";  export type ConfigPanelAction = {   id: string;   labelZh: string;   labelEn... |
| 57 | 默认值使用硬编码中文 | medium | " 动作）。 */   rootSlash: string;   /** 面板内可选的 next actions（全是 slash 跳转，不内联写入）。 */ ... |
| 57 | 默认值使用硬编码中文 | medium | " 动作）。 */   rootSlash: string;   /** 面板内可选的 next actions（全是 slash 跳转，不内联写入）。 */ ... |
| 57 | 默认值使用硬编码中文 | medium | " 动作）。 */   rootSlash: string;   /** 面板内可选的 next actions（全是 slash 跳转，不内联写入）。 */ ... |
| 75 | 默认值使用硬编码中文 | medium | "; command: string };  export type ConfigStep = {   next: ConfigState;   dispatc... |
| 75 | 默认值使用硬编码中文 | medium | "; command: string };  export type ConfigStep = {   next: ConfigState;   dispatc... |
| 75 | 默认值使用硬编码中文 | medium | "; command: string };  export type ConfigStep = {   next: ConfigState;   dispatc... |
| 99 | 默认值使用硬编码中文 | medium | "查看当前模型 / provider / 角色路由。" |
| 99 | 默认值使用硬编码中文 | medium | "查看当前模型 / provider / 角色路由。" |
| 99 | 默认值使用硬编码中文 | medium | "查看当前模型 / provider / 角色路由。" |
| 108 | 默认值使用硬编码中文 | medium | "切换 zh-CN / en-US 体验。" |
| 108 | 默认值使用硬编码中文 | medium | "切换 zh-CN / en-US 体验。" |
| 108 | 默认值使用硬编码中文 | medium | "切换 zh-CN / en-US 体验。" |
| 119 | 默认值使用硬编码中文 | medium | "查看 / 编辑 allow / ask / deny 规则。" |
| 119 | 默认值使用硬编码中文 | medium | "查看 / 编辑 allow / ask / deny 规则。" |
| 119 | 默认值使用硬编码中文 | medium | "查看 / 编辑 allow / ask / deny 规则。" |
| 128 | 默认值使用硬编码中文 | medium | "查看 LINGHUN.md / 候选 / 已接受记忆。" |
| 128 | 默认值使用硬编码中文 | medium | "查看 LINGHUN.md / 候选 / 已接受记忆。" |
| 128 | 默认值使用硬编码中文 | medium | "查看 LINGHUN.md / 候选 / 已接受记忆。" |
| 137 | 默认值使用硬编码中文 | medium | "查看 codebase 索引状态与诊断。" |
| 137 | 默认值使用硬编码中文 | medium | "查看 codebase 索引状态与诊断。" |
| 137 | 默认值使用硬编码中文 | medium | "查看 codebase 索引状态与诊断。" |
| 149 | 默认值使用硬编码中文 | medium | "查看 MCP server 与工具。" |
| 149 | 默认值使用硬编码中文 | medium | "查看 MCP server 与工具。" |
| 149 | 默认值使用硬编码中文 | medium | "查看 MCP server 与工具。" |
| 152 | 默认值使用硬编码中文 | medium | "查看 MCP" |
| 152 | 默认值使用硬编码中文 | medium | "查看 MCP" |
| 152 | 默认值使用硬编码中文 | medium | "查看 MCP" |
| 158 | 默认值使用硬编码中文 | medium | "查看缓存命中与日志。" |
| 158 | 默认值使用硬编码中文 | medium | "查看缓存命中与日志。" |
| 158 | 默认值使用硬编码中文 | medium | "查看缓存命中与日志。" |
| 170 | 默认值使用硬编码中文 | medium | "查看后台 job 与远程任务。" |
| 170 | 默认值使用硬编码中文 | medium | "查看后台 job 与远程任务。" |
| 170 | 默认值使用硬编码中文 | medium | "查看后台 job 与远程任务。" |
| 175 | 默认值使用硬编码中文 | medium | "查看 job" |
| 175 | 默认值使用硬编码中文 | medium | "查看 job" |
| 175 | 默认值使用硬编码中文 | medium | "查看 job" |
| 182 | 默认值使用硬编码中文 | medium | "查看远程会话与控制平面。" |
| 182 | 默认值使用硬编码中文 | medium | "查看远程会话与控制平面。" |
| 182 | 默认值使用硬编码中文 | medium | "查看远程会话与控制平面。" |
| 191 | 默认值使用硬编码中文 | medium | "查看 hooks 启用与诊断。" |
| 191 | 默认值使用硬编码中文 | medium | "查看 hooks 启用与诊断。" |
| 191 | 默认值使用硬编码中文 | medium | "查看 hooks 启用与诊断。" |
| 192 | 默认值使用硬编码中文 | medium | ",       // /hooks 在 registry 中以 capabilityId=hooks 但 slash=/doctor 表示，       //... |
| 192 | 默认值使用硬编码中文 | medium | ",       // /hooks 在 registry 中以 capabilityId=hooks 但 slash=/doctor 表示，       //... |
| 192 | 默认值使用硬编码中文 | medium | ",       // /hooks 在 registry 中以 capabilityId=hooks 但 slash=/doctor 表示，       //... |
| 196 | 默认值使用硬编码中文 | medium | "诊断 hooks" |
| 196 | 默认值使用硬编码中文 | medium | "诊断 hooks" |
| 196 | 默认值使用硬编码中文 | medium | "诊断 hooks" |
| 202 | 默认值使用硬编码中文 | medium | "查看插件 manifest 与诊断。" |
| 202 | 默认值使用硬编码中文 | medium | "查看插件 manifest 与诊断。" |
| 202 | 默认值使用硬编码中文 | medium | "查看插件 manifest 与诊断。" |
| 211 | 默认值使用硬编码中文 | medium | "查看本地 skill 摘要。" |
| 211 | 默认值使用硬编码中文 | medium | "查看本地 skill 摘要。" |
| 211 | 默认值使用硬编码中文 | medium | "查看本地 skill 摘要。" |
| 220 | 默认值使用硬编码中文 | medium | "查看可用工作流模板。" |
| 220 | 默认值使用硬编码中文 | medium | "查看可用工作流模板。" |
| 220 | 默认值使用硬编码中文 | medium | "查看可用工作流模板。" |
| 231 | 默认值使用硬编码中文 | medium | "查看 / 调整本项目信任级别。" |
| 231 | 默认值使用硬编码中文 | medium | "查看 / 调整本项目信任级别。" |
| 231 | 默认值使用硬编码中文 | medium | "查看 / 调整本项目信任级别。" |
| 234 | 默认值使用硬编码中文 | medium | " }],     },   ]; }  export function getConfigPanels(): ReadonlyArray<ConfigPane... |
| 234 | 默认值使用硬编码中文 | medium | " }],     },   ]; }  export function getConfigPanels(): ReadonlyArray<ConfigPane... |
| 234 | 默认值使用硬编码中文 | medium | " }],     },   ]; }  export function getConfigPanels(): ReadonlyArray<ConfigPane... |
| 319 | 默认值使用硬编码中文 | medium | " } };     }   } }  /** 取面板的本地化标题 / 摘要，view-model 层只复用，不做字符串拼接。 */ export functi... |
| 319 | 默认值使用硬编码中文 | medium | " } };     }   } }  /** 取面板的本地化标题 / 摘要，view-model 层只复用，不做字符串拼接。 */ export functi... |
| 319 | 默认值使用硬编码中文 | medium | " } };     }   } }  /** 取面板的本地化标题 / 摘要，view-model 层只复用，不做字符串拼接。 */ export functi... |

### packages/tui/src/shell/models/footer-view.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 3 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — footer-view 纯函数模型  *  * 把 ShellApp.TaskFooter 的字段计算从 view-... |
| 3 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — footer-view 纯函数模型  *  * 把 ShellApp.TaskFooter 的字段计算从 view-... |
| 3 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — footer-view 纯函数模型  *  * 把 ShellApp.TaskFooter 的字段计算从 view-... |
| 9 | 默认值使用硬编码中文 | medium | "正常 model" |
| 9 | 默认值使用硬编码中文 | medium | "，避免 footer 显示  *   `model deepseek-chat` 这类兜底占位（resolveInitialModel 在  *   defa... |
| 9 | 默认值使用硬编码中文 | medium | "正常 model" |
| 9 | 默认值使用硬编码中文 | medium | "，避免 footer 显示  *   `model deepseek-chat` 这类兜底占位（resolveInitialModel 在  *   defa... |
| 9 | 默认值使用硬编码中文 | medium | "正常 model" |
| 9 | 默认值使用硬编码中文 | medium | "，避免 footer 显示  *   `model deepseek-chat` 这类兜底占位（resolveInitialModel 在  *   defa... |
| 14 | 默认值使用硬编码中文 | medium | "轻提示（cache pill 自身  *   仍在 footer 内，notification 是补充）。  *  * 调用方在 setupNeeded=tr... |
| 14 | 默认值使用硬编码中文 | medium | "轻提示（cache pill 自身  *   仍在 footer 内，notification 是补充）。  *  * 调用方在 setupNeeded=tr... |
| 14 | 默认值使用硬编码中文 | medium | "轻提示（cache pill 自身  *   仍在 footer 内，notification 是补充）。  *  * 调用方在 setupNeeded=tr... |
| 17 | 默认值使用硬编码中文 | medium | "（语义化标记），本模块  * 把它格式化为 dim `--` 占位，让 stale deepseek-chat 不再出现在主屏。  */  export ty... |
| 17 | 默认值使用硬编码中文 | medium | "（语义化标记），本模块  * 把它格式化为 dim `--` 占位，让 stale deepseek-chat 不再出现在主屏。  */  export ty... |
| 17 | 默认值使用硬编码中文 | medium | "（语义化标记），本模块  * 把它格式化为 dim `--` 占位，让 stale deepseek-chat 不再出现在主屏。  */  export ty... |
| 28 | 默认值使用硬编码中文 | medium | "，footer 显示    * dim `--`，避免 stale 占位（如 deepseek-chat 兜底）流到主屏。    */   effective... |
| 28 | 默认值使用硬编码中文 | medium | "，footer 显示    * dim `--`，避免 stale 占位（如 deepseek-chat 兜底）流到主屏。    */   effective... |
| 28 | 默认值使用硬编码中文 | medium | "，footer 显示    * dim `--`，避免 stale 占位（如 deepseek-chat 兜底）流到主屏。    */   effective... |
| 38 | 默认值使用硬编码中文 | medium | " 等）；空表示不显示 reasoning 段。 */   reasoningLevel?: string;   /** reasoning 是否真的发送给 p... |
| 38 | 默认值使用硬编码中文 | medium | " 等）；空表示不显示 reasoning 段。 */   reasoningLevel?: string;   /** reasoning 是否真的发送给 p... |
| 38 | 默认值使用硬编码中文 | medium | " 等）；空表示不显示 reasoning 段。 */   reasoningLevel?: string;   /** reasoning 是否真的发送给 p... |
| 50 | 默认值使用硬编码中文 | medium | ", ]);  /**  * 把 effectiveModel 规整成 footer 显示值；setup-needed / unknown / 占位  * 时返... |
| 50 | 默认值使用硬编码中文 | medium | ", ]);  /**  * 把 effectiveModel 规整成 footer 显示值；setup-needed / unknown / 占位  * 时返... |
| 50 | 默认值使用硬编码中文 | medium | ", ]);  /**  * 把 effectiveModel 规整成 footer 显示值；setup-needed / unknown / 占位  * 时返... |
| 105 | 默认值使用硬编码中文 | medium | ";   return `${label} ${truncateMiddle(trimmed, 12)}`; }  /**  * 主入口：把所有 footer ... |
| 105 | 默认值使用硬编码中文 | medium | ";   return `${label} ${truncateMiddle(trimmed, 12)}`; }  /**  * 主入口：把所有 footer ... |
| 105 | 默认值使用硬编码中文 | medium | ";   return `${label} ${truncateMiddle(trimmed, 12)}`; }  /**  * 主入口：把所有 footer ... |

### packages/tui/src/shell/models/help-panel.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — HelpPanel 模型  *  * 把 /help 的 short / advanced / details 三组... |
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — HelpPanel 模型  *  * 把 /help 的 short / advanced / details 三组... |
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — HelpPanel 模型  *  * 把 /help 的 short / advanced / details 三组... |
| 15 | 默认值使用硬编码中文 | medium | ";  export type HelpPanelEntry = {   /** 命令文本，例如 " |
| 15 | 默认值使用硬编码中文 | medium | ";  export type HelpPanelEntry = {   /** 命令文本，例如 " |
| 15 | 默认值使用硬编码中文 | medium | ";  export type HelpPanelEntry = {   /** 命令文本，例如 " |
| 18 | 默认值使用硬编码中文 | medium | "。 */   slash: string;   /** user-facing 描述。 */   description: string; };  expor... |
| 18 | 默认值使用硬编码中文 | medium | "。 */   slash: string;   /** user-facing 描述。 */   description: string; };  expor... |
| 18 | 默认值使用硬编码中文 | medium | "。 */   slash: string;   /** user-facing 描述。 */   description: string; };  expor... |
| 34 | 默认值使用硬编码中文 | medium | "查看命令帮助（all / advanced / details 切换分组）" |
| 34 | 默认值使用硬编码中文 | medium | "查看命令帮助（all / advanced / details 切换分组）" |
| 34 | 默认值使用硬编码中文 | medium | "查看命令帮助（all / advanced / details 切换分组）" |
| 35 | 默认值使用硬编码中文 | medium | "查看 / 切换执行模型与 reasoning level" |
| 35 | 默认值使用硬编码中文 | medium | "查看 / 切换执行模型与 reasoning level" |
| 35 | 默认值使用硬编码中文 | medium | "查看 / 切换执行模型与 reasoning level" |
| 36 | 默认值使用硬编码中文 | medium | "查看权限规则与最近被拒列表" |
| 36 | 默认值使用硬编码中文 | medium | "查看权限规则与最近被拒列表" |
| 36 | 默认值使用硬编码中文 | medium | "查看权限规则与最近被拒列表" |
| 37 | 默认值使用硬编码中文 | medium | "切换权限模式（default / auto / plan / full-access）" |
| 37 | 默认值使用硬编码中文 | medium | "切换权限模式（default / auto / plan / full-access）" |
| 37 | 默认值使用硬编码中文 | medium | "切换权限模式（default / auto / plan / full-access）" |
| 38 | 默认值使用硬编码中文 | medium | "打开配置面板（model / language / permissions 等）" |
| 38 | 默认值使用硬编码中文 | medium | "打开配置面板（model / language / permissions 等）" |
| 38 | 默认值使用硬编码中文 | medium | "打开配置面板（model / language / permissions 等）" |
| 39 | 默认值使用硬编码中文 | medium | "查看代码索引状态与刷新入口" |
| 39 | 默认值使用硬编码中文 | medium | "查看代码索引状态与刷新入口" |
| 39 | 默认值使用硬编码中文 | medium | "查看代码索引状态与刷新入口" |
| 40 | 默认值使用硬编码中文 | medium | "打开最近输出 / evidence / background 详情面板" |
| 40 | 默认值使用硬编码中文 | medium | "打开最近输出 / evidence / background 详情面板" |
| 40 | 默认值使用硬编码中文 | medium | "打开最近输出 / evidence / background 详情面板" |
| 41 | 默认值使用硬编码中文 | medium | "退出 Linghun" |
| 41 | 默认值使用硬编码中文 | medium | "退出 Linghun" |
| 41 | 默认值使用硬编码中文 | medium | "退出 Linghun" |
| 56 | 默认值使用硬编码中文 | medium | "查看团队智能体与后台 agent 状态" |
| 56 | 默认值使用硬编码中文 | medium | "查看团队智能体与后台 agent 状态" |
| 56 | 默认值使用硬编码中文 | medium | "查看团队智能体与后台 agent 状态" |
| 57 | 默认值使用硬编码中文 | medium | "查看后台任务列表与详情" |
| 57 | 默认值使用硬编码中文 | medium | "查看后台任务列表与详情" |
| 57 | 默认值使用硬编码中文 | medium | "查看后台任务列表与详情" |
| 58 | 默认值使用硬编码中文 | medium | "管理后台任务（start / pause / cancel）" |
| 58 | 默认值使用硬编码中文 | medium | "管理后台任务（start / pause / cancel）" |
| 58 | 默认值使用硬编码中文 | medium | "管理后台任务（start / pause / cancel）" |
| 59 | 默认值使用硬编码中文 | medium | "管理技能与启用状态" |
| 59 | 默认值使用硬编码中文 | medium | "管理技能与启用状态" |
| 59 | 默认值使用硬编码中文 | medium | "管理技能与启用状态" |
| 60 | 默认值使用硬编码中文 | medium | "查看 workflow 状态与触发入口" |
| 60 | 默认值使用硬编码中文 | medium | "查看 workflow 状态与触发入口" |
| 60 | 默认值使用硬编码中文 | medium | "查看 workflow 状态与触发入口" |
| 61 | 默认值使用硬编码中文 | medium | "导出会话 handoff packet" |
| 61 | 默认值使用硬编码中文 | medium | "导出会话 handoff packet" |
| 61 | 默认值使用硬编码中文 | medium | "导出会话 handoff packet" |
| 62 | 默认值使用硬编码中文 | medium | "基于 handoff 创建会话分支（不是 git 分支）" |
| 62 | 默认值使用硬编码中文 | medium | "基于 handoff 创建会话分支（不是 git 分支）" |
| 62 | 默认值使用硬编码中文 | medium | "基于 handoff 创建会话分支（不是 git 分支）" |
| 63 | 默认值使用硬编码中文 | medium | "查看 git 状态、稳定点建议、worktree 摘要（只读）" |
| 63 | 默认值使用硬编码中文 | medium | "查看 git 状态、稳定点建议、worktree 摘要（只读）" |
| 63 | 默认值使用硬编码中文 | medium | "查看 git 状态、稳定点建议、worktree 摘要（只读）" |
| 64 | 默认值使用硬编码中文 | medium | "查看 git worktree 列表（只读）" |
| 64 | 默认值使用硬编码中文 | medium | "查看 git worktree 列表（只读）" |
| 64 | 默认值使用硬编码中文 | medium | "查看 git worktree 列表（只读）" |
| 65 | 默认值使用硬编码中文 | medium | "查看 Linghun snapshot checkpoint / 稳定点建议" |
| 65 | 默认值使用硬编码中文 | medium | "查看 Linghun snapshot checkpoint / 稳定点建议" |
| 65 | 默认值使用硬编码中文 | medium | "查看 Linghun snapshot checkpoint / 稳定点建议" |
| 66 | 默认值使用硬编码中文 | medium | "查看 cache 使用情况与冷热分布" |
| 66 | 默认值使用硬编码中文 | medium | "查看 cache 使用情况与冷热分布" |
| 66 | 默认值使用硬编码中文 | medium | "查看 cache 使用情况与冷热分布" |
| 87 | 默认值使用硬编码中文 | medium | "展开最近正文 / evidence / background 详情" |
| 87 | 默认值使用硬编码中文 | medium | "展开最近正文 / evidence / background 详情" |
| 87 | 默认值使用硬编码中文 | medium | "展开最近正文 / evidence / background 详情" |
| 88 | 默认值使用硬编码中文 | medium | "查看 cache log 详情" |
| 88 | 默认值使用硬编码中文 | medium | "查看 cache log 详情" |
| 88 | 默认值使用硬编码中文 | medium | "查看 cache log 详情" |
| 89 | 默认值使用硬编码中文 | medium | "诊断 cache hash 漂移" |
| 89 | 默认值使用硬编码中文 | medium | "诊断 cache hash 漂移" |
| 89 | 默认值使用硬编码中文 | medium | "诊断 cache hash 漂移" |
| 90 | 默认值使用硬编码中文 | medium | "运行模型路由诊断" |
| 90 | 默认值使用硬编码中文 | medium | "运行模型路由诊断" |
| 90 | 默认值使用硬编码中文 | medium | "运行模型路由诊断" |
| 91 | 默认值使用硬编码中文 | medium | "查看 / 调整模型路由" |
| 91 | 默认值使用硬编码中文 | medium | "查看 / 调整模型路由" |
| 91 | 默认值使用硬编码中文 | medium | "查看 / 调整模型路由" |
| 92 | 默认值使用硬编码中文 | medium | "运行索引诊断" |
| 92 | 默认值使用硬编码中文 | medium | "运行索引诊断" |
| 92 | 默认值使用硬编码中文 | medium | "运行索引诊断" |
| 101 | 默认值使用硬编码中文 | medium | " }, ];  /**  * 取本组命令清单。隐藏命令（如 /status）已经在数据层过滤掉，不出现在  * HelpPanel 主流程；用户仍可通过 /h... |
| 101 | 默认值使用硬编码中文 | medium | " }, ];  /**  * 取本组命令清单。隐藏命令（如 /status）已经在数据层过滤掉，不出现在  * HelpPanel 主流程；用户仍可通过 /h... |
| 101 | 默认值使用硬编码中文 | medium | " }, ];  /**  * 取本组命令清单。隐藏命令（如 /status）已经在数据层过滤掉，不出现在  * HelpPanel 主流程；用户仍可通过 /h... |

### packages/tui/src/shell/models/input-owner-controller.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * InputOwnerController — D.13E Step 1  *  * 把 Composer.tsx useInput 回调里... |
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * InputOwnerController — D.13E Step 1  *  * 把 Composer.tsx useInput 回调里... |
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * InputOwnerController — D.13E Step 1  *  * 把 Composer.tsx useInput 回调里... |
| 11 | 默认值使用硬编码中文 | medium | "）reduce  * 出来，**不改派发优先级、不改副作用、不引入新 owner**。  *  * Composer 仍然各自负责 setState / se... |
| 11 | 默认值使用硬编码中文 | medium | "）reduce  * 出来，**不改派发优先级、不改副作用、不引入新 owner**。  *  * Composer 仍然各自负责 setState / se... |
| 11 | 默认值使用硬编码中文 | medium | "）reduce  * 出来，**不改派发优先级、不改副作用、不引入新 owner**。  *  * Composer 仍然各自负责 setState / se... |
| 23 | 默认值使用硬编码中文 | medium | ";  /** Composer 中各 owner 的有效条件（由调用方在每次 useInput 回调起始处计算并传入）。 */ export type Own... |
| 23 | 默认值使用硬编码中文 | medium | ";  /** Composer 中各 owner 的有效条件（由调用方在每次 useInput 回调起始处计算并传入）。 */ export type Own... |
| 23 | 默认值使用硬编码中文 | medium | ";  /** Composer 中各 owner 的有效条件（由调用方在每次 useInput 回调起始处计算并传入）。 */ export type Own... |
| 40 | 默认值使用硬编码中文 | medium | ">;  /**  * Owner-priority dispatcher 阈值。与 Composer.tsx 内常量保持一致：  *   - PASTE_TH... |
| 40 | 默认值使用硬编码中文 | medium | ">;  /**  * Owner-priority dispatcher 阈值。与 Composer.tsx 内常量保持一致：  *   - PASTE_TH... |
| 40 | 默认值使用硬编码中文 | medium | ">;  /**  * Owner-priority dispatcher 阈值。与 Composer.tsx 内常量保持一致：  *   - PASTE_TH... |
| 91 | 默认值使用硬编码中文 | medium | "。  *   4. composer（默认）  *  * 判定纯依赖 (input, key, ctx)，无副作用。  */ export function ... |
| 91 | 默认值使用硬编码中文 | medium | "。  *   4. composer（默认）  *  * 判定纯依赖 (input, key, ctx)，无副作用。  */ export function ... |
| 91 | 默认值使用硬编码中文 | medium | "。  *   4. composer（默认）  *  * 判定纯依赖 (input, key, ctx)，无副作用。  */ export function ... |
| 99 | 默认值使用硬编码中文 | medium | ";    // paste 优先：pending 期间的 Enter/Esc 也算 paste owner（用于吞 Enter / 取消粘贴）；   // 大... |
| 99 | 默认值使用硬编码中文 | medium | ";    // paste 优先：pending 期间的 Enter/Esc 也算 paste owner（用于吞 Enter / 取消粘贴）；   // 大... |
| 99 | 默认值使用硬编码中文 | medium | ";    // paste 优先：pending 期间的 Enter/Esc 也算 paste owner（用于吞 Enter / 取消粘贴）；   // 大... |
| 104 | 默认值使用硬编码中文 | medium | ";    if (ctx.slashVisible) {     // slash 只接管导航/确认按键，普通字符仍走 composer（不阻断输入）。   ... |
| 104 | 默认值使用硬编码中文 | medium | ";    if (ctx.slashVisible) {     // slash 只接管导航/确认按键，普通字符仍走 composer（不阻断输入）。   ... |
| 104 | 默认值使用硬编码中文 | medium | ";    if (ctx.slashVisible) {     // slash 只接管导航/确认按键，普通字符仍走 composer（不阻断输入）。   ... |
| 112 | 默认值使用硬编码中文 | medium | "       // 这一概念。selectInputOwner 不关心是 ↑ 还是 ↓。       isNavigationKey(key)     ) {... |
| 112 | 默认值使用硬编码中文 | medium | "       // 这一概念。selectInputOwner 不关心是 ↑ 还是 ↓。       isNavigationKey(key)     ) {... |
| 112 | 默认值使用硬编码中文 | medium | "       // 这一概念。selectInputOwner 不关心是 ↑ 还是 ↓。       isNavigationKey(key)     ) {... |
| 120 | 默认值使用硬编码中文 | medium | "; }  /**  * 仅判断 ink Key 上下/左右箭头是否被按下。从 Composer.tsx 的扩展接口看，  * useInput 在 ink@7... |
| 120 | 默认值使用硬编码中文 | medium | "; }  /**  * 仅判断 ink Key 上下/左右箭头是否被按下。从 Composer.tsx 的扩展接口看，  * useInput 在 ink@7... |
| 120 | 默认值使用硬编码中文 | medium | "; }  /**  * 仅判断 ink Key 上下/左右箭头是否被按下。从 Composer.tsx 的扩展接口看，  * useInput 在 ink@7... |
| 140 | 默认值使用硬编码中文 | medium | " && !key.ctrl && !key.meta; }  /** 调试 / 测试辅助：返回 owner 选择的稳定优先级数组。 */ export con... |
| 140 | 默认值使用硬编码中文 | medium | " && !key.ctrl && !key.meta; }  /** 调试 / 测试辅助：返回 owner 选择的稳定优先级数组。 */ export con... |
| 140 | 默认值使用硬编码中文 | medium | " && !key.ctrl && !key.meta; }  /** 调试 / 测试辅助：返回 owner 选择的稳定优先级数组。 */ export con... |

### packages/tui/src/shell/models/permission-elevation.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 3 | 默认值使用硬编码中文 | medium | ";  /**  * PermissionElevationModel — D.13E Step 1（v3 修正）  *  * 纯函数：根据当前权限上下文（to... |
| 3 | 默认值使用硬编码中文 | medium | ";  /**  * PermissionElevationModel — D.13E Step 1（v3 修正）  *  * 纯函数：根据当前权限上下文（to... |
| 3 | 默认值使用硬编码中文 | medium | ";  /**  * PermissionElevationModel — D.13E Step 1（v3 修正）  *  * 纯函数：根据当前权限上下文（to... |
| 17 | 默认值使用硬编码中文 | medium | " 落盘由 controller 层调用 addAllowRule helper（见 index.ts）。  *  * 已存在 effect:" |
| 17 | 默认值使用硬编码中文 | medium | " 落盘由 controller 层调用 addAllowRule helper（见 index.ts）。  *  * 已存在 effect:" |
| 17 | 默认值使用硬编码中文 | medium | " 落盘由 controller 层调用 addAllowRule helper（见 index.ts）。  *  * 已存在 effect:" |
| 19 | 默认值使用硬编码中文 | medium | " 规则时，allow_always_tool 隐藏，  * 避免重复落盘和误导用户。  *  * v3 契约调整：删除 dispatches 字段。原本" |
| 19 | 默认值使用硬编码中文 | medium | " 规则时，allow_always_tool 隐藏，  * 避免重复落盘和误导用户。  *  * v3 契约调整：删除 dispatches 字段。原本" |
| 19 | 默认值使用硬编码中文 | medium | " 规则时，allow_always_tool 隐藏，  * 避免重复落盘和误导用户。  *  * v3 契约调整：删除 dispatches 字段。原本" |
| 22 | 默认值使用硬编码中文 | medium | "  * 的复合 dispatch 由 model 描述、UI 顺次发两个 onInput 的设计会与  * pendingLocalApproval 状态竞争... |
| 22 | 默认值使用硬编码中文 | medium | "  * 的复合 dispatch 由 model 描述、UI 顺次发两个 onInput 的设计会与  * pendingLocalApproval 状态竞争... |
| 22 | 默认值使用硬编码中文 | medium | "  * 的复合 dispatch 由 model 描述、UI 顺次发两个 onInput 的设计会与  * pendingLocalApproval 状态竞争... |
| 30 | 默认值使用硬编码中文 | medium | ";  export type ElevationOption = {   id: ElevationOptionId;   /** 单字母快捷键。detail... |
| 30 | 默认值使用硬编码中文 | medium | ";  export type ElevationOption = {   id: ElevationOptionId;   /** 单字母快捷键。detail... |
| 30 | 默认值使用硬编码中文 | medium | ";  export type ElevationOption = {   id: ElevationOptionId;   /** 单字母快捷键。detail... |
| 53 | 默认值使用硬编码中文 | medium | "始终允许该工具" |
| 53 | 默认值使用硬编码中文 | medium | "始终允许该工具" |
| 53 | 默认值使用硬编码中文 | medium | "始终允许该工具" |
| 56 | 默认值使用硬编码中文 | medium | "仅本次执行；规则不会落盘" |
| 56 | 默认值使用硬编码中文 | medium | "仅本次执行；规则不会落盘" |
| 56 | 默认值使用硬编码中文 | medium | "仅本次执行；规则不会落盘" |
| 57 | 默认值使用硬编码中文 | medium | "未来同工具静默通过（低风险）" |
| 57 | 默认值使用硬编码中文 | medium | "未来同工具静默通过（低风险）" |
| 57 | 默认值使用硬编码中文 | medium | "未来同工具静默通过（低风险）" |
| 58 | 默认值使用硬编码中文 | medium | "未来同工具静默通过（中风险，请确认）" |
| 58 | 默认值使用硬编码中文 | medium | "未来同工具静默通过（中风险，请确认）" |
| 58 | 默认值使用硬编码中文 | medium | "未来同工具静默通过（中风险，请确认）" |
| 59 | 默认值使用硬编码中文 | medium | "未来同工具静默通过（高风险，建议先 details）" |
| 59 | 默认值使用硬编码中文 | medium | "未来同工具静默通过（高风险，建议先 details）" |
| 59 | 默认值使用硬编码中文 | medium | "未来同工具静默通过（高风险，建议先 details）" |
| 60 | 默认值使用硬编码中文 | medium | "已存在 allow 规则，无需重复落盘" |
| 60 | 默认值使用硬编码中文 | medium | "已存在 allow 规则，无需重复落盘" |
| 60 | 默认值使用硬编码中文 | medium | "已存在 allow 规则，无需重复落盘" |
| 61 | 默认值使用硬编码中文 | medium | "本次拒绝；可继续对话调整方案" |
| 61 | 默认值使用硬编码中文 | medium | "本次拒绝；可继续对话调整方案" |
| 61 | 默认值使用硬编码中文 | medium | "本次拒绝；可继续对话调整方案" |
| 62 | 默认值使用硬编码中文 | medium | "展开原因 / 影响范围 / 安全级别" |
| 62 | 默认值使用硬编码中文 | medium | "展开原因 / 影响范围 / 安全级别" |
| 62 | 默认值使用硬编码中文 | medium | "展开原因 / 影响范围 / 安全级别" |
| 76 | 默认值使用硬编码中文 | medium | ",   }, } as const;  /**  * 检测当前 rules 中是否已经有覆盖 `toolName` 的 effect:" |
| 76 | 默认值使用硬编码中文 | medium | ",   }, } as const;  /**  * 检测当前 rules 中是否已经有覆盖 `toolName` 的 effect:" |
| 76 | 默认值使用硬编码中文 | medium | ",   }, } as const;  /**  * 检测当前 rules 中是否已经有覆盖 `toolName` 的 effect:" |
| 81 | 默认值使用硬编码中文 | medium | " 规则。  * 与 /permissions add 的语义对齐：toolName 为 " |
| 81 | 默认值使用硬编码中文 | medium | " 规则。  * 与 /permissions add 的语义对齐：toolName 为 " |
| 81 | 默认值使用硬编码中文 | medium | " 规则。  * 与 /permissions add 的语义对齐：toolName 为 " |
| 82 | 默认值使用硬编码中文 | medium | " 表示通配；risk 限定可能更窄，  * 但只要存在一条无 risk 限定或 risk 等于当前 risk 的 allow 规则，就视为已覆盖。  *  *... |
| 82 | 默认值使用硬编码中文 | medium | " 表示通配；risk 限定可能更窄，  * 但只要存在一条无 risk 限定或 risk 等于当前 risk 的 allow 规则，就视为已覆盖。  *  *... |
| 82 | 默认值使用硬编码中文 | medium | " 表示通配；risk 限定可能更窄，  * 但只要存在一条无 risk 限定或 risk 等于当前 risk 的 allow 规则，就视为已覆盖。  *  *... |
| 110 | 默认值使用硬编码中文 | medium | "): string {   // Documented for tooling/help; controller side now invokes addAl... |
| 110 | 默认值使用硬编码中文 | medium | "): string {   // Documented for tooling/help; controller side now invokes addAl... |
| 110 | 默认值使用硬编码中文 | medium | "): string {   // Documented for tooling/help; controller side now invokes addAl... |
| 119 | 默认值使用硬编码中文 | medium | " 的 atomic 操作。  */ export function describeAllowAlwaysCommand(   toolName: ToolN... |
| 119 | 默认值使用硬编码中文 | medium | " 的 atomic 操作。  */ export function describeAllowAlwaysCommand(   toolName: ToolN... |
| 119 | 默认值使用硬编码中文 | medium | " 的 atomic 操作。  */ export function describeAllowAlwaysCommand(   toolName: ToolN... |
| 123 | 默认值使用硬编码中文 | medium | ", ): string {   return buildAllowAlwaysSlashCommand(toolName, risk); }  /**  * ... |
| 123 | 默认值使用硬编码中文 | medium | ", ): string {   return buildAllowAlwaysSlashCommand(toolName, risk); }  /**  * ... |
| 123 | 默认值使用硬编码中文 | medium | ", ): string {   return buildAllowAlwaysSlashCommand(toolName, risk); }  /**  * ... |

### packages/tui/src/shell/models/permission-explanation.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — permission-explanation 翻译层  *  * 把 permission-policy-engin... |
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — permission-explanation 翻译层  *  * 把 permission-policy-engin... |
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — permission-explanation 翻译层  *  * 把 permission-policy-engin... |
| 29 | 默认值使用硬编码中文 | medium | ";  /**  * 把 reason 字符串里的 rule.id（randomUUID 形如  * `命中 deny 规则：a3b4c2-...` / `命中... |
| 29 | 默认值使用硬编码中文 | medium | ";  /**  * 把 reason 字符串里的 rule.id（randomUUID 形如  * `命中 deny 规则：a3b4c2-...` / `命中... |
| 29 | 默认值使用硬编码中文 | medium | ";  /**  * 把 reason 字符串里的 rule.id（randomUUID 形如  * `命中 deny 规则：a3b4c2-...` / `命中... |
| 37 | 默认值使用硬编码中文 | medium | ";   return reason     .replace(/命中\s*(deny\|ask\|allow)\s*规则[：:].*/gu, (_match, e... |
| 37 | 默认值使用硬编码中文 | medium | ";   return reason     .replace(/命中\s*(deny\|ask\|allow)\s*规则[：:].*/gu, (_match, e... |
| 37 | 默认值使用硬编码中文 | medium | ";   return reason     .replace(/命中\s*(deny\|ask\|allow)\s*规则[：:].*/gu, (_match, e... |
| 41 | 默认值使用硬编码中文 | medium | "命中拒绝规则。" |
| 41 | 默认值使用硬编码中文 | medium | "命中拒绝规则。" |
| 41 | 默认值使用硬编码中文 | medium | "命中拒绝规则。" |
| 43 | 默认值使用硬编码中文 | medium | "命中需确认规则。" |
| 43 | 默认值使用硬编码中文 | medium | "命中需确认规则。" |
| 43 | 默认值使用硬编码中文 | medium | "命中需确认规则。" |
| 44 | 默认值使用硬编码中文 | medium | "命中允许规则。" |
| 44 | 默认值使用硬编码中文 | medium | "命中允许规则。" |
| 44 | 默认值使用硬编码中文 | medium | "命中允许规则。" |
| 51 | 默认值使用硬编码中文 | medium | ",     ); }  /**  * 把 PolicyVerdict.semantic 翻译成 user-facing 中文/英文短句。  */ export... |
| 51 | 默认值使用硬编码中文 | medium | ",     ); }  /**  * 把 PolicyVerdict.semantic 翻译成 user-facing 中文/英文短句。  */ export... |
| 51 | 默认值使用硬编码中文 | medium | ",     ); }  /**  * 把 PolicyVerdict.semantic 翻译成 user-facing 中文/英文短句。  */ export... |
| 64 | 默认值使用硬编码中文 | medium | "可能修改工作区文件。" |
| 64 | 默认值使用硬编码中文 | medium | "可能修改工作区文件。" |
| 64 | 默认值使用硬编码中文 | medium | "可能修改工作区文件。" |
| 68 | 默认值使用硬编码中文 | medium | "破坏性命令（删除 / 覆盖 / 关停）。" |
| 68 | 默认值使用硬编码中文 | medium | "破坏性命令（删除 / 覆盖 / 关停）。" |
| 68 | 默认值使用硬编码中文 | medium | "破坏性命令（删除 / 覆盖 / 关停）。" |
| 70 | 默认值使用硬编码中文 | medium | "会发起网络请求。" |
| 70 | 默认值使用硬编码中文 | medium | "会发起网络请求。" |
| 70 | 默认值使用硬编码中文 | medium | "会发起网络请求。" |
| 72 | 默认值使用硬编码中文 | medium | "安装或更新依赖。" |
| 72 | 默认值使用硬编码中文 | medium | "安装或更新依赖。" |
| 72 | 默认值使用硬编码中文 | medium | "安装或更新依赖。" |
| 74 | 默认值使用硬编码中文 | medium | "读取敏感文件。" |
| 74 | 默认值使用硬编码中文 | medium | "读取敏感文件。" |
| 74 | 默认值使用硬编码中文 | medium | "读取敏感文件。" |
| 76 | 默认值使用硬编码中文 | medium | "涉及工作区外的路径。" |
| 76 | 默认值使用硬编码中文 | medium | "涉及工作区外的路径。" |
| 76 | 默认值使用硬编码中文 | medium | "涉及工作区外的路径。" |
| 78 | 默认值使用硬编码中文 | medium | "需要确认后再执行。" |
| 78 | 默认值使用硬编码中文 | medium | "需要确认后再执行。" |
| 78 | 默认值使用硬编码中文 | medium | "需要确认后再执行。" |
| 89 | 默认值使用硬编码中文 | medium | "路径在工作区且安全。" |
| 89 | 默认值使用硬编码中文 | medium | "路径在工作区且安全。" |
| 89 | 默认值使用硬编码中文 | medium | "路径在工作区且安全。" |
| 91 | 默认值使用硬编码中文 | medium | "在工作区内写入。" |
| 91 | 默认值使用硬编码中文 | medium | "在工作区内写入。" |
| 91 | 默认值使用硬编码中文 | medium | "在工作区内写入。" |
| 93 | 默认值使用硬编码中文 | medium | "涉及工作区外路径。" |
| 93 | 默认值使用硬编码中文 | medium | "涉及工作区外路径。" |
| 93 | 默认值使用硬编码中文 | medium | "涉及工作区外路径。" |
| 95 | 默认值使用硬编码中文 | medium | "涉及敏感路径。" |
| 95 | 默认值使用硬编码中文 | medium | "涉及敏感路径。" |
| 95 | 默认值使用硬编码中文 | medium | "涉及敏感路径。" |
| 97 | 默认值使用硬编码中文 | medium | "路径分类未知。" |
| 97 | 默认值使用硬编码中文 | medium | "路径分类未知。" |
| 97 | 默认值使用硬编码中文 | medium | "路径分类未知。" |
| 102 | 默认值使用硬编码中文 | medium | "如何永久允许 / 修改规则" |
| 102 | 默认值使用硬编码中文 | medium | "如何永久允许 / 修改规则" |
| 102 | 默认值使用硬编码中文 | medium | "如何永久允许 / 修改规则" |
| 108 | 默认值使用硬编码中文 | medium | "可用 /permissions 查看与调整规则。" |
| 108 | 默认值使用硬编码中文 | medium | "可用 /permissions 查看与调整规则。" |
| 108 | 默认值使用硬编码中文 | medium | "可用 /permissions 查看与调整规则。" |

### packages/tui/src/shell/models/task-scroll-state.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 7 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX Task Surface — 任务区滚动状态推进（纯函数）。  *  * 本模块是 transcript-scroll-... |
| 7 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX Task Surface — 任务区滚动状态推进（纯函数）。  *  * 本模块是 transcript-scroll-... |
| 7 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX Task Surface — 任务区滚动状态推进（纯函数）。  *  * 本模块是 transcript-scroll-... |

### packages/tui/src/shell/models/task-suggestion.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 3 | 默认值使用硬编码中文 | medium | ";  /**  * TaskSuggestionModel — D.13E Step 1  *  * 把 slash candidates、setup hin... |
| 3 | 默认值使用硬编码中文 | medium | ";  /**  * TaskSuggestionModel — D.13E Step 1  *  * 把 slash candidates、setup hin... |
| 3 | 默认值使用硬编码中文 | medium | ";  /**  * TaskSuggestionModel — D.13E Step 1  *  * 把 slash candidates、setup hin... |
| 23 | 默认值使用硬编码中文 | medium | "; id: string };  export type TaskSuggestion = {   id: string;   source: TaskSug... |
| 23 | 默认值使用硬编码中文 | medium | "; id: string };  export type TaskSuggestion = {   id: string;   source: TaskSug... |
| 23 | 默认值使用硬编码中文 | medium | "; id: string };  export type TaskSuggestion = {   id: string;   source: TaskSug... |
| 53 | 默认值使用硬编码中文 | medium | ": {     // D.13L Block E：permissionDetailsLabel/Hint 已停用（权限卡只剩 3 项动作），     // 字... |
| 53 | 默认值使用硬编码中文 | medium | ": {     // D.13L Block E：permissionDetailsLabel/Hint 已停用（权限卡只剩 3 项动作），     // 字... |
| 53 | 默认值使用硬编码中文 | medium | ": {     // D.13L Block E：permissionDetailsLabel/Hint 已停用（权限卡只剩 3 项动作），     // 字... |
| 58 | 默认值使用硬编码中文 | medium | "查看完整错误" |
| 58 | 默认值使用硬编码中文 | medium | "查看完整错误" |
| 58 | 默认值使用硬编码中文 | medium | "查看完整错误" |
| 59 | 默认值使用硬编码中文 | medium | "按 Ctrl+O 查看最近一次失败输出（或 /details）" |
| 59 | 默认值使用硬编码中文 | medium | "按 Ctrl+O 查看最近一次失败输出（或 /details）" |
| 59 | 默认值使用硬编码中文 | medium | "按 Ctrl+O 查看最近一次失败输出（或 /details）" |
| 60 | 默认值使用硬编码中文 | medium | "继续模型配置" |
| 60 | 默认值使用硬编码中文 | medium | "继续模型配置" |
| 60 | 默认值使用硬编码中文 | medium | "继续模型配置" |
| 61 | 默认值使用硬编码中文 | medium | "回到 setup 流，按 Enter 进入下一步" |
| 61 | 默认值使用硬编码中文 | medium | "回到 setup 流，按 Enter 进入下一步" |
| 61 | 默认值使用硬编码中文 | medium | "回到 setup 流，按 Enter 进入下一步" |
| 69 | 默认值使用硬编码中文 | medium | ",   }, } as const;  const VALID_SLASHES: ReadonlySet<string> = new Set(   SLASH... |
| 69 | 默认值使用硬编码中文 | medium | ",   }, } as const;  const VALID_SLASHES: ReadonlySet<string> = new Set(   SLASH... |
| 69 | 默认值使用硬编码中文 | medium | ",   }, } as const;  const VALID_SLASHES: ReadonlySet<string> = new Set(   SLASH... |
| 79 | 默认值使用硬编码中文 | medium | " 命中 root（与 NaturalCommandBridge 行为一致）。  *  * 暴露为独立纯函数便于 ConfigControlPlane / 上层... |
| 79 | 默认值使用硬编码中文 | medium | " 命中 root（与 NaturalCommandBridge 行为一致）。  *  * 暴露为独立纯函数便于 ConfigControlPlane / 上层... |
| 79 | 默认值使用硬编码中文 | medium | " 命中 root（与 NaturalCommandBridge 行为一致）。  *  * 暴露为独立纯函数便于 ConfigControlPlane / 上层... |
| 91 | 默认值使用硬编码中文 | medium | " && !isKnownSlashCommand(suggestion.action.command)) {     return;   }   out.pu... |
| 91 | 默认值使用硬编码中文 | medium | " && !isKnownSlashCommand(suggestion.action.command)) {     return;   }   out.pu... |
| 91 | 默认值使用硬编码中文 | medium | " && !isKnownSlashCommand(suggestion.action.command)) {     return;   }   out.pu... |

### packages/tui/src/shell/models/transcript-scroll-state.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX Task Surface — 主 transcript 滚动状态推进（纯函数）。  *  * scrollOffset ... |
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX Task Surface — 主 transcript 滚动状态推进（纯函数）。  *  * scrollOffset ... |
| 1 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX Task Surface — 主 transcript 滚动状态推进（纯函数）。  *  * scrollOffset ... |
| 11 | 默认值使用硬编码中文 | medium | ", action }：CCB-like semantic pager action；  *     PgUp/PgDn 按测量视口滚半页，wheel/arro... |
| 11 | 默认值使用硬编码中文 | medium | ", action }：CCB-like semantic pager action；  *     PgUp/PgDn 按测量视口滚半页，wheel/arro... |
| 11 | 默认值使用硬编码中文 | medium | ", action }：CCB-like semantic pager action；  *     PgUp/PgDn 按测量视口滚半页，wheel/arro... |
| 13 | 默认值使用硬编码中文 | medium | ", delta }：兼容旧测试/调用，delta>0 向上看更早内容。  *   - { type: " |
| 13 | 默认值使用硬编码中文 | medium | ", delta }：兼容旧测试/调用，delta>0 向上看更早内容。  *   - { type: " |
| 13 | 默认值使用硬编码中文 | medium | ", delta }：兼容旧测试/调用，delta>0 向上看更早内容。  *   - { type: " |
| 14 | 默认值使用硬编码中文 | medium | " }：归零吸底。  *  * stickToBottom 推导：  *   - next.scrollOffset === 0 → true（无偏移即视为吸底... |
| 14 | 默认值使用硬编码中文 | medium | " }：归零吸底。  *  * stickToBottom 推导：  *   - next.scrollOffset === 0 → true（无偏移即视为吸底... |
| 14 | 默认值使用硬编码中文 | medium | " }：归零吸底。  *  * stickToBottom 推导：  *   - next.scrollOffset === 0 → true（无偏移即视为吸底... |
| 105 | 默认值使用硬编码中文 | medium | ":       return -state.scrollOffset;   } }  /**  * D.14D-C2 — 测量后夹紧（pure，供 Scrol... |
| 105 | 默认值使用硬编码中文 | medium | ":       return -state.scrollOffset;   } }  /**  * D.14D-C2 — 测量后夹紧（pure，供 Scrol... |
| 105 | 默认值使用硬编码中文 | medium | ":       return -state.scrollOffset;   } }  /**  * D.14D-C2 — 测量后夹紧（pure，供 Scrol... |
| 114 | 默认值使用硬编码中文 | medium | "。本函数把 state.scrollOffset 夹到 [0, maxOffset]，  * 修掉旧的无界 `marginTop={-scrollOffset... |
| 114 | 默认值使用硬编码中文 | medium | "。本函数把 state.scrollOffset 夹到 [0, maxOffset]，  * 修掉旧的无界 `marginTop={-scrollOffset... |
| 114 | 默认值使用硬编码中文 | medium | "。本函数把 state.scrollOffset 夹到 [0, maxOffset]，  * 修掉旧的无界 `marginTop={-scrollOffset... |

### packages/tui/src/shell/plain-renderer.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 313 | 默认值使用硬编码中文 | medium | "); }  // ----------------------------------------------------------------------... |
| 313 | 默认值使用硬编码中文 | medium | "); }  // ----------------------------------------------------------------------... |

### packages/tui/src/shell/theme.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 2 | 默认值使用硬编码中文 | medium | ";  export type ShellTheme = {   mode: ShellThemeMode;   brand: string \| undefin... |
| 2 | 默认值使用硬编码中文 | medium | ";  export type ShellTheme = {   mode: ShellThemeMode;   brand: string \| undefin... |
| 76 | 默认值使用硬编码中文 | medium | ",     },     // D.13Q-UX 语义键 —— assistant 正文用 brand white（默认色），不再借 info=cyan   ... |
| 76 | 默认值使用硬编码中文 | medium | ",     },     // D.13Q-UX 语义键 —— assistant 正文用 brand white（默认色），不再借 info=cyan   ... |

### packages/tui/src/shell/types.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 19 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — 消息语义维度（与 ProductBlockKind 的" |
| 19 | 默认值使用硬编码中文 | medium | ";  /**  * D.13Q-UX — 消息语义维度（与 ProductBlockKind 的" |
| 22 | 默认值使用硬编码中文 | medium | "维度正交）。  *  * - assistant_text: 普通 assistant 正文 / 最终汇报，走 Markdown，默认色，不卡片化。  * -... |
| 22 | 默认值使用硬编码中文 | medium | "维度正交）。  *  * - assistant_text: 普通 assistant 正文 / 最终汇报，走 Markdown，默认色，不卡片化。  * -... |
| 27 | 默认值使用硬编码中文 | medium | " 前缀 + 默认色正文。  * - tool_result_success / _error / _cancelled / _rejected: 工具结果四态... |
| 27 | 默认值使用硬编码中文 | medium | " 前缀 + 默认色正文。  * - tool_result_success / _error / _cancelled / _rejected: 工具结果四态... |
| 52 | 默认值使用硬编码中文 | medium | ";  export type ProductBlockViewModel = {   id: string;   kind: ProductBlockKind... |
| 52 | 默认值使用硬编码中文 | medium | ";  export type ProductBlockViewModel = {   id: string;   kind: ProductBlockKind... |
| 102 | 默认值使用硬编码中文 | medium | ";   /** 自动消失（毫秒）；undefined 表示常驻直到状态消失。 */   timeoutMs?: number;   /** 写入时间戳（毫秒）... |
| 102 | 默认值使用硬编码中文 | medium | ";   /** 自动消失（毫秒）；undefined 表示常驻直到状态消失。 */   timeoutMs?: number;   /** 写入时间戳（毫秒）... |
| 108 | 默认值使用硬编码中文 | medium | "; };  export type StatusTrayViewModel = {   project: string;   model: string;  ... |
| 108 | 默认值使用硬编码中文 | medium | "; };  export type StatusTrayViewModel = {   project: string;   model: string;  ... |
| 136 | 默认值使用硬编码中文 | medium | " 类。 */   busyHint?: string; };  export type ShellViewMode = " |
| 136 | 默认值使用硬编码中文 | medium | " 类。 */   busyHint?: string; };  export type ShellViewMode = " |
| 143 | 默认值使用硬编码中文 | medium | ";   text: string;   toolName?: string;   elapsed?: string; };  /**  * D.13E Ste... |
| 143 | 默认值使用硬编码中文 | medium | ";   text: string;   toolName?: string;   elapsed?: string; };  /**  * D.13E Ste... |
| 176 | 默认值使用硬编码中文 | medium | ";   scope: string[];   hint: string;   /**    * D.13L Block 0-B — 主屏权限卡的" |
| 176 | 默认值使用硬编码中文 | medium | ";   scope: string[];   hint: string;   /**    * D.13L Block 0-B — 主屏权限卡的" |
| 180 | 默认值使用硬编码中文 | medium | "摘要行，例如：    *   " |
| 180 | 默认值使用硬编码中文 | medium | "摘要行，例如：    *   " |
| 182 | 默认值使用硬编码中文 | medium | "写入文件：packages/tui/src/foo.ts" |
| 182 | 默认值使用硬编码中文 | medium | "写入文件：packages/tui/src/foo.ts" |
| 183 | 默认值使用硬编码中文 | medium | "使用工具：Glob" |
| 183 | 默认值使用硬编码中文 | medium | "使用工具：Glob" |
| 196 | 默认值使用硬编码中文 | medium | "    * 的解释，但**不暴露 rule.id / hook id / classifier 内部枚举**。    * 详情可由 /details 进一步展... |
| 196 | 默认值使用硬编码中文 | medium | "    * 的解释，但**不暴露 rule.id / hook id / classifier 内部枚举**。    * 详情可由 /details 进一步展... |
| 221 | 默认值使用硬编码中文 | medium | "推理 High" |
| 221 | 默认值使用硬编码中文 | medium | "推理 High" |
| 222 | 默认值使用硬编码中文 | medium | ". Absent when the active provider/model does not surface    * a reasoning level... |
| 222 | 默认值使用硬编码中文 | medium | ". Absent when the active provider/model does not surface    * a reasoning level... |
| 228 | 默认值使用硬编码中文 | medium | "    * 等占位状态时 true，避免把 stale 兜底（如 deepseek-chat）当成正常 model 显示。    */   modelDim?... |
| 228 | 默认值使用硬编码中文 | medium | "    * 等占位状态时 true，避免把 stale 兜底（如 deepseek-chat）当成正常 model 显示。    */   modelDim?... |
| 235 | 默认值使用硬编码中文 | medium | ";   /**    * Footer workspace/worktree line. Keep it short and above runtimeSta... |
| 235 | 默认值使用硬编码中文 | medium | ";   /**    * Footer workspace/worktree line. Keep it short and above runtimeSta... |
| 263 | 默认值使用硬编码中文 | medium | ";       panel: { id: string; title: string; summary: string };       actionCurs... |
| 263 | 默认值使用硬编码中文 | medium | ";       panel: { id: string; title: string; summary: string };       actionCurs... |
| 276 | 默认值使用硬编码中文 | medium | "MCP 已连接：3 / 3" |
| 276 | 默认值使用硬编码中文 | medium | "MCP 已连接：3 / 3" |
| 278 | 默认值使用硬编码中文 | medium | "）。  *   - detailsText：完整明细文本，供显式详情面板（如 /details）展开。  *   - tone：neutral / warni... |
| 278 | 默认值使用硬编码中文 | medium | "）。  *   - detailsText：完整明细文本，供显式详情面板（如 /details）展开。  *   - tone：neutral / warni... |
| 305 | 默认值使用硬编码中文 | medium | ";   cursor?: number;   scrollOffset?: number;   /** 面板内部是否处于" |
| 305 | 默认值使用硬编码中文 | medium | ";   cursor?: number;   scrollOffset?: number;   /** 面板内部是否处于" |
| 308 | 默认值使用硬编码中文 | medium | "状态。 */   expanded?: boolean; };  export type TranscriptScrollView = {   scrollO... |
| 308 | 默认值使用硬编码中文 | medium | "状态。 */   expanded?: boolean; };  export type TranscriptScrollView = {   scrollO... |
| 360 | 默认值使用硬编码中文 | medium | ";  export type ShellViewModel = {   language: Language;   projectName: string; ... |
| 360 | 默认值使用硬编码中文 | medium | ";  export type ShellViewModel = {   language: Language;   projectName: string; ... |
| 397 | 默认值使用硬编码中文 | medium | ").TaskSuggestion[];   taskSuggestionCursor?: number;   /**    * D.13E Step 2 — ... |
| 397 | 默认值使用硬编码中文 | medium | ").TaskSuggestion[];   taskSuggestionCursor?: number;   /**    * D.13E Step 2 — ... |
| 421 | 默认值使用硬编码中文 | medium | ";     cursor: number;     entries: { slash: string; description: string }[];   ... |
| 421 | 默认值使用硬编码中文 | medium | ";     cursor: number;     entries: { slash: string; description: string }[];   ... |
| 430 | 默认值使用硬编码中文 | medium | ";     answer?: string;     error?: string;   };   /**    * D.13Q-UX Closure — S... |
| 430 | 默认值使用硬编码中文 | medium | ";     answer?: string;     error?: string;   };   /**    * D.13Q-UX Closure — S... |
| 468 | 默认值使用硬编码中文 | medium | "; suggestionId: string }   /**    * D.13Q-UX — Ctrl+O 派发：直接触发" |
| 468 | 默认值使用硬编码中文 | medium | "; suggestionId: string }   /**    * D.13Q-UX — Ctrl+O 派发：直接触发" |
| 470 | 默认值使用硬编码中文 | medium | "，不写 buffer、不进 transcript    * 命令行（旧实现 submit " |
| 470 | 默认值使用硬编码中文 | medium | "，不写 buffer、不进 transcript    * 命令行（旧实现 submit " |
| 471 | 默认值使用硬编码中文 | medium | " 会让用户输入区里出现 /details）。    * /details slash 仍保留为兼容命令；本事件是主交互入口。    */   \| { type... |
| 471 | 默认值使用硬编码中文 | medium | " 会让用户输入区里出现 /details）。    * /details slash 仍保留为兼容命令；本事件是主交互入口。    */   \| { type... |
| 474 | 默认值使用硬编码中文 | medium | " }   /**    * D.13Q-UX Closure — HelpPanel 事件：core / advanced / details 三组导航。  ... |
| 474 | 默认值使用硬编码中文 | medium | " }   /**    * D.13Q-UX Closure — HelpPanel 事件：core / advanced / details 三组导航。  ... |
| 484 | 默认值使用硬编码中文 | medium | " }   /**    * D.13Q-UX Closure — BtwPanel 事件：side question 独立面板，    * 不进主 conve... |
| 484 | 默认值使用硬编码中文 | medium | " }   /**    * D.13Q-UX Closure — BtwPanel 事件：side question 独立面板，    * 不进主 conve... |
| 490 | 默认值使用硬编码中文 | medium | " }   /**    * D.13Q-UX Closure — SessionsPanel 事件：picker 选择 + 关闭。    */   \| { t... |
| 490 | 默认值使用硬编码中文 | medium | " }   /**    * D.13Q-UX Closure — SessionsPanel 事件：picker 选择 + 关闭。    */   \| { t... |
| 497 | 默认值使用硬编码中文 | medium | " }   /**    * Transcript scroll events. CCB-compatible behavior is implemented ... |
| 497 | 默认值使用硬编码中文 | medium | " }   /**    * Transcript scroll events. CCB-compatible behavior is implemented ... |

### packages/tui/src/shell/view-model.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 49 | 默认值使用硬编码中文 | medium | "技术普惠会越来越成熟 而你就是最伟大的梦想家" |
| 49 | 默认值使用硬编码中文 | medium | "技术普惠会越来越成熟 而你就是最伟大的梦想家" |
| 50 | 默认值使用硬编码中文 | medium | "技术普惠，你是最伟大的梦想家" |
| 50 | 默认值使用硬编码中文 | medium | "技术普惠，你是最伟大的梦想家" |
| 55 | 默认值使用硬编码中文 | medium | "我能帮您做点什么？" |
| 55 | 默认值使用硬编码中文 | medium | "我能帮您做点什么？" |
| 57 | 默认值使用硬编码中文 | medium | "按 Enter 开始配置模型" |
| 57 | 默认值使用硬编码中文 | medium | "按 Enter 开始配置模型" |
| 58 | 默认值使用硬编码中文 | medium | "粘贴 API Key（输入会被遮蔽）" |
| 58 | 默认值使用硬编码中文 | medium | "粘贴 API Key（输入会被遮蔽）" |
| 59 | 默认值使用硬编码中文 | medium | "输入 Base URL，回车确认" |
| 59 | 默认值使用硬编码中文 | medium | "输入 Base URL，回车确认" |
| 60 | 默认值使用硬编码中文 | medium | "输入模型名，回车确认" |
| 60 | 默认值使用硬编码中文 | medium | "输入模型名，回车确认" |
| 61 | 默认值使用硬编码中文 | medium | "选择 reasoning level（low/medium/high），回车确认" |
| 61 | 默认值使用硬编码中文 | medium | "选择 reasoning level（low/medium/high），回车确认" |
| 62 | 默认值使用硬编码中文 | medium | "输入辅助模型，留空跳过" |
| 62 | 默认值使用硬编码中文 | medium | "输入辅助模型，留空跳过" |
| 63 | 默认值使用硬编码中文 | medium | "y 确认 · n 重填" |
| 63 | 默认值使用硬编码中文 | medium | "y 确认 · n 重填" |
| 64 | 默认值使用硬编码中文 | medium | "配置 · API Key" |
| 64 | 默认值使用硬编码中文 | medium | "配置 · API Key" |
| 65 | 默认值使用硬编码中文 | medium | "配置 · Base URL" |
| 65 | 默认值使用硬编码中文 | medium | "配置 · Base URL" |
| 66 | 默认值使用硬编码中文 | medium | "配置 · Model" |
| 66 | 默认值使用硬编码中文 | medium | "配置 · Model" |
| 67 | 默认值使用硬编码中文 | medium | "配置 · Reasoning" |
| 67 | 默认值使用硬编码中文 | medium | "配置 · Reasoning" |
| 68 | 默认值使用硬编码中文 | medium | "配置 · Aux Model" |
| 68 | 默认值使用硬编码中文 | medium | "配置 · Aux Model" |
| 69 | 默认值使用硬编码中文 | medium | "配置 · 确认" |
| 69 | 默认值使用硬编码中文 | medium | "配置 · 确认" |
| 70 | 默认值使用硬编码中文 | medium | "选择操作：y 同意 · n 拒绝 · d 详情 · Esc 取消" |
| 70 | 默认值使用硬编码中文 | medium | "选择操作：y 同意 · n 拒绝 · d 详情 · Esc 取消" |
| 75 | 默认值使用硬编码中文 | medium | "已通过同一条 TUI controller 路径提交。" |
| 75 | 默认值使用硬编码中文 | medium | "已通过同一条 TUI controller 路径提交。" |
| 76 | 默认值使用硬编码中文 | medium | "还没有模型配置。按 Enter 开始，或说\u201c我要配置模型\u201d。" |
| 76 | 默认值使用硬编码中文 | medium | "还没有模型配置。按 Enter 开始，或说\u201c我要配置模型\u201d。" |
| 77 | 默认值使用硬编码中文 | medium | "项目模型路由需要处理" |
| 77 | 默认值使用硬编码中文 | medium | "项目模型路由需要处理" |
| 80 | 默认值使用硬编码中文 | medium | "用 /model doctor 查看详情，或调整本仓库 .linghun/settings.json。" |
| 80 | 默认值使用硬编码中文 | medium | "用 /model doctor 查看详情，或调整本仓库 .linghun/settings.json。" |
| 83 | 默认值使用硬编码中文 | medium | ",     index: (status: string) => `索引：${status}`,     background: (count: number... |
| 83 | 默认值使用硬编码中文 | medium | ",     index: (status: string) => `索引：${status}`,     background: (count: number... |
| 88 | 默认值使用硬编码中文 | medium | "没有可见输出。" |
| 88 | 默认值使用硬编码中文 | medium | "没有可见输出。" |
| 89 | 默认值使用硬编码中文 | medium | "按 Ctrl+O 查看完整运行时输出（或 /details）。" |
| 89 | 默认值使用硬编码中文 | medium | "按 Ctrl+O 查看完整运行时输出（或 /details）。" |
| 90 | 默认值使用硬编码中文 | medium | "Ctrl+O 查看完整内容" |
| 90 | 默认值使用硬编码中文 | medium | "Ctrl+O 查看完整内容" |
| 92 | 默认值使用硬编码中文 | medium | "Ctrl+O 查看完整错误" |
| 92 | 默认值使用硬编码中文 | medium | "Ctrl+O 查看完整错误" |
| 93 | 默认值使用硬编码中文 | medium | "请求失败，可重试或用 /model doctor 排查。" |
| 93 | 默认值使用硬编码中文 | medium | "请求失败，可重试或用 /model doctor 排查。" |
| 94 | 默认值使用硬编码中文 | medium | ",     denied: (tool: string) => `已拒绝 ${tool}，工具未执行。`,     cancelled: (tool: str... |
| 94 | 默认值使用硬编码中文 | medium | ",     denied: (tool: string) => `已拒绝 ${tool}，工具未执行。`,     cancelled: (tool: str... |
| 181 | 默认值使用硬编码中文 | medium | "; panelId: string; actionCursor: number };   /**    * D13E-P3 cleanup #5 — 当前 e... |
| 181 | 默认值使用硬编码中文 | medium | "; panelId: string; actionCursor: number };   /**    * D13E-P3 cleanup #5 — 当前 e... |
| 183 | 默认值使用硬编码中文 | medium | "）。    * view-model 只负责把它格式化成 " |
| 183 | 默认值使用硬编码中文 | medium | "）。    * view-model 只负责把它格式化成 " |
| 184 | 默认值使用硬编码中文 | medium | " 后挂到    * taskFooter.reasoning。view-model 不解析 provider 路由，由 runInkShell /    * ... |
| 184 | 默认值使用硬编码中文 | medium | " 后挂到    * taskFooter.reasoning。view-model 不解析 provider 路由，由 runInkShell /    * ... |
| 187 | 默认值使用硬编码中文 | medium | " 这种假信号）。    */   reasoningLevel?: string;   /** 是否真的发送给 provider；false 时不在 foot... |
| 187 | 默认值使用硬编码中文 | medium | " 这种假信号）。    */   reasoningLevel?: string;   /** 是否真的发送给 provider；false 时不在 foot... |
| 223 | 默认值使用硬编码中文 | medium | ");    // D.13Q-UX Real Smoke Fix v2 — A. submitted=true 且 options.activity 缺省时，... |
| 223 | 默认值使用硬编码中文 | medium | ");    // D.13Q-UX Real Smoke Fix v2 — A. submitted=true 且 options.activity 缺省时，... |
| 228 | 默认值使用硬编码中文 | medium | "反馈，看上去像消息被吞）。   // 真实 activity（mapRequestActivityToView）会覆盖此 fallback。   const ... |
| 228 | 默认值使用硬编码中文 | medium | "反馈，看上去像消息被吞）。   // 真实 activity（mapRequestActivityToView）会覆盖此 fallback。   const ... |
| 248 | 默认值使用硬编码中文 | medium | " && !setupActiveFlow ? text.setupHint : undefined;    // blocks 只保留 project-rou... |
| 248 | 默认值使用硬编码中文 | medium | " && !setupActiveFlow ? text.setupHint : undefined;    // blocks 只保留 project-rou... |
| 265 | 默认值使用硬编码中文 | medium | " && !setupActiveFlow && backgroundSummaryInput.length > 0       ? mapBackground... |
| 265 | 默认值使用硬编码中文 | medium | " && !setupActiveFlow && backgroundSummaryInput.length > 0       ? mapBackground... |
| 277 | 默认值使用硬编码中文 | medium | "限制，     //     超过 cap 的 ephemeral 从最早的起依次丢弃；     //   - keep:true 与 fail/blocke... |
| 277 | 默认值使用硬编码中文 | medium | "限制，     //     超过 cap 的 ephemeral 从最早的起依次丢弃；     //   - keep:true 与 fail/blocke... |
| 281 | 默认值使用硬编码中文 | medium | " + keep:true）在收到首个     // delta 之前 fullText 为空。这种空 streaming 占位不应当作可见输出：等待态由   ... |
| 281 | 默认值使用硬编码中文 | medium | " + keep:true）在收到首个     // delta 之前 fullText 为空。这种空 streaming 占位不应当作可见输出：等待态由   ... |
| 319 | 默认值使用硬编码中文 | medium | ",       title: denialText,       summary: denialText,     });   }    // Phase 7... |
| 319 | 默认值使用硬编码中文 | medium | ",       title: denialText,       summary: denialText,     });   }    // Phase 7... |
| 371 | 默认值使用硬编码中文 | medium | "，避免兜底 deepseek-chat   // 流到主屏。   const cyclePermHint = language === " |
| 371 | 默认值使用硬编码中文 | medium | "，避免兜底 deepseek-chat   // 流到主屏。   const cyclePermHint = language === " |
| 375 | 默认值使用硬编码中文 | medium | "       ? undefined       : {           ...buildFooterView({             languag... |
| 375 | 默认值使用硬编码中文 | medium | "       ? undefined       : {           ...buildFooterView({             languag... |
| 402 | 默认值使用硬编码中文 | medium | "       ? undefined       : buildTaskSuggestions({           language,          ... |
| 402 | 默认值使用硬编码中文 | medium | "       ? undefined       : buildTaskSuggestions({           language,          ... |
| 505 | 默认值使用硬编码中文 | medium | "正在处理上一条，按 Ctrl+C 可中断，稍后再发。" |
| 505 | 默认值使用硬编码中文 | medium | "正在处理上一条，按 Ctrl+C 可中断，稍后再发。" |
| 535 | 默认值使用硬编码中文 | medium | "]> }     ).sessionsPanelState,     notifications: (() => {       const ctxNotif... |
| 535 | 默认值使用硬编码中文 | medium | "]> }     ).sessionsPanelState,     notifications: (() => {       const ctxNotif... |
| 547 | 默认值使用硬编码中文 | medium | ") return true;         return n.createdAt + n.timeoutMs > now;       });       ... |
| 547 | 默认值使用硬编码中文 | medium | ") return true;         return n.createdAt + n.timeoutMs > now;       });       ... |
| 605 | 默认值使用硬编码中文 | medium | "}`.trim();   if (/^(?:Read\(\|读取摘要\|Read summary)/iu.test(text)) return " |
| 605 | 默认值使用硬编码中文 | medium | "}`.trim();   if (/^(?:Read\(\|读取摘要\|Read summary)/iu.test(text)) return " |
| 606 | 默认值使用硬编码中文 | medium | ";   if (/^(?:Grep\(\|Glob\(\|搜索摘要\|文件搜索摘要\|Search summary\|File search summary)/iu.t... |
| 606 | 默认值使用硬编码中文 | medium | ";   if (/^(?:Grep\(\|Glob\(\|搜索摘要\|文件搜索摘要\|Search summary\|File search summary)/iu.t... |
| 608 | 默认值使用硬编码中文 | medium | ";   }   if (     /(?:已发现\s+\d+\s+个扩展工具\|扩展工具调用(?:完成\|失败)\|Found\s+\d+\s+extension ... |
| 608 | 默认值使用硬编码中文 | medium | ";   }   if (     /(?:已发现\s+\d+\s+个扩展工具\|扩展工具调用(?:完成\|失败)\|Found\s+\d+\s+extension ... |
| 615 | 默认值使用硬编码中文 | medium | ";   }   if (     /(?:已(?:启动\|停止\|检查\|更新)后台智能体\|智能体已完成\|background agent\|agent comple... |
| 615 | 默认值使用硬编码中文 | medium | ";   }   if (     /(?:已(?:启动\|停止\|检查\|更新)后台智能体\|智能体已完成\|background agent\|agent comple... |
| 622 | 默认值使用硬编码中文 | medium | ";   }   if (     /(?:工作流已完成\|已启动后台工作流\|工作流结果已记录\|Workflow completed\|Started a back... |
| 622 | 默认值使用硬编码中文 | medium | ";   }   if (     /(?:工作流已完成\|已启动后台工作流\|工作流结果已记录\|Workflow completed\|Started a back... |
| 629 | 默认值使用硬编码中文 | medium | ";   }   if (/(?:验证已结束\|Verification finished)/iu.test(text)) return " |
| 629 | 默认值使用硬编码中文 | medium | ";   }   if (/(?:验证已结束\|Verification finished)/iu.test(text)) return " |
| 697 | 默认值使用硬编码中文 | medium | "       ? [`${enLabels[kind]} ${count}`]       : [`${zhLabels[kind]} ${count} 项`... |
| 697 | 默认值使用硬编码中文 | medium | "       ? [`${enLabels[kind]} ${count}`]       : [`${zhLabels[kind]} ${count} 项`... |
| 702 | 默认值使用硬编码中文 | medium | ") \|\| `${fallbackCount} item(s)`}.`;   }   return `工具活动已分组：${parts.join(" |
| 702 | 默认值使用硬编码中文 | medium | ") \|\| `${fallbackCount} item(s)`}.`;   }   return `工具活动已分组：${parts.join(" |
| 704 | 默认值使用硬编码中文 | medium | ") \|\| `${fallbackCount} 项`}。`; }  function estimateTranscriptTailHeight({   stre... |
| 704 | 默认值使用硬编码中文 | medium | ") \|\| `${fallbackCount} 项`}。`; }  function estimateTranscriptTailHeight({   stre... |
| 844 | 默认值使用硬编码中文 | medium | "}`;   if (text.length <= 160) return `${text.length}:${text}`;   return `${text... |
| 844 | 默认值使用硬编码中文 | medium | "}`;   if (text.length <= 160) return `${text.length}:${text}`;   return `${text... |
| 852 | 默认值使用硬编码中文 | medium | " }) 触发。  */ function mapConfigPanelState(   state:     \| { phase: " |
| 852 | 默认值使用硬编码中文 | medium | " }) 触发。  */ function mapConfigPanelState(   state:     \| { phase: " |
| 876 | 默认值使用硬编码中文 | medium | ",     panel: { id: panel.id, title: text.title, summary: text.summary },     ac... |
| 876 | 默认值使用硬编码中文 | medium | ",     panel: { id: panel.id, title: text.title, summary: text.summary },     ac... |
| 905 | 默认值使用硬编码中文 | medium | "   ) {     return true;   }   if (submitted) return true;   if (hasActiveAbort)... |
| 905 | 默认值使用硬编码中文 | medium | "   ) {     return true;   }   if (submitted) return true;   if (hasActiveAbort)... |
| 967 | 默认值使用硬编码中文 | medium | "允许以后这类 Bash 操作" |
| 967 | 默认值使用硬编码中文 | medium | "允许以后这类 Bash 操作" |
| 970 | 默认值使用硬编码中文 | medium | "允许以后这类文件修改" |
| 970 | 默认值使用硬编码中文 | medium | "允许以后这类文件修改" |
| 972 | 默认值使用硬编码中文 | medium | "允许以后这类操作" |
| 972 | 默认值使用硬编码中文 | medium | "允许以后这类操作" |
| 981 | 默认值使用硬编码中文 | medium | " 前缀。 const EMBEDDED_FOLD_HINTS = [   " |
| 981 | 默认值使用硬编码中文 | medium | " 前缀。 const EMBEDDED_FOLD_HINTS = [   " |
| 1007 | 默认值使用硬编码中文 | medium | ").trim());   // P1-1 — Ctrl+O hint 单一来源：tool-output-presenter 在正文里自带一行折叠   // 提... |
| 1007 | 默认值使用硬编码中文 | medium | ").trim());   // P1-1 — Ctrl+O hint 单一来源：tool-output-presenter 在正文里自带一行折叠   // 提... |
| 1010 | 默认值使用硬编码中文 | medium | "）。ink 主屏的 Ctrl+O 提示统一由 block.nextAction（detailsHint）   // 渲染，所以这里把正文内嵌的折叠提示行剥掉，... |
| 1010 | 默认值使用硬编码中文 | medium | "）。ink 主屏的 Ctrl+O 提示统一由 block.nextAction（detailsHint）   // 渲染，所以这里把正文内嵌的折叠提示行剥掉，... |
| 1012 | 默认值使用硬编码中文 | medium | "，强制挂 nextAction。   const foldHintStripped = stripEmbeddedFoldHint(rawNormalized... |
| 1012 | 默认值使用硬编码中文 | medium | "，强制挂 nextAction。   const foldHintStripped = stripEmbeddedFoldHint(rawNormalized... |
| 1021 | 默认值使用硬编码中文 | medium | "会被旧实现整块标红，造成用户以为 MCP 不可用。失败必须由结构化   // 来源（tool_result_error、command exit fail、明... |
| 1021 | 默认值使用硬编码中文 | medium | "会被旧实现整块标红，造成用户以为 MCP 不可用。失败必须由结构化   // 来源（tool_result_error、command exit fail、明... |
| 1032 | 默认值使用硬编码中文 | medium | "我能帮您做点什么？" |
| 1032 | 默认值使用硬编码中文 | medium | "我能帮您做点什么？" |
| 1048 | 默认值使用硬编码中文 | medium | ",     summary,     nextAction: hasMore ? copy.detailsHint : undefined,     // P... |
| 1048 | 默认值使用硬编码中文 | medium | ",     summary,     nextAction: hasMore ? copy.detailsHint : undefined,     // P... |
| 1060 | 默认值使用硬编码中文 | medium | ",   }; }  function isToolResultLike(text: string): boolean {   return /^(?:工具\s... |
| 1060 | 默认值使用硬编码中文 | medium | ",   }; }  function isToolResultLike(text: string): boolean {   return /^(?:工具\s... |
| 1081 | 默认值使用硬编码中文 | medium | " 类型短行 /  * " |
| 1081 | 默认值使用硬编码中文 | medium | " 类型短行 /  * " |
| 1082 | 默认值使用硬编码中文 | medium | " 回声不再带 Ctrl+O 行。  */ function addDetailsHint(block: ProductBlockViewModel, lang... |
| 1082 | 默认值使用硬编码中文 | medium | " 回声不再带 Ctrl+O 行。  */ function addDetailsHint(block: ProductBlockViewModel, lang... |
| 1087 | 默认值使用硬编码中文 | medium | "；   //   - 普通块 / 错误块共用同一判定，避免短错误（" |
| 1087 | 默认值使用硬编码中文 | medium | "；   //   - 普通块 / 错误块共用同一判定，避免短错误（" |
| 1088 | 默认值使用硬编码中文 | medium | "）也挂 Ctrl+O。   // 区别仅在文案：fail/blocked 用 errorDetailsHint（" |
| 1088 | 默认值使用硬编码中文 | medium | "）也挂 Ctrl+O。   // 区别仅在文案：fail/blocked 用 errorDetailsHint（" |
| 1089 | 默认值使用硬编码中文 | medium | "），   // 其余用 detailsHint（" |
| 1089 | 默认值使用硬编码中文 | medium | "），   // 其余用 detailsHint（" |
| 1163 | 默认值使用硬编码中文 | medium | ",       tool_running: toolName ? `正在运行 ${toolName}…` : " |
| 1163 | 默认值使用硬编码中文 | medium | ",       tool_running: toolName ? `正在运行 ${toolName}…` : " |
| 1165 | 默认值使用硬编码中文 | medium | "工具完成，继续处理…" |
| 1165 | 默认值使用硬编码中文 | medium | "工具完成，继续处理…" |
| 1166 | 默认值使用硬编码中文 | medium | "等待权限确认…" |
| 1166 | 默认值使用硬编码中文 | medium | "等待权限确认…" |
| 1208 | 默认值使用硬编码中文 | medium | ";         mutation?: { action?: string };         action?: string;         asse... |
| 1208 | 默认值使用硬编码中文 | medium | ";         mutation?: { action?: string };         action?: string;         asse... |
| 1234 | 默认值使用硬编码中文 | medium | ",       actionSummary: isEn ? `Edit file: ${path}` : `修改文件：${path}`,       acti... |
| 1234 | 默认值使用硬编码中文 | medium | ",       actionSummary: isEn ? `Edit file: ${path}` : `修改文件：${path}`,       acti... |
| 1237 | 默认值使用硬编码中文 | medium | ", context.language),     };   }    // D.14D-R P0-2 — 结构化索引工具（IndexRefresh / Ind... |
| 1237 | 默认值使用硬编码中文 | medium | ", context.language),     };   }    // D.14D-R P0-2 — 结构化索引工具（IndexRefresh / Ind... |
| 1258 | 默认值使用硬编码中文 | medium | "修复并刷新代码索引" |
| 1258 | 默认值使用硬编码中文 | medium | "修复并刷新代码索引" |
| 1260 | 默认值使用硬编码中文 | medium | "快速初始化代码索引" |
| 1260 | 默认值使用硬编码中文 | medium | "快速初始化代码索引" |
| 1261 | 默认值使用硬编码中文 | medium | "刷新（重建）代码索引" |
| 1261 | 默认值使用硬编码中文 | medium | "刷新（重建）代码索引" |
| 1265 | 默认值使用硬编码中文 | medium | "修复代码索引" |
| 1265 | 默认值使用硬编码中文 | medium | "修复代码索引" |
| 1267 | 默认值使用硬编码中文 | medium | "初始化代码索引" |
| 1267 | 默认值使用硬编码中文 | medium | "初始化代码索引" |
| 1268 | 默认值使用硬编码中文 | medium | "刷新代码索引" |
| 1268 | 默认值使用硬编码中文 | medium | "刷新代码索引" |
| 1287 | 默认值使用硬编码中文 | medium | ",       actionSummary: isEn ? `Update controlled memory: ${action}` : `更新受控记忆：$... |
| 1287 | 默认值使用硬编码中文 | medium | ",       actionSummary: isEn ? `Update controlled memory: ${action}` : `更新受控记忆：$... |
| 1302 | 默认值使用硬编码中文 | medium | ",       actionSummary: isEn         ? `Update break-cache marker: ${action}`   ... |
| 1302 | 默认值使用硬编码中文 | medium | ",       actionSummary: isEn         ? `Update break-cache marker: ${action}`   ... |
| 1319 | 默认值使用硬编码中文 | medium | "写入 image metadata" |
| 1319 | 默认值使用硬编码中文 | medium | "写入 image metadata" |
| 1321 | 默认值使用硬编码中文 | medium | ", context.language),     };   }    // D.14D-R2 P1-1 — 模型工具 GitStablePointCreate... |
| 1321 | 默认值使用硬编码中文 | medium | ", context.language),     };   }    // D.14D-R2 P1-1 — 模型工具 GitStablePointCreate... |
| 1336 | 默认值使用硬编码中文 | medium | "为工作区创建稳定点（git commit / snapshot）" |
| 1336 | 默认值使用硬编码中文 | medium | "为工作区创建稳定点（git commit / snapshot）" |
| 1347 | 默认值使用硬编码中文 | medium | ";     // D.13Q-UX Closure: 优先用 engine 真实 verdict（semantic / pathSafety /     //... |
| 1347 | 默认值使用硬编码中文 | medium | ";     // D.13Q-UX Closure: 优先用 engine 真实 verdict（semantic / pathSafety /     //... |
| 1385 | 默认值使用硬编码中文 | medium | "} requested this tool.`                 : `子 agent ${approval.agentId ?? " |
| 1385 | 默认值使用硬编码中文 | medium | "} requested this tool.`                 : `子 agent ${approval.agentId ?? " |
| 1386 | 默认值使用硬编码中文 | medium | "} 请求该工具。`,               ...explanationLines,             ]           : explana... |
| 1386 | 默认值使用硬编码中文 | medium | "} 请求该工具。`,               ...explanationLines,             ]           : explana... |
| 1410 | 默认值使用硬编码中文 | medium | ";   const lines: string[] = [];   // 1) verdict 多行解释（semantic + pathSafety + re... |
| 1410 | 默认值使用硬编码中文 | medium | ";   const lines: string[] = [];   // 1) verdict 多行解释（semantic + pathSafety + re... |
| 1416 | 默认值使用硬编码中文 | medium | "风险：高 — 请仔细确认。" |
| 1416 | 默认值使用硬编码中文 | medium | "风险：高 — 请仔细确认。" |
| 1420 | 默认值使用硬编码中文 | medium | ");   }   // 去重（explainPolicyVerdict 末尾就有 /permissions 指引，这里 risk 之后不要再追加）   ret... |
| 1420 | 默认值使用硬编码中文 | medium | ");   }   // 去重（explainPolicyVerdict 末尾就有 /permissions 指引，这里 risk 之后不要再追加）   ret... |
| 1448 | 默认值使用硬编码中文 | medium | "风险：高 — 请仔细确认。" |
| 1448 | 默认值使用硬编码中文 | medium | "风险：高 — 请仔细确认。" |
| 1452 | 默认值使用硬编码中文 | medium | ");   }   lines.push(explainHowToUpdate(language));   return lines; }  /**  * D.... |
| 1452 | 默认值使用硬编码中文 | medium | ");   }   lines.push(explainHowToUpdate(language));   return lines; }  /**  * D.... |
| 1459 | 默认值使用硬编码中文 | medium | "摘要行。  *  *   Bash               → " |
| 1459 | 默认值使用硬编码中文 | medium | "摘要行。  *  *   Bash               → " |
| 1462 | 默认值使用硬编码中文 | medium | "修改文件：<file_path>" |
| 1462 | 默认值使用硬编码中文 | medium | "修改文件：<file_path>" |
| 1463 | 默认值使用硬编码中文 | medium | "读取文件：<file_path>" |
| 1463 | 默认值使用硬编码中文 | medium | "读取文件：<file_path>" |
| 1464 | 默认值使用硬编码中文 | medium | "搜索：<pattern 或 path>" |
| 1464 | 默认值使用硬编码中文 | medium | "Search: <pattern 或 path>" |
| 1464 | 默认值使用硬编码中文 | medium | "搜索：<pattern 或 path>" |
| 1464 | 默认值使用硬编码中文 | medium | "Search: <pattern 或 path>" |
| 1465 | 默认值使用硬编码中文 | medium | "使用工具：<toolName>" |
| 1465 | 默认值使用硬编码中文 | medium | "  *  * D.13L Section 3 — Write 不再单独显示" |
| 1465 | 默认值使用硬编码中文 | medium | "使用工具：<toolName>" |
| 1465 | 默认值使用硬编码中文 | medium | "  *  * D.13L Section 3 — Write 不再单独显示" |
| 1467 | 默认值使用硬编码中文 | medium | "，与 Edit/MultiEdit 统一为  * " |
| 1467 | 默认值使用硬编码中文 | medium | "，与 Edit/MultiEdit 统一为  * " |
| 1468 | 默认值使用硬编码中文 | medium | "，避免主屏出现两套近义词；底层 Write 工具行为不变。  *  * 取值不解析、不预览内容；只读 input 上已经有的字符串字段。任何取不到字段  * ... |
| 1468 | 默认值使用硬编码中文 | medium | "，避免主屏出现两套近义词；底层 Write 工具行为不变。  *  * 取值不解析、不预览内容；只读 input 上已经有的字符串字段。任何取不到字段  * ... |
| 1485 | 默认值使用硬编码中文 | medium | ");     if (command) return zh ? `运行终端命令：${command}` : `Run terminal command: ${... |
| 1485 | 默认值使用硬编码中文 | medium | ");     if (command) return zh ? `运行终端命令：${command}` : `Run terminal command: ${... |
| 1489 | 默认值使用硬编码中文 | medium | ");     if (path) return zh ? `修改文件：${path}` : `Edit file: ${path}`;   }   if (t... |
| 1489 | 默认值使用硬编码中文 | medium | ");     if (path) return zh ? `修改文件：${path}` : `Edit file: ${path}`;   }   if (t... |
| 1493 | 默认值使用硬编码中文 | medium | ");     if (path) return zh ? `读取文件：${path}` : `Read file: ${path}`;   }   if (t... |
| 1493 | 默认值使用硬编码中文 | medium | ");     if (path) return zh ? `读取文件：${path}` : `Read file: ${path}`;   }   if (t... |
| 1497 | 默认值使用硬编码中文 | medium | ");     if (target) return zh ? `搜索：${target}` : `Search: ${target}`;   }   retu... |
| 1497 | 默认值使用硬编码中文 | medium | ");     if (target) return zh ? `搜索：${target}` : `Search: ${target}`;   }   retu... |
| 1570 | 默认值使用硬编码中文 | medium | "这是后台任务状态；用 /background 查看任务面板。" |
| 1570 | 默认值使用硬编码中文 | medium | "这是后台任务状态；用 /background 查看任务面板。" |
| 1603 | 默认值使用硬编码中文 | medium | "后台任务摘要已折叠。" |
| 1603 | 默认值使用硬编码中文 | medium | "后台任务摘要已折叠。" |
| 1617 | 默认值使用硬编码中文 | medium | "查看 /background；完整排查入口在 /details、/job report 或日志。" |
| 1617 | 默认值使用硬编码中文 | medium | "查看 /background；完整排查入口在 /details、/job report 或日志。" |
| 1634 | 默认值使用硬编码中文 | medium | ").length;   const pieces = [zh ? `后台 ${total}` : `background ${total}`];   if (... |
| 1634 | 默认值使用硬编码中文 | medium | ").length;   const pieces = [zh ? `后台 ${total}` : `background ${total}`];   if (... |
| 1661 | 默认值使用硬编码中文 | medium | "后台任务正在运行；详情、日志和报告请到展开入口查看。" |
| 1661 | 默认值使用硬编码中文 | medium | "后台任务正在运行；详情、日志和报告请到展开入口查看。" |
| 1666 | 默认值使用硬编码中文 | medium | "后台任务需要处理；主屏只显示摘要。" |
| 1666 | 默认值使用硬编码中文 | medium | "后台任务需要处理；主屏只显示摘要。" |
| 1670 | 默认值使用硬编码中文 | medium | "后台任务可能卡住或长时间无输出；请查看详情或日志。" |
| 1670 | 默认值使用硬编码中文 | medium | "后台任务可能卡住或长时间无输出；请查看详情或日志。" |
| 1674 | 默认值使用硬编码中文 | medium | "后台任务已超时；不要把它当作通过。" |
| 1674 | 默认值使用硬编码中文 | medium | "后台任务已超时；不要把它当作通过。" |
| 1678 | 默认值使用硬编码中文 | medium | "后台任务已取消；需要时从详情或日志继续排查。" |
| 1678 | 默认值使用硬编码中文 | medium | "后台任务已取消；需要时从详情或日志继续排查。" |
| 1682 | 默认值使用硬编码中文 | medium | "后台任务已结束；结果以详情、日志或报告为准。" |
| 1682 | 默认值使用硬编码中文 | medium | "后台任务已结束；结果以详情、日志或报告为准。" |
| 1686 | 默认值使用硬编码中文 | medium | "后台任务异常结束；请查看详情、日志或报告。" |
| 1686 | 默认值使用硬编码中文 | medium | "后台任务异常结束；请查看详情、日志或报告。" |
| 1690 | 默认值使用硬编码中文 | medium | "后台任务摘要已折叠；完整内容在详情、日志或报告。" |
| 1690 | 默认值使用硬编码中文 | medium | "后台任务摘要已折叠；完整内容在详情、日志或报告。" |
| 1739 | 默认值使用硬编码中文 | medium | ";   const pieces = [zh ? `后台 ${counts.total}` : `Background ${counts.total}`]; ... |
| 1739 | 默认值使用硬编码中文 | medium | ";   const pieces = [zh ? `后台 ${counts.total}` : `Background ${counts.total}`]; ... |
| 1762 | 默认值使用硬编码中文 | medium | "     ? text.trustTrusted     : text.trustRestricted; }  function formatIndex(st... |
| 1762 | 默认值使用硬编码中文 | medium | "     ? text.trustTrusted     : text.trustRestricted; }  function formatIndex(st... |
| 1768 | 默认值使用硬编码中文 | medium | " 时不显示噪音文案，   // 用 " |
| 1768 | 默认值使用硬编码中文 | medium | " 时不显示噪音文案，   // 用 " |
| 1769 | 默认值使用硬编码中文 | medium | "索引：unknown" |
| 1769 | 默认值使用硬编码中文 | medium | "索引：unknown" |
| 1778 | 默认值使用硬编码中文 | medium | ";   if (width < 60) {     return shellText[language].backgroundShort(count);   ... |
| 1778 | 默认值使用硬编码中文 | medium | ";   if (width < 60) {     return shellText[language].backgroundShort(count);   ... |

### packages/tui/src/slash-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 1045 | 默认值使用硬编码中文 | medium | "), };  export const gitSlashDeps: GitSlashDeps = {   dispatch: gitToolDispatchD... |
| 1119 | 默认值使用硬编码中文 | medium | "用法：/doctor [readiness\|status\|checklist\|project\|report\|hooks\|runner]" |
| 1130 | 默认值使用硬编码中文 | medium | "工作区信任尚未记录。非交互输入不会弹出 trust 确认；请用交互式启动确认此工作区。Start Gate、Plan approval 和权限管道仍会生效。" |
| 1140 | 默认值使用硬编码中文 | medium | "       ? `Workspace trust: ${level}. Read-only status and safe diagnostics are ... |
| 1169 | 默认值使用硬编码中文 | medium | "┌─ 选择输出语言 / Choose output language ─────────────────────" |
| 1171 | 默认值使用硬编码中文 | medium | "│  ↑/↓ 或 j/k 切换 · Enter 确认 · Esc 默认中文" |
| 1172 | 默认值使用硬编码中文 | medium | "│  Type 1/2/zh/en/中文/English to choose by keyboard." |
| 1198 | 默认值使用硬编码中文 | medium | "}] 中文 (zh-CN)`,       `  ${cursor(selectedIndex === 1)} [${selectedIndex === 1 ... |
| 1235 | 默认值使用硬编码中文 | medium | ") {         if (selectedIndex !== 1) {           selectedIndex = 1;           r... |
| 1256 | 默认值使用硬编码中文 | medium | ");         return;       }       if (/^(1\|zh\|zh-cn\|中文\|chinese\|cn)$/iu.test(norm... |
| 1260 | 默认值使用硬编码中文 | medium | ");         return;       }       if (/^(2\|en\|en-us\|english\|英文)$/iu.test(normali... |
| 1267 | 默认值使用硬编码中文 | medium | "请输入 1/中文 或 2/English。Type 1/中文 or 2/English." |
| 1334 | 默认值使用硬编码中文 | medium | "┌─ 工作区信任 ────────────────────────────────────────────────" |
| 1337 | 默认值使用硬编码中文 | medium | "│  是否信任这个项目？" |
| 1338 | 默认值使用硬编码中文 | medium | "│  信任后可读写和运行命令；安全审批仍生效。" |
| 1340 | 默认值使用硬编码中文 | medium | "│  ↑/↓ 或 j/k 切换 · Enter 确认 · Esc 保持受限" |
| 1369 | 默认值使用硬编码中文 | medium | "信任此项目 (yes)" |
| 1370 | 默认值使用硬编码中文 | medium | "保持 restricted (no)" |
| 1421 | 默认值使用硬编码中文 | medium | ") {         finish(false);         return;       }       if (/^(y\|是\|信)$/iu.test... |
| 1433 | 默认值使用硬编码中文 | medium | ' 事件处理；此处忽略其他原始输入。       void str;     };     const onLine = (line: string) => {... |
| 1438 | 默认值使用硬编码中文 | medium | ") {         finish(selectedIndex === 0);         return;       }       if (/^(y... |
| 1456 | 默认值使用硬编码中文 | medium | "请用 ↑/↓ 切换，Enter 确认；或输入 yes/no。" |
| 1482 | 默认值使用硬编码中文 | medium | "     ? `Workspace is ${level}. I did not run ${command}. Read-only status is st... |
| 1515 | 默认值使用硬编码中文 | medium | "用法：/trust status \| /trust trust \| /trust restricted \| /trust untrust" |
| 1559 | 默认值使用硬编码中文 | medium | "用法：/autopilot <目标> [--steps N] [--tokens N] [--timeout MS] [--allow-edit] [--al... |
| 1584 | 默认值使用硬编码中文 | medium | "当前没有待确认的持续推进。用法：/autopilot <目标> [--steps N] [--tokens N] [--timeout MS]。" |
| 1587 | 默认值使用硬编码中文 | medium | "持续推进待确认" |
| 1589 | 默认值使用硬编码中文 | medium | "}`,     `- 预算：steps<=${pending.maxSteps}；tokens<=${pending.maxTokens}；timeoutMs... |
| 1592 | 默认值使用硬编码中文 | medium | "- 控制入口：/autopilot confirm 启动；/esc 或 /autopilot cancel 取消；启动后用 /job pause\|resume... |
| 1593 | 默认值使用硬编码中文 | medium | "- 报告入口：启动后查看 /job report <id>、/job logs <id>、/background。" |
| 1600 | 默认值使用硬编码中文 | medium | "当前没有待确认的持续推进。先运行 /autopilot <目标>。 " |
| 1607 | 默认值使用硬编码中文 | medium | "当前工作区未信任，未启动持续推进。" |
| 1660 | 默认值使用硬编码中文 | medium | "项目级语言覆盖需要已信任工作区；已改为保存用户级语言偏好。" |
| 1667 | 默认值使用硬编码中文 | medium | "));   writeStatus(output, context); }  // Module 4 — isAgentType / getAgentRole... |
| 1691 | 默认值使用硬编码中文 | medium | "));       return;     }     // D.13R: 明确这些是 Linghun snapshot checkpoint，不是 git ... |
| 1699 | 默认值使用硬编码中文 | medium | "Linghun snapshot checkpoint（内存文件快照，不是 git reset）：" |
| 1713 | 默认值使用硬编码中文 | medium | "用法：/rewind \| /rewind restore <checkpointId>" |
| 1787 | 默认值使用硬编码中文 | medium | "       ? `Linghun snapshot checkpoint restored (not a git operation): ${checkpo... |
| 1803 | 默认值使用硬编码中文 | medium | "用法：/btw <临时小问题>" |
| 1811 | 默认值使用硬编码中文 | medium | ", answer: statusAnswer };     } else {       writeLine(output, statusAnswer);  ... |
| 1824 | 默认值使用硬编码中文 | medium | "；plain 路径无面板。   if (context.isInkSession) {     context.btwPanelState = { quest... |
| 1826 | 默认值使用硬编码中文 | medium | " };     // 在 await 模型前主动刷一帧 loading，否则单次 handler 内的 loading 态不可见。     context.s... |
| 1835 | 默认值使用硬编码中文 | medium | "临时插问不可用：模型网关尚未就绪。" |
| 1837 | 默认值使用硬编码中文 | medium | ", error: msg };     } else {       writeLine(output, msg);     }     return;   ... |
| 1880 | 默认值使用硬编码中文 | medium | " ? result.answer : result.error);   } }  function formatBtwStatusAnswer(context... |
| 1932 | 默认值使用硬编码中文 | medium | "还没有可恢复会话。下一步：先正常对话，或用 /sessions 查看历史。" |
| 1943 | 默认值使用硬编码中文 | medium | "试验分支会话" |
| 1977 | 默认值使用硬编码中文 | medium | ",     packet: branchPacket,     createdAt: new Date().toISOString(),   });   wr... |
| 1986 | 默认值使用硬编码中文 | medium | ")}`,   );   if (missing.length > 0) {     writeLine(output, `handoff 缺少关键字段，分支按... |
| 2090 | 默认值使用硬编码中文 | medium | "           ? `Agent ${agent.id} requested ${toolName}, but another local approv... |
| 2159 | 默认值使用硬编码中文 | medium | "用法：/verify \| /verify plan \| /verify last \| /verify smoke \| /verify typecheck" |
| 2203 | 默认值使用硬编码中文 | medium | ");   writeLine(output, report);   writeLine(     output,     `Role handoff: ${h... |
| 2220 | 默认值使用硬编码中文 | medium | "用法：/vision <image-or-screenshot-path>。vision role 不执行 Bash、不改代码，只记录 VisionObser... |
| 2225 | 默认值使用硬编码中文 | medium | ");   await appendRouteDecisionEvent(context, sessionId, resolved.decision);   i... |
| 2267 | 默认值使用硬编码中文 | medium | "- boundary: vision role 只写入 evidence，不执行 Bash、不改代码。" |
| 2279 | 默认值使用硬编码中文 | medium | "用法：/image generate <prompt>。image role 不执行 Bash、不改代码、不覆盖原图。" |
| 2285 | 默认值使用硬编码中文 | medium | "用法：/image generate <prompt>" |
| 2289 | 默认值使用硬编码中文 | medium | ");   await appendRouteDecisionEvent(context, sessionId, resolved.decision);   i... |
| 2445 | 默认值使用硬编码中文 | medium | ",     userVisibleSummary: `image 结果已落盘：${approval.assetPath}`,     nextAction: ... |
| 2559 | 默认值使用硬编码中文 | medium | "当前没有可持久化的索引跳过建议。先运行索引刷新；如刷新时自动跳过了大文件/生成物，可再运行索引修复把规则写入 ignore。" |
| 2576 | 默认值使用硬编码中文 | medium | "索引安全修复续跑" |
| 2577 | 默认值使用硬编码中文 | medium | "- 动作：追加缺失 ignore 条目，然后刷新项目索引" |
| 2594 | 默认值使用硬编码中文 | medium | "ignore 写入跳过：风险文件已被 ignore 文件覆盖。" |
| 2909 | 默认值使用硬编码中文 | medium | ", plan };     // P0-1 — ink 主屏走 PermissionPanel（index_ignore_write 已被     // ma... |
| 2939 | 默认值使用硬编码中文 | medium | "         ? `Permission blocked ignore write: ${permission.reason}\nNext: review... |
| 2982 | 默认值使用硬编码中文 | medium | "         ? `Ignore write completed: ${plan.path}; entries=${plan.missingEntries... |
| 2993 | 默认值使用硬编码中文 | medium | "         ? `${text}\nNext: fix the ignore file path or permissions, then retry ... |
| 3015 | 默认值使用硬编码中文 | medium | "本阶段只传 diff 摘要和文件列表，不传完整 patch。" |

### packages/tui/src/slash-dispatch.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 131 | 默认值使用硬编码中文 | medium | "帮助：优先直接描述你的目标。" |
| 134 | 默认值使用硬编码中文 | medium | "（未显示不等于不能用，/help all 查看完整命令表）" |
| 140 | 默认值使用硬编码中文 | medium | "完整命令表：/help all、/help advanced 或 /help details。" |
| 145 | 默认值使用硬编码中文 | medium | "提示：输入 / 或 /? 会显示同样的短候选。" |
| 155 | 默认值使用硬编码中文 | medium | " ? [`Slash candidates for ${trimmed}:`] : [`${trimmed} 的候选命令：`];     lines.push... |
| 157 | 默认值使用硬编码中文 | medium | "完整命令表：/help all。" |
| 163 | 默认值使用硬编码中文 | medium | "优先直接描述你的目标。" |
| 163 | 默认值使用硬编码中文 | medium | "核心 slash 入口：" |
| 168 | 默认值使用硬编码中文 | medium | "继续输入前缀（例如 /p、/ca）可筛选；/help all 查看完整命令表。" |
| 170 | 默认值使用硬编码中文 | medium | "); }  // D.13P Slash discovery polish: // - 前缀候选必须命中完整 user-visible registry（/s... |
| 180 | 默认值使用硬编码中文 | medium | ") \|\| prefix.length <= 1) return [];   const normalized = prefix.toLowerCase(); ... |
| 200 | 默认值使用硬编码中文 | medium | "       ? `Unknown command: ${command}. Type /help to see available commands.`  ... |
| 205 | 默认值使用硬编码中文 | medium | "     ? `Unknown command: ${command}. Did you mean ${joined}? Type /help for gro... |
| 276 | 默认值使用硬编码中文 | medium | "风险动作会先确认。" |
| 277 | 默认值使用硬编码中文 | medium | "低风险编辑更顺滑，高风险仍确认。" |
| 278 | 默认值使用硬编码中文 | medium | "只规划，不直接改。" |
| 279 | 默认值使用硬编码中文 | medium | "本地开启后减少确认，安全边界仍生效。" |
| 306 | 默认值使用硬编码中文 | medium | "，长度参差且 emdash 在窄终端不齐； // 改成 " |
| 307 | 默认值使用硬编码中文 | medium | " 两列对齐，左列固定宽度（按最长 slash 取整 + 2 空格）， // 上限 8 条，左列 cap=14（覆盖现有最长命令 /claim-check / ... |
| 443 | 默认值使用硬编码中文 | medium | "  /model setup          配置 provider、key、模型与推理等级" |
| 444 | 默认值使用硬编码中文 | medium | "  /model route          查看角色模型路由" |
| 445 | 默认值使用硬编码中文 | medium | "  /model route doctor   诊断角色 provider/model/capability/budget" |
| 446 | 默认值使用硬编码中文 | medium | "  /model route set <role> <model>  设置单角色路由" |
| 447 | 默认值使用硬编码中文 | medium | "  /permissions          查看权限规则" |
| 448 | 默认值使用硬编码中文 | medium | "  /memory               查看记忆与 handoff 状态" |
| 449 | 默认值使用硬编码中文 | medium | "  /memory review        审查候选记忆" |
| 450 | 默认值使用硬编码中文 | medium | "  /memory learn [on\|off\|status]  开关自动学习" |
| 451 | 默认值使用硬编码中文 | medium | "  /mcp                  查看 MCP 状态" |
| 452 | 默认值使用硬编码中文 | medium | "  /mcp doctor           诊断 MCP server 可用性" |
| 453 | 默认值使用硬编码中文 | medium | "  /skills               列出本地 skill metadata" |
| 454 | 默认值使用硬编码中文 | medium | "  /plugins              列出本地 plugin manifest" |
| 455 | 默认值使用硬编码中文 | medium | "  /workflows            列出 workflow 模板" |
| 456 | 默认值使用硬编码中文 | medium | "  /index status         查看 fast 索引状态" |
| 457 | 默认值使用硬编码中文 | medium | "  /index doctor         诊断 bundled/managed 索引 runtime" |
| 458 | 默认值使用硬编码中文 | medium | "  /index check          显式运行 detect_changes" |
| 459 | 默认值使用硬编码中文 | medium | "  /background           查看后台任务摘要" |
| 460 | 默认值使用硬编码中文 | medium | "  /job                  管理本地 durable job" |
| 461 | 默认值使用硬编码中文 | medium | "  /agents               查看 agent 状态、transcript、usage" |
| 462 | 默认值使用硬编码中文 | medium | "  /agents show <id>     查看单个 agent 详情" |
| 463 | 默认值使用硬编码中文 | medium | "  /agents cancel <id>   中断单个 agent" |
| 464 | 默认值使用硬编码中文 | medium | "  /fork <类型> <任务>    派生 explorer/planner/verifier/worker" |
| 465 | 默认值使用硬编码中文 | medium | "  /rewind               列出 Linghun snapshot checkpoint（不是 git reset）" |
| 466 | 默认值使用硬编码中文 | medium | "  /git [status\|stable\|worktree\|doctor]  Git 状态 / 稳定点建议 / worktree（只读）" |
| 467 | 默认值使用硬编码中文 | medium | "  /worktree             查看 git worktree 列表（只读）" |
| 468 | 默认值使用硬编码中文 | medium | "  /checkpoint [list\|stable]   查看 Linghun snapshot checkpoint 与稳定点建议" |
| 469 | 默认值使用硬编码中文 | medium | "  /verify [plan\|last\|smoke]  生成或运行验证" |
| 470 | 默认值使用硬编码中文 | medium | "  /compact              压缩长对话上下文" |
| 471 | 默认值使用硬编码中文 | medium | "  /trust                查看或更改工作区信任" |
| 472 | 默认值使用硬编码中文 | medium | "  /remote               管理远程会话" |
| 473 | 默认值使用硬编码中文 | medium | "  /config               统一配置面板" |
| 474 | 默认值使用硬编码中文 | medium | "使用 /help all 查看完整命令表；/help details 查看调试入口。" |
| 517 | 默认值使用硬编码中文 | medium | "详情与调试命令：" |
| 518 | 默认值使用硬编码中文 | medium | "  /details              打开 evidence/background/details 详情面板" |
| 519 | 默认值使用硬编码中文 | medium | "  /diff                 查看本轮工具改动摘要" |
| 522 | 默认值使用硬编码中文 | medium | "  /todo start\|done\|block <id>  更新任务状态" |
| 523 | 默认值使用硬编码中文 | medium | "  /usage                查看 token/cache usage 汇总" |
| 524 | 默认值使用硬编码中文 | medium | "  /stats                查看本地 cache/cost 统计" |
| 525 | 默认值使用硬编码中文 | medium | "  /stats endpoints      按 endpoint 聚合 usage" |
| 526 | 默认值使用硬编码中文 | medium | "  /cache status         查看 cache 状态与 freshness" |
| 527 | 默认值使用硬编码中文 | medium | "  /cache-log            查看最近 cache usage 记录" |
| 528 | 默认值使用硬编码中文 | medium | "  /break-cache status   查看 cache freshness 变化" |
| 530 | 默认值使用硬编码中文 | medium | "  /sessions resume <id> 基于结构化 handoff 恢复会话" |
| 531 | 默认值使用硬编码中文 | medium | "  /resume [id]          恢复最近会话，不注入完整历史" |
| 532 | 默认值使用硬编码中文 | medium | "  /branch [目的]        基于 handoff 创建分支会话（会话分支，不是 git 分支）" |
| 533 | 默认值使用硬编码中文 | medium | "  /git [status\|stable\|worktree\|doctor]  Git 状态 / 稳定点建议 / worktree（只读）" |
| 534 | 默认值使用硬编码中文 | medium | "  /worktree             查看 git worktree 列表（只读）" |
| 535 | 默认值使用硬编码中文 | medium | "  /checkpoint [list\|stable]   查看 Linghun snapshot checkpoint / 稳定点建议" |
| 536 | 默认值使用硬编码中文 | medium | "  /problems             查看 Problems Lite 摘要" |
| 537 | 默认值使用硬编码中文 | medium | "  /doctor               查看就绪 checklist" |
| 539 | 默认值使用硬编码中文 | medium | "  /doctor hooks         诊断 hook 来源/事件/超时" |
| 540 | 默认值使用硬编码中文 | medium | "  /doctor runner        诊断 native runner 解析器" |
| 541 | 默认值使用硬编码中文 | medium | "  /interrupt            标记当前后台任务取消" |
| 542 | 默认值使用硬编码中文 | medium | "  /claim-check <claim>  降级缺少证据的结论" |
| 543 | 默认值使用硬编码中文 | medium | "  /btw <question>       插入临时问题" |
| 544 | 默认值使用硬编码中文 | medium | "  /review               审查 diff/风险/证据" |
| 545 | 默认值使用硬编码中文 | medium | "  /vision <path>        记录 VisionObservation evidence" |
| 546 | 默认值使用硬编码中文 | medium | "  /image generate <prompt>  生成图片资产 metadata" |
| 547 | 默认值使用硬编码中文 | medium | "使用 /help all 查看完整命令表；/help advanced 查看高级入口。" |

### packages/tui/src/startup-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 181 | 默认值使用硬编码中文 | medium | "如需完整 trace，请打开对应 details/debug 入口" |
| 192 | 默认值使用硬编码中文 | medium | ",     `- 发生了什么：${message}`,     " |
| 194 | 默认值使用硬编码中文 | medium | ",     `- 下一步：${suggestion}`,     " |
| 217 | 默认值使用硬编码中文 | medium | "     ? `provider.env could not be read: ${reason}. Fix it and restart Linghun, ... |
| 231 | 默认值使用硬编码中文 | medium | "项目模型路由需要处理。" |
| 233 | 默认值使用硬编码中文 | medium | "- 这是当前项目的 route/settings 问题，不是让你重复填写本机用户 API key。" |
| 234 | 默认值使用硬编码中文 | medium | "- 可用 /model doctor 检查，或调整本仓库 .linghun/settings.json 里的 route/model 配置。" |
| 248 | 默认值使用硬编码中文 | medium | "需要配置模型：这是本机一次配置，不是当前仓库配置。" |
| 249 | 默认值使用硬编码中文 | medium | "- 配置会保存到本机用户目录，不会写入这个仓库。" |
| 250 | 默认值使用硬编码中文 | medium | "- 配置一次后，之后进入其他仓库也会默认复用同一个用户 provider.env。" |
| 251 | 默认值使用硬编码中文 | medium | "- 可以直接说\u201c我要配置模型\u201d或按 Enter 开始；/model setup 保留为高级/恢复入口。" |
| 267 | 默认值使用硬编码中文 | medium | "provider.env 读取失败；可用 /model setup 或 /model doctor 处理。" |
| 272 | 默认值使用硬编码中文 | medium | "当前为无颜色模式。" |

### packages/tui/src/terminal-readiness-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 10 | 默认值使用硬编码中文 | medium | ";  export type TerminalReadinessItem = {   id: string;   label: string;   statu... |
| 26 | 默认值使用硬编码中文 | medium | "   // 不算 provider 可用，避免 readiness/status/doctor 误读为 pass。   providerLiveVerifie... |
| 142 | 默认值使用硬编码中文 | medium | "诊断详情（仅本地/静态轻量检查；不是真实 smoke）" |
| 144 | 默认值使用硬编码中文 | medium | "       ? `Summary: ${passCount}/${items.length} local checks are pass; ${blocke... |
| 150 | 默认值使用硬编码中文 | medium | "       ? `Runtime: provider ${short(view.provider, 28)} · model ${short(view.mo... |
| 153 | 默认值使用硬编码中文 | medium | "       ? `Project: ${displayProject(view.projectPath)}`       : `项目：${displayPr... |
| 167 | 默认值使用硬编码中文 | medium | "详情：使用 /model doctor、/index doctor、/cache status、/memory、/mcp doctor、/background... |
| 186 | 默认值使用硬编码中文 | medium | "       ? `Doctor: ${conclusion} — local checks only, not a smoke or Beta verdic... |
| 189 | 默认值使用硬编码中文 | medium | "       ? `Scope: ${items.length - attention.length}/${items.length} local check... |
| 196 | 默认值使用硬编码中文 | medium | "原因：未发现本地阻塞项。" |
| 201 | 默认值使用硬编码中文 | medium | "下一步：如需完整清单，用 /doctor all；不要据此宣称整体 ready。" |
| 214 | 默认值使用硬编码中文 | medium | "         ? `- ${attention.length - visible.length} more item(s) hidden from the... |
| 222 | 默认值使用硬编码中文 | medium | "详情：/doctor all。问题列表：/problems。" |
| 231 | 默认值使用硬编码中文 | medium | "       ? `Readiness: local ${items.length - blocked.length}/${items.length} pas... |
| 243 | 默认值使用硬编码中文 | medium | "Problems Lite：当前没有本地 verification/provider/background/freshness 问题。这不代表 readine... |
| 246 | 默认值使用硬编码中文 | medium | "       ? `Problems Lite: ${problems.length} current problem(s); derived from lo... |
| 258 | 默认值使用硬编码中文 | medium | "可用 /verify last、/details evidence、/details background <id> 或 provider/index/cac... |
| 268 | 默认值使用硬编码中文 | medium | ",       // D.14A-R-Fix P1-5 — 没有真实 endpoint/provider evidence 时不显示 pass。       ... |
| 303 | 默认值使用硬编码中文 | medium | "}`           : `状态 ${view.index.status}${typeof view.index.changedFiles === " |
| 304 | 默认值使用硬编码中文 | medium | " ? `；改动文件 ${view.index.changedFiles}` : " |
| 313 | 默认值使用硬编码中文 | medium | "}; workspace snapshot ${view.cache.workspaceSnapshot}`           : `命中率 ${forma... |
| 314 | 默认值使用硬编码中文 | medium | "}；工作区快照 ${view.cache.workspaceSnapshot}`,       nextAction: " |
| 322 | 默认值使用硬编码中文 | medium | "           ? `project rules ${view.memory.projectRules}; candidates ${view.memo... |
| 340 | 默认值使用硬编码中文 | medium | "}; servers ${view.mcp.servers}; tools ${view.mcp.tools}; errors ${view.mcp.erro... |
| 341 | 默认值使用硬编码中文 | medium | "}；服务 ${view.mcp.servers}；工具 ${view.mcp.tools}；错误 ${view.mcp.errors}`,       nex... |
| 350 | 默认值使用硬编码中文 | medium | "           ? `total ${view.background.total}; running ${view.background.running... |
| 361 | 默认值使用硬编码中文 | medium | "           ? `status ${view.verification.status}; unverified ${view.verificatio... |
| 372 | 默认值使用硬编码中文 | medium | "           ? `web source evidence ${view.freshness.webSourceEvidence}; local pr... |
| 385 | 默认值使用硬编码中文 | medium | "           ? `package manager ${view.projectDoctor.packageManager}; scripts ${v... |
| 395 | 默认值使用硬编码中文 | medium | "           ? `checked ${view.sourceDrift.checked.length}; issues ${view.sourceD... |
| 405 | 默认值使用硬编码中文 | medium | "           ? `refs ${view.contextPicker.refs.length}; evidence kinds ${view.con... |
| 415 | 默认值使用硬编码中文 | medium | "           ? `changed files ${view.rollbackCoach.changedFiles}; untracked ${vie... |
| 426 | 默认值使用硬编码中文 | medium | ")}`           : `级别 ${view.costPreview.level}；标签 ${view.costPreview.labels.join... |
| 439 | 默认值使用硬编码中文 | medium | "轻量就绪入口：" |
| 441 | 默认值使用硬编码中文 | medium | "       ? ` · unknown ${safeReadableList(view.projectDoctor.unknown)}`       : `... |
| 445 | 默认值使用硬编码中文 | medium | ") {     lines.push(       `- Project Doctor Lite: [${view.projectDoctor.status.... |

### packages/tui/src/terminal-readiness-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 24 | 默认值使用硬编码中文 | medium | ";   const projectDoctor = createProjectDoctorLite(context);   const sourceDrift... |
| 140 | 默认值使用硬编码中文 | medium | ",       canClaimPass: false,       canClaimMature: false,       upgradeBlocked:... |
| 147 | 默认值使用硬编码中文 | medium | " && unverified.length === 0` 直升 real-smoke。   //   // 分级器入参从 VerificationReport... |
| 170 | 默认值使用硬编码中文 | medium | ");   // D.14A-R-Fix P1-2 — 只有**非合成** smoke kind 命令 pass 才算真实拉起进程观察过。   // `/ver... |
| 319 | 默认值使用硬编码中文 | medium | ");   if (report && !/未执行真实\|未.*真实.*smoke\|不代表真实全量 smoke/u.test(report)) {     iss... |
| 321 | 默认值使用硬编码中文 | medium | ");   }   if (report && !/不代表 Beta PASS\|不是 Beta PASS\|不声明 Beta PASS/u.test(report... |
| 324 | 默认值使用硬编码中文 | medium | ");   }   if (report && !/不代表.*smoke-ready\|不是.*smoke-ready\|不声明.*smoke-ready/u.te... |
| 327 | 默认值使用硬编码中文 | medium | ");   }   if (     report &&     !/不代表.*open-source-ready\|不是.*open-source-ready\|... |
| 333 | 默认值使用硬编码中文 | medium | ");   }   if (     report &&     !/未进入 Phase 16 \/ 17 \/ 18\|未进 16\/17\/18\|不得自动进入... |
| 341 | 默认值使用硬编码中文 | medium | ");   }   if (report && !/未 commit\|未提交 commit\|不提交 commit\|no commit/u.test(report... |
| 360 | 默认值使用硬编码中文 | medium | "] {   // D.13V — fallback workspace snapshot 不再算 hasWorkspaceSnapshot。   const ... |

### packages/tui/src/tool-output-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 58 | 默认值使用硬编码中文 | medium | ",     toolName: name,     summary: sanitizeToolSummaryForPrimary(output.summary... |
| 89 | 默认值使用硬编码中文 | medium | "命令已退出 0" |
| 120 | 默认值使用硬编码中文 | medium | ") return `搜索摘要：${count ?? 0} 处。`;   if (name === " |
| 121 | 默认值使用硬编码中文 | medium | ") return `文件搜索摘要：${count ?? visibleLines} 个文件。`;   if (name === " |
| 122 | 默认值使用硬编码中文 | medium | ") return `读取摘要：${totalLines ?? visibleLines} 行。`;   if (name === " |
| 123 | 默认值使用硬编码中文 | medium | " && exitCode !== undefined) return `Bash 已结束：退出码 ${exitCode}。`;   return `${nam... |
| 144 | 默认值使用硬编码中文 | medium | " ? `Command exited ${exitCode}` : `命令已退出 ${exitCode}`; }  /**  * Redact secret-... |
| 251 | 默认值使用硬编码中文 | medium | "[工具调用细节已隐藏。]\n" |
| 325 | 默认值使用硬编码中文 | medium | ") ? undefined : start; }  function findRawToolPrefixAtEnd(text: string): number... |
| 342 | 默认值使用硬编码中文 | medium | "输出已折叠，按 Ctrl+O 展开。" |
| 349 | 默认值使用硬编码中文 | medium | "}${suffix}.`;   }   const suffix = changed > 0 ? `；改动 ${changed} 个文件` : " |
| 351 | 默认值使用硬编码中文 | medium | ";   return `${name} 已完成${output.truncated ? " |
| 364 | 默认值使用硬编码中文 | medium | "改动文件：$1" |
| 365 | 默认值使用硬编码中文 | medium | "内容行数：$1" |
| 366 | 默认值使用硬编码中文 | medium | "选中行数：$1" |
| 367 | 默认值使用硬编码中文 | medium | "窗口行数：$1" |
| 388 | 默认值使用硬编码中文 | medium | "           ? `... ${remaining} more todo item(s) hidden from main output.`     ... |
| 426 | 默认值使用硬编码中文 | medium | "       ? [           `${counts.in_progress} in progress`,           `${counts.p... |
| 455 | 默认值使用硬编码中文 | medium | "           ? `... ${remaining} more todo item(s) hidden from main output.`     ... |
| 524 | 默认值使用硬编码中文 | medium | " ? `${count} match(es)` : `${count} 条结果`);   }   if (name === " |
| 527 | 默认值使用硬编码中文 | medium | " ? `exit code ${exitCode}` : `退出码 ${exitCode}`);     if (looksLikeMojibake(text... |
| 529 | 默认值使用硬编码中文 | medium | "疑似编码问题" |
| 538 | 默认值使用硬编码中文 | medium | "         ? `patch +${addedLines} -${removedLines}`         : `补丁 +${addedLines}... |
| 545 | 默认值使用硬编码中文 | medium | "}`           : `改动文件 ${changedFiles.length}`,       );     }     if (readGuard)... |
| 550 | 默认值使用硬编码中文 | medium | "读取保护已启用" |
| 587 | 默认值使用硬编码中文 | medium | "       ? `${input.visibleLines} line(s)`       : `${input.visibleLines} 行`;   }... |
| 594 | 默认值使用硬编码中文 | medium | "       ? `window ${windowLines}/${input.totalLines} line(s); content ${contentL... |
| 598 | 默认值使用硬编码中文 | medium | "     ? `total ${input.totalLines} line(s); content ${contentLines} line(s)`    ... |

### packages/tui/src/tui-agent-job-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 169 | 默认值使用硬编码中文 | medium | "         : isEn           ? `running ${agent.type}`           : `正在运行 ${agent.t... |
| 179 | 默认值使用硬编码中文 | medium | "         ? agent.summary         : isEn           ? `Started ${label}. Use /age... |
| 186 | 默认值使用硬编码中文 | medium | ",     title: `Agent ${label}`,     status: backgroundStatus,     currentStep,  ... |

### packages/tui/src/tui-context-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 143 | 默认值使用硬编码中文 | medium | ";       toolCall: ModelToolCall;       toolName: ToolName;       sessionId: str... |
| 159 | 默认值使用硬编码中文 | medium | ").PolicyVerdict;     }   \| {       // D.14G — managed worktree remove 确认（clean=... |
| 165 | 默认值使用硬编码中文 | medium | ";       sessionId: string;       name: string;       path: string;       force:... |
| 179 | 默认值使用硬编码中文 | medium | ";       sessionId: string;       message?: string;       includeUntracked?: boo... |
| 325 | 默认值使用硬编码中文 | medium | "; taskId: string; canCancel: boolean };   activeVerificationAbortController?: A... |
| 338 | 默认值使用硬编码中文 | medium | "; panelId: ConfigPanelId; actionCursor: number };   workspaceTrustEnforced?: bo... |
| 364 | 默认值使用硬编码中文 | medium | "的唯一证据；listDeferredTools 仅作为白名单存在性，不能等同于" |
| 364 | 默认值使用硬编码中文 | medium | "。   discoveredDeferredToolNames: Set<string>;   toolResultBudgetState?: ToolRes... |
| 381 | 默认值使用硬编码中文 | medium | " 的套娃。`captureLastFullOutput` 负责把 /details 期间    * 的写入跳过。    */   lastFullOutput... |
| 406 | 默认值使用硬编码中文 | medium | ").TranscriptViewportGeometryView;   /**    * D.13Q-UX Closure — HelpPanel 状态。打开... |
| 411 | 默认值使用硬编码中文 | medium | ";     cursor: number;   };   /**    * D.13Q-UX Closure — BtwPanel 状态（side quest... |
| 419 | 默认值使用硬编码中文 | medium | ";     answer?: string;     error?: string;   };   activeBtwAbortController?: Ab... |
| 451 | 默认值使用硬编码中文 | medium | "的命令（如 /btw 调模型）    * 能在 await 前主动刷新一帧。plain TUI / 测试无此钩子时安全跳过。    */   shellRer... |
| 462 | 默认值使用硬编码中文 | medium | ").CommandPanelView;   /**    * Ctrl+O transcript/message verbose expand state. ... |

### packages/tui/src/tui-data-types.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 116 | 默认值使用硬编码中文 | medium | ";  export type VerificationStep = {   kind: VerificationStepKind;   command: st... |
| 123 | 默认值使用硬编码中文 | medium | "` 或无脚本时的 `node --version` 降级），只能证明   // 本地 Node 进程可运行，不能当作真实 provider/TUI/rende... |
| 547 | 默认值使用硬编码中文 | medium | ";   cwd: string;   envAllowlist: string[];   redactedEnvRefs: string[];   timeo... |
| 583 | 默认值使用硬编码中文 | medium | "。缺省（旧 state.json）按未设置处理。     explicit?: { tokens?: boolean; steps?: boolean; ru... |
| 667 | 默认值使用硬编码中文 | medium | ";   lastError?: string;   nextAction: string; };  export type RemoteEvent = {  ... |
| 711 | 默认值使用硬编码中文 | medium | ";   summary: string;   evidenceCreated: false; };  // D.14E — 远程入站消息模型。手机端只能回传以... |
| 718 | 默认值使用硬编码中文 | medium | ";  export type RemoteInboundMessage = {   kind: RemoteInboundKind;   channel: s... |
| 732 | 默认值使用硬编码中文 | medium | ";   // approval_response：引用此前发出的 approval_request event id 并回显 nonce。   eventId... |
| 752 | 默认值使用硬编码中文 | medium | ";  export type RemoteInboundDecision = {   kind: RemoteInboundKind;   status: R... |
| 845 | 默认值使用硬编码中文 | medium | ";   lastLearningRun?: MemoryLearningRun;   lastHandoff?: HandoffPacket;   lastR... |
| 865 | 默认值使用硬编码中文 | medium | ";  export type FailureLearningRecord = {   id: string;   createdAt: string;   l... |
| 881 | 默认值使用硬编码中文 | medium | "提示（脱敏）。   avoidNextTime: string;   // 关联的命令/工具/provider/git 操作（脱敏，可空）。   relate... |

### packages/tui/src/tui-details-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 140 | 默认值使用硬编码中文 | medium | "         ? `- cancel: /agents cancel ${agent.id}`         : `- 中断：/agents cance... |

### packages/tui/src/tui-memory-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 184 | 默认值使用硬编码中文 | medium | "unreadable; 可检查文件权限或运行 /memory storage 定位路径" |
| 187 | 默认值使用硬编码中文 | medium | "missing; 可运行 /memory init 生成基础模板，不会自动生成" |
| 205 | 默认值使用硬编码中文 | medium | "- hint: LINGHUN.md 读取失败；可运行 /memory storage 定位路径，不会自动生成或打断输入。" |
| 207 | 默认值使用硬编码中文 | medium | "- note: LINGHUN.md 只显示截断摘要；完整规则不刷主屏、不注入完整聊天。" |
| 208 | 默认值使用硬编码中文 | medium | "- hint: 缺少 LINGHUN.md。可运行 /memory init 生成基础模板；不会打断输入。" |
| 248 | 默认值使用硬编码中文 | medium | "Memory review：暂无候选记忆；长期记忆不会自动写入。" |
| 249 | 默认值使用硬编码中文 | medium | "来源边界：/memory learn 只看 bounded evidence/Todo/verification/handoff，不读取完整聊天、完整日志或完... |
| 250 | 默认值使用硬编码中文 | medium | "下一步：需要时用 /memory candidate <短小稳定摘要> [--scope project\|user\|session] 创建候选，再 /memo... |
| 253 | 默认值使用硬编码中文 | medium | "动作区别：accept=写入长期且可被 topK 注入；reject=丢弃候选；disable=暂停已接受注入；rollback=重新启用；delete=删除... |
| 257 | 默认值使用硬编码中文 | medium | "Memory review（候选 ≠ 长期记忆）" |
| 266 | 默认值使用硬编码中文 | medium | "动作区别：accept=写入长期且可被 topK 注入；reject=丢弃候选；disable=暂停已接受注入；rollback=重新启用；delete=删除... |
| 293 | 默认值使用硬编码中文 | medium | "Memory stats（受控学习 / 成本守卫）" |
| 300 | 默认值使用硬编码中文 | medium | "}；auto accept no；切换：/memory learn on\|off`,     " |
| 302 | 默认值使用硬编码中文 | medium | "- 完整候选、聊天、日志和索引 dump 不注入 prompt" |
| 327 | 默认值使用硬编码中文 | medium | ", normalized, source, refs));   };   for (const evidence of context.evidence.sl... |
| 333 | 默认值使用硬编码中文 | medium | ") {       add(`已完成任务线索：${todo.content}`, " |
| 337 | 默认值使用硬编码中文 | medium | ") {     add(`验证通过线索：${context.lastVerification.summary}`, " |
| 338 | 默认值使用硬编码中文 | medium | ", [       context.lastVerification.id,     ]);   }   if (context.memory.lastHan... |
| 343 | 默认值使用硬编码中文 | medium | ", [       context.memory.lastHandoff.id,     ]);   }   return summaries; }  // ... |
| 374 | 默认值使用硬编码中文 | medium | " as const },   {     pattern: /(?:不要\|don' |
| 377 | 默认值使用硬编码中文 | medium | " as const,   },   {     pattern: /(?:先\|before\|每次\|always\|每轮)\s+(.{3,60})/i,     ... |
| 381 | 默认值使用硬编码中文 | medium | " as const,   },   {     pattern: /(?:习惯\|偏好\|喜欢\|style\|preference)\s*[:：]?\s*(.{3,... |
| 428 | 默认值使用硬编码中文 | medium | "Memory learn（受控 / 只生成候选）" |
| 431 | 默认值使用硬编码中文 | medium | "}`,     `- 跳过原因：${run.skippedReason ?? " |
| 433 | 默认值使用硬编码中文 | medium | "- 下一步：用 /memory review 查看候选，再 accept 或 reject；auto accept no。" |
| 485 | 默认值使用硬编码中文 | medium | 't items. - Facts that have been checked against code, index results, command ou... |
| 543 | 默认值使用硬编码中文 | medium | "       ? `Project rules file is missing: ${context.memory.projectRulesPath}\n- ... |
| 552 | 默认值使用硬编码中文 | medium | "       ? `Project rules: ${context.memory.projectRulesPath}\n${truncateDisplay(... |

### packages/tui/src/tui-messages.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 46 | 默认值使用硬编码中文 | medium | "输入普通消息开始对话；输入 /help 查看命令；输入 /exit 退出。" |
| 49 | 默认值使用硬编码中文 | medium | "语言已切换为中文。" |
| 51 | 默认值使用硬编码中文 | medium | "当前权限模式：{mode}" |
| 52 | 默认值使用硬编码中文 | medium | "可选：default / auto-review / plan / full-access" |
| 54 | 默认值使用硬编码中文 | medium | "边界：切换模式不等于绕过硬拒绝；危险动作仍受权限底座约束。Plan 仍只读，auto-review 会自动放行低风险工作区编辑。" |
| 55 | 默认值使用硬编码中文 | medium | "未知模式。可选：default / auto-review / plan / full-access" |
| 56 | 默认值使用硬编码中文 | medium | "已切换权限模式：{mode}" |
| 58 | 默认值使用硬编码中文 | medium | "Plan 模式只允许 Read / Grep / Glob / Diff / Todo 等只读或会话内操作。确认方案后仍不等于授权所有工具。" |
| 59 | 默认值使用硬编码中文 | medium | "已确认，正在进入本地动作路径；后续受保护操作仍会单独审批。" |
| 60 | 默认值使用硬编码中文 | medium | "确认已过期。请重新发起请求。" |
| 61 | 默认值使用硬编码中文 | medium | "该动作需要输入精确 slash command 才能继续；这条输入未执行。" |
| 62 | 默认值使用硬编码中文 | medium | "该动作需要精确确认；普通 yes/确认 未放行。" |
| 63 | 默认值使用硬编码中文 | medium | "已退出 Linghun。" |
| 65 | 默认值使用硬编码中文 | medium | "状态栏：session {session} · model {model} · mode {mode} · bg {background} · cache {... |
| 66 | 默认值使用硬编码中文 | medium | "状态栏：{mode} · bg {background}" |
| 69 | 默认值使用硬编码中文 | medium | "当前项目还没有会话。" |
| 70 | 默认值使用硬编码中文 | medium | "会话ID  更新时间  摘要" |
| 72 | 默认值使用硬编码中文 | medium | "已创建 checkpoint" |
| 73 | 默认值使用硬编码中文 | medium | "当前没有 checkpoint。" |
| 74 | 默认值使用硬编码中文 | medium | "已恢复 checkpoint" |
| 75 | 默认值使用硬编码中文 | medium | "未找到 checkpoint" |
| 76 | 默认值使用硬编码中文 | medium | "当前没有后台任务。" |
| 77 | 默认值使用硬编码中文 | medium | "尚未产生有效输出" |
| 79 | 默认值使用硬编码中文 | medium | "当前没有正在运行的长任务；状态为 idle。" |
| 80 | 默认值使用硬编码中文 | medium | "已标记当前长任务为 cancelled。" |
| 83 | 默认值使用硬编码中文 | medium | "尚未确认，需要先检查。涉及代码事实的结论必须先通过 /read、/grep、索引查询或命令输出获得证据。" |
| 84 | 默认值使用硬编码中文 | medium | "缺少证据，请补齐匹配证据或移除该声明。" |
| 86 | 默认值使用硬编码中文 | medium | "[hint:info] 缺少 LINGHUN.md 项目规则；如需基础模板，可运行 /memory init。不会自动生成或打断输入。" |
| 87 | 默认值使用硬编码中文 | medium | "当前模型响应或工具调用已取消；可以继续输入。" |
| 94 | 默认值使用硬编码中文 | medium | "语言已切换为中文。" |

### packages/tui/src/tui-model-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 127 | 默认值使用硬编码中文 | medium | ") return !provider.apiKey \|\| !provider.model;   return hasOpenAiCompatibleProvi... |
| 167 | 默认值使用硬编码中文 | medium | " &&     isDefaultExecutorRoute(route, context.config) &&     context.model &&  ... |
| 184 | 默认值使用硬编码中文 | medium | ");   const reasoningLevel = providerConfig?.reasoningLevel;   // D.13K：reasonin... |
| 306 | 默认值使用硬编码中文 | medium | " : selectedModel,     fallbackCandidates: baseRoute.fallbackModels,     require... |
| 332 | 默认值使用硬编码中文 | medium | "在 .linghun/settings.json 配置 openai-compatible 的 baseUrl、apiKey 和 model" |
| 335 | 默认值使用硬编码中文 | medium | "))) {     suggestions.push(`选择满足 ${route.requiredCapabilities.join(" |
| 336 | 默认值使用硬编码中文 | medium | ")} capability 的模型`);   }   if (route.fallbackModels.length === 0) {     suggest... |
| 339 | 默认值使用硬编码中文 | medium | ");   }   return suggestions; }  export function formatRoutePauseMessage(role: M... |
| 345 | 默认值使用硬编码中文 | medium | ")}。修复建议：${decision.repairSuggestions.join(" |

### packages/tui/src/tui-output-surface.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 15 | 默认值使用硬编码中文 | medium | "; // Phase 6.5: summary 首行超长时截断，避免单行渲染撑爆 TUI。 const MAX_STREAMING_SUMMARY_CHARS... |
| 25 | 默认值使用硬编码中文 | medium | ")) return true;   return false; }  export class ShellBlockOutput extends Writab... |
| 42 | 默认值使用硬编码中文 | medium | ";    constructor(     private readonly context: TuiContext,     private readonl... |
| 58 | 默认值使用硬编码中文 | medium | " 都会被这里 drop，       // 让 task transcript 永远看不到那条噪音。新 TaskFooter 已经覆盖必要状态       /... |
| 66 | 默认值使用硬编码中文 | medium | "，让 /details 默认分支可以展开       // 长正文（如 /model doctor 的 provider.env merge / provid... |
| 90 | 默认值使用硬编码中文 | medium | "占位行 —— 等待态由    * requestActivityPhase / mapRequestActivityToView 驱动的 ActivityIn... |
| 92 | 默认值使用硬编码中文 | medium | "）。    *    * id 由调用方传入（每个 request 用一个稳定 id），便于多轮请求各自占用    * 独立 block，互不覆盖。    *... |
| 105 | 默认值使用硬编码中文 | medium | ");     // 不再 push 初始空 block；只通知一次 rerender（让 ActivityIndicator 起来）。     this.on... |
| 117 | 默认值使用硬编码中文 | medium | ";     block.nextAction = undefined;     this.blocks.push(block);     return blo... |
| 133 | 默认值使用硬编码中文 | medium | ", () => {});       return;     }     this.assistantStreamText += text;     this... |
| 158 | 默认值使用硬编码中文 | medium | ";     void this.compactOutputMemory();     this.onWrite();   }    /**    * D.13... |
| 177 | 默认值使用硬编码中文 | medium | ";     }     if (!this.context.suppressLastFullOutputCapture) {       this.conte... |
| 193 | 默认值使用硬编码中文 | medium | ";     }     this.clearStreamingPreview(id);     this.commitAssistantBlock(id, t... |
| 220 | 默认值使用硬编码中文 | medium | "Ctrl+O 查看完整内容" |
| 229 | 默认值使用硬编码中文 | medium | ",     });     if (!this.context.suppressLastFullOutputCapture) {       this.con... |
| 240 | 默认值使用硬编码中文 | medium | "；    *   - 走 messageKind=" |
| 241 | 默认值使用硬编码中文 | medium | "，    *     ProductBlock 命中红边卡片（带 fail marker + tool_result_error tone）；    *   ... |
| 257 | 默认值使用硬编码中文 | medium | "Ctrl+O 查看完整错误" |
| 283 | 默认值使用硬编码中文 | medium | "Ctrl+O 查看完整内容" |
| 490 | 默认值使用硬编码中文 | medium | ")   ); }  /**  * Duck-typed helpers for assistant streaming. Ink shell 注入 Shell... |
| 519 | 默认值使用硬编码中文 | medium | ") {     candidate.endAssistantStream();   } }  /**  * D.13V — Final Answer Gate... |
| 531 | 默认值使用硬编码中文 | medium | ") {     candidate.discardAssistantBlock(id);   } }  /**  * D.13V — Final Answer... |
| 544 | 默认值使用硬编码中文 | medium | ") {     candidate.replaceAssistantBlockContent(id, text);   } }  /**  * D.13Q-U... |
| 556 | 默认值使用硬编码中文 | medium | ") {     candidate.writeDiagnosticLine(text);     return;   }   writeLine(output... |

### packages/tui/src/tui-permission-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 51 | 默认值使用硬编码中文 | medium | ";   reason: string;   preflight?: string;   /**    * Set when the policy engine... |
| 77 | 默认值使用硬编码中文 | medium | "] \| undefined, ): Promise<AddAllowRuleResult> {   // 1. 校验工具名   if (toolName !=... |
| 81 | 默认值使用硬编码中文 | medium | ", message: `未知工具：${toolName}` };   }   // 2. 去重（与 PermissionElevationModel.hasE... |
| 85 | 默认值使用硬编码中文 | medium | " 通配（umbrella tool）   //    - 既有规则 risk 为空（umbrella risk）视为覆盖任意 risk；否则要求精确匹配   ... |
| 98 | 默认值使用硬编码中文 | medium | ",       rule: existing,       message: `已存在等价 allow 规则：${existing.id} allow ${e... |
| 100 | 默认值使用硬编码中文 | medium | "}`,     };   }   // 3. push + persist；失败则回滚   const rule: PermissionRule = { id... |
| 111 | 默认值使用硬编码中文 | medium | ",       error: error as Error,       message: `保存权限规则失败：${(error as Error).mess... |
| 117 | 默认值使用硬编码中文 | medium | ",     rule,     message: `已添加权限规则：${rule.id} allow ${toolName}${risk ? ` ${risk... |
| 154 | 默认值使用硬编码中文 | medium | ", reason: hardDeny };   }    // D.13Q-UX Closure: 始终算一次 verdict 用于 UI 解释行（即使 au... |
| 192 | 默认值使用硬编码中文 | medium | "Plan 模式允许只读或会话内规划工具。" |
| 195 | 默认值使用硬编码中文 | medium | "Plan 模式禁止写入、编辑和 Bash 执行；请先 /plan accept 确认方案并切回执行模式。" |
| 202 | 默认值使用硬编码中文 | medium | ") {       // D.13Q-UX：reason 不再拼 rule.id（randomUUID）。user-facing 文案稳定，       //... |
| 210 | 默认值使用硬编码中文 | medium | "命中需确认规则。需要用户确认后才会执行本次工具。" |
| 214 | 默认值使用硬编码中文 | medium | "命中允许规则。" |
| 221 | 默认值使用硬编码中文 | medium | ",         reason: `auto-review 允许安全只读动作：${verdict.reason}`,         autoAllowRe... |
| 231 | 默认值使用硬编码中文 | medium | "auto-review 自动允许工作区内低风险文件编辑。" |
| 237 | 默认值使用硬编码中文 | medium | "auto-review 允许只读或会话内工具。" |
| 240 | 默认值使用硬编码中文 | medium | "auto-review 仅自动放行低风险工作区编辑；当前动作需要确认，硬拒绝和路径安全仍由权限底座处理。" |
| 248 | 默认值使用硬编码中文 | medium | "full-access 已由本地用户显式开启，但硬拒绝和安全路径仍生效。" |
| 257 | 默认值使用硬编码中文 | medium | "default 模式允许只读或会话内工具。" |
| 260 | 默认值使用硬编码中文 | medium | "default 模式不会静默执行 Bash、写入、编辑、删除、配置、安装、联网或权限变更；需要用户确认后才会执行本次工具。" |

### packages/tui/src/tui-state-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 59 | 默认值使用硬编码中文 | medium | ";  // D.13P boundary cleanup: cache freshness 默认维度不再硬编码 deepseek/deepseek-v4-fl... |
| 67 | 硬编码模型名 | medium | "deepseek-" |
| 483 | 默认值使用硬编码中文 | medium | "定位 bug、做最小修复、运行相关验证" |
| 487 | 默认值使用硬编码中文 | medium | "把已确认设计转成最小代码改动" |
| 491 | 默认值使用硬编码中文 | medium | "按文档差异补齐代码入口和验证" |
| 495 | 默认值使用硬编码中文 | medium | "只输出重构计划与风险，不直接改代码" |
| 498 | 默认值使用硬编码中文 | medium | "基于已验证变更生成发布说明" |
| 499 | 默认值使用硬编码中文 | medium | "只读审查 diff、风险和验证证据" |
| 502 | 默认值使用硬编码中文 | medium | "先判断 single_issue/systemic_gap、影响面、P0/P1/P2、阶段边界和验证方式" |
| 525 | 默认值使用硬编码中文 | medium | "Start Gate：启动前先让用户确认范围。" |
| 526 | 默认值使用硬编码中文 | medium | "执行中任何写文件、Bash、联网或依赖安装仍走现有权限管道。" |
| 527 | 默认值使用硬编码中文 | medium | "结束前提示运行推荐验证，并输出修改文件、验证结果、已知限制和范围边界。" |

### packages/tui/src/usage-stats-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 10 | 默认值使用硬编码中文 | medium | "Usage（本会话原始 token/cache usage）" |
| 22 | 默认值使用硬编码中文 | medium | "- billing: 未记录真实账单字段；任何金额只能标记 estimated。" |
| 61 | 默认值使用硬编码中文 | medium | "- cost: estimated unavailable（未配置价格；不伪装成真实账单；状态栏不显示金额）" |

### packages/tui/src/verification-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 34 | 默认值使用硬编码中文 | medium | "最小合成 smoke：仅确认 Verification Runner 可执行命令并归档 evidence；不是真实 provider/TUI/render/r... |
| 43 | 默认值使用硬编码中文 | medium | "TypeScript 类型检查。 " |
| 44 | 默认值使用硬编码中文 | medium | "项目测试套件。 " |
| 45 | 默认值使用硬编码中文 | medium | "lint 静态检查。 " |
| 46 | 默认值使用硬编码中文 | medium | "构建验证。 " |
| 47 | 默认值使用硬编码中文 | medium | "项目自定义 smoke 验证。 " |
| 56 | 默认值使用硬编码中文 | medium | "未发现项目验证脚本，降级为 Node 运行环境 smoke 检查。" |
| 102 | 默认值使用硬编码中文 | medium | " },     startedAt,     updatedAt: startedAt,     heartbeatIntervalMs: 30_000,  ... |
| 114 | 默认值使用硬编码中文 | medium | ",     run: { id: runId, plan, startedAt },     createdAt: startedAt,   });   aw... |
| 161 | 默认值使用硬编码中文 | medium | ") {         risk.push(`${step.kind} 失败：${summary}`);       }       if (commandS... |
| 164 | 默认值使用硬编码中文 | medium | ") {         unverified.push(`${step.kind} runner error：${summary}`);         ri... |
| 168 | 默认值使用硬编码中文 | medium | ") {         unverified.push(`${step.kind} ${commandStatus}：${summary}`);       ... |
| 172 | 默认值使用硬编码中文 | medium | ") {         unverified.push(`${step.kind} stale：${summary}`);         risk.push... |
| 219 | 默认值使用硬编码中文 | medium | "           ? `PASS：${results.length} 个验证步骤通过。`           : status === " |
| 221 | 默认值使用硬编码中文 | medium | "             ? `FAIL：${failed.length}/${results.length} 个验证步骤失败。`             :... |
| 224 | 默认值使用硬编码中文 | medium | "CANCELLED：验证已取消，未生成 PASS 证据。" |
| 226 | 默认值使用硬编码中文 | medium | "TIMEOUT：验证超时，未生成 PASS 证据。" |
| 228 | 默认值使用硬编码中文 | medium | "STALE：验证任务疑似卡住，未生成 PASS 证据。" |
| 230 | 默认值使用硬编码中文 | medium | "PARTIAL：验证命令已运行，但 runner/toolchain 退出清理异常。" |
| 241 | 默认值使用硬编码中文 | medium | "可继续审查结果或进入交付总结。" |
| 243 | 默认值使用硬编码中文 | medium | "查看 runner error 日志，记录 Node 版本，并建议用 Node 22 LTS 复核。" |
| 244 | 默认值使用硬编码中文 | medium | "先查看失败命令与日志，修复后复跑 /verify。" |
| 403 | 默认值使用硬编码中文 | medium | ")       : `最近验证为 ${verification.status.toUpperCase()}`     : " |
| 408 | 默认值使用硬编码中文 | medium | "先按失败命令日志修复，再复跑 /verify。" |
| 410 | 默认值使用硬编码中文 | medium | "先查看 runner error 日志；如为 Node/工具链退出清理异常，建议用 Node 22 LTS 复核。" |
| 412 | 默认值使用硬编码中文 | medium | "验证已取消；先确认取消原因，再复跑 /verify，当前不得给 PASS verdict。" |
| 414 | 默认值使用硬编码中文 | medium | "验证超时；先查看日志和进程清理情况，缩小命令或修复卡住点后复跑。" |
| 416 | 默认值使用硬编码中文 | medium | "验证任务疑似卡住；先查看 /background 和日志，必要时 /interrupt 后复跑。" |
| 418 | 默认值使用硬编码中文 | medium | "结合 diff 人工确认需求覆盖；如有新改动请复跑 /verify。" |
| 419 | 默认值使用硬编码中文 | medium | "先运行 /verify 或 /verify plan，形成 test_result evidence。" |
| 444 | 默认值使用硬编码中文 | medium | " ? `Duration: ${report.durationMs}ms` : `耗时：${report.durationMs}ms`,   ];   for... |
| 450 | 默认值使用硬编码中文 | medium | ") {       lines.push(`  摘要：${command.summary}`);     }   }   if (report.unverif... |
| 455 | 默认值使用硬编码中文 | medium | ")}`);   }   lines.push(`下一步：${report.nextAction}`);   return lines.join(" |
| 466 | 默认值使用硬编码中文 | medium | "还没有最近验证结果。" |

### packages/tui/src/workflow-agent-runtime-bridge.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 717 | 默认值使用硬编码中文 | medium | "}`),   ); }  function isArchitectureRiskReference(value: string): boolean {   i... |

### packages/tui/src/workflow-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 182 | 默认值使用硬编码中文 | medium | "} — Ctrl+O for details.`           : `Workflows · ${context.workflows.templates... |
| 200 | 默认值使用硬编码中文 | medium | ",       summary: run         ? [             isEn               ? `Workflow ${r... |
| 210 | 默认值使用硬编码中文 | medium | "没有 active workflow run — Ctrl+O 查看详情。" |
| 229 | 默认值使用硬编码中文 | medium | "} — Ctrl+O for details.`           : `Registry · ${agentCount} 个 agent、${workfl... |
| 230 | 默认值使用硬编码中文 | medium | "} — Ctrl+O 查看详情。`,       ],       actions: [" |
| 244 | 默认值使用硬编码中文 | medium | "用法：/workflows plan <目标描述>" |
| 264 | 默认值使用硬编码中文 | medium | " 生成计划 — Ctrl+O 查看详情。`           : isEn             ? `Plan for " |
| 267 | 默认值使用硬编码中文 | medium | " 的计划存在警告 — Ctrl+O 查看详情。`,       ],       actions: result.ok         ? [" |
| 288 | 默认值使用硬编码中文 | medium | "用法：/workflows run <workflowId\|目标描述>" |
| 302 | 默认值使用硬编码中文 | medium | ").trim();     await runWorkflowSteps(goal, context, output);     return;   }   ... |
| 319 | 默认值使用硬编码中文 | medium | "- 启动前需要用户明确确认；本命令只展示启动门，不会自动改文件。" |
| 320 | 默认值使用硬编码中文 | medium | "- 后续写文件、Bash、联网、安装依赖仍走现有权限管道。" |
| 322 | 默认值使用硬编码中文 | medium | "- finish check: 输出修改文件、验证结果、已知限制、交付检查与是否越界。" |
| 426 | 默认值使用硬编码中文 | medium | "));     if (       !state \|\|       resolve(state.projectPath).toLowerCase() !==... |
| 583 | 默认值使用硬编码中文 | medium | "workflow 仍处于活动状态；中断正在恢复缺失的后台状态。" |
| 587 | 默认值使用硬编码中文 | medium | "重跑前请先查看 /workflows status。" |
| 596 | 默认值使用硬编码中文 | medium | "当前没有 active workflow run。" |
| 642 | 默认值使用硬编码中文 | medium | "后台 workflow 已启动。" |
| 642 | 默认值使用硬编码中文 | medium | ",     `- steps: ${input.steps}`,     `- 当前阶段：${phase}`,     " |
| 659 | 默认值使用硬编码中文 | medium | "后台 workflow 已启动" |
| 659 | 默认值使用硬编码中文 | medium | "}；steps: ${input.steps}；当前阶段：${phase}；详情：/workflows status 或 /background。`; }  ... |
| 704 | 默认值使用硬编码中文 | medium | ");   const preview = generateWorkflowPlanPreview({     goal,     permissionMode... |
| 723 | 默认值使用硬编码中文 | medium | ");     return;   }   const confirmed = generateWorkflowPlanPreview({     goal, ... |
| 827 | 默认值使用硬编码中文 | medium | "等待 step_result；失败时查看 /failures 和 transcript。" |
| 991 | 默认值使用硬编码中文 | medium | "workflow 已完成，结果仍为 PARTIAL；未生成验证已通过的证据。可用 /workflows status 查看详情。" |
| 1032 | 默认值使用硬编码中文 | medium | "- .linghun/agents 或 .linghun/workflows 下暂无自定义 agent/workflow" |
| 1120 | 默认值使用硬编码中文 | medium | "查看 /workflows registry、/background 或 /details background。" |
| 1159 | 默认值使用硬编码中文 | medium | "workflow 正在后台运行。可用 /background 查看详情。" |
| 1162 | void Promise(潜在rejection) | medium | void executeRegistryWorkflowRun(         workflow,         goal,         runId, ... |
| 1173 | void Promise(潜在rejection) | medium | void finishWorkflowRun(           runId,           "failed",           `Registry... |
| 1298 | 默认值使用硬编码中文 | medium | "workflow start gate 未确认；mutating registry step 需要明确的 /workflows run 调用" |
| 1319 | 默认值使用硬编码中文 | medium | "agent runtime 未启动；步骤正在等待 runtime/resource 可用" |
| 1375 | 默认值使用硬编码中文 | medium | "write registry step 需要 path 和 content；请在 step 定义中添加 path 和 content" |
| 1396 | 默认值使用硬编码中文 | medium | "         ? `completed via registry ${step.action}`         : `已通过 registry ${st... |
| 1425 | 默认值使用硬编码中文 | medium | ";   return `工作流步骤 ${stepId} ${statusText}：${detail}`; }  type WorkflowStepTermi... |
| 1539 | 默认值使用硬编码中文 | medium | "agent runtime 未启动；步骤正在等待 runtime/resource 可用" |
| 1553 | 默认值使用硬编码中文 | medium | "             ? `agent runtime ${agent.id} has no background task; treating step... |
| 1579 | 默认值使用硬编码中文 | medium | "权限管道拒绝" |
| 1623 | 默认值使用硬编码中文 | medium | "workflows start_gate 目前仅作为 proposal，无运行时执行路径" |
| 1683 | 默认值使用硬编码中文 | medium | "嵌套 job 未持久化 state" |
| 1724 | 默认值使用硬编码中文 | medium | "不支持嵌套 job 请求" |
| 1745 | 默认值使用硬编码中文 | medium | "         ? `completed via ${req.mainChain}`         : `已通过 ${req.mainChain} 完成`... |

### packages/tui/src/workflow-planner-entry.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 352 | 默认值使用硬编码中文 | medium | ",   });    return slices; }  function isComplexOrMultiSliceGoal(goal: string): ... |
| 403 | 默认值使用硬编码中文 | medium | "       ? `Workflow plan generation failed: ${result.reason}`       : `工作流计划生成失败... |
| 407 | 默认值使用硬编码中文 | medium | "工作流计划预览" |
| 415 | 默认值使用硬编码中文 | medium | "这只是预览。尚未开始执行。确认阶段停止点后才能继续。" |

### packages/tui/src/workflow-task-surface.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 255 | 默认值使用硬编码中文 | medium | "先处理受阻任务，再继续推进。" |
| 259 | 默认值使用硬编码中文 | medium | "确认阶段检查点后再开始执行。" |
| 264 | 默认值使用硬编码中文 | medium | "已有可执行提案，交给主流程继续处理。" |
| 268 | 默认值使用硬编码中文 | medium | "部分任务在排队等待执行窗口。" |
| 271 | 默认值使用硬编码中文 | medium | "先检查工作流计划，再决定是否执行。" |
| 294 | 默认值使用硬编码中文 | medium | ";   const impact = [     isZh ? `已完成 ${meta.slicesDone}` : `${meta.slicesDone} ... |
| 303 | 默认值使用硬编码中文 | medium | "需要用户确认" |
| 307 | 默认值使用硬编码中文 | medium | "有任务正在等待" |
| 310 | 默认值使用硬编码中文 | medium | "无需额外确认" |
| 311 | 默认值使用硬编码中文 | medium | ";   if (isZh) {     return [       `结果：${title} 当前${status}。`,       `影响：${meta... |
| 383 | 默认值使用硬编码中文 | medium | ") {     const lines = [       `工作流：${title}`,       `阶段：${meta.currentPhase}`, ... |
| 388 | 默认值使用硬编码中文 | medium | "}`,       `证据：${meta.evidenceCount}（${evidenceVerdict}）`,       `下一步：${meta.nex... |

### packages/tui/src/workspace-reference-cache.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 33 | 默认值使用硬编码中文 | medium | "];  // D.13V — `rescanned` 是 `stale` 的更准确语义命名（probe 失配后重新扫描得到的 // 新 confirmed 数... |
| 220 | 默认值使用硬编码中文 | medium | " 是历史命名，实际语义是" |
| 222 | 默认值使用硬编码中文 | medium | "。caller 应当把它当作" |
| 222 | 默认值使用硬编码中文 | medium | "，不要错把它当 stale     // file system data。新增 source 类型是公共 schema 改动；本阶段保留命名，     //... |
| 227 | 默认值使用硬编码中文 | medium | ",       createdAt: new Date().toISOString(),       changedKeys,       dimension... |
| 280 | 默认值使用硬编码中文 | medium | ");   }   // D.13V — 把 source 编码进 hash，让 fallback / fallback-stale / fallback-em... |

### apps/cli/src/cli.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 63 | export函数超过100行 | low | export async function runCli |
| 82 | if-elseif链无else兜底 | low | if (normalized[0] === "sessions") {     return runSessionsCommand(normalized.sli... |
| 340 | 魔法数字(轮次/计数) | low | 8) |
| 341 | 魔法数字(轮次/计数) | low | 3) |
| 341 | 魔法数字(轮次/计数) | low | 4) |
| 354 | if-elseif链无else兜底 | low | if (subcommand === "list") {       const sessions = await store.list();       if... |

### packages/config/src/index.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 250 | export函数超过100行 | low | export function isDefaultPlaceholderModel |
| 262 | export函数超过100行 | low | export function resolveModelSelection |
| 555 | 魔法数字(毫秒超时) | low | 5_000 |
| 556 | 魔法数字(MB/KB) | low | 4_096 |
| 631 | 魔法数字(毫秒超时) | low | 60_000 |
| 639 | export函数超过100行 | low | export function getUserConfigDir |
| 643 | export函数超过100行 | low | export function getProjectConfigDir |
| 647 | export函数超过100行 | low | export function getUserDataDir |
| 651 | export函数超过100行 | low | export function getSessionRootDir |
| 670 | export函数超过100行 | low | export function resolveStoragePaths |
| 737 | export函数超过100行 | low | export function createProjectDataNamespace |
| 753 | export函数超过100行 | low | export function getProjectSettingsPath |
| 757 | export函数超过100行 | low | export function getUserSettingsPath |
| 761 | export函数超过100行 | low | export function getProviderEnvPath |
| 765 | export函数超过100行 | low | export async function providerEnvExists |
| 774 | export函数超过100行 | low | export async function ensureProviderEnvTemplate |
| 795 | export函数超过100行 | low | export async function saveProviderEnvSetup |
| 846 | export函数超过100行 | low | export async function readProviderEnvValues |
| 852 | export函数超过100行 | low | export function validateProviderEnvSetup |
| 1165 | catch返回null/undefined | low | } catch {     return {};   } |
| 1189 | export函数超过100行 | low | export async function loadConfig |
| 1215 | export函数超过100行 | low | export async function saveDefaultModel |
| 1237 | export函数超过100行 | low | export async function saveModelRoute |
| 1259 | export函数超过100行 | low | export async function saveExtensionEnablement |
| 1283 | export函数超过100行 | low | export async function resetExtensionTrustForInstall |
| 1302 | export函数超过100行 | low | export async function saveMcpServerConfig |
| 1327 | export函数超过100行 | low | export async function removeMcpServerConfig |
| 1345 | export函数超过100行 | low | export async function saveWorkspaceTrust |
| 1364 | export函数超过100行 | low | export async function hasRecordedUserLanguage |
| 1368 | export函数超过100行 | low | export async function hasRecordedProjectLanguage |
| 1378 | export函数超过100行 | low | export async function saveUserLanguage |
| 1388 | export函数超过100行 | low | export async function saveProjectLanguage |
| 1398 | export函数超过100行 | low | export async function saveLanguage |
| 1885 | export函数超过100行 | low | export async function ensureConfigDirs |

### packages/core/src/index.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 39 | export函数超过100行 | low | export function createLogger |
| 41 | 魔法数字(轮次/计数) | low | 10, |
| 42 | 魔法数字(轮次/计数) | low | 20, |

### packages/core/src/jsonl.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 14 | export函数超过100行 | low | export async function appendJsonl |
| 19 | export函数超过100行 | low | export async function readJsonl |

### packages/core/src/project.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 11 | export函数超过100行 | low | export function identifyProject |
| 24 | export函数超过100行 | low | export function normalizeProjectPath |

### packages/core/src/session-store.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 23 | export函数超过100行 | low | export function assertValidSessionId |
| 199 | catch返回null/undefined | low | } catch {       return null;     } |
| 214 | catch返回空数组 | low | } catch {     return [];   } |

### packages/core/src/session.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 342 | export函数超过100行 | low | export function createEmptyCostSummary |
| 353 | export函数超过100行 | low | export function createEmptyCacheSummary |
| 362 | export函数超过100行 | low | export function computePromptCacheHitRate |

### packages/providers/src/index.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 365 | 魔法数字(轮次/计数) | low | 3; |
| 367 | 魔法数字(毫秒超时) | low | 30_000 |
| 368 | 魔法数字(毫秒超时) | low | 30_000 |
| 390 | 魔法数字(MB/KB) | low | 128_000 |
| 391 | 魔法数字(MB/KB) | low | 8_192 |
| 401 | 魔法数字(MB/KB) | low | 64_000 |
| 402 | 魔法数字(MB/KB) | low | 8_192 |
| 410 | export函数超过100行 | low | export function findKnownModel |
| 492 | export函数超过100行 | low | export function resolveProviderBaseUrlDiagnostic |
| 549 | export函数超过100行 | low | export function resolveAnthropicContextEditingDiagnostic |
| 612 | export函数超过100行 | low | export function joinBaseUrlAndEndpoint |
| 653 | 魔法数字(MB/KB) | low | 128_000 |
| 654 | 魔法数字(MB/KB) | low | 4_096 |
| 822 | export函数超过100行 | low | export function resolveProviderRuntimeContract |
| 964 | export函数超过100行 | low | export function resolveEffectiveEndpointProfile |
| 1174 | catch返回null/undefined | low | } catch {     return undefined;   } |
| 1548 | 魔法数字(MB/KB) | low | 4_096 |
| 1562 | 魔法数字(MB/KB) | low | 16_384 |
| 1623 | export函数超过100行 | low | export function repairToolMessagePairing |
| 2051 | if-elseif链无else兜底 | low | if (delta?.type === "signature_delta") {       return [];     }     if (delta?.t... |
| 2481 | if-elseif链无else兜底 | low | if (typeof usage.prompt_tokens_details?.cache_creation_tokens === "number") {   ... |
| 2505 | export函数超过100行 | low | export function normalizeProviderError |
| 2510 | if-elseif链无else兜底 | low | if (status === 401 \|\| status === 403) {     return createApiKeyError(status, err... |
| 2588 | 魔法数字(轮次/计数) | low | 8, |
| 2601 | TuiContext直接字段修改 | low | context.endpointProfile = |
| 2743 | if-elseif链无else兜底 | low | if (typeof candidate.status === "number") {     return candidate.status;   }   i... |

### packages/shared/src/index.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 13 | export函数超过100行 | low | export function normalizeDeepSeekModelName |
| 17 | export函数超过100行 | low | export function isDeepSeekApiModel |
| 27 | export函数超过100行 | low | export function normalizePermissionMode |
| 34 | export函数超过100行 | low | export function isRawPermissionMode |
| 47 | export函数超过100行 | low | export function normalizePathSeparators |
| 51 | export函数超过100行 | low | export function canonicalPathForCompare |
| 59 | export函数超过100行 | low | export function isPathInside |

### packages/tools/src/index.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 127 | 魔法数字(轮次/计数) | low | 200; |
| 128 | 魔法数字(轮次/计数) | low | 100; |
| 131 | 魔法数字(毫秒超时) | low | 120_000 |
| 132 | 魔法数字(轮次/计数) | low | 100; |
| 140 | 魔法数字(毫秒超时) | low | 30_000 |
| 142 | export函数超过100行 | low | export function createToolContext |
| 165 | export函数超过100行 | low | export async function runTool |
| 413 | if-elseif链无else兜底 | low | if (value === undefined) {     return undefined;   }   if (typeof value !== "str... |
| 702 | 魔法数字(轮次/计数) | low | 4) |
| 789 | export函数超过100行 | low | export function adaptShellCommand |
| 793 | export函数超过100行 | low | export function adaptShellCommandForPlatform |
| 827 | 魔法数字(轮次/计数) | low | 4] |
| 870 | 魔法数字(轮次/计数) | low | 10) |
| 885 | 魔法数字(轮次/计数) | low | 10) |
| 897 | 魔法数字(轮次/计数) | low | 10) |
| 910 | 魔法数字(轮次/计数) | low | 10) |
| 1086 | TuiContext直接字段修改 | low | context.todos.push( |
| 1191 | TuiContext直接字段修改 | low | context.changedFiles =  |
| 1254 | TuiContext直接字段修改 | low | context.readSnapshots =  |
| 1271 | TuiContext直接字段修改 | low | context.patchSummaries =  |
| 1353 | 魔法数字(轮次/计数) | low | 12; |
| 1423 | catch返回null/undefined | low | } catch {     return null;   } |
| 1450 | 魔法数字(轮次/计数) | low | 4) |
| 1764 | 魔法数字(轮次/计数) | low | 50) |

### packages/tui/src/agent-workflow-registry.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 42 | export函数超过100行 | low | export async function loadAgentRegistry |
| 48 | export函数超过100行 | low | export async function loadWorkflowRegistry |
| 54 | export函数超过100行 | low | export function registryAgentToWorkflowTemplate |
| 67 | export函数超过100行 | low | export function registryWorkflowToTemplate |

### packages/tui/src/architecture-boundary.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 122 | 魔法数字(轮次/计数) | low | 200, |
| 123 | 魔法数字(轮次/计数) | low | 4, |
| 129 | 魔法数字(轮次/计数) | low | 3; |
| 140 | export函数超过100行 | low | export function detectBashFileWriteTargets |
| 145 | 魔法数字(轮次/计数) | low | 3] |
| 166 | 魔法数字(轮次/计数) | low | 3, |
| 167 | 魔法数字(轮次/计数) | low | 4, |
| 168 | 魔法数字(轮次/计数) | low | 5, |
| 179 | export函数超过100行 | low | export function checkFileBoundaries |
| 268 | export函数超过100行 | low | export function detectCrossLayerImports |
| 301 | export函数超过100行 | low | export function detectCircularDependencyRisk |
| 332 | export函数超过100行 | low | export function checkBoundaries |
| 360 | export函数超过100行 | low | export function validateChangeDeclaration |
| 394 | export函数超过100行 | low | export function checkBoundaryEditPreflight |
| 444 | export函数超过100行 | low | export function formatBoundaryViolations |
| 457 | 魔法数字(轮次/计数) | low | 5) |
| 460 | 魔法数字(轮次/计数) | low | 5) |
| 461 | 魔法数字(轮次/计数) | low | 5} |
| 476 | export函数超过100行 | low | export function estimateFileMetrics |
| 565 | 魔法数字(轮次/计数) | low | 10) |
| 576 | 魔法数字(轮次/计数) | low | 10) |
| 606 | if-elseif链无else兜底 | low | if (typeof input !== "object" \|\| input === null) {     return 0;   }   if (toolN... |
| 639 | if-elseif链无else兜底 | low | if (estimatedAddedLines >= SUBSTANTIAL_ADDED_LINES) {     return true;   }   if ... |

### packages/tui/src/architecture-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 61 | 魔法数字(轮次/计数) | low | 20} |
| 78 | export函数超过100行 | low | export function shouldTriggerArchitectureRuntime |
| 95 | export函数超过100行 | low | export function collectArchitectureFacts |
| 100 | 魔法数字(轮次/计数) | low | 3) |
| 140 | 魔法数字(轮次/计数) | low | 5) |
| 143 | export函数超过100行 | low | export function createArchitectureCard |
| 181 | export函数超过100行 | low | export function formatArchitectureCard |
| 195 | export函数超过100行 | low | export function summarizeArchitectureCard |
| 198 | 魔法数字(轮次/计数) | low | 3) |
| 200 | 魔法数字(轮次/计数) | low | 3) |
| 201 | 魔法数字(轮次/计数) | low | 3) |
| 202 | 魔法数字(轮次/计数) | low | 4) |
| 206 | export函数超过100行 | low | export function createArchitectureRuntimeDirective |
| 225 | export函数超过100行 | low | export function detectArchitectureDrift |
| 246 | 魔法数字(轮次/计数) | low | 3) |
| 252 | 魔法数字(轮次/计数) | low | 8} |
| 412 | 魔法数字(轮次/计数) | low | 12} |
| 415 | 魔法数字(轮次/计数) | low | 12} |
| 415 | 魔法数字(轮次/计数) | low | 12} |

### packages/tui/src/background-control-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 59 | export函数超过100行 | low | export async function startRunnerForDurableJob |
| 66 | export函数超过100行 | low | export function refreshRunnerStatusForJob |
| 70 | export函数超过100行 | low | export async function stopRunnerForDurableJob |
| 84 | export函数超过100行 | low | export function refreshBackgroundLifecycle |
| 100 | TuiContext直接字段修改 | low | context.language = |
| 115 | export函数超过100行 | low | export function checkResourceGuard |
| 155 | export函数超过100行 | low | export function checkBackgroundStartGuard |
| 169 | export函数超过100行 | low | export function finishBackgroundTaskFromToolOutput |
| 181 | TuiContext直接字段修改 | low | context.language = |
| 185 | TuiContext直接字段修改 | low | context.language = |
| 189 | TuiContext直接字段修改 | low | context.language = |
| 193 | TuiContext直接字段修改 | low | context.language = |
| 203 | TuiContext直接字段修改 | low | context.language = |
| 206 | TuiContext直接字段修改 | low | context.language = |
| 211 | TuiContext直接字段修改 | low | context.language = |
| 214 | TuiContext直接字段修改 | low | context.language = |
| 219 | export函数超过100行 | low | export function updateCommandPanelSelection |
| 226 | 魔法数字(轮次/计数) | low | 8; |
| 234 | TuiContext直接字段修改 | low | context.commandPanelState =  |
| 237 | export函数超过100行 | low | export function toggleCommandPanelSelection |
| 240 | TuiContext直接字段修改 | low | context.commandPanelState =  |
| 243 | export函数超过100行 | low | export function __testUpdateCommandPanelSelection |
| 247 | export函数超过100行 | low | export function __testToggleCommandPanelSelection |
| 251 | export函数超过100行 | low | export async function stopCommandPanelSelection |
| 275 | export函数超过100行 | low | export async function __testStopCommandPanelSelection |
| 291 | TuiContext直接字段修改 | low | context.language = |
| 302 | TuiContext直接字段修改 | low | context.activeVerificationAbortController =  |
| 303 | TuiContext直接字段修改 | low | context.interrupt =  |
| 330 | TuiContext直接字段修改 | low | context.language = |
| 333 | TuiContext直接字段修改 | low | context.language = |
| 340 | TuiContext直接字段修改 | low | context.language = |
| 343 | TuiContext直接字段修改 | low | context.language = |
| 350 | export函数超过100行 | low | export async function __testStopSingleBackgroundTask |
| 358 | export函数超过100行 | low | export async function handleInterruptCommand |
| 375 | TuiContext直接字段修改 | low | context.language = |
| 387 | export函数超过100行 | low | export async function interruptAllActiveWork |
| 407 | TuiContext直接字段修改 | low | context.activeVerificationAbortController =  |
| 410 | TuiContext直接字段修改 | low | context.interrupt =  |
| 419 | TuiContext直接字段修改 | low | context.language = |
| 428 | TuiContext直接字段修改 | low | context.activeAbortController =  |
| 430 | TuiContext直接字段修改 | low | context.interrupt =  |
| 437 | TuiContext直接字段修改 | low | context.activeBtwAbortController =  |
| 439 | TuiContext直接字段修改 | low | context.btwPanelState =  |
| 442 | TuiContext直接字段修改 | low | context.language = |
| 462 | TuiContext直接字段修改 | low | context.language = |
| 501 | TuiContext直接字段修改 | low | context.language = |
| 504 | TuiContext直接字段修改 | low | context.language = |

### packages/tui/src/break-cache-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 16 | 魔法数字(轮次/计数) | low | 200; |
| 74 | catch返回空数组 | low | } catch {     return [];   } |
| 79 | export函数超过100行 | low | export async function appendBreakCacheEvent |
| 121 | export函数超过100行 | low | export async function writeBreakCacheMarker |
| 131 | export函数超过100行 | low | export async function clearBreakCacheMarker |
| 235 | export函数超过100行 | low | export async function buildPromptCacheRequestFields |
| 252 | export函数超过100行 | low | export function formatBreakCacheStatus |
| 262 | 魔法数字(轮次/计数) | low | 3) |
| 278 | 魔法数字(轮次/计数) | low | 8) |

### packages/tui/src/btw-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 48 | export函数超过100行 | low | export function buildBtwMessages |
| 59 | export函数超过100行 | low | export function classifyBtwIntent |
| 60 | if-elseif链无else兜底 | low | if (intent.runtimeIntent?.kind === "runtime_status_query") {     return "status_... |
| 73 | export函数超过100行 | low | export function extractBtwResult |
| 102 | export函数超过100行 | low | export async function runBtwSideQuestion |

### packages/tui/src/cache-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 19 | export函数超过100行 | low | export function buildCacheStatusPanel |
| 23 | TuiContext直接字段修改 | low | context.language = |
| 30 | 魔法数字(轮次/计数) | low | 100) |
| 33 | 魔法数字(轮次/计数) | low | 3; |
| 51 | export函数超过100行 | low | export function formatCacheLog |
| 71 | export函数超过100行 | low | export function formatCacheStatus |
| 97 | export函数超过100行 | low | export function formatWorkspaceSnapshotLiteStatus |
| 108 | export函数超过100行 | low | export function formatCompactStatus |
| 125 | 魔法数字(轮次/计数) | low | 4) |
| 126 | 魔法数字(轮次/计数) | low | 4) |
| 146 | export函数超过100行 | low | export function collectLightHints |
| 158 | 魔法数字(轮次/计数) | low | 10, |
| 159 | TuiContext直接字段修改 | low | context.language = |
| 171 | 魔法数字(轮次/计数) | low | 4, |
| 172 | TuiContext直接字段修改 | low | context.language = |
| 185 | TuiContext直接字段修改 | low | context.language = |
| 202 | 魔法数字(轮次/计数) | low | 8, |
| 203 | TuiContext直接字段修改 | low | context.language = |
| 213 | export函数超过100行 | low | export function createLightHint |
| 231 | export函数超过100行 | low | export function writeLightHints |
| 246 | TuiContext直接字段修改 | low | context.notifications =  |
| 250 | TuiContext直接字段修改 | low | context.notifications.push( |
| 261 | export函数超过100行 | low | export function formatPlainLightHint |
| 285 | export函数超过100行 | low | export function writeLightHintsForTest |

### packages/tui/src/cache-freshness.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 5 | export函数超过100行 | low | export function stableHash |
| 6 | 魔法数字(轮次/计数) | low | 12) |
| 9 | export函数超过100行 | low | export function stableStringify |
| 22 | export函数超过100行 | low | export function createCacheFreshness |
| 70 | export函数超过100行 | low | export function diffFreshness |
| 97 | export函数超过100行 | low | export function createConfigFreshnessSummary |

### packages/tui/src/capability-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 108 | export函数超过100行 | low | export function registerCapability |
| 118 | export函数超过100行 | low | export function unregisterCapabilitiesByApp |
| 135 | export函数超过100行 | low | export function listCapabilities |
| 143 | export函数超过100行 | low | export function findCapability |
| 150 | export函数超过100行 | low | export function resolveCapabilityConnection |
| 178 | export函数超过100行 | low | export async function executeCapability |
| 288 | export函数超过100行 | low | export function formatCapabilityDoctor |
| 307 | export函数超过100行 | low | export function registerCapabilityProvider |
| 311 | export函数超过100行 | low | export function setCapabilityConnectionResolver |
| 320 | export函数超过100行 | low | export function formatCapabilityList |
| 330 | export函数超过100行 | low | export function formatCapabilityResult |
| 368 | export函数超过100行 | low | export async function handleCapabilitiesCommand |
| 568 | 魔法数字(毫秒超时) | low | 60_000 |

### packages/tui/src/command-panel-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 13 | TuiContext直接字段修改 | low | context.isInkSession = |
| 31 | export函数超过100行 | low | export function buildExplicitDetailsCommandPanel |
| 34 | TuiContext直接字段修改 | low | context.language = |
| 81 | 魔法数字(轮次/计数) | low | 8) |
| 86 | 魔法数字(轮次/计数) | low | 8) |
| 88 | 魔法数字(轮次/计数) | low | 8} |
| 88 | 魔法数字(轮次/计数) | low | 8} |
| 108 | 魔法数字(轮次/计数) | low | 8) |
| 113 | 魔法数字(轮次/计数) | low | 8) |
| 115 | 魔法数字(轮次/计数) | low | 8} |
| 115 | 魔法数字(轮次/计数) | low | 8} |
| 261 | export函数超过100行 | low | export function showCommandPanel |
| 267 | TuiContext直接字段修改 | low | context.commandPanelState =  |
| 297 | export函数超过100行 | low | export function getCommandPanelRowText |
| 301 | export函数超过100行 | low | export function getCommandPanelSelectableRows |

### packages/tui/src/compact-cache-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 109 | export函数超过100行 | low | export async function handleClaimCheckCommand |
| 131 | export函数超过100行 | low | export async function handleCacheLogCommand |
| 137 | 魔法数字(轮次/计数) | low | 10) |
| 208 | export函数超过100行 | low | export async function handleCacheCommand |
| 214 | if-elseif链无else兜底 | low | if (!action \|\| action === "status") {     // D.13Q-UX Task Surface — /cache 默认走降... |
| 239 | export函数超过100行 | low | export async function handleCompactCommand |
| 245 | if-elseif链无else兜底 | low | if (action === "status") {     await refreshCompactPressureSnapshot(context);   ... |
| 257 | TuiContext直接字段修改 | low | context.language = |
| 294 | export函数超过100行 | low | export async function refreshCompactPressureSnapshot |
| 327 | 魔法数字(轮次/计数) | low | 3) |
| 327 | toFixed未检查NaN | low | ratio: Number((estimatedChars / Math.max(1, maxChars)).toFixed(3)), |
| 336 | export函数超过100行 | low | export async function handleBreakCacheCommand |
| 345 | if-elseif链无else兜底 | low | if (action === "status" && !clearFlag) {     writeLine(output, formatBreakCacheS... |
| 383 | export函数超过100行 | low | export async function requestBreakCacheMutationApproval |
| 408 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 437 | TuiContext直接字段修改 | low | context.language = |
| 450 | export函数超过100行 | low | export async function executeBreakCacheMutation |
| 499 | export函数超过100行 | low | export function recordModelUsage |
| 542 | export函数超过100行 | low | export async function appendUsageEvents |
| 552 | export函数超过100行 | low | export function refreshCacheFreshness |
| 560 | export函数超过100行 | low | export async function requestMemoryMutationApproval |
| 582 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 611 | TuiContext直接字段修改 | low | context.language = |
| 653 | export函数超过100行 | low | export async function recordMemoryMutationEvidence |
| 673 | export函数超过100行 | low | export async function recordBreakCacheMutationEvidence |
| 710 | if-elseif链无else兜底 | low | if (usage.cacheWriteTokensRaw === null) {     return "missing";   }   if (typeof... |
| 716 | if-elseif链无else兜底 | low | if (usage.cacheWriteTokensEstimated && typeof usage.cacheWriteTokens === "number... |
| 731 | export函数超过100行 | low | export async function refreshWorkspaceReferenceCache |
| 774 | export函数超过100行 | low | export function getCurrentFreshness |
| 781 | TuiContext直接字段修改 | low | context.language = |

### packages/tui/src/compact-context.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 33 | export函数超过100行 | low | export function microCompactMessages |
| 101 | export函数超过100行 | low | export function compactMessagesToFit |
| 117 | export函数超过100行 | low | export function createManualCompactBoundary |
| 137 | export函数超过100行 | low | export function compactBoundaryHash |
| 151 | export函数超过100行 | low | export function estimateModelMessagesChars |
| 177 | 魔法数字(轮次/计数) | low | 4; |
| 196 | 魔法数字(轮次/计数) | low | 8; |
| 275 | 魔法数字(轮次/计数) | low | 20) |
| 279 | 魔法数字(轮次/计数) | low | 4) |
| 288 | 魔法数字(轮次/计数) | low | 12) |

### packages/tui/src/compact-preflight-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 58 | 魔法数字(轮次/计数) | low | 12; |
| 59 | 魔法数字(MB/KB) | low | 128_000 |
| 60 | 魔法数字(MB/KB) | low | 8_192 |
| 61 | 魔法数字(轮次/计数) | low | 4; |
| 63 | 魔法数字(毫秒超时) | low | 30_000 |
| 71 | 魔法数字(轮次/计数) | low | 20; |
| 73 | export函数超过100行 | low | export async function prepareMessagesForProviderPreflight |
| 100 | TuiContext直接字段修改 | low | context.language = |
| 129 | TuiContext直接字段修改 | low | context.language = |
| 188 | TuiContext直接字段修改 | low | context.language = |
| 202 | TuiContext直接字段修改 | low | context.language = |
| 218 | TuiContext直接字段修改 | low | context.language = |
| 247 | export函数超过100行 | low | export function recordCompactBoundary |
| 261 | if-elseif链无else兜底 | low | if (contextWindowTokens >= HUGE_CONTEXT_WINDOW_TOKENS) {     return HUGE_CONTEXT... |
| 270 | export函数超过100行 | low | export function getAutoCompactTriggerChars |
| 280 | export函数超过100行 | low | export function inspectToolPairingSafety |
| 342 | 魔法数字(轮次/计数) | low | 5) |
| 350 | 魔法数字(轮次/计数) | low | 5) |
| 358 | 魔法数字(轮次/计数) | low | 5) |
| 366 | 魔法数字(轮次/计数) | low | 5) |
| 377 | 魔法数字(轮次/计数) | low | 3) |
| 379 | 魔法数字(轮次/计数) | low | 100) |
| 381 | 魔法数字(轮次/计数) | low | 8) |
| 384 | 魔法数字(轮次/计数) | low | 8) |
| 385 | 魔法数字(轮次/计数) | low | 8) |
| 386 | 魔法数字(轮次/计数) | low | 8) |
| 390 | 魔法数字(轮次/计数) | low | 12) |
| 406 | 魔法数字(轮次/计数) | low | 3) |
| 430 | 魔法数字(轮次/计数) | low | 3) |
| 430 | toFixed未检查NaN | low | pressureRatio: Number((preCompactChars / Math.max(1, input.contextMaxChars)).toF |
| 440 | export函数超过100行 | low | export function sanitizeCompactSummaryText |
| 529 | export函数超过100行 | low | export function getProviderContextMaxChars |

### packages/tui/src/connector-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 83 | 魔法数字(毫秒超时) | low | 5_000 |
| 95 | export函数超过100行 | low | export function listAppConnectors |
| 99 | export函数超过100行 | low | export async function connectAppConnector |
| 161 | export函数超过100行 | low | export function disconnectAppConnector |
| 169 | export函数超过100行 | low | export function formatAppConnectorList |
| 175 | export函数超过100行 | low | export function formatAppConnectorDoctor |
| 199 | export函数超过100行 | low | export async function handleAppsCommand |
| 726 | catch返回null/undefined | low | } catch {     return undefined;   } |

### packages/tui/src/context-estimator.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 9 | export函数超过100行 | low | export function estimateValueChars |
| 10 | 魔法数字(轮次/计数) | low | 4; |
| 13 | 魔法数字(轮次/计数) | low | 8) |
| 24 | 魔法数字(轮次/计数) | low | 3; |
| 29 | 魔法数字(轮次/计数) | low | 8; |
| 33 | export函数超过100行 | low | export function estimateToolCallsCharsLocal |
| 46 | export函数超过100行 | low | export function estimateModelMessageChars |
| 55 | export函数超过100行 | low | export function estimateTranscriptContextChars |

### packages/tui/src/deep-compact-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 45 | export函数超过100行 | low | export async function maybeRunDeepCompactBeforeProvider |
| 69 | export函数超过100行 | low | export async function runDeepCompact |
| 170 | export函数超过100行 | low | export function shouldRunDeepCompact |
| 175 | if-elseif链无else兜底 | low | if (trigger === "manual" \|\| trigger === "workflow") {     return true;   }   if ... |
| 193 | export函数超过100行 | low | export function formatDeepCompactPromptSummary |
| 218 | export函数超过100行 | low | export function injectDeepCompactSummary |
| 234 | export函数超过100行 | low | export function createDeepCompactPacket |
| 243 | 魔法数字(轮次/计数) | low | 8) |
| 251 | 魔法数字(轮次/计数) | low | 20) |
| 260 | 魔法数字(轮次/计数) | low | 20) |
| 275 | export函数超过100行 | low | export function isDeepCompactPacket |
| 311 | 魔法数字(轮次/计数) | low | 5) |
| 380 | 魔法数字(轮次/计数) | low | 20) |
| 381 | 魔法数字(轮次/计数) | low | 20) |
| 382 | 魔法数字(轮次/计数) | low | 20) |
| 383 | 魔法数字(轮次/计数) | low | 20) |
| 384 | 魔法数字(轮次/计数) | low | 20) |
| 487 | 魔法数字(轮次/计数) | low | 3) |
| 570 | 魔法数字(轮次/计数) | low | 5) |
| 580 | export函数超过100行 | low | export function sanitizeDeepCompactText |
| 614 | 魔法数字(轮次/计数) | low | 12) |
| 631 | 魔法数字(轮次/计数) | low | 12) |
| 648 | 魔法数字(轮次/计数) | low | 12) |
| 668 | 魔法数字(轮次/计数) | low | 8) |
| 681 | 魔法数字(轮次/计数) | low | 5) |
| 724 | TuiContext直接字段修改 | low | context.language = |

### packages/tui/src/deferred-tools-catalog.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 26 | export函数超过100行 | low | export function getCodebaseMemoryToolRisk |
| 30 | export函数超过100行 | low | export function validateCodebaseMemoryToolExecution |
| 149 | export函数超过100行 | low | export function isLocalStdioMcpServer |
| 229 | export函数超过100行 | low | export function listDeferredTools |
| 238 | export函数超过100行 | low | export function snapshotDeferredTools |
| 261 | export函数超过100行 | low | export function snapshotDeferredToolsSummary |
| 293 | export函数超过100行 | low | export function sanitizeDiscoveredDeferredToolName |
| 300 | export函数超过100行 | low | export function snapshotDiscoveredDeferredToolsSummary |
| 315 | export函数超过100行 | low | export function searchDeferredTools |
| 327 | export函数超过100行 | low | export function findDeferredTool |
| 335 | export函数超过100行 | low | export function deferredToolListHashInput |
| 347 | export函数超过100行 | low | export function formatDeferredToolsSystemReminder |
| 357 | export函数超过100行 | low | export function isCodebaseMemoryToolName |
| 361 | export函数超过100行 | low | export function summarizeDeferredToolMatch |
| 374 | export函数超过100行 | low | export function parseMcpDeferredToolName |
| 378 | 魔法数字(轮次/计数) | low | 4) |

### packages/tui/src/details-status-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 32 | export函数超过100行 | low | export async function handleDetailsCommand |
| 39 | TuiContext直接字段修改 | low | context.suppressLastFullOutputCapture =  |
| 43 | TuiContext直接字段修改 | low | context.suppressLastFullOutputCapture =  |
| 54 | if-elseif链无else兜底 | low | if (action === "evidence") {     const evidence = findEvidence(context, id);    ... |
| 122 | TuiContext直接字段修改 | low | context.language = |
| 129 | export函数超过100行 | low | export function formatHomeScreen |
| 133 | TuiContext直接字段修改 | low | context.language = |
| 151 | export函数超过100行 | low | export async function ensureSession |
| 153 | TuiContext直接字段修改 | low | context.sessionStoreVerifiedId = |
| 154 | TuiContext直接字段修改 | low | context.sessionEnded =  |
| 159 | TuiContext直接字段修改 | low | context.sessionStoreVerifiedId =  |
| 160 | TuiContext直接字段修改 | low | context.sessionEnded =  |
| 166 | TuiContext直接字段修改 | low | context.sessionId =  |
| 171 | TuiContext直接字段修改 | low | context.sessionId =  |
| 172 | TuiContext直接字段修改 | low | context.sessionStoreVerifiedId =  |
| 173 | TuiContext直接字段修改 | low | context.sessionEnded =  |
| 188 | export函数超过100行 | low | export function createSilentOutput |
| 196 | export函数超过100行 | low | export function formatShellBackgroundSummaries |
| 218 | export函数超过100行 | low | export function writeStatus |
| 230 | TuiContext直接字段修改 | low | context.language = |
| 246 | export函数超过100行 | low | export function t |
| 258 | export函数超过100行 | low | export function createUserMessageEvent |
| 267 | export函数超过100行 | low | export function createSessionEndEvent |
| 281 | export函数超过100行 | low | export function __testCreateShellBlockOutput |
| 303 | export函数超过100行 | low | export function __testBuildExplicitDetailsCommandPanel |
| 314 | export函数超过100行 | low | export function __testCreateVerificationLevelForReadiness |

### packages/tui/src/evidence-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 39 | export函数超过100行 | low | export function createEvidenceRecord |
| 55 | export函数超过100行 | low | export function rememberEvidence |
| 56 | TuiContext直接字段修改 | low | context.evidence.unshift( |
| 57 | TuiContext直接字段修改 | low | context.evidence =  |
| 60 | export函数超过100行 | low | export function pickEvidence |
| 71 | export函数超过100行 | low | export function truncateRoundAssistantForProvider |
| 80 | TuiContext直接字段修改 | low | context.language = |
| 86 | export函数超过100行 | low | export async function recordProviderFailureEvidence |
| 112 | TuiContext直接字段修改 | low | context.lastProviderFailure =  |
| 140 | export函数超过100行 | low | export async function recordModelToolFailureForMetaScheduler |
| 175 | export函数超过100行 | low | export function sanitizeProviderFailureError |
| 186 | export函数超过100行 | low | export function sanitizeProviderFailureText |
| 195 | export函数超过100行 | low | export async function recordToolFailureEvidence |
| 215 | export函数超过100行 | low | export async function captureFailureLearning |
| 220 | TuiContext直接字段修改 | low | context.lastMetaSchedulerFailureLearningFulfilled =  |
| 222 | TuiContext直接字段修改 | low | context.lastToolFailure =  |
| 247 | export函数超过100行 | low | export async function recordArchitectureRuntimeCard |
| 254 | TuiContext直接字段修改 | low | context.language = |
| 278 | export函数超过100行 | low | export async function recordToolEvidence |
| 310 | export函数超过100行 | low | export async function recordVerificationEvidence |
| 377 | export函数超过100行 | low | export async function recordToolResultBudgetEvidence |
| 407 | export函数超过100行 | low | export async function appendBackgroundTaskEvent |
| 419 | export函数超过100行 | low | export async function appendSystemEvent |
| 434 | export函数超过100行 | low | export async function appendRouteDecisionEvent |
| 447 | export函数超过100行 | low | export function createToolEndEvent |
| 493 | export函数超过100行 | low | export function compactToolOutputForTranscript |
| 540 | export函数超过100行 | low | export function isToolOutputFailure |
| 548 | export函数超过100行 | low | export async function appendDerivedToolEvents |
| 574 | export函数超过100行 | low | export function getToolResultBudgetState |
| 579 | export函数超过100行 | low | export async function appendDeferredToolResultEvent |
| 605 | export函数超过100行 | low | export async function appendToolResultEvent |
| 631 | export函数超过100行 | low | export async function budgetToolResultTranscriptContent |
| 661 | catch返回null/undefined | low | } catch {     return null;   } |

### packages/tui/src/extension-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 35 | export函数超过100行 | low | export function formatConfigOverview |
| 36 | TuiContext直接字段修改 | low | context.language = |
| 103 | export函数超过100行 | low | export function formatFeaturePolicy |
| 130 | export函数超过100行 | low | export function formatSkills |
| 158 | export函数超过100行 | low | export function createSkillEvolutionCandidate |
| 175 | export函数超过100行 | low | export function formatWorkflows |
| 176 | TuiContext直接字段修改 | low | context.language = |
| 197 | export函数超过100行 | low | export function formatPlugins |
| 221 | export函数超过100行 | low | export function formatPluginsDoctor |
| 236 | export函数超过100行 | low | export function formatHooksDoctor |
| 260 | export函数超过100行 | low | export function formatTrustNotice |
| 279 | export函数超过100行 | low | export function formatExtensionStatus |
| 300 | export函数超过100行 | low | export function parseExtensionInstallRequest |
| 353 | export函数超过100行 | low | export function isGitLocator |
| 357 | export函数超过100行 | low | export function formatExtensionInstallGate |
| 375 | export函数超过100行 | low | export function formatExtensionInstallExactCommand |
| 393 | export函数超过100行 | low | export async function installExtensionFromRequest |
| 408 | TuiContext直接字段修改 | low | context.config =  |
| 432 | 魔法数字(毫秒超时) | low | 60_000 |
| 440 | 魔法数字(毫秒超时) | low | 10_000 |
| 448 | TuiContext直接字段修改 | low | context.config =  |
| 456 | export函数超过100行 | low | export function githubRepoToUrl |
| 466 | export函数超过100行 | low | export function getExtensionTargetDir |
| 477 | export函数超过100行 | low | export async function installExtensionFromDirectory |
| 509 | export函数超过100行 | low | export async function readExtensionSourceManifest |
| 569 | export函数超过100行 | low | export async function refreshExtensionState |
| 574 | TuiContext直接字段修改 | low | context.skills =  |
| 577 | TuiContext直接字段修改 | low | context.plugins =  |
| 578 | TuiContext直接字段修改 | low | context.hooks =  |
| 581 | export函数超过100行 | low | export async function removeExtension |
| 594 | TuiContext直接字段修改 | low | context.config =  |
| 599 | export函数超过100行 | low | export async function updateExtension |
| 632 | export函数超过100行 | low | export function validateExtensionItems |
| 659 | export函数超过100行 | low | export function validateExtensionContributionExecution |

### packages/tui/src/extension-slash-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 35 | export函数超过100行 | low | export function configureExtensionSlashRuntime |
| 46 | export函数超过100行 | low | export async function handleSkillsCommand |
| 54 | TuiContext直接字段修改 | low | context.language = |
| 85 | TuiContext直接字段修改 | low | context.language = |
| 127 | TuiContext直接字段修改 | low | context.skills =  |
| 138 | TuiContext直接字段修改 | low | context.language = |
| 266 | TuiContext直接字段修改 | low | context.config =  |
| 272 | TuiContext直接字段修改 | low | context.skills =  |
| 285 | export函数超过100行 | low | export async function handlePluginsCommand |
| 293 | TuiContext直接字段修改 | low | context.language = |
| 324 | TuiContext直接字段修改 | low | context.language = |
| 366 | TuiContext直接字段修改 | low | context.plugins =  |
| 367 | TuiContext直接字段修改 | low | context.hooks =  |
| 378 | TuiContext直接字段修改 | low | context.language = |
| 433 | TuiContext直接字段修改 | low | context.config =  |
| 439 | TuiContext直接字段修改 | low | context.plugins =  |
| 440 | TuiContext直接字段修改 | low | context.hooks =  |

### packages/tui/src/failure-learning-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 33 | export函数超过100行 | low | export function configureFailureLearningCommandRuntime |
| 50 | TuiContext直接字段修改 | low | context.language = |
| 88 | export函数超过100行 | low | export async function handleFailuresCommand |
| 94 | if-elseif链无else兜底 | low | if (action === "status" \|\| action === "list") {     showCommandPanel(       cont... |
| 112 | TuiContext直接字段修改 | low | context.language = |

### packages/tui/src/failure-learning-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 39 | export函数超过100行 | low | export function buildFailureLearningPanel |
| 60 | 魔法数字(轮次/计数) | low | 3) |
| 89 | export函数超过100行 | low | export function formatFailureLearningDetails |
| 117 | 魔法数字(轮次/计数) | low | 20) |

### packages/tui/src/failure-learning-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 35 | 魔法数字(轮次/计数) | low | 100; |
| 36 | 魔法数字(轮次/计数) | low | 200; |
| 40 | 魔法数字(轮次/计数) | low | 5; |
| 46 | export函数超过100行 | low | export function sanitizeFailureText |
| 50 | 魔法数字(轮次/计数) | low | 20, |
| 71 | export函数超过100行 | low | export function sanitizeRelatedTarget |
| 84 | export函数超过100行 | low | export function resolveFailureProjectScope |
| 97 | export函数超过100行 | low | export function getFailureLearningDirectory |
| 103 | export函数超过100行 | low | export function failureDedupeHash |
| 133 | export函数超过100行 | low | export function createFailureLearningState |
| 147 | export函数超过100行 | low | export function buildFailureRecord |
| 183 | export函数超过100行 | low | export function mergeFailureRecord |
| 210 | export函数超过100行 | low | export async function writeFailureRecord |
| 230 | export函数超过100行 | low | export async function removeFailureRecordFile |
| 269 | export函数超过100行 | low | export async function loadFailureRecords |
| 299 | export函数超过100行 | low | export function recordFailureLearningDegradedWarning |
| 308 | 魔法数字(轮次/计数) | low | 5) |
| 311 | export函数超过100行 | low | export function findFailureRecord |
| 319 | 魔法数字(轮次/计数) | low | 3, |
| 322 | export函数超过100行 | low | export function selectActiveLessons |
| 338 | export函数超过100行 | low | export function buildFailureLearningSummaryForPrompt |
| 360 | export函数超过100行 | low | export function setFailureRecordStatus |

### packages/tui/src/feishu-long-connection-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 20 | export函数超过100行 | low | export async function startFeishuLongConnection |

### packages/tui/src/final-answer-gate.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 14 | export函数超过100行 | low | export function needsSolutionCompletenessReportClosure |
| 26 | export函数超过100行 | low | export function runArchitectureAndCompletenessFinalGate |
| 68 | export函数超过100行 | low | export function formatSolutionCompletenessReportBlock |
| 90 | export函数超过100行 | low | export function createHandoffPendingItems |
| 94 | export函数超过100行 | low | export function createHandoffRiskItems |
| 98 | export函数超过100行 | low | export function createPhase15BetaVerdictScope |
| 212 | if-elseif链无else兜底 | low | if (event.type === "verification_end") {       return (         event.report.sta... |
| 236 | export函数超过100行 | low | export function checkClaimSupport |
| 347 | export函数超过100行 | low | export function formatClaimCheck |

### packages/tui/src/git-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 37 | export函数超过100行 | low | export async function handleGitCommand |
| 60 | export函数超过100行 | low | export async function handleWorktreeCommand |
| 67 | if-elseif链无else兜底 | low | if (action === "create") {     await runWorktreeCreateSlash(args.slice(1), conte... |
| 78 | export函数超过100行 | low | export async function handleCheckpointCommand |
| 85 | if-elseif链无else兜底 | low | if (action === "create") {     // /checkpoint create 与 /git stable create 同义：先 s... |
| 97 | export函数超过100行 | low | export async function renderGitStatusPanel |
| 102 | TuiContext直接字段修改 | low | context.language = |
| 172 | export函数超过100行 | low | export async function renderStablePointPanel |
| 173 | TuiContext直接字段修改 | low | context.language = |
| 231 | export函数超过100行 | low | export async function renderWorktreePanel |
| 232 | TuiContext直接字段修改 | low | context.language = |
| 269 | 魔法数字(轮次/计数) | low | 8) |
| 289 | export函数超过100行 | low | export async function renderCheckpointPanel |
| 290 | TuiContext直接字段修改 | low | context.language = |
| 316 | 魔法数字(轮次/计数) | low | 8) |
| 323 | 魔法数字(轮次/计数) | low | 5) |

### packages/tui/src/git-operation-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 37 | 魔法数字(轮次/计数) | low | 200; |
| 39 | 魔法数字(轮次/计数) | low | 200; |
| 61 | export函数超过100行 | low | export function validateStablePointMessage |
| 84 | export函数超过100行 | low | export function defaultStablePointMessage |
| 90 | export函数超过100行 | low | export function validateWorktreeName |
| 126 | export函数超过100行 | low | export function validateGitRef |
| 170 | export函数超过100行 | low | export function resolveManagedWorktreeRoot |
| 175 | export函数超过100行 | low | export function managedWorktreePath |
| 193 | export函数超过100行 | low | export function redactWorktreePath |
| 219 | export函数超过100行 | low | export function isSensitiveUntrackedPath |
| 224 | export函数超过100行 | low | export function filterUntrackedForCommit |
| 241 | export函数超过100行 | low | export function summarizeRejectedUntracked |
| 242 | 魔法数字(轮次/计数) | low | 8) |
| 294 | export函数超过100行 | low | export async function createGitStablePoint |
| 428 | export函数超过100行 | low | export async function createManagedWorktree |
| 532 | export函数超过100行 | low | export async function planManagedWorktreeRemove |
| 614 | export函数超过100行 | low | export async function executeManagedWorktreeRemove |
| 644 | export函数超过100行 | low | export async function computeWorktreeContext |
| 684 | export函数超过100行 | low | export function isAbsoluteWorktreeInput |

### packages/tui/src/git-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 86 | export函数超过100行 | low | export function createGitRunner |
| 112 | export函数超过100行 | low | export async function isGitRepository |
| 131 | export函数超过100行 | low | export async function readGitStatus |
| 196 | 魔法数字(轮次/计数) | low | 3} |
| 199 | 魔法数字(轮次/计数) | low | 3] |
| 202 | 魔法数字(轮次/计数) | low | 10) |
| 203 | 魔法数字(轮次/计数) | low | 10) |
| 208 | 魔法数字(轮次/计数) | low | 3) |
| 244 | export函数超过100行 | low | export async function readWorktreeList |
| 335 | export函数超过100行 | low | export function suggestStablePoint |
| 351 | 魔法数字(轮次/计数) | low | 5) |
| 352 | 魔法数字(轮次/计数) | low | 5) |
| 353 | 魔法数字(轮次/计数) | low | 5) |
| 393 | export函数超过100行 | low | export function formatGitStatusDetails |
| 394 | if-elseif链无else兜底 | low | if (status.kind === "not_a_git_repo") {     return "Not a git repository.";   } ... |

### packages/tui/src/git-slash-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 35 | export函数超过100行 | low | export function parseStablePointSlashArgs |
| 54 | export函数超过100行 | low | export function parseWorktreeSlashArgs |
| 87 | export函数超过100行 | low | export async function runStablePointCreateSlash |
| 99 | TuiContext直接字段修改 | low | context.permissionMode = |
| 101 | TuiContext直接字段修改 | low | context.language = |
| 132 | export函数超过100行 | low | export async function runWorktreeCreateSlash |
| 154 | export函数超过100行 | low | export async function runWorktreeRemoveSlash |
| 173 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |

### packages/tui/src/git-tool-dispatch-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 162 | export函数超过100行 | low | export async function appendGitOperationEvent |
| 186 | 魔法数字(轮次/计数) | low | 50) |
| 214 | TuiContext直接字段修改 | low | context.checkpoints.unshift( |
| 215 | TuiContext直接字段修改 | low | context.checkpoints =  |
| 231 | export函数超过100行 | low | export async function executeGitToolUse |
| 248 | if-elseif链无else兜底 | low | if (toolCall.name === GIT_STATUS_INSPECT) {       return await runGitStatusInspe... |
| 337 | TuiContext直接字段修改 | low | context.language = |
| 354 | TuiContext直接字段修改 | low | context.permissionMode = |
| 357 | TuiContext直接字段修改 | low | context.language = |
| 391 | TuiContext直接字段修改 | low | context.permissionMode = |
| 393 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 404 | TuiContext直接字段修改 | low | context.language = |
| 442 | export函数超过100行 | low | export async function performStablePoint |
| 591 | export函数超过100行 | low | export async function performWorktreeCreate |
| 688 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 754 | export函数超过100行 | low | export async function performWorktreeRemoveExecute |
| 787 | TuiContext直接字段修改 | low | context.language = |
| 807 | TuiContext直接字段修改 | low | context.language = |
| 850 | export函数超过100行 | low | export async function resolveWorktreeRemoveApprove |
| 882 | export函数超过100行 | low | export async function resolveWorktreeRemoveDeny |
| 910 | TuiContext直接字段修改 | low | context.language = |
| 933 | export函数超过100行 | low | export async function resolveStablePointApprove |
| 974 | export函数超过100行 | low | export async function resolveStablePointDeny |
| 1001 | TuiContext直接字段修改 | low | context.language = |

### packages/tui/src/git-tool-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 42 | export函数超过100行 | low | export function isGitToolName |
| 50 | export函数超过100行 | low | export function createGitToolDefinitions |
| 136 | export函数超过100行 | low | export function parseStablePointInput |
| 152 | export函数超过100行 | low | export function parseWorktreeCreateInput |
| 168 | export函数超过100行 | low | export function parseWorktreeRemoveInput |
| 181 | export函数超过100行 | low | export function summarizeStablePointOutcome |
| 244 | export函数超过100行 | low | export function summarizeWorktreeCreateOutcome |
| 296 | export函数超过100行 | low | export function summarizeWorktreeRemovePlan |
| 369 | export函数超过100行 | low | export function summarizeWorktreeContextForPrompt |

### packages/tui/src/guard-wiring.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 58 | export函数超过100行 | low | export function formatRuntimePathDoctor |
| 95 | export函数超过100行 | low | export function formatStartupPathDoctor |
| 130 | export函数超过100行 | low | export function formatVerificationLevelDoctor |
| 165 | export函数超过100行 | low | export function formatRunnerGuardSummary |
| 173 | if-elseif链无else兜底 | low | if (classification.canClaimMature) {     return language === "en-US"       ? "Na... |
| 193 | export函数超过100行 | low | export function formatProviderGuardSummary |
| 204 | if-elseif链无else兜底 | low | if (classification.canClaimMature) {     return language === "en-US"       ? "Pr... |
| 216 | if-elseif链无else兜底 | low | if (input.mockUsed) {     return language === "en-US"       ? "Provider verifica... |
| 241 | export函数超过100行 | low | export function validateCompletionClaim |
| 295 | export函数超过100行 | low | export function validateChangeDeclarationHuman |
| 309 | if-elseif链无else兜底 | low | if (reason === "non-tty-output") {     return language === "en-US"       ? "Outp... |
| 317 | if-elseif链无else兜底 | low | if (reason === "ink-unavailable") {     return language === "en-US" ? "Ink rende... |
| 348 | if-elseif链无else兜底 | low | if (part === "real-smoke-observation") {       return language === "en-US"      ... |
| 356 | if-elseif链无else兜底 | low | if (part === "real-dependency-verification") {       return language === "en-US"... |

### packages/tui/src/handoff-session-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 21 | export函数超过100行 | low | export function hydrateResumeContext |
| 30 | TuiContext直接字段修改 | low | context.lastVerification =  |
| 37 | 魔法数字(轮次/计数) | low | 10) |
| 46 | 魔法数字(轮次/计数) | low | 20) |
| 46 | TuiContext直接字段修改 | low | context.evidence =  |
| 78 | 魔法数字(轮次/计数) | low | 4) |
| 79 | 魔法数字(轮次/计数) | low | 4) |
| 183 | if-elseif链无else兜底 | low | if (     typeof value.id !== "string" \|\|     typeof value.summary !== "string" \|... |
| 251 | catch返回null/undefined | low | } catch {     return undefined;   } |
| 272 | export函数超过100行 | low | export async function loadOrCreateHandoffPacket |
| 295 | export函数超过100行 | low | export function createHandoffPacket |
| 301 | 魔法数字(轮次/计数) | low | 8) |
| 389 | export函数超过100行 | low | export function validateHandoffPacket |
| 402 | export函数超过100行 | low | export function isHandoffPacket |
| 418 | export函数超过100行 | low | export function formatResumePacket |
| 444 | export函数超过100行 | low | export async function writeHandoffPacket |

### packages/tui/src/index-result-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 9 | 魔法数字(轮次/计数) | low | 12; |
| 43 | export函数超过100行 | low | export function summarizeIndexResult |
| 59 | 魔法数字(轮次/计数) | low | 5) |
| 74 | 魔法数字(轮次/计数) | low | 5) |
| 125 | export函数超过100行 | low | export async function scanIndexSafety |
| 190 | export函数超过100行 | low | export async function readIndexIgnorePatterns |
| 209 | export函数超过100行 | low | export function isIgnoredIndexPath |
| 245 | export函数超过100行 | low | export function createIndexTransientExcludes |
| 249 | export函数超过100行 | low | export function formatIndexAutoSkipPrimary |
| 271 | export函数超过100行 | low | export function formatIndexAutoSkipNextAction |
| 277 | export函数超过100行 | low | export function formatIndexAutoSkipDetails |
| 321 | toFixed未检查NaN | low | return `${(bytes / 1_000_000).toFixed(1)} MB`; |

### packages/tui/src/index-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 68 | export函数超过100行 | low | export function createIndexState |
| 89 | export函数超过100行 | low | export async function readLocalIndexArtifactState |
| 151 | export函数超过100行 | low | export function findCurrentIndexProject |
| 189 | export函数超过100行 | low | export function createCurrentIndexProjectNameCandidates |
| 207 | export函数超过100行 | low | export function createIndexStatusSnapshot |
| 220 | export函数超过100行 | low | export function formatIndexRuntimeRef |

### packages/tui/src/index-tool-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 34 | export函数超过100行 | low | export function isIndexToolName |
| 44 | export函数超过100行 | low | export function isMutatingIndexTool |
| 54 | export函数超过100行 | low | export function createIndexToolDefinitions |
| 108 | export函数超过100行 | low | export function parseIndexRefreshInput |
| 123 | export函数超过100行 | low | export function summarizeIndexStatusInspect |
| 146 | export函数超过100行 | low | export function summarizeIndexRefreshOutcome |

### packages/tui/src/index.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 1301 | export函数超过100行 | low | export async function runTui |
| 1362 | TuiContext直接字段修改 | low | context.modelGateway =  |
| 1580 | TuiContext直接字段修改 | low | context.isInkSession =  |
| 1594 | TuiContext直接字段修改 | low | context.compactOutputMemory =  |
| 1628 | TuiContext直接字段修改 | low | context.ctrlOExpandState =  |
| 1642 | TuiContext直接字段修改 | low | context.activeBtwAbortController =  |
| 1644 | TuiContext直接字段修改 | low | context.commandPanelState =  |
| 1645 | TuiContext直接字段修改 | low | context.helpPanelState =  |
| 1646 | TuiContext直接字段修改 | low | context.configPanelState =  |
| 1647 | TuiContext直接字段修改 | low | context.btwPanelState =  |
| 1648 | TuiContext直接字段修改 | low | context.sessionsPanelState =  |
| 1658 | if-elseif链无else兜底 | low | if (event.type === "interrupt") {         submittedPending = false;         awai... |
| 1675 | TuiContext直接字段修改 | low | context.permissionMode =  |
| 1676 | TuiContext直接字段修改 | low | context.planAccepted =  |
| 1726 | TuiContext直接字段修改 | low | context.ctrlOExpandState =  |
| 1733 | TuiContext直接字段修改 | low | context.ctrlOExpandState =  |
| 1734 | TuiContext直接字段修改 | low | context.notifications =  |
| 1735 | TuiContext直接字段修改 | low | context.notifications.push( |
| 1738 | TuiContext直接字段修改 | low | context.language = |
| 1751 | if-elseif链无else兜底 | low | if (event.type === "command-panel-close") {         context.commandPanelState = ... |
| 1752 | TuiContext直接字段修改 | low | context.commandPanelState =  |
| 1763 | if-elseif链无else兜底 | low | if (event.type === "command-panel-toggle") {         toggleCommandPanelSelection... |
| 1789 | TuiContext直接字段修改 | low | context.transcriptScrollState =  |
| 1803 | TuiContext直接字段修改 | low | context.transcriptScrollState =  |
| 1831 | TuiContext直接字段修改 | low | context.transcriptViewportGeometry =  |
| 1839 | TuiContext直接字段修改 | low | context.transcriptScrollState =  |
| 1847 | TuiContext直接字段修改 | low | context.transcriptScrollState =  |
| 1861 | TuiContext直接字段修改 | low | context.configPanelState =  |
| 1880 | TuiContext直接字段修改 | low | context.helpPanelState =  |
| 1888 | TuiContext直接字段修改 | low | context.helpPanelState =  |
| 1893 | if-elseif链无else兜底 | low | if (event.type === "help-close") {         context.helpPanelState = undefined;  ... |
| 1894 | TuiContext直接字段修改 | low | context.helpPanelState =  |
| 1906 | TuiContext直接字段修改 | low | context.helpPanelState =  |
| 1916 | TuiContext直接字段修改 | low | context.helpPanelState =  |
| 1927 | TuiContext直接字段修改 | low | context.helpPanelState =  |
| 1942 | TuiContext直接字段修改 | low | context.activeBtwAbortController =  |
| 1944 | TuiContext直接字段修改 | low | context.btwPanelState =  |
| 1950 | TuiContext直接字段修改 | low | context.btwPanelState =  |
| 1956 | if-elseif链无else兜底 | low | if (event.type === "sessions-close") {         context.sessionsPanelState = unde... |
| 1957 | TuiContext直接字段修改 | low | context.sessionsPanelState =  |
| 1967 | TuiContext直接字段修改 | low | context.sessionsPanelState =  |
| 1981 | TuiContext直接字段修改 | low | context.language = |
| 1984 | TuiContext直接字段修改 | low | context.notifications =  |
| 1985 | TuiContext直接字段修改 | low | context.notifications.push( |
| 1997 | TuiContext直接字段修改 | low | context.sessionsPanelState =  |
| 2016 | TuiContext直接字段修改 | low | context.configPanelState =            |
| 2025 | TuiContext直接字段修改 | low | context.configPanelState =            |
| 2029 | TuiContext直接字段修改 | low | context.configPanelState =  |
| 2048 | TuiContext直接字段修改 | low | context.configPanelState =            |
| 2065 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 2073 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 2081 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 2092 | TuiContext直接字段修改 | low | context.language = |
| 2107 | TuiContext直接字段修改 | low | context.language = |
| 2113 | TuiContext直接字段修改 | low | context.notifications =  |
| 2114 | TuiContext直接字段修改 | low | context.notifications.push( |
| 2149 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 2161 | TuiContext直接字段修改 | low | context.taskSuggestionCursor =  |
| 2165 | TuiContext直接字段修改 | low | context.taskSuggestionCursor =  |
| 2170 | if-elseif链无else兜底 | low | if (event.type === "task-suggestion-action") {         const view = controller.g... |
| 2174 | TuiContext直接字段修改 | low | context.handledTaskSuggestionIds =  |
| 2176 | TuiContext直接字段修改 | low | context.taskSuggestionCursor =  |
| 2178 | TuiContext直接字段修改 | low | context.commandPanelState =  |
| 2200 | TuiContext直接字段修改 | low | context.commandPanelState =  |
| 2201 | TuiContext直接字段修改 | low | context.helpPanelState =  |
| 2202 | TuiContext直接字段修改 | low | context.configPanelState =  |
| 2203 | TuiContext直接字段修改 | low | context.btwPanelState =  |
| 2204 | TuiContext直接字段修改 | low | context.sessionsPanelState =  |
| 2262 | TuiContext直接字段修改 | low | context.shellRerender =  |
| 2266 | TuiContext直接字段修改 | low | context.language = |
| 2311 | TuiContext直接字段修改 | low | context.sessionEnded =  |
| 2317 | TuiContext直接字段修改 | low | context.commandPanelState =  |
| 2318 | TuiContext直接字段修改 | low | context.helpPanelState =  |
| 2319 | TuiContext直接字段修改 | low | context.configPanelState =  |
| 2320 | TuiContext直接字段修改 | low | context.btwPanelState =  |
| 2321 | TuiContext直接字段修改 | low | context.sessionsPanelState =  |
| 2336 | export函数超过100行 | low | export async function handleSlashCommand |
| 2351 | TuiContext直接字段修改 | low | context.pendingNaturalCommand =  |
| 2360 | if-elseif链无else兜底 | low | if (workspaceGuard) {     writeLine(output, workspaceGuard);     writeStatus(out... |
| 2378 | if-elseif链无else兜底 | low | if (command === "/features") {     writeLine(output, formatFeaturePolicy(context... |
| 2386 | if-elseif链无else兜底 | low | if (command === "/apps") {     await handleAppsCommand(rest, context, output);  ... |
| 2394 | if-elseif链无else兜底 | low | if (command === "/language") {     await handleLanguageCommand(rest, context, ou... |
| 2402 | if-elseif链无else兜底 | low | if (command === "/plan") {     await handlePlanCommand(rest, context, output);  ... |
| 2410 | if-elseif链无else兜底 | low | if (command === "/background") {     await hydrateWorkflowRuns(context);     awa... |
| 2419 | if-elseif链无else兜底 | low | if (command === "/remote") {     await handleRemoteCommand(rest, context, output... |
| 2427 | if-elseif链无else兜底 | low | if (command === "/agents") {     await handleAgentsCommand(rest, context, output... |
| 2435 | if-elseif链无else兜底 | low | if (command === "/rewind") {     await handleRewindCommand(rest, context, output... |
| 2443 | if-elseif链无else兜底 | low | if (command === "/interrupt") {     await handleInterruptCommand(rest, context, ... |
| 2451 | if-elseif链无else兜底 | low | if (command === "/verify") {     await handleVerifyCommand(rest, context, output... |
| 2459 | if-elseif链无else兜底 | low | if (command === "/vision") {     await handleVisionCommand(rest, context, output... |
| 2467 | if-elseif链无else兜底 | low | if (command === "/cache-log") {     await handleCacheLogCommand(rest, context, o... |
| 2475 | if-elseif链无else兜底 | low | if (command === "/compact" \|\| command === "/context") {     await handleCompactC... |
| 2483 | if-elseif链无else兜底 | low | if (command === "/mcp") {     await handleMcpCommand(rest, context, output);    ... |
| 2506 | if-elseif链无else兜底 | low | if (command === "/resume") {     await handleResumeCommand(rest, context, output... |
| 2518 | if-elseif链无else兜底 | low | if (command === "/git") {     await handleGitCommand(rest, context, output, gitS... |
| 2526 | if-elseif链无else兜底 | low | if (command === "/checkpoint") {     await handleCheckpointCommand(rest, context... |
| 2534 | if-elseif链无else兜底 | low | if (command === "/failures") {     await handleFailuresCommand(rest, context, ou... |
| 2542 | if-elseif链无else兜底 | low | if (command === "/workflows") {     await handleWorkflowsCommand(rest, context, ... |
| 2550 | if-elseif链无else兜底 | low | if (command === "/doctor") {     await handleDoctorCommand(rest, context, output... |
| 2559 | if-elseif链无else兜底 | low | if (command === "/usage") {     writeLine(output, formatUsage(context));     ret... |
| 2567 | if-elseif链无else兜底 | low | if (command === "/status") {     writeStatus(output, context);     refreshBackgr... |
| 2577 | if-elseif链无else兜底 | low | if (command === "/esc") {     await cancelPendingInteraction(context, output, "E... |
| 2585 | if-elseif链无else兜底 | low | if (command === "/trust") {     await handleTrustCommand(rest, context, output);... |
| 2621 | TuiContext直接字段修改 | low | context.sessionsPanelState =  |
| 2630 | 魔法数字(轮次/计数) | low | 5) |
| 2638 | 魔法数字(轮次/计数) | low | 5) |
| 2639 | 魔法数字(轮次/计数) | low | 5} |
| 2658 | if-elseif链无else兜底 | low | if (toolName) {     await handleToolCommand(toolName, rest, context, output);   ... |

### packages/tui/src/job-agent-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 134 | 魔法数字(轮次/计数) | low | 20; |
| 135 | 魔法数字(MB/KB) | low | 16_384 |
| 136 | 魔法数字(轮次/计数) | low | 3; |
| 137 | 魔法数字(轮次/计数) | low | 5; |
| 270 | export函数超过100行 | low | export function configureJobAgentCommandRuntime |
| 401 | 魔法数字(轮次/计数) | low | 8) |
| 513 | export函数超过100行 | low | export async function handleBackgroundCommand |
| 524 | TuiContext直接字段修改 | low | context.language = |
| 563 | TuiContext直接字段修改 | low | context.language = |
| 595 | 魔法数字(轮次/计数) | low | 4) |
| 598 | 魔法数字(轮次/计数) | low | 4; |
| 609 | 魔法数字(轮次/计数) | low | 4) |
| 632 | export函数超过100行 | low | export async function handleJobCommand |
| 642 | TuiContext直接字段修改 | low | context.language = |
| 666 | 魔法数字(轮次/计数) | low | 8) |
| 708 | if-elseif链无else兜底 | low | if (!job) {       writeLine(output, "未找到 job。用法：/job status\|report\|logs\|pause\|re... |
| 722 | TuiContext直接字段修改 | low | context.language = |
| 740 | TuiContext直接字段修改 | low | context.language = |
| 754 | TuiContext直接字段修改 | low | context.language = |
| 783 | if-elseif链无else兜底 | low | if (noop) {       writeLine(output, noop);       return;     }     if (job.runne... |
| 806 | if-elseif链无else兜底 | low | if (job.status === "sleeping") {     return formatActiveJobNoop(job, action, con... |
| 862 | TuiContext直接字段修改 | low | context.language = |
| 878 | TuiContext直接字段修改 | low | context.language = |
| 881 | TuiContext直接字段修改 | low | context.language = |
| 892 | TuiContext直接字段修改 | low | context.language = |
| 898 | TuiContext直接字段修改 | low | context.language = |
| 912 | export函数超过100行 | low | export async function createDurableJob |
| 918 | 魔法数字(轮次/计数) | low | 8) |
| 999 | 魔法数字(轮次/计数) | low | 8) |
| 1034 | TuiContext直接字段修改 | low | context.lastVerification =  |
| 1035 | 魔法数字(轮次/计数) | low | 8) |
| 1063 | 魔法数字(轮次/计数) | low | 8) |
| 1064 | TuiContext直接字段修改 | low | context.evidence.unshift( |
| 1083 | 魔法数字(轮次/计数) | low | 8) |
| 1161 | 魔法数字(轮次/计数) | low | 8) |
| 1169 | 魔法数字(轮次/计数) | low | 200) |
| 1171 | 魔法数字(轮次/计数) | low | 8) |
| 1173 | 魔法数字(轮次/计数) | low | 8) |
| 1197 | 魔法数字(轮次/计数) | low | 8) |
| 1230 | TuiContext直接字段修改 | low | context.agents.unshift( |
| 1231 | TuiContext直接字段修改 | low | context.agents =  |
| 1304 | export函数超过100行 | low | export async function resumeDurableJob |
| 1364 | export函数超过100行 | low | export async function transitionDurableJob |
| 1442 | export函数超过100行 | low | export async function hydrateDurableJobBackgroundTasks |
| 1457 | export函数超过100行 | low | export async function recoverDurableJobForContext |
| 1485 | if-elseif链无else兜底 | low | if (job.status === originalStatus && originalStatus !== "stale") {     return jo... |
| 1517 | export函数超过100行 | low | export async function runDurableJobLiteTick |
| 1675 | if-elseif链无else兜底 | low | if (!task) {         assignment.status = "blocked";         assignment.statusRea... |
| 1836 | export函数超过100行 | low | export async function persistDurableJobProgress |
| 1848 | export函数超过100行 | low | export function createDurableJobStepFacts |
| 1879 | export函数超过100行 | low | export async function applyDurableJobBudgetStop |
| 1918 | export函数超过100行 | low | export async function handleAgentsCommand |
| 1930 | TuiContext直接字段修改 | low | context.language = |
| 1941 | TuiContext直接字段修改 | low | context.language = |
| 1995 | TuiContext直接字段修改 | low | context.language = |
| 2045 | export函数超过100行 | low | export async function handleForkCommand |
| 2109 | 魔法数字(轮次/计数) | low | 8) |
| 2140 | TuiContext直接字段修改 | low | context.agents.unshift( |
| 2141 | TuiContext直接字段修改 | low | context.agents =  |
| 2170 | TuiContext直接字段修改 | low | context.language = |
| 2183 | export函数超过100行 | low | export async function completeAgent |
| 2230 | 魔法数字(轮次/计数) | low | 4) |
| 2243 | TuiContext直接字段修改 | low | context.roleHandoffs.unshift( |
| 2250 | TuiContext直接字段修改 | low | context.language = |
| 2301 | TuiContext直接字段修改 | low | context.language = |
| 2328 | export函数超过100行 | low | export async function runAgentWork |
| 2342 | TuiContext直接字段修改 | low | context.lastVerification =  |
| 2447 | TuiContext直接字段修改 | low | context.lastProviderFallbackAttempt =  |
| 2486 | TuiContext直接字段修改 | low | context.routeDecisions.unshift( |
| 2487 | 魔法数字(轮次/计数) | low | 8) |
| 2504 | export函数超过100行 | low | export async function runModelBackedAgent |
| 2613 | TuiContext直接字段修改 | low | context.language = |
| 2693 | TuiContext直接字段修改 | low | context.language = |
| 2737 | TuiContext直接字段修改 | low | context.language = |
| 2914 | export函数超过100行 | low | export async function executeApprovedAgentToolUse |
| 3025 | export函数超过100行 | low | export async function denyAgentToolUse |
| 3235 | export函数超过100行 | low | export async function cancelAgent |
| 3277 | export函数超过100行 | low | export async function cancelAgentByRef |
| 3295 | export函数超过100行 | low | export async function cancelAllAgents |
| 3300 | TuiContext直接字段修改 | low | context.language = |
| 3311 | TuiContext直接字段修改 | low | context.language = |
| 3319 | export函数超过100行 | low | export async function resumeAgent |
| 3351 | TuiContext直接字段修改 | low | context.language = |
| 3368 | export函数超过100行 | low | export function syncBackgroundWithAgentStatus |
| 3425 | export函数超过100行 | low | export async function markRunningAgentsStaleForInterrupt |
| 3463 | export函数超过100行 | low | export async function hydratePersistentAgents |
| 3504 | TuiContext直接字段修改 | low | context.agents.push( |
| 3537 | export函数超过100行 | low | export async function sendAgentMessage |
| 3580 | 魔法数字(轮次/计数) | low | 8) |
| 3719 | if-elseif链无else兜底 | low | if (input.targetType === "id") {     return resolveSingleTarget(normalized, byId... |
| 3848 | TuiContext直接字段修改 | low | context.language = |
| 3853 | TuiContext直接字段修改 | low | context.language = |
| 3870 | TuiContext直接字段修改 | low | context.language = |
| 3875 | TuiContext直接字段修改 | low | context.language = |
| 3880 | TuiContext直接字段修改 | low | context.language = |
| 3888 | TuiContext直接字段修改 | low | context.language = |
| 3895 | TuiContext直接字段修改 | low | context.language = |
| 4005 | TuiContext直接字段修改 | low | context.language = |

### packages/tui/src/job-runner-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 28 | export函数超过100行 | low | export function formatRunnerDoctor |
| 50 | export函数超过100行 | low | export function formatJobRunnerInline |
| 58 | export函数超过100行 | low | export function formatJobRunnerReportLine |
| 68 | export函数超过100行 | low | export function mapDurableJobToBackgroundStatus |
| 84 | export函数超过100行 | low | export function mapDurableJobToBackgroundResult |
| 96 | export函数超过100行 | low | export function formatJobNextAction |
| 153 | export函数超过100行 | low | export function formatBackgroundDetails |
| 179 | export函数超过100行 | low | export function formatBackgroundOutputDetails |
| 200 | export函数超过100行 | low | export function formatBackgroundTask |
| 213 | export函数超过100行 | low | export function formatBackgroundTaskPanelRow |
| 230 | export函数超过100行 | low | export function formatBackgroundTaskPanelDetails |
| 250 | export函数超过100行 | low | export function formatElapsedSince |
| 263 | if-elseif链无else兜底 | low | if (task.status === "stale") {     return language === "en-US"       ? "heartbea... |
| 346 | 魔法数字(轮次/计数) | low | 8} |
| 346 | 魔法数字(轮次/计数) | low | 4} |
| 346 | 魔法数字(轮次/计数) | low | 4} |
| 346 | 魔法数字(轮次/计数) | low | 4} |
| 346 | 魔法数字(轮次/计数) | low | 12} |

### packages/tui/src/job-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 37 | 魔法数字(轮次/计数) | low | 3; |
| 38 | 魔法数字(轮次/计数) | low | 8; |
| 40 | 魔法数字(毫秒超时) | low | 120_000 |
| 43 | 魔法数字(轮次/计数) | low | 4; |
| 44 | 魔法数字(轮次/计数) | low | 20; |
| 45 | 魔法数字(轮次/计数) | low | 20; |
| 79 | export函数超过100行 | low | export function parseJobRunOptions |
| 173 | export函数超过100行 | low | export function clampPositiveInt |
| 174 | 魔法数字(轮次/计数) | low | 10) |
| 185 | export函数超过100行 | low | export function estimateJobTokens |
| 186 | 魔法数字(轮次/计数) | low | 4) |
| 189 | export函数超过100行 | low | export function getDurableJobMaxSteps |
| 214 | export函数超过100行 | low | export function countDurableJobAgents |
| 238 | export函数超过100行 | low | export function rescheduleDurableJobAgents |
| 268 | export函数超过100行 | low | export function getEffectiveAgentCap |
| 275 | export函数超过100行 | low | export function updateDurableJobEffectiveAgentCap |
| 305 | export函数超过100行 | low | export function deriveAgentDisplayName |
| 328 | 魔法数字(轮次/计数) | low | 3) |
| 337 | export函数超过100行 | low | export function truncateAsciiLabel |
| 348 | export函数超过100行 | low | export function createDurableJobAgents |
| 383 | export函数超过100行 | low | export function createDurableJobAgentTasks |
| 401 | export函数超过100行 | low | export function getDurableJobStatePath |
| 405 | export函数超过100行 | low | export async function persistDurableJob |
| 410 | export函数超过100行 | low | export async function appendJobLog |
| 416 | export函数超过100行 | low | export async function readDurableJobState |
| 420 | catch返回null/undefined | low | } catch {     return null;   } |
| 425 | export函数超过100行 | low | export function isDurableJobState |
| 444 | export函数超过100行 | low | export function getDurableJobsRoot |
| 448 | export函数超过100行 | low | export function getDurableJobPaths |
| 460 | export函数超过100行 | low | export async function listDurableJobs |
| 476 | export函数超过100行 | low | export async function findDurableJob |
| 489 | export函数超过100行 | low | export async function writeDurableJobReport |
| 561 | export函数超过100行 | low | export function formatJobList |
| 563 | TuiContext直接字段修改 | low | context.language = |
| 568 | TuiContext直接字段修改 | low | context.language = |
| 574 | TuiContext直接字段修改 | low | context.language = |
| 580 | export函数超过100行 | low | export function formatJobPrimary |
| 585 | TuiContext直接字段修改 | low | context.language = |
| 588 | TuiContext直接字段修改 | low | context.language = |
| 600 | export函数超过100行 | low | export function formatJobStatus |
| 624 | export函数超过100行 | low | export function formatJobReport |
| 683 | export函数超过100行 | low | export function formatJobAgentLabels |
| 695 | export函数超过100行 | low | export function formatJobReportConclusion |
| 696 | if-elseif链无else兜底 | low | if (job.status === "stale") {     return "stale because heartbeat/owner recovery... |
| 708 | export函数超过100行 | low | export async function formatJobLogs |

### packages/tui/src/log-artifact.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 51 | 魔法数字(轮次/计数) | low | 200; |
| 54 | 魔法数字(轮次/计数) | low | 20; |
| 55 | 魔法数字(轮次/计数) | low | 200; |
| 57 | 魔法数字(轮次/计数) | low | 5; |
| 58 | 魔法数字(轮次/计数) | low | 4; |
| 65 | 魔法数字(轮次/计数) | low | 4} |
| 67 | export函数超过100行 | low | export async function readLogArtifactSlice |
| 83 | if-elseif链无else兜底 | low | if (request.mode === "tail") {     return readTail(sourcePath, info.size, reques... |
| 92 | export函数超过100行 | low | export function formatLogArtifactSlice |
| 154 | if-elseif链无else兜底 | low | if (explicitArtifact) {       return ensureAllowedPath(explicitArtifact, registr... |
| 399 | 魔法数字(轮次/计数) | low | 10) |
| 491 | export函数超过100行 | low | export function redactLogContent |
| 496 | 魔法数字(轮次/计数) | low | 8, |

### packages/tui/src/mcp-index-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 14 | export函数超过100行 | low | export function buildMcpStatusPanel |
| 15 | TuiContext直接字段修改 | low | context.language = |
| 37 | 魔法数字(轮次/计数) | low | 8) |
| 52 | export函数超过100行 | low | export function formatMcpStatus |
| 58 | TuiContext直接字段修改 | low | context.language = |
| 101 | export函数超过100行 | low | export function buildIndexStatusPanel |
| 102 | TuiContext直接字段修改 | low | context.language = |
| 137 | export函数超过100行 | low | export function formatIndexStatus |
| 173 | export函数超过100行 | low | export function formatIndexRefreshSummary |
| 179 | TuiContext直接字段修改 | low | context.language = |

### packages/tui/src/mcp-index-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 111 | export函数超过100行 | low | export function configureMcpIndexRuntime |
| 130 | export函数超过100行 | low | export async function handleMcpCommand |
| 136 | if-elseif链无else兜底 | low | if (action === "status") {     // D.13Q-UX Task Surface — /mcp status 默认走 Comman... |
| 153 | TuiContext直接字段修改 | low | context.language = |
| 166 | TuiContext直接字段修改 | low | context.language = |
| 175 | if-elseif链无else兜底 | low | if (action === "add" \|\| action === "install") {     const result = await addMcpS... |
| 190 | if-elseif链无else兜底 | low | if (action === "remove") {     const id = args[1];     writeLine(output, id ? aw... |
| 205 | export函数超过100行 | low | export async function handleIndexCommand |
| 211 | if-elseif链无else兜底 | low | if (action === "status") {     await refreshIndexStatus(context, args.includes("... |
| 225 | if-elseif链无else兜底 | low | if (action === "check") {     await refreshIndexStatus(context, true);     // D.... |
| 276 | 魔法数字(轮次/计数) | low | 5 } |
| 288 | TuiContext直接字段修改 | low | context.language = |
| 305 | TuiContext直接字段修改 | low | context.language = |
| 320 | export函数超过100行 | low | export async function resolveCodebaseMemoryBinary |
| 327 | if-elseif链无else兜底 | low | if (envCommand) {     const spec = await codebaseMemoryCommandSpec(envCommand, [... |
| 376 | export函数超过100行 | low | export async function codebaseMemoryCommandSpec |
| 424 | catch返回null/undefined | low | } catch {     return undefined;   } |
| 451 | export函数超过100行 | low | export async function findManagedCodebaseMemoryBinary |
| 463 | export函数超过100行 | low | export async function findBundledCodebaseMemoryBinary |
| 485 | export函数超过100行 | low | export function getBundledCodebaseMemoryRoots |
| 499 | export函数超过100行 | low | export function getCodebaseMemoryPlatformArch |
| 507 | export函数超过100行 | low | export async function findPathCodebaseMemoryBinary |
| 515 | export函数超过100行 | low | export async function findCodebaseMemoryBinaryCandidate |
| 532 | export函数超过100行 | low | export async function probeCodebaseMemoryBinary |
| 543 | 魔法数字(毫秒超时) | low | 5_000 |
| 587 | export函数超过100行 | low | export function extractCodebaseMemoryVersion |
| 596 | export函数超过100行 | low | export function rememberCodebaseMemoryResolution |
| 616 | export函数超过100行 | low | export async function getCodebaseMemoryResolution |
| 624 | export函数超过100行 | low | export async function runMcpDoctor |
| 634 | 魔法数字(毫秒超时) | low | 5_000 |
| 709 | export函数超过100行 | low | export function validateMcpServers |
| 731 | export函数超过100行 | low | export async function addMcpServer |
| 751 | TuiContext直接字段修改 | low | context.config =  |
| 752 | TuiContext直接字段修改 | low | context.mcp =  |
| 757 | export函数超过100行 | low | export async function setMcpServerEnabled |
| 767 | TuiContext直接字段修改 | low | context.config =  |
| 773 | TuiContext直接字段修改 | low | context.mcp =  |
| 786 | export函数超过100行 | low | export async function updateMcpServer |
| 789 | if-elseif链无else兜底 | low | if (!id \|\| source !== "local" \|\| !command) {     return "用法：/mcp update <server-... |
| 805 | TuiContext直接字段修改 | low | context.config =  |
| 806 | TuiContext直接字段修改 | low | context.mcp =  |
| 811 | export函数超过100行 | low | export async function removeMcpServer |
| 815 | TuiContext直接字段修改 | low | context.config =  |
| 816 | TuiContext直接字段修改 | low | context.mcp =  |
| 821 | export函数超过100行 | low | export async function refreshIndexStatus |
| 925 | export函数超过100行 | low | export async function refreshLocalIndexArtifactState |
| 929 | if-elseif链无else兜底 | low | if (artifact.status === "ready") {     context.index.projectName = context.index... |
| 941 | export函数超过100行 | low | export async function refreshIndexStaleHint |
| 950 | 魔法数字(毫秒超时) | low | 15_000 |
| 973 | export函数超过100行 | low | export async function runIndexRepository |
| 998 | 魔法数字(轮次/计数) | low | 8) |
| 1006 | 魔法数字(毫秒超时) | low | 30_000 |
| 1007 | 魔法数字(毫秒超时) | low | 120_000 |
| 1030 | 魔法数字(毫秒超时) | low | 120_000 |
| 1065 | TuiContext直接字段修改 | low | context.language = |
| 1094 | TuiContext直接字段修改 | low | context.lastFullOutput =  |
| 1100 | export函数超过100行 | low | export async function runIndexQuery |
| 1130 | export函数超过100行 | low | export async function recordIndexEvidence |
| 1159 | export函数超过100行 | low | export function isSupportiveIndexEvidence |
| 1178 | export函数超过100行 | low | export async function runCodebaseMemoryCli |
| 1183 | 魔法数字(毫秒超时) | low | 30_000 |
| 1215 | export函数超过100行 | low | export function executeSearchExtraTools |
| 1237 | export函数超过100行 | low | export async function executeExtraTool |
| 1356 | export函数超过100行 | low | export function stabilizeMcpToolList |

### packages/tui/src/mcp-stdio-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 23 | export函数超过100行 | low | export function isPotentiallyMutatingMcpTool |
| 54 | 魔法数字(毫秒超时) | low | 15_000 |
| 58 | export函数超过100行 | low | export async function runMcpStdioToolCall |
| 267 | export函数超过100行 | low | export async function runMcpStdioToolList |
| 270 | 魔法数字(毫秒超时) | low | 5_000 |

### packages/tui/src/memory-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 69 | export函数超过100行 | low | export function configureMemoryCommandRuntime |
| 91 | TuiContext直接字段修改 | low | context.language = |
| 118 | export函数超过100行 | low | export async function handleMemoryCommand |
| 124 | if-elseif链无else兜底 | low | if (action === "status" \|\| action === "list") {     // D.13Q-UX Task Surface — /... |
| 135 | TuiContext直接字段修改 | low | context.language = |
| 149 | TuiContext直接字段修改 | low | context.language = |
| 163 | TuiContext直接字段修改 | low | context.language = |
| 171 | if-elseif链无else兜底 | low | if (action === "learn") {     const subAction = args[1];     if (subAction === "... |
| 180 | TuiContext直接字段修改 | low | context.language = |
| 193 | TuiContext直接字段修改 | low | context.language = |
| 202 | TuiContext直接字段修改 | low | context.language = |
| 214 | TuiContext直接字段修改 | low | context.language = |
| 366 | export函数超过100行 | low | export async function resumeSessionWithHandoff |
| 374 | TuiContext直接字段修改 | low | context.sessionId =  |
| 375 | TuiContext直接字段修改 | low | context.sessionEnded =  |
| 376 | TuiContext直接字段修改 | low | context.model =  |
| 415 | export函数超过100行 | low | export async function executeMemoryMutation |
| 510 | 魔法数字(轮次/计数) | low | 3) |
| 549 | export函数超过100行 | low | export async function runAutoLearningOnTurnEnd |
| 613 | export函数超过100行 | low | export async function initLinghunMd |
| 629 | export函数超过100行 | low | export async function importAiSessions |

### packages/tui/src/meta-scheduler-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 265 | export函数超过100行 | low | export function evaluateMetaScheduler |
| 476 | export函数超过100行 | low | export function formatMetaSchedulerDirective |
| 485 | export函数超过100行 | low | export function formatPolicyDecisionSummary |
| 554 | export函数超过100行 | low | export function verifyFailureLearningContract |
| 613 | 魔法数字(轮次/计数) | low | 5) |
| 908 | if-elseif链无else兜底 | low | if (     input.highRiskClaim \|\|     input.blockedRuntime \|\|     input.userStateD... |
| 965 | if-elseif链无else兜底 | low | if (domain === "documentation") {     return ["markdown", "link", "frontmatter",... |
| 971 | if-elseif链无else兜底 | low | if (domain === "provider_model_config") {     return ["doctor", "provider-smoke"... |
| 1056 | toFixed未检查NaN | low | return `UserStateDecision: kind=${decision.kind}; confidence=${decision.confiden |
| 1081 | if-elseif链无else兜底 | low | if (     input.lastStatus === "fail" \|\|     input.lastStatus === "timeout" \|\|   ... |
| 1534 | if-elseif链无else兜底 | low | if (strategy === "unknown-project") {     return "Index strategy: unknown projec... |

### packages/tui/src/model-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 47 | export函数超过100行 | low | export function configureModelCommandRuntime |
| 58 | export函数超过100行 | low | export async function handleModelCommand |
| 64 | if-elseif链无else兜底 | low | if (action === "route") {     await handleModelRouteCommand(args.slice(1), conte... |
| 75 | TuiContext直接字段修改 | low | context.language = |
| 106 | TuiContext直接字段修改 | low | context.config =  |
| 107 | TuiContext直接字段修改 | low | context.model =  |
| 133 | TuiContext直接字段修改 | low | context.language = |
| 162 | export函数超过100行 | low | export async function startModelSetup |
| 170 | TuiContext直接字段修改 | low | context.pendingModelSetup =  |
| 184 | export函数超过100行 | low | export async function handleModelSetupInput |
| 194 | TuiContext直接字段修改 | low | context.pendingModelSetup =  |
| 252 | TuiContext直接字段修改 | low | context.pendingModelSetup =  |
| 253 | TuiContext直接字段修改 | low | context.config =  |
| 254 | TuiContext直接字段修改 | low | context.model =  |
| 258 | TuiContext直接字段修改 | low | context.pendingModelSetup =  |
| 271 | export函数超过100行 | low | export async function handleModelRouteCommand |
| 279 | TuiContext直接字段修改 | low | context.language = |
| 295 | TuiContext直接字段修改 | low | context.language = |
| 329 | TuiContext直接字段修改 | low | context.config =  |
| 332 | TuiContext直接字段修改 | low | context.model =  |

### packages/tui/src/model-doctor-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 95 | export函数超过100行 | low | export function maskSecret |
| 96 | 魔法数字(轮次/计数) | low | 8) |
| 97 | 魔法数字(轮次/计数) | low | 3) |
| 97 | 魔法数字(轮次/计数) | low | 4) |
| 104 | export函数超过100行 | low | export function getProviderKeySource |
| 123 | export函数超过100行 | low | export async function readProjectSettingsApiKeyProviders |
| 139 | export函数超过100行 | low | export async function readProviderEnvApiKeyProviders |
| 155 | export函数超过100行 | low | export function isModelRole |
| 161 | export函数超过100行 | low | export function getRoleRoute |
| 179 | export函数超过100行 | low | export function isDefaultExecutorRoute |
| 192 | export函数超过100行 | low | export function formatModelRouteSummary |
| 198 | 魔法数字(轮次/计数) | low | 4) |
| 202 | export函数超过100行 | low | export function formatModelRoutes |
| 224 | export函数超过100行 | low | export function hasOpenAiCompatibleProviderSetupProblem |
| 236 | export函数超过100行 | low | export function hasOpenAiCompatibleDoctorProblem |
| 247 | export函数超过100行 | low | export function hasOpenAiCompatiblePlaceholderProblem |
| 254 | export函数超过100行 | low | export function collectPlaceholderModelHits |
| 278 | export函数超过100行 | low | export async function formatModelRouteDoctor |
| 279 | TuiContext直接字段修改 | low | context.language = |
| 368 | TuiContext直接字段修改 | low | context.language = |
| 372 | TuiContext直接字段修改 | low | context.language = |
| 375 | TuiContext直接字段修改 | low | context.language = |
| 497 | 魔法数字(轮次/计数) | low | 3) |
| 538 | TuiContext直接字段修改 | low | context.language = |
| 592 | export函数超过100行 | low | export function diagnoseRoute |
| 634 | export函数超过100行 | low | export function diagnoseConcreteRoute |
| 667 | export函数超过100行 | low | export function getRouteDoctorLevel |
| 697 | export函数超过100行 | low | export function getRouteBlockingProblems |
| 713 | export函数超过100行 | low | export function routeSupportsCapability |
| 717 | if-elseif链无else兜底 | low | if (capability === "text") {     return Boolean(route.primaryModel);   }   if (c... |
| 723 | if-elseif链无else兜底 | low | if (capability === "image") {     return /image\|dall\|gpt-image\|flux\|sd\|comfy/i.t... |
| 729 | if-elseif链无else兜底 | low | if (capability === "thinking") {     return /pro\|reason\|thinking\|claude\|gpt/i.te... |
| 738 | export函数超过100行 | low | export function inferProviderForRouteModel |

### packages/tui/src/model-loop-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 72 | export函数超过100行 | low | export function createToolInputSchema |
| 227 | export函数超过100行 | low | export function createSearchExtraToolsInputSchema |
| 238 | export函数超过100行 | low | export function createExecuteExtraToolInputSchema |
| 250 | export函数超过100行 | low | export function createCommandProposalInputSchema |
| 262 | export函数超过100行 | low | export function createStartAgentInputSchema |
| 282 | export函数超过100行 | low | export function createAgentControlInputSchema |
| 296 | export函数超过100行 | low | export function createSendMessageInputSchema |
| 319 | export函数超过100行 | low | export function createRunWorkflowInputSchema |
| 341 | export函数超过100行 | low | export function createIndexOperationInputSchema |
| 353 | export函数超过100行 | low | export function createRunVerificationInputSchema |
| 367 | export函数超过100行 | low | export function createWriteReportInputSchema |
| 380 | export函数超过100行 | low | export function createDeferredToolDispatchDefinitions |
| 395 | export函数超过100行 | low | export function createModelToolDefinitions |
| 452 | export函数超过100行 | low | export function createModelToolDefinitionsForTools |
| 462 | export函数超过100行 | low | export function createModelToolDefinitionsForReportGuard |
| 465 | if-elseif链无else兜底 | low | if (!guard \|\| guard.completed) {     return createModelToolDefinitions();   }   ... |
| 489 | export函数超过100行 | low | export function createToolUseDriftSummary |
| 497 | export函数超过100行 | low | export function readToolInputString |
| 523 | export函数超过100行 | low | export function isNaturalReadFileRequest |
| 529 | export函数超过100行 | low | export function hasModelSynthesisIntent |
| 535 | export函数超过100行 | low | export function looksLikeFilePath |
| 536 | 魔法数字(轮次/计数) | low | 12} |
| 539 | export函数超过100行 | low | export function extractNaturalReadPath |
| 555 | export函数超过100行 | low | export function normalizeRelativePath |
| 559 | export函数超过100行 | low | export function extractFileSearchKeywords |
| 591 | export函数超过100行 | low | export function matchesFileKeywords |
| 600 | export函数超过100行 | low | export function extractFileMentions |
| 608 | export函数超过100行 | low | export function formatFileCandidates |
| 627 | export函数超过100行 | low | export function createSolutionCompletenessStatus |
| 643 | export函数超过100行 | low | export function inferSolutionCompletenessImpactAreas |
| 682 | export函数超过100行 | low | export function formatSolutionCompletenessTrigger |
| 685 | if-elseif链无else兜底 | low | if (triggerReason === "user_request") {     return "\u7528\u6237\u660e\u786e\u89... |
| 691 | if-elseif链无else兜底 | low | if (triggerReason === "audit_finding") {     return "verifier/\u5ba1\u8ba1\u6307... |
| 772 | export函数超过100行 | low | export function isEvidenceStaleForClaim |
| 814 | export函数超过100行 | low | export function extractStructuredFinalAnswerClaims |
| 818 | export函数超过100行 | low | export function detectHighRiskClaims |
| 850 | catch返回空数组 | low | } catch {     return [];   } |
| 865 | export函数超过100行 | low | export function stripStructuredFinalAnswerClaims |
| 941 | if-elseif链无else兜底 | low | if (claim === "test") {     return record.supportsClaims.includes("test_passed")... |
| 947 | if-elseif链无else兜底 | low | if (claim === "build") {     return record.supportsClaims.includes("build_passed... |
| 1044 | export函数超过100行 | low | export function evidenceSupportsLocalCodeFact |
| 1045 | if-elseif链无else兜底 | low | if (record.kind === "index_query") {     return evidenceSupportsIndexCodeFact(re... |
| 1092 | if-elseif链无else兜底 | low | if (record.kind === "image_result") {     return record.supportsClaims.includes(... |
| 1144 | export函数超过100行 | low | export function evaluateFinalAnswerClaims |
| 1155 | export函数超过100行 | low | export function evaluateStructuredFinalAnswerClaims |
| 1284 | export函数超过100行 | low | export function createFinalAnswerClaimReminder |
| 1305 | export函数超过100行 | low | export function buildDowngradedFinalAnswer |
| 1366 | export函数超过100行 | low | export function evaluateArchitectureAndCompletenessClaims |
| 1423 | export函数超过100行 | low | export function createExtendedFinalAnswerReminder |
| 1435 | export函数超过100行 | low | export function buildExtendedDowngradedFinalAnswer |
| 1459 | export函数超过100行 | low | export function finalAnswerHasCompletenessClassification |
| 1463 | export函数超过100行 | low | export function hasArchitectureEvidenceForClaims |
| 1517 | export函数超过100行 | low | export function projectRuntimeStatusForPrompt |
| 1583 | export函数超过100行 | low | export function sanitizeDeferredToolPrimaryText |
| 1612 | 魔法数字(轮次/计数) | low | 10) |
| 1634 | export函数超过100行 | low | export function deriveToolSupportsClaims |

### packages/tui/src/model-prompt-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 14 | 魔法数字(轮次/计数) | low | 3; |
| 16 | export函数超过100行 | low | export function createModelSystemPrompt |
| 47 | TuiContext直接字段修改 | low | context.language = |
| 51 | TuiContext直接字段修改 | low | context.language = |
| 55 | TuiContext直接字段修改 | low | context.language = |
| 59 | TuiContext直接字段修改 | low | context.language = |
| 65 | export函数超过100行 | low | export function createEvidenceSummaryForModel |
| 67 | 魔法数字(轮次/计数) | low | 5) |
| 72 | 魔法数字(轮次/计数) | low | 5) |
| 77 | export函数超过100行 | low | export function updateSolutionCompletenessGate |
| 81 | TuiContext直接字段修改 | low | context.solutionCompleteness =  |
| 90 | TuiContext直接字段修改 | low | context.solutionCompleteness =  |
| 95 | export函数超过100行 | low | export function collectSolutionCompletenessEvidenceRefs |
| 96 | 魔法数字(轮次/计数) | low | 3) |
| 98 | 魔法数字(轮次/计数) | low | 3) |
| 199 | export函数超过100行 | low | export function sanitizeMainScreenLeakage |
| 235 | 魔法数字(轮次/计数) | low | 3, |

### packages/tui/src/model-setup-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 40 | export函数超过100行 | low | export function getNextModelSetupStep |
| 52 | export函数超过100行 | low | export function parseModelSetupPrefill |
| 69 | 魔法数字(轮次/计数) | low | 8, |
| 75 | export函数超过100行 | low | export function normalizeModelSetupReasoningLevel |
| 82 | export函数超过100行 | low | export function looksLikeModelSetupInput |
| 98 | export函数超过100行 | low | export function applyModelSetupValues |
| 104 | export函数超过100行 | low | export function validateModelSetupPartial |
| 120 | export函数超过100行 | low | export function getModelSetupPromptMessage |
| 132 | export函数超过100行 | low | export function formatModelSetupMessage |
| 198 | export函数超过100行 | low | export function formatModelSetupFallbackError |
| 204 | export函数超过100行 | low | export function formatModelSetupSummary |
| 220 | export函数超过100行 | low | export function formatModelSetupSaved |

### packages/tui/src/model-stream-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 155 | export函数超过100行 | low | export function handleNaturalInput |
| 161 | export函数超过100行 | low | export function handleNaturalInput |
| 168 | export函数超过100行 | low | export async function handleNaturalInput |
| 186 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 193 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 200 | TuiContext直接字段修改 | low | context.language = |
| 216 | if-elseif链无else兜底 | low | if (decision === "expired") {       context.pendingNaturalCommand = undefined;  ... |
| 217 | TuiContext直接字段修改 | low | context.pendingNaturalCommand =  |
| 233 | TuiContext直接字段修改 | low | context.pendingNaturalCommand =  |
| 239 | TuiContext直接字段修改 | low | context.pendingNaturalCommand =  |
| 265 | TuiContext直接字段修改 | low | context.currentArchitectureCard =  |
| 268 | if-elseif链无else兜底 | low | if (modelGuard) {     writeLine(output, modelGuard);     return "handled";   }  ... |
| 281 | export函数超过100行 | low | export function clearRequestActivity |
| 288 | TuiContext直接字段修改 | low | context.lastModelRequest =  |
| 295 | TuiContext直接字段修改 | low | context.requestActivity =  |
| 296 | TuiContext直接字段修改 | low | context.requestActivityPhase =  |
| 297 | TuiContext直接字段修改 | low | context.requestActivityToolName =  |
| 301 | export函数超过100行 | low | export function startRequestActivity |
| 308 | TuiContext直接字段修改 | low | context.requestActivityPhase =  |
| 309 | TuiContext直接字段修改 | low | context.requestActivityToolName =  |
| 329 | TuiContext直接字段修改 | low | context.requestActivity =  |
| 337 | TuiContext直接字段修改 | low | context.requestActivity =  |
| 342 | TuiContext直接字段修改 | low | context.requestActivity =  |
| 359 | export函数超过100行 | low | export async function sendMessage |
| 392 | TuiContext直接字段修改 | low | context.sessionEnded =  |
| 395 | TuiContext直接字段修改 | low | context.model =  |
| 415 | TuiContext直接字段修改 | low | context.activeAbortController =  |
| 417 | TuiContext直接字段修改 | low | context.interrupt =  |
| 434 | TuiContext直接字段修改 | low | context.currentArchitectureCard =  |
| 492 | TuiContext直接字段修改 | low | context.lastMetaSchedulerFailureLearningRequired =      |
| 494 | TuiContext直接字段修改 | low | context.lastMetaSchedulerFailureLearningFulfilled =  |
| 553 | TuiContext直接字段修改 | low | context.language = |
| 568 | TuiContext直接字段修改 | low | context.activeAbortController =  |
| 570 | TuiContext直接字段修改 | low | context.interrupt =  |
| 580 | TuiContext直接字段修改 | low | context.language = |
| 590 | TuiContext直接字段修改 | low | context.activeAbortController =  |
| 592 | TuiContext直接字段修改 | low | context.interrupt =  |
| 617 | if-elseif链无else兜底 | low | if (controller.signal.aborted) {           clearRequestActivity(context);       ... |
| 701 | TuiContext直接字段修改 | low | context.model =  |
| 878 | TuiContext直接字段修改 | low | context.language = |
| 890 | TuiContext直接字段修改 | low | context.language = |
| 893 | TuiContext直接字段修改 | low | context.language = |
| 923 | TuiContext直接字段修改 | low | context.activeAbortController =  |
| 925 | TuiContext直接字段修改 | low | context.interrupt =  |
| 1024 | export函数超过100行 | low | export async function __testSendMessage |
| 1139 | TuiContext直接字段修改 | low | context.notifications.push( |
| 1176 | TuiContext直接字段修改 | low | context.notifications.push( |
| 1179 | TuiContext直接字段修改 | low | context.language = |
| 1194 | 魔法数字(轮次/计数) | low | 100; |
| 1203 | 魔法数字(轮次/计数) | low | 50; |
| 1205 | 魔法数字(轮次/计数) | low | 10; |
| 1248 | export函数超过100行 | low | export async function handleRemoteInboundMessage |
| 1310 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 1352 | export函数超过100行 | low | export async function buildModelMessagesWithRecentContext |
| 1526 | if-elseif链无else兜底 | low | if (signal.aborted) {       clearRequestActivity(context);       endAssistantStr... |
| 1772 | TuiContext直接字段修改 | low | context.language = |
| 1836 | if-elseif链无else兜底 | low | if (kind === "bash") {     return (       record.supportsClaims.includes("Bash")... |
| 1858 | 魔法数字(轮次/计数) | low | 12} |
| 1861 | export函数超过100行 | low | export async function continueModelAfterToolResults |
| 1868 | TuiContext直接字段修改 | low | context.activeAbortController =  |
| 1870 | TuiContext直接字段修改 | low | context.interrupt =  |
| 1934 | if-elseif链无else兜底 | low | if (controller.signal.aborted) {           clearRequestActivity(context);       ... |
| 2159 | TuiContext直接字段修改 | low | context.language = |
| 2171 | TuiContext直接字段修改 | low | context.language = |
| 2174 | TuiContext直接字段修改 | low | context.language = |
| 2280 | TuiContext直接字段修改 | low | context.activeAbortController =  |
| 2282 | TuiContext直接字段修改 | low | context.interrupt =  |

### packages/tui/src/model-tool-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 219 | export函数超过100行 | low | export async function executeModelToolUse |
| 303 | TuiContext直接字段修改 | low | context.language = |
| 315 | TuiContext直接字段修改 | low | context.language = |
| 319 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 334 | TuiContext直接字段修改 | low | context.language = |
| 405 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 433 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 468 | if-elseif链无else兜底 | low | if (toolName === "Bash") {     return runBoundaryBashPreflight(toolCall, context... |
| 541 | export函数超过100行 | low | export function formatBoundaryEditPreflightPrompt |
| 559 | export函数超过100行 | low | export async function executeApprovedModelToolUse |
| 734 | export函数超过100行 | low | export async function executeDeferredDispatchToolUse |
| 823 | TuiContext直接字段修改 | low | context.language = |
| 840 | TuiContext直接字段修改 | low | context.language = |
| 855 | TuiContext直接字段修改 | low | context.language = |
| 982 | export函数超过100行 | low | export async function executeLinghunControlToolUse |
| 1235 | TuiContext直接字段修改 | low | context.commandPanelState =  |
| 1319 | export函数超过100行 | low | export function __testFormatStartAgentDidNotStartMessage |
| 1343 | TuiContext直接字段修改 | low | context.language = |
| 1500 | export函数超过100行 | low | export function __testParseRunWorkflowToolInput |
| 1690 | TuiContext直接字段修改 | low | context.language = |
| 1723 | if-elseif链无else兜底 | low | if (toolName === RUN_WORKFLOW_TOOL_NAME) {     const status = isRecord(data) && ... |
| 1803 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 1844 | export函数超过100行 | low | export async function executeIndexToolUse |
| 1930 | TuiContext直接字段修改 | low | context.permissionMode = |
| 1967 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 1996 | export函数超过100行 | low | export async function executeApprovedIndexToolUse |
| 2058 | TuiContext直接字段修改 | low | context.language = |
| 2115 | TuiContext直接字段修改 | low | context.language = |
| 2118 | TuiContext直接字段修改 | low | context.language = |
| 2124 | TuiContext直接字段修改 | low | context.language = |
| 2131 | export函数超过100行 | low | export function rememberToolFiles |
| 2150 | TuiContext直接字段修改 | low | context.recentlyMentionedFiles =  |
| 2153 | 魔法数字(轮次/计数) | low | 10) |
| 2193 | export函数超过100行 | low | export async function recordReportIncompleteEvidence |
| 2236 | if-elseif链无else兜底 | low | if (recentMatches.length > 0) {     return uniqueStrings(recentMatches).slice(0,... |
| 2237 | 魔法数字(轮次/计数) | low | 5) |
| 2244 | 魔法数字(轮次/计数) | low | 5) |
| 2269 | if-elseif链无else兜底 | low | if (files.length >= limit) {       return;     }     if (entry.name === "node_mo... |
| 2286 | export函数超过100行 | low | export async function handleToolCommand |
| 2335 | TuiContext直接字段修改 | low | context.permissionMode = |
| 2497 | export函数超过100行 | low | export function formatPlanProposal |
| 2507 | export函数超过100行 | low | export async function maybeCreateCheckpoint |
| 2539 | TuiContext直接字段修改 | low | context.checkpoints.unshift( |
| 2540 | TuiContext直接字段修改 | low | context.checkpoints =  |
| 2571 | TuiContext直接字段修改 | low | context.language = |
| 2575 | 魔法数字(毫秒超时) | low | 30_000 |
| 2576 | 魔法数字(毫秒超时) | low | 120_000 |
| 2579 | TuiContext直接字段修改 | low | context.language = |
| 2583 | TuiContext直接字段修改 | low | context.language = |
| 2657 | TuiContext直接字段修改 | low | context.language = |

### packages/tui/src/natural-command-bridge.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 1058 | export函数超过100行 | low | export function getCommandCapabilityCatalog |
| 1067 | export函数超过100行 | low | export function validateCommandCapabilityCoverage |
| 1138 | export函数超过100行 | low | export function getUserVisibleCommandCapabilities |
| 1147 | export函数超过100行 | low | export function buildRuntimeStatusForModel |
| 1168 | 魔法数字(轮次/计数) | low | 8) |
| 1182 | export函数超过100行 | low | export function createModelCapabilitySummary |
| 1194 | export函数超过100行 | low | export function routeNaturalIntent |
| 1229 | 魔法数字(轮次/计数) | low | 5, |
| 1241 | 魔法数字(轮次/计数) | low | 5) |
| 1244 | 魔法数字(轮次/计数) | low | 8, |
| 1249 | if-elseif链无else兜底 | low | if (!explicit && currentWorkCapability) {     return createIntent(       "execut... |
| 1277 | 魔法数字(轮次/计数) | low | 5) |
| 1289 | 魔法数字(轮次/计数) | low | 5) |
| 1301 | 魔法数字(轮次/计数) | low | 5) |
| 1313 | 魔法数字(轮次/计数) | low | 5) |
| 1325 | 魔法数字(轮次/计数) | low | 5) |
| 1366 | 魔法数字(轮次/计数) | low | 8, |
| 1366 | 魔法数字(轮次/计数) | low | 5) |
| 1378 | 魔法数字(轮次/计数) | low | 5) |
| 1389 | 魔法数字(轮次/计数) | low | 5) |
| 1398 | 魔法数字(轮次/计数) | low | 5) |
| 1403 | 魔法数字(轮次/计数) | low | 8) |
| 1415 | 魔法数字(轮次/计数) | low | 5, |
| 1439 | 魔法数字(轮次/计数) | low | 8, |
| 1463 | 魔法数字(轮次/计数) | low | 5) |
| 1475 | 魔法数字(轮次/计数) | low | 5) |
| 1486 | 魔法数字(轮次/计数) | low | 5) |
| 1497 | export函数超过100行 | low | export function formatNaturalClarification |
| 1502 | 魔法数字(轮次/计数) | low | 3) |
| 1520 | export函数超过100行 | low | export function formatCapabilityAnswer |
| 1547 | export函数超过100行 | low | export function formatNaturalPermissionBlock |
| 1577 | export函数超过100行 | low | export function createPendingNaturalCommand |
| 1588 | 魔法数字(轮次/计数) | low | 8) |
| 1601 | export函数超过100行 | low | export function formatNaturalStartGate |
| 1614 | if-elseif链无else兜底 | low | if (c?.id === "trust") {     return intent.language === "en-US"       ? [       ... |
| 1643 | export函数超过100行 | low | export function isNaturalGateExpired |
| 1647 | export函数超过100行 | low | export function matchesNaturalGateConfirmation |
| 1677 | if-elseif链无else兜底 | low | if (c.risk === "dangerous") {     return language === "en-US"       ? "High risk... |
| 1687 | if-elseif链无else兜底 | low | if (c.risk === "config_write") {     return language === "en-US"       ? "May ch... |
| 1705 | export函数超过100行 | low | export function formatRiskLine |
| 2035 | 魔法数字(轮次/计数) | low | 3; |
| 2044 | 魔法数字(轮次/计数) | low | 3; |
| 2049 | 魔法数字(轮次/计数) | low | 3; |
| 2055 | 魔法数字(轮次/计数) | low | 5; |
| 2056 | 魔法数字(轮次/计数) | low | 3; |
| 2057 | 魔法数字(轮次/计数) | low | 3; |
| 2064 | 魔法数字(轮次/计数) | low | 3; |
| 2066 | 魔法数字(轮次/计数) | low | 8; |
| 2071 | 魔法数字(轮次/计数) | low | 4; |
| 2078 | 魔法数字(轮次/计数) | low | 5; |
| 2079 | 魔法数字(轮次/计数) | low | 3; |
| 2080 | 魔法数字(轮次/计数) | low | 3; |
| 2081 | 魔法数字(轮次/计数) | low | 5; |
| 2089 | 魔法数字(轮次/计数) | low | 4; |
| 2103 | 魔法数字(轮次/计数) | low | 4; |
| 2141 | 魔法数字(轮次/计数) | low | 4, |
| 2164 | if-elseif链无else兜底 | low | if (capability.id === "cache") {     return normalized.includes("refresh") \|\|   ... |
| 2210 | if-elseif链无else兜底 | low | if (capability.id === "trust") {     return "/trust status";   }   if (capabilit... |

### packages/tui/src/pending-details-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 15 | export函数超过100行 | low | export function formatWorkspaceTrustStatus |
| 21 | TuiContext直接字段修改 | low | context.language = |
| 38 | export函数超过100行 | low | export function formatPendingApprovalDetails |
| 43 | TuiContext直接字段修改 | low | context.language = |
| 63 | TuiContext直接字段修改 | low | context.language = |
| 80 | TuiContext直接字段修改 | low | context.language = |
| 98 | if-elseif链无else兜底 | low | if (approval.kind === "git_stable_point") {     return context.language === "en-... |
| 99 | TuiContext直接字段修改 | low | context.language = |
| 117 | TuiContext直接字段修改 | low | context.language = |
| 134 | TuiContext直接字段修改 | low | context.language = |
| 152 | TuiContext直接字段修改 | low | context.language = |
| 169 | export函数超过100行 | low | export function formatPendingNaturalCommandDetails |
| 174 | TuiContext直接字段修改 | low | context.language = |
| 190 | TuiContext直接字段修改 | low | context.language = |

### packages/tui/src/permission-approval-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 73 | export函数超过100行 | low | export async function handleTuiKeypress |
| 80 | TuiContext直接字段修改 | low | context.ctrlOExpandState =  |
| 103 | export函数超过100行 | low | export async function cancelPendingInteraction |
| 110 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 122 | TuiContext直接字段修改 | low | context.pendingNaturalCommand =  |
| 127 | if-elseif链无else兜底 | low | if (context.pendingAutopilot) {     context.pendingAutopilot = undefined;     wr... |
| 128 | TuiContext直接字段修改 | low | context.pendingAutopilot =  |
| 134 | TuiContext直接字段修改 | low | context.activePlan =  |
| 135 | TuiContext直接字段修改 | low | context.planAccepted =  |
| 141 | TuiContext直接字段修改 | low | context.notifications =  |
| 142 | TuiContext直接字段修改 | low | context.notifications.push( |
| 145 | TuiContext直接字段修改 | low | context.language = |
| 156 | export函数超过100行 | low | export async function reevaluatePendingLocalApprovalAfterModeChange |
| 171 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 196 | export函数超过100行 | low | export function hasPendingEnterConfirmation |
| 205 | export函数超过100行 | low | export async function confirmPendingInteraction |
| 209 | if-elseif链无else兜底 | low | if (context.pendingNaturalCommand?.requiresExactConfirmation) {     writeLine(  ... |
| 221 | if-elseif链无else兜底 | low | if (context.pendingLocalApproval) {     await handleNaturalInput("yes", context,... |
| 241 | export函数超过100行 | low | export async function handleModeCommand |
| 261 | export函数超过100行 | low | export async function cycleMode |
| 271 | TuiContext直接字段修改 | low | context.language = |
| 297 | TuiContext直接字段修改 | low | context.permissionMode =  |
| 298 | TuiContext直接字段修改 | low | context.planAccepted =  |
| 313 | export函数超过100行 | low | export async function handlePlanCommand |
| 333 | TuiContext直接字段修改 | low | context.planAccepted =  |
| 334 | TuiContext直接字段修改 | low | context.permissionMode =  |
| 371 | TuiContext直接字段修改 | low | context.planAccepted =  |
| 400 | TuiContext直接字段修改 | low | context.activePlan =  |
| 401 | TuiContext直接字段修改 | low | context.permissionMode =  |
| 402 | TuiContext直接字段修改 | low | context.planAccepted =  |
| 433 | export函数超过100行 | low | export async function addAllowRuleForTest |
| 446 | export函数超过100行 | low | export async function executePermissionApprove |
| 564 | if-elseif链无else兜底 | low | if (approval.kind === "git_worktree_remove") {     await resolveWorktreeRemoveAp... |
| 631 | if-elseif链无else兜底 | low | if (approval.kind === "memory_mutation") {     await executeMemoryMutation(conte... |
| 653 | export函数超过100行 | low | export async function executePermissionDeny |
| 714 | TuiContext直接字段修改 | low | context.language = |
| 819 | if-elseif链无else兜底 | low | if (approval.kind === "git_worktree_remove") {     await resolveWorktreeRemoveDe... |
| 923 | TuiContext直接字段修改 | low | context.language = |
| 939 | TuiContext直接字段修改 | low | context.language = |
| 955 | TuiContext直接字段修改 | low | context.language = |
| 966 | export函数超过100行 | low | export async function handlePermissionsCommand |
| 972 | if-elseif链无else兜底 | low | if (!action) {     writeLine(output, formatPermissionRules(context.permissions))... |
| 977 | if-elseif链无else兜底 | low | if (rest[0] === "clear") {       context.permissions.recentDenied = [];       aw... |
| 1009 | 魔法数字(轮次/计数) | low | 5) |
| 1014 | 魔法数字(轮次/计数) | low | 5) |
| 1015 | 魔法数字(轮次/计数) | low | 5} |
| 1029 | if-elseif链无else兜底 | low | if (action === "add") {     const effect = rest[0] as PermissionRule["effect"] \|... |

### packages/tui/src/permission-continuation-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 77 | export函数超过100行 | low | export function formatPermissionDenialPrimary |
| 83 | export函数超过100行 | low | export function formatPermissionDenied |
| 87 | export函数超过100行 | low | export function formatPermissionSummary |
| 96 | export函数超过100行 | low | export function formatDiffBeforeWrite |
| 105 | export函数超过100行 | low | export function isLowRiskWorkspaceEdit |
| 117 | export函数超过100行 | low | export function collectInputFiles |
| 127 | export函数超过100行 | low | export function getHardDenyReason |
| 174 | export函数超过100行 | low | export function findPermissionRule |
| 185 | export函数超过100行 | low | export function isPlanAllowedTool |
| 189 | export函数超过100行 | low | export function parsePermissionModeInput |
| 198 | export函数超过100行 | low | export function formatPermissionRules |
| 209 | export函数超过100行 | low | export function formatRecentDenied |
| 218 | export函数超过100行 | low | export function hasRepeatedPermissionDenial |
| 219 | 魔法数字(轮次/计数) | low | 5) |
| 225 | 魔法数字(轮次/计数) | low | 3) |
| 232 | export函数超过100行 | low | export function createReportWriteGuard |
| 249 | export函数超过100行 | low | export function isReportFileWriteRequest |
| 260 | export函数超过100行 | low | export function extractRequestedReportPath |
| 279 | export函数超过100行 | low | export function normalizeReportPath |
| 283 | export函数超过100行 | low | export function shouldSendReportEvidenceReminder |
| 287 | export函数超过100行 | low | export function shouldSendReportWriteReminder |
| 291 | export函数超过100行 | low | export function shouldSendReportFinalReferenceReminder |
| 302 | export函数超过100行 | low | export function hasReportFinalAnswerShape |
| 308 | export函数超过100行 | low | export function createReportFinalReferenceReminder |
| 317 | export函数超过100行 | low | export function createReportTaskGuard |
| 323 | export函数超过100行 | low | export function createReportWriteReminder |
| 329 | export函数超过100行 | low | export function doesWriteSatisfyReportGuard |
| 339 | export函数超过100行 | low | export function hasReportWriteToolCall |
| 368 | export函数超过100行 | low | export function formatModelToolOutput |
| 382 | if-elseif链无else兜底 | low | if (toolName === "Write") {     return language === "en-US" ? "Report file write... |
| 397 | export函数超过100行 | low | export function normalizeToolName |
| 408 | export函数超过100行 | low | export function redactRemoteSummary |
| 431 | export函数超过100行 | low | export function remoteTranscriptSummary |

### packages/tui/src/permission-policy-engine.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 333 | export函数超过100行 | low | export function classifyToolRequest |
| 650 | if-elseif链无else兜底 | low | if (sub === "config") {     const setLike = args.some((a) =>       [         "--... |
| 667 | if-elseif链无else兜底 | low | if (sub === "remote") {     const verb = args.filter((a) => !a.startsWith("-"))[... |
| 822 | export函数超过100行 | low | export function classifyPathString |
| 902 | export函数超过100行 | low | export function tokenizeShellCommand |
| 968 | 魔法数字(轮次/计数) | low | 200) |
| 973 | 魔法数字(轮次/计数) | low | 12, |

### packages/tui/src/permission-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 13 | export函数超过100行 | low | export function formatLocalToolPermissionPrompt |
| 39 | export函数超过100行 | low | export function formatModelToolPermissionPrompt |

### packages/tui/src/process-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 7 | export函数超过100行 | low | export function redactedPath |
| 14 | export函数超过100行 | low | export async function runCommandCapture |
| 76 | 魔法数字(轮次/计数) | low | 200, |

### packages/tui/src/process-guard.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 54 | if-elseif链无else兜底 | low | if (child.exitCode !== undefined && child.exitCode !== null) {       return fals... |
| 133 | export函数超过100行 | low | export function createProcessGuard |
| 157 | export函数超过100行 | low | export function trackChildProcess |
| 164 | export函数超过100行 | low | export function requestTrackedProcessStop |
| 170 | export函数超过100行 | low | export function cleanupTrackedProcessesForExit |
| 174 | export函数超过100行 | low | export function consumeProcessGuardStopResultsForTest |
| 178 | export函数超过100行 | low | export function getTrackedProcessSnapshot |
| 182 | export函数超过100行 | low | export function installProcessGuardExitHandlers |
| 202 | 魔法数字(轮次/计数) | low | 20) |

### packages/tui/src/provider-circuit-breaker.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 30 | 魔法数字(毫秒超时) | low | 45_000 |
| 46 | export函数超过100行 | low | export function createProviderCircuitBreakerState |
| 50 | export函数超过100行 | low | export function makeBreakerKey |
| 58 | export函数超过100行 | low | export function isRecoverableProviderFailure |
| 66 | export函数超过100行 | low | export function recordProviderFailure |
| 94 | export函数超过100行 | low | export function clearProviderBreaker |
| 110 | export函数超过100行 | low | export function checkProviderCooldown |
| 138 | export函数超过100行 | low | export function formatCooldownMessage |
| 162 | export函数超过100行 | low | export function formatCooldownDoctorLine |

### packages/tui/src/provider-loop-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 62 | export函数超过100行 | low | export function resolveRuntimeFallback |
| 81 | export函数超过100行 | low | export async function recordProviderFallbackAttempt |
| 102 | TuiContext直接字段修改 | low | context.lastProviderFallbackAttempt =  |
| 119 | TuiContext直接字段修改 | low | context.routeDecisions.unshift( |
| 120 | 魔法数字(轮次/计数) | low | 8) |
| 143 | export函数超过100行 | low | export function checkAndWriteProviderCooldown |

### packages/tui/src/remote-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 69 | export函数超过100行 | low | export function configureRemoteCommandRuntime |
| 73 | export函数超过100行 | low | export function configureRemoteTransport |
| 84 | export函数超过100行 | low | export function refreshRemoteState |
| 86 | TuiContext直接字段修改 | low | context.remote =  |
| 95 | export函数超过100行 | low | export async function handleRemoteCommand |
| 104 | TuiContext直接字段修改 | low | context.language = |
| 137 | TuiContext直接字段修改 | low | context.language = |
| 151 | TuiContext直接字段修改 | low | context.language = |
| 189 | TuiContext直接字段修改 | low | context.language = |
| 215 | TuiContext直接字段修改 | low | context.language = |
| 228 | TuiContext直接字段修改 | low | context.language = |
| 236 | if-elseif链无else兜底 | low | if (action === "inbox") {     await handleRemoteInboxCommand(args.slice(1), cont... |
| 260 | if-elseif链无else兜底 | low | if (action === "inbox") {     await handleRemoteInboxCommand(args.slice(1), cont... |
| 425 | TuiContext直接字段修改 | low | context.language = |
| 459 | if-elseif链无else兜底 | low | if (action === "start") {     const channel = findRemoteChannel(context, args[1]... |
| 494 | TuiContext直接字段修改 | low | context.language = |
| 535 | TuiContext直接字段修改 | low | context.language = |
| 549 | TuiContext直接字段修改 | low | context.language = |
| 587 | TuiContext直接字段修改 | low | context.language = |
| 791 | export函数超过100行 | low | export function formatRemoteEvents |
| 796 | 魔法数字(轮次/计数) | low | 10) |
| 805 | export函数超过100行 | low | export function formatRemoteDoctor |
| 989 | if-elseif链无else兜底 | low | if (channel.id === "feishu") {     const readiness = getFeishuBotStartReadiness(... |
| 1032 | export函数超过100行 | low | export function getRemoteCapabilityGrade |
| 1085 | export函数超过100行 | low | export function formatRemoteSetup |
| 1182 | export函数超过100行 | low | export function findRemoteChannel |
| 1190 | export函数超过100行 | low | export function normalizeRemoteChannelId |
| 1197 | export函数超过100行 | low | export function getRemoteLoginHint |
| 1198 | if-elseif链无else兜底 | low | if (type === "feishu" \|\| type === "lark") {     return "检测 lark-cli / feishu-cli... |
| 1207 | export函数超过100行 | low | export function getRemoteInstallHint |
| 1208 | if-elseif链无else兜底 | low | if (type === "feishu" \|\| type === "lark") {     return "install lark-cli/feishu-... |
| 1217 | export函数超过100行 | low | export function createRemoteEvent |
| 1225 | 魔法数字(轮次/计数) | low | 8) |
| 1233 | 魔法数字(轮次/计数) | low | 12) |
| 1241 | export函数超过100行 | low | export function sendRemoteEvent |
| 1254 | 魔法数字(轮次/计数) | low | 20) |
| 1262 | export函数超过100行 | low | export async function sendRemoteEventReal |
| 1274 | 魔法数字(轮次/计数) | low | 20) |
| 1283 | if-elseif链无else兜底 | low | if (channel.config.transport === "webhook_mock") {     return finalize("mock", "... |
| 1315 | export函数超过100行 | low | export function processRemoteApprovalForTest |
| 1325 | export函数超过100行 | low | export function processRemoteApproval |
| 1338 | if-elseif链无else兜底 | low | if (!channel \|\| channel.runtimeStatus !== "ready") {     return reject("blocked"... |
| 1369 | 魔法数字(轮次/计数) | low | 50) |
| 1380 | export函数超过100行 | low | export function verifyRemoteSignature |
| 1394 | export函数超过100行 | low | export function verifyRemoteInboundSignature |
| 1411 | export函数超过100行 | low | export function processRemoteInbound |
| 1422 | TuiContext直接字段修改 | low | context.permissionMode = |
| 1509 | export函数超过100行 | low | export function validateRemoteInboundEnvelope |
| 1551 | export函数超过100行 | low | export function validateRemotePairingEnvelope |
| 1592 | export函数超过100行 | low | export function consumeRemoteInboundMessage |
| 1594 | 魔法数字(轮次/计数) | low | 50) |
| 1597 | export函数超过100行 | low | export async function appendRemoteSystemEvent |

### packages/tui/src/remote-inbound-bridge-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 146 | export函数超过100行 | low | export function getRemoteBridgeDoctor |
| 168 | export函数超过100行 | low | export function formatRemoteBridgeDoctor |
| 182 | export函数超过100行 | low | export function createSignedRemoteInboundFixture |
| 198 | 魔法数字(毫秒超时) | low | 60_000 |
| 207 | export函数超过100行 | low | export function createRemotePairing |
| 228 | 魔法数字(轮次/计数) | low | 5, |
| 239 | export函数超过100行 | low | export function formatRemotePairing |
| 254 | export函数超过100行 | low | export function formatRemotePairingStatus |
| 266 | export函数超过100行 | low | export function cancelRemotePairing |
| 279 | export函数超过100行 | low | export function processRemoteBindCommand |
| 307 | export函数超过100行 | low | export function validateRemotePairingCode |
| 334 | export函数超过100行 | low | export function decideRemoteInbox |
| 367 | 魔法数字(轮次/计数) | low | 20) |
| 371 | export函数超过100行 | low | export function formatRemoteInbox |
| 376 | 魔法数字(轮次/计数) | low | 20) |
| 384 | export函数超过100行 | low | export function clearRemoteInbox |
| 390 | export函数超过100行 | low | export function rejectRemoteInboxItem |
| 396 | export函数超过100行 | low | export function drainRemoteInbox |
| 402 | export函数超过100行 | low | export function formatRemoteStatusSummary |
| 411 | export函数超过100行 | low | export function feishuBridgeAdapter |
| 415 | export函数超过100行 | low | export function feishuReceiveMessageToBridgeEvent |
| 440 | 魔法数字(毫秒超时) | low | 60_000 |
| 445 | export函数超过100行 | low | export function dingtalkBridgeAdapter |
| 449 | export函数超过100行 | low | export function dingtalkStreamFrameToBridgeEvent |
| 478 | 魔法数字(毫秒超时) | low | 60_000 |
| 483 | export函数超过100行 | low | export function wecomBridgeAdapter |
| 603 | if-elseif链无else兜底 | low | if (type === "feishu" \|\| type === "lark") {     return ["full-mobile-control-cap... |
| 613 | if-elseif链无else兜底 | low | if (channel.config.inboundMode === "callback") {     return channel.config.callb... |
| 633 | if-elseif链无else兜底 | low | if (readiness === "needs-daemon") {     return "Start/configure the official CLI... |
| 639 | if-elseif链无else兜底 | low | if (readiness === "needs-dingtalk-app") {     return "Configure a DingTalk app/S... |

### packages/tui/src/remote-mcp-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 3 | export函数超过100行 | low | export function formatRemoteStatus |
| 20 | export函数超过100行 | low | export function formatRemoteTestResult |
| 45 | export函数超过100行 | low | export function formatMcpTools |

### packages/tui/src/remote-transport.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 22 | 魔法数字(毫秒超时) | low | 15_000 |
| 119 | export函数超过100行 | low | export function buildWebhookRequest |
| 145 | export函数超过100行 | low | export function buildOfficialCliInvocation |
| 203 | catch返回null/undefined | low | } catch {     return undefined;   } |
| 209 | export函数超过100行 | low | export async function deliverWebhook |
| 248 | export函数超过100行 | low | export async function deliverOfficialCli |
| 296 | export函数超过100行 | low | export function defaultRemoteTransportDeps |

### packages/tui/src/request-lifecycle-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 11 | export函数超过100行 | low | export function formatRequestActivity |
| 22 | if-elseif链无else兜底 | low | if (phase === "waiting_first_delta") {       return "Still waiting for the model... |
| 28 | if-elseif链无else兜底 | low | if (phase === "continuing_after_tool") {       return "Continuing after the tool... |
| 39 | if-elseif链无else兜底 | low | if (phase === "waiting_first_delta") {     return "模型仍在等待响应。可用 /interrupt 中断本次请求... |
| 45 | if-elseif链无else兜底 | low | if (phase === "continuing_after_tool") {     return "工具结果已回传，正在继续生成…";   }   if ... |
| 54 | export函数超过100行 | low | export function formatProviderFailurePrimary |
| 56 | if-elseif链无else兜底 | low | if (language === "en-US") {     if (kind === "rate_limit") {       return "The m... |
| 63 | if-elseif链无else兜底 | low | if (kind === "reasoning_unsupported") {       return "This gateway or model does... |
| 69 | if-elseif链无else兜底 | low | if (kind === "not_found") {       return "The endpoint or model was not found. C... |
| 75 | if-elseif链无else兜底 | low | if (kind === "transit") {       return "The response stream failed in transit, s... |
| 81 | if-elseif链无else兜底 | low | if (kind === "abort") {       return "This request was interrupted. Input is rea... |
| 89 | if-elseif链无else兜底 | low | if (kind === "rate_limit") {     return "模型服务触发限流。本次请求未完成；请降低请求频率或稍后重试。若已配置备用模型，... |
| 95 | if-elseif链无else兜底 | low | if (kind === "reasoning_unsupported") {     return "当前网关或模型不接受推理参数。请降低推理等级或更换网关/... |
| 101 | if-elseif链无else兜底 | low | if (kind === "not_found") {     return "接口或模型不存在。本次请求未完成；请检查服务地址、接口类型和模型名称。可运行 /... |
| 107 | if-elseif链无else兜底 | low | if (kind === "transit") {     return "响应流传输失败，本次请求未完成。可能是模型服务、网关传输或本地兼容层问题；请稍后重试... |
| 113 | if-elseif链无else兜底 | low | if (kind === "abort") {     return "已中断本次请求，可以继续输入。";   }   if (kind === "schema... |
| 122 | export函数超过100行 | low | export function formatProviderFallbackAttemptSummary |
| 138 | export函数超过100行 | low | export function formatProviderFailureKindLabel |
| 159 | export函数超过100行 | low | export function formatProviderEmptyResponsePrimary |
| 167 | export函数超过100行 | low | export function formatProviderThinkingOnlyResponsePrimary |
| 173 | export函数超过100行 | low | export function formatReportEvidenceRequired |
| 179 | export函数超过100行 | low | export function formatReportIncompletePrimary |
| 198 | export函数超过100行 | low | export function classifyProviderFailure |

### packages/tui/src/runner-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 26 | 魔法数字(轮次/计数) | low | 100; |
| 45 | 魔法数字(轮次/计数) | low | 100; |
| 147 | export函数超过100行 | low | export function resolveNativeRunner |
| 259 | if-elseif链无else兜底 | low | if (runner.source === "bundled") {     return bundledCandidate.path;   }   if (r... |
| 364 | export函数超过100行 | low | export function formatNativeRunnerProcessGuardContract |
| 370 | export函数超过100行 | low | export function formatApprovedRunnerSpecLine |
| 381 | export函数超过100行 | low | export function createApprovedRunnerJobSpec |
| 409 | export函数超过100行 | low | export async function startRunnerForDurableJob |
| 563 | catch返回null/undefined | low | } catch {     return undefined;   } |
| 619 | export函数超过100行 | low | export function refreshRunnerStatusForJob |
| 671 | export函数超过100行 | low | export async function stopRunnerForDurableJob |
| 728 | export函数超过100行 | low | export function markJobRunnerTerminal |
| 772 | export函数超过100行 | low | export function markJobRunnerFallback |

### packages/tui/src/runtime-budget.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 1 | 魔法数字(轮次/计数) | low | 100; |
| 3 | 魔法数字(轮次/计数) | low | 100; |
| 9 | 魔法数字(轮次/计数) | low | 4; |
| 12 | 魔法数字(MB/KB) | low | 200_000 |
| 13 | 魔法数字(毫秒超时) | low | 30_000 |

### packages/tui/src/runtime-path-marker.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 106 | export函数超过100行 | low | export function classifyRuntimePath |
| 187 | export函数超过100行 | low | export function classifyStartupPath |
| 203 | export函数超过100行 | low | export function canClaimTuiMaturity |
| 211 | export函数超过100行 | low | export function canClaimCurrentVerification |
| 218 | export函数超过100行 | low | export function detectRuntimePathInflation |
| 239 | export函数超过100行 | low | export function formatRuntimePathMarker |
| 257 | export函数超过100行 | low | export function formatStartupPathMarker |

### packages/tui/src/runtime-status-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 17 | export函数超过100行 | low | export function formatRuntimeStatusLine |
| 18 | 魔法数字(轮次/计数) | low | 20) |
| 44 | export函数超过100行 | low | export function formatPermissionModeLabel |
| 66 | 魔法数字(轮次/计数) | low | 100, |
| 66 | 魔法数字(轮次/计数) | low | 100) |
| 74 | 魔法数字(轮次/计数) | low | 10) |

### packages/tui/src/runtime-status-snapshot.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 50 | export函数超过100行 | low | export function createRuntimeStatusSnapshot |
| 66 | 魔法数字(轮次/计数) | low | 3) |
| 104 | 魔法数字(轮次/计数) | low | 3) |
| 108 | export函数超过100行 | low | export function formatRuntimeStatusSnapshotForBtw |
| 120 | 魔法数字(轮次/计数) | low | 3) |
| 124 | 魔法数字(轮次/计数) | low | 3) |
| 128 | 魔法数字(轮次/计数) | low | 3) |
| 135 | 魔法数字(轮次/计数) | low | 3) |

### packages/tui/src/shell/clipboard.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 5 | export函数超过100行 | low | export async function writeTextToClipboard |
| 5 | export函数超过100行 | low | export async function writeTextToClipboard |

### packages/tui/src/shell/components/BtwPanel.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 35 | export函数超过100行 | low | export function BtwPanel |
| 35 | export函数超过100行 | low | export function BtwPanel |
| 35 | export函数超过100行 | low | export function BtwPanel |
| 63 | 魔法数字(轮次/计数) | low | 20, |
| 63 | 魔法数字(轮次/计数) | low | 20, |
| 63 | 魔法数字(轮次/计数) | low | 20, |
| 69 | 魔法数字(轮次/计数) | low | 8, |
| 69 | 魔法数字(轮次/计数) | low | 8, |
| 69 | 魔法数字(轮次/计数) | low | 8, |
| 80 | 魔法数字(轮次/计数) | low | 8) |
| 80 | 魔法数字(轮次/计数) | low | 8) |
| 80 | 魔法数字(轮次/计数) | low | 8) |

### packages/tui/src/shell/components/CommandPanel.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 35 | 魔法数字(轮次/计数) | low | 8; |
| 35 | 魔法数字(轮次/计数) | low | 8; |
| 35 | 魔法数字(轮次/计数) | low | 8; |
| 37 | export函数超过100行 | low | export function CommandPanel |
| 37 | export函数超过100行 | low | export function CommandPanel |
| 37 | export函数超过100行 | low | export function CommandPanel |
| 67 | 魔法数字(轮次/计数) | low | 20, |
| 67 | 魔法数字(轮次/计数) | low | 4) |
| 67 | 魔法数字(轮次/计数) | low | 20, |
| 67 | 魔法数字(轮次/计数) | low | 4) |
| 67 | 魔法数字(轮次/计数) | low | 20, |
| 67 | 魔法数字(轮次/计数) | low | 4) |

### packages/tui/src/shell/components/Composer.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 57 | export函数超过100行 | low | export function createEditBuffer |
| 57 | export函数超过100行 | low | export function createEditBuffer |
| 57 | export函数超过100行 | low | export function createEditBuffer |
| 61 | export函数超过100行 | low | export function bufferToString |
| 61 | export函数超过100行 | low | export function bufferToString |
| 61 | export函数超过100行 | low | export function bufferToString |
| 65 | export函数超过100行 | low | export function bufferDisplayWidth |
| 65 | export函数超过100行 | low | export function bufferDisplayWidth |
| 65 | export函数超过100行 | low | export function bufferDisplayWidth |
| 72 | export函数超过100行 | low | export function bufferInsert |
| 72 | export函数超过100行 | low | export function bufferInsert |
| 72 | export函数超过100行 | low | export function bufferInsert |
| 79 | export函数超过100行 | low | export function bufferBackspace |
| 79 | export函数超过100行 | low | export function bufferBackspace |
| 79 | export函数超过100行 | low | export function bufferBackspace |
| 86 | export函数超过100行 | low | export function bufferDelete |
| 86 | export函数超过100行 | low | export function bufferDelete |
| 86 | export函数超过100行 | low | export function bufferDelete |
| 93 | export函数超过100行 | low | export function bufferMoveLeft |
| 93 | export函数超过100行 | low | export function bufferMoveLeft |
| 93 | export函数超过100行 | low | export function bufferMoveLeft |
| 99 | export函数超过100行 | low | export function bufferMoveRight |
| 99 | export函数超过100行 | low | export function bufferMoveRight |
| 99 | export函数超过100行 | low | export function bufferMoveRight |
| 105 | export函数超过100行 | low | export function bufferHome |
| 105 | export函数超过100行 | low | export function bufferHome |
| 105 | export函数超过100行 | low | export function bufferHome |
| 110 | export函数超过100行 | low | export function bufferEnd |
| 110 | export函数超过100行 | low | export function bufferEnd |
| 110 | export函数超过100行 | low | export function bufferEnd |
| 115 | export函数超过100行 | low | export function bufferWordLeft |
| 115 | export函数超过100行 | low | export function bufferWordLeft |
| 115 | export函数超过100行 | low | export function bufferWordLeft |
| 125 | export函数超过100行 | low | export function bufferWordRight |
| 125 | export函数超过100行 | low | export function bufferWordRight |
| 125 | export函数超过100行 | low | export function bufferWordRight |
| 136 | export函数超过100行 | low | export function bufferDeleteWordLeft |
| 136 | export函数超过100行 | low | export function bufferDeleteWordLeft |
| 136 | export函数超过100行 | low | export function bufferDeleteWordLeft |
| 143 | export函数超过100行 | low | export function bufferClearLine |
| 143 | export函数超过100行 | low | export function bufferClearLine |
| 143 | export函数超过100行 | low | export function bufferClearLine |
| 149 | export函数超过100行 | low | export function bufferKillToEnd |
| 149 | export函数超过100行 | low | export function bufferKillToEnd |
| 149 | export函数超过100行 | low | export function bufferKillToEnd |
| 154 | export函数超过100行 | low | export function bufferMoveUp |
| 154 | export函数超过100行 | low | export function bufferMoveUp |
| 154 | export函数超过100行 | low | export function bufferMoveUp |
| 170 | export函数超过100行 | low | export function bufferMoveDown |
| 170 | export函数超过100行 | low | export function bufferMoveDown |
| 170 | export函数超过100行 | low | export function bufferMoveDown |
| 194 | export函数超过100行 | low | export function bufferMoveVisualUp |
| 194 | export函数超过100行 | low | export function bufferMoveVisualUp |
| 194 | export函数超过100行 | low | export function bufferMoveVisualUp |
| 199 | export函数超过100行 | low | export function bufferMoveVisualDown |
| 199 | export函数超过100行 | low | export function bufferMoveVisualDown |
| 199 | export函数超过100行 | low | export function bufferMoveVisualDown |
| 261 | 魔法数字(轮次/计数) | low | 8, |
| 261 | 魔法数字(轮次/计数) | low | 8, |
| 261 | 魔法数字(轮次/计数) | low | 8, |
| 272 | 魔法数字(轮次/计数) | low | 4, |
| 272 | 魔法数字(轮次/计数) | low | 4, |
| 272 | 魔法数字(轮次/计数) | low | 4, |
| 312 | export函数超过100行 | low | export function sanitizeComposerInput |
| 312 | export函数超过100行 | low | export function sanitizeComposerInput |
| 312 | export函数超过100行 | low | export function sanitizeComposerInput |
| 333 | 魔法数字(轮次/计数) | low | 100; |
| 333 | 魔法数字(轮次/计数) | low | 100; |
| 333 | 魔法数字(轮次/计数) | low | 100; |
| 335 | export函数超过100行 | low | export function createInputHistory |
| 335 | export函数超过100行 | low | export function createInputHistory |
| 335 | export函数超过100行 | low | export function createInputHistory |
| 339 | export函数超过100行 | low | export function historyAdd |
| 339 | export函数超过100行 | low | export function historyAdd |
| 339 | export函数超过100行 | low | export function historyAdd |
| 348 | export函数超过100行 | low | export function historyUp |
| 348 | export函数超过100行 | low | export function historyUp |
| 348 | export函数超过100行 | low | export function historyUp |
| 355 | export函数超过100行 | low | export function historyDown |
| 355 | export函数超过100行 | low | export function historyDown |
| 355 | export函数超过100行 | low | export function historyDown |
| 361 | export函数超过100行 | low | export function historyCurrentText |
| 361 | export函数超过100行 | low | export function historyCurrentText |
| 361 | export函数超过100行 | low | export function historyCurrentText |
| 377 | export函数超过100行 | low | export function shouldEnterPastePath |
| 377 | export函数超过100行 | low | export function shouldEnterPastePath |
| 377 | export函数超过100行 | low | export function shouldEnterPastePath |
| 407 | export函数超过100行 | low | export function isDoublePressWithin |
| 407 | export函数超过100行 | low | export function isDoublePressWithin |
| 407 | export函数超过100行 | low | export function isDoublePressWithin |
| 419 | export函数超过100行 | low | export function shouldUnstickSlashHidden |
| 419 | export函数超过100行 | low | export function shouldUnstickSlashHidden |
| 419 | export函数超过100行 | low | export function shouldUnstickSlashHidden |
| 428 | export函数超过100行 | low | export function isMultilineEnterSequence |
| 428 | export函数超过100行 | low | export function isMultilineEnterSequence |
| 428 | export函数超过100行 | low | export function isMultilineEnterSequence |
| 441 | 魔法数字(轮次/计数) | low | 3) |
| 441 | 魔法数字(轮次/计数) | low | 3) |
| 441 | 魔法数字(轮次/计数) | low | 3) |
| 452 | 魔法数字(轮次/计数) | low | 5; |
| 452 | 魔法数字(轮次/计数) | low | 5; |
| 452 | 魔法数字(轮次/计数) | low | 5; |
| 475 | 魔法数字(轮次/计数) | low | 100; |
| 475 | 魔法数字(轮次/计数) | low | 100; |
| 475 | 魔法数字(轮次/计数) | low | 100; |
| 480 | export函数超过100行 | low | export function Composer |
| 480 | export函数超过100行 | low | export function Composer |
| 480 | export函数超过100行 | low | export function Composer |
| 682 | if-elseif链无else兜底 | low | if (owner === "permission") {         if (key.escape) {           submitPermissi... |
| 682 | if-elseif链无else兜底 | low | if (owner === "permission") {         if (key.escape) {           submitPermissi... |
| 682 | if-elseif链无else兜底 | low | if (owner === "permission") {         if (key.escape) {           submitPermissi... |
| 691 | if-elseif链无else兜底 | low | if (key.tab && !key.shift) {           setPermissionFocus(cyclePermissionFocus(p... |
| 691 | if-elseif链无else兜底 | low | if (key.tab && !key.shift) {           setPermissionFocus(cyclePermissionFocus(p... |
| 691 | if-elseif链无else兜底 | low | if (key.tab && !key.shift) {           setPermissionFocus(cyclePermissionFocus(p... |
| 699 | if-elseif链无else兜底 | low | if (key.leftArrow \|\| key.upArrow) {           setPermissionFocus(cyclePermission... |
| 699 | if-elseif链无else兜底 | low | if (key.leftArrow \|\| key.upArrow) {           setPermissionFocus(cyclePermission... |
| 699 | if-elseif链无else兜底 | low | if (key.leftArrow \|\| key.upArrow) {           setPermissionFocus(cyclePermission... |
| 707 | if-elseif链无else兜底 | low | if (!key.ctrl && !key.meta && input && input.length === 1) {           const low... |
| 707 | if-elseif链无else兜底 | low | if (!key.ctrl && !key.meta && input && input.length === 1) {           const low... |
| 707 | if-elseif链无else兜底 | low | if (!key.ctrl && !key.meta && input && input.length === 1) {           const low... |
| 724 | if-elseif链无else兜底 | low | if (lower === "n") {             submitPermissionAction(resolveActionId(permissi... |
| 724 | if-elseif链无else兜底 | low | if (lower === "n") {             submitPermissionAction(resolveActionId(permissi... |
| 724 | if-elseif链无else兜底 | low | if (lower === "n") {             submitPermissionAction(resolveActionId(permissi... |
| 790 | if-elseif链无else兜底 | low | if (owner === "slash") {         if (key.escape) {           setSlashHidden(true... |
| 790 | if-elseif链无else兜底 | low | if (owner === "slash") {         if (key.escape) {           setSlashHidden(true... |
| 790 | if-elseif链无else兜底 | low | if (owner === "slash") {         if (key.escape) {           setSlashHidden(true... |
| 857 | 魔法数字(轮次/计数) | low | 4] |
| 857 | 魔法数字(轮次/计数) | low | 4] |
| 857 | 魔法数字(轮次/计数) | low | 4] |
| 984 | if-elseif链无else兜底 | low | if (key.escape) {         if (slashVisible && slashSelection >= 0) {           s... |
| 984 | if-elseif链无else兜底 | low | if (key.escape) {         if (slashVisible && slashSelection >= 0) {           s... |
| 984 | if-elseif链无else兜底 | low | if (key.escape) {         if (slashVisible && slashSelection >= 0) {           s... |
| 1102 | if-elseif链无else兜底 | low | if (key.home) {         setBufferAndResetSelection(bufferHome(buffer));         ... |
| 1102 | if-elseif链无else兜底 | low | if (key.home) {         setBufferAndResetSelection(bufferHome(buffer));         ... |
| 1102 | if-elseif链无else兜底 | low | if (key.home) {         setBufferAndResetSelection(bufferHome(buffer));         ... |
| 1110 | if-elseif链无else兜底 | low | if (key.ctrl && input === "a") {         setBufferAndResetSelection(bufferHome(b... |
| 1110 | if-elseif链无else兜底 | low | if (key.ctrl && input === "a") {         setBufferAndResetSelection(bufferHome(b... |
| 1110 | if-elseif链无else兜底 | low | if (key.ctrl && input === "a") {         setBufferAndResetSelection(bufferHome(b... |
| 1132 | if-elseif链无else兜底 | low | if (key.ctrl && input === "u") {         setBufferAndResetSelection(bufferClearL... |
| 1132 | if-elseif链无else兜底 | low | if (key.ctrl && input === "u") {         setBufferAndResetSelection(bufferClearL... |
| 1132 | if-elseif链无else兜底 | low | if (key.ctrl && input === "u") {         setBufferAndResetSelection(bufferClearL... |
| 1311 | 魔法数字(轮次/计数) | low | 20, |
| 1311 | 魔法数字(轮次/计数) | low | 4) |
| 1311 | 魔法数字(轮次/计数) | low | 20, |
| 1311 | 魔法数字(轮次/计数) | low | 4) |
| 1311 | 魔法数字(轮次/计数) | low | 20, |
| 1311 | 魔法数字(轮次/计数) | low | 4) |
| 1366 | 魔法数字(轮次/计数) | low | 20, |
| 1366 | 魔法数字(轮次/计数) | low | 20, |
| 1366 | 魔法数字(轮次/计数) | low | 20, |
| 1372 | 魔法数字(轮次/计数) | low | 8, |
| 1372 | 魔法数字(轮次/计数) | low | 8, |
| 1372 | 魔法数字(轮次/计数) | low | 8, |
| 1455 | export函数超过100行 | low | export function formatComposerRenderLines |
| 1455 | export函数超过100行 | low | export function formatComposerRenderLines |
| 1455 | export函数超过100行 | low | export function formatComposerRenderLines |
| 1486 | 魔法数字(轮次/计数) | low | 8, |
| 1486 | 魔法数字(轮次/计数) | low | 8, |
| 1486 | 魔法数字(轮次/计数) | low | 8, |
| 1505 | 魔法数字(轮次/计数) | low | 4, |
| 1505 | 魔法数字(轮次/计数) | low | 4, |
| 1505 | 魔法数字(轮次/计数) | low | 4, |
| 1631 | export函数超过100行 | low | export function splitLineAtDisplayCol |
| 1631 | export函数超过100行 | low | export function splitLineAtDisplayCol |
| 1631 | export函数超过100行 | low | export function splitLineAtDisplayCol |
| 1691 | export函数超过100行 | low | export function handleComposerInput |
| 1691 | export函数超过100行 | low | export function handleComposerInput |
| 1691 | export函数超过100行 | low | export function handleComposerInput |

### packages/tui/src/shell/components/ConfigPanel.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 37 | export函数超过100行 | low | export function ConfigPanel |
| 37 | export函数超过100行 | low | export function ConfigPanel |
| 37 | export函数超过100行 | low | export function ConfigPanel |
| 72 | 魔法数字(轮次/计数) | low | 20, |
| 72 | 魔法数字(轮次/计数) | low | 4) |
| 72 | 魔法数字(轮次/计数) | low | 20, |
| 72 | 魔法数字(轮次/计数) | low | 4) |
| 72 | 魔法数字(轮次/计数) | low | 20, |
| 72 | 魔法数字(轮次/计数) | low | 4) |

### packages/tui/src/shell/components/CtrlOToExpand.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 22 | export函数超过100行 | low | export function useInSubAgent |
| 22 | export函数超过100行 | low | export function useInSubAgent |
| 22 | export函数超过100行 | low | export function useInSubAgent |
| 26 | export函数超过100行 | low | export function useInVirtualList |
| 26 | export函数超过100行 | low | export function useInVirtualList |
| 26 | export函数超过100行 | low | export function useInVirtualList |
| 30 | export函数超过100行 | low | export function SubAgentProvider |
| 30 | export函数超过100行 | low | export function SubAgentProvider |
| 30 | export函数超过100行 | low | export function SubAgentProvider |
| 38 | export函数超过100行 | low | export function VirtualListProvider |
| 38 | export函数超过100行 | low | export function VirtualListProvider |
| 38 | export函数超过100行 | low | export function VirtualListProvider |
| 54 | export函数超过100行 | low | export function CtrlOToExpand |
| 54 | export函数超过100行 | low | export function CtrlOToExpand |
| 54 | export函数超过100行 | low | export function CtrlOToExpand |
| 79 | export函数超过100行 | low | export function ctrlOToExpandString |
| 79 | export函数超过100行 | low | export function ctrlOToExpandString |
| 79 | export函数超过100行 | low | export function ctrlOToExpandString |

### packages/tui/src/shell/components/HelpPanel.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 38 | export函数超过100行 | low | export function HelpPanel |
| 38 | export函数超过100行 | low | export function HelpPanel |
| 38 | export函数超过100行 | low | export function HelpPanel |
| 97 | 魔法数字(轮次/计数) | low | 20, |
| 97 | 魔法数字(轮次/计数) | low | 4) |
| 97 | 魔法数字(轮次/计数) | low | 20, |
| 97 | 魔法数字(轮次/计数) | low | 4) |
| 97 | 魔法数字(轮次/计数) | low | 20, |
| 97 | 魔法数字(轮次/计数) | low | 4) |
| 147 | 魔法数字(轮次/计数) | low | 20) |
| 147 | 魔法数字(轮次/计数) | low | 20) |
| 147 | 魔法数字(轮次/计数) | low | 20) |

### packages/tui/src/shell/components/MessageMarkdown.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 32 | export函数超过100行 | low | export function useInMessageResponse |
| 32 | export函数超过100行 | low | export function useInMessageResponse |
| 32 | export函数超过100行 | low | export function useInMessageResponse |
| 36 | export函数超过100行 | low | export function MessageResponseProvider |
| 36 | export函数超过100行 | low | export function MessageResponseProvider |
| 36 | export函数超过100行 | low | export function MessageResponseProvider |
| 214 | export函数超过100行 | low | export function MessageMarkdown |
| 214 | export函数超过100行 | low | export function MessageMarkdown |
| 214 | export函数超过100行 | low | export function MessageMarkdown |
| 297 | 魔法数字(轮次/计数) | low | 8, |
| 297 | 魔法数字(轮次/计数) | low | 8, |
| 297 | 魔法数字(轮次/计数) | low | 8, |
| 327 | export函数超过100行 | low | export function splitStreamingMarkdownForRender |
| 327 | export函数超过100行 | low | export function splitStreamingMarkdownForRender |
| 327 | export函数超过100行 | low | export function splitStreamingMarkdownForRender |
| 388 | export函数超过100行 | low | export function StreamingMarkdown |
| 388 | export函数超过100行 | low | export function StreamingMarkdown |
| 388 | export函数超过100行 | low | export function StreamingMarkdown |

### packages/tui/src/shell/components/NotificationStack.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 18 | export函数超过100行 | low | export function NotificationStack |
| 18 | export函数超过100行 | low | export function NotificationStack |
| 18 | export函数超过100行 | low | export function NotificationStack |

### packages/tui/src/shell/components/ProductBlock.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 68 | export函数超过100行 | low | export function ProductBlock |
| 68 | export函数超过100行 | low | export function ProductBlock |
| 68 | export函数超过100行 | low | export function ProductBlock |
| 99 | 魔法数字(轮次/计数) | low | 8, |
| 99 | 魔法数字(轮次/计数) | low | 8, |
| 99 | 魔法数字(轮次/计数) | low | 8, |
| 109 | 魔法数字(轮次/计数) | low | 8, |
| 109 | 魔法数字(轮次/计数) | low | 8, |
| 109 | 魔法数字(轮次/计数) | low | 8, |
| 147 | 魔法数字(轮次/计数) | low | 8, |
| 147 | 魔法数字(轮次/计数) | low | 8, |
| 147 | 魔法数字(轮次/计数) | low | 8, |
| 157 | 魔法数字(轮次/计数) | low | 8, |
| 157 | 魔法数字(轮次/计数) | low | 8, |
| 157 | 魔法数字(轮次/计数) | low | 8, |
| 162 | 魔法数字(轮次/计数) | low | 8, |
| 162 | 魔法数字(轮次/计数) | low | 8, |
| 162 | 魔法数字(轮次/计数) | low | 8, |
| 183 | 魔法数字(轮次/计数) | low | 8, |
| 183 | 魔法数字(轮次/计数) | low | 8, |
| 183 | 魔法数字(轮次/计数) | low | 8, |
| 187 | 魔法数字(轮次/计数) | low | 8, |
| 187 | 魔法数字(轮次/计数) | low | 8, |
| 187 | 魔法数字(轮次/计数) | low | 8, |
| 218 | 魔法数字(轮次/计数) | low | 8, |
| 218 | 魔法数字(轮次/计数) | low | 8, |
| 218 | 魔法数字(轮次/计数) | low | 8, |
| 261 | if-elseif链无else兜底 | low | if (!titleVisible && !summaryTrimmed && !block.detail && !block.nextAction) {   ... |
| 261 | if-elseif链无else兜底 | low | if (!titleVisible && !summaryTrimmed && !block.detail && !block.nextAction) {   ... |
| 261 | if-elseif链无else兜底 | low | if (!titleVisible && !summaryTrimmed && !block.detail && !block.nextAction) {   ... |

### packages/tui/src/shell/components/ScrollViewport.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 40 | export函数超过100行 | low | export function TranscriptViewport |
| 40 | export函数超过100行 | low | export function TranscriptViewport |
| 40 | export函数超过100行 | low | export function TranscriptViewport |

### packages/tui/src/shell/components/SessionsPanel.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 40 | export函数超过100行 | low | export function SessionsPanel |
| 40 | export函数超过100行 | low | export function SessionsPanel |
| 40 | export函数超过100行 | low | export function SessionsPanel |
| 85 | 魔法数字(轮次/计数) | low | 20, |
| 85 | 魔法数字(轮次/计数) | low | 4) |
| 85 | 魔法数字(轮次/计数) | low | 20, |
| 85 | 魔法数字(轮次/计数) | low | 4) |
| 85 | 魔法数字(轮次/计数) | low | 20, |
| 85 | 魔法数字(轮次/计数) | low | 4) |
| 130 | 魔法数字(轮次/计数) | low | 8) |
| 130 | 魔法数字(轮次/计数) | low | 8) |
| 130 | 魔法数字(轮次/计数) | low | 8) |

### packages/tui/src/shell/components/ShellApp.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 29 | export函数超过100行 | low | export function ShellApp |
| 29 | export函数超过100行 | low | export function ShellApp |
| 29 | export函数超过100行 | low | export function ShellApp |
| 191 | 魔法数字(轮次/计数) | low | 4} |
| 191 | 魔法数字(轮次/计数) | low | 4} |
| 191 | 魔法数字(轮次/计数) | low | 4} |
| 206 | 魔法数字(轮次/计数) | low | 8, |
| 206 | 魔法数字(轮次/计数) | low | 4) |
| 206 | 魔法数字(轮次/计数) | low | 8, |
| 206 | 魔法数字(轮次/计数) | low | 4) |
| 206 | 魔法数字(轮次/计数) | low | 8, |
| 206 | 魔法数字(轮次/计数) | low | 4) |
| 240 | 魔法数字(轮次/计数) | low | 4} |
| 240 | 魔法数字(轮次/计数) | low | 4} |
| 240 | 魔法数字(轮次/计数) | low | 4} |

### packages/tui/src/shell/components/SlashSuggestions.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 19 | export函数超过100行 | low | export function SlashSuggestions |
| 19 | export函数超过100行 | low | export function SlashSuggestions |
| 19 | export函数超过100行 | low | export function SlashSuggestions |
| 37 | 魔法数字(轮次/计数) | low | 12) |
| 37 | 魔法数字(轮次/计数) | low | 12) |
| 37 | 魔法数字(轮次/计数) | low | 12) |
| 47 | 魔法数字(轮次/计数) | low | 20, |
| 47 | 魔法数字(轮次/计数) | low | 20, |
| 47 | 魔法数字(轮次/计数) | low | 20, |
| 51 | 魔法数字(轮次/计数) | low | 20, |
| 51 | 魔法数字(轮次/计数) | low | 20, |
| 51 | 魔法数字(轮次/计数) | low | 20, |

### packages/tui/src/shell/components/StatusFooter.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 32 | export函数超过100行 | low | export function StatusFooter |
| 32 | export函数超过100行 | low | export function StatusFooter |
| 32 | export函数超过100行 | low | export function StatusFooter |
| 82 | 魔法数字(轮次/计数) | low | 20, |
| 82 | 魔法数字(轮次/计数) | low | 20, |
| 82 | 魔法数字(轮次/计数) | low | 20, |
| 122 | 魔法数字(轮次/计数) | low | 20, |
| 122 | 魔法数字(轮次/计数) | low | 4) |
| 122 | 魔法数字(轮次/计数) | low | 20, |
| 122 | 魔法数字(轮次/计数) | low | 4) |
| 122 | 魔法数字(轮次/计数) | low | 20, |
| 122 | 魔法数字(轮次/计数) | low | 4) |

### packages/tui/src/shell/components/StatusTray.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 6 | export函数超过100行 | low | export function StatusTray |
| 6 | export函数超过100行 | low | export function StatusTray |
| 6 | export函数超过100行 | low | export function StatusTray |
| 18 | 魔法数字(轮次/计数) | low | 4] |
| 18 | 魔法数字(轮次/计数) | low | 4] |
| 18 | 魔法数字(轮次/计数) | low | 4] |

### packages/tui/src/shell/components/TaskSuggestionBar.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 13 | export函数超过100行 | low | export function TaskSuggestionBar |
| 13 | export函数超过100行 | low | export function TaskSuggestionBar |
| 13 | export函数超过100行 | low | export function TaskSuggestionBar |
| 26 | 魔法数字(轮次/计数) | low | 20, |
| 26 | 魔法数字(轮次/计数) | low | 4) |
| 26 | 魔法数字(轮次/计数) | low | 20, |
| 26 | 魔法数字(轮次/计数) | low | 4) |
| 26 | 魔法数字(轮次/计数) | low | 20, |
| 26 | 魔法数字(轮次/计数) | low | 4) |

### packages/tui/src/shell/components/useAnchoredCursor.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 58 | export函数超过100行 | low | export function useAnchoredCursor |
| 58 | export函数超过100行 | low | export function useAnchoredCursor |
| 58 | export函数超过100行 | low | export function useAnchoredCursor |

### packages/tui/src/shell/ink-renderer.tsx

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 8 | 魔法数字(轮次/计数) | low | 4; |
| 8 | 魔法数字(轮次/计数) | low | 4; |
| 21 | export函数超过100行 | low | export function shouldUseInkShell |
| 21 | export函数超过100行 | low | export function shouldUseInkShell |
| 35 | export函数超过100行 | low | export function renderInkShell |
| 35 | export函数超过100行 | low | export function renderInkShell |
| 169 | export函数超过100行 | low | export function isNoColorTerminal |
| 169 | export函数超过100行 | low | export function isNoColorTerminal |

### packages/tui/src/shell/models/command-transcript-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 33 | export函数超过100行 | low | export function normalizeCommandTitle |
| 33 | export函数超过100行 | low | export function normalizeCommandTitle |
| 33 | export函数超过100行 | low | export function normalizeCommandTitle |
| 43 | export函数超过100行 | low | export function buildCommandBlockId |
| 43 | export函数超过100行 | low | export function buildCommandBlockId |
| 43 | export函数超过100行 | low | export function buildCommandBlockId |
| 61 | export函数超过100行 | low | export function createCommandBlock |
| 61 | export函数超过100行 | low | export function createCommandBlock |
| 61 | export函数超过100行 | low | export function createCommandBlock |
| 79 | export函数超过100行 | low | export function getCommandTranscriptText |
| 79 | export函数超过100行 | low | export function getCommandTranscriptText |
| 79 | export函数超过100行 | low | export function getCommandTranscriptText |
| 85 | export函数超过100行 | low | export function isCommandBlock |
| 85 | export函数超过100行 | low | export function isCommandBlock |
| 85 | export函数超过100行 | low | export function isCommandBlock |
| 103 | export函数超过100行 | low | export function buildUserTextBlockId |
| 103 | export函数超过100行 | low | export function buildUserTextBlockId |
| 103 | export函数超过100行 | low | export function buildUserTextBlockId |
| 107 | export函数超过100行 | low | export function createUserTextBlock |
| 107 | export函数超过100行 | low | export function createUserTextBlock |
| 107 | export函数超过100行 | low | export function createUserTextBlock |

### packages/tui/src/shell/models/config-control-plane.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 239 | export函数超过100行 | low | export function getConfigPanels |
| 239 | export函数超过100行 | low | export function getConfigPanels |
| 239 | export函数超过100行 | low | export function getConfigPanels |
| 243 | export函数超过100行 | low | export function findConfigPanel |
| 243 | export函数超过100行 | low | export function findConfigPanel |
| 243 | export函数超过100行 | low | export function findConfigPanel |
| 262 | export函数超过100行 | low | export function reduceConfigState |
| 262 | export函数超过100行 | low | export function reduceConfigState |
| 262 | export函数超过100行 | low | export function reduceConfigState |
| 325 | export函数超过100行 | low | export function getPanelText |
| 325 | export函数超过100行 | low | export function getPanelText |
| 325 | export函数超过100行 | low | export function getPanelText |
| 333 | export函数超过100行 | low | export function getActionLabel |
| 333 | export函数超过100行 | low | export function getActionLabel |
| 333 | export函数超过100行 | low | export function getActionLabel |

### packages/tui/src/shell/models/footer-view.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 57 | export函数超过100行 | low | export function formatFooterModelLabel |
| 57 | export函数超过100行 | low | export function formatFooterModelLabel |
| 57 | export函数超过100行 | low | export function formatFooterModelLabel |
| 74 | export函数超过100行 | low | export function formatFooterCacheLabel |
| 74 | export函数超过100行 | low | export function formatFooterCacheLabel |
| 74 | export函数超过100行 | low | export function formatFooterCacheLabel |
| 82 | 魔法数字(轮次/计数) | low | 100, |
| 82 | 魔法数字(轮次/计数) | low | 100) |
| 82 | 魔法数字(轮次/计数) | low | 100, |
| 82 | 魔法数字(轮次/计数) | low | 100) |
| 82 | 魔法数字(轮次/计数) | low | 100, |
| 82 | 魔法数字(轮次/计数) | low | 100) |
| 87 | export函数超过100行 | low | export function formatFooterIndexLabel |
| 87 | export函数超过100行 | low | export function formatFooterIndexLabel |
| 87 | export函数超过100行 | low | export function formatFooterIndexLabel |
| 93 | 魔法数字(轮次/计数) | low | 10) |
| 93 | 魔法数字(轮次/计数) | low | 10) |
| 93 | 魔法数字(轮次/计数) | low | 10) |
| 96 | export函数超过100行 | low | export function formatFooterReasoningLabel |
| 96 | export函数超过100行 | low | export function formatFooterReasoningLabel |
| 96 | export函数超过100行 | low | export function formatFooterReasoningLabel |
| 106 | 魔法数字(轮次/计数) | low | 12) |
| 106 | 魔法数字(轮次/计数) | low | 12) |
| 106 | 魔法数字(轮次/计数) | low | 12) |
| 113 | export函数超过100行 | low | export function buildFooterView |
| 113 | export函数超过100行 | low | export function buildFooterView |
| 113 | export函数超过100行 | low | export function buildFooterView |

### packages/tui/src/shell/models/help-panel.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 108 | export函数超过100行 | low | export function getHelpPanelEntries |
| 108 | export函数超过100行 | low | export function getHelpPanelEntries |
| 108 | export函数超过100行 | low | export function getHelpPanelEntries |
| 114 | export函数超过100行 | low | export function buildHelpPanelData |
| 114 | export函数超过100行 | low | export function buildHelpPanelData |
| 114 | export函数超过100行 | low | export function buildHelpPanelData |

### packages/tui/src/shell/models/input-owner-controller.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 58 | export函数超过100行 | low | export function shouldOwnerBePaste |
| 58 | export函数超过100行 | low | export function shouldOwnerBePaste |
| 58 | export函数超过100行 | low | export function shouldOwnerBePaste |
| 96 | export函数超过100行 | low | export function selectInputOwner |
| 96 | export函数超过100行 | low | export function selectInputOwner |
| 96 | export函数超过100行 | low | export function selectInputOwner |
| 129 | export函数超过100行 | low | export function isNavigationKey |
| 129 | export函数超过100行 | low | export function isNavigationKey |
| 129 | export函数超过100行 | low | export function isNavigationKey |

### packages/tui/src/shell/models/permission-elevation.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 87 | export函数超过100行 | low | export function hasExistingAllowRule |
| 87 | export函数超过100行 | low | export function hasExistingAllowRule |
| 87 | export函数超过100行 | low | export function hasExistingAllowRule |
| 121 | export函数超过100行 | low | export function describeAllowAlwaysCommand |
| 121 | export函数超过100行 | low | export function describeAllowAlwaysCommand |
| 121 | export函数超过100行 | low | export function describeAllowAlwaysCommand |
| 133 | export函数超过100行 | low | export function buildElevationOptions |
| 133 | export函数超过100行 | low | export function buildElevationOptions |
| 133 | export函数超过100行 | low | export function buildElevationOptions |

### packages/tui/src/shell/models/permission-explanation.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 36 | export函数超过100行 | low | export function sanitizePermissionReason |
| 36 | export函数超过100行 | low | export function sanitizePermissionReason |
| 36 | export函数超过100行 | low | export function sanitizePermissionReason |
| 58 | export函数超过100行 | low | export function explainSemantic |
| 58 | export函数超过100行 | low | export function explainSemantic |
| 58 | export函数超过100行 | low | export function explainSemantic |
| 85 | export函数超过100行 | low | export function explainPathSafety |
| 85 | export函数超过100行 | low | export function explainPathSafety |
| 85 | export函数超过100行 | low | export function explainPathSafety |
| 105 | export函数超过100行 | low | export function explainHowToUpdate |
| 105 | export函数超过100行 | low | export function explainHowToUpdate |
| 105 | export函数超过100行 | low | export function explainHowToUpdate |
| 123 | export函数超过100行 | low | export function explainPolicyVerdict |
| 123 | export函数超过100行 | low | export function explainPolicyVerdict |
| 123 | export函数超过100行 | low | export function explainPolicyVerdict |

### packages/tui/src/shell/models/session-panel.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 24 | export函数超过100行 | low | export function buildSessionPanelEntries |
| 24 | export函数超过100行 | low | export function buildSessionPanelEntries |
| 24 | export函数超过100行 | low | export function buildSessionPanelEntries |
| 35 | 魔法数字(轮次/计数) | low | 12) |
| 35 | 魔法数字(轮次/计数) | low | 12) |
| 35 | 魔法数字(轮次/计数) | low | 12) |

### packages/tui/src/shell/models/task-scroll-state.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 21 | export函数超过100行 | low | export function createInitialTaskScroll |
| 21 | export函数超过100行 | low | export function createInitialTaskScroll |
| 21 | export函数超过100行 | low | export function createInitialTaskScroll |
| 25 | export函数超过100行 | low | export function reduceTaskScroll |
| 25 | export函数超过100行 | low | export function reduceTaskScroll |
| 25 | export函数超过100行 | low | export function reduceTaskScroll |
| 32 | export函数超过100行 | low | export function clampTaskScroll |
| 32 | export函数超过100行 | low | export function clampTaskScroll |
| 32 | export函数超过100行 | low | export function clampTaskScroll |
| 39 | export函数超过100行 | low | export function computeScrollViewportOffset |
| 39 | export函数超过100行 | low | export function computeScrollViewportOffset |
| 39 | export函数超过100行 | low | export function computeScrollViewportOffset |

### packages/tui/src/shell/models/task-suggestion.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 83 | export函数超过100行 | low | export function isKnownSlashCommand |
| 83 | export函数超过100行 | low | export function isKnownSlashCommand |
| 83 | export函数超过100行 | low | export function isKnownSlashCommand |
| 174 | 魔法数字(轮次/计数) | low | 3, |
| 174 | 魔法数字(轮次/计数) | low | 3, |
| 174 | 魔法数字(轮次/计数) | low | 3, |
| 175 | 魔法数字(轮次/计数) | low | 4, |
| 175 | 魔法数字(轮次/计数) | low | 4, |
| 175 | 魔法数字(轮次/计数) | low | 4, |
| 181 | export函数超过100行 | low | export function buildTaskSuggestions |
| 181 | export函数超过100行 | low | export function buildTaskSuggestions |
| 181 | export函数超过100行 | low | export function buildTaskSuggestions |
| 215 | 魔法数字(轮次/计数) | low | 4; |
| 215 | 魔法数字(轮次/计数) | low | 4; |
| 215 | 魔法数字(轮次/计数) | low | 4; |

### packages/tui/src/shell/models/transcript-scroll-state.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 29 | export函数超过100行 | low | export function createInitialTranscriptScroll |
| 29 | export函数超过100行 | low | export function createInitialTranscriptScroll |
| 29 | export函数超过100行 | low | export function createInitialTranscriptScroll |
| 33 | export函数超过100行 | low | export function reduceTranscriptScroll |
| 33 | export函数超过100行 | low | export function reduceTranscriptScroll |
| 33 | export函数超过100行 | low | export function reduceTranscriptScroll |
| 76 | 魔法数字(轮次/计数) | low | 5; |
| 76 | 魔法数字(轮次/计数) | low | 5; |
| 76 | 魔法数字(轮次/计数) | low | 5; |
| 94 | 魔法数字(轮次/计数) | low | 5) |
| 94 | 魔法数字(轮次/计数) | low | 5) |
| 94 | 魔法数字(轮次/计数) | low | 5) |
| 96 | 魔法数字(轮次/计数) | low | 5) |
| 96 | 魔法数字(轮次/计数) | low | 5) |
| 96 | 魔法数字(轮次/计数) | low | 5) |
| 123 | export函数超过100行 | low | export function clampTranscriptScroll |
| 123 | export函数超过100行 | low | export function clampTranscriptScroll |
| 123 | export函数超过100行 | low | export function clampTranscriptScroll |
| 139 | export函数超过100行 | low | export function computeScrollViewportOffset |
| 139 | export函数超过100行 | low | export function computeScrollViewportOffset |
| 139 | export函数超过100行 | low | export function computeScrollViewportOffset |

### packages/tui/src/shell/models/transcript-selection-state.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 63 | export函数超过100行 | low | export function buildTranscriptTextRows |
| 63 | export函数超过100行 | low | export function buildTranscriptTextRows |
| 63 | export函数超过100行 | low | export function buildTranscriptTextRows |
| 82 | export函数超过100行 | low | export function parseSgrMouseEvent |
| 82 | export函数超过100行 | low | export function parseSgrMouseEvent |
| 82 | export函数超过100行 | low | export function parseSgrMouseEvent |
| 85 | 魔法数字(轮次/计数) | low | 10) |
| 85 | 魔法数字(轮次/计数) | low | 10) |
| 85 | 魔法数字(轮次/计数) | low | 10) |
| 86 | 魔法数字(轮次/计数) | low | 10) |
| 86 | 魔法数字(轮次/计数) | low | 10) |
| 86 | 魔法数字(轮次/计数) | low | 10) |
| 87 | 魔法数字(轮次/计数) | low | 3] |
| 87 | 魔法数字(轮次/计数) | low | 10) |
| 87 | 魔法数字(轮次/计数) | low | 3] |
| 87 | 魔法数字(轮次/计数) | low | 10) |
| 87 | 魔法数字(轮次/计数) | low | 3] |
| 87 | 魔法数字(轮次/计数) | low | 10) |
| 88 | 魔法数字(轮次/计数) | low | 4] |
| 88 | 魔法数字(轮次/计数) | low | 4] |
| 88 | 魔法数字(轮次/计数) | low | 4] |
| 99 | export函数超过100行 | low | export function isSgrMouseInput |
| 99 | export函数超过100行 | low | export function isSgrMouseInput |
| 99 | export函数超过100行 | low | export function isSgrMouseInput |
| 103 | export函数超过100行 | low | export function reduceTranscriptSelection |
| 103 | export函数超过100行 | low | export function reduceTranscriptSelection |
| 103 | export函数超过100行 | low | export function reduceTranscriptSelection |
| 159 | export函数超过100行 | low | export function selectionContainsRow |
| 159 | export函数超过100行 | low | export function selectionContainsRow |
| 159 | export函数超过100行 | low | export function selectionContainsRow |
| 168 | export函数超过100行 | low | export function selectionLineIndexesForBlock |
| 168 | export函数超过100行 | low | export function selectionLineIndexesForBlock |
| 168 | export函数超过100行 | low | export function selectionLineIndexesForBlock |
| 190 | export函数超过100行 | low | export function selectedTextFromRows |
| 190 | export函数超过100行 | low | export function selectedTextFromRows |
| 190 | export函数超过100行 | low | export function selectedTextFromRows |
| 262 | 魔法数字(轮次/计数) | low | 3) |
| 262 | 魔法数字(轮次/计数) | low | 3) |
| 262 | 魔法数字(轮次/计数) | low | 3) |
| 268 | 魔法数字(轮次/计数) | low | 3) |
| 268 | 魔法数字(轮次/计数) | low | 3) |
| 268 | 魔法数字(轮次/计数) | low | 3) |
| 268 | 魔法数字(轮次/计数) | low | 3) |
| 268 | 魔法数字(轮次/计数) | low | 3) |
| 268 | 魔法数字(轮次/计数) | low | 3) |

### packages/tui/src/shell/plain-renderer.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 7 | export函数超过100行 | low | export function renderPlainShell |
| 7 | export函数超过100行 | low | export function renderPlainShell |
| 15 | export函数超过100行 | low | export function writePlainShell |
| 15 | export函数超过100行 | low | export function writePlainShell |
| 151 | 魔法数字(轮次/计数) | low | 100) |
| 151 | 魔法数字(轮次/计数) | low | 100) |
| 184 | 魔法数字(轮次/计数) | low | 12, |
| 184 | 魔法数字(轮次/计数) | low | 12, |
| 231 | 魔法数字(轮次/计数) | low | 3) |
| 231 | 魔法数字(轮次/计数) | low | 3) |
| 330 | 魔法数字(轮次/计数) | low | 8, |
| 330 | 魔法数字(轮次/计数) | low | 8, |
| 422 | 魔法数字(轮次/计数) | low | 4] |
| 422 | 魔法数字(轮次/计数) | low | 4] |
| 449 | export函数超过100行 | low | export function computeHomePromptPrefix |
| 449 | export函数超过100行 | low | export function computeHomePromptPrefix |

### packages/tui/src/shell/terminal-capability.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 45 | export函数超过100行 | low | export function detectTerminalCapability |
| 45 | export函数超过100行 | low | export function detectTerminalCapability |
| 52 | export函数超过100行 | low | export function resetTerminalCapabilityCache |
| 52 | export函数超过100行 | low | export function resetTerminalCapabilityCache |
| 134 | 魔法数字(轮次/计数) | low | 10) |
| 134 | 魔法数字(轮次/计数) | low | 10) |
| 135 | 魔法数字(轮次/计数) | low | 10) |
| 135 | 魔法数字(轮次/计数) | low | 10) |
| 136 | 魔法数字(轮次/计数) | low | 10) |
| 136 | 魔法数字(轮次/计数) | low | 10) |

### packages/tui/src/shell/text-utils.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 5 | export函数超过100行 | low | export function fitText |
| 5 | export函数超过100行 | low | export function fitText |
| 19 | export函数超过100行 | low | export function wrapText |
| 19 | export函数超过100行 | low | export function wrapText |
| 49 | export函数超过100行 | low | export function charWidth |
| 49 | export函数超过100行 | low | export function charWidth |
| 53 | export函数超过100行 | low | export function displayWidth |
| 53 | export函数超过100行 | low | export function displayWidth |
| 59 | export函数超过100行 | low | export function truncateDisplay |
| 59 | export函数超过100行 | low | export function truncateDisplay |
| 78 | export函数超过100行 | low | export function composerMaxWidth |
| 78 | export函数超过100行 | low | export function composerMaxWidth |
| 91 | export函数超过100行 | low | export function taskComposerMaxWidth |
| 91 | export函数超过100行 | low | export function taskComposerMaxWidth |
| 92 | 魔法数字(轮次/计数) | low | 4) |
| 92 | 魔法数字(轮次/计数) | low | 4) |
| 99 | export函数超过100行 | low | export function lineChar |
| 99 | export函数超过100行 | low | export function lineChar |
| 116 | export函数超过100行 | low | export function brandWordmark |
| 116 | export函数超过100行 | low | export function brandWordmark |

### packages/tui/src/shell/theme.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 35 | export函数超过100行 | low | export function createShellTheme |
| 35 | export函数超过100行 | low | export function createShellTheme |
| 98 | export函数超过100行 | low | export function getStatusMarker |
| 98 | export函数超过100行 | low | export function getStatusMarker |

### packages/tui/src/shell/view-model.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 194 | export函数超过100行 | low | export function createShellViewModel |
| 194 | export函数超过100行 | low | export function createShellViewModel |
| 291 | 魔法数字(轮次/计数) | low | 3; |
| 291 | 魔法数字(轮次/计数) | low | 3; |
| 756 | 魔法数字(轮次/计数) | low | 8) |
| 756 | 魔法数字(轮次/计数) | low | 8) |
| 761 | 魔法数字(轮次/计数) | low | 8, |
| 761 | 魔法数字(轮次/计数) | low | 8, |
| 820 | 魔法数字(轮次/计数) | low | 8, |
| 820 | 魔法数字(轮次/计数) | low | 4) |
| 820 | 魔法数字(轮次/计数) | low | 8, |
| 820 | 魔法数字(轮次/计数) | low | 4) |
| 836 | 魔法数字(轮次/计数) | low | 8, |
| 836 | 魔法数字(轮次/计数) | low | 8, |
| 966 | if-elseif链无else兜底 | low | if (toolName === "Bash") {     return isEn ? "Allow future similar Bash actions"... |
| 966 | if-elseif链无else兜底 | low | if (toolName === "Bash") {     return isEn ? "Allow future similar Bash actions"... |
| 975 | export函数超过100行 | low | export function getComposerPlaceholder |
| 975 | export函数超过100行 | low | export function getComposerPlaceholder |
| 1002 | export函数超过100行 | low | export function createOutputBlock |
| 1002 | export函数超过100行 | low | export function createOutputBlock |
| 1074 | 魔法数字(轮次/计数) | low | 5) |
| 1074 | 魔法数字(轮次/计数) | low | 5) |
| 1140 | export函数超过100行 | low | export function mapRequestActivityToView |
| 1140 | export函数超过100行 | low | export function mapRequestActivityToView |
| 1197 | export函数超过100行 | low | export function mapPendingApprovalToPermission |
| 1197 | export函数超过100行 | low | export function mapPendingApprovalToPermission |
| 1228 | TuiContext直接字段修改 | low | context.language = |
| 1228 | TuiContext直接字段修改 | low | context.language = |
| 1244 | TuiContext直接字段修改 | low | context.language = |
| 1244 | TuiContext直接字段修改 | low | context.language = |
| 1280 | TuiContext直接字段修改 | low | context.language = |
| 1280 | TuiContext直接字段修改 | low | context.language = |
| 1295 | TuiContext直接字段修改 | low | context.language = |
| 1295 | TuiContext直接字段修改 | low | context.language = |
| 1312 | TuiContext直接字段修改 | low | context.language = |
| 1312 | TuiContext直接字段修改 | low | context.language = |
| 1327 | TuiContext直接字段修改 | low | context.language = |
| 1327 | TuiContext直接字段修改 | low | context.language = |
| 1384 | TuiContext直接字段修改 | low | context.language = |
| 1384 | TuiContext直接字段修改 | low | context.language = |
| 1774 | 魔法数字(轮次/计数) | low | 10) |
| 1774 | 魔法数字(轮次/计数) | low | 10) |
| 1796 | 魔法数字(轮次/计数) | low | 10, |
| 1796 | 魔法数字(轮次/计数) | low | 10, |
| 1800 | 魔法数字(轮次/计数) | low | 10) |
| 1800 | 魔法数字(轮次/计数) | low | 10) |
| 1835 | 魔法数字(轮次/计数) | low | 8, |
| 1835 | 魔法数字(轮次/计数) | low | 8, |
| 1838 | 魔法数字(轮次/计数) | low | 8, |
| 1838 | 魔法数字(轮次/计数) | low | 8, |

### packages/tui/src/slash-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 1015 | export函数超过100行 | low | export function configureSlashCommandRuntime |
| 1019 | export函数超过100行 | low | export async function handleSlashCommand |
| 1056 | export函数超过100行 | low | export function createWorktreeRemoveResolveDeps |
| 1072 | export函数超过100行 | low | export async function runCommandCaptureForTest |
| 1081 | export函数超过100行 | low | export async function handleDoctorCommand |
| 1087 | if-elseif链无else兜底 | low | if (action === "hooks") {     writeLine(output, formatHooksDoctor(context));    ... |
| 1117 | TuiContext直接字段修改 | low | context.language = |
| 1123 | export函数超过100行 | low | export function writeWorkspaceTrustStartupNotice |
| 1125 | if-elseif链无else兜底 | low | if (!context.config.workspaceTrust.recorded) {     writeLine(       output,     ... |
| 1128 | TuiContext直接字段修改 | low | context.language = |
| 1137 | TuiContext直接字段修改 | low | context.workspaceTrustEnforced =  |
| 1140 | TuiContext直接字段修改 | low | context.language = |
| 1146 | export函数超过100行 | low | export async function shouldPromptForInitialLanguage |
| 1157 | export函数超过100行 | low | export async function promptInitialLanguage |
| 1180 | TuiContext直接字段修改 | low | context.config =  |
| 1181 | TuiContext直接字段修改 | low | context.language =  |
| 1220 | if-elseif链无else兜底 | low | if (name === "escape") {         finish("zh-CN");         return;       }       ... |
| 1305 | export函数超过100行 | low | export function shouldPromptForInitialWorkspaceTrust |
| 1312 | export函数超过100行 | low | export async function promptInitialWorkspaceTrust |
| 1318 | TuiContext直接字段修改 | low | context.language = |
| 1346 | TuiContext直接字段修改 | low | context.config =  |
| 1350 | TuiContext直接字段修改 | low | context.workspaceTrustEnforced =  |
| 1395 | if-elseif链无else兜底 | low | if (name === "escape") {         finish(false);         return;       }       if... |
| 1417 | if-elseif链无else兜底 | low | if (name === "y") {         finish(true);         return;       }       if (name... |
| 1470 | export函数超过100行 | low | export function getWorkspaceTrustCommandGuard |
| 1482 | TuiContext直接字段修改 | low | context.language = |
| 1503 | export函数超过100行 | low | export async function handleTrustCommand |
| 1518 | TuiContext直接字段修改 | low | context.config =  |
| 1519 | TuiContext直接字段修改 | low | context.workspaceTrustEnforced =  |
| 1537 | export函数超过100行 | low | export async function handleAutopilotCommand |
| 1543 | if-elseif链无else兜底 | low | if (action === "status" \|\| action === "details") {     writeLine(output, formatP... |
| 1563 | TuiContext直接字段修改 | low | context.pendingAutopilot =  |
| 1588 | 魔法数字(轮次/计数) | low | 100) |
| 1597 | export函数超过100行 | low | export async function startPendingAutopilot |
| 1612 | TuiContext直接字段修改 | low | context.pendingAutopilot =  |
| 1628 | export函数超过100行 | low | export async function handleLanguageCommand |
| 1653 | TuiContext直接字段修改 | low | context.config =  |
| 1658 | TuiContext直接字段修改 | low | context.language = |
| 1664 | TuiContext直接字段修改 | low | context.config =  |
| 1666 | TuiContext直接字段修改 | low | context.language =  |
| 1683 | export函数超过100行 | low | export async function handleRewindCommand |
| 1697 | TuiContext直接字段修改 | low | context.language = |
| 1787 | TuiContext直接字段修改 | low | context.language = |
| 1794 | export函数超过100行 | low | export async function handleBtwCommand |
| 1803 | TuiContext直接字段修改 | low | context.language = |
| 1811 | TuiContext直接字段修改 | low | context.btwPanelState =  |
| 1826 | TuiContext直接字段修改 | low | context.btwPanelState =  |
| 1833 | TuiContext直接字段修改 | low | context.language = |
| 1837 | TuiContext直接字段修改 | low | context.btwPanelState =  |
| 1845 | TuiContext直接字段修改 | low | context.activeBtwAbortController =  |
| 1859 | TuiContext直接字段修改 | low | context.activeBtwAbortController = |
| 1860 | TuiContext直接字段修改 | low | context.activeBtwAbortController =  |
| 1875 | TuiContext直接字段修改 | low | context.btwPanelState =        |
| 1900 | export函数超过100行 | low | export async function handleResumeCommand |
| 1927 | TuiContext直接字段修改 | low | context.sessionsPanelState =  |
| 1938 | export函数超过100行 | low | export async function handleBranchCommand |
| 1960 | TuiContext直接字段修改 | low | context.sessionId =  |
| 1961 | TuiContext直接字段修改 | low | context.sessionEnded =  |
| 2090 | TuiContext直接字段修改 | low | context.language = |
| 2096 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 2127 | export函数超过100行 | low | export async function handleVerifyCommand |
| 2152 | if-elseif链无else兜底 | low | if (action === "plan") {     writeLine(output, formatVerificationPlan(plan, cont... |
| 2178 | TuiContext直接字段修改 | low | context.lastVerification =  |
| 2184 | export函数超过100行 | low | export async function handleReviewCommand |
| 2194 | TuiContext直接字段修改 | low | context.roleHandoffs.unshift( |
| 2199 | 魔法数字(轮次/计数) | low | 8) |
| 2200 | 魔法数字(轮次/计数) | low | 4) |
| 2211 | export函数超过100行 | low | export async function handleVisionCommand |
| 2242 | 魔法数字(轮次/计数) | low | 8) |
| 2250 | 魔法数字(轮次/计数) | low | 5, |
| 2254 | TuiContext直接字段修改 | low | context.visionObservations.unshift( |
| 2260 | 魔法数字(轮次/计数) | low | 4) |
| 2261 | 魔法数字(轮次/计数) | low | 4) |
| 2270 | export函数超过100行 | low | export async function handleImageCommand |
| 2296 | 魔法数字(轮次/计数) | low | 8) |
| 2331 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 2368 | export函数超过100行 | low | export async function executeImageGeneration |
| 2412 | TuiContext直接字段修改 | low | context.imageResults.unshift( |
| 2428 | 魔法数字(轮次/计数) | low | 4) |
| 2441 | 魔法数字(毫秒超时) | low | 30_000 |
| 2442 | 魔法数字(毫秒超时) | low | 120_000 |
| 2458 | export函数超过100行 | low | export async function runVerificationCommandForTest |
| 2467 | export函数超过100行 | low | export async function recordAgentExecutionEvidence |
| 2489 | export函数超过100行 | low | export async function recordAgentMailboxEvidence |
| 2512 | export函数超过100行 | low | export async function recordAgentToolEvidence |
| 2530 | export函数超过100行 | low | export async function recordAgentToolFailureEvidence |
| 2552 | export函数超过100行 | low | export async function runIndexSafetyRepair |
| 2557 | TuiContext直接字段修改 | low | context.language = |
| 2568 | TuiContext直接字段修改 | low | context.language = |
| 2592 | TuiContext直接字段修改 | low | context.language = |
| 2605 | export函数超过100行 | low | export async function requestIndexRefreshApproval |
| 2612 | 魔法数字(轮次/计数) | low | 8) |
| 2645 | TuiContext直接字段修改 | low | context.permissionMode = |
| 2645 | if-elseif链无else兜底 | low | if (context.permissionMode === "auto-review" && permission.decision === "ask") {... |
| 2689 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 2717 | export函数超过100行 | low | export async function requestIndexInitFastApproval |
| 2724 | 魔法数字(轮次/计数) | low | 8) |
| 2757 | TuiContext直接字段修改 | low | context.permissionMode = |
| 2757 | if-elseif链无else兜底 | low | if (context.permissionMode === "auto-review" && permission.decision === "ask") {... |
| 2801 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 2909 | TuiContext直接字段修改 | low | context.pendingLocalApproval =  |
| 2939 | TuiContext直接字段修改 | low | context.language = |
| 2951 | export函数超过100行 | low | export async function executeIndexIgnoreWritePlan |
| 2982 | TuiContext直接字段修改 | low | context.language = |
| 2993 | TuiContext直接字段修改 | low | context.language = |
| 2996 | TuiContext直接字段修改 | low | context.language = |
| 3024 | 魔法数字(轮次/计数) | low | 5) |
| 3026 | 魔法数字(轮次/计数) | low | 8) |
| 3033 | export函数超过100行 | low | export function addRoleUsage |
| 3061 | TuiContext直接字段修改 | low | context.roleUsage.push( |

### packages/tui/src/slash-dispatch.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 86 | export函数超过100行 | low | export function slashCommandToTool |
| 103 | export函数超过100行 | low | export function formatCatalogHelp |
| 113 | if-elseif链无else兜底 | low | if (effective === "all") {     return formatHelp(language);   }   if (effective ... |
| 150 | export函数超过100行 | low | export function formatSlashDiscovery |
| 179 | export函数超过100行 | low | export function getSlashPrefixCandidates |
| 184 | 魔法数字(轮次/计数) | low | 8) |
| 189 | 魔法数字(轮次/计数) | low | 8) |
| 193 | export函数超过100行 | low | export function getCoreSlashCandidates |
| 194 | 魔法数字(轮次/计数) | low | 8) |
| 197 | export函数超过100行 | low | export function formatUnknownSlashCommand |
| 212 | export函数超过100行 | low | export function looksLikeOrdinaryDevelopmentRequest |
| 218 | export函数超过100行 | low | export function looksLikeWorkspaceTrustNaturalRequest |
| 224 | export函数超过100行 | low | export function shouldDispatchLocalReadonlyIntent |
| 230 | export函数超过100行 | low | export function isAllowedLocalReadonlyCommand |
| 234 | export函数超过100行 | low | export function isReadonlyPermissionsStatus |
| 243 | export函数超过100行 | low | export function isAllowedModeStartGate |
| 254 | export函数超过100行 | low | export function isWorkspaceTrustNaturalStartGate |
| 264 | export函数超过100行 | low | export function isAllowedLocalCapabilityAnswer |
| 274 | export函数超过100行 | low | export function formatModeBehavior |
| 290 | export函数超过100行 | low | export function formatModeBehaviorLines |
| 309 | export函数超过100行 | low | export function formatColumnAlignedCandidates |
| 313 | 魔法数字(轮次/计数) | low | 8) |
| 316 | 魔法数字(轮次/计数) | low | 12) |
| 365 | 魔法数字(轮次/计数) | low | 4) |
| 367 | 魔法数字(轮次/计数) | low | 3) |
| 375 | 魔法数字(轮次/计数) | low | 3) |

### packages/tui/src/startup-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 28 | export函数超过100行 | low | export function writeLine |
| 46 | export函数超过100行 | low | export function readOutputColumns |
| 51 | export函数超过100行 | low | export function readOutputRows |
| 62 | export函数超过100行 | low | export function truncateDisplay |
| 76 | export函数超过100行 | low | export function stripAnsi |
| 81 | export函数超过100行 | low | export function uniqueStrings |
| 89 | export函数超过100行 | low | export function sanitizeDiagnosticText |
| 97 | export函数超过100行 | low | export function formatDisplayPath |
| 119 | export函数超过100行 | low | export function sanitizeDisplayPaths |
| 164 | export函数超过100行 | low | export function sanitizeUserFacingError |
| 172 | export函数超过100行 | low | export function formatError |
| 204 | export函数超过100行 | low | export function shouldEnterProductShellCandidate |
| 216 | export函数超过100行 | low | export function formatProviderEnvWarning |
| 222 | export函数超过100行 | low | export function formatProjectRouteProblem |
| 238 | export函数超过100行 | low | export function formatUserScopedSetupNeeded |
| 261 | export函数超过100行 | low | export function createShellLimitations |
| 350 | if-elseif链无else兜底 | low | if (key.name === "escape" && handlers.onEsc) {         void handlers.onEsc();   ... |
| 378 | export函数超过100行 | low | export function toInputBuffer |
| 388 | export函数超过100行 | low | export function decodeInput |

### packages/tui/src/terminal-readiness-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 128 | export函数超过100行 | low | export function formatTerminalReadinessDoctor |
| 227 | export函数超过100行 | low | export function formatTerminalReadinessStatus |
| 234 | 魔法数字(轮次/计数) | low | 3) |
| 238 | export函数超过100行 | low | export function formatTerminalProblemsPanel |
| 239 | 魔法数字(轮次/计数) | low | 8) |
| 263 | export函数超过100行 | low | export function createReadinessItems |
| 491 | 魔法数字(轮次/计数) | low | 100) |

### packages/tui/src/terminal-readiness-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 13 | export函数超过100行 | low | export function createTerminalReadinessView |
| 134 | export函数超过100行 | low | export function createVerificationLevelForReadiness |
| 461 | catch返回null/undefined | low | } catch {     return undefined;   } |
| 515 | catch返回null/undefined | low | } catch {     return undefined;   } |

### packages/tui/src/tool-output-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 17 | 魔法数字(轮次/计数) | low | 8; |
| 18 | 魔法数字(轮次/计数) | low | 3; |
| 49 | export函数超过100行 | low | export function createLayeredToolOutput |
| 69 | export函数超过100行 | low | export function formatToolOutput |
| 173 | 魔法数字(轮次/计数) | low | 8, |
| 196 | export函数超过100行 | low | export function formatToolStart |
| 220 | export函数超过100行 | low | export function sanitizeAssistantPrimaryText |
| 225 | export函数超过100行 | low | export function sanitizeAssistantPrimaryTextWithMetadata |
| 250 | 魔法数字(轮次/计数) | low | 3, |
| 258 | export函数超过100行 | low | export function createAssistantPrimaryTextSanitizer |
| 560 | 魔法数字(轮次/计数) | low | 200; |

### packages/tui/src/tool-result-budget.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 60 | export函数超过100行 | low | export async function applyToolResultBudgetToMessages |
| 225 | 魔法数字(轮次/计数) | low | 12) |
| 295 | export函数超过100行 | low | export function formatToolResultBudgetEvidenceSummary |
| 299 | export函数超过100行 | low | export function formatToolResultBudgetSystemEvent |

### packages/tui/src/tui-agent-job-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 62 | 魔法数字(轮次/计数) | low | 8; |
| 64 | export函数超过100行 | low | export function isAgentType |
| 68 | export函数超过100行 | low | export function getAgentRole |
| 69 | if-elseif链无else兜底 | low | if (type === "planner") {     return "planner";   }   if (type === "verifier") { |
| 78 | export函数超过100行 | low | export function getAgentPermissionMode |
| 82 | if-elseif链无else兜底 | low | if (type === "explorer" \|\| type === "planner") {     return "plan";   }   if (ty... |
| 91 | export函数超过100行 | low | export function createEmptyAgentCost |
| 92 | 魔法数字(轮次/计数) | low | 4) |
| 96 | export函数超过100行 | low | export function createAgentContextSummary |
| 101 | 魔法数字(轮次/计数) | low | 5) |
| 102 | 魔法数字(轮次/计数) | low | 8) |
| 108 | 魔法数字(轮次/计数) | low | 5) |
| 117 | 魔法数字(轮次/计数) | low | 200) |
| 131 | export函数超过100行 | low | export function createAgentBackgroundTask |
| 136 | TuiContext直接字段修改 | low | context.language = |
| 194 | 魔法数字(毫秒超时) | low | 30_000 |
| 195 | 魔法数字(毫秒超时) | low | 120_000 |
| 205 | export函数超过100行 | low | export function isAgentCancellable |
| 209 | export函数超过100行 | low | export function mapAgentBackgroundResult |
| 219 | export函数超过100行 | low | export function findAgent |
| 240 | export函数超过100行 | low | export function listCancellableAgents |
| 244 | export函数超过100行 | low | export function formatAgentSummary |
| 248 | export函数超过100行 | low | export function findBackgroundTask |
| 258 | export函数超过100行 | low | export function isActiveBackgroundStatus |
| 262 | export函数超过100行 | low | export function isRuntimeActiveBackgroundTask |
| 266 | export函数超过100行 | low | export function rememberBackgroundTask |
| 267 | TuiContext直接字段修改 | low | context.backgroundTasks.unshift( |
| 268 | TuiContext直接字段修改 | low | context.backgroundTasks =  |
| 271 | export函数超过100行 | low | export function getBackgroundAbortControllers |
| 273 | TuiContext直接字段修改 | low | context.backgroundAbortControllers =  |
| 278 | export函数超过100行 | low | export function registerBackgroundAbortController |
| 287 | export函数超过100行 | low | export function clearBackgroundAbortController |
| 291 | export函数超过100行 | low | export function abortBackgroundTask |
| 305 | export函数超过100行 | low | export function toJobContext |
| 309 | export函数超过100行 | low | export async function listDurableJobs |
| 313 | export函数超过100行 | low | export async function findDurableJob |
| 320 | export函数超过100行 | low | export function getDurableJobsRoot |
| 324 | export函数超过100行 | low | export function getDurableJobPaths |
| 331 | export函数超过100行 | low | export function formatJobList |
| 335 | export函数超过100行 | low | export function formatJobPrimary |
| 339 | export函数超过100行 | low | export function formatJobReport |
| 343 | export函数超过100行 | low | export async function formatJobLogs |
| 347 | export函数超过100行 | low | export function createJobBackgroundTask |
| 367 | 魔法数字(毫秒超时) | low | 30_000 |
| 381 | export函数超过100行 | low | export function upsertJobBackgroundTask |

### packages/tui/src/tui-context-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 242 | export函数超过100行 | low | export function runtimeFromContinuation |
| 259 | export函数超过100行 | low | export function createSingleToolCallContinuation |
| 481 | 魔法数字(轮次/计数) | low | 200; |
| 490 | 魔法数字(轮次/计数) | low | 3; |
| 493 | 魔法数字(轮次/计数) | low | 12; |
| 495 | 魔法数字(轮次/计数) | low | 50; |
| 496 | 魔法数字(轮次/计数) | low | 50; |
| 497 | 魔法数字(轮次/计数) | low | 8; |
| 498 | 魔法数字(轮次/计数) | low | 4; |
| 503 | 魔法数字(轮次/计数) | low | 3, |
| 506 | 魔法数字(轮次/计数) | low | 20; |
| 507 | 魔法数字(轮次/计数) | low | 50; |

### packages/tui/src/tui-details-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 27 | export函数超过100行 | low | export function findEvidence |
| 37 | export函数超过100行 | low | export function formatEvidenceDetails |
| 48 | export函数超过100行 | low | export function parseLogArtifactRequest |
| 71 | export函数超过100行 | low | export function readPositiveIntegerArg |
| 75 | 魔法数字(轮次/计数) | low | 10) |
| 79 | export函数超过100行 | low | export function createLogArtifactRegistry |
| 98 | export函数超过100行 | low | export function formatAgentDetails |
| 106 | 魔法数字(轮次/计数) | low | 5) |
| 140 | TuiContext直接字段修改 | low | context.language = |

### packages/tui/src/tui-memory-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 62 | 魔法数字(轮次/计数) | low | 3; |
| 68 | export函数超过100行 | low | export function createMemoryCandidate |
| 87 | export函数超过100行 | low | export function parseMemoryCandidateArgs |
| 102 | export函数超过100行 | low | export async function writeMemoryRecord |
| 115 | export函数超过100行 | low | export async function writeMemoryLearningMode |
| 134 | export函数超过100行 | low | export async function removeMemoryRecord |
| 148 | export函数超过100行 | low | export function getMemoryDirectory |
| 154 | export函数超过100行 | low | export function findMemoryRecord |
| 168 | export函数超过100行 | low | export function removeMemoryFromState |
| 176 | export函数超过100行 | low | export function formatMemoryScope |
| 182 | export函数超过100行 | low | export function formatProjectRulesContext |
| 183 | if-elseif链无else兜底 | low | if (context.memory.projectRulesError) {     return "unreadable; 可检查文件权限或运行 /memo... |
| 192 | export函数超过100行 | low | export function formatMemoryStatus |
| 212 | export函数超过100行 | low | export function formatMemoryStorage |
| 233 | export函数超过100行 | low | export function formatMemoryReview |
| 235 | 魔法数字(轮次/计数) | low | 5) |
| 241 | 魔法数字(轮次/计数) | low | 5) |
| 259 | 魔法数字(轮次/计数) | low | 8) |
| 262 | 魔法数字(轮次/计数) | low | 100) |
| 270 | export函数超过100行 | low | export function formatMemoryStats |
| 278 | TuiContext直接字段修改 | low | context.language = |
| 306 | export函数超过100行 | low | export function countMemoryScopes |
| 314 | export函数超过100行 | low | export function createEvidenceBackedMemoryCandidates |
| 329 | 魔法数字(轮次/计数) | low | 3) |
| 332 | 魔法数字(轮次/计数) | low | 3) |
| 353 | 魔法数字(轮次/计数) | low | 20, |
| 362 | export函数超过100行 | low | export function containsSecret |
| 374 | 魔法数字(轮次/计数) | low | 3, |
| 376 | 魔法数字(轮次/计数) | low | 3, |
| 380 | 魔法数字(轮次/计数) | low | 3, |
| 384 | 魔法数字(轮次/计数) | low | 3, |
| 389 | export函数超过100行 | low | export function extractLearningCandidatesFromInput |
| 401 | 魔法数字(轮次/计数) | low | 5) |
| 416 | export函数超过100行 | low | export function formatMemoryLearningRun |
| 437 | export函数超过100行 | low | export function createControlledMemoryInjection |
| 457 | export函数超过100行 | low | export function estimateMemoryTokens |
| 458 | 魔法数字(轮次/计数) | low | 4) |
| 461 | export函数超过100行 | low | export function formatControlledMemoryForModel |
| 476 | export函数超过100行 | low | export function createLinghunMdTemplate |
| 539 | export函数超过100行 | low | export async function formatProjectRulesRead |
| 543 | TuiContext直接字段修改 | low | context.language = |
| 552 | TuiContext直接字段修改 | low | context.language = |
| 559 | TuiContext直接字段修改 | low | context.language = |

### packages/tui/src/tui-model-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 60 | 魔法数字(轮次/计数) | low | 50; |
| 72 | export函数超过100行 | low | export function shouldOfferUserScopedModelSetup |
| 76 | export函数超过100行 | low | export async function getStartupProjectRouteProblem |
| 86 | export函数超过100行 | low | export async function readProjectExecutorRouteOverride |
| 94 | catch返回null/undefined | low | } catch {     return undefined;   } |
| 99 | export函数超过100行 | low | export function getProjectModelRouteProblem |
| 105 | export函数超过100行 | low | export function getProjectModelRouteProblemForRoute |
| 123 | export函数超过100行 | low | export function hasSelectedProviderConfigProblem |
| 131 | export函数超过100行 | low | export function getRuntimeStatusProvider |
| 140 | export函数超过100行 | low | export function getActiveEndpointProfileLabel |
| 153 | export函数超过100行 | low | export function resolveInitialModel |
| 161 | export函数超过100行 | low | export function getSelectedModelRuntime |
| 209 | export函数超过100行 | low | export function formatReasoningEffectiveState |
| 219 | export函数超过100行 | low | export function resolveProviderForModel |
| 248 | export函数超过100行 | low | export function createModelGateway |
| 259 | export函数超过100行 | low | export function resolveRoleRoute |
| 302 | 魔法数字(轮次/计数) | low | 8) |
| 316 | TuiContext直接字段修改 | low | context.routeDecisions.unshift( |
| 317 | TuiContext直接字段修改 | low | context.routeDecisions =  |
| 321 | export函数超过100行 | low | export function createRouteRepairSuggestions |
| 344 | export函数超过100行 | low | export function formatRoutePauseMessage |

### packages/tui/src/tui-output-surface.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 11 | 魔法数字(轮次/计数) | low | 12; |
| 72 | TuiContext直接字段修改 | low | context.lastFullOutput =  |
| 104 | TuiContext直接字段修改 | low | context.streamingAssistant =  |
| 180 | TuiContext直接字段修改 | low | context.lastFullOutput =  |
| 198 | TuiContext直接字段修改 | low | context.lastFullOutput =  |
| 220 | TuiContext直接字段修改 | low | context.language = |
| 232 | TuiContext直接字段修改 | low | context.lastFullOutput =  |
| 257 | TuiContext直接字段修改 | low | context.language = |
| 262 | TuiContext直接字段修改 | low | context.language = |
| 269 | TuiContext直接字段修改 | low | context.lastFullOutput =  |
| 283 | TuiContext直接字段修改 | low | context.language = |
| 295 | TuiContext直接字段修改 | low | context.lastFullOutput =  |
| 319 | TuiContext直接字段修改 | low | context.lastFullOutput =  |
| 327 | TuiContext直接字段修改 | low | context.streamingAssistant =  |
| 331 | TuiContext直接字段修改 | low | context.streamingAssistant =  |
| 336 | TuiContext直接字段修改 | low | context.streamingAssistant =  |
| 418 | TuiContext直接字段修改 | low | context.lastFullOutput =  |
| 430 | TuiContext直接字段修改 | low | context.lastFullOutput =  |
| 452 | 魔法数字(轮次/计数) | low | 12) |
| 500 | export函数超过100行 | low | export function beginAssistantStream |
| 507 | export函数超过100行 | low | export function writeAssistantDelta |
| 517 | export函数超过100行 | low | export function endAssistantStream |
| 529 | export函数超过100行 | low | export function discardAssistantBlock |
| 540 | export函数超过100行 | low | export function replaceAssistantBlockContent |
| 554 | export函数超过100行 | low | export function writeDiagnosticLine |
| 573 | export函数超过100行 | low | export function writeErrorLine |
| 582 | export函数超过100行 | low | export function writeLocalCommandOutputLine |
| 595 | export函数超过100行 | low | export function createShellBlockOutputForTest |

### packages/tui/src/tui-permission-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 74 | export函数超过100行 | low | export async function addAllowRule |
| 123 | export函数超过100行 | low | export function toPermissionPromptView |
| 134 | export函数超过100行 | low | export async function decidePermission |
| 190 | TuiContext直接字段修改 | low | context.permissionMode = |
| 217 | TuiContext直接字段修改 | low | context.permissionMode = |
| 244 | TuiContext直接字段修改 | low | context.permissionMode = |
| 265 | export函数超过100行 | low | export async function recordPermissionDenied |
| 277 | 魔法数字(轮次/计数) | low | 20) |
| 281 | export函数超过100行 | low | export async function loadPermissionState |
| 297 | export函数超过100行 | low | export async function savePermissionState |
| 305 | export函数超过100行 | low | export function permissionStatePath |

### packages/tui/src/tui-state-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 56 | 魔法数字(轮次/计数) | low | 20; |
| 71 | export函数超过100行 | low | export function createCacheState |
| 112 | export函数超过100行 | low | export function createRemoteState |
| 152 | export函数超过100行 | low | export function applyRemoteSessionDisables |
| 166 | if-elseif链无else兜底 | low | if (config.transport === "webhook_mock") {     return "mock";   }   if (config.t... |
| 184 | if-elseif链无else兜底 | low | if (bindingStatus !== "bound") {     return "not_bound";   }   if (config.transp... |
| 190 | if-elseif链无else兜底 | low | if (config.transport === "webhook" && transportStatus !== "ready") {     return ... |
| 210 | if-elseif链无else兜底 | low | if (reason === "cli_missing") {     return getRemoteInstallHint(config.type);   ... |
| 222 | export函数超过100行 | low | export function getRemoteInstallHint |
| 223 | if-elseif链无else兜底 | low | if (type === "feishu" \|\| type === "lark") {     return "install lark-cli/feishu-... |
| 232 | export函数超过100行 | low | export function createMcpState |
| 257 | export函数超过100行 | low | export function createMcpToolPlaceholders |
| 286 | export函数超过100行 | low | export async function createMemoryState |
| 328 | export函数超过100行 | low | export function summarizeProjectRules |
| 359 | catch返回null/undefined | low | } catch {     return null;   } |
| 371 | catch返回空数组 | low | } catch {     return [];   } |
| 389 | catch返回null/undefined | low | } catch {     return null;   } |
| 398 | if-elseif链无else兜底 | low | if (     typeof value.id !== "string" \|\|     typeof value.summary !== "string" \|... |
| 434 | export函数超过100行 | low | export function normalizeMemoryStatus |
| 445 | export函数超过100行 | low | export async function createSkillState |
| 478 | export函数超过100行 | low | export function createWorkflowState |
| 532 | export函数超过100行 | low | export async function createHookState |
| 549 | export函数超过100行 | low | export async function createPluginState |
| 804 | catch返回空数组 | low | } catch {     return [];   } |
| 832 | export函数超过100行 | low | export function stableId |
| 888 | export函数超过100行 | low | export async function pathExists |
| 901 | export函数超过100行 | low | export function codebaseMemoryRequiredArgs |
| 916 | export函数超过100行 | low | export function stabilizeMcpToolList |
| 930 | export函数超过100行 | low | export function isRecord |

### packages/tui/src/usage-stats-presenter.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 6 | export函数超过100行 | low | export function formatUsage |
| 26 | export函数超过100行 | low | export function formatRoleUsageLines |
| 32 | 魔法数字(轮次/计数) | low | 4) |
| 32 | toFixed未检查NaN | low | `  - ${usage.role}/${usage.provider}/${usage.model}: input ${usage.inputTokens}; |
| 36 | export函数超过100行 | low | export function formatStats |
| 65 | export函数超过100行 | low | export function formatEndpointStats |
| 91 | export函数超过100行 | low | export function sumCacheHistory |
| 108 | export函数超过100行 | low | export function formatPercent |
| 109 | 魔法数字(轮次/计数) | low | 100) |
| 109 | toFixed未检查NaN | low | return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`; |

### packages/tui/src/verification-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 24 | export函数超过100行 | low | export async function createVerificationPlan |
| 62 | export函数超过100行 | low | export function addPackageStep |
| 75 | export函数超过100行 | low | export async function runVerificationPlan |
| 94 | TuiContext直接字段修改 | low | context.activeVerificationAbortController =  |
| 95 | TuiContext直接字段修改 | low | context.interrupt =  |
| 105 | 魔法数字(毫秒超时) | low | 30_000 |
| 106 | 魔法数字(毫秒超时) | low | 120_000 |
| 266 | TuiContext直接字段修改 | low | context.activeVerificationAbortController = |
| 267 | TuiContext直接字段修改 | low | context.activeVerificationAbortController =  |
| 269 | TuiContext直接字段修改 | low | context.interrupt =  |
| 273 | export函数超过100行 | low | export async function runVerificationCommand |
| 353 | export函数超过100行 | low | export function detectRunnerCompatibilityError |
| 381 | export函数超过100行 | low | export function createReviewReport |
| 430 | export函数超过100行 | low | export function formatVerificationPlan |
| 438 | export函数超过100行 | low | export function formatVerificationReport |
| 461 | export函数超过100行 | low | export function formatVerificationLast |
| 471 | export函数超过100行 | low | export function summarizeVerificationOutput |
| 487 | export函数超过100行 | low | export async function safeReadJson |
| 490 | catch返回null/undefined | low | } catch {     return null;   } |

### packages/tui/src/verification-level.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 70 | 魔法数字(轮次/计数) | low | 3, |
| 71 | 魔法数字(轮次/计数) | low | 4, |
| 85 | export函数超过100行 | low | export function classifyVerificationLevel |
| 109 | export函数超过100行 | low | export function isNonUpgradeableStatus |
| 127 | export函数超过100行 | low | export function detectVerificationInflation |
| 153 | export函数超过100行 | low | export function classifyRunnerVerificationLevel |
| 187 | export函数超过100行 | low | export function classifyProviderVerificationLevel |
| 204 | export函数超过100行 | low | export function formatVerificationLevel |
| 221 | export函数超过100行 | low | export function compareVerificationLevels |

### packages/tui/src/workflow-agent-runtime-bridge.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 224 | export函数超过100行 | low | export function decideWorkflowStepCapability |
| 257 | export函数超过100行 | low | export function bridgeWorkflowPlanToMainChainRequests |
| 755 | 魔法数字(轮次/计数) | low | 20) |
| 765 | 魔法数字(轮次/计数) | low | 8) |
| 773 | 魔法数字(轮次/计数) | low | 20) |

### packages/tui/src/workflow-command-runtime.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 95 | export函数超过100行 | low | export function configureWorkflowCommandRuntime |
| 168 | export函数超过100行 | low | export async function handleWorkflowsCommand |
| 176 | TuiContext直接字段修改 | low | context.language = |
| 196 | TuiContext直接字段修改 | low | context.language = |
| 220 | TuiContext直接字段修改 | low | context.language = |
| 242 | TuiContext直接字段修改 | low | context.language = |
| 256 | TuiContext直接字段修改 | low | context.language = |
| 275 | TuiContext直接字段修改 | low | context.lastFullOutput =  |
| 286 | TuiContext直接字段修改 | low | context.language = |
| 327 | export函数超过100行 | low | export function buildWorkflowPlannerContextInput |
| 342 | 魔法数字(轮次/计数) | low | 5) |
| 350 | 魔法数字(轮次/计数) | low | 5) |
| 353 | 魔法数字(轮次/计数) | low | 8) |
| 416 | export函数超过100行 | low | export async function hydrateWorkflowRuns |
| 490 | catch返回null/undefined | low | } catch {     return null;   } |
| 546 | export函数超过100行 | low | export function upsertWorkflowBackgroundTask |
| 555 | export函数超过100行 | low | export function createWorkflowInterruptBackgroundTask |
| 564 | 魔法数字(轮次/计数) | low | 50) |
| 576 | 魔法数字(毫秒超时) | low | 30_000 |
| 577 | 魔法数字(毫秒超时) | low | 120_000 |
| 591 | export函数超过100行 | low | export function formatWorkflowStatus |
| 594 | TuiContext直接字段修改 | low | context.language = |
| 626 | export函数超过100行 | low | export function formatWorkflowStartPrimary |
| 698 | export函数超过100行 | low | export async function runWorkflowSteps |
| 761 | export函数超过100行 | low | export async function __testRunWorkflowStepsWithPlan |
| 771 | export函数超过100行 | low | export function __testGetCurrentWorkflowStepRequest |
| 795 | 魔法数字(轮次/计数) | low | 8) |
| 811 | 魔法数字(轮次/计数) | low | 50) |
| 817 | 魔法数字(毫秒超时) | low | 30_000 |
| 818 | 魔法数字(毫秒超时) | low | 120_000 |
| 989 | TuiContext直接字段修改 | low | context.language = |
| 1018 | TuiContext直接字段修改 | low | context.language = |
| 1030 | TuiContext直接字段修改 | low | context.language = |
| 1045 | export函数超过100行 | low | export function findRegistryWorkflow |
| 1053 | export函数超过100行 | low | export function findRegistryAgentWorkflow |
| 1064 | export函数超过100行 | low | export async function runRegistryAgentWorkflow |
| 1079 | export函数超过100行 | low | export async function runRegistryWorkflow |
| 1087 | 魔法数字(轮次/计数) | low | 8) |
| 1104 | 魔法数字(轮次/计数) | low | 50) |
| 1110 | 魔法数字(毫秒超时) | low | 30_000 |
| 1111 | 魔法数字(毫秒超时) | low | 120_000 |
| 1157 | TuiContext直接字段修改 | low | context.language = |
| 1278 | TuiContext直接字段修改 | low | context.permissionMode = |
| 1296 | TuiContext直接字段修改 | low | context.language = |
| 1317 | TuiContext直接字段修改 | low | context.language = |
| 1373 | TuiContext直接字段修改 | low | context.language = |
| 1396 | TuiContext直接字段修改 | low | context.language = |
| 1448 | if-elseif链无else兜底 | low | if (job.status === "blocked" \|\| job.status === "sleeping" \|\| job.status === "sta... |
| 1477 | as断言绕过类型 | low | as never |
| 1496 | if-elseif链无else兜底 | low | if (request.sliceId === "slice-architecture-review") {       return await execut... |
| 1537 | TuiContext直接字段修改 | low | context.language = |
| 1553 | TuiContext直接字段修改 | low | context.language = |
| 1621 | TuiContext直接字段修改 | low | context.language = |
| 1681 | TuiContext直接字段修改 | low | context.language = |
| 1724 | TuiContext直接字段修改 | low | context.language = |
| 1745 | TuiContext直接字段修改 | low | context.language = |
| 1909 | 魔法数字(轮次/计数) | low | 4, |
| 2090 | export函数超过100行 | low | export async function runWorkflowVerificationStep |
| 2111 | TuiContext直接字段修改 | low | context.lastVerification =  |
| 2128 | TuiContext直接字段修改 | low | context.backgroundTasks.splice( |
| 2138 | export函数超过100行 | low | export async function finishWorkflowRun |
| 2280 | 魔法数字(轮次/计数) | low | 5) |

### packages/tui/src/workflow-plan-schema.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 4 | 魔法数字(轮次/计数) | low | 3; |
| 237 | export函数超过100行 | low | export function normalizeWorkflowPlan |
| 374 | export函数超过100行 | low | export function projectWorkflowPlan |
| 698 | 魔法数字(轮次/计数) | low | 8, |
| 700 | 魔法数字(轮次/计数) | low | 8, |
| 708 | export函数超过100行 | low | export function mapWorkflowSliceStatusToDurableJobAgentStatus |

### packages/tui/src/workflow-planner-entry.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 49 | export函数超过100行 | low | export function generateWorkflowPlanPreview |
| 93 | 魔法数字(轮次/计数) | low | 3; |
| 107 | 魔法数字(轮次/计数) | low | 5) |
| 111 | 魔法数字(轮次/计数) | low | 200) |
| 117 | 魔法数字(轮次/计数) | low | 5) |
| 131 | 魔法数字(轮次/计数) | low | 200) |
| 155 | 魔法数字(轮次/计数) | low | 200, |
| 188 | 魔法数字(毫秒超时) | low | 10_000 |
| 301 | 魔法数字(毫秒超时) | low | 120_000 |
| 313 | 魔法数字(轮次/计数) | low | 200) |
| 389 | 魔法数字(轮次/计数) | low | 8, |
| 391 | 魔法数字(轮次/计数) | low | 8, |
| 398 | export函数超过100行 | low | export function formatWorkflowPlanPreview |

### packages/tui/src/workflow-task-surface.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 63 | export函数超过100行 | low | export function projectWorkflowTaskSurface |
| 254 | if-elseif链无else兜底 | low | if (bridgeResult.summary.blocked > 0) {     return isZh ? "先处理受阻任务，再继续推进。" : "Re... |
| 262 | if-elseif链无else兜底 | low | if (bridgeResult.summary.runnable > 0) {     return isZh       ? "已有可执行提案，交给主流程继... |
| 416 | 魔法数字(轮次/计数) | low | 8, |
| 418 | 魔法数字(轮次/计数) | low | 8, |

### packages/tui/src/workspace-reference-cache.ts

| 行号 | 类型 | 严重度 | 内容 |
|------|------|--------|------|
| 161 | export函数超过100行 | low | export async function getWorkspaceReferenceSnapshot |
| 274 | export函数超过100行 | low | export function createWorkspaceReferenceCache |
| 278 | export函数超过100行 | low | export function workspaceReferenceHash |
| 297 | export函数超过100行 | low | export function isFallbackWorkspaceReferenceSnapshot |
| 602 | 魔法数字(轮次/计数) | low | 12) |
| 638 | 魔法数字(轮次/计数) | low | 200) |
| 723 | 魔法数字(轮次/计数) | low | 12) |
| 746 | 魔法数字(轮次/计数) | low | 20) |
| 760 | 魔法数字(轮次/计数) | low | 12) |
