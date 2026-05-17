# Linghun Phase 15 Pre-Beta CCB Coding Capability & Interaction Parity Full Audit

> 审计类型：只读审计（未修改任何代码）
> 审计日期：2026-05-17
> 审计范围：基于 CCB / CCB Dev Boost 成熟编码能力和终端交互体验，对 Linghun Phase 15 pre-Beta 做全面对照审计
> 审计依据：直接阅读 Linghun 全部 10 份必读文档、8 份实现源码（11836 行）、CCB 源码关键文件、codebase-memory 索引；仅参考公开行为与验收边界，未复制任何源码

---

## 1. Executive Summary

### 1.1 总体结论

**Linghun Phase 15 pre-Beta 已达到进入真实项目 Beta 的基本条件，存在 3 项 P1 残余项和若干 P2 打磨项，但无 P0 阻塞项。**

Linghun 的 Natural Command Bridge 是正确的自研架构方向——它不是"关键词补丁"，而是本地安全裁决层。CCB 不做本地自然语言→命令映射（直接交给模型猜测），Linghun 主动做了且做得比 CCB 更安全。这不是"追 CCB 的 feature gap"，而是 Linghun 的架构优势。

但与 CCB 成熟编码体验相比，仍有 3 类差距需要在 Beta 前/中持续观察：
1. **交互工程化差距**：CCB 的 PermissionPrompt 允许 "accept with feedback" / "reject with reason" / "Tab to amend" 等交互粒度，Linghun 当前是文本行交互，更偏"命令壳"感。
2. **工具执行手感差距**：CCB 的工具执行（Bash/Write/Edit）有流式输出、退出码诊断、超时处理、断线重连等细节；Linghun Phase 05 实现了基础工具但细节饱满度有差距。
3. **状态栏信息密度差距**：CCB 状态栏显示 cost、rate limit 倒计时、context 使用百分比；Linghun 状态栏不显示 cost（这是正确设计），但缺少 context 使用率和 rate limit 提示。

### 1.2 是否阻塞 Phase 15 Beta

**不阻塞。** 之前两轮审计（v1/v2）发现的 P0/P1 问题均已修复。剩余 P1 项是交互工程化打磨，P2 项是体验增强，均可在 Beta 中并行观察和 Phase 15.5 中集中修复。

### 1.3 核心发现

| 发现 | 结论 |
|------|------|
| CCB 是否用本地 regex 把自然语言映射 slash command？ | **否。** CCB 的 commands.ts（841 行）中零 regex/零 natural language 匹配。自然语言直接进模型。 |
| Linghun 这样做是否合理？ | **是，且更优。** Linghun 的本地 NCB 是安全增强，不是 CCB gap。 |
| Linghun 是否有"关键词补丁化"风险？ | **当前没有。** Catalog + router + scoring + 6 inquiry types + Start Gate 构成完整裁决链。但需警惕后续在 detectInquiry/scoreCapability 中持续追加 if/else。 |
| Linghun 是否有"为像 CCB 而复制"风险？ | **当前没有。** NCB 是自研架构，CCB 根本没有对应组件。 |
| Linghun 是否有代码无限膨胀风险？ | **中等风险。** index.ts 已达 6553 行，handleSlashCommand 是 35 路 else-if 链。需要 registry map 化，但当前不阻塞 Beta。 |

---

## 2. CCB 编码主链路证据

### 2.1 命令系统

**证据文件**：`F:\ccb-source\src\commands.ts`（841 行）

CCB 的命令系统架构：
- 静态 `COMMANDS[]` 数组（`memoize((): Command[] => [...])`），约 100+ 命令
- 每个命令从独立文件 import（`import addDir from './commands/add-dir/index.js'`）
- 大量 feature-flag 条件导入（`feature('PROACTIVE')`, `feature('KAIROS')`, `feature('FORK_SUBAGENT')` 等）
- Skills/Plugins/Workflows 贡献命令通过动态加载：`getSkillDirCommands(cwd)`, `getPluginCommands()`, `getWorkflowCommands(cwd)`
- 命令类型包括：`prompt`、`local`、`local-jsx` 等

**关键发现：零自然语言匹配。** `grep -c "regex\|natural\|intent" commands.ts` 返回 0。CCB 不做本地自然语言→命令映射。

### 2.2 工具系统

**证据文件**：`F:\ccb-source\src\Tool.ts`

CCB 的工具接口包含：
- `ToolInputJSONSchema`：JSON Schema 类型定义
- 权限类型（从集中位置导入）：`PermissionMode`, `PermissionResult`, `ToolPermissionRulesBySource`
- 工具进度类型：`AgentToolProgress`, `BashProgress`, `MCPProgress`, `SkillToolProgress` 等
- 文件状态缓存：`FileStateCache`
- 拒绝跟踪状态：`DenialTrackingState`

### 2.3 权限管道

**证据文件**：`F:\ccb-source\src\components\permissions\PermissionPrompt.tsx`

CCB 的权限交互：
- 每个工具类型有专用 PermissionRequest 组件（BashPermissionRequest、FileEditPermissionRequest、FileWritePermissionRequest 等，共 18 个子目录）
- `PermissionPrompt.tsx`：共享交互组件，提供 "accept/reject" 选项 + feedback 输入（"告诉 Claude 下一步做什么"/"告诉 Claude 哪里需要改进"）
- 支持键盘快捷键（Tab 修改、Esc 取消）
- 权限决策带 analytics 埋点

### 2.4 状态栏

**证据文件**：`F:\ccb-source\src\components\BuiltinStatusLine.tsx`

CCB 状态栏显示：
- **Model name**（取前两个词，如 "Opus 4.6"）
- **上下文使用率**：`contextUsedPct%` + token 显示（如 "50k/1M"）
- **5 小时会话限额**：utilization% + 倒计时
- **7 天周限额**：utilization% + 倒计时
- **Cost**：`formatCost(totalCostUsd)`（仅大于 0 时显示）
- 窄终端（<60 列）隐藏部分细节

**关键发现**：CCB 状态栏**显示 cost**。这与 Linghun 设计（cost 仅进入 `/usage`/`/stats`）不同。CCB 也不显示 provider 名，只显示 model 名。

### 2.5 上下文压缩

