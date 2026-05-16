# Phase 13：多模型协作闭环

## 阶段目标

完成 Linghun Phase 13 多模型协作闭环：在 Phase 12 Agent 生命周期基础上，新增按角色的模型路由、路由诊断与设置入口、agent 与角色路由联动、受限角色 handoff、按 role/model/provider 的最小 usage 可见、vision / image 能力降级与最小闭环。

本阶段只实现 Phase 13，不进入 Phase 14+；不实现 Skills、Workflows、Hooks、Plugins、真实项目 Beta、长期任务、自动会话、Remote Channels、桌面端或默认多模型扇出。

## 已完成功能

- 多模型角色路由结构：
  - 新增 `ModelRole`：`planner`、`executor`、`reviewer`、`verifier`、`summarizer`、`vision`、`image`。
  - 新增 `ModelCapability`、`RoleModelRoute`、`ModelRouteConfig`。
  - 每个 role 记录 provider、primary model、fallback models、required capabilities、max output tokens、可选预算、tools/write/bash 权限边界和运行前审批要求。
  - 默认 planner / executor / reviewer / verifier / summarizer 使用 DeepSeek 文本模型；vision / image 默认未配置，必须显式设置。
- `/model route`：
  - 展示所有 role 的 provider/model/capability/tools/write/bash/budget。
  - 明确说明 Phase 13 不默认乱开多模型，只在相关入口按角色触发。
- `/model route doctor`：
  - 诊断缺 provider、provider 未配置、缺模型、能力不足、fallback 未配置 / 不可用、openai-compatible 缺 baseUrl / apiKey / 已确认 model、预算未配置、权限过宽。
  - 输出 BLOCK / WARN / ok 分级；预算问题只作为 WARN，不会把未配置预算伪装成真实账单。
  - 展示最近 `RoleRouteDecision` 摘要，便于排查最近一次按角色路由选择、fallback 和暂停原因。
- `RoleRouteDecision` 运行时审计：
  - agent、review、vision、image 入口按 role 触发路由决策记录。
  - 记录 trigger reason、role、selected provider/model、fallback candidates、required capabilities、预算上限、stop conditions、repair suggestions、fallbackUsed、budgetStop、createdAt。
  - 决策写入当前 TUI session state，并以 `system_event` 写入 transcript；不复制完整 transcript / memory / index / large logs。
- fallback / pause：
  - primary route 缺 provider/model/capability/provider config 时，不假装可用。
  - fallback model 可用时自动选择 fallback，并记录 `fallbackUsed=yes`。
  - primary 和 fallback 都不可用时暂停入口，输出中文修复建议；不做真实网络探测。
- `/model route set <role> <model>`：
  - 最小配置路径，写入项目 `.linghun/settings.json`。
  - 根据模型名推断 provider：DeepSeek 模型走 `deepseek`，其他模型走 `openai-compatible`。
  - 可设置 planner / executor / reviewer / verifier / summarizer / vision / image。
- Agent 与角色路由联动：
  - planner agent 使用 planner role。
  - verifier agent 使用 verifier role。
  - explorer / worker 使用 executor role。
  - agent 列表与详情显示 role/provider/model 和 estimated tokens。
  - agent 使用 role route 的 model 创建独立 transcript session。
- reviewer read-only review entry：
  - `/review` 继续只读输出 review report。
  - 新增 executor -> reviewer 的结构化 role handoff，reviewer 不写文件、不执行 Bash。
- 受限角色 handoff：
  - `RoleHandoff` 只包含 summary、evidence 摘要、changedFiles、diffSummary、verificationReport、keyFiles。
  - 明确 `notIncluded=full transcript/full memory/full index/large logs`。
- usage / stats：
  - `/usage` 新增 role usage 区块。
  - `/stats` 新增 role/model/provider usage 区块。
  - role contribution summary 展示 role/provider/model、estimated tokens、createdAt、fallbackUsed、budgetStop 和贡献摘要。
  - 只显示 estimated token / estimatedCny；状态栏不显示金额。
- Vision 最小闭环：
  - `/vision <path>` 需要 vision role 配置；未配置时清晰降级，不假装读图。
  - 配置后写入 `VisionObservation` evidence，记录 provider/model/source/summary。
  - vision role 不写代码、不执行 Bash。
- Image 最小闭环：
  - `/image generate <prompt>` 需要 image role 配置；未配置时清晰降级，不假装生图。
  - 配置后生成 `.linghun/assets/image-*.json` 本地资产 metadata，并写入 `ImageGenerationResult` evidence。
  - 默认不固定 size/quality/format，除非用户在 prompt 中指定。
  - image role 不写代码、不执行 Bash。
