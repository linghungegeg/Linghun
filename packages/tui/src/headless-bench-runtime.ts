import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createConnection } from "node:net";
import { createProcessGuard } from "./process-guard.js";

const DEFAULT_TEST_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;
const DEFAULT_ENVIRONMENT_SETUP_RETRIES = 1;
const MAX_REPAIR_ATTEMPTS = 2;
const MAX_ENVIRONMENT_SETUP_RETRIES = 3;
const OUTPUT_LIMIT = 24_000;
const SUMMARY_LIMIT = 4_000;
const OFFICIAL_PROCESS_STOP_TIMEOUT_MS = 5_000;
const ARTIFACT_SANITY_TIMEOUT_MS = 8_000;
const SERVICE_SANITY_TIMEOUT_MS = 2_000;

export type HeadlessBenchFailureCategory =
  | "model_patch_failed"
  | "agent_timeout"
  | "test_timeout"
  | "verifier_timeout"
  | "provider_error"
  | "unknown_agent_error"
  | "parse_or_harness_error"
  | "missing_artifact"
  | "environment_missing_tool"
  | "environment_error"
  | "network_pull_error"
  | "resource_exhausted";

export type HeadlessBenchTaskProfile =
  | "polyglot_cpp"
  | "polyglot_simple"
  | "swe_python"
  | "large_python_project"
  | "qemu_or_service"
  | "binary_or_artifact"
  | "ml_or_data"
  | "security_or_network"
  | "generic";

export type EngineeringTaskProfile = HeadlessBenchTaskProfile;
export type EngineeringFailureCategory = HeadlessBenchFailureCategory;

export type HeadlessArtifactKind =
  | "json"
  | "python"
  | "shell"
  | "c_source"
  | "cpp_source"
  | "text"
  | "binary"
  | "unknown";

export type HeadlessArtifactContract = {
  path: string;
  source: "option" | "env" | "prompt";
  kind: HeadlessArtifactKind;
  checks: string[];
  formatHint?: string;
};

export type HeadlessServiceContract = {
  host: string;
  port: number;
  source: "prompt";
  label?: string;
};

export type HeadlessArtifactValidationIssue = {
  path: string;
  kind: HeadlessArtifactKind;
  check: string;
  message: string;
};

export type HeadlessBenchFailure = {
  category: HeadlessBenchFailureCategory;
  summary: string;
  command?: string;
  exitCode?: number;
  logPath?: string;
  missingArtifacts?: string[];
  artifactIssues?: HeadlessArtifactValidationIssue[];
  officialResult?: HeadlessOfficialValidationResult;
};

export type HeadlessBenchConfig = {
  enabled: boolean;
  profile: HeadlessBenchTaskProfile;
  testCommand?: string;
  testTimeoutMs: number;
  maxRepairAttempts: number;
  requiredArtifacts: string[];
  artifactContracts?: HeadlessArtifactContract[];
  serviceContracts?: HeadlessServiceContract[];
  preflight: boolean;
  environmentSetupRetries: number;
  externalVerifier?: boolean;
  externalOfficialFacts?: HeadlessOfficialValidationFacts;
  externalOfficialFactsPath?: string;
  externalOfficialFactsTaskName?: string;
};

export type HeadlessBenchValidationResult =
  | {
      ok: true;
      testRan: boolean;
      summary: string;
      logPath?: string;
      officialResult?: HeadlessOfficialValidationResult;
      deferredToExternalVerifier?: boolean;
    }
  | { ok: false; failure: HeadlessBenchFailure };

export type HeadlessOfficialValidationFacts = {
  source: "project_local" | "external_file";
  taskName?: string;
  sourceTrial?: string;
  recoveredTrial?: string;
  previousOutcome?: string;
  reward?: number;
  rewardPath?: string;
  ctrfPath?: string;
  ctrfSummary?: {
    tests?: number;
    passed?: number;
    failed?: number;
    skipped?: number;
  };
  failedTests?: string[];
  failureDetails?: string[];
  testStdoutPath?: string;
  testStdoutSummary?: string;
  resultPath?: string;
  resultReward?: number;
  metadataPath?: string;
  cliExitCode?: number;
  controlledDeadlineReached?: boolean;
  verifierTimeout?: boolean;
  verifierTimeoutPath?: string;
  verifierTimeoutSummary?: string;
};

export type HeadlessOfficialValidationResult = {
  command: string;
  exitCode: number;
  outcome: "completed" | "timeout" | "cancelled";
  logPath: string;
  durationMs: number;
  facts?: HeadlessOfficialValidationFacts;
};

export type HeadlessBenchToolFailureFact = {
  toolName: string;
  summary: string;
  evidenceId?: string;
};

export type HeadlessArtifactChecklist = {
  requiredArtifacts: Array<{ path: string; present: boolean; kind?: HeadlessArtifactKind }>;
  serviceContracts?: Array<{ target: string; configured: boolean }>;
  changedFiles: string[];
  workspaceChangeHash?: string;
  verificationRan: boolean;
  externalVerifierDeferred?: boolean;
  lastValidationCategory?: HeadlessBenchFailureCategory;
  lastVerificationOutcome?: HeadlessOfficialValidationResult["outcome"];
  lastVerificationExitCode?: number;
  gitAvailable: boolean | "unknown";
  summary: string;
};

export type HeadlessEnvironmentPreflight = {
  checkedTools: string[];
  missingTools: string[];
  summary: string;
};

export type HeadlessBenchOptions = Partial<
  Pick<
    HeadlessBenchConfig,
    | "enabled"
    | "testCommand"
    | "testTimeoutMs"
    | "maxRepairAttempts"
    | "requiredArtifacts"
    | "artifactContracts"
    | "serviceContracts"
    | "preflight"
    | "environmentSetupRetries"
    | "externalVerifier"
    | "externalOfficialFacts"
    | "externalOfficialFactsPath"
    | "externalOfficialFactsTaskName"
  >
>;

export async function resolveHeadlessBenchConfig(input: {
  prompt: string;
  projectPath: string;
  env?: NodeJS.ProcessEnv;
  options?: HeadlessBenchOptions;
}): Promise<HeadlessBenchConfig> {
  const env = input.env ?? process.env;
  const promptLooksLikeTerminalBench = /Terminal-Bench task container/iu.test(input.prompt);
  const defaultTestCommand = await detectOfficialTestCommand(input.projectPath, env);
  const envEnabled = parseBoolean(env.LINGHUN_HEADLESS_BENCH ?? env.LINGHUN_HEADLESS_VERIFY);
  const enabled =
    input.options?.enabled ??
    envEnabled ??
    (promptLooksLikeTerminalBench && Boolean(defaultTestCommand));
  const optionTestTimeoutMs = input.options?.testTimeoutMs;
  const testTimeoutMs = clampPositiveInteger(
    optionTestTimeoutMs ?? parsePositiveInteger(env.LINGHUN_HEADLESS_TEST_TIMEOUT_MS),
    DEFAULT_TEST_TIMEOUT_MS,
    optionTestTimeoutMs === undefined ? 30_000 : 1,
    1_800_000,
  );
  const environmentSetupRetries = clampPositiveInteger(
    input.options?.environmentSetupRetries ??
      parsePositiveInteger(env.LINGHUN_HEADLESS_ENV_SETUP_RETRIES),
    DEFAULT_ENVIRONMENT_SETUP_RETRIES,
    0,
    MAX_ENVIRONMENT_SETUP_RETRIES,
  );
  const artifactContracts = mergeArtifactContracts([
    ...(input.options?.artifactContracts ?? []),
    ...(input.options?.requiredArtifacts ?? []).map((path) =>
      createArtifactContract(path, "option", input.prompt)
    ),
    ...splitList(env.LINGHUN_HEADLESS_REQUIRED_ARTIFACTS).map((path) =>
      createArtifactContract(path, "env", input.prompt)
    ),
    ...detectRequiredArtifactContracts(input.prompt),
  ]);
  const serviceContracts = mergeServiceContracts([
    ...(input.options?.serviceContracts ?? []),
    ...detectServiceContracts(input.prompt),
  ]);
  const requiredArtifacts = artifactContracts.map((contract) => contract.path);
  const defaultRepairAttempts =
    artifactContracts.length > 0 || serviceContracts.length > 0
      ? MAX_REPAIR_ATTEMPTS
      : DEFAULT_MAX_REPAIR_ATTEMPTS;
  const maxRepairAttempts = clampPositiveInteger(
    input.options?.maxRepairAttempts ?? parsePositiveInteger(env.LINGHUN_HEADLESS_MAX_REPAIRS),
    defaultRepairAttempts,
    0,
    MAX_REPAIR_ATTEMPTS,
  );
  const testCommand = input.options?.testCommand ?? env.LINGHUN_HEADLESS_TEST_COMMAND ?? defaultTestCommand;
  const externalOfficialFactsPath =
    input.options?.externalOfficialFactsPath ?? env.LINGHUN_HEADLESS_OFFICIAL_FACTS_FILE;
  const externalOfficialFactsTaskName =
    input.options?.externalOfficialFactsTaskName ?? env.LINGHUN_HEADLESS_TASK_NAME;
  const externalOfficialFacts =
    input.options?.externalOfficialFacts ??
    (await readExternalHeadlessOfficialValidationFacts(
      externalOfficialFactsPath,
      externalOfficialFactsTaskName,
    ));
  const profile = await detectHeadlessBenchTaskProfile({
    prompt: input.prompt,
    projectPath: input.projectPath,
    requiredArtifacts,
    testCommand,
  });
  return {
    enabled,
    profile,
    ...(testCommand ? { testCommand } : {}),
    testTimeoutMs,
    maxRepairAttempts,
    requiredArtifacts,
    artifactContracts,
    serviceContracts,
    preflight: input.options?.preflight ?? parseBoolean(env.LINGHUN_HEADLESS_PREFLIGHT) ?? true,
    environmentSetupRetries,
    externalVerifier:
      input.options?.externalVerifier ?? parseBoolean(env.LINGHUN_HEADLESS_EXTERNAL_VERIFIER) ?? false,
    ...(externalOfficialFacts ? { externalOfficialFacts } : {}),
    ...(externalOfficialFactsPath ? { externalOfficialFactsPath } : {}),
    ...(externalOfficialFactsTaskName ? { externalOfficialFactsTaskName } : {}),
  };
}