**证据文件**：`F:\ccb-source\src\components\CompactSummary.tsx`

CCB 的 compact 体验：
- 显示 "Summarized conversation" / "Conversation summarized to free up context"
- 显示 summarized messages 数量
- 显示压缩方向和用户上下文
- 快捷键提示："ctrl+o" 展开历史/查看摘要
- 两种模式：transcript 模式（显示摘要文本）和普通模式（简洁提示）

### 2.6 命令分发流程

从 `commands.ts` 分析，CCB 的命令分发：
1. `COMMANDS` 数组从所有 import + 动态加载源合并
2. `builtInCommandNames` 提取所有命令名和别名到 Set
3. `loadAllCommands(cwd)` 合并 skills/plugins/workflows/builtins
4. `meetsAvailabilityRequirement()` 按 auth/provider 过滤
5. 用户输入 `/xxx` → 匹配 command name/alias → 执行对应 handler
6. **普通自然语言直接进模型**，不经本地路由

---

## 3. Linghun 当前主链路证据

### 3.1 命令系统

**证据文件**：`F:\Linghun\packages\tui\src\index.ts` lines 1257-1440

Linghun 的命令分发：
- `handleSlashCommand()`：35 路 else-if 链（`if (command === "/help")`, `if (command === "/model")`, ...）
- 覆盖 44 个 slash command
- 工具类命令通过 `slashCommandToTool(command)` 映射到 builtInTools
- 除 `/exit` 外每个命令都返回 "handled"
- `SLASH_COMMAND_REGISTRY`（natural-command-bridge.ts lines 112-162）：独立维护的注册表
- `validateCommandCapabilityCoverage()`：漂移检测

### 3.2 自然语言入口

**证据文件**：`F:\Linghun\packages\tui\src\natural-command-bridge.ts`（1487 行）

Linghun 的自然语言处理链：
1. `detectInputLanguage(text)` → 判断 zh-CN/en-US
2. `normalizeIntentText(text)` → 统一化
3. `detectInquiry(text)` → 6 种 inquiry（status/doctor/usage/risk/howto/execute）
4. `detectDangerousNaturalIntent(text)` → 高风险措辞检测
5. `scoreCapability(capability, normalized)` → 对 44 个 capability 评分
6. `routeNaturalIntent(text)` → 融合以上结果，输出 NaturalIntent
7. `handleNaturalInput()` → 6 种 action 分派

**6 种 inquiry 类型**（natural-command-bridge.ts line 48）：
```typescript
inquiry: "status" | "doctor" | "usage" | "risk" | "howto" | "execute";
```

**6 种 action 分派**（natural-command-bridge.ts lines 32-38）：
```typescript
action: "answer" | "execute_readonly" | "start_gate" | "permission_pipeline" | "ask_clarify" | "model";
```

### 3.3 权限管道

**证据文件**：`F:\Linghun\packages\tui\src\index.ts` lines 5758-5861

`decidePermission()` 决策顺序：
1. **hardDeny**（line 5776）— .git/.ssh/密钥/系统目录
2. **plan mode**（line 5781）— 只允许 Read/Todo；禁止 Write/Edit/Bash
3. **userRules**（line 5791）— deny/ask/allow 规则匹配
4. **dontAsk**（line 5806）— 只读工具 allow，其他 deny
5. **acceptEdits**（line 5815）— 低风险工作区编辑 allow
6. **bypass**（line 5832）— allow（硬拒绝仍生效）
7. **auto**（line 5843）— 只读 allow；分类器不可用时 deny
8. **default**（line 5852）— 只读 allow；写入 allow with preflight

**决策顺序正确。** Plan mode 检查在用户规则之前（line 5781 vs 5791），防止预存 allow 规则绕过 plan 只读保护。

### 3.4 主对话循环

**证据文件**：`F:\Linghun\packages\tui\src\index.ts` lines 5192-5356

主循环流程：
1. `readInputLines()` → 解析用户输入
2. 若以 `/` 开头 → `handleSlashCommand()` → 直接执行
3. 否则 → `handleNaturalInput()`：
   - 有 pending gate → 检查确认/过期
   - 调用 `routeNaturalIntent()` → 得到 intent
   - 按 action 分派：model → 进模型；answer → 显示能力说明；execute_readonly → 直接执行等价命令；permission_pipeline → 阻断提示；start_gate → 生成 pending gate
4. 若进模型 → `sendMessage()`：
   - 构建 system prompt（含 RuntimeStatusForModel + CommandCapabilitySummary）
   - 流式请求模型
   - 记录 usage → recordModelUsage()
   - 输出 light hints + status

### 3.5 状态栏

**证据文件**：`F:\Linghun\packages\tui\src\index.ts` lines 6414-6431

Linghun 状态栏：7 字段
```
状态栏：session {session} · model {model} · mode {mode} · bg {background} · cache {cache} · index {index} · gate {gate}
```

- session：8 字符截断
- model：18 字符截断（无 provider）
- mode：permissionMode
- bg：后台运行任务数
- cache：命中率或 "--"
- index：index 状态
- gate："waiting confirmation" 或 "none"
- 总长度：120 字符截断
- **不显示 cost**（符合设计：金额仅进入 `/usage`/`/stats`）
- **不显示 context 使用率**
- **不显示 rate limit**

### 3.6 缓存与成本

**证据文件**：`F:\Linghun\packages\tui\src\index.ts` lines 4200-4300+

缓存 freshness 系统：
- `getCurrentFreshness()`：计算 11 个 hash 维度（systemPrompt/toolSchema/mcpToolList/model/provider/reasoningEffort/projectRules/memory/compact/plugins）
- `createCacheFreshness()`：构建 freshness 对象 + changedKeys 对比
- `refreshCacheFreshness()`：对比上次 freshness 产生 changedKeys
- `createExtensionFreshnessSummary()`：skills/workflows/hooks/plugins 稳定排序摘要
- `recordModelUsage()`：使用真实 provider（`getRuntimeStatusProvider(context)`）

### 3.7 Provider/模型

**证据文件**：`F:\Linghun\packages\providers\src\index.ts`（422 行）

