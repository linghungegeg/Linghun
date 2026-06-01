# Bundled native-runner

This directory is the distribution location for bundled native-runner binaries.

## Directory Convention

```
bundled/native-runner/<platform-arch>/linghun-native-runner[.exe|.cjs]
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
The resolution logic in `@linghun/tui` will gracefully fall back to Node/TUI
when no bundled native-runner binary is present.
