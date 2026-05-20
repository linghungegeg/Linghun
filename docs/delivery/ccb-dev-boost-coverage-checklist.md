# CCB Dev Boost 对照清单复核

> 日期：2026-05-16  
> 范围：只读复核 Linghun Phase 00-10 已实现内容与 Phase 11-18 设计规划，对照 `F:\ccb-source\docs\ccb-optimizations.md` 中 CCB Dev Boost / CCB 加强能力。  
> 约束：本次只输出复核清单，不进入 Phase 11 开发，不实现任何功能。

## 读取与复核范围

本次复核已读取并遵守：

- `F:\Linghun\CLAUDE.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\docs\delivery\phase-09-cache-cost.md`
- `F:\Linghun\docs\delivery\phase-10-mcp-index.md`
- `F:\ccb-source\docs\ccb-optimizations.md`

本次还基于 3 个只读并行复核结果交叉确认：

- cache / cost / freshness / big-output 覆盖面
- MCP / codebase-memory / index / status / hint 覆盖面
- agent / workflow / memory / permission / job 覆盖面

## 总体结论

没有发现 CCB Dev Boost 关键能力在 Linghun 蓝图中完全漏掉。当前状态是：

- Phase 09 已落地 cache / cost / usage / stats / freshness / light hint 的最小闭环。
- Phase 10 已落地 MCP / codebase-memory / index evidence / MCP tool list 稳定摘要的最小闭环。
- Phase 11-14 已落地 session handoff、memory、agent、多模型与 Skills/Workflows/Hooks/本地 Plugin 主闭环；Phase 14 hardening 已补稳定性与安全边界，Phase 15-18 仍是后续设计覆盖真实项目对账、双模型交叉审查、长期任务和桌面端预留。
- 当前主要风险不是“规划遗漏”，而是后续实现时可能偷懒导致：复制完整历史、绕过 Start Gate/权限、过度宣传成本收益、或把大输出塞回上下文。

## 对照清单

