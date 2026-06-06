# Phase 7.11 Task / Job Verification Routing Closure

## 阶段目标

Phase 7.11 完成 Task/Job Scheduling Reality Reconciliation + Domain-aware Verification Routing Closure：先用源码事实裁决 Phase 17A local durable jobs 的 pending/done 冲突，再在现有 Policy Kernel / Meta Scheduler / Verification Runner / Evidence / Final Answer Gate 上补齐任务域验证路由和 no-PASS 边界。

本阶段不新增第二套 job scheduler、agent runtime、workflow runtime、verification runner 或 policy runtime；不重写 `/job`、`/agents`、`/workflows`、`/verify`；不进入 Phase 17B/18、真实 full smoke、Beta PASS、smoke-ready 或 open-source-ready。

## Source-Level Reality Check

### Existing implementation

- `packages/tui/src/job-agent-command-runtime.ts` 已有 `/job list|run|create|status|logs|report|pause|resume|cancel`、handoff validation、durable job hydrate/recovery、bounded worker loop 和 job background task 写回。
- `packages/tui/src/job-runtime.ts` / `packages/tui/src/tui-data-types.ts` 已有 `DurableJobState`、`DurableJobStatus`、agent cap、budget、timeout、stale、state/log/report/full-output 路径。
- `packages/tui/src/tui-agent-job-runtime.ts` / `packages/tui/src/job-runner-presenter.ts` 已将 durable job 复用到统一 `BackgroundTaskState`；job completed 映射为 lifecycle completed + result partial，不是 PASS。
- `packages/tui/src/workflow-command-runtime.ts` 已把 workflow completed 收口为 `result="partial"`，并提示 review verification evidence；blocked/stale/cancelled 不生成 PASS。
- `packages/tui/src/verification-command-runtime.ts` 已有 `/verify` plan/run/log/background/evidence 路径，支持 `pass/fail/partial/cancelled/timeout/stale`。
- `packages/tui/src/meta-scheduler-runtime.ts` 已有 typed `PolicyDecision`、failure learning、verification/final gate、index strategy、resource/background occupancy 和 agent/workflow blocked stop。

### Gaps closed

- README Phase 17 状态冲突已裁决：Phase 17A local durable jobs 事实为 done/focused-local validation；原 Phase 17 总行 pending 不再作为 17A durable job 基础能力未完成的证据。
- `PolicyDecision.verificationSignal.route` 新增 domain-aware route，覆盖 code_change、documentation、tui_interactive、provider_model_config、agent_job_workflow、general。
- Meta Scheduler 统一消费 job/workflow/agent runtime state、last verification、failure learning、resource guard pressure 和 verification evidence freshness，生成 conservative/no-pass route。
- `recordVerificationEvidence()` 按实际通过命令写入 scoped claims：`test_passed`、`typecheck_passed`、`build_passed`、`lint_passed`、`smoke_passed`；synthetic smoke 只写 `smoke_ran`，不支撑 tests passed。
- `RunVerification` control-tool evidence 不再写泛化 `verified/已验证`，真实 PASS 仍由 `/verify` report/evidence 支撑。
- 主屏 sanitizer 增加 `Verification route` 内部标签过滤；主屏继续只显示轻提示/摘要，不泄漏 raw scheduler/evidence/tool_result/gateId。

### Minimal touch points

- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/evidence-runtime.ts`
- `packages/tui/src/model-tool-runtime.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/meta-scheduler-runtime.test.ts`
- `packages/tui/src/verification-command-runtime.test.ts`
- `packages/tui/src/index.test.ts`
- `docs/delivery/README.md`
- `docs/delivery/phase-07-11-task-job-verification-routing-closure.md`

### Forbidden duplicate systems

- 未新增第二套 provider/tool/permission/evidence/MCP/index/agent/job/workflow/verification/policy runtime。
- 未复制 CCB 源码、内部 API、专有遥测或反编译痕迹。
- 未修改 provider/model/key/env route。
- 未处理 DH1-DH4、WHITEPAPER、docs/stress、img、report.md、test-model-set.sh。

## 已完成功能

- Domain-aware verification routing：
  - code change：typecheck/test/lint/build/diff
  - docs：markdown/link/frontmatter/sensitive-path/consistency
  - TUI/interactive：focused TUI tests/build/CLI smoke
  - provider/model/config：doctor/provider smoke/config isolation
  - agent/job/workflow：background/job/agent/workflow state + no-PASS-without-verification
- conservative/no-pass route：stale、blocked、cancelled、timeout、completed-without-fresh-verification、active failure learning、resource guard pressure 都不能支撑 PASS。
- Verification evidence scope：真实命令通过才写对应 pass claim；synthetic smoke 不再升级为 test PASS。
- README 状态纠偏：Phase 17A durable jobs 单独标为 done/focused-local validation only。

## 使用方式

无新增用户命令。现有入口继续使用：

```text
/verify
/verify last
/job status <jobId>
/job report <jobId>
/agents
/workflows status
/background
/details background <id>
```

## 涉及模块

- Meta Scheduler / Policy Kernel：`packages/tui/src/meta-scheduler-runtime.ts`
- Evidence：`packages/tui/src/evidence-runtime.ts`
- Model tool evidence：`packages/tui/src/model-tool-runtime.ts`
- Main-screen sanitizer：`packages/tui/src/model-prompt-runtime.ts`
- Focused tests：`packages/tui/src/meta-scheduler-runtime.test.ts`、`packages/tui/src/verification-command-runtime.test.ts`、`packages/tui/src/index.test.ts`
- Delivery docs：`docs/delivery/README.md`、本文件

## 关键设计

- Route 是 typed decision，不是新 runner。它只告诉现有 `/verify`、doctor、background/details/final gate 应该看哪些证据，不执行第二套验证。
- job/workflow/agent completed 只是 lifecycle signal；只有 verification evidence 能支撑“已验证/可提交/可发布”类声明。
- Evidence freshness 默认 30 分钟窗口；过期或缺失证据进入 conservative/no-pass。
- Failure learning 仍是风险提示，不进入 PASS evidence。
- 主屏只呈现轻提示，内部 route/directive/raw evidence 继续留在 system event、transcript 或 details。

## 配置项

无新增配置项。

## 命令

无新增命令。

## 测试与验证

最终验证矩阵：

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui typecheck` | PASS |
| `corepack pnpm exec vitest run packages/tui/src/meta-scheduler-runtime.test.ts packages/tui/src/verification-command-runtime.test.ts packages/tui/src/workflow-task-surface.test.ts --no-color` | PASS: 3 files, 54 tests |
| `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "job\|agent\|workflow\|verification\|Policy\|MetaScheduler\|final answer\|PASS\|stale\|blocked\|cancelled\|timeout" --no-color` | PASS: 1 file, 148 passed, 498 skipped |
| `corepack pnpm exec biome check packages/tui/src/meta-scheduler-runtime.ts packages/tui/src/evidence-runtime.ts packages/tui/src/model-tool-runtime.ts packages/tui/src/model-prompt-runtime.ts packages/tui/src/meta-scheduler-runtime.test.ts packages/tui/src/verification-command-runtime.test.ts packages/tui/src/index.test.ts` | PASS |
| `corepack pnpm --filter @linghun/tui build` | PASS |
| `corepack pnpm --filter @linghun/cli build` | PASS |

## 性能结果

Meta Scheduler 新增逻辑仍为纯同步字符串/数组判断，不扫描文件、不调用 provider、不访问网络。Evidence scope 派生只遍历当前 verification report 的 commands，成本与验证步骤数线性相关。

## 已知问题

- Domain route 只做轻量任务域识别，不是完整自然语言 planner。
- 文档/link/frontmatter/doctor/provider smoke 等路线目前是策略层 route，不新增执行器；实际执行仍复用现有命令和项目脚本。
- 本阶段 focused/local validation 不代表真实 full smoke、Beta PASS、smoke-ready 或 open-source-ready。