- `Provider` 接口：`id/displayName/supports/listModels()/stream()`
- `ModelGateway`：多 provider 管理
- `OpenAiCompatibleProvider`：OpenAI 兼容实现
- `DeepSeekProvider`：DeepSeek 实现
- 模型能力表：`ModelInfo`（contextWindow/maxOutputTokens/supportsTools/supportsVision/supportsThinking/supportsPromptCache/price）
- Provider adapter 事件转换：统一为 `LinghunEvent`

### 3.8 配置系统

**证据文件**：`F:\Linghun\packages\config\src\index.ts`（621 行）

- 完整类型系统：`LinghunConfig`, `ProviderConfig`, `ModelRouteConfig`, `RoleModelRoute`, `StorageConfig`, `SkillConfig`, `WorkflowConfig`, `HookConfig`, `PluginConfig`
- 环境变量支持：`LINGHUN_DEEPSEEK_API_KEY/BASE_URL/MODEL`, `LINGHUN_OPENAI_API_KEY/BASE_URL/MODEL`, `LINGHUN_DEFAULT_MODEL`
- `mergeConfig()`：配置优先级合并
- 占位模型保护：不覆盖环境变量中已设置的真实模型

### 3.9 会话系统

**证据文件**：`F:\Linghun\packages\core\src\session-store.ts`（176 行）

- `SessionStore`：create/list/resume/appendEvent/updateSummary
- JSONL transcript 持久化
- 按项目分组（projectId）
- Session metadata 管理

### 3.10 工具系统

**证据文件**：`F:\Linghun\packages\tools\src\index.ts`（578 行）

- 9 个内置工具：Read/Write/Edit/MultiEdit/Grep/Glob/Bash/Todo/Diff
- `ToolDefinition`：name/title/description/permission/isReadOnly/isConcurrencySafe/call
- `ToolPermissionSpec`：risk(low/medium/high)/scope/reason
- `builtInTools`：Record<ToolName, ToolDefinition>
- `runTool()`：工具执行入口
- 工具实现：readFile/writeFile/editFile/multiEdit/grepFiles/globFiles/runBash/todoActions/computeDiff

---

## 4. 差距矩阵

### 4.1 编码主循环

| 维度 | CCB | Linghun | 差距等级 | 说明 |
|------|-----|---------|---------|------|
| 自然语言入口 | 直接进模型 | 本地 NCB 裁决 → 模型 | **Linghun 更优** | NCB 是安全增强 |
| 命令分发 | 静态 COMMANDS[] + 动态加载 | 35 路 else-if 链 | P2 | dispatch 需 registry map 化 |
| 流式响应 | ✓ | ✓ | — | 等价 |
| 上下文构建 | 分层 prompt + CLAUDE.md | RuntimeStatus + CapabilitySummary | — | Linghun summary-first 更省 token |
| 模型请求 | gateway | ModelGateway | — | 等价 |

### 4.2 Slash Command 与 Prompt Command

| 维度 | CCB | Linghun | 差距等级 | 说明 |
|------|-----|---------|---------|------|
| Command 注册 | 独立文件 import | else-if 链 + 独立 registry | P2 | — |
| Command 类型 | prompt/local/local-jsx | 仅 local | P2 | prompt command 放 Phase 15.5 |
| 别名支持 | ✓（aliases 数组） | ✓（SLASH_COMMAND_REGISTRY aliases） | — | 等价 |
| Dynamic commands | Skills/Plugins/Workflows 贡献 | Skills/Plugins/Workflows 贡献 | — | 等价 |
| 发现性 | `/help` + model prompt | `/help` + catalog summary | — | 等价 |

### 4.3 Skill / Plugin / MCP Command

| 维度 | CCB | Linghun | 差距等级 | 说明 |
|------|-----|---------|---------|------|
| Skill 加载 | `getSkillDirCommands(cwd)` | `/skills` handler | — | 等价 |
| Plugin 命令 | `getPluginCommands()` | `/plugins` handler | — | 等价 |
| MCP 工具 | MCP SDK 动态发现 | MCP manager + stabilize | — | Linghun 有 MCP 稳定化 |
| 信任边界 | 第三方需确认 | 第三方未信任不启用 | — | 等价 |

### 4.4 Tool Use 与 Permission Pipeline

| 维度 | CCB | Linghun | 差距等级 | 说明 |
|------|-----|---------|---------|------|
| 权限决策顺序 | 未知（闭源） | hardDeny→plan→userRules→acceptEdits→bypass→auto→default | — | Linghun 决策链可审计 |
| 权限交互 | 18 种专用 PermissionRequest 组件 + PermissionPrompt（accept/reject/feedback） | 文本行交互 | **P1** | 交互工程化差距 |
| Allow once/always | ✓（permission options） | ✓（权限规则持久化） | — | 等价 |
| 拒绝反馈 | ✓（"告诉 Claude 哪里需要改进"） | 文本提示 | P2 | 放 Phase 15.5 |
| Plan 只读保护 | ✓ | ✓（plan check 先于 user rules） | — | **P1-4 已修复** |

### 4.5 Plan Mode / AcceptEdits / Auto / Bypass 边界

| 维度 | CCB | Linghun | 差距等级 | 说明 |
|------|-----|---------|---------|------|
| Plan mode 只读 | ✓ | ✓ | — | 等价 |
| Plan→bypass 阻断 | ✓ | ✓ | — | 等价 |
| AcceptEdits 边界 | 低风险编辑自动通过 | ✓（isLowRiskWorkspaceEdit） | — | 等价 |
| Auto 分类器 | 闭源 | LINGHUN_ENABLE_AUTO_PERMISSION=1 显式 opt-in | **Linghun 更安全** | — |
| Bypass 显式 opt-in | `/mode bypass` 直接切换 | LINGHUN_ENABLE_BYPASS=1 | **Linghun 更安全** | — |
| Plan approval 三态 | accept+auto-accept / accept+manual / reject+feedback | manual/acceptEdits 区分 | P2 | 完整三态放 Phase 15.5 |

### 4.6 Edit/Write/Bash/Read/Grep/Glob 工具体验

