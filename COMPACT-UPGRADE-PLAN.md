# 上下文命中率升级方案 v2

对标 CCB 的完整上下文架构，解决 Linghun 命中率下降和 compact 后记忆混乱。

问题不只是 compact prompt 质量——是整个"稳定块/动态块"划分 + 压缩后恢复 + 缓存连续性的系统性缺失。

---

## CCB 的核心架构（我们缺什么）

CCB 把上下文分为三层：

```
┌─────────────────────────────────────────────────────┐
│ 稳定前缀（Global Cache）                             │
│   system prompt 核心指令 + tools schema              │
│   ← 跨 session 缓存，不变                            │
├── __SYSTEM_PROMPT_DYNAMIC_BOUNDARY__ ───────────────┤
│ 动态后缀（无缓存 / org 级缓存）                       │
│   conditional rules / userContext / date / git       │
│   ← 每轮变化，不缓存                                 │
├─────────────────────────────────────────────────────┤
│ 消息序列（prompt cache per session）                  │
│   [compact summary] + [restored files] + [recent]   │
│   ← session 级缓存前缀 + 每轮追加的动态尾部           │
└─────────────────────────────────────────────────────┘
```

**Linghun 缺失的关键机制：**

1. **System Prompt 没有稳定/动态边界标记** → 每轮 system prompt 变化都破坏整个缓存前缀
2. **没有 Session Memory 后台提取** → compact 时才全量扫描，中间过程的信息已经丢失
3. **没有年龄触发的 Tool Result 渐进清理** → context 膨胀直到触发 deep compact
4. **Compact 后没有恢复文件/skill/plan/tools** → 模型 compact 后失去所有工作上下文
5. **Compact summary 是平面文本** → 多次 compact 后关键信息被逐步稀释

---

## 阶段零：System Prompt 稳定/动态边界

**目标**：让 system prompt 的稳定部分能被 API 缓存，动态部分的变化不破坏缓存。

### 实现内容

1. 在 system prompt 构建中引入 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 概念：
   - 边界之前：核心指令、工具 schema、角色定义（不变）
   - 边界之后：日期、git 状态、conditional rules、用户偏好（每轮可能变）

2. provider 请求构建时，把 system prompt 按边界分为两个 `cache_control` 块：
   - 稳定块标记 `cache_control: { type: "ephemeral" }`（或等价）
   - 动态块不标记缓存

3. 消息序列中的前 N 条（compact summary + restored context）也标记为可缓存

### 涉及文件

- `packages/tui/src/system-prompt-builder.ts`（或等价文件）— 插入边界标记
- `packages/providers/src/` — provider request 构建时识别边界，分拆 cache blocks

### 验收标准

- 连续 5 轮对话中，API 返回的 `cache_read_input_tokens` 稳定增长（而非每轮 0）
- 只改变动态内容（如 git status）时，稳定前缀仍命中缓存
- compact 后第一轮有 cache miss，第二轮开始恢复 cache hit

---

## 阶段一：渐进式 Tool Result 清理

**目标**：在 deep compact 触发前，用零 LLM 成本的方式清理旧 tool results，降低 compact 频率 2-3 倍。

### 实现内容

在 `compact-preflight-runtime.ts` 的 `prepareMessagesForProviderPreflight` 中，tool-result-budget 执行**之后**加一层 age/pressure 清理：

1. **触发条件**：`estimateModelMessageChars(messages)` > context window 的 60%
2. **清理策略**：从最旧的 tool result message 开始，content 替换为 `"[cleared; artifact at <path>]"`
3. **保留规则**：最近 6 轮（12 条 assistant+tool 配对）的 tool results 不动
4. **复用基础设施**：使用已有的 `tool-result-budget.ts` 的 artifact 写盘 + state 追踪
5. **不破坏消息结构**：assistant 的 tool_use + tool 的 tool_result 配对保留，只清 content

### 与"稳定块/动态块"的关系

清理后的消息序列中：
- **稳定部分**（已清理的旧 tool results）= 不再变化，可以作为缓存前缀的一部分
- **动态部分**（最近 6 轮）= 每轮追加，是缓存的动态尾部

### 涉及文件

- `packages/tui/src/tool-result-budget.ts` — 新增 `applyAgePressureClearance()` 导出
- `packages/tui/src/compact-preflight-runtime.ts` — 在 budget 后调用

### 验收标准

- 单测：模拟 20+ tool results，触发后最旧的被替换，最近 6 轮保留
- 单测：未达阈值时不触发
- 单测：已有 `<persisted-tool-result>` 标记的不重复处理
- 集成验证：15 轮以上对话，context chars 增长曲线明显变缓
- 集成验证：触发后 deep compact 不再在 10 轮内被触发（之前可能 8 轮就触发）

