# Linghun Whitepaper

## An Evidence-first AI Coding Terminal for Real Engineering Workflows

Linghun is an open-source, local-first AI coding terminal. It is not a thin shell that simply forwards user input to a model. It organizes models, tools, permissions, evidence, verification, context, cost, and long-running tasks into an auditable engineering runtime.

It is designed for continuous development in real repositories, not demo-style question answering: reading code, changing code, running commands, verifying results, creating stable points, running parallel work, preserving project rules, learning from failures, controlling cost, and finally producing delivery conclusions with explicit evidence boundaries.

Linghun's core claim is:

> What truly slows down AI coding is not that models cannot write code. It is that they too easily give confident conclusions before reading facts, running verification, or confirming boundaries.

Linghun starts from evidence-first. A model can reason and generate, but critical engineering conclusions must be traceable to facts. The system needs to know which files were read, which tools were executed, which verification commands ran, what the Git state is, whether the index is fresh, whether a failure really happened, and whether the final claims are supported by evidence.

---

## Product Philosophy: Strong Foundation, Engineering Discipline, Low Learning Cost

Linghun is no longer just "a terminal UI around a model." It decomposes AI coding into composable modules: model understanding, tool execution, permission decisions, evidence recording, verification loops, cache cost, long-term context, failure reflection, Git stable points, multi-agent work, and local process supervision. These modules are then connected to one auditable engineering mainline.

Linghun's product philosophy can be summarized in three statements:

- **Strong foundation**: the model does not touch the repository directly. It enters the engineering world through provider runtime, tool runtime, permission runtime, evidence runtime, verification runtime, Git runtime, memory runtime, job runtime, and Windows process guard.
- **Engineering discipline**: every critical action has state, boundaries, logs, evidence, failure downgrade behavior, and diagnostic entry points. The system does not merely ask the model to "be careful"; it constrains facts and behavior on the mainline.
- **Low learning cost**: users can work in natural language. Complex capabilities are exposed through slash commands, command panel, doctor, details, and progressive disclosure. Beginners do not need to understand every mechanism first, while advanced users can expand diagnostics and control surfaces.

Code hygiene is also part of this philosophy. Linghun does not want AI to write process explanations such as "what I did", "this is a demo", or "temporary debugging" into source code. It also discourages meaningless comments as a substitute for clear naming. Explanations belong in replies, reports, reviews, or handoff records. Source code should keep only information that has long-term maintenance value.

Together, these three ideas form Linghun's long-term design principle: use a strong foundation to carry strong models, use engineering discipline to reduce uncertainty, and use low learning cost to let ordinary developers benefit in real work. Users see a developer workbench that can chat, execute, verify, roll back, and accumulate experience. Internally, the system is a runtime that continuously constrains facts, permissions, cost, and risk.

Controlled memory, self-learning, and reflection make this workbench avoid starting from zero every turn. Linghun gradually adapts to the user's wording, verification habits, project rules, and common commands, reducing the cost of re-explaining the same context. In later similar tasks, the model can work more smoothly, drift less often, and repeat fewer mistakes.

### Value of a Strong Foundation

A strong foundation is not about making the architecture look elegant. It solves real sources of instability in development:

- No matter how strong a model is, it cannot know current workspace facts out of thin air. That is why Read, Grep, Index, Diff, and Evidence are needed.
- No matter how powerful tools are, they must not bypass local machine safety. That is why permission, workspace trust, path guard, and resource cap are needed.
- No matter how fluent an answer is, it must not present unverified conclusions as complete. That is why final answer gate, verification level, and readiness are needed.
- No matter how long a conversation is, context cannot be appended forever. That is why cache, summary-first output, handoff, and controlled memory are needed.
- No matter how complex a task is, background processes must not run away. That is why background task, durable job, process guard, and runner fallback are needed.

The user-facing result is fewer wrong judgments, less rework, less repeated explanation, lower context cost, easier rollback, and more confidence using AI in real projects.

### Value of Engineering Discipline

Linghun turns "AI coding" from a one-off answer into an engineering loop:

- Input stage: natural language, slash commands, Start Gate, and permission confirmation each follow clear paths.
- Understanding stage: the model sees projected RuntimeStatus, EvidenceSummary, ControlledMemorySummary, and FailureLearningSummary instead of all internal noise.
- Execution stage: tool calls pass through schema, runtime validation, permission, path safety, and result normalization.
- Observation stage: usage, cache, background task, verification, Git, index, and failure learning are recorded as structured state.
- Output stage: the final answer checks claims, evidence, completeness, architecture boundaries, current facts, and Git operations.
- Reflection stage: real failures become manageable lessons that warn the model in later similar tasks.

This makes Linghun closer to an engineering runtime than a chat window. Its direct value is not "more process"; it removes waste from the mainline:

- Less repeated explanation: project rules, memory, handoff, and workspace snapshot prevent the model from relearning background every round.
- Less repeated file reading: index, cache, evidence summaries, and changed files help the model locate relevant code faster.
- Fewer invalid tool calls: stable tool schema, deferred tools, and result summaries avoid pushing long logs and low-value tool lists into context.
- Less false completion: verification, readiness, and final answer gate reduce rework caused by "it looked complete but was not actually closed."
- Less cache breakage: CacheFreshness and stable prompt/tool ordering help preserve prompt cache reuse.
- Less background task sprawl: job, agent, resource cap, and process guard prevent long tasks from slowing down the main conversation.

The user experiences fewer wasted tokens, faster responses, lower API cost, fewer rework cycles, and more stable stage-by-stage delivery.

### Value of Low Learning Cost

Low learning cost does not mean removing advanced capabilities. It means placing complexity at the right layer:

- By default, users can simply describe what they need. They do not need to memorize every command.
- Common capabilities have short slash entries. Advanced capabilities are discoverable through `/help all`, doctor, and details.
- The main screen is summary-first. Full logs and diagnostics stay in Ctrl+O, details, artifacts, and doctor.
- Chinese and English expressions cover common workflows. Users do not need to translate real engineering intent into fixed English commands.
- Linghun treats Chinese developer environments as first-class: Chinese requirements, mixed Chinese/English terminology, Chinese paths, paths with spaces, Windows terminals, PowerShell, cmd.exe, Chinese diagnostics, and private configuration paths.
- `/model setup`, provider.env, and doctor source diagnostics lower the configuration barrier.
- `/memory review`, `/failures`, `/cache`, and `/problems` are user-facing management surfaces rather than hidden internal state.

As a result, new users can first treat Linghun as an executable AI coding terminal. Chinese developers can use their everyday language to describe tasks, verification, indexing, Git stable points, and troubleshooting. As tasks become more complex, they can gradually open memory, agents, jobs, runner, and remote channels.

---

## 1. Product Positioning

Linghun is positioned as a local developer workbench:

- It uses a terminal TUI to support daily coding, review, verification, and long-running tasks.
- It uses Chinese-friendly natural language and diagnostic entry points to support real developer expression, rather than serving only users fluent in English commands.
- It uses staged engineering orchestration to connect requirement understanding, code location, implementation, verification, stable points, handoff, and failure reflection, improving the success rate of moving new projects from idea to runnable product.
- It uses durable jobs, background tasks, agent transcripts, budgets, step limits, logs, reports, and handoff to host long tasks, so complex work has observable state from goal, plan, and execution to handoff.
- It uses evidence-first, verification boundaries, and architecture constraints to move from "AI generates code" toward "AI participates in product-grade project delivery", reducing the gap between demos, sample code, and hallucinated answers.
- It uses multi-model routing to assign planning, execution, review, verification, summarization, vision, and image tasks to role-specific models.
- It uses tool runtime to connect file read/write, search, Bash, Todo, Diff, Git, worktree, index, and verification to the same mainline.
- It uses permission strategy, path safety, command semantic classification, and user confirmation to protect the local workspace.
- It uses evidence and final answer gates to suppress "said without reading", "said without running", and "said complete without completion."
- It uses sessions, handoff, controlled memory, and failure learning to support long-term engineering context.
- It integrates external capabilities through MCP, skills, plugins, hooks, remote adapters, and native runner boundaries without allowing them to bypass local permissions.

Linghun's target users include:

- Individual developers who want an open-source, locally controllable AI coding terminal that can be used long term.
- Chinese developers and beginner developers who want to complete real projects through natural language, mixed Chinese/English terminology, and AI collaboration instead of learning a complex command system first. Windows/PowerShell environments and Chinese paths should work by default.
- Teams and open-source maintainers who want AI-assisted development to remain traceable through transcripts, evidence, verification, permissions, and Git stable points.
- Engineering tool developers who want a clean runtime for integrating providers, MCP, skills, plugins, jobs, agents, or remote approval.

---

## 2. User Pain Points and Practical Benefits

The cost of real AI coding is not only the API bill. Larger waste often comes from repeated explanation, repeated file reading, unstable tool schema, cache breakage, long logs polluting context, the model misjudging completion, failures that are not reflected on, and leftover Windows long-running processes.

Linghun addresses these pain points as follows:

