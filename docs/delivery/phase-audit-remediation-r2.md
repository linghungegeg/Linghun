# Audit Remediation R2 - 视觉质量 + 输出渲染

## 阶段目标

按根目录 `AUDIT_REMEDIATION_PLAN.md` 的 Phase R2，完成 TUI Markdown/代码/表格渲染、spinner 状态表现、主题、composer/permission/user message 视觉分层、工具折叠和 `/status` context 用量进度条。不进入 Phase R3，不实现 Task/Agent/Workflow 可视化。

## 已完成功能

- `packages/tui` 新增 `cli-highlight` 与 `marked` 依赖。
- `MessageMarkdown` 改为基于 `marked.lexer()` 的 token 渲染，覆盖 heading、paragraph/text、blockquote、ordered/unordered/task list、code、table、hr 与基础 inline code/bold/italic/link。
- 代码块按 `lang` 调用 `cli-highlight`，异常时回退纯文本；`diff`/`patch` 的 `+`/`-` 行分别走 success/error 色。
- Markdown token 与 code highlight 增加 bounded LRU cache（128 条上限）。
- 表格渲染支持边框、列宽自适应、多行 cell；窄宽/超宽时切换 vertical key-value 展示。
- streaming markdown 不稳定尾部显示 `▌` 光标。
- `ActivityIndicator` 增加 100ms spinner 动画、thinking 呼吸加粗、默认 thinking verb 轮换、慢状态变色和 30s 后 streaming 文本估算 token 数提示。
- `createShellTheme(noColor, mode)` 支持 dark/light；`LINGHUN_THEME=light` 切换浅色主题。
- Composer 改为 Ink `borderStyle="round"` 圆角边框，移除 ShellApp 外层旧横线包裹。
- Permission action 当前焦点使用 inverse 显示。
- 用户消息增加 dim 分隔线、间距和 `backgroundColor`，与 assistant message 分层。
- 连续 read/search/extension/control 类工具输出折叠阈值改为 3+；2 次保持独立展示。
- Task footer 与 `/status` 增加 context usage 进度条展示。

## 使用方式

- 普通启动：`linghun` 或 Windows 兼容入口 `Linghun`。
- 浅色主题：启动前设置 `LINGHUN_THEME=light`。
- 查看 context 用量：TUI 内使用 `/status`。
- 查看折叠工具详情：主屏提示仍走 Ctrl+O / details 链路。

## 涉及模块

- `packages/tui/package.json`
- `pnpm-lock.yaml`
- `packages/tui/src/shell/components/MessageMarkdown.tsx`
- `packages/tui/src/shell/components/ShellApp.tsx`
- `packages/tui/src/shell/components/Composer.tsx`
- `packages/tui/src/shell/components/ProductBlock.tsx`
- `packages/tui/src/shell/components/StatusFooter.tsx`
- `packages/tui/src/shell/theme.ts`
- `packages/tui/src/shell/types.ts`
- `packages/tui/src/shell/view-model.ts`
- `packages/tui/src/context-window-runtime.ts`
- `packages/tui/src/runtime-status-presenter.ts`
- `packages/tui/src/details-status-runtime.ts`
- `packages/tui/src/runtime-status-presenter.test.ts`
- `packages/tui/src/shell/view-model.test.ts`

## 关键设计

- Markdown renderer 继续保持 Linghun 自研 React/Ink 渲染层，只使用 `marked` 做 lexer，不引入第三方 React markdown renderer。
- `cli-highlight` 仅用于代码块 ANSI 高亮；diff 行色由 Linghun 现有 theme/status 色自行裁决。
- Streaming 边界保持原 stable prefix / unstable suffix 分离，只在 unstable/空 streaming 状态追加 `▌`。
- Composer 圆角边框由 Composer 自身持有，ShellApp 不再额外画上下横线，避免双边框。
- Activity 动画只轮换默认 `Thinking…` / `正在思考…` 文案；外部传入的自定义 activity 文案保持原样。
- 工具折叠只调整阈值到 R2 要求的 3+，不新增第二套详情面板或工具 runtime。
- `/status` context 进度条只在已有 `compactPressure` 数据存在时展示，避免无数据时制造“上下文?”噪音。

## 配置项

- 新增环境变量读取：`LINGHUN_THEME=light` 时使用浅色主题；其他值默认 dark。
- 无 provider、权限模式、模型路由或构建脚本变更。

## 命令

- `linghun`
- `Linghun`
- `/status`
- Ctrl+O / `/details`

## 测试与验证

