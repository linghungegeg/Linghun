"use strict";
const { spawn } = require("child_process");
const path = require("path");

const helper = spawn("node", [path.join(__dirname, "cpp-deep-layer.cjs")], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "pipe"],
});

const root = path.join(__dirname, "fixtures", "smoke-cpp").replace(/\\/g, "/");

const queries = [
  { root, files: ["syntax_error.cpp"] },
  { root, files: ["valid.cpp"] },
];

let buf = "";
let idx = 0;
const results = [];

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

  console.log("=== C/C++ Deep Layer Smoke Test ===\n");
  console.log(`Q1 [syntax_error.cpp]: ${r1.elapsed_ms}ms, status=${r1.status}, issues=${(r1.issues||[]).length}, reason=${r1.reason}`);
  console.log(`Q2 [valid.cpp]:        ${r2.elapsed_ms}ms, status=${r2.status}, issues=${(r2.issues||[]).length}, reason=${r2.reason}`);

  const checks = [];

  if (r1.status === "unavailable") {
    checks.push({ name: "A. Unavailable semantics (toolchain not found)", pass: true });
    checks.push({ name: "B. Unavailable returns no fake issues", pass: r1.issues.length === 0 });
    checks.push({ name: "C. Unavailable reason present", pass: r1.reason === "cpp_toolchain_not_found" });
  } else {
    const funcPass = r1.issues && r1.issues.length > 0 &&
      r1.issues[0].source === "cpp-deep-layer";
    checks.push({ name: "A. Functional (syntax_error.cpp has issues)", pass: funcPass });

    const okPass = r2.issues && r2.issues.length === 0;
    checks.push({ name: "B. Clean (valid.cpp is clean)", pass: okPass });

    const reasonOk = r1.reason === "cpp_toolchain";
    checks.push({ name: "C. Reason semantics valid", pass: reasonOk });
  }

  let allPass = true;
  console.log("\n--- Results ---");
  for (const c of checks) {
    const mark = c.pass ? "PASS" : "FAIL";
    console.log(`  ${mark}: ${c.name}`);
    if (!c.pass) allPass = false;
  }

  if (allPass) {
    console.log("\nSMOKE CPP: PASS");
  } else {
    console.log("\nSMOKE CPP: FAIL");
    process.exitCode = 1;
  }
});

sendNext();