| User pain point | Linghun's approach | User benefit |
| --- | --- | --- |
| The model concludes without seeing facts | EvidenceSummary, tool results, index evidence, final answer gate | Fewer misleading confident answers and less rework. |
| A change runs but damages project architecture | Architecture evidence, boundary checks, drift detection, delivery consistency gate | Prevents local fixes from damaging dependency direction, module responsibility, and long-term maintainability. |
| Large files, generated artifacts, or long code blobs consume context | Index large-file safety gate, ignore/repair flow, AntiCodeBlob architecture hints | Prevents low-value content from swallowing index and prompt space, and reduces logic piling into giant files. |
| Frontend/TUI changes run but feel broken | Frontend constraints, layout boundaries, details/summary layers, terminal capability fallback | Reduces text overlap, main-screen noise, narrow-screen breakage, and fractured interactions. |
| New projects often stop at AI demos | Staged engineering loop, Todo, verification, architecture constraints, stable points, handoff | Beginners can use natural language to keep moving the project toward a runnable, verifiable, maintainable product. |
| A new project has no engineering rules, so the model guesses every round | `LINGHUN.md` project rules, explicit `/memory init` base template, rule summaries, and cache freshness | Establishes fact-first, permission, verification, code hygiene, and minimal-change boundaries from an empty repository, reducing the chance that beginners make the project messier over time. |
| AI leaves explanations and temporary thoughts in code | Mature engineering defaults, code hygiene constraints, patch summary, review/verification | Reduces meaningless comments, temporary code, debug residue, and explanatory noise so code looks more maintainable. |
| Complex tasks cannot be safely delegated to AI | Durable jobs, agents, budget, maxSteps, timeout, logs, reports, handoff, verification boundary | Long tasks have state from goal to execution, observation, pause/cancel, and handoff. Users do not need to stare at model output constantly. |
| Project context must be re-explained every round | Project rules, handoff, controlled memory, Workspace Snapshot Lite | Long-running projects become more stable and use fewer repeated tokens. |
| Tool lists and MCP changes break prompt cache | Stable core tool schema, deferred tools, stable ordering, deferredToolListHash | More tools do not require all schemas to be resident in every prompt, so cache stays more stable. |
| Long logs, full index, and full history flood context | Summary-first, details, fullOutputPath, log artifact slices, bounded workspace summary | Cleaner main screen, shorter prompts, and less model distraction from noise. |
| Users do not know where money is going | Usage/cache history, hit rate, read/write tokens, `/usage`, `/cache`, `/cache-log` | Users can see cache reuse and token consumption instead of flying blind. |
| Cache suddenly gets worse and the cause is unclear | CacheFreshness, changedKeys, `/break-cache status`, cache break marker | Users can identify whether the source is system prompt, tool schema, MCP list, model, memory, rules, or cache control. |
| Partial tests are described as full completion | Verification level, readiness, `/review`, final answer downgrade | Prevents focused/mock/synthetic PASS from being presented as overall readiness. |
| Git operations and worktrees can get out of control | Git stable point, managed worktree, dirty/force/path escape guard | Users can create a stable point before the next stage, making rollback and parallel development more controllable. |
| Multiple agents can burn tokens and resources | Role route, independent transcripts, background surface, resource cap, job budget | Parallel exploration becomes controllable without allowing background tasks to overwhelm the main session. |
| The system has to re-learn user habits every round | Controlled memory, memory review, accepted-only injection | The user's phrasing, command habits, verification preferences, and project rules gradually accumulate, making later collaboration smoother. |
| The same failure happens again later | Failure learning, reflection records, resolve/ignore | Real failures become risk hints instead of disappearing in logs. Later similar tasks are less likely to repeat the same mistake. |
| Windows long tasks leave residue | Process Guard, Windows process tree stop, Native Runner Job Object contract | Cancellation, timeout, and exit cleanup are more reliable in everyday Windows development environments. |

Overall, Linghun aims to provide fewer hallucinations, fewer repeated tokens, higher cache reuse, less rework, more controllable local execution, and better support for long-running projects.

For individual and beginner developers, these problems are amplified. Teams may rely on senior reviewers, CI, architecture conventions, and DevOps processes as guardrails. Personal projects often leave one person facing model output, dependency upgrades, failed tests, Git rollback, and environment setup alone. Beginners are especially likely to be misled by answers that look complete: the model says it fixed the code, but they do not know whether it read the right files; the model says tests passed, but they do not know the verification scope; the model suggests a refactor, but they do not know whether it violates project boundaries.

Linghun brings these implicit engineering habits into the tool:

- "Read facts before concluding" becomes a default constraint.
- "Create a stable point before major changes" becomes a natural workflow.
- "Test results must state scope" becomes a final answer requirement.
- "Failures should be reflected on and warned about next time" becomes a system capability.
- "Chinese, Windows, PowerShell, and Chinese paths should be normal paths" becomes a product boundary.
- "API cost and cache hit rate should be visible" becomes a diagnostic metric.

This means Linghun does not merely save time for experts. It also embeds some senior engineering habits, risk awareness, and delivery checks into the development tool itself.

---

## 3. Capability Overview

| Capability area | Current capability |
| --- | --- |
| Engineering loop | A staged mainline from requirement understanding, code location, implementation, verification, stable point, handoff, and failure reflection. Suitable for moving new projects from idea to runnable product. |
| Evidence and anti-hallucination | EvidenceSummary, completeness checks, code fact checks, architecture/boundary checks, Git operation checks, freshness rules for current external facts, final answer retry/downgrade. |
| Long-task hosting | Durable jobs, background tasks, agent transcripts, budgets, step limits, runtime, logs, reports, handoff, verification boundaries. Supports continuous observability from goal to handoff. |
| Multi-model routing | Planner, executor, reviewer, verifier, summarizer, vision, and image role routes. Role-level provider/model/capability/budget/permission configuration. |
| Tool system | Read, Write, Edit, MultiEdit, Grep, Glob, Bash, Todo, Diff. Tool schema, tool result summaries, changed file tracking, and full Bash log archiving. |
| Editing safety and code hygiene | Read-before-edit, expectedHash, stale-file guard, unique replacement, patch summary, change summary, workspace path boundaries. Mature engineering defaults constrain meaningless comments, temporary code, debug residue, demo phrases, and explanatory noise from entering source code. |
| Verification and readiness | `/verify plan/last/smoke`, verification logs, PASS/PARTIAL/FAIL/TIMEOUT/STALE/CANCELLED semantics, `/review`, `/doctor`, `/problems`, readiness, and cost preview. |
| Architecture system | Architecture evidence queries, boundary claim checks, architecture drift detection, frontend/TUI experience constraints, AntiCodeBlob and code hygiene hints, final delivery consistency checks, handoff architecture cards. |
| Git workflow | Git status inspection, stable point creation, checkpoint, managed worktree create/remove, path escape protection, dirty/force boundaries, Git operation evidence. |
| Index and workspace awareness | codebase-memory parsing and diagnostics, fast index status, explicit freshness check, index search/architecture evidence, Workspace Reference Cache, Workspace Snapshot Lite, large-file safety scan. |
| Cache and cost reduction | Prompt cache usage parsing, hit rate, cache history, CacheFreshness, break-cache, stable tool ordering, deferred tools, summary-first prompt control. |
| Project rules | Detects `LINGHUN.md` on startup; when missing, shows only a light hint; creates a base template only when the user explicitly runs `/memory init`; rule summaries feed `/memory`, `/resume`, readiness, and CacheFreshness without dumping the full file to the main screen. |
| Long-term context | JSONL transcript, session store, handoff packet, project rules, controlled memory, candidate-first long-term memory, failure learning. memory/session/job/log/cache support project-level, user-level, and custom storage boundaries. The goal is not rote memorization, but making later tasks feel more like working with the same experienced collaborator. |
| Multi-agent and long tasks | `/agents`, `/fork`, `/job`; explorer/planner/verifier/worker; independent transcripts; background tasks; durable jobs; budgets, steps, runtime, and concurrency caps. |
| Permission system | Four modes: default, auto-review, plan, full-access. Command semantic classification, path safety classification, persistent allow rules, denial records, and remote approval routed back into local permission pipeline. |
| Model runtime | OpenAI-compatible, DeepSeek, and Anthropic Messages-style endpoints; streaming output; tool calls; usage; reasoning; timeout and idle timeout; provider diagnostics and failure summaries. |
| Windows supervision and compatibility | Windows process tree stop, exit cleanup, Native Runner Job Object contract, ConPTY/terminal capability detection, lowercase/uppercase CLI entries, Chinese/space paths, and private provider.env configuration path. |
| Self-learning and reflection | Controlled memory auto-learning, candidate-first confirmation flow, secret filtering, failure learning, real failure reflection, lesson projection, resolve/ignore lifecycle. Stable preferences and real lessons become hints for next time, making the model better aligned with the user and less likely to repeat mistakes. |
| Extension ecosystem | MCP metadata, deferred tools, skills, plugins, workflows, hooks, manifest/trust/enable/disable/status/doctor. |
| Remote boundary | WeCom, Feishu/Lark, DingTalk remote channel configuration model; summary-only redaction; approval/job/verification event types; replay/signature/binding/source checks. |
| Output and interaction | Summary-first main screen, details expansion, command panel, status footer, slash suggestions, background task surface, bounded log artifact slices. |

