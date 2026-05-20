# Phase ownership / release-gate audit

日期：2026-05-21 01:35 +08:00

范围：只读文档审计；不改代码；不改 active docs 口径；不进入 Phase 15.5 / Phase 16+；不宣布 Phase 15 Beta PASS。

## Executive verdict

**NEEDS_DOC_FIX**

当前 active docs 的阶段边界总体已经收敛：Phase 10 不再误称 bundled codebase-memory 已完成；Compact Lite 已明确不属于 Phase 11；Phase 14 没有把 GitHub/community install、plugin marketplace、自动更新误写成主闭环 DONE；Phase 16/17/18 也基本只承接各自新增能力。

但仍有文档口径需要修正：2026-05-21 的 focused/mock/local verification guard 已经通过，但 `docs/delivery/README.md` 和 `START_NEXT_CHAT.md` 仍容易让后续会话把 2026-05-20 reconciliation 的 `READY_TO_FIX` 当成最新执行状态；同时，Phase 15.5 摘要未充分显式列出 MCP / Skills / Plugins Connect Lite，且 “P2 记录后续” 与 “terminal-scope P2 开源前清零” 之间需要更硬的区分。

本报告不构成 Beta readiness PASS。当前更准确的口径是：

```text
Phase 15 focused/mock/local verification guard: PASS
Phase 15 Beta readiness: PARTIAL / BLOCKED pending real provider + real project smoke
Phase 15.5: pending
Open-source terminal release: terminal-scope P0/P1/P2 must be cleared, NOT-DO, or proven out-of-scope
```

## 读取范围

本轮按要求读取：

