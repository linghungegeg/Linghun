"use strict";

const { spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");

const SCHEMA_VERSION = 1;
const TOPOLOGY_VERSION = "structural-1k-v1";
const MAX_STDERR_BYTES = 1024 * 1024;
const MAX_STDOUT_LINE_BYTES = 32 * 1024 * 1024;
const activeClients = new Set();
const wslPathCache = new Map();

function usage() {
  return [
    "Usage: node bench-structural-1k.cjs [options]",
    "  --binary <path>                 Pre-engine binary host path",
    "  --runner <auto|direct|wsl>      Process runner (default: auto)",
    "  --wsl-distro <name>             Optional WSL distribution",
    "  --file-count <n>                Synthetic source files (default: 1000)",
    "  --cold-runs <n>                 Fresh-process index runs (default: 5)",
    "  --context-runs <n>              Warm context queries (default: 100)",
    "  --plan-runs <n>                 Warm plan queries (default: 50)",
    "  --impact-runs <n>               Warm one-seed impact queries (default: 50)",
    "  --seed-impact-runs <n>          Warm all-seed impact queries (default: 10)",
    "  --warmup-runs <n>               Warmups per tool (default: 2)",
    "  --baseline <path>               Optional previous JSON report",
    "  --output <path>                 Optional JSON report path",
    "  --keep-fixture                  Keep generated fixture",
    "  --allow-debug                   Allow a debug binary for a gate run",
    "  --allow-missing-rss             Do not fail when RSS is unavailable",
    "  --allow-hash-change             Do not compare hashes with baseline",
    "  --self-check                    Run a reduced end-to-end benchmark",
    "  --help                          Show this help",
  ].join("\n");
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

function parsePositiveNumber(value, optionName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive number`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    binary: null,
    runner: "auto",
    wslDistro: null,
    fileCount: 1000,
    coldRuns: 5,
    contextRuns: 100,
    planRuns: 50,
    impactRuns: 50,
    seedImpactRuns: 10,
    warmupRuns: 2,
    baseline: null,
    output: null,
    keepFixture: false,
    allowDebug: false,
    allowMissingRss: false,
    allowHashChange: false,
    selfCheck: false,
    help: false,
    timeouts: {
      initializeMs: 15000,
      contextMs: 2000,
      planMs: 5000,
      impactMs: 5000,
      seedImpactMs: 15000,
      overallMs: 120000,
    },
    baselineLimits: {
      coldRatio: 1.10,
      warmRatio: 1.25,
      warmSlackMs: 10,
      rssRatio: 1.15,
      rssSlackMb: 32,
    },
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${argument} requires a value`);
      return argv[index];
    };
    switch (argument) {
      case "--binary": options.binary = nextValue(); break;
      case "--runner": options.runner = nextValue(); break;
      case "--wsl-distro": options.wslDistro = nextValue(); break;
      case "--file-count": options.fileCount = parsePositiveInteger(nextValue(), argument); break;
      case "--cold-runs": options.coldRuns = parsePositiveInteger(nextValue(), argument); break;
      case "--context-runs": options.contextRuns = parsePositiveInteger(nextValue(), argument); break;
      case "--plan-runs": options.planRuns = parsePositiveInteger(nextValue(), argument); break;
      case "--impact-runs": options.impactRuns = parsePositiveInteger(nextValue(), argument); break;
      case "--seed-impact-runs": options.seedImpactRuns = parsePositiveInteger(nextValue(), argument); break;
      case "--warmup-runs": options.warmupRuns = parsePositiveInteger(nextValue(), argument); break;
      case "--baseline": options.baseline = nextValue(); break;
      case "--output": options.output = nextValue(); break;
      case "--initialize-timeout-ms": options.timeouts.initializeMs = parsePositiveInteger(nextValue(), argument); break;
      case "--context-timeout-ms": options.timeouts.contextMs = parsePositiveInteger(nextValue(), argument); break;
      case "--plan-timeout-ms": options.timeouts.planMs = parsePositiveInteger(nextValue(), argument); break;
      case "--impact-timeout-ms": options.timeouts.impactMs = parsePositiveInteger(nextValue(), argument); break;
      case "--seed-impact-timeout-ms": options.timeouts.seedImpactMs = parsePositiveInteger(nextValue(), argument); break;
      case "--overall-timeout-ms": options.timeouts.overallMs = parsePositiveInteger(nextValue(), argument); break;
      case "--cold-ratio": options.baselineLimits.coldRatio = parsePositiveNumber(nextValue(), argument); break;
      case "--warm-ratio": options.baselineLimits.warmRatio = parsePositiveNumber(nextValue(), argument); break;
      case "--warm-slack-ms": options.baselineLimits.warmSlackMs = parsePositiveNumber(nextValue(), argument); break;
      case "--rss-ratio": options.baselineLimits.rssRatio = parsePositiveNumber(nextValue(), argument); break;
      case "--rss-slack-mb": options.baselineLimits.rssSlackMb = parsePositiveNumber(nextValue(), argument); break;
      case "--keep-fixture": options.keepFixture = true; break;
      case "--allow-debug": options.allowDebug = true; break;
      case "--allow-missing-rss": options.allowMissingRss = true; break;
      case "--allow-hash-change": options.allowHashChange = true; break;
      case "--self-check": options.selfCheck = true; break;
      case "--help": options.help = true; break;
      default: throw new Error(`unknown option: ${argument}`);
    }
  }

  if (!new Set(["auto", "direct", "wsl"]).has(options.runner)) {
    throw new Error("--runner must be auto, direct, or wsl");
  }
  if (options.fileCount < 20) {
    throw new Error("--file-count must be at least 20");
  }
  if (options.selfCheck) {
    options.fileCount = 100;
    options.coldRuns = 1;
    options.contextRuns = 3;
    options.planRuns = 2;
    options.impactRuns = 2;
    options.seedImpactRuns = 1;
    options.warmupRuns = 1;
    options.baseline = null;
    options.allowDebug = true;
    options.timeouts.initializeMs = Math.max(options.timeouts.initializeMs, 30000);
    options.timeouts.contextMs = Math.max(options.timeouts.contextMs, 10000);
    options.timeouts.planMs = Math.max(options.timeouts.planMs, 10000);
    options.timeouts.impactMs = Math.max(options.timeouts.impactMs, 10000);
    options.timeouts.seedImpactMs = Math.max(options.timeouts.seedImpactMs, 30000);
    options.timeouts.overallMs = Math.min(options.timeouts.overallMs, 60000);
  }
  return options;
}

