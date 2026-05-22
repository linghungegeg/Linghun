# Fast Workspace Scanner Feasibility + Design Report

## Status

- 性质：Phase 17A / 后续性能增强旁路研究与成熟设计输入。
- 目标：评估 Linghun 是否需要自研 Fast Workspace Scanner native helper，并明确它与 Workspace Reference Cache、Workspace Snapshot Lite、codebase-memory 的边界。
- 本轮结论口径：这是 feasibility/design report，不是 prototype，不是 runtime 接入，不是 Phase 17A 实现。
- Runtime 接入：未接入 Linghun runtime。
- 主链路影响：未修改现有 TUI / provider / permission / evidence / agent / job / cache / index 主链路。
- 验证口径：本轮不执行真实 smoke，不宣布 ready，不提交 commit。

## Executive verdict

建议：**暂缓直接进入 native scanner runtime；建议在 Native Local Job Runner V1 完成并完成多 agent/job 资源与日志基础验证后，再做 Fast Workspace Scanner V1 prototype。**

原因：

1. 当前 Workspace Reference Cache / Workspace Snapshot Lite 已覆盖 Phase 15.5C++ 的轻量 metadata 边界：bounded stat/hash、top-level summary、ignore sources、changed summary、fallback 和 `/cache status` 摘要。
2. 当前 codebase-memory 已承担 code graph / semantic-ish code search / architecture query / detect_changes 等索引职责，scanner 不应也不能替代它。
3. 现有 TS/Node scanner 的真正瓶颈尚未通过真实大仓 benchmark 证明。当前实现默认只做顶层 metadata 和少量 watched file bounded prefix hash，不是全仓递归扫描。
4. Native scanner 的主要价值在于大仓库、多 agent/job、Project Doctor / Context Picker / Architecture Runtime 共享 filesystem radar 时降低重复 stat/readdir/hash 成本；这个价值在 Phase 17A 并发调度和 durable job 基础成熟后更容易被准确测量。
5. 若现在直接接入 native scanner，会提前引入 cross-platform ignore、Windows long path、symlink loop、AV、packaging size、protocol compatibility、stale cache correctness 等发布风险，而收益还没有被 benchmark 证明。

建议路径：

- 短期：不改现有 WRC / Workspace Snapshot Lite / codebase-memory 主链路。
- Phase 17A 前置：先完成 Native Local Job Runner V1 或等价 process/job supervision 基础，确保多 agent/job 状态、日志、cancel/timeout/stale、fallback 和 doctor 成熟。
- 后续：若大仓 benchmark 显示 TS/Node WRC 或多个 consumer 重复扫描成为 P1/P0 性能瓶颈，再做 isolated V1 prototype。
- V1 prototype 仍应是 optional managed helper；缺失、不兼容、崩溃时 fallback 到 TS/Node WRC。

## Read / source facts checked

本轮实际读取 / 核对：

