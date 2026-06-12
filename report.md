# Linghun 项目审计报告

**审计时间**: 2024年（基于最近提交）  
**审计范围**: 安全、架构、测试覆盖、代码质量、最近变更  
**审计方式**: 多智能体并行审计 + 反幻觉系统触发问题定位

---

## 核心发现

### 1. 反幻觉系统拦截：Agent 完成状态证据缺失

**问题**: `recordAgentExecutionEvidence()` 在 agent 完成时未包含 `agent_terminal_status` claim，导致反幻觉系统拦截了"审计已完成"的声明。

**位置**: 
- `packages/tui/src/slash-command-runtime.ts:2493` - `recordAgentExecutionEvidence()`
- `packages/tui/src/job-agent-command-runtime.ts:2283` - 调用点
- `packages/tui/src/job-agent-command-runtime.ts:2839` - evidence 创建

**根本原因**: 
- agent completed 时 `supportsClaims` 只包含 `agent_execution`, `agent_{role}`, `action_executed`
- 缺少 `agent_terminal_status` 导致反幻觉系统无法验证"agent 已完成"的声明

**影响**: 
- 用户询问"审计完了吗"时，系统无法给出肯定答案
- 触发"当前证据不足"拦截消息
- 降低用户体验和系统可信度

**修复方案** (最小):
```typescript
// packages/tui/src/slash-command-runtime.ts recordAgentExecutionEvidence()
// 在 completed 路径添加：
supportsClaims: [
  "agent_execution",
  `agent_${agent.type}`,
  "action_executed",
  "agent_terminal_status",  // 新增
]
```

---

### 2. Agent 终态语义混乱：Completed → Idle 持久化

**问题**: agent 完成后被持久化为 `status: "idle"`，导致终态信息丢失。

**位置**:
- `packages/tui/src/job-agent-command-runtime.ts:343` - `agent.status = "idle"`
- `packages/tui/src/job-agent-command-runtime.ts:138-139` - `AGENT_IDLE_STATUSES` 和 `AGENT_ASSIGNABLE_STATUSES` 混合 `idle` 和 `completed`

**根本原因**:
- `idle` 和 `completed` 在多处逻辑中被视为等价（可再分配）
- 持久化时只保存 `status: "idle"`，上一次运行的终态（completed/failed/blocked）丢失
- UI 显示 `idle` 但无法区分"从未运行"和"已完成后空闲"

**影响**:
- `/agents` 命令无法显示上次运行的真实结果
- 用户看到 4 个 `idle` agent，不知道它们是否已完成审计
- 模型无法基于 agent 历史状态做出决策

**修复方案** (最小):
```typescript
// packages/tui/src/tui-data-types.ts AgentRun 类型
type AgentRun = {
  // ...
  status: "idle" | "running" | "completed" | "failed" | "blocked";
  lastTerminalStatus?: "completed" | "failed" | "blocked";  // 新增
  lastTerminalSummary?: string;  // 新增
  // ...
}

// packages/tui/src/job-agent-command-runtime.ts
// 完成时保存终态：
agent.lastTerminalStatus = "completed";
agent.lastTerminalSummary = agent.summary;
agent.status = "idle";  // 保持可再分配
```

---

### 3. Agent 报告截断：truncateDisplay(500) 丢失完整审计内容

**问题**: agent 完成后的 `recentResult` 被 `truncateDisplay(finalText, 500)` 截断到 500 字符，完整审计报告无法访问。

**位置**:
- `packages/tui/src/job-agent-command-runtime.ts:2839` - `truncateDisplay(finalText, 500)`
- `packages/tui/src/tui-agent-job-runtime.ts` - agent 数据结构未保存 `transcriptPath`

**根本原因**:
- agent 的 final assistant message 在 transcript 中完整保存
- 但 `recentResult` summary 只保留 500 字符用于列表展示
- 缺少从 `transcriptSessionId` 追溯完整报告的机制

**影响**:
- 审计报告被截断，用户只能看到开头
- 4 个 agent 的完整审计内容无法汇总
- `/background` 或 `/agents` 命令无法提供详情链接

**修复方案** (最小):
```typescript
// packages/tui/src/tui-data-types.ts AgentRun
type AgentRun = {
  // ...
  transcriptPath?: string;  // 新增：完整 transcript 路径
  transcriptSessionId?: string;  // 新增：session ID
  // ...
}

// packages/tui/src/job-agent-command-runtime.ts
// 完成时保存 transcript 引用：
agent.transcriptPath = transcriptPath;
agent.transcriptSessionId = sessionId;

// packages/tui/src/tui-details-runtime.ts formatAgentDetails()
// 添加"查看完整报告"链接：
if (agent.transcriptPath) {
  details.push(`Full report: cat ${agent.transcriptPath}`);
}
```

