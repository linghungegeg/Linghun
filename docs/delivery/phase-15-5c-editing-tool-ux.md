# Phase 15.5C：Editing & Tool UX

## 阶段目标

本轮只完成 Pre-Open-Source Terminal Product Completion Gate 的 Phase 15.5C：Editing & Tool UX。范围限定为 Write/Edit/MultiEdit 编辑 UX、MCP Runtime required-args/static registry execution guard + status / doctor metadata，以及 Bundled codebase-memory Lite 的保守运行时边界。

本轮不进入 Phase 15.5D/E/F，不进入 Phase 16/17/18，不执行真实全量 smoke，不声明 Beta PASS、smoke-ready 或 open-source-ready，不提交 commit，不新增第二套编辑器、diff runtime、permission runtime、evidence runtime、MCP 管理器或代码图索引系统，不实现 MCP server add/install/remove/update 生命周期，不修改四种 permission mode，不绕过 Start Gate 或权限管道。

## 已完成功能

- 强化 Write/Edit/MultiEdit 编辑 UX：既有文件写入必须基于最近 Read snapshot 或显式 `expectedHash`；若目标文件自上次 Read 后变化，会拒绝写入并提示重新 Read。
- Read 工具记录文件 snapshot：包括相对路径、sha256 hash、mtime、size、newline style，用于后续 stale / changed-on-disk 检测。
- Write/Edit/MultiEdit 成功后记录新的 snapshot，避免同一会话继续编辑时基于过期状态。
- Edit/MultiEdit 保留唯一匹配保护，并把失败恢复建议统一为“重新 Read 最新内容后重试”。
- Write/Edit/MultiEdit 输出 patch 摘要：changedFiles、addedLines、removedLines、operation、editCount、readGuard、before/after hash、encoding、newline 边界和 details preview。
- Diff 工具复用本轮编辑工具记录的 patch summary，展示本轮 changedFiles 的累计 + / - 行数。
- TUI tool-output presenter 将 Write/Edit/MultiEdit 纳入 summary-first 输出：主屏只展示补丁统计、changedFiles 数量、读取保护和 `/details` 提示，不 dump raw diff 或 evidence id。
- MCP Runtime execution-time guard 本轮实际闭合为 required-args/static registry guard：deferred MCP tool 未登记或缺少必需参数时拒绝执行；discovery/trusted/schemaLoaded/runtimeVersion 本轮仅作为 status/doctor metadata 和 guard policy 文案展示，不作为独立执行层强约束。
- MCP tools 摘要展示 discovery/trusted/schemaLoaded/runtimeVersion 稳定字段，但仍不输出完整 schema、密钥、token 或敏感配置；真实 schema/trust/runtime compatibility 执行层强约束留待后续 MCP lifecycle 阶段。
- `/mcp status` 明确写出 codebase-memory license/NOTICE 边界：Linghun-managed codebase-memory 必须随包携带 license/NOTICE metadata；外部 fallback 只报告为 external，不冒充 bundled。
- codebase-memory fast status / doctor / failure isolation 继续复用既有 runtime；默认 `/index status` 不触发 `detect_changes`，MCP/index 失败不阻塞普通聊天和本地工具。

## 使用方式

```text
/read <file>
/write <file> <content>
/edit <file> <oldText> <newText>
/multiedit <file> <edits>
/diff
/details
/mcp status
/mcp tools
/mcp doctor
/index status
/index status --fresh
/index doctor
```

说明：

- 对既有文件执行 Write/Edit/MultiEdit 前，必须先 Read 当前文件，或由调用方传入最新 `expectedHash`。
- 如果文件在 Read 与写入之间发生外部变化，工具会拒绝写入并提示重新 Read，不会静默覆盖。
- 新文件 Write 允许直接创建；创建后会记录新 snapshot。
- 主屏只展示摘要；patch details 保留在 tool output details / transcript 路径中。
- MCP/codebase-memory 的 status/doctor 只输出稳定摘要和 redacted path，不输出完整 schema、raw graph、key 或 token。

