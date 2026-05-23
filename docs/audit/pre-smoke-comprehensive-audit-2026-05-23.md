# Pre-Smoke Comprehensive Audit / Polish Gate — 2026-05-23 (Hardened v2)

## 状态声明

- **本轮性质**：全面审计（加固轮），不是开发新阶段。
- **不做 Phase 18 desktop**。
- **不执行真实项目 smoke**。
- **不宣布 Beta PASS / smoke-ready / open-source-ready**。
- **不提交 commit**。
- **不新增第二套 provider/tool/permission/evidence/MCP/index/agent/job/runtime**。
- **不复制 CCB / Claude Code / OpenCode / 第三方源码**。
- **不把 focused/mock/local PASS 推断为整体 ready**。
- **不把历史 PASS / READY / audit report 当作当前 source-of-truth**。
- **按用户明确指令，本轮只重写审计报告，不改代码、不补 README、不加 .gitattributes / .editorconfig**。

---

## 1. Verdict

**`AUDIT_HARDENING_REQUIRED`**

理由：
- P1-1 (`tui/index.ts` 15,412 行) 此前被标记 DEFERRED 但未给出具体拆分计划和时间点；结构债不应无计划 DEFERRED
- P1-2 (缺少 `.gitattributes` / `.editorconfig`) 首轮被标记 DEFERRED 但属于 scope 极小、风险可控、可直接修复的问题，首轮 DEFERRED 缺乏正当理由
- P1-3 (README.md 过时) 首轮被标记 DEFERRED 但属于 scope 极小、无风险问题，首轮 DEFERRED 缺乏正当理由
- 首轮审计报告自身 `commit 0` 但写 `git status --short: clean` 是事实错误（本报告本身 untracked），审计报告必须自我一致

**按用户明确指令，本轮只重写审计报告，不改代码、不补 README、不加 .gitattributes / .editorconfig。因此 P1-2/P1-3 本轮不做修复，但裁决从首轮的 DEFERRED 更正为 FIX_REQUIRED_BEFORE_SMOKE——不能以 "可后置" 为理由标记 scope 极小、风险可控的问题。P1-1 需给出最小首批拆分计划。**

在当前审计轮次加固完成且 P1-2/P1-3 修复前，不得声明 `CONDITIONAL_READY_FOR_REAL_PROJECT_SMOKE`。

---

## 2. Git / Worktree Truth

### 2.1 实际状态

```
$ git status --short
?? docs/audit/pre-smoke-comprehensive-audit-2026-05-23.md
```

- **分支**：`master`（clean，无已修改文件）
- **未跟踪文件**：仅 `docs/audit/pre-smoke-comprehensive-audit-2026-05-23.md`（本报告）
- **无 staged 变更**
- **无 unstaged 变更**

### 2.2 行尾/空白检查

```
$ git diff --check
（无输出 — 无 whitespace error）
```

### 2.3 纠正首轮错误

首轮审计报告写 `git status --short: (clean) — 无修改文件` 是不准确的：审计报告本身是 untracked 文件，`git status --short` 应显示 `??`。审计报告必须报告自身的存在状态，不能将 untracked 报告文件视为 "clean"。

---

## 3. Source-of-Truth Evidence Table

每条关键声明附具体源码证据（文件路径、行号、函数名、测试入口）。

### 3.1 核心链路证据

| # | 声明 | 源码证据 | 测试证据 |
|---|------|----------|----------|
| 1 | CLI 入口正常 | `apps/cli/src/main.ts:1-15`；`apps/cli/src/cli.ts:1-362`；`package.json` bin 含 `linghun` + `Linghun` | `apps/cli/src/main.test.ts` 7 tests PASS |
| 2 | 模型网关完整实现 | `packages/providers/src/index.ts:1-1388` — `OpenAiCompatibleProvider` class (line 320+), `DeepSeekProvider` extends it (line 478+), SSE stream 解析 (line 900+), 指数退避重试 (line 544-556), PROVIDER_MAX_ATTEMPTS=3 (line 199) | `packages/providers/src/index.test.ts` 38 tests PASS |
| 3 | HTTP error 分类 | `packages/providers/src/index.ts:1297-1301` — `createApiKeyError()` 分类 401/403；line 1265 error classifier；line 1307 `sanitizeProviderBadRequestHint()` 脱敏 400 body | `packages/providers/src/index.test.ts:1000-1068` — 400/502 error 分类测试，验证不泄露 secrets |
| 4 | 重试逻辑 | `packages/providers/src/index.ts:544-556` — for loop 最多 3 次，429/5xx 可重试，指数退避 `PROVIDER_BASE_RETRY_MS * 2 ** (attempt - 1)` | `packages/providers/src/index.test.ts:284` — `expect(fetchMock).toHaveBeenCalledTimes(3)` |
| 5 | API key 缺失检测 | `packages/providers/src/index.ts:468-472` — `if (!this.config.apiKey)` → throw `MODEL_API_KEY_MISSING` | `packages/providers/src/index.test.ts:981-997` — `createApiKeyError` + `MODEL_API_KEY_MISSING` 测试 |
| 6 | 工具注册表 | `packages/tools/src/index.ts:1-1147` — 9 tools: Read, Write, Edit, MultiEdit, Grep, Glob, Bash, Todo, Diff | `packages/tools/src/index.test.ts` 7 tests PASS |
| 7 | Read-before-edit guard | `packages/tools/src/index.ts:836` — `ensureReadBeforeEdit()` | 内嵌于 tools/index.test.ts |
| 8 | 权限管道 | `packages/tui/src/index.ts:14219` — `decidePermission()` 四模式 (default/auto-review/plan/full-access) + hard deny + rule matching | `packages/tui/src/index.test.ts` 152 tests PASS |
| 9 | 权限别名标准化 | `packages/shared/src/index.ts:1-29` — `normalizePermissionMode()` legacy alias mapping | `packages/shared/src/index.test.ts` 1 test PASS |
| 10 | 会话持久化 | `packages/core/src/session.ts:1-326` — 33 event types, Session, CacheTurnStats | `packages/core/src/session-store.test.ts` 4 tests PASS |
| 11 | JSONL transcript | `packages/core/src/jsonl.ts` — append/flush 语义 | `packages/core/src/jsonl.test.ts` 3 tests PASS |
| 12 | Architecture Runtime | `packages/tui/src/architecture-runtime.ts:1-410` — `shouldTriggerArchitectureRuntime()`, `collectArchitectureFacts()`, `formatArchitectureCard()`, `detectArchitectureDrift()` | `packages/tui/src/architecture-runtime.test.ts` 21 tests PASS |
| 13 | Workspace Reference Cache | `packages/tui/src/workspace-reference-cache.ts:1-694` — mtime/size/hash 缓存, HARD_SKIP_DIRS (10 dirs), bounded snapshot | `packages/tui/src/workspace-reference-cache.test.ts` 7 tests PASS |
| 14 | Compact Lite | `packages/tui/src/compact-context.ts:1-217` — microCompactMessages (line 60), tool pair 保护 (line 42 `groupMessagesWithoutSplittingToolPairs`), boundary 记录 (line 100) | `packages/tui/src/compact-context.test.ts` 2 tests PASS |
| 15 | Log Artifact | `packages/tui/src/log-artifact.ts:1-477` — tail (line 200+), grep (line 250+), errors (line 300+), bounded slice | `packages/tui/src/log-artifact.test.ts` 10 tests PASS |
| 16 | Natural Command Bridge | `packages/tui/src/natural-command-bridge.ts:1-1861` — keyword-based intent 分类，~32 slash commands | `packages/tui/src/natural-command-bridge.test.ts` 130 tests PASS |
| 17 | Config 加载/合并 | `packages/config/src/index.ts:1-1231` — loadConfig, mergeConfig, env var 优先级, atomic write (temp+rename line 671-677) | `packages/config/src/index.test.ts` 24 tests PASS |

