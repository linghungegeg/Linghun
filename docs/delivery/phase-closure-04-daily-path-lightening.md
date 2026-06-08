# Closure Phase 4 - Daily Path Lightening

## 阶段目标

按 `LINGHUN_CLOSURE_PHASED_TASKS.md` Phase 4 收口日常路径的轻量性：普通问答不被非必要底座动作硬阻断，deep compact 能跟随前台中断语义，只读 shell 分类保持保守，小改动路径不降低既有 read-before-edit / diff / evidence 边界。本阶段不关闭 index / memory / cache / compact，不进入 Phase 5，也不声明全局成熟。

## 已完成功能

- 普通问答轻路径：
  - `sendMessage()` 前的 workspace-reference refresh 改为 lazy refresh。
  - 普通模型请求不再等待 workspace-reference probe / scan 完成后才开始 provider stream。
  - lazy refresh 失败只写诊断 system event，不把主请求变成失败。
- Deep compact 可取消：
  - `runDeepCompact()` / `maybeRunDeepCompactBeforeProvider()` 支持外部 `AbortSignal`。
  - provider preflight 触发的 deep compact 复用当前前台模型请求的 abort signal。
  - 用户 `/interrupt` 取消时，deep compact 返回 cancelled 文案，不写 deep compact packet，不把用户取消伪装成普通 compact failure cooldown。
- 只读查询轻路径：
  - 保留 Read/Grep/Glob/Diff/Todo 和明确 harmless shell 查询的 readonly auto allow。
  - 收窄 Bash readonly classifier：`python` / `python3` / `deno` / `tsc` / `javac` / `java` / `ruby` 执行类命令默认 require permission，仅 `--version` 等版本查询保持轻路径。
  - 收窄 Docker 只读轻路径：`docker logs` / `inspect` / `stats` 默认 require permission，避免容器日志、secret 或长输出被静默放行。
- 小改动路径复核：
  - 未改 `auto-review` 编辑语义。
  - 未改 memory learning，当轮学习生效语义保留。
  - `Write` / `MultiEdit` medium 风险不被降为 low；既有 read-before-edit、stale guard、diff/evidence/checkpoint 边界保持不变。

## 使用方式

- 普通问答：直接输入自然语言。
- 查看缓存 / workspace-reference 状态：`/cache status`
- 手动 context compact：`/compact status`、`/compact deep`
- 取消当前前台模型请求或自动 deep compact：`/interrupt`
- 查看权限模式：`/permissions`

## 涉及模块

- `packages/tui/src/model-stream-runtime.ts`
- `packages/tui/src/compact-preflight-runtime.ts`
- `packages/tui/src/deep-compact-runtime.ts`
- `packages/tui/src/permission-policy-engine.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/permission-policy-engine.test.ts`
- `packages/tui/src/phase-e-stateful-runtime-coverage.test.ts`

## 关键设计

- Workspace reference 仍会刷新，只是不再阻断普通模型请求。显式 `/cache warmup` / `/cache refresh` 等路径仍可等待 refresh 结果。
- Deep compact 仍是 context continuity，不是 verification PASS evidence。取消 deep compact 是 user interrupt，不进入普通 failure cooldown。
- 自动 memory learning 未改：如果 learning mode active，既有当轮生效语义保留。
- Shell readonly 分类只收窄不扩大。解释器、编译器、容器日志和 inspect 类命令可能执行代码、写产物、暴露环境或产生长输出，默认保守要求权限确认。

## 配置项

本阶段没有新增或修改配置项、环境变量、依赖、构建脚本或 provider route。

## 命令

