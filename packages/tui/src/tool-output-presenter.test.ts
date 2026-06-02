import { describe, expect, it } from "vitest";

import {
  createAssistantPrimaryTextSanitizer,
  createLayeredToolOutput,
  formatToolOutput,
  formatToolStart,
  sanitizeAssistantPrimaryText,
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

    it("Bash 主屏 banner 不泄漏长命令、log path、checkpoint id 或 raw JSON", () => {
      const command = `node run.js --log-path C:\\Users\\Admin\\secret\\full-output.log --checkpoint-id chk_1234567890 --payload ${JSON.stringify({ debug: true, schema: { raw: "x".repeat(160) } })}`;
      const out = formatToolStart("Bash", { command }) ?? "";

      expect(out.length).toBeLessThanOrEqual(127);
      expect(out).toContain("...");
      expect(out).not.toContain("full-output.log");
      expect(out).not.toContain("chk_1234567890");
      expect(out).not.toContain('"schema"');
      expect(out).not.toContain('"raw"');
    });

    it("缺参数返回 undefined", () => {
      expect(formatToolStart("Bash", {})).toBeUndefined();
      expect(formatToolStart("Todo", { action: "list" })).toBeUndefined();
    });
  });

  describe("formatToolStart 密钥脱敏", () => {
    it("Bearer token 被脱敏为 Bearer ***", () => {
      const out =
        formatToolStart("Bash", {
          command: "curl -H 'Authorization: Bearer abc123def456' https://api",
        }) ?? "";
      expect(out).toContain("Bearer ***");
      expect(out).not.toContain("abc123def456");
    });

    it("api_key= 值被脱敏", () => {
      const out =
        formatToolStart("Bash", {
          command: "fetch --api_key=supersecretvalue",
        }) ?? "";
      expect(out).toContain("api_key=***");
      expect(out).not.toContain("supersecretvalue");
    });

    it("URL 中的 key= 查询参数被脱敏", () => {
      const out =
        formatToolStart("Bash", {
          command: "curl https://host/v1?key=SECRETKEY123",
        }) ?? "";
      expect(out).not.toContain("SECRETKEY123");
      expect(out).toContain("key=***");
    });

    it("Authorization: Bearer 值被脱敏", () => {
      const out =
        formatToolStart("Bash", {
          command: "curl -H 'Authorization: Bearer xyztoken'",
        }) ?? "";
      expect(out).not.toContain("xyztoken");
    });

    it("环境变量赋值脱敏值但保留变量名", () => {
      const out =
        formatToolStart("Bash", {
          command: "LINGHUN_OPENAI_API_KEY=sk-livesecret123 linghun run",
        }) ?? "";
      expect(out).not.toContain("sk-livesecret123");
      expect(out).toContain("LINGHUN_OPENAI_API_KEY=");
    });

    it("普通命令不被过度脱敏", () => {
      expect(formatToolStart("Bash", { command: "git status" })).toBe("Bash(git status)");
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
      const text = formatToolOutput("Bash", { text: "done", data: { exitCode: 0 } }, "zh-CN");
      expect(text).toContain("命令已退出 0");
    });

    it("Bash 失败 exit 也写入退出码", () => {
      const text = formatToolOutput("Bash", { text: "boom", data: { exitCode: 2 } }, "zh-CN");
      expect(text).toContain("命令已退出 2");
    });

    it("长 Bash 输出主屏只显示摘要和尾部，完整内容仍需 Ctrl+O", () => {
      const text = Array.from({ length: 8 }, (_, index) => `bash line ${index + 1}`).join("\n");
      const formatted = formatToolOutput("Bash", { text, data: { exitCode: 0 } }, "zh-CN");

      expect(formatted).toContain("8 行");
      expect(formatted).toContain("尾部：");
      expect(formatted).toContain("bash line 6");
      expect(formatted).toContain("bash line 8");
      expect(formatted).toContain("输出已折叠，按 Ctrl+O 展开。");
      expect(formatted).not.toContain("bash line 1");
      expect(formatted).not.toContain("bash line 5");
    });

    it("短 Read 输出没有隐藏内容时不显示 Ctrl+O", () => {
      const layered = createLayeredToolOutput(
        "Read",
        { text: "line1\nline2", data: { lines: 2 } },
        "zh-CN",
      );
      expect(layered.preview).not.toContain("Ctrl+O");
      expect(layered.truncated).toBe(false);
    });

    it("Read 主屏走 summary-first：长输出才折叠，提示 Ctrl+O 展开", () => {
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
      expect(layered.preview).toContain("Ctrl+O");
      expect(layered.truncated).toBe(true);
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

  describe("sanitizeAssistantPrimaryText", () => {
    it("hides raw XML tool_use blocks from the main assistant stream", () => {
      const raw =
        '先看文件\n<tool_use id="toolu_1" name="Read"><input>{"path":"secret.ts"}</input></tool_use>\n继续';
      const cleaned = sanitizeAssistantPrimaryText(raw, "zh-CN");

      expect(cleaned).toContain("工具调用细节已隐藏");
      expect(cleaned).toContain("先看文件");
      expect(cleaned).toContain("继续");
      expect(cleaned).not.toContain("<tool_use");
      expect(cleaned).not.toContain("toolu_1");
      expect(cleaned).not.toContain("secret.ts");
    });

    it("hides raw XML tool_use_error blocks from the main assistant stream", () => {
      const raw =
        '失败\n<tool_use_error call_id="bad-call">工具 call id 格式错误</tool_use_error>\n请重试';
      const cleaned = sanitizeAssistantPrimaryText(raw, "zh-CN");

      expect(cleaned).toContain("工具调用细节已隐藏");
      expect(cleaned).toContain("失败");
      expect(cleaned).toContain("请重试");
      expect(cleaned).not.toContain("<tool_use_error");
      expect(cleaned).not.toContain("call id 格式错误");
      expect(cleaned).not.toContain("bad-call");
    });

    it("hides raw XML tool_use_error blocks split across stream deltas", () => {
      const sanitizer = createAssistantPrimaryTextSanitizer("zh-CN");
      const visible = [
        sanitizer.push("失败\n<tool_use_"),
        sanitizer.push('error call_id="bad-call">'),
        sanitizer.push("工具 call id 格式错误</tool_use_error>\n请重试"),
        sanitizer.flush(),
      ].join("");

      expect(visible).toContain("工具调用细节已隐藏");
      expect(visible).toContain("失败");
      expect(visible).toContain("请重试");
      expect(visible).not.toContain("<tool_use_error");
      expect(visible).not.toContain("call id 格式错误");
      expect(visible).not.toContain("bad-call");
    });

    it("hides raw JSON tool_use blocks from the main assistant stream", () => {
      const cleaned = sanitizeAssistantPrimaryText(
        '{"type":"tool_use","id":"toolu_1","name":"Read","input":{"path":"secret.ts"}}',
        "en-US",
      );

      expect(cleaned).toContain("Tool call details hidden");
      expect(cleaned).not.toContain("tool_use");
      expect(cleaned).not.toContain("toolu_1");
      expect(cleaned).not.toContain("secret.ts");
    });

    it("hides raw XML tool_use blocks split across stream deltas", () => {
      const sanitizer = createAssistantPrimaryTextSanitizer("zh-CN");
      const visible = [
        sanitizer.push("先看文件\n<to"),
        sanitizer.push('ol_use id="toolu_1" name="Read">'),
        sanitizer.push('<input>{"path":"secret.ts"}</input></tool_use>\n继续'),
        sanitizer.flush(),
      ].join("");

      expect(visible).toContain("工具调用细节已隐藏");
      expect(visible).toContain("先看文件");
      expect(visible).toContain("继续");
      expect(visible).not.toContain("<tool_use");
      expect(visible).not.toContain("toolu_1");
      expect(visible).not.toContain("secret.ts");
    });
  });
});