---

## 阶段二：Session Memory 后台增量提取

**目标**：像 CCB 一样，在对话过程中持续提取 running summary，compact 时使用增量而非全量。

### 设计（路径 C：规则增量 + compact 时 LLM 整合）

**2a. Post-sampling 增量提取（确定性规则，零 token）**

每次 provider 响应结束后，用规则从新增 transcript events 中提取：

```typescript
type SessionMemoryBuffer = {
  userMessages: string[]        // 用户消息原文（最近 20 条）
  assistantDecisions: string[]  // 含决策关键词的句子（最近 15 条）
  toolCalls: string[]           // "name: result_status" 精简记录（最近 30 条）
  changedFiles: string[]        // 文件路径（最近 10 个）
  errors: string[]              // 错误信息（最近 10 条）
  currentTask: string           // 最近一次用户请求的原文
}
```

- 总量限制 8K chars，按类别 FIFO 淘汰
- 存在 `context.cache.sessionMemoryBuffer` 中
- 当用户新消息进来时，更新 `currentTask`

**2b. Compact 时使用 buffer**

`buildDeepCompactRequestMessages` 改为：
- 使用 sessionMemoryBuffer 作为已提取的上下文基线
- 只补充"上次提取以来的新增 events"（而非全量 transcript）
- 如果 buffer 为空（首次 compact），fallback 到全量 outline

**2c. Buffer 持久化**

- compact 成功后，buffer 重置为 compact summary 的结构化版本
- 确保下一轮 compact 时有上一轮的 summary 作为基线

### 涉及文件

- 新建 `packages/tui/src/session-memory-incremental.ts`
- `packages/tui/src/deep-compact-runtime.ts` — 使用 buffer 替代全量 outline
- `packages/tui/src/tui-data-types.ts` — 新增 `SessionMemoryBuffer` 类型
- provider 响应后的 hook 点（在 transcript event 写入处）

### 验收标准

- 单测：30 个 transcript events 后 buffer 正确累积各类别
- 单测：buffer 超 8K chars 时 FIFO 淘汰
- 单测：compact 时只看 buffer + 增量，非全量
- 集成验证：连续 3 次 compact 后，第一次对话中的用户原始消息仍可在 summary 中找到

---

## 阶段三：重写 Deep Compact Prompt + 结构化输出

**目标**：单次 compact 后信息保留量提升 40-60%，多次 compact 后不累积漂移。

### 实现内容

**3a. 结构化 Compact Prompt**

重写 `buildDeepCompactRequestMessages` 的 system prompt：

```
你的任务是为编码助手创建一个详细的结构化摘要。
按以下 9 个部分输出：

1. 用户核心请求和意图（原文引用）
2. 关键技术概念
3. 文件和代码片段（包含实际代码）
4. 错误和修复（含用户反馈）
5. 问题解决过程
6. 所有用户消息（非 tool result 的原文列表）
7. 待办任务
8. 当前工作（精确描述正在做什么）
9. 下一步（必须与最近用户请求直接相关）

先在 <analysis> 中组织思路，再在 <summary> 中输出最终结果。
```

**3b. 双阶段输出 + 后处理**

- 模型输出 `<analysis>...</analysis><summary>...</summary>`
- `formatDeepCompactSummary()` strip analysis，只保留 summary
- 降低 compact 输出 token 的浪费（analysis 是草稿纸不入 packet）

**3c. Packet 结构分离**

`DeepCompactPacket` 新增：
```typescript
userMessagesVerbatim: string[]    // 从 summary 中提取或从 buffer 透传
codeSnippets: { file: string; content: string }[]
narrativeSummary: string          // 纯叙事（当前的 summary 字段）
```

下次 compact 时，`userMessagesVerbatim` 和 `codeSnippets` 直接透传不再重新总结。

### 涉及文件

- `packages/tui/src/deep-compact-runtime.ts` — prompt + outline + 后处理 + packet 扩展
- `packages/tui/src/tui-data-types.ts` — 扩展 DeepCompactPacket 类型

### 验收标准

- 单测：mock gateway 返回带 `<analysis>` + `<summary>` 的响应，packet.summary 只含 summary
- 单测：userMessagesVerbatim 从 buffer 透传时不经过 LLM
- 单测：isDeepCompactPacket 兼容新旧 packet 格式
- 对比测试：同段对话用旧 prompt vs 新 prompt compact，信息密度对比
- 集成验证：5 次连续 compact 后第一轮用户消息仍在 packet 中

---

## 阶段四：Post-Compact 上下文恢复

**目标**：compact 后自动恢复"动态块"——文件内容、plan、skill、tools schema——让模型不丢工作上下文。

### 实现内容

compact 成功后，构建恢复上下文注入到消息序列中（在 compact summary message 之后）：

