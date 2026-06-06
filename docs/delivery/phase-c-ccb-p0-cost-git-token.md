# Phase C CCB P0 Cost / Git / Token

## 阶段目标

按 `LINGHUN_DEVELOPMENT_ROADMAP.md` Phase C 完成 P0 基础能力：实时费用估算、TUI footer 费用显示、Git 状态自动注入、按文件类型 token 估算和拼写收口。

本阶段只参考 CCB 行为边界，不读取、不复制 `F:\ccb-source` 可疑源码实现。

## 文档事实核对

开工前实际读取并遵守：

- `F:\Linghun\LINGHUN_DEVELOPMENT_ROADMAP.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-b-self-audit-fixes.md`

codebase-memory MCP 工具本轮不可用；使用 `rg` 与源码精读完成 source-level reality check。Phase D 只读 explorer 已输出后续缺口清单，但不作为 Phase C 完成证据。

## 已完成功能

| 项 | 状态 | 结果 |
| --- | --- | --- |
| C1 | DONE | `addRoleUsage()` 按 route model 查 `MODEL_PRICING` 并累计 `RoleUsage.estimatedCny`，未知模型保持 `NaN`/估算中。 |
| C2 | DONE | `footer-view` 新增 `formatFooterCostLabel()`，任务 footer 显示累计 `费用 ¥x.xxxx est` / `cost ¥x.xxxx est`。 |
| C3 | DONE | `sendMessage` 主链注入 1000 字符以内只读 GitStatus：branch、status --short 摘要、最近 5 提交、`git config user.name`。失败或非 git 仓库不注入。 |
| C4 | DONE | `context-estimator.ts` 新增 `bytesPerTokenForFileType()` / `estimateFileTokens()`；JSON/JSONL 使用 2 bytes/token，默认 4 bytes/token。 |
| C5 | DONE | `packages/config` 定义 `MODEL_PRICING: Record<string, { inputPer1K, outputPer1K, currency }>`，覆盖 DeepSeek/OpenAI 常用模型估算。 |
| C6 | DONE | `workflow_preview_only` 拼写已在 Phase B 收口，本阶段复核未发现错误拼写残留。 |

## 使用方式

- `/usage` 显示本会话 estimated cost 与 role/model/provider 费用明细。
- `/stats` 显示 estimated cost，并明确 `not billing`。
- TUI task footer 在已有 model/cache/index/reasoning 右侧显示短费用段。
- 模型 system prompt 会收到内部 `GitStatus=` 摘要；主屏 sanitizer 会阻止该内部字段名泄漏。

## 涉及模块

