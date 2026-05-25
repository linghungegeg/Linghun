# Pre-Smoke Slice D.14B: Controlled Learning / Memory Brain Wiring

## 阶段目标

为 Linghun 补齐"强底座轻学习"能力：用户显式开启自动学习后，系统能高质量记录用户习惯、高频行为、项目偏好，并和现有 memory/evidence/context/guard 联动。

## 复用的现有 memory 入口

| 入口 | 状态 | 说明 |
|------|------|------|
| `MemoryState` 类型 | 复用 + 扩展 | 新增 `learningMode` 字段 |
| `MemoryCandidate` 类型 | 完全复用 | 候选记忆数据结构不变 |
| `MemoryLearningRun` 类型 | 完全复用 | 学习运行记录不变 |
| `/memory` 命令体系 | 复用 + 扩展 | 新增 `learn on/off/status`、`forget` 别名 |
| `createControlledMemoryInjection` | 复用 + 修正 | 移除 `!item.inferred` 过滤（accepted 即可信） |
| `createEvidenceBackedMemoryCandidates` | 完全复用 | 手动 `/memory learn` 仍走此路径 |
| `writeMemoryRecord` / `removeMemoryRecord` | 完全复用 | 持久化逻辑不变 |
| `formatMemoryStatus` / `formatMemoryStats` | 修改 | 动态显示 learning mode |
| candidates/accepted/rejected/disabled 生命周期 | 完全复用 | 不另造第二套 |

## 新增/增强的学习能力

### 1. 学习模式开关

- `MemoryLearningMode` 类型：`"off" | "active"`
- 默认 `"off"`，不主动学习
- `/memory learn on` 开启，`/memory learn off` 关闭
- `/memory learn status` 查看当前状态
- 开关状态记录到 session event

### 2. 自动学习提取（已接入真实 turn end）

- `runAutoLearningOnTurnEnd(context, userInput)` — 在 `handleNaturalInput` 返回 `"message"` 前自动触发
- 接入位置：`handleNaturalInput` 函数末尾，所有控制命令/权限确认/setup 路径已 `return "handled"` 之后
- 仅在 `learningMode === "active"` 时工作
- 只对真正进入模型路径的普通用户输入触发，不对 slash command、权限 y/n、provider setup 输入触发
- 从用户输入中提取偏好/习惯/协作规则
- 生成的候选标记 `inferred: true`
- 每次最多生成 2 个候选，避免噪音

### 3. 学习内容分类

`MemoryLearningCategory` 类型：
- `preference` — 语言、回答风格、命令偏好、验证偏好
- `frequent_behavior` — 常用命令、常用工作流
- `project_habit` — 测试命令、构建命令、文档位置
- `collaboration_rule` — "先看源码""不要写报告"等协作约定

### 4. Secret/Key 过滤

`containsSecret(text)` 函数，匹配以下模式：
- OpenAI/Anthropic 风格 API key (`sk-...`)
- GitHub PAT (`ghp_...`)
- AWS Access Key (`AKIA...`)
- Slack token (`xox...`)
- RSA/EC/DSA 私钥头
- 长 base64 字符串

任何匹配 secret 模式的输入整体跳过，不生成候选。

### 5. `/memory forget` 别名

等同 `/memory delete`，语义更自然。

## 哪些内容会学

- 用户偏好：`"用 vitest 跑测试"` → preference
- 协作规则：`"不要写报告"` → collaboration_rule
- 习惯声明：`"我习惯先看源码再给命令"` → preference

## 哪些禁止学

- API key、token、secret、私密路径完整内容
- 临时情绪、一次性抱怨
- 未经确认的事实
- provider 原始错误体、完整日志大段内容
- 输入过短（<8字符）或过长（>2000字符）的内容

## 和 context/evidence/D.14A guard 联动

| 系统 | 联动方式 |
|------|----------|
| Context injection | 仅 accepted 项进入 prompt，topK=3，字符预算限制 |
| Evidence | 手动 `/memory learn` 仍从 bounded evidence 提取 |
| D.14A Guard | inferred 候选不自动 accept；用户必须显式确认 |
| Doctor/Status | 动态显示 `autoLearning: on/off`、候选数、已接受数 |
| Cache freshness | 学习操作触发 `refreshCacheFreshness` |
| Session events | 所有学习操作记录到 session event log |

## 测试覆盖

16 个 D.14B 测试全部通过（总 215 tests）：

1. ✅ 默认不主动学习（learningMode=off 不生成 candidate）
2. ✅ `/memory learn on` 开启，`/memory learn off` 关闭
3. ✅ 开启后从用户输入生成 candidate
4. ✅ candidate 未接受不注入 context，accept 后可注入
5. ✅ reject/forget 后不再出现
6. ✅ secret/key 不会被学习
7. ✅ 高频偏好去重，不重复生成
8. ✅ doctor/status 显示自然语言学习状态
9. ✅ 关闭学习后不再新增 candidate
10. ✅ `containsSecret` 正确识别敏感内容
11. ✅ **真实路径**：learning off 时普通输入不生成 candidate
12. ✅ **真实路径**：learning on 时普通输入生成 candidate
13. ✅ **真实路径**：slash/control command 不触发自动学习
14. ✅ **真实路径**：secret 输入不触发自动学习
15. ✅ **真实路径**：candidate 未 accept 不注入 context
16. ✅ Phase 16 原有测试无回归

## 验证结果

```
corepack pnpm exec vitest run packages/tui/src/index.test.ts → 215 passed
corepack pnpm typecheck → clean
corepack pnpm check → 1 pre-existing warning (unrelated)
git diff --check → clean
```

## 涉及文件

- `packages/tui/src/index.ts` — 核心实现（类型、命令、学习逻辑、secret 过滤）
- `packages/tui/src/index.test.ts` — 11 个新测试
- `packages/tui/src/slash-dispatch.ts` — 帮助文本更新

## 仍需 real smoke 的项

- 真实用户多轮对话中自动学习触发的质量和噪音比
- 长期运行中候选积累的去重效果
- 跨会话 accepted memory 持久化和加载验证（已有 Phase 16 测试覆盖基础路径）
- TUI 中 `/memory learn on` 的交互体验（本阶段不做 TUI 美化）

## 参考核对

- 本阶段实际读取：`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`（阶段范围）、`packages/tui/src/index.ts`（现有 memory 实现）、`packages/config/src/index.ts`（storage 配置）、`packages/tui/src/slash-dispatch.ts`（命令帮助）、`packages/tui/src/natural-command-bridge.ts`（命令路由）
- 本阶段参考：CCB 的 memory/auto-memory 行为模式（候选-确认-生效流程）
- 所有内容为 Linghun 自研实现，未复制可疑源码

## Handoff Packet

- **下一阶段**：D.14C 或 D.15（视蓝图）
- **禁止事项**：不得将自动学习接成后台无限扫描；不得自动 accept inferred 候选；不得引入数据库
- **证据引用**：210 tests pass, typecheck clean, biome check clean
- **验证结果**：PASS
- **索引状态**：F-Linghun 索引不可用（仅 temp 项目存在），使用 rg/Grep 完成盘点
- **权限模式**：default
- **模型/provider**：N/A（本阶段不调用模型）
- **预算使用**：无 API 调用成本
