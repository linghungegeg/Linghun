"use strict";
const readline = require("readline");
const path = require("path");
const { spawnSync } = require("child_process");

const CPP_EXTS = new Set([".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"]);

function isCppFile(f) {
  const ext = path.extname(f).toLowerCase();
  return CPP_EXTS.has(ext);
}

function findToolchain() {
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const candidates = isCppFile.__lastWasCpp
    ? ["clang++", "g++", "clang", "gcc"]
    : ["clang", "gcc", "clang++", "g++"];
  for (const cmd of ["clang", "clang++", "gcc", "g++"]) {
    const r = spawnSync(whichCmd, [cmd], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    });
    if (r.status === 0) {
      const line = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
      if (line) return { bin: cmd, path: line };
    }
  }
  return null;
}

function pickCompiler(file, toolchain) {
  const ext = path.extname(file).toLowerCase();
  const isCpp = CPP_EXTS.has(ext);
  if (isCpp) {
    if (toolchain.bin === "clang" || toolchain.bin === "clang++") return "clang++";
    return "g++";
  }
  if (toolchain.bin === "clang++" || toolchain.bin === "clang") return "clang";
  return "gcc";
}

function runCheck(root, files) {
  const toolchain = findToolchain();
  if (!toolchain) return null;

  const issues = [];
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    const compiler = pickCompiler(f, toolchain);
    const args = ["-fsyntax-only", abs];
    let r;
    try {
      r = spawnSync(compiler, args, {
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
