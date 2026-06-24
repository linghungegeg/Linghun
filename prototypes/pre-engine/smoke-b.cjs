"use strict";
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const helper = spawn("node", [path.join(__dirname, "ts-deep-layer.cjs")], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "pipe"],
});

const root = path.join(__dirname, "fixtures", "smoke").replace(/\\/g, "/");
const tsconfig = path.join(__dirname, "fixtures", "smoke", "tsconfig.json").replace(/\\/g, "/");
const staleFile = path.join(__dirname, "fixtures", "smoke", "stale-test.ts");
const originalContent = fs.readFileSync(staleFile, "utf8");

const queries = [
  { root, files: ["stale-test.ts"], tsconfig },
  null, // sentinel: mutate the file
  { root, files: ["stale-test.ts"], tsconfig },
];

let buf = "";
let idx = 0;
const results = [];

function sendNext() {
  while (idx < queries.length && queries[idx] === null) {
    // mutate file to remove the error
    fs.writeFileSync(staleFile, "const z: boolean = true;\n");
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
  fs.writeFileSync(staleFile, originalContent);
  const r1 = results[0];
  const r2 = results[1];
  const q1Pass = r1.issues && r1.issues.length > 0;
  const q2Pass = r2.issues && r2.issues.length === 0;
  console.log(`Q1 [stale-test.ts original]: ${r1.elapsed_ms}ms, issues=${r1.issues ? r1.issues.length : "?"}`);
  console.log(`Q2 [stale-test.ts fixed]:    ${r2.elapsed_ms}ms, issues=${r2.issues ? r2.issues.length : "?"}`);
  console.log(`\nStale check: Q1 has error=${q1Pass}, Q2 cleared=${q2Pass}`);
  if (q1Pass && q2Pass) {
    console.log("SMOKE B: PASS");
  } else {
    console.log("SMOKE B: FAIL");
    process.exitCode = 1;
  }
});

sendNext();
