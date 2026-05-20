# Phase 15 Pre-Beta Non-Real-Test Completeness Audit Reconciliation

> 日期：2026-05-20  
> 范围：基于最终 cleanup 报告、当前 P15-A4 provider request identity 修复 diff / 验证结果，以及 `phase-15-pre-beta-non-real-test-completeness-audit.md`，对 P15-A1 到 P15-A8 做最终对账。  
> 约束：不把 cleanup PASS 或 P15-A4 closure PASS 等同于 Beta readiness PASS；不自动进入 Phase 15 Beta / 15.5 / 16+。

## VERDICT: PARTIAL / NOT BETA READINESS PASS

本次 reconciliation 结论：runtime artifact cleanup 已闭合 P15-A8；P15-A4 Provider / gateway request identity 已完成最小修复并闭合；MCP/deferred guard 与 Beta verdict evidence guard 有新增证据。

当前 P15-A1 到 P15-A8 已无 remaining BLOCKING，但仍有 5 项 PARTIAL 与 1 项 DEFERRED。因此，本报告不声明 Phase 15 Beta readiness PASS。是否开始 Phase 15 real-project Beta decision 仍必须由用户显式确认，且 decision 必须纳入 remaining PARTIAL / DEFERRED 风险。

## 1. 输入证据

### 1.1 已读取/对照文件

- `docs/audit/phase-15-pre-beta-runtime-artifact-decision-guard-cleanup-report.md`
- `docs/audit/phase-15-pre-beta-non-real-test-completeness-audit.md`
- `packages/providers/src/index.ts`
- `packages/providers/src/index.test.ts`
- `packages/providers/package.json`
- `packages/providers/tsconfig.json`
- `pnpm-lock.yaml`

### 1.2 当前索引与工作区状态

- codebase-memory project：`F-Linghun`
- index status：`ready`，nodes=`1280`，edges=`2318`
- `detect_changes(project=F-Linghun)`：changed files 覆盖本轮 P15-A4 最小修复：
  - `packages/providers/package.json`
  - `packages/providers/src/index.test.ts`
  - `packages/providers/src/index.ts`
  - `packages/providers/tsconfig.json`
  - `pnpm-lock.yaml`

### 1.3 cleanup 报告中的验证结果

最终 cleanup 报告记录以下验证为 PASS：

- `mcp__codebase-memory-mcp__index_status(project=F-Linghun)`：ready
- `mcp__codebase-memory-mcp__detect_changes(project=F-Linghun)`：发现当时工作区 changed files
- `corepack pnpm check`
- `corepack pnpm typecheck`
- `corepack pnpm test -- --run packages/tui/src/index.test.ts apps/cli/src/main.test.ts packages/providers/src/index.test.ts`
- `corepack pnpm test`
- `corepack pnpm build`
- `git diff --check`

本 reconciliation 没有把这些 PASS 扩大解释为 Beta readiness PASS。

### 1.4 P15-A4 最小修复验证结果

P15-A4 修复后已运行并通过：

- `corepack pnpm exec vitest run packages/providers/src/index.test.ts`
  - PASS：1 file / 28 tests passed
- `corepack pnpm check`
  - PASS：Checked 47 files，No fixes applied
- `corepack pnpm typecheck`
  - PASS：`tsc -b tsconfig.json` clean

## 2. 特别复核结论

### 2.1 P15-A8 hardcoded artifact sweep

**结论：DONE。**

cleanup 报告已给出足够闭合证据：

- runtime 搜索范围覆盖：
  - `apps/cli/src`
  - `packages/tui/src`
  - `packages/providers/src`
- runtime 用户可见代码中未发现：
  - `Phase 15 preflight`
  - `DEPLOY_REPORT.md`
  - `PHASE15_RC`
  - `Gate F`
  - 私有 gateway 域名
- 私有 gateway 字符串未在 runtime 代码中出现。
- `Phase 13` / `Phase 14` 剩余命中仅在测试描述或历史断言中，属于允许保留的 tests 范围。
- 固定模型 / provider / base_url 类剩余命中被限定为 provider 默认配置或测试数据，不再是 Gate F smoke runtime 文案。
- `MODEL_BASE_URL_MISSING` 建议已从固定 DeepSeek URL 改成让用户设置当前 provider 兼容的 `base_url` 并运行 `/model doctor` 复查。
- key leakage check 未发现真实 API key 泄漏。

