"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const helperPath = path.join(__dirname, "java-deep-layer.cjs");

function defaultBinary() {
  return path.join(__dirname, "target", "debug",
    process.platform === "win32" ? "linghun-pre-engine.exe" : "linghun-pre-engine");
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
    return new Promise(resolve => {
      if (this.child.exitCode != null) { resolve(); return; }
      this.child.once("close", resolve);
      this.child.stdin.end();
    });
  }
}

class PreEngineClient {
  constructor(binary, env) {
    this.child = spawn(binary, [], { cwd: __dirname, env, stdio: ["pipe", "pipe", "inherit"] });
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

  request(method, params, timeout = 120000) {
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

  async initialize(root) {
    await this.request("initialize", { rootUri: root });
  }

  async tool(name, argumentsValue) {
    const result = await this.request("tools/call", { name, arguments: argumentsValue });
    if (!result || result.isError) throw new Error(`${name} failed: ${JSON.stringify(result)}`);
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

function write(root, file, content) {
  const absolute = path.join(root, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

function symbolPositions(file, text, symbol) {
  const positions = [];
  for (const [line, value] of text.split(/\r?\n/).entries()) {
    let offset = 0;
    while ((offset = value.indexOf(symbol, offset)) >= 0) {
      const before = value[offset - 1] || "";
      const after = value[offset + symbol.length] || "";
      if (!/[\p{ID_Continue}_$]/u.test(before) && !/[\p{ID_Continue}_$]/u.test(after)) {
        positions.push({ file, symbol, line, character: offset });
      }
      offset += symbol.length;
    }
  }
  return positions;
}

function importTokens(file, text) {
  const tokens = [];
  for (const [line, value] of text.split(/\r?\n/).entries()) {
    if (!/^\s*(?:package|import)\s+/.test(value)) continue;
    for (const match of value.matchAll(/[\p{ID_Start}_$][\p{ID_Continue}_$]*/gu)) {
      if (["package", "import", "static"].includes(match[0])) continue;
      tokens.push({ file, specifier: value.trim(), line, character: match.index });
    }
  }
  return tokens;
}

function check(results, name, pass, detail = "") {
  results.push({ name, pass: Boolean(pass), detail });
}

async function run() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-java-product-"));
  const root = path.join(base, "Java 空格 # 百分号%");
  fs.mkdirSync(root, { recursive: true });
  const files = {
    "pom.xml": "<project xmlns=\"http://maven.apache.org/POM/4.0.0\"><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>java-smoke</artifactId><version>1.0</version><properties><maven.compiler.release>17</maven.compiler.release></properties></project>\n",
    "src/main/java/demo/Formatter.java": "package demo;\npublic interface Formatter { String format(String value); }\n",
    "src/main/java/demo/Service.java": "package demo;\npublic class Service implements Formatter {\n public String format(String value) { return value.trim(); }\n public String format(int value) { return String.valueOf(value); }\n public String build() { return format(1); }\n}\n",
    "src/main/java/demo/Consumer.java": "package demo;\nimport demo.Service;\npublic class Consumer {\n public String render() { Service service = new Service(); return service.format(\"ok\"); }\n}\n",
    "src/main/java/one/Collision.java": "package one; public class Collision { public void same() {} }\n",
    "src/main/java/two/Collision.java": "package two; public class Collision { public void same() {} }\n",
    "src/main/java/demo/Unicode服务.java": "package demo;\npublic class Unicode服务 { public String 计算(String 值) { return \"😀\" + 值; } }\r\n",
    "src/main/java/demo/Unicode调用.java": "package demo;\r\npublic class Unicode调用 { String 调用() { return new Unicode服务().计算(\"好\"); } }\r\n",
    "src/main/java/demo/TypeError.java": "package demo; public class TypeError { String broken() { return 1; } }\n",
  };
  for (const [file, content] of Object.entries(files)) write(root, file, content);

  const results = [];
  const helper = new LineClient(process.execPath, [helperPath], {
    cwd: __dirname,
    env: process.env,
    stdio: ["pipe", "pipe", "inherit"],
  });
  try {
    const consumerFile = "src/main/java/demo/Consumer.java";
    const consumer = files[consumerFile];
    const format = await helper.query({
      op: "analyze", root, files: [consumerFile], symbols: ["format"],
      symbol_positions: symbolPositions(consumerFile, consumer, "format"),
      import_tokens: importTokens(consumerFile, consumer), allow_workspace_symbol: false,
    });
    const formatRelation = format.relations.format;
    check(results, "definition and overload identity use JDT LS",
      format.status === "verified" && formatRelation.targets.length === 1
        && formatRelation.targets[0].file.endsWith("Service.java"));
    check(results, "cross-file references stay on selected overload",
      formatRelation.references.some(reference => reference.file.endsWith("Consumer.java")));
    check(results, "package/import dependency comes from JDT LS",
      format.module_dependencies[consumerFile].some(file => file.endsWith("Service.java")));

    const service = await helper.query({
      op: "analyze", root, files: [consumerFile], symbols: ["Service"],
      symbol_positions: symbolPositions(consumerFile, consumer, "Service"),
      import_tokens: importTokens(consumerFile, consumer), allow_workspace_symbol: false,
    });
    check(results, "inheritance and interface hierarchy are covered",
      service.status === "verified" && service.relations.Service.related_files.some(file => file.endsWith("Formatter.java")));

    const ambiguous = await helper.query({
      op: "analyze", root, files: [], symbols: ["Collision"], symbol_positions: [], import_tokens: [],
      allow_workspace_symbol: true,
    });
    check(results, "pathless duplicate is ambiguous without merged references",
      ambiguous.status === "partially_verified" && ambiguous.resolution === "ambiguous"
        && ambiguous.relations.Collision.targets.length === 2
        && ambiguous.relations.Collision.references.length === 0);

    const explicitMissing = await helper.query({
      op: "analyze", root, files: [consumerFile], symbols: ["Collision"],
      symbol_positions: [], import_tokens: importTokens(consumerFile, consumer), allow_workspace_symbol: false,
    });
    check(results, "explicit path never captures same-name workspace symbols",
      explicitMissing.status === "partially_verified" && explicitMissing.relations.Collision.targets.length === 0);

    const unicodeFile = "src/main/java/demo/Unicode调用.java";
    const unicode = await helper.query({
      op: "analyze", root, files: [unicodeFile], symbols: ["计算"],
      symbol_positions: symbolPositions(unicodeFile, files[unicodeFile], "计算"),
      import_tokens: importTokens(unicodeFile, files[unicodeFile]), allow_workspace_symbol: false,
    });
    check(results, "Unicode CRLF and escaped path boundaries resolve",
      unicode.status === "verified" && unicode.relations["计算"].targets.length === 1);

    const firstVerify = await helper.query({ op: "verify", root, files: ["src/main/java/demo/TypeError.java"] });
    check(results, "verify reports JDT LS diagnostics",
      firstVerify.status === "verified" && firstVerify.issues.some(issue => issue.source === "java-deep-layer"),
      JSON.stringify(firstVerify));
    write(root, "src/main/java/demo/TypeError.java", "package demo; public class TypeError { String fixed() { return \"ok\"; } }\n");
    const fixedVerify = await helper.query({ op: "verify", root, files: ["src/main/java/demo/TypeError.java"] });
    check(results, "didChange clears stale diagnostics",
      fixedVerify.status === "verified" && fixedVerify.issues.length === 0 && fixedVerify.program_build_count === 1,
      JSON.stringify(fixedVerify));

    write(root, "pom.xml", files["pom.xml"].replace("</properties>", "<project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>"));
    const configVerify = await helper.query({ op: "verify", root, files: ["src/main/java/demo/TypeError.java"] });
    check(results, "Maven configuration change rebuilds the JDT workspace",
      configVerify.status === "verified" && configVerify.program_rebuilt && configVerify.program_build_count === 2,
      JSON.stringify(configVerify));
    write(root, "gradle.properties", "org.gradle.daemon=false\n");
    const gradleVerify = await helper.query({ op: "verify", root, files: ["src/main/java/demo/TypeError.java"] });
    check(results, "Gradle configuration addition rebuilds the JDT workspace",
      gradleVerify.status === "verified" && gradleVerify.program_rebuilt && gradleVerify.program_build_count === 3,
      JSON.stringify(gradleVerify));

    write(root, "src/main/java/demo/Added.java", "package demo; public class Added { public String added() { return \"ok\"; } }\n");
    const added = await helper.query({
      op: "analyze", root, files: ["src/main/java/demo/Added.java"], symbols: ["Added"],
      symbol_positions: symbolPositions("src/main/java/demo/Added.java", "package demo; public class Added { public String added() { return \"ok\"; } }\n", "Added"),
      import_tokens: [], allow_workspace_symbol: false,
    });
    check(results, "added file enters the same semantic session", added.status === "verified");
    fs.renameSync(path.join(root, "src/main/java/demo/Added.java"), path.join(root, "src/main/java/demo/Renamed.java"));
    write(root, "src/main/java/demo/Renamed.java", "package demo; public class Renamed { public String renamed() { return \"ok\"; } }\n");
    const renamed = await helper.query({
      op: "analyze", root, files: ["src/main/java/demo/Renamed.java"], symbols: ["Renamed"],
      symbol_positions: symbolPositions("src/main/java/demo/Renamed.java", "package demo; public class Renamed { public String renamed() { return \"ok\"; } }\n", "Renamed"),
      import_tokens: [], allow_workspace_symbol: false,
    });
    check(results, "rename closes the old URI and resolves the new file", renamed.status === "verified");
  } finally {
    await helper.close();
  }

  const binary = process.env.LINGHUN_PRE_ENGINE_BINARY || defaultBinary();
  if (fs.existsSync(binary) && !process.env.JAVA_SMOKE_HELPER_ONLY) {
    const client = new PreEngineClient(binary, process.env);
    try {
      await client.initialize(root);
      const context = await client.tool("pre_context", { symbol: "format", path: "src/main/java/demo/Consumer.java" });
      const plan = await client.tool("pre_plan", { task: "change format", target_files: ["src/main/java/demo/Consumer.java"], target_symbols: ["format"] });
      const impact = await client.tool("pre_impact", { changes: [{ path: "src/main/java/demo/Consumer.java", symbols: ["format"] }] });
      const verify = await client.tool("pre_verify", { changed_files: ["src/main/java/demo/TypeError.java"] });
      check(results, "pre_context Java semantic closure", context.java_semantic_engine_status === "verified");
      check(results, "pre_plan Java semantic closure", plan.java_semantic_engine_status === "verified");
      check(results, "pre_impact Java semantic closure", impact.java_semantic_engine_status === "verified");
      check(results, "pre_verify Java semantic closure",
        verify.java_deep_layer.status === "verified" && verify.verification.status === "verified",
        JSON.stringify({ java: verify.java_deep_layer, verification: verify.verification, issues: verify.issues }));
      const pathless = await client.tool("pre_context", { symbol: "Collision" });
      check(results, "pre_context exposes pathless ambiguity", pathless.status === "ambiguous");
      const deletedContext = await client.tool("pre_context", {
        symbol: "Added", path: "src/main/java/demo/Added.java",
      });
      const deletedPlan = await client.tool("pre_plan", {
        task: "remove Added", target_files: ["src/main/java/demo/Added.java"], target_symbols: ["Added"],
      });
      const deletedImpact = await client.tool("pre_impact", {
        changes: [{ path: "src/main/java/demo/Added.java", symbols: ["Added"] }],
      });
      check(results, "deleted explicit paths remain partially verified across context plan impact",
        deletedContext.java_semantic_engine_status === "partially_verified"
          && deletedPlan.java_semantic_engine_status === "partially_verified"
          && deletedImpact.java_semantic_engine_status === "partially_verified");
    } finally {
      await client.close();
    }
  } else if (!process.env.JAVA_SMOKE_HELPER_ONLY) {
    check(results, "pre-engine binary exists", false, binary);
  }

  for (const result of results) {
    console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}${result.detail ? `: ${result.detail}` : ""}`);
  }
  const failed = results.filter(result => !result.pass);
  console.log(JSON.stringify({ root, passed: results.length - failed.length, failed: failed.length }, null, 2));
  if (failed.length) process.exitCode = 1;
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