| 维度 | CCB | Linghun | 差距等级 | 说明 |
|------|-----|---------|---------|------|
| Read | ✓ | ✓ | — | 等价 |
| Write/Edit | ✓ | ✓ | — | 等价 |
| MultiEdit | ✓ | ✓ | — | 等价 |
| Grep | ✓ | ✓ | — | 等价 |
| Glob | ✓ | ✓ | — | 等价 |
| Bash | 流式输出+超时+退出码诊断 | ✓（但细节饱满度低） | P2 | Bash 执行诊断增强放 Phase 15.5 |
| Diff | ✓ | ✓ | — | 等价 |
| 工具并行 | 只读并行/写入串行 | ✓（isConcurrencySafe 标记） | — | 等价 |

### 4.7 Natural Command Bridge 是否关键词补丁化

| 检查项 | 状态 | 证据 |
|--------|------|------|
| 是否只是关键词匹配？ | **否** | 有 scoring 算法（token+alias+boost），非简单 keyword→command |
| 是否有意图分类？ | **是** | 6 种 inquiry type，7 种 request kind 意图契约 |
| 是否有安全裁决？ | **是** | Start Gate + permission_pipeline + exact confirmation |
| 是否有低置信度处理？ | **是** | topScore < 2.2 或 candidates 分数接近 → ask_clarify |
| 是否有中英文等价？ | **是** | 同一 capability 中英文走同一 risk handler |
| 是否有漂移风险？ | **是，受控** | SLASH_COMMAND_REGISTRY + COMMAND_CAPABILITY_DATA + handleSlashCommand 三处独立，但 drift detection 存在 |
| 是否持续追加 if/else？ | **中等风险** | detectInquiry 和 scoreCapability 中已有针对特定 capability 的 boost 逻辑 |

**结论**：不是关键词补丁。但存在向"规则累积"退化的风险——如果在 detectInquiry/scoreCapability 中持续追加针对新场景的 if/else/boost，最终会变成补丁堆。当前 1487 行尚可管理。

### 4.8 状态查询 vs 动作请求裁决方式

| 检查项 | CCB | Linghun | 说明 |
|--------|-----|---------|------|
| "现在是什么模型" | 模型基于 system prompt 回答 | NCB → status inquiry → execute_readonly → `/model` | Linghun 更精确 |
| "模型 key 配好了吗" | 模型给出通用建议 | NCB → doctor inquiry → execute_readonly → `/model route doctor` | Linghun 更精确 |
| "帮我建立索引" | 模型判断是否执行 | NCB → execute → start_gate → 需精确确认 | Linghun 更安全 |

### 4.9 Start Gate 与 Permission Prompt 的关系

| 维度 | CCB | Linghun | 说明 |
|------|-----|---------|------|
| 启动前确认 | 无（模型自行判断） | Start Gate（本地裁决） | Linghun 更安全 |
| 确认粒度 | PermissionPrompt（accept/reject/feedback） | exact command / yes / cancel | CCB 交互更丰富 |
| 过期机制 | 无 | pending gate 90s 过期 | Linghun 独有 |
| 高风险 exact confirmation | 无 | 高风险必须精确输入命令 | Linghun 更安全 |

### 4.10 状态栏 / Hint / Help / Footer

| 维度 | CCB | Linghun | 差距等级 |
|------|-----|---------|---------|
| 状态栏字段数 | 5-7（model/context/rate limits/cost） | 7（session/model/mode/bg/cache/index/gate） | — |
| Cost 显示 | 状态栏显示 | `/usage`/`/stats` 显示 | —（设计选择不同） |
| Context 使用率 | 显示 | 不显示 | P2 |
| Rate limit | 显示（5h/7d + 倒计时） | 不显示 | P2 |
| Provider 名 | 不显示（仅 model） | 不显示（仅 model） | —（等价） |
| Help | `/help` 页面 | catalog 派生 + 原有 help | — |
| Hint/提示 | 快捷键提示 | light hints + 证据门检查 | — |

### 4.11 错误提示 / 失败恢复 / 缺配置诊断

| 维度 | CCB | Linghun | 差距等级 |
|------|-----|---------|---------|
| API key 缺失 | "Authentication error: check your API key" | `/model route doctor` 诊断 + 修复建议 | — |
| 配置诊断 | doctor 命令 | `/model route doctor` + `/plugins doctor` + `/doctor hooks` | **Linghun 更完整** |
| Provider 连接失败 | 针对性提示 | 通用 catch（但有 doctor 缓解） | P2 |
| 错误可操作性 | 有 action hint | doctor 输出可操作，顶层 catch 较通用 | P2 |

### 4.12 Memory / Rules / LINGHUN.md 与 CLAUDE.md

| 维度 | CCB | Linghun | 差距等级 |
|------|-----|---------|---------|
| 项目规则加载 | CLAUDE.md → AGENTS.md → .local.md | LINGHUN.md → CLAUDE.md（兼容）→ AGENTS.md（兼容） | — |
| 缺规则提示 | 静默 | `[hint:info] 缺少 LINGHUN.md` | **Linghun 更友好** |
| 规则模板 | 无 | `/memory init` 中文"项目规则"模板 | **Linghun 独有** |
| 记忆管理 | memory 命令 | `/memory` + candidate/accept/delete | — |
| Handoff | 无正式 handoff | structured handoff packet | **Linghun 独有** |

### 4.13 Session Resume / Branch / Handoff

| 维度 | CCB | Linghun | 差距等级 |
|------|-----|---------|---------|
| Session 列表 | `/resume` | `/sessions` | — |
| Session 恢复 | ✓ | `/sessions resume <id>` + handoff 验证 | — |
| Branch | `/branch` | `/branch`（handoff 派生） | — |
| JSONL 持久化 | ✓ | ✓ | — |
| Handoff 消费 | 无 | start_gate 消费 handoff | **Linghun 独有** |

### 4.14 Context Compact / Transcript / Summary-First

| 维度 | CCB | Linghun | 差距等级 |
|------|-----|---------|---------|
| 自动压缩 | ✓ | `cache.compacted` 标记 | — |
| 压缩提示 | "Conversation summarized to free up context" + 快捷键 | compact 状态记录 | P2 |
| Transcript 查看 | ctrl+o 展开 | JSONL 可读取 | — |
| Summary-first | ✓ | RuntimeStatusForModel <500 字符 + CapabilitySummary <1200 字符 | **Linghun 已验证** |

### 4.15 MCP / Codebase Index

