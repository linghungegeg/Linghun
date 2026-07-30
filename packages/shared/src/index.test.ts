import { describe, expect, it } from "vitest";
import {
  DEFAULT_MINIMAX_ANTHROPIC_BASE_URL,
  DEFAULT_MINIMAX_BASE_URL,
  DEFAULT_MINIMAX_CN_ANTHROPIC_BASE_URL,
  DEFAULT_MINIMAX_CN_BASE_URL,
  LINGHUN_CLI_NAME,
  LINGHUN_NAME,
  LINGHUN_VERSION,
  MINIMAX_API_MODELS,
  canonicalPathForCompare,
  canonicalPathKeyForCompare,
  isMiniMaxApiModel,
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

describe("MiniMax provider constants", () => {
  it("exposes global and mainland-China OpenAI- and Anthropic-compatible base URLs", () => {
    expect(DEFAULT_MINIMAX_BASE_URL).toBe("https://api.minimax.io/v1");
    expect(DEFAULT_MINIMAX_ANTHROPIC_BASE_URL).toBe("https://api.minimax.io/anthropic");
    expect(DEFAULT_MINIMAX_CN_BASE_URL).toBe("https://api.minimaxi.com/v1");
    expect(DEFAULT_MINIMAX_CN_ANTHROPIC_BASE_URL).toBe("https://api.minimaxi.com/anthropic");
  });

  it("lists the current MiniMax API models and recognizes them", () => {
    expect(MINIMAX_API_MODELS).toEqual(["MiniMax-M3", "MiniMax-M2.7"]);
    expect(isMiniMaxApiModel("MiniMax-M3")).toBe(true);
    expect(isMiniMaxApiModel("MiniMax-M2.7")).toBe(true);
    expect(isMiniMaxApiModel("deepseek-chat")).toBe(false);
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
