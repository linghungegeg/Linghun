# Repository Audit Report

本报告是一次只读审计汇总，覆盖架构边界、算法与性能、交互体验、重复实现和成熟度缺口。审计未修改源码。

## 当前阶段

上一轮已经完成初版审计，覆盖了 P1/P2/P3、推进顺序和验证建议。本轮继续推进时复核了关键源码，发现部分初版结论已经被后续改动修正，因此本版先做状态校正，再给出剩余执行卡片。

已确认的状态变化：

- Bash 输出已经不再是单个完整字符串常驻内存；当前有 bounded preview、summary 和 tail capture。
- Provider SSE 已经有 buffer、单 event 和 tool arguments 上限。
- `/job status` 和 `/job report` 主屏摘要、tone、本地化已经部分落地，并有相关测试覆盖。
- 路径归一化重复、artifact basename 宽松匹配、`spawnSync` 阻塞、compact 假进度、final answer 证据缺口偏晚仍然是后续主要风险。

## Summary

主要风险集中在三类：

- 基础边界能力仍有多套实现，尤其是路径比较、JSONL/逐行 JSON、doctor 诊断逻辑。
- 部分长任务体验已经改善，但 headless、compact、final answer evidence gate 的阶段反馈还不够连贯。
- 性能风险从“无界内存”收敛到“剩余复制成本、同步探测阻塞、缺少专项压力测试”。

建议优先处理仍未落地的高收益项，再为已部分落地的 Bash/SSE/job 补专项回归测试，避免重复改已经修过的方向。

## P1 必修

### 1. 路径比较与归一化存在多套实现，artifact evidence 有误匹配风险

证据：

- 共享 helper 已有 `packages/shared/src/index.ts:51` 的 `normalizePathSeparators`。
- 共享 helper 已有 `packages/shared/src/index.ts:55` 的 `canonicalPathForCompare`。
- TUI 内仍有多套实现：
  - `packages/tui/src/artifact-evidence-runtime.ts:79`
  - `packages/tui/src/architecture-runtime.ts:378`
  - `packages/tui/src/compact-cache-command-runtime.ts:783`
  - `packages/tui/src/git-runtime.ts:320`
  - `packages/tui/src/workspace-reference-cache.ts:781`
- `packages/tui/src/artifact-evidence-runtime.ts:70` 到 `packages/tui/src/artifact-evidence-runtime.ts:76` 允许 basename 相同即认为同一 artifact。

影响：

- `dist/report.md` 和 `docs/report.md` 这类同名文件可能被误判为同一证据。
- 不同模块对大小写、尾斜杠、相对路径的处理不一致。

建议：

- 统一使用 `canonicalPathForCompare` 和明确语义的 shared helper。
- 增加 `sameArtifactPath`、`relativeWorkspacePath` 这类小而稳定的边界函数。
- basename fallback 只保留在显式宽松匹配函数中，不作为默认证据相等判断。

### 2. `spawnSync` 会阻塞 TUI/CLI

证据：

- `packages/tui/src/runner-runtime.ts:189` runner version 使用 `spawnSync`。
- `packages/tui/src/runner-runtime.ts:627` runner status 使用 `spawnSync`。
- `packages/tui/src/terminal-readiness-runtime.ts:463` readiness git status 使用 `spawnSync`。
- readiness 的 git status 已有短 TTL 缓存，但 runner version/status 仍是同步探测。

影响：

- runner 或 git 探测卡住时会阻塞前台交互。
- 同步探测在慢磁盘、杀软扫描、异常 runner binary 下风险更明显。

建议：

- 优先把 runner version/status 改为异步 spawn。
- 对 runner status 加 TTL 缓存，并在 UI 上展示 cached/stale 状态。
- readiness 侧保留现有缓存，同时补超时和慢路径测试。

### 3. final answer 反幻觉检查偏出口，容易产生补证据和重写延迟

证据：

