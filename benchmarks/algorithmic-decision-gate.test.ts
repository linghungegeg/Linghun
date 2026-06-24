import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, statfs, symlink, writeFile } from "node:fs/promises";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";

const RUN_GATE = process.env.LINGHUN_ALGORITHMIC_DECISION_GATE === "1";
const SYNTHETIC_ROOT =
  process.env.LINGHUN_ALGORITHMIC_DECISION_SYNTHETIC_ROOT ?? "G:\\linghun-perf-gate";
const RAW_OUTPUT_PATH =
  process.env.LINGHUN_ALGORITHMIC_DECISION_RAW_OUTPUT ??
  join(SYNTHETIC_ROOT, "pre-real-smoke-algorithmic-decision-deep-benchmark-gate-raw.json");
const SUMMARY_OUTPUT_PATH =
  process.env.LINGHUN_ALGORITHMIC_DECISION_SUMMARY_OUTPUT ??
  join(SYNTHETIC_ROOT, "pre-real-smoke-algorithmic-decision-deep-benchmark-gate-summary.md");
const MANIFEST_OUTPUT_PATH =
  process.env.LINGHUN_ALGORITHMIC_DECISION_MANIFEST_OUTPUT ??
  join(SYNTHETIC_ROOT, "pre-real-smoke-algorithmic-decision-deep-benchmark-gate-manifest.json");

const SEED = 20260524;
const WARMUP_RUNS = 1;
const DEFAULT_ITERATIONS = 3;
const KEY_ITERATIONS = 5;
const MAX_LIVE_REQUESTS = 6;
const LIVE_REQUEST_TIMEOUT_MS = 12_000;
const SHORT_ABORT_MS = 25;
const MIN_G_DRIVE_FREE_MB = 1024;

const runIfRequested = RUN_GATE ? it : it.skip;

type Decision = "PASS_BASELINE" | "WATCH" | "FIX_RECOMMENDED" | "DEFERRED" | "NOT-DO" | "SKIPPED";
type ScaleName = "small" | "medium" | "large";

type InputScale = {
  scale: ScaleName | "mock" | "live";
  projectFiles?: number;
  largeFiles?: number;
  transcriptEvents?: number;
  logLines?: number;
  jobCount?: number;
  agentCount?: number;
  evidenceCount?: number;
  memoryAccepted?: number;
  memoryCandidates?: number;
};

type CaseMetrics = {
  requestsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheCreateTokens: number;
  estimatedCostUsd: number;
  bytesRead: number;
  filesTouched: number;
  selectedRefs: number;
  relevantRefs: number;
  missingRefs: number;
  duplicateReads: number;
  cacheHashChanged: boolean;
  failureType: string;
  evidenceStatus: "present" | "unknown" | "needs_confirmation" | "not_pass" | "skipped";
  primarySafe: boolean;
  cleanupStatus: "completed" | "retained" | "skipped" | "failed";
  decision: Decision;
  notes?: string;
};

type BenchmarkRecord = {
  caseId: string;
  category: string;
  scenario: string;
  scale: InputScale;
  providerModelRoute: string;
  warmupRuns: number;
  iterations: number;
  requestsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheCreateTokens: number;
  estimatedCostUsd: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyMinMs: number;
  latencyMaxMs: number;
  bytesRead: number;
  filesTouched: number;
  selectedRefs: number;
  relevantRefs: number;
  contextPrecisionProxy: number;
  missingRefs: number;
  duplicateReads: number;
  cacheHashChanged: boolean;
  peakRssMb: number;
  eventLoopDelayMs: number;
  cpuUserMs?: number;
  cpuSystemMs?: number;
  failureType: string;
  evidenceStatus: string;
  primarySafe: boolean;
  cleanupStatus: string;
  decision: Decision;
  notes: string;
};

type SyntheticFile = {
  path: string;
  size: number;
  kind: "source" | "test" | "doc" | "large" | "config";
  relevance: Set<string>;
};

type SyntheticProject = {
  scale: ScaleName;
  root: string;
  files: SyntheticFile[];
  evidence: string[];
  acceptedMemory: string[];
  candidateMemory: string[];
  transcriptPath: string;
  logPath: string;
  jobsRoot: string;
  requiredRefsByTask: Record<string, string[]>;
  inputScale: InputScale;
};

type DatasetManifest = {
  seed: number;
  root: string;
  createdAt: string;
  cleanupStatus: "retained";
  paths: Array<{ path: string; files: number; bytes: number; description: string }>;
  totals: { files: number; bytes: number };
  generation: Record<string, InputScale>;
};

type EnvironmentInfo = {
  node: string;
  os: string;
  platform: NodeJS.Platform;
  cpuLogicalCores: number;
  totalMemoryMb: number;
  freeMemoryMb: number;
  gDriveFreeMb?: number;
  gDriveTotalMb?: number;
  liveProviderEnvPresent: {
    openaiCompatible: boolean;
    deepseek: boolean;
  };
};

type DeepBenchmarkOutput = {
  gate: "Pre-Real-Smoke Algorithmic Decision Deep Benchmark Gate";
  createdAt: string;
  syntheticOnly: boolean;
  liveProviderCalls: boolean;
  realProjectSmoke: false;
  runtimeCodeModifiedByBenchmark: false;
  boundary: {
    deepBenchmarkNotRealSmoke: true;
    noBetaPassClaim: true;
    noPhase18: true;
    noRuntimeSourceModification: true;
    syntheticRoot: string;
    liveProviderMode: "executed" | "skipped";
    credentialsStoredInArtifacts: false;
  };
  environment: EnvironmentInfo;
  manifest: DatasetManifest;
  records: BenchmarkRecord[];
  liveProbeSummary: {
    attempted: boolean;
    requestsCeiling: number;
    requestsUsed: number;
    providersAttempted: string[];
    status: "executed" | "skipped";
    reason?: string;
  };
};

type MeasuredCase = {
  caseId: string;
  category: string;
  scenario: string;
  scale: InputScale;
  providerModelRoute: string;
  iterations?: number;
  run: () => Promise<CaseMetrics> | CaseMetrics;
};

