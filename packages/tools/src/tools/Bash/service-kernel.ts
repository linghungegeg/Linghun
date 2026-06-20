import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as connectTcp } from "node:net";
import { randomUUID } from "node:crypto";
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

export type BashServiceLifecycleAction =
  | { action: "status"; serviceId: string }
  | { action: "probe"; serviceId: string }
  | { action: "logs"; serviceId: string; tailBytes?: number }
  | { action: "stop"; serviceId: string }
  | {
      action: "fetch";
      url: string;
      expectStatus?: number;
      bodyContains?: string | string[];
      timeoutMs?: number;
      retry?: number;
      intervalMs?: number;
    };

export type BashServiceInput = BashServiceReadiness | BashServiceLifecycleAction;

export type BashManagedServiceStatus =
  | "starting"
  | "ready"
  | "not_ready"
  | "exited"
  | "stopped"
  | "error";

export type BashManagedServiceRecord = {
  serviceId: string;
  pid?: number;
  cwd: string;
  command: string;
  logPath: string;
  target?: string;
  targetHost?: string;
  targetPort?: number;
  readiness: BashServiceReadiness;
  ready: boolean;
  startedAt: string;
  updatedAt: string;
  lastProbeAt?: string;
  lastOutputTail: string;
  status: BashManagedServiceStatus;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  process?: ChildProcess;
  detached?: boolean;
};

type BashServiceStartInput = {
  command: string;
  logCommand: string;
  cwd: string;
  fullOutputPath: string;
  readiness: BashServiceReadiness;
  context: ToolContext;
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
  target?: string;
  targetHost?: string;
  targetPort?: number;
};

type ServiceReadyResult = {
  ok: boolean;
  evidence: string;
  elapsedMs: number;
};

const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_READY_INTERVAL_MS = 100;
const CONNECT_ATTEMPT_TIMEOUT_MS = 500;
const FETCH_BODY_LIMIT_BYTES = 64_000;
const MAX_MANAGED_SERVICES = 20;
const DEFAULT_LOG_TAIL_BYTES = 4_000;
const STOP_TERM_WAIT_MS = 900;
const STOP_KILL_WAIT_MS = 500;

