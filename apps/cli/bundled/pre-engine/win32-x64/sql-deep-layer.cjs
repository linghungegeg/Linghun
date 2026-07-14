"use strict";
const readline = require("readline");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

function findSqlfluff() {
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(whichCmd, ["sqlfluff"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (r.status === 0) {
    const line = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
    return line || null;
  }
  return null;
}

function runSqlfluff(root, files) {
  const sqlfluff = findSqlfluff();
  if (!sqlfluff) return null;

  const absPaths = files.map(f => path.isAbsolute(f) ? f : path.join(root, f));
  const args = ["lint", "--format", "json", "--nocolor", ...absPaths];
  let r;
  try {
    r = spawnSync(sqlfluff, args, {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true, timeout: 30000,
    });
  } catch (e) { return { error: `sqlfluff exec: ${e.message}` }; }

  if (r.error) {
    return { error: r.error.code === "ETIMEDOUT" ? "sqlfluff timeout" : r.error.message };
  }

  const issues = [];
  const output = r.stdout || "";
  try {
    const parsed = JSON.parse(output);
    for (const fileEntry of parsed) {
      const filePath = fileEntry.filepath || "";
      const rel = path.relative(root, filePath).replace(/\\/g, "/");
      for (const violation of (fileEntry.violations || [])) {
        issues.push({
          file: rel,
          line: violation.start_line_no || violation.line_no || 1,
          col: violation.start_line_pos || violation.line_pos || 1,
          kind: "sql_error",
          message: violation.description || violation.message || "SQL lint error",
          code: violation.code || null,
          source: "sql-deep-layer",
        });
      }
    }
  } catch {
    const lines = output.split(/\r?\n/);
    for (const l of lines) {
      const m = l.match(/^(.+?):(\d+):(\d+):\s*(.+)/);
      if (m) {
        issues.push({
          file: path.relative(root, m[1]).replace(/\\/g, "/"),
          line: parseInt(m[2], 10), col: parseInt(m[3], 10),
          kind: "sql_error", message: m[4], source: "sql-deep-layer",
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
    let parenDepth = 0;
    let inSingleQuote = false;
    let unclosedQuoteLine = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (ch === "'" && (j === 0 || line[j - 1] !== "'")) {
          if (!inSingleQuote) { inSingleQuote = true; unclosedQuoteLine = i + 1; }
          else { inSingleQuote = false; }
        }
        if (!inSingleQuote) {
          if (ch === "(") parenDepth++;
          else if (ch === ")") parenDepth--;
        }
      }
      if (inSingleQuote && i < lines.length - 1) {
        if (!lines[i + 1].includes("'")) {
          issues.push({ file: rel, line: unclosedQuoteLine, col: 1,
            kind: "syntax_error", message: "Unclosed string literal",
            source: "sql-deep-layer" });
          inSingleQuote = false;
        }
      }
    }
    if (inSingleQuote) {
      issues.push({ file: rel, line: unclosedQuoteLine, col: 1,
        kind: "syntax_error", message: "Unclosed string literal at end of file",
        source: "sql-deep-layer" });
    }
    if (parenDepth > 0) {
      issues.push({ file: rel, line: 1, col: 1,
        kind: "syntax_error", message: `Unmatched opening parenthesis (${parenDepth} unclosed)`,
        source: "sql-deep-layer" });
    } else if (parenDepth < 0) {
      issues.push({ file: rel, line: 1, col: 1,
        kind: "syntax_error", message: `Unmatched closing parenthesis (${-parenDepth} extra)`,
        source: "sql-deep-layer" });
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

  const sqlfluffResult = runSqlfluff(root, files);
  if (sqlfluffResult && !sqlfluffResult.error) {
    return {
      issues: sqlfluffResult.issues,
      status: sqlfluffResult.issues.length > 0 ? "sql_error" : "clean",
      reason: "sqlfluff",
      elapsed_ms: Date.now() - t0,
    };
  }

  const fallbackIssues = fallbackSyntaxCheck(root, files);
  if (sqlfluffResult && sqlfluffResult.error) {
    return {
      issues: fallbackIssues,
      status: "fallback_used",
      reason: "fallback",
      fallback: sqlfluffResult.error,
      elapsed_ms: Date.now() - t0,
    };
  }

  return {
    issues: fallbackIssues,
    status: "fallback_used",
    reason: fallbackIssues.length > 0 ? "fallback" : "fallback_clean",
    fallback: "sqlfluff_not_found",
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