## 涉及模块

- `packages/tools/src/index.ts`：Read snapshot、expectedHash、stale detection、editing patch summary、Diff 累计 patch 摘要。
- `packages/tools/src/index.test.ts`：read-before-edit、stale file、expectedHash、patch summary focused tests。
- `packages/tui/src/tool-output-presenter.ts`：Write/Edit/MultiEdit summary-first 输出。
- `packages/tui/src/index.ts`：MCP required-args/static registry guard、MCP tool state 的 discovery/trust/schema/runtime metadata、status/doctor 文案、codebase-memory license/NOTICE 边界、index ignore 写入 expectedHash。
- `packages/tui/src/index.test.ts`：MCP registry guard/status 和 editing output summary-first focused tests。
- `docs/delivery/README.md`：新增 Phase 15.5C 阶段索引行，属于本轮 15.5C 文档更新。
- `docs/delivery/phase-15-5c-editing-tool-ux.md`：本交付报告。

Excluded existing diff：开工前工作区已有 `docs/delivery/phase-15-5b-resource-task-lifecycle.md` 修改；该 diff 属于接手前/旁路已有改动，不计入本轮 15.5C 交付范围，本阶段实现未依赖、未覆盖该既有 diff。

## Source-Level Reality Check 摘要

- existing implementation：Write/Edit/MultiEdit 已在既有 `@linghun/tools` runtime 内；TUI 已有 permission pipeline、tool_result continuation、transcript、evidence、checkpoint/changedFiles、tool-output presenter、MCP status/doctor 和 codebase-memory resolution/index fast path。
- gaps：编辑工具缺少用户可见 read-before-edit/stale file 保护，缺少 patch summary/details，Diff 未汇总编辑 patch 统计，TUI 对编辑输出未 summary-first；MCP 执行层已有 required-args/static registry guard，但缺少真实 schema/trust/runtime compatibility 强约束，status/doctor 也缺少显式 discovery/trust/schema/runtime 状态语义和 license/NOTICE 边界。
- minimal touch points：只在既有 tools runtime、TUI presenter、TUI MCP/index runtime 和对应 focused tests 中局部补齐；不新增模块、不扩散到 provider、plugin、skill、job 或 remote channel。
- forbidden duplicate systems：未新增第二套编辑器、diff runtime、permission runtime、evidence/transcript runtime、MCP manager、代码图索引系统、agent/job 系统或远程控制系统。

## 关键设计

### Editing UX

本阶段把 read-before-edit 作为工具执行层不变量，而不是仅靠提示词：

- `Read` 读取文件后记录 `{ path, hash, mtimeMs, size }` snapshot。
- `Write` / `Edit` / `MultiEdit` 对已存在文件要求：
  - 最近 snapshot 与磁盘一致；或
  - 输入提供 `expectedHash` 且与当前磁盘 hash 一致。
- 若 snapshot 缺失，报“编辑前未读取”。
- 若 snapshot/hash/mtime/size 不一致，报“文件已变化 / 自上次 Read 后被修改”。
- 新文件 Write 不强制先 Read，但写入后记录 snapshot。

Patch summary 使用轻量行级统计，进入既有 `ToolOutput.data/details/changedFiles`；主屏由 presenter 摘要展示，避免 raw diff 污染主屏。

### MCP Runtime Guard / Status / Doctor

本阶段只补 required-args/static registry 执行守门与 status/doctor 状态语义：

- `validateCodebaseMemoryToolExecution()` 是当前真实 execution-time guard：deferred MCP tool 未在静态 registry 内，或缺少 registry 声明的 required args 时，拒绝执行并提示先 `/mcp doctor` 或使用已登记工具入口。
- MCP tool list 保存 `discovery`、`trusted`、`schemaLoaded`、`runtimeVersion` 稳定字段，但这些字段本轮只作为 status/doctor metadata 与 guard policy 文案展示，不作为逐次执行的独立强约束。
- `/mcp status` 明确展示 registry guard policy 和 codebase-memory license/NOTICE 边界；真实 schema/trust/runtime compatibility execution guard 留待后续 MCP lifecycle 阶段。
- 不实现 MCP server add/install/remove/update；不实现 skill/plugin lifecycle。

