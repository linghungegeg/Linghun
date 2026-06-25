"use strict";
const readline = require("readline");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

function findPhp() {
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(whichCmd, ["php"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (r.status === 0) {
    const line = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
    return line || null;
  }
  return null;
}

function runPhpLint(root, files) {
  const php = findPhp();
  if (!php) return null;

  const issues = [];
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    let r;
    try {
      r = spawnSync(php, ["-l", abs], {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true, timeout: 30000,
      });
    } catch (e) { continue; }

    if (r.error) continue;

    const output = (r.stdout || "") + (r.stderr || "");
    if (r.status !== 0) {
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      const m = output.match(/Parse error:\s*(.+?)\s+in\s+.+?\s+on line\s+(\d+)/i);
      if (m) {
        issues.push({
          file: rel,
          line: parseInt(m[2], 10),
          col: 1,
          kind: "error",
          message: m[1],
          source: "php-deep-layer",
        });
      } else {
        const trimmed = output.trim().split(/\r?\n/)[0] || "syntax error";
        issues.push({
          file: rel, line: 1, col: 1,
          kind: "error", message: trimmed,
          source: "php-deep-layer",
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

    let braceDepth = 0;
    let inSingleQuote = false, inDoubleQuote = false;
    let inLineComment = false, inBlockComment = false;
    let inHeredoc = null;
    let unclosedLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (inHeredoc) {
        if (line.trim() === inHeredoc || line.trim() === inHeredoc + ";") {
          inHeredoc = null;
        }
        continue;
      }

      inLineComment = false;
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        const next = j + 1 < line.length ? line[j + 1] : "";

        if (inBlockComment) {
          if (ch === "*" && next === "/") { inBlockComment = false; j++; }
          continue;
        }
        if (inSingleQuote) {
          if (ch === "\\") { j++; continue; }
          if (ch === "'") inSingleQuote = false;
          continue;
        }
        if (inDoubleQuote) {
          if (ch === "\\") { j++; continue; }
          if (ch === '"') inDoubleQuote = false;
          continue;
        }
        if (inLineComment) continue;

        if (ch === "/" && next === "/") { inLineComment = true; continue; }
        if (ch === "#") { inLineComment = true; continue; }
        if (ch === "/" && next === "*") { inBlockComment = true; j++; continue; }
        if (ch === "'") { inSingleQuote = true; unclosedLine = i + 1; continue; }
        if (ch === '"') { inDoubleQuote = true; unclosedLine = i + 1; continue; }
        if (ch === "<" && next === "<" && j + 2 < line.length && line[j + 2] === "<") {
          const rest = line.slice(j + 3).trim().replace(/^'|'$/g, "").replace(/^"|"$/g, "");
          if (rest) { inHeredoc = rest; }
          break;
        }
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
      }
    }
    if (braceDepth > 0) {
      issues.push({ file: rel, line: lines.length, col: 1,
        kind: "syntax_error", message: `Unmatched opening brace (${braceDepth} unclosed)`,
        source: "php-deep-layer" });
    } else if (braceDepth < 0) {
      issues.push({ file: rel, line: 1, col: 1,
        kind: "syntax_error", message: `Unmatched closing brace (${-braceDepth} extra)`,
        source: "php-deep-layer" });
    }
    if (inDoubleQuote || inSingleQuote) {
      issues.push({ file: rel, line: unclosedLine, col: 1,
        kind: "syntax_error", message: "Unclosed string literal",
        source: "php-deep-layer" });
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

  const lintResult = runPhpLint(root, files);
  if (lintResult) {
    return {
      issues: lintResult.issues,
      status: lintResult.issues.length > 0 ? "php_error" : "clean",
      reason: "php",
      elapsed_ms: Date.now() - t0,
    };
  }

  const fallbackIssues = fallbackSyntaxCheck(root, files);
  return {
    issues: fallbackIssues,
    status: fallbackIssues.length > 0 ? "syntax_error" : "clean",
    reason: fallbackIssues.length > 0 ? "fallback" : "fallback_clean",
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
