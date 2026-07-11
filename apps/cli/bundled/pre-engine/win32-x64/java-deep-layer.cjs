"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { pathToFileURL, fileURLToPath } = require("url");
const { spawn, spawnSync } = require("child_process");

const REQUEST_TIMEOUT_MS = Number(process.env.LINGHUN_JDTLS_TIMEOUT_MS || 120000);
const STDERR_LIMIT_BYTES = 8192;

function normalize(value) {
  return value.replace(/\\/g, "/");
}

function normalizeUri(uri) {
  if (uri.startsWith("file:")) {
    const file = normalize(path.resolve(fileURLToPath(uri)));
    return process.platform === "win32" ? file.toLowerCase() : file;
  }
  return process.platform === "win32" ? uri.toLowerCase() : uri;
}

function relativeTo(root, file) {
  return normalize(path.relative(root, file));
}

function findCommand(name, configured) {
  if (configured) {
    const candidate = path.resolve(configured);
    return fs.existsSync(candidate) ? candidate : null;
  }
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, [name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0] || null;
}

function findJdk() {
  if (process.env.JAVA_HOME) {
    const candidate = path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java");
    const javac = path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "javac.exe" : "javac");
    if (fs.existsSync(candidate) && fs.existsSync(javac)) return candidate;
  }
  return findCommand("javac", null) ? findCommand("java", process.env.LINGHUN_JAVA) : null;
}

function findJdtls() {
  return findCommand("jdtls", process.env.LINGHUN_JDTLS);
}

function wordAt(text, position) {
  const lines = text.split(/\r?\n/);
  const line = lines[position.line] || "";
  let offset = Math.min(line.length, position.character);
  if (offset > 0 && offset < line.length
      && /[\uDC00-\uDFFF]/.test(line[offset]) && /[\uD800-\uDBFF]/.test(line[offset - 1])) {
    offset -= 1;
  }
  let start = offset;
  let end = offset;
  const identifier = value => /^[\p{ID_Continue}_$]$/u.test(value);
  while (start > 0) {
    let previous = start - 1;
    if (previous > 0 && /[\uDC00-\uDFFF]/.test(line[previous])
        && /[\uD800-\uDBFF]/.test(line[previous - 1])) previous -= 1;
    if (!identifier(line.slice(previous, start))) break;
    start = previous;
  }
  while (end < line.length) {
    const codePoint = String.fromCodePoint(line.codePointAt(end));
    if (!identifier(codePoint)) break;
    end += codePoint.length;
  }
  return line.slice(start, end);
}

function locationUri(location) {
  return location && (location.uri || location.targetUri) || null;
}

function locationRange(location) {
  return location && (location.range || location.targetSelectionRange || location.targetRange) || null;
}

function semanticLocation(root, location, name) {
  const uri = locationUri(location);
  const range = locationRange(location);
  if (!uri || !uri.startsWith("file:") || !range) return null;
  const file = relativeTo(root, fileURLToPath(uri));
  if (file.startsWith("../") || path.isAbsolute(file)) return null;
  return {
    file,
    name,
    line: range.start.line + 1,
    character: range.start.character,
    end_line: range.end.line + 1,
    end_character: range.end.character,
  };
}

function configStamp(root) {
  const names = new Set([
    "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
    "gradle.properties", "gradle-wrapper.properties", "libs.versions.toml", ".classpath", ".project",
    "mvnw", "mvnw.cmd", "jvm.config", "maven.config", "extensions.xml",
  ]);
  const entries = [];
  const visit = directory => {
    let children;
    try { children = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const child of children) {
      if (child.isDirectory()) {
        if ([".git", ".gradle", ".jdtls-data", "target", "build", "node_modules"].includes(child.name)) continue;
        visit(path.join(directory, child.name));
        continue;
      }
      if (!names.has(child.name)) continue;
      const absolute = path.join(directory, child.name);
      const stat = fs.statSync(absolute);
      entries.push(`${relativeTo(root, absolute)}:${stat.mtimeMs}:${stat.size}`);
    }
  };
  visit(root);
  return entries.sort().join("|");
}