function findDefaultBinary(scriptDirectory) {
  const names = process.platform === "win32"
    ? [
        "target/release/linghun-pre-engine.exe",
        "target/release/linghun-pre-engine",
        "target/debug/linghun-pre-engine.exe",
        "target/debug/linghun-pre-engine",
      ]
    : ["target/release/linghun-pre-engine", "target/debug/linghun-pre-engine"];
  for (const name of names) {
    const candidate = path.resolve(scriptDirectory, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("pre-engine binary not found; pass --binary after building it");
}

function isElfBinary(binaryPath) {
  const fileDescriptor = fs.openSync(binaryPath, "r");
  try {
    const header = Buffer.alloc(4);
    fs.readSync(fileDescriptor, header, 0, 4, 0);
    return header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

function inferBuildProfile(binaryPath) {
  const normalized = binaryPath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/release/")) return "release";
  if (normalized.includes("/debug/")) return "debug";
  return "unknown";
}

function resolveRunner(requestedRunner, binaryPath) {
  if (requestedRunner !== "auto") return requestedRunner;
  if (process.platform === "win32" && isElfBinary(binaryPath)) return "wsl";
  return "direct";
}

function wslPrefix(wslDistro) {
  return wslDistro ? ["-d", wslDistro, "--"] : ["--"];
}

function mapHostPathToWsl(hostPath, wslDistro) {
  const portableHostPath = path.resolve(hostPath).replace(/\\/g, "/");
  const cacheKey = `${wslDistro || "default"}\n${portableHostPath}`;
  if (wslPathCache.has(cacheKey)) return wslPathCache.get(cacheKey);
  const result = spawnSync(
    "wsl.exe",
    [...wslPrefix(wslDistro), "wslpath", "-a", portableHostPath],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(`wslpath failed for ${hostPath}: ${(result.stderr || "").trim()}`);
  }
  const mappedPath = result.stdout.trim();
  wslPathCache.set(cacheKey, mappedPath);
  return mappedPath;
}

function appendLimited(current, addition, limit) {
  const combined = current + addition;
  return combined.length <= limit ? combined : combined.slice(combined.length - limit);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

class JsonRpcClient {
  constructor({ binaryPath, runner, wslDistro }) {
    this.binaryPath = binaryPath;
    this.runner = runner;
    this.wslDistro = wslDistro;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.guestPid = null;
    this.resolveGuestPid = null;
    this.guestPidPromise = runner === "wsl"
      ? new Promise((resolve) => { this.resolveGuestPid = resolve; })
      : Promise.resolve(null);
    this.closed = false;

    if (runner === "wsl") {
      const wslBinary = mapHostPathToWsl(binaryPath, wslDistro);
      const launchCommand = `printf '__BENCH_PID=%s\\n' "$$" >&2; exec ${shellQuote(wslBinary)}`;
      this.spawnStartedAt = performance.now();
      this.child = spawn(
        "wsl.exe",
        [
          ...wslPrefix(wslDistro),
          "bash",
          "-lc",
          launchCommand,
        ],
        { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
      );
    } else {
      this.spawnStartedAt = performance.now();
      this.child = spawn(binaryPath, [], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    }

    this.exitPromise = new Promise((resolve) => {
      this.child.once("close", (code, signal) => {
        this.closed = true;
        if (this.resolveGuestPid) {
          this.resolveGuestPid(null);
          this.resolveGuestPid = null;
        }
        const error = new Error(
          `pre-engine exited before completing requests (code=${code}, signal=${signal})${
            this.stderrBuffer ? `: ${this.stderrBuffer.trim()}` : ""
          }`,
        );
        for (const pendingRequest of this.pending.values()) {
          clearTimeout(pendingRequest.timer);
          pendingRequest.reject(error);
        }
        this.pending.clear();
        resolve({ code, signal });
      });
    });

    this.child.once("error", (error) => this.failAll(error));
    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk.toString()));
    this.child.stderr.on("data", (chunk) => this.handleStderr(chunk.toString()));
    activeClients.add(this);
  }

  mapRoot(rootPath) {
    return this.runner === "wsl"
      ? mapHostPathToWsl(rootPath, this.wslDistro)
      : path.resolve(rootPath);
  }

  handleStderr(text) {
    this.stderrBuffer = appendLimited(this.stderrBuffer, text, MAX_STDERR_BYTES);
    const marker = this.stderrBuffer.match(/__BENCH_PID=(\d+)/);
    if (marker && !this.guestPid) {
      this.guestPid = Number(marker[1]);
      if (this.resolveGuestPid) {
        this.resolveGuestPid(this.guestPid);
        this.resolveGuestPid = null;
      }
    }
  }

  handleStdout(text) {
    this.stdoutBuffer += text;
    if (Buffer.byteLength(this.stdoutBuffer, "utf8") > MAX_STDOUT_LINE_BYTES) {
      this.failAll(new Error("pre-engine stdout line exceeded safety limit"));
      this.terminate();
      return;
    }
    let newlineIndex;
    while ((newlineIndex = this.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        this.failAll(new Error(`invalid JSON-RPC response: ${error.message}`));
        this.terminate();
        return;
      }
      const pendingRequest = this.pending.get(message.id);
      if (!pendingRequest) continue;
      this.pending.delete(message.id);
      clearTimeout(pendingRequest.timer);
      if (message.error) {
        pendingRequest.reject(new Error(`JSON-RPC error: ${JSON.stringify(message.error)}`));
      } else {
        pendingRequest.resolve(message.result);
      }
    }
  }

  failAll(error) {
    for (const pendingRequest of this.pending.values()) {
      clearTimeout(pendingRequest.timer);
      pendingRequest.reject(error);
    }
    this.pending.clear();
  }

  request(method, params, timeoutMs) {
    if (this.closed) return Promise.reject(new Error("pre-engine process is closed"));
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const startedAt = performance.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.terminate();
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        timer,
        reject,
        resolve: (result) => resolve({ result, elapsedMs: performance.now() - startedAt }),
      });
      this.child.stdin.write(`${payload}\n`, (error) => {
        if (!error) return;
        const pendingRequest = this.pending.get(id);
        if (!pendingRequest) return;
        this.pending.delete(id);
        clearTimeout(pendingRequest.timer);
        reject(error);
      });
    });
  }

  async initialize(rootPath, timeoutMs) {
    if (this.runner === "wsl") {
      let launchTimer;
      const guestPid = await Promise.race([
        this.guestPidPromise,
        new Promise((resolve, reject) => {
          launchTimer = setTimeout(
            () => reject(new Error("WSL guest PID marker timed out after 5000ms")),
            5000,
          );
        }),
      ]).finally(() => {
        if (launchTimer) clearTimeout(launchTimer);
      });
      if (!guestPid) throw new Error("WSL process exited before publishing its guest PID");
    }
    const mappedRoot = this.mapRoot(rootPath);
    const response = await this.request("initialize", { rootUri: mappedRoot }, timeoutMs);
    return {
      ...response,
      spawnToResponseMs: performance.now() - this.spawnStartedAt,
      mappedRoot,
    };
  }

  async callTool(name, argumentsValue, timeoutMs) {
    const response = await this.request(
      "tools/call",
      { name, arguments: argumentsValue },
      timeoutMs,
    );
    const toolResult = response.result;
    if (!toolResult || toolResult.isError) {
      throw new Error(`${name} returned an error: ${JSON.stringify(toolResult)}`);
    }
    const textContent = Array.isArray(toolResult.content)
      ? toolResult.content.find((item) => item && item.type === "text")
      : null;
    if (!textContent || typeof textContent.text !== "string") {
      throw new Error(`${name} returned no text content`);
    }
    let payload;
    try {
      payload = JSON.parse(textContent.text);
    } catch (error) {
      throw new Error(`${name} returned non-JSON text: ${error.message}`);
    }
    return { payload, elapsedMs: response.elapsedMs };
  }

  sampleRssMb() {
    try {
      if (this.runner === "wsl") {
        if (!this.guestPid) return null;
        const result = spawnSync(
          "wsl.exe",
          [...wslPrefix(this.wslDistro), "ps", "-o", "rss=", "-p", String(this.guestPid)],
          { encoding: "utf8", windowsHide: true },
        );
        if (result.status !== 0) return null;
        const rssKb = Number(result.stdout.trim());
        return Number.isFinite(rssKb) ? rssKb / 1024 : null;
      }
      if (process.platform === "linux") {
        const status = fs.readFileSync(`/proc/${this.child.pid}/status`, "utf8");
        const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
        return match ? Number(match[1]) / 1024 : null;
      }
      if (process.platform === "win32") {
        const result = spawnSync(
          "tasklist.exe",
          ["/FI", `PID eq ${this.child.pid}`, "/FO", "CSV", "/NH"],
          { encoding: "utf8", windowsHide: true },
        );
        if (result.status !== 0 || /^INFO:/i.test(result.stdout.trim())) return null;
        const fields = [...result.stdout.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
        const memoryField = fields.at(-1) || "";
        const rssKb = Number(memoryField.replace(/[^0-9]/g, ""));
        return Number.isFinite(rssKb) && rssKb > 0 ? rssKb / 1024 : null;
      }
      const result = spawnSync("ps", ["-o", "rss=", "-p", String(this.child.pid)], {
        encoding: "utf8",
      });
      const rssKb = Number(result.stdout.trim());
      return Number.isFinite(rssKb) ? rssKb / 1024 : null;
    } catch {
      return null;
    }
  }

  terminate() {
    if (this.runner === "wsl" && this.guestPid) {
      spawnSync(
        "wsl.exe",
        [...wslPrefix(this.wslDistro), "kill", "-TERM", String(this.guestPid)],
        { encoding: "utf8", windowsHide: true, timeout: 3000 },
      );
    }
    if (!this.closed) this.child.kill();
    if (this.runner === "direct" && process.platform === "win32" && this.child.pid) {
      spawnSync("taskkill.exe", ["/PID", String(this.child.pid), "/T", "/F"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 3000,
      });
    }
  }

  async close() {
    activeClients.delete(this);
    if (this.closed) return;
    this.child.stdin.end();
    let closeTimer;
    await Promise.race([
      this.exitPromise,
      new Promise((resolve) => {
        closeTimer = setTimeout(resolve, 1500);
      }),
    ]);
    if (closeTimer) clearTimeout(closeTimer);
    if (!this.closed) this.terminate();
  }
}

function padNumber(value, width) {
  return String(value).padStart(width, "0");
}

function writeFixtureFile(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function createSyntheticFixture(fileCount) {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "linghun-pre-engine-structural-1k-"),
  );
  const seedCount = Math.min(100, Math.max(2, Math.floor(fileCount * 0.1)));
  const barrelCount = Math.max(1, Math.ceil(seedCount / 10));
  const viewCount = Math.max(1, Math.floor(fileCount * 0.09));
  const featureCount = fileCount - seedCount - barrelCount - viewCount;
  if (featureCount <= 0) throw new Error("file count is too small for benchmark topology");

  const seedSymbols = [];
  const seedFiles = [];
  const featureFiles = [];
  const viewFiles = [];
  const barrelFiles = [];

  for (let seedIndex = 0; seedIndex < seedCount; seedIndex += 1) {
    const symbol = `Seed${padNumber(seedIndex, 3)}`;
    const relativePath = `src/seeds/seed-${padNumber(seedIndex, 3)}.ts`;
    seedSymbols.push(symbol);
    seedFiles.push(relativePath);
    writeFixtureFile(
      fixtureRoot,
      relativePath,
      `export function ${symbol}(value: number) { return value + ${seedIndex}; }\n`,
    );
  }

  for (let barrelIndex = 0; barrelIndex < barrelCount; barrelIndex += 1) {
    const relativePath = `src/barrels/barrel-${padNumber(barrelIndex, 2)}.ts`;
    const firstSeed = barrelIndex * 10;
    const exports = [];
    for (
      let seedIndex = firstSeed;
      seedIndex < Math.min(firstSeed + 10, seedCount);
      seedIndex += 1
    ) {
      exports.push(
        `export { Seed${padNumber(seedIndex, 3)} } from "../seeds/seed-${padNumber(seedIndex, 3)}";`,
      );
    }
    barrelFiles.push(relativePath);
    writeFixtureFile(fixtureRoot, relativePath, `${exports.join("\n")}\n`);
  }

  for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
    const seedIndex = featureIndex % seedCount;
    const barrelIndex = Math.floor(seedIndex / 10);
    const seedSymbol = `Seed${padNumber(seedIndex, 3)}`;
    const featureSymbol = `Feature${padNumber(featureIndex, 4)}`;
    const relativePath = `src/features/feature-${padNumber(featureIndex, 4)}.ts`;
    featureFiles.push(relativePath);
    writeFixtureFile(
      fixtureRoot,
      relativePath,
      [
        `import { ${seedSymbol} } from "../barrels/barrel-${padNumber(barrelIndex, 2)}";`,
        `export function ${featureSymbol}() { return ${seedSymbol}(${featureIndex}); }`,
        "",
      ].join("\n"),
    );
  }

  for (let viewIndex = 0; viewIndex < viewCount; viewIndex += 1) {
    const featureIndex = viewIndex % featureCount;
    const featureSymbol = `Feature${padNumber(featureIndex, 4)}`;
    const viewSymbol = `View${padNumber(viewIndex, 4)}`;
    const relativePath = `src/views/view-${padNumber(viewIndex, 4)}.tsx`;
    viewFiles.push(relativePath);
    writeFixtureFile(
      fixtureRoot,
      relativePath,
      [
        `import { ${featureSymbol} } from "../features/feature-${padNumber(featureIndex, 4)}";`,
        `export function ${viewSymbol}() {`,
        `  return <section data-view="${padNumber(viewIndex, 4)}">{${featureSymbol}()}</section>;`,
        "}",
        "",
      ].join("\n"),
    );
  }

  writeFixtureFile(
    fixtureRoot,
    "tsconfig.json",
    `${JSON.stringify({ compilerOptions: { jsx: "preserve", strict: true }, include: ["src/**/*"] }, null, 2)}\n`,
  );

  const targetSeedIndex = Math.min(42, seedCount - 1);
  const targetSeed = seedSymbols[targetSeedIndex];
  const sourceFiles = [...seedFiles, ...barrelFiles, ...featureFiles, ...viewFiles];
  if (sourceFiles.length !== fileCount) {
    throw new Error(`fixture source count mismatch: ${sourceFiles.length} != ${fileCount}`);
  }
  return {
    root: fixtureRoot,
    fileCount,
    totalFileCount: fileCount + 1,
    seedCount,
    barrelCount,
    featureCount,
    viewCount,
    seedSymbols,
    sourceFiles,
    targetSeed,
    targetSeedFile: seedFiles[targetSeedIndex],
    contextArguments: { symbol: targetSeed, path: seedFiles[targetSeedIndex] },
    planArguments: {
      task: `trace ${targetSeed} module relationships`,
      target_files: [seedFiles[targetSeedIndex]],
      target_symbols: [targetSeed],
    },
    impactArguments: {
      changes: [{ path: seedFiles[targetSeedIndex], symbols: [targetSeed] }],
    },
    seedImpactArguments: {
      changes: [{ path: seedFiles[0], symbols: seedSymbols }],
    },
  };
}

