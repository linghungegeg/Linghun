import { describe, expect, it } from "vitest";
import {
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

    it("D.14G: exposes structured Git tools to the model (full-tool mode)", () => {
      const names = createModelToolDefinitions().map((d) => d.name);
      expect(names).toContain("GitStablePointCreate");
      expect(names).toContain("GitStatusInspect");
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
      expect(names).toContain("RunWorkflow");
      expect(names).toContain("RunVerification");
      expect(names).toContain("WriteReport");
      expect(names.indexOf("StartAgent")).toBeLessThan(names.indexOf("CommandProposal"));
      expect(names.indexOf("RunWorkflow")).toBeLessThan(names.indexOf("CommandProposal"));
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

  describe("D.13U detectHighRiskClaims", () => {
    it("does not flag ordinary chitchat or concept explanation", () => {
      expect(detectHighRiskClaims("可以，我来解释这个概念")).toEqual([]);
      expect(detectHighRiskClaims("你想做哪个方向？我可以帮你列几个选项。")).toEqual([]);
      expect(detectHighRiskClaims("Hello, how can I help?")).toEqual([]);
    });

    it("flags completion / PASS phrases", () => {
      const matches = detectHighRiskClaims("已完成，测试通过，PASS。");
      expect(matches.some((m) => m.kind === "completion_pass")).toBe(true);
    });

    it("flags external current fact phrases (today / latest)", () => {
      const matches = detectHighRiskClaims("今天 OpenAI 最新模型是 GPT-X，价格 $0.01。");
      expect(matches.some((m) => m.kind === "external_current_fact")).toBe(true);
    });

    it("does NOT flag local current branch / dir as external_current_fact", () => {
      const matches = detectHighRiskClaims("当前分支是 master，当前目录干净。");
      expect(matches.some((m) => m.kind === "external_current_fact")).toBe(false);
    });

    it("flags code-fact phrases", () => {
      const matches = detectHighRiskClaims("代码里已经实现 X，调用链是 A→B。");
      expect(matches.some((m) => m.kind === "code_fact")).toBe(true);
    });

    it("flags ccb parity / production-ready", () => {
      expect(detectHighRiskClaims("现在等于 CCB 了").some((m) => m.kind === "ccb_parity")).toBe(
        true,
      );
      expect(
        detectHighRiskClaims("This is production-ready").some((m) => m.kind === "ccb_parity"),
      ).toBe(true);
    });

    it("does NOT flag meta discussion about the anti-hallucination system", () => {
      expect(
        detectHighRiskClaims(
          "反幻觉系统会检测'已完成'、'测试通过'、'已验证'等高风险声明，如果缺少证据就会触发降级。",
        ).some((m) => m.kind === "completion_pass"),
      ).toBe(false);
      expect(
        detectHighRiskClaims(
          "是的，反幻觉系统在约束我，不让我说'已完成'或'测试通过'这类话，除非有证据支撑。",
        ).some((m) => m.kind === "completion_pass"),
      ).toBe(false);
      expect(
        detectHighRiskClaims(
          "反幻觉系统会识别'代码里已经实现 X'、'调用链是 A→B'这类源码事实声明。",
        ).some((m) => m.kind === "code_fact"),
      ).toBe(false);
      expect(
        detectHighRiskClaims(
          "The final answer gate detects phrases like 'completed', 'tests passed', 'verified' and requires evidence.",
        ).some((m) => m.kind === "completion_pass"),
      ).toBe(false);
      expect(
        detectHighRiskClaims("不能说'索引已刷新'，除非本轮有真实刷新证据。").some(
          (m) => m.kind === "action_executed",
        ),
      ).toBe(false);
      expect(
        detectHighRiskClaims(
          "反幻觉系统会检测'已写入文件、索引已刷新、命令已执行'这类动作声明。",
        ).some((m) => m.kind === "action_executed"),
      ).toBe(false);
    });

    it("still flags real completion claims even when mentioning the system", () => {
      expect(
        detectHighRiskClaims("我已完成了所有修改，测试通过。").some(
          (m) => m.kind === "completion_pass",
        ),
      ).toBe(true);
      expect(
        detectHighRiskClaims("All tests passed, the fix is verified.").some(
          (m) => m.kind === "completion_pass",
        ),
      ).toBe(true);
      expect(
        detectHighRiskClaims("反幻觉系统前面触发了吗？另外我已完成了所有修改，测试通过。").some(
          (m) => m.kind === "completion_pass",
        ),
      ).toBe(true);
      expect(
        detectHighRiskClaims("反幻觉系统会约束成功声明；索引已刷新。").some(
          (m) => m.kind === "action_executed",
        ),
      ).toBe(true);
      expect(detectHighRiskClaims("索引已刷新。").some((m) => m.kind === "action_executed")).toBe(
        true,
      );
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
      const verdict = evaluateFinalAnswerClaims("已完成，测试通过，PASS。", evidence);
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("completion_pass");
    });

    it("passes completion/PASS when test_passed evidence exists", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "command_output",
          supportsClaims: ["Bash", "command_ran", "bash_exit_0", "test_passed"],
          summary: "Bash: vitest --run all green",
        }),
      ];
      const verdict = evaluateFinalAnswerClaims("已完成，测试通过。", evidence);
      expect(verdict.status).toBe("passed");
    });

    it("blocks code-fact claims when no Read/Grep/index evidence", () => {
      const verdict = evaluateFinalAnswerClaims("代码里已经实现 X，调用链是 A→B。", []);
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("code_fact");
    });

    it("passes code-fact claims when Read/Grep evidence exists", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({ kind: "grep_result", supportsClaims: ["Grep", "local_read"] }),
      ];
      const verdict = evaluateFinalAnswerClaims("代码里已经实现 X，调用链是 A→B。", evidence);
      expect(verdict.status).toBe("passed");
    });

    it("blocks external current fact when no web_source evidence", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({ kind: "file_read", supportsClaims: ["Read", "local_read"] }),
      ];
      const verdict = evaluateFinalAnswerClaims("今天最新价格是 $0.01。", evidence);
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
      const verdict = evaluateFinalAnswerClaims("今天 OpenAI 最新价格是 $0.01。", evidence);
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
      const verdict = evaluateFinalAnswerClaims("Beta ready 了。", evidence);
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("beta_readiness");
    });

    it("D.14G: git_operation claim needs git_operation evidence", () => {
      // 模型空口声称“已建立稳定点”，没有 git_operation evidence → 拦截。
      const noEvidence = evaluateFinalAnswerClaims("已建立稳定点，代码已保存。", []);
      expect(noEvidence.status).toBe("needs_disclaimer");
      expect(noEvidence.unsupportedKinds).toContain("git_operation");

      // 有真实 stable_point_created evidence → 放行。
      const withEvidence = evaluateFinalAnswerClaims("已建立稳定点。", [
        makeEvidence({
          kind: "command_output",
          source: "git-operation:stable_point_created",
          supportsClaims: ["git_operation", "stable_point_created"],
        }),
      ]);
      expect(withEvidence.status).toBe("passed");
    });

    it("D.14G: worktree created/removed claims gated on worktree evidence", () => {
      const created = evaluateFinalAnswerClaims("已创建 worktree d14b。", []);
      expect(created.status).toBe("needs_disclaimer");
      expect(created.unsupportedKinds).toContain("git_operation");

      const ok = evaluateFinalAnswerClaims("已删除 worktree d14b。", [
        makeEvidence({
          kind: "command_output",
          source: "git-operation:worktree_removed",
          supportsClaims: ["git_operation", "worktree_removed"],
        }),
      ]);
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
      const denied = evaluateFinalAnswerClaims("已安装依赖，命令已成功执行。", [
        makeEvidence({
          kind: "command_output",
          summary: "permission denied; command was not executed",
          supportsClaims: ["tool_failure", "permission_denied"],
        }),
      ]);
      expect(denied.status).toBe("needs_disclaimer");
      expect(denied.unsupportedKinds).toContain("action_executed");

      const cancelled = evaluateFinalAnswerClaims("索引已刷新。", [
        makeEvidence({
          kind: "command_output",
          summary: "cancelled by user",
          supportsClaims: ["tool_failure", "user_cancelled"],
        }),
      ]);
      expect(cancelled.status).toBe("needs_disclaimer");
      expect(cancelled.unsupportedKinds).toContain("action_executed");

      const ok = evaluateFinalAnswerClaims("命令已成功执行。", [
        makeEvidence({
          kind: "command_output",
          summary: "Bash: npm install exited 0",
          supportsClaims: ["Bash", "command_ran", "bash_exit_0"],
        }),
      ]);
      expect(ok.status).toBe("passed");
    });

    it("Run 2 Closure addendum: successful index evidence supports refresh/rebuild claims", () => {
      const refreshed = evaluateFinalAnswerClaims("索引已刷新。", [
        makeEvidence({
          kind: "command_output",
          summary: "IndexRefresh completed",
          source: "index:refresh",
          supportsClaims: ["index_operation", "index_refresh"],
        }),
      ]);
      expect(refreshed.status).toBe("passed");

      const repaired = evaluateFinalAnswerClaims("索引已重建。", [
        makeEvidence({
          kind: "command_output",
          summary: "IndexRepair completed",
          source: "index:repair",
          supportsClaims: ["index_operation", "index_repair"],
        }),
      ]);
      expect(repaired.status).toBe("passed");

      const initialized = evaluateFinalAnswerClaims("索引已刷新。", [
        makeEvidence({
          kind: "command_output",
          summary: "index_operation init fast: ready",
          source: "index-operation:init fast",
          supportsClaims: ["index_operation", "index_init_fast"],
        }),
      ]);
      expect(initialized.status).toBe("passed");
    });

    it("Run 2 Closure addendum: denied or cancelled index evidence still cannot support refresh claims", () => {
      const denied = evaluateFinalAnswerClaims("索引已刷新。", [
        makeEvidence({
          kind: "command_output",
          summary: "permission denied; IndexRefresh was not executed",
          supportsClaims: ["tool_failure", "index_refresh", "permission_denied"],
        }),
      ]);
      expect(denied.status).toBe("needs_disclaimer");
      expect(denied.unsupportedKinds).toContain("action_executed");

      const cancelled = evaluateFinalAnswerClaims("索引已刷新。", [
        makeEvidence({
          kind: "command_output",
          summary: "cancelled by user; IndexRefresh was not executed",
          supportsClaims: ["tool_failure", "index_refresh", "user_cancelled"],
        }),
      ]);
      expect(cancelled.status).toBe("needs_disclaimer");
      expect(cancelled.unsupportedKinds).toContain("action_executed");
    });

    it("image generated claims require image_result evidence", () => {
      const missing = evaluateFinalAnswerClaims("image result generated.", []);
      expect(missing.status).toBe("needs_disclaimer");
      expect(missing.unsupportedKinds).toContain("action_executed");

      const ok = evaluateFinalAnswerClaims("image result generated.", [
        makeEvidence({
          kind: "image_result",
          summary: "ImageGenerationResult image-123 saved",
          source: ".linghun/assets/image-123.json",
          supportsClaims: ["image_result", "image generated"],
        }),
      ]);
      expect(ok.status).toBe("passed");

      const denied = evaluateFinalAnswerClaims("生图结果已落盘。", [
        makeEvidence({
          kind: "command_output",
          summary: "Write failure: permission denied; image metadata was not written",
          supportsClaims: ["tool_failure", "image_result"],
        }),
      ]);
      expect(denied.status).toBe("needs_disclaimer");
      expect(denied.unsupportedKinds).toContain("action_executed");
    });
  });

  describe("D.13U deriveToolSupportsClaims", () => {
    it("Read derives local_read + file path", () => {
      const claims = deriveToolSupportsClaims("Read", { file_path: "src/index.ts" }, { text: "" });
      expect(claims).toContain("Read");
      expect(claims).toContain("local_read");
      expect(claims).toContain("file:src/index.ts");
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
      const verdict = evaluateFinalAnswerClaims("已完成，测试通过。", []);
      const text = createFinalAnswerClaimReminder(verdict, "zh-CN");
      expect(text).toContain("高风险声明");
      expect(text).toContain("已完成");
      expect(text).toContain("缺：");
      expect(text).toContain("仅本轮一次修正机会");
      expect(text).not.toContain("FinalAnswerClaimGate");
      expect(text).not.toContain("EvidenceSummary");
      expect(text).not.toContain("validator");
    });

    it("buildDowngradedFinalAnswer replaces claim phrases with [未验证] and appends notice", () => {
      const verdict = evaluateFinalAnswerClaims("已完成，测试通过。", []);
      const downgraded = buildDowngradedFinalAnswer("已完成，测试通过。", verdict, "zh-CN");
      expect(downgraded).toContain("[未验证]");
      expect(downgraded).toContain("缺少匹配证据");
      expect(downgraded).not.toContain("FinalAnswerClaimGate");
      expect(downgraded).not.toContain("evidence_id");
      expect(downgraded).not.toContain("test_passed");
      expect(downgraded).not.toContain("action_executed");
      expect(downgraded).not.toContain("sourceRef");
      expect(downgraded).not.toMatch(/retry|downgrade|kinds|修正版回答如下/iu);
    });

    it("buildDowngradedFinalAnswer English surface hides internal gate fields", () => {
      const verdict = evaluateFinalAnswerClaims("Done, tests passed.", []);
      const downgraded = buildDowngradedFinalAnswer("Done, tests passed.", verdict, "en-US");
      expect(downgraded).toContain("[unverified]");
      expect(downgraded).toContain("matching evidence is missing");
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

    it("fresh test_passed evidence still allows PASS (baseline)", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "command_output",
          supportsClaims: ["Bash", "command_ran", "bash_exit_0", "test_passed"],
          summary: "Bash: vitest --run",
          createdAt: minutesAgo(10),
        }),
      ];
      const verdict = evaluateFinalAnswerClaims("已完成，测试通过。", evidence, NOW);
      expect(verdict.status).toBe("passed");
    });

    it("stale test_passed evidence (>30min) blocks PASS", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "command_output",
          supportsClaims: ["Bash", "command_ran", "bash_exit_0", "test_passed"],
          summary: "Bash: vitest --run",
          createdAt: minutesAgo(45),
        }),
      ];
      const verdict = evaluateFinalAnswerClaims("已完成，测试通过。", evidence, NOW);
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
      const verdict = evaluateFinalAnswerClaims("代码里已经实现 X，调用链是 A→B。", evidence, NOW);
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
      const verdict = evaluateFinalAnswerClaims("代码里已经实现 X，调用链是 A→B。", evidence, NOW);
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
      const verdict = evaluateFinalAnswerClaims("今天 OpenAI 最新价格是 $0.01。", evidence, NOW);
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
      const verdict = evaluateFinalAnswerClaims("今天 OpenAI 最新价格是 $0.01。", evidence, NOW);
      expect(verdict.status).toBe("needs_disclaimer");
      expect(verdict.unsupportedKinds).toContain("external_current_fact");
      expect(verdict.staleKinds ?? []).toContain("external_current_fact");
    });

    it("ccb_parity is not affected by staleness threshold", () => {
      const evidence: EvidenceRecord[] = [
        makeEvidence({
          kind: "file_read",
          supportsClaims: ["Read", "local_read"],
          source: "F:/ccb-source/packages/cli/index.ts",
          summary: "Read ccb-source file for parity check",
          createdAt: hoursAgo(72),
        }),
      ];
      const verdict = evaluateFinalAnswerClaims("现在等于 CCB 了", evidence, NOW);
      expect(verdict.status).toBe("passed");
    });

    it("local 'current branch' query passes even when all evidence is stale", () => {
      // 当前分支白名单使 detectHighRiskClaims 不命中 external_current_fact，
      // 因此即便所有 evidence 都过期，也仍然 pass（保持 D.13U 行为）。
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
      const verdict = evaluateFinalAnswerClaims("已完成，测试通过。", evidence, NOW);
      expect(verdict.status).toBe("passed");
    });

    it("staleKinds is omitted when no matching evidence existed at all", () => {
      const verdict = evaluateFinalAnswerClaims("已完成，测试通过。", [], NOW);
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
      const verdict = evaluateFinalAnswerClaims("已完成，测试通过。", evidence, NOW);
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

    it("声称符合架构边界但无 active card → needs_disclaimer", async () => {
      const { evaluateArchitectureAndCompletenessClaims } = await import("./model-loop-runtime.js");
      const v = evaluateArchitectureAndCompletenessClaims(
        "本次改动符合架构边界，没有架构漂移。",
        { hasActiveCard: false },
        { classificationRequired: false, classification: "unknown", textHasClassification: false },
      );
      expect(v.status).toBe("needs_disclaimer");
      expect(v.unsupportedKinds).toContain("architecture_boundary");
    });

    it("声称架构闭合 + 有 card 但 driftWarnings 非空 → needs_disclaimer", async () => {
      const { evaluateArchitectureAndCompletenessClaims } = await import("./model-loop-runtime.js");
      const v = evaluateArchitectureAndCompletenessClaims(
        "架构已闭合。",
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

    it("声称架构闭合 + card + 无 drift + 有 evidence → passed", async () => {
      const { evaluateArchitectureAndCompletenessClaims } = await import("./model-loop-runtime.js");
      const v = evaluateArchitectureAndCompletenessClaims(
        "架构已闭合。",
        {
          hasActiveCard: true,
          driftWarnings: [],
          hasArchitectureEvidence: true,
        },
        { classificationRequired: false, classification: "unknown", textHasClassification: false },
      );
      expect(v.status).toBe("passed");
    });

    it("英文 'no architecture drift' 也命中", async () => {
      const { evaluateArchitectureAndCompletenessClaims } = await import("./model-loop-runtime.js");
      const v = evaluateArchitectureAndCompletenessClaims(
        "There is no architecture drift in this change.",
        { hasActiveCard: false },
        { classificationRequired: false, classification: "unknown", textHasClassification: false },
      );
      expect(v.status).toBe("needs_disclaimer");
      expect(v.matchedClaims.some((m) => m.kind === "architecture_boundary")).toBe(true);
    });

    it("声称没有遗漏 + classificationRequired + 未给分类 → needs_disclaimer", async () => {
      const { evaluateArchitectureAndCompletenessClaims } = await import("./model-loop-runtime.js");
      const v = evaluateArchitectureAndCompletenessClaims(
        "所有任务完整完成，没有遗漏。",
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

    it("声称没有遗漏 + 已给 classification + textHasClassification → passed", async () => {
      const { evaluateArchitectureAndCompletenessClaims } = await import("./model-loop-runtime.js");
      const v = evaluateArchitectureAndCompletenessClaims(
        "本次属于 single_issue，没有遗漏。",
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

    it("buildExtendedDowngradedFinalAnswer 把声明替换为 [未验证]，并附人话提示", async () => {
      const { buildExtendedDowngradedFinalAnswer } = await import("./model-loop-runtime.js");
      const out = buildExtendedDowngradedFinalAnswer(
        "本次改动符合架构边界，没有架构漂移。",
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
      expect(out).toContain("[未验证]");
      expect(out).not.toContain("符合架构边界");
      expect(out).not.toContain("没有架构漂移");
      expect(out).toContain("未验证");
      expect(out).not.toContain("Architecture Card 与 drift check");
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

    it("ExecuteExtraTool 成功 → 主屏只显示完成", async () => {
      const { sanitizeDeferredToolPrimaryText } = await import("./model-loop-runtime.js");
      const out = sanitizeDeferredToolPrimaryText(
        "ExecuteExtraTool(codebase-memory:search_code) 完成。",
        "zh-CN",
        { dispatchKind: "ExecuteExtraTool", ok: true },
      );
      expect(out).not.toContain("ExecuteExtraTool");
      expect(out).not.toContain("codebase-memory:search_code");
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
