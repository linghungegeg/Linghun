# Phase 16：Controlled Learning / Memory / Skill Evolution

## 阶段目标

本轮只完成 Pre-Open-Source Terminal Product Completion Gate 的 Phase 16：Controlled Learning / Memory / Skill Evolution。范围限定为复用 Linghun 既有 memory / skill / evidence / transcript / handoff / permission / config 机制，补齐候选优先、显式接受、可审计、可撤销、成本可见的受控学习闭环。

本次更新是 Phase 16 maturity closure：用源码修复 session-scope memory 生命周期和 `/skills evolve` 命令语义，并补充回归测试；不是文字补丁。

本轮不进入真实全量 smoke，不声明 Beta PASS、smoke-ready 或 open-source-ready，不进入 Phase 17A / 17B / 18，不提交 commit，不新增第二套 provider、tool、permission、evidence、MCP、index、agent、job、memory、skill、learning、desktop 或 release runtime，不复制 CCB / Claude Code / OpenCode / 第三方源码。

## Source-Level Reality Check 摘要

### Existing implementation

- `packages/tui/src/index.ts` 已有统一 slash command dispatcher、`TuiContext`、`SessionStore` transcript 写入、`system_event`、`EvidenceRecord`、`HandoffPacket`、`/memory`、`/skills`、`createModelSystemPrompt()`、cache freshness hash、permission / Start Gate / Connect Lite 边界。
- `packages/core/src/session.ts` / `SessionStore` 已支持 `memory_candidate`、`memory_accepted`、`system_event`、`evidence_record`、`handoff_packet` 等 transcript event，可复用为 Phase 16 audit trail。
- `packages/config/src/index.ts` 已有 memory storage config 与 `summarizer` model route；本轮没有新增 provider route，也没有调用 summarizer model。
- `packages/tui/src/natural-command-bridge.ts` 已有 Command Capability Catalog，可对自然语言 memory/status/review/stats 入口给出边界说明。
- codebase-memory index `F-Linghun` observed ready（nodes=1609, edges=3157）；索引查询没有给出足够精确的 Phase 16 runtime 定位后，按规则降级到源码读取确认。

### Gaps

- 旧 `MemoryCandidate` 只有 `project/user` scope、`candidates/accepted` 两类列表，缺少 `session` scope、`status`、`sourceRefs`、risk、inferred 与 disabled/rejected/retired 状态。
- `/memory` 能创建、接受和删除候选，但缺少 reject / disable / rollback / stats / learn 等 Phase 16 受控学习生命周期入口。
- model prompt 未显式标注 accepted-only、topK、有界注入和 no-auto-learning/no-auto-accept 边界。
- memory freshness hash 包含不适合稳定缓存的长期状态口径，且未覆盖 disabled/rejected 等状态的稳定排序摘要。
- skill runtime 只有 install/list/trust/disable 等能力，缺少“skill evolution candidate-only”建议通道，容易被误解为自动生成/安装 skill。
- natural-command bridge 的 memory capability 文案未覆盖 Phase 16 stats / disabled / explicit mutation boundary。

### Minimal touch points

- `packages/tui/src/index.ts`：扩展 memory record shape、受控 lifecycle 命令、accepted-only prompt injection、`/memory stats`、`/memory learn`、skill evolution candidate-only metadata。
- `packages/tui/src/index.test.ts`：补 focused regression，覆盖 memory lifecycle、prompt injection、stats、learn candidate、skill evolution candidate-only。
- `packages/tui/src/natural-command-bridge.ts`：补 memory capability 文案，明确 stats 和 accept/delete/disable 需要显式命令。
- `docs/delivery/README.md` 与本报告：Phase 16 交付闭环。

### Forbidden duplicate systems

本轮未新增第二套 provider/tool/permission/evidence/MCP/index/agent/job/memory/skill/learning runtime；未新增 durable jobs、remote channels、desktop/release flow、skill marketplace、cloud sync、auto update、WebSearch/WebFetch freshness acquisition 或自动学习 daemon；未新增依赖；未复制 CCB / Claude Code / OpenCode / 第三方源码、内部 API、专有遥测或反编译痕迹。

## 已完成功能