已运行：

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm --filter @linghun/tui typecheck` | PASS |
| `corepack pnpm vitest run packages/tui/src/runtime-status-presenter.test.ts packages/tui/src/shell/view-model.test.ts --reporter=dot --silent` | PASS，349 tests |
| `corepack pnpm --filter @linghun/tui build` | PASS；完整输出：`C:\Users\Admin\.claude\projects\F--Linghun\5dd38ff0-0da1-4940-b003-3c62ca57f40c\tool-results\butnsv340.txt` |

曾出现的验证失败与处理：

- `packages/tui/src/shell/view-model.test.ts` 旧断言仍要求 home composer 无圆角边框、TaskLayout 有手工 composerRule、user_text marginBottom=0；已按 R2 视觉目标更新断言。
- Activity 自定义文案测试被默认 verb 轮换覆盖；已收窄为仅默认 thinking 文案轮换。

## 性能结果

- 本轮未运行 benchmark。
- Markdown token / code highlight cache 为 bounded Map LRU，限制 128 条，避免无限增长。
- 新增 spinner interval 只在 active thinking/tool/continuing 阶段启用，completed/error/permission_waiting 不启动动画 timer。

## 已知问题

- 本轮验证为 TUI typecheck + focused/local tests，不代表真实 full smoke、Beta PASS、smoke-ready 或 open-source-ready。
- 未做真实 Windows Terminal 视觉录屏验证；圆角边框、backgroundColor、inverse、spinner 动画由 Ink 渲染测试和源码断言覆盖。
- R2 中“随机 30+ verb 词库”未完整展开为 30+ 文案；本轮按最小成品闭环实现默认 thinking 轮换。30s 后 token 提示使用当前 streaming 文本长度估算，不读取 provider 真实 token counter。
- `WHITEPAPER.zip`、`report.md`、根目录 `AUDIT_REMEDIATION_PLAN.md` 是既有未跟踪文件状态，本轮未作为 R2 产物处理。

## 不在本阶段处理的内容

- 不进入 Phase R3 的 Task/Agent/Workflow 可视化树、token 树、agent progress panel。
- 不新增第二套 markdown renderer、terminal renderer、theme registry 或 tool detail panel。
- 不实现真实 6 主题系统；本轮只完成 dark/light/no-color。
- 不修改 provider/model/env 配置语义。
- 不做真实 full smoke、Beta 判定或开源发布判定。

## 下一阶段衔接

Phase R2 已完成 focused/local 闭环。下一步只能由用户确认是否进入 `AUDIT_REMEDIATION_PLAN.md` Phase R3；进入前应重新按 R3 范围拆分 Task/Agent/Workflow 可视化触点，不复用 R2 渲染阶段作为完成依据。

## 开发者排查入口

- Markdown / table / code / diff / streaming cursor：`packages/tui/src/shell/components/MessageMarkdown.tsx`
- Spinner/activity：`packages/tui/src/shell/components/ShellApp.tsx`、`packages/tui/src/shell/view-model.ts`
- Theme：`packages/tui/src/shell/theme.ts`
- Composer / permission focus：`packages/tui/src/shell/components/Composer.tsx`
- User/assistant visual layering：`packages/tui/src/shell/components/ProductBlock.tsx`
- Tool grouping：`packages/tui/src/shell/view-model.ts`
- Context usage progress：`packages/tui/src/context-window-runtime.ts`、`packages/tui/src/runtime-status-presenter.ts`、`packages/tui/src/shell/components/StatusFooter.tsx`

## 参考核对

实际读取的 Linghun 文档：

- `F:\Linghun\AUDIT_REMEDIATION_PLAN.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-audit-remediation-r1.md`

实际参考的本地 CCB / CCB Dev Boost / 社区项目文件：

- 本轮未复制或精读 CCB 源码；只按 `AUDIT_REMEDIATION_PLAN.md` 已裁决的 CCB 行为目标做 Linghun 自研实现。
- 社区依赖参考仅限公开 package API：`marked.lexer()` 与 `cli-highlight.highlight()`。
- 本轮进入 Linghun 自研实现的是 lexer token 到 Ink 的格式化、表格布局、diff 行色、spinner 行为、工具折叠阈值和 context progress 展示。
- 未复制 CCB 源码、内部 API、专有遥测或内部服务逻辑。

## 成品级结构化 handoff packet

- 下一阶段：等待用户确认是否进入 `AUDIT_REMEDIATION_PLAN.md` Phase R3。
- 禁止事项：不要自动进入 R3；不要把 R2 focused/local PASS 说成 Beta PASS / full smoke / open-source-ready；不要新增第二套 renderer/theme/tool panel。
- 证据引用：本文件“测试与验证”；源码入口见“开发者排查入口”。
- 验证结果：TUI typecheck PASS；focused vitest 349/349 PASS；TUI build PASS。
- 索引状态：本轮未使用外部 codebase-memory MCP；按用户要求使用 workflow scout + 源码精读 + focused validation。
- 权限模式：Auto Mode；本轮执行本地文件编辑、依赖安装结果沿用、focused tests/typecheck。
- 模型/provider：未调用 live provider；当前会话模型为 Claude Opus 4.6。
- 预算使用：无外部 provider 预算；本地 typecheck/vitest/build。
