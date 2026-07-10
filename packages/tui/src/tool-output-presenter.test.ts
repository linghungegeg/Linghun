import { describe, expect, it } from "vitest";

import {
  createAssistantPrimaryTextSanitizer,
  createLayeredToolOutput,
  createStructuredToolCall,
  createStructuredToolOutput,
  formatToolOutput,
  formatToolStart,
  sanitizeAssistantPrimaryText,
} from "./tool-output-presenter.js";

describe("tool-output-presenter", () => {
  describe("assistant primary sanitizer", () => {
    it("naturalizes internal tool labels in streaming output", () => {
      const text = "没有运行过 RunVerification 来验证测试通过或构建成功。";
      const out = sanitizeAssistantPrimaryText(text, "zh-CN");
      expect(out).not.toContain("RunVerification");
      expect(out).toContain("没有运行过 验证命令 来验证测试通过或构建成功。");
    });

    it("naturalizes internal tool labels across streamed chunks", () => {
      const sanitizer = createAssistantPrimaryTextSanitizer("en-US");
      const out = [
        sanitizer.push("Run"),
        sanitizer.push("Verification was not called."),
        sanitizer.flush(),
      ].join("");
      expect(out).not.toContain("RunVerification");
      expect(out).toContain("verification command was not called");
    });

    it("removes relay-leaked thinking XML blocks from assistant text", () => {
      const raw =
        "前置判断。\n<thinking>\nGood, I'll give a balanced assessment.\n</thinking>\n正式回答。";
      const out = sanitizeAssistantPrimaryText(raw, "zh-CN");

      expect(out).toContain("前置判断。");
      expect(out).toContain("正式回答。");
      expect(out).not.toContain("前置判断。\n\n正式回答。");
      expect(out).not.toContain("<thinking>");
      expect(out).not.toContain("balanced assessment");
      expect(out).not.toContain("已隐藏");
    });

    it("removes relay-leaked thinking XML blocks when the final text follows the closing tag", () => {
      const raw = "<thinking>hidden chain</thinking>正式回答。";
      const out = sanitizeAssistantPrimaryText(raw, "zh-CN");

      expect(out).toBe("正式回答。");
    });

    it("removes relay-leaked thinking XML blocks split across streamed chunks", () => {
      const sanitizer = createAssistantPrimaryTextSanitizer("zh-CN");
      const out = [
        sanitizer.push("前置判断。\n<think"),
        sanitizer.push("ing>\nGood, I'll give a balanced assessment."),
        sanitizer.push("\n</thinking>\n正式回答。"),
        sanitizer.flush(),
      ].join("");

      expect(out).toContain("前置判断。");
      expect(out).toContain("正式回答。");
      expect(out).not.toContain("<thinking");
      expect(out).not.toContain("balanced assessment");
    });

    it("keeps inline thinking tag mentions as normal user-visible text", () => {
      const out = sanitizeAssistantPrimaryText("XML 标签 `<thinking>` 可以作为示例文本。", "zh-CN");

      expect(out).toContain("`<thinking>`");
    });
  });

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

    it("Grep/Glob 主屏 start banner 不回显原始搜索式", () => {
      expect(formatToolStart("Grep", { pattern: "foo" })).toBe("Grep(search)");
      expect(formatToolStart("Glob", { pattern: "*.ts" })).toBe("Glob(files)");
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

    it("返回结构化调用卡，同时保留旧字符串兼容", () => {
      const structured = createStructuredToolCall("Bash", { command: "git status" });

      expect(structured?.text).toBe(formatToolStart("Bash", { command: "git status" }));
      expect(structured?.block.kind).toBe("tool_call");
      expect(structured?.block.toolName).toBe("Bash");
      expect(structured?.block.status).toBe("running");
      expect(structured?.block.summary).toBe("Bash(git status)");
      expect(structured?.block.collapsible).toBe(false);
      expect(structured?.block.bordered).toBe(true);
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

    it("返回结构化 DisplayBlock，同时保留旧字符串兼容", () => {
      const output = { text: "done", data: { exitCode: 0, lines: 1 }, evidenceId: "ev-1" };
      const structured = createStructuredToolOutput("Bash", output, "zh-CN");

      expect(structured.text).toBe(formatToolOutput("Bash", output, "zh-CN"));
      expect(structured.block.kind).toBe("tool_result_success");
      expect(structured.block.toolName).toBe("Bash");
      expect(structured.block.status).toBe("success");
      expect(structured.block.evidenceId).toBe("ev-1");
      expect(structured.block.bordered).toBe(true);
      expect(structured.block.collapsible).toBe(false);
    });

    it("失败结构化 DisplayBlock 包含错误状态和退出码文本", () => {
      const structured = createStructuredToolOutput(
        "Bash",
        { text: "boom", data: { exitCode: 2 }, details: "full stack" },
        "zh-CN",
      );

      expect(structured.block.kind).toBe("tool_result_error");
      expect(structured.block.status).toBe("error");
      expect(structured.block.collapsible).toBe(true);
      expect(structured.text).toContain("退出 2");
    });

    it.each([
      ["WebSearch", { aborted: true, timedOut: false }, "WebSearch 已取消"],
      ["WebFetch", { aborted: false, timedOut: true }, "WebFetch 已超时"],
      ["WebSearch", { aborted: false, timedOut: false }, "WebSearch 失败"],
    ] as const)("%s 按结构化失败原因生成终态 lead", (name, failure, lead) => {
      const structured = createStructuredToolOutput(
        name,
        { text: "request failed", data: { isError: true, ...failure } },
        "zh-CN",
      );

      expect(structured.block.kind).toBe("tool_result_error");
      expect(structured.block.status).toBe("error");
      expect(structured.block.title).toBe(lead);
      expect(structured.text).toContain(lead);
    });

    it("Web 成功输出保持原有 completed lead", () => {
      const structured = createStructuredToolOutput(
        "WebSearch",
        { text: "result", data: { isError: false, searches: 1 } },
        "en-US",
      );

      expect(structured.block.kind).toBe("tool_result_success");
      expect(structured.block.title).toBe("1 search");
    });

    it("Bash 成功时 formatToolOutput 含 lead '✓'", () => {
      const text = formatToolOutput("Bash", { text: "done", data: { exitCode: 0 } }, "zh-CN");
      expect(text).toContain("Bash");
      expect(text).toContain("✓");
    });

    it("Bash 失败 exit 也写入退出码", () => {
      const text = formatToolOutput("Bash", { text: "boom", data: { exitCode: 2 } }, "zh-CN");
      expect(text).toContain("退出");
      expect(text).toContain("2");
    });

    it("Bash diagnostics 会出现在模型工具结果文本里", () => {
      const text = formatToolOutput(
        "Bash",
        {
          text: "exit code 1",
          data: {
            exitCode: 1,
            diagnostics: [
              {
                type: "diagnostic_alpha",
                severity: "recoverable",
                evidence: "connection refused",
                suggestion: "poll health",
              },
              {
                type: "diagnostic_beta",
                severity: "blocking",
                evidence: "clean HTML modified",
                suggestion: "inspect artifacts",
              },
              {
                type: "timeout",
                severity: "recoverable",
                evidence: "timed out",
                suggestion: "shorten check",
              },
              {
                type: "provider_or_network",
                severity: "recoverable",
                evidence: "gateway unstable",
                suggestion: "retry later",
              },
            ],
          },
        },
        "zh-CN",
      );

      expect(text).toContain("Linghun diagnostics:");
      expect(text).toContain("- diagnostic_alpha: connection refused");
      expect(text).toContain("- diagnostic_beta: clean HTML modified");
      expect(text).toContain("- timeout: timed out");
      expect(text).not.toContain("- provider_or_network: gateway unstable");
    });

    it("无 diagnostics 时 Bash 输出不变", () => {
      const output = { text: "boom", data: { exitCode: 2 } };

      expect(formatToolOutput("Bash", output, "zh-CN")).toBe(
        formatToolOutput("Bash", { ...output, data: { exitCode: 2, diagnostics: [] } }, "zh-CN"),
      );
    });

    it("长 Bash 输出主屏折叠为尾部线索，但 formatted 正文不携带 Ctrl+O 提示", () => {
      const text = Array.from({ length: 8 }, (_, index) => `bash line ${index + 1}`).join("\n");
      const formatted = formatToolOutput("Bash", { text, data: { exitCode: 0 } }, "zh-CN");

      expect(formatted).toContain("尾部：");
      expect(formatted).not.toContain("bash line 1");
      expect(formatted).not.toContain("bash line 5");
      expect(formatted).toContain("bash line 6");
      expect(formatted).toContain("bash line 8");
      expect(formatted).not.toContain("Ctrl+O");
    });

    it("normalizes wrapped ANSI text before summary-first routing", () => {
      const bash = createLayeredToolOutput(
        "Bash",
        { text: '{"text":"\\u001b[32m✓\\u001b[39m ok\\nnext"}', data: { exitCode: 0 } },
        "zh-CN",
      );
      const artifactLine = createLayeredToolOutput(
        "Bash",
        {
          text: '.linghun/session/tool-results/run/result.txt:{"text":"\\u001b[31mFAIL\\u001b[39m"}',
          data: { exitCode: 1 },
        },
        "zh-CN",
      );

      expect(bash.preview).toContain("✓ ok");
      expect(bash.preview).not.toContain('{"text"');
      expect(bash.preview).not.toContain("\\u001b");
      expect(bash.preview).not.toContain("[32m");
      expect(artifactLine.preview).toContain("FAIL");
      expect(artifactLine.preview).not.toContain('{"text"');
      expect(artifactLine.preview).not.toContain("\\u001b");
      expect(artifactLine.preview).not.toContain("[31m");
    });

    it("summarizes test reporter JSON before Bash summary-first routing", () => {
      const layered = createLayeredToolOutput(
        "Bash",
        {
          text: '{"numTotalTests":10,"numPassedTests":8,"numFailedTests":1,"numPendingTests":1,"numTodoTests":0,"testResults":[]}',
          data: { exitCode: 1 },
        },
        "zh-CN",
      );

      expect(layered.preview).toContain("Tests [██████████] 10/10 · ✓ 8 · ✗ 1 · ○ 1");
      expect(layered.preview).not.toContain("testResults");
    });

    it("preserves ordinary JSON in summary-first output", () => {
      const layered = createLayeredToolOutput(
        "Bash",
        { text: '{"ok":true,"value":1}', data: { exitCode: 0 } },
        "zh-CN",
      );

      expect(layered.preview).toContain('{"ok":true,"value":1}');
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

    it("Read 主屏走 summary-first：超 100 行折叠但 preview 不带 Ctrl+O", () => {
      const layered = createLayeredToolOutput(
        "Read",
        { text: "line\n".repeat(150), data: { lines: 150 } },
        "zh-CN",
      );
      expect(layered.preview).not.toContain("Ctrl+O");
      expect(layered.truncated).toBe(true);
    });

    it("Read 主屏区分窗口行数和文件总行数", () => {
      const layered = createLayeredToolOutput(
        "Read",
        {
          text: "1\tone\n2\ttwo\n...（只显示读取窗口：选中 2 行 / 全文 5 行；不是完整文件）",
          data: { lines: 2, selectedLines: 2, windowLines: 2, totalLines: 5, contentLines: 5 },
          truncated: true,
        },
        "zh-CN",
      );

      expect(layered.preview).toContain("窗口 2/5 行");
      expect(layered.preview).toContain("内容 5 行");
      expect(layered.preview).not.toContain("contentLines=5");
      expect(layered.preview).not.toContain("2 行");
    });

    it("ReadSnippets 主屏显示读取文件和行范围，并限制目标数量", () => {
      const ranges = [
        { path: "src/alpha.ts", start: 10, end: 20, content: "PRIVATE_SNIPPET_BODY" },
        { path: "src/beta.ts", start: 30, end: 40, content: "beta" },
        { path: "src/gamma.ts", start: 50, end: 60, content: "gamma" },
        { path: "src/delta.ts", start: 70, end: 80, content: "delta" },
      ];
      const layered = createLayeredToolOutput(
        "ReadSnippets",
        { text: "snippet output", data: { count: 4, ranges } },
        "zh-CN",
      );

      expect(layered.preview).toContain("- 范围:\n  1. src/alpha.ts:10-20");
      expect(layered.preview).toContain("\n  2. src/beta.ts:30-40");
      expect(layered.preview).toContain("\n  3. src/gamma.ts:50-60");
      expect(layered.preview).toContain("另有 1 项在详情中");
      expect(layered.preview).not.toContain("src/delta.ts:70-80");
      expect(layered.preview).not.toContain("PRIVATE_SNIPPET_BODY");
      expect(layered.details).toBe("snippet output");
    });

    it("ReadSnippets English preview labels visible ranges", () => {
      const layered = createLayeredToolOutput(
        "ReadSnippets",
        {
          text: "snippet output",
          data: {
            count: 1,
            ranges: [{ path: "src/alpha.ts", start: 10, end: 20, content: "alpha" }],
          },
        },
        "en-US",
      );

      expect(layered.preview).toContain("- Ranges:\n  1. src/alpha.ts:10-20");
      expect(layered.truncated).toBe(true);
      expect(layered.details).toBe("snippet output");
    });

    it("Grep/Glob 多结果按结构分行编号，匹配数量只显示一次", () => {
      const grep = createStructuredToolOutput(
        "Grep",
        {
          text: "src/a.ts:1: alpha\nsrc/b.ts:2: beta\nsrc/c.ts:3: gamma",
          data: { count: 3 },
        },
        "zh-CN",
      );
      const glob = createLayeredToolOutput(
        "Glob",
        { text: "src/a.ts\nsrc/b.ts\nsrc/c.ts", data: { count: 3 } },
        "zh-CN",
      );

      expect(grep.text.match(/找到 \*\*3\*\* 处匹配。/gu)).toHaveLength(1);
      expect(grep.text).not.toContain("3 条结果");
      expect(grep.layered.preview).toContain("- 结果:\n  1. src/a.ts:1: alpha");
      expect(grep.layered.preview).toContain("\n  2. src/b.ts:2: beta");
      expect(glob.preview).toContain("- 路径:\n  1. src/a.ts");
      expect(glob.preview).toContain("\n  2. src/b.ts");
      expect(glob.preview).not.toContain("src/a.ts; src/b.ts");
    });

    it("SourcePack 多范围和编辑工具多路径按行编号", () => {
      const sourcePack = createLayeredToolOutput(
        "SourcePack",
        {
          text: "source pack output",
          data: {
            count: 2,
            snippets: [
              { path: "src/a.ts", start: 4, end: 8 },
              { path: "src/b.ts", start: 12, end: 16 },
            ],
          },
        },
        "zh-CN",
      );
      const edit = createLayeredToolOutput(
        "MultiEdit",
        {
          text: "edited",
          data: {
            addedLines: 2,
            removedLines: 1,
            changedFiles: ["src/a.ts", "src/b.ts"],
          },
        },
        "zh-CN",
      );

      expect(sourcePack.preview).toContain("- 结果:\n  1. src/a.ts:4-8\n  2. src/b.ts:12-16");
      expect(sourcePack.details).toBe("source pack output");
      expect(edit.preview).toContain("- 路径:\n  1. src/a.ts\n  2. src/b.ts");
      expect(edit.preview).not.toContain("src/a.ts; src/b.ts");
    });

    it("Diff 真实 changedFiles 按行编号，超出路径只进详情", () => {
      const details = [
        "# Full diff evidence",
        "",
        "| File | Status |",
        "| --- | --- |",
        "| src/a.ts | changed |",
        "",
        "```diff",
        "+const changed = true;",
        "```",
      ].join("\n");
      const structured = createStructuredToolOutput(
        "Diff",
        {
          text: "本轮工具改动 4 个文件，+8 -3。\n- src/a.ts\n- src/b.ts\n- src/c.ts\n- src/d.ts",
          details,
          fullOutputPath: ".linghun/session/tool-results/diff.txt",
          evidenceId: "ev-diff",
          data: {
            changedFiles: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
            addedLines: 8,
            removedLines: 3,
          },
        },
        "zh-CN",
      );

      expect(structured.text).toContain("Diff 摘要：4 个文件，+8 -3。");
      expect(structured.layered.preview).toContain(
        "- 路径:\n  1. src/a.ts\n  2. src/b.ts\n  3. src/c.ts",
      );
      expect(structured.layered.preview).toContain("另有 1 项在详情中");
      expect(structured.layered.preview).not.toContain("src/d.ts");
      expect(structured.layered.details).toBe(details);
      expect(structured.block.detailsPath).toBe(".linghun/session/tool-results/diff.txt");
      expect(structured.block.evidenceId).toBe("ev-diff");
    });

    it("Grep count 大于 preview 时按总数折叠，并去掉重复匹配计数", () => {
      const previewText = [
        "找到 10 处匹配。",
        "src/a.ts:1: alpha",
        "src/b.ts:2: beta",
      ].join("\n");
      const outputText = [
        "找到 10 处匹配。",
        ...Array.from({ length: 10 }, (_, index) => `src/${index}.ts:${index + 1}: match`),
      ].join("\n");
      const structured = createStructuredToolOutput(
        "Grep",
        { text: outputText, preview: previewText, data: { count: 10 } },
        "zh-CN",
      );

      expect(structured.text.match(/找到 (?:\*\*)?10(?:\*\*)? 处匹配。/gu)).toHaveLength(1);
      expect(structured.layered.preview).toContain("1. src/a.ts:1: alpha");
      expect(structured.layered.preview).toContain("2. src/b.ts:2: beta");
      expect(structured.layered.preview).toContain("另有 8 项在详情中");
      expect(structured.layered.preview).not.toContain("1. 找到 10 处匹配");
      expect(structured.layered.details).toBe(outputText);
      expect(structured.layered.truncated).toBe(true);
    });

    it("Grep count 大于现有正文但无完整载体时不虚构详情数量", () => {
      const structured = createStructuredToolOutput(
        "Grep",
        {
          text: "src/a.ts:1: alpha\nsrc/b.ts:2: beta",
          data: { count: 10 },
        },
        "zh-CN",
      );

      expect(structured.text).toContain("找到 **10** 处匹配。");
      expect(structured.layered.preview).toContain("1. src/a.ts:1: alpha");
      expect(structured.layered.preview).not.toContain("另有 8 项");
      expect(structured.layered.details).toBeUndefined();
      expect(structured.layered.truncated).toBe(false);
    });

    it("Grep/Glob count=0 不制造伪结果列表", () => {
      const grep = createStructuredToolOutput(
        "Grep",
        { text: "未找到匹配内容。", data: { count: 0 } },
        "zh-CN",
      );
      const glob = createStructuredToolOutput(
        "Glob",
        { text: "未找到匹配文件。", data: { count: 0 } },
        "zh-CN",
      );

      expect(grep.text).toBe("找到 **0** 处匹配。");
      expect(glob.text).toBe("找到 **0** 个文件。");
      expect(grep.layered.preview).toBe("");
      expect(glob.layered.preview).toBe("");
      expect(grep.layered.truncated).toBe(false);
      expect(glob.layered.truncated).toBe(false);
    });

    it("10K Diff 与 50K Grep 压力下主视图有界，详情和引用完整", () => {
      const changedFiles = Array.from({ length: 10_000 }, (_, index) => `src/file-${index}.ts`);
      const diffDetails = [
        "| Kind | Value |",
        "| --- | --- |",
        "| files | 10000 |",
        "",
        "```diff",
        "+full patch retained",
        "```",
        changedFiles.join("\n"),
      ].join("\n");
      const diff = createStructuredToolOutput(
        "Diff",
        {
          text: "diff complete",
          details: diffDetails,
          fullOutputPath: ".linghun/session/tool-results/diff-10k.txt",
          evidenceId: "ev-diff-10k",
          data: { changedFiles, addedLines: 10_000, removedLines: 0 },
        },
        "en-US",
      );
      const grepText = Array.from(
        { length: 50_000 },
        (_, index) => `src/file-${index}.ts:${index + 1}: match`,
      ).join("\n");
      const grep = createStructuredToolOutput(
        "Grep",
        {
          text: grepText,
          fullOutputPath: ".linghun/session/tool-results/grep-50k.txt",
          evidenceId: "ev-grep-50k",
          data: { count: 50_000 },
        },
        "en-US",
      );

      expect(diff.text.length).toBeLessThan(1_000);
      expect(diff.text).toContain("1. src/file-0.ts");
      expect(diff.text).not.toContain("src/file-9999.ts");
      expect(diff.layered.details).toBe(diffDetails);
      expect(diff.block.detailsPath).toBe(".linghun/session/tool-results/diff-10k.txt");
      expect(diff.block.evidenceId).toBe("ev-diff-10k");
      expect(grep.text.length).toBeLessThan(1_000);
      expect(grep.text).toContain("1. src/file-0.ts:1: match");
      expect(grep.text).not.toContain("src/file-49999.ts");
      expect(grep.layered.details).toBe(grepText);
      expect(grep.block.detailsPath).toBe(".linghun/session/tool-results/grep-50k.txt");
      expect(grep.block.evidenceId).toBe("ev-grep-50k");
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
      expect(layered.preview).not.toContain("Ctrl+O");
      expect(layered.truncated).toBe(true);
    });

    it("英文折叠 preview 和 formatted 都不携带 Ctrl+O 提示", () => {
      const layered = createLayeredToolOutput(
        "Read",
        { text: "line\n".repeat(120), data: { lines: 120 } },
        "en-US",
      );
      expect(layered.preview).not.toContain("Ctrl+O");
      expect(layered.preview.toLowerCase()).not.toContain("expand");
      const formatted = formatToolOutput(
        "Read",
        { text: "line\n".repeat(120), data: { lines: 120 } },
        "en-US",
      );
      expect(formatted).not.toContain("Ctrl+O");
    });

    it("legacy stdout hidden hint is stripped from preview", () => {
      const layered = createLayeredToolOutput(
        "Bash",
        {
          text: "line 1\n[stdout] ... 更多输出已隐藏；按 Ctrl+O 展开。\nline 2",
          data: { exitCode: 0, lines: 2 },
        },
        "zh-CN",
      );

      expect(layered.preview).toContain("line 1");
      expect(layered.preview).toContain("line 2");
      expect(layered.preview).not.toContain("更多输出已隐藏");
      expect(layered.preview).not.toContain("Ctrl+O");
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
      expect(layered.preview).toContain("- 路径:\n  1. a.ts");
      expect(layered.preview).not.toContain("changedFiles 1");
    });

    it("大响应预算文案不进入主视图，details/fullOutputPath/evidence 保持完整", () => {
      const details = [
        "# Full output",
        "",
        "| Name | Value |",
        "| --- | --- |",
        "| result | kept |",
        "",
        "```ts",
        "const preserved = true;",
        "```",
      ].join("\n");
      const output = {
        text: `${"long output line\n".repeat(700)}tail`,
        details,
        fullOutputPath: ".linghun/session/tool-results/large.txt",
        evidenceId: "ev-large-output",
        data: { exitCode: 0 },
      };

      const structured = createStructuredToolOutput("Bash", output, "zh-CN");

      expect(structured.text).not.toContain("大响应");
      expect(structured.text).not.toContain("tokens");
      expect(structured.block.body).not.toContain("大响应");
      expect(structured.layered.details).toBe(details);
      expect(structured.layered.details).toContain("| result | kept |");
      expect(structured.layered.details).toContain("```ts");
      expect(structured.layered.fullOutputPath).toBe(output.fullOutputPath);
      expect(structured.layered.evidenceId).toBe(output.evidenceId);
      expect(structured.block.detailsPath).toBe(output.fullOutputPath);
      expect(structured.block.evidenceId).toBe(output.evidenceId);
      expect(structured.block.collapsible).toBe(true);
    });

    it("Edit preview and details prefer structured patch hunks", () => {
      const output = {
        text: "edited",
        details: "operation: Edit\nlegacy detail",
        data: {
          addedLines: 1,
          removedLines: 1,
          lines: 2,
          changedFiles: ["src/app.ts"],
          structuredPatch: {
            files: [
              {
                path: "src/app.ts",
                hunks: [
                  {
                    oldStart: 7,
                    newStart: 7,
                    contextBefore: ["const id = 1;"],
                    oldLines: ["const label = 'old';"],
                    newLines: ["const label = 'new';"],
                    contextAfter: ["return label;"],
                    oldLineCount: 1,
                    newLineCount: 1,
                  },
                ],
              },
            ],
          },
        },
        truncated: true,
      };

      const formatted = formatToolOutput("Edit", output, "en-US");
      const layered = createLayeredToolOutput("Edit", output, "en-US");

      expect(formatted).toContain("```diff");
      expect(formatted).toContain("--- src/app.ts");
      expect(formatted).not.toContain("changed 1 file");
      expect(formatted).toContain("@@ -6,3 +6,3 @@");
      expect(formatted).toContain(" const id = 1;");
      expect(formatted).toContain("-const label = 'old';");
      expect(formatted).toContain("+const label = 'new';");
      expect(formatted).toContain(" return label;");
      expect(layered.details).toContain("legacy detail");
      expect(layered.details).toContain("```diff");
    });

    it("large structured edit diffs degrade to a bounded preview with an explicit marker", () => {
      const output = {
        text: "edited",
        data: {
          addedLines: 40,
          removedLines: 40,
          changedFiles: ["src/large.ts"],
          structuredPatch: {
            files: [
              {
                path: "src/large.ts",
                hunks: [
                  {
                    oldStart: 1,
                    newStart: 1,
                    oldLines: Array.from({ length: 30 }, (_, index) => `old-${index + 1}`),
                    newLines: Array.from({ length: 30 }, (_, index) => `new-${index + 1}`),
                    oldLineCount: 40,
                    newLineCount: 40,
                    truncated: true,
                  },
                ],
              },
            ],
          },
        },
        truncated: true,
      };

      const formatted = formatToolOutput("MultiEdit", output, "en-US");

      expect(formatted).toContain("```diff");
      expect(formatted).toContain("--- src/large.ts");
      expect(formatted).toContain("@@ -1,40 +1,40 @@");
      expect(formatted).toContain("... diff preview truncated; open details for the full patch ...");
      expect(formatted).not.toContain("old-30");
      expect(formatted).not.toContain("new-30");
    });

    it("主屏 summary 将半机器字段改成人话", () => {
      const layered = createLayeredToolOutput(
        "Edit",
        {
          text: "edited",
          summary: "Edit sample.txt: +1 -1; changedFiles=1; contentLines=5",
          changedFiles: ["sample.txt"],
          data: { addedLines: 1, removedLines: 1, lines: 1 },
        },
        "zh-CN",
      );
      expect(layered.summary).toContain("改动文件：1");
      expect(layered.summary).toContain("内容行数：5");
      expect(layered.summary).not.toContain("changedFiles=");
      expect(layered.summary).not.toContain("contentLines=");
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
