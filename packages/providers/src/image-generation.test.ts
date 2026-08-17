import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MINIMAX_BASE_URL,
  DEFAULT_MINIMAX_CN_BASE_URL,
  MINIMAX_IMAGE_ENDPOINTS,
} from "@linghun/shared";
import {
  createImageGenerationRequestBody,
  decodeImageGenerationResponse,
  defaultImageModelId,
  findKnownImageModel,
  generateImage,
  listKnownImageModels,
  minimaxImageModels,
} from "./image-generation.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchMock = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function successBody(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "trace-1",
    data: { image_urls: ["https://example.invalid/first.png"] },
    metadata: { success_count: 1, failed_count: 0 },
    base_resp: { status_code: 0, status_msg: "success" },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("image model registry", () => {
  it("registers both image models with the default first", () => {
    expect(minimaxImageModels.map((model) => model.id)).toEqual(["image-01", "image-01-live"]);
    expect(defaultImageModelId).toBe("image-01");
    for (const model of minimaxImageModels) {
      expect(model.providerId).toBe("minimax");
      expect(model.outputFormats).toEqual(["url", "base64"]);
      expect(model.urlTtlHours).toBe(24);
    }
  });

  it("looks up known image models and rejects text models", () => {
    expect(findKnownImageModel("image-01")?.displayName).toBe("MiniMax Image 01");
    expect(findKnownImageModel("image-01-live")?.displayName).toBe("MiniMax Image 01 Live");
    expect(findKnownImageModel("MiniMax-M3")).toBeUndefined();
    expect(listKnownImageModels()).toHaveLength(2);
  });
});

describe("image generation request schema", () => {
  it("emits only the fields the caller set", () => {
    expect(createImageGenerationRequestBody({ model: "image-01", prompt: "a red circle" })).toEqual({
      model: "image-01",
      prompt: "a red circle",
    });
  });

  it("maps every optional field to its wire name", () => {
    expect(
      createImageGenerationRequestBody({
        model: "image-01",
        prompt: "a red circle",
        aspectRatio: "16:9",
        responseFormat: "base64",
        seed: 7,
        count: 3,
        promptOptimizer: true,
      }),
    ).toEqual({
      model: "image-01",
      prompt: "a red circle",
      aspect_ratio: "16:9",
      response_format: "base64",
      seed: 7,
      n: 3,
      prompt_optimizer: true,
    });
  });

  it("passes width and height through as a pair", () => {
    expect(
      createImageGenerationRequestBody({
        model: "image-01",
        prompt: "a red circle",
        width: 1024,
        height: 768,
      }),
    ).toMatchObject({ width: 1024, height: 768 });
  });

  it("rejects requests the endpoint would refuse", () => {
    expect(() => createImageGenerationRequestBody({ model: "image-01", prompt: "  " })).toThrow(
      /prompt is required/,
    );
    expect(() =>
      createImageGenerationRequestBody({ model: "MiniMax-M3", prompt: "a red circle" }),
    ).toThrow(/not a known image model/);
    expect(() =>
      createImageGenerationRequestBody({ model: "image-01", prompt: "x", aspectRatio: "5:4" }),
    ).toThrow(/aspect_ratio 5:4 is not supported/);
    expect(() =>
      createImageGenerationRequestBody({ model: "image-01", prompt: "x", width: 1024 }),
    ).toThrow(/width and height must be sent together/);
    expect(() =>
      createImageGenerationRequestBody({
        model: "image-01",
        prompt: "x",
        width: 1020,
        height: 1024,
      }),
    ).toThrow(/width must be divisible by 8/);
    expect(() =>
      createImageGenerationRequestBody({ model: "image-01", prompt: "x", width: 256, height: 256 }),
    ).toThrow(/width must be between 512 and 2048/);
    expect(() =>
      createImageGenerationRequestBody({ model: "image-01", prompt: "x", count: 10 }),
    ).toThrow(/count must be an integer between 1 and 9/);
    expect(() =>
      createImageGenerationRequestBody({ model: "image-01", prompt: "x".repeat(1501) }),
    ).toThrow(/prompt exceeds 1500 characters/);
  });
});

