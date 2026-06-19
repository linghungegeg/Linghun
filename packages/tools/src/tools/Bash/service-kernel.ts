import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as connectTcp } from "node:net";
import type { ToolChildProcessTrackOptions, ToolContext, ToolOutput } from "../../index.js";

export type BashServiceReadiness =
  | {
      type: "tcp";
      port: number;
      host?: string;
      timeoutMs?: number;
      intervalMs?: number;
    }
  | {
      type: "http";
      url: string;
      timeoutMs?: number;
      intervalMs?: number;
    };

type BashServiceStartInput = {
  command: string;
  logCommand: string;
  cwd: string;
  fullOutputPath: string;
  readiness: BashServiceReadiness;
  abortSignal?: AbortSignal;
  onProgress?: (stream: "stdout" | "stderr" | "system", text: string) => void;
  trackChildProcess?: ToolContext["trackChildProcess"];
  sanitizeText: (text: string) => string;
};

type ServiceDiagnostic = {
  type: "service_readiness";
  severity: "recoverable" | "blocking";
  evidence: string;
  suggestion: string;
};

type ServiceReadyResult = {
  ok: boolean;
  evidence: string;
  elapsedMs: number;
};

const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_READY_INTERVAL_MS = 100;
const CONNECT_ATTEMPT_TIMEOUT_MS = 500;