| 维度 | CCB | Linghun | 差距等级 |
|------|-----|---------|---------|
| MCP 连接 | ✓ | ✓ | — |
| MCP 稳定化 | CCB Dev Boost 做 | ✓（stabilizeMcpToolList + description 去 timestamp/UUID） | — |
| 代码索引 | codebase-memory-mcp | `/index init fast/refresh/search/architecture` | — |
| 索引过期提醒 | CCB Dev Boost 做 | ✓（detect_changes + staleHint） | — |
| 大文件保护 | ✓ | ✓（大 JSON/SQL/XML/min.js 提示排除） | — |

### 4.16 Cache / Usage / Stats / Break-Cache

| 维度 | CCB | Linghun | 差距等级 |
|------|-----|---------|---------|
| 缓存命中展示 | 状态栏不直接展示 | 状态栏 `cache {hitRate}` | **Linghun 更可见** |
| Break-cache 诊断 | CCB Dev Boost 做 | ✓（9 hash changedKeys + suggestion） | — |
| Cache freshness 维度 | 未知 | 11 个维度 | **Linghun 更完整** |
| Usage | ✓ | ✓ | — |
| Stats | ✓ | ✓ | — |
| Endpoint 拆分 | ✓ | ✓（/stats endpoints） | — |
| Provider 准确传递 | 未知 | ✓（getRuntimeStatusProvider） | **P1 已修复** |

### 4.17 Agent / Multi-Model 路由

| 维度 | CCB | Linghun | 差距等级 |
|------|-----|---------|---------|
| Agent 类型 | explorer/worker/verifier/planner | explorer/worker/verifier/planner | — |
| Fork | fork subagent | `/fork` | — |
| Agent handoff | agent 间传结构化摘要 | Phase 13 设计同样 | — |
| 多模型路由 | 手动切换 | `/model route set` + 角色路由 | — |
| Vision 模型补充 | 未知 | `/vision` + vision role | **Linghun 设计更完整** |
| 自动路由 | 无（或未知） | Phase 13 手动，自动放 Phase 15.5 | — |

### 4.18 i18n / 中英文体验

| 维度 | CCB | Linghun | 差距等级 |
|------|-----|---------|---------|
| 中文界面 | CCB Dev Boost 做部分中文化 | 原生双语 | **Linghun 更完整** |
| i18n 消息表 | 混合硬编码 | messages 对象（15 keys，zh-CN + en-US） | — |
| 部分 handler 硬编码 | — | 部分 handler 直接硬编码中文 | P2 |
| Catalog 双语 | — | 每项含 zh/en title/description/whenToUse | **Linghun 独有** |

### 4.19 Debug / Details / Verbose 输出分层

| 维度 | CCB | Linghun | 差距等级 |
|------|-----|---------|---------|
| 默认简洁视图 | ✓ | ✓（状态栏 120 字符截断） | — |
| 详情视图 | ✓（/usage /stats /cache 等） | ✓ | — |
| --verbose CLI flag | 有 | **无** | P2 |
| /debug 命令 | 有 | **无** | P2 |
| 三层输出分离 | 有 | **无** | P2 |

### 4.20 Prompt Cache 影响评估

| 风险 | Linghun 状态 | 等级 |
|------|-------------|------|
| RuntimeStatusForModel 破坏 cache | **不会。** <500 字符，稳定字段 | — |
| CommandCapabilitySummary 破坏 cache | **不会。** 稳定排序，可截断 <1200 字符 | — |
| 完整 memory 注入 prompt | **不会。** summary-first，autoAccept 硬编码 false | — |
| MCP tool list 变化 | **已稳定化。** description 去 timestamp/UUID，key 稳定排序 | — |
| Extension freshness 变化 | **已验证。** 稳定排序摘要，非全文 | **P1-3 已修复** |
| Provider 硬编码影响 cache stats | **已修复。** 不再伪造 deepseek | **NEW-P1 已修复** |

---

## 5. P0 / P1 / P2 问题清单

### 5.1 P0 — Beta 阻塞项

**本轮无新增 P0 项。** 前两轮审计的 P0-1（doctor_query）和 P0-2（catalog/dispatch 漂移检测）均已修复或按交付约定执行。

### 5.2 P1 — 已确认重要缺口，不阻塞 Phase 15 Beta，必须进入 Phase 15.5 收口

| # | 标题 | 来源 | 当前状态 | 建议 |
|---|------|------|---------|------|
| **P1-A** | Permission 交互缺乏 accept/reject + feedback 粒度 | 本轮新发现 | 当前为文本行交互 | Phase 15.5 补齐交互工程化；Beta 中文本行交互可工作 |
| **P1-B** | handleSlashCommand 35 路 else-if 链持续增长风险 | v1 遗留 | drift detection 存在但数据源未统一 | Phase 15.5 做 registry map 化 |
| **P1-C** | CCB 的 "accept with feedback" / "reject with reason" 交互模式缺失 | 本轮新发现 | Linghun 无对应交互 | Phase 15.5 评估是否引入 |

**说明**：P1-A 和 P1-C 是交互工程化问题，不阻塞 Beta 的核心编码验证目标；P1-B 是代码质量风险但不影响功能正确性。

### 5.3 P2 — Beta 后修补

| # | 标题 | 建议阶段 |
|---|------|---------|
| P2-1 | 无 --verbose CLI flag 和 /debug 命令 | Phase 15.5 |
| P2-2 | 状态栏不显示 context 使用率 | Phase 15.5 |
| P2-3 | 状态栏不显示 rate limit 信息 | Phase 15.5 |
| P2-4 | 部分 handler 输出未 i18n | Phase 15.5 |
| P2-5 | isStatusLike 模式滞后于 detectInquiry | Phase 15.5 |
| P2-6 | Bash 执行细节（退出码/超时/流式输出）增强 | Phase 15.5 |
| P2-7 | Plan approval 三态完整交互 | Phase 15.5 |
| P2-8 | 错误处理缺乏 provider 连接失败专项分类 | Phase 15.5 |
| P2-9 | rawUsage 内部字段进入 /usage 视图 | Phase 15.5 |
| P2-10 | CCB 的 context 使用率和 rate limit 倒计时 | Phase 15.5 |
| P2-11 | CCB 的 Tab to amend 权限交互模式 | Phase 16+ |

