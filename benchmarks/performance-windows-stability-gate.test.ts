import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, statfs, writeFile } from "node:fs/promises";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setImmediate as yieldImmediate } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { type TranscriptEvent, readJsonl } from "../packages/core/src/index.js";
import {
  type ModelMessage,
  OpenAiCompatibleProvider,
  parseOpenAiStream,
} from "../packages/providers/src/index.js";
import {
  type CompactBoundary,
  compactBoundaryHash,
  createManualCompactBoundary,
  estimateModelMessagesChars,
  microCompactMessages,
} from "../packages/tui/src/compact-context.js";
import {
  formatBackgroundDetails,
  formatBackgroundTask,
  formatJobRunnerReportLine,
  formatRunnerDoctor,
} from "../packages/tui/src/job-runner-presenter.js";
import {
  type LogArtifactRegistry,
  readLogArtifactSlice,
} from "../packages/tui/src/log-artifact.js";
import {
  type TerminalReadinessView,
  createReadinessItems,
  formatTerminalProblemsPanel,
  formatTerminalReadinessDoctor,
  formatTerminalReadinessStatus,
} from "../packages/tui/src/terminal-readiness-presenter.js";
import {
  type WorkspaceReferenceDimensions,
  createWorkspaceReferenceCache,
  getWorkspaceReferenceSnapshot,
} from "../packages/tui/src/workspace-reference-cache.js";

const RUN_PERF_GATE = process.env.LINGHUN_PERF_GATE === "1";
const SYNTHETIC_ROOT = "G:\\linghun-perf-gate";
const ARTIFACT_ROOT = resolve("docs", "audit", "artifacts");
const RAW_OUTPUT_PATH =
  process.env.LINGHUN_PERF_GATE_RAW_OUTPUT ??
  join(ARTIFACT_ROOT, "performance-gate-baseline-raw.json");
const SUMMARY_OUTPUT_PATH =
  process.env.LINGHUN_PERF_GATE_SUMMARY_OUTPUT ??
  resolve("docs", "audit", "performance-windows-stability-hardening-gate-baseline.md");
const SEED = 20260524;
const WARMUP_RUNS = 2;
const ITERATIONS = 5;
const MIN_FREE_RATIO = 0.2;

type InputScale = {
  transcriptMessages?: number;
  transcriptBytes?: number;
  logLines?: number;
  logBytes?: number;
  workspaceDirs?: number;
  workspaceFiles?: number;
  jobCount?: number;
  sseChunks?: number;
  messageCount?: number;
  evidenceCount?: number;
  boundaryCount?: number;
};

type BenchmarkRecord = {
  caseId: string;
  hotspot: string;
  inputScale: InputScale;
  datasetPath: string;
  iterations: number;
  warmupRuns: number;
  wallMs: number;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  peakRssMb: number;
  eventLoopDelayMs: number;
  bytesRead: number;
  filesTouched: number;
  charsEstimate: number;
  tokensEstimate: number;
  cacheHashChanged: boolean;
  errors: string[];
  notes: string;
};

type DatasetManifest = {
  seed: number;
  root: string;
  createdAt: string;
  cleanupStatus: "pending" | "completed";
  paths: Array<{ path: string; files: number; bytes: number; description: string }>;
  totals: { files: number; bytes: number };
  generation: Record<string, InputScale>;
};

type EnvironmentInfo = {
  node: string;
  pnpm: string;
  os: string;
  platform: NodeJS.Platform;
  cpuLogicalCores: number;
  totalMemoryMb: number;
  freeMemoryMb: number;
  gDriveFreeMb?: number;
  gDriveTotalMb?: number;
  battery: string;
};

type SyntheticDataset = {
  root: string;
  small: ScaleDataset;
  medium: ScaleDataset;
  manifest: DatasetManifest;
};

type ScaleDataset = {
  name: "small" | "medium";
  root: string;
  transcriptPath: string;
  logPath: string;
  workspacePath: string;
  jobsPath: string;
  ssePath: string;
  scale: InputScale;
};

const runIfRequested = RUN_PERF_GATE ? it : it.skip;

