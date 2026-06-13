import { access, copyFile, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliBundledRoot = join(repoRoot, "apps", "cli", "bundled");
const nativeRunnerManifest = join(repoRoot, "prototypes", "native-runner", "Cargo.toml");
const platformArch = `${process.platform}-${process.arch}`;

const nativeRunnerNames =
  process.platform === "win32"
    ? {
        source: "linghun-native-runner-prototype.exe",
        target: "linghun-native-runner.exe",
      }
    : {
        source: "linghun-native-runner-prototype",
        target: "linghun-native-runner",
      };

async function main() {
  await bundleNativeRunner();
  await bundleCodebaseMemory();
}

async function bundleNativeRunner() {
  buildNativeRunner();
  const source = join(
    repoRoot,
    "prototypes",
    "native-runner",
    "target",
    "release",
    nativeRunnerNames.source,
  );
  await assertReadable(source, "native-runner binary");
  const targetDir = join(cliBundledRoot, "native-runner", platformArch);
  await mkdir(targetDir, { recursive: true });
  const target = join(targetDir, nativeRunnerNames.target);
  await copyFile(source, target);
  console.log(`[linghun] bundled native-runner ${platformArch}: ${relative(target)}`);
}

function buildNativeRunner() {
  const attempts =
    process.platform === "win32"
      ? [
          ["cargo", ["build", "--release", "--manifest-path", nativeRunnerManifest]],
          [
            "cargo",
            [
              "+stable-x86_64-pc-windows-gnu",
              "build",
              "--release",
              "--manifest-path",
              nativeRunnerManifest,
            ],
          ],
        ]
      : [["cargo", ["build", "--release", "--manifest-path", nativeRunnerManifest]]];

  const failures = [];
  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
      windowsHide: true,
    });
    if (result.status === 0) return;
    failures.push(`${command} ${args.join(" ")}\n${result.stderr || result.stdout || ""}`.trim());
  }
  throw new Error(`native-runner build failed:\n${failures.join("\n\n")}`);
}

async function bundleCodebaseMemory() {
  const source = findCodebaseMemoryBinary();
  await assertReadable(source, "codebase-memory binary");
  const sourceDir = dirname(source);
  const targetDir = join(cliBundledRoot, "codebase-memory", platformArch);
  await mkdir(targetDir, { recursive: true });
  const target = join(
    targetDir,
    process.platform === "win32" ? "codebase-memory-mcp.exe" : "codebase-memory-mcp",
  );
  await copyFile(source, target);

  const license = join(sourceDir, "LICENSE");
  if (await readable(license)) {
    await copyFile(license, join(targetDir, "LICENSE"));
  }
  console.log(`[linghun] bundled codebase-memory ${platformArch}: ${relative(target)}`);
}

function findCodebaseMemoryBinary() {
  const envPath = process.env.LINGHUN_CODEBASE_MEMORY_MCP;
  if (envPath) {
    const resolved = resolve(envPath);
    if (isCodebaseMemoryNativeBinary(resolved)) return resolved;
    throw new Error(
      `LINGHUN_CODEBASE_MEMORY_MCP must point to a native binary for ${platformArch}: ${resolved}`,
    );
  }

  const command =
    process.platform === "win32" ? ["where.exe", ["codebase-memory-mcp"]] : ["sh", ["-lc", "command -v codebase-memory-mcp"]];
  const result = spawnSync(command[0], command[1], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
  const found = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => isCodebaseMemoryNativeBinary(line));
  if (found) return found;
  throw new Error(
    "codebase-memory-mcp native binary not found. Set LINGHUN_CODEBASE_MEMORY_MCP to the real binary before packing.",
  );
}

function isCodebaseMemoryNativeBinary(path) {
  const lower = path.toLowerCase();
  if (process.platform === "win32") {
    return lower.endsWith("\\codebase-memory-mcp.exe") || lower.endsWith("/codebase-memory-mcp.exe");
  }
  return lower.endsWith("/codebase-memory-mcp") && !lower.endsWith(".cjs");
}

async function assertReadable(path, label) {
  if (!(await readable(path))) {
    throw new Error(`${label} is not readable: ${path}`);
  }
}

async function readable(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function relative(path) {
  return path.replace(repoRoot, ".").replaceAll("\\", "/");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