### 3.2 安全/脱敏证据

| # | 声明 | 源码证据 | 测试证据 |
|---|------|----------|----------|
| 18 | Log 内容脱敏 | `packages/tui/src/log-artifact.ts:470-477` — `redactLogContent()`: 5 条正则替换 covering Authorization, Cookie, Bearer, sk-*, api_key/token | `packages/tui/src/log-artifact.test.ts:70` — "greps bounded matches with context and redacts secrets" → `.toContain("[REDACTED]")` |
| 19 | API key 写盘剥离 | `packages/config/src/index.ts:680-689` — `removeSensitiveProjectSettings()`: `const { apiKey: _apiKey, ...safeProvider } = provider` | `packages/config/src/index.test.ts:193` — "keeps legacy project apiKey readable but strips apiKey on settings writes"; line 216 `expect(raw).not.toContain("sk-project-legacy-secret")` |
| 20 | env API key 不入 settings | `packages/config/src/index.ts:1073` — mergeConfig 中 `if ((key === "baseUrl" || key === "apiKey") && (value === undefined || value === ""))` skip | `packages/config/src/index.test.ts:220` — "does not write env apiKey into project settings"; line 231 `expect(raw).not.toContain("sk-env-openai-secret")` |
| 21 | Secret 掩码显示 | `packages/tui/src/index.ts:4220-4223` — `maskSecret()`: 返回 `sk-…cret` 格式 | `packages/tui/src/index.test.ts:2815` — `expect(output.text).toContain("masked=sk-…cret")`; line 5047/5085/5120 同 |
| 22 | 诊断文本脱敏 | `packages/tui/src/index.ts:8558-8564` — `sanitizeDiagnosticText()`: 脱敏 prompt=, api_key=, Bearer, sk-* | 内嵌于多处 index.test.ts |
| 23 | 路径脱敏 | `packages/tui/src/index.ts:8566-8570` — `redactedPath()`: 仅暴露 basename | `packages/tui/src/index.test.ts:5611` — `expect(output.text).toContain("sourcePath: redacted:evidence-output.log")` |
| 24 | Remote 摘要脱敏 | `packages/tui/src/index.ts:5137-5148` — `redactRemoteSummary()`: 8 种模式正则替换 | `packages/tui/src/index.test.ts:7066-7090` — 验证 redactedSummary 不含 secret-value, abc123, sk-live-secret, auth-secret, raw-api-key, URL, transcript, source, log, index result |
| 25 | Provider error 脱敏 | `packages/providers/src/index.ts:1307-1312` — `sanitizeProviderBadRequestHint()`: `replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")` | `packages/providers/src/index.test.ts:1000-1034` — 400 error body 脱敏测试 |
| 26 | Model doctor key masking | `packages/tui/src/index.ts:4215-4217` — `resolveProviderApiKeySource()` 返回 "env"/"project-settings"/"merged-config" 但不返回 key 值 | `packages/tui/src/index.test.ts:5037-5120` — 验证 doctor 输出含 masked 格式不含完整 key |

### 3.3 防重复系统证据

| # | 声明 | Grep 证据 |
|---|------|-----------|
| 27 | 仅 1 套 provider runtime | `Grep "class.*Provider" packages/providers/src/index.ts` → 2 classes: `OpenAiCompatibleProvider` + `DeepSeekProvider`(extends)，不是两套独立系统 |
| 28 | 仅 1 套 tool registry | `Grep "defineTool" packages/tools/src/index.ts` → 9 次调用，全部在同一个 `createToolRegistry()` |
| 29 | 仅 1 套 permission pipeline | `Grep "decidePermission"` → 仅 `packages/tui/src/index.ts:14219` |
| 30 | 仅 1 套 evidence 系统 | `Grep "EvidenceRecord\|evidence.*record\|recordEvidence" packages/` → 集中在 tui/index.ts 单文件 |
| 31 | 仅 1 套 MCP management | `Grep "mcp\|McpState\|createMcpState" packages/tui/src/` → 集中在 tui/index.ts |
| 32 | 仅 1 套 job runtime | `Grep "DurableJob\|durable.*job\|/job" packages/tui/src/` → 集中在 tui/index.ts |
| 33 | 仅 1 套 agent runtime | `Grep "/fork\|fork.*agent\|AgentOptions" packages/tui/src/` → 集中在 tui/index.ts |

---

## 4. Stage Report Evidence Matrix

### 4.1 全部阶段报告状态

