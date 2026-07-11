"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const platformKey = `${process.platform === "win32" ? "win32" : process.platform}-${process.arch}`;
const binaryName = process.platform === "win32" ? "linghun-pre-engine.exe" : "linghun-pre-engine";
const defaultBinary = path.resolve(__dirname, "..", "..", "apps", "cli", "bundled", "pre-engine", platformKey, binaryName);
const binary = path.resolve(process.env.GO_PRE_ENGINE_BINARY || defaultBinary);
const fixtureSource = path.join(__dirname, "fixtures", "smoke-go");
const rounds = Number(process.env.GO_SMOKE_ROUNDS || 3);

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

function commandExists(command) {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  return spawnSync(finder, [command], { stdio: "ignore", windowsHide: true }).status === 0;
}

function normalize(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function textPayload(result) {
  assert(result && result.isError !== true, `tool returned an error: ${JSON.stringify(result)}`);
  const text = result.content && result.content.find(item => item.type === "text");
  assert(text, `tool returned no text payload: ${JSON.stringify(result)}`);
  return JSON.parse(text.text);
}

function objectFiles(values) {
  return (Array.isArray(values) ? values : [])
    .map(value => normalize(typeof value === "string" ? value : value.file || value.path))
    .filter(Boolean);
}

function definitionFiles(payload) {
  return objectFiles([
    ...(Array.isArray(payload.definition_candidates) ? payload.definition_candidates : []),
    ...(payload.definition ? [payload.definition] : []),
  ]);
}

function status(payload) {
  return payload.go_semantic_engine_status || payload.verification?.status || payload.status;
}

class Client {
  constructor(root, env = process.env) {
    this.child = spawn(binary, [], { cwd: __dirname, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
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
    this.ready = this.request("initialize", { rootUri: root }, 30000);
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

  request(method, params, timeoutMs = 60000) {
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
    return textPayload(await this.request("tools/call", { name, arguments: argumentsValue }));
  }

  close() {
    this.child.stdin.end();
    return new Promise(resolve => this.child.once("close", resolve));
  }
}

function assertVerified(payload, operation) {
  assert(status(payload) === "verified", `${operation} degraded: ${JSON.stringify(payload)}`);
}

function assertNoOutsideEvidence(payload, outsideName) {
  const evidence = [payload.definition_candidates, payload.references, payload.callers, payload.callees]
    .flatMap(objectFiles);
  assert(!evidence.some(file => file.includes(normalize(outsideName))), `path boundary leaked outside evidence: ${JSON.stringify(evidence)}`);
}

async function runCoreRound(root, round) {
  const client = new Client(root);
  try {
    const context = await client.tool("pre_context", { symbol: "Resolve", path: "api/service.go" });
    assertVerified(context, `round ${round} context`);
    const targetFiles = definitionFiles(context);
    const referenceFiles = objectFiles(context.references);
    assert(targetFiles.some(file => file.endsWith("api/service.go")), "explicit path missed the requested definition");
    assert(!targetFiles.some(file => file.endsWith("collision/collision.go")), "explicit path captured a same-name definition globally");
    assert(referenceFiles.some(file => file.endsWith("consumer/consumer.go")), "alias cross-file reference missing");
    assert(objectFiles(context.callers).some(file => file.endsWith("consumer/consumer.go")), "caller hierarchy missing");

    const plan = await client.tool("pre_plan", {
      task: "change Resolve contract",
      target_files: ["api/service.go"],
      target_symbols: ["Resolve"],
    });
    assertVerified(plan, `round ${round} plan`);
    const plannedFiles = objectFiles(plan.edit_order);
    assert(plannedFiles.some(file => file.endsWith("api/service.go")), "plan missed definition file");
    assert(plannedFiles.some(file => file.endsWith("consumer/consumer.go")), "plan missed alias consumer");

    const impact = await client.tool("pre_impact", {
      changes: [{ path: "api/service.go", symbols: ["Resolve"] }],
    });
    assertVerified(impact, `round ${round} impact`);
    assert(objectFiles(impact.affected_files).some(file => file.endsWith("consumer/consumer.go")), "impact missed alias consumer");

    const verify = await client.tool("pre_verify", { changed_files: ["type_ok.go", "type_error.go"] });
    assert(verify.go_deep_layer?.status === "verified", `round ${round} verify degraded: ${JSON.stringify(verify.go_deep_layer)}`);
    assert(verify.go_deep_layer?.verification, "verify omitted Go verification evidence");
    assert((verify.issues || []).some(issue => normalize(issue.file).endsWith("type_error.go")), "verify missed Go type error");

    const unicode = await client.tool("pre_context", { symbol: "Hello世界", path: "api/service.go" });
    assertVerified(unicode, `round ${round} Unicode context`);
    assert(objectFiles(unicode.references).some(file => file.includes("unicodepath/调用.go")), "Unicode path/reference missing");
    assert(objectFiles(unicode.callees).some(file => file.endsWith("api/service.go")), "callee hierarchy missing");

    const ambiguous = await client.tool("pre_context", { symbol: "Resolve" });
    assert(status(ambiguous) === "ambiguous" || status(ambiguous) === "partially_verified", "pathless multi-candidate query was not ambiguous");
    const missing = ambiguous.answer_pack?.missing_evidence || [];
    assert((ambiguous.ambiguous_symbols || []).includes("Resolve") || missing.some(value => String(value).includes("ambiguous")), "ambiguous reason missing");
    assert((ambiguous.references || []).length === 0, "ambiguous candidates merged references");
  } finally {
    await client.close();
  }
}

async function runMutationChecks(root) {
  const client = new Client(root);
  try {
    const before = await client.tool("pre_context", { symbol: "Resolve", path: "api/service.go" });
    const snapshot = before.go_semantic_snapshot_id;
    let priorSnapshot = snapshot;
    for (const [file, content] of [["go.mod", "\n// smoke mod refresh\n"], ["go.sum", "\n"], ["go.work", "\n// smoke work refresh\n"]]) {
      fs.appendFileSync(path.join(root, file), content);
      const workspaceChanged = await client.tool("pre_context", { symbol: "Resolve", path: "api/service.go" });
      assertVerified(workspaceChanged, `${file} refresh`);
      assert(workspaceChanged.go_program_rebuilt === true || workspaceChanged.go_semantic_snapshot_id !== priorSnapshot, `${file} change did not refresh the semantic snapshot`);
      priorSnapshot = workspaceChanged.go_semantic_snapshot_id;
    }

    fs.writeFileSync(path.join(root, "api", "added.go"), "package api\n\nfunc Added() string { return Resolve(\"added\") }\n");
    const added = await client.tool("pre_context", { symbol: "Added", path: "api/added.go" });
    assertVerified(added, "added file refresh");

    fs.renameSync(path.join(root, "api", "added.go"), path.join(root, "api", "renamed.go"));
    const renamed = await client.tool("pre_context", { symbol: "Added", path: "api/renamed.go" });
    assertVerified(renamed, "renamed file refresh");
    assert(definitionFiles(renamed).some(file => file.endsWith("api/renamed.go")), "rename retained stale definition path");

    fs.rmSync(path.join(root, "api", "renamed.go"));
    const deleted = await client.tool("pre_context", { symbol: "Added", path: "api/renamed.go" });
    assert(status(deleted) !== "verified" || definitionFiles(deleted).length === 0, "deleted file retained verified stale evidence");

    const outsideName = `outside-${process.pid}.go`;
    fs.writeFileSync(path.join(path.dirname(root), outsideName), "package outside\nfunc Resolve() {}\n");
    try {
      const boundary = await client.tool("pre_context", { symbol: "Resolve", path: `../${outsideName}` });
      assert(status(boundary) !== "verified", "outside-root path was verified");
      assertNoOutsideEvidence(boundary, outsideName);
    } finally {
      fs.rmSync(path.join(path.dirname(root), outsideName), { force: true });
    }
  } finally {
    await client.close();
  }
}

function commandPath(command) {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(finder, [command], { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean) : null;
}

function restrictedPath(extraDirectories = []) {
  const entries = [path.dirname(process.execPath)];
  if (process.platform === "win32") entries.push(path.join(process.env.SystemRoot || "C:\\Windows", "System32"));
  entries.unshift(...extraDirectories);
  return entries.join(path.delimiter);
}

async function runFailureStatusChecks(root) {
  const missingEnvironment = { ...process.env, PATH: restrictedPath() };
  delete missingEnvironment.LINGHUN_GOPLS;
  const missingClient = new Client(root, missingEnvironment);
  try {
    const missing = await missingClient.tool("pre_context", { symbol: "Resolve", path: "api/service.go" });
    assert(status(missing) === "tool_missing", `missing gopls/Go SDK did not return tool_missing: ${JSON.stringify(missing)}`);
  } finally {
    await missingClient.close();
  }

  const fakeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-fake-gopls-"));
  const fakeName = process.platform === "win32" ? "gopls.cmd" : "gopls";
  const fakePath = path.join(fakeDirectory, fakeName);
  fs.writeFileSync(fakePath, process.platform === "win32" ? "@echo invalid-lsp\r\n" : "#!/bin/sh\necho invalid-lsp\n");
  if (process.platform !== "win32") fs.chmodSync(fakePath, 0o755);
  const goPath = commandPath("go");
  assert(goPath, "Go SDK is required for the protocol-failure smoke");
  const protocolClient = new Client(root, {
    ...process.env,
    PATH: restrictedPath([fakeDirectory, path.dirname(goPath)]),
    LINGHUN_GOPLS: fakePath,
  });
  try {
    const partial = await protocolClient.tool("pre_context", { symbol: "Resolve", path: "api/service.go" });
    assert(status(partial) === "partially_verified", `gopls protocol failure did not return partially_verified: ${JSON.stringify(partial)}`);
  } finally {
    await protocolClient.close();
    await removeTree(fakeDirectory);
  }
}

async function run() {
  assert(fs.existsSync(binary), `bundled pre-engine binary missing: ${binary}`);
  assert(Number.isInteger(rounds) && rounds >= 3, "GO_SMOKE_ROUNDS must be at least 3");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-go-smoke-"));
  fs.cpSync(fixtureSource, root, { recursive: true });
  try {
    await runFailureStatusChecks(root);
    if (!commandExists("gopls") || !commandExists("go")) {
      console.log("SMOKE GO: TOOL_MISSING PASS (semantic and bundled gates require gopls + Go SDK)");
      return;
    }
    for (let round = 1; round <= rounds; round += 1) await runCoreRound(root, round);
    await runMutationChecks(root);
    console.log(`SMOKE GO: PASS (${rounds} bundled rounds)`);
  } finally {
    await removeTree(root);
  }
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
