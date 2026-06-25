"use strict";
const readline = require("readline");
const path = require("path");
const { spawnSync } = require("child_process");

function findRuby() {
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(whichCmd, ["ruby"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (r.status === 0) {
    const line = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
    return line || null;
  }
  return null;
}

function runRubyCheck(root, files) {
  const ruby = findRuby();
  if (!ruby) return null;

  const issues = [];
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    let r;
    try {
      r = spawnSync(ruby, ["-c", abs], {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true, timeout: 30000,
      });
    } catch (e) { continue; }

    if (r.error) continue;

    if (r.status !== 0) {
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      const stderr = (r.stderr || "").trim();
      const m = stderr.match(/^.+?:(\d+):\s*(.+)$/m);
      if (m) {
        issues.push({
          file: rel,
          line: parseInt(m[1], 10),
          col: 1,
          kind: "error",
          message: m[2].trim(),
          source: "ruby-deep-layer",
        });
      } else {
        issues.push({
          file: rel, line: 1, col: 1,
          kind: "error", message: stderr.split(/\r?\n/)[0] || "syntax error",
          source: "ruby-deep-layer",
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

  const lintResult = runRubyCheck(root, files);
  if (lintResult) {
    return {
      issues: lintResult.issues,
      status: lintResult.issues.length > 0 ? "ruby_error" : "clean",
      reason: "ruby",
      elapsed_ms: Date.now() - t0,
    };
  }

  return {
    issues: [],
    status: "unavailable",
    reason: "ruby_not_found",
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