| 报告文件 | 状态 | 最后提及不代表项 | 确认行 |
|----------|------|-------------------|--------|
| `phase-15-5a-performance-context.md` | done | 不代表 Beta PASS / smoke-ready | ✅ |
| `phase-15-5b-resource-task-lifecycle.md` | done | cancelled/timeout/stale 不生成 PASS evidence | ✅ |
| `phase-15-5c-editing-tool-ux.md` | done | 不代表 Beta PASS / smoke-ready / open-source-ready | ✅ |
| `phase-15-5c-plus-log-artifact-runtime-lite.md` | done | Log Artifact Runtime Lite 已实现 | ✅ |
| `phase-15-5d-connect-lite.md` | done | 不代表 Beta PASS / smoke-ready / open-source-ready | ✅ |
| `phase-15-5e-provider-freshness.md` | done | focused/local validation only | ✅ |
| `phase-15-5f-terminal-product-readiness.md` | done | focused/local validation only | ✅ |
| `phase-16-*.md` (controlled learning) | done | focused/local validation only | ✅ |
| `phase-17a-local-durable-jobs-virtual-agent-concurrency.md` | done | Virtual Agent Concurrency 已完成 | ✅ |
| `phase-17b-remote-channels.md` | done | 企业微信/飞书/钉钉 第一版已完成 | ✅ |
| `phase-17c-native-runner-job-supervisor-gate.md` | done | Native Runner 正确作为长任务候选增强 | ✅ |

**PASS 膨胀检查结论**：11/11 份阶段报告均正确限定其声明范围，无一将 focused/mock/local PASS 推断为 Beta PASS / smoke-ready / open-source-ready。

### 4.2 阶段交付文档缺失检查

| 检查项 | 结论 |
|--------|------|
| Phase 00-14 有无被后续阶段回写 "done" | 无 — START_NEXT_CHAT.md 明确声明 "Phase 00-14 done 不回写、不污染" |
| Phase 15.5A-F 有无混入其他阶段内容 | 无 — 每份报告范围清晰 |
| Phase 16 有无混入 Phase 17 内容 | 无 |
| Phase 17A/17B/17C 有无越界实现 | 无 — Native Runner 明确不是默认执行器替代 |

---

## 5. Runtime Source Evidence Matrix（25 Areas）

每项附具体文件路径、行号、函数名或 grep 结果。

### 5.1 Ordinary Input → Model Request Chain

- **入口**：`packages/tui/src/index.ts:11313` — `handleNaturalInput()`
- **消息发送**：`packages/tui/src/index.ts:11971` — `sendMessage()`
- **完整链路**：resource guard → session → evidence gate → runtime status → architecture runtime → workspace cache → system prompt (`createModelSystemPrompt()` line 13123) → budget check → model stream → tool loop
- **测试**：`packages/tui/src/index.test.ts` 152 tests，含完整 TUI 消息流测试

### 5.2 Architecture Runtime

- **文件**：`packages/tui/src/architecture-runtime.ts` (410 lines)
- **函数**：
  - `shouldTriggerArchitectureRuntime()` — trigger pattern 检测
  - `collectArchitectureFacts()` — 收集架构事实
  - `formatArchitectureCard()` — 格式化输出
  - `detectArchitectureDrift()` — 漂移检测
- **测试**：`packages/tui/src/architecture-runtime.test.ts` 21 tests PASS

### 5.3 Anti-Hallucination / Evidence System

- **类型**：`EvidenceRecord` 在 `packages/tui/src/index.ts`
- **Evidence Gate**：在 `sendMessage()` 循环中，每次 tool_result 写入 evidence
- **Claim Check**：`/claim-check` slash command
- **特性**：cancelled/timeout/stale 不生成 PASS evidence

### 5.4 Workspace Reference Cache

- **文件**：`packages/tui/src/workspace-reference-cache.ts` (694 lines)
- **HARD_SKIP_DIRS** (line 8-21)：`.git`, `node_modules`, `dist`, `build`, `coverage`, `target`, `out`, `.next`, `.turbo`, `.cache`, `cache`
- **缓存策略**：mtime/size/hash → bounded snapshot
- **自定义跳过**：`.linghunignore` 支持
- **测试**：`packages/tui/src/workspace-reference-cache.test.ts` 7 tests PASS

### 5.5 Compact Lite

- **文件**：`packages/tui/src/compact-context.ts` (217 lines)
- **三层**：micro (line 60 `microCompactMessages`) / manual / auto-suggested
- **Tool pair 保护**：`groupMessagesWithoutSplittingToolPairs()` — 不破坏 tool_use/tool_result 对
- **Boundary 记录**：`preCompactTokenEstimate` / `postCompactTokenEstimate`
- **测试**：`packages/tui/src/compact-context.test.ts` 2 tests PASS

### 5.6 Resource Guard / Task Lifecycle

- **位置**：`packages/tui/src/index.ts` — `sendMessage()` 中 model guard，background task cap
- **特性**：cancel/timeout/stale 不生成 PASS evidence

### 5.7 Write/Edit/MultiEdit Tools

- **文件**：`packages/tools/src/index.ts` (1147 lines)
- **Read-before-edit guard**：line 836 `ensureReadBeforeEdit()`
- **Stale file guard**：文件在读取后被外部修改时拒绝编辑
- **Unique match check**：Edit 的 `old_string` 必须唯一匹配
- **MultiEdit**：批量编辑单一文件，原子性语义
- **测试**：`packages/tools/src/index.test.ts` 7 tests PASS

### 5.8 MCP / Skill / Plugin / Connect Lite

- **MCP State**：`createMcpState()` at `packages/tui/src/index.ts:1423`
- **Skill State**：`createSkillState()` at `packages/tui/src/index.ts:1624`
- **Workflow State**：`createWorkflowState()` at `packages/tui/src/index.ts:1657`
- **Plugin State**：`createPluginState()` at `packages/tui/src/index.ts:1728` (async)
- **Hook State**：`createHookState()` at `packages/tui/src/index.ts:1711` (async)
- **Connect Lite**：Phase 15.5D — `handleSlashCommand()` 中 mcp/skills/workflows/plugins 子命令
- **操作**：add/validate/enable/disable/remove/update、doctor、trust notice
- **安全边界**：Git/GitHub clone 使用 `--depth 1` + `core.hooksPath=/dev/null` (line 2710-2717)，不执行 postinstall/hook/仓库脚本

### 5.9 Provider Freshness

- **文件**：`packages/providers/src/index.ts` (1388 lines)
- **Provider types**：OpenAI-compatible (line 320+), DeepSeek (line 478+), Responses API profile (line 600+)
- **Capability doctor**：provider → model → tool/stream/profile 检查
- **Token usage 解析**：Chat Completions usage (line 1054-1064), Responses API usage (line 1163-1168)
- **Cache token 支持**：`readCacheWriteTokens()` line 1230-1242, 处理 3 种 provider cache write token 格式
- **测试**：`packages/providers/src/index.test.ts` 38 tests PASS

