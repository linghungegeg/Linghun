# Phase 15 Pre-Beta Runtime Artifact & Decision Guard Cleanup Report

> 日期：2026-05-20  
> 范围：最后一轮 Pre-Beta runtime artifact cleanup、Beta verdict evidence guard、MCP/deferred guard、独立 Beta decision verification  
> 约束：不重开 A-H 全量审计；不进入 Phase 15 Beta / 15.5 / 16+；只做最小必要改动。

## VERDICT: PASS

本轮要求的 4 项均已完成并通过本地验证。当前仍不自动进入 Beta；是否开始 Phase 15 Beta 仍必须由用户明确确认。

## 1. 改动文件

本轮直接相关代码改动：

- `apps/cli/src/cli.ts`
- `apps/cli/src/main.test.ts`
- `packages/providers/src/index.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`

当前工作区还存在非本轮最小修复直接产生的文档改动/新增文件，最终提交或 handoff 前需要单独确认是否保留：

- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `docs/audit/reference-map.md`
- `docs/audit/phase-15-pre-beta-non-real-test-completeness-audit.md`

本报告文件为本轮要求新增：

- `docs/audit/phase-15-pre-beta-runtime-artifact-decision-guard-cleanup-report.md`

## 2. Runtime phase/smoke artifact cleanup

### 修复结果

- `apps/cli/src/cli.ts`
  - 将默认入口说明从阶段口径改为“进入交互式终端”。
  - 将 `/model route` help 从阶段口径改为“查看角色模型路由”。
  - 将说明文字改为产品语言：交互式终端、本地扩展系统、skills/workflows/hooks/plugins。
  - 将 help 示例中的固定模型 `deepseek-v4-pro` 改为 `<model>`，避免在用户可见 help 中暗示固定 smoke/provider。
- `packages/tui/src/index.ts`
  - 清理用户可见 cache/freshness、skills、workflows、plugins、hooks、model route、vision/image、handoff、claim-check/help 中的阶段口径。
  - Handoff 从 Phase-specific 文案改为 runtime readiness evidence guard / product roadmap boundary 文案。
- `packages/providers/src/index.ts`
  - `MODEL_BASE_URL_MISSING` 建议不再固定展示 `https://api.deepseek.com/v1`，改为让用户设置当前 provider 兼容的 `base_url` 后运行 `/model doctor` 复查。

### Hardcoded artifact audit

运行时源码范围搜索：`apps/cli/src`、`packages/tui/src`、`packages/providers/src`。

结果：

- `Phase 15 preflight`：未在 runtime 用户可见代码中发现。
- `DEPLOY_REPORT.md`：未发现。
- `PHASE15_RC`：未发现。
- `Gate F`：未在 runtime 用户可见代码中发现。
- `sub2api.toioto.org`：未在 runtime 代码中发现。
- `Phase 13` / `Phase 14`：仅剩 `packages/tui/src/index.test.ts` 的测试描述或历史断言，属于用户允许保留的 tests 范围，不是 runtime UI/help/prompt。
- `gpt-5.5` / `deepseek-chat` / `https://api.deepseek.com/v1`：剩余命中为 provider 默认配置或测试数据，不是 Gate F smoke runtime 文案；provider 缺 base_url 的用户建议已移除固定 DeepSeek URL。

## 3. Beta verdict evidence guard

### 修复结果

`packages/tui/src/index.ts` 中的 Beta readiness verdict 不再以“任意 Write evidence”作为 PASS 条件。

现在 PASS 至少要求以下证据维度全部满足：

- real TUI report-generation path PASS evidence
- DeepSeek dual-provider / Gate F PASS evidence
- OpenAI-compatible dual-provider / Gate F PASS evidence
- report Write evidence
- final answer references generated report
- transcript/evidence 中不存在 SKIPPED / PARTIAL / BLOCKED blocking gate

缺任一证据时，verdict 维持 `PARTIAL`，并在 `uncoveredItems` / `residualRisks` 中给出缺口和下一步。

### 回归测试

`packages/tui/src/index.test.ts` 新增覆盖：

- 只有 `Write` evidence 时，`/claim-check Beta readiness is PASS` 输出 `verdict=PARTIAL`。
- 输出明确包含缺失 DeepSeek dual-provider live report evidence。
- 不输出 `verdict=PASS`。

## 4. MCP/deferred tool discovery-before-execute guard

### 修复结果

`packages/tui/src/index.ts` 新增最小 guard：`validateCodebaseMemoryToolExecution()`。

当前覆盖 codebase-memory deferred 工具 required args：

- `list_projects`
- `index_status`
- `detect_changes`
- `index_repository`
- `search_code`
- `get_architecture`
- `get_code_snippet`
- `query_graph`
- `trace_path`
- `search_graph`

行为：

