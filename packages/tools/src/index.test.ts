import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    expect(bash.output.data).toEqual({ exitCode: 0, outcome: "completed" });
  });

  it("preserves UTF-8 Chinese stdout and stderr in Bash logs", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    const progress: string[] = [];
    context.onProgress = (event) => {
      progress.push(`${event.stream}:${event.text}`);
    };

    const bash = await runTool(
      "Bash",
      {
        command:
          "node -e \"process.stdout.write('标准输出：你好\\n'); process.stderr.write('错误输出：再见\\n');\"",
      },
      context,
    );
    const fullOutputPath = bash.output.fullOutputPath;
    if (!fullOutputPath) {
      throw new Error("Bash full output path was not recorded");
    }
    const fullLog = await readFile(fullOutputPath, "utf8");

    expect(progress.join("")).toContain("stdout:标准输出：你好");
    expect(progress.join("")).toContain("stderr:错误输出：再见");
    expect(fullLog).toContain("标准输出：你好");
    expect(fullLog).toContain("错误输出：再见");
    expect(fullLog).not.toContain("�");
    expect(bash.output.data).toEqual({ exitCode: 0, outcome: "completed" });
  });

  it("marks Bash timeout and cancellation outcomes without pass evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);

    const timeout = await runTool(
      "Bash",
      {
        command: 'node -e "setTimeout(()=>{}, 2000)"',
        timeoutMs: 50,
      },
      context,
    );

    expect(timeout.output.data).toMatchObject({ exitCode: 1, outcome: "timeout" });
    expect(timeout.output.text).toContain("命令超时");

    const controller = new AbortController();
    context.abortSignal = controller.signal;
    const running = runTool(
      "Bash",
      {
        command: 'node -e "setTimeout(()=>{}, 2000)"',
        timeoutMs: 5_000,
      },
      context,
    );
    controller.abort();
    const cancelled = await running;

    expect(cancelled.output.data).toMatchObject({ exitCode: 1, outcome: "cancelled" });
    expect(cancelled.output.text).toContain("工具调用已取消");
  });

  it("terminates child and grandchild Bash processes on timeout and cancellation", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const scriptPath = join(project, "spawn-grandchild.cjs");
    await writeFile(
      scriptPath,
      [
        "const { spawn } = require('node:child_process');",
        "const sentinel = process.argv[2];",
        "spawn(process.execPath, ['-e', `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'alive'), 1200); setTimeout(() => {}, 5000);`], { stdio: 'ignore' });",
        "setTimeout(() => {}, 5000);",
      ].join("\n"),
      "utf8",
    );
    const waitForForceKill = () => new Promise((resolve) => setTimeout(resolve, 1_700));

    const timeoutSentinel = join(project, "timeout-grandchild.txt");
    const timeout = await runTool(
      "Bash",
      {
        command: `node ${JSON.stringify(scriptPath)} ${JSON.stringify(timeoutSentinel)}`,
        timeoutMs: 50,
      },
      createToolContext(project),
    );
    await waitForForceKill();

    expect(timeout.output.data).toMatchObject({ exitCode: 1, outcome: "timeout" });
    if (process.platform === "win32") {
      await expect(readFile(timeoutSentinel, "utf8")).rejects.toThrow();
    }
    await rm(timeoutSentinel, { force: true });

    const cancelSentinel = join(project, "cancel-grandchild.txt");
    const cancelContext = createToolContext(project);
    const controller = new AbortController();
    cancelContext.abortSignal = controller.signal;
    const running = runTool(
      "Bash",
      {
        command: `node ${JSON.stringify(scriptPath)} ${JSON.stringify(cancelSentinel)}`,
        timeoutMs: 5_000,
      },
      cancelContext,
    );
    controller.abort();
    const cancelled = await running;
    await waitForForceKill();

    expect(cancelled.output.data).toMatchObject({ exitCode: 1, outcome: "cancelled" });
    if (process.platform === "win32") {
      await expect(readFile(cancelSentinel, "utf8")).rejects.toThrow();
    }
    await rm(cancelSentinel, { force: true });
  });

  it("rejects non-unique edits and workspace escape writes", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "sample.txt"), "same\nsame\n", "utf8");
    const context = createToolContext(project);
    await runTool("Read", { path: "sample.txt" }, context);

    await expect(
      runTool("Edit", { path: "sample.txt", oldText: "same", newText: "next" }, context),
    ).rejects.toThrow("不唯一");
    await expect(
      runTool("Write", { path: "../escape.txt", content: "bad" }, context),
    ).rejects.toThrow("路径越界");
  });

  it("guards edits with read-before-edit and stale file detection", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const filePath = join(project, "sample.txt");
    await writeFile(filePath, "alpha\nbeta\n", "utf8");
    const context = createToolContext(project);

    await expect(
      runTool("Edit", { path: "sample.txt", oldText: "beta", newText: "gamma" }, context),
    ).rejects.toThrow("编辑前未读取");

    const read = await runTool("Read", { path: "sample.txt" }, context);
    expect(read.output.data).toMatchObject({ path: "sample.txt", newline: "lf" });

    await writeFile(filePath, "alpha\nexternal\n", "utf8");
    await expect(
      runTool("Edit", { path: "sample.txt", oldText: "external", newText: "gamma" }, context),
    ).rejects.toThrow("自上次 Read 后被修改");
  });

  it("detects CRLF and mixed-newline source files without rewriting them", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const crlfPath = join(project, "crlf-source.ts");
    const mixedPath = join(project, "mixed-source.ts");
    await writeFile(crlfPath, "const one = 1;\r\nconst two = 2;\r\n", "utf8");
    await writeFile(mixedPath, "const one = 1;\r\nconst two = 2;\n", "utf8");
    const context = createToolContext(project);

    const crlf = await runTool("Read", { path: "crlf-source.ts" }, context);
    const mixed = await runTool("Read", { path: "mixed-source.ts" }, context);

    expect(crlf.output.data).toMatchObject({ newline: "crlf" });
    expect(mixed.output.data).toMatchObject({ newline: "mixed" });
    expect(await readFile(crlfPath, "utf8")).toContain("\r\n");
    expect(await readFile(mixedPath, "utf8")).toContain("\r\n");
  });

  it("records editing patch summaries, details, and expectedHash guard", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const filePath = join(project, "sample.txt");
    await writeFile(filePath, "alpha\nbeta\n", "utf8");
    const context = createToolContext(project);
    const read = await runTool("Read", { path: "sample.txt" }, context);
    const expectedHash = (read.output.data as { hash: string }).hash;

    const edit = await runTool(
      "Edit",
      { path: "sample.txt", oldText: "beta", newText: "gamma", expectedHash },
      context,
    );
    const multi = await runTool(
      "MultiEdit",
      {
        path: "sample.txt",
        edits: [
          { oldText: "alpha", newText: "ALPHA" },
          { oldText: "gamma", newText: "GAMMA" },
        ],
      },
      context,
    );
    const diff = await runTool("Diff", {}, context);

    expect(edit.output.summary).toContain("+1 -1");
    expect(edit.output.details).toContain("readGuard: expectedHash");
    expect(multi.output.data).toMatchObject({ operation: "MultiEdit", editCount: 2 });
    expect(diff.output.data).toMatchObject({
      changedFiles: ["sample.txt"],
      addedLines: 2,
      removedLines: 2,
    });
    expect(await readFile(filePath, "utf8")).toBe("ALPHA\nGAMMA\n");
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
