# Phase 7.2 — Product Surface Maturity Closure / P2-P3 Remaining Items

## 阶段基线

- **执行日期**: 2026-06-05
- **基线 commit**: Phase 7.1.1 (测试基线已清零)
- **分支**: `codex/meta-scheduler-closure`
- **阶段类型**: P2/P3 成品成熟度收口（不新增功能）

## 前置确认

- Phase 7.1 / 7.1.1 已完成，以下测试全部通过：
  - `index.test.ts -t "workflows"`: 7/7
  - `job-runtime.test.ts`: 50/50
- 前置条件满足，进入 Phase 7.2。

---

## Source-Level Reality Check

### 已精读模块

| 模块 | 文件 | 精读方式 |
|------|------|---------|
| 主入口/命令路由 | `index.ts` (handleWorkflowsCommand, ~3013-3140) | 全文精读 |
| Agent/Job 运行时 | `job-agent-command-runtime.ts` (select sections) | 定向精读 |
| Job 纯函数 | `job-runtime.ts` (parseJobRunOptions, formatJobBudgetLine) | 全文精读 |
| CommandPanel | `command-panel-runtime.ts` | 全文精读 |
| Footer/底部 | `footer-view.ts`, `view-model.ts` | 全文精读 |
| Plain renderer | `plain-renderer.ts` (295-314) | 定向精读 |
| 文本工具 | `text-utils.ts` | 全文精读 |
| Extension 运行时 | `extension-command-runtime.ts` | 全文精读 |
| 请求生命周期 | `request-lifecycle-presenter.ts` | 全文精读 |
| Model doctor | `model-doctor-runtime.ts` | 全文精读 |
| Workflow bridge | `workflow-agent-runtime-bridge.ts` | 全文精读 |
| Agent/workflow registry | `agent-workflow-registry.ts` | 全文精读 |
| Task suggestion | `task-suggestion.ts` | 全文精读 |

### Existing Implementation

- **CommandPanel** — `showCommandPanel()` 已在 `/workflows`(no args)、`/workflows status`、`/background`、`/agents`、`/job status/report/logs` 等命令使用。Ink 模式设置 `commandPanelState`，非 ink 模式写 `detailsText`。
- **Footer** — Phase 6.6 已排除 `workspaceStatus`/`runtimeStatus` 默认显示。Phase 7.0 已统一 CJK display width。
- **formatJobBudgetLine** — 预算行使用空格分隔 key value，但 "未设置" 硬编码为中文，无英文回退。
- **parseJobRunOptions** — 默认 phase 为 "Phase 17A"，暴露内部开发标签。
- **task-suggestion.ts** — 非死代码。`buildTaskSuggestions` 和 `isKnownSlashCommand` 被 view-model.ts 使用。`buildPermissionSuggestions` 返回 `[]` 是 Phase 6.6 有意设计（权限卡动作已内联到卡片本身）。
- **brandWordmark** — 参数保留是有意设计（API 兼容性），void 语句消除 lint 警告，docstring 说明原因。

### Gaps / Real Issues Found

| # | 问题 | 源码位置 | 风险 | 裁决 |
|---|------|---------|------|------|
| G1 | `/workflows registry` 绕过 CommandPanel，直接 `writeLine` | `index.ts:3064-3065` | P2 | **DONE** |
| G2 | `/workflows plan` 绕过 CommandPanel，直接 `writeLine` | `index.ts:3087` | P2 | **DONE** |
| G3 | `parseJobRunOptions` 默认 phase = "Phase 17A" | `job-runtime.ts:88` | P3 | **DONE** |
| G4 | `formatJobBudgetLine` "未设置" 纯中文，无英文回退 | `job-runtime.ts:202-219` | P2 | **DONE** |

---

## P2/P3 逐项裁决

### P2 项

