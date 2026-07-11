# Pre-engine daemon 跨窗口永久阻塞（延期处理）

## 状态

- 结论：代码确认的问题。
- 优先级：P0（可导致同仓库多个窗口长期卡住）。
- 当前处理：只记录，不修改运行时代码。
- 解锁条件：等待 pre 语言开发的隔离窗口机制完成后，再结合其最终进程与会话边界修复。

## 代码位置

- `packages/tui/src/mcp-index-runtime.ts:555`：`PreEngineDaemon`。
- `packages/tui/src/mcp-index-runtime.ts:577`：`PreEngineDaemon._ensureProc()`。
- `packages/tui/src/mcp-index-runtime.ts:609`：`PreEngineDaemon._doCall()`。
- `packages/tui/src/mcp-index-runtime.ts:673`：模块级 `_preEngineDaemons`。
- `packages/tui/src/mcp-index-runtime.ts:675`：`getOrCreatePreEngineDaemon()`。
- `packages/tui/src/mcp-index-runtime.ts:1879`：pre-engine 调用入口。

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

## 暂缓原因

pre 语言开发正在补齐隔离窗口。现在先改变 daemon key、进程所有权或生命周期，可能与即将确定的隔离边界重复，形成第二套 owner/daemon 机制。因此本项在隔离窗口完成前只保留问题记录，不做预防性补丁。

## 后续修复边界

- 复用 pre 语言最终确定的窗口/runtime owner；不要新增独立的全局 daemon manager。
- initialize 和每次 tool call 必须复用同一套 timeout、abort、error、exit terminal finalizer。
- 请求取消或 owner 失效后，等待者必须解除；迟到响应不得回灌新请求。
- 一个 owner 的失败不得永久占住共享队列；需要明确清除失效进程和 pending 项。
- 保留真实失败后的现有降级链，不以假成功或空 evidence 通过反幻觉校验。

## 最小回归与压力测试

1. fake pre-engine 永不返回 initialize：调用在边界内失败并进入降级，后续调用可继续。
2. initialize 前触发 abort：当前调用结束，迟到 initialize 被丢弃。
3. tool call 永不返回：不会永久占住同 owner 的后续队列。
4. 同进程两个 runtime、相同 cwd 并发：取消或卡住其中一个，不影响另一个。
5. 两个不同 cwd 并发：进程、队列、结果和 cleanup 不串状态。
6. 进程 error/exit、stdin write 失败、非法 JSON：每条路径只 settle 一次并清理监听器。
7. 至少 100 个并行 runtime、1,000 次 initialize/call/abort 状态切换：无永久 pending、无迟到结果回灌、无监听器持续增长。

