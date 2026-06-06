# Phase 7.14 Capability Runtime / App Bridge MVP

## 阶段目标

建立一个通用、轻量、可扩展的 Capability Runtime，把外部 app / MCP / plugin / desktop bridge / local HTTP 的能力统一归一为 Linghun 可调度能力。

本阶段只做 MVP 薄桥、mock provider、显式 `/capabilities` 入口和 Policy Kernel 信号；不连接真实第三方软件，不做桌面 UI、Computer Use、后台软件扫描、生态市场或每个软件专属适配。

## Source-Level Reality Check

### 实际读取的文件

- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-07-6-policy-kernel-mvp.md`
- `docs/delivery/phase-07-7-policy-kernel-coverage-closure.md`
- `docs/delivery/phase-07-8-policy-kernel-active-signal-consumption.md`
- `docs/delivery/phase-07-10-visible-layer-tool-observation-closure.md`
- `docs/delivery/phase-07-11-task-job-verification-routing-closure.md`
- `docs/delivery/phase-07-12-task-background-job-ux-maturity.md`
- `docs/delivery/phase-07-13-user-state-routing-policy-kernel.md`
- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/model-tool-runtime.ts`
- `packages/tui/src/deferred-tools-catalog.ts`
- `packages/tui/src/permission-policy-engine.ts`
- `packages/tui/src/evidence-runtime.ts`
- `packages/tui/src/tool-result-budget.ts`
- `packages/tui/src/command-panel-runtime.ts`
- `packages/tui/src/details-status-runtime.ts`
- `packages/tui/src/tui-context-runtime.ts`
- `packages/tui/src/index.test.ts`

codebase-memory 项目 `F-Linghun` 的 MCP 工具本轮未暴露；已按项目规则降级为 `rg` 与源码精读。多智能体仅做只读分析，未改文件。

### Existing implementation

- `meta-scheduler-runtime.ts` 已有 typed `PolicyDecision`、`UserStateDecision`、domain-aware verification route、低噪 policy hints。
- `index.ts` 的 `handleSlashCommand()` 是真实 slash dispatch 入口；`natural-command-bridge.ts` 是 catalog / help / natural intent 摘要，不直接执行。
- `command-panel-runtime.ts` 已有 summary-first panel 与 detailsText 分层。
- `evidence-runtime.ts` 已有 `createEvidenceRecord()` / `rememberEvidence()` / system event 写入。
- `tool-result-budget.ts` 已有大输出 artifact/ref 预算机制。
- `model-prompt-runtime.ts` 已有主屏内部字段 sanitizer。

### Gaps

- 没有 CapabilityDefinition / Provider / Transport / Auth / Permission / request / result 类型。
- 没有统一的 capability registry、resolver、mock provider、doctor 或显式用户入口。
- Policy Kernel 不能识别外部 app/capability route。
- Sanitizer 未覆盖 capability request/result/plan/raw payload 标签。

### Minimal touch points

- `packages/tui/src/capability-runtime.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/tui-context-runtime.ts`
- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- focused tests 和本交付文档

### Forbidden duplicate systems

- 未新增第二套 scheduler、Policy Kernel、permission engine、evidence runtime、verification runner、provider breaker、workflow/job/agent gate。
- 未新增 App Agent、桌面控制器、后台扫描器、真实 connector runtime。
- 未绕过 `decidePermission()`、final answer gate、verification gate、workflow/job/agent gate。
- 未触碰 `WHITEPAPER*.md`、`docs/stress`、`img`、`report.md`、`test-model-set.sh`、DH1-DH4。

## 已完成功能

- 新增 `packages/tui/src/capability-runtime.ts`。
- 定义核心类型：
  - `CapabilityDefinition`
  - `CapabilityProvider`
  - `CapabilityTransport`
  - `CapabilityAuth`
  - `CapabilityPermission`
  - `CapabilityExecutionRequest`
  - `CapabilityExecutionResult`
- 实现核心接口：
  - `registerCapability()`
  - `listCapabilities()`
  - `findCapability()`
  - `resolveCapabilityConnection()`
  - `executeCapability()`
  - `formatCapabilityDoctor()`