class JdtlsSession {
  constructor(root, executable) {
    this.root = path.resolve(root);
    this.executable = executable;
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.documents = new Map();
    this.diagnostics = new Map();
    this.buildCount = 0;
    this.snapshot = 0;
    this.ready = false;
    this.readyWaiters = new Set();
    this.stderr = Buffer.alloc(0);
    this.stderrTruncated = false;
    this.currentConfigStamp = configStamp(this.root);
  }

  appendStderr(chunk) {
    const combined = Buffer.concat([this.stderr, Buffer.from(chunk)]);
    if (combined.length > STDERR_LIMIT_BYTES) {
      this.stderr = combined.subarray(combined.length - STDERR_LIMIT_BYTES);
      this.stderrTruncated = true;
    } else {
      this.stderr = combined;
    }
  }

  exitReason(code, signal) {
    const stderr = this.stderr.toString("utf8").replace(/\s+/gu, " ").trim();
    const suffix = stderr ? ` stderr=${this.stderrTruncated ? "[truncated] " : ""}${stderr}` : " stderr=<empty>";
    return `jdtls exited code=${code == null ? "null" : code} signal=${signal || "null"}${suffix}`;
  }

  async start() {
    const dataDir = path.join(os.tmpdir(), "linghun-jdtls", String(process.pid));
    const isBatch = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(this.executable);
    const command = isBatch ? (process.env.ComSpec || "cmd.exe") : this.executable;
    const args = isBatch
      ? ["/d", "/c", this.executable, "-data", dataDir]
      : ["-data", dataDir];
    const child = spawn(command, args, {
      cwd: this.root,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.stderr = Buffer.alloc(0);
    this.stderrTruncated = false;
    child.stdout.on("data", chunk => this.onData(chunk));
    child.stderr.on("data", chunk => this.appendStderr(chunk));
    child.on("close", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectAll(this.exitReason(code, signal));
    });
    child.on("error", error => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectAll(`jdtls error: ${error.message}`);
    });
    const rootUri = pathToFileURL(this.root + path.sep).href;
    await this.request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.root) }],
      capabilities: {
        window: { workDoneProgress: true },
        workspace: { symbol: { dynamicRegistration: false } },
        textDocument: {
          definition: { dynamicRegistration: false, linkSupport: true },
          references: { dynamicRegistration: false },
          callHierarchy: { dynamicRegistration: false },
          typeHierarchy: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: true, versionSupport: true },
        },
      },
    });
    this.notify("initialized", {});
    this.buildCount += 1;
    await this.waitUntilReady();
    this.currentConfigStamp = configStamp(this.root);
  }

  stop() {
    if (this.child && !this.child.killed) {
      if (process.platform === "win32") {
        spawnSync("taskkill.exe", ["/pid", String(this.child.pid), "/t", "/f"], {
          stdio: "ignore", windowsHide: true,
        });
      } else {
        this.child.kill();
      }
    }
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.documents.clear();
    this.diagnostics.clear();
    this.rejectAll("jdtls stopped");
  }

  rejectAll(message) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error(message));
    }
    this.pending.clear();
    for (const waiter of this.readyWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
    this.readyWaiters.clear();
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString("ascii");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) {
        this.stop();
        return;
      }
      const length = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.slice(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.slice(bodyStart + length);
      try { this.onMessage(JSON.parse(body)); }
      catch (error) { this.stop(); this.rejectAll(`invalid jdtls LSP response: ${error.message}`); return; }
    }
  }

  onMessage(message) {
    if (message.id != null && (message.result !== undefined || message.error)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "jdtls LSP error"));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === "textDocument/publishDiagnostics" && message.params) {
      const uri = normalizeUri(message.params.uri);
      this.diagnostics.set(uri, message.params.diagnostics || []);
      return;
    }
    if (message.method === "language/status" && message.params) {
      const status = String(message.params.type || message.params.message || "").toLowerCase();
      if (status.includes("serviceready") || status.includes("ready")) {
        this.ready = true;
        for (const waiter of this.readyWaiters) {
          clearTimeout(waiter.timer);
          waiter.resolve();
        }
        this.readyWaiters.clear();
      }
      return;
    }
    if (message.id != null && message.method) {
      let result = null;
      if (message.method === "workspace/configuration") {
        result = (message.params && message.params.items || []).map(() => null);
      }
      this.send({ jsonrpc: "2.0", id: message.id, result });
    }
  }

  send(message) {
    if (!this.child || !this.child.stdin.writable) throw new Error("jdtls transport unavailable");
    const body = Buffer.from(JSON.stringify(message), "utf8");
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  request(method, params, timeout = REQUEST_TIMEOUT_MS) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`jdtls LSP ${method} timed out`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  waitUntilReady() {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.readyWaiters.delete(waiter);
        reject(new Error("jdtls workspace readiness timed out"));
      }, REQUEST_TIMEOUT_MS);
      this.readyWaiters.add(waiter);
    });
  }

  async ensureCurrent() {
    const nextStamp = configStamp(this.root);
    if (this.child && nextStamp === this.currentConfigStamp) {
      this.closeDeletedDocuments();
      return false;
    }
    if (this.child) this.stop();
    this.ready = false;
    await this.start();
    this.snapshot += 1;
    return true;
  }

  closeDeletedDocuments() {
    for (const uri of [...this.documents.keys()]) {
      if (fs.existsSync(fileURLToPath(uri))) continue;
      this.notify("textDocument/didClose", { textDocument: { uri } });
      this.documents.delete(uri);
      this.diagnostics.delete(normalizeUri(uri));
      this.snapshot += 1;
    }
  }

  async openFile(file) {
    const absolute = path.resolve(this.root, file);
    const relative = relativeTo(this.root, absolute);
    if (relative.startsWith("../") || path.isAbsolute(relative)) return null;
    if (!fs.existsSync(absolute)) return null;
    const text = fs.readFileSync(absolute, "utf8");
    const stat = fs.statSync(absolute);
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    const uri = pathToFileURL(absolute).href;
    const previous = this.documents.get(uri);
    let synchronized = false;
    if (!previous) {
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "java", version: 1, text },
      });
      this.documents.set(uri, { text, stamp, version: 1 });
      synchronized = true;
    } else if (previous.stamp !== stamp || previous.text !== text) {
      this.diagnostics.delete(normalizeUri(uri));
      const version = previous.version + 1;
      this.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
      this.documents.set(uri, { text, stamp, version });
      this.snapshot += 1;
      synchronized = true;
    }
    return { absolute, uri, text, synchronized };
  }

  async definitions(uri, position) {
    const result = await this.request("textDocument/definition", {
      textDocument: { uri }, position,
    });
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  }

  async resolveTargets(symbol, positions, allowWorkspaceSymbol) {
    const locations = [];
    const origins = [];
    const anchors = positions.filter(position => position.symbol === symbol);
    for (const token of anchors) {
      const document = await this.openFile(token.file);
      if (!document) continue;
      const position = { line: token.line, character: token.character };
      const definitions = await this.definitions(document.uri, position);
      if (definitions.length > 0) origins.push({ uri: document.uri, position, symbol });
      locations.push(...definitions);
    }
    if (allowWorkspaceSymbol && anchors.length === 0) {
      const symbols = await this.request("workspace/symbol", { query: symbol });
      for (const item of symbols || []) {
        if (item.name === symbol && item.location) locations.push(item.location);
      }
    }
    const targets = [];
    const seen = new Set();
    for (const location of locations) {
      const uri = locationUri(location);
      const range = locationRange(location);
      if (!uri || !uri.startsWith("file:") || !range) continue;
      const rel = relativeTo(this.root, fileURLToPath(uri));
      if (rel.startsWith("../") || path.isAbsolute(rel)) continue;
      const document = await this.openFile(rel);
      if (!document) continue;
      const name = wordAt(document.text, range.start) || symbol;
      const key = `${rel}:${range.start.line}:${range.start.character}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ file: rel, name, uri, position: range.start,
        line: range.start.line + 1, character: range.start.character,
        end_line: range.end.line + 1, end_character: range.end.character });
    }
    return { targets, origins };
  }

  async dependencies(files, importTokens) {
    const dependencies = {};
    const metadata = {};
    for (const file of files) {
      const document = await this.openFile(file);
      if (!document) continue;
      const deps = new Set();
      const statements = new Map();
      for (const token of importTokens.filter(item => normalize(item.file) === normalize(file))) {
        if (!statements.has(token.specifier)) statements.set(token.specifier, false);
        const definitions = await this.definitions(document.uri, { line: token.line, character: token.character });
        for (const definition of definitions) {
          const uri = locationUri(definition);
          if (!uri || !uri.startsWith("file:")) continue;
          statements.set(token.specifier, true);
          const rel = relativeTo(this.root, fileURLToPath(uri));
          if (!rel.startsWith("../") && !path.isAbsolute(rel) && rel !== file) deps.add(rel);
        }
      }
      dependencies[file] = [...deps].sort();
      metadata[file] = { unresolved: [...statements].filter(([, resolved]) => !resolved).map(([name]) => name).sort() };
    }
    return { dependencies, metadata };
  }

  async addHierarchy(target, relatedFiles, callers, callees, callerKeys, calleeKeys) {
    const preparedCalls = await this.request("textDocument/prepareCallHierarchy", {
      textDocument: { uri: target.uri }, position: target.position,
    });
    for (const item of preparedCalls || []) {
      for (const call of await this.request("callHierarchy/incomingCalls", { item }) || []) {
        const location = semanticLocation(this.root,
          { uri: call.from.uri, range: call.from.selectionRange || call.from.range }, call.from.name);
        if (!location) continue;
        const key = `${location.file}:${location.line}:${location.character}:${location.name}`;
        if (!callerKeys.has(key)) { callerKeys.add(key); callers.push(location); relatedFiles.add(location.file); }
      }
      for (const call of await this.request("callHierarchy/outgoingCalls", { item }) || []) {
        const location = semanticLocation(this.root,
          { uri: call.to.uri, range: call.to.selectionRange || call.to.range }, call.to.name);
        if (!location) continue;
        const key = `${location.file}:${location.line}:${location.character}:${location.name}`;
        if (!calleeKeys.has(key)) { calleeKeys.add(key); callees.push(location); relatedFiles.add(location.file); }
      }
    }
    const preparedTypes = await this.request("textDocument/prepareTypeHierarchy", {
      textDocument: { uri: target.uri }, position: target.position,
    });
    for (const item of preparedTypes || []) {
      const related = [
        ...await this.request("typeHierarchy/supertypes", { item }) || [],
        ...await this.request("typeHierarchy/subtypes", { item }) || [],
      ];
      for (const type of related) {
        const location = semanticLocation(this.root,
          { uri: type.uri, range: type.selectionRange || type.range }, type.name);
        if (location) relatedFiles.add(location.file);
      }
    }
  }

  async analyze(files, symbols, symbolPositions, importTokens, allowWorkspaceSymbol) {
    const rebuilt = await this.ensureCurrent();
    const normalizedFiles = [...new Set(files.map(file => normalize(file)))];
    for (const file of normalizedFiles) await this.openFile(file);
    const { dependencies, metadata } = await this.dependencies(normalizedFiles, importTokens);
    const relations = {};
    const missing = [];
    for (const symbol of symbols) {
      const { targets, origins } = await this.resolveTargets(symbol, symbolPositions, allowWorkspaceSymbol);
      if (targets.length === 0) missing.push("symbol_anchor");
      if (targets.length > 1) missing.push("ambiguous_symbol_identity");
      const relatedFiles = new Set();
      const namesByFile = {};
      const references = [];
      const callers = [];
      const callees = [];
      const referenceKeys = new Set();
      const callerKeys = new Set();
      const calleeKeys = new Set();
      if (targets.length === 1) {
        const target = targets[0];
        relatedFiles.add(target.file);
        const anchors = [{ uri: target.uri, position: target.position }, ...origins];
        for (const anchor of anchors) {
          const found = await this.request("textDocument/references", {
            textDocument: { uri: anchor.uri }, position: anchor.position,
            context: { includeDeclaration: true },
          });
          for (const reference of found || []) {
            const uri = locationUri(reference);
            const range = locationRange(reference);
            if (!uri || !uri.startsWith("file:") || !range) continue;
            const rel = relativeTo(this.root, fileURLToPath(uri));
            if (rel.startsWith("../") || path.isAbsolute(rel)) continue;
            const document = await this.openFile(rel);
            if (!document) continue;
            const name = wordAt(document.text, range.start);
            const location = semanticLocation(this.root, reference, name || symbol);
            if (!location) continue;
            const key = `${rel}:${location.line}:${location.character}:${location.end_line}:${location.end_character}`;
            if (!referenceKeys.has(key)) { referenceKeys.add(key); references.push(location); }
            relatedFiles.add(rel);
            if (!namesByFile[rel]) namesByFile[rel] = [];
            if (!namesByFile[rel].includes(name || symbol)) namesByFile[rel].push(name || symbol);
          }
        }
        await this.addHierarchy(target, relatedFiles, callers, callees, callerKeys, calleeKeys);
      }
      const unresolved = [...relatedFiles].flatMap(file => metadata[file] ? metadata[file].unresolved : []);
      relations[symbol] = {
        targets: targets.map(({ file, name, line, character, end_line, end_character }) =>
          ({ file, name, line, character, end_line, end_character })),
        names_by_file: namesByFile,
        related_files: [...relatedFiles].sort(),
        references, callers, callees,
        unresolved_module_specifiers: [...new Set(unresolved)].sort(),
        unresolved_relative_specifiers: [], external_module_specifiers: [], blocked_module_specifiers: [],
        dynamic_import_files: [], graph_cycle: false, graph_truncated: false,
      };
    }
    const uniqueMissing = [...new Set(missing)];
    return {
      status: uniqueMissing.length ? "partially_verified" : "verified",
      reason: uniqueMissing.length ? `JDT LS semantic evidence incomplete: ${uniqueMissing.join(",")}` : null,
      resolution: uniqueMissing.includes("ambiguous_symbol_identity") ? "ambiguous" : "resolved",
      relations,
      module_dependencies: dependencies,
      verification: {
        coverage: ["packages", "imports", "symbol_identity", "references", "call_hierarchy", "type_hierarchy", "overloads", "cross_file"],
        missing: uniqueMissing,
      },
      program_build_count: this.buildCount,
      program_rebuilt: rebuilt,
      snapshot_id: String(this.snapshot),
    };
  }

  async discover(terms) {
    const rebuilt = await this.ensureCurrent();
    const candidates = [];
    const seen = new Set();
    for (const term of terms.filter(Boolean)) {
      const symbols = await this.request("workspace/symbol", { query: term });
      for (const item of symbols || []) {
        if (!item.location) continue;
        const location = semanticLocation(this.root, item.location, item.name);
        if (!location) continue;
        const key = `${location.file}:${location.line}:${location.character}:${location.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ ...location, kind: item.kind || 0 });
      }
    }
    return { status: "verified", reason: null, candidates,
      program_build_count: this.buildCount, program_rebuilt: rebuilt, snapshot_id: String(this.snapshot) };
  }

  async verify(files) {
    const rebuilt = await this.ensureCurrent();
    const documents = [];
    for (const file of [...new Set(files.map(normalize))]) {
      const document = await this.openFile(file);
      if (document) documents.push(document);
    }
    if (documents.length === 0) {
      return { status: "partially_verified", reason: "JDT LS verify has no readable Java documents", issues: [],
        verification: { coverage: [], missing: ["java_documents"] },
        program_build_count: this.buildCount, program_rebuilt: rebuilt, snapshot_id: String(this.snapshot) };
    }
    try {
      const diagnosticsByDocument = [];
      for (const document of documents) {
        const uri = normalizeUri(document.uri);
        this.diagnostics.delete(uri);
        const tracked = this.documents.get(document.uri);
        const version = tracked.version + 1;
        this.notify("textDocument/didChange", {
          textDocument: { uri: document.uri, version }, contentChanges: [{ text: document.text }],
        });
        this.documents.set(document.uri, { ...tracked, version });
        this.notify("textDocument/didSave", { textDocument: { uri: document.uri }, text: document.text });
        await this.request("workspace/executeCommand", {
          command: "java.project.refreshDiagnostics",
          arguments: [document.uri, "thisFile", false, true],
        });
        if (!this.diagnostics.has(uri)) {
          throw new Error(`JDT LS diagnostics completion omitted ${relativeTo(this.root, document.absolute)}`);
        }
        diagnosticsByDocument.push(this.diagnostics.get(uri));
      }
      const issues = [];
      const issueKeys = new Set();
      let diagnosticCount = 0;
      diagnosticsByDocument.forEach((diagnostics, index) => {
        const document = documents[index];
        for (const diagnostic of diagnostics) {
          diagnosticCount += 1;
          if (diagnostic.severity !== 1) continue;
          const key = `${document.uri}:${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.message}`;
          if (issueKeys.has(key)) continue;
          issueKeys.add(key);
          issues.push({ file: relativeTo(this.root, document.absolute), line: diagnostic.range.start.line + 1,
            col: diagnostic.range.start.character + 1, kind: "type_error",
            detail: diagnostic.message || "unknown error", source: "java-deep-layer" });
        }
      });
      return { status: "verified", reason: null, issues,
        verification: { coverage: ["syntax", "types", "packages", "imports", "classpath"], missing: [], diagnostic_count: diagnosticCount },
        program_build_count: this.buildCount, program_rebuilt: rebuilt, snapshot_id: String(this.snapshot) };
    } catch (error) {
      return { status: "partially_verified", reason: error.message, issues: [],
        verification: { coverage: [], missing: ["jdtls_diagnostic_completion"] },
        program_build_count: this.buildCount, program_rebuilt: rebuilt, snapshot_id: String(this.snapshot) };
    }
  }
}

