import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  __testDecodeShellChunk,
  __testCanSafelyAliasPythonCommand,
  __testGlobToRegExp,
  __testParseBashCommandIntent,
  adaptShellCommandForPlatform,
  builtInTools,
  createTool,
  createToolContext,
  runTool,
  type ToolPermissionSpec,
} from "./index.js";

describe("Phase 05 core tools", () => {
  it("Phase D createTool adds fail-closed defaults and CoreTool methods", () => {
    const permission: ToolPermissionSpec = {
      risk: "medium",
      scope: "workspace",
      reason: "test permission",
      phase06Mode: "metadata-only",
    };
    const tool = createTool({
      name: "Write",
      title: "Test Tool",
      description: "test description",
      permission,
      validateInput: (input) => input as { path: string },
      call: async () => ({ text: "ok" }),
    });

    expect(tool.isReadOnly).toBe(false);
    expect(tool.isConcurrencySafe).toBe(false);
    expect(tool.lifecycle.destructive).toBe(false);
    expect(tool.isReadOnlyTool()).toBe(false);
    expect(tool.isDestructive()).toBe(false);
    expect(tool.checkPermissions({ path: "a" }, createToolContext()).behavior).toBe(
      "passthrough",
    );
    expect(tool.userFacingName()).toBe("Test Tool");
    expect(tool.prompt()).toContain("test description");
  });

  it("Phase D built-in tools expose prompt, summary, activity, and permission decisions", () => {
    expect(builtInTools.Read.prompt()).toContain("Use Read");
    expect(builtInTools.Read.userFacingName()).toBe("读取文件");
    expect(builtInTools.Read.getToolUseSummary({ path: "a.ts" })).toContain("a.ts");
    expect(builtInTools.Read.checkPermissions({ path: "a.ts" }, createToolContext()).behavior).toBe(
      "allow",
    );
    expect(
      builtInTools.Write.checkPermissions(
        { path: "a.ts", content: "x" },
        createToolContext(),
      ).behavior,
    ).toBe("passthrough");
    expect(builtInTools.Bash.getActivityDescription({ command: "node --version" })).toContain(
      "Running",
    );
  });

  it("treats empty WebSearch domain filters as undefined", () => {
    expect(
      builtInTools.WebSearch.validateInput({
        query: "linghun",
        allowed_domains: [],
        blocked_domains: [],
      }),
    ).toEqual({
      query: "linghun",
      num_results: 8,
      allowed_domains: undefined,
      blocked_domains: undefined,
    });

    expect(
      builtInTools.WebSearch.validateInput({
        query: "linghun",
        allowed_domains: [],
        blocked_domains: ["example.com"],
      }),
    ).toEqual({
      query: "linghun",
      num_results: 8,
      allowed_domains: undefined,
      blocked_domains: ["example.com"],
    });

    expect(() =>
      builtInTools.WebSearch.validateInput({
        query: "linghun",
        allowed_domains: ["docs.example.com"],
        blocked_domains: ["example.com"],
      }),
    ).toThrow("allowed_domains 和 blocked_domains 不能同时使用");
  });

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
    expect(todoAdd.output.text).toContain("Todo created: id=1");
    expect(todoAdd.output.text).toContain("[pending] 验证工具闭环");
    expect(todoAdd.output.data).toMatchObject({ createdId: "1" });
    expect(context.todos[0]?.status).toBe("completed");
    expect(context.todos[0]?.evidence).toBe("测试通过");
    expect(bash.output.text).toContain("exit code 0");
    expect(bash.output.fullOutputPath).toBeTruthy();
    expect(diff.output.text).toContain("sample.txt");
  });

  it("ignores model-supplied Todo add id and returns the runtime id", async () => {
    const context = createToolContext();

    const todoAdd = await runTool(
      "Todo",
      { action: "add", id: "survey", content: "调查源码" },
      context,
    );

    expect(context.todos[0]?.id).toBe("1");
    expect(todoAdd.output.text).toContain("Todo created: id=1");
    expect(todoAdd.output.text).not.toContain("id=survey");
    expect(todoAdd.output.data).toMatchObject({ createdId: "1" });
  });

  it("resolves a missing Todo id by exact unique content match", async () => {
    const context = createToolContext();

    await runTool("Todo", { action: "add", content: "实现用户可见通知" }, context);
    await runTool("Todo", { action: "start", id: "semantic-id", content: "实现用户可见通知" }, context);

    expect(context.todos[0]?.id).toBe("1");
    expect(context.todos[0]?.status).toBe("in_progress");
  });

  it("does not guess a missing Todo id when content is ambiguous", async () => {
    const context = createToolContext();

    await runTool("Todo", { action: "add", content: "重复任务" }, context);
    await runTool("Todo", { action: "add", content: "重复任务" }, context);

    await expect(
      runTool("Todo", { action: "start", id: "semantic-id", content: "重复任务" }, context),
    ).rejects.toThrow("未找到唯一 Todo");
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

  it("adapts Windows node here-doc without leaking the raw script in the preview", async () => {
    const command = [
      "node - <<'NODE'",
      "const secret = 'raw-script-secret-marker';",
      "console.log('heredoc-ok');",
      "NODE",
    ].join("\n");

    const native = adaptShellCommandForPlatform(command, "linux");
    expect(native).toEqual({ command, adapter: "native" });

    const adapted = adaptShellCommandForPlatform(command, "win32");
    expect(adapted.adapter).toBe("powershell-adapted");
    expect(adapted.command).toContain("powershell.exe -NoProfile -NonInteractive -Command");
    expect(adapted.logCommand).toContain("<node here-doc adapter: stdin>");
    expect(adapted.logCommand).not.toContain("raw-script-secret-marker");
    expect(adapted.command).not.toContain("raw-script-secret-marker");
  });

  it("keeps unsupported Windows node here-doc safely blocked", () => {
    const adapted = adaptShellCommandForPlatform("node - <<'NODE'\n   \nNODE", "win32");

    expect(adapted.adapter).toBe("blocked");
    expect(adapted.command).toContain("Unsupported empty node here-doc");
  });

  it("marks Bash timeout and cancellation outcomes without pass evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);

    const timeout = await runTool(
      "Bash",
      {
        command: 'node -e "setTimeout(()=>{}, 1000)"',
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
        command: 'node -e "setTimeout(()=>{}, 1000)"',
        timeoutMs: 5_000,
      },
      context,
    );
    controller.abort();
    const cancelled = await running;

    expect(cancelled.output.data).toMatchObject({ exitCode: 1, outcome: "cancelled" });
    expect(cancelled.output.text).toContain("工具调用已取消");
  }, 15_000);

  it("does not derive Bash diagnostics from stderr text alone", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);

    const result = await runTool(
      "Bash",
      {
        command:
          "node -e \"process.stderr.write('/bin/sh: 1: python: not found\\nModuleNotFoundError: No module named \\'pandas\\'\\nhealth check failed: Connection refused\\n'); process.exit(1);\"",
      },
      context,
    );

    expect(result.output.data).toMatchObject({ exitCode: 1, outcome: "completed" });
    expect(result.output.data).not.toHaveProperty("diagnostics");
    expect(result.output.text).not.toContain("Linghun recoverable command hints");
  });

  it("does not run capability preflight for ordinary Bash commands", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    const oldPath = process.env.PATH;
    process.env.PATH = await mkdtemp(join(tmpdir(), "linghun-empty-path-"));
    try {
      const result = await runTool(
        "Bash",
        { command: "file sample.elf" },
        context,
      );

      expect(result.output.data).toMatchObject({
        exitCode: 1,
        outcome: "completed",
      });
      expect(result.output.data).not.toHaveProperty("diagnostics");
      expect(result.output.data).not.toHaveProperty("commandCapabilities");
      expect(result.output.text).not.toContain("commandCapability file missing");
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("does not add service diagnostics from connection refused stderr text alone", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);

    const result = await runTool(
      "Bash",
      {
        command:
          "node -e \"process.stderr.write('gRPC health check failed: connection refused\\nHTTP failed to connect to 127.0.0.1:3000\\n'); process.exit(1);\"",
      },
      context,
    );

    expect(result.output.data).toMatchObject({
      exitCode: 1,
      outcome: "completed",
    });
    expect(result.output.data).not.toHaveProperty("diagnostics");
  });

  it("inspects a text file with Bash binary helper hexdump fallback", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "plain.txt"), "hello binary helper\n", "utf8");

    const result = await runTool(
      "Bash",
      { binary: { path: "plain.txt", previewBytes: 8 } },
      createToolContext(project),
    );

    expect(result.output.text).toContain("Binary inspect plain.txt");
    expect(result.output.text).toContain("magic unknown binary/text");
    expect(result.output.text).toContain("hex 68 65 6c 6c 6f 20 62 69");
    expect(result.output.data).toMatchObject({
      exitCode: 0,
      outcome: "binary_inspected",
      binary: {
        size: 20,
        previewBytes: 8,
        hexPreview: "68 65 6c 6c 6f 20 62 69",
        asciiPreview: "hello bi",
        magic: { type: "unknown" },
      },
    });
  });

  it("inspects random binary data without file or xxd", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "random.bin"), Buffer.from([0, 1, 2, 0xff, 0x41, 0x42]));

    const result = await runTool(
      "Bash",
      { binary: { path: "random.bin", previewBytes: 6 } },
      createToolContext(project),
    );

    expect(result.output.text).toContain("hex 00 01 02 ff 41 42");
    expect(result.output.data).toMatchObject({
      exitCode: 0,
      outcome: "binary_inspected",
      binary: {
        hexPreview: "00 01 02 ff 41 42",
        asciiPreview: "....AB",
        magic: { type: "unknown" },
      },
    });
  });

  it("inspects a large binary file with bounded preview bytes", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "large.bin"), Buffer.alloc(1024 * 1024, 0x61));

    const result = await runTool(
      "Bash",
      { binary: { path: "large.bin", previewBytes: 16 } },
      createToolContext(project),
    );

    expect(result.output.data).toMatchObject({
      exitCode: 0,
      outcome: "binary_inspected",
      binary: {
        size: 1024 * 1024,
        previewBytes: 16,
        hexPreview: "61 61 61 61 61 61 61 61 61 61 61 61 61 61 61 61",
        asciiPreview: "aaaaaaaaaaaaaaaa",
      },
    });
  });

  it("parses a minimal ELF header with Bash binary helper", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const elf = Buffer.alloc(64);
    elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
    elf.writeUInt16LE(3, 16);
    elf.writeUInt16LE(62, 18);
    elf.writeBigUInt64LE(0x401000n, 24);
    elf.writeBigUInt64LE(64n, 32);
    elf.writeBigUInt64LE(512n, 40);
    elf.writeUInt16LE(64, 52);
    elf.writeUInt16LE(56, 54);
    elf.writeUInt16LE(2, 56);
    elf.writeUInt16LE(64, 58);
    elf.writeUInt16LE(8, 60);
    elf.writeUInt16LE(7, 62);
    await writeFile(join(project, "sample.elf"), elf);

    const result = await runTool(
      "Bash",
      { binary: { path: "sample.elf", previewBytes: 16 } },
      createToolContext(project),
    );

    expect(result.output.text).toContain("magic ELF executable/shared object");
    expect(result.output.text).toContain("elf 64 little type=shared machine=x86-64 entry=0x401000");
    expect(result.output.data).toMatchObject({
      exitCode: 0,
      outcome: "binary_inspected",
      binary: {
        magic: { type: "elf" },
        elf: {
          class: "64",
          endianness: "little",
          type: "shared",
          machine: "x86-64",
          entry: "0x401000",
          programHeaderCount: 2,
          sectionHeaderCount: 8,
        },
      },
    });
  });

  it("keeps truncated 64-bit ELF inspect successful with an ELF error", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const elf = Buffer.alloc(52);
    elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
    await writeFile(join(project, "truncated.elf"), elf);

    const result = await runTool(
      "Bash",
      { binary: { path: "truncated.elf", previewBytes: 16 } },
      createToolContext(project),
    );

    expect(result.output.text).toContain("elf ELF header is truncated");
    expect(result.output.data).toMatchObject({
      exitCode: 0,
      outcome: "binary_inspected",
      binary: {
        magic: { type: "elf" },
        elf: { error: "ELF header is truncated" },
      },
    });
  });

  it("returns Bash binary helper diagnostics when file is missing", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));

    const result = await runTool(
      "Bash",
      { binary: { path: "missing.bin" } },
      createToolContext(project),
    );

    expect(result.output.text).toContain("Binary inspect failed missing.bin");
    expect(result.output.data).toMatchObject({
      exitCode: 1,
      outcome: "binary_inspect_failed",
      diagnostics: [
        expect.objectContaining({
          type: "artifact_preservation",
          severity: "blocking",
          evidence: expect.stringContaining("binary inspect failed for missing.bin"),
          suggestion: expect.any(String),
        }),
      ],
    });
  });

  it("checks an artifact file exists with size and sha256", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "artifact.txt"), "artifact-ok\n", "utf8");

    const result = await runTool(
      "Bash",
      { artifact: { path: "artifact.txt" } },
      createToolContext(project),
    );

    expect(result.output.text).toContain("Artifact check artifact.txt");
    expect(result.output.data).toMatchObject({
      exitCode: 0,
      outcome: "artifact_checked",
      artifact: {
        path: "artifact.txt",
        exists: true,
        isFile: true,
        isDirectory: false,
        size: 12,
        sha256: expect.any(String),
      },
      protectPaths: [],
    });
  });

  it("checks artifact header match and mismatch", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "header.txt"), "MAGIC: body\n", "utf8");

    const ok = await runTool(
      "Bash",
      { artifact: { path: "header.txt", expectHeader: "MAGIC:" } },
      createToolContext(project),
    );
    const failed = await runTool(
      "Bash",
      { artifact: { path: "header.txt", expectHeader: "WRONG" } },
      createToolContext(project),
    );

    expect(ok.output.data).toMatchObject({
      exitCode: 0,
      outcome: "artifact_checked",
      artifact: { checks: { header: { ok: true } } },
    });
    expect(failed.output.text).toContain("header failed");
    expect(failed.output.data).toMatchObject({
      exitCode: 1,
      outcome: "artifact_check_failed",
      artifact: { checks: { header: { ok: false, expected: "WRONG" } } },
      diagnostics: [
        expect.objectContaining({
          type: "artifact_preservation",
          severity: "blocking",
          evidence: expect.stringContaining("wrong header header.txt"),
        }),
      ],
    });
  });

  it("checks valid and invalid JSON artifacts", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "valid.json"), "{\"ok\":true}\n", "utf8");
    await writeFile(join(project, "invalid.json"), "{\"ok\":\n", "utf8");

    const valid = await runTool(
      "Bash",
      { artifact: { path: "valid.json", json: true } },
      createToolContext(project),
    );
    const invalid = await runTool(
      "Bash",
      { artifact: { path: "invalid.json", json: true } },
      createToolContext(project),
    );

    expect(valid.output.data).toMatchObject({
      exitCode: 0,
      outcome: "artifact_checked",
      artifact: { checks: { json: { ok: true } } },
    });
    expect(invalid.output.data).toMatchObject({
      exitCode: 1,
      outcome: "artifact_check_failed",
      artifact: { checks: { json: { ok: false } } },
      diagnostics: [
        expect.objectContaining({
          type: "artifact_preservation",
          evidence: "output format mismatch invalid.json: invalid JSON",
        }),
      ],
    });
  });

  it("checks Bash.artifact text lineSet expectations explicitly", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "move.txt"), "e2e4\n", "utf8");

    const missing = await runTool(
      "Bash",
      { artifact: { path: "move.txt", text: { lineSet: ["e2e4", "g2g4"] } } },
      createToolContext(project),
    );
    await writeFile(join(project, "move.txt"), "g2g4\ne2e4\n", "utf8");
    const complete = await runTool(
      "Bash",
      { artifact: { path: "move.txt", text: { lineSet: ["e2e4", "g2g4"] } } },
      createToolContext(project),
    );

    expect(missing.output.data).toMatchObject({
      exitCode: 1,
      outcome: "artifact_check_failed",
      artifact: { checks: { text: { ok: false, lineSet: { missing: ["g2g4"] } } } },
      diagnostics: [expect.objectContaining({ type: "artifact_preservation", path: "move.txt" })],
    });
    expect(complete.output.data).toMatchObject({
      exitCode: 0,
      outcome: "artifact_checked",
      artifact: { checks: { text: { ok: true, lineSet: { ok: true, missing: [] } } } },
    });
  });

  it("checks Bash.artifact raw and normalized HTML preservation explicitly", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const clean = "<!doctype html>\n<html><body><h1 class=\"title\" id=\"welcome\">Welcome &amp; hello</h1><br></body></html>\n";
    await writeFile(join(project, "clean.html"), clean, "utf8");
    await writeFile(
      join(project, "changed.html"),
      "<!doctype html>\n<html><body><h1 class=\"title\" id=\"welcome\">Welcome!</h1><br></body></html>\n",
      "utf8",
    );
    await writeFile(
      join(project, "formatted.html"),
      "<!doctype html>\n<html>\n<body>\n<h1 id=\"welcome\" class=\"title\">Welcome & hello</h1>\n<br />\n</body>\n</html>\n",
      "utf8",
    );

    const rawFailed = await runTool(
      "Bash",
      { artifact: { path: "changed.html", preserve: { mode: "rawPreserve", expectedText: clean } } },
      createToolContext(project),
    );
    const normalizedFailed = await runTool(
      "Bash",
      { artifact: { path: "changed.html", preserve: { mode: "compareNormalizedHtml", expectedPath: "clean.html" } } },
      createToolContext(project),
    );
    const normalizedOk = await runTool(
      "Bash",
      { artifact: { path: "formatted.html", preserve: { mode: "compareNormalizedHtml", expectedPath: "clean.html" } } },
      createToolContext(project),
    );

    expect(rawFailed.output.data).toMatchObject({
      exitCode: 1,
      diagnostics: [expect.objectContaining({ type: "artifact_preservation", path: "changed.html" })],
    });
    expect(normalizedFailed.output.data).toMatchObject({
      exitCode: 1,
      artifact: { checks: { preserve: { ok: false, mode: "compareNormalizedHtml" } } },
    });
    expect(normalizedOk.output.data).toMatchObject({
      exitCode: 0,
      artifact: { checks: { preserve: { ok: true, mode: "compareNormalizedHtml" } } },
    });
  });

  it("canonicalizes html preservation with attributes, entities, void elements, and structure", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const clean = [
      "<!doctype html>",
      "<html><body>",
      "<img src=\"x.png\" alt=\"Alpha &amp; Beta\">",
      "<input disabled value=\"yes\">",
      "<p>Alpha&nbsp;Beta &amp; safe</p>",
      "<script>window.clean = true;</script>",
      "</body></html>",
    ].join("");
    await writeFile(join(project, "clean.html"), clean, "utf8");
    await writeFile(
      join(project, "equivalent.html"),
      [
        "<img alt=\"Alpha & Beta\" src=\"x.png\" />",
        "<input value=\"yes\" disabled=\"\" />",
        "<p>Alpha Beta & safe</p>",
        "<script>window.clean = true;</script>",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(project, "script-removed.html"),
      "<img alt=\"Alpha & Beta\" src=\"x.png\"><input value=\"yes\" disabled><p>Alpha&nbsp;Beta &amp; safe</p>",
      "utf8",
    );
    await writeFile(
      join(project, "script-added.html"),
      `${clean}<script>window.extra = true;</script>`,
      "utf8",
    );
    await writeFile(
      join(project, "script-whitespace-changed.html"),
      clean.replace("window.clean = true;", "window.clean=true;"),
      "utf8",
    );

    const equivalent = await runTool(
      "Bash",
      { artifact: { path: "equivalent.html", preserve: { mode: "compareNormalizedHtml", expectedPath: "clean.html" } } },
      createToolContext(project),
    );
    const removed = await runTool(
      "Bash",
      { artifact: { path: "script-removed.html", preserve: { mode: "compareNormalizedHtml", expectedPath: "clean.html" } } },
      createToolContext(project),
    );
    const added = await runTool(
      "Bash",
      { artifact: { path: "script-added.html", preserve: { mode: "compareNormalizedHtml", expectedPath: "clean.html" } } },
      createToolContext(project),
    );
    const scriptWhitespaceChanged = await runTool(
      "Bash",
      {
        artifact: {
          path: "script-whitespace-changed.html",
          preserve: { mode: "compareNormalizedHtml", expectedPath: "clean.html" },
        },
      },
      createToolContext(project),
    );

    expect(equivalent.output.data).toMatchObject({
      exitCode: 0,
      outcome: "artifact_checked",
      artifact: { checks: { preserve: { ok: true, mode: "compareNormalizedHtml" } } },
    });
    expect(removed.output.data).toMatchObject({
      exitCode: 1,
      outcome: "artifact_check_failed",
      diagnostics: [expect.objectContaining({ type: "artifact_preservation", path: "script-removed.html" })],
    });
    expect(added.output.data).toMatchObject({
      exitCode: 1,
      outcome: "artifact_check_failed",
      diagnostics: [expect.objectContaining({ type: "artifact_preservation", path: "script-added.html" })],
    });
    expect(scriptWhitespaceChanged.output.data).toMatchObject({
      exitCode: 1,
      outcome: "artifact_check_failed",
      diagnostics: [expect.objectContaining({ type: "artifact_preservation", path: "script-whitespace-changed.html" })],
    });
  });

  it("checks protected paths as clean when read snapshot still matches", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "input.txt"), "input\n", "utf8");
    await writeFile(join(project, "output.txt"), "output\n", "utf8");
    const context = createToolContext(project);

    await runTool("Read", { path: "input.txt" }, context);
    const result = await runTool(
      "Bash",
      { artifact: { path: "output.txt", protectPaths: ["input.txt"] } },
      context,
    );

    expect(result.output.data).toMatchObject({
      exitCode: 0,
      outcome: "artifact_checked",
      protectPaths: [
        expect.objectContaining({
          path: "input.txt",
          exists: true,
          modified: false,
          baseline: "readSnapshot",
        }),
      ],
    });
  });

  it("returns artifact_preservation diagnostics when protected paths changed", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "input.txt"), "input\n", "utf8");
    await writeFile(join(project, "output.txt"), "output\n", "utf8");
    const context = createToolContext(project);

    await runTool("Read", { path: "input.txt" }, context);
    await writeFile(join(project, "input.txt"), "changed\n", "utf8");
    const result = await runTool(
      "Bash",
      { artifact: { path: "output.txt", protectPaths: ["input.txt"] } },
      context,
    );

    expect(result.output.data).toMatchObject({
      exitCode: 1,
      outcome: "artifact_check_failed",
      protectPaths: [expect.objectContaining({ path: "input.txt", modified: true })],
      diagnostics: [
        expect.objectContaining({
          type: "artifact_preservation",
          severity: "blocking",
          evidence: "protected input modified input.txt",
        }),
      ],
    });
  });

  it("returns artifact_preservation diagnostics when artifact is missing", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));

    const result = await runTool(
      "Bash",
      { artifact: { path: "missing.out" } },
      createToolContext(project),
    );

    expect(result.output.text).toContain("Artifact check missing.out");
    expect(result.output.data).toMatchObject({
      exitCode: 1,
      outcome: "artifact_check_failed",
      artifact: { path: "missing.out", exists: false },
      diagnostics: [
        expect.objectContaining({
          type: "artifact_preservation",
          severity: "blocking",
          evidence: expect.stringContaining("artifact missing or unreadable missing.out"),
          suggestion: expect.any(String),
        }),
      ],
    });
  });

  it("keeps ordinary Bash output unchanged when auto evidence has no trigger", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));

    const result = await runTool(
      "Bash",
      { command: "node -e \"console.log('plain output')\"" },
      createToolContext(project),
    );

    expect(result.output.text).toContain("plain output");
    expect(result.output.text).not.toContain("Linghun auto evidence:");
    expect(result.output.data).toEqual({ exitCode: 0, outcome: "completed" });
  });

  it("does not add Bash binary preflight evidence for ordinary inspect commands", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "preflight.bin"), Buffer.from([0, 1, 2, 3]));

    const result = await runTool(
      "Bash",
      { command: "file preflight.bin" },
      createToolContext(project),
    );

    expect(result.output.text).not.toContain("Linghun preflight evidence:");
    expect(result.output.data).toMatchObject({ outcome: "completed" });
    expect(result.output.data).not.toHaveProperty("binaryPreflight");
  });

  it("keeps ordinary Bash output data unchanged when capability preflight has no trigger", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));

    const result = await runTool(
      "Bash",
      { command: "node -e \"process.stdout.write('zero-disturbance')\"" },
      createToolContext(project),
    );

    expect(result.output.text).toContain("zero-disturbance");
    expect(result.output.data).toEqual({ exitCode: 0, outcome: "completed" });
  });

  it("keeps ordinary Bash command text from injecting preflight or auto evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "a.out"), Buffer.from([0x7f, 0x45, 0x4c, 0x46]));

    const inlineScript = await runTool(
      "Bash",
      { command: "node -e \"const value = 'let print stay script text'; console.log(value);\"" },
      createToolContext(project),
    );
    expect(inlineScript.output.data).toEqual({ exitCode: 0, outcome: "completed" });
    expect(inlineScript.output.data).not.toHaveProperty("diagnostics");

    const html = await runTool(
      "Bash",
      { command: "node -e \"console.log('<html><h1>welcome</h1></html>')\"" },
      createToolContext(project),
    );
    expect(html.output.data).toEqual({ exitCode: 0, outcome: "completed" });
    expect(JSON.stringify(html.output.data)).not.toMatch(/artifactHint|artifact_preservation|welcome|html/u);

    const redirected = await runTool(
      "Bash",
      { command: "node -e \"process.stdout.write('{\\\"ok\\\":true}\\n')\" > out.json" },
      createToolContext(project),
    );
    expect(redirected.output.data).toEqual({ exitCode: 0, outcome: "completed" });
    expect(redirected.output.data).not.toHaveProperty("artifactHint");

    const binary = await runTool("Bash", { command: "file a.out" }, createToolContext(project));
    expect(binary.output.data).toMatchObject({ outcome: "completed" });
    expect(binary.output.data).not.toHaveProperty("binaryPreflight");
    expect(binary.output.data).not.toHaveProperty("binaryHint");

    const service = await runTool(
      "Bash",
      { command: "node -e \"console.log('PORT=8080 python3 -m http.server')\"" },
      createToolContext(project),
    );
    expect(service.output.data).toEqual({ exitCode: 0, outcome: "completed" });
    expect(service.output.data).not.toHaveProperty("serviceHint");
  });

  it("parses Bash command intent with command names, argv, redirections, and background intent", () => {
    const intent = __testParseBashCommandIntent("python -c \"print('ok')\" > result.json &");

    expect(intent.commandNames).toEqual(["python"]);
    expect(intent.segments[0]).toMatchObject({
      commandName: "python",
      argv: ["-c", "print('ok')", ">", "result.json"],
      background: true,
      redirections: [{ operator: ">", target: "result.json" }],
    });
    expect(intent.artifactCandidates).toContain("result.json");
    expect(intent.backgroundLikely).toBe(true);
  });

  it("keeps Bash command intent conservative for shell syntax and variables", () => {
    const conditional = __testParseBashCommandIntent("if command -v 7z >/dev/null 2>&1; then true; fi");
    expect(conditional.commandNames).not.toEqual(expect.arrayContaining(["then", "1", "fi"]));
    expect(conditional.artifactCandidates).not.toEqual(expect.arrayContaining(["/dev/null", "1"]));

    const tempVar = __testParseBashCommandIntent("tmp=$(mktemp); python3 filter.py \"$tmp\"");
    expect(tempVar.commandNames).toContain("python3");
    expect(tempVar.artifactCandidates).not.toContain("$tmp");
    expect(tempVar.artifactCandidates).not.toContain("${tmp}");

    const service = __testParseBashCommandIntent("PORT=8080 python3 -m http.server");
    expect(service.commandNames).toEqual(["python3"]);
    expect(service.serviceCandidates).toEqual([
      expect.objectContaining({ kind: "http-server", port: 8080 }),
    ]);

    const redirected = __testParseBashCommandIntent("python3 script.py > out.json");
    expect(redirected.commandNames).toEqual(["python3"]);
    expect(redirected.artifactCandidates).toEqual(["out.json"]);
    expect(redirected.segments[0]?.redirections).toEqual([{ operator: ">", target: "out.json" }]);

    const subshell = __testParseBashCommandIntent("(cd john/run && ./7z2john.pl /app/secrets.7z)");
    expect(subshell.commandNames).toEqual(expect.arrayContaining(["cd", "./7z2john.pl"]));
    expect(subshell.commandNames).not.toEqual(expect.arrayContaining(["(cd", "(command", "then", "1"]));

    const testExpression = __testParseBashCommandIntent("[ -f file ] && echo ok");
    expect(testExpression.commandNames).toEqual(["echo"]);
    expect(testExpression.commandNames).not.toContain("[");
  });

  it("only allows python alias fallback for simple exact python commands", () => {
    expect(__testCanSafelyAliasPythonCommand(__testParseBashCommandIntent("python -c \"print('ok')\""))).toBe(true);
    expect(__testCanSafelyAliasPythonCommand(__testParseBashCommandIntent("echo python -c test"))).toBe(false);
    expect(__testCanSafelyAliasPythonCommand(__testParseBashCommandIntent("python -c \"print('ok')\" | cat"))).toBe(false);
    expect(__testCanSafelyAliasPythonCommand(__testParseBashCommandIntent("python -c \"print('ok')\" > out.txt"))).toBe(false);
  });

  it("does not alias python through capability preflight for ordinary Bash commands", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const binDir = join(project, "bin");
    await mkdir(binDir, { recursive: true });
    const python3Path = join(binDir, process.platform === "win32" ? "python3.cmd" : "python3");
    const nodePath = process.execPath.replaceAll('"', '\\"');
    await writeFile(
      python3Path,
      process.platform === "win32"
        ? `@echo off\r\n"${nodePath}" -e "console.log('python3-alias-ok')"\r\n`
        : `#!/bin/sh\n"${nodePath}" -e "console.log('python3-alias-ok')"\n`,
      "utf8",
    );
    if (process.platform !== "win32") {
      await chmod(python3Path, 0o755);
    }
    const oldPath = process.env.PATH;
    process.env.PATH = binDir;
    try {
      const result = await runTool(
        "Bash",
        { command: "python -c \"print('ignored by shim')\"" },
        createToolContext(project),
      );

      expect(result.output.text).not.toContain("python3-alias-ok");
      expect(result.output.text).not.toContain("pythonAlias python -> python3");
      expect(result.output.data).toMatchObject({
        exitCode: 1,
        outcome: "completed",
      });
      expect(result.output.data).not.toHaveProperty("diagnostics");
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("does not add binary auto evidence from missing-tool stderr path text alone", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const elf = Buffer.alloc(64);
    elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
    await writeFile(join(project, "sample.elf"), elf);

    const result = await runTool(
      "Bash",
      { command: "node -e \"process.stderr.write('xxd: command not found sample.elf\\n'); process.exit(1);\"" },
      createToolContext(project),
    );

    expect(result.output.text).not.toContain("binaryHint");
    expect(result.output.data).toMatchObject({
      exitCode: 1,
      outcome: "completed",
    });
    expect(result.output.data).not.toHaveProperty("diagnostics");
  });

  it("does not add service auto evidence from connection refused stderr target text alone", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));

    const result = await runTool(
      "Bash",
      {
        command:
          "node -e \"process.stderr.write('health check failed: connection refused http://127.0.0.1:9/health\\n'); process.exit(1);\"",
      },
      createToolContext(project),
    );

    expect(result.output.text).not.toContain("serviceHint tcp 127.0.0.1:9");
    expect(result.output.data).toMatchObject({
      exitCode: 1,
      outcome: "completed",
    });
    expect(result.output.data).not.toHaveProperty("diagnostics");
  });

  it("does not add binary auto evidence from intent candidates in ordinary Bash", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const elf = Buffer.alloc(64);
    elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
    await writeFile(join(project, "sample.elf"), elf);
    const oldPath = process.env.PATH;
    process.env.PATH = await mkdtemp(join(tmpdir(), "linghun-empty-path-"));

    try {
      const result = await runTool(
        "Bash",
        { command: "xxd sample.elf" },
        createToolContext(project),
      );

      expect(result.output.text).not.toContain("binaryHint");
      expect(result.output.data).toMatchObject({ exitCode: 1, outcome: "completed" });
      expect(result.output.data).not.toHaveProperty("binaryHint");
      expect(result.output.data).not.toHaveProperty("diagnostics");
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("does not add serviceHint from ordinary Bash command text", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const port = await getFreeTcpPort();
    const server = createServer((socket) => {
      socket.on("error", () => undefined);
      socket.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
    try {
      const result = await runTool(
        "Bash",
        {
          command:
            `node -e "console.log('noise http://127.0.0.1:9')" server --port ${port}`,
        },
        createToolContext(project),
      );

      expect(result.output.data).toMatchObject({ outcome: "completed" });
      expect(result.output.data).not.toHaveProperty("serviceHint");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not treat plain numeric script arguments as service intent", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));

    const result = await runTool(
      "Bash",
      { command: "node -e \"console.log('arg only')\" 5432" },
      createToolContext(project),
    );

    expect(JSON.stringify(result.output.data)).not.toContain("serviceHint");
  });

  it("does not create service intent from server words without a port", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));

    const result = await runTool(
      "Bash",
      { command: "node -e \"console.log('server text only')\" server listen serve" },
      createToolContext(project),
    );

    expect(JSON.stringify(result.output.data)).not.toContain("serviceHint");
  });

  it("does not create serviceHint for ordinary python http.server commands", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const port = await getFreeTcpPort();
    const server = createServer((socket) => {
      socket.on("error", () => undefined);
      socket.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
    try {
      const result = await runTool(
        "Bash",
        { command: `python3 -m http.server ${port} --help` },
        createToolContext(project),
      );

      expect(result.output.data).toMatchObject({ outcome: "completed" });
      expect(result.output.data).not.toHaveProperty("serviceHint");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not infer package-script service intent from ordinary Bash", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const noPort = await runTool(
      "Bash",
      { command: "npm start" },
      createToolContext(project),
    );
    expect(JSON.stringify(noPort.output.data)).not.toContain("serviceHint");

    const result = await runTool(
      "Bash",
      { command: "PORT=9 npm start" },
      createToolContext(project),
    );
    expect(result.output.data).toMatchObject({ exitCode: 1, outcome: "completed" });
    expect(result.output.data).not.toHaveProperty("serviceHint");
  });

  it("does not infer node service intent from ordinary Bash", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const noPort = await runTool(
      "Bash",
      { command: "node server.js" },
      createToolContext(project),
    );
    expect(JSON.stringify(noPort.output.data)).not.toContain("serviceHint");

    const port = await getFreeTcpPort();
    const server = createServer((socket) => {
      socket.on("error", () => undefined);
      socket.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
    try {
      const result = await runTool(
        "Bash",
        { command: `node server.js --port ${port}` },
        createToolContext(project),
      );
      expect(result.output.data).toMatchObject({ outcome: "completed" });
      expect(result.output.data).not.toHaveProperty("serviceHint");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not run implicit service probes even when readiness diagnostics already exist", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project) as ReturnType<typeof createToolContext> & {
      headlessBench?: { enabled: boolean };
    };
    context.headlessBench = { enabled: true };
    context.recentDiagnostics = [
      {
        source: "Bash",
        type: "service_readiness",
        severity: "recoverable",
        evidence: "previous service not ready",
        createdAt: new Date().toISOString(),
      },
    ];
    const port = await getFreeTcpPort();
    const server = createServer((socket) => {
      socket.on("error", () => undefined);
      socket.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
    try {
      const result = await runTool(
        "Bash",
        {
          command:
            `node -e "console.log('service command')" -- --port ${port}`,
        },
        context,
      );

      expect(result.output.data).toMatchObject({ exitCode: 0, outcome: "completed" });
      expect(result.output.data).not.toHaveProperty("serviceHint");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not add artifact auto evidence only from successful output text", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "result.json"), "{\"ok\":true}\n", "utf8");

    const result = await runTool(
      "Bash",
      { command: "node -e \"console.log('wrote result.json')\"" },
      createToolContext(project),
    );

    expect(JSON.stringify(result.output.data)).not.toContain("artifactHint");
  });

  it("does not add artifactHint from ordinary redirection text", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "intended.json"), "{\"ok\":true}\n", "utf8");
    await writeFile(join(project, "noise.json"), "{\"noise\":true}\n", "utf8");

    const result = await runTool(
      "Bash",
      { command: "node -e \"console.log('wrote noise.json')\" > intended.json" },
      createToolContext(project),
    );

    expect(result.output.data).toEqual({ exitCode: 0, outcome: "completed" });
  });

  it("does not treat ordinary input file suffixes as artifact intent", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "input.json"), "{\"ok\":true}\n", "utf8");

    const result = await runTool(
      "Bash",
      { command: "node -e \"console.log('read only')\" input.json" },
      createToolContext(project),
    );

    expect(JSON.stringify(result.output.data)).not.toContain("artifactHint");
  });

  it("does not add artifactHint from ordinary producing command text", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));

    const result = await runTool(
      "Bash",
      { command: "node -e \"require('node:fs').writeFileSync('made.md', 'ok')\" created made.md" },
      createToolContext(project),
    );

    expect(result.output.data).toEqual({ exitCode: 0, outcome: "completed" });
  });

  it("does not add artifact auto evidence for ordinary output flags", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const content = "print('ok')\n";
    await writeFile(join(project, "script.py"), content, "utf8");
    const result = await runTool(
      "Bash",
      { command: "node -e \"console.log('created script.py')\" -- --output script.py" },
      createToolContext(project),
    );

    expect(result.output.data).toEqual({ exitCode: 0, outcome: "completed" });
  });

  it("does not return artifact diagnostics for ordinary missing output flags", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));

    const result = await runTool(
      "Bash",
      { command: "node -e \"process.exit(0)\" -- --output missing-result.json" },
      createToolContext(project),
    );

    expect(result.output.data).toEqual({ exitCode: 0, outcome: "completed" });
  });

  it("starts a Bash service and waits for TCP readiness", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    const port = await getFreeTcpPort();

    const result = await runTool(
      "Bash",
      {
        command:
          `node -e "const net=require('node:net'); const server=net.createServer((socket)=>socket.end('ok')); server.listen(${port}, '127.0.0.1'); setTimeout(()=>server.close(), 2500);"`,
        service: { type: "tcp", host: "127.0.0.1", port, timeoutMs: 2_000, intervalMs: 50 },
      },
      context,
    );

    expect(result.output.text).toContain("Service started and ready");
    expect(result.output.data).toMatchObject({
      exitCode: 0,
      outcome: "service_ready",
      service: {
        serviceId: expect.any(String),
        cwd: project,
        status: "ready",
        ready: true,
        target: `127.0.0.1:${port}`,
        targetHost: "127.0.0.1",
        targetPort: port,
        alive: true,
        readiness: { ok: true },
      },
    });
    expect(context.services?.[0]).toMatchObject({
      serviceId: (result.output.data as { service: { serviceId: string } }).service.serviceId,
      status: "ready",
      targetPort: port,
    });
    expect(JSON.stringify(result.output.data)).not.toContain("diagnostics");
    expect(result.output.fullOutputPath).toBeTruthy();
    await stopServiceFromOutput(result.output.data);
  });

  it("service lifecycle start ready then status reports ready", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    const port = await getFreeTcpPort();

    const started = await runTool(
      "Bash",
      {
        command:
          `node -e "const net=require('node:net'); const server=net.createServer((socket)=>socket.end('ok')); server.listen(${port}, '127.0.0.1'); setTimeout(()=>server.close(), 2500);"` ,
        service: { type: "tcp", host: "127.0.0.1", port, timeoutMs: 2_000, intervalMs: 50 },
      },
      context,
    );
    const serviceId = (started.output.data as { service: { serviceId: string } }).service.serviceId;

    const status = await runTool("Bash", { service: { action: "status", serviceId } }, context);

    expect(status.output.text).toContain("Service status ready");
    expect(status.output.data).toMatchObject({
      exitCode: 0,
      outcome: "service_ready",
      service: {
        serviceId,
        status: "ready",
        ready: true,
        target: `127.0.0.1:${port}`,
      },
    });
    await runTool("Bash", { service: { action: "stop", serviceId } }, context);
  });

  it("service lifecycle logs returns bounded tail", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    const port = await getFreeTcpPort();

    const started = await runTool(
      "Bash",
      {
        command:
          `node -e "const net=require('node:net'); console.log('lifecycle-log-start'); const server=net.createServer((socket)=>socket.end('ok')); server.listen(${port}, '127.0.0.1'); setTimeout(()=>server.close(), 2500);"` ,
        service: { type: "tcp", host: "127.0.0.1", port, timeoutMs: 2_000, intervalMs: 50 },
      },
      context,
    );
    const serviceId = (started.output.data as { service: { serviceId: string } }).service.serviceId;

    const logs = await runTool("Bash", { service: { action: "logs", serviceId, tailBytes: 200 } }, context);

    expect(logs.output.text).toContain("Service logs tail");
    expect(logs.output.text.length).toBeLessThan(1_000);
    expect(logs.output.data).toMatchObject({
      exitCode: 0,
      outcome: "service_logs",
      service: {
        serviceId,
        logTail: expect.stringContaining("lifecycle-log-start"),
      },
    });
    await runTool("Bash", { service: { action: "stop", serviceId } }, context);
  });

  it("service lifecycle probe reports ready and not-ready with structured diagnostics", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    const port = await getFreeTcpPort();

    const started = await runTool(
      "Bash",
      {
        command:
          `node -e "const net=require('node:net'); const server=net.createServer((socket)=>socket.end('ok')); server.listen(${port}, '127.0.0.1'); setTimeout(()=>server.close(()=>process.exit(0)), 350);"` ,
        service: { type: "tcp", host: "127.0.0.1", port, timeoutMs: 2_000, intervalMs: 50 },
      },
      context,
    );
    const serviceId = (started.output.data as { service: { serviceId: string } }).service.serviceId;

    const readyProbe = await runTool("Bash", { service: { action: "probe", serviceId } }, context);
    expect(readyProbe.output.data).toMatchObject({
      outcome: "service_ready",
      service: { serviceId, ready: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 650));
    const notReadyProbe = await runTool("Bash", { service: { action: "probe", serviceId } }, context);
    expect(notReadyProbe.output.data).toMatchObject({
      exitCode: 1,
      outcome: "service_not_ready",
      service: { serviceId, status: "exited", ready: false },
      diagnostics: [
        expect.objectContaining({
          type: "service_readiness",
          target: `127.0.0.1:${port}`,
          targetHost: "127.0.0.1",
          targetPort: port,
        }),
      ],
    });
  });

  it("service lifecycle stop only stops registered services", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    const port = await getFreeTcpPort();

    const missing = await runTool("Bash", { service: { action: "stop", serviceId: "svc_missing" } }, context);
    expect(missing.output.data).toMatchObject({
      exitCode: 0,
      outcome: "service_missing",
      service: { serviceId: "svc_missing", status: "missing" },
    });

    const started = await runTool(
      "Bash",
      {
        command:
          `node -e "const net=require('node:net'); const server=net.createServer((socket)=>socket.end('ok')); server.listen(${port}, '127.0.0.1'); setTimeout(()=>server.close(), 5000);"` ,
        service: { type: "tcp", host: "127.0.0.1", port, timeoutMs: 2_000, intervalMs: 50 },
      },
      context,
    );
    const serviceId = (started.output.data as { service: { serviceId: string } }).service.serviceId;

    const stopped = await runTool("Bash", { service: { action: "stop", serviceId } }, context);
    expect(stopped.output.data).toMatchObject({
      exitCode: 0,
      outcome: "service_stopped",
      service: { serviceId, status: "stopped", ready: false },
    });

    const status = await runTool("Bash", { service: { action: "status", serviceId } }, context);
    expect(status.output.data).toMatchObject({
      exitCode: 0,
      outcome: "service_stopped",
      service: { serviceId, status: "stopped", ready: false },
    });

    const probe = await runTool("Bash", { service: { action: "probe", serviceId } }, context);
    expect(probe.output.data).toMatchObject({
      exitCode: 1,
      outcome: "service_not_ready",
      service: { serviceId, status: "stopped", ready: false },
      diagnostics: [
        expect.objectContaining({
          type: "service_readiness",
          target: `127.0.0.1:${port}`,
          targetHost: "127.0.0.1",
          targetPort: port,
        }),
      ],
    });
  });

  it("service lifecycle stop returns diagnostic when exit cannot be confirmed", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    const fakeProcess = {
      pid: 123456,
      exitCode: null,
      signalCode: null,
      kill: () => false,
      once: () => fakeProcess,
    };
    context.services = [
      {
        serviceId: "svc_unstoppable",
        pid: 123456,
        cwd: project,
        command: "fake service",
        logPath: join(project, "fake.log"),
        target: "127.0.0.1:9",
        targetHost: "127.0.0.1",
        targetPort: 9,
        readiness: { type: "tcp", host: "127.0.0.1", port: 9 },
        ready: true,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOutputTail: "",
        status: "ready",
        process: fakeProcess as never,
        detached: false,
      },
    ];

    const stopped = await runTool(
      "Bash",
      { service: { action: "stop", serviceId: "svc_unstoppable" } },
      context,
    );

    expect(stopped.output.data).toMatchObject({
      exitCode: 1,
      outcome: "service_stop_failed",
      service: { serviceId: "svc_unstoppable", status: "not_ready", ready: false },
      diagnostics: [
        expect.objectContaining({
          type: "service_readiness",
          target: "127.0.0.1:9",
          targetHost: "127.0.0.1",
          targetPort: 9,
        }),
      ],
    });
  });

  it("starts a Bash service and waits for HTTP readiness", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const port = await getFreeTcpPort();

    const result = await runTool(
      "Bash",
      {
        command:
          `node -e "const http=require('node:http'); const server=http.createServer((req,res)=>{res.end('ok')}); server.listen(${port}, '127.0.0.1'); setTimeout(()=>server.close(), 2500);"`,
        service: { type: "http", url: `http://127.0.0.1:${port}/health`, timeoutMs: 2_000, intervalMs: 50 },
      },
      createToolContext(project),
    );

    expect(result.output.text).toContain("Service started and ready");
    expect(result.output.data).toMatchObject({
      exitCode: 0,
      outcome: "service_ready",
      service: { readiness: { ok: true, target: `http://127.0.0.1:${port}/health` } },
    });
    await stopServiceFromOutput(result.output.data);
  });

  it("checks Bash.service fetch status and body contains explicitly", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const port = await getFreeTcpPort();
    const server = createHttpServer((req, res) => {
      if (req.url === "/simple/vectorops/") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><a href='vectorops-0.1.0.tar.gz'>vectorops-0.1.0</a></html>");
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
    try {
      const ok = await runTool(
        "Bash",
        {
          service: {
            action: "fetch",
            url: `http://127.0.0.1:${port}/simple/vectorops/`,
            expectStatus: 200,
            bodyContains: "vectorops-0.1.0",
          },
        },
        createToolContext(project),
      );
      const missing = await runTool(
        "Bash",
        {
          service: {
            action: "fetch",
            url: `http://127.0.0.1:${port}/missing/`,
            expectStatus: 200,
            bodyContains: "vectorops-0.1.0",
          },
        },
        createToolContext(project),
      );

      expect(ok.output.data).toMatchObject({
        exitCode: 0,
        outcome: "service_ready",
        service: { ready: true, fetch: { status: 200, missingBody: [] } },
      });
      expect(missing.output.data).toMatchObject({
        exitCode: 1,
        outcome: "service_not_ready",
        service: { ready: false, fetch: { status: 404, missingBody: ["vectorops-0.1.0"] } },
        diagnostics: [
          expect.objectContaining({
            type: "service_readiness",
            target: `http://127.0.0.1:${port}/missing/`,
            targetHost: "127.0.0.1",
            targetPort: port,
          }),
        ],
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("ignores Bash service output after readiness closes the service log", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const port = await getFreeTcpPort();

    const result = await runTool(
      "Bash",
      {
        command:
          `node -e "const net=require('node:net'); const server=net.createServer((socket)=>socket.end('ok')); server.listen(${port}, '127.0.0.1', ()=>{setTimeout(()=>process.stdout.write('after-ready\\\\n'), 50); setTimeout(()=>server.close(()=>process.exit(0)), 100);});"`,
        service: { type: "tcp", host: "127.0.0.1", port, timeoutMs: 2_000, intervalMs: 50 },
      },
      createToolContext(project),
    );

    expect(result.output.data).toMatchObject({ exitCode: 0, outcome: "service_ready" });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const fullOutput = await readFile(String(result.output.fullOutputPath), "utf8");
    expect(fullOutput).toContain("service cwd");
  });

  it("returns service_readiness diagnostics when a Bash service is not ready before timeout", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const port = await getFreeTcpPort();

    const result = await runTool(
      "Bash",
      {
        command: 'node -e "setTimeout(()=>{}, 2500)"',
        service: { type: "tcp", host: "127.0.0.1", port, timeoutMs: 200, intervalMs: 50 },
      },
      createToolContext(project),
    );

    expect(result.output.text).toContain("Service readiness failed");
    expect(result.output.data).toMatchObject({
      exitCode: 1,
      outcome: "service_not_ready",
      service: {
        target: `127.0.0.1:${port}`,
        targetHost: "127.0.0.1",
        targetPort: port,
      },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          type: "service_readiness",
          severity: "recoverable",
          target: `127.0.0.1:${port}`,
          targetHost: "127.0.0.1",
          targetPort: port,
        }),
      ]),
    });
    await stopServiceFromOutput(result.output.data);
  });

  it("returns service_readiness diagnostics when a Bash service exits before readiness", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const port = await getFreeTcpPort();

    const result = await runTool(
      "Bash",
      {
        command: "node -e \"process.stderr.write('boot failed\\n'); process.exit(3);\"",
        service: { type: "tcp", host: "127.0.0.1", port, timeoutMs: 1_000, intervalMs: 50 },
      },
      createToolContext(project),
    );

    expect(result.output.data).toMatchObject({
      exitCode: 1,
      outcome: "service_exited",
      service: { alive: false },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          type: "service_readiness",
          evidence: expect.stringContaining("service process exited before readiness"),
        }),
      ]),
    });
    const fullOutput = await readFile(String(result.output.fullOutputPath), "utf8");
    expect(fullOutput).toContain("boot failed");
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

    const timeoutSentinel = join(project, "timeout-grandchild.txt");
    const timeout = await runTool(
      "Bash",
      {
        command: `node ${JSON.stringify(scriptPath)} ${JSON.stringify(timeoutSentinel)}`,
        timeoutMs: 50,
      },
      createToolContext(project),
    );

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

    expect(cancelled.output.data).toMatchObject({ exitCode: 1, outcome: "cancelled" });
    if (process.platform === "win32") {
      await expect(readFile(cancelSentinel, "utf8")).rejects.toThrow();
    }
    await rm(cancelSentinel, { force: true });
  });

  it("terminates POSIX Bash process groups on timeout", async () => {
    if (process.platform === "win32") {
      return;
    }
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

    const sentinel = join(project, "posix-grandchild.txt");
    const timeout = await runTool(
      "Bash",
      {
        command: `node ${JSON.stringify(scriptPath)} ${JSON.stringify(sentinel)}`,
        timeoutMs: 50,
      },
      createToolContext(project),
    );

    expect(timeout.output.data).toMatchObject({ exitCode: 1, outcome: "timeout" });
    await new Promise((resolve) => setTimeout(resolve, 1400));
    await expect(readFile(sentinel, "utf8")).rejects.toThrow();
  });

  it("records Bash timeout tail in details and full output artifact", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const result = await runTool(
      "Bash",
      {
        command: "node -e \"for (let i=0;i<120;i++) console.log('line-' + i); setTimeout(()=>{}, 2000)\"",
        timeoutMs: 50,
      },
      createToolContext(project),
    );

    expect(result.output.data).toMatchObject({ exitCode: 1, outcome: "timeout" });
    expect(result.output.details).toContain("fullOutputPath:");
    expect(result.output.details).toContain("命令超时");
    expect(result.output.fullOutputPath).toBeTruthy();
    const fullOutput = await readFile(String(result.output.fullOutputPath), "utf8");
    expect(fullOutput).toContain("line-0");
    expect(fullOutput).toContain("命令超时");
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

  it("accepts Windows drive-letter casing differences inside the workspace", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const filePath = join(project, "sample.txt");
    await writeFile(filePath, "alpha\n", "utf8");
    const context = createToolContext(
      process.platform === "win32" ? `${project[0]?.toLowerCase()}${project.slice(1)}` : project,
    );
    const inputPath =
      process.platform === "win32" ? `${filePath[0]?.toUpperCase()}${filePath.slice(1)}` : filePath;

    const read = await runTool("Read", { path: inputPath }, context);

    expect(read.output.data).toMatchObject({ path: "sample.txt" });
    expect(read.output.text).toContain("alpha");
  });

  (process.platform === "win32" ? it : it.skip)(
    "rejects Windows absolute paths outside the workspace",
    async () => {
      const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
      const context = createToolContext(project);
      const projectDrive = project[0]?.toUpperCase();
      const otherDrive = projectDrive === "Z" ? "Y" : "Z";

      await expect(
        runTool("Read", { path: `${otherDrive}:\\escape.txt` }, context),
      ).rejects.toThrow("路径越界");
      await expect(
        runTool("Read", { path: "\\\\server\\share\\escape.txt" }, context),
      ).rejects.toThrow("路径越界");
    },
  );

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

  it("ReadSnippets reads two ranges from two files and records edit snapshots", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "a.ts"), "one\ntwo\nthree\n", "utf8");
    await writeFile(join(project, "b.ts"), "alpha\nbeta\ngamma\n", "utf8");
    const context = createToolContext(project);

    const result = await runTool(
      "ReadSnippets",
      {
        ranges: [
          { path: "a.ts", start: 2, end: 3 },
          { path: "b.ts", start: 1, end: 2 },
        ],
      },
      context,
    );

    expect(result.output.text).toContain("a.ts:2-3");
    expect(result.output.text).toContain("2\ttwo");
    expect(result.output.text).toContain("b.ts:1-2");
    expect(result.output.text).toContain("1\talpha");
    expect(result.output.data).toMatchObject({ count: 2, requestedRanges: 2 });

    const edit = await runTool(
      "Edit",
      { path: "a.ts", oldText: "two", newText: "TWO" },
      context,
    );
    expect(edit.output.changedFiles).toEqual(["a.ts"]);
  });

  it("ReadSnippets truncates ranges over the per-range line limit", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const content = Array.from({ length: 130 }, (_, index) => `line-${index + 1}`).join("\n");
    const context = createToolContext(project);
    await writeFile(join(project, "large.ts"), content, "utf8");
    await writeFile(join(project, "next.ts"), "next-line\n", "utf8");

    const result = await runTool(
      "ReadSnippets",
      {
        ranges: [
          { path: "large.ts", start: 1, end: 130 },
          { path: "next.ts", start: 1, end: 1 },
        ],
      },
      context,
    );

    const ranges = (result.output.data as { ranges: Array<{ end: number; truncated: boolean }> })
      .ranges;
    expect(ranges[0]).toMatchObject({ end: 120, truncated: true });
    expect(ranges[1]).toMatchObject({ end: 1, truncated: false });
    expect(result.output.text).toContain("该范围已截断");
    expect(result.output.text).toContain("next-line");
    expect(result.output.text).not.toMatch(/预算|字符数|40000|总输出预算|单范围上限/u);
  });

  it("ReadSnippets hides internal safety cap details in visible output", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const hugeLine = "x".repeat(5000);
    const content = Array.from({ length: 100 }, (_, index) => `${index + 1}-${hugeLine}`).join(
      "\n",
    );
    const context = createToolContext(project);
    await writeFile(join(project, "huge.ts"), content, "utf8");

    const result = await runTool(
      "ReadSnippets",
      { ranges: [{ path: "huge.ts", start: 1, end: 100 }] },
      context,
    );

    expect(result.output.truncated).toBe(true);
    expect(result.output.text).toContain("结果已截断");
    expect(result.output.text).not.toMatch(/预算|字符数|40000|总输出预算|单范围上限/u);
    expect(result.output.data).toMatchObject({ safetyTruncated: true });
  });

  it("ReadSnippets reports missing files without hiding valid ranges", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    await writeFile(join(project, "ok.ts"), "present\n", "utf8");

    const result = await runTool(
      "ReadSnippets",
      {
        ranges: [
          { path: "missing.ts", start: 1, end: 2 },
          { path: "ok.ts", start: 1, end: 1 },
        ],
      },
      context,
    );

    expect(result.output.text).toContain("missing.ts:1-2");
    expect(result.output.text).toContain("ERROR:");
    expect(result.output.text).toContain("ok.ts:1-1");
    expect(result.output.text).toContain("present");
    expect(result.output.data).toMatchObject({ count: 1, requestedRanges: 2 });
  });

  it("SourcePack prefers simulated index candidates before local fallback", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    context.sourcePackCandidates = [
      {
        path: "indexed.ts",
        start: 2,
        end: 3,
        reason: "index symbol hit: indexedNeedle",
        confidence: 0.9,
      },
    ];
    await writeFile(join(project, "indexed.ts"), "zero\none indexedNeedle\ntwo\n", "utf8");
    await writeFile(join(project, "fallback.ts"), "indexedNeedle fallback\n", "utf8");

    const result = await runTool("SourcePack", { query: "indexedNeedle", limit: 2 }, context);
    const data = result.output.data as {
      source: string;
      fallback: boolean;
      snippets: Array<{ path: string; source: string; confidence: number }>;
    };

    expect(data.source).toBe("index");
    expect(data.fallback).toBe(false);
    expect(data.snippets).toHaveLength(1);
    expect(data.snippets[0]).toMatchObject({
      path: "indexed.ts",
      source: "index",
      confidence: 0.9,
    });
  });

  it("SourcePack returns rg query hits with reasons and empty results clearly", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    await writeFile(
      join(project, "source.ts"),
      "export function needleFunction() {\n  return 'needle';\n}\n",
      "utf8",
    );

    const hit = await runTool("SourcePack", { query: "needleFunction", limit: 2 }, context);
    const snippets = (
      hit.output.data as {
        source: string;
        snippets: Array<{
          path: string;
          reason: string;
          confidence: number;
          content: string;
          source: string;
        }>;
      }
    ).snippets;
    expect(snippets[0]?.path).toBe("source.ts");
    expect(snippets[0]?.reason).toContain("needleFunction");
    expect(snippets[0]?.source).toMatch(/rg|local_scan/);
    expect(snippets[0]?.confidence).toBeGreaterThan(0);
    expect(hit.output.text).toContain("needleFunction");
    expect(hit.output.text).not.toMatch(/预算|字符数|40000|总输出预算|单范围上限/u);

    const empty = await runTool("SourcePack", { query: "not-present-anywhere" }, context);
    expect(empty.output.text).toContain("empty");
    expect(empty.output.data).toMatchObject({ count: 0, empty: true });
  });

  it("SourcePack falls back to local scan when rg is unavailable", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "local-source.ts"), "export const localNeedle = 1;\n", "utf8");
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawn: () => {
        const child = createMockChildProcess();
        queueMicrotask(() => child.emit("error", new Error("rg missing")));
        return child;
      },
    }));

    try {
      const tools = await import("./index.js");
      const result = await tools.runTool(
        "SourcePack",
        { query: "localNeedle", limit: 2 },
        tools.createToolContext(project),
      );
      const data = result.output.data as {
        source: string;
        fallback: boolean;
        snippets: Array<{ path: string; source: string; confidence: number }>;
      };
      expect(data.fallback).toBe(true);
      expect(data.source).toBe("local_scan");
      expect(data.snippets[0]).toMatchObject({ path: "local-source.ts", source: "local_scan" });
      expect(data.snippets[0]?.confidence).toBeLessThan(0.6);
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("SourcePack can fall back to file name matches with low confidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    await writeFile(join(project, "WidgetPanel.test.ts"), "describe('panel', () => {});\n", "utf8");

    const result = await runTool("SourcePack", { query: "WidgetPanel", limit: 1 }, context);
    const data = result.output.data as {
      fallback: boolean;
      snippets: Array<{ path: string; source: string; confidence: number }>;
    };

    expect(data.fallback).toBe(true);
    expect(data.snippets[0]).toMatchObject({ path: "WidgetPanel.test.ts", source: "file_name" });
    expect(data.snippets[0]?.confidence).toBeLessThan(0.6);
  });

  it("SourcePack hides internal safety cap details in visible output", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    const hugeLine = `safetyNeedle ${"x".repeat(30000)}`;
    const content = Array.from({ length: 20 }, () => hugeLine).join("\n");
    await writeFile(join(project, "huge-source.ts"), content, "utf8");

    const result = await runTool("SourcePack", { query: "safetyNeedle", limit: 1 }, context);
    expect(result.output.data).toMatchObject({ count: 1 });
    expect(result.output.truncated).toBe(true);
    expect(result.output.text).toContain("结果已截断");
    expect(result.output.text).not.toMatch(/预算|字符数|40000|总输出预算|单范围上限/u);
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
    expect(edit.output.details).toContain("read protection: enabled");
    expect(edit.output.details).not.toContain("readGuard");
    expect(multi.output.data).toMatchObject({ operation: "MultiEdit", editCount: 2 });
    expect(diff.output.data).toMatchObject({
      changedFiles: ["sample.txt"],
      addedLines: 2,
      removedLines: 2,
    });
    expect(await readFile(filePath, "utf8")).toBe("ALPHA\nGAMMA\n");
  });

  it("reports Read line counts without counting a trailing newline as an extra content line", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    const content = Array.from({ length: 205 }, (_, index) => `line-${index + 1}`).join("\n");
    await writeFile(join(project, "large-trailing-newline.txt"), `${content}\n`, "utf8");

    const read = await runTool("Read", { path: "large-trailing-newline.txt" }, context);

    expect(read.output.truncated).toBe(true);
    expect(read.output.data).toMatchObject({
      lines: 200,
      selectedLines: 200,
      windowLines: 200,
      totalLines: 205,
      contentLines: 205,
    });
    expect(read.output.text).toContain("只显示读取窗口");
    expect(read.output.text).toContain("不是完整文件");
  });

  it("reports Read line counts for files without a trailing newline", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    await writeFile(join(project, "no-trailing-newline.txt"), "alpha\nbeta\ngamma", "utf8");

    const read = await runTool("Read", { path: "no-trailing-newline.txt" }, context);

    expect(read.output.truncated).toBe(false);
    expect(read.output.data).toMatchObject({
      lines: 3,
      selectedLines: 3,
      windowLines: 3,
      totalLines: 3,
      contentLines: 3,
    });
    expect(read.output.text).not.toContain("只显示读取窗口");
  });

  it("supports common leading (?i) case-insensitive Grep patterns", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    await writeFile(join(project, "invoice.ts"), "export const InvoiceTotal = 1;\n", "utf8");

    const grep = await runTool("Grep", { pattern: "(?i)invoice", path: "." }, context);

    expect(grep.output.text).toContain("invoice.ts:1");
    expect(grep.output.data).toMatchObject({ count: 1 });
  });

  it("treats empty Grep and Glob paths as the workspace root", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    await writeFile(join(project, "sample.txt"), "needle\n", "utf8");

    const grep = await runTool("Grep", { pattern: "needle", path: "" }, context);
    const glob = await runTool("Glob", { pattern: "*.txt", path: "" }, context);

    expect(grep.output.text).toContain("sample.txt:1");
    expect(glob.output.text).toContain("sample.txt");
  });

  it("uses rg for Grep and Glob when available, including Chinese paths and ignored dirs", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const calls: string[][] = [];
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawn: (_command: string, args: string[]) => {
        calls.push(args);
        const child = createMockChildProcess();
        queueMicrotask(() => {
          if (args.includes("--files")) {
            child.stdout.write(".\\中文目录\\命中.txt\nnode_modules/skip.txt\n");
          } else {
            child.stdout.write(".\\中文目录\\命中.txt:1: needle\n");
          }
          child.stdout.end();
          child.emit("close", 0);
        });
        return child;
      },
    }));

    try {
      const tools = await import("./index.js");
      const context = tools.createToolContext(project);
      const grep = await tools.runTool("Grep", { pattern: "needle", path: ".", limit: 10 }, context);
      const glob = await tools.runTool("Glob", { pattern: "*.txt", path: ".", limit: 10 }, context);

      expect(grep.output.text).toContain("中文目录/命中.txt:1: needle");
      expect(glob.output.text).toContain("中文目录/命中.txt");
      expect(calls.every((args) => args.includes("!**/node_modules/**"))).toBe(true);
      expect(calls.every((args) => args.includes("!**/dist/**"))).toBe(true);
      expect(calls.every((args) => args.includes("!**/.git/**"))).toBe(true);
      expect(calls.every((args) => args.includes("!**/.codebase-memory/**"))).toBe(true);
      expect(calls.every((args) => args.includes("!**/.linghun/logs/**"))).toBe(true);
      expect(calls.every((args) => args.includes("!**/.linghun/agent-runs/**"))).toBe(true);
      expect(calls.every((args) => args.includes("!**/.linghun/failures/**"))).toBe(true);
      expect(calls.every((args) => args.includes("!**/*.tsbuildinfo"))).toBe(true);
      expect(calls.some((args) => args.includes("--hidden") && args.includes("--no-ignore"))).toBe(
        true,
      );
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("uses Linghun glob semantics after rg file enumeration", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const calls: string[][] = [];
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawn: (_command: string, args: string[]) => {
        calls.push(args);
        const child = createMockChildProcess();
        queueMicrotask(() => {
          child.stdout.write("file[1].txt\nfile1.txt\n");
          child.stdout.end();
          child.emit("close", 0);
        });
        return child;
      },
    }));

    try {
      const tools = await import("./index.js");
      const glob = await tools.runTool(
        "Glob",
        { pattern: "file[1].txt", path: ".", limit: 10 },
        tools.createToolContext(project),
      );

      expect(glob.output.text).toBe("file[1].txt");
      expect(calls[0]).not.toContain("file[1].txt");
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("normalizes rg Grep and Glob paths with current-directory prefixes", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawn: (_command: string, args: string[]) => {
        const child = createMockChildProcess();
        queueMicrotask(() => {
          if (args.includes("--files")) {
            child.stdout.write(".\\src\\a.ts\n");
          } else {
            child.stdout.write(".\\src\\a.ts:1: needle\n");
          }
          child.stdout.end();
          child.emit("close", 0);
        });
        return child;
      },
    }));

    try {
      const tools = await import("./index.js");
      const context = tools.createToolContext(project);
      const grep = await tools.runTool("Grep", { pattern: "needle", path: "." }, context);
      const glob = await tools.runTool("Glob", { pattern: "src/*.ts", path: "." }, context);

      expect(grep.output.text).toContain("src/a.ts:1: needle");
      expect(grep.output.text).not.toContain(".\\");
      expect(glob.output.text).toBe("src/a.ts");
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("does not exclude the explicitly requested rg search root", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const calls: string[][] = [];
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawn: (_command: string, args: string[]) => {
        calls.push(args);
        const child = createMockChildProcess();
        queueMicrotask(() => {
          if (args.includes("--files")) {
            child.stdout.write(".linghun/logs/run.txt\n");
          } else {
            child.stdout.write(".linghun/logs/run.txt:1: needle\n");
          }
          child.stdout.end();
          child.emit("close", 0);
        });
        return child;
      },
    }));

    try {
      const tools = await import("./index.js");
      const context = tools.createToolContext(project);
      const grep = await tools.runTool(
        "Grep",
        { pattern: "needle", path: ".linghun/logs" },
        context,
      );
      const glob = await tools.runTool(
        "Glob",
        { pattern: "*.txt", path: ".linghun/logs" },
        context,
      );

      expect(grep.output.text).toContain(".linghun/logs/run.txt:1: needle");
      expect(glob.output.text).toContain("run.txt");
      expect(calls.every((args) => !args.includes("!**/.linghun/logs/**"))).toBe(true);
      expect(calls.every((args) => args.includes("!**/.linghun/agent-runs/**"))).toBe(true);
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("keeps rg Glob results relative to the requested search path", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawn: (_command: string, _args: string[]) => {
        const child = createMockChildProcess();
        queueMicrotask(() => {
          child.stdout.write("src/命中.txt\n");
          child.stdout.end();
          child.emit("close", 0);
        });
        return child;
      },
    }));

    try {
      const tools = await import("./index.js");
      const glob = await tools.runTool(
        "Glob",
        { pattern: "*.txt", path: "src", limit: 10 },
        tools.createToolContext(project),
      );

      expect(glob.output.text).toBe("命中.txt");
      expect(glob.output.truncated).toBe(false);
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("falls back to JS Grep and Glob when rg is unavailable", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await writeFile(join(project, "fallback.txt"), "fallback needle\n", "utf8");
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawn: () => {
        const child = createMockChildProcess();
        queueMicrotask(() => child.emit("error", new Error("ENOENT")));
        return child;
      },
    }));

    try {
      const tools = await import("./index.js");
      const context = tools.createToolContext(project);
      const grep = await tools.runTool("Grep", { pattern: "needle", path: "." }, context);
      const glob = await tools.runTool("Glob", { pattern: "*.txt", path: "." }, context);

      expect(grep.output.text).toContain("fallback.txt:1");
      expect(glob.output.text).toContain("fallback.txt");
      expect(grep.output.data).toMatchObject({ count: 1 });
      expect(glob.output.data).toMatchObject({ count: 1 });
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("skips generated cache and Linghun log paths in JS Grep and Glob fallback", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await mkdir(join(project, ".linghun", "logs"), { recursive: true });
    await mkdir(join(project, ".linghun", "agent-runs"), { recursive: true });
    await mkdir(join(project, ".linghun", "failures"), { recursive: true });
    await mkdir(join(project, ".codebase-memory"), { recursive: true });
    await writeFile(join(project, "src.txt"), "visible needle\n", "utf8");
    await writeFile(join(project, "tsconfig.tsbuildinfo"), "hidden needle\n", "utf8");
    await writeFile(join(project, ".linghun", "logs", "run.txt"), "hidden needle\n", "utf8");
    await writeFile(join(project, ".linghun", "agent-runs", "run.txt"), "hidden needle\n", "utf8");
    await writeFile(join(project, ".linghun", "failures", "fail.txt"), "hidden needle\n", "utf8");
    await writeFile(join(project, ".codebase-memory", "graph.txt"), "hidden needle\n", "utf8");
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawn: () => {
        const child = createMockChildProcess();
        queueMicrotask(() => child.emit("error", new Error("ENOENT")));
        return child;
      },
    }));

    try {
      const tools = await import("./index.js");
      const context = tools.createToolContext(project);
      const grep = await tools.runTool("Grep", { pattern: "needle", path: "." }, context);
      const glob = await tools.runTool("Glob", { pattern: "*.txt", path: "." }, context);

      expect(grep.output.text).toContain("src.txt:1");
      expect(grep.output.text).not.toContain("tsconfig.tsbuildinfo");
      expect(grep.output.text).not.toContain(".linghun/logs");
      expect(grep.output.text).not.toContain(".linghun/agent-runs");
      expect(grep.output.text).not.toContain(".linghun/failures");
      expect(grep.output.text).not.toContain(".codebase-memory");
      expect(glob.output.text).toContain("src.txt");
      expect(glob.output.text).not.toContain(".linghun/logs");
      expect(glob.output.text).not.toContain(".codebase-memory");
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("still allows explicit Read for paths excluded from search defaults", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await mkdir(join(project, ".linghun", "logs"), { recursive: true });
    await writeFile(join(project, ".linghun", "logs", "run.txt"), "explicit read ok\n", "utf8");

    const read = await runTool(
      "Read",
      { path: ".linghun/logs/run.txt" },
      createToolContext(project),
    );

    expect(read.output.text).toContain("explicit read ok");
  });

  it("stops Glob traversal after the requested limit without entering later large trees", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        writeFile(join(project, `${String(index).padStart(3, "0")}-match.txt`), "match\n", "utf8"),
      ),
    );
    const hugeTree = join(project, "zzz-huge-tree");
    await mkdir(hugeTree);
    await writeFile(join(hugeTree, "should-not-be-visited.txt"), "match\n", "utf8");

    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawn: () => {
        const child = createMockChildProcess();
        queueMicrotask(() => child.emit("error", new Error("ENOENT")));
        return child;
      },
    }));
    const fsPromises = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
    const visitedDirs: string[] = [];
    vi.doMock("node:fs/promises", () => ({
      ...fsPromises,
      readdir: async (...args: Parameters<typeof fsPromises.readdir>) => {
        const target = String(args[0]);
        visitedDirs.push(target);
        if (target === hugeTree) {
          throw new Error("Glob should stop before traversing zzz-huge-tree");
        }
        const entries = await fsPromises.readdir(...args);
        return Array.isArray(entries)
          ? [...entries].sort((left, right) => String(left.name).localeCompare(String(right.name)))
          : entries;
      },
    }));

    try {
      const tools = await import("./index.js");
      const glob = await tools.runTool(
        "Glob",
        { pattern: "*.txt", path: ".", limit: 100 },
        tools.createToolContext(project),
      );

      expect(glob.output.data).toMatchObject({ count: 100 });
      expect(glob.output.truncated).toBe(true);
      expect(visitedDirs).not.toContain(hugeTree);
    } finally {
      vi.doUnmock("node:child_process");
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    }
  });

  it("stops Grep traversal after the requested limit without entering later large trees", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        writeFile(join(project, `${String(index).padStart(3, "0")}-match.txt`), "needle\n", "utf8"),
      ),
    );
    const hugeTree = join(project, "zzz-huge-tree");
    await mkdir(hugeTree);
    await writeFile(join(hugeTree, "should-not-be-visited.txt"), "needle\n", "utf8");

    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawn: () => {
        const child = createMockChildProcess();
        queueMicrotask(() => child.emit("error", new Error("ENOENT")));
        return child;
      },
    }));
    const fsPromises = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
    const visitedDirs: string[] = [];
    vi.doMock("node:fs/promises", () => ({
      ...fsPromises,
      readdir: async (...args: Parameters<typeof fsPromises.readdir>) => {
        const target = String(args[0]);
        visitedDirs.push(target);
        if (target === hugeTree) {
          throw new Error("Grep should stop before traversing zzz-huge-tree");
        }
        const entries = await fsPromises.readdir(...args);
        return Array.isArray(entries)
          ? [...entries].sort((left, right) => String(left.name).localeCompare(String(right.name)))
          : entries;
      },
    }));

    try {
      const tools = await import("./index.js");
      const grep = await tools.runTool(
        "Grep",
        { pattern: "needle", path: ".", limit: 100 },
        tools.createToolContext(project),
      );

      expect(grep.output.data).toMatchObject({ count: 100 });
      expect(grep.output.truncated).toBe(true);
      expect(visitedDirs).not.toContain(hugeTree);
    } finally {
      vi.doUnmock("node:child_process");
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    }
  });

  it("reports Read offset/limit windows as truncated file windows", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    await writeFile(join(project, "windowed.txt"), "one\ntwo\nthree\nfour\nfive", "utf8");

    const read = await runTool("Read", { path: "windowed.txt", offset: 1, limit: 2 }, context);

    expect(read.output.truncated).toBe(true);
    expect(read.output.data).toMatchObject({
      lines: 2,
      selectedLines: 2,
      windowLines: 2,
      totalLines: 5,
      contentLines: 5,
    });
    expect(read.output.text).toContain("2\ttwo");
    expect(read.output.text).toContain("3\tthree");
    expect(read.output.text).toContain("只显示读取窗口");
    expect(read.output.text).toContain("不是完整文件");
  });

  it("validates tool input and keeps details when output is capped", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tools-project-"));
    const context = createToolContext(project);
    await writeFile(join(project, "large.txt"), Array.from({ length: 260 }, () => "x".repeat(120)).join("\n"), "utf8");

    await expect(runTool("Read", { path: 123 }, context)).rejects.toThrow("Read.path");
    const read = await runTool("Read", { path: "large.txt" }, context);

    expect(read.input).toEqual({ path: "large.txt", offset: undefined, limit: undefined });
    expect(read.output.truncated).toBe(true);
    expect(read.output.text.length).toBeLessThan(read.output.details?.length ?? 0);
    expect(read.output.details).toContain("x".repeat(100));
  });

  it("adapts obvious Unix find|sed/head pipelines for Windows PowerShell", () => {
    const adapted = adaptShellCommandForPlatform("find . -type f | sed -n '1,5p'", "win32");
    expect(adapted.adapter).toBe("powershell-adapted");
    expect(adapted.command).toContain("powershell.exe");
    expect(adapted.command).toContain("Get-ChildItem");
    expect(adapted.command).toContain("Select-Object -First 5");

    const head = adaptShellCommandForPlatform("find . | head -n 3", "win32");
    expect(head.adapter).toBe("powershell-adapted");
    expect(head.command).toContain("Select-Object -First 3");

    const spacedPath = adaptShellCommandForPlatform("find 'src files' | head -n 2", "win32");
    expect(spacedPath.adapter).toBe("powershell-adapted");
    expect(spacedPath.command).toContain("Get-ChildItem");
    expect(spacedPath.command).toContain("'src files'");
    expect(spacedPath.command).not.toContain("| |");

    const headFile = adaptShellCommandForPlatform("head -n 4 'notes file.txt'", "win32");
    expect(headFile.adapter).toBe("powershell-adapted");
    expect(headFile.command).toContain("Get-Content");
    expect(headFile.command).toContain("TotalCount 4");
    expect(headFile.command).toContain("'notes file.txt'");

    const blocked = adaptShellCommandForPlatform("find . -type f | sed 's/a/b/'", "win32");
    expect(blocked.adapter).toBe("blocked");
    expect(blocked.command).toContain("Unsupported Unix pipeline");

    const unsupportedFindPredicate = adaptShellCommandForPlatform(
      "find . -name '*.ts' | head -n 5",
      "win32",
    );
    expect(unsupportedFindPredicate.adapter).toBe("blocked");
  });

  it("adapts simple read-only Unix commands for Windows PowerShell", () => {
    const cat = adaptShellCommandForPlatform("cat 'notes file.txt'", "win32");
    expect(cat.adapter).toBe("powershell-adapted");
    expect(cat.command).toContain("Get-Content");
    expect(cat.command).toContain("'notes file.txt'");

    const ls = adaptShellCommandForPlatform('ls -la "src files"', "win32");
    expect(ls.adapter).toBe("powershell-adapted");
    expect(ls.command).toContain("Get-ChildItem");
    expect(ls.command).toContain("-Force");
    expect(ls.command).toContain("'src files'");

    const grep = adaptShellCommandForPlatform("grep 'hello world' '中文 路径\\file.txt'", "win32");
    expect(grep.adapter).toBe("powershell-adapted");
    expect(grep.command).toContain("Select-String");
    expect(grep.command).toContain("'hello world'");
    expect(grep.command).toContain("'中文 路径\\file.txt'");

    const recursiveGrep = adaptShellCommandForPlatform("grep -R \"needle\" src", "win32");
    expect(recursiveGrep.adapter).toBe("powershell-adapted");
    expect(recursiveGrep.command).toContain("Get-ChildItem");
    expect(recursiveGrep.command).toContain("-Recurse");
    expect(recursiveGrep.command).toContain("Select-String");

    const pwd = adaptShellCommandForPlatform("pwd", "win32");
    expect(pwd.adapter).toBe("powershell-adapted");
    expect(pwd.command).toContain("Get-Location");

    const which = adaptShellCommandForPlatform("which node", "win32");
    expect(which.adapter).toBe("powershell-adapted");
    expect(which.command).toContain("Get-Command");
    expect(which.command).toContain("'node'");
  });

  it("blocks unsupported Windows Unix command forms without leaking raw scripts", () => {
    const catPipeline = adaptShellCommandForPlatform("cat package.json | grep version", "win32");
    expect(catPipeline.adapter).toBe("blocked");
    expect(catPipeline.command).toContain("Unsupported Unix pipeline");

    const unsupportedGrep = adaptShellCommandForPlatform("grep -n version package.json", "win32");
    expect(unsupportedGrep.adapter).toBe("blocked");
    expect(unsupportedGrep.command).toContain("Unsupported grep form");

    const unterminatedQuote = adaptShellCommandForPlatform("cat 'notes file.txt", "win32");
    expect(unterminatedQuote.adapter).toBe("blocked");
    expect(unterminatedQuote.command).toContain("Unsupported cat form");

    const multiline = adaptShellCommandForPlatform("cat <<EOF\nsecret raw script\nEOF", "win32");
    expect(multiline.adapter).toBe("blocked");
    expect(multiline.command).toContain("Unsupported multi-line Unix shell syntax");
    expect(multiline.command).not.toContain("secret raw script");
    expect(multiline.logCommand).not.toContain("secret raw script");
  });

  // D.14H Phase 7.5-C：Glob("**/*") 修复——根目录文件不应被 globToRegExp 漏掉。
  it("D.14H: globToRegExp with **/* includes root-level files", () => {
    const regex = __testGlobToRegExp("**/*");
    expect(regex.test("README.md")).toBe(true);
    expect(regex.test("package.json")).toBe(true);
    expect(regex.test("src/a.ts")).toBe(true);
    expect(regex.test("src/deep/b.ts")).toBe(true);
    expect(regex.test(".git/config")).toBe(true);
  });

  it("D.14H: globToRegExp with **/*.ts includes root-level .ts", () => {
    const regex = __testGlobToRegExp("**/*.ts");
    expect(regex.test("index.ts")).toBe(true);
    expect(regex.test("src/a.ts")).toBe(true);
    expect(regex.test("README.md")).toBe(false);
  });

  it("D.14H: globToRegExp keeps existing pattern behavior", () => {
    // src/**/*.ts 需要 src/ 下面至少一级子目录（**/ 匹配 0+ 目录的历史行为）
    const regex = __testGlobToRegExp("src/**/*.ts");
    expect(regex.test("src/subdir/a.ts")).toBe(true);
    expect(regex.test("index.ts")).toBe(false);
    const simpleRegex = __testGlobToRegExp("*.txt");
    expect(simpleRegex.test("readme.txt")).toBe(true);
    expect(simpleRegex.test("src/readme.txt")).toBe(false);
  });

  // D.14H Phase 7.5-C：Windows Bash CJK 解码——GB18030 bytes 应正确解码。
  it("D.14H: decodeShellChunk handles GB18030 CJK bytes on Windows", () => {
    // "fixture CJK 空格" 的 GB18030 bytes
    const gbkBytes = Buffer.from([
      0x66, 0x69, 0x78, 0x74, 0x75, 0x72, 0x65, 0x20, // "fixture "
      0x43, 0x4A, 0x4B, 0x20, // "CJK "
      0xBF, 0xD5, 0xB8, 0xF1, // "空格" in GBK/GB18030
    ]);
    const result = __testDecodeShellChunk(gbkBytes);
    expect(result).toContain("fixture");
    expect(result).toContain("CJK");
    expect(result).toContain("空格");
  });

  it("D.14H: decodeShellChunk passes through normal UTF-8", () => {
    const utf8Bytes = Buffer.from("hello world 测试 UTF-8", "utf8");
    const result = __testDecodeShellChunk(utf8Bytes);
    expect(result).toBe("hello world 测试 UTF-8");
  });
});

function createMockChildProcess(): EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: () => boolean;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => boolean;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}

async function getFreeTcpPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!address || typeof address === "string") {
    throw new Error("failed to allocate test tcp port");
  }
  return address.port;
}

async function stopServiceFromOutput(data: unknown): Promise<void> {
  const pid = (data as { service?: { pid?: unknown } } | undefined)?.service?.pid;
  if (typeof pid !== "number" || pid <= 0) return;
  try {
    process.kill(pid);
  } catch {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}