export async function startBashService(input: BashServiceStartInput): Promise<ToolOutput> {
  const startedAt = Date.now();
  const detached = process.platform !== "win32";
  const child = spawn(input.command, {
    cwd: input.cwd,
    shell: true,
    windowsHide: true,
    detached,
  });
  const log = createWriteStream(input.fullOutputPath, { flags: "w" });
  let closed = false;
  let exitCode: number | null = null;
  let signalCode: NodeJS.Signals | null = null;
  let lastOutput = "";
  let logClosed = false;

  const writeLog = (stream: "stdout" | "stderr" | "system", text: string) => {
    const sanitized = input.sanitizeText(text);
    lastOutput = `${lastOutput}${sanitized}`.slice(-2_000);
    if (!logClosed) {
      log.write(`[${stream}] ${sanitized}`);
      input.onProgress?.(stream, text);
    }
  };

  log.write(`$ ${input.sanitizeText(input.logCommand)}\n`);
  log.write(`service cwd ${input.cwd}\n`);
  child.stdout?.on("data", (chunk: Buffer) => writeLog("stdout", chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => writeLog("stderr", chunk.toString("utf8")));
  child.on("close", (code, signal) => {
    closed = true;
    exitCode = code;
    signalCode = signal;
    if (!logClosed) {
      log.write(`\nservice process closed exitCode=${code ?? "null"} signal=${signal ?? "null"}\n`);
    }
  });
  child.on("error", (error) => {
    closed = true;
    exitCode = 1;
    writeLog("system", `service spawn error: ${error.message}\n`);
  });

  const trackOptions: ToolChildProcessTrackOptions = {
    detached,
    cwd: input.cwd,
    label: `BashService:${input.command.slice(0, 80)}`,
    retainAfterExit: true,
  };
  input.trackChildProcess?.(child, trackOptions);

  const abort = () => {
    writeLog("system", "service start cancelled; terminating process.\n");
    child.kill();
  };
  input.abortSignal?.addEventListener("abort", abort, { once: true });

  const ready = await waitForReadiness(input.readiness, () => ({
    closed,
    exitCode,
    signalCode,
    lastOutput,
  }));
  input.abortSignal?.removeEventListener("abort", abort);
  logClosed = true;
  log.end(() => {
    logClosed = true;
  });

  const pid = child.pid;
  const alive = isChildAlive(child, closed);
  const readinessTarget = formatReadinessTarget(input.readiness);
  const diagnostics = ready.ok
    ? []
    : [
        createServiceReadinessDiagnostic(
          ready.evidence,
          alive
            ? "Service process is running but readiness did not pass; inspect the log and retry bounded readiness checks."
            : "Service process exited before readiness; inspect the log before retrying.",
        ),
      ];
  const text = [
    ready.ok ? "Service started and ready." : "Service readiness failed.",
    `pid ${pid ?? "unknown"}`,
    `cwd ${input.cwd}`,
    `ready ${readinessTarget}`,
    `alive ${alive ? "yes" : "no"}`,
    `elapsedMs ${Date.now() - startedAt}`,
    `log ${input.fullOutputPath}`,
    ready.evidence ? `evidence ${ready.evidence}` : "",
  ].filter(Boolean).join("\n");

  return {
    text,
    details: [
      `fullOutputPath: ${input.fullOutputPath}`,
      `command: ${input.sanitizeText(input.logCommand)}`,
      `pid: ${pid ?? "unknown"}`,
      `cwd: ${input.cwd}`,
      `ready: ${readinessTarget}`,
      `alive: ${alive ? "yes" : "no"}`,
      `evidence: ${ready.evidence}`,
    ].join("\n"),
    data: {
      exitCode: ready.ok ? 0 : 1,
      outcome: ready.ok ? "service_ready" : alive ? "service_not_ready" : "service_exited",
      service: {
        pid,
        command: input.logCommand,
        cwd: input.cwd,
        logPath: input.fullOutputPath,
        alive,
        readiness: {
          ok: ready.ok,
          target: readinessTarget,
          elapsedMs: ready.elapsedMs,
          evidence: ready.evidence,
        },
      },
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    },
    fullOutputPath: input.fullOutputPath,
  };
}

async function waitForReadiness(
  readiness: BashServiceReadiness,
  processState: () => {
    closed: boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    lastOutput: string;
  },
): Promise<ServiceReadyResult> {
  const startedAt = Date.now();
  const timeoutMs = readiness.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const intervalMs = readiness.intervalMs ?? DEFAULT_READY_INTERVAL_MS;
  const deadline = startedAt + timeoutMs;
  let lastEvidence = "";

  while (Date.now() <= deadline) {
    const state = processState();
    if (state.closed) {
      return {
        ok: false,
        evidence: `service process exited before readiness exitCode=${state.exitCode ?? "null"} signal=${state.signalCode ?? "null"} tail=${state.lastOutput.replace(/\s+/gu, " ").trim()}`,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const probe = readiness.type === "tcp"
      ? await probeTcp(readiness.host ?? "127.0.0.1", readiness.port)
      : await probeHttp(readiness.url);
    if (probe.ok) {
      return { ok: true, evidence: probe.evidence, elapsedMs: Date.now() - startedAt };
    }
    lastEvidence = probe.evidence;
    await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }

  return {
    ok: false,
    evidence: `readiness timed out after ${timeoutMs}ms: ${lastEvidence || formatReadinessTarget(readiness)}`,
    elapsedMs: Date.now() - startedAt,
  };
}

function probeTcp(host: string, port: number): Promise<{ ok: boolean; evidence: string }> {
  return new Promise((resolve) => {
    const socket = connectTcp({ host, port });
    const finish = (ok: boolean, evidence: string) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({ ok, evidence });
    };
    socket.setTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);
    socket.once("connect", () => finish(true, `tcp ${host}:${port} accepted connection`));
    socket.once("timeout", () => finish(false, `tcp ${host}:${port} connection timed out`));
    socket.once("error", (error) => finish(false, `tcp ${host}:${port} failed: ${error.message}`));
  });
}

function probeHttp(url: string): Promise<{ ok: boolean; evidence: string }> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, evidence: `invalid health url: ${url}` });
      return;
    }
    const request = (parsed.protocol === "https:" ? httpsRequest : httpRequest)(
      parsed,
      { method: "GET", timeout: CONNECT_ATTEMPT_TIMEOUT_MS },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 0;
        resolve({
          ok: status >= 200 && status < 400,
          evidence: `http ${url} status ${status}`,
        });
      },
    );
    request.once("timeout", () => {
      request.destroy();
      resolve({ ok: false, evidence: `http ${url} timed out` });
    });
    request.once("error", (error) => resolve({ ok: false, evidence: `http ${url} failed: ${error.message}` }));
    request.end();
  });
}

function isChildAlive(child: ChildProcess, closed: boolean): boolean {
  return !closed && child.exitCode === null && child.signalCode === null;
}

function createServiceReadinessDiagnostic(evidence: string, suggestion: string): ServiceDiagnostic {
  return {
    type: "service_readiness",
    severity: "recoverable",
    evidence,
    suggestion,
  };
}

function formatReadinessTarget(readiness: BashServiceReadiness): string {
  if (readiness.type === "tcp") {
    return `tcp://${readiness.host ?? "127.0.0.1"}:${readiness.port}`;
  }
  return readiness.url;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
