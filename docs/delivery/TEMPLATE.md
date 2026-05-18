# Phase XX：阶段名称

## 目标

## 本阶段范围

## 已完成功能

## 使用方式

## 涉及模块

## 关键设计

## 配置项

## 命令

CLI 示例默认使用 `linghun`；如本阶段涉及启动入口，必须同时说明 Windows 下 `Linghun` 兼容结果。

## 测试与验证

每条验证必须写明命令、结果和失败/跳过原因。不得用“已验证”“verifier PASS”替代可复查命令。

## 性能结果

## 已知问题

已知问题只能描述当前阶段边界，不能把本阶段承诺的能力推迟到后续补丁。

## 不在本阶段处理

## 下一阶段衔接

## 开发者排查入口

## 状态栏与统计口径

- 默认状态栏只显示模型、模式、缓存、索引、agent/job 等可稳定读取的数据。
- 费用、成本、省钱估算只放 `/usage`、`/stats` 或详情页。
- 如果不是 provider/API 返回的真实账单字段，金额必须标记 `estimated`。

## 学习成本与渐进披露

- 如果本阶段新增用户可见能力，必须说明默认是否出现在首屏、`/help`、`/help all`、`/features` 和自然语言用途询问中。
- 新手模式可以隐藏高级危险入口，但不得让功能不可发现、不可诊断、不可关闭或只能靠记住命令使用。
- 默认输出应是推荐路径；完整能力、风险、doctor/debug 和高级配置必须有明确入口。

## TUI 渲染稳定性

- 如果本阶段新增用户可见 TUI 输出，必须说明是否会影响 messages、input、status、hints、background summary 分区。
- 长输出必须截断展示并保留完整日志路径或等价排查入口。
- 后台任务、agent、verification、compact 等系统事件不得污染输入区。
- Phase 07 起必须说明是否覆盖中文宽度、ANSI、resize、多行粘贴、长状态栏字段等渲染回归。

## 主输出与日志分层

- 主屏 `primary` 只展示短摘要、关键风险、确认选择、结果 verdict 和下一步。
- 证据摘要、影响文件、验证命令、日志路径进入 `details`。
- requestId、gateId、raw risk flags、schema 摘要、hash、provider raw usage、完整 stdout/stderr 等只能进入 `debug`、transcript、evidence、fullOutputPath 或 log。
- tool_result、EvidenceSummary、完整 handoff、完整 index 结果、完整 memory、完整 transcript 不得混入普通 assistant 主文本。
- 权限提示不得暴露内部字段名，例如 `risk=start_gate`、`readonly=no`、`permissionPipeline=false`。
- API key、token、Authorization header、cookie、私有 baseUrl 参数必须脱敏；doctor 只能显示 present/missing/source/masked preview。
- cache/index/status/hint 必须有行动价值且去重；同一 warning 不得每轮重复刷屏。

## 阶段 Verdict

- verdict：`PASS` / `FAIL` / `PARTIAL` / `CANCELLED`
- 是否允许进入下一阶段：yes/no
- P0/P1/P2 风险分类：
- 阻塞项：
- 用户下一步审核点或命令：

## 真实改动文件

- 代码：
- 测试：
- 文档：
- 生成物：
- 用户已有 diff / 非本轮证据：

## 运行时事实

- provider/model：
- permission mode：
- index status：
- cache/usage 来源：
- 配置来源：
- 是否有脱敏/密钥风险：

## 后台/复查任务状态反馈

- 如果本阶段新增长任务、verification、agent、compact 或后台执行，必须说明任务状态字段、heartbeat、日志路径和完成结果。
- 长任务启动后必须有用户可见摘要，运行中必须能回答“当前在干什么、做到哪一步、还要多久、日志在哪”。
- 输出尚未产生有效内容时必须明确说明，不得让用户误判为 PASS / FAIL。
- 完成后必须主动汇报 PASS / FAIL / PARTIAL / CANCELLED 或等价状态，并给出下一步建议。

## 语言与 i18n 口径

- 用户设置 `zh-CN` 时，用户可见文案应输出中文。
- 用户设置 `en-US` 时，用户可见文案应输出英文。
- Slash 命令、配置键和 transcript 结构化事件字段保持英文。
- Phase 07 起新增用户可见文案必须说明是否接入统一 i18n helper 或等价字典。

## 交接摘要

- 本阶段完成后必须写明成品级结构化 handoff packet 或等价交接摘要。
- handoff packet 必须包含下一阶段、禁止事项、证据引用、验证结果、索引状态、权限模式、模型/provider 和预算使用情况；缺失字段必须在风险中说明。
- 自动工作默认只推进一个阶段；是否进入下一阶段必须等待用户确认。
- 连续阶段模式默认关闭，只能由本地用户通过高级设置或显式本地命令单独 opt-in；即使开启，每个阶段之间仍必须生成独立交付文档、验证结果、handoff packet 和用户审核点。
