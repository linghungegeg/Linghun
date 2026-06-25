"use strict";
const readline = require("readline");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

function findDotnet() {
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(whichCmd, ["dotnet"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (r.status === 0) {
    const line = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
    return line || null;
  }
  return null;
}

function findProjectFile(root) {
  const entries = [];
  try { entries.push(...fs.readdirSync(root)); } catch { return null; }
  for (const e of entries) {
    if (e.endsWith(".csproj") || e.endsWith(".sln")) {
      return path.join(root, e);
    }
  }
  return null;
}

function runDotnetBuild(root, files) {
  const dotnet = findDotnet();
  if (!dotnet) return null;
  const proj = findProjectFile(root);
  if (!proj) return { error: "no .csproj/.sln found in root" };

  const args = ["build", proj, "--no-restore", "--nologo", "-v", "quiet"];
  let r;
  try {
    r = spawnSync(dotnet, args, {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true, timeout: 60000,
    });
  } catch (e) { return { error: `dotnet exec: ${e.message}` }; }

  if (r.error) {
    return { error: r.error.code === "ETIMEDOUT" ? "dotnet build timeout" : r.error.message };
  }

  const output = (r.stdout || "") + (r.stderr || "");
  const issues = [];
  const changedSet = new Set(files.map(f => path.basename(f).toLowerCase()));

  const lines = output.split(/\r?\n/);
  for (const l of lines) {
    const m = l.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(CS\d+):\s*(.+)/);
    if (m) {
      const file = m[1];
      const base = path.basename(file).toLowerCase();
      if (!changedSet.has(base)) continue;
      const rel = path.relative(root, file).replace(/\\/g, "/");
      issues.push({
        file: rel,
        line: parseInt(m[2], 10),
        col: parseInt(m[3], 10),
        kind: m[4],
        message: m[6],
        code: m[5],
        source: "csharp-deep-layer",
      });
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
    let inString = false, inVerbatim = false, inChar = false;
    let unclosedLine = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        const next = j + 1 < line.length ? line[j + 1] : "";

        if (inString) {
          if (ch === "\\" && !inVerbatim) { j++; continue; }
          if (ch === '"') {
            if (inVerbatim && next === '"') { j++; continue; }
            inString = false; inVerbatim = false;
          }
          continue;
        }
        if (inChar) {
          if (ch === "\\") { j++; continue; }
          if (ch === "'") inChar = false;
          continue;
        }
        if (ch === "/" && next === "/") break;
        if (ch === "/" && next === "*") {
          let closed = false;
          j += 2;
          while (j < line.length - 1) {
            if (line[j] === "*" && line[j + 1] === "/") { j++; closed = true; break; }
            j++;
          }
          if (!closed) {
            for (let k = i + 1; k < lines.length && !closed; k++) {
              const ci = lines[k].indexOf("*/");
              if (ci !== -1) { i = k; closed = true; }
            }
          }
          continue;
        }
        if (ch === '"') {
          if (next === '"' && j > 0 && line[j - 1] === '@') { inVerbatim = true; }
          else if (j > 0 && line[j - 1] === '@') { inVerbatim = true; }
          inString = true; unclosedLine = i + 1;
          continue;
        }
        if (ch === "'") { inChar = true; continue; }
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
      }
    }
    if (braceDepth > 0) {
      issues.push({ file: rel, line: lines.length, col: 1,
        kind: "syntax_error", message: `Unmatched opening brace (${braceDepth} unclosed)`,
        source: "csharp-deep-layer" });
    } else if (braceDepth < 0) {
      issues.push({ file: rel, line: 1, col: 1,
        kind: "syntax_error", message: `Unmatched closing brace (${-braceDepth} extra)`,
        source: "csharp-deep-layer" });
    }
    if (inString) {
      issues.push({ file: rel, line: unclosedLine, col: 1,
        kind: "syntax_error", message: "Unclosed string literal",
        source: "csharp-deep-layer" });
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

  const dotnetResult = runDotnetBuild(root, files);
  if (dotnetResult && !dotnetResult.error) {
    return {
      issues: dotnetResult.issues,
      status: dotnetResult.issues.length > 0 ? "csharp_error" : "clean",
      reason: "dotnet",
      elapsed_ms: Date.now() - t0,
    };
  }

  const fallbackIssues = fallbackSyntaxCheck(root, files);
  if (dotnetResult && dotnetResult.error) {
    return {
      issues: fallbackIssues,
      status: fallbackIssues.length > 0 ? "syntax_error" : "clean",
      reason: "fallback",
      fallback: dotnetResult.error,
      elapsed_ms: Date.now() - t0,
    };
  }

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
