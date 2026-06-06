# Phase B Self-Audit Fixes

## 阶段目标

按 `LINGHUN_DEVELOPMENT_ROADMAP.md` Phase B 完成 Linghun 自审质量修复：B1 错误吞没消除、B2 死代码清理、B3 硬编码消除、B4 重复代码消除。

本阶段不依赖 CCB 源码，不复制可疑实现；只修 Linghun 自身源码事实中能闭环的问题。

## 文档事实核对

开工前实际读取并遵守：

- `F:\Linghun\LINGHUN_DEVELOPMENT_ROADMAP.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- 已完成阶段交付文档：`F:\Linghun\docs\delivery\phase-a-correctness-fixes.md`

codebase-memory MCP 工具本轮不可用；使用 `rg` 与源码精读完成 source-level reality check。并行 explorer 只读核对了 C-G 后续阶段，结论仅作为后续定位线索，不作为 Phase B 完成证据。

## 已完成功能

| 项 | 状态 | 结果 |
| --- | --- | --- |
| B1.1-B1.3 | DONE | `jsonl` 与 `session-store` 区分 `ENOENT` 和其他异常；metadata/readDir 非缺失错误会记录 warning 或 stderr。 |
| B1.4-B1.6 | DONE | provider response text、tools fallback grep、TUI output memory compact 的失败不再静默吞掉。 |
| B1.7-B1.16 | DONE | config backup、break-cache、persistent agents hydrate、permission mode event、Bash boundary preflight、index repair plan、MCP stdio 非 JSON 帧、compact pressure、workflow hydrate/read state 都有显式错误处理或 warning。 |
| B2.1-B2.15 | DONE | 删除死导入、死函数、死参数、不可达分支和冗余 assistant block 替换；拼写 `workflow_preview_only` 已正确。 |
| B2.16 | DONE / DEFENSE-ONLY | provider builder 侧 orphan tool_result 修复保留为防御性协议 guard，并加注释说明正常路径应已提前修复。 |
| B2.17-B2.20 | DONE | Anthropic tools 死分支、空 toolChoice 分支、拼写和 extended downgrade 死参数已收口。 |
| B3.1-B3.4 | DONE | DeepSeek base URL、codebase-memory command/env、Feishu CLI 路径提取为 shared/env 配置。 |
| B3.5 | DONE | 新增 `TOGGLE_DETAILS_KEYBIND`，关键运行时用户可见文案接入统一常量；注释和历史测试描述保留原文，不作为运行时配置源。 |
| B3.6-B3.12 | DONE | 默认 DeepSeek route 加注释；agentic turns、verification timeout、request slow hint、evidence cap、background cap、context window、provider timeouts/breaker cooldown 增加 env override；handoff keyFiles 改为动态候选 + 默认回退。 |
| B4.1-B4.5 | DONE | `sanitizeDiagnosticText`、`redactedPath`、silent output、stable hash/stringify、context estimator 重复实现收敛。 |
| B4.6-B4.11 | DONE | compact secret redaction 提取到 shared；index approval 权限管道合并；MCP stdio runner 抽出共享骨架；skills/plugins slash 模板合并；provider usage 去掉 `cacheWriteTokensRaw` 双字段。 |

## 使用方式

无新增主命令。用户原路径保持不变：

- `/index refresh`、`/index init fast` 仍走既有权限管道。
- `/mcp doctor`、`/memory stats`、`/workflows status` 等继续通过 CommandPanel + Ctrl+O 展开详情。
- `LINGHUN_FEISHU_CLI` 可覆盖 Feishu CLI 路径。
- `LINGHUN_MAX_AGENTIC_TURNS`、`LINGHUN_VERIFICATION_COMMAND_TIMEOUT_MS`、`LINGHUN_CONTEXT_WINDOW_TOKENS`、`LINGHUN_PROVIDER_TIMEOUT_MS` 等 env 可覆盖相应默认值。

## 涉及模块

- `packages/core/src/jsonl.ts`
- `packages/core/src/session-store.ts`
- `packages/config/src/index.ts`
- `packages/providers/src/index.ts`
- `packages/shared/src/index.ts`
- `packages/tools/src/index.ts`
- `packages/tui/src/*runtime.ts`
- `packages/tui/src/shell/*`
- 相关 focused tests

## 关键设计

- 错误处理只对明确可降级的 `ENOENT` 静默；权限、解析、读写失败进入 warning / system event / stderr。
- B2 清理只删除已证实死代码；provider builder 的 orphan 注入作为 defense-only guard 保留。
- B3 env override 不改变默认行为，只提供可配置路径。
- B4 去重优先复用已有 owner runtime；没有新增第二套 sanitizer、MCP、extension 或 approval 系统。

## 配置项

新增或明确支持：

- `LINGHUN_FEISHU_CLI`
- `LINGHUN_MAX_AGENTIC_TURNS`
- `LINGHUN_VERIFICATION_COMMAND_TIMEOUT_MS`
- `LINGHUN_REQUEST_SLOW_HINT_MS`
- `LINGHUN_MAX_EVIDENCE_RECORDS`
- `LINGHUN_BACKGROUND_RUNNING_GLOBAL_CAP`
- `LINGHUN_CONTEXT_WINDOW_TOKENS`
- `LINGHUN_PROVIDER_STREAM_IDLE_TIMEOUT_MS`
- `LINGHUN_PROVIDER_TIMEOUT_MS`
- `LINGHUN_PROVIDER_BREAKER_COOLDOWN_MS`

## 命令

无新增命令。

## 测试与验证

已通过：

```powershell
corepack pnpm exec tsc -b tsconfig.json --pretty false
```

```powershell
corepack pnpm exec vitest run packages/core/src/jsonl.test.ts packages/core/src/session-store.test.ts packages/config/src/index.test.ts
```

结果：100 tests PASS。

```powershell
corepack pnpm exec vitest run packages/providers/src/index.test.ts packages/tui/src/context-estimator.test.ts packages/tui/src/compact-context.test.ts packages/tui/src/shell/models/footer-view.test.ts packages/tui/src/shell/view-model.test.ts
```

结果：514 tests PASS。

```powershell
corepack pnpm exec vitest run packages/tui/src/index.test.ts --testNamePattern "mcp tool"
```

结果：4 tests PASS / 660 skipped。

Phase B 收尾时未运行全量 `vitest run`；连续阶段目标要求继续推进 C-G，最终会在 Phase G 后跑全量回归。若后续阶段失败，Phase B 可用上述 focused commands 单独复验。

## 性能结果

本阶段不新增常驻 worker 或高频 IO。MCP stdio 仍保持一次性 spawn 策略，只抽共享 runner；env override 读取仅发生在模块初始化或既有路径上。

## 已知问题

- 工作区存在本阶段外的预先 dirty/untracked 文件（白皮书、审计、stress、img、scripts 等），未触碰、未回滚。
- `Ctrl+O` 注释和历史测试描述中仍有字面文本；运行时关键用户可见文案已接入 `TOGGLE_DETAILS_KEYBIND`。
- Phase C-G 仍未完成；已有局部底座不能作为后续阶段成熟结论。

## 不在本阶段处理的内容

- 不实现 Phase C 的费用/Git/token P0。
- 不实现 Phase D 的工具/命令/Token 计数架构升级。
- 不补 Phase E 的 20 文件测试债。
- 不实现 Phase F/G provider、权限、MCP、remote、feature flag、memory、keybinding 能力。

## 下一阶段衔接

下一阶段：Phase C。重点触点为 `packages/config/src/index.ts`、`packages/tui/src/slash-command-runtime.ts`、`packages/tui/src/usage-stats-presenter.ts`、`packages/tui/src/shell/models/footer-view.ts`、`packages/tui/src/model-prompt-runtime.ts`、`packages/tui/src/context-estimator.ts`。

## 开发者排查入口

- 错误吞没：`packages/core/src/session-store.ts`、`packages/tui/src/break-cache-runtime.ts`、`packages/tui/src/workflow-command-runtime.ts`
- Shared constants/sanitizer：`packages/shared/src/index.ts`
- Provider usage：`packages/providers/src/index.ts`
- MCP stdio runner：`packages/tui/src/mcp-stdio-runtime.ts`
- Extension slash template：`packages/tui/src/extension-slash-runtime.ts`
- Handoff key files：`packages/tui/src/handoff-session-runtime.ts`

## 参考核对

本阶段实际读取 Linghun 文档见“文档事实核对”。没有读取或复制 `F:\ccb-source` 源码；Phase B 只依据 Linghun 自审清单和本仓源码事实实现。未复制可疑源码实现、内部 API、专有遥测或反编译痕迹。

## Handoff Packet

- 当前阶段：Phase B Self-Audit Fixes
- 状态：DONE，继续进入用户已明确要求的 Phase C
- 下一阶段：Phase C CCB 成熟度对齐 P0
- 禁止事项：不得把 C-G 局部已有能力视为阶段成熟；不得复制 CCB 可疑源码；不得跳过每阶段文档和验证
- 证据引用：`LINGHUN_DEVELOPMENT_ROADMAP.md` Phase B；本文件“测试与验证”
- 验证结果：typecheck PASS；Phase B focused tests PASS；full vitest deferred to Phase G final regression
- 索引状态：codebase-memory MCP 不可用；使用 `rg`/源码事实核对
- 权限模式：本地 unrestricted filesystem；未执行联网安装、依赖变更、发布或远程部署
- 模型/provider：Codex 本地开发会话；未调用 Linghun runtime provider
- 预算使用情况：未设置显式 token 预算；本阶段未新增运行时成本路径
