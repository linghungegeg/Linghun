# Phase 15.5C+：Log Artifact Runtime Lite

## 阶段目标

本轮只完成独立小阶段 Phase 15.5C+：Log Artifact Runtime Lite。目标是把既有“日志有路径”升级为“已知日志 / 输出 artifact 可被安全、有界、只读地切片查看”，覆盖 bounded tail、bounded grep、bounded error candidate extraction，以及 `/details output` summary-first 入口。

本轮不进入 Phase 15.5D/E/F，不进入 Phase 16/17/18，不执行真实全量 smoke，不声明 Beta PASS、smoke-ready 或 open-source-ready，不提交 commit，不实现 native/binary、sqlite/database、后台索引、模型自动日志摘要、根因判断或新的 PASS evidence 规则。

## 已完成功能

- 新增 Log Artifact Runtime Lite helper：只读读取已知 background/evidence 输出 artifact。
- 支持 bounded tail：默认 40 行，最多 200 行，只读取尾部有限字节窗口；即使小 artifact 完全落在窗口内，也会保守 withheld 至少一行，避免把完整日志放入主屏、prompt、memory 或 handoff。
- 支持 bounded grep：按用户 literal pattern 匹配，支持有限 context，限制 maxBytes、maxMatches、maxLines 和 timeout。
- 支持 bounded errors：用确定性候选模式提取 TypeScript/Vitest/Python/Bash 等错误候选，明确不判断 root cause、不改变 verification PASS/PARTIAL/FAIL 语义。
- 路径安全：background 侧继续允许已知 `background.outputPath` / `logPath`；evidence 侧只允许明确 log/output artifact：`fullOutputPath` / `outputPath` / `logPath`，或位于 `.linghun/logs/**` / known log root 内的 `source`；普通 workspace 源码、README、报告文件不会被当作日志 artifact 切片。
- 输出脱敏：对 Authorization、Cookie、Bearer、`sk-*`、api key/token/cookie 字段做保守 redaction。
- 扩展既有 `/details output`：新增 `--tail`、`--grep`、`--errors` 切片入口；无 slice 参数时仍展示原有 output path/status/summary，并提示可用 slice 命令。
- 增加 focused tests 覆盖大日志 tail、bounded grep/context、错误候选、CRLF/中文 UTF-8、未知 id、越界路径、截断提示、summary-first 输出和 verification 语义不变。

## 使用方式

```text
/details output <backgroundId|evidenceId> --tail [lines]
/details output <backgroundId|evidenceId> --grep <pattern> [--context N]
/details output <backgroundId|evidenceId> --errors
```

说明：

- `<backgroundId|evidenceId>` 只能指向 Linghun 已知的 background task 或 evidence artifact。
- `--tail` 只返回尾部有限行数和有限字节窗口；当小 artifact 会被完整命中时，输出会 withheld 至少一行并标记 truncated。
- `--grep` 使用 literal pattern，不执行任意正则；context 行数有上限。
- `--errors` 只返回 error candidates / extracted candidates，不给出根因判断。
- 任何 slice 输出都会声明 bounded read boundary，完整日志不会进入主屏、prompt、memory 或 handoff。

## 涉及模块

- `packages/tui/src/log-artifact.ts`：新增 Log Artifact Runtime Lite helper、类型、bounded tail/grep/errors、路径安全和 redaction。
- `packages/tui/src/log-artifact.test.ts`：新增 focused runtime tests。
- `packages/tui/src/index.ts`：最小扩展 `/details output` 参数解析和 artifact registry 组装。
- `packages/tui/src/index.test.ts`：新增 `/details output` slice summary-first 集成测试。
- `docs/delivery/phase-15-5c-plus-log-artifact-runtime-lite.md`：本交付报告。

Excluded existing diff：开工/接手时工作区已有若干旁路文档或研究文件改动，本轮没有把它们纳入 Log Artifact Runtime Lite 交付范围，包括 `docs/delivery/phase-15-5b-resource-task-lifecycle.md`、`docs/audit/log-slice-error-extract-helper-research.md`、`docs/audit/workspace-snapshot-helper-research.md` 以及当前工作区中非本阶段代码实现必需的 blueprint/spec/gate 文档 diff。以上不计入本轮完成内容。