---

## 4. Evidence-first Engineering Loop

Linghun separates "what the model says" from "what the system knows."

The model can propose plans, explain code, or generate changes from context, but the following conclusions must be supported by evidence:

- "This is how the code is implemented."
- "This change respects architecture boundaries."
- "There is no architecture drift."
- "All tasks are complete."
- "Tests passed."
- "This is ready to release."
- "A Git stable point has been created."
- "External information is up to date."

Linghun's evidence sources include:

- File reads, searches, and diffs.
- Tool call results and changedFiles.
- Bash and verification logs.
- Git status, commits, and worktree operation results.
- Index search and architecture query results.
- Workspace snapshot, cache freshness, and runtime status.
- Provider live observation and model doctor diagnostics.
- Historical lessons from real failures in failure learning.

Failure learning and long-term memory are not treated as evidence of completion for the current task. They enter model context only as risk hints, helping the model be more cautious in similar situations.

---

## 5. Staged Engineering Workflow

Linghun's engineering discipline does not drag users into unnecessary process. It makes explicit the stages that already exist in real development but are often ignored. Individual developers and beginners are especially likely to pay hidden costs here: not knowing whether the model truly understood the project, whether a change crossed boundaries, what a passing test actually means, whether a failure will happen again, or why API cost suddenly increased.

Linghun decomposes an AI coding task into observable engineering stages:

| Stage | Pain without engineering discipline | Linghun's handling | User benefit |
| --- | --- | --- | --- |
| Environment and model setup | Beginners often get stuck on keys, baseUrl, model capability, network, and config file locations. Too many errors make it unclear whether the model is unavailable or the setup is wrong. | Provider runtime, model doctor, private provider.env configuration, role-based model routing. | Configuration issues have source diagnostics, so individual developers do not have to locate model, network, key, or endpoint issues by trial and error. |
| Requirement understanding | Real developer language is often Chinese, mixed-language, and context-light. Rigid commands or local misclassification can push the task off track. | Natural language goes to the model by default; slash and confirmation flows are deterministic local entries; RuntimeStatus projection reduces internal noise. | Users can say "build a project", "fix this bug", or "create a stable point first" in everyday language without learning a tool grammar first. |
| Project startup | From an empty project to a runnable version, dependencies, directories, entry points, styles, verification commands, and README often remain inconsistent, leaving the result at demo stage. | Todo, tool execution, verification plan, architecture constraints, Git stable point, and handoff form a staged mainline. | Beginners can work with AI to move the project toward a runnable, verifiable, maintainable state. |
| Code location | The model repeatedly reads irrelevant files, or concludes before reading key files. Beginners do not know what to ask the model to inspect. | Grep, read, index search, workspace snapshot, changed files, and evidence summary work together. | Reduces repeated tokens and waiting time, helping the model focus on relevant code. |
| Implementation | Tool calls, Bash, editing, and paths are mixed together, making over-permission, wrong-file edits, or edits based on stale content more likely. | Tool schema, permission mode, path guard, expectedHash, stale-file guard, resource cap. | Personal projects receive protection closer to team engineering norms without requiring the user to watch every step. |
| Code hygiene | AI can write explanatory noise, meaningless comments, or debug residue such as "this is the logic I added", "temporary debug", or "for demo" into source code. | Mature engineering defaults, code hygiene hints, patch summary, review/verification, and architecture boundaries. | Code looks more like something a human engineer would commit, reducing cleanup and review cost. |
| Architecture and frontend experience | Running code does not mean healthy structure. Frontend/TUI changes can still create main-screen noise, text overlap, narrow-screen breakage, and unreadable details. | Architecture evidence, boundary checks, drift detection, frontend/TUI constraints, delivery consistency gate. | Reduces the risk of "local fix, global mess", making the product closer to a maintainable tool than a one-off script. |
| Verification and readiness | Focused tests, mocks, and synthetic smoke are easily described as "all passed", with gaps only discovered before release. | Verification level, readiness, review, problems, final answer gate. | Users can see what was verified and what was not, reducing pre-release rework. |
| Git stable point | Halfway through a change there may be no rollback point, and the next round of changes makes recovery hard. Beginners are especially afraid of breaking the project. | Git stable point, checkpoint, managed worktree, dirty/force/path escape guard. | Each stage can leave a safe point, making complex changes easier to pursue. |
| Long-task hosting | Complex tasks require repeated change, run, fix, verify, and handoff. Watching the screen is tiring and still does not tell the user whether the task is stuck. | Durable job, multi-agent transcript, budget, maxSteps, timeout, logs, report, handoff, verification boundary. | Long tasks have state from goal to execution, observation, pause/cancel, and handoff. Users do not need to guard the model constantly. |
| Cost and context | Every round repeats explanation and file reads; tool list changes break cache; the bill rises without explanation. | Prompt cache usage, CacheFreshness, deferred tools, summary-first, cache-log. | Higher cache reuse, fewer repeated tokens, and easier cost diagnosis. |
| Memory and data location | On company machines, Windows multi-drive setups, or limited C drives, users do not want memory, logs, jobs, and cache forced into one fixed location. | Project/user/custom storage; project/user/session memory; `/memory storage` displays actual paths; `LINGHUN_DATA_DIR` can change user data root. | Memory and runtime data can be managed by project, user, or custom directory, fitting Windows and enterprise environments. |
| Failure reflection | A failure remains only in scrolling logs and the next similar task repeats it. | Failure learning, reflection records, redaction, deduplication, resolve/ignore. | Real failures become future risk hints, making long-term projects steadier over time. |

The core value of this staged design is turning work that usually depends on manual experience into system defaults. For individual developers, it reduces the mental load of context management, rollback, verification, and cost diagnosis. For beginners, it embeds engineering norms in the tool runtime so they can complete tasks first and gradually understand the mechanisms behind them.

---

## 6. Output-side Anti-hallucination System

Linghun does not rely on simple input keyword interception to understand user intent. Ordinary natural language should go to the model by default. Explicit slash commands, UI operations, and pending confirmations go through deterministic local entries.

The critical constraints are placed on the output side.

When the model is about to produce a final answer, Linghun checks whether high-risk claims have corresponding evidence. If evidence is insufficient, the system can trigger one controlled retry. If the retry still fails, the answer is downgraded to a conservative response, preventing unsupported success claims from entering the transcript.

This system covers several layers:

- **Code facts**: the model must not assert source facts without reading or searching.
- **Completeness**: partial verification must not be packaged as full completion.
- **Architecture and boundaries**: the model must not claim no drift or boundary closure without architecture evidence.
- **Verification state**: build, mock, focused, or synthetic smoke must not be described as real full-pass verification.
- **Current external facts**: latest versions, prices, news, or external service states require fresh sources or explicit unverified labeling.
- **Git operations**: claims that stable points, checkpoints, or worktrees were created require real Git operation evidence.

Linghun does not treat confident model expression as an engineering conclusion. Critical conclusions must pass evidence, verification, and boundary checks before entering the final delivery wording.

### Anti-hallucination Smoke Design

Linghun's anti-hallucination system has been tested with real-model interaction smoke scenarios, not only unit tests or prompt instructions.

Typical adversarial prompts covered include:

| Induced scenario | Expected risk | Linghun's blocking behavior |
| --- | --- | --- |
| Asking the model to directly claim "architecture boundaries are respected / no architecture drift" | The model gives an architecture conclusion without evidence | The model asks to inspect diff/evidence first; the final answer gate also checks architecture evidence. |
| Asking the model to claim "all tasks are complete, nothing is missing" | Local facts are packaged as full closure | Completion gate requires completeness classification and evidence; insufficient evidence leads to downgrade. |
| Inducing "verified / PASS / ready to release" | Success is announced without verification | Verification/readiness/final gate require real verification records and scope. |
| Asking current model identity | Provider, baseUrl, endpointProfile leak | Normal answers expose only model name; provider details stay in doctor. |
| Triggering deferred tools or internal dispatcher wording | Internal tool names and execution details leak to main screen | Default main screen is noise-reduced; raw tool_result remains in diagnostics. |
| Calling resource guard a fifth permission mode | The model invents the permission model | Runtime status and invariants preserve only the four permission modes. |
| Claiming a stable point was created without Git tool call | Empty Git success claim | Git operation claim must bind to real tool evidence. |

This shows Linghun's anti-hallucination system is not "ask the model to behave." It is layered:

- Prompt layer tells the model the evidence boundary.
- Runtime layer records facts from tools, verification, Git, index, memory, and failures.
- Final answer layer checks high-risk claims.
- Transcript layer prevents violating text from becoming the final delivery record.

The core risk covered by smoke design is "claiming completion, verification, architecture closure, Git success, or runtime identity without facts." Linghun uses prompt, runtime, final answer gate, and transcript constraints to isolate these high-risk outputs from final delivery records.

---

## 7. Architecture System

In real engineering, making code "work" is only the first requirement. The harder part is not damaging project boundaries over time. A local fix can pass tests while pulling module responsibilities, dependency direction, runtime boundaries, or delivery wording off course. Linghun's architecture system is designed for this problem.

It focuses not on abstract architecture diagrams, but on verifiable architecture facts in the current repository:

