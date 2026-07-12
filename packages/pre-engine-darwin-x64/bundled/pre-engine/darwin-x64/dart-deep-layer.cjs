"use strict";
const readline = require("readline");
const path = require("path");
const { spawnSync } = require("child_process");

const CMD_ARGV_TEMPLATE =
  '""%LINGHUN_DART_TOOL%" "%LINGHUN_DART_ARG_0%" "%LINGHUN_DART_ARG_1%""';
const UNSAFE_BATCH_ARGUMENT = /[&|<>^%!\r\n]/;

function findDart() {
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(whichCmd, ["dart"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (r.status === 0) {
    const lines = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const preferred = process.platform === "win32"
      ? lines.find(line => /\.(?:bat|cmd|exe)$/i.test(line))
      : null;
    return preferred || lines[0] || null;
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
      const dartArgs = ["analyze", abs];
      const isBatch = process.platform === "win32" && /\.(?:bat|cmd)$/i.test(dart);
      if (isBatch && [dart, ...dartArgs].some(value => UNSAFE_BATCH_ARGUMENT.test(value))) {
        return { error: "unsafe_batch_argument", reason: "unsafe_batch_argument" };
      }
      const command = isBatch ? process.env.ComSpec || "cmd.exe" : dart;
      const args = isBatch
        ? ["/d", "/v:off", "/s", "/c", CMD_ARGV_TEMPLATE]
        : dartArgs;
      r = spawnSync(command, args, {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true, timeout: 60000,
        windowsVerbatimArguments: isBatch,
        env: isBatch
          ? {
              ...process.env,
              LINGHUN_DART_TOOL: dart,
              LINGHUN_DART_ARG_0: dartArgs[0],
              LINGHUN_DART_ARG_1: dartArgs[1],
            }
          : process.env,
      });
    } catch (e) {
      return { error: `dart analyze failed: ${e.message}` };
    }

    if (r.error) {
      const reason = r.error.code === "ETIMEDOUT" ? "dart analyze timeout" : r.error.message;
      return { error: reason };
    }

    const output = (r.stdout || "") + (r.stderr || "");
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*(info|warning|error)\s*[-•]\s*(.+?):(\d+):(\d+)\s*[-•]\s*(.+?)(?:\s*[-•]\s*([a-z0-9_]+))?\s*$/i);
      if (m) {
        const rel = path.relative(root, abs).replace(/\\/g, "/");
        issues.push({
          file: rel,
          line: parseInt(m[3], 10),
          col: parseInt(m[4], 10),
          kind: m[1] === "info" ? "warning" : m[1],
          message: m[5].trim(),
          code: m[6] || null,
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
    if (r.status !== 0 && issues.length === 0) {
      return { error: `dart analyze exited ${r.status} without parseable diagnostics` };
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
  if (lintResult && !lintResult.error) {
    return {
      issues: lintResult.issues,
      status: lintResult.issues.length > 0 ? "dart_error" : "clean",
      reason: "dart",
      elapsed_ms: Date.now() - t0,
    };
  }

  if (lintResult && lintResult.error) {
    const unsafeArgument = lintResult.reason === "unsafe_batch_argument";
    return {
      issues: [],
      status: unsafeArgument ? "error" : "unavailable",
      reason: unsafeArgument ? "unsafe_batch_argument" : "dart_execution_failed",
      error: lintResult.error,
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
