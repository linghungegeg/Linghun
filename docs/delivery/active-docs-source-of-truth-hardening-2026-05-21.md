# Active Docs Source-of-Truth Hardening 收口记录（2026-05-21）

> 本文件只记录本轮活跃文档 source-of-truth 收口改动，不是新的执行入口，不替代 `START_NEXT_CHAT.md`、`docs/delivery/README.md`、蓝图、规格书或路线图。

## 修改的活跃文档

- `README.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/README.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `docs/audit/reference-map.md`
- `docs/delivery/active-docs-source-of-truth-hardening-2026-05-21.md`

未修改运行时代码；未修改 `packages/tui/src/index.ts`、`packages/tui/src/index.test.ts`、`docs/audit/phase-15-bundled-codebase-memory-lite.md`、`docs/delivery/phase-10-mcp-index.md`。

## 当前唯一下一步

完成 Batch 3.5 收尾后，先完成 Active Docs Source-of-Truth Hardening，再进入真实项目 smoke。

不得自动进入 Phase 15 Beta、Phase 15.5、Phase 16+；不得宣布 Beta PASS。

## Phase 00-14 回写污染检查结果

只做只读污染检查，不重新审计旧阶段实现：

| 检查项 | 结果 |
| --- | --- |
| Batch 3.5 / Bundled codebase-memory Lite 是否被写回 Phase 10 done | 未发现被写成 Phase 10 done；Phase 10 done 仍只代表外部 CLI/MCP 最小闭环，随包/固定版本/免安装/NOTICE 等归属 Batch 3.5 或 Phase 15.5/open-source hardening。 |
| Compact Lite 是否被写回 Phase 11 done | 未发现被写成 Phase 11 done；Compact Lite 仍归属 Phase 15.5 开源前 hardening。 |
| MCP / Skills / Plugins Connect Lite 是否被写回 Phase 14 done | 未发现被写成 Phase 14 done；Phase 14 done 仍是本地 loader/doctor/启停/信任/权限底座，Connect Lite 归属 Phase 15.5。 |
| Verification / Review Runtime Lite 是否被写回旧阶段 done | 未发现被写成旧阶段 done；仍归属 Phase 15.5。 |
| provider maturity 是否被写回旧阶段 done | 未发现被写成旧阶段 done；Phase 13 done 只代表多模型协作闭环，provider maturity 归属 Phase 15.5。 |
| Freshness/web evidence 是否被写回旧阶段 done | 未发现被写成旧阶段 done；缓存 Freshness 是 Phase 09/10 诊断概念，Web Evidence / Freshness Gate 成熟度归属 Phase 15.5。 |
| Write/Edit/MultiEdit CCB-grade editing UX 是否被写回旧阶段 done | 未发现被写成 Phase 05 done；Phase 05 done 只代表核心工具底座，CCB-grade editing UX 归属 Phase 15.5 开源前 hardening。 |

结论：Phase 00-14 的 done 只能代表当时最小闭环，不代表开源前成熟度。

## Phase 15 当前状态统一结果

- Batch 1/2/3 focused/mock/local verification guard 已通过。
- Batch 3.5 以最新 Batch 3.5 报告和开发窗口验证结果为准。
- Phase 15 Beta readiness 仍为 PARTIAL/BLOCKED，等待真实 provider + 真实项目 smoke。
- 不得从 focused PASS、mock PASS、local PASS、scoped PASS、Batch 3.5 PASS、单个 live text PASS、SKIPPED/PENDING smoke 或 silent-failure ban PASS 推断 Beta PASS。
- 真实项目 smoke 前必须先完成本次 source-of-truth hardening。

## Phase 15.5-18 后置项归属表

| 阶段 | 后置项归属 |
| --- | --- |
| Phase 15.5 | MCP / Skills / Plugins Connect Lite；Bundled codebase-memory Lite packaging/license/NOTICE；Compact Lite；Verification / Review Runtime Lite；Write/Edit/MultiEdit CCB-grade editing UX；provider maturity；Freshness/web evidence；release/open-source readiness；TUI runtime maintainability hardening；终端 TUI polish 清零。 |
| Phase 16 | 可控学习、长期记忆、skill evolution；候选生成、证据阈值、accept/reject/retire/stale/conflict、成本 guard 和 cache 稳定性。 |
| Phase 17 | durable jobs、remote channels、远程审批/通知；17A 本地 durable jobs 先闭合，17B remote channels/adapters 默认关闭后置。 |
| Phase 18 | 桌面端预留验证；只验证 core/API/IPC 复用，不补基础终端 TUI 手感。 |

这些后置项不得回流到 Phase 00-14 或 Phase 15 已完成项。

## reference-map 边界检查结果

`docs/audit/reference-map.md` 已强化：参考源只能说明“可参考什么 / 禁止什么 / 对应阶段”。CCB、OpenCode、Warp、OpenSpec、Hermes、MCP、codebase-memory 等只能作为公开行为、交互边界、架构取舍、验收标准和失败降级思路参考。

禁止事项保持：不得复制源码、内部 API、反编译产物、专有遥测或私有配置；不得把 prompt-only 文案或历史审计 PASS 当 runtime 成熟度；不得为了参考源扩大阶段范围。

## 历史 audit 降级规则落点

- 旧 audit 只作为 evidence，不作为当前执行入口。
- 历史 PASS / READY / READY_TO_FIX / READY_FOR_USER_DECISION 必须被 `README.md`、`START_NEXT_CHAT.md`、`docs/delivery/README.md` 和 `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md` 中的最新状态覆盖。
- `PHASE_15_BETA_CCB_MATURITY_REMEDIATION_BASELINE.md` 第 12 节 `Deferred Issue Register` 和第 13 节 `Audit Traceability Matrix` 仍作为后置项集中追踪表；后续阶段开工时复制相关 rows 再裁决 DONE / DEFERRED / NOT-DO。

## 开源前 release gate 口径

- Beta 实测期间可以按 P0/P1/P2 分类。
- P0 和确认后的阻塞 P1 必须在当前阶段或对应 gate 内关闭。
- 非 terminal-scope P2 可登记到后续阶段。
- 终端开源发布前 terminal-scope P0/P1/P2 必须清零、降级为 NOT-DO，或证明 out-of-scope；不允许默认留 P2。

## git diff --check 结果

已运行：`git diff --check`。

结果：通过，无 whitespace error；命令仅输出 Windows 工作区 LF/CRLF 转换 warning。
