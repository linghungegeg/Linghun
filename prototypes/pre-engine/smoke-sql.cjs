"use strict";
const { spawn, spawnSync } = require("child_process");
const path = require("path");

const helper = spawn("node", [path.join(__dirname, "sql-deep-layer.cjs")], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "pipe"],
});

const root = path.join(__dirname, "fixtures", "smoke-sql").replace(/\\/g, "/");

const queries = [
  { root, files: ["syntax-error.sql"] },
  { root, files: ["valid.sql"] },
];

let buf = "";
let idx = 0;
const results = [];

function queryWithoutTool(query) {
  const result = spawnSync(process.execPath, [path.join(__dirname, "sql-deep-layer.cjs")], {
    cwd: __dirname,
    env: { ...process.env, PATH: path.dirname(process.execPath) },
    input: `${JSON.stringify(query)}\n`,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || `helper exited ${result.status}`);
  return JSON.parse(result.stdout.trim());
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
  const r1 = results[0]; // syntax-error.sql → should have issues
  const r2 = results[1]; // valid.sql → should be clean
  const missing = queryWithoutTool({ root, files: ["valid.sql"] });

  console.log("=== SQL Deep Layer Smoke Test ===\n");
  const mode = r1.fallback ? "fallback" : r1.reason || "unknown";
  console.log(`Q1 [syntax-error.sql]: ${r1.elapsed_ms}ms, issues=${(r1.issues||[]).length}, mode=${mode}`);
  console.log(`Q2 [valid.sql]:        ${r2.elapsed_ms}ms, issues=${(r2.issues||[]).length}`);
  console.log(`Q3 [tool missing]:     status=${missing.status}, fallback=${missing.fallback}`);

  const checks = [];

  const funcPass = r1.issues && r1.issues.length > 0 &&
    r1.issues[0].source === "sql-deep-layer";
  checks.push({ name: "A. Functional (syntax-error has issues)", pass: funcPass });

  const okPass = r2.issues && r2.issues.length === 0;
  checks.push({ name: "B. Clean (valid.sql is clean)", pass: okPass });
  const normalStatusPass = r1.reason === "sqlfluff"
    ? r1.status === "sql_error" && r2.status === "clean"
    : r1.status === "fallback_used" && r2.status === "fallback_used";
  checks.push({ name: "C. Normal validator status is explicit", pass: normalStatusPass });
  checks.push({ name: "D. Tool missing uses fallback", pass: missing.status === "fallback_used" });
  checks.push({ name: "E. Tool missing names fallback", pass: missing.fallback === "sqlfluff_not_found" });

  let allPass = true;
  console.log("\n--- Results ---");
  for (const c of checks) {
    const mark = c.pass ? "PASS" : "FAIL";
    console.log(`  ${mark}: ${c.name}`);
    if (!c.pass) allPass = false;
  }

  if (allPass) {
    console.log("\nSMOKE SQL: PASS");
  } else {
    console.log("\nSMOKE SQL: FAIL");
    process.exitCode = 1;
  }
});

sendNext();
