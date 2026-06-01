import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "@linghun/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIndexState } from "./index-runtime.js";
import {
  findBundledCodebaseMemoryBinary,
  getBundledCodebaseMemoryRoots,
  getCodebaseMemoryPlatformArch,
} from "./index.js";
import type { TuiContext } from "./index.js";
import { formatIndexStatus } from "./mcp-index-command-runtime.js";
import {
  rememberCodebaseMemoryResolution,
  resolveCodebaseMemoryBinary,
} from "./mcp-index-runtime.js";
import { resolveNativeRunner } from "./runner-runtime.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function createMinimalContext(
  projectPath: string,
  config = structuredClone(defaultConfig),
): TuiContext {
  return {
    projectPath,
    config,
    language: "zh-CN",
    mcp: {
      enabled: true,
      servers: [],
      tools: [],
    },
    index: createIndexState(config),
  } as unknown as TuiContext;
}

async function writeMockCodebaseMemoryBinary(path: string): Promise<void> {
  await writeFile(
    path,
    `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  console.log("codebase-memory-mcp 0.1.0");
  process.exit(0);
}
process.exit(0);
`,
    "utf8",
  );
  if (process.platform !== "win32") {
    await chmod(path, 0o755);
  }
}

describe("bundled codebase-memory resolution", () => {
  it("getCodebaseMemoryPlatformArch returns current platform-arch by default", () => {
    const result = getCodebaseMemoryPlatformArch();
    expect(result).toBe(`${process.platform}-${process.arch}`);
  });

  it("getCodebaseMemoryPlatformArch respects test override env", () => {
    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_PLATFORM_ARCH_TEST", "linux-x64");
    const result = getCodebaseMemoryPlatformArch();
    expect(result).toBe("linux-x64");
  });

  it("getCodebaseMemoryPlatformArch ignores invalid override", () => {
    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_PLATFORM_ARCH_TEST", "invalid-platform");
    const result = getCodebaseMemoryPlatformArch();
    expect(result).toBe(`${process.platform}-${process.arch}`);
  });

  it("getBundledCodebaseMemoryRoots includes env override when set", () => {
    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_BUNDLED_DIR", "/custom/bundled");
    const roots = getBundledCodebaseMemoryRoots();
    expect(roots[0]).toBe("/custom/bundled");
    expect(roots.length).toBeGreaterThanOrEqual(3);
  });

  it("getBundledCodebaseMemoryRoots includes CLI bundled root before TUI fallback", () => {
    vi.stubEnv("LINGHUN_CLI_BUNDLED_ROOT", "/cli/package/bundled");
    const roots = getBundledCodebaseMemoryRoots();
    expect(roots[0]).toBe(join("/cli/package/bundled", "codebase-memory"));
    expect(roots.slice(1).some((root) => root.includes("bundled"))).toBe(true);
  });

  it("getBundledCodebaseMemoryRoots includes module-relative paths", () => {
    const roots = getBundledCodebaseMemoryRoots();
    expect(roots.length).toBeGreaterThanOrEqual(2);
    for (const root of roots) {
      expect(root).toContain("codebase-memory");
    }
  });

  it("findBundledCodebaseMemoryBinary returns undefined when no binary exists", async () => {
    const result = await findBundledCodebaseMemoryBinary();
    expect(result).toBeUndefined();
  });

  it("findBundledCodebaseMemoryBinary finds .cjs binary in bundled dir", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "linghun-bundled-cm-"));
    const platformArch = `${process.platform}-${process.arch}`;
    const binaryDir = join(tmpDir, platformArch);
    await mkdir(binaryDir, { recursive: true });
    const binaryPath = join(binaryDir, "codebase-memory-mcp.cjs");
    await writeFile(binaryPath, "// mock binary", "utf8");

    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_BUNDLED_DIR", tmpDir);
    const result = await findBundledCodebaseMemoryBinary();
    expect(result).toBeDefined();
    expect(result?.detailPath).toBe(binaryPath);
  });

  it("findBundledCodebaseMemoryBinary finds .exe binary on win32", async () => {
    if (process.platform !== "win32") return;
    const tmpDir = await mkdtemp(join(tmpdir(), "linghun-bundled-cm-"));
    const platformArch = `${process.platform}-${process.arch}`;
    const binaryDir = join(tmpDir, platformArch);
    await mkdir(binaryDir, { recursive: true });
    const binaryPath = join(binaryDir, "codebase-memory-mcp.exe");
    await writeFile(binaryPath, "// mock exe", "utf8");

    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_BUNDLED_DIR", tmpDir);
    const result = await findBundledCodebaseMemoryBinary();
    expect(result).toBeDefined();
    expect(result?.detailPath).toBe(binaryPath);
  });

  it("bundled source does not leak private path in display", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "linghun-bundled-cm-"));
    const platformArch = `${process.platform}-${process.arch}`;
    const binaryDir = join(tmpDir, platformArch);
    await mkdir(binaryDir, { recursive: true });
    const binaryPath = join(binaryDir, "codebase-memory-mcp.cjs");
    await writeFile(binaryPath, "// mock binary", "utf8");

    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_BUNDLED_DIR", tmpDir);
    const result = await findBundledCodebaseMemoryBinary();
    expect(result).toBeDefined();
    // The detailPath is the raw path, but rememberCodebaseMemoryResolution
    // uses redactedPath which only shows basename
    expect(result?.detailPath).toContain("codebase-memory-mcp.cjs");
  });

  it("bundled candidate is skipped for unsupported platform-arch", async () => {
    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_PLATFORM_ARCH_TEST", "freebsd-arm64");
    const tmpDir = await mkdtemp(join(tmpdir(), "linghun-bundled-cm-"));
    const binaryDir = join(tmpDir, "freebsd-arm64");
    await mkdir(binaryDir, { recursive: true });
    await writeFile(join(binaryDir, "codebase-memory-mcp.cjs"), "// mock", "utf8");

    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_BUNDLED_DIR", tmpDir);
    const result = await findBundledCodebaseMemoryBinary();
    expect(result).toBeUndefined();
  });

  it("findBundledCodebaseMemoryBinary finds codebase-memory in CLI package bundled root without TUI-adjacent bundled", async () => {
    const cliBundledRoot = await mkdtemp(join(tmpdir(), "linghun-cli-bundled-cm-"));
    const platformArch = `${process.platform}-${process.arch}`;
    const binaryDir = join(cliBundledRoot, "codebase-memory", platformArch);
    await mkdir(binaryDir, { recursive: true });
    const binaryName =
      process.platform === "win32" ? "codebase-memory-mcp.exe" : "codebase-memory-mcp";
    const binaryPath = join(binaryDir, binaryName);
    await writeMockCodebaseMemoryBinary(binaryPath);

    vi.stubEnv("LINGHUN_CLI_BUNDLED_ROOT", cliBundledRoot);
    const result = await findBundledCodebaseMemoryBinary();
    expect(result?.detailPath).toBe(binaryPath);
  });

  it("findBundledCodebaseMemoryBinary ignores NOTICE-only bundled roots", async () => {
    const bundledRoot = await mkdtemp(join(tmpdir(), "linghun-notice-only-cm-"));
    await writeFile(join(bundledRoot, "NOTICE.md"), "placeholder only", "utf8");

    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_BUNDLED_DIR", bundledRoot);
    const result = await findBundledCodebaseMemoryBinary();
    expect(result).toBeUndefined();
  });
});

