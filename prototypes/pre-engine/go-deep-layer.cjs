"use strict";
const readline = require("readline");
const path = require("path");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");

// --- LSP JSON-RPC framing ---
let msgId = 0;
function lspEncode(obj) {
  const body = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}
function lspRequest(method, params) {
  return lspEncode({ jsonrpc: "2.0", id: ++msgId, method, params });
}
function lspNotify(method, params) {
  return lspEncode({ jsonrpc: "2.0", method, params });
}

function fileUri(p) {
  const abs = path.resolve(p).replace(/\\/g, "/");
  return abs.startsWith("/") ? `file://${abs}` : `file:///${abs}`;
}

function normUri(uri) { return uri.toLowerCase(); }

// --- gopls session state ---
let goplsProc = null;
let goplsRoot = null;
let goplsReady = false;
let goplsBuffer = "";
let goplsExpectedLen = -1;
let goplsInitResolve = null;
let goplsInitReject = null;
let goplsDiagnostics = new Map();
let goplsDiagTimers = new Map();
let goplsDiagWaiters = [];
let openDocs = new Map();
let goplsDocOpenTime = new Map();
let goplsEmptyCount = new Map();
let goplsWarmedUp = false;
let goplsStartingPromise = null;

const BOOTSTRAP_BUDGET_MS = 3000;
const WARM_SETTLE_MS = 1500;