| 能力项 | CCB Dev Boost 参考点 | Linghun 当前状态 | 对应阶段 | 证据文件或文档位置 | 风险或缺口 | 建议处理方式 |
|---|---|---|---|---|---|---|
| 1. 缓存命中保护 | 稳定 system prompt / tool schema / MCP tool list；状态栏低命中提示；减少 MCP 重连 cache bust | 已实现 | Phase 09 / 10；Phase 14 已覆盖插件/skill 稳定摘要 | `ccb-optimizations.md:29-66,259-309`；`phase-09-cache-cost.md:15-18,48-52,119-128`；`phase-10-mcp-index.md:17-20,112-120`；`phase-14-skills-workflow.md:43-47,260-264`；`LINGHUN_IMPLEMENTATION_SPEC.md:1294-1317` | Phase 09/10 是最小闭环；完整 MCP SDK 生命周期未实现；Phase 14 hardening 已补 enable/disable 后的 pluginListHash changedKeys 回归 | 保持；后续不把 GitHub 安装、插件市场、自动更新或长期任务混入 Phase 14 |
| 2. cache log / usage / stats | 最近 20 轮 cache history、`/cache-log`、usage 统计面板 | 已实现 | Phase 09 | `ccb-optimizations.md:422-473`；`phase-09-cache-cost.md:11-21,33-44,67-80,189-231`；`LINGHUN_IMPLEMENTATION_SPEC.md:1244-1342` | 默认是 REPL 进程内状态；真实账单 API 未接入；金额只能 estimated/unavailable | 保持；Phase 11 存储路径能力落地时把 cache history 纳入 `storage.cache` / `LINGHUN_DATA_DIR` |
| 3. break-cache 定位 | `getCacheBreakSummary()`、`/break-cache status` 输出破坏原因、cache read 前后变化、工具增删、diff 路径 | 部分覆盖 | Phase 09 / 10 | `ccb-optimizations.md:207-256`；`phase-09-cache-cost.md:30-40,221-224,270-279`；`phase-10-mcp-index.md:17-20,116-118`；`LINGHUN_IMPLEMENTATION_SPEC.md:1300-1312` | Linghun 当前更偏 freshness changedKeys 诊断；未证明已达到 CCB “last break 前后 token + diff 文件”同级体验 | 后续阶段实现；建议作为 Phase 09/15 前诊断增强，不混入 Phase 11 |
| 4. MCP 工具列表稳定化 | description 去时间戳/UUID/版本/hash；inputSchema key / required 排序；工具稳定排序 | 部分覆盖 / 已实现最小闭环 | Phase 10；Phase 14 延伸到插件贡献项 | `ccb-optimizations.md:259-309`；`phase-10-mcp-index.md:17-20,112-118,229-235`；`LINGHUN_IMPLEMENTATION_SPEC.md:1397-1408`；`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md:597-605` | Phase 10 稳定的是短摘要，不是完整 MCP SDK schema 稳定化；MCP 工具未全部作为 Linghun 外部工具执行层暴露 | 保持；完整 MCP SDK 生命周期可后续单独增强，不进入 Phase 11 |
| 5. codebase-memory 接入 | CCB 内置/推荐 codebase-memory-mcp；`index_repository / trace_path / query_graph / get_architecture / search_code / search_graph / detect_changes / index_status` | Phase 10 已实现外部 CLI 最小闭环；随包内置待开源前 hardening | Phase 10；Phase 15 Beta 前尾项或 Phase 15.5；Phase 11/17 消费索引状态 | `ccb-optimizations.md:108-128`；`phase-10-mcp-index.md:11-16,21-32,52-64,198-217`；`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:963-1013` | 当前依赖本机 `codebase-memory-mcp cli`，未随 Linghun 打包固定版本；未完成 binary path/version doctor、license/NOTICE、缺失/损坏 fallback 和一条命令安装验收；不是所有 deferred MCP tool 都作为 Linghun 内置工具暴露 | 不回填 Phase 10；新增 Bundled codebase-memory Lite 独立验收：固定随包版本、`/index status` fast path、`/index status --fresh`/`/index check` 慢检测、`/index doctor` binary/artifact/version、缺失/损坏降级、license/NOTICE |
| 6. 索引过期提醒 | CCB `indexHealth.ts`：变更率 >20% 且 >10 文件提示 stale；状态栏建议 `/index 刷新` | 已补 Phase 10 hardening | Phase 10；Phase 11/17 继续携带 indexStatus | `ccb-optimizations.md:312-352`；`phase-10-mcp-index.md:33-37,121,229-235`；`LINGHUN_IMPLEMENTATION_SPEC.md:1430-1448` | Phase 10 hardening 已优先调用 `codebase-memory-mcp cli detect_changes`，可用且发现变更时显示 stale / stale hint；不可用时降级。尚未实现完整 CCB 阈值算法。 | 保持为 Phase 10 hardening；完整阈值策略可后续独立增强，不混入 Phase 11 |
| 7. 大文件保护 / ignore 建议 | `largeFileScan.ts` + `safeIndexRepository()`；索引前扫描 >1MB JSON/SQL/XML/min.js/资源文件，建议 `.cbmignore` | 已补 Phase 10 hardening | Phase 10；Phase 15 真实项目验证 | `ccb-optimizations.md:355-419`；`phase-10-mcp-index.md:33-37,78-98,229-235,357-361`；`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:986-993,1007-1012`；`LINGHUN_IMPLEMENTATION_SPEC.md:1441-1447` | Phase 10 hardening 已在 `/index init fast` 和 `/index refresh` 前扫描未排除风险文件，默认阻止并支持 `--force`；ignore 规则不是完整 gitignore 引擎。 | 保持；Phase 15 用真实大仓库继续验证规则覆盖面 |
| 8. 自动验证增强 | verification agent 思路；改后最小验证；PASS/FAIL/PARTIAL；失败修复循环 | 已实现最小闭环 | Phase 08；Phase 12 verifier agent 继续增强 | `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:818-885`；`LINGHUN_IMPLEMENTATION_SPEC.md:990-1066`；`docs/delivery/phase-08-verification.md` | Phase 08 是本地 Verification Runner + `/review`，不是完整 Phase 12 Agent；多语言命令探测仍需后续增强 | 保持；Phase 12 增强独立 verifier agent |
| 9. 中文友好提示 | cache warning、设置面板、索引规则中文化 | 已实现并持续要求 | Phase 04 / 07 / 09 / 10；后续阶段持续 | `ccb-optimizations.md:55-66,191-204`；`LINGHUN_IMPLEMENTATION_SPEC.md:276-286,1817-1840`；`phase-09-cache-cost.md:304-309`；`phase-10-mcp-index.md:33-37,78-98` | 后续 Phase 11+ 新命令可能绕过 i18n helper | 保持；Phase 11 开始时继续要求新增文案走 i18n 或等价字典 |
| 10. 状态栏稳定 | cache/index 状态栏提示；消息重复渲染修复经验；短字段不撑爆 UI | 已实现基础 | Phase 04 / 07 / 09 / 10；Phase 12/17 继续扩展 | `ccb-optimizations.md:43-53,98-103,342-352`；`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:261-270,757-772`；`LINGHUN_IMPLEMENTATION_SPEC.md:450-489`；`phase-09-cache-cost.md:45-47,282-295`；`phase-10-mcp-index.md:119-121,219-227` | Phase 12 agent、Phase 17 job 会增加状态栏字段，有回归风险 | 保持；后续状态栏只放短字段，详情进 `/background`、`/usage`、`/stats` |
| 11. 新对话交接 | CCB JSONL；AI Sessions MCP 搜索历史会话，减少重复上下文 | 已设计待开发，已有基础铺垫 | Phase 02 / 10 已有基础；Phase 11 主实现 | `ccb-optimizations.md:174-188`；`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:1014-1094`；`LINGHUN_IMPLEMENTATION_SPEC.md:1449-1524`；`phase-10-mcp-index.md:29-32,235-241` | Phase 10 明确不实现完整 resume/handoff 自动总结 | 后续阶段实现；Phase 11 优先做 HandoffPacket、`/resume`、`/branch`、AI sessions 导入；禁止复制完整历史 |
| 12. 多智能体并行降本 | CCB Agent；并行只读工具；agent 输出摘要化 | 已设计待开发 | Phase 12；Phase 07/08 有后台状态底座 | `ccb-optimizations.md:69-85`；`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:1095-1143`；`LINGHUN_IMPLEMENTATION_SPEC.md:1525-1550` | Phase 00-10 未实现 explorer/worker/verifier/planner agent、agent cost、单 agent 取消 | 后续阶段实现；默认最多 3 个 agent，用户明确要求才多开 |
| 13. 多模型协作降本 | OpenCode 多模型；按角色使用 planner/executor/reviewer/verifier/vision/image | 已实现 Phase 13 最小闭环 | Phase 03 基础；Phase 13 主实现；Phase 15 真实 provider 对账 | `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:1144-1224`；`LINGHUN_IMPLEMENTATION_SPEC.md:549-719`；`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md:456-483`；`phase-13-multi-model.md` | Phase 13 已实现 role route、route doctor、role usage、vision/image 最小 evidence/metadata、结构化 handoff；未实现完整 provider adapter、真实 quota/balance 查询或账单对账 | 保持 Phase 13 口径：只宣称多模型角色路由最小闭环；完整 provider adapter 验收和真实项目对账放 Phase 15 |
| 14. 长期任务 / 定时任务 | CCB daemon/background sessions/job/cron/proactive/KAIROS/bridge 方向 | 已设计待开发，默认关闭 | Phase 17 | `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:1446-1548`；`LINGHUN_IMPLEMENTATION_SPEC.md:1551-1613` | Phase 00-10 无 job scheduler、cron、remote channels | 后续阶段实现；不处理当前阶段；必须校验 handoff，缺失则暂停 |
| 15. 插件 / skills / workflow / hooks | CCB Skills/workflow；Hermes Skills；OpenCode 插件化；hooks 管道 | Phase 14 主闭环与 hardening 已实现 | Phase 14；Phase 16 skill 固化 | `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:1225-1348`；`LINGHUN_IMPLEMENTATION_SPEC.md:1614-1815`；`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md:725-750`；`phase-14-skills-workflow.md` | 本地 skills/workflows/hooks doctor/plugin loader/启停/信任/权限边界已落地；hardening 已补 skill 解析失败诊断、hook timeout/outputLimit/logPath 边界、schema 兼容性和 workflow 结束检查；GitHub 安装、插件市场、自动更新、长期任务仍未实现 | 保持 Phase 14 hardening 完成口径；不把插件市场、GitHub 安装、自动更新或长期任务误写成已完成 |
| 16. 真实项目数据对账 | cache history + provider usage / 账单交叉验证；真实项目指标；CC Switch usage query 类额度查询思路 | 部分覆盖 | Phase 09 基础；Phase 15 主验证 | `ccb-optimizations.md:422-473,508-525`；`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:1349-1389`；`phase-09-cache-cost.md:9-56,242-249,282-287` | 有 `/usage`、`/stats`、export，但无真实 billing API/账单样本和 quota/balance query；不能宣传固定省钱比例 | Phase 15 实现；公开口径必须含 provider/model/endpoint/样本数/公式/是否账单核对；quota 来源必须标记 official_reported / oauth_reported / template_reported / custom_script / estimated / unknown |
| 17. 权限 / Plan / Start Gate | CCB 权限管道、Plan 模式；修复 Plan bypass；Start Gate 防止自动开工 | 权限/Plan 已实现；Start Gate 规则已覆盖，后续需贯穿 agent/workflow/job | Phase 06；Start Gate 横跨后续阶段 | `CLAUDE.md:14-15`；`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:338-363,669-729`；`LINGHUN_IMPLEMENTATION_SPEC.md:722-745,825-944`；`docs/delivery/phase-06-permissions-plan.md` | Start Gate 当前更多是规则/规格；后续执行型功能必须接入，不能只靠模型自觉 | 保持；Phase 12/14/17 启动 agent/workflow/job 时必须硬接 Start Gate |
| 18. 轻提示，不打断输入 | CCB cache/status/index 轻提示；不弹窗打断 | 已实现核心机制 | Phase 09；Phase 10/11 继续扩展 | `ccb-optimizations.md:43-66,342-352`；`phase-09-cache-cost.md:48-52,119-128,289-295`；`LINGHUN_IMPLEMENTATION_SPEC.md:1284-1315`；`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:936-938,1055-1056` | 提示覆盖面待扩：大文件、LINGHUN.md 缺失、高风险建议等仍需后续完善 | 保持；Phase 11 可只加 `LINGHUN.md` 缺失提示，不顺手扩全规则 |
| 19. 索引和记忆联动 | codebase-memory + ai-sessions 降低重复 Grep 和重复上下文 | 部分覆盖 / 已设计待开发 | Phase 09/10 铺垫；Phase 11 主实现；Phase 16/17 增强 | `phase-10-mcp-index.md:29-32,247-255,362-365`；`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:1047-1053,1059-1065,1536-1540`；`LINGHUN_IMPLEMENTATION_SPEC.md:1245-1276,1449-1523` | memoryHash 只是 freshness 维度；还不是 Memory Store / Handoff / Resume 闭环 | Phase 11 实现；新会话启动上下文包必须含 `LINGHUN.md`、handoff、Todo、验证、索引状态，禁止塞完整历史 |
| 20. 子 agent 上下文裁剪和结果压缩 | CCB Agent 成本控制；避免完整历史复制；agent 输出摘要回主线程 | 已设计待开发 | Phase 11 handoff；Phase 12 agent；Phase 13 多模型 | `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:1044-1053,1120-1134,1183-1186`；`LINGHUN_IMPLEMENTATION_SPEC.md:1513-1524,1547-1550,665-667` | Phase 00-10 还没有子 agent，因此未实际验证裁剪与压缩 | Phase 11 先固化 HandoffPacket；Phase 12 `/fork` 作为硬验收，禁止传完整 transcript |
| 21. cache freshness：system prompt / tool schema / MCP list / memory / compact / plugins hash | CCB 12 维缓存破坏诊断；system prompt、tool schema、model、tool 增删、betas、effort、cache control 等 | 已实现核心字段，部分真实源待后续 | Phase 09 / 10；Phase 11 memory；Phase 14 plugins | `ccb-optimizations.md:211-236,259-309`；`LINGHUN_IMPLEMENTATION_SPEC.md:1265-1276,1305-1311`；`phase-09-cache-cost.md:30-32,126`；`phase-10-mcp-index.md:17-20,116-118` | memory/plugin hash 字段已预留，但真实 Memory Store / Plugin List 尚未落地 | 保持；Phase 11/14 落地时只接稳定摘要，不塞完整 memory/plugin 内容 |
| 22. 大输出保护：不把完整索引、完整 rawUsage、大日志、大源码塞回上下文 | CCB 防止大日志、大索引、大文件拖垮系统；cache-log 面板只展示摘要 | 已实现基础，后续新模块需继承 | Phase 05 / 07 / 08 / 09 / 10；Phase 12/14/17 待继承 | `ccb-optimizations.md:355-419,422-473`；`LINGHUN_PHASED_DELIVERY_BLUEPRINT.md:642-654,769-770,873-875`；`LINGHUN_IMPLEMENTATION_SPEC.md:775-786,475-489,1028-1049`；`phase-10-mcp-index.md:27-28,118-120,237-244` | 当前覆盖内置工具、verification、index 摘要；agent/hook/job 大输出保护待对应阶段 | 保持；Phase 12/14/17 必须统一 `truncated/fullOutputPath/logPath` 语义，禁止裸 stdout 污染 UI |
| 22.5. CCB-grade 文件编辑体验 | CCB FileEdit/FileWrite/NotebookEdit 具备 read-before-edit、structured patch、diff/permission UI、拒绝反馈和 stale file 边界 | 已有 Write/Edit/MultiEdit 底座，编辑体验待开源前 hardening | Phase 15.5 | `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` Phase 15.5 editing UX hardening；`LINGHUN_IMPLEMENTATION_SPEC.md` Phase 15.5 TUI 验收 | 当前不能只因为工具存在就认为等于 CCB；diff preview、rejected edit、stale file、Windows/编码换行仍需验收 | Phase 15.5 执行；终端开源前必须通过 Write/Edit/MultiEdit read-before-edit、唯一匹配失败、diff 摘要、权限审批、拒绝/批准 continuation 和 Windows 路径测试 |
| 23. 开源前交叉审查 | CCB Dev Boost 能力落地后需要真实项目和多视角复核，避免缓存/索引/agent/多模型组合产生隐性回归 | 已设计待开发 | Phase 15.5 | `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` Phase 15.5；`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md` 开发路线；`docs/delivery/README.md` Phase 15.5 | Phase 15 前不会执行；如果 Phase 15 后直接进入 Phase 16，可能漏掉产品/架构/安全/Windows 兼容问题 | 保持；Phase 15 完成后用 GPT-5.5/Claude 做产品架构审查，DeepSeek V4 Pro 做代码安全审查，交叉复核后只修 P0/P1，P2 记录后续 |
| 24. 开源前发布就绪 | 安装、CLI 入口、配置、密钥、日志脱敏、doctor、升级回滚是个人开发者可用性的最后闸门 | 已设计待开发 | Phase 15.5 | `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` Phase 15.5；`LINGHUN_IMPLEMENTATION_SPEC.md` Release readiness；`LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md` 安装与配置 | 当前还未执行真实安装包、keychain、debug bundle、schema rollback 检查 | Phase 15.5 执行；必须检查 `linghun` / `Linghun`、`--help`、doctor、keychain/密钥脱敏、debug bundle 和文档同步 |
| 25. Remote Channels 安全闸门 | 远程审批/IM bridge 需要防止重放、误触发、泄露上下文和重复执行；飞书/Lark CLI、钉钉 CLI、企业微信 wecom-cli 可作为官方 CLI adapter 参考 | 已设计待开发，默认关闭 | Phase 17 | `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` Phase 17；`LINGHUN_IMPLEMENTATION_SPEC.md` Remote Channel | Phase 00-13 无 remote channel；后续如果只做消息推送而不做 nonce/签名/幂等/解绑/CLI doctor，会有安全风险 | Phase 17 执行；默认关闭，只发摘要/审批/报告，优先 official_cli adapter，必须校验用户/设备、过期时间、nonce/消息 id、签名或等价来源，并保留脱敏审计 |