## Source-Level Reality Check 摘要

### Existing implementation

- Bash 工具已有 `fullOutputPath`，会把完整命令输出写入 `.linghun/logs/tools/bash-*.log`。
- TUI 已有 `BackgroundTaskState.outputPath` / `logPath`，`/background`、`/details background`、`/details output` 已能展示任务状态、摘要和输出路径。
- Verification runtime 已有 `.linghun/logs/verification/...` 日志路径与 evidence 记录；cancelled / timeout / stale / failed verification 不会被提升为 PASS evidence。
- TUI tool output presenter 已有 summary-first 输出边界，长输出通过 details/path 追踪，不直接 dump 到主屏。

### Gaps

- 既有 `/details output` 只展示 path/status/summary，不能在 TUI 内安全查看大日志的有限切片。
- 没有统一的 bounded tail / grep / error candidate extraction helper。
- 用户若要排查日志，只能拿路径去外部查看，容易把完整日志带入主屏或对话上下文。
- 错误候选提取缺少明确语义边界：只能是诊断候选，不能改变 PASS/PARTIAL/FAIL 判定。

### Minimal touch points

- 新增一个小型 `packages/tui/src/log-artifact.ts` helper，而不是新增第二套 task/job/log/evidence 系统。
- 只在 `packages/tui/src/index.ts` 的既有 `/details output` 分支中接入 slice 参数。
- 只新增 focused tests，不修改 provider、permission、MCP/index、agent/job、tools Bash runtime 或 verification PASS 规则。

### Forbidden duplicate systems

本轮未新增第二套 background/job 系统、日志数据库、sqlite、native/binary、后台日志索引、模型日志摘要器、根因分类器、evidence runtime、verification runtime、MCP manager 或权限系统。

## 关键设计

### Artifact registry

`readLogArtifactSlice()` 不接受任意用户路径作为普通入口。TUI 只把当前会话内已知 background/evidence 转成 registry：

- background：`id`、`outputPath`、`logPath`，继续视为 background artifact。
- evidence：`id`、`source`、`fullOutputPath`、`outputPath`、`logPath`；其中 `source` 必须位于 `.linghun/logs/**` / known log root 内才视为 log artifact，普通 workspace 文件会被拒绝。
- roots：`workspaceRoot` 和 `.linghun/logs`

helper 会解析路径并确认其位于 workspace 或已知 log root 内；未知 id、无 artifact、非文件、越界路径或普通 evidence workspace 文件会返回清晰错误。

### Bounded reads

- tail：从文件尾部读取有限 byte window，并只返回最后 N 行；若窗口和行数会覆盖整个 artifact，则 withheld 至少一行并给出 warning，避免完整 artifact 进入主屏。
- grep/errors：通过 `createReadStream` + `readline` 流式扫描有限 byte window，限制 matches、output lines、context 和 timeout。
- 所有模式都返回 `truncated` 与 warning，提示用户缩小 pattern 或只在必要时增加 tail 行数。

### Redaction

`redactLogContent()` 会对以下常见敏感片段做保守替换：

- `Authorization: ...`
- `Cookie: ...`
- `Bearer ...`
- `sk-*`
- `api_key=...` / `token=...` / `cookie=...`

### Verification boundary

`errors` 模式只输出 error candidates，warning 中明确写出：这些候选不会改变 verification PASS/PARTIAL/FAIL 语义，也不识别 root cause。PASS evidence 仍只由既有 verification runtime 的真实状态决定。

## 配置项

本阶段未新增配置项，未修改依赖，未修改构建脚本。

## 命令

本阶段未新增全新 slash command；只扩展既有 `/details output`：

- `/details output <id> --tail [lines]`
- `/details output <id> --grep <pattern> [--context N]`
- `/details output <id> --errors`

## 测试与验证

Focused tests：

- `corepack pnpm exec vitest run packages/tui/src/log-artifact.test.ts`：PASS（1 file，9 tests）。
- `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "details output|background|verification|log"`：PASS（1 file，14 passed，115 skipped）。

Repository validation：

