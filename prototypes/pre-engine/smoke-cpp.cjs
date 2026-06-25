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
  { root, files: ["syntax_error.c"] },
  { root, files: ["valid.c"] },
  { root, files: ["syntax_error.cpp", "valid.c"] },
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
  const [r1, r2, r3, r4, r5] = results;

  console.log("=== C/C++ Deep Layer Smoke Test ===\n");
  console.log(`Q1 [syntax_error.cpp]:          ${r1.elapsed_ms}ms, status=${r1.status}, issues=${(r1.issues||[]).length}, reason=${r1.reason}`);
  console.log(`Q2 [valid.cpp]:                 ${r2.elapsed_ms}ms, status=${r2.status}, issues=${(r2.issues||[]).length}, reason=${r2.reason}`);
  console.log(`Q3 [syntax_error.c]:            ${r3.elapsed_ms}ms, status=${r3.status}, issues=${(r3.issues||[]).length}, reason=${r3.reason}`);
  console.log(`Q4 [valid.c]:                   ${r4.elapsed_ms}ms, status=${r4.status}, issues=${(r4.issues||[]).length}, reason=${r4.reason}`);
  console.log(`Q5 [syntax_error.cpp, valid.c]: ${r5.elapsed_ms}ms, status=${r5.status}, issues=${(r5.issues||[]).length}, reason=${r5.reason}`);

  const checks = [];

  if (r1.status === "unavailable") {
    checks.push({ name: "A. Unavailable semantics (.cpp toolchain not found)", pass: true });
    checks.push({ name: "B. Unavailable returns no fake issues (.cpp)", pass: r1.issues.length === 0 });
    checks.push({ name: "C. Unavailable reason (.cpp)", pass: r1.reason === "cpp_toolchain_not_found" });
    checks.push({ name: "D. Unavailable semantics (.c toolchain not found)", pass: r3.status === "unavailable" });
    checks.push({ name: "E. Unavailable returns no fake issues (.c)", pass: r3.issues.length === 0 });
    checks.push({ name: "F. Unavailable reason (.c)", pass: r3.reason === "cpp_toolchain_not_found" });
    checks.push({ name: "G. Mixed unavailable (no toolchain)", pass: r5.status === "unavailable" && r5.reason === "cpp_toolchain_not_found" });
  } else {
    const cppErr = r1.issues && r1.issues.length > 0 && r1.issues[0].source === "cpp-deep-layer";
    checks.push({ name: "A. Functional (syntax_error.cpp has issues)", pass: cppErr });

    const cppOk = r2.issues && r2.issues.length === 0;
    checks.push({ name: "B. Clean (valid.cpp is clean)", pass: cppOk });

    const cppReason = r1.reason === "cpp_toolchain";
    checks.push({ name: "C. Reason semantics (.cpp)", pass: cppReason });

    const cErr = r3.issues && r3.issues.length > 0 && r3.issues[0].source === "cpp-deep-layer";
    checks.push({ name: "D. Functional (syntax_error.c has issues)", pass: cErr });

    const cOk = r4.issues && r4.issues.length === 0;
    checks.push({ name: "E. Clean (valid.c is clean)", pass: cOk });

    const cReason = r3.reason === "cpp_toolchain";
    checks.push({ name: "F. Reason semantics (.c)", pass: cReason });

    const mixedErr = r5.issues && r5.issues.length > 0 && r5.issues[0].source === "cpp-deep-layer";
    checks.push({ name: "G. Mixed functional (syntax_error.cpp detected)", pass: mixedErr });
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
