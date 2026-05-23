# Real Provider + Real Project Smoke Checklist

## 状态与边界

- 本文件只准备真实 smoke checklist。
- 本轮不跑真实 provider，不使用真实 key，不进入真实项目 smoke。
- 本文件不代表 Beta PASS / smoke-ready / open-source-ready。
- Mock/local/focused PASS 不能算 live PASS。

## 测试项目

```text
用户指定真实测试项目
```

真实 smoke 只能在用户明确进入第二阶段后执行。

## Provider 配置方式

真实 provider 配置只允许通过当前 shell/session 的临时 env 注入：

- OpenAI-compatible base URL：通过 env 注入。
- DeepSeek base URL：通过 env 注入。
- Provider key：只通过 env 临时注入。
- 不保存真实 key 到仓库、报告、配置、测试、日志或交付文档。
- 不记录 raw provider request、完整 provider response 或完整日志。

建议 env 名称仅写占位，不写真实值：

```text
OPENAI_API_KEY
OPENAI_BASE_URL
DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL
```

如当前 Linghun runtime 需要项目内 `LINGHUN_*` 环境变量，应只在临时 shell 中做映射，不写入文件；真实值不得出现在报告或 transcript 摘要中。

## 第一轮真实 smoke 建议任务

第一轮控制在 3-5 个任务，逐项执行、逐项记录，不并行扩大范围：

1. 只读项目体检：读取 `用户指定真实测试项目` 的项目结构、规则文件和关键入口，只输出摘要与风险，不改文件。
2. 小 bug 修复：选择一个低风险、单点、可验证的小问题，覆盖 Read/Edit/verification/summary-first 输出。
3. 多文件改动：选择 2-3 个文件的受控改动，观察 changed files、permission、evidence、验证摘要和回滚建议。
4. 架构性任务：提出需要 Architecture Runtime 判断的任务，确认工程事实、建议方案、non-goals、验证路径和 drift 提示是否正常。
5. 长任务：执行 `/job run` 或 durable job fallback/runner 观察，确认 status/report/log refs、cancel/timeout/stale 非 PASS 边界。

## 每轮必须记录

每轮记录只写 summary + artifact refs，不写完整日志。Mock/local/focused PASS 不能写成 live PASS；每轮必须单独裁决 PASS / BLOCKED / FAIL。

建议记录模板：

```text
Smoke item: <编号 / 名称>
Provider/model: <provider> / <model>
Task: <用户任务摘要>
Tools summary: <Read/Edit/Bash/Index/MCP/Remote 等摘要，不贴 raw output>
Changed files: <无 / 相对路径清单>
Verification command/result: <命令 + PASS/BLOCKED/FAIL 摘要>
Token/cache/compact: <输入/输出/cache/compact 摘要或 unavailable>
Architecture/evidence/permission: <是否触发；证据 refs；权限模式与审批摘要>
Index/cache notes: <是否使用 .linghunignore/.cbmignore；是否只读 /index status fast；是否运行 fresh/check>
Result: PASS / BLOCKED / FAIL
Notes: <返工、幻觉、越权、泄露、provider 错误、路径暴露等摘要>
```

字段要求：

- 模型/provider。
- 用户任务。
- 工具调用摘要。
- 修改文件。
- 验证命令与结果。
- token/cache/compact 情况。
- architecture/evidence/permission 触发情况。
- `.linghunignore` / `.cbmignore` 是否覆盖索引风险或 hard skip 相关边界。
- PASS / BLOCKED / FAIL 裁决。
- 是否出现返工、幻觉、越权或泄露。
- 是否有 provider 报错、路径暴露、权限绕过或错误修改真实项目。

## PASS / BLOCKED / FAIL 标准

### PASS

必须同时满足：

- 在真实 provider 和 `用户指定真实测试项目` 上完成对应任务。
- 工具、权限、evidence、验证、summary-first 输出符合预期。
- 无密钥泄露、无 raw request/response 泄露、无完整日志泄露。
- 无未授权写入、无路径越界、无 PASS 膨胀。
- 相关验证命令实际运行并有摘要结果。

### BLOCKED

任一情况可判 BLOCKED：

- Provider 配置、base URL、模型能力、tool calling 或权限确认无法继续。
- 真实项目任务无法安全定义或缺少用户确认。
- 验证环境缺失，导致任务不能闭环。
- 发现需要先修 Linghun P1/P2 或安全边界问题。

### FAIL

任一情况应判 FAIL：

- Mock/local PASS 被当成 live PASS。
- Provider 报错被吞掉或被写成 PASS。
- 权限绕过、Start Gate 绕过或高风险动作静默执行。
- PASS 膨胀：局部成功被写成 Beta PASS、smoke-ready 或 open-source-ready。
- 真实 key、raw provider request、完整 provider response 或完整日志被写入文件/报告/配置/测试。
- 错误修改真实项目、越界修改、路径泄露或未授权删除/重命名文件。

## 报告边界

真实 smoke 报告只能包含：

- 任务摘要。
- 修改文件清单。
- 工具调用摘要。
- 验证命令与结果摘要。
- artifact refs / log refs / evidence refs。
- PASS/BLOCKED/FAIL 裁决与下一步。

真实 smoke 报告不得包含：

- 真实 key。
- Raw provider request。
- 完整 provider response。
- 完整日志。
- 完整 transcript。
- 未脱敏路径清单或可泄露项目隐私的长输出。

## 进入条件

只有 P1/P2 remediation closure 完成并经用户确认后，才可以进入第二阶段 Real Provider + Real Project Smoke。
