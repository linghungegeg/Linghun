---
title: Pre-Smoke TUI Polish B - Interactive Controls, Permission Recovery, Workspace Trust
status: LOCAL_VERIFIED
updated: 2026-05-24
---

# Pre-Smoke TUI Polish B - Interactive Controls, Permission Recovery, Workspace Trust

## 本轮定位

本轮是 **Polish B final close**，只收尾两个已知缺口。本报告状态统一为 `LOCAL_VERIFIED`：执行者本地复核闭合，未声明 independent verifier PASS；independent verifier 不作为真实 smoke 前置条件；不等于 Beta PASS / smoke-ready / open-source-ready。

本轮只处理：

1. CCB-style 轻量首次 Workspace Trust。
2. 真实 TUI key handling：Esc / Enter / Shift+Tab。

本轮未进入 Polish C / Polish D / Phase 18，未进入真实 smoke，未宣布 Beta PASS / smoke-ready / open-source-ready，未提交 commit。

## Source-Level Reality Check

本轮开工前已运行：

```bash
git status --short
```

开工时输出为空。

本轮读取并基于源码事实确认：

- `docs/delivery/pre-smoke-tui-polish-b-interactive-controls-permission-workspace-trust.md`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `packages/config/src/index.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/permission-presenter.ts`
- `F:\ccb-source\src\components\TrustDialog\TrustDialog.tsx`
- `F:\ccb-source\src\interactiveHelpers.tsx`
- `F:\ccb-source\src\utils\config.ts`
- `F:\ccb-source\src\main.tsx` 中 trust / non-interactive 相关片段

结论：

1. Linghun 当前 Workspace Trust 已接到底层 guard：`getWorkspaceTrustCommandGuard()` 会在 enforced 且非 trusted 时拦截 `/write`、`/bash`、`/job run`、`/autopilot confirm`、extension/remote 等入口。
2. 旧实现 `defaultConfig.workspaceTrust.level = "trusted"` 且 `mergeConfig()` 会把缺失配置合并成 trusted，导致首次仓库无轻提示；本轮改为可区分 `recorded=false` 与显式 trusted。
3. 当前输入循环是 `readline/promises` line iterator。真实 key handling 必须最小接入 keypress hook，不能只改 `/esc`、`/enter`、`/tab` 文案；本轮已在 TTY path 注册 keypress，不重写非 TTY 输入路径。
4. 最小 touch points：`packages/config/src/index.ts`、`packages/tui/src/index.ts`、`packages/tui/src/index.test.ts`、本交付文档。
5. 不能做成文字补丁的内容：Workspace Trust 必须实际在启动路径和 guard 生效；Esc / Enter / Shift+Tab 必须实际接入 TTY keypress handler。

## CCB 源码事实对照

只读参考结论：

- CCB `TrustDialog` 是首次未信任 workspace 的轻量确认，不是要求用户输入独立 `/trust` 主命令。
- Dialog 展示当前目录，询问是否信任项目；信任后说明可读、改、运行命令。
- Enter 确认，Esc/No 取消；已接受 trust 后自动跳过。
- CCB `showSetupScreens()` 在交互式 setup 中触发 trust dialog；非交互 `--print` 跳过 trust dialog，并在 help 文案中提示只在信任目录使用。
- CCB 持久化 trust 到项目配置；home dir 有 session-only 特例。Linghun 本轮未复制 CCB 源码实现，只参考产品行为和边界。

## 修改文件清单

- `packages/config/src/index.ts`
  - `WorkspaceTrustConfig` 增加 `recorded: boolean`。
  - `defaultConfig.workspaceTrust` 保持 level 为 trusted 以兼容旧读取，但新增 `recorded=false`，避免 missing trust 被静默当作显式 trusted。
  - `saveWorkspaceTrust()` 写入 `recorded=true`。
  - `mergeWorkspaceTrustConfig()` 对已有旧配置补 `recorded=true`，避免迁移旧用户配置时重复打扰。