export async function startBashService(input: BashServiceStartInput): Promise<ToolOutput> {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const serviceId = `svc_${randomUUID()}`;
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
  const targetFields = readReadinessTargetFields(input.readiness);
  const serviceRecord: BashManagedServiceRecord = {
    serviceId,
    pid: child.pid,
    cwd: input.cwd,
    command: input.logCommand,
    logPath: input.fullOutputPath,
    ...targetFields,
    readiness: input.readiness,
    ready: false,
    startedAt: startedAtIso,
    updatedAt: startedAtIso,
    lastOutputTail: "",
    status: "starting",
    process: child,
    detached,
  };
  rememberManagedService(input.context, serviceRecord);

  const writeLog = (stream: "stdout" | "stderr" | "system", text: string) => {
    const sanitized = input.sanitizeText(text);
    lastOutput = `${lastOutput}${sanitized}`.slice(-2_000);
    updateManagedService(serviceRecord, {
      lastOutputTail: lastOutput,
    });
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
    updateManagedService(serviceRecord, {
      ready: false,
      status: serviceRecord.status === "stopped" ? "stopped" : "exited",
      exitCode: code,
      signalCode: signal,
    });
    if (!logClosed) {
      log.write(`\nservice process closed exitCode=${code ?? "null"} signal=${signal ?? "null"}\n`);
    }
  });
  child.on("error", (error) => {
    closed = true;
    exitCode = 1;
    updateManagedService(serviceRecord, { ready: false, status: "error", exitCode: 1 });
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
  updateManagedService(serviceRecord, {
    ready: ready.ok,
    status: ready.ok ? "ready" : alive ? "not_ready" : "exited",
    lastProbeAt: new Date().toISOString(),
  });
  const diagnostics = ready.ok
    ? []
    : [
        createServiceReadinessDiagnostic(
          ready.evidence,
          alive
            ? "Service process is running but readiness did not pass; inspect the log and retry bounded readiness checks."
            : "Service process exited before readiness; inspect the log before retrying.",
          targetFields,
        ),
      ];
  const text = [
    ready.ok ? "Service started and ready." : "Service readiness failed.",
    `serviceId ${serviceId}`,
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
      `serviceId: ${serviceId}`,
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
        serviceId,
        pid,
        command: input.logCommand,
        cwd: input.cwd,
        logPath: input.fullOutputPath,
        status: ready.ok ? "ready" : alive ? "not_ready" : "exited",
        ready: ready.ok,
        target: targetFields.target,
        targetHost: targetFields.targetHost,
        targetPort: targetFields.targetPort,
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

export async function runBashServiceLifecycleAction(
  action: BashServiceLifecycleAction,
  context: ToolContext,
): Promise<ToolOutput> {
  if (action.action === "fetch") {
    return runServiceFetchCheck(action);
  }
  const service = findManagedService(context, action.serviceId);
  if (!service) {
    return serviceActionOutput({
      action: action.action,
      serviceId: action.serviceId,
      outcome: "service_missing",
      text: `Service ${action.serviceId} is not registered by Linghun.`,
      service: { serviceId: action.serviceId, status: "missing", ready: false },
    });
  }

  if (action.action === "status") {
    refreshManagedServiceStatus(service);
    return serviceActionOutput({
      action: action.action,
      serviceId: service.serviceId,
      outcome: service.status === "ready" ? "service_ready" : `service_${service.status}`,
      text: formatServiceStatusText(service),
      service: serializeManagedService(service),
    });
  }

  if (action.action === "probe") {
    refreshManagedServiceStatus(service);
    const probe = service.status === "exited" || service.status === "stopped"
      ? { ok: false, evidence: `service ${service.serviceId} is ${service.status}` }
      : await probeReadiness(service.readiness);
    updateManagedService(service, {
      ready: probe.ok,
      status: probe.ok ? "ready" : service.status === "exited" || service.status === "stopped" ? service.status : "not_ready",
      lastProbeAt: new Date().toISOString(),
    });
    const diagnostics = probe.ok
      ? []
      : [
          createServiceReadinessDiagnostic(
            probe.evidence,
            "Service lifecycle probe did not pass; inspect logs or stop/restart the registered service.",
            service,
          ),
        ];
    return serviceActionOutput({
      action: action.action,
      serviceId: service.serviceId,
      outcome: probe.ok ? "service_ready" : "service_not_ready",
      text: [
        `Service probe ${probe.ok ? "ready" : "not-ready"}.`,
        `serviceId ${service.serviceId}`,
        `target ${service.target ?? formatReadinessTarget(service.readiness)}`,
        `evidence ${probe.evidence}`,
      ].join("\n"),
      service: { ...serializeManagedService(service), evidence: probe.evidence },
      diagnostics,
    });
  }

  if (action.action === "logs") {
    const tail = await readServiceTail(service, action.tailBytes ?? DEFAULT_LOG_TAIL_BYTES);
    return serviceActionOutput({
      action: action.action,
      serviceId: service.serviceId,
      outcome: "service_logs",
      text: [
        `Service logs tail.`,
        `serviceId ${service.serviceId}`,
        `status ${service.status}`,
        tail ? `tail\n${tail}` : "tail <empty>",
      ].join("\n"),
      service: { ...serializeManagedService(service), logTail: tail },
    });
  }

  refreshManagedServiceStatus(service);
  if (service.status === "exited" || service.status === "stopped") {
    return serviceActionOutput({
      action: action.action,
      serviceId: service.serviceId,
      outcome: `service_${service.status}`,
      text: `Service ${service.serviceId} is already ${service.status}.`,
      service: serializeManagedService(service),
    });
  }
  const stop = await stopManagedService(service);
  refreshManagedServiceStatus(service);
  if (!stop.stopped) {
    updateManagedService(service, { ready: false, status: "not_ready" });
    return serviceActionOutput({
      action: action.action,
      serviceId: service.serviceId,
      outcome: "service_stop_failed",
      text: [
        "Service stop failed.",
        `serviceId ${service.serviceId}`,
        `pid ${service.pid ?? "unknown"}`,
        `evidence ${stop.evidence}`,
      ].join("\n"),
      service: { ...serializeManagedService(service), evidence: stop.evidence },
      diagnostics: [
        createServiceReadinessDiagnostic(
          stop.evidence,
          "Linghun could not confirm that the registered service stopped; inspect the process before retrying.",
          service,
        ),
      ],
    });
  }
  updateManagedService(service, { ready: false, status: "stopped" });
  return serviceActionOutput({
    action: action.action,
    serviceId: service.serviceId,
    outcome: "service_stopped",
    text: [
      "Service stopped.",
      `serviceId ${service.serviceId}`,
      `pid ${service.pid ?? "unknown"}`,
    ].join("\n"),
    service: serializeManagedService(service),
  });
}

async function runServiceFetchCheck(
  action: Extract<BashServiceLifecycleAction, { action: "fetch" }>,
): Promise<ToolOutput> {
  const startedAt = Date.now();
  const retry = Math.max(0, Math.min(action.retry ?? 0, 10));
  const intervalMs = Math.max(0, Math.min(action.intervalMs ?? DEFAULT_READY_INTERVAL_MS, 5_000));
  let result: HttpFetchResult = { ok: false, evidence: `http ${action.url} not attempted`, body: "" };
  for (let attempt = 0; attempt <= retry; attempt += 1) {
    result = await fetchHttp(action.url, action.timeoutMs ?? CONNECT_ATTEMPT_TIMEOUT_MS);
    const statusOk = action.expectStatus === undefined
      ? result.status !== undefined && result.status >= 200 && result.status < 400
      : result.status === action.expectStatus;
    const requiredBody = normalizeStringList(action.bodyContains);
    const missingBody = requiredBody.filter((item) => !result.body.includes(item));
    if (result.ok && statusOk && missingBody.length === 0) {
      return serviceFetchOutput(action, result, [], Date.now() - startedAt, missingBody);
    }
    result = {
      ...result,
      ok: false,
      evidence: [
        result.evidence,
        statusOk ? "" : `expected status ${action.expectStatus ?? "2xx/3xx"}`,
        missingBody.length > 0 ? `missing body ${missingBody.join(", ")}` : "",
      ].filter(Boolean).join("; "),
    };
    if (attempt < retry) await delay(intervalMs);
  }
  const target = readReadinessTargetFields({ type: "http", url: action.url });
  return serviceFetchOutput(
    action,
    result,
    [
      createServiceReadinessDiagnostic(
        result.evidence,
        "Explicit service fetch check failed; inspect the registered service or served index before final verification.",
        target,
      ),
    ],
    Date.now() - startedAt,
    normalizeStringList(action.bodyContains).filter((item) => !result.body.includes(item)),
  );
}

type HttpFetchResult = {
  ok: boolean;
  evidence: string;
  status?: number;
  body: string;
};

function fetchHttp(url: string, timeoutMs: number): Promise<HttpFetchResult> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, evidence: `invalid fetch url: ${url}`, body: "" });
      return;
    }
    const request = (parsed.protocol === "https:" ? httpsRequest : httpRequest)(
      parsed,
      { method: "GET", timeout: Math.max(1, timeoutMs) },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          if (size >= FETCH_BODY_LIMIT_BYTES) return;
          const remaining = FETCH_BODY_LIMIT_BYTES - size;
          chunks.push(chunk.subarray(0, remaining));
          size += Math.min(chunk.length, remaining);
        });
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: status >= 200 && status < 400,
            status,
            body,
            evidence: `http ${url} status ${status}`,
          });
        });
      },
    );
    request.once("timeout", () => {
      request.destroy();
      resolve({ ok: false, evidence: `http ${url} timed out`, body: "" });
    });
    request.once("error", (error) => resolve({ ok: false, evidence: `http ${url} failed: ${error.message}`, body: "" }));
    request.end();
  });
}

