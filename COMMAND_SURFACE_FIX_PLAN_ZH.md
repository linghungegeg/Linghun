# Command Surface 修复方案（待确认）

> 目的：把前面定位到的体验、命令语义、权限分类、输出分层、进度反馈和验证闭环问题统一收口，而不是只处理“压缩上下文”单点。
>
> 状态：草案，供确认方案用。确认后再拆任务实施。

## 1. 背景

当前问题不是单纯的 compact 能力是否存在，而是用户入口和运行时契约没有完全对齐：

- 用户看到 `/compact`，直觉是“执行压缩”，但当前默认行为更像“查看状态”。
- 主屏输出包含大量诊断字段，普通用户难以判断动作是否开始、是否完成、下一步是什么。
- natural command / capability 把 compact 归成 readonly，但 deep compact 实际会触发 provider 请求并写入会话内 compact boundary / packet。
- 进度展示现在更像静态状态，不是按阶段推进的一条简单进度条。
- 后台任务、并发上限、command panel、details、测试和文档需要一起闭环，否则后续容易回退。

本方案目标：默认体验简单，内部能力不缩水；主屏只显示状态和下一步，高级信息进入 `/compact status`、`/details`、doctor/debug。

## 2. 已确认的代码事实

以下事实来自当前仓库源码定位，作为方案依据：

- `packages/tui/src/compact-cache-command-runtime.ts` 中 `handleCompactCommand` 当前默认 `args[0] ?? "status"`，因此裸 `/compact` 默认走状态输出。
- 同一文件中 deep compact 分支会设置 `context.cache.compactProgress`，然后 `await runDeepCompact(...)`。
- `createRunningCompactProgress()` 当前一次性包含 `scan_context`、`generate_summary`、`trim_old_records`、`restore_context` 等阶段，不是逐步推进。
- `packages/tui/src/cache-command-runtime.ts` 中 `formatCompactStatus` 输出 compact acceptance、pressure、deep packet、projection、feature flags、rollback 等诊断字段。
- `packages/tui/src/natural-command-bridge.ts` 当前把 compact capability 注册为 `/compact` / `/context`，描述为“查看或执行”，risk 为 `readonly`。
- `packages/tui/src/slash-dispatch.ts` 帮助文案只列 `/compact              压缩长对话上下文`，没有把执行和状态拆开。
- `packages/tui/src/background-control-runtime.ts` 已把 `compact` 纳入资源 guard 计数类型，说明运行时已有把 compact 当作受管任务的基础。

## 3. 总体修复原则

1. 命令契约先行：每个入口只表达一个主要意图。
2. 主屏 summary-first：默认只展示用户需要知道的动作、进度、结果和下一步。
3. 诊断信息可展开：完整 pressure、boundary、projection、pairing safety、evidence refs 进入 status/details。
4. 权限语义真实：只读就是只读；会触发 provider 或写会话状态的动作不能归为 readonly。
5. 不牺牲底座能力：保留 deep compact、boundary、rollback、pairing safety、cache telemetry，只改变默认呈现和路由。
6. 测试锁契约：修完后用测试防止 `/compact` 再退回只显示 status。

## 4. 修复项 A：拆清 `/compact` 与 `/compact status`

### 问题

裸 `/compact` 当前默认是 status，但帮助文案和用户直觉都是执行压缩。这个错位会让用户以为“点了没反应”或“只是在看诊断”。

### 方案

- `/compact`：执行一次受控 compact。
- `/compact deep`、`/compact run`、`/compact manual`：继续兼容为执行 compact。
- `/compact status`：只显示 compact 状态、边界、pressure、rollback、projection 等诊断。
- `/context`：建议定位为上下文状态入口，不触发 provider 请求。
- `/context compact` 或 `/compact`：再触发执行，是否新增该别名待确认。

### 预期用户体验

```text
> /compact
正在压缩上下文
[████░░░░░░░░] generate-summary
```

完成后：

```text
Deep compact 完成。
已保留当前目标、关键文件、证据引用和待办项。
详情可用 /compact status 或 /details 查看。
```

### 需要改动

