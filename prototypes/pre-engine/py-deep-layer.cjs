"use strict";
const readline = require("readline");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

let cachedPyrightPath = null;
let cachedRoot = null;

function findPyright(root) {
  if (cachedPyrightPath && cachedRoot === root) return cachedPyrightPath;

  const candidates = [
    path.join(root, "node_modules", ".bin", "pyright"),
    path.join(root, "node_modules", ".bin", "pyright.cmd"),
  ];
  const fs = require("fs");
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      cachedPyrightPath = c;
      cachedRoot = root;
      return c;
    }
  }

  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(whichCmd, ["pyright"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  if (result.status === 0) {
    const lines = result.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    // On Windows prefer .cmd over extensionless shell script
    const preferred = lines.find(l => l.endsWith(".cmd")) || lines[0];
    if (preferred) {
      cachedPyrightPath = preferred;
      cachedRoot = root;
      return preferred;
    }
  }

  try {
    const resolved = require.resolve("pyright");
    if (resolved) {
      cachedPyrightPath = resolved;
      cachedRoot = root;
      return resolved;
    }
  } catch {}

  return null;
}

function runCheck(root, files, pyrightconfig) {
  const pyrightPath = findPyright(root);
  if (!pyrightPath) return { error: "pyright not found" };

  const args = ["--outputjson"];
  if (pyrightconfig) {
    args.push("--project", pyrightconfig);
  }
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    args.push(abs);
  }

  let result;
  try {
    const isCmd = pyrightPath.endsWith(".cmd");
    const cmd = isCmd ? process.env.ComSpec || "cmd.exe" : pyrightPath;
    const execArgs = isCmd ? ["/c", pyrightPath, ...args] : args;

    result = spawnSync(cmd, execArgs, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: 30000,
    });
  } catch (e) {
    return { error: `pyright exec failed: ${e.message}` };
  }

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      return { error: "pyright timeout (30s)" };
    }
    return { error: `pyright spawn error: ${result.error.message}` };
  }

  const stdout = result.stdout || "";
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    if (result.status === 0) return { issues: [] };
    return { error: `pyright non-json output (exit=${result.status})` };
  }

  const issues = [];
  const diagnostics = parsed.generalDiagnostics || [];
  for (const d of diagnostics) {
    if (d.severity !== "error") continue;
    const filePath = d.file || "";
    const rel = path.isAbsolute(filePath)
      ? path.relative(root, filePath).replace(/\\/g, "/")
      : filePath.replace(/\\/g, "/");

    const targetFiles = files.map(f =>
      (path.isAbsolute(f) ? path.relative(root, f) : f).replace(/\\/g, "/")
    );
    if (!targetFiles.includes(rel)) continue;

    issues.push({
      file: rel,
      line: (d.range && d.range.start && d.range.start.line != null)
        ? d.range.start.line + 1
        : 1,
      kind: "type_error",
      detail: d.message || "unknown error",
      source: "python-deep-layer",
    });
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
    const result = runCheck(req.root, req.files || [], req.pyrightconfig || null);
    resp = { ...result, elapsed_ms: Date.now() - t0 };
  } catch (e) {
    resp = { error: String(e), elapsed_ms: Date.now() - t0 };
  }
  process.stdout.write(JSON.stringify(resp) + "\n");
});
