import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const DEFAULT_TEST_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;
const MAX_REPAIR_ATTEMPTS = 2;
const OUTPUT_LIMIT = 24_000;
const SUMMARY_LIMIT = 4_000;

export type HeadlessBenchFailureCategory =
  | "model_patch_failed"
  | "agent_timeout"
  | "test_timeout"
  | "provider_error"
  | "unknown_agent_error"
  | "parse_or_harness_error"
  | "missing_artifact"
  | "environment_missing_tool"
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

export type HeadlessBenchFailure = {
  category: HeadlessBenchFailureCategory;
  summary: string;
  command?: string;
  exitCode?: number;
  logPath?: string;
  missingArtifacts?: string[];
};

export type HeadlessBenchConfig = {
  enabled: boolean;
  profile: HeadlessBenchTaskProfile;
  testCommand?: string;
  testTimeoutMs: number;
  maxRepairAttempts: number;
  requiredArtifacts: string[];
  preflight: boolean;
};

export type HeadlessBenchValidationResult =
  | { ok: true; testRan: boolean; summary: string; logPath?: string }
  | { ok: false; failure: HeadlessBenchFailure };

export type HeadlessEnvironmentPreflight = {
  checkedTools: string[];
  missingTools: string[];
  summary: string;
};

export type HeadlessBenchOptions = Partial<
  Pick<HeadlessBenchConfig, "enabled" | "testCommand" | "testTimeoutMs" | "maxRepairAttempts" | "requiredArtifacts" | "preflight">
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
  const maxRepairAttempts = clampPositiveInteger(
    input.options?.maxRepairAttempts ?? parsePositiveInteger(env.LINGHUN_HEADLESS_MAX_REPAIRS),
    DEFAULT_MAX_REPAIR_ATTEMPTS,
    0,
    MAX_REPAIR_ATTEMPTS,
  );
  const configuredArtifacts = splitList(env.LINGHUN_HEADLESS_REQUIRED_ARTIFACTS);
  const requiredArtifacts = uniqueStrings([
    ...(input.options?.requiredArtifacts ?? []),
    ...configuredArtifacts,
    ...detectRequiredArtifacts(input.prompt),
  ]);
  const testCommand = input.options?.testCommand ?? env.LINGHUN_HEADLESS_TEST_COMMAND ?? defaultTestCommand;
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
    preflight: input.options?.preflight ?? parseBoolean(env.LINGHUN_HEADLESS_PREFLIGHT) ?? true,
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
  const required = input.config.requiredArtifacts.length
    ? `Required artifacts detected: ${input.config.requiredArtifacts.join(", ")}. Verify they exist and are readable before final.`
    : "No explicit output artifact path was detected; still verify observable task completion.";
  const test = input.config.testCommand
    ? `Official test command available: ${input.config.testCommand}. Prefer it over ad-hoc smoke tests before final.`
    : "No official test command was detected; use the strongest task-local verification available.";
  const preflight = input.preflight ? `Environment preflight: ${input.preflight.summary}` : "";
  return [
    input.originalPrompt,
    "",
    "[Linghun headless bench guard]",
    test,
    required,
    preflight,
    formatInitialProfileStrategy(input.config.profile),
    "If rg is unavailable, use grep/find/sed/awk fallbacks instead of failing the task.",
    "Do not claim completion from a self-written smoke test when an official test entrypoint is available.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function validateHeadlessBenchCompletion(input: {
  projectPath: string;
  config: HeadlessBenchConfig;
}): Promise<HeadlessBenchValidationResult> {
  const artifactResult = await validateRequiredArtifacts(input.projectPath, input.config.requiredArtifacts);
  if (!artifactResult.ok) {
    return {
      ok: false,
      failure: {
        category: "missing_artifact",
        summary: `Missing required artifact(s): ${artifactResult.missing.join(", ")}`,
        missingArtifacts: artifactResult.missing,
      },
    };
  }
  if (!input.config.testCommand) {
    return {
      ok: true,
      testRan: false,
      summary: input.config.requiredArtifacts.length
        ? "required artifacts exist; no official test command detected"
        : "no official test command or explicit artifact requirement detected",
    };
  }
  const result = await runOfficialTestCommand({
    projectPath: input.projectPath,
    command: input.config.testCommand,
    timeoutMs: input.config.testTimeoutMs,
  });
  if (result.exitCode === 0 && result.outcome === "completed") {
    return {
      ok: true,
      testRan: true,
      summary: `official test passed: ${input.config.testCommand}`,
      logPath: result.logPath,
    };
  }
  const category = classifyHeadlessFailure({
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
      summary: summarizeFailureOutput(result.output, category),
    },
  };
}

