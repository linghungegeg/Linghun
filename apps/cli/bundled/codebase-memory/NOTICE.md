# Bundled codebase-memory-mcp

This directory is the distribution location for bundled codebase-memory-mcp binaries.

## Directory Convention

```
bundled/codebase-memory/<platform-arch>/codebase-memory-mcp[.exe|.cjs]
```

Supported platform-arch combinations:
- win32-x64
- linux-x64
- darwin-arm64
- darwin-x64

## License

Bundled binaries are subject to their own license terms.
When a real binary is vendored here, a LICENSE file must accompany it.

## Status

No real binary is vendored in this repository.
The resolution logic in `@linghun/tui` will gracefully fall back to managed/PATH/missing
when no bundled binary is present.
