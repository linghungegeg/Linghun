"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const helperPath = path.join(__dirname, "py-deep-layer.cjs");

function defaultBinary() {
  const name = process.platform === "win32" ? "linghun-pre-engine.exe" : "linghun-pre-engine";
  return path.join(__dirname, "target", "debug", name);
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

  request(method, params, timeoutMs = 30000) {
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

  async callTool(name, argumentsValue, timeoutMs = 120000) {
    const result = await this.request(
      "tools/call",
      { name, arguments: argumentsValue },
      timeoutMs,
    );
    if (!result || result.isError) throw new Error(`${name} failed: ${JSON.stringify(result)}`);
    return JSON.parse(result.content.find(item => item.type === "text").text);
  }

  close() {
    this.child.stdin.end();
    return new Promise(resolve => this.child.on("close", resolve));
  }
}

function helper(env = process.env) {
  const child = spawn(process.execPath, [helperPath], {
    cwd: __dirname,
    env,
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buffer = "";
  const pending = [];
  child.stdout.on("data", chunk => {
    buffer += chunk.toString();
    for (let newline; (newline = buffer.indexOf("\n")) >= 0;) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      pending.shift().resolve(JSON.parse(line));
    }
  });
  return {
    query(request) {
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        child.stdin.write(JSON.stringify(request) + "\n");
      });
    },
    close() {
      child.stdin.end();
      return new Promise(resolve => child.on("close", resolve));
    },
  };
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function check(results, name, pass) {
  results.push({ name, pass });
}

async function runBinarySmoke(results) {
  const binary = process.env.LINGHUN_PRE_ENGINE_BINARY || defaultBinary();
  if (!fs.existsSync(binary)) {
    if (process.argv.includes("--require-binary")) {
      check(results, `binary exists at ${binary}`, false);
    }
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-python-binary-"));
  write(path.join(root, "pyrightconfig.json"), JSON.stringify({ include: ["."] }));
  write(path.join(root, "shared.py"), [
    "class MessageBuilder:",
    "    def build(self, value: str) -> str:",
    "        return value",
    "",
    "class UniqueService:",
    "    pass",
    "",
  ].join("\n"));
  write(path.join(root, "consumer.py"), [
    "from shared import MessageBuilder as Builder",
    "",
    "def render(value: str) -> str:",
    "    return Builder().build(value)",
    "",
  ].join("\n"));
  write(path.join(root, "unrelated.py"), "class MessageBuilder:\n    pass\n");
  write(path.join(root, "mixed.ts"), "export class MessageBuilder {}\n");

  const client = new PreEngineClient(binary);
  try {
    await client.initialize(root);
    const context = await client.callTool("pre_context", {
      symbol: "Builder",
      path: "consumer.py",
    });
    const unscopedContext = await client.callTool("pre_context", {
      symbol: "render",
    });
    const plan = await client.callTool("pre_plan", {
      task: "change MessageBuilder",
      target_files: ["shared.py"],
      target_symbols: ["MessageBuilder"],
    });
    const impact = await client.callTool("pre_impact", {
      changes: [{ path: "shared.py", symbols: ["MessageBuilder"] }],
    });
    const verify = await client.callTool("pre_verify", {
      changed_files: ["consumer.py"],
    });
    const discovery = await client.callTool("pre_plan", {
      task: "MessageBuilder render",
    });
    const unscopedPlan = await client.callTool("pre_plan", {
      task: "change render",
      target_symbols: ["render"],
    });

    const contextFiles = new Set(context.answer_pack.affected_files || []);
    const planSteps = plan.edit_order || [];
    const consumerStep = planSteps.find(step => step.file === "consumer.py");
    const impactFiles = new Set(impact.affected_files || []);
    check(results, "binary context uses the Python definition", context.definition && context.definition.file.endsWith("shared.py"));
    check(results, "binary unscoped context uses one exact Pyright symbol", unscopedContext.definition && unscopedContext.definition.file.endsWith("consumer.py") && unscopedContext.python_semantic_engine_status === "verified");
    check(results, "binary context excludes the mixed-language same name", !contextFiles.has("mixed.ts"));
    check(results, "binary plan closes the Pyright dependency graph", consumerStep && consumerStep.depends_on.includes("shared.py"));
    check(results, "binary impact includes the real Python consumer", impactFiles.has("consumer.py") && !impactFiles.has("unrelated.py"));
    check(results, "binary verify reports Python verified", verify.py_deep_layer.status === "verified" && verify.status === "pass");
    check(results, "binary tools reuse one Pyright program", [context, plan, impact, verify].every(payload => (payload.python_program_build_count || payload.py_deep_layer.program_build_count) === 1));
    check(results, `task-only Python plan returns semantic discovery (${discovery.mode}/${discovery.python_semantic_engine_status}/${(discovery.anchor_symbols || []).map(anchor => anchor.file).join(",")})`, discovery.mode === "discovery"
      && discovery.python_semantic_engine_status === "verified"
      && discovery.anchor_symbols.some(anchor => anchor.file === "consumer.py")
      && !discovery.anchor_symbols.some(anchor => anchor.file === "mixed.ts"));
    check(results, "binary symbol-only plan uses one exact Pyright symbol", unscopedPlan.python_semantic_engine_status === "verified" && unscopedPlan.edit_order.some(step => step.file === "consumer.py"));
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  }

  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const nodeDirectory = path.dirname(process.execPath);
  const missingPath = [nodeDirectory, path.join(systemRoot, "System32")].join(path.delimiter);
  const missingRoot = path.join(__dirname, "fixtures", "smoke-python");
  const missingClient = new PreEngineClient(binary, { ...process.env, PATH: missingPath });
  try {
    await missingClient.initialize(missingRoot);
    const missing = await missingClient.callTool("pre_verify", { changed_files: ["type-ok.py"] });
    check(results, "binary missing Pyright is tool_missing", missing.py_deep_layer.status === "tool_missing" && missing.verification.status === "tool_missing");
  } finally {
    await missingClient.close();
  }
}

async function main() {
  const results = [];
  const verifyRoot = path.join(__dirname, "fixtures", "smoke-python");
  const errorFile = path.join(verifyRoot, "type-error.py");
  const original = fs.readFileSync(errorFile, "utf8");
  const client = helper();
  try {
    const base = {
      root: verifyRoot.replace(/\\/g, "/"),
      pyrightconfig: path.join(verifyRoot, "pyrightconfig.json").replace(/\\/g, "/"),
    };
    const error = await client.query({ ...base, op: "verify", files: ["type-error.py"] });
    const clean = await client.query({ ...base, op: "verify", files: ["type-ok.py"] });
    fs.writeFileSync(errorFile, "x: int = 99\n");
    const fixed = await client.query({ ...base, op: "verify", files: ["type-error.py"] });
    fs.writeFileSync(errorFile, original);
    const brokenAgain = await client.query({ ...base, op: "verify", files: ["type-error.py"] });

    check(results, "verify reports Pyright type errors", error.issues.length > 0);
    check(results, "verify keeps valid files clean", clean.issues.length === 0);
    check(results, "didChange clears stale diagnostics", fixed.issues.length === 0);
    check(results, "didChange restores new diagnostics", brokenAgain.issues.length > 0);
    check(results, "verify reuses one semantic session", brokenAgain.program_build_count === 1);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-python-lsp-"));
    write(path.join(root, "pyrightconfig.json"), JSON.stringify({ include: ["."] }));
    write(path.join(root, "shared.py"), [
      "class MessageBuilder:",
      "    def build(self, name: str) -> str:",
      "        return name",
      "",
      "def format_message(name: str) -> str:",
      "    return name",
      "",
    ].join("\n"));
    write(path.join(root, "consumer.py"), [
      "from shared import MessageBuilder as Builder, format_message",
      "",
      "def render_message(name: str) -> str:",
      "    return format_message(Builder().build(name))",
      "",
      "def unrelated_local():",
      "    class Builder:",
      "        pass",
      "    return Builder()",
      "",
    ].join("\n"));
    write(path.join(root, "unrelated.py"), [
      "class MessageBuilder:",
      "    pass",
      "",
      "def unrelated():",
      "    return MessageBuilder()",
      "",
    ].join("\n"));
    const unicodeSource = "from unicode_shared import 构建器\r\n实例 = 构建器()\r\n";
    write(path.join(root, "unicode_shared.py"), "class 构建器:\r\n    pass\r\n");
    write(path.join(root, "unicode_consumer.py"), unicodeSource);
    write(path.join(root, "stale_consumer.py"), "from shared import MessageBuilder\nvalue = MessageBuilder()\n");

    const structureClient = helper();
    try {
      const structure = await structureClient.query({
        op: "analyze",
        root: root.replace(/\\/g, "/"),
        pyrightconfig: path.join(root, "pyrightconfig.json").replace(/\\/g, "/"),
        files: ["shared.py", "consumer.py", "unrelated.py"],
        symbols: ["Builder"],
        symbol_positions: [
          { file: "consumer.py", symbol: "Builder", line: 0, character: 37 },
          { file: "consumer.py", symbol: "Builder", line: 3, character: 26 },
        ],
        import_tokens: [
          { file: "consumer.py", specifier: "from shared import MessageBuilder as Builder, format_message", line: 0, character: 5 },
          { file: "consumer.py", specifier: "from shared import MessageBuilder as Builder, format_message", line: 0, character: 19 },
          { file: "consumer.py", specifier: "from shared import MessageBuilder as Builder, format_message", line: 0, character: 37 },
          { file: "consumer.py", specifier: "from shared import MessageBuilder as Builder, format_message", line: 0, character: 46 },
        ],
      });
      const relation = structure.relations.Builder;
      check(results, "alias resolves to the Pyright definition", relation.targets.length === 1 && relation.targets[0].file === "shared.py");
      check(results, "alias references include renamed usage", relation.names_by_file["consumer.py"].includes("Builder"));
      check(results, "same-name unrelated file stays isolated", !relation.related_files.includes("unrelated.py"));
      check(results, "same-file local shadow stays isolated", !relation.references.some(reference => reference.file === "consumer.py" && reference.line >= 6));
      check(results, "import dependency comes from definition", structure.module_dependencies["consumer.py"].includes("shared.py"));

      const unscoped = await structureClient.query({
        op: "analyze",
        root: root.replace(/\\/g, "/"),
        pyrightconfig: path.join(root, "pyrightconfig.json").replace(/\\/g, "/"),
        files: ["shared.py"],
        symbols: ["format_message"],
        symbol_positions: [],
        import_tokens: [],
      });
      check(results, "unscoped unique symbol resolves only through Pyright", unscoped.status === "verified" && unscoped.relations.format_message.targets.length === 1);

      const staleBefore = await structureClient.query({
        op: "analyze",
        root: root.replace(/\\/g, "/"),
        pyrightconfig: path.join(root, "pyrightconfig.json").replace(/\\/g, "/"),
        files: ["shared.py", "stale_consumer.py"],
        symbols: ["MessageBuilder"],
        symbol_positions: [
          { file: "stale_consumer.py", symbol: "MessageBuilder", line: 0, character: 19 },
        ],
        import_tokens: [],
      });
      fs.unlinkSync(path.join(root, "stale_consumer.py"));
      const staleAfter = await structureClient.query({
        op: "analyze",
        root: root.replace(/\\/g, "/"),
        pyrightconfig: path.join(root, "pyrightconfig.json").replace(/\\/g, "/"),
        files: ["shared.py"],
        symbols: ["MessageBuilder"],
        symbol_positions: [
          { file: "shared.py", symbol: "MessageBuilder", line: 0, character: 6 },
        ],
        import_tokens: [],
      });
      check(results, "deleted file is visible before didClose", staleBefore.relations.MessageBuilder.related_files.includes("stale_consumer.py"));
      check(results, "deleted file is removed from the Pyright session", !staleAfter.relations.MessageBuilder.related_files.includes("stale_consumer.py"));

      const unicodeLines = unicodeSource.split(/\r?\n/);
      const unicode = await structureClient.query({
        op: "analyze",
        root: root.replace(/\\/g, "/"),
        pyrightconfig: path.join(root, "pyrightconfig.json").replace(/\\/g, "/"),
        files: ["unicode_shared.py", "unicode_consumer.py"],
        symbols: ["构建器"],
        symbol_positions: [
          { file: "unicode_consumer.py", symbol: "构建器", line: 0, character: unicodeLines[0].indexOf("构建器") },
          { file: "unicode_consumer.py", symbol: "构建器", line: 1, character: unicodeLines[1].indexOf("构建器") },
        ],
        import_tokens: [],
      });
      const unicodeRelation = unicode.relations["构建器"];
      check(results, "CRLF Unicode target keeps its identifier", unicodeRelation.targets.length === 1 && unicodeRelation.targets[0].name === "构建器");
      check(results, "CRLF Unicode references keep exact names", unicodeRelation.references.some(reference => reference.file === "unicode_consumer.py" && reference.name === "构建器"));

      const configPath = path.join(root, "pyrightconfig.json");
      fs.unlinkSync(configPath);
      const withoutConfig = await structureClient.query({
        op: "verify",
        root: root.replace(/\\/g, "/"),
        files: ["consumer.py"],
      });
      write(configPath, JSON.stringify({ include: ["."] }));
      const withConfig = await structureClient.query({
        op: "verify",
        root: root.replace(/\\/g, "/"),
        pyrightconfig: configPath.replace(/\\/g, "/"),
        files: ["consumer.py"],
      });
      fs.unlinkSync(configPath);
      const removedConfig = await structureClient.query({
        op: "verify",
        root: root.replace(/\\/g, "/"),
        files: ["consumer.py"],
      });
      check(results, `config removal rebuilds the Pyright session (${withoutConfig.program_build_count}/${withoutConfig.program_rebuilt}/${withoutConfig.reason || "ok"})`, withoutConfig.program_rebuilt && withoutConfig.program_build_count === 2);
      check(results, `config creation rebuilds the Pyright session (${withConfig.program_build_count}/${withConfig.program_rebuilt}/${withConfig.reason || "ok"})`, withConfig.program_rebuilt && withConfig.program_build_count === 3);
      check(results, `second config removal rebuilds the Pyright session (${removedConfig.program_build_count}/${removedConfig.program_rebuilt}/${removedConfig.reason || "ok"})`, removedConfig.program_rebuilt && removedConfig.program_build_count === 4);
    } finally {
      await structureClient.close();
      fs.rmSync(root, { recursive: true, force: true });
    }

    const missingClient = helper({ ...process.env, PATH: "" });
    try {
      const missing = await missingClient.query({
        op: "verify",
        root: verifyRoot.replace(/\\/g, "/"),
        files: ["type-ok.py"],
      });
      check(results, "missing Pyright is explicit", missing.status === "tool_missing" && missing.verification.missing.includes("pyright"));
    } finally {
      await missingClient.close();
    }

    await runBinarySmoke(results);

    console.log("=== Python Deep Layer Product Smoke ===\n");
    for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}: ${result.name}`);
    if (results.every(result => result.pass)) {
      console.log("\nSMOKE PYTHON: PASS");
    } else {
      console.log("\nSMOKE PYTHON: FAIL");
      process.exitCode = 1;
    }
  } finally {
    fs.writeFileSync(errorFile, original);
    await client.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
