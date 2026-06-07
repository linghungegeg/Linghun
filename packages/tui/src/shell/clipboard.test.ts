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
  });

  it("falls through failed candidates and reports no supported command", async () => {
    const result = await writeTextToClipboardWithDeps(
      "copied",
      [{ command: "missing", args: [], label: "missing" }],
      async () => ({ ok: false, error: "exit 1" }),
    );

    expect(result).toEqual({ ok: false, error: "no supported clipboard command found" });
  });
});
