"use strict";
const { spawn, spawnSync } = require("child_process");
const path = require("path");

const helper = spawn("node", [path.join(__dirname, "php-deep-layer.cjs")], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "pipe"],
});

const root = path.join(__dirname, "fixtures", "smoke-php").replace(/\\/g, "/");

const queries = [
  { root, files: ["SyntaxError.php"] },
  { root, files: ["Valid.php"] },
];

let buf = "";
let idx = 0;
const results = [];

function queryWithoutTool(query) {
  const result = spawnSync(process.execPath, [path.join(__dirname, "php-deep-layer.cjs")], {
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
  const r1 = results[0];
  const r2 = results[1];
  const missing = queryWithoutTool({ root, files: ["Valid.php"] });

  console.log("=== PHP Deep Layer Smoke Test ===\n");
  const mode = r1.fallback ? "fallback" : r1.reason || "unknown";
  console.log(`Q1 [SyntaxError.php]: ${r1.elapsed_ms}ms, issues=${(r1.issues||[]).length}, mode=${mode}`);
  console.log(`Q2 [Valid.php]:       ${r2.elapsed_ms}ms, issues=${(r2.issues||[]).length}`);
  console.log(`Q3 [tool missing]:    status=${missing.status}, fallback=${missing.fallback}`);

  const checks = [];

  const funcPass = r1.issues && r1.issues.length > 0 &&
    r1.issues[0].source === "php-deep-layer";
  checks.push({ name: "A. Functional (SyntaxError has issues)", pass: funcPass });

  const okPass = r2.issues && r2.issues.length === 0;
  checks.push({ name: "B. Clean (Valid.php is clean)", pass: okPass });

  const reasonOk = ["php", "fallback", "fallback_clean"].includes(r1.reason);
  checks.push({ name: "C. Reason semantics valid", pass: reasonOk });
  const normalStatusPass = r1.reason === "php"
    ? r1.status === "php_error" && r2.status === "clean"
    : r1.status === "fallback_used" && r2.status === "fallback_used";
  checks.push({ name: "D. Normal validator status is explicit", pass: normalStatusPass });
  checks.push({ name: "E. Tool missing uses fallback", pass: missing.status === "fallback_used" });
  checks.push({ name: "F. Tool missing names fallback", pass: missing.fallback === "php_not_found" });

  let allPass = true;
  console.log("\n--- Results ---");
  for (const c of checks) {
    const mark = c.pass ? "PASS" : "FAIL";
    console.log(`  ${mark}: ${c.name}`);
    if (!c.pass) allPass = false;
  }

  if (allPass) {
    console.log("\nSMOKE PHP: PASS");
  } else {
    console.log("\nSMOKE PHP: FAIL");
    process.exitCode = 1;
  }
});

sendNext();
