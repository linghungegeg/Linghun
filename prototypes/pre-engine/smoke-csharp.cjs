"use strict";
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const helper = spawn("node", [path.join(__dirname, "csharp-deep-layer.cjs")], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "pipe"],
});

const root = path.join(__dirname, "fixtures", "smoke-csharp").replace(/\\/g, "/");

const queries = [
  { root, files: ["SyntaxError.cs"] },
  { root, files: ["Valid.cs"] },
];

let buf = "";
let idx = 0;
const results = [];

function queryWithEnv(query, env) {
  const result = spawnSync(process.execPath, [path.join(__dirname, "csharp-deep-layer.cjs")], {
    cwd: __dirname,
    env,
    input: `${JSON.stringify(query)}\n`,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || `helper exited ${result.status}`);
  return JSON.parse(result.stdout.trim());
}

function queryWithoutTool(query) {
  return queryWithEnv(query, { ...process.env, PATH: path.dirname(process.execPath) });
}

function queryWithFailingDotnet() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-csharp-failing-dotnet-"));
  const toolRoot = path.join(tempRoot, "tools");
  fs.mkdirSync(toolRoot);
  fs.writeFileSync(path.join(tempRoot, "Fixture.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\" />\n");
  fs.writeFileSync(path.join(tempRoot, "Valid.cs"), "class Valid {}\n");
  if (process.platform === "win32") {
    const fakeDotnet = path.join(toolRoot, "dotnet.exe");
    try {
      fs.linkSync(process.execPath, fakeDotnet);
    } catch {
      fs.copyFileSync(process.execPath, fakeDotnet);
    }
  } else {
    const tool = path.join(toolRoot, "dotnet");
    fs.writeFileSync(tool, "#!/bin/sh\nexit 9\n");
    fs.chmodSync(tool, 0o755);
  }
  try {
    return queryWithEnv(
      { root: tempRoot, files: ["Valid.cs"] },
      { ...process.env, PATH: `${toolRoot}${path.delimiter}${process.env.PATH || ""}` },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function sendNext() {
  if (idx < queries.length) {
    helper.stdin.write(JSON.stringify(queries[idx]) + "\n");
  } else {
    helper.stdin.end();
  }
}

helper.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    const resp = JSON.parse(line);
    results.push(resp);
    idx++;
    sendNext();
  }
});

helper.on("close", () => {
  const r1 = results[0];
  const r2 = results[1];
  const missing = queryWithoutTool({ root, files: ["Valid.cs"] });
  const failing = queryWithFailingDotnet();

  console.log("=== C# Deep Layer Smoke Test ===\n");
  const mode = r1.fallback ? "fallback" : r1.reason || "unknown";
  console.log(`Q1 [SyntaxError.cs]: ${r1.elapsed_ms}ms, issues=${(r1.issues||[]).length}, mode=${mode}`);
  console.log(`Q2 [Valid.cs]:       ${r2.elapsed_ms}ms, issues=${(r2.issues||[]).length}`);
  console.log(`Q3 [tool missing]:   status=${missing.status}, fallback=${missing.fallback}`);
  console.log(`Q4 [tool failed]:    status=${failing.status}, fallback=${failing.fallback}`);

  const checks = [];

  const funcPass = r1.issues && r1.issues.length > 0 &&
    r1.issues[0].source === "csharp-deep-layer";
  checks.push({ name: "A. Functional (SyntaxError has issues)", pass: funcPass });

  const okPass = r2.issues && r2.issues.length === 0;
  checks.push({ name: "B. Clean (Valid.cs is clean)", pass: okPass });

  const reasonOk = ["dotnet", "fallback", "fallback_clean"].includes(r1.reason);
  checks.push({ name: "C. Reason semantics valid", pass: reasonOk });
  const normalStatusPass = r1.reason === "dotnet"
    ? r1.status === "csharp_error" && r2.status === "clean"
    : r1.status === "fallback_used" && r2.status === "fallback_used";
  checks.push({ name: "D. Normal validator status is explicit", pass: normalStatusPass });
  checks.push({ name: "E. Tool missing uses fallback", pass: missing.status === "fallback_used" });
  checks.push({ name: "F. Tool missing names fallback", pass: missing.fallback === "dotnet_not_found" });
  checks.push({ name: "G. Nonzero dotnet result is never clean", pass: failing.status === "fallback_used" });
  checks.push({ name: "H. Nonzero dotnet result reports execution gap", pass: /exited with status/.test(failing.fallback) });

  let allPass = true;
  console.log("\n--- Results ---");
  for (const c of checks) {
    const mark = c.pass ? "PASS" : "FAIL";
    console.log(`  ${mark}: ${c.name}`);
    if (!c.pass) allPass = false;
  }

  if (allPass) {
    console.log("\nSMOKE CSHARP: PASS");
  } else {
    console.log("\nSMOKE CSHARP: FAIL");
    process.exitCode = 1;
  }
});

sendNext();
