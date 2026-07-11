"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function findAndroidJar() {
  if (process.env.LINGHUN_ANDROID_JAR) {
    const configured = path.resolve(process.env.LINGHUN_ANDROID_JAR);
    return fs.existsSync(configured) ? configured : null;
  }
  const sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  if (!sdkRoot) return null;
  const platforms = path.join(sdkRoot, "platforms");
  let entries;
  try { entries = fs.readdirSync(platforms, { withFileTypes: true }); } catch { return null; }
  return entries.filter(entry => entry.isDirectory())
    .map(entry => path.join(platforms, entry.name, "android.jar"))
    .filter(file => fs.existsSync(file))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))[0] || null;
}

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
  const androidJar = findAndroidJar();
  const unresolved = (result.issues || []).filter(issue =>
    /cannot be resolved|unresolved|not found/iu.test(issue.detail || ""));
  const pass = androidJar
    ? result.status === "verified" && result.reason == null
      && result.verification?.missing?.length === 0 && unresolved.length === 0
    : result.status === "partially_verified" && result.reason === "android_classpath_missing"
      && result.verification?.missing?.includes("android_classpath");
  console.log("=== Java Android Deep Layer Smoke Test ===");
  console.log(`mode=${androidJar ? "android_classpath_configured" : "android_classpath_missing"}`);
  console.log(`status=${result.status} reason=${result.reason || ""} issues=${(result.issues || []).length} diagnostic_count=${result.verification?.diagnostic_count || 0}`);
  if (!pass) {
    console.log("SMOKE JAVA ANDROID OPTIONAL CLASSPATH: FAIL");
    process.exit(1);
    return;
  }
  console.log(androidJar
    ? "SMOKE JAVA ANDROID CLASSPATH CONFIGURED: PASS"
    : "SMOKE JAVA ANDROID CLASSPATH MISSING: CORRECTLY PARTIALLY_VERIFIED");
});

helper.stdin.write(JSON.stringify(req) + "\n");