- `packages/tui/src/compact-cache-command-runtime.ts`
- `packages/tui/src/slash-dispatch.ts`
- 相关 compact command 测试

## 5. 修复项 B：主屏输出降噪，诊断进入 details/status

### 问题

`formatCompactStatus` 是完整诊断，不适合作为普通用户执行 compact 后的默认输出。

### 方案

新增轻量 presenter：

- 执行中：只显示标题、进度条、当前阶段。
- 成功：只显示完成状态、保留了什么、下一步。
- 低收益：说明“当前上下文压力不高，暂不建议 compact”，并给 status 入口。
- 失败：显示一句原因和下一步，完整错误放 details。

`formatCompactStatus` 保留，用于：

- `/compact status`
- `/details compact ...`
- doctor/debug 入口

### 不做

- 不删除已有 compact telemetry。
- 不削弱 rollback、boundary hash、pairing safety。
- 不把完整 transcript 或 raw tool result 放主屏。

## 6. 修复项 C：进度条改为真实阶段推进

### 问题

当前 compact progress 初始化时就包含多个阶段，视觉上不像真实推进。

### 方案

把 compact progress 变成阶段更新：

1. `scan-context`：扫描当前上下文、transcript、cache pressure。
2. `generate-summary`：调用 provider 生成压缩摘要。
3. `trim-old-records`：生成 compact packet / boundary。
4. `restore-context`：恢复当前目标、关键文件、证据引用、待办项。
5. `complete`：清除 running progress，写入完成摘要。

实现上可以保留当前 `formatContextProgressBar`，只改变 stage 写入时机。

### 预期

用户只看到一条稳定进度条：

```text
[███░░░░░░░░░] scan-context
[██████░░░░░░] generate-summary
[█████████░░░] trim-old-records
[████████████] restore-context
```

## 7. 修复项 D：权限和 natural command capability 拆分

### 问题

当前 compact capability 同时描述“查看或执行”，但 risk 为 `readonly`。这会让自然语言入口和权限提示不可信。

### 方案

拆成两个 capability：

- `compact-status`
  - slash：`/compact status` 或 `/context`
  - risk：`readonly`
  - 适用意图：查看上下文压力、compact 边界、pairing safety、rollback 状态

- `compact-run`
  - slash：`/compact`
  - risk：`start_gate` 或受控 local session action（具体取决于现有权限模型）
  - 适用意图：压缩上下文、清理长对话、减少上下文压力
  - 说明：不写项目文件、不写长期记忆，但会触发 provider 请求并写会话 compact 状态

### 自然语言路由示例

- “看下现在上下文压力” -> `/compact status`
- “compact 状态怎么样” -> `/compact status`
- “压缩一下上下文” -> `/compact`
- “清理一下长对话” -> `/compact`

## 8. 修复项 E：command panel 和帮助文案同步

### 问题

帮助文案只列 `/compact`，高级命令入口没有清楚区分执行和状态。

### 方案

帮助文案建议改为：

```text
/compact              压缩当前长上下文
/compact status       查看 compact 状态、边界和 rollback
/context              查看上下文使用率和 compact 建议
```

英文：

```text
/compact              Compact the current long context
/compact status       Show compact status, boundaries, and rollback
/context              Show context usage and compact suggestions
```

command panel 建议展示两个入口：

- `Compact context` -> `/compact`
- `Compact status` -> `/compact status`

## 9. 修复项 F：接入资源 guard 和后台状态

### 问题

运行时已有 `compact` resource guard 类型，但 compact 执行路径需要确认是否完整接入 guard、background、interrupt。

### 方案

最小闭环：

- 执行 deep compact 前调用 compact resource guard。
- 如果已有 build/test/index/bash/verification 等重任务，提示用户等待、查看 `/background` 或 `/interrupt`。
- 前台执行时也要遵守同一 guard。
- 如后续改成后台任务，注册 background task，让 `/background` 可见、可取消。

### 用户提示示例

```text
当前已有 index 重任务运行，暂不启动 compact。
可等待完成、查看 /background，或用 /interrupt 取消后重试。
```

## 10. 修复项 G：多语言和文案一致性