- `/help` / CLI help：
  - TUI `/help` 新增 `/model route`、`/model route doctor`、`/model route set`、`/vision`、`/image generate`。
  - CLI `--help` 更新到 Phase 13，并列出 TUI Phase 13 入口。

## 使用方式

构建后进入 REPL：

```bash
corepack pnpm build
corepack pnpm exec linghun
```

Phase 13 新增/增强命令：

```text
/model route
/model route doctor
/model route set planner deepseek-v4-pro
/model route set verifier deepseek-v4-pro
/model route set vision gpt-4o
/model route set image gpt-image-2
/fork planner <task>
/fork verifier <task>
/review
/vision <image-or-screenshot-path>
/image generate <prompt>
/usage
/stats
```

典型路径：

```text
/model route
/model route doctor
/model route set planner deepseek-v4-pro
/model route set verifier deepseek-v4-pro
/fork planner plan route loop
/fork verifier verify route loop
/review
/vision screenshot.png
/model route set vision gpt-4o
/vision screenshot.png
/image generate logo concept
/model route set image gpt-image-2
/image generate logo concept
/usage
/stats
```

## 涉及模块

- `packages/config/src/index.ts`：新增 Phase 13 role route 类型、默认路由、路由合并、`saveModelRoute()`。
- `packages/config/src/index.test.ts`：覆盖默认路由和 route set 持久化。
- `packages/core/src/session.ts`：扩展 evidence kind：`vision_observation`、`image_result`。
- `packages/tui/src/index.ts`：新增 `/model route`、route doctor、route set、role usage、role handoff、agent role linkage、vision/image 最小闭环、help 展示。
- `packages/tui/src/index.test.ts`：覆盖 Phase 13 route、agent role、reviewer handoff、vision/image 降级与配置后路径、usage/stats。
- `apps/cli/src/cli.ts`：CLI help 更新到 Phase 13。
- `apps/cli/src/main.test.ts`：CLI help 测试更新到 Phase 13。
- `docs/delivery/README.md`：Phase 13 标记完成。
- `README.md`：当前进度更新到 Phase 00-13 完成。
- `START_NEXT_CHAT.md`：下一会话 handoff 更新到 Phase 13 完成、Phase 14 待确认。

## 关键设计

- 手动路由优先：Phase 13 不做默认多模型扇出，只在 agent、review、vision、image 等明确入口按 role route 使用模型。
- 权限边界内建在路由里：planner/reviewer/vision/image 默认不能写文件或执行 Bash；executor 保留工具/写入/Bash 能力，仍受现有权限管道控制。
- 配置最小化：先用 `/model route set <role> <model>` 完成最小可用路径，不引入复杂 provider 管理 UI。
- 诊断不伪装账单：doctor 提示预算未配置；usage/stats 只显示 estimated，不把金额写进状态栏。
- 结构化 handoff：角色之间只传摘要、证据、diff、验证报告和关键文件列表，不传完整上下文。
- Vision / image 是能力补充：它们只能产出 evidence / asset metadata，不能改代码、不能 Bash。

## 配置项

Phase 13 在 `.linghun/settings.json` 中新增 `modelRoutes`：

```json
{
  "modelRoutes": {
    "defaultModel": "deepseek-v4-flash",
    "routes": [
      {
        "role": "planner",
        "provider": "deepseek",
        "primaryModel": "deepseek-v4-flash",
        "fallbackModels": ["deepseek-v4-pro"],
        "requiredCapabilities": ["text"],
        "allowTools": false,
        "allowWrite": false,
        "allowBash": false,
        "requireApprovalBeforeRun": true
      }
    ]
  }
}
```

默认 vision / image route 未配置 provider/model，需要用户显式 `/model route set vision <model>` 或 `/model route set image <model>`。

## 命令

CLI：

```bash
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
corepack pnpm exec linghun
```

REPL：

```text
/help
/model route
/model route doctor
/model route set <role> <model>
/fork planner <task>
/fork verifier <task>
/review
/vision <path>
/image generate <prompt>
/usage
/stats
/agents
/resume
/memory
/index status
/cache status
/break-cache status
/exit
```

## 测试与验证

