---
title: Pre-Smoke TUI Polish B - Interactive Controls, Permission Recovery, Workspace Trust
status: CLOSED
updated: 2026-05-24
---

# Pre-Smoke TUI Polish B - Interactive Controls, Permission Recovery, Workspace Trust

## 本轮定位

本轮是 **Polish B remaining scope closure**，接续上一轮 auto-compact recovery 后的 `PARTIAL_CLOSURE`，只做 Polish B 剩余小收口：补 targeted tests、裁决真实 key handling、收紧 Workspace Trust 成熟度、收紧 Bounded Autopilot 测试和边界。

本轮没有从头重做 SLRC，没有重扫全部参考源，没有进入 Polish C/D、Phase 18 或真实 smoke。

本轮先读取并基于以下当前工作区事实判断范围：

- `F:\Linghun\docs\delivery\pre-smoke-tui-polish-b-interactive-controls-permission-workspace-trust.md`
- `git status --short`
- `git diff -- packages/tui/src/index.ts`
- `git diff -- packages/tui/src/index.test.ts`
- `git diff -- packages/config/src/index.ts`
- `git diff -- packages/tui/src/natural-command-bridge.ts`
- `git diff -- packages/tui/src/permission-presenter.ts`

## 修改文件清单

- `packages/config/src/index.ts`
  - 增加 `workspaceTrust` 配置结构、默认值、校验与保存入口。
  - 默认保持 `trusted`，避免在未显式设置信任边界时改变既有显式 slash 命令行为。
- `packages/tui/src/index.ts`
  - 接入 `/esc`、`/enter`、`/trust`、`/autopilot` 的最小 TUI 控制路径。
  - 为 pending permission / Start Gate 增加安全 `details` 摘要，隐藏 raw schema、key、token、request id、内部 gate id。
  - pending permission / pending natural command / pending plan / pending autopilot 增加取消或确认入口。
  - Workspace Trust 增加启动提示、状态输出、受限命令拦截与 `/trust` 持久化入口。
  - Bounded Autopilot 只复用已有 durable job / background / runner fallback 边界；未新增 agent/job runtime。
  - 将普通主屏中的 `Architecture drift` 文案降级为用户可理解的 scope change 提示。
- `packages/tui/src/natural-command-bridge.ts`
  - 将 `/esc`、`/enter`、`/trust`、`/autopilot` 纳入用户可见控制面 catalog。
  - 增加自然语言桥对 trust/autopilot 的最小映射，但不把危险动作变成静默执行。
- `packages/tui/src/permission-presenter.ts`
  - permission prompt 增加 `Esc` / `details` 恢复提示。
- `packages/tui/src/index.test.ts`
  - 新增 Polish B targeted tests，覆盖 pending controls、safe details、Workspace Trust、Bounded Autopilot、权限模式边界和 job/runner no-PASS。
- `docs/delivery/pre-smoke-tui-polish-b-interactive-controls-permission-workspace-trust.md`
  - 将报告从 `PARTIAL_CLOSURE` 更新为 `CLOSED`。

## DONE

- 四权限模式的用户可见差异仍保留：`default` / `auto-review` / `plan` / `full-access` 文案和模式边界未改语义。
- `full-access` 仍不能通过自然语言静默开启：仍需要本地 `LINGHUN_ENABLE_FULL_ACCESS=1` opt-in，且 `plan -> full-access` 仍受阻断。
- pending Start Gate / permission / plan approval / autopilot confirmation 有取消或拒绝路径：
  - `/esc` 可取消待确认的 permission、natural command、autopilot、plan。
  - permission 仍支持 `no/cancel` 拒绝。
  - `/enter` 只确认允许普通确认的 pending interaction；对需要精确命令的 Start Gate 不绕过。
- `details` / permission / trust / autopilot 输出使用安全摘要，不输出 raw schema、key、token、request id、内部 gate id。
- Workspace Trust 最小成熟闭合：
  - 默认 `trusted`，原因是 Polish B 不引入“首次信任弹窗”或改变既有显式 slash 命令行为。
  - 默认 `trusted` 不是首次信任弹窗，也不是绕过权限；它只表示不主动启用 workspace trust 拦截层，正常 permission pipeline 仍生效。
  - 用户可显式 `/trust restricted` 或 `/trust untrust` 切到受限边界。
  - restricted/untrusted 下只限制高风险动作：写入、Bash、部分扩展/远程/长任务入口；不影响 `/status`、`/help`、`/doctor readiness` 等只读状态/诊断。
  - trust 状态持久化到项目 `.linghun/settings.json` 的 `workspaceTrust` 字段。
- Bounded Autopilot 最小成熟闭合：
  - `/autopilot <目标>` 创建 pending request，包含 goal、maxSteps、maxTokens、timeoutMs、allowEdit、allowBash。
  - `/autopilot status|details|cancel|confirm` 状态、详情、取消、确认路径可用。
  - confirm 前不启动 job。
  - restricted/untrusted 下 confirm 不启动。
  - confirm 后只调用既有 `/job run`，复用 durable job / background / runner fallback；未新增第二套 agent/job runtime。
  - 不声明 native runner 完整收益，不声明 verification PASS。
