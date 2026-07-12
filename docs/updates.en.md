# Linghun Updates

This page records product updates that directly affect user experience. For the full system design, see the [English Whitepaper](../WHITEPAPER.en.md).

## Coming Soon

- The desktop app is coming soon.
- A specially trained random full-modal model (optional install) is coming with the desktop app. It connects through the foundation's built-in App Bridge and does not require any other software. With the current foundation + index + pre-check engine, a 10-minute task can be shortened to 3-5 minutes, making the workflow faster and steadier.

## July 12, 2026: Mainline and Product-grade Pre-check Convergence

This release is not only about the pre-check engine. It converges the long-task, cache, provider, request-lifecycle, agent/workflow, MCP/Web/memory, terminal-visible, and anti-hallucination evidence work that entered main after the last July 8/9 npm release, then synchronizes every affected public package back to npm. The goal remains one coherent runtime: faster and steadier work in real projects, with reliable recovery, interruption, verification, and no competing state machines or unverified capabilities fighting each other.

### Long Tasks, Compact, and Cache

- Large-session resume prefers the latest usable compact boundary and uses bounded tail loading for oversized transcripts, reducing memory and wait pressure during recovery.
- Deep compact, compact preflight, restore projection, prompt-cache lifecycle, and context-window boundaries were tightened so task, evidence, and state remain continuous across compression.
- Read, ReadSnippets, and SourcePack can reuse unchanged windows, while tool-result budgeting deduplicates large results and trims persisted previews to reduce repeated reads and model-context churn.
- Cache footer, usage diagnostics, and terminal-local state now follow the request lifecycle instead of maintaining conflicting views of cache hits, compact activity, and task progress.

### Providers, Stream Recovery, and Request Lifecycle

- Native Gemini and Grok provider configuration, routing, and unified runtime contracts were added together with native hosted search. Ambiguous model names can now use explicit `provider:model` selection.
- Provider first-byte waiting, stream activity, circuit-breaker recovery, and prompt-cache lifecycle were hardened to reduce apparent hangs before the first chunk, during interrupted streams, or after recovery.
- Foreground requests own isolated turn and abort boundaries so cancellation, retry, resume, background jobs, and final commits no longer compete for one activity state.
- WebSearch and WebFetch now report connecting, receiving, and processing phases, honor caller cancellation, distinguish timeout and abort failures, and cap response sizes.

### Agents, Workflows, Permissions, and Verification

- Agent forks support full-context mode, while session forks, handoff, queued input, background jobs, and remote transport have clearer ownership and recovery boundaries.
- Agent/job/workflow progress, verification ownership, and final completion state share one observable path so one task cannot accidentally consume another task's verification.
- Readonly workflows, permission approval, Git operations, process guards, and user-action constraints were tightened. Recoverable failures no longer stop work too early, while unauthorized or evidence-free operations remain blocked.
- Verification lifecycle is isolated by request and task scope, preventing historical failures or natural-language constraints from falsely downgrading current completed work.

### MCP, Memory, and the Terminal-visible Layer

- MCP stdio cleanup, SSE liveness, index/pre-check daemons, and startup recovery were hardened so abnormal exits do not leave stale connections or state behind.
- Memory extraction, tombstones, persistence, and worktree-shared project roots were converged, allowing worktrees from the same Git project to share project memory without losing provenance or deletion boundaries.
- Streaming Markdown, code blocks, structured diffs, composer chips, folded cursors, panel recovery, task footers, and tool-progress presentation were stabilized for long output that remains readable, scrollable, copyable, and interruptible.
- Model-visible tool results are smaller, while evidence, error categories, truncation ranges, and expandable details remain available for auditing.

### Anti-hallucination Evidence and Product-grade Pre-check