**P2-10 补充边界：**
- 可以参考 CCB 的状态栏信息密度。
- Linghun 不照搬 CCB 的 cost 状态栏。
- context 使用率和 rate limit 只能在来源可靠时显示。
- 来源必须标记 `reported` / `estimated` / `unknown` / `missing`。
- 金额仍然不进入状态栏，只进入 `/usage` 或 `/stats`。

---

## 6. 是否阻塞 Phase 15 Beta

### 6.1 判断

**不阻塞。** Phase 15 真实项目 Beta 的核心验证目标是：
1. 在真实老项目中完成代码理解、bug 定位、最小修改、验证、成本观测和会话恢复闭环
2. 验证缓存命中率目标区间（92%-96%）
3. 验证 Natural Command Bridge 在真实项目中的安全性和可用性
4. 验证多 provider 切换和角色路由

以上验证目标不依赖 P1 交互工程化项或 P2 体验增强项。当前 Linghun 的编码工具闭环（Read/Write/Edit/Grep/Glob/Bash/Verify/Diff）、权限管道、缓存诊断、会话管理和自然语言安全入口均已完成并可工作。

### 6.2 Beta 中需持续观察的风险

1. **NCB 保守性**：Router 保守评分可能导致真实对话中过多 ask_clarify，影响体验手感
2. **交互手感**：文本行交互在长任务场景中可能不如 CCB 的 PermissionPrompt 流畅
3. **else-if 链膨胀**：如果 Beta 中频繁新增 command，35 路 else-if 链会继续恶化
4. **Provider 兼容性**：不同 provider 的 usage/cache 字段差异可能影响统计准确性

---

## 7. 是否需要 Natural Command Bridge 架构收口

### 7.1 判断

**需要，但不是 Beta 前。** NCB 当前架构正确，但在 Phase 15.5 需要做 3 项收口：

1. **registry map 化**：将 handleSlashCommand 的 else-if 链改为 registry-based lookup（`Map<slash, handler>`），从 `SLASH_COMMAND_REGISTRY` 派生，消除三处独立硬编码
2. **scoring 算法泛化**：当前 scoreCapability 中有针对特定 capability 的 boost 逻辑（如 model +4, mode +5, grep +5），这会在新增 capability 时产生维护负担。应该让 scoring 更泛化（从 catalog fields 中自动计算而非手工 boost）
3. **detectInquiry 模式统一**：detectInquiry 和 isStatusLike 的模式应保持同步，避免两套 regex 漂移

### 7.2 当前不需要做的

- ❌ NLP/ML 语义理解升级（过度工程化）
- ❌ 模型辅助意图理解（违背"本地裁决优先"原则）
- ❌ 完整 registry/dispatch 大重构（Beta 前不宜大动）

---

## 8. 推荐方案（只选一个）

### 方案：Phase 15 Beta 先行 + Phase 15.5 交互工程化硬化

**Phase 15 Beta（当前 → 用户确认后开始）：**
- 用真实老项目验证完整开发闭环
- 重点验证：编码能力、缓存命中率、NCB 安全性、多 provider、会话恢复
- 观察并记录所有交互手感问题（不修，只记录）
- 输出 Phase 15 交付文档

**Phase 15.5 双模型交叉审查、终端 TUI 成品级收口与开源前 hardening（Beta 后）：**
- 双模型交叉审查（GPT-5.5/Claude 产品架构审查 + DeepSeek V4 Pro 代码安全审查）
- 终端 TUI 成品级收口：首屏、状态栏、help 分组、Start Gate、权限/提权、Plan/auto/bypass 说明、错误 doctor、长任务轻提示、primary/details/debug 输出层级、自然语言状态查询、中英文一致性、窄终端渲染
- 修复 Beta 中发现的 P0/P1 问题
- 补齐交互工程化（permission feedback、plan approval 三态）
- Registry map 化重构
- Verbose/debug 输出分层
- Release readiness / open-source readiness

**此方案的理由：**
- 当前不阻塞 Beta，Beta 本身是验证手段不是目的
- 交互工程化需要真实使用反馈驱动，不宜纯理论设计
- Registry map 化重构需要 Beta 确认所有 command 路径正常后再做

---

## 9. 最小实现边界

### 9.1 Phase 15 Beta 最小实现边界

**已就绪（不新增）：**
- Natural Command Bridge（1487 行，完整）
- 权限管道（decision order 正确）
- 缓存诊断（11 维度 freshness + break-cache）
- 工具系统（9 个内置工具）
- 会话系统（JSONL + handoff）
- 状态栏（7 字段）
- i18n 消息表（15 keys）

**Beta 中无需新增代码。** 只需用户确认后开始在真实项目中验证。

### 9.2 Phase 15.5 最小修补边界

| 修补项 | 最小范围 | 预计行数变化 |
|--------|---------|-------------|
| Registry map 化 | 将 35 路 else-if 改为 `Map<slash, handler>` | ~50 行新增，~180 行删除 |
| Permission feedback | 在文本行交互中增加 "accept with note" / "reject with reason" 选项 | ~100 行 |
| Verbose/debug 分层 | 新增 `--verbose` flag + `/debug` 命令 | ~80 行 |
| detectInquiry 同步 | isStatusLike 模式与 detectInquiry 同步 | ~10 行 |
| Provider error classifier | 顶层 catch 增加 provider 错误分类 | ~60 行 |

总计：~300 行新增，~180 行删除，净增 ~120 行。

---

## 10. 必须补的 Focused Tests

### 10.1 Beta 前建议补（不阻塞）

| 测试目标 | 原因 | 优先级 |
|---------|------|--------|
| NCB scoring 泛化性 | 确保新增 capability 时 scoring 不退化 | P1 |
| Permission decision order 回归 | 确保 plan→userRules 顺序不被意外恢复 | P1 |
| 多 provider 缓存统计一致性 | 确保 provider 切换后 cache stats 正确 | P1 |
| handleSlashCommand 覆盖完整性 | 确保无 slash command 未被 dispatch 处理 | P1 |
| Natural input → model fallback | 确保非命令输入正确进入模型 | P2 |

### 10.2 Phase 15.5 建议补