function serviceFetchOutput(
  action: Extract<BashServiceLifecycleAction, { action: "fetch" }>,
  result: HttpFetchResult,
  diagnostics: ServiceDiagnostic[],
  elapsedMs: number,
  missingBody: string[],
): ToolOutput {
  const target = readReadinessTargetFields({ type: "http", url: action.url });
  return {
    text: [
      `Service fetch ${diagnostics.length === 0 ? "ready" : "not-ready"}.`,
      `target ${action.url}`,
      `status ${result.status ?? "unknown"}`,
      `elapsedMs ${elapsedMs}`,
      `evidence ${result.evidence}`,
      missingBody.length > 0 ? `missingBody ${missingBody.join(", ")}` : "",
    ].filter(Boolean).join("\n"),
    data: {
      exitCode: diagnostics.length === 0 ? 0 : 1,
      outcome: diagnostics.length === 0 ? "service_ready" : "service_not_ready",
      service: {
        ...target,
        ready: diagnostics.length === 0,
        status: diagnostics.length === 0 ? "ready" : "not_ready",
        fetch: {
          status: result.status,
          expectedStatus: action.expectStatus,
          bodyContains: normalizeStringList(action.bodyContains),
          missingBody,
        },
      },
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    },
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

function probeReadiness(readiness: BashServiceReadiness): Promise<{ ok: boolean; evidence: string }> {
  return readiness.type === "tcp"
    ? probeTcp(readiness.host ?? "127.0.0.1", readiness.port)
    : probeHttp(readiness.url);
}

function isChildAlive(child: ChildProcess, closed: boolean): boolean {
  return !closed && child.exitCode === null && child.signalCode === null;
}

function createServiceReadinessDiagnostic(
  evidence: string,
  suggestion: string,
  target?: Partial<Pick<BashManagedServiceRecord, "target" | "targetHost" | "targetPort">>,
): ServiceDiagnostic {
  return {
    type: "service_readiness",
    severity: "recoverable",
    evidence,
    suggestion,
    ...(target?.target ? { target: target.target } : {}),
    ...(target?.targetHost ? { targetHost: target.targetHost } : {}),
    ...(target?.targetPort !== undefined ? { targetPort: target.targetPort } : {}),
  };
}

function formatReadinessTarget(readiness: BashServiceReadiness): string {
  if (readiness.type === "tcp") {
    return `tcp://${readiness.host ?? "127.0.0.1"}:${readiness.port}`;
  }
  return readiness.url;
}

function readReadinessTargetFields(
  readiness: BashServiceReadiness,
): Partial<Pick<BashManagedServiceRecord, "target" | "targetHost" | "targetPort">> {
  if (readiness.type === "tcp") {
    const host = readiness.host ?? "127.0.0.1";
    return {
      target: `${host}:${readiness.port}`,
      targetHost: host,
      targetPort: readiness.port,
    };
  }
  try {
    const url = new URL(readiness.url);
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    return {
      target: readiness.url,
      targetHost: url.hostname,
      targetPort: Number.isInteger(port) ? port : undefined,
    };
  } catch {
    return { target: readiness.url };
  }
}

function rememberManagedService(context: ToolContext, record: BashManagedServiceRecord): void {
  context.services = [
    record,
    ...(context.services ?? []).filter((item) => item.serviceId !== record.serviceId),
  ].slice(0, MAX_MANAGED_SERVICES);
}

function findManagedService(context: ToolContext, serviceId: string): BashManagedServiceRecord | undefined {
  return (context.services ?? []).find((service) => service.serviceId === serviceId);
}

function updateManagedService(
  service: BashManagedServiceRecord,
  patch: Partial<BashManagedServiceRecord>,
): void {
  Object.assign(service, patch, { updatedAt: new Date().toISOString() });
}

function refreshManagedServiceStatus(service: BashManagedServiceRecord): void {
  if (service.status === "stopped") return;
  if (service.process && !isChildAlive(service.process, service.status === "exited")) {
    updateManagedService(service, {
      ready: false,
      status: "exited",
      exitCode: service.process.exitCode,
      signalCode: service.process.signalCode,
    });
  }
}

function serializeManagedService(service: BashManagedServiceRecord): Record<string, unknown> {
  const alive = service.process ? isChildAlive(service.process, service.status === "exited") : false;
  return {
    serviceId: service.serviceId,
    pid: service.pid,
    cwd: service.cwd,
    command: service.command,
    logPath: service.logPath,
    target: service.target,
    targetHost: service.targetHost,
    targetPort: service.targetPort,
    readiness: {
      type: service.readiness.type,
      target: formatReadinessTarget(service.readiness),
    },
    ready: service.ready,
    alive,
    status: service.status,
    startedAt: service.startedAt,
    updatedAt: service.updatedAt,
    lastProbeAt: service.lastProbeAt,
    lastOutputTail: service.lastOutputTail,
    exitCode: service.exitCode,
    signalCode: service.signalCode,
  };
}

function formatServiceStatusText(service: BashManagedServiceRecord): string {
  return [
    `Service status ${service.status}.`,
    `serviceId ${service.serviceId}`,
    `pid ${service.pid ?? "unknown"}`,
    `ready ${service.ready ? "yes" : "no"}`,
    `target ${service.target ?? formatReadinessTarget(service.readiness)}`,
    `log ${service.logPath}`,
  ].join("\n");
}

function serviceActionOutput(input: {
  action: string;
  serviceId: string;
  outcome: string;
  text: string;
  service: Record<string, unknown>;
  diagnostics?: ServiceDiagnostic[];
}): ToolOutput {
  return {
    text: input.text,
    details: input.text,
    data: {
      exitCode: input.diagnostics && input.diagnostics.length > 0 ? 1 : 0,
      outcome: input.outcome,
      service: input.service,
      ...(input.diagnostics && input.diagnostics.length > 0 ? { diagnostics: input.diagnostics } : {}),
    },
  };
}

async function readServiceTail(service: BashManagedServiceRecord, tailBytes: number): Promise<string> {
  const boundedBytes = Math.max(1, Math.min(tailBytes, 16_000));
  let diskTail = "";
  try {
    const text = await readFile(service.logPath, "utf8");
    diskTail = text.slice(-boundedBytes);
  } catch {
    diskTail = "";
  }
  const combined = `${diskTail}${service.lastOutputTail ? `\n${service.lastOutputTail}` : ""}`;
  return combined.replace(/\0/g, "").slice(-boundedBytes);
}

async function stopManagedService(service: BashManagedServiceRecord): Promise<{ stopped: boolean; evidence: string }> {
  if (process.platform === "win32" && service.pid) {
    await taskkillWindowsPid(service.pid);
    const stopped = await waitForServiceExit(service, STOP_KILL_WAIT_MS);
    return {
      stopped,
      evidence: stopped ? `taskkill confirmed service ${service.serviceId} stopped` : `taskkill did not confirm service ${service.serviceId} stopped`,
    };
  }
  if (service.detached && service.pid) {
    try {
      process.kill(-service.pid, "SIGTERM");
      if (await waitForServiceExit(service, STOP_TERM_WAIT_MS)) {
        return { stopped: true, evidence: `SIGTERM process group ${service.pid} confirmed stopped` };
      }
    } catch {
      // fall through to direct child termination
    }
  } else {
    service.process?.kill("SIGTERM");
    if (await waitForServiceExit(service, STOP_TERM_WAIT_MS)) {
      return { stopped: true, evidence: `SIGTERM pid ${service.pid ?? "unknown"} confirmed stopped` };
    }
  }
  if (service.detached && service.pid) {
    try {
      process.kill(-service.pid, "SIGKILL");
    } catch {
      service.process?.kill("SIGKILL");
    }
  } else {
    service.process?.kill("SIGKILL");
  }
  if (await waitForServiceExit(service, STOP_KILL_WAIT_MS)) {
    return { stopped: true, evidence: `SIGKILL pid ${service.pid ?? "unknown"} confirmed stopped` };
  }
  return { stopped: false, evidence: `service ${service.serviceId} still appears alive after SIGTERM/SIGKILL` };
}

async function waitForServiceExit(service: BashManagedServiceRecord, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    refreshManagedServiceStatus(service);
    if (service.status === "exited" || service.status === "stopped") return true;
    if (!service.process || !isChildAlive(service.process, false)) return true;
    await delay(50);
  }
  refreshManagedServiceStatus(service);
  return service.status === "exited" || service.status === "stopped" ||
    !service.process || !isChildAlive(service.process, false);
}

function taskkillWindowsPid(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
    const timeout = setTimeout(() => {
      killer.kill("SIGKILL");
      resolve();
    }, 1_000);
    const finish = () => {
      clearTimeout(timeout);
      resolve();
    };
    killer.once("error", finish);
    killer.once("close", finish);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStringList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