本阶段要求执行：

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm check
corepack pnpm exec linghun --version
corepack pnpm exec Linghun --version
corepack pnpm exec linghun --help
printf '/model route\n/model route doctor\n/model route set planner deepseek-v4-pro\n/model route set verifier deepseek-v4-pro\n/fork planner plan route loop\n/fork verifier verify route loop\n/review\n/vision screenshot.png\n/image generate logo concept\n/usage\n/stats\n/agents\n/resume\n/memory\n/index status\n/cache status\n/break-cache status\n/exit\n' | corepack pnpm exec linghun
```

已执行：

- `corepack pnpm exec tsc --noEmit --pretty false`：通过，无输出。
- `corepack pnpm test -- --run packages/tui/src/index.test.ts`：Phase 13 hardening 后通过，10 个测试文件、71 个测试通过；覆盖 route decision 记录、primary usable but fallback unavailable WARN、primary unavailable fallback、primary/fallback unavailable pause、openai-compatible 缺 baseUrl/apiKey 诊断、stats fallback summary。
- `corepack pnpm check`：通过，41 个文件检查通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm test`：通过，10 个测试文件、71 个测试通过。
- `corepack pnpm build`：通过，workspace 7 个包构建通过。
- `corepack pnpm exec linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec Linghun --version`：通过，输出 `0.1.0`。
- `corepack pnpm exec linghun --help`：通过，输出 Phase 13 CLI help。
- TUI stdin smoke：通过，覆盖 `/model route`、`/model route doctor`、`/model route set planner`、`/model route set vision`、`/fork planner` route decision、`/review`、vision openai-compatible missing-config pause、`/usage`、`/stats`、`/exit`。

## 性能结果

- `--version` / `--help` 仍为快速路径，不启动 TUI、模型、MCP、索引、验证器或 agent。
- `/model route` 与 `/model route doctor` 是本地配置格式化与启发式诊断，不调用模型。
- `/vision` / `/image generate` 在 Phase 13 最小闭环中只写 evidence / metadata，不联网、不真实调用外部图像服务。
- 状态栏继续保持短字段，不显示 estimatedCny 或真实金额。

## 已知问题

- route capability 判断为最小启发式，基于模型名匹配；后续可接入真实 provider model metadata。
- fallback 调度仅在本地配置和启发式 capability 可判断时执行，不做真实 provider 网络探测。
- vision 只记录最小 `VisionObservation` evidence，不做真实 OCR / 图像理解调用。
- image 只生成本地 metadata asset，不做真实远程生图调用。
- budget 只诊断和展示 estimated usage，不做强制扣费、真实 quota / balance 查询或账单级对账。
- Phase 13 未实现完整 provider adapter 成品验收；事件转换、streaming/非流式降级、tool calling 能力声明、usage/cache 字段完整适配、quota/balance 查询和真实项目账单对账属于后续阶段，尤其 Phase 15 真实项目对账。

## 不在本阶段处理的内容

- 不实现 Phase 14 Skills / Workflows / Hooks / Plugins。
- 不实现 Phase 15 real-project Beta。
- 不实现 Phase 17 long-running jobs / autonomous sessions / remote channels。
- 不实现桌面端。
- 不默认多开模型或随机 fanout。
- 不让 planner/reviewer/verifier/vision/image 绕过权限边界。
- 不把完整 transcript、memory、index 或大日志复制给每个模型。
- 不把金额显示在状态栏。
- 不自动安装依赖、不自动刷新索引。
- 不复制 CCB / OpenCode / Hermes 可疑源码。

## 下一阶段衔接

Phase 14 可以在 Phase 13 role route 与结构化 handoff 基础上设计本地 Skills / Workflows / Hooks / Plugin loader，但必须继续遵守：

- Phase 14 只有用户明确确认后才能开始。
- Phase 14 主闭环只做本地 Skills / Workflows / Hooks / Plugin loader、doctor、启停、信任和权限接入。
- Phase 14 主闭环不做插件市场、GitHub 安装、自动更新、长期任务、Remote Channels、桌面端或 Phase 15+ 能力。
- Skills / Workflows 不能绕过现有权限、Start Gate、verification 和 role route 边界。
- Hooks / Plugins 不得默认自动执行危险动作。
- 多模型角色之间继续只传结构化摘要、证据、diff、验证报告和关键文件列表。

## 开发者排查入口

- Config routes：`packages/config/src/index.ts` 中 `defaultModelRoutes`、`saveModelRoute()`、`mergeModelRoutes()`。
- Slash router：`packages/tui/src/index.ts` 中 `handleSlashCommand()`。
- Model route commands：`handleModelCommand()`、`handleModelRouteCommand()`、`formatModelRoutes()`、`formatModelRouteDoctor()`。
- Agent linkage：`handleForkCommand()`、`getAgentRole()`、`completeAgent()`。
- Role handoff / usage：`createRoleHandoff()`、`addRoleUsage()`、`formatRoleUsageLines()`。
- Vision / image：`handleVisionCommand()`、`handleImageCommand()`。
- Tests：`packages/config/src/index.test.ts`、`packages/tui/src/index.test.ts`、`apps/cli/src/main.test.ts`。

## 参考核对

