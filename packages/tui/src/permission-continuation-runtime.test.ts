import { describe, expect, it } from "vitest";
import {
  type PermissionRule,
  type PermissionState,
  type ReportWriteGuard,
  collectInputFiles,
  createReportFinalReferenceReminder,
  createReportTaskGuard,
  createReportWriteGuard,
  createReportWriteReminder,
  doesWriteSatisfyReportGuard,
  extractRequestedReportPath,
  findPermissionRule,
  formatDiffBeforeWrite,
  formatModelToolOutput,
  formatPermissionDenialPrimary,
  formatPermissionDenied,
  formatPermissionRules,
  formatPermissionSummary,
  formatRecentDenied,
  getHardDenyReason,
  hasRepeatedPermissionDenial,
  hasReportFinalAnswerShape,
  hasReportWriteToolCall,
  isLowRiskWorkspaceEdit,
  isPlanAllowedTool,
  isReportFileWriteRequest,
  normalizeReportPath,
  normalizeToolName,
  parsePermissionModeInput,
  redactRemoteSummary,
  remoteTranscriptSummary,
  shouldSendReportEvidenceReminder,
  shouldSendReportFinalReferenceReminder,
  shouldSendReportWriteReminder,
} from "./permission-continuation-runtime.js";

describe("permission-continuation-runtime", () => {
  describe("formatPermissionDenialPrimary", () => {
    it("returns Chinese denial message", () => {
      const result = formatPermissionDenialPrimary("zh-CN");
      expect(result).toContain("已拒绝");
    });

    it("returns English denial message", () => {
      const result = formatPermissionDenialPrimary("en-US");
      expect(result).toContain("Denied");
    });
  });

  describe("formatPermissionDenied", () => {
    it("includes reason and summary", () => {
      const result = formatPermissionDenied("越界", "工具 Write；目标：../secret");
      expect(result).toContain("越界");
      expect(result).toContain("工具 Write");
    });
  });

  describe("formatPermissionSummary", () => {
    it("formats with files", () => {
      const result = formatPermissionSummary("Write", ["src/a.ts"], "low");
      expect(result).toContain("Write");
      expect(result).toContain("src/a.ts");
      expect(result).toContain("low");
    });

    it("formats without files", () => {
      const result = formatPermissionSummary("Bash", [], "high");
      expect(result).toContain("无文件路径");
    });
  });

  describe("formatDiffBeforeWrite", () => {
    it("includes tool name and files", () => {
      const result = formatDiffBeforeWrite("Edit", ["src/index.ts"], "medium");
      expect(result).toContain("Edit");
      expect(result).toContain("src/index.ts");
      expect(result).toContain("medium");
    });
  });

  describe("isLowRiskWorkspaceEdit", () => {
    it("returns true for Write with low risk and files", () => {
      expect(isLowRiskWorkspaceEdit("Write", "low", ["a.ts"])).toBe(true);
    });

    it("returns false for Bash", () => {
      expect(isLowRiskWorkspaceEdit("Bash", "low", ["a.ts"])).toBe(false);
    });

    it("returns false for high risk", () => {
      expect(isLowRiskWorkspaceEdit("Write", "high", ["a.ts"])).toBe(false);
    });

    it("returns false for medium risk writes", () => {
      expect(isLowRiskWorkspaceEdit("Write", "medium", ["a.ts"])).toBe(false);
      expect(isLowRiskWorkspaceEdit("MultiEdit", "medium", ["a.ts"])).toBe(false);
    });

    it("returns false for empty files", () => {
      expect(isLowRiskWorkspaceEdit("Write", "low", [])).toBe(false);
    });
  });

  describe("collectInputFiles", () => {
    it("extracts path from input object", () => {
      expect(collectInputFiles({ path: "src/a.ts" })).toEqual(["src/a.ts"]);
    });

    it("normalizes backslashes", () => {
      expect(collectInputFiles({ path: "src\\a.ts" })).toEqual(["src/a.ts"]);
    });

    it("extracts all paths from multi-file permission input", () => {
      expect(collectInputFiles({ paths: ["src\\a.ts", "src/b.ts", 123] })).toEqual([
        "src/a.ts",
        "src/b.ts",
      ]);
    });

    it("returns empty for null input", () => {
      expect(collectInputFiles(null)).toEqual([]);
    });

    it("returns empty for input without path", () => {
      expect(collectInputFiles({ command: "ls" })).toEqual([]);
    });
  });

  describe("getHardDenyReason", () => {
    it("denies path traversal", () => {
      const result = getHardDenyReason("Write", { path: "../secret" }, ["../secret"], "/workspace");
      expect(result).toContain("越界");
    });

    it("denies .git modification", () => {
      const result = getHardDenyReason(
        "Write",
        { path: ".git/config" },
        [".git/config"],
        "/workspace",
      );
      expect(result).toContain(".git");
    });

    it("denies .env files", () => {
      const result = getHardDenyReason("Write", { path: ".env" }, [".env"], "/workspace");
      expect(result).toContain("密钥");
    });

    it("denies empty Bash command", () => {
      const result = getHardDenyReason("Bash", { command: "" }, [], "/workspace");
      expect(result).toContain("不能为空");
    });

    it("allows explicit Bash service validation without command", () => {
      const result = getHardDenyReason(
        "Bash",
        { service: { action: "fetch", url: "http://127.0.0.1:8080", expectStatus: 200 } },
        [],
        "/workspace",
      );
      expect(result).toBeNull();
    });

    it("allows explicit Bash artifact validation without command", () => {
      const result = getHardDenyReason("Bash", { artifact: { path: "/app/server.py" } }, [], "/workspace");
      expect(result).toBeNull();
    });

    it("allows explicit Bash binary validation without command", () => {
      const result = getHardDenyReason("Bash", { binary: { path: "/app/a.out" } }, [], "/workspace");
      expect(result).toBeNull();
    });

    it("denies rm -rf", () => {
      const result = getHardDenyReason("Bash", { command: "rm -rf /" }, [], "/workspace");
      expect(result).toContain("高风险");
    });

    it("allows safe workspace file", () => {
      const result = getHardDenyReason("Write", { path: "src/a.ts" }, ["src/a.ts"], "/workspace");
      expect(result).toBeNull();
    });

    // D.13O — UNC / WebDAV / 远程路径 hard-deny。
    it("denies UNC path with backslashes", () => {
      const result = getHardDenyReason(
        "Read",
        { path: "\\\\server\\share\\foo.txt" },
        ["\\\\server\\share\\foo.txt"],
        "/workspace",
      );
      expect(result).toMatch(/UNC|WebDAV|远程路径/iu);
    });

    it("denies UNC path with forward slashes", () => {
      const result = getHardDenyReason(
        "Read",
        { path: "//server/share/foo.txt" },
        ["//server/share/foo.txt"],
        "/workspace",
      );
      expect(result).toMatch(/UNC|WebDAV|远程路径/iu);
    });

    it("denies WebDAV @SSL@ style path", () => {
      const result = getHardDenyReason(
        "Read",
        { path: "//webdav.example.com@SSL@443/folder" },
        ["//webdav.example.com@SSL@443/folder"],
        "/workspace",
      );
      expect(result).toMatch(/UNC|WebDAV|远程路径/iu);
    });
  });

  describe("findPermissionRule", () => {
    const rules: PermissionRule[] = [
      { id: "r1", effect: "allow", toolName: "Read" },
      { id: "r2", effect: "deny", toolName: "Bash", risk: "high" },
      { id: "r3", effect: "ask", toolName: "*" },
    ];

    it("finds exact tool match", () => {
      expect(findPermissionRule(rules, "Read", "low")?.id).toBe("r1");
    });

    it("finds wildcard match", () => {
      expect(findPermissionRule(rules, "Write", "low")?.id).toBe("r3");
    });

    it("matches risk level", () => {
      expect(findPermissionRule(rules, "Bash", "high")?.id).toBe("r2");
    });

    it("returns undefined when no match", () => {
      expect(findPermissionRule([], "Write", "low")).toBeUndefined();
    });
  });

  describe("isPlanAllowedTool", () => {
    it("allows read-only tools", () => {
      expect(isPlanAllowedTool("Read", true)).toBe(true);
    });

    it("allows Todo", () => {
      expect(isPlanAllowedTool("Todo", false)).toBe(true);
    });

    it("denies non-readonly non-Todo", () => {
      expect(isPlanAllowedTool("Write", false)).toBe(false);
    });
  });

  describe("parsePermissionModeInput", () => {
    it("parses valid mode", () => {
      expect(parsePermissionModeInput("default")).toBe("default");
    });

    it("returns null for invalid mode", () => {
      expect(parsePermissionModeInput("invalid")).toBeNull();
    });
  });

  describe("formatPermissionRules", () => {
    it("shows empty message when no rules", () => {
      const state: PermissionState = { rules: [], recentDenied: [] };
      expect(formatPermissionRules(state)).toContain("没有持久化权限规则");
    });

    it("formats rules list", () => {
      const state: PermissionState = {
        rules: [{ id: "r1", effect: "allow", toolName: "Read" }],
        recentDenied: [],
      };
      expect(formatPermissionRules(state)).toContain("r1");
      expect(formatPermissionRules(state)).toContain("allow");
    });
  });

  describe("formatRecentDenied", () => {
    it("shows empty message when no denials", () => {
      const state: PermissionState = { rules: [], recentDenied: [] };
      expect(formatRecentDenied(state)).toContain("没有拒绝记录");
    });

    it("formats denial list", () => {
      const state: PermissionState = {
        rules: [],
        recentDenied: [
          { id: "d1", toolName: "Bash", mode: "default", reason: "test", createdAt: "2025-01-01" },
        ],
      };
      const result = formatRecentDenied(state);
      expect(result).toContain("Bash");
      expect(result).toContain("default");
    });
  });

  describe("hasRepeatedPermissionDenial", () => {
    it("returns false for empty list", () => {
      expect(hasRepeatedPermissionDenial([])).toBe(false);
    });

    it("returns true when same denial repeated 3+ times", () => {
      const items = Array.from({ length: 3 }, () => ({
        id: "x",
        toolName: "Bash" as const,
        mode: "default" as const,
        reason: "same reason",
        createdAt: "2025-01-01",
      }));
      expect(hasRepeatedPermissionDenial(items)).toBe(true);
    });

    it("returns false for different denials", () => {
      const items = [
        {
          id: "1",
          toolName: "Bash" as const,
          mode: "default" as const,
          reason: "a",
          createdAt: "2025-01-01",
        },
        {
          id: "2",
          toolName: "Write" as const,
          mode: "default" as const,
          reason: "b",
          createdAt: "2025-01-01",
        },
        {
          id: "3",
          toolName: "Edit" as const,
          mode: "default" as const,
          reason: "c",
          createdAt: "2025-01-01",
        },
      ];
      expect(hasRepeatedPermissionDenial(items)).toBe(false);
    });
  });

  describe("redactRemoteSummary", () => {
    it("redacts API keys", () => {
      const result = redactRemoteSummary("api_key=sk-abc123 other");
      expect(result).not.toContain("sk-abc123");
      expect(result).toContain("[REDACTED]");
    });

    it("redacts Bearer tokens", () => {
      const result = redactRemoteSummary("Bearer eyJhbGciOiJIUzI1NiJ9");
      expect(result).not.toContain("eyJhbGciOiJIUzI1NiJ9");
      expect(result).toContain("[REDACTED]");
    });

    it("redacts sk- prefixed keys", () => {
      const result = redactRemoteSummary("key is sk-proj-abc123xyz");
      expect(result).not.toContain("sk-proj-abc123xyz");
      expect(result).toContain("sk-[REDACTED]");
    });

    it("redacts URLs", () => {
      const result = redactRemoteSummary("endpoint https://api.example.com/v1");
      expect(result).not.toContain("https://api.example.com");
      expect(result).toContain("[REDACTED_ENDPOINT]");
    });

    it("redacts token parameters", () => {
      const result = redactRemoteSummary("token=secret123 done");
      expect(result).not.toContain("secret123");
      expect(result).toContain("[REDACTED]");
    });
  });

  describe("remoteTranscriptSummary", () => {
    it("truncates and redacts", () => {
      const long = `Bearer secret123 ${"x".repeat(300)}`;
      const result = remoteTranscriptSummary(long);
      expect(result.length).toBeLessThanOrEqual(221);
      expect(result).not.toContain("secret123");
    });
  });

  describe("normalizeToolName", () => {
    it("normalizes case-insensitive match", () => {
      expect(normalizeToolName("read")).toBe("Read");
      expect(normalizeToolName("WRITE")).toBe("Write");
    });

    it("returns null for unknown tool", () => {
      expect(normalizeToolName("nonexistent")).toBeNull();
    });
  });

  describe("report write guard", () => {
    describe("createReportWriteGuard", () => {
      it("creates guard for report write request", () => {
        const guard = createReportWriteGuard("生成报告文件 report.md");
        expect(guard).toBeDefined();
        expect(guard?.requestedPath).toBe("report.md");
      });

      it("returns undefined for non-report request", () => {
        expect(createReportWriteGuard("帮我看看代码")).toBeUndefined();
      });

      it("does not create a report guard when the same turn forbids writing", () => {
        expect(
          createReportWriteGuard("查询我偏好的压测报告格式是什么？不要写文件，不要创建报告。"),
        ).toBeUndefined();
      });

      it("does not invent report.md when the markdown target is not parseable", () => {
        expect(createReportWriteGuard("生成报告保存为 .md")).toBeUndefined();
      });

      it("creates a non-explicit guard so the model can choose the report filename", () => {
        const guard = createReportWriteGuard("生成报告在根目录");
        expect(guard).toBeDefined();
        expect(guard?.pathExplicit).toBe(false);
        expect(guard?.requestedPath).toBe("");
      });
    });

    describe("isReportFileWriteRequest", () => {
      it("detects Chinese report write request", () => {
        expect(isReportFileWriteRequest("生成报告文件 report.md")).toBe(true);
      });

      it("detects English report write request", () => {
        expect(isReportFileWriteRequest("generate report file audit.md")).toBe(true);
      });

      it("rejects non-report request", () => {
        expect(isReportFileWriteRequest("read the file")).toBe(false);
      });

      it("detects report write requests without forcing a filename", () => {
        expect(isReportFileWriteRequest("生成报告")).toBe(true);
        expect(isReportFileWriteRequest("保存报告")).toBe(true);
      });

      it("rejects false positives like 汇报改动文件", () => {
        expect(isReportFileWriteRequest("汇报改动文件")).toBe(false);
        expect(isReportFileWriteRequest("报告汇总")).toBe(false);
        expect(isReportFileWriteRequest("修复后汇报")).toBe(false);
        expect(isReportFileWriteRequest("输出结果")).toBe(false);
      });

      it("requires explicit .md file path", () => {
        expect(isReportFileWriteRequest("生成报告保存为 report.md")).toBe(true);
        expect(isReportFileWriteRequest("写入报告到 audit.md")).toBe(true);
      });
    });

    describe("extractRequestedReportPath", () => {
      it("extracts quoted path", () => {
        expect(extractRequestedReportPath('save to "audit-report.md"')).toBe("audit-report.md");
      });

      it("extracts report path from text", () => {
        expect(extractRequestedReportPath("写到 my-report.md")).toBe("my-report.md");
      });

      it("returns undefined when no path found", () => {
        expect(extractRequestedReportPath("just a report")).toBeUndefined();
      });
    });

    describe("normalizeReportPath", () => {
      it("normalizes backslashes", () => {
        expect(normalizeReportPath("docs\\report.md")).toBe("docs/report.md");
      });

      it("removes leading ./", () => {
        expect(normalizeReportPath("./report.md")).toBe("report.md");
      });
    });

    describe("shouldSendReportEvidenceReminder", () => {
      it("does not force an evidence reminder before writing", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "r.md",
          pathExplicit: true,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: false,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: false,
        };
        expect(shouldSendReportEvidenceReminder(guard)).toBe(false);
      });

      it("returns false when evidence already read", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "r.md",
          pathExplicit: true,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: false,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: true,
        };
        expect(shouldSendReportEvidenceReminder(guard)).toBe(false);
      });

      it("returns false for undefined guard", () => {
        expect(shouldSendReportEvidenceReminder(undefined)).toBe(false);
      });
    });

    describe("shouldSendReportWriteReminder", () => {
      it("returns true when not completed even without evidence", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "r.md",
          pathExplicit: true,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: true,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: false,
        };
        expect(shouldSendReportWriteReminder(guard)).toBe(true);
      });

      it("returns false when already completed", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "r.md",
          pathExplicit: true,
          completed: true,
          reminderSent: false,
          evidenceReminderSent: true,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: true,
        };
        expect(shouldSendReportWriteReminder(guard)).toBe(false);
      });
    });

    describe("shouldSendReportFinalReferenceReminder", () => {
      it("returns true when completed but path not referenced", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "report.md",
          pathExplicit: true,
          completed: true,
          reminderSent: true,
          evidenceReminderSent: true,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: true,
        };
        expect(shouldSendReportFinalReferenceReminder(guard, "some text")).toBe(true);
      });

      it("returns false when already sent", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "report.md",
          pathExplicit: true,
          completed: true,
          reminderSent: true,
          evidenceReminderSent: true,
          finalReferenceReminderSent: true,
          nonWriteToolRounds: 0,
          evidenceRead: true,
        };
        expect(shouldSendReportFinalReferenceReminder(guard, "some text")).toBe(false);
      });
    });

    describe("hasReportFinalAnswerShape", () => {
      it("detects conclusion + next steps", () => {
        expect(hasReportFinalAnswerShape("结论是...下一步建议...")).toBe(true);
      });

      it("rejects text without both parts", () => {
        expect(hasReportFinalAnswerShape("just some text")).toBe(false);
      });
    });

    describe("createReportFinalReferenceReminder", () => {
      it("includes path in Chinese", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "audit.md",
          pathExplicit: true,
          completed: true,
          reminderSent: true,
          evidenceReminderSent: true,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: true,
        };
        expect(createReportFinalReferenceReminder(guard, "zh-CN")).toContain("audit.md");
      });
    });

    describe("createReportTaskGuard", () => {
      it("includes path in English", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "report.md",
          pathExplicit: true,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: false,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: false,
        };
        expect(createReportTaskGuard(guard, "en-US")).toContain("report.md");
      });

      it("lets the model choose a Markdown path when none was explicit", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "",
          pathExplicit: false,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: false,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: false,
        };
        const text = createReportTaskGuard(guard, "zh-CN");
        expect(text).toContain("选择合适的 Markdown 文件路径");
        expect(text).not.toContain("report.md");
      });
    });

    describe("createReportWriteReminder", () => {
      it("includes path in Chinese", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "result.md",
          pathExplicit: true,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: true,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: true,
        };
        expect(createReportWriteReminder(guard, "zh-CN")).toContain("result.md");
      });

      it("asks for an actual Markdown write without inventing a path", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "",
          pathExplicit: false,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: true,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: false,
        };
        const text = createReportWriteReminder(guard, "zh-CN");
        expect(text).toContain("选择合适的 Markdown 路径");
        expect(text).not.toContain("report.md");
      });
    });

    describe("doesWriteSatisfyReportGuard", () => {
      it("returns true when Write matches guard path", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "report.md",
          pathExplicit: true,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: false,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: true,
        };
        const toolCall = { id: "tc1", name: "Write", input: { path: "report.md", content: "x" } };
        expect(doesWriteSatisfyReportGuard(guard, toolCall, { ok: true, tool: "Write" })).toBe(
          true,
        );
      });

      it("returns true when Edit matches guard path", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "report.md",
          pathExplicit: true,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: false,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: false,
        };
        const toolCall = {
          id: "tc1",
          name: "Edit",
          input: { path: "report.md", oldText: "draft", newText: "final" },
        };
        expect(doesWriteSatisfyReportGuard(guard, toolCall, { ok: true, tool: "Edit" })).toBe(
          true,
        );
      });

      it("returns true when WriteReport delegates to a matching Write", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "report.md",
          pathExplicit: true,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: false,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: false,
        };
        const toolCall = {
          id: "tc1",
          name: "WriteReport",
          input: { path: "report.md", content: "x" },
        };
        expect(doesWriteSatisfyReportGuard(guard, toolCall, { ok: true, tool: "Write" })).toBe(
          true,
        );
      });

      it("returns false when result not ok", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "report.md",
          pathExplicit: true,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: false,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: true,
        };
        const toolCall = { id: "tc1", name: "Write", input: { path: "report.md", content: "x" } };
        expect(doesWriteSatisfyReportGuard(guard, toolCall, { ok: false, tool: "Write" })).toBe(
          false,
        );
      });

      it("returns false for undefined guard", () => {
        const toolCall = { id: "tc1", name: "Write", input: { path: "report.md", content: "x" } };
        expect(doesWriteSatisfyReportGuard(undefined, toolCall, { ok: true, tool: "Write" })).toBe(
          false,
        );
      });
    });

    describe("hasReportWriteToolCall", () => {
      it("matches explicit path", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "report.md",
          pathExplicit: true,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: false,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: true,
        };
        const calls = [{ id: "tc1", name: "Write", input: { path: "report.md", content: "x" } }];
        expect(hasReportWriteToolCall(guard, calls)).toBe(true);
      });

      it("matches explicit path through MultiEdit", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "report.md",
          pathExplicit: true,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: false,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: false,
        };
        const calls = [
          {
            id: "tc1",
            name: "MultiEdit",
            input: { path: "report.md", edits: [{ oldText: "draft", newText: "final" }] },
          },
        ];
        expect(hasReportWriteToolCall(guard, calls)).toBe(true);
      });

      it("matches explicit path through WriteReport", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "report.md",
          pathExplicit: true,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: false,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: false,
        };
        const calls = [
          { id: "tc1", name: "WriteReport", input: { path: "report.md", content: "x" } },
        ];
        expect(hasReportWriteToolCall(guard, calls)).toBe(true);
      });

      it("matches write path aliases used by tool adapters", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "report.md",
          pathExplicit: true,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: false,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: false,
        };
        expect(
          hasReportWriteToolCall(guard, [
            { id: "tc1", name: "Write", input: { file_path: "report.md", content: "x" } },
          ]),
        ).toBe(true);
        expect(
          hasReportWriteToolCall(guard, [
            { id: "tc2", name: "Write", input: { filePath: "report.md", content: "x" } },
          ]),
        ).toBe(true);
      });

      it("binds a model-chosen Markdown path from aliases", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "",
          pathExplicit: false,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: false,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: false,
        };
        expect(
          hasReportWriteToolCall(guard, [
            { id: "tc1", name: "Write", input: { file_path: "deploy-report.md", content: "x" } },
          ]),
        ).toBe(true);
        expect(guard.requestedPath).toBe("deploy-report.md");
      });

      it("rejects non-Write tool", () => {
        const guard: ReportWriteGuard = {
          requestedPath: "report.md",
          pathExplicit: true,
          completed: false,
          reminderSent: false,
          evidenceReminderSent: false,
          finalReferenceReminderSent: false,
          nonWriteToolRounds: 0,
          evidenceRead: true,
        };
        const calls = [{ id: "tc1", name: "Read", input: { path: "report.md" } }];
        expect(hasReportWriteToolCall(guard, calls)).toBe(false);
      });
    });
  });
});