function normalizeForHash(value, rootVariants) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForHash(item, rootVariants));
  }
  if (value && typeof value === "object") {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      if (
        key === "elapsed_ms"
        || key.endsWith("_ms")
        || key === "program_rebuilt"
        || key === "program_build_count"
        || key === "semantic_snapshot_id"
      ) continue;
      normalized[key] = normalizeForHash(value[key], rootVariants);
    }
    return normalized;
  }
  if (typeof value === "string") {
    let normalized = value;
    for (const rootVariant of rootVariants) {
      if (rootVariant) normalized = normalized.split(rootVariant).join("<ROOT>");
    }
    return normalized;
  }
  return value;
}

function stableHash(value, rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  const rootVariants = [
    resolvedRoot,
    resolvedRoot.replace(/\\/g, "/"),
    resolvedRoot.replace(/\//g, "\\"),
  ];
  const normalized = normalizeForHash(value, [...new Set(rootVariants)]);
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function percentile(sortedSamples, quantile) {
  if (sortedSamples.length === 0) return null;
  const index = Math.max(0, Math.ceil(sortedSamples.length * quantile) - 1);
  return sortedSamples[index];
}

function summarizeSamples(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    count: sorted.length,
    samples_ms: samples.map((sample) => Number(sample.toFixed(3))),
    p50_ms: Number(percentile(sorted, 0.50).toFixed(3)),
    p95_ms: Number(percentile(sorted, 0.95).toFixed(3)),
    max_ms: Number(sorted.at(-1).toFixed(3)),
  };
}

function unique(values) {
  return [...new Set(values)];
}

function addAssertion(assertions, name, passed, detail) {
  assertions.push({ name, pass: Boolean(passed), detail });
}

function validatePayload(toolName, payload, fixture) {
  if (!payload || typeof payload !== "object") {
    throw new Error(`${toolName} returned an invalid payload`);
  }
  if (payload.semantic_engine !== "typescript_program" || payload.semantic_engine_status !== "verified") {
    throw new Error(
      `${toolName} did not use a verified TypeScript Program snapshot: `
      + `${payload.semantic_engine || "none"}/${payload.semantic_engine_status || "none"}`,
    );
  }
  if (toolName === "pre_context") {
    const candidates = Array.isArray(payload.definition_candidates)
      ? payload.definition_candidates
      : payload.definition ? [payload.definition] : [];
    if (!candidates.some((candidate) => candidate && candidate.name === fixture.targetSeed)) {
      throw new Error(`pre_context did not return ${fixture.targetSeed}`);
    }
  } else if (toolName === "pre_plan") {
    if (!Array.isArray(payload.edit_order)) {
      throw new Error("pre_plan returned no edit_order");
    }
  } else if (toolName === "pre_impact") {
    if (!Array.isArray(payload.seed_symbols) || !Array.isArray(payload.affected_files)) {
      throw new Error("pre_impact returned incomplete structural evidence");
    }
  }
}

async function callAndHash(client, toolName, argumentsValue, timeoutMs, fixture) {
  const result = await client.callTool(toolName, argumentsValue, timeoutMs);
  validatePayload(toolName, result.payload, fixture);
  return {
    ...result,
    hash: stableHash(result.payload, fixture.root),
  };
}

async function measureTool({
  client,
  toolName,
  argumentsValue,
  timeoutMs,
  runCount,
  fixture,
}) {
  const samples = [];
  const hashes = [];
  let lastPayload = null;
  for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
    const result = await callAndHash(client, toolName, argumentsValue, timeoutMs, fixture);
    samples.push(result.elapsedMs);
    hashes.push(result.hash);
    lastPayload = result.payload;
  }
  const uniqueHashes = unique(hashes);
  return {
    ...summarizeSamples(samples),
    hash: uniqueHashes.length === 1 ? uniqueHashes[0] : null,
    unique_hashes: uniqueHashes,
    lastPayload,
  };
}