- `packages/tui/src/model-stream-runtime.ts:621` 到 `packages/tui/src/model-stream-runtime.ts:647` 在最终回答文本生成后统一执行 aggregated final answer gate。
- `packages/tui/src/model-stream-runtime.ts:3815` 到 `packages/tui/src/model-stream-runtime.ts:3865` 的 no-tools final 路径会在 gate 后规划补证据动作或重写最终回答。
- `packages/tui/src/model-stream-runtime.ts:222` 和 `packages/tui/src/model-stream-runtime.ts:223` 分别允许最多 2 次 claim alignment rewrite、最多 3 次 evidence action retry。

影响：

- 现有设计保持了安全边界：final gate 仍是统一出口，不会把子 agent 完成直接等同验证通过。
- 代价是缺证据发现偏晚，容易出现“先生成最终回答，再发现缺证据，再补证据，再重写/重跑最终回答”的尾部延迟。

建议：

- 不取消、不削弱 final gate；仍由 final gate 做最终确认、降级和拦截。
- 将一部分缺口发现前移：在最终回答生成前，根据本轮工具结果、验证结果和高风险 claim 类型先提示模型避免无证据声明。
- 将旁路 agent/workflow 的有效 evidence refs 更直接地映射到主链 `context.evidence` 可判定摘要中，但只映射真实工具/验证证据，不把 agent completion 本身当作 PASS。
- 主屏增加轻量阶段提示，例如 checking evidence、collecting missing evidence、rewriting final answer。

## P2 应尽快排

### 1. headless 普通长任务阶段反馈仍需补齐

证据：

- `packages/tui/src/index.ts:1663` 到 `packages/tui/src/index.ts:1678` 已经有 generic headless phase：`starting`、`waiting_first_delta`。
- bench 路径还有 preflight 输出：`packages/tui/src/index.ts:1656` 到 `packages/tui/src/index.ts:1662`。
- 普通 headless 的后续阶段仍需要和 permission、tool running、retry、done/failed 对齐确认。

建议：

- 保留现有 `emitHeadlessPhase`，继续接入 tool running、retry、permission waiting、done/failed。
- 和已有请求生命周期事件对齐，不新增第二套状态系统。
- 增加 headless focused tests，断言普通路径与 bench 路径不会重复刷屏。

### 2. compact 进度条是假进度

证据：

- `packages/tui/src/cache-command-runtime.ts:273` 到 `packages/tui/src/cache-command-runtime.ts:275` 只要 running 就固定 `0.35`。

建议：

- 没有真实阶段进度时显示 indeterminate 文案。
- 如果能拿到阶段，按 preflight、provider、write、acceptance 显示阶段进度。
- 保持用户偏好的简单进度条形态，但不要展示伪精确比例。

### 3. Bash 输出已 bounded，但仍缺压力测试和剩余复制风险评估

证据：

- `packages/tools/src/index.ts:1436` 到 `packages/tools/src/index.ts:1474` 已有 `createBashOutputCapture`。
- `packages/tools/src/index.ts:1457` 到 `packages/tools/src/index.ts:1469` preview 受 `BASH_PREVIEW_LIMIT` 限制。
- `packages/tools/src/index.ts:1441` 到 `packages/tools/src/index.ts:1452` summary/tail 分别有 8,000 和 64,000 字符上限。
- `packages/tools/src/index.ts:3488` 到 `packages/tools/src/index.ts:3497` stdout/stderr 按 chunk 处理、脱敏、写日志并推送进度。

剩余风险：

- tail 更新仍通过字符串拼接和 slice 维护，极端 chunk 下仍有复制成本。
- `onProgress` 的前台消费侧是否 bounded，需要另行沿调用链验证。
- 还需要大 stdout、大 stderr、超时、取消、完整日志写入专项测试。

建议：

- 先补 focused tests，确认当前 bounded 行为，再决定是否改 ring buffer。
- 若测试显示复制成本明显，再把 tailText 换成 line/chunk ring buffer。