### Bundled codebase-memory Lite

继续复用既有 codebase-memory runtime：env override、configured override、Linghun-managed path、PATH fallback、missing/corrupt/unsupported degradation、fast status / fresh check 区分。

本阶段只在 status/doctor 层明确：Linghun-managed codebase-memory 若用于发布包，必须携带 license/NOTICE metadata；外部 fallback 只作为 external runtime 报告，不冒充随包内置完成。

## 配置项

本阶段未新增配置项，未修改依赖，未修改构建脚本。

## 命令

本阶段未新增全新 slash command；扩展/强化既有命令行为：

- `/read`：记录编辑前 snapshot。
- `/write` / `/edit` / `/multiedit`：执行 read-before-edit / expectedHash / stale file guard，输出 patch summary。
- `/diff`：展示本轮工具改动累计 + / - 行数。
- `/mcp status` / `/mcp tools` / `/mcp doctor`：展示 required-args/static registry guard policy、discovery/trust/schema/runtime metadata 和 codebase-memory license/NOTICE 边界；不把 metadata 冒充为执行层强约束。
- `/index status` / `/index doctor`：继续复用 fast/fresh 和 doctor 语义，不自动全量刷新。

## 测试与验证

Focused tests（本轮已执行）：

- `corepack pnpm exec vitest run packages/tools/src/index.test.ts`：PASS（1 file，7 tests）。
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "deferred codebase-memory|MCP/index runtime|editing output summary-first|summary-first|codebase-memory|index status"`：PASS（1 file，13 passed，115 skipped）。

Repository validation（本轮已执行）：

- `corepack pnpm typecheck`：PASS。
- `corepack pnpm check`：PASS。
- `git diff --check`：PASS（仅有 Windows LF/CRLF 提示，无 whitespace error）。
- `corepack pnpm test`：PASS（14 files，366 tests）。
- `corepack pnpm build`：PASS。

本轮不执行真实全量 smoke；上述 focused/local validation 不构成 Beta PASS、smoke-ready 或 open-source-ready 声明。

## 性能结果

- Read snapshot 只保存当前会话内相对路径、hash、mtime、size 和 newline metadata，不缓存完整源码到长期存储。
- Stale check 使用当前目标文件的 stat/hash，与单文件读写同阶，不引入后台轮询或全量扫描。
- Patch summary 为轻量行级统计，只针对本次编辑前后内容计算，不引入第二套 diff engine。
- MCP tools 状态只保留稳定短 metadata，不缓存完整 schema 或 raw graph。
- codebase-memory `/index status` 默认 fast path，仍不运行 `detect_changes`。

## 已知问题

- Patch summary 是轻量行级统计，不是完整语义 diff，也不是 IDE rich diff。
- 终端 permission prompt 仍是 summary-first 文本确认，不是完整 rich permission modal 或 allow-always editor。
- codebase-memory 真实随包 artifact 的跨平台 release packaging、license/NOTICE 文件分发仍需在后续 release readiness / packaging 验收中复核。
- MCP server add/install/remove/update 生命周期不在本阶段处理。
- 本轮未执行真实全量 smoke，因此不能宣称真实项目完整链路通过。

## 不在本阶段处理的内容

- Phase 15.5D/E/F。
- Phase 16/17/18。
- MCP server add/install/remove/update 生命周期。
- Skills / plugins install lifecycle。
- Provider/freshness/web evidence。
- Terminal release readiness 全面 polish。
- Rich IDE diff、完整 permission modal、allow-always rules editor。
- Durable jobs、Virtual Agent Concurrency、remote channels。
- 第二套编辑器、diff runtime、permission runtime、evidence runtime、MCP manager、代码图索引系统。
- 真实全量 smoke、Beta PASS、smoke-ready、open-source-ready 决策。

## 下一阶段衔接

Phase 15.5C 完成后必须停止，由用户决定是否进入 Phase 15.5D。不得自动进入 Phase 15.5D/E/F、Phase 16/17/18，也不得把本轮 focused/local validation 解释为真实全量 smoke 或产品 ready。

## 开发者排查入口

- Editing runtime：`packages/tools/src/index.ts` 的 `readTool()`、`writeTool()`、`editTool()`、`multiEditTool()`、`ensureReadBeforeEdit()`、`createEditOutput()`。
- Patch summary：`createPatchSummary()`、`createPatchDetails()`、`diffTool()`。
- TUI editing output：`packages/tui/src/tool-output-presenter.ts` 的 `createSummaryFirstPreview()` / `isEditingTool()`。
- MCP status/doctor：`packages/tui/src/index.ts` 的 `createMcpState()`、`runMcpDoctor()`、`formatMcpStatus()`、`formatMcpTools()`。
- Deferred MCP guard：`validateCodebaseMemoryToolExecution()`。
- Bundled codebase-memory runtime：`getCodebaseMemoryResolution()`、`refreshIndexStatus()`、`runCodebaseMemoryCli()`。

## 参考核对

本阶段实际读取的 Linghun 文档：

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\START_NEXT_CHAT.md`
- `F:\Linghun\docs\delivery\pre-open-source-terminal-product-completion-gate.md`
- `F:\Linghun\docs\delivery\phase-15-5a-performance-context.md`
- `F:\Linghun\docs\delivery\phase-15-5b-resource-task-lifecycle.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\audit\reference-map.md`
- `F:\Linghun\docs\audit\phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md`
- `F:\Linghun\docs\audit\phase-15-pre-smoke-a-c-combined-acceptance.md`
- `F:\Linghun\docs\audit\phase-15-ccb-grade-default-runtime-reconciliation.md`
- `F:\Linghun\docs\audit\phase-15-bundled-codebase-memory-lite.md`
- `F:\Linghun\PHASE_15_BETA_CCB_MATURITY_REMEDIATION_BASELINE.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`（targeted sections）
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`（targeted sections）
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`（targeted sections）

