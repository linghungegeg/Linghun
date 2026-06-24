"use strict";
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const helper = spawn("node", [path.join(__dirname, "java-deep-layer.cjs")], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "pipe"],
});

const root = path.join(__dirname, "fixtures", "smoke-java").replace(/\\/g, "/");
const errorFile = path.join(__dirname, "fixtures", "smoke-java", "TypeError.java");
const originalContent = fs.readFileSync(errorFile, "utf8");

const queries = [
  { root, files: ["TypeError.java"] },
  { root, files: ["TypeOk.java"] },
  null, // sentinel: fix TypeError.java
  { root, files: ["TypeError.java"] },
  null, // sentinel: re-break TypeError.java
  { root, files: ["TypeError.java"] },
];

let buf = "";
let idx = 0;
const results = [];

function sendNext() {
  while (idx < queries.length && queries[idx] === null) {
    if (results.length === 2) {
      fs.writeFileSync(errorFile, 'public class TypeError {\n    public static void main(String[] args) {\n        String s = "fixed";\n    }\n}\n');
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

  const r1 = results[0]; // TypeError.java → should have issues
  const r2 = results[1]; // TypeOk.java → should be clean
  const r3 = results[2]; // TypeError.java fixed → should be clean
  const r4 = results[3]; // TypeError.java re-broken → should have issues

  console.log("=== Java Deep Layer Smoke Test ===\n");
  const q1path = r1.status === "unavailable" ? "unavailable" : r1.bootstrap ? "javac" : r1.reason === "jdtls" || r1.reason === "jdtls_clean" ? "jdtls" : r1.reason || "unknown";
  console.log(`Q1 [TypeError.java]: ${r1.elapsed_ms}ms, issues=${(r1.issues||[]).length}, path=${q1path}`);
  console.log(`Q2 [TypeOk.java]:    ${r2.elapsed_ms}ms, issues=${(r2.issues||[]).length}`);
  console.log(`Q3 [TypeError.java fixed]:    ${r3.elapsed_ms}ms, issues=${(r3.issues||[]).length}`);
  console.log(`Q4 [TypeError.java re-broken]: ${r4.elapsed_ms}ms, issues=${(r4.issues||[]).length}`);

  const checks = [];

  const funcPass = r1.issues && r1.issues.length > 0 &&
    r1.issues[0].source === "java-deep-layer" &&
    r1.issues[0].kind === "type_error";
  checks.push({ name: "A. Functional (TypeError has issues)", pass: funcPass });

  const okPass = r2.issues && r2.issues.length === 0;
  checks.push({ name: "B. Clean (TypeOk is clean)", pass: okPass });

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

  if (r1.status === "unavailable") {
    console.log(`\n  NOTE: ${r1.error || "no javac/jdtls"}`);
    console.log("  Helper explicitly reported unavailable — no functional verification possible.");
    console.log("\nSMOKE JAVA: SKIP (toolchain unavailable)");
  } else if (allPass) {
    console.log("\nSMOKE JAVA: PASS");
  } else {
    console.log("\nSMOKE JAVA: FAIL");
    process.exitCode = 1;
  }
});

sendNext();
