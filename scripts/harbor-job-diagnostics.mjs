#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const DIAGNOSTIC_TYPES = [
  "missing_command",
  "binary_tool_missing",
  "service_readiness",
  "artifact_preservation",
  "timeout",
  "provider_or_network",
];
const EXCEPTION_TYPES = ["AgentTimeoutError", "VerifierTimeoutError", "NonZeroAgentExitCodeError"];

const STRUCTURED_EXTENSIONS = new Set([".json", ".jsonl", ".ndjson"]);
const SKIP_DIRS = new Set([".git", "node_modules"]);

const args = process.argv.slice(2);
const jobDirArg = args.find((arg) => !arg.startsWith("--"));
const jsonOutput = args.includes("--json");

if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

if (!jobDirArg) {
  printUsage();
  process.exit(1);
}

const jobDir = resolve(jobDirArg);
if (!existsSync(jobDir) || !(await stat(jobDir)).isDirectory()) {
  console.error(`FAIL harbor diagnostics: job dir does not exist or is not a directory: ${jobDir}`);
  process.exit(1);
}

const summary = await summarizeJobDir(jobDir);
if (jsonOutput) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  printSummary(summary);
}

async function summarizeJobDir(root) {
  const summary = {
    jobDir: root,
    filesRead: 0,
    parseErrors: [],
    verifierReward: {
      pass: 0,
      fail: 0,
      null: 0,
      other: 0,
    },
    exceptionTypes: Object.fromEntries(EXCEPTION_TYPES.map((type) => [type, 0])),
    diagnostics: Object.fromEntries(DIAGNOSTIC_TYPES.map((type) => [type, 0])),
  };

  const files = await findStructuredFiles(root);
  for (const file of files) {
    const values = await readStructuredValues(file, root, summary.parseErrors);
    if (values.length === 0) continue;
    summary.filesRead += 1;
    for (const value of values) {
      visitValue(value, summary);
    }
  }

  return summary;
}

async function findStructuredFiles(root) {
  const found = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name));
        continue;
      }
      if (entry.isFile() && STRUCTURED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        found.push(join(dir, entry.name));
      }
    }
  }

  await walk(root);
  return found.sort((a, b) => a.localeCompare(b));
}

async function readStructuredValues(file, root, parseErrors) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    parseErrors.push({ file: displayPath(root, file), error: errorMessage(error) });
    return [];
  }

  const extension = extname(file).toLowerCase();
  if (extension === ".jsonl" || extension === ".ndjson") {
    return parseJsonLines(text, file, root, parseErrors);
  }

  try {
    return [JSON.parse(text)];
  } catch (error) {
    parseErrors.push({ file: displayPath(root, file), error: errorMessage(error) });
    return [];
  }
}

function parseJsonLines(text, file, root, parseErrors) {
  const values = [];
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      values.push(JSON.parse(line));
    } catch (error) {
      parseErrors.push({
        file: `${displayPath(root, file)}:${index + 1}`,
        error: errorMessage(error),
      });
    }
  }
  return values;
}

function visitValue(value, summary) {
  if (Array.isArray(value)) {
    for (const item of value) visitValue(item, summary);
    return;
  }

  if (!isPlainObject(value)) return;

  countVerifierReward(value, summary);
  countExceptionType(value, summary);
  countDiagnostic(value, summary);

  for (const child of Object.values(value)) {
    visitValue(child, summary);
  }
}

function countVerifierReward(value, summary) {
  const reward = value.verifier_result?.rewards?.reward;
  if (reward === undefined) return;
  const normalizedReward = typeof reward === "string" ? reward.toLowerCase() : reward;
  if (reward === null) {
    summary.verifierReward.null += 1;
  } else if (
    normalizedReward === true ||
    normalizedReward === 1 ||
    normalizedReward === "1" ||
    normalizedReward === "pass" ||
    normalizedReward === "passed"
  ) {
    summary.verifierReward.pass += 1;
  } else if (
    normalizedReward === false ||
    normalizedReward === 0 ||
    normalizedReward === "0" ||
    normalizedReward === "fail" ||
    normalizedReward === "failed"
  ) {
    summary.verifierReward.fail += 1;
  } else {
    summary.verifierReward.other += 1;
  }
}

function countExceptionType(value, summary) {
  const exceptionType = value.exception_info?.exception_type;
  if (typeof exceptionType !== "string" || exceptionType.length === 0) return;
  summary.exceptionTypes[exceptionType] = (summary.exceptionTypes[exceptionType] || 0) + 1;
}

function countDiagnostic(value, summary) {
  if (typeof value.type !== "string" || !DIAGNOSTIC_TYPES.includes(value.type)) return;
  summary.diagnostics[value.type] += 1;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printSummary(summary) {
  console.log(`harbor job: ${summary.jobDir}`);
  console.log(`structured files read: ${summary.filesRead}`);
  console.log("");
  console.log("verifier_result.rewards.reward:");
  console.log(`- pass: ${summary.verifierReward.pass}`);
  console.log(`- fail: ${summary.verifierReward.fail}`);
  console.log(`- null: ${summary.verifierReward.null}`);
  console.log(`- other: ${summary.verifierReward.other}`);
  console.log("");
  console.log("exception_info.exception_type:");
  printCounters(summary.exceptionTypes);
  console.log("");
  console.log("diagnostics:");
  printCounters(summary.diagnostics);
  if (summary.parseErrors.length > 0) {
    console.log("");
    console.log("parse warnings:");
    for (const warning of summary.parseErrors) {
      console.log(`- ${warning.file}: ${warning.error}`);
    }
  }
}

function printCounters(counters) {
  const entries = Object.entries(counters).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    console.log("- none: 0");
    return;
  }
  for (const [key, count] of entries) {
    console.log(`- ${key}: ${count}`);
  }
}

function printUsage() {
  console.log("Usage: node scripts/harbor-job-diagnostics.mjs <harbor-job-dir> [--json]");
  console.log("");
  console.log("Read-only summary of structured JSON/JSONL fields in a Harbor job directory.");
}

function displayPath(root, file) {
  return relative(root, file).replace(/\\/g, "/");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
