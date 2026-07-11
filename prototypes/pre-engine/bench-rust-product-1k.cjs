"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const { spawn, spawnSync } = require("child_process");

const binaryName = process.platform === "win32" ? "linghun-pre-engine.exe" : "linghun-pre-engine";
const platformKey = `${process.platform === "win32" ? "win32" : process.platform}-${process.arch}`;
const defaultBinary = path.resolve(__dirname, "..", "..", "apps", "cli", "bundled", "pre-engine", platformKey, binaryName);
const binary = defaultBinary;
const releaseBinary = path.resolve(__dirname, "target", "release", binaryName);
const platformBinary = path.resolve(__dirname, "..", "..", "packages", `pre-engine-${platformKey}`, "bundled", "pre-engine", platformKey, binaryName);
const helperName = "rust-deep-layer.cjs";
const sourceHelper = path.resolve(__dirname, helperName);
const bundledHelper = path.join(path.dirname(binary), helperName);
const platformHelper = path.join(path.dirname(platformBinary), helperName);
const rounds = 3;
const sampleCounts = { context: 100, plan: 50, impact: 50, verify: 50, seed_impact_per_round: 1, seed_impact_total: 3 };
const thresholds = {
  cold_start_ms: Number(process.env.RUST_BENCH_MAX_COLD_START_MS || 30000),
  context_p95_ms: Number(process.env.RUST_BENCH_MAX_CONTEXT_P95_MS || 1500),
  plan_p95_ms: Number(process.env.RUST_BENCH_MAX_PLAN_P95_MS || 2500),
  impact_p95_ms: Number(process.env.RUST_BENCH_MAX_IMPACT_P95_MS || 1500),
  verify_p95_ms: Number(process.env.RUST_BENCH_MAX_VERIFY_P95_MS || 15000),
  seed_impact_ms: Number(process.env.RUST_BENCH_MAX_SEED_IMPACT_MS || 15000),
  instability_ratio: Number(process.env.RUST_BENCH_MAX_INSTABILITY_RATIO || 3),
};

class Client {
  constructor(root) {
    this.child = spawn(binary, [], { cwd: __dirname, stdio: ["pipe", "pipe", "inherit"] });
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.child.stdout.on("data", chunk => {
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
    });
    this.child.on("exit", (code, signal) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`pre-engine exited: code=${code} signal=${signal || "none"}`));
      }
      this.pending.clear();
    });
    this.ready = this.request("initialize", { rootUri: root });
  }

  request(method, params, timeoutMs = 180000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async tool(name, args) {
    await this.ready;
    const result = await this.request("tools/call", { name, arguments: args });
    if (!result || result.isError) throw new Error(`${name}: ${JSON.stringify(result)}`);
    return JSON.parse(result.content.find(item => item.type === "text").text);
  }

  close() {
    this.child.stdin.end();
    return new Promise(resolve => this.child.on("close", resolve));
  }
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function timed(samples, operation) {
  const started = performance.now();
  const result = await operation();
  samples.push(performance.now() - started);
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThreshold(name, actual, maximum) {
  assert(actual <= maximum, `${name} threshold exceeded: ${actual.toFixed(1)}ms > ${maximum}ms`);
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
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

async function runParallelLoadGate(root) {
  const cargoTest = runCommand("cargo", ["test"], { cwd: __dirname, windowsHide: true });
  const client = new Client(root);
  try {
    const context = await client.tool("pre_context", { symbol: "symbol_0999", path: "src/m0999.rs" });
    const verify = await client.tool("pre_verify", { changed_files: ["src/type_error.rs"] });
    assert(context.rust_semantic_engine_status === "verified", "parallel-load context degraded");
    assert(verify.rust_deep_layer.status === "verified", "parallel-load verify degraded");
    assert(verify.issues.some(issue => issue.source === "rust-deep-layer"), "parallel-load verify missed type error");
    await cargoTest;
    return { cargo_test: "passed", context: "verified", verify: "verified", diagnostic: "reported" };
  } finally {
    await client.close();
  }
}

async function runRound(root, round) {
  const client = new Client(root);
  const samples = { context: [], plan: [], impact: [], verify: [] };
  const started = performance.now();
  try {
    const coldContext = await client.tool("pre_context", { symbol: "symbol_0999", path: "src/m0999.rs" });
    const coldStartMs = performance.now() - started;
    assert(coldContext.rust_semantic_engine_status === "verified", `round ${round} cold context degraded`);
    assertThreshold(`round ${round} cold start`, coldStartMs, thresholds.cold_start_ms);

    for (let iteration = 0; iteration < sampleCounts.context; iteration += 1) {
      const context = await timed(samples.context, () => client.tool("pre_context", {
        symbol: "symbol_0999", path: "src/m0999.rs",
      }));
      assert(context.rust_semantic_engine_status === "verified", `round ${round} context ${iteration} degraded`);
    }
    for (let iteration = 0; iteration < sampleCounts.plan; iteration += 1) {
      const plan = await timed(samples.plan, () => client.tool("pre_plan", {
        task: "change symbol 0999", target_files: ["src/m0999.rs"], target_symbols: ["symbol_0999"],
      }));
      assert(plan.rust_semantic_engine_status === "verified", `round ${round} plan ${iteration} degraded`);
    }
    for (let iteration = 0; iteration < sampleCounts.impact; iteration += 1) {
      const impact = await timed(samples.impact, () => client.tool("pre_impact", {
        changes: [{ path: "src/m0999.rs", symbols: ["symbol_0999"] }],
      }));
      assert(impact.rust_semantic_engine_status === "verified", `round ${round} impact ${iteration} degraded`);
    }
    for (let iteration = 0; iteration < sampleCounts.verify; iteration += 1) {
      const verify = await timed(samples.verify, () => client.tool("pre_verify", {
        changed_files: ["src/type_error.rs"],
      }));
      assert(verify.rust_deep_layer.status === "verified" && verify.verification.status === "verified",
        `round ${round} verify ${iteration} degraded: ${verify.rust_deep_layer.status}/${verify.verification.status}`);
      assert(verify.issues.some(issue => issue.source === "rust-deep-layer"),
        `round ${round} verify ${iteration} missed the Rust type error`);
    }

    const seedChanges = Array.from({ length: 100 }, (_, index) => {
      const suffix = String(index).padStart(4, "0");
      return { path: `src/m${suffix}.rs`, symbols: [`symbol_${suffix}`] };
    });
    const seedSamples = [];
    const seedImpact = await timed(seedSamples, () => client.tool("pre_impact", { changes: seedChanges }));
    assert(seedImpact.rust_semantic_engine_status === "verified", `round ${round} 100-seed impact degraded`);
    assertThreshold(`round ${round} 100-seed impact`, seedSamples[0], thresholds.seed_impact_ms);

    const p95 = Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, percentile(values, 0.95)]));
    assertThreshold(`round ${round} context P95`, p95.context, thresholds.context_p95_ms);
    assertThreshold(`round ${round} plan P95`, p95.plan, thresholds.plan_p95_ms);
    assertThreshold(`round ${round} impact P95`, p95.impact, thresholds.impact_p95_ms);
    assertThreshold(`round ${round} verify P95`, p95.verify, thresholds.verify_p95_ms);
    return {
      round,
      cold_start_ms: coldStartMs,
      p95_ms: p95,
      seed_impact_ms: seedSamples[0],
      sample_counts: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, values.length])),
      program_build_count: seedImpact.rust_program_build_count,
      snapshot_id: seedImpact.rust_semantic_snapshot_id,
    };
  } finally {
    await client.close();
  }
}

