const { chmodSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const executables = [
  ["bundled", "codebase-memory", "linux-x64", "codebase-memory-mcp"],
  ["bundled", "codebase-memory", "darwin-arm64", "codebase-memory-mcp"],
  ["bundled", "codebase-memory", "darwin-x64", "codebase-memory-mcp"],
  ["bundled", "native-runner", "linux-x64", "linghun-native-runner"],
  ["bundled", "native-runner", "darwin-arm64", "linghun-native-runner"],
  ["bundled", "native-runner", "darwin-x64", "linghun-native-runner"],
];

for (const parts of executables) {
  const file = join(root, ...parts);
  if (existsSync(file)) {
    chmodSync(file, 0o755);
  }
}
