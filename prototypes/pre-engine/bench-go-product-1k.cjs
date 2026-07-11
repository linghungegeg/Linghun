"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const { spawn, spawnSync } = require("child_process");

const binaryName = process.platform === "win32" ? "linghun-pre-engine.exe" : "linghun-pre-engine";
const platformKey = `${process.platform === "win32" ? "win32" : process.platform}-${process.arch}`;
const bundledBinary = path.resolve(__dirname, "..", "..", "apps", "cli", "bundled", "pre-engine", platformKey, binaryName);
const releaseBinary = path.resolve(__dirname, "target", "release", binaryName);
const platformBinary = path.resolve(__dirname, "..", "..", "packages", `pre-engine-${platformKey}`, "bundled", "pre-engine", platformKey, binaryName);
const sourceHelper = path.resolve(__dirname, "go-deep-layer.cjs");
const bundledHelper = path.join(path.dirname(bundledBinary), "go-deep-layer.cjs");
const platformHelper = path.join(path.dirname(platformBinary), "go-deep-layer.cjs");
const rounds = 3;
const samplesPerRound = { context: 30, plan: 15, impact: 15, verify: 15 };
const thresholds = {
  cold_start_ms: Number(process.env.GO_BENCH_MAX_COLD_START_MS || 30000),
  context_p95_ms: Number(process.env.GO_BENCH_MAX_CONTEXT_P95_MS || 2000),
  plan_p95_ms: Number(process.env.GO_BENCH_MAX_PLAN_P95_MS || 4000),
  impact_p95_ms: Number(process.env.GO_BENCH_MAX_IMPACT_P95_MS || 4000),
  verify_p95_ms: Number(process.env.GO_BENCH_MAX_VERIFY_P95_MS || 15000),
  instability_ratio: Number(process.env.GO_BENCH_MAX_INSTABILITY_RATIO || 3),
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function removeTree(directory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 19) {
        console.warn(`cleanup retained ${directory}: ${error.message}`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", code => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stderr || stdout}`)));
  });
}

function payload(result) {
  assert(result && result.isError !== true, `tool error: ${JSON.stringify(result)}`);
  const text = result.content && result.content.find(item => item.type === "text");
  assert(text, `missing tool payload: ${JSON.stringify(result)}`);
  return JSON.parse(text.text);
}

class Client {
  constructor(root) {
    this.child = spawn(bundledBinary, [], { cwd: __dirname, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.buffer = "";
    this.stderr = "";
    this.nextId = 1;
    this.pending = new Map();
    this.child.stdout.on("data", chunk => this.onData(chunk));
    this.child.stderr.on("data", chunk => { this.stderr += chunk.toString(); });
    this.child.on("exit", (code, signal) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`pre-engine exited code=${code} signal=${signal}: ${this.stderr}`));
      }
      this.pending.clear();
    });
    this.ready = this.request("initialize", { rootUri: root }, 60000);
  }

  onData(chunk) {
    this.buffer += chunk.toString();
    for (let newline; (newline = this.buffer.indexOf("\n")) >= 0;) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    }
  }

  request(method, params, timeoutMs = 180000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async tool(name, argumentsValue) {
    await this.ready;
    return payload(await this.request("tools/call", { name, arguments: argumentsValue }));
  }

  close() {
    this.child.stdin.end();
    return new Promise(resolve => this.child.once("close", resolve));
  }
}

async function timed(samples, operation) {
  const started = performance.now();
  const result = await operation();
  samples.push(performance.now() - started);
  return result;
}

function assertThreshold(name, actual, limit) {
  assert(actual <= limit, `${name} threshold exceeded: ${actual.toFixed(1)}ms > ${limit}ms`);
}