function seedImpactSummary(payload, fixture) {
  const seedSymbols = Array.isArray(payload.seed_symbols) ? payload.seed_symbols : [];
  const references = Array.isArray(payload.affected_references) ? payload.affected_references : [];
  const minimalReads = payload.answer_pack && Array.isArray(payload.answer_pack.suggested_minimal_reads)
    ? payload.answer_pack.suggested_minimal_reads
    : [];
  const missingEvidence = payload.answer_pack && Array.isArray(payload.answer_pack.missing_evidence)
    ? payload.answer_pack.missing_evidence
    : [];
  return {
    requested_seeds: fixture.seedCount,
    returned_seeds: seedSymbols.length,
    seed_symbols_truncated: payload.seed_symbols_truncated === true,
    affected_references: references.length,
    affected_references_truncated: payload.affected_references_truncated === true,
    minimal_reads: minimalReads.length,
    minimal_reads_truncated: payload.minimal_reads_truncated === true,
    missing_evidence: missingEvidence,
    changed_file_present: Array.isArray(payload.affected_files)
      && payload.affected_files.includes(fixture.seedImpactArguments.changes[0].path),
  };
}

function runHarnessSelfChecks() {
  const first = stableHash({ second: 2, first: 1 }, process.cwd());
  const second = stableHash({ first: 1, second: 2 }, process.cwd());
  const ordered = stableHash({ values: [1, 2] }, process.cwd());
  const reversed = stableHash({ values: [2, 1] }, process.cwd());
  if (first !== second) throw new Error("stable hash does not normalize object key order");
  if (ordered === reversed) throw new Error("stable hash incorrectly normalizes array order");
  const summary = summarizeSamples([3, 1, 2]);
  if (summary.p50_ms !== 2 || summary.p95_ms !== 3) {
    throw new Error("sample percentile self-check failed");
  }
}

