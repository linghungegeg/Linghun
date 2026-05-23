# Pre-Smoke P2 Closure Hardening

## 状态声明

- 本轮性质：Pre-Smoke P2 closure hardening，只做小修、澄清和可验证收口。
- 未运行真实 provider。
- 未使用真实 provider key。
- 未进入真实项目 smoke。
- 未提交 commit。
- 当前仍不是 Beta PASS / smoke-ready / open-source-ready。
- 本轮不重做 P1；P1 基础收口以 `docs/delivery/pre-smoke-p1-p2-remediation-closure.md` 为准。

## 修改文件清单

- `README.md`：开源门面移除本机真实测试项目路径，改为“用户指定真实测试项目”。
- `docs/delivery/real-project-smoke-checklist.md`：补真实 smoke 记录模板，明确 mock/local/focused PASS 不能算 live PASS，并记录 ignore / index 边界字段。
- `docs/delivery/phase-17-pre-smoke-index-ts-split-plan.md`：补 P2 closure linkage，明确除 Index Project Identity Reconciliation Lite 外不做大拆代码。
- `packages/tui/src/index.ts`：补 Index Project Identity Reconciliation Lite；补 `/index status` project selection 来源；补 `webhook_mock` 和 MCP placeholder 用户可见边界文案。
- `packages/tui/src/index.test.ts`：补 index project identity focused tests；补 `webhook_mock` diagnostic/test-only 与 MCP placeholder 安全占位断言。
- `docs/delivery/pre-smoke-p2-closure-hardening.md`：新增本报告。

## P2-1 到 P2-7 Closure 表

| 项 | Closure | 本轮动作 | 裁决 |
| --- | --- | --- | --- |
| P2-1 Remote `webhook_mock` | 确认为 diagnostic/test-only dry run，不代表真实 remote delivery PASS | `/remote status` 在出现 `webhook_mock` 时输出 diagnostic/test-only 边界；focused test 覆盖 | CLOSED_FOR_PRE_SMOKE |
| P2-2 MCP `placeholder` | 确认为安全占位摘要，不是假实现，不代表 trusted/schema loaded/executable | `/mcp tools` 增加 placeholder 安全占位说明；focused test 覆盖 `schemaLoaded=no` | CLOSED_FOR_PRE_SMOKE |
| P2-3 Hard skip dirs | `.linghunignore` / `.cbmignore` 可覆盖索引风险与 hard skip 相关边界 | 真实 smoke checklist 模板新增 ignore / index notes 字段；代码中已有 `readIndexIgnorePatterns()` 读取两类文件 | CLOSED_FOR_PRE_SMOKE |
| P2-4 Bundled codebase-memory | 当前不是 bundled release artifact PASS；保留 env / managed / PATH fallback 边界 | 实现 Index Project Identity Reconciliation Lite；未实现 bundled package，未新增安装器 | CLOSED_FOR_PRE_SMOKE |
| P2-5 Release artifact | 仅文档 closure，归 release/open-source packaging gate | 本报告明确本轮不做 release artifact，不改 publish 流程 | CLOSED_FOR_PRE_SMOKE |
| P2-6 `index.ts` 剩余拆分 | 已并入拆分计划；本轮不做大拆 | `phase-17-pre-smoke-index-ts-split-plan.md` 补 P2 linkage | CLOSED_FOR_PRE_SMOKE |
| P2-7 focused/mock/local tests | Mock/local/focused PASS 不能算 live PASS | `real-project-smoke-checklist.md` 补真实 smoke 记录模板与 PASS/BLOCKED/FAIL 字段 | CLOSED_FOR_PRE_SMOKE |

## Index Project Identity Reconciliation Lite

### 代码事实

- 原 `findCurrentIndexProject(data, projectPath)` 只按 `root_path` 与当前 `projectPath` 精确匹配。
- `/index status` 默认 fast path 已是 `list_projects` + `index_status`，不自动调用 `detect_changes`。
- `/index status --fresh` 与 `/index check` 才调用 `detect_changes`。
- `index search` / `index architecture` 通过 `runIndexQuery()` 调用 `refreshIndexStatus()`，只有 `context.index.status === "ready"` 且 `context.index.projectName` 确定时才执行查询。