- 支持 transport 类型：`mock`、`mcp`、`plugin`、`desktop_bridge`、`http`、`websocket`。
- MVP 仅 `mock` provider 真执行；其他 transport 只进入 doctor 的未连接/待配置状态。
- 新增 mock capabilities：
  - `mock.echo.read`
  - `mock.canvas.create`
  - `mock.canvas.export`
- 新增显式 slash：
  - `/capabilities list`
  - `/capabilities doctor`
  - `/capabilities run <capabilityId> <json>`
- `/capabilities` 已加入 `SLASH_COMMAND_REGISTRY` 和 `USER_VISIBLE_DISPATCH_SLASH_COMMANDS`，受现有 catalog drift test 约束。
- Policy Kernel 新增 `CapabilityPlan`、`capabilitySignal`、`capabilityPlan`，识别外部软件/app/plugin/画图/表格/连接应用/capability 语义。
- capability route 的优先级低于 workflow/job/agent；用户提到 agent/job/workflow 时不抢原 route。
- 主屏 sanitizer 过滤 capability request/result/plan/raw payload 内部字段。

## 使用方式

```text
/capabilities list
/capabilities doctor
/capabilities run mock.echo.read {"text":"hello"}
/capabilities run mock.canvas.create {"title":"draft canvas"}
/capabilities run mock.canvas.export {"format":"png"}
```

## 涉及模块

- `packages/tui/src/capability-runtime.ts`
- `packages/tui/src/capability-runtime.test.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/meta-scheduler-runtime.ts`
- `packages/tui/src/meta-scheduler-runtime.test.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/model-prompt-runtime.test.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/tui-context-runtime.ts`
- `docs/delivery/README.md`

## 关键设计

- Capability Runtime 是薄桥，不是新中枢。
- Capability 执行前做最小 schema required 校验。
- `read` capability 映射现有 `Read` 权限语义；`external_app` / `write` 映射现有 `Write` 权限语义；不新增第五种权限模式。
- 执行结果只返回 summary/ref/metadata；不返回 raw payload。
- 大输出复用 `tool-result-budget` artifact/ref 机制，证据只保留 summary/source/ref/supportsClaims。
- capability completed 只说明 capability 执行完成，不等于 verification PASS。
- rollbackRef / previewRef / artifactRef 只作为 metadata/ref，不作为 PASS evidence。
- `/capabilities` 输出走现有 CommandPanel summary/details 分层。

## 配置项

无新增配置项。

## 命令

- `/capabilities list`
- `/capabilities doctor`
- `/capabilities run <capabilityId> <json>`

## 测试与验证

已运行：