- Which modules carry mainline responsibilities.
- Which logic should exist only as pure functions or presenters.
- Which runtimes may have side effects, and which should only project or format.
- Which capabilities are connected to the mainline, and which are only prompt-level, side-path, or diagnostic entries.
- Whether a new project, new system, new feature, new page, or new module forms a target, known facts, recommended path, staged breakdown, risks, verification method, and nonGoals before implementation.
- Whether the current change pushes responsibilities back into a giant entry file.
- Whether new pages, flows, long tasks, or UI/TUI work continue piling logic into existing giant files.
- Whether frontend and TUI changes respect layout, readability, summary-first, details layering, and terminal capability fallback boundaries.
- Whether source code contains explanatory noise, temporary debugging, meaningless comments, demo residue, or process descriptions that should not be committed.
- Whether final delivery claims match real runtime wiring.

Linghun's architecture system has several layers:

- **Architecture evidence**: obtains current code structure facts through index, search, file reads, and architecture summaries.
- **Boundary checks**: determines whether claims such as "boundary closed", "connected to mainline", or "behavior unchanged" have source evidence.
- **Drift detection**: compares current changes with architecture cards to identify responsibility backflow, side-path implementations, duplicate runtimes, permission bypasses, or diagnostic leaks.
- **New project planning card**: when the user asks for a new system, feature, page, module, or cross-file implementation, the architecture system organizes target, project facts, recommended approach, rejected approaches, staged breakdown, risks, verification items, and nonGoals into an Architecture Card. It is not a full spec platform and does not force small fixes into Plan mode; it helps new projects avoid "write a pile first, repair later" from the first step.
- **AntiCodeBlob hint**: for new features, pages, flows, long tasks, UI development, or cross-file changes, the model is reminded not to pile logic into god files, overly long functions, deep nesting, or unbounded global state. This is an architecture risk hint, not a permission change or authorization for large refactors.
- **Code hygiene hint**: "do not write explanations into code, do not leave temporary debugging, do not use meaningless comments instead of clear naming, and do not leave demo wording in source" is treated as part of product-grade delivery.
- **Frontend/TUI constraints**: summary-first main screen, details expansion, command panel, status footer, scrolling viewport, narrow/legacy terminal fallback, no text overlap, and long-output archiving are treated as architecture boundaries, not only business-code concerns.
- **Final delivery consistency**: before final answer enters transcript, the system checks whether the delivery summary exaggerates architecture state.
- **Handoff preservation**: architecture cards, risks, and pending items are preserved in handoff so the next task does not start from zero.

The user value is direct: developers do not need to rely only on manual review to remember every module boundary, nor believe a model sentence like "mainline is connected." When Linghun handles large refactors, index splitting, Git runtime, failure learning, multi-agent work, or Windows runner features, the architecture system turns "is it actually connected, did it cross boundaries, is it only a prompt patch" into auditable questions.

The architecture system also follows evidence-first. Historical architecture notes, memory, and failure learning can warn the model, but they do not replace source evidence for the current task. Without reading relevant code, seeing wiring locations, and verifying the main path, the model must not write "architecture boundary respected" as a certain conclusion.

---

## 8. Role-based Multi-model Routing

Linghun supports configuring models by role instead of choosing only one global model.

Built-in roles include:

- `planner`: planning, decomposition, and approach comparison.
- `executor`: main coding execution.
- `reviewer`: review, risk identification, and read-only checks.
- `verifier`: verification, test interpretation, and delivery judgment.
- `summarizer`: long-context summarization and handoff.
- `vision`: visual input related capability.
- `image`: image generation or image-related task entry.

Each role can configure:

- Provider and primary model.
- Fallback models.
- Required capabilities: text, tools, vision, image, thinking, promptCache.
- Maximum input/output tokens.
- Cost ceiling.
- Whether tools, file writes, and Bash are allowed.
- Whether confirmation is required before running.

This lets Linghun separate "a model good at writing code" from "a model good at auditing", "a model good at summarizing", or "a model suitable for visual tasks." Role routing is also exposed through `/model route` and `/model route doctor`, so users can see whether the current configuration is actually usable.

---

## 9. Provider Runtime

Linghun's provider layer supports multiple endpoint shapes:

- `chat_completions`
- `responses`
- `anthropic_messages`

Runtime capabilities include:

- Streaming text output.
- Thinking / reasoning configuration.
- Prompt cache input.
- Usage and cache usage statistics.
- tools/toolChoice.
- OpenAI-style function calls and Anthropic-style tool_use/tool_result adaptation.
- Provider request timeout and stream idle timeout.
- Retry status and max attempts.
- User-readable provider failure summaries and diagnostics.
- Provider circuit breaker / cooldown to avoid wasting repeated requests during continuous failures.

Model identity display is noise-reduced. When a normal user asks "what model is current", Linghun answers with only the model name. Provider, baseUrl, endpointProfile, and other internal fields do not appear by default in the main screen or prompt projection; they are available through doctor.

Sensitive configuration such as API keys and baseUrl should live in user-private config or environment variables. Doctor displays source and redacted state, not plaintext keys.

---

## 10. Tool Execution and Editing Safety

Linghun's built-in tools cover the most common actions in real development:

- `Read`: read files.
- `Write`: write a full file.
- `Edit`: unique single replacement.
- `MultiEdit`: multiple replacements in the same file.
- `Grep`: regex search.
- `Glob`: path pattern search.
- `Bash`: run commands.
- `Todo`: maintain task state.
- `Diff`: inspect changes.

Editing capabilities are not just "can write files." They include:

- Read snapshot: records hash, mtime, and size when a file is read.
- expectedHash: checks before write/edit that the file is still the version the model saw.
- stale-file guard: blocks writing based on stale context after the file changed.
- Unique replacement requirement: Edit/MultiEdit avoid ambiguous replacement.
- Patch summary: records changed files, line additions/deletions, and risk files.
- changedFiles: propagates changed files to context and verification.

### 10.1 Code Hygiene: Keep Explanations in Delivery Text, Not Source Code

Code hygiene is part of editing safety. Linghun's mature engineering defaults require the model to leave explanations in replies, reports, or handoff, not in source code. Code should keep only comments with long-term maintenance value.

This targets a common quality problem in AI coding: the code runs, but contains process descriptions, demo phrases, temporary debugging, meaningless TODOs, unused branches, or AI comments that exist only to say what the model did. These may not break functionality immediately, but they increase review, maintenance, and later development cost.

Linghun treats such content as delivery noise. Mature engineering defaults, architecture hints, patch summary, review, and verification continually remind the model to keep source clean. This does not mean code should have no comments. It means comments should serve long-term maintenance, not model self-explanation.

Bash tool output uses preview plus fullOutputPath: the main screen shows a readable summary, while full stdout/stderr goes to log artifacts, avoiding long-log pollution of the main screen, prompt, memory, and handoff.

---

## 11. Stable Tool Calls and Cost Reduction

In an AI coding terminal, cost and speed depend heavily on prompt cache. Byte-level changes in tool schema, system prompt, MCP list, model routing, project rules, memory, compact boundaries, or cache control can invalidate otherwise reusable context.

Linghun treats cache stability as a runtime capability, not an after-the-fact billing statistic.

### 11.1 Stable Tool Call Chain

Linghun's tool-call stability comes from several layers:

- Core tool schema is generated by a unified registry.
- OpenAI chat, OpenAI responses, and Anthropic Messages endpoints have explicit tool schema/result shapes.
- Tool arrays are sorted by name to reduce non-semantic order changes that break cache prefixes.
- Anthropic tool_use/tool_result shapes are paired; missing pairs generate diagnosable error tool_results to avoid continuation breakage.
- Deferred tools do not all enter the API tools array directly. They are exposed through discovery and proxy execution paths similar to SearchExtraTools / ExecuteExtraTool.
- MCP, skills, plugins, and codebase-memory extension tools default to stable summaries and discovery catalogs, reducing tool-list churn.
- deferredToolListHash tracks extension tool list changes separately from core toolSchemaHash.

The user benefit is that having more tools does not mean every prompt becomes bloated. Extension capabilities remain available, but tool schema changes are less likely to spread into a full cache bust.

### 11.2 Prompt Cache and Usage Tracking

Linghun parses and records multiple provider usage fields:

- Input tokens.
- Output tokens.
- Cache read tokens.
- Cache write / cache creation tokens.
- Anthropic ephemeral 5m / 1h cache creation fields.
- OpenAI-compatible cached_tokens.
- Endpoint and provider source.

Cache hit rate is calculated as `cacheRead / (input + cacheWrite + cacheRead)`, with output excluded from the denominator. `/cache`, `/cache-log`, `/usage`, and `/stats` can show recent rounds, read/write tokens, hit rate, model, provider, endpoint, and compact state.

This helps users answer three practical questions:

- Why was this round expensive?
- Has cache performance recently degraded?
- Is the model/provider not returning fields, or did the system truly miss cache?

### 11.3 CacheFreshness and Break Cache

Linghun tracks freshness dimensions that affect cache:

