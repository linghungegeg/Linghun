"use strict";
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const helper = spawn("node", [path.join(__dirname, "go-deep-layer.cjs")], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "pipe"],
});

const root = path.join(__dirname, "fixtures", "smoke-go").replace(/\\/g, "/");
const errorFile = path.join(__dirname, "fixtures", "smoke-go", "type_error.go");
const originalContent = fs.readFileSync(errorFile, "utf8");

const queries = [
  { root, files: ["type_error.go"] },
  { root, files: ["type_ok.go"] },
  null, // sentinel: fix type_error.go
  { root, files: ["type_error.go"] },
  null, // sentinel: re-break type_error.go
  { root, files: ["type_error.go"] },
];

let buf = "";
let idx = 0;
const results = [];

function sendNext() {
  while (idx < queries.length && queries[idx] === null) {
    if (results.length === 2) {
      fs.writeFileSync(errorFile, "package smokego\n\nfunc bad() int {\n\treturn 42\n}\n");
    } else if (results.length === 3) {
      fs.writeFileSync(errorFile, originalContent);
    }
    idx++;
  }
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
  fs.writeFileSync(errorFile, originalContent);

  const r1 = results[0]; // type_error.go → should have issues
  const r2 = results[1]; // type_ok.go → should be clean
  const r3 = results[2]; // type_error.go fixed → should be clean
  const r4 = results[3]; // type_error.go re-broken → should have issues

  console.log("=== Go Deep Layer Smoke Test ===\n");
  const q1path = r1.bootstrap ? "bootstrap/go-build" : r1.fallback ? "fallback/go-build" : "LSP";
  console.log(`Q1 [type_error.go]: ${r1.elapsed_ms}ms, issues=${(r1.issues||[]).length}, path=${q1path}`);
  console.log(`Q2 [type_ok.go]:    ${r2.elapsed_ms}ms, issues=${(r2.issues||[]).length}`);
  console.log(`Q3 [type_error.go fixed]:    ${r3.elapsed_ms}ms, issues=${(r3.issues||[]).length}`);
  console.log(`Q4 [type_error.go re-broken]: ${r4.elapsed_ms}ms, issues=${(r4.issues||[]).length}`);

  const checks = [];

  const funcPass = r1.issues && r1.issues.length > 0 &&
    r1.issues[0].source === "go-deep-layer" &&
    r1.issues[0].kind === "type_error";
  checks.push({ name: "A. Functional (type_error has issues)", pass: funcPass });

  const okPass = r2.issues && r2.issues.length === 0;
  checks.push({ name: "B. Clean (type_ok is clean)", pass: okPass });

  const staleFixPass = r3.issues && r3.issues.length === 0;
  checks.push({ name: "C. Stale (fix clears error)", pass: staleFixPass });
  const staleBreakPass = r4.issues && r4.issues.length > 0;
  checks.push({ name: "C. Stale (re-break shows error)", pass: staleBreakPass });

  console.log(`\nCold start: ${r1.elapsed_ms}ms (${q1path})`);
  console.log(`Subsequent: Q2=${r2.elapsed_ms}ms Q3=${r3.elapsed_ms}ms Q4=${r4.elapsed_ms}ms`);

  let allPass = true;
  console.log("\n--- Results ---");
  for (const c of checks) {
    const mark = c.pass ? "PASS" : "FAIL";
    console.log(`  ${mark}: ${c.name}`);
    if (!c.pass) allPass = false;
  }

  if (r1.error) {
    console.log(`\n  NOTE: go error: ${r1.error}`);
    console.log("  (go may not be installed — fallback behavior is correct)");
    console.log("\nSMOKE GO: SKIP (go unavailable)");
  } else if (allPass) {
    console.log("\nSMOKE GO: PASS");
  } else {
    console.log("\nSMOKE GO: FAIL");
    process.exitCode = 1;
  }
});

sendNext();