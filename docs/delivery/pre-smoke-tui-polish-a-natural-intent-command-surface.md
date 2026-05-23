# Pre-Smoke TUI Polish A：Natural Intent + Command Surface

## 状态

- 本轮性质：Polish A — Natural Intent + Command Surface。
- 本轮只处理 P0-1 / P0-2 / P0-3 / P0-4。
- 本轮未做 Polish B / C / D。
- 本轮未进入真实 smoke。
- 本轮不是 Beta PASS、不是 smoke-ready、不是 open-source-ready。
- 本轮未进入 Phase 18 / 桌面端 / 开源发布。
- 本轮未提交 commit。

## Source-Level Reality Check 摘要

### existing implementation

- codebase-memory 索引项目 `F-Linghun` 可用，状态为 `ready`（1858 nodes / 3905 edges）。本轮先用索引定位，再精读必要源码确认。
- `packages/tui/src/natural-command-bridge.ts` 已有 Natural Command Bridge、`CommandCapability`、`SLASH_COMMAND_REGISTRY`、`USER_VISIBLE_SLASH_COMMANDS`、自然语言 intent routing、pending natural gate、exact confirmation guard、Start Gate 边界和 permission pipeline 边界。
- 已有 catalog 覆盖 `/model`、`/mode`、`/index`、`/mcp`、`/memory`、`/job`、`/agents`、`/read`、`/write`、`/edit`、`/bash`、`/exit` 等用户可见命令。
- 当前四个用户可见权限模式为 `default` / `auto-review` / `plan` / `full-access`；legacy alias 只作为兼容或历史证据。
- `packages/tui/src/runtime-status-presenter.ts` 已有独立状态行 presenter，输入 view 已包含 model/provider/endpointProfile/reasoningStatus/mode 等字段。
- `packages/tui/src/index.ts` 已有启动屏、slash dispatch、help、unknown command fallback、状态输出和自然语言主入口处理。

### gaps

- 当前问题不是“没有自然语言能力”；已有 NCB、CommandCapability、Start Gate、pending approval、permission pipeline 和四权限模式。
- 缺口是 command surface 没产品化：状态行不显模型名，`/help` 平铺且不可扫读，unknown command 无相似建议，slash discovery/typeahead 弱，catalog 缺少 group 导致 help / suggestions / discovery 难共用一份数据。
- 四权限模式在用户可见层不够清楚：用户不容易在启动屏和 help 中理解自然语言目标在当前模式下会怎样触发确认、规划或执行。

### minimal touch points

- `packages/tui/src/runtime-status-presenter.ts`：状态行显示模型名与人话权限模式短标签；不显示 provider/baseURL/apiKey/endpointProfile/reasoningStatus。
- `packages/tui/src/natural-command-bridge.ts`：在现有 `CommandCapability` 上补最小 `group` 字段，并导出用户可见 capability 列表，作为 help / suggestion / discovery 的统一 catalog foundation。
- `packages/tui/src/index.ts`：启动屏、`/help` / `/help all`、unknown command suggestions、`/` / `/?` / partial slash discovery。
- 测试扩展现有 `index.test.ts`、`natural-command-bridge.test.ts`，并新增一个小型 `runtime-status-presenter.test.ts`。

### forbidden duplicate systems

- 未新建第二套自然语言桥。
- 未新建第二套权限管道、Start Gate、provider/model runtime、evidence、MCP、index、memory、job runtime。
- 未新增 Fuse.js / fuzzysort / 其他搜索依赖。
- 未复制 CCB / OpenCode / Warp / 第三方源码。

## 关闭/推进的 P0

| P0 | 本轮裁决 | 结果 |
| --- | --- | --- |
| P0-1 Runtime Status Line 显示模型名 | 关闭 | 状态行现在显示模型名和人话权限模式短标签；provider/baseURL/key/token/endpointProfile/reasoningStatus 不进主状态行。 |
| P0-2 `/help` 分组与可扫读 | 关闭/推进 | `/help` 默认输出分组命令清单，强调自然语言主入口、slash 精确入口，并展示四权限模式差异；`/help all` 保留完整列表。 |
| P0-3 unknown command similar suggestions | 关闭 | 未知 slash command 现在基于统一 catalog 给出 1-3 个简单相似建议；无建议时仍提示 `/help`。 |
| P0-4 slash command discovery/typeahead foundation | 推进 | `/` 和 `/?` 显示分组候选；部分 slash 如 `/mo` 显示 prefix candidates。当前是 non-interactive typeahead foundation，不是假装真实 Tab typeahead。 |

## 明确后置到 Polish B

- P0-5 Workspace Trust：本轮未做，归 Polish B。
- P0-6 基础快捷键 / Footer hints：Section 11 已将原 P1-3 升级为 P0-6，本轮未做，归 Polish B。
- 真实 Shift+Tab / Esc / Enter / Tab key handling、Permission / Plan approval UX 也归 Polish B。

## Section 11 OpenCode / Warp catch-up 吸收方式

- 吸收 OpenCode 的统一 CommandOption catalog 思路，但不复制实现：本轮只在现有 `CommandCapability` 上增加 `group`，让 help、unknown suggestions 和 slash discovery 尽量复用同一份 capability/catalog 数据。
- 没有新增第二套命令表，没有引入 OpenCode 的 fuzzysort 或 CCB 的 Fuse.js。
- Warp 的 block model、7-step onboarding、ONNX input classifier 不采纳；本轮只保留“状态与命令发现应可扫读”的产品启发。