function findGopls() {
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(whichCmd, ["gopls"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (r.status === 0) {
    const line = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
    return line || null;
  }
  return null;
}

function killGopls() {
  if (goplsProc) { try { goplsProc.kill(); } catch {} goplsProc = null; }
  goplsReady = false;
  goplsWarmedUp = false;
  goplsStartingPromise = null;
  goplsInitResolve = null;
  goplsInitReject = null;
  goplsDiagWaiters.forEach(w => w.resolve([]));
  goplsDiagWaiters = [];
  goplsDiagTimers.forEach(t => clearTimeout(t));
  goplsDiagTimers.clear();
  openDocs.clear();
  goplsDocOpenTime.clear();
  goplsEmptyCount.clear();
}

function onGoplsData(chunk) {
  goplsBuffer += chunk.toString();
  while (true) {
    if (goplsExpectedLen === -1) {
      const headerEnd = goplsBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = goplsBuffer.slice(0, headerEnd);
      const m = header.match(/Content-Length:\s*(\d+)/i);
      if (!m) { goplsBuffer = goplsBuffer.slice(headerEnd + 4); continue; }
      goplsExpectedLen = parseInt(m[1], 10);
      goplsBuffer = goplsBuffer.slice(headerEnd + 4);
    }
    if (goplsBuffer.length < goplsExpectedLen) break;
    const body = goplsBuffer.slice(0, goplsExpectedLen);
    goplsBuffer = goplsBuffer.slice(goplsExpectedLen);
    goplsExpectedLen = -1;
    handleGoplsMessage(body);
  }
}

function handleGoplsMessage(body) {
  let msg;
  try { msg = JSON.parse(body); } catch { return; }

  if (msg.method && msg.id != null) {
    goplsProc.stdin.write(lspEncode({ jsonrpc: "2.0", id: msg.id, result: null }));
    return;
  }

  if (msg.id && msg.result !== undefined && goplsInitResolve && !goplsReady) {
    goplsProc.stdin.write(lspNotify("initialized", {}));
    goplsReady = true;
    const resolve = goplsInitResolve;
    goplsInitResolve = null;
    goplsInitReject = null;
    resolve();
    return;
  }

  if (msg.method === "textDocument/publishDiagnostics" && msg.params) {
    const { uri, diagnostics } = msg.params;
    const uriKey = normUri(uri);
    const issues = (diagnostics || [])
      .filter(d => d.severity === 1)
      .map(d => ({
        file: uriToRel(uri),
        line: (d.range && d.range.start) ? d.range.start.line + 1 : 1,
        kind: "type_error",
        detail: d.message || "unknown error",
        source: "go-deep-layer",
      }));
    goplsDiagnostics.set(uriKey, issues);
    if (goplsDiagTimers.has(uriKey)) clearTimeout(goplsDiagTimers.get(uriKey));
    if (issues.length > 0) {
      goplsWarmedUp = true;
      goplsEmptyCount.set(uriKey, 0);
      goplsDiagTimers.delete(uriKey);
      goplsDiagWaiters = goplsDiagWaiters.filter(w => {
        if (w.uri === uriKey) { w.resolve(issues); return false; }
        return true;
      });
    } else if (goplsWarmedUp) {
      const count = (goplsEmptyCount.get(uriKey) || 0) + 1;
      goplsEmptyCount.set(uriKey, count);
      if (count >= 2) {
        goplsDiagTimers.delete(uriKey);
        goplsDiagWaiters = goplsDiagWaiters.filter(w => {
          if (w.uri === uriKey) { w.resolve([]); return false; }
          return true;
        });
      } else {
        const openedAt = goplsDocOpenTime.get(uriKey) || 0;
        const elapsed = Date.now() - openedAt;
        const remaining = Math.max(0, WARM_SETTLE_MS - elapsed);
        goplsDiagTimers.set(uriKey, setTimeout(() => {
          goplsDiagTimers.delete(uriKey);
          const final = goplsDiagnostics.get(uriKey) || [];
          goplsDiagWaiters = goplsDiagWaiters.filter(w => {
            if (w.uri === uriKey) { w.resolve(final); return false; }
            return true;
          });
        }, remaining));
      }
    }
  }
}

function uriToRel(uri) {
  const decoded = decodeURIComponent(uri.replace(/^file:\/\/\/?/, "").replace(/^([a-z]):/, (_, d) => d.toUpperCase() + ":"));
  if (goplsRoot) {
    let rel = path.relative(goplsRoot, decoded).replace(/\\/g, "/");
    if (!rel.startsWith("..")) return rel;
  }
  return decoded.replace(/\\/g, "/");
}

function waitForDiag(uri, timeoutMs) {
  const uriKey = normUri(uri);
  return new Promise(resolve => {
    if (goplsDiagnostics.has(uriKey) && !goplsDiagTimers.has(uriKey)) {
      resolve(goplsDiagnostics.get(uriKey));
      return;
    }
    const timer = setTimeout(() => {
      goplsDiagWaiters = goplsDiagWaiters.filter(w => w.resolve !== resolve);
      resolve(goplsDiagnostics.get(uriKey) || []);
    }, timeoutMs);
    goplsDiagWaiters.push({ uri: uriKey, resolve: issues => { clearTimeout(timer); resolve(issues); } });
  });
}

function startGopls(root) {
  return new Promise((resolve, reject) => {
    const goplsPath = findGopls();
    if (!goplsPath) { reject(new Error("gopls not found")); return; }

    goplsRoot = root;
    goplsDiagnostics.clear();
    openDocs.clear();
    goplsWarmedUp = false;
    goplsBuffer = "";
    goplsExpectedLen = -1;
    goplsReady = false;

    goplsProc = spawn(goplsPath, ["serve"], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    goplsProc.on("error", e => { goplsProc = null; reject(e); });
    goplsProc.on("exit", () => { goplsProc = null; goplsReady = false; });
    goplsProc.stdout.on("data", chunk => onGoplsData(chunk));

    goplsInitResolve = resolve;
    goplsInitReject = reject;

    goplsProc.stdin.write(lspRequest("initialize", {
      processId: process.pid,
      capabilities: { textDocument: { publishDiagnostics: { relatedInformation: false } } },
      rootUri: fileUri(root),
      workspaceFolders: [{ uri: fileUri(root), name: path.basename(root) }],
    }));

    setTimeout(() => {
      if (!goplsReady) { killGopls(); reject(new Error("gopls init timeout (15s)")); }
    }, 15000);
  });
}

function eagerWarmUp(root) {
  if (goplsStartingPromise) return goplsStartingPromise;
  goplsStartingPromise = startGopls(root).then(() => {
    const candidates = ["main.go", "type_error.go"];
    for (const rel of candidates) {
      const abs = path.join(root, rel);
      if (fs.existsSync(abs)) {
        sendDocOpen(abs, fileUri(abs));
        break;
      }
    }
  }).catch(() => {}).finally(() => { goplsStartingPromise = null; });
  return goplsStartingPromise;
}

function sendDocOpen(absPath, uri) {
  let text;
  try { text = fs.readFileSync(absPath, "utf8"); } catch { return false; }
  const version = (openDocs.get(uri) || 0) + 1;
  openDocs.set(uri, version);
  const uriKey = normUri(uri);
  goplsDiagnostics.delete(uriKey);
  goplsEmptyCount.set(uriKey, 0);
  goplsDocOpenTime.set(uriKey, Date.now());

  if (version === 1) {
    goplsProc.stdin.write(lspNotify("textDocument/didOpen", {
      textDocument: { uri, languageId: "go", version, text },
    }));
  } else {
    goplsProc.stdin.write(lspNotify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    }));
  }
  return true;
}

async function queryLsp(root, files) {
  if (!goplsProc || !goplsReady || goplsRoot !== root) {
    await startGopls(root);
  }

  const DIAG_TIMEOUT = 25000;
  const uris = files.map(f => {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    return { abs, uri: fileUri(abs) };
  });

  for (const { abs, uri } of uris) sendDocOpen(abs, uri);

  const results = await Promise.all(uris.map(({ uri }) => waitForDiag(uri, DIAG_TIMEOUT)));
  return results.flat();
}

// --- go build fallback ---
let cachedGoPath = null;
function findGo() {
  if (cachedGoPath) return cachedGoPath;
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(whichCmd, ["go"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (r.status === 0) {
    const lines = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const preferred = (process.platform === "win32" ? lines.find(l => l.endsWith(".exe")) : null) || lines[0];
    if (preferred) { cachedGoPath = preferred; return preferred; }
  }
  return null;
}

function findGoMod(filePath, fallbackRoot) {
  let dir = path.dirname(path.isAbsolute(filePath) ? filePath : path.resolve(fallbackRoot, filePath));
  const root = path.parse(dir).root;
  while (true) {
    const candidate = path.join(dir, "go.mod");
    if (fs.existsSync(candidate)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }
  return null;
}

function runGoBuild(root, files) {
  const goPath = findGo();
  if (!goPath) return { error: "go not found" };

  const modDir = files.length > 0 ? findGoMod(files[0], root) : null;
  const cwd = modDir || root;

  let result;
  try {
    result = spawnSync(goPath, ["build", "./..."], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true, timeout: 30000,
    });
  } catch (e) { return { error: `go exec: ${e.message}` }; }
  if (result.error) {
    return { error: result.error.code === "ETIMEDOUT" ? "go build timeout" : result.error.message };
  }

  const targetFiles = files.map(f =>
    path.relative(cwd, path.isAbsolute(f) ? f : path.resolve(root, f)).replace(/\\/g, "/")
  );
  const issues = [];
  const output = (result.stderr || "") + "\n" + (result.stdout || "");
  const lineRe = /^(.+?):(\d+):\d+:\s*(.+)$/gm;
  let m;
  while ((m = lineRe.exec(output)) !== null) {
    const file = m[1].replace(/\\/g, "/").replace(/^\.\//, "");
    const line = parseInt(m[2], 10);
    const detail = m[3];
    if (targetFiles.length === 0 || targetFiles.some(tf => file === tf || file.endsWith("/" + tf))) {
      issues.push({ file, line, kind: "type_error", detail, source: "go-deep-layer" });
    }
  }
  return { issues };
}

// --- Main request handler ---
async function handleRequest(req) {
  const root = req.root;
  const files = req.files || [];
  const t0 = Date.now();

  if (!goplsProc && !goplsStartingPromise) {
    eagerWarmUp(root);
  }

  // Warm path
  if (goplsWarmedUp && goplsProc && goplsReady && goplsRoot === root) {
    try {
      const tOpen = Date.now();
      const issues = await queryLsp(root, files);
      const tDone = Date.now();
      return { issues, elapsed_ms: tDone - t0, timing: { open_ms: tOpen - t0, diag_ms: tDone - tOpen } };
    } catch (lspErr) {
      const goResult = runGoBuild(root, files);
      if (!goResult.error) {
        goResult.elapsed_ms = Date.now() - t0;
        goResult.fallback = `lsp: ${lspErr.message}`;
        return goResult;
      }
      return { issues: [], elapsed_ms: Date.now() - t0, error: `lsp: ${lspErr.message}; go: ${goResult.error}` };
    }
  }

  // Cold/bootstrap: race LSP vs go build
  const lspPromise = (async () => {
    try {
      if (!goplsProc && !goplsStartingPromise) eagerWarmUp(root);
      if (goplsStartingPromise) await goplsStartingPromise;
      const issues = await queryLsp(root, files);
      return { issues, elapsed_ms: Date.now() - t0 };
    } catch {
      return null;
    }
  })();

  const goPromise = new Promise(resolve => {
    setImmediate(() => {
      const result = runGoBuild(root, files);
      if (!result.error) {
        result.elapsed_ms = Date.now() - t0;
        result.bootstrap = true;
        resolve(result);
      } else {
        resolve(null);
      }
    });
  });

  const budgetPromise = new Promise(resolve => {
    setTimeout(() => resolve("timeout"), BOOTSTRAP_BUDGET_MS);
  });

  const race = await Promise.race([lspPromise, budgetPromise]);
  if (race !== "timeout" && race !== null) return race;

  const goResult = await goPromise;
  if (goResult) return goResult;

  const lspResult = await lspPromise;
  if (lspResult) return lspResult;

  return { issues: [], elapsed_ms: Date.now() - t0, error: "bootstrap: both gopls and go build failed" };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", line => {
  line = line.trim();
  if (!line) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  handleRequest(req).then(resp => {
    process.stdout.write(JSON.stringify(resp) + "\n");
  }).catch(e => {
    process.stdout.write(JSON.stringify({ error: String(e), elapsed_ms: 0 }) + "\n");
  });
});
rl.on("close", () => { killGopls(); });

process.on("exit", killGopls);