export function createHeadlessBenchRepairPrompt(input: {
  originalPrompt: string;
  failure: HeadlessBenchFailure;
  attempt: number;
  maxAttempts: number;
  profile?: HeadlessBenchTaskProfile;
  preflight?: HeadlessEnvironmentPreflight;
}): string {
  const artifactLine = input.failure.missingArtifacts?.length
    ? `Missing artifacts: ${input.failure.missingArtifacts.join(", ")}`
    : "";
  const logLine = input.failure.logPath ? `Full failure log: ${input.failure.logPath}` : "";
  return [
    `Headless verification failed (${input.failure.category}) on repair attempt ${input.attempt}/${input.maxAttempts}.`,
    "Continue from the current workspace. Do not restart from scratch unless necessary.",
    "Use the official test failure and current files to make the smallest fix, then rerun the official test or artifact check.",
    formatRepairProfileStrategy(input.failure.category, input.profile ?? "generic"),
    input.preflight?.missingTools.includes("rg")
      ? "rg is missing in this environment; use grep/find/sed/awk fallbacks."
      : "",
    artifactLine,
    logLine,
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
  if (input.outcome === "timeout" || /timed out|timeout after|test command timed out/u.test(text)) {
    return "test_timeout";
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
    return "Repair route: narrow validation to focused tests or logs first; avoid repeatedly launching full expensive runs.";
  }
  if (category === "provider_error") {
    return "Repair route: continue from existing files and evidence; do not redo unrelated exploration.";
  }
  if (category === "model_patch_failed" && profile === "polyglot_cpp") {
    return "Repair route: align header/test signatures, types, missing symbols, and CMake linkage before changing broader logic.";
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
  const artifacts: string[] = [];
  const absolutePathPattern =
    /(?:\b(?:write|save|print|output|store|create|generate|return|place|put)\b|写入|保存|输出|生成|创建|放到|放入|返回)[\s\S]{0,120}?[`"']?(\/[A-Za-z0-9._/-]+\.[A-Za-z0-9._-]+)[`"']?/giu;
  for (const match of prompt.matchAll(absolutePathPattern)) {
    artifacts.push(match[1]);
  }
  const namedFilePattern =
    /(?:\b(?:file called|file named|called|named|to a file|write .*? to)\b|文件名为|文件叫|写到文件|输出到文件)\s+[`"']?([A-Za-z0-9._/-]+\.[A-Za-z0-9._-]+)[`"']?/giu;
  for (const match of prompt.matchAll(namedFilePattern)) {
    artifacts.push(match[1]);
  }
  return uniqueStrings(
    artifacts
      .map(normalizeArtifactPath)
      .filter((artifact) => !artifact.includes("*") && !artifact.endsWith(".sh")),
  );
}

function detectRequiredArtifacts(prompt: string): string[] {
  return detectEngineeringArtifactTargets(prompt);
}

function normalizeArtifactPath(value: string): string {
  return value.replace(/[),.;:!?]+$/u, "");
}

async function validateRequiredArtifacts(
  projectPath: string,
  artifacts: string[],
): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  const missing: string[] = [];
  for (const artifact of artifacts) {
    const target = artifact.startsWith("/") ? artifact : resolve(projectPath, artifact);
    try {
      await access(target, constants.R_OK);
      const content = await readFile(target, "utf8").catch(() => "");
      if (content.length === 0) {
        missing.push(`${artifact} (empty or unreadable text)`);
      }
    } catch {
      missing.push(artifact);
    }
  }
  return missing.length ? { ok: false, missing } : { ok: true };
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
}> {
  const result = await runShellCommand(input.command, input.projectPath, input.timeoutMs);
  const postTestLog = result.exitCode === 0 ? "" : await readPostTestFailureLog(input.projectPath);
  const output = postTestLog ? `${result.output}\n\n[post-test/tests.log]\n${postTestLog}` : result.output;
  const logPath = await writeHeadlessLog(input.projectPath, "official-test.log", output);
  return { ...result, output, logPath };
}

function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; output: string; outcome: "completed" | "timeout" | "cancelled" }> {
  return new Promise((resolvePromise) => {
    const detached = process.platform !== "win32";
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      detached,
      env: createSanitizedChildEnv(process.env),
    });
    let output = "";
    let settled = false;
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
      append(`\nCommand timed out after ${timeoutMs}ms.`);
      killShellProcess(child.pid);
      finish(1, "timeout");
    }, timeoutMs);
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      append(`\nCommand failed to start: ${error.message}`);
      finish(1);
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

function createSanitizedChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (isSecretEnvKey(key)) continue;
    next[key] = value;
  }
  return next;
}

function isSecretEnvKey(key: string): boolean {
  return /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|BEARER|CREDENTIAL)/iu.test(key);
}

function killShellProcess(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      process.kill(pid);
    } else {
      process.kill(-pid, "SIGTERM");
      setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // The process group has already exited.
        }
      }, 1_000).unref();
    }
  } catch {
    try {
      process.kill(pid);
    } catch {
      // The process already exited.
    }
  }
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
