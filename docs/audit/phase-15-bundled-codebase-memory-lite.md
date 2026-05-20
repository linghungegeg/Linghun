# Phase 15 Batch 3.5：Bundled codebase-memory Lite 接管收口报告

日期：2026-05-21

## Executive verdict

**Scoped PASS for Batch 3.5 handoff closure.**

本轮已完成上一窗口 Batch 3.5 / Bundled codebase-memory Lite 接管检查、最小补齐、Windows shim runtime 边界修复、文档边界收口与本地验证。当前结论只表示：Linghun 的 codebase-memory runtime resolution、Windows `.cmd` / `.bat` / `.ps1` shim wrapping、`/index doctor`、fast/fresh status、missing/corrupt/unsupported graceful degradation 与 summary-first 输出在 focused/mock/local 验证中通过。

这不是 Phase 15 Beta PASS；不宣布 Beta readiness PASS；不进入 Phase 15 Beta / Phase 15.5 / Phase 16+。

## Scope

本轮范围：

- 接管上一窗口遗留 diff，不回滚、不重写已有改动。
- 确认并补齐 Batch 3.5 的 codebase-memory binary resolution 与 `/index` 诊断行为。
- 保持 Phase 10 交付文档口径：Phase 10 仍只是 external CLI / MCP 最小闭环。
- 新增本报告，作为 Batch 3.5 独立收口证据。

明确未做：

- 未做自研索引引擎。
- 未做 MCP marketplace。
- 未 vendored / 打包真实 codebase-memory binary。
- 未做自动全量重建。
- 未做后台常驻重索引。
- 未进入 Phase 15 Beta。
- 未进入 Phase 15.5。
- 未进入 Phase 16+。
- 未宣布 Beta PASS。

## Handoff findings

接管时确认上一窗口已经留下以下主要改动：

- `packages/tui/src/index.ts`
  - 已新增或修改 `pathExists(path: string): Promise<boolean>`。
  - 已新增 codebase-memory binary probing / runtime resolution 相关逻辑，包括 `probeCodebaseMemoryBinary(...)`、managed path 查找、PATH fallback、version probe。
  - 已把 `/index status` 默认 fast，与 `/index status --fresh` / `/index check` 的 `detect_changes` 行为区分开。
- `packages/tui/src/index.test.ts`
  - 已新增 resolution order、fast/fresh status、missing/corrupt/unsupported degradation、summary-first index 输出等 focused tests。
- `docs/delivery/phase-10-mcp-index.md`
  - 已补一行边界说明，强调 Phase 10 `done` 不回填 Bundled codebase-memory Lite。

接管检查命令：

```bash
git status --short
git diff -- packages/tui/src/index.ts packages/tui/src/index.test.ts packages/config/src/index.ts packages/config/src/index.test.ts docs/delivery/phase-10-mcp-index.md
git diff -- docs/audit/phase-15-bundled-codebase-memory-lite.md
```

接管时 `docs/audit/phase-15-bundled-codebase-memory-lite.md` 尚不存在，没有可查看 diff。

## Implemented behavior

本轮沿上一窗口实现做最小补齐：

- `/index status` / `/index doctor` 输出包含：
  - binary source：`env` / `managed` / `path` / `missing`。
  - binary status：`ready` / `missing` / `corrupt` / `unsupported`。
  - version/probe 状态。
  - artifact status。
  - runtime summary。
  - next action。
