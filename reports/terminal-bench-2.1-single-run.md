# Linghun Terminal-Bench 2.1 Single-Run Report

> This is a public summary of a local full-dataset run. It is not an official leaderboard entry.

## Result

| Item | Value |
| --- | --- |
| Agent / system | Linghun |
| Model | GPT-5.5 |
| Dataset | Terminal-Bench 2.1 (`terminal-bench/terminal-bench-2-1`) |
| Scope | Official 89 tasks, one trial per task |
| Score | 65 / 89 |
| Pass rate | 73.03% |
| Commit | `f09f1319` |
| Runtime | Harbor 0.13.2 |
| Endpoint profile | responses |
| Inference level | High |
| Concurrency | 3 |
| Agent timeout multiplier | 2.0 |
| Verifier timeout multiplier | 1.0 |

## Important Notes

This run was performed in a real local development environment rather than as a leaderboard-formatted `k=5` submission run.

Harbor static leaderboard validation requires at least five trials per task, standard timeout/resource settings, and complete passing-trial trajectories. This single-run result therefore should be read as a real-environment engineering stress test, not as an accepted official ranking.

Two trials received passing reward but required manual recovery after a post-final agent hang so the batch runner could continue:

- `install-windows-3.11`
- `mailman`

The final heavy tasks were inspected for CPU/resource contention. They were doing real compute, not post-final hangs. No manual cancellation was used for those tasks.

## Batch Summary

| Batch | Completed | Pass | Fail | Errored |
| --- | ---: | ---: | ---: | ---: |
| 1 | 10 | 8 | 2 | 0 |
| 2 | 10 | 7 | 3 | 1 |
| 3 | 10 | 5 | 5 | 0 |
| 4 | 10 | 9 | 1 | 1 |
| 5 | 10 | 9 | 1 | 1 |
| 6 | 10 | 8 | 2 | 1 |
| 7 | 10 | 9 | 1 | 0 |
| 8 | 10 | 5 | 3 | 2 |
| 9 | 9 | 5 | 4 | 2 |

## Failure Categories

| Category | Count |
| --- | ---: |
| Verifier failed | 18 |
| NonZeroAgentExitCodeError | 5 |
| RuntimeError | 2 |
| AgentTimeoutError | 1 |

## Interpretation

This result is useful because it covers the whole official Terminal-Bench 2.1 task set in one real local run, including long-running, service, QEMU, ML, binary, build, and polyglot tasks.

It shows that Linghun can complete a full official dataset pass in a practical development environment, while also exposing the next engineering work needed for official leaderboard submission:

- support official `k=5` run mode cleanly;
- use standard timeout/resource settings for leaderboard runs;
- preserve and upload complete passing-trial trajectories;
- further tighten post-final process cleanup.

Public wording should be: Linghun locally completed a full single-run Terminal-Bench 2.1 evaluation with 65/89 pass rate, 73.03%. It has not yet been accepted as an official leaderboard ranking.