- `packages/config/src/index.ts`
- `packages/config/src/index.test.ts`
- `packages/tui/src/slash-command-runtime.ts`
- `packages/tui/src/usage-stats-presenter.ts`
- `packages/tui/src/usage-stats-presenter.test.ts`
- `packages/tui/src/shell/models/footer-view.ts`
- `packages/tui/src/shell/models/footer-view.test.ts`
- `packages/tui/src/shell/components/StatusFooter.tsx`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/shell/types.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/context-estimator.ts`
- `packages/tui/src/context-estimator.test.ts`
- `packages/tui/src/index.test.ts`

## 关键设计

- 费用是 packaged estimate，不是账号账单；未知模型不伪造金额。
- Git 注入复用现有只读 git runtime，只执行 `rev-parse/status/log/config` 等只读命令，失败时不阻断模型请求。
- GitStatus 是内部 prompt 字段；用户需要详情仍通过 `/status`、`/details`、git 相关命令查看。
- 文件类型 token 估算只新增纯函数和 JSON 闭环，不把 job/memory 等纯文本预算改成另一套系统。

## 配置项

新增导出：

- `MODEL_PRICING`
- `findModelPricing()`
- `calculateEstimatedCny()`

本阶段不新增 env，不改 provider/env 优先级。

## 命令

无新增命令；增强现有：

- `/usage`
- `/stats`
- TUI task footer

## 测试与验证

已通过：

```powershell
corepack pnpm exec vitest run packages/config/src/index.test.ts packages/tui/src/context-estimator.test.ts packages/tui/src/shell/models/footer-view.test.ts packages/tui/src/usage-stats-presenter.test.ts
```

结果：104 tests PASS。

```powershell
corepack pnpm exec vitest run packages/tui/src/index.test.ts --testNamePattern "routes Phase 13 roles|injects bounded GitStatus"
```

结果：2 tests PASS / 663 skipped。

```powershell
corepack pnpm exec tsc -b tsconfig.json --pretty false
```

结果：PASS。

## 性能结果

费用计算为常数表查找和加法。Git prompt 摘要每次模型请求最多 4 个只读 git 子命令，runner 超时 2500ms，输出截断到 1000 字符；非 git 仓库或 git 不可用时不注入、不重试。

## 已知问题

- `MODEL_PRICING` 是内置估算表，价格会随 provider 调整；真实账单仍以 provider/账号账单为准。
- 本阶段只完成 Phase C；Phase D 的工具拆分、命令注册表、API token 精确计数仍未完成。
- 工作区存在本阶段外预先 dirty/untracked 文件，未触碰、未回滚。

## 不在本阶段处理的内容

- 不实现 Phase D 的每工具独立目录、PromptCommand 或 API countTokens。
- 不实现 Phase E 的 20 文件测试覆盖清单。
- 不实现 Phase F/G provider、权限、MCP remote、feature flag、memory include、keybinding 系统。

## 下一阶段衔接

下一阶段：Phase D。根据只读 source-level reality check，优先处理：

- `packages/tools/src/index.ts` 的工具接口与拆分。
- `packages/tui/src/model-loop-runtime.ts` 的 Diff schema。
- `packages/tui/src/slash-command-runtime.ts` 的命令注册表和 PromptCommand。
- `packages/tui/src/model-stream-runtime.ts` / `compact-preflight-runtime.ts` 的 token 计数与上下文利用率。

## 开发者排查入口

- 价格表：`packages/config/src/index.ts`
- 费用累加：`packages/tui/src/slash-command-runtime.ts`
- `/usage`/`/stats`：`packages/tui/src/usage-stats-presenter.ts`
- footer：`packages/tui/src/shell/models/footer-view.ts`
- Git prompt：`packages/tui/src/model-stream-runtime.ts`、`packages/tui/src/model-prompt-runtime.ts`
- token 估算：`packages/tui/src/context-estimator.ts`

## 参考核对

本阶段实际读取 Linghun 文档见“文档事实核对”。CCB 只作为路线图列出的行为参考：状态栏费用、Git 上下文、token 估算口径和费用表形态。没有读取或复制 `F:\ccb-source` 源码；未复制内部 API、专有遥测、反编译痕迹或可疑实现。

## Handoff Packet

- 当前阶段：Phase C CCB P0 Cost / Git / Token
- 状态：DONE，继续进入用户已明确要求的 Phase D
- 下一阶段：Phase D CCB P1 Tool / Command / Token Counting
- 禁止事项：不得把已有局部 registry/usage/context pressure 当作 Phase D 完成；不得复制 CCB 可疑源码；不得绕过权限或 Start Gate
- 证据引用：`LINGHUN_DEVELOPMENT_ROADMAP.md` Phase C；本文件“测试与验证”
- 验证结果：typecheck PASS；Phase C focused tests PASS；full vitest deferred to Phase G final regression
- 索引状态：codebase-memory MCP 不可用；使用 `rg`/源码事实核对
- 权限模式：本地 unrestricted filesystem；未执行依赖变更、发布或远程部署
- 模型/provider：Codex 本地开发会话；未调用 Linghun runtime provider
- 预算使用情况：未设置显式 token 预算；运行时新增费用估算为本地常数表计算，不产生 provider 成本