- systemPromptHash.
- toolSchemaHash.
- mcpToolListHash.
- modelProviderHash.
- reasoningEffortHash.
- projectRulesHash.
- memoryHash.
- compactHash.
- pluginListHash.
- endpointProfileHash.
- cacheControlHash.
- cacheTtlHash.
- contextEditingHash.
- cacheEditingBetaHash.
- deferredToolListHash.

When changedKeys appear, Linghun can tell users where the cache change came from instead of only saying "it got slower." `/break-cache` supports once/always/off markers and explicitly breaks prompt cache through a nonce when the user needs to force-refresh context.

### 11.4 Summary-first Is Also Cost Reduction

Linghun does not place full logs, full index, full transcript, full memory, or full tool_result into model context by default.

Cost reduction paths include:

- Summary-first main screen.
- details carries full content.
- Bash/verification/job output writes fullOutputPath.
- Log artifacts read only bounded slices.
- Workspace Snapshot Lite provides only bounded summaries.
- Memory injects accepted-only topK.
- Failure learning projects only short lessons.
- RuntimeStatusForModel excludes provider/baseUrl/endpointProfile noise by default.
- `/index status` defaults to the fast path; slow checks run only with explicit `--fresh` or `/index check`.

These mechanisms reduce the impulse to "put everything in so the model knows the situation", lowering token waste and cache churn at the source.

### 11.5 Reference Cache Targets

In continuous workflows with stable project, stable model, and stable tool list, Linghun's cache reuse targets are:

- For stable project, stable model, stable tool list, and stable system prompt, target cache hit rate is **92%-96%**.
- Specific highly stable samples approach **98%**.
- A small number of rounds with fully stable context, short output, and unchanged tools/schema can reach **100%**-level hit rate.
- These numbers describe targets and observed ranges under stable workflows. They do not guarantee the same result for every provider, model, or project.

The direct meaning of high hit rate is that in the same long-running project, the model does not have to "pay again" to understand the full background every round. Users also do not need to manually delete context, repeat explanations, or frequently restart sessions just to save tokens.

---

## 12. Permissions, Safety, and Resource Boundaries

Linghun's permission system is built around four modes:

- `default`: read-only and low-risk session tools are smoother; writes and Bash actions require confirmation.
- `auto-review`: low-risk edits inside the workspace can be approved automatically; high-risk actions still require confirmation.
- `plan`: planning mode; writing, editing, and Bash execution are forbidden.
- `full-access`: explicitly enabled by the local user; hard safety boundaries still apply.

The underlying policy considers more than tool name:

- Tool risk level.
- Whether the action is read-only.
- Whether paths are inside the workspace.
- Bash command semantics.
- Whether the command includes package managers, network access, destructive Git, secret env, redirection, composed commands, or other risks.
- Whether it matches persistent permission rules.

The permission system works together with:

- Permission prompt.
- Recent denied records.
- Always allow rules.
- Report write guard.
- Resource/concurrency cap.
- Process guard.
- Workspace trust.

Remote approval, agents, jobs, MCP, Git, index refresh, runner, and other capabilities cannot bypass local permission boundaries.

### 12.1 Developer Sovereignty, Safety, and Privacy

Linghun's local-first stance is not a slogan. It is made of several source-level boundaries:

- **Model and provider choice**: users can configure the default model and role routes such as planner, executor, reviewer, verifier, summarizer, vision, and image. Each role has its own provider, model, fallback, and tool/write/Bash permission boundaries.
- **Private provider configuration**: `provider.env` is user-private configuration and its template clearly says not to commit it. Shell env has higher priority. When project settings are written back, apiKey is stripped. The provider.env merge summary records only whether overrides occurred and provider ids, not apiKey, baseUrl, or model route plaintext.
- **Data location control**: storage supports project, user, and custom scopes; memory is split into project/user/session. `LINGHUN_DATA_DIR` can change the user data root. Memory, sessions, logs, jobs, cache, and index metadata are not forced into a hardcoded system drive path.
- **Long-term memory control**: memory is candidate-first, not auto-accepted or auto-injected. Accepted memory is still constrained by topK and character budgets. Auto-learning filters secrets, tokens, private keys, long base64 values, and similar inputs. Long-term writes require user review/accept.
- **Minimal remote exposure**: WeCom, Feishu, and DingTalk channels are disabled by default. The configured redactionPolicy is fixed to summary_only, allowed event types are limited to approval_request, job_status, job_report, and verification_result, with trustedSources boundaries.
- **Workspace and permission boundaries**: workspace trust, four permission modes, path safety, command semantic classification, resource cap, and process guard jointly determine whether actions may execute. Natural language, remote approval, agents, and extension tools cannot bypass the local permission pipeline.

Together, these designs point to developer sovereignty: users retain control over model choice, key location, data storage, remote exposure, long-term memory, permission actions, Git state, and final delivery wording. Safety and privacy are not extra constraints that sacrifice efficiency; they are prerequisites for individual developers and teams to confidently connect AI to real projects.

---

## 13. Git Stable Points and Managed Worktree

Linghun treats Git stable points as a first-class capability.

Users can create stable points through explicit commands, or allow the model to do so through structured Git tools. Natural-language intent is not intercepted by local regex; it enters the model tool schema, and the model calls tools when real execution is needed.

Git-related model tools include:

- `GitStatusInspect`
- `GitStablePointCreate`
- `ManagedWorktreeCreate`
- `ManagedWorktreeRemove`

Capabilities include:

- Inspect Git status and dirty workspace state.
- Create stable point commits.
- Optionally include untracked files.
- Create managed worktrees.
- Remove managed worktrees.
- Dirty worktree and force remove boundaries.
- Path escape protection.
- Sensitive untracked filtering.
- execFile argument-array execution to avoid shell concatenation.
- No dangerous deletion or dangerous branch deletion path.

The final answer gate checks Git operation claims. If the model did not actually call the tool but claims "stable point created" or "worktree created", the answer is downgraded.

---

## 14. Index, Cache, and Workspace Snapshot

Linghun supports codebase-memory-style code indexing while placing indexing inside local safety and cost boundaries.

Main capabilities include:

- `/index status`: quickly view current index status.
- `/index status --fresh` and `/index check`: explicitly run freshness checks.
- `/index init fast`: explicitly create a fast index.
- `/index refresh`: explicitly refresh the current project index.
- `/index search <query>`: query the index and record evidence.
- `/index architecture`: obtain a short architecture summary and record evidence.
- `/index doctor`: diagnose managed/bundled/index runtime availability.

Indexing is not a mandatory dependency by default. If the index is missing, unavailable, or stale, ordinary chat and local file tools still work. The index narrows the search space; conclusions still need source code and verification.

Linghun also implements Workspace Reference Cache and Workspace Snapshot Lite:

- Bounded top-level file/directory summaries.
- File count, size, mtime, and hash summaries.
- Changed summary.
- Explicit fallback-stale / fallback-empty labels.
- Cache freshness diff.
- Prompt cache break marker.

Before refreshing the index, Linghun runs a large-file safety scan. It detects high-risk paths such as oversized JSON, SQL, XML, minified files, dependency directories, build artifacts, and other risky files. When unignored large-file risk is found, indexing is blocked by default and the user is guided to `.linghunignore`, `.cbmignore`, `/index repair`, or explicit `--force`.

This safety gate targets common accidents:

- Indexing several MB or tens of MB of low-value generated files into the search space.
- Polluting prompts with lockfiles, dumps, SQL, compressed assets, or minified code.
- Lower cache hit rate due to large-file noise and unstable index results.
- The model treating generated or vendor files as business source and suggesting wrong edits.

Large-file protection and AntiCodeBlob solve two different problems. The former protects index and context cost; the latter reminds the model not to keep adding new logic into historical giant files. Both serve the same goal: keeping long-term projects searchable, understandable, and maintainable.

---

## 15. Verification, Readiness, and Problems Panel

Linghun treats verification results by their real semantics, not merely whether a command finished.

`/verify` supports:

- `plan`: generate a verification plan.
- `last`: view the most recent verification result.
- `smoke`: run a smoke-level verification entry.

Verification results distinguish:

- PASS
- FAIL
- PARTIAL
- TIMEOUT
- STALE
- CANCELLED

Synthetic smoke only proves that the minimum execution chain can run. It cannot automatically upgrade to a real provider/TUI/render/report mainline smoke. Readiness, doctor, and review preserve this boundary to prevent "local lightweight check passed" from being written as "overall releasable."

Related entries include:

- `/review`: generate a conservative review report based on recent verification and risk.
- `/doctor`: local readiness checklist.
- `/doctor project`: Project Doctor Lite.
- `/doctor runner`: Native Runner diagnostics.
- `/problems`: summarize current verification/provider/background/freshness problems.
- Log artifact: read only bounded slices, avoiding full logs in the main screen and prompt.

---

## 16. Long-term Context, Controlled Memory, Self-learning, and Reflection

Linghun's long-term context is not infinite appended chat history.

It is split into several categories:

- **JSONL transcript**: records user input, model output, tool calls, system events, and evidence.
- **session store**: supports recovery and session management.
- **handoff packet**: organizes goals, state, verification, risks, architecture cards, pending items, and next steps into structured handoff.
- **project rules**: uses LINGHUN.md or project rule files to express long-lived constraints.
- **controlled memory**: candidate-first, user-confirmed, accepted-only topK injected into prompt.
- **failure learning**: extracts reusable lessons from real failures, redacts and deduplicates them, and projects them as risk hints.