### 问题

compact 部分分支存在中文硬编码；英文环境可能出现中文提示。

### 方案

- compact 所有用户可见文案按 `context.language` 分支。
- 中文、英文使用同一套命令语义。
- 错误、低收益、完成、建议、resource guard 都覆盖中英。

## 11. 测试计划

必须补或调整以下测试：

1. 裸 `/compact` 会进入执行路径，不再默认 status。
2. `/compact status` 只读，不调用 provider。
3. `/context` 只读，不调用 provider。
4. “压缩上下文”自然语言路由到 `/compact`。
5. “查看 compact 状态”自然语言路由到 `/compact status`。
6. compact progress stage 是逐步变化，不是一开始包含全部阶段。
7. deep compact 请求仍然不带 tools，保持 `tool_choice: none`。
8. 主屏 compact 成功输出不包含 raw transcript、secret、绝对路径、大段 details。
9. `/compact status` 仍能看到完整诊断字段。
10. resource guard 生效时不会启动第二个重任务。

建议优先测试文件：

- `packages/tui/src/compact-cache-command-runtime.test.ts`
- `packages/tui/src/cache-command-runtime.test.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/natural-command-bridge.test.ts`
- 必要时新增 command panel invariant 测试

## 12. 阶段性任务拆分（待确认后托管执行）

下面拆成 1 个准备阶段和 7 个执行阶段。Phase 1-4 先修 compact 命令面和体验，Phase 5-7 落地反幻觉成熟化。这样可以先把用户可见问题收口，再改更底层的 claim/evidence 机制，风险更可控。

### Phase 0：实施基线与边界确认

目标：进入长任务前先固定边界，避免边做边扩大范围。

任务：

- 检查当前 git 状态，确认已有未提交改动哪些属于本任务、哪些只保留不碰。
- 建议创建稳定点或工作树隔离，防止长任务中混入用户已有改动。
- 快速跑或定位现有 compact / final gate / natural command 相关测试，确认当前失败基线。
- 确认本轮不改 `preflight` / `tool-result-budget` 主链路。

验收：

- 有清楚的改动边界和测试入口。
- 长任务托管只按本阶段清单执行，不临时扩到无关重构。

### Phase 1：compact 命令契约修正

目标：把 `/compact`、`/compact status`、`/context` 的语义拆清。

任务：

- 裸 `/compact` 改为执行受控 compact。
- `/compact status` 保持只读诊断。
- `/context` 定位为只读上下文状态入口，不触发 provider 请求。
- `/compact deep`、`/compact run`、`/compact manual` 保持兼容。
- 更新 slash help、command panel 的命令说明。

主要文件：

- `packages/tui/src/compact-cache-command-runtime.ts`
- `packages/tui/src/slash-dispatch.ts`
- command panel / help 相关入口

验收：

- 裸 `/compact` 不再默认走 status。
- `/compact status` 和 `/context` 不调用 provider。
- help 文案明确区分执行和查看状态。

### Phase 2：compact 主屏输出与进度体验

目标：让执行 compact 的主屏只显示一条稳定进度和简洁结果，完整诊断留给 status/details。

任务：

- 新增或调整轻量 compact run presenter。
- 执行中只显示标题、进度条、当前阶段。
- 成功输出只显示完成摘要、保留了什么、下一步入口。
- 低收益和失败输出降噪，完整原因进入 details/status。
- progress stage 改为逐步推进，而不是初始化时一次性放入全部阶段。

主要文件：

- `packages/tui/src/compact-cache-command-runtime.ts`
- `packages/tui/src/cache-command-runtime.ts`
- progress / presenter 相关测试

验收：

- 主屏不出现 raw transcript、secret、绝对路径、大段 details。
- 用户能看到 `scan-context -> generate-summary -> trim-old-records -> restore-context -> complete` 的阶段推进。
- `/compact status` 仍保留完整诊断字段。

### Phase 3：权限、natural command 与资源 guard

目标：让自然语言入口和权限分类可信，避免把执行型 compact 误标成 readonly。

任务：