- `packages/tui/src/index.ts`
  - 首次交互式启动且 trust 未记录时显示轻量 Workspace Trust prompt。
  - Enter/yes 写入 trusted；Esc/no 写入 restricted。
  - 已 trusted 后安静启动；`/trust` 保留为高级 fallback/status/recover，不作为主路径。
  - restricted/untrusted 下继续拦截高风险入口；`/help`、`/status`、`/doctor` 等只读诊断仍可用。
  - TTY 输入路径注册最小 keypress hook：Esc 取消 pending interaction，Enter 确认普通 pending interaction，Shift+Tab 打开 mode switch 提示且不启用 full-access。
  - 非 TTY 输入路径保持原 line/chunk 读取，不弹 trust prompt，不改 pipe/script 生命周期。
- `packages/tui/src/index.test.ts`
  - 新增 focused tests 覆盖首次 trust prompt、trust confirm 持久化、trust cancel restricted、高风险拦截、只读命令可用、trusted quiet startup、非 TTY 不弹交互 prompt、真实 key handler 与 slash fallback。
- `docs/delivery/pre-smoke-tui-polish-b-interactive-controls-permission-workspace-trust.md`
  - 本报告更新为 Polish B final close。

## Linghun 真实接入点

### Workspace Trust

- 启动路径：`runTui()` 在主屏状态输出前调用首次 trust prompt。
- 配置路径：`.linghun/settings.json` 的 `workspaceTrust` 字段持久化 `level`、`recorded`、`trustedAt`、`updatedAt`。
- Guard 路径：`getWorkspaceTrustCommandGuard()` / `isWorkspaceTrustRestrictedCommand()` 继续作为受限工作区的高风险入口拦截点。
- 高级 fallback：`/trust status|trust|restricted|untrust` 保留，但不再是首次信任主体验。

### Real key handling

- TTY path：`readInputLines()` 对 TTY 输入使用 `emitKeypressEvents()` 注册 keypress listener，并在 finally 中清理 listener 与 raw mode。
- Esc：调用同一套 pending cancel 逻辑，覆盖 pending permission / natural command / plan / autopilot。
- Enter：只在有 pending interaction 时调用普通确认逻辑；需要 exact confirmation 的 Start Gate 仍被拒绝，不绕过 full-access / force / dangerous confirmation。
- Shift+Tab：打开 mode switch 提示，列出四权限模式，但不直接开启 full-access，不绕过 Start Gate。
- Slash fallback：`/esc`、`/enter`、`/tab` 继续保留。

## Focused tests 覆盖

新增或更新 focused tests 覆盖：

- 首次 missing trust 的交互式路径会出现轻量 trust prompt。
- trust confirm 后写入 `.linghun/settings.json`。
- trust cancel 后进入 restricted，并拦截高风险命令。
- restricted/untrusted 下 `/help`、`/status`、`/doctor readiness` 可用。
- trusted 后安静启动，不重复提示。
- trusted 后不绕过 permission pipeline：`/write` 仍按原权限链路暂停/拒绝，不直接写文件。
- 非 TTY 不弹交互式 trust prompt。
- 真实 Esc handler 能取消 pending permission / natural command / plan / autopilot。
- 真实 Enter handler 不能绕过 exact confirmation。
- Shift+Tab/mode key 不会开启 full-access，不会绕过 Start Gate。
- Slash fallback `/esc`、`/enter`、`/tab` 仍可用。

## 验证结果

已运行：

```bash
corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts -t "Polish B|trust|workspace|key|Esc|Enter|Shift|Tab|permission|mode|Start Gate|plan|autopilot"
```

结果：PASS

- Test Files: 2 passed
- Tests: 88 passed, 209 skipped

```bash
corepack pnpm typecheck
```

结果：PASS

```bash
corepack pnpm check
```

结果：PASS

由于本轮触碰 TTY 输入循环，还补跑：

```bash
corepack pnpm test
```

结果：PASS

- Test Files: 19 passed
- Tests: 442 passed

```bash
corepack pnpm build
```

结果：PASS

```bash
git diff --check
```

结果：PASS

备注：`corepack pnpm check` 首次因格式化差异失败，已用项目 formatter 修正后重跑通过。

## Polish B final micro-fix

本轮在 final close 后追加一个小收口：只调整 Natural Command Bridge 中 Workspace Trust 的自然语言口径，未进入 Polish C/D、Phase 18 或真实 smoke。

变更结论：

