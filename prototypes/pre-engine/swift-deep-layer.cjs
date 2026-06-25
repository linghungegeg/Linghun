"use strict";
const readline = require("readline");
const path = require("path");
const { spawnSync } = require("child_process");

function findSwiftc() {
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  for (const cmd of ["swiftc", "xcrun"]) {
    const r = spawnSync(whichCmd, [cmd], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    });
    if (r.status === 0) {
      const line = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
      if (line) return cmd === "xcrun" ? { mode: "xcrun", bin: line } : { mode: "swiftc", bin: line };
    }
  }
  return null;
}

function runSwiftcCheck(root, files) {
  const tool = findSwiftc();
  if (!tool) return null;

  const issues = [];
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    let args;
    if (tool.mode === "xcrun") {
      args = [tool.bin, ["swiftc", "-parse", abs]];
    } else {
      args = [tool.bin, ["-parse", abs]];
    }
    let r;
    try {
      r = spawnSync(args[0], args[1], {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true, timeout: 60000,
      });
    } catch (e) { continue; }

    if (r.error) continue;

    if (r.status !== 0) {
      const output = (r.stderr || "") + (r.stdout || "");
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      const lines = output.split(/\r?\n/);
      let found = false;
      for (const line of lines) {
        const m = line.match(/^.+?:(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/);
        if (m && m[3] !== "note") {
          issues.push({
            file: rel,
            line: parseInt(m[1], 10),
            col: parseInt(m[2], 10),
            kind: m[3] === "warning" ? "warning" : "error",
            message: m[4].trim(),
            source: "swift-deep-layer",
          });
          found = true;
        }
      }
      if (!found) {
        const firstLine = lines.find(l => l.trim()) || "compilation error";
        issues.push({
          file: rel, line: 1, col: 1,
          kind: "error", message: firstLine.trim(),
          source: "swift-deep-layer",
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

  const lintResult = runSwiftcCheck(root, files);
  if (lintResult) {
    return {
      issues: lintResult.issues,
      status: lintResult.issues.length > 0 ? "swift_error" : "clean",
      reason: "swiftc",
      elapsed_ms: Date.now() - t0,
    };
  }

  return {
    issues: [],
    status: "unavailable",
    reason: "swift_not_found",
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