### 4. Provider SSE 已有限制，但仍缺协议压力测试

证据：

- `packages/providers/src/index.ts:130` 到 `packages/providers/src/index.ts:132` 定义了 SSE buffer、SSE event、tool arguments 上限。
- OpenAI 流在 `packages/providers/src/index.ts:2293` 到 `packages/providers/src/index.ts:2313` 检查 buffer/event 上限。
- Anthropic 流在 `packages/providers/src/index.ts:2431` 到 `packages/providers/src/index.ts:2448` 检查 buffer/event 上限。
- Anthropic tool args 在 `packages/providers/src/index.ts:2668` 到 `packages/providers/src/index.ts:2680` 检查上限。
- Responses tool args 在 `packages/providers/src/index.ts:2993` 到 `packages/providers/src/index.ts:3030` 检查上限。

剩余风险：

- 解析仍使用 `buffer += ...` 和 `slice`，超限前仍有复制成本。
- 缺少分隔符、超长 event、超大 tool-call arguments、正常流回归需要测试明确覆盖。

建议：

- 先补 OpenAI/Anthropic/Responses 的超限 focused tests。
- 如果测试暴露性能问题，再抽增量 SSE 行解析器。

### 5. job status/report 主屏摘要已部分落地，剩余是边界用例

证据：

- `packages/tui/src/job-agent-command-runtime.ts:819` 到 `packages/tui/src/job-agent-command-runtime.ts:839` 已使用 `formatJobPanelSummary` 和 `getJobPanelTone`。
- `packages/tui/src/job-runtime.ts:805` 到 `packages/tui/src/job-runtime.ts:837` 已实现 warning/error tone、pause reason、next action 和 Ctrl+O hint。
- `packages/tui/src/job-runtime.test.ts:367` 到 `packages/tui/src/job-runtime.test.ts:374` 已覆盖 blocked/stale/failed 摘要和 tone。
- `packages/tui/src/job-runtime.test.ts:377` 到 `packages/tui/src/job-runtime.test.ts:385` 已覆盖 zh-CN status/report/logs 本地化。

剩余风险：

- 仍需补 timeout/cancelled/completed/empty logs 的主屏断言。
- 主屏文字中 `result partial` 是否对用户足够明确，需结合真实样例再调。

建议：

- 不作为第一批实现项继续重做；先补边界测试和少量 copy 打磨。

## P3 清理项

### 1. 文本截断和宽度工具有两套风格

证据：

- `packages/tui/src/startup-runtime.ts:62` 使用单字符省略号。
- `packages/tui/src/shell/text-utils.ts:5` 使用 `...`。

建议：

- 统一到 shell text-utils。
- 保留 ANSI、CJK 和宽度边界测试。

### 2. JSONL 和逐行 JSON 读取策略分散

证据：

- `packages/tui/src/break-cache-runtime.ts:60` 自己读取和解析 JSONL。
- core 层已有 JSONL helper，但调用点没有充分复用。

建议：

- 在 core 扩展一个带 validator 的 tail/append/trim helper。
- 各调用点只提供 warning sink 和领域 schema。

### 3. CLI doctor 和 TUI model doctor 存在重复诊断逻辑

现象：

- CLI/TUI 中 provider key source、env 检查、project settings 检测存在重复实现趋势。

建议：

- 把 provider key source、env、project settings 检测抽到 config/shared。
- CLI 和 TUI 只负责格式化输出。

## 续推进执行卡片

### 卡片 A：artifact path evidence 边界

目标：避免同 basename 不同目录的 artifact 被误判为同一证据。

范围：

- `packages/tui/src/artifact-evidence-runtime.ts`
- `packages/shared/src/index.ts`
- 相关 artifact evidence tests

实施：

- 在 shared 增加严格路径比较 helper，复用 `canonicalPathForCompare`。
- `pathsReferToSameArtifact` 默认使用严格比较。
- 如确实需要 basename 宽松匹配，拆出显式命名函数并只在人工 hint 场景使用。

