# Linghun 参考源总表

> 目的：给后续阶段提供明确参考源，避免闭门造轮子，也避免复制 CCB / OpenCode / Hermes / 其他项目的可疑源码或内部实现。

## 使用原则

- 只参考公开行为、交互边界、架构取舍、验收标准和失败降级思路。
- 不复制 CCB、OpenCode、Hermes、oh-my-openagent、CC Switch 或任何第三方项目的源码实现、内部 API、反编译产物、专有遥测和私有配置。
- 如果参考源是本地仓库，默认只读；需要引用时只描述行为和边界，不粘贴大段源码。
- 如果参考源是联网地址，执行阶段必须按需联网核验最新公开文档或仓库状态，不能虚造。
- 每个阶段的交付文档必须说明实际参考了哪些来源、参考了什么、没有复制什么。

## 总表

| 参考源 | 公开地址 / 本地路径 | 可参考内容 | 禁止事项 | 对应阶段 |
| --- | --- | --- | --- | --- |
| CCB / Claude Code Best | 本地：`F:\ccb-source`；公开来源以用户提供或当次联网核验为准；公开参考：`https://github.com/claude-code-best/claude-code/releases/tag/v2.4.3` | TUI 编码体验、工具闭环、权限审批、Plan 模式、Agent 生命周期、MCP 接入、缓存组织、状态栏交互、轻提示；v2.4.3 可参考 discovery-before-execute 工具 guard：未先搜索/发现延迟工具和 schema 时，执行层拒绝直接调用 | 复制反编译源码、内部 API、专有实现、遥测、私有协议、照搬补丁代码 | Phase 04-08、12、15 preflight/hardening、15 Beta、15.5 |
| CCB Dev Boost | 本地：`F:\ccb-source\docs\ccb-optimizations.md`；对照：`F:\Linghun\docs\delivery\ccb-dev-boost-coverage-checklist.md` | cache-first、prefix stable、break-cache、MCP tool list 稳定化、codebase-memory 索引、usage/stats、中文提示、真实账单对账思路 | 宣传固定 98% / 25x，复制实现，把 provider 字段误说成零成本 | Phase 09-10、15 |
| Phase 15 interaction review | `F:\Linghun\docs\audit\PHASE_15_PREFLIGHT_INTERACTION_REVIEW_REPORT.md` | Natural Command Bridge、Catalog/dispatch 漂移、参数提取、Start Gate、bypass/auto/Plan、权限提权交互、OpenCode 输出边界 | 把报告当成已实现代码；把 Phase 15.5 或 Phase 16 功能塞进 preflight hardening | Phase 15 preflight hardening |
| OpenCode | 公开：`https://github.com/opencode-ai/opencode`；本地：`F:\freecodex\opencode-source` | 多模型开放、provider 抽象、LSP/插件化方向、TUI/output 组织、pending 状态可见、summary-first 输出 | 照搬执行层、复制源码、牺牲 CCB 风格编码手感 | Phase 13、14、15 preflight/hardening、18 |
| Hermes Agent | 公开 Hermes Agent / memory / skills 方向，当次执行需联网核验具体公开来源 | MEMORY / USER 分层、Skills 沉淀、越用越聪明的可审计记忆方向 | 后台自主演练提前实现、自动写长期记忆、把完整记忆塞进 prompt | Phase 11、14、16 |
| codebase-memory-mcp | 工具命令：`codebase-memory-mcp`；本地索引项目名按 `/index status`；公开来源当次执行需核验 | 代码图索引、架构查询、搜索代码、detect_changes stale 检测 | 自动全量刷新、大文件无安全门、MCP 崩溃拖垮主程序 | Phase 10、11、15、17 |
| AI Sessions MCP | 公开 AI sessions / cross-tool session 方向，当次执行需联网核验具体公开来源 | 跨 Claude / Codex 会话摘要导入、会话迁移、继续工作 | 复制完整历史聊天、无证据恢复、把所有会话塞进 prompt | Phase 11、17 |
| MCP 官方生态 | 公开 MCP SDK / spec / server 文档，当次执行需联网核验最新版本 | server/tool/resource 生命周期、schema、工具发现、失败降级 | 把完整大 schema 塞进 prompt、未信任 server 自动执行工具 | Phase 10、14、17 |
| CC Switch | 公开 CC Switch usage / quota query 行为，当次执行需联网核验具体公开来源 | provider usage、quota/balance 查询、官方订阅与第三方中转站区分、查询来源标记 | 把本地估算伪装成真实余额、混合 token/credits/requests/金额单位 | Phase 13、15、15.5 |
| oh-my-openagent | 公开项目，当次执行需联网核验具体公开来源 | team mode、角色路由、skills/hooks/lifecycle、后台状态表、结构化报告 | 提前实现长期自治、绕过权限、复制实现 | Phase 12-14、17 |
| Feishu / Lark CLI | 官方或官方团队开源 CLI；具体地址当次执行需联网核验 | official_cli adapter、登录状态诊断、JSON 输出、远程审批/通知边界 | 自研完整 IM SDK、发送完整 transcript/memory/API key/账单/源码 | Phase 17 |
| DingTalk CLI | 官方或官方团队开源 CLI；具体地址当次执行需联网核验 | official_cli adapter、审批/通知、doctor 诊断 | 自研完整 IM SDK、绕过绑定用户/设备/nonce/签名校验 | Phase 17 |
| WeCom / 企业微信 CLI | 官方或官方团队开源 CLI；具体地址当次执行需联网核验 | official_cli adapter、企业消息/审批、失败降级 | 暴露完整上下文、无审计日志、重复消息导致重复执行 | Phase 17 |
| OpenHands | 公开：`https://github.com/All-Hands-AI/OpenHands` | core/UI 分离、SDK/CLI/GUI 分层、后续桌面端/服务端预留 | 提前做云端/企业版、扩大阶段范围 | Phase 18 |
| Aider | 公开：`https://github.com/Aider-AI/aider` | 小而稳的终端 pair programming、Git 工作流、精准编辑体验 | 放弃 Linghun 的权限/索引/缓存/多模型架构 | Phase 05、08、15 |
| Reasonix 类缓存方案 | 公开思想或用户提供资料；当次执行需联网核验 | cache-first、prefix stable、break-cache、静态上下文稳定 | 接入未确认模型专属黑盒、宣传固定收益 | Phase 09、15 |
| Ink | 公开：`https://github.com/vadimdemedes/ink` | TUI 组件与渲染模型 | 让 UI 细节污染 core 引擎 | Phase 04、07、18 |
| Tauri | 公开：`https://tauri.app/` | 桌面端包装、IPC/API 边界、安全模型 | 提前做桌面端导致 TUI core 不稳 | Phase 18 |