本阶段参考核对范围：

- 只参考 CCB / CCB Dev Boost / Codex / Aider / MCP/codebase-memory 成熟产品的行为边界：read-before-edit、stale file、diff preview、permission summary、deferred tool discovery-before-execute、schema/trust/runtime guard、fast status、doctor、失败隔离和 license/NOTICE 边界。
- 进入 Linghun 自研实现的内容：工具执行层 read-before-edit/stale guard、ToolOutput patch summary、TUI summary-first editing output、MCP required-args/static registry execution guard、MCP status/doctor metadata 与 codebase-memory license/NOTICE 状态语义。
- 未复制 CCB、CCB Dev Boost、Codex、Aider、codebase-memory-mcp 或其他第三方可疑源码实现、内部 API、专有遥测或内部服务逻辑。

### Reference delta catch-up 裁决表

| 来源细节 | 裁决 | Phase 15.5C 处理 |
| --- | --- | --- |
| `reference-map` / blueprint：Write/Edit/MultiEdit 必须 read-before-edit | DONE | `Read` 记录 snapshot；已存在文件写入必须匹配 snapshot 或 `expectedHash`。 |
| `reference-map` / blueprint：stale file / changed-on-disk 不得静默覆盖 | DONE | snapshot/hash/mtime/size 不一致时拒绝写入并提示重新 Read。 |
| `reference-map` / blueprint：编辑失败原因可操作 | DONE | oldText 未找到/不唯一、文件不存在、stale 均提示下一步。 |
| `reference-map` / blueprint：成功后有 changedFiles / patch 摘要 | DONE | `ToolOutput.data/details/changedFiles` 写入 operation、+/-、hash、newline、encoding；Diff 汇总 patch summary。 |
| baseline：权限审批能看到影响范围，主屏 summary-first | DONE | 复用既有 permission scope；presenter 对编辑工具只展示摘要和 details 提示，不 dump raw diff。 |
| reconciliation：拒绝/失败必须回到 model-visible tool_result | DONE | 沿用既有 permission/tool_result continuation，不新造。 |
| reconciliation：MCP deferred tool discovery-before-execute | PARTIAL / DONE(runtime registry guard only) | `validateCodebaseMemoryToolExecution()` 真实执行层只拒绝未知工具和缺参；discovery/schema/trust/runtime 本轮为 status/doctor metadata 与 guard policy 文案，不是逐次执行强约束。 |
| blueprint/spec：未发现、未注册、未信任、schema 未加载或版本不兼容不得执行 | PARTIAL / DONE(runtime registry guard only) | status/tool metadata 显示 discovery/trusted/schemaLoaded/runtimeVersion；执行层保持 required-args/static registry guard，未实现真实 schema/trust/runtime compatibility 强约束。 |
| reference-map：MCP/status/doctor 不得 dump schema/key/token | DONE | `/mcp status`、`/mcp tools` 只输出稳定短摘要和 redacted path。 |
| codebase-memory Lite：fast status、doctor、失败隔离 | DONE | 复用既有 fast/fresh runtime；默认不 detect_changes；missing/corrupt/unsupported 不阻塞普通聊天。 |
| codebase-memory Lite：license/NOTICE 记录 | DONE（runtime boundary） | `/mcp status` 明确 Linghun-managed codebase-memory 必须随包携带 license/NOTICE metadata；真实发布物料仍后续复核。 |
| rich IDE diff、完整 permission modal、allow-always editor | DEFERRED | 不在本阶段实现；本阶段只做 terminal summary/details。 |
| MCP server add/install/remove/update 生命周期 | DEFERRED | Phase 15.5D。 |
| skills/plugins install lifecycle | DEFERRED | Phase 15.5D。 |
| provider/freshness/web evidence | DEFERRED | Phase 15.5E。 |
| terminal release readiness 全面 polish | DEFERRED | Phase 15.5F。 |
| durable jobs、virtual agent concurrency、remote channels | DEFERRED | Phase 17A/17B。 |
| 修改 permission modes、Start Gate、permission pipeline | NOT-DO | 本轮未修改。 |
| 复制 CCB/Codex/第三方源码、内部 API、专有遥测 | NOT-DO | 仅参考行为边界，自研局部补丁。 |
| 真实全量 smoke、Beta PASS、smoke-ready、open-source-ready | NOT-DO | 本轮未执行、未声明。 |