describe("bundled codebase-memory priority", () => {
  it("env explicit binary takes priority over bundled root", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "linghun-cm-priority-"));
    const envBinary = join(tmpDir, "env-codebase-memory-mcp.cjs");
    await writeMockCodebaseMemoryBinary(envBinary);

    const bundledRoot = join(tmpDir, "bundled");
    const binaryDir = join(bundledRoot, `${process.platform}-${process.arch}`);
    await mkdir(binaryDir, { recursive: true });
    await writeMockCodebaseMemoryBinary(join(binaryDir, "codebase-memory-mcp.cjs"));

    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_MCP", envBinary);
    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_BUNDLED_DIR", bundledRoot);

    const context = createMinimalContext(tmpDir);
    const result = await resolveCodebaseMemoryBinary(context);
    expect(result.source).toBe("env");
    expect(result.detailPath).toBe(envBinary);
  });

  it("env explicit binary takes priority over CLI bundled root", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "linghun-cm-cli-priority-"));
    const envBinary = join(tmpDir, "env-codebase-memory-mcp.cjs");
    await writeMockCodebaseMemoryBinary(envBinary);

    const cliBundledRoot = join(tmpDir, "cli-bundled");
    const binaryDir = join(
      cliBundledRoot,
      "codebase-memory",
      `${process.platform}-${process.arch}`,
    );
    await mkdir(binaryDir, { recursive: true });
    await writeMockCodebaseMemoryBinary(join(binaryDir, "codebase-memory-mcp.cjs"));

    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_MCP", envBinary);
    vi.stubEnv("LINGHUN_CLI_BUNDLED_ROOT", cliBundledRoot);

    const context = createMinimalContext(tmpDir);
    const result = await resolveCodebaseMemoryBinary(context);
    expect(result.source).toBe("env");
    expect(result.detailPath).toBe(envBinary);
  });

  it("config explicit binary takes priority over bundled root", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "linghun-cm-config-priority-"));
    const configBinary = join(tmpDir, "config-codebase-memory-mcp.cjs");
    await writeMockCodebaseMemoryBinary(configBinary);

    const bundledRoot = join(tmpDir, "bundled");
    const binaryDir = join(bundledRoot, `${process.platform}-${process.arch}`);
    await mkdir(binaryDir, { recursive: true });
    await writeMockCodebaseMemoryBinary(join(binaryDir, "codebase-memory-mcp.cjs"));

    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_BUNDLED_DIR", bundledRoot);

    const config = structuredClone(defaultConfig);
    config.mcp.servers["codebase-memory"] = {
      ...config.mcp.servers["codebase-memory"],
      command: configBinary,
    };
    const context = createMinimalContext(tmpDir, config);
    const result = await resolveCodebaseMemoryBinary(context);
    expect(result.source).toBe("env");
    expect(result.detailPath).toBe(configBinary);
  });

  it("config explicit binary takes priority over CLI bundled root", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "linghun-cm-cli-config-priority-"));
    const configBinary = join(tmpDir, "config-codebase-memory-mcp.cjs");
    await writeMockCodebaseMemoryBinary(configBinary);

    const cliBundledRoot = join(tmpDir, "cli-bundled");
    const binaryDir = join(
      cliBundledRoot,
      "codebase-memory",
      `${process.platform}-${process.arch}`,
    );
    await mkdir(binaryDir, { recursive: true });
    await writeMockCodebaseMemoryBinary(join(binaryDir, "codebase-memory-mcp.cjs"));

    vi.stubEnv("LINGHUN_CLI_BUNDLED_ROOT", cliBundledRoot);

    const config = structuredClone(defaultConfig);
    config.mcp.servers["codebase-memory"] = {
      ...config.mcp.servers["codebase-memory"],
      command: configBinary,
    };
    const context = createMinimalContext(tmpDir, config);
    const result = await resolveCodebaseMemoryBinary(context);
    expect(result.source).toBe("env");
    expect(result.detailPath).toBe(configBinary);
  });

  it("CLI bundled root takes priority over PATH fallback", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "linghun-cm-cli-path-priority-"));
    const cliBundledRoot = join(tmpDir, "cli-bundled");
    const bundledDir = join(
      cliBundledRoot,
      "codebase-memory",
      `${process.platform}-${process.arch}`,
    );
    await mkdir(bundledDir, { recursive: true });
    const bundledBinary = join(bundledDir, "codebase-memory-mcp.cjs");
    await writeMockCodebaseMemoryBinary(bundledBinary);

    const pathDir = join(tmpDir, "path-bin");
    await mkdir(pathDir, { recursive: true });
    await writeMockCodebaseMemoryBinary(join(pathDir, "codebase-memory-mcp.cjs"));

    vi.stubEnv("LINGHUN_CLI_BUNDLED_ROOT", cliBundledRoot);
    vi.stubEnv("PATH", pathDir);

    const context = createMinimalContext(tmpDir);
    const result = await resolveCodebaseMemoryBinary(context);
    expect(result.source).toBe("bundled");
    expect(result.detailPath).toBe(bundledBinary);
  });

  it("NOTICE-only bundled root does not return PASS when PATH is unavailable", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "linghun-cm-notice-resolution-"));
    const bundledRoot = join(tmpDir, "bundled");
    await mkdir(bundledRoot, { recursive: true });
    await writeFile(join(bundledRoot, "NOTICE.md"), "placeholder only", "utf8");

    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_BUNDLED_DIR", bundledRoot);
    vi.stubEnv("PATH", "");

    const config = structuredClone(defaultConfig);
    config.storage.projectData = { scope: "custom", path: join(tmpDir, "project-data") };
    config.storage.index = { scope: "custom", path: join(tmpDir, "index-data") };
    config.storage.userData = { scope: "custom", path: join(tmpDir, "user-data") };
    const context = createMinimalContext(tmpDir, config);
    const result = await resolveCodebaseMemoryBinary(context);
    expect(result.source).toBe("missing");
    expect(result.status).toBe("missing");
    expect(result.status).not.toBe("ready");
  });

  it("NOTICE-only CLI bundled root does not return PASS when PATH is unavailable", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "linghun-cm-cli-notice-resolution-"));
    const cliBundledRoot = join(tmpDir, "cli-bundled");
    await mkdir(join(cliBundledRoot, "codebase-memory"), { recursive: true });
    await writeFile(
      join(cliBundledRoot, "codebase-memory", "NOTICE.md"),
      "placeholder only",
      "utf8",
    );

    vi.stubEnv("LINGHUN_CLI_BUNDLED_ROOT", cliBundledRoot);
    vi.stubEnv("PATH", "");

    const config = structuredClone(defaultConfig);
    config.storage.projectData = { scope: "custom", path: join(tmpDir, "project-data") };
    config.storage.index = { scope: "custom", path: join(tmpDir, "index-data") };
    config.storage.userData = { scope: "custom", path: join(tmpDir, "user-data") };
    const context = createMinimalContext(tmpDir, config);
    const result = await resolveCodebaseMemoryBinary(context);
    expect(result.source).toBe("missing");
    expect(result.status).toBe("missing");
    expect(result.status).not.toBe("ready");
  });

  it("rememberCodebaseMemoryResolution and doctor-visible status redact private and secret-like detail paths", () => {
    const secretPath = join(
      tmpdir(),
      "home-user-sk-test-secret",
      "bundled",
      "codebase-memory",
      `${process.platform}-${process.arch}`,
      "codebase-memory-mcp.cjs",
    );
    const context = createMinimalContext(join(tmpdir(), "linghun-redaction-project"));

    rememberCodebaseMemoryResolution(context, {
      command: process.execPath,
      args: [secretPath],
      source: "bundled",
      status: "ready",
      version: "0.1.0",
      detailPath: secretPath,
      summary: "ready",
    });

    expect(context.index.binaryCommand).toBe("present:codebase-memory-mcp.cjs");
    expect(context.index.binaryCommand).not.toContain("home-user-sk-test-secret");
    expect(context.index.binaryCommand).not.toContain(tmpdir());

    const doctorVisible = formatIndexStatus(context);
    expect(doctorVisible).toContain("binary command: present:codebase-memory-mcp.cjs");
    expect(doctorVisible).not.toContain("home-user-sk-test-secret");
    expect(doctorVisible).not.toContain(tmpdir());
  });
});