- `corepack pnpm typecheck`：PASS。
- `corepack pnpm check`：PASS。
- `git diff --check`：PASS（仅 Windows LF/CRLF warning，无 whitespace error）。
- `corepack pnpm test`：PASS（15 files，374 tests）。
- `corepack pnpm build`：PASS。

本轮未执行真实全量 smoke；上述 focused/local validation 不构成 Beta PASS、smoke-ready 或 open-source-ready 声明。

## 性能结果

- tail 不读取完整大日志，只读取尾部有界 byte window。
- grep/errors 使用 stream + readline 在有界 byte window 内扫描，不构建持久索引，不引入后台任务。
- 输出行数、匹配数、context、扫描字节和超时都有上限。
- 不新增数据库、sqlite、native/binary 或后台 indexing 成本。

## 已知问题

- `grep` 本阶段按 literal pattern 工作，不支持完整正则语义；这是为了避免扩大风险面。
- `errors` 是启发式候选提取，不保证覆盖所有语言/工具的错误格式，也不判断根因。
- Bash 工具本身仍沿用既有行为生成 `fullOutputPath`；本轮不改 Bash 输出采集模型。
- Evidence `source` 只有位于 `.linghun/logs/**` / known log root 内时才可作为 log artifact slice；普通 workspace 文件应使用 Read 或其他合适工具查看。
- 本轮未执行真实全量 smoke，因此不能宣称真实项目完整链路通过。

## 不在本阶段处理的内容

- Phase 15.5D/E/F。
- Phase 16/17/18。
- Workspace Snapshot Lite 的实现。
- MCP server add/install/remove/update 生命周期。
- Skills/plugins lifecycle。
- Provider/freshness/web evidence。
- Terminal release readiness 全面 polish。
- Native/binary、sqlite/database、后台日志索引。
- 模型自动日志摘要、根因判断、PASS evidence 规则变更。
- 第二套 task/job/evidence/verification/permission/MCP/index 系统。
- 真实全量 smoke、Beta PASS、smoke-ready、open-source-ready 决策。
- commit。

## 下一阶段衔接

从本轮局部实现和验证结果看，Log Artifact Runtime Lite 已具备进入后续工作的局部前置条件。是否进入 Workspace Snapshot Lite 或 Phase 15.5D 必须由用户明确决定；本轮不会自动进入 Phase 15.5D/E/F 或 Phase 16/17/18。

如果用户选择继续，建议优先由用户裁决下一步：

1. 独立小阶段 Workspace Snapshot Lite；或
2. 按原 gate 进入 Phase 15.5D Connect Lite。

## 开发者排查入口

- Log artifact runtime：`packages/tui/src/log-artifact.ts` 的 `readLogArtifactSlice()`、`readTail()`、`readGrep()`、`readErrors()`、`redactLogContent()`。
- `/details output` 接入：`packages/tui/src/index.ts` 的 `handleDetailsCommand()`、`parseLogArtifactRequest()`、`createLogArtifactRegistry()`。
- Focused runtime tests：`packages/tui/src/log-artifact.test.ts`。
- TUI integration test：`packages/tui/src/index.test.ts` 的 `reads known log artifacts through details output slices summary-first`。

## 参考核对

本阶段实际读取 / 使用的 Linghun 文档和源码上下文：

- `F:\Linghun\START_NEXT_CHAT.md`
- `F:\Linghun\docs\delivery\pre-open-source-terminal-product-completion-gate.md`
- `F:\Linghun\docs\audit\reference-map.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\docs\delivery\phase-15-5b-resource-task-lifecycle.md`
- `F:\Linghun\docs\delivery\phase-15-5c-editing-tool-ux.md`
- `F:\Linghun\docs\audit\log-slice-error-extract-helper-research.md`
- `F:\Linghun\packages\tui\src\tool-output-presenter.ts`
- `F:\Linghun\packages\tui\src\index.ts` targeted `/details`、background、verification、outputPath/logPath sections
- `F:\Linghun\packages\tools\src\index.ts` targeted Bash/stdout/stderr/fullOutputPath sections

本阶段参考核对范围：

