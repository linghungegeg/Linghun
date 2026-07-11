"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const platformKey = `${process.platform === "win32" ? "win32" : process.platform}-${process.arch}`;
const binaryName = process.platform === "win32" ? "linghun-pre-engine.exe" : "linghun-pre-engine";
const defaultBinary = path.resolve(__dirname, "..", "..", "apps", "cli", "bundled", "pre-engine", platformKey, binaryName);
const configuredBinary = process.env.LINGHUN_PRE_ENGINE_BINARY || process.env.GO_PRE_ENGINE_BINARY;
const binary = path.resolve(configuredBinary || defaultBinary);
const requireBinary = process.argv.includes("--require-binary");
const helper = path.join(__dirname, "go-deep-layer.cjs");
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

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function createDependencyFixtures(root) {
  write(path.join(root, "short", "leaf", "leaf.go"), "package leaf\n\nfunc Value() string { return \"leaf\" }\n");
  write(path.join(root, "short", "mid", "mid.go"), [
    "package mid",
    "",
    'import "example.com/smokego/short/leaf"',
    "",
    "func Value() string { return leaf.Value() }",
    "",
  ].join("\n"));
  write(path.join(root, "short", "entry", "entry.go"), [
    "package entry",
    "",
    'import "example.com/smokego/short/mid"',
    "",
    "func Entry() string { return mid.Value() }",
    "",
  ].join("\n"));
  for (let index = 0; index < 20; index += 1) {
    const current = String(index).padStart(2, "0");
    const previous = String(index - 1).padStart(2, "0");
    const body = index === 0
      ? "func Deep00() int { return 0 }\n"
      : `import "example.com/smokego/deep/p${previous}"\n\nfunc Deep${current}() int { return p${previous}.Deep${previous}() + 1 }\n`;
    write(path.join(root, "deep", `p${current}`, `p${current}.go`), `package p${current}\n\n${body}`);
  }
}