describe("bundled native runner resolution", () => {
  it("resolveNativeRunner includes bundled candidate ref", () => {
    const config = structuredClone(defaultConfig);
    config.nativeRunner.enabled = true;
    config.nativeRunner.source = "bundled";
    const result = resolveNativeRunner(config);
    expect(result.bundledCandidateRef).toContain("bundled:");
    expect(result.bundledCandidateRef).toContain("/");
  });

  it("resolveNativeRunner bundled roots include new bundled/native-runner path", () => {
    vi.stubEnv("LINGHUN_NATIVE_RUNNER_BUNDLED_DIR", "/custom/runner/dir");
    const config = structuredClone(defaultConfig);
    config.nativeRunner.enabled = true;
    config.nativeRunner.source = "bundled";
    const result = resolveNativeRunner(config);
    // The bundled candidate ref should reflect the platform
    expect(result.platformArch).toBe(`${process.platform}-${process.arch}`);
  });

  it("native runner bundled candidate finds .cjs in bundled dir", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "linghun-bundled-nr-"));
    const platformArch = `${process.platform}-${process.arch}`;
    const binaryDir = join(tmpDir, platformArch);
    await mkdir(binaryDir, { recursive: true });
    const binaryPath = join(binaryDir, "linghun-native-runner.cjs");
    await writeFile(
      binaryPath,
      `#!/usr/bin/env node
if (process.argv[2] === "version") {
  console.log(JSON.stringify({ protocol: "linghun-native-runner-prototype.v1", version: "0.1.0" }));
  process.exit(0);
}
process.exit(0);
`,
      "utf8",
    );
    if (process.platform !== "win32") {
      await chmod(binaryPath, 0o755);
    }

    vi.stubEnv("LINGHUN_NATIVE_RUNNER_BUNDLED_DIR", tmpDir);
    const config = structuredClone(defaultConfig);
    config.nativeRunner.enabled = true;
    config.nativeRunner.source = "bundled";
    const result = resolveNativeRunner(config);
    expect(result.status).toBe("available");
    expect(result.source).toBe("bundled");
    expect(result.pathRef).toContain("linghun-native-runner");
  });

  it("native runner bundled missing falls back gracefully", () => {
    vi.stubEnv("LINGHUN_NATIVE_RUNNER_BUNDLED_DIR", "/nonexistent/path");
    const config = structuredClone(defaultConfig);
    config.nativeRunner.enabled = true;
    config.nativeRunner.source = "bundled";
    const result = resolveNativeRunner(config);
    expect(result.status).toBe("unavailable");
    expect(result.nodeFallback).toBe("available");
  });

  it("native runner bundled does not leak private path", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "linghun-bundled-nr-leak-"));
    const platformArch = `${process.platform}-${process.arch}`;
    const binaryDir = join(tmpDir, platformArch);
    await mkdir(binaryDir, { recursive: true });
    const binaryPath = join(binaryDir, "linghun-native-runner.cjs");
    await writeFile(
      binaryPath,
      `#!/usr/bin/env node
if (process.argv[2] === "version") {
  console.log(JSON.stringify({ protocol: "linghun-native-runner-prototype.v1", version: "0.1.0" }));
  process.exit(0);
}
process.exit(0);
`,
      "utf8",
    );
    if (process.platform !== "win32") {
      await chmod(binaryPath, 0o755);
    }

    vi.stubEnv("LINGHUN_NATIVE_RUNNER_BUNDLED_DIR", tmpDir);
    const config = structuredClone(defaultConfig);
    config.nativeRunner.enabled = true;
    config.nativeRunner.source = "bundled";
    const result = resolveNativeRunner(config);
    // pathRef should be redacted — only shows basename
    expect(result.pathRef).not.toContain(tmpDir);
    expect(result.pathRef).toContain("linghun-native-runner");
  });

  it("native runner explicit bundled root takes priority over fallback roots", async () => {
    const explicitRoot = await mkdtemp(join(tmpdir(), "linghun-explicit-nr-"));
    const platformArch = `${process.platform}-${process.arch}`;
    const binaryDir = join(explicitRoot, platformArch);
    await mkdir(binaryDir, { recursive: true });
    const binaryPath = join(binaryDir, "linghun-native-runner.cjs");
    await writeFile(
      binaryPath,
      `#!/usr/bin/env node
if (process.argv[2] === "version") {
  console.log(JSON.stringify({ protocol: "linghun-native-runner-prototype.v1", version: "9.9.9" }));
  process.exit(0);
}
process.exit(0);
`,
      "utf8",
    );
    if (process.platform !== "win32") {
      await chmod(binaryPath, 0o755);
    }

    vi.stubEnv("LINGHUN_NATIVE_RUNNER_BUNDLED_DIR", explicitRoot);
    const config = structuredClone(defaultConfig);
    config.nativeRunner.enabled = true;
    config.nativeRunner.source = "bundled";
    const result = resolveNativeRunner(config);
    expect(result.status).toBe("available");
    expect(result.source).toBe("bundled");
    expect(result.version).toBe("9.9.9");
  });

  it("native runner finds CLI bundled root before TUI fallback roots", async () => {
    const cliBundledRoot = await mkdtemp(join(tmpdir(), "linghun-cli-bundled-nr-"));
    const platformArch = `${process.platform}-${process.arch}`;
    const binaryDir = join(cliBundledRoot, "native-runner", platformArch);
    await mkdir(binaryDir, { recursive: true });
    const binaryPath = join(binaryDir, "linghun-native-runner.cjs");
    await writeFile(
      binaryPath,
      `#!/usr/bin/env node
if (process.argv[2] === "version") {
  console.log(JSON.stringify({ protocol: "linghun-native-runner-prototype.v1", version: "7.7.7" }));
  process.exit(0);
}
process.exit(0);
`,
      "utf8",
    );
    if (process.platform !== "win32") {
      await chmod(binaryPath, 0o755);
    }

    vi.stubEnv("LINGHUN_CLI_BUNDLED_ROOT", cliBundledRoot);
    const config = structuredClone(defaultConfig);
    config.nativeRunner.enabled = true;
    config.nativeRunner.source = "bundled";
    const result = resolveNativeRunner(config);
    expect(result.status).toBe("available");
    expect(result.path).toBe(binaryPath);
    expect(result.version).toBe("7.7.7");
    expect(result.pathRef).not.toContain(cliBundledRoot);
  });

  it("native runner config path takes priority over CLI bundled root", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "linghun-nr-config-priority-"));
    const configBinary = join(tmpDir, "config-native-runner.cjs");
    await writeFile(
      configBinary,
      `#!/usr/bin/env node
if (process.argv[2] === "version") {
  console.log(JSON.stringify({ protocol: "linghun-native-runner-prototype.v1", version: "8.8.8" }));
  process.exit(0);
}
process.exit(0);
`,
      "utf8",
    );
    if (process.platform !== "win32") {
      await chmod(configBinary, 0o755);
    }

    const cliBundledRoot = join(tmpDir, "cli-bundled");
    const bundledDir = join(cliBundledRoot, "native-runner", `${process.platform}-${process.arch}`);
    await mkdir(bundledDir, { recursive: true });
    await writeFile(
      join(bundledDir, "linghun-native-runner.cjs"),
      `#!/usr/bin/env node
if (process.argv[2] === "version") {
  console.log(JSON.stringify({ protocol: "linghun-native-runner-prototype.v1", version: "1.1.1" }));
  process.exit(0);
}
process.exit(0);
`,
      "utf8",
    );

    vi.stubEnv("LINGHUN_CLI_BUNDLED_ROOT", cliBundledRoot);
    const config = structuredClone(defaultConfig);
    config.nativeRunner.enabled = true;
    config.nativeRunner.source = "custom";
    config.nativeRunner.path = configBinary;
    const result = resolveNativeRunner(config);
    expect(result.status).toBe("available");
    expect(result.source).toBe("custom");
    expect(result.path).toBe(configBinary);
    expect(result.version).toBe("8.8.8");
  });

  it("native runner ignores NOTICE-only CLI bundled root", async () => {
    const cliBundledRoot = await mkdtemp(join(tmpdir(), "linghun-cli-bundled-nr-notice-"));
    await mkdir(join(cliBundledRoot, "native-runner"), { recursive: true });
    await writeFile(join(cliBundledRoot, "native-runner", "NOTICE.md"), "placeholder only", "utf8");

    vi.stubEnv("LINGHUN_CLI_BUNDLED_ROOT", cliBundledRoot);
    const config = structuredClone(defaultConfig);
    config.nativeRunner.enabled = true;
    config.nativeRunner.source = "bundled";
    const result = resolveNativeRunner(config);
    expect(result.status).toBe("unavailable");
    expect(result.pathRef).not.toContain(cliBundledRoot);
    expect(result.pathRef).not.toContain("NOTICE");
    expect(result.nodeFallback).toBe("available");
  });
});

describe("CLI package files include bundled dirs", () => {
  it("apps/cli/package.json files field includes bundled", async () => {
    const pkg = await import("../../../apps/cli/package.json", { with: { type: "json" } });
    const files: string[] =
      ((pkg.default as Record<string, unknown>).files as string[]) ??
      ((pkg as unknown as Record<string, unknown>).files as string[]) ??
      [];
    expect(files).toContain("bundled");
  });
});
