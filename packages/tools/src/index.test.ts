import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createToolContext, runTool } from "./index.js";

describe("Phase 05 core tools", () => {
  it("reads, searches, edits, tracks todo, runs bash, and summarizes diff", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const filePath = join(project, "sample.txt");
    await writeFile(filePath, "alpha\nbeta\n", "utf8");
    const context = createToolContext(project);

    const read = await runTool("Read", { path: "sample.txt" }, context);
    const grep = await runTool("Grep", { pattern: "alpha", path: "." }, context);
    const glob = await runTool("Glob", { pattern: "*.txt", path: "." }, context);
    const edit = await runTool(
      "Edit",
      { path: "sample.txt", oldText: "beta", newText: "gamma" },
      context,
    );
    const todoAdd = await runTool("Todo", { action: "add", content: "验证工具闭环" }, context);
    await runTool("Todo", { action: "start", id: "1" }, context);
    await runTool("Todo", { action: "done", id: "1", evidence: "测试通过" }, context);
    const bash = await runTool("Bash", { command: "node --version" }, context);
    const diff = await runTool("Diff", {}, context);

    expect(read.output.text).toContain("1\talpha");
    expect(grep.output.text).toContain("sample.txt:1");
    expect(glob.output.text).toContain("sample.txt");
    expect(edit.output.changedFiles).toEqual(["sample.txt"]);
    expect(await readFile(filePath, "utf8")).toContain("gamma");
    expect(todoAdd.output.text).toContain("[pending] 验证工具闭环");
    expect(context.todos[0]?.status).toBe("completed");
    expect(context.todos[0]?.evidence).toBe("测试通过");
    expect(bash.output.text).toContain("exitCode=0");
    expect(bash.output.fullOutputPath).toBeTruthy();
    expect(diff.output.text).toContain("sample.txt");
  });

  it("streams Bash progress before returning final output", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    const progress: string[] = [];
    context.onProgress = (event) => {
      progress.push(`${event.stream}:${event.text}`);
    };

    const bash = await runTool(
      "Bash",
      {
        command: "node -e \"process.stdout.write('first\\n'); process.stderr.write('warn\\n');\"",
      },
      context,
    );

    expect(progress.join("")).toContain("stdout:first");
    expect(progress.join("")).toContain("stderr:warn");
    expect(bash.output.text).toContain("first");
    expect(bash.output.text).toContain("warn");
    expect(bash.output.data).toEqual({ exitCode: 0 });
  });

  it("rejects non-unique edits and workspace escape writes", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "sample.txt"), "same\nsame\n", "utf8");
    const context = createToolContext(project);

    await expect(
      runTool("Edit", { path: "sample.txt", oldText: "same", newText: "next" }, context),
    ).rejects.toThrow("不唯一");
    await expect(
      runTool("Write", { path: "../escape.txt", content: "bad" }, context),
    ).rejects.toThrow("路径越界");
  });

  it("validates tool input and preserves details when output is capped", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    await writeFile(join(project, "large.txt"), "x".repeat(9_000), "utf8");

    await expect(runTool("Read", { path: 123 }, context)).rejects.toThrow("Read.path");
    const read = await runTool("Read", { path: "large.txt" }, context);

    expect(read.input).toEqual({ path: "large.txt", offset: undefined, limit: undefined });
    expect(read.output.truncated).toBe(true);
    expect(read.output.text.length).toBeLessThan(read.output.details?.length ?? 0);
    expect(read.output.details).toContain("x".repeat(100));
  });
});