describe("Performance & Windows Stability Hardening Gate baseline", () => {
  runIfRequested(
    "writes small and medium synthetic baseline artifacts",
    async () => {
      await mkdir(ARTIFACT_ROOT, { recursive: true });
      const environment = await collectEnvironmentInfo();
      await assertResourceHeadroom(environment);
      const dataset = await createSyntheticDataset();
      const records: BenchmarkRecord[] = [];

      for (const scale of [dataset.small, dataset.medium]) {
        records.push(...(await runScaleBenchmarks(scale)));
      }

      const output = {
        gate: "Performance & Windows Stability Hardening Gate baseline",
        createdAt: new Date().toISOString(),
        boundary: {
          syntheticOnly: true,
          liveProviderCalls: false,
          realProjectSmoke: false,
          largeStressRan: false,
          syntheticRoot: SYNTHETIC_ROOT,
          runtimeCodeModifiedByBaseline: false,
        },
        environment,
        manifest: dataset.manifest,
        records,
      };

      await writeFile(RAW_OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
      await writeFile(
        SUMMARY_OUTPUT_PATH,
        renderBaselineSummary(environment, dataset.manifest, records),
        "utf8",
      );

      expect(records.length).toBeGreaterThan(0);
      expect(records.every((record) => record.iterations === ITERATIONS)).toBe(true);
    },
    180_000,
  );
});

async function runScaleBenchmarks(dataset: ScaleDataset): Promise<BenchmarkRecord[]> {
  const records: BenchmarkRecord[] = [];
  const transcriptText = await readFile(dataset.transcriptPath, "utf8");
  const transcriptEvents = transcriptText
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TranscriptEvent);
  const messages = createModelMessages(transcriptEvents);
  const boundaries = Array.from({ length: dataset.name === "small" ? 8 : 80 }, (_, index) =>
    createManualCompactBoundary({
      preCompactChars: 10_000 + index,
      postCompactChars: 2_000 + index,
      preservedEvidenceRefs: [`ev-${index}`, `ev-${index + 1}`],
      preservedFiles: [`src/file-${index}.ts`],
      handoffPacketId: `handoff-${index}`,
    }),
  );
  const logRegistry: LogArtifactRegistry = {
    workspaceRoot: dataset.root,
    logRoots: [join(dataset.root, "logs")],
    backgrounds: [{ id: `${dataset.name}-log`, outputPath: dataset.logPath }],
    evidence: [{ id: `${dataset.name}-evidence`, source: dataset.logPath }],
  };

  records.push(
    await measureCase(dataset, {
      caseId: `A01-${dataset.name}-resume-hydration`,
      hotspot: "Context / Compact / long transcript resume hydration",
      notes:
        "Offline readJsonl plus provider-message hydration from synthetic transcript; no model request.",
      run: async () => {
        const resumed = await readJsonl<TranscriptEvent>(dataset.transcriptPath);
        const hydrated = createModelMessages(resumed.records);
        const charsEstimate = estimateModelMessagesChars(hydrated);
        return {
          bytesRead: dataset.scale.transcriptBytes ?? 0,
          filesTouched: 1,
          charsEstimate,
          tokensEstimate: estimateTokens(charsEstimate),
          cacheHash: stableHash(hydrated.slice(-20)),
        };
      },
    }),
  );

  records.push(
    await measureCase(dataset, {
      caseId: `A02-${dataset.name}-read-jsonl-full`,
      hotspot: "Context / Transcript / readJsonl() full transcript read",
      notes: "Current readJsonl baseline reads full JSONL text and splits all lines.",
      run: async () => {
        const result = await readJsonl<TranscriptEvent>(dataset.transcriptPath);
        const charsEstimate = estimateTranscriptContextCharsForBenchmark(result.records);
        return {
          bytesRead: dataset.scale.transcriptBytes ?? 0,
          filesTouched: 1,
          charsEstimate,
          tokensEstimate: estimateTokens(charsEstimate),
          cacheHash: stableHash({
            count: result.records.length,
            diagnostics: result.diagnostics.length,
          }),
        };
      },
    }),
  );

  records.push(
    await measureCase(dataset, {
      caseId: `A03-${dataset.name}-micro-compact`,
      hotspot: "Context / Compact / microCompactMessages() refs collection",
      notes:
        "Compacts synthetic tool-heavy provider messages and exercises evidence/file ref collection.",
      run: async () => {
        const result = microCompactMessages(messages, {
          maxChars: dataset.name === "small" ? 24_000 : 90_000,
          preserveRecentMessages: 8,
        });
        const charsEstimate = estimateModelMessagesChars(result.messages);
        return {
          bytesRead: 0,
          filesTouched: 0,
          charsEstimate,
          tokensEstimate: estimateTokens(charsEstimate),
          cacheHash: stableHash(result.boundary ?? result.messages.length),
        };
      },
    }),
  );

  records.push(
    await measureCase(dataset, {
      caseId: `A04-${dataset.name}-compact-boundary-hash`,
      hotspot: "Context / Compact / boundary hash stability",
      notes:
        "Repeated compactBoundaryHash() over synthetic boundaries; cacheHashChanged must stay false.",
      run: async () => {
        const hash = compactBoundaryHash(boundaries);
        return {
          bytesRead: 0,
          filesTouched: 0,
          charsEstimate: JSON.stringify(boundaries).length,
          tokensEstimate: estimateTokens(JSON.stringify(boundaries).length),
          cacheHash: hash,
        };
      },
    }),
  );

  records.push(
    await measureCase(dataset, {
      caseId: `A05-${dataset.name}-provider-message-construction`,
      hotspot: "Context / Provider message construction before model request",
      notes: "Offline createChatRequest() only; no fetch/live provider/API call.",
      run: async () => {
        const provider = new OpenAiCompatibleProvider({
          id: "offline-openai-compatible",
          type: "openai-compatible",
          baseUrl: "https://offline.invalid/v1",
          apiKey: "offline-key",
          model: "offline-model",
          supportsTools: true,
        });
        const request = provider.createChatRequest({
          messages,
          tools: [
            { name: "Read", description: "Read file", inputSchema: { type: "object" } },
            { name: "Grep", description: "Search code", inputSchema: { type: "object" } },
          ],
          toolChoice: "auto",
        });
        const text = JSON.stringify(request);
        return {
          bytesRead: 0,
          filesTouched: 0,
          charsEstimate: text.length,
          tokensEstimate: estimateTokens(text.length),
          cacheHash: stableHash(text),
        };
      },
    }),
  );

  records.push(
    await measureCase(dataset, {
      caseId: `A06-${dataset.name}-handoff-trimmed-context`,
      hotspot: "Context / multi-agent handoff trimmed context assembly",
      notes:
        "Synthetic offline handoff assembly using bounded recent messages and evidence refs; no agent runtime started.",
      run: async () => {
        const handoff = {
          recentMessages: messages.slice(dataset.name === "small" ? -40 : -160),
          evidenceRefs: Array.from(
            { length: dataset.name === "small" ? 20 : 80 },
            (_, index) => `evidence-${index}`,
          ),
          workspaceRefs: Array.from(
            { length: dataset.name === "small" ? 20 : 120 },
            (_, index) => `src/module-${index}.ts`,
          ),
        };
        const text = JSON.stringify(handoff);
        return {
          bytesRead: 0,
          filesTouched: 0,
          charsEstimate: text.length,
          tokensEstimate: estimateTokens(text.length),
          cacheHash: stableHash(text),
        };
      },
    }),
  );

  records.push(
    await measureCase(dataset, {
      caseId: `B01-${dataset.name}-workspace-reference-refresh`,
      hotspot: "Workspace Reference Cache / warmup and repeated refresh",
      notes:
        "Runs miss + repeated refresh against synthetic workspace with bounded metadata/hash summaries.",
      run: async () => {
        const cache = createWorkspaceReferenceCache();
        const input = {
          projectPath: dataset.workspacePath,
          dimensions: dimensions(),
          runtimeStatus: { permissionMode: "default", model: "offline-model" },
          toolCapabilitySummary: "Read/Grep/Glob/Edit/Bash/Todo".repeat(20),
          evidenceRefs: Array.from(
            { length: dataset.name === "small" ? 20 : 120 },
            (_, index) => `ev-${index}`,
          ),
          logRefs: [dataset.logPath],
          watchedFiles: ["README.md", "package.json", ".gitignore", "LINGHUN.md"],
          watchedDirectories: [".", ".linghun"],
          fileHashBytes: 64 * 1024,
        };
        const first = await getWorkspaceReferenceSnapshot(cache, input);
        const second = await getWorkspaceReferenceSnapshot(cache, input);
        return {
          bytesRead: dataset.scale.workspaceFiles ? dataset.scale.workspaceFiles * 512 : 0,
          filesTouched: dataset.scale.workspaceFiles ?? 0,
          charsEstimate: JSON.stringify(second).length,
          tokensEstimate: estimateTokens(JSON.stringify(second).length),
          cacheHash: stableHash({ first: first.key, second: second.key, source: second.source }),
        };
      },
    }),
  );

  records.push(
    await measureCase(dataset, {
      caseId: `B02-${dataset.name}-workspace-reference-injection`,
      hotspot: "Workspace Reference Cache / context injection impact",
      notes: "Measures serialized snapshot injection size and stable hash impact only.",
      run: async () => {
        const cache = createWorkspaceReferenceCache();
        const snapshot = await getWorkspaceReferenceSnapshot(cache, {
          projectPath: dataset.workspacePath,
          dimensions: dimensions({ compactBoundaryHash: compactBoundaryHash(boundaries) }),
          runtimeStatus: { index: { status: "ready" }, background: { count: 2 } },
          toolCapabilitySummary: "capability summary ".repeat(dataset.name === "small" ? 100 : 500),
          evidenceRefs: Array.from(
            { length: dataset.name === "small" ? 20 : 200 },
            (_, index) => `evidence-${index}`,
          ),
          logRefs: [dataset.logPath],
          watchedFiles: ["README.md", "package.json", ".gitignore", "LINGHUN.md"],
          watchedDirectories: ["."],
        });
        const injected = JSON.stringify({ workspaceReference: snapshot });
        return {
          bytesRead: 0,
          filesTouched: dataset.scale.workspaceFiles ?? 0,
          charsEstimate: injected.length,
          tokensEstimate: estimateTokens(injected.length),
          cacheHash: stableHash(injected),
        };
      },
    }),
  );

  for (const request of [
    { suffix: "tail-40", mode: "tail" as const, request: { mode: "tail" as const, lines: 40 } },
    {
      suffix: "grep-error-context-2",
      mode: "grep" as const,
      request: { mode: "grep" as const, pattern: "ERROR", contextLines: 2 },
    },
    { suffix: "errors", mode: "errors" as const, request: { mode: "errors" as const } },
  ]) {
    records.push(
      await measureCase(dataset, {
        caseId: `C01-${dataset.name}-log-${request.suffix}`,
        hotspot: `Log Artifact / details output ${request.suffix}`,
        notes:
          "CRLF/LF and UTF-8 Chinese synthetic log; countLineBreaksBeforeOffset is included when tail window starts after byte 0.",
        run: async () => {
          const slice = await readLogArtifactSlice(
            { backgroundId: `${dataset.name}-log` },
            request.request,
            logRegistry,
          );
          return {
            bytesRead: dataset.scale.logBytes ?? 0,
            filesTouched: 1,
            charsEstimate: slice.content.length,
            tokensEstimate: estimateTokens(slice.content.length),
            cacheHash: stableHash({
              mode: slice.mode,
              lineRange: slice.lineRange,
              content: slice.content,
            }),
          };
        },
      }),
    );
  }

  records.push(
    await measureCase(dataset, {
      caseId: `D01-${dataset.name}-evidence-suffix-lookup`,
      hotspot: "Transcript / Evidence JSONL / details evidence lookup by id or suffix",
      notes:
        "Offline array lookup over synthetic evidence ids; correctness tests cover artifact path guard separately.",
      run: async () => {
        const count = dataset.name === "small" ? 200 : 3_000;
        const evidence = Array.from({ length: count }, (_, index) => ({
          id: `evidence-${dataset.name}-${index.toString(16).padStart(8, "0")}`,
          source: dataset.logPath,
          summary: `summary ${index}`,
        }));
        const target = evidence.at(-1)?.id.slice(-6) ?? "missing";
        const found = evidence.find((item) => item.id === target || item.id.endsWith(target));
        return {
          bytesRead: 0,
          filesTouched: 0,
          charsEstimate: JSON.stringify(found).length,
          tokensEstimate: estimateTokens(JSON.stringify(found).length),
          cacheHash: stableHash(found),
        };
      },
    }),
  );

  records.push(
    await measureCase(dataset, {
      caseId: `E01-${dataset.name}-doctor-status-problems`,
      hotspot: "Doctor / Status / Problems default views",
      notes: "Presenter-only default views; should not eagerly read large logs or reports.",
      run: async () => {
        const view = createReadinessView(dataset.name);
        const doctor = formatTerminalReadinessDoctor(view);
        const status = formatTerminalReadinessStatus(view);
        const problems = formatTerminalProblemsPanel(view);
        const text = [doctor, status, problems].join("\n");
        return {
          bytesRead: 0,
          filesTouched: 0,
          charsEstimate: text.length,
          tokensEstimate: estimateTokens(text.length),
          cacheHash: stableHash(text),
        };
      },
    }),
  );

  records.push(
    await measureCase(dataset, {
      caseId: `E02-${dataset.name}-background-job-views`,
      hotspot: "Background / Job status / Job report default views",
      notes:
        "Parses synthetic job state files and formats bounded background/job summaries without reading full logs.",
      run: async () => {
        const entries = await readdir(dataset.jobsPath, { withFileTypes: true });
        const states = [];
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          states.push(
            JSON.parse(await readFile(join(dataset.jobsPath, entry.name, "state.json"), "utf8")),
          );
        }
        const selected = states.slice(0, dataset.name === "small" ? 20 : 100);
        const text = selected
          .map((job) => {
            const task = job.backgroundTask;
            return [
              formatBackgroundTask(task, "zh-CN"),
              formatBackgroundDetails(task, "zh-CN"),
              formatJobRunnerReportLine(job),
            ].join("\n");
          })
          .join("\n");
        return {
          bytesRead: selected.length * 512,
          filesTouched: entries.length,
          charsEstimate: text.length,
          tokensEstimate: estimateTokens(text.length),
          cacheHash: stableHash({ count: selected.length, text }),
        };
      },
    }),
  );

  records.push(
    await measureCase(dataset, {
      caseId: `E03-${dataset.name}-runner-doctor-fallback`,
      hotspot: "Doctor / Native runner missing/protocol fallback presenter",
      notes: "Presenter-only native runner fallback view; no native runner binary is executed.",
      run: async () => {
        const text = formatRunnerDoctor(
          {
            status: "protocol_mismatch",
            enabled: true,
            source: "bundled",
            pathRef: "<synthetic-runner>",
            bundledCandidateRef: "<synthetic-bundled>",
            version: "0.0.0",
            protocol: "bad-protocol",
            platform: process.platform,
            arch: process.arch,
            platformArch: `${process.platform}-${process.arch}`,
            nodeFallback: "available",
            lastError: "protocol mismatch synthetic corrupt output",
            nextAction: "Use Node/TUI fallback.",
          },
          "linghun-runner-v1",
          (value) => value,
        );
        return {
          bytesRead: 0,
          filesTouched: 0,
          charsEstimate: text.length,
          tokensEstimate: estimateTokens(text.length),
          cacheHash: stableHash(text),
        };
      },
    }),
  );

  records.push(
    await measureCase(dataset, {
      caseId: `F01-${dataset.name}-provider-sse-parser`,
      hotspot: "Provider parser offline / synthetic SSE stream parse with tool-call-like chunks",
      notes: "parseOpenAiStream() over synthetic SSE only; no live provider/API call.",
      run: async () => {
        const text = await readFile(dataset.ssePath, "utf8");
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            for (let offset = 0; offset < text.length; offset += 512) {
              controller.enqueue(encoder.encode(text.slice(offset, offset + 512)));
            }
            controller.close();
          },
        });
        const events = [];
        for await (const event of parseOpenAiStream(body)) {
          events.push(event);
        }
        const charsEstimate = JSON.stringify(events).length;
        return {
          bytesRead: dataset.scale.sseChunks ? dataset.scale.sseChunks * 256 : 0,
          filesTouched: 1,
          charsEstimate,
          tokensEstimate: estimateTokens(charsEstimate),
          cacheHash: stableHash(events),
        };
      },
    }),
  );

  return records;
}

