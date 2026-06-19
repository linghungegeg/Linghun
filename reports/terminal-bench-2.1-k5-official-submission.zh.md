# Linghun Terminal-Bench 2.1 k=5 结果

> Linghun 按 Terminal-Bench 2.1 官方格式完成的本地 `k=5` 运行公开摘要。材料已公开，用于等待官方验证和收录。

## 结果摘要

| 项目 | 数值 |
| --- | --- |
| Agent / System | Linghun |
| Agent 仓库 | https://github.com/linghungegeg/Linghun |
| Model | GPT-5.5 |
| Model provider | OpenAI-compatible endpoint |
| Dataset | Terminal-Bench 2.1 (`terminal-bench/terminal-bench-2-1`) |
| 官方运行模式 | `k=5` |
| Harbor version | 0.13.2 |
| Endpoint profile | responses |
| Inference level | High |
| 并发 | 4 |
| Commit | `a92313e180a77db415046f707645b2f7e6c08558` |
| Commit subject | `fix(tui): stabilize terminal display surface` |
| Task any-pass 分数 | 68 / 89 |
| Task any-pass 通过率 | 76.40% |
| Trial pass / fail | 170 / 249 |
| Trial pass rate | 40.57% |
| Harbor 最终进度 | completed 445, running 0, pending 0, errored 144, cancelled 0 |

## 已核对的官方约束

Terminal-Bench 2.1 排行榜页说明，2.1 结果对应 `terminal-bench/terminal-bench-2-1`，提交运行命令为：

```bash
harbor run -d terminal-bench/terminal-bench-2-1 -a "agent" -m "model" -k 5
```

排行榜页同时注明 submissions 不能修改 timeouts 或 resources，并说明结果由 Terminal-Bench team member 运行和验证。

本次运行对应情况：

| 要求 | 状态 |
| --- | --- |
| Dataset 为 `terminal-bench/terminal-bench-2-1` | 是 |
| `k=5` / 每题五次尝试 | 是 |
| 标准 timeout multiplier | `timeout_multiplier = 1.0` |
| 未知评分相关 timeout/resource override | 是 |
| 官方并发保持 | `n_concurrent_trials = 4` |
| 最终 Docker 容器 | 0 running |
| 最终 Harbor running / pending trials | 0 / 0 |
| 最终 result 文件中的 `RuntimeError/getwd` | 0 |

## 运行说明

- Linghun 没有修改 Terminal-Bench 任务、测试、verifier、任务资源或任务 timeout。
- 本次运行使用 Terminal-Bench 2.1 官方数据集和 Harbor `k=5` 模式。
- 本次运行使用 commit：`a92313e180a77db415046f707645b2f7e6c08558`。
- 当前结果等待 Terminal-Bench 官方验证和收录。

## 参考链接

- Terminal-Bench 2.1 leaderboard: https://www.tbench.ai/leaderboard/terminal-bench/2.1
- 历史 Terminal-Bench 2.0 submission repo / validation 结构: https://huggingface.co/datasets/harborframework/terminal-bench-2-leaderboard
- Harbor Terminal-Bench tutorial: https://www.harborframework.com/docs/tutorials/running-terminal-bench