本阶段实际读取的 Linghun 文档：

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-10-mcp-index.md`
- `F:\Linghun\docs\delivery\phase-11-sessions-memory.md`
- `F:\Linghun\docs\delivery\phase-12-agents.md`
- `F:\Linghun\docs\delivery\ccb-dev-boost-coverage-checklist.md`

本阶段实际参考：

- 本机 codebase-memory 索引：`F-Linghun` ready，用于确认代码范围；未自动刷新索引。
- Phase 12 handoff packet 与 agent 交付文档，用于衔接 agent 生命周期、权限边界和上下文裁剪。
- CCB Dev Boost 对照清单仅作为行为、边界和验收思路参考：多模型不复制完整上下文、状态栏不显示金额、vision/image 作为受限能力补充。

未复制内容：

- 未复制 CCB / OpenCode / Hermes 的可疑源码实现、反编译痕迹、内部 API、专有遥测或内部服务逻辑。
- Phase 13 实现为 Linghun 自研最小闭环。

## 成品级结构化 handoff packet

```json
{
  "id": "phase-13-multi-model-handoff",
  "sessionId": "current-session",
  "projectPath": "F:\\Linghun",
  "currentPhase": "Phase 13 Multi-model collaboration",
  "nextPhase": "Phase 14",
  "phaseStatus": "completed",
  "goal": "完成多模型协作闭环与 Phase 13 hardening：role route、RoleRouteDecision、fallback/pause、doctor、route set、agent role linkage、reviewer handoff、vision/image 最小闭环、role usage 可见。",
  "completed": [
    "ModelRole / ModelCapability / RoleModelRoute / ModelRouteConfig",
    "default role routes for planner/executor/reviewer/verifier/summarizer/vision/image",
    "/model route",
    "/model route doctor with BLOCK/WARN/recent decision summary",
    "/model route set <role> <model>",
    "RoleRouteDecision runtime state and transcript system_event recording",
    "primary route validation with local fallback selection and pause repair advice",
    "planner/verifier/executor agent role linkage",
    "reviewer read-only handoff via /review",
    "RoleHandoff with summary/evidence/diff/verification/keyFiles only",
    "role/model/provider usage in /usage and /stats with fallbackUsed/budgetStop/contribution summary",
    "vision missing-config degradation and VisionObservation evidence",
    "image missing-config degradation and ImageGenerationResult metadata asset",
    "Phase 13 help visibility"
  ],
  "pending": [
    "Phase 14 only after user confirmation"
  ],
  "mustNotDo": [
    "Do not enter Phase 14+ without user confirmation",
    "Do not implement Skills, Workflows, Hooks or Plugins in Phase 13",
    "Phase 14 main loop requires explicit user confirmation and is limited to local loader/doctor/enable-disable/trust/permission integration; no marketplace, GitHub install, auto-update, long-running jobs, Remote Channels, desktop or Phase 15+ capabilities",
    "Do not default to multi-model fanout",
    "Do not let planner/reviewer/vision/image write or execute Bash",
    "Do not copy full transcript/full memory/full index/large logs between roles",
    "Do not show money in status bar",
    "Do not auto-install dependencies or auto-refresh index"
  ],
  "keyFiles": [
    "packages/config/src/index.ts",
    "packages/config/src/index.test.ts",
    "packages/core/src/session.ts",
    "packages/tui/src/index.ts",
    "packages/tui/src/index.test.ts",
    "apps/cli/src/cli.ts",
    "apps/cli/src/main.test.ts",
    "docs/delivery/phase-13-multi-model.md"
  ],
  "verification": {
    "status": "full_validation_passed_independent_verifier_passed",
    "commands": [
      "corepack pnpm exec tsc --noEmit --pretty false",
      "corepack pnpm test -- --run packages/tui/src/index.test.ts",
      "corepack pnpm test",
      "corepack pnpm typecheck",
      "corepack pnpm build",
      "corepack pnpm check",
      "corepack pnpm exec linghun --version",
      "corepack pnpm exec Linghun --version",
      "corepack pnpm exec linghun --help",
      "TUI stdin smoke for route doctor, route set, fork planner, review, vision pause, usage, stats"
    ]
  },
  "risks": [
    "Vision/image are minimal local evidence/metadata loops, not real provider calls.",
    "Capability detection is heuristic by model name.",
    "Fallback selection is local/config-based and does not probe provider network availability."
  ],
  "indexStatus": {
    "project": "F-Linghun",
    "status": "ready",
    "nodes": 610,
    "edges": 1092
  },
  "permissionMode": "default Claude Code session; Linghun role routes preserve existing permission pipeline",
  "modelProvider": {
    "assistant": "claude-sonnet-4-6 via Claude Code",
    "linghunRuntimeProvider": "deepseek default with optional openai-compatible role routes"
  },
  "budgetUsage": "Estimated usage only; no status-bar money; no billing reconciliation.",
  "createdAt": "2026-05-16",
  "generatedBy": "Claude Code / Linghun Phase 13 delivery"
}
```
