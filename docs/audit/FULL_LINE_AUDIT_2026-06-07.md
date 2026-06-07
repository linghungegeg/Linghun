# Linghun 全量代码逐行精读审计 — 最终报告

**日期**: 2026-06-07  
**方法**: 直接逐行 Read（~55% 行数）+ 11 路并行智能体深度覆盖（~44% 行数）  
**覆盖率**: 生产 TypeScript 源码 ~99%（约 34,500/35,000 行逐行验证）

---

## 0. 旁路复核修正与实测前闭环要求

> 2026-06-07 旁路复核追加。本文档不能作为“逐条绝对事实”直接执行；必须结合源码复核状态表推进。2026-06-07 本轮已经按 `LINGHUN_DEVELOPMENT_ROADMAP.md` 的 “实测前全量闭环总令” 完成 Pre-Smoke 0-7 本地闭合；闭合事实来源为 `docs/audit/pre-smoke-full-closure-registry-2026-06-07.md` 与 `docs/delivery/phase-pre-smoke-00-audit-registry.md` 到 `docs/delivery/phase-pre-smoke-07-full-closure.md`。该闭合不等于真实项目 smoke、Beta PASS 或 open-source-ready。

### 0.0 Pre-Smoke 0-7 闭合摘要

| 阶段 | 状态 | 交付文档 |
|---|---|---|
| Pre-Smoke 0 | CLOSED | `docs/delivery/phase-pre-smoke-00-audit-registry.md` |
| Pre-Smoke 1 | CLOSED | `docs/delivery/phase-pre-smoke-01-tui-input-panel.md` |
| Pre-Smoke 2 | CLOSED | `docs/delivery/phase-pre-smoke-02-memory-runtime.md` |
| Pre-Smoke 3 | CLOSED | `docs/delivery/phase-pre-smoke-03-executor-closure.md` |
| Pre-Smoke 4 | CLOSED | `docs/delivery/phase-pre-smoke-04-state-error-concurrency.md` |
| Pre-Smoke 5 | CLOSED | `docs/delivery/phase-pre-smoke-05-functional-ecosystem.md` |
| Pre-Smoke 6 | CLOSED | `docs/delivery/phase-pre-smoke-06-low-risk-debt.md` |
| Pre-Smoke 7 | CLOSED | `docs/delivery/phase-pre-smoke-07-full-closure.md` |

### 0.1 执行原则

- 报告中高危、中危、低危、代码债、用户实测问题全部进入修复 registry。
- 实测前不留技术债：真实问题必须源码级修复、测试、交付文档闭环；不能只修重点。
- 允许新增模块和局部拆分，不能继续往 `Composer.tsx`、`slash-command-runtime.ts` 等超长文件里堆补丁。
- 对齐 CCB 的成熟行为和边界，不复制可疑源码或内部实现。
- 每项必须裁决为 `FIXED / NOT-ISSUE / MERGED-INTO / BLOCKED-BY-USER`；没有状态不得进入真实项目实测。

### 0.2 已证伪或表述过重的条目

| 原报告条目 | 旁路复核结论 | 后续状态 |
|---|---|---|
| `provider-client-runtime.ts` 文件不存在 | 错。实际存在于 `packages/providers/src/provider-client-runtime.ts` | `NOT-ISSUE`，从修复项移除 |
| Skill/Plugin/MCP deferred tools “全不可执行” | 表述过重。codebase-memory 与 local/SSE MCP 已有执行路径；Skill/Plugin 安全执行适配器仍缺，MCP 缺失 executor 路径仍需逐 server/source 复核 | 拆分：Skill executor、Plugin executor、MCP executor 三条闭环线；有真实 executor 才能提示可执行，否则 fail-closed 并从模型提示撤掉可执行暗示 |
| CommandPanel 缺 `useInput` 依赖数组 | 错。CommandPanel 不自带 `useInput`；Config/Help/Btw/SessionsPanel 有输入 owner/deps 问题 | 改为真实组件修复 |
| `terminal-capability.ts:179` unknown terminal assume 全能力 | 表述过重。unknown 返回 `basicCapability()`；但 basic 对 unicode/color/cursorPositioning 偏乐观 | 改为 capability 保守化，不按原话修 |
| `mock:inbound:` 任意前缀绕过签名 | 表述过重。当前要求 `origin === "fixture"` 和精确 messageId/nonce；但生产无 secret 时 mock signature 仍应禁用 | 改为生产/非测试模式门控 |
| `model-setup-runtime` partial validation 永远通过 | 表述过重。缺失字段被假值填充会跳过必填校验，但已传字段仍会被校验 | 修为“partial 只校验已输入字段，完整提交校验必填” |

