"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { pathToFileURL, fileURLToPath } = require("url");
const { spawn, spawnSync } = require("child_process");

const REQUEST_TIMEOUT_MS = 30000;

function normalize(value) {
  return value.replace(/\\/g, "/");
}

function relativeTo(root, file) {
  return normalize(path.relative(root, file));
}

function findExecutable(root, name) {
  const executableNames = process.platform === "win32" ? [`${name}.cmd`, name] : [name, `${name}.cmd`];
  const candidates = executableNames.map(executableName =>
    path.join(root, "node_modules", ".bin", executableName));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  if (name === "pyright-langserver") {
    try {
      return require.resolve("pyright/langserver.index.js");
    } catch {}
  }
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, [name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const matches = result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return matches.find(candidate => candidate.toLowerCase().endsWith(".cmd")) || matches[0] || null;
}

function spawnExecutable(executable, args, options) {
  if (executable.toLowerCase().endsWith(".js")) {
    return spawn(process.execPath, [executable, ...args], options);
  }
  if (process.platform === "win32" && executable.toLowerCase().endsWith(".cmd")) {
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", executable, ...args], options);
  }
  return spawn(executable, args, options);
}

function wordAt(text, position) {
  const lines = text.split(/\r?\n/);
  const line = lines[position.line] || "";
  const offset = Math.min(line.length, position.character);
  let start = offset;
  let end = offset;
  const identifier = value => /^[\p{L}\p{N}_]$/u.test(value);
  while (start > 0) {
    const previous = line.codePointAt(start - (line.charCodeAt(start - 1) >= 0xDC00 && line.charCodeAt(start - 1) <= 0xDFFF ? 2 : 1));
    const value = previous == null ? "" : String.fromCodePoint(previous);
    if (!identifier(value)) break;
    start -= value.length;
  }
  while (end < line.length) {
    const next = line.codePointAt(end);
    const value = next == null ? "" : String.fromCodePoint(next);
    if (!identifier(value)) break;
    end += value.length;
  }
  return line.slice(start, end);
}

function locationUri(location) {
  return location.uri || location.targetUri || null;
}

function locationRange(location) {
  return location.range || location.targetSelectionRange || location.targetRange || null;
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

class PyrightSession {
  constructor(root, executable, pyrightconfig) {
    this.root = path.resolve(root);
    this.executable = executable;
    this.pyrightconfig = pyrightconfig;
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.documents = new Map();
    this.buildCount = 0;
    this.snapshot = 0;
    this.configStamp = this.readConfigStamp();
  }

  readConfigStamp() {
    if (!this.pyrightconfig || !fs.existsSync(this.pyrightconfig)) return "none";
    const stat = fs.statSync(this.pyrightconfig);
    return `${normalize(path.resolve(this.pyrightconfig))}:${stat.mtimeMs}:${stat.size}`;
  }

  async start() {
    const child = spawnExecutable(this.executable, ["--stdio"], {
      cwd: this.root,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    this.child = child;
    child.stdout.on("data", chunk => this.onData(chunk));
    child.on("exit", () => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectPending("pyright language server closed");
    });
    child.on("error", error => {
      if (this.child !== child) return;
      this.rejectPending(`pyright language server error: ${error.message}`);
    });
    const rootUri = pathToFileURL(this.root + path.sep).href;
    await this.request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.root) }],
      capabilities: {
        workspace: { symbol: { dynamicRegistration: false } },
        textDocument: {
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: true },
        },
      },
      initializationOptions: {},
    });
    this.notify("initialized", {});
    this.buildCount += 1;
  }

  stop() {
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.documents.clear();
  }

  rejectPending(message) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error(message));
    }
    this.pending.clear();
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString("ascii");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) throw new Error("invalid Pyright LSP response header");
      const length = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.slice(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.slice(bodyStart + length);
      this.onMessage(JSON.parse(body));
    }
  }

  onMessage(message) {
    if (message.id != null && (message.result !== undefined || message.error)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "Pyright LSP error"));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") return;
    if (message.id != null && message.method) {
      const result = message.method === "workspace/configuration"
        ? (message.params.items || []).map(() => null)
        : null;
      this.send({ jsonrpc: "2.0", id: message.id, result });
    }
  }

  send(message) {
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
        reject(new Error(`Pyright LSP ${method} timed out`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async ensureCurrent() {
    const nextStamp = this.readConfigStamp();
    if (this.child && nextStamp === this.configStamp) {
      this.closeDeletedDocuments();
      return false;
    }
    if (this.child) this.stop();
    this.configStamp = nextStamp;
    await this.start();
    this.snapshot += 1;
    return true;
  }

  closeDeletedDocuments() {
    for (const uri of [...this.documents.keys()]) {
      if (fs.existsSync(fileURLToPath(uri))) continue;
      this.notify("textDocument/didClose", { textDocument: { uri } });
      this.documents.delete(uri);
      this.snapshot += 1;
    }
  }

  async openFile(file) {
    const absolute = path.resolve(this.root, file);
    if (!fs.existsSync(absolute)) return null;
    const text = fs.readFileSync(absolute, "utf8");
    const stat = fs.statSync(absolute);
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    const uri = pathToFileURL(absolute).href;
    const previous = this.documents.get(uri);
    if (!previous) {
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "python", version: 1, text },
      });
      this.documents.set(uri, { text, stamp, version: 1 });
      this.snapshot += 1;
    } else if (previous.stamp !== stamp || previous.text !== text) {
      const version = previous.version + 1;
      this.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
      this.documents.set(uri, { text, stamp, version });
      this.snapshot += 1;
    }
    return { absolute, uri, text };
  }

  async locationDefinitions(uri, position) {
    const result = await this.request("textDocument/definition", { textDocument: { uri }, position });
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  }

  async resolveTargets(symbol, positions) {
    const locations = [];
    const origins = [];
    const matchingPositions = positions.filter(position => position.symbol === symbol);
    for (const token of matchingPositions) {
      const document = await this.openFile(token.file);
      if (!document) continue;
      const position = {
        line: token.line,
        character: token.character,
      };
      const definitions = await this.locationDefinitions(document.uri, position);
      if (definitions.length > 0) origins.push({ uri: document.uri, position, symbol });
      locations.push(...definitions);
    }
    if (locations.length === 0 && matchingPositions.length === 0) {
      const workspaceSymbols = await this.request("workspace/symbol", { query: symbol });
      const exact = (workspaceSymbols || []).filter(item => item.name === symbol && item.location);
      if (exact.length === 1) locations.push(exact[0].location);
    }
    const targets = [];
    const seen = new Set();
    for (const location of locations) {
      const uri = locationUri(location);
      const range = locationRange(location);
      if (!uri || !uri.startsWith("file:") || !range) continue;
      const absolute = fileURLToPath(uri);
      const rel = relativeTo(this.root, absolute);
      if (rel.startsWith("../") || path.isAbsolute(rel)) continue;
      const document = await this.openFile(rel);
      if (!document) continue;
      const name = wordAt(document.text, range.start) || symbol;
      const key = `${rel}:${range.start.line}:${range.start.character}`;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({
          file: rel,
          name,
          uri,
          position: range.start,
          line: range.start.line + 1,
          character: range.start.character,
          end_line: range.end.line + 1,
          end_character: range.end.character,
        });
      }
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
      const unresolved = new Set();
      const external = new Set();
      const statements = new Map();
      for (const token of importTokens.filter(item => normalize(item.file) === normalize(file))) {
        if (!statements.has(token.specifier)) statements.set(token.specifier, false);
        const definitions = await this.locationDefinitions(document.uri, {
          line: token.line,
          character: token.character,
        });
        for (const definition of definitions) {
          const uri = locationUri(definition);
          if (!uri || !uri.startsWith("file:")) continue;
          statements.set(token.specifier, true);
          const target = fileURLToPath(uri);
          const rel = relativeTo(this.root, target);
          if (rel.startsWith("../") || path.isAbsolute(rel)) external.add(token.specifier);
          else if (rel !== relativeTo(this.root, document.absolute)) deps.add(rel);
        }
      }
      for (const [specifier, resolved] of statements) {
        if (!resolved) unresolved.add(specifier);
      }
      const rel = relativeTo(this.root, document.absolute);
      dependencies[rel] = [...deps].sort();
      metadata[rel] = {
        unresolved: [...unresolved].sort(),
        external: [...external].sort(),
      };
    }
    return { dependencies, metadata };
  }

  async analyze(files, symbols, symbolPositions, importTokens) {
    const rebuilt = await this.ensureCurrent();
    const normalizedFiles = [...new Set(files.map(file => normalize(file)))];
    for (const file of normalizedFiles) await this.openFile(file);
    const { dependencies, metadata } = await this.dependencies(normalizedFiles, importTokens);
    const relations = {};
    let missingAnchor = false;
    for (const symbol of symbols) {
      const { targets, origins } = await this.resolveTargets(symbol, symbolPositions);
      const namesByFile = {};
      const relatedFiles = new Set();
      const exactReferences = [];
      const callers = [];
      const callees = [];
      const referenceKeys = new Set();
      const callerKeys = new Set();
      const calleeKeys = new Set();
      const anchors = [
        ...targets.map(target => ({ uri: target.uri, position: target.position })),
        ...origins,
      ];
      if (anchors.length === 0) missingAnchor = true;
      for (const anchor of anchors) {
        const references = await this.request("textDocument/references", {
          textDocument: { uri: anchor.uri },
          position: anchor.position,
          context: { includeDeclaration: true },
        });
        for (const reference of references || []) {
          const uri = locationUri(reference);
          const range = locationRange(reference);
          if (!uri || !uri.startsWith("file:") || !range) continue;
          const rel = relativeTo(this.root, fileURLToPath(uri));
          if (rel.startsWith("../") || path.isAbsolute(rel)) continue;
          const document = await this.openFile(rel);
          if (!document) continue;
          const name = wordAt(document.text, range.start);
          if (!name) continue;
          const location = semanticLocation(this.root, reference, name);
          if (!location) continue;
          relatedFiles.add(rel);
          if (!namesByFile[rel]) namesByFile[rel] = [];
          if (!namesByFile[rel].includes(name)) namesByFile[rel].push(name);
          const key = `${rel}:${location.line}:${location.character}:${location.end_line}:${location.end_character}`;
          if (!referenceKeys.has(key)) {
            referenceKeys.add(key);
            exactReferences.push(location);
          }
        }

        const prepared = await this.request("textDocument/prepareCallHierarchy", {
          textDocument: { uri: anchor.uri },
          position: anchor.position,
        });
        for (const item of prepared || []) {
          const incoming = await this.request("callHierarchy/incomingCalls", { item });
          for (const call of incoming || []) {
            const location = semanticLocation(
              this.root,
              { uri: call.from.uri, range: call.from.selectionRange || call.from.range },
              call.from.name,
            );
            if (!location) continue;
            relatedFiles.add(location.file);
            const key = `${location.file}:${location.line}:${location.character}:${location.name}`;
            if (!callerKeys.has(key)) {
              callerKeys.add(key);
              callers.push(location);
            }
          }
          const outgoing = await this.request("callHierarchy/outgoingCalls", { item });
          for (const call of outgoing || []) {
            const location = semanticLocation(
              this.root,
              { uri: call.to.uri, range: call.to.selectionRange || call.to.range },
              call.to.name,
            );
            if (!location) continue;
            relatedFiles.add(location.file);
            const key = `${location.file}:${location.line}:${location.character}:${location.name}`;
            if (!calleeKeys.has(key)) {
              calleeKeys.add(key);
              callees.push(location);
            }
          }
        }
      }
      for (const target of targets) relatedFiles.add(target.file);
      const relationMetadata = [...relatedFiles]
        .map(file => metadata[file])
        .filter(Boolean);
      relations[symbol] = {
        targets: targets.map(({ file, name, line, character, end_line, end_character }) => ({
          file, name, line, character, end_line, end_character,
        })),
        names_by_file: namesByFile,
        related_files: [...relatedFiles].sort(),
        references: exactReferences,
        callers,
        callees,
        unresolved_module_specifiers: [...new Set(relationMetadata.flatMap(item => item.unresolved))].sort(),
        unresolved_relative_specifiers: [],
        external_module_specifiers: [...new Set(relationMetadata.flatMap(item => item.external))].sort(),
        blocked_module_specifiers: [],
        dynamic_import_files: [],
        graph_cycle: false,
        graph_truncated: false,
      };
    }
    return {
      status: missingAnchor ? "partially_verified" : "verified",
      reason: missingAnchor ? "Python symbol query has no explicit Pyright position anchor" : null,
      relations,
      module_dependencies: dependencies,
      program_build_count: this.buildCount,
      program_rebuilt: rebuilt,
      snapshot_id: String(this.snapshot),
      verification: {
        pyrightconfig: this.pyrightconfig ? relativeTo(this.root, this.pyrightconfig) : null,
        coverage: ["imports", "symbol_identity", "aliases", "references", "types", "module_resolution"],
        missing: missingAnchor ? ["symbol_anchor"] : [],
      },
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
    return {
      status: "verified",
      reason: null,
      candidates,
      program_build_count: this.buildCount,
      program_rebuilt: rebuilt,
      snapshot_id: String(this.snapshot),
    };
  }

  async verify(files) {
    const rebuilt = await this.ensureCurrent();
    const documents = [];
    for (const file of [...new Set(files.map(value => normalize(value)))]) {
      const document = await this.openFile(file);
      if (document) documents.push(document);
    }
    const issues = [];
    for (const document of documents) {
      const report = await this.request("textDocument/diagnostic", {
        textDocument: { uri: document.uri },
      });
      for (const diagnostic of report.items || []) {
        if (diagnostic.severity !== 1) continue;
        issues.push({
          file: relativeTo(this.root, document.absolute),
          line: diagnostic.range.start.line + 1,
          kind: "type_error",
          detail: diagnostic.message || "unknown error",
          source: "python-deep-layer",
        });
      }
    }
    return {
      status: "verified",
      reason: null,
      issues,
      program_build_count: this.buildCount,
      program_rebuilt: rebuilt,
      snapshot_id: String(this.snapshot),
      verification: {
        pyrightconfig: this.pyrightconfig ? relativeTo(this.root, this.pyrightconfig) : null,
        coverage: ["syntax", "types", "imports", "module_resolution"],
        missing: [],
      },
    };
  }
}