| # | Phase 6.7 问题 | 裁决 | 代码事实依据 |
|---|--------------|------|-------------|
| P2-1 | index.test.ts 23,625 行 | **NOT-DO** | 不在本阶段范围；用户明确要求不拆 index.ts，拆测试文件=等同规模 |
| P2-2 | view-model.ts 1,390 行 4 职责 | **NOT-DO** | 结构重构不在本阶段范围；当前无用户可见问题 |
| P2-3 | 面板宽度不一致 (76/84/90) | **NOT-DO** | 需改 5+ 面板组件，差异仅 6-14 字符，无用户报告问题 |
| P2-4 | CtrlOToExpand Context Provider 未挂载 | **NOT-DO** | Ink Context 层改动，框架级变更不在本阶段范围 |
| P2-5 | MAX_ROUTE_DECISIONS 双重声明 | **NOT-DO** | Phase 7.0 已部分收敛；剩余项需 runtime-budget.ts 统一，属结构重构 |
| P2-6 | truncateDisplay 3 处实现 | **DONE (Phase 7.0)** | 已在 Phase 7.0 统一到 text-utils.ts |
| P2-7 | 帮助文本 400+ 行硬编码 | **NOT-DO** | 需从工具注册表自动生成，属新能力不在本阶段范围 |
| P2-8 | PROVIDER_STREAM_ERROR → gateway | **DONE (Phase 7.1)** | 已在 Phase 7.1 改为 transit |
| P2-9 | 三套 compact 重复 | **NOT-DO** | 各有真实用途差异；合并需重写 compact 架构 |
| P2-10 | PASS_BANNED_EVIDENCE_KINDS 重复 | **DONE (Phase 7.0)** | 已统一到 workflow-plan-schema.ts |
| P2-11 | redactedPath 重复 | **DONE (Phase 7.0)** | 已统一到 process-command-runtime.ts |
| P2-12 | runMcpStdioToolCall/ToolList 重复 | **NOT-DO** | MCP JSON-RPC 帧解析已在 Phase 6.8 P0-7 修复；合并公共 spawn/settle 逻辑属重构 |
| P2-13 | skills/plugins handler 重复 | **NOT-DO** | 参数化需改 extension-slash-runtime.ts 445 行，属重构不在范围 |
| P2-14 | extension-command-runtime 零测试 | **NOT-DO** | 添加测试属新能力，不是成熟度收口 |
| P2-15 | 第三方 API URL 暴露 | **DONE (Phase 6.8)** | 已替换为通用示例 |
| P2-16 | CI 无 Windows Terminal 冒烟 | **NOT-DO** | CI 配置变更不在本阶段范围 |
| P2-17 | Workflow planner 单 phase | **NOT-DO** | 新功能不在本阶段范围 |
| P2-18 | deepCompact rerun event threshold | **NOT-DO** | 需添加逻辑，不在本阶段范围 |
| P2-19 | mojibake 检测含合法西欧字符 | **NOT-DO** | 当前字符集在实践中极少误触发；修改需验证所有 provider 输出 |
| P2-20 | verification-command-runtime shell:true | **NOT-DO** | 安全相关修改需单独审计，不在本阶段范围 |
| P2-21 | StatusFooter 右栏 displayWidth | **NOT-DO** | Phase 7.0 已统一 footer-view.ts 使用 text-utils displayWidth；StatusFooter 组件层需 Ink 渲染验证 |
| P2-22 | 组件级测试覆盖接近零 | **NOT-DO** | 添加测试属新能力，不在成熟度收口范围 |

### P3 项

| # | Phase 6.7 问题 | 裁决 | 代码事实依据 |
|---|--------------|------|-------------|
| P3-1 | ShellBlockOutput 写入重复 | **NOT-DO** | 结构重构不在范围 |
| P3-2 | createLinghunMdTemplate 内联 60 行 | **NOT-DO** | 模板文本内联是合理设计（单文件、易维护） |
| P3-3 | formatMemoryScope 始终中文 | **NOT-DO** | 大规模 i18n 重写不在范围 |
| P3-4 | brandWordmark 接受参数但 void 忽略 | **NOT-DO** | **有意设计**：保留参数确保 API 兼容性（ShellApp.tsx:55 和 view-model.test.ts:3277 传 3 参），void 语句消除 TS/ESLint 警告。docstring 明确记录了移除 ASCII art 的设计决策 |
| P3-5 | notification.sort() 不稳定 | **NOT-DO** | 排序稳定性问题在实践中无用户报告 |
| P3-6 | formatRelativeTime 内联 | **NOT-DO** | 单文件内使用，提取无实际收益 |
| P3-7 | task-suggestion.ts 死代码 | **NOT-DO** | **非死代码**：`buildTaskSuggestions` 被 view-model.ts consume；`isKnownSlashCommand` 被 ConfigControlPlane 复用；`buildPermissionSuggestions` 返回 `[]` 是 Phase 6.6 有意设计 |
| P3-8 | config-control-plane 14 panel action 过滤 | **NOT-DO** | 运行时行为，非用户可见问题 |
| P3-9 | parseJobRunOptions 默认 phase "Phase 17A" | **DONE** | 改为 `"default"`；同时更新关联的 verification summary 字符串和测试断言 |
| P3-10 | handoff keyFiles 硬编码 | **NOT-DO** | 内部开发路径，不影响外部用户 |
| P3-11 | failure learning 无 delete/purge | **NOT-DO** | 新功能不在范围 |
| P3-12 | loadAgentRegistry 目录不存在时静默返回空 | **NOT-DO** | 按设计：registry 是可选的，空目录=无自定义 agent/workflow，不应报错 |
| P3-13 | context-estimator 中文 token 估算偏差 | **NOT-DO** | 算法改进需独立验证 |
| P3-14 | workspace-reference-cache snapshot 限制 | **NOT-DO** | 大型 monorepo 优化不在范围 |
| P3-15 | btw-runtime 无 BTW 历史 | **NOT-DO** | 新功能不在范围 |
| P3-16 | 自然命令评分否定句 | **NOT-DO** | NL 评分改进需独立验证 |
| P3-17 | `~` 前缀 Windows 困惑 | **NOT-DO** | 运行时正确解析；文档约定 |
| P3-18 | resize debounce 60ms | **NOT-DO** | 配置项不在范围 |
| P3-19 | 面板数字跳转 delta 类型断言 | **NOT-DO** | 无用户可见影响 |