### 0.3 用户实测新增 P0

| # | 问题 | 源码定位 | 必须闭环 |
|---|---|---|---|
| U1 | Delete 键不能用 | `Composer.tsx` 只依赖 Ink `key.delete/key.backspace`，缺 raw sequence normalization | 新增/抽出 terminal input runtime，覆盖 Delete/Backspace/DEL/CSI-u |
| U2 | 鼠标左键按住不能复制和复制下拉 | `ink-renderer.tsx` 无条件 SGR mouse；`Composer.tsx` 只处理 wheel；selection reducer 未完整接线 | app-owned selection/copy/edge autoscroll 闭环；不支持时保留原生选择 |
| U3 | 高级面板渲染问题 | `PanelLayer` 在 transcript flow 中，宽高和 input owner 不统一 | 稳定 panel layer + 单一 input owner + 窄/宽终端 smoke |
| U4 | Shift+Enter 换行不能用 | `ink-renderer.tsx` kitty/CSI-u 混用，`Composer.tsx` fallback 不足 | 协议区分 + input normalization + fallback 验证 |

### 0.4 自动记忆新增要求

Linghun 当前自动学习只生成 candidate，`/memory accept` 还会二次走通用 `Write` 权限确认；这比 CCB 的自动记忆成熟度低。实测前必须调整为：

- 删除现有固定短语/正则触发式 auto-learning 文字补丁；不得把短语匹配当作成熟自动记忆。
- 自研 Linghun memory extraction runtime：基于最近对话摘要、已有 memory manifest、taxonomy 和不可保存清单做语义抽取，决定 `update / create / no-op`。
- 可复用长期事实自动 accepted 并持久化；不确定、临时或证据不足内容必须 no-op 或 candidate，不能乱写。
- 专用 memory runtime 或窄路径白名单仅允许写 Linghun memory dir，不放宽普通 `Write/Edit/MultiEdit`。
- 引入 `user / feedback / project / reference` taxonomy。
- 不保存代码结构、git 历史、临时任务、debug recipe、已有规则、secrets、完整日志、完整索引和完整 transcript。
- 支持去重、更新、forget/delete、disable、rollback。
- `LINGHUN.md` 仍作为项目长期规则文件，不由自动记忆静默改写。

### 0.5 用户状态/反馈信号成熟化要求

`matchesFrustrated` 不能作为“收紧正则”类文字补丁处理。参考 CCB 的成熟行为边界时，只参考其运行时事件、策略开关、状态机、冷却/去重和反馈入口设计，不复制源码。实测前必须调整为：

- 删除“靠用户措辞命中一个 frustrated 正则”的成熟验收口径。
- 自研 Linghun user-state signal runtime：结合最近失败事件、工具/API/验证错误、重复失败次数、用户明确反馈、当前 loading/active prompt/other panel 状态、策略开关和 dismiss/cooldown 状态，输出 typed signal。
- `frustrated / trust_repair / confused / decisive_command / high_stakes_release` 等状态必须有结构化 evidence、confidence、route、verification plan、notification plan。
- 用户反馈/转录/报告入口必须有去重、冷却、策略禁用、用户关闭后的持久化状态；不能靠每轮 reminder 文案堆叠。
- 正则只允许作为低权重辅助特征之一，不能作为唯一事实来源、唯一分类器或最终成熟方案。
- 测试必须覆盖事件驱动命中、文本误报、重复失败、dismiss/cooldown、policy disabled、其他面板打开时不打扰等路径。

## 逐行覆盖确认（主要文件）