function assertSemantic(payloadValue, operation) {
  assert(payloadValue.go_semantic_engine_status === "verified", `${operation} degraded: ${JSON.stringify(payloadValue)}`);
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-go-1k-"));
  write(path.join(root, "go.mod"), "module example.com/stress\n\ngo 1.26\n");
  write(path.join(root, "go.work"), "go 1.26\n\nuse .\n");
  write(path.join(root, "go.sum"), "");
  write(path.join(root, "load", "go.mod"), "module example.com/load\n\ngo 1.26\n");
  write(path.join(root, "load", "load.go"), "package load\n\nfunc Value() int { return 1 }\n");
  write(path.join(root, "load", "load_test.go"), "package load\n\nimport \"testing\"\n\nfunc TestValue(t *testing.T) { if Value() != 1 { t.Fatal(\"bad value\") } }\n");
  for (let index = 0; index < 1000; index += 1) {
    const suffix = String(index).padStart(4, "0");
    const previous = String(Math.max(0, index - 1)).padStart(4, "0");
    const body = index === 0 ? "return 0" : `return Symbol${previous}() + 1`;
    write(path.join(root, `m${suffix}.go`), `package stress\n\nfunc Symbol${suffix}() int { ${body} }\n`);
  }
  write(path.join(root, "type_error.go"), "package stress\n\nfunc Broken() int { return \"broken\" }\n");
  return root;
}

async function runRound(root, round) {
  const client = new Client(root);
  const samples = { context: [], plan: [], impact: [], verify: [] };
  const coldStarted = performance.now();
  try {
    const cold = await client.tool("pre_context", { symbol: "Symbol0999", path: "m0999.go" });
    const coldStartMs = performance.now() - coldStarted;
    assertSemantic(cold, `round ${round} cold context`);
    assertThreshold(`round ${round} cold start`, coldStartMs, thresholds.cold_start_ms);

    for (let index = 0; index < samplesPerRound.context; index += 1) {
      assertSemantic(await timed(samples.context, () => client.tool("pre_context", {
        symbol: "Symbol0999", path: "m0999.go",
      })), `round ${round} context ${index}`);
    }
    for (let index = 0; index < samplesPerRound.plan; index += 1) {
      assertSemantic(await timed(samples.plan, () => client.tool("pre_plan", {
        task: "change Symbol0999", target_files: ["m0999.go"], target_symbols: ["Symbol0999"],
      })), `round ${round} plan ${index}`);
    }
    for (let index = 0; index < samplesPerRound.impact; index += 1) {
      assertSemantic(await timed(samples.impact, () => client.tool("pre_impact", {
        changes: [{ path: "m0999.go", symbols: ["Symbol0999"] }],
      })), `round ${round} impact ${index}`);
    }
    for (let index = 0; index < samplesPerRound.verify; index += 1) {
      const verify = await timed(samples.verify, () => client.tool("pre_verify", { changed_files: ["type_error.go"] }));
      assert(verify.go_deep_layer?.status === "verified", `round ${round} verify ${index} degraded`);
      assert((verify.issues || []).some(issue => String(issue.file).replace(/\\/g, "/").endsWith("type_error.go")), `round ${round} verify missed diagnostic`);
    }

    const p95 = Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, percentile(values, 0.95)]));
    for (const operation of Object.keys(samples)) {
      assertThreshold(`round ${round} ${operation} P95`, p95[operation], thresholds[`${operation}_p95_ms`]);
    }
    return {
      round,
      cold_start_ms: coldStartMs,
      p95_ms: p95,
      samples: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, values.length])),
      snapshot_id: cold.go_semantic_snapshot_id,
      program_build_count: cold.go_program_build_count,
    };
  } finally {
    await client.close();
  }
}

