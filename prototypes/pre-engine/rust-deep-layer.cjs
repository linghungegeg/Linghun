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

// Normalize URI for Map keying — rust-analyzer lowercases drive letters on Windows
function normUri(uri) { return uri.toLowerCase(); }

// --- rust-analyzer session state ---
let raProc = null;
let raRoot = null;
let raReady = false;
let raBuffer = "";
let raExpectedLen = -1;
let raInitResolve = null;
let raInitReject = null;
let raDiagnostics = new Map(); // normUri -> issue[]
let raDiagTimers = new Map();  // normUri -> settle timer
let raDiagWaiters = []; // { uri: normUri, resolve }
let openDocs = new Map(); // uri -> version
let raDocOpenTime = new Map(); // normUri -> timestamp when file was opened
let raEmptyCount = new Map(); // normUri -> count of consecutive empty publishDiagnostics
let raWarmedUp = false; // true after first non-empty diagnostic from this server instance
let raStartingPromise = null; // non-null while startRustAnalyzer is in progress (eager warm)

const BOOTSTRAP_BUDGET_MS = 3000; // max wait for LSP on cold first query before cargo fallback
const WARM_SETTLE_MS = 1500; // max wait for empty diagnostics on warm server to confirm "clean"

function findRustAnalyzer() {
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(whichCmd, ["rust-analyzer"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (r.status === 0) {
    const line = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
    return line || null;
  }
  return null;
}

function killRa() {
  if (raProc) { try { raProc.kill(); } catch {} raProc = null; }
  raReady = false;
  raWarmedUp = false;
  raStartingPromise = null;
  raInitResolve = null;
  raInitReject = null;
  raDiagWaiters.forEach(w => w.resolve([]));
  raDiagWaiters = [];
  raDiagTimers.forEach(t => clearTimeout(t));
  raDiagTimers.clear();
  openDocs.clear();
  raDocOpenTime.clear();
  raEmptyCount.clear();
}

// LSP message parser (Content-Length framing)
function onRaData(chunk) {
  raBuffer += chunk.toString();
  while (true) {
    if (raExpectedLen === -1) {
      const headerEnd = raBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = raBuffer.slice(0, headerEnd);
      const m = header.match(/Content-Length:\s*(\d+)/i);
      if (!m) { raBuffer = raBuffer.slice(headerEnd + 4); continue; }
      raExpectedLen = parseInt(m[1], 10);
      raBuffer = raBuffer.slice(headerEnd + 4);
    }
    if (raBuffer.length < raExpectedLen) break;
    const body = raBuffer.slice(0, raExpectedLen);
    raBuffer = raBuffer.slice(raExpectedLen);
    raExpectedLen = -1;
    handleRaMessage(body);
  }
}

function handleRaMessage(body) {
  let msg;
  try { msg = JSON.parse(body); } catch { return; }

  // Server-initiated requests need an ACK or LSP session hangs
  if (msg.method && msg.id != null) {
    raProc.stdin.write(lspEncode({ jsonrpc: "2.0", id: msg.id, result: null }));
    return;
  }

  // Initialize response (must check msg.result exists to distinguish from notifications)
  if (msg.id && msg.result !== undefined && raInitResolve && !raReady) {
    raProc.stdin.write(lspNotify("initialized", {}));
    raReady = true;
    const resolve = raInitResolve;
    raInitResolve = null;
    raInitReject = null;
    resolve();
    return;
  }

  // publishDiagnostics notification
  if (msg.method === "textDocument/publishDiagnostics" && msg.params) {
    const { uri, diagnostics } = msg.params;
    const uriKey = normUri(uri);
    const issues = (diagnostics || [])
      .filter(d => d.severity === 1) // 1 = Error
      .map(d => ({
        file: uriToRel(uri),
        line: (d.range && d.range.start) ? d.range.start.line + 1 : 1,
        kind: "type_error",
        detail: d.message || "unknown error",
        source: "rust-deep-layer",
      }));
    raDiagnostics.set(uriKey, issues);
    if (raDiagTimers.has(uriKey)) clearTimeout(raDiagTimers.get(uriKey));
    if (issues.length > 0) {
      // Non-empty: errors are definitive, resolve waiters immediately
      raWarmedUp = true;
      raEmptyCount.set(uriKey, 0);
      raDiagTimers.delete(uriKey);
      raDiagWaiters = raDiagWaiters.filter(w => {
        if (w.uri === uriKey) { w.resolve(issues); return false; }
        return true;
      });
    } else if (raWarmedUp) {
      // Warm server + empty diagnostics: track consecutive empties
      const count = (raEmptyCount.get(uriKey) || 0) + 1;
      raEmptyCount.set(uriKey, count);
      // 2+ consecutive empties = confirmed clean, resolve immediately
      if (count >= 2) {
        raDiagTimers.delete(uriKey);
        raDiagWaiters = raDiagWaiters.filter(w => {
          if (w.uri === uriKey) { w.resolve([]); return false; }
          return true;
        });
      } else {
        // First empty: settle with reduced timeout
        const openedAt = raDocOpenTime.get(uriKey) || 0;
        const elapsed = Date.now() - openedAt;
        const remaining = Math.max(0, WARM_SETTLE_MS - elapsed);
        raDiagTimers.set(uriKey, setTimeout(() => {
          raDiagTimers.delete(uriKey);
          const final = raDiagnostics.get(uriKey) || [];
          raDiagWaiters = raDiagWaiters.filter(w => {
            if (w.uri === uriKey) { w.resolve(final); return false; }
            return true;
          });
        }, remaining));
      }
    }
    // Cold server + empty diagnostics: do NOT accept early.
    // Let waitForDiag's DIAG_TIMEOUT be the backstop — real errors will
    // arrive later and resolve immediately via the non-empty branch above.
  }
}

function uriToRel(uri) {
  // file:///abs/path -> relative to raRoot
  const decoded = decodeURIComponent(uri.replace(/^file:\/\/\/?/, "").replace(/^([a-z]):/, (_, d) => d.toUpperCase() + ":"));
  if (raRoot) {
    let rel = path.relative(raRoot, decoded).replace(/\\/g, "/");
    if (!rel.startsWith("..")) return rel;
  }
  return decoded.replace(/\\/g, "/");
}

function waitForDiag(uri, timeoutMs) {
  const uriKey = normUri(uri);
  return new Promise(resolve => {
    // Return immediately if we have settled diagnostics (no pending debounce)
    if (raDiagnostics.has(uriKey) && !raDiagTimers.has(uriKey)) {
      resolve(raDiagnostics.get(uriKey));
      return;
    }
    const timer = setTimeout(() => {
      raDiagWaiters = raDiagWaiters.filter(w => w.resolve !== resolve);
      resolve(raDiagnostics.get(uriKey) || []);
    }, timeoutMs);
    raDiagWaiters.push({ uri: uriKey, resolve: issues => { clearTimeout(timer); resolve(issues); } });
  });
}

function startRustAnalyzer(root) {
  return new Promise((resolve, reject) => {
    const raPath = findRustAnalyzer();
    if (!raPath) { reject(new Error("rust-analyzer not found")); return; }

    raRoot = root;
    raDiagnostics.clear();
    openDocs.clear();
    raWarmedUp = false;
    raBuffer = "";
    raExpectedLen = -1;
    raReady = false;

    raProc = spawn(raPath, [], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    raProc.on("error", e => { raProc = null; reject(e); });
    raProc.on("exit", () => { raProc = null; raReady = false; });
    raProc.stdout.on("data", chunk => onRaData(chunk));

    raInitResolve = resolve;
    raInitReject = reject;

    raProc.stdin.write(lspRequest("initialize", {
      processId: process.pid,
      capabilities: { textDocument: { publishDiagnostics: { relatedInformation: false } } },
      rootUri: fileUri(root),
      workspaceFolders: [{ uri: fileUri(root), name: path.basename(root) }],
      initializationOptions: {
        checkOnSave: false,
        diagnostics: { enable: true },
        cargo: { buildScripts: { enable: false } },
        procMacro: { enable: false },
      },
    }));

    setTimeout(() => {
      if (!raReady) { killRa(); reject(new Error("rust-analyzer init timeout (15s)")); }
    }, 15000);
  });
}

// Eagerly start rust-analyzer for a root without blocking. Triggers workspace
// loading by opening lib.rs or main.rs so subsequent queries hit a warm server.
function eagerWarmUp(root) {
  if (raStartingPromise) return raStartingPromise;
  raStartingPromise = startRustAnalyzer(root).then(() => {
    // Open a sentinel file to trigger workspace loading
    const candidates = ["src/lib.rs", "src/main.rs"];
    for (const rel of candidates) {
      const abs = path.join(root, rel);
      if (fs.existsSync(abs)) {
        sendDocOpen(abs, fileUri(abs));
        break;
      }
    }
  }).catch(() => {}).finally(() => { raStartingPromise = null; });
  return raStartingPromise;
}

// Send didOpen (or didChange if already open) to force re-read from disk
function sendDocOpen(absPath, uri) {
  let text;
  try { text = fs.readFileSync(absPath, "utf8"); } catch { return false; }
  const version = (openDocs.get(uri) || 0) + 1;
  openDocs.set(uri, version);
  const uriKey = normUri(uri);
  raDiagnostics.delete(uriKey); // invalidate stale cache
  raEmptyCount.set(uriKey, 0); // reset consecutive empty counter
  raDocOpenTime.set(uriKey, Date.now());

  if (version === 1) {
    raProc.stdin.write(lspNotify("textDocument/didOpen", {
      textDocument: { uri, languageId: "rust", version, text },
    }));
  } else {
    raProc.stdin.write(lspNotify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    }));
  }
  return true;
}

// Main LSP-based query: returns { issues, elapsed_ms } or throws
async function queryLsp(root, files) {
  if (!raProc || !raReady || raRoot !== root) {
    await startRustAnalyzer(root);
  }

  const DIAG_TIMEOUT = 25000;
  const uris = files.map(f => {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    return { abs, uri: fileUri(abs) };
  });

  // open / refresh each file
  for (const { abs, uri } of uris) sendDocOpen(abs, uri);

  // wait for diagnostics for each URI
  const results = await Promise.all(uris.map(({ uri }) => waitForDiag(uri, DIAG_TIMEOUT)));
  const issues = results.flat();
  return issues;
}

// --- cargo-check fallback (unchanged from Phase 6-C) ---
let cachedCargoPath = null;
function findCargo() {
  if (cachedCargoPath) return cachedCargoPath;
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(whichCmd, ["cargo"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (r.status === 0) {
    const lines = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const preferred = (process.platform === "win32" ? lines.find(l => l.endsWith(".exe")) : null) || lines[0];
    if (preferred) { cachedCargoPath = preferred; return preferred; }
  }
  return null;
}

// Walk up from a file path to find the nearest Cargo.toml
function findManifest(filePath, fallbackRoot) {
  let dir = path.dirname(path.isAbsolute(filePath) ? filePath : path.resolve(fallbackRoot, filePath));
  const root = path.parse(dir).root;
  while (true) {
    const candidate = path.join(dir, "Cargo.toml");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }
  return null;
}

function runCargoCheck(root, files) {
  const cargoPath = findCargo();
  if (!cargoPath) return { error: "cargo not found" };

  // Find nearest Cargo.toml from the first changed file
  const manifest = files.length > 0 ? findManifest(files[0], root) : null;
  const args = manifest
    ? ["check", "--manifest-path", manifest, "--message-format=json"]
    : ["check", "--message-format=json"];
  const cwd = manifest ? path.dirname(manifest) : root;

  let result;
  try {
    result = spawnSync(cargoPath, args, {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true, timeout: 30000,
    });
  } catch (e) { return { error: `cargo exec: ${e.message}` }; }
  if (result.error) {
    return { error: result.error.code === "ETIMEDOUT" ? "cargo check timeout" : result.error.message };
  }
  const manifestRoot = manifest ? path.dirname(manifest) : root;
  const targetFiles = files.map(f =>
    path.relative(manifestRoot, path.isAbsolute(f) ? f : path.resolve(root, f)).replace(/\\/g, "/")
  );
  const issues = [];
  for (const line of (result.stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.reason !== "compiler-message") continue;
    const diag = msg.message;
    if (!diag || diag.level !== "error") continue;
    const spans = diag.spans || [];
    const span = spans.find(s => s.is_primary) || spans[0];
    if (!span) continue;
    const rel = (span.file_name || "").replace(/\\/g, "/");
    if (!targetFiles.includes(rel)) continue;
    issues.push({ file: rel, line: span.line_start || 1, kind: "type_error", detail: diag.message || "unknown", source: "rust-deep-layer" });
  }
  return { issues };
}

// --- Main request handler ---
// Primary path: rust-analyzer LSP (rich diagnostics, warm incremental).
// Fallback: cargo check when LSP unavailable, init fails, or times out.
// Bootstrap: first query on cold server uses a short budget — if LSP can't
// deliver in time, falls back to cargo-check while LSP continues warming.
async function handleRequest(req) {
  const root = req.root;
  const files = req.files || [];
  const t0 = Date.now();

  // If server not started yet, kick off eager warm-up for next time
  if (!raProc && !raStartingPromise) {
    eagerWarmUp(root);
  }

  // Warm path: LSP is ready and has proven it works
  if (raWarmedUp && raProc && raReady && raRoot === root) {
    try {
      const tOpen = Date.now();
      const issues = await queryLsp(root, files);
      const tDone = Date.now();
      return { issues, elapsed_ms: tDone - t0, timing: { open_ms: tOpen - t0, diag_ms: tDone - tOpen } };
    } catch (lspErr) {
      const cargoResult = runCargoCheck(root, files);
      if (!cargoResult.error) {
        cargoResult.elapsed_ms = Date.now() - t0;
        cargoResult.fallback = `lsp: ${lspErr.message}`;
        return cargoResult;
      }
      return { issues: [], elapsed_ms: Date.now() - t0, error: `lsp: ${lspErr.message}; cargo: ${cargoResult.error}` };
    }
  }

  // Cold/bootstrap path: race LSP against cargo-check truly in parallel.
  // LSP continues warming in background regardless of who wins.
  const lspPromise = (async () => {
    try {
      const tInit = Date.now();
      // Don't block on raStartingPromise — let it run concurrently with cargo
      if (!raProc && !raStartingPromise) eagerWarmUp(root);
      if (raStartingPromise) await raStartingPromise;
      const tOpen = Date.now();
      const issues = await queryLsp(root, files);
      const tDone = Date.now();
      return { issues, elapsed_ms: tDone - t0, timing: { init_ms: tOpen - tInit, open_ms: tOpen - t0, diag_ms: tDone - tOpen } };
    } catch (e) {
      return null; // LSP failed
    }
  })();

  // Start cargo-check immediately in parallel (sync but on a separate "lane")
  const cargoPromise = new Promise(resolve => {
    setImmediate(() => {
      const tCargo = Date.now();
      const result = runCargoCheck(root, files);
      if (!result.error) {
        result.elapsed_ms = Date.now() - t0;
        result.bootstrap = true;
        result.timing = { cargo_ms: Date.now() - tCargo };
        resolve(result);
      } else {
        resolve(null); // cargo failed
      }
    });
  });

  const budgetPromise = new Promise(resolve => {
    setTimeout(() => resolve("timeout"), BOOTSTRAP_BUDGET_MS);
  });

  // Race: LSP wins if it delivers before budget, otherwise cargo wins immediately
  const race = await Promise.race([lspPromise, budgetPromise]);
  if (race !== "timeout" && race !== null) {
    return race; // LSP delivered within budget
  }

  // Budget expired — take cargo result (already running in parallel)
  const cargoResult = await cargoPromise;
  if (cargoResult) return cargoResult;

  // Cargo also failed — wait for LSP result (it's still running)
  const lspResult = await lspPromise;
  if (lspResult) return lspResult;

  return { issues: [], elapsed_ms: Date.now() - t0, error: "bootstrap: both LSP and cargo failed" };
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
rl.on("close", () => { killRa(); });

process.on("exit", killRa);
