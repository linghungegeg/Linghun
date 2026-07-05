# Linghun Agent Guide

This file mirrors `AGENTS.md` for coding assistants that read `CLAUDE.md`.

## Working Rules

- Keep changes minimal and focused on the requested task.
- Do not bundle unrelated cleanup, refactors, dependency changes, or formatting.
- Prefer existing project patterns over new abstractions.
- Use `rg` / `rg --files` first when locating code.
- For manual file edits, use the editing mechanism supported by the current runtime. On Windows/PowerShell, do not use shell `apply_patch`, heredocs, `cat` redirects, or `tee` redirects for writes; use structured edit/write tools instead.
- Do not delete, rename, or move files unless the task explicitly requires it.
- Do not claim a fix is complete without running the most relevant verification.
- If verification cannot be run, say why and describe the remaining risk.

## Project Setup

Linghun is a pnpm monorepo. The public CLI package is `@linghun/cli`.

Common local commands:

```bash
corepack pnpm install
corepack pnpm -r build
corepack pnpm test
corepack pnpm typecheck
```

CLI smoke checks:

```bash
node apps/cli/dist/main.js --version
node apps/cli/dist/main.js --help
```

## Packaging

The CLI package is designed for one-command installation after publishing:

```bash
npm install -g @linghun/cli
```

Before publishing, build and pack locally:

```bash
corepack pnpm -r build
corepack pnpm --filter @linghun/cli pack
```

Bundled runtime files are prepared by `scripts/bundle-cli-binaries.mjs` during
CLI prepack.

## Public Documentation

Public entry points:

- `README.md`
- `README.en.md`
- `WHITEPAPER.md`
- `WHITEPAPER.en.md`
- `docs/developers/capability-runtime-app-bridge.md`
- `docs/developers/capability-runtime-app-bridge.en.md`
- `APP_BRIDGE_MANIFEST.schema.json`
- `app-bridge-examples/`

Keep public docs understandable for new users. Detailed runtime or architecture
claims should link to the whitepaper instead of duplicating long explanations.

## Safety

- Never commit secrets, local absolute paths, private audit notes, or machine
  specific configuration.
- Use synthetic paths in tests when Windows path behavior needs coverage.
- Keep permission, provider, tool execution, and file editing behavior explicit
  and observable.
