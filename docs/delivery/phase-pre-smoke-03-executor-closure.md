# Phase Pre-Smoke 03 - Executor, MCP, And Security Closure

**Status**: done; local/focused validation only  
**Date**: 2026-06-07  
**Scope**: Skill executor truthfulness, Plugin executor truthfulness, MCP executor closure, deferred tool discovery-before-execute, high-risk security fixes

## Stage Goal

Pre-Smoke 03 closes the high-risk deferred execution and MCP truthfulness gap before real smoke testing. Skill, Plugin, and MCP execution remain separate closure lines. MCP has real stdio/SSE execution paths when trusted/discovered/schema-loaded. Skill and Plugin contributions are intentionally fail-closed until safe adapters exist, and the catalog/system reminder no longer implies they are executable.

## Completed Functions

- MCP SSE JSON-RPC response handling rejects array frames and invalid objects.
- MCP SSE request ids increment and `tools/list` is cached per endpoint while preserving `tools/call` ids.
- `ExecuteExtraTool` requires session-local `SearchExtraTools` discovery before execution.
- MCP deferred tools are executable only after discovery, trust, enabled server state, schema load, and supported runtime adapter.
- Skill deferred entries are discoverable as trusted manifests but `executable:false` without a safe Skill executor adapter.
- Plugin deferred entries are discoverable as trusted manifests but `executable:false` without a safe Plugin executor adapter.
- Executor-less Skill/Plugin entries return structured fail-closed tool results and doctor reasons.
- Deferred tool hash/reminder uses stable non-secret summaries instead of raw schema or giant manifest content.
- Model setup partial validation no longer uses fake values to bypass checks.
- Remote mock/fixture paths and empty signing secrets are gated and diagnosed.
- Permission denial, runner spawn error, URL/connector, Feishu close, and HMAC empty-secret items are closed with explicit diagnostics or focused tests.

## Usage

Model-facing deferred flow:

```text
SearchExtraTools(query)
ExecuteExtraTool(tool_name, params)
```

User-facing diagnostics:

```text
/mcp doctor
/mcp tools
/skills status
/skills doctor
/plugins doctor
```

Important behavior:

- Built-in tools remain directly callable and are not wrapped through deferred execution.
- MCP tools may execute only when the runtime has a safe adapter.
- Skill/Plugin contribution tools do not execute yet; this is a deliberate fail-closed product state.

## Modules

- `packages/tui/src/deferred-tools-catalog.ts`
- `packages/tui/src/mcp-index-runtime.ts`
- `packages/tui/src/mcp-stdio-runtime.ts`
- `packages/tui/src/mcp-sse-runtime.ts`
- `packages/tui/src/extension-command-runtime.ts`
- `packages/tui/src/model-setup-runtime.ts`
- `packages/tui/src/remote-command-runtime.ts`
- `packages/tui/src/remote-transport.ts`
- `packages/tui/src/permission-approval-runtime.ts`
- `packages/tui/src/runner-runtime.ts`
- `packages/tui/src/connector-runtime.ts`

## Source-Level Reality Check

Read and verified:

- `packages/tui/src/deferred-tools-catalog.ts`
- `packages/tui/src/model-tool-runtime.ts`
- `packages/tui/src/mcp-index-runtime.ts`
- `packages/tui/src/mcp-stdio-runtime.ts`
- `packages/tui/src/mcp-sse-runtime.ts`
- `packages/tui/src/phase-f-permission-mcp.test.ts`
- Skill/plugin status, doctor, trust, schema, and permission call sites found by `rg "Skill|Plugin|ExecuteExtraTool|SearchExtraTools|deferred"`

CCB was used only as behavior reference: discover-before-execute, fail-closed untrusted extensions, schema/trust/permission gate, and structured error feedback. No CCB source, private API, telemetry implementation, or suspicious code was copied.

## Key Design

- Discovery is not execution. `listDeferredTools()` only creates candidate metadata; `executeSearchExtraTools()` records session-local discovery; `executeExtraTool()` enforces it.
- MCP stdio/SSE tools are executable because there is a real JSON-RPC adapter.
- Skill/Plugin commands are not made executable by manifest presence, trust ids, or feature flags alone.
- Doctor output is non-secret and summary-first.
- Missing adapter is a closed state with a user-visible reason, not a hidden partial implementation.

## Config Items

No new required config. Existing MCP source/trust/transport config from Connect Lite is honored.

## Commands

No new slash command in this phase. Existing `/mcp`, `/skills`, `/plugins`, `SearchExtraTools`, and `ExecuteExtraTool` paths were tightened.

## Tests And Validation

Focused coverage:

```powershell
corepack pnpm exec vitest run packages/tui/src/phase-f-permission-mcp.test.ts packages/tui/src/model-setup-runtime.test.ts packages/tui/src/remote-transport.test.ts --no-color
```

Additional coverage:

- `packages/tui/src/advanced-slash-panel-invariant.test.ts`
- `packages/tui/src/index.test.ts`
- Final build/typecheck/full-suite validation recorded in Pre-Smoke 07.

Acceptance covered:

- Discovery-before-execute.
- Schema/trust/enabled gates.
- Skill/Plugin missing executor fail-closed.
- SSE `tools/list` + `tools/call`.
- SSE cache/id behavior.
- JSON-RPC array/object validation.
- Non-secret doctor/catalog output.

## Performance

MCP SSE `tools/list` is cached per endpoint to avoid repeated list calls before every tool call. Deferred hash input stays small and stable.

## Known Issues

Skill/Plugin arbitrary command execution remains unavailable by design. This is not a remaining debt for Pre-Smoke 03 because executable hints are removed and runtime fails closed. A future safe adapter phase must add schema/trust/permission/resource isolation before enabling execution.

## Out Of Scope

- Plugin marketplace.
- Skill marketplace.
- Arbitrary third-party command execution.
- Copying CCB implementation.
- WebSocket MCP transport matrix.
- Remote production smoke.

## Next Stage Handoff

Next phase is Pre-Smoke 04 state/error/concurrency closure. Do not re-open Skill/Plugin executor as an executable promise unless a real safe adapter is implemented and tested.

## Developer Troubleshooting

- Deferred catalog: `listDeferredTools()`, `listMcpDeferredTools()`, `listSkillDeferredTools()`, `listPluginDeferredTools()`.
- Session discovery: `context.discoveredDeferredToolNames`.
- Execute guard: `executeExtraTool()`.
- SSE adapter: `runMcpSseToolCall()` and `mcpSseRequest()`.
- Doctor summary: `summarizeDeferredToolCatalog()` and MCP doctor commands.

## Reference Check

Read Linghun docs required by the user plus Phase 15.5D Connect Lite and Phase F provider/permission/MCP delivery docs. CCB was only used for behavior boundaries and test-thinking. No CCB source, private API, telemetry, or suspicious implementation was copied.

## Product Handoff Packet

- Next phase: Pre-Smoke 04.
- Must not do: advertise executor-less Skill/Plugin contributions as executable, bypass discovery-before-execute, leak raw schema/secrets, or call unsupported transports.
- Evidence refs: `deferred-tools-catalog.ts`, `mcp-index-runtime.ts`, `mcp-sse-runtime.ts`, `phase-f-permission-mcp.test.ts`.
- Validation: focused executor/MCP/security tests plus final validation ledger.
- Index status: no forced rebuild/refresh.
- Permission mode: existing permission pipeline preserved.
- Model/provider: no real provider smoke.
- Budget: no provider calls.
