# Linghun Closure Phased Tasks

本文件整理两轮只读架构审计后的阶段性收尾任务。目标不是拆大文件、不是降级功能、不是重构架构，而是把已经暴露的未闭环/中间态/成熟度不足问题按阶段一次性收口。

## Scope Rules

- 不拆 `job-agent-command-runtime.ts`、`model-stream-runtime.ts`、`model-tool-runtime.ts`、`workflow-command-runtime.ts`、`index.ts` 等大文件。
- 不降低已有能力；高级能力保留，默认体验变轻、状态变清楚。
- 自动 memory 持久写入保留为产品能力，本计划不把它列为整改项。
- 每个阶段必须有用户可见闭环、源码验证入口和回归验证。
- 阶段内只处理本阶段明确问题，不顺手扩展。

## Phase 1 - Trust Boundary Closure

目标：先收口会影响用户信任和安全边界的 P0 项。

任务：

1. 收口 `/rewind` / checkpoint。
   - checkpoint 内容不能只依赖当前进程内存。
   - session resume 后应能明确知道 checkpoint 是否可恢复。
   - 多文件 restore 权限不能只检查首个 changed file。

2. 收口取消/中断语义。
   - 区分 `abort signal sent`、`marked stale`、`confirmed exited`。
   - `/interrupt`、单任务 stop、verification、job、agent、workflow 的状态文案保持一致。
   - 用户不能把 stale/partial 误解成进程已真实退出。

3. 收口 `auto-review` 自动写入边界。
   - 保留 auto-review 的轻使用能力。
   - 明确 Write/MultiEdit/Edit 自动放行条件。
   - medium 风险写入不能被误归类成普通低风险路径。

4. 收口 `/index init/refresh` 权限门。
   - 不只依赖 `index.ts` slash route 拦截。
   - `mcp-index-runtime` 内部直接调用也必须保持权限/资源守卫语义。

5. 收口恢复/损坏状态可见性。
   - session metadata 损坏、JSONL diagnostics、durable job state 损坏不能静默等同于不存在。
   - resume/hydrate 后需要给用户明确诊断。

验收：

- 关键恢复/取消/权限拒绝路径有 focused tests。
- P0 任一路径失败时，用户能看到明确状态和下一步。
- 不新增大模块拆分。

## Phase 2 - Task Surface Closure

目标：让底层状态在 Task 区轻量、准确、可见。

任务：

1. 渲染 `taskRuntimeSummary` 或移除死投影。
   - 后台失败、取消、完成、stale、blocked 需要在默认 Task 面有轻量入口。
   - 不刷屏，不把完整日志塞进主屏。

2. 验证结果 Task 化。
   - `/verify` 的 PASS/FAIL/PARTIAL/CANCELLED/TIMEOUT/STALE 要有明确状态块。
   - evidence 仍在底层保留，主面只显示结论和下一步。

3. 权限拒绝/取消反馈补足。
   - 权限卡保持轻，但拒绝/取消后的结果、原因、下一步要稳定可见。
   - details 路径可展开审计细节。

4. Plain/Ink Task footer 对齐。
   - permission、model、cache、index、reasoning、context、cost 等信号不应在不同渲染模式下语义漂移。

验收：

- Task 主面能看懂后台任务、验证、权限三类状态。
- CommandPanel 仍作为详细入口，不替代主面状态。
- 不降低现有 details/debug 能力。

## Phase 3 - Agent / Job / Workflow Runtime Closure

目标：让多智能体、job、workflow 的调度、证据和状态语义更成熟。

任务：

1. 统一 background cap 语义。
   - 明确 agent/job 是否计入全局 cap。
   - workflow/job 内部 cap 和全局 cap 不应互相矛盾。

2. 收口 workflow 状态映射。
   - blocked、failed、partial、cancelled 在 workflow 和 background task 中语义一致。
   - 用户排查时不能把受阻误解成失败。

3. 补 agent evidence 粒度。
   - 子工具成功/失败 evidence 与父级会话可追踪。
   - final answer guard 可引用到足够细的 agent 执行证据。

4. 补核心执行闭环测试。
   - `runDurableJobLiteTick`、`resumeDurableJob`、`recoverDurableJobForContext`、`interruptAllActiveWork` 需要更直接的回归覆盖。

验收：

- agent/job/workflow 失败、取消、恢复都能形成明确用户状态和 evidence。
- cap 拒绝是 resource/concurrency cap，不混成 permission denial。
- 不新增第二套 runner 或 workflow 系统。

## Phase 4 - Daily Path Lightening

目标：保留重底座，但普通问答、只读查询、小改动路径更轻、更快、更可预测。

任务：

1. 普通问答轻路径。
   - workspace-reference 扫描、compact preflight、memory learning 的触发成本要可解释。
   - 不必要时不阻断普通请求。

2. Deep compact 可取消和可见。
   - 上下文压力区的 deep compact 需要接入中断语义。
   - 失败时给出明确原因，不让用户误以为主模型请求无响应。

3. 只读查询轻路径。
   - 保留 readonly auto-allow。
   - 权限分类漏判时保持保守，不直接扩大 shell 执行面。

4. 小改动路径轻而稳。
   - 保留 auto-review 轻编辑能力。
   - 小改动仍要有 read-before-edit、diff/evidence、可回滚信号。

验收：

- 普通问答不会因为后台底座动作显著变得不可预测。
- 用户能区分“正在思考”“正在压缩上下文”“正在跑工具”“被资源上限挡住”。
- 不关闭 index/memory/cache/compact 能力。

## Phase 5 - Local Hardcoded Policy Cleanup

目标：只清理会影响行为稳定的硬编码，不做大拆。

任务：

1. 对齐 verification timeout 常量来源。
2. 审查 background cap、workspace-reference limits、CommandPanel rows/width 是否需要配置化或集中常量。
3. 明确模型/provider 默认路由和 unknown model tools 支持策略。
4. 明确 index artifact 路径与 storage 配置关系。
5. 修正文案/标签类不一致，例如 status/footer/index labels。

验收：

- 行为阈值有明确来源。
- 不为配置化而配置化。
- 不触碰大文件结构拆分。

## Out Of Scope

- 大文件拆分。
- 重写 provider、runner、workflow、agent 系统。
- 关闭自动 memory。
- 关闭索引、缓存、compact、verification、agent/workflow 高级能力。
- 为了美观做 UI 大改。

## Final Maturity Target

收尾完成后的形态应是：底层安全、权限、证据、恢复、验证仍然强；用户层默认轻、状态清楚、失败可解释、任务可取消、会话可恢复。也就是重底座，但轻学习、轻使用。