- 只参考成熟终端产品和既有 Linghun 审计中的行为边界：长日志不进主屏、安全 details 入口、bounded slice、error candidates 非 PASS evidence、日志路径只读追踪。
- 进入 Linghun 自研实现的内容：bounded tail / grep / errors helper、artifact path allowlist、redaction、`/details output` slice 参数、focused tests。
- 未复制 CCB、CCB Dev Boost、Codex、Aider、MCP/codebase-memory 或其他第三方可疑源码实现、内部 API、专有遥测或内部服务逻辑。

### Reference delta catch-up 裁决表

| 来源细节 | 裁决 | Phase 15.5C+ 处理 |
| --- | --- | --- |
| reference-map / blueprint：长 stdout/stderr/log 不得 dump 到主屏或 prompt | DONE | Slice 输出 summary-first，明确 bounded read boundary；完整日志仍只通过 artifact path 保留。 |
| research：已有 logs/outputPath，但缺少 bounded in-app slice 入口 | DONE | `/details output <id> --tail/--grep/--errors`。 |
| research：只能读取已知 Linghun artifact，不做 arbitrary path reader | DONE | TUI 使用 background/evidence registry；helper 做 workspace/log root path check。 |
| evidence source tightening：普通 workspace/source/report 文件不得被当作 log artifact slice | DONE | evidence `source` 仅允许 `.linghun/logs/**` / known log root；明确 `fullOutputPath` / `outputPath` / `logPath` 仍可作为 artifact；普通文件返回“请用 Read 或其他合适工具查看”。 |
| research：tail 必须有 maxBytes/maxLines | DONE | tail 有默认/最大行数和固定最大 byte window。 |
| research：grep 必须 bounded matches/context/bytes/timeout | DONE | grep 限制 maxBytes、maxMatches、maxLines、contextLines、timeoutMs。 |
| research：errors 只提取 candidates，不判断 root cause | DONE | `errors` warning 明确 no root cause / no verification semantics change。 |
| research：redact token/API key/header/cookie | DONE | `redactLogContent()` 覆盖 Authorization、Cookie、Bearer、`sk-*`、api key/token/cookie。 |
| resource lifecycle：cancelled/timeout/stale/failed verification 不得变 PASS evidence | DONE | 本阶段不改 verification runtime；focused test 保留 verification status 不变断言。 |
| native/binary/ripgrep/sqlite/database | NOT-DO | 未引入。 |
| persistent log DB/index/background indexing | NOT-DO | 未实现。 |
| model automatic log summarization/root cause classifier | NOT-DO | 未实现。 |
| Phase 15.5D/E/F、Phase 16/17/18 | NOT-DO | 未进入。 |
| 真实全量 smoke、Beta PASS、smoke-ready、open-source-ready | NOT-DO | 未执行、未声明。 |

## 成品级结构化 handoff packet

- 下一阶段：可由用户决定进入 Workspace Snapshot Lite 或 Phase 15.5D；不得自动进入。
- 禁止事项：不得进入 Phase 15.5D-F / Phase 16 / 17 / 18；不得执行真实全量 smoke；不得宣称 Beta PASS、smoke-ready 或 open-source-ready；不得 commit；不得实现 native/binary、sqlite/database、后台日志索引、模型日志摘要、根因判断或 PASS evidence 规则变更；不得新增第二套 task/job/evidence/verification/permission/MCP/index 系统。
- 证据引用：`packages/tui/src/log-artifact.test.ts`、`packages/tui/src/index.test.ts` focused tests；本报告“测试与验证”命令输出。
- 验证结果：focused log artifact PASS；focused TUI details/background/verification/log PASS；typecheck PASS；check PASS；git diff --check PASS（仅 Windows LF/CRLF warning）；full test PASS；build PASS。
- 索引状态：`mcp__codebase-memory-mcp__index_status(project=F-Linghun)` 返回 ready（nodes=1472，edges=2844）。
- 权限模式：未修改四种 permission mode；Start Gate / permission pipeline 保持既有路径。
- 模型/provider：本地实现与测试 provider-agnostic；未写入或泄露 provider key。
- 预算使用：日志读取为 bounded byte/line/match/time window；未新增后台索引、数据库、native binary 或联网请求；完整日志不会进入主屏、prompt、memory 或 handoff。
- Commit 状态：本轮未 commit。
