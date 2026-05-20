# Phase 15 real-project Beta：CCB-style input preprocessor fix

日期：2026-05-20

## 结论

本轮只修复 Phase 15 real-project Beta 暴露的真实 TUI 普通输入被 Natural Command Bridge（NCB）/ Command Capability Catalog 过度接管的问题。

- 修复结论：普通非 slash、非 pending confirmation、非 Start Gate confirmation、非明确本地状态请求的输入默认进入 model/provider/tool loop。
- `routeNaturalIntent()` / capability catalog 不再作为 `handleNaturalInput()` 普通主路径的默认路由器。
- slash command、本地 pending approval、pending natural command / Start Gate confirmation、权限边界、index safety blocker 续跑等结构化入口仍保留本地前置。
- 本轮不是关键词补丁：没有新增“部署 / 报告 / 项目 / 索引 / index”等放行词，也没有新增 capability scorer boost。
- 本轮未进入 Phase 15.5 / Phase 16+，未宣布 Phase 15 Beta PASS，未提交 commit。

## 改动文件

- `packages/tui/src/index.ts`
  - 收口 `handleNaturalInput()`：移除普通主路径默认 `routeNaturalIntent(text, context.language)` 和对应 catalog action 分支。
  - 清理该路径不再使用的 NCB formatter/router imports。
- `packages/tui/src/index.test.ts`
  - 新增真实暴露 prompt 的回归：普通项目/部署/报告/索引语义返回 `"message"`。
  - 新增 stdin smoke：真实 prompt 不输出 `/index：代码索引`，而是进入 provider/model 请求路径。
  - 调整旧测试契约：普通自然语言状态/索引措辞默认进模型链路；显式 slash、pending gate、index safety blocker 仍走本地结构化路径。
- `apps/cli/src/cli.ts`
  - 更新 `--help` 说明，避免继续宣称普通输入默认先经 Catalog 风险裁决。
- `apps/cli/src/main.test.ts`
  - 补充 CLI help 文案回归，防止旧“普通输入先经 Catalog”口径回流。
- `docs/audit/phase-15-real-beta-ccb-style-input-preprocessor-fix.md`
  - 本脱敏报告。

## 根因

旧路径中，`handleNaturalInput()` 对普通文本直接调用：

```ts
const intent = routeNaturalIntent(text, context.language);
```

`routeNaturalIntent()` 会对 `CommandCapabilityCatalog` 全量评分；`scoreCapability()` 又包含 per-capability boost。结果是普通开发任务中只要自然提到“索引 / index / 项目 / 报告 / 部署”等词，控制面 capability 可能拿到更高分，导致普通任务被误路由到 `/index`、`/model doctor`、`/memory` 等本地说明或控制面，而不是进入模型主链路。

真实暴露 prompt：

```text
帮我看看这是什么项目 该怎么部署 把报告更新在根目录下 有索引 优先使用索引
```

旧行为：输出 `/index：代码索引` 能力说明，没有进入模型请求路径。

## CCB 对照依据

本轮只参考 CCB 的入口行为边界，未复制 CCB 实现。

实际读取的 CCB 文件：

1. `F:\ccb-source\src\utils\processUserInput\processUserInput.ts`
   - `processUserInputBase(...)` 在输入前置阶段只处理结构化入口：bridge-safe slash command、ultraplan keyword、attachments/image/agent mention、bash mode、slash command 等。
   - 非结构化普通 prompt 最终进入 `processTextPrompt(...)`。
2. `F:\ccb-source\src\utils\processUserInput\processTextPrompt.ts`
   - 普通文本构造 `createUserMessage(...)`。
   - 返回 `shouldQuery: true`，进入模型请求链路。
3. `F:\ccb-source\src\components\PromptInput\inputModes.ts`
   - `getModeFromInput(input)` 只有 `!` 前缀进入 bash，其他默认 `prompt`。
4. `F:\ccb-source\src\commands.ts`
   - slash commands 由 command registry / `findCommand(...)` 管理，属于显式结构化入口，不是普通自然语言默认 catalog scorer 抢路由。

对照结论：CCB 有轻量 input preprocessor，但普通任务默认仍是 prompt/model query；它没有 Linghun 旧路径中“普通输入先全量 capability scoring 并可能本地抢答”的默认 router 行为。

## 修复方式

### 入口边界

`packages/tui/src/index.ts` 中，`handleNaturalInput()` 现在保留轻量本地前置后默认 `return "message"`：

保留的本地前置包括：

- `pendingLocalApproval` 的 yes/no/cancel，包括 model `tool_use` 审批 continuation。
- `pendingNaturalCommand` 的确认、精确确认、过期处理。
- 无 pending 时裸 `yes` / `confirm` 等确认词的本地拦截，避免误发模型。
- 已存在 index safety blocker 时的窄续跑入口。
- 极窄 composite status：必须同时命中 readiness/status 类词和至少两个本地状态面。
- 明确 direct file read mention：明确读文件且没有 summary/analyze/explain synthesis intent 时可直接走 `Read`。

