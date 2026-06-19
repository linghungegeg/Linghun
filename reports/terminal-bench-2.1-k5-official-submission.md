# Linghun Terminal-Bench 2.1 k=5 Submission Draft

> Draft package notes for official Terminal-Bench 2.1 leaderboard submission. This result has not been accepted by the official leaderboard yet.

## Result Summary

| Item | Value |
| --- | --- |
| Agent / system | Linghun |
| Agent repository | https://github.com/linghungegeg/Linghun |
| Model | GPT-5.5 |
| Model provider | OpenAI-compatible endpoint |
| Dataset | Terminal-Bench 2.1 (`terminal-bench/terminal-bench-2-1`) |
| Official run mode | `k=5` |
| Harbor version | 0.13.2 |
| Endpoint profile | responses |
| Inference level | High |
| Concurrency | 4 |
| Commit | `a92313e180a77db415046f707645b2f7e6c08558` |
| Commit subject | `fix(tui): stabilize terminal display surface` |
| Job directory | `.bench/terminal-bench-2.1-official-k5/linghun-tb21-k5-a92313e1-r12` |
| Task any-pass score | 68 / 89 |
| Task any-pass rate | 76.40% |
| Trial pass / fail | 170 / 249 |
| Trial pass rate | 40.57% |
| Harbor final progress | completed 445, running 0, pending 0, errored 144, cancelled 0 |

## Official Submission Constraints Checked

The Terminal-Bench 2.1 leaderboard page states that submissions correspond to `terminal-bench/terminal-bench-2-1`, should be run with:

```bash
harbor run -d terminal-bench/terminal-bench-2-1 -a "agent" -m "model" -k 5
```

and notes that submissions may not modify timeouts or resources. The same page says a Terminal-Bench team member runs the evaluation and verifies results.

For this run:

| Requirement | Status |
| --- | --- |
| Dataset is `terminal-bench/terminal-bench-2-1` | Yes |
| `k=5` / five attempts per task | Yes |
| Standard timeout multiplier | `timeout_multiplier = 1.0` |
| No known timeout/resource override used for scoring | Yes |
| Official concurrency maintained | `n_concurrent_trials = 4` |
| Final Docker containers | 0 running |
| Final Harbor running / pending trials | 0 / 0 |
| `RuntimeError/getwd` after resume fix | 0 in final result files |
| Raw job directory retained | Yes |

## Notes For Reviewers

- Linghun did not modify Terminal-Bench tasks, task tests, verifier logic, task resources, or task timeouts for this run.
- The job was run locally through Harbor on Docker/WSL.
- The run used a stable public commit: `a92313e180a77db415046f707645b2f7e6c08558`.
- A provider key was rotated during the long run because the previous key stopped working. The endpoint profile, model name, agent code, dataset, and Harbor job were not changed.
- An early `getwd: no such file or directory` runtime issue was resumed from the correct working directory. Final trial result files contain `RuntimeError/getwd = 0`.
- Raw result artifacts should be submitted from the job directory, not from this report. Do not publish local secrets or machine-specific environment values.

## Suggested Official Submission Message

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

## References

- Terminal-Bench 2.1 leaderboard: https://www.tbench.ai/leaderboard/terminal-bench/2.1
- Historical Terminal-Bench 2.0 submission repository and validation structure: https://huggingface.co/datasets/harborframework/terminal-bench-2-leaderboard
- Harbor Terminal-Bench tutorial: https://www.harborframework.com/docs/tutorials/running-terminal-bench
