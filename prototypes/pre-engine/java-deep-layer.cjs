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

// --- jdtls session state ---
let jdtlsProc = null;
let jdtlsRoot = null;
let jdtlsReady = false;
let jdtlsBuffer = "";
let jdtlsExpectedLen = -1;
let jdtlsInitResolve = null;
let jdtlsInitReject = null;
let jdtlsDiagnostics = new Map();
let jdtlsDiagTimers = new Map();
let jdtlsDiagWaiters = [];
let openDocs = new Map();
let jdtlsDocOpenTime = new Map();
let jdtlsEmptyCount = new Map();
let jdtlsWarmedUp = false;
let jdtlsStartingPromise = null;

const BOOTSTRAP_BUDGET_MS = 5000;
const WARM_SETTLE_MS = 2000;

function findJdtls() {
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(whichCmd, ["jdtls"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (r.status === 0) {
    const line = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
    return line || null;
  }
  return null;
}

function killJdtls() {
  if (jdtlsProc) { try { jdtlsProc.kill(); } catch {} jdtlsProc = null; }
  jdtlsReady = false;
  jdtlsWarmedUp = false;
  jdtlsStartingPromise = null;
  jdtlsInitResolve = null;
  jdtlsInitReject = null;
  jdtlsDiagWaiters.forEach(w => w.resolve([]));
  jdtlsDiagWaiters = [];
  jdtlsDiagTimers.forEach(t => clearTimeout(t));
  jdtlsDiagTimers.clear();
  openDocs.clear();
  jdtlsDocOpenTime.clear();
  jdtlsEmptyCount.clear();
}

function onJdtlsData(chunk) {
  jdtlsBuffer += chunk.toString();
  while (true) {
    if (jdtlsExpectedLen === -1) {
      const headerEnd = jdtlsBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = jdtlsBuffer.slice(0, headerEnd);
      const m = header.match(/Content-Length:\s*(\d+)/i);
      if (!m) { jdtlsBuffer = jdtlsBuffer.slice(headerEnd + 4); continue; }
      jdtlsExpectedLen = parseInt(m[1], 10);
      jdtlsBuffer = jdtlsBuffer.slice(headerEnd + 4);
    }
    if (jdtlsBuffer.length < jdtlsExpectedLen) break;
    const body = jdtlsBuffer.slice(0, jdtlsExpectedLen);
    jdtlsBuffer = jdtlsBuffer.slice(jdtlsExpectedLen);
    jdtlsExpectedLen = -1;
    handleJdtlsMessage(body);
  }
}

function handleJdtlsMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  if (msg.id && jdtlsInitResolve && !jdtlsReady) {
    jdtlsReady = true;
    jdtlsProc.stdin.write(lspNotify("initialized", {}));
    jdtlsInitResolve();
    jdtlsInitResolve = null;
    jdtlsInitReject = null;
    return;
  }

  if (msg.method === "textDocument/publishDiagnostics") {
    const uri = normUri(msg.params.uri);
    const diags = msg.params.diagnostics || [];
    jdtlsDiagnostics.set(uri, diags);

    if (diags.length > 0) {
      jdtlsEmptyCount.set(uri, 0);
      for (const w of jdtlsDiagWaiters.filter(x => x.uri === uri)) {
        clearTimeout(w.timer);
        w.resolve(diags);
      }
      jdtlsDiagWaiters = jdtlsDiagWaiters.filter(x => x.uri !== uri);
    } else {
      const count = (jdtlsEmptyCount.get(uri) || 0) + 1;
      jdtlsEmptyCount.set(uri, count);
      if (jdtlsWarmedUp && count >= 2) {
        for (const w of jdtlsDiagWaiters.filter(x => x.uri === uri)) {
          clearTimeout(w.timer);
          w.resolve([]);
        }
        jdtlsDiagWaiters = jdtlsDiagWaiters.filter(x => x.uri !== uri);
      }
    }
  }
}

function uriToRel(uri, root) {
  let p = uri.replace(/^file:\/\/\/?/, "");
  p = decodeURIComponent(p).replace(/\//g, path.sep);
  if (process.platform === "win32" && /^[a-zA-Z]:/.test(p)) {
    // already absolute
  } else if (!path.isAbsolute(p)) {
    p = path.join(root, p);
  }
  return path.relative(root, p).replace(/\\/g, "/");
}

function waitForDiag(uri, timeoutMs) {
  return new Promise((resolve) => {
    const existing = jdtlsDiagnostics.get(uri);
    if (existing && existing.length > 0) { resolve(existing); return; }
    if (jdtlsWarmedUp && (jdtlsEmptyCount.get(uri) || 0) >= 2) { resolve([]); return; }

    const timer = setTimeout(() => {
      jdtlsDiagWaiters = jdtlsDiagWaiters.filter(x => x !== entry);
      resolve(jdtlsDiagnostics.get(uri) || []);
    }, timeoutMs);
    const entry = { uri, resolve, timer };
    jdtlsDiagWaiters.push(entry);
  });
}

function startJdtls(root) {
  if (jdtlsStartingPromise) return jdtlsStartingPromise;
  jdtlsStartingPromise = new Promise((resolve, reject) => {
    const bin = findJdtls();
    if (!bin) { resolve(false); return; }
    jdtlsRoot = root;
    jdtlsInitResolve = () => resolve(true);
    jdtlsInitReject = reject;
    const dataDir = path.join(root, ".jdtls-data-" + process.pid);
    jdtlsProc = spawn(bin, ["-data", dataDir], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    jdtlsProc.stdout.on("data", onJdtlsData);
    jdtlsProc.on("error", (e) => { if (jdtlsInitReject) { jdtlsInitReject(e); jdtlsInitReject = null; } });
    jdtlsProc.on("close", () => { jdtlsReady = false; });

    const initParams = {
      processId: process.pid,
      rootUri: fileUri(root),
      capabilities: { textDocument: { publishDiagnostics: { relatedInformation: true } } },
      workspaceFolders: [{ uri: fileUri(root), name: path.basename(root) }],
    };
    jdtlsProc.stdin.write(lspRequest("initialize", initParams));

    setTimeout(() => {
      if (!jdtlsReady && jdtlsInitResolve) {
        jdtlsInitResolve = null;
        jdtlsInitReject = null;
        resolve(false);
      }
    }, BOOTSTRAP_BUDGET_MS);
  });
  return jdtlsStartingPromise;
}

function eagerWarmUp(root, files) {
  let candidates = [];
  if (files && files.length > 0) {
    candidates = files.map(f => path.isAbsolute(f) ? f : path.join(root, f));
  } else {
    try {
      const entries = fs.readdirSync(root);
      candidates = entries
        .filter(e => e.endsWith(".java"))
        .slice(0, 5)
        .map(e => path.join(root, e));
    } catch {}
    if (candidates.length === 0) {
      const srcDir = path.join(root, "src");
      try {
        const entries = fs.readdirSync(srcDir);
        candidates = entries
          .filter(e => e.endsWith(".java"))
          .slice(0, 5)
          .map(e => path.join(srcDir, e));
      } catch {}
    }
  }
  for (const fp of candidates) {
    if (fs.existsSync(fp)) sendDocOpen(fp);
  }
  setTimeout(() => { jdtlsWarmedUp = true; }, WARM_SETTLE_MS);
}

function sendDocOpen(filePath) {
  const uri = fileUri(filePath);
  const nuri = normUri(uri);
  let text;
  try { text = fs.readFileSync(filePath, "utf8"); } catch { return; }
  if (openDocs.has(nuri)) {
    const version = (openDocs.get(nuri) || 0) + 1;
    openDocs.set(nuri, version);
    jdtlsEmptyCount.set(nuri, 0);
    jdtlsDiagnostics.delete(nuri);
    jdtlsProc.stdin.write(lspNotify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    }));
  } else {
    openDocs.set(nuri, 1);
    jdtlsEmptyCount.set(nuri, 0);
    jdtlsDocOpenTime.set(nuri, Date.now());
    jdtlsProc.stdin.write(lspNotify("textDocument/didOpen", {
      textDocument: { uri, languageId: "java", version: 1, text },
    }));
  }
}

function queryLsp(root, files) {
  const results = [];
  const promises = files.map(f => {
    const fp = path.isAbsolute(f) ? f : path.join(root, f);
    sendDocOpen(fp);
    const uri = normUri(fileUri(fp));
    return waitForDiag(uri, WARM_SETTLE_MS + 3000).then(diags => {
      for (const d of diags) {
        if (d.severity && d.severity > 1) continue;
        results.push({
          file: path.relative(root, fp).replace(/\\/g, "/"),
          line: (d.range?.start?.line || 0) + 1,
          col: (d.range?.start?.character || 0) + 1,
          message: d.message || "error",
          source: "java-deep-layer",
          kind: "type_error",
        });
      }
    });
  });
  return Promise.all(promises).then(() => results);
}

function findJavac() {
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(whichCmd, ["javac"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (r.status === 0) {
    const line = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
    return line || null;
  }
  return null;
}

function readSmallText(filePath, maxBytes = 65536) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return "";
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function explicitJavaClasspath() {
  return process.env.LINGHUN_PRE_ENGINE_JAVA_CLASSPATH ||
    process.env.JAVA_CLASSPATH ||
    process.env.CLASSPATH ||
    "";
}

function rootHasAndroidBuildMarker(root) {
  const candidates = [
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "app/build.gradle",
    "app/build.gradle.kts",
    "android/build.gradle",
    "android/build.gradle.kts",
    "android/app/build.gradle",
    "android/app/build.gradle.kts",
    "app/android/build.gradle",
    "app/android/build.gradle.kts",
    "app/android/app/build.gradle",
    "app/android/app/build.gradle.kts",
  ];
  for (const rel of candidates) {
    const text = readSmallText(path.join(root, rel));
    if (/com\.android\.(application|library)|\bandroid\s*\{/m.test(text)) return true;
  }
  return fs.existsSync(path.join(root, "AndroidManifest.xml")) ||
    fs.existsSync(path.join(root, "app", "src", "main", "AndroidManifest.xml")) ||
    fs.existsSync(path.join(root, "android", "app", "src", "main", "AndroidManifest.xml")) ||
    fs.existsSync(path.join(root, "app", "android", "app", "src", "main", "AndroidManifest.xml"));
}

function hasNearbyAndroidManifest(absPath) {
  const normalized = absPath.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const marker = "/src/main/java/";
  const idx = lower.indexOf(marker);
  if (idx === -1) return false;
  return fs.existsSync(normalized.slice(0, idx) + "/src/main/AndroidManifest.xml");
}

function fileHasAndroidImports(absPath) {
  const text = readSmallText(absPath);
  return /^\s*import\s+(android|androidx)\./m.test(text) ||
    /^\s*package\s+io\.flutter\.plugins\b/m.test(text);
}

function isAndroidJavaContext(root, files) {
  const absPaths = files.map(f => path.isAbsolute(f) ? f : path.join(root, f));
  for (const fp of absPaths) {
    const rel = path.relative(root, fp).replace(/\\/g, "/").toLowerCase();
    if (!rel.endsWith(".java")) continue;
    if (rel.includes("/android/") || hasNearbyAndroidManifest(fp) || fileHasAndroidImports(fp)) return true;
  }
  if (!rootHasAndroidBuildMarker(root)) return false;
  return absPaths.some(fp => path.relative(root, fp).replace(/\\/g, "/").toLowerCase().includes("/src/main/java/"));
}

function runJavac(root, files) {
  const javac = findJavac();
  if (!javac) return null;
  const absPaths = files.map(f => path.isAbsolute(f) ? f : path.join(root, f));
  const outDir = path.join(root, "__javac_out__");
  try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
  const args = ["-J-Duser.language=en", "-J-Duser.country=US", "-d", outDir, "-Xlint:all"];
  const classpath = explicitJavaClasspath();
  if (classpath) args.push("-classpath", classpath);
  args.push(...absPaths);
  const r = spawnSync(javac, args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 15000,
  });
  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  if (r.status === 0) return [];
  const issues = [];
  const re = /^(.+?):(\d+):\s*(?:error|错误):\s*(.+)$/gm;
  const output = (r.stderr || "") + (r.stdout || "");
  let m;
  while ((m = re.exec(output)) !== null) {
    const rel = path.relative(root, m[1]).replace(/\\/g, "/");
    issues.push({ file: rel, line: parseInt(m[2], 10), col: 1, message: m[3], source: "java-deep-layer", kind: "type_error" });
  }
  return issues;
}

async function handleRequest(req) {
  const t0 = Date.now();
  const root = req.root || process.cwd();
  const files = req.files || [];
  if (files.length === 0) {
    return { issues: [], status: "clean", reason: "no_files", elapsed_ms: 0 };
  }

  if (isAndroidJavaContext(root, files) && !explicitJavaClasspath()) {
    return {
      issues: [],
      status: "unavailable",
      reason: "android_classpath_required",
      error: "android_classpath_required: Android Java requires the Gradle/Android SDK classpath; skipping bare javac pre_verify",
      elapsed_ms: Date.now() - t0,
    };
  }

  const javacResult = runJavac(root, files);
  if (javacResult !== null && javacResult.length > 0) {
    return { issues: javacResult, status: "type_error", reason: "javac", elapsed_ms: Date.now() - t0, bootstrap: true };
  }
  if (javacResult !== null && javacResult.length === 0) {
    return { issues: [], status: "clean", reason: "javac_clean", elapsed_ms: Date.now() - t0, bootstrap: true };
  }

  const lspOk = await startJdtls(root);
  if (lspOk) {
    eagerWarmUp(root, files);
    const lspIssues = await queryLsp(root, files);
    const elapsed = Date.now() - t0;
    if (lspIssues.length > 0) {
      return { issues: lspIssues, status: "type_error", reason: "jdtls", elapsed_ms: elapsed };
    }
    return { issues: [], status: "clean", reason: "jdtls_clean", elapsed_ms: elapsed };
  }

  return { issues: [], status: "unavailable", reason: "no_javac_no_jdtls", error: "neither javac nor jdtls found", elapsed_ms: Date.now() - t0 };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try { req = JSON.parse(trimmed); } catch { return; }
  handleRequest(req).then((result) => {
    process.stdout.write(JSON.stringify(result) + "\n");
  }).catch((err) => {
    process.stdout.write(JSON.stringify({ issues: [], status: "error", error: String(err), elapsed_ms: 0 }) + "\n");
  });
});
rl.on("close", () => { killJdtls(); process.exit(0); });
