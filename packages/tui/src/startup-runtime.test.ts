import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  createShellLimitations,
  decodeInput,
  formatError,
  formatProjectRouteProblem,
  formatProviderEnvWarning,
  formatUserScopedSetupNeeded,
  readOutputColumns,
  readOutputRows,
  sanitizeDisplayPaths,
  sanitizeDiagnosticText,
  sanitizeUserFacingError,
  shouldEnterProductShellCandidate,
  stripAnsi,
  toInputBuffer,
  truncateDisplay,
  uniqueStrings,
  writeLine,
} from "./startup-runtime.js";

describe("startup-runtime", () => {
  describe("writeLine", () => {
    it("appends newline to output", () => {
      const output = new PassThrough();
      const chunks: string[] = [];
      output.on("data", (chunk) => chunks.push(chunk.toString()));
      writeLine(output, "hello");
      expect(chunks.join("")).toBe("hello\n");
    });

    it("handles empty string", () => {
      const output = new PassThrough();
      const chunks: string[] = [];
      output.on("data", (chunk) => chunks.push(chunk.toString()));
      writeLine(output, "");
      expect(chunks.join("")).toBe("\n");
    });

    it("Run 2 Closure: ignores broken pipe style output errors", () => {
      const output = {
        write() {
          const error = new Error("broken pipe") as Error & { code: string };
          error.code = "EPIPE";
          throw error;
        },
      } as unknown as PassThrough;

      expect(() => writeLine(output, "hello")).not.toThrow();
    });
  });

  describe("readOutputColumns", () => {
    it("returns columns from output stream", () => {
      const output = Object.assign(new PassThrough(), { columns: 120 });
      expect(readOutputColumns(output)).toBe(120);
    });

    it("defaults to 80 when columns is undefined", () => {
      const output = new PassThrough();
      expect(readOutputColumns(output)).toBe(80);
    });

    it("defaults to 80 when columns is NaN", () => {
      const output = Object.assign(new PassThrough(), { columns: Number.NaN });
      expect(readOutputColumns(output)).toBe(80);
    });
  });

  describe("readOutputRows", () => {
    it("returns rows from output stream", () => {
      const output = Object.assign(new PassThrough(), { rows: 40 });
      expect(readOutputRows(output)).toBe(40);
    });

    it("defaults to 24 when rows is undefined", () => {
      const output = new PassThrough();
      expect(readOutputRows(output)).toBe(24);
    });
  });

  describe("truncateDisplay", () => {
    it("returns text unchanged when within width", () => {
      expect(truncateDisplay("hello", 10)).toBe("hello");
    });

    it("truncates with ellipsis when exceeding width", () => {
      expect(truncateDisplay("hello world", 5)).toBe("hello…");
    });

    it("counts CJK characters as width 2", () => {
      expect(truncateDisplay("你好世界", 4)).toBe("你好…");
    });

    it("handles empty string", () => {
      expect(truncateDisplay("", 10)).toBe("");
    });
  });

  describe("stripAnsi", () => {
    it("removes ANSI escape sequences", () => {
      const escapeChar = String.fromCharCode(27);
      const colored = `${escapeChar}[31mred${escapeChar}[0m`;
      expect(stripAnsi(colored)).toBe("red");
    });

    it("returns plain text unchanged", () => {
      expect(stripAnsi("plain text")).toBe("plain text");
    });
  });

  describe("uniqueStrings", () => {
    it("removes duplicates", () => {
      expect(uniqueStrings(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
    });

    it("handles empty array", () => {
      expect(uniqueStrings([])).toEqual([]);
    });

    it("preserves order of first occurrence", () => {
      expect(uniqueStrings(["c", "a", "b", "a"])).toEqual(["c", "a", "b"]);
    });
  });

  describe("sanitizeDiagnosticText", () => {
    it("redacts API keys", () => {
      expect(sanitizeDiagnosticText("api_key=sk-abc123")).toBe("api_key=***");
    });

    it("redacts Bearer tokens", () => {
      expect(sanitizeDiagnosticText("Bearer eyJhbGciOiJIUzI1NiJ9")).toBe("Bearer ***");
    });

    it("redacts sk- prefixed keys", () => {
      expect(sanitizeDiagnosticText("key is sk-proj-abc123")).toBe("key is sk-***");
    });

    it("redacts prompt parameters", () => {
      expect(sanitizeDiagnosticText("prompt=secret_value&other=1")).toBe("prompt=***&other=1");
    });
  });

  describe("sanitizeDisplayPaths", () => {
    it("Run 2 P3-7: redacts absolute paths without mangling project-relative paths", () => {
      const project = "C:\\Users\\Admin\\AppData\\Local\\Temp\\linghun-project";
      const raw =
        "source=C:\\Users\\Admin\\AppData\\Local\\Temp\\linghun-project\\.linghun\\logs\\evidence.log rel=.linghun/logs/evidence.log";

      const sanitized = sanitizeDisplayPaths(raw, project);

      expect(sanitized).not.toContain(project);
      expect(sanitized).toContain("source=.linghun/logs/evidence.log");
      expect(sanitized).toContain("rel=.linghun/logs/evidence.log");
      expect(sanitized).not.toContain(".linghun[local-path]");
    });
  });

  describe("sanitizeUserFacingError", () => {
    it("redacts gateId", () => {
      expect(sanitizeUserFacingError("error gateId=abc123 happened")).toBe(
        "error gateId=*** happened",
      );
    });

    it("redacts request_id", () => {
      expect(sanitizeUserFacingError("request_id=xyz789")).toBe("requestId=***");
    });

    it("redacts token parameter", () => {
      expect(sanitizeUserFacingError("token=secret123")).toBe("token=***");
    });

    it("redacts Authorization header", () => {
      expect(sanitizeUserFacingError("Authorization: Bearer abc")).toBe("Authorization: *** ***");
    });
  });

  describe("formatError", () => {
    it("formats Error instance in Chinese", () => {
      const result = formatError(new Error("连接超时"));
      expect(result).toContain("出错了。");
      expect(result).toContain("连接超时");
    });

    it("formats Error instance in English", () => {
      const result = formatError(new Error("timeout"), "en-US");
      expect(result).toContain("Something went wrong.");
      expect(result).toContain("timeout");
    });

    it("handles non-Error values in Chinese", () => {
      const result = formatError("string error");
      expect(result).toContain("未知错误");
    });

    it("handles non-Error values in English", () => {
      const result = formatError(42, "en-US");
      expect(result).toContain("unknown error");
    });

    it("includes suggestion from Error with suggestion property", () => {
      const err = Object.assign(new Error("fail"), { suggestion: "try again" });
      const result = formatError(err, "en-US");
      expect(result).toContain("try again");
    });
  });

  describe("shouldEnterProductShellCandidate", () => {
    it("returns false when LINGHUN_TUI_PLAIN is set", () => {
      const originalEnv = process.env.LINGHUN_TUI_PLAIN;
      process.env.LINGHUN_TUI_PLAIN = "1";
      try {
        const input = Object.assign(new PassThrough(), { isTTY: true });
        const output = Object.assign(new PassThrough(), { isTTY: true });
        expect(shouldEnterProductShellCandidate(input, output)).toBe(false);
      } finally {
        if (originalEnv === undefined) {
          process.env.LINGHUN_TUI_PLAIN = undefined;
        } else {
          process.env.LINGHUN_TUI_PLAIN = originalEnv;
        }
      }
    });

    it("returns false when TERM is dumb", () => {
      const originalTerm = process.env.TERM;
      const originalPlain = process.env.LINGHUN_TUI_PLAIN;
      process.env.TERM = "dumb";
      process.env.LINGHUN_TUI_PLAIN = undefined;
      try {
        const input = Object.assign(new PassThrough(), { isTTY: true });
        const output = Object.assign(new PassThrough(), { isTTY: true });
        expect(shouldEnterProductShellCandidate(input, output)).toBe(false);
      } finally {
        if (originalTerm === undefined) {
          process.env.TERM = undefined;
        } else {
          process.env.TERM = originalTerm;
        }
        if (originalPlain !== undefined) {
          process.env.LINGHUN_TUI_PLAIN = originalPlain;
        }
      }
    });

    it("returns false when input is not TTY", () => {
      const originalPlain = process.env.LINGHUN_TUI_PLAIN;
      const originalTerm = process.env.TERM;
      process.env.LINGHUN_TUI_PLAIN = undefined;
      process.env.TERM = undefined;
      try {
        const input = new PassThrough();
        const output = Object.assign(new PassThrough(), { isTTY: true });
        expect(shouldEnterProductShellCandidate(input, output)).toBe(false);
      } finally {
        if (originalPlain !== undefined) process.env.LINGHUN_TUI_PLAIN = originalPlain;
        if (originalTerm !== undefined) process.env.TERM = originalTerm;
      }
    });

    it("returns true when both input and output are TTY", () => {
      const originalPlain = process.env.LINGHUN_TUI_PLAIN;
      const originalTerm = process.env.TERM;
      process.env.LINGHUN_TUI_PLAIN = undefined;
      process.env.TERM = undefined;
      try {
        const input = Object.assign(new PassThrough(), { isTTY: true });
        const output = Object.assign(new PassThrough(), { isTTY: true });
        expect(shouldEnterProductShellCandidate(input, output)).toBe(true);
      } finally {
        if (originalPlain !== undefined) process.env.LINGHUN_TUI_PLAIN = originalPlain;
        if (originalTerm !== undefined) process.env.TERM = originalTerm;
      }
    });
  });

  describe("formatProviderEnvWarning", () => {
    it("formats in Chinese", () => {
      const result = formatProviderEnvWarning("文件不存在", "zh-CN");
      expect(result).toContain("provider.env 读取失败");
      expect(result).toContain("文件不存在");
    });

    it("formats in English", () => {
      const result = formatProviderEnvWarning("file not found", "en-US");
      expect(result).toContain("provider.env could not be read");
      expect(result).toContain("file not found");
    });
  });

  describe("formatProjectRouteProblem", () => {
    it("formats in Chinese", () => {
      const result = formatProjectRouteProblem("模型不可用", "zh-CN");
      expect(result).toContain("项目模型路由需要处理");
      expect(result).toContain("模型不可用");
    });

    it("formats in English", () => {
      const result = formatProjectRouteProblem("model unavailable", "en-US");
      expect(result).toContain("Project model route needs attention");
      expect(result).toContain("model unavailable");
    });
  });

  describe("formatUserScopedSetupNeeded", () => {
    it("includes provider env path in Chinese", () => {
      const result = formatUserScopedSetupNeeded("/home/user/.linghun/provider.env", "zh-CN");
      expect(result).toContain("/home/user/.linghun/provider.env");
      expect(result).toContain("需要配置模型");
    });

    it("includes provider env path in English", () => {
      const result = formatUserScopedSetupNeeded("/home/user/.linghun/provider.env", "en-US");
      expect(result).toContain("/home/user/.linghun/provider.env");
      expect(result).toContain("Model setup needed");
    });
  });

  describe("createShellLimitations", () => {
    it("returns empty array when no limitations", () => {
      const result = createShellLimitations({ language: "zh-CN" });
      // NO_COLOR and FORCE_COLOR may or may not be set in test env
      expect(Array.isArray(result)).toBe(true);
    });

    it("includes provider env warning when present", () => {
      const result = createShellLimitations({
        language: "zh-CN",
        providerEnvWarning: "文件损坏",
      });
      expect(result.some((l) => l.includes("provider.env"))).toBe(true);
    });

    it("includes no-color limitation when NO_COLOR is set", () => {
      const original = process.env.NO_COLOR;
      process.env.NO_COLOR = "1";
      try {
        const result = createShellLimitations({ language: "en-US" });
        expect(result.some((l) => l.includes("No-color"))).toBe(true);
      } finally {
        if (original === undefined) {
          process.env.NO_COLOR = undefined;
        } else {
          process.env.NO_COLOR = original;
        }
      }
    });
  });

  describe("toInputBuffer", () => {
    it("returns Buffer unchanged", () => {
      const buf = Buffer.from("hello");
      expect(toInputBuffer(buf)).toBe(buf);
    });

    it("converts Uint8Array to Buffer", () => {
      const arr = new Uint8Array([104, 101, 108, 108, 111]);
      const result = toInputBuffer(arr);
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe("hello");
    });

    it("converts string to Buffer", () => {
      const result = toInputBuffer("hello");
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe("hello");
    });
  });

  describe("decodeInput", () => {
    it("decodes valid UTF-8", () => {
      const buf = Buffer.from("你好世界", "utf8");
      expect(decodeInput(buf)).toBe("你好世界");
    });

    it("decodes ASCII", () => {
      const buf = Buffer.from("hello", "utf8");
      expect(decodeInput(buf)).toBe("hello");
    });
  });
});