- binary command 和 artifact path 只输出安全摘要，例如 `present:codebase-memory-mcp.cjs`，不输出完整私有路径。
- Windows `.cmd` / `.bat` shim 不再直接 `spawn(shimPath, ...)`，改为 `cmd.exe /d /c call <shimPath> ...`，避免 Node 24 直接 spawn npm/Windows shim 的 `EINVAL` 边界。
- Windows `.ps1` shim 不再直接 `spawn(ps1Path, ...)`，改为 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <ps1Path> ...`，避免直接 spawn PowerShell script 的 `EFTYPE` 边界。
- `runCommandCapture(...)` 捕获 `spawn(...)` 同步抛错，返回 `exitCode=127` 与脱敏 summary，不允许 TUI 崩溃。
- command failure / timeout summary 做脱敏处理，避免把 key、Bearer token、`api_key=...` 或 `prompt=...` 放进主屏诊断。
- missing/corrupt/unsupported runtime 时，`/index status` 降级为 missing/error 摘要，不阻断普通聊天。
- search / architecture 仍保持短摘要，不把 raw source 或 full graph dump 到 primary output。

## Resolution order

当前 codebase-memory binary resolution 顺序为：

1. `LINGHUN_CODEBASE_MEMORY_MCP` env override。
2. 显式配置的非默认 `mcp.servers["codebase-memory"].command`（按 env/override source 处理）。
3. Linghun managed path：
   - project `.linghun/bin/codebase-memory-mcp`。
   - configured index storage 下的 `bin/codebase-memory-mcp`。
   - user data storage 下的 `bin/codebase-memory-mcp`。
4. PATH 中的 `codebase-memory-mcp` fallback。
5. 全部不可用时 graceful degradation 为 `source=missing` / `binary status=missing`。

Windows 兼容 probing 覆盖 `.cmd` / `.bat` / `.exe` / `.ps1` / `.cjs` / bare command：`.cjs` 使用 `process.execPath`；`.cmd` / `.bat` 使用 `cmd.exe /d /c call` 包装；`.ps1` 使用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File` 包装；`.exe` 和 bare command 保持直接 spawn。`detailPath` 仍保留原始 shim path 供内部判断，但主屏只显示 `present:<basename>`。

## Fast vs fresh status behavior

默认 fast/local 行为：

- `/index status` 只执行 runtime probe、`list_projects` 和 `index_status`。
- 不触发 `detect_changes`。
- 输出 `fast status：未运行 detect_changes；需要新鲜度检查请用 /index status --fresh 或 /index check。`

显式 fresh 行为：

- `/index status --fresh` 和 `/index check` 才执行 `detect_changes`。
- 若发现 changed files，输出 summary-first stale hint，例如 `detect_changes 发现 N 个变更文件，建议运行 /index refresh；不会自动刷新。`
- 不自动 refresh、不自动 rebuild、不后台重索引。

## Failure/degradation behavior

覆盖的失败/降级行为：

- missing binary：`status: missing`，提示配置 `LINGHUN_CODEBASE_MEMORY_MCP` 或安装/修复 Linghun-managed codebase-memory，普通聊天不受影响。
- corrupt binary：`--version` 非 0 时标记 `binary status: corrupt`，不继续执行 MCP/index tools。
- unsupported binary：`--version` 无可解析 semver 时标记 `binary status: unsupported`，不继续执行 MCP/index tools。
- missing artifact：runtime 可用但当前项目 artifact 不存在时提示 `/index init fast`。
- stale artifact：只提示 `/index refresh`，不会自动刷新。
- slow check unavailable：`detect_changes` 不可用时保留 `index_status` 结果并输出降级提示。
- 输出限制：主屏只显示摘要，不刷大日志、不输出完整私有路径、不输出 raw source/full graph。

## Files changed

本轮相关文件：

- `packages/tui/src/index.ts`
  - 接管上一窗口 codebase-memory resolution / probing / fast-fresh status 实现。
  - 本轮补齐 binary command 安全摘要、诊断脱敏、Windows `.cmd` / `.bat` / `.ps1` shim 包装、`spawn(...)` 同步抛错捕获与 format 收口。
- `packages/tui/src/index.test.ts`
  - 接管上一窗口 focused tests。
  - 本轮补充/强化私有路径不泄露断言，新增 Windows-only PATH `.cmd` shim focused test，并格式化。
- `docs/delivery/phase-10-mcp-index.md`
  - 保持 Phase 10 口径：Phase 10 done 仍只表示 external CLI / MCP 最小闭环；Batch 3.5 不回填旧 Phase 10 done。
