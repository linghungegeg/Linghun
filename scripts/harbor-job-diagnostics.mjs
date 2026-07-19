#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
const OFFICIAL_TIMEOUT_MULTIPLIER_FIELDS = [
  "timeout_multiplier",
  "agent_timeout_multiplier",
  "verifier_timeout_multiplier",
];
const OFFICIAL_NULL_RESOURCE_OVERRIDE_FIELDS = [
  ["agent", "override_timeout_sec"],
  ["agent", "max_timeout_sec"],
  ["verifier", "override_timeout_sec"],
  ["verifier", "max_timeout_sec"],
  ["environment", "override_cpus"],
  ["environment", "override_memory_mb"],
  ["environment", "override_storage_mb"],
  ["environment", "override_gpus"],
  ["environment", "override_tpu"],
];

export { summarizeJobDir, summarizeTrialTasks };

if (isCliEntry()) {
  await runCli(process.argv.slice(2));
}

async function runCli(args) {
  const jobDirArg = args.find((arg) => !arg.startsWith("--"));
  const jsonOutput = args.includes("--json");
  const officialSubmissionCheck = args.includes("--official-submission-check");
  const repairFactsDir = getArgValue(args, "--write-repair-facts-dir");

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
  if (repairFactsDir) {
    await writeRepairFactsDir(summary, resolve(repairFactsDir));
  }
  if (officialSubmissionCheck && !summary.officialSubmissionConfig.ok) {
    process.exit(2);
  }
}