async function run() {
  assert(fs.existsSync(binary), `release bundled binary missing: ${binary}`);
  for (const file of [releaseBinary, platformBinary, sourceHelper, bundledHelper, platformHelper]) {
    assert(fs.existsSync(file), `release provenance file missing: ${file}`);
  }
  const binaryHashes = [binary, releaseBinary, platformBinary].map(hashFile);
  assert(new Set(binaryHashes).size === 1, `release/CLI/platform binary hash mismatch: ${binaryHashes.join(",")}`);
  const helperHashes = [sourceHelper, bundledHelper, platformHelper].map(hashFile);
  assert(new Set(helperHashes).size === 1, `source/CLI/platform helper hash mismatch: ${helperHashes.join(",")}`);
  const rustAnalyzer = spawnSync("rust-analyzer", ["--version"], { encoding: "utf8", windowsHide: true });
  assert(rustAnalyzer.status === 0, "rust-analyzer --version failed");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-rust-1k-"));
  const modules = [];
  for (let index = 0; index < 1000; index += 1) {
    const suffix = String(index).padStart(4, "0");
    modules.push(`pub mod m${suffix};`);
    write(path.join(root, "src", `m${suffix}.rs`), `pub fn symbol_${suffix}() -> usize { ${index} }\n`);
  }
  modules.push("pub mod type_error;");
  write(path.join(root, "Cargo.toml"), "[package]\nname=\"rust-stress\"\nversion=\"0.1.0\"\nedition=\"2021\"\n");
  write(path.join(root, "src", "lib.rs"), `${modules.join("\n")}\n`);
  write(path.join(root, "src", "type_error.rs"), "pub fn broken() { let _value: i32 = \"diagnostic gate\"; }\n");

  try {
    const roundResults = [];
    for (let round = 1; round <= rounds; round += 1) roundResults.push(await runRound(root, round));
    const parallelLoadGate = await runParallelLoadGate(root);

    for (const operation of ["context", "plan", "impact", "verify"]) {
      const values = roundResults.map(result => result.p95_ms[operation]);
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      assert(maximum <= minimum * thresholds.instability_ratio + 50,
        `${operation} P95 unstable across rounds: min=${minimum.toFixed(1)}ms max=${maximum.toFixed(1)}ms`);
    }

    const report = {
      files: 1000,
      seeds: 100,
      rounds,
      binary,
      binary_sha256: hashFile(binary),
      release_binary: releaseBinary,
      platform_binary: platformBinary,
      release_binary_sha256: binaryHashes[1],
      platform_binary_sha256: binaryHashes[2],
      rust_helper: bundledHelper,
      rust_helper_sha256: helperHashes[1],
      source_rust_helper_sha256: helperHashes[0],
      platform_rust_helper_sha256: helperHashes[2],
      build_profile: "release",
      rust_analyzer_version: rustAnalyzer.stdout.trim(),
      thresholds,
      required_sample_counts: sampleCounts,
      round_results: roundResults,
      parallel_load_gate: parallelLoadGate,
      generated_at: new Date().toISOString(),
    };
    const reportPath = path.join(os.tmpdir(), "linghun-rust-product-1k-final.json");
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, report: reportPath }, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
