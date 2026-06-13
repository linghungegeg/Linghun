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
Third-party binaries must include their license next to the binary.

## Status

Windows x64 currently ships a real Linghun native-runner binary:

```
bundled/native-runner/win32-x64/linghun-native-runner.exe
```

Other platforms still require their matching binary to be added before release.
The resolution logic in `@linghun/tui` will gracefully fall back to Node/TUI
when no bundled native-runner binary is present for the current platform.