## Phase 09 已落地能力

- 缓存命中率计算与保护基础。
- `/cache-log`、`/usage`、`/stats`、`/stats endpoints`。
- `/break-cache status` 的 freshness changedKeys 诊断。
- cache freshness 核心 hash 结构。
- 轻提示机制：本地规则、限频、去重、不打断输入。
- 状态栏 cache 短状态，不显示金额。
- 大输出保护：不 dump 完整 rawUsage、prompt、schema、大日志。

## Phase 10 已落地能力

- MCP server 最小管理与 `/mcp status`、`/mcp doctor`、`/mcp tools`。
- MCP tool list 稳定排序与短摘要。
- MCP tool list 进入 `mcpToolListHash`。
- codebase-memory 最小闭环：`/index status`、`/index init fast`、`/index refresh`、`/index search`、`/index architecture`。
- Phase 10 的 codebase-memory 是“本机 CLI/MCP 最小闭环”，不是“Linghun 已内置索引器”；随包内置、固定版本、免安装体验、license/NOTICE 和 binary doctor 属于 Bundled codebase-memory Lite，必须在 Phase 15 Beta 前尾项或 Phase 15.5 开源前 hardening 独立验收。
- index 查询 evidence 写入 transcript。
- 索引结果短摘要，不 dump 完整 graph / 大源码。
- `.linghunignore` / `.cbmignore` 建议与大文件风险提示。
- 状态栏 index 短状态。