### 5.10 Terminal Polish / Readiness

- **文件**：`packages/tui/src/terminal-readiness-presenter.ts` (350 lines)
- **`/doctor`**：终端 readiness checklist (line 50+)
- **`/problems`**：问题面板 (line 140+)
- **输出脱敏**：`sanitizePrimary()` line 338, 所有输出经 sanitize 处理
- **测试**：内嵌于 `packages/tui/src/index.test.ts`

### 5.11 Controlled Learning (Memory)

- **Memory State**：`createMemoryState()` at `packages/tui/src/index.ts:1484` (async)
- **生命周期**：candidate → accepted → disabled → retired
- **特性**：candidate-only、显式接受、可禁用/回滚/删除

### 5.12 Durable Jobs

- **位置**：`packages/tui/src/index.ts`
- **类型**：`DurableJobState`, `hydrateDurableJobBackgroundTasks`
- **功能**：job spec, agent status, supervisor, `/job` slash commands
- **测试**：`packages/tui/src/index.test.ts` — `/job run`, `/job create`, budget, timeout, max-steps 测试 (line 1525+)

### 5.13 Remote Channels

- **State**：`createRemoteState()` at `packages/tui/src/index.ts:1304`
- **Event**：`createRemoteEvent()` at `packages/tui/src/index.ts:5020`
- **Channel types**：`feishu` / `wecom` / `dingtalk` (config/src/index.ts)
- **Transport types**：`official_cli` / `webhook` / `webhook_mock` (config/src/index.ts:139)
- **Redaction**：`redactionPolicy: "summary_only"` 强制 (config/src/index.ts:911-912 验证)
- **默认状态**：`enabled: false`
- **测试**：`packages/tui/src/index.test.ts:7001` — "covers Phase 17B Remote Channels setup, doctor, redaction, and approval safety"

### 5.14 Native Runner

- **Resolver**：`resolveNativeRunner()` at `packages/tui/src/index.ts:3362`
- **功能**：Resolver → Adapter → doctor → fallback
- **Platform/arch 探测**：spawnSync version probe + protocol check
- **env override**：`LINGHUN_NATIVE_RUNNER_PLATFORM_ARCH_TEST` (line 3516)
- **Bundled candidate**：`LINGHUN_NATIVE_RUNNER_BUNDLED_DIR` (line 3525)
- **定位**：明确是 durable job 候选增强，不是默认执行器替代 (line 3406+)
- **Fallback**：Node/TUI remains fallback
- **测试**：`packages/tui/src/index.test.ts` — mock native runner 测试 (line 310+)

### 5.15 Permission Pipeline

- **入口**：`decidePermission()` at `packages/tui/src/index.ts:14219`
- **四模式**：default / auto-review / plan / full-access
- **full-access 保护**：需 `LINGHUN_ENABLE_FULL_ACCESS=1` (line 4608)
- **Legacy alias**：`normalizePermissionMode()` in `packages/shared/src/index.ts`
- **Rule matching**：工具级/路径级/模式级规则
- **测试**：`packages/tui/src/index.test.ts` 152 tests（含权限决策路径）

### 5.16 Transcript / Log Artifacts

- **Session**：`packages/core/src/session.ts` (326 lines) — 33 event types
- **SessionStore**：`packages/core/src/session-store.ts` — 按 project/session 组织
- **Log Artifact**：`packages/tui/src/log-artifact.ts` (477 lines) — tail/grep/errors
- **Bounds**：maxBytes/maxLines/maxMatches 上限
- **Permission**：tool_output/evidence/log_artifact 分别控制
- **测试**：session-store 4 tests, jsonl 3 tests, log-artifact 10 tests

### 5.17 Windows / Chinese / CRLF Compatibility

- **中文输出**：`linghun --help` 中文帮助正常
- **Windows 入口**：`Linghun --version` 大写兼容 (package.json bin 含大小写双入口)
- **无硬编码路径**：全使用 `process.cwd()` + `projectPath`，无 `/workspace`
- **行尾兼容**：`/\r?\n/` 处理 CRLF
- **测试**：含中文路径测试 (e.g., `灵魂-readiness-项目-` line 604, `mock runner 空格` line 314)

### 5.18 Config System

- **文件**：`packages/config/src/index.ts` (1231 lines)
- **7 个 role-based model routes**：default, architect, compact, grep, verify, index, summary
- **env var 优先级**：`LINGHUN_*` prefix, env > project settings > defaults (line 1133+)
- **Atomic write**：temp + rename (line 671-677)
- **API key stripping on save**：`removeSensitiveProjectSettings()` line 680-689
- **MCP config**：codebase-memory-mcp via env/path/managed (line 344)
- **Remote channel config**：3 channels, redactionPolicy 强制
- **Native runner config**：disabled by default
- **测试**：`packages/config/src/index.test.ts` 24 tests PASS

### 5.19 Slash Command System

- **路由**：`handleSlashCommand()` at `packages/tui/src/index.ts:2173`
- **约 32 条 slash commands**：/help, /model doctor, /doctor, /problems, /sessions, /switch, /compact, /clear, /index status, /index search, /mcp, /skills, /workflows, /plugins, /hooks, /remote setup, /remote test, /job, /fork, /verify, /memory, /cache, /claim-check, /handoff, /todo, /permission, /evidence, /log, /config, /exit
- **Natural command bridge**：`packages/tui/src/natural-command-bridge.ts` (1861 lines)

### 5.20 Tool Output Presenter

- **文件**：`packages/tui/src/tool-output-presenter.ts` (193 lines)
- **TODO_OUTPUT_ITEM_LIMIT = 8** (line 17)
- **Summary-first**：主屏显示摘要，完整内容进 fullOutputPath/details

### 5.21 Permission Presenter

- **文件**：`packages/tui/src/permission-presenter.ts` (87 lines)
- **双语支持**：zh-CN / en-US
- **格式**：工具名、参数摘要、风险级别、允许/拒绝选项

### 5.22 Request Lifecycle Presenter

- **文件**：`packages/tui/src/request-lifecycle-presenter.ts` (138 lines)
- **上游 gateway 临时不可用**：line 58 — 建议 retry later or run /model doctor

### 5.23 Runtime Status Presenter

- **文件**：`packages/tui/src/runtime-status-presenter.ts` (41 lines)
- **轻量状态条**：当前 model/provider/token usage/compact status

### 5.24 Index Safety Repair