- runner/job completed 仍不等于 verification PASS；测试覆盖 no-PASS 边界。
- 普通主屏中的内部审计术语做了最小降噪：`Architecture drift` 用户提示改为 scope change，不展开底层审计机制。

## Targeted tests 覆盖

新增 targeted tests 覆盖：

- `/esc` 取消 pending Start Gate。
- `/esc` 取消 pending permission。
- `/esc` 取消 pending plan approval。
- `/enter` 不绕过 exact confirmation。
- `/enter` 可确认普通 pending interaction。
- `details` 展示安全摘要，不含 raw schema / key / token / gateId / request id。
- `/trust restricted` 后拦截 `/write`、`/bash`、`/job run`、`/autopilot confirm`。
- `/trust trust` 后恢复既有 permission pipeline，不静默绕过 permission。
- `/autopilot status/details/cancel/confirm` 状态正确。
- autopilot 启动只转到既有 `/job run`，不新增 agent/job runtime。
- runner/job completed 不等于 verification PASS。
- full-access 仍不能通过自然语言静默开启。
- plan 模式仍不能直接写文件或运行高风险动作。

## 真实 key handling 裁决

状态：**DEFERRED**，但不阻塞 Polish B CLOSED。

裁决依据：当前主输入循环位于 `runTui` / `readInputLines`，TTY 路径使用 `node:readline/promises` 的 line iterator：

- 非 TTY：一次性读取 chunks，按换行切分。
- TTY：`createInterface({ input, output })` 后 `for await (const line of rl)`，只接收提交后的完整 line。

在这个结构下，安全支持真实 `Esc` / `Enter` / `Shift+Tab` 需要切换 raw keypress mode 或并行注册 keypress listener。该改动会触碰输入循环语义、readline 生命周期、TTY/non-TTY 差异和测试输入模型，不属于 Polish B remaining scope 的最小安全改动。

本轮保留 slash-equivalent：

- `/esc`
- `/enter`
- `/tab`

没有假装完成真实 key handling；如后续要做，应单独进入小范围输入层任务，不为了 Polish B 重写输入循环。

## NOT-DO

- 未进入 Polish C / Polish D / Phase 18。
- 未进入真实 smoke。
- 未宣布 Beta PASS / smoke-ready / open-source-ready。
- 未新增第二套 NCB / permission / provider / tool / evidence / MCP / index / memory / agent / job runtime。
- 未改变四权限模式语义。
- 未绕过 Start Gate / permission pipeline / Plan approval。
- 未把 slash 命令当主体验；slash 只作为控制与恢复入口。
- 未做反幻觉 / Architecture Runtime 二阶增强。
- 未新增依赖。
- 未提交 commit。

## 验证结果

已运行：

```bash
corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts -t "Polish B|permission|mode|trust|workspace|autopilot|Start Gate|plan|details|cancel|full-access|esc|enter"
```

结果：PASS

- Test Files: 2 passed
- Tests: 86 passed, 206 skipped

```bash
corepack pnpm typecheck
```

结果：PASS

```bash
corepack pnpm check
```

结果：PASS

```bash
git diff --check
```

结果：PASS

备注：本轮曾出现两类中间失败，均已用最小改动收口：

1. `/trust trust` 后的 `/write` 显式 slash 路径不会创建 model-tool pending approval，而是走既有 permission denied/prompt 输出；测试已改为断言恢复既有 permission pipeline 且未写文件。
2. 新增测试存在格式化差异；已用项目 formatter 修正。

## 索引状态

- codebase-memory 项目：`F-Linghun`
- 本轮查询结果：`status=ready`, `nodes=1875`, `edges=3949`
- 未触发索引重建、force refresh 或慢检测。

## Verdict

**CLOSED**。

理由：Polish B 剩余项已经通过 targeted tests 覆盖，真实 key handling 已基于当前 readline/input loop 明确裁决为 DEFERRED 且不阻塞 B；Workspace Trust 和 Bounded Autopilot 均以最小成熟边界闭合。

可以进入 Polish C 的条件：用户明确确认后再进入；本报告本身不自动进入 Polish C/D。

## Handoff Packet

- 当前阶段：Pre-Smoke TUI Polish B remaining scope closure。
- 当前结论：`CLOSED`，不是 Beta PASS、不是 smoke-ready、不是 open-source-ready。
- 下一步：等待用户确认是否进入 Polish C；不要自动推进。
- 禁止事项：不进入 Polish C/D、真实 smoke、Phase 18；不新增第二套 runtime；不改四权限模式语义；不提交 commit。
- 证据引用：本报告的“验证结果”和“Targeted tests 覆盖”小节。
- 权限模式：本轮未提交 commit；未进入真实 smoke。
- 模型/provider：本轮由当前 Claude Code 会话执行；未调用产品 provider 做真实请求。
- 预算使用：未做真实 smoke、未跑 full build；运行了 focused vitest、typecheck、check、diff whitespace。