export async function runHeadlessEnvironmentPreflight(
  projectPath: string,
): Promise<HeadlessEnvironmentPreflight> {
  const checkedTools = ["rg", "git", "grep", "find", "sed", "awk", "python3", "python", "node", "cmake", "g++"];
  const missingTools: string[] = [];
  for (const tool of checkedTools) {
    if (!(await isToolAvailable(tool, projectPath))) {
      missingTools.push(tool);
    }
  }
  const fallbackNote = missingTools.includes("rg")
    ? "rg missing; use grep/find fallback. Do not treat missing rg as task failure."
    : "rg available.";
  return {
    checkedTools,
    missingTools,
    summary: `tools checked: ${checkedTools.length}; missing: ${missingTools.join(", ") || "none"}; ${fallbackNote}`,
  };
}

export function createHeadlessBenchInitialPrompt(input: {
  originalPrompt: string;
  config: HeadlessBenchConfig;
  preflight?: HeadlessEnvironmentPreflight;
}): string {
  if (!input.config.enabled) return input.originalPrompt;
  const artifactContracts = getArtifactContracts(input.config);
  const serviceContracts = getServiceContracts(input.config);
  const required = artifactContracts.length
    ? `Required artifact contract: ${formatHeadlessArtifactContracts(artifactContracts)}. Satisfy every check before final.`
    : "No explicit output artifact path was detected; still verify observable task completion.";
  const service = serviceContracts.length
    ? `Service contract: ${formatHeadlessServiceContracts(serviceContracts)}. Verify each endpoint is reachable before final.`
    : "";
  const test = input.config.testCommand
    ? `Official test command available: ${input.config.testCommand}. Prefer it over ad-hoc smoke tests before final.`
    : "No official test command was detected; use the strongest task-local verification available.";
  const preflight = input.preflight ? `Environment preflight: ${input.preflight.summary}` : "";
  const externalFacts = formatInitialExternalVerifierFacts(
    input.config.externalOfficialFacts,
    input.config.externalOfficialFactsPath,
  );
  return [
    input.originalPrompt,
    "",
    "[Linghun headless bench guard]",
    test,
    required,
    service,
    externalFacts,
    preflight,
    formatInitialProfileStrategy(input.config.profile),
    "If rg is unavailable, use grep/find/sed/awk fallbacks instead of failing the task.",
    "For leaderboard-style runs, treat the benchmark default per-trial timeout as a hard single-time budget; leave enough time for official validation and do not depend on extended timeout multipliers.",
    "Before long builds, training, or full suites, run a bounded probe/read of task-local tests, verifier facts, and likely failure surfaces.",
    "Run installs non-interactively with bounded timeouts; do not wait on apt/pip prompts.",
    "Do not claim completion from a self-written smoke test when an official test entrypoint is available.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function validateHeadlessBenchCompletion(input: {
  projectPath: string;
  config: HeadlessBenchConfig;
  deadlineAtMs?: number;
  requestOwnedVerificationEvidence?: boolean;
}): Promise<HeadlessBenchValidationResult> {
  if ((remainingDeadlineMs(input.deadlineAtMs) ?? 1) <= 0) {
    return {
      ok: false,
      failure: {
        category: "agent_timeout",
        summary: "Headless deadline reached before validation could start.",
      },
    };
  }
  const artifactResult = await validateRequiredArtifacts(input.projectPath, input.config);
  if (!artifactResult.ok) {
    const facts = await readHeadlessOfficialValidationFacts(input.projectPath);
    const officialFacts = facts ?? input.config.externalOfficialFacts;
    const structuredFailure = summarizeNonPassingOfficialFacts(officialFacts);
    const artifactSummary = `Required artifact contract failed: ${artifactResult.issues
      .map((issue) => `${issue.path} ${issue.check}: ${issue.message}`)
      .join("; ")}`;
    return {
      ok: false,
      failure: {
        category: "missing_artifact",
        summary: structuredFailure ? `${artifactSummary}\n${structuredFailure}` : artifactSummary,
        missingArtifacts: artifactResult.missing,
        artifactIssues: artifactResult.issues,
        ...(structuredFailure
          ? {
              officialResult: facts
                ? createProjectLocalOfficialResult(facts)
                : createExternalOfficialResult(
                    input.config.externalOfficialFacts,
                    input.config.externalOfficialFactsPath,
                  ),
            }
          : {}),
      },
    };
  }
  if (!input.config.testCommand) {
    const deferredToExternalVerifier = input.config.externalVerifier === true;
    const facts = await readHeadlessOfficialValidationFacts(input.projectPath);
    const structuredFailure = summarizeNonPassingOfficialFacts(facts);
    if (structuredFailure) {
      return {
        ok: false,
        failure: {
          category: officialFactsFailureCategory(facts),
          summary: structuredFailure,
          officialResult: createProjectLocalOfficialResult(facts),
        },
      };
    }
    if (officialFactsReportPass(facts)) {
      return {
        ok: true,
        testRan: false,
        summary: "project-local official verifier facts report pass",
        officialResult: createProjectLocalOfficialResult(facts),
      };
    }
    const externalStructuredFailure = summarizeNonPassingOfficialFacts(
      input.config.externalOfficialFacts,
    );
    if (externalStructuredFailure) {
      return {
        ok: false,
        failure: {
          category: officialFactsFailureCategory(input.config.externalOfficialFacts),
          summary: externalStructuredFailure,
          officialResult: createExternalOfficialResult(
            input.config.externalOfficialFacts,
            input.config.externalOfficialFactsPath,
          ),
        },
      };
    }
    if (deferredToExternalVerifier) {
      const sanity = await validateExternalVerifierSanity(input.projectPath, input.config);
      if (!sanity.ok) {
        return {
          ok: false,
          failure: {
            category: sanity.category,
            summary: sanity.summary,
          },
        };
      }
      return {
        ok: false,
        failure: {
          category: "unknown_agent_error",
          summary: `${headlessNoLocalTestSummary(input.config, true)}; no project-local reward=1 facts or local official test command ran, so no PASS evidence was generated.`,
          ...(input.config.externalOfficialFacts
            ? {
                officialResult: createExternalOfficialResult(
                  input.config.externalOfficialFacts,
                  input.config.externalOfficialFactsPath,
                ),
              }
            : {}),
        },
      };
    }
    return {
      ok: true,
      testRan: false,
      summary: headlessNoLocalTestSummary(input.config, deferredToExternalVerifier),
      ...(deferredToExternalVerifier ? { deferredToExternalVerifier: true } : {}),
    };
  }
  let result: Awaited<ReturnType<typeof runOfficialTestCommand>> | undefined;
  let setupRetry = 0;
  while (setupRetry <= input.config.environmentSetupRetries) {
    const remainingMs = remainingDeadlineMs(input.deadlineAtMs);
    if (remainingMs !== undefined && remainingMs <= 0) {
      return {
        ok: false,
        failure: {
          category: "agent_timeout",
          summary: "Headless deadline reached before official validation could complete.",
        },
      };
    }
    result = await runOfficialTestCommand({
      projectPath: input.projectPath,
      command: input.config.testCommand,
      timeoutMs: Math.max(
        1,
        Math.min(input.config.testTimeoutMs, remainingMs ?? input.config.testTimeoutMs),
      ),
    });
    const setupFailure = classifyEnvironmentSetupFailure(result.output);
    if (
      result.exitCode === 0 ||
      result.outcome !== "completed" ||
      !setupFailure.retryable ||
      setupRetry >= input.config.environmentSetupRetries
    ) {
      break;
    }
    setupRetry += 1;
    const retryDelayMs = Math.min(500 * 2 ** (setupRetry - 1), 2_000);
    const retryRemainingMs = remainingDeadlineMs(input.deadlineAtMs);
    if (retryRemainingMs !== undefined && retryRemainingMs <= retryDelayMs) {
      return {
        ok: false,
        failure: {
          category: "agent_timeout",
          summary: "Headless deadline reached before environment setup retry.",
        },
      };
    }
    await sleep(retryDelayMs);
  }
  if (!result) {
    throw new Error("headless validation did not run");
  }
  const officialResult: HeadlessOfficialValidationResult = {
    command: input.config.testCommand,
    exitCode: result.exitCode,
    outcome: result.outcome,
    logPath: result.logPath,
    durationMs: result.durationMs,
    ...(result.facts ? { facts: result.facts } : {}),
  };
  const structuredFailure =
    result.exitCode === 0 && result.outcome === "completed"
      ? summarizeNonPassingOfficialFacts(result.facts)
      : undefined;
  if (result.exitCode === 0 && result.outcome === "completed" && !structuredFailure) {
    return {
      ok: true,
      testRan: true,
      summary: `official test passed: ${input.config.testCommand}`,
      logPath: result.logPath,
      officialResult,
    };
  }
  const category = structuredFailure
    ? officialFactsFailureCategory(result.facts)
    : classifyHeadlessFailure({
        output: result.output,
        outcome: result.outcome,
        exitCode: result.exitCode,
      });
  return {
    ok: false,
    failure: {
      category,
      command: input.config.testCommand,
      exitCode: result.exitCode,
      logPath: result.logPath,
      summary: structuredFailure ?? summarizeFailureOutput(result.output, category),
      officialResult,
    },
  };
}

function headlessNoLocalTestSummary(
  config: HeadlessBenchConfig,
  deferredToExternalVerifier: boolean,
): string {
  const localSummary = config.requiredArtifacts.length
    ? "required artifacts exist; no local official test command detected"
    : "no local official test command or explicit artifact requirement detected";
  return deferredToExternalVerifier
    ? `${localSummary}; pass/fail deferred to external verifier`
    : localSummary;
}

function summarizeNonPassingOfficialFacts(
  facts: HeadlessOfficialValidationFacts | undefined,
): string | undefined {
  if (!facts) return undefined;
  const reasons = [
    ...(facts.verifierTimeout
      ? [`verifierTimeout=true${facts.verifierTimeoutSummary ? ` (${facts.verifierTimeoutSummary})` : ""}`]
      : []),
    ...(facts.reward !== undefined && facts.reward < 1 ? [`reward=${facts.reward}`] : []),
    ...(facts.resultReward !== undefined && facts.resultReward < 1
      ? [`resultReward=${facts.resultReward}`]
      : []),
    ...((facts.ctrfSummary?.failed ?? 0) > 0 ? [`ctrfFailed=${facts.ctrfSummary?.failed}`] : []),
    ...(facts.failedTests?.length
      ? [`failedTests=${facts.failedTests.slice(0, 5).join(", ")}`]
      : []),
    ...(facts.failureDetails?.length
      ? [`failureDetails=${facts.failureDetails.slice(0, 3).join(" | ")}`]
      : []),
    ...(facts.cliExitCode !== undefined && facts.cliExitCode !== 0
      ? [`cliExitCode=${facts.cliExitCode}`]
      : []),
    ...(facts.controlledDeadlineReached ? ["controlledDeadlineReached=true"] : []),
  ];
  if (reasons.length === 0) return undefined;
  const supportingFacts = facts.testStdoutSummary ? [`testStdout=${facts.testStdoutSummary}`] : [];
  const source = facts.source === "external_file" ? "external verifier" : "project-local verifier";
  return `structured ${source} facts report non-pass (${[...reasons, ...supportingFacts].join("; ")})`;
}

