# Run 3 Preflight Blocker Closure - 2026-05-31

## Verdict

PASS for preflight blocker closure. This is not Run 3 formal acceptance, not a long pressure run, and not a Beta/open-source readiness verdict.

Scope was limited to:

- Close the `@linghun/providers` mock SSE fixture blocker without weakening provider runtime hardening.
- Close the `@linghun/tools` Windows timeout/cancel process-tree cleanup blocker without swallowing timeout or relaxing assertions.
- Stop root `pnpm check` from scanning historical `.claude/worktrees` parallel workspaces.
- Verify live provider env injection and doctor/smoke redaction boundaries without storing real keys.

## Changed Files

Code/runtime:

- `packages/tools/src/index.ts`
  - Windows Bash timeout/cancel now uses `taskkill /pid <pid> /t /f` for the shell process tree and waits for the cleanup helper before returning.
  - Timeout/cancel outcome is preserved with `stoppingOutcome`; a child `close` event during cleanup can no longer race the result into `completed`.
  - Non-Windows behavior keeps the existing graceful stop plus scheduled force-stop path.

Tests/fixtures:

- `packages/providers/src/index.test.ts`
  - Added `content-type: text/event-stream` to three successful 200 streaming mock responses.
  - Provider runtime `PROVIDER_NON_SSE_STREAM` hardening was not relaxed.

Config:

- `biome.json`
  - Added `.claude` to `files.ignore` so root `biome check .` does not scan historical `.claude/worktrees` workspaces.

Docs:

- `docs/audit/run-3-preflight-blocker-closure-2026-05-31.md`

Pre-existing / not touched:

- `WHITEPAPER.md`
- `WHITEPAPER.en.md`
- untracked `.claude/`

## Blocker Closure Notes

### 1. Providers SSE Fixture

Root cause matched the preflight finding: success-path mock stream responses returned 200 without `content-type: text/event-stream`, so the hardened runtime correctly rejected them as `PROVIDER_NON_SSE_STREAM`.

Fix was limited to provider test fixtures. Runtime SSE validation remains strict.

Focused validation:

- `corepack pnpm --filter @linghun/providers exec vitest run src/index.test.ts -t "normalizes endpoint URL|safe Linghun request identity headers|same safe identity headers"` - PASS, 6 tests.

Full package validation:

- `corepack pnpm --filter @linghun/providers exec vitest run` - PASS, 118 tests.

### 2. Tools Windows Process Cleanup

Root cause: on Windows, timeout/cancel returned before process-tree cleanup was reliably complete, and the child `close` event could race the intended `timeout` / `cancelled` outcome.

Fix:

- Windows timeout/cancel uses forced `taskkill /t /f` on the shell root pid.
- `runShell` waits for that cleanup helper before resolving.
- `stoppingOutcome` prevents `close` from changing timeout/cancel into completed.
- Assertions were not relaxed.

Focused validation:

- `corepack pnpm --filter @linghun/tools exec vitest run -t "terminates child and grandchild"` - PASS.

Full package validation:

- `corepack pnpm --filter @linghun/tools exec vitest run` - PASS, 11 tests.

### 3. `pnpm check` Noise

Root cause:

- root `package.json` has `check: biome check .`.
- `biome.json` already ignored `dist`, `node_modules`, `.codebase-memory`, and `.linghun`, but not `.claude`.
- Therefore root-dot scanning included historical `.claude/worktrees` parallel workspaces.

Fix:

- Added `.claude` to `biome.json` `files.ignore`.

Observed result:

- `corepack pnpm exec biome check .` now checks 204 normal repo files and no longer scans `.claude/worktrees`.
- It still reports existing formatter/import/lint diagnostics in tracked repo files. Those are historical noise and were not batch-formatted in this preflight closure.

Scoped check:

- `corepack pnpm exec biome check biome.json packages/tools/src/index.ts` - PASS.

Known historical check noise examples observed after excluding `.claude`:

- `packages/core/src/session-store.test.ts`
- `packages/config/src/index.test.ts`
- multiple `packages/tui/src/*` formatter/import diagnostics
- `packages/providers/src/index.test.ts` pre-existing formatter diagnostics outside this fixture-only change