- `corepack pnpm --filter @linghun/tui typecheck` → PASS
- `corepack pnpm exec vitest run packages/tui/src/capability-runtime.test.ts packages/tui/src/meta-scheduler-runtime.test.ts packages/tui/src/model-prompt-runtime.test.ts --no-color` → PASS, 54/54
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "Capability|capability|capabilities|App Bridge|external app|mock.canvas|mock.echo|permission|evidence|artifact|rollback|Policy|Strategy|策略" --no-color` → PASS, 104 selected / 547 skipped
- `corepack pnpm exec biome check packages/tui/src/capability-runtime.ts packages/tui/src/capability-runtime.test.ts packages/tui/src/meta-scheduler-runtime.ts packages/tui/src/model-prompt-runtime.ts packages/tui/src/model-prompt-runtime.test.ts packages/tui/src/natural-command-bridge.ts packages/tui/src/tui-context-runtime.ts packages/tui/src/index.ts packages/tui/src/index.test.ts` → PASS
- `corepack pnpm exec biome check packages/tui/src/meta-scheduler-runtime.ts packages/tui/src/model-stream-runtime.ts packages/tui/src/model-tool-runtime.ts packages/tui/src/model-prompt-runtime.ts packages/tui/src/index.test.ts packages/tui/src/capability-runtime.ts packages/tui/src/capability-runtime.test.ts packages/tui/src/meta-scheduler-runtime.test.ts packages/tui/src/model-prompt-runtime.test.ts packages/tui/src/natural-command-bridge.ts packages/tui/src/tui-context-runtime.ts` → PASS
- `corepack pnpm --filter @linghun/tui build` → PASS
- `corepack pnpm --filter @linghun/cli build` → PASS
- `git diff --check` → PASS

## 性能结果

- Registry/list/find 为内存 Map 和数组排序，不读文件、不联网。
- resolver 是按需函数，不做后台常驻扫描。
- mock provider 仅本地同步/轻量异步执行；`mock.canvas.export` 的大输出落 artifact/ref。
- 未新增 provider/model token 消耗。

## 已知问题

- 非 mock transport 只展示 doctor 状态，不能真实连接。
- `inputSchema` MVP 只检查 required 字段，不做完整 JSON Schema 校验。
- Capability route 是保守规则识别，不是完整语义搜索。
- `/capabilities run` 只支持 mock capability id，不支持真实 MCP/plugin/desktop bridge/http/websocket 执行。

## 不在本阶段处理的内容

- 不真实连接第三方软件。
- 不做 Computer Use 截图控制。
- 不做后台软件扫描。
- 不做新的 App Agent 或第二套 scheduler。
- 不把 MCP/plugin/desktop bridge 分别做成独立调度链。
- 不打开自动执行高风险外部能力。
- 不存储 raw key。
- 不把完整 app state/raw output 写进 transcript。
- 不进入 Phase 7.15。
- 不声明 Beta PASS、smoke-ready、open-source-ready。

## 下一阶段衔接

阶段完成后停止在用户审核点。是否建立 focused/local 稳定点或进入后续阶段，必须由用户明确确认。

## 开发者排查入口

- Capability 类型、registry、mock provider、doctor：`packages/tui/src/capability-runtime.ts`
- Slash 接线：`packages/tui/src/index.ts`
- Catalog / drift 约束：`packages/tui/src/natural-command-bridge.ts`、`packages/tui/src/tui-context-runtime.ts`
- Policy route：`packages/tui/src/meta-scheduler-runtime.ts`
- 主屏 sanitizer：`packages/tui/src/model-prompt-runtime.ts`
- Evidence / budget 边界：`packages/tui/src/evidence-runtime.ts`、`packages/tui/src/tool-result-budget.ts`

## 参考核对

- 本阶段实际读取了前述 Linghun 文档和源码。
- CCB / CCB Dev Boost 只作为行为边界参考：外部能力归一、低噪主屏、权限先行、details 分层、大输出 artifact/ref、完成不等于 PASS。
- 进入 Linghun 的实现是自研 Capability Runtime MVP、mock provider、policy signal、slash 入口和 sanitizer 过滤。
- 未复制 CCB 源码、内部 API、专有遥测或反编译痕迹。

## 成品级结构化 handoff packet

- phase: `Phase 7.14 Capability Runtime / App Bridge MVP`
- verdict: `focused/local validation complete`
- nextPhase: `等待用户确认；不得自动进入 Phase 7.15`
- completed:
  - `CapabilityDefinition` / `CapabilityProvider` / transport/auth/permission/request/result 类型
  - registry/list/find/resolver/execute/doctor
  - mock provider 三个能力
  - `/capabilities list/doctor/run`
  - Policy Kernel capability signal
  - sanitizer capability 内部字段过滤
  - focused tests 覆盖注册、mock 执行、权限、artifact、doctor、policy、slash 和 sanitizer
- mustNotDo:
  - 不真实连接第三方软件
  - 不新增第二套 scheduler/permission/evidence/verification/job/agent gate
  - 不绕过 SearchExtraTools/ExecuteExtraTool discovery gate
  - 不把 raw payload/raw app state 写进 prompt 或 transcript
  - 不触碰禁止文件
  - 不声明 Beta PASS / smoke-ready / open-source-ready
- evidence:
  - `packages/tui/src/capability-runtime.test.ts`
  - `packages/tui/src/meta-scheduler-runtime.test.ts`
  - `packages/tui/src/model-prompt-runtime.test.ts`
  - `packages/tui/src/index.test.ts`
- validation:
  - typecheck PASS
  - capability/meta/prompt focused tests PASS
  - selected index regression PASS
  - biome touched files PASS
  - tui build PASS
  - cli build PASS
  - git diff --check PASS
- indexStatus: codebase-memory MCP 不可用；未 refresh/rebuild。
- permissionMode: 本地代码编辑；未修改 Linghun runtime 权限默认值。
- providerModel: 未修改 provider/model/key/env route。
- budgetUsage: 未新增 provider/model token 消耗；仅本地测试和文件验证。
- userReviewPoint: 审阅 diff 和本交付文档，决定是否建立 focused/local 稳定点。
