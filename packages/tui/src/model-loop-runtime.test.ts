import { describe, expect, it } from "vitest";
import {
  type FinalAnswerClaimMatch,
  type SolutionCompletenessStatus,
  buildDowngradedFinalAnswer,
  createFinalAnswerClaimReminder,
  createModelToolDefinitions,
  createModelToolDefinitionsForReportGuard,
  createModelToolDefinitionsForTools,
  createSolutionCompletenessStatus,
  createToolInputSchema,
  createToolUseDriftSummary,
  deriveToolSupportsClaims,
  detectHighRiskClaims,
  evaluateFinalAnswerClaims,
  extractFileMentions,
  extractFileSearchKeywords,
  extractNaturalReadPath,
  extractStructuredFinalAnswerClaims,
  formatFileCandidates,
  formatSolutionCompletenessTrigger,
  hasModelSynthesisIntent,
  inferSolutionCompletenessImpactAreas,
  isEvidenceStaleForClaim,
  isNaturalReadFileRequest,
  looksLikeFilePath,
  matchesFileKeywords,
  normalizeRelativePath,
  readToolInputString,
  stripStructuredFinalAnswerClaims,
} from "./model-loop-runtime.js";
import type { EvidenceRecord } from "./tui-data-types.js";

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

    it("returns ReadSnippets and SourcePack schemas", () => {
      const readSnippets = createToolInputSchema("ReadSnippets") as {
        required: string[];
        properties: Record<string, unknown>;
      };
      const sourcePack = createToolInputSchema("SourcePack") as {
        required: string[];
        properties: Record<string, unknown>;
      };

      expect(readSnippets.required).toContain("ranges");
      expect(readSnippets.properties).toHaveProperty("ranges");
      expect(sourcePack.required).toContain("query");
      expect(sourcePack.properties).toHaveProperty("limit");
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

    it("returns Bash schema with command and explicit validation modes", () => {
      const schema = createToolInputSchema("Bash") as {
        required?: string[];
        properties: Record<string, { type?: string }>;
      };
      expect(schema.required).toEqual(["command"]);
      expect(schema.properties).toHaveProperty("command");
      expect(schema.properties).toHaveProperty("description");
      expect(schema.properties).toHaveProperty("timeoutMs");
      expect(schema.properties).toHaveProperty("run_in_background");
      expect(schema.properties).toHaveProperty("runInBackground");
      expect(schema.properties.command.type).toBe("string");
      expect(schema.properties.description.type).toBe("string");
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

    it("Phase D returns explicit Diff schema with files array and no fallback requirements", () => {
      const schema = createToolInputSchema("Diff") as {
        required?: string[];
        properties: Record<string, unknown>;
      };
      expect(schema.required).toBeUndefined();
      expect(schema.properties).toHaveProperty("files");
    });
  });

  describe("createModelToolDefinitions", () => {
    it("returns definitions for all built-in tools", () => {
      const defs = createModelToolDefinitions();
      expect(defs.length).toBeGreaterThan(0);
      expect(defs.some((d) => d.name === "Read")).toBe(true);
      expect(defs.some((d) => d.name === "ReadSnippets")).toBe(true);
      expect(defs.some((d) => d.name === "SourcePack")).toBe(true);
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
      expect(defs.find((def) => def.name === "Read")?.description).toContain("Use Read");
      expect(defs.find((def) => def.name === "ReadSnippets")?.description).toContain(
        "Use ReadSnippets",
      );
      expect(defs.find((def) => def.name === "SourcePack")?.description).toContain(
        "Use SourcePack",
      );
    });

    it("adds compact source and schema hash metadata to built-in tool definitions", () => {
      const read = createModelToolDefinitions().find((def) => def.name === "Read");
      const bash = createModelToolDefinitions().find((def) => def.name === "Bash");

      expect(read?.source).toBe("built-in");
      expect(bash?.source).toBe("built-in");
      expect(read?.schemaHash).toMatch(/^[0-9a-f]{12}$/);
      expect(bash?.schemaHash).toMatch(/^[0-9a-f]{12}$/);
      expect(read?.schemaHash).not.toBe(bash?.schemaHash);
    });

    it("D.14G: exposes structured Git tools to the model (full-tool mode)", () => {
      const names = createModelToolDefinitions().map((d) => d.name);
      expect(names).toContain("GitStablePointCreate");
      expect(names).toContain("GitStatusInspect");
      expect(names).toContain("GitRollbackExplain");
      expect(names).toContain("ManagedWorktreeCreate");
      expect(names).toContain("ManagedWorktreeRemove");
    });

    it("D.14D-R P0-2: exposes structured index tools to the model (full-tool mode)", () => {
      const names = createModelToolDefinitions().map((d) => d.name);
      expect(names).toContain("IndexStatusInspect");
      expect(names).toContain("IndexRefresh");
      expect(names).toContain("IndexRepair");
      expect(names).toContain("IndexOperation");
    });

    it("exposes real agent workflow verification and report tools before CommandProposal fallback", () => {
      const names = createModelToolDefinitions().map((d) => d.name);
      expect(names).toContain("StartAgent");
      expect(names).toContain("AgentControl");
      expect(names).toContain("RunWorkflow");
      expect(names).toContain("RunVerification");
      expect(names).toContain("WriteReport");
      expect(names.indexOf("StartAgent")).toBeLessThan(names.indexOf("CommandProposal"));
      expect(names.indexOf("AgentControl")).toBeLessThan(names.indexOf("CommandProposal"));
      expect(names.indexOf("RunWorkflow")).toBeLessThan(names.indexOf("CommandProposal"));
    });

    it("documents StartAgent role and worktree cwd requirements in the schema", () => {
      const startAgent = createModelToolDefinitions().find((d) => d.name === "StartAgent");
      const schema = startAgent?.inputSchema as {
        required?: string[];
        properties?: {
          role?: { description?: string };
          subagent_type?: { description?: string };
          cwd?: { description?: string };
          isolation?: { description?: string };
        };
      };

      expect(schema.required).toContain("task");
      expect(schema.properties?.role?.description).toContain("Required unless subagent_type");
      expect(schema.properties?.subagent_type?.description).toContain("Custom agent");
      expect(schema.properties?.cwd?.description).toContain("Do not send");
      expect(schema.properties?.isolation?.description).toContain("omit cwd");
    });

    it("allows AgentControl to stop all running agents through structured actions", () => {
      const agentControl = createModelToolDefinitions().find((d) => d.name === "AgentControl");
      const schema = agentControl?.inputSchema as {
        properties?: { action?: { enum?: string[] } };
      };
      expect(schema.properties?.action?.enum).toEqual(
        expect.arrayContaining(["cancel_all", "stop_all"]),
      );
    });

    it("keeps open object arguments explicit for Responses-compatible control tools", () => {
      const defs = createModelToolDefinitions();
      const executeSchema = defs.find((d) => d.name === "ExecuteExtraTool")?.inputSchema as {
        properties?: { params?: { additionalProperties?: boolean } };
      };
      const workflowSchema = defs.find((d) => d.name === "RunWorkflow")?.inputSchema as {
        properties?: { inputs?: { additionalProperties?: boolean } };
      };

      expect(executeSchema.properties?.params?.additionalProperties).toBe(true);
      expect(workflowSchema.properties?.inputs?.additionalProperties).toBe(true);
    });

    it("describes repository analysis affordance on SearchExtraTools", () => {
      const searchExtraTools = createModelToolDefinitions().find(
        (d) => d.name === "SearchExtraTools",
      );

      expect(searchExtraTools?.description).toContain("pre-engine repository analysis");
      expect(searchExtraTools?.description).toContain("repository code understanding");
      expect(searchExtraTools?.description).toContain("impact analysis");
      expect(searchExtraTools?.description).toContain("edit planning");
      expect(searchExtraTools?.description).toContain("quick verification");
      expect(searchExtraTools?.description).toContain("codebase-memory index is ready");
      expect(searchExtraTools?.description).toContain("index-backed search/graph/architecture");
      expect(searchExtraTools?.description).toContain("pre-engine for AST precision");
    });

    it("exposes pre-engine repository tools as first-class model tools", () => {
      const defs = createModelToolDefinitions();
      const names = defs.map((d) => d.name);
      const preContext = defs.find((d) => d.name === "pre_context");
      const preImpact = defs.find((d) => d.name === "pre_impact");
      const prePlan = defs.find((d) => d.name === "pre_plan");
      const preVerify = defs.find((d) => d.name === "pre_verify");

      expect(names).toContain("pre_context");
      expect(names).toContain("pre_impact");
      expect(names).toContain("pre_plan");
      expect(names).toContain("pre_verify");
      expect(names.indexOf("SearchExtraTools")).toBeLessThan(names.indexOf("Grep"));
      expect(names.indexOf("pre_context")).toBeLessThan(names.indexOf("Grep"));
      expect(names.indexOf("pre_context")).toBeLessThan(names.indexOf("CommandProposal"));
      expect(preContext?.description).toContain("AST-based definition");
      expect(preContext?.description).toContain("answer_pack");
      expect(preContext?.description).toContain("suggested minimal line-window reads");
      expect(preContext?.description).toContain("after index-backed search/graph tools");
      expect(preContext?.description).toContain("index is missing, stale, or insufficient");
      expect(preContext?.description).toContain("use ReadSnippets");
      expect(preContext?.description).toContain("instead of broad Grep/full-file Read");
      expect(preContext?.description).toContain("abstract architecture or impact questions");
      expect(preContext?.description).toContain("anchor symbols");
      expect(preImpact?.description).toContain("impact analysis");
      expect(preImpact?.description).toContain("planned changes");
      expect(preImpact?.description).toContain("call pre_context on anchor symbols first");
      expect(prePlan?.description).toContain("edit planning");
      expect(prePlan?.description).toContain("answer_pack");
      expect(prePlan?.description).toContain("no concrete target symbol");
      expect(prePlan?.description).toContain("prefer pre_context");
      expect(prePlan?.description).toContain("discovery mode");
      expect(preVerify?.description).toContain("verification");
      expect((preContext?.inputSchema as { required?: string[] }).required).toEqual(["symbol"]);
      expect((preImpact?.inputSchema as { required?: string[] }).required).toEqual(["changes"]);
      expect((prePlan?.inputSchema as { required?: string[] }).required).toEqual(["task"]);
      expect((preVerify?.inputSchema as { required?: string[] }).required).toEqual([
        "changed_files",
      ]);
    });

    it("exposes RunWorkflow multi-agent fields explicitly", () => {
      const workflowSchema = createModelToolDefinitions().find((d) => d.name === "RunWorkflow")
        ?.inputSchema as {
        properties?: Record<string, unknown>;
      };

      expect(Object.keys(workflowSchema.properties ?? {})).toEqual(
        expect.arrayContaining([
          "agents",
          "multiAgent",
          "multi_agent",
          "runningCap",
          "running_cap",
          "teamName",
          "team_name",
        ]),
      );
    });

    it("Mature UX Cutback: index tool descriptions match auto-review permission behavior", () => {
      const defs = createModelToolDefinitions();
      const refresh = defs.find((d) => d.name === "IndexRefresh")?.description ?? "";
      const repair = defs.find((d) => d.name === "IndexRepair")?.description ?? "";

      expect(refresh).toContain("default asks for confirmation");
      expect(refresh).toContain("auto-review may directly run an ordinary workspace refresh");
      expect(refresh).toContain("plan refuses mutating execution");
      expect(repair).toContain("default asks before writing");
      expect(repair).toContain("auto-review can proceed");
      expect(repair).toContain("permission pipeline");
      expect(`${refresh}\n${repair}`).not.toContain("default/auto-review modes");
      expect(`${refresh}\n${repair}`).not.toContain("requires user permission confirmation");
      expect(`${refresh}\n${repair}`).not.toContain("Mutating action requiring");
    });
  });

  describe("createModelToolDefinitionsForReportGuard", () => {
    it("returns all tools when guard is undefined", () => {
      const defs = createModelToolDefinitionsForReportGuard(undefined);
      expect(defs.some((d) => d.name === "Bash")).toBe(true);
      const verify = defs.find((d) => d.name === "RunVerification");
      expect(JSON.stringify(verify?.inputSchema)).toContain("plan-only");
      expect(JSON.stringify(verify?.inputSchema)).toContain("real-smoke");
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

    it("keeps normal tools available before evidence is read", () => {
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
      expect(defs.some((d) => d.name === "Read")).toBe(true);
      expect(defs.some((d) => d.name === "Grep")).toBe(true);
      expect(defs.some((d) => d.name === "Glob")).toBe(true);
      expect(defs.some((d) => d.name === "Write")).toBe(true);
      expect(defs.some((d) => d.name === "Edit")).toBe(true);
      expect(defs.some((d) => d.name === "Bash")).toBe(true);
    });

    it("keeps Bash available after evidence is read", () => {
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
      expect(defs.some((d) => d.name === "Bash")).toBe(true);
      expect(defs.some((d) => d.name === "Write")).toBe(true);
    });

    it("keeps normal tools available after non-write rounds", () => {
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
      expect(defs.some((d) => d.name === "Read")).toBe(true);
      expect(defs.some((d) => d.name === "Write")).toBe(true);
      expect(defs.some((d) => d.name === "Bash")).toBe(true);
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
    it("detects Chinese read requests with explicit paths", () => {
      expect(isNaturalReadFileRequest("读取一下 src/a.ts")).toBe(true);
      expect(isNaturalReadFileRequest("看看这个文件")).toBe(false);
    });

    it("detects English read requests with explicit paths", () => {
      expect(isNaturalReadFileRequest("show me the file")).toBe(false);
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

  // ---------------------------------------------------------------------------
  // D.13U — Final Answer Claim Gate evaluator tests
  // ---------------------------------------------------------------------------

  function makeEvidence(partial: Partial<EvidenceRecord>): EvidenceRecord {
    return {
      id: "evid-test",
      kind: "command_output",
      summary: "",
      source: "",
      supportsClaims: [],
      createdAt: new Date().toISOString(),
      ...partial,
    };
  }

  function withClaims(text: string, claims: FinalAnswerClaimMatch[]): string {
    return `${text}\nLinghunFinalAnswerClaims: ${JSON.stringify({ claims })}`;
  }

  describe("D.13U final answer claim extraction", () => {
    it("uses explicit structured claim metadata as the typed path", () => {
      const matches = extractStructuredFinalAnswerClaims(
        '已完成。\nLinghunFinalAnswerClaims: {"claims":[{"kind":"completion_pass","phrase":"测试通过"}]}',
      );
      expect(matches).toEqual([{ kind: "completion_pass", phrase: "测试通过" }]);
    });

    it("does not treat legacy natural-language phrases as structured claims", () => {
      expect(extractStructuredFinalAnswerClaims("已完成，测试通过，PASS。")).toEqual([]);
      expect(detectHighRiskClaims("已完成，测试通过，PASS。")).toEqual([]);
    });

    it("strips structured claim metadata from visible final answer text", () => {
      expect(
        stripStructuredFinalAnswerClaims(
          '已完成。\nLinghunFinalAnswerClaims: {"claims":[{"kind":"completion_pass"}]}',
        ),
      ).toBe("已完成。");
    });

    it("does not flag ordinary chitchat or concept explanation", () => {
      expect(detectHighRiskClaims("可以，我来解释这个概念")).toEqual([]);
      expect(detectHighRiskClaims("你想做哪个方向？我可以帮你列几个选项。")).toEqual([]);
      expect(detectHighRiskClaims("Hello, how can I help?")).toEqual([]);
    });

    it("flags only model-declared structured completion / PASS claims", () => {
      const matches = detectHighRiskClaims(
        withClaims("已完成，测试通过，PASS。", [{ kind: "completion_pass", phrase: "测试通过" }]),
      );
      expect(matches).toEqual([{ kind: "completion_pass", phrase: "测试通过" }]);
    });

    it("flags only model-declared structured external current fact claims", () => {
      const matches = detectHighRiskClaims(
        withClaims("今天 OpenAI 最新模型是 GPT-X，价格 $0.01。", [
          { kind: "external_current_fact", phrase: "今天 OpenAI 最新模型" },
        ]),
      );
      expect(matches).toEqual([{ kind: "external_current_fact", phrase: "今天 OpenAI 最新模型" }]);
    });

    it("does NOT flag local current branch / dir as external_current_fact", () => {
      const matches = detectHighRiskClaims("当前分支是 master，当前目录干净。");
      expect(matches.some((m) => m.kind === "external_current_fact")).toBe(false);
    });

    it("flags only model-declared structured code-fact claims", () => {
      const matches = detectHighRiskClaims(
        withClaims("代码里已经实现 X，调用链是 A→B。", [
          { kind: "code_fact", phrase: "调用链是 A→B" },
        ]),
      );
      expect(matches).toEqual([{ kind: "code_fact", phrase: "调用链是 A→B" }]);
    });

    it("flags only model-declared structured ccb parity / production-ready claims", () => {
      expect(
        detectHighRiskClaims(
          withClaims("现在等于 CCB 了", [{ kind: "ccb_parity", phrase: "等于 CCB" }]),
        ),
      ).toEqual([{ kind: "ccb_parity", phrase: "等于 CCB" }]);
      expect(
        detectHighRiskClaims(
          withClaims("This is production-ready", [
            { kind: "ccb_parity", phrase: "production-ready" },
          ]),
        ),
      ).toEqual([{ kind: "ccb_parity", phrase: "production-ready" }]);
    });

    it("ordinary real-looking claims do not trigger without the structured contract", () => {
      expect(detectHighRiskClaims("我已完成了所有修改，测试通过。")).toEqual([]);
      expect(detectHighRiskClaims("All tests passed, the fix is verified.")).toEqual([]);
      expect(detectHighRiskClaims("索引已刷新。")).toEqual([]);
      expect(detectHighRiskClaims("今天 OpenAI 最新价格是 $0.01。")).toEqual([]);
      expect(detectHighRiskClaims("代码里已经实现 X，调用链是 A→B。")).toEqual([]);
    });

    it("still flags structured real completion claims even when mentioning the system", () => {
      expect(
        detectHighRiskClaims(
          withClaims("反幻觉系统前面触发了吗？另外我已完成了所有修改，测试通过。", [
            { kind: "completion_pass", phrase: "测试通过" },
          ]),
        ).some((m) => m.kind === "completion_pass"),
      ).toBe(true);
      expect(
        detectHighRiskClaims(
          withClaims("反幻觉系统会约束成功声明；索引已刷新。", [
            { kind: "action_executed", phrase: "索引已刷新" },
          ]),
        ),
      ).toEqual([{ kind: "action_executed", phrase: "索引已刷新" }]);
    });
  });

  describe("D.13U evaluateFinalAnswerClaims", () => {
    it("passes when there is no high-risk claim", () => {
      const verdict = evaluateFinalAnswerClaims("可以，我来解释这个概念", []);
      expect(verdict.status).toBe("passed");
    });

    it("passes meta explanation examples without evidence", () => {
      const verdict = evaluateFinalAnswerClaims(
        "反幻觉系统会检测'已完成'、'测试通过'、'代码里已经实现 X'、'索引已刷新'等高风险声明。",
        [],
      );
      expect(verdict.status).toBe("passed");
      expect(verdict.matchedClaims).toEqual([]);
    });

    it("blocks completion/PASS without test/build evidence even if Read evidence exists", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({ kind: "file_read", supportsClaims: ["Read", "local_read"] }),
        makeEvidence({
          kind: "command_output",
          supportsClaims: ["Bash", "command_ran", "bash_exit_0"],
          summary: "Bash: echo hello",
        }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("已完成，测试通过，PASS。", [{ kind: "completion_pass", phrase: "测试通过" }]),
        evidence,
      );
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("completion_pass");
    });

    it("passes test PASS claim when test_passed evidence exists", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "command_output",
          supportsClaims: ["Bash", "command_ran", "bash_exit_0", "test_passed"],
          summary: "Bash: vitest --run all green",
        }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
        evidence,
      );
      expect(verdict.status).toBe("passed");
    });

    it("still blocks broad completion_claim when only verification evidence exists", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "command_output",
          supportsClaims: ["Bash", "command_ran", "bash_exit_0", "test_passed"],
          summary: "Bash: vitest --run all green",
        }),
        makeEvidence({
          kind: "test_result",
          supportsClaims: ["verification_passed"],
          summary: "focused verification passed",
        }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("已完成，验证通过。", [{ kind: "completion_claim", phrase: "已完成" }]),
        evidence,
      );
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("completion_claim");
    });

    it("blocks overall completion when only typecheck PASS evidence exists", () => {
      const verdict = evaluateFinalAnswerClaims(
        withClaims("已完成，PASS，无问题。", [{ kind: "completion_pass", phrase: "已完成" }]),
        [
          makeEvidence({
            kind: "command_output",
            supportsClaims: ["Bash", "command_ran", "bash_exit_0", "typecheck_passed"],
            summary: "Bash: tsc --noEmit exited 0",
          }),
        ],
      );
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("completion_pass");
    });

    it("passes overall completion only with task completion scope validation and remaining risk evidence", () => {
      const verdict = evaluateFinalAnswerClaims(
        withClaims("已完成，测试通过。", [
          { kind: "completion_pass", phrase: "已完成" },
          { kind: "completion_pass", phrase: "测试通过" },
        ]),
        [
          makeEvidence({
            kind: "command_output",
            supportsClaims: [
              "task_completed",
              "scope:packages/tui/src/model-loop-runtime.ts",
              "validation:focused vitest",
              "remaining_risk:none",
            ],
            summary:
              "task_completed scope=claim-check validation=focused vitest remaining_risk=none",
          }),
          makeEvidence({
            kind: "command_output",
            supportsClaims: ["Bash", "command_ran", "bash_exit_0", "test_passed"],
            summary: "Bash: vitest --run model-loop-runtime.test.ts exited 0",
          }),
        ],
      );
      expect(verdict.status).toBe("passed");
    });

    it("does not let typecheck PASS support test PASS claim", () => {
      const verdict = evaluateFinalAnswerClaims(
        withClaims("测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
        [
          makeEvidence({
            kind: "command_output",
            supportsClaims: ["Bash", "command_ran", "bash_exit_0", "typecheck_passed"],
            summary: "Bash: tsc --noEmit exited 0",
          }),
        ],
      );
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("completion_pass");
    });

    it("blocks code-fact claims when no Read/Grep/index evidence", () => {
      const verdict = evaluateFinalAnswerClaims(
        withClaims("代码里已经实现 X，调用链是 A→B。", [
          { kind: "code_fact", phrase: "调用链是 A→B" },
        ]),
        [],
      );
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("code_fact");
    });

    it("passes code-fact claims when Read/Grep evidence exists", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({ kind: "grep_result", supportsClaims: ["Grep", "local_read"] }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("代码里已经实现 X，调用链是 A→B。", [
          { kind: "code_fact", phrase: "调用链是 A→B" },
        ]),
        evidence,
      );
      expect(verdict.status).toBe("passed");
    });

    it("does not let index status/missing/stale records support code facts", () => {
      const verdict = evaluateFinalAnswerClaims(
        withClaims("代码里已经实现 X，调用链是 A→B。", [
          { kind: "code_fact", phrase: "调用链是 A→B" },
        ]),
        [
          makeEvidence({
            kind: "index_query",
            source: "codebase-memory:F-Linghun:status",
            summary: "Index status: stale; project=F-Linghun",
            supportsClaims: ["index_query", "status"],
          }),
        ],
      );
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("code_fact");
    });

    it("allows ready index search evidence with real symbol/path to support code facts", () => {
      const verdict = evaluateFinalAnswerClaims(
        withClaims("代码里已经实现 X，调用链是 A→B。", [
          { kind: "code_fact", phrase: "调用链是 A→B" },
        ]),
        [
          makeEvidence({
            kind: "index_query",
            source: "codebase-memory:F-Linghun:search X",
            summary: "Index search - #1 path packages/tui/src/model-loop-runtime.ts symbol X",
            supportsClaims: ["index_query", "index_code_fact", "search X"],
          }),
        ],
      );
      expect(verdict.status).toBe("passed");
    });

    it("does not let architecture aggregate index evidence support code facts", () => {
      const verdict = evaluateFinalAnswerClaims(
        withClaims("代码里已经实现 X，调用链是 A→B。", [
          { kind: "code_fact", phrase: "调用链是 A→B" },
        ]),
        [
          makeEvidence({
            kind: "index_query",
            source: "codebase-memory:F-Linghun:architecture",
            summary:
              "Index architecture - graph: 3725 nodes, 8068 edges - node labels: Class 100, Function 500",
            supportsClaims: ["index_query", "index_code_fact", "architecture"],
          }),
        ],
      );
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("code_fact");
    });

    it("blocks external current fact when no web_source evidence", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({ kind: "file_read", supportsClaims: ["Read", "local_read"] }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("今天最新价格是 $0.01。", [
          { kind: "external_current_fact", phrase: "今天最新价格" },
        ]),
        evidence,
      );
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("external_current_fact");
    });

    it("passes external current fact when web_source evidence exists", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "web_source",
          supportsClaims: ["web_source"],
          source: "https://openai.com/pricing",
        }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("今天 OpenAI 最新价格是 $0.01。", [
          { kind: "external_current_fact", phrase: "今天 OpenAI 最新价格" },
        ]),
        evidence,
      );
      expect(verdict.status).toBe("passed");
    });

    it("does not require web_source for local 'current branch' query", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "command_output",
          supportsClaims: ["Bash", "command_ran", "bash_exit_0", "git_status", "git_local_fact"],
          summary: "Bash: git status -b",
        }),
      ];
      const verdict = evaluateFinalAnswerClaims("当前分支是 master。", evidence);
      expect(verdict.status).toBe("passed");
    });

    it("blocks beta_readiness claims regardless of unrelated evidence", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({ kind: "file_read", supportsClaims: ["Read", "local_read"] }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("Beta ready 了。", [{ kind: "beta_readiness", phrase: "Beta ready" }]),
        evidence,
      );
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("beta_readiness");
    });

    it("D.14G: git_operation claim needs git_operation evidence", () => {
      // 模型空口声称“已建立稳定点”，没有 git_operation evidence → 拦截。
      const noEvidence = evaluateFinalAnswerClaims(
        withClaims("已建立稳定点，代码已保存。", [
          { kind: "git_operation", phrase: "已建立稳定点" },
        ]),
        [],
      );
      expect(noEvidence.status).toBe("needs_disclaimer");
      expect(noEvidence.unsupportedKinds).toContain("git_operation");

      // 有真实 stable_point_created evidence → 放行。
      const withEvidence = evaluateFinalAnswerClaims(
        withClaims("已建立稳定点。", [{ kind: "git_operation", phrase: "已建立稳定点" }]),
        [
          makeEvidence({
            kind: "command_output",
            source: "git-operation:stable_point_created",
            supportsClaims: ["git_operation", "stable_point_created"],
          }),
        ],
      );
      expect(withEvidence.status).toBe("passed");
    });

    it("D.14G: worktree created/removed claims gated on worktree evidence", () => {
      const created = evaluateFinalAnswerClaims(
        withClaims("已创建 worktree d14b。", [
          { kind: "git_operation", phrase: "已创建 worktree" },
        ]),
        [],
      );
      expect(created.status).toBe("needs_disclaimer");
      expect(created.unsupportedKinds).toContain("git_operation");

      const ok = evaluateFinalAnswerClaims(
        withClaims("已删除 worktree d14b。", [
          { kind: "git_operation", phrase: "已删除 worktree" },
        ]),
        [
          makeEvidence({
            kind: "command_output",
            source: "git-operation:worktree_removed",
            supportsClaims: ["git_operation", "worktree_removed"],
          }),
        ],
      );
      expect(ok.status).toBe("passed");
    });

    it("D.14G: ordinary git discussion does not trigger git_operation gate", () => {
      // 普通讨论“稳定点是什么”不应被当成已执行声明。
      expect(
        detectHighRiskClaims("稳定点是用来回滚的一个安全垫。").some(
          (m) => m.kind === "git_operation",
        ),
      ).toBe(false);
    });

    it("Run 2 Closure: denied or cancelled actions do not support final success claims", () => {
      const denied = evaluateFinalAnswerClaims(
        withClaims("已安装依赖，命令已成功执行。", [
          { kind: "action_executed", phrase: "命令已成功执行" },
        ]),
        [
          makeEvidence({
            kind: "command_output",
            summary: "permission denied; command was not executed",
            supportsClaims: ["tool_failure", "permission_denied"],
          }),
        ],
      );
      expect(denied.status).toBe("needs_disclaimer");
      expect(denied.unsupportedKinds).toContain("action_executed");

      const cancelled = evaluateFinalAnswerClaims(
        withClaims("索引已刷新。", [{ kind: "action_executed", phrase: "索引已刷新" }]),
        [
          makeEvidence({
            kind: "command_output",
            summary: "cancelled by user",
            supportsClaims: ["tool_failure", "user_cancelled"],
          }),
        ],
      );
      expect(cancelled.status).toBe("needs_disclaimer");
      expect(cancelled.unsupportedKinds).toContain("action_executed");

      const ok = evaluateFinalAnswerClaims(
        withClaims("命令已成功执行。", [{ kind: "action_executed", phrase: "命令已成功执行" }]),
        [
          makeEvidence({
            kind: "command_output",
            summary: "Bash: npm install exited 0",
            supportsClaims: ["Bash", "command_ran", "bash_exit_0"],
          }),
        ],
      );
      expect(ok.status).toBe("passed");
    });

    it("Run 2 Closure addendum: successful index evidence supports refresh/rebuild claims", () => {
      const refreshed = evaluateFinalAnswerClaims(
        withClaims("索引已刷新。", [{ kind: "action_executed", phrase: "索引已刷新" }]),
        [
          makeEvidence({
            kind: "command_output",
            summary: "IndexRefresh completed",
            source: "index:refresh",
            supportsClaims: ["index_operation", "index_refresh"],
          }),
        ],
      );
      expect(refreshed.status).toBe("passed");

      const repaired = evaluateFinalAnswerClaims(
        withClaims("索引已重建。", [{ kind: "action_executed", phrase: "索引已重建" }]),
        [
          makeEvidence({
            kind: "command_output",
            summary: "IndexRepair completed",
            source: "index:repair",
            supportsClaims: ["index_operation", "index_repair"],
          }),
        ],
      );
      expect(repaired.status).toBe("passed");

      const initialized = evaluateFinalAnswerClaims(
        withClaims("索引已刷新。", [{ kind: "action_executed", phrase: "索引已刷新" }]),
        [
          makeEvidence({
            kind: "command_output",
            summary: "index_operation init fast: ready",
            source: "index-operation:init fast",
            supportsClaims: ["index_operation", "index_init_fast"],
          }),
        ],
      );
      expect(initialized.status).toBe("passed");
    });

    it("Run 2 Closure addendum: denied or cancelled index evidence still cannot support refresh claims", () => {
      const denied = evaluateFinalAnswerClaims(
        withClaims("索引已刷新。", [{ kind: "action_executed", phrase: "索引已刷新" }]),
        [
          makeEvidence({
            kind: "command_output",
            summary: "permission denied; IndexRefresh was not executed",
            supportsClaims: ["tool_failure", "index_refresh", "permission_denied"],
          }),
        ],
      );
      expect(denied.status).toBe("needs_disclaimer");
      expect(denied.unsupportedKinds).toContain("action_executed");

      const cancelled = evaluateFinalAnswerClaims(
        withClaims("索引已刷新。", [{ kind: "action_executed", phrase: "索引已刷新" }]),
        [
          makeEvidence({
            kind: "command_output",
            summary: "cancelled by user; IndexRefresh was not executed",
            supportsClaims: ["tool_failure", "index_refresh", "user_cancelled"],
          }),
        ],
      );
      expect(cancelled.status).toBe("needs_disclaimer");
      expect(cancelled.unsupportedKinds).toContain("action_executed");
    });

    it("image generated claims require image_result evidence", () => {
      const missing = evaluateFinalAnswerClaims(
        withClaims("image result generated.", [
          { kind: "action_executed", phrase: "image result generated" },
        ]),
        [],
      );
      expect(missing.status).toBe("needs_disclaimer");
      expect(missing.unsupportedKinds).toContain("action_executed");

      const ok = evaluateFinalAnswerClaims(
        withClaims("image result generated.", [
          { kind: "action_executed", phrase: "image result generated" },
        ]),
        [
          makeEvidence({
            kind: "image_result",
            summary: "ImageGenerationResult image-123 saved",
            source: ".linghun/assets/image-123.json",
            supportsClaims: ["image_result", "image generated"],
          }),
        ],
      );
      expect(ok.status).toBe("passed");

      const denied = evaluateFinalAnswerClaims(
        withClaims("生图结果已落盘。", [{ kind: "action_executed", phrase: "生图结果已落盘" }]),
        [
          makeEvidence({
            kind: "command_output",
            summary: "Write failure: permission denied; image metadata was not written",
            supportsClaims: ["tool_failure", "image_result"],
          }),
        ],
      );
      expect(denied.status).toBe("needs_disclaimer");
      expect(denied.unsupportedKinds).toContain("action_executed");
    });

    it("requires terminal agent evidence for agent status claims", () => {
      const running = evaluateFinalAnswerClaims(
        withClaims("Agent 已完成。", [{ kind: "agent_status_claim", phrase: "Agent 已完成" }]),
        [
          makeEvidence({
            kind: "command_output",
            source: "agent-execution",
            summary: "Agent running: background task started",
            supportsClaims: ["agent_execution", "action_executed"],
          }),
        ],
      );
      expect(running.status).toBe("needs_disclaimer");
      expect(running.unsupportedKinds).toContain("agent_status_claim");

      const terminal = evaluateFinalAnswerClaims(
        withClaims("Agent 已完成。", [{ kind: "agent_status_claim", phrase: "Agent 已完成" }]),
        [
          makeEvidence({
            kind: "command_output",
            source: "agent-execution",
            summary: "Agent idle: completed task",
            supportsClaims: ["agent_execution", "action_executed", "agent_terminal_status"],
          }),
        ],
      );
      expect(terminal.status).toBe("passed");
    });

    it("requires terminal workflow evidence for workflow status claims", () => {
      const running = evaluateFinalAnswerClaims(
        withClaims("Workflow 已完成。", [
          { kind: "workflow_status_claim", phrase: "Workflow 已完成" },
        ]),
        [
          makeEvidence({
            kind: "command_output",
            source: "workflow-execution",
            summary: "Workflow started in background",
            supportsClaims: ["workflow_execution", "action_executed"],
          }),
        ],
      );
      expect(running.status).toBe("needs_disclaimer");
      expect(running.unsupportedKinds).toContain("workflow_status_claim");

      const terminal = evaluateFinalAnswerClaims(
        withClaims("Workflow 已完成。", [
          { kind: "workflow_status_claim", phrase: "Workflow 已完成" },
        ]),
        [
          makeEvidence({
            kind: "command_output",
            source: "workflow-execution",
            summary: "Workflow completed",
            supportsClaims: ["workflow_execution", "action_executed", "workflow_terminal_status"],
          }),
        ],
      );
      expect(terminal.status).toBe("passed");
    });
  });

  describe("D.13U deriveToolSupportsClaims", () => {
    it("Read derives local_read + file path", () => {
      const claims = deriveToolSupportsClaims("Read", { file_path: "src/index.ts" }, { text: "" });
      expect(claims).toContain("Read");
      expect(claims).toContain("local_read");
      expect(claims).toContain("file:src/index.ts");
    });

    it("ReadSnippets and SourcePack derive source read claims but no pass evidence", () => {
      const snippets = deriveToolSupportsClaims("ReadSnippets", {}, { text: "" });
      const pack = deriveToolSupportsClaims("SourcePack", { query: "needle" }, { text: "" });

      expect(snippets).toEqual(expect.arrayContaining(["ReadSnippets", "local_read", "source_snippet"]));
      expect(pack).toEqual(expect.arrayContaining(["SourcePack", "local_read", "source_snippet"]));
      expect([...snippets, ...pack]).not.toContain("test_passed");
      expect([...snippets, ...pack]).not.toContain("build_passed");
    });

    it("Bash exit 0 vitest derives test_passed", () => {
      const claims = deriveToolSupportsClaims(
        "Bash",
        { command: "vitest --run" },
        { text: "all good", data: { exitCode: 0 } },
      );
      expect(claims).toContain("test_passed");
      expect(claims).toContain("bash_exit_0");
    });

    it("Bash exit 0 tsc --noEmit derives typecheck_passed", () => {
      const claims = deriveToolSupportsClaims(
        "Bash",
        { command: "tsc --noEmit" },
        { text: "", data: { exitCode: 0 } },
      );
      expect(claims).toContain("typecheck_passed");
    });

    it("Bash exit 0 pnpm build derives build_passed", () => {
      const claims = deriveToolSupportsClaims(
        "Bash",
        { command: "pnpm build" },
        { text: "", data: { exitCode: 0 } },
      );
      expect(claims).toContain("build_passed");
    });

    it("Bash exit 0 git diff --check derives diff_check_passed", () => {
      const claims = deriveToolSupportsClaims(
        "Bash",
        { command: "git diff --check" },
        { text: "", data: { exitCode: 0 } },
      );
      expect(claims).toContain("diff_check_passed");
    });

    it("Bash exit 0 git status derives git_local_fact", () => {
      const claims = deriveToolSupportsClaims(
        "Bash",
        { command: "git status -b" },
        { text: "", data: { exitCode: 0 } },
      );
      expect(claims).toContain("git_local_fact");
      expect(claims).toContain("git_status");
    });

    it("Bash exit nonzero vitest does NOT derive test_passed", () => {
      const claims = deriveToolSupportsClaims(
        "Bash",
        { command: "vitest --run" },
        { text: "fails", data: { exitCode: 1 } },
      );
      expect(claims).not.toContain("test_passed");
      expect(claims).toContain("bash_exit_nonzero");
    });

    it("Bash echo does NOT derive test_passed/build_passed/typecheck_passed", () => {
      const claims = deriveToolSupportsClaims(
        "Bash",
        { command: "echo hello" },
        { text: "hello", data: { exitCode: 0 } },
      );
      expect(claims).not.toContain("test_passed");
      expect(claims).not.toContain("build_passed");
      expect(claims).not.toContain("typecheck_passed");
    });

    it("Write derives file_written + file path", () => {
      const claims = deriveToolSupportsClaims(
        "Write",
        { file_path: "report.md", content: "x" },
        { text: "" },
      );
      expect(claims).toContain("file_written");
      expect(claims).toContain("file:report.md");
    });
  });

  describe("D.13U Final Answer reminder/downgrade text", () => {
    it("createFinalAnswerClaimReminder lists kinds and phrases", () => {
      const verdict = evaluateFinalAnswerClaims(
        withClaims("已完成，测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
        [],
      );
      const text = createFinalAnswerClaimReminder(verdict, "zh-CN");
      expect(text).toContain("高风险声明");
      expect(text).toContain("测试通过");
      expect(text).toContain("缺：");
      expect(text).toContain("仅本轮一次修正机会");
      expect(text).not.toContain("FinalAnswerClaimGate");
      expect(text).not.toContain("EvidenceSummary");
      expect(text).not.toContain("validator");
    });

    it("buildDowngradedFinalAnswer discards the invalid draft and returns a safe boundary answer", () => {
      const verdict = evaluateFinalAnswerClaims(
        withClaims("已完成，测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
        [],
      );
      const downgraded = buildDowngradedFinalAnswer(verdict, "zh-CN");
      expect(downgraded).toContain("当前证据不足");
      expect(downgraded).toContain("缺少证据");
      expect(downgraded).toContain("需要补齐");
      expect(downgraded).not.toContain("被拦截的声明类型");
      expect(downgraded).not.toContain("已完成，测试通过");
      expect(downgraded).not.toContain("[未验证]");
      expect(downgraded).not.toContain("FinalAnswerClaimGate");
      expect(downgraded).not.toContain("evidence_id");
      expect(downgraded).not.toContain("test_passed");
      expect(downgraded).not.toContain("action_executed");
      expect(downgraded).not.toContain("sourceRef");
      expect(downgraded).not.toMatch(/retry|downgrade|kinds|修正版回答如下/iu);
    });

    it("buildDowngradedFinalAnswer English surface hides internal gate fields", () => {
      const verdict = evaluateFinalAnswerClaims(
        withClaims("Done, tests passed.", [{ kind: "completion_pass", phrase: "tests passed" }]),
        [],
      );
      const downgraded = buildDowngradedFinalAnswer(verdict, "en-US");
      expect(downgraded).toContain("I cannot provide a verified final claim");
      expect(downgraded).toContain("Missing evidence");
      expect(downgraded).toContain("Evidence needed");
      expect(downgraded).not.toContain("Blocked claim types");
      expect(downgraded).not.toContain("Done, tests passed");
      expect(downgraded).not.toContain("[unverified]");
      expect(downgraded).not.toContain("test_passed");
      expect(downgraded).not.toContain("action_executed");
      expect(downgraded).not.toContain("sourceRef");
      expect(downgraded).not.toMatch(/retry|downgrade|kinds|corrected answer/iu);
    });
  });

  describe("D.13V-A evaluateFinalAnswerClaims staleness", () => {
    const NOW = new Date("2026-05-30T12:00:00Z");
    const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000).toISOString();
    const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();

    it("fresh test_passed evidence still allows test PASS (baseline)", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "command_output",
          supportsClaims: ["Bash", "command_ran", "bash_exit_0", "test_passed"],
          summary: "Bash: vitest --run",
          createdAt: minutesAgo(10),
        }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
        evidence,
        NOW,
      );
      expect(verdict.status).toBe("passed");
    });

    it("stale test_passed evidence (>30min) blocks test PASS", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "command_output",
          supportsClaims: ["Bash", "command_ran", "bash_exit_0", "test_passed"],
          summary: "Bash: vitest --run",
          createdAt: minutesAgo(45),
        }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
        evidence,
        NOW,
      );
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("completion_pass");
      expect(verdict.staleKinds ?? []).toContain("completion_pass");
    });

    it("fresh Read evidence still allows code_fact (baseline)", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "file_read",
          supportsClaims: ["Read", "local_read"],
          createdAt: minutesAgo(20),
        }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("代码里已经实现 X，调用链是 A→B。", [
          { kind: "code_fact", phrase: "调用链是 A→B" },
        ]),
        evidence,
        NOW,
      );
      expect(verdict.status).toBe("passed");
    });

    it("stale Read evidence (>60min) blocks code_fact", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "file_read",
          supportsClaims: ["Read", "local_read"],
          createdAt: minutesAgo(90),
        }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("代码里已经实现 X，调用链是 A→B。", [
          { kind: "code_fact", phrase: "调用链是 A→B" },
        ]),
        evidence,
        NOW,
      );
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("code_fact");
      expect(verdict.staleKinds ?? []).toContain("code_fact");
    });

    it("fresh web_source evidence still allows external_current_fact (baseline)", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "web_source",
          supportsClaims: ["web_source"],
          source: "https://openai.com/pricing",
          createdAt: hoursAgo(2),
        }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("今天 OpenAI 最新价格是 $0.01。", [
          { kind: "external_current_fact", phrase: "今天 OpenAI 最新价格" },
        ]),
        evidence,
        NOW,
      );
      expect(verdict.status).toBe("passed");
    });

    it("stale web_source (>24h) blocks external_current_fact", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "web_source",
          supportsClaims: ["web_source"],
          source: "https://openai.com/pricing",
          createdAt: hoursAgo(48),
        }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("今天 OpenAI 最新价格是 $0.01。", [
          { kind: "external_current_fact", phrase: "今天 OpenAI 最新价格" },
        ]),
        evidence,
        NOW,
      );
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("external_current_fact");
      expect(verdict.staleKinds ?? []).toContain("external_current_fact");
    });

    it("ccb_parity is not affected by staleness threshold", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "file_read",
          supportsClaims: ["Read", "local_read"],
          source: "F:/reference-parity/packages/cli/index.ts",
          summary: "Read reference_parity file for parity check",
          createdAt: hoursAgo(72),
        }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("现在等于 CCB 了", [{ kind: "ccb_parity", phrase: "等于 CCB" }]),
        evidence,
        NOW,
      );
      expect(verdict.status).toBe("passed");
    });

    it("local 'current branch' query passes even when all evidence is stale", () => {
      // 没有结构化 LinghunFinalAnswerClaims 的本地状态描述不进入 final-claim gate。
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "command_output",
          supportsClaims: ["Bash", "command_ran", "bash_exit_0", "git_status", "git_local_fact"],
          summary: "Bash: git status -b",
          createdAt: hoursAgo(48),
        }),
      ];
      const verdict = evaluateFinalAnswerClaims("当前分支是 master。", evidence, NOW);
      expect(verdict.status).toBe("passed");
    });

    it("mixed fresh + stale evidence: fresh still satisfies the claim", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          id: "e-stale",
          kind: "command_output",
          supportsClaims: ["Bash", "command_ran", "bash_exit_0", "test_passed"],
          summary: "Bash: old vitest",
          createdAt: minutesAgo(120),
        }),
        makeEvidence({
          id: "e-fresh",
          kind: "command_output",
          supportsClaims: ["Bash", "command_ran", "bash_exit_0", "test_passed"],
          summary: "Bash: recent vitest",
          createdAt: minutesAgo(5),
        }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
        evidence,
        NOW,
      );
      expect(verdict.status).toBe("passed");
    });

    it("staleKinds is omitted when no matching evidence existed at all", () => {
      const verdict = evaluateFinalAnswerClaims(
        withClaims("已完成，测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
        [],
        NOW,
      );
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("completion_pass");
      expect(verdict.staleKinds ?? []).not.toContain("completion_pass");
    });

    it("isEvidenceStaleForClaim respects per-kind thresholds and ccb_parity exemption", () => {
      const completionEv = makeEvidence({
        kind: "command_output",
        supportsClaims: ["test_passed"],
        createdAt: minutesAgo(45),
      });
      const codeEv = makeEvidence({
        kind: "file_read",
        supportsClaims: ["local_read"],
        createdAt: minutesAgo(45),
      });
      const externalEv = makeEvidence({
        kind: "web_source",
        supportsClaims: ["web_source"],
        createdAt: hoursAgo(48),
      });
      expect(isEvidenceStaleForClaim(completionEv, "completion_pass", NOW)).toBe(true);
      // 同一条 45min 老的证据，对 code_fact（60min 阈值）尚不算 stale。
      expect(isEvidenceStaleForClaim(codeEv, "code_fact", NOW)).toBe(false);
      expect(isEvidenceStaleForClaim(externalEv, "external_current_fact", NOW)).toBe(true);
      // ccb_parity 不应用 staleness 阈值，永远返回 false。
      expect(isEvidenceStaleForClaim(externalEv, "ccb_parity", NOW)).toBe(false);
    });

    it("reminder mentions stale evidence when applicable", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "command_output",
          supportsClaims: ["test_passed"],
          createdAt: minutesAgo(120),
        }),
      ];
      const verdict = evaluateFinalAnswerClaims(
        withClaims("已完成，测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
        evidence,
        NOW,
      );
      const text = createFinalAnswerClaimReminder(verdict, "zh-CN");
      expect(text).toContain("已过期");
    });
  });

  describe("D.13U FreshnessLite is not restored", () => {
    it("source has no FreshnessLite function definitions or call sites", async () => {
      const fs = await import("node:fs/promises");
      const { dirname, join } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const here = dirname(fileURLToPath(import.meta.url));
      const src = await fs.readFile(join(here, "model-loop-runtime.ts"), "utf8");
      // 注释/comment 中的字面量允许（D.13Q-UX 的删除说明），但不允许实际定义或调用。
      expect(src).not.toMatch(/export function needsFreshnessLiteBoundary/);
      expect(src).not.toMatch(/function formatFreshnessLitePrimaryWarning/);
      expect(src).not.toMatch(/needsFreshnessLiteBoundary\s*\(/);
      expect(src).not.toMatch(/formatFreshnessLitePrimaryWarning\s*\(/);
    });
  });

  describe("D.13V-B Architecture / Completeness final answer gates", () => {
    it("普通文本不触发", async () => {
      const { evaluateArchitectureAndCompletenessClaims } = await import("./model-loop-runtime.js");
      const v = evaluateArchitectureAndCompletenessClaims(
        "你好，今天我们继续修一些 bug。",
        { hasActiveCard: false },
        { classificationRequired: false, classification: "unknown", textHasClassification: false },
      );
      expect(v.status).toBe("passed");
      expect(v.matchedClaims).toHaveLength(0);
    });

    it("结构化声称符合架构边界但无 active card → needs_disclaimer", async () => {
      const { evaluateArchitectureAndCompletenessClaims } = await import("./model-loop-runtime.js");
      const v = evaluateArchitectureAndCompletenessClaims(
        withClaims("本次改动符合架构边界，没有架构漂移。", [
          { kind: "architecture_boundary", phrase: "符合架构边界" },
        ]),
        { hasActiveCard: false },
        { classificationRequired: false, classification: "unknown", textHasClassification: false },
      );
      expect(v.status).toBe("needs_disclaimer");
      expect(v.unsupportedKinds).toContain("architecture_boundary");
    });

    it("结构化声称架构闭合 + 有 card 但 driftWarnings 非空 → needs_disclaimer", async () => {
      const { evaluateArchitectureAndCompletenessClaims } = await import("./model-loop-runtime.js");
      const v = evaluateArchitectureAndCompletenessClaims(
        withClaims("架构已闭合。", [{ kind: "architecture_boundary", phrase: "架构已闭合" }]),
        {
          hasActiveCard: true,
          driftWarnings: ["Architecture drift: scope expanded (foo.ts)."],
          hasArchitectureEvidence: true,
        },
        { classificationRequired: false, classification: "unknown", textHasClassification: false },
      );
      expect(v.status).toBe("needs_disclaimer");
      expect(v.unsupportedKinds).toContain("architecture_boundary");
    });

    it("结构化声称架构闭合 + card + 无 drift + 有 evidence → passed", async () => {
      const { evaluateArchitectureAndCompletenessClaims } = await import("./model-loop-runtime.js");
      const v = evaluateArchitectureAndCompletenessClaims(
        withClaims("架构已闭合。", [{ kind: "architecture_boundary", phrase: "架构已闭合" }]),
        {
          hasActiveCard: true,
          driftWarnings: [],
          hasArchitectureEvidence: true,
        },
        { classificationRequired: false, classification: "unknown", textHasClassification: false },
      );
      expect(v.status).toBe("passed");
    });

    it("英文裸文本 'no architecture drift' 不再靠短语命中", async () => {
      const { evaluateArchitectureAndCompletenessClaims } = await import("./model-loop-runtime.js");
      const v = evaluateArchitectureAndCompletenessClaims(
        "There is no architecture drift in this change.",
        { hasActiveCard: false },
        { classificationRequired: false, classification: "unknown", textHasClassification: false },
      );
      expect(v.status).toBe("passed");
      expect(v.matchedClaims).toHaveLength(0);
    });

    it("结构化声称没有遗漏 + classificationRequired + 未给分类 → needs_disclaimer", async () => {
      const { evaluateArchitectureAndCompletenessClaims } = await import("./model-loop-runtime.js");
      const v = evaluateArchitectureAndCompletenessClaims(
        withClaims("所有任务完整完成，没有遗漏。", [{ kind: "completeness", phrase: "没有遗漏" }]),
        { hasActiveCard: false },
        {
          classificationRequired: true,
          classification: "unknown",
          textHasClassification: false,
        },
      );
      expect(v.status).toBe("needs_disclaimer");
      expect(v.unsupportedKinds).toContain("completeness");
    });

    it("结构化声称没有遗漏 + 已给 classification + textHasClassification → passed", async () => {
      const { evaluateArchitectureAndCompletenessClaims } = await import("./model-loop-runtime.js");
      const v = evaluateArchitectureAndCompletenessClaims(
        withClaims("本次属于 single_issue，没有遗漏。", [
          { kind: "completeness", phrase: "没有遗漏" },
        ]),
        { hasActiveCard: false },
        {
          classificationRequired: true,
          classification: "single_issue",
          textHasClassification: true,
        },
      );
      expect(v.status).toBe("passed");
    });

    it("finalAnswerHasCompletenessClassification 识别 single_issue / systemic_gap", async () => {
      const { finalAnswerHasCompletenessClassification } = await import("./model-loop-runtime.js");
      expect(finalAnswerHasCompletenessClassification("属于 single_issue")).toBe(true);
      expect(finalAnswerHasCompletenessClassification("It is a systemic_gap")).toBe(true);
      expect(finalAnswerHasCompletenessClassification("已修复")).toBe(false);
    });

    it("hasArchitectureEvidenceForClaims 识别 architecture_boundary_check 与 architecture-* file_read", async () => {
      const { hasArchitectureEvidenceForClaims } = await import("./model-loop-runtime.js");
      expect(
        hasArchitectureEvidenceForClaims([{ supportsClaims: ["architecture_boundary_check"] }]),
      ).toBe(true);
      expect(
        hasArchitectureEvidenceForClaims([
          {
            supportsClaims: ["local_read"],
            kind: "file_read",
            source: "packages/tui/src/architecture-runtime.ts",
          },
        ]),
      ).toBe(true);
      expect(
        hasArchitectureEvidenceForClaims([
          { supportsClaims: ["local_read"], kind: "file_read", source: "src/index.ts" },
        ]),
      ).toBe(false);
    });

    it("createExtendedFinalAnswerReminder 含 phrase + 缺失类型，且不泄漏 internal validator id", async () => {
      const { createExtendedFinalAnswerReminder } = await import("./model-loop-runtime.js");
      const reminder = createExtendedFinalAnswerReminder(
        {
          status: "needs_disclaimer",
          matchedClaims: [{ kind: "architecture_boundary", phrase: "符合架构边界" }],
          unsupportedKinds: ["architecture_boundary"],
          missingEvidenceKinds: ["Architecture Card 与 drift check"],
        },
        "zh-CN",
      );
      expect(reminder).toContain("符合架构边界");
      expect(reminder).toContain("Architecture Card 与 drift check");
      expect(reminder).not.toContain("FinalAnswerClaimGate");
      expect(reminder).not.toContain("evaluateArchitectureAndCompletenessClaims");
    });

    it("buildExtendedDowngradedFinalAnswer 丢弃原草稿并返回安全边界答案", async () => {
      const { buildExtendedDowngradedFinalAnswer } = await import("./model-loop-runtime.js");
      const out = buildExtendedDowngradedFinalAnswer(
        {
          status: "needs_disclaimer",
          matchedClaims: [
            { kind: "architecture_boundary", phrase: "符合架构边界" },
            { kind: "architecture_boundary", phrase: "没有架构漂移" },
          ],
          unsupportedKinds: ["architecture_boundary"],
          missingEvidenceKinds: ["Architecture Card 与 drift check"],
        },
        "zh-CN",
      );
      expect(out).toContain("当前证据不足");
      expect(out).toContain("缺少支撑");
      expect(out).toContain("需要补齐");
      expect(out).not.toContain("被拦截的声明类型");
      expect(out).not.toContain("符合架构边界");
      expect(out).not.toContain("没有架构漂移");
      expect(out).not.toContain("[未验证]");
      expect(out).not.toMatch(/retry|downgrade|kinds|sourceRef|修正版回答如下/iu);
    });
  });

  describe("D.13V-C RuntimeStatus prompt projection", () => {
    it("剔除 provider，保留 model.name 与 index/cache/permissionMode", async () => {
      const { projectRuntimeStatusForPrompt } = await import("./model-loop-runtime.js");
      const projected = projectRuntimeStatusForPrompt({
        memory: { linghunMd: "found", candidates: 0, accepted: 1, autoAccept: false },
        index: { status: "ready", changedFiles: 0 },
        cache: { latestHitRate: 0.42, changedKeys: ["a", "b"] },
        model: { provider: "openai-compatible", name: "claude-opus-4-7" },
        permissionMode: "default",
        extensions: {
          skills: { enabled: true, count: 3 },
          plugins: { enabled: false, count: 0 },
          hooks: { enabled: false, count: 0 },
        },
      });
      expect(projected).not.toBeNull();
      expect(projected?.model).toEqual({ name: "claude-opus-4-7" });
      expect(JSON.stringify(projected)).not.toContain("provider");
      expect(JSON.stringify(projected)).not.toContain("openai-compatible");
      expect(projected?.index.status).toBe("ready");
      expect(projected?.cache.latestHitRate).toBe(0.42);
      expect(projected?.permissionMode).toBe("default");
    });

    it("缺失字段降级为 unknown / default，但不抛异常", async () => {
      const { projectRuntimeStatusForPrompt } = await import("./model-loop-runtime.js");
      const projected = projectRuntimeStatusForPrompt({});
      expect(projected?.model.name).toBe("unknown");
      expect(projected?.permissionMode).toBe("default");
      expect(projected?.index.status).toBe("unknown");
    });

    it("完全非法输入返回 null", async () => {
      const { projectRuntimeStatusForPrompt } = await import("./model-loop-runtime.js");
      expect(projectRuntimeStatusForPrompt(undefined)).toBeNull();
      expect(projectRuntimeStatusForPrompt(null)).toBeNull();
      expect(projectRuntimeStatusForPrompt(42)).toBeNull();
    });
  });

  describe("D.13V-C deferred tool primary text 降噪", () => {
    it("SearchExtraTools 成功 → 主屏只显示数量，不含字面工具名", async () => {
      const { sanitizeDeferredToolPrimaryText } = await import("./model-loop-runtime.js");
      const out = sanitizeDeferredToolPrimaryText(
        'SearchExtraTools matched 3/12 deferred tools (query="").',
        "zh-CN",
        { dispatchKind: "SearchExtraTools", ok: true, matchedCount: 3 },
      );
      expect(out).not.toContain("SearchExtraTools");
      expect(out).not.toContain("ExecuteExtraTool");
      expect(out).not.toContain("dispatcher");
      expect(out).toContain("3");
      expect(out).toContain("扩展工具");
    });

    it("ExecuteExtraTool 成功 → 主屏显示目标名但不显示内部 wrapper", async () => {
      const { sanitizeDeferredToolPrimaryText } = await import("./model-loop-runtime.js");
      const out = sanitizeDeferredToolPrimaryText(
        "ExecuteExtraTool(codebase-memory:search_code) 完成。",
        "zh-CN",
        { dispatchKind: "ExecuteExtraTool", ok: true },
      );
      expect(out).not.toContain("ExecuteExtraTool");
      expect(out).not.toContain("codebase-memory:search_code");
      expect(out).toContain("search_code");
      expect(out).toContain("扩展工具");
      expect(out).toContain("完成");
    });

    it("ExecuteExtraTool 失败 → 主屏含 reason 但去掉内部 token", async () => {
      const { sanitizeDeferredToolPrimaryText } = await import("./model-loop-runtime.js");
      const out = sanitizeDeferredToolPrimaryText(
        "ExecuteExtraTool: 工具 mcp:foo:bar 没有可用的安全执行适配器。",
        "zh-CN",
        { dispatchKind: "ExecuteExtraTool", ok: false },
      );
      expect(out).not.toContain("ExecuteExtraTool");
      expect(out).not.toContain("dispatcher");
      expect(out).not.toContain("executeDeferredDispatchToolUse");
      expect(out).toContain("失败");
      expect(out).toContain("没有可用的安全执行适配器");
    });

    it("英文也产出本地化文案", async () => {
      const { sanitizeDeferredToolPrimaryText } = await import("./model-loop-runtime.js");
      const out = sanitizeDeferredToolPrimaryText(
        'SearchExtraTools matched 0/0 deferred tools (query="").',
        "en-US",
        { dispatchKind: "SearchExtraTools", ok: true, matchedCount: 0 },
      );
      expect(out).not.toContain("SearchExtraTools");
      expect(out).toContain("Found 0");
      expect(out.toLowerCase()).toContain("extension tool");
    });
  });
});
