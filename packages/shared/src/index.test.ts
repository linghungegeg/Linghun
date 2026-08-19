import { describe, expect, it } from "vitest";
import {
  DEFAULT_MINIMAX_ANTHROPIC_BASE_URL,
  DEFAULT_MINIMAX_BASE_URL,
  DEFAULT_MINIMAX_CN_ANTHROPIC_BASE_URL,
  DEFAULT_MINIMAX_CN_BASE_URL,
  DEFAULT_MINIMAX_IMAGE_MODEL,
  LINGHUN_CLI_NAME,
  LINGHUN_NAME,
  LINGHUN_VERSION,
  MINIMAX_API_MODELS,
  MINIMAX_IMAGE_ENDPOINTS,
  MINIMAX_IMAGE_MODELS,
  MINIMAX_IMAGE_URL_TTL_HOURS,
  canonicalPathForCompare,
  canonicalPathKeyForCompare,
  isMiniMaxApiModel,
  isMiniMaxImageModel,
  isPathInside,
  normalizePathSeparators,
  pathsReferToSameLocation,
  resolveMiniMaxImageEndpoint,
  resolveMiniMaxRegion,
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

describe("MiniMax image constants", () => {
  it("exposes the global and mainland-China image endpoints", () => {
    expect(MINIMAX_IMAGE_ENDPOINTS.global_en).toBe("https://api.minimax.io/v1/image_generation");
    expect(MINIMAX_IMAGE_ENDPOINTS.cn_zh).toBe("https://api.minimaxi.com/v1/image_generation");
  });

  it("lists the current image models and recognizes them", () => {
    expect(MINIMAX_IMAGE_MODELS).toEqual(["image-01", "image-01-live"]);
    expect(DEFAULT_MINIMAX_IMAGE_MODEL).toBe("image-01");
    expect(isMiniMaxImageModel("image-01")).toBe(true);
    expect(isMiniMaxImageModel("image-01-live")).toBe(true);
    expect(isMiniMaxImageModel("MiniMax-M3")).toBe(false);
  });

  it("keeps a configured mainland-China chat host on the mainland-China image endpoint", () => {
    expect(resolveMiniMaxRegion(DEFAULT_MINIMAX_CN_BASE_URL)).toBe("cn_zh");
    expect(resolveMiniMaxRegion(DEFAULT_MINIMAX_BASE_URL)).toBe("global_en");
    expect(resolveMiniMaxImageEndpoint(DEFAULT_MINIMAX_CN_BASE_URL)).toBe(
      MINIMAX_IMAGE_ENDPOINTS.cn_zh,
    );
    expect(resolveMiniMaxImageEndpoint(DEFAULT_MINIMAX_CN_ANTHROPIC_BASE_URL)).toBe(
      MINIMAX_IMAGE_ENDPOINTS.cn_zh,
    );
  });

  it("falls back to the global image endpoint for a missing or unparsable base URL", () => {
    expect(resolveMiniMaxImageEndpoint(undefined)).toBe(MINIMAX_IMAGE_ENDPOINTS.global_en);
    expect(resolveMiniMaxImageEndpoint("not a url")).toBe(MINIMAX_IMAGE_ENDPOINTS.global_en);
  });

  it("records the image URL lifetime so callers persist bytes in time", () => {
    expect(MINIMAX_IMAGE_URL_TTL_HOURS).toBe(24);
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
