"use strict";
const { spawn } = require("child_process");
const path = require("path");

const helper = spawn("node", [path.join(__dirname, "ruby-deep-layer.cjs")], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "pipe"],
});

const root = path.join(__dirname, "fixtures", "smoke-ruby").replace(/\\/g, "/");

const queries = [
  { root, files: ["syntax_error.rb"] },
  { root, files: ["valid.rb"] },
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

  console.log("=== Ruby Deep Layer Smoke Test ===\n");
  console.log(`Q1 [syntax_error.rb]: ${r1.elapsed_ms}ms, status=${r1.status}, issues=${(r1.issues||[]).length}, reason=${r1.reason}`);
  console.log(`Q2 [valid.rb]:        ${r2.elapsed_ms}ms, status=${r2.status}, issues=${(r2.issues||[]).length}, reason=${r2.reason}`);

  const checks = [];

  if (r1.status === "unavailable") {
    checks.push({ name: "A. Unavailable semantics (ruby not found)", pass: true });
    checks.push({ name: "B. Unavailable returns no fake issues", pass: r1.issues.length === 0 });
    checks.push({ name: "C. Unavailable reason present", pass: r1.reason === "ruby_not_found" });
  } else {
    const funcPass = r1.issues && r1.issues.length > 0 &&
      r1.issues[0].source === "ruby-deep-layer";
    checks.push({ name: "A. Functional (syntax_error.rb has issues)", pass: funcPass });

    const okPass = r2.issues && r2.issues.length === 0;
    checks.push({ name: "B. Clean (valid.rb is clean)", pass: okPass });

    const reasonOk = r1.reason === "ruby";
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
    console.log("\nSMOKE RUBY: PASS");
  } else {
    console.log("\nSMOKE RUBY: FAIL");
    process.exitCode = 1;
  }
});

sendNext();