| 测试目标 | 原因 |
|---------|------|
| Registry map dispatch 等价性 | Registry 化后 dispatch 行为不变 |
| Permission feedback 交互路径 | accept with note / reject with reason |
| Verbose/debug 输出格式 | 三层输出正确分层 |
| Provider error 中英文提示 | 分类错误给出可操作建议 |
| All slash commands smoke | 每个 slash command 在 TUI 中可执行 |

---

## 11. 不建议做的内容

| 不建议做 | 原因 |
|---------|------|
| NLP/ML 语义理解升级 NCB | 当前 token+alias+boost 算法对 Beta 足够；引入 ML 增加复杂度且难以审计 |
| 模型辅助意图理解 | 违背"本地裁决优先"的 NCB 设计原则 |
| 完整 registry/dispatch 大重构（Beta 前） | Beta 前不宜大动核心 dispatch 路径 |
| CCB 的 PermissionPrompt 完整复刻 | 属于 clean rewrite 原则禁止的"复制 UI 实现" |
| CCB 的 feature flag 系统 | Linghun 已有 LINGHUN_FEATURE_* 更简单直接 |
| CCB 的 analytics 埋点 | Linghun 不做任何遥测 |
| 状态栏增加 cost 显示 | 设计已明确 cost 仅在 /usage /stats 显示 |
| CCB 的 bridge/daemon/remote control | Phase 17 才评估 |
| 自研代码图索引替代 codebase-memory-mcp | 不造稳定轮子 |
| 完整插件市场 / GitHub 安装 | 不在当前阶段范围 |

---

## 12. Phase 15 / 15.5 / 16+ 分流建议

### Phase 15 真实项目 Beta（下一步）
- **目标**：在真实老项目中验证编码闭环
- **产出**：Phase 15 交付文档 + Bug 修复记录 + 缓存命中率数据 + 交互手感问题清单
- **不新增功能**

### Phase 15.5 双模型交叉审查、终端 TUI 成品级收口与开源前 hardening（Beta 后）
- **产品架构审查**（GPT-5.5/Claude）：审查 NCB 架构、权限管道、缓存策略、阶段边界
- **代码安全审查**（DeepSeek V4 Pro）：审查密钥处理、权限逃逸、MCP 安全、provider 适配
- **终端 TUI 成品级收口**：首屏、状态栏、help 分组、Start Gate、权限/提权、Plan/auto/bypass 说明、错误 doctor、长任务轻提示、primary/details/debug 输出层级、自然语言状态查询、中英文一致性、窄终端渲染
- **修复项**：P0/P1 + registry map 化 + 交互工程化 + verbose/debug 分层 + i18n 完善
- **Release readiness**：安装路径、CLI 入口、doctor、keychain、debug bundle、配置 schema、升级回滚

### Phase 16+ 可控学习闭环
- "越用越聪明"但可审计、可撤销、可关闭
- 不每轮学习，不后台写长期记忆
- 候选优先来自 evidence/Todo/验证/handoff

### Phase 17+ 长期托管与 Remote Channels
- 定时任务、自动会话、Team/job 状态表
- Remote Channels 安全闸门

### Phase 18+ 桌面端
- Tauri 包装，IPC/API 边界验证

---

## 13. Clean Rewrite / 禁止复制风险说明

### 13.1 Clean Rewrite 原则遵守情况

**已验证合规：**
1. NCB 是 Linghun 自研架构——CCB 根本没有对应组件
2. Command Capability Catalog 是 Linghun 自研——CCB 使用静态 import 数组
3. Start Gate 是 Linghun 自研——CCB 使用 PermissionPrompt 直接交互
4. RuntimeStatusForModel 是 Linghun 自研——CCB 使用 system prompt 描述
5. 权限决策顺序是 Linghun 自研——CCB 实现细节闭源
6. Cache freshness 11 维度是 Linghun 自研——基于 CCB Dev Boost 公开行为边界自研

**未发现复制：**
- 未复制 CCB 的 React/Ink 组件源码
- 未复制 CCB 的 Tool.ts 接口定义
- 未复制 CCB 的 PermissionPrompt 交互逻辑
- 未复制 CCB 的 BuiltinStatusLine 渲染逻辑
- 未复制 CCB 的 CompactSummary 压缩逻辑

### 13.2 "为了像 CCB 而复制/复刻"风险评估

**当前风险：低。** Linghun 的设计选择（本地 NCB、Start Gate、exact confirmation、summary-first）都是基于安全性和工程行为约束的主动设计，不是"因为 CCB 有所以我也要有"。事实上，Linghun 在以下方面与 CCB 做出了不同选择：
- NCB（CCB 没有）
- Start Gate（CCB 用 PermissionPrompt）
- 状态栏不显示 cost（CCB 显示）
- bypass 需要显式环境变量 opt-in（CCB 直接切换）
- handoff packet（CCB 没有正式 handoff）

### 13.3 持续风险

最需要警惕的不是"复制 CCB 代码"，而是：
1. **交互模式无意识趋同**：为改善手感，在 NCB 的 Start Gate 和 Permission 交互中不自觉地靠近 CCB 的 PermissionPrompt 模式
2. **else-if 链持续膨胀**：随着 command 数量增加，index.ts 可能突破 7000+ 行
3. **scoring 算法补丁化**：为提升特定场景准确率，在 scoreCapability 中持续追加 boost 逻辑

**防护措施**：
- Phase 15.5 的 registry map 化从根本上解决 2
- 交互工程化参考 CCB 公开行为边界但不复制实现
- scoring 泛化算法在 Phase 15.5 评估

---

## 14. 审计边界声明

本次审计：
- **只读审查**，未修改任何代码
- 未进入 Phase 15 真实项目 Beta、Phase 15.5 或 Phase 16+
- CCB / Claude Code 仅参考公开行为、交互边界、UX 模式和验收思路
- 未复制任何 CCB、OpenCode、Hermes 或其他第三方项目的源码实现、内部 API、反编译产物或专有实现
- 审查基于直接阅读 Linghun 仓库全部 10 份必读文档、8 份实现源码（11836 行）、CCB 源码关键文件（commands.ts、Tool.ts、BuiltinStatusLine.tsx、CompactSummary.tsx、PermissionPrompt.tsx、progress.md、README.md）、codebase-memory 索引（771 nodes, 1508 edges）、以及前两轮审计报告