### 实现摘要

- 保留 `root_path` 精确匹配为最高优先级，匹配时 `projectSelectionSource=root_path`。
- `root_path` 匹配失败后，从当前 `projectPath` 动态生成候选名：
  - basename，例如 `Linghun` / `sample-project`。
  - Windows drive + basename，例如 `F-Linghun` / `F-sample-project`。
- 候选匹配大小写不敏感。
- 只有唯一 name candidate 匹配时才采用，来源为 `name-candidate`。
- 多个候选或歧义时不猜，保持 `missing`。
- `/index status` 输出新增 `project selection: root_path|name-candidate|missing`。
- 未硬编码 `F-Linghun`。
- 未自动刷新索引。
- 未自动运行 `detect_changes`。
- 未改变 `/index status` 默认 fast path。

### Focused tests

已覆盖：

- root_path 精确匹配优先。
- root_path 缺失但 basename 候选唯一匹配时可识别。
- Windows drive + basename 候选从项目路径动态推导，不硬编码。
- 多个候选歧义时不猜。
- `/index status` 默认仍只调用 `list_projects` + `index_status`，不调用 `detect_changes`。
- `/index status --fresh` / `/index check` 才调用 `detect_changes`。

## 安全边界

- 未运行真实 provider。
- 未使用真实 key。
- 未写入真实 provider key、raw provider request、完整 provider response 或完整日志。
- README 与真实 smoke checklist 不再出现本机真实测试项目路径，已改为“用户指定真实测试项目”。
- 本轮不宣布 Beta PASS / smoke-ready / open-source-ready。
- 本轮不做真实 bundled codebase-memory package，不新增安装器。
- 本轮不做 release artifact，不改 package publish 流程。

## 验证结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "index status|codebase-memory|fresh|remote channels|MCP"` | PASS：1 file，27 passed，129 skipped |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm check` | PASS |
| `corepack pnpm build` | PASS |
| `git diff --check` | PASS |
| README / 真实 smoke checklist 真实测试项目路径搜索 | PASS：README 与 checklist 无本机真实测试项目路径匹配 |
| 新增/修改文件 secret 扫描 | PASS：文档无 `sk-` 匹配；`packages/tui/src/index.test.ts` 仅含既有假测试夹具/脱敏断言；本轮未新增真实 key |

## 是否可以进入 TUI polish / 美化阶段

可以进入 TUI polish / 美化阶段的用户决策点，但这不是自动进入真实 provider / 真实项目 smoke，也不是 Beta PASS / smoke-ready / open-source-ready。

建议边界：

- TUI polish / 美化阶段只能做用户可见输出、布局、文案、渐进披露和低风险交互 polish。
- 不进入真实 provider smoke，除非用户另行明确确认并临时注入 key。
- 不把本轮 focused/mock/local 验证写成 live PASS。
- 不在 polish 阶段顺手重构 `index.ts` 大模块，除非用户明确要求并单独通过 Start Gate。

## Handoff Packet

```json
{
  "phase": "pre-smoke-p2-closure-hardening",
  "date": "2026-05-23",
  "scope": "P2 closure hardening only; no real provider, no real project smoke, no commit",
  "indexProject": "F-Linghun",
  "indexStatusAtStart": "ready",
  "changedFiles": [
    "README.md",
    "docs/delivery/real-project-smoke-checklist.md",
    "docs/delivery/phase-17-pre-smoke-index-ts-split-plan.md",
    "packages/tui/src/index.ts",
    "packages/tui/src/index.test.ts",
    "docs/delivery/pre-smoke-p2-closure-hardening.md"
  ],
  "notDone": [
    "real provider smoke",
    "real project smoke",
    "Beta PASS",
    "smoke-ready",
    "open-source-ready",
    "release artifact",
    "bundled codebase-memory package",
    "commit"
  ],
  "nextDecision": "User may choose TUI polish / 美化阶段; real smoke remains separate and requires explicit confirmation."
}
```
