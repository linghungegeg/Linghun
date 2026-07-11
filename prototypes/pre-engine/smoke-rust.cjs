"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const helperPath = path.join(__dirname, "rust-deep-layer.cjs");

function defaultBinary() {
  const name = process.platform === "win32" ? "linghun-pre-engine.exe" : "linghun-pre-engine";
  return path.join(__dirname, "target", "debug", name);
}

class LineClient {
  constructor(command, args, options) {
    this.child = spawn(command, args, options);
    this.buffer = "";
    this.pending = [];
    this.child.stdout.on("data", chunk => {
      this.buffer += chunk.toString();
      for (let newline; (newline = this.buffer.indexOf("\n")) >= 0;) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        const pending = this.pending.shift();
        if (pending) pending.resolve(JSON.parse(line));
      }
    });
  }

  query(request) {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  close() {
    this.child.stdin.end();
    return new Promise(resolve => this.child.on("close", resolve));
  }
}

class PreEngineClient {
  constructor(binary, env = process.env) {
    this.child = spawn(binary, [], {
      cwd: __dirname,
      env,
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
  }

  request(method, params, timeoutMs = 120000) {
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

  async initialize(root) {
    await this.request("initialize", { rootUri: root });
  }

  async callTool(name, argumentsValue) {
    const result = await this.request("tools/call", { name, arguments: argumentsValue });
    if (!result || result.isError) throw new Error(`${name} failed: ${JSON.stringify(result)}`);
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

function symbolPositions(file, text, symbol) {
  const positions = [];
  for (const [line, value] of text.split(/\r?\n/).entries()) {
    const pattern = new RegExp(`\\b${symbol}\\b`, "gu");
    for (let match; (match = pattern.exec(value));) {
      positions.push({ file, symbol, line, character: value.slice(0, match.index).length });
    }
  }
  return positions;
}

function importTokens(file, text) {
  const tokens = [];
  for (const [line, value] of text.split(/\r?\n/).entries()) {
    if (!/^\s*(?:pub\s+)?use\s+/.test(value) && !/^\s*(?:pub\s+)?mod\s+/.test(value)) continue;
    for (const match of value.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      if (["pub", "use", "mod", "crate", "self", "super", "as"].includes(match[0])) continue;
      tokens.push({ file, specifier: value.trim(), line, character: match.index });
    }
  }
  return tokens;
}

function check(results, name, pass, detail = "") {
  results.push({ name, pass: Boolean(pass), detail });
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-rust-product-"));
  const results = [];
  const files = {
    "Cargo.toml": "[package]\nname = \"rust-product-smoke\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    "src/lib.rs": "pub mod shared;\npub mod reexport;\npub mod consumer;\npub mod duplicate;\npub mod stale;\npub mod type_error;\n",
    "src/shared.rs": "pub struct MessageBuilder;\nimpl MessageBuilder {\n    pub fn build(&self) -> String { format_message() }\n}\npub fn format_message() -> String { \"ok\".to_string() }\n",
    "src/reexport.rs": "pub use crate::shared::MessageBuilder as Builder;\n",
    "src/consumer.rs": "use crate::reexport::Builder;\npub fn render() -> String {\n    let builder = Builder;\n    builder.build()\n}\n",
    "src/duplicate.rs": "pub struct Builder;\npub fn unrelated() -> Builder { Builder }\n",
    "src/stale.rs": "use crate::shared::MessageBuilder;\npub fn stale() -> MessageBuilder { MessageBuilder }\n",
    "src/type_error.rs": "pub fn broken() { let _value: i32 = \"bad\"; }\n",
    "mixed.ts": "export class Builder {}\n",
  };
  for (const [file, content] of Object.entries(files)) write(path.join(root, file), content);

  const helper = new LineClient(process.execPath, [helperPath], {
    cwd: __dirname,
    stdio: ["pipe", "pipe", "inherit"],
  });
  try {
    const consumer = files["src/consumer.rs"];
    const direct = await helper.query({
      op: "analyze",
      root,
      files: ["src/consumer.rs"],
      symbols: ["Builder"],
      symbol_positions: symbolPositions("src/consumer.rs", consumer, "Builder"),
      import_tokens: importTokens("src/consumer.rs", consumer),
    });
    const relation = direct.relations.Builder;
    check(results, "helper uses rust-analyzer semantic identity", direct.status === "verified");
    check(results, "alias resolves through re-export", relation.targets.length === 1 && relation.targets[0].file === "src/shared.rs");
    check(results, "same-name Rust symbol stays isolated", !relation.related_files.includes("src/duplicate.rs"));
    check(results, "module dependency comes from rust-analyzer", direct.module_dependencies["src/consumer.rs"].includes("src/reexport.rs"));

    const firstVerify = await helper.query({ op: "verify", root, files: ["src/type_error.rs"] });
    check(results, "verify reports rust-analyzer diagnostics", firstVerify.status === "verified" && firstVerify.issues.length > 0);
    write(path.join(root, "src/type_error.rs"), "pub fn broken() { let _value: i32 = 1; }\n");
    const fixedVerify = await helper.query({ op: "verify", root, files: ["src/type_error.rs"] });
    check(results, "didChange clears stale diagnostics", fixedVerify.issues.length === 0);
    check(results, "verify reuses one rust-analyzer session", fixedVerify.program_build_count === 1);

    const shared = files["src/shared.rs"];
    const staleBefore = await helper.query({
      op: "analyze",
      root,
      files: ["src/shared.rs", "src/stale.rs"],
      symbols: ["MessageBuilder"],
      symbol_positions: [
        ...symbolPositions("src/shared.rs", shared, "MessageBuilder"),
        ...symbolPositions("src/stale.rs", files["src/stale.rs"], "MessageBuilder"),
      ],
      import_tokens: importTokens("src/stale.rs", files["src/stale.rs"]),
    });
    fs.unlinkSync(path.join(root, "src/stale.rs"));
    write(path.join(root, "src/lib.rs"), files["src/lib.rs"].replace("pub mod stale;\n", ""));
    const staleAfter = await helper.query({
      op: "analyze",
      root,
      files: ["src/shared.rs"],
      symbols: ["MessageBuilder"],
      symbol_positions: symbolPositions("src/shared.rs", shared, "MessageBuilder"),
      import_tokens: [],
    });
    const staleBeforeFiles = staleBefore.relations && staleBefore.relations.MessageBuilder
      ? staleBefore.relations.MessageBuilder.related_files : [];
    const staleAfterFiles = staleAfter.relations && staleAfter.relations.MessageBuilder
      ? staleAfter.relations.MessageBuilder.related_files : [];
    check(results, "deleted file is visible before didClose", staleBeforeFiles.includes("src/stale.rs"), staleBefore.reason || "");
    check(results, "didClose removes deleted file", !staleAfterFiles.includes("src/stale.rs"), staleAfter.reason || "");

    fs.renameSync(path.join(root, "src/consumer.rs"), path.join(root, "src/renamed.rs"));
    write(path.join(root, "src/lib.rs"), files["src/lib.rs"]
      .replace("pub mod consumer;", "pub mod renamed;")
      .replace("pub mod stale;\n", ""));
    const renamed = await helper.query({
      op: "analyze",
      root,
      files: ["src/lib.rs", "src/renamed.rs"],
      symbols: ["Builder"],
      symbol_positions: symbolPositions("src/renamed.rs", consumer, "Builder"),
      import_tokens: [
        ...importTokens("src/lib.rs", files["src/lib.rs"].replace("pub mod consumer;", "pub mod renamed;").replace("pub mod stale;\n", "")),
        ...importTokens("src/renamed.rs", consumer),
      ],
    });
    const renamedFiles = renamed.relations && renamed.relations.Builder
      ? renamed.relations.Builder.related_files : [];
    check(results, "rename closes the old URI and opens the new URI",
      renamedFiles.includes("src/renamed.rs") && !renamedFiles.includes("src/consumer.rs"),
      `${renamed.reason || ""} files=${JSON.stringify(renamedFiles)}`);
    fs.renameSync(path.join(root, "src/renamed.rs"), path.join(root, "src/consumer.rs"));
    write(path.join(root, "src/lib.rs"), files["src/lib.rs"].replace("pub mod stale;\n", ""));
  } finally {
    await helper.close();
  }

  const missingPath = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-rust-missing-"));
  const missingHelper = new LineClient(process.execPath, [helperPath], {
    cwd: __dirname,
    env: { ...process.env, PATH: missingPath },
    stdio: ["pipe", "pipe", "inherit"],
  });
  try {
    const missing = await missingHelper.query({ op: "verify", root, files: ["src/shared.rs"] });
    check(results, "missing rust-analyzer is explicit", missing.status === "tool_missing" && missing.verification.missing.includes("rust-analyzer"));
  } finally {
    await missingHelper.close();
    fs.rmSync(missingPath, { recursive: true, force: true });
  }

  const binary = process.env.LINGHUN_PRE_ENGINE_BINARY || defaultBinary();
  if (fs.existsSync(binary)) {
    const client = new PreEngineClient(binary);
    try {
      await client.initialize(root);
      const context = await client.callTool("pre_context", { symbol: "Builder", path: "src/consumer.rs" });
      check(results, "pre_context resolves Rust alias", context.definition && context.definition.file.replace(/\\/g, "/").endsWith("src/shared.rs"));
      check(results, "pre_context excludes mixed-language collision", !context.references.some(reference => reference.file.endsWith("mixed.ts")));
      check(results, "pre_context reports Rust semantic engine", context.rust_semantic_engine_status === "verified");
      check(results, "capability matrix marks Rust product-grade",
        context.capability_summary && !context.capability_summary.partial_languages.includes("Rust"));

      const callContext = await client.callTool("pre_context", { symbol: "build", path: "src/shared.rs" });
      check(results, "pre_context exposes call hierarchy", callContext.callers.some(caller => caller.file.replace(/\\/g, "/").endsWith("src/consumer.rs")));

      const impact = await client.callTool("pre_impact", {
        changes: [{ path: "src/consumer.rs", symbols: ["Builder"] }],
      });
      check(results, "pre_impact follows Rust references", impact.affected_files.includes("src/shared.rs") && impact.affected_files.includes("src/consumer.rs"));
      check(results, "pre_impact excludes same-name collision", !impact.affected_files.includes("src/duplicate.rs"));
      check(results, "pre_impact reports Rust semantic engine", impact.rust_semantic_engine_status === "verified");

      const plan = await client.callTool("pre_plan", {
        task: "change Builder construction",
        target_files: ["src/consumer.rs"],
        target_symbols: ["Builder"],
      });
      const plannedFiles = plan.edit_order.map(step => step.file);
      check(results, "pre_plan includes Rust semantic closure", plannedFiles.includes("src/consumer.rs") && plannedFiles.includes("src/shared.rs"));
      check(results, "pre_plan reports Rust semantic engine", plan.rust_semantic_engine_status === "verified");

      write(path.join(root, "src/type_error.rs"), "pub fn broken() { let _value: i32 = \"bad\"; }\n");
      const verify = await client.callTool("pre_verify", { changed_files: ["src/type_error.rs"] });
      check(results, "pre_verify reports Rust type errors", verify.issues.some(issue => issue.source === "rust-deep-layer"));
      check(results, "pre_verify uses rust-analyzer only", verify.rust_deep_layer.status === "verified" && verify.rust_deep_layer.program_build_count === 1);
    } finally {
      await client.close();
    }
  } else {
    check(results, `binary exists at ${binary}`, !process.argv.includes("--require-binary"));
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log("=== Rust Product Smoke ===");
  for (const result of results) {
    console.log(`${result.pass ? "PASS" : "FAIL"}: ${result.name}${result.detail ? ` (${result.detail})` : ""}`);
  }
  const passed = results.filter(result => result.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