---

## 改动文件

| 文件 | 改动类型 | 行数估计 |
|------|---------|---------|
| `packages/tui/src/index.ts:3064-3092` | 重构：`/workflows registry` + `/workflows plan` 走 CommandPanel | ~30 行 |
| `packages/tui/src/job-runtime.ts:88,202-219` | 修复：默认 phase + budget 行英文化 | ~5 行 |
| `packages/tui/src/job-agent-command-runtime.ts:870` | 修复：verification summary 去 Phase 17A 引用 | 1 行 |
| `packages/tui/src/job-runtime.test.ts:102,198-221` | 修复：测试断言对齐新默认值和新文案 | ~6 行 |

**改动不涉及**: agent/workflow 调度语义、provider/model/env 配置、index.ts 拆分、footer 逻辑、TUI 组件渲染。

---

## 用户可见行为变化

1. **`/workflows registry`** — 从全文刷屏改为 CommandPanel 摘要视图。主屏显示 agent/workflow 数量和 schema 错误数；完整列表在 Ctrl+O detailsText。
2. **`/workflows plan <goal>`** — 从全文刷屏改为 CommandPanel 摘要视图。主屏显示计划生成状态（ok/warning）；完整计划在 Ctrl+O detailsText。
3. **`parseJobRunOptions` 默认 phase** — 新建 job 的默认 phase 从 `"Phase 17A"` 变为 `"default"`。不影响显式传 `--phase` 参数的 job。
4. **job 预算行** — `"未设置"` 变为 `"not set"`；`"预算：未设置"` 变为 `"budget not set"`。中英文用户均可理解。

---

## 测试与验证

### typecheck

```
corepack pnpm --filter @linghun/tui typecheck → clean (no errors)
```

### biome check

```
10 files checked → clean (no fixes applied)
```

### 测试结果

| 测试文件 | 结果 | 备注 |
|---------|------|------|
| `index.test.ts -t "workflows"` | 7/7 pass | workflows 命令回归 |
| `job-runtime.test.ts` | 50/50 pass | 含 budget 文案断言更新 |
| `footer-view.test.ts` | 13/13 pass | footer 降噪回归 |
| `view-model.test.ts` | 318/318 pass | 无回归 |
| `provider-transit-failure.test.ts` | 5/5 pass | 无回归 |
| `runtime-status-presenter.test.ts` | 4/4 pass | 无回归 |
| `model-doctor-runtime.test.ts` | 84/84 pass | 无回归 |
| **合计** | **481/481 pass** | |

---

## 剩余风险

1. **`/workflows plan` summary 文案** — plan 摘要行（`"Plan for \"${goal}\" generated"` / `"已为 \"${goal}\" 生成计划"`）中 goal 可能包含特殊字符。goal 是用户输入且已在 `generateWorkflowPlanPreview` 中使用，此处仅作摘要展示，风险低。
2. **job-runtime.test.ts 中 "Phase 17A" 测试 fixture** — 测试数据中仍有 2 处使用 `phase: "Phase 17A"` 作为显式测试数据（`job-runtime.test.ts:59`, `runner-runtime.test.ts:60`），不是默认值断言，保留为有效测试数据。
3. **index.test.ts 中的 "Phase 17A" 测试名** — 4 个测试用例名称包含 "Phase 17A"（index.test.ts:5404,5421,7226,7296），这些是测试描述和 fixture 数据，不影响生产行为。