let session = null;

async function handle(request) {
  const root = path.resolve(request.root || process.cwd());
  if (!findJdk()) {
    return { status: "tool_missing", reason: "Java tool_missing: JDK java not found; missing=jdk", issues: [],
      relations: {}, module_dependencies: {}, candidates: [], verification: { coverage: [], missing: ["jdk"] },
      program_build_count: 0, program_rebuilt: false, snapshot_id: "0" };
  }
  if (!session || session.root !== root) {
    if (session) session.stop();
    const executable = findJdtls();
    if (!executable) {
      return { status: "tool_missing", reason: "Java tool_missing: Eclipse JDT Language Server not found; missing=jdtls", issues: [],
        relations: {}, module_dependencies: {}, candidates: [], verification: { coverage: [], missing: ["jdtls"] },
        program_build_count: 0, program_rebuilt: false, snapshot_id: "0" };
    }
    session = new JdtlsSession(root, executable);
  }
  if (request.op === "analyze") {
    return session.analyze(request.files || [], request.symbols || [], request.symbol_positions || [],
      request.import_tokens || [], Boolean(request.allow_workspace_symbol));
  }
  if (request.op === "discover") return session.discover(request.terms || []);
  return session.verify(request.files || []);
}

const input = readline.createInterface({ input: process.stdin, terminal: false });
let inputClosed = false;
let activeRequests = 0;
input.on("line", line => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); }
  catch { process.stdout.write(`${JSON.stringify({ status: "partially_verified", reason: "invalid helper request", issues: [] })}\n`); return; }
  activeRequests += 1;
  handle(request).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    if (session) { session.stop(); session = null; }
    process.stdout.write(`${JSON.stringify({ status: "partially_verified", reason: error.message,
      issues: [], relations: {}, module_dependencies: {}, candidates: [], verification: { coverage: [], missing: ["jdtls_protocol"] },
      program_build_count: 0, program_rebuilt: false, snapshot_id: "0" })}\n`);
  }).finally(() => {
    activeRequests -= 1;
    if (inputClosed && activeRequests === 0 && session) session.stop();
  });
});
input.on("close", () => {
  inputClosed = true;
  if (activeRequests === 0 && session) session.stop();
});