- 拆 `compact-status` 与 `compact-run` capability。
- `compact-status` 标记 readonly。
- `compact-run` 按真实副作用标记为 start gate 或受控 session action。
- 自然语言“查看状态”路由到 `/compact status`。
- 自然语言“压缩上下文/清理长对话”路由到 `/compact`。
- deep compact 执行前接入 compact resource guard。
- 如阶段内成本可控，再接入 background 可观察性；否则只保留 guard，并把后台化留作后续增强。

主要文件：

- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/background-control-runtime.ts`
- permission / capability list / doctor 输出相关文件

验收：

- natural command 不再把执行 compact 判成 readonly status。
- 已有重任务运行时不会无保护启动第二个 compact。
- resource guard 的提示能告诉用户查看 `/background` 或稍后重试。

### Phase 4：compact 回归测试与文档闭环

目标：先把 compact 修复锁住，形成可独立交付的小闭环。

任务：

- 补或调整 focused tests：命令契约、只读状态、natural command 路由、进度阶段、主屏降噪、resource guard。
- 更新 README / WHITEPAPER 中对应命令描述（如确有引用）。
- 做一次集中验证，确认 compact 修复不依赖反幻觉改造才能成立。

建议测试文件：

- `packages/tui/src/compact-cache-command-runtime.test.ts`
- `packages/tui/src/cache-command-runtime.test.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/natural-command-bridge.test.ts`

验收：

- compact 相关 focused tests 通过。
- 文档和 help 不再描述成“查看或执行”混合入口。
- 这一步完成后，即使暂停后续反幻觉阶段，compact 用户体验也应是可用闭环。

### Phase 5：结构化 Claim Contract 基础层

目标：为反幻觉成熟化建立类型和测试基线，但不急着替换所有旧正则。

任务：

- 定义最小 `FinalAnswerClaim` 类型。
- 定义 claim kind 与 evidence kind 的绑定规则。
- 给 file/test/build/lint/typecheck/external/git/workflow/agent 建 fixture。
- 现有正则路径保留，但统一标记为 legacy fallback。
- 明确 `completion` 不能单独作为通过依据，只能由具体 claim 组合推出。

主要范围：

- final answer gate / evidence binding 相关模块
- verification runner / evidence runtime 的类型边界
- claim contract fixture 测试

验收：

- 每类高风险 claim 都有 fixture。
- 缺 evidence 时能指出缺少的 evidence kind。
- 普通方案讨论不会因为出现“完成、修复、验证”等词进入重型补证据路径。

### Phase 6：工具结果产出 claim seed

目标：让事实从工具/runtime 事件产生，而不是从最终回答文本反推。

任务：

- verification runner 输出 test/build/lint/typecheck claim seed。
- file edit 工具输出 file_change claim seed。
- workflow/agent/git/web 工具输出对应 claim seed。
- final answer 只引用已有 claim seed；缺 seed 时必须表达为未验证或未执行。
- 保留旧文本匹配作为安全兜底，不作为主判定来源。

验收：

- “测试通过 / 构建通过 / 已修改文件 / 已提交”等声明必须绑定结构化 evidence。
- 没有工具证据时，最终回答不能把高风险事实写成已完成。
- claim seed 与 evidence refs 能在 details/debug 中追溯。

### Phase 7：Final Gate contract-first 与 legacy 收敛

目标：把反幻觉主路径切到 claim contract + evidence binding，并逐步降低正则权重。

任务：

- final gate 优先检查结构化 claim contract。
- 再检查 evidence binding。
- 最后才走 legacy text fallback。
- 对普通解释、方案讨论、只读分析降低误触发率。
- 删除或降权完成声明、测试通过、修复完成等主判定正则。
- 每次删除或降权都补 fixture，防止回退。

验收：

- legacy 正则只作为兜底路径，不能成为主判定路径。
- final gate 拦截原因能说明缺哪类 evidence。
- 高风险完成声明仍严格，低风险讨论路径更轻。
- `preflight` / `tool-result-budget` 仍未被本阶段修改。

## 13. 待确认问题

1. 裸 `/compact` 是否确认改成“执行 compact”？建议：是。
2. `/context` 是否只做只读状态入口？建议：是。
3. 执行 compact 是否需要显式确认？建议：auto-review 下可直接运行；普通权限模式走 start gate。
4. compact 是否要改成后台任务？建议：第一步先前台执行但接 resource guard；如果耗时明显，再升级后台。
5. 主屏进度条是否只保留一条？建议：是，符合“简单点，一个进度条”的方向。
6. `/compact deep` 是否继续保留？建议：保留兼容，但帮助里主推 `/compact`。

## 14. 验收标准

修复完成后应满足：

- 用户输入 `/compact` 能看到明确执行进度和完成摘要。
- 用户输入 `/compact status` 能看到完整诊断。
- `/context` 不触发 provider 请求。
- natural command 不再把执行 compact 误判成 readonly status。
- 主屏不出现大段内部字段。
- details/status 仍保留完整工程证据。
- compact 不与其他重任务无保护并发。
- focused tests 覆盖命令契约、权限分类、进度、输出分层。

## 15. 反幻觉成熟化方案（方向已确认，待实施）

### 15.1 背景

前面审计里看到的反幻觉链路不是单点性能问题，而是几类判断还停留在文本启发式阶段：

- final answer gate 会根据自然语言完成声明、高风险词、测试通过词等触发补证据或重答。
- model loop 会从最终回答文本里抽取 claim phrase，再映射到 evidence kind。
- meta-scheduler 会用关键词判断任务域、验证强度和风险提示。
- natural command 会用关键词把用户意图路由到 slash command 或 capability。

这些能力本身是必要的，但成熟路线不应该长期依赖正则和关键词做核心判断。正则可以短期兜底，但不应该是主判定层。

### 15.2 目标

成熟化目标是：把“文本里像不像完成了”改成“运行时结构化声明了什么、证据支持到什么程度、还缺什么动作”。

具体目标：

1. 默认路径轻：普通解释、方案讨论、只读分析不触发重型补证据和重答。
2. 高风险严格：文件修改、测试通过、构建通过、外部事实、git 操作、workflow/agent 状态等必须有结构化 evidence 支撑。
3. 可解释：被拦截时说明缺哪类证据，而不是只说“匹配到高风险短语”。
4. 可测试：每类 claim 都有稳定 fixture，不靠改一串关键词碰运气。
5. 可迁移：保留旧正则作为过渡兜底，逐步降低权重，最后只留安全兜底和兼容层。

### 15.3 不做事项

以下事项先不进入本轮实现：

- 不改 `preflight` / `tool-result-budget` 主链路。
- 不新增 preflight 性能计数作为本轮代码改动。
- 不删除 final answer gate、evidence runtime、verification runner。
- 不把反幻觉降级成纯模型自觉判断。
- 不引入新的长期数据库、agent、外部服务或复杂策略引擎。

`preflight` 和 `tool-result-budget` 当前先作为边界能力保留。若后续要优化，也应先基于真实耗时和触发率再做，不在这轮方案里抢先改。

### 15.4 核心方案：结构化 Claim Contract

新增一层轻量结构化 claim contract，用运行时事件表达最终回答里的高风险承诺。

建议字段：

```ts
type FinalAnswerClaim = {
  kind:
    | "file_change"
    | "test_result"
    | "build_result"
    | "lint_result"
    | "typecheck_result"
    | "external_fact"
    | "git_operation"
    | "workflow_status"
    | "agent_status"
    | "architecture_decision"
    | "completion";
  phrase: string;
  evidenceRequired: EvidenceKind[];
  evidenceRefs: string[];
  confidence: "explicit" | "inferred" | "fallback";
  source: "tool" | "runtime" | "assistant_final" | "legacy_text_match";
};
```

关键点：

- 工具执行成功时直接产出结构化 claim seed，例如 test/build/lint/typecheck/git/workflow/agent。
- 最终回答只允许引用已有 claim seed；缺 seed 时只能表达为“未验证”或“未执行”。
- 文本匹配只作为 `legacy_text_match` fallback，不能直接等同于完成事实。
- final gate 检查 claim contract 与 evidenceRefs，而不是主判定靠关键词。

### 15.5 Evidence 与 Claim 的关系

当前 evidence runtime 已经能记录工具输出、文件读取、grep、verification 等证据。成熟化不是重写 evidence，而是补上 claim 与 evidence 的绑定层。

建议规则：

- `file_change` 必须绑定 Write/Edit/MultiEdit/WriteReport/Diff 相关证据。
- `test_result` 必须绑定 verification runner 或明确测试命令输出。
- `build_result`、`lint_result`、`typecheck_result` 必须绑定对应 runner/命令输出。
- `external_fact` 必须绑定 WebSearch/WebFetch 或标记 unverified。
- `git_operation` 必须绑定受控 git 工具或明确命令输出。
- `workflow_status`、`agent_status` 必须绑定 workflow/agent runtime 证据。
- `completion` 不能单独作为通过依据，必须由具体 claim 组合推出。

这样可以避免“说了已完成”触发一堆补救逻辑，也避免“没证据却听起来很确定”。

### 15.6 Final Gate 调整方向

final answer gate 建议从“文本高风险短语触发”调整为三层：

1. 结构化 claim gate：优先检查本轮 runtime claim contract。
2. Evidence binding gate：检查 claim 所需 evidence 是否齐全。
3. Legacy text fallback：只在没有结构化 claim、但文本明显包含高风险完成断言时触发。

触发策略：

- 有结构化 claim 且证据齐全：放行。
- 有结构化 claim 但证据不足：要求改写为未验证，或执行最小补证据动作。
- 无结构化 claim 且只是方案/解释：不触发补证据。
- 无结构化 claim 但有强完成断言：走 legacy fallback，提示补证据或降级措辞。

### 15.7 Meta-Scheduler 调整方向

meta-scheduler 当前可以继续做任务域粗分，但不应靠关键词决定最终验证事实。

建议拆分：

- Intent classification：可以继续轻量、保守，用于决定是否建议工具。
- Claim validation：必须走 claim contract + evidence binding。
- Verification planning：根据 changed files、claim kind、用户目标和已有 evidence 决定最小验证。

这样 scheduler 只负责“下一步建议”，不负责“事实是否成立”。

### 15.8 Natural Command 调整方向

natural command 的成熟路线是命令契约优先：每个 capability 明确 action、risk、side effects、required confirmation。

建议规则：

- 查看类 capability 单独注册，risk 为 readonly。
- 执行类 capability 单独注册，risk 按真实副作用标注。
- 自然语言匹配只产生 candidate，不直接跳过权限和确认。
- capability 描述不能同时写“查看或执行”这类混合意图。

这部分可以先从 compact 修复开始落地：`compact-status` 和 `compact-run` 拆分，作为后续命令成熟化样板。

### 15.9 与阶段任务的对应关系

反幻觉成熟化不单独开第二套实施编号，统一并入第 12 节阶段任务：

- 原 Phase A“契约和测试先行”对应第 12 节 Phase 5。
- 原 Phase B“工具结果产出 claim seed”对应第 12 节 Phase 6。
- 原 Phase C“final gate 改为 contract-first”对应第 12 节 Phase 7。
- 原 Phase D“逐步收敛旧正则”并入第 12 节 Phase 7。

执行顺序上，建议先完成 compact 的 Phase 1-4，再进入反幻觉的 Phase 5-7。原因是 compact 修复能作为 capability 拆分、权限真实化、输出降噪的第一批样板；样板稳定后，再把同样的契约化思路推广到 final gate 和 evidence binding。

### 15.10 验收标准

成熟化完成后应满足：

- 普通方案讨论不会因为出现“完成、修复、验证”等词自动触发重型补证据。
- 真正声明“测试通过 / 构建通过 / 已修改文件 / 已提交”等事实时，必须有结构化 evidence。
- final gate 的拦截原因能指出缺少的 evidence kind。
- legacy 正则只作为兜底路径，不能成为主判定路径。
- compact 命令修复能作为 capability 拆分和权限真实化的第一批落地样板。
- `preflight` / `tool-result-budget` 在本阶段保持不动，后续只基于实测数据讨论是否优化。