### 4. Live Provider Env Injection

Current shell provider env check:

- `LINGHUN_DEEPSEEK_API_KEY=missing`
- `LINGHUN_DEEPSEEK_MODEL=missing`
- `LINGHUN_DEEPSEEK_BASE_URL=missing`
- `LINGHUN_OPENAI_API_KEY=missing`
- `LINGHUN_OPENAI_MODEL=missing`
- `LINGHUN_OPENAI_BASE_URL=missing`
- `LINGHUN_OPENAI_ENDPOINT_PROFILE=missing`
- `LINGHUN_INFERENCE_LEVEL=missing`

Temporary env validation:

- Used only command-local fake env values for `LINGHUN_OPENAI_API_KEY`, `LINGHUN_OPENAI_MODEL`, and `LINGHUN_OPENAI_BASE_URL`.
- `corepack pnpm exec linghun model doctor` reported `apiKey=present source=env masked=sk-...cret`.
- Doctor did not print the raw key or raw private baseUrl; it reported `baseUrl=present`, `endpointPath=/v1`, and a query/fragment warning.

Smoke validation:

- `corepack pnpm run smoke:live-provider` - PASS/SKIPPED because no real provider key is present in the shell.
- Output did not leak key or baseUrl.

No real DeepSeek/GPT/OpenAI key was written to the repo, report, or provider config.

## Required Validation

- `corepack pnpm exec tsc --noEmit` - PASS.
- `corepack pnpm typecheck` - PASS.
- `corepack pnpm --filter @linghun/providers exec vitest run` - PASS, 118 tests.
- `corepack pnpm --filter @linghun/tools exec vitest run` - PASS, 11 tests.
- `corepack pnpm --filter @linghun/tui exec vitest run` - PASS, 51 files / 2026 tests.
- `corepack pnpm --filter @linghun/cli exec vitest run` - PASS, 8 tests.
- `corepack pnpm --filter @linghun/tui build` - PASS.
- `corepack pnpm --filter @linghun/cli build` - PASS.
- `git diff --check` - PASS.

Additional checks:

- `corepack pnpm exec biome check .` - FAIL only on historical tracked-file formatter/import/lint diagnostics after `.claude` exclusion; not fixed in this scoped closure.
- `corepack pnpm exec biome check biome.json packages/tools/src/index.ts` - PASS.

## Reference Check

Linghun documents read for this closure:

- `F:\Linghun\LINGHUN_PHASED_DELIVERY_BLUEPRINT.md`
- `F:\Linghun\LINGHUN_IMPLEMENTATION_SPEC.md`
- `F:\Linghun\LINGHUN_FINAL_ARCHITECTURE_AND_ROADMAP.md`
- `F:\Linghun\docs\delivery\README.md`
- Existing `F:\Linghun\docs\delivery\phase-*.md` index/state list

Reference use:

- No CCB / CCB Dev Boost source implementation was copied.
- Existing Linghun runtime and test facts were used as source of truth.
- The subprocess cleanup change follows the existing local `runShell` structure instead of introducing a new process supervisor.

## Handoff Packet

Next step:

- User may review the diff and decide whether to proceed to the next Run 3 preparation step.

Must not do:

- Do not treat this as Run 3 formal acceptance.
- Do not start long pressure tests from this report.
- Do not commit automatically.
- Do not batch-format unrelated historical diagnostics.
- Do not store real provider keys in repo files.

Evidence refs:

- Provider fixture diff: `packages/providers/src/index.test.ts`
- Tools cleanup diff: `packages/tools/src/index.ts`
- Check exclusion diff: `biome.json`
- This report: `docs/audit/run-3-preflight-blocker-closure-2026-05-31.md`

Index status:

- Not refreshed or rebuilt in this closure.

Permission mode:

- Local full filesystem access in the Codex desktop environment; no commit made.

Provider/model:

- Coding agent: Codex in local workspace.
- Live provider env: no real key present in current shell; temporary fake env used only for redaction validation.

Budget:

- No explicit token or cost budget was provided.