---

### 4. Provider Reasoning-Only 卡住：thinking 无 text 的终态处理

**问题**: 当 provider 只返回 `thinking` 没有 `text` 时（reasoning-only），final-answer gate retry 卡住无响应。

**位置**:
- `packages/tui/src/model-stream-runtime.ts:2489-2499` - `provider_reasoning_only` evidence 记录
- final-answer gate retry 逻辑（未定位到具体文件）

**根本原因**:
- anthropic_messages provider 在 High thinking budget 下可能只返回 thinking
- 系统记录 `provider_reasoning_only` evidence，但未给用户可见反馈
- retry 逻辑未降级或禁用 thinking，导致反复空响应

**影响**:
- 用户体验：系统"卡住"，无明确错误提示
- 当前会话本次审计任务中可能触发（based on evidence `provider_reasoning_only` 存在）

**修复方案** (最小):
```typescript
// packages/tui/src/model-stream-runtime.ts
// 在 provider_reasoning_only 路径添加用户可见消息：
if (hadThinking && !hadText) {
  await appendSystemEvent(
    context,
    sessionId,
    `provider_reasoning_only: ${metadata}. Retrying with thinking disabled.`,
    "info"
  );
  writeLine(output, "Provider returned thinking only. Retrying without extended thinking...");
  
  // 在 retry 时禁用 thinking：
  const retryMessages = messages.map(m => {
    if (m.thinking_budget_tokens) {
      return { ...m, thinking_budget_tokens: undefined };
    }
    return m;
  });
}
```

---

### 5. Anthropic Thinking 配置诊断混乱

**问题**: `/model doctor` 无法显示实际发送给 provider 的 thinking 配置字段。

**位置**:
- `packages/tui/src/tui-model-runtime.ts:198` - 注释提到 `reasoning.effort` vs `thinking.budget_tokens`
- anthropic_messages provider 实现（未定位到具体文件）

**根本原因**:
- Anthropic Messages API 使用 `thinking: { type: "enabled", budget_tokens: 8192 }`
- OpenAI Responses API 使用 `reasoning: { effort: "high" }`
- 诊断工具未区分这两种配置格式
- `settings.json` 中的 `endpointProfile=responses` 与 `provider.env` 中的 `anthropic_messages` 配置冲突时，用户无法判断实际生效的配置

**影响**:
- 用户设置 High thinking 但不知道实际发送的是什么
- 诊断时无法定位 reasoning-only 问题的根源
- 配置源冲突时缺少明确提示

**修复方案** (最小):
```typescript
// packages/tui/src/model-doctor-runtime.ts
// 在 /model doctor 输出中添加：
export function formatProviderRequestConfig(route: RoleModelRoute, profile: EndpointProfile) {
  const lines = [];
  
  if (profile === "anthropic_messages") {
    lines.push("Actual request field: thinking: { type: 'enabled', budget_tokens: 8192 }");
  } else if (profile === "responses") {
    lines.push("Actual request field: reasoning: { effort: 'high' }");
  }
  
  // 检测冲突
  if (settingsProfile !== providerEnvProfile) {
    lines.push(`⚠️  Config conflict: settings.json=${settingsProfile}, provider.env=${providerEnvProfile}`);
    lines.push(`   Effective: ${effectiveProfile}`);
  }
  
  return lines.join("\n");
}
```

---

## 原始审计报告（4个智能体完成结果）

### 🔴 安全审计 (agent-24294834)

#### 高风险
**H1. Shell 命令注入风险**
- 位置：`packages/tools/src/index.ts:1847`
- 代码：`spawn(command, { cwd, shell: true, windowsHide: true })`
- 风险：直接使用 `shell: true` 执行用户提供的命令
- 已有缓解：
  - ✅ `adaptShellCommand` 函数（line 886, 932）对命令进行预处理
  - ✅ `sanitizeSecrets` 函数（line 871）过滤敏感信息
  - ✅ 跨平台检测和适配（`adaptShellCommandForPlatform`）
- 状态：**已缓解，但需要审查边界情况**

**H2. 敏感信息泄露风险**
- 风险：API密钥、tokens 可能通过日志/错误消息泄露
- 建议：审查所有日志输出点，确保 secrets 过滤覆盖所有路径

#### 中风险
- 依赖版本部分使用 `^` 未完全固定
- 环境变量处理需要更严格的验证

---

### 🔴 代码质量审计 (agent-cdabc428)

#### God Files（严重）

