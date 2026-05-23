# Pre-Smoke P1/P2 Remediation Closure

## 状态声明

- 本轮性质：真实模型/真实项目 smoke 前的 P1/P2 收口准备。
- 未运行真实模型。
- 未使用真实 provider key。
- 未进入 `F:\linghun-ceshi` 真实项目 smoke。
- 未提交 commit。
- 当前仍不是 Beta PASS / smoke-ready / open-source-ready。

## 修改文件清单

- `.gitattributes`：新增 Windows/LF/CRLF 行尾策略。
- `.editorconfig`：新增通用编辑器缩进、LF、UTF-8、末尾换行规则。
- `README.md`：更新当前状态段，移除旧 Phase 15 pre-Beta 暂停作为当前状态的口径。
- `docs/delivery/phase-17-pre-smoke-index-ts-split-plan.md`：新增 `packages/tui/src/index.ts` 首批拆分计划。
- `docs/delivery/real-project-smoke-checklist.md`：新增真实 provider + 真实项目 smoke checklist。
- `docs/delivery/pre-smoke-p1-p2-remediation-closure.md`：新增本收口报告。

## P1 修复结果

| 项 | 要求 | 结果 | 裁决 |
| --- | --- | --- | --- |
| P1-1 | 为 `packages/tui/src/index.ts` 过大风险提供首批拆分计划，不做大拆代码 | 已新增 `docs/delivery/phase-17-pre-smoke-index-ts-split-plan.md`，列出 permission pipeline、slash command router、model loop、runner/remote helpers 的风险、验证命令和 smoke 前建议 | CLOSED_FOR_PRE_SMOKE_PLAN |
| P1-2 | 新增 `.gitattributes` 稳定 Windows/LF/CRLF 行尾策略 | 已新增 `.gitattributes`，包含 `* text=auto` 和 TS/TSX/JS/JSON/MD/YML/YAML/TOML 的 LF 规则 | CLOSED |
| P1-2 | 新增 `.editorconfig` 统一缩进、LF、UTF-8、末尾换行 | 已新增最小通用 `.editorconfig`，不改变项目格式化风格 | CLOSED |
| P1-3 | 更新 `README.md` 当前状态段 | 已反映 Phase 15.5A-F、Phase 16、Phase 17A/B/C focused/local validation 已完成；明确仍不是 Beta PASS / smoke-ready / open-source-ready；下一步为 P1/P2 closure 后进入真实项目 smoke；指向 `START_NEXT_CHAT.md` 和 pre-smoke audit | CLOSED |

## P2 closure 裁决表

“是否阻塞真实 smoke”仅表示是否阻塞进入用户确认后的真实 smoke 试运行，不表示对应能力已通过真实 provider / 真实项目验证。

| 项 | 问题 | Closure 裁决 | 是否阻塞真实 smoke |
| --- | --- | --- | --- |
| P2-1 | `webhook_mock` transport | 确认为 diagnostic/test-only 边界；用于 notification-only dry run 或 focused/local 测试，不代表真实 remote delivery PASS | 不阻塞 |
| P2-2 | MCP `placeholder` 标记 | 确认为安全占位；用于声明未 dump real tool schemas，不是假实现，不应冒充真实 MCP schema loaded | 不阻塞 |
| P2-3 | Hard skip dirs | `.git`、`node_modules`、`dist` 等为合理默认跳过；配置支持 `.linghunignore` / `.cbmignore` 覆盖 | 不阻塞 |
| P2-4 | Bundled codebase-memory | 归 release/open-source packaging gate 或后置 managed packaging；不阻塞真实 smoke，但不得声明 bundled release PASS | 不阻塞 |
| P2-5 | Release artifact | 归 packaging gate；当前 `pnpm build` + CLI 运行不等于 standalone release artifact | 不阻塞 |
| P2-6 | `index.ts` 剩余拆分 | 已并入 P1-1 拆分计划；剩余拆分作为 smoke 后维护性任务或 smoke 暴露问题后的定向拆分 | 不阻塞 |
| P2-7 | focused/mock/local 测试 | 已新增真实 smoke checklist；明确 mock/local/focused PASS 不能算 live PASS | 不阻塞，但真实 smoke 必须单独执行 |

## 真实 smoke checklist

- 路径：`docs/delivery/real-project-smoke-checklist.md`
- 测试项目：`F:\linghun-ceshi`
- Provider 配置：仅临时 env 注入 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` 占位，不保存真实值。
- 报告边界：只写 summary + artifact refs，不写真实 key、raw provider request、完整 provider response 或完整日志。

## 索引状态

- codebase-memory 项目名：`F-Linghun`
- codebase-memory 索引查询状态：`ready`，仅表示索引可查询，不表示 smoke-ready。
- 索引只用于定位和交叉确认，最终 closure 仍以源码、文档和验证命令为准。

## 安全边界

- 本轮没有运行真实 provider。
- 本轮没有读取、请求或保存真实 provider key。
- 本轮新增文档只包含 env 名称占位，不包含真实 key 值。
- 本轮不把 focused/mock/local PASS 写成 live PASS。
- 本轮不宣布 Beta PASS / smoke-ready / open-source-ready。

## 验证结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm check` | PASS |
| `corepack pnpm build` | PASS |
| `git diff --check` | PASS，无 whitespace error 输出 |
| `git status --short` | 已记录：本轮新增/修改文件未提交；`docs/audit/pre-smoke-comprehensive-audit-2026-05-23.md` 为本轮开始前已存在的 untracked audit 报告 |
| 新增/修改文档 `sk-[A-Za-z0-9_-]+` 搜索 | PASS，无匹配 |

## 是否可以进入第二阶段 Real Provider + Real Project Smoke

本节不是 smoke-ready 裁决，也不表示自动进入真实 smoke。它只说明：本报告对应变更通过指定验证与安全检查后，下一步可由用户选择是否启动第二阶段 Real Provider + Real Project Smoke 试运行。

进入第二阶段仍需遵守：

- 真实 key 只允许用户临时通过 env 注入。
- 不保存真实 key。
- 不写 raw provider request。
- 不写完整 provider response。
- 不写完整日志。
- 每轮真实 smoke 按 `docs/delivery/real-project-smoke-checklist.md` 单独记录 PASS/BLOCKED/FAIL。
