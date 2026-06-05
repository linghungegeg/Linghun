import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  type FileMetrics,
  checkBoundaries,
  checkBoundaryEditPreflight,
  checkFileBoundaries,
  detectBashFileWriteTargets,
  detectCircularDependencyRisk,
  detectCrossLayerImports,
  estimateFileMetrics,
  formatBoundaryViolations,
  validateChangeDeclaration,
} from "./architecture-boundary.js";

describe("architecture-boundary", () => {
  describe("checkFileBoundaries", () => {
    it("detects large file", () => {
      const metrics: FileMetrics = {
        path: "packages/tui/src/index.ts",
        lineCount: 900,
      };
      const violations = checkFileBoundaries(metrics);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("large-file");
      expect(violations[0].severity).toBe("warning");
      expect(violations[0].metric).toBe(900);
    });

    it("detects god file (very large)", () => {
      const metrics: FileMetrics = {
        path: "packages/tui/src/index.ts",
        lineCount: 1600,
      };
      const violations = checkFileBoundaries(metrics);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("god-file");
      expect(violations[0].severity).toBe("critical");
    });

    it("detects god file by export count + size", () => {
      const metrics: FileMetrics = {
        path: "packages/tui/src/index.ts",
        lineCount: 900,
        exportCount: 50,
      };
      const violations = checkFileBoundaries(metrics);
      expect(violations.some((v) => v.kind === "god-file")).toBe(true);
    });

    it("detects large function", () => {
      const metrics: FileMetrics = {
        path: "packages/tui/src/foo.ts",
        lineCount: 400,
        functionLengths: [
          { name: "handleInput", lines: 250 },
          { name: "small", lines: 20 },
        ],
      };
      const violations = checkFileBoundaries(metrics);
      const largeFn = violations.find((v) => v.kind === "large-function");
      expect(largeFn).toBeDefined();
      expect(largeFn?.detail).toContain("handleInput");
      expect(largeFn?.metric).toBe(250);
    });

    it("detects deep nesting", () => {
      const metrics: FileMetrics = {
        path: "packages/tui/src/foo.ts",
        lineCount: 100,
        maxNestingDepth: 6,
      };
      const violations = checkFileBoundaries(metrics);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("deep-nesting");
      expect(violations[0].severity).toBe("warning");
    });

    it("critical deep nesting at threshold + 3", () => {
      const metrics: FileMetrics = {
        path: "packages/tui/src/foo.ts",
        lineCount: 100,
        maxNestingDepth: 7,
      };
      const violations = checkFileBoundaries(metrics);
      expect(violations[0].severity).toBe("critical");
    });

    it("returns empty for clean file", () => {
      const metrics: FileMetrics = {
        path: "packages/tui/src/small.ts",
        lineCount: 50,
        exportCount: 3,
        functionLengths: [{ name: "foo", lines: 15 }],
        maxNestingDepth: 2,
      };
      const violations = checkFileBoundaries(metrics);
      expect(violations).toHaveLength(0);
    });

    it("respects custom thresholds", () => {
      const metrics: FileMetrics = {
        path: "packages/tui/src/foo.ts",
        lineCount: 300,
      };
      const violations = checkFileBoundaries(metrics, {
        ...DEFAULT_THRESHOLDS,
        maxFileLines: 200,
      });
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("large-file");
    });
  });

  describe("detectCrossLayerImports", () => {
    it("detects lower layer importing from higher layer", () => {
      const violations = detectCrossLayerImports("packages/core/src/session.ts", ["@linghun/tui"]);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("cross-layer-import");
      expect(violations[0].detail).toContain("core");
      expect(violations[0].detail).toContain("tui");
    });

    it("allows higher layer importing from lower layer", () => {
      const violations = detectCrossLayerImports("packages/tui/src/index.ts", [
        "@linghun/core",
        "@linghun/config",
        "@linghun/shared",
      ]);
      expect(violations).toHaveLength(0);
    });

    it("allows same-layer imports", () => {
      const violations = detectCrossLayerImports("packages/tui/src/foo.ts", [
        "./bar.js",
        "../utils.js",
      ]);
      expect(violations).toHaveLength(0);
    });

    it("detects shared importing from providers", () => {
      const violations = detectCrossLayerImports("packages/shared/src/utils.ts", [
        "@linghun/providers",
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0].detail).toContain("shared");
      expect(violations[0].detail).toContain("providers");
    });

    it("ignores non-linghun imports", () => {
      const violations = detectCrossLayerImports("packages/core/src/foo.ts", [
        "node:fs",
        "vitest",
        "some-external-lib",
      ]);
      expect(violations).toHaveLength(0);
    });
  });

  describe("detectCircularDependencyRisk", () => {
    it("detects mutual imports", () => {
      const result = detectCircularDependencyRisk(
        { path: "packages/tui/src/a.ts", importSources: ["./b.js"] },
        { path: "packages/tui/src/b.ts", importSources: ["./a.js"] },
      );
      expect(result).toBeDefined();
      expect(result?.kind).toBe("circular-dependency-risk");
    });

    it("returns undefined for one-way imports", () => {
      const result = detectCircularDependencyRisk(
        { path: "packages/tui/src/a.ts", importSources: ["./b.js"] },
        { path: "packages/tui/src/b.ts", importSources: ["./c.js"] },
      );
      expect(result).toBeUndefined();
    });

    it("returns undefined for no imports", () => {
      const result = detectCircularDependencyRisk(
        { path: "packages/tui/src/a.ts", importSources: [] },
        { path: "packages/tui/src/b.ts", importSources: [] },
      );
      expect(result).toBeUndefined();
    });
  });

  describe("checkBoundaries (batch)", () => {
    it("combines violations from multiple files", () => {
      const files: FileMetrics[] = [
        { path: "packages/tui/src/big.ts", lineCount: 1000 },
        { path: "packages/tui/src/small.ts", lineCount: 50 },
        {
          path: "packages/core/src/bad.ts",
          lineCount: 100,
          importSources: ["@linghun/tui"],
        },
      ];
      const result = checkBoundaries(files);
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
      expect(result.summary).toContain("warning");
    });

    it("marks critical as blocking", () => {
      const files: FileMetrics[] = [{ path: "packages/tui/src/god.ts", lineCount: 2000 }];
      const result = checkBoundaries(files);
      expect(result.hasCritical).toBe(true);
      expect(result.hasBlocking).toBe(true);
    });

    it("returns clean for small files", () => {
      const files: FileMetrics[] = [
        { path: "packages/tui/src/a.ts", lineCount: 50 },
        { path: "packages/tui/src/b.ts", lineCount: 100 },
      ];
      const result = checkBoundaries(files);
      expect(result.violations).toHaveLength(0);
      expect(result.summary).toBe("clean");
    });
  });

  describe("validateChangeDeclaration", () => {
    it("warns on missing files", () => {
      const warnings = validateChangeDeclaration({});
      expect(warnings).toContain("Change declaration missing: files list is empty.");
    });

    it("warns on missing mainPath", () => {
      const warnings = validateChangeDeclaration({ files: ["a.ts"] });
      expect(warnings).toContain("Change declaration missing: mainPath not specified.");
    });

    it("warns on missing verificationLevel", () => {
      const warnings = validateChangeDeclaration({
        files: ["a.ts"],
        mainPath: "main",
      });
      expect(warnings).toContain("Change declaration missing: verificationLevel not specified.");
    });

    it("warns on large change without realSmokeRequired", () => {
      const warnings = validateChangeDeclaration({
        files: ["a.ts", "b.ts", "c.ts", "d.ts"],
        mainPath: "main",
        verificationLevel: "local",
        realSmokeRequired: [],
      });
      expect(warnings.some((w) => w.includes("Large change"))).toBe(true);
    });

    it("passes for complete declaration", () => {
      const warnings = validateChangeDeclaration({
        files: ["a.ts", "b.ts", "c.ts", "d.ts"],
        mainPath: "main",
        verificationLevel: "build",
        realSmokeRequired: ["TUI rendering"],
      });
      expect(warnings).toHaveLength(0);
    });
  });

  describe("checkBoundaryEditPreflight", () => {
    const largeSource = Array.from(
      { length: 900 },
      (_, index) => `const value${index} = ${index};`,
    ).join("\n");

    it("asks for confirmation before adding substantial lines to an existing large file", () => {
      const result = checkBoundaryEditPreflight({
        toolName: "Edit",
        path: "packages/tui/src/index.ts",
        targetExists: true,
        existingSource: largeSource,
        input: {
          oldText: "const value1 = 1;",
          newText: Array.from({ length: 45 }, (_, index) => `const added${index} = ${index};`).join(
            "\n",
          ),
        },
      });

      expect(result.decision).toBe("confirm");
      if (result.decision === "confirm") {
        expect(result.path).toBe("packages/tui/src/index.ts");
        expect(result.lineCount).toBe(900);
        expect(result.estimatedAddedLines).toBeGreaterThanOrEqual(40);
      }
    });

    it("allows small local edits to existing large files", () => {
      const result = checkBoundaryEditPreflight({
        toolName: "Edit",
        path: "packages/tui/src/index.ts",
        targetExists: true,
        existingSource: largeSource,
        input: {
          oldText: "const value1 = 1;",
          newText: "const value1 = 2;",
        },
      });

      expect(result).toEqual({ decision: "allow", reason: "small local edit" });
    });

    it("allows report artifacts and new files", () => {
      const report = checkBoundaryEditPreflight({
        toolName: "Write",
        path: "report.md",
        targetExists: true,
        existingSource: largeSource,
        input: { path: "report.md", content: Array.from({ length: 100 }, () => "line").join("\n") },
        reportArtifact: true,
      });
      const newFile = checkBoundaryEditPreflight({
        toolName: "Write",
        path: "packages/tui/src/new-file.ts",
        targetExists: false,
        input: { path: "packages/tui/src/new-file.ts", content: "export const x = 1;" },
      });

      expect(report.decision).toBe("allow");
      expect(newFile.decision).toBe("allow");
    });
  });

  describe("formatBoundaryViolations", () => {
    it("formats empty violations", () => {
      const formatted = formatBoundaryViolations([]);
      expect(formatted).toBe("No architecture boundary violations detected.");
    });

    it("formats grouped violations", () => {
      const violations = checkFileBoundaries({
        path: "packages/tui/src/big.ts",
        lineCount: 1600,
        functionLengths: [{ name: "bigFn", lines: 300 }],
      });
      const formatted = formatBoundaryViolations(violations);
      expect(formatted).toContain("Architecture boundary violations:");
      expect(formatted).toContain("god-file");
      expect(formatted).toContain("large-function");
    });
  });

  describe("estimateFileMetrics", () => {
    it("counts lines correctly", () => {
      const source = "line1\nline2\nline3\n";
      const metrics = estimateFileMetrics("test.ts", source);
      expect(metrics.lineCount).toBe(4); // trailing newline creates empty last line
    });

    it("counts exports", () => {
      const source = [
        "export function foo() {}",
        "export const bar = 1;",
        "const internal = 2;",
        "export type Baz = string;",
      ].join("\n");
      const metrics = estimateFileMetrics("test.ts", source);
      expect(metrics.exportCount).toBe(3);
    });

    it("extracts import sources", () => {
      const source = [
        'import { foo } from "@linghun/core";',
        'import { bar } from "./local.js";',
        'import type { Baz } from "@linghun/shared";',
      ].join("\n");
      const metrics = estimateFileMetrics("test.ts", source);
      expect(metrics.importSources).toContain("@linghun/core");
      expect(metrics.importSources).toContain("./local.js");
      expect(metrics.importSources).toContain("@linghun/shared");
    });

    it("estimates function lengths", () => {
      const source = [
        "export function bigFunction() {",
        ...Array.from({ length: 50 }, (_, i) => `  const x${i} = ${i};`),
        "}",
        "",
        "export function smallFunction() {",
        "  return 1;",
        "}",
      ].join("\n");
      const metrics = estimateFileMetrics("test.ts", source);
      const bigFn = metrics.functionLengths?.find((f) => f.name === "bigFunction");
      expect(bigFn).toBeDefined();
      expect(bigFn?.lines).toBeGreaterThan(10);
    });

    it("estimates nesting depth", () => {
      const source = [
        "function foo() {",
        "  if (true) {",
        "    for (const x of []) {",
        "      if (x) {",
        "        console.log(x);",
        "      }",
        "    }",
        "  }",
        "}",
      ].join("\n");
      const metrics = estimateFileMetrics("test.ts", source);
      expect(metrics.maxNestingDepth).toBeGreaterThanOrEqual(4);
    });
  });

  describe("detectBashFileWriteTargets", () => {
    it("detects redirect > target", () => {
      const targets = detectBashFileWriteTargets("echo content > packages/tui/src/big.ts");
      expect(targets).toContain("packages/tui/src/big.ts");
    });

    it("detects append >> target", () => {
      const targets = detectBashFileWriteTargets("echo more >> packages/tui/src/index.ts");
      expect(targets).toContain("packages/tui/src/index.ts");
    });

    it("detects tee target", () => {
      const targets = detectBashFileWriteTargets("cat data | tee packages/tui/src/out.ts");
      expect(targets).toContain("packages/tui/src/out.ts");
    });

    it("ignores /dev/ targets", () => {
      const targets = detectBashFileWriteTargets("echo x > /dev/null");
      expect(targets).toHaveLength(0);
    });

    it("ignores variable-based targets", () => {
      const targets = detectBashFileWriteTargets("echo x > $OUTPUT_FILE");
      expect(targets).toHaveLength(0);
    });

    it("ignores commands without write patterns", () => {
      const targets = detectBashFileWriteTargets("npm test");
      expect(targets).toHaveLength(0);
    });
  });

  describe("checkBoundaryEditPreflight (Bash)", () => {
    const largeSource = Array.from({ length: 900 }, (_, i) => `line ${i}`).join("\n");
    const smallSource = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");

    it("confirms for Bash write to existing large file", () => {
      const result = checkBoundaryEditPreflight({
        toolName: "Bash",
        path: "packages/tui/src/big.ts",
        existingSource: largeSource,
        targetExists: true,
        input: { command: "echo x > packages/tui/src/big.ts" },
      });
      expect(result.decision).toBe("confirm");
    });

    it("allows Bash write to small file", () => {
      const result = checkBoundaryEditPreflight({
        toolName: "Bash",
        path: "packages/tui/src/small.ts",
        existingSource: smallSource,
        targetExists: true,
        input: { command: "echo x > packages/tui/src/small.ts" },
      });
      expect(result.decision).toBe("allow");
    });

    it("allows Bash with no existing source", () => {
      const result = checkBoundaryEditPreflight({
        toolName: "Bash",
        path: "packages/tui/src/out.ts",
        targetExists: true,
        input: { command: "echo x > packages/tui/src/out.ts" },
      });
      expect(result.decision).toBe("allow");
    });
  });
});