function binarySha256(binaryPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(binaryPath)).digest("hex");
}

function compareMetric(assertions, name, current, baseline, ratio, slack) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) {
    addAssertion(assertions, name, false, "current or baseline metric is unavailable");
    return { current, baseline, limit: null, pass: false };
  }
  const limit = Math.max(baseline * ratio, baseline + slack);
  const passed = current <= limit;
  addAssertion(
    assertions,
    name,
    passed,
    `current=${current.toFixed(3)}, baseline=${baseline.toFixed(3)}, limit=${limit.toFixed(3)}`,
  );
  return { current, baseline, limit, pass: passed };
}

function applyBaseline(report, baseline, options, assertions) {
  const comparison = {
    source: path.resolve(options.baseline),
    compatible: true,
    metrics: {},
    hash_changes: [],
  };
  for (const [field, current, previous] of [
    ["schema_version", report.schema_version, baseline.schema_version],
    ["topology_version", report.fixture.topology_version, baseline.fixture && baseline.fixture.topology_version],
    ["file_count", report.fixture.file_count, baseline.fixture && baseline.fixture.file_count],
    ["platform", report.environment.platform, baseline.environment && baseline.environment.platform],
    ["arch", report.environment.arch, baseline.environment && baseline.environment.arch],
    ["runner", report.environment.runner, baseline.environment && baseline.environment.runner],
  ]) {
    const passed = current === previous;
    if (!passed) comparison.compatible = false;
    addAssertion(assertions, `baseline_${field}_compatible`, passed, `current=${current}, baseline=${previous}`);
  }

  comparison.metrics.cold_index = compareMetric(
    assertions,
    "baseline_cold_index_median",
    report.cold_index.initialize_roundtrip.p50_ms,
    baseline.cold_index && baseline.cold_index.initialize_roundtrip
      ? baseline.cold_index.initialize_roundtrip.p50_ms
      : null,
    options.baselineLimits.coldRatio,
    0,
  );

  for (const metricName of ["context", "plan", "impact", "impact_100_seed"]) {
    comparison.metrics[metricName] = compareMetric(
      assertions,
      `baseline_${metricName}_p95`,
      report.warm[metricName].p95_ms,
      baseline.warm && baseline.warm[metricName] ? baseline.warm[metricName].p95_ms : null,
      options.baselineLimits.warmRatio,
      options.baselineLimits.warmSlackMs,
    );
    const currentHash = report.warm[metricName].hash;
    const baselineHash = baseline.warm && baseline.warm[metricName]
      ? baseline.warm[metricName].hash
      : null;
    if (currentHash !== baselineHash) comparison.hash_changes.push(metricName);
    if (!options.allowHashChange) {
      addAssertion(
        assertions,
        `baseline_${metricName}_hash`,
        currentHash === baselineHash,
        `current=${currentHash}, baseline=${baselineHash}`,
      );
    }
  }

  comparison.metrics.rss = compareMetric(
    assertions,
    "baseline_rss_max_sampled",
    report.rss.rss_max_sampled_mb,
    baseline.rss ? baseline.rss.rss_max_sampled_mb : null,
    options.baselineLimits.rssRatio,
    options.baselineLimits.rssSlackMb,
  );
  return comparison;
}