## 强底座、轻学习体现

- 自然语言仍是主入口：启动屏和 `/help` 都先提示用户可以直接描述目标。
- Slash 命令是高级/精确入口：`/help` 只给分组和短入口，完整列表通过 `/help all` 查看。
- 快捷键是后续高频入口：本轮只做 non-interactive typeahead foundation，真实 key handling 留 Polish B，不把成熟 TUI 降级成“让用户多敲 `/xxx`”。

## 四权限模式的用户可见差异

- `default`：风险动作会先确认。
- `auto-review`：低风险编辑更顺滑，高风险仍确认。
- `plan`：只规划，不直接改。
- `full-access`：本地开启后减少确认，但安全边界仍生效。

这些说明现在出现在启动屏、主状态行短标签和 `/help` 默认输出中；未改变底层权限语义。

## 修改文件清单

- `packages/tui/src/runtime-status-presenter.ts`
- `packages/tui/src/runtime-status-presenter.test.ts`
- `packages/tui/src/natural-command-bridge.ts`
- `packages/tui/src/natural-command-bridge.test.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/index.test.ts`
- `docs/delivery/pre-smoke-tui-polish-a-natural-intent-command-surface.md`

备注：工作区开工前已有 `docs/delivery/pre-open-source-terminal-product-completion-gate.md` 未提交修改；本轮未依赖该文件 diff 作为实现内容。

## 使用方式

- 启动 TUI 后，主屏显示项目名、模型名、当前权限模式，并提示可直接用自然语言描述目标。
- `/help`：查看分组、短说明和四权限模式差异。
- `/help all`：查看完整命令列表。
- `/` 或 `/?`：查看分组 slash 候选。
- `/mo` 这类部分 slash：查看 prefix candidates。
- 输错如 `/modex`：得到 `/model` 或 `/mode` 等相似建议。

## 测试与验证

已运行：

```text
corepack pnpm exec vitest run packages/tui/src/runtime-status-presenter.test.ts packages/tui/src/natural-command-bridge.test.ts packages/tui/src/index.test.ts -t "status|help|slash|command|unknown|natural|mode|Polish A"
PASS：3 files passed；229 passed / 61 skipped。
```

```text
corepack pnpm exec vitest run packages/tui/src/index.test.ts
PASS：1 file passed；158 passed。
```

```text
corepack pnpm typecheck
PASS：tsc -b tsconfig.json。
```

```text
corepack pnpm check
PASS：biome check .；65 files checked。
```

```text
git diff --check
PASS：无 whitespace error 输出。
```

说明：首次 `corepack pnpm check` 曾发现 formatter 差异；已按 formatter 结果收敛后重跑通过。

## 成本 / 缓存 / 权限 / 会话影响

- 未新增模型调用。
- 未修改 prompt/cache/stable context。
- 未修改 provider runtime、model loop、permission pipeline、Start Gate 语义、evidence、MCP、index、memory、job runtime。
- help/suggestion/discovery 均为本地 catalog 格式化。
- full-access 仍不能通过自然语言静默开启。

## 未做内容

- 未做 Workspace Trust。
- 未做真实快捷键系统、Footer hints、Tab/Shift+Tab/Esc/Enter handling。
- 未做 Permission / Plan approval UX。
- 未做 Light Hints / Error / Doctor / Details / Output Tone。
- 未做 First-run language persistence / Memory UX / Narrow Terminal。
- 未做真实 smoke。
- 未宣布 Beta PASS / smoke-ready / open-source-ready。
- 未进入 Phase 18 / 桌面端 / 开源发布。
- 未提交 commit。

## 下一步建议

建议下一步只在用户确认后进入 Polish B：Workspace Trust + 基础快捷键 / Footer hints + Permission / Plan approval UX。Polish B 仍需先做 Source-Level Reality Check，并继续复用现有 Start Gate / permission pipeline，不新建第二套审批系统。

## Handoff Packet

```json
{
  "stage": "Pre-Smoke TUI Polish A",
  "scope": "Natural Intent + Command Surface only",
  "closedOrAdvancedP0": ["P0-1", "P0-2", "P0-3", "P0-4"],
  "deferredToPolishB": ["P0-5 Workspace Trust", "P0-6 Basic shortcuts/Footer hints"],
  "forbiddenNextActions": [
    "Do not claim Beta PASS",
    "Do not claim smoke-ready",
    "Do not claim open-source-ready",
    "Do not enter real smoke without user confirmation",
    "Do not enter Phase 18/Desktop/Open-source release",
    "Do not add a second command catalog or natural-language executor"
  ],
  "indexStatus": "F-Linghun ready; 1858 nodes / 3905 edges",
  "validation": [
    "focused vitest PASS",
    "index.test.ts PASS",
    "typecheck PASS",
    "check PASS",
    "git diff --check PASS"
  ],
  "runtimeMode": "No Linghun runtime mode changed; product modes displayed: default/auto-review/plan/full-access",
  "modelProvider": "Implementation session: Claude Code / claude-sonnet-4-6; no new Linghun model calls added",
  "budgetUsage": "Not measured in product runtime; no extra provider calls introduced"
}
```
