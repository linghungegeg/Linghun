"use strict";
const readline = require("readline");
const path = require("path");
const { spawnSync } = require("child_process");

const CPP_EXTS = new Set([".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"]);

function isCppExt(file) {
  return CPP_EXTS.has(path.extname(file).toLowerCase());
}

const toolCache = new Map();

function whichCmd(cmd) {
  if (toolCache.has(cmd)) return toolCache.get(cmd);
  const which = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(which, [cmd], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  const found = r.status === 0 &&
    r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
  toolCache.set(cmd, found || null);
  return found || null;
}

function findCompilerForFile(file) {
  if (isCppExt(file)) {
    if (whichCmd("clang++")) return "clang++";
    if (whichCmd("g++")) return "g++";
    return null;
  }
  if (whichCmd("clang")) return "clang";
  if (whichCmd("gcc")) return "gcc";
  return null;
}

function runCheck(root, files) {
  const issues = [];

  for (const f of files) {
    const compiler = findCompilerForFile(f);
    if (!compiler) return null;

    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    const args = ["-fsyntax-only", abs];
    let r;
    try {
      r = spawnSync(compiler, args, {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true, timeout: 60000,
      });
    } catch (e) {
      return null;
    }

    if (r.error) {
      return null;
    }

    if (r.status !== 0) {
      const output = (r.stderr || "") + (r.stdout || "");
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      const lines = output.split(/\r?\n/);
      let found = false;
      for (const line of lines) {
        const m = line.match(/^.+?:(\d+):(\d+):\s*(error|warning|fatal error):\s*(.+)$/);
        if (m) {
          const kind = m[3].includes("error") ? "error" : "warning";
          issues.push({
            file: rel,
            line: parseInt(m[1], 10),
            col: parseInt(m[2], 10),
            kind,
            message: m[4].trim(),
            source: "cpp-deep-layer",
          });
          found = true;
        }
      }
      if (!found) {
        const firstLine = lines.find(l => l.trim()) || "compilation error";
        issues.push({
          file: rel, line: 1, col: 1,
          kind: "error", message: firstLine.trim(),
          source: "cpp-deep-layer",
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

  const result = runCheck(root, files);
  if (result) {
    return {
      issues: result.issues,
      status: result.issues.length > 0 ? "cpp_error" : "clean",
      reason: "cpp_toolchain",
      elapsed_ms: Date.now() - t0,
    };
  }

  return {
    issues: [],
    status: "unavailable",
    reason: "cpp_toolchain_not_found",
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
