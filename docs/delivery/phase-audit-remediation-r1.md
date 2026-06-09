# Audit Remediation R1 - TUI 噪音削减 + Bug 修复

## 阶段目标

按根目录 `AUDIT_REMEDIATION_PLAN.md` 的 Phase R1，收尾 TUI 默认主屏噪音削减、死代码/重复小模块清理、Shift+Enter 输入修复和最小验证闭环。不进入 Phase R2，不做视觉渲染增强，不新增依赖。

## 已完成功能

- 删除 `config-control-plane` 独立模型，ConfigPanel 列表直接映射 slash 命令并通过现有 slash registry 过滤。
- 删除 `footer-view` 独立模型，footer 默认保留权限模式、模型名称、缓存、索引状态、推理强度；费用估算隐藏，避免不同模型真实费用不可确认时误导用户。
- 删除 `task-suggestion` 独立模型，TaskSuggestion 类型和构造逻辑内联到 view-model，避免小文件噪音。
- 删除 `input-owner-controller` 独立模型，Composer 内部直接保留优先级 if-chain。
- 删除 Composer SGR wheel 死代码路径，不再在 Composer 内解析 transcript wheel/geometry。
- 删除主屏内部 runtime context redaction note，不再追加“内部运行时上下文已从主屏省略”元噪音。
- 删除 NO_COLOR 限制提示行。
- 默认隐藏后台任务摘要；blocked/failed/running 等后台状态不再进入默认 task 主屏，完整处理路径走 `/background`、`/details`、`/job report` 或日志。
- 工具开始横幅默认抑制，工具结果仍保留。
- Home vision 文本移除，普通首页只保留 `LingHun` 品牌行。
- Shift/Meta + Enter 归一为 newline；底层 multiline enter sequence 支持 `\x1B\r`；Ctrl+J 仍插入 newline。
- 失败 verification 主屏不再要求默认输出 `log:`，但结构化 `lastVerification.commands[].logPath` 仍保留。

## 使用方式

- 普通启动：`linghun` 或 Windows 兼容入口 `Linghun`。
- 查看完整状态：TUI 内使用 `/status`。
- 查看后台任务：TUI 内使用 `/background`。
- 插入换行：Shift+Enter / Meta+Enter / Ctrl+J。

## 涉及模块

- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/shell/components/Composer.tsx`
- `packages/tui/src/shell/components/StatusFooter.tsx`
- `packages/tui/src/shell/types.ts`
- `packages/tui/src/shell/plain-renderer.ts`
- `packages/tui/src/shell/models/terminal-input-runtime.ts`
- `packages/tui/src/model-prompt-runtime.ts`
- `packages/tui/src/model-tool-runtime.ts`
- `packages/tui/src/startup-runtime.ts`
- 相关 focused 测试文件

删除文件：

- `packages/tui/src/shell/models/config-control-plane.ts`
- `packages/tui/src/shell/models/config-control-plane.test.ts`
- `packages/tui/src/shell/models/footer-view.ts`
- `packages/tui/src/shell/models/footer-view.test.ts`
- `packages/tui/src/shell/models/task-suggestion.ts`
- `packages/tui/src/shell/models/task-suggestion.test.ts`
- `packages/tui/src/shell/models/input-owner-controller.ts`
- `packages/tui/src/shell/models/input-owner-controller.test.ts`

## 关键设计

- R1 是降噪和 bugfix 阶段，只清掉默认主屏噪音与重复小模块，不新增 UI 系统。
- Footer 默认保留权限模式、模型、缓存、索引、推理强度；费用估算和详情指标留给 `/status`，不丢能力。
- ConfigPanel 不再维护单独 action 层，面板选择直接发 slash command，减少无效中转。
- 后台任务状态不再污染默认 transcript；异常态不在主屏展开，完整列表和处理入口走 `/background`。
- Shift/Meta Enter 只在明确 key metadata 或已解析 escape sequence 时插入换行，不臆测普通 CR。

## 配置项

- 无新增配置项。
- 无依赖、provider、模型、权限模式或构建脚本变更。

## 命令

- `linghun`
- `Linghun`
- `/status`
- `/background`

## 测试与验证

已运行：

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui typecheck` | PASS |
| `corepack pnpm exec vitest run packages/tui/src/shell/models/terminal-input-runtime.test.ts packages/tui/src/shell/view-model.test.ts packages/tui/src/index.test.ts` | PASS，1037 tests；完整输出：`C:\Users\Admin\.claude\projects\F--Linghun\1d54095f-6f93-4397-908a-44610c09ca5e\tool-results\bmtbk5ox3.txt` |
| `corepack pnpm --filter @linghun/tui build` | PASS；完整输出：`C:\Users\Admin\.claude\projects\F--Linghun\1d54095f-6f93-4397-908a-44610c09ca5e\tool-results\bynb7h3dm.txt` |
| `corepack pnpm build` | PASS；完整输出：`C:\Users\Admin\.claude\projects\F--Linghun\1d54095f-6f93-4397-908a-44610c09ca5e\tool-results\b48riy0vb.txt` |
| `node apps/cli/dist/main.js --version` | PASS，输出 `0.1.0` |
| `node apps/cli/dist/main.js --help` | PASS，帮助文本正常输出 |

