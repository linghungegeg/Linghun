import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendJsonl, readJsonl, readJsonlTail } from "./jsonl.js";

type TestRecord = { value: string };

describe("jsonl transcript", () => {
  it("appends and reads records in order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-jsonl-"));
    const file = join(dir, "transcript.jsonl");

    await appendJsonl(file, { value: "one" });
    await appendJsonl(file, { value: "two" });

    const result = await readJsonl<TestRecord>(file);

    expect(result.records).toEqual([{ value: "one" }, { value: "two" }]);
    expect(result.diagnostics).toEqual([]);
  });

  it("returns an empty result for a missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-jsonl-"));
    const result = await readJsonl<TestRecord>(join(dir, "missing.jsonl"));

    expect(result.records).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat non-ENOENT stat errors as a missing file", async () => {
    await expect(readJsonl<TestRecord>("\0")).rejects.toThrow();
  });

  it("skips broken lines with diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-jsonl-"));
    const file = join(dir, "transcript.jsonl");
    await writeFile(file, '{"value":"one"}\nnot-json\n{"value":"two"}\n', "utf8");

    const result = await readJsonl<TestRecord>(file);

    expect(result.records).toEqual([{ value: "one" }, { value: "two" }]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.line).toBe(2);
  });

  it("reads only complete records inside the tail byte budget", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-jsonl-tail-"));
    const file = join(dir, "transcript.jsonl");
    const lines = [
      JSON.stringify({ value: "first" }),
      JSON.stringify({ value: "second" }),
      JSON.stringify({ value: "third" }),
    ];
    await writeFile(file, `${lines.join("\n")}\n`, "utf8");
    const retainedBytes = Buffer.byteLength(`${lines[1]}\n${lines[2]}\n`, "utf8") + 1;

    const result = await readJsonlTail<TestRecord>(file, {
      limit: 10,
      maxBytes: retainedBytes,
      maxLineBytes: 1024,
    });

    expect(result.records).toEqual([{ value: "second" }, { value: "third" }]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContainEqual(
      expect.stringContaining("jsonl_tail_truncated"),
    );
  });

  it("skips an oversized line across chunks and recovers surrounding records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-jsonl-tail-"));
    const file = join(dir, "transcript.jsonl");
    const oversized = JSON.stringify({ value: "x".repeat(80 * 1024) });
    await writeFile(
      file,
      `${JSON.stringify({ value: "before" })}\n${oversized}\n${JSON.stringify({ value: "after" })}\n`,
      "utf8",
    );

    const result = await readJsonlTail<TestRecord>(file, {
      limit: 10,
      maxBytes: 128 * 1024,
      maxLineBytes: 1024,
    });

    expect(result.records).toEqual([{ value: "before" }, { value: "after" }]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContainEqual(
      expect.stringContaining("jsonl_line_oversized"),
    );
  });

  it("bounds malformed-line diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-jsonl-tail-"));
    const file = join(dir, "transcript.jsonl");
    await writeFile(file, `${Array.from({ length: 100 }, () => "not-json").join("\n")}\n`, "utf8");

    const result = await readJsonlTail<TestRecord>(file, {
      limit: 10,
      maxBytes: 4096,
      maxLineBytes: 1024,
      maxDiagnostics: 3,
    });

    expect(result.records).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
    expect(result.diagnostics.at(-1)?.message).toContain("jsonl_diagnostics_truncated");
  });
});
