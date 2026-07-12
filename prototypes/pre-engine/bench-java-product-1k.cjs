"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const { spawn } = require("child_process");

const binaryName = process.platform === "win32" ? "linghun-pre-engine.exe" : "linghun-pre-engine";
const platformKey = `${process.platform === "win32" ? "win32" : process.platform}-${process.arch}`;
const cliBinary = path.resolve(__dirname, "..", "..", "apps", "cli", "bundled", "pre-engine", platformKey, binaryName);
const releaseBinary = path.resolve(__dirname, "target", "release", binaryName);
const platformBinary = path.resolve(__dirname, "..", "..", "packages", `pre-engine-${platformKey}`, "bundled", "pre-engine", platformKey, binaryName);
const sourceHelper = path.resolve(__dirname, "java-deep-layer.cjs");
const cliHelper = path.join(path.dirname(cliBinary), "java-deep-layer.cjs");
const platformHelper = path.join(path.dirname(platformBinary), "java-deep-layer.cjs");
const reportPath = path.join(os.tmpdir(), "linghun-java-product-1k-final.json");
const rounds = 3;
const deepChainFiles = 1000;
const sampleCounts = { context: 100, plan: 50, impact: 50, verify: 50 };
const thresholds = {
  cold_start_ms: Number(process.env.JAVA_BENCH_MAX_COLD_START_MS || 60000),
  context_p95_ms: Number(process.env.JAVA_BENCH_MAX_CONTEXT_P95_MS || 2500),
  plan_p95_ms: Number(process.env.JAVA_BENCH_MAX_PLAN_P95_MS || 5000),
  impact_p95_ms: Number(process.env.JAVA_BENCH_MAX_IMPACT_P95_MS || 2500),
  verify_p95_ms: Number(process.env.JAVA_BENCH_MAX_VERIFY_P95_MS || 15000),
  deep_plan_ms: Number(process.env.JAVA_BENCH_MAX_DEEP_PLAN_MS || 120000),
  instability_ratio: Number(process.env.JAVA_BENCH_MAX_INSTABILITY_RATIO || 4),
};

const shortFiles = {
  shared: "src/main/java/shortbase/Shared.java",
  bridge: "src/main/java/shortbridge/Bridge.java",
  entry: "src/main/java/shortapp/Entry.java",
  typeError: "src/main/java/stress/TypeError.java",
};

class Client {
  constructor(root) {
    this.child = spawn(cliBinary, [], {
      cwd: __dirname,
      env: process.env,
      stdio: ["pipe", "pipe", "inherit"],
    });
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

  async tool(name, args, timeoutMs) {
    await this.ready;
    const result = await this.request("tools/call", { name, arguments: args }, timeoutMs);
    if (!result || result.isError) throw new Error(`${name}: ${JSON.stringify(result)}`);
    const text = result.content && result.content.find(item => item.type === "text");
    if (!text) throw new Error(`${name}: missing text result`);
    return JSON.parse(text.text);
  }

  close() {
    return new Promise(resolve => {
      if (this.child.exitCode != null) {
        resolve();
        return;
      }
      this.child.once("close", resolve);
      this.child.stdin.end();
    });
  }
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
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

function endsWithPath(value, expected) {
  return typeof value === "string" && value.replace(/\\/g, "/").endsWith(expected);
}

function hasPath(values, expected) {
  return Array.isArray(values) && values.some(value => endsWithPath(value.file || value, expected));
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => reject(new Error([
      `command: ${command} ${args.join(" ")}`,
      `spawn_error: ${error.message}`,
      `stdout:\n${stdout || "<empty>"}`,
      `stderr:\n${stderr || "<empty>"}`,
    ].join("\n"))));
    child.on("exit", (code, signal) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error([
        `command: ${command} ${args.join(" ")}`,
        `exit_code: ${code == null ? "null" : code}`,
        `signal: ${signal || "none"}`,
        `stdout:\n${stdout || "<empty>"}`,
        `stderr:\n${stderr || "<empty>"}`,
      ].join("\n"))));
  });
}

function assertContext(context, label) {
  assert(context.java_semantic_engine_status === "verified",
    `${label} context degraded: ${context.java_semantic_engine_status}/${context.java_semantic_engine_reason || "none"}`);
  assert(endsWithPath(context.definition && context.definition.file, shortFiles.bridge),
    `${label} context resolved the wrong definition: ${JSON.stringify(context.definition)}`);
  assert(hasPath(context.references, shortFiles.entry), `${label} context missed Entry reference`);
  assert(hasPath(context.callers, shortFiles.entry), `${label} context missed Entry caller`);
}