- Memory record 扩展为受控 lifecycle：`candidate`、`accepted`、`rejected`、`disabled`、`retired`，scope 支持 `project`、`user`、`session`。
- `/memory candidate <摘要> [--scope project|user|session]`：只创建候选，不长期注入。
- `/memory accept <id>`：显式接受候选，并追加既有 `memory_accepted` transcript event；project/user scope 写入对应 memory JSON，session scope 只在当前 `TuiContext` / 当前会话生效，不写入跨会话长期 storage。
- `/memory reject <id>`：拒绝候选，仅记录状态和 `system_event`，不注入 prompt。
- `/memory disable <id>`：禁用 accepted memory；保留记录但从 prompt injection 中移除。
- `/memory rollback <id>`：把 disabled memory 恢复为 accepted。
- `/memory delete <id>`：删除任意 memory record；project/user scope 同步删除对应持久化 JSON，session scope 只删除当前会话内存态。
- `/memory stats`：展示 candidates/accepted/disabled/rejected 计数、accepted-only topK 注入数量、字符数、估算 token、lastLearningRun、autoLearning/off、longTermWrite/explicit accept、summarizerRole 边界。
- `/memory learn`：只从已有 evidence / completed Todo / verification pass / handoff 的 bounded refs 派生候选，最多 3 条，`modelCalled=false`，不调用 provider、不联网、不扫全仓、不自动接受。
- `createModelSystemPrompt()` 新增 `ControlledMemorySummary` 与 `MemoryBoundary`，只注入 accepted、non-inferred、稳定排序、topK=3、截断后的摘要。
- memory freshness summary 改为稳定排序的 project rules / candidates / accepted / disabled / rejected 摘要，不依赖访问时间或随机顺序。
- `/skills evolve candidate <summary>`：只生成 skill evolution candidate metadata，不写文件、不安装、不信任、不启用。
- `/skills evolve <其他文本>`：只给用法提示，不创建候选，避免自然文本误触发 skill evolution。
- `/skills evolve`：查看候选，并显示 `autoEnable=no; writesFiles=no; trustChanges=no`。
- `/skills evolve reject <id>`：拒绝 skill evolution candidate，仅记录状态。
- natural-command bridge 更新 memory capability 文案：支持 review/stats/storage，同时明确 accept/delete/disable 需要显式命令。

## 使用方式

```text
/memory
/memory review
/memory stats
/memory learn
/memory candidate <摘要> [--scope project|user|session]
/memory accept <id>
/memory reject <id>
/memory disable <id>
/memory rollback <id>
/memory delete <id>
/skills evolve
/skills evolve candidate <summary>
/skills evolve reject <id>
```

- `/memory learn` 只生成候选，不写长期记忆，不调用模型。
- 长期记忆进入 prompt 的唯一路径是用户显式 `/memory accept <id>` 后的 accepted memory。
- disabled/rejected/session candidate 不会绕过 Start Gate、permission mode 或 provider/tool runtime。
- skill evolution 只记录建议；真正创建 skill manifest、安装、信任或启用仍必须走既有 `/skills install|trust|enable` 与 Connect Lite 边界。

## 涉及模块

- `packages/tui/src/index.ts`：Phase 16 memory lifecycle、controlled prompt injection、manual learn、skill evolution candidate-only runtime。
- `packages/tui/src/index.test.ts`：Phase 16 focused regressions。
- `packages/tui/src/natural-command-bridge.ts`：memory capability catalog 文案对齐。
- `docs/delivery/README.md`：Phase 16 交付记录。
- `docs/delivery/phase-16-controlled-learning-memory-skill-evolution.md`：本报告。

## 关键设计

### Candidate-first, accepted-only

所有学习结果默认只是候选。长期 prompt 注入只读取 `status=accepted` 且非 inferred 的 memory；candidate/rejected/disabled/retired 不注入。接受、禁用、回滚、删除都需要用户显式 slash command。

### Bounded prompt injection

`ControlledMemorySummary` 使用稳定 id 排序，只取 topK=3；单条摘要和总字符数都被截断。prompt 中只包含 memory id、scope、summary、source 的短摘要，不包含完整 transcript、完整 source、完整 tool output、完整 evidence 或完整 memory store。

### Cost Guard

本轮没有 per-turn learning model call。`/memory learn` 的 `MemoryLearningRun.modelCalled=false`，候选仅来自既有 runtime state 的 bounded refs。未来若引入 summarizer role，也必须保持可选、有界、失败降级为 no learning，不新增 provider runtime。

### Audit trail reuse

memory candidate / accepted 复用既有 transcript event；reject/disable/rollback/delete 和 skill evolution 复用 `system_event`。本轮没有新增 event store、memory DB、skill DB 或 evidence runtime。

### Skill evolution is metadata only

skill evolution candidate 只记录 summary、triggerCondition、source、risk、suggestedPath 和 status；不会自动写 skill 文件、不会自动安装、不会改变 trust/enabled 状态。

## 配置项

本阶段没有新增用户必须配置的新顶层配置项。沿用既有配置：storage.memory project/user/session、provider/model routes、permission mode、skills/plugins/hooks 等。

DEFERRED：可选 learning policy 配置（例如默认 topK、learn source allowlist、summary budget）没有在本轮新增，避免扩大配置面和公共接口；当前 Phase 16 使用 runtime 内部保守默认值。