- NCB trust 自然语言不再把 `/trust trust`、`/trust restricted`、`/trust untrust` 当作普通用户主路径。
- 用户说“信任这个项目 / 调整工作区信任 / trust this folder / workspace trust”时，主屏进入轻确认：`我识别到你想调整工作区信任。是否授权？`，并展示 Yes / No / Details。
- Details 才解释边界：信任后 Linghun 可以在当前目录读、改、运行命令；Start Gate、Plan approval 和 permission pipeline 仍然生效；`/trust` 是高级恢复/状态入口，不是普通用户主路径。
- `/trust` slash fallback 继续保留，不删除，不影响高级恢复场景。
- 本轮不改变 Workspace Trust 底层 guard、不改变 `.linghun/settings.json` schema、不改变 permission pipeline / Start Gate / Plan approval、不改变首次交互式 trust prompt。

追加验证：

```bash
corepack pnpm exec vitest run packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts -t "trust|workspace|Polish B|natural|command|Start Gate|Details"
```

结果：PASS

- Test Files: 2 passed
- Tests: 225 passed, 81 skipped

备注：该 focused 命令首次运行发现 trust 自然语言仍被普通项目请求过滤，已最小修正后重跑通过。

按用户最新要求，本 micro-fix 已停止独立 verifier 复检；本轮改为本地自审，不声明 independent verifier PASS。

```bash
corepack pnpm typecheck
```

结果：PASS

```bash
corepack pnpm check
```

结果：PASS

备注：`corepack pnpm check` 曾发现新增测试格式差异，已用项目 formatter 修正后重跑通过。

```bash
git diff --check
```

结果：PASS

## 本地自审结论

按用户最新要求，本轮已停止独立 verifier 复审；本报告不声明 independent verifier PASS。

本地自审确认：

- Workspace Trust 主路径是首次交互式启动轻量确认，不要求用户输入 `/trust trust`。
- `/trust` 仅保留为高级 fallback/status/recover。
- missing trust 通过 `recorded=false` 与显式 trusted 区分；旧配置迁移为已记录，避免重复打扰旧用户。
- restricted/untrusted 下高风险入口仍走现有 workspace trust guard；只读诊断命令仍可用。
- trusted 后不绕过 Start Gate、Plan approval 或 permission pipeline。
- TTY path 只接入最小 keypress hook；非 TTY/scripted path 保持 line/chunk 输入生命周期，不弹交互 prompt。
- Esc / Enter / Shift+Tab 均复用现有 pending interaction / mode / permission 边界，没有新增第二套 input loop 或 permission 系统。

## NOT-DO

- 未进入 Polish C / Polish D / Phase 18。
- 未进入真实 smoke。
- 未宣布 Beta PASS / smoke-ready / open-source-ready。
- 未新增第二套 permission / Start Gate / input loop / NCB / job / trust 系统。
- 未做重 onboarding / wizard / 命令百科。
- 未复制 CCB / Claude Code / OpenCode 源码。
- 未新增依赖。
- 未提交 commit。

## 已知边界

- 非 TTY / scripted path 不弹交互 UI；本轮保留脚本路径的 line/chunk 输入生命周期，并在主屏提示 trust 未记录。首次显式信任仍建议用交互式启动完成。
- Shift+Tab 本轮选择低风险 mode switch 提示，而不是直接循环到 full-access；full-access 仍必须本地显式 opt-in，且不能绕过 Start Gate / permission pipeline / Plan approval。

## 索引状态

- codebase-memory 项目：`F-Linghun`
- 本轮查询结果：`status=ready`, `nodes=1894`, `edges=3969`
- 未触发索引重建、force refresh 或慢检测。

## Handoff Packet

- 当前阶段：Pre-Smoke TUI Polish B final close。
- 当前结论：两个收尾项已闭合：CCB-style light Workspace Trust + real key handling。
- 下一步：等待用户确认；不要自动进入 Polish C/D、Phase 18 或真实 smoke。
- 禁止事项：不新增第二套 runtime；不改四权限模式语义；不把 `/trust` 做成主路径；不提交 commit。
- 证据引用：本报告“验证结果”和“Focused tests 覆盖”。
- 权限模式：本轮未提交 commit；未进入真实 smoke。
- 模型/provider：本轮由当前 Claude Code 会话执行；未调用产品 provider 做真实请求。
- 预算使用：未做真实 smoke；已运行 focused vitest、typecheck、check、full test、build、diff whitespace。
