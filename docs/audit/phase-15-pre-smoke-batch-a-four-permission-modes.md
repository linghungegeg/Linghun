# Phase 15 Pre-Smoke Batch A：四权限模式源码级收口报告

日期：2026-05-21

## 结论

Batch A 已按 runtime/code-first remediation 执行：本轮不是文档补丁，核心收口点落在共享类型、配置读取/写入 normalize、TUI `/mode` 与 `/tab`、权限决策语义、Natural Command Bridge mode parser，以及 focused tests。

本报告不表示 Phase 15 Beta readiness PASS，不表示真实项目 smoke PASS，不进入 Phase 15.5 / Phase 16+。当前下一步仅是 Batch B：Architecture Runtime source-of-truth 设计。

## 本轮读取和参考的文档

实际读取/使用的 Linghun source-of-truth 文档：

- `README.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/README.md`
- `docs/audit/phase-15-pre-smoke-full-reference-parity-and-architecture-runtime-audit.md`
- `docs/audit/reference-map.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`

参考核对（行为参考，不复制源码）：

- `F:\ccb-source\docs\safety\permission-model.mdx`
- `F:\ccb-source\docs\safety\plan-mode.mdx`
- `F:\ccb-source\packages\builtin-tools\src\tools\EnterPlanModeTool\EnterPlanModeTool.ts`
- `F:\ccb-source\packages\builtin-tools\src\tools\ExitPlanModeTool\ExitPlanModeV2Tool.ts`
- `F:\ccb-source\src\components\permissions\PermissionRequest.tsx`

上述 CCB 文件只用于确认行为边界：权限决策为 allow/ask/deny、Plan Mode 只读、退出 Plan 需用户确认、权限 UI 按工具类型处理。未复制 CCB 或第三方可疑源码实现。

## 源码级变更摘要

### 1. PermissionMode source model

涉及文件：`packages/shared/src/index.ts`

- 将共享 `PermissionMode` 收口为四个 canonical modes：
  - `default`
  - `auto-review`
  - `plan`
  - `full-access`
- 新增 legacy/raw 类型用于兼容旧输入：
  - `LegacyPermissionMode = "acceptEdits" | "dontAsk" | "auto" | "bypass"`
  - `RawPermissionMode = PermissionMode | LegacyPermissionMode`
- 新增 `normalizePermissionMode()`：
  - `acceptEdits` -> `auto-review`
  - `auto` -> `auto-review`
  - `bypass` -> `full-access`
  - `dontAsk` -> `default`
- 新增 `isRawPermissionMode()`，仅作为解析 legacy alias 的输入入口，不把 legacy mode 重新暴露为主运行时类型。

### 2. Config read/write normalize

涉及文件：

- `packages/config/src/index.ts`
- `packages/config/src/index.test.ts`

完成内容：

- `LinghunConfig.permission.defaultMode` 保持使用 canonical `PermissionMode`。
- `mergeConfig()` 中对旧配置 `permission.defaultMode` 做 normalize。
- `validatePermission()` 只接受四个 canonical modes。
- 无效 mode 会触发配置恢复路径，回落到 `defaultConfig`，不会升级到高权限。
- 配置写入通过 `validateConfig()` 后只持久化 canonical mode；旧 `acceptEdits` 等 legacy 字符串不会被重新写入 settings。

新增/更新测试覆盖：

- legacy config load normalize：`acceptEdits` / `auto` / `bypass` / `dontAsk`。
- legacy config 经保存路径后写出 canonical `auto-review`。
- invalid permission mode 恢复为默认 `default`，并产生 visible recovery warning。

### 3. TUI runtime `/mode`、`/mode set`、Shift+Tab/cycle、help/status

涉及文件：

- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`

完成内容：

- `/mode` 主显示仅列出：`default / auto-review / plan / full-access`。
- `/mode set <mode>` 与 `/mode <mode>` 共用解析路径。
- legacy alias 仍可作为输入：
  - `/mode acceptEdits` -> 切换到 `auto-review`
  - `/mode auto` -> 切换到 `auto-review`
  - `/mode dontAsk` -> 切换到 `default`
  - `/mode bypass` -> 解析为 `full-access` 并进入 full-access 本地 opt-in guard
- `/tab` 只循环 common canonical modes：`default -> auto-review -> plan -> default`，不再循环 legacy modes。
- help/features 文案主路径改为 canonical modes；危险默认项改为 `full-access` opt-in 和 `auto-review` 不自动放行高风险类别。
- verifier agent permission mode 不再返回 legacy `dontAsk`，改为 `default`。

### 4. decidePermission 语义收口

涉及文件：`packages/tui/src/index.ts`

完成内容：

- 移除 legacy runtime 主分支：`dontAsk` / `acceptEdits` / `auto` / `bypass` 不再作为 `context.permissionMode` 的主分支存在。
- `auto-review` 语义：
  - 自动允许工作区内低风险 `Edit`/受控低风险编辑路径。
  - 允许只读或会话内工具。
  - 不自动允许 Bash、高风险写入、越界路径。
- `full-access` 语义：
  - 仅在本地用户显式 opt-in 后可切换。
  - hard deny 仍在 mode 分支之前执行，因此 `.env`、`.git`、越界路径、高风险 Bash 等仍被拒绝。
- `plan` 语义保持只读：写入、编辑、Bash 被拒绝；用户 allow rule 不能覆盖 Plan Mode 禁写边界。
- `default` 语义保持审慎：只读/会话内工具允许，需要审批的写入/Bash 返回 ask 或拒绝路径。

### 5. full-access 与 auto-review 安全边界

- `full-access`：
  - 切换需要 `LINGHUN_ENABLE_FULL_ACCESS=1`。
  - 不能由自然语言、workflow、agent、plugin、hook 或 remote 静默开启。
  - hard deny 优先级不变。
- `auto-review`：
  - 只降低低风险工作区编辑的审批摩擦。
  - 不自动通过 Bash、联网、依赖、权限、plugin、hook、job、remote 或越界路径。

### 6. Natural Command Bridge mode parser

涉及文件：

- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/natural-command-bridge.test.ts`

完成内容：

- mode alias/parser 统一输出 canonical equivalent command：
  - `accept edits` / `acceptedits` / `接受编辑` -> `/mode auto-review`
  - `auto` / `auto mode` / `自动模式` / `自动审查` -> `/mode auto-review`
  - `bypass` / `full access` / `full-access` / `完全访问` -> `/mode full-access`
  - `dont ask` / `dontask` / `不询问` -> `/mode default`
- 状态查询如“当前权限模式是什么”保持 `/mode`，并归类为 `execute_readonly`，不会触发 mode change。
- 高风险自然语言（如直接开启 bypass/full-access）仍进入 `permission_pipeline`，不自然语言直通执行。

## Focused tests 覆盖

新增/更新测试覆盖以下 Batch A 验收点：

- legacy config normalization。
- config write 不写 legacy mode。
- invalid mode 不升级权限。
- `/mode` display 只展示 canonical modes。
- `/mode` legacy alias input 输出 canonical mode。
- `/tab` cycle 排除 legacy modes。
- `full-access` 未 opt-in 被拒绝。
- `full-access` 不绕过 hard deny。
- `auto-review` 不自动允许 Bash / medium write。
- `plan` write/Edit/Bash 仍拒绝。
- NCB 中文/英文 mode alias 映射到 canonical command。
- NCB status query 不触发 mode change。

## 验证结果

已执行：

```text
corepack pnpm exec vitest run packages/config/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts
```

结果：PASS，3 files passed，264 tests passed。

```text
corepack pnpm typecheck
```

结果：PASS。

```text
corepack pnpm check
```

结果：PASS，Biome checked 47 files。

```text
corepack pnpm test
```

结果：PASS，11 test files passed，323 tests passed。

```text
corepack pnpm build
```

结果：PASS，workspace build completed。

```text
git diff --check
```

结果：PASS；仅出现 Windows working tree LF/CRLF warning，无 whitespace error。

## 未进入范围

本轮未做：

- Architecture Runtime runtime 实现。
- Batch B / Batch C。
- prompt-only fix。
- Compact、Provider maturity、MCP/Skills/Plugins、Verification Runtime、Edit UX、TUI large split。
- 真实项目 smoke。
- Phase 15.5 / Phase 16+。
- Git commit。

## 当前状态与下一步

Batch A 四权限模式源码级收口已完成并通过本地验证。Phase 15 Beta readiness 仍不得声明 PASS；真实项目 smoke 仍不得启动。

唯一下一步：Batch B：Architecture Runtime source-of-truth 设计写入活跃文档。
