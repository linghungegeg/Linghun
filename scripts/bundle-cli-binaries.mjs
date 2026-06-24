import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliBundledRoot = join(repoRoot, "apps", "cli", "bundled");
const nativeRunnerManifest = join(repoRoot, "prototypes", "native-runner", "Cargo.toml");
const preEngineManifest = join(repoRoot, "prototypes", "pre-engine", "Cargo.toml");
const currentPlatformArch = `${process.platform}-${process.arch}`;
const supportedPlatformArches = ["win32-x64", "linux-x64", "darwin-arm64", "darwin-x64"];
const codebaseMemoryVersion = process.env.LINGHUN_CODEBASE_MEMORY_VERSION ?? "v0.8.1";

const codebaseMemoryAssets = {
  "win32-x64": "codebase-memory-mcp-windows-amd64.zip",
  "linux-x64": "codebase-memory-mcp-linux-amd64-portable.tar.gz",
  "darwin-arm64": "codebase-memory-mcp-darwin-arm64.tar.gz",
  "darwin-x64": "codebase-memory-mcp-darwin-amd64.tar.gz",
};

const options = parseArgs(process.argv.slice(2).filter((arg) => arg !== "--"));

async function main() {
  if (options.nativeRunnerArtifacts) {
    await bundleNativeRunnerArtifacts(options.nativeRunnerArtifacts);
  } else if (!options.skipNativeRunner) {
    await bundleNativeRunner(currentPlatformArch);
  }

  await bundlePreEngine(currentPlatformArch);

  if (options.allCodebaseMemory) {
    for (const platformArch of supportedPlatformArches) {
      await bundleReleasedCodebaseMemory(platformArch);
    }
  } else if (options.downloadCodebaseMemory) {
    await bundleReleasedCodebaseMemory(options.platformArch);
  } else {
    await bundleLocalCodebaseMemory(options.platformArch);
  }
}

function parseArgs(args) {
  return {
    allCodebaseMemory: args.includes("--all-codebase-memory"),
    downloadCodebaseMemory: args.includes("--download-codebase-memory"),
    nativeRunnerArtifacts: readOption(args, "--native-runner-artifacts"),
    platformArch: readOption(args, "--platform-arch") ?? currentPlatformArch,
    skipNativeRunner: args.includes("--skip-native-runner"),
  };
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function bundleNativeRunner(platformArch) {
  buildNativeRunner();
  const source = join(
    repoRoot,
    "prototypes",
    "native-runner",
    "target",
    "release",
    nativeRunnerFileName(platformArch, "prototype"),
  );
  await assertReadable(source, "native-runner binary");
  await copyNativeRunner(source, platformArch);
}

async function bundleNativeRunnerArtifacts(artifactsRoot) {
  for (const platformArch of supportedPlatformArches) {
    const source = join(resolve(artifactsRoot), platformArch, nativeRunnerFileName(platformArch));
    if (!(await readable(source))) {
      throw new Error(`native-runner artifact missing for ${platformArch}: ${source}`);
    }
    await copyNativeRunner(source, platformArch);
  }
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

async function copyNativeRunner(source, platformArch) {
  const targetDir = join(cliBundledRoot, "native-runner", platformArch);
  await mkdir(targetDir, { recursive: true });
  const target = join(targetDir, nativeRunnerFileName(platformArch));
  await copyFile(source, target);
  if (!platformArch.startsWith("win32-")) {
    await chmod(target, 0o755);
  }
  console.log(`[linghun] bundled native-runner ${platformArch}: ${relative(target)}`);
}

function nativeRunnerFileName(platformArch, kind = "release") {
  if (kind === "prototype") {
    return platformArch.startsWith("win32-")
      ? "linghun-native-runner-prototype.exe"
      : "linghun-native-runner-prototype";
  }
  return platformArch.startsWith("win32-") ? "linghun-native-runner.exe" : "linghun-native-runner";
}

async function bundlePreEngine(platformArch) {
  buildPreEngine();
  const fileName = preEngineFileName(platformArch);
  const candidates = [
    join(repoRoot, "prototypes", "pre-engine", "target", "release", fileName),
    join(repoRoot, "prototypes", "pre-engine", "target", "x86_64-pc-windows-gnu", "release", fileName),
  ];
  let source;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      source = candidate;
      break;
    } catch {}
  }
  if (!source) {
    await assertReadable(candidates[0], "pre-engine binary");
    return;
  }
  await copyPreEngine(source, platformArch);
}

function buildPreEngine() {
  const attempts =
    process.platform === "win32"
      ? [
          ["cargo", ["build", "--release", "--manifest-path", preEngineManifest]],
          [
            "cargo",
            [
              "+stable-x86_64-pc-windows-gnu",
              "build",
              "--release",
              "--manifest-path",
              preEngineManifest,
            ],
          ],
        ]
      : [["cargo", ["build", "--release", "--manifest-path", preEngineManifest]]];

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
  throw new Error(`pre-engine build failed:\n${failures.join("\n\n")}`);
}

