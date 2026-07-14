"use strict";
const readline = require("readline");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");

let powershellBridge;

function getPowershellBridge() {
  if (powershellBridge) return powershellBridge;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-argv-bridge-"));
  powershellBridge = path.join(dir, "invoke.ps1");
  fs.writeFileSync(powershellBridge, [
    "$tool = $args[0]",
    "$toolArgs = @()",
    "if ($args.Count -gt 1) { $toolArgs = @($args[1..($args.Count - 1)]) }",
    "& $tool @toolArgs",
    "exit $LASTEXITCODE",
  ].join("\r\n"));
  process.once("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
  return powershellBridge;
}

function spawnToolSync(command, args, options) {
  if (process.platform === "win32" && /\.(bat|cmd)$/i.test(command)) {
    if ([command, ...args].some(value => /[&|<>^%!"\r\n]/.test(value))) {
      const error = new Error("unsafe .bat/.cmd tool path or argument");
      error.code = "UNSAFE_BATCH_ARGUMENT";
      return { status: null, stdout: "", stderr: "", error };
    }
    const powershell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    return spawnSync(powershell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-File",
      getPowershellBridge(), command, ...args,
    ], { ...options, shell: false });
  }
  return spawnSync(command, args, { ...options, shell: false });
}

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
    if (whichCmd("clang++")) return whichCmd("clang++");
    if (whichCmd("g++")) return whichCmd("g++");
    return null;
  }
  if (whichCmd("clang")) return whichCmd("clang");
  if (whichCmd("gcc")) return whichCmd("gcc");
  return null;
}

function runCheck(root, files) {
  const issues = [];
  const compilers = files.map(findCompilerForFile);
  if (compilers.some(compiler => !compiler)) return null;

  for (let index = 0; index < files.length; index++) {
    const f = files[index];
    const compiler = compilers[index];

    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    const args = ["-fsyntax-only", abs];
    let r;
    try {
      r = spawnToolSync(compiler, args, {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true, timeout: 60000,
      });
    } catch (e) {
      return { issues: [], error: `compiler execution failed: ${e.message}` };
    }

    if (r.error) {
      const message = r.error.code === "ETIMEDOUT" ? "compiler check timed out" : r.error.message;
      return { issues: [], error: message };
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
    return { issues: [], status: "not_covered", reason: "no_files", elapsed_ms: 0 };
  }

  const result = runCheck(root, files);
  if (result) {
    if (result.error) {
      return {
        issues: [],
        status: "error",
        reason: "cpp_toolchain_execution_failed",
        error: result.error,
        elapsed_ms: Date.now() - t0,
      };
    }
    return {
      issues: result.issues,
      status: result.issues.length > 0 ? "cpp_error" : "clean",
      reason: "cpp_toolchain",
      elapsed_ms: Date.now() - t0,
    };
  }

  return {
    issues: [],
    status: "tool_missing",
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
