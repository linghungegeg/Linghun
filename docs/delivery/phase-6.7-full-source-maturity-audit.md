# Phase 6.7 — Full Source-Level Maturity Audit

## 审计基线

- **审计日期**: 2026-06-05
- **审计基线 commit**: `406480c`
- **分支**: `codex/meta-scheduler-closure`
- **审计范围**: 全仓 131 个生产文件 (70,291 行) + 75 个测试文件 (54,385 行)
- **测试基线**: 2,872 通过 / 12 失败 / 2 跳过 (79 test files)
- **typecheck**: clean

## 前置确认

- Phase 6.5 (Streaming Memory Guard): 已完成，交付文档已落地
- Phase 6.6 (TUI Transcript Interaction & Bottom Surface Maturity): 已完成，交付文档已落地
- 本阶段不修代码；只输出审计报告和分阶段修复路线

---

## 审计范围

### 已精读模块清单

| 模块 | 生产文件数 | 精读方式 |
|------|-----------|---------|
| CLI/启动/Shell Renderer/Plain fallback | 29 | 6 个并行 Explore agent 全量精读 |
| TUI 组件/View Model/交互模型 | 31 | 同上 |
| Provider runtime/模型路由/工具运行时/权限管道 | 28 | 同上 |
| Agent/Job/Workflow/后台任务/Memory/Compact | 25 | 同上 |
| Git 稳定点/Worktree/Verification/Evidence Gates | 21 | 同上 |
| Config/Windows 专项/测试缺口/文档对齐 | 全文搜索 + 精读 | 同上 |

---

## 一、全局问题矩阵

### P0 — 必须立即修复（崩溃/数据丢失/安全漏洞/核心链路断裂）

| # | 问题 | 源码路径 | 触发链路 | 影响 |
|---|------|---------|---------|------|
| P0-1 | **index.ts 14,289 行超大文件，中心辐射耦合** | `packages/tui/src/index.ts` | 所有 TUI 启动和命令路径 | 维护负债极高，PR 冲突概率高，新人无法接手。单文件承担协调器/状态机/provider 流/permission 续轮/compact/job 等 10+ 种职责 |
| P0-2 | **model-loop-runtime.ts 1,587 行 god file，混合 8 个职责** | `packages/tui/src/model-loop-runtime.ts` | 工具 schema → system prompt → claim gate → final answer → evidence 派生 | 最大单体文件之一。工具定义、claim gate、completeness、architecture gate、runtime projection、deferred tool 降噪、evidence 派生共 8 种正交职责捆绑。evidence regex 脆弱 |
| P0-3 | **git-tool-dispatch-runtime.ts 987 行零测试，18 方法 DI 注入，双向耦合** | `packages/tui/src/git-tool-dispatch-runtime.ts` | 模型 GitStablePointCreate → executeGitToolUse → performStablePoint → evidence → index.ts approve/deny 回灌 | Git 稳定点/工作树核心编排层零测试。approve/deny continuation 与 index.ts 深度双向耦合。987 行的核心编排无任何安全属性验证 |
| P0-4 | **remote-command-runtime.ts 1,557 行零测试；DingTalk/WeChat Bot 彻底阻止** | `packages/tui/src/remote-command-runtime.ts` | /remote bot start dingtalk/wechat → 被 hard block，仅打印引导文案 | 1557 行零测试。DingTalk/WeChat Bot 通道有用户路由但从不执行。用户看到引导文案但无法连接 |
| P0-5 | **job-agent-command-runtime.ts 3,756 行超大文件** | `packages/tui/src/job-agent-command-runtime.ts` | /job /agents /fork /background 全部汇聚于此 | 最大单体文件之一。Deps 未配置时抛异常无启动时检测。agent/job 状态机分散在 if/else 分支中，无统一状态转换表 |
| P0-6 | **compact 冷却共享阻塞** | `compact-preflight-runtime.ts:68` + `deep-compact-runtime.ts:39` 共享 `context.cache.compactCooldownUntil` | deep compact 失败 → 写 cooldown → preflight 也被阻塞 → 所有 provider 请求阻断 2 分钟 | 用户完全无法使用模型 |
| P0-7 | **MCP stdio JSON-RPC 帧解析假设无换行** | `mcp-stdio-runtime.ts:138-177` | MCP server 返回多行 tool result → 行解析器断裂 → 请求永久挂起直至超时 | MCP 工具调用不可靠 |
| P0-8 | **native runner binary 不可用时 orphan 进程不 kill** | `runner-runtime.ts:670-703` | native runner binary 损坏/缺失 → stopRunnerForDurableJob 直接 mark terminal 而不 kill | 资源泄漏、不可控后台进程 |
| P0-9 | **ApiKey 在非 writeConfig 路径可能泄漏到 transcript** | `config/src/index.ts` `removeSensitiveProjectSettings` 仅在 writeConfig 调用 | mergeProviderEnvConfig 后的 config 在非 writeConfig 路径被序列化 → apiKey 泄漏到 transcript JSONL 或日志 | API key 明文泄漏 |
| P0-10 | **CLAUDE_MODEL_PATTERN 误匹配非 Anthropic 模型** | `providers/src/index.ts` CLAUDE_MODEL_PATTERN | 用户配置代理模型名含 "claude" → resolveEffectiveEndpointProfile 误切到 anthropic_messages profile → 请求失败 | 非 Anthropic 模型被错误路由 |

