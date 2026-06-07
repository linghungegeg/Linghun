import { spawn } from "node:child_process";

export type ClipboardWriteResult = { ok: true; method: string } | { ok: false; error: string };
type ClipboardCandidate = { command: string; args: string[]; label: string };
type ClipboardPipe = (
  command: string,
  args: string[],
  text: string,
) => Promise<{ ok: boolean; error?: string }>;

export async function writeTextToClipboard(text: string): Promise<ClipboardWriteResult> {
  return writeTextToClipboardWithDeps(text, clipboardCandidates(), pipeToCommand);
}

export async function writeTextToClipboardWithDeps(
  text: string,
  candidates: ClipboardCandidate[],
  pipe: ClipboardPipe,
): Promise<ClipboardWriteResult> {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized) return { ok: false, error: "empty selection" };
  for (const candidate of candidates) {
    const result = await pipe(candidate.command, candidate.args, normalized);
    if (result.ok) return { ok: true, method: candidate.label };
  }
  return { ok: false, error: "no supported clipboard command found" };
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
    child.stdin?.end(process.platform === "win32" ? text.replace(/\n/g, "\r\n") : text);
  });
}
