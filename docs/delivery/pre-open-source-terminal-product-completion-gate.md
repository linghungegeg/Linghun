# Pre-Open-Source Terminal Product Completion Gate

## 状态

- 阶段位置：Phase 15 pre-smoke 之后、真实全量实测之前。
- 性质：开源前终端候选产品完整度门禁。
- 当前状态：pending。
- 不是 Beta PASS，不是 smoke-ready PASS，不进入 Phase 18 桌面端。

## 背景

连续多轮 pre-smoke / pre-Beta 审计与修复证明：过早进入真实项目实测会把实测变成底座技术债探测器。用户已明确调整路线：真实环境全量实测可以后移，但实测对象必须是成熟的终端候选产品，而不是局部闭环后的半成品。

因此，A-C 的 `READY_FOR_USER_DECISION_TO_START_REAL_PROJECT_SMOKE` 只作为历史 evidence，不再作为当前直接 smoke 入口。当前必须先按蓝图和已完成审计报告推进终端产品完整度，再做真实全量实测。

## 当前唯一下一步

按阶段顺序完成终端产品完整度门禁，然后再由用户决定是否进入真实环境全量实测。

## 必须完成

| 分组 | 范围 | 说明 |
| --- | --- | --- |
| Phase 15.5A Performance & Context | Workspace Reference Cache / Virtual Workspace Cache、Compact、cache/status/index fast path | 先做真实性能收益项：缓存文件状态、索引状态、RuntimeStatus、工具/能力摘要、evidence/log 路径引用；失效基于 mtime/size/hash/config/tool schema/provider/index/compact/plugin 等稳定维度；默认有界；不得缓存完整源码、完整聊天、完整日志、密钥或大索引结果 |
| Phase 15.5B Resource & Task Lifecycle | Local Resource Guard、background task lifecycle、Verification / Review Runtime | 前台模型请求并发 1、后台任务 cap、重任务互斥、timeout/cancel/stale、Windows 进程树清理、长输出落盘、review scoped verdict；cancelled/timeout/stale 不得生成 PASS evidence |
| Phase 15.5C Editing & Tool UX | Write/Edit/MultiEdit CCB-grade UX、MCP Runtime、Bundled codebase-memory | read-before-edit、diff preview、stale file、changedFiles/patch 摘要；MCP discovery-before-execute、schema/trust/runtime doctor；codebase-memory 随包/受控安装、fast status、doctor、license/NOTICE |
| Phase 15.5D Connect Lite | MCP / Skills / Plugins Connect Lite | 显式 add/install、validate、enable/disable、remove/update、trust notice、doctor、来源/commit/权限记录、失败隔离、discovery-before-execute；支持本地路径、Git URL、GitHub 安装 skills/plugins；不做市场、评分推荐、云同步或自动更新 |
| Phase 15.5E Provider & Freshness | OpenAI-compatible + DeepSeek provider maturity、Freshness/Web Evidence | 第一版只要求 OpenAI-compatible + DeepSeek 成熟接入；其他 provider 标记 future / unsupported / experimental。实时外部事实必须能触发 Freshness/Web Evidence，未联网或失败标记 unknown/stale |
| Phase 15.5F Terminal Product Readiness | Terminal TUI polish、help/doctor/status/error/report gate、release readiness 的终端运行部分 | 只做终端候选产品所需成熟度：安装、CLI 入口、配置、doctor、密钥脱敏、debug bundle、升级/回滚基础诊断、文档同步；完整发布物料后置 |
| Phase 16 | 可控学习、memory / skill evolution | 默认不每轮学习、不自动接受长期记忆；候选来自 evidence/Todo/验证/handoff；可审计、可撤销、可关闭 |
| Phase 17A | Local durable jobs | 本地 job、handoff、预算、暂停、报告、状态可见、取消/超时/失败降级；默认不做无限自治 |
| Phase 17B | Remote channels 第一版 | 只做企业微信 / 飞书 / 钉钉 official_cli 或官方 webhook adapter；默认关闭；只发送脱敏摘要、审批和结果报告；必须有 doctor、幂等、过期、用户/设备绑定和脱敏审计 |
| Terminal release readiness | 安装、CLI 入口、配置、doctor、密钥脱敏、debug bundle、升级/回滚基础诊断、文档同步 | 只做终端运行与开源前候选产品所需边界；完整发布物料可后置 |

## 继续后置

- Phase 18 桌面端完整实现；本轮只保留 core/UI/API/IPC 复用预留。
- 开源发布物料、官网、宣传、商业化、账号系统。
- 插件市场、skill 市场、评分推荐、云同步、自动更新。
- 个人微信。
- 完整远程工作台。
- 多 provider 全矩阵商业级支持；第一版只要求 OpenAI-compatible + DeepSeek 成熟接入，其他 provider 标记 future / unsupported / experimental。

## 阶段规则

- 每个阶段做每个阶段的事，不再用真实项目实测替底座还债。
- Phase 00-14 done 不回写、不污染。
- 历史 A-C、D-H、focused/mock/local PASS 只作为 evidence，不作为 readiness proof。
- 任何 `DOC-ONLY` 不能冒充 runtime DONE。
- 任何单项 PASS 不能推断整体终端产品 ready。
- 真实全量实测前必须有综合验收记录。

## 验收要求

每个阶段或小阶段必须输出：

- 修改文件清单。
- 关键实现边界。
- focused tests。
- 必要的 check/typecheck/test/build。
- 未完成项与后置项。
- 是否还有 blocking P0/P1。

完整度门禁最终综合验收必须明确：

- 终端候选产品是否可以进入真实环境全量实测。
- 未进入 Phase 18 桌面端。
- 未宣布 Beta PASS。
- 未发布开源版本。