function assertPlan(plan, label) {
  assert(plan.java_semantic_engine_status === "verified",
    `${label} plan degraded: ${plan.java_semantic_engine_status}/${plan.java_semantic_engine_reason || "none"}`);
  assert(plan.module_graph_truncated === false, `${label} short plan unexpectedly truncated`);
  assert(!plan.answer_pack.missing_evidence.includes("module_resolution"),
    `${label} short plan retained false module-resolution evidence`);
  const steps = new Map(plan.edit_order.map(step => [step.file, step]));
  assert(plan.total_files === 3 && steps.size === 3,
    `${label} short plan included unrelated files: ${JSON.stringify([...steps.keys()])}`);
  assert(steps.has(shortFiles.shared) && steps.has(shortFiles.bridge) && steps.has(shortFiles.entry),
    `${label} plan did not converge across the short chain: ${JSON.stringify([...steps.keys()])}`);
  assert(steps.get(shortFiles.entry).depends_on.includes(shortFiles.bridge), `${label} Entry dependency missing`);
  assert(steps.get(shortFiles.bridge).depends_on.includes(shortFiles.shared), `${label} Bridge dependency missing`);
}

function assertImpact(impact, label) {
  assert(impact.java_semantic_engine_status === "verified",
    `${label} impact degraded: ${impact.java_semantic_engine_status}/${impact.java_semantic_engine_reason || "none"}`);
  assert(impact.affected_files.includes(shortFiles.shared), `${label} impact omitted changed Shared file`);
  assert(impact.affected_files.includes(shortFiles.bridge), `${label} impact omitted Bridge reference`);
  assert(impact.affected_references.some(reference => endsWithPath(reference.file, shortFiles.bridge)),
    `${label} impact omitted exact Bridge reference evidence`);
}

function assertVerify(verify, label) {
  assert(verify.java_deep_layer.status === "verified" && verify.verification.status === "verified",
    `${label} verify degraded: ${verify.java_deep_layer.status}/${verify.verification.status}`);
  assert(verify.issues.some(issue => issue.source === "java-deep-layer"
      && endsWithPath(issue.file, shortFiles.typeError)
      && /cannot convert from int to String/iu.test(issue.detail || "")),
    `${label} verify missed the exact Java diagnostic`);
  assert((verify.java_deep_layer.verification?.diagnostic_count || 0) > 0,
    `${label} verify diagnostic_count was not reported`);
}