async function copyPreEngine(source, platformArch) {
  const fileName = preEngineFileName(platformArch);
  const helperSource = join(repoRoot, "prototypes", "pre-engine", "ts-deep-layer.cjs");
  const pyHelperSource = join(repoRoot, "prototypes", "pre-engine", "py-deep-layer.cjs");
  const rustHelperSource = join(repoRoot, "prototypes", "pre-engine", "rust-deep-layer.cjs");
  const goHelperSource = join(repoRoot, "prototypes", "pre-engine", "go-deep-layer.cjs");
  const javaHelperSource = join(repoRoot, "prototypes", "pre-engine", "java-deep-layer.cjs");
  const sqlHelperSource = join(repoRoot, "prototypes", "pre-engine", "sql-deep-layer.cjs");

  const cliTargetDir = join(cliBundledRoot, "pre-engine", platformArch);
  await mkdir(cliTargetDir, { recursive: true });
  const cliTarget = join(cliTargetDir, fileName);
  await copyFile(source, cliTarget);
  if (!platformArch.startsWith("win32-")) {
    await chmod(cliTarget, 0o755);
  }
  if (await readable(helperSource)) {
    await copyFile(helperSource, join(cliTargetDir, "ts-deep-layer.cjs"));
  }
  if (await readable(pyHelperSource)) {
    await copyFile(pyHelperSource, join(cliTargetDir, "py-deep-layer.cjs"));
  }
  if (await readable(rustHelperSource)) {
    await copyFile(rustHelperSource, join(cliTargetDir, "rust-deep-layer.cjs"));
  }
  if (await readable(goHelperSource)) {
    await copyFile(goHelperSource, join(cliTargetDir, "go-deep-layer.cjs"));
  }
  if (await readable(javaHelperSource)) {
    await copyFile(javaHelperSource, join(cliTargetDir, "java-deep-layer.cjs"));
  }
  if (await readable(sqlHelperSource)) {
    await copyFile(sqlHelperSource, join(cliTargetDir, "sql-deep-layer.cjs"));
  }
  console.log(`[linghun] bundled pre-engine ${platformArch}: ${relative(cliTarget)}`);

  const pkgTargetDir = join(repoRoot, "packages", `pre-engine-${platformArch}`, "bundled", "pre-engine", platformArch);
  await mkdir(pkgTargetDir, { recursive: true });
  const pkgTarget = join(pkgTargetDir, fileName);
  await copyFile(source, pkgTarget);
  if (!platformArch.startsWith("win32-")) {
    await chmod(pkgTarget, 0o755);
  }
  if (await readable(helperSource)) {
    await copyFile(helperSource, join(pkgTargetDir, "ts-deep-layer.cjs"));
  }
  if (await readable(pyHelperSource)) {
    await copyFile(pyHelperSource, join(pkgTargetDir, "py-deep-layer.cjs"));
  }
  if (await readable(rustHelperSource)) {
    await copyFile(rustHelperSource, join(pkgTargetDir, "rust-deep-layer.cjs"));
  }
  if (await readable(goHelperSource)) {
    await copyFile(goHelperSource, join(pkgTargetDir, "go-deep-layer.cjs"));
  }
  if (await readable(javaHelperSource)) {
    await copyFile(javaHelperSource, join(pkgTargetDir, "java-deep-layer.cjs"));
  }
  if (await readable(sqlHelperSource)) {
    await copyFile(sqlHelperSource, join(pkgTargetDir, "sql-deep-layer.cjs"));
  }
  console.log(`[linghun] bundled pre-engine pkg ${platformArch}: ${relative(pkgTarget)}`);
}

function preEngineFileName(platformArch) {
  return platformArch.startsWith("win32-") ? "linghun-pre-engine.exe" : "linghun-pre-engine";
}

async function bundleLocalCodebaseMemory(platformArch) {
  const source = findCodebaseMemoryBinary(platformArch);
  await assertReadable(source, "codebase-memory binary");
  await copyCodebaseMemory(source, dirname(source), platformArch);
}

