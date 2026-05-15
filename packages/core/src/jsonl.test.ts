import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendJsonl, readJsonl } from "./jsonl.js";

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

  it("skips broken lines with diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-jsonl-"));
    const file = join(dir, "transcript.jsonl");
    await writeFile(file, '{"value":"one"}\nnot-json\n{"value":"two"}\n', "utf8");

    const result = await readJsonl<TestRecord>(file);

    expect(result.records).toEqual([{ value: "one" }, { value: "two" }]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.line).toBe(2);
  });
});