async function runRound(root, round) {
  const client = new Client(root);
  const samples = { context: [], plan: [], impact: [], verify: [] };
  const coldStarted = performance.now();
  try {
    const coldContext = await client.tool("pre_context", { symbol: "execute", path: shortFiles.entry });
    const coldStartMs = performance.now() - coldStarted;
    assertContext(coldContext, `round ${round} cold`);
    assertThreshold(`round ${round} cold start`, coldStartMs, thresholds.cold_start_ms);

    const exactPlan = await client.tool("pre_plan", {
      task: "change the short Java entry chain",
      target_files: [shortFiles.entry],
      target_symbols: ["Entry"],
    });
    assertPlan(exactPlan, `round ${round} exact`);

    const exactImpact = await client.tool("pre_impact", {
      changes: [{ path: shortFiles.shared, symbols: ["Shared"] }],
    });
    assertImpact(exactImpact, `round ${round} exact`);

    const exactVerify = await client.tool("pre_verify", { changed_files: [shortFiles.typeError] });
    assertVerify(exactVerify, `round ${round} exact`);

    const deepPlanStarted = performance.now();
    const deepPlan = await client.tool("pre_plan", {
      task: "change the deepest Java dependency",
      target_files: ["src/main/java/deep/Node0999.java"],
      target_symbols: ["Node0999"],
    }, thresholds.deep_plan_ms + 30000);
    const deepPlanMs = performance.now() - deepPlanStarted;
    assert(deepPlan.java_semantic_engine_status === "verified",
      `round ${round} deep plan degraded: ${deepPlan.java_semantic_engine_status}`);
    assert(deepPlan.module_graph_truncated === true,
      `round ${round} 1000-file dependency chain was not marked truncated`);
    assert(deepPlan.answer_pack.missing_evidence.includes("module_graph_truncated"),
      `round ${round} deep plan omitted truncation evidence`);
    assert(deepPlan.total_files < deepChainFiles,
      `round ${round} deep plan unexpectedly claimed complete 1000-file closure`);
    assertThreshold(`round ${round} deep plan`, deepPlanMs, thresholds.deep_plan_ms);

    for (let iteration = 0; iteration < sampleCounts.context; iteration += 1) {
      const context = await timed(samples.context, () => client.tool("pre_context", {
        symbol: "execute", path: shortFiles.entry,
      }));
      assertContext(context, `round ${round} context ${iteration}`);
    }
    for (let iteration = 0; iteration < sampleCounts.plan; iteration += 1) {
      const plan = await timed(samples.plan, () => client.tool("pre_plan", {
        task: "change the short Java entry chain",
        target_files: [shortFiles.entry],
        target_symbols: ["Entry"],
      }));
      assertPlan(plan, `round ${round} plan ${iteration}`);
    }
    for (let iteration = 0; iteration < sampleCounts.impact; iteration += 1) {
      const impact = await timed(samples.impact, () => client.tool("pre_impact", {
        changes: [{ path: shortFiles.shared, symbols: ["Shared"] }],
      }));
      assertImpact(impact, `round ${round} impact ${iteration}`);
    }
    for (let iteration = 0; iteration < sampleCounts.verify; iteration += 1) {
      const verify = await timed(samples.verify, () => client.tool("pre_verify", {
        changed_files: [shortFiles.typeError],
      }));
      assertVerify(verify, `round ${round} verify ${iteration}`);
    }

    const p95 = Object.fromEntries(
      Object.entries(samples).map(([operation, values]) => [operation, percentile(values, 0.95)]),
    );
    assertThreshold(`round ${round} context P95`, p95.context, thresholds.context_p95_ms);
    assertThreshold(`round ${round} plan P95`, p95.plan, thresholds.plan_p95_ms);
    assertThreshold(`round ${round} impact P95`, p95.impact, thresholds.impact_p95_ms);
    assertThreshold(`round ${round} verify P95`, p95.verify, thresholds.verify_p95_ms);

    return {
      round,
      cold_start_ms: coldStartMs,
      p95_ms: p95,
      sample_counts: Object.fromEntries(
        Object.entries(samples).map(([operation, values]) => [operation, values.length]),
      ),
      short_chain: {
        context_definition: shortFiles.bridge,
        context_reference: shortFiles.entry,
        context_caller: shortFiles.entry,
        plan_files: exactPlan.edit_order.map(step => step.file),
        impact_files: exactImpact.affected_files,
        verify_diagnostic: shortFiles.typeError,
      },
      deep_chain: {
        files: deepChainFiles,
        plan_ms: deepPlanMs,
        total_files_returned: deepPlan.total_files,
        module_graph_truncated: deepPlan.module_graph_truncated,
        missing_evidence: deepPlan.answer_pack.missing_evidence,
      },
      java_program_build_count: exactVerify.java_deep_layer.program_build_count,
      java_snapshot_id: exactVerify.java_deep_layer.semantic_snapshot_id,
    };
  } finally {
    await client.close();
  }
}

async function runParallelLoadGate(root) {
  const clients = [];
  try {
    for (let index = 0; index < 4; index += 1) {
      const client = new Client(root);
      clients.push(client);
      await client.ready;
    }
    const cargoTest = runCommand("cargo", [
      "test", "--manifest-path", path.join(__dirname, "Cargo.toml"), "--", "--test-threads=1",
    ], {
      cwd: path.resolve(__dirname, "..", ".."),
      env: process.env,
      windowsHide: true,
    });
    const [context, plan, impact, verify] = await Promise.all([
      clients[0].tool("pre_context", { symbol: "execute", path: shortFiles.entry }),
      clients[1].tool("pre_plan", {
        task: "parallel short-chain plan", target_files: [shortFiles.entry], target_symbols: ["Entry"],
      }),
      clients[2].tool("pre_impact", { changes: [{ path: shortFiles.shared, symbols: ["Shared"] }] }),
      clients[3].tool("pre_verify", { changed_files: [shortFiles.typeError] }),
    ]);
    assertContext(context, "parallel");
    assertPlan(plan, "parallel");
    assertImpact(impact, "parallel");
    assertVerify(verify, "parallel");
    await cargoTest;
    return {
      clients: clients.length,
      cargo_test: "passed",
      context: "verified",
      plan: "verified",
      impact: "verified",
      verify: "verified",
      diagnostic: "reported",
    };
  } finally {
    await Promise.all(clients.map(client => client.close()));
  }
}