- `corepack pnpm --filter @linghun/tui exec vitest run src/permission-policy-engine.test.ts`
- `corepack pnpm --filter @linghun/tui exec vitest run src/phase-e-stateful-runtime-coverage.test.ts -t "deep compact"`
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts -t "Closure Phase 4"`
- `corepack pnpm --filter @linghun/tui exec tsc --noEmit`

## 测试与验证

- Permission classifier focused tests：PASS，148 tests。
- Deep compact focused tests：PASS，2 tests selected，4 skipped by filter。
- Closure Phase 4 model stream focused test：PASS，1 test selected，675 skipped by filter。
- TUI typecheck：PASS。

## 性能结果

- 普通问答前不再同步等待 workspace-reference refresh。
- 未新增模型调用。
- 未新增后台常驻任务。
- Deep compact 仍只在既有 context pressure / manual compact 路径触发。

## 已知问题

- `/compact deep` 手动命令仍是同步命令路径，没有在本阶段改造成新的 background task 面板；本阶段只闭合自动 provider preflight deep compact 跟随前台 `/interrupt` 的取消语义。
- Workspace-reference lazy refresh 的结果可能在当前轮 provider stream 开始后才更新，因此当前轮不保证使用最新 workspace-reference snapshot；下一轮和显式 cache/status 路径可见。
- 这些 focused/local validation 只证明 Closure Phase 4 范围闭环，不代表真实 full smoke、Beta PASS、smoke-ready、open-source-ready 或 Closure Phase 5 成熟。

## 不在本阶段处理的内容

- 不改 memory learning 当轮生效语义。
- 不关闭 index / memory / cache / compact 能力。
- 不进入 Phase 5 硬编码策略清理。
- 不新增第二套 compact / background / permission runtime。
- 不把局部 lightweight 修复当作全局成熟。

## 下一阶段衔接

下一阶段是 Closure Phase 5 - Local Hardcoded Policy Cleanup。进入前必须由用户确认；Phase 4 PASS 只证明日常路径的局部轻量收口，不证明硬编码常量、provider 策略、index artifact storage 或 footer/status 标签已成熟。

## 开发者排查入口

- 普通模型请求与 workspace-reference lazy refresh：`packages/tui/src/model-stream-runtime.ts`
- Workspace-reference refresh 真源：`packages/tui/src/compact-cache-command-runtime.ts`
- Deep compact cancel signal：`packages/tui/src/deep-compact-runtime.ts`
- Provider preflight compact：`packages/tui/src/compact-preflight-runtime.ts`
- Bash readonly classifier：`packages/tui/src/permission-policy-engine.ts`

## 参考核对

- 实际读取 Linghun 文档：
  - `LINGHUN_CLOSURE_PHASED_TASKS.md`
  - `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
  - `LINGHUN_IMPLEMENTATION_SPEC.md`
  - `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
  - `docs/delivery/README.md`
  - `docs/delivery/phase-closure-03-agent-job-workflow-runtime.md`
- 实际参考源码：
  - `packages/tui/src/model-stream-runtime.ts`
  - `packages/tui/src/compact-cache-command-runtime.ts`
  - `packages/tui/src/workspace-reference-cache.ts`
  - `packages/tui/src/deep-compact-runtime.ts`
  - `packages/tui/src/compact-preflight-runtime.ts`
  - `packages/tui/src/permission-policy-engine.ts`
  - `packages/tui/src/memory-command-runtime.ts`
- CCB / CCB Dev Boost / 社区参考：
  - 本阶段只按既有 Linghun 文档中的 CCB handfeel 目标做行为参考：普通路径轻、状态可取消、只读不扩大执行面、小改动仍保留安全证据链。
  - 未复制 CCB 或任何可疑源码实现。

## 阶段 Verdict

- verdict：PASS
- 是否允许进入下一阶段：no，必须等待用户确认。
- P0/P1/P2 风险分类：
  - P2：manual `/compact deep` 未改造成 background task；不阻断本阶段自动 preflight cancel 闭环。
- 阻塞项：无。
- 用户下一步审核点或命令：审阅本阶段 diff 与验证结果；如确认，再决定是否进入 Closure Phase 5。

## 真实改动文件

- 代码：
  - `packages/tui/src/model-stream-runtime.ts`
  - `packages/tui/src/compact-preflight-runtime.ts`
  - `packages/tui/src/deep-compact-runtime.ts`
  - `packages/tui/src/permission-policy-engine.ts`
- 测试：
  - `packages/tui/src/index.test.ts`
  - `packages/tui/src/permission-policy-engine.test.ts`
  - `packages/tui/src/phase-e-stateful-runtime-coverage.test.ts`
- 文档：
  - `docs/delivery/phase-closure-04-daily-path-lightening.md`
  - `docs/delivery/README.md`
- 生成物：无。
- 用户已有 diff / 非本轮证据：无。

## 运行时事实

- provider/model：Codex coding agent in local workspace；未改 Linghun product provider route。
- permission mode：local workspace direct edit；未改产品权限配置。
- index status：codebase-memory MCP tool unavailable in this Codex thread；使用 `rg`、源码精读、focused tests 和 3 个 explorer subagents 做事实核对。
- cache/usage 来源：未新增 usage 统计；workspace-reference refresh 改为 lazy，不改 cache schema。
- 配置来源：未修改配置。
- 是否有脱敏/密钥风险：未新增 secret 输出；workspace lazy refresh failure 只写截断 system event reason。

## 后台/复查任务状态反馈

- 本阶段未新增后台任务类型。
- 自动 provider preflight deep compact 跟随前台模型请求取消；`/interrupt` 后返回 cancelled 语义。
- 手动 `/compact deep` 后台化不在本阶段处理。

## 语言与 i18n 口径

- 新增 deep compact cancelled 文案包含 zh-CN / en-US。
- 其他变更主要是内部 system event 与 permission classifier 行为，不新增主屏复杂交互。

## Handoff Packet

- verdict: PASS
- nextPhase: Closure Phase 5 - Local Hardcoded Policy Cleanup
- mustNotDo:
  - 不把 Closure Phase 4 PASS 当作全局成熟。
  - 不自动进入 Phase 5。
  - 不改 memory learning 当轮生效语义，除非用户重新明确要求。
  - 不关闭 index / memory / cache / compact。
  - 不扩大 shell auto-allow 执行面。
  - 不新增第二套 compact/background/permission runtime。
- evidenceRefs:
  - `packages/tui/src/model-stream-runtime.ts`
  - `packages/tui/src/deep-compact-runtime.ts`
  - `packages/tui/src/compact-preflight-runtime.ts`
  - `packages/tui/src/permission-policy-engine.ts`
  - `packages/tui/src/index.test.ts`
  - `packages/tui/src/permission-policy-engine.test.ts`
  - `packages/tui/src/phase-e-stateful-runtime-coverage.test.ts`
- validation:
  - `@linghun/tui permission-policy-engine.test.ts`: PASS, 148 tests
  - `@linghun/tui phase-e-stateful-runtime-coverage.test.ts -t "deep compact"`: PASS, 2 selected
  - `@linghun/tui index.test.ts -t "Closure Phase 4"`: PASS, 1 selected
  - `@linghun/tui tsc --noEmit`: PASS
- indexStatus: codebase-memory MCP unavailable; local rg/source reads used.
- permissionMode: direct local workspace edits.
- provider/model: Codex coding agent; no product provider route changed.
- budgetUsed: no explicit token budget; no runtime usage/cost changes.
