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
const rounds = 3;

class Client {
  constructor(root) {
    this.child = spawn(cliBinary, [], { cwd: __dirname, env: process.env, stdio: ["pipe", "pipe", "inherit"] });
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
    this.ready = this.request("initialize", { rootUri: root });
  }

  request(method, params, timeout = 180000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeout);
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
    return new Promise(resolve => {
      if (this.child.exitCode != null) { resolve(); return; }
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

function hash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function command(commandName, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { cwd, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk.toString(); });
    child.stderr.on("data", chunk => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve(output) : reject(new Error(`${commandName} failed (${code})\n${output}`)));
  });
}

async function runRound(root, round) {
  const client = new Client(root);
  const started = performance.now();
  try {
    const context = await client.tool("pre_context", { symbol: "Symbol0999", path: "src/main/java/stress/Symbol0999.java" });
    assert(context.java_semantic_engine_status === "verified", `round ${round} context degraded`);
    const plan = await client.tool("pre_plan", {
      task: "change Symbol0999", target_files: ["src/main/java/stress/Symbol0999.java"], target_symbols: ["Symbol0999"],
    });
    assert(plan.java_semantic_engine_status === "verified", `round ${round} plan degraded`);
    const impact = await client.tool("pre_impact", {
      changes: [{ path: "src/main/java/stress/Symbol0999.java", symbols: ["Symbol0999"] }],
    });
    assert(impact.java_semantic_engine_status === "verified", `round ${round} impact degraded`);
    const verify = await client.tool("pre_verify", { changed_files: ["src/main/java/stress/TypeError.java"] });
    assert(verify.java_deep_layer.status === "verified" && verify.verification.status === "verified",
      `round ${round} verify degraded`);
    assert(verify.issues.some(issue => issue.source === "java-deep-layer"), `round ${round} missed diagnostic`);
    return {
      round,
      elapsed_ms: performance.now() - started,
      indexed_files: 1001,
      java_program_build_count: impact.java_program_build_count,
      java_snapshot_id: impact.java_semantic_snapshot_id,
    };
  } finally {
    await client.close();
  }
}

async function parallelGate(root) {
  const cargoTest = command("cargo", ["test", "--manifest-path", path.join(__dirname, "Cargo.toml")], path.resolve(__dirname, "..", ".."));
  const clients = Array.from({ length: 3 }, () => new Client(root));
  try {
    const results = await Promise.all(clients.map((client, index) => client.tool("pre_context", {
      symbol: `Symbol${String(997 + index).padStart(4, "0")}`,
      path: `src/main/java/stress/Symbol${String(997 + index).padStart(4, "0")}.java`,
    })));
    assert(results.every(result => result.java_semantic_engine_status === "verified"), "parallel context degraded");
    await cargoTest;
    return { clients: clients.length, cargo_test: "passed", semantic_status: "verified" };
  } finally {
    await Promise.all(clients.map(client => client.close()));
  }
}

async function run() {
  for (const file of [cliBinary, releaseBinary, platformBinary, sourceHelper, cliHelper, platformHelper]) {
    assert(fs.existsSync(file), `release provenance file missing: ${file}`);
  }
  const binaryHashes = [cliBinary, releaseBinary, platformBinary].map(hash);
  const helperHashes = [sourceHelper, cliHelper, platformHelper].map(hash);
  assert(new Set(binaryHashes).size === 1, `binary hash mismatch: ${binaryHashes.join(",")}`);
  assert(new Set(helperHashes).size === 1, `helper hash mismatch: ${helperHashes.join(",")}`);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-java-1k-"));
  write(path.join(root, "pom.xml"),
    "<project xmlns=\"http://maven.apache.org/POM/4.0.0\"><modelVersion>4.0.0</modelVersion><groupId>stress</groupId><artifactId>java-1k</artifactId><version>1</version><properties><maven.compiler.release>17</maven.compiler.release></properties></project>\n");
  for (let index = 0; index < 1000; index += 1) {
    const suffix = String(index).padStart(4, "0");
    const previous = index === 0 ? "return 0;" : `return new Symbol${String(index - 1).padStart(4, "0")}().value() + 1;`;
    write(path.join(root, `src/main/java/stress/Symbol${suffix}.java`),
      `package stress; public class Symbol${suffix} { public int value() { ${previous} } }\n`);
  }
  write(path.join(root, "src/main/java/stress/TypeError.java"),
    "package stress; public class TypeError { public String broken() { return 1; } }\n");

  const roundResults = [];
  for (let round = 1; round <= rounds; round += 1) roundResults.push(await runRound(root, round));
  const slowest = Math.max(...roundResults.map(result => result.elapsed_ms));
  const fastest = Math.min(...roundResults.map(result => result.elapsed_ms));
  assert(slowest / fastest <= Number(process.env.JAVA_BENCH_MAX_INSTABILITY_RATIO || 4),
    `three-round instability exceeded: ${(slowest / fastest).toFixed(2)}`);
  const parallel = await parallelGate(root);
  console.log(JSON.stringify({
    root,
    files: 1001,
    rounds: roundResults,
    instability_ratio: slowest / fastest,
    parallel,
    sha256: { binary: binaryHashes[0], helper: helperHashes[0] },
  }, null, 2));
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