Storage location is also part of long-term context. Linghun does not hardcode memory, sessions, logs, jobs, and cache into a fixed system-drive path. Storage supports project, user, and custom scopes, and memory is split into project/user/session. Users can run `/memory storage` to see actual paths for project memory, user memory, session/handoff, sessions, logs, jobs, cache, and index metadata, and can use `LINGHUN_DATA_DIR` to change the user data root.

### 16.1 Project Rules: Establishing AI Development Order from an Empty Repository

For many beginners using AI coding tools, the hardest part is not asking questions. The problem is that the project has no rules at the beginning. The model does not know the repository's long-term goal, allowed change scope, validation commands, code style, architecture boundaries, or explicit do-not-do items, so it guesses again in every round. The first round may look fast, but later work can become repeated explanation, repeated rework, and a project that grows less coherent over time.

Linghun uses the repository-root `LINGHUN.md` as the project rules entry point. In the actual implementation, it does not silently generate this file without the user's knowledge. If project rules are missing at startup, Linghun only shows a light hint. A base template is created only when the user explicitly runs `/memory init`. The template records long-lived project rules, stable facts, common commands, and explicit constraints, and it clearly states what should not be placed in long-term rules.

The base template includes engineering boundaries such as:

- Fact first: read code, project index, documentation, or command results before judging and concluding.
- Natural-language commands must not bypass Start Gate or permission approval.
- Writing files, Bash, network access, dependency installation, and permission/config changes require explicit user confirmation.
- Long-term memory is candidate-first by default and is written only after user review/acceptance.
- After code changes, run the smallest project-approved validation that covers the touched area.
- Do not paste full transcripts, huge logs, large index results, or full memory stores back into model context.
- By default, make only the minimal change required for the current task, and do not fix unrelated issues opportunistically.
- Do not add abstractions, directory layers, or structural refactors proactively, and avoid making long files and complex branches worse.

For beginners, this creates a kind of "AI development order" for the project. Users can still move requirements forward in natural language, but the model works inside project rules, permissions, evidence, verification, and code hygiene boundaries. This reduces context waste, reduces meaningless rework, improves the chance that a new project reaches a runnable version on the first serious pass, and gives later agents, jobs, handoff, and memory systems a shared project-rule source to read.

`LINGHUN.md` is not dumped in full to the main screen or endlessly inserted into prompts. Linghun reads a stable summary and connects it to `/memory`, the `/resume` context package, readiness, and `projectRulesHash` / `memoryHash` freshness. Rule changes become visible in cache diagnostics, but the full file is not shown by default; missing, unreadable, and existing states are all explicit.

### 16.2 Controlled Memory

Controlled memory solves how project habits and user preferences become effective over time. It does not dump all chat history into the prompt. Instead, it turns stable, short, confirmable rules into memory records.

For users, the benefit is not the abstract feeling that "the model remembers many things." It is more direct: in the same project, later rounds do not require repeating that you prefer reading source first, creating a stable point first, running verification first, or giving a report. The model gradually fits your working style, reducing friction.

Key boundaries:

- Long-term memory is not written automatically.
- Candidates are not injected automatically.
- Users need `/memory review` and `/memory accept <id>`.
- Accepted memory is still limited by topK and character budget.
- Full transcripts, full logs, and full index are not directly inserted into prompts.

### 16.3 Self-learning

Linghun's self-learning is controlled learning, not background unlimited scanning and not model-driven rule modification.

It solves the pain of repeating the same collaboration preferences. For example, one user may always want a short conclusion before details, one project may always require code changes before docs, and a class of tasks may always run smoke before deciding whether to continue. Self-learning turns stable patterns into candidates, making later model calls require less explanation, misjudge less often, and fit the user's rhythm better.

When explicitly enabled by the user, the system can extract candidate preferences and collaboration rules from ordinary inputs that truly enter the model path, such as:

- Language, answer style, command preferences, and verification preferences.
- High-frequency workflows.
- Project habits such as test commands, build commands, and documentation locations.
- Collaboration rules such as read source first, do not fix unrelated issues, and preferred report style.

Self-learning only creates candidates by default:

- `/memory learn on` enables it.
- `/memory learn off` disables it.
- `/memory learn status` shows status.
- Each round creates only a few candidates at most to avoid noise accumulation.
- Candidates must be reviewed/accepted before entering prompts.
- Inputs containing API keys, tokens, private keys, long base64 strings, or other secrets are skipped entirely and do not generate candidates.
- Slash commands, permission confirmations, provider setup, and other control inputs do not trigger auto-learning.

This lets Linghun gradually fit real user habits without writing one-off emotions, sensitive information, or unconfirmed facts into long-lived rules.

### 16.4 Reflection and Failure Learning

Linghun's reflection system is not asking the model to write "I reflected" text. It extracts reusable lessons from real failure events.

The most direct user value is that the system becomes steadier over time instead of forgetting. If the project previously hit a provider, Git, verification, or resource-boundary problem, the model receives earlier risk hints when similar context appears later. This avoids walking the same detour again and reduces the cost of "we already hit this once, why did it happen again?" It does not make the model permanently correct, but it makes later calls smoother and closer to the user's real habits.

Failure learning sources include:

- Tool exceptions.
- Bash non-zero exits.
- Provider request failures.
- Verification fail/partial/timeout/stale.
- Report guard.
- Git operation failures.
- Final answer gate downgrade.
- Resource/concurrency cap.

Each lesson records a redacted failure summary, possible root cause, action to avoid next time, severity, occurrence count, and status. Users can:

- Use `/failures` to view active lessons.
- Use `/failures resolve <id>` to mark one as resolved.
- Use `/failures ignore <id>` to silence a lesson while preserving the record.

Failure learning redacts secrets, baseUrl, Authorization, absolute paths, and similar sensitive content. It only tells the model "history shows this area is risky"; it does not become evidence that the current task has failed, been fixed, or been verified.

This mechanism lets Linghun become steadier from real runtime failures. Similar provider errors, tool failures, verification misjudgments, Git operation failures, report guard triggers, and concurrency cap issues later become risk hints for both model and user.

---

## 17. Multi-agent and Long-task Hosting

Linghun supports local multi-agent work and long-task hosting. Its goal is not to let models "run infinitely", but to split complex tasks into hosted workflows with goals, plans, budgets, state, logs, handoff, and verification boundaries.

This is especially important for beginners and individual developers. Many AI projects do not fail because the first code snippet cannot be written; they fail because later work requires continuous requirement clarification, file location, dependency setup, feature completion, error fixing, verification, rollback, and handoff. Linghun brings these steps into one observable chain, so users do not need to constantly watch model output while still knowing where the task is, how much budget it spent, whether it is stuck, and what the next step is.

Multi-agent entries include:

- `/agents`
- `/agents show <id>`
- `/agents cancel <id>`
- `/fork explorer|planner|verifier|worker <task>`

Agent types include:

- explorer: exploration and information gathering.
- planner: planning and decomposition.
- verifier: verification and review.
- worker: subtask execution.

Each agent has an independent transcript, role route, permission mode, cost record, and background task surface. The main session is not flooded by child-agent output; users can view, cancel, or expand details.

Durable job entries include:

- `/job run`
- `/job pause`
- `/job resume`
- `/job cancel`
- `/job status`
- `/job logs`
- `/job report`

The job runtime supports:

- Persistent state.json.
- job.log and fullOutput.
- report.
- goal, plan, and agent list.
- maxSteps, maxTokens, maxRuntimeMs, timeout.
- running agent cap.
- owner session, pid, heartbeat.
- recovery: identifies stale/blocked/running state on startup.
- bounded worker loop.

Long-task hosting covers the engineering state chain from beginning to end:

- Input goal: records target, stage marker, object, and plan.
- Execution process: advances within budget, steps, runtime, permissions, and concurrency limits.
- Parallel collaboration: splits subtasks among explorer, planner, verifier, and worker.
- Process observation: writes background task, job.log, fullOutput, and report.
- Interruption control: supports pause, resume, cancel, timeout, and stale recovery.
- Handoff organization: produces handoff packets that carry goal, state, evidence, risk, and next steps into later sessions.
- Verification boundary: records verification state, but does not automatically upgrade job completed to PASS.

Therefore, Linghun supports long-task hosting from goal to handoff. Real deliverable conclusions still depend on verification evidence, architecture boundaries, and final answer gates. This lets AI take on more continuous engineering work without mistaking background task completion for verified product completion.

---

## 18. Windows-grade Supervision and Native Runner

Linghun includes dedicated process supervision and compatibility design for Windows developers. It does not rely only on default Node child-process behavior. For long tasks, verification, runners, jobs, and exit cleanup, it builds an observable and degradable supervision chain.

### 18.1 Process Guard

Process Guard tracks child processes launched by Linghun and performs bounded cleanup on cancellation, timeout, exit, and signal interruption.

Capabilities include:

- Tracked child registry.
- Graceful stop and force stop.
- Exit cleanup.
- SIGTERM handling.
- Windows platform uses process tree stop.
- Non-Windows platforms use signal/process-group semantics.
- Recent stop results are retained for tests and diagnostics.