describe("image generation response decoding", () => {
  it("decodes URLs, counters and the trace id", () => {
    const decoded = decodeImageGenerationResponse(successBody());

    expect(decoded.imageUrls).toEqual(["https://example.invalid/first.png"]);
    expect(decoded.imagesBase64).toEqual([]);
    expect(decoded.successCount).toBe(1);
    expect(decoded.failedCount).toBe(0);
    expect(decoded.statusCode).toBe(0);
    expect(decoded.traceId).toBe("trace-1");
    expect(decoded.urlTtlHours).toBe(24);
  });

  it("accepts counters returned as strings", () => {
    const decoded = decodeImageGenerationResponse(
      successBody({
        data: { image_urls: ["https://example.invalid/a.png", "https://example.invalid/b.png"] },
        metadata: { success_count: "2", failed_count: "1" },
      }),
    );

    expect(decoded.successCount).toBe(2);
    expect(decoded.failedCount).toBe(1);
  });

  it("decodes inline base64 images without a URL lifetime", () => {
    const decoded = decodeImageGenerationResponse(
      successBody({ data: { image_base64: ["aGVsbG8="] } }),
    );

    expect(decoded.imagesBase64).toEqual(["aGVsbG8="]);
    expect(decoded.imageUrls).toEqual([]);
    expect(decoded.urlTtlHours).toBeUndefined();
  });

  it("surfaces a non-zero status code instead of reporting an empty success", () => {
    expect(() =>
      decodeImageGenerationResponse(
        successBody({ base_resp: { status_code: 1026, status_msg: "sensitive content" } }),
      ),
    ).toThrow(/status 1026 \(sensitive content\)/);
  });

  it("reports a rejected generation when no image came back", () => {
    expect(() =>
      decodeImageGenerationResponse(
        successBody({ data: {}, metadata: { success_count: 0, failed_count: 1 } }),
      ),
    ).toThrow(/returned no images \(failed count 1\)/);
  });

  it("reports a malformed body", () => {
    expect(() => decodeImageGenerationResponse("not json")).toThrow(/was not a JSON object/);
  });
});

describe("image generation call", () => {
  it("posts to the global endpoint with bearer auth and the mapped body", async () => {
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse(successBody()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImage({
      apiKey: "test-key",
      baseUrl: DEFAULT_MINIMAX_BASE_URL,
      request: { model: "image-01", prompt: "a red circle", responseFormat: "base64" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(MINIMAX_IMAGE_ENDPOINTS.global_en);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "image-01",
      prompt: "a red circle",
      response_format: "base64",
    });
    expect(result.imageUrls).toHaveLength(1);
  });

  it("posts to the mainland-China endpoint when the provider uses that host", async () => {
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse(successBody()));
    vi.stubGlobal("fetch", fetchMock);

    await generateImage({
      apiKey: "test-key",
      baseUrl: DEFAULT_MINIMAX_CN_BASE_URL,
      request: { model: "image-01", prompt: "a red circle" },
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(MINIMAX_IMAGE_ENDPOINTS.cn_zh);
  });

  it("requires an API key before sending anything", async () => {
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse(successBody()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateImage({ request: { model: "image-01", prompt: "a red circle" } }),
    ).rejects.toThrow(/needs an API key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates the request before sending anything", async () => {
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse(successBody()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateImage({ apiKey: "test-key", request: { model: "image-01", prompt: "" } }),
    ).rejects.toThrow(/prompt is required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps an unauthorized status to an API key error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchMock>(async () => jsonResponse({ message: "denied" }, 401)),
    );

    await expect(
      generateImage({ apiKey: "test-key", request: { model: "image-01", prompt: "a red circle" } }),
    ).rejects.toThrow(/HTTP 401/);
  });
});
