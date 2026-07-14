"use strict";
const readline = require("readline");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

function findShellcheck() {
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(whichCmd, ["shellcheck"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (r.status === 0) {
    const line = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
    return line || null;
  }
  return null;
}

function runShellcheck(root, files) {
  const shellcheck = findShellcheck();
  if (!shellcheck) return null;

  const absPaths = files.map(f => path.isAbsolute(f) ? f : path.join(root, f));
  const args = ["--format=json1", "--severity=warning", ...absPaths];
  let r;
  try {
    r = spawnSync(shellcheck, args, {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true, timeout: 30000,
    });
  } catch (e) { return { error: `shellcheck exec: ${e.message}` }; }

  if (r.error) {
    return { error: r.error.code === "ETIMEDOUT" ? "shellcheck timeout" : r.error.message };
  }

  const issues = [];
  const output = r.stdout || "";
  try {
    const parsed = JSON.parse(output);
    const comments = parsed.comments || parsed;
    for (const c of (Array.isArray(comments) ? comments : [])) {
      const filePath = c.file || "";
      const rel = path.relative(root, filePath).replace(/\\/g, "/");
      issues.push({
        file: rel,
        line: c.line || 1,
        col: c.column || 1,
        kind: c.level || "warning",
        message: c.message || "shellcheck issue",
        code: c.code ? `SC${c.code}` : null,
        source: "shell-deep-layer",
      });
    }
  } catch {
    const lines = output.split(/\r?\n/);
    for (const l of lines) {
      const m = l.match(/^(.+?):(\d+):(\d+):\s*(warning|error|info):\s*(.+)/);
      if (m) {
        issues.push({
          file: path.relative(root, m[1]).replace(/\\/g, "/"),
          line: parseInt(m[2], 10), col: parseInt(m[3], 10),
          kind: m[4], message: m[5], source: "shell-deep-layer",
        });
      }
    }
  }
  return { issues };
}

function fallbackSyntaxCheck(root, files) {
  const issues = [];
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    let content;
    try { content = fs.readFileSync(abs, "utf8"); } catch { continue; }
    const rel = path.relative(root, abs).replace(/\\/g, "/");
    const lines = content.split(/\r?\n/);

    let inSingleQuote = false, sqLine = 0;
    let inDoubleQuote = false, dqLine = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        const prev = j > 0 ? line[j - 1] : "";
        if (ch === "\\" && !inSingleQuote) { j++; continue; }
        if (ch === "'" && !inDoubleQuote) {
          if (!inSingleQuote) { inSingleQuote = true; sqLine = i + 1; }
          else { inSingleQuote = false; }
        } else if (ch === '"' && !inSingleQuote) {
          if (!inDoubleQuote) { inDoubleQuote = true; dqLine = i + 1; }
          else { inDoubleQuote = false; }
        }
      }
    }
    if (inSingleQuote) {
      issues.push({ file: rel, line: sqLine, col: 1,
        kind: "syntax_error", message: "Unclosed single quote",
        source: "shell-deep-layer" });
    }
    if (inDoubleQuote) {
      issues.push({ file: rel, line: dqLine, col: 1,
        kind: "syntax_error", message: "Unclosed double quote",
        source: "shell-deep-layer" });
    }
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

  const shellcheckResult = runShellcheck(root, files);
  if (shellcheckResult && !shellcheckResult.error) {
    return {
      issues: shellcheckResult.issues,
      status: shellcheckResult.issues.length > 0 ? "shell_error" : "clean",
      reason: "shellcheck",
      elapsed_ms: Date.now() - t0,
    };
  }

  const fallbackIssues = fallbackSyntaxCheck(root, files);
  if (shellcheckResult && shellcheckResult.error) {
    return {
      issues: fallbackIssues,
      status: "fallback_used",
      reason: "fallback",
      fallback: shellcheckResult.error,
      elapsed_ms: Date.now() - t0,
    };
  }

  return {
    issues: fallbackIssues,
    status: "fallback_used",
    reason: fallbackIssues.length > 0 ? "fallback" : "fallback_clean",
    fallback: "shellcheck_not_found",
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
