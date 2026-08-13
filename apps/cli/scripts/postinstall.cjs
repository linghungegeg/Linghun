const { chmodSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { createRequire } = require("node:module");

const root = join(__dirname, "..");
const requireFromCli = createRequire(__filename);
const executables = [
  ["bundled", "codebase-memory", "linux-x64", "codebase-memory-mcp"],
  ["bundled", "codebase-memory", "darwin-arm64", "codebase-memory-mcp"],
  ["bundled", "codebase-memory", "darwin-x64", "codebase-memory-mcp"],
  ["bundled", "native-runner", "linux-x64", "linghun-native-runner"],
  ["bundled", "native-runner", "darwin-arm64", "linghun-native-runner"],
  ["bundled", "native-runner", "darwin-x64", "linghun-native-runner"],
  ["bundled", "pre-engine", "linux-x64", "linghun-pre-engine"],
  ["bundled", "pre-engine", "darwin-arm64", "linghun-pre-engine"],
  ["bundled", "pre-engine", "darwin-x64", "linghun-pre-engine"],
];

for (const parts of executables) {
  const file = join(root, ...parts);
  if (existsSync(file)) {
    chmodSync(file, 0o755);
  }
}

for (const packageName of [
  "@linghun/codebase-memory-linux-x64",
  "@linghun/codebase-memory-darwin-arm64",
  "@linghun/codebase-memory-darwin-x64",
  "@linghun/native-runner-linux-x64",
  "@linghun/native-runner-darwin-arm64",
  "@linghun/native-runner-darwin-x64",
  "@linghun/pre-engine-linux-x64",
  "@linghun/pre-engine-darwin-arm64",
  "@linghun/pre-engine-darwin-x64",
]) {
  try {
    const packageRoot = join(requireFromCli.resolve(`${packageName}/package.json`), "..");
    const executable =
      packageName.includes("codebase-memory")
        ? join(
            packageRoot,
            "bundled",
            "codebase-memory",
            packageName.replace("@linghun/codebase-memory-", ""),
            "codebase-memory-mcp",
          )
        : packageName.includes("pre-engine")
          ? join(
              packageRoot,
              "bundled",
              "pre-engine",
              packageName.replace("@linghun/pre-engine-", ""),
              "linghun-pre-engine",
            )
          : join(
              packageRoot,
              "bundled",
              "native-runner",
              packageName.replace("@linghun/native-runner-", ""),
              "linghun-native-runner",
            );
    if (existsSync(executable)) {
      chmodSync(executable, 0o755);
    }
  } catch {
    // Optional platform packages are intentionally absent on other platforms.
  }
}
