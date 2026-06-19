# Linghun Terminal-Bench 2.1 k=5 Result

> Public summary of Linghun's Terminal-Bench 2.1 official-format `k=5` run. The materials are published for official verification and listing.

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
| `RuntimeError/getwd` in final result files | 0 |

## Run Notes

- Linghun did not modify Terminal-Bench tasks, task tests, verifier logic, task resources, or task timeouts for this run.
- The run used the official Terminal-Bench 2.1 dataset and Harbor `k=5` mode.
- The run used commit `a92313e180a77db415046f707645b2f7e6c08558`.
- The result is awaiting Terminal-Bench official verification and listing.

## References

- Terminal-Bench 2.1 leaderboard: https://www.tbench.ai/leaderboard/terminal-bench/2.1
- Historical Terminal-Bench 2.0 submission repository and validation structure: https://huggingface.co/datasets/harborframework/terminal-bench-2-leaderboard
- Harbor Terminal-Bench tutorial: https://www.harborframework.com/docs/tutorials/running-terminal-bench