async function runParallelLoadGate(root) {
  let goTestError = null;
  const goTest = runCommand("go", ["test", "./..."], {
    cwd: path.join(root, "load"),
    env: { ...process.env, GOWORK: "off" },
  }).catch(error => {
    goTestError = error;
  });
  const clients = Array.from({ length: 4 }, () => new Client(root));
  try {
    const results = await Promise.all(clients.map(async (client, index) => {
      const suffix = String(999 - index).padStart(4, "0");
      const [context, plan, impact, verify] = await Promise.all([
        client.tool("pre_context", { symbol: `Symbol${suffix}`, path: `m${suffix}.go` }),
        client.tool("pre_plan", { task: `change Symbol${suffix}`, target_files: [`m${suffix}.go`], target_symbols: [`Symbol${suffix}`] }),
        client.tool("pre_impact", { changes: [{ path: `m${suffix}.go`, symbols: [`Symbol${suffix}`] }] }),
        client.tool("pre_verify", { changed_files: ["type_error.go"] }),
      ]);
      assertSemantic(context, `parallel client ${index} context`);
      assertSemantic(plan, `parallel client ${index} plan`);
      assertSemantic(impact, `parallel client ${index} impact`);
      assert(verify.go_deep_layer?.status === "verified", `parallel client ${index} verify degraded`);
      return "verified";
    }));
    await goTest;
    if (goTestError) throw goTestError;
    return { clients: clients.length, results, go_test: "passed" };
  } finally {
    await Promise.all(clients.map(client => client.close()));
  }
}

async function run() {
  for (const file of [bundledBinary, releaseBinary, platformBinary, sourceHelper, bundledHelper, platformHelper]) {
    assert(fs.existsSync(file), `release provenance file missing: ${file}`);
  }
  const goplsVersion = spawnSync("gopls", ["version"], { encoding: "utf8", windowsHide: true });
  assert(goplsVersion.status === 0, "gopls version failed; product benchmark requires gopls");
  const goVersion = spawnSync("go", ["version"], { encoding: "utf8", windowsHide: true });
  assert(goVersion.status === 0, "go version failed; product benchmark requires Go SDK");

  const binaryHashes = [bundledBinary, releaseBinary, platformBinary].map(hashFile);
  assert(new Set(binaryHashes).size === 1, `release/CLI/platform binary hash mismatch: ${binaryHashes.join(",")}`);
  const helperHashes = [sourceHelper, bundledHelper, platformHelper].map(hashFile);
  assert(new Set(helperHashes).size === 1, `source/CLI/platform helper hash mismatch: ${helperHashes.join(",")}`);

  await runCommand(process.execPath, [path.join(__dirname, "smoke-go.cjs")], {
    cwd: __dirname,
    env: { ...process.env, GO_PRE_ENGINE_BINARY: bundledBinary, GO_SMOKE_ROUNDS: "3" },
  });

  const root = createFixture();
  try {
    const roundResults = [];
    for (let round = 1; round <= rounds; round += 1) roundResults.push(await runRound(root, round));
    const parallelLoadGate = await runParallelLoadGate(root);
    for (const operation of Object.keys(samplesPerRound)) {
      const values = roundResults.map(result => result.p95_ms[operation]);
      assert(Math.max(...values) <= Math.min(...values) * thresholds.instability_ratio + 50,
        `${operation} P95 unstable: ${values.join(",")}`);
    }
    const report = {
      files: 1000,
      rounds,
      samples_per_round: samplesPerRound,
      thresholds,
      gopls_version: goplsVersion.stdout.trim(),
      go_version: goVersion.stdout.trim(),
      bundled_binary: bundledBinary,
      binary_sha256: binaryHashes[0],
      release_binary_sha256: binaryHashes[1],
      platform_binary_sha256: binaryHashes[2],
      source_helper_sha256: helperHashes[0],
      bundled_helper_sha256: helperHashes[1],
      platform_helper_sha256: helperHashes[2],
      continuous_bundled_smoke: "3 rounds passed",
      round_results: roundResults,
      parallel_load_gate: parallelLoadGate,
      generated_at: new Date().toISOString(),
    };
    const reportPath = path.join(os.tmpdir(), "linghun-go-product-1k-final.json");
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, report: reportPath }, null, 2));
  } finally {
    await removeTree(root);
  }
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