移除的普通默认 catalog 路由包括：

- `ask_clarify`
- `answer`
- `execute_readonly`
- `safe_local_action`
- `permission_pipeline`
- `start_gate`

因此，“有索引 / 优先使用索引”在普通开发请求里只作为模型任务语义保留；如果模型后续通过 tool loop 使用索引，那属于模型/tool loop 行为，不是 NCB 本地抢答。

### 不是关键词补丁

本轮没有做：

- 没有新增普通任务关键词 allowlist。
- 没有新增“部署 / 报告 / 项目 / 索引 / index”放行规则。
- 没有修改 `scoreCapability()` 或新增 boost。
- 没有继续微调自然语言 catalog scorer。
- 没有删除 Catalog；Catalog 仍用于 help、capability summary、slash dispatch coverage 和 NCB focused tests。

本轮本质是入口边界修复：结构化入口走本地控制面，普通输入默认走模型链路。

## 真实 prompt 验收结果

验收 prompt：

```text
帮我看看这是什么项目 该怎么部署 把报告更新在根目录下 有索引 优先使用索引
```

已覆盖两层验收：

1. `handleNaturalInput(...)` 单元回归：
   - 返回值为 `"message"`。
   - 输出不包含 `/index：代码索引`。
2. 真实 TUI stdin smoke（测试内 mock OpenAI-compatible provider）：
   - 输入上述 prompt 后，mock provider request 数量为 1。
   - TUI 输出包含 `状态：正在请求模型`。
   - TUI 输出包含 mock provider 返回文本 `我会先按模型主链路分析项目部署。`。
   - TUI 输出不包含 `/index：代码索引`。

验收结论：该 prompt 不再被 `routeNaturalIntent` / capability catalog 抢走；它进入了 provider/model 请求路径。

## 重点边界验收

- 普通输入不再被 NCB / capability catalog 抢走：PASS。
- slash command 仍正常：PASS；`/model`、`/model doctor`、`/index init fast`、`/index status`、`/cache status`、`/memory` 等测试仍覆盖。
- pending approval / pending Start Gate confirmation 仍正常：PASS；测试直接构造 pending gate 并验证普通“确认”不能替代精确确认。
- 权限边界仍正常：PASS；full test 覆盖 default Write approval、permission continuation、dangerous tool permission 等既有矩阵。
- 自然语言里提到“有索引 / 优先使用索引”只作为模型任务语义：PASS；测试断言不输出 `/index：代码索引`，而进入 provider path。
- 后续模型如通过工具使用索引，属于模型/tool loop 行为，不属于 NCB 本地抢答：保持该边界，未在本轮扩大实现。

## 测试结果

已运行并通过：

```bash
corepack pnpm exec vitest run packages/tui/src/index.test.ts
```

结果：PASS，1 file / 99 tests。

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

结果：PASS，11 files / 290 tests。

```bash
corepack pnpm build
```

结果：PASS，workspace packages build 完成。

## SKIPPED / PARTIAL / BLOCKED

- SKIPPED：未运行真实外部 provider live smoke；本轮验收使用测试内 mock OpenAI-compatible provider 验证“进入 provider/model 请求路径”，避免写入或暴露真实 API key。
- PARTIAL：Phase 15 Beta readiness 仍为 PARTIAL；本报告只关闭本次真实 TUI 普通输入被 NCB/catalog 抢答的问题。
- BLOCKED：无。本轮指定验证命令均已通过。

## Index status

- `mcp__codebase-memory-mcp__index_status(project=F-Linghun)`：ready，nodes=1304，edges=2430。
- `mcp__codebase-memory-mcp__detect_changes(project=F-Linghun)`：changed files = 4 个代码/测试文件：
  - `apps/cli/src/cli.ts`
  - `apps/cli/src/main.test.ts`
  - `packages/tui/src/index.ts`
  - `packages/tui/src/index.test.ts`

## 阶段边界

- 未进入 Phase 15.5。
- 未进入 Phase 16+。
- 未宣布 Phase 15 Beta PASS。
- 未提交 commit。
- 未做大文件重构；本轮只做入口边界的最小必要收口和对应测试/文案修正。

## 剩余风险

- `natural-command-bridge.ts` 的 router/scorer 仍存在，用于 catalog/help/tests 等明确调用场景；如果未来重新接入普通输入主路径，必须重新过 CCB-style input preprocessor 边界审查。
- 极窄 composite status 和 direct file read mention 仍保留为本地轻量前置；当前不依赖 catalog scorer，但真实 Beta 中仍应继续观察是否有新的普通开发任务被误拦截。
