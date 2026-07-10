"use strict";
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-swift-smoke-"));
const fakeToolDir = path.join(tempRoot, "tools with spaces");
const unsafeToolDir = path.join(tempRoot, "tools & %LINGHUN_ENV% injection");
const root = path.join(__dirname, "fixtures", "smoke-swift");
const syntaxFile = "syntax_error.swift";
const validFile = "valid.swift";
const unsafeFile = "valid & %LINGHUN_ENV% injection.swift";
fs.mkdirSync(fakeToolDir);
if (process.platform === "win32") {
  fs.writeFileSync(path.join(fakeToolDir, "swiftc.cmd"), [
    "@echo off",
    "setlocal EnableDelayedExpansion",
    "if defined LINGHUN_MARKER echo executed>\"!LINGHUN_MARKER!\"",
    "if not exist \"%~2\" exit /b 7",
    "echo %~2 | findstr /C:\"syntax_error\" >nul",
    "if %errorlevel%==0 (",
    "  echo %~2:2:1: error: expected expression 1>&2",
    "  exit /b 1",
    ")",
    "exit /b 0",
  ].join("\r\n"));
  fs.mkdirSync(unsafeToolDir);
  fs.copyFileSync(path.join(fakeToolDir, "swiftc.cmd"), path.join(unsafeToolDir, "swiftc.cmd"));
} else {
  const tool = path.join(fakeToolDir, "swiftc");
  fs.writeFileSync(tool, "#!/bin/sh\n[ -f \"$2\" ] || exit 7\ncase \"$2\" in *syntax_error*) echo \"$2:2:1: error: expected expression\" >&2; exit 1;; esac\nexit 0\n");
  fs.chmodSync(tool, 0o755);
}

const helper = spawn(process.execPath, [path.join(__dirname, "swift-deep-layer.cjs")], {
  cwd: __dirname,
  env: { ...process.env, PATH: `${fakeToolDir}${path.delimiter}${process.env.PATH || ""}` },
  stdio: ["pipe", "pipe", "pipe"],
});

const queries = [
  { root, files: [syntaxFile] },
  { root, files: [validFile] },
];

let buf = "";
let idx = 0;
const results = [];

function queryHelper(query, env) {
  return new Promise((resolve, reject) => {
    const isolated = spawn(process.execPath, [path.join(__dirname, "swift-deep-layer.cjs")], {
      cwd: __dirname,
      env,
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
  const missing = await queryHelper({ root, files: [validFile] }, { ...process.env, PATH: "" });
  let unsafeArg;
  let unsafeTool;
  let argMarker;
  let toolMarker;
  if (process.platform === "win32") {
    argMarker = path.join(tempRoot, "arg-marker.txt");
    toolMarker = path.join(tempRoot, "tool-marker.txt");
    unsafeArg = await queryHelper(
      { root, files: [unsafeFile] },
      { ...process.env, LINGHUN_ENV: "EXPANDED", LINGHUN_MARKER: argMarker, PATH: `${fakeToolDir}${path.delimiter}${process.env.PATH || ""}` },
    );
    unsafeTool = await queryHelper(
      { root, files: [validFile] },
      { ...process.env, LINGHUN_ENV: "EXPANDED", LINGHUN_MARKER: toolMarker, PATH: `${unsafeToolDir}${path.delimiter}${process.env.PATH || ""}` },
    );
  }
  const unsafeArgExecuted = argMarker && fs.existsSync(argMarker);
  const unsafeToolExecuted = toolMarker && fs.existsSync(toolMarker);
  fs.rmSync(tempRoot, { recursive: true, force: true });

  console.log("=== Swift Deep Layer Smoke Test ===\n");
  console.log(`Q1 [syntax_error.swift]: ${r1.elapsed_ms}ms, status=${r1.status}, issues=${(r1.issues||[]).length}, reason=${r1.reason}`);
  console.log(`Q2 [valid.swift]:        ${r2.elapsed_ms}ms, status=${r2.status}, issues=${(r2.issues||[]).length}, reason=${r2.reason}`);
  console.log(`Q3 [tool missing]:       ${missing.elapsed_ms}ms, status=${missing.status}, issues=${(missing.issues||[]).length}, reason=${missing.reason}`);

  const checks = [];

  const funcPass = r1.issues && r1.issues.length > 0 &&
    r1.issues[0].source === "swift-deep-layer" && r1.status === "swift_error";
  checks.push({ name: "A. Functional (syntax_error.swift has issues)", pass: funcPass });
  checks.push({ name: "B. Clean requires successful valid.swift execution", pass: r2.status === "clean" && r2.issues.length === 0 });
  checks.push({ name: "C. Reason semantics valid", pass: r1.reason === "swiftc" });
  checks.push({ name: "D. Isolated tool missing status", pass: missing.status === "tool_missing" });
  checks.push({ name: "E. Isolated tool missing has no fake issues", pass: missing.issues.length === 0 });
  checks.push({ name: "F. Isolated tool missing reason", pass: missing.reason === "swift_not_found" });
  if (process.platform === "win32") {
    checks.push({ name: "G. Unsafe fixture argv rejected", pass: unsafeArg.status === "error" && unsafeArg.issues.length === 0 });
    checks.push({ name: "H. Unsafe tool path rejected", pass: unsafeTool.status === "error" && unsafeTool.issues.length === 0 });
    checks.push({ name: "I. Rejected values never execute", pass: !unsafeArgExecuted && !unsafeToolExecuted });
  }

  let allPass = true;
  console.log("\n--- Results ---");
  for (const c of checks) {
    const mark = c.pass ? "PASS" : "FAIL";
    console.log(`  ${mark}: ${c.name}`);
    if (!c.pass) allPass = false;
  }

  if (allPass) {
    console.log("\nSMOKE SWIFT: PASS");
  } else {
    console.log("\nSMOKE SWIFT: FAIL");
    process.exitCode = 1;
  }
});

sendNext();