function officialFactsReportPass(
  facts: HeadlessOfficialValidationFacts | undefined,
): boolean {
  if (!facts || summarizeNonPassingOfficialFacts(facts)) return false;
  if (facts.reward === 1 || facts.resultReward === 1) return true;
  return Boolean(
    facts.ctrfSummary &&
      (facts.ctrfSummary.tests ?? 0) > 0 &&
      (facts.ctrfSummary.failed ?? 0) === 0,
  );
}

function officialFactsFailureCategory(
  facts: HeadlessOfficialValidationFacts | undefined,
): HeadlessBenchFailureCategory {
  if (facts?.verifierTimeout) return "verifier_timeout";
  if (facts?.controlledDeadlineReached) return "test_timeout";
  return "model_patch_failed";
}

function createProjectLocalOfficialResult(
  facts: HeadlessOfficialValidationFacts | undefined,
): HeadlessOfficialValidationResult {
  return {
    command: "project-local official verifier facts",
    exitCode: facts?.cliExitCode ?? (summarizeNonPassingOfficialFacts(facts) ? 1 : 0),
    outcome: "completed",
    logPath: facts?.resultPath ?? facts?.ctrfPath ?? facts?.rewardPath ?? facts?.metadataPath ?? "",
    durationMs: 0,
    ...(facts ? { facts } : {}),
  };
}

function createExternalOfficialResult(
  facts: HeadlessOfficialValidationFacts | undefined,
  factsPath: string | undefined,
): HeadlessOfficialValidationResult {
  return {
    command: "external official verifier facts from previous run",
    exitCode: facts?.cliExitCode ?? (summarizeNonPassingOfficialFacts(facts) ? 1 : 0),
    outcome: "completed",
    logPath:
      factsPath ??
      facts?.resultPath ??
      facts?.ctrfPath ??
      facts?.rewardPath ??
      facts?.metadataPath ??
      "",
    durationMs: 0,
    ...(facts ? { facts } : {}),
  };
}

function formatInitialExternalVerifierFacts(
  facts: HeadlessOfficialValidationFacts | undefined,
  factsPath: string | undefined,
): string {
  if (!facts) return "";
  const formatted = formatRepairVerifierFacts(createExternalOfficialResult(facts, factsPath));
  if (!formatted) return "";
  return [
    "Previous official verifier facts from an earlier external run. Use them as repair context, not as current pass/fail evidence:",
    formatted,
  ].join("\n");
}

function remainingDeadlineMs(deadlineAtMs: number | undefined): number | undefined {
  return deadlineAtMs === undefined ? undefined : deadlineAtMs - Date.now();
}

export async function collectHeadlessArtifactChecklist(input: {
  projectPath: string;
  config: HeadlessBenchConfig;
  changedFiles: string[];
  lastValidation?: HeadlessBenchValidationResult;
}): Promise<HeadlessArtifactChecklist> {
  const requiredArtifacts: Array<{ path: string; present: boolean; kind?: HeadlessArtifactKind }> = [];
  for (const contract of getArtifactContracts(input.config)) {
    const target = resolveArtifactPath(input.projectPath, contract.path);
    requiredArtifacts.push({ path: contract.path, present: await canRead(target), kind: contract.kind });
  }
  const serviceContracts = getServiceContracts(input.config).map((contract) => ({
    target: `${contract.host}:${contract.port}`,
    configured: true,
  }));
  const failedValidation =
    input.lastValidation && !input.lastValidation.ok ? input.lastValidation.failure : undefined;
  const gitAvailable = await isToolAvailable("git", input.projectPath).catch(() => "unknown" as const);
  const verificationRan =
    (input.lastValidation?.ok === true && input.lastValidation.testRan) ||
    Boolean(failedValidation?.command);
  const externalVerifierDeferred = input.config.externalVerifier === true && !verificationRan;
  const lastValidationCategory = failedValidation?.category;
  const lastVerificationOutcome =
    input.lastValidation?.ok === true
      ? input.lastValidation.officialResult?.outcome
      : failedValidation?.officialResult?.outcome;
  const lastVerificationExitCode = failedValidation?.exitCode;
  const workspaceChangeHash = await computeWorkspaceChangeHash(input.projectPath, input.changedFiles);
  const summary = [
    `artifacts=${requiredArtifacts.length}`,
    `artifactsPresent=${requiredArtifacts.filter((item) => item.present).length}/${requiredArtifacts.length}`,
    ...(serviceContracts.length ? [`services=${serviceContracts.length}`] : []),
    `changedFiles=${input.changedFiles.length}`,
    `workspaceHash=${workspaceChangeHash.slice(0, 8)}`,
    `verificationRan=${verificationRan ? "yes" : "no"}`,
    ...(externalVerifierDeferred ? ["externalVerifier=deferred"] : []),
    `lastValidation=${lastValidationCategory ?? "none"}`,
    `lastVerificationOutcome=${lastVerificationOutcome ?? "none"}`,
    `lastVerificationExitCode=${lastVerificationExitCode ?? "none"}`,
    `git=${gitAvailable}`,
  ].join("; ");
  return {
    requiredArtifacts,
    ...(serviceContracts.length ? { serviceContracts } : {}),
    changedFiles: [...input.changedFiles],
    workspaceChangeHash,
    verificationRan,
    ...(externalVerifierDeferred ? { externalVerifierDeferred: true } : {}),
    ...(lastValidationCategory ? { lastValidationCategory } : {}),
    ...(lastVerificationOutcome ? { lastVerificationOutcome } : {}),
    ...(lastVerificationExitCode === undefined ? {} : { lastVerificationExitCode }),
    gitAvailable,
    summary,
  };
}

export type EnvironmentSetupFailureClassification = {
  category: "environment_error" | "network_pull_error" | "none";
  retryable: boolean;
  reason: string;
};

export function classifyEnvironmentSetupFailure(output: string): EnvironmentSetupFailureClassification {
  const text = output.toLowerCase();
  if (!/docker|containerd|image|pull|registry|hub\.docker|manifest|unauthorized/u.test(text)) {
    return { category: "none", retryable: false, reason: "no environment setup signature" };
  }
  if (
    /unexpected eof|connection reset|connection refused|tls handshake timeout|i\/o timeout|net\/http|temporary failure|temporary name resolution|dial tcp|context deadline exceeded|service unavailable|gateway timeout|too many requests|toomanyrequests|rate limit/u.test(
      text,
    )
  ) {
    return {
      category: "network_pull_error",
      retryable: true,
      reason: "transient docker pull or registry network failure",
    };
  }
  if (/no space left|disk quota|cannot allocate memory|out of memory|oom/u.test(text)) {
    return {
      category: "environment_error",
      retryable: false,
      reason: "local environment resource failure",
    };
  }
  if (/manifest unknown|not found|pull access denied|unauthorized|authentication required|repository does not exist/u.test(text)) {
    return {
      category: "environment_error",
      retryable: false,
      reason: "non-retryable docker image or registry access failure",
    };
  }
  return { category: "environment_error", retryable: false, reason: "environment setup failure" };
}

