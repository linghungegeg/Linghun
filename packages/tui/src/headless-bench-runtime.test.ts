import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeFailureFingerprint } from "./headless-bench-runtime.js";

describe("headless-bench-runtime", () => {
  describe("normalizeFailureFingerprint", () => {
    it("normalizes timestamps", () => {
      const input = "Error at 2024-01-15T10:30:45.123Z: failed";
      const output = normalizeFailureFingerprint(input);
      expect(output).toBe("Error at TIMESTAMP: failed");
    });

    it("normalizes milliseconds", () => {
      const input = "Test failed after 1234ms";
      const output = normalizeFailureFingerprint(input);
      expect(output).toBe("Test failed after Xms");
    });

    it("normalizes line numbers", () => {
      const input = "Error at line 42: undefined";
      const output = normalizeFailureFingerprint(input);
      expect(output).toBe("Error at line X: undefined");
    });

    it("normalizes file paths with line:column", () => {
      const input = "src/file.ts:123:45";
      const output = normalizeFailureFingerprint(input);
      expect(output).toBe("src/file.ts:X:X");
    });

    it("normalizes memory addresses", () => {
      const input = "Segfault at 0xdeadbeef";
      const output = normalizeFailureFingerprint(input);
      expect(output).toBe("Segfault at 0xADDR");
    });

    it("normalizes Windows paths", () => {
      const input = "File not found: C:\\Users\\test\\project\\file.txt";
      const output = normalizeFailureFingerprint(input);
      expect(output).toBe("File not found: WIN_PATH");
    });

    it("normalizes .linghun paths", () => {
      const input = "Log: /project/.linghun/headless/test.log";
      const output = normalizeFailureFingerprint(input);
      expect(output).toBe("Log: /PROJECT/.linghun/PATH");
    });

    it("normalizes temp paths", () => {
      const input = "Temp file: /tmp/linghun-test-abc123";
      const output = normalizeFailureFingerprint(input);
      expect(output).toBe("Temp file: /tmp/TEMP");
    });

    it("normalizes timeout messages", () => {
      const input = "Command timed out after 5000ms";
      const output = normalizeFailureFingerprint(input);
      expect(output).toBe("Command timed out after Xms");
    });

    it("preserves error keywords", () => {
      const input = "AssertionError: expected 5 to equal 6";
      const output = normalizeFailureFingerprint(input);
      expect(output).toBe("AssertionError: expected 5 to equal 6");
    });

    it("handles multiple timestamps in one string", () => {
      const input = "Start: 2024-01-15T10:30:45Z, End: 2024-01-15T10:31:00Z";
      const output = normalizeFailureFingerprint(input);
      expect(output).toBe("Start: TIMESTAMP, End: TIMESTAMP");
    });
  });

  describe("workspace change detection", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "linghun-headless-change-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("detects same-file content changes", async () => {
      const { collectHeadlessArtifactChecklist } = await import("./headless-bench-runtime.js");
      const file = join(tempDir, "test.txt");
      await writeFile(file, "initial content", "utf8");

      const checklist1 = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config: {
          enabled: true,
          profile: "generic",
          testTimeoutMs: 1000,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
        changedFiles: ["test.txt"],
      });

      await writeFile(file, "modified content", "utf8");

      const checklist2 = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config: {
          enabled: true,
          profile: "generic",
          testTimeoutMs: 1000,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
        changedFiles: ["test.txt"],
      });

      expect(checklist1.workspaceChangeHash).toBeDefined();
      expect(checklist2.workspaceChangeHash).toBeDefined();
      expect(checklist1.workspaceChangeHash).not.toBe(checklist2.workspaceChangeHash);
    });

    it("returns same hash for unchanged content", async () => {
      const { collectHeadlessArtifactChecklist } = await import("./headless-bench-runtime.js");
      const file = join(tempDir, "test.txt");
      await writeFile(file, "stable content", "utf8");

      const checklist1 = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config: {
          enabled: true,
          profile: "generic",
          testTimeoutMs: 1000,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
        changedFiles: ["test.txt"],
      });

      const checklist2 = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config: {
          enabled: true,
          profile: "generic",
          testTimeoutMs: 1000,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
        changedFiles: ["test.txt"],
      });

      expect(checklist1.workspaceChangeHash).toBe(checklist2.workspaceChangeHash);
    });

    it("returns empty hash when no files changed", async () => {
      const { collectHeadlessArtifactChecklist } = await import("./headless-bench-runtime.js");

      const checklist = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config: {
          enabled: true,
          profile: "generic",
          testTimeoutMs: 1000,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
        changedFiles: [],
      });

      expect(checklist.workspaceChangeHash).toBe("empty");
    });

    it("detects new file additions", async () => {
      const { collectHeadlessArtifactChecklist } = await import("./headless-bench-runtime.js");
      const file1 = join(tempDir, "file1.txt");
      await writeFile(file1, "content", "utf8");

      const checklist1 = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config: {
          enabled: true,
          profile: "generic",
          testTimeoutMs: 1000,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
        changedFiles: ["file1.txt"],
      });

      const file2 = join(tempDir, "file2.txt");
      await writeFile(file2, "new content", "utf8");

      const checklist2 = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config: {
          enabled: true,
          profile: "generic",
          testTimeoutMs: 1000,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
        changedFiles: ["file1.txt", "file2.txt"],
      });

      expect(checklist1.workspaceChangeHash).not.toBe(checklist2.workspaceChangeHash);
    });
  });
});