- `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `START_NEXT_CHAT.md`
- `docs/delivery/phase-15-5a-performance-context.md`
- `docs/delivery/phase-15-5c-plus-plus-workspace-snapshot-lite.md`
- `docs/audit/workspace-snapshot-helper-research.md`
- `packages/tui/src/workspace-reference-cache.ts`
- `packages/tui/src/workspace-reference-cache.test.ts`
- `docs/audit/native-local-job-runner-research.md`

本轮还先运行了 `git status --short`。开工时已有外部未跟踪项：

- `docs/audit/native-local-job-runner-research.md`
- `prototypes/`

本报告不修改这些既有未跟踪项。

codebase-memory 索引状态：`F-Linghun` ready（本轮查询返回 ready，nodes=1609，edges=3157）。索引搜索对具体 WRC 文案无结果后，降级为 targeted source read / Grep 确认。

## Source-Level Reality Check

### 1. 当前 Workspace Reference Cache / Workspace Snapshot Lite 已有能力

源码事实来自 `packages/tui/src/workspace-reference-cache.ts` 与 `workspace-reference-cache.test.ts`：

- `WorkspaceReferenceCache` 是进程内 cache，保存 `latest`、`hits`、`misses`、`failures`。
- `WorkspaceReferenceSnapshot` 保存：
  - `dimensions`: `configHash`、`toolSchemaHash`、`providerModelHash`、`mcpToolListHash`、`indexFreshnessHash`、`compactBoundaryHash`、`extensionListHash`。
  - watched file summaries：relative path、exists、readable、size、mtimeMs、bounded content hash。
  - watched directory summaries：relative path、readable、immediate files count、immediate directories count、entryHash。
  - `runtimeStatus` 短结构。
  - `toolCapabilitySummary`，截断到 2,000 chars。
  - `evidenceRefs` / `logRefs`，sanitize 并限制数量。
  - `workspaceSnapshot` metadata-only summary。
- 默认 watched files：`README.md`、`package.json`、`LINGHUN.md`、`CLAUDE.md`、`.linghun/settings.json`、`.linghunignore`、`.cbmignore`、`.gitignore`。
- 默认 watched directories：`.`、`.linghun`。
- watched file hash 已使用 `open(..., "r")` + `handle.read(...)` 的 bounded prefix read，不再整文件 `readFile` 后 slice。
- Workspace Snapshot Lite 只枚举 project root 顶层 entry；默认 `DEFAULT_TOP_LEVEL_ENTRY_LIMIT = 80`。
- Workspace Snapshot Lite 记录：
  - `schemaVersion: 1`
  - `bounded: true`
  - `partial`
  - limits：top-level entry limit、file hash bytes
  - counts：files / directories / symlinks / other / ignored / storedEntries
  - ignoreSources：`.linghunignore`、`.cbmignore`、`.gitignore` 的 readable / hashPrefix
  - entries：path / kind / size / mtimeMs / hashPrefix / ignoredReason
  - changedSummary：added / modified / deleted / changedKeys
- hard skip dirs 已包含：`.git`、`.linghun/cache`、`.next`、`.turbo`、`.cache`、`build`、`cache`、`coverage`、`dist`、`node_modules`、`out`、`target`。
- ignore 语义是 Lite：只解析非注释、非否定、非 glob 的简单目录/文件名 pattern；不实现完整 gitignore。
- cache hit fast path 会 probe watched files、watched directories、workspaceSnapshot 和 dimensions；匹配时返回 `source: "hit"`。
- scan/probe 失败时返回 `source: "fallback"`，保留上一份 bounded metadata，`changedKeys` 包含 `workspaceReferenceUnavailable`。
- tests 已覆盖：bounded summaries 不重复 full scan、file/runtime invalidation、fallback、directory summary、metadata-only snapshot、ignore boundaries、changed summary、bounded open/read path。

结论：当前已有能力是 **TS/Node metadata-only filesystem snapshot lite**，不是全仓 scanner、不是 persistent DB、不是 native helper、不是 code graph。

### 2. codebase-memory 当前负责什么

根据蓝图、规格书和已完成阶段口径：

- codebase-memory 是 Linghun 的代码图 / 索引 / 架构查询层。
- 负责或应负责：
  - `index_repository`
  - `index_status`
  - `detect_changes`
  - code graph / semantic code search / architecture query
  - `/index status --fresh`、`/index check` 等显式 freshness path
  - 为 Context Picker / Architecture Runtime / Phase 17A 提供 index refs，而不是完整 index result dump
- `/index status` 默认 fast path 不应自动跑重检测或刷新。
- codebase-memory 缺失、不可用或 stale 时，Linghun 应以 unknown/stale/fallback 标记降级，不应让普通 chat 阻塞。
- Workspace Snapshot Lite 只保存 `indexFreshnessHash` / short freshness relation，不保存完整 index graph/result。

结论：codebase-memory 是 **code graph / index intelligence**；Fast Workspace Scanner 最多是 **filesystem radar**，不能替代 index。

### 3. 当前 TS/Node scanner 可能的瓶颈

当前 WRC / Snapshot Lite 默认不递归全仓，因此它本身不是大仓 full scan。潜在瓶颈主要在未来 consumer 增多后出现：

- 顶层 entry 多于 80 时，当前会 partial；若未来需要更深 workspace shape，就要额外扫描。
- Project Doctor / Context Picker / Architecture Runtime / Phase 17A agents 若各自独立用 Node `readdir/stat/hash` 扫描，可能重复 I/O。
- 多 agent/job 同时准备上下文时，如果每个 agent 都独立枚举仓库，会放大 stat/readdir/hash 成本。
- ignore 语义目前是 Lite，不支持完整 gitignore、negation、globstar、nested pattern；复杂 monorepo 可能误判 ignored/source boundary。
- Node 层大量 `stat/lstat/readdir/open/read` 在 50k/100k 文件 metadata scan 场景可能带来 event loop latency 和 RSS 压力。
- Windows 下长路径、中文路径、权限 denied、杀软扫描、symlink/junction 行为，会让 TS/Node fallback path 需要更多防御。
- changed summary 当前只比较 stored top-level entries，不是全仓 changed summary；未来若 Phase 17A 要判断“哪个子树发生变化”，当前 metadata 不够。

### 4. native scanner 能解决什么，不能解决什么

能解决：

- 更快的 large workspace metadata walk：stat / mtime / size / kind / ignored reason。
- Bounded hash 的集中实现：限制 per-file bytes、total bytes、wall time。
- 更低 overhead 的 ignore-aware file listing / large directory detection。
- 统一 changed summary：added / modified / deleted / maybe-renamed hints（仍不等同 Git status）。
- workspace shape summary：top-level dirs、package roots、risk dirs、generated/vendor dirs、large file/dir summaries。
- 多 agent/job 共享 snapshot：N agents 复用一个 snapshot/ref，而不是 N 次重复扫描。
- 可输出短 JSON + cache artifact path，方便 TUI、Project Doctor、Context Picker、Architecture Runtime、Phase 17A 共享。
- 在 Windows/Linux/macOS 上集中处理 path encoding、long path、symlink loops、permission denied 等 filesystem edge cases。

不能解决：

- 不能做 code graph / symbol graph / semantic search / embedding / ranking。
- 不能替代 codebase-memory 的 index、detect_changes、architecture query。
- 不能替代 Git status；scanner changed summary 只能是 filesystem metadata diff，不知道 tracked/untracked/staged/renamed 语义。
- 不能做 LSP、跨语言符号索引、references、definition、diagnostics。
- 不能做 provider/tool/evidence/permission runtime。
- 不能决定是否刷新 index，只能给 Linghun runtime 一个 filesystem freshness signal。
- 不能绕过 Start Gate、permission pipeline、resource guard、evidence verdict。
- 不能保存完整源码、完整日志、完整 transcript、完整 index graph/result、provider raw request、API key/token。
- 不能成为全仓常驻 watcher 或系统服务。

### 5. 哪些职责必须留在 Linghun TUI/runtime 或 codebase-memory

必须留在 Linghun TUI/runtime：

- Start Gate、permission mode、权限审批和高风险动作裁决。
- provider/model route、tool_use/tool_result loop、context builder、compact boundary。
- Resource Guard、Phase 17A scheduler、agent/job 状态、预算、owner/heartbeat、heavy-task mutex。
- Evidence / verification verdict / review scope / claim-check。
- `/cache status`、`/index status`、`/doctor scanner`、Project Doctor、Context Picker、Architecture Runtime 的用户可见输出。
- Scanner availability / version / protocol compatibility / fallback 策略。
- 是否使用 scanner freshness signal 触发 index stale 提醒或建议用户手动 refresh。

必须留在 codebase-memory：

- code graph / semantic-ish search / architecture query。
- `index_repository`、`detect_changes`、index status/freshness。
- symbol/call/import graph 相关查询。
- index artifact 管理和索引过期判断。

必须留在 Workspace Reference Cache / Snapshot Lite：

- 当前 TS/Node fallback implementation。
- process-local bounded metadata summary。
- 作为 TUI prompt/cache freshness 的轻量输入。
- native scanner 缺失或不兼容时的默认可用路径。

## Existing capabilities and gaps

| Area | Current capability | Gap | Scanner relevance | Current recommendation |
| --- | --- | --- | --- | --- |
| Watched file stat/hash | WRC watched files，bounded prefix hash | 只覆盖少量关键文件 | Native 可加速大规模 bounded hash | 现阶段保留 TS/Node |
| Top-level workspace shape | Snapshot Lite 枚举 root 顶层，限制 80 entries | 不递归，不识别 package roots / nested risk dirs | Native 可做 bounded recursive shape | 先 benchmark，不接入 |
| Ignore sources | `.linghunignore` / `.cbmignore` / `.gitignore` prefix + Lite pattern | 不支持完整 gitignore | Native 可集中成熟实现，但风险高 | V1 prototype 才探索 |
| Changed summary | stored top-level entries diff | 不是 full workspace diff，不是 Git status | Native 可做 bounded changed summary | 仅作 filesystem signal |
| Large directory detection | hard-skip common dirs；top-level ignored count | 无深层 large dir/risk dir summary | Native 可输出 largeDir summary | 后续 Project Doctor/17A 可用 |
| Multi-agent sharing | Phase 17A spec 要共享 WRC/codebase-memory/evidence | 尚未有 durable shared scanner artifact | Native 可输出 reusable snapshot ref | 等 17A job基础成熟 |
| code graph | codebase-memory | scanner 不应做 | 不适用 | 不替代 codebase-memory |
| `/cache status` | WRC hits/misses/source + snapshot line | 无 scanner doctor/version | Native 接入后需要 scanner status | 未来 optional |
| `/index status` | 默认 fast，不自动 detect_changes | scanner signal 未接入 index hint | 可建议是否需要 fresh/check | 不自动 refresh |

## Boundary table

| Responsibility | Fast Workspace Scanner | Workspace Reference Cache / Snapshot Lite | codebase-memory | Linghun TUI/runtime |
| --- | --- | --- | --- | --- |
| stat / mtime / size | Yes，V1 核心 | Yes，TS fallback / current lite | No | Consumes summary |
| bounded hash | Yes，V1 核心 | Yes，current watched/top-level files | No | Configures limits |
| ignore source summary | Yes，V1 核心 | Yes，Lite semantics | Uses ignore for index boundaries | Shows summary / warnings |
| changed summary | Yes，filesystem metadata diff | Yes，top-level Lite diff | `detect_changes` for index freshness | Decides user-facing stale action |
| large directory detection | Yes | Limited hard-skip / top-level | No | Project Doctor risk facts |
| workspace shape summary | Yes | Limited top-level shape | No | Context/doctor facts |
| code graph index | No | No | Yes | Queries refs only |
| semantic search | No | No | codebase-memory/search layer | Routes requests |
| symbol graph / LSP | No | No | codebase-memory graph where applicable, LSP future | Not scanner |
| embedding / ranking | No | No | Future separate if ever approved | Not scanner |
| provider/tool/evidence/permission | No | No | No | Yes |
| full watcher / daemon | No | No | No | No by default |
| persistent source DB | No | No | Index artifact only | No full source capture |
| fallback path | N/A | Yes | Missing/stale degrades | Chooses fallback |

## Mature responsibility boundary for Fast Workspace Scanner

V1 scanner should only be a **bounded filesystem metadata helper**.

Allowed V1 responsibilities:

- `stat / mtime / size / kind` for bounded candidate files and directories.
- Bounded file hash:
  - per-file byte limit
  - total hash byte limit
  - wall-time limit
  - never read full source by default
- Ignore source summary:
  - `.linghunignore`
  - `.cbmignore`
  - `.gitignore`
  - hard-skip/generated/vendor rules
  - summary + hash of ignore sources, not full ignored file list
- Changed summary:
  - added / modified / deleted counts
  - changed roots / top dirs
  - freshness marker for scanner snapshot
  - not Git status and not codebase-memory stale verdict
- Large directory detection:
  - known heavy dirs
  - top N largest dirs by entry count/metadata estimate
  - partial marker when bounded scan stops
- Workspace shape summary:
  - package roots / config roots when visible from metadata
  - top-level modules
  - risk dirs and generated/vendor dirs
  - file type counts, capped
- Shared metadata for:
  - Context Picker
  - Project Doctor
  - Architecture Runtime facts
  - Phase 17A agents/jobs

Explicitly not allowed:

- Code graph indexing.
- Semantic search.
- Symbol graph.
- Embedding.
- Ranking.
- LSP.
- Full watcher.
- Provider/tool/evidence/permission runtime.
- Full source/log/index capture.
- System service or daemon.

## Collaboration with codebase-memory

Scanner and codebase-memory should collaborate by clear layering:

1. Scanner = filesystem radar.
   - What changed at metadata level?
   - Which dirs are large/generated/vendor?
   - Which ignore sources exist and changed?
   - Is the workspace shape stable enough for cheap context facts?

2. codebase-memory = code intelligence.
   - What functions/classes/files are relevant?
   - What calls/imports what?
   - What architecture patterns exist?
   - Is the index stale according to its own detect_changes/index metadata?

3. Linghun runtime = decision and presentation.
   - If scanner says filesystem changed and codebase-memory status is old, Linghun may show: “workspace changed; run `/index status --fresh` or `/index refresh` if code graph answers look stale.”
   - Scanner must not auto-refresh codebase-memory.
   - Scanner must not declare index fresh/stale as a final verdict.
   - Scanner signal can become one input to `indexFreshnessHash`, but codebase-memory remains authoritative for index facts.

## Collaboration with Workspace Reference Cache

Future scanner should be an optional managed native source behind current WRC, not a replacement.

Recommended layering:

```text
Linghun TUI/runtime
  -> Workspace Reference Cache API
      -> if scanner ready + compatible: native scanner source
      -> else: current TS/Node WRC + Workspace Snapshot Lite source
  -> codebase-memory refs/status remain separate
