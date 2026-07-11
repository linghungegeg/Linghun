"use strict";
const { spawn } = require("child_process");
const path = require("path");

const helper = spawn("node", [path.join(__dirname, "java-deep-layer.cjs")], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "pipe"],
});

const root = path.join(__dirname, "fixtures", "smoke-java-android").replace(/\\/g, "/");
const req = {
  op: "verify",
  root,
  files: ["src/main/java/com/example/AndroidController.java"],
};

let buf = "";
let stderr = "";
helper.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
helper.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  const nl = buf.indexOf("\n");
  if (nl !== -1) helper.stdin.end();
});

helper.on("close", () => {
  const line = buf.split(/\r?\n/).find(Boolean);
  if (!line) {
    console.error(stderr || "java helper produced no output");
    process.exit(1);
    return;
  }
  const result = JSON.parse(line);
  const pass = result.status === "verified"
    && result.reason == null
    && result.verification?.missing?.length === 0
    && (result.issues || []).every(issue => issue.source === "java-deep-layer");
  console.log("=== Java Android Deep Layer Smoke Test ===");
  console.log(`status=${result.status} reason=${result.reason || ""} issues=${(result.issues || []).length}`);
  if (!pass) {
    console.log("SMOKE JAVA ANDROID: FAIL");
    process.exit(1);
    return;
  }
  console.log("SMOKE JAVA ANDROID: PASS");
});

helper.stdin.write(JSON.stringify(req) + "\n");
