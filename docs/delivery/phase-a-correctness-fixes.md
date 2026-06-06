# Phase A Correctness Fixes

## 阶段目标

按 `LINGHUN_DEVELOPMENT_ROADMAP.md` 的 Phase A 表完成 16 个立即正确性修复，范围限定为 A1-A16。

本阶段只修实际 bug，不进入 Phase B-G，不做顺手重构，不处理白皮书、审计资产、stress 资产或后续路线图任务。完成后停止。

## 文档事实核对

开工前实际读取并遵守的 Linghun 文档：

- `F:\Linghun\LINGHUN_DEVELOPMENT_ROADMAP.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`

本阶段依据 `LINGHUN_DEVELOPMENT_ROADMAP.md` Phase A 的 A1-A16 表推进。没有进入 Phase B 的错误吞没清理、死代码清理或硬编码清理。

## 已完成功能

| 项 | 状态 | 结果 |
| --- | --- | --- |
| A1 | DONE | 未知 registry workflow `step.action` 返回 `blocked`，不再静默 completed；已知 action 成功执行后显式返回 completed，避免误落入未知 action 分支。 |
| A2 | DONE | `rememberBackgroundTask` 使用 `tui-context-runtime.ts` 导出的 `MAX_BACKGROUND_TASKS = 50`，不再保留模块私有 8。 |
| A3 | DONE | nested job 的 `created` / 未覆盖状态保守映射为 `blocked`，不再默认 completed。 |
| A4 | DONE | `validateProviderApiKey` 对 `undefined` / 空值返回结构化校验错误，不再抛 TypeError。 |
| A5 | DONE | `completeAgent` 的 fire-and-forget 调用补 `.catch()`，失败时把后台 task 标为 failed 并记录事件。 |
| A6 | DONE | Anthropic stream 结束时若仍有 pending `tool_use`，发出 `PROVIDER_PARTIAL_TOOL_CALL`，不再静默丢弃。 |
| A7 | DONE | generic provider `Error` 归一化路径调用 `maskSensitiveFragments`，避免错误消息泄漏 API key 片段。 |
| A8 | DONE | `approval.warnings` 改为可选链，`warnings: undefined` 降级为空列表。 |
| A9 | DONE | usage stats 中 `estimatedCny` 为 NaN 时显示 `估算中`，不再输出 `NaN`。 |
| A10 | DONE | 删除孤儿测试 `packages/tui/src/bundled-runtime.test.ts`，避免引用不存在的 `bundled-runtime.ts`。 |
| A11 | DONE | 移除 `deep-compact-runtime.ts` 中未使用的 `controller` 变量；保留原有无 timeout 行为。 |
| A12 | DONE | 源码已确认 `runInkShell` 在 `finally` 中 `clearInterval(activityTicker)`，TUI 退出后 ticker 可回收。 |
| A13 | DONE | Feishu long connection `close()` 改为 awaitable/idempotent wrapper，关闭前删除 `im.message.receive_v1` dispatcher handle，close 错误向调用方传播。 |
| A14 | DONE | remote inbox 判断对 `context.backgroundTasks` 使用可选链，结构不完整时不崩溃。 |
| A15 | DONE | Ink input event 增加 `empty-submit` no-op 与未知事件显式忽略/记录，未知事件不再进入 submit 空输入路径。 |
| A16 | DONE | `extension update --ref` 缺值、空值或下一个参数仍是 flag 时返回可操作错误，不再传播 `undefined` ref。 |

为满足全量验证，还做了两类测试层最小修正：

- `permission-panel-invariant.test.ts` 的静态扫描目标从拆分前的 `index.ts` 对齐到真实 owner runtime：`model-tool-runtime.ts` / `slash-command-runtime.ts`。
- 三个全量负载下接近默认 5 秒阈值的长用例增加 10 秒测试预算，不改变运行时代码。

## 使用方式

无新增用户命令。现有用户路径保持不变：

