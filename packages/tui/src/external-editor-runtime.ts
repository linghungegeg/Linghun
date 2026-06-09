/**
 * external-editor-runtime.ts
 *
 * Pure runtime module for Ctrl+G "open external editor" feature.
 * No React/Ink dependencies.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ExternalEditorResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export type ExternalEditorOptions = {
  /** Override editor command (default: $EDITOR || $VISUAL || platform fallback) */
  editor?: string;
  /** Extension for temp file (helps editor choose syntax highlighting) */
  extension?: string;
  /** Timeout in ms (default: 300000 = 5 minutes) */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Resolve the editor command to use.
 * Priority: $EDITOR -> $VISUAL -> platform fallback (Windows: notepad, others: vi)
 */
export function resolveEditorCommand(): string {
  if (process.env.EDITOR) return process.env.EDITOR;
  if (process.env.VISUAL) return process.env.VISUAL;
  return process.platform === "win32" ? "notepad" : "vi";
}

/**
 * Open current text in an external editor, wait for it to close,
 * then return the (possibly modified) content.
 */
export async function openInExternalEditor(
  currentText: string,
  options?: ExternalEditorOptions,
): Promise<ExternalEditorResult> {
  const editorCmd = options?.editor || resolveEditorCommand();
  const ext = options?.extension || "txt";
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const suffix = randomBytes(6).toString("hex");
  const tempPath = join(tmpdir(), `.linghun-edit-${suffix}.${ext}`);

  try {
    await writeFile(tempPath, currentText, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to write temp file: ${msg}` };
  }

  try {
    // Parse editor command: split on spaces to handle "code --wait" etc.
    const parts = editorCmd.trim().split(/\s+/);
    const bin = parts[0]!;
    const args = [...parts.slice(1), tempPath];

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(bin, args, { stdio: "inherit" });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Editor timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    if (exitCode !== 0 && exitCode !== null) {
      return { ok: false, error: `Editor exited with code ${exitCode}` };
    }

    const newContent = await readFile(tempPath, "utf-8");
    return { ok: true, text: newContent };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (
      msg.includes("ENOENT") ||
      msg.includes("spawn") ||
      msg.includes("not found")
    ) {
      return {
        ok: false,
        error: `Editor not found: "${editorCmd}". Set $EDITOR or $VISUAL.`,
      };
    }
    if (msg.includes("timed out")) {
      return { ok: false, error: msg };
    }
    return { ok: false, error: `Editor failed: ${msg}` };
  } finally {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort cleanup; temp dir will be swept eventually.
    }
  }
}
