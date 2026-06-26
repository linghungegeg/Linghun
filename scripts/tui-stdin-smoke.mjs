import { spawn } from "node:child_process";

// Cross-platform TUI stdin smoke.
// Feeds a UTF-8 prompt + /exit into the linghun CLI over stdin and checks it
// starts up, accepts non-ASCII input, and exits cleanly. Replaces the previous
// Unix-only `printf '...' | corepack pnpm exec linghun` recipe, which failed on
// Windows (no `printf`) and mangled non-ASCII input.
//
// The prompt is intentionally lightweight: a smoke check should only confirm
// the TUI boots and drains stdin, not drive a real task that triggers tool
// execution or permission gates (which would hang and time out).

const PROMPT = "你好，这是一条编码冒烟检查输入";
const STDIN = `${PROMPT}\n/exit\n`;
const TIMEOUT_MS = 60_000;

process.exitCode = await main();

async function main() {
  const isWindows = process.platform === "win32";
  // Windows Node refuses to spawn the corepack `.cmd` shim without a shell
  // (spawn EINVAL). Use shell mode there with a single fixed command string so
  // we avoid DEP0190 (args + shell:true). Args are constant, not user input.
  const command = isWindows ? "corepack pnpm exec linghun" : "corepack";
  const args = isWindows ? [] : ["pnpm", "exec", "linghun"];

  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
    shell: isWindows,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const timer = setTimeout(() => {
    child.kill("SIGKILL");
  }, TIMEOUT_MS);
  timer.unref?.();

  // Write the prompt as UTF-8 so non-ASCII input survives on every platform.
  child.stdin.write(Buffer.from(STDIN, "utf8"));
  child.stdin.end();

  const { code, signal } = await new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
    child.on("error", (err) => {
      stderr += `\nspawn error: ${err?.message ?? String(err)}`;
      resolve({ code: 127, signal: null });
    });
  });
  clearTimeout(timer);

  if (signal === "SIGKILL") {
    console.error(
      `FAIL tui-stdin smoke: CLI did not exit within ${TIMEOUT_MS}ms (killed).`,
    );
    emitTail(stdout, stderr);
    return 1;
  }

  if (code !== 0) {
    console.error(`FAIL tui-stdin smoke: CLI exited with code ${code}.`);
    emitTail(stdout, stderr);
    return 1;
  }

  console.log("PASS tui-stdin smoke: CLI accepted UTF-8 stdin and exited 0.");
  return 0;
}

function emitTail(stdout, stderr) {
  const tail = (text) => text.split(/\r?\n/).slice(-20).join("\n");
  if (stdout.trim()) console.error(`--- stdout tail ---\n${tail(stdout)}`);
  if (stderr.trim()) console.error(`--- stderr tail ---\n${tail(stderr)}`);
}