- **文件**：`packages/tui/src/index-safety-repair.ts` (69 lines)
- **触发**：index 状态 stale → 自动修复流程
- **不自动重建**：需用户确认或显式 force

### 5.25 TUI Main Entry

- **文件**：`packages/tui/src/index.ts` (15,412 lines)
- **入口**：`runTui()` at line 2076
- **导出**：92 exported types/functions (grep count)
- **关键函数**：`sendMessage()` (line 11971), `handleSlashCommand()` (line 2173), `handleNaturalInput()` (line 11313), `decidePermission()` (line 14219), `resolveNativeRunner()` (line 3362)
- **已拆分模块**（13 files）：architecture-runtime, compact-context, index-safety-repair, log-artifact, natural-command-bridge, permission-presenter, request-lifecycle-presenter, runtime-status-presenter, terminal-readiness-presenter, tool-output-presenter, workspace-reference-cache
- **仍在内联的职责**：slash command 路由 (~300+ lines), model loop (~600+ lines), 权限决策 (~200 lines), durable jobs (~300 lines), native runner (~400 lines), remote channels (~400 lines), MCP/index runtime

---

## 6. Reference Alignment Matrix

对照 `docs/audit/reference-map.md`，按阶段核对参考源对齐状态：

| 阶段 | 参考源 | 对齐状态 | 备注 |
|------|--------|----------|------|
| Phase 15.5A | CCB 性能上下文 | ✅ 已对齐 | 上下文窗口管理、缓存策略 |
| Phase 15.5B | CCB 资源/任务生命周期 | ✅ 已对齐 | cancel/timeout/stale semantics |
| Phase 15.5C | CCB 编辑工具 UX | ✅ 已对齐 | Read-before-edit guard |
| Phase 15.5C+ | Log Artifact Runtime Lite | ✅ 已对齐 | bounded tail/grep/errors |
| Phase 15.5D | CCB MCP/Skill/Plugin | ✅ 已对齐 | add/validate/enable/disable |
| Phase 15.5E | CCB Provider Freshness | ✅ 已对齐 | 多 provider/model 管理 |
| Phase 15.5F | CCB Terminal Polish | ✅ 已对齐 | /doctor /problems |
| Phase 16 | CCB Memory/Controlled Learning | ✅ 已对齐 | candidate → accepted lifecycle |
| Phase 17A | Durable Jobs | ✅ 已对齐 | job spec/agent/supervisor |
| Phase 17B | Remote Channels | ✅ 已对齐 | feishu/wecom/dingtalk V1 |
| Phase 17C | Native Runner | ✅ 已对齐 | Resolver/Adapter/doctor/fallback |