```

Rules:

- Keep `packages/tui/src/workspace-reference-cache.ts` as the stable TS fallback boundary.
- Native scanner output must map into the existing `WorkspaceSnapshotLite` / future-compatible metadata shape.
- Missing scanner, incompatible protocol, crash, timeout, permission denied, corrupted output, unsupported platform => fallback TS/Node WRC.
- `/cache status` should show scanner source only as short status: `native-scanner ready` / `fallback-ts` / `incompatible` / `missing`.
- Do not change Phase 15.5C++ completion口径：current TS/Node Workspace Snapshot Lite remains completed as a Lite metadata feature.

## V1 protocol draft

Protocol must be short JSON over process invocation. It must not stream full source/logs into stdout.

### Commands

```text
linghun-workspace-scanner version
linghun-workspace-scanner scan --root <path> --request <request-json-path>
linghun-workspace-scanner diff --root <path> --previous <snapshot-json-path> --request <request-json-path>
linghun-workspace-scanner doctor --root <path>
```

### Version output

```json
{
  "ok": true,
  "name": "linghun-workspace-scanner",
  "version": "0.1.0",
  "protocol": "linghun-workspace-scanner.v1",
  "platform": "win32-x64",
  "features": ["stat", "bounded_hash", "ignore_summary", "changed_summary", "large_dir_summary"],
  "limits": {
    "maxFilesDefault": 10000,
    "maxDepthDefault": 6,
    "maxHashBytesPerFileDefault": 262144
  }
}
```

### Request draft

```json
{
  "protocol": "linghun-workspace-scanner.v1",
  "root": "F:/project",
  "limits": {
    "maxFiles": 10000,
    "maxDepth": 6,
    "maxWallMs": 1500,
    "maxStoredEntries": 2000,
    "maxHashBytesPerFile": 262144,
    "maxTotalHashBytes": 16777216,
    "maxLargeDirs": 20
  },
  "ignore": {
    "sources": [".linghunignore", ".cbmignore", ".gitignore"],
    "hardSkipDirs": [".git", "node_modules", "dist", "build", "coverage", ".linghun/cache"]
  },
  "hashPolicy": {
    "mode": "selected_or_small_files",
    "extensions": [".json", ".md", ".toml", ".yaml", ".yml", ".ts", ".tsx", ".js", ".jsx"],
    "maxFileSizeForHash": 1048576
  },
  "outputPolicy": {
    "includeEntries": true,
    "includeFullPaths": false,
    "includeSourceContent": false,
    "includeSecrets": false
  }
}
```

### Scan result draft

```json
{
  "ok": true,
  "protocol": "linghun-workspace-scanner.v1",
  "schemaVersion": 1,
  "rootHash": "short-root-hash",
  "createdAt": "2026-05-22T00:00:00.000Z",
  "source": "native-scanner",
  "bounded": true,
  "partial": false,
  "limitsHit": [],
  "counts": {
    "files": 1234,
    "directories": 120,
    "symlinks": 2,
    "other": 0,
    "ignored": 54000,
    "hashedFiles": 240,
    "storedEntries": 1200
  },
  "ignoreSources": [
    { "path": ".linghunignore", "readable": true, "hashPrefix": "abc123" },
    { "path": ".cbmignore", "readable": false },
    { "path": ".gitignore", "readable": true, "hashPrefix": "def456" }
  ],
  "workspaceShape": {
    "topLevelDirs": ["packages", "docs", "scripts"],
    "packageRoots": [".", "packages/tui", "packages/core"],
    "riskDirs": ["generated", "fixtures/large"],
    "largeDirs": [
      { "path": "node_modules", "reason": "ignored", "estimatedEntries": 50000 },
      { "path": "dist", "reason": "ignored", "estimatedEntries": 1200 }
    ],
    "fileTypeCounts": [
      { "extension": ".ts", "count": 420 },
      { "extension": ".md", "count": 80 }
    ]
  },
  "entriesRef": ".linghun/cache/workspace-scanner/scan-abc.entries.jsonl",
  "summaryHash": "summary-hash",
  "warnings": [],
  "errors": []
}
```

### Diff result draft

```json
{
  "ok": true,
  "protocol": "linghun-workspace-scanner.v1",
  "schemaVersion": 1,
  "previousSummaryHash": "old",
  "currentSummaryHash": "new",
  "changedSummary": {
    "added": 4,
    "modified": 12,
    "deleted": 1,
    "changedTopLevelDirs": ["packages", "docs"],
    "ignoreSourcesChanged": false,
    "largeDirsChanged": false,
    "changedKeys": ["workspaceScannerModified", "workspaceScannerDeleted"]
  },
  "currentSnapshotRef": ".linghun/cache/workspace-scanner/scan-new.json",
  "partial": false,
  "warnings": []
}
```

### Protocol safety rules

- stdout returns only one short JSON object.
- Large entries go to `entriesRef` under Linghun-managed cache.
- Entries are metadata-only JSONL; no full source content.
- All paths in user-visible summaries are relative unless doctor/debug explicitly needs sanitized absolute path.
- Scanner must cap warnings/errors and never dump raw OS errors containing secrets.
- Scanner must include `protocol` and `schemaVersion`; incompatible protocol triggers fallback.

## One-command install / managed runtime route

Recommended distribution if V1 prototype graduates:

1. Optional platform packages:
   - `@linghun/workspace-scanner-win32-x64`
   - `@linghun/workspace-scanner-linux-x64`
   - `@linghun/workspace-scanner-darwin-arm64`
   - `@linghun/workspace-scanner-darwin-x64` if needed
2. Bundled / managed runtime:
   - Linghun resolves scanner only through internal resolver.
   - Do not require user to install Rust/Go.
   - Do not require users to download exe manually.
   - Do not require PATH configuration.
   - Do not start a system service.
3. One-command user path:
   - Normal install/update of Linghun brings optional scanner package when available.
   - `/doctor scanner` tells the user whether native scanner is ready or TS fallback is active.
4. Runtime source labels:
   - `optional-package`
   - `bundled`
   - `project-local` only if explicitly trusted
   - `missing`
   - `fallback-ts`
   - `incompatible`
5. Version/protocol compatibility:
   - scanner `version` returns `{ version, protocol, platform, features }`.
   - Linghun adapter pins supported protocol range.
   - incompatible => fallback TS/Node and doctor warning.

Example `/doctor scanner` output shape:

```text
Scanner: fallback-ts
Native helper: missing
Protocol: expected linghun-workspace-scanner.v1
Fallback: using TS/Node Workspace Snapshot Lite
Next: no action required; native scanner is optional
```

## Fallback scheme

Fallback must be boring and safe:

| Failure | Linghun behavior |
| --- | --- |
| Native package missing | Use current TS/Node WRC / Snapshot Lite |
| Unsupported platform | Use TS/Node fallback |
| Version/protocol mismatch | Use TS/Node fallback; `/doctor scanner` shows incompatible |
| Scanner exits non-zero | Use TS/Node fallback; increment scanner failure metric |
| Scanner timeout | Use TS/Node fallback; mark scanner stale/timeout, not cache PASS |
| Corrupted JSON | Ignore native output; use TS/Node fallback |
| Permission denied in subtree | Scanner returns partial warning; Linghun can still use bounded summary |
| Cache artifact corrupted | Rebuild or fallback; never use stale artifact as fresh silently |
| Scanner finds large/unsafe dirs | Surface summary; do not auto-index or auto-read |

Fallback must preserve current behavior:

- `/cache status` remains useful.
- `/index status` remains fast by default.
- codebase-memory remains optional/managed index layer.
- provider/tool/permission/evidence runtime unchanged.
- No user-visible blocker if scanner is absent.

## Benchmark / stress design

Benchmark must run before any runtime integration decision. It should compare current TS/Node WRC / Snapshot Lite with native scanner prototype.

### Project sizes

| Dataset | Shape | Purpose |
| --- | --- | --- |
| Small project | 500-2k files | Ensure native does not regress normal repos |
| Medium project | 10k files | Detect useful improvement threshold |
| Large repo | 50k files | Validate bounded scan and ignored dirs |
| Very large repo | 100k files | Stress metadata scan, partial behavior, memory |

### Directory scenarios

- Root package + `packages/*` monorepo.
- Heavy ignored dirs: `node_modules`、`dist`、`build`、`.git`、`.cache`、`.linghun/cache`、`coverage`、`target`。
- Large generated trees under nested dirs.
- Many small files vs fewer large files.
- Chinese paths, spaces, Windows long paths.
- Symlink / junction loops.
- Permission denied subtrees.

### Measurements

- Cold metadata scan wall time.
- Warm snapshot diff wall time.
- RSS / peak memory.
- CPU time where available.
- Event loop blocking for TS/Node path.
- Entries stored and partial markers.
- Errors/warnings count.
- Cache artifact size.
- `/cache status` latency after snapshot exists.
- `/doctor scanner` latency.

### Specific benchmark cases

1. 10k / 50k / 100k files metadata scan.
2. Ignored dirs with `node_modules/dist/build/.git/cache` should be collapsed/skipped.
3. Bounded hash cost:
   - no hash
   - 4 KiB prefix
   - 256 KiB prefix
   - total hash budget reached
4. Changed summary cost:
   - no changes
   - 100 modified files
   - 1000 modified files
   - ignore file changed
5. Multi-agent sharing:
   - N=1/2/4/8 agents each prepares context independently with TS/Node
   - N agents reuse one native scanner snapshot/ref
   - measure total wall time, total filesystem operations, duplicated scans avoided
6. Failure stress:
   - symlink loop
   - permission denied
   - scanner timeout
   - corrupted cache artifact
   - antivirus-like slow file reads on Windows

### Acceptance threshold for considering runtime integration

Native scanner must show at least one of these material wins without introducing correctness risk:

- Large repo scan/diff at least 2x faster than TS/Node at 50k+ files under equivalent limits.
- TS/Node path visibly blocks TUI/event loop in benchmark but native helper does not.
- Multi-agent N>=4 context prep avoids repeated scans and cuts total filesystem scan time by at least 50%.
- Windows path / symlink / permission denied handling is more stable than TS fallback.
- Cache artifact remains small and metadata-only.

If native wins are marginal, keep TS/Node.

## Phase 17A / later integration recommendation

Recommended integration timing:

1. Finish or stabilize Native Local Job Runner V1 / process supervisor first.
   - Reason: scanner is most valuable when multiple local jobs/agents need shared metadata.
   - Runner/job foundation should already know how to manage subprocesses, logs, timeouts, stale state, fallback and doctor.
2. Add scanner as optional dependency only after benchmark proves value.
3. Expose scanner through WRC API, not as a new product subsystem.
4. Project Doctor / Context Picker / Architecture Runtime consume short facts/refs from WRC/scanner snapshot.
5. Phase 17A agents receive only snapshot refs / project facts / codebase-memory refs / evidence refs.
6. Agents must not each run private full scans.
7. Scanner signal may help decide whether to suggest `/index status --fresh` or `/index refresh`, but runtime must not auto-refresh index.

Suggested Phase 17A usage:

```text
User starts multiple agents/jobs
  -> scheduler checks shared workspace snapshot freshness
  -> if fresh: pass snapshot ref + project facts to agents
  -> if stale/missing: one bounded scanner refresh under resource cap
  -> agents receive refs/summaries, not full file list/source
  -> codebase-memory remains source for code graph queries
```

## When V1 prototype is worth doing

Do V1 prototype only if at least one condition is true:

- Real large-repo smoke or synthetic benchmark shows repeated workspace metadata scanning is a top latency source.
- Phase 17A multi-agent/job context prep duplicates WRC/Grep/Glob/stat work across agents.
- Project Doctor / Context Picker / Architecture Runtime need richer workspace shape facts than current top-level Snapshot Lite and TS implementation becomes slow under bounded recursive scan.
- Windows large repo behavior with TS/Node is unstable or blocks TUI responsiveness.
- Native Local Job Runner V1 has already established managed binary packaging/doctor/fallback patterns that scanner can reuse.

## When V1 prototype is not worth doing

Do not do V1 prototype if any of these are true:

- No benchmark shows TS/Node WRC / Snapshot Lite bottleneck.
- Use case can be solved by codebase-memory query, Git/ripgrep command, or targeted Read/Grep/Glob.
- Scanner design starts including code graph, semantic search, ranking, symbol graph, embedding, LSP or provider/tool/evidence logic.
- It requires users to install Rust/Go, manually download exe, configure PATH, or start a service.
- Optional package / bundled managed runtime cannot be made reliable.
- Fallback TS/Node path cannot preserve current behavior.
- Native packaging/signing/AV/size risk exceeds measured performance benefit.
- It would require modifying current Phase 15.5C++ completion口径 or replacing codebase-memory.

## Risks and mitigations

| Risk | Detail | Mitigation |
| --- | --- | --- |
| Cross-platform ignore semantics | `.gitignore` semantics differ; negation/globstar/nested patterns are easy to get wrong | V1 labels semantics as bounded summary; use mature ignore crate/library if native prototype proceeds; fallback to conservative unknown/partial |
| Windows long path / encoding | `MAX_PATH`, UNC, Chinese paths, spaces, case-insensitivity | Benchmark Windows first; use relative paths in output; never require PATH install |
| Symlink / junction loops | Recursive scan can loop or escape root | Track visited inode/file IDs where possible; never follow symlink dirs by default; cap depth/time |
| Antivirus / slow I/O | Native exe and mass stat/read can trigger AV latency | Keep optional; sign binaries if published; cap wall time; fallback TS |
| Permission denied | Some dirs/files unreadable | Return partial warning; do not fail whole scan unless root unreadable |
| Packaging size | Per-platform binaries increase install size | Optional packages; no install script compile; doctor explains fallback |
| Stale cache correctness | Old snapshot may mislead doctor/context | Every snapshot has createdAt, rootHash, schemaVersion, summaryHash, partial/stale markers; never treat stale as fresh silently |
| Accidental full source capture | Scanner could persist entries or hashes too broadly | Metadata-only schema; no content field; bounded hash only; security tests grep cache artifacts |
| Full log/index capture | Artifact refs could accidentally include raw logs/index | Scanner owns only filesystem metadata; no transcript/log/index inputs |
| Product scope creep | Scanner becomes second index/LSP/search engine | Hard not-do list and protocol review before prototype |
| Resource contention | Scanner competes with build/test/index | Run under Resource Guard / job cap when integrated; no full watcher |
| False confidence | Filesystem clean does not mean codebase-memory fresh | Scanner output is only filesystem signal; index freshness remains codebase-memory |

## Security / privacy boundaries

Scanner output must not contain:

- full source file contents
- full log contents
- full transcript
- full index graph/result
- provider raw request/response
- API keys/tokens/private headers
- environment variable dumps
- unbounded file lists in main screen

Allowed outputs are bounded metadata and refs:

- relative path
- kind
- size
- mtimeMs
- short bounded hash prefix
- ignored reason
- counts
- summary hashes
- cache artifact refs
- capped warnings/errors

## Implementation touch points if approved later

If V1 prototype is approved later, minimal touch points should be:

- New isolated prototype directory or native package workspace only after explicit approval.
- A small scanner resolver/adapter module in TUI or shared package.
- WRC source selection behind existing API.
- `/doctor scanner` or Project Doctor section.
- Focused tests for resolver, protocol compatibility, fallback, metadata-only output, and no source capture.

Avoid touching unless necessary:

- provider/model runtime
- permission pipeline
- evidence verdict writer
- codebase-memory runtime internals
- agent/job scheduler before Phase 17A
- package/workspace/build config before explicit prototype phase

## Explicit non-goals / non-completion statements

This report explicitly states:

- 未写 prototype。
- 未新增 native/binary/prototype 代码。
- 未接入 Linghun runtime。
- 未修改 `packages/tui/src/workspace-reference-cache.ts`。
- 未修改 `/cache status`、`/index status` 或 codebase-memory runtime。
- 未修改 package/workspace/build 配置。
- 未修改现有 TUI / provider / permission / evidence / agent / job / cache / index 主链路。
- 未替代 codebase-memory。
- 未做语义检索、符号索引、embedding、ranking、LSP、全仓常驻 watcher。
- 未把 scanner 写成当前必做 runtime。
- 未要求用户未来手动安装 Rust/Go、下载 exe、配置 PATH 或启动系统服务。
- 不是 Phase 17A 完成。
- 不是 smoke-ready。
- 不是 open-source-ready。
- 未执行真实 smoke。
- 未提交 commit。

## Final recommendation

**建议等 Native Local Job Runner V1 完成后，再做 Fast Workspace Scanner V1 prototype。**

更具体地说：

- 如果 Native Local Job Runner V1 证明 Linghun-managed native binary 的 packaging、doctor、protocol compatibility、fallback、Windows 行为和日志/状态边界都可控，scanner 可以复用这套成熟路径，风险会显著下降。
- 如果 Runner V1 自身在 packaging/AV/protocol/fallback 上成本过高，则 scanner 更不应贸然 native 化。
- scanner prototype 的进入条件应是 benchmark 和 Phase 17A 真实共享需求，而不是“native 可能更快”的直觉。

当前最稳妥口径：**保持 TS/Node Workspace Snapshot Lite 作为默认；把 Fast Workspace Scanner 作为 post-runner、benchmark-gated、optional managed native helper 候选。**