- 未登记/未知工具：拒绝执行并显示“尚未经过 discovery/schema 登记”。
- 缺 required args：拒绝执行并显示缺失字段。
- `get_code_snippet` 缺 `qualified_name`：拒绝盲执行，避免无效 token 消耗。

### 回归测试

`packages/tui/src/index.test.ts` 新增覆盖：

- `get_code_snippet` 只有 `project` 时返回缺少 `qualified_name` 诊断。
- `unknown_tool` 返回未经过 discovery/schema 登记诊断。
- `get_code_snippet` 带 `project` + `qualified_name` 时通过 guard。

## 5. Gate F dual-provider report 复核

复核文件：`docs/audit/phase-15-gate-f-dual-provider-live-report.md`。

结论：该报告仍有效，且仍只证明 Gate F dual-provider live report-generation smoke PASS，不构成自动进入 Beta 的充分条件。

报告中已记录：

- DeepSeek Gate F：PASS
  - Provider: `deepseek`
  - Model: `deepseek-chat`
  - Base URL: `https://api.deepseek.com/v1`
  - Tool chain: Glob/Read/Write → permission approval → model continuation → final answer
  - Write evidence ID: `46b2e850-c15e-48a5-9672-4b72a53709e4`
  - Final answer 引用 `gate-report.md`
- OpenAI-compatible Gate F：PASS
  - Provider: `openai-compatible`
  - Model: `gpt-5.5`
  - Base URL: `https://sub2api.toioto.org/v1`
  - Tool chain: Glob/Write → permission approval → model continuation → final answer
  - Write evidence ID: `1e555f9a-ec2a-419a-898d-e9e8e1bc10af`
  - Final answer 引用 `gate-report.md`
- Key leakage check：报告声明 API key 未写入仓库文件、配置、文档、日志或提交历史。
- 边界：Gate F PASS 不自动进入 Phase 15 Beta。

## 6. Key leakage check

搜索范围：`**/*.{ts,tsx,js,jsx,json,md,yml,yaml,env,txt}`。

搜索模式覆盖：

- `sk-...` 形态长 token
- `AIza...` 形态 token
- `api_key` / `apiKey` 静态赋值形态

结果：未发现真实 API key 泄漏。

命中均为测试假 key 或测试断言：

- `sk-test`
- `sk-test-deepseek-secret`
- `sk-test-openai-compatible-secret`
- `test-openai-key`
- `test-openai-secret`
- `test-key`

未发现真实 provider key、Authorization header、cookie 或生产 token 写入本轮改动文件。

## 7. 验证结果

| 命令 | 结果 |
| --- | --- |
| `mcp__codebase-memory-mcp__index_status(project=F-Linghun)` | PASS：ready，nodes=1280，edges=2318 |
| `mcp__codebase-memory-mcp__detect_changes(project=F-Linghun)` | PASS：发现当前工作区 changed files |
| `corepack pnpm check` | PASS：Checked 47 files，No fixes applied |
| `corepack pnpm typecheck` | PASS：`tsc -b tsconfig.json` clean |
| `corepack pnpm test -- --run packages/tui/src/index.test.ts apps/cli/src/main.test.ts packages/providers/src/index.test.ts` | PASS：11 files / 269 tests passed |
| `corepack pnpm test` | PASS：11 files / 269 tests passed |
| `corepack pnpm build` | PASS：7/8 workspace projects built |
| `git diff --check` | PASS：无 whitespace error；仅 Windows CRLF warning |

说明：targeted Vitest 命令受当前 pnpm/Vitest 参数解析影响，实际运行了完整 11 个测试文件；结果全部 PASS。

## 8. SKIPPED / PARTIAL / BLOCKED 检查

本轮最终 verification 结果中没有发现阻塞性 `SKIPPED` / `PARTIAL` / `BLOCKED` gate。

保留边界：

- Gate F dual-provider PASS 仍不是自动进入 Beta 的充分条件。
- Beta 必须由用户明确确认后才能开始。
- 当前工作区含非本轮直接相关文档改动，提交前需要单独确认是否纳入。

## 9. git status --short

```text
 M LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md
 M LINGHUN_IMPLEMENTATION_SPEC.md
 M LINGHUN_PHASED_DELIVERY_BLUEPRINT.md
 M apps/cli/src/cli.ts
 M apps/cli/src/main.test.ts
 M docs/audit/reference-map.md
 M packages/providers/src/index.ts
 M packages/tui/src/index.test.ts
 M packages/tui/src/index.ts
?? docs/audit/phase-15-pre-beta-non-real-test-completeness-audit.md
?? docs/audit/phase-15-pre-beta-runtime-artifact-decision-guard-cleanup-report.md
```

## 10. Final decision note

**VERDICT: PASS** for this cleanup and decision-guard round.

This does **not** start Phase 15 Beta, Phase 15.5, or Phase 16+. The only recommended next action is for the user to explicitly decide whether to start Phase 15 Beta after reviewing this report and the remaining working-tree scope.