export function createHeadlessBenchRepairPrompt(input: {
  originalPrompt: string;
  failure: HeadlessBenchFailure;
  attempt: number;
  maxAttempts: number;
  profile?: HeadlessBenchTaskProfile;
  artifactContracts?: HeadlessArtifactContract[];
  serviceContracts?: HeadlessServiceContract[];
  preflight?: HeadlessEnvironmentPreflight;
  workspaceUnchanged?: boolean;
  remainingDeadline?: string;
  toolFailures?: HeadlessBenchToolFailureFact[];
  checklist?: HeadlessArtifactChecklist;
}): string {
  const artifactLine = input.failure.missingArtifacts?.length
    ? `Missing artifacts: ${input.failure.missingArtifacts.join(", ")}`
    : "";
  const artifactContractLine = input.artifactContracts?.length
    ? `Artifact contract: ${formatHeadlessArtifactContracts(input.artifactContracts)}`
    : "";
  const artifactIssueLine = formatArtifactValidationIssues(input.failure.artifactIssues);
  const serviceContractLine = input.serviceContracts?.length
    ? `Service contract: ${formatHeadlessServiceContracts(input.serviceContracts)}`
    : "";
  const logLine = input.failure.logPath ? `Full failure log: ${input.failure.logPath}` : "";
  const toolFailureLine = formatRepairToolFailures(input.toolFailures);
  const checklistLine = formatRepairChecklist(input.checklist);
  const verifierFactsLine = formatRepairVerifierFacts(input.failure.officialResult);
  const officialLogLine =
    input.failure.officialResult?.logPath && input.failure.officialResult.logPath !== input.failure.logPath
      ? `Official verifier log: ${input.failure.officialResult.logPath}`
      : "";
  return [
    `Headless verification failed (${input.failure.category}) on repair attempt ${input.attempt}/${input.maxAttempts}.`,
    "Continue from the current workspace. Do not restart from scratch unless necessary.",
    "Use the official test failure and current files to make the smallest fix, then rerun the official test or artifact check.",
    input.remainingDeadline ? `Remaining deadline before repair: ${input.remainingDeadline}.` : "",
    input.workspaceUnchanged
      ? "The previous repair did not change workspace content. Use the same failure evidence to choose a different minimal repair path."
      : "",
    formatRepairProfileStrategy(input.failure.category, input.profile ?? "generic"),
    input.preflight?.missingTools.includes("rg")
      ? "rg is missing in this environment; use grep/find/sed/awk fallbacks."
      : "",
    artifactLine,
    artifactContractLine,
    artifactIssueLine,
    serviceContractLine,
    checklistLine,
    toolFailureLine,
    verifierFactsLine,
    logLine,
    officialLogLine,
    "",
    "Failure summary:",
    input.failure.summary,
    "",
    "Original task:",
    input.originalPrompt,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatRepairToolFailures(
  failures: HeadlessBenchToolFailureFact[] | undefined,
): string {
  const items = (failures ?? [])
    .map((failure) => {
      const summary = failure.summary.replace(/\s+/gu, " ").trim();
      if (!summary) return undefined;
      const evidence = failure.evidenceId ? ` evidence=${failure.evidenceId}` : "";
      return `${failure.toolName}: ${summary.slice(0, 220)}${evidence}`;
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, 3);
  return items.length ? `Recent owner-scoped tool failure facts: ${items.join(" | ")}` : "";
}

function formatRepairChecklist(checklist: HeadlessArtifactChecklist | undefined): string {
  if (!checklist) return "";
  const missingArtifacts = checklist.requiredArtifacts
    .filter((artifact) => !artifact.present)
    .map((artifact) => artifact.path);
  const parts = [
    `artifactsPresent=${checklist.requiredArtifacts.filter((item) => item.present).length}/${checklist.requiredArtifacts.length}`,
    ...(missingArtifacts.length ? [`missingArtifacts=${missingArtifacts.join(", ")}`] : []),
    ...(checklist.serviceContracts?.length
      ? [`serviceContracts=${checklist.serviceContracts.map((item) => item.target).join(", ")}`]
      : []),
    `changedFiles=${checklist.changedFiles.length}`,
    `verificationRan=${checklist.verificationRan ? "yes" : "no"}`,
    `lastValidation=${checklist.lastValidationCategory ?? "none"}`,
    `lastVerificationOutcome=${checklist.lastVerificationOutcome ?? "none"}`,
    `lastVerificationExitCode=${checklist.lastVerificationExitCode ?? "none"}`,
    ...(checklist.externalVerifierDeferred ? ["externalVerifier=deferred"] : []),
  ];
  return `Artifact/install checklist facts: ${parts.join("; ")}. Close every missing artifact or failed official validation before final; do not treat a file or binary existing by itself as a complete install/runtime pass.`;
}

function formatRepairVerifierFacts(
  officialResult: HeadlessOfficialValidationResult | undefined,
): string {
  const facts = officialResult?.facts;
  if (!facts && !officialResult?.logPath) return "";
  const parts = [
    ...(facts?.taskName ? [`task=${facts.taskName}`] : []),
    ...(facts?.sourceTrial ? [`sourceTrial=${facts.sourceTrial}`] : []),
    ...(facts?.recoveredTrial ? [`recoveredTrial=${facts.recoveredTrial}`] : []),
    ...(facts?.previousOutcome ? [`previousOutcome=${facts.previousOutcome}`] : []),
    ...(facts?.reward !== undefined ? [`reward=${facts.reward}`] : []),
    ...(facts?.resultReward !== undefined ? [`resultReward=${facts.resultReward}`] : []),
    ...(facts?.ctrfSummary ? [`ctrfFailed=${facts.ctrfSummary.failed}/${facts.ctrfSummary.tests}`] : []),
    ...(facts?.failedTests?.length ? [`failedTests=${facts.failedTests.slice(0, 5).join(", ")}`] : []),
    ...(facts?.cliExitCode !== undefined ? [`cliExitCode=${facts.cliExitCode}`] : []),
    ...(facts?.controlledDeadlineReached !== undefined
      ? [`controlledDeadlineReached=${facts.controlledDeadlineReached}`]
      : []),
    ...(officialResult?.logPath ? [`logPath=${officialResult.logPath}`] : []),
  ];
  const detailLines = facts?.failureDetails?.length
    ? [
        "Official verifier failure details:",
        ...facts.failureDetails.slice(0, 5).map((detail) => `- ${detail}`),
      ]
    : [];
  const stdoutLines = facts?.testStdoutSummary
    ? ["Official verifier stdout tail:", facts.testStdoutSummary]
    : [];
  const route = formatOfficialFactsRepairRoute(facts);
  const header = parts.length ? `Official verifier facts: ${parts.join("; ")}` : "";
  return [header, route, ...detailLines, ...stdoutLines].filter(Boolean).join("\n");
}

function formatOfficialFactsRepairRoute(
  facts: HeadlessOfficialValidationFacts | undefined,
): string {
  if (!facts) return "";
  const routes: string[] = [];
  if (facts.previousOutcome === "no_any_pass") {
    routes.push("no previous attempt passed; read the verifier/tests first and avoid repeating broad exploration");
  } else if (facts.previousOutcome === "recovered_after_failure") {
    routes.push("a sibling attempt previously passed; treat these facts as pitfalls to avoid, not as proof the current workspace passes");
  }
  if (facts.controlledDeadlineReached) {
    routes.push("deadline was reached; use bounded probes, reduce long setup/run loops, and leave budget for official validation");
  }
  if (facts.verifierTimeout) {
    routes.push("verifier timed out; check process exit, artifact readiness, and background service cleanup before changing core logic");
  }

  const surface = [
    facts.taskName,
    ...(facts.failedTests ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
  if (/vm_execution|frame_bmp|qemu|mips|windows|ssh|grpc|server/u.test(surface)) {
    routes.push("vm/service surface; verify the real command, artifact path, port/log readiness, and bounded runtime before final");
  } else if (/primer|gblock|\bdna\b|protein|assembly/u.test(surface)) {
    routes.push("sequence assembly surface; read the exact primer, block, and sequence constraints before generating outputs");
  } else if (/xss|sanitize|secret|html|sparql|query|data_matches|tokens/u.test(surface)) {
    routes.push("data/security surface; use structured parsing where available and preserve benign input while matching the verifier output shape");
  } else if (/elf|binary|output_matches|reference/u.test(surface)) {
    routes.push("binary/artifact surface; inspect required output bytes, reference comparison, and artifact paths before final validation");
  } else if (/video|image|frame|bmp|jump/u.test(surface)) {
    routes.push("media output surface; inspect required files, formats, dimensions, and similarity checks before expensive processing");
  } else if (/model|torch|accuracy|loss|matrix|fasttext|mteb|posterior|stan|portfolio|gpt2/u.test(surface)) {
    routes.push("ml/data surface; inspect thresholds, schema, dimensions, and deterministic seeds with small focused checks before expensive runs");
  } else if (/compile|cython|sqlite|gcov|compcert|extension|\bimport\b|core_import|cmake|link/u.test(surface)) {
    routes.push("build/import surface; use the existing build system and verify binaries/extensions/imports are visible to the test environment");
  }

  return routes.length ? `Official verifier repair route: ${routes.slice(0, 4).join("; ")}.` : "";
}

export function formatHeadlessArtifactContracts(contracts: HeadlessArtifactContract[]): string {
  return contracts
    .map((contract) => {
      const checks = contract.checks.length ? ` checks=${contract.checks.join("+")}` : "";
      const format = contract.formatHint ? ` format=${contract.formatHint}` : "";
      return `${contract.path} kind=${contract.kind}${checks}${format}`;
    })
    .join("; ");
}

export function formatHeadlessServiceContracts(contracts: HeadlessServiceContract[]): string {
  return contracts.map((contract) => `${contract.host}:${contract.port}`).join(", ");
}

function formatArtifactValidationIssues(
  issues: HeadlessArtifactValidationIssue[] | undefined,
): string {
  if (!issues?.length) return "";
  return `Artifact validation issues: ${issues
    .slice(0, 8)
    .map((issue) => `${issue.path} ${issue.check}: ${issue.message}`)
    .join(" | ")}`;
}

export async function detectHeadlessBenchTaskProfile(input: {
  prompt: string;
  projectPath: string;
  requiredArtifacts?: string[];
  testCommand?: string;
}): Promise<HeadlessBenchTaskProfile> {
  const files = await listProjectFiles(input.projectPath, 220);
  const haystack = `${input.prompt}\n${input.testCommand ?? ""}\n${files.join("\n")}`.toLowerCase();
  const requiredArtifacts = input.requiredArtifacts ?? detectRequiredArtifacts(input.prompt);
  if (/qemu|systemd|daemon|server|service|\bport\b|localhost|healthcheck|http server|socket/u.test(haystack)) {
    return "qemu_or_service";
  }
  if (/ctf|crypto|exploit|vulnerab|network|packet|pcap|tls|ssh|jwt|xss|sql injection/u.test(haystack)) {
    return "security_or_network";
  }
  if (/model|train|dataset|csv|parquet|numpy|pandas|sklearn|torch|tensorflow|notebook|\.ipynb/u.test(haystack)) {
    return "ml_or_data";
  }
  if (
    requiredArtifacts.length > 0 ||
    /binary|artifact|out\.txt|hexdump|strings|elf|file command|ldd|\.bin|\.so|\.exe/u.test(haystack)
  ) {
    return "binary_or_artifact";
  }
  if (/cmakelists\.txt|\.hpp|\.hxx|\.cc|\.cpp|g\+\+|c\+\+|catch2|gtest|polyglot_cpp/u.test(haystack)) {
    return "polyglot_cpp";
  }
  if (/polyglot|exercism|canonical-data|\.go|\.rs|\.java|\.rb|\.js/u.test(haystack)) {
    return "polyglot_simple";
  }
  if (/django|flask|fastapi|pyproject\.toml|setup\.py|tox\.ini|pytest|requirements\.txt/u.test(haystack)) {
    const pythonFiles = files.filter((file) => file.endsWith(".py")).length;
    return pythonFiles > 25 || /large|monorepo|package|src\//u.test(haystack)
      ? "large_python_project"
      : "swe_python";
  }
  return "generic";
}

export async function detectEngineeringTaskProfile(input: {
  prompt: string;
  projectPath: string;
  requiredArtifacts?: string[];
  testCommand?: string;
}): Promise<EngineeringTaskProfile> {
  if (!looksLikeEngineeringProfilePrompt(input.prompt)) return "generic";
  return detectHeadlessBenchTaskProfile(input);
}

function looksLikeEngineeringProfilePrompt(prompt: string): boolean {
  return /(?:fix|implement|debug|test|build|compile|artifact|binary|service|server|port|pytest|cmake|c\+\+|python|修|改|实现|调试|测试|构建|编译|产物|服务|端口|智能体|工作流|验证)/iu.test(
    prompt,
  );
}

export function classifyHeadlessFailure(input: {
  output: string;
  outcome?: "completed" | "timeout" | "cancelled";
  exitCode?: number;
}): HeadlessBenchFailureCategory {
  const text = input.output.toLowerCase();
  if (hasVerifierTimeoutSignal(input.output)) {
    return "verifier_timeout";
  }
  if (input.outcome === "timeout" || /timed out|timeout after|test command timed out/u.test(text)) {
    return "test_timeout";
  }
  const setupFailure = classifyEnvironmentSetupFailure(input.output);
  if (setupFailure.category !== "none") {
    return setupFailure.category;
  }
  if (/rate limit|provider|api key|upstream|stream interrupted|connection reset|econnreset|fetch failed/u.test(text)) {
    return "provider_error";
  }
  if (/no space left|cannot allocate memory|out of memory|oom|resource temporarily unavailable/u.test(text)) {
    return "resource_exhausted";
  }
  if (/cmake|g\+\+|undefined reference|compile error|build failed|make: \*\*\*/u.test(text)) {
    return "model_patch_failed";
  }
  if (/command not found|not found:|no such file or directory/u.test(text) && /\brg\b|cmake|g\+\+|python|node/u.test(text)) {
    return "environment_missing_tool";
  }
  if (/no short test summary|error parsing results|harness|post-test|parse/u.test(text)) {
    return "parse_or_harness_error";
  }
  if (/agent timed out|agent_timeout/u.test(text)) {
    return "agent_timeout";
  }
  if (/unknown_agent_error|uncaught|unhandled|internal error/u.test(text)) {
    return "unknown_agent_error";
  }
  return "model_patch_failed";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function formatInitialProfileStrategy(profile: HeadlessBenchTaskProfile): string {
  switch (profile) {
    case "polyglot_cpp":
      return "Profile polyglot_cpp: read headers and official tests first; match signatures exactly; prefer official CMake/tests over ad-hoc g++ smoke.";
    case "polyglot_simple":
      return "Profile polyglot_simple: read the canonical tests and target API first; run focused tests before the final official test.";
    case "swe_python":
    case "large_python_project":
      return "Profile python_swe: read relevant tests and target modules first; use focused pytest/tests before any expensive full run; avoid unrelated architecture edits.";
    case "binary_or_artifact":
      return "Profile binary_or_artifact: identify file/strings/hexdump/ldd/run mode first; verify required artifacts exist and are non-empty before final.";
    case "qemu_or_service":
    case "security_or_network":
      return "Profile service_security: confirm service, ports, logs, and health checks; wrap long commands with timeouts and clean background processes.";
    case "ml_or_data":
      return "Profile ml_or_data: inspect data size and script parameters first; prefer small-sample or focused validation over unbounded training.";
    case "generic":
      return "Profile generic: read task-local tests and changed files first; use focused verification before final official validation.";
  }
}

export function formatEngineeringProfileStrategyHint(profile: EngineeringTaskProfile): string {
  switch (profile) {
    case "polyglot_cpp":
      return "read headers/tests first, align signatures exactly, then verify with the project test entrypoint";
    case "polyglot_simple":
      return "read canonical tests and target API first, then run focused verification before final";
    case "swe_python":
    case "large_python_project":
      return "read relevant tests and target modules first, prefer focused tests, and do not imply full-suite pass from focused evidence";
    case "binary_or_artifact":
      return "identify artifact expectations early and verify required files exist, are readable, and are non-empty before final";
    case "qemu_or_service":
    case "security_or_network":
      return "verify service, port, logs, or health checks before claiming runtime success; avoid leaving background processes";
    case "ml_or_data":
      return "inspect data size and script parameters first, use bounded sample validation before expensive runs";
    case "generic":
      return "read task-local sources/tests first and use focused verification before final claims";
  }
}

export function formatEngineeringFailureBoundaryHint(input: {
  profile: EngineeringTaskProfile;
  failureCategory?: EngineeringFailureCategory;
}): string | undefined {
  if (input.failureCategory === "missing_artifact") {
    return "final must be downgraded until the required artifact exists and is readable/non-empty";
  }
  if (input.failureCategory === "test_timeout") {
    return "final must state timeout or partial verification; do not present focused checks as full pass";
  }
  if (input.failureCategory === "verifier_timeout") {
    return "final must state external verifier timeout; do not present it as a model/task failure or pass";
  }
  if (input.failureCategory === "agent_timeout") {
    return "final must state deadline/agent-timeout boundary; avoid claiming full completion after closure";
  }
  if (input.failureCategory === "model_patch_failed") {
    return "final should name the concrete verifier/test facts that still fail, or state the exact official validation rerun that passed";
  }
  if (input.failureCategory === "provider_error") {
    return "final must state provider interruption if completion relies on interrupted model output";
  }
  if (input.profile === "binary_or_artifact") {
    return "final should include artifact existence/non-empty verification status";
  }
  if (input.profile === "swe_python" || input.profile === "large_python_project") {
    return "final should distinguish focused tests from full test-suite verification";
  }
  if (input.profile === "qemu_or_service" || input.profile === "security_or_network") {
    return "final should state whether service/port/log/health checks were actually verified";
  }
  return undefined;
}

function formatRepairProfileStrategy(
  category: HeadlessBenchFailureCategory,
  profile: HeadlessBenchTaskProfile,
): string {
  if (category === "missing_artifact") {
    return "Repair route: generate or write the required artifact now, then verify it exists, is readable, and is non-empty.";
  }
  if (category === "test_timeout") {
    if (profile === "qemu_or_service" || profile === "security_or_network") {
      return "Repair route: inspect service logs, ports, and health checks with bounded timeouts; do not relaunch long full-system checks until the focused failure is fixed.";
    }
    if (profile === "ml_or_data") {
      return "Repair route: use bounded samples, smaller parameters, or cached intermediate outputs to isolate the timeout before any full data/training run.";
    }
    return "Repair route: narrow validation to focused tests or logs first; avoid repeatedly launching full expensive runs.";
  }
  if (category === "verifier_timeout") {
    return "Repair route: external verifier timed out; preserve produced artifacts/services and retry verifier instead of changing task code blindly.";
  }
  if (category === "agent_timeout") {
    return "Repair route: stop broad exploration, preserve current facts, and make only a bounded minimal repair that can complete before the deadline.";
  }
  if (category === "provider_error") {
    return "Repair route: continue from existing files and evidence; do not redo unrelated exploration.";
  }
  if (category === "model_patch_failed" && profile === "polyglot_cpp") {
    return "Repair route: align header/test signatures, types, missing symbols, and CMake linkage before changing broader logic.";
  }
  if (category === "model_patch_failed" && profile === "qemu_or_service") {
    return "Repair route: fix the concrete service, port, log, or health-check failure first; keep commands bounded and clean background processes.";
  }
  if (category === "model_patch_failed" && profile === "security_or_network") {
    return "Repair route: fix the concrete verifier fact for crypto/network/security behavior; validate with the smallest real check, not a simulated pass.";
  }
  if (category === "model_patch_failed" && profile === "ml_or_data") {
    return "Repair route: fix the concrete data/schema/model assertion using bounded sample validation before any expensive full run.";
  }
  if (category === "model_patch_failed") {
    return "Repair route: fix the concrete compile/assertion failure with the smallest patch, then rerun focused verification.";
  }
  return "";
}

async function detectOfficialTestCommand(
  projectPath: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  if (env.LINGHUN_HEADLESS_TEST_COMMAND) return env.LINGHUN_HEADLESS_TEST_COMMAND;
  const candidates = [
    "/tests/run-tests.sh",
    join(projectPath, "tests", "run-tests.sh"),
    join(projectPath, "run-tests.sh"),
  ];
  for (const candidate of candidates) {
    if (await canRead(candidate)) {
      return candidate.endsWith(".sh") ? `bash ${shellQuote(candidate)}` : shellQuote(candidate);
    }
  }
  return undefined;
}

async function listProjectFiles(projectPath: string, limit: number): Promise<string[]> {
  const results: string[] = [];
  const ignored = new Set([".git", "node_modules", ".linghun", "__pycache__", ".pytest_cache", "dist", "build"]);
  async function walk(dir: string, prefix: string): Promise<void> {
    if (results.length >= limit) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit || ignored.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, relative);
      } else if (entry.isFile()) {
        results.push(relative);
      }
    }
  }
  await walk(projectPath, "");
  return results;
}

export function detectEngineeringArtifactTargets(prompt: string): string[] {
  return detectRequiredArtifactContracts(prompt).map((contract) => contract.path);
}

function detectRequiredArtifactContracts(prompt: string): HeadlessArtifactContract[] {
  const artifacts: Array<{ path: string; context: string }> = [];
  const absolutePathPattern =
    /(?:\b(?:write|save|print|output|store|create|generate|return|place|put)\b|写入|保存|输出|生成|创建|放到|放入|返回)[\s\S]{0,120}?[`"']?(\/[A-Za-z0-9._/-]+\.[A-Za-z0-9._-]+)[`"']?/giu;
  for (const match of prompt.matchAll(absolutePathPattern)) {
    artifacts.push({ path: match[1], context: promptContext(prompt, match.index ?? 0, 260) });
  }
  const namedFilePattern =
    /(?:\b(?:file called|file named|called|named|to a file|write .*? to)\b|文件名为|文件叫|写到文件|输出到文件)\s+[`"']?([A-Za-z0-9._/-]+\.[A-Za-z0-9._-]+)[`"']?/giu;
  for (const match of prompt.matchAll(namedFilePattern)) {
    artifacts.push({ path: match[1], context: promptContext(prompt, match.index ?? 0, 260) });
  }
  return mergeArtifactContracts(
    artifacts
      .map((artifact) => ({
        ...artifact,
        path: normalizeArtifactPath(artifact.path),
      }))
      .filter((artifact) => !artifact.path.includes("*"))
      .map((artifact) => createArtifactContract(artifact.path, "prompt", artifact.context)),
  );
}

function detectRequiredArtifacts(prompt: string): string[] {
  return detectRequiredArtifactContracts(prompt).map((contract) => contract.path);
}

function normalizeArtifactPath(value: string): string {
  return value.replace(/[),.;:!?]+$/u, "");
}

function promptContext(prompt: string, index: number, radius: number): string {
  return prompt.slice(Math.max(0, index - radius), Math.min(prompt.length, index + radius));
}

function createArtifactContract(
  path: string,
  source: HeadlessArtifactContract["source"],
  context = "",
): HeadlessArtifactContract {
  const normalized = normalizeArtifactPath(path);
  const kind = inferArtifactKind(normalized, context);
  const formatHint = inferArtifactFormatHint(kind, context);
  const checks = artifactChecksForKind(kind);
  if (kind === "json" && formatHint.formatHint) {
    checks.push("json_shape_if_format_hint");
  }
  return {
    path: normalized,
    source,
    kind,
    checks,
    ...formatHint,
  };
}

function inferArtifactKind(path: string, context: string): HeadlessArtifactKind {
  const extension = extname(path).toLowerCase();
  if (extension === ".json") return "json";
  if (extension === ".py") return "python";
  if (extension === ".sh" || extension === ".bash") return "shell";
  if (extension === ".c") return "c_source";
  if ([".cc", ".cpp", ".cxx", ".hpp", ".hxx"].includes(extension)) return "cpp_source";
  if ([".txt", ".csv", ".tsv", ".md", ".vim", ".sql", ".conf", ".log"].includes(extension)) {
    return "text";
  }
  if (/\b(?:json format|valid json|schema)\b/iu.test(context)) return "json";
  if (/\bpython script\b/iu.test(context)) return "python";
  if (/\b(?:c program|c source)\b/iu.test(context)) return "c_source";
  return "unknown";
}

function artifactChecksForKind(kind: HeadlessArtifactKind): string[] {
  switch (kind) {
    case "json":
      return ["exists", "non_empty", "valid_json"];
    case "python":
      return ["exists", "non_empty", "python_syntax_if_available"];
    case "shell":
      return ["exists", "non_empty", "shell_syntax_if_available"];
    case "c_source":
      return ["exists", "non_empty", "c_syntax_if_available"];
    case "cpp_source":
      return ["exists", "non_empty", "cpp_syntax_if_available"];
    case "text":
    case "binary":
    case "unknown":
      return ["exists", "non_empty"];
  }
}

function inferArtifactFormatHint(
  kind: HeadlessArtifactKind,
  context: string,
): Pick<HeadlessArtifactContract, "formatHint"> {
  if (kind !== "json") return {};
  const braceStart = context.indexOf("{");
  const braceEnd = context.lastIndexOf("}");
  if (braceStart < 0 || braceEnd <= braceStart) return {};
  const hint = context.slice(braceStart, braceEnd + 1).replace(/\s+/gu, " ").trim();
  return hint.length > 0 ? { formatHint: hint.slice(0, 280) } : {};
}

function mergeArtifactContracts(contracts: HeadlessArtifactContract[]): HeadlessArtifactContract[] {
  const byPath = new Map<string, HeadlessArtifactContract>();
  for (const contract of contracts) {
    if (!contract.path || contract.path.includes("*")) continue;
    const previous = byPath.get(contract.path);
    if (!previous) {
      byPath.set(contract.path, { ...contract, checks: uniqueStrings(contract.checks) });
      continue;
    }
    byPath.set(contract.path, {
      ...previous,
      kind: previous.kind === "unknown" ? contract.kind : previous.kind,
      checks: uniqueStrings([...previous.checks, ...contract.checks]),
      formatHint: previous.formatHint ?? contract.formatHint,
    });
  }
  return [...byPath.values()];
}

function getArtifactContracts(config: HeadlessBenchConfig): HeadlessArtifactContract[] {
  return config.artifactContracts?.length
    ? config.artifactContracts
    : config.requiredArtifacts.map((path) => createArtifactContract(path, "option"));
}

function detectServiceContracts(prompt: string): HeadlessServiceContract[] {
  const contracts: HeadlessServiceContract[] = [];
  const localEndpointPattern =
    /\b(?:https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/giu;
  for (const match of prompt.matchAll(localEndpointPattern)) {
    addServiceContract(contracts, match[1], match[2]);
  }
  const servicePortPattern =
    /\b(?:listen(?:ing)?(?:\s+on)?|serve(?:r)?(?:\s+on)?|run(?:ning)?(?:\s+on)?|bind(?:ing)?(?:\s+to)?|expose|available(?:\s+at)?|endpoint|port)\s+(?:at|on|to)?\s*(?:port\s*)?(\d{2,5})\b/giu;
  for (const match of prompt.matchAll(servicePortPattern)) {
    if (hasServiceRuntimeContext(promptContext(prompt, match.index ?? 0, 180))) {
      addServiceContract(contracts, "127.0.0.1", match[1]);
    }
  }
  return mergeServiceContracts(contracts);
}

function addServiceContract(
  contracts: HeadlessServiceContract[],
  hostValue: string | undefined,
  portValue: string | undefined,
): void {
  const port = Number.parseInt(portValue ?? "", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return;
  const host = hostValue === "localhost" || hostValue === "0.0.0.0" || !hostValue
    ? "127.0.0.1"
    : hostValue;
  contracts.push({ host, port, source: "prompt" });
}

function hasServiceRuntimeContext(context: string): boolean {
  return /\b(?:server|service|daemon|endpoint|localhost|127\.0\.0\.1|0\.0\.0\.0|http|web|api|curl|listen|serve|bind|uvicorn|fastapi|flask|express)\b/iu.test(
    context,
  );
}

function mergeServiceContracts(contracts: HeadlessServiceContract[]): HeadlessServiceContract[] {
  const byTarget = new Map<string, HeadlessServiceContract>();
  for (const contract of contracts) {
    if (!Number.isInteger(contract.port) || contract.port <= 0 || contract.port > 65_535) {
      continue;
    }
    const host = contract.host || "127.0.0.1";
    byTarget.set(`${host}:${contract.port}`, { ...contract, host });
  }
  return [...byTarget.values()];
}

function getServiceContracts(config: HeadlessBenchConfig): HeadlessServiceContract[] {
  return config.serviceContracts ?? [];
}

function resolveArtifactPath(projectPath: string, artifact: string): string {
  return artifact.startsWith("/") ? artifact : resolve(projectPath, artifact);
}

async function validateArtifactContract(
  projectPath: string,
  target: string,
  contract: HeadlessArtifactContract,
): Promise<HeadlessArtifactValidationIssue[]> {
  const issues: HeadlessArtifactValidationIssue[] = [];
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    await access(target, constants.R_OK);
    fileStat = await stat(target);
  } catch {
    return [artifactIssue(contract, "exists", "artifact is missing or unreadable")];
  }
  if (!fileStat.isFile()) {
    return [artifactIssue(contract, "exists", "artifact path is not a regular file")];
  }
  if (fileStat.size === 0) {
    return [artifactIssue(contract, "non_empty", "artifact is empty")];
  }

  if (contract.kind === "json") {
    const text = await readFile(target, "utf8").catch(() => "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      issues.push(
        artifactIssue(
          contract,
          "valid_json",
          `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    if (parsed !== undefined) {
      issues.push(...validateJsonArtifactShape(contract, parsed));
    }
  }

  const syntaxIssue = await validateArtifactSyntax(projectPath, target, contract);
  if (syntaxIssue) issues.push(syntaxIssue);
  return issues;
}

async function validateArtifactSyntax(
  projectPath: string,
  target: string,
  contract: HeadlessArtifactContract,
): Promise<HeadlessArtifactValidationIssue | undefined> {
  const command = await syntaxCheckCommand(projectPath, target, contract);
  if (!command) return undefined;
  const result = await runShellCommand(command, projectPath, ARTIFACT_SANITY_TIMEOUT_MS);
  if (result.exitCode === 0 && result.outcome === "completed") return undefined;
  return artifactIssue(
    contract,
    contract.checks.find((check) => check.endsWith("_syntax_if_available")) ?? "syntax",
    summarizeFailureOutput(result.output, "model_patch_failed").replace(/\s+/gu, " ").slice(0, 500),
  );
}

async function syntaxCheckCommand(
  projectPath: string,
  target: string,
  contract: HeadlessArtifactContract,
): Promise<string | undefined> {
  switch (contract.kind) {
    case "python": {
      const python = await firstAvailableTool(projectPath, ["python3", "python"]);
      return python ? `${python} -m py_compile ${shellQuote(target)}` : undefined;
    }
    case "shell":
      return (await isToolAvailable("bash", projectPath)) ? `bash -n ${shellQuote(target)}` : undefined;
    case "c_source": {
      const compiler = await firstAvailableTool(projectPath, ["cc", "gcc", "clang"]);
      return compiler ? `${compiler} -fsyntax-only ${shellQuote(target)}` : undefined;
    }
    case "cpp_source": {
      const compiler = await firstAvailableTool(projectPath, ["c++", "g++", "clang++"]);
      return compiler ? `${compiler} -fsyntax-only ${shellQuote(target)}` : undefined;
    }
    case "json":
    case "text":
    case "binary":
    case "unknown":
      return undefined;
  }
}

function validateJsonArtifactShape(
  contract: HeadlessArtifactContract,
  actual: unknown,
): HeadlessArtifactValidationIssue[] {
  if (!contract.formatHint) return [];
  let expected: unknown;
  try {
    expected = JSON.parse(contract.formatHint);
  } catch {
    return [];
  }
  const expectedObject = readObject(expected);
  if (!expectedObject) return [];
  const actualObject = readObject(actual);
  if (!actualObject) {
    return [artifactIssue(contract, "json_shape_if_format_hint", "expected a JSON object")];
  }
  const issues: HeadlessArtifactValidationIssue[] = [];
  for (const [key, expectedValue] of Object.entries(expectedObject)) {
    if (!(key in actualObject)) {
      issues.push(
        artifactIssue(contract, "json_shape_if_format_hint", `missing top-level key "${key}"`),
      );
      continue;
    }
    const expectedKind = jsonShapeKind(expectedValue);
    const actualKind = jsonShapeKind(actualObject[key]);
    if (expectedKind !== "null" && expectedKind !== actualKind) {
      issues.push(
        artifactIssue(
          contract,
          "json_shape_if_format_hint",
          `top-level key "${key}" expected ${expectedKind}, got ${actualKind}`,
        ),
      );
    }
  }
  return issues.slice(0, 8);
}

function jsonShapeKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

async function firstAvailableTool(projectPath: string, tools: string[]): Promise<string | undefined> {
  for (const tool of tools) {
    if (await isToolAvailable(tool, projectPath)) return tool;
  }
  return undefined;
}

function artifactIssue(
  contract: HeadlessArtifactContract,
  check: string,
  message: string,
): HeadlessArtifactValidationIssue {
  return {
    path: contract.path,
    kind: contract.kind,
    check,
    message,
  };
}

async function validateRequiredArtifacts(
  projectPath: string,
  config: HeadlessBenchConfig,
): Promise<{ ok: true } | { ok: false; missing: string[]; issues: HeadlessArtifactValidationIssue[] }> {
  const issues: HeadlessArtifactValidationIssue[] = [];
  for (const contract of getArtifactContracts(config)) {
    const target = resolveArtifactPath(projectPath, contract.path);
    issues.push(...(await validateArtifactContract(projectPath, target, contract)));
  }
  if (issues.length === 0) return { ok: true };
  return {
    ok: false,
    missing: uniqueStrings(issues.map((issue) => issue.path)),
    issues,
  };
}

async function validateExternalVerifierSanity(
  projectPath: string,
  config: HeadlessBenchConfig,
): Promise<{ ok: true } | { ok: false; category: HeadlessBenchFailureCategory; summary: string }> {
  const serviceContracts = getServiceContracts(config);
  const failures: string[] = [];
  for (const contract of serviceContracts) {
    const ready = await probeTcpPort(contract.host, contract.port, SERVICE_SANITY_TIMEOUT_MS);
    if (!ready) failures.push(`service ${contract.host}:${contract.port} is not reachable`);
  }
  if (failures.length === 0) return { ok: true };
  return {
    ok: false,
    category: "model_patch_failed",
    summary: `External verifier sanity failed: ${failures.join("; ")}`,
  };
}

function probeTcpPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(ready);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function runOfficialTestCommand(input: {
  projectPath: string;
  command: string;
  timeoutMs: number;
}): Promise<{
  exitCode: number;
  output: string;
  outcome: "completed" | "timeout" | "cancelled";
  logPath: string;
  durationMs: number;
  facts?: HeadlessOfficialValidationFacts;
}> {
  const startedAt = Date.now();
  const result = await runShellCommand(input.command, input.projectPath, input.timeoutMs);
  const postTestLog = result.exitCode === 0 ? "" : await readPostTestFailureLog(input.projectPath);
  const output = postTestLog ? `${result.output}\n\n[post-test/tests.log]\n${postTestLog}` : result.output;
  const logPath = await writeHeadlessLog(input.projectPath, "official-test.log", output);
  const facts = await readHeadlessOfficialValidationFacts(input.projectPath);
  return {
    ...result,
    output,
    logPath,
    durationMs: Date.now() - startedAt,
    ...(facts ? { facts } : {}),
  };
}

async function readHeadlessOfficialValidationFacts(
  projectPath: string,
): Promise<HeadlessOfficialValidationFacts | undefined> {
  const facts: Partial<Omit<HeadlessOfficialValidationFacts, "source">> = {};
  const rewardPath = join(projectPath, "verifier", "reward.txt");
  const rewardText = await readOptionalText(rewardPath);
  const reward = parseFiniteNumber(rewardText?.trim());
  if (reward !== undefined) {
    facts.reward = reward;
    facts.rewardPath = rewardPath;
  }

  const ctrfPath = join(projectPath, "verifier", "ctrf.json");
  const ctrf = await readJsonObject(ctrfPath);
  const ctrfResults = readObject(ctrf?.results);
  const ctrfSummary = readObject(ctrfResults?.summary);
  if (ctrfSummary) {
    facts.ctrfPath = ctrfPath;
    facts.ctrfSummary = {
      ...readOptionalNumberProperty(ctrfSummary, "tests"),
      ...readOptionalNumberProperty(ctrfSummary, "passed"),
      ...readOptionalNumberProperty(ctrfSummary, "failed"),
      ...readOptionalNumberProperty(ctrfSummary, "skipped"),
    };
  }
  const ctrfTests = Array.isArray(ctrfResults?.tests) ? ctrfResults.tests : [];
  const failedTests = ctrfTests
    .filter((item): item is Record<string, unknown> => readObject(item) !== undefined)
    .filter((item) => item.status !== "passed")
    .map((item) => (typeof item.name === "string" ? item.name : undefined))
    .filter((item): item is string => Boolean(item));
  if (failedTests.length > 0) {
    facts.failedTests = failedTests.slice(0, 20);
  }
  const failureDetails = summarizeCtrfFailureDetails(ctrfTests);
  if (failureDetails.length > 0) {
    facts.failureDetails = failureDetails;
  }

  const testStdoutPath = join(projectPath, "verifier", "test-stdout.txt");
  const testStdout = await readOptionalText(testStdoutPath);
  const testStdoutSummary = summarizeVerifierTextTail(testStdout);
  if (testStdoutSummary) {
    facts.testStdoutPath = testStdoutPath;
    facts.testStdoutSummary = testStdoutSummary;
  }

  const resultPath = join(projectPath, "result.json");
  const result = await readJsonObject(resultPath);
  const verifierResult = readObject(result?.verifier_result);
  const rewards = readObject(verifierResult?.rewards);
  const resultReward = parseFiniteNumber(rewards?.reward);
  if (resultReward !== undefined) {
    facts.resultPath = resultPath;
    facts.resultReward = resultReward;
  }
  const agentResult = readObject(result?.agent_result);
  const resultMetadata = readObject(agentResult?.metadata);
  copyAgentMetadataFacts(facts, resultMetadata, resultPath);

  const metadataPath = join(projectPath, "agent", "linghun-metadata.json");
  const metadata = await readJsonObject(metadataPath);
  copyAgentMetadataFacts(facts, metadata, metadataPath);

  const verifierTimeout = await readVerifierTimeoutFact(projectPath, result, resultPath);
  if (verifierTimeout) {
    facts.verifierTimeout = true;
    facts.verifierTimeoutPath = verifierTimeout.path;
    facts.verifierTimeoutSummary = verifierTimeout.summary;
  }

  if (Object.keys(facts).length === 0) return undefined;
  return { ...facts, source: "project_local" };
}

async function readExternalHeadlessOfficialValidationFacts(
  factsPath: string | undefined,
  taskName?: string,
): Promise<HeadlessOfficialValidationFacts | undefined> {
  if (!factsPath) return undefined;
  const payload = await readJsonObject(factsPath);
  if (!payload) return undefined;
  if (payload.facts_status === "unavailable") return undefined;

  const selectedPayload = selectExternalFactsPayload(payload, taskName);
  if (!selectedPayload) return undefined;
  const rawFacts = readObject(selectedPayload.facts) ?? selectedPayload;
  const facts: Partial<Omit<HeadlessOfficialValidationFacts, "source">> = {};
  copyStringFact(rawFacts, facts, "taskName", "task_name", "taskName");
  copyStringFact(rawFacts, facts, "sourceTrial", "source_trial", "sourceTrial");
  copyStringFact(rawFacts, facts, "recoveredTrial", "recovered_trial", "recoveredTrial");
  copyStringFact(rawFacts, facts, "previousOutcome", "previous_outcome", "previousOutcome");
  copyNumberFact(rawFacts, facts, "reward", "reward");
  copyNumberFact(rawFacts, facts, "resultReward", "result_reward", "resultReward");
  copyNumberFact(rawFacts, facts, "cliExitCode", "cli_exit_code", "cliExitCode");
  copyBooleanFact(
    rawFacts,
    facts,
    "controlledDeadlineReached",
    "controlled_deadline_reached",
    "controlledDeadlineReached",
  );
  copyBooleanFact(rawFacts, facts, "verifierTimeout", "verifier_timeout", "verifierTimeout");

  const ctrfSummary = readObject(rawFacts.ctrf_summary) ?? readObject(rawFacts.ctrfSummary);
  if (ctrfSummary) {
    facts.ctrfSummary = {
      ...readOptionalNumberProperty(ctrfSummary, "tests"),
      ...readOptionalNumberProperty(ctrfSummary, "passed"),
      ...readOptionalNumberProperty(ctrfSummary, "failed"),
      ...readOptionalNumberProperty(ctrfSummary, "skipped"),
    };
  }
  const failedTests = readStringArrayFact(rawFacts, "failed_tests", "failedTests");
  if (failedTests.length > 0) facts.failedTests = failedTests.slice(0, 20);
  const failureDetails = readStringArrayFact(rawFacts, "failure_details", "failureDetails");
  if (failureDetails.length > 0) facts.failureDetails = failureDetails.slice(0, 12);

  const testStdoutSummary = readStringFact(rawFacts, "test_stdout_summary", "testStdoutSummary");
  if (testStdoutSummary) facts.testStdoutSummary = normalizeVerifierFactText(testStdoutSummary).slice(0, 1800);
  const verifierTimeoutSummary = readStringFact(
    rawFacts,
    "verifier_timeout_summary",
    "verifierTimeoutSummary",
  );
  if (verifierTimeoutSummary) facts.verifierTimeoutSummary = verifierTimeoutSummary.slice(0, 300);

  copyExternalPathFacts(selectedPayload, rawFacts, facts);
  if (Object.keys(facts).length === 0) return undefined;
  return { ...facts, source: "external_file" };
}

function selectExternalFactsPayload(
  payload: Record<string, unknown>,
  taskName?: string,
): Record<string, unknown> | undefined {
  const tasks = readObject(payload.tasks);
  if (!tasks) return payload;

  const entries = Object.entries(tasks)
    .map(([key, value]) => ({ key, value: readObject(value) }))
    .filter((entry): entry is { key: string; value: Record<string, unknown> } => entry.value !== undefined);
  if (entries.length === 0) return undefined;
  if (!taskName) return entries.length === 1 ? entries[0]?.value : undefined;

  const normalizedTaskName = normalizeTaskNameKey(taskName);
  return entries.find((entry) => normalizeTaskNameKey(entry.key) === normalizedTaskName)?.value;
}

function normalizeTaskNameKey(value: string): string {
  const trimmed = value.trim();
  const parts = trimmed.split("/").filter(Boolean);
  const leaf = parts.length > 0 ? parts[parts.length - 1] : trimmed;
  return leaf.toLowerCase();
}

function copyStringFact(
  rawFacts: Record<string, unknown>,
  facts: Partial<Omit<HeadlessOfficialValidationFacts, "source">>,
  target: keyof Omit<HeadlessOfficialValidationFacts, "source">,
  ...keys: string[]
): void {
  for (const key of keys) {
    const value = readStringFact(rawFacts, key);
    if (!value) continue;
    (facts as Record<string, unknown>)[target] = value;
    return;
  }
}

function copyNumberFact(
  rawFacts: Record<string, unknown>,
  facts: Partial<Omit<HeadlessOfficialValidationFacts, "source">>,
  target: keyof Omit<HeadlessOfficialValidationFacts, "source">,
  ...keys: string[]
): void {
  for (const key of keys) {
    const value = parseFiniteNumber(rawFacts[key]);
    if (value === undefined) continue;
    (facts as Record<string, unknown>)[target] = value;
    return;
  }
}

function copyBooleanFact(
  rawFacts: Record<string, unknown>,
  facts: Partial<Omit<HeadlessOfficialValidationFacts, "source">>,
  target: keyof Omit<HeadlessOfficialValidationFacts, "source">,
  ...keys: string[]
): void {
  for (const key of keys) {
    const value = rawFacts[key];
    if (typeof value !== "boolean") continue;
    (facts as Record<string, unknown>)[target] = value;
    return;
  }
}

function readStringArrayFact(rawFacts: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = rawFacts[key];
    if (!Array.isArray(value)) continue;
    return value
      .map((item) => (typeof item === "string" ? normalizeVerifierFactText(item) : ""))
      .filter(Boolean);
  }
  return [];
}

function readStringFact(rawFacts: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = rawFacts[key];
    if (typeof value !== "string") continue;
    const normalized = normalizeVerifierFactText(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function copyExternalPathFacts(
  payload: Record<string, unknown>,
  rawFacts: Record<string, unknown>,
  facts: Partial<Omit<HeadlessOfficialValidationFacts, "source">>,
): void {
  const paths = readObject(payload.paths);
  const readPath = (name: string, ...keys: string[]): string | undefined => {
    for (const key of keys) {
      const direct = readStringFact(rawFacts, key);
      if (direct) return direct;
    }
    const entry = readObject(paths?.[name]);
    const value = typeof entry?.path === "string" ? normalizeVerifierFactText(entry.path) : "";
    return value || undefined;
  };
  facts.resultPath = readPath("result", "result_path", "resultPath") ?? facts.resultPath;
  facts.rewardPath = readPath("reward", "reward_path", "rewardPath") ?? facts.rewardPath;
  facts.ctrfPath = readPath("ctrf", "ctrf_path", "ctrfPath") ?? facts.ctrfPath;
  facts.metadataPath = readPath("metadata", "metadata_path", "metadataPath") ?? facts.metadataPath;
  facts.testStdoutPath =
    readPath("test_stdout", "test_stdout_path", "testStdoutPath") ?? facts.testStdoutPath;
}

async function readVerifierTimeoutFact(
  projectPath: string,
  result: Record<string, unknown> | undefined,
  resultPath: string,
): Promise<{ path: string; summary: string } | undefined> {
  const resultSummary = summarizeVerifierTimeoutFromResult(result);
  if (resultSummary) return { path: resultPath, summary: resultSummary };
  const candidates = [
    join(projectPath, "verifier", "exception.txt"),
    join(projectPath, "verifier", "stderr.txt"),
    join(projectPath, "verifier", "output.txt"),
    join(projectPath, "exception.txt"),
  ];
  for (const path of candidates) {
    const text = await readOptionalText(path);
    if (!text || !hasVerifierTimeoutSignal(text)) continue;
    return { path, summary: firstVerifierTimeoutLine(text) };
  }
  return undefined;
}

function summarizeVerifierTimeoutFromResult(
  result: Record<string, unknown> | undefined,
): string | undefined {
  if (!result) return undefined;
  const verifierResult = readObject(result.verifier_result);
  const candidates = [
    verifierResult?.error_type,
    verifierResult?.error,
    verifierResult?.exception,
    verifierResult?.message,
    verifierResult?.stderr,
    verifierResult?.stdout,
    verifierResult?.traceback,
    result.error_type,
    result.error,
    result.exception,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  if (hasVerifierTimeoutSignal(candidates)) return firstVerifierTimeoutLine(candidates);
  const verifierText = verifierResult ? JSON.stringify(verifierResult).slice(0, 12_000) : "";
  return hasVerifierTimeoutSignal(verifierText) ? firstVerifierTimeoutLine(verifierText) : undefined;
}

function hasVerifierTimeoutSignal(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("verifiertimeouterror") ||
    (normalized.includes("verifier") && /timed?\s*out|timeout/u.test(normalized));
}

function firstVerifierTimeoutLine(text: string): string {
  return (
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => hasVerifierTimeoutSignal(line)) ?? "verifier timeout"
  ).slice(0, 300);
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | undefined> {
  const text = await readOptionalText(path);
  if (!text) return undefined;
  try {
    return readObject(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function summarizeCtrfFailureDetails(tests: unknown[]): string[] {
  return tests
    .map((item) => readObject(item))
    .filter(
      (item): item is Record<string, unknown> => item !== undefined && item.status !== "passed",
    )
    .map((item) => {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const detail = ["message", "trace", "stdout", "stderr", "output"]
        .map((key) => readBoundedStringProperty(item, key, key === "trace" ? 700 : 360))
        .filter(Boolean)
        .join(" | ");
      return normalizeVerifierFactText([name, detail].filter(Boolean).join(": "));
    })
    .filter(Boolean)
    .slice(0, 12);
}

function readBoundedStringProperty(
  object: Record<string, unknown>,
  key: string,
  limit: number,
): string | undefined {
  const value = object[key];
  if (typeof value !== "string") return undefined;
  const normalized = normalizeVerifierFactText(value);
  return normalized ? `${key}=${normalized.slice(0, limit)}` : undefined;
}

function summarizeVerifierTextTail(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const selected = lines.slice(-18);
  const summary = normalizeVerifierFactText(selected.join(" | "));
  return summary ? summary.slice(0, 1800) : undefined;
}

function normalizeVerifierFactText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function parseFiniteNumber(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function readOptionalNumberProperty(
  object: Record<string, unknown>,
  key: string,
): Record<string, number> {
  const value = parseFiniteNumber(object[key]);
  return value === undefined ? {} : { [key]: value };
}

function copyAgentMetadataFacts(
  facts: Partial<Omit<HeadlessOfficialValidationFacts, "source">>,
  metadata: Record<string, unknown> | undefined,
  metadataPath: string,
): void {
  if (!metadata) return;
  const cliExitCode = parseFiniteNumber(metadata.cli_exit_code);
  if (cliExitCode !== undefined) {
    facts.cliExitCode = cliExitCode;
    facts.metadataPath = metadataPath;
  }
  if (typeof metadata.controlled_deadline_reached === "boolean") {
    facts.controlledDeadlineReached = metadata.controlled_deadline_reached;
    facts.metadataPath = metadataPath;
  }
}

function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; output: string; outcome: "completed" | "timeout" | "cancelled" }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const detached = process.platform !== "win32";
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      detached,
      env: createSanitizedChildEnv(process.env),
    });
    const processGuard = createProcessGuard();
    processGuard.track(child, { detached, cwd, label: "headless-official-test" });
    let output = "";
    let settled = false;
    let terminating = false;
    const append = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > OUTPUT_LIMIT) {
        output = output.slice(output.length - OUTPUT_LIMIT);
      }
    };
    const finish = (
      exitCode: number,
      outcome: "completed" | "timeout" | "cancelled" = "completed",
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ exitCode, output, outcome });
    };
    const timer = setTimeout(() => {
      if (settled || terminating) return;
      terminating = true;
      append(`\nCommand timed out after ${timeoutMs}ms.`);
      void processGuard.requestStopAndConfirm(true, OFFICIAL_PROCESS_STOP_TIMEOUT_MS).then(
        (cleanup) => {
          if (!cleanup.ok) {
            settled = true;
            clearTimeout(timer);
            rejectPromise(
              new Error(`official validation process cleanup unconfirmed: ${cleanup.reason}`),
            );
            return;
          }
          finish(1, "timeout");
        },
        (error: unknown) => {
          settled = true;
          clearTimeout(timer);
          rejectPromise(error);
        },
      );
    }, timeoutMs);
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      append(`\nCommand failed to start: ${error.message}`);
      if (terminating) return;
      finish(1);
    });
    child.on("close", (code) => {
      if (terminating) return;
      finish(code ?? 1);
    });
  });
}

function createSanitizedChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (isSecretEnvKey(key)) continue;
    next[key] = value;
  }
  next.DEBIAN_FRONTEND = "noninteractive";
  next.PIP_NO_INPUT = "1";
  next.PIP_DISABLE_PIP_VERSION_CHECK = "1";
  return next;
}

function isSecretEnvKey(key: string): boolean {
  return /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|BEARER|CREDENTIAL)/iu.test(key);
}

async function isToolAvailable(tool: string, cwd: string): Promise<boolean> {
  const command =
    process.platform === "win32"
      ? `where ${cmdQuote(tool)} >nul 2>nul`
      : `command -v ${shellQuote(tool)} >/dev/null 2>&1`;
  const result = await runShellCommand(command, cwd, 5_000);
  return result.exitCode === 0;
}

async function writeHeadlessLog(projectPath: string, name: string, content: string): Promise<string> {
  const dir = join(projectPath, ".linghun", "headless");
  await mkdir(dir, { recursive: true });
  const target = join(dir, name);
  await writeFile(target, content, "utf8");
  return target;
}

async function readPostTestFailureLog(projectPath: string): Promise<string> {
  const candidates = [
    join(projectPath, "post-test", "tests.log"),
    join(projectPath, "post_test", "tests.log"),
    join(projectPath, "tests.log"),
    "/post-test/tests.log",
  ];
  for (const candidate of candidates) {
    try {
      const content = await readFile(candidate, "utf8");
      return content.length > OUTPUT_LIMIT ? content.slice(content.length - OUTPUT_LIMIT) : content;
    } catch {
      // Try the next common harness log location.
    }
  }
  return "";
}

function summarizeFailureOutput(output: string, category: HeadlessBenchFailureCategory): string {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const interesting = lines.filter((line) =>
    /error|failed|failure|assert|expected|actual|traceback|exception|undefined reference|no such file|not found|timeout|cmake|g\+\+|make|pytest|test/u.test(
      line.toLowerCase(),
    ),
  );
  const selected = (interesting.length ? interesting : lines).slice(-60).join("\n");
  const summary = selected.length > SUMMARY_LIMIT ? selected.slice(selected.length - SUMMARY_LIMIT) : selected;
  return `[${category}]\n${summary || "No failure output captured."}`;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (/^(1|true|yes|on)$/iu.test(value)) return true;
  if (/^(0|false|no|off)$/iu.test(value)) return false;
  return undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampPositiveInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const next = value ?? fallback;
  return Math.max(min, Math.min(max, next));
}

function splitList(value: string | undefined): string[] {
  return value
    ? value
        .split(/[;,]/u)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function computeWorkspaceChangeHash(projectPath: string, changedFiles: string[]): Promise<string> {
  if (changedFiles.length === 0) return "empty";
  const sorted = [...changedFiles].sort();
  const workspaceHash = createHash("sha256");
  for (const file of sorted) {
    const fullPath = resolve(projectPath, file);
    workspaceHash.update(file, "utf8");
    workspaceHash.update("\0", "utf8");
    try {
      for await (const chunk of createReadStream(fullPath)) {
        workspaceHash.update(chunk);
      }
    } catch {
      workspaceHash.update("missing", "utf8");
    }
    workspaceHash.update("\0", "utf8");
  }
  return workspaceHash.digest("hex").slice(0, 16);
}

async function canRead(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/u.test(value)) return value;
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function cmdQuote(value: string): string {
  return /^[A-Za-z0-9_.+-]+$/u.test(value) ? value : `"${value.replace(/"/gu, '\\"')}"`;
}

export const __testHeadlessRuntime = {
  createSanitizedChildEnv,
  readExternalHeadlessOfficialValidationFacts,
  readHeadlessOfficialValidationFacts,
};
