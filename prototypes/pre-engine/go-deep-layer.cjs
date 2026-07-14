"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { pathToFileURL, fileURLToPath } = require("url");
const { spawn, spawnSync } = require("child_process");

const REQUEST_TIMEOUT_MS = 120000;
const DIAGNOSTIC_TIMEOUT_MS = Number(
  process.env.LINGHUN_GOPLS_DIAGNOSTIC_TIMEOUT_MS || REQUEST_TIMEOUT_MS,
);
const STDERR_LIMIT_BYTES = 8192;
const GO_CONFIG_FILES = ["go.mod", "go.sum", "go.work", "go.work.sum"];

function normalize(value) {
  return value.replace(/\\/g, "/");
}

function relativeTo(root, file) {
  return normalize(path.relative(root, file));
}

function findGoSdk() {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, ["go"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  return result.status === 0;
}

function findGopls() {
  if (process.env.LINGHUN_GOPLS) {
    const configured = path.resolve(process.env.LINGHUN_GOPLS);
    return fs.existsSync(configured) ? configured : null;
  }
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, ["gopls"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0] || null;
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
  const identifier = value => /^[\p{ID_Continue}_]$/u.test(value);
  while (start > 0) {
    let previous = start - 1;
    if (previous > 0 && /[\uDC00-\uDFFF]/.test(line[previous])
        && /[\uD800-\uDBFF]/.test(line[previous - 1])) {
      previous -= 1;
    }
    const value = line.slice(previous, start);
    if (!identifier(value)) break;
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

class GoplsSession {
  constructor(root, executable) {
    this.root = path.resolve(root);
    this.canonicalRoot = fs.realpathSync.native(this.root);
    this.executable = executable;
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.documents = new Map();
    this.buildCount = 0;
    this.snapshot = 0;
    this.stderr = Buffer.alloc(0);
    this.stderrTruncated = false;
    this.configStamp = null;
    this.configFiles = new Map();
    this.workspaceFiles = new Map();
  }

  scanWorkspace() {
    const files = new Map();
    const configs = new Map();
    const visit = directory => {
      const canonicalDirectory = this.boundedExistingPath(directory, true);
      if (!canonicalDirectory) return;
      for (const entry of fs.readdirSync(canonicalDirectory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (![".git", "node_modules", "target", "vendor"].includes(entry.name)) {
            visit(path.join(canonicalDirectory, entry.name));
          }
          continue;
        }
        if (!entry.name.endsWith(".go") && !GO_CONFIG_FILES.includes(entry.name)) continue;
        const absolute = this.boundedExistingPath(path.join(canonicalDirectory, entry.name), true);
        if (!absolute) continue;
        const stat = fs.statSync(absolute);
        const relative = normalize(path.relative(this.root, absolute));
        const stamp = `${stat.mtimeMs}:${stat.size}`;
        if (entry.name.endsWith(".go")) files.set(relative, stamp);
        else configs.set(relative, stamp);
      }
    };
    visit(this.root);
    return { configStamp: this.configStampFor(configs), configs, files };
  }

  boundedExistingPath(candidate, alreadyResolved = false) {
    if (typeof candidate !== "string" || candidate.length === 0) return null;
    if (!alreadyResolved) {
      const normalized = normalize(candidate);
      if (
        path.isAbsolute(candidate) ||
        normalized.startsWith("/") ||
        /^[A-Za-z]:/u.test(normalized) ||
        normalized.split("/").includes("..")
      ) return null;
    }
    const absolute = alreadyResolved ? path.resolve(candidate) : path.resolve(this.root, candidate);
    const lexicalRelative = path.relative(this.root, absolute);
    if (lexicalRelative === ".." || lexicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(lexicalRelative)) {
      return null;
    }
    if (!fs.existsSync(absolute)) return null;
    const canonical = fs.realpathSync.native(absolute);
    const canonicalRelative = path.relative(this.canonicalRoot, canonical);
    if (
      canonicalRelative === ".." ||
      canonicalRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(canonicalRelative)
    ) return null;
    return canonical;
  }

  configStampFor(configs) {
    return [...configs].map(([file, stamp]) => `${file}:${stamp}`).sort().join("|");
  }

  syncWorkspaceFiles(next) {
    const changes = [];
    for (const [file, stamp] of next) {
      const previous = this.workspaceFiles.get(file);
      if (previous == null) changes.push({ uri: pathToFileURL(path.join(this.root, file)).href, type: 1 });
      else if (previous !== stamp) changes.push({ uri: pathToFileURL(path.join(this.root, file)).href, type: 2 });
    }
    for (const file of this.workspaceFiles.keys()) {
      if (!next.has(file)) changes.push({ uri: pathToFileURL(path.join(this.root, file)).href, type: 3 });
    }
    this.workspaceFiles = next;
    if (changes.length > 0) {
      this.notify("workspace/didChangeWatchedFiles", { changes });
      this.snapshot += 1;
    }
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
    const suffix = stderr
      ? ` stderr=${this.stderrTruncated ? "[truncated] " : ""}${stderr}`
      : " stderr=<empty>";
    return `gopls exited code=${code == null ? "null" : code} signal=${signal || "null"}${suffix}`;
  }

  async start(workspace) {
    const currentWorkspace = workspace || this.scanWorkspace();
    const child = spawn(this.executable, ["serve"], {
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
      this.rejectPending(this.exitReason(code, signal));
    });
    child.on("error", error => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectPending(`gopls error: ${error.message}`);
    });
    const rootUri = pathToFileURL(this.root + path.sep).href;
    await this.request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.root) }],
      capabilities: {
        workspace: {
          symbol: { dynamicRegistration: false },
        },
        textDocument: {
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          callHierarchy: { dynamicRegistration: false },
          diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
        },
      },
      initializationOptions: {
        analyses: { unusedparams: true, unusedwrite: true },
        diagnosticsDelay: "100ms",
        diagnosticsTrigger: "Save",
      },
    });
    this.notify("initialized", {});
    this.buildCount += 1;
    await this.warmWorkspace();
    this.configStamp = currentWorkspace.configStamp;
    this.configFiles = currentWorkspace.configs;
    this.workspaceFiles = currentWorkspace.files;
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
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (true) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = this.buffer.slice(0, headerEnd).toString("ascii");
        const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
        if (!lengthMatch) throw new Error("invalid gopls LSP response header");
        const length = Number(lengthMatch[1]);
        const bodyStart = headerEnd + 4;
        if (this.buffer.length < bodyStart + length) return;
        const body = this.buffer.slice(bodyStart, bodyStart + length).toString("utf8");
        this.buffer = this.buffer.slice(bodyStart + length);
        this.onMessage(JSON.parse(body));
      }
    } catch (error) {
      this.buffer = Buffer.alloc(0);
      if (this.child && !this.child.killed) this.child.kill();
      this.child = null;
      this.rejectPending(`invalid gopls LSP response: ${error.message}`);
    }
  }

  onMessage(message) {
    if (message.id != null && (message.result !== undefined || message.error)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message || "gopls LSP error");
        error.code = message.error.code;
        pending.reject(error);
      }
      else pending.resolve(message.result);
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
        reject(new Error(`gopls LSP ${method} timed out`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async semanticRequest(method, params, timeout = REQUEST_TIMEOUT_MS) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.request(method, params, timeout);
      } catch (error) {
        if (!/content modified/i.test(error.message) || attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }

  async warmWorkspace() {
    await this.request("workspace/symbol", { query: "" });
  }

  async ensureCurrent(syncMode = "full") {
    if (!this.child) {
      await this.start(this.scanWorkspace());
      this.snapshot += 1;
      return true;
    }
    if (syncMode === "reuse") return false;
    const workspace = this.scanWorkspace();
    if (workspace.configStamp === this.configStamp) {
      this.configFiles = workspace.configs;
      this.syncWorkspaceFiles(workspace.files);
      this.closeDeletedDocuments();
      return false;
    }
    this.stop();
    await this.start(workspace);
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
    const absolute = this.boundedExistingPath(file);
    if (!absolute) return null;
    const text = fs.readFileSync(absolute, "utf8");
    const stat = fs.statSync(absolute);
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    const uri = pathToFileURL(absolute).href;
    const previous = this.documents.get(uri);
    let synchronized = false;
    if (!previous) {
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "go", version: 1, text },
      });
      this.documents.set(uri, { text, stamp, version: 1 });
      synchronized = true;
    } else if (previous.stamp !== stamp || previous.text !== text) {
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

  async pullDiagnostics(uri) {
    const report = await this.semanticRequest("textDocument/diagnostic", {
      textDocument: { uri },
    }, DIAGNOSTIC_TIMEOUT_MS);
    if (!report || !Array.isArray(report.items)) {
      throw new Error("gopls returned an incomplete textDocument/diagnostic report");
    }
    return report.items;
  }

  async definitions(uri, position) {
    const result = await this.semanticRequest("textDocument/definition", {
      textDocument: { uri },
      position,
    });
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  }

  async resolveTargets(symbol, positions, allowWorkspaceSymbol) {
    const locations = [];
    const origins = [];
    for (const token of positions.filter(position => position.symbol === symbol)) {
      const document = await this.openFile(token.file);
      if (!document) continue;
      const position = { line: token.line, character: token.character };
      const definitions = await this.definitions(document.uri, position);
      if (definitions.length > 0) origins.push({ uri: document.uri, position, symbol });
      locations.push(...definitions);
    }
    if (allowWorkspaceSymbol && positions.filter(position => position.symbol === symbol).length === 0) {
      const workspaceSymbols = await this.semanticRequest("workspace/symbol", { query: symbol });
      for (const item of workspaceSymbols || []) {
        if (item.name !== symbol || !item.location) continue;
        locations.push(item.location);
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
        const definitions = await this.definitions(document.uri, {
          line: token.line,
          character: token.character,
        });
        for (const definition of definitions) {
          const uri = locationUri(definition);
          if (!uri || !uri.startsWith("file:")) continue;
          statements.set(token.specifier, true);
          const rel = relativeTo(this.root, fileURLToPath(uri));
          if (!rel.startsWith("../") && !path.isAbsolute(rel) && rel !== file) deps.add(rel);
        }
      }
      dependencies[file] = [...deps].sort();
      metadata[file] = {
        unresolved: [...statements].filter(([, resolved]) => !resolved).map(([specifier]) => specifier).sort(),
      };
    }
    return { dependencies, metadata };
  }

  async analyze(files, symbols, symbolPositions, importTokens, allowWorkspaceSymbol, syncMode, includeReferences, includeCallHierarchy) {
    const normalizedFiles = [...new Set(files.map(file => normalize(file)))];
    const rebuilt = await this.ensureCurrent(syncMode);
    let openedFiles = 0;
    for (const file of normalizedFiles) {
      if (await this.openFile(file)) openedFiles += 1;
    }
    if (openedFiles === 0 && (normalizedFiles.length > 0 || this.workspaceFiles.size === 0)) {
      return {
        status: "partially_verified",
        reason: "Go semantic evidence incomplete: go_documents",
        relations: Object.fromEntries(symbols.map(symbol => [symbol, {
          targets: [], names_by_file: {}, related_files: [], references: [], callers: [], callees: [],
          unresolved_module_specifiers: [], unresolved_relative_specifiers: [], external_module_specifiers: [],
          blocked_module_specifiers: [], dynamic_import_files: [], graph_cycle: false, graph_truncated: false,
        }])),
        module_dependencies: {},
        program_build_count: this.buildCount,
        program_rebuilt: rebuilt,
        snapshot_id: String(this.snapshot),
        verification: { coverage: [], missing: ["go_documents"] },
      };
    }
    const { dependencies, metadata } = await this.dependencies(normalizedFiles, importTokens);
    const relations = {};
    let missingAnchor = false;
    let ambiguousTarget = false;
    for (const symbol of symbols) {
      const { targets, origins } = await this.resolveTargets(symbol, symbolPositions, allowWorkspaceSymbol);
      if (targets.length === 0) missingAnchor = true;
      if (targets.length > 1) ambiguousTarget = true;
      const namesByFile = {};
      const relatedFiles = new Set();
      const references = [];
      const callers = [];
      const callees = [];
      const referenceKeys = new Set();
      const callerKeys = new Set();
      const calleeKeys = new Set();
      const anchors = targets.length === 1
        ? (origins.length > 0
          ? origins
          : targets.map(target => ({ uri: target.uri, position: target.position })))
        : [];
      for (const anchor of anchors) {
        const [found, prepared] = await Promise.all([
          includeReferences
            ? this.semanticRequest("textDocument/references", {
              textDocument: { uri: anchor.uri },
              position: anchor.position,
              context: { includeDeclaration: true },
            })
            : [],
          includeCallHierarchy
            ? this.semanticRequest("textDocument/prepareCallHierarchy", {
              textDocument: { uri: anchor.uri },
              position: anchor.position,
            })
            : [],
        ]);
        if (includeReferences) {
          for (const reference of found || []) {
            const uri = locationUri(reference);
            const range = locationRange(reference);
            if (!uri || !uri.startsWith("file:") || !range) continue;
            let rel;
            try {
              rel = relativeTo(this.root, fileURLToPath(uri));
            } catch {
              rel = null;
            }
            if (rel == null) continue;
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
              references.push(location);
            }
          }
        }

        if (includeCallHierarchy) {
          for (const item of prepared || []) {
            const incoming = await this.semanticRequest("callHierarchy/incomingCalls", { item });
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
            const outgoing = await this.semanticRequest("callHierarchy/outgoingCalls", { item });
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
      }
      if (targets.length === 1) relatedFiles.add(targets[0].file);
      const unresolved = [...relatedFiles]
        .flatMap(file => metadata[file] ? metadata[file].unresolved : []);
      relations[symbol] = {
        targets: targets.map(({ file, name, line, character, end_line, end_character }) => ({
          file, name, line, character, end_line, end_character,
        })),
        names_by_file: namesByFile,
        related_files: [...relatedFiles].sort(),
        references,
        callers,
        callees,
        unresolved_module_specifiers: [...new Set(unresolved)].sort(),
        unresolved_relative_specifiers: [],
        external_module_specifiers: [],
        blocked_module_specifiers: [],
        dynamic_import_files: [],
        graph_cycle: false,
        graph_truncated: false,
      };
    }
    const missing = [];
    if (missingAnchor) missing.push("symbol_anchor");
    if (ambiguousTarget) missing.push("ambiguous_symbol_identity");
    return {
      status: missing.length ? "partially_verified" : "verified",
      reason: missing.length ? `Go semantic evidence incomplete: ${missing.join(",")}` : null,
      relations,
      module_dependencies: dependencies,
      program_build_count: this.buildCount,
      program_rebuilt: rebuilt,
      snapshot_id: String(this.snapshot),
      verification: {
        coverage: [
          "imports", "modules", "reexports", "symbol_identity", "aliases", "types",
          ...(includeReferences ? ["references"] : []),
          ...(includeCallHierarchy ? ["call_hierarchy"] : []),
        ],
        missing,
      },
    };
  }

  async discover(terms) {
    const rebuilt = await this.ensureCurrent();
    if (this.workspaceFiles.size === 0) {
      return {
        status: "partially_verified",
        reason: "Go semantic evidence incomplete: go_documents",
        candidates: [],
        program_build_count: this.buildCount,
        program_rebuilt: rebuilt,
        snapshot_id: String(this.snapshot),
        verification: { coverage: [], missing: ["go_documents"] },
      };
    }
    const candidates = [];
    const seen = new Set();
    for (const term of terms.filter(Boolean)) {
      const symbols = await this.semanticRequest("workspace/symbol", { query: term });
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
    const normalizedFiles = [...new Set(files.map(value => normalize(value)))];
    const rebuilt = await this.ensureCurrent();
    const documents = [];
    for (const file of normalizedFiles) {
      const document = await this.openFile(file);
      if (document) documents.push(document);
    }
    if (documents.length === 0) {
      return {
        status: "partially_verified",
        reason: "gopls verify has no readable Go documents",
        issues: [],
        program_build_count: this.buildCount,
        program_rebuilt: rebuilt,
        snapshot_id: String(this.snapshot),
        verification: { coverage: [], missing: ["go_documents"] },
      };
    }
    const issues = [];
    let observedDiagnosticCount = 0;
    for (const document of documents) {
      let diagnostics;
      try {
        diagnostics = await this.pullDiagnostics(document.uri);
      } catch (error) {
        return {
          status: "partially_verified",
          reason: "gopls diagnostic protocol incomplete: " + error.message,
          issues: [],
          program_build_count: this.buildCount,
          program_rebuilt: rebuilt,
          snapshot_id: String(this.snapshot),
          verification: { coverage: [], missing: ["gopls_diagnostics"] },
        };
      }
      for (const diagnostic of diagnostics) {
        observedDiagnosticCount += 1;
        if (diagnostic.severity !== 1) continue;
        issues.push({
          file: relativeTo(this.root, document.absolute),
          line: diagnostic.range.start.line + 1,
          kind: "type_error",
          detail: diagnostic.message || "unknown error",
          source: "go-deep-layer",
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
        coverage: ["syntax", "types", "imports", "modules", "workspace"],
        missing: [],
        diagnostic_count: observedDiagnosticCount,
      },
    };
  }
}

let session = null;

async function handle(request) {
  const root = path.resolve(request.root);
  if (!session || session.root !== root) {
    if (session) session.stop();
    const executable = findGopls();
    const goSdkAvailable = findGoSdk();
    if (!executable || !goSdkAvailable) {
      return {
        status: "tool_missing",
        reason: !executable
          ? "Go tool_missing: gopls not found; missing=gopls"
          : "Go tool_missing: Go SDK not found; missing=go",
        issues: [],
        relations: {},
        module_dependencies: {},
        candidates: [],
        verification: { coverage: [], missing: [!executable ? "gopls" : "go"] },
        program_build_count: 0,
        program_rebuilt: false,
        snapshot_id: "0",
      };
    }
    session = new GoplsSession(root, executable);
  }
  if (request.op === "analyze") {
    return session.analyze(
      request.files || [],
      request.symbols || [],
      request.symbol_positions || [],
      request.import_tokens || [],
      request.allow_workspace_symbol === true,
      request.sync_mode === "reuse" ? "reuse" : "full",
      request.include_references !== false,
      request.include_call_hierarchy !== false,
    );
  }
  if (request.op === "discover") return session.discover(request.terms || []);
  return session.verify(request.files || []);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let chain = Promise.resolve();
rl.on("line", line => {
  chain = chain.then(async () => {
    const started = Date.now();
    let request = {};
    try {
      request = JSON.parse(line);
      const result = await handle(request);
      process.stdout.write(JSON.stringify({ ...result, elapsed_ms: Date.now() - started }) + "\n");
    } catch (error) {
      const missing = request.op === "verify" ? "gopls_diagnostics" : "gopls_semantic_protocol";
      process.stdout.write(JSON.stringify({
        status: "partially_verified",
        reason: String(error && error.message ? error.message : error),
        issues: [],
        relations: {},
        module_dependencies: {},
        candidates: [],
        verification: { coverage: [], missing: [missing] },
        elapsed_ms: Date.now() - started,
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
