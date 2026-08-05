import { spawnSync } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publishRoots = ["apps", "packages"];
const packageManagerCommand = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "corepack";
const tarCommand = process.platform === "win32" ? "tar.exe" : "tar";

async function main() {
  const packages = await findPublishablePackages();
  if (packages.length === 0) {
    throw new Error("No publishable workspace packages were found.");
  }

  const tempDir = await mkdtemp(join(tmpdir(), "linghun-publish-check-"));
  try {
    console.log(`[publish-check] checking ${packages.length} packages`);
    for (const packageInfo of packages) {
      await verifyPackage(packageInfo, tempDir);
    }
    console.log("[publish-check] all package tarballs are publishable");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function findPublishablePackages() {
  const packages = [];
  for (const rootName of publishRoots) {
    const root = join(repoRoot, rootName);
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = join(root, entry.name);
      const packagePath = join(directory, "package.json");
      if (!(await isReadable(packagePath))) continue;
      const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
      if (packageJson.private === true || packageJson.publishConfig === undefined) continue;
      packages.push({ directory, packageJson, packagePath });
    }
  }
  return packages.sort((left, right) => left.packageJson.name.localeCompare(right.packageJson.name));
}

async function verifyPackage(packageInfo, tempDir) {
  const before = new Set(await readdir(tempDir));
  const packArgs =
    process.platform === "win32"
      ? [
          "/d",
          "/c",
          "corepack",
          "pnpm",
          "pack",
          "--pack-destination",
          tempDir,
        ]
      : ["pnpm", "pack", "--pack-destination", tempDir];
  const result = spawnSync(packageManagerCommand, packArgs, {
    cwd: packageInfo.directory,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `pnpm pack failed for ${packageInfo.packageJson.name}:\n${result.stdout || ""}\n${result.stderr || ""}`.trim(),
    );
  }

  const archives = (await readdir(tempDir)).filter(
    (name) => name.endsWith(".tgz") && !before.has(name),
  );
  if (archives.length !== 1) {
    throw new Error(
      `expected one tarball for ${packageInfo.packageJson.name}, found ${archives.length}`,
    );
  }

  const archivePath = join(tempDir, archives[0]);
  const packedJson = readTarPackageJson(archivePath);
  if (packedJson.name !== packageInfo.packageJson.name) {
    throw new Error(
      `package name mismatch for ${relative(repoRoot, packageInfo.packagePath)}: ${packedJson.name}`,
    );
  }
  if (packedJson.version !== packageInfo.packageJson.version) {
    throw new Error(
      `package version mismatch for ${packageInfo.packageJson.name}: ${packedJson.version}`,
    );
  }

  const workspaceRefs = findWorkspaceRefs(packedJson);
  if (workspaceRefs.length > 0) {
    throw new Error(
      `${packageInfo.packageJson.name}@${packageInfo.packageJson.version} contains workspace protocol in packed metadata:\n${workspaceRefs.join("\n")}`,
    );
  }
  console.log(`  ok ${packageInfo.packageJson.name}@${packageInfo.packageJson.version}`);
}

function readTarPackageJson(archivePath) {
  const result = spawnSync(tarCommand, ["-xOf", archivePath, "package/package.json"], {
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`could not read package metadata from ${archivePath}:\n${result.stderr || ""}`.trim());
  }
  return JSON.parse(result.stdout);
}

function findWorkspaceRefs(value, path = [], refs = []) {
  if (typeof value === "string") {
    if (value.includes("workspace:")) refs.push(`${path.join(".")}: ${value}`);
    return refs;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findWorkspaceRefs(item, [...path, String(index)], refs));
    return refs;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      findWorkspaceRefs(item, [...path, key], refs);
    }
  }
  return refs;
}

async function isReadable(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