因此，原始 audit 中 P15-A8 的 BLOCKING 已由 runtime cleanup 闭合。

### 2.2 P15-A4 Provider / gateway request identity

**结论：DONE。**

当前 `packages/providers/src/index.ts` 已在 provider request path 中加入最小安全 Linghun identity headers：

```ts
const LINGHUN_REQUEST_PACKAGE_NAME = `@linghun/${LINGHUN_CLI_NAME}`;
const LINGHUN_REQUEST_IDENTITY_HEADERS = {
  "User-Agent": `${LINGHUN_NAME}/${LINGHUN_VERSION} (${LINGHUN_REQUEST_PACKAGE_NAME})`,
  "X-Title": LINGHUN_NAME,
  "X-OpenRouter-Title": LINGHUN_NAME,
};
```

实际 fetch headers 保持原有 auth，同时加入 identity headers：

```ts
headers: {
  "content-type": "application/json",
  ...LINGHUN_REQUEST_IDENTITY_HEADERS,
  authorization: `Bearer ${this.config.apiKey}`,
},
```

复核结论：

- `User-Agent` 由 `@linghun/shared` 的 `LINGHUN_NAME`、`LINGHUN_VERSION`、`LINGHUN_CLI_NAME` 派生，不再硬编码版本字符串。
- `X-Title` / `X-OpenRouter-Title` 使用 `LINGHUN_NAME`，不再手写产品名。
- 未设置 / 未伪造 `HTTP-Referer`，因为当前没有已有公开项目 URL 配置。
- 未引入 provider 绑定或 gateway 绑定；OpenAI-compatible 与 DeepSeek 共享同一 provider request path。
- `@linghun/shared` dependency 是必要且最小的：providers 包需要读取既有共享产品名、版本、CLI 名称常量；对应只新增 workspace dependency、TypeScript project reference 与 lockfile importer 记录。
- 测试 expected value 使用同一组 shared constants 生成，不再写死 `Linghun/0.1.0 (@linghun/cli)`。

泄漏边界：

- `authorization` 仍可存在于真实 request headers，这是 provider auth 必需字段。
- 测试将 public/sanitized identity headers 与 `authorization` 分离检查。
- 新增 tests 验证 public/sanitized identity headers 不包含：
  - `sk-`
  - `api_key`
  - Authorization value
  - 本地路径
  - project path
  - user home
  - prompt content
  - private baseUrl query

因此，原始 audit 中 P15-A4 的 BLOCKING 已由本轮最小 provider request identity 修复闭合。

## 3. P15-A1 到 P15-A8 reconciliation 状态

| ID | Area | 原状态 | Reconciled status | 是否阻塞 Phase 15 real-project Beta | 结论 |
| --- | --- | --- | --- | --- | --- |
| P15-A1 | Agent / multi-agent lifecycle | PARTIAL | PARTIAL | 否，除非宣称成熟 multi-agent | minimal synchronous agent/fork baseline 仍存在；未新增成熟并发 agent lifecycle / adoption / conflict / durable budget 证据。 |
| P15-A2 | Learning / Memory / Skill evolution | PARTIAL | PARTIAL | 否，作为 Phase 16 前置边界 | manual memory candidate baseline 仍可用；完整 controllable learning lifecycle 仍应留到 Phase 16。 |
| P15-A3 | MCP / Skills / Plugins Connect Lite | PARTIAL | PARTIAL | 否，当前 guard gap 已降低风险 | codebase-memory deferred guard 已新增并测试；但完整 MCP/skills/plugins install/update/source/OAuth lifecycle 仍未完成。 |
| P15-A4 | Provider / gateway request identity | BLOCKING | DONE | 否 | provider request path 已设置由 shared constants 派生的安全 Linghun identity headers；未伪造 HTTP-Referer；targeted tests 覆盖 non-leakage。 |
| P15-A5 | TUI / help / doctor / hints / output polish | PARTIAL | PARTIAL | 否，除非 help/doctor 再出现 stale Beta PASS 或 runtime artifact | cleanup 已清理多处 runtime wording；但 narrow terminal、doctor actionability、long-output evidence 等 polish 未完整重验。 |
| P15-A6 | Provider / model / usage / cache / quota | PARTIAL | PARTIAL | 否，除非宣称真实 quota/billing | provider/profile/cache/usage source labels 有 baseline；真实 quota/balance / billing source 仍不能宣称完成。 |
| P15-A7 | Freshness / Web evidence | DEFERRED | DEFERRED | 否，除非 Beta 材料宣称 latest/current 外部事实 | Freshness Gate runtime workflow 仍是 Phase 15.5 边界；当前只要求不作无来源“最新/current”断言。 |
| P15-A8 | Hardcoded artifact sweep | BLOCKING | DONE | 否 | runtime artifact cleanup、hardcoded sweep、Beta verdict guard、key leakage check 已给出闭合证据。 |

