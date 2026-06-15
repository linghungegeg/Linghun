#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const root = args.find((arg) => !arg.startsWith("--")) || ".bench/terminal-bench-wsl";
const cleanup = args.includes("--cleanup");
const lowDiskGb = Number(getArgValue("--low-disk-gb") || 50);
const wslDistro = getArgValue("--wsl-distro");

function classify(result) {
  const mode = String(result.failure_mode || "").toLowerCase();
  const text = JSON.stringify(result).toLowerCase();
  if (result.is_resolved === true) return "resolved";
  if (mode.includes("agent_timeout") || text.includes("agent timed out")) return "agent_timeout";
  if (mode.includes("test_timeout") || text.includes("test command timed out")) return "test_timeout";
  if (mode.includes("provider") || /rate limit|upstream|stream interrupted|fetch failed/.test(text)) {
    return "provider_error";
  }
  if (mode.includes("unknown_agent_error")) return "unknown_agent_error";
  if (mode.includes("parse") || /no short test summary|error parsing results|harness/.test(text)) {
    if (/cmake|g\+\+|undefined reference|compile error|build failed/.test(text)) {
      return "model_patch_failed";
    }
    return "parse_or_harness_error";
  }
  if (/missing|no such file|expected artifact|out\.txt|result\.txt|results\.json/.test(text)) {
    return "missing_artifact";
  }
  if (/command not found|rg: not found|cmake: not found|g\+\+: not found/.test(text)) {
    return "environment_missing_tool";
  }
  if (/no space left|out of memory|cannot allocate memory|oom/.test(text)) {
    return "resource_exhausted";
  }
  return "model_patch_failed";
}

async function findResults(dir) {
  const found = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name === "results.json") {
        found.push(path);
      }
    }
  }
  await walk(dir);
  return found;
}

function diskFreeGb(drive) {
  if (process.platform !== "win32") return undefined;
  try {
    const script = `[math]::Round((Get-PSDrive ${drive}).Free/1GB,2)`;
    return execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function getArgValue(name) {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function runDockerCommand(commandArgs) {
  if (wslDistro) {
    return execFileSync("wsl.exe", ["-d", wslDistro, "--", "docker", ...commandArgs], { stdio: "inherit" });
  }
  return execFileSync("docker", commandArgs, { stdio: "inherit" });
}

function dockerDisplay(commandArgs) {
  const command = `docker ${commandArgs.join(" ")}`;
  return wslDistro ? `wsl -d ${wslDistro} -- ${command}` : command;
}

function readDockerContext() {
  if (wslDistro) return `WSL distro: ${wslDistro}`;
  try {
    const context = execFileSync("docker", ["context", "show"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const host = execFileSync("docker", ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return `Docker context: ${context}${host ? ` (${host})` : ""}`;
  } catch {
    return "Docker context: unavailable";
  }
}

function runDockerCleanup() {
  const commands = [
    ["container", "prune", "-f"],
    ["builder", "prune", "-af"],
    ["image", "prune", "-af"],
    ["volume", "prune", "-f"],
  ];
  for (const commandArgs of commands) {
    const display = dockerDisplay(commandArgs);
    try {
      console.log(`cleanup: ${display}`);
      runDockerCommand(commandArgs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`cleanup warning: ${display} failed: ${message}`);
    }
  }
}

const files = existsSync(root) ? await findResults(root) : [];
const counters = new Map();
let total = 0;
let resolved = 0;
for (const file of files) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  for (const result of data.results || []) {
    total += 1;
    const category = classify(result);
    counters.set(category, (counters.get(category) || 0) + 1);
    if (category === "resolved") resolved += 1;
  }
}

console.log(`results: ${resolved}/${total}${total ? ` (${((resolved / total) * 100).toFixed(1)}%)` : ""}`);
for (const [category, count] of [...counters.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`- ${category}: ${count}`);
}

console.log("");
console.log("recommended next batch settings:");
console.log("- default concurrent: 3");
console.log("- heavy tasks (SWE/QEMU/ML/security/large build): concurrent 2-3, agent timeout 1200-1800s");
console.log("- simple/polyglot tasks: concurrent 3, agent timeout 900-1200s");
console.log("- test timeout: 600s");
console.log("- headless env: LINGHUN_HEADLESS_BENCH=1 LINGHUN_HEADLESS_TEST_TIMEOUT_MS=600000 LINGHUN_HEADLESS_MAX_REPAIRS=1");
console.log("- cleanup after every 10 tasks: node scripts/terminal-bench-report.mjs <result-root> --cleanup");
console.log("- WSL cleanup example: node scripts/terminal-bench-report.mjs <result-root> --cleanup --wsl-distro=Ubuntu-24.04-LinghunBench");
console.log(readDockerContext());

const cFree = diskFreeGb("C");
if (cFree !== undefined) {
  console.log(`C: free ${cFree} GB`);
  if (Number(cFree) < lowDiskGb) {
    console.log(`disk warning: C: is below ${lowDiskGb} GB. Run Docker internal prune after each batch.`);
    console.log("docker cleanup: docker container prune -f; docker builder prune -af; docker image prune -af; docker volume prune -f");
    console.log("vhdx compact requires Administrator PowerShell. Example:");
    console.log("  wsl --shutdown");
    console.log("  diskpart");
    console.log("  select vdisk file=\"%LOCALAPPDATA%\\Docker\\wsl\\disk\\docker_data.vhdx\"");
    console.log("  compact vdisk");
  }
}

if (cleanup) {
  runDockerCleanup();
}