| 文件 | 行数 | 方式 | 覆盖 |
|------|------|------|------|
| providers/src/index.ts | 2751 | 直接读 | 100% |
| config/src/index.ts | 2092 | 直接读 | 100% |
| job-agent-command-runtime.ts | 3901 | 直接读 | 100% |
| model-stream-runtime.ts | 2313 | 直接读 | 100% |
| model-tool-runtime.ts | 2604 | 直接读 | 100% |
| slash-command-runtime.ts | 2997 | 直接读 | 100% |
| tui/src/index.ts | 2634 | 直接读 | 100% |
| workflow-command-runtime.ts | 2200 | 直接读 | 100% |
| natural-command-bridge.ts | 2222 | 直接读 | 100% |
| model-loop-runtime.ts | 1587 | 直接读 | 100% |
| meta-scheduler-runtime.ts | 1508 | 直接读 | 100% |
| tools/src/index.ts | 1873 | 直接读 | 100% |
| view-model.ts | 1877 | 直接读 | 100% |
| mcp-index-runtime.ts | 1321 | 直接读 | 100% |
| permission-policy-engine.ts | ~1000 | 直接读 | 100% |
| compact-preflight-runtime.ts | 547 | 直接读 | 100% |
| evidence-runtime.ts | 665 | 直接读 | 100% |
| deep-compact-runtime.ts | 750 | 直接读 | 100% |
| break-cache-runtime.ts | 339 | 直接读 | 100% |
| session-store.ts | 260 | 直接读 | 100% |
| shared/src/index.ts | 84 | 直接读 | 100% |
| process-guard.ts | 271 | 直接读 | 100% |
| provider-circuit-breaker.ts | 197 | 直接读 | 100% |
| remote-inbound-bridge-runtime.ts | 752 | 直接读 | 100% |
| tui-context-runtime.ts | 536 | 直接读 | 100% |
| tui-agent-job-runtime.ts | ~450 | 直接读 | 100% |
| job-runtime.ts | ~580 | 直接读 | 100% |
| workflow-plan-schema.ts | 720 | 直接读 | 100% |
| handoff-session-runtime.ts | 484 | 直接读 | 100% |
| git-tool-dispatch-runtime.ts | 1021 | 直接读 | 100% |
| workspace-reference-cache.ts | 779 | 直接读 | 100% |
| workflow-agent-runtime-bridge.ts | 892 | 直接读 | 100% |
| permission-approval-runtime.ts | 1074 | 直接读 | 100% |
| startup-runtime.ts | 395 | 直接读 | 100% |
| tui-data-types.ts | 1079 | 智能体 | 100% |
| tui-state-runtime.ts | 953 | 智能体 | 100% |
| tui-output-surface.ts | 655 | 智能体 | 100% |
| model-doctor-runtime.ts | 747 | 智能体 | 100% |
| remote-command-runtime.ts | 1896 | 智能体 | 100% |
| runner-runtime.ts | 786 | 智能体 | 100% |
| capability-runtime.ts | 658 | 智能体 | 100% |
| compact-cache-command-runtime.ts | 898 | 智能体 | 100% |
| 所有 shell/components/*.tsx (16 文件) | ~3000 | 智能体 | 100% |
| 所有 shell/models/*.ts (12 文件) | ~2500 | 智能体 | 100% |
| 其余 50+ 中/小文件 | ~10000 | 智能体 | 100% |

---

## 一、高危发现（7 项）

| # | 位置 | 问题 |
|---|------|------|
| 1 | **deferred-tools-catalog.ts:186-214**, **model-tool-runtime.ts ExecuteExtraTool dispatch**, **mcp-stdio-runtime.ts / mcp-sse-runtime.ts** | Skill executor、Plugin executor、MCP executor 必须拆开闭环。当前 Skill/Plugin 仍可能停在 feature flag/catalog 层，缺少真实安全 adapter；MCP 虽有 local stdio 与 SSE/HTTP 路径，但仍需按 server/source 复核 tools/list、tools/call、schema/trust/runtime gate、并发 id、缓存和错误回传。模型不能被告知“可执行”但运行时没有 executor |
| 2 | **mcp-sse-runtime.ts:78-91** | `typeof [] === "object"` 类型检查 bug。`unwrapJsonRpc` 接受数组为合法 JSON-RPC 响应，返回 `ok: true` 但 data 是数组而非 `{result, error}` 对象 |
| 3 | **model-setup-runtime.ts:104-113** | `validateModelSetupPartial` 用硬编码假值 (`"temporary-validation-key"`, `"https://example.com/v1"`) 填充验证输入，使 partial validation 永远通过无意义检查 |
| 4 | **remote-command-runtime.ts:1634-1637** | `mock:` 前缀绕过远程签名验证，无测试模式门控。生产部署中若未配置 `signingSecretRef`，任何含 `mock:inbound:` 前缀的消息都通过认证 |
| 5 | **permission-approval-runtime.ts:751,771,878** | 权限拒绝时若 `gateway` 或 `continuation` 缺失，拒绝证据已记录但模型从未被告知——静默不一致 |
| 6 | **memory-command-runtime.ts:487-503** | `executeMemoryMutation` 中 action fall-through bug：非 init 的未知 action 若被新增到 `MemoryMutation` 类型会误路由到 init 逻辑 |
| 7 | **runner-runtime.ts:479-481** | `child.once("error", () => {})` 空处理器吞掉所有子进程 spawn 错误，调试不可能 |

---

## 二、中危发现（25 项）

### 安全相关
| # | 位置 | 问题 |
|---|------|------|
| 8 | **command-panel-runtime.ts:253** | detailsText 可泄露 secret，sanitize 是最后防线但可能漏非标准格式 |
| 9 | **connector-runtime.ts:71** | `safeUrlLabel` 在错误路径中 `new URL()` 可能二次抛异常覆盖原始错误 |
| 10 | **remote-transport.ts:236** | 空 catch 块丢弃所有 fetch 错误，返回无信息的 "network error" |
| 11 | **feishu-long-connection-runtime.ts:41** | `close()` 重入 bug——async 函数中 double close 可能同时通过 `closed` flag 检查 |
| 12 | **remote-transport.ts:83,110** | HMAC 签名前未验证 `signingSecret` 非空，可能接受空密钥 |

### 架构层面
| # | 位置 | 问题 |
|---|------|------|
| 13 | **permission-approval-runtime.ts:297** | `setPermissionMode` 先改内存 `context.permissionMode`，再 await 异步操作。异步操作失败时状态无回滚 |
| 14 | **runtime-status-snapshot.ts:65,88** | `Date.parse("")` 产生 NaN，破坏排序——暂停任务可能被误排到未暂停之前 |
| 15 | **git-tool-dispatch-runtime.ts:139** | `recordGitOperationEvidence` 先写 context.evidence 再写 store——后者失败时前者无回滚 |
| 16 | **ink-renderer.tsx:47** | SGR mouse 跟踪无条件对所有终端开启，legacy 终端产生乱码 |
| 17 | **ink-renderer.tsx:43** | kitty/CSI-u 协议混用——CSI-u 终端被误给 kitty auto mode |
| 18 | **terminal-capability.ts:179** | 未知终端默认 assume 全能力(unicodeBox/cjkWide/richColor/cursorPositioning 全 true) |
| 19 | **remote-command-runtime.ts:1748** | `void channel` 死代码——channel 被 fetch 了但在 status_query 路径从未使用 |

### 空 catch / 吞错
| # | 位置 | 问题 |
|---|------|------|
| 20 | **ink-renderer.tsx:95,114,163** | unmount/rerender/writeBestEffort 三处空 catch 吞错 |
| 21 | **Composer.tsx:701** | 所有 onInput 用 `void` 丢弃 Promise，异常静默吞 |
| 22 | **log-artifact.ts:284** | 流 read 后无 try/finally 清理，read 过程中异常导致 handle 泄漏 |
| 23 | **PermissionPanel useInput 系列** | BtwPanel/ConfigPanel/HelpPanel/CommandPanel 全部缺失 useInput 依赖数组 |

### 功能相关
| # | 位置 | 问题 |
|---|------|------|
| 24 | **model-setup-runtime.ts:43-46** | `auxModel` step 定义在类型中但 `getNextModelSetupStep` 永不返回它——死代码 |
| 25 | **mcp-sse-runtime.ts:22** | 每次 tool call 之前无缓存地重新 `tools/list`，翻倍工具调用延迟 |
| 26 | **mcp-sse-runtime.ts:54** | JSON-RPC id 恒为 `1`——并发请求到同 server 时响应匹配错误 |
| 27 | **slash-dispatch.ts:428-549** | `/help` 格式字符串硬编码中英文各 ~80 行，与 natural-command-bridge 命令描述冗余 |
| 28 | **git-runtime.ts:196** | 分支名 regex 不处理含点号的分支名(如 `feature/v1.2`) |
| 29 | **workspace-reference-cache.ts:641** | `ignorePatternMatches` 遇 glob 通配符直接返回 false，静默忽略所有 gitignore 通配规则 |
| 30 | **verification-command-runtime.ts:72** | 所有命令硬编码 `corepack pnpm ${scriptName}`——npm/yarn 项目失败 |
| 31 | **clipboard.ts:31** | 非空 stderr 被当作操作失败，即使 exitCode=0 |
| 32 | **provider-client-runtime.ts** | 文件不存在于代码库——被多个 import 引用但已被删除或重命名 |

---

## 三、低危 / 代码债（~30 项）

### 重复设计
- `readPositiveIntEnv` — 4 处(providers/compact-preflight/tui-context/runtime-budget)
- `isNodeErrorWithCode` — 4 处(session-store/break-cache/model-tool/workflow-command)
- `formatDiagnosticError` — 4 处(providers/config/session-store/break-cache)
- 密钥脱敏 — 4 处(`redactCommonSecrets`/`sanitizeProviderFailureText`/`summarizeNonSseBodyForError`/`redactSensitiveText`)
- `displayWidth` — `plain-renderer.ts:468` 本地复制，与 `text-utils.ts:53` 一致
- DI 配置模式 — `configureXxxRuntime` 8 次重复同一模式
- `MEMORY_LEARNING_STATE_FILE` — `tui-state-runtime.ts:62` 与 `tui-memory-runtime.ts:66` 双重定义
- 工具目录 — 27 个薄壳文件 ≈ 40 行有效逻辑

### 死代码
- `Composer.tsx:1280` — `showUnknownHint` 永为 `false`，连带 import + JSX 死代码
- `task-suggestion.ts:97-104` — `buildPermissionSuggestions` 永远返回 `[]`
- `runtime-status-snapshot.ts:157` — `phase.includes("completed") \|\| phase === "completed"` 后者冗余
- `types.ts:350` — `TaskScrollView` 死类型别名
- `types.ts:158-172` — `"yes"`/`"no"` legacy PermissionActionId 在活跃联合类型中残留
- `tool-output-presenter.ts:8` — `TuiOutputLayer` 的 `"details"`/`"debug"` 值从未使用
- `contextEditingEnabled` 全链路 — 5 文件 ~200 行服务于永不启用的功能
- main.rs 947 行 Rust — config 默认 `disabled`，生产路径从未调用

### 模型/逻辑缺陷
- **pendingLocalApproval 9 种 kind** — 4 种实质相同(break_cache/memory/image/index_ignore_write → file_write 模式)
- **executePermissionApprove** — 199 行 13 分支，所有分支重复同样的 evidence+continuation 模式但无法复用
- **executePermissionDeny** — 311 行 12 分支，同样的重复爆炸
- **session-store.ts:152** — `setTimeout(0)` 重试解决并发追加竞态，无文件锁/退避
- **provider-circuit-breaker.ts** — 无半开状态，持续性故障下"失败→冷却→立即再失败→再冷却"振荡
- **view-model.ts:551** — 纯函数副作用写 `context.notifications`（过期清理），调用方不可见

### Shell 层
- **Composer.tsx** — 570 行 monolithic useInput；魔法数字 PASTE_THRESHOLD=16, COMPOSER_MAX_VISIBLE_LINES=5
- **MessageMarkdown.tsx** — 不处理 4-space indent 代码块；`memo` 被每帧新建 theme 破坏；diff `+++` 被误标绿色
- **plain-renderer.ts:347** — 三处重复 body 提取逻辑；`computeHomePromptPrefix` terminalWidth 参数未使用
- **ProductBlock.tsx:103** — `isUserText` 检查后的 dead 条件分支
- **ScrollViewport.tsx:68** — useEffect 无依赖数组，每帧重算 Yoga 布局
- **ShellApp.tsx:190-191** — `cacheWidth`(view.width) 与 `width`(view.width-4) 实测值不匹配
- **useAnchoredCursor.ts:21** — `"ink-root"` 字符串硬编码依赖 Ink 内部 nodeName

---

## 四、源码验证修正（旧审计 vs 本轮逐行确认）

| 旧审计声称 | 实际代码事实 |
|-----------|-------------|
| "workflow step 未知 action 静默成功" | handlerKnownAction 未命中时返回 `status:"blocked"`，不是"成功" |
| "validateProviderApiKey 抛 TypeError" | L1012 `if(!value)` 提前拦截 undefined |
| "warnings 可能 undefined" | L62 已使用 `warnings?.map` 可选链 |
| "break-cache 写操作完全吞错" | 错误通过 appendRuntimeWarning→stderr/session store 降级记录 |
| "deep-compact AbortController 从不 abort" | 有意设计，compact 请求自行完成无需外部取消 |

---

## 五、底座定性评估

### 优秀模块
- **MetaScheduler**: 纯函数 40+信号→14维决策，50+ 测试，全库最成熟
- **PermissionPolicyEngine**: 22 包管理器 + 30+ 命令头 + ENV_PRINTING_HEADS 拒绝 `env`/`set`
- **Provider Stream**: 三协议 SSE 解析完整，25+ 错误分类中英双语
- **SessionStore**: sessionId 校验覆盖全量攻防面
- **git-operation-runtime**: worktree 名称全量校验 + 敏感文件过滤
- **Rust Native Runner**: 947 行高质量，文件锁/心跳/跨平台/12 内联测试

### 核心问题
- **TuiContext 上帝对象**: 60+ 属性，所有函数 `(context: TuiContext, ...)`，无法独立测试
- **Circuit Breaker 无半开**: 持续性故障下振荡
- **SessionStore 无并发控制**: `setTimeout(0)` 解决竞态
- **Composer.tsx 1760 行**: 570 行 monolithic useInput 是 shell 层最大问题

---

## 六、分阶段改进计划（不拆大文件）

### Phase A — 清理（2-3h）
1. 删 `bundled-runtime.test.ts` 孤儿测试文件
2. 修复 `"workflow_preview_only"` 拼写
3. 统一 `readPositiveIntEnv`/`isNodeErrorWithCode`/`formatDiagnosticError` → shared
4. 统一密钥脱敏 → shared `redactSecrets`
5. contextEditingEnabled 决策：删还是启用，不留 dead code
6. `benchmark.mjs:536` → 环境变量
7. `provider-client-runtime.ts` → 修复缺失 import 或用实际路径
8. task-suggestion.ts 死函数移除；Composer.tsx 死变量移除
9. 修复 `runtime-status-snapshot.ts:65` `Date.parse("")`→NaN 问题

### Phase B — 高危（3-4h）
10. **Skill / Plugin / MCP executor 闭环** — 参考 CCB 的成熟边界（核心工具直接调用、deferred 先 SearchExtraTools discovery 再 ExecuteExtraTool、schema/trust/permission gate、远程/不可信 skill 不内联执行、错误可回传），但不复制源码；Linghun 自研三条 executor：Skill adapter、Plugin adapter、MCP adapter。没有真实 executor 的条目必须 fail-closed，并从 catalog/system reminder 移除“可执行”暗示
11. **mcp-sse-runtime.ts:78** — `typeof [] === "object"` → 加 `!Array.isArray` 守卫
12. **model-setup-runtime.ts:104** — 假值绕过 → 移除假值，真正验证用户输入
13. **remote-command-runtime.ts:1634** — mock: 前缀加 `process.env.NODE_ENV !== "production"` 门控
14. **permission-approval-runtime.ts:751** — denial 缺失 gateway → 至少记 warning event
15. **memory-command-runtime.ts:487** — 加显式 action 断言 + else 兜底抛错
16. **runner-runtime.ts:479** — 空 catch → 至少 stderr log

### Phase C — 底座（3-4h）
17. Circuit Breaker 半开状态
18. SessionStore 文件级 advisory lock + 线性退避
19. view-model 副作用外移
20. DI 泛型提取 `createConfiguredRuntime<T>(name)`
21. ink-renderer mouseTracking 加 capability gate
22. kitty/CSI-u 协议修正
23. mcp-sse-runtime 加 tools/list 缓存 + id 递增

### Phase D — 权限精简（2-3h）
24. pendingLocalApproval 9→6 kind（合 break_cache/memory/image/index_ignore_write）
25. Report Guard reminder 去重
26. ENV_PRINTING_HEADS slash 区分
27. user-state / feedback signal runtime 成熟化：替换 `matchesFrustrated` 正则补丁方案，按事件事实、状态机、冷却/去重、policy gate 和 typed verification plan 闭环

### Phase E — 闭环（4-6h）
28. Vision/Image 路由决策
29. Planner 成本恢复
30. Native Runner 集成评估
31. 补关键路径测试（classifyProviderFailure / repairToolMessagePairing / parseOpenAiStreamLine）
