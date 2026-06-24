"use strict";
const readline = require("readline");
const path = require("path");
const fs = require("fs");

let ts = null;
let cachedHost = null;
let cachedOpts = null;
let cachedFileNames = null;
let cachedRoot = null;
let cachedTsconfigPath = null;
let currentProgram = null;
let fileStatCache = new Map();
let knownProjectFiles = new Set();

function updateStatCache(absPath) {
  try {
    const st = fs.statSync(absPath);
    const cached = fileStatCache.get(absPath);
    const changed = !cached || cached.mtimeMs !== st.mtimeMs || cached.size !== st.size;
    fileStatCache.set(absPath, { mtimeMs: st.mtimeMs, size: st.size });
    return changed;
  } catch {
    fileStatCache.delete(absPath);
    return true;
  }
}

function tryResolveTs(root) {
  for (const c of [path.join(root, "node_modules", "typescript"), "typescript"]) {
    try { return require(c); } catch {}
  }
  return null;
}

function ensureSetup(root, tsconfigPath) {
  if (!ts) {
    ts = tryResolveTs(root);
    if (!ts) return "typescript not available";
  }
  if (cachedRoot === root && cachedTsconfigPath === tsconfigPath) return null;

  let opts = { noEmit: true, strict: false, skipLibCheck: true };
  let fileNames = [];

  if (tsconfigPath) {
    const cfgFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (!cfgFile.error) {
      const parsed = ts.parseJsonConfigFileContent(cfgFile.config, ts.sys, path.dirname(tsconfigPath));
      opts = { ...parsed.options, noEmit: true };
      fileNames = parsed.fileNames;
    }
  }

  cachedOpts = opts;
  cachedFileNames = fileNames;
  cachedHost = ts.createCompilerHost(opts);
  cachedRoot = root;
  cachedTsconfigPath = tsconfigPath;
  currentProgram = null;
  fileStatCache.clear();
  knownProjectFiles.clear();
  return null;
}

function runCheck(root, files, tsconfigPath) {
  const err = ensureSetup(root, tsconfigPath);
  if (err) return { error: err };

  const absFiles = files.map(f => path.isAbsolute(f) ? f : path.join(root, f));
  for (const f of absFiles) knownProjectFiles.add(f);
  const allFiles = [...new Set([...cachedFileNames, ...knownProjectFiles])];

  let anyStatChanged = false;
  for (const f of absFiles) {
    if (updateStatCache(f)) anyStatChanged = true;
  }
  let needRebuild = !currentProgram || anyStatChanged;
  if (!needRebuild) {
    for (const f of absFiles) {
      if (!currentProgram.getSourceFile(path.normalize(f))) {
        needRebuild = true;
        break;
      }
    }
  }

  if (needRebuild) {
    currentProgram = ts.createProgram(allFiles, cachedOpts, cachedHost, currentProgram);
    const normalRoot = path.normalize(root) + path.sep;
    for (const sf of currentProgram.getSourceFiles()) {
      const sfPath = path.normalize(sf.fileName);
      if (sfPath.startsWith(normalRoot) && !fileStatCache.has(sfPath)) {
        updateStatCache(sfPath);
      }
    }
  }

  const issues = [];
  for (const f of absFiles) {
    const sf = currentProgram.getSourceFile(path.normalize(f));
    if (!sf) continue;
    const diags = [
      ...currentProgram.getSemanticDiagnostics(sf),
      ...currentProgram.getSyntacticDiagnostics(sf),
    ];
    for (const d of diags) {
      if (d.category !== 1) continue;
      const rel = path.relative(root, sf.fileName).replace(/\\/g, "/");
      let line = 1;
      if (d.file && d.start != null) {
        const lc = d.file.getLineAndCharacterOfPosition(d.start);
        line = lc.line + 1;
      }
      issues.push({
        file: rel,
        line,
        kind: "type_error",
        detail: ts.flattenDiagnosticMessageText(d.messageText, " "),
        source: "typescript-deep-layer",
      });
    }
  }
  return { issues };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", line => {
  line = line.trim();
  if (!line) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const t0 = Date.now();
  let resp;
  try {
    const result = runCheck(req.root, req.files || [], req.tsconfig || null);
    resp = { ...result, elapsed_ms: Date.now() - t0 };
  } catch (e) {
    resp = { error: String(e), elapsed_ms: Date.now() - t0 };
  }
  process.stdout.write(JSON.stringify(resp) + "\n");
});