## 命令

本阶段新增或扩展终端入口：

- `/memory stats`：受控注入与成本统计。
- `/memory learn`：manual / bounded / candidate-only learning。
- `/memory candidate <摘要> [--scope project|user|session]`：支持 session scope。
- `/memory reject <id>`：拒绝候选。
- `/memory disable <id>`：禁用 accepted memory。
- `/memory rollback <id>`：恢复 disabled memory。
- `/memory delete <id>`：删除记录与持久化 JSON。
- `/skills evolve`：查看 skill evolution candidates。
- `/skills evolve candidate <summary>`：创建 candidate-only skill suggestion。
- `/skills evolve reject <id>`：拒绝 skill suggestion。

## 测试与验证

Focused/local validation（本轮已执行）：

- `corepack pnpm exec vitest run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts packages/config/src/index.test.ts -t "Phase 16|memory lifecycle|memory learn|skill evolution|session"`：PASS（3 files，7 tests；288 skipped）。覆盖 session-scope memory 当前会话可注入/新会话不加载、memory lifecycle、`/memory learn` candidate-only/modelCalled=no、`/skills evolve <其他文本>` 不创建候选、skill evolution candidate-only、natural-command bridge/config scoped regression。
- `corepack pnpm typecheck`：PASS。
- `corepack pnpm check`：PASS（Biome checked 57 files, no fixes applied）。
- `corepack pnpm build`：PASS。
- `git diff --check`：PASS（仅 Windows LF/CRLF warning，无 whitespace error）。

以上验证只代表 Phase 16 focused/local validation；不代表真实全量 smoke、Beta PASS、smoke-ready 或 open-source-ready。

## 性能结果

- `/memory stats` 只读取内存中的 `TuiContext.memory` 并做短摘要/token estimate，不调用 provider、不读全仓。
- `/memory learn` 最多检查已有 evidence 前 3 条、completed Todo 前 3 条、lastVerification 和 lastHandoff，最多生成 3 条候选。
- prompt injection topK=3，并有单条/总字符截断，不把完整 memory store 注入主链路。
- skill evolution candidate 只写内存状态和 transcript `system_event`，不扫描 skill 目录、不安装依赖、不触发网络。

## 已知问题

- 本轮没有新增可配置 learning policy；当前使用保守内置默认值。
- `/memory learn` 是 Lite manual source collector，不做语义去重、质量评分、长期适用性模型判定或跨会话自动总结。
- accepted memory 仍依赖用户判断质量；系统只保证候选优先、边界收敛和可撤销，不保证内容一定正确。
- skill evolution 不生成真实 skill manifest；它只提供后续人工沉淀入口。
- 没有执行真实 full smoke，也没有证明 Beta、open-source release 或 Phase 17 durable job 能力。

## 不在本阶段处理的内容

- 真实全量 smoke、Beta PASS、smoke-ready、open-source-ready 决策。
- Phase 17A local durable jobs、Virtual Agent Concurrency、Native Local Job Runner / Process Supervisor。
- Phase 17B remote channels / 企业微信 / 飞书 / 钉钉 adapter。
- Phase 18 desktop / release flow / open-source publishing。
- 第二套 provider / tool / permission / evidence / MCP / index / agent / job / memory / skill runtime。
- 自动逐轮学习、自动接受长期记忆、自动生成/安装/信任/启用 skill。
- 完整 WebSearch/WebFetch freshness acquisition runtime、skill marketplace、plugin marketplace、cloud sync、auto update。
- commit。

## 下一阶段衔接

Phase 16 完成后必须停止。下一步只能由用户确认是否进入 Phase 17A local durable jobs / Virtual Agent Concurrency；不得自动进入 Phase 17A/17B/18、真实全量 smoke、开源发布或 commit。

## 开发者排查入口

- Memory lifecycle and prompt injection：`packages/tui/src/index.ts` 的 `handleMemoryCommand()`、`createControlledMemoryInjection()`、`formatControlledMemoryForModel()`、`runControlledMemoryLearning()`、`createMemoryFreshnessSummary()`。
- Skill evolution candidate-only：`packages/tui/src/index.ts` 的 `handleSkillsCommand()`、`createSkillEvolutionCandidate()`。
- Natural command bridge：`packages/tui/src/natural-command-bridge.ts` 的 memory capability data。
- Focused tests：`packages/tui/src/index.test.ts` 的 Phase 16 memory / skill evolution tests。

## 参考核对

本阶段实际读取/核对的 Linghun 文档：