- `F:\Linghun\START_NEXT_CHAT.md`
- `F:\Linghun\docs\delivery\README.md`
- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\ccb-dev-boost-coverage-checklist.md`
- `F:\Linghun\docs\delivery\phase-10-mcp-index.md`
- `F:\Linghun\docs\audit\phase-15-ccb-grade-default-runtime-reconciliation.md`
- `F:\Linghun\docs\audit\phase-15-pre-beta-verification-guard-and-index-runtime-smoke.md`

可选文件检查结果：

- `F:\Linghun\docs\audit\phase-15-bundled-codebase-memory-lite.md`：不存在。

## Findings table

| id | file | evidence | risk | current wrong phase | recommended phase | blocks Beta? | blocks open-source release? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | `docs/delivery/phase-10-mcp-index.md`; `docs/delivery/README.md`; `START_NEXT_CHAT.md` | Phase 10 已明确只是 external CLI / MCP 最小闭环，不代表 bundled、固定版本、免安装或 license/NOTICE 收口。 | 低。当前没有发现 Phase 10 仍误写 bundled codebase-memory DONE。 | 无明显错误。 | Bundled codebase-memory Lite 继续归 Phase 15.5，或作为 Phase 15 Beta 前尾项单独验收。 | 条件阻塞：若 Beta smoke 要求免安装索引器。 | 是。 |
| F-02 | `LINGHUN_IMPLEMENTATION_SPEC.md`; `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` | Compact Lite 明确写为 Phase 15.5 开源前 hardening，复用 Phase 11 handoff/evidence 底座但不回写 Phase 11。 | 低。未发现 Phase 11 错误承载 Compact Lite。 | 无明显错误。 | Phase 15.5。 | 否。 | 是。 |
| F-03 | `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`; `LINGHUN_IMPLEMENTATION_SPEC.md`; `ccb-dev-boost-coverage-checklist.md` | Phase 14 主闭环只做本地 loader/doctor/启停/信任/权限；GitHub/community install、生命周期、Connect Lite 放 Phase 15.5；marketplace/auto-update 明确 not-do。 | 低。未发现 Phase 14 错误承载 marketplace/auto-update。 | 无明显错误。 | Connect Lite 属 Phase 15.5；marketplace/auto-update 仍 NOT-DO。 | 否。 | Connect Lite 是。 |
| F-04 | `docs/delivery/README.md`; `START_NEXT_CHAT.md`; `docs/audit/phase-15-pre-beta-verification-guard-and-index-runtime-smoke.md` | 2026-05-21 报告已写明 Batch 3 focused/mock/local verification guard PASS，但 real-project Beta decision 仍未自动通过；README 仍突出 2026-05-20 reconciliation 为“最新执行裁决：下一步 READY_TO_FIX”。 | 中。后续会话可能重复执行已通过的 focused guard，或误判最新状态。 | Phase 15 pre-Beta 状态口径滞后。 | 更新为“2026-05-21 focused/mock/local guard PASS；真实 provider / 真实项目 readiness 仍未 PASS”。 | 是，属于 release gate 口径阻塞。 | 间接阻塞。 |
| F-05 | `docs/delivery/README.md`; `START_NEXT_CHAT.md`; `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`; `LINGHUN_IMPLEMENTATION_SPEC.md` | Blueprint/spec 已列 Phase 15.5 必须拆出 MCP / Skills / Plugins Connect Lite；README/START 的 Phase 15.5 摘要没有同等显式。 | 中。Phase 15.5 接手时可能漏掉 Connect Lite。 | Phase 15.5 active summary 不完整。 | Phase 15.5。 | 否。 | 是。 |
| F-06 | `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`; `START_NEXT_CHAT.md`; `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md` | 同时存在“P2 记录到后续，不阻塞 Phase 16”和“terminal-scope P0/P1/P2 必须开源前清零、NOT-DO 或证明 out-of-scope”。 | 中。若不区分 terminal-scope / non-terminal-scope，可能违反终端开源前清零要求。 | Phase 15.5 release gate 口径需收紧。 | 非 terminal-scope P2 可后续；terminal-scope P2 开源前必须清零、NOT-DO 或证明不属于终端发布范围。 | 通常不阻塞 Beta。 | 是。 |
| F-07 | `docs/audit/phase-15-pre-beta-verification-guard-and-index-runtime-smoke.md`; `docs/delivery/README.md`; `START_NEXT_CHAT.md` | 2026-05-21 报告明确 `SKIPPED` real provider live smoke，focused/mock/local PASS 不等于 Beta readiness PASS。 | 中。active docs 必须同步引用，避免历史 closure/PASS 污染 readiness。 | 无 runtime DONE 误判，但 active docs 需要同步。 | Phase 15 real-project Beta decision gate。 | 是。 | 间接阻塞。 |
| F-08 | `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`; `LINGHUN_IMPLEMENTATION_SPEC.md` | `DOC-ONLY` 不能冒充 runtime DONE 的规则已明确写入。 | 低。未发现本轮必读 active docs 把 DOC-ONLY 当实现 DONE。 | 无明显错误。 | 保持。 | 否。 | 否。 |

## Pull-forward list

以下内容不能推到 Phase 15.5；如果仍未被真实 provider / 真实项目 smoke 证明，应继续作为 Phase 15 Beta 前 gate：

- 普通输入必须进入 model/provider/tool loop，不被 NCB / catalog 抢答。
- report-generation 必须走 `Write/Edit -> permission -> tool_result -> continuation -> final answer`，不能靠 Bash 重定向或 prompt-only。
- pending approval 的 allow / deny / cancel / error / timeout / abort continuation。
- Read / Glob / Grep / Bash primary summary-first 回归门。
- provider profile / endpointProfile / reasoning effective 状态可诊断。
- 真实 provider / 真实项目 smoke 的 readiness 级验证；focused/mock/local/scoped PASS 不够。

## Keep-deferred list

以下内容可继续留在 Phase 15.5 或后续阶段，不应回流 Phase 15 Beta 前扩大范围，除非真实 Beta 再次证明它们直接污染默认编码链路：

- Bundled codebase-memory Lite。
- Compact Lite。
- Write / Edit / MultiEdit CCB-grade editing UX 的开源前 hardening。
- Provider maturity 深水区：quota / balance / native / gateway matrix / fallback audit。
- Freshness / web evidence runtime；除非 Beta 任务要求 current/latest 外部事实。
- MCP / Skills / Plugins Connect Lite。
- Release readiness / open-source readiness。
- Phase 16 学习闭环。
- Phase 17 durable jobs / remote channels。
- Phase 18 desktop shell / API / IPC。

## Required doc fixes

1. 更新 `docs/delivery/README.md` 和 `START_NEXT_CHAT.md`：把 2026-05-21 verification guard 写成当前最新 Phase 15 Batch 3 状态，同时保留“Beta readiness 仍未 PASS”。
2. 在 Phase 15.5 active summary 中显式补上 **MCP / Skills / Plugins Connect Lite**。
3. 修正 “P2 记录后续” 口径：明确非 terminal-scope P2 可登记后续；terminal-scope P2 开源前不得遗留。
4. 给历史 audit 增加或强化 supersede / closure 说明：2026-05-20 reconciliation 的 READY_TO_FIX 已被 2026-05-21 focused verification 部分推进，但 real-provider / readiness gate 未关闭。
5. 明确 `docs/audit/phase-15-bundled-codebase-memory-lite.md` 尚不存在，不应被后续会话当作已完成报告。

## Required runtime fixes

本轮是文档只读审计，没有确认新的具体 runtime bug。

但如果要进入 `READY_FOR_BETA_SMOKE`，仍需要补足真实 provider / 真实项目 readiness 级验证；如果该 smoke 失败，失败项必须作为 Phase 15 runtime fix 处理，不能推到 Phase 15.5。

## Not-do list

- 不宣布 Phase 15 Beta PASS。
- 不进入 Phase 15.5 / Phase 16 / Phase 17 / Phase 18。
- 不新增阶段。
- 不做大重构或 registry 大改。
- 不把 plugin marketplace、技能市场、自动更新、自研索引引擎塞进当前范围。
- 不把 focused/mock/local/scoped PASS 写成 readiness PASS。
- 不把 DOC-ONLY 写成 runtime DONE。

## Final recommendation

先做小范围 doc sync，再决定是否进入真实 Beta smoke。

建议同步后的主口径：

```text
Phase 15 focused/mock/local verification guard PASS.
Phase 15 Beta readiness remains PARTIAL/BLOCKED pending real provider + real project smoke.
Phase 15.5 remains pending and must include Connect Lite, Bundled codebase-memory Lite, Compact Lite, provider maturity, Freshness/web evidence, release readiness, editing UX hardening, and terminal-scope P2 zeroing before open-source terminal release.
```

