---
title: Pre-Smoke TUI Task Panel Maturity
status: LOCAL_VERIFIED
updated: 2026-06-02
---

# Pre-Smoke TUI Task Panel Maturity

## 本轮定位

本轮只做 TUI task/background 展示层与交互层收口，不新增任务能力，不改变 provider/model/key/env route，不碰 `.claude`。目标是让主屏只显示轻量任务摘要，完整任务细节继续走 `/background`、`/details` 或 Ctrl+O。

## 已完成

- 主屏 background task 展示收敛为单条任务摘要 pill：运行中、待确认、失败/阻塞计数，以及当前步骤/下一步。
- `/background` Ink 面板按现有 task kind 分组展示：Agent、Verification、Bash/job、Index、MCP、Other。
- 面板每项只显示 title、status、progress、current step、next action。
- 面板主屏过滤 `sourceRef`、`schema`、`debug`、`gate retry`、`passEvidence`、`raw evidence`、`tool_result raw`、`endpoint`、`runner=` 等机制词。
- `/details background <id>`、`/details output <id>`、Ctrl+O details 路径保留完整展开入口。

## 未做

- 未新增 background task 状态机、runner、job/agent 能力或快捷键能力。
- 未修改 provider/model/key/env route。
- 未修改 `.claude`。
- 未改变权限、建议、自然语言主链；仅复用现有 view-model 状态。

## 涉及模块

- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/shell/types.ts`
- `packages/tui/src/job-agent-command-runtime.ts`
- `packages/tui/src/job-runner-presenter.ts`
- `packages/tui/src/index.ts`

## 参考核对

- 已读取 Linghun 阶段蓝图、实现规格、最终架构路线、delivery README。
- 已读取本地 CCB 参考文件：`BackgroundTaskStatus.tsx`、`BackgroundTasksDialog.tsx`、`BackgroundTask.tsx`、`TaskListV2.tsx`。
- 只参考行为原则：轻量摘要、分组面板、截断、空态、详情展开。
- 未复制 CCB 源码、组件结构、hook、状态管理或专有概念。

## 验证结果

- `corepack pnpm exec tsc --noEmit`：PASS。
- `corepack pnpm --filter @linghun/tui exec vitest run src/index.test.ts src/shell/view-model.test.ts src/shell/ink-interaction-smoke.test.ts`：PASS，752 tests。
- `corepack pnpm -r build`：PASS。
- `git diff --check`：PASS。

## Handoff Packet

- next phase：由用户决定；本轮不自动进入下一阶段。
- forbidden：不新增任务能力，不改 provider/model/key/env route，不碰 `.claude`，不复制 CCB 源码。
- evidence：上述验证命令；新增/更新测试覆盖主屏摘要、Ink `/background` 分组面板、机制词过滤。
- index status：codebase-memory 工具本轮不可用，按仓库规则降级为 `rg` 与源码精读。
- permission mode：本地 Codex 无审批模式变更；未执行 stage/commit。
- provider/model：未修改 provider/model route。
- budget usage：未使用外部模型 runtime；只做本地源码修改与验证。
