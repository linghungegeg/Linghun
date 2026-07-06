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
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  summary: string;
  errorCode?: string;
}> {
  return new Promise((resolvePromise) => {
    let child: ChildProcess;
    const guard = createProcessGuard();
    try {
      child = spawn(command, args, { cwd, shell: false, windowsHide: true });
      guard.track(child, { label: `command:${command}` });
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      resolvePromise({
        exitCode: 127,
        stdout: "",
        stderr: "",
        summary: sanitizeDiagnosticText(nodeError.message),
        errorCode: nodeError.code,
      });
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      guard.requestStop(false);
      setTimeout(() => {
        guard.requestStop(true);
      }, 1_000).unref();
      resolvePromise({
        exitCode: 124,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        summary: `命令超时：${redactedPath(command)}`,
      });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: 127,
        stdout: "",
        stderr: "",
        summary: sanitizeDiagnosticText(error.message),
        errorCode: error.code,
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      resolvePromise({
        exitCode: exitCode ?? 1,
        stdout: out,
        stderr: err,
        summary: summarizeCommandOutput(err || out, `exit ${exitCode}`),
      });
    });
  });
}
