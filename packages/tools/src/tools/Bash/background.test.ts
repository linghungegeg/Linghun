import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BashBackgroundResult,
  createToolContext,
  runTool,
} from "../../index.js";

describe("Bash background execution (Stage 7+8)", () => {
  let project: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "linghun-bash-bg-"));
  });
  afterEach(async () => {
    await rm(project, { recursive: true, force: true }).catch(() => {});
  });

  it("run_in_background=true returns immediately with backgroundTaskId", async () => {
    const context = createToolContext(project);
    const result = await runTool(
      "Bash",
      { command: "echo hello_bg", run_in_background: true },
      context,
    );
    expect(result.output.data).toHaveProperty("backgroundTaskId");
    expect(result.output.data).toHaveProperty("outputPath");
    expect(typeof (result.output.data as { backgroundTaskId: string }).backgroundTaskId).toBe(
      "string",
    );
  });

  it("background completion produces outputPath file with streaming content", async () => {
    const context = createToolContext(project);
    const completions: BashBackgroundResult[] = [];
    context.onBackgroundBashComplete = (r) => completions.push(r);

    const result = await runTool(
      "Bash",
      { command: "echo stream_test_payload", run_in_background: true },
      context,
    );

    const outputPath = (result.output.data as { outputPath: string }).outputPath;
    await vi.waitFor(
      async () => {
        expect(completions).toHaveLength(1);
      },
      { timeout: 10_000, interval: 100 },
    );

    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("stream_test_payload");
    expect(content).toContain("exit code 0");
    expect(content).toContain("outcome completed");
  });

  it("background completion calls onBackgroundBashComplete with result", async () => {
    const context = createToolContext(project);
    const completions: BashBackgroundResult[] = [];
    context.onBackgroundBashComplete = (r) => completions.push(r);

    const result = await runTool(
      "Bash",
      { command: "echo callback_check", run_in_background: true },
      context,
    );
    const taskId = (result.output.data as { backgroundTaskId: string }).backgroundTaskId;

    await vi.waitFor(
      async () => {
        expect(completions).toHaveLength(1);
      },
      { timeout: 10_000, interval: 100 },
    );

    expect(completions[0]!.taskId).toBe(taskId);
    expect(completions[0]!.exitCode).toBe(0);
    expect(completions[0]!.outcome).toBe("completed");
    expect(completions[0]!.outputPath).toBeTruthy();
    expect(completions[0]!.command).toContain("callback_check");
  });

  it("headless mode does NOT auto-background (auto-background removed)", async () => {
    const context = createToolContext(project);
    context.isHeadlessBench = true;
    const completions: BashBackgroundResult[] = [];
    context.onBackgroundBashComplete = (r) => completions.push(r);

    const result = await runTool(
      "Bash",
      { command: "echo no_auto_bg" },
      context,
    );

    expect(result.output.data).not.toHaveProperty("backgroundTaskId");
    expect(result.output.text).toContain("no_auto_bg");
    expect(result.output.text).not.toContain("exit code 0");
    expect(result.output.fullOutputPath).toBeTruthy();
    expect(completions).toHaveLength(0);
  });

  it("abortSignal remains active after run_in_background returns (controller not prematurely cleared)", async () => {
    const controller = new AbortController();
    const context = createToolContext(project);
    context.abortSignal = controller.signal;
    const completions: BashBackgroundResult[] = [];
    context.onBackgroundBashComplete = (r) => completions.push(r);

    const result = await runTool(
      "Bash",
      { command: "echo alive_signal", run_in_background: true },
      context,
    );

    expect(result.output.data).toHaveProperty("backgroundTaskId");
    expect(controller.signal.aborted).toBe(false);

    await vi.waitFor(
      async () => { expect(completions).toHaveLength(1); },
      { timeout: 10_000, interval: 100 },
    );
  });

  it("aborting the signal terminates a running background bash process (confirmed dead)", async () => {
    const controller = new AbortController();
    const context = createToolContext(project);
    context.abortSignal = controller.signal;
    const completions: BashBackgroundResult[] = [];
    context.onBackgroundBashComplete = (r) => completions.push(r);

    const markerFile = join(project, "abort_marker.txt");
    // The process writes a marker and then sleeps. If still alive after abort it would persist.
    const cmd = process.platform === "win32"
      ? `node -e "const fs=require('fs');fs.writeFileSync('${markerFile.replace(/\\/g, "\\\\")}','alive');setTimeout(()=>{fs.writeFileSync('${markerFile.replace(/\\/g, "\\\\")}','still_alive')},8000)"`
      : `node -e "const fs=require('fs');fs.writeFileSync('${markerFile}','alive');setTimeout(()=>{fs.writeFileSync('${markerFile}','still_alive')},8000)"`;

    await runTool(
      "Bash",
      { command: cmd, run_in_background: true },
      context,
    );

    // Wait for process to start and write initial marker.
    await vi.waitFor(
      async () => {
        const { readFile: rf } = await import("node:fs/promises");
        const content = await rf(markerFile, "utf8").catch(() => "");
        expect(content).toBe("alive");
      },
      { timeout: 5_000, interval: 50 },
    );

    controller.abort();

    await vi.waitFor(
      async () => { expect(completions).toHaveLength(1); },
      { timeout: 10_000, interval: 100 },
    );

    expect(completions[0]!.outcome).toBe("cancelled");
    expect(completions[0]!.exitCode).not.toBe(0);

    // Wait a bit and confirm process did NOT update the marker (proving it's dead).
    await new Promise((r) => setTimeout(r, 1500));
    const { readFile: rf2 } = await import("node:fs/promises");
    const finalContent = await rf2(markerFile, "utf8").catch(() => "gone");
    expect(finalContent).not.toBe("still_alive");
  });

  it("completion event contains taskId, exitCode, outcome, outputPath, and command", async () => {
    const context = createToolContext(project);
    const completions: BashBackgroundResult[] = [];
    context.onBackgroundBashComplete = (r) => completions.push(r);

    const result = await runTool(
      "Bash",
      { command: "echo completion_fields_check", run_in_background: true },
      context,
    );
    const taskId = (result.output.data as { backgroundTaskId: string }).backgroundTaskId;

    await vi.waitFor(
      async () => { expect(completions).toHaveLength(1); },
      { timeout: 10_000, interval: 100 },
    );

    const c = completions[0]!;
    expect(c.taskId).toBe(taskId);
    expect(typeof c.exitCode).toBe("number");
    expect(c.outcome).toBe("completed");
    expect(c.outputPath).toBeTruthy();
    expect(c.command).toContain("completion_fields_check");
  });

  it("headless run_in_background retains a service process after returning", async () => {
    const context = createToolContext(project);
    context.isHeadlessBench = true;
    const completions: BashBackgroundResult[] = [];
    context.onBackgroundBashComplete = (r) => completions.push(r);
    const port = 45_000 + Math.floor(Math.random() * 1_000);
    const pidFile = join(project, "service.pid");
    const script = [
      `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));`,
      "const http=require('http');",
      `const server=http.createServer((req,res)=>res.end('ok'));`,
      `server.listen(${port},'127.0.0.1');`,
      "setInterval(()=>{},1000);",
    ].join("");

    const result = await runTool(
      "Bash",
      { command: `node -e ${JSON.stringify(script)}`, run_in_background: true },
      context,
    );

    expect(result.output.data).toHaveProperty("backgroundTaskId");
    await vi.waitFor(
      async () => {
        expect(completions).toHaveLength(1);
      },
      { timeout: 5_000, interval: 50 },
    );
    expect(completions[0]).toMatchObject({
      exitCode: 0,
      outcome: "completed",
      outputPath: (result.output.data as { outputPath: string }).outputPath,
    });
    await vi.waitFor(
      async () => {
        await expect(connectsToLocalPort(port)).resolves.toBe(true);
      },
      { timeout: 5_000, interval: 100 },
    );
    const pid = Number(await readFile(pidFile, "utf8"));
    if (Number.isInteger(pid) && pid > 0) process.kill(pid, "SIGTERM");
  });
});

function connectsToLocalPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 500);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}
