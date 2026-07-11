"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const { spawn } = require("child_process");

const binaryName = process.platform === "win32" ? "linghun-pre-engine.exe" : "linghun-pre-engine";
const binary = process.env.LINGHUN_PRE_ENGINE_BINARY || path.join(__dirname, "target", "debug", binaryName);

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
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      }
    });
    this.ready = this.request("initialize", { rootUri: root });
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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

async function run() {
  if (!fs.existsSync(binary)) throw new Error(`binary missing: ${binary}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-rust-1k-"));
  const modules = [];
  for (let index = 0; index < 1000; index += 1) {
    const suffix = String(index).padStart(4, "0");
    modules.push(`pub mod m${suffix};`);
    write(path.join(root, "src", `m${suffix}.rs`), `pub fn symbol_${suffix}() -> usize { ${index} }\n`);
  }
  write(path.join(root, "Cargo.toml"), "[package]\nname=\"rust-stress\"\nversion=\"0.1.0\"\nedition=\"2021\"\n");
  write(path.join(root, "src", "lib.rs"), `${modules.join("\n")}\n`);

  const client = new Client(root);
  const samples = { context: [], plan: [], impact: [], verify: [] };
  try {
    await timed(samples.context, () => client.tool("pre_context", { symbol: "symbol_0999", path: "src/m0999.rs" }));
    for (let iteration = 0; iteration < 5; iteration += 1) {
      await timed(samples.context, () => client.tool("pre_context", { symbol: "symbol_0999", path: "src/m0999.rs" }));
      await timed(samples.plan, () => client.tool("pre_plan", {
        task: "change symbol 0999", target_files: ["src/m0999.rs"], target_symbols: ["symbol_0999"],
      }));
      await timed(samples.impact, () => client.tool("pre_impact", {
        changes: [{ path: "src/m0999.rs", symbols: ["symbol_0999"] }],
      }));
    }
    const verify = await timed(samples.verify, () => client.tool("pre_verify", { changed_files: ["src/m0999.rs"] }));
    if (verify.rust_deep_layer.status !== "verified" || verify.verification.status !== "verified") {
      throw new Error(`verify degraded: ${verify.rust_deep_layer.status}/${verify.verification.status}`);
    }
    const seedChanges = Array.from({ length: 100 }, (_, index) => {
      const suffix = String(index).padStart(4, "0");
      return { path: `src/m${suffix}.rs`, symbols: [`symbol_${suffix}`] };
    });
    const seedStarted = performance.now();
    const seedImpact = await client.tool("pre_impact", { changes: seedChanges });
    const seedImpactMs = performance.now() - seedStarted;
    if (seedImpact.rust_semantic_engine_status !== "verified") {
      throw new Error(`100-seed impact degraded: ${seedImpact.rust_semantic_engine_status}`);
    }
    const report = {
      files: 1000,
      seeds: 100,
      p95_ms: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, percentile(values, 0.95)])),
      seed_impact_ms: seedImpactMs,
      program_build_count: seedImpact.rust_program_build_count,
      generated_at: new Date().toISOString(),
    };
    const reportPath = path.join(os.tmpdir(), "linghun-rust-product-1k-final.json");
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, report: reportPath }, null, 2));
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
