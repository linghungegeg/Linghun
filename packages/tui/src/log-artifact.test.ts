import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type LogArtifactRegistry,
  formatLogArtifactSlice,
  readLogArtifactSlice,
} from "./log-artifact.js";

async function createRegistry(): Promise<{
  project: string;
  logPath: string;
  registry: LogArtifactRegistry;
}> {
  const project = await mkdtemp(join(tmpdir(), "linghun-log-artifact-"));
  const logRoot = join(project, ".linghun", "logs", "tools");
  await mkdir(logRoot, { recursive: true });
  const logPath = join(logRoot, "artifact.log");
  return {
    project,
    logPath,
    registry: {
      workspaceRoot: project,
      logRoots: [join(project, ".linghun", "logs")],
      backgrounds: [{ id: "bg-log", outputPath: logPath }],
      evidence: [{ id: "ev-log", source: logPath }],
    },
  };
}

describe("Log Artifact Runtime Lite", () => {
  it("tails the last N lines from a large log with a bounded byte range", async () => {
    const { logPath, registry } = await createRegistry();
    const content = Array.from({ length: 1000 }, (_, index) => `line ${index + 1}`).join("\n");
    await writeFile(logPath, content, "utf8");

    const slice = await readLogArtifactSlice(
      { backgroundId: "bg-log" },
      { mode: "tail", lines: 5, maxBytes: 128 },
      registry,
    );

    expect(slice.mode).toBe("tail");
    expect(slice.content).toContain("line 1000");
    expect(slice.content).not.toMatch(/^line 1$/m);
    expect(slice.byteRange?.start).toBeGreaterThan(0);
    expect(slice.truncated).toBe(true);
  });

  it("withholds at least one line instead of dumping a complete small tail artifact", async () => {
    const { logPath, registry } = await createRegistry();
    await writeFile(logPath, ["ONLY_LINE_1", "ONLY_LINE_2", "ONLY_LINE_3"].join("\n"), "utf8");

    const slice = await readLogArtifactSlice(
      { backgroundId: "bg-log" },
      { mode: "tail", lines: 40 },
      registry,
    );
    const formatted = formatLogArtifactSlice(slice, "en-US");

    expect(slice.truncated).toBe(true);
    expect(slice.content).not.toContain("ONLY_LINE_1");
    expect(slice.content).toContain("ONLY_LINE_3");
    expect(formatted).toContain("Complete artifact withheld");
  });

  it("greps bounded matches with context and redacts secrets", async () => {
    const { logPath, registry } = await createRegistry();
    await writeFile(
      logPath,
      [
        "before one",
        "Authorization: Bearer sk-secret123456789",
        "target alpha",
        "after one",
        "before two",
        "target beta",
        "after two",
        "target gamma",
      ].join("\n"),
      "utf8",
    );

    const slice = await readLogArtifactSlice(
      { evidenceId: "ev-log" },
      { mode: "grep", pattern: "target", contextLines: 1, maxMatches: 2 },
      registry,
    );

    expect(slice.matches).toHaveLength(2);
    expect(slice.truncated).toBe(true);
    expect(slice.content).toContain("target alpha");
    expect(slice.content).toContain("after one");
    expect(slice.content).toContain("before two");
    expect(slice.content).not.toContain("sk-secret123456789");
    expect(slice.content).toContain("[REDACTED]");
  });

  it("extracts bounded error candidates without changing verification semantics", async () => {
    const { logPath, registry } = await createRegistry();
    await writeFile(
      logPath,
      [
        "src/index.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.",
        "FAIL src/example.test.ts > adds numbers",
        "AssertionError: expected 1 to be 2",
        "Traceback (most recent call last):",
        "TypeError: boom",
        "$ bash script",
        "exitCode=1",
        "stderr: command failed with non-zero exit",
      ].join("\n"),
      "utf8",
    );
    const verificationStatus = "fail" as const;

    const slice = await readLogArtifactSlice(
      { backgroundId: "bg-log" },
      { mode: "errors" },
      registry,
    );

    expect(slice.mode).toBe("errors");
    expect(slice.content).toContain("TS2322");
    expect(slice.content).toContain("AssertionError");
    expect(slice.content).toContain("Traceback");
    expect(slice.content).toContain("exitCode=1");
    expect(slice.warnings?.join("\n")).toContain("do not change verification PASS/PARTIAL/FAIL");
    expect(verificationStatus).toBe("fail");
  });

  it("handles CRLF and Chinese UTF-8 output without mojibake", async () => {
    const { logPath, registry } = await createRegistry();
    await writeFile(logPath, "第一行\r\n错误：中文输出\r\n最后一行\r\n", "utf8");

    const slice = await readLogArtifactSlice(
      { backgroundId: "bg-log" },
      { mode: "grep", pattern: "中文", contextLines: 1 },
      registry,
    );

    expect(slice.content).toContain("错误：中文输出");
    expect(slice.content).not.toContain("�");
    expect(slice.warnings?.join("\n")).toContain("Complete artifact withheld");
  });

  it("allows evidence sources only when they are log artifacts", async () => {
    const { project, logPath, registry } = await createRegistry();
    await writeFile(
      logPath,
      ["known log artifact start", "known log artifact tail"].join("\n"),
      "utf8",
    );
    const srcDir = join(project, "src");
    await mkdir(srcDir, { recursive: true });
    const sourcePath = join(srcDir, "app.ts");
    const readmePath = join(project, "README.md");
    await writeFile(sourcePath, "console.log('not a log artifact');\n", "utf8");
    await writeFile(readmePath, "# Not a log artifact\n", "utf8");

    const logSlice = await readLogArtifactSlice(
      { evidenceId: "ev-log" },
      { mode: "tail", lines: 1 },
      registry,
    );

    expect(logSlice.content).toContain("known log artifact");
    await expect(
      readLogArtifactSlice(
        { evidenceId: "ev-source" },
        { mode: "tail" },
        { ...registry, evidence: [{ id: "ev-source", source: sourcePath }] },
      ),
    ).rejects.toThrow("不是 log/output artifact");
    await expect(
      readLogArtifactSlice(
        { evidenceId: "ev-readme" },
        { mode: "grep", pattern: "Not" },
        { ...registry, evidence: [{ id: "ev-readme", source: readmePath }] },
      ),
    ).rejects.toThrow("请用 Read 或其他合适工具查看普通 workspace 文件");
  });

  it("keeps background output paths sliceable even outside the log root", async () => {
    const { project, registry } = await createRegistry();
    const outputPath = join(project, "background-output.txt");
    await writeFile(
      outputPath,
      ["background artifact start", "background artifact output"].join("\n"),
      "utf8",
    );

    const slice = await readLogArtifactSlice(
      { backgroundId: "bg-output" },
      { mode: "tail", lines: 1 },
      { ...registry, backgrounds: [{ id: "bg-output", outputPath }] },
    );

    expect(slice.content).toContain("background artifact output");
  });

  it("returns clear errors for unknown ids and outside paths", async () => {
    const { project, registry } = await createRegistry();
    await expect(
      readLogArtifactSlice({ backgroundId: "missing" }, { mode: "tail" }, registry),
    ).rejects.toThrow("未找到 background");

    await expect(
      readLogArtifactSlice(
        { path: resolve(project, "..", "outside.log") },
        { mode: "tail" },
        registry,
      ),
    ).rejects.toThrow("路径不在 workspace 或已知 log root 内");
  });

  it("caps output and formats summary-first slices without dumping the full log", async () => {
    const { project, logPath, registry } = await createRegistry();
    await writeFile(
      logPath,
      Array.from({ length: 60 }, (_, index) => `repeat target ${index + 1}`).join("\n"),
      "utf8",
    );

    const slice = await readLogArtifactSlice(
      { backgroundId: "bg-log" },
      { mode: "grep", pattern: "target", maxMatches: 3 },
      registry,
    );
    const formatted = formatLogArtifactSlice(slice, "zh-CN");

    expect(slice.truncated).toBe(true);
    expect(slice.matches).toHaveLength(3);
    expect(formatted).toContain("Log artifact grep 切片");
    expect(formatted).toContain("sourcePath: .linghun/logs/tools/artifact.log");
    expect(formatted).toContain("truncated: true");
    expect(formatted).toContain("完整日志不会进入主屏、prompt、memory 或 handoff");
    expect(formatted).not.toContain(project);
    expect(formatted).not.toContain(logPath);
    expect(formatted).not.toContain("repeat target 60");
  });
});