验证：

- 同路径不同分隔符应匹配。
- Windows 大小写场景应匹配。
- `dist/report.md` 与 `docs/report.md` 不应匹配。

### 卡片 B：runner 同步探测异步化

目标：降低 runner 探测阻塞前台交互的风险。

范围：

- `packages/tui/src/runner-runtime.ts`
- runner runtime tests

实施：

- 将 version/status 探测从 `spawnSync` 改为异步 spawn helper。
- 加 TTL cache 和 timeout。
- 输出中区分 fresh/cached/stale。

验证：

- runner 正常返回。
- runner 超时。
- runner 协议不匹配。
- cache 命中不重复启动子进程。

### 卡片 C：final answer evidence 前置提示

目标：减少最终回答出口处的补证据和重写延迟，同时保留 final gate。

范围：

- `packages/tui/src/model-stream-runtime.ts`
- final answer gate tests

实施：

- 在最终回答生成前，根据本轮 evidence 和高风险 claim 类型生成短提示。
- 把真实工具/验证 evidence refs 汇入 final gate 可消费摘要。
- 主屏显示 checking evidence / collecting missing evidence / rewriting final answer。

验证：

- 无证据 completion/test/file-change claim 不应直接通过。
- 有真实 verification evidence 时不应重复补证据。
- agent completion notice 本身不能被当作 verification pass。

### 卡片 D：compact 进度条改为真实阶段或不确定态

目标：保留简单进度条体验，但不展示固定假比例。

范围：

- `packages/tui/src/cache-command-runtime.ts`
- compact command tests

实施：

- 无阶段时显示 indeterminate 文案或简单 running bar。
- 有阶段时按阶段映射进度。

验证：

- running 无阶段不出现固定 `0.35` 语义。
- complete 不显示进度条。
- 有阶段时展示稳定阶段文案。

### 卡片 E：Bash/SSE/job 补回归测试

目标：锁住已经部分落地的能力，避免后续误回退。

范围：

- `packages/tools/src/index.test.ts`
- `packages/providers/src/index.test.ts`
- `packages/tui/src/job-runtime.test.ts`

验证点：

- Bash：大 stdout、大 stderr、超时、取消、preview/tail、完整日志写入。
- SSE：超长 buffer、超长 event、超大 tool arguments、正常 OpenAI/Anthropic/Responses 流。
- job：blocked、stale、timeout、cancelled、failed、completed、空日志、本地化。

## 建议推进顺序

### 第一批：仍未落地且高收益

- artifact path evidence 边界。
- runner 同步探测异步化。
- compact 进度条真实阶段或不确定态。

### 第二批：减少尾部延迟和卡顿感

- final answer evidence 前置提示和主屏阶段反馈。
- headless 普通路径阶段反馈补齐。

### 第三批：锁定已修能力

- Bash 输出 bounded 行为专项测试。
- Provider SSE limit 专项测试。
- job status/report 边界状态测试。

### 第四批：架构债收敛

- JSONL helper 统一。
- 文本截断/宽度工具统一。
- doctor 诊断逻辑复用。

## 验证建议

每批改动都应有 focused tests。最低验证建议：

- path helper：Windows 大小写、反斜杠、尾斜杠、同 basename 不同目录。
- runner：正常返回、超时、协议不匹配、cache hit。
- compact：running 无真实进度、complete、阶段变化。
- final gate：无证据 claim、有真实 evidence、agent completion 非 verification pass。
- Bash 输出：大 stdout、大 stderr、超时、取消、tail preview、完整日志写入。
- SSE：超长 event、缺少分隔符、超大 tool-call arguments、正常流回归。
- job 展示：blocked、failed、stale、timeout、cancelled、completed、空日志。

收尾至少跑：

- `pnpm typecheck`
- 相关包 focused tests
- 风险较高批次再跑 `pnpm test`