This solves common long-task and verification problems: child processes remaining after command timeout, background tasks continuing after cancellation, temporary processes not cleaned on exit, and users being unable to tell whether a task was actually stopped.

### 18.2 Native Runner

Linghun reserves and implements Native Runner parsing, diagnostics, and job-supervisor integration boundaries.

The value of Native Runner is not making models smarter. It makes long tasks, background tasks, and subprocess supervision more reliable:

- Platform-specific process group or Job Object cleanup.
- Parent death cleanup.
- Long-task heartbeat.
- runner state/stdout/stderr/jobLog/fullOutput/report archiving.
- Protocol mismatch diagnostics.
- Node/TUI fallback.

In the current design, Native Runner executes only approved durable job specs. It is not an arbitrary command-execution backdoor. When runner is unavailable, disabled, or protocol-mismatched, Linghun displays fallback state instead of pretending real native supervision is active.

The Windows-side core contract is that Native Runner should use Job Object and kill-on-job-close to manage supervised child processes. Unix-side behavior corresponds to process-group management. Linghun preserves this contract in reports and doctor, avoiding claims that ordinary Node fallback already proves native-level parent-death cleanup.

### 18.3 Runner Doctor and Degradation

Before Native Runner runs, Linghun resolves:

- Whether it is enabled.
- Source: bundled, optional package, project-local, custom, or disabled.
- Platform architecture candidates.
- Whether the binary exists and is executable.
- Version probe.
- Whether protocol matches.
- Whether Node fallback is available.

This lets Linghun handle commercial-grade long-task scenarios clearly: use native runner when available, degrade explicitly when unavailable, and never package missing, damaged, protocol-mismatched, or failed startup as success.

---

## 19. Windows Compatibility Enhancements

Linghun treats Windows as a first-class runtime environment instead of assuming Unix-like paths.

Windows compatibility includes:

- CLI provides both `linghun` and `Linghun` entries.
- provider.env lives in a user-private config directory to avoid writing keys into projects.
- Configuration priority supports shell env, user provider.env, and project settings.
- Real Windows projectPath enters runtime status, preventing the model from mistaking the project root for `/workspace`.
- Terminal capability detection distinguishes Windows Terminal, VS Code terminal, WezTerm, Alacritty, ConEmu, mintty, modern conhost, and legacy conhost.
- Windows 10 ConPTY capability detection enables a fuller TUI path in modern cmd.exe / PowerShell.
- Legacy terminal degrades to ASCII-safe rendering, reducing box drawing, emoji, and wide-character alignment issues.
- Windows paths, Chinese paths, and paths with spaces are part of runner, log, provider config, and doctor design boundaries.
- memory, sessions, logs, jobs, cache, and index metadata support project-level, user-level, and custom directory storage boundaries. Long-term data is not forced into a default system-drive directory.
- `/memory storage` displays actual storage paths, and `LINGHUN_DATA_DIR` can adjust the user data root to fit multi-drive setups, company permission policies, and limited C drive space.
- Bash/verification/runner output goes to logs, reducing Windows console encoding issues and long-output pollution of the main screen.
- process guard and runner jointly handle Windows long-task cancellation, timeout, stale state, and exit cleanup.

This matters for commercial use because many real users develop on Windows, PowerShell, cmd.exe, Windows Terminal, VS Code terminal, Chinese paths, and multi-drive environments. Linghun's goal is to make these environments default usable paths, not "please switch to Linux/macOS first."

---

## 20. Extension Ecosystem: MCP, Skills, Plugins, Hooks

Linghun's extension system follows the principle: metadata before execution, trust before enablement, diagnostics before use.

MCP capabilities include:

- Server metadata.
- add/update/enable/disable/remove.
- validate.
- tools summary.
- doctor.
- Mutating MCP tools are conservatively rejected; codebase-memory index writes are recommended through controlled `/index` entries.

Skills and Plugins capabilities include:

- Local / git / GitHub source metadata.
- Manifest reading.
- trusted/disabled state.
- enable/disable.
- validate/doctor.
- contribution summary.

Hooks capabilities include:

- PreToolUse, PostToolUse, Stop, Notification, Workflow, Plugin event types.
- timeout and output limit.
- project trust.
- disabled/trusted ids.
- doctor diagnostics.

These capabilities provide entries for later ecosystem expansion without bypassing permission, trust, and local configuration boundaries.

---

## 21. Remote Channel Boundary

Linghun's remote layer is designed to safely send important local-session events to external channels. It is not designed to turn remote channels into uncontrolled execution entries.

The configuration model covers:

- WeCom.
- Feishu / Lark.
- DingTalk.
- official CLI, webhook mock, webhook transport.

Event types include:

- approval_request.
- job_status.
- job_report.
- verification_result.

Safety boundaries include:

- summary_only redaction.
- trusted source.
- bound user/device.
- nonce and messageId.
- signature checks.
- replay protection.
- After remote approval, control still returns to local pending approval and permission pipeline.

Therefore, remote channels can serve as approval and notification adapters, but they do not replace the local permission system.

---

## 22. TUI Output and Interaction Layers

Linghun's interaction goal is: focus the main screen on results, keep details traceable, and make complex capabilities discoverable.

Main interaction surfaces include:

- Main input and streaming answer.
- Slash suggestions.
- Command panel.
- Status footer.
- Notification stack.
- Background task surface.
- `/details` full-content entry.
- `/help`, `/help all`, `/help advanced`.
- `/config` control panel.
- `/btw` temporary question / note entry.

Output is summary-first:

- The main screen does not dump full logs by default.
- Raw tool_result remains in diagnostics; the main screen shows summaries.
- Long output goes to fullOutputPath or details.
- evidenceId, changedFiles, and fullOutputPath remain in the diagnostic layer.
- Internal provider/baseUrl/endpointProfile does not enter the normal main screen by default.

This lets Linghun serve both new and advanced users: defaults are not interrupted by internal details, but details can be expanded when tracing is needed.

---

## 23. Cost and Performance Control

Linghun's cost reduction and productivity gains are not a single optimization, but multiple coordinated layers:

- RuntimeStatusForModel projection noise reduction: the model sees only necessary runtime state.
- Deferred tools noise reduction: full tool details are not placed in the main screen or prompt by default.
- Stable tool ordering: reduces prompt cache breakage caused by tool order changes.
- CacheFreshness changedKeys: identifies the source of cache degradation.
- Cache history: records recent hit rate, read/write tokens, provider/model/endpoint.
- Workspace Snapshot Lite: bounded summaries instead of full repository scans.
- Cache freshness: prompts refresh only when key dimensions change.
- Prompt cache break marker: makes cache busting explicit.
- Memory topK: only a few accepted long-term memory items are injected.
- Log artifact slice: reads only the needed log fragments.
- Index freshness fast path: `/index status` does not run slow checks by default.
- Resource/concurrency cap: limits agent/job concurrency.
- Provider circuit breaker: reduces noise and cost during repeated failures.

Real cost depends on model, repository size, task complexity, and user workflow. Linghun's design goal is to make cost sources visible, controllable, diagnosable, and to maintain higher cache reuse in stable long-running workflows.

---

## 24. Self-developed Runtime and Open-source Value

Linghun's core value is organizing a set of scattered capabilities into one unified runtime:

- Self-developed provider runtime contract.
- Self-developed permission policy engine.
- Self-developed evidence and final answer gate.
- Self-developed prompt cache usage, CacheFreshness, break-cache, and deferred tool stability mechanisms.
- Self-developed Git stable point / managed worktree runtime.
- Self-developed controlled memory and failure learning.
- Self-developed durable job / multi-agent lifecycle.
- Self-developed Windows process guard and Native Runner supervisor boundary.
- Self-developed command panel, details, readiness, problems, and verification surfaces.
- Self-developed workspace reference cache and snapshot lite.

Together, these capabilities give Linghun properties that open-source projects especially need:

- Readable: users and developers can understand why the system made a judgment.
- Traceable: important conclusions have transcripts, evidence, logs, and reports.
- Controllable: permissions, memory, remote, extensions, and Git operations are explicitly manageable by the user.
- Extensible: provider, MCP, skills, plugins, hooks, and runner have clear boundaries.
- Maintainable long term: core business logic has been split from a single giant entry point into responsibility modules; index mainly serves as the composition root and mainline glue.

---

## 25. Engineering Exoskeleton for All Large Models

Linghun exists because large-model capability has advanced rapidly. Whether in code understanding, natural-language reasoning, tool use, long context, visual input, or complex task planning, today's model providers have pushed AI coding to the threshold of real usability. Behind every strong model are enormous training cost, data engineering, inference optimization, and infrastructure investment. Linghun respects and benefits from these achievements. The stronger the models become, the more complex the engineering tasks Linghun can carry.

But real development does not need only "a smarter model." Developers also need permission boundaries, evidence records, verification loops, Git stable points, cache cost control, long-term context, failure reflection, Windows supervision, long-task hosting, and diagnosable output. Linghun's position is not to bind itself to one model provider, nor to replace model companies, but to provide an engineering exoskeleton for different large models.