function isCliEntry() {
  if (process.argv[1] === "-") return true;
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

function getArgValue(args, name) {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
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
    officialSubmissionConfig: await summarizeOfficialSubmissionConfig(root),
    trialTasks: await summarizeTrialTasks(root),
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

async function summarizeOfficialSubmissionConfig(root) {
  const violations = [];
  const jobConfig = await readJsonFile(join(root, "config.json"));
  if (isPlainObject(jobConfig)) {
    collectOfficialConfigViolations(jobConfig, "job", "config.json", violations);
  }

  const trialDirs = await findTrialDirs(root);
  let checkedTrials = 0;
  for (const dir of trialDirs) {
    const config = await readJsonFile(join(dir, "config.json"));
    const result = await readJsonFile(join(dir, "result.json"));
    const trialConfig = isPlainObject(config)
      ? config
      : isPlainObject(result?.config)
        ? result.config
        : undefined;
    if (!trialConfig) continue;
    checkedTrials += 1;
    collectOfficialConfigViolations(
      trialConfig,
      "trial",
      `${displayPath(root, dir)}/config.json`,
      violations,
    );
  }

  return {
    ok: violations.length === 0,
    checkedTrials,
    violationCount: violations.length,
    violations: violations.slice(0, 50),
  };
}

function collectOfficialConfigViolations(config, scope, file, violations) {
  for (const field of OFFICIAL_TIMEOUT_MULTIPLIER_FIELDS) {
    const value = config[field];
    if (!isDefaultMultiplier(value)) {
      violations.push({
        scope,
        file,
        field,
        value,
        expected: "null/undefined/1.0",
      });
    }
  }

  for (const pathParts of OFFICIAL_NULL_RESOURCE_OVERRIDE_FIELDS) {
    const value = readPath(config, pathParts);
    if (value !== undefined && value !== null) {
      violations.push({
        scope,
        file,
        field: pathParts.join("."),
        value,
        expected: "null/undefined",
      });
    }
  }
}

function isDefaultMultiplier(value) {
  if (value === undefined || value === null) return true;
  if (value === 1) return true;
  if (typeof value === "string" && Number(value) === 1) return true;
  return false;
}

function readPath(value, pathParts) {
  let current = value;
  for (const part of pathParts) {
    if (!isPlainObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

async function summarizeTrialTasks(root) {
  const configuredTasks = await readConfiguredTasks(root);
  const trialDirs = await findTrialDirs(root);
  const trials = [];
  for (const dir of trialDirs) {
    const trial = await readTrialFacts(root, dir);
    if (trial) trials.push(trial);
  }

  const configuredKeys = configuredTasks.length > 0
    ? configuredTasks
    : [...new Set(trials.map((trial) => trial.taskName).filter(Boolean))].sort();
  const trialsByTask = new Map();
  for (const trial of trials) {
    if (!trial.taskName) continue;
    const bucket = trialsByTask.get(trial.taskName) ?? [];
    bucket.push(trial);
    trialsByTask.set(trial.taskName, bucket);
  }
  for (const bucket of trialsByTask.values()) {
    bucket.sort(compareTrials);
  }

  const firstFailures = [];
  const noAnyPass = [];
  const recoveredAfterFirstFailure = [];
  let firstPass = 0;
  let firstTotal = 0;
  let anyPass = 0;
  let tasksWithEffectiveTrial = 0;
  for (const taskName of configuredKeys) {
    const effectiveTrials = (trialsByTask.get(taskName) ?? []).filter(
      (trial) => trial.exceptionType !== "CancelledError",
    );
    if (effectiveTrials.length === 0) continue;
    tasksWithEffectiveTrial += 1;
    const first = effectiveTrials[0];
    firstTotal += 1;
    const taskAnyPass = effectiveTrials.some((trial) => trial.reward === 1);
    if (first.reward === 1) {
      firstPass += 1;
    } else {
      firstFailures.push(formatTaskTrial(taskName, first));
    }
    if (taskAnyPass) {
      anyPass += 1;
      if (first.reward !== 1) {
        const recovered = effectiveTrials.find((trial) => trial.reward === 1);
        if (recovered) {
          recoveredAfterFirstFailure.push({
            taskName,
            first: formatTaskTrial(taskName, first),
            recovered: formatTaskTrial(taskName, recovered),
          });
        }
      }
    } else {
      noAnyPass.push({
        taskName,
        attempts: effectiveTrials.map((trial) => formatTaskTrial(taskName, trial)),
      });
    }
  }

  return {
    configuredTaskCount: configuredKeys.length,
    trialCount: trials.length,
    rewardTrialCount: trials.filter((trial) => trial.reward !== undefined).length,
    effectiveTrialCount: trials.filter((trial) => trial.exceptionType !== "CancelledError").length,
    stopTailCancelledCount: trials.filter((trial) => trial.exceptionType === "CancelledError").length,
    controlledDeadlineCount: trials.filter((trial) => trial.controlledDeadlineReached === true).length,
    verifierTimeoutCount: trials.filter((trial) => trial.exceptionType === "VerifierTimeoutError").length,
    failureCategories: countFailureCategories(trials),
    firstUnique: {
      pass: firstPass,
      total: firstTotal,
      rate: ratio(firstPass, firstTotal),
    },
    anyPass: {
      pass: anyPass,
      total: configuredKeys.length,
      rate: ratio(anyPass, configuredKeys.length),
    },
    tasksWithEffectiveTrial,
    firstFailures,
    recoveredAfterFirstFailure,
    noAnyPass,
    repairTargets: buildRepairTargets(configuredKeys, trialsByTask),
  };
}

function buildRepairTargets(configuredKeys, trialsByTask) {
  const targets = [];
  for (const taskName of configuredKeys) {
    const effectiveTrials = (trialsByTask.get(taskName) ?? []).filter(
      (trial) => trial.exceptionType !== "CancelledError",
    );
    if (effectiveTrials.length === 0) continue;
    const failedTrials = effectiveTrials.filter((trial) => trial.reward !== 1);
    if (failedTrials.length === 0) continue;
    const recovered = effectiveTrials.find((trial) => trial.reward === 1);
    const categoryCounts = countFailureCategories(failedTrials);
    const sourceFailure =
      failedTrials.find((trial) => trial.failedTests.length > 0 || trial.failureDetails.length > 0) ??
      failedTrials[0];
    targets.push({
      taskName,
      attempts: effectiveTrials.length,
      pass: effectiveTrials.filter((trial) => trial.reward === 1).length,
      nonPass: failedTrials.length,
      lost: failedTrials.length,
      noAnyPass: recovered === undefined,
      recoveredAfterFailure: recovered !== undefined,
      primaryCategory: primaryCategory(categoryCounts),
      categories: categoryCounts,
      failedTests: uniqueStrings(failedTrials.flatMap((trial) => trial.failedTests)).slice(0, 20),
      failureDetails: uniqueStrings(failedTrials.flatMap((trial) => trial.failureDetails)).slice(0, 12),
      sourceTrial: formatTaskTrial(taskName, sourceFailure),
      ...(recovered ? { recoveredTrial: formatTaskTrial(taskName, recovered) } : {}),
      replayFacts: createReplayFacts(taskName, sourceFailure, recovered),
    });
  }
  return targets.sort((a, b) => {
    if (a.noAnyPass !== b.noAnyPass) return a.noAnyPass ? -1 : 1;
    return b.lost - a.lost || a.taskName.localeCompare(b.taskName);
  });
}

function primaryCategory(categoryCounts) {
  const entries = Object.entries(categoryCounts).filter(([category]) => category !== "resolved");
  entries.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return entries[0]?.[0] ?? "unknown_agent_error";
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function createReplayFacts(taskName, trial, recovered) {
  return {
    task_name: taskName,
    source_trial: trial.trialName,
    ...(recovered ? { recovered_trial: recovered.trialName } : {}),
    previous_outcome: recovered ? "recovered_after_failure" : "no_any_pass",
    reward: trial.reward ?? 0,
    ...(trial.cliExitCode === undefined ? {} : { cli_exit_code: trial.cliExitCode }),
    ...(trial.controlledDeadlineReached === undefined
      ? {}
      : { controlled_deadline_reached: trial.controlledDeadlineReached }),
    verifier_timeout: trial.exceptionType === "VerifierTimeoutError",
    ...(trial.ctrfSummary ? { ctrf_summary: trial.ctrfSummary } : {}),
    ...(trial.failedTests.length ? { failed_tests: trial.failedTests.slice(0, 20) } : {}),
    ...(trial.failureDetails.length ? { failure_details: trial.failureDetails.slice(0, 12) } : {}),
    ...(trial.testStdoutSummary ? { test_stdout_summary: trial.testStdoutSummary } : {}),
  };
}

async function readConfiguredTasks(root) {
  const config = await readJsonFile(join(root, "config.json"));
  const datasets = Array.isArray(config?.datasets) ? config.datasets : [];
  const tasks = [];
  for (const dataset of datasets) {
    const taskNames = Array.isArray(dataset?.task_names) ? dataset.task_names : [];
    for (const taskName of taskNames) {
      if (typeof taskName === "string" && taskName.length > 0) {
        tasks.push(normalizeTaskName(taskName));
      }
    }
  }
  return [...new Set(tasks)].sort();
}

async function findTrialDirs(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (existsSync(join(dir, "result.json")) || existsSync(join(dir, "config.json"))) {
      dirs.push(dir);
    }
  }
  return dirs.sort((a, b) => a.localeCompare(b));
}

async function readTrialFacts(root, dir) {
  const result = await readJsonFile(join(dir, "result.json"));
  const config = await readJsonFile(join(dir, "config.json"));
  const metadata = await readJsonFile(join(dir, "agent", "linghun-metadata.json"));
  const ctrf = await readJsonFile(join(dir, "verifier", "ctrf.json"));
  const testStdout = await readOptionalTextFile(join(dir, "verifier", "test-stdout.txt"));
  const trialName = stringValue(result?.trial_name) ??
    stringValue(config?.trial_name) ??
    displayPath(root, dir);
  const taskName = taskNameFromResult(result) ??
    taskNameFromConfig(config) ??
    taskNameFromTrialName(trialName);
  const exceptionType = stringValue(result?.exception_info?.exception_type);
  return {
    trialName,
    taskName,
    reward: normalizeReward(result?.verifier_result?.rewards?.reward),
    exceptionType,
    startedAt: stringValue(result?.started_at),
    finishedAt: stringValue(result?.finished_at),
    cliExitCode: finiteNumber(metadata?.cli_exit_code) ??
      finiteNumber(result?.agent_result?.metadata?.cli_exit_code),
    controlledDeadlineReached:
      booleanValue(metadata?.controlled_deadline_reached) ??
      booleanValue(result?.agent_result?.metadata?.controlled_deadline_reached),
    crossTrialStateShared: booleanValue(metadata?.cross_trial_state_shared),
    ctrfSummary: readCtrfSummary(ctrf),
    failedTests: readFailedTests(ctrf),
    failureDetails: readFailureDetails(ctrf),
    testStdoutSummary: summarizeTextTail(testStdout),
    path: displayPath(root, dir),
  };
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function readOptionalTextFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function taskNameFromResult(result) {
  const taskIdName = stringValue(result?.task_id?.name);
  if (taskIdName) return normalizeTaskName(taskIdName);
  const taskName = stringValue(result?.task_name);
  return taskName ? normalizeTaskName(taskName) : undefined;
}

function taskNameFromConfig(config) {
  const taskName = stringValue(config?.task?.name);
  return taskName ? normalizeTaskName(taskName) : undefined;
}

function taskNameFromTrialName(trialName) {
  const marker = trialName.indexOf("__");
  return marker >= 0 ? trialName.slice(0, marker) : undefined;
}

function normalizeTaskName(taskName) {
  return taskName.includes("/") ? taskName.split("/").at(-1) : taskName;
}

function normalizeReward(reward) {
  const normalizedReward = typeof reward === "string" ? reward.toLowerCase() : reward;
  if (
    normalizedReward === true ||
    normalizedReward === 1 ||
    normalizedReward === "1" ||
    normalizedReward === "pass" ||
    normalizedReward === "passed"
  ) {
    return 1;
  }
  if (
    normalizedReward === false ||
    normalizedReward === 0 ||
    normalizedReward === "0" ||
    normalizedReward === "fail" ||
    normalizedReward === "failed"
  ) {
    return 0;
  }
  return undefined;
}

function readCtrfSummary(ctrf) {
  const summary = ctrf?.results?.summary;
  if (!isPlainObject(summary)) return undefined;
  return {
    ...optionalNumber(summary, "tests"),
    ...optionalNumber(summary, "passed"),
    ...optionalNumber(summary, "failed"),
    ...optionalNumber(summary, "skipped"),
  };
}

function readFailedTests(ctrf) {
  const tests = Array.isArray(ctrf?.results?.tests) ? ctrf.results.tests : [];
  return tests
    .filter((test) => isPlainObject(test) && test.status !== "passed")
    .map((test) => stringValue(test.name))
    .filter(Boolean)
    .slice(0, 20);
}

function readFailureDetails(ctrf) {
  const tests = Array.isArray(ctrf?.results?.tests) ? ctrf.results.tests : [];
  return tests
    .filter((test) => isPlainObject(test) && test.status !== "passed")
    .map((test) => {
      const name = stringValue(test.name) ?? "";
      const detail = ["message", "trace", "stdout", "stderr", "output"]
        .map((key) => boundedString(test[key], key === "trace" ? 700 : 360))
        .filter(Boolean)
        .join(" | ");
      return normalizeFactText([name, detail].filter(Boolean).join(": "));
    })
    .filter(Boolean)
    .slice(0, 12);
}

function boundedString(value, limit) {
  return typeof value === "string" ? normalizeFactText(value).slice(0, limit) : undefined;
}

function summarizeTextTail(text) {
  if (!text) return undefined;
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const summary = normalizeFactText(lines.slice(-18).join(" | "));
  return summary ? summary.slice(0, 1800) : undefined;
}

function normalizeFactText(text) {
  return text.replace(/\s+/gu, " ").trim();
}

function optionalNumber(object, key) {
  const value = finiteNumber(object[key]);
  return value === undefined ? {} : { [key]: value };
}

function finiteNumber(value) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function booleanValue(value) {
  return typeof value === "boolean" ? value : undefined;
}

function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function compareTrials(left, right) {
  return `${left.startedAt ?? ""}\0${left.trialName}`.localeCompare(
    `${right.startedAt ?? ""}\0${right.trialName}`,
  );
}

function formatTaskTrial(taskName, trial) {
  return {
    taskName,
    trialName: trial.trialName,
    reward: trial.reward ?? null,
    exceptionType: trial.exceptionType ?? null,
    cliExitCode: trial.cliExitCode ?? null,
    controlledDeadlineReached: trial.controlledDeadlineReached ?? null,
    ctrfSummary: trial.ctrfSummary ?? null,
    failedTests: trial.failedTests,
    failureDetails: trial.failureDetails,
    testStdoutSummary: trial.testStdoutSummary ?? null,
    path: trial.path,
  };
}

function countFailureCategories(trials) {
  const counters = {};
  for (const trial of trials) {
    const category = classifyTrialFailure(trial);
    counters[category] = (counters[category] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counters).sort((a, b) => a[0].localeCompare(b[0])));
}

function classifyTrialFailure(trial) {
  if (trial.reward === 1) return "resolved";
  if (trial.exceptionType === "CancelledError") return "interrupted";
  if (trial.exceptionType === "AgentTimeoutError") return "agent_timeout";
  if (trial.exceptionType === "VerifierTimeoutError") return "test_timeout";
  if (trial.controlledDeadlineReached === true) return "controlled_deadline";
  if (trial.exceptionType === "NonZeroAgentExitCodeError") return "unknown_agent_error";
  if (trial.failedTests.length > 0 || (trial.ctrfSummary?.failed ?? 0) > 0 || trial.reward === 0) {
    return "model_patch_failed";
  }
  return "unknown_agent_error";
}

function ratio(pass, total) {
  return total > 0 ? Number((pass / total).toFixed(6)) : 0;
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
  console.log("");
  console.log("official submission config:");
  console.log(`- status: ${summary.officialSubmissionConfig.ok ? "pass" : "fail"}`);
  console.log(`- checked trials: ${summary.officialSubmissionConfig.checkedTrials}`);
  console.log(`- violations: ${summary.officialSubmissionConfig.violationCount}`);
  for (const violation of summary.officialSubmissionConfig.violations.slice(0, 10)) {
    console.log(
      `  - ${violation.file}: ${violation.field}=${JSON.stringify(violation.value)} expected ${violation.expected}`,
    );
  }
  console.log("");
  console.log("trial task summary:");
  console.log(`- configured tasks: ${summary.trialTasks.configuredTaskCount}`);
  console.log(`- trials: ${summary.trialTasks.trialCount}`);
  console.log(`- effective trials: ${summary.trialTasks.effectiveTrialCount}`);
  console.log(`- stop-tail CancelledError: ${summary.trialTasks.stopTailCancelledCount}`);
  console.log(`- controlled deadline: ${summary.trialTasks.controlledDeadlineCount}`);
  console.log(`- verifier timeout: ${summary.trialTasks.verifierTimeoutCount}`);
  console.log(
    `- first unique: ${summary.trialTasks.firstUnique.pass}/${summary.trialTasks.firstUnique.total} (${formatRate(summary.trialTasks.firstUnique.rate)})`,
  );
  console.log(
    `- any-pass: ${summary.trialTasks.anyPass.pass}/${summary.trialTasks.anyPass.total} (${formatRate(summary.trialTasks.anyPass.rate)})`,
  );
  if (summary.trialTasks.noAnyPass.length > 0) {
    console.log("- no any-pass tasks:");
    for (const item of summary.trialTasks.noAnyPass) {
      console.log(`  - ${item.taskName}: ${item.attempts.length} effective attempt(s)`);
    }
  }
  if (summary.trialTasks.repairTargets.length > 0) {
    console.log("- repair targets:");
    for (const target of summary.trialTasks.repairTargets.slice(0, 10)) {
      console.log(
        `  - ${target.taskName}: pass=${target.pass}/${target.attempts} primary=${target.primaryCategory} failedTests=${target.failedTests.slice(0, 3).join(", ") || "none"}`,
      );
    }
  }
  if (summary.parseErrors.length > 0) {
    console.log("");
    console.log("parse warnings:");
    for (const warning of summary.parseErrors) {
      console.log(`- ${warning.file}: ${warning.error}`);
    }
  }
}

async function writeRepairFactsDir(summary, outputDir) {
  await mkdir(outputDir, { recursive: true });
  const manifest = {
    facts_status: "available",
    generated_at: new Date().toISOString(),
    source_job_dir: summary.jobDir,
    tasks: {},
  };
  for (const target of summary.trialTasks.repairTargets) {
    const fileName = `${safeFileName(target.taskName)}.json`;
    const payload = {
      facts_status: "available",
      task_name: target.taskName,
      facts: target.replayFacts,
    };
    await writeFile(join(outputDir, fileName), JSON.stringify(payload, null, 2), "utf8");
    manifest.tasks[target.taskName] = {
      file: fileName,
      facts: target.replayFacts,
    };
  }
  await writeFile(join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

function safeFileName(value) {
  return value.replace(/[^A-Za-z0-9._-]+/gu, "_").replace(/^_+|_+$/gu, "") || "task";
}

function formatRate(rate) {
  return `${(rate * 100).toFixed(2)}%`;
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
  console.log("Usage: node scripts/harbor-job-diagnostics.mjs <harbor-job-dir> [--json] [--official-submission-check] [--write-repair-facts-dir=<dir>]");
  console.log("");
  console.log("Read-only summary of structured JSON/JSONL fields in a Harbor job directory.");
}

function displayPath(root, file) {
  return relative(root, file).replace(/\\/g, "/");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