- `docs/audit/phase-15-bundled-codebase-memory-lite.md`
  - 本报告。

工作区中还存在接管前已有的文档改动：

- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/README.md`
- `docs/delivery/phase-ownership-release-gate-audit-2026-05-21.md`（untracked）

这些文件不是本轮 Batch 3.5 代码补丁的主要修改对象；本轮未回滚或重写它们。

## Tests/validation

已运行：

```bash
corepack pnpm exec vitest run packages/tui/src/index.test.ts -t "codebase-memory|index status fast|fresh check|PATH"
```

结果：PASS，1 file / 9 passed / 104 skipped；包含 Windows-only PATH `.cmd` shim ready probe、env > managed > PATH、fast 默认不 `detect_changes`、fresh/check 才 `detect_changes`。

```bash
corepack pnpm vitest run packages/tui/src/index.test.ts packages/config/src/index.test.ts
```

结果：PASS，2 files / 126 tests（Batch 3.5 接管验证；Windows shim fix 后的完整回归见下方 `corepack pnpm test`）。

```bash
corepack pnpm check
```

结果：PASS，Biome checked 47 files，no fixes applied。

```bash
corepack pnpm typecheck
```

结果：PASS，`tsc -b tsconfig.json` 完成。

```bash
corepack pnpm test
```

结果：PASS，11 files / 306 tests。

```bash
corepack pnpm build
```

结果：PASS，workspace packages build 完成。

```bash
git diff --check
```

结果：PASS。Git 仍提示 LF/CRLF 工作区换行提醒，但没有 whitespace error。

补充说明：首次串行 validation 在 `corepack pnpm check` 处发现 Biome formatting drift；已对 `packages/tui/src/index.ts` 与 `packages/tui/src/index.test.ts` 执行格式化后，完整验证链路重跑通过。

## Index status

代码库索引检查：

```text
mcp__codebase-memory-mcp__index_status(project=F-Linghun)
```

结果：ready，nodes=1309，edges=2450。

```text
mcp__codebase-memory-mcp__detect_changes(project=F-Linghun)
```

结果：changed_count=7（当时包括已有修改的规格/蓝图/README/Phase 10 文档/TUI 文件；本报告写入后工作区会新增本报告）。未刷新或重建索引。

## Remaining risks

- 尚未验证真实随包 artifact 的 license/NOTICE、跨平台安装布局、release packaging；当前只是 runtime resolution 与 mock/local behavior 收口。
- 未做真实 provider + 真实项目 smoke；因此不能从本轮 PASS 推导 Phase 15 Beta PASS。
- 当前 managed path resolution 支持 Linghun 管理路径，但仓库内未 vendored 真实 codebase-memory binary。
- PATH fallback 依赖用户环境；如果 PATH 中存在多个同名 binary，只按 PATH 顺序选择第一个可探测候选。
- 本轮只保证 `/index status` 默认不跑 `detect_changes`；其他显式 index 操作仍必须继续走已有安全门与用户显式命令。

## Phase boundary statement

本报告明确：

- 未进入 Phase 15 Beta。
- 未进入 Phase 15.5。
- 未进入 Phase 16+。
- 不宣布 Phase 15 Beta readiness PASS。
- Batch 3.5 scoped PASS 只代表 Bundled codebase-memory Lite runtime resolution / diagnostics / degradation 的 focused/mock/local 收口。

## 是否可进入真实项目 smoke

从 Batch 3.5 本地验证角度，**可以进入真实项目 smoke 的人工审核点**，建议下一步只做真实项目 smoke，不自动扩大到 Phase 15.5 / Phase 16+。

进入前仍需用户明确确认，并准备：

- 真实项目路径。
- 真实 provider/model 配置。
- 是否存在真实 managed codebase-memory binary 或仅使用 PATH fallback。
- smoke 输出报告路径。

再次强调：这不是 Beta PASS。
