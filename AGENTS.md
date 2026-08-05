# Linghun Agent Guide

This file is public contributor guidance for coding agents working in this
repository.

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

Release safety rules:

- `workspace:*` is allowed in source package manifests, but must never appear
  in packed npm metadata.
- Do not run `npm publish` from a workspace package directory. It can publish
  `workspace:*` unchanged. Use `pnpm pack` or `pnpm publish` so workspace
  ranges are resolved before publishing.
- Before publishing any package, run `corepack pnpm release:verify`. It packs
  every publishable workspace package and fails if the tarball metadata still
  contains a `workspace:` reference or has a name/version mismatch.
- Publish packages in dependency order, then install the new CLI version in a
  fresh temporary npm prefix and run `linghun --version`. Do not rely on an
  existing `node_modules` tree.
- Published npm versions cannot be overwritten. If a bad version is already
  public, bump the affected package and its dependents, update `pnpm-lock.yaml`,
  and publish the corrected versions in dependency order.
- Keep npm auth in an external userconfig or environment; never commit tokens
  or local npmrc files.

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
