# Linghun Updates

This page records product updates that directly affect user experience. For the full system design, see the [English Whitepaper](../WHITEPAPER.en.md).

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
