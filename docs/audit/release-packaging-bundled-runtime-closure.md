# Release Packaging — Bundled Runtime Closure

日期：2026-06-01

## Executive verdict

**Scoped PASS for resolver/package path readiness; REAL_BINARY_NOT_INCLUDED remains.**

本轮选择 **B：bundled assets 属于 `@linghun/cli`**。CLI package 继续通过 `apps/cli/package.json` 的 `files` 字段包含 `bundled/`，CLI 启动 TUI 时注入内部 `LINGHUN_CLI_BUNDLED_ROOT`，TUI 侧 codebase-memory/native-runner resolver 优先使用这个 explicit CLI bundled root，再回退到 TUI-adjacent bundled roots。

这修复了真实 npm install layout 下 `@linghun/cli` 和 `@linghun/tui` 可能是不同 package，导致 TUI 只按自身模块目录查找 bundled assets 的路径不一致问题。

当前能力是 **resolver/package path ready**，不是“一条命令安装已完成”，也不是“真实二进制已随包可用”。

## Scope

本轮范围：

- `apps/cli/src/cli.ts`：无参数进入 TUI 前注入 `LINGHUN_CLI_BUNDLED_ROOT=<cli-package-root>/bundled`；已存在该 env 时不覆盖。
- `packages/tui/src/mcp-index-runtime.ts`：codebase-memory resolver 在 env explicit binary 和 config explicit binary 之后，优先查 `LINGHUN_CLI_BUNDLED_ROOT/codebase-memory/<platform-arch>/...`。
- `packages/tui/src/runner-runtime.ts`：native-runner bundled roots 增加 `LINGHUN_CLI_BUNDLED_ROOT/native-runner`，且保留原有 runtime-specific env 和 TUI fallback。
- `packages/tui/src/bundled-runtime.test.ts`：补真实 install layout、优先级、NOTICE-only、PATH fallback、doctor-visible redaction focused tests。
- `docs/audit/release-packaging-bundled-runtime-closure.md`：同步真实状态和剩余风险。

明确未做：

- 未 vendored 真实 codebase-memory-mcp binary。
- 未 vendored 真实 native-runner binary。
- 未运行 npm pack smoke。
- 未修改 Run 3 TUI Interaction Contract Closure 相关交互/输入/滚动/Tool Todo/Ctrl+O 文件。
- 未修改 provider/model route。
- 未修改权限和反幻觉逻辑。
- 未 commit，未 stage。

## Resolution order

codebase-memory binary resolution：

1. `LINGHUN_CODEBASE_MEMORY_MCP` explicit env binary。
2. `mcp.servers["codebase-memory"].command` 中显式配置的非默认 binary。
3. Runtime-specific bundled root：`LINGHUN_CODEBASE_MEMORY_BUNDLED_DIR`。
4. CLI bundled root：`LINGHUN_CLI_BUNDLED_ROOT/codebase-memory`。
5. TUI bundled root fallback：
   - `<tui-module-dir>/../bundled/codebase-memory`
   - `<tui-module-dir>/bundled/codebase-memory`
6. Linghun managed path。
7. PATH fallback。
8. missing。

native-runner resolution：

1. Config explicit runner path when `nativeRunner.source` is not `bundled`.
2. Runtime-specific bundled root：`LINGHUN_NATIVE_RUNNER_BUNDLED_DIR`。
3. CLI bundled root：`LINGHUN_CLI_BUNDLED_ROOT/native-runner`。
4. TUI bundled root fallback：
   - `<tui-module-dir>/../bundled/native-runner`
   - `<tui-module-dir>/bundled/native-runner`
5. Legacy TUI-adjacent native-runner fallback。
6. unavailable + Node fallback。

用户显式 env/config 不会被 CLI bundled root 覆盖。

## Real Binary Status

**REAL_BINARY_NOT_INCLUDED remains.**

`apps/cli/bundled/` 目前只有 NOTICE placeholders，没有真实平台二进制。NOTICE 保留为 license/distribution boundary，不会被 resolver 当作 binary PASS。只有平台目录中存在预期文件名并通过版本/protocol probe 时，才会变成 ready/available。

当前可宣称：

- `@linghun/cli` package path convention ready。
- CLI -> TUI explicit bundled root wiring ready。
- Resolver priority and fallback behavior ready。
- Focused/mock/local tests pass。

当前不可宣称：

- single-command install complete。
- codebase-memory-mcp 已随 npm 包真实可用。
- native-runner 已随 npm 包真实可用。
- release packaging smoke complete。

## npm pack smoke

**Not run.**

原因：本轮没有加入真实 binary，仓库中仍只有 NOTICE placeholders；运行 npm pack smoke 只能证明 NOTICE 目录进入 tarball，不能证明真实 runtime 随包可用。该 smoke 应在真实二进制、license/NOTICE 文件和平台目录补齐后执行。

## Tests

Focused tests 覆盖：

- 真实 install layout：CLI package root 有 `bundled/codebase-memory/<platform-arch>/...`，TUI 旁边没有 bundled 时仍可解析。
- native-runner 同理通过 CLI bundled root 解析。
- env explicit binary 优先于 bundled root。
- config explicit binary/runner path 优先于 bundled root。
- CLI bundled root 优先于 PATH fallback。
- NOTICE-only root 不会 PASS，codebase-memory 返回 missing，native-runner 返回 unavailable + Node fallback。
- `rememberCodebaseMemoryResolution` / doctor-visible `formatIndexStatus` 只显示脱敏 basename，不泄漏 home path 或 secret-like path segment。

## Verification

已运行：

```text
corepack pnpm exec vitest run packages/tui/src/bundled-runtime.test.ts packages/tui/src/runner-runtime.test.ts packages/tui/src/index-runtime.test.ts
PASS: 3 files, 51 tests

corepack pnpm exec tsc --noEmit
PASS

corepack pnpm typecheck
PASS

corepack pnpm --filter @linghun/cli build
PASS

corepack pnpm --filter @linghun/tui build
PASS

git diff --check
PASS
```

备注：一次并行运行 `corepack pnpm typecheck` 与 `@linghun/tui build` 时，typecheck 曾因 TUI build 清理/重建 `dist` 短暂找不到 `@linghun/tui` declaration 而失败；待 build 完成后顺序重跑已 PASS。

## Files changed

- `apps/cli/src/cli.ts`
- `packages/tui/src/mcp-index-runtime.ts`
- `packages/tui/src/runner-runtime.ts`
- `packages/tui/src/bundled-runtime.test.ts`
- `docs/audit/release-packaging-bundled-runtime-closure.md`

本轮沿用/保留的既有 packaging 文件：

- `apps/cli/package.json`
- `apps/cli/bundled/codebase-memory/NOTICE.md`
- `apps/cli/bundled/native-runner/NOTICE.md`
- `packages/tui/src/index-runtime.ts`
- `packages/tui/src/index.ts`

## Next steps

1. 加入真实 codebase-memory-mcp binaries 到 `apps/cli/bundled/codebase-memory/<platform-arch>/`。
2. 加入真实 native-runner binaries 到 `apps/cli/bundled/native-runner/<platform-arch>/`。
3. 补齐对应 LICENSE/NOTICE。
4. 运行 npm pack smoke，确认 tarball 内真实 binary 和 license 文件存在。
5. 在 clean install layout 下验证 `linghun` 解析 bundled runtime。

## Boundary statement

- 未 commit。
- 未 stage。
- 未宣布 release readiness。
- 未 vendored 真实 binary。
- 未碰 Run 3 TUI Interaction Contract Closure。