---

## 不在本阶段处理的内容

- 不拆 index.ts
- 不新增 UI/panel/footer/details 框架
- 不重写 agent/workflow/job 调度
- 不改 provider/model/env 配置
- 不做 Phase 8/验证系统新能力
- 不做依赖升级
- 不顺手清理无关文件
- 不复制 CCB 源码
- 不做大规模 i18n 重写（已知多个文件有中文-only 函数，但逐一修复将超出本阶段范围）

---

## 明确声明

- **未拆 index.ts** — 仅在 `handleWorkflowsCommand` 函数内做局部重构（~30 行），不涉及文件拆分
- 未新增任何文件
- 未删除任何文件
- 未修改任何公共接口签名

---

## 参考核对

### 本阶段读取的 Linghun 文档

- `docs/delivery/README.md` — 阶段状态总览
- `docs/delivery/phase-6.7-full-source-maturity-audit.md` — P2/P3 审计基线
- `docs/delivery/phase-07-1-user-visible-surface-maturity.md` — Phase 7.1 交付文档
- `docs/delivery/phase-07-duplicate-runtime-systems-consolidation.md` — Phase 7.0 交付文档

### 本阶段精读的 Linghun 源码

12 个文件全文或定向精读（见 Source-Level Reality Check 表）。

### 外部参考

无。全部改动基于 Linghun 自有源码事实和 Phase 6.7 审计线索。

### 未复制可疑源码

全部为 Linghun 自研实现。

---

## Handoff Packet

```json
{
  "phase": "7.2",
  "phaseName": "Product Surface Maturity Closure / P2-P3 Remaining Items",
  "status": "DONE",
  "nextPhase": "index.ts 渐进拆分准备（用户确认后进入）",
  "forbidden": [
    "拆 index.ts（本阶段未拆，仅局部重构）",
    "新增 UI/panel/footer/details 系统",
    "做新功能",
    "改 provider/model/env 配置",
    "改 agent/workflow 调度语义",
    "Phase 8 验证系统新能力"
  ],
  "changes": [
    "index.ts:3064-3092 /workflows registry + /workflows plan → CommandPanel",
    "job-runtime.ts:88 parseJobRunOptions default phase 'Phase 17A' → 'default'",
    "job-runtime.ts:202-219 formatJobBudgetLine 未设置 → not set",
    "job-agent-command-runtime.ts:870 verification summary 去 Phase 17A 引用",
    "job-runtime.test.ts 测试断言对齐"
  ],
  "verification": {
    "typecheck": "clean",
    "biome": "10 files clean",
    "tests": "481/481 pass",
    "testFiles": [
      "index.test.ts workflow (7)",
      "job-runtime.test.ts (50)",
      "footer-view.test.ts (13)",
      "view-model.test.ts (318)",
      "provider-transit-failure.test.ts (5)",
      "runtime-status-presenter.test.ts (4)",
      "model-doctor-runtime.test.ts (84)"
    ]
  },
  "remainingP2": 19,
  "remainingP3": 18,
  "p2ResolvedThisPhase": 1,
  "p3ResolvedThisPhase": 1,
  "indexStatus": "ready (F-Linghun, not rebuilt this phase)",
  "permissionMode": "default",
  "model": "claude-sonnet-4-6",
  "budgetUsed": "12 files read, 4 files modified, ~45 lines changed"
}
```

---

## 下一阶段建议

Phase 7.2 完成了 P2/P3 逐项裁决和最小修复。用户可见层成熟度收口已达到以下状态：

- 所有 `/workflows` 子命令统一走 CommandPanel（summary-first, detailsText via Ctrl+O）
- job 预算行去中文硬编码
- 默认 phase 不再暴露内部开发标签
- 全部 481 个相关测试通过

下一步可由用户决定是否进入：
- **index.ts 渐进拆分** — 将超大文件按职责拆分为多个模块，但需小心避免破坏现有调用链
- **Phase 8 验证增强** — 建立更完整的自动化验证体系
- 或其他优先级