async function runBenchmark(options, binaryPath, runner, fixture) {
  const assertions = [];
  const coldInitializeRoundtrip = [];
  const coldSpawnToResponse = [];
  const coldHashes = { context: [], plan: [], impact: [] };
  const rssAfterIndex = [];

  for (let coldIndex = 0; coldIndex < options.coldRuns; coldIndex += 1) {
    const client = new JsonRpcClient({ binaryPath, runner, wslDistro: options.wslDistro });
    try {
      const initialize = await client.initialize(fixture.root, options.timeouts.initializeMs);
      coldInitializeRoundtrip.push(initialize.elapsedMs);
      coldSpawnToResponse.push(initialize.spawnToResponseMs);
      const rss = client.sampleRssMb();
      if (rss !== null) rssAfterIndex.push(rss);
      const context = await callAndHash(
        client,
        "pre_context",
        fixture.contextArguments,
        options.timeouts.contextMs,
        fixture,
      );
      const plan = await callAndHash(
        client,
        "pre_plan",
        fixture.planArguments,
        options.timeouts.planMs,
        fixture,
      );
      const impact = await callAndHash(
        client,
        "pre_impact",
        fixture.impactArguments,
        options.timeouts.impactMs,
        fixture,
      );
      coldHashes.context.push(context.hash);
      coldHashes.plan.push(plan.hash);
      coldHashes.impact.push(impact.hash);
    } finally {
      await client.close();
    }
  }

  const warmClient = new JsonRpcClient({ binaryPath, runner, wslDistro: options.wslDistro });
  const rssAfterWarm = [];
  let contextMetrics;
  let planMetrics;
  let impactMetrics;
  let seedImpactMetrics;
  try {
    await warmClient.initialize(fixture.root, options.timeouts.initializeMs);
    for (let warmupIndex = 0; warmupIndex < options.warmupRuns; warmupIndex += 1) {
      await warmClient.callTool("pre_context", fixture.contextArguments, options.timeouts.contextMs);
      await warmClient.callTool("pre_plan", fixture.planArguments, options.timeouts.planMs);
      await warmClient.callTool("pre_impact", fixture.impactArguments, options.timeouts.impactMs);
    }
    contextMetrics = await measureTool({
      client: warmClient,
      toolName: "pre_context",
      argumentsValue: fixture.contextArguments,
      timeoutMs: options.timeouts.contextMs,
      runCount: options.contextRuns,
      fixture,
    });
    const contextRss = warmClient.sampleRssMb();
    if (contextRss !== null) rssAfterWarm.push(contextRss);
    planMetrics = await measureTool({
      client: warmClient,
      toolName: "pre_plan",
      argumentsValue: fixture.planArguments,
      timeoutMs: options.timeouts.planMs,
      runCount: options.planRuns,
      fixture,
    });
    const planRss = warmClient.sampleRssMb();
    if (planRss !== null) rssAfterWarm.push(planRss);
    impactMetrics = await measureTool({
      client: warmClient,
      toolName: "pre_impact",
      argumentsValue: fixture.impactArguments,
      timeoutMs: options.timeouts.impactMs,
      runCount: options.impactRuns,
      fixture,
    });
    const impactRss = warmClient.sampleRssMb();
    if (impactRss !== null) rssAfterWarm.push(impactRss);
    seedImpactMetrics = await measureTool({
      client: warmClient,
      toolName: "pre_impact",
      argumentsValue: fixture.seedImpactArguments,
      timeoutMs: options.timeouts.seedImpactMs,
      runCount: options.seedImpactRuns,
      fixture,
    });
    const seedImpactRss = warmClient.sampleRssMb();
    if (seedImpactRss !== null) rssAfterWarm.push(seedImpactRss);
  } finally {
    await warmClient.close();
  }

  const warm = {
    context: { ...contextMetrics },
    plan: { ...planMetrics },
    impact: { ...impactMetrics },
    impact_100_seed: { ...seedImpactMetrics },
  };
  const seedImpact = seedImpactSummary(warm.impact_100_seed.lastPayload, fixture);
  for (const metric of Object.values(warm)) delete metric.lastPayload;

  addAssertion(assertions, "fixture_source_file_count", fixture.sourceFiles.length === options.fileCount,
    `actual=${fixture.sourceFiles.length}, expected=${options.fileCount}`);
  for (const metricName of Object.keys(warm)) {
    addAssertion(
      assertions,
      `warm_${metricName}_stable_hash`,
      warm[metricName].unique_hashes.length === 1,
      `unique_hashes=${warm[metricName].unique_hashes.length}`,
    );
  }
  for (const metricName of Object.keys(coldHashes)) {
    const hashes = unique(coldHashes[metricName]);
    addAssertion(
      assertions,
      `cold_${metricName}_stable_hash`,
      hashes.length === 1,
      `runs=${coldHashes[metricName].length}, unique_hashes=${hashes.length}`,
    );
    const warmHash = warm[metricName].hash;
    const lifecycleHashes = unique([...coldHashes[metricName], warmHash].filter(Boolean));
    addAssertion(
      assertions,
      `cold_warm_${metricName}_stable_hash`,
      lifecycleHashes.length === 1 && Boolean(warmHash),
      `unique_hashes=${lifecycleHashes.length}, warm_hash_available=${Boolean(warmHash)}`,
    );
  }
  addAssertion(
    assertions,
    "seed_impact_returns_all_requested_seeds",
    seedImpact.returned_seeds === fixture.seedCount && !seedImpact.seed_symbols_truncated,
    `requested=${fixture.seedCount}, returned=${seedImpact.returned_seeds}, truncated=${seedImpact.seed_symbols_truncated}`,
  );
  addAssertion(
    assertions,
    "seed_impact_reference_bound",
    seedImpact.affected_references <= 200,
    `references=${seedImpact.affected_references}`,
  );
  addAssertion(
    assertions,
    "seed_impact_minimal_read_bound",
    seedImpact.minimal_reads <= 20,
    `minimal_reads=${seedImpact.minimal_reads}`,
  );
  addAssertion(
    assertions,
    "seed_impact_changed_file_present",
    seedImpact.changed_file_present,
    `path=${fixture.seedImpactArguments.changes[0].path}`,
  );

  const allRss = [...rssAfterIndex, ...rssAfterWarm];
  if (!options.allowMissingRss) {
    addAssertion(
      assertions,
      "rss_available",
      rssAfterIndex.length === options.coldRuns && rssAfterWarm.length === 4,
      `index_samples=${rssAfterIndex.length}, warm_samples=${rssAfterWarm.length}`,
    );
  }

  const report = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    mode: options.selfCheck ? "self_check" : "gate",
    environment: {
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0] ? os.cpus()[0].model : null,
      cpu_count: os.cpus().length,
      node: process.version,
      runner,
      wsl_distro: options.wslDistro,
      binary: path.resolve(binaryPath),
      binary_sha256: binarySha256(binaryPath),
      build_profile: inferBuildProfile(binaryPath),
    },
    fixture: {
      topology_version: TOPOLOGY_VERSION,
      root: fixture.root,
      file_count: fixture.fileCount,
      total_file_count: fixture.totalFileCount,
      seed_count: fixture.seedCount,
      barrel_count: fixture.barrelCount,
      feature_count: fixture.featureCount,
      view_count: fixture.viewCount,
      target_symbol: fixture.targetSeed,
    },
    limits: {
      ...options.timeouts,
      baseline: options.baselineLimits,
    },
    cold_index: {
      mode: "fresh_process_os_page_cache_uncontrolled",
      runs: options.coldRuns,
      initialize_roundtrip: summarizeSamples(coldInitializeRoundtrip),
      spawn_to_initialize_response: summarizeSamples(coldSpawnToResponse),
    },
    warm,
    seed_impact: seedImpact,
    rss: {
      sampling: "checkpoint_rss_not_continuous_peak",
      rss_after_index_mb: rssAfterIndex.map((value) => Number(value.toFixed(3))),
      rss_after_warm_mb: rssAfterWarm.map((value) => Number(value.toFixed(3))),
      rss_max_sampled_mb: allRss.length > 0 ? Number(Math.max(...allRss).toFixed(3)) : null,
    },
    stability: {
      cold_process_hashes: Object.fromEntries(
        Object.entries(coldHashes).map(([name, hashes]) => [name, {
          hashes,
          unique_hashes: unique(hashes),
        }]),
      ),
    },
    baseline: null,
    assertions,
    pass: false,
    failures: [],
  };

  if (report.environment.build_profile === "debug" && !options.allowDebug) {
    addAssertion(assertions, "release_build_required", false, "pass --allow-debug only for local diagnostics");
  }
  if (options.baseline) {
    const baseline = JSON.parse(fs.readFileSync(path.resolve(options.baseline), "utf8"));
    report.baseline = applyBaseline(report, baseline, options, assertions);
  }
  report.failures = assertions.filter((assertion) => !assertion.pass).map((assertion) => assertion.name);
  report.pass = report.failures.length === 0;
  return report;
}