- Compact, tool budgets, request recovery, and the final-answer gate now share the same structured evidence boundary. Historical failures, degraded states, and constraint wording are evaluated by scope instead of keyword-only blocking.
- The pre-check engine exposes only five product-grade paths—TypeScript/TSX, Python, Rust, Go, and Java—through the same `pre_context`, `pre_plan`, `pre_impact`, and `pre_verify` contract, without a second allowlist or semantic mechanism.
- The Windows, Linux, and macOS pre-check platform packages now carry TypeScript `5.9.3` and Pyright `1.1.410`. Explicit project versions win; otherwise Linghun uses its fixed compatible runtime. Rust, Go, and Java continue to reuse official toolchains so the main package does not grow by several gigabytes.
- SQL, Shell, C#, PHP, Ruby, Kotlin, Dart, Swift, and C/C++ remain hidden until product-grade. Uncovered files return `not_covered` quickly, while missing official tools return explicit `tool_missing` or degraded states instead of generic AST output presented as complete verification.

### Verification, Publishing, and User Experience

- All 59 pre-check Rust tests passed. TypeScript/TSX, Rust, Go, and Java each passed 1,000-file product gates, Python passed its complete product smoke, and the five-language concurrent, mixed-workspace restart, and 400-call immature-language isolation gates all passed.
- The npm audit found real post-release changes in `config`, `core`, `providers`, `tools`, `tui`, the Windows pre-check package, and the CLI, so each receives a patch release. Unchanged `shared`, `ink-runtime`, codebase-memory, native-runner, and non-Windows pre-check packages are not republished.
- Users still receive results only after real tools, evidence alignment, and anti-hallucination cleanup: long tasks recover more reliably, provider and tool state is clearer, mature languages work out of the box, and uncovered or unverified work is never presented as correct.

## July 7, 2026: Heavy Update After Deep Real-world Development

This is a heavy update after deep real-world development: anti-hallucination now fits more tightly with the foundations, output is smoother, faster, and steadier, and cache hit rate has increased sharply to 96%+ without becoming dumb. The focus is not a pile of isolated features. It tightens the parts of long development runs that most often need to work together: deep compact, cache boundaries, the command surface, provider watchdogs, final-answer gates, evidence state, and task progress display.

This batch of stable points covers compact cache and command surface work, deep compact gating / projection, provider stream watchdogs, compact prompt prefixing, todo bottom progress summaries, final-answer downgrade boundaries, task bottom-pane status spacing, and final-gate evidence attempt state. The user-facing effect is closer to a model continuously working inside a real project: context that should be retained is not casually lost, reusable cache can be reused, output reaches the visible layer faster, and final answers stay closer to the evidence boundary.

### How It Works

- Deep compact and compact prompt boundaries were tightened so long-session compression, recovery, and projection are steadier, with less context breakage or repeated explanation after compaction.
- Cache policy and cache diagnostics were hardened so reusable context can hit cache more reliably while preserving evidence and task state instead of trading high hit rate for shallow answers.
- The command surface, search_code guard, and retry paths were refined so natural-language commands, index lookup, and failed retries fit real development flow better.
- Provider stream watchdog and recovery logic were strengthened to reduce stuck streams, stale previews after retry, and unclear recovery state.
- Final-answer gates, evidence attempt state, and downgrade boundaries were tightened so visible answers pass through clearer evidence alignment and completion checks.
- The task bottom pane, progress colors, and status spacing were adjusted so running tasks, todo summaries, permission waits, and final states are easier to scan.

### User Experience

- Long-task output feels smoother, faster, and steadier, especially during continuous streaming, post-compact continuation, and multi-turn recovery.
- Cache hit rate has increased sharply to 96%+ while keeping evidence, task, and context boundaries, reducing the risk of answers becoming generic just because cache hit.
- The anti-hallucination path and the foundations behave more like one mainline: cache, compact, commands, providers, evidence, and final answers coordinate instead of drifting apart.
- The command panel and search chain are steadier, retries are more observable, and the model has fewer reasons to wander because tool state is unclear.
- Task progress, todo summaries, and final-answer state are clearer, making it easier to tell whether Linghun is advancing, recovering, waiting, or closing out.

## July 5, 2026: Terminal Foundation, Task Panels, and Runtime Recovery

