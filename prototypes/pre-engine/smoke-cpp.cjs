"use strict";
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-cpp-smoke-"));
const fakeToolDir = path.join(tempRoot, "tools with spaces");
const unsafeToolDir = path.join(tempRoot, "tools & %LINGHUN_ENV% injection");
const root = path.join(__dirname, "fixtures", "smoke-cpp");
const cppSyntaxFile = "syntax_error.cpp";
const cppValidFile = "valid.cpp";
const cSyntaxFile = "syntax_error.c";
const cValidFile = "valid.c";
const unsafeFile = "valid & %LINGHUN_ENV% injection.cpp";
fs.mkdirSync(fakeToolDir);
if (process.platform === "win32") {
  const tool = [
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
  ].join("\r\n");
  fs.writeFileSync(path.join(fakeToolDir, "clang++.cmd"), tool);
  fs.writeFileSync(path.join(fakeToolDir, "clang.cmd"), tool);
  fs.mkdirSync(unsafeToolDir);
  fs.copyFileSync(path.join(fakeToolDir, "clang++.cmd"), path.join(unsafeToolDir, "clang++.cmd"));
  fs.copyFileSync(path.join(fakeToolDir, "clang.cmd"), path.join(unsafeToolDir, "clang.cmd"));
} else {
  const tool = "#!/bin/sh\n[ -f \"$2\" ] || exit 7\ncase \"$2\" in *syntax_error*) echo \"$2:2:1: error: expected expression\" >&2; exit 1;; esac\nexit 0\n";
  for (const name of ["clang++", "clang"]) {
    const target = path.join(fakeToolDir, name);
    fs.writeFileSync(target, tool);
    fs.chmodSync(target, 0o755);
  }
}

const helper = spawn(process.execPath, [path.join(__dirname, "cpp-deep-layer.cjs")], {
  cwd: __dirname,
  env: { ...process.env, PATH: `${fakeToolDir}${path.delimiter}${process.env.PATH || ""}` },
  stdio: ["pipe", "pipe", "pipe"],
});

const queries = [
  { root, files: [cppSyntaxFile] },
  { root, files: [cppValidFile] },
  { root, files: [cSyntaxFile] },
  { root, files: [cValidFile] },
  { root, files: [cppSyntaxFile, cValidFile] },
];

let buf = "";
let idx = 0;
const results = [];

function queryHelper(query, env) {
  return new Promise((resolve, reject) => {
    const isolated = spawn(process.execPath, [path.join(__dirname, "cpp-deep-layer.cjs")], {
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
  const [r1, r2, r3, r4, r5] = results;
  const missing = await queryHelper({ root, files: [cppValidFile] }, { ...process.env, PATH: "" });
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
      { root, files: [cppValidFile] },
      { ...process.env, LINGHUN_ENV: "EXPANDED", LINGHUN_MARKER: toolMarker, PATH: `${unsafeToolDir}${path.delimiter}${process.env.PATH || ""}` },
    );
  }
  const unsafeArgExecuted = argMarker && fs.existsSync(argMarker);
  const unsafeToolExecuted = toolMarker && fs.existsSync(toolMarker);
  fs.rmSync(tempRoot, { recursive: true, force: true });

  console.log("=== C/C++ Deep Layer Smoke Test ===\n");
  console.log(`Q1 [syntax_error.cpp]:          ${r1.elapsed_ms}ms, status=${r1.status}, issues=${(r1.issues||[]).length}, reason=${r1.reason}`);
  console.log(`Q2 [valid.cpp]:                 ${r2.elapsed_ms}ms, status=${r2.status}, issues=${(r2.issues||[]).length}, reason=${r2.reason}`);
  console.log(`Q3 [syntax_error.c]:            ${r3.elapsed_ms}ms, status=${r3.status}, issues=${(r3.issues||[]).length}, reason=${r3.reason}`);
  console.log(`Q4 [valid.c]:                   ${r4.elapsed_ms}ms, status=${r4.status}, issues=${(r4.issues||[]).length}, reason=${r4.reason}`);
  console.log(`Q5 [syntax_error.cpp, valid.c]: ${r5.elapsed_ms}ms, status=${r5.status}, issues=${(r5.issues||[]).length}, reason=${r5.reason}`);
  console.log(`Q6 [tool missing]:              ${missing.elapsed_ms}ms, status=${missing.status}, issues=${(missing.issues||[]).length}, reason=${missing.reason}`);

  const checks = [];
  function addPairChecks(label, errorResult, validResult) {
    checks.push({ name: `${label} syntax error detected`, pass: errorResult.status === "cpp_error" && errorResult.issues.length > 0 && errorResult.issues[0].source === "cpp-deep-layer" });
    checks.push({ name: `${label} valid file is clean`, pass: validResult.status === "clean" && validResult.issues.length === 0 });
  }
  addPairChecks("C++", r1, r2);
  addPairChecks("C", r3, r4);
  checks.push({
    name: "Mixed request is never a fake clean",
    pass: r5.status === "cpp_error" && r5.issues.length > 0,
  });
  checks.push({ name: "Isolated tool missing status", pass: missing.status === "tool_missing" });
  checks.push({ name: "Isolated tool missing has no fake issues", pass: missing.issues.length === 0 });
  checks.push({ name: "Isolated tool missing reason", pass: missing.reason === "cpp_toolchain_not_found" });
  if (process.platform === "win32") {
    checks.push({ name: "Unsafe fixture argv rejected", pass: unsafeArg.status === "error" && unsafeArg.issues.length === 0 });
    checks.push({ name: "Unsafe tool path rejected", pass: unsafeTool.status === "error" && unsafeTool.issues.length === 0 });
    checks.push({ name: "Rejected values never execute", pass: !unsafeArgExecuted && !unsafeToolExecuted });
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