### P1 — 开源前必须修复（严重功能缺陷/用户可见不成熟）

| # | 问题 | 源码路径 | 触发链路 | 影响 |
|---|------|---------|---------|------|
| P1-1 | **deepseek provider 名称在多处硬编码为回退路径** | `tui-model-runtime.ts:158,219-238`, `tui-state-runtime.ts:65-69` | 非 DeepSeek provider 启动、模型切换 | 非 DeepSeek 用户看到错误 provider 归属 |
| P1-2 | **isRuntimeStatusDump 中文子串匹配** | `tui-output-surface.ts:21-25` | 所有 TUI 输出写入 | 英文 locale 下 StatusTray 噪音无法被拦截 |
| P1-3 | **Workflow step 文案硬编码中文，无 i18n** | `tui-state-runtime.ts:523-528` | /workflows plan <goal> | 英文用户看到中文 workflow steps |
| P1-4 | **内部文档路径硬编码在 readiness 检查** | `terminal-readiness-runtime.ts:298-310` | /doctor, /problems | 外部用户始终看到 missing: docs/delivery/phase-15-5*.md |
| P1-5 | **两套滚动模型重复** (transcript-scroll-state vs task-scroll-state) | `models/transcript-scroll-state.ts`, `models/task-scroll-state.ts` | 滚动变更需两处同步 | 维护成本高，bug 修复遗漏 |
| P1-6 | **CJK 宽度计算 3 处重复且正则不一致** | `view-model.ts:L1447-1459`, `footer-view.ts:L147-190`, `Composer.tsx:L48-52` | CJK 文本截断 | 不同文件截断位置不一致 |
| P1-7 | **isMessageKind/isMessageBlock 重复枚举** | `components/ProductBlock.tsx:L28-40`, `view-model.ts:L1375-1383` | 新增 message block kind | block 渲染分支不一致 |
| P1-8 | **CCB 参考路径残留** (`F:\ccb-source\`) | `permission-policy-engine.ts:L14-20`, `index.ts:L9179` | 任何有源码访问权限的人可读 | 暴露开发环境路径和参考产品身份 |
| P1-9 | **API key 明文存储** | `config/src/index.ts` provider.env | 多用户机器/共享环境 | 凭据泄漏，无 OS keychain 集成 |
| P1-10 | **Workflow Bridge /job actions 不完整** | `workflow-agent-runtime-bridge.ts` 白名单只有 4 个 action，schema 定义了 9 个 | workflow plan 生成 bridge 不支持的 action → createMainChainRequest 返回 null | Workflow 执行链路断裂 |
| P1-11 | **final-answer-gate.ts 291 行零测试，evidence gate 用硬编码 regex** | `final-answer-gate.ts` | 模型 final answer → gate 检查 → 放行或阻断 | 反幻觉最后防线无测试。Beta readiness evidence key 名特定于此 audit 路径 |
| P1-12 | **architecture-boundary.ts guard 存在但不自动接入主链** | `architecture-boundary.ts` | checkBoundaryEditPreflight 存在但 Write/Edit/MultiEdit/Bash 路径从不调用 | Dead code as guard — 检测器存在但无人运行 |
| P1-13 | **6 个关键文件零测试** (git-command-runtime 330行, git-slash-runtime 209行, extension-slash-runtime 445行, 等) | 见左侧路径 | 用户可见 slash 命令入口 | Mutating slash 行为无保证 |
| P1-14 | **meta-scheduler 与 failure-learning 无端到端连接** | `meta-scheduler-runtime.ts:56-58` 只输出 flag，实际 capture 分离在 `failure-learning-runtime.ts` | meta-scheduler 建议 → 调用方可能忽略 → failure learning 管道断开 | 两套系统独立运行但无协同 |
| P1-15 | **compact preflight 硬阻断无降级** | `compact-preflight-runtime.ts:122-137` | tool pairing unsafe + context over limit → blocked:true | 用户被卡住无法继续使用 |
| P1-16 | **agent registry agent 无用户调用路径** | `agent-workflow-registry.ts` /fork 通过 custom agent ID 调用 → resolveForkRegistryAgent 可能未实现 | registry agent 完全不可用 | 注册表加载了但无法使用 |
| P1-17 | **native runner 启动失败静默吞错误** | `runner-runtime.ts:492` `child.on("error", () => {})` 空回调 | native runner 启动失败 → 无日志 → 静默回退 | 难以诊断 runner 问题 |
| P1-18 | **远程入站桥 695 行零测试；DingTalk/WeChat 适配器从未运行** | `remote-inbound-bridge-runtime.ts` | feishu 适配器有 mock 测试；dingtalk/wecom 适配器仅占位符 | 消息转换正确性无法保证 |

### P2 — 成熟度优化（非阻塞但影响体验/维护性）

| # | 问题 | 建议修复 |
|---|------|---------|
| P2-1 | **index.test.ts 23,625 行超大测试文件** | 拆分为多个 test 文件按职责 |
| P2-2 | **view-model.ts 1,390 行承担模型/presenter/翻译/工具 4 种职责** | 拆分为 shell-text.ts, block-builder.ts, composer-builder.ts, permission-builder.ts |
| P2-3 | **面板硬编码宽度不一致** (ConfigPanel 76, HelpPanel 84, CommandPanel 90, BtwPanel 84) | 统一为动态宽度常量和设计令牌 |
| P2-4 | **CtrlOToExpand Context Provider 未挂载** (SubAgentProvider/VirtualListProvider 无调用方) | 挂载 Provider 或删除冗余代码 |
| P2-5 | **MAX_ROUTE_DECISIONS/MAX_BACKGROUND_TASKS 等常量在 index.ts 和子模块双重声明** | 移入 runtime-budget.ts 统一管理 |
| P2-6 | **truncateDisplay 函数 3 处独立实现，CJK 判定不一致** | 统一到 text-utils.ts |
| P2-7 | **帮助文本 400+ 行硬编码在 slash-dispatch.ts** | 从工具注册表自动生成 |
| P2-8 | **classifyProviderFailure 中 PROVIDER_STREAM_ERROR 归类为 gateway 而非 transit** | 重新归类为 transit |
| P2-9 | **三套 compact 机制上下文收集逻辑大量重复** | 提取共享上下文收集层 |
| P2-10 | **PASS_BANNED_EVIDENCE_KINDS 在 3+ 文件重复定义** | 统一到单一源 |
| P2-11 | **redactedPath 在 4+ 模块重复定义** | 抽取到共享路径工具 |
| P2-12 | **runMcpStdioToolCall 和 runMcpStdioToolList 80%+ 代码重复** | 提取公共 spawn/settle/帧解析 |
| P2-13 | **skills/plugins handler 90% 代码重复** | 参数化为 kind 类型 |
| P2-14 | **extension-command-runtime.ts 720 行 + extension-slash-runtime.ts 445 行，零测试** | 添加核心生命周期测试 |
| P2-15 | **第三方 API 中继 URL 暴露** (hk.geek2api.com, sub2api.toioto.org) | 替换为通用示例 |
| P2-16 | **CI 无真实 Windows Terminal/conhost 渲染冒烟** | 添加 Windows CI agent |
| P2-17 | **Workflow planner 始终单 phase** (phaseId = "phase-1" 硬编码) | 实现多 phase 规划 |
| P2-18 | **deepCompact rerun event threshold 逻辑缺陷** (复用旧 compact packet) | 添加强制刷新逻辑 |
| P2-19 | **mojibake 检测含合法西欧字符** (Ñ, Ž, µ, ¥) | 改为连续高比例非 ASCII 检测 |
| P2-20 | **verification-command-runtime shell: true 与 git-runtime execFile 数组原则矛盾** | 替换为 execFile 或添加 shell escaping |
| P2-21 | **StatusFooter 右栏长度用字符数而非 displayWidth 计算** | 使用 displayWidth |
| P2-22 | **组件级/模型级测试覆盖接近零** (31 源文件仅 1 测试文件, 26 it case) | 核心路径至少覆盖输入归属/滚动/权限装配/block 折叠 |

### P3 — 可延后（小问题/优化/一致性）

| # | 问题 |
|---|------|
| P3-1 | ShellBlockOutput 三个结构化写入路径代码高度重复 |
| P3-2 | createLinghunMdTemplate 内联 60 行模板文本 |
| P3-3 | formatMemoryScope 始终返回中文（不尊重 language 参数） |
| P3-4 | brandWordmark 接受参数但全部 void 忽略 |
| P3-5 | notification.sort() 同 priority 排序不稳定 |
| P3-6 | formatRelativeTime 内联在 SessionPanel 中 |
| P3-7 | task-suggestion.ts 死代码：空返回函数 + 空文案字段 |
| P3-8 | config-control-plane 14 panel action 过滤在 import 时重新执行 |
| P3-9 | parseJobRunOptions 默认 phase = "Phase 17A" 开发遗留 |
| P3-10 | handoff keyFiles 硬编码为 local dev 路径 |
| P3-11 | failure learning 无 delete/purge 管理命令 |
| P3-12 | loadAgentRegistry/loadWorkflowRegistry 目录不存在时静默返回空 |
| P3-13 | context-estimator 中文字符 token 估算偏差大 |
| P3-14 | workspace-reference-cache snapshot 条目限制不适合大型 monorepo |
| P3-15 | btw-runtime 无 BTW 对话历史 |
| P3-16 | 自然命令评分对否定句无处理 |
| P3-17 | `~` 前缀在配置默认路径中可能让 Windows 用户困惑 |
| P3-18 | resize debounce 60ms 不可配置 |
| P3-19 | 面板数字跳转 delta 类型断言不准确 |

---

## 二、专项清单

### 硬编码清单

| 类别 | 位置 | 内容 |
|------|------|------|
| Provider 名称 | `tui-model-runtime.ts`, `tui-state-runtime.ts` | `"deepseek"` 字符串在多处回退路径 |
| 内部文档路径 | `terminal-readiness-runtime.ts:298-310` | 10 个 `docs/delivery/phase-15-5*.md` 路径 |
| 开发环境路径 | `permission-policy-engine.ts:L14-20` | `F:\ccb-source\` CCB 参考路径 |
| 品牌名 | `plain-renderer.ts:181` | "LingHun"（与 text-utils 的 "LingHun" 不同源） |
| 面板宽度 | 5 个面板组件 | ConfigPanel 76, HelpPanel 84, CommandPanel 90, BtwPanel 84, SessionsPanel 84 |
| 默认 phase | `job-runtime.ts:107` | `phase = "Phase 17A"` |
| 冷却时间 | `provider-circuit-breaker.ts`, `deep-compact-runtime.ts`, `compact-preflight-runtime.ts` | 45s / 2min / 2min |
| 超时 | 全仓 40+ 处 | 5s/15s/20s/30s/120s/600s 等分散在各模块 |
| token 估算因子 | `context-estimator.ts` | `chars / 4`、`chars / 3` |
| CJK 正则 | `view-model.ts`, `footer-view.ts`, `Composer.tsx` | 三份不同的 Unicode 范围正则 |
| 消息截断阈值 | `tui-output-surface.ts` | 32K streaming / 12K block / 16K transcript / 500 chars summary |
| threshold 常量 | 全仓 60+ 处 | `MAX_ROUTE_DECISIONS=50`, `MAX_BACKGROUND_TASKS=8`, `DEFAULT_PRESERVE_RECENT_MESSAGES=6` 等 |

### 过度设计清单

| 位置 | 描述 |
|------|------|
| 三套 compact (micro/deep/preflight) | 各自有真实用途但上下文收集逻辑高度重复 |
| 两套滚动模型 (transcript-scroll + task-scroll) | task-scroll 是 transcript-scroll 的子集但类型不同 |
| 6 个 git runtime 文件 | 每层有真实职责差异，但 normalizePath 和 plan 拒绝文案重复 |
| 5 个 Lite readiness 检查子系统 | 各自独立实现，无统一框架 |
| architecture-boundary guard | 检测器完整但从不自动运行（dead guard） |
| model-loop-runtime 8 种职责 | 工具 schema + claim gate + completeness + architecture gate + projection + 降噪 + evidence 派生 |
| remote-command-runtime 混合 Bot/Bridge/审批/入站/配对 | 1557 行 god file |
| 18 方法 DI 注入接口 (GitToolDispatchDeps) | index.ts 的设计缺陷被注入模式掩盖 |

### 重复系统清单

| 重复项 | 位置 | 重复次数 |
|--------|------|---------|
| CJK 宽度计算 | view-model.ts, footer-view.ts, Composer.tsx | 3 (正则版本不同) |
| isMessageKind/isMessageBlock 枚举 | ProductBlock.tsx, view-model.ts | 2 |
| truncateDisplay 函数 | startup-runtime.ts, runtime-status-presenter.ts, text-utils.ts | 3 (实现不同) |
| transcript-scroll-state vs task-scroll-state | models/ | 2 (同一逻辑两套类型) |
| redactedPath 函数 | runner-runtime.ts, mcp-index-runtime.ts, mcp-index-command-runtime.ts | 3+ |
| PASS_BANNED_EVIDENCE_KINDS | workflow-agent-runtime-bridge.ts, workflow-plan-schema.ts, workflow-task-surface.ts | 3 |
| COMPACT_PROJECTION_EVENT_PREFIX | compact-preflight-runtime.ts, handoff-session-runtime.ts | 2 |
| MAX_ROUTE_DECISIONS 等常量 | index.ts + 子模块 mirror | 多处 |
| runMcpStdioToolCall / runMcpStdioToolList | mcp-stdio-runtime.ts | 2 (80%+ 重复) |
| skills vs plugins handler | extension-slash-runtime.ts | 2 (90% 重复) |
| normalizePath | git-runtime.ts, git-operation-runtime.ts | 2 |
| sanitizeMobileSummary | workflow-plan-schema.ts, workflow-task-surface.ts | 2 |

### 用户可见层问题清单

| 问题 | 可见表现 | 风险 |
|------|---------|------|
| Footer 宽度跳变 | 面板切换时宽度不统一 (76/84/90) | P2 |
| 英文 locale 下中文文案 | Workflow steps, StatusTray 中文子串匹配失败 | P1 |
| 窄终端面板溢出 | 面板 cardWidth 未响应终端 resize | P2 |
| 通知排序抖动 | 同 priority 通知顺序不稳定 | P3 |
| Ctrl+O hint 子 agent 中重复出现 | Context Provider 未挂载 | P2 |
| /doctor 始终报告内部文档缺失 | 硬编码 phase-15-5*.md 路径 | P1 |
| DingTalk/WeChat Bot 引导但从不连接 | 用户看到引导文案但无法使用 | P0 |
| provider 错误归类误导 | PROVIDER_STREAM_ERROR 归类为 gateway 而非 transit | P2 |
| compact 硬阻断无恢复提示 | 用户被卡住 | P1 |
| parseJobRunOptions 始终显示 "Phase 17A" | 用户困惑 | P3 |

### Windows 专项问题清单

| 问题 | 描述 | 风险 |
|------|------|------|
| 真实 taskkill /t 未验证 | 孤儿孙进程清理未做真实 smoke | P1 |
| CI 无 Windows Terminal 渲染冒烟 | 所有终端测试均用 mock TTY | P2 |
| homedir() 在 Windows 上正确但无 HOMEDRIVE+HOMEPATH 回退 | Node 内置已处理但测试未覆盖 | P3 |
| `~` 前缀文档让 Windows 用户困惑 | 运行时正确解析但文档/注释用 Unix 约定 | P3 |
| conhost legacy 无键盘滚动 | plain mode 保留原生 scrollback 降级 | DOCUMENTED |
| GB18030 fallback 解码误触发风险 | `decodeInput` 检测 `"�"` 在生僻字时可能误触发 | P3 |
| NTFS case-insensitive vs case-preserving | normalizeProjectPath 的 toLowerCase 在 subst 虚拟驱动器下可能异常 | P3 |
| WSL 互操作路径规范化 | canonicalPathForCompare 对 /mnt/c/... 和 C:\... 的一致性未验证 | P3 |

### 测试缺口汇总

| 类别 | 缺口描述 | 风险 |
|------|---------|------|
| 零测试大文件 | git-tool-dispatch-runtime (987行), remote-command-runtime (1557行), final-answer-gate (291行), job-agent-command-runtime (3756行), extension-slash-runtime (445行), git-command-runtime (330行), git-slash-runtime (209行) | P0/P1 |
| 组件零测试 | 18 个 UI 组件无任何测试 (ShellApp, Composer, CommandPanel, StatusFooter 等) | P2 |
| 状态机零测试 | job-runtime 的 durable job 状态机, config-control-plane 的 14 panel 状态机, permission-elevation 的规则匹配 | P1 |
| 真实终端 smoke | Windows Terminal/conhost/ConPTY 无 CI 覆盖 | P2 |
| 真实 provider round-trip | 所有 provider 测试用 mock，无真实 API 集成测试 | P2 |
| 远程通道集成 | 飞书/DingTalk/WeChat 适配器无真实连接测试 | P1 |
| Windows 进程树 | taskkill /t 在真实 shell grandchild 上的效果未验证 | P1 |
| MCP stdio 帧解析 | JSON-RPC 跨 chunk 分片、多行 tool result 场景无测试 | P0 |
| compact 触发边界 | 多种 compact trigger 同时触发时的交互无测试 | P0 |
| session-store 并发 | 并发 appendEvent/updateSummary 的数据完整性无测试 | P1 |
| permission-policy-engine 攻击 | 混淆 bash 命令（base64 编码、ANSI-C 引用）的安全性无测试 | P2 |
| natural-command-bridge 否定句 | 中文否定句、反问句的意图路由无测试 | P2 |

---

## 三、CCB 行为参考

| CCB 行为 | Linghun 对应 | 状态 |
|----------|-------------|------|
| StreamingMarkdown bounded preview + artifact 落盘 | tui-output-surface.ts 32K 触发异步落盘 (Phase 6.5) | DONE |
| max_tokens 总是存在 | createOptionalMaxTokens 默认 16384 (Phase 6.5) | DONE |
| MAX_OUTPUT_CHARS_FOR_CONTEXT 截断 | truncateRoundAssistantForProvider 16K head+tail (Phase 6.5) | DONE |
| 中断清理 streaming 状态 | abort 路径补 endAssistantStream (Phase 6.5) | DONE |
| PgUp/PgDn 半页滚动 + stickToBottom | transcript-scroll-state.ts semantic action (Phase 6.6) | DONE |
| footer 不默认显示 workspace/runtime | view-model.ts 移除默认填充 (Phase 6.6) | DONE |
| 终端原生选区复制 | Ctrl+C 优先级：选区复制 > interrupt (Phase 6.6) | DONE |
| alt-screen + ScrollBox + mouse tracking | Linghun 不使用 alt-screen，终端原生 scrollback 降级 | DEFERRED |
| useSelection / useCopyOnSelect | Linghun 无 programmatic selection，依赖终端原生行为 | NOT-DO |
| drag-to-scroll (mode 1002) | Linghun 不启用 alt-screen，无 mouse tracking | NOT-DO |
| wheel acceleration 曲线 | Linghun 1 行/事件，无 acceleration | DEFERRED |

---

## 四、Linghun 自研边界

本阶段所有审计均确认：
- 所有代码为 Linghun 自研实现，未复制 CCB 或其他专有系统源码
- 模块拆分基于 D.13 机械拆分，将纯类型/纯函数从超大文件中抽离
- 滚动模型基于自研 measured-clamp 方案 (ScrollViewport + transcript-scroll-state.ts)
- Footer 降噪基于自研 StatusFooter + footer-view.ts
- Ctrl+C 复制依赖终端原生行为，非应用层实现
- 未引入 @anthropic/ink 私有 API (ScrollBox, useSelection, useCopyOnSelect)
- 未复制 CCB wheel acceleration 算法
- 未复制 CCB FullscreenLayout / ScrollKeybindingHandler 实现

---

## 五、分阶段修复路线

### Phase 6.8 — 立即安全修复 (P0 子集 + 开源前清理)

| 优先级 | 修复项 |
|--------|--------|
| P0 | ApiKey 全局脱敏拦截器 (config 序列化路径) |
| P0 | CLAUDE_MODEL_PATTERN 收窄为 model 路由显式配置 |
| P0 | compact 冷却共享阻塞修复 (分离 deep/preflight cooldown key) |
| P0 | MCP JSON-RPC 帧解析改用 buffer + 边界检测替代行分割 |
| P0 | native runner stop 添加 fallback kill 路径 |
| P1 | CCB 参考路径清理 (`F:\ccb-source\` → 删除或替换为通用描述) |
| P1 | `CCB_LIKE_*` 命名清理 |
| P1 | 第三方中继 URL 替换为通用示例 |
| P2 | deepseek 硬编码统一为 `config.defaultProvider` |

### Phase 7.0 — 核心文件拆分

| 优先级 | 修复项 |
|--------|--------|
| P0 | index.ts 拆分：继续抽离协调器逻辑，目标 < 8,000 行 |
| P0 | model-loop-runtime.ts 拆分为 6-8 个文件 (按职责) |
| P0 | git-tool-dispatch-runtime.ts 拆分 + 添加测试 |
| P0 | remote-command-runtime.ts 拆分 + 决定 DingTalk/WeChat Bot 去留 |
| P0 | job-agent-command-runtime.ts 拆分 + deps 启动时检测 |
| P1 | final-answer-gate.ts 添加测试 + 去 audit-specific 证据名 |
| P1 | 6 个零测试文件添加最小测试覆盖 |
| P1 | architecture-boundary guard 接入 Write/Edit permission 管道 |

### Phase 7.1 — 消除重复系统

| 优先级 | 修复项 |
|--------|--------|
| P1 | 统一 CJK 宽度计算 (3→1) + 统一 CJK regex |
| P1 | 删除 task-scroll-state.ts，泛型化 transcript-scroll-state |
| P1 | 合并 isMessageKind/isMessageBlock 为一处枚举 |
| P1 | Workflow step 文案走 tui-messages.ts i18n 体系 |
| P1 | isRuntimeStatusDump 改为结构化标记 |
| P2 | truncateDisplay 统一到 text-utils.ts |
| P2 | MAX_ROUTE_DECISIONS 等常量统一到 runtime-budget.ts |
| P2 | 合并 PASS_BANNED_EVIDENCE_KINDS 为单一源 |
| P2 | 合并 COMPACT_PROJECTION_EVENT_PREFIX 为单一源 |
| P2 | 合并 redactedPath 为共享路径工具 |
| P2 | 合并 runMcpStdioToolCall/ToolList 公共逻辑 |
| P2 | 合并 skills/plugins handler 为参数化函数 |

### Phase 7.2 — 交互成熟化

| 优先级 | 修复项 |
|--------|--------|
| P1 | 内部文档路径移除，改为通用检查 |
| P2 | 统一面板宽度常量 |
| P2 | 挂载 CtrlOToExpand Context Provider |
| P2 | StatusFooter displayWidth 计算修复 |
| P2 | classifyProviderFailure 归类修正 |
| P2 | 清理 task-suggestion 死代码 |
| P2 | mojibake 检测收窄字符集 |
| P2 | 组件核心路径测试 (输入归属/滚动/权限装配/block 折叠) |

### Phase 7.3 — 深度优化

| 优先级 | 修复项 |
|--------|--------|
| P1 | Workflow Bridge actions 补全 |
| P1 | agent registry 用户调用路径接线 |
| P1 | meta-scheduler → failure-learning 端到端连接 |
| P1 | compact preflight 硬阻断降级路径 |
| P2 | view-model.ts 拆分 |
| P2 | Workflow planner 多 phase 支持 |
| P2 | deepCompact refresh 逻辑修复 |
| P2 | extension 测试添加 |
| P3 | 各 P3 项按需修复 |

---

## 六、统计汇总

| 维度 | 数量 |
|------|------|
| P0 | 10 |
| P1 | 18 |
| P2 | 22 |
| P3 | 19 |
| **总计** | **69** |
| 硬编码项 | 60+ |
| 过度设计项 | 8 |
| 重复系统 | 12 组 |
| 零测试大文件 (>200行) | 12 |
| 超大文件 (>1000行) | 8 |

### 超大文件 TOP 10

| 文件 | 行数 |
|------|------|
| index.test.ts | 23,625 |
| index.ts | 14,289 |
| view-model.test.ts | 5,411 |
| job-agent-command-runtime.ts | 3,756 |
| providers/index.test.ts | 3,414 |
| providers/index.ts | 2,588 |
| natural-command-bridge.ts | 2,181 |
| config/index.ts | 1,917 |
| model-loop-runtime.ts | 1,587 |
| remote-command-runtime.ts | 1,557 |

---

## 七、明确未修改源码

本阶段为零代码改动的纯审计阶段。所有发现仅记录在案，未对任何源码文件做修改。

## 八、明确未复制 CCB 可疑源码

所有审计确认：Linghun 实现为自研。CCB 仅作为行为参考（滚动语义、footer 降噪设计方向），未复制实现代码、内部 API、专有遥测、专有调参数据或专有内部服务逻辑。

## Handoff Packet

```json
{
  "verdict": "AUDIT_COMPLETE",
  "scope": "Phase 6.7: 全仓源码级成熟度审计 — 131 生产文件 70,291 行 + 75 测试文件 54,385 行",
  "totalFindings": 69,
  "bySeverity": { "P0": 10, "P1": 18, "P2": 22, "P3": 19 },
  "testBaseline": { "passed": 2872, "failed": 12, "skipped": 2, "files": 79 },
  "typecheck": "clean",
  "topRisks": [
    "index.ts 14,289 行超大文件",
    "12 个关键文件零测试覆盖",
    "deepseek 硬编码在多处 provider 回退路径",
    "CJK 宽度计算 3 处重复且正则版本不同",
    "ApiKey 泄漏风险（非 writeConfig 序列化路径）",
    "compact 冷却共享阻塞导致用户无法使用模型"
  ],
  "unchangedSource": true,
  "noCcbSourceCopied": true,
  "nextAction": "用户决定是否进入 Phase 6.8 修复阶段，或按分阶段路线逐个推进"
}
```

---

## 参考核对

### 本阶段读取的 Linghun 文档
- `AGENTS.md` (阶段边界)
- `docs/delivery/README.md` (交付索引)
- `docs/delivery/phase-06-5-streaming-memory-guard.md` (Phase 6.5 交付)
- `docs/delivery/phase-06-6-tui-transcript-interaction.md` (Phase 6.6 交付)

### 本阶段精读的 Linghun 源码
全仓 131 个生产文件 + 75 个测试文件，通过 6 个并行 Explore agent 精读。

### CCB 行为参考
未在本阶段查看 CCB 源码。审计基于 Linghun 自有源码事实和 Phase 6.5/6.6 交付文档中已记录的 CCB 行为对照。

### 未复制可疑源码
本阶段为零代码改动的纯审计，不存在源码复制行为。