This release continues to harden Linghun's terminal mainline and smoothness: model streaming, terminal scroll and copy boundaries, background task status, answer display after anti-hallucination cleanup, diff / Markdown rendering, provider network recovery, and runtime storage were all tightened.

The goal is not a new visual skin. It is to make long development runs feel like a steadier engineering terminal: output reaches the screen faster while growing content remains readable, scrollable, and copyable; background task and permission state are easier to see; model answers pass through anti-hallucination cleanup, evidence alignment, and final-answer validation before entering the user-visible layer, reducing stuck or evidence-misaligned displays.

### How It Works

- Model streaming now enters the terminal in a more controlled rhythm, separating high-frequency deltas from stable transcript commits to reduce jitter during long answers.
- The path from the final-answer gate into the visible layer was tightened, making the boundary between anti-hallucination cleanup, evidence alignment, and display commits clearer and reducing repeated, jumping, or incomplete cleaned answers.
- Terminal-first scroll, copy, and normal-screen boundaries were tightened while keeping native terminal selection as the default and preserving Linghun's Markdown, code block, and task presentation style.
- The task bottom panel and background task status model were strengthened so running, waiting, failed, permission, and progress states are easier to see in the main screen.
- Diff, plain-text, Markdown, and tool-output rendering were refined to reduce noise when long output, stderr, patches, and code blocks appear together.
- Provider network warmup and runtime storage paths were added so first-request DNS / network jitter is less visible and long-session state is easier to recover.

### User Experience

- Long answers and tool output reach the visible layer faster, and the terminal is less likely to become hard to scroll, copy, or read while streaming continues.
- Model answers are shown after anti-hallucination cleanup, making the transition from cleanup to the visible final state steadier and smoother in more scenarios.
- Background tasks, permission waits, and execution states are clearer, making it easier to tell whether Linghun is running, waiting, recovering, or done.
- Diff, Markdown, code blocks, and plain text render more consistently, reducing format noise during patch review and model explanations.
- Provider startup and failure recovery feel smoother, with clearer status during network instability.
- Long conversations and multi-step tasks keep stronger state, giving resume, summary, and final-answer validation better evidence.

## June 27, 2026: Session Storage, Model Streaming, and Permission Modes

Linghun tightened three parts of the terminal mainline that users can directly feel: long-session storage, model streaming output, and permission modes.

The focus of this update is not adding a new feature. It makes the existing foundation steadier: long conversations keep less session history in process memory; Claude, OpenAI, and OpenAI-compatible SSE output go through a more consistent parsing and rendering path; and auto-review / full-access permission behavior better matches everyday development expectations with fewer unnecessary interruptions.

### How It Works

- Session recording and replay paths were tightened so long conversation history is stored in traceable files instead of continuously growing inside one long-running process.
- Model streaming deltas were normalized more consistently, reducing provider-specific differences in line breaks, code blocks, tool output, and final-answer display.
- Some internal-state terminal notices were removed from the user-visible layer. Cache and memory work still runs, but it no longer adds avoidable noise to the main screen.
- Permission-mode policy was adjusted: default and plan modes remain cautious, auto-review interrupts less for low-risk operations, and full-access better matches the expectation users have when they explicitly choose it.
- The underlying permission, evidence, session, index, and verification paths remain in place. The user-visible cleanup does not remove the foundation logic.

### User Experience

- Long conversations are less likely to slow down or hit memory pressure because session history keeps growing.
- Claude, OpenAI, and OpenAI-compatible model output render more consistently in terminal line breaks, code blocks, and long paragraphs.
- Command stderr, long text blocks, and tool output are easier to read, and the main screen is less likely to collapse into scattered code blocks only.
- Auto-review mode interrupts less for normal reads, writes, and development commands; full-access behaves closer to "the user explicitly allowed this, let the task run."
- Cache refreshes, memory updates, and other background capabilities still exist, but they interfere less with the terminal surface.

## June 26, 2026: Pre-check System and Multi-language Deep Layers

