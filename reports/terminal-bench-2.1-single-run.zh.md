# Linghun Terminal-Bench 2.1 单次完整压测报告

> 这是一次本地完整数据集运行的公开摘要，不是官方排行榜已收录成绩。

## 结果

| 项目 | 数值 |
| --- | --- |
| Agent / System | Linghun |
| Model | GPT-5.5 |
| Dataset | Terminal-Bench 2.1 (`terminal-bench/terminal-bench-2-1`) |
| 范围 | 官方 89 题，每题 1 次 |
| 分数 | 65 / 89 |
| 通过率 | 73.03% |
| Commit | `f09f1319` |
| Runtime | Harbor 0.13.2 |
| Endpoint profile | responses |
| Inference level | High |
| 并发 | 3 |
| Agent timeout multiplier | 2.0 |
| Verifier timeout multiplier | 1.0 |

## 重要说明

这次运行发生在真实本地开发环境中，不是按照排行榜 `k=5` 规则准备的正式提交跑分。

Harbor 官方静态校验要求每题至少 5 次 trial、标准 timeout/resource 设置，以及完整 passing-trial trajectory。因此，这个单次结果应理解为真实环境工程压测，而不是已被官方排行榜接受的排名成绩。

有两个 trial 获得 passing reward，但在 final 后 agent 进程没有自然退出，为了让 batch runner 继续，进行了手动恢复：

- `install-windows-3.11`
- `mailman`

最后的重任务曾检查 CPU / 资源竞争。它们是在真实计算，不是 final 后挂住；这些任务没有被手动取消。

## 批次摘要

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

## 失败分类

| 分类 | 数量 |
| --- | ---: |
| Verifier failed | 18 |
| NonZeroAgentExitCodeError | 5 |
| RuntimeError | 2 |
| AgentTimeoutError | 1 |

## 如何理解这个结果

这次结果的价值在于：它不是挑题，也不是演示任务，而是在真实本地环境中完整跑过 Terminal-Bench 2.1 官方 89 题，覆盖了长任务、服务类任务、QEMU、ML、二进制、构建和多语言任务。

它证明 Linghun 可以在真实开发环境里完成一次完整官方数据集压测，同时也暴露出后续进入官方排行榜需要继续收敛的工程点：

- 支持干净的官方 `k=5` 运行模式；
- leaderboard 运行使用标准 timeout/resource 设置；
- 保留并上传完整 passing-trial trajectory；
- 继续收紧 final 后进程清理。

对外表述建议：Linghun 本地完整跑 Terminal-Bench 2.1 单次评测，65/89，通过率 73.03%。这不是官方排行榜已收录排名。