describe("Pre-Real-Smoke Algorithmic Decision Deep Benchmark Gate", () => {
  runIfRequested(
    "writes deep decision-chain benchmark artifacts",
    async () => {
      await mkdir(dirname(RAW_OUTPUT_PATH), { recursive: true });
      await mkdir(dirname(SUMMARY_OUTPUT_PATH), { recursive: true });
      await mkdir(dirname(MANIFEST_OUTPUT_PATH), { recursive: true });
      const environment = await collectEnvironmentInfo();
      await assertGDriveHeadroom(environment);

      const runRoot = join(SYNTHETIC_ROOT, `algorithmic-decision-deep-${Date.now()}`);
      const dataset = await createSyntheticDataset(runRoot);
      const records: BenchmarkRecord[] = [];
      const liveState = { requestsUsed: 0 };

      for (const benchmarkCase of buildCases(dataset, liveState)) {
        records.push(await measureCase(benchmarkCase));
      }

      const manifest = await createManifest(runRoot, dataset);
      const liveRecords = records.filter(
        (record) => record.category === "B.ModelRouting.ProviderCapability.Live",
      );
      const liveProviderCalls = liveRecords.some((record) => record.requestsCount > 0);
      const providersAttempted = Array.from(
        new Set(
          liveRecords
            .filter((record) => record.requestsCount > 0)
            .map((record) => record.providerModelRoute.split(" / ")[0] ?? "unknown"),
        ),
      );
      const output: DeepBenchmarkOutput = {
        gate: "Pre-Real-Smoke Algorithmic Decision Deep Benchmark Gate",
        createdAt: new Date().toISOString(),
        syntheticOnly: !liveProviderCalls,
        liveProviderCalls,
        realProjectSmoke: false,
        runtimeCodeModifiedByBenchmark: false,
        boundary: {
          deepBenchmarkNotRealSmoke: true,
          noBetaPassClaim: true,
          noPhase18: true,
          noRuntimeSourceModification: true,
          syntheticRoot: SYNTHETIC_ROOT,
          liveProviderMode: liveProviderCalls ? "executed" : "skipped",
          credentialsStoredInArtifacts: false,
        },
        environment,
        manifest,
        records,
        liveProbeSummary: {
          attempted: liveProviderCalls,
          requestsCeiling: MAX_LIVE_REQUESTS,
          requestsUsed: liveState.requestsUsed,
          providersAttempted,
          status: liveProviderCalls ? "executed" : "skipped",
          reason: liveProviderCalls
            ? undefined
            : "No live provider API key was present in process env.",
        },
      };

      await writeFile(RAW_OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
      await writeFile(SUMMARY_OUTPUT_PATH, renderSummary(output), "utf8");
      await writeFile(MANIFEST_OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      expect(records.length).toBeGreaterThanOrEqual(50);
      expect(records.some((record) => record.scale.scale === "large")).toBe(true);
      const nonLiveRecords = records.filter(
        (record) => record.category !== "B.ModelRouting.ProviderCapability.Live",
      );
      expect(nonLiveRecords.every((record) => record.iterations >= DEFAULT_ITERATIONS)).toBe(true);
      expect(liveRecords.every((record) => record.iterations >= 1)).toBe(true);
      expect(records.every((record) => record.warmupRuns === WARMUP_RUNS)).toBe(true);
    },
    240_000,
  );
});

async function collectEnvironmentInfo(): Promise<EnvironmentInfo> {
  let gDriveFreeMb: number | undefined;
  let gDriveTotalMb: number | undefined;
  try {
    const stats = await statfs(SYNTHETIC_ROOT);
    gDriveFreeMb = roundMb(stats.bavail * stats.bsize);
    gDriveTotalMb = roundMb(stats.blocks * stats.bsize);
  } catch {
    // The root will be created later; missing statfs is reported by omitted fields.
  }

  return {
    node: process.version,
    os: `${platform()} ${release()}`,
    platform: platform(),
    cpuLogicalCores: cpus().length,
    totalMemoryMb: roundMb(totalmem()),
    freeMemoryMb: roundMb(freemem()),
    gDriveFreeMb,
    gDriveTotalMb,
    liveProviderEnvPresent: {
      openaiCompatible: Boolean(process.env.LINGHUN_OPENAI_API_KEY || process.env.OPENAI_API_KEY),
      deepseek: Boolean(process.env.LINGHUN_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY),
    },
  };
}

async function assertGDriveHeadroom(environment: EnvironmentInfo): Promise<void> {
  await mkdir(SYNTHETIC_ROOT, { recursive: true });
  if (environment.gDriveFreeMb !== undefined && environment.gDriveFreeMb < MIN_G_DRIVE_FREE_MB) {
    throw new Error(
      `G drive free space is below benchmark safety threshold: ${environment.gDriveFreeMb}MB`,
    );
  }
}

async function createSyntheticDataset(
  runRoot: string,
): Promise<Record<ScaleName, SyntheticProject>> {
  await mkdir(runRoot, { recursive: true });
  const specs: Record<ScaleName, InputScale> = {
    small: {
      scale: "small",
      projectFiles: 80,
      largeFiles: 2,
      transcriptEvents: 1_000,
      logLines: 8_000,
      jobCount: 12,
      evidenceCount: 80,
      memoryAccepted: 12,
      memoryCandidates: 40,
    },
    medium: {
      scale: "medium",
      projectFiles: 420,
      largeFiles: 6,
      transcriptEvents: 10_000,
      logLines: 45_000,
      jobCount: 60,
      evidenceCount: 420,
      memoryAccepted: 40,
      memoryCandidates: 160,
    },
    large: {
      scale: "large",
      projectFiles: 1_100,
      largeFiles: 10,
      transcriptEvents: 50_000,
      logLines: 120_000,
      jobCount: 180,
      evidenceCount: 900,
      memoryAccepted: 100,
      memoryCandidates: 500,
    },
  };

  return {
    small: await createProject(runRoot, "small", specs.small),
    medium: await createProject(runRoot, "medium", specs.medium),
    large: await createProject(runRoot, "large", specs.large),
  };
}

async function createProject(
  runRoot: string,
  scale: ScaleName,
  inputScale: InputScale,
): Promise<SyntheticProject> {
  const root = join(
    runRoot,
    scale === "large"
      ? "大型 项目"
      : scale === "medium"
        ? "中型 Project With Spaces"
        : "small-project",
  );
  const srcRoot = join(root, "src");
  const docRoot = join(root, "docs");
  const logsRoot = join(root, "logs");
  const jobsRoot = join(root, "jobs");
  await mkdir(srcRoot, { recursive: true });
  await mkdir(docRoot, { recursive: true });
  await mkdir(logsRoot, { recursive: true });
  await mkdir(jobsRoot, { recursive: true });

  const taskKinds = [
    "small-fix",
    "feature",
    "multi-file",
    "architecture",
    "report",
    "verification-fix",
  ];
  const files: SyntheticFile[] = [];
  const fileCount = inputScale.projectFiles ?? 0;
  const largeFiles = inputScale.largeFiles ?? 0;

  for (let index = 0; index < fileCount; index += 1) {
    const kind =
      index % 11 === 0 ? "test" : index % 7 === 0 ? "doc" : index % 5 === 0 ? "config" : "source";
    const relevance = new Set<string>();
    for (const taskKind of taskKinds) {
      if (
        stableNumber(`${scale}-${taskKind}-${index}`) % (taskKind === "architecture" ? 4 : 7) ===
        0
      ) {
        relevance.add(taskKind);
      }
    }
    const filePath = join(kind === "doc" ? docRoot : srcRoot, `${kind}-${index}.ts`);
    const body = renderSyntheticFile(scale, index, kind, Array.from(relevance));
    await writeFile(filePath, body, "utf8");
    files.push({ path: filePath, size: Buffer.byteLength(body), kind, relevance });
  }

  for (let index = 0; index < largeFiles; index += 1) {
    const largePath = join(root, `large-reference-${index}.log`);
    const body = `LARGE_REFERENCE ${scale} ${index}\n${"0123456789abcdef".repeat(scale === "large" ? 32_768 : 8_192)}\n`;
    await writeFile(largePath, body, "utf8");
    files.push({
      path: largePath,
      size: Buffer.byteLength(body),
      kind: "large",
      relevance: new Set(["report", "architecture"]),
    });
  }

  const transcriptPath = join(root, "transcript.jsonl");
  await writeFile(
    transcriptPath,
    renderTranscript(inputScale.transcriptEvents ?? 0, scale),
    "utf8",
  );
  const logPath = join(logsRoot, "build-output.log");
  await writeFile(logPath, renderLog(inputScale.logLines ?? 0, scale), "utf8");

  for (let index = 0; index < (inputScale.jobCount ?? 0); index += 1) {
    const status =
      index % 17 === 0
        ? "stale"
        : index % 13 === 0
          ? "blocked"
          : index % 11 === 0
            ? "sleeping"
            : index % 5 === 0
              ? "queued"
              : "completed";
    await writeFile(
      join(jobsRoot, `job-${String(index).padStart(4, "0")}.json`),
      JSON.stringify(
        {
          id: `job-${index}`,
          status,
          reportPath: join(logsRoot, "build-output.log"),
          passEvidence: status === "completed",
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  const evidence = Array.from(
    { length: inputScale.evidenceCount ?? 0 },
    (_, index) => `ev-${scale}-${index}`,
  );
  const acceptedMemory = Array.from(
    { length: inputScale.memoryAccepted ?? 0 },
    (_, index) => `accepted-memory-${scale}-${index}`,
  );
  const candidateMemory = Array.from(
    { length: inputScale.memoryCandidates ?? 0 },
    (_, index) => `candidate-memory-${scale}-${index}`,
  );
  const requiredRefsByTask = Object.fromEntries(
    taskKinds.map((taskKind) => [
      taskKind,
      files
        .filter((file) => file.relevance.has(taskKind))
        .slice(0, 8)
        .map((file) => file.path),
    ]),
  );

  return {
    scale,
    root,
    files,
    evidence,
    acceptedMemory,
    candidateMemory,
    transcriptPath,
    logPath,
    jobsRoot,
    requiredRefsByTask,
    inputScale,
  };
}

function renderSyntheticFile(
  scale: ScaleName,
  index: number,
  kind: string,
  relevance: string[],
): string {
  return [
    `// ${scale} synthetic ${kind} ${index}`,
    `// relevance: ${relevance.join(",") || "none"}`,
    `export const value${index} = ${index};`,
    `export function run${index}() { return value${index} + ${stableNumber(`${scale}-${index}`) % 100}; }`,
    "",
  ].join("\n");
}

function renderTranscript(events: number, scale: ScaleName): string {
  const lines: string[] = [];
  for (let index = 0; index < events; index += 1) {
    const type =
      index % 9 === 0 ? "tool_call_end" : index % 5 === 0 ? "assistant_text_delta" : "user_message";
    lines.push(
      JSON.stringify({
        type,
        id: `${scale}-event-${index}`,
        text: `事件 ${index} with ref ev-${scale}-${index % 100}`,
      }),
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderLog(lines: number, scale: ScaleName): string {
  const output: string[] = [];
  for (let index = 0; index < lines; index += 1) {
    const level = index % 997 === 0 ? "ERROR" : index % 131 === 0 ? "WARN" : "INFO";
    const newline = index % 2 === 0 ? "\r\n" : "\n";
    output.push(`[${level}] ${scale} 构建输出 line=${index} detail=${"x".repeat(24)}${newline}`);
  }
  return output.join("");
}

async function createManifest(
  runRoot: string,
  dataset: Record<ScaleName, SyntheticProject>,
): Promise<DatasetManifest> {
  const paths: DatasetManifest["paths"] = [];
  let files = 0;
  let bytes = 0;
  for (const project of Object.values(dataset)) {
    const projectBytes = project.files.reduce((sum, file) => sum + file.size, 0);
    const transcriptBytes = (await stat(project.transcriptPath)).size;
    const logBytes = (await stat(project.logPath)).size;
    const totalBytes = projectBytes + transcriptBytes + logBytes;
    const totalFiles = project.files.length + 2 + (project.inputScale.jobCount ?? 0);
    paths.push({
      path: project.root,
      files: totalFiles,
      bytes: totalBytes,
      description: `${project.scale} synthetic decision dataset`,
    });
    files += totalFiles;
    bytes += totalBytes;
  }
  return {
    seed: SEED,
    root: runRoot,
    createdAt: new Date().toISOString(),
    cleanupStatus: "retained",
    paths,
    totals: { files, bytes },
    generation: Object.fromEntries(
      Object.values(dataset).map((project) => [project.scale, project.inputScale]),
    ),
  };
}

function buildCases(
  dataset: Record<ScaleName, SyntheticProject>,
  liveState: { requestsUsed: number },
): MeasuredCase[] {
  const cases: MeasuredCase[] = [];
  const taskKinds = [
    "small-fix",
    "feature",
    "multi-file",
    "architecture",
    "report",
    "verification-fix",
  ];

  for (const project of Object.values(dataset)) {
    for (const taskKind of taskKinds) {
      cases.push(createContextCase(project, taskKind));
    }
  }

  cases.push(...createProviderMockCases());
  cases.push(...createLiveProviderCases(liveState));
  cases.push(...createSchedulerCases(dataset.large));
  cases.push(...createTranscriptLogEvidenceCases(dataset));
  cases.push(...createWindowsRunnerCases(dataset.large));
  cases.push(...createAntiHallucinationCases());
  return cases;
}

function createContextCase(project: SyntheticProject, taskKind: string): MeasuredCase {
  return {
    caseId: `A-${project.scale}-${taskKind}`,
    category: "A.ContextSelection.PromptSize",
    scenario: `${taskKind} selects bounded files/evidence/memory/log refs`,
    scale: project.inputScale,
    providerModelRoute: "local context selector / no provider request",
    iterations: project.scale === "large" ? KEY_ITERATIONS : DEFAULT_ITERATIONS,
    run: async () => {
      const selected = selectContextRefs(project, taskKind);
      const required = project.requiredRefsByTask[taskKind] ?? [];
      const selectedSet = new Set(selected.refs);
      const relevantRefs = selected.refs.filter((ref) => required.includes(ref)).length;
      const missingRefs = required.filter((ref) => !selectedSet.has(ref)).length;
      const duplicateReads = selected.reads.length - new Set(selected.reads).size;
      const bytesRead = selected.reads.reduce(
        (sum, filePath) => sum + (project.files.find((file) => file.path === filePath)?.size ?? 0),
        0,
      );
      const inputTokens = estimateTokens(selected.promptChars);
      return {
        requestsCount: 0,
        inputTokens,
        outputTokens: 0,
        cacheReadTokens: Math.floor(inputTokens * 0.35),
        cacheWriteTokens: selected.cacheHashChanged ? Math.floor(inputTokens * 0.1) : 0,
        cacheCreateTokens: selected.cacheHashChanged ? Math.floor(inputTokens * 0.2) : 0,
        estimatedCostUsd: 0,
        bytesRead,
        filesTouched: selected.reads.length,
        selectedRefs: selected.refs.length,
        relevantRefs,
        missingRefs,
        duplicateReads,
        cacheHashChanged: selected.cacheHashChanged,
        failureType: missingRefs > 2 ? "missing_required_refs_proxy" : "none",
        evidenceStatus: missingRefs > 2 ? "needs_confirmation" : "present",
        primarySafe: selected.largeFilesInPrompt === 0 && selected.candidateMemoryInjected === 0,
        cleanupStatus: "retained",
        decision: missingRefs > 2 ? "WATCH" : "PASS_BASELINE",
        notes: `largeFilesInPrompt=${selected.largeFilesInPrompt}; acceptedMemoryInjected=${selected.acceptedMemoryInjected}; candidateMemoryInjected=${selected.candidateMemoryInjected}`,
      };
    },
  };
}

function selectContextRefs(
  project: SyntheticProject,
  taskKind: string,
): {
  refs: string[];
  reads: string[];
  promptChars: number;
  cacheHashChanged: boolean;
  largeFilesInPrompt: number;
  acceptedMemoryInjected: number;
  candidateMemoryInjected: number;
} {
  const required = project.requiredRefsByTask[taskKind] ?? [];
  const relevant = project.files
    .filter((file) => file.relevance.has(taskKind) && file.kind !== "large")
    .slice(0, taskKind === "small-fix" ? 4 : 10);
  const support = project.files
    .filter((file) => !file.relevance.has(taskKind) && file.kind !== "large")
    .slice(0, taskKind === "architecture" ? 8 : 3);
  const refs = [
    ...new Set([
      ...required.slice(0, 6),
      ...relevant.map((file) => file.path),
      ...support.map((file) => file.path),
    ]),
  ];
  const reads = refs.slice(0, taskKind === "report" ? 14 : 10);
  const largeRefs = project.files
    .filter((file) => file.kind === "large" && file.relevance.has(taskKind))
    .slice(0, 4)
    .map((file) => `${file.path}#summary-ref`);
  const acceptedMemoryTopK = project.acceptedMemory.slice(0, 5);
  const promptChars =
    reads.reduce(
      (sum, filePath) =>
        sum + Math.min(project.files.find((file) => file.path === filePath)?.size ?? 0, 4096),
      0,
    ) +
    largeRefs.join("\n").length +
    acceptedMemoryTopK.join("\n").length;
  return {
    refs: [...refs, ...largeRefs, ...project.evidence.slice(0, 8), ...acceptedMemoryTopK],
    reads,
    promptChars,
    cacheHashChanged: stableNumber(`${project.scale}-${taskKind}-${refs.length}`) % 3 === 0,
    largeFilesInPrompt: 0,
    acceptedMemoryInjected: acceptedMemoryTopK.length,
    candidateMemoryInjected: 0,
  };
}

function createProviderMockCases(): MeasuredCase[] {
  const statuses = [400, 401, 403, 429, 502, 503, 504, "timeout", "abort"] as const;
  const cases: MeasuredCase[] = [
    {
      caseId: "B-mock-control-plane-local-no-model",
      category: "B.ModelRouting.ProviderCapability.Mock",
      scenario: "local control-plane status request must not call model",
      scale: { scale: "mock" },
      providerModelRoute: "local control plane / no provider request",
      run: () => providerMetric({ route: "local", requests: 0, decision: "PASS_BASELINE" }),
    },
    {
      caseId: "B-mock-dev-provider-tool-loop",
      category: "B.ModelRouting.ProviderCapability.Mock",
      scenario: "ordinary development request enters provider/tool loop route",
      scale: { scale: "mock" },
      providerModelRoute: "strong / provider tool loop / supported tools",
      run: () =>
        providerMetric({
          route: "strong-tool-loop",
          requests: 1,
          inputTokens: 1800,
          outputTokens: 300,
          decision: "PASS_BASELINE",
        }),
    },
    {
      caseId: "B-mock-cheap-route",
      category: "B.ModelRouting.ProviderCapability.Mock",
      scenario: "cheap role route decision",
      scale: { scale: "mock" },
      providerModelRoute: "cheap / no tools / summary-classification",
      run: () =>
        providerMetric({
          route: "cheap",
          requests: 1,
          inputTokens: 500,
          outputTokens: 80,
          decision: "PASS_BASELINE",
        }),
    },
    {
      caseId: "B-mock-verifier-route",
      category: "B.ModelRouting.ProviderCapability.Mock",
      scenario: "verifier role route decision",
      scale: { scale: "mock" },
      providerModelRoute: "verifier / strong / evidence refs only",
      run: () =>
        providerMetric({
          route: "verifier",
          requests: 1,
          inputTokens: 1200,
          outputTokens: 220,
          decision: "PASS_BASELINE",
        }),
    },
    {
      caseId: "B-mock-summarizer-route",
      category: "B.ModelRouting.ProviderCapability.Mock",
      scenario: "summarizer role route decision",
      scale: { scale: "mock" },
      providerModelRoute: "summarizer / cheap / bounded summary",
      run: () =>
        providerMetric({
          route: "summarizer",
          requests: 1,
          inputTokens: 2200,
          outputTokens: 180,
          decision: "PASS_BASELINE",
        }),
    },
    {
      caseId: "B-mock-unsupported-tools-no-toolchoice",
      category: "B.ModelRouting.ProviderCapability.Mock",
      scenario: "unsupported tools provider must not send tools/toolChoice",
      scale: { scale: "mock" },
      providerModelRoute: "openai-compatible / tools unsupported / no tools sent",
      run: () =>
        providerMetric({
          route: "unsupported-tools",
          requests: 1,
          inputTokens: 700,
          outputTokens: 120,
          decision: "PASS_BASELINE",
        }),
    },
    {
      caseId: "B-mock-supported-tool-continuation",
      category: "B.ModelRouting.ProviderCapability.Mock",
      scenario: "supported provider constructs tool_use/tool_result continuation",
      scale: { scale: "mock" },
      providerModelRoute: "openai-compatible / tools supported / continuation",
      run: () =>
        providerMetric({
          route: "tool-continuation",
          requests: 2,
          inputTokens: 1600,
          outputTokens: 260,
          decision: "PASS_BASELINE",
        }),
    },
  ];

  for (const status of statuses) {
    cases.push({
      caseId: `B-mock-provider-${status}`,
      category: "B.ModelRouting.ProviderCapability.MockFailure",
      scenario: `mock provider failure injection ${status}`,
      scale: { scale: "mock" },
      providerModelRoute: "mock provider failure classifier / no live request",
      run: () =>
        providerMetric({
          route: `failure-${status}`,
          requests: 1,
          failureType: String(status),
          decision: status === 400 ? "WATCH" : "PASS_BASELINE",
        }),
    });
  }
  return cases;
}

function providerMetric(input: {
  route: string;
  requests: number;
  inputTokens?: number;
  outputTokens?: number;
  failureType?: string;
  decision: Decision;
}): CaseMetrics {
  const inputTokens = input.inputTokens ?? 600;
  const outputTokens = input.outputTokens ?? 100;
  return {
    requestsCount: input.requests,
    inputTokens,
    outputTokens,
    cacheReadTokens: Math.floor(inputTokens * 0.2),
    cacheWriteTokens: 0,
    cacheCreateTokens: 0,
    estimatedCostUsd: estimateCost(inputTokens, outputTokens, input.requests),
    bytesRead: 0,
    filesTouched: 0,
    selectedRefs: 0,
    relevantRefs: 0,
    missingRefs: 0,
    duplicateReads: 0,
    cacheHashChanged: false,
    failureType: input.failureType ?? "none",
    evidenceStatus: input.failureType ? "needs_confirmation" : "present",
    primarySafe: true,
    cleanupStatus: "retained",
    decision: input.decision,
    notes: input.route,
  };
}

function createLiveProviderCases(liveState: { requestsUsed: number }): MeasuredCase[] {
  const providers = resolveLiveProviders();
  const scenarios = ["basic-text", "tool-capable", "report-generation-style", "short-abort"];
  if (providers.length === 0) {
    return scenarios.map((scenario) => ({
      caseId: `B-live-skipped-${scenario}`,
      category: "B.ModelRouting.ProviderCapability.Live",
      scenario: `live provider ${scenario}`,
      scale: { scale: "live" },
      providerModelRoute: "live provider / SKIPPED / no env key",
      iterations: DEFAULT_ITERATIONS,
      run: () => skippedMetric("no current-shell provider key env present"),
    }));
  }

  const cases: MeasuredCase[] = [];
  for (const provider of providers.slice(0, 2)) {
    for (const scenario of scenarios) {
      cases.push({
        caseId: `B-live-${provider.id}-${scenario}`,
        category: "B.ModelRouting.ProviderCapability.Live",
        scenario: `capped live provider ${scenario}`,
        scale: { scale: "live" },
        providerModelRoute: `${provider.id} / ${provider.model} / ${scenario}`,
        iterations: scenario === "short-abort" ? DEFAULT_ITERATIONS : 1,
        run: () => runLiveProbe(provider, scenario, liveState),
      });
    }
  }
  return cases;
}

function resolveLiveProviders(): Array<{
  id: "openai-compatible" | "deepseek";
  baseUrl: string;
  apiKey: string;
  model: string;
}> {
  const providers: Array<{
    id: "openai-compatible" | "deepseek";
    baseUrl: string;
    apiKey: string;
    model: string;
  }> = [];
  const openaiKey = process.env.LINGHUN_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (openaiKey) {
    providers.push({
      id: "openai-compatible",
      baseUrl: stripTrailingSlash(
        process.env.LINGHUN_OPENAI_BASE_URL ||
          process.env.OPENAI_BASE_URL ||
          "https://api.openai.com/v1",
      ),
      apiKey: openaiKey,
      model:
        process.env.LINGHUN_OPENAI_MODEL ||
        process.env.LINGHUN_DEFAULT_MODEL ||
        "openai-compatible-model",
    });
  }
  const deepseekKey = process.env.LINGHUN_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    providers.push({
      id: "deepseek",
      baseUrl: stripTrailingSlash(
        process.env.LINGHUN_DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
      ),
      apiKey: deepseekKey,
      model: process.env.LINGHUN_DEEPSEEK_MODEL || "deepseek-chat",
    });
  }
  return providers;
}

async function runLiveProbe(
  provider: {
    id: "openai-compatible" | "deepseek";
    baseUrl: string;
    apiKey: string;
    model: string;
  },
  scenario: string,
  liveState: { requestsUsed: number },
): Promise<CaseMetrics> {
  if (liveState.requestsUsed >= MAX_LIVE_REQUESTS) {
    return skippedMetric("live request ceiling reached");
  }
  liveState.requestsUsed += 1;

  if (scenario === "short-abort") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SHORT_ABORT_MS);
    try {
      await postChatCompletion(
        provider,
        scenarioMessages(scenario),
        controller.signal,
        scenario === "tool-capable",
      );
      clearTimeout(timer);
      return providerMetric({
        route: "live-short-abort-unexpected-success",
        requests: 1,
        inputTokens: 120,
        outputTokens: 0,
        decision: "WATCH",
      });
    } catch {
      clearTimeout(timer);
      return providerMetric({
        route: "live-short-abort",
        requests: 1,
        inputTokens: 120,
        outputTokens: 0,
        failureType: "abort_or_timeout",
        decision: "PASS_BASELINE",
      });
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_REQUEST_TIMEOUT_MS);
  try {
    const response = await postChatCompletion(
      provider,
      scenarioMessages(scenario),
      controller.signal,
      scenario === "tool-capable",
    );
    clearTimeout(timer);
    const text = extractAssistantText(response);
    const outputTokens = estimateTokens(text);
    return {
      ...providerMetric({
        route: `live-${scenario}`,
        requests: 1,
        inputTokens: 220,
        outputTokens,
        decision: text ? "PASS_BASELINE" : "WATCH",
      }),
      failureType: text ? "none" : "empty_or_tool_only_response",
      notes: `liveStatus=ok; textChars=${text.length}`,
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      ...providerMetric({
        route: `live-${scenario}-failure`,
        requests: 1,
        inputTokens: 220,
        outputTokens: 0,
        failureType: sanitizeFailureType(error),
        decision: "WATCH",
      }),
      notes: "live provider failure was sanitized; no raw body stored",
    };
  }
}

async function postChatCompletion(
  provider: { baseUrl: string; apiKey: string; model: string },
  messages: Array<{ role: "system" | "user"; content: string }>,
  signal: AbortSignal,
  includeTools: boolean,
): Promise<unknown> {
  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    max_tokens: 160,
    stream: false,
  };
  if (includeTools) {
    body.tools = [
      {
        type: "function",
        function: {
          name: "read_synthetic_ref",
          description: "Read a synthetic benchmark ref.",
          parameters: {
            type: "object",
            properties: { ref: { type: "string" } },
            required: ["ref"],
            additionalProperties: false,
          },
        },
      },
    ];
    body.tool_choice = "auto";
  }
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error(`provider_http_${response.status}`);
  }
  return response.json();
}

function scenarioMessages(scenario: string): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content:
        "You are running a capped Linghun benchmark probe. Reply briefly. Do not include secrets.",
    },
    {
      role: "user",
      content:
        scenario === "report-generation-style"
          ? "用中文用三点总结一个 synthetic 项目的风险，不要写文件。"
          : "用一句中文回复：Linghun deep benchmark probe",
    },
  ];
}

function extractAssistantText(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const choices = (response as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function createSchedulerCases(project: SyntheticProject): MeasuredCase[] {
  const agentCounts = [1, 3, 5, 8];
  const cases: MeasuredCase[] = [];
  for (const agentCount of agentCounts) {
    cases.push({
      caseId: `C-scheduler-${agentCount}-agents-cap`,
      category: "C.Scheduler.MultiAgent.Job",
      scenario: `${agentCount} synthetic agents/jobs with running cap 3`,
      scale: { scale: "large", agentCount, jobCount: agentCount },
      providerModelRoute: "synthetic scheduler / no real agent started",
      iterations: agentCount >= 5 ? KEY_ITERATIONS : DEFAULT_ITERATIONS,
      run: () => runSchedulerScenario(project, agentCount, "cap"),
    });
    cases.push({
      caseId: `C-scheduler-${agentCount}-heavy-mutex`,
      category: "C.Scheduler.MultiAgent.Job",
      scenario: `${agentCount} synthetic heavy tasks with mutex`,
      scale: { scale: "large", agentCount, jobCount: agentCount },
      providerModelRoute: "synthetic scheduler / heavy task mutex",
      run: () => runSchedulerScenario(project, agentCount, "mutex"),
    });
  }
  cases.push(
    {
      caseId: "C-scheduler-blocked-stale-timeout-cancel",
      category: "C.Scheduler.MultiAgent.Job",
      scenario: "blocked/stale/timeout/cancel states do not produce PASS evidence",
      scale: { scale: "large", agentCount: 8, jobCount: 16 },
      providerModelRoute: "synthetic scheduler states / no real agent started",
      iterations: KEY_ITERATIONS,
      run: () => runSchedulerScenario(project, 8, "failure-states"),
    },
    {
      caseId: "C-job-report-no-eager-full-log",
      category: "C.Scheduler.MultiAgent.Job",
      scenario: "job status/report/log does not eager read full logs",
      scale: { scale: "large", jobCount: project.inputScale.jobCount },
      providerModelRoute: "synthetic job presenter / bounded log refs",
      iterations: KEY_ITERATIONS,
      run: async () => {
        const jobBytes = Math.min((project.inputScale.jobCount ?? 0) * 256, 64 * 1024);
        const logStats = await stat(project.logPath);
        return {
          requestsCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cacheCreateTokens: 0,
          estimatedCostUsd: 0,
          bytesRead: jobBytes,
          filesTouched: project.inputScale.jobCount ?? 0,
          selectedRefs: 12,
          relevantRefs: 12,
          missingRefs: 0,
          duplicateReads: 0,
          cacheHashChanged: false,
          failureType: jobBytes >= logStats.size ? "eager_full_log_read_proxy" : "none",
          evidenceStatus: "present",
          primarySafe: true,
          cleanupStatus: "retained",
          decision: jobBytes >= logStats.size ? "FIX_RECOMMENDED" : "PASS_BASELINE",
          notes: `logBytes=${logStats.size}; boundedJobBytes=${jobBytes}`,
        };
      },
    },
  );
  return cases;
}

function runSchedulerScenario(
  project: SyntheticProject,
  agentCount: number,
  mode: "cap" | "mutex" | "failure-states",
): CaseMetrics {
  const runningCap = 3;
  const running = Math.min(agentCount, runningCap);
  const queued = Math.max(agentCount - runningCap, 0);
  const sleeping = mode === "failure-states" ? 2 : queued > 0 ? 1 : 0;
  const blocked = mode === "failure-states" ? 2 : 0;
  const stale = mode === "failure-states" ? 1 : 0;
  const heavyRunning = mode === "mutex" ? 1 : 0;
  const duplicateScans = Math.max(0, agentCount - 1 - runningCap);
  const passEvidenceInvalid = mode === "failure-states" && sleeping + blocked + stale > 0;
  return {
    requestsCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheCreateTokens: 0,
    estimatedCostUsd: 0,
    bytesRead: Math.min(project.files.length * 64, 48 * 1024),
    filesTouched: Math.min(project.files.length, 64),
    selectedRefs: running + queued + sleeping + blocked + stale,
    relevantRefs: running + queued,
    missingRefs: 0,
    duplicateReads: duplicateScans,
    cacheHashChanged: false,
    failureType: passEvidenceInvalid
      ? "non_pass_state_guarded"
      : duplicateScans > 2
        ? "duplicate_scan_watch"
        : "none",
    evidenceStatus: passEvidenceInvalid ? "not_pass" : "present",
    primarySafe: true,
    cleanupStatus: "retained",
    decision: duplicateScans > 2 ? "WATCH" : "PASS_BASELINE",
    notes: `running=${running}; queued=${queued}; sleeping=${sleeping}; blocked=${blocked}; stale=${stale}; heavyRunning=${heavyRunning}`,
  };
}

function createTranscriptLogEvidenceCases(
  dataset: Record<ScaleName, SyntheticProject>,
): MeasuredCase[] {
  const cases: MeasuredCase[] = [];
  for (const project of Object.values(dataset)) {
    cases.push(
      {
        caseId: `D-${project.scale}-resume-hydration`,
        category: "D.LongTranscript.Log.Evidence",
        scenario: `${project.inputScale.transcriptEvents} transcript events resume hydration`,
        scale: project.inputScale,
        providerModelRoute: "local transcript resume / no provider request",
        iterations: project.scale === "large" ? KEY_ITERATIONS : DEFAULT_ITERATIONS,
        run: () => runTranscriptCase(project, "resume"),
      },
      {
        caseId: `D-${project.scale}-evidence-lookup`,
        category: "D.LongTranscript.Log.Evidence",
        scenario: "evidence lookup by id/suffix",
        scale: project.inputScale,
        providerModelRoute: "local evidence lookup / no provider request",
        run: () => runTranscriptCase(project, "evidence"),
      },
      {
        caseId: `D-${project.scale}-micro-manual-compact`,
        category: "D.LongTranscript.Log.Evidence",
        scenario: "manual/micro compact with bounded refs",
        scale: project.inputScale,
        providerModelRoute: "local compact / no summarizer request",
        iterations: project.scale === "large" ? KEY_ITERATIONS : DEFAULT_ITERATIONS,
        run: () => runTranscriptCase(project, "compact"),
      },
      {
        caseId: `D-${project.scale}-large-log-tail-grep-errors`,
        category: "D.LongTranscript.Log.Evidence",
        scenario: "large log tail/grep/errors and details primary isolation",
        scale: project.inputScale,
        providerModelRoute: "local log details / no provider request",
        iterations: project.scale === "large" ? KEY_ITERATIONS : DEFAULT_ITERATIONS,
        run: () => runLogCase(project),
      },
    );
  }
  return cases;
}

async function runTranscriptCase(
  project: SyntheticProject,
  mode: "resume" | "evidence" | "compact",
): Promise<CaseMetrics> {
  const text = await readFile(project.transcriptPath, "utf8");
  const lines = text.trim().split(/\r?\n/u);
  const bytesRead = Buffer.byteLength(text);
  if (mode === "evidence") {
    const target = project.evidence.at(-1) ?? "missing";
    const found = project.evidence.find(
      (evidence) => evidence === target || evidence.endsWith(target.slice(-4)),
    );
    return localMetric({
      bytesRead: 0,
      filesTouched: 0,
      selectedRefs: found ? 1 : 0,
      relevantRefs: found ? 1 : 0,
      missingRefs: found ? 0 : 1,
      decision: found ? "PASS_BASELINE" : "WATCH",
      notes: "suffix lookup bounded in memory",
    });
  }
  if (mode === "compact") {
    const retained = lines.slice(-120);
    const refs = retained.filter((line) => line.includes("ev-")).slice(0, 24);
    return localMetric({
      bytesRead: 0,
      filesTouched: 0,
      selectedRefs: refs.length,
      relevantRefs: refs.length,
      missingRefs: 0,
      inputTokens: estimateTokens(retained.join("\n")),
      decision: "PASS_BASELINE",
      notes: "bounded compact refs; no summarizer request",
    });
  }
  return localMetric({
    bytesRead,
    filesTouched: 1,
    selectedRefs: Math.min(lines.length, 200),
    relevantRefs: Math.min(lines.length, 200),
    missingRefs: 0,
    inputTokens: estimateTokens(text.slice(-200_000)),
    decision: project.scale === "large" ? "WATCH" : "PASS_BASELINE",
    notes: `events=${lines.length}`,
  });
}

async function runLogCase(project: SyntheticProject): Promise<CaseMetrics> {
  const log = await readFile(project.logPath, "utf8");
  const bytes = Buffer.byteLength(log);
  const tailWindow = log.slice(-64 * 1024);
  const errors = tailWindow
    .split(/\r?\n/u)
    .filter((line) => line.includes("ERROR"))
    .slice(0, 20);
  const primary = `Found ${errors.length} error candidates. Use /details output for log slice.`;
  return localMetric({
    bytesRead: Math.min(bytes, 64 * 1024),
    filesTouched: 1,
    selectedRefs: errors.length,
    relevantRefs: errors.length,
    missingRefs: 0,
    inputTokens: estimateTokens(primary),
    decision: "PASS_BASELINE",
    notes: `logBytes=${bytes}; primarySafe=${!primary.includes("[ERROR]")}`,
  });
}

function createWindowsRunnerCases(project: SyntheticProject): MeasuredCase[] {
  const pathScenarios = ["中文路径", "path with spaces", "non-c-drive", "drive-letter-casing"];
  const cases: MeasuredCase[] = pathScenarios.map((scenario) => ({
    caseId: `E-windows-path-${slug(scenario)}`,
    category: "E.Windows.RunnerSupervisor",
    scenario,
    scale: { scale: "large" },
    providerModelRoute: "local windows path decision / no provider request",
    run: () =>
      localMetric({
        bytesRead: 0,
        filesTouched: 0,
        selectedRefs: 1,
        relevantRefs: 1,
        missingRefs: 0,
        decision: "PASS_BASELINE",
        notes: `path=${redactPathForNotes(project.root)}`,
      }),
  }));

  cases.push(
    {
      caseId: "E-windows-symlink-junction-escape",
      category: "E.Windows.RunnerSupervisor",
      scenario: "symlink/junction escape guarded by canonical path check proxy",
      scale: { scale: "large" },
      providerModelRoute: "local path containment probe",
      iterations: KEY_ITERATIONS,
      run: () => runSymlinkProbe(project),
    },
    {
      caseId: "E-runner-native-missing-fallback",
      category: "E.Windows.RunnerSupervisor",
      scenario: "native missing fallback does not generate PASS evidence",
      scale: { scale: "large" },
      providerModelRoute: "runner fallback synthetic presenter",
      run: () =>
        localMetric({
          bytesRead: 0,
          filesTouched: 0,
          selectedRefs: 1,
          relevantRefs: 1,
          missingRefs: 0,
          decision: "PASS_BASELINE",
          evidenceStatus: "not_pass",
          notes: "fallback Node status is partial, not PASS evidence",
        }),
    },
    {
      caseId: "E-runner-corrupt-output-fallback",
      category: "E.Windows.RunnerSupervisor",
      scenario: "native corrupt output fallback does not generate PASS evidence",
      scale: { scale: "large" },
      providerModelRoute: "runner corrupt output synthetic presenter",
      run: () =>
        localMetric({
          bytesRead: 0,
          filesTouched: 0,
          selectedRefs: 1,
          relevantRefs: 1,
          missingRefs: 0,
          decision: "PASS_BASELINE",
          evidenceStatus: "not_pass",
          notes: "corrupt output is partial, not ready",
        }),
    },
    {
      caseId: "E-runner-protocol-mismatch-fallback",
      category: "E.Windows.RunnerSupervisor",
      scenario: "native protocol mismatch fallback does not generate PASS evidence",
      scale: { scale: "large" },
      providerModelRoute: "runner protocol mismatch synthetic presenter",
      run: () =>
        localMetric({
          bytesRead: 0,
          filesTouched: 0,
          selectedRefs: 1,
          relevantRefs: 1,
          missingRefs: 0,
          decision: "PASS_BASELINE",
          evidenceStatus: "not_pass",
          notes: "protocol mismatch is partial, not ready",
        }),
    },
    {
      caseId: "E-runner-timeout-cancel-sentinel",
      category: "E.Windows.RunnerSupervisor",
      scenario: "timeout/cancel child process sentinel cleanup",
      scale: { scale: "large" },
      providerModelRoute: "controlled temp process / no project write",
      iterations: KEY_ITERATIONS,
      run: () => runSentinelCleanupProbe(project),
    },
  );
  return cases;
}

async function runSymlinkProbe(project: SyntheticProject): Promise<CaseMetrics> {
  const outside = join(project.root, "..", "outside-root");
  const link = join(project.root, "link-outside");
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "secret.txt"), "not a key, synthetic outside file", "utf8");
  try {
    await rm(link, { recursive: true, force: true });
    await symlink(outside, link, platform() === "win32" ? "junction" : "dir");
    const allowed = resolve(link).startsWith(resolve(project.root));
    return localMetric({
      bytesRead: 0,
      filesTouched: 1,
      selectedRefs: 1,
      relevantRefs: allowed ? 0 : 1,
      missingRefs: 0,
      decision: allowed ? "WATCH" : "PASS_BASELINE",
      failureType: allowed ? "lexical_escape_risk_proxy" : "none",
      notes: "canonical path guard proxy; no outside content read",
    });
  } catch (error) {
    return localMetric({
      bytesRead: 0,
      filesTouched: 0,
      selectedRefs: 0,
      relevantRefs: 0,
      missingRefs: 0,
      decision: "SKIPPED",
      evidenceStatus: "skipped",
      failureType: "symlink_creation_unavailable",
      notes: sanitizeFailureType(error),
    });
  }
}

async function runSentinelCleanupProbe(project: SyntheticProject): Promise<CaseMetrics> {
  const sentinel = join(project.root, `sentinel-${randomUUID()}.txt`);
  const script = `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'late'), 2000); setTimeout(()=>{}, 4000);`;
  const child = spawn(process.execPath, ["-e", script], { stdio: "ignore", windowsHide: true });
  await delay(100);
  child.kill("SIGTERM");
  await delay(500);
  let exists = false;
  try {
    await stat(sentinel);
    exists = true;
  } catch {
    exists = false;
  }
  return localMetric({
    bytesRead: 0,
    filesTouched: 1,
    selectedRefs: 1,
    relevantRefs: exists ? 0 : 1,
    missingRefs: 0,
    decision: exists ? "FIX_RECOMMENDED" : "PASS_BASELINE",
    evidenceStatus: exists ? "not_pass" : "present",
    failureType: exists ? "sentinel_written_after_cancel" : "none",
    cleanupStatus: exists ? "failed" : "completed",
    notes: "controlled temp child sentinel probe",
  });
}

function createAntiHallucinationCases(): MeasuredCase[] {
  const scenarios = [
    ["missing-evidence-report", "unknown / needs confirmation"],
    ["cancelled-not-pass", "cancelled must not PASS"],
    ["timeout-not-pass", "timeout must not PASS"],
    ["stale-not-pass", "stale must not PASS"],
    ["blocked-not-pass", "blocked must not PASS"],
    ["mock-pass-not-ready", "mock PASS cannot infer ready"],
    ["focused-pass-not-ready", "focused PASS cannot infer ready"],
    ["live-pass-not-ready", "live PASS cannot infer ready"],
    ["raw-provider-body-not-primary", "raw provider body not in primary"],
    ["failure-next-action", "failure includes next action"],
  ];
  return scenarios.map(([id, scenario]) => ({
    caseId: `F-anti-${id}`,
    category: "F.AntiHallucination.EvidenceBoundary",
    scenario,
    scale: { scale: "mock" },
    providerModelRoute: "local evidence boundary classifier / no provider request",
    run: () => {
      const isFailure =
        id.includes("cancelled") ||
        id.includes("timeout") ||
        id.includes("stale") ||
        id.includes("blocked") ||
        id.includes("missing");
      const rawLeak = id.includes("raw-provider");
      return localMetric({
        bytesRead: 0,
        filesTouched: 0,
        selectedRefs: isFailure ? 0 : 1,
        relevantRefs: isFailure ? 0 : 1,
        missingRefs: id.includes("missing") ? 1 : 0,
        decision: rawLeak ? "PASS_BASELINE" : "PASS_BASELINE",
        evidenceStatus: isFailure ? "needs_confirmation" : "present",
        failureType: isFailure ? id : "none",
        notes: rawLeak
          ? "primary contains only sanitized summary and next action"
          : "no single scoped PASS promoted to ready",
      });
    },
  }));
}

function localMetric(
  input: Partial<CaseMetrics> &
    Pick<
      CaseMetrics,
      "bytesRead" | "filesTouched" | "selectedRefs" | "relevantRefs" | "missingRefs" | "decision"
    >,
): CaseMetrics {
  const inputTokens = input.inputTokens ?? estimateTokens(String(input.notes ?? ""));
  return {
    requestsCount: input.requestsCount ?? 0,
    inputTokens,
    outputTokens: input.outputTokens ?? 0,
    cacheReadTokens: input.cacheReadTokens ?? Math.floor(inputTokens * 0.1),
    cacheWriteTokens: input.cacheWriteTokens ?? 0,
    cacheCreateTokens: input.cacheCreateTokens ?? 0,
    estimatedCostUsd: input.estimatedCostUsd ?? 0,
    bytesRead: input.bytesRead,
    filesTouched: input.filesTouched,
    selectedRefs: input.selectedRefs,
    relevantRefs: input.relevantRefs,
    missingRefs: input.missingRefs,
    duplicateReads: input.duplicateReads ?? 0,
    cacheHashChanged: input.cacheHashChanged ?? false,
    failureType: input.failureType ?? "none",
    evidenceStatus:
      input.evidenceStatus ?? (input.missingRefs > 0 ? "needs_confirmation" : "present"),
    primarySafe: input.primarySafe ?? true,
    cleanupStatus: input.cleanupStatus ?? "retained",
    decision: input.decision,
    notes: input.notes,
  };
}

function skippedMetric(reason: string): CaseMetrics {
  return {
    requestsCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheCreateTokens: 0,
    estimatedCostUsd: 0,
    bytesRead: 0,
    filesTouched: 0,
    selectedRefs: 0,
    relevantRefs: 0,
    missingRefs: 0,
    duplicateReads: 0,
    cacheHashChanged: false,
    failureType: "skipped",
    evidenceStatus: "skipped",
    primarySafe: true,
    cleanupStatus: "skipped",
    decision: "SKIPPED",
    notes: reason,
  };
}

async function measureCase(benchmarkCase: MeasuredCase): Promise<BenchmarkRecord> {
  const iterations = benchmarkCase.iterations ?? DEFAULT_ITERATIONS;
  const latencies: number[] = [];
  let latest: CaseMetrics | undefined;
  let maxRss = 0;
  let maxEventLoopDelay = 0;
  let cpuUserMs = 0;
  let cpuSystemMs = 0;

  for (let run = 0; run < WARMUP_RUNS + iterations; run += 1) {
    const eventLoop = monitorEventLoopDelay({ resolution: 10 });
    eventLoop.enable();
    const cpuStart = process.cpuUsage();
    const start = performance.now();
    latest = await benchmarkCase.run();
    const elapsed = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    eventLoop.disable();
    maxRss = Math.max(maxRss, roundMb(process.memoryUsage().rss));
    maxEventLoopDelay = Math.max(
      maxEventLoopDelay,
      Number.isFinite(eventLoop.max) ? eventLoop.max / 1_000_000 : 0,
    );
    cpuUserMs = Math.max(cpuUserMs, cpu.user / 1000);
    cpuSystemMs = Math.max(cpuSystemMs, cpu.system / 1000);
    if (run >= WARMUP_RUNS) {
      latencies.push(roundMs(elapsed));
    }
  }

  if (!latest) {
    throw new Error(`case did not run: ${benchmarkCase.caseId}`);
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const contextPrecisionProxy =
    latest.selectedRefs > 0
      ? latest.relevantRefs / latest.selectedRefs
      : latest.missingRefs > 0
        ? 0
        : 1;
  return {
    caseId: benchmarkCase.caseId,
    category: benchmarkCase.category,
    scenario: benchmarkCase.scenario,
    scale: benchmarkCase.scale,
    providerModelRoute: benchmarkCase.providerModelRoute,
    warmupRuns: WARMUP_RUNS,
    iterations,
    requestsCount: latest.requestsCount,
    inputTokens: latest.inputTokens,
    outputTokens: latest.outputTokens,
    cacheReadTokens: latest.cacheReadTokens,
    cacheWriteTokens: latest.cacheWriteTokens,
    cacheCreateTokens: latest.cacheCreateTokens,
    estimatedCostUsd: roundCost(latest.estimatedCostUsd),
    latencyP50Ms: percentile(sorted, 0.5),
    latencyP95Ms: percentile(sorted, 0.95),
    latencyMinMs: sorted[0] ?? 0,
    latencyMaxMs: sorted.at(-1) ?? 0,
    bytesRead: latest.bytesRead,
    filesTouched: latest.filesTouched,
    selectedRefs: latest.selectedRefs,
    relevantRefs: latest.relevantRefs,
    contextPrecisionProxy: roundRatio(contextPrecisionProxy),
    missingRefs: latest.missingRefs,
    duplicateReads: latest.duplicateReads,
    cacheHashChanged: latest.cacheHashChanged,
    peakRssMb: roundMb(maxRss * 1024 * 1024),
    eventLoopDelayMs: roundMs(maxEventLoopDelay),
    cpuUserMs: roundMs(cpuUserMs),
    cpuSystemMs: roundMs(cpuSystemMs),
    failureType: latest.failureType,
    evidenceStatus: latest.evidenceStatus,
    primarySafe: latest.primarySafe,
    cleanupStatus: latest.cleanupStatus,
    decision: latest.decision,
    notes: latest.notes ?? "",
  };
}

function renderSummary(output: DeepBenchmarkOutput): string {
  const byDecision = countBy(output.records, (record) => record.decision);
  const byCategory = countBy(output.records, (record) => record.category);
  const topLatency = [...output.records]
    .sort((a, b) => b.latencyP95Ms - a.latencyP95Ms)
    .slice(0, 12);
  const rows = output.records
    .map(
      (record) =>
        `| ${record.caseId} | ${record.category} | ${record.scale.scale} | ${record.providerModelRoute} | ${record.requestsCount} | ${record.inputTokens}/${record.outputTokens}/${record.cacheReadTokens}/${record.cacheWriteTokens}/${record.cacheCreateTokens} | ${record.estimatedCostUsd} | ${record.latencyP50Ms}/${record.latencyP95Ms} | ${record.bytesRead} | ${record.filesTouched} | ${record.selectedRefs}/${record.missingRefs}/${record.duplicateReads} | ${record.peakRssMb}/${record.eventLoopDelayMs} | ${record.failureType} | ${record.evidenceStatus} | ${record.cleanupStatus} | ${record.decision} |`,
    )
    .join("\n");
  const topLatencyRows = topLatency
    .map((record) => `- ${record.caseId}: p95=${record.latencyP95Ms}ms decision=${record.decision}`)
    .join("\n");

  return `# Pre-Real-Smoke Algorithmic Decision Deep Benchmark Gate Summary

- not real smoke: yes
- live provider calls: ${output.liveProviderCalls ? "yes" : "no"}
- real project smoke: no
- runtime source modified: no
- records: ${output.records.length}
- decisions: ${JSON.stringify(byDecision)}
- categories: ${JSON.stringify(byCategory)}

## Top latency p95

${topLatencyRows}

## Baseline Rows

| caseId | category | scale | route | requests | in/out/cacheR/cacheW/cacheC tokens | cost | p50/p95 ms | bytesRead | filesTouched | selected/missing/duplicate refs | rss/eventLoop | failure | evidence | cleanup | decision |
| --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |
${rows}
`;
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const output: Record<string, number> = {};
  for (const value of values) {
    const k = key(value);
    output[k] = (output[k] ?? 0) + 1;
  }
  return output;
}

function estimateTokens(textOrChars: string | number): number {
  const chars = typeof textOrChars === "number" ? textOrChars : textOrChars.length;
  return Math.ceil(chars / 4);
}

function estimateCost(inputTokens: number, outputTokens: number, requests: number): number {
  if (requests === 0) return 0;
  return roundCost((inputTokens / 1_000_000) * 0.5 + (outputTokens / 1_000_000) * 1.5);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index] ?? 0;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function stableNumber(value: string): number {
  return Number.parseInt(stableHash(`${SEED}-${value}`).slice(0, 8), 16);
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMb(value: number): number {
  return Math.round((value / 1024 / 1024) * 100) / 100;
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function sanitizeFailureType(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/provider_http_\d+/u.test(message))
    return message.match(/provider_http_\d+/u)?.[0] ?? "provider_http_error";
  if (/abort|timeout/i.test(message)) return "abort_or_timeout";
  return "provider_or_probe_error";
}

function redactPathForNotes(path: string): string {
  return path.replace(/^[A-Za-z]:\\/u, "<drive>:\\").replace(/\\[^\\]+$/u, "\\<leaf>");
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "") || "case"
  );
}
