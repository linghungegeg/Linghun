import { describe, expect, it } from "vitest";
import {
  type SolutionCompletenessStatus,
  createModelToolDefinitions,
  createModelToolDefinitionsForReportGuard,
  createModelToolDefinitionsForTools,
  createSolutionCompletenessStatus,
  createToolInputSchema,
  createToolUseDriftSummary,
  extractFileMentions,
  extractFileSearchKeywords,
  extractNaturalReadPath,
  formatFileCandidates,
  formatSolutionCompletenessTrigger,
  hasModelSynthesisIntent,
  inferSolutionCompletenessImpactAreas,
  isNaturalReadFileRequest,
  looksLikeFilePath,
  matchesFileKeywords,
  normalizeRelativePath,
  readToolInputString,
} from "./model-loop-runtime.js";

describe("model-loop-runtime", () => {
  describe("createToolInputSchema", () => {
    it("returns Read schema with path required", () => {
      const schema = createToolInputSchema("Read") as {
        required: string[];
        properties: Record<string, unknown>;
      };
      expect(schema.required).toContain("path");
      expect(schema.properties).toHaveProperty("path");
      expect(schema.properties).toHaveProperty("offset");
      expect(schema.properties).toHaveProperty("limit");
    });

    it("returns Write schema with path and content required", () => {
      const schema = createToolInputSchema("Write") as {
        required: string[];
      };
      expect(schema.required).toContain("path");
      expect(schema.required).toContain("content");
    });

    it("returns Edit schema with path, oldText, newText required", () => {
      const schema = createToolInputSchema("Edit") as {
        required: string[];
      };
      expect(schema.required).toContain("path");
      expect(schema.required).toContain("oldText");
      expect(schema.required).toContain("newText");
    });

    it("returns MultiEdit schema with path and edits required", () => {
      const schema = createToolInputSchema("MultiEdit") as {
        required: string[];
      };
      expect(schema.required).toContain("path");
      expect(schema.required).toContain("edits");
    });

    it("returns Bash schema with command required", () => {
      const schema = createToolInputSchema("Bash") as {
        required: string[];
      };
      expect(schema.required).toContain("command");
    });

    it("returns Todo schema with action required", () => {
      const schema = createToolInputSchema("Todo") as {
        required: string[];
      };
      expect(schema.required).toContain("action");
    });

    it("returns Grep schema with pattern required", () => {
      const schema = createToolInputSchema("Grep") as {
        required: string[];
      };
      expect(schema.required).toContain("pattern");
    });

    it("returns Glob schema with pattern required", () => {
      const schema = createToolInputSchema("Glob") as {
        required: string[];
      };
      expect(schema.required).toContain("pattern");
    });
  });

  describe("createModelToolDefinitions", () => {
    it("returns definitions for all built-in tools", () => {
      const defs = createModelToolDefinitions();
      expect(defs.length).toBeGreaterThan(0);
      expect(defs.some((d) => d.name === "Read")).toBe(true);
      expect(defs.some((d) => d.name === "Write")).toBe(true);
      expect(defs.some((d) => d.name === "Bash")).toBe(true);
    });

    it("each definition has name, description, inputSchema", () => {
      const defs = createModelToolDefinitions();
      for (const def of defs) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.inputSchema).toBeDefined();
      }
    });
  });

  describe("createModelToolDefinitionsForReportGuard", () => {
    it("returns all tools when guard is undefined", () => {
      const defs = createModelToolDefinitionsForReportGuard(undefined);
      expect(defs.some((d) => d.name === "Bash")).toBe(true);
    });

    it("returns all tools when guard is completed", () => {
      const guard = {
        requestedPath: "r.md",
        pathExplicit: true,
        completed: true,
        reminderSent: false,
        evidenceReminderSent: false,
        finalReferenceReminderSent: false,
        nonWriteToolRounds: 0,
        evidenceRead: true,
      };
      const defs = createModelToolDefinitionsForReportGuard(guard);
      expect(defs.some((d) => d.name === "Bash")).toBe(true);
    });

    it("returns only Read/Grep/Glob when evidence not read", () => {
      const guard = {
        requestedPath: "r.md",
        pathExplicit: true,
        completed: false,
        reminderSent: false,
        evidenceReminderSent: false,
        finalReferenceReminderSent: false,
        nonWriteToolRounds: 0,
        evidenceRead: false,
      };
      const defs = createModelToolDefinitionsForReportGuard(guard);
      expect(defs.length).toBe(3);
      expect(defs.map((d) => d.name).sort()).toEqual(["Glob", "Grep", "Read"]);
    });

    it("excludes Bash when evidence read but nonWriteToolRounds < 1", () => {
      const guard = {
        requestedPath: "r.md",
        pathExplicit: true,
        completed: false,
        reminderSent: false,
        evidenceReminderSent: false,
        finalReferenceReminderSent: false,
        nonWriteToolRounds: 0,
        evidenceRead: true,
      };
      const defs = createModelToolDefinitionsForReportGuard(guard);
      expect(defs.some((d) => d.name === "Bash")).toBe(false);
      expect(defs.some((d) => d.name === "Write")).toBe(true);
    });

    it("returns only Write when nonWriteToolRounds >= 1", () => {
      const guard = {
        requestedPath: "r.md",
        pathExplicit: true,
        completed: false,
        reminderSent: false,
        evidenceReminderSent: false,
        finalReferenceReminderSent: false,
        nonWriteToolRounds: 1,
        evidenceRead: true,
      };
      const defs = createModelToolDefinitionsForReportGuard(guard);
      expect(defs.length).toBe(1);
      expect(defs[0].name).toBe("Write");
    });
  });

  describe("createModelToolDefinitionsForTools", () => {
    it("maps tools to definitions", () => {
      const defs = createModelToolDefinitionsForTools([
        { name: "Read", description: "Read a file", isReadOnly: true },
      ] as never[]);
      expect(defs.length).toBe(1);
      expect(defs[0].name).toBe("Read");
    });
  });

  describe("createToolUseDriftSummary", () => {
    it("includes path for Write tool", () => {
      const result = createToolUseDriftSummary("Write", {
        path: "src/a.ts",
        content: "x",
      });
      expect(result).toBe("Write: src/a.ts");
    });

    it("includes path for Edit tool", () => {
      const result = createToolUseDriftSummary("Edit", {
        path: "src/b.ts",
        oldText: "a",
        newText: "b",
      });
      expect(result).toBe("Edit: src/b.ts");
    });

    it("falls back to JSON for other tools", () => {
      const result = createToolUseDriftSummary("Bash", { command: "ls" });
      expect(result).toContain("Bash:");
      expect(result).toContain("ls");
    });

    it("handles null input", () => {
      const result = createToolUseDriftSummary("Read", null);
      expect(result).toContain("Read:");
    });
  });

  describe("readToolInputString", () => {
    it("reads string value by key", () => {
      expect(readToolInputString({ path: "a.ts" }, "path")).toBe("a.ts");
    });

    it("returns undefined for non-string value", () => {
      expect(readToolInputString({ path: 123 }, "path")).toBeUndefined();
    });

    it("returns undefined for missing key", () => {
      expect(readToolInputString({ other: "x" }, "path")).toBeUndefined();
    });

    it("returns undefined for null input", () => {
      expect(readToolInputString(null, "path")).toBeUndefined();
    });

    it("returns undefined for array input", () => {
      expect(readToolInputString(["a"], "0")).toBeUndefined();
    });
  });

  // D.13Q-UX Closure: needsFreshnessLiteBoundary / formatFreshnessLitePrimaryWarning
  // 已在 model-loop-runtime.ts 中删除（过度设计的普通输入 regex gate）。
  // 反幻觉边界改放 system prompt + evidence rule，不再由 regex 拦截普通输入。

  describe("isNaturalReadFileRequest", () => {
    it("detects Chinese read requests", () => {
      expect(isNaturalReadFileRequest("读取一下 src/a.ts")).toBe(true);
      expect(isNaturalReadFileRequest("看看这个文件")).toBe(true);
    });

    it("detects English read requests", () => {
      expect(isNaturalReadFileRequest("show me the file")).toBe(true);
      expect(isNaturalReadFileRequest("read src/a.ts")).toBe(true);
    });

    it("rejects non-read requests", () => {
      expect(isNaturalReadFileRequest("fix the bug")).toBe(false);
    });
  });

  describe("hasModelSynthesisIntent", () => {
    it("detects Chinese synthesis intent", () => {
      expect(hasModelSynthesisIntent("总结一下")).toBe(true);
      expect(hasModelSynthesisIntent("分析这段代码")).toBe(true);
    });

    it("detects English synthesis intent", () => {
      expect(hasModelSynthesisIntent("summarize this")).toBe(true);
      expect(hasModelSynthesisIntent("explain the code")).toBe(true);
    });

    it("rejects non-synthesis text", () => {
      expect(hasModelSynthesisIntent("read the file")).toBe(false);
    });
  });

  describe("looksLikeFilePath", () => {
    it("detects paths with slashes", () => {
      expect(looksLikeFilePath("src/a.ts")).toBe(true);
      expect(looksLikeFilePath("src\\a.ts")).toBe(true);
    });

    it("detects paths with extensions", () => {
      expect(looksLikeFilePath("file.ts")).toBe(true);
      expect(looksLikeFilePath("readme.md")).toBe(true);
    });

    it("rejects plain words", () => {
      expect(looksLikeFilePath("hello")).toBe(false);
    });
  });

  describe("extractNaturalReadPath", () => {
    it("extracts quoted path", () => {
      expect(extractNaturalReadPath('read "src/a.ts"')).toBe("src/a.ts");
    });

    it("extracts path token from text", () => {
      expect(extractNaturalReadPath("看看 src/index.ts")).toBe("src/index.ts");
    });

    it("returns null when no path found", () => {
      expect(extractNaturalReadPath("just some text")).toBeNull();
    });
  });

  describe("normalizeRelativePath", () => {
    it("normalizes backslashes", () => {
      expect(normalizeRelativePath("src\\a.ts")).toBe("src/a.ts");
    });

    it("removes leading ./", () => {
      expect(normalizeRelativePath("./src/a.ts")).toBe("src/a.ts");
    });

    it("trims whitespace", () => {
      expect(normalizeRelativePath("  src/a.ts  ")).toBe("src/a.ts");
    });
  });

  describe("extractFileSearchKeywords", () => {
    it("extracts meaningful keywords", () => {
      const result = extractFileSearchKeywords("read the index.ts file");
      expect(result).toContain("index.ts");
      expect(result).not.toContain("read");
      expect(result).not.toContain("the");
      expect(result).not.toContain("file");
    });

    it("filters short tokens", () => {
      const result = extractFileSearchKeywords("a b cd ef");
      expect(result).not.toContain("a");
      expect(result).not.toContain("b");
      expect(result).toContain("cd");
      expect(result).toContain("ef");
    });

    it("filters Chinese stop words", () => {
      const result = extractFileSearchKeywords("读取 这个 文件 config");
      expect(result).not.toContain("读取");
      expect(result).not.toContain("这个");
      expect(result).not.toContain("文件");
      expect(result).toContain("config");
    });
  });

  describe("matchesFileKeywords", () => {
    it("matches file containing keyword", () => {
      expect(matchesFileKeywords("src/index.ts", ["index"])).toBe(true);
    });

    it("returns false for empty keywords", () => {
      expect(matchesFileKeywords("src/index.ts", [])).toBe(false);
    });

    it("returns false when no match", () => {
      expect(matchesFileKeywords("src/index.ts", ["config"])).toBe(false);
    });
  });

  describe("extractFileMentions", () => {
    it("extracts file paths from grep-like output", () => {
      const text = "src/a.ts:10:hello\nsrc/b.ts:20:world";
      const result = extractFileMentions(text);
      expect(result).toContain("src/a.ts");
      expect(result).toContain("src/b.ts");
    });

    it("normalizes backslashes", () => {
      const text = "src\\a.ts:10:hello";
      const result = extractFileMentions(text);
      expect(result).toContain("src/a.ts");
    });

    it("filters non-path lines", () => {
      const text = "hello world\nsrc/a.ts:10:match";
      const result = extractFileMentions(text);
      expect(result).not.toContain("hello world");
      expect(result).toContain("src/a.ts");
    });
  });

  describe("formatFileCandidates", () => {
    it("formats in Chinese", () => {
      const result = formatFileCandidates(["src/a.ts", "src/b.ts"], "zh-CN");
      expect(result).toContain("src/a.ts");
      expect(result).toContain("src/b.ts");
      expect(result).toContain("找到多个可能文件");
    });

    it("formats in English", () => {
      const result = formatFileCandidates(["src/a.ts"], "en-US");
      expect(result).toContain("src/a.ts");
      expect(result).toContain("Multiple files match");
    });
  });

  describe("createSolutionCompletenessStatus", () => {
    it("returns default status", () => {
      const status = createSolutionCompletenessStatus();
      expect(status.triggered).toBe(false);
      expect(status.triggerReason).toBe("none");
      expect(status.classificationRequired).toBe(false);
      expect(status.classification).toBe("unknown");
      expect(status.impactAreas).toEqual([]);
      expect(status.severity).toBe("unknown");
    });
  });

  describe("inferSolutionCompletenessImpactAreas", () => {
    it("detects reference parity from CCB mention", () => {
      const result = inferSolutionCompletenessImpactAreas("对照 ccb 成熟项目", "user_request");
      expect(result).toContain("reference_parity");
      expect(result).toContain("runtime_behavior");
    });

    it("detects permission pipeline from denial trigger", () => {
      const result = inferSolutionCompletenessImpactAreas("some text", "repeated_denial");
      expect(result).toContain("permission_pipeline");
      expect(result).toContain("tool_loop");
    });

    it("detects tui smoke from smoke contamination", () => {
      const result = inferSolutionCompletenessImpactAreas("smoke 污染", "smoke_contamination");
      expect(result).toContain("tui_smoke");
      expect(result).toContain("natural_command_bridge");
    });

    it("detects implementation scope from audit finding", () => {
      const result = inferSolutionCompletenessImpactAreas("文字补丁 regex", "audit_finding");
      expect(result).toContain("implementation_scope");
      expect(result).toContain("verification");
    });

    it("returns empty for unrelated text", () => {
      const result = inferSolutionCompletenessImpactAreas("hello world", "none");
      expect(result).toEqual([]);
    });
  });

  describe("formatSolutionCompletenessTrigger", () => {
    it("formats user_request", () => {
      expect(formatSolutionCompletenessTrigger("user_request")).toContain("成品级");
    });

    it("formats smoke_contamination", () => {
      expect(formatSolutionCompletenessTrigger("smoke_contamination")).toContain("smoke");
    });

    it("formats audit_finding", () => {
      expect(formatSolutionCompletenessTrigger("audit_finding")).toContain("verifier");
    });

    it("formats repeated_denial", () => {
      expect(formatSolutionCompletenessTrigger("repeated_denial")).toContain("权限");
    });

    it("formats none", () => {
      expect(formatSolutionCompletenessTrigger("none")).toContain("未触发");
    });
  });
});