## 不在本阶段处理的内容

- Phase 17B remote channels。
- Phase 18 desktop。
- Native runner/supervisor runtime 改造。
- Provider/model/key/env route。
- DH1-DH4、WHITEPAPER、docs/stress、img、report.md、test-model-set.sh。

## 下一阶段衔接

阶段完成后停止。是否进入下一阶段、是否建立稳定点、是否继续 Phase 17B/18 或真实 full smoke，必须由用户另行确认。

## 开发者排查入口

- Verification route：`packages/tui/src/meta-scheduler-runtime.ts`
- Verification evidence scope：`packages/tui/src/evidence-runtime.ts`
- `/verify` runner：`packages/tui/src/verification-command-runtime.ts`
- Final answer claim gate：`packages/tui/src/model-loop-runtime.ts`
- Durable job state：`packages/tui/src/job-runtime.ts`、`packages/tui/src/job-agent-command-runtime.ts`
- Workflow state：`packages/tui/src/workflow-command-runtime.ts`

## 参考核对

### 实际读取的 Linghun 文档

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-17a-local-durable-jobs-virtual-agent-concurrency.md`
- `docs/delivery/phase-17-agent-workflow-ecosystem-closure.md`
- `docs/delivery/phase-04-workflow-multi-agent-scheduler-closure.md`
- `docs/delivery/phase-15-5b-resource-task-lifecycle.md`
- `docs/delivery/phase-17-meta-scheduler-closure.md`
- `docs/delivery/phase-07-10-visible-layer-tool-observation-closure.md`

### 实际参考的 Linghun 源码

- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/verification-command-runtime.ts`
- `packages/tui/src/evidence-runtime.ts`
- `packages/tui/src/model-tool-runtime.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/job-runtime.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/workflow-command-runtime.ts`
- `packages/tui/src/tui-data-types.ts`

### CCB / CCB Dev Boost 参考边界

只把 CCB 作为行为成熟度参考：task 状态清晰、验证路线明确、主屏低噪、后台可恢复/可解释。进入 Linghun 的内容为自研 typed route、scoped evidence 和 no-PASS policy；未复制 CCB 源码、内部 API、专有遥测或反编译痕迹。

## 成品级结构化 handoff packet

- nextPhase: user decision required before any next phase.
- status: Phase 7.11 implemented; required focused/local validation passed.
- changedFiles:
  - `packages/tui/src/meta-scheduler-runtime.ts`
  - `packages/tui/src/evidence-runtime.ts`
  - `packages/tui/src/model-tool-runtime.ts`
  - `packages/tui/src/model-prompt-runtime.ts`
  - `packages/tui/src/meta-scheduler-runtime.test.ts`
  - `packages/tui/src/verification-command-runtime.test.ts`
  - `packages/tui/src/index.test.ts`
  - `docs/delivery/README.md`
  - `docs/delivery/phase-07-11-task-job-verification-routing-closure.md`
- mustNotDo:
  - do not add duplicate job/agent/workflow/verification/policy runtime
  - do not claim Phase 17B / Phase 18 / real full smoke / Beta PASS / smoke-ready / open-source-ready
  - do not treat completed lifecycle states as verification PASS
  - do not alter provider/model/key/env route
- evidenceRefs:
  - `packages/tui/src/meta-scheduler-runtime.test.ts`
  - `packages/tui/src/verification-command-runtime.test.ts`
  - `docs/delivery/phase-17a-local-durable-jobs-virtual-agent-concurrency.md`
- verification:
  - focused route/evidence tests: PASS
  - filtered index policy/gate regression: PASS
  - typecheck: PASS
  - biome touched TS/test files: PASS
  - tui build: PASS
  - cli build: PASS
- indexStatus:
  - codebase-memory tool unavailable in this turn; source facts verified by targeted `rg` and source reads.
- permissionMode:
  - local default; no permission pipeline bypass.
- providerModel:
  - no live provider/model calls.
- budgetUsage:
  - local shell/test/build only; no live provider token spend.
