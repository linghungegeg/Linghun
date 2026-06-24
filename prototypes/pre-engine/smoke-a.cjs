"use strict";

const { spawn } = require("child_process");
const path = require("path");

const helper = spawn("node", [path.join(__dirname, "ts-deep-layer.cjs")], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "pipe"],
});

const root = path.join(__dirname, "fixtures", "smoke").replace(/\\/g, "/");
const tsconfig = path.join(__dirname, "fixtures", "smoke", "tsconfig.json").replace(/\\/g, "/");

const queries = [
  { root, files: ["type-error.ts"], tsconfig },
  { root, files: ["type-ok.ts"], tsconfig },
  { root, files: ["type-error.ts"], tsconfig },
];

let buf = "";
let idx = 0;
const results = [];

helper.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    const resp = JSON.parse(line);
    results.push(resp);
    idx++;
    if (idx < queries.length) {
      helper.stdin.write(JSON.stringify(queries[idx]) + "\n");
    } else {
      helper.stdin.end();
    }
  }
});

helper.on("close", () => {
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const file = queries[i].files[0];
    const issues = r.issues ? r.issues.length : 0;
    console.log(`Q${i+1} [${file}]: ${r.elapsed_ms}ms, issues=${issues}`);
  }
  const q2 = results[1].elapsed_ms;
  const q3 = results[2].elapsed_ms;
  console.log(`\nPerf check: Q2=${q2}ms Q3=${q3}ms (must be <200ms)`);
  if (q2 < 200 && q3 < 200) {
    console.log("SMOKE A: PASS");
  } else {
    console.log("SMOKE A: FAIL");
    process.exitCode = 1;
  }
});

helper.stdin.write(JSON.stringify(queries[0]) + "\n");