**参考核对小结**：
- 本阶段实际读取：`docs/audit/reference-map.md`, `START_NEXT_CHAT.md`, 全部 11 份阶段交付文档, 5 份审计/研究报告, `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`, `LINGHUN_IMPLEMENTATION_SPEC.md`, `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`, `docs/delivery/README.md`, `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- 行为参考：CCB 产品行为、交互体验、命令习惯、风险边界、验收思路
- 实现方式：Linghun 自研，未复制 CCB / Claude Code / OpenCode / 第三方源码
- 禁止事项：未触发任何 reference-map.md 所列禁止事项

---

## 7. Search / Probe Evidence Summary

### 7.1 Grep 搜索类别及结果

| # | 搜索类别 | 搜索模式 | 匹配文件 | 结果摘要 |
|---|----------|----------|----------|----------|
| 1 | TODO/placeholder/mock 标记 | `TODO\|FIXME\|HACK\|placeholder\|mock\|stub` | config/index.ts, tui/index.ts, providers/index.test.ts, tools/index.ts | `webhook_mock` 正确标注 diagnostic；`openAiCompatibleModelPlaceholder` 正确使用；mock 仅存在于测试文件 |
| 2 | 凭证/密钥泄露 | `sk-\|api_key\|apiKey\|secret\|password\|token\|credential\|authorization\|bearer` | config/index.ts, providers/index.ts, tui/index.ts, tui/log-artifact.ts | 全部 API key 引用均经脱敏或 stripping 处理；测试文件中使用 `test-key` / `sk-test-*` 假密钥 |
| 3 | process.env 引用 | `process\.env` | config/index.ts, tui/index.ts | 全部使用 `LINGHUN_*` 前缀；合理 env var 优先级链；无裸密钥硬编码 |
| 4 | 重复系统检测 | `duplicate\|clone\|copy\|mirror\|replica` | tui/index.ts | `git clone` 操作用于 Connect Lite（受控）；无重复 runtime 系统 |
| 5 | 脱敏/掩码函数 | `mask\|redact\|sanitize\|strip\|obfuscat` | tui/log-artifact.ts, tui/index.ts, providers/index.ts, config/index.ts | 5 个脱敏函数，覆盖路径/密钥/诊断/remote/bearer |
| 6 | 测试 skip/only | `\.only\( \|\.skip\( \|it\.todo\|describe\.skip\|test\.only` | — | **0 matches** — 无 skipped/only 测试，全部 410 测试活跃 |
| 7 | export 函数 | `export (function\|const\|async function\|class)` | tui/index.ts | 92 exported types/functions（grep count） |
| 8 | Remote channels 边界 | `feishu\|wecom\|dingtalk\|webhook_mock\|official_cli` | config/index.ts, tui/index.ts | 仅 3 种 channel type + 3 种 transport；V1 边界清晰 |
| 9 | Native runner 边界 | `native.runner\|resolveNativeRunner\|bundled.*runner` | tui/index.ts | 明确 "is not a second provider/tool/agent runtime" |
| 10 | 中文内容存在 | `[\u4e00-\u9fff]` | 所有 packages/src/*.ts | 大量中文用户可见字符串、测试用例、slash command 描述 |

### 7.2 Grep 未发现项

- ❌ 无裸 `sk-` 密钥在非测试源码中
- ❌ 无 `process.env.SECRET` / `process.env.API_KEY` 等非标准命名的环境变量
- ❌ 无 `TODO: remove before release` / `FIXME: security` 等安全隐患标记
- ❌ 无 `.only` / `.skip` 测试
- ❌ 无第二套 runtime/provider/tool/permission/evidence 系统

---

## 8. P0 / P1 / P2 Findings with Blocking Decisions

### P0 — 阻塞真实 smoke（0 项）

经全面源码抽样（25 areas, 具体行号）、测试运行（410 tests PASS）和文档审查（11 份阶段报告），**未发现阻塞真实 project smoke 的 P0 问题**。

核心链路全部有真实 TypeScript 实现：
- CLI 入口 → 模型网关 → 工具执行 → 权限管道 → 会话持久化
- 全部通过 typecheck / build / test / lint

### P1 — 真实 smoke 中高概率暴露（3 项）

#### P1-1: `packages/tui/src/index.ts` 文件过大（15,412 行）

- **证据**：`wc -l packages/tui/src/index.ts` = 15,412 行；`grep -c "export (function|const|async function|class)"` = 92 exports
- **已拆分**：13 个独立模块文件
- **仍在内联**：slash command 路由 (~300+ lines), model loop (~600+ lines), 权限决策 (~200 lines), durable jobs (~300 lines), native runner (~400 lines), remote channels (~400 lines), MCP/index runtime
- **风险**：真实 smoke 中调试/修改此文件时容易引入回归；代码审查困难
- **裁决**：**FIX_REQUIRED_BEFORE_SMOKE** — 首轮 DEFERRED 无正当理由。P1-1 必须给出最小首批拆分计划（至少确定首批 2-3 个模块 + 拆分时间点），不要求在本轮全部拆完。不阻塞首次 smoke 但如果 smoke 中需修改此文件，风险显著。

#### P1-2: 缺少 `.gitattributes` / `.editorconfig` 文件

- **证据**：`ls -la .gitattributes .editorconfig` → 均不存在
- **源码证据**：代码中使用 `/\r?\n/` 做行尾兼容（多处），但没有项目级 CRLF 策略
- **风险**：Windows CRLF/LF 行尾冲突；真实项目 smoke 中可能因行尾问题导致 diff 异常、patch 失败
- **Scope**：极小 — 2 个文本文件，每文件 < 20 行；不修改任何源码，不改变行为；添加后 `git diff --check` 可立即验证
- **首轮裁决**：P1 → DEFERRED（无正当理由——scope 极小、风险可控、可验证则修复，不应 DEFERRED）
- **本轮裁决**：**FIX_REQUIRED_BEFORE_SMOKE** — 按用户明确指令本轮只重写审计报告不修改代码，因此本轮不执行修复；但该问题必须在真实 smoke 前修复，不得后置到 smoke 后

#### P1-3: README.md 过时

- **证据**：`README.md` 仍显示 "Phase 15 pre-Beta Full Interaction Maturity Audit 后，Phase 15 Beta 暂停"
- **实际状态**：Phase 15.5A-F / Phase 16 / Phase 17A/B/C 均已完成
- **正确源**：`START_NEXT_CHAT.md` (240 lines) 有最新状态
- **风险**：新开发者/协作者看到过时信息，误解项目进度
- **Scope**：极小 — 更新 README.md 当前进度段（< 20 行变更）；纯文档更新，不影响代码；可读 README 直接验证
- **首轮裁决**：P1 → DEFERRED（无正当理由——scope 极小、风险可控、可验证则修复，不应 DEFERRED）
- **本轮裁决**：**FIX_REQUIRED_BEFORE_SMOKE** — 按用户明确指令本轮只重写审计报告不修改代码，因此本轮不执行修复；但该问题必须在真实 smoke 前修复，不得后置到 smoke 后

### P2 — 可后置，不阻塞真实 smoke（7 项）

#### P2-1: Remote channels 中 `webhook_mock` transport

- **位置**：`packages/config/src/index.ts:139` — `export type RemoteTransport = "official_cli" | "webhook_mock" | "webhook";`
- **实际状态**：`webhook_mock` 被正确标注为 diagnostic/test-only ("notification-only dry runs")
- **裁决**：DEFERRED — 当前实现有清晰边界说明，可在真实 smoke 前清理或保留为 diagnostic

#### P2-2: MCP tool discovery 使用 "placeholder" 标记

- **位置**：`packages/config/src/index.ts:217` — `const openAiCompatibleModelPlaceholder = "openai-compatible-model";`
- **实际状态**：未发现的 MCP tool schema 标记为 `discovery: "placeholder"`，输出明确说明 "real tool schemas are not dumped"
- **裁决**：DEFERRED — 正确的安全边界，不是缺陷

#### P2-3: 硬编码目录跳过列表

- **位置**：`packages/tui/src/workspace-reference-cache.ts:8-21` — `HARD_SKIP_DIRS` 包含 `.git`, `node_modules`, `dist`, `build`, `coverage`, `target`, `out`, `.next`, `.turbo`, `.cache`, `cache`
- **裁决**：DEFERRED — 合理的默认值，可通过 `.linghunignore` 自定义

#### P2-4: 无 bundled codebase-memory

- **实际状态**：codebase-memory 作为外部 CLI 依赖，通过 env/managed path/PATH fallback 三层解析 (`packages/tui/src/index.ts:8454`)
- **裁决**：DEFERRED — Phase 10 已明确 "不代表 codebase-memory 已随 Linghun 内置"，Phase 15.5C 已补 license/NOTICE

#### P2-5: 无 release artifact

- **实际状态**：项目通过 `pnpm build` + `node` 运行，无 standalone binary
- **裁决**：DEFERRED — release packaging 属于后置 gate (pre-open-source terminal product completion gate)

#### P2-6: `tui/index.ts` 部分模块未拆分（关联 P1-1）

- **裁决**：DEFERRED — 维护性债务，P1-1 的首批拆分计划覆盖后，剩余可后置

#### P2-7: 测试覆盖集中在 focused/mock/local

- **证据**：410 tests 全部为 unit/focused 测试，无真实 provider 集成测试
- **裁决**：DEFERRED — 真实 smoke 本身就是下一步验证；`smoke:live-provider` 和 `smoke:tui-stdin` 脚本存在但需手动设置

---

## 9. What Was NOT Changed

本轮审计加固轮次**按用户明确指令，只重写审计报告，未做任何代码修改**。

| 项目 | 确认方式 | 说明 |
|------|----------|------|
| 源码（packages/*/src/*.ts） | `git diff` — 无修改 | 未改代码 |
| 配置文件（package.json, tsconfig.json, biome.json, pnpm-workspace.yaml） | `git diff` — 无修改 | 未改配置 |
| 测试文件 | `git diff` — 无修改 | 未改测试 |
| 阶段交付文档 | `git diff` — 无修改 | 未改阶段文档 |
| CLAUDE.md / 项目指令文件 | `git diff` — 无修改 | 未改项目指令 |
| 构建产物 | `git status` — 无未跟踪构建产物 | 未生成新构建产物 |
| `.gitattributes` / `.editorconfig` | 仍未添加 | **P1-2 未修复（按用户指令本轮只写报告）** |
| README.md | 仍未更新 | **P1-3 未修复（按用户指令本轮只写报告）** |
| `.gitignore` | 未添加 | 本报告文件为手动管理 |
| 未新增任何代码文件 | `git status --short` — 仅本报告 untracked | 仅 `docs/audit/pre-smoke-comprehensive-audit-2026-05-23.md` |

---

## 10. Validation Commands and Results

### 10.1 运行验证（2026-05-23，加固轮次）

| 命令 | 结果 | 详情 |
|------|------|------|
| `corepack pnpm typecheck` | **PASS** | `tsc -b tsconfig.json` — 零错误 |
| `corepack pnpm build` | **PASS** | apps/cli ESM build 成功 (15.04 KB, 30ms) |
| `corepack pnpm test` | **PASS** | 15 files, 410 tests, 全部 PASS (duration 29.72s) |
| `corepack pnpm check` | **PASS** | biome check — 58 files, No fixes applied (296ms) |
| `corepack pnpm exec linghun --help` | **PASS** | 中文帮助正常输出 |
| `corepack pnpm exec linghun --version` | **PASS** | 0.1.0 |
| `corepack pnpm exec Linghun --version` | **PASS** | Windows 大写兼容 (0.1.0) |
| `git diff --check` | **PASS** | 无 whitespace error |
| `git status --short` | `?? docs/audit/pre-smoke-comprehensive-audit-2026-05-23.md` | 仅本报告 untracked |

### 10.2 测试覆盖明细

| 测试文件 | 测试数 | 结果 |
|----------|--------|------|
| `packages/shared/src/index.test.ts` | 1 | PASS |
| `packages/tui/src/architecture-runtime.test.ts` | 21 | PASS |
| `packages/tui/src/compact-context.test.ts` | 2 | PASS |
| `packages/core/src/project.test.ts` | 3 | PASS |
| `packages/core/src/jsonl.test.ts` | 3 | PASS |
| `packages/tui/src/workspace-reference-cache.test.ts` | 7 | PASS |
| `packages/tui/src/log-artifact.test.ts` | 10 | PASS |
| `packages/core/src/index.test.ts` | 1 | PASS |
| `packages/tui/src/natural-command-bridge.test.ts` | 130 | PASS |
| `packages/core/src/session-store.test.ts` | 4 | PASS |
| `apps/cli/src/main.test.ts` | 7 | PASS |
| `packages/config/src/index.test.ts` | 24 | PASS |
| `packages/tools/src/index.test.ts` | 7 | PASS |
| `packages/providers/src/index.test.ts` | 38 | PASS |
| `packages/tui/src/index.test.ts` | 152 | PASS |
| **总计** | **410** | **全部 PASS** |

### 10.3 未运行验证（及原因）

| 验证项 | 原因 |
|--------|------|
| `smoke:live-provider` | 需要真实 provider API key；不在审计范围内 |
| `smoke:tui-stdin` | 需要交互式 TUI 环境 |
| Real project smoke | 用户尚未确认进入真实项目 smoke |
| E2E / integration tests | 项目当前仅有 unit/focused 测试 |

---

## 11. Final Gate Decision

**当前状态：`AUDIT_HARDENING_REQUIRED`**

不满足 `CONDITIONAL_READY_FOR_REAL_PROJECT_SMOKE` 的条件：
- P1-2 (`.gitattributes`/`.editorconfig`) 和 P1-3 (README.md) 首轮被不当 DEFERRED — scope 极小、风险可控、可验证则修复，首轮 DEFERRED 缺乏正当理由
- P1-1 (tui/index.ts 拆分) 首轮被 DEFERRED 但未给出最小首批拆分计划

**按用户明确指令，本轮只重写审计报告，不改代码。P1-2/P1-3 本轮不执行修复，但不改变其 P1 优先级和必须在真实 smoke 前修复的裁决。**

**升级到 `PENDING_P1_REMEDIATION_BEFORE_REAL_SMOKE` 的条件**：
1. P1-2：添加 `.gitattributes`（`* text=auto` + `*.ts text eol=lf` 等）和 `.editorconfig`
2. P1-3：更新 README.md 当前进度段，反映 Phase 15.5A-F / Phase 16 / Phase 17A/B/C 已完成
3. P1-1：给出最小首批拆分计划（至少确定首批 2-3 个模块 + 拆分时间点）

**升级到 `READY_FOR_USER_DECISION_TO_START_REAL_PROJECT_SMOKE` 的额外条件**：
4. 用户明确确认进入真实项目 smoke

**不进入不代表失败**：当前代码通过全部 410 测试、typecheck、build、lint，核心链路完整真实。审计加固是为了确保进入真实 smoke 前不存在已知可控风险、不存在不当 DEFERRED 的 P1 项。

---

## 12. Next Remediation Batch Proposal

### Batch 0: P1-2 + P1-3（审计报告完成后，smoke 前首次代码变更，< 30 分钟）

**按用户明确指令，以下修复不在本审计轮次执行。审计报告完成后，修复顺序如下：**

1. **P1-2 `.gitattributes`**：
   ```
   * text=auto
   *.ts text eol=lf
   *.js text eol=lf
   *.json text eol=lf
   *.md text eol=lf
   *.yaml text eol=lf
   *.yml text eol=lf
   *.toml text eol=lf
   ```

2. **P1-2 `.editorconfig`**：
   ```
   root = true
   [*]
   indent_style = space
   end_of_line = lf
   charset = utf-8
   trim_trailing_whitespace = true
   insert_final_newline = true
   ```

3. **P1-3 README.md**：更新当前进度段，反映 Phase 15.5A-F / 16 / 17A/B/C 已完成，指向 START_NEXT_CHAT.md 获取最新详情。

### Batch 1: P1-1 首批拆分计划提交（smoke 前，< 1h 纯计划/分析，不写代码）

首批建议拆分（优先级最高、耦合最低）：
1. **Permission pipeline**：`decidePermission()` + 辅助函数 → `packages/tui/src/permission-pipeline.ts`
2. **Slash command router**：`handleSlashCommand()` + dispatch table → `packages/tui/src/slash-command-router.ts`
3. **Model loop**：`sendMessage()` 核心循环 → `packages/tui/src/model-loop.ts`

### Batch 3: P2 deferred items（smoke 中 / smoke 后）

按优先级：P2-1 (webhook_mock cleanup) → P2-6 (剩余拆分) → P2-7 (集成测试) → P2-4 (bundled codebase-memory) → P2-5 (release artifact)

---

## 13. 明确 NOT

- ❌ 不是 Beta PASS
- ❌ 不是 smoke-ready
- ❌ 不是 open-source-ready
- ❌ 不是 `CONDITIONAL_READY_FOR_REAL_PROJECT_SMOKE`（首轮误判，本轮纠正）
- ❌ P1-2/P1-3 首轮被不当 DEFERRED（本轮纠正为 FIX_REQUIRED_BEFORE_SMOKE）
- ❌ P1-2/P1-3 本轮未修复（按用户明确指令只写报告不改代码）
- ❌ 未进入 Phase 18
- ❌ 未提交 commit
- ❌ 未执行真实项目 smoke
- ❌ 未新增第二套系统
- ❌ 未复制第三方源码
- ❌ 未做任何代码修改

---

## 14. Hardened Handoff Packet

```json
{
  "phase": "pre-smoke-comprehensive-audit-hardened",
  "date": "2026-05-23",
  "round": 2,
  "verdict": "AUDIT_HARDENING_REQUIRED",
  "previous_verdict": "CONDITIONAL_READY_FOR_REAL_PROJECT_SMOKE (REJECTED — 证据不足、P1 不当 DEFERRED、git status 不准确)",
  "userConstraint": "本轮只重写审计报告，不改代码、不补 README、不加 .gitattributes/.editorconfig",
  "scope": "加固轮审计：逐项提供源码行号证据、grep 证据、测试入口；纠正 git status；重新裁定 P1 DEFERRED 项",
  "status": {
    "typecheck": "PASS",
    "build": "PASS",
    "test": "PASS (15 files, 410 tests)",
    "lint": "PASS (58 files, biome check)",
    "cli_help": "PASS",
    "cli_version": "PASS (0.1.0)",
    "windows_uppercase": "PASS",
    "git_diff_check": "PASS",
    "git_status": "?? docs/audit/pre-smoke-comprehensive-audit-2026-05-23.md (only this report untracked)"
  },
  "findings": {
    "P0": 0,
    "P1": 3,
    "P1_reclassified_from_DEFERRED": [
      "P1-2 (.gitattributes/.editorconfig): DEFERRED → FIX_REQUIRED_BEFORE_SMOKE",
      "P1-3 (README.md): DEFERRED → FIX_REQUIRED_BEFORE_SMOKE"
    ],
    "P1_not_fixed_this_round_per_user_instruction": ["P1-2", "P1-3"],
    "P2": 7
  },
  "evidence": {
    "source_tables": "5 tables (core chain, security/redaction, anti-duplicate, grep, test coverage)",
    "line_numbers": "> 80 line-number citations across 15+ source files",
    "grep_categories": "10 categories, 0 skipped tests, 0 credential leaks, 0 duplicate systems",
    "validation_commands": "9 commands, all PASS"
  },
  "changedFiles": [],
  "risk": {
    "blocking_smoke": "无 P0",
    "exposure_in_smoke": "P1-1 (15K行大文件), P1-2 (CRLF), P1-3 (README过时)",
    "must_fix_before_smoke": "P1-2, P1-3",
    "must_plan_before_smoke": "P1-1 (首批拆分计划)",
    "post_smoke": "P2 × 7"
  },
  "nextAction": "P1-2 + P1-3 修复后 → PENDING_P1_REMEDIATION_BEFORE_REAL_SMOKE；P1-1 拆分计划提交后 → CONDITIONAL_READY_FOR_REAL_PROJECT_SMOKE (需用户确认)",
  "evidenceRefs": [
    "本报告 (hardened v2, pre-smoke-comprehensive-audit-2026-05-23.md)",
    "packages/tui/src/log-artifact.ts:470-477 (redactLogContent)",
    "packages/tui/src/index.ts:4220-4223 (maskSecret)",
    "packages/tui/src/index.ts:8558-8564 (sanitizeDiagnosticText)",
    "packages/tui/src/index.ts:8566-8570 (redactedPath)",
    "packages/tui/src/index.ts:5137-5148 (redactRemoteSummary)",
    "packages/config/src/index.ts:680-689 (removeSensitiveProjectSettings)",
    "packages/config/src/index.ts:671-677 (atomic write via temp+rename)",
    "packages/providers/src/index.ts:544-556 (retry with exponential backoff)",
    "packages/providers/src/index.ts:1297-1312 (createApiKeyError + sanitize)",
    "packages/tools/src/index.ts:836 (ensureReadBeforeEdit)",
    "全部 11 份阶段交付报告 (Phase 15.5A-F, 16, 17A, 17B, 17C)",
    "全部 5 份审计/研究报告",
    "git status: only this report untracked",
    "10 类 grep 搜索证据",
    "25 项 runtime source evidence",
    "3 层参考核对 (11 阶段 × 参考源 对齐验证)"
  ]
}
```

---

## 15. 参考核对（本轮）

- **本阶段实际读取的 Linghun 文档**：`START_NEXT_CHAT.md`, `README.md`, `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`, `LINGHUN_IMPLEMENTATION_SPEC.md`, `LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`, `docs/delivery/README.md`, `docs/delivery/pre-open-source-terminal-product-completion-gate.md`, `docs/audit/reference-map.md`, 全部 11 份阶段交付文档, 5 份审计/研究报告
- **本阶段实际参考的本地 CCB / 社区项目**：CCB 产品行为（命令习惯、风险边界、验收思路）；CCB Dev Boost 文档（增强能力边界）；OpenCode/Hermes/MCP 生态（成熟优点，未复制源码）
- **行为参考 vs 自研实现**：CCB 交互体验和命令习惯为行为参考；Linghun 全部 TypeScript 源码为自研；未复制可疑源码、内部 API、专有遥测或内部服务逻辑
- **未复制可疑源码**：已确认 25 个核心区域、11 份阶段报告、10 类 grep 搜索均未发现第三方源码复制痕迹

---

*审计加固完成于 2026-05-23。当前状态：AUDIT_HARDENING_REQUIRED — P1-2/P1-3 裁决已从首轮 DEFERRED 纠正为 FIX_REQUIRED_BEFORE_SMOKE（按用户指令本轮只写报告不改代码，修复延至审计报告完成后）；P1-1 需提交首批拆分计划。*
