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
    this.child.on("exit", (code, signal) => {
      const error = new Error(`child exited: code=${code} signal=${signal || "none"}`);
      for (const pending of this.pending.splice(0)) pending.reject(error);
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
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [line, value] of text.split(/\r?\n/).entries()) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "gu");
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
    "src/lib.rs": "pub mod shared;\npub mod reexport;\npub mod consumer;\npub mod duplicate;\npub mod duplicate2;\npub mod same_file;\npub mod unicode;\npub mod stale;\npub mod type_error;\n",
    "src/shared.rs": "pub struct MessageBuilder;\nimpl MessageBuilder {\n    pub fn build(&self) -> String { format_message() }\n}\npub fn format_message() -> String { \"ok\".to_string() }\n",
    "src/reexport.rs": "pub use crate::shared::MessageBuilder as Builder;\n",
    "src/consumer.rs": "use crate::reexport::Builder;\npub fn render() -> String {\n    let builder = Builder;\n    builder.build()\n}\n",
    "src/duplicate.rs": "pub struct Builder;\npub struct RustCollision;\npub fn unrelated() -> Builder { Builder }\n",
    "src/duplicate2.rs": "pub struct Builder;\npub struct RustCollision;\npub struct OnlyElsewhere;\n",
    "src/same_file.rs": "mod alpha { pub struct Local; }\nmod beta { pub struct Local; }\n",
    "src/unicode.rs": "pub fn 计算() -> &'static str { \"好\"; \"好\" }\r\n",
    "src/stale.rs": "use crate::shared::MessageBuilder;\npub fn stale() -> MessageBuilder { MessageBuilder }\n",
    "src/type_error.rs": "pub fn broken() { let _value: i32 = \"bad\"; }\n",
    "mixed.ts": "export class Builder {}\n",
    "mixed.py": "class Builder:\n    pass\n",
  };
  const chainModules = Array.from({ length: 18 }, (_, index) => `chain${String(index).padStart(2, "0")}`);
  files["src/lib.rs"] += `${chainModules.map(module => `pub mod ${module};`).join("\n")}\n`;
  for (let index = 0; index < chainModules.length; index += 1) {
    const next = chainModules[index + 1];
    files[`src/${chainModules[index]}.rs`] = next
      ? `use crate::${next}::value as next_value;\npub fn value() -> usize { ${index} + next_value() }\n`
      : `pub fn value() -> usize { ${index} }\n`;
  }
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

    const pathlessUnique = await helper.query({
      op: "analyze", root, files: [], symbols: ["MessageBuilder"], symbol_positions: [], import_tokens: [],
      allow_workspace_symbol: true,
    });
    check(results, "pathless unique symbol uses workspace/symbol",
      pathlessUnique.status === "verified" && pathlessUnique.relations.MessageBuilder.targets.length === 1
        && pathlessUnique.relations.MessageBuilder.targets[0].file === "src/shared.rs");
    const pathlessAmbiguous = await helper.query({
      op: "analyze", root, files: [], symbols: ["Builder"], symbol_positions: [], import_tokens: [],
      allow_workspace_symbol: true,
    });
    check(results, "pathless duplicate symbol is ambiguous without merged references",
      pathlessAmbiguous.status === "partially_verified"
        && pathlessAmbiguous.relations.Builder.targets.length > 1
        && pathlessAmbiguous.relations.Builder.references.length === 0);
    const sameFileAmbiguous = await helper.query({
      op: "analyze", root, files: ["src/same_file.rs"], symbols: ["Local"],
      symbol_positions: symbolPositions("src/same_file.rs", files["src/same_file.rs"], "Local"), import_tokens: [],
    });
    check(results, "same-file duplicate symbol is not merged",
      sameFileAmbiguous.status === "partially_verified" && sameFileAmbiguous.relations.Local.targets.length !== 1
        && sameFileAmbiguous.relations.Local.references.length === 0);
    const explicitMissing = await helper.query({
      op: "analyze", root, files: ["src/duplicate.rs"], symbols: ["OnlyElsewhere"],
      symbol_positions: [], import_tokens: [], allow_workspace_symbol: false,
    });
    check(results, "explicit Rust path never falls back to global workspace/symbol",
      explicitMissing.status === "partially_verified"
        && explicitMissing.relations.OnlyElsewhere.targets.length === 0);
    const unicode = await helper.query({
      op: "analyze", root, files: ["src/unicode.rs"], symbols: ["计算"],
      symbol_positions: symbolPositions("src/unicode.rs", files["src/unicode.rs"], "计算"), import_tokens: [],
    });
    check(results, "Unicode identifiers and CRLF coordinates resolve",
      unicode.status === "verified" && unicode.relations["计算"].targets.length === 1);

    const firstVerify = await helper.query({ op: "verify", root, files: ["src/type_error.rs"] });
    check(results, "verify reports rust-analyzer diagnostics", firstVerify.status === "verified" && firstVerify.issues.length > 0,
      `${firstVerify.status}: ${firstVerify.reason || "no reason"}; issues=${firstVerify.issues.length}; verification=${JSON.stringify(firstVerify.verification)}`);
    write(path.join(root, "src/type_error.rs"), "pub fn broken() { let _value: i32 = 1; }\n");
    const fixedVerify = await helper.query({ op: "verify", root, files: ["src/type_error.rs"] });
    check(results, "didChange clears stale diagnostics",
      fixedVerify.status === "verified" && fixedVerify.issues.length === 0
        && fixedVerify.verification.diagnostic_count === 0);
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

    fs.appendFileSync(path.join(root, "Cargo.toml"), "\n# smoke config change\n");
    const cargoTomlChanged = await helper.query({
      op: "analyze", root, files: ["src/shared.rs"], symbols: ["MessageBuilder"],
      symbol_positions: symbolPositions("src/shared.rs", shared, "MessageBuilder"), import_tokens: [],
    });
    check(results, "Cargo.toml change rebuilds the same rust-analyzer session",
      cargoTomlChanged.program_rebuilt && cargoTomlChanged.program_build_count === 2);
    fs.appendFileSync(path.join(root, "Cargo.lock"), "\n# smoke lock change\n");
    const cargoLockChanged = await helper.query({
      op: "analyze", root, files: ["src/shared.rs"], symbols: ["MessageBuilder"],
      symbol_positions: symbolPositions("src/shared.rs", shared, "MessageBuilder"), import_tokens: [],
    });
    check(results, "Cargo.lock change rebuilds the same rust-analyzer session",
      cargoLockChanged.program_rebuilt && cargoLockChanged.program_build_count === 3);
    write(path.join(root, ".cargo", "config.toml"), "[build]\nrustflags = []\n");
    const cargoConfigChanged = await helper.query({
      op: "analyze", root, files: ["src/shared.rs"], symbols: ["MessageBuilder"],
      symbol_positions: symbolPositions("src/shared.rs", shared, "MessageBuilder"), import_tokens: [],
    });
    check(results, ".cargo config change rebuilds the same rust-analyzer session",
      cargoConfigChanged.program_rebuilt && cargoConfigChanged.program_build_count === 4);
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

  const timeoutHelper = new LineClient(process.execPath, [helperPath], {
    cwd: __dirname,
    env: { ...process.env, LINGHUN_RUST_FLYCHECK_TIMEOUT_MS: "1" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  try {
    const timeout = await timeoutHelper.query({ op: "verify", root, files: ["src/type_error.rs"] });
    check(results, "flycheck timeout degrades instead of verifying empty diagnostics",
      timeout.status === "partially_verified" && /timed out/i.test(timeout.reason || ""));
  } finally {
    await timeoutHelper.close();
  }

  const protocolHelper = new LineClient(process.execPath, [helperPath], {
    cwd: __dirname,
    env: {
      ...process.env,
      LINGHUN_RUST_ANALYZER: process.platform === "win32"
        ? path.join(process.env.SystemRoot, "System32", "where.exe")
        : "/bin/false",
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  try {
    const protocolExit = await protocolHelper.query({ op: "verify", root, files: ["src/type_error.rs"] });
    check(results, "rust-analyzer protocol exit degrades without fallback",
      protocolExit.status === "partially_verified" && protocolExit.status !== "tool_missing");
  } finally {
    await protocolHelper.close();
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

      const pathlessContext = await client.callTool("pre_context", { symbol: "MessageBuilder" });
      check(results, "pre_context pathless unique symbol resolves only through rust-analyzer",
        pathlessContext.rust_semantic_engine_status === "verified"
          && pathlessContext.definition && pathlessContext.definition.file.replace(/\\/g, "/").endsWith("src/shared.rs"));
      const ambiguousContext = await client.callTool("pre_context", { symbol: "RustCollision" });
      check(results, "pre_context pathless duplicates stay ambiguous",
        ambiguousContext.rust_semantic_engine_status === "partially_verified"
          && ambiguousContext.definition_candidates.length > 1 && ambiguousContext.references.length === 0);
      const scopedMissingContext = await client.callTool("pre_context", {
        symbol: "OnlyElsewhere", path: "src/duplicate.rs",
      });
      check(results, "pre_context explicit Rust path cannot capture another file's same-name symbol",
        scopedMissingContext.rust_semantic_engine_status === "partially_verified"
          && scopedMissingContext.definition == null);

      const callContext = await client.callTool("pre_context", { symbol: "build", path: "src/shared.rs" });
      check(results, "pre_context exposes call hierarchy", callContext.callers.some(caller => caller.file.replace(/\\/g, "/").endsWith("src/consumer.rs")));

      const impact = await client.callTool("pre_impact", {
        changes: [{ path: "src/consumer.rs", symbols: ["Builder"] }],
      });
      check(results, "pre_impact follows Rust references", impact.affected_files.includes("src/shared.rs") && impact.affected_files.includes("src/consumer.rs"));
      check(results, "pre_impact excludes same-name collision", !impact.affected_files.includes("src/duplicate.rs"));
      check(results, "pre_impact reports Rust semantic engine", impact.rust_semantic_engine_status === "verified");
      const deletedImpact = await client.callTool("pre_impact", {
        changes: [{ path: "src/stale.rs", symbols: ["stale"] }],
      });
      check(results, "pre_impact deleted Rust file degrades instead of escaping semantic coverage",
        deletedImpact.rust_semantic_engine_status === "partially_verified"
          && deletedImpact.answer_pack.missing_evidence.includes("rust_analyzer_program"));
      const pathOnlyDeletedImpact = await client.callTool("pre_impact", {
        changes: [{ path: "src/stale.rs" }],
      });
      check(results, "pre_impact path-only Rust deletion cannot report verified without documents",
        pathOnlyDeletedImpact.rust_semantic_engine_status === "partially_verified");

      const plan = await client.callTool("pre_plan", {
        task: "change Builder construction",
        target_files: ["src/consumer.rs"],
        target_symbols: ["Builder"],
      });
      const plannedFiles = plan.edit_order.map(step => step.file);
      check(results, "pre_plan includes Rust semantic closure", plannedFiles.includes("src/consumer.rs") && plannedFiles.includes("src/shared.rs"));
      check(results, "pre_plan reports Rust semantic engine", plan.rust_semantic_engine_status === "verified");
      const planSteps = new Map(plan.edit_order.map(step => [step.file, step]));
      check(results, "pre_plan preserves consumer to reexport to shared dependency chain",
        planSteps.get("src/consumer.rs")?.depends_on.includes("src/reexport.rs")
          && planSteps.get("src/reexport.rs")?.depends_on.includes("src/shared.rs"));

      const pathlessPlan = await client.callTool("pre_plan", {
        task: "change MessageBuilder", target_symbols: ["MessageBuilder"],
      });
      check(results, "pre_plan pathless unique symbol closes related dependencies",
        pathlessPlan.rust_semantic_engine_status === "verified"
          && pathlessPlan.edit_order.some(step => step.file === "src/shared.rs")
          && pathlessPlan.edit_order.some(step => step.file === "src/reexport.rs"));
      const mixedPlan = await client.callTool("pre_plan", {
        task: "change TypeScript Builder", target_files: ["mixed.ts"], target_symbols: ["Builder"],
      });
      check(results, "pre_plan explicit TypeScript target does not activate Rust workspace discovery",
        mixedPlan.rust_semantic_engine_status === "disabled"
          && mixedPlan.edit_order.every(step => !step.file.endsWith(".rs")));
      const truncatedPlan = await client.callTool("pre_plan", {
        task: "inspect deep dependency chain", target_files: ["src/chain00.rs"], target_symbols: [],
      });
      check(results, "pre_plan marks an unclosed 16-round Rust graph as truncated",
        truncatedPlan.module_graph_truncated
          && truncatedPlan.answer_pack.missing_evidence.includes("module_graph_truncated"));

      write(path.join(root, "src/type_error.rs"), "pub fn broken() { let _value: i32 = \"bad\"; }\n");
      const verify = await client.callTool("pre_verify", { changed_files: ["src/type_error.rs"] });
      check(results, "pre_verify reports Rust type errors", verify.issues.some(issue => issue.source === "rust-deep-layer"));
      check(results, "pre_verify uses rust-analyzer only", verify.rust_deep_layer.status === "verified" && verify.rust_deep_layer.program_build_count === 1);
      check(results, "context plan impact verify reuse one session and snapshot",
        context.rust_program_build_count === 1 && impact.rust_program_build_count === 1
          && plan.rust_program_build_count === 1 && verify.rust_deep_layer.program_build_count === 1
          && context.rust_semantic_snapshot_id === impact.rust_semantic_snapshot_id
          && impact.rust_semantic_snapshot_id === plan.rust_semantic_snapshot_id
          && plan.rust_semantic_snapshot_id === verify.rust_deep_layer.semantic_snapshot_id);
    } finally {
      await client.close();
    }
  } else {
    check(results, `binary exists at ${binary}`, !process.argv.includes("--require-binary"));
  }

  if (process.env.LINGHUN_KEEP_RUST_SMOKE_ROOT) console.log(`fixture: ${root}`);
  else fs.rmSync(root, { recursive: true, force: true });
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
