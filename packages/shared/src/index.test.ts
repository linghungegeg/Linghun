import { describe, expect, it } from "vitest";
import {
  LINGHUN_CLI_NAME,
  LINGHUN_NAME,
  LINGHUN_VERSION,
  canonicalPathForCompare,
  canonicalPathKeyForCompare,
  isPathInside,
  normalizePathSeparators,
  pathsReferToSameLocation,
} from "./index.js";

describe("shared constants", () => {
  it("uses Linghun naming conventions", () => {
    expect(LINGHUN_NAME).toBe("Linghun");
    expect(LINGHUN_CLI_NAME).toBe("linghun");
    expect(LINGHUN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("shared path helpers", () => {
  it("normalizes separators and compares Windows drive-letter casing consistently", () => {
    const upper = "G:\\Linghun 项目\\子目录";
    const lower = "g:/linghun 项目/子目录";

    expect(normalizePathSeparators(upper)).toBe("G:/Linghun 项目/子目录");
    expect(canonicalPathForCompare(upper, true)).toBe(canonicalPathForCompare(lower, true));
    expect(isPathInside("G:\\Linghun 项目\\子目录\\file.txt", "g:/linghun 项目", true)).toBe(true);
    expect(isPathInside("G:\\Linghun 项目-旁边\\file.txt", "g:/linghun 项目", true)).toBe(false);
    expect(canonicalPathKeyForCompare("G:\\Linghun 项目\\file.txt\\", true)).toBe(
      "g:/linghun 项目/file.txt",
    );
    expect(pathsReferToSameLocation("dist\\report.md", "dist/report.md", true)).toBe(true);
    expect(pathsReferToSameLocation("dist/report.md", "docs/report.md", true)).toBe(false);
  });
});
