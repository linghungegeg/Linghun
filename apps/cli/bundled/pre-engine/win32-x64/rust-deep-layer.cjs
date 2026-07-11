"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { pathToFileURL, fileURLToPath } = require("url");
const { spawn, spawnSync } = require("child_process");

const REQUEST_TIMEOUT_MS = 120000;
const FLYCHECK_TIMEOUT_MS = Number(process.env.LINGHUN_RUST_FLYCHECK_TIMEOUT_MS || REQUEST_TIMEOUT_MS);

function normalize(value) {
  return value.replace(/\\/g, "/");
}

function normalizeUri(uri) {
  return process.platform === "win32" ? uri.toLowerCase() : uri;
}

function relativeTo(root, file) {
  return normalize(path.relative(root, file));
}

function findRustAnalyzer() {
  if (process.env.LINGHUN_RUST_ANALYZER) {
    const configured = path.resolve(process.env.LINGHUN_RUST_ANALYZER);
    return fs.existsSync(configured) ? configured : null;
  }
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, ["rust-analyzer"], {
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
  const offset = Math.min(line.length, position.character);
  let start = offset;
  let end = offset;
  const identifier = value => /^[\p{L}\p{N}_]$/u.test(value);
  while (start > 0) {
    const value = line[start - 1];
    if (!identifier(value)) break;
    start -= 1;
  }
  while (end < line.length && identifier(line[end])) end += 1;
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

function firstAnchorPosition(text) {
  const lines = text.split(/\r?\n/);
  const pattern = /\b(?:fn|struct|enum|trait|mod|type|const|static)\s+([\p{L}_][\p{L}\p{N}_]*)/u;
  for (let line = 0; line < lines.length; line += 1) {
    const match = pattern.exec(lines[line]);
    if (!match) continue;
    return {
      name: match[1],
      position: { line, character: match.index + match[0].lastIndexOf(match[1]) },
    };
  }
  return null;
}

class RustAnalyzerSession {
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
    this.flycheckGeneration = 0;
    this.flycheckCompletedGeneration = 0;
    this.flycheckTokens = new Map();
    this.flycheckWaiters = new Set();
    this.flycheckIdleWaiters = new Set();
    this.diagnosticRefreshGeneration = 0;
    this.diagnosticRefreshWaiters = new Set();
    this.serverHealth = "ok";
    this.serverStatusMessage = null;
    this.configStamp = this.readConfigStamp();
  }

  readConfigStamp() {
    const files = [
      "Cargo.toml",
      "Cargo.lock",
      "rust-project.json",
      path.join(".cargo", "config.toml"),
      path.join(".cargo", "config"),
    ];
    return files.map(file => {
      const absolute = path.join(this.root, file);
      if (!fs.existsSync(absolute)) return `${normalize(file)}:missing`;
      const stat = fs.statSync(absolute);
      return `${normalize(file)}:${stat.mtimeMs}:${stat.size}`;
    }).join("|");
  }

  async start() {
    const child = spawn(this.executable, [], {
      cwd: this.root,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    this.child = child;
    child.stdout.on("data", chunk => this.onData(chunk));
    child.on("exit", () => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectPending("rust-analyzer closed");
    });
    child.on("error", error => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectPending(`rust-analyzer error: ${error.message}`);
    });
    const rootUri = pathToFileURL(this.root + path.sep).href;
    await this.request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.root) }],
      capabilities: {
        window: { workDoneProgress: true },
        experimental: { serverStatusNotification: true },
        workspace: {
          symbol: { dynamicRegistration: false },
          diagnostics: { refreshSupport: true },
        },
        textDocument: {
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          callHierarchy: { dynamicRegistration: false },
          diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
          publishDiagnostics: { relatedInformation: true },
        },
      },
      initializationOptions: {
        checkOnSave: false,
        diagnostics: { enable: true },
        cargo: { buildScripts: { enable: false } },
        procMacro: { enable: false },
      },
    });
    this.notify("initialized", {});
    this.buildCount += 1;
    await this.warmWorkspace();
    this.configStamp = this.readConfigStamp();
  }

  stop() {
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.documents.clear();
    this.diagnostics.clear();
    this.rejectFlycheckWaiters("rust-analyzer stopped");
  }

  rejectPending(message) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error(message));
    }
    this.pending.clear();
    this.rejectFlycheckWaiters(message);
  }

  rejectFlycheckWaiters(message) {
    for (const waiter of this.flycheckWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
    this.flycheckWaiters.clear();
    for (const waiter of this.flycheckIdleWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
    this.flycheckIdleWaiters.clear();
    for (const waiter of this.diagnosticRefreshWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
    this.diagnosticRefreshWaiters.clear();
  }

  resolveFlycheckWaiters() {
    for (const waiter of [...this.flycheckWaiters]) {
      if (this.flycheckCompletedGeneration <= waiter.afterGeneration) continue;
      clearTimeout(waiter.timer);
      this.flycheckWaiters.delete(waiter);
      waiter.resolve(this.flycheckCompletedGeneration);
    }
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString("ascii");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) {
        this.buffer = Buffer.alloc(0);
        if (this.child && !this.child.killed) this.child.kill();
        this.child = null;
        this.rejectPending("invalid rust-analyzer LSP response header");
        return;
      }
      const length = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.slice(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.slice(bodyStart + length);
      try {
        this.onMessage(JSON.parse(body));
      } catch (error) {
        if (this.child && !this.child.killed) this.child.kill();
        this.child = null;
        this.rejectPending(`invalid rust-analyzer LSP response: ${error.message}`);
        return;
      }
    }
  }

  onMessage(message) {
    if (message.id != null && (message.result !== undefined || message.error)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message || "rust-analyzer LSP error");
        error.code = message.error.code;
        pending.reject(error);
      }
      else pending.resolve(message.result);
      return;
    }
    if (message.method === "textDocument/publishDiagnostics" && message.params) {
      const uri = normalizeUri(message.params.uri);
      const document = [...this.documents.entries()]
        .find(([documentUri]) => normalizeUri(documentUri) === uri);
      if (message.params.version != null && document && message.params.version < document[1].version) {
        return;
      }
      const diagnostics = message.params.diagnostics || [];
      this.diagnostics.set(uri, diagnostics);
      return;
    }
    if (message.method === "$/progress" && message.params) {
      const token = String(message.params.token || "");
      const kind = message.params.value && message.params.value.kind;
      if (!token.startsWith("rust-analyzer/flycheck/")) return;
      if (kind === "begin") {
        if (this.flycheckTokens.has(token)) {
          this.rejectFlycheckWaiters(`rust-analyzer flycheck protocol error: duplicate begin for ${token}`);
          return;
        }
        this.flycheckGeneration += 1;
        this.flycheckTokens.set(token, this.flycheckGeneration);
      } else if (kind === "end") {
        const generation = this.flycheckTokens.get(token);
        if (generation != null) {
          this.flycheckCompletedGeneration = Math.max(this.flycheckCompletedGeneration, generation);
          this.flycheckTokens.delete(token);
          this.resolveFlycheckWaiters();
          if (this.flycheckTokens.size === 0) {
            for (const waiter of this.flycheckIdleWaiters) {
              clearTimeout(waiter.timer);
              waiter.resolve();
            }
            this.flycheckIdleWaiters.clear();
          }
        }
      }
      return;
    }
    if (message.method === "experimental/serverStatus" && message.params) {
      this.serverHealth = message.params.health || "ok";
      this.serverStatusMessage = message.params.message || null;
      return;
    }
    if (message.id != null && message.method) {
      let result = null;
      if (message.method === "workspace/configuration") {
        result = (message.params && message.params.items || []).map(() => null);
      } else if (message.method === "window/workDoneProgress/create") {
        result = null;
      } else if (message.method === "workspace/diagnostic/refresh") {
        this.diagnosticRefreshGeneration += 1;
        for (const waiter of [...this.diagnosticRefreshWaiters]) {
          if (this.diagnosticRefreshGeneration <= waiter.afterGeneration) continue;
          clearTimeout(waiter.timer);
          this.diagnosticRefreshWaiters.delete(waiter);
          waiter.resolve(this.diagnosticRefreshGeneration);
        }
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
        reject(new Error(`rust-analyzer LSP ${method} timed out`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async semanticRequest(method, params) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.request(method, params);
      } catch (error) {
        if (!/content modified/i.test(error.message) || attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }

  async warmWorkspace() {
    for (const file of ["src/lib.rs", "src/main.rs"]) {
      const document = await this.openFile(file);
      if (!document) continue;
      const anchor = firstAnchorPosition(document.text);
      if (!anchor) return;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const hover = await this.semanticRequest("textDocument/hover", {
          textDocument: { uri: document.uri },
          position: anchor.position,
        });
        if (hover) {
          const symbols = await this.semanticRequest("workspace/symbol", { query: anchor.name });
          if ((symbols || []).length > 0) return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }
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
      this.diagnostics.delete(normalizeUri(uri));
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
    let synchronized = false;
    if (!previous) {
      this.diagnostics.delete(normalizeUri(uri));
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "rust", version: 1, text },
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

  waitForFlycheckAfter(afterGeneration, timeout = REQUEST_TIMEOUT_MS) {
    if (this.flycheckCompletedGeneration > afterGeneration) {
      return Promise.resolve(this.flycheckCompletedGeneration);
    }
    return new Promise((resolve, reject) => {
      const waiter = { afterGeneration, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.flycheckWaiters.delete(waiter);
        reject(new Error("rust-analyzer flycheck completion timed out"));
      }, timeout);
      this.flycheckWaiters.add(waiter);
    });
  }

  waitForFlycheckIdle(timeout = REQUEST_TIMEOUT_MS) {
    if (this.flycheckTokens.size === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.flycheckIdleWaiters.delete(waiter);
        reject(new Error("rust-analyzer flycheck did not become idle"));
      }, timeout);
      this.flycheckIdleWaiters.add(waiter);
    });
  }

  waitForDiagnosticRefreshAfter(afterGeneration, timeout = REQUEST_TIMEOUT_MS) {
    if (this.diagnosticRefreshGeneration > afterGeneration) {
      return Promise.resolve(this.diagnosticRefreshGeneration);
    }
    return new Promise((resolve, reject) => {
      const waiter = { afterGeneration, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.diagnosticRefreshWaiters.delete(waiter);
        reject(new Error("rust-analyzer diagnostic refresh timed out"));
      }, timeout);
      this.diagnosticRefreshWaiters.add(waiter);
    });
  }

  async pullDiagnostics(uri) {
    const report = await this.semanticRequest("textDocument/diagnostic", {
      textDocument: { uri },
    });
    const pulled = report && Array.isArray(report.items) ? report.items : [];
    if (pulled.length > 0) return pulled;
    return this.diagnostics.get(normalizeUri(uri)) || pulled;
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

  async analyze(files, symbols, symbolPositions, importTokens, allowWorkspaceSymbol) {
    const rebuilt = await this.ensureCurrent();
    const normalizedFiles = [...new Set(files.map(file => normalize(file)))];
    let openedFiles = 0;
    for (const file of normalizedFiles) {
      if (await this.openFile(file)) openedFiles += 1;
    }
    if (normalizedFiles.length > 0 && openedFiles === 0) {
      return {
        status: "partially_verified",
        reason: "Rust semantic evidence incomplete: rust_documents",
        relations: Object.fromEntries(symbols.map(symbol => [symbol, {
          targets: [], names_by_file: {}, related_files: [], references: [], callers: [], callees: [],
          unresolved_module_specifiers: [], unresolved_relative_specifiers: [], external_module_specifiers: [],
          blocked_module_specifiers: [], dynamic_import_files: [], graph_cycle: false, graph_truncated: false,
        }])),
        module_dependencies: {},
        program_build_count: this.buildCount,
        program_rebuilt: rebuilt,
        snapshot_id: String(this.snapshot),
        verification: { coverage: [], missing: ["rust_documents"] },
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
        ? [...targets.map(target => ({ uri: target.uri, position: target.position })), ...origins]
        : [];
      for (const origin of targets.length === 1 ? origins : []) {
        const location = semanticLocation(this.root, {
          uri: origin.uri,
          range: {
            start: origin.position,
            end: { line: origin.position.line, character: origin.position.character + symbol.length },
          },
        }, symbol);
        if (!location) continue;
        relatedFiles.add(location.file);
        if (!namesByFile[location.file]) namesByFile[location.file] = [];
        if (!namesByFile[location.file].includes(symbol)) namesByFile[location.file].push(symbol);
        const key = `${location.file}:${location.line}:${location.character}:${location.end_line}:${location.end_character}`;
        if (!referenceKeys.has(key)) {
          referenceKeys.add(key);
          references.push(location);
        }
      }
      for (const anchor of anchors) {
        const found = await this.semanticRequest("textDocument/references", {
          textDocument: { uri: anchor.uri },
          position: anchor.position,
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

        const prepared = await this.semanticRequest("textDocument/prepareCallHierarchy", {
          textDocument: { uri: anchor.uri },
          position: anchor.position,
        });
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
      reason: missing.length ? `Rust semantic evidence incomplete: ${missing.join(",")}` : null,
      relations,
      module_dependencies: dependencies,
      program_build_count: this.buildCount,
      program_rebuilt: rebuilt,
      snapshot_id: String(this.snapshot),
      verification: {
        coverage: ["imports", "modules", "reexports", "symbol_identity", "aliases", "references", "call_hierarchy", "types"],
        missing,
      },
    };
  }

  async discover(terms) {
    const rebuilt = await this.ensureCurrent();
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
    const rebuilt = await this.ensureCurrent();
    const documents = [];
    for (const file of [...new Set(files.map(value => normalize(value)))]) {
      const document = await this.openFile(file);
      if (document) documents.push(document);
    }
    if (documents.length === 0) {
      return {
        status: "partially_verified",
        reason: "rust-analyzer verify has no readable Rust documents",
        issues: [],
        program_build_count: this.buildCount,
        program_rebuilt: rebuilt,
        snapshot_id: String(this.snapshot),
        verification: {
          coverage: [],
          missing: ["rust_documents"],
        },
      };
    }
    const issues = [];
    const issueKeys = new Set();
    let observedDiagnosticCount = 0;
    for (const document of documents) {
      const tracked = this.documents.get(document.uri);
      const version = tracked.version + 1;
      this.notify("textDocument/didChange", {
        textDocument: { uri: document.uri, version },
        contentChanges: [{ text: document.text }],
      });
      this.documents.set(document.uri, { ...tracked, version });
    }
    try {
      await this.waitForFlycheckIdle(FLYCHECK_TIMEOUT_MS);
      this.notify("textDocument/didSave", {
        textDocument: { uri: documents[0].uri },
        text: documents[0].text,
      });
      for (const document of documents) this.diagnostics.delete(normalizeUri(document.uri));
      this.notify("rust-analyzer/clearFlycheck", null);
      const flycheckGeneration = this.flycheckGeneration;
      const diagnosticRefreshGeneration = this.diagnosticRefreshGeneration;
      this.notify("rust-analyzer/runFlycheck", {
        textDocument: { uri: documents[0].uri },
      });
      await this.waitForFlycheckAfter(flycheckGeneration, FLYCHECK_TIMEOUT_MS);
      await this.waitForDiagnosticRefreshAfter(diagnosticRefreshGeneration, FLYCHECK_TIMEOUT_MS);
      this.configStamp = this.readConfigStamp();
    } catch (error) {
      return {
        status: "partially_verified",
        reason: error.message,
        issues: [],
        program_build_count: this.buildCount,
        program_rebuilt: rebuilt,
        snapshot_id: String(this.snapshot),
        verification: {
          coverage: ["syntax", "types", "imports", "modules", "crate_resolution"],
          missing: ["rust_analyzer_flycheck_completion"],
        },
      };
    }
    if (this.serverHealth !== "ok") {
      return {
        status: "partially_verified",
        reason: this.serverStatusMessage || `rust-analyzer server health: ${this.serverHealth}`,
        issues: [],
        program_build_count: this.buildCount,
        program_rebuilt: rebuilt,
        snapshot_id: String(this.snapshot),
        verification: {
          coverage: ["syntax", "types", "imports", "modules", "crate_resolution"],
          missing: ["rust_analyzer_server_health"],
        },
      };
    }
    for (const document of documents) {
      const diagnostics = await this.pullDiagnostics(document.uri);
      for (const diagnostic of diagnostics) {
        observedDiagnosticCount += 1;
        if (diagnostic.severity !== 1) continue;
        const key = `${relativeTo(this.root, document.absolute)}:${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.code || diagnostic.message}`;
        if (issueKeys.has(key)) continue;
        issueKeys.add(key);
        issues.push({
          file: relativeTo(this.root, document.absolute),
          line: diagnostic.range.start.line + 1,
          kind: "type_error",
          detail: diagnostic.message || "unknown error",
          source: "rust-deep-layer",
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
        coverage: ["syntax", "types", "imports", "modules", "crate_resolution"],
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
    const executable = findRustAnalyzer();
    if (!executable) {
      return {
        status: "tool_missing",
        reason: "Rust tool_missing: rust-analyzer not found; missing=rust-analyzer",
        issues: [],
        relations: {},
        module_dependencies: {},
        candidates: [],
        verification: { coverage: [], missing: ["rust-analyzer"] },
        program_build_count: 0,
        program_rebuilt: false,
        snapshot_id: "0",
      };
    }
    session = new RustAnalyzerSession(root, executable);
  }
  if (request.op === "analyze") {
    return session.analyze(
      request.files || [],
      request.symbols || [],
      request.symbol_positions || [],
      request.import_tokens || [],
      request.allow_workspace_symbol === true,
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
    try {
      const result = await handle(JSON.parse(line));
      process.stdout.write(JSON.stringify({ ...result, elapsed_ms: Date.now() - started }) + "\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({
        status: "partially_verified",
        reason: String(error && error.message ? error.message : error),
        issues: [],
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