| 文件 | 行数 | 风险等级 | 核心问题 |
|------|------|---------|----------|
| `packages/providers/src/index.ts` | **3044** | 🔴 严重 | Provider运行时、流解析、错误处理、重试逻辑全部堆叠 |
| `packages/tui/src/index.ts` | **3203** | 🔴 严重 | TUI主控制器，混合UI/状态/IO/事件/权限/会话管理 |
| `packages/tui/src/shell/view-model.ts` | **2053** | 🔴 严重 | ViewModel 所有逻辑堆叠 |

#### 建议
拆分职责边界：UI/状态/IO/provider/runner/permission 分离到独立模块。
**警告**：当前任务不是大重构授权。

---

### 📊 测试覆盖审计 (agent-2e3179de)

#### 统计
- 共 **100 个测试文件**（全部 .test.ts）
- 主要分布：
  - `packages/tui`: 93个
  - `packages/providers`: 3个
  - `packages/core`: 4个
  - `packages/tools`: 1个

#### 缺口
- provider 重试逻辑测试不足
- meta-scheduler 测试缺失
- 权限系统核心路径测试不完整
- **当前发现的 5 个问题均缺少对应测试**

---

### 🏗️ 架构审计 (agent-ca324303)

#### 最近变更（5个 unstaged 文件）
- `bing-scraper.ts` - WebSearch 工具
- `job-agent-command-runtime.ts` - Agent 运行时
- `model-stream-runtime.ts` - 模型流
- `provider-circuit-breaker.*` - 熔断器（含测试）

#### 架构问题
- 循环依赖风险（未详细定位）
- 文档与实现不一致
- 技术债务累积（god files 是最大债务）

---

## 最小必要测试清单

基于发现的 5 个问题，需补充以下测试：

1. **Agent completed evidence 包含 agent_terminal_status**
   - 文件：`packages/tui/src/slash-command-runtime.test.ts`
   - 测试：agent completed 后 evidence.supportsClaims 包含 `agent_terminal_status`

2. **Agent completed 后不会只剩 idle 导致终态丢失**
   - 文件：`packages/tui/src/job-agent-command-runtime.test.ts`
   - 测试：agent 完成后 `lastTerminalStatus` 保存，reload 后可恢复

3. **Anthropic Messages High 显示为 thinking.budget_tokens=8192**
   - 文件：`packages/tui/src/model-doctor-runtime.test.ts`
   - 测试：anthropic_messages + High → 诊断输出包含 `thinking.budget_tokens=8192`

4. **Reasoning-only 不再表现为无响应卡住**
   - 文件：`packages/tui/src/model-stream-runtime.test.ts`
   - 测试：provider 返回 thinking-only → 系统给出明确降级消息并 retry

5. **Agent transcript 路径可追溯**
   - 文件：`packages/tui/src/tui-agent-job-runtime.test.ts`
   - 测试：agent 完成后 `transcriptPath` 可读取完整报告

---

## 修复优先级

| 问题 | 优先级 | 原因 | 修复成本 |
|------|--------|------|---------|
| 1. Agent evidence 缺失 | **P0** | 破坏反幻觉系统信任链 | 极低（1行代码） |
| 2. Agent 终态丢失 | **P0** | 用户无法判断 agent 是否完成 | 低（类型 + 2处保存） |
| 3. Agent 报告截断 | **P1** | 审计内容无法访问 | 低（类型 + 保存 transcript 引用） |
| 4. Reasoning-only 卡住 | **P1** | 影响当前会话体验 | 中（retry 逻辑 + 降级） |
| 5. Thinking 诊断混乱 | **P2** | 可用 workaround（manual check） | 中（诊断格式化） |

---

## 剩余风险

修复后仍存在的风险：

1. **God files 未拆分**：3000+ 行文件导致维护困难，但拆分需要大重构（不在本轮范围）
2. **测试覆盖不足**：核心路径（meta-scheduler、权限系统）缺少测试，回归风险高
3. **Shell 命令注入**：已有缓解措施，但边界情况未完全验证
4. **依赖版本**：部分使用 `^` 可能导致不可预期的更新

---

## 下一步

1. **立即修复** P0 问题（agent evidence + 终态）
2. **验证修复**：运行对应测试，确保反幻觉系统不再拦截
3. **补充测试**：为 5 个问题编写最小验证测试
4. **P1 问题排期**：报告截断和 reasoning-only 在下一个迭代修复
5. **长期规划**：god files 拆分、测试覆盖提升纳入技术债务清单

---

**报告生成时间**: 基于当前会话上下文  
**审计智能体**: agent-24294834 (security), agent-cdabc428 (code-quality), agent-2e3179de (testing), agent-ca324303 (architecture)  
**触发原因**: 用户询问"审计完了吗"时反幻觉系统拦截，暴露 agent 完成状态 evidence 缺失问题