function createFixture(root) {
  write(path.join(root, "pom.xml"),
    "<project xmlns=\"http://maven.apache.org/POM/4.0.0\"><modelVersion>4.0.0</modelVersion><groupId>stress</groupId><artifactId>java-1k</artifactId><version>1</version><properties><maven.compiler.release>17</maven.compiler.release></properties></project>\n");
  write(path.join(root, shortFiles.shared),
    "package shortbase; public class Shared { public String message() { return \"ok\"; } }\n");
  write(path.join(root, shortFiles.bridge),
    "package shortbridge; import shortbase.Shared; public class Bridge { public String execute() { return new Shared().message(); } }\n");
  write(path.join(root, shortFiles.entry),
    "package shortapp; import shortbridge.Bridge; public class Entry { public String run() { return new Bridge().execute(); } }\n");
  write(path.join(root, shortFiles.typeError),
    "package stress; public class TypeError { public String broken() { return 1; } }\n");

  for (let index = 0; index < deepChainFiles; index += 1) {
    const suffix = String(index).padStart(4, "0");
    const previousSuffix = String(index - 1).padStart(4, "0");
    const body = index === 0
      ? "public int value() { return 0; }"
      : `public int value() { return new Node${previousSuffix}().value() + 1; }`;
    const importLine = index === 0 ? "" : `import deep.Node${previousSuffix}; `;
    write(path.join(root, `src/main/java/deep/Node${suffix}.java`),
      `package deep; ${importLine}public class Node${suffix} { ${body} }\n`);
  }
}

async function run() {
  fs.rmSync(reportPath, { force: true });
  for (const file of [cliBinary, releaseBinary, platformBinary, sourceHelper, cliHelper, platformHelper]) {
    assert(fs.existsSync(file), `release provenance file missing: ${file}`);
  }
  const binaryHashes = [cliBinary, releaseBinary, platformBinary].map(hashFile);
  const helperHashes = [sourceHelper, cliHelper, platformHelper].map(hashFile);
  assert(new Set(binaryHashes).size === 1,
    `release/CLI/platform binary hash mismatch: ${binaryHashes.join(",")}`);
  assert(new Set(helperHashes).size === 1,
    `source/CLI/platform helper hash mismatch: ${helperHashes.join(",")}`);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-java-1k-"));
  try {
    createFixture(root);
    const roundResults = [];
    for (let round = 1; round <= rounds; round += 1) {
      const result = await runRound(root, round);
      roundResults.push(result);
      console.log(JSON.stringify({ event: "java_bench_round_pass", round, p95_ms: result.p95_ms }));
    }

    const stability = {};
    for (const operation of Object.keys(sampleCounts)) {
      const values = roundResults.map(result => result.p95_ms[operation]);
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      const ratio = minimum === 0 ? 1 : maximum / minimum;
      assert(maximum <= minimum * thresholds.instability_ratio + 50,
        `${operation} P95 unstable across rounds: min=${minimum.toFixed(1)}ms max=${maximum.toFixed(1)}ms`);
      stability[operation] = { minimum_p95_ms: minimum, maximum_p95_ms: maximum, ratio };
    }

    const parallelLoadGate = await runParallelLoadGate(root);
    const report = {
      deep_chain_files: deepChainFiles,
      java_source_files: deepChainFiles + 4,
      rounds,
      build_profile: "release",
      binary: cliBinary,
      binary_sha256: binaryHashes[0],
      release_binary: releaseBinary,
      release_binary_sha256: binaryHashes[1],
      platform_binary: platformBinary,
      platform_binary_sha256: binaryHashes[2],
      java_helper: cliHelper,
      java_helper_sha256: helperHashes[1],
      source_java_helper_sha256: helperHashes[0],
      platform_java_helper_sha256: helperHashes[2],
      thresholds,
      required_sample_counts: sampleCounts,
      round_results: roundResults,
      stability,
      parallel_load_gate: parallelLoadGate,
      generated_at: new Date().toISOString(),
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, report: reportPath }, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  fs.rmSync(reportPath, { force: true });
  console.log(error.stack || error.message);
  process.exitCode = 1;
});
