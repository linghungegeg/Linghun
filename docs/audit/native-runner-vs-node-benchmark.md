# Native Runner V1 vs Node Spawn Benchmark

## 状态

- 性质：Native Local Job Runner V1 旁路 benchmark / Node comparison。
- 范围：只比较 `prototypes/native-runner` 独立原型与当前 Node `child_process.spawn` 路径的同场景表现。
- Runtime 接入：未接入 Linghun runtime。
- 主链路影响：未修改 TUI / provider / permission / evidence / agent / job 主链路。
- 阶段口径：不是 Phase 17A ready，不进入真实 smoke，不宣布 Beta PASS / smoke-ready / open-source-ready。
- 提交口径：本轮不提交 commit。

## Source-of-truth read list

本轮 benchmark 前已读取 / 核对：

- `docs/audit/native-local-job-runner-research.md`
- `docs/delivery/pre-open-source-terminal-product-completion-gate.md`
- `LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `LINGHUN_IMPLEMENTATION_SPEC.md`
- `START_NEXT_CHAT.md`
- `prototypes/native-runner/Cargo.toml`
- `prototypes/native-runner/src/main.rs`

关键约束复核：

- Native runner 仍只是 Phase 17A 候选底座输入。
- 正式接入前仍需 Native-vs-Node benchmark、Windows MSVC/linker 与签名/杀软误报/中文和空格路径矩阵、Unix/macOS process group/session cleanup、managed/bundled runtime、`/doctor runner`、fallback tests、scheduler/evidence/resource guard integration。
- `cancelled / timeout / stale / runner crash` 不得生成 PASS evidence。
- Phase 17A 不能新造第二套 provider/tool/permission/evidence runtime。

## Benchmark environment

| Item | Value |
| --- | --- |
| Date | 2026-05-22 |
| OS | Windows 10 Pro 10.0.19045 (`win32`, `x64`) |
| CPU | 13th Gen Intel(R) Core(TM) i5-13400 |
| Logical CPU count | 16 |
| Memory | 34,119,241,728 bytes |
| Node | v24.14.0 |
| Cargo | cargo 1.95.0 (f2d3ce0bd 2026-03-21) |
| rustc | rustc 1.95.0 (59807616e 2026-04-14) |
| Native binary | `prototypes/native-runner/target/release/linghun-native-runner-prototype.exe` |
| Native protocol | `linghun-native-runner-prototype.v1` |
| Native version | `0.1.0` |
| Benchmark harness | `prototypes/native-runner/bench/native-vs-node-benchmark.mjs` |
| Final benchmark output root | `prototypes/native-runner/bench/.out/2026-05-22T15-41-03-081Z` generated during benchmark; not kept in git because it contains large stdout/stderr artifacts |

Startup checks run before benchmark:

- `git status --short`：clean at benchmark start.
- `C:\Users\Admin\.cargo\bin\cargo.exe --version`：`cargo 1.95.0 (f2d3ce0bd 2026-03-21)`.
- `C:\Users\Admin\.cargo\bin\rustc.exe --version`：`rustc 1.95.0 (59807616e 2026-04-14)`.

## Method

- Native side uses the standalone Rust runner CLI:
  - `start --id <id> --root <root> --timeout-ms <ms> --heartbeat-ms <ms> -- <command>`
  - `status --id <id> --root <root>`
  - `stop --id <id> --root <root>`
- Node side uses a local harness around `child_process.spawn`, stdout/stderr file streams, timeout/cancel timers, and short `state.json` result output.
- Concurrency cases: `N=1/2/4/8`, 3 runs each, same Node workload command for both engines.
- Large-output cases:
  - 10 MiB stdout
  - 10 MiB stderr
  - 100 MiB combined output (50 MiB stdout + 50 MiB stderr)
- Cleanup cases:
  - simple long-running Node process timeout
  - simple long-running Node process cancel
  - `cmd /c` timeout
  - PowerShell timeout
  - Node parent + grandchild timeout
- Path matrix:
  - normal path
  - path with spaces
  - Chinese path
  - deep path
- Responsiveness proxy:
  - native: `status` while N=8 native jobs are running
  - Node: lightweight Node command while N=8 Node jobs are running
- Report tables use relative refs only. Full stdout/stderr body is not copied into this report.

## Baseline health

Commands run:

| Command | Result |
| --- | --- |
| `cargo +stable-x86_64-pc-windows-gnu fmt -- --check` | PASS |
| `cargo +stable-x86_64-pc-windows-gnu clippy -- -D warnings` | PASS |
| `cargo +stable-x86_64-pc-windows-gnu test` | PASS, 12 tests passed |
| `cargo +stable-x86_64-pc-windows-gnu build --release` | PASS |
| `node prototypes/native-runner/bench/native-vs-node-benchmark.mjs` | PASS |

## Raw data: concurrency

| engine | N | run | totalMs | success | failure | timeout | cancelled | protocolBytes | stdoutBytes | stderrBytes | maxJobMs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 1 | 1 | 304.72 | 1 | 0 | 0 | 0 | 317 | 14 | 14 | 303.63 |
| native | 1 | 2 | 224.55 | 1 | 0 | 0 | 0 | 317 | 14 | 14 | 223.91 |
| native | 1 | 3 | 209.97 | 1 | 0 | 0 | 0 | 317 | 14 | 14 | 209.12 |
| native | 2 | 1 | 346.68 | 2 | 0 | 0 | 0 | 634 | 28 | 28 | 332.62 |
| native | 2 | 2 | 316.00 | 2 | 0 | 0 | 0 | 634 | 28 | 28 | 306.81 |
| native | 2 | 3 | 333.52 | 2 | 0 | 0 | 0 | 633 | 28 | 28 | 321.38 |
| native | 4 | 1 | 458.99 | 4 | 0 | 0 | 0 | 1268 | 56 | 56 | 437.09 |
| native | 4 | 2 | 516.01 | 4 | 0 | 0 | 0 | 1268 | 56 | 56 | 510.85 |
| native | 4 | 3 | 493.84 | 4 | 0 | 0 | 0 | 1267 | 56 | 56 | 476.41 |
| native | 8 | 1 | 705.50 | 8 | 0 | 0 | 0 | 2534 | 112 | 112 | 673.32 |
| native | 8 | 2 | 797.92 | 8 | 0 | 0 | 0 | 2534 | 112 | 112 | 772.81 |
| native | 8 | 3 | 777.93 | 8 | 0 | 0 | 0 | 2535 | 112 | 112 | 746.69 |
| node-spawn | 1 | 1 | 140.40 | 1 | 0 | 0 | 0 | 81 | 14 | 14 | 138.69 |
| node-spawn | 1 | 2 | 140.34 | 1 | 0 | 0 | 0 | 81 | 14 | 14 | 139.36 |
| node-spawn | 1 | 3 | 138.31 | 1 | 0 | 0 | 0 | 81 | 14 | 14 | 137.10 |
| node-spawn | 2 | 1 | 150.64 | 2 | 0 | 0 | 0 | 162 | 28 | 28 | 145.25 |
| node-spawn | 2 | 2 | 150.90 | 2 | 0 | 0 | 0 | 162 | 28 | 28 | 143.53 |
| node-spawn | 2 | 3 | 193.48 | 2 | 0 | 0 | 0 | 162 | 28 | 28 | 192.35 |
| node-spawn | 4 | 1 | 185.26 | 4 | 0 | 0 | 0 | 324 | 56 | 56 | 164.30 |
| node-spawn | 4 | 2 | 177.84 | 4 | 0 | 0 | 0 | 324 | 56 | 56 | 161.64 |
| node-spawn | 4 | 3 | 178.87 | 4 | 0 | 0 | 0 | 324 | 56 | 56 | 162.05 |
| node-spawn | 8 | 1 | 249.33 | 8 | 0 | 0 | 0 | 648 | 112 | 112 | 207.99 |
| node-spawn | 8 | 2 | 259.35 | 8 | 0 | 0 | 0 | 648 | 112 | 112 | 207.77 |
| node-spawn | 8 | 3 | 239.71 | 8 | 0 | 0 | 0 | 648 | 112 | 112 | 198.00 |

## Summary data: concurrency

| engine | N | minMs | medianMs | maxMs | meanMs | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 1 | 209.97 | 224.55 | 304.72 | 246.41 | 3 |
| native | 2 | 316.00 | 333.52 | 346.68 | 332.07 | 3 |
| native | 4 | 458.99 | 493.84 | 516.01 | 489.61 | 3 |
| native | 8 | 705.50 | 777.93 | 797.92 | 760.45 | 3 |
| node-spawn | 1 | 138.31 | 140.34 | 140.40 | 139.68 | 3 |
| node-spawn | 2 | 150.64 | 150.90 | 193.48 | 165.01 | 3 |
| node-spawn | 4 | 177.84 | 178.87 | 185.26 | 180.66 | 3 |
| node-spawn | 8 | 239.71 | 249.33 | 259.35 | 249.46 | 3 |

Observations:

- In this harness, Node spawn was faster than native runner at every N level.
- Native runner overhead includes a supervisor process per job, periodic state writes, stdout/stderr drain threads, and terminal JSON state emission.
- This does not disqualify native runner for durability/supervision, but it does not prove a raw speed advantage.

## Large output

| engine | label | status | durationMs | protocolBytes | stdoutBytes | stderrBytes |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| native | stdout-10mb | completed | 282.57 | 326 | 10,485,760 | 0 |
| native | stderr-10mb | completed | 274.19 | 327 | 0 | 10,485,760 |
| native | combined-100mb | completed | 291.04 | 333 | 52,428,800 | 52,428,800 |
| node-spawn | stdout-10mb | completed | 87.79 | 86 | 10,485,760 | 0 |
| node-spawn | stderr-10mb | completed | 82.87 | 86 | 0 | 10,485,760 |
| node-spawn | combined-100mb | completed | 177.73 | 89 | 52,428,800 | 52,428,800 |

Observations:

- Both engines successfully kept large output out of the short protocol result.
- Native protocol result stayed bounded at 326-333 bytes for 10 MiB / 100 MiB cases.
- Node harness protocol result stayed bounded at 86-89 bytes.
- Native was slower than this direct Node harness in all large-output cases.

## Timeout / cancel / process-tree cleanup

| engine | label | mode | status | durationMs | grandchildPidRecorded | grandchildAliveAfterTimeout |
| --- | --- | --- | --- | ---: | --- | --- |
| native | simple | timeout | timeout | 2505.49 | false | null |
| native | simple | cancel | cancelled | 1906.06 | false | null |
| native | cmd | timeout | timeout | 2406.69 | false | null |
| native | powershell | timeout | timeout | 2458.27 | false | null |
| native | node-grandchild | timeout | timeout | 2516.26 | true | false |
| node-spawn | simple | timeout | timeout | 1023.75 | false | null |
| node-spawn | simple | cancel | cancelled | 511.43 | false | null |
| node-spawn | cmd | timeout | timeout | 29097.65 | false | null |
| node-spawn | powershell | timeout | timeout | 1048.33 | false | null |
| node-spawn | node-grandchild | timeout | timeout | 1013.20 | true | false |

Observations:

- Native runner reports `timeout` and `cancelled` as non-PASS terminal states.
- Native runner killed the recorded Node grandchild on Windows (`grandchildAliveAfterTimeout=false`).
- The plain Node harness timed out `cmd`, but total duration stayed close to the `ping` command duration (`~29s`), showing a cleanup weakness when not using process-tree kill for that path.
- Native timeout/cancel latency is currently around timeout/cancel trigger plus the 1s graceful/force cleanup window; this is expected from V1 constants but should be tuned or surfaced if integrated later.
- PowerShell quoting did not fail in this run; it produced a real timeout record.

## Windows path matrix

| engine | label | status | rootRef | stdoutBytes | stderrBytes | stdoutRef | stderrRef |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| native | normal | completed | `prototypes/native-runner/bench/.out/2026-05-22T15-41-03-081Z/paths/normal` | 21 | 21 | stdout.log | stderr.log |
| native | with-spaces | completed | `prototypes/native-runner/bench/.out/2026-05-22T15-41-03-081Z/paths/with spaces` | 26 | 26 | stdout.log | stderr.log |
| native | chinese | completed | `prototypes/native-runner/bench/.out/2026-05-22T15-41-03-081Z/paths/路径-中文` | 22 | 22 | stdout.log | stderr.log |
| native | deep | completed | `prototypes/native-runner/bench/.out/2026-05-22T15-41-03-081Z/paths/deep/aaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbb/cccccccccccccccccccccccc/dddddddddddddddddddddddd` | 19 | 19 | stdout.log | stderr.log |
| node-spawn | normal | completed | `prototypes/native-runner/bench/.out/2026-05-22T15-41-03-081Z/paths/normal` | 25 | 25 | stdout.log | stderr.log |
| node-spawn | with-spaces | completed | `prototypes/native-runner/bench/.out/2026-05-22T15-41-03-081Z/paths/with spaces` | 30 | 30 | stdout.log | stderr.log |
| node-spawn | chinese | completed | `prototypes/native-runner/bench/.out/2026-05-22T15-41-03-081Z/paths/路径-中文` | 26 | 26 | stdout.log | stderr.log |
| node-spawn | deep | completed | `prototypes/native-runner/bench/.out/2026-05-22T15-41-03-081Z/paths/deep/aaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbb/cccccccccccccccccccccccc/dddddddddddddddddddddddd` | 23 | 23 | stdout.log | stderr.log |

Observations:

- Native V1 completed normal, space, Chinese, and deep path cases on this Windows machine.
- Native result refs remained `stdout.log` / `stderr.log`.
- This is useful Windows maturity evidence, but not sufficient for release distribution: MSVC linker, signing, AV false positive, managed runtime, and install-path matrix remain open.

## Responsiveness proxy

| engine | probe | probeMs | probeOk | completed |
| --- | --- | ---: | --- | ---: |
| native | native status during N=8 jobs | 36.53 | true | 8 |
| node-spawn | node light command during N=8 jobs | 77.77 | true | 8 |

Observations:

- Both engines remained responsive under the small N=8 test.
- Native `status` was fast while N=8 native jobs were running.
- This only proves local responsiveness for this harness; it does not prove Linghun TUI responsiveness under real agent/tool workloads.

## Native advantages observed

- Stronger out-of-the-box process-tree behavior for Windows `cmd` timeout than the plain Node spawn harness used here.
- Short JSON protocol remained bounded for large outputs.
- Persistent per-job `state.json` and `stdout.log` / `stderr.log` refs are already aligned with durable-job needs.
- `status` during N=8 native jobs was responsive.
- Timeout/cancel terminal states are explicit and do not look like PASS evidence.
- Space / Chinese / deep paths worked in this local Windows benchmark.

## Node advantages observed

- Direct Node spawn was faster in this harness for N=1/2/4/8.
- Direct Node spawn was faster for 10 MiB stdout, 10 MiB stderr, and 100 MiB combined output.
- Direct Node path has no separate binary packaging, signing, AV, MSVC, or managed-runtime distribution burden.
- Existing Linghun Node runtime already has Resource Guard, background task status, log artifacts, and evidence boundary concepts.

## No obvious difference / inconclusive areas

- Both engines can keep large log bodies out of short protocol output when implemented carefully.
- Both engines can handle simple Node grandchild cleanup in this harness, but the Node result depends on workload behavior and does not cover all shell cases.
- This benchmark does not measure real Linghun agent context loading, model calls, tool scheduling, transcript pressure, or provider latency.
- This benchmark does not prove Unix/macOS process group/session behavior.

## Fallback design evidence matrix

| Failure mode | Required Phase 17A behavior | Current benchmark evidence | Status |
| --- | --- | --- | --- |
| Native binary missing | Fall back to Node runner; surface degraded mode and doctor hint | Harness checks binary presence and fails early; no Linghun adapter exists yet | NOT DONE |
| Protocol mismatch | Fall back to Node runner; mark native unavailable; no PASS evidence from failed native result | V1 protocol is fixed in output; mismatch adapter not implemented | NOT DONE |
| Native crash during start | Fall back to Node runner or mark job failed before evidence use | Not covered by current harness | NOT DONE |
| Native start failure | Fall back to Node runner; show actionable error | Not covered beyond binary presence | NOT DONE |
| Timeout | Terminal state must be `timeout`; no PASS evidence | Covered in native timeout rows | PARTIAL: prototype only |
| Cancel | Terminal state must be `cancelled`; no PASS evidence | Covered in native cancel row | PARTIAL: prototype only |
| Stale heartbeat | Mark stale; no PASS evidence | Existing Linghun docs/runtime cover stale concept; native-vs-node harness did not simulate stale owner | NOT DONE |
| Large output | Logs on disk only; short protocol refs only | Covered by 10 MiB / 100 MiB cases | PARTIAL: prototype only |
| Path with spaces / Chinese / deep path | Must work or fail with actionable diagnostic | Covered on this Windows host | PARTIAL: one-machine evidence |

## Windows maturity conclusion

Native V1 is more mature than V0/V1 hardening baseline for Windows process supervision, especially because it now has measured evidence for:

- N=1/2/4/8 same-scenario runs.
- 10 MiB stdout, 10 MiB stderr, and 100 MiB combined output.
- timeout / cancel terminal states.
- `cmd`, PowerShell, and Node child/grandchild timeout paths.
- normal, space, Chinese, and deep paths.
- bounded JSON result refs.

However, Windows maturity is still not release-grade:

- Validation used GNU Rust toolchain; MSVC linker / Windows SDK environment remains unresolved.
- No signing / AV false positive / install-location matrix exists.
- No managed/bundled runtime packaging exists.
- No Linghun `/doctor runner` exists.
- No runtime fallback adapter exists.

## Should Native continue toward a Phase 17A integration spike?

Recommendation: **continue only as a constrained Phase 17A integration spike candidate, not as a committed replacement for Node spawn.**

Reasoning:

- Native did not win on raw speed in this benchmark.
- Native did show useful supervision/durability traits: persistent state, bounded protocol, relative refs, and stronger Windows process-tree cleanup for the `cmd` case than a plain Node spawn harness.
- The main potential value is not performance; it is durable supervision, recovery, platform-specific process-tree cleanup, and keeping long-running jobs outside the TUI event loop.
- A Phase 17A spike should therefore test adapter/fallback/scheduler/evidence integration, not assume native is faster or automatically better.

Recommended next spike gate, if pursued later:

1. Build a minimal adapter behind existing Node runner semantics; keep Node as default fallback.
2. Add native-missing / protocol-mismatch / crash / start-failure fallback tests.
3. Prove cancelled/timeout/stale never create PASS evidence through Linghun evidence path.
4. Add `/doctor runner` diagnostics before any user-facing default.
5. Re-run benchmark with Linghun-like workloads and resource guard scheduling, not only synthetic spawn tasks.

## Remaining blockers

- No Linghun runtime integration.
- No TUI/job scheduler integration.
- No Resource Guard integration.
- No evidence/review/verifier integration.
- No fallback adapter.
- No stale owner / heartbeat loss benchmark.
- No Unix/macOS process group/session cleanup validation.
- MSVC linker / Windows SDK validation still open.
- Signing / AV false positive / managed runtime distribution still open.
- No `/doctor runner`.
- No release packaging or install/update/rollback story.

## Explicit non-goals confirmed

- This report does not declare Phase 17A ready.
- This report does not declare terminal product ready.
- This report does not enter real full smoke.
- This report does not declare Beta PASS / smoke-ready / open-source-ready.
- This report does not modify Linghun TUI / provider / permission / evidence / agent / job main chain.
- This report does not recommend replacing Node spawn today.