Linghun's pre-check system expanded into multi-language deep layers covering TypeScript, Python, Rust, Go, Java, SQL, Shell, C#, PHP, Ruby, Kotlin, Dart, Swift, C/C++, and other common development stacks.

The point of this update is not merely adding more checker scripts. It moves a large part of the model's early exploration into a structured pre-reasoning path: what may be affected, which files belong to the same call chain, and which language layer can surface deterministic errors before the model keeps guessing. Instead of starting with broad `Grep` / `Read` passes across the repository, the model can reach relevant facts earlier. The user-facing effect is faster convergence, fewer repeated file reads, and earlier discovery of obvious mistakes after edits.

### How It Works

- The pre-engine keeps the general `pre_context`, `pre_impact`, `pre_plan`, and `pre_verify` capabilities, using index data, symbols, call relationships, impact ranges, and verification results as structured facts for the model.
- Each language deep layer identifies matching files, calls the local toolchain or fallback checker, and returns normalized results through `pre_verify`.
- If a language toolchain is not installed, the layer returns `unavailable` with a clear reason instead of pretending the check passed or blocking the main flow.
- The packaged binary and helper files ship with Linghun CLI. Users get the pre-check mainline after installing the CLI, and deeper checks activate automatically when the matching local toolchain exists.

### User Experience

- Before editing, the model can see relevant files, symbols, and call paths earlier, reducing repeated `Grep` / `Read` calls and wasteful exploration.
- After edits, quick pre-checks can surface syntax errors, type errors, and obvious call issues before the model claims completion.
- If a language toolchain is missing, Linghun explains that the deep layer is unavailable instead of reporting unchecked work as passed.
- Multi-language repositories work better because common backend, scripting, mobile, config, and systems languages enter the same pre-check mainline.
- In real engineering work, the speedup comes mainly from avoiding detours: fewer irrelevant files, fewer repeated tool calls, and fewer late discoveries of simple errors. The exact acceleration depends on repository size, language toolchains, task type, and model behavior, but in multi-file navigation, cross-language edits, and post-edit verification, the user should feel the model reaches the actual work sooner instead of wandering through the repository.
- For token cost, pre-check and indexing are complementary. The index provides fast structured code facts, while pre-check provides engineering signals before and after changes. Together, they let the model spend fewer tokens on ineffective search and more tokens on judgment and edits.

## June 17, 2026: Terminal Display Layer and Tool-call Chain

The terminal display layer was tightened around input/task wrapping and cursor stability, and the tool chain gained SourcePack / ReadSnippets to reduce repeated Grep/Read round trips and deliver relevant snippets faster.

This update addresses another common bottleneck: the model often has enough capability, but relevant code arrives too slowly or too scattered, causing repeated reads of the same files. SourcePack / ReadSnippets gather the relevant snippets around the task earlier, so the model can move forward along a clearer path instead of circling through search and read cycles.

### How It Works

- Terminal input, task display, long-line wrapping, and cursor rendering were tightened to reduce visual drift on Windows, PowerShell, Chinese paths, and long command lines.
- SourcePack / ReadSnippets were added to the tool-call chain so relevant code snippets can be gathered around the current task before being sent to the model.
- When the model needs code evidence, it can receive more focused context instead of repeatedly reading the same files through several separate tool calls.

### User Experience

- Long tasks and multi-step execution are easier to follow because terminal display is more stable.
- The model reaches relevant code faster, reducing repeated exploration, waiting time, and token use.
- For code review, debugging, and cross-file edits, the model is more likely to stay around the relevant snippets and close the conclusion earlier.
- The main engineering benefit is fewer tool round trips: relevant snippets are handed to the model earlier, so it does not need to repeat Grep, Read, Grep again, and Read again. Small tasks feel smoother, and large tasks have less noisy exploration at the front.
- The user's mental load also drops. With steadier terminal rendering, long commands, logs, task status, and cursor position are easier to follow, making it clearer whether Linghun is reading code, running a command, waiting for results, or verifying the change.