1. **文件恢复**（对标 CCB 的 `createPostCompactFileAttachments`）：
   - 从 `context.recentlyMentionedFiles` + `context.tools.changedFiles` 取最近 5 个
   - 每个文件读取内容，上限 5K chars/文件，总预算 30K chars
   - 作为一条 user message 注入

2. **Plan 恢复**：
   - 如果当前有 plan/task 状态，注入 plan 当前内容

3. **活跃 agent/workflow 状态恢复**：
   - 当前有运行中的 agents/workflows 时，注入它们的 summary

4. **Tools 状态恢复**：
   - 如果有 deferred tools 被加载过，标记让下一轮重新 announce

### 与"稳定块/动态块"的关系

compact 后的消息序列变为：
```
[compact summary message]  ← 新的"稳定前缀"（不再变化，可缓存）
[file restore message]     ← 新的"动态块起点"
[user's next message]      ← 动态尾部
```

后续每轮只有动态尾部增长，稳定前缀保持不变 → cache hit。

### 涉及文件

- 新建 `packages/tui/src/compact-restore-runtime.ts`
- `packages/tui/src/deep-compact-runtime.ts` — compact 完成后调用 restore

### 验收标准

- 单测：compact 后 messages 包含文件恢复内容，正确截断
- 单测：文件不存在时跳过不报错
- 单测：总预算限制生效
- 单测：无 plan 时不注入 plan message
- 手动验证：compact 后模型能引用最近编辑的文件内容，不需要重新 Read
- 手动验证：compact 后 agent/workflow 状态延续

---

## 阶段五：稳定块缓存连续性

**目标**：确保 compact 后的"新稳定前缀"能被后续请求缓存命中，避免每次 compact 后 cache 完全重建。

### 实现内容

1. **Compact summary 作为缓存锚点**：
   - compact summary message 一旦注入，在后续请求中不变
   - provider 请求构建时，给 compact summary 添加 cache_control 标记

2. **File restore message 的缓存策略**：
   - 第一次注入时标记为 ephemeral cache
   - 后续轮次如果文件没有新变更，维持相同内容 → cache hit

3. **检测缓存断裂**：
   - 记录上一次 `cache_read_input_tokens`
   - 如果突然归零（非 compact 引起），记录警告
   - 提供诊断信息帮助定位什么操作破坏了缓存

### 涉及文件

- `packages/tui/src/compact-preflight-runtime.ts` — 给稳定消息加 cache markers
- `packages/tui/src/cache-policy-runtime.ts` — cache break 检测逻辑
- `packages/providers/src/` — 确保 provider adapter 传递 cache_control

### 验收标准

- compact 后第 2 轮请求有 cache_read_input_tokens > 0
- 连续 10 轮中 cache_read 占比 > 60%（目前可能 < 20%）
- cache break 事件能被检测并记录原因

---

## 执行顺序和依赖

```
阶段零 ─┐
        ├─→ 阶段一 ─→ 阶段四 ─→ 阶段五
阶段二 ─┘              ↑
                       │
阶段三 ────────────────┘
```

**并行关系**：
- 阶段零（system prompt 边界）和阶段二（session memory）可以并行
- 阶段一（tool result 清理）依赖阶段零完成（需要理解"稳定前缀"位置）
- 阶段三（compact prompt 重写）独立，但结果会影响阶段四的注入格式
- 阶段四（post-compact 恢复）依赖阶段三的 packet 结构
- 阶段五（缓存连续性）依赖阶段零 + 阶段四

**建议执行批次**：
- 批次 A（基础设施）：阶段零 + 阶段二（并行）
- 批次 B（压缩优化）：阶段一 + 阶段三（并行）
- 批次 C（恢复 + 缓存）：阶段四 → 阶段五（串行）

---

## 风险提示

- 阶段零改 system prompt 结构可能影响现有 provider adapter，需要逐 provider 验证
- 阶段三的 9 段 prompt 在小模型上可能输出不完整，需要 fallback 策略
- 阶段五的 cache_control 需要确认各 provider（Anthropic/OpenAI/third-party）的支持情况
- 所有阶段都不能破坏现有 1967/1967 测试通过状态

---

## 验收总标

全部完成后的整体效果：

1. **命中率**：对话 20 轮后模型仍能准确引用第 3 轮的用户要求（目前约 10 轮后丢失）
2. **compact 频率**：从约 8-10 轮触发一次降到 15-20 轮
3. **compact 后恢复**：compact 后第一轮模型就能引用最近文件内容，无需重新 Read
4. **缓存效率**：cache_read_input_tokens 占比从当前 <20% 提升到 >60%
5. **多次 compact 保真**：3 次 compact 后仍能找到第一轮用户的原始请求文本