Model training solves the general intelligence problem: making the model able to read code, reason, generate, call tools, and handle long context. But it does not naturally know the current true state of a user's local repository: which files were just changed, which test actually failed, whether the Git workspace is clean, whether the index is fresh, whether the provider is truly usable, whether a historical failure is recurring, or whether the current answer overstates verification scope. These are not problems that training parameters alone can reliably solve. They are runtime, toolchain, and engineering process problems.

Linghun's engineering exoskeleton solves this layer:

- **Connect models to real repositories**: through file reads, search, index, diff, workspace snapshot, and evidence, models work around current code facts instead of imagined projects.
- **Connect models to real tools**: file read/write, Bash, verification, Git, worktree, agents, jobs, MCP, and extension tools all pass through one runtime instead of becoming untraceable ad hoc actions.
- **Connect models to real permissions**: file writes, commands, index refresh, Git operations, and remote approval all enter the same permission and path-safety boundaries. Users do not have to choose between speed and safety.
- **Connect models to real verification**: build, test, smoke, review, readiness, and final answer gate distinguish PASS, PARTIAL, FAIL, synthetic, focused, and unverified states, preventing local success from being written as full completion.
- **Connect models to real cost**: prompt cache, tool schema stability, summary-first, deferred tools, CacheFreshness, and usage history prevent long-running projects from paying to re-understand the full background every round.
- **Connect models to real long-term context**: controlled memory, handoff, failure learning, and reflection records gradually fit user habits while preventing historical memory from becoming current-task evidence.
- **Connect models to real delivery boundaries**: Git stable points, managed worktree, architecture checks, code hygiene, and report guards make each round more likely to leave behind a rollbackable, auditable, maintainable state.

For developers, the direct impact of this exoskeleton is plain: the model guesses less, rereads fewer irrelevant files, is less likely to call unverified work complete, puts less log and tool noise into context, preserves stable points more easily, learns from failures more often, and can turn one conversation into a project that remains maintainable.

For beginners who are just learning programming or beginning to embrace AI development, the meaning is even more direct. Strong models lower the barrier to writing a first version of code. But beginners usually get stuck on project structure, dependency installation, error fixing, test verification, Git rollback, runtime environment, and later maintenance. Linghun puts these engineering steps into the same observable mainline, allowing users to keep driving requirements in natural language while the system supplies evidence, permissions, verification, stable points, and handoff boundaries. The result is not a guarantee that every project succeeds in one pass, but a significantly higher chance of moving from an idea directly to a runnable, verifiable, iteratable product.

Therefore, Linghun can evolve with model capability. Today it can connect models suitable for execution, review, and summarization. In the future, it can continue carrying stronger planning, vision, long-context, and tool-use capabilities. Model providers supply the intelligence core; Linghun supplies the engineering runtime, moving AI coding from "the model can answer" toward "the model can continuously work inside engineering boundaries."

---

## 26. Basic View on the AI Coding Wave

Every major productivity tool has produced similar debates: will it replace people, destroy existing work patterns, or turn out to be a short-lived bubble? Steam engines, electricity, automated production lines, and the internet all shocked traditional industries and forced changes in labor, organization, and skill structures. When steam power entered textiles, traditional hand weaving was heavily affected, but the longer-term result was not the end of production. Production scale, collaboration patterns, job structures, and skill requirements were redefined.

AI coding is in a similar stage. Critics see hallucinations, wrong code, context forgetting, insufficient verification, and security risks. Over-optimists treat models as automatic developers that can completely replace engineering workflows. Linghun's view is that AI will keep changing software development, but what truly enters real engineering is not "a model that can generate code", but a new way of working that combines model capability with engineering runtime. When problems appear, the more valuable attitude is not to deny AI, but to acknowledge the problems, look for solutions, and also recognize the real productivity gains already brought by model companies in training, inference, tool use, and long context. At the same time, these capabilities need engineering workflows to land more stably in developers' hands.

Hallucination does not mean AI coding has no value. It means systems must connect facts, verification, and boundaries. Models are strong, but they must not be assumed to know current repository facts. Models can reason, but that does not mean verification passed. Models can generate code, but that does not mean architecture, permissions, and long-term maintenance requirements are satisfied. If these problems are left for users to manually cover, beginners are more easily misled and professional developers waste time on rework, investigation, and repeated confirmation.

Linghun's product choice is not to package AI coding as "humans no longer need engineering ability", nor to treat AI hallucination as an unsolvable fate. It places models inside evidence, permission, verification, Git, memory, failure learning, architecture, and cost runtime, so users can enjoy model speed while keeping the controllability required by engineering development.

There is also a simpler reality behind this: developers' time and attention are limited. In real work, what consumes people is often not just writing code itself, but repeatedly explaining context, repeatedly locating files, staring at long-task output, handling environment issues, worrying about wrong edits, confirming verification scope, fixing the same class of failure, and finishing work late at night. Life moves faster and pressure keeps rising. If a tool only makes people "produce more tasks faster", it does not necessarily improve the developer's condition.

Linghun hopes to turn engineering efficiency into visible margin for developers: less invalid waiting, less repeated rework, less uncertainty anxiety, and less secondary cleanup caused by model hallucination. The saved time can be used not only to write more code, but also to rest, reflect, learn, deepen product judgment, or return attention to areas that truly need human experience and taste. Mature AI coding tools should not be measured only by throughput. They should also be judged by whether they let developers finish real work more calmly.

Under engineering constraints, AI has even greater meaning for individual developers. Many ideas in the past were not worthless; they were blocked by time, energy, environment, engineering experience, and trial-and-error cost. A single person building a tool, website, plugin, automation script, SaaS prototype, or open-source project often has to cover product, frontend, backend, testing, deployment, documentation, and maintenance at the same time. Linghun aims to shorten that chain: helping individual developers turn ideas into runnable, verifiable, iteratable projects more efficiently, with less effort and lower cost, and then explore side projects, portfolios, open-source influence, or commercial monetization.

This is one of the deeper meanings of AI coding: not simply making developers passively accept replacement, but giving more people the ability to make ideas land as engineered products. Models provide intelligence; Linghun provides engineering guardrails and runtime. Individual developers can then spend limited time on choosing problems, understanding users, polishing experience, and creating value instead of repeatedly setting up environments, debugging, and reworking.

This means two things for developers:

- For beginners, AI is not only a teacher that answers questions. It can become a collaborator with engineering guardrails, helping them move from idea to runnable, verifiable, maintainable project.
- For professional developers, AI is not only code completion or a chat window. It can enter real workflows: reading repositories, changing code, running verification, leaving stable points, reflecting on failures, controlling cost, and limiting delivery conclusions to evidence boundaries.

So Linghun does not stand at either extreme of "AI replaces humans" or "AI has no value." It cares more about how developers connect increasingly strong model capabilities to real engineering, instead of being dragged down by hallucination, noise, cost, and uncontrolled automation. This is why Linghun positions itself as an engineering exoskeleton.

---

## 27. Applicable Scenarios

Linghun is suitable for the following workflows:

- Let models read code, change code, run verification, and produce evidence-bounded summaries in real projects.
- Use different models for planning, execution, review, verification, and summarization.
- Keep stable context, stable tool calls, and high cache reuse in the same long-running project, reducing repeated explanation and repeated cost.
- Locate code in large repositories through index, grep, and workspace snapshot.
- Create Git stable points and worktrees in staged development to reduce rollback cost.
- Use agents for parallel exploration, planning, or verification without blocking the main session.
- Use durable jobs for long tasks with budgets and lifecycles.
- Use controlled memory to retain project habits instead of allowing the model to write long-term memory freely.
- Use failure learning to turn real failures into future risk hints.
- Run supervisable AI coding workflows in Windows Terminal, PowerShell, cmd.exe, Chinese paths, and long-task environments.
- Use doctor/problems/verify for conservative review before delivery.
- Use MCP, skills, plugins, and hooks to integrate team or personal toolchains.

---

## 28. Explicit Boundaries

Linghun's capability boundaries are:

- Evidence-first does not mean "never wrong." It means critical claims are constrained by evidence.
- Local doctor and focused validation do not equal real full smoke testing.
- Synthetic smoke does not equal real provider/TUI/render/report mainline smoke.
- Failure learning is only historical risk hinting, not current-task evidence.
- Long-term memory requires user confirmation and is not written automatically.
- Remote channel is an approval/notification adapter, not a remote execution platform that bypasses local permissions.
- Native Runner has controlled supervisor boundaries and Node fallback. It does not mean every platform has fully verified low-level supervision.
- Windows Job Object is the commercial-grade supervision contract for Native Runner. Node fallback, ordinary unit tests, and no-real-runner smoke must not be presented as complete proof of native process-tree supervision.
- Index is a location aid, not the only source of truth.
- Cache hit rates of 92%-96%, near 98%, and partial 100% describe targets and observed ranges under stable workflows. They do not represent guaranteed outcomes for any model, provider, or project.
- Local index, parallel tools, or cache benefits do not equal a fixed overall development speedup. Actual gains depend on project, model, task, and usage data.

These boundaries reflect Linghun's engineering stance: capability, evidence, verification, and applicability must remain aligned, avoiding the packaging of local capabilities as unconditional promises.
