# Linghun

Evidence-first, local-first AI coding terminal for real engineering workflows.

Linghun is not a thin terminal shell that simply forwards your prompt to a model.
It connects models, tools, permissions, evidence, verification, context, cost,
Git state, long-running tasks, memory, and local runtime supervision into one
auditable engineering loop.

The core idea is simple:

> AI coding slows down when models give confident answers before reading facts,
> running verification, or checking boundaries.

Linghun starts from evidence. It can chat, read code, edit files, run commands,
create stable points, split complex work, track cost, and report results, but
important engineering claims must stay tied to what was actually observed.

Read the full design in the [Chinese whitepaper](./WHITEPAPER.md) or
[English whitepaper](./WHITEPAPER.en.md).

## Why Linghun

Modern coding models are powerful, but real projects need more than generation.
They need a runtime that knows:

- which files were read;
- which tools were executed;
- which commands or tests were run;
- whether the working tree is clean;
- whether the codebase index is fresh;
- whether a failure really happened;
- whether a final answer is supported by evidence.

Linghun turns these concerns into product behavior instead of relying only on
prompt wording. The goal is fewer hallucinations, fewer repeated tokens, better
cache reuse, safer local execution, clearer delivery boundaries, and less rework.

See: [Evidence-first engineering loop](./WHITEPAPER.en.md#4-evidence-first-engineering-loop),
[verification and readiness](./WHITEPAPER.en.md#15-verification-readiness-and-problems-panel), and
[output-side anti-hallucination](./WHITEPAPER.en.md#6-output-side-anti-hallucination-system).

## Quick Start

Requirements:

- Node.js 22 or newer
- npm, pnpm, or another Node package manager

Install:

```bash
npm install -g @linghun/cli
```

Start Linghun in a project:

```bash
linghun
```

Windows also supports the uppercase compatibility entry:

```powershell
Linghun
```

Check the installed version:

```bash
linghun --version
```

## Model Setup

Run Linghun and use:

```text
/model setup
```

The setup flow asks for:

- API base URL
- API key
- model name
- reasoning level

API keys are stored in a private user-level `provider.env`, not in your project.
Shell environment variables have the highest priority, then the private
`provider.env`, then project/default settings.

Check provider configuration with:

```text
/model doctor
```

## A Typical Workflow

You can describe engineering work in natural language:

```text
Check why this project fails to build, fix the issue, run the relevant tests,
and create a stable point if everything passes.
```

Linghun is designed to turn that into a controlled loop:

1. inspect the repository and relevant files;
2. form a short plan;
3. request permission before risky writes or commands;
4. edit files through the tool runtime;
5. run focused verification;
6. inspect Git state;
7. summarize what changed, what was verified, and what remains uncertain.

See: [staged engineering workflow](./WHITEPAPER.en.md#5-staged-engineering-workflow) and
[Git stable points](./WHITEPAPER.en.md#13-git-stable-points-and-managed-worktree).

## Capability Map

### Evidence-first Answers

Linghun separates model text from engineering facts. Claims about code,
verification, Git operations, architecture boundaries, or release readiness are
expected to be backed by observed evidence.

See: [Evidence-first engineering loop](./WHITEPAPER.en.md#4-evidence-first-engineering-loop).

### Architecture and Runtime Boundaries

Linghun treats coding as a runtime problem, not only a prompting problem. Model
generation is connected to provider runtime, tool runtime, permission runtime,
evidence runtime, verification runtime, Git runtime, memory runtime, job
runtime, and local process supervision.

See: [architecture system](./WHITEPAPER.en.md#7-architecture-system).

### Provider Runtime

Provider configuration, model routing, reasoning level, API base URL, private
keys, diagnostics, and failure handling are managed as runtime state. This lets
Linghun support different providers without hard-coding one model path into the
product.

See: [provider runtime](./WHITEPAPER.en.md#9-provider-runtime).

### Local Tools and Editing Safety

Linghun includes file reading, writing, editing, search, Bash, Todo, Diff, Git,
and verification paths. Editing is guarded by read-before-edit behavior, stale
file checks, path boundaries, and change summaries.

See: [tool execution and editing safety](./WHITEPAPER.en.md#10-tool-execution-and-editing-safety).

### Permissions and Workspace Safety

Local execution is permission-aware. Linghun classifies command risk, protects
workspace paths, separates permission modes, and keeps remote approvals routed
back through local permission boundaries.

See: [permissions, safety, and resource boundaries](./WHITEPAPER.en.md#12-permissions-safety-and-resource-boundaries).

### Verification-aware Delivery

Linghun does not treat every successful local command as full project readiness.
It tracks verification scope and distinguishes focused checks, partial results,
failures, timeouts, cancelled work, and unverified conclusions.

See: [verification, readiness, and problems panel](./WHITEPAPER.en.md#15-verification-readiness-and-problems-panel).

### Codebase Index and Workspace Awareness

The CLI package ships with bundled `codebase-memory-mcp` binaries for common
desktop platforms. Linghun can use codebase index status, search, architecture
evidence, workspace snapshots, and large-file safety checks to reduce repeated
file reading and improve grounding.

Bundled platforms:

- Windows x64
- Linux x64
- macOS Apple Silicon
- macOS Intel

See: [index, cache, and workspace snapshot](./WHITEPAPER.en.md#14-index-cache-and-workspace-snapshot).

### Cache and Cost Control

Linghun tracks usage, prompt cache behavior, cache freshness, changed runtime
inputs, and summary-first output boundaries. The aim is to reduce repeated
tokens and avoid letting large logs or unstable tool lists break cache reuse.

See: [cost and performance control](./WHITEPAPER.en.md#25-cost-and-performance-control) and
[stable tool calls and cost reduction](./WHITEPAPER.en.md#11-stable-tool-calls-and-cost-reduction).

### Git Stable Points

Linghun can inspect Git state, help create stable points, and keep Git-related
claims tied to actual repository state. This makes larger changes easier to
roll back and easier to hand off.

See: [Git stable points and managed worktree](./WHITEPAPER.en.md#13-git-stable-points-and-managed-worktree).

### Long-running Jobs and Agents

For complex work, Linghun has durable jobs, background tasks, agent transcripts,
budgets, step limits, logs, reports, and handoff boundaries. The user should see
state and progress rather than raw runtime noise.

See: [Workflow Matrix and long-task hosting](./WHITEPAPER.en.md#18-workflow-matrix-and-long-task-hosting).

### Multi-model Routing

Different roles can use different model routes: planning, execution, review,
verification, summarization, vision, and image tasks do not have to share one
model configuration.

See: [role-based multi-model routing](./WHITEPAPER.en.md#8-role-based-multi-model-routing).

### Controlled Memory and Failure Learning

Linghun supports project rules, handoff, controlled memory, candidate-first
learning, and failure reflection. The goal is to reduce repeated explanations
without silently injecting unsafe or unreviewed memory into every task.

See: [long-term context, controlled memory, self-learning, and reflection](./WHITEPAPER.en.md#16-long-term-context-controlled-memory-self-learning-and-reflection).

### Central Orchestration

Linghun condenses signals from task type, permissions, evidence, memory,
failures, provider status, workflow state, user state, context pressure,
architecture boundaries, terminal capability, and verification needs into a
structured policy for the current turn.

The model reasons and generates. The runtime chooses routes, controls risk,
keeps output low-noise, and decides when verification or clarification matters.

See: [central orchestration](./WHITEPAPER.en.md#17-central-orchestration-from-prompt-injection-to-behavioral-routing).

### Extensions and External Capabilities

Linghun is designed to connect MCP servers, skills, plugins, hooks, capability
connectors, and remote channels without bypassing local permissions or evidence
boundaries.

See: [extension ecosystem](./WHITEPAPER.en.md#21-extension-ecosystem-mcp-skills-plugins-hooks),
[runtime capabilities vs skills](./WHITEPAPER.en.md#22-runtime-capabilities-vs-skills), and
[remote channel boundary](./WHITEPAPER.en.md#23-remote-channel-boundary).

### Terminal UX and Diagnostic Surfaces

Linghun separates the main user-visible conversation from details, logs,
diagnostics, tool output, and long-running task state. The public surface should
stay readable, while deeper evidence remains available when a user asks for it.

See: [TUI output and interaction layers](./WHITEPAPER.en.md#24-tui-output-and-interaction-layers).

### Windows-first Practicality

Linghun treats Windows, PowerShell, cmd.exe, Chinese paths, spaces in paths,
terminal capability detection, and local process supervision as first-class
engineering concerns.

See: [Windows-grade supervision and native runner](./WHITEPAPER.en.md#19-windows-grade-supervision-and-native-runner) and
[Windows compatibility enhancements](./WHITEPAPER.en.md#20-windows-compatibility-enhancements).

### Self-developed Runtime and Open-source Value

Linghun is intended to be useful beyond one provider or one closed workflow. Its
open-source value is the reusable engineering runtime around models: evidence,
tools, permissions, verification, context, cost, jobs, agents, and extension
boundaries.

See: [self-developed runtime and open-source value](./WHITEPAPER.en.md#26-self-developed-runtime-and-open-source-value) and
[engineering exoskeleton for all large models](./WHITEPAPER.en.md#27-engineering-exoskeleton-for-all-large-models).

## Local-first and Privacy

Linghun is local-first:

- code execution happens on your machine;
- model provider keys are stored outside the project by default;
- remote channels are optional and route back through local permission checks;
- full logs and details are kept behind explicit diagnostic surfaces where possible;
- bundled local binaries are used before falling back to external installs.

See: [developer sovereignty, safety, and privacy](./WHITEPAPER.en.md#121-developer-sovereignty-safety-and-privacy).

## Documentation

- [Chinese Whitepaper](./WHITEPAPER.md)
- [English Whitepaper](./WHITEPAPER.en.md)
- [License](./LICENSE)

Recommended whitepaper sections:

- [Product positioning](./WHITEPAPER.en.md#1-product-positioning)
- [Capability overview](./WHITEPAPER.en.md#3-capability-overview)
- [Evidence-first engineering loop](./WHITEPAPER.en.md#4-evidence-first-engineering-loop)
- [Permissions and safety](./WHITEPAPER.en.md#12-permissions-safety-and-resource-boundaries)
- [Index and workspace awareness](./WHITEPAPER.en.md#14-index-cache-and-workspace-snapshot)
- [Verification and readiness](./WHITEPAPER.en.md#15-verification-readiness-and-problems-panel)
- [Central orchestration](./WHITEPAPER.en.md#17-central-orchestration-from-prompt-injection-to-behavioral-routing)
- [Workflow Matrix and long tasks](./WHITEPAPER.en.md#18-workflow-matrix-and-long-task-hosting)
- [Extension ecosystem](./WHITEPAPER.en.md#21-extension-ecosystem-mcp-skills-plugins-hooks)
- [Applicable scenarios](./WHITEPAPER.en.md#29-applicable-scenarios)
- [Explicit boundaries](./WHITEPAPER.en.md#31-explicit-boundaries)

## Current Status

Linghun is under active development. The CLI/TUI runtime, local tool execution,
provider setup, evidence-oriented workflow, bundled codebase index runtime, and
many engineering-control surfaces are already implemented. Some advanced
surfaces, especially multi-platform native-runner packaging and remote-channel
product polish, may continue to mature across releases.

Use Linghun as a local engineering assistant with evidence and permission
boundaries, not as an autonomous system that should be trusted blindly.

## License

Linghun is licensed under the [Apache License 2.0](./LICENSE).
