"use strict";
const readline = require("readline");
const path = require("path");
const { spawnSync } = require("child_process");

function findDart() {
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(whichCmd, ["dart"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (r.status === 0) {
    const line = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
    return line || null;
  }
  return null;
}

function runDartCheck(root, files) {
  const dart = findDart();
  if (!dart) return null;

  const issues = [];
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    let r;
    try {
      r = spawnSync(dart, ["analyze", "--no-pub", abs], {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true, timeout: 60000,
      });
    } catch (e) { continue; }

    if (r.error) continue;

    const output = (r.stdout || "") + (r.stderr || "");
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*(info|warning|error)\s*[-•]\s*(.+?)\s*[-•]\s*(.+?):(\d+):(\d+)/);
      if (m) {
        const rel = path.relative(root, abs).replace(/\\/g, "/");
        issues.push({
          file: rel,
          line: parseInt(m[4], 10),
          col: parseInt(m[5], 10),
          kind: m[1] === "info" ? "warning" : m[1],
          message: m[2].trim(),
          source: "dart-deep-layer",
        });
        continue;
      }
      const m2 = line.match(/^\s*(.+?):(\d+):(\d+)\s*[-•]\s*(.*)/);
      if (m2) {
        const rel = path.relative(root, abs).replace(/\\/g, "/");
        issues.push({
          file: rel,
          line: parseInt(m2[2], 10),
          col: parseInt(m2[3], 10),
          kind: "error",
          message: m2[4].trim(),
          source: "dart-deep-layer",
        });
      }
    }
  }
  return { issues };
}

async function handleRequest(req) {
  const t0 = Date.now();
  const root = req.root || process.cwd();
  const files = req.files || [];
  if (files.length === 0) {
    return { issues: [], status: "clean", reason: "no_files", elapsed_ms: 0 };
  }

  const lintResult = runDartCheck(root, files);
  if (lintResult) {
    return {
      issues: lintResult.issues,
      status: lintResult.issues.length > 0 ? "dart_error" : "clean",
      reason: "dart",
      elapsed_ms: Date.now() - t0,
    };
  }

  return {
    issues: [],
    status: "unavailable",
    reason: "dart_not_found",
    elapsed_ms: Date.now() - t0,
  };
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
rl.on("close", () => { process.exit(0); });