class HelperClient {
  constructor(env = process.env) {
    this.child = spawn(process.execPath, [helper], {
      cwd: __dirname, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    this.buffer = "";
    this.stderr = "";
    this.pending = [];
    this.closed = false;
    this.child.stdout.on("data", chunk => this.onData(chunk));
    this.child.stderr.on("data", chunk => { this.stderr += chunk.toString(); });
    this.child.once("close", () => { this.closed = true; });
    this.child.on("exit", (code, signal) => {
      for (const pending of this.pending.splice(0)) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Go helper exited code=${code} signal=${signal}: ${this.stderr}`));
      }
    });
  }

  onData(chunk) {
    this.buffer += chunk.toString();
    for (let newline; (newline = this.buffer.indexOf("\n")) >= 0;) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      const pending = this.pending.shift();
      if (!pending) continue;
      clearTimeout(pending.timer);
      pending.resolve(JSON.parse(line));
    }
  }

  request(value, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Go helper timed out after ${timeoutMs}ms`)), timeoutMs);
      this.pending.push({ resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify(value)}\n`);
    });
  }

  close() {
    if (this.closed || this.child.exitCode !== null || this.child.signalCode !== null) return Promise.resolve();
    return new Promise(resolve => {
      this.child.once("close", resolve);
      this.child.stdin.end();
    });
  }
}

class Client {
  constructor(root, env = process.env) {
    this.child = spawn(binary, [], { cwd: __dirname, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.buffer = "";
    this.stderr = "";
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.child.stdout.on("data", chunk => this.onData(chunk));
    this.child.stderr.on("data", chunk => { this.stderr += chunk.toString(); });
    this.child.once("close", () => { this.closed = true; });
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
    if (this.closed || this.child.exitCode !== null || this.child.signalCode !== null) return Promise.resolve();
    return new Promise(resolve => {
      this.child.once("close", resolve);
      this.child.stdin.end();
    });
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

    const shortPlan = await client.tool("pre_plan", {
      task: "change short dependency entry",
      target_files: ["short/entry/entry.go"],
      target_symbols: ["Entry"],
    });
    assertVerified(shortPlan, `round ${round} short dependency plan`);
    assert(shortPlan.module_graph_truncated === false, "short dependency graph was unexpectedly truncated");
    const shortOrder = objectFiles(shortPlan.edit_order);
    const leafIndex = shortOrder.findIndex(file => file.endsWith("short/leaf/leaf.go"));
    const midIndex = shortOrder.findIndex(file => file.endsWith("short/mid/mid.go"));
    const entryIndex = shortOrder.findIndex(file => file.endsWith("short/entry/entry.go"));
    assert(leafIndex >= 0 && midIndex > leafIndex && entryIndex > midIndex,
      `short dependency closure/order incorrect: ${JSON.stringify(shortPlan.edit_order)}`);
    assert(shortPlan.total_files === 3, `short dependency closure included unrelated files: ${shortPlan.total_files}`);

    const deepPlan = await client.tool("pre_plan", {
      task: "change deep dependency entry",
      target_files: ["deep/p19/p19.go"],
      target_symbols: ["Deep19"],
    });
    assert(deepPlan.module_graph_truncated === true, "deep dependency graph did not report truncation");
    assert((deepPlan.answer_pack?.missing_evidence || []).includes("module_graph_truncated"),
      `deep dependency truncation evidence missing: ${JSON.stringify(deepPlan.answer_pack)}`);

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

function createFakeGoplsExecutable(directory) {
  const executable = path.join(directory, process.platform === "win32" ? "gopls.exe" : "gopls");
  if (process.platform === "win32") {
    fs.copyFileSync(process.execPath, executable);
  } else {
    write(executable, `#!/bin/sh\nexec \"${process.execPath}\" \"$1\"\n`);
    fs.chmodSync(executable, 0o755);
  }
  return executable;
}

function writeFakeGoplsServe(root, mode) {
  const script = path.join(root, "serve");
  write(script, [
    '"use strict";',
    `const mode = ${JSON.stringify(mode)};`,
    'if (mode === "exit") process.exit(7);',
    'if (mode === "protocol") {',
    '  process.stdin.once("data", () => process.stdout.write("Content-Length: 1\\r\\n\\r\\n{"));',
    '} else {',
    'let buffer = Buffer.alloc(0);',
    'process.stdin.on("data", chunk => {',
    '  buffer = Buffer.concat([buffer, chunk]);',
    '  for (;;) {',
    '    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");',
    '    if (headerEnd < 0) return;',
    '    const header = buffer.subarray(0, headerEnd).toString();',
    '    const match = /Content-Length:\\s*(\\d+)/i.exec(header);',
    '    if (!match) process.exit(2);',
    '    const length = Number(match[1]);',
    '    if (buffer.length < headerEnd + 4 + length) return;',
    '    const message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString());',
    '    buffer = buffer.subarray(headerEnd + 4 + length);',
    '    if (message.id === undefined) continue;',
    '    if (message.method === "textDocument/diagnostic" && mode === "timeout") continue;',
    '    let result = null;',
    '    if (message.method === "initialize") result = { capabilities: { diagnosticProvider: true } };',
    '    else if (message.method === "textDocument/diagnostic") result = mode === "complete" ? { kind: "full", items: [] } : {};',
    '    else if (["textDocument/definition", "textDocument/references", "textDocument/prepareCallHierarchy", "callHierarchy/incomingCalls", "callHierarchy/outgoingCalls", "workspace/symbol"].includes(message.method)) result = [];',
    '    const body = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });',
    '    process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}`);',
    '  }',
    '});',
    '}',
    "",
  ].join("\n"));
}

async function assertDiagnosticContract(root, goPath, fakeDirectory, fakePath, mode, expectedStatus) {
  writeFakeGoplsServe(root, mode);
  const environment = {
    ...process.env,
    PATH: restrictedPath([fakeDirectory, path.dirname(goPath)]),
    LINGHUN_GOPLS: fakePath,
    LINGHUN_GOPLS_DIAGNOSTIC_TIMEOUT_MS: "500",
  };
  const helperClient = new HelperClient(environment);
  const cliClient = new Client(root, environment);
  try {
    const [helperResult, cliResult] = await Promise.all([
      helperClient.request({ op: "verify", root, files: ["type_ok.go"] }, 5000),
      cliClient.tool("pre_verify", { changed_files: ["type_ok.go"] }),
    ]);
    assert(status(helperResult) === expectedStatus,
      `helper ${mode} diagnostic status incorrect: ${JSON.stringify(helperResult)}`);
    assert(cliResult.go_deep_layer?.status === expectedStatus,
      `CLI ${mode} diagnostic status incorrect: ${JSON.stringify(cliResult.go_deep_layer)}`);
    if (expectedStatus === "verified") {
      assert(helperResult.verification?.diagnostic_count === 0, "helper complete empty diagnostics omitted response evidence");
      assert(cliResult.go_deep_layer?.verification?.diagnostic_count === 0, "CLI complete empty diagnostics omitted response evidence");
    } else {
      assert((helperResult.verification?.missing || []).includes("gopls_diagnostics"),
        `helper ${mode} diagnostics omitted missing evidence`);
      assert((cliResult.go_deep_layer?.verification?.missing || []).includes("gopls_diagnostics"),
        `CLI ${mode} diagnostics omitted missing evidence`);
    }
  } finally {
    await Promise.all([helperClient.close(), cliClient.close()]);
  }
}

async function assertMissingToolContract(root, environment, expectedMissing) {
  const helperClient = new HelperClient(environment);
  const cliClient = new Client(root, environment);
  try {
    const [helperResult, cliResult] = await Promise.all([
      helperClient.request({ op: "analyze", root, files: ["api/service.go"], symbols: ["Resolve"] }),
      cliClient.tool("pre_context", { symbol: "Resolve", path: "api/service.go" }),
    ]);
    assert(status(helperResult) === "tool_missing", `helper missing ${expectedMissing} status incorrect: ${JSON.stringify(helperResult)}`);
    assert((helperResult.verification?.missing || []).includes(expectedMissing),
      `helper missing ${expectedMissing} evidence omitted`);
    assert(status(cliResult) === "tool_missing", `CLI missing ${expectedMissing} status incorrect: ${JSON.stringify(cliResult)}`);
    assert(String(cliResult.go_semantic_engine_reason || "").includes(expectedMissing),
      `CLI missing ${expectedMissing} reason omitted: ${JSON.stringify(cliResult)}`);
  } finally {
    await Promise.all([helperClient.close(), cliClient.close()]);
  }
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

  const missingHelper = new HelperClient(missingEnvironment);
  try {
    const missing = await missingHelper.request({ op: "analyze", root, files: ["api/service.go"], symbols: ["Resolve"] });
    assert(status(missing) === "tool_missing", `helper missing gopls/Go SDK did not return tool_missing: ${JSON.stringify(missing)}`);
  } finally {
    await missingHelper.close();
  }

  const goPath = commandPath("go");
  assert(goPath, "Go SDK is required for the protocol-failure smoke");
  const goplsPath = commandPath("gopls");
  if (goplsPath) {
    const missingGoplsEnvironment = {
      ...process.env,
      PATH: restrictedPath([path.dirname(goPath)]),
    };
    delete missingGoplsEnvironment.LINGHUN_GOPLS;
    await assertMissingToolContract(root, missingGoplsEnvironment, "gopls");
    await assertMissingToolContract(root, {
      ...process.env,
      PATH: restrictedPath([path.dirname(goplsPath)]),
      LINGHUN_GOPLS: goplsPath,
    }, "go");
  }
  const fakeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-fake-gopls-"));
  const fakePath = createFakeGoplsExecutable(fakeDirectory);
  try {
    writeFakeGoplsServe(root, "protocol");
    const protocolClient = new Client(root, {
      ...process.env,
      PATH: restrictedPath([fakeDirectory, path.dirname(goPath)]),
      LINGHUN_GOPLS: fakePath,
    });
    const protocolHelper = new HelperClient({
      ...process.env,
      PATH: restrictedPath([fakeDirectory, path.dirname(goPath)]),
      LINGHUN_GOPLS: fakePath,
    });
    try {
      const [cliPartial, helperPartial] = await Promise.all([
        protocolClient.tool("pre_context", { symbol: "Resolve", path: "api/service.go" }),
        protocolHelper.request({ op: "analyze", root, files: ["api/service.go"], symbols: ["Resolve"] }),
      ]);
      assert(status(cliPartial) === "partially_verified", `CLI gopls protocol failure did not return partially_verified: ${JSON.stringify(cliPartial)}`);
      assert(status(helperPartial) === "partially_verified", `helper gopls protocol failure did not return partially_verified: ${JSON.stringify(helperPartial)}`);
    } finally {
      await Promise.all([protocolClient.close(), protocolHelper.close()]);
    }

    writeFakeGoplsServe(root, "exit");
    const exitEnvironment = {
      ...process.env,
      PATH: restrictedPath([fakeDirectory, path.dirname(goPath)]),
      LINGHUN_GOPLS: fakePath,
    };
    const exitHelper = new HelperClient(exitEnvironment);
    const exitClient = new Client(root, exitEnvironment);
    try {
      const [helperPartial, cliPartial] = await Promise.all([
        exitHelper.request({ op: "analyze", root, files: ["api/service.go"], symbols: ["Resolve"] }),
        exitClient.tool("pre_context", { symbol: "Resolve", path: "api/service.go" }),
      ]);
      assert(status(helperPartial) === "partially_verified", `helper gopls exit did not degrade: ${JSON.stringify(helperPartial)}`);
      assert(status(cliPartial) === "partially_verified", `CLI gopls exit did not degrade: ${JSON.stringify(cliPartial)}`);
    } finally {
      await Promise.all([exitHelper.close(), exitClient.close()]);
    }

    await assertDiagnosticContract(root, goPath, fakeDirectory, fakePath, "incomplete", "partially_verified");
    await assertDiagnosticContract(root, goPath, fakeDirectory, fakePath, "timeout", "partially_verified");
    await assertDiagnosticContract(root, goPath, fakeDirectory, fakePath, "complete", "verified");
  } finally {
    fs.rmSync(path.join(root, "serve"), { force: true });
    await removeTree(fakeDirectory);
  }
}

async function runNoDocumentChecks(root) {
  const helperClient = new HelperClient();
  const cliClient = new Client(root);
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-go-empty-"));
  let emptyCliClient;
  try {
    const [helperResult, cliResult] = await Promise.all([
      helperClient.request({ op: "verify", root, files: ["missing.go"] }),
      cliClient.tool("pre_verify", { changed_files: ["missing.go"] }),
    ]);
    assert(status(helperResult) === "partially_verified", `helper no-document status incorrect: ${JSON.stringify(helperResult)}`);
    assert((helperResult.verification?.missing || []).includes("go_documents"), "helper no-document missing evidence omitted go_documents");
    assert(cliResult.go_deep_layer?.status === "partially_verified", `CLI no-document status incorrect: ${JSON.stringify(cliResult.go_deep_layer)}`);
    assert((cliResult.go_deep_layer?.verification?.missing || []).includes("go_documents"), "CLI no-document missing evidence omitted go_documents");
    emptyCliClient = new Client(emptyRoot);
    const [emptyVerify, emptyAnalyze, emptyDiscovery, emptyCliVerify] = await Promise.all([
      helperClient.request({ op: "verify", root: emptyRoot, files: [] }),
      helperClient.request({ op: "analyze", root: emptyRoot, files: [], symbols: ["Resolve"] }),
      helperClient.request({ op: "discover", root: emptyRoot, terms: ["Resolve"] }),
      emptyCliClient.tool("pre_verify", { changed_files: ["missing.go"] }),
    ]);
    await emptyCliClient.close();
    emptyCliClient = null;
    for (const result of [emptyVerify, emptyAnalyze, emptyDiscovery]) {
      assert(status(result) === "partially_verified", `helper empty Go document request was not partial: ${JSON.stringify(result)}`);
      assert((result.verification?.missing || []).includes("go_documents"), "helper empty Go document request omitted go_documents");
    }
    assert(emptyCliVerify.go_deep_layer?.status === "partially_verified", `CLI empty workspace verify was not partial: ${JSON.stringify(emptyCliVerify)}`);
    assert((emptyCliVerify.go_deep_layer?.verification?.missing || []).includes("go_documents"), "CLI empty workspace verify omitted go_documents");
  } finally {
    await Promise.all([helperClient.close(), cliClient.close(), emptyCliClient?.close()]);
    await removeTree(emptyRoot);
  }
}

async function run() {
  assert(!requireBinary || configuredBinary,
    "--require-binary requires LINGHUN_PRE_ENGINE_BINARY or GO_PRE_ENGINE_BINARY");
  assert(fs.existsSync(binary), `bundled pre-engine binary missing: ${binary}`);
  assert(Number.isInteger(rounds) && rounds >= 3, "GO_SMOKE_ROUNDS must be at least 3");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-go-smoke-"));
  fs.cpSync(fixtureSource, root, { recursive: true });
  createDependencyFixtures(root);
  try {
    await runFailureStatusChecks(root);
    if (!commandExists("gopls") || !commandExists("go")) {
      console.log("SMOKE GO: TOOL_MISSING PASS (semantic and bundled gates require gopls + Go SDK)");
      return;
    }
    await runNoDocumentChecks(root);
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
