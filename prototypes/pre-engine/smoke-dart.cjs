"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const helper = spawn("node", [path.join(__dirname, "dart-deep-layer.cjs")], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "pipe"],
});

const root = path.join(__dirname, "fixtures", "smoke-dart").replace(/\\/g, "/");
const spacedRootPath = fs.mkdtempSync(path.join(os.tmpdir(), "linghun dart spaces "));
const spacedFile = "valid spaced.dart";
fs.writeFileSync(path.join(spacedRootPath, spacedFile), "void main() {}\n");
const markerRootPath = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-dart-marker-"));
const markerPath = path.join(markerRootPath, "injected.txt");
const injectionFile = `valid.dart & echo injected > "${markerPath}" & %PATH%`;
process.on("exit", () => {
  fs.rmSync(spacedRootPath, { recursive: true, force: true });
  fs.rmSync(markerRootPath, { recursive: true, force: true });
});

const queries = [
  { root, files: ["syntax_error.dart"] },
  { root, files: ["valid.dart"] },
  { root: spacedRootPath.replace(/\\/g, "/"), files: [spacedFile] },
  { root, files: [injectionFile] },
];

let buf = "";
let idx = 0;
const results = [];

function queryWithoutDart(query) {
  return new Promise((resolve, reject) => {
    const isolated = spawn(process.execPath, [path.join(__dirname, "dart-deep-layer.cjs")], {
      cwd: __dirname,
      env: { ...process.env, PATH: path.dirname(process.execPath) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let stderr = "";
    isolated.stdout.on("data", chunk => { output += chunk.toString(); });
    isolated.stderr.on("data", chunk => { stderr += chunk.toString(); });
    isolated.on("error", reject);
    isolated.on("close", code => {
      if (code !== 0) {
        reject(new Error(`isolated helper exited ${code}: ${stderr}`));
        return;
      }
      resolve(JSON.parse(output.trim()));
    });
    isolated.stdin.end(`${JSON.stringify(query)}\n`);
  });
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

helper.on("close", async () => {
  const r1 = results[0];
  const r2 = results[1];
  const spaced = results[2];
  const injected = results[3];
  const missing = await queryWithoutDart({ root, files: ["valid.dart"] });

  console.log("=== Dart Deep Layer Smoke Test ===\n");
  console.log(`Q1 [syntax_error.dart]: ${r1.elapsed_ms}ms, status=${r1.status}, issues=${(r1.issues||[]).length}, reason=${r1.reason}`);
  console.log(`Q2 [valid.dart]:        ${r2.elapsed_ms}ms, status=${r2.status}, issues=${(r2.issues||[]).length}, reason=${r2.reason}`);
  console.log(`Q3 [spaces allowed]:    ${spaced.elapsed_ms}ms, status=${spaced.status}, issues=${(spaced.issues||[]).length}, reason=${spaced.reason}`);
  console.log(`Q4 [unsafe rejected]:   ${injected.elapsed_ms}ms, status=${injected.status}, issues=${(injected.issues||[]).length}, reason=${injected.reason}`);
  console.log(`Q5 [tool missing]:      ${missing.elapsed_ms}ms, status=${missing.status}, issues=${(missing.issues||[]).length}, reason=${missing.reason}`);

  const checks = [];

  if (r1.status === "unavailable") {
    checks.push({ name: "A. Unavailable semantics (dart not found)", pass: true });
    checks.push({ name: "B. Unavailable returns no fake issues", pass: r1.issues.length === 0 });
    checks.push({ name: "C. Unavailable reason present", pass: r1.reason === "dart_not_found" });
  } else {
    const funcPass = r1.issues && r1.issues.length > 0 &&
      r1.issues[0].source === "dart-deep-layer";
    checks.push({ name: "A. Functional (syntax_error.dart has issues)", pass: funcPass });

    const okPass = r2.issues && r2.issues.length === 0;
    checks.push({ name: "B. Clean (valid.dart is clean)", pass: okPass });

    const reasonOk = r1.reason === "dart";
    checks.push({ name: "C. Reason semantics valid", pass: reasonOk });
  }
  checks.push({ name: "D. Tool missing is unavailable", pass: missing.status === "unavailable" });
  checks.push({ name: "E. Tool missing has no fake issues", pass: missing.issues.length === 0 });
  checks.push({ name: "F. Tool missing reason", pass: missing.reason === "dart_not_found" });
  checks.push({
    name: "G. Spaces remain valid batch arguments",
    pass: spaced.status === "clean" && spaced.issues.length === 0 && spaced.reason === "dart",
  });
  checks.push({
    name: "H. Unsafe batch arguments are rejected without verification",
    pass: injected.status === "error" && injected.issues.length === 0 &&
      injected.reason === "unsafe_batch_argument",
  });
  checks.push({ name: "I. Rejected argument did not execute marker command", pass: !fs.existsSync(markerPath) });

  let allPass = true;
  console.log("\n--- Results ---");
  for (const c of checks) {
    const mark = c.pass ? "PASS" : "FAIL";
    console.log(`  ${mark}: ${c.name}`);
    if (!c.pass) allPass = false;
  }

  if (allPass) {
    console.log("\nSMOKE DART: PASS");
  } else {
    console.log("\nSMOKE DART: FAIL");
    process.exitCode = 1;
  }
});

sendNext();