async function bundleReleasedCodebaseMemory(platformArch) {
  const assetName = codebaseMemoryAssets[platformArch];
  if (!assetName) {
    throw new Error(`codebase-memory release asset is not configured for ${platformArch}`);
  }

  const release = await fetchJson(
    `https://api.github.com/repos/DeusData/codebase-memory-mcp/releases/tags/${codebaseMemoryVersion}`,
  );
  const asset = release.assets?.find((candidate) => candidate.name === assetName);
  if (!asset?.browser_download_url) {
    throw new Error(`codebase-memory release asset not found: ${codebaseMemoryVersion}/${assetName}`);
  }

  const workspace = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-release-"));
  try {
    const archive = join(workspace, assetName);
    await downloadFile(asset.browser_download_url, archive);
    if (asset.digest) {
      await verifyDigest(archive, asset.digest);
    }
    const extractDir = join(workspace, "extract");
    await mkdir(extractDir, { recursive: true });
    extractArchive(archive, extractDir);
    const binary = await findExtractedCodebaseMemoryBinary(extractDir, platformArch);
    await copyCodebaseMemory(binary, dirname(binary), platformArch);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

async function copyCodebaseMemory(source, sourceDir, platformArch) {
  const targetDir = join(cliBundledRoot, "codebase-memory", platformArch);
  await mkdir(targetDir, { recursive: true });
  const target = join(targetDir, codebaseMemoryFileName(platformArch));
  await copyFile(source, target);
  if (!platformArch.startsWith("win32-")) {
    await chmod(target, 0o755);
  }

  for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md", "NOTICE.md"]) {
    const metadata = join(sourceDir, name);
    if (await readable(metadata)) {
      await copyTextMetadata(metadata, join(targetDir, name));
    }
  }
  console.log(`[linghun] bundled codebase-memory ${platformArch}: ${relative(target)}`);
}

function findCodebaseMemoryBinary(platformArch) {
  const envPath = process.env.LINGHUN_CODEBASE_MEMORY_MCP;
  if (envPath) {
    const resolved = resolve(envPath);
    if (isCodebaseMemoryNativeBinary(resolved, platformArch)) return resolved;
    throw new Error(
      `LINGHUN_CODEBASE_MEMORY_MCP must point to a native binary for ${platformArch}: ${resolved}`,
    );
  }

  const command =
    process.platform === "win32"
      ? ["where.exe", ["codebase-memory-mcp"]]
      : ["sh", ["-lc", "command -v codebase-memory-mcp"]];
  const result = spawnSync(command[0], command[1], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
  const found = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => isCodebaseMemoryNativeBinary(line, platformArch));
  if (found) return found;
  throw new Error(
    "codebase-memory-mcp native binary not found. Set LINGHUN_CODEBASE_MEMORY_MCP to the real binary before packing.",
  );
}

async function findExtractedCodebaseMemoryBinary(root, platformArch) {
  const expected = codebaseMemoryFileName(platformArch);
  const matches = await findFiles(root, expected);
  const match = matches.find((path) => basename(path) === expected);
  if (!match) {
    throw new Error(`extracted codebase-memory binary not found: ${expected}`);
  }
  return match;
}

async function findFiles(root, fileName) {
  const result = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await findFiles(path, fileName)));
    } else if (entry.name === fileName) {
      result.push(path);
    }
  }
  return result;
}

function extractArchive(archive, targetDir) {
  const result = spawnSync("tar", ["-xf", archive, "-C", targetDir], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`failed to extract ${archive}:\n${result.stderr || result.stdout}`);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "linghun-build" },
  });
  if (!response.ok) {
    throw new Error(`request failed ${response.status}: ${url}`);
  }
  return await response.json();
}

async function downloadFile(url, target) {
  const response = await fetch(url, { headers: { "User-Agent": "linghun-build" } });
  if (!response.ok || !response.body) {
    throw new Error(`download failed ${response.status}: ${url}`);
  }
  const chunks = [];
  for await (const chunk of response.body) {
    chunks.push(Buffer.from(chunk));
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.concat(chunks));
}

async function verifyDigest(path, digest) {
  const [algorithm, expected] = digest.split(":");
  if (algorithm !== "sha256" || !expected) {
    throw new Error(`unsupported digest format: ${digest}`);
  }
  const content = await readFile(path);
  const actual = createHash("sha256").update(content).digest("hex");
  if (actual !== expected) {
    throw new Error(`digest mismatch for ${path}: expected ${expected}, got ${actual}`);
  }
}

async function copyTextMetadata(source, target) {
  const text = await readFile(source, "utf8");
  await writeFile(target, `${text.replace(/[ \t]+$/gmu, "").replace(/\s+$/u, "")}\n`, "utf8");
}

function isCodebaseMemoryNativeBinary(path, platformArch) {
  const lower = path.toLowerCase();
  if (platformArch.startsWith("win32-")) {
    return lower.endsWith("\\codebase-memory-mcp.exe") || lower.endsWith("/codebase-memory-mcp.exe");
  }
  return lower.endsWith("/codebase-memory-mcp") && !lower.endsWith(".cjs");
}

function codebaseMemoryFileName(platformArch) {
  return platformArch.startsWith("win32-") ? "codebase-memory-mcp.exe" : "codebase-memory-mcp";
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
