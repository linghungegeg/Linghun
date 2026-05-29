import { describe, expect, it } from "vitest";

import {
  createLayeredToolOutput,
  formatToolOutput,
  formatToolStart,
} from "./tool-output-presenter.js";

describe("tool-output-presenter", () => {
  describe("formatToolStart", () => {
    it("Bash 含 command 时输出 Bash(<command>)", () => {
      expect(formatToolStart("Bash", { command: "ls -la" })).toBe("Bash(ls -la)");
    });

    it("Read 含 path 时输出 Read(<path>)", () => {
      expect(formatToolStart("Read", { path: "src/index.ts" })).toBe("Read(src/index.ts)");
    });

    it("Read 用 file_path 别名也能解析", () => {
      expect(formatToolStart("Read", { file_path: "src/foo.ts" })).toBe("Read(src/foo.ts)");
    });

    it("Edit/Write/MultiEdit 显示 file_path", () => {
      expect(formatToolStart("Edit", { file_path: "a.ts" })).toBe("Edit(a.ts)");
      expect(formatToolStart("Write", { file_path: "b.ts" })).toBe("Write(b.ts)");
      expect(formatToolStart("MultiEdit", { file_path: "c.ts" })).toBe("MultiEdit(c.ts)");
    });

    it("Grep/Glob 显示 pattern", () => {
      expect(formatToolStart("Grep", { pattern: "foo" })).toBe("Grep(foo)");
      expect(formatToolStart("Glob", { pattern: "*.ts" })).toBe("Glob(*.ts)");
    });

    it("超长参数被裁剪到 120 字符", () => {
      const long = "x".repeat(200);
      const out = formatToolStart("Bash", { command: long }) ?? "";
      expect(out.length).toBeLessThanOrEqual(127);
      expect(out).toContain("...");
    });

    it("缺参数返回 undefined", () => {
      expect(formatToolStart("Bash", {})).toBeUndefined();
      expect(formatToolStart("Todo", { action: "list" })).toBeUndefined();
    });
  });

  describe("createLayeredToolOutput / formatToolOutput", () => {
    it("默认 layer=primary，summary 来自 output 或人话兜底", () => {
      const layered = createLayeredToolOutput(
        "Bash",
        { text: "hello", data: { exitCode: 0, lines: 1 } },
        "zh-CN",
      );
      expect(layered.layer).toBe("primary");
      expect(typeof layered.summary).toBe("string");
      expect(layered.summary.length).toBeGreaterThan(0);
    });

    it("Bash 有 exitCode 时 formatToolOutput 含 '命令已退出 N'", () => {
      const text = formatToolOutput(
        "Bash",
        { text: "done", data: { exitCode: 0 } },
        "zh-CN",
      );
      expect(text).toContain("命令已退出 0");
    });

    it("Bash 失败 exit 也写入退出码", () => {
      const text = formatToolOutput(
        "Bash",
        { text: "boom", data: { exitCode: 2 } },
        "zh-CN",
      );
      expect(text).toContain("命令已退出 2");
    });

    it("Read 主屏走 summary-first：默认折叠，提示 Ctrl+O 展开（默认降噪）", () => {
      const layered = createLayeredToolOutput(
        "Read",
        { text: "long\nfile\ncontent\n".repeat(20), data: { lines: 60 } },
        "zh-CN",
      );
      expect(layered.preview).toContain("Ctrl+O");
      expect(layered.truncated).toBe(true);
    });

    it("evidenceId 透传到 layered.evidenceId（保留诊断信息）", () => {
      const layered = createLayeredToolOutput(
        "Read",
        { text: "x", data: { lines: 1 } },
        "zh-CN",
        "ev-test-1",
      );
      expect(layered.evidenceId).toBe("ev-test-1");
    });

    it("fullOutputPath 透传：用于 /details output / Ctrl+O 展开（诊断保留）", () => {
      const layered = createLayeredToolOutput(
        "Bash",
        { text: "x", data: { exitCode: 0 }, fullOutputPath: "/tmp/full.log" },
        "zh-CN",
      );
      expect(layered.fullOutputPath).toBe("/tmp/full.log");
    });

    it("英文也产出折叠提示（Press Ctrl+O to expand）", () => {
      const layered = createLayeredToolOutput(
        "Read",
        { text: "abc\n".repeat(30), data: { lines: 30 } },
        "en-US",
      );
      expect(layered.preview).toContain("Ctrl+O");
      expect(layered.preview.toLowerCase()).toContain("expand");
    });

    it("Edit/Write 摘要带 patch +N -M（诊断保留）", () => {
      const layered = createLayeredToolOutput(
        "Edit",
        {
          text: "edited",
          data: { addedLines: 3, removedLines: 1, lines: 4, changedFiles: ["a.ts"] },
        },
        "zh-CN",
      );
      expect(layered.preview).toContain("补丁 +3 -1");
      expect(layered.preview).toContain("changedFiles 1");
    });
  });
});