## 4. 已闭合 gap

### P15-A4 Provider / gateway request identity

- 从 BLOCKING 降为 DONE。
- 闭合证据来自 provider request path 的 identity headers、shared constants 派生、无 `HTTP-Referer` 伪造、targeted tests 与 check/typecheck 结果。
- 该闭合只代表 P15-A4 closure PASS，不代表 Beta readiness PASS。

### P15-A8 runtime artifact / hardcoded sweep

- 从 BLOCKING 降为 DONE。
- 闭合证据来自 cleanup 报告中的 runtime 源码搜索、文案替换、provider missing base_url 建议调整、key leakage check、测试/build/check 结果。
- 该闭合只代表 runtime artifact cleanup PASS，不代表 Beta readiness PASS。

### P15-A3 的一部分 MCP/deferred guard gap

- codebase-memory deferred tool 已有 discovery/schema/required-args guard。
- 已覆盖：unknown tool 拒绝、missing required args 拒绝、`get_code_snippet` 缺 `qualified_name` 拒绝、合法参数通过。
- 但 P15-A3 整体仍是 PARTIAL，因为完整 MCP/skills/plugins ecosystem lifecycle 仍未闭合。

### Beta verdict evidence guard 相关风险

- `/claim-check Beta readiness is PASS` 不再因任意 Write evidence 直接 PASS。
- PASS 需要 real TUI report-generation path、dual-provider evidence、report Write evidence、final answer reference、无 SKIPPED/PARTIAL/BLOCKED blocking gate 等多个维度。
- 这降低了误判 Beta PASS 的风险，但不构成 Beta readiness PASS。

## 5. 仍阻塞 Phase 15 real-project Beta 的问题

| ID | Blocking reason | 最小闭合边界 | 验证边界 |
| --- | --- | --- | --- |
| 无 | 当前 P15-A1 到 P15-A8 没有 remaining BLOCKING。 | 不适用。 | 不适用。 |

## 6. Remaining PARTIAL / DEFERRED 风险

| ID | Status | Remaining risk |
| --- | --- | --- |
| P15-A1 | PARTIAL | minimal synchronous agent/fork baseline 不能宣称成熟 multi-agent lifecycle。 |
| P15-A2 | PARTIAL | manual memory candidate baseline 不能宣称完整 controllable learning loop。 |
| P15-A3 | PARTIAL | codebase-memory guard 已闭合局部风险，但完整 MCP/skills/plugins ecosystem lifecycle 未完成。 |
| P15-A5 | PARTIAL | TUI/help/doctor/output polish 未完整重验。 |
| P15-A6 | PARTIAL | usage/cache/provider baseline 存在，但真实 quota/balance/billing source 不能宣称完成。 |
| P15-A7 | DEFERRED | Freshness Gate runtime workflow 仍是 Phase 15.5 边界。 |

## 7. 统计

仅统计 P15-A1 到 P15-A8：

| Status | Count |
| --- | ---: |
| DONE | 2 |
| DOC-ONLY | 0 |
| PARTIAL | 5 |
| BLOCKING | 0 |
| DEFERRED | 1 |
| NOT-DO | 0 |

## 8. Phase 15 real-project Beta decision

**是否可以进入 Phase 15 real-project Beta decision：可以进入 decision review，但不能声明 Beta readiness PASS，且不能自动开始 Beta。**

理由：

- P15-A1 到 P15-A8 当前 remaining BLOCKING 为 0。
- 仍有 5 项 PARTIAL 与 1 项 DEFERRED，必须在 Beta decision 中显式接受、降级或补证。
- Beta readiness PASS 还需要 Beta decision gate 证据齐全，尤其是最终用户确认、真实项目 Beta 范围、风险接受记录、验证证据引用与 no auto-advance 边界。

因此，本报告只支持进入 **Phase 15 real-project Beta decision review**，不支持直接宣称 **Phase 15 Beta readiness PASS**，也不自动进入 Phase 15 Beta / 15.5 / 16+。
