# Phase 7.16.2 /details endpointPath Sanitization Hotfix

## 修复目标

修复真实重压后发现的 `/details` blocker：`sanitizeDisplayPaths()` 把 provider endpoint path 和 URL path 当成本地 Unix 绝对路径脱敏，导致 `/details` 展开的 `lastFullOutput` 中 `endpointPath=/v1/messages`、`endpoint path /v1/messages`、`https://relay.example.com/v1` 被误改写。

本阶段只修本次 blocker，不进入新阶段，不处理 DH1-DH4，不修改 provider 路由、主链、权限、workflow、agent、job 或 capability 逻辑，不 stage、不 commit。

## 根因

`packages/tui/src/startup-runtime.ts` 中 `formatDisplayPath()` 会把任何 `/...` 开头的输入视为绝对路径。`sanitizeDisplayPaths()` 的 Unix 路径正则允许在 `=`、空格等前缀后匹配至少两段 `/x/y`，因此会误伤：

- `endpointPath=/v1/messages` -> `endpointPath=[local-path]/messages`
- `endpoint path /v1/messages` -> `endpoint path [local-path]/messages`
- `https://relay.example.com/v1` -> 类似 `http[local-path]/v1`

该问题发生在显示脱敏层，不是 provider/main loop 路由问题；真实 provider smoke 和真实 TUI 主链 smoke 已通过，因此本阶段不改 provider/main loop。

## 改动文件

- `packages/tui/src/startup-runtime.ts`
  - 在现有 `sanitizeDisplayPaths()` 内保护 HTTP(S) URL、`endpointPath=/...` 和 `endpoint path /...` 语义字段，再执行既有路径脱敏，最后恢复被保护片段。
  - 保留 Windows 绝对路径、home 路径、项目内绝对路径、真实 Unix 本地绝对路径脱敏。
- `packages/tui/src/startup-runtime.test.ts`
  - 新增 focused regression：endpoint path 和 URL path 保留；Windows、`/home/...`、`/Users/...` 本地绝对路径仍脱敏。
- `packages/tui/src/index.test.ts`
  - 将 `/details` 旧文案断言从 `最近一次输出（完整正文）` 更新为当前产品文案 `## 最近输出（完整正文）`。
  - 保留并加强关键行为断言：`/details` 展开完整正文、连续 `/details` 不污染 `lastFullOutput`、light hint 不替换 `lastFullOutput`、`endpointPath=/v1/messages` / `endpoint path /v1/messages` 不被脱敏。
- `docs/delivery/phase-07-16-2-details-endpointpath-sanitization-hotfix.md`
  - 本阶段交付记录。

## 验证命令

已通过：

```powershell
corepack pnpm exec vitest run packages/tui/src/startup-runtime.test.ts --no-color
.\node_modules\.bin\vitest.ps1 run packages/tui/src/index.test.ts -t 'P0-A|D.13M-B|/details|lastFullOutput' --no-color
corepack pnpm exec vitest run packages/tui/src/index.test.ts --no-color
corepack pnpm exec biome check packages/tui/src/startup-runtime.ts packages/tui/src/startup-runtime.test.ts packages/tui/src/index.test.ts
corepack pnpm --filter @linghun/tui typecheck
corepack pnpm --filter @linghun/tui build
corepack pnpm --filter @linghun/cli build
node --input-type=module -e "const { sanitizeDisplayPaths } = await import('./packages/tui/dist/startup-runtime.js'); const input = 'endpointPath=/v1/messages endpoint path /v1/messages https://relay.example.com/v1 file=C:\\Users\\Admin\\x.log'; const output = sanitizeDisplayPaths(input); console.log(output); if (!output.includes('endpointPath=/v1/messages')) throw new Error('endpointPath was sanitized'); if (!output.includes('endpoint path /v1/messages')) throw new Error('endpoint path was sanitized'); if (!output.includes('https://relay.example.com/v1')) throw new Error('URL path was sanitized'); if (output.includes('C:\\Users\\Admin\\x.log')) throw new Error('Windows path was not sanitized');"
git diff --check
```

结果：

- `startup-runtime.test.ts`: 51/51 PASS。
- focused `/details|lastFullOutput` index regression: 14 selected PASS / 641 skipped / 655 total。
- full `index.test.ts`: 655/655 PASS。
- Biome scoped check PASS。
- `@linghun/tui` typecheck PASS。
- `@linghun/tui` build PASS。
- `@linghun/cli` build PASS。
- Node direct check output: `endpointPath=/v1/messages endpoint path /v1/messages https://relay.example.com/v1 file=[user-home]/.../x.log`。
- `git diff --check` PASS。

说明：用户指定的 focused 命令中 `-t "P0-A|D.13M-B|/details|lastFullOutput"` 在当前 Windows `corepack.cmd` shim 下会被 `|` 解析成 shell pipeline；本轮用 `.\node_modules\.bin\vitest.ps1` 直接传同一 pattern 完成等价 focused 验证。全量 `corepack pnpm exec vitest run packages/tui/src/index.test.ts --no-color` 已按原命令通过。

## 不在本阶段处理的内容

- 不处理 DH1-DH4。
- 不进入新阶段。
- 不运行真实 provider full-chain stress。
- 不修改 provider 路由、主链、权限、workflow、agent、job 或 capability 逻辑。
- 不修改 `docs/stress/`、`img/`、`report.md`、`test-model-set.sh`、`docs/delivery/phase-6.7-full-source-maturity-audit.md`。
- 不 stage、不 commit。

## 非 readiness 声明

本阶段只代表 Phase 7.16.2 hotfix scope 通过本地/focused/full index 验证。

不代表 Beta PASS，不代表 smoke-ready，不代表 open-source-ready，不代表真实 full-chain stress PASS。

## 参考核对

- 已读取 Linghun 文档：`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`、`LINGHUN_IMPLEMENTATION_SPEC.md`、`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`、`docs/delivery/README.md`、`docs/delivery/phase-07-16-source-level-rc-audit-repair.md`、`docs/delivery/phase-07-16-1-startagent-anthropic-continuation-hotfix.md`。
- 已精读指定源码：`packages/tui/src/startup-runtime.ts`、`packages/tui/src/startup-runtime.test.ts`、`packages/tui/src/index.test.ts`。
- 本阶段只参考 Linghun 现有源码、测试事实和只读子智能体核查结论；未复制可疑源码实现、反编译痕迹、内部 API、专有遥测或内部服务逻辑。

## 成品级 handoff packet

- 下一阶段：仍停在真实 full-chain stress 审核点，需用户确认后开始。
- 禁止事项：不得把本 hotfix PASS 说成 Beta PASS / smoke-ready / open-source-ready；不得自动进入真实重压；不得处理 DH1-DH4；不得触碰用户指定禁区文件；不得 stage/commit。
- 证据引用：
  - `packages/tui/src/startup-runtime.ts`
  - `packages/tui/src/startup-runtime.test.ts`
  - `packages/tui/src/index.test.ts`
  - 本文档“验证命令”。
- 验证结果：startup-runtime focused PASS；index focused PASS；full index 655/655 PASS；Biome/typecheck/TUI build/CLI build/Node direct check/git diff --check PASS。
- 索引状态：codebase-memory MCP 本轮未暴露；按项目规则使用 `rg`、源码精读和多智能体只读核查，未执行慢重建或 force refresh。
- 权限模式：本地 Codex desktop，filesystem unrestricted；未 stage、未 commit。
- 模型/provider：Codex 本地开发会话；未运行真实 Linghun provider stress。
- 预算使用：无外部 provider token 预算消耗；仅本地测试和构建。