## 成品级结构化 handoff packet

- 下一阶段：可由用户决定是否进入 Phase 15.5D；不得自动进入。
- 禁止事项：不得进入 Phase 15.5D-F / Phase 16/17/18；不得执行真实全量 smoke；不得宣称 Beta PASS、smoke-ready 或 open-source-ready；不得 commit；不得新增第二套 editor/diff/permission/evidence/MCP/index/job 系统；不得实现 MCP install lifecycle、durable jobs 或 remote channels；不得修改四种 permission mode 或绕过 Start Gate/permission pipeline。
- 证据引用：`packages/tools/src/index.test.ts`、`packages/tui/src/index.test.ts` focused tests；本报告“测试与验证”命令输出。
- 验证结果：focused tools PASS；focused TUI PASS；typecheck PASS；check PASS；git diff --check PASS（仅 Windows LF/CRLF 提示）；full test PASS；build PASS。
- 索引状态：`mcp__codebase-memory-mcp__index_status(project=F-Linghun)` 返回 ready（nodes=1468，edges=2819）。
- 权限模式：未修改四种 permission mode；Start Gate / permission pipeline 保持既有路径。
- 模型/provider：本地实现与测试 provider-agnostic；未写入或泄露 provider key。
- 预算使用：Editing snapshot 仅保留会话内 hash/stat 元数据；MCP/index 默认 fast path；未运行真实全量 smoke；未发额外联网请求。
