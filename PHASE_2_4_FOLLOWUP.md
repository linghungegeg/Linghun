# Phase 2-4 Follow-up Plan

This note is for continuing the cache-shape closure work in a new conversation.

## Current State

Phase 1 has only been partially closed so far.

Verified local evidence from the current workspace shows:

- `packages/providers/src/index.ts` now partitions Anthropic tools into stable tools and dynamic tools before building the request body.
- Dynamic tool names are currently classified by prefixes: `mcp__`, `skill__`, and `plugin__`.
- With `promptCacheEnabled`, `cache_control` is attached to the final stable tool, not to the final tool overall.
- `packages/providers/src/index.test.ts` has a focused regression test for this stable/dynamic boundary.
- Focused provider test command passed: `corepack pnpm vitest run packages/providers/src/index.test.ts`.

Important caveat: this does not mean phases 2-4 are complete. It only proves the provider-level Phase 1 boundary behavior covered by the focused test.

## Phase 2: Extend the Latch

Goal: cache-affecting request shape must stay latched across retries/continuations, not just TTL.

Current priority:

1. Find the existing prompt-cache latch implementation and tests.
2. Extend the latched state beyond TTL to include every field that can affect the server-side cache key or prompt-cache behavior.
3. Make the latch apply consistently across main, continuation, final, agent, btw, and deep-compact request paths.

Fields to inspect and likely latch:

- Prompt cache enabled/disabled state.
- Prompt cache TTL.
- Anthropic beta headers that affect cache behavior.
- Reasoning/thinking request shape.
- Endpoint profile where it changes body shape.
- Extra body fields or provider-specific request body additions that affect the serialized request.
- Any stable/dynamic tool boundary metadata if it is computed outside the provider layer.

Likely files to inspect first:

- `packages/tools/src/index.ts`
- `packages/tools/src/index.test.ts`
- `packages/tui/src/tool-output-presenter.ts`
- `packages/tui/src/tool-output-presenter.test.ts`
- Provider request builder code in `packages/providers/src/index.ts`
- Runtime/TUI request assembly code found by searching for `promptCache`, `cacheBreakNonce`, `promptCacheTtl`, `reasoningLevel`, `anthropicBetaHeaders`, and latch-related names.

Search anchors:

```bash
rg "promptCache|cacheBreakNonce|promptCacheTtl|reasoningLevel|anthropicBetaHeaders|latch|cache key|cacheKey" packages
```

Expected Phase 2 regression coverage:

- First request chooses a cache-affecting shape; continuation/retry keeps that same shape.
- Changing user/provider config mid-run does not silently alter the latched request shape for the same logical turn/session.
- New independent turns may compute a fresh shape.
- Cache write policy remains explicit and does not become enabled due to fallback/default drift.

## Phase 3: Add Per-tool Hash and Source Dimension

Goal: stable tool caching should be explainable and robust when the tool set changes.

Current Phase 1 classification is name-prefix based only. Phase 3 should make the stable/dynamic split auditable by adding a per-tool identity dimension.

Required dimensions:

- Tool source, for example built-in, MCP, skill, plugin, or other extension source.
- Per-tool hash derived from the tool schema content that affects request body shape.
- Stable ordering that remains deterministic.
- Debug/reporting surface that does not leak full schemas or sensitive content.

Implementation guidance:

- Prefer computing source/hash near the tool registry or request assembly layer if that information exists there.
- Avoid making the provider infer too much from names if richer metadata exists upstream.
- If `ModelToolDefinition` must be extended, update all call sites and tests deliberately.
- Hash only stable request-shape material: name, description, input schema, and source if it is part of the cache grouping contract.
- Do not include volatile runtime data, paths, timestamps, or permission/session state.

Expected Phase 3 regression coverage:

- Two tools with the same name but different source/schema do not collapse into the same identity.
- Built-in stable tools remain ordered deterministically.
- Dynamic/extra tools are still placed after the stable cache boundary.
- Hash/source diagnostics expose compact identifiers, not full schema dumps.

## Phase 4: Request-shape and Cache-write Regression Matrix

Goal: prove the full set of conversation paths creates the intended request body shape and cache write policy.

Required paths:

- Main request.
- Continuation request.
- Final response request.
- Agent request.
- BTW request.
- Deep-compact request.

For each path, verify:

- Anthropic `system` cache_control placement.
- Anthropic `tools` cache_control placement.
- Stable tools appear before dynamic/extra tools.
- Dynamic/extra tool segment does not receive the prompt-cache boundary marker.
- Latched cache-affecting fields stay stable where expected.
- Cache write policy is explicit: enabled only where intended and disabled where intended.
- OpenAI chat/responses paths do not receive Anthropic-only fields.

Suggested test strategy:

1. Add focused unit tests around request assembly helpers first.
2. Add provider body-shape tests for Anthropic messages.
3. Add regression tests for each top-level route if there are existing tests for main/continuation/final/agent/btw/deep-compact.
4. Keep expected bodies small and assert only the meaningful shape fields to avoid brittle snapshots.

Useful assertions:

- `body.tools.map((tool) => tool.name)` equals stable tools followed by dynamic tools.
- Only the last stable tool has `cache_control`.
- No dynamic tool has `cache_control`.
- `thinking`/reasoning body shape remains latched when expected.
- `anthropic-beta` headers remain latched when expected.
- No `cache_edits` or `cache_reference` appears unless a future explicit feature gate is added.

## Known Current Workspace Changes

At the time this note was written, the workspace had unstaged changes in:

- `packages/providers/src/index.ts`
- `packages/providers/src/index.test.ts`
- `packages/tools/src/index.ts`
- `packages/tools/src/index.test.ts`
- `packages/tui/src/tool-output-presenter.ts`
- `packages/tui/src/tool-output-presenter.test.ts`

Before continuing, inspect the current diff instead of assuming these are all part of one complete phase.

Recommended first commands in the new conversation:

```bash
git diff -- packages/providers/src/index.ts packages/providers/src/index.test.ts
corepack pnpm vitest run packages/providers/src/index.test.ts
rg "promptCache|cacheBreakNonce|promptCacheTtl|reasoningLevel|anthropicBetaHeaders|latch|cache key|cacheKey" packages
```

## Completion Bar

Do not call phases 2-4 complete until all of the following are true:

- The latch covers all identified cache-affecting fields, with tests.
- Tool identity includes source and per-tool hash, with tests.
- The route matrix covers main, continuation, final, agent, btw, and deep-compact.
- Focused tests pass.
- Any broader test/typecheck required by touched packages has been run or explicitly documented as not run.
