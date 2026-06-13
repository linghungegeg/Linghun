import { describe, expect, it, vi } from "vitest";
import { writeTextToClipboardWithDeps } from "./clipboard.js";

describe("clipboard", () => {
  it("treats exit 0 as success even when stderr has advisory text", async () => {
    const pipe = vi.fn(async () => ({ ok: true, error: "warning: advisory stderr" }));

    const result = await writeTextToClipboardWithDeps(
      "copied",
      [{ command: "clip", args: [], label: "clip" }],
      pipe,
    );

    expect(result).toEqual({ ok: true, method: "clip" });
    expect(pipe).toHaveBeenCalledWith(
      "clip",
      [],
      process.platform === "win32" ? "copied\r\n" : "copied",
      process.platform === "win32" ? "utf16le" : "utf8",
    );
  });

  it("falls through failed candidates and reports no supported command", async () => {
    const result = await writeTextToClipboardWithDeps(
      "copied",
      [{ command: "missing", args: [], label: "missing" }],
      async () => ({ ok: false, error: "exit 1" }),
    );

    expect(result).toEqual({
      ok: false,
      error: "no supported clipboard command succeeded (missing: exit 1)",
    });
  });

  it("attempts OSC52 before native clipboard without treating write as acknowledged success", async () => {
    let written = "";
    const stdout = {
      write(value: string) {
        written += value;
        return true;
      },
    };
    const pipe = vi.fn(async () => ({ ok: true }));

    const result = await writeTextToClipboardWithDeps(
      "copied",
      [{ command: "clip", args: [], label: "clip" }],
      pipe,
      stdout as never,
    );

    expect(result).toEqual({ ok: true, method: "clip" });
    expect(written).toBe(`\x1B]52;c;${Buffer.from("copied", "utf8").toString("base64")}\x07`);
    expect(pipe).toHaveBeenCalledOnce();
  });

  it("reports native fallback failure even after OSC52 write succeeds", async () => {
    const stdout = { write: () => true };

    const result = await writeTextToClipboardWithDeps(
      "copied",
      [{ command: "clip", args: [], label: "clip" }],
      async () => ({ ok: false, error: "encoding failure" }),
      stdout as never,
    );

    expect(result).toEqual({
      ok: false,
      error:
        "no supported clipboard command succeeded (clip: encoding failure); OSC52 was attempted but cannot be acknowledged",
    });
  });

  it("uses OSC52 as best-effort only when no native candidate exists", async () => {
    const stdout = { write: () => true };
    const pipe = vi.fn(async () => ({ ok: false, error: "unused" }));

    const result = await writeTextToClipboardWithDeps("copied", [], pipe, stdout as never);

    expect(result).toEqual({ ok: true, method: "osc52-best-effort" });
    expect(pipe).not.toHaveBeenCalled();
  });

  it("falls back to native commands when OSC52 is unavailable", async () => {
    const pipe = vi.fn(async () => ({ ok: true }));

    const result = await writeTextToClipboardWithDeps(
      "copied",
      [{ command: "pbcopy", args: [], label: "pbcopy" }],
      pipe,
      undefined,
    );

    expect(result).toEqual({ ok: true, method: "pbcopy" });
    expect(pipe).toHaveBeenCalledWith("pbcopy", [], "copied", "utf8");
  });
});
