import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { basename } from "node:path";
import { createProcessGuard } from "./process-guard.js";
import { sanitizeDiagnosticText, truncateDisplay } from "./startup-runtime.js";

export function redactedPath(path: string | undefined): string {
  if (!path) {
    return "-";
  }
  return `present:${sanitizeDiagnosticText(basename(path))}`;
}

export function summarizeCommandOutput(output: string, fallback: string): string {
  const filtered = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^level=info\s+msg=mem\.init\b/.test(line))
    .join("\n");
  return truncateDisplay(
    sanitizeDiagnosticText(filtered || output || fallback).replace(/\s+/g, " "),
    200,
  );
}

export async function runCommandCapture(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  summary: string;
  errorCode?: string;
}> {
  if (signal?.aborted) {
    return {
      exitCode: 130,
      stdout: "",
      stderr: "",
      summary: `命令已取消：${redactedPath(command)}`,
      errorCode: "ABORTED",
    };
  }
  return new Promise((resolvePromise) => {
    let child: ChildProcess;
    const guard = createProcessGuard();
    let aborted = false;
    let abortSettleTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (result: {
      exitCode: number;
      stdout: string;
      stderr: string;
      summary: string;
      errorCode?: string;
    }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (abortSettleTimer) clearTimeout(abortSettleTimer);
      signal?.removeEventListener("abort", onAbort);
      resolvePromise(result);
    };
    const abortedResult = (confirmed: boolean) => ({
      exitCode: 130,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
      summary: `命令已取消：${redactedPath(command)}`,
      errorCode: confirmed ? "ABORTED" : "ABORTED_UNCONFIRMED",
    });
    const onAbort = () => {
      if (aborted || settled) return;
      aborted = true;
      guard.requestStop(true);
      abortSettleTimer = setTimeout(() => settle(abortedResult(false)), 2_000);
      abortSettleTimer.unref();
    };
    try {
      child = spawn(command, args, { cwd, shell: false, windowsHide: true });
      guard.track(child, { label: `command:${command}` });
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      settle({
        exitCode: 127,
        stdout: "",
        stderr: "",
        summary: sanitizeDiagnosticText(nodeError.message),
        errorCode: nodeError.code,
      });
      return;
    }
    timer = setTimeout(() => {
      guard.requestStop(false);
      setTimeout(() => {
        guard.requestStop(true);
      }, 1_000).unref();
      settle({
        exitCode: 124,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        summary: `命令超时：${redactedPath(command)}`,
      });
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      settle({
        exitCode: 127,
        stdout: "",
        stderr: "",
        summary: sanitizeDiagnosticText(error.message),
        errorCode: error.code,
      });
    });
    child.on("close", (exitCode) => {
      if (aborted) {
        settle(abortedResult(true));
        return;
      }
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      settle({
        exitCode: exitCode ?? 1,
        stdout: out,
        stderr: err,
        summary: summarizeCommandOutput(err || out, `exit ${exitCode}`),
      });
    });
  });
}
