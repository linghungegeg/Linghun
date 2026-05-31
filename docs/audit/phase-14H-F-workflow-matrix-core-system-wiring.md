# D.14H-F: Workflow Matrix Core-System Wiring

## 目标

把 Workflow Plan 从"计划预览 + agent/job proposal"升级成围绕 Linghun 核心系统的调度层。只做轻量接入，不新增第二套 runtime。

## 已接入系统

| 系统 | 接入方式 | 是否可作为 PASS evidence |
|------|----------|------------------------|
| Architecture | slice-architecture-review（readonly details/evidence） | 否（preview 阶段 passEvidence=false） |
| Git Stable Point | slice-stable-point（proposal-only readonly） | 否（不执行，不 auto-commit） |
| Controlled Memory | WorkflowPlannerGoal.controlledMemoryRef → workspace_cache reference | 否（只读引用，不写 memory） |
| Self-Learning | WorkflowPlannerGoal.selfLearningHints → workspace_cache references | 否（只读引用，不写新学习） |
| Failure Learning | WorkflowPlannerGoal.failureLearningRefs → evidence kind=failure_learning | 否（passEvidence=false，PASS_BANNED） |
| Cache/Budget | cacheBudgetHint in meta + cacheFreshnessHint reference | N/A（展示字段） |
| Remote Mobile Summary | mobileSummary 含 phase/slices/approval/evidence/next/riskHintCount | N/A（展示字段） |
| Evidence/Anti-Hallucination | Evidence Merge 完整性保持 | 见下方 |

## 只是 context/proposal 的系统（不执行）

- Architecture review：只读 details/evidence slice，不创建 architecture runtime
- Git stable point：proposal-only，不 auto-commit/snapshot
- Controlled memory：只读已有 summary，不写 memory
- Self-learning：只读已确认 preference，不写新学习
- Failure learning：作为 riskHints 出现在 detailsText/nextAction，不污染主屏
- Cache/budget：展示 budgetSet/multiAgentPressure/cacheFreshnessRef，不宣称真实 hit rate

## 不能作为 PASS evidence 的 kind

- `agent_summary`
- `job_completed`
- `remote_event`
- `failure_learning`
- `memory`（不存在此 kind，memory 通过 workspace_cache reference 引用）
- `self_learning`（不存在此 kind，通过 workspace_cache reference 引用）
- architecture evidence 在 preview 阶段 passEvidence=false

## 未新增的内容

- 未新增第五权限模式（仍为 plan/default/auto-review/full-access）
- 未新增第二套 workflow runtime / scheduler / job store / agent executor / evidence gate / memory runtime
- 未自动执行 proposal
- 未自动创建 agent/job
- 未自动写文件
- 未自动创建 git commit/checkpoint
- 未自动写长期记忆
- 未恢复本地宽泛自然语言关键词截获
- 未改 provider/env/key/model route
- 未改 D.13U/D.13V final answer gate 语义
- 未碰 .claude/

## 涉及文件

| 文件 | 改动 |
|------|------|
| packages/tui/src/workflow-planner-entry.ts | WorkflowPlannerGoal 扩展 + architecture/stable-point slice + memory/learning/cache 注入 + sanitizeRefText 脱敏 |
| packages/tui/src/workflow-task-surface.ts | cacheBudgetHint + riskHintCount + Risk Hints section + mobileSummary slice counts 增强 + cacheFreshnessRef 精确匹配 |
| packages/tui/src/workflow-planner-entry.test.ts | 21 个 D.14H-F 测试（含返修补测） |

未改动：workflow-plan-schema.ts、workflow-agent-runtime-bridge.ts、natural-command-bridge.ts（已有能力足够）

## 本地验证结果

```
corepack pnpm -w run check (biome)                 ✓ 214 files, 0 errors
corepack pnpm exec tsc --noEmit                    ✓ 无错误
corepack pnpm --filter @linghun/tui exec vitest run src/workflow-*.test.ts  ✓ 86/86 pass
git diff --check                                   ✓ 无 whitespace 错误
```

## D.14H-F 返修记录

1. Biome format 3 处红点修复（destructuring / array / find callback）
2. mobileSummary 补完整 slice counts：done/running/blocked/queued
3. cacheBudgetHint.cacheFreshnessRef 改为精确匹配 ref==="cache-freshness-hint"，不误取 controlled-memory-context 或 self-learning-hint
4. 新增 sanitizeRefText 统一脱敏：local path / sk-* / Bearer / api_key / full transcript|log|source，覆盖 controlledMemoryRef.summary、selfLearningHints、failureLearningRefs.lesson/source、cacheFreshnessHint
5. 补 3 个锁定测试：cacheFreshnessRef 精确匹配、mobileSummary slice counts、failureLearningRefs 脱敏

## 未跑真实 provider/TTY smoke 的边界

- 未跑真实 provider smoke（无 API key 调用）
- 未跑真实 TTY smoke（无终端交互验证）
- 未跑真实 remote webhook smoke
- 真实压测由另一个窗口后续执行

## 未 commit

本轮改动未 commit，停在阶段边界等待用户确认。

## 自然语言路由验证

以下短语仍正确路由到 workflow plan：
- `工作流计划 帮我拆分实现一个缓存命中率报告功能`
- `请生成工作流计划：实现缓存命中率报告`
- `workflow plan add a cache hit rate report`

## Evidence Merge 完整性

- proposal-only / start_gate_needed / blocked request 存在时，overall verdict 不得为 PASS
- architecture evidence preview 阶段 passEvidence=false → verdict=PARTIAL
- failure_learning 始终 PASS_BANNED → verdict=PARTIAL，reason 含 "context/status only"
- 空 evidence refs → verdict=BLOCKED

## 参考核对

- 本阶段实际读取：CLAUDE.md、workflow-plan-schema.ts、workflow-planner-entry.ts、workflow-agent-runtime-bridge.ts、workflow-task-surface.ts 及对应测试
- 本阶段参考：Linghun 现有 architecture-boundary、failure-learning-runtime、git-tool-runtime、cache-freshness、memory-command-runtime 的接口设计
- 所有内容为 Linghun 自研实现，未复制可疑源码
