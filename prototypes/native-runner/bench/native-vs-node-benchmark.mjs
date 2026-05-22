#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { dirname, join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runnerRoot = dirname(__dirname);
const repoRoot = dirname(dirname(runnerRoot));
const nativeBin = join(
  runnerRoot,
  "target",
  "release",
  process.platform === "win32"
    ? "linghun-native-runner-prototype.exe"
    : "linghun-native-runner-prototype",
);
const outRoot = join(__dirname, ".out", new Date().toISOString().replace(/[:.]/g, "-"));
const nodeExe = process.execPath;
const concurrencyLevels = [1, 2, 4, 8];
const repeatCount = 3;
const protocol = "linghun-native-runner-prototype.v1";

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function safeRm(path) {
  rmSync(path, { recursive: true, force: true });
}

function fileSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function rel(path) {
  return relative(repoRoot, path).replaceAll("\\\\", "/").replaceAll("\\", "/");
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(values) {
  return {
    minMs: round(Math.min(...values)),
    medianMs: round(median(values)),
    maxMs: round(Math.max(...values)),
    meanMs: round(mean(values)),
  };
}

function parseLastJson(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Ignore non-JSON lines from failed commands.
    }
  }
  return null;
}

function spawnCapture(command, args, options = {}) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(command, args, {
      cwd: options.cwd ?? runnerRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      resolve({
        ok: false,
        error: error.message,
        code: null,
        durationMs: performance.now() - started,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.on("close", (code, signal) => {
      resolve({
        ok: code === 0,
        code,
        signal,
        durationMs: performance.now() - started,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function workloadCommand(label, delayMs = 60) {
  const script = `process.stdout.write(${JSON.stringify(label)} + ':stdout\\n'); process.stderr.write(${JSON.stringify(label)} + ':stderr\\n'); setTimeout(() => process.exit(0), ${delayMs});`;
  return [nodeExe, ["-e", script]];
}

function sleepCommand(ms) {
  return [nodeExe, ["-e", `setTimeout(() => process.exit(0), ${ms});`]];
}

function largeOutputCommand(stdoutBytes, stderrBytes) {
  const script = `
    const fs = require('fs');
    function writeBytes(fd, total, code) {
      const chunk = Buffer.alloc(65536, code);
      let left = total;
      while (left > 0) {
        const size = Math.min(left, chunk.length);
        fs.writeSync(fd, chunk.subarray(0, size));
        left -= size;
      }
    }
    writeBytes(1, ${stdoutBytes}, 65);
    writeBytes(2, ${stderrBytes}, 66);
  `;
  return [nodeExe, ["-e", script]];
}

function treeCommand(markerPath) {
  const childScript = "setInterval(() => {}, 1000);";
  const parentScript = `
    const fs = require('fs');
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'ignore' });
    fs.writeFileSync(${JSON.stringify(markerPath)}, String(child.pid));
    setInterval(() => {}, 1000);
  `;
  return [nodeExe, ["-e", parentScript]];
}

function cmdLongCommand() {
  if (process.platform !== "win32") return sleepCommand(30_000);
  return ["cmd.exe", ["/d", "/s", "/c", "ping -n 30 127.0.0.1 >nul"]];
}

function powershellLongCommand() {
  if (process.platform !== "win32") return sleepCommand(30_000);
  return ["powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Seconds 30"]];
}

async function runNativeJob({ id, root, command, timeoutMs = 5000, heartbeatMs = 50 }) {
  return runNativeOrCancel({ id, root, command, timeoutMs, heartbeatMs, cancelAfterMs: null });
}

async function runNativeOrCancel({
  id,
  root,
  command,
  timeoutMs = 5000,
  heartbeatMs = 50,
  cancelAfterMs = null,
}) {
  ensureDir(root);
  const started = performance.now();
  const child = spawn(
    nativeBin,
    [
      "start",
      "--id",
      id,
      "--root",
      root,
      "--timeout-ms",
      String(timeoutMs),
      "--heartbeat-ms",
      String(heartbeatMs),
      "--",
      command[0],
      ...command[1],
    ],
    {
      cwd: runnerRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  let cancelTimer = null;
  if (cancelAfterMs !== null) {
    cancelTimer = setTimeout(() => {
      spawnCapture(nativeBin, ["stop", "--id", id, "--root", root]);
    }, cancelAfterMs);
  }

  const result = await new Promise((resolve) => {
    child.on("error", (error) =>
      resolve({ ok: false, error: error.message, code: null, signal: null }),
    );
    child.on("close", (code, signal) => resolve({ ok: code === 0, code, signal }));
  });
  if (cancelTimer) clearTimeout(cancelTimer);

  const stdoutText = Buffer.concat(stdout).toString("utf8");
  const stderrText = Buffer.concat(stderr).toString("utf8");
  const durationMs = performance.now() - started;
  const parsed = parseLastJson(stdoutText) ?? parseLastJson(stderrText);
  const jobRoot = join(root, id);
  const stdoutPath = join(jobRoot, "stdout.log");
  const stderrPath = join(jobRoot, "stderr.log");
  const statePath = join(jobRoot, "state.json");
  return {
    engine: "native",
    id,
    ok: result.ok && parsed?.ok === true,
    status: parsed?.status ?? "unknown",
    exitCode: parsed?.exitCode ?? result.code,
    signal: result.signal ?? null,
    durationMs: round(durationMs),
    protocolBytes: Buffer.byteLength(stdoutText) + Buffer.byteLength(stderrText),
    stdoutBytes: fileSize(stdoutPath),
    stderrBytes: fileSize(stderrPath),
    stdoutRef: existsSync(stdoutPath) ? "stdout.log" : null,
    stderrRef: existsSync(stderrPath) ? "stderr.log" : null,
    stateBytes: fileSize(statePath),
    rawStatus: parsed,
  };
}

async function runNodeJob({
  id,
  root,
  command,
  timeoutMs = 5000,
  cancelAfterMs = null,
  treeKill = false,
}) {
  ensureDir(root);
  const jobRoot = join(root, id);
  ensureDir(jobRoot);
  const stdoutPath = join(jobRoot, "stdout.log");
  const stderrPath = join(jobRoot, "stderr.log");
  const stdout = createWriteStream(stdoutPath);
  const stderr = createWriteStream(stderrPath);
  const stdoutFinished = new Promise((resolve) => stdout.on("finish", resolve));
  const stderrFinished = new Promise((resolve) => stderr.on("finish", resolve));
  const started = performance.now();
  const child = spawn(command[0], command[1], {
    cwd: runnerRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);

  let status = "running";
  let timer = null;
  let cancelTimer = null;
  const killChild = () => {
    if (child.exitCode === null && child.signalCode === null) {
      if (treeKill && process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } else {
        child.kill();
      }
    }
  };

  timer = setTimeout(() => {
    status = "timeout";
    killChild();
  }, timeoutMs);
  if (cancelAfterMs !== null) {
    cancelTimer = setTimeout(() => {
      status = "cancelled";
      killChild();
    }, cancelAfterMs);
  }

  const closeResult = await new Promise((resolve) => {
    child.on("error", (error) => resolve({ error: error.message, code: null, signal: null }));
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  if (cancelTimer) clearTimeout(cancelTimer);
  stdout.end();
  stderr.end();
  await Promise.all([stdoutFinished, stderrFinished]);

  if (status === "running") status = closeResult.code === 0 ? "completed" : "failed";
  const durationMs = performance.now() - started;
  const resultJson = JSON.stringify({
    ok: true,
    engine: "node-spawn",
    id,
    status,
    exitCode: closeResult.code ?? 1,
  });
  writeFileSync(join(jobRoot, "state.json"), `${resultJson}\n`);
  return {
    engine: "node-spawn",
    id,
    ok: status === "completed",
    status,
    exitCode: closeResult.code ?? 1,
    signal: closeResult.signal ?? null,
    durationMs: round(durationMs),
    protocolBytes: Buffer.byteLength(resultJson),
    stdoutBytes: fileSize(stdoutPath),
    stderrBytes: fileSize(stderrPath),
    stdoutRef: "stdout.log",
    stderrRef: "stderr.log",
    stateBytes: fileSize(join(jobRoot, "state.json")),
    rawStatus: { status, exitCode: closeResult.code ?? 1 },
  };
}

async function runConcurrency(engine, level, runIndex) {
  const root = join(outRoot, "concurrency", engine, `n-${level}`, `run-${runIndex}`);
  safeRm(root);
  ensureDir(root);
  const started = performance.now();
  const jobs = Array.from({ length: level }, (_, index) => {
    const id = `c${level}r${runIndex}j${index}`;
    const command = workloadCommand(id);
    if (engine === "native") return runNativeJob({ id, root, command, timeoutMs: 5000 });
    return runNodeJob({ id, root, command, timeoutMs: 5000 });
  });
  const results = await Promise.all(jobs);
  const totalMs = performance.now() - started;
  return {
    scenario: "concurrency",
    engine,
    level,
    run: runIndex,
    totalMs: round(totalMs),
    success: results.filter((result) => result.status === "completed").length,
    failure: results.filter((result) => result.status === "failed").length,
    timeout: results.filter((result) => result.status === "timeout").length,
    cancelled: results.filter((result) => result.status === "cancelled").length,
    protocolBytes: results.reduce((sum, result) => sum + result.protocolBytes, 0),
    stdoutBytes: results.reduce((sum, result) => sum + result.stdoutBytes, 0),
    stderrBytes: results.reduce((sum, result) => sum + result.stderrBytes, 0),
    maxJobMs: round(Math.max(...results.map((result) => result.durationMs))),
    resultRefs: results.map((result) => ({
      id: result.id,
      stdoutRef: result.stdoutRef,
      stderrRef: result.stderrRef,
    })),
  };
}

async function runLargeOutput(engine, label, stdoutBytes, stderrBytes) {
  const root = join(outRoot, "large-output", engine, label);
  safeRm(root);
  ensureDir(root);
  const id = label.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48);
  const command = largeOutputCommand(stdoutBytes, stderrBytes);
  const result =
    engine === "native"
      ? await runNativeJob({ id, root, command, timeoutMs: 60_000, heartbeatMs: 100 })
      : await runNodeJob({ id, root, command, timeoutMs: 60_000 });
  return {
    scenario: "large-output",
    engine,
    label,
    expectedStdoutBytes: stdoutBytes,
    expectedStderrBytes: stderrBytes,
    status: result.status,
    durationMs: result.durationMs,
    protocolBytes: result.protocolBytes,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    logBodyInProtocol: false,
  };
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killPidTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    await spawnCapture("taskkill", ["/pid", String(pid), "/t", "/f"]);
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

async function runCleanupScenario(engine, label, commandFactory, mode = "timeout") {
  const root = join(outRoot, "cleanup", engine, `${label}-${mode}`);
  safeRm(root);
  ensureDir(root);
  const marker = join(root, "grandchild.pid");
  const command = commandFactory(marker);
  const timeoutMs = mode === "cancel" ? 30_000 : 1000;
  const result =
    engine === "native"
      ? await runNativeOrCancel({
          id: label,
          root,
          command,
          timeoutMs,
          heartbeatMs: 100,
          cancelAfterMs: mode === "cancel" ? 500 : null,
        })
      : await runNodeJob({
          id: label,
          root,
          command,
          timeoutMs,
          cancelAfterMs: mode === "cancel" ? 500 : null,
        });

  await new Promise((resolve) => setTimeout(resolve, 300));
  let grandchildPid = null;
  let grandchildAlive = null;
  if (existsSync(marker)) {
    grandchildPid = Number(readFileSync(marker, "utf8").trim());
    grandchildAlive = processAlive(grandchildPid);
    if (grandchildAlive) await killPidTree(grandchildPid);
  }

  return {
    scenario: "cleanup",
    engine,
    label,
    mode,
    status: result.status,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    grandchildPidRecorded: grandchildPid !== null,
    grandchildAliveAfterTimeout: grandchildAlive,
  };
}

async function runPathScenario(engine, label, root) {
  safeRm(root);
  ensureDir(root);
  const id = "pathcheck";
  const command = workloadCommand(`${engine}-${label}`, 20);
  const result =
    engine === "native"
      ? await runNativeJob({ id, root, command, timeoutMs: 5000 })
      : await runNodeJob({ id, root, command, timeoutMs: 5000 });
  return {
    scenario: "path-matrix",
    engine,
    label,
    rootRef: rel(root),
    status: result.status,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    stdoutRef: result.stdoutRef,
    stderrRef: result.stderrRef,
  };
}

async function runResponsiveness(engine) {
  const root = join(outRoot, "responsiveness", engine);
  safeRm(root);
  ensureDir(root);
  const jobs = Array.from({ length: 8 }, (_, index) => {
    const id = `resp${index}`;
    const command = sleepCommand(1500);
    return engine === "native"
      ? runNativeJob({ id, root, command, timeoutMs: 5000, heartbeatMs: 100 })
      : runNodeJob({ id, root, command, timeoutMs: 5000 });
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const probeStarted = performance.now();
  let probe;
  if (engine === "native") {
    probe = await spawnCapture(nativeBin, ["status", "--id", "resp0", "--root", root]);
  } else {
    probe = await spawnCapture(nodeExe, ["-e", 'process.stdout.write("ok")']);
  }
  const probeMs = performance.now() - probeStarted;
  const results = await Promise.all(jobs);
  return {
    scenario: "responsiveness",
    engine,
    probe:
      engine === "native" ? "native status during N=8 jobs" : "node light command during N=8 jobs",
    probeMs: round(probeMs),
    probeOk: probe.ok,
    completed: results.filter((result) => result.status === "completed").length,
  };
}

async function collectEnvironment() {
  const cargoExe =
    process.env.CARGO ??
    (process.platform === "win32" ? "C:/Users/Admin/.cargo/bin/cargo.exe" : "cargo");
  const rustcExe =
    process.env.RUSTC ??
    (process.platform === "win32" ? "C:/Users/Admin/.cargo/bin/rustc.exe" : "rustc");
  const cargo = await spawnCapture(cargoExe, ["--version"]);
  const rustc = await spawnCapture(rustcExe, ["--version"]);
  const nativeVersion = existsSync(nativeBin)
    ? await spawnCapture(nativeBin, ["version"])
    : { ok: false, stdout: "", stderr: "native binary missing" };
  return {
    date: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    node: process.version,
    cargo: cargo.stdout.trim() || cargo.stderr.trim(),
    rustc: rustc.stdout.trim() || rustc.stderr.trim(),
    nativeBin: rel(nativeBin),
    nativeVersion: nativeVersion.stdout.trim() || nativeVersion.stderr.trim(),
    outRoot: rel(outRoot),
  };
}

function makeMarkdown(data) {
  const lines = [];
  lines.push("# Generated Native vs Node Benchmark Tables");
  lines.push("");
  lines.push(`Output root: \`${data.environment.outRoot}\``);
  lines.push("");
  lines.push("## Concurrency raw");
  lines.push(
    "| engine | N | run | totalMs | success | failure | timeout | cancelled | protocolBytes | stdoutBytes | stderrBytes | maxJobMs |",
  );
  lines.push(
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const row of data.concurrency.raw) {
    lines.push(
      `| ${row.engine} | ${row.level} | ${row.run} | ${row.totalMs} | ${row.success} | ${row.failure} | ${row.timeout} | ${row.cancelled} | ${row.protocolBytes} | ${row.stdoutBytes} | ${row.stderrBytes} | ${row.maxJobMs} |`,
    );
  }
  lines.push("");
  lines.push("## Concurrency summary");
  lines.push("| engine | N | minMs | medianMs | maxMs | meanMs | runs |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of data.concurrency.summary) {
    lines.push(
      `| ${row.engine} | ${row.level} | ${row.minMs} | ${row.medianMs} | ${row.maxMs} | ${row.meanMs} | ${row.runs} |`,
    );
  }
  lines.push("");
  lines.push("## Large output");
  lines.push(
    "| engine | label | status | durationMs | protocolBytes | stdoutBytes | stderrBytes |",
  );
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: |");
  for (const row of data.largeOutput) {
    lines.push(
      `| ${row.engine} | ${row.label} | ${row.status} | ${row.durationMs} | ${row.protocolBytes} | ${row.stdoutBytes} | ${row.stderrBytes} |`,
    );
  }
  lines.push("");
  lines.push("## Cleanup");
  lines.push(
    "| engine | label | mode | status | durationMs | grandchildPidRecorded | grandchildAliveAfterTimeout |",
  );
  lines.push("| --- | --- | --- | --- | ---: | --- | --- |");
  for (const row of data.cleanup) {
    lines.push(
      `| ${row.engine} | ${row.label} | ${row.mode} | ${row.status} | ${row.durationMs} | ${row.grandchildPidRecorded} | ${row.grandchildAliveAfterTimeout} |`,
    );
  }
  lines.push("");
  lines.push("## Path matrix");
  lines.push(
    "| engine | label | status | rootRef | stdoutBytes | stderrBytes | stdoutRef | stderrRef |",
  );
  lines.push("| --- | --- | --- | --- | ---: | ---: | --- | --- |");
  for (const row of data.pathMatrix) {
    lines.push(
      `| ${row.engine} | ${row.label} | ${row.status} | \`${row.rootRef}\` | ${row.stdoutBytes} | ${row.stderrBytes} | ${row.stdoutRef} | ${row.stderrRef} |`,
    );
  }
  lines.push("");
  lines.push("## Responsiveness");
  lines.push("| engine | probe | probeMs | probeOk | completed |");
  lines.push("| --- | --- | ---: | --- | ---: |");
  for (const row of data.responsiveness) {
    lines.push(
      `| ${row.engine} | ${row.probe} | ${row.probeMs} | ${row.probeOk} | ${row.completed} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  ensureDir(outRoot);
  if (!existsSync(nativeBin)) {
    throw new Error(`native runner binary missing: ${nativeBin}. Run cargo build --release first.`);
  }

  const environment = await collectEnvironment();
  const concurrencyRaw = [];
  for (const engine of ["native", "node-spawn"]) {
    for (const level of concurrencyLevels) {
      for (let run = 1; run <= repeatCount; run += 1) {
        concurrencyRaw.push(await runConcurrency(engine, level, run));
      }
    }
  }
  const concurrencySummary = [];
  for (const engine of ["native", "node-spawn"]) {
    for (const level of concurrencyLevels) {
      const rows = concurrencyRaw.filter((row) => row.engine === engine && row.level === level);
      concurrencySummary.push({
        engine,
        level,
        ...summarize(rows.map((row) => row.totalMs)),
        runs: rows.length,
      });
    }
  }

  const largeOutput = [];
  for (const engine of ["native", "node-spawn"]) {
    largeOutput.push(await runLargeOutput(engine, "stdout-10mb", 10 * 1024 * 1024, 0));
    largeOutput.push(await runLargeOutput(engine, "stderr-10mb", 0, 10 * 1024 * 1024));
    largeOutput.push(
      await runLargeOutput(engine, "combined-100mb", 50 * 1024 * 1024, 50 * 1024 * 1024),
    );
  }

  const cleanup = [];
  for (const engine of ["native", "node-spawn"]) {
    cleanup.push(await runCleanupScenario(engine, "simple", () => sleepCommand(30_000), "timeout"));
    cleanup.push(await runCleanupScenario(engine, "simple", () => sleepCommand(30_000), "cancel"));
    cleanup.push(await runCleanupScenario(engine, "cmd", () => cmdLongCommand(), "timeout"));
    cleanup.push(
      await runCleanupScenario(engine, "powershell", () => powershellLongCommand(), "timeout"),
    );
    cleanup.push(
      await runCleanupScenario(
        engine,
        "node-grandchild",
        (marker) => treeCommand(marker),
        "timeout",
      ),
    );
  }

  const pathRoots = {
    normal: join(outRoot, "paths", "normal"),
    "with-spaces": join(outRoot, "paths", "with spaces"),
    chinese: join(outRoot, "paths", "路径-中文"),
    deep: join(
      outRoot,
      "paths",
      "deep",
      "a".repeat(24),
      "b".repeat(24),
      "c".repeat(24),
      "d".repeat(24),
    ),
  };
  const pathMatrix = [];
  for (const engine of ["native", "node-spawn"]) {
    for (const [label, root] of Object.entries(pathRoots)) {
      pathMatrix.push(await runPathScenario(engine, label, root));
    }
  }

  const responsiveness = [];
  for (const engine of ["native", "node-spawn"]) {
    responsiveness.push(await runResponsiveness(engine));
  }

  const data = {
    protocol,
    environment,
    method: {
      repeatCount,
      concurrencyLevels,
      largeOutputCases: ["stdout-10mb", "stderr-10mb", "combined-100mb"],
      cleanupCases: [
        "simple-timeout",
        "cmd-timeout",
        "powershell-timeout",
        "node-grandchild-timeout",
      ],
      pathCases: Object.keys(pathRoots),
    },
    concurrency: { raw: concurrencyRaw, summary: concurrencySummary },
    largeOutput,
    cleanup,
    pathMatrix,
    responsiveness,
  };

  const jsonPath = join(outRoot, "native-vs-node-benchmark-results.json");
  const markdownPath = join(outRoot, "native-vs-node-benchmark-tables.md");
  writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);
  writeFileSync(markdownPath, makeMarkdown(data));
  console.log(
    JSON.stringify({ ok: true, jsonPath: rel(jsonPath), markdownPath: rel(markdownPath) }, null, 2),
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
