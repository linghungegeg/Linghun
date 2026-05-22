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
| Phase 15.5C+ Log Artifact Runtime Lite | 长输出 artifact 切片、错误候选提取 | TS/Node 轻量实现；让 Bash、verification、background output 从“只有路径”升级为可 bounded tail / grep / errors 的只读 artifact；不做 native/binary、数据库、后台索引、root cause 判定或 PASS 改写 |
| Phase 15.5C++ Workspace Snapshot Lite | 工作区文件状态轻量快照 | TS/Node 轻量实现；共享 bounded 文件 stat/hash/ignore/目录摘要给 Project Doctor、Context Picker、Architecture Runtime 和后续 agent/job；不替代 codebase-memory，不做自研索引引擎、LSP、全仓 watcher 或 native/binary |
| Phase 15.5D Connect Lite | MCP / Skills / Plugins Connect Lite | 显式 add/install、validate、enable/disable、remove/update、trust notice、doctor、来源/commit/权限记录、失败隔离、discovery-before-execute；支持本地路径、Git URL、GitHub 安装 skills/plugins；不做市场、评分推荐、云同步或自动更新 |
| Phase 15.5E Provider & Freshness | OpenAI-compatible + DeepSeek provider maturity、Freshness/Web Evidence | 第一版只要求 OpenAI-compatible + DeepSeek 成熟接入；其他 provider 标记 future / unsupported / experimental。实时外部事实必须能触发 Freshness/Web Evidence，未联网或失败标记 unknown/stale |
| Phase 15.5F Terminal Product Readiness | Terminal TUI polish、help/doctor/status/error/report gate、CCB-grade standard output、release readiness 的终端运行部分 | 只做终端候选产品所需成熟度：安装、CLI 入口、配置、doctor、密钥脱敏、debug bundle、升级/回滚基础诊断、文档同步；补齐 Project Doctor Lite、Context Picker Lite、Source-of-Truth Drift Linter Lite、Rollback Coach、Task Cost Preview Lite、Problems panel Lite 和用户可见标准输出；完整发布物料后置 |
| Phase 16 | 可控学习、memory / skill evolution | 默认不每轮学习、不自动接受长期记忆；候选来自 evidence/Todo/验证/handoff；可审计、可撤销、可关闭 |
| Phase 17A | Local durable jobs + Virtual Agent Concurrency | 本地 job、handoff、预算、暂停、报告、状态可见、取消/超时/失败降级；补齐低资源多 agent 调度成熟度：用户可发起多个 agent / job，但 runtime 必须用共享索引/cache/evidence、短摘要传递、懒加载上下文、前台模型请求 cap、工具/重任务 cap、sleeping/blocked/running 状态和 stale recovery 控制真实并发；默认不做无限自治 |
| Phase 17B | Remote channels 第一版 | 只做企业微信 / 飞书 / 钉钉 official_cli 或官方 webhook adapter；默认关闭；只发送脱敏摘要、审批和结果报告；必须有 doctor、幂等、过期、用户/设备绑定和脱敏审计 |
| Terminal release readiness | 安装、CLI 入口、配置、doctor、密钥脱敏、debug bundle、升级/回滚基础诊断、文档同步 | 只做终端运行与开源前候选产品所需边界；完整发布物料可后置 |

## 继续后置

- Phase 18 桌面端完整实现；本轮只保留 core/UI/API/IPC 复用预留。
- 开源发布物料、官网、宣传、商业化、账号系统。
- 插件市场、skill 市场、评分推荐、云同步、自动更新。
- 个人微信。
- 完整远程工作台。
- 多 provider 全矩阵商业级支持；第一版只要求 OpenAI-compatible + DeepSeek 成熟接入，其他 provider 标记 future / unsupported / experimental。
- Sandbox profile / 容器化执行环境管理；第一版只要求本地权限、路径边界、服务器同步提醒和 doctor 说明，不做跨环境 sandbox 平台。
- Recipe / Runbook 平台；第一版由 Architecture Runtime、Natural Command Bridge 和现有 workflow/help 承接，不新增模板市场或复杂 runbook runtime。

## 阶段规则

- 每个阶段做每个阶段的事，不再用真实项目实测替底座还债。
- Phase 15.5B 只做资源与任务生命周期地基：前台请求守门、后台任务 cap、重任务互斥、取消/超时/stale、输出落盘和非 PASS 边界；不得提前实现第二套 agent/job runtime。
- Phase 17A 才承接 Virtual Agent Concurrency：多 agent 可以对用户表现为并行，但底层必须按资源预算和证据边界调度，不能让每个 agent 复制完整上下文、重复扫全仓、并发跑重任务或把本机拖卡。
- Phase 00-14 done 不回写、不污染。
- 历史 A-C、D-H、focused/mock/local PASS 只作为 evidence，不作为 readiness proof。
- 任何 `DOC-ONLY` 不能冒充 runtime DONE。
- 任何单项 PASS 不能推断整体终端产品 ready。
- 真实全量实测前必须有综合验收记录。
- 用户可见主屏必须 summary-first、human-first、action-first：只说发生了什么、影响范围、用户选择、验证状态、下一步和详情路径。
- 完整日志、完整聊天、完整索引、完整报告、raw tool_result、raw evidence、raw flags、gateId 和内部审计/架构字段不得进入普通主屏；需要时进入 details/debug/report。
- 反幻觉、架构、Source-Level Reality Check、Evidence、risk flag 等底层机制默认回归底层；普通用户只看到成熟的人话摘要和可执行下一步。

## 阶段开工硬门槛

每个实现阶段开工前必须先完成 Source-Level Reality Check，不允许只按文档或审计报告直接实现：

- 先读取本文件、`START_NEXT_CHAT.md`、`docs/audit/reference-map.md`、蓝图、规格书和本阶段相关交付/审计报告。
- 优先使用 codebase-memory 索引定位现有实现；Linghun 仓库索引项目名为 `F-Linghun`。索引缺失或过期时先降级为 `rg` / 文件读取，并在报告里标记。
- 必须输出 existing implementation / gaps / minimal touch points / forbidden duplicate systems。
- 若现有 runtime 已有基础能力，优先复用和补齐，不得新造第二套系统。
- 若源码事实与文档设计冲突，以源码事实、最小修正文档口径和用户确认后的阶段边界为准。
- 必须把 `reference-map.md`、历史 reconciliation 的 pull-forward / keep-deferred、baseline 第 12/13 节中与本阶段相关的小细节复制进阶段 scope，并逐项裁决 DONE / DEFERRED / NOT-DO。
- 发现本阶段应补的成熟度遗漏时，优先在本阶段以最小 runtime 修复补齐；若超出阶段边界，必须明确登记到后续阶段，不得依赖聊天记忆或最后审计兜底。

## 验收要求

每个阶段或小阶段必须输出：

- 修改文件清单。
- 关键实现边界。
- Source-Level Reality Check 摘要。
- 参考源 delta catch-up 裁决。
- focused tests。
- 必要的 check/typecheck/test/build。
- 未完成项与后置项。
- 是否还有 blocking P0/P1。

完整度门禁最终综合验收必须明确：

- 终端候选产品是否可以进入真实环境全量实测。
- 未进入 Phase 18 桌面端。
- 未宣布 Beta PASS。
- 未发布开源版本。
