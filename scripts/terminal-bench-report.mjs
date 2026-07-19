#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { summarizeJobDir } from "./harbor-job-diagnostics.mjs";

const args = process.argv.slice(2);
const root = args.find((arg) => !arg.startsWith("--")) || ".bench/terminal-bench-wsl";
const cleanup = args.includes("--cleanup");
const officialSubmissionCheck = args.includes("--official-submission-check");
const lowDiskGb = Number(getArgValue("--low-disk-gb") || 50);
const wslDistro = getArgValue("--wsl-distro");

const FAILURE_MODE_CATEGORIES = new Map([
  ["agent_timeout", "agent_timeout"],
  ["test_timeout", "test_timeout"],
  ["provider_error", "provider_error"],
  ["unknown_agent_error", "unknown_agent_error"],
  ["parse_or_harness_error", "parse_or_harness_error"],
  ["missing_artifact", "missing_artifact"],
  ["environment_missing_tool", "environment_missing_tool"],
  ["resource_exhausted", "resource_exhausted"],
  ["model_patch_failed", "model_patch_failed"],
]);

const EXCEPTION_CATEGORIES = new Map([
  ["AgentTimeoutError", "agent_timeout"],
  ["VerifierTimeoutError", "test_timeout"],
  ["NonZeroAgentExitCodeError", "unknown_agent_error"],
  ["CancelledError", "interrupted"],
]);

function classifyResultByFields(result) {
  if (result.is_resolved === true) return "resolved";
  const mode = stringValue(result.failure_mode) ?? stringValue(result.failureMode);
  const mappedMode = mode ? FAILURE_MODE_CATEGORIES.get(mode) : undefined;
  if (mappedMode) return mappedMode;
  const exceptionType = stringValue(result.exception_info?.exception_type) ?? stringValue(result.exceptionType);
  const mappedException = exceptionType ? EXCEPTION_CATEGORIES.get(exceptionType) : undefined;
  if (mappedException) return mappedException;
  return "unclassified_failure";
}

function detectProfileByFields(result) {
  for (const key of ["profile", "task_profile", "taskProfile", "category", "task_type", "taskType"]) {
    const value = stringValue(result[key]);
    if (value) return value;
  }
  return "generic";
}

function isHeavyProfile(profile) {
  return ["swe_python", "large_python_project", "qemu_or_service", "ml_or_data", "security_or_network"].includes(profile);
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

async function findHarborJobs(dir) {
  const found = [];

  async function walk(current) {
    if (await hasTrialChildren(current)) {
      found.push(current);
      return;
    }

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".git" || entry.name === "node_modules") continue;
      await walk(join(current, entry.name));
    }
  }

  await walk(dir);
  return found;
}

async function hasTrialChildren(dir) {
  if (!existsSync(join(dir, "config.json"))) return false;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => {
    if (!entry.isDirectory()) return false;
    const trialDir = join(dir, entry.name);
    return existsSync(join(trialDir, "result.json")) || existsSync(join(trialDir, "config.json"));
  });
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

function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

const jobDirs = existsSync(root) ? await findHarborJobs(root) : [];
const jobSummaries = [];
for (const jobDir of jobDirs) {
  const summary = await summarizeJobDir(jobDir);
  if (summary.trialTasks.trialCount > 0) {
    jobSummaries.push(summary);
  }
}
const files = jobSummaries.length === 0 && existsSync(root) ? await findResults(root) : [];
const counters = new Map();
const profileCounters = new Map();
let total = 0;
let resolved = 0;
let officialSubmissionViolationCount = 0;

if (jobSummaries.length > 0) {
  for (const summary of jobSummaries) {
    total += summary.trialTasks.anyPass.total;
    resolved += summary.trialTasks.anyPass.pass;
    for (const [category, count] of Object.entries(summary.trialTasks.failureCategories)) {
      counters.set(category, (counters.get(category) || 0) + count);
    }
  }
} else {
  for (const file of files) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    for (const result of data.results || []) {
      total += 1;
      const category = classifyResultByFields(result);
      const profile = detectProfileByFields(result);
      counters.set(category, (counters.get(category) || 0) + 1);
      profileCounters.set(profile, (profileCounters.get(profile) || 0) + 1);
      if (category === "resolved") resolved += 1;
    }
  }
}

console.log(`results: ${resolved}/${total}${total ? ` (${((resolved / total) * 100).toFixed(1)}%)` : ""}`);
if (jobSummaries.length > 0) {
  const firstPass = jobSummaries.reduce((sum, summary) => sum + summary.trialTasks.firstUnique.pass, 0);
  const firstTotal = jobSummaries.reduce((sum, summary) => sum + summary.trialTasks.firstUnique.total, 0);
  console.log(`first unique: ${firstPass}/${firstTotal}${firstTotal ? ` (${((firstPass / firstTotal) * 100).toFixed(1)}%)` : ""}`);
  officialSubmissionViolationCount = jobSummaries.reduce(
    (sum, summary) => sum + summary.officialSubmissionConfig.violationCount,
    0,
  );
  console.log(
    `official submission config: ${officialSubmissionViolationCount === 0 ? "PASS" : `FAIL (${officialSubmissionViolationCount} violation(s))`}`,
  );
  for (const summary of jobSummaries) {
    for (const violation of summary.officialSubmissionConfig.violations.slice(0, 5)) {
      console.log(
        `- ${violation.file}: ${violation.field}=${JSON.stringify(violation.value)} expected ${violation.expected}`,
      );
    }
  }
}
for (const [category, count] of [...counters.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`- ${category}: ${count}`);
}
if (jobSummaries.length === 0) {
  console.log("profiles:");
  for (const [profile, count] of [...profileCounters.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`- ${profile}: ${count}`);
  }
}

console.log("");
console.log("official-safe next batch settings:");
console.log("- formal leaderboard runs: keep benchmark default timeout multipliers; do not set timeout_multiplier, agent_timeout_multiplier, or verifier_timeout_multiplier above 1.0");
console.log("- tune score with task strategy, validation discipline, and task selection/order; treat longer timeout experiments as non-submission diagnostics only");
console.log("- verifier timeout: keep official default unless the benchmark release explicitly changes it");
console.log("- headless env: LINGHUN_HEADLESS_BENCH=1 LINGHUN_HEADLESS_TEST_TIMEOUT_MS=600000 LINGHUN_HEADLESS_MAX_REPAIRS=1");
console.log("- cleanup after every 10 tasks: node scripts/terminal-bench-report.mjs <result-root> --cleanup");
console.log("- WSL cleanup example: node scripts/terminal-bench-report.mjs <result-root> --cleanup --wsl-distro=Ubuntu-24.04-LinghunBench");
const heavyCount = [...profileCounters.entries()].reduce((sum, [profile, count]) => sum + (isHeavyProfile(profile) ? count : 0), 0);
if (heavyCount > total / 3 || (counters.get("agent_timeout") || 0) + (counters.get("test_timeout") || 0) > total / 5) {
  console.log("- observed mix: improve single-time strategy and early verifier feedback before rerunning heavy tasks; do not raise formal timeout multipliers");
} else if ((profileCounters.get("polyglot_cpp") || 0) + (profileCounters.get("polyglot_simple") || 0) > total / 3) {
  console.log("- observed mix: polyglot/simple failures are likely better served by focused test reading and short local validation");
} else {
  console.log("- observed mix: profile signal is weak; tune by failure modes above");
}
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

if (officialSubmissionCheck && officialSubmissionViolationCount > 0) {
  process.exit(2);
}
