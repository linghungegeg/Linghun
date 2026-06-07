import { spawn } from "node:child_process";
import type { Writable } from "node:stream";

export type ClipboardWriteResult = { ok: true; method: string } | { ok: false; error: string };
type ClipboardCandidate = { command: string; args: string[]; label: string };
type ClipboardPipe = (
  command: string,
  args: string[],
  text: string,
  encoding: BufferEncoding,
) => Promise<{ ok: boolean; error?: string }>;

export async function writeTextToClipboard(
  text: string,
  options: { stdout?: Writable } = {},
): Promise<ClipboardWriteResult> {
  return writeTextToClipboardWithDeps(text, clipboardCandidates(), pipeToCommand, options.stdout);
}

export async function writeTextToClipboardWithDeps(
  text: string,
  candidates: ClipboardCandidate[],
  pipe: ClipboardPipe,
  stdout?: Writable,
): Promise<ClipboardWriteResult> {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized) return { ok: false, error: "empty selection" };
  const osc52Written = writeOsc52(stdout, normalized);
  const errors: string[] = [];
  for (const candidate of candidates) {
    const input = clipboardInputForCandidate(candidate, normalized);
    const result = await pipe(candidate.command, candidate.args, input.text, input.encoding);
    if (result.ok) return { ok: true, method: candidate.label };
    if (result.error) errors.push(`${candidate.label}: ${result.error}`);
  }
  if (osc52Written && candidates.length === 0) return { ok: true, method: "osc52-best-effort" };
  return {
    ok: false,
    error:
      errors.length > 0
        ? `no supported clipboard command succeeded (${errors.join("; ")})${
            osc52Written ? "; OSC52 was attempted but cannot be acknowledged" : ""
          }`
        : osc52Written
          ? "OSC52 was attempted but cannot be acknowledged; no native clipboard command found"
          : "no supported clipboard command found",
  };
}

function clipboardCandidates(): ClipboardCandidate[] {
  if (process.platform === "win32") return [{ command: "clip", args: [], label: "clip" }];
  if (process.platform === "darwin") return [{ command: "pbcopy", args: [], label: "pbcopy" }];
  return [
    { command: "wl-copy", args: [], label: "wl-copy" },
    { command: "xclip", args: ["-selection", "clipboard"], label: "xclip" },
    { command: "xsel", args: ["--clipboard", "--input"], label: "xsel" },
  ];
}

function pipeToCommand(
  command: string,
  args: string[],
  text: string,
  encoding: BufferEncoding,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let stderr = "";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("error", (error) => finish({ ok: false, error: error.message }));
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("close", (code) => {
      if (code === 0) {
        finish({ ok: true });
        return;
      }
      finish({ ok: false, error: stderr.trim() || `exit ${code ?? "unknown"}` });
    });
    child.stdin?.end(Buffer.from(text, encoding));
  });
}

function clipboardInputForCandidate(
  candidate: ClipboardCandidate,
  text: string,
): { text: string; encoding: BufferEncoding } {
  if (process.platform === "win32" && candidate.command.toLowerCase() === "clip") {
    return { text: `${text.replace(/\n/g, "\r\n")}\r\n`, encoding: "utf16le" };
  }
  return { text, encoding: "utf8" };
}

function writeOsc52(stdout: Writable | undefined, text: string): boolean {
  if (!stdout || typeof stdout.write !== "function") return false;
  try {
    const payload = Buffer.from(text, "utf8").toString("base64");
    return stdout.write(`\x1B]52;c;${payload}\x07`) !== false;
  } catch {
    return false;
  }
}