## Phase 11-18 当前状态

- Phase 11：已实现新对话交接、`HandoffPacket`、`/resume`、`/branch`、AI sessions 导入、记忆与索引联动、可配置存储路径最小闭环。
- Phase 12：已实现多 agent、`/fork`、agent 成本统计、agent 输出摘要、子 agent 上下文裁剪最小闭环。
- Phase 13：已实现多模型角色路由、role route doctor、role usage、vision/image 最小 evidence/metadata 和角色间结构化 handoff；完整 provider adapter 验收和真实 quota/balance 对账不在 Phase 13。
- Phase 14：主闭环已实现 Skills、Workflows、Hooks doctor、本地 Plugin loader / doctor / 启停 / 信任 / 权限接入；Phase 14 hardening 已补 skill 解析失败诊断、hook timeout/outputLimit/logPath 边界、schema 兼容性、cache changedKeys 回归和 workflow 结束检查；插件市场、GitHub 安装、自动更新、长期任务和 Phase 15+ 能力仍未实现。
- Phase 15：待实现真实项目测试与 provider usage / 账单抽样对账。
- Phase 15.5：待实现双模型交叉审查、release readiness / open-source readiness 与开源前 hardening。
- Phase 16：待实现可控学习、候选 memory / skill、审查与回滚。
- Phase 17：待实现长期任务、定时任务、自动会话、remote channels 安全闸门、预算停止。
- Phase 18：待实现桌面端预留验证。