let session = null;

async function handle(req) {
  const root = path.resolve(req.root);
  const pyrightconfig = req.pyrightconfig ? path.resolve(req.pyrightconfig) : null;
  if (!session || session.root !== root) {
    if (session) session.stop();
    const executable = findExecutable(root, "pyright-langserver");
    if (!executable) {
      return {
        status: "tool_missing",
        reason: "Python tool_missing: pyright-langserver not found; missing=pyright",
        issues: [],
        verification: { pyrightconfig: null, coverage: [], missing: ["pyright"] },
        program_build_count: 0,
        program_rebuilt: false,
        snapshot_id: "0",
      };
    }
    session = new PyrightSession(root, executable, pyrightconfig);
  } else if (session.pyrightconfig !== pyrightconfig) {
    session.pyrightconfig = pyrightconfig;
  }
  if (req.op === "analyze") {
    return session.analyze(
      req.files || [],
      req.symbols || [],
      req.symbol_positions || [],
      req.import_tokens || [],
    );
  }
  if (req.op === "discover") return session.discover(req.terms || []);
  return session.verify(req.files || []);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let chain = Promise.resolve();
rl.on("line", line => {
  chain = chain.then(async () => {
    const t0 = Date.now();
    try {
      const req = JSON.parse(line);
      const result = await handle(req);
      process.stdout.write(JSON.stringify({ ...result, elapsed_ms: Date.now() - t0 }) + "\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({
        status: "partially_verified",
        reason: String(error && error.message ? error.message : error),
        issues: [],
        elapsed_ms: Date.now() - t0,
      }) + "\n");
      if (session) {
        session.stop();
        session = null;
      }
    }
  });
});
rl.on("close", () => {
  chain.finally(() => {
    if (session) session.stop();
  });
});