function safelyRemoveFixture(fixtureRoot) {
  if (!fixtureRoot) return;
  const resolvedRoot = path.resolve(fixtureRoot);
  const resolvedTemp = path.resolve(os.tmpdir());
  const relative = path.relative(resolvedTemp, resolvedRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`refusing to remove fixture outside temp directory: ${resolvedRoot}`);
  }
  if (!path.basename(resolvedRoot).startsWith("linghun-pre-engine-structural-1k-")) {
    throw new Error(`refusing to remove unexpected fixture directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function writeReport(report, outputPath) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const resolvedOutput = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    fs.writeFileSync(resolvedOutput, serialized, "utf8");
  }
  process.stdout.write(serialized);
}

async function withOverallTimeout(callback, timeoutMs) {
  let timer;
  return Promise.race([
    callback(),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        for (const client of activeClients) client.terminate();
        reject(new Error(`benchmark exceeded overall timeout of ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function main() {
  let options;
  let fixture = null;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    runHarnessSelfChecks();
    const scriptDirectory = __dirname;
    const binaryPath = path.resolve(options.binary || findDefaultBinary(scriptDirectory));
    if (!fs.existsSync(binaryPath)) throw new Error(`binary does not exist: ${binaryPath}`);
    const runner = resolveRunner(options.runner, binaryPath);
    if (runner === "wsl" && process.platform !== "win32") {
      throw new Error("WSL runner is only available from Windows");
    }
    fixture = createSyntheticFixture(options.fileCount);
    const report = await withOverallTimeout(
      () => runBenchmark(options, binaryPath, runner, fixture),
      options.timeouts.overallMs,
    );
    writeReport(report, options.output);
    process.exitCode = report.pass ? 0 : 1;
  } catch (error) {
    const report = {
      schema_version: SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      pass: false,
      harness_error: error && error.stack ? error.stack : String(error),
    };
    writeReport(report, options && options.output);
    process.exitCode = 2;
  } finally {
    for (const client of activeClients) {
      client.terminate();
      activeClients.delete(client);
    }
    if (fixture && !(options && options.keepFixture)) {
      try {
        safelyRemoveFixture(fixture.root);
      } catch (error) {
        process.stderr.write(`${error.message}\n`);
        if (!process.exitCode) process.exitCode = 2;
      }
    }
  }
}

main();