## 需要特别防漏的能力

没有发现“蓝图完全漏掉”的 CCB Dev Boost 关键能力，但以下 4 项当前只能算“部分覆盖 / 最小闭环”：

1. **break-cache 定位深度**  
   Linghun 已有 freshness changedKeys，但 CCB 的 last-break 前后 cache read、工具增删、diff 路径更具体。建议后续补强，不混入 Phase 11。

2. **索引过期自动检测**  
   Linghun 已有 index status 与 refresh 建议，但未充分证明已实现 CCB 阈值式文件变更 stale 检测。建议补到规格书验收或作为 Phase 10 修补任务。

3. **大文件索引前安全门**  
   Linghun 已有 ignore 建议和风险提示，但未充分证明已实现“索引前扫描 + 未排除时确认/阻止默认索引”。建议后续单独补强，不进入 Phase 11。

4. **真实账单对账**  
   Linghun 已有 `/usage`、`/stats`、export 与保守口径，但真实项目账单抽样对账是 Phase 15。当前不能宣传固定省钱比例或通用 98% 命中。

## 不建议做的内容

为避免过度复杂化，当前不建议：

- 不建议 Phase 11 顺手做完整 MCP SDK 生命周期管理。
- 不建议 Phase 11 顺手补完整 Agent / Multi-model / Plugin / Hook。
- 不建议把完整历史、完整索引、完整 rawUsage、完整日志、大源码塞入新会话上下文。
- 不建议状态栏显示金额、账单、长 index 结果或长 agent 状态。
- 不建议为追求 CCB 对齐而复制 CCB 可疑源码、内部 API 或专有实现。
- 不建议提前做大型插件市场、远程自动控制、无审批自治写代码。
- 不建议在没有真实 provider usage / 账单抽样前宣传固定省钱倍数或任意模型固定高命中率。