## 阶段使用要求

| 阶段 | 必查参考 |
| --- | --- |
| Phase 15 preflight hardening | CCB / Claude Code Best、Phase 15 interaction review、OpenCode、CCB Dev Boost |
| Phase 15 真实项目 Beta | CCB / Claude Code Best、CCB Dev Boost、CC Switch、Aider、codebase-memory-mcp |
| Phase 15.5 | Phase 15 交付文档、双模型审查报告、release readiness、OpenCode 输出边界、CCB 权限/Plan 边界、CCB v2.4.3 discovery-before-execute 工具 guard |
| Phase 16 | Hermes Agent、LINGHUN.md / memory 规格、CCB/CCB Dev Boost 的 summary-first 和 cache freshness 边界 |
| Phase 17 | CCB daemon/job/agent 方向、oh-my-openagent、Feishu/Lark CLI、DingTalk CLI、WeCom CLI、Remote Channels 安全规格 |
| Phase 18 | OpenCode、OpenHands、Ink、Tauri、Linghun core/UI 分离设计 |

## 执行提示

后续阶段开工提示词应包含：

```text
开始前先读取 F:\Linghun\docs\audit\reference-map.md。
只参考表中公开行为、交互边界和验收标准；不得复制任何第三方源码或内部实现。
如果本阶段需要联网核验公开地址，请按需联网，不要虚造。
```
