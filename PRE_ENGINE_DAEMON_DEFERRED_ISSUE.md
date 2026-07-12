# Pre-engine daemon 跨窗口永久阻塞（代码已闭环，待统一长压）

## 状态

- 结论：原代码问题已按现有 runtime/request owner 机制闭环，真实二进制长压纳入最终统一验证。
- 原优先级：P0（可导致同仓库多个窗口长期卡住）。
- 当前处理：daemon 按现有 `runtimeOwnerId` 隔离，调用复用现有 `AbortSignal`；direct pre-engine 结果复用现有 request owner、stale guard 和 `commitGuard`。
- 机制边界：没有新增 daemon manager、owner、取消总线或第二套 evidence 状态机。

## 代码位置

- `packages/tui/src/mcp-index-runtime.ts:566`：`PreEngineDaemon`。
- `packages/tui/src/mcp-index-runtime.ts:619`：`PreEngineDaemon._ensureProc()`。
- `packages/tui/src/mcp-index-runtime.ts:700`：`PreEngineDaemon._doCall()`。
- `packages/tui/src/mcp-index-runtime.ts:827`：模块级 `_preEngineDaemons`。
- `packages/tui/src/mcp-index-runtime.ts:829`：`getOrCreatePreEngineDaemon()`。
- `packages/tui/src/mcp-index-runtime.ts:2038`：pre-engine 调用入口。

## 触发条件与根因

1. 同一进程内，多个窗口以相同的 `binary + cwd` 调用 pre-engine，命中同一个模块级 `PreEngineDaemon`。
2. daemon 首次启动后未返回合法的 initialize 响应，或子进程处于存活但不再输出的状态。
3. `_ensureProc()` 只监听 stdout 数据，没有 initialize timeout、abort、spawn error、stdin write error 或异常退出的统一 settle。
4. `call()` 把所有调用串到同一条 `queue`；前一个调用永久 pending 后，后续调用全部排在其后。
5. 调用入口没有把当前请求的 `AbortSignal` 传入 daemon；ESC、窗口关闭或请求 owner 失效都不能解除这条队列。

## 影响

- 同仓库、同二进制的多个窗口可能一起等待，且不会自行恢复。
- 新请求和新窗口会复用已经卡住的 daemon/queue，形成跨窗口串状态。
- 上层的降级分支只有在 `call()` 返回失败后才会执行；永久 pending 时无法进入降级。
- 该问题影响正常使用的可用性，但不应通过放宽 evidence 或伪造成功来规避。

## 闭环方式

- daemon registry key 纳入现有 `runtimeOwnerId`，相同 cwd 的不同 runtime 不再共享队列。
- initialize 与 tool call 统一处理 timeout、abort、process error/exit 和 stdin write error，并保证单次 settle 和监听器清理。
- idle cleanup 只在该 daemon 队列清空后启动，不再中断活跃调用。
- 正常取消依赖现有 request signal；tool call hard safety 与现有 MCP/CCB 边界一致，不新增短时硬门控。
- direct pre-engine 在 evidence、tool result、SourcePack candidate 和 activity 提交前检查原 request owner。

## 已采用边界

- 复用 pre 语言最终确定的窗口/runtime owner；不要新增独立的全局 daemon manager。
- initialize 和每次 tool call 必须复用同一套 timeout、abort、error、exit terminal finalizer。
- 请求取消或 owner 失效后，等待者必须解除；迟到响应不得回灌新请求。
- 一个 owner 的失败不得永久占住共享队列；需要明确清除失效进程和 pending 项。
- 保留真实失败后的现有降级链，不以假成功或空 evidence 通过反幻觉校验。

## 回归与压力测试

1. fake pre-engine 永不返回 initialize：调用在边界内失败并进入降级，后续调用可继续。
2. initialize 前触发 abort：当前调用结束，迟到 initialize 被丢弃。
3. tool call 永不返回：不会永久占住同 owner 的后续队列。
4. 同进程两个 runtime、相同 cwd 并发：取消或卡住其中一个，不影响另一个。
5. 两个不同 cwd 并发：进程、队列、结果和 cleanup 不串状态。
6. 进程 error/exit、stdin write 失败、非法 JSON：每条路径只 settle 一次并清理监听器。
7. 至少 100 个并行 runtime、1,000 次 initialize/call/abort 状态切换：无永久 pending、无迟到结果回灌、无监听器持续增长。

本次闭环执行了相关 3 个测试文件共 59 项回归；daemon 专测 8 项，包括 100 runtime、1,000 次 call/abort 状态切换，全部 settle 且无残留 data listener。TUI typecheck、Biome 和 diff-check 通过。