- `F:\Linghun\docs\delivery\pre-open-source-terminal-product-completion-gate.md`
- `F:\Linghun\docs\audit\phase-15-5-pre-real-smoke-comprehensive-audit.md`
- `F:\Linghun\docs\delivery\phase-15-5f-terminal-product-readiness.md`
- `F:\Linghun\docs\delivery\README.md`
- 续接前已读取：`F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- 续接前已读取：`F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- 续接前已读取：`F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- 续接前已读取：Phase 15.5A-F 交付报告、reference-map、Phase 15 baseline sections 12/13 相关内容。

本阶段参考核对范围：

- CCB / Claude Code Best / OpenCode：仅参考 memory review、summary-first、candidate/acceptance、permission/cost boundary、skill suggestion boundary 的产品行为；未复制源码或内部实现。
- Linghun 既有 runtime：进入自研实现的是 memory lifecycle、accepted-only prompt injection、manual learn、skill evolution candidate metadata、focused tests 和本交付报告。
- codebase-memory：仅作为 Source-Level Reality Check 定位线索；产品运行时不新增外部 index 依赖。
- 未复制可疑源码实现、内部 API、专有遥测或第三方实现细节。

### Reference delta catch-up 裁决表

| 来源细节 | 裁决 | Phase 16 处理 |
| --- | --- | --- |
| gate/spec：默认不每轮学习 | DONE | 无 per-turn learning hook；仅 `/memory learn` 手动触发。 |
| gate/spec：不自动接受长期记忆 | DONE | candidate-first；只有 `/memory accept <id>` 进入 accepted。 |
| gate/spec：候选来自 evidence/Todo/验证/handoff | DONE（Lite） | `/memory learn` 从 bounded evidence、completed Todo、pass verification、handoff refs 生成候选。 |
| gate/spec：可审计、可撤销、可关闭 | DONE | transcript/system_event audit；reject/disable/rollback/delete lifecycle。 |
| gate/spec：不注入完整 memory | DONE | accepted-only topK=3 + truncate；只注入短 JSON summary。 |
| gate/spec：成本 guard | DONE（Lite） | `/memory stats` 展示 estimated tokens；`/memory learn` modelCalled=false。 |
| spec/config：summarizer role 可作为低成本总结 | DEFERRED | 既有 config 保留；本轮未调用 summarizer，避免新增 provider path。 |
| spec：skill evolution | DONE（Candidate-only） | `/skills evolve candidate` 只记录 metadata，不写文件/安装/信任/启用。 |
| baseline section 12/13：raw transcript/source/tool output 不进 prompt | DONE | prompt 只含 accepted short summary；报告固定边界。 |
| baseline section 12/13：长期状态必须可撤销 | DONE | disable/rollback/delete。 |
| full semantic learning / quality scoring | DEFERRED | 超出 Phase 16 Lite；避免模型自动判定长期事实。 |
| plugin/skill marketplace / auto install | NOT-DO | 本轮只做 candidate-only metadata。 |
| Phase 17A/17B/18 | NOT-DO | 不进入 durable jobs、remote channels、desktop/release。 |
| real full smoke / Beta PASS / smoke-ready / open-source-ready | NOT-DO | 本轮只做 focused/local Phase 16 closure。 |

## 成品级结构化 handoff packet

- Current phase：Phase 16 Controlled Learning / Memory / Skill Evolution。
- Status：focused/local validation passed；independent verifier was stopped by user request and replaced with manual self-check；不是 Beta PASS，不是 smoke-ready/open-source-ready。
- Next step：user-confirmed Phase 17A local durable jobs / Virtual Agent Concurrency, or user-requested review/fix of Phase 16 findings。
- Must not do next without confirmation：真实全量 smoke、Phase 17A/17B/18、commit、open-source release、remote channels、durable jobs、desktop、第二套 runtime。
- Modified files：
  - `docs/delivery/README.md`
  - `docs/delivery/phase-16-controlled-learning-memory-skill-evolution.md`
  - `packages/tui/src/index.ts`
  - `packages/tui/src/index.test.ts`
  - `packages/tui/src/natural-command-bridge.ts`
- Validation：focused/local validation passed in this working copy; independent verifier was stopped by user request and replaced with manual self-check.
- Index status：codebase-memory `F-Linghun` observed ready, nodes=1609, edges=3157。
- Permission mode：local repository edits and local validation only；no network install, no remote operation, no release action。
- Model/provider note：work performed in Claude Code environment with Claude Sonnet 4.6；Linghun real provider behavior was not smoke-tested。
- Budget/cost note：no real provider/network smoke; Phase 16 runtime path does not add per-turn learning model calls。

## Stop point

Stop here at Phase 16 delivery point after final validation. Do not proceed to real full smoke, Phase 17A, Phase 17B, Phase 18, commit, release, network install, or open-source readiness declaration without a new explicit user instruction.