- `/workflows run` 遇到未知 registry action 会阻断并说明未知操作。
- provider 流式解析、Feishu remote bot、extension update、usage/pending details 等路径按原入口使用。
- `linghun` / `Linghun` 入口行为不在本阶段改动。

## 涉及模块

- `packages/providers/src/index.ts`
- `packages/providers/src/index.test.ts`
- `packages/config/src/index.ts`
- `packages/config/src/index.test.ts`
- `packages/tui/src/workflow-command-runtime.ts`
- `packages/tui/src/tui-agent-job-runtime.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/deep-compact-runtime.ts`
- `packages/tui/src/feishu-long-connection-runtime.ts`
- `packages/tui/src/feishu-long-connection-runtime.test.ts`
- `packages/tui/src/remote-command-runtime.ts`
- `packages/tui/src/extension-command-runtime.ts`
- `packages/tui/src/extension-command-runtime.test.ts`
- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/pending-details-presenter.ts`
- `packages/tui/src/usage-stats-presenter.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/permission-panel-invariant.test.ts`
- `packages/tui/src/bundled-runtime.test.ts` 删除
- `docs/delivery/README.md`
- `docs/delivery/phase-a-correctness-fixes.md`

## 关键设计

- 保守失败优先：未知 workflow action、未完成 Anthropic tool_use、未知 nested job 状态都不再被误报为完成。
- 不改公共语义：只在原有 runtime 分支内补缺口，未新增第二套 workflow/provider/remote/agent 系统。
- 错误处理显式：fire-and-forget agent completion 有 `.catch()`，Feishu close 把 close 异常传播给调用方。
- 可见输出降级：NaN 成本、undefined warnings、missing ref 都返回人可理解的降级或错误。
- 测试只跟随真实 owner runtime：拆分后静态 invariant 扫描真实文件，不把历史 `index.ts` 结构当成事实。

## 配置项

无新增配置项。

## 命令

无新增用户命令。

## 测试与验证

已运行并通过：

```powershell
corepack pnpm exec tsc -b tsconfig.json --pretty false
```

结果：PASS。

```powershell
corepack pnpm exec vitest run packages/tui/src/feishu-long-connection-runtime.test.ts -t "long connection close is awaitable"
```

结果：PASS，1 passed / 8 skipped。

```powershell
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "normal tool_use stops|gates no-tool final summary"
```

结果：PASS，2 passed / 662 skipped。

```powershell
corepack pnpm exec vitest run packages/config/src/index.test.ts -t "rejects undefined provider API key"
```

结果：PASS，1 passed / 61 skipped。

```powershell
corepack pnpm exec vitest run packages/tui/src/extension-command-runtime.test.ts -t "returns an actionable error when --ref has no value"
```

结果：PASS，1 passed / 39 skipped。

```powershell
corepack pnpm exec vitest run packages/providers/src/index.test.ts packages/config/src/index.test.ts packages/tui/src/extension-command-runtime.test.ts packages/tui/src/feishu-long-connection-runtime.test.ts packages/tui/src/permission-panel-invariant.test.ts packages/tui/src/index.test.ts -t "Phase A correctness focused guards|Phase A: nested job created status|generic Error provider errors are redacted|unfinished Anthropic|--ref without a value|long connection close is awaitable|PermissionPanel invariant"
```

结果：PASS，12 passed / 905 skipped；另补跑 config / extension 两个精确用例均 PASS。

```powershell
corepack pnpm exec vitest run
```

结果：PASS，78 test files passed / 2 benchmark files skipped，3054 tests passed / 2 skipped。

全量验证前曾暴露并处理：

- registry workflow 已知 readonly action 成功后误落入未知 action 阻断：已在 A1 修复中补 known-action 成功出口。
- `permission-panel-invariant.test.ts` 静态扫描拆分前 `index.ts`：已对齐真实 owner runtime。
- Windows/全量负载下个别长用例接近默认 5 秒测试预算：只放宽相关测试预算，不改运行时行为。

## 性能结果

本阶段未引入新 runtime loop、缓存层或后台 worker。全量 vitest 最终耗时约 436 秒，主要来自既有 `index.test.ts` 大套件和现有 integration-style 用例；Phase A 代码改动没有新增常驻任务。

## 已知问题

- 当前工作树仍有本阶段外的既有改动/未跟踪资产，例如 `WHITEPAPER.md`、`WHITEPAPER.en.md`、审计报告、stress/img/scripts/test-model-set 相关文件。本阶段未修改、未回滚、未纳入交付范围。
- `WSClient.close()` 在本地 `@larksuiteoapi/node-sdk@1.59.0` 类型中返回 `void`；Linghun 提供 awaitable wrapper 用于统一调用链和错误传播，但 SDK 本身没有提供“等待底层 close event 完成”的 Promise。
- A12 本轮未产生新增 diff，因为源码事实已满足 `finally clearInterval(activityTicker)`。

## 不在本阶段处理的内容

- 不进入 Phase B-G。
- 不做 B1 错误吞没系统性清理、B2 死代码清理、B3 硬编码消除。
- 不处理白皮书、审计报告、图片、stress 脚本、测试模型脚本。
- 不新增 provider、remote channel、workflow DSL、agent runtime 或权限体系能力。
- 不修改依赖、构建配置、发布流程或数据迁移。

## 下一阶段衔接

Phase A 已完成并停止。下一步只能由用户明确确认后再进入 `LINGHUN_DEVELOPMENT_ROADMAP.md` 的 Phase B；不得自动推进 Phase B。

## 开发者排查入口

- Workflow registry action：`packages/tui/src/workflow-command-runtime.ts`
- nested job 状态映射：`packages/tui/src/workflow-command-runtime.ts`
- provider stream / error normalize：`packages/providers/src/index.ts`
- provider API key 校验：`packages/config/src/index.ts`
- agent fire-and-forget completion：`packages/tui/src/job-agent-command-runtime.ts`
- Feishu long connection：`packages/tui/src/feishu-long-connection-runtime.ts`
- extension update ref：`packages/tui/src/extension-command-runtime.ts`
- Ink input event handling：`packages/tui/src/index.ts`
- pending details / usage display：`packages/tui/src/pending-details-presenter.ts`、`packages/tui/src/usage-stats-presenter.ts`

## 参考核对

本阶段实际读取的 Linghun 文档：

- `F:\Linghun\LINGHUN_DEVELOPMENT_ROADMAP.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`

本阶段没有读取或复制 `F:\ccb-source` 源码。Phase A 的事实来源是 `LINGHUN_DEVELOPMENT_ROADMAP.md` 中列出的 Linghun 自审 bug 表；CCB/社区内容没有进入本阶段实现。未复制可疑源码实现、内部 API、专有遥测或反编译痕迹。

## Handoff Packet

- 当前阶段：Phase A Correctness Fixes
- 状态：DONE，完成后停止
- 下一阶段：Phase B，必须等待用户明确确认
- 禁止事项：不得自动进入 Phase B-G；不得顺手清理白皮书、审计资产、stress/img/scripts；不得借 Phase A 扩展 provider/agent/workflow 功能
- 证据引用：`LINGHUN_DEVELOPMENT_ROADMAP.md` Phase A A1-A16；本文件“测试与验证”
- 验证结果：`tsc -b` PASS；Phase A focused tests PASS；`vitest run` 全量 PASS（78 passed / 2 skipped，3054 passed / 2 skipped）
- 索引状态：本阶段未触发 codebase-memory refresh/rebuild；使用本地 `rg`/源码事实核对
- 权限模式：本地 unrestricted filesystem；未执行联网安装、依赖变更、发布或远程部署
- 模型/provider：Codex 本地开发会话；未调用 Linghun runtime provider
- 预算使用情况：未设置显式 token 预算；本阶段未新增运行时成本路径