另有一次 focused vitest 初跑失败：`packages/tui/src/index.test.ts` 中 `reports failed verification with log path and next action` 仍期待主屏默认包含 `log:`。已按 R1 默认隐藏后台/详情噪音边界更新断言，保留结构化 `logPath` 校验；随后 focused vitest 通过。

## 性能结果

- 本轮未运行 benchmark。
- 删除重复小模块和默认横幅不会增加模型调用、后台任务或渲染负担。
- Footer/主屏默认输出减少，预期降低 transcript 噪音和用户扫读成本。

## 已知问题

- 本轮验证为 focused/local + build + CLI help/version，不等于真实 full smoke、Beta PASS、smoke-ready 或 open-source-ready。
- 未手动验证 Windows Terminal / VS Code Shift+Enter 真实按键路径；源码与 focused input runtime 测试已覆盖 key metadata 与 `\x1B\r` sequence。
- `WHITEPAPER.zip`、`report.md`、根目录 `AUDIT_REMEDIATION_PLAN.md` 是既有未跟踪文件状态，本轮未作为 R1 产物处理。

## 不在本阶段处理的内容

- 不进入 Phase R2 的 markdown/表格/spinner/diff/theme/工具折叠/streaming cursor/轮次分隔等视觉增强。
- 不进入 Phase R3-R7。
- 不新增依赖，不修改 provider/model/env。
- 不恢复 app-owned mouse drag selection。
- 不做全局重构或拆分大文件。

## 下一阶段衔接

Phase R1 已完成 local/focused 收尾。下一步只能由用户确认是否进入 Phase R2；进入前应重新按 `AUDIT_REMEDIATION_PLAN.md` R2 范围评估依赖、i18n 和渲染验证成本。

## 开发者排查入口

- Footer 降噪：`packages/tui/src/shell/components/StatusFooter.tsx`、`packages/tui/src/shell/view-model.ts`
- ConfigPanel slash 映射：`packages/tui/src/shell/view-model.ts`、`packages/tui/src/shell/components/Composer.tsx`
- Input owner：`packages/tui/src/shell/components/Composer.tsx`
- Shift/Meta Enter：`packages/tui/src/shell/models/terminal-input-runtime.ts`
- 主屏 context note：`packages/tui/src/model-prompt-runtime.ts`
- 工具开始横幅：`packages/tui/src/model-tool-runtime.ts`
- NO_COLOR 限制提示：`packages/tui/src/startup-runtime.ts`

## 参考核对

实际读取的 Linghun 文档：

- `F:\Linghun\AUDIT_REMEDIATION_PLAN.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- 已完成阶段交付记录模板：`F:\Linghun\docs\delivery\phase-runtime-regression-closure-2026-06-08.md`

实际参考的本地 CCB / CCB Dev Boost / 社区项目文件：

- 本轮未读取 CCB 源码文件；只按 `AUDIT_REMEDIATION_PLAN.md` 中已裁决的 CCB 行为目标做 Linghun 自研收尾。
- 本轮只参考行为边界：默认低噪 footer、低噪权限/工具显示、Shift+Enter newline 体验。
- 未复制 CCB 源码、内部 API、专有遥测或内部服务逻辑。

## 成品级结构化 handoff packet

- 下一阶段：等待用户确认是否进入 `AUDIT_REMEDIATION_PLAN.md` Phase R2。
- 禁止事项：不要在 R1 后自动进入 R2；不要恢复默认后台 running 摘要、tool start banner、home vision、runtime context note 或 NO_COLOR 限制行；不要把 `/status` 详情指标重新塞回默认 footer。
- 证据引用：本文件“测试与验证”；源码入口见“开发者排查入口”。
- 验证结果：TUI typecheck PASS；focused vitest 1037/1037 PASS；TUI build PASS；全仓 build PASS；CLI version/help smoke PASS。
- 索引状态：本轮未使用外部 codebase-memory MCP；用源码精读、`git diff`、`rg`/Grep 和构建验证确认。
- 权限模式：Auto Mode；本轮执行本地文件编辑、删除和本地验证命令。
- 模型/provider：未调用 live provider；当前会话模型为 Claude Opus 4.6。
- 预算使用：无外部 provider 预算；本地 typecheck/vitest/build/CLI smoke。
