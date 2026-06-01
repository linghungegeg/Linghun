# Run 3 TUI Permission Mode Product Contract Closure

日期：2026-06-01

## 目标

本轮只收口用户实测的 TUI 权限模式与输出契约问题，不进入新阶段，不做大重构，不提交 commit。

边界：
- 不触碰 provider/model route。
- 不触碰 remote/Feishu。
- 不触碰 packaging/bundled runtime。
- 不触碰反幻觉 gate。
- 不新增第五种权限模式。
- 不新增第二套 approval store。

## CCB 参考事实

实际读取：
- `F:\ccb-source\src\utils\permissions\getNextPermissionMode.ts`
- `F:\ccb-source\src\utils\permissions\filesystem.ts`

确认事实：
- CCB `getNextPermissionMode` 的循环是 `default -> acceptEdits -> plan -> auto -> bypassPermissions -> default`，模式切换本身不被 workflow gate 卡死。
- CCB `filesystem.ts` 在 lower safety checks 之后，对 `acceptEdits` 且路径位于 working dir 内的写入返回 `allow`。

本轮仅参考产品行为与权限边界思路：模式切换保持顺畅，真正的安全限制放在动作执行权限管道。未复制 CCB 源码实现。

## Linghun 源码根因

1. `packages/tui/src/index.ts`
   - Shift+Tab、`/tab`、`/mode` 都会先走 `getModeChangeGuard`。
   - `getModeChangeGuard` 把 `plan -> full-access` 和 `LINGHUN_ENABLE_FULL_ACCESS` 放在模式切换入口，导致四模式不能稳定循环。
   - 无 pending approval 时，用户输入 `yes` 的提示仍偏向 Start Gate，不能明确告诉用户必须先有 Write/Edit 工具请求。

2. `packages/tui/src/tui-permission-runtime.ts`
   - `auto-review` 对非低风险 mutating tool 直接返回 `deny`。
   - 这会让 `report.md` 这类普通工作区写入无法进入既有 `pendingLocalApproval -> PermissionPanel / yes-no` 管道。

3. `packages/tui/src/shell/plain-renderer.ts`
   - plain renderer 无条件打印 `block.nextAction`。
   - 当 view model 已经把 `fullText` 完整渲染出来时，仍会显示假的 `Ctrl+O`。

## 修复内容

1. 模式切换契约
   - Shift+Tab 和 `/tab` 现在严格循环：`default -> auto-review -> plan -> full-access -> default`。
   - `/mode default|auto-review|plan|full-access` 可直接切换。
   - 移除模式切换入口的 full-access env opt-in 和 planAccepted 阻断。
   - 文案调整为：切换模式不等于绕过硬拒绝；危险动作仍受权限底座约束。

2. auto-review 写入确认契约
   - `auto-review` 对非低风险 mutating tool 改为 `ask`，复用现有 pending approval 管道。
   - `Write/Edit/MultiEdit` 被 no / deny / cancel 后，输出与 tool_result 都明确包含 `NOT written / NOT created`。
   - 无 pending approval 时用户输入 `yes` 不再发送给模型，而是提示：当前没有待确认的写入动作，需要模型发起 Write/Edit 工具请求后才能确认。
   - plan 模式、hard deny、path safety、destructive action 等底层限制仍在原权限管道内生效。

3. Ctrl+O 提示真实性
   - plain renderer 增加与 Ink ProductBlock 同方向的 `visibleNextAction` / `hasHiddenContent` 判断。
   - 完整内容已经可见时不显示 `Ctrl+O`。
   - 真实多行错误或隐藏详情仍保留 `Ctrl+O`。

## 涉及文件

- `packages/tui/src/index.ts`
- `packages/tui/src/tui-permission-runtime.ts`
- `packages/tui/src/shell/plain-renderer.ts`
- `packages/tui/src/tui-messages.ts`
- `packages/tui/src/extension-command-runtime.ts`
- `packages/tui/src/index.test.ts`
- `packages/tui/src/shell/view-model.test.ts`

## 测试覆盖

新增或更新的关键覆盖：
- Shift+Tab / `/tab` 四模式循环，包含 `plan -> full-access` 成功。
- `/mode full-access` 在没有 `LINGHUN_ENABLE_FULL_ACCESS` 时成功切换。
- full-access 下危险/path-outside/destructive action 仍被 hard deny。
- `auto-review + report.md + Write` 返回 pending/ask，不直接 deny。
- yes 后才写入。
- no / cancel 后不写入，并回灌 `NOT written / NOT created`。
- 无 pending 时用户输入 `yes` 不发送给模型，并给短提示。
- plain renderer 完整可见内容不显示 `Ctrl+O`。
- plain renderer 真实隐藏多行错误仍显示 `Ctrl+O`。
- Ink ProductBlock 多行错误 `Ctrl+O` 覆盖保留。

## 验证结果

已通过：
- `corepack pnpm exec tsc --noEmit`
- `corepack pnpm typecheck`
- `corepack pnpm --filter @linghun/tui exec vitest run`
  - 58 files passed
  - 2207 tests passed
- `corepack pnpm --filter @linghun/tui build`
- `corepack pnpm --filter @linghun/cli build`
- `git diff --check`

## 未处理内容

- 未清理历史 audit / delivery 文档中的旧 full-access opt-in 叙述。
- 未修改 provider/model route。
- 未修改 remote/Feishu。
- 未修改 packaging/bundled runtime。
- 未修改反幻觉 gate。
- 未提交 commit。

## Handoff Packet

- 下一步：停在本轮 Run 3 closure 边界，由用户决定是否继续下一轮收口。
- 禁止事项：不要自动进入新阶段，不要顺手做 provider、remote、packaging、anti-hallucination 相关改动。
- 证据引用：见本文件“CCB 参考事实”“Linghun 源码根因”“测试覆盖”“验证结果”。
- 索引状态：本轮未触发 codebase-memory refresh/rebuild；使用源码精读与 `rg` 定位。
- 权限模式：当前修复仅改变 TUI 模式切换入口与 auto-review ask/deny 分流，硬拒绝仍在权限底座。
- 模型/provider：未修改。
- 预算使用：未引入新运行时成本；仅新增/更新本地测试。
