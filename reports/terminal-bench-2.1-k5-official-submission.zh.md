# Linghun Terminal-Bench 2.1 k=5 官方提交准备稿

> 这是准备提交给 Terminal-Bench 2.1 官方排行榜审核的材料草稿。当前结果尚未被官方排行榜收录。

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
| Job 目录 | `.bench/terminal-bench-2.1-official-k5/linghun-tb21-k5-a92313e1-r12` |
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
| resume 修复后 `RuntimeError/getwd` | 最终 result 文件中为 0 |
| 原始 job 目录 | 已保留 |

## 给审核方的说明

- Linghun 没有修改 Terminal-Bench 任务、测试、verifier、任务资源或任务 timeout。
- 本次运行通过 Harbor 在本地 Docker/WSL 环境执行。
- 使用稳定公开 commit：`a92313e180a77db415046f707645b2f7e6c08558`。
- 长跑过程中 provider key 曾因旧 key 不可用而轮换；endpoint profile、模型名、agent 代码、dataset 和 Harbor job 未改变。
- 早期出现过 `getwd: no such file or directory` runtime 问题，后续从正确工作目录 resume。最终 trial result 文件中 `RuntimeError/getwd = 0`。
- 官方审核应使用原始 job 目录，不使用本报告作为结果替代。不要公开本地密钥或机器特定环境值。

## 建议发送给官方的短消息

Hello Terminal-Bench team,

We would like to submit Linghun for the Terminal-Bench 2.1 leaderboard.

- Agent: Linghun
- Agent repository: https://github.com/linghungegeg/Linghun
- Model: GPT-5.5
- Dataset: `terminal-bench/terminal-bench-2-1`
- Run mode: Harbor `k=5`
- Commit: `a92313e180a77db415046f707645b2f7e6c08558`
- Local result: 68 / 89 task any-pass, 76.40%
- Job directory: `linghun-tb21-k5-a92313e1-r12`

The run used the official Terminal-Bench 2.1 dataset, did not modify task resources or timeouts, and retained the full raw Harbor job directory for review. Please let us know the preferred upload channel for the raw job artifacts under the current Terminal-Bench 2.1 submission process.

## 参考链接

- Terminal-Bench 2.1 leaderboard: https://www.tbench.ai/leaderboard/terminal-bench/2.1
- 历史 Terminal-Bench 2.0 submission repo / validation 结构: https://huggingface.co/datasets/harborframework/terminal-bench-2-leaderboard
- Harbor Terminal-Bench tutorial: https://www.harborframework.com/docs/tutorials/running-terminal-bench
