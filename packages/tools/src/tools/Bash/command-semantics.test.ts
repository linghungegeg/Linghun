import { describe, expect, it } from "vitest";
import { interpretCommandResult } from "./command-semantics.js";

describe("command-semantics", () => {
  describe("extractLastCommand in pipelines/chains", () => {
    it("extracts grep as last command from pipe: cmd1 | grep pattern", () => {
      const result = interpretCommandResult("cat file.txt | grep pattern", 1);
      expect(result.isError).toBe(false);
      expect(result.message).toBe("no matches found");
    });

    it("extracts last command from && chain", () => {
      const result = interpretCommandResult("cd /tmp && grep -r foo .", 1);
      expect(result.isError).toBe(false);
      expect(result.message).toBe("no matches found");
    });

    it("extracts last command from semicolon chain", () => {
      const result = interpretCommandResult("echo hello; diff a.txt b.txt", 1);
      expect(result.isError).toBe(false);
      expect(result.message).toBe("files differ");
    });

    it("extracts last command from || chain", () => {
      const result = interpretCommandResult("false || test -f missing.txt", 1);
      expect(result.isError).toBe(false);
      expect(result.message).toBe("condition false");
    });

    it("handles complex pipeline: build | sort | grep", () => {
      const result = interpretCommandResult("npm run build | sort | grep ERROR", 1);
      expect(result.isError).toBe(false);
      expect(result.message).toBe("no matches found");
    });

    it("strips env prefix from last command", () => {
      const result = interpretCommandResult("echo x; LC_ALL=C grep foo bar.txt", 1);
      expect(result.isError).toBe(false);
      expect(result.message).toBe("no matches found");
    });

    it("strips path from last command", () => {
      const result = interpretCommandResult("echo x | /usr/bin/grep foo", 1);
      expect(result.isError).toBe(false);
      expect(result.message).toBe("no matches found");
    });
  });

  describe("isError=false for grep exit 1", () => {
    it("grep exit 1 means no matches, not error", () => {
      const result = interpretCommandResult("grep xxx nonexist", 1);
      expect(result.isError).toBe(false);
      expect(result.message).toBe("no matches found");
    });

    it("grep exit 2 is a real error", () => {
      const result = interpretCommandResult("grep xxx nonexist", 2);
      expect(result.isError).toBe(true);
    });

    it("rg exit 1 means no matches", () => {
      const result = interpretCommandResult("rg pattern file.txt", 1);
      expect(result.isError).toBe(false);
    });
  });
});