### 参考源核对

| 参考源 | 方式 | 提取内容 |
|--------|------|---------|
| Linghun 仓库全部文档（10 份） | 只读 | 阶段蓝图、规格书、架构路线、交付文档、审计报告 |
| Linghun 实现源码（8 份，11836 行） | 只读 | NCB、TUI dispatch、权限管道、缓存 freshness、状态栏、i18n、provider、config、session、tools |
| CCB 源码（7 份关键文件） | 只读 | 命令系统架构、工具接口、权限交互模式、状态栏字段、上下文压缩、项目进度 |
| codebase-memory index | 查询 | 架构概览（771 nodes, 1508 edges） |
| Phase 15 v1/v2 审计报告 | 只读 | 前置问题修复状态、关键行号索引 |

---

## 附录 A：关键行号索引（更新）

| 文件 | 关键区域 | 行号 |
|------|---------|------|
| `natural-command-bridge.ts` | NaturalIntent 类型（6 inquiry types） | 40-50 |
| `natural-command-bridge.ts` | RuntimeStatusForModel | 52-68 |
| `natural-command-bridge.ts` | SLASH_COMMAND_REGISTRY | 112-162 |
| `natural-command-bridge.ts` | COMMAND_CAPABILITY_DATA (44 capabilities) | 168-708 |
| `natural-command-bridge.ts` | validateCommandCapabilityCoverage | 716-740 |
| `natural-command-bridge.ts` | buildRuntimeStatusForModel | 742-772 |
| `natural-command-bridge.ts` | routeNaturalIntent（完整路由逻辑） | 782-934 |
| `natural-command-bridge.ts` | detectInquiry（6 种 inquiry 识别） | 1232-1252 |
| `natural-command-bridge.ts` | detectDangerousNaturalIntent | 1254-1263 |
| `natural-command-bridge.ts` | isDangerousNaturalTarget | 1265-1281 |
| `natural-command-bridge.ts` | isFirstBatchStatusCapability | 1283-1298 |
| `natural-command-bridge.ts` | scoreCapability（含 per-capability boost） | 1306-1357 |
| `natural-command-bridge.ts` | isStatusLike | 1382-1387 |
| `natural-command-bridge.ts` | createNaturalEquivalentCommand | 1389-1429+ |
| `natural-command-bridge.ts` | formatNaturalStartGate（human-first 格式） | 1030-1066 |
| `natural-command-bridge.ts` | formatNaturalPermissionBlock | 976-1003 |
| `natural-command-bridge.ts` | matchesNaturalGateConfirmation | 1072-1083 |
| `natural-command-bridge.ts` | requiresExactNaturalConfirmation | 1085-1095 |
| `natural-command-bridge.ts` | formatHumanRisk | 1097-1128 |
| `index.ts` | handleSlashCommand（35 路 else-if 链） | 1257-1440 |
| `index.ts` | handleModelCommand | 1699-1714 |
| `index.ts` | handleModeCommand + getModeChangeGuard | 2076-2129 |
| `index.ts` | handleNaturalInput（6 种 action 分派） | 5192-5282 |
| `index.ts` | sendMessage（主循环 + system prompt） | 5284-5356 |
| `index.ts` | decidePermission（8 步决策顺序） | 5758-5861 |
| `index.ts` | getHardDenyReason | 5865-5904+ |
| `index.ts` | getCurrentFreshness（11 维度） | 4236-4252 |
| `index.ts` | createExtensionFreshnessSummary（稳定排序） | 4280-4316 |
| `index.ts` | recordModelUsage | 3608-3633 |
| `index.ts` | formatCacheStatus / formatBreakCacheStatus / formatUsage / formatStats | 4392-4496 |
| `index.ts` | writeStatus（状态栏 7 字段） | 6414-6431 |
| `index.ts` | messages（i18n 15 keys） | 6441-6499 |
| `index.ts` | createHandoffPacket | 3280-3309 |
| `natural-command-bridge.test.ts` | Full test file（~99 tests） | 1-410 |
| `index.test.ts` | Full test file（~48 tests） | 1-1589 |

---

## 附录 B：CCB vs Linghun 逐项对照速查表

| 审计面 | CCB 行为 | Linghun 行为 | 谁更优 |
|--------|---------|-------------|--------|
| 自然语言入口 | 直接进模型 | 本地 NCB 裁决 | **Linghun** |
| 命令分发 | 静态 COMMANDS[] + 动态加载 | else-if 链 + catalog + registry | CCB |
| 权限交互 | 18 种 PermissionPrompt（accept/reject/feedback） | 文本行交互 | CCB |
| Plan 只读保护 | ✓ | ✓（plan check 先于 user rules） | 等价 |
| Bypass 安全 | 直接切换 | LINGHUN_ENABLE_BYPASS=1 opt-in | **Linghun** |
| 状态栏 cost | 显示 | 不显示（/usage /stats 显示） | 设计选择 |
| 状态栏 context | 显示使用率% | 不显示 | CCB |
| 状态栏 rate limit | 显示 5h/7d + 倒计时 | 不显示 | CCB |
| 规则加载 | CLAUDE.md 静默 | LINGHUN.md + 缺规则提示 | **Linghun** |
| 规则模板 | 无 | /memory init 中文模板 | **Linghun** |
| Handoff | 无正式 handoff | structured handoff packet | **Linghun** |
| Cache 诊断 | CCB Dev Boost | 11 维度 freshness + break-cache | **Linghun** |
| MCP 稳定化 | CCB Dev Boost | stabilizeMcpToolList | 等价 |
| 大文件保护 | ✓ | ✓ | 等价 |
| 中文体验 | CCB Dev Boost 部分 | 原生双语 + catalog 双语 | **Linghun** |
| Debug 分层 | --verbose + /debug | 无 | CCB |
| Start Gate | 无（模型自行判断） | 本地裁决 + 90s 过期 + exact confirmation | **Linghun** |

---

*审计完成于 2026-05-17。本报告是进入 Phase 15 真实项目 Beta 前的最终全面对照审计，取代并整合了前两轮 v1/v2 审计报告。*