async function measureCase(
  dataset: ScaleDataset,
  options: {
    caseId: string;
    hotspot: string;
    notes: string;
    run: () => Promise<{
      bytesRead: number;
      filesTouched: number;
      charsEstimate: number;
      tokensEstimate: number;
      cacheHash: string;
    }>;
  },
): Promise<BenchmarkRecord> {
  const timings: number[] = [];
  const errors: string[] = [];
  let peakRssMb = rssMb();
  let bytesRead = 0;
  let filesTouched = 0;
  let charsEstimate = 0;
  let tokensEstimate = 0;
  let previousHash: string | undefined;
  let cacheHashChanged = false;
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();

  for (let index = 0; index < WARMUP_RUNS + ITERATIONS; index += 1) {
    await yieldImmediate();
    const startedAt = performance.now();
    try {
      const result = await options.run();
      const elapsed = performance.now() - startedAt;
      peakRssMb = Math.max(peakRssMb, rssMb());
      bytesRead = result.bytesRead;
      filesTouched = result.filesTouched;
      charsEstimate = result.charsEstimate;
      tokensEstimate = result.tokensEstimate;
      if (previousHash !== undefined && previousHash !== result.cacheHash) {
        cacheHashChanged = true;
      }
      previousHash = result.cacheHash;
      if (index >= WARMUP_RUNS) {
        timings.push(elapsed);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      if (index >= WARMUP_RUNS) {
        timings.push(performance.now() - startedAt);
      }
    }
  }

  delay.disable();
  timings.sort((left, right) => left - right);
  const p50Ms = percentile(timings, 0.5);
  const p95Ms = percentile(timings, 0.95);
  return {
    caseId: options.caseId,
    hotspot: options.hotspot,
    inputScale: dataset.scale,
    datasetPath: dataset.root,
    iterations: ITERATIONS,
    warmupRuns: WARMUP_RUNS,
    wallMs: round(timings.reduce((total, value) => total + value, 0)),
    p50Ms: round(p50Ms),
    p95Ms: round(p95Ms),
    minMs: round(timings[0] ?? 0),
    maxMs: round(timings.at(-1) ?? 0),
    peakRssMb: round(peakRssMb),
    eventLoopDelayMs: round(
      Number.isFinite(delay.percentile(95)) ? delay.percentile(95) / 1_000_000 : 0,
    ),
    bytesRead,
    filesTouched,
    charsEstimate,
    tokensEstimate,
    cacheHashChanged,
    errors,
    notes:
      errors.length > 0
        ? `${options.notes} Errors recorded; decision must not claim PASS.`
        : options.notes,
  };
}

async function createSyntheticDataset(): Promise<SyntheticDataset> {
  const runRoot = join(SYNTHETIC_ROOT, `baseline-${SEED}-${Date.now()}`);
  await mkdir(runRoot, { recursive: true });
  const small = await createScaleDataset(runRoot, "small", {
    transcriptMessages: 800,
    logLines: 6_000,
    workspaceDirs: 16,
    workspaceFiles: 120,
    jobCount: 40,
    sseChunks: 500,
  });
  const medium = await createScaleDataset(runRoot, "medium", {
    transcriptMessages: 8_000,
    logLines: 60_000,
    workspaceDirs: 48,
    workspaceFiles: 720,
    jobCount: 260,
    sseChunks: 5_000,
  });
  const paths = [
    await describePath(small.root, "small synthetic dataset"),
    await describePath(medium.root, "medium synthetic dataset"),
  ];
  const manifest: DatasetManifest = {
    seed: SEED,
    root: runRoot,
    createdAt: new Date().toISOString(),
    cleanupStatus: "pending",
    paths,
    totals: {
      files: paths.reduce((total, item) => total + item.files, 0),
      bytes: paths.reduce((total, item) => total + item.bytes, 0),
    },
    generation: { small: small.scale, medium: medium.scale },
  };
  await writeFile(
    join(runRoot, "synthetic-data-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return { root: runRoot, small, medium, manifest };
}

async function createScaleDataset(
  runRoot: string,
  name: "small" | "medium",
  input: Required<
    Pick<
      InputScale,
      | "transcriptMessages"
      | "logLines"
      | "workspaceDirs"
      | "workspaceFiles"
      | "jobCount"
      | "sseChunks"
    >
  >,
): Promise<ScaleDataset> {
  const root = join(runRoot, name);
  const workspacePath = join(root, "项目 含 空格", "Linghun 合成项目");
  const logsPath = join(root, "logs");
  const jobsPath = join(root, "jobs");
  await mkdir(workspacePath, { recursive: true });
  await mkdir(logsPath, { recursive: true });
  await mkdir(jobsPath, { recursive: true });

  const transcriptPath = join(root, "transcript.jsonl");
  const logPath = join(logsPath, "synthetic-output.log");
  const ssePath = join(root, "provider-sse.txt");
  const random = createPrng(SEED + (name === "small" ? 1 : 2));

  await writeSyntheticWorkspace(workspacePath, input, random);
  await writeSyntheticTranscript(transcriptPath, input, random);
  await writeSyntheticLog(logPath, input, random);
  await writeSyntheticJobs(jobsPath, input);
  await writeSyntheticSse(ssePath, input);

  const transcriptBytes = (await stat(transcriptPath)).size;
  const logBytes = (await stat(logPath)).size;
  const scale = {
    ...input,
    transcriptBytes,
    logBytes,
    messageCount: input.transcriptMessages,
  };
  return { name, root, transcriptPath, logPath, workspacePath, jobsPath, ssePath, scale };
}

async function writeSyntheticWorkspace(
  workspacePath: string,
  input: Required<Pick<InputScale, "workspaceDirs" | "workspaceFiles">>,
  random: () => number,
): Promise<void> {
  await mkdir(join(workspacePath, ".linghun"), { recursive: true });
  await writeFile(
    join(workspacePath, "README.md"),
    "# 合成项目\n\n用于 performance gate synthetic benchmark。\n",
    "utf8",
  );
  await writeFile(
    join(workspacePath, "LINGHUN.md"),
    "# 项目规则\n\n只用于 synthetic benchmark。\n",
    "utf8",
  );
  await writeFile(
    join(workspacePath, "package.json"),
    JSON.stringify({ scripts: { test: "vitest" } }),
    "utf8",
  );
  await writeFile(join(workspacePath, ".gitignore"), "dist/\nnode_modules/\n", "utf8");
  await writeFile(join(workspacePath, ".linghun", "settings.json"), "{}\n", "utf8");
  for (let dir = 0; dir < input.workspaceDirs; dir += 1) {
    await mkdir(join(workspacePath, `模块 ${dir}`), { recursive: true });
  }
  for (let file = 0; file < input.workspaceFiles; file += 1) {
    const dir = `模块 ${file % input.workspaceDirs}`;
    const body = Array.from(
      { length: 8 },
      (_, line) =>
        `export const value_${file}_${line} = "中文-${Math.floor(random() * 1_000_000)}";`,
    ).join("\n");
    await writeFile(join(workspacePath, dir, `file-${file}.ts`), `${body}\n`, "utf8");
  }
}

async function writeSyntheticTranscript(
  transcriptPath: string,
  input: Required<Pick<InputScale, "transcriptMessages">>,
  random: () => number,
): Promise<void> {
  const lines: string[] = [];
  for (let index = 0; index < input.transcriptMessages; index += 1) {
    const kind = index % 5;
    if (kind === 0) {
      lines.push(
        JSON.stringify({ type: "user_message", text: repeatSentence(index, 180, random) }),
      );
    } else if (kind === 1) {
      lines.push(
        JSON.stringify({
          type: "assistant_text_delta",
          text: `${repeatSentence(index, 220, random)} evidenceId=\"ev-${index}\"`,
        }),
      );
    } else if (kind === 2) {
      lines.push(
        JSON.stringify({
          type: "tool_call_start",
          toolName: "Read",
          input: {
            path: `src/模块 ${index % 17}/file-${index}.ts`,
            reason: repeatSentence(index, 80, random),
          },
        }),
      );
    } else if (kind === 3) {
      lines.push(
        JSON.stringify({
          type: "tool_result",
          toolName: "Read",
          content: { output: repeatSentence(index, 260, random), evidenceId: `ev-${index}` },
        }),
      );
    } else {
      lines.push(
        JSON.stringify({ type: "system_event", message: repeatSentence(index, 120, random) }),
      );
    }
  }
  await writeFile(transcriptPath, `${lines.join("\n")}\n`, "utf8");
}

async function writeSyntheticLog(
  logPath: string,
  input: Required<Pick<InputScale, "logLines">>,
  random: () => number,
): Promise<void> {
  const lines: string[] = [];
  for (let index = 0; index < input.logLines; index += 1) {
    const prefix = index % 997 === 0 ? "ERROR" : index % 431 === 0 ? "FAIL" : "INFO";
    const newlineProbe = index % 2 === 0 ? "LF" : "CRLF";
    lines.push(
      `${prefix} line=${index} ${newlineProbe} 中文输出 ${Math.floor(random() * 1_000_000)} path=G:\\项目 含 空格\\file-${index}.ts`,
    );
  }
  await writeFile(logPath, lines.join("\r\n"), "utf8");
}

async function writeSyntheticJobs(
  jobsPath: string,
  input: Required<Pick<InputScale, "jobCount">>,
): Promise<void> {
  for (let index = 0; index < input.jobCount; index += 1) {
    const jobDir = join(jobsPath, `job-${index.toString().padStart(4, "0")}`);
    await mkdir(jobDir, { recursive: true });
    const backgroundTask = {
      id: `bg-${index}`,
      kind: "job",
      title: `Synthetic job ${index} with long title for truncation behavior`,
      status: index % 7 === 0 ? "blocked" : "running",
      result: undefined,
      currentStep: `processing synthetic step ${index}`,
      progress: { completed: index % 10, total: 10, label: "steps" },
      nextAction: `/job status job-${index}`,
      userVisibleSummary:
        "Synthetic job summary; logs are artifacts and must not be eagerly dumped.",
      logPath: join(jobDir, "job.log"),
      outputPath: join(jobDir, "output.log"),
      hasOutput: true,
      startedAt: new Date(0).toISOString(),
      updatedAt: new Date(index * 1000).toISOString(),
    };
    const state = {
      id: `job-${index}`,
      status: backgroundTask.status,
      goal: "Synthetic offline job",
      createdAt: backgroundTask.startedAt,
      updatedAt: backgroundTask.updatedAt,
      backgroundTask,
      runner: {
        enabled: false,
        adapter: "node",
        status: "fallback",
        resolution: "disabled",
        nextAction: "Node/TUI fallback",
      },
    };
    await writeFile(join(jobDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await writeFile(join(jobDir, "job.log"), "job log artifact placeholder\n", "utf8");
    await writeFile(join(jobDir, "output.log"), "job output artifact placeholder\n", "utf8");
  }
}

async function writeSyntheticSse(
  ssePath: string,
  input: Required<Pick<InputScale, "sseChunks">>,
): Promise<void> {
  const lines: string[] = [];
  for (let index = 0; index < input.sseChunks; index += 1) {
    if (index % 97 === 0) {
      lines.push(
        `data: ${JSON.stringify({
          id: `chatcmpl-${index}`,
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    id: `call-${index}`,
                    index: 0,
                    type: "function",
                    function: { name: "Read", arguments: `{"path":"src/file-${index}.ts"}` },
                  },
                ],
              },
            },
          ],
        })}\n`,
      );
    } else {
      lines.push(
        `data: ${JSON.stringify({
          id: `chatcmpl-${index}`,
          choices: [{ delta: { content: `chunk-${index}-中文` } }],
        })}\n`,
      );
    }
  }
  lines.push("data: [DONE]\n");
  await writeFile(ssePath, lines.join("\n"), "utf8");
}

function createModelMessages(events: TranscriptEvent[]): ModelMessage[] {
  const messages: ModelMessage[] = [
    { role: "system", content: "Linghun synthetic offline benchmark." },
  ];
  for (const [index, event] of events.entries()) {
    if (event.type === "user_message") {
      messages.push({ role: "user", content: event.text });
    } else if (event.type === "assistant_text_delta") {
      messages.push({ role: "assistant", content: event.text });
    } else if (event.type === "tool_call_start") {
      const toolCallId = `tool-${index}`;
      messages.push({
        role: "assistant",
        content: "",
        toolCalls: [{ id: toolCallId, name: "Read", input: event.input }],
      });
      messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        content: `{"evidenceId":"ev-${index}","path":"src/file-${index}.ts"}`,
      });
    } else if (event.type === "tool_result") {
      messages.push({ role: "assistant", content: JSON.stringify(event.content) });
    }
  }
  return messages;
}

function estimateTranscriptContextCharsForBenchmark(transcript: TranscriptEvent[]): number {
  return transcript.reduce((total, event) => {
    if (event.type === "user_message") return total + event.text.length;
    if (event.type === "assistant_text_delta") return total + event.text.length;
    if (event.type === "tool_call_start") return total + JSON.stringify(event.input).length;
    if (event.type === "tool_result") return total + JSON.stringify(event.content).length;
    return total;
  }, 0);
}

function createReadinessView(scale: "small" | "medium"): TerminalReadinessView {
  const problems = Array.from({ length: scale === "small" ? 4 : 20 }, (_, index) => ({
    source: index % 2 === 0 ? ("project" as const) : ("background" as const),
    severity: index % 3 === 0 ? ("warning" as const) : ("info" as const),
    summary: `synthetic readiness item ${index}; default view should stay bounded`,
    nextAction: "/doctor all",
    detailRef: `synthetic-${index}`,
  }));
  return {
    projectPath: "G:\\linghun-perf-gate\\项目 含 空格",
    provider: "offline-openai-compatible",
    model: "offline-model",
    endpointProfile: "chat_completions",
    permissionMode: "default",
    language: "zh-CN",
    index: { status: "ready", changedFiles: 0 },
    cache: { latestHitRate: 0.92, compacted: scale === "medium", workspaceSnapshot: "ready" },
    memory: { projectRules: "found", candidates: 3, accepted: 2 },
    mcp: { enabled: true, servers: 1, tools: 6, errors: 0 },
    background: { total: scale === "small" ? 4 : 40, running: 0, blocked: 0 },
    verification: { status: "partial", summary: "synthetic only", unverified: 1, risk: 1 },
    freshness: { webSourceEvidence: "missing" },
    projectDoctor: {
      status: "pass",
      packageManager: "pnpm",
      scripts: ["test", "typecheck", "check", "build"],
      configFiles: ["package.json", "tsconfig.json"],
      ciFiles: [],
      projectRules: "found",
      checks: ["vitest", "tsc"],
      unknown: [],
    },
    sourceDrift: {
      status: "pass",
      checked: ["LINGHUN_PHASED_DELIVERY_BLUEPRINT.md", "LINGHUN_IMPLEMENTATION_SPEC.md"],
      issues: [],
      nextAction: "none",
    },
    contextPicker: {
      status: "pass",
      refs: ["README.md", "package.json"],
      evidenceKinds: ["file_read", "command_output"],
      indexFreshness: "fresh",
    },
    rollbackCoach: {
      status: "pass",
      changedFiles: 0,
      untrackedFiles: 0,
      checkpoints: 1,
      gitStatus: "clean",
      mode: "advisory-only",
      nextAction: "/diff",
    },
    costPreview: {
      status: "partial",
      level: scale === "small" ? "light" : "medium",
      labels: ["synthetic", "offline"],
      nextAction: "/usage",
    },
    problems,
  };
}

function dimensions(
  overrides: Partial<WorkspaceReferenceDimensions> = {},
): WorkspaceReferenceDimensions {
  return {
    configHash: "config-a",
    toolSchemaHash: "tools-a",
    providerModelHash: "provider-model-a",
    mcpToolListHash: "mcp-a",
    indexFreshnessHash: "index-a",
    compactBoundaryHash: "compact-a",
    extensionListHash: "extensions-a",
    ...overrides,
  };
}

async function collectEnvironmentInfo(): Promise<EnvironmentInfo> {
  const gDrive = await readDriveSpace(SYNTHETIC_ROOT);
  return {
    node: process.version,
    pnpm: readCommandVersion("corepack", ["pnpm", "--version"]),
    os: `${platform()} ${release()}`,
    platform: process.platform,
    cpuLogicalCores: cpus().length,
    totalMemoryMb: bytesToMb(totalmem()),
    freeMemoryMb: bytesToMb(freemem()),
    gDriveFreeMb: gDrive?.freeMb,
    gDriveTotalMb: gDrive?.totalMb,
    battery: readBatteryStatus(),
  };
}

async function readDriveSpace(
  path: string,
): Promise<{ freeMb: number; totalMb: number } | undefined> {
  try {
    const stats = await statfs(path.slice(0, 3));
    return {
      freeMb: bytesToMb(Number(stats.bavail) * Number(stats.bsize)),
      totalMb: bytesToMb(Number(stats.blocks) * Number(stats.bsize)),
    };
  } catch {
    return undefined;
  }
}

async function assertResourceHeadroom(environment: EnvironmentInfo): Promise<void> {
  const memoryFreeRatio = environment.freeMemoryMb / Math.max(1, environment.totalMemoryMb);
  if (memoryFreeRatio < MIN_FREE_RATIO) {
    throw new Error(`系统内存余量低于 20%：${round(memoryFreeRatio * 100)}%。停止 benchmark。`);
  }
  if (environment.gDriveFreeMb && environment.gDriveTotalMb) {
    const diskFreeRatio = environment.gDriveFreeMb / Math.max(1, environment.gDriveTotalMb);
    if (diskFreeRatio < MIN_FREE_RATIO) {
      throw new Error(`G 盘剩余空间低于 20%：${round(diskFreeRatio * 100)}%。停止 benchmark。`);
    }
  }
  await mkdir(SYNTHETIC_ROOT, { recursive: true });
}

function readCommandVersion(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    if (command === "corepack" && args[0] === "pnpm") {
      try {
        return execFileSync("pnpm", ["--version"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      } catch {
        return process.env.npm_config_user_agent?.match(/pnpm\/([^\s]+)/u)?.[1] ?? "unknown";
      }
    }
    return "unknown";
  }
}

function readBatteryStatus(): string {
  if (process.platform !== "win32") return "unknown";
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Battery | Select-Object -First 1 -ExpandProperty BatteryStatus",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (!output) return "unknown/no-battery";
    return output === "2" ? "AC" : `battery-status-${output}`;
  } catch {
    return "unknown";
  }
}

async function describePath(
  path: string,
  description: string,
): Promise<{ path: string; files: number; bytes: number; description: string }> {
  const totals = await countFilesAndBytes(path);
  return { path, files: totals.files, bytes: totals.bytes, description };
}

async function countFilesAndBytes(path: string): Promise<{ files: number; bytes: number }> {
  const info = await stat(path);
  if (info.isFile()) return { files: 1, bytes: info.size };
  if (!info.isDirectory()) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = await countFilesAndBytes(join(path, entry.name));
    files += child.files;
    bytes += child.bytes;
  }
  return { files, bytes };
}

function renderBaselineSummary(
  environment: EnvironmentInfo,
  manifest: DatasetManifest,
  records: BenchmarkRecord[],
): string {
  const rows = records
    .map((record) =>
      [
        record.caseId,
        record.hotspot,
        formatScale(record.inputScale),
        record.iterations,
        record.warmupRuns,
        record.p50Ms,
        record.p95Ms,
        record.minMs,
        record.maxMs,
        record.peakRssMb,
        record.eventLoopDelayMs,
        record.bytesRead,
        record.filesTouched,
        record.charsEstimate,
        record.tokensEstimate,
        record.cacheHashChanged,
        record.errors.length ? record.errors.join("; ").replaceAll("|", "\\|") : "none",
        record.notes.replaceAll("|", "\\|"),
      ].join(" | "),
    )
    .join("\n");
  return `# Performance & Windows Stability Hardening Gate Baseline\n\n## Scope\n\n- synthetic/offline baseline only: yes\n- live provider/API call: no\n- real project smoke: no\n- large/G drive stress: not run in baseline\n- runtime code behavior changed by baseline: no\n- synthetic root: ${SYNTHETIC_ROOT}\n- raw data: ${RAW_OUTPUT_PATH}\n\n## Environment\n\n| field | value |\n| --- | --- |\n| node | ${environment.node} |\n| pnpm | ${environment.pnpm} |\n| os | ${environment.os} |\n| cpu logical cores | ${environment.cpuLogicalCores} |\n| total memory MB | ${environment.totalMemoryMb} |\n| free memory MB | ${environment.freeMemoryMb} |\n| G drive free MB | ${environment.gDriveFreeMb ?? "unknown"} |\n| G drive total MB | ${environment.gDriveTotalMb ?? "unknown"} |\n| battery/AC | ${environment.battery} |\n\n## Synthetic Data Manifest\n\n- seed: ${manifest.seed}\n- root: ${manifest.root}\n- generated files: ${manifest.totals.files}\n- generated bytes: ${manifest.totals.bytes}\n- cleanup status: ${manifest.cleanupStatus}\n\n| path | files | bytes | description |\n| --- | ---: | ---: | --- |\n${manifest.paths.map((item) => `| ${item.path} | ${item.files} | ${item.bytes} | ${item.description} |`).join("\n")}\n\n## Baseline Table\n\n| caseId | hotspot | inputScale | iterations | warmupRuns | p50Ms | p95Ms | minMs | maxMs | peakRssMb | eventLoopDelayMs | bytesRead | filesTouched | charsEstimate | tokensEstimate | cacheHashChanged | errors | notes |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |\n${rows}\n\n## Data Quality Notes\n\n- 每个 case 都有 warmup + ${ITERATIONS} 次 iteration，并记录 p50/p95/min/max。\n- correctness tests 与 benchmark 分开；本文件只记录 synthetic baseline 数值。\n- large stress 未运行；不能把本 synthetic baseline 写成真实项目 smoke。\n- 若后续优化建议没有绑定 caseId 和数据，本 gate 必须裁决 DEFERRED / NOT-DO。\n`;
}

function formatScale(scale: InputScale): string {
  return Object.entries(scale)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function createPrng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function repeatSentence(index: number, minLength: number, random: () => number): string {
  const parts: string[] = [];
  while (parts.join(" ").length < minLength) {
    parts.push(
      `中文片段-${index}-${Math.floor(random() * 1_000_000)} path=src/file-${index % 200}.ts`,
    );
  }
  return parts.join(" ");
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function percentile(values: number[], target: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * target) - 1);
  return values[index] ?? 0;
}

function rssMb(): number {
  return bytesToMb(process.memoryUsage().rss);
}

function bytesToMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function cleanupSyntheticDataFromBaselineRaw(): Promise<void> {
  const raw = JSON.parse(await readFile(RAW_OUTPUT_PATH, "utf8")) as { manifest: DatasetManifest };
  for (const item of raw.manifest.paths) {
    const resolved = resolve(item.path);
    const allowedRoot = resolve(SYNTHETIC_ROOT);
    if (!resolved.startsWith(allowedRoot)) {
      throw new Error(`拒绝清理非 synthetic root 路径：${resolved}`);
    }
    await rm(resolved, { recursive: true, force: true });
  }
}
